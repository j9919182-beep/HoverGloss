"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
assert.match(source, /\}\)\(\);\s*$/);

const listeners = new Map();
const timers = new Map();
const messages = [];
const replies = [];
let nextTimer = 0;
let storageListener;
const inside = { id: "inside" };
const outside = { id: "outside" };
const fakeTooltip = {
  style: { display: "none" },
  contains(target) { return target === inside; }
};
const sandbox = {
  fakeTooltip,
  location: { protocol: "chrome-extension:", pathname: "/pdf.html" },
  document: {
    addEventListener(name, listener) { listeners.set(name, listener); }
  },
  chrome: {
    storage: {
      local: { async get(defaults) { return defaults; } },
      onChanged: { addListener(listener) { storageListener = listener; } }
    },
    runtime: {
      sendMessage(message) {
        messages.push(message);
        return new Promise((resolve) => replies.push(resolve));
      }
    }
  },
  ConciseHoverRules: {
    isBlockedElement() { return false; },
    shouldSkipTarget() { return false; }
  },
  setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); }
};
const exposed = `
  showTooltip = function () { tooltip = globalThis.fakeTooltip; tooltip.style.display = "block"; };
  globalThis.testHover = {
    requestTranslation, onMouseMove, hideTooltip,
    setHit(hit) { getWordAtPoint = () => hit; },
    state() { return { hoverSticky, tooltipPinned, lastKey }; }
  };
})();`;
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, exposed), sandbox, { filename: "content.js" });

async function run() {
  await new Promise(setImmediate);
  assert.equal(typeof listeners.get("mousedown"), "function");
  sandbox.testHover.requestTranslation("conflicting", { left: 10, top: 10, width: 20, height: 10 }, outside,
    "word", "These are conflicting lessons.", false);
  assert.equal(fakeTooltip.style.display, "block");
  assert.equal(sandbox.testHover.state().hoverSticky, true);

  sandbox.testHover.setHit(null);
  sandbox.testHover.onMouseMove({ target: outside, altKey: false });
  sandbox.testHover.onMouseMove({ target: outside, altKey: true, clientX: 10, clientY: 10 });
  sandbox.testHover.onMouseMove({ target: inside, altKey: true });
  listeners.get("keyup")({ key: "Alt" });
  listeners.get("scroll")({ target: outside });
  assert.equal(fakeTooltip.style.display, "block", "Leaving the source word must not dismiss the card");
  listeners.get("mousedown")({ target: inside });
  assert.equal(fakeTooltip.style.display, "block", "Clicking the evidence area must keep the card open");
  listeners.get("mousedown")({ target: outside });
  assert.equal(fakeTooltip.style.display, "none", "An outside click should dismiss the card");

  sandbox.testHover.requestTranslation("first", { left: 10, top: 10, width: 20, height: 10 }, outside,
    "word", "The first lesson.", false);
  const firstCount = messages.length;
  sandbox.testHover.setHit({
    text: "second", rect: { left: 30, top: 10, width: 20, height: 10 }, element: outside,
    context: "The second lesson."
  });
  sandbox.testHover.onMouseMove({ target: outside, altKey: true, clientX: 30, clientY: 10 });
  assert.equal(timers.size, 1);
  sandbox.testHover.onMouseMove({ target: inside, altKey: true });
  assert.equal(timers.size, 0, "Moving into the card cancels a pending replacement translation");
  assert.equal(messages.length, firstCount);

  sandbox.testHover.onMouseMove({ target: outside, altKey: true, clientX: 30, clientY: 10 });
  const pending = [...timers.values()][0];
  assert.equal(typeof pending, "function");
  pending();
  assert.equal(messages.length, firstCount + 1, "A deliberate hover over a different word updates the card");
  listeners.get("keydown")({ key: "Escape", altKey: false });
  assert.equal(fakeTooltip.style.display, "none", "Escape should also dismiss the card");

  sandbox.location.pathname = "/demo.html";
  const wordHit = {
    text: "query", rect: { left: 10, top: 10, width: 20, height: 10 }, element: outside,
    context: "Run this query."
  };
  const hoverEvent = { target: outside, altKey: true, clientX: 10, clientY: 10 };
  function startWebHover() {
    sandbox.testHover.hideTooltip();
    sandbox.testHover.setHit(wordHit);
    sandbox.testHover.onMouseMove(hoverEvent);
    const timer = [...timers.values()][0];
    assert.equal(typeof timer, "function");
    timer();
    assert.equal(fakeTooltip.style.display, "block");
    assert.equal(sandbox.testHover.state().hoverSticky, false);
  }
  startWebHover();
  sandbox.testHover.onMouseMove(hoverEvent);
  assert.equal(fakeTooltip.style.display, "block", "Small movement within the same word keeps the web card visible");
  sandbox.testHover.setHit(null);
  sandbox.testHover.onMouseMove(hoverEvent);
  assert.equal(fakeTooltip.style.display, "none", "Leaving a web word closes its hover card without clicking");
  replies.at(-1)({ ok: false, error: "Late reply" });
  await new Promise(setImmediate);
  assert.equal(fakeTooltip.style.display, "none", "A late translation reply must not reopen the dismissed card");

  startWebHover();
  sandbox.testHover.setHit({ ...wordHit, text: "next", rect: { ...wordHit.rect, left: 40 } });
  sandbox.testHover.onMouseMove(hoverEvent);
  assert.equal(fakeTooltip.style.display, "none", "Moving to another word immediately clears the previous result");
  assert.equal(timers.size, 1, "The next word still uses the configured hover delay");
  sandbox.testHover.setHit(null);
  sandbox.testHover.onMouseMove(hoverEvent);
  assert.equal(timers.size, 0, "Leaving before the hover delay cancels the pending translation");

  for (const [type, event] of [["keyup", { key: "Alt" }], ["scroll", { target: outside }], ["mouseleave", {}]]) {
    startWebHover();
    listeners.get(type)(event);
    assert.equal(fakeTooltip.style.display, "none", `${type} dismisses a web hover card`);
  }
  sandbox.testHover.requestTranslation("Run this query.", wordHit.rect, outside, "sentence", "Run this query.", true);
  sandbox.testHover.onMouseMove({ target: outside, altKey: false });
  listeners.get("scroll")({ target: outside });
  assert.equal(fakeTooltip.style.display, "block", "Explicitly selected sentence translations remain readable");
  listeners.get("mousedown")({ target: outside });
  assert.equal(fakeTooltip.style.display, "none");
  storageListener({ learningMode: { newValue: true } }, "local");
  startWebHover();
  sandbox.testHover.setHit(null);
  sandbox.testHover.onMouseMove({ target: outside, altKey: false });
  assert.equal(fakeTooltip.style.display, "block", "Learning mode allows time to move into the save button");
  assert.equal(timers.size, 1);
  sandbox.testHover.onMouseMove({ target: inside, altKey: false });
  assert.equal(timers.size, 0, "Entering the card cancels its delayed dismissal");
  storageListener({ hoverglossLearningV1: { newValue: { entries: [] } } }, "local");
  assert.equal(fakeTooltip.style.display, "block", "Saving a study record must not close its own card");
  sandbox.testHover.onMouseMove({ target: outside, altKey: false });
  const dismiss = [...timers.values()][0];
  dismiss();
  assert.equal(fakeTooltip.style.display, "none", "Leaving the learning card still dismisses it automatically");
  console.log("hover lifecycle tests passed");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
