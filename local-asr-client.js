(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossLocalASR = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  class Client {
    constructor({ createWorker, onResult, onStatus, setTimer = setTimeout, clearTimer = clearTimeout }) {
      this.createWorker = createWorker; this.onResult = onResult; this.onStatus = onStatus;
      this.worker = null; this.ready = false; this.mode = ""; this.generation = 0; this.serial = 0;
      this.active = null; this.pending = null; this.preparing = null;
      this.setTimer = setTimer; this.clearTimer = clearTimer;
    }
    prepare(mode) {
      if (!["cpu", "gpu"].includes(mode)) return Promise.reject(new Error("未知运行方式"));
      if (this.ready && this.mode === mode) return Promise.resolve();
      if (this.preparing && this.mode === mode) return this.preparing.promise;
      this.dispose(); this.mode = mode;
      let resolve, reject;
      const promise = new Promise((a, b) => { resolve = a; reject = b; });
      this.preparing = { promise, resolve, reject };
      try {
        const worker = this.createWorker(); this.worker = worker;
        worker.onmessage = (event) => { if (this.worker === worker) this.message(event.data); };
        worker.onerror = () => { if (this.worker === worker) this.fail("语音工作线程异常，请释放模型后重新准备"); };
        worker.postMessage({ type: "prepare", mode });
      } catch (error) { this.fail(error?.message || "语音模型启动失败"); }
      return promise;
    }
    message(message) {
      if (message?.type === "progress") { this.onStatus(String(message.message || "准备语音模型…")); return; }
      if (message?.type === "ready") { this.ready = true; this.preparing?.resolve(); this.preparing = null; return; }
      if (message?.type === "error" && !message.id) { this.fail(message.message || "模型准备失败"); return; }
      if (!["result", "error"].includes(message?.type) || !this.active || message.id !== this.active.id) return;
      const job = this.active; this.clearTimer(job.timer); this.active = null;
      if (job.generation === this.generation) {
        if (message.type === "error") this.onStatus(String(message.message || "识别失败，本段已跳过"));
        else this.onResult({ text: String(message.text || "").slice(0, 1200), time: job.time, duration: job.duration, elapsed: Number(message.elapsed) || 0, delay: Date.now() - job.created });
      }
      this.pump();
    }
    recognize(samples, time) {
      if (!this.ready || !(samples instanceof Float32Array) || samples.length < 5600 || samples.length > 16000 * 9) return;
      if (this.pending) this.onStatus("识别跟不上播放，已跳过一个积压片段；可试 GPU 模式或使用 CC");
      this.pending = { id: ++this.serial, samples, time, duration: samples.length / 16000, generation: this.generation, created: Date.now() };
      this.pump();
    }
    pump() {
      if (this.active || !this.pending || !this.worker || !this.ready) return;
      const job = this.pending; this.pending = null; this.active = job;
      job.timer = this.setTimer(() => { if (this.active === job) this.fail("本机识别超过 30 秒未完成，已停止；可释放模型后选择 GPU 重试"); }, 30000);
      try { this.worker.postMessage({ type: "transcribe", id: job.id, samples: job.samples }, [job.samples.buffer]); }
      catch { this.fail("音频片段无法交给本机模型，请重新准备"); }
    }
    cancel() { this.generation++; this.pending = null; }
    fail(message) {
      const preparing = this.preparing; this.preparing = null;
      this.dispose(); preparing?.reject(new Error(message)); this.onStatus(message);
    }
    dispose() {
      this.cancel(); this.worker?.terminate(); this.worker = null; this.ready = false;
      if (this.active) this.clearTimer(this.active.timer);
      this.active = null; const preparing = this.preparing; this.preparing = null;
      preparing?.reject(new Error("语音模型准备已取消"));
    }
  }
  return { Client };
});
