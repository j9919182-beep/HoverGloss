"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const data = {};
let failWrite = false;
const sandbox = {
  URL, TextEncoder, crypto,
  chrome: { storage: { local: {
    async get(key) { return structuredClone({ [key]: data[key] }); },
    async set(value) { if (failWrite) throw new Error("quota"); Object.assign(data, structuredClone(value)); }
  } } }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../learning-store.js"), "utf8"), sandbox);
const store = sandbox.HoverGlossLearningStore;
const sample = { term: "prime", meaning: "主要的；首要的", meaningLabel: "单词常见义", uncertain: true,
  phrase: "prime minister", phraseTranslation: "总理", context: "The prime minister spoke.",
  sentenceTranslation: "总理发表了讲话。", origin: { type: "pdf", title: "Magazine.pdf", fingerprint: "aaaaaaaa", page: 5 } };
async function run() {
  const results = await Promise.all([store.save(sample), store.save(sample), store.save({ ...sample, context: "A prime example." })]);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  assert.equal((await store.list()).length, 2, "Concurrent additions must not lose a record");
  const id = results[0].entry.id;
  assert.equal(results[0].entry.meaning, "主要的；首要的", "A phrase translation must not replace the word meaning");
  assert.equal(results[0].entry.uncertain, true);
  assert.equal(results[0].entry.origin.page, 5);
  await store.edit(id, { meaning: "首要的", notes: "职称中的用法" });
  assert.equal((await store.list()).find((entry) => entry.id === id).uncertain, true, "Editing alone does not confirm an uncertain sense");
  await store.edit(id, { meaning: "首要的", notes: "已核对", confirmed: true });
  assert.equal((await store.list()).find((entry) => entry.id === id).uncertain, false);
  const duplicate = await store.save(sample);
  assert.equal(duplicate.entry.meaning, "首要的", "Duplicate capture must preserve user edits and reviews");
  // Upgrade an old word-only record in place, preserving manual edits and scheduling.
  const wordOnly = (await store.save({ ...sample, term: "minister", phrase: "", phraseTranslation: "" })).entry;
  await store.edit(wordOnly.id, { meaning: "部长（已核对）", notes: "保留笔记", confirmed: true });
  const schedule = (await store.review(wordOnly.id, "remember")).entry;
  const supplemented = await store.save({ ...sample, term: "minister", meaning: "不应覆盖", phrase: "prime minister" });
  assert.equal(supplemented.entry.id, wordOnly.id); assert.equal(supplemented.updated, true);
  assert.equal(supplemented.entry.meaning, "部长（已核对）"); assert.equal(supplemented.entry.notes, "保留笔记");
  assert.equal(supplemented.entry.dueAt, schedule.dueAt); assert.equal(supplemented.entry.reviews, 1);
  assert.equal(supplemented.entry.uncertain, false); assert.equal(supplemented.entry.phrases[0].phrase, "prime minister");
  const repeatPair = await store.save({ ...sample, term: "minister" });
  assert.equal(repeatPair.updated, false); assert.equal(repeatPair.entry.phrases.length, 1);
  delete data.hoverglossLearningV1.entries.find((entry) => entry.id === wordOnly.id).phrases;
  const secondPair = await store.save({ ...sample, term: "minister", phrase: "foreign minister", phraseTranslation: "外交部长" });
  assert.equal(secondPair.entry.phrases.length, 2); assert.equal(secondPair.entry.phrase, "prime minister");
  assert.equal((await store.list()).filter((entry) => entry.term === "minister").length, 1);
  const fillers = Array.from({ length: 17 }, (_, index) => ({ phrase: "minister phrase " + index, phraseTranslation: "短语 " + index }));
  await store.save({ ...sample, term: "minister", phrases: fillers });
  const twentieth = await store.save({ ...sample, term: "minister", phrase: "chief minister", phraseTranslation: "首席部长" });
  assert.equal(twentieth.entry.phrases.length, 20, "The last slot must not be lost behind duplicate legacy pairs");
  assert.equal(twentieth.entry.phrases.at(-1).phrase, "chief minister");
  await assert.rejects(store.save({ ...sample, term: "minister", phrase: "health minister", phraseTranslation: "卫生部长" }), /20/);
  assert.equal((await store.list()).find((entry) => entry.id === wordOnly.id).phrases.length, 20);
  let reviewed;
  for (const days of [1, 3, 7, 14, 30, 30]) {
    reviewed = (await store.review(id, "remember")).entry;
    assert.equal(reviewed.dueAt - reviewed.lastReviewedAt, days * 86400000);
  }
  reviewed = (await store.review(id, "again")).entry;
  assert.equal(reviewed.stage, 0);
  assert.equal(reviewed.dueAt - reviewed.lastReviewedAt, 600000);
  assert.equal(reviewed.reviews, 7);
  const unsafe = await store.save({ ...sample, origin: { title: "web", url: "javascript:alert(1)" } });
  assert.equal(unsafe.entry.origin.url, "");
  const url = await store.save({ ...sample, origin: { url: "https://name:secret@example.test/article?q=1" } });
  assert.equal(url.entry.origin.url, "https://example.test/article?q=1");
  failWrite = true;
  await assert.rejects(store.save({ ...sample, term: "failure" }), /quota/);
  failWrite = false;
  await store.save({ ...sample, term: "recovery" });
  assert.equal((await store.list()).some((entry) => entry.term === "failure"), false);
  await store.remove(id);
  assert.equal((await store.list()).some((entry) => entry.id === id), false);
  await assert.rejects(store.review(id, "remember"), /不存在/);
  const englishRecord = await store.save({ ...sample, term: "pain", meaning: "疼痛" });
  const englishBefore = JSON.stringify(await store.list());
  const frenchRecord = await store.save({ ...sample, term: "pain", meaning: "面包", language: "fr", context: "Le pain est frais." });
  assert.equal((await store.list("fr")).length, 1);
  assert.equal((await store.list("fr"))[0].language, "fr");
  await store.edit(frenchRecord.entry.id, { meaning: "面包", notes: "法语名词" }, "fr");
  await store.review(frenchRecord.entry.id, "remember", "fr");
  assert.equal((await store.list("fr"))[0].stage, 1);
  await assert.rejects(store.edit(englishRecord.entry.id, { meaning: "不该覆盖" }, "fr"), /不存在/);
  await store.remove(frenchRecord.entry.id, "fr");
  assert.equal((await store.list("fr")).length, 0);
  assert.equal(JSON.stringify(await store.list()), englishBefore, "French save/edit/review/delete must leave English records byte-for-byte unchanged");
  console.log("learning storage, separate French records, deduplication, source and review tests passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
