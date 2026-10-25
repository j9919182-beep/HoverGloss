"use strict";
const assert = require("node:assert/strict");
const { fixture, turn } = require("./cc-session-fixture.cjs");
const latest = (port) => port.messages.findLast((m) => m.snapshot).snapshot;
(async () => {
  const f = fixture(), p = f.connect();
  assert.equal(f.activations, 0, "Opening popup is read-only");
  p.command({ type: "toggle-captions", enabled: true }); await turn();
  assert.equal(latest(p).state, "running"); assert.equal(f.activations, 1);
  p.command({ type: "toggle-captions", enabled: true }); await turn();
  assert.equal(f.activations, 1, "Repeated ON must not restart");
  p.disconnect(); f.advance(10000);
  assert.equal(f.intervals.size, 1, "Closing popup keeps CC running");
  const next = f.connect(); assert.equal(latest(next).state, "running");
  next.command({ type: "toggle-captions", enabled: false });
  assert.equal(latest(next).state, "stopped"); assert.equal(f.intervals.size, 0); assert.equal(f.player.children.length, 0);

  let resolve;
  const pending = fixture({ activate: () => new Promise((done) => { resolve = done; }) }), pendingPort = pending.connect();
  pendingPort.command({ type: "toggle-captions", enabled: true });
  assert.equal(latest(pendingPort).preparing, true);
  pendingPort.command({ type: "toggle-captions", enabled: false }); resolve(); await turn();
  assert.equal(pending.intervals.size, 0, "OFF cancels a late preparation result");
  assert.equal(latest(pendingPort).preparing, false);

  let finish;
  const switching = fixture({ activate: () => new Promise((done) => { finish = done; }) }), switchingPort = switching.connect();
  switchingPort.command({ type: "toggle-captions", enabled: true });
  switchingPort.command({ type: "disarm-start" }); finish(); await turn();
  assert.equal(switching.intervals.size, 0, "Switching mode cancels pending CC start");
  assert.equal(switching.player.children.length, 0);

  let blocked = true;
  const needsClick = fixture({ activate: () => { if (blocked) throw Object.assign(new Error("User activation required"), { name: "NotAllowedError" }); } });
  const clickPort = needsClick.connect(); clickPort.command({ type: "toggle-captions", enabled: true }); await turn();
  assert.equal(latest(clickPort).pendingStart, true); assert.equal(needsClick.intervals.size, 0);
  blocked = false;
  await needsClick.player.children[0].shadowRoot.children[1].children[1].click();
  assert.equal(latest(clickPort).state, "running"); assert.equal(latest(clickPort).pendingStart, false);

  const failed = fixture({ activate: () => { throw new Error("Model unavailable"); } }), failedPort = failed.connect();
  failedPort.command({ type: "toggle-captions", enabled: true }); await turn();
  assert.equal(latest(failedPort).state, "stopped"); assert.equal(latest(failedPort).pendingStart, false);
  assert.match(latest(failedPort).message, /失败/);
  console.log("CC switch: start/stop, popup disconnect/reopen, duplicate ON, preparation cancellation, page-gesture fallback and failure passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
