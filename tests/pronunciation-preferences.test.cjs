"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../pronunciation.js"), "utf8");
const key = "allowOnlinePronunciation";
const local = { name: "Local English", lang: "en-US", localService: true };
const remote = { name: "Remote English", lang: "en-US", localService: false, default: true };
function setup(initial = false, delayedRead = null) {
  const state = { stored: initial, voices: [remote], failWrite: false, failRead: false };
  const spoken = [], writes = [], changed = [], timers = new Map(), listeners = new Set();
  let next = 0, active, cancels = 0;
  class Button {
    constructor() { this.listeners = {}; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
  }
  const engine = {
    speaking: false, getVoices: () => state.voices,
    addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); },
    speak(utterance) { spoken.push(utterance); active = utterance; this.speaking = true; },
    cancel() { cancels++; this.speaking = false; active?.onerror?.({ error: "cancelled" }); }
  };
  function publish(value) {
    state.stored = value;
    for (const listener of changed) listener({ [key]: { newValue: value } }, "local");
  }
  const sandbox = {
    speechSynthesis: engine, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    document: { createElement: () => new Button() },
    setTimeout(fn, ms) { timers.set(++next, { fn, ms }); return next; }, clearTimeout(id) { timers.delete(id); },
    chrome: { storage: { local: {
      async get() { if (delayedRead) return delayedRead; if (state.failRead) throw new Error("read failed"); return { [key]: state.stored }; },
      async set(values) { if (state.failWrite) throw new Error("write failed"); writes.push(values); publish(values[key]); }
    }, onChanged: { addListener(fn) { changed.push(fn); } } } }
  };
  vm.runInNewContext(source, sandbox);
  return { api: sandbox.HoverGlossPronunciation, state, spoken, writes, timers, listeners, publish,
    engine, get cancels() { return cancels; },
    end() { engine.speaking = false; active.onend(); },
    error(code) { engine.speaking = false; active.onerror({ error: code }); }
  };
}
async function run() {
  const test = setup();
  const { api } = test;
  assert.equal((await api.getSettings()).allowOnline, false);
  assert.equal(api.inspect().status, "remote-only");
  assert.equal(test.spoken.length, 0, "Opening/loading preferences never plays audio");
  test.state.failWrite = true;
  await assert.rejects(api.setAllowOnline(true), /write failed/);
  assert.equal((await api.getSettings()).allowOnline, false, "Failed persistence cannot grant consent");
  test.state.failWrite = false;
  await api.setAllowOnline(true);
  assert.equal(test.writes[0][key], true);
  assert.equal(test.spoken.length, 0, "Enabling online speech must not play a sample automatically");
  assert.equal((await api.detect()).source, "online");
  const button = api.createButton("prime minister");
  const clicked = button.listeners.click();
  assert.equal(button.textContent, "在线播放中…");
  assert.equal(test.spoken[0].voice.name, "Remote English");
  assert.equal(test.spoken[0].text, "prime minister", "Only the explicit target term is passed to speech, not context or source metadata");
  test.end(); await clicked;
  assert.match(button.title, /上次使用在线/);
  test.state.voices = [remote, local];
  const preferred = api.speak("local first");
  assert.equal(test.spoken.at(-1).voice.name, local.name, "A default remote voice must not outrank local English");
  test.end(); await preferred;
  test.state.voices = [remote];
  const active = api.speak("stop online");
  await api.setAllowOnline(false);
  assert.equal((await active).cancelled, true);
  assert.equal(test.engine.speaking, false);
  assert.equal(test.cancels, 1);
  assert.equal(api.inspect().status, "remote-only");
  assert.equal(test.timers.size, 0);
  await api.setAllowOnline(true);
  test.state.voices = [];
  const pending = api.speak("no late playback");
  test.publish(false); // Another extension page revokes permission while voices load.
  assert.equal((await pending).cancelled, true);
  test.state.voices = [remote];
  for (const fn of [...test.listeners]) fn();
  assert.equal(test.spoken.length, 3);
  assert.equal(test.timers.size, 0);
  assert.equal(test.listeners.size, 0);
  test.publish(true);
  const broken = api.speak("network failure");
  const rejected = assert.rejects(broken, /在线英文语音.*network/);
  test.error("network"); await rejected;
  assert.equal(test.spoken.length, 4, "A network error must not trigger automatic fallback/retries");
  test.state.voices = [{ name: "Unknown English", lang: "en-US" }, { lang: "zh-CN", localService: false }];
  assert.equal(api.inspect().status, "unverified");
  assert.equal(api.chooseVoice(test.state.voices, true), undefined, "Consent does not enable non-English or unverified voices");
  const reopened = setup(true);
  assert.equal((await reopened.api.getSettings()).allowOnline, true);
  assert.equal(reopened.api.inspect().source, "online");
  assert.equal(reopened.spoken.length, 0, "Persisted consent never automatically plays audio on reopen");
  reopened.state.voices = [remote, local];
  const localFailure = reopened.api.speak("local failure");
  const localRejected = assert.rejects(localFailure, /本机英文语音.*synthesis-failed/);
  reopened.publish(false);
  assert.equal(reopened.engine.speaking, true, "Disabling online permission does not interrupt local playback");
  reopened.error("synthesis-failed"); await localRejected;
  assert.equal(reopened.spoken.length, 1, "A failed local voice does not silently retry with an online voice");
  let resolveRead;
  const read = new Promise((resolve) => { resolveRead = resolve; });
  const loading = setup(true, read);
  const waiting = loading.api.speak("closed before preferences loaded");
  loading.api.stop();
  resolveRead({ [key]: true });
  await loading.api.getSettings();
  assert.equal((await waiting).cancelled, true);
  assert.equal(loading.spoken.length, 0);
  assert.equal(loading.timers.size, 0);
  let resolveStale;
  const stale = setup(true, new Promise((resolve) => { resolveStale = resolve; }));
  stale.publish(false);
  resolveStale({ [key]: true });
  assert.equal((await stale.api.getSettings()).allowOnline, false, "Stale startup reads cannot override later revocation");
  const unavailable = setup(false, Promise.reject(new Error("unavailable")));
  assert.equal((await unavailable.api.getSettings()).allowOnline, false);
  assert.equal(test.timers.size, 0);
  console.log("Online pronunciation opt-in, persistence, local priority, privacy, revocation, loading races and no automatic retry passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
