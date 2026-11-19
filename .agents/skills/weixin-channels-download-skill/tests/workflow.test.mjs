import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { encodeCollectionCsv } from "../scripts/collection.mjs";
import { DownloadError } from "../scripts/core.mjs";
import { probeMedia } from "../scripts/media.mjs";
import { runCli } from "../scripts/download.mjs";

const toneFile = fileURLToPath(new URL("./fixtures/tone.webm", import.meta.url));
const silentFile = fileURLToPath(new URL("./fixtures/sample.mp4", import.meta.url));
const signal = new AbortController().signal;

async function tempOutput(t) {
  const directory = await mkdtemp(join(tmpdir(), "wx-workflow-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function run(args, overrides = {}) {
  const lines = [];
  const status = await runCli(args, {
    launch: () => assert.fail("本地文件导入不应打开 Chrome"),
    fetchImpl: () => assert.fail("本地文件导入不应联网"),
    stdout: { write: (line) => lines.push(line) },
    stderr: { write() {} },
    ...overrides,
  });
  assert.equal(lines.length, 1);
  return { status, result: JSON.parse(lines[0]) };
}

test("本地导入先生成 MP4 和 WAV，回填 Agent 转写后导出简体 TXT、JSON 和 CSV", { timeout: 20_000 }, async (t) => {
  const directory = await tempOutput(t);
  const jobsDirectory = await tempOutput(t);
  const scratch = await tempOutput(t);
  const original = await readFile(toneFile);
  const { status, result } = await run([toneFile, "--all", "--output-dir", directory], { jobsDirectory });
  assert.equal(status, 0, JSON.stringify(result));
  assert.equal(result.input, "local");
  assert.deepEqual(Object.keys(result.outputs), ["video", "audio"]);
  assert.equal(result.transcription.status, "pending");

  const { video, audio } = result.outputs;
  assert.equal(result.transcription.audioPath, audio.path);
  const outputInfo = await probeMedia(video.path, signal);
  assert.equal(outputInfo.video.codec, "h264");
  assert.equal(outputInfo.audio.codec, "aac");
  assert.equal(extname(video.path), ".mp4");
  const wav = await readFile(audio.path);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.readUInt16LE(34), 16);

  const textFile = join(scratch, "agent.txt");
  const finish = ["--finish-transcription", result.transcription.jobId, "--transcript-file", textFile];
  await writeFile(textFile, " \n");
  const empty = await run(finish, { jobsDirectory });
  assert.equal(empty.status, 1);
  assert.equal(empty.result.code, "SPEECH_EMPTY");
  assert.equal((await readdir(directory)).length, 2);

  await writeFile(textFile, "大家好，這是一段測試。這裡有語音辨識結果。");
  const attempts = await Promise.all([run(finish, { jobsDirectory }), run(finish, { jobsDirectory })]);
  const [completed, duplicate] = attempts.sort((one, two) => one.status - two.status);
  assert.equal(completed.status, 0, JSON.stringify(completed.result));
  assert.equal(completed.result.transcription.status, "completed");
  assert.equal(completed.result.transcription.engine, "agent");
  assert.equal(duplicate.status, 1);
  assert.ok(["TRANSCRIPTION_JOB_BUSY", "TRANSCRIPTION_JOB_NOT_FOUND"].includes(duplicate.result.code));
  const { transcript, data } = completed.result.outputs;
  const spoken = await readFile(transcript.path, "utf8");
  assert.equal(spoken, "大家好，这是一段测试。\n这里有语音辨识结果。\n");
  const record = JSON.parse(await readFile(data.json, "utf8"));
  assert.equal(record.title, null);
  assert.equal(record.description, null);
  assert.equal(record.sourceUrl, null);
  assert.equal(record.fileName, "tone.webm");
  assert.equal(record.width, 64);
  assert.equal(record.height, 48);
  assert.equal(record.videoCodec, "vp9");
  assert.equal(record.audioCodec, "opus");
  assert.equal(record.transcriptStatus, "已提取");
  assert.equal(record.transcript, spoken.trim());
  assert.ok((await readFile(data.csv, "utf8")).includes(spoken.trim()));
  assert.deepEqual(await readFile(toneFile), original);
  assert.equal((await readdir(directory)).length, 5);
  assert.deepEqual(await readdir(jobsDirectory), []);
});

test("Agent 缺少音频输入时，Whisper 可处理同一任务并保留显式导出的 WAV", async (t) => {
  const directory = await tempOutput(t);
  const jobsDirectory = await tempOutput(t);
  const { status, result } = await run([toneFile, "--audio", "--transcribe", "--data", "--output-dir", directory], { jobsDirectory });
  assert.equal(status, 0, JSON.stringify(result));
  assert.equal(result.transcription.status, "pending");
  const { jobId, audioPath } = result.transcription;
  assert.equal(audioPath, result.outputs.audio.path);
  const finished = await run(["--finish-transcription", jobId, "--local-whisper"], {
    jobsDirectory,
    recognize(waveform) {
      assert.ok(waveform instanceof Float32Array);
      assert.ok(waveform.length >= 15_000 && waveform.length <= 17_000);
      return "這是本機辨識的口播。";
    },
  });
  assert.equal(finished.status, 0, JSON.stringify(finished.result));
  assert.deepEqual(finished.result.transcription, { status: "completed", engine: "local-whisper" });
  const { transcript, data } = finished.result.outputs;
  assert.equal(await readFile(transcript.path, "utf8"), "这是本机辨识的口播。\n");
  const record = JSON.parse(await readFile(data.json, "utf8"));
  assert.equal(record.transcriptStatus, "已提取");
  assert.equal(record.transcript, "这是本机辨识的口播。");
  assert.ok((await readFile(data.csv, "utf8")).includes(record.transcript));
  assert.equal((await readFile(audioPath)).toString("ascii", 0, 4), "RIFF");
  assert.deepEqual(await readdir(jobsDirectory), []);
});

test("Whisper 失败会保留音轨，随后仍可用 Agent 文本结束同一任务", async (t) => {
  const directory = await tempOutput(t);
  const jobsDirectory = await tempOutput(t);
  const { result } = await run([toneFile, "--transcribe", "--output-dir", directory], { jobsDirectory });
  const { jobId, audioPath } = result.transcription;
  const failed = await run(["--finish-transcription", jobId, "--local-whisper"], {
    jobsDirectory,
    recognize: () => { throw new DownloadError("MODEL_UNAVAILABLE", "模拟模型不可用。"); },
  });
  assert.equal(failed.status, 1);
  assert.equal(failed.result.code, "MODEL_UNAVAILABLE");
  const unclear = await run(["--finish-transcription", jobId, "--local-whisper"], {
    jobsDirectory,
    recognize: () => "d",
  });
  assert.equal(unclear.status, 1);
  assert.equal(unclear.result.code, "SPEECH_UNCLEAR");
  assert.deepEqual(await readdir(directory), []);
  assert.equal((await readFile(audioPath)).toString("ascii", 0, 4), "RIFF");

  const textFile = join(jobsDirectory, "agent.txt");
  await writeFile(textFile, "来自 Agent 的转写");
  const finished = await run(["--finish-transcription", jobId, "--transcript-file", textFile], { jobsDirectory });
  assert.equal(finished.status, 0, JSON.stringify(finished.result));
  assert.equal(finished.result.transcription.engine, "agent");
  assert.equal(await readFile(finished.result.outputs.transcript.path, "utf8"), "来自 Agent 的转写。\n");
  await assert.rejects(readFile(audioPath), { code: "ENOENT" });
});

test("转写不可用时可以跳过，并仅导出请求的数据", async (t) => {
  const directory = await tempOutput(t);
  const jobsDirectory = await tempOutput(t);
  const { status, result } = await run([toneFile, "--transcribe", "--data", "--output-dir", directory], { jobsDirectory });
  assert.equal(status, 0, JSON.stringify(result));
  assert.deepEqual(result.outputs, {});
  const { audioPath, jobId } = result.transcription;
  assert.equal((await readFile(audioPath)).toString("ascii", 0, 4), "RIFF");
  const skipped = await run(["--finish-transcription", jobId, "--skip-transcription"], { jobsDirectory });
  assert.equal(skipped.status, 0, JSON.stringify(skipped.result));
  assert.equal(skipped.result.transcription.status, "skipped");
  assert.deepEqual(Object.keys(skipped.result.outputs), ["data"]);
  const record = JSON.parse(await readFile(skipped.result.outputs.data.json, "utf8"));
  assert.equal(record.transcript, null);
  assert.equal(record.transcriptStatus, "未提取");
  assert.deepEqual(await readdir(jobsDirectory), []);
  assert.equal((await readdir(directory)).length, 2);
});

test("转写任务保存失败后可以重试，已经存在的文件保持原样", async (t) => {
  const directory = await tempOutput(t);
  const jobsDirectory = await tempOutput(t);
  const { result } = await run([toneFile, "--transcribe", "--data", "--output-dir", directory], { jobsDirectory });
  const textFile = join(jobsDirectory, "agent.txt");
  await writeFile(textFile, "测试口播。");
  const args = ["--finish-transcription", result.transcription.jobId, "--transcript-file", textFile];
  await rm(directory, { recursive: true });
  await writeFile(directory, "existing");
  const failed = await run(args, { jobsDirectory });
  assert.equal(failed.status, 1);
  assert.equal(await readFile(directory, "utf8"), "existing");
  await rm(directory);
  await mkdir(directory);
  const completed = await run(args, { jobsDirectory });
  assert.equal(completed.status, 0, JSON.stringify(completed.result));
  assert.equal((await readdir(directory)).length, 3);
});

test("结束转写时拒绝目录穿越和相互冲突的参数", async (t) => {
  const jobsDirectory = await tempOutput(t);
  const absent = await run(["--finish-transcription", "../private", "--skip-transcription"], { jobsDirectory });
  assert.equal(absent.result.code, "TRANSCRIPTION_JOB_NOT_FOUND");
  const conflict = await run(["--finish-transcription", "job-AbCc98", "--skip-transcription", "--transcript-file", "text.txt"], { jobsDirectory });
  assert.equal(conflict.result.code, "INVALID_ARGUMENTS");
  const twoEngines = await run(["--finish-transcription", "job-AbCc98", "--local-whisper", "--transcript-file", "text.txt"], { jobsDirectory });
  assert.equal(twoEngines.result.code, "INVALID_ARGUMENTS");
});

test("视频无音轨时保留 MP4 和采集文件，逐项报告音轨与口播失败", async (t) => {
  const directory = await tempOutput(t);
  const { status, result } = await run([silentFile, "--all", "--output-dir", directory], {
    jobsDirectory: await tempOutput(t),
  });
  assert.equal(status, 1);
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.outputs), ["video", "data"]);
  assert.equal(result.errors.audio.code, "AUDIO_TRACK_MISSING");
  assert.equal(result.errors.transcript.code, "AUDIO_TRACK_MISSING");
  assert.deepEqual(await readFile(result.outputs.video.path), await readFile(silentFile));
  assert.equal(JSON.parse(await readFile(result.outputs.data.json, "utf8")).transcriptStatus, "提取失败");
  assert.equal((await readdir(directory)).length, 3);
});

test("本地默认提取规格，导出冲突时分别保存两组数据", async (t) => {
  const directory = await tempOutput(t);
  const args = [toneFile, "--output-dir", directory];
  const [one, two] = await Promise.all([run(args), run(args)]);
  assert.equal(one.status, 0, JSON.stringify(one.result));
  assert.equal(two.status, 0, JSON.stringify(two.result));
  assert.notEqual(one.result.outputs.data.json, two.result.outputs.data.json);
  assert.notEqual(one.result.outputs.data.csv, two.result.outputs.data.csv);
  for (const { result } of [one, two]) {
    assert.equal(result.outputs.data.json.replace(/\.json$/u, ""), result.outputs.data.csv.replace(/\.csv$/u, ""));
  }
  assert.equal((await readdir(directory)).length, 4);
});

test("CLI 可执行入口拒绝目录，采集 CSV 对公式和引号做转义", async (t) => {
  const directory = await tempOutput(t);
  const script = fileURLToPath(new URL("../scripts/download.mjs", import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath, [script, directory]), (error) => {
    assert.equal(JSON.parse(error.stdout).code, "LOCAL_MEDIA_INVALID");
    return true;
  });
  const csv = encodeCollectionCsv({ author: ' =HYPERLINK("bad")', thumbsUp: "0", description: "＝SUM(4)" });
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes(`"' =HYPERLINK(""bad"")"`));
  assert.ok(csv.includes(`"'＝SUM(4)"`));
  assert.ok(csv.includes('"0"'));
});
