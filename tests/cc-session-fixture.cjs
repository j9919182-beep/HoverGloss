"use strict";
const fs = require("node:fs"), vm = require("node:vm");
const core = require("../live-captions-core.js"), cc = require("../cc-session.js");
const turn = () => new Promise((resolve) => setImmediate(resolve));
class Element {
  constructor() { this.children = []; this.listeners = {}; this.style = {}; this.attrs = {}; this.textContent = ""; this.hidden = false; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); this.parentElement = null; }
  attachShadow() { return this.shadowRoot = new Element(); }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  removeEventListener(name) { delete this.listeners[name]; }
  click() { return this.listeners.click?.({ stopPropagation() {} }); }
}
function fixture({ activate, storage } = {}) {
  let now = 10000, onConnect, serial = 0, activations = 0;
  const intervals = new Map(), deadlines = new Map(), translations = [], events = {}, location = { href: "https://www.youtube.com/watch?v=abc12345678" };
  const player = new Element(), media = new Element(), segment = new Element();
  media.currentTime = 65; media.seeking = false; segment.textContent = "English subtitle";
  segment.getClientRects = () => [1]; segment.getBoundingClientRect = () => ({ top: 400, bottom: 430 });
  player.ad = false; player.cc = true; player.classList = { contains: () => player.ad };
  player.querySelector = (selector) => selector === "video" ? media : { getAttribute: () => String(player.cc) };
  player.querySelectorAll = () => [segment]; player.contains = (node) => node === player;
  const document = { visibilityState: "visible", fullscreenElement: null, title: "Test video", querySelector: () => player,
    createElement: () => new Element(), addEventListener: (name, fn) => { events[name] = fn; } };
  class Overlay {
    constructor() { this.pairs = []; }
    configure(options) { this.options = options; this.clear(); }
    show(player, cue) { this.cue = { ...cue }; }
    acceptPair(id, text, translation, failed) { this.pairs.push({ id, text, translation, failed }); }
    clear() { this.cue = null; this.pairs = []; }
    dispose() { this.clear(); }
    gap() { this.cue = null; }
  }
  const overlays = [];
  const context = { HoverGlossLiveCaptions: core, HoverGlossCCSession: cc, URL,
    HoverGlossCaptionSites: require("../caption-sites.js"),
    HoverGlossPlayerCaptions: { Overlay: class extends Overlay { constructor() { super(); overlays.push(this); } } },
    HoverGlossBrowserTranslator: {
      activate: async () => { activations++; return activate?.(); },
      translate: (payload) => new Promise((resolve, reject) => translations.push({ ...payload, resolve, reject }))
    },
    document, window: { addEventListener: (name, fn) => { events[name] = fn; } }, location,
    Date: { now: () => now }, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    setInterval: (fn) => { intervals.set(++serial, fn); return serial; }, clearInterval: (id) => intervals.delete(id),
    setTimeout: (fn) => { deadlines.set(++serial, { fn, time: now + 1000 }); return serial; }, clearTimeout: (id) => deadlines.delete(id),
    chrome: { storage, runtime: { onConnect: { addListener: (fn) => { onConnect = fn; } } } }
  };
  // Give the scheduler the same fake clock as the adapter.
  context.HoverGlossCCSession = { Scheduler: class extends cc.Scheduler { constructor(translate, report) { super(translate, report, () => now); } } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../youtube-captions.js"), "utf8"), context);
  function connect() {
    const port = { name: core.PORT, messages: [],
      postMessage(message) { this.messages.push(message); },
      onMessage: { addListener(fn) { port.command = (message) => fn({ session: "test-session", videoId: core.videoId(location.href), ...message }); } },
      onDisconnect: { addListener(fn) { port.disconnect = fn; } }
    }; onConnect(port); return port;
  }
  function advance(ms = 250) {
    now += ms;
    for (const [id, item] of [...deadlines]) if (now >= item.time) { deadlines.delete(id); item.fn(); }
    for (const fn of [...intervals.values()]) fn();
  }
  async function prepare(port) {
    port.command({ type: "prepare-page" });
    const bar = player.children.find((node) => node.id === "hovergloss-cc-session");
    await bar.shadowRoot.children[1].children[1].click(); await turn();
  }
  function start(port, options = {}) { port.command({ type: "start", confirmed: true, player: { mode: "below", fullscreen: true, ...options } }); }
  return { connect, advance, prepare, start, player, media, segment, document, events, location, intervals, deadlines, translations, overlays,
    get activations() { return activations; }, get now() { return now; } };
}
module.exports = { fixture, turn };
