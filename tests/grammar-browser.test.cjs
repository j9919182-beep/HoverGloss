const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createHarness, root, analysis } = require("./grammar-fixture.cjs");
async function run() {
  const h = createHarness(); const entry = await h.seed(); h.data.aiKey = "";
  const server = http.createServer((req, res) => {
    const name = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname);
    if (!name.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8"); res.end(fs.readFileSync(name)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({ viewport: { width: 1250, height: 1000 } });
    await context.route(/^https:\/\//, (route) => route.abort());
    await context.exposeFunction("hgGet", h.get); await context.exposeFunction("hgSet", h.set); await context.exposeFunction("hgSend", h.send);
    await context.addInitScript(() => {
      window.chrome = { runtime: { sendMessage: window.hgSend, getURL: (name) => location.origin + "/" + name },
        storage: { local: { get: window.hgGet, set: window.hgSet }, onChanged: { addListener() {} } } };
      Object.defineProperty(window, "speechSynthesis", { value: { getVoices: () => [], cancel() {}, addEventListener() {}, removeEventListener() {} } });
    });
    const page = await context.newPage(), errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/learning.html?language=fr`);
    await page.waitForFunction(() => document.querySelector("#grammar").textContent.includes("尚未配置"));
    assert.equal(await page.locator("#grammar .local-grammar").isVisible(), true);
    assert.match(await page.locator("#grammar .local-grammar").textContent(), /manger.*现在时/);
    assert.match(await page.locator("#grammar .local-grammar").textContent(), /免费.*离线/);
    await page.locator("#grammar .local-points summary").click();
    assert.match(await page.locator("#grammar .local-points").textContent(), /否定线索/);
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await page.locator("#grammar").screenshot({ path: path.join(root, "test-results/french-grammar-offline-v0.9.24.png") });
    assert.equal(await page.locator("#grammar button").isDisabled(), true);
    assert.equal(h.requests.length, 0, "Opening library sends no AI requests");
    await context.setOffline(true);
    await page.locator("#refreshLibrary").click();
    assert.match(await page.locator("#grammar .local-grammar").textContent(), /manger.*现在时/);
    assert.equal(h.requests.length, 0, "Offline grammar requires no provider request");
    await context.setOffline(false);
    // Settings link keeps local translation selected while revealing grammar credentials.
    const options = await context.newPage();
    await options.goto(`http://127.0.0.1:${server.address().port}/options.html?grammar=1#aiEndpoint`);
    await options.waitForFunction(() => document.querySelector("#provider").value === "browser");
    assert.equal(await options.locator("#aiFields").isVisible(), true);
    assert.match(await options.locator("#aiNote").textContent(), /手动语法解析/);
    await options.close();
    h.data.aiKey = "test-only-key";
    await page.locator("#refreshLibrary").click();
    await page.waitForFunction(() => !document.querySelector("#grammar button").disabled);
    await page.locator(".edit summary").click();
    await page.locator("#notes").fill("保留我的笔记");
    await page.locator("#grammar .grammar-ai > summary").click();
    await page.locator("#grammar button").click();
    await page.waitForSelector("#grammar .grammar-parts");
    assert.match(await page.locator("#grammar").textContent(), /主语 · Je/);
    assert.match(await page.locator("#grammar").textContent(), /直陈式现在时/);
    assert.equal(await page.locator("#notes").inputValue(), "保留我的笔记", "Grammar must not reset unsaved learning notes");
    assert.equal(h.requests.length, 1);
    await page.reload(); await page.waitForSelector("#grammar .grammar-parts");
    assert.equal(h.requests.length, 1, "Reload reuses saved grammar");
    await page.locator("#grammar .grammar-points summary").click();
    assert.match(await page.locator("#grammar .grammar-points").textContent(), /部分冠词/);
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await page.locator("#grammar").screenshot({ path: path.join(root, "test-results/french-grammar-v0.9.24.png") });
    await page.locator("#startReview").click();
    assert.equal(await page.locator("#reviewGrammar").isVisible(), false);
    await page.locator("#showAnswer").click();
    assert.match(await page.locator("#reviewGrammar").textContent(), /主语 · Je/);
    assert.equal(await page.locator("#reviewGrammar .local-grammar").isVisible(), true);
    assert.equal(h.requests.length, 1, "Review does not automatically request grammar");
    await page.locator("#exitReview").click();
    // A failed regeneration keeps the previous explanation, and offers a working retry.
    h.state.reply = async () => ({ ok: false, status: 429 });
    await page.locator("#grammar button").click();
    await page.waitForFunction(() => document.querySelector("#grammar .grammar-status").textContent.includes("429"));
    assert.equal(await page.locator("#grammar .grammar-parts").count(), 1);
    let release;
    h.state.reply = () => new Promise((resolve) => { release = resolve; });
    await page.locator("#grammar button").click();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 10));
    await page.locator("#libraryLanguage").selectOption("en");
    await page.waitForFunction(() => document.querySelector("#term").textContent === "pain");
    release({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(analysis) } }] }) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator("#grammar").isVisible(), false, "Late French result must not appear in English library");
    await page.locator("#libraryLanguage").selectOption("fr");
    await page.waitForSelector("#grammar .grammar-parts");
    assert.equal((await h.store.list("fr"))[0].id, entry.id);
    assert.equal(h.requests.length, 3);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Grammar layout should fit narrow viewports");
    assert.deepEqual(errors, []);
    console.log("Edge grammar UI: configuration, generation, cache, review, failure/retry, language switch and narrow layout passed (AI mocked).");
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
