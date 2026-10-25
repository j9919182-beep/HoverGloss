"use strict";

const assert = require("node:assert/strict");
const core = require("../local-alignment-core.js");
const repeated = "Commission discussed the report, ".repeat(30) + "Commission decided.";
const selected = repeated.lastIndexOf("Commission");
const focused = core.focusContext(repeated, selected, selected + 10);
assert.equal(focused.context.slice(focused.targetStart, focused.targetEnd), "Commission");
assert.ok(focused.context.endsWith("Commission decided."));
assert.ok(focused.context.length <= 400);
assert.equal(core.focusContext("abc", 4, 5), null);

const tokenizer = {
  tokenize(text) { return text.match(/[A-Za-z]+|[\p{Script=Han}]/gu) || []; }
};
const source = "The function returns a value.";
const target = "该函数返回一个值。";
const sourceTokens = tokenizer.tokenize(source);
const targetTokens = tokenizer.tokenize(target);
function tensor(tokens, special) {
  const data = new Float32Array((tokens.length + 2) * 3);
  tokens.forEach((token, index) => {
    const vector = special(token) ? [1, 0, 0] : [0, 1, 0];
    data.set(vector, (index + 1) * 3);
  });
  return { dims: [1, tokens.length + 2, 3], data };
}
const sourceVectors = tensor(sourceTokens, (token) => token === "returns");
const targetVectors = tensor(targetTokens, (token) => token === "返" || token === "回");
const position = source.indexOf("returns");
const alignment = core.choose({
  sourceText: source, targetText: target, targetStart: position, targetEnd: position + 7,
  tokenizer, sourceVectors, targetVectors
});
assert.equal(alignment.span, "返回");
assert.equal(alignment.mutual, true);
assert.ok(alignment.margin > 0.5);

const low = { translation: "收益", sentenceTranslation: target, confidence: 0.56, source: "browser" };
const applied = core.apply(low, alignment);
assert.equal(applied.translation, "返回");
assert.equal(applied.source, "browser-local-align");
assert.equal(applied.alignedChineseSpan, "返回");
assert.equal(applied.alternatives[0], "收益");
assert.equal(applied.confidence, 0.56, "Model alignment must not invent a calibrated confidence score");
assert.equal(applied.contextReview, "aligned");
assert.equal(core.apply({ ...low, confidence: 0.9 }, alignment).translation, "收益");
assert.equal(core.apply(low, { span: "不存在" }).translation, "收益");
assert.equal(core.apply(low, { span: "不存在" }).contextReview, "unresolved");
assert.equal(core.apply(low, { span: "返回", score: 0.8, margin: 0.01, mutual: true }).translation, "收益", "Ambiguous alignment must not overwrite the gloss");
assert.equal(core.apply(low, { span: "返", score: 0.55, margin: 0.2, mutual: true }).translation, "收益", "Single-character fragments need stronger evidence");
assert.equal(core.apply({ ...low, sentenceTranslation: "这是一个值。" }, { span: "是", score: 0.95, margin: 0.4, mutual: true }).translation, "收益", "Function words are not standalone glosses");
const capital = core.apply({ translation: "首都", sentenceTranslation: "公司筹集了更多资金。", confidence: 0.56, source: "browser" },
  { span: "资金", score: 0.76, margin: 0.18, mutual: true });
assert.equal(capital.translation, "资金", "A supported sentence-level sense should replace an isolated word meaning");
assert.equal(capital.alternatives[0], "首都");

function coloredTensor(tokens, color) {
  const data = new Float32Array((tokens.length + 2) * 4);
  tokens.forEach((token, index) => data.set(color(token), (index + 1) * 4));
  return { dims: [1, tokens.length + 2, 4], data };
}
const namedSource = "The European Commission president spoke.";
const namedTarget = "欧盟委员会主席发表了讲话。";
const namedSourceVectors = coloredTensor(tokenizer.tokenize(namedSource), (token) =>
  token === "European" ? [1, 0, 0, 0] : token === "Commission" ? [0, 1, 0, 0] :
    token === "president" ? [0, 0, 0, 1] : [0, 0, 1, 0]);
const namedTargetVectors = coloredTensor(tokenizer.tokenize(namedTarget), (token) =>
  "欧盟".includes(token) ? [1, 0, 0, 0] : "委员会".includes(token) ? [0, 1, 0, 0] :
    "主席".includes(token) ? [0, 0, 0, 1] : [0, 0, 1, 0]);
const namedAlignment = core.choose({
  sourceText: namedSource, targetText: namedTarget,
  targetStart: namedSource.indexOf("Commission"), targetEnd: namedSource.indexOf("Commission") + 10,
  tokenizer, sourceVectors: namedSourceVectors, targetVectors: namedTargetVectors
});
assert.equal(namedAlignment.span, "委员会", "Adjacent Chinese characters must form one target-word span");
assert.equal(namedAlignment.phrase, "European Commission");
assert.equal(namedAlignment.phraseTranslation, "欧盟委员会");
const namedResult = core.apply({ translation: "佣金", sentenceTranslation: namedTarget, confidence: 0.56 }, namedAlignment);
assert.equal(namedResult.translation, "委员会");
assert.equal(namedResult.phraseTranslation, "欧盟委员会");
const partialNamed = core.apply({ translation: "佣金", sentenceTranslation: namedTarget, confidence: 0.56 }, {
  span: "委员", score: 0.85, margin: 0.2, mutual: true,
  phrase: "European Commission", phraseTranslation: "欧盟委员会", phraseScore: 0.8,
  phraseKind: "name", targetAtPhraseEnd: true
});
assert.equal(partialNamed.contextReview, "phrase-only", "A truncated Chinese compound must not be presented as the word meaning");
assert.equal(partialNamed.translation, "欧盟委员会");

const phraseOnlyVectors = coloredTensor(tokenizer.tokenize(namedTarget), (token) =>
  "欧盟委员会".includes(token) ? [1, 0, 0, 0] : "主席".includes(token) ? [0, 0, 0, 1] : [0, 0, 1, 0]);
const phraseOnlyAlignment = core.choose({
  sourceText: namedSource, targetText: namedTarget,
  targetStart: namedSource.indexOf("Commission"), targetEnd: namedSource.indexOf("Commission") + 10,
  tokenizer, sourceVectors: namedSourceVectors, targetVectors: phraseOnlyVectors
});
assert.equal(phraseOnlyAlignment.span, "");
assert.equal(phraseOnlyAlignment.phraseTranslation, "欧盟委员会");
const phraseOnlyResult = core.apply({ translation: "佣金", sentenceTranslation: namedTarget, confidence: 0.56 }, phraseOnlyAlignment);
assert.equal(phraseOnlyResult.translation, "欧盟委员会");
assert.equal(phraseOnlyResult.contextReview, "phrase-only");
assert.equal(phraseOnlyResult.unconfirmedTranslation, "佣金");
const separatedCandidates = core.apply({
  translation: "初步候选", isolatedTranslation: "佣金", sentenceTranslation: namedTarget, confidence: 0.56
}, phraseOnlyAlignment);
assert.equal(separatedCandidates.contextReview, "phrase-only");
assert.equal(separatedCandidates.unconfirmedTranslation, "初步候选");
assert.equal(separatedCandidates.isolatedTranslation, "佣金", "Phrase review must retain the raw isolated model output");

const idiomSource = "We take stock of the situation.";
const idiomTarget = "我们评估了局势。";
const idiomAlignment = core.choose({
  sourceText: idiomSource, targetText: idiomTarget,
  targetStart: idiomSource.indexOf("stock"), targetEnd: idiomSource.indexOf("stock") + 5,
  tokenizer,
  sourceVectors: coloredTensor(tokenizer.tokenize(idiomSource), (token) => token === "stock" ? [0, 1, 0, 0] : [0, 0, 1, 0]),
  targetVectors: coloredTensor(tokenizer.tokenize(idiomTarget), () => [0, 0, 1, 0])
});
assert.equal(idiomAlignment, null, "An idiom with no separable word span must not manufacture one");
assert.equal(core.apply({ translation: "股票", sentenceTranslation: idiomTarget, confidence: 0.56 }, idiomAlignment).contextReview, "unresolved");
const idiomPhraseAlignment = core.choose({
  sourceText: idiomSource, targetText: idiomTarget,
  targetStart: idiomSource.indexOf("stock"), targetEnd: idiomSource.indexOf("stock") + 5,
  tokenizer,
  sourceVectors: coloredTensor(tokenizer.tokenize(idiomSource), (token) =>
    token === "take" ? [1, 0, 0, 0] : token === "stock" ? [0, 1, 0, 0] :
      token === "of" ? [0, 0, 0, 1] : [0, 0, 1, 0]),
  targetVectors: coloredTensor(tokenizer.tokenize(idiomTarget), (token) =>
    "评估".includes(token) ? [1, 0, 0, 0] : [0, 0, 1, 0])
});
assert.equal(idiomPhraseAlignment.span, "");
assert.equal(idiomPhraseAlignment.phrase, "take stock of");
assert.equal(idiomPhraseAlignment.phraseTranslation, "评估");
assert.equal(core.apply({ translation: "股票", sentenceTranslation: idiomTarget, confidence: 0.56 }, idiomPhraseAlignment).contextReview, "phrase-only");

const titleSource = "The prime minister spoke.";
const titleTarget = "总理发表了讲话。";
const titleSourceVectors = coloredTensor(tokenizer.tokenize(titleSource), (token) =>
  ["prime", "minister"].includes(token) ? [1, 0, 0, 0] :
    token === "spoke" ? [0, 1, 0, 0] : [0, 0, 1, 0]);
const titleTargetVectors = coloredTensor(tokenizer.tokenize(titleTarget), (token) =>
  "总理".includes(token) ? [1, 0, 0, 0] : "讲话".includes(token) ? [0, 1, 0, 0] : [0, 0, 1, 0]);
for (const word of ["prime", "minister"]) {
  const start = titleSource.indexOf(word);
  const titleAlignment = core.choose({
    sourceText: titleSource, targetText: titleTarget, targetStart: start, targetEnd: start + word.length,
    tokenizer, sourceVectors: titleSourceVectors, targetVectors: titleTargetVectors
  });
  assert.equal(titleAlignment.phrase, "prime minister", `${word} must be evaluated inside the ordinary lowercase phrase`);
  assert.equal(titleAlignment.phraseTranslation, "总理");
  const titleResult = core.apply({ translation: word === "prime" ? "质数" : "部长",
    sentenceTranslation: titleTarget, confidence: 0.56 }, titleAlignment);
  assert.equal(titleResult.contextReview, "phrase-only", "An indivisible title must not be assigned to either word alone");
  assert.equal(titleResult.translation, "总理");
  assert.equal(core.apply({ translation: "总理", sentenceTranslation: titleTarget, confidence: 0.56 }, titleAlignment).contextReview,
    "phrase-only", "Even an isolated gloss matching the whole phrase does not prove a word-level meaning");
}

const cardSource = "A credit card expired.";
const cardTarget = "一张信用卡过期了。";
const cardAlignment = core.choose({
  sourceText: cardSource, targetText: cardTarget,
  targetStart: cardSource.indexOf("credit"), targetEnd: cardSource.indexOf("credit") + 6,
  tokenizer,
  sourceVectors: coloredTensor(tokenizer.tokenize(cardSource), (token) =>
    ["credit", "card"].includes(token) ? [1, 0, 0, 0] : [0, 0, 1, 0]),
  targetVectors: coloredTensor(tokenizer.tokenize(cardTarget), (token) =>
    "信用卡".includes(token) ? [1, 0, 0, 0] : [0, 0, 1, 0])
});
assert.equal(cardAlignment.phrase, "credit card", "Generic phrase discovery must work beyond the reported title");
assert.equal(cardAlignment.phraseTranslation, "信用卡");
assert.equal(core.apply({ translation: "信用", sentenceTranslation: cardTarget, confidence: 0.56 }, cardAlignment).contextReview,
  "phrase-only");

const metricSource = "A key metric improved.";
const metricTarget = "一项关键指标有所改善。";
const metricAlignment = core.choose({
  sourceText: metricSource, targetText: metricTarget,
  targetStart: metricSource.indexOf("metric"), targetEnd: metricSource.indexOf("metric") + 6,
  tokenizer,
  sourceVectors: coloredTensor(tokenizer.tokenize(metricSource), (token) =>
    token === "key" ? [1, 0, 0, 0] : token === "metric" ? [0, 1, 0, 0] : [0, 0, 1, 0]),
  targetVectors: coloredTensor(tokenizer.tokenize(metricTarget), (token) =>
    "关键".includes(token) ? [1, 0, 0, 0] : "指标".includes(token) ? [0, 1, 0, 0] : [0, 0, 1, 0])
});
assert.equal(metricAlignment.phrase, "key metric");
assert.equal(metricAlignment.phraseTranslation, "关键指标");
assert.equal(core.apply({ translation: "公制", sentenceTranslation: metricTarget, confidence: 0.56 }, metricAlignment).translation,
  "指标", "A separable phrase should still yield the precise word meaning");

const unsupportedSource = "Bright cars arrived.";
const unsupportedTarget = "汽车抵达了。";
const unsupportedAlignment = core.choose({
  sourceText: unsupportedSource, targetText: unsupportedTarget,
  targetStart: unsupportedSource.indexOf("Bright"), targetEnd: unsupportedSource.indexOf("Bright") + 6,
  tokenizer,
  sourceVectors: coloredTensor(tokenizer.tokenize(unsupportedSource), (token) =>
    token === "cars" ? [1, 0, 0, 0] : [0, 1, 0, 0]),
  targetVectors: coloredTensor(tokenizer.tokenize(unsupportedTarget), (token) =>
    "汽车".includes(token) ? [1, 0, 0, 0] : [0, 0, 1, 0])
});
assert.ok(!unsupportedAlignment?.phraseTranslation, "A neighbor's translation alone must not prove an ordinary phrase");

const unresolved = { translation: "质数", sentenceTranslation: titleTarget, confidence: 0.56,
  source: "browser", contextReview: "unresolved" };
const translatedTitle = core.applyPhraseTranslation(unresolved, "prime minister", "总理");
assert.equal(translatedTitle.contextReview, "phrase-only", "A translated adjacent phrase can recover an omitted word alignment");
assert.equal(translatedTitle.source, "browser-phrase-context");
assert.equal(translatedTitle.phraseTranslation, "总理");
assert.equal(translatedTitle.unconfirmedTranslation, "质数");
assert.equal(core.applyPhraseTranslation(unresolved, "prime minister", "部长").contextReview, "unresolved");
assert.equal(core.applyPhraseTranslation(unresolved, "prime minister", "总").contextReview, "unresolved");
assert.equal(core.applyPhraseTranslation({ ...unresolved, sentenceTranslation: "总理和总理都发言了。" },
  "prime minister", "总理").contextReview, "unresolved", "Repeated sentence matches are too ambiguous");
assert.ok(core.nearbyPhrases(titleSource, titleSource.indexOf("prime"), titleSource.indexOf("prime") + 5)
  .some((phrase) => phrase.text === "prime minister"));

assert.equal(core.tokenRange(tokenizer, source, -1, 2), null);

console.log("local alignment core tests passed");
