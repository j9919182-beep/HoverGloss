(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossCCSession = api;
})(globalThis, function () {
  "use strict";
  // One inference and one replaceable candidate. Raw CC changes do not cancel
  // an immutable in-flight pair; seek/stop/navigation do invalidate its epoch.
  class Scheduler {
    constructor(translate, report, clock = () => Date.now()) {
      this.translate = translate; this.report = report; this.clock = clock;
      this.epoch = 0; this.active = false; this.reset();
    }
    reset() {
      this.epoch++; this.latest = this.pending = null; this.submitted = "";
      this.first = this.changed = this.retryAt = 0;
    }
    observe(cue, time, now = this.clock()) {
      if (cue.text !== this.latest?.text) {
        if (!this.latest) this.first = now;
        this.changed = now; this.latest = { ...cue, time };
      }
      this.tick(now);
    }
    tick(now = this.clock()) {
      if (!this.latest || this.latest.text === this.submitted || now < this.retryAt) return;
      if (now - this.changed < 500 && now - this.first < 1250) return;
      this.pending = { ...this.latest, epoch: this.epoch, created: now };
      this.submitted = this.latest.text; this.first = now;
      this.pump();
    }
    async pump() {
      if (this.active || !this.pending) return;
      const job = this.pending; this.pending = null; this.active = true;
      try {
        const value = await this.translate(job.text);
        if (job.epoch === this.epoch) {
          if (this.clock() - job.created <= 8000 || this.latest?.text === job.text) this.report(job, value, null);
          else this.report(job, "", new Error("翻译落后于播放，已跳过过时片段"));
        }
      } catch (error) {
        if (job.epoch === this.epoch) {
          this.report(job, "", error);
          if (this.latest?.text === job.text) { this.submitted = ""; this.retryAt = this.clock() + 2000; }
        }
      } finally { this.active = false; this.pump(); }
    }
  }
  return { Scheduler };
});
