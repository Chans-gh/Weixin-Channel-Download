import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DownloadError } from "./core.mjs";
import { inTemporaryDirectory } from "./files.mjs";
import { decodeForSpeech } from "./media.mjs";
import { downloadModelFile, MODEL, MODEL_FILES, REVISION, verifyModelBytes } from "./model-assets.mjs";

const modelRoot = fileURLToPath(new URL("../.runtime/models/" + REVISION, import.meta.url));

async function prepareModel({ signal, progress, fetchImpl = fetch }) {
  const fetchModel = (url, init) => fetchImpl(url, {
    ...init, signal: AbortSignal.any([signal, init.signal]),
  });

  let announced = false;
  let source = "huggingface";
  for (const file of MODEL_FILES) {
    signal.throwIfAborted();
    const [relative] = file;
    const target = join(modelRoot, MODEL, relative);
    const verified = await readFile(target).then(bytes => verifyModelBytes(file, bytes)).catch(() => null);
    if (verified) continue;

    if (!announced) {
      progress("首次使用将校验并下载约 80 MB 的 Whisper Base q8 模型。");
      announced = true;
    }
    let bytes;
    try {
      bytes = await downloadModelFile(source, file, undefined, fetchModel);
    } catch {
      signal.throwIfAborted();
      source = source === "huggingface" ? "modelscope" : "huggingface";
      progress(source === "modelscope" ? "模型下载切换至 ModelScope。" : "模型下载切换至 Hugging Face。");
      try {
        bytes = await downloadModelFile(source, file, undefined, fetchModel);
      } catch {
        signal.throwIfAborted();
        throw new DownloadError("MODEL_UNAVAILABLE", "无法获取并校验 Whisper 模型，请检查模型源的网络连接后重试。");
      }
    }

    await mkdir(dirname(target), { recursive: true });
    await inTemporaryDirectory(dirname(target), async temporary => {
      const staged = join(temporary, "model.part");
      await writeFile(staged, bytes, { flag: "wx", mode: 0o600 });
      signal.throwIfAborted();
      await rename(staged, target);
    });
  }

  return modelRoot;
}

async function recognizeSpeech(waveform, { signal, progress, fetchImpl }) {
  const root = await prepareModel({ signal, progress, fetchImpl });
  let runtime;
  try {
    runtime = await import("@huggingface/transformers");
  } catch {
    throw new DownloadError("ASR_RUNTIME_UNAVAILABLE", "无法加载本机语音识别运行库，请重新安装本工具的锁定依赖。");
  }
  const { env, pipeline } = runtime;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = root + sep;
  env.useFSCache = false;

  progress("正在本机识别中文口播。");
  try {
    const transcriber = await pipeline("automatic-speech-recognition", MODEL, {
      device: "cpu",
      dtype: "q8",
      local_files_only: true,
    });
    try {
      const result = await transcriber(waveform, {
        language: "chinese",
        task: "transcribe",
        num_beams: 1,
        max_new_tokens: 256,
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      signal.throwIfAborted();
      return result.text;
    } finally {
      await transcriber.dispose();
    }
  } catch {
    signal.throwIfAborted();
    throw new DownloadError("TRANSCRIPTION_FAILED", "本机语音识别失败，请检查音轨和识别运行库。");
  }
}

export async function transcribeWithWhisper(path, directory, {
  signal,
  progress,
  fetchImpl,
  recognize = recognizeSpeech,
}) {
  return inTemporaryDirectory(directory, async temporary => {
    const pcm = join(temporary, "speech.f32le");
    await decodeForSpeech(path, pcm, signal);
    const bytes = await readFile(pcm);
    const waveform = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (!waveform.some(sample => sample !== 0)) {
      throw new DownloadError("SPEECH_EMPTY", "音轨没有可识别的口播。");
    }
    const text = await recognize(waveform, { signal, progress, fetchImpl });
    const spoken = text?.replace(/[^\p{L}\p{N}]/gu, "") ?? "";
    if (text?.trim() && (!spoken || /^[a-z]$/iu.test(spoken))) {
      throw new DownloadError("SPEECH_UNCLEAR", "本地 Whisper 只返回了零散字符，未能得到可用的中文口播。任务可用另一条路径重试。");
    }
    return text;
  });
}
