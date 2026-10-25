"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
class Element {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.listeners = {}; this.value = ""; this.textContent = ""; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute() {}
  click() { return this.listeners.click?.(); }
}
const ids = Object.fromEntries(["prepare", "alignment", "modelNote", "group", "run", "stop", "reset",
  "export", "status", "summary", "filter", "results"].map((id) => [id, new Element()]));
const stored = { aiKey: "test-only-never-export" }, calls = [], blobs = [];
const sandbox = {
  document: { getElementById: (id) => ids[id], createElement: (tag) => new Element(tag),
    createTextNode: (text) => ({ textContent: text }) },
  chrome: { storage: { local: { async get(defaults) { return { ...defaults, ...stored }; },
    async set(value) { Object.assign(stored, value); } } }, runtime: { getManifest: () => ({ version: "test-version" }) } },
  navigator: { userAgent: "simulated-browser-not-real-model" },
  Translator: { async availability() { return "available"; }, async create() { return { async translate(text) { calls.push(text); return "测试译文：" + text; } }; } },
  window: { confirm: () => true }, structuredClone, setTimeout, clearTimeout, performance, Blob,
  URL: { createObjectURL(blob) { blobs.push(blob); return "blob:test"; }, revokeObjectURL() {} }
};
for (const file of ["glossary.js", "browser-translator.js", "context-aligner.js", "local-alignment-core.js",
  "evaluation-cases.js", "evaluation-core.js", "evaluation.js"]) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox, { filename: file });
}
const flatten = (node) => [node, ...(node.children || []).flatMap(flatten)];
async function run() {
  await new Promise(setImmediate);
  assert.equal(ids.run.disabled, true);
  await ids.prepare.listeners.click();
  assert.equal(ids.run.disabled, false);
  ids.group.value = "多义词";
  await ids.run.listeners.click();
  assert.equal(stored.accuracyEvaluationRun.records.length, 10);
  assert.equal(stored.accuracyEvaluationRun.summary, undefined);
  assert.equal(stored.accuracyEvaluationRun.extensionVersion, "test-version");
  assert.match(ids.summary.textContent, /人工复核 0/);
  const selects = flatten(ids.results).filter((node) => node.tagName === "select");
  selects[0].value = "correct"; selects[0].listeners.change();
  selects[1].value = "wrong"; selects[1].listeners.change();
  await new Promise(setImmediate);
  assert.equal(stored.accuracyEvaluationRun.records[0].review.word, "wrong");
  assert.match(ids.summary.textContent, /人工复核 1/);
  ids.export.listeners.click();
  const exportedText = await blobs[0].text();
  const exported = JSON.parse(exportedText);
  assert.equal(exported.records.length, 10);
  assert.equal(exported.records[0].context, "The investment generated a high return.");
  assert.equal(exported.records[0].review.word, "wrong");
  const comparison = require("../report-comparison.js");
  assert.equal(comparison.validate(exported).records.length, 10, "Actual evaluation exports must be importable");
  assert.ok(!exportedText.includes("test-only-never-export"), "Reports must not include unrelated settings or credentials");
  const previousCalls = calls.length;
  await ids.run.listeners.click();
  assert.equal(calls.length, previousCalls, "Completed cases are retained on resume");
  await ids.reset.listeners.click();
  assert.equal(stored.accuracyEvaluationRun.records.length, 0);
  console.log("Evaluation preparation, grouped run, local persistence, manual review and resume UI passed (simulated model)");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
