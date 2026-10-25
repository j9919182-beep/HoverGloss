"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(process.env.HOVERGLOSS_EXTENSION_ROOT || path.join(__dirname, ".."));
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hovergloss-release-profile-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: process.platform === "win32" ? "msedge" : "chromium", headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;
    assert.match(extensionId, /^[a-p]{32}$/);
    const before = await worker.evaluate(() => chrome.storage.local.get(null));
    assert.equal(before.aiKey, undefined); assert.equal(before.hoverglossLearningV1, undefined);
    const errors = [];
    const options = await context.newPage(); options.on("pageerror", (error) => errors.push(error.message));
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForFunction(() => !document.querySelector("#localTranslatorStatus").textContent.includes("正在检测"));
    const modelStatus = await options.locator("#localTranslatorStatus").textContent();
    const library = await context.newPage(); library.on("pageerror", (error) => errors.push(error.message));
    await library.goto(`chrome-extension://${extensionId}/learning.html`);
    await library.waitForFunction(() => document.querySelector("#stats").textContent.includes("0 条"));
    await library.locator("#libraryLanguage").selectOption("fr");
    await library.waitForFunction(() => document.querySelector("#libraryTitle").textContent.includes("法语"));
    assert.match(await library.locator("#stats").textContent(), /0 条/);
    await context.route("https://www.youtube.com/**", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><title>HoverGloss synthetic video</title><div id="movie_player" class="html5-video-player"><video></video><div class="caption-window"><span class="ytp-caption-segment">An English caption for testing.</span></div></div>' }));
    const video = await context.newPage(); await video.goto("https://www.youtube.com/watch?v=hgFixture1");
    const popup = await context.newPage(); popup.on("pageerror", (error) => errors.push(error.message));
    await worker.evaluate(async () => { const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" }); await chrome.tabs.update(tabs[0].id, { active: true }); });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForFunction(() => !document.querySelector("#captionsEnabled").disabled, { timeout: 10000 });
    assert.equal(await popup.locator("#captionsEnabled").isChecked(), false);
    assert.equal(await popup.locator("#learningMode").isChecked(), false);
    if (process.env.HOVERGLOSS_RELEASE_SCREENSHOTS === "1") {
      const destination = path.join(root, "docs", "images");
      fs.mkdirSync(destination, { recursive: true });
      await popup.locator(".popup-shell").screenshot({ path: path.join(destination, "popup.png") });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ freshProfile: true, realExtensionLoaded: true, version: await worker.evaluate(() => chrome.runtime.getManifest().version),
      englishAndFrenchLibrariesEmpty: true, captionsPortReady: true, modelStatus, modelDownloadStarted: false,
      limitations: "Synthetic YouTube DOM only; no real model translation, audio capture or live website subtitles tested." }));
  } finally {
    await context?.close();
    const resolved = path.resolve(profile), prefix = path.resolve(os.tmpdir()) + path.sep + "hovergloss-release-profile-";
    if (!resolved.startsWith(prefix)) throw new Error("Unexpected temporary profile path");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
