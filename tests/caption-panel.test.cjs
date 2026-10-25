"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const core = require("../live-captions-core.js");
const turn = () => new Promise((resolve) => setImmediate(resolve));
(async () => {
  const calls = [], events = {}, tabs = [{ id: 1, url: "https://www.youtube.com/watch?v=abc12345678" },
    { id: 2, url: "https://www.bing.com/search?q=test" }, { id: 3, url: "https://www.bilibili.com/video/BV1xx411c7mD/" }];
  vm.runInNewContext(fs.readFileSync(require.resolve("../caption-panel.js"), "utf8"), {
    HoverGlossLiveCaptions: core, chrome: {
      sidePanel: { async setOptions(options) { calls.push(options); } },
      tabs: { async query() { return tabs; }, async get(id) { return tabs.find((t) => t.id === id); },
        onUpdated: { addListener(fn) { events.updated = fn; } }, onActivated: { addListener(fn) { events.activated = fn; } } }
    }
  });
  await turn();
  assert.equal(calls[0].enabled, false); assert.equal(calls[0].tabId, undefined);
  assert.equal(calls.find((c) => c.tabId === 1).path, "live-captions.html?tabId=1");
  assert.equal(calls.find((c) => c.tabId === 1).enabled, true);
  assert.equal(calls.find((c) => c.tabId === 2).enabled, false);
  assert.equal(calls.find((c) => c.tabId === 3).enabled, true);
  events.activated({ tabId: 2 }); await turn(); assert.equal(calls.at(-1).enabled, false);
  events.updated(1, { url: "https://example.com" }, {}); await turn();
  assert.equal(calls.at(-1).tabId, 1); assert.equal(calls.at(-1).enabled, false);
  events.updated(1, { url: tabs[0].url }, {}); await turn(); assert.equal(calls.at(-1).enabled, true);
  console.log("Tab-specific panel: global fallback disabled, YouTube/Bilibili scoped, other websites hidden, SPA navigation handled");
})().catch((error) => { console.error(error); process.exitCode = 1; });
