"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const pdfContext = require("../pdf-context.js");

const viewport = { transform: [1, 0, 0, -1, 0, 800] };
function item(str, x, y, width, size = 10, fontName = "body", hasEOL = true) {
  return { str, width, height: size, transform: [size, 0, 0, size, x, 800 - y], fontName, hasEOL, dir: "ltr" };
}

// PDF painting order is deliberately not reading order: the second column appears before the first.
const page = { items: [
  item("The Economist", 40, 20, 80, 9, "running-header"),
  item("Leaders | Our cover", 40, 48, 115, 12, "section"),
  item("Can the AI arms race be stopped?", 40, 85, 420, 24, "headline"),
  item("A changing world demands new answers", 40, 112, 230, 12, "standfirst"),
  item("Sep 17th 2026", 40, 136, 75, 9, "date"),
  item("Another column has its own", 310, 180, 174),
  item("sentence about drones.", 310, 193, 120),
  item("HOW", 40, 180, 22, 10, "small-caps", false),
  item("fast war changes is clear from", 65, 180, 148),
  item("the experience of soldiers at the front.", 40, 193, 185),
  item("New tools now change their tactics.", 40, 219, 180),
  item("A photo caption belongs to the picture", 280, 250, 185, 9, "caption"),
  item("22", 40, 780, 10, 9, "running-header")
] };
const result = pdfContext.build(page, viewport);
const firstParagraph = "HOW fast war changes is clear from the experience of soldiers at the front.";
assert.equal(result.contexts[7].text, firstParagraph);
assert.equal(result.contexts[8].text, firstParagraph);
assert.equal(result.contexts[9].text, firstParagraph);
assert.equal(result.contexts[2].text, "Can the AI arms race be stopped?");
assert.equal(result.contexts[5].text, "Another column has its own sentence about drones.");
assert.equal(result.contexts[10].text, "New tools now change their tactics.");
const zoomed = pdfContext.build(page, { transform: [1.6, 0, 0, -1.6, 0, 1280] });
assert.deepEqual(zoomed.contexts.map((context) => [context.text, context.offset]),
  result.contexts.map((context) => [context.text, context.offset]), "Zoom must preserve context and word offsets");
for (let index = 0; index < page.items.length; index += 1) {
  const context = result.contexts[index];
  assert.equal(context.text.slice(context.offset, context.offset + page.items[index].str.length), page.items[index].str,
    `Incorrect character mapping for PDF item ${index}`);
}

const indented = { items: [
  item("One paragraph begins here and fills this line", 40, 100, 200),
  item("then fills another line before it finishes.", 40, 113, 200),
  item("An indented new paragraph starts here", 52, 126, 188),
  item("and continues on its second line.", 40, 139, 160)
] };
const indentResult = pdfContext.build(indented, viewport);
assert.notEqual(indentResult.contexts[1].blockId, indentResult.contexts[2].blockId);
assert.equal(indentResult.contexts[2].blockId, indentResult.contexts[3].blockId);

const shortEnding = pdfContext.build({ items: [
  item("A long paragraph reaches across the column", 40, 100, 200),
  item("then ends here", 40, 113, 65),
  item("Another paragraph begins without an indent", 40, 126, 200)
] }, viewport);
assert.notEqual(shortEnding.contexts[1].blockId, shortEnding.contexts[2].blockId,
  "A short final line marks a paragraph boundary even when there is no punctuation");

const wordFragments = pdfContext.build({ items: [
  item("conf", 40, 100, 18, 10, "body", false),
  item("licting", 58, 100, 28, 10, "body", false),
  item("lessons", 89, 100, 32)
] }, viewport);
assert.equal(wordFragments.contexts[1].text, "conflicting lessons");
assert.equal(wordFragments.contexts[1].offset, 4);

const unknownLayout = pdfContext.build({ items: [{ str: "Isolated text" }, { str: "Unrelated heading" }] });
assert.equal(unknownLayout.contexts[0].text, "Isolated text", "Missing geometry must never cause whole-page fallback");

// Exercise the same span attachment and sentence extraction used by the PDF reader.
const layer = { __hoverGlossPageText: page.items.map((entry) => entry.str).join(" ") };
const spans = page.items.map((entry) => ({
  textContent: entry.str,
  closest(selector) { return selector === ".textLayer" ? layer : this; }
}));
pdfContext.attach({ textDivs: spans, textContentItemsStr: page.items.map((entry) => entry.str) }, page, viewport);
const sandbox = {
  chrome: { storage: { local: { async get(defaults) { return defaults; } }, onChanged: { addListener() {} } } },
  document: { addEventListener() {} },
  ConciseHoverRules: { normalizeText(value) { return String(value || "").replace(/\s+/g, " ").trim(); } }
};
const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,
  "globalThis.testPdfSentence = sentenceForCaret;})();"), sandbox, { filename: "content.js" });
const selected = sandbox.testPdfSentence({ parentElement: spans[7] }, "HOW", 1);
assert.equal(selected.text, firstParagraph, "Hover must use the paragraph context even if a legacy page string exists");
assert.equal(selected.offset, 1);
delete spans[7].__hoverGlossContext;
assert.equal(sandbox.testPdfSentence({ parentElement: spans[7] }, "HOW", 1).text, "HOW",
  "During a render or on unrecognized layout, hover stays on the text run");

console.log("PDF paragraph context tests passed");
