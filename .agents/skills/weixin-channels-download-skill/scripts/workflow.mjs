import { basename, extname, join } from "node:path";
import { collectionRecord, exportCollection } from "./collection.mjs";
import { DownloadError } from "./core.mjs";
import { safeDownloadFilename } from "./filename.mjs";
import { inTemporaryDirectory } from "./files.mjs";
import { exportAudio, exportLocalVideo, probeMedia } from "./media.mjs";
import { saveVideo } from "./save-video.mjs";
import { stageTranscription } from "./transcription.mjs";

export function taskFailure(error) {
  if (error instanceof DownloadError) return { code: error.code, message: error.message };
  if (["EACCES", "EPERM", "ENOSPC", "EROFS", "ENOTDIR", "ENOTSUP"].includes(error?.code)) {
    return { code: "LOCAL_WRITE_FAILED", message: "无法写入成品，请检查目录权限、可用空间及文件系统的硬链接支持。" };
  }
  return { code: "UNEXPECTED_ERROR", message: "任务失败，请重试。" };
}

function mediaUnavailable() {
  return new DownloadError("MEDIA_UNAVAILABLE", "本次任务未能取得可处理的媒体文件。");
}

export async function runWorkflow(source, tasks, directory, network, { jobsDirectory }) {
  const { signal } = network;
  const { share, localPath } = source;
  const input = share ? "share" : "local";
  const localFile = localPath && basename(localPath);
  const label = share?.title ?? basename(localFile, extname(localFile));
  const name = safeDownloadFilename(label);
  const outputs = {};
  const errors = {};

  async function attempt(task, work) {
    signal.throwIfAborted();
    try {
      return await work();
    } catch (error) {
      signal.throwIfAborted();
      errors[task] = taskFailure(error);
      return undefined;
    }
  }

  // Probe an imported file first, before publishing any derivative.
  const localMedia = localPath && await probeMedia(localPath, signal);

  async function fetchVideo(target) {
    if (share.mediaError) throw share.mediaError;
    return saveVideo(share, target, network);
  }

  if (tasks.video) {
    const video = await attempt("video", () => share
      ? fetchVideo(directory)
      : exportLocalVideo(localPath, localMedia, directory, name, signal));
    if (video) outputs.video = video;
  }

  const stem = basename(outputs.video?.path ?? name, ".mp4");
  let transcription;
  let media = localMedia;

  function recordData(transcriptStatus) {
    return collectionRecord({ share, localFile, media, transcript: null, transcriptStatus });
  }

  async function processMedia(path) {
    if (!media && path && (tasks.audio || tasks.transcribe || tasks.data)) {
      media = await attempt("media", () => probeMedia(path, signal));
    }
    if (tasks.audio) {
      const audio = await attempt("audio", () => {
        if (!path || !media) throw mediaUnavailable();
        return exportAudio(path, media, directory, stem + ".wav", signal);
      });
      if (audio) outputs.audio = audio;
    }
    if (tasks.transcribe) {
      transcription = await attempt("transcript", () => {
        if (!path || !media) throw mediaUnavailable();
        return stageTranscription({
          path, media, audio: outputs.audio, directory, stem, input,
          record: tasks.data ? recordData("未提取") : null,
        }, { signal, jobsDirectory });
      });
    }
  }

  if (share && !tasks.video && (tasks.audio || tasks.transcribe)) {
    await inTemporaryDirectory(directory, async temporary => {
      const downloaded = await attempt("media", () => fetchVideo(temporary));
      await processMedia(downloaded?.path);
    });
  } else {
    await processMedia(localPath || outputs.video?.path);
  }

  if (tasks.data && !transcription) {
    const record = recordData(tasks.transcribe ? "提取失败" : "未提取");
    const data = {};
    await attempt("data", () => exportCollection(record, directory, stem, data));
    if (data.json || data.csv) outputs.data = data;
  }

  return {
    ok: Object.keys(errors).length === 0,
    input,
    outputs,
    errors,
    ...(transcription && { transcription }),
  };
}
