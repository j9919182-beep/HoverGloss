"use strict";

const assert = require("node:assert/strict");
const session = require("../pdf-session.js");

const key = session.progressKey("A1B2C3D4E5F6");
assert.equal(key, "pdfProgress:a1b2c3d4e5f6");
assert.equal(session.progressKey("../other"), null);

const saved = session.progressRecord(5, 1.2);
assert.equal(session.readProgress(saved, 12).page, 5);
assert.equal(session.readProgress(saved, 12).scale, 1.2);
assert.equal(session.readProgress(saved, 4), null, "A changed, shorter PDF cannot restore an invalid page");
assert.equal(session.readProgress({ ...saved, page: 0 }, 12), null);
assert.equal(session.readProgress({ ...saved, scale: 100 }, 12).scale, 1);
assert.equal(session.readProgress({ ...saved, version: 2 }, 12), null);

console.log("PDF reading progress tests passed");
