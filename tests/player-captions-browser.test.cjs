"use strict";
// Real offline Edge DOM/fullscreen; CC, ports and model results are fixtures.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, ".."), url = "https://www.youtube.com/watch?v=abc12345678";
const html = `<!doctype html><html><meta charset="utf-8"><style>
body{background:#111927;color:#e4e9f0;margin:0;font:18px Arial}header{padding:28px}
#movie_player{position:relative;width:960px;height:540px;margin:auto;background:linear-gradient(135deg,#13303f,#274f45);overflow:hidden}
#movie_player:fullscreen{width:100vw;height:100vh}.scene{position:absolute;left:9%;top:30%;font-size:42px}.scene small{display:block;font-size:20px;margin-top:14px}
.ytp-caption-window-container{position:absolute;inset:0;opacity:.8;pointer-events:none}.ytp-caption-segment{position:absolute;left:12%;bottom:70px;font-size:25px;background:#000b;max-width:76%}
video{width:100%;height:100%}#full{position:absolute;top:12px;left:12px}.ytp-subtitles-button{position:absolute;bottom:10px;right:10px}</style>
<header>HoverGloss · OFFLINE SESSION TEST</header><div id="movie_player"><video></video><div class="scene">English first.<small>CC 会话不再依赖侧栏存活</small></div><div class="ytp-caption-window-container"><span class="ytp-caption-segment">A rolling English caption</span></div><button class="ytp-subtitles-button" aria-pressed="true">CC</button><button id="full">Fullscreen</button></div></html>`;
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } }), errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (r) => r.request().url() === url ? r.fulfill({ contentType: "text/html", body: html }) : r.abort());
    await page.goto(url);
    await page.evaluate(() => {
      let connect; window.ports = []; window.jobs = []; window.creates = 0; window.now = 10000; Date.now = () => window.now;
      const intervals = new Map(); let serial = 0;
      window.setInterval = (fn) => { intervals.set(++serial, fn); return serial; }; window.clearInterval = (id) => intervals.delete(id);
      window.tick = (ms = 250) => { window.now += ms; for (const fn of [...intervals.values()]) fn(); };
      window.chrome = { runtime: { onConnect: { addListener(fn) { connect = fn; } } } };
      window.connectFixture = () => {
        const port = { name: "hovergloss-live-captions", messages: [], postMessage(m) { this.messages.push(m); },
          onMessage: { addListener(fn) { port.receive = fn; } }, onDisconnect: { addListener(fn) { port.close = fn; } } };
        window.ports.push(port); connect(port); return port.messages[0];
      };
      window.command = (type, extra = {}) => window.ports.at(-1).receive({ ...extra, type,
        session: window.ports.at(-1).messages.findLast((m) => m.snapshot)?.snapshot.session || "fixture-session", videoId: "abc12345678" });
      window.Translator = { availability: async () => "available", create: () => {
        if (!navigator.userActivation.isActive) throw new Error("trusted page click required");
        window.creates++; return Promise.resolve({ translate: (text) => text === "Hello" ? Promise.resolve("你好") : new Promise((resolve, reject) => window.jobs.push({ text, resolve, reject })) });
      } };
      document.querySelector("#full").onclick = () => document.querySelector("#movie_player").requestFullscreen();
    });
    for (const file of ["browser-translator.js", "live-captions-core.js", "caption-sites.js", "cc-session.js", "player-captions.js", "youtube-captions.js"]) await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), "utf8") });
    const ready = await page.evaluate(() => window.connectFixture()); assert.equal(ready.protocol, 2);
    assert.equal(await page.locator("#hovergloss-cc-session").count(), 0);
    await page.evaluate(() => window.command("arm-start", { player: { mode: "below", fullscreen: true, hold: 4000 } }));
    assert.equal(await page.evaluate(() => window.creates), 0, "Opening controls does not download/start translation");
    await page.getByRole("button", { name: "开始双语字幕", exact: true }).click();
    await page.waitForFunction(() => window.ports[0].messages.some((m) => m.snapshot?.prepared));
    assert.equal(await page.evaluate(() => window.ports[0].messages.findLast((m) => m.snapshot)?.snapshot.state), "running", "One player click prepares and starts CC");
    await page.evaluate(() => {
      for (let i = 0; i < 12; i++) { document.querySelector(".ytp-caption-segment").textContent = `Rolling caption words ${i}`; window.tick(); }
    });
    assert.equal(await page.evaluate(() => window.jobs.length), 1, "rolling CC submits despite no quiet period");
    const firstEnglish = await page.evaluate(() => window.jobs[0].text);
    await page.locator("#full").click(); await page.waitForFunction(() => !!document.fullscreenElement);
    await page.evaluate(() => window.ports.at(-1).close());
    await page.evaluate(() => { window.tick(500); window.jobs[0].resolve("滚动字幕在全屏中继续翻译"); });
    const host = page.locator("#hovergloss-player-captions");
    await host.locator(".chinese").waitFor({ state: "visible" });
    assert.equal(await host.locator(".chinese").textContent(), "滚动字幕在全屏中继续翻译");
    assert.equal(await host.locator(".reference").textContent(), "上一句 · " + firstEnglish);
    assert.equal(await host.evaluate((n) => document.fullscreenElement.contains(n)), true);
    assert.equal(await page.locator(".ytp-caption-window-container").evaluate((n) => getComputedStyle(n).opacity), "0.8");
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
    await page.screenshot({ path: path.join(root, "test-results/player-captions-v0.9.19.png") });
    await page.evaluate(() => document.exitFullscreen());
    const restored = await page.evaluate(() => window.connectFixture());
    assert.equal(restored.snapshot.state, "running"); assert.equal(restored.snapshot.history.length, 1); assert.equal(restored.snapshot.prepared, true);
    assert.equal(await page.evaluate(() => window.creates), 1);
    // Delayed result after seek must never reappear, even with the sidebar gone.
    await page.evaluate(() => { document.querySelector("video").dispatchEvent(new Event("seeking")); window.jobs[1].resolve("错误的迟到译文"); });
    await host.waitFor({ state: "hidden" });
    await page.evaluate(() => {
      document.querySelector(".ytp-caption-segment").textContent = 'Literal <img src=x onerror="window.injected=true">';
      window.command("player-settings", { options: { mode: "bilingual", fullscreen: true } }); window.tick(500);
    });
    assert.equal(await host.locator("img").count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.evaluate(() => { window.jobs.at(-1).reject(new Error("model failure")); });
    await page.waitForFunction(() => window.ports.at(-1).messages.some((m) => m.type === "status" && /model failure/.test(m.message)));
    assert.equal(await page.locator(".ytp-caption-window-container").evaluate((n) => getComputedStyle(n).opacity), "0.8");
    await page.getByRole("button", { name: "停止", exact: true }).click();
    assert.equal(await host.count(), 0);
    assert.equal(await page.getByRole("button", { name: "开始双语字幕", exact: true }).isVisible(), true, "Stop leaves a restart button");
    // Actual Edge overlay and events, with visibility supplied as a tab-switch fixture.
    await page.evaluate(() => {
      window.tabVisibility = "visible";
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.tabVisibility });
      document.querySelector(".ytp-caption-segment").textContent = "Caption before switching";
      window.command("start", { confirmed: true, player: { mode: "below", ratio: 0.8, fullscreen: true } });
      window.tick(500);
    });
    await page.waitForFunction(() => window.jobs.some((job) => job.text === "Caption before switching"));
    await page.evaluate(() => window.jobs.find((job) => job.text === "Caption before switching").resolve("切换前的中文字幕"));
    await page.waitForFunction(() => document.querySelector("#hovergloss-player-captions")?.shadowRoot.querySelector(".chinese")?.textContent === "切换前的中文字幕");
    const jobsBeforeSwitch = await page.evaluate(() => window.jobs.length);
    await page.evaluate(() => {
      window.tabVisibility = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
      window.ports.at(-1).close(); window.tick(60000);
    });
    assert.equal(await host.count(), 1, "Hidden page keeps the on-video caption display");
    assert.equal(await page.evaluate(() => window.jobs.length), jobsBeforeSwitch, "Unchanged CC is not translated again");
    await page.evaluate(() => {
      document.querySelector(".ytp-caption-segment").textContent = "Background CC keeps translating";
      window.tick(500);
    });
    await page.waitForFunction(() => window.jobs.some((job) => job.text === "Background CC keeps translating"));
    await page.evaluate(() => window.jobs.find((job) => job.text === "Background CC keeps translating").resolve("后台字幕继续翻译"));
    await page.waitForFunction(() => document.querySelector("#hovergloss-player-captions")?.shadowRoot.querySelector(".chinese")?.textContent === "后台字幕继续翻译");
    await page.evaluate(() => {
      document.querySelector(".ytp-caption-segment").textContent = "Caption after returning";
      window.tabVisibility = "visible"; document.dispatchEvent(new Event("visibilitychange"));
      for (let i = 0; i < 4; i++) window.tick(500);
    });
    await page.waitForFunction(() => window.jobs.some((job) => job.text === "Caption after returning"));
    await page.evaluate(() => window.jobs.find((job) => job.text === "Caption after returning").resolve("切换回来后自动恢复中文"));
    await page.evaluate(() => window.tick(4500));
    await page.waitForFunction(() => document.querySelector("#hovergloss-player-captions")?.shadowRoot.querySelector(".chinese")?.textContent === "切换回来后自动恢复中文");
    const afterSwitch = await page.evaluate(() => window.connectFixture());
    assert.equal(afterSwitch.snapshot.state, "running");
    assert.equal(afterSwitch.snapshot.session, "fixture-session");
    assert.equal(afterSwitch.snapshot.options.ratio, 0.8);
    assert.equal(afterSwitch.snapshot.history.length, 3);
    assert.equal(await page.evaluate(() => window.creates), 1);
    await page.screenshot({ path: path.join(root, "test-results/captions-tab-return-v0.9.28.png") });
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await page.evaluate(() => {
      window.tabVisibility = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
      window.tabVisibility = "visible"; document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await host.count(), 0, "Explicit stop stays stopped after switching");
    assert.deepEqual(errors, []);

    // A newly created sidebar document hydrates the previously running session.
    const panel = await browser.newPage({ viewport: { width: 380, height: 900 } }), panelErrors = [];
    panel.on("pageerror", (e) => panelErrors.push(e.message));
    const assets = new Set(["live-captions.html", "live-captions.css", "browser-translator.js", "live-captions-core.js", "audio-captions-core.js", "tab-audio-capture.js", "local-asr-client.js", "live-captions.js"]);
    await panel.route("**/*", (r) => {
      const name = new URL(r.request().url()).pathname.slice(1);
      return assets.has(name) ? r.fulfill({ contentType: name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : "text/javascript", body: fs.readFileSync(path.join(root, name)) }) : r.abort();
    });
    await panel.addInitScript((ready) => {
      const event = { addListener() {} }; window.commands = [];
      window.chrome = { runtime: { getURL: (n) => "https://hovergloss.test/" + n }, permissions: { contains: async () => false, onRemoved: event }, tabs: {
        query: async () => [{ id: 1, windowId: 1, url: "https://www.youtube.com/watch?v=abc12345678" }],
        connect() { let receive; const p = { postMessage(m) { window.commands.push(m); }, disconnect() {}, onDisconnect: event, onMessage: { addListener(fn) { receive = fn; } } }; queueMicrotask(() => receive(ready)); return p; },
        onActivated: event, onUpdated: event, onRemoved: event
      } };
    }, restored);
    await panel.goto("https://hovergloss.test/live-captions.html");
    await panel.waitForFunction(() => document.querySelector("#count").textContent === "1 条字幕");
    assert.equal(await panel.locator("#englishConfirmed").isChecked(), true);
    assert.equal(await panel.locator("#pause").isDisabled(), false);
    assert.equal(await panel.locator("#prepare").textContent(), "本机英中翻译已就绪");
    assert.equal(await panel.locator(".chinese").textContent(), "滚动字幕在全屏中继续翻译");
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await panel.screenshot({ path: path.join(root, "test-results/player-controls-v0.9.29.png") });
    assert.deepEqual(panelErrors, []);
    console.log("Offline Edge: trusted page activation, rolling max-wait, inference during sidebar teardown/fullscreen, reconnect snapshot/model reuse, source pairing, seek/error/stop restore, new sidebar hydration/layout: passed (mock CC/model/ports)");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
