"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const wordSenses = require("../word-senses.js");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "content.js"), "utf8");
assert.match(source, /\}\)\(\);\s*$/);

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = "";
    this.textContent = "";
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  addEventListener() {}
}

const sandbox = {
  chrome: { storage: { local: { async get(defaults) { return defaults; } }, onChanged: { addListener() {} } } },
  document: {
    createElement(tagName) { return new Element(tagName); },
    createTextNode(text) { const node = new Element("#text"); node.textContent = text; return node; },
    addEventListener() {}
  },
  ConciseHoverRules: { normalizeText(value) { return String(value || "").trim(); } },
  HoverGlossWordSenses: wordSenses
};
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, "globalThis.testBuildWordTooltip = buildWordTooltip;})();"),
  sandbox, { filename: "content.js" });

function renderBody(text, details) {
  const box = new Element("div");
  sandbox.testBuildWordTooltip(box, text, details, null);
  return box.children[1].children;
}
function render(text, details) {
  const children = renderBody(text, details);
  return [children.find((node) => node.className === "cht-word-head"),
    children.find((node) => ["cht-meanings", "cht-best"].includes(node.className)),
    children.find((node) => node.className.startsWith("cht-sentence-meaning")),
    children.find((node) => node.tagName === "details")];
}

const [title, phraseMeanings, sentence, explanation] = render("总理", {
  target: "prime", phrase: "prime minister", phraseTranslation: "总理",
  isolatedTranslation: "总数", unconfirmedTranslation: "首要", contextReview: "phrase-only", sentenceTranslation: "总理发表讲话。",
  source: "browser-phrase-context", confidence: 0.56
});
assert.equal(title.className, "cht-word-head");
assert.equal(phraseMeanings.className, "cht-meanings");
assert.equal(phraseMeanings.children.length, 2);
const [phraseRow, wordRow] = phraseMeanings.children;
assert.equal(wordRow.children[0].children[0].textContent, "单词常见义");
assert.equal(wordRow.children[0].children[1].textContent, "非句中定论");
assert.equal(wordRow.children[1].children[0].textContent, "prime");
assert.equal(wordRow.children[1].children[1].textContent, "主要的；首要的");
assert.equal(phraseRow.children[0].children[0].textContent, "短语义");
assert.equal(phraseRow.children[1].children[0].textContent, "prime minister");
assert.equal(phraseRow.children[1].children[1].textContent, "总理");
assert.equal(phraseRow.children[0].children[1].textContent, "整短语", "A phrase translation must not be read as the hovered word meaning");
assert.equal(sentence.className, "cht-sentence-meaning cht-sentence-fallback", "Sentence meaning stays visible and highlighted without expanding details");
assert.equal(explanation.tagName, "details");
assert.equal(explanation.open, false);
assert.equal(explanation.children[0].textContent, "查看判断依据");
const evidence = explanation.children[1];
assert.ok(!evidence.children.some((child) => child.className === "cht-phrase"),
  "The phrase mapping should not be repeated in the evidence panel");
assert.ok(evidence.children.some((child) => child.textContent?.includes("单独机译参考（未确认）：总数")),
  "The isolated machine output remains available, but only behind the evidence toggle");
assert.ok(evidence.children.some((child) => child.textContent?.includes("初步候选（未确认）：首要")),
  "A context-picked candidate must not be mislabeled as isolated machine output");

const [, alignedMeanings] = render("委员会", {
  target: "Commission", phrase: "European Commission", phraseTranslation: "欧盟委员会",
  contextReview: "aligned", source: "browser-local-align", sentenceTranslation: "欧盟委员会发言。", confidence: 0.56
});
assert.equal(alignedMeanings.children[0].children[0].children[0].textContent, "单词句中义");
assert.equal(alignedMeanings.children[0].children[1].children[1].textContent, "委员会");
assert.equal(alignedMeanings.children[1].children[1].children[0].textContent, "European Commission");

const [, simpleMeaning] = render("佣金", { target: "commission", source: "browser", confidence: 0.84 });
assert.equal(simpleMeaning.className, "cht-best", "A single-word result keeps the compact original layout");

const [, unknownMeanings] = render("量子态", {
  target: "quantum", phrase: "quantum state", phraseTranslation: "量子态",
  isolatedTranslation: "量子", unconfirmedTranslation: "量子性质", contextReview: "phrase-only", source: "browser-phrase-context", confidence: 0.56
});
assert.equal(unknownMeanings.children[1].children[0].children[0].textContent, "单独机译参考");
assert.equal(unknownMeanings.children[1].children[0].children[1].textContent, "未确认");
assert.equal(unknownMeanings.children[1].children[1].children[1].textContent, "量子");

const [, weakWord] = render("总数", {
  target: "unknown", isolatedTranslation: "总数", contextReview: "pending", source: "browser", confidence: 0.56
});
assert.equal(weakWord.children[0].children[0].children[0].textContent, "单独机译参考");

const [, noRawMachine] = render("语境候选", {
  target: "unknown", unconfirmedTranslation: "语境候选", contextReview: "phrase-only", source: "browser-phrase-context", confidence: 0.56
});
assert.equal(noRawMachine.children[0].children[0].children[0].textContent, "初步候选（未确认）");

const weakBody = renderBody("总数", {
  target: "unknown", isolatedTranslation: "总数", source: "browser", confidence: 0.56,
  sentenceTranslation: "完整句意用于理解语境。"
});
const referenceIndex = weakBody.findIndex((node) => node.className === "cht-meanings");
const sentenceIndex = weakBody.findIndex((node) => node.className.startsWith("cht-sentence-meaning"));
assert.ok(sentenceIndex < referenceIndex, "Without reliable phrase alignment, the sentence should precede the isolated reference");
assert.equal(weakBody[referenceIndex].children[0].children[0].children[1].textContent, "未确认",
  "Low browser confidence stays unconfirmed even before a review status arrives");
assert.ok(weakBody.some((node) => node.className === "cht-word-review-note" && node.textContent.includes("待确认")));
const [, shortReliable] = render("执行", { target: "run", source: "browser-context", confidence: .9 });
assert.equal(shortReliable.className, "cht-best", "Reliable results keep the concise layout");

const css = fs.readFileSync(path.join(root, "content.css"), "utf8");
for (const className of ["cht-meanings", "cht-meaning-phrase", "cht-meaning-common", "cht-meaning-tentative", "cht-meaning-original", "cht-meaning-translation", "cht-explanation"]) {
  assert.ok(css.includes(`.${className}`), `Missing presentation style for ${className}`);
}
console.log("word card display tests passed");
