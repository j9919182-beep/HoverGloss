"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../local-asr-runtime.mjs"), "utf8");
const turn = () => new Promise((resolve) => setImmediate(resolve));
function harness(gpu = false) {
  const sent = [], loads = [], inferences = [], cacheNames = []; let listener, finish;
  const env = { backends: { onnx: { wasm: {} } } };
  const transcriber = (samples, options) => { inferences.push({ samples, options }); return new Promise((resolve) => { finish = resolve; }); };
  const context = {
    env, URL, Float32Array, performance: { now: () => 123 }, navigator: gpu ? { gpu: { requestAdapter: async () => ({}) } } : {},
    caches: { open: async (name) => { cacheNames.push(name); return { match: async () => null, put: async () => {} }; } },
    pipeline: async (...args) => { loads.push(args); return transcriber; },
    self: { postMessage: (message) => sent.push(message), addEventListener: (_name, fn) => { listener = fn; } }
  };
  vm.runInNewContext(source.replace(/^import[^\n]+\n/, "").replaceAll("import.meta.url", '"extension://test/vendor/local-asr/asr-worker.mjs"'), context);
  return { env, sent, loads, inferences, cacheNames, message: (data) => listener({ data }), finish: () => finish({ text: "Spoken English" }) };
}
(async () => {
  const cpu = harness(); assert.equal(cpu.loads.length, 0, "loading worker alone never downloads a model");
  await cpu.message({ type: "transcribe", id: 1, samples: new Float32Array(16000) });
  assert.equal(cpu.sent.at(-1).type, "error"); assert.equal(cpu.loads.length, 0);
  await cpu.message({ type: "prepare", mode: "cpu" });
  assert.equal(cpu.loads[0][0], "automatic-speech-recognition");
  assert.equal(cpu.loads[0][1], "onnx-community/whisper-tiny.en");
  assert.match(cpu.loads[0][2].revision, /^[a-f0-9]{40}$/);
  assert.equal(cpu.loads[0][2].device, "wasm"); assert.equal(cpu.loads[0][2].dtype, "q8");
  assert.equal(cpu.env.allowRemoteModels, false, "recognition must not fetch additional remote model data");
  assert.match(cpu.env.backends.onnx.wasm.wasmPaths, /^extension:\/\/test\/vendor\/local-aligner\/$/);
  assert.equal(cpu.env.backends.onnx.wasm.numThreads, 1); assert.equal(cpu.env.backends.onnx.wasm.proxy, false);
  await cpu.env.customCache.match("model"); assert.deepEqual(cpu.cacheNames, ["hovergloss-asr-v1"]);
  const active = cpu.message({ type: "transcribe", id: 2, samples: new Float32Array(16000) }); await turn();
  assert.equal(cpu.inferences.length, 1); assert.equal(cpu.inferences[0].options.max_new_tokens, 128);
  await cpu.message({ type: "transcribe", id: 3, samples: new Float32Array(16000) });
  await cpu.message({ type: "transcribe", id: 4, samples: new Float32Array(16000) });
  assert.equal(cpu.inferences.length, 1, "rejected busy jobs must not clear another job's busy state");
  cpu.finish(); await active; assert.equal(cpu.sent.at(-1).text, "Spoken English");
  await cpu.message({ type: "transcribe", id: 5, samples: new Float32Array(160000) });
  assert.equal(cpu.inferences.length, 1);
  const absentGPU = harness(); await absentGPU.message({ type: "prepare", mode: "gpu" });
  assert.equal(absentGPU.loads.length, 0); assert.match(absentGPU.sent.at(-1).message, /WebGPU/);
  const gpu = harness(true); await gpu.message({ type: "prepare", mode: "gpu" });
  assert.equal(gpu.loads[0][2].device, "webgpu"); assert.equal(gpu.loads[0][2].dtype, "fp32");
  assert.doesNotMatch(source, /fetch\s*\(|sendMessage\s*\(|getUserMedia|MediaRecorder/);
  console.log("ASR worker controls and local configuration: passed (model inference mocked)");
})().catch((error) => { console.error(error); process.exitCode = 1; });
