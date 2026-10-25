"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs");
const { fixture, turn } = require("./cc-session-fixture.cjs");
(async () => {
  const f = fixture(), p = f.connect();
  assert.equal(p.messages[0].protocol, 2); assert.equal(f.activations, 0); assert.equal(f.player.children.length, 0);
  f.start(p); assert.equal(f.intervals.size, 0, "must prepare before reading CC");
  await f.prepare(p); assert.equal(f.activations, 1); assert.equal(f.intervals.size, 0);
  p.command({ type: "start", confirmed: false }); assert.equal(f.intervals.size, 0);
  f.start(p); assert.equal(f.intervals.size, 1);
  // Continuous rolling edits never stabilize for 500ms; bounded max-wait still submits.
  for (let i = 0; i < 16; i++) { f.segment.textContent = `Rolling words ${i}`; f.advance(); p.command({ type: "heartbeat" }); }
  assert.equal(f.translations.length, 1, "exactly one active inference");
  assert.ok(f.translations[0].target.startsWith("Rolling words"));
  const original = f.translations[0].target;
  f.translations[0].resolve({ translation: "滚动字幕译文" }); await turn();
  assert.equal(f.overlays[0].pairs[0].text, original, "late result keeps its own source English");
  assert.equal(f.translations.length, 2, "only the newest pending candidate follows");
  f.media.listeners.seeking(); f.translations[1].resolve({ translation: "拖动前旧译文" }); await turn();
  assert.equal(f.overlays[0].pairs.length, 0, "seek invalidates active inference");
  f.advance(500); assert.equal(f.translations.length, 2); f.advance(500);
  f.translations.at(-1).reject(new Error("model failed")); await turn();
  assert.ok(p.messages.some((m) => m.type === "status" && /model failed/.test(m.message)));
  f.advance(2250); assert.ok(f.translations.length >= 4, "failed unchanged cue retries with backoff");
  p.command({ type: "stop" }); f.translations.at(-1).resolve({ translation: "停止后旧译文" }); await turn();
  assert.equal(f.intervals.size, 0); assert.equal(f.overlays[0].pairs.length, 0);
  f.start(p); f.player.ad = true; f.advance(); assert.equal(f.overlays[0].cue, null); f.player.ad = false;
  f.player.cc = false; f.advance(); assert.equal(f.overlays[0].cue, null); f.player.cc = true;
  f.segment.textContent = "中文字幕"; f.advance(); assert.match(p.messages.at(-1).message, /切换为英语/);
  f.segment.textContent = "English again"; f.advance();
  f.location.href = "https://www.youtube.com/watch?v=second12345"; f.events["yt-navigate-finish"]();
  const fresh = f.connect().messages[0].snapshot; assert.equal(fresh.state, "stopped"); assert.equal(fresh.session, ""); assert.equal(fresh.history.length, 0);
  assert.doesNotMatch(fs.readFileSync(require.resolve("../youtube-captions.js"), "utf8"), /fetch\s*\(|tabCapture|sendMessage\s*\(|innerHTML/);
  console.log("Page-owned CC: explicit preparation/start, rolling max-wait, bounded inference, retry, seek/ad/CC/stop/navigation: passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
