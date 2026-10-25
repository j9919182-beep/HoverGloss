"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
class Element {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.listeners = {}; this.value = ""; this.textContent = ""; this.disabled = false; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  click() { return this.listeners.click?.(); }
}
function setup(names, scripts, extra = {}) {
  const ids = Object.fromEntries(names.map((id) => [id, new Element()])), blobs = [];
  const sandbox = { document: { getElementById: (id) => ids[id], createElement: (tag) => new Element(tag),
    createTextNode: (textContent) => ({ textContent }) }, Blob,
    setTimeout: (fn) => { fn(); }, window: { confirm: () => true },
    URL: { createObjectURL(blob) { blobs.push(blob); return "blob:test"; }, revokeObjectURL() {} }, ...extra };
  for (const file of scripts) vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox, { filename: file });
  return { ids, blobs };
}
const flatten = (node) => [node, ...(node.children || []).flatMap(flatten)];
const record = (judgment) => ({ id: "sample", context: "The European Commission voted.", target: "Commission",
  targetStart: 13, targetEnd: 23, topic: "", result: { translation: judgment === "correct" ? "委员会" : "佣金" }, review: { word: judgment } });
const report = (version, judgment) => ({ datasetVersion: "1", extensionVersion: version, records: [record(judgment)], aiKey: "must-not-export" });
async function run() {
  const { ids, blobs } = setup(["before", "after", "beforeName", "afterName", "status", "filter", "exportComparison", "summary", "warnings", "results"],
    ["report-comparison.js", "comparison.js"]);
  async function importReport(side, data) { ids[side].files = [{ name: side + ".json", size: 100, text: async () => JSON.stringify(data) }]; await ids[side].listeners.change(); }
  await importReport("before", report("0.9.4", "wrong"));
  await importReport("after", report("0.9.5", "correct"));
  assert.equal(ids.exportComparison.disabled, false);
  assert.match(ids.summary.textContent, /改善 1/);
  assert.equal(ids.results.children.length, 1);
  assert.ok(flatten(ids.results).some((item) => /仍待确认：句意、短语/.test(item.textContent)));
  ids.filter.value = "regressed"; ids.filter.listeners.change(); assert.equal(ids.results.children.length, 0);
  ids.exportComparison.click();
  const exported = await blobs[0].text(); assert.ok(!exported.includes("must-not-export"));
  assert.equal(JSON.parse(exported).counts.improved, 1);
  await importReport("after", { invalid: true });
  assert.equal(ids.exportComparison.disabled, true); assert.equal(ids.results.children.length, 0);
  assert.match(ids.status.textContent, /无法读取报告/);
  ids.exportComparison.click(); assert.equal(blobs.length, 1, "Invalid import cannot export stale comparison");
  ids.after.files = [{ size: 2 * 1024 * 1024 + 1, text: () => { throw new Error("must not read oversized file"); } }];
  await ids.after.listeners.change(); assert.match(ids.status.textContent, /2 MB/);
  let finishOld;
  ids.after.files = [{ name: "old.json", size: 100, text: () => new Promise((resolve) => { finishOld = resolve; }) }];
  const oldImport = ids.after.listeners.change();
  await importReport("after", report("0.9.6", "wrong"));
  finishOld(JSON.stringify(report("stale-version", "correct"))); await oldImport;
  assert.match(ids.afterName.textContent, /0.9.6/); assert.equal(JSON.parse(await blobs[0].text()).afterVersion, "0.9.5");

  let entries = [{ ...record("wrong"), id: "feedback-1", issue: "word", correction: "委员会", origin: { type: "pdf", title: "book.pdf", page: 5 }, extensionVersion: "0.9.5" },
    { ...record("wrong"), id: "feedback-2", issue: "phrase", correction: "", origin: { type: "web", title: "article" }, extensionVersion: "0.9.5" }];
  const calls = [];
  const manager = setup(["refresh", "exportFeedback", "filter", "status", "entries"], ["feedback.js"], {
    chrome: { runtime: { async sendMessage(message) { calls.push(message); if (message.type === "feedbackDelete") {
      entries = entries.filter((entry) => entry.id !== message.id); return { ok: true }; }
      return { ok: true, entries }; } } }
  });
  await new Promise(setImmediate);
  assert.equal(manager.ids.entries.children.length, 2);
  assert.ok(flatten(manager.ids.entries).some((item) => item.tagName === "mark" && item.textContent === "Commission"));
  manager.ids.filter.value = "word"; manager.ids.filter.listeners.change(); assert.equal(manager.ids.entries.children.length, 1);
  manager.ids.exportFeedback.click(); assert.equal(JSON.parse(await manager.blobs[0].text()).entries.length, 2, "Export retains all saved entries despite filter");
  await flatten(manager.ids.entries).find((item) => item.tagName === "button").click();
  assert.equal(calls.at(-1).type, "feedbackDelete"); assert.equal(calls.at(-1).id, "feedback-1");
  assert.equal(manager.ids.entries.children.length, 0);
  manager.ids.filter.value = ""; await manager.ids.refresh.click(); assert.equal(manager.ids.entries.children.length, 1);
  console.log("Report import, invalid/stale input, human-only comparison export and feedback management UI passed (simulated DOM)");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
