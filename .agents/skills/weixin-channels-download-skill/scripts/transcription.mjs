import { constants } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportCollection } from "./collection.mjs";
import { DownloadError } from "./core.mjs";
import { saveText } from "./files.mjs";
import { exportAudio } from "./media.mjs";
import { transcribeWithWhisper } from "./transcribe.mjs";
import { prepareTranscript } from "./transcript-format.mjs";

const defaultJobsDirectory = fileURLToPath(new URL("../.runtime/transcription/", import.meta.url));

export async function stageTranscription({ path, media, audio, directory, stem, input, record }, {
  signal,
  jobsDirectory = defaultJobsDirectory,
}) {
  if (!media.audio) throw new DownloadError("AUDIO_TRACK_MISSING", "媒体文件没有可识别的音轨。");
  await mkdir(jobsDirectory, { recursive: true, mode: 0o700 });
  const job = await mkdtemp(join(jobsDirectory, "job-"));
  try {
    const { path: audioPath } = audio ?? await exportAudio(path, media, job, "speech.wav", signal);
    signal.throwIfAborted();
    await writeFile(join(job, "request.json"), JSON.stringify({ directory, stem, input, record, audioPath }), {
      flag: "wx",
      mode: 0o600,
    });
    return { status: "pending", jobId: basename(job), audioPath };
  } catch (error) {
    await rm(job, { recursive: true, force: true });
    throw error;
  }
}

function jobNotFound() {
  return new DownloadError("TRANSCRIPTION_JOB_NOT_FOUND", "找不到待转写任务。请使用准备步骤返回的任务编号。");
}

async function readTranscript(path, signal) {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await file.stat()).isFile()) throw new Error("Expected a regular file");
      return new TextDecoder("utf-8", { fatal: true }).decode(await file.readFile({ signal }));
    } finally {
      await file.close();
    }
  } catch {
    signal.throwIfAborted();
    throw new DownloadError("TRANSCRIPT_FILE_INVALID", "请提供可读取的 UTF-8 转写文本文件。");
  }
}

export async function finishTranscription(jobId, { transcriptFile, localWhisper }, {
  signal,
  jobsDirectory = defaultJobsDirectory,
  progress,
  fetchImpl,
  recognize,
}) {
  if (!/^job-[A-Za-z0-9]{6}$/u.test(jobId)) throw jobNotFound();
  const jobPath = join(jobsDirectory, jobId);
  const lock = join(jobPath, ".finishing");
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "ENOENT") throw jobNotFound();
    if (error.code === "EEXIST") {
      throw new DownloadError("TRANSCRIPTION_JOB_BUSY", "该转写任务正在保存，请等当前命令结束。");
    }
    throw error;
  }

  try {
    const request = join(jobPath, "request.json");
    const job = JSON.parse(await readFile(request, "utf8").catch(error => {
      if (error.code === "ENOENT") throw jobNotFound();
      throw error;
    }));
    const { directory, stem, input, record } = job;
    const engine = localWhisper ? "local-whisper" : (transcriptFile !== undefined ? "agent" : null);
    let transcript = null;
    if (engine) {
      const text = localWhisper
        ? await transcribeWithWhisper(job.audioPath ?? join(jobPath, "speech.wav"), jobPath, {
          signal, progress, fetchImpl, recognize,
        })
        : await readTranscript(transcriptFile, signal);
      transcript = await prepareTranscript(text);
      if (!transcript) throw new DownloadError("SPEECH_EMPTY", "转写没有返回口播文本，可用另一条路径重试。");
    }
    signal.throwIfAborted();
    const outputs = {};
    const data = {};
    try {
      if (transcript) outputs.transcript = { path: await saveText(directory, stem + "_口播.txt", transcript + "\n") };
      if (record) {
        await exportCollection({
          ...record,
          savedAt: new Date().toISOString(),
          transcript,
          transcriptStatus: transcript ? "已提取" : "未提取",
        }, directory, stem, data);
        outputs.data = data;
      }
      await rm(request);
    } catch (error) {
      const written = [outputs.transcript?.path, data.json, data.csv].filter(Boolean);
      await Promise.allSettled(written.map(path => rm(path)));
      throw error;
    }
    await rm(jobPath, { recursive: true, force: true }).catch(() => {});
    const transcription = engine ? { status: "completed", engine } : { status: "skipped" };
    return { ok: true, input, outputs, errors: {}, transcription };
  } finally {
    await rm(lock, { recursive: true, force: true }).catch(() => {});
  }
}
