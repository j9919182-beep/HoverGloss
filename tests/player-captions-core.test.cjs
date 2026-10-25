"use strict";
const assert = require("node:assert/strict");
const { PlayerCue, playerOptions, TranslationQueue } = require("../live-captions-core.js");
const turn = () => new Promise(setImmediate);
async function run() {
  assert.equal(playerOptions().mode, "native");
  assert.equal(playerOptions({ mode: "bilingual" }).size, 22);
  assert.deepEqual(playerOptions({ mode: "bad", size: 100, offset: -20, opacity: 9 }), { mode: "native", size: 32, offset: 40, opacity: 0.9, hold: 4000, fullscreen: false, ratio: 0.9 });
  assert.equal(playerOptions({ ratio: 9 }).ratio, 1);
  assert.equal(playerOptions({ ratio: 0 }).ratio, 0.8);
  const { sizes } = require("../player-captions.js");
  for (const rect of [{ width: 960, height: 540 }, { width: 1920, height: 1080 }, { width: 320, height: 180 }]) {
    const layout = sizes(rect, playerOptions({ mode: "bilingual" }));
    assert.ok(Math.abs(layout.chinese / layout.english - 0.9) < 0.001);
    assert.ok(layout.english >= 12 && layout.english <= 48);
  }
  assert.equal(playerOptions({ hold: 99999, fullscreen: true }).hold, 8000);
  const cue = new PlayerCue();
  assert.deepEqual(cue.update("", 0), []);
  let event = cue.update("Hello world", 0)[0];
  const id = event.id; assert.equal(event.stable, false);
  assert.deepEqual(cue.update("Hello world", 499), []);
  assert.equal(cue.update("Hello world", 500)[0].stable, true);
  assert.deepEqual(cue.update("Hello world", 700), []);
  event = cue.update("Hello world again", 800)[0];
  assert.ok(event.id > id); assert.equal(event.text, "Hello world again");
  assert.equal(event.stable, false, "Rolling CC changes invalidate its previous translation immediately");
  assert.equal(cue.update("", 900)[0].type, "player-clear");
  const later = cue.update("Hello world", 1000)[0];
  assert.ok(later.id > event.id, "Identical words after a gap are still a different cue");
  cue.reset(); assert.ok(cue.update("Hello world", 1100)[0].id > later.id, "Seek/restart cannot reuse an old cue ID");

  const pending = [], calls = [], reports = [];
  const queue = new TranslationQueue((text) => { calls.push(text); return new Promise((resolve) => pending.push(resolve)); }, (...args) => reports.push(args));
  queue.observe({ id: 1, revision: 1, text: "active history", stable: true });
  queue.observe({ id: 2, revision: 1, text: "queued history", stable: true });
  queue.observe({ id: "player-1", revision: 1, text: "old cue", stable: true, priority: 1 });
  queue.forget("player-1");
  queue.observe({ id: "player-2", revision: 1, text: "current cue", stable: true, priority: 1 });
  assert.deepEqual(calls, ["active history"], "One shared translation request at a time");
  pending.shift()("历史"); await turn();
  assert.deepEqual(calls, ["active history", "current cue"], "Current visible CC precedes queued history");
  queue.forget("player-2"); pending.shift()("过期中文"); await turn();
  assert.equal(reports.length, 1, "An old cue result is discarded even after inference has started");
  assert.equal(calls.at(-1), "queued history");
  queue.reset(); pending.shift()("已停止"); await turn();
  assert.equal(reports.length, 1);
  console.log("Player cue identity, timing, options, shared priority and stale-result tests passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
