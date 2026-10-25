"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { Segmenter, cleanTranscript } = require("../audio-captions-core.js");
const output = [];
const segmenter = new Segmenter((segment) => output.push(segment));
const frame = (level) => new Float32Array(1600).fill(level);
for (let i = 0; i < 100; i++) segmenter.push(frame(0), i / 10);
assert.equal(output.length, 0, "silence must not enter speech recognition");
for (let i = 0; i < 10; i++) segmenter.push(frame(0.1), 10 + i / 10);
for (let i = 0; i < 7; i++) segmenter.push(frame(0), 11 + i / 10);
assert.equal(output.length, 1); assert.ok(output[0].samples.length < 16000 * 2);
assert.ok(Math.abs(output[0].time - 9.8) < 0.001, "keep a short lead-in");
for (let i = 0; i < 82; i++) segmenter.push(frame(0.1), 20 + i / 10);
assert.equal(output.length, 2); assert.equal(output[1].samples.length, 16000 * 8);
segmenter.reset(); segmenter.flush(); assert.equal(output.length, 2, "reset discards unfinished sound");
segmenter.push(frame(0.1)); for (let i = 0; i < 9; i++) segmenter.push(frame(0));
assert.equal(output.length, 2, "very short noise is discarded");
segmenter.push(new Float32Array(20000)); assert.equal(segmenter.length, 0);
assert.equal(cleanTranscript("  hello\n  world "), "hello world");
assert.equal(cleanTranscript("x".repeat(1300)).length, 1200);

const workletSource = fs.readFileSync(require.resolve("../tab-audio-worklet.js"), "utf8");
for (const sampleRate of [48000, 44100, 16000]) {
  let Processor; const frames = [];
  class Base { constructor() { this.port = { postMessage: (message, transfer) => { assert.equal(transfer[0], message.samples.buffer); frames.push(message.samples); } }; } }
  vm.runInNewContext(workletSource, { AudioWorkletProcessor: Base, sampleRate, Float32Array, registerProcessor: (name, processor) => { assert.equal(name, "hovergloss-pcm"); Processor = processor; } });
  const processor = new Processor();
  // One second of stereo input, averaged and resampled to exactly 16000 mono samples.
  const left = new Float32Array(sampleRate).fill(0.2), right = new Float32Array(sampleRate).fill(0.4), silentOutput = new Float32Array(sampleRate).fill(1);
  processor.process([[left, right]], [[silentOutput]]);
  assert.equal(frames.length, 10);
  for (const pcm of frames) { assert.equal(pcm.length, 1600); assert.ok(Math.abs(pcm[500] - 0.3) < 0.0001); }
  assert.ok(silentOutput.every((value) => value === 0), "analysis path must not duplicate audible playback");
}
assert.doesNotMatch(workletSource, /fetch\(|storage\.|chrome\.|getUserMedia\(/);
console.log("audio segmentation and PCM worklet: passed");
