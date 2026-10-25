"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const flatten = (node) => [node, ...(node.children || []).flatMap(flatten)];
class Element {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.listeners = {}; this.style = {}; this.className = ""; this.textContent = ""; this.value = ""; this.classList = { add() {}, remove() {} }; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute() {}
  contains(node) { return flatten(this).includes(node); }
  querySelector(selector) { return flatten(this).find((node) => node.className === selector.slice(1)); }
  getBoundingClientRect() { return { top: 10, left: 10, bottom: 190, width: 340, height: 180 }; }
}
const documentListeners = {}, messages = [], documentRoot = new Element();
let resolveAlignment;
const sandbox = {
  document: { title: "Example", documentElement: documentRoot, createElement: (tag) => new Element(tag),
    createTextNode: (text) => ({ textContent: text }), addEventListener(name, callback) { documentListeners[name] = callback; } },
  location: { protocol: "chrome-extension:", pathname: "/demo.html", href: "chrome-extension://test/demo.html" },
  window: { innerWidth: 1200, innerHeight: 800 }, setTimeout, clearTimeout,
  requestAnimationFrame: (fn) => fn(),
  ConciseHoverRules: { normalizeText: (value) => String(value || "").trim(), cleanTranslation: (value) => value },
  HoverGlossWordSenses: require("../word-senses.js"),
  chrome: { storage: { local: { async get(defaults) { return defaults; } }, onChanged: { addListener() {} } },
    runtime: { async sendMessage(message) {
      messages.push(message);
      if (message.type === "translate") return { ok: true, translation: "佣金", isolatedTranslation: "佣金",
        source: "browser", confidence: .5, sentenceTranslation: "欧盟委员会发言。", localAlignmentEnabled: true };
      if (message.type === "alignWord") return new Promise((resolve) => { resolveAlignment = resolve; });
      return { ok: true };
    } } }
};
const source = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, "globalThis.testFeedback = { requestTranslation, state: () => ({tooltipPinned, feedbackCapture}) };})();"), sandbox);
async function run() {
  await new Promise(setImmediate);
  await sandbox.testFeedback.requestTranslation("Commission", { top: 200, left: 200, width: 80, bottom: 220 }, null,
    "word", "The European Commission spoke.", false, { targetStart: 13, targetEnd: 23 });
  const tooltip = documentRoot.children[0];
  documentListeners.keyup({ key: "Alt" });
  assert.equal(tooltip.style.display, "block", "The feedback entry gives time to move into the card");
  tooltip.listeners.mouseenter();
  let nodes = flatten(tooltip);
  nodes.find((node) => node.className === "cht-feedback-open").listeners.click();
  assert.equal(sandbox.testFeedback.state().tooltipPinned, true);
  const form = nodes.find((node) => node.className === "cht-feedback-form");
  const originalBody = tooltip.children[1];
  resolveAlignment({ ok: true, result: { translation: "委员会", source: "browser-local-align", contextReview: "aligned" } });
  await new Promise(setImmediate);
  assert.equal(tooltip.children[1], originalBody, "Late alignment must not erase the feedback draft or change its snapshot");
  assert.equal(form.hidden, false);
  nodes.find((node) => node.tagName === "select").value = "word";
  nodes.find((node) => node.tagName === "textarea").value = "委员会";
  await nodes.find((node) => node.textContent === "保存问题").listeners.click();
  const saved = messages.find((message) => message.type === "feedbackSave").entry;
  assert.equal(saved.result.translation, "佣金");
  assert.equal(saved.correction, "委员会");
  assert.equal(saved.targetStart, 13);
  documentListeners.keydown({ key: "Escape", altKey: false });
  assert.equal(tooltip.style.display, "none");
  assert.equal(sandbox.testFeedback.state().feedbackCapture, null);
  console.log("Feedback reachability, pinned editing, frozen async snapshot and explicit save passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
