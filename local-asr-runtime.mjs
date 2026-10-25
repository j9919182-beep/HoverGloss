import { pipeline, env } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-tiny.en";
const REVISION = "3a6d57ee9c665610614068e8592d8baee0188181";
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = {
  async match(key) { return (await caches.open("hovergloss-asr-v1")).match(key); },
  async put(key, value) { return (await caches.open("hovergloss-asr-v1")).put(key, value); }
};
// Runtime code/WASM stays packaged. Only model data is downloaded after explicit preparation.
env.backends.onnx.wasm.wasmPaths = new URL("../local-aligner/", import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
let transcriber = null, preparing = false, busy = false;
const send = (message) => self.postMessage(message);

self.addEventListener("message", async (event) => {
  const message = event.data;
  if (message?.type === "prepare") {
    if (preparing || transcriber) return;
    preparing = true;
    try {
      if (!["cpu", "gpu"].includes(message.mode)) throw new Error("未知运行方式");
      if (message.mode === "gpu" && (!navigator.gpu || !await navigator.gpu.requestAdapter())) throw new Error("当前设备没有可用 WebGPU，请选择 CPU 省资源模式后重新准备");
      const progress = new Map();
      transcriber = await pipeline("automatic-speech-recognition", MODEL, {
        revision: REVISION, device: message.mode === "gpu" ? "webgpu" : "wasm",
        dtype: message.mode === "gpu" ? "fp32" : "q8",
        progress_callback(info) {
          if (info.file && Number.isFinite(info.progress)) progress.set(info.file, Math.round(info.progress));
          const percent = info.file ? progress.get(info.file) : null;
          send({ type: "progress", message: percent === undefined || percent === null ? "正在准备本机语音模型…" : `${info.file.split("/").at(-1)} · ${percent}%` });
        }
      });
      env.allowRemoteModels = false;
      send({ type: "ready" });
    } catch (error) { send({ type: "error", message: `语音模型准备失败：${error?.message || error}` }); }
    finally { preparing = false; }
    return;
  }
  if (message?.type !== "transcribe" || !Number.isInteger(message.id)) return;
  if (busy) { send({ type: "error", id: message.id, message: "本机识别繁忙，本段已跳过" }); return; }
  try {
    if (!transcriber) throw new Error("请先主动准备本机语音模型");
    if (!(message.samples instanceof Float32Array) || message.samples.length < 5600 || message.samples.length > 144000) throw new Error("音频片段长度无效");
    busy = true;
    const started = performance.now();
    const result = await transcriber(message.samples, { return_timestamps: false, max_new_tokens: 128, num_beams: 1, do_sample: false });
    send({ type: "result", id: message.id, text: String(result.text || "").slice(0, 1200), elapsed: performance.now() - started });
  } catch (error) { send({ type: "error", id: message.id, message: `识别失败，本段已跳过：${error?.message || error}` }); }
  finally { busy = false; }
});
