"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const manifest = JSON.parse(read("manifest.json"));
assert.equal(manifest.version, JSON.parse(read("package.json")).version);
assert.ok(manifest.permissions.includes("sidePanel"));
assert.ok(!manifest.permissions.includes("tabCapture"));
assert.deepEqual(manifest.optional_permissions, ["tabCapture"]);
assert.equal(manifest.side_panel.default_path, "live-captions.html");
const adapter = manifest.content_scripts.find((entry) => entry.js.includes("youtube-captions.js"));
assert.deepEqual(adapter.matches, ["https://www.youtube.com/*", "https://youtube.com/*", "https://www.bilibili.com/*", "https://bilibili.com/*"]);
assert.ok(adapter.js.indexOf("caption-sites.js") < adapter.js.indexOf("youtube-captions.js"));
assert.ok(adapter.js.indexOf("live-captions-core.js") < adapter.js.indexOf("youtube-captions.js"));
assert.ok(adapter.js.includes("player-captions.js"));
assert.ok(adapter.js.indexOf("cc-session.js") > adapter.js.indexOf("live-captions-core.js"));
assert.ok(adapter.js.indexOf("cc-session.js") < adapter.js.indexOf("youtube-captions.js"));
assert.ok(adapter.js.indexOf("live-captions-core.js") < adapter.js.indexOf("player-captions.js"));
assert.ok(adapter.js.indexOf("player-captions.js") < adapter.js.indexOf("youtube-captions.js"));
for (const asset of adapter.js) assert.ok(fs.statSync(path.join(root, asset)).isFile());
for (const html of ["popup.html", "live-captions.html"]) {
  for (const match of read(html).matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(fs.statSync(path.join(root, match[1])).isFile());
}
const panel = read("live-captions.html");
assert.ok(panel.indexOf('src="browser-translator.js"') < panel.indexOf('src="live-captions.js"'));
assert.ok(panel.indexOf('src="live-captions-core.js"') < panel.indexOf('src="live-captions.js"'));
for (const name of ["audio-captions-core.js", "tab-audio-capture.js", "local-asr-client.js"]) assert.ok(panel.indexOf(`src="${name}"`) < panel.indexOf('src="live-captions.js"'));
for (const asset of ["tab-audio-worklet.js", "vendor/local-asr/asr-worker.mjs", "vendor/local-asr/LICENSE-TRANSFORMERS"]) assert.ok(fs.statSync(path.join(root, asset)).isFile());
const popupSource = read("popup.js"), popupHTML = read("popup.html");
async function popup(url, expected) {
  const ids = Object.fromEntries([...popupHTML.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], { disabled: false, hidden: match[1] === "liveCaptionsPanel", value: "", listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } }]));
  const opened = [];
  const context = {
    window: { addEventListener() {} },
    document: { querySelector: (selector) => ids[selector.slice(1)], querySelectorAll: () => [] }, URL,
    HoverGlossPdfSource: { isPdfPage: () => false }, HoverGlossSearchSites: { siteFor: () => null }, HoverGlossLiveCaptions: require("../live-captions-core.js"), setTimeout: () => {},
    chrome: { tabs: { query: async () => [{ id: 42, url }] },
      storage: { local: { get: async (defaults) => defaults } },
      runtime: { sendMessage: async () => ({}) },
      sidePanel: { open: (options) => { opened.push(options); return Promise.resolve(); } }
    }
  };
  vm.runInNewContext(popupSource, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ids.liveCaptionsPanel.hidden, !expected);
  ids.openLiveCaptions.listeners.click();
  assert.equal(opened.length, expected ? 1 : 0, "sidePanel.open must run synchronously from the click");
  if (expected) assert.equal(opened[0].tabId, 42);
}
(async () => {
  await popup("https://www.youtube.com/watch?v=abc12345678", true);
  await popup("https://www.youtube.com/", false);
  await popup("https://www.youtube.com/shorts/abc12345678", false);
  await popup("https://github.com", false);
  await popup("https://www.bilibili.com/video/BV1xx411c7mD/?p=2", true);
  await popup("https://www.bilibili.com/video/av12345/", true);
  await popup("https://www.bilibili.com/", false);
  await popup("https://live.bilibili.com/12345", false);
  await popup("https://www.bilibili.com/bangumi/play/ep12345", false);
  console.log("live captions manifest and popup entry: passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
