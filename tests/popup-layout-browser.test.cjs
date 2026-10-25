"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const server = http.createServer((req, res) => {
    const name = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname);
    if (!name.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".png") ? "image/png" : "text/html; charset=utf-8"); res.end(fs.readFileSync(name)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });
    const page = await browser.newPage({ viewport: { width: 360, height: 650 } }), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.commands = []; window.settings = {}; window.opened = [];
      const snapshot = { state: "stopped", session: "", options: {}, prepared: true };
      let receive;
      window.emitCaption = (message) => receive({ videoId: "abc12345678", ...message });
      window.chrome = {
        runtime: { getURL: (name) => location.origin + "/" + name, openOptionsPage() {} },
        storage: { local: { get: async (defaults) => ({ ...defaults, ...window.settings }), set: async (data) => Object.assign(window.settings, data) } },
        sidePanel: { setOptions: async () => {}, open: async (options) => window.opened.push(options) },
        tabs: { query: async () => [{ id: 7, url: "https://www.youtube.com/watch?v=abc12345678" }], connect: () => ({
          onMessage: { addListener(fn) { receive = fn; setTimeout(() => window.emitCaption({ type: "ready", protocol: 2, snapshot }), 0); } },
          onDisconnect: { addListener(fn) { window.disconnectCaption = fn; } },
          postMessage(message) {
            window.commands.push(message);
            if (message.type === "toggle-captions") {
              snapshot.state = message.enabled ? "running" : "stopped";
              snapshot.session = message.enabled ? "fixture" : "";
              setTimeout(() => window.emitCaption({ type: "session", snapshot }), 0);
            }
          }, disconnect() {}
        }) }
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
    await page.waitForFunction(() => !document.querySelector("#captionsEnabled").disabled);
    assert.equal(await page.locator("#captionsEnabled").isChecked(), false);
    assert.equal(await page.locator("#modeHint").isVisible(), false);
    assert.equal(await page.locator("#youtubeSearchAutoReplace").isVisible(), false);
    assert.equal(await page.evaluate(() => commands.length), 0, "Popup open never starts translation");
    await page.locator('label[aria-label="开启当前视频自动双语字幕"]').click();
    await page.waitForFunction(() => document.querySelector("#captionStatus").textContent.includes("正在翻译"));
    assert.equal(await page.locator("#captionsEnabled").isChecked(), true);
    assert.equal(await page.evaluate(() => opened.length), 0, "Switch does not open sidebar");
    await page.evaluate(() => emitCaption({ type: "session", snapshot: { state: "running", session: "fixture", message: "暂未检测到英文 CC，请开启字幕并选择英语" } }));
    assert.match(await page.locator("#captionStatus").textContent(), /未检测到英文/);
    await page.evaluate(() => emitCaption({ type: "session", snapshot: { state: "running", session: "fixture", message: "本机翻译失败：模型不可用" } }));
    assert.match(await page.locator("#captionStatus").textContent(), /失败/);
    await page.evaluate(() => emitCaption({ type: "session", snapshot: { state: "paused", session: "fixture" } }));
    assert.equal(await page.locator("#captionsEnabled").isChecked(), false, "Player pause reflected in switch");
    await page.locator('label[aria-label="开启当前视频自动双语字幕"]').click();
    await page.waitForFunction(() => document.querySelector("#captionStatus").textContent.includes("正在翻译"));
    await page.locator('label[aria-label="开启当前视频自动双语字幕"]').click();
    await page.waitForFunction(() => document.querySelector("#captionStatus").textContent === "英文 CC → 中文");
    assert.equal(await page.evaluate(() => commands.filter((m) => m.type === "toggle-captions").at(-1).enabled), false);
    await page.locator("#triggerMode").selectOption("always-hover");
    await page.getByText("快捷键与说明", { exact: true }).click();
    assert.equal(await page.locator("#modeHint").isVisible(), true);
    await page.getByText("快捷键与说明", { exact: true }).click();
    await page.locator('label[aria-label="开启学习模式"]').click();
    await page.locator('label[aria-label="开启英文搜索"]').click();
    await page.waitForFunction(() => settings.learningMode && settings.youtubeSearchEnabled);
    await page.getByText("搜索选项", { exact: true }).click();
    await page.locator("#youtubeSearchAutoReplace").check();
    await page.waitForFunction(() => settings.youtubeSearchAutoReplace);
    await page.getByText("搜索选项", { exact: true }).click();
    await page.locator("#openLiveCaptions").click();
    assert.equal(await page.evaluate(() => opened[0].tabId), 7);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await page.locator(".popup-shell").screenshot({ path: path.join(root, "test-results/popup-compact-v0.9.29.png") });
    const popupHeight = await page.locator(".popup-shell").evaluate((el) => el.offsetHeight);
    assert.ok(popupHeight <= 600, `Default popup fits browser popup height: ${popupHeight}`);
    await page.evaluate(() => disconnectCaption());
    assert.equal(await page.locator("#captionsEnabled").isDisabled(), true);
    assert.match(await page.locator("#captionStatus").textContent(), /刷新/);
    assert.deepEqual(errors, []);
    console.log("Edge popup: compact layout, real controls, CC switch/status/stop/disconnect, settings persistence and no automatic sidebar passed");
  } finally { await browser?.close(); await new Promise((r) => server.close(r)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
