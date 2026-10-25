"use strict";
const assert = require("node:assert/strict");
const { isMainSearch, createController, missingTokens } = require("../youtube-search-core.js");
const input = { tagName: "INPUT", type: "text", name: "search_query", closest: (selector) => selector.includes("ytd-masthead") ? {} : null };
assert.equal(isMainSearch(input, "www.youtube.com"), true);
assert.equal(isMainSearch(input, "example.com"), false);
assert.equal(isMainSearch({ ...input, tagName: "TEXTAREA" }, "www.youtube.com"), false);
assert.equal(isMainSearch({ ...input, type: "password" }, "www.youtube.com"), false);
assert.equal(isMainSearch({ ...input, closest: () => null }, "www.youtube.com"), false, "A comment or channel search outside the masthead is excluded");
assert.deepEqual(missingTokens("Python 3.12 教程", "Python tutorial"), ["3.12"]);
assert.deepEqual(missingTokens("1个表", "10 tables"), ["1"]);
assert.deepEqual(missingTokens("SQL教程", "SQL tutorial."), []);
function fixture(translate = async () => "how to join tables in SQL") {
  let value = "SQL怎么连接表";
  let state;
  let next = 0;
  let ready = true;
  let active = true;
  const timers = new Map();
  const writes = [];
  const controller = createController({
    getValue: () => value, setValue: (text) => { value = text; writes.push(text); }, translate,
    ready: () => ready, active: () => active, render: (nextState) => { state = nextState; },
    setTimer(fn, ms) { timers.set(++next, { fn, ms }); return next; }, clearTimer(id) { timers.delete(id); }
  });
  return {
    controller, writes, timers, get state() { return state; }, get value() { return value; },
    set value(text) { value = text; }, set ready(bool) { ready = bool; }, set active(bool) { active = bool; },
    fire(ms) { const found = [...timers].find(([, task]) => task.ms === ms); assert.ok(found, `Missing ${ms} ms timer`); timers.delete(found[0]); return found[1].fn(); }
  };
}
async function run() {
  const manual = fixture();
  manual.controller.configure(true, false);
  await manual.fire(800);
  assert.equal(manual.state.status, "candidate");
  assert.equal(manual.writes.length, 0, "Preview does not replace or submit the query");
  assert.equal(manual.controller.apply(), true);
  assert.equal(manual.value, "how to join tables in SQL");
  assert.equal(manual.controller.undo(), true);
  assert.equal(manual.value, "SQL怎么连接表");
  assert.equal(manual.timers.size, 0, "Restore must not immediately trigger replacement again");
  manual.controller.changed();
  assert.equal(manual.timers.size, 0, "Refocusing unchanged restored text must not restart translation");
  manual.controller.request();
  assert.equal(manual.timers.size, 1, "An explicit request can translate restored text again");
  manual.controller.suspend();

  const restoredAuto = fixture();
  restoredAuto.controller.configure(true, true);
  await restoredAuto.fire(800);
  restoredAuto.controller.undo();
  restoredAuto.controller.changed();
  assert.equal(restoredAuto.timers.size, 0, "Automatic mode respects undo when the user returns to the field");
  restoredAuto.value += "入门";
  restoredAuto.controller.changed();
  assert.equal(restoredAuto.timers.size, 1, "Editing restored Chinese enables automatic translation again");

  const auto = fixture();
  auto.controller.configure(true, true);
  await auto.fire(800);
  assert.equal(auto.writes.length, 1);
  assert.equal(auto.state.canUndo, true);
  auto.value += " beginner";
  assert.equal(auto.controller.undo(), false, "Undo may not overwrite further user edits");

  const ime = fixture();
  ime.controller.configure(true, true);
  ime.controller.compositionStart();
  ime.value = "SQL连接两个";
  ime.controller.changed();
  assert.equal(ime.timers.size, 0, "IME composition never starts translation");
  ime.controller.compositionEnd();
  assert.equal(ime.timers.size, 1);
  await ime.fire(800);
  assert.equal(ime.writes.length, 1);

  let resolve;
  const stale = fixture(() => new Promise((done) => { resolve = done; }));
  stale.controller.configure(true, true);
  const running = stale.fire(800);
  stale.value = "新的中文";
  stale.controller.changed();
  resolve("old SQL result");
  await running;
  assert.equal(stale.value, "新的中文", "A late result cannot replace newer input");
  assert.equal(stale.writes.length, 0);

  const cancel = fixture(() => new Promise((done) => { resolve = done; }));
  cancel.controller.configure(true, true);
  const cancelled = cancel.fire(800);
  cancel.controller.suspend();
  resolve("SQL result");
  await cancelled;
  assert.equal(cancel.writes.length, 0, "Submitting search, closing the panel or navigating cancels application");

  const timeout = fixture(() => new Promise((done) => { resolve = done; }));
  timeout.controller.configure(true, true);
  const timed = timeout.fire(800);
  timeout.fire(15000);
  assert.equal(timeout.state.status, "error");
  resolve("SQL result");
  await timed;
  assert.equal(timeout.writes.length, 0);

  const terms = fixture(async () => "join two tables");
  terms.controller.configure(true, true);
  await terms.fire(800);
  assert.equal(terms.writes.length, 0, "Automatic replacement stops when an English term was dropped");
  assert.match(terms.state.candidate.warning, /SQL/);
  assert.equal(terms.controller.apply(), true, "A user can still accept a warned candidate explicitly");

  const preparation = fixture();
  const operators = fixture(async () => "repo:facebook/react SQL tutorial");
  operators.value = "repo:facebook/react SQL教程";
  operators.controller.configure(true, true);
  await operators.fire(800);
  assert.equal(operators.writes.length, 0, "Advanced search syntax always requires a preview");
  assert.match(operators.state.candidate.warning, /搜索语法/);
  preparation.ready = false;
  preparation.controller.configure(true, true);
  assert.equal(preparation.state.status, "prepare");
  assert.equal(preparation.timers.size, 0);
  const english = fixture();
  english.value = "already English";
  english.controller.configure(true, true);
  assert.equal(english.timers.size, 0);
  const disabled = fixture();
  disabled.controller.configure(false, false);
  disabled.controller.changed();
  assert.equal(disabled.timers.size, 0);
  console.log("YouTube search scope, IME, preview, replacement, undo, stale-result and timeout tests passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
