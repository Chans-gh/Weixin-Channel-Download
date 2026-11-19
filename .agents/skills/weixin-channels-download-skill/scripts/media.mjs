import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, copyFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DownloadError } from "./core.mjs";
import { inTemporaryDirectory, publishFile } from "./files.mjs";

const run = promisify(execFile);
const inputOptions = [
  "-protocol_whitelist", "file,pipe",
  "-format_whitelist", "mov,matroska,webm,mp3,wav,aac,flac,ogg,mpegts,avi,aiff",
];

async function runMedia(tool, args, signal) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const local = fileURLToPath(new URL(`../.runtime/bin/${tool}${suffix}`, import.meta.url));
  const available = await access(local, constants.X_OK).then(() => true, () => false);
  const command = available ? local : tool;
  try {
    return await run(command, ["-v", "error", ...args], { signal, windowsHide: true, maxBuffer: 1024 * 1024 });
  } catch (error) {
    signal.throwIfAborted();
    if (error.code === "ENOENT") {
      throw new DownloadError("MEDIA_TOOL_MISSING", `需要 ${tool}。请安装 FFmpeg，或将可执行文件放入本工具的 .runtime/bin。`);
    }
    throw new DownloadError(
      tool === "ffprobe" ? "MEDIA_PROBE_FAILED" : "MEDIA_CONVERT_FAILED",
      tool === "ffprobe" ? "无法读取媒体规格，请确认文件是有效的本地音视频。" : "无法转换媒体，请检查文件编码和可用磁盘空间。",
    );
  }
}

export async function importMedia(input) {
  const path = resolve(input);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || !info.size) {
    throw new DownloadError("LOCAL_MEDIA_INVALID", "请提供一个存在且非空的本地音视频文件。");
  }
  return path;
}

export async function probeMedia(path, signal) {
  const { stdout } = await runMedia("ffprobe", [
    ...inputOptions, "-show_entries",
    "format=format_name,duration:stream=codec_type,codec_name,width,height:stream_disposition=attached_pic",
    "-of", "json", "-i", path,
  ], signal);
  const { streams = [], format } = JSON.parse(stdout);
  const video = streams.find(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  const audio = streams.find(stream => stream.codec_type === "audio");
  if (!video && !audio) throw new DownloadError("LOCAL_MEDIA_INVALID", "文件中没有可读取的音轨或视频轨。");
  const seconds = Number(format?.duration);
  return {
    format: format?.format_name,
    duration: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 100) / 100 : null,
    video: video ? { width: video.width, height: video.height, codec: video.codec_name } : null,
    audio: audio ? { codec: audio.codec_name } : null,
  };
}

async function convert(path, args, output, signal) {
  await runMedia("ffmpeg", ["-nostdin", "-n", ...inputOptions, "-i", path, ...args, output], signal);
}

async function exportMedia(directory, name, work, signal) {
  return inTemporaryDirectory(directory, async temporary => {
    const staged = join(temporary, "media" + extname(name));
    await work(staged);
    signal.throwIfAborted();
    await chmod(staged, 0o600);
    const { size: bytes } = await stat(staged);
    if (bytes === 0) throw new DownloadError("MEDIA_CONVERT_FAILED", "导出的媒体文件为空。");
    return { path: await publishFile(staged, directory, name), bytes };
  });
}

export function exportLocalVideo(path, media, directory, name, signal) {
  if (!media.video) throw new DownloadError("VIDEO_TRACK_MISSING", "导入的文件没有视频轨。");
  return exportMedia(directory, name, staged => {
    if (extname(path).toLowerCase() === ".mp4" && media.format?.split(",").includes("mp4")) {
      return copyFile(path, staged, constants.COPYFILE_EXCL);
    }
    return convert(path, [
      "-map", "0:V:0", "-map", "0:a:0?", "-map_metadata", "-1",
      "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart",
    ], staged, signal);
  }, signal);
}

export function exportAudio(path, media, directory, name, signal) {
  if (!media.audio) throw new DownloadError("AUDIO_TRACK_MISSING", "媒体文件没有可读取的音轨。");
  return exportMedia(directory, name, staged => convert(path, [
    "-map", "0:a:0", "-map_metadata", "-1", "-c:a", "pcm_s16le", "-ar", "48000",
  ], staged, signal), signal);
}

export function decodeForSpeech(path, output, signal) {
  return convert(path, [
    "-map", "0:a:0", "-c:a", "pcm_f32le", "-ac", "1", "-ar", "16000", "-f", "f32le",
  ], output, signal);
}
