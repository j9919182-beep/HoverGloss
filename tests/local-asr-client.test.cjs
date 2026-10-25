"use strict";
const assert = require("node:assert/strict");
const { Client } = require("../local-asr-client.js");
async function main() {
  const workers = [], results = [], statuses = [], timers = new Map(); let timerId = 0;
  const client = new Client({
    createWorker() { const worker = { messages: [], postMessage(message, transfer) { this.messages.push(message); if (transfer) assert.equal(transfer[0], message.samples.buffer); }, terminate() { this.terminated = true; } }; workers.push(worker); return worker; },
    onResult: (result) => results.push(result), onStatus: (message) => statuses.push(message),
    setTimer: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimer: (id) => timers.delete(id)
  });
  assert.equal(workers.length, 0);
  const prepared = client.prepare("cpu"); let worker = workers.at(-1);
  assert.equal(worker.messages[0].type, "prepare"); assert.equal(worker.messages[0].mode, "cpu");
  worker.onmessage({ data: { type: "progress", message: "download 50%" } }); assert.equal(statuses.at(-1), "download 50%");
  worker.onmessage({ data: { type: "ready" } }); await prepared; assert.equal(client.ready, true);
  const pcm = () => new Float32Array(16000);
  client.recognize(pcm(), 1); client.recognize(pcm(), 2); client.recognize(pcm(), 3);
  assert.equal(worker.messages.length, 2, "only one inference may be in flight");
  assert.equal(client.pending.time, 3); assert.match(statuses.at(-1), /积压/);
  const firstId = worker.messages[1].id;
  worker.onmessage({ data: { type: "result", id: firstId, text: "First", elapsed: 500 } });
  assert.equal(results[0].time, 1); assert.equal(worker.messages.length, 3);
  client.cancel(); worker.onmessage({ data: { type: "result", id: worker.messages[2].id, text: "late after stop" } });
  assert.equal(results.length, 1); assert.equal(timers.size, 0);
  client.recognize(pcm(), 4); worker.onmessage({ data: { type: "error", id: worker.messages.at(-1).id, message: "one segment failed" } });
  assert.equal(statuses.at(-1), "one segment failed"); assert.equal(client.ready, true);
  const count = worker.messages.length; assert.equal(worker.messages.length, count, "no automatic retry");
  client.recognize(pcm(), 5); timers.values().next().value();
  assert.equal(worker.terminated, true); assert.equal(client.ready, false); assert.match(statuses.at(-1), /30 秒/);
  const retry = client.prepare("gpu"); worker = workers.at(-1); worker.onmessage({ data: { type: "error", message: "WebGPU unavailable" } });
  await assert.rejects(retry, /WebGPU unavailable/); assert.equal(worker.terminated, true);
  const canceled = client.prepare("cpu"); worker = workers.at(-1); client.dispose(); await assert.rejects(canceled, /取消/);
  worker.onmessage({ data: { type: "ready" } }); assert.equal(client.ready, false, "disposed worker cannot become ready later");
  assert.equal(timers.size, 0);
  console.log("local ASR worker client: passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
