"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const sandbox = {
  chrome: { storage: { local: { async get(defaults) { return defaults; } }, onChanged: { addListener() {} } } },
  document: { addEventListener() {} },
  ConciseHoverRules: { normalizeText(value) { return String(value || "").replace(/\s+/g, " ").trim(); } }
};
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,
  "globalThis.testSentence = { sentenceAtOffset, sentenceForCaret, locateTargetRange };})();"), sandbox);

let checked = 0;
function verify(text, expected, words) {
  for (const word of words) {
    const index = text.indexOf(word);
    assert.ok(index >= 0, word);
    // Check every character, including the point and its following digit.
    for (let offset = index; offset < index + word.length; offset += 1) {
      const result = sandbox.testSentence.sentenceAtOffset(text, offset);
      assert.equal(result.text, expected, `${word} at ${offset}: ${text}`);
      assert.equal(result.offset, sandbox.ConciseHoverRules.normalizeText(text.slice(result.start, offset)).length);
      assert.equal(text.slice(result.start, result.end), expected);
      checked += 1;
    }
  }
}

const first = "Investors recently forced France to pay 1.5 points more than Germany to borrow for a decade—the highest spread since the euro-zone debt crisis.";
const second = "Ahead of a presidential election in 2027, Marine Le Pen leads the polls.";
verify(`${first} ${second}`, first, ["Investors", "pay", "1.5", "points", "Germany", "crisis"]);
verify(`${first} ${second}`, second, ["Ahead", "election", "polls"]);
for (const number of ["3.14", "0.05", "-1.5", "1.5%", "$1.50", "1,234.56", "v1.5.2", ".5", "-.5"]) {
  const sentence = `The reported value is ${number} today.`;
  verify(`Before. ${sentence} After.`, sentence, ["reported", number, "today"]);
  verify(`Before. ${sentence} After.`, "After.", ["After"]);
}
for (const sentence of [
  "Dr. Smith met Prof. Jones today.",
  "Mr. Brown and Ms. Green met Mrs. White.",
  "J. R. Smith reported the result.",
  "See Fig. 1.5 and Eq. 3.14 for details.",
  "Examples, e.g. apples and pears, help.",
  "It is clear, i.e. no further work is needed.",
  "The U.S. economy grew by 1.5 percent.",
  "We met at 3 p.m. yesterday.",
  "Visit example.com or https://docs.example.org/guide for details.",
  "Write to editor@example.com for details."
]) {
  verify(`${sentence} Next sentence.`, sentence, [sentence.split(" ")[0], "details", "today", "needed", "help", "percent", "yesterday", "White", "result"].filter(word => sentence.includes(word)));
  verify(`${sentence} Next sentence.`, "Next sentence.", ["Next"]);
}
verify("He lives in the U.S. Next comes Canada.", "Next comes Canada.", ["Next", "Canada"]);
verify("We met at 3 p.m. Then we left.", "Then we left.", ["Then", "left"]);
verify("Wait... Next sentence.", "Wait...", ["Wait"]);
verify("Wait... Next sentence.", "Next sentence.", ["Next"]);
verify("Is it 1.5? Yes! Another sentence.", "Is it 1.5?", ["1.5"]);
verify("Is it 1.5? Yes! Another sentence.", "Yes!", ["Yes"]);
verify("增长了1.5个百分点。下一句。", "增长了1.5个百分点。", ["1.5"]);
verify("增长了1.5个百分点。下一句。", "下一句。", ["下一句"]);
verify("Heading\nThe rate is 1.5 percent.\nFooter", "The rate is 1.5 percent.", ["rate", "1.5"]);
verify("Dr.\nSeparate heading", "Separate heading", ["Separate"]);
verify("Finished.Next sentence.", "Finished.", ["Finished"]);
verify("Finished.Next sentence.", "Next sentence.", ["Next"]);
verify("Visit example.com for details. Next sentence.", "Visit example.com for details.", ["example", "com"]);
verify("The U.S. economy grew. Next sentence.", "The U.S. economy grew.", ["U.S."]);

// PDF spans use paragraph-relative offsets; decimals must survive that path too.
const layer = {};
const span = {
  __hoverGlossContext: { text: `${first} ${second}`, offset: first.indexOf("pay") },
  closest(selector) { return selector === ".textLayer" ? layer : this; }
};
const pdfResult = sandbox.testSentence.sentenceForCaret({ parentElement: span }, "pay 1.5 points", 1);
assert.equal(pdfResult.text, first);
assert.equal(pdfResult.offset, first.indexOf("pay") + 1);
const range = sandbox.testSentence.locateTargetRange(pdfResult.text, "pay", pdfResult.offset);
assert.equal(range.targetStart, first.indexOf("pay"));
assert.equal(range.targetEnd, first.indexOf("pay") + 3);

// Web paragraphs keep their normalized caret position after sentence selection.
sandbox.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
sandbox.ConciseHoverRules.isBlockedElement = () => false;
const root = { tagName: "P", getAttribute() { return null; }, closest() { return this; } };
const webText = { textContent: `${first} ${second}`, parentElement: root };
sandbox.document.createTreeWalker = () => {
  let used = false;
  return { nextNode() { if (used) return null; used = true; return webText; } };
};
root.closest = selector => selector.includes(".textLayer") ? null : root;
const webResult = sandbox.testSentence.sentenceForCaret(webText, webText.textContent, first.indexOf("points"));
assert.equal(webResult.text, first);
assert.equal(webResult.offset, first.indexOf("points") - 1); // Existing normalization trims the prefix's trailing space.
assert.equal(sandbox.testSentence.sentenceAtOffset("", 0).text, "");
console.log(`Sentence boundary tests passed (${checked} character offsets plus web/PDF paths)`);
