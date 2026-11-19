// Model manifest carried forward from the Chrome extension at ad1487f0. See NOTICE.md.
export const MODEL = "Xenova/whisper-base";
export const REVISION = "64da57285918e20ea79ea5c88eed7197933abaa8";
export const MODEL_FILES = Object.freeze([
  ["config.json", 2248, "d1d347fdb422e6347c2f843a90d375aa67ea3f4b3e20d2c3075f9a9f6243685b"],
  ["generation_config.json", 3776, "3bba359e33fdd6dc1c10f71846a477d339b0242f462f70ea1dd73274caa38d05"],
  ["preprocessor_config.json", 339, "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"],
  ["tokenizer.json", 2480466, "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566"],
  ["tokenizer_config.json", 282683, "2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce"],
  ["onnx/encoder_model_quantized.onnx", 23200850, "3e345e977b55620a37c0c2b2af0644e019afdfad562dcf71eb929bb7274285f9"],
  ["onnx/decoder_model_merged_quantized.onnx", 53707539, "a6beb6baabb66f00b6a686d828c95ffca6146d51900cbad0266cad38f64cf861"],
]);

export function modelUrl(source, path) {
  if (source === "modelscope") {
    const query = new URLSearchParams({ Revision: "master", FilePath: path });
    return `https://modelscope.cn/api/v1/models/${MODEL}/repo?${query}`;
  }
  return `https://huggingface.co/${MODEL}/resolve/${REVISION}/${path}`;
}

export async function verifyModelBytes([path, size, checksum], bytes) {
  if (bytes.byteLength === size) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hex = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
    if (hex === checksum) return bytes;
  }
  throw new Error("Model integrity check failed for " + path);
}

export async function downloadModelFile(source, file, onBytes, fetchFile = fetch) {
  const [path, size] = file;
  const response = await fetchFile(modelUrl(source, path), {
    credentials: "omit",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) throw new Error("Model download HTTP " + response.status);
  const bytes = new Uint8Array(size);
  const reader = response.body.getReader();
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (loaded + value.length > size) {
        void reader.cancel().catch(() => {});
        throw new Error("Unexpected model size for " + path);
      }
      bytes.set(value, loaded);
      loaded += value.length;
      onBytes?.(loaded);
    }
  } finally {
    reader.releaseLock();
  }
  return verifyModelBytes(file, bytes.subarray(0, loaded));
}
