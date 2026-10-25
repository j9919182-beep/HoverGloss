"use strict";
// Only the changed Bilibili adapter and proportional rendering, using offline
// player markup and mock model/ports. No live-site compatibility claim.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, ".."), url = "https://www.bilibili.com/video/BV1xx411c7mD/?p=1";
const englishText = "There are additional challenges to be solved in terms of training and inference. There are additional challenges to be solved in terms of training and inference.";
const html = `<!doctype html><html><meta charset="utf-8"><style>
body{background:#e6ebee;margin:0;font:18px Arial}header{padding:18px;color:#234}
#bilibili-player{width:960px;margin:auto}.bpx-player-container{position:relative;width:960px;height:540px;background:#fafcfb;overflow:hidden}
.bpx-player-video-area{position:absolute;inset:0}.bpx-player-video-area:fullscreen{width:100vw;height:100vh;background:#fafcfb}
video{width:100%;height:100%}.slide{position:absolute;inset:0;padding:45px 9%;color:#162d3c;pointer-events:none}
h1{font-weight:400;text-align:center;margin:0 0 55px;font-size:36px}.slide p{font-size:23px;line-height:1.6}
.bpx-player-subtitle-wrap{position:absolute;bottom:24px;left:8%;right:8%;text-align:center;opacity:.8}.bpx-player-subtitle-panel-text{color:#fff;background:#000b;font-size:35px}
.bpx-player-dm-mask-wrap{position:absolute;top:12px;left:30%;color:#f90}.controls{position:absolute;bottom:0;height:24px;background:#bbc8;left:0;right:0}#full{position:absolute;top:10px;left:10px}</style>
<header>HoverGloss · B站字幕比例离线样例</header><div id="bilibili-player"><div class="bpx-player-container"><div class="bpx-player-video-area"><video></video><div class="slide"><h1>Conclusion</h1><p>1. Multimodal models create new opportunities.</p><p>2. Training and inference introduce additional challenges.</p><p>3. Learn at your own pace with readable subtitles.</p></div><div class="bpx-player-dm-mask-wrap">这是弹幕，不应被读入字幕</div><div class="bpx-player-subtitle-wrap"><span class="bpx-player-subtitle-panel-text">${englishText}</span></div><div class="controls"></div><button id="full">全屏测试</button></div></div></div></html>`;
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 740 } }), errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (r) => r.request().url() === url ? r.fulfill({ contentType: "text/html", body: html }) : r.abort());
    await page.goto(url);
    await page.evaluate(() => {
      let connect, receive, close; window.messages = []; window.now = 10000; window.jobs = []; Date.now = () => window.now;
      const timers = new Map(); let serial = 0; window.setInterval = (fn) => { timers.set(++serial, fn); return serial; }; window.clearInterval = (id) => timers.delete(id);
      window.tick = (ms = 500) => { window.now += ms; for (const fn of [...timers.values()]) fn(); };
      window.chrome = { runtime: { onConnect: { addListener(fn) { connect = fn; } } } };
      window.attach = () => connect({ name: "hovergloss-live-captions", postMessage(m) { window.messages.push(m); }, onMessage: { addListener(fn) { receive = fn; } }, onDisconnect: { addListener(fn) { close = fn; } } });
      window.command = (type, extra = {}) => receive({ type, session: "bili-test", videoId: "bilibili:BV1xx411c7mD:p1", ...extra }); window.detach = () => close();
      window.Translator = { availability: async () => "available", create: () => {
        if (!navigator.userActivation.isActive) throw new Error("page click required");
        return Promise.resolve({ translate: (text) => text === "Hello" ? Promise.resolve("你好") : new Promise((resolve) => window.jobs.push({ text, resolve })) });
      } };
      document.querySelector("#full").onclick = () => document.querySelector(".bpx-player-video-area").requestFullscreen();
    });
    for (const name of ["browser-translator.js", "live-captions-core.js", "caption-sites.js", "cc-session.js", "player-captions.js", "youtube-captions.js"]) await page.addScriptTag({ content: fs.readFileSync(path.join(root, name), "utf8") });
    await page.evaluate(() => window.attach());
    assert.equal(await page.evaluate(() => window.messages[0].snapshot.options.mode), "bilingual");
    await page.evaluate(() => window.command("prepare-page")); await page.getByRole("button", { name: "启用本机翻译", exact: true }).click();
    await page.waitForFunction(() => window.messages.some((m) => m.snapshot?.prepared));
    await page.evaluate(() => window.command("start", { confirmed: true, player: { mode: "bilingual", size: 22, ratio: 0.9, fullscreen: true } }));
    await page.evaluate(() => window.tick());
    await page.waitForFunction(() => window.jobs.length === 1);
    await page.evaluate(() => window.jobs[0].resolve("这需要在训练和推理方面解决额外的挑战。"));
    const host = page.locator("#hovergloss-player-captions"), english = host.locator(".english"), chinese = host.locator(".chinese");
    await chinese.waitFor({ state: "visible" });
    const metrics = () => host.evaluate((n) => {
      const en = n.shadowRoot.querySelector(".english"), zh = n.shadowRoot.querySelector(".chinese"), a = en.getBoundingClientRect(), b = zh.getBoundingClientRect();
      const own = n.getBoundingClientRect(), player = n.parentElement.getBoundingClientRect();
      return { ratio: parseFloat(getComputedStyle(zh).fontSize) / parseFloat(getComputedStyle(en).fontSize), english: parseFloat(getComputedStyle(en).fontSize), gap: b.top - a.bottom, width: own.width, height: own.height, player: player.height, inside: own.top >= player.top && own.bottom <= player.bottom };
    });
    let m = await metrics(); assert.ok(Math.abs(m.ratio - 0.9) < 0.01); assert.ok(m.gap >= 0 && m.gap <= 5); assert.ok(m.height < m.player * 0.3);
    assert.equal(m.inside, true, "both lines stay inside the positioned player, not the browser viewport");
    assert.equal(await english.textContent(), englishText);
    assert.equal(await english.evaluate((n) => n.getBoundingClientRect().height > parseFloat(getComputedStyle(n).lineHeight)), true, "long English wraps rather than extending offscreen");
    assert.equal(await page.locator(".bpx-player-subtitle-wrap").evaluate((n) => getComputedStyle(n).opacity), "0");
    assert.equal(await page.locator(".bpx-player-dm-mask-wrap").evaluate((n) => getComputedStyle(n).opacity), "1", "do not hide danmaku or slide text");
    fs.mkdirSync(path.join(root, "test-results"), { recursive: true }); await page.screenshot({ path: path.join(root, "test-results/bilibili-captions-v0.9.20.png") });
    const normalSize = m.english;
    await page.locator("#full").click(); await page.waitForFunction(() => !!document.fullscreenElement);
    await page.evaluate(() => { window.tick(); window.detach(); });
    assert.equal(await host.evaluate((n) => document.fullscreenElement.contains(n)), true, "move into inner fullscreen area");
    assert.equal(await chinese.textContent(), "这需要在训练和推理方面解决额外的挑战。", "reparent preserves completed pair");
    m = await metrics(); assert.ok(m.english > normalSize); assert.ok(Math.abs(m.ratio - 0.9) < 0.01);
    await page.evaluate(() => window.command("player-settings", { options: { mode: "bilingual", size: 22, ratio: 0.8, fullscreen: true } }));
    assert.ok(Math.abs((await metrics()).ratio - 0.8) < 0.01);
    await page.evaluate(() => window.command("stop"));
    assert.equal(await host.count(), 0); assert.equal(await page.locator(".bpx-player-subtitle-wrap").evaluate((n) => getComputedStyle(n).opacity), "0.8");
    // No readable CC is not silently treated as OCR or permission to capture audio.
    await page.evaluate(() => { window.attach(); document.querySelector(".bpx-player-subtitle-wrap").remove(); window.command("start", { confirmed: true, player: { mode: "bilingual" } }); window.command("heartbeat"); window.tick(6001); });
    assert.equal(await page.evaluate(() => window.messages.some((m) => m.type === "status" && /压进画面/.test(m.message))), true);
    assert.deepEqual(errors, []);
    console.log("Offline Edge Bilibili: CC-only source, 90%/80% proportion, stacked gap/wrapping, viewport scaling, inner fullscreen reparent, source restore and no-CC limitation: passed (mock model/ports)");
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
