"use strict";

const assert = require("node:assert/strict");
const toc = require("../toc-detect.js");

function page(lines, pageNumber, heading = "目录") {
  const items = [{ str: heading, transform: [1, 0, 0, 1, 40, 790], width: 40 }];
  lines.forEach(([title, label, x], index) => {
    const y = 750 - index * 24;
    items.push({ str: title, transform: [1, 0, 0, 1, x || 40, y], width: title.length * 8 });
    items.push({ str: label, transform: [1, 0, 0, 1, 510, y], width: label.length * 7 });
  });
  return toc.parseTocPage({ items }, pageNumber);
}

const english = page([
  ["Chapter 1 Introduction", "1"],
  ["1.1 The database model", "8", 55],
  ["Chapter 2 Queries", "19"]
], 5, "Contents");
assert.equal(english.hasHeading, true);
assert.deepEqual(english.entries.map((entry) => entry.label), ["1", "8", "19"]);
assert.equal(english.entries[1].title, "1.1 The database model");

const chinese = page([
  ["第一章 绪论", "1"],
  ["第一节 研究背景", "4", 56],
  ["第二章 文献综述", "13"]
], 6);
assert.equal(chinese.entries.length, 3);
assert.equal(toc.parseTocLine({ text: "第三章 方法……29", x: 40 }).number, 29);
assert.equal(toc.parseTocLine({ text: "前言……vii", x: 40 }).label, "vii");
assert.equal(toc.parseTocLine({ text: "Ordinary sentence 2026 is not a contents entry" }), null);
assert.equal(toc.parseTocLine({ text: "Chapter 1" }), null);

const ops = { beginAnnotation: 1, showText: 2, showSpacedText: 3, endAnnotation: 4 };
const glyphs = (value) => [...value].map((unicode) => ({ unicode }));
const operatorList = {
  fnArray: [2, 1, 2, 2, 4, 1, 3, 4],
  argsArray: [
    [[glyphs("Not a link 99")]],
    ["link-a"],
    [[...glyphs("Foreword")]],
    [[...glyphs(" 5")]],
    [],
    ["link-b"],
    [[...glyphs("IVS 100 Valuation Framework 13")]],
    []
  ]
};
const annotations = [
  { id: "link-b", subtype: "Widget", dest: "chapter", rect: [40, 400, 400, 420] },
  { id: "link-a", subtype: "Widget", dest: "foreword", rect: [40, 500, 400, 520] },
  { id: "external", subtype: "Link", url: "https://example.com", rect: [40, 300, 400, 320] }
];
const buttonEntries = toc.parseAnnotationTocPage(annotations, operatorList, ops, 5);
assert.deepEqual(buttonEntries.map((entry) => entry.title), ["Foreword", "IVS 100 Valuation Framework"]);
assert.deepEqual(buttonEntries.map((entry) => entry.label), ["5", "13"]);
assert.equal(buttonEntries[1].level, 1);
assert.equal(buttonEntries[1].dest, "chapter");
assert.equal(toc.mapEntryPage({ ...buttonEntries[1], targetPage: 14 }, null, 0, 5, 50), 14);
assert.equal(toc.parseAnnotationTocPage([], operatorList, ops, 5).length, 0);

const candidate = toc.selectTocCandidate([page([], 1, "Preface"), english, chinese]);
assert.equal(candidate.firstPage, 5);
assert.equal(candidate.lastPage, 6);
assert.equal(candidate.entries.length, 6);
assert.equal(candidate.entries[1].level, 1);
assert.equal(toc.selectTocCandidate([page([], 1, "Preface")]), null);

const bodyPages = [
  { pageNumber: 8, headingLines: ["Chapter 1 Introduction"] },
  { pageNumber: 15, headingLines: ["The database model"] },
  { pageNumber: 26, headingLines: ["Chapter 2 Queries"] }
];
assert.equal(toc.offsetFromHeadings(english.entries, bodyPages, 5), 7);
assert.equal(toc.offsetFromHeadings(english.entries, bodyPages.slice(0, 1), 5), null);

const labels = ["i", "ii", "iii", "iv", "v", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
assert.equal(toc.offsetFromPageLabels(english.entries, labels, 5), 5);
assert.equal(toc.offsetFromPageLabels(english.entries.slice(0, 1), labels, 5), null);
assert.equal(toc.mapEntryPage(english.entries[0], labels, 0, 5, 20), 6);
assert.equal(toc.mapEntryPage(english.entries[1], null, 5, 5, 20), 13);
assert.equal(toc.mapEntryPage({ label: "x", number: null }, null, 0, 5, 20), null);
assert.equal(toc.mapEntryPage({ label: "500", number: 500 }, null, 0, 5, 20), null);

console.log("printed PDF TOC detection tests passed");
