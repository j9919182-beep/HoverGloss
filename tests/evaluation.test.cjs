"use strict";
const assert = require("node:assert/strict");
const dataset = require("../evaluation-cases.js");
const core = require("../evaluation-core.js");
const { refine } = require("../context-aligner.js");
assert.equal(dataset.cases.length, 100);
assert.equal(new Set(dataset.cases.map((item) => item.id)).size, 100);
for (const item of dataset.cases) {
  assert.equal(item.context.slice(item.targetStart, item.targetEnd).toLowerCase(), item.target.toLowerCase());
  assert.ok(item.expected.words.length || item.expected.phraseMeanings.length);
  if (item.expected.phrase) assert.ok(item.context.toLowerCase().includes(item.expected.phrase.toLowerCase()));
}
async function run() {
  const item = dataset.cases.find((item) => item.target === "prime");
  const payloads = [];
  const record = await core.runCase(item, {
    translate: async (payload) => { payloads.push(payload); return { translation: "质数", isolatedTranslation: "质数", sentenceTranslation: "总理在会议上发言。", source: "browser" }; },
    candidates: () => [], refine,
    align: async () => ({ ok: true, result: { translation: "总理", phrase: "prime minister",
      phraseTranslation: "总理", sentenceTranslation: "总理在会议上发言。", contextReview: "phrase-only", source: "browser-phrase-align" } })
  });
  assert.equal(record.assessment.wordMatch, false);
  assert.equal(record.assessment.phraseMatch, true);
  assert.equal(record.assessment.suggestion, "phrase-match");
  assert.equal(record.raw.translation, "质数");
  assert.ok(payloads.every((payload) => !payload.expected), "Gold answers must never enter translation requests");
  const summary = core.summarize([record]);
  assert.equal(summary.referenceMatches, 1);
  assert.equal(summary.reviewedWords, 0, "Automatic reference matches are not human-verified accuracy");
  record.review.word = "phrase-only";
  record.review.sentence = "correct";
  assert.equal(core.summarize([record]).reviewedWords, 0, "Phrase-only outcomes must not count as precise word successes");
  const unsupported = core.assess(item, { translation: "总理", confidence: .9 });
  assert.equal(unsupported.wordMatch, false, "Whole phrase translation without phrase provenance cannot be counted as the word meaning");
  console.log("100-case labels, target positions, phrase separation and honest review metrics passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
