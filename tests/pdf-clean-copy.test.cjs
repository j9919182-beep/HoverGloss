"use strict";
const assert = require("node:assert/strict");
const copy = require("../pdf-clean-copy.js");
const viewport = { transform: [1, 0, 0, -1, 0, 800] };
function item(str, x, y, width = 200, size = 10, hasEOL = true) {
  return { str, width, transform: [size, 0, 0, size, x, 800 - y], fontName: "body", dir: "ltr", hasEOL };
}
const page = { items: [
  item("Right column begins", 310, 100), item("and ends here.", 310, 113),
  item("Left column begins", 40, 100), item("and ends here.", 40, 113),
  item("A new left paragraph.", 40, 145), item("A full-width title", 40, 40, 470, 24)
] };
const result = copy.prepare(page, viewport);
assert.equal(result.text, "A full-width title\n\nLeft column begins and ends here.\n\nA new left paragraph.\n\nRight column begins and ends here.");
assert.match(result.raw, /^Right column begins\nand ends here\./);
assert.equal(copy.prepare(page, { transform: [1.6, 0, 0, -1.6, 0, 1280] }).text, result.text, "Zoom must not change reading order");
assert.equal(copy.prepare(page, viewport, { order: "original" }).text, result.raw);

const fragments = { items: [item("con", 40, 100, 15, 10, false), item("flicting", 55, 100, 30, 10, false), item("lessons", 88, 100, 35)] };
assert.equal(copy.prepare(fragments, viewport).text, "conflicting lessons");
const broken = { items: [item("An inter-", 40, 100), item("national ﬁrm.", 40, 113)] };
assert.equal(copy.prepare(broken, viewport).text, "An inter-national firm.");
assert.equal(copy.prepare(broken, viewport, { joinHyphens: true }).text, "An international firm.");
assert.equal(copy.prepare(broken, viewport, { mergeLines: false, joinHyphens: true }).text, "An inter-\nnational firm.");
assert.equal(copy.prepare({ items: [item("中 文 段落", 40, 100), item("继续阅读。", 40, 113)] }, viewport).text, "中文段落继续阅读。");
assert.equal(copy.prepare({ items: [item("1. First item", 40, 100), item("2. Second item", 40, 113)] }, viewport).text, "1. First item\n2. Second item");
assert.equal(copy.assess("").kind, "empty");
for (const text of ["bad � text", "\ue000abc", "(cid:12)", "\u{f0012}"]) assert.equal(copy.assess(text).kind, "suspect");
assert.equal(copy.assess("正常文字 α ∑ x² ① café Пример").kind, "text");
assert.equal(copy.prepare({ items: [] }, viewport).text, "");
const unplaced = copy.prepare({ items: [{ str: "Keep unknown geometry" }, item("Normal", 40, 100), { str: "שלום", dir: "rtl" }] }, viewport);
assert.equal(unplaced.uncertainLayout, true);
assert.equal(unplaced.text, "Normal\n\nKeep unknown geometry\n\nשלום");

// Real Range semantics: comparePoint returns 0 at both inclusive boundaries.
function selectionFor(texts, start, end) {
  const nodes = texts.map((data, index) => ({ data, length: data.length, index }));
  const spans = nodes.map((node) => ({ textContent: node.data, ownerDocument: {
    createTreeWalker() { let seen = false; return { nextNode() { if (seen) return null; seen = true; return node; } }; }
  } }));
  const range = {
    intersectsNode() { return true; },
    comparePoint(node, offset) {
      if (node.index < start[0] || node.index === start[0] && offset < start[1]) return -1;
      if (node.index > end[0] || node.index === end[0] && offset > end[1]) return 1;
      return 0;
    }
  };
  return { layer: { textDivs: spans }, selection: { isCollapsed: false, rangeCount: 1, getRangeAt() { return range; } } };
}
const textContent = { items: [item("First line", 40, 100), item("Second line", 40, 113)] };
for (const [start, end, expected] of [
  [[0, 2], [1, 6], ["rst line", "Second"]], [[0, 0], [1, 11], ["First line", "Second line"]],
  [[0, 10], [1, 1], ["S"]], [[0, 2], [0, 5], ["rst"]], [[1, 0], [1, 11], ["Second line"]]
]) {
  const fixture = selectionFor(textContent.items.map((entry) => entry.str), start, end);
  const selected = copy.selectedContent(fixture.layer, textContent, fixture.selection);
  assert.deepEqual(selected.items.map((entry) => entry.str), expected);
}
const mismatch = selectionFor(["Not matching", "Second line"], [0, 0], [1, 6]);
assert.deepEqual(copy.selectedContent(mismatch.layer, textContent, mismatch.selection).items.map((entry) => entry.str), ["Second"]);
console.log("PDF clean copy ordering, cleanup, quality and selection tests passed");
