"use strict";
const assert = require("node:assert/strict");
const ocr = require("../pdf-ocr.js");
const copy = require("../pdf-clean-copy.js");

assert.deepEqual(ocr.normalizedRect({ x: .8, y: .9 }, { x: -.1, y: .2 }), { x: 0, y: .2, width: .8, height: .7 });
const plan = ocr.renderPlan({ width: 600, height: 800 }, { x: .5, y: .25, width: .5, height: .5 });
assert.deepEqual(plan, { scale: 3, left: 900, top: 600, width: 900, height: 1200 });
const huge = ocr.renderPlan({ width: 10000, height: 10000 });
assert.ok(huge.width * huge.height <= 16000000);
assert.throws(() => ocr.renderPlan({ width: 600, height: 800 }, { x: -1, y: 0, width: 1, height: 1 }));
const preview = ocr.toPreview({ text: "First line\nnext line\n\nNew paragraph", confidence: 90, blocks: [{ paragraphs: [
  { lines: [{ text: "First line", bbox: { x0: 10, y0: 10, x1: 110, y1: 20 } }, { text: "next line", bbox: { x0: 10, y0: 23, x1: 100, y1: 33 } }] },
  { lines: [{ text: "New paragraph", bbox: { x0: 10, y0: 36, x1: 110, y1: 46 } }] }
] }] }, 200);
assert.equal(copy.prepare(preview.textContent, preview.viewport).text, "First line next line\n\nNew paragraph");
assert.equal(preview.ocr, true);
assert.equal(preview.layoutFallback, false);
assert.equal(ocr.toPreview({ text: "Only text\n\nNext paragraph" }, 200).layoutFallback, true);
assert.equal(ocr.toPreview({ text: "" }, 200).textContent.items.length, 0);
const located = { blocks: [{ paragraphs: [
  { lines: [{ words: [{ text: "Market", bbox: { x0: 30, y0: 30, x1: 90, y1: 60 } },
    { text: "value.", bbox: { x0: 100, y0: 30, x1: 160, y1: 60 } }] }] },
  { lines: [{ words: [{ text: "Report", bbox: { x0: 30, y0: 150, x1: 90, y1: 180 } }] }] }
] }] };
const reading = ocr.readingLayer(located, plan, 1);
assert.deepEqual(reading.boxes[0], { x: 310, y: 210, width: 20, height: 10 }, "Crop offsets must map back to the original page");
assert.equal(reading.contexts[1].text, "Market value.");
assert.equal(reading.contexts[1].offset, 7);
assert.equal(reading.contexts[2].text, "Report", "Separate OCR paragraphs must not leak into context");
assert.equal(ocr.readingLayer(located, plan, 2).boxes[0].x, 620);
assert.equal(ocr.readingLayer({ text: "Unpositioned text" }, plan, 1).boxes.length, 0, "Never invent positions for plain OCR text");

class FakeWorker {
  static workers = [];
  constructor(url) { this.url = url; this.messages = []; this.terminated = false; FakeWorker.workers.push(this); }
  postMessage(packet) {
    this.messages.push(packet);
    if (FakeWorker.hang) return;
    queueMicrotask(() => {
      if (this.terminated) return;
      if (FakeWorker.fail === packet.action) this.onmessage({ data: { ...packet, status: "reject", data: "bad" } });
      else this.onmessage({ data: { ...packet, status: "resolve", data: packet.action === "recognize" ? { text: "Hello" } : {} } });
    });
  }
  terminate() { this.terminated = true; }
}
async function run() {
  const client = ocr.createClient({ getURL: (name) => "chrome-extension://test/" + name, WorkerClass: FakeWorker });
  const result = await client.recognize(new Uint8Array([1]), "chi_sim+eng", { region: true });
  assert.equal(result.text, "Hello");
  const first = FakeWorker.workers[0];
  assert.equal(first.terminated, true, "Release OCR memory after each operation");
  assert.deepEqual(first.messages.map((message) => message.action), ["load", "loadLanguage", "initialize", "setParameters", "recognize"]);
  assert.match(first.messages[0].payload.options.corePath, /^chrome-extension:/);
  assert.equal(first.messages[1].payload.options.cacheMethod, "none");
  assert.equal(first.messages[3].payload.params.tessedit_pageseg_mode, "6");
  await assert.rejects(client.recognize(new Uint8Array([1]), "unknown"));
  FakeWorker.fail = "loadLanguage";
  await assert.rejects(client.recognize(new Uint8Array([1])), /识别失败/);
  assert.equal(FakeWorker.workers.at(-1).terminated, true);
  FakeWorker.fail = null;
  FakeWorker.hang = true;
  const cancelled = client.recognize(new Uint8Array([1]));
  client.cancel();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(FakeWorker.workers.at(-1).terminated, true, "Cancel even during engine initialization");
  const timed = ocr.createClient({ getURL: (name) => name, WorkerClass: FakeWorker, timeoutMs: 5 });
  await assert.rejects(timed.recognize(new Uint8Array([1])), /超时/);
  assert.equal(FakeWorker.workers.at(-1).terminated, true);
  FakeWorker.hang = false;
  assert.equal((await client.recognize(new Uint8Array([1]))).text, "Hello", "Retry succeeds after cancellation/failure");
  console.log("PDF OCR crop bounds, paragraph mapping, offline paths, cancellation, timeout, failures and retry tests passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
