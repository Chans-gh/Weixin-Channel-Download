#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { launchChrome, openYuanbao, waitForLogin } from "./browser.mjs";
import { DownloadError, parseShareLink, validateShareUrl } from "./core.mjs";
import { importMedia } from "./media.mjs";
import { saveVideo } from "./save-video.mjs";
import { finishTranscription } from "./transcription.mjs";
import { runWorkflow, taskFailure } from "./workflow.mjs";

const USAGE = [
  "node scripts/download.mjs <视频号分享链接或本地音视频> [--video] [--audio] [--transcribe] [--data] [--all] [--output-dir 目录]",
  "node scripts/download.mjs --finish-transcription <任务编号> (--transcript-file <UTF-8 文本文件> | --local-whisper | --skip-transcription)",
].join("\n");
const TASK_OPTIONS = ["video", "audio", "transcribe", "data"];

async function resolveShare(input, { launch, network, onLoginRequired, requireMedia, enrich }) {
  const shareUrl = validateShareUrl(input);
  network.signal.throwIfAborted();
  const chrome = await launch();
  try {
    const browser = await openYuanbao(chrome);
    await waitForLogin(browser.page, { onLoginRequired, signal: network.signal });
    return await parseShareLink(shareUrl, browser, network, { requireMedia, enrich });
  } finally {
    await chrome.close().catch(() => {});
  }
}

function parseCommand(args) {
  const tasks = Object.fromEntries(TASK_OPTIONS.map(task => [task, { type: "boolean" }]));
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        ...tasks,
        all: { type: "boolean" },
        "output-dir": { type: "string" },
        "finish-transcription": { type: "string" },
        "transcript-file": { type: "string" },
        "local-whisper": { type: "boolean" },
        "skip-transcription": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch {
    throw new DownloadError("INVALID_ARGUMENTS", USAGE);
  }
}

export async function runCli(args, {
  stdout = process.stdout,
  stderr = process.stderr,
  launch = launchChrome,
  fetchImpl = globalThis.fetch,
  signal = new AbortController().signal,
  jobsDirectory,
  recognize,
} = {}) {
  try {
    const command = parseCommand(args);
    if (command.values.help) {
      stdout.write(USAGE + "\n");
      return 0;
    }
    const {
      "finish-transcription": jobId,
      "transcript-file": transcriptFile,
      "local-whisper": localWhisper,
      "skip-transcription": skipTranscription,
      "output-dir": requestedDirectory,
    } = command.values;
    if (jobId !== undefined) {
      const choices = [transcriptFile !== undefined, localWhisper, skipTranscription].filter(Boolean);
      if (!jobId || transcriptFile === "" || choices.length !== 1 ||
          command.positionals.length || requestedDirectory !== undefined || command.values.all ||
          TASK_OPTIONS.some(option => command.values[option])) {
        throw new DownloadError("INVALID_ARGUMENTS", USAGE);
      }
      const result = await finishTranscription(jobId, { transcriptFile, localWhisper }, {
        signal, jobsDirectory, fetchImpl, recognize,
        progress: message => stderr.write(JSON.stringify({ event: "local_whisper_progress", message }) + "\n"),
      });
      stdout.write(JSON.stringify(result) + "\n");
      return 0;
    }
    if (transcriptFile !== undefined || localWhisper || skipTranscription) throw new DownloadError("INVALID_ARGUMENTS", USAGE);

    const directory = requestedDirectory ?? join(homedir(), "Downloads");
    if (command.positionals.length !== 1 || !directory) {
      throw new DownloadError("INVALID_ARGUMENTS", USAGE);
    }

    const input = command.positionals[0].trim();
    const online = /^https?:|^[a-z][a-z0-9+.-]*:\/\//iu.test(input);
    const tasks = Object.fromEntries(TASK_OPTIONS.map(task => [task, Boolean(command.values.all || command.values[task])]));
    const legacyDownload = online && !Object.values(tasks).some(Boolean);
    if (!online && !Object.values(tasks).some(Boolean)) tasks.data = true;
    const outputDirectory = resolve(directory);
    const network = { fetchImpl, signal };
    let source;
    if (online) {
      const share = await resolveShare(input, {
        launch,
        network,
        requireMedia: legacyDownload,
        enrich: tasks.data,
        onLoginRequired: ({ waitMs }) => stderr.write(JSON.stringify({
          event: "yuanbao_login_required",
          message: "请在打开的 Chrome 窗口内手动登录腾讯元宝。登录后，当前命令会自动继续。",
          waitMs,
        }) + "\n"),
      });
      source = { share };
    } else {
      source = { localPath: await importMedia(command.positionals[0]) };
    }

    const result = legacyDownload
      ? await saveVideo(source.share, outputDirectory, network)
      : await runWorkflow(source, tasks, outputDirectory, network, { jobsDirectory });
    stdout.write(JSON.stringify(result) + "\n");
    return result.ok ? 0 : 1;
  } catch (error) {
    const failure = signal.aborted
      ? { code: "CANCELLED", message: "已取消任务。" }
      : taskFailure(error);
    stdout.write(JSON.stringify({ ok: false, ...failure }) + "\n");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    process.exitCode = await runCli(process.argv.slice(2), { signal: cancellation.signal });
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
