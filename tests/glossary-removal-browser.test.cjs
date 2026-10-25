"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");

async function run() {
  const values = {
    provider: "local", sourceLanguage: "en", topicKeywords: "旧主题", customGlossary: "return=回报",
    aiKey: "test-only-key", aiModel: "test-model", enabledHosts: ["example.test"],
    hoverglossLearningV1: [{ id: "keep-en", target: "return" }],
    hoverglossFrenchLearningV1: [{ id: "keep-fr", target: "pain" }]
  };
  const before = structuredClone(values), writes = [], messages = [], opened = [], errors = [], accesses = [];
  const server = http.createServer((req, res) => {
    const name = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname);
    if (!name.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".png") ? "image/png" : "text/html; charset=utf-8");
      res.end(fs.readFileSync(name));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    await context.route(/^https:\/\//, (route) => { accesses.push(route.request().url()); return route.abort(); });
    await context.exposeFunction("hgGet", (defaults) => {
      const result = { ...defaults };
      for (const key of Object.keys(result)) if (key in values) result[key] = structuredClone(values[key]);
      return result;
    });
    await context.exposeFunction("hgSet", (data) => { writes.push(data); Object.assign(values, data); });
    await context.exposeFunction("hgSend", (message) => { messages.push(message); return { ok: false }; });
    await context.exposeFunction("hgOpen", (record) => { opened.push(record); });
    await context.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", { value: {
        open() { throw new Error("Retired topic DB opened"); },
        deleteDatabase() { throw new Error("Old data deleted"); }
      } });
      window.chrome = {
        runtime: { sendMessage: window.hgSend, getURL: (name) => location.origin + "/" + name, openOptionsPage: () => window.hgOpen({ url: "options.html" }) },
        storage: { local: { get: window.hgGet, set: window.hgSet }, session: { set: window.hgSet } },
        tabs: { query: async () => [{ id: 7, url: "https://example.test/article" }], create: window.hgOpen }
      };
      window.Translator = { availability: async () => "available" };
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/popup.html");
    await page.waitForFunction(() => document.querySelector("#triggerMode").value === "alt-hover");
    assert.equal(await page.locator("#topicKeywords, #buildTopicGlossary, #manageTopics, #manageTopicsNav").count(), 0);
    assert.equal(await page.locator(".popup-nav > *").count(), 4);
    assert.equal(await page.locator("#siteEnabled").isChecked(), true);
    await page.locator("#sourceLanguage").selectOption("fr");
    await page.waitForFunction(() => document.querySelector("#readingLanguageLabel").textContent === "Français");
    await page.locator("#openLearning").click();
    await page.locator("#openPdf").click();
    await page.locator("#openDemo").click();
    await page.locator('label[aria-label="开启学习模式"]').click();
    assert.equal(await page.locator("#learningMode").isChecked(), true);
    await page.waitForFunction(() => document.querySelector("#notice").textContent.includes("学习模式已开启"));
    assert.ok(opened.some((entry) => entry.url.endsWith("learning.html?language=fr")));
    assert.ok(opened.some((entry) => entry.url.endsWith("pdf.html")));
    assert.ok(opened.some((entry) => entry.url.endsWith("demo.html")));
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await page.locator(".popup-shell").screenshot({ path: path.join(root, "test-results/glossary-removed-popup-v0.9.26.png") });

    await page.goto(base + "/options.html");
    await page.waitForFunction(() => document.querySelector("#provider").value === "browser");
    assert.equal(await page.locator('#provider option[value="local"], #customGlossary').count(), 0);
    assert.equal(await page.locator("#aiFields").isVisible(), false);
    await page.locator("#save").click();
    await page.waitForFunction(() => document.querySelector("#saveStatus").textContent === "已保存");
    assert.equal(values.provider, "browser");
    assert.equal(values.learningMode, true);
    for (const key of ["topicKeywords", "customGlossary", "hoverglossLearningV1", "hoverglossFrenchLearningV1"]) {
      assert.deepEqual(values[key], before[key], `${key} preserved`);
      assert.ok(writes.every((data) => !(key in data)), `${key} never overwritten`);
    }
    await page.goto(base + "/options.html?grammar=1#aiEndpoint");
    await page.waitForFunction(() => !document.querySelector("#aiFields").hidden);
    assert.equal(await page.locator("#provider").inputValue(), "browser");
    await page.goto(base + "/topics.html");
    assert.match(await page.locator("h1").textContent(), /已移除/);
    assert.equal(await page.locator("script, input, button").count(), 0);
    assert.equal(await page.locator('a[href*="learning.html"]').count(), 2);
    assert.deepEqual(messages, [], "No topic generation or translation requests on settings/popup load");
    assert.deepEqual(accesses, [], "No external requests");
    assert.deepEqual(errors, []);
    console.log("Edge: glossary UI removal, legacy settings migration, navigation, grammar settings and learning-data preservation passed");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
