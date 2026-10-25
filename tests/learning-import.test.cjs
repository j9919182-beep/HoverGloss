"use strict";
const assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs"), crypto = require("node:crypto");
const data = {}; let writes = 0, failWrite = false;
const context = { TextEncoder, crypto, URL, chrome: { storage: { local: {
  get: async (key) => structuredClone({ [key]: data[key] }),
  set: async (value) => { if (failWrite) throw new Error("quota"); writes++; Object.assign(data, structuredClone(value)); }
} } } };
vm.runInNewContext(fs.readFileSync(require.resolve("../learning-store.js"), "utf8"), context);
const store = context.HoverGlossLearningStore;
const sample = { term: "prime", meaning: "首要的", context: "The prime minister spoke.", notes: "备份笔记", language: "en", uncertain: true,
  phrases: [{ phrase: "prime minister", phraseTranslation: "总理" }], origin: { type: "pdf", title: "Book.pdf", fingerprint: "test-book", page: 5 },
  reviews: 4, stage: 3, dueAt: 123456, createdAt: 100, updatedAt: 200, lastReviewedAt: 300 };
const backup = (entries, language = "en") => ({ app: "HoverGloss", version: 1, language, entries });
(async () => {
  const preview = await store.previewImport(backup([sample]));
  assert.equal(preview.added, 1); assert.equal(writes, 0, "Preview must not write");
  await store.importLibrary(backup([sample]));
  const saved = (await store.list())[0];
  assert.equal(saved.notes, sample.notes); assert.equal(saved.stage, 3); assert.equal(saved.dueAt, 123456); assert.equal(saved.uncertain, true);
  const duplicate = { ...sample, meaning: "不要覆盖", notes: "不要覆盖", phrase: "prime example", phraseTranslation: "典型例子" };
  const result = await store.importLibrary(backup([duplicate]));
  assert.equal(result.added, 0); assert.equal(result.supplemented, 1);
  const merged = (await store.list())[0];
  assert.equal(merged.id, saved.id); assert.equal(merged.meaning, saved.meaning); assert.equal(merged.notes, saved.notes); assert.equal(merged.reviews, 4);
  assert.equal(merged.phrases.length, 2);
  assert.equal((await store.importLibrary(backup([sample]))).added, 0);
  const before = JSON.stringify(data), beforeWrites = writes;
  await assert.rejects(store.importLibrary(backup([{ ...sample, language: "fr" }], "fr"), "en"), /语言/);
  await assert.rejects(store.importLibrary(backup([sample, { ...sample, term: "" }])));
  await assert.rejects(store.importLibrary({ app: "other", version: 1, entries: [] }));
  assert.equal(JSON.stringify(data), before); assert.equal(writes, beforeWrites, "Malformed imports are atomic");
  const french = { ...sample, term: "pain", meaning: "面包", context: "Le pain est frais.", language: "fr" };
  await store.importLibrary(backup([french], "fr"), "fr");
  assert.equal((await store.list("fr"))[0].language, "fr"); assert.equal((await store.list()).length, 1);
  failWrite = true; const frozen = JSON.stringify(data);
  await assert.rejects(store.importLibrary(backup([{ ...sample, term: "new" }])), /quota/);
  assert.equal(JSON.stringify(data), frozen); failWrite = false;
  await store.importLibrary(backup([{ ...sample, term: "recovery" }]));
  data.hoverglossLearningV1.entries = Array.from({ length: 1000 }, (_, i) => ({ ...saved, term: `term-${i}` }));
  const full = JSON.stringify(data);
  await assert.rejects(store.importLibrary(backup([{ ...sample, term: "overflow" }])), /1000/);
  assert.equal(JSON.stringify(data), full);
  console.log("Learning import preview/restore, language isolation, duplicate merge, progress preservation, malformed/capacity/quota rollback passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
