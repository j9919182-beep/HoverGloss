"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
class Element {
  constructor(tagName = "div") { this.tagName = tagName; this.children = []; this.listeners = {}; this.textContent = ""; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}
const messages = [];
let pendingSave = null;
const sandbox = {
  chrome: {
    storage: { local: { async get(defaults) { return defaults; } }, onChanged: { addListener() {} } },
    runtime: { async sendMessage(message) { messages.push(message); return pendingSave ? pendingSave : { ok: true }; } }
  },
  document: { createElement(tag) { return new Element(tag); }, createTextNode(text) { const item = new Element(); item.textContent = text; return item; }, addEventListener() {} },
  requestAnimationFrame(fn) { fn(); },
  ConciseHoverRules: { normalizeText: (value) => String(value || "").trim() },
  HoverGlossWordSenses: require("../word-senses.js")
};
const source = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `globalThis.testStudy = {
  buildWordTooltip, buildSelectedPhraseStudy,
  enable(value) { settings.learningMode = value; learningCapture = { saved: false, saving: false }; }
};})();`), sandbox);
const findButton = (item) => item.className === "cht-action cht-study-save" ? item : item.children.map(findButton).find(Boolean);
const flatten = (item) => [item, ...item.children.flatMap(flatten)];
async function run() {
  await new Promise(setImmediate);
  const details = { target: "prime", phrase: "prime minister", phraseTranslation: "总理", context: "The prime minister spoke.",
    contextReview: "phrase-only", source: "browser-phrase-context", isolatedTranslation: "总数", confidence: .56,
    learningSource: { type: "pdf", title: "Book.pdf", fingerprint: "aaaaaaaa", page: 5 } };
  let box = new Element();
  sandbox.testStudy.buildWordTooltip(box, "总理", details, null);
  assert.equal(findButton(box), undefined, "Normal reading must not add study controls");
  sandbox.testStudy.enable(true);
  box = new Element();
  sandbox.testStudy.buildWordTooltip(box, "总理", details, null);
  const button = findButton(box);
  assert.ok(button);
  assert.equal(messages.length, 0, "Rendering a translation never automatically saves it");
  await button.listeners.click();
  assert.equal(messages[0].type, "learningSave");
  assert.equal(messages[0].entry.meaning, "主要的；首要的");
  assert.equal(messages[0].entry.phraseTranslation, "总理");
  assert.equal(messages[0].entry.uncertain, true);
  assert.equal(messages[0].entry.origin.page, 5);
  assert.equal(messages[0].entry.context, details.context);
  assert.equal(button.textContent, "已加入学习库");
  await button.listeners.click();
  assert.equal(messages.length, 1, "Repeated clicks must not resubmit a saved record");
  sandbox.testStudy.enable(true);
  const plain = new Element(); sandbox.testStudy.buildWordTooltip(plain, "主要的", { ...details, phrase: "", phraseTranslation: "" }, null);
  let finishSave; pendingSave = new Promise((resolve) => { finishSave = resolve; });
  const saving = findButton(plain).listeners.click();
  const aligned = new Element(); sandbox.testStudy.buildWordTooltip(aligned, "总理", details, null);
  const pairButton = flatten(aligned).find((node) => node.className?.includes("cht-study-phrase"));
  assert.equal(pairButton.disabled, true, "A late phrase cannot start a second write during the original save");
  pendingSave = null; finishSave({ ok: true }); await saving;
  assert.equal(pairButton.disabled, false, "Newly aligned phrases remain saveable after a word-only capture completes");
  assert.equal(pairButton.textContent, "＋ 补存短语");
  await pairButton.listeners.click();
  assert.equal(messages.at(-1).entry.term, "prime");
  assert.equal(messages.at(-1).entry.phrase, "prime minister");
  assert.equal(messages.at(-1).entry.meaning, "主要的；首要的");
  assert.equal(findButton(aligned).disabled, true, "Word and phrase controls share one capture state");
  const selected = new Element();
  sandbox.testStudy.buildSelectedPhraseStudy(selected, new Element(), { ...details, target: "prime minister" }, "总理");
  const nodes = flatten(selected), association = nodes.find((node) => node.tagName === "select");
  const save = nodes.find((node) => node.textContent === "保存词与短语");
  const count = messages.length; await save.listeners.click(); assert.equal(messages.length, count, "Selection must explicitly choose a linked word");
  association.value = "prime"; association.listeners.change();
  await save.listeners.click();
  assert.equal(messages.at(-1).entry.term, "prime");
  assert.equal(messages.at(-1).entry.phrase, "prime minister");
  assert.equal(messages.at(-1).entry.phraseTranslation, "总理");
  assert.equal(messages.at(-1).entry.context, "The prime minister spoke.");
  assert.equal(messages.at(-1).entry.sentenceTranslation, "", "A selected phrase translation is not a translation of the full sentence");
  assert.equal(messages.at(-1).entry.uncertain, true);
  assert.equal(messages.at(-1).entry.origin.page, 5);
  const longer = new Element(); sandbox.testStudy.buildSelectedPhraseStudy(longer, new Element(), { target: "This is an entire sentence." }, "整句");
  assert.equal(longer.children.length, 0, "Do not label sentences with punctuation as fixed phrases");
  console.log("learning card opt-in capture and uncertainty tests passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
