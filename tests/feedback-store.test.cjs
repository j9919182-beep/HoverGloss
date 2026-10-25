"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const stored = {};
const sandbox = { URL, TextEncoder, crypto: require("node:crypto"),
  chrome: { storage: { local: { async get(key) { return { [key]: stored[key] }; },
    async set(value) { Object.assign(stored, value); } } }, runtime: { getManifest: () => ({ version: "test-version" }) } } };
vm.runInNewContext(fs.readFileSync(require("node:path").join(__dirname, "../feedback-store.js"), "utf8"), sandbox);
const api = sandbox.HoverGlossFeedbackStore;
const sample = { target: "order", context: "The order determines the order.", targetStart: 25, targetEnd: 30,
  issue: "word", correction: "顺序", result: { translation: "订单", sentenceTranslation: "订单决定顺序。", aiKey: "do-not-store" },
  origin: { type: "pdf", title: "Book.pdf", page: 5, fingerprint: "book", url: "https://user:pass@example.com/book.pdf" } };
async function run() {
  const results = await Promise.all([api.save(sample), api.save(sample),
    api.save({ ...sample, issue: "context", correction: "混入标题" })]);
  assert.equal((await api.list()).length, 2, "Concurrent saves must retain both distinct issues and deduplicate repeated clicks");
  assert.equal(results[1].duplicate, true);
  assert.equal(results[0].entry.targetStart, 25, "The second occurrence must remain the second occurrence");
  assert.equal(results[0].entry.origin.page, 5);
  assert.equal(results[0].entry.origin.url, "https://example.com/book.pdf");
  assert.ok(!JSON.stringify(stored).includes("do-not-store"));
  assert.equal(api.capture({ ...sample, targetStart: 0, targetEnd: 5 }).targetStart, null,
    "An invalid range must not be silently relocated to another occurrence");
  assert.equal(api.capture({ ...sample, context: "order", targetStart: 0, targetEnd: 100 }).targetStart, null);
  await api.remove(results[0].entry.id);
  assert.equal((await api.list()).length, 1);
  assert.throws(() => api.capture({ ...sample, issue: "invalid" }));
  console.log("Feedback concurrency, exact occurrence, snapshot whitelist, duplicate and deletion checks passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
