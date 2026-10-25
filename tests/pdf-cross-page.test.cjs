"use strict";
const assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs");
const pdf = require("../pdf-context.js");
const viewport = { width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] };
const item = (str, x, y, width = 220, size = 10, font = "body") => ({ str, width, height: size, dir: "ltr", hasEOL: true, fontName: font, transform: [size, 0, 0, size, x, 800 - y] });
const make = (items) => pdf.build({ items }, viewport);
const left = [item("The Economist", 40, 25, 80, 9, "header"),
  item("Left column contains an unrelated complete sentence.", 40, 150),
  item("He was barred from office until 2060.", 320, 700), item("His son has", 320, 713, 60), item("24", 40, 780, 12, 9, "header")];
const right = [item("The Economist", 40, 25, 80, 9, "header"),
  item("alleged connections to the criminal underworld.", 40, 100), item("Despite that, support remains strong.", 40, 113),
  item("A different paragraph ends normally.", 40, 160), item("Another column has its own story.", 320, 100), item("25", 40, 780, 12, 9, "header")];
const a = make(left), b = make(right), before = JSON.stringify([a, b]);
const aJoined = pdf.bridgePages(a, null, b), bJoined = pdf.bridgePages(b, a, null);
const expected = "His son has alleged connections to the criminal underworld.";
assert.match(aJoined.contexts[3].text, /His son has alleged connections/);
assert.match(bJoined.contexts[1].text, /His son has alleged connections/);
assert.equal(JSON.stringify([a, b]), before, "Cached page layouts must stay immutable");
for (const [items, layout] of [[left, aJoined], [right, bJoined]]) items.forEach((entry, index) => {
  const context = layout.contexts[index];
  assert.equal(context.text.slice(context.offset, context.offset + entry.str.length), entry.str);
});
const sandbox = { chrome: { storage: { local: { get: async (defaults) => defaults }, onChanged: { addListener() {} } } },
  document: { addEventListener() {} }, ConciseHoverRules: { normalizeText: (text) => String(text || "").replace(/\s+/g, " ").trim() } };
vm.runInNewContext(fs.readFileSync(require.resolve("../content.js"), "utf8").replace(/\}\)\(\);\s*$/, "globalThis.extract = sentenceForCaret;})();"), sandbox);
const sentence = (layout, index, offset) => {
  const layer = {}, span = { __hoverGlossContext: layout.contexts[index], closest: (selector) => selector === ".textLayer" ? layer : span };
  return sandbox.extract({ parentElement: { closest: () => span } }, "", offset);
};
assert.equal(sentence(aJoined, 3, 5).text, expected, "Hover son on previous page gets the full sentence");
assert.equal(sentence(bJoined, 1, 3).text, expected, "Hover alleged on next page gets the same full sentence");
assert.doesNotMatch(sentence(aJoined, 3, 5).text, /Economist|unrelated|Despite|Another|24|25/);
const ended = make(left.map((entry, index) => index === 3 ? item("His son has finished.", 320, 713, 160) : entry));
assert.equal(pdf.bridgePages(ended, null, b).contexts[3].text, ended.contexts[3].text, "Finished sentence must not join");
const title = make([...right, item("A different article starts here", 40, 70, 250, 20, "headline")]);
assert.equal(pdf.bridgePages(a, null, title).contexts[3].text, a.contexts[3].text, "New heading blocks a cross-page join");
const newParagraph = make([item("An independent story begins here.", 40, 100)]);
assert.equal(pdf.bridgePages(a, null, newParagraph).contexts[3].text, a.contexts[3].text);
assert.equal(pdf.bridgePages(a, null, make([])).contexts[3].text, a.contexts[3].text, "Image-only page cannot supply invented text");
const narrowTopMargin = make([item("alleged connections to the criminal underworld.", 40, 58)]);
assert.equal(sentence(pdf.bridgePages(narrowTopMargin, a, null), 0, 3).text, expected);
const repeatedHeaderA = make([...left, item("World politics", 40, 80, 100)]), repeatedHeaderB = make([...right, item("World politics", 40, 80, 100)]);
assert.doesNotMatch(sentence(pdf.bridgePages(repeatedHeaderB, repeatedHeaderA, null), 1, 3).text, /World politics/);
assert.equal(sentence(pdf.bridgePages(repeatedHeaderB, repeatedHeaderA, null), 1, 3).text, expected);
const middle = make([item("and also has", 40, 100)]), ending = make([item("several other responsibilities.", 40, 100)]);
assert.match(pdf.bridgePages(middle, a, ending).contexts[0].text, /His son has and also has several other responsibilities/);
console.log("PDF cross-page context: both hover directions, sentence boundaries/offsets, columns, headers/footers, headings, empty page and immutable cache passed");
