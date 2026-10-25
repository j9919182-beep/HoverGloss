"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
class Element {
  constructor() { this.children = []; this.listeners = {}; this.value = ""; this.textContent = ""; this.hidden = false; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "learning.html"), "utf8");
const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [`#${match[1]}`, new Element()]));
const $ = (id) => { assert.ok(elements.has(id), `Missing UI element ${id}`); return elements.get(id); };
$("#filter").value = "all";
const record = { id: "1", term: "query", meaning: "查询", meaningLabel: "单词释义", context: "Run the query.",
  sentenceTranslation: "运行查询。", phrase: "query plan", phraseTranslation: "查询计划", commonMeaning: "", uncertain: true,
  origin: { type: "pdf", title: "SQL.pdf", page: 5, url: "" }, createdAt: 1, dueAt: 1, reviews: 0, stage: 0, notes: "" };
const calls = [];
const audioCalls = [];
let allowOnline = false, failWrite = false;
let deferSpeech = false, liveUtterance, cancelledAudio = 0;
const storageListeners = [], settingsWrites = [];
let availableVoices = [{ name: "Local English", lang: "en-US", localService: true },
  { name: "Online English", lang: "en-US", localService: false }];
const sandbox = {
  URL, URLSearchParams, location: { search: "" }, setTimeout, clearTimeout,
  speechSynthesis: { speaking: false, getVoices() { return availableVoices; },
    speak(utterance) { audioCalls.push(utterance.text); liveUtterance = utterance;
      if (deferSpeech) this.speaking = true; else utterance.onend(); },
    cancel() { cancelledAudio++; this.speaking = false; liveUtterance?.onerror?.({ error: "cancelled" }); } },
  SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  document: { querySelector: $, createElement() { return new Element(); } },
  chrome: { storage: { local: {
    async get(defaults) { return { ...defaults, allowOnlinePronunciation: allowOnline }; },
    async set(values) {
      if (failWrite) throw new Error("write failed");
      settingsWrites.push(values); allowOnline = values.allowOnlinePronunciation;
      for (const fn of storageListeners) fn({ allowOnlinePronunciation: { newValue: allowOnline } }, "local");
    }
  }, onChanged: { addListener(fn) { storageListeners.push(fn); } } }, runtime: {
    async sendMessage(message) {
      calls.push(message);
      if (message.type === "learningReview") return { ok: true, entry: { ...record, dueAt: Date.now() + 86400000, reviews: 1, stage: 1 } };
      return { ok: true, entries: [structuredClone(record)] };
    }
  } }
};
for (const file of ["pronunciation.js", "learning.js"]) vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox);
async function run() {
  await new Promise(setImmediate);
  assert.equal($("#term").textContent, "query");
  assert.match($("#sourceName").textContent, /SQL.pdf · 第 5 页/);
  assert.equal($("#sourceLink").hidden, true);
  assert.equal($("#uncertain").hidden, false);
  assert.equal(audioCalls.length, 0, "Opening the library never automatically reads saved terms");
  assert.equal($("#contextAudio").children[0].textContent, "▶ 朗读原句");
  assert.equal($("#contextAudioHint").hidden, false);
  await $("#detectVoices").listeners.click();
  assert.match($("#voiceStatus").textContent, /Local English/);
  assert.equal($("#voiceList").children.length, 2);
  assert.match($("#voiceList").children[1].textContent, /在线，不使用/);
  assert.equal(audioCalls.length, 0, "Diagnostics never auto-play any voice");
  assert.equal($("#detectVoices").disabled, false);
  assert.equal($("#allowOnlineSpeech").checked, false);
  assert.equal($("#allowOnlineSpeech").disabled, false);
  $("#allowOnlineSpeech").checked = true;
  await $("#allowOnlineSpeech").listeners.change({ target: $("#allowOnlineSpeech") });
  assert.equal(settingsWrites[0].allowOnlinePronunciation, true);
  assert.equal(audioCalls.length, 0, "Enabling consent does not play a sample or saved term");
  assert.match($("#voiceList").children[1].textContent, /在线，已允许/);
  assert.match($("#onlineSpeechStatus").textContent, /本机英文声音仍优先/);
  assert.equal($("#allowOnlineSpeech").disabled, false);
  availableVoices = availableVoices.slice(1);
  await $("#termAudio").children[0].listeners.click();
  assert.equal(audioCalls[0], "query");
  assert.match($("#termAudio").children[0].title, /上次使用在线/);
  $("#allowOnlineSpeech").checked = false;
  await $("#allowOnlineSpeech").listeners.change({ target: $("#allowOnlineSpeech") });
  assert.match($("#onlineSpeechStatus").textContent, /已关闭/);
  failWrite = true;
  $("#allowOnlineSpeech").checked = true;
  await $("#allowOnlineSpeech").listeners.change({ target: $("#allowOnlineSpeech") });
  assert.equal($("#allowOnlineSpeech").checked, false, "Failed saves restore the actual setting");
  assert.match($("#notice").textContent, /保存失败/);
  failWrite = false;
  availableVoices = [{ name: "Local English", lang: "en-US", localService: true }];
  assert.equal($("#phrase").children.length, 1, "Legacy phrase fields remain visible with the parent word");
  await $("#phrase").children[0].children[0].children[1].listeners.click();
  assert.equal(audioCalls[1], "query plan");
  await $("#contextAudio").children[0].listeners.click();
  assert.equal(audioCalls.at(-1), "Run the query.", "Original sentence playback must not read Chinese translation or source metadata");
  record.context = ""; await $("#refreshLibrary").listeners.click();
  assert.equal($("#contextAudio").children.length, 0, "Missing context has no dummy speech button");
  assert.equal($("#contextAudioHint").hidden, true);
  record.context = "这是一条中文记录。"; await $("#refreshLibrary").listeners.click();
  assert.equal($("#contextAudio").children.length, 0);
  record.context = "Run the query."; await $("#refreshLibrary").listeners.click();
  record.phrases = [{ phrase: "query plan", phraseTranslation: "查询计划" },
    { phrase: "query execution plan", phraseTranslation: "查询执行计划" }];
  await $("#refreshLibrary").listeners.click();
  assert.equal($("#phrase").children.length, 2, "Multiple associated phrases stay in the same word detail");
  $("#search").value = "查询执行计划"; $("#search").listeners.input();
  assert.equal($("#entries").children.length, 1, "Phrase-only translations are searchable");
  $("#search").value = "query execution plan"; $("#search").listeners.input();
  assert.equal($("#entries").children.length, 1);
  $("#search").value = "SQL.pdf";
  $("#search").listeners.input();
  assert.equal($("#entries").children.length, 1);
  $("#search").value = "missing";
  $("#search").listeners.input();
  assert.equal($("#entries").children.length, 0);
  const beforeReview = audioCalls.length;
  await $("#startReview").listeners.click();
  assert.equal(audioCalls.length, beforeReview, "Entering review must not automatically read the sentence");
  assert.equal($("#reviewPanel").hidden, false);
  assert.equal($("#reviewAnswer").hidden, true, "Review must first conceal the answer");
  await $("#reviewContextAudio").children[0].listeners.click();
  assert.equal(audioCalls.at(-1), "Run the query.");
  assert.equal($("#reviewAnswer").hidden, true, "Sentence audio does not reveal the answer");
  await $("#reviewAudio").children[0].listeners.click();
  assert.equal(audioCalls.at(-1), "query");
  $("#reviewRemember").listeners.click();
  assert.equal(calls.filter((call) => call.type === "learningReview").length, 0);
  $("#showAnswer").listeners.click();
  assert.equal($("#reviewAnswer").hidden, false);
  assert.equal($("#reviewWarning").hidden, false);
  assert.equal($("#reviewPhrase").children.length, 2, "Review exposes linked phrases alongside the word answer");
  await $("#reviewPhrase").children[1].children[0].children[1].listeners.click();
  assert.equal(audioCalls.at(-1), "query execution plan");
  $("#reviewRemember").listeners.click();
  await new Promise(setImmediate);
  assert.equal(calls.filter((call) => call.type === "learningReview").length, 1);
  assert.equal($("#reviewPanel").hidden, true);
  assert.equal($("#libraryPanel").hidden, false);
  deferSpeech = true;
  const sentenceButton = $("#contextAudio").children[0];
  const reading = sentenceButton.listeners.click();
  assert.equal(sentenceButton.textContent, "■ 停止朗读");
  assert.equal(sentenceButton.disabled, false);
  await $("#refreshLibrary").listeners.click(); await reading;
  assert.equal(cancelledAudio, 1, "Replacing the current record stops sentence playback");
  assert.equal(sandbox.speechSynthesis.speaking, false);
  delete sandbox.speechSynthesis;
  await $("#termAudio").children[0].listeners.click();
  assert.match($("#notice").textContent, /不支持/);
  assert.equal($("#speechDiagnostics").open, true, "Speech failure reveals the diagnostic entry point");
  assert.equal($("#termAudio").children[0].disabled, false);
  console.log("learning library search, detail and review flow tests passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
