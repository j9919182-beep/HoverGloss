"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
let voices = [], activeUtterance;
const spoken = [], tasks = new Map(), listeners = new Set(); let next = 0, cancelled = 0;
class Button {
  constructor() { this.listeners = {}; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}
const engine = {
  speaking: false, getVoices() { return voices; },
  addEventListener(type, fn) { assert.equal(type, "voiceschanged"); listeners.add(fn); },
  removeEventListener(type, fn) { listeners.delete(fn); },
  speak(utterance) { spoken.push(utterance); activeUtterance = utterance; this.speaking = true; },
  cancel() { cancelled++; this.speaking = false; activeUtterance?.onerror?.({ error: "cancelled" }); }
};
const sandbox = { speechSynthesis: engine, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  document: { createElement: () => new Button() },
  setTimeout(fn, ms) { tasks.set(++next, { fn, ms }); return next; }, clearTimeout(id) { tasks.delete(id); } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pronunciation.js"), "utf8"), sandbox);
const api = sandbox.HoverGlossPronunciation;
const local = { name: "Local English", lang: "en-US", localService: true };
function end() { engine.speaking = false; activeUtterance.onend(); }
function timeout(ms) { const timer = [...tasks].find(([, task]) => task.ms === ms); assert.ok(timer); tasks.delete(timer[0]); timer[1].fn(); }
async function run() {
  voices = [{ name: "Online English", lang: "en-US", localService: false, default: true },
    { name: "Chinese", lang: "zh-CN", localService: true, default: true }, local];
  const report = await api.detect();
  assert.equal(report.status, "ready");
  assert.equal(report.voices.length, 3);
  assert.equal(spoken.length, 0, "Voice diagnostics must not play audio");
  assert.equal(tasks.size, 0, "Ready detection releases timers");
  const button = api.createButton("prime");
  assert.equal(spoken.length, 0, "Rendering a button must not automatically play audio");
  const playback = button.listeners.click();
  assert.equal(spoken[0].voice.name, "Local English");
  assert.equal(spoken[0].text, "prime");
  assert.equal(spoken[0].lang, "en-US");
  assert.equal(button.disabled, true); end(); await playback;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "▶ 发音");
  const first = api.speak("prime minister");
  const second = api.speak("Commission");
  assert.equal((await first).cancelled, true, "A second request must not queue overlapping pronunciations");
  assert.equal(cancelled, 1); end(); await second;
  voices = [];
  const delayed = api.speak("query"); assert.equal(listeners.size, 1);
  voices = [local]; for (const fn of [...listeners]) fn();
  assert.equal(spoken.at(-1).text, "query"); end(); await delayed;
  assert.equal(listeners.size, 0);
  voices = [];
  const noEvent = api.speak("late");
  timeout(250); timeout(250); timeout(250); timeout(250); timeout(250); timeout(250);
  assert.equal(spoken.at(-1).text, "query", "Preparation must not fail after the former 1.5 second timeout");
  voices = [local]; timeout(250);
  assert.equal(spoken.at(-1).text, "late", "Polling discovers voices even without voiceschanged");
  end(); await noEvent;
  voices = [{ name: "Remote", lang: "en-US", localService: false }];
  const before = spoken.length;
  const missing = api.speak("query"); const rejected = assert.rejects(missing, /本机英文语音/);
  timeout(5000); await rejected; assert.equal(spoken.length, before, "Never fall back to a remote or Chinese voice");
  assert.equal(api.inspect().status, "remote-only");
  voices = [{ name: "Unknown", lang: "en-US" }];
  assert.equal(api.inspect().status, "unverified");
  const unknown = api.speak("query"); const unknownRejected = assert.rejects(unknown, /未确认它是本机/);
  timeout(5000); await unknownRejected;
  assert.equal(spoken.length, before, "A missing locality flag must not be guessed from a voice name");
  voices = [{ name: "Chinese", lang: "zh-CN", localService: true }];
  assert.equal(api.inspect().status, "no-english");
  const chinese = api.detect(); timeout(5000);
  assert.equal((await chinese).status, "no-english");
  voices = [];
  const empty = api.detect(); timeout(5000);
  assert.equal((await empty).status, "empty");
  const originalGet = engine.getVoices;
  engine.getVoices = () => { throw new Error("read failed"); };
  assert.equal((await api.detect()).status, "error");
  await assert.rejects(api.speak("query"), /读取语音列表失败/);
  engine.getVoices = originalGet;
  const waiting = api.speak("cancel"); api.stop(); assert.equal((await waiting).cancelled, true);
  voices = [local]; for (const fn of [...listeners]) fn();
  assert.equal(spoken.length, before, "Cancelling voice preparation prevents late playback");
  const slow = api.speak("slow"); const slowRejected = assert.rejects(slow, /超时/);
  timeout(20000); await slowRejected;
  assert.equal(engine.speaking, false);
  const broken = api.speak("broken"); const brokenRejected = assert.rejects(broken, /播放失败（synthesis-failed）/);
  engine.speaking = false; activeUtterance.onerror({ error: "synthesis-failed" }); await brokenRejected;
  engine.speaking = true;
  await assert.rejects(api.speak("query"), /正在朗读/); engine.speaking = false;
  await assert.rejects(api.speak(""), /英文单词或短语/);
  delete sandbox.speechSynthesis;
  assert.equal((await api.detect()).status, "unsupported");
  await assert.rejects(api.speak("query"), /不支持/);
  assert.equal(tasks.size, 0);
  assert.equal(listeners.size, 0);
  sandbox.speechSynthesis = engine;
  engine.speaking = false;
  const frenchVoice = { name: "Local French", lang: "fr-FR", localService: true };
  voices = [local, frenchVoice];
  assert.equal(api.inspect({ language: "fr" }).voice.name, "Local French");
  const frenchPlayback = api.speak("économie", { language: "fr" });
  assert.equal(spoken.at(-1).lang, "fr-FR");
  end(); await frenchPlayback;
  const frenchSentence = api.speak("L’économie française évolue.", { language: "fr", kind: "sentence" });
  assert.equal(spoken.at(-1).voice.name, "Local French");
  end(); await frenchSentence;
  voices = [local];
  assert.equal(api.inspect({ language: "fr" }).voice, undefined, "Never pronounce French using an English voice");
  console.log("Local English/French word and sentence playback, delayed voices, cancellation, missing voices and no remote fallback passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
