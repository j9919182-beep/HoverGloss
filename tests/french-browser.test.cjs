"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const values = { enabledHosts: ["127.0.0.1"], sourceLanguage: "fr", learningMode: true, hoverDelay: 150 };
const get = async (key) => structuredClone(typeof key === "string" ? { [key]: values[key] } : { ...key, ...values });
const set = async (record) => { Object.assign(values, structuredClone(record)); };
const storeContext = { chrome: { storage: { local: { get, set } } }, crypto: webcrypto, TextEncoder, URL };
vm.runInNewContext(fs.readFileSync(path.join(root, "learning-store.js"), "utf8"), storeContext);
const store = storeContext.HoverGlossLearningStore;
const translations = [], speeches = [];
async function message(message) {
  switch (message.type) {
    case "translate": translations.push(message.payload); return { ok: true, delegate: "browser", source: "browser" };
    case "learningSave": return { ok: true, ...await store.save(message.entry) };
    case "learningList": return { ok: true, entries: await store.list(message.language) };
    case "learningEdit": return { ok: true, ...await store.edit(message.id, message.patch, message.language) };
    case "learningReview": return { ok: true, ...await store.review(message.id, message.rating, message.language) };
    case "learningDelete": return { ok: true, ...await store.remove(message.id, message.language) };
    default: return { ok: false, error: "Unexpected message: " + message.type };
  }
}
async function run() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/french-fixture.html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(`<!doctype html><html lang="fr"><title>Lecture française</title><link rel="stylesheet" href="content.css"><body style="margin:90px;font:28px Arial"><h1>Lecture française</h1><p id="sentence">L’économie française évolue rapidement.</p><p id="elision">Aujourd’hui, l’école accueille les élèves.</p><script src="rules.js"></script><script src="browser-translator.js"></script><script src="context-aligner.js"></script><script src="word-senses.js"></script><script src="pronunciation.js"></script><script src="content.js"></script></body></html>`);
    }
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      const data = fs.readFileSync(file);
      res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.route(/^https:\/\//, (route) => route.abort());
    await context.exposeFunction("hgGet", get); await context.exposeFunction("hgSet", set);
    await context.exposeFunction("hgMessage", message);
    await context.exposeFunction("hgSpeech", (record) => { speeches.push(record); });
    await context.addInitScript(() => {
      window.chrome = { runtime: { sendMessage: window.hgMessage, getURL: (name) => location.origin + "/" + name },
        storage: { local: { get: window.hgGet, set: window.hgSet }, onChanged: { addListener() {} } } };
      const voices = [{ name: "French test voice", lang: "fr-FR", localService: true }, { name: "English test voice", lang: "en-US", localService: true }];
      Object.defineProperty(window, "speechSynthesis", { value: {
        speaking: false, getVoices: () => voices, addEventListener() {}, removeEventListener() {}, cancel() {},
        speak(utterance) { window.hgSpeech({ text: utterance.text, language: utterance.lang }); setTimeout(() => utterance.onend?.(), 0); }
      } });
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      window.Translator = {
        async availability() { return "available"; },
        async create(options) {
          return { async translate(text) {
            if (options.sourceLanguage !== "fr") throw new Error("French was routed to English");
            return text.includes("économie") && text.includes("française") ? "法国经济正在迅速发展。" :
              /économie/.test(text) ? "经济" : "学校";
          }, destroy() {} };
        }
      };
    });
    const errors = []; context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const reader = await context.newPage(); await reader.goto(origin + "/french-fixture.html");
    async function hoverText(selector, text) {
      const point = await reader.locator(selector).evaluate((element, text) => {
        const node = element.firstChild, index = node.textContent.indexOf(text);
        const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + text.length);
        const rect = range.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, text);
      await reader.mouse.move(point.x, point.y);
    }
    await reader.keyboard.down("Alt"); await hoverText("#sentence", "économie");
    await reader.waitForSelector(".cht-study-save"); await reader.keyboard.up("Alt");
    assert.equal(translations.at(-1).sourceLanguage, "fr");
    assert.ok(/française|économie/.test(translations.at(-1).target));
    const card = reader.locator("#concise-hover-translator");
    await card.locator(".cht-study-save").first().click();
    await reader.waitForFunction(() => document.querySelector(".cht-study-save")?.textContent.includes("已加入"));
    const french = await store.list("fr");
    assert.equal(french.length, 1); assert.equal((await store.list()).length, 0);
    assert.equal(french[0].context, "L'économie française évolue rapidement.");
    assert.equal(french[0].origin.title, "Lecture française");
    await card.locator(".cht-pronounce").first().click();
    assert.equal(speeches.at(-1).language, "fr-FR");
    // Accent, ligature and apostrophe extraction at the real browser caret.
    await reader.mouse.click(15, 15);
    await reader.keyboard.down("Alt");
    await hoverText("#elision", "école");
    await reader.waitForFunction(() => document.querySelector(".cht-target")?.textContent === "l'école");
    assert.equal(translations.at(-1).target, "l'école");
    assert.equal(translations.at(-1).context, "Aujourd'hui, l'école accueille les élèves.");
    assert.equal(translations.at(-1).targetStart, 13);
    await reader.evaluate(() => {
      const element = document.querySelector("#sentence");
      const range = document.createRange(); range.selectNodeContents(element);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    // Wait for the actual request rather than relying on a card from the previous word.
    await reader.waitForFunction(() => document.querySelector("#concise-hover-translator")?.textContent.includes("法国经济"));
    assert.equal(translations.at(-1).kind, "sentence");
    assert.equal(translations.at(-1).sourceLanguage, "fr");
    await reader.keyboard.up("Alt");
    await store.save({ term: "pain", meaning: "疼痛", context: "The pain eased.", origin: { title: "English source", url: "https://example.test/en" } });
    const library = await context.newPage(); await library.goto(origin + "/learning.html?language=fr");
    await library.waitForFunction(() => document.querySelector("#term").textContent.length > 0);
    assert.equal(await library.locator("#libraryTitle").textContent(), "法语学习库");
    assert.equal(await library.locator("#context").textContent(), french[0].context);
    await library.locator("#contextAudio button").click();
    assert.deepEqual(speeches.at(-1), { text: french[0].context, language: "fr-FR" });
    await library.locator("#startReview").click(); await library.locator("#showAnswer").click();
    await library.locator("#reviewRemember").click();
    await library.waitForFunction(() => /已复习 1 次/.test(document.querySelector("#metadata").textContent));
    await library.locator("#libraryLanguage").selectOption("en");
    await library.waitForFunction(() => document.querySelector("#term").textContent === "pain");
    assert.equal(await library.locator("#context").textContent(), "The pain eased.");
    assert.equal((await store.list())[0].reviews, 0);
    await library.locator("#libraryLanguage").selectOption("fr");
    await library.waitForFunction(() => /已复习 1 次/.test(document.querySelector("#metadata").textContent));
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await library.screenshot({ path: path.join(root, "test-results/french-library-v0.9.22.png") });
    const options = await context.newPage(); await options.goto(origin + "/options.html");
    await options.waitForFunction(() => document.querySelector("#sourceLanguage").value === "fr" && /法中/.test(document.querySelector("#localTranslatorStatus").textContent));
    await options.locator("#prepareLocalTranslator").click();
    await options.waitForFunction(() => /法中.*已就绪/.test(document.querySelector("#localTranslatorStatus").textContent));
    await options.locator("#save").click();
    await options.waitForFunction(() => document.querySelector("#saveStatus").textContent === "已保存");
    assert.equal(values.sourceLanguage, "fr");
    assert.deepEqual(errors, []);
    console.log("Real Edge French hover, original sentence capture, separate libraries/review and French word/sentence voice routing passed (translation and speech providers mocked)");
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
