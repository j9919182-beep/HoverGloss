"use strict";
const assert = require("node:assert/strict");
const api = require("../report-comparison.js");
const record = (id, word, sentence = "", phrase = "") => ({ id, context: "The word " + id + " is used.",
  target: "word", targetStart: 4, targetEnd: 8, topic: "", result: { translation: "词义" }, review: { word, sentence, phrase } });
const before = { datasetVersion: "one", extensionVersion: "0.9.4", records: [
  record("a", "wrong"), record("b", "correct"), record("c", ""), record("d", "wrong", "correct"),
  record("e", "correct"), { ...record("f", ""), error: "model unavailable" }, record("g", "phrase-only")] };
const after = { ...before, extensionVersion: "0.9.5", aiKey: "never-export", records: [
  record("a", "correct"), record("b", "wrong"), record("c", "correct"), record("d", "correct", "wrong"),
  record("e", "correct"), record("f", ""), record("g", "correct")] };
const comparison = api.compare(before, after);
assert.equal(comparison.counts.improved, 1);
assert.equal(comparison.counts.regressed, 1);
assert.equal(comparison.counts.mixed, 1);
assert.equal(comparison.counts.unchanged, 1);
assert.equal(comparison.counts.pending, 2, "Missing judgments and phrase-only outcomes cannot establish word accuracy improvements");
assert.equal(comparison.counts.error, 1);
assert.ok(!JSON.stringify(comparison).includes("never-export"));
const changed = api.compare({ ...before, records: [record("x", "wrong")] },
  { ...after, records: [{ ...record("x", "correct"), context: "The word x has changed." }] });
assert.equal(changed.matched, 0, "Matching IDs do not make changed source sentences comparable");
assert.equal(changed.onlyOld, 1);
assert.equal(changed.onlyNew, 1);
assert.throws(() => api.validate({ ...before, records: [before.records[0], before.records[0]] }), /重复/);
assert.throws(() => api.validate({ ...before, records: [{ ...before.records[0], targetEnd: 9000 }] }), /位置/);
assert.throws(() => api.validate({ ...before, records: [{ ...before.records[0], error: {} }] }), /格式/);
assert.equal(api.compare(before, { ...after, datasetVersion: "two" }).warnings.length, 1);
console.log("Human-only improvements, regressions, incomplete review, identity matching and report validation passed");
