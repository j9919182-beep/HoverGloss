"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const listeners = new Map();
const tasks = new Map();
const animationFrames = [];
let taskId = 0;
const writes = [];
const platform = process.argv[2] || "youtube";
const github = platform.startsWith("github");
const hostname = github ? "github.com" : platform === "google" ? "www.google.com" : "www.youtube.com";
let searchDialog = null;
const observers = [];
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {};
    this.style = { display: "none" }; this.isConnected = true; this.textContent = "";
    this.hidden = false; this.checked = false;
    this.attributes = {}; this.parentElement = null; this.popoverOpen = false;
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement.children = child.parentElement.children.filter((node) => node !== child);
    this.children.push(child); child.parentElement = this; return child;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] || null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  matches(selector) { return selector === ":popover-open" && this.popoverOpen; }
  showPopover() { if (platform === "github-fallback") throw new Error("Popover unavailable"); this.popoverOpen = true; }
  hidePopover() {
    this.popoverOpen = false;
    if (this.restoreFocus && document.activeElement === this) this.restoreFocus.focus();
  }
  attachShadow() { this.shadowRoot = new Element("shadow"); return this.shadowRoot; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  removeEventListener(type, listener) { if (this.listeners[type] === listener) delete this.listeners[type]; }
  getClientRects() { return this.visible === false ? [] : [this.getBoundingClientRect()]; }
  getBoundingClientRect() { return { top: 20, left: 200, right: 700, bottom: 56, height: 240 }; }
}
class Input extends Element {
  constructor() {
    super("input"); this.type = "text"; this.name = platform === "google" ? "q" : "search_query"; this._value = "";
    this.form = { getAttribute: () => "/search" };
    if (github) {
      this.name = ""; this.form = null;
      if (platform === "github-legacy") this.id = "query-builder-test";
      else {
        this.setAttribute("role", "combobox"); this.setAttribute("aria-label", "Search or jump to");
        if (platform === "github-semantic") {
          this.setAttribute("aria-label", "Search GitHub"); this.setAttribute("aria-controls", "global-results");
          this.ownerDocument = { getElementById(id) { return id === "global-results" ? { getAttribute: () => "listbox" } : null; } };
        }
      }
    }
  }
  get value() { return this._value; }
  set value(value) { this._value = value; }
  closest(selector) {
    if (github && selector === 'dialog, [role="dialog"], [popover]') return searchDialog;
    if (github && platform === "github-legacy" && selector === "qbsearch-input") return {};
    if (github && !["github-legacy", "github-semantic"].includes(platform) && selector.includes('[class*="quick-search-input-module__searchContainer__"]')) return {};
    return !github && selector.includes("ytd-masthead") ? {} : null;
  }
  dispatchEvent(event) { writes.push(event.type); listeners.get(event.type)?.({ ...event, target: this }); }
  focus() { document.activeElement = this; listeners.get("focusin")?.({ target: this }); }
  setSelectionRange() {}
}
class TextArea extends Input {
  constructor() { super(); this.tagName = "TEXTAREA"; }
  get value() { return this._value; }
  set value(value) { this._value = value; this.usedTextareaSetter = true; }
}
const document = {
  activeElement: null, visibilityState: "visible", documentElement: new Element("html"),
  createElement(tag) { return new Element(tag); },
  addEventListener(type, listener) { listeners.set(type, listener); }
};
const window = { innerWidth: 1400, innerHeight: 900, addEventListener() {} }; window.top = window;
if (github) { searchDialog = new Element("dialog"); searchDialog.setAttribute("open", ""); document.documentElement.appendChild(searchDialog); }
const settings = { youtubeSearchEnabled: false, youtubeSearchAutoReplace: false };
const sandbox = {
  URL,
  document, window, location: { hostname, href: "https://" + hostname + "/" }, HTMLInputElement: Input, HTMLTextAreaElement: TextArea,
  Event: class { constructor(type) { this.type = type; } },
  requestAnimationFrame(callback) { animationFrames.push(callback); return animationFrames.length; },
  MutationObserver: class {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
    disconnect() { this.targets = []; }
  },
  setTimeout(fn, ms) { tasks.set(++taskId, { fn, ms }); return taskId; }, clearTimeout(id) { tasks.delete(id); },
  Translator: { async create(options) {
    assert.equal(options.sourceLanguage, "zh");
    return { async translate() { return "SQL tutorial"; } };
  } },
  chrome: { storage: {
    local: { async get(defaults) { return { ...defaults, ...settings }; }, async set(value) { Object.assign(settings, value); } },
    onChanged: { addListener() {} }
  } }
};
for (const file of ["search-sites.js", "search-translator.js", "youtube-search-core.js", "youtube-search.js"]) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox, { filename: file });
}
function flatten(node) { return [node, ...node.children.flatMap(flatten)]; }
function scroll() {
  listeners.get("scroll")();
  while (animationFrames.length) animationFrames.shift()();
}
async function run() {
  await new Promise(setImmediate);
  const input = platform === "google" ? new TextArea() : new Input(); input.focus();
  const host = flatten(document.documentElement).find((node) => node.id === "hovergloss-search-assistant");
  if (github) {
    assert.equal(host.parentElement, searchDialog, "Assistant controls stay inside the search dialog focus boundary");
    assert.equal(host.getAttribute("popover"), "manual", "Use a manually controlled top-layer overlay, not auto-dismiss");
  }
  assert.equal(host.style.display, "none", "An empty focused search field must not show the assistant");
  const nodes = flatten(host.shadowRoot);
  const panel = nodes.find((node) => node.className === "panel");
  const launcher = nodes.find((node) => node.className === "launcher");
  input.value = "SQL教程"; input.usedTextareaSetter = false;
  listeners.get("input")({ target: input });
  assert.equal(host.style.display, "block");
  if (github && platform !== "github-fallback") assert.equal(host.popoverOpen, true, "Assistant is promoted above the search dialog");
  if (platform === "github-fallback") assert.equal(host.getAttribute("popover"), null, "A failed top-layer API falls back to a visible ordinary overlay");
  assert.equal(panel.hidden, true, "Chinese input initially shows only a compact entry");
  assert.equal(launcher.hidden, false);
  assert.equal(tasks.size, 0, "Manual mode does not translate before the user opens the entry");
  document.activeElement = host;
  launcher.listeners.click();
  assert.equal(panel.hidden, false);
  const checkboxes = nodes.filter((node) => node.tagName === "INPUT");
  checkboxes[0].checked = true;
  document.activeElement = host;
  await checkboxes[0].listeners.change();
  const button = (text) => nodes.find((node) => node.tagName === "BUTTON" && node.textContent === text);
  host.shadowRoot.activeElement = button("准备中译英");
  document.activeElement = host;
  await button("准备中译英").listeners.click();
  assert.equal(document.activeElement, input, "Preparing restores focus before hiding the focused button, so the queued candidate stays active");
  host.shadowRoot.activeElement = null;
  const delay = [...tasks].find(([, task]) => task.ms === 800);
  assert.ok(delay);
  tasks.delete(delay[0]);
  await delay[1].fn();
  assert.equal(input.value, "SQL教程", "The actual panel leaves input intact in preview mode");
  assert.equal(button("替换为英文").hidden, false);
  assert.ok(nodes.some((node) => node.textContent === "原文：SQL教程"));
  assert.ok(nodes.some((node) => node.textContent === "英文候选：SQL tutorial"));
  document.activeElement = host;
  button("替换为英文").listeners.click();
  assert.equal(input.value, "SQL tutorial");
  if (platform === "google") {
    assert.equal(input.usedTextareaSetter, true, "Google textarea uses its native value setter");
    assert.equal(settings.englishSearch_google_enabled, true);
    assert.equal(settings.youtubeSearchEnabled, false, "Enabling Google does not change YouTube preferences");
  }
  if (github) {
    assert.equal(settings.englishSearch_github_enabled, true);
    assert.equal(settings.youtubeSearchEnabled, false, "GitHub does not change the YouTube switch");
    assert.equal(host.parentElement, searchDialog);
  }
  assert.deepEqual(writes, ["input"], "Replacement dispatches input but no submit or Enter event");
  document.activeElement = host;
  button("恢复中文").listeners.click();
  assert.equal(input.value, "SQL教程");
  assert.equal(tasks.size, 0);
  button("收起").listeners.click();
  assert.equal(host.style.display, "block");
  assert.equal(panel.hidden, true, "Close returns to the small entry");
  assert.equal(launcher.hidden, false);
  assert.equal(tasks.size, 0, "Closing must not restart automatic replacement");
  input.focus();
  assert.equal(tasks.size, 0, "An enabled manual search remains idle while collapsed");
  listeners.get("compositionstart")({ target: input });
  assert.equal(host.style.display, "none", "The launcher is hidden while choosing Chinese characters");
  listeners.get("input")({ target: input });
  assert.equal(tasks.size, 0);
  listeners.get("compositionend")({ target: input });
  assert.equal(host.style.display, "block");
  assert.equal(panel.hidden, true);
  input.value = "English query";
  listeners.get("input")({ target: input });
  assert.equal(host.style.display, "none", "English-only input without an undo result needs no assistant");

  input.value = "SQL教程";
  listeners.get("input")({ target: input });
  document.activeElement = host;
  launcher.listeners.click();
  checkboxes[1].checked = true;
  await checkboxes[1].listeners.change();
  button("收起").listeners.click();
  assert.equal(tasks.size, 0, "Collapsing also cancels an automatic task");
  input.focus();
  const autoDelay = [...tasks].find(([, task]) => task.ms === 800);
  assert.ok(autoDelay);
  tasks.delete(autoDelay[0]);
  await autoDelay[1].fn();
  assert.equal(input.value, "SQL tutorial", "Opted-in automatic translation can run with only the small entry");
  assert.equal(panel.hidden, true);
  assert.equal(launcher.textContent, "已转英文", "Undo remains discoverable after automatic replacement");
  document.activeElement = host;
  launcher.listeners.click();
  button("恢复中文").listeners.click();
  assert.equal(input.value, "SQL教程");
  assert.equal(tasks.size, 0);
  button("收起").listeners.click();
  input.focus();
  input.visible = false;
  scroll();
  assert.equal(host.style.display, "none", "A hidden input closes without re-render recursion");
  input.visible = true;
  input.focus();
  input.isConnected = false;
  scroll();
  assert.equal(host.style.display, "none", "Removing a search field during SPA navigation closes safely");
  if (github) {
    assert.equal(host.popoverOpen, false, "A hidden search must not leave a top-layer assistant visible");
    input.isConnected = true; input.focus();
    assert.equal(host.popoverOpen, platform !== "github-fallback");
    searchDialog.listeners.close();
    assert.equal(host.style.display, "none", "Closing the native dialog cancels the assistant");
    assert.equal(host.popoverOpen, false);
    const previous = searchDialog;
    const oldObserver = observers.find((observer) => observer.targets.some(({ target }) => target === previous));
    searchDialog = new Element("dialog"); searchDialog.setAttribute("open", ""); document.documentElement.appendChild(searchDialog);
    input.focus();
    assert.equal(host.parentElement, searchDialog, "Reopening a replaced search modal moves the assistant into its focus boundary");
    assert.equal(previous.listeners.close, undefined);
    assert.equal(oldObserver.targets.length, 0, "Old modal observers are released");
    input.visible = false;
    observers.at(-1).callback();
    while (animationFrames.length) animationFrames.shift()();
    assert.equal(host.popoverOpen, false, "Modal hiding also clears the top-layer assistant");
    input.visible = true; input.focus(); document.activeElement = host;
    host.restoreFocus = input;
    listeners.get("pointerdown")({ target: new Element("div") });
    assert.equal(host.style.display, "none", "Popover focus restoration must not reopen the assistant after an outside click");
    assert.equal(host.popoverOpen, false);
    host.restoreFocus = null;
    const discovery = observers[0];
    discovery.callback([{ type: "attributes", target: input }]);
    while (animationFrames.length) animationFrames.shift()();
    assert.equal(host.style.display, "none", "DOM discovery does not undo an explicit dismissal");

    // Simulate React replacing a focused search field without dispatching focus.
    const replacement = new Input(); replacement.value = "网站";
    document.activeElement = replacement;
    discovery.callback([{ type: "childList", target: searchDialog, addedNodes: [replacement], removedNodes: [] }]);
    while (animationFrames.length) animationFrames.shift()();
    assert.equal(host.style.display, "block", "A dynamically replaced active search gets its entry back");
    assert.equal(host.parentElement, searchDialog);
    searchDialog.setAttribute("aria-hidden", "true");
    discovery.callback([{ type: "attributes", target: searchDialog }]);
    while (animationFrames.length) animationFrames.shift()();
    assert.equal(host.style.display, "none", "Hidden React dialogs also close the assistant");
  }
  console.log(platform + " compact search, IME, explicit preview, automatic undo and disappearing-input tests passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
