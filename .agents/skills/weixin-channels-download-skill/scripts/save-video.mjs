import { createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { CHANNELS_ORIGIN, DownloadError, mediaAddress } from "./core.mjs";
import { safeDownloadFilename } from "./filename.mjs";
import { inTemporaryDirectory, publishFile } from "./files.mjs";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function fetchVideo(address, { fetchImpl, signal }) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetchImpl(address, {
      headers: { referer: CHANNELS_ORIGIN + "/", "accept-encoding": "identity" },
      credentials: "omit",
      redirect: "manual",
      signal,
    });
    if (!REDIRECT_STATUSES.has(response.status)) {
      if (response.status === 200 && response.body) return response;
      await response.body?.cancel();
      throw new DownloadError("DOWNLOAD_HTTP", `媒体下载失败（HTTP ${response.status}）。`);
    }

    await response.body?.cancel();
    const location = response.headers.get("location");
    const next = location && URL.parse(location, address);
    address = next && mediaAddress(next.href);
    if (!address || redirects === 5) {
      throw new DownloadError("DOWNLOAD_REDIRECT", "媒体下载的跳转地址无法使用。");
    }
  }
}

async function completeMp4(filename, bytes) {
  const file = await open(filename, "r");
  try {
    const required = new Set(["ftyp", "moov", "mdat"]);
    const header = Buffer.alloc(8);
    let offset = 0;
    while (offset < bytes) {
      if ((await file.read(header, 0, 8, offset)).bytesRead !== 8) return false;

      const type = header.toString("ascii", 4, 8);
      let size = header.readUInt32BE(0);
      let headerSize = 8;
      if (size === 0) size = bytes - offset;
      if (size === 1) {
        if ((await file.read(header, 0, 8, offset + 8)).bytesRead !== 8) return false;
        const wideSize = header.readBigUInt64BE(0);
        if (wideSize > BigInt(bytes - offset)) return false;
        size = Number(wideSize);
        headerSize = 16;
      }
      if (size < headerSize || size > bytes - offset) return false;
      if (size > headerSize) required.delete(type);
      offset += size;
    }
    return required.size === 0;
  } finally {
    await file.close();
  }
}

export async function saveVideo(video, directory, { fetchImpl, signal }) {
  let response;
  const timeout = AbortSignal.timeout(10 * 60 * 1000);
  const transferSignal = AbortSignal.any([signal, timeout]);
  try {
    return await inTemporaryDirectory(directory, async (temporaryDirectory) => {
      const temporaryFile = join(temporaryDirectory, "video.part");
      response = await fetchVideo(video.address, { fetchImpl, signal: transferSignal });
      await pipeline(response.body, createWriteStream(temporaryFile, { flags: "wx", mode: 0o600 }), {
        signal: transferSignal,
      });

      const { size: bytes } = await stat(temporaryFile);
      const length = response.headers.get("content-length");
      const encoding = response.headers.get("content-encoding");
      if (length !== null && (!encoding || encoding === "identity") && Number(length) !== bytes) {
        throw new DownloadError("INCOMPLETE_DOWNLOAD", "下载字节数与服务器声明的长度不符，请重试。");
      }
      if (!await completeMp4(temporaryFile, bytes)) {
        throw new DownloadError("INVALID_MEDIA", "下载内容不是完整的 MP4 文件。");
      }

      signal.throwIfAborted();
      const path = await publishFile(temporaryFile, directory, safeDownloadFilename(video.title));
      return { ok: true, path, bytes, version: video.version };
    });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DownloadError) throw error;
    if (timeout.aborted) throw new DownloadError("DOWNLOAD_TIMEOUT", "视频下载超时，请重试。");
    if (["EACCES", "EPERM", "ENOSPC", "EROFS", "ENOENT", "ENOTDIR", "ENOTSUP"].includes(error.code)) {
      throw new DownloadError("LOCAL_WRITE_FAILED", "无法保存视频，请确认目录允许写入、文件系统支持硬链接且空间充足。");
    }
    throw new DownloadError("DOWNLOAD_FAILED", "视频下载中断，请检查网络和保存目录后重试。");
  } finally {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}
