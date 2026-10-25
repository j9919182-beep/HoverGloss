"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http"), vm = require("node:vm"), crypto = require("node:crypto");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const values = {}; let writes = 0;
  const storeContext = { URL, crypto, TextEncoder, chrome: { storage: { local: {
    get: async (key) => structuredClone({ [key]: values[key] }), set: async (data) => { writes++; Object.assign(values, structuredClone(data)); }
  } } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "learning-store.js"), "utf8"), storeContext);
  const store = storeContext.HoverGlossLearningStore;
  const sample = { term: "prime", meaning: "首要的", context: "The prime minister spoke.", sentenceTranslation: "总理发言。", language: "en",
    origin: { type: "pdf", title: "Book.pdf", fingerprint: "book", page: 5 } };
  const seeded = (await store.save(sample)).entry;
  await store.edit(seeded.id, { meaning: "手动释义", notes: "手动笔记", confirmed: true }); await store.review(seeded.id, "remember");
  const server = http.createServer((req, res) => {
    const name = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname);
    if (!name.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8"); res.end(fs.readFileSync(name)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 850 } }), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.exposeFunction("hgMessage", async (message) => {
      try {
        if (message.type === "learningList") return { ok: true, entries: await store.list(message.language) };
        if (message.type === "learningImportPreview") return { ok: true, ...await store.previewImport(message.document, message.language) };
        if (message.type === "learningImport") return { ok: true, ...await store.importLibrary(message.document, message.language) };
        return { ok: true, ready: false };
      } catch (error) { return { ok: false, error: error.message }; }
    });
    await page.addInitScript(() => {
      window.chrome = { runtime: { sendMessage: window.hgMessage }, storage: {
        local: { get: async (defaults) => ({ ...defaults }), set: async () => {} }, onChanged: { addListener() {} }
      } };
      Object.defineProperty(window, "speechSynthesis", { value: { getVoices: () => [], addEventListener() {}, cancel() {} } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/learning.html`);
    await page.waitForFunction(() => document.querySelector("#term").textContent === "prime");
    const upload = async (backup) => page.locator("#importFile").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(typeof backup === "string" ? backup : JSON.stringify(backup)) });
    const backup = { app: "HoverGloss", version: 1, language: "en", entries: [
      { ...sample, meaning: "备份释义", phrase: "prime minister", phraseTranslation: "总理" },
      { ...sample, term: "decision", meaning: "决定", context: "A decision was made.", notes: "恢复的笔记", stage: 3, reviews: 5, dueAt: 123456 }
    ] };
    const before = writes;
    await upload(backup);
    await page.locator("#importPreview").waitFor({ state: "visible" });
    assert.match(await page.locator("#importSummary").textContent(), /新增 1 条，重复 1 条/);
    assert.equal(writes, before, "Reading preview must not write");
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await page.locator("#importPreview").screenshot({ path: path.join(root, "test-results/learning-import-v0.9.30.png") });
    await page.locator("#cancelImport").click(); assert.equal(writes, before);
    await upload(backup); await page.locator("#importPreview").waitFor({ state: "visible" });
    await page.locator("#confirmImport").click();
    await page.waitForFunction(() => document.querySelector("#notice").textContent.includes("已导入 1 条"));
    const restored = await store.list(); assert.equal(restored.length, 2);
    assert.equal(restored.find((entry) => entry.term === "prime").meaning, "手动释义");
    assert.equal(restored.find((entry) => entry.term === "prime").phrases.length, 1);
    assert.equal(restored.find((entry) => entry.term === "decision").reviews, 5);
    await upload("not json"); await page.waitForFunction(() => document.querySelector("#notice").textContent !== "");
    assert.equal(await page.locator("#importPreview").isVisible(), false);
    await page.locator("#libraryLanguage").selectOption("fr");
    await page.waitForFunction(() => document.querySelector("#libraryTitle").textContent.includes("法语"));
    await upload(backup); await page.waitForFunction(() => document.querySelector("#notice").textContent.includes("语言"));
    assert.equal((await store.list("fr")).length, 0);
    await upload({ ...backup, language: "fr", entries: [{ ...sample, language: "fr", term: "pain", meaning: "面包", context: "Le pain est frais." }] });
    await page.locator("#importPreview").waitFor({ state: "visible" }); await page.locator("#confirmImport").click();
    await page.waitForFunction(() => document.querySelector("#term").textContent === "pain");
    assert.equal((await store.list()).length, 2); assert.equal((await store.list("fr")).length, 1);
    assert.deepEqual(errors, []);
    console.log("Browser learning import: real file selection, preview/cancel/confirm, duplicate protection, progress restore, invalid JSON and language isolation passed");
  } finally { await browser?.close(); await new Promise((r) => server.close(r)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
