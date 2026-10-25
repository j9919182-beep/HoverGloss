"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const spoken = [], timers = new Map(), listeners = new Set(), changed = [];
let voices = [{ name: "Local English", lang: "en-US", localService: true }];
let active, next = 0, cancellations = 0;
class Button {
  constructor() { this.listeners = {}; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}
const engine = {
  speaking: false, getVoices: () => voices,
  addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); },
  speak(utterance) { active = utterance; spoken.push(utterance); this.speaking = true; },
  cancel() { cancellations++; this.speaking = false; active?.onerror?.({ error: "cancelled" }); }
};
const sandbox = {
  speechSynthesis: engine, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  document: { createElement: () => new Button() },
  setTimeout(fn, ms) { timers.set(++next, { fn, ms }); return next; }, clearTimeout(id) { timers.delete(id); },
  chrome: { storage: { local: { async get(defaults) { return defaults; }, async set(values) {
    for (const fn of changed) fn({ allowOnlinePronunciation: { newValue: values.allowOnlinePronunciation } }, "local");
  } }, onChanged: { addListener(fn) { changed.push(fn); } } } }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pronunciation.js"), "utf8"), sandbox);
const api = sandbox.HoverGlossPronunciation;
function end() { engine.speaking = false; active.onend(); }
function timeout(ms) {
  const timer = [...timers].find(([, task]) => task.ms === ms);
  assert.ok(timer, "Expected timeout " + ms); timers.delete(timer[0]); timer[1].fn();
}
async function run() {
  await api.getSettings();
  const text = "The students compared the original sentence with its translation before checking the meaning of each individual word. ".repeat(5).trim();
  const start = spoken.length;
  const reading = api.speak(text, { kind: "sentence" });
  assert.equal(spoken.length, start + 1, "Only the first chunk is submitted initially");
  assert.ok(spoken.at(-1).text.length <= 180);
  const stale = active; end();
  const afterFirst = spoken.length;
  stale.onend(); stale.onerror({ error: "late-error" });
  assert.equal(spoken.length, afterFirst, "Stale chunk callbacks must not skip or duplicate speech");
  let guard = 0;
  while (engine.speaking) { assert.ok(++guard < 30); end(); }
  assert.equal((await reading).cancelled, false);
  assert.equal(spoken.slice(start).map((utterance) => utterance.text).join(""), text, "Long sentences must be read in full, in order, without adding metadata");
  assert.ok(spoken.slice(start).every((utterance) => utterance.text.length <= 180));
  assert.equal(timers.size, 0);
  const longToken = "a".repeat(179) + "😀" + "b".repeat(80);
  const tokenStart = spoken.length;
  const tokenReading = api.speak(longToken, { kind: "sentence" });
  assert.equal(spoken.at(-1).text.length, 179, "Chunking must not split a surrogate pair");
  while (engine.speaking) end();
  await tokenReading;
  assert.equal(spoken.slice(tokenStart).map((utterance) => utterance.text).join(""), longToken);
  const button = api.createButton(text, { kind: "sentence" });
  const beforeClick = spoken.length;
  assert.equal(button.textContent, "▶ 朗读原句");
  assert.equal(button["aria-pressed"], "false");
  assert.equal(spoken.length, beforeClick, "Rendering a sentence button must not play audio");
  const clicked = button.listeners.click();
  assert.equal(button.disabled, false, "Sentence playback remains clickable to stop");
  assert.equal(button.textContent, "■ 停止朗读");
  const cancelledChunk = active;
  await button.listeners.click(); await clicked;
  assert.equal(button.textContent, "▶ 朗读原句");
  assert.equal(button["aria-pressed"], "false");
  cancelledChunk.onend();
  assert.equal(spoken.length, beforeClick + 1, "Stopping prevents any remaining chunks");
  assert.equal(timers.size, 0);
  const sentence = api.speak(text, { kind: "sentence" });
  const interruptedChunk = active;
  const word = api.speak("query");
  assert.equal((await sentence).cancelled, true);
  const afterWord = spoken.length;
  interruptedChunk.onend();
  assert.equal(spoken.length, afterWord, "A new word request interrupts sentence playback without late continuation");
  end(); await word;
  await assert.rejects(api.speak("a".repeat(3001), { kind: "sentence" }), /3000/);
  await assert.rejects(api.speak("只有中文。", { kind: "sentence" }), /英文/);
  await assert.rejects(api.speak(text), /200/, "Word/phrase calls retain the existing short-input limit");
  const failing = api.speak("The original sentence.", { kind: "sentence" });
  const failed = assert.rejects(failing, /超时/);
  timeout(30000); await failed;
  assert.equal(engine.speaking, false);
  voices = [{ name: "Microsoft Aria Online (Natural)", lang: "en-US", localService: false }];
  const noConsent = api.speak("The original sentence.", { kind: "sentence" });
  const notAllowed = assert.rejects(noConsent, /允许在线发音/);
  timeout(5000); await notAllowed;
  await api.setAllowOnline(true);
  const remoteButton = api.createButton(text, { kind: "sentence" });
  const online = remoteButton.listeners.click();
  assert.match(remoteButton.textContent, /停止朗读（在线）/);
  assert.equal(spoken.at(-1).voice.name, "Microsoft Aria Online (Natural)");
  const remoteChunk = active, submitted = spoken.length;
  await api.setAllowOnline(false); await online;
  remoteChunk.onend();
  assert.equal(spoken.length, submitted, "Revoking consent prevents all subsequent online chunks");
  assert.equal(remoteButton.textContent, "▶ 朗读原句");
  await api.setAllowOnline(true);
  voices = [{ name: "Other Provider Online", lang: "en-US", localService: false }];
  assert.equal(api.inspect({ kind: "sentence" }).status, "unsupported-provider");
  const otherProvider = api.speak("This sentence must not be sent elsewhere.", { kind: "sentence" });
  const otherRejected = assert.rejects(otherProvider, /Microsoft/);
  timeout(5000); await otherRejected;
  assert.equal(spoken.length, submitted, "Sentence consent is scoped to browser-provided Microsoft online voices");
  assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
  assert.ok(cancellations >= 4);
  console.log("Sentence speech length/chunking, explicit click/stop, interruption, timeout, consent and Microsoft-only remote scope passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
