"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../live-captions-core.js");
const audioCore = require("../audio-captions-core.js");
const asrCore = require("../local-asr-client.js");
const audioVariant = process.argv[2] === "audio";
const playerVariant = process.argv[2] === "player";
const fullscreenVariant = process.argv[2] === "fullscreen";
const biliVariant = process.argv[2] === "bilibili";
const scopedVariant = process.argv[2] === "scoped";
const durableVariant = process.argv[2] === "durable" || biliVariant || scopedVariant;
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
class Element {
  constructor() {
    this.children = []; this.parent = null; this.listeners = {}; this.textContent = "";
    this.hidden = false; this.disabled = false; this.checked = false; this.value = "18";
    this.className = ""; this.scrollTop = 0; this.clientHeight = 500; this.scrollHeight = 1000;
    this.style = { setProperty: (name, value) => { this.style[name] = value; } };
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      add: (name) => { if (!this.classList.contains(name)) this.className += " " + name; },
      toggle: (name, force) => { this.className = this.className.split(" ").filter((item) => item !== name).join(" "); if (force) this.classList.add(name); }
    };
  }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); this.parent = null; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  emit(name) { if (name === "click" && this.disabled) return; return this.listeners[name]?.({ target: this }); }
}
async function main() {
  const html = fs.readFileSync(require.resolve("../live-captions.html"), "utf8");
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  for (const id of ["start", "stop", "pause"]) elements[id].disabled = true;
  const documentListeners = {}, windowListeners = {}, tabListeners = {}, timers = new Map(), deadlines = new Map();
  const workers = [], captures = [], captureStarts = [];
  let grantResult = false, permissionRequests = 0, onPermissionRemoved;
  const initialPermission = deferred(); let permissionOperation = null;
  class FakeCapture {
    constructor() { captures.push(this); this.stops = 0; }
    stop() { this.stops++; this.running = false; }
    async start(id, onSamples, onEnded) { this.samples = onSamples; this.ended = onEnded; this.running = true; captureStarts.push(id); return true; }
  }
  class FakeWorker {
    constructor(url, options) { this.messages = []; workers.push(this); assert.match(url, /vendor\/local-asr\/asr-worker\.mjs$/); assert.equal(options.type, "module"); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  elements.captionMode.value = "cc"; elements.asrBackend.value = "cpu";
  elements.playerDisplay.value = "bilingual"; elements.playerFontSize.value = "22";
  elements.playerOffset.value = "72"; elements.playerOpacity.value = "0.65";
  elements.playerHold.value = "4"; elements.keepFullscreen.checked = true;
  let nextTimer = 0, activeTab = { id: 10, windowId: 1, url: "https://www.youtube.com/watch?v=abc12345678" };
  if (biliVariant) activeTab.url = "https://www.bilibili.com/video/BV1xx411c7mD/?p=2";
  const ports = [], translations = []; let activations = 0;
  const document = {
    getElementById: (id) => { assert.ok(elements[id], `unknown control ${id}`); return elements[id]; },
    createElement: () => new Element(), documentElement: new Element(), visibilityState: "visible",
    addEventListener: (name, fn) => { documentListeners[name] = fn; }
  };
  elements.transcript.append(elements.empty);
  const makePort = () => {
    const port = { messages: [], listeners: {},
      postMessage(message) { this.messages.push(message); }, disconnect() { this.closed = true; this.listeners.disconnect?.(); },
      onMessage: { addListener: (fn) => { port.listeners.message = fn; } },
      onDisconnect: { addListener: (fn) => { port.listeners.disconnect = fn; } }
    };
    ports.push(port); return port;
  };
  const translator = {
    activate: async () => { activations++; return "你好"; },
    translate: (payload) => { const operation = deferred(); translations.push({ payload, ...operation }); return operation.promise; }
  };
  const context = { document, window: { addEventListener: (name, fn) => { windowListeners[name] = fn; } },
    location: { search: scopedVariant ? "?tabId=10" : "" },
    chrome: { sidePanel: { async close(options) { assert.equal(options.tabId, 10); } }, runtime: { getURL: (path) => "extension://test/" + path }, permissions: {
      contains: () => audioVariant ? initialPermission.promise : Promise.resolve(false), request: () => { permissionRequests++; return permissionOperation ? permissionOperation.promise : Promise.resolve(grantResult); },
      onRemoved: { addListener: (fn) => { onPermissionRemoved = fn; } }
    }, tabs: {
      get: async (id) => ({ id, windowId: 1, url: "https://www.youtube.com/watch?v=abc12345678" }),
      query: async () => [activeTab], connect: makePort,
      onActivated: { addListener: (fn) => { tabListeners.activated = fn; } },
      onUpdated: { addListener: (fn) => { tabListeners.updated = fn; } },
      onRemoved: { addListener: (fn) => { tabListeners.removed = fn; } }
    } },
    crypto: { randomUUID: () => "test-session" }, HoverGlossLiveCaptions: core, HoverGlossBrowserTranslator: translator,
    HoverGlossAudioCaptions: audioCore, HoverGlossLocalASR: asrCore, HoverGlossTabAudio: { Capture: FakeCapture }, Worker: FakeWorker,
    setInterval: (fn) => { timers.set(++nextTimer, fn); return nextTimer; }, clearInterval: (id) => timers.delete(id),
    setTimeout: (fn) => { deadlines.set(++nextTimer, fn); return nextTimer; }, clearTimeout: (id) => deadlines.delete(id)
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../live-captions.js"), "utf8"), context);
  await turn();
  let port = ports.at(-1);
  assert.equal(activations, 0); assert.equal(port.messages.length, 0, "panel must not start capture on opening");
  if (durableVariant) {
    const snapshot = { protocol: 2, prepared: false, state: "stopped", session: "", videoId: core.videoId(activeTab.url),
      options: { mode: biliVariant ? "bilingual" : "below", fullscreen: true, size: 22, hold: 4000, ratio: 0.9 }, history: [], message: "尚未开始" };
    port.listeners.message({ type: "ready", protocol: 2, videoId: snapshot.videoId, snapshot });
    assert.equal(port.messages.at(-1).type, "arm-start", "Opening panel only arms the player button");
    assert.equal(elements.englishControl.hidden, true);
    assert.equal(elements.prepare.hidden, true);
    assert.equal(elements.start.hidden, true);
    assert.equal(elements.audioModeOption.disabled, biliVariant, "Bilibili adaptation does not broaden audio capture");
    assert.equal(elements.playerRatio.value, "0.9");
    await elements.prepare.emit("click"); assert.equal(activations, 0, "CC model lives on video page, not sidebar");
    assert.equal(port.messages.at(-1).type, "prepare-page");
    port.listeners.message({ type: "session", videoId: snapshot.videoId, snapshot: { ...snapshot, prepared: true } });
    assert.equal(elements.start.disabled, true, "preparation alone is not consent");
    elements.englishConfirmed.checked = true; elements.englishConfirmed.emit("change"); elements.start.emit("click");
    assert.equal(port.messages.at(-1).type, "start"); assert.equal(port.messages.at(-1).confirmed, true);
    const row = { type: "caption", id: 4, revision: 1, text: "Durable English", translation: "持续的中文", stable: true, time: 70 };
    const running = { ...snapshot, prepared: true, state: "running", session: "test-session", history: [row], message: "正在读取" };
    port.listeners.message({ type: "session", videoId: snapshot.videoId, snapshot: running });
    assert.equal(elements.count.textContent, "1 条字幕"); assert.equal(translations.length, 0, "replay never translates twice");
    assert.equal(elements.transcript.children[1].children[2].textContent, "持续的中文");
    const old = port; elements.reconnect.emit("click"); await turn(); port = ports.at(-1);
    assert.equal(old.messages.filter((m) => m.type === "stop").length, 0, "reconnect is detach, not explicit stop");
    port.listeners.message({ type: "ready", protocol: 2, videoId: snapshot.videoId, snapshot: running });
    assert.equal(elements.englishConfirmed.checked, true); assert.equal(elements.pause.disabled, false);
    assert.equal(elements.count.textContent, "1 条字幕"); assert.equal(elements.prepare.textContent, "本机英中翻译已就绪");
    document.visibilityState = "hidden"; documentListeners.visibilitychange();
    for (const callback of [...deadlines.values()]) callback();
    assert.equal(port.messages.filter((message) => message.type === "stop").length, 0, "Hidden page-owned sidebar does not destroy CC session");
    document.visibilityState = "visible"; documentListeners.visibilitychange();
    activeTab = { id: 11, windowId: 1, url: "https://example.com" }; tabListeners.activated({ windowId: 1 }); await turn();
    assert.equal(port.messages.filter((message) => message.type === "stop").length, 0, "Switching to other site only detaches old CC connection");
    activeTab = { id: 10, windowId: 1, url: biliVariant ? "https://www.bilibili.com/video/BV1xx411c7mD/?p=2" : "https://www.youtube.com/watch?v=abc12345678" };
    tabListeners.activated({ windowId: 1 }); await turn(); port = ports.at(-1);
    port.listeners.message({ type: "ready", protocol: 2, videoId: snapshot.videoId, snapshot: running });
    assert.equal(elements.pause.disabled, false); assert.equal(elements.englishConfirmed.checked, true);
    assert.equal(elements.count.textContent, "1 条字幕");
    await elements.minimizePanel.emit("click");
    assert.equal(port.messages.filter((m) => m.type === "stop").length, 0, "Minimize never sends stop");
    assert.equal(elements.pause.disabled, false, "Minimize does not change running state");
    windowListeners.pagehide(); assert.equal(port.messages.filter((m) => m.type === "stop").length, 0, "sidebar destruction lets page validate fullscreen");
    assert.equal(timers.size, 0); assert.equal(captureStarts.length, 0); assert.equal(workers.length, 0);
    console.log("Sidebar durable CC: page activation, confirmation, restore history/settings/model, no duplicate inference, reconnect/unload detach: passed"); return;
  }
  await elements.prepare.emit("click"); assert.equal(activations, 1);
  if (audioVariant) {
    port.listeners.message({ type: "ready", videoId: "abc12345678", title: "Audio test" });
    assert.equal(captureStarts.length, 0); assert.equal(workers.length, 0); assert.equal(permissionRequests, 0);
    elements.captionMode.value = "audio"; elements.captionMode.emit("change");
    assert.equal(elements.audioOptions.hidden, false); assert.equal(elements.englishControl.hidden, true);
    assert.equal(elements.start.disabled, true);
    const preparedASR = elements.prepareASR.emit("click"); let worker = workers.at(-1);
    assert.equal(worker.messages[0].type, "prepare"); assert.equal(worker.messages[0].mode, "cpu");
    assert.equal(captureStarts.length, 0, "model preparation must not capture audio");
    worker.onmessage({ data: { type: "ready" } }); await preparedASR;
    elements.audioConsent.checked = true; elements.audioConsent.emit("change");
    assert.equal(elements.start.disabled, true, "model and checkbox are not a browser permission");
    elements.grantAudio.emit("click"); assert.equal(permissionRequests, 1); await turn();
    assert.equal(elements.start.disabled, true, "permission refusal keeps audio disabled");
    grantResult = true; elements.grantAudio.emit("click"); await turn();
    initialPermission.resolve(false); await turn();
    assert.equal(elements.start.disabled, false); assert.equal(captureStarts.length, 0, "granting access does not start capture");
    elements.start.emit("click"); assert.equal(captureStarts[0], 10); await turn();
    assert.equal(captures[0].running, true); assert.equal(elements.pause.disabled, false);
    assert.equal(port.messages.filter((message) => message.type === "start").length, 0, "audio mode does not read CC");
    const feedSpeech = () => {
      for (let i = 0; i < 10; i++) captures[0].samples(new Float32Array(1600).fill(0.1));
      for (let i = 0; i < 7; i++) captures[0].samples(new Float32Array(1600));
    };
    feedSpeech(); let job = worker.messages.at(-1); assert.equal(job.type, "transcribe");
    worker.onmessage({ data: { type: "result", id: job.id, text: "A spoken English sentence", elapsed: 500 } });
    assert.equal(translations.length, 1); assert.equal(translations[0].payload.target, "A spoken English sentence");
    translations[0].resolve({ translation: "一句口述英文" }); await turn();
    const row = elements.transcript.children[1];
    assert.match(row.children[0].textContent, /本次采集/); assert.equal(row.children[2].textContent, "一句口述英文");
    assert.match(elements.audioMetrics.textContent, /识别 0.5s/);
    const staleSamples = captures[0].samples;
    elements.pause.emit("click"); assert.equal(captures[0].running, false); assert.equal(elements.start.textContent, "继续");
    const messageCount = worker.messages.length;
    for (let i = 0; i < 100; i++) staleSamples(new Float32Array(1600).fill(0.1));
    assert.equal(worker.messages.length, messageCount, "late PCM after pause must be ignored");
    elements.start.emit("click"); await turn(); assert.equal(captureStarts.length, 2);
    assert.equal(elements.count.textContent, "1 条字幕", "resume retains prior subtitles");
    feedSpeech(); job = worker.messages.at(-1); elements.stop.emit("click");
    worker.onmessage({ data: { type: "result", id: job.id, text: "late after stop", elapsed: 500 } });
    assert.equal(translations.length, 1); assert.equal(captures[0].running, false);
    elements.start.emit("click"); await turn(); assert.equal(captures[0].running, true);
    onPermissionRemoved({ permissions: ["tabCapture"] }); assert.equal(captures[0].running, false); assert.equal(elements.start.disabled, true);
    permissionOperation = deferred(); elements.grantAudio.emit("click");
    onPermissionRemoved({ permissions: ["tabCapture"] }); permissionOperation.resolve(true); await turn();
    assert.equal(elements.start.disabled, true, "late permission result cannot override revocation"); permissionOperation = null;
    grantResult = true; elements.grantAudio.emit("click"); await turn(); elements.start.emit("click"); await turn();
    document.visibilityState = "hidden"; documentListeners.visibilitychange(); assert.equal(captures[0].running, false); document.visibilityState = "visible";
    elements.start.emit("click"); await turn();
    activeTab = { id: 11, windowId: 1, url: "https://example.com" }; tabListeners.activated({ windowId: 1 }); await turn();
    assert.equal(captures[0].running, false); assert.equal(elements.audioConsent.checked, false); assert.equal(elements.start.disabled, true);
    elements.releaseASR.emit("click"); assert.equal(worker.terminated, true);
    const loading = elements.prepareASR.emit("click"); worker = workers.at(-1);
    elements.releaseASR.emit("click"); await loading; assert.equal(worker.terminated, true); assert.match(elements.status.textContent, /释放/);
    elements.captionMode.value = "cc"; elements.captionMode.emit("change"); assert.equal(elements.audioOptions.hidden, true);
    windowListeners.pagehide();
    assert.equal(timers.size, 0);
    console.log("audio captions permissions, capture and lifecycle UI: passed"); return;
  }
  elements.englishConfirmed.checked = true; elements.englishConfirmed.emit("change");
  assert.equal(elements.start.disabled, true, "wait for content script ready");
  port.listeners.message({ type: "ready", videoId: "abc12345678", title: "Sample" });
  assert.equal(elements.start.disabled, false); elements.start.emit("click");
  assert.equal(port.messages.at(-1).type, "start"); assert.equal(timers.size, 1);
  if (fullscreenVariant) {
    const report = (active, extra = {}) => port.listeners.message({ type: "player-fullscreen", active,
      session: "test-session", videoId: "abc12345678", ...extra });
    document.visibilityState = "hidden"; documentListeners.visibilitychange();
    assert.equal(port.messages.at(-1).type, "fullscreen-probe"); assert.equal(deadlines.size, 1);
    assert.equal(timers.size, 1, "Do not stop before confirming a fullscreen/visibility event race");
    report(true, { session: "wrong" }); assert.equal(deadlines.size, 1, "Other sessions cannot authorize hidden operation");
    report(true); assert.equal(deadlines.size, 0); assert.equal(timers.size, 1);
    assert.match(elements.status.textContent, /全屏.*继续/);
    report(false); assert.equal(deadlines.size, 1);
    document.visibilityState = "visible"; documentListeners.visibilitychange();
    assert.equal(deadlines.size, 0); assert.equal(timers.size, 1, "Leaving fullscreen while reopening the sidebar keeps the session");
    document.visibilityState = "hidden"; documentListeners.visibilitychange(); report(false);
    for (const fn of [...deadlines.values()]) fn();
    assert.equal(timers.size, 0); assert.equal(port.messages.at(-1).type, "stop", "Ordinary sidebar hiding still stops");
    document.visibilityState = "visible"; elements.start.emit("click");
    elements.keepFullscreen.checked = false; elements.keepFullscreen.emit("change");
    document.visibilityState = "hidden"; documentListeners.visibilitychange();
    assert.equal(timers.size, 0, "Opting out does not permit hidden fullscreen work");
    assert.equal(captureStarts.length, 0); assert.equal(permissionRequests, 0);
    console.log("Fullscreen consent, hidden-panel confirmation, event races, exit, ordinary hiding and opt-out: passed"); return;
  }
  if (playerVariant) {
    assert.equal(port.messages.at(-1).player.mode, "bilingual");
    const cue = (id, stable, text = "Current on-video caption", extra = {}) => port.listeners.message({
      type: "player-cue", id, revision: 1, stable, text, session: "test-session", videoId: "abc12345678", ...extra
    });
    cue(1, false); assert.equal(translations.length, 0);
    cue(1, true); assert.equal(translations.length, 1);
    cue(2, false, "A new visible cue"); cue(2, true, "A new visible cue");
    translations[0].resolve({ translation: "已经过期" }); await turn();
    assert.equal(port.messages.filter((m) => m.type === "player-translation").length, 0);
    translations[1].resolve({ translation: "新的画面字幕" }); await turn();
    let result = port.messages.at(-1);
    assert.equal(result.type, "player-translation"); assert.equal(result.id, 2);
    assert.equal(result.text, "A new visible cue"); assert.equal(result.translation, "新的画面字幕");
    cue(3, true); port.listeners.message({ type: "player-clear", session: "test-session", videoId: "abc12345678" });
    translations[2].resolve({ translation: "空隙后的旧译文" }); await turn();
    assert.equal(port.messages.filter((m) => m.type === "player-translation").length, 1);
    cue(4, true, "Ignored stale session", { session: "other-session" });
    assert.equal(translations.length, 3);
    cue(4, true); translations[3].reject(new Error("model failure")); await turn();
    assert.equal(port.messages.at(-1).error, true, "Failure explicitly tells the player to restore native CC");
    elements.playerDisplay.value = "native"; elements.playerDisplay.emit("change");
    assert.equal(port.messages.at(-1).type, "player-settings"); assert.equal(port.messages.at(-1).options.mode, "native");
    cue(5, true); assert.equal(translations.length, 4);
    elements.playerDisplay.value = "below"; elements.playerDisplay.emit("change");
    cue(6, true); elements.pause.emit("click"); translations[4].resolve({ translation: "暂停后的迟到译文" }); await turn();
    assert.equal(port.messages.at(-1).type, "pause");
    elements.stop.emit("click"); assert.equal(port.messages.at(-1).type, "stop");
    assert.equal(captureStarts.length, 0); assert.equal(permissionRequests, 0); assert.equal(workers.length, 0);
    console.log("Player sidebar protocol, stale/clear/session/error/pause and display controls: passed"); return;
  }
  const emit = (id, revision = 1, stable = true, extra = {}) => port.listeners.message({ type: "caption", id, revision, stable, text: "An English subtitle", time: 65, session: "test-session", videoId: "abc12345678", ...extra });
  emit(1, 1, false); assert.equal(translations.length, 0);
  emit(1); assert.equal(translations.length, 1);
  assert.equal(translations[0].payload.kind, "sentence");
  assert.deepEqual(Object.keys(translations[0].payload), ["target", "kind"], "no source metadata passed to translator");
  emit(1); assert.equal(translations.length, 1);
  emit(1, 2, false, { text: "A revised English subtitle" }); emit(1, 2, true, { text: "A revised English subtitle" });
  translations[0].resolve({ translation: "旧译文" }); await turn();
  assert.equal(translations.length, 2);
  const first = elements.transcript.children[1];
  assert.notEqual(first.children[2].textContent, "旧译文");
  translations[1].resolve({ translation: "新译文" }); await turn();
  assert.equal(first.children[2].textContent, "新译文");
  emit(1, 2, true, { text: "A revised English subtitle" });
  assert.equal(first.children[2].textContent, "新译文", "duplicate stable event cannot erase translated text");
  elements.transcript.scrollTop = 0; elements.transcript.emit("scroll");
  assert.equal(elements.latest.hidden, false);
  emit(2, 1, false); assert.equal(elements.transcript.scrollTop, 0, "do not force scroll during review");
  elements.latest.emit("click"); assert.equal(elements.latest.hidden, true); assert.equal(elements.transcript.scrollTop, 1000);
  elements.pause.emit("click"); assert.equal(timers.size, 0); assert.equal(port.messages.at(-1).type, "pause");
  emit(2); assert.equal(translations.length, 3, "final draft may finish translating after pause");
  elements.stop.emit("click"); translations[2].resolve({ translation: "迟到的译文" }); await turn();
  assert.notEqual(elements.transcript.children.at(-1).children[2].textContent, "迟到的译文");
  emit(3); assert.equal(elements.count.textContent, "2 条字幕", "late messages after stop are ignored");
  elements.start.emit("click"); assert.equal(elements.count.textContent, "0 条字幕");
  for (let id = 10; id < 100; id++) emit(id, 1, false);
  assert.equal(elements.count.textContent, "80 条字幕");
  assert.equal(elements.transcript.children.length, 81);
  elements.fontSize.value = "21"; elements.fontSize.emit("change");
  assert.equal(document.documentElement.style["--caption-size"], "21px");
  port.listeners.message({ type: "reset", session: "test-session", videoId: "abc12345678", message: "seek" });
  assert.equal(elements.count.textContent, "0 条字幕");
  elements.englishConfirmed.checked = false; elements.englishConfirmed.emit("change");
  assert.equal(elements.start.disabled, true); assert.equal(timers.size, 0);
  elements.englishConfirmed.checked = true; elements.englishConfirmed.emit("change"); elements.start.emit("click");
  document.visibilityState = "hidden"; documentListeners.visibilitychange();
  for (const fn of [...deadlines.values()]) fn();
  assert.equal(timers.size, 0); assert.equal(port.messages.at(-1).type, "stop"); document.visibilityState = "visible";
  elements.start.emit("click");
  activeTab = { id: 11, windowId: 1, url: "https://example.com" }; tabListeners.activated({ windowId: 1 }); await turn();
  assert.equal(port.closed, true); assert.equal(timers.size, 0); assert.equal(elements.start.disabled, true);
  assert.match(elements.status.textContent, /当前仅支持/);
  activeTab = { id: 12, windowId: 1, url: "https://www.youtube.com/watch?v=second12345" };
  elements.reconnect.emit("click"); await turn(); port = ports.at(-1);
  port.listeners.message({ type: "ready", videoId: "second12345", title: "Second video" });
  assert.equal(elements.englishConfirmed.checked, false, "new video requires manual confirmation and start");
  assert.equal(port.messages.length, 0);
  elements.englishConfirmed.checked = true; elements.englishConfirmed.emit("change"); elements.start.emit("click");
  tabListeners.removed(12); assert.equal(timers.size, 0); assert.equal(elements.start.disabled, true);
  translator.activate = async () => { throw new Error("local model missing"); };
  await elements.prepare.emit("click"); assert.match(elements.status.textContent, /local model missing/);
  assert.equal(elements.start.disabled, true);
  windowListeners.pagehide();
  const source = fs.readFileSync(require.resolve("../live-captions.js"), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|sendMessage\s*\(|storage\.|speechSynthesis|chrome\.tabCapture\.|innerHTML/);
  assert.equal(captureStarts.length, 0, "CC mode never captures audio");
  assert.equal(workers.length, 0, "CC mode never loads a speech model");
  assert.equal(permissionRequests, 0, "CC mode never requests audio permission");
  console.log("live captions panel: passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
