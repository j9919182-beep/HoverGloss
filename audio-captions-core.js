(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossAudioCaptions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const RATE = 16000;
  // Energy-based segmentation, not a learned VAD: quiet speech and music can fool it.
  class Segmenter {
    constructor(onSegment) { this.onSegment = onSegment; this.reset(); }
    reset() { this.frames = []; this.length = 0; this.voiced = 0; this.silent = 0; this.lead = []; }
    push(samples, time = 0) {
      if (!(samples instanceof Float32Array) || !samples.length || samples.length > RATE) return;
      let energy = 0;
      for (const value of samples) energy += value * value;
      const speech = Math.sqrt(energy / samples.length) >= 0.008;
      if (!this.frames.length && !speech) { this.lead.push(samples); if (this.lead.length > 2) this.lead.shift(); return; }
      if (!this.frames.length) {
        this.started = Math.max(0, time - this.lead.reduce((sum, frame) => sum + frame.length, 0) / RATE);
        this.frames = this.lead; this.length = this.lead.reduce((sum, frame) => sum + frame.length, 0); this.lead = [];
      }
      this.frames.push(samples); this.length += samples.length;
      if (speech) { this.voiced += samples.length; this.silent = 0; } else this.silent += samples.length;
      if (this.length >= RATE * 8 || (this.silent >= RATE * 0.7 && this.length >= RATE)) this.flush();
    }
    flush() {
      const frames = this.frames, length = this.length, voiced = this.voiced, time = this.started || 0;
      this.reset();
      if (voiced < RATE * 0.35) return;
      const samples = new Float32Array(length); let offset = 0;
      for (const frame of frames) { samples.set(frame, offset); offset += frame.length; }
      this.onSegment({ samples, time });
    }
  }
  function cleanTranscript(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  }
  return { RATE, Segmenter, cleanTranscript };
});
