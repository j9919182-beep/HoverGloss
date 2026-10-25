"use strict";

const assert = require("node:assert/strict");
const pdf = require("../pdf-source.js");

assert.equal(pdf.isPdfPage("https://example.org/article.PDF?download=1"), true);
assert.equal(pdf.isPdfPage("file:///C:/papers/test.pdf"), true);
assert.equal(pdf.isPdfPage("https://example.org/article.html"), false);
assert.equal(pdf.isAllowedRemoteUrl("https://example.org/article.pdf"), true);
assert.equal(pdf.isAllowedRemoteUrl("http://example.org/article.pdf"), false);
assert.equal(pdf.isAllowedRemoteUrl("https://user:pass@example.org/a.pdf"), false);
assert.equal(pdf.hasPdfHeader(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])), true);
assert.equal(pdf.hasPdfHeader(new Uint8Array([60, 104, 116, 109, 108, 62])), false);
assert.equal(pdf.MAX_PDF_BYTES, 60 * 1024 * 1024);

console.log("PDF source tests passed");
