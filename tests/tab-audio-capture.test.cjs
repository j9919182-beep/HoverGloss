"use strict";
const assert = require("node:assert/strict");
const { Capture } = require("../tab-audio-capture.js");
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise((resolve) => setImmediate(resolve));
function environment() {
  const calls = [], contexts = [], tracks = [], worklets = [];
  let acquire = null, failModule = false, failId = false;
  const track = () => {
    const value = { stopped: false, addEventListener: (_name, fn) => { value.ended = fn; }, removeEventListener: () => { value.ended = null; }, stop: () => { value.stopped = true; } };
    tracks.push(value); return value;
  };
  const node = () => ({ connections: [], connect(other) { this.connections.push(other); }, disconnect() { this.detached = true; } });
  class Context {
    constructor() { contexts.push(this); this.state = "running"; this.destination = {}; this.source = node(); this.gain = { ...node(), gain: { value: 1 } }; this.audioWorklet = { addModule: async (url) => { calls.push(["module", url]); if (failModule) throw new Error("module failed"); } }; }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    createMediaStreamSource(stream) { this.sourceStream = stream; return this.source; }
    createGain() { return this.gain; }
  }
  class Worklet { constructor() { Object.assign(this, node()); this.port = {}; worklets.push(this); } }
  const api = { AudioContext: Context, AudioWorkletNode: Worklet,
    chrome: { tabCapture: { getMediaStreamId: (options) => { calls.push(["id", options]); if (failId) throw new Error("id denied"); return Promise.resolve("one-use-token"); } }, runtime: { getURL: (path) => "extension://test/" + path } },
    navigator: { mediaDevices: { getUserMedia: (constraints) => { calls.push(["media", constraints]); if (acquire) return acquire.promise; const activeTrack = track(); return Promise.resolve({ getTracks: () => [activeTrack] }); } } }
  };
  return { api, calls, contexts, tracks, worklets, waitMedia: () => { acquire = deferred(); return acquire; }, failModule: () => { failModule = true; }, failId: () => { failId = true; } };
}
async function main() {
  const e = environment(), capture = new Capture(e.api); const samples = []; let ended = 0;
  assert.equal(e.calls.length, 0, "constructing capture must not request audio");
  const operation = capture.start(42, (pcm) => samples.push(pcm), () => { ended++; });
  assert.equal(e.calls[0][0], "id", "request the tab ID before leaving the user click");
  assert.equal(e.calls[0][1].targetTabId, 42);
  assert.equal(await operation, true);
  const media = e.calls.find((call) => call[0] === "media")[1];
  assert.equal(media.video, false); assert.equal(media.audio.mandatory.chromeMediaSource, "tab");
  assert.equal(media.audio.mandatory.chromeMediaSourceId, "one-use-token");
  assert.equal(e.contexts[0].source.connections.filter((item) => item === e.contexts[0].destination).length, 1);
  assert.equal(e.contexts[0].gain.gain.value, 0);
  e.worklets[0].port.onmessage({ data: { type: "pcm", samples: new Float32Array(1600) } }); assert.equal(samples.length, 1);
  const stalePCM = e.worklets[0].port.onmessage;
  capture.stop(); assert.equal(e.contexts[0].closed, true); assert.equal(e.tracks[0].stopped, true); assert.equal(e.worklets[0].port.onmessage, null);
  stalePCM({ data: { type: "pcm", samples: new Float32Array(1600) } }); assert.equal(samples.length, 1);
  assert.equal(ended, 0, "manual stop must not trigger a second stop callback");
  await capture.start(42, () => {}, () => { ended++; }); e.tracks.at(-1).ended(); assert.equal(ended, 1); assert.equal(e.contexts.at(-1).closed, true);

  const slow = environment(), delayed = slow.waitMedia(), pending = new Capture(slow.api);
  const pendingStart = pending.start(5, () => {}, () => {}); await turn(); pending.stop();
  let stoppedLateTrack = false;
  delayed.resolve({ getTracks: () => [{ stop: () => { stoppedLateTrack = true; } }] });
  assert.equal(await pendingStart, false); assert.equal(stoppedLateTrack, true); assert.equal(slow.contexts[0].closed, true);
  const failure = environment(); failure.failModule();
  await assert.rejects(new Capture(failure.api).start(1, () => {}, () => {}), /module failed/);
  assert.equal(failure.tracks[0].stopped, true); assert.equal(failure.contexts[0].closed, true);
  const denied = environment(); denied.failId();
  await assert.rejects(new Capture(denied.api).start(1, () => {}, () => {}), /id denied/);
  assert.equal(denied.contexts[0].closed, true, "synchronous capture errors must release the context");
  console.log("tab audio capture: passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
