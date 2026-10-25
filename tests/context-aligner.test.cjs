"use strict";

const assert = require("node:assert/strict");
const { refine } = require("../context-aligner.js");
const { getGlossaryCandidates } = require("../glossary.js");

let result = refine({
  translation: "返回",
  sentenceTranslation: "这项投资产生了很高的收益。",
  source: "browser",
  phrase: "return"
}, {
  target: "return",
  candidates: [
    { translation: "收益", source: "contextual", matched: true, pos: "n." },
    { translation: "返回", source: "contextual-candidate", matched: false, pos: "v." }
  ]
});
assert.equal(result.translation, "收益");
assert.equal(result.isolatedTranslation, "返回", "Context selection must retain the raw isolated model output");
assert.equal(result.alignedChineseSpan, "收益");
assert.equal(result.source, "browser-context");
assert.ok(result.confidence >= 0.9);

result = refine({
  translation: "返回",
  sentenceTranslation: "该函数将返回一个值。",
  source: "browser"
}, {
  target: "return",
  candidates: [
    { translation: "收益", source: "contextual-candidate", matched: false },
    { translation: "返回", source: "contextual", matched: true, pos: "v." }
  ]
});
assert.equal(result.translation, "返回");
assert.equal(result.alignedChineseSpan, "返回");

result = refine({
  translation: "返回",
  sentenceTranslation: "资产收益率有所提高。",
  source: "browser"
}, {
  target: "return",
  candidates: [
    { translation: "资产收益率", source: "phrase", phrase: "return on assets", phraseTranslation: "资产收益率", matched: true, pos: "n." }
  ]
});
assert.equal(result.translation, "资产收益率");
assert.equal(result.phrase, "return on assets");
assert.equal(result.alignedChineseSpan, "", "A known whole-phrase translation is not proof of the hovered word meaning");
assert.equal(result.contextReview, "phrase-only");

result = refine({ translation: "发布", sentenceTranslation: "", source: "browser" }, {
  target: "issue",
  candidates: [{ translation: "问题", source: "contextual-candidate" }]
});
assert.equal(result.translation, "发布");
assert.ok(result.confidence < 0.7);

result = refine({ translation: "钥匙", sentenceTranslation: "关键指标有所改善。", source: "browser" }, {
  target: "key",
  candidates: [{ translation: "键", source: "contextual-candidate", matched: false }]
});
assert.ok(result.confidence < 0.7, "A single Chinese character inside another word is weak evidence");

result = refine({
  translation: "佣金",
  sentenceTranslation: "欧盟委员会主席发表了讲话。",
  source: "browser"
}, {
  target: "Commission",
  candidates: [{
    translation: "委员会", phrase: "european commission", phraseTranslation: "欧盟委员会",
    source: "phrase", matched: true, pos: "n."
  }]
});
assert.equal(result.translation, "委员会");
assert.equal(result.phraseTranslation, "欧盟委员会");
assert.equal(result.alignedChineseSpan, "委员会");
assert.ok(result.confidence >= 0.85);

result = refine({ translation: "佣金", sentenceTranslation: "销售佣金有所增加。", source: "browser" }, {
  target: "commission", candidates: []
});
assert.equal(result.translation, "佣金", "The proper-name fix must not override the ordinary sense");

result = refine({ translation: "佣金", sentenceTranslation: "委员会调查了此案。", source: "browser" }, {
  target: "commission",
  candidates: getGlossaryCandidates("commission", "The commission investigated the case.", "")
});
assert.equal(result.translation, "委员会", "A sentence-supported alternate sense should beat an isolated word translation");

console.log("context aligner tests passed");

result = refine({ translation: "纲", sentenceTranslation: "这门课每周一上课。", source: "browser" }, {
  target: "class", context: "This class meets on Mondays.",
  candidates: [{ translation: "纲", source: "topic:动物学", matched: true }]
});
assert.ok(result.confidence < 0.7, "A topic cue absent from the sentence must not bypass local model review");
assert.ok(result.evidenceIssues.includes("not-in-sentence"));
result = refine({ translation: "纲", sentenceTranslation: "这门课每周一上课。", source: "browser" }, {
  target: "class", context: "This class meets on Mondays.",
  candidates: [{ translation: "纲", source: "topic:动物学", matched: true },
    { translation: "课", source: "contextual-candidate", matched: false }]
});
assert.equal(result.translation, "课", "A sentence-supported sense should outrank a contradictory topic cue without adding a word-specific rule");
assert.ok(result.confidence < 0.7, "A single Chinese character remains weak evidence even when it wins");
result = refine({ translation: "订单", sentenceTranslation: "客户订单决定处理顺序。", source: "browser" }, {
  target: "order", context: "The customer order determines the order of processing.",
  candidates: [{ translation: "订单", source: "contextual", matched: true },
    { translation: "顺序", source: "contextual-candidate", matched: false }]
});
assert.ok(result.confidence < 0.7, "Two Chinese senses occurring in one sentence do not locate the hovered occurrence");
assert.ok(result.evidenceIssues.includes("multiple-meanings-in-sentence"));
