import { AutoTokenizer, env as transformersEnv } from "@huggingface/transformers";
import * as ort from "onnxruntime-web";

const MODEL_ID = "cstr/awesome-align-onnx-int8";
const REVISION = "e803a2f501474044099b539160aaca461976ecd0";
const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/model.onnx`;
const CACHE_NAME = "hovergloss-word-aligner-v1";

ort.env.wasm.wasmPaths = new URL("./", import.meta.url).href;
ort.env.wasm.numThreads = 1;
// Cached tokenizer files must remain readable when align() requests local_files_only.
transformersEnv.allowLocalModels = true;
transformersEnv.useBrowserCache = true;

let loaded = null;
let loading = null;

async function getModel(localOnly) {
  if (loaded) return loaded;
  if (loading) return loading;
  loading = Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID, { revision: REVISION, local_files_only: localOnly }),
    modelBytes(localOnly)
  ]).then(async ([tokenizer, bytes]) => {
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    loaded = { tokenizer, session };
    return loaded;
  }).finally(() => { loading = null; });
  return loading;
}

async function modelBytes(localOnly) {
  const cache = await caches.open(CACHE_NAME);
  let response = await cache.match(MODEL_URL);
  if (!response) {
    if (localOnly) throw new Error("对齐模型缓存不存在，请在设置中重新下载");
    response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`对齐模型下载失败（${response.status}）`);
    await cache.put(MODEL_URL, response.clone());
  }
  return new Uint8Array(await response.arrayBuffer());
}

function feed(session, tokenizer, text) {
  const encoded = tokenizer(text, { truncation: true, max_length: 128 });
  const inputs = {};
  for (const name of session.inputNames) {
    const tensor = encoded[name];
    if (!tensor) throw new Error(`对齐模型缺少输入：${name}`);
    const data = tensor.data instanceof BigInt64Array
      ? tensor.data
      : BigInt64Array.from(tensor.data, (value) => BigInt(value));
    inputs[name] = new ort.Tensor("int64", data, tensor.dims);
  }
  return inputs;
}

export async function prepare() {
  await getModel(false);
  return { ready: true, model: MODEL_ID };
}

export async function align(payload) {
  const sourceText = String(payload?.context || "").slice(0, 500);
  const targetText = String(payload?.sentenceTranslation || "").slice(0, 500);
  if (!sourceText || !targetText || !Number.isInteger(payload?.targetStart) || !Number.isInteger(payload?.targetEnd)) return null;
  const { tokenizer, session } = await getModel(true);
  const sourceOutput = await session.run(feed(session, tokenizer, sourceText));
  const targetOutput = await session.run(feed(session, tokenizer, targetText));
  return globalThis.HoverGlossLocalAlignmentCore.choose({
    sourceText, targetText, targetStart: payload.targetStart, targetEnd: payload.targetEnd,
    tokenizer, sourceVectors: Object.values(sourceOutput)[0], targetVectors: Object.values(targetOutput)[0]
  });
}
