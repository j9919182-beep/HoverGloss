"use strict";

const assert = require("node:assert/strict");
const navigation = require("../pdf-navigation.js");

async function run() {
  assert.equal(navigation.parsePageNumber(" 3 ", 12), 3);
  assert.equal(navigation.parsePageNumber("0", 12), null);
  assert.equal(navigation.parsePageNumber("13", 12), null);
  assert.equal(navigation.parsePageNumber("2.5", 12), null);
  assert.equal(navigation.parsePageNumber("", 12), null);

  const document = {
    numPages: 12,
    getDestination: async (name) => name === "chapter" ? [{ num: 8, gen: 0 }, { name: "Fit" }] : null,
    getPageIndex: async (ref) => ref.num === 8 ? 4 : 99
  };
  assert.equal(await navigation.resolveDestinationPage(document, "chapter"), 5);
  assert.equal(await navigation.resolveDestinationPage(document, [0, { name: "Fit" }]), 1);
  assert.equal(await navigation.resolveDestinationPage(document, [11, { name: "Fit" }]), 12);
  assert.equal(await navigation.resolveDestinationPage(document, [12, { name: "Fit" }]), null);
  assert.equal(await navigation.resolveDestinationPage(document, "missing"), null);
  assert.equal(await navigation.resolveDestinationPage(document, null), null);

  const base = { defaultPrevented: false, target: { closest: () => null } };
  assert.equal(navigation.pageArrowDelta({ ...base, key: "ArrowLeft" }), -1);
  assert.equal(navigation.pageArrowDelta({ ...base, key: "ArrowRight" }), 1);
  assert.equal(navigation.pageArrowDelta({ ...base, key: "ArrowUp" }), 0);
  assert.equal(navigation.pageArrowDelta({ ...base, key: "ArrowRight", ctrlKey: true }), 0);
  assert.equal(navigation.pageArrowDelta({ ...base, key: "ArrowLeft" }, "selected text"), 0);
  assert.equal(navigation.pageArrowDelta({ ...base, key: "ArrowRight", target: { closest: () => ({}) } }), 0);
  assert.equal(navigation.pageArrowDelta({ ...base, key: "ArrowRight", target: { isContentEditable: true } }), 0);
  console.log("PDF navigation tests passed");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
