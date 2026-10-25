(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossTabAudio = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  class Capture {
    constructor(provided = globalThis) { this.api = provided; this.generation = 0; this.resources = null; }
    stop() {
      this.generation++;
      const resource = this.resources; this.resources = null;
      if (!resource) return;
      for (const track of resource.stream?.getTracks() || []) { track.removeEventListener("ended", resource.ended); track.stop(); }
      if (resource.node) resource.node.port.onmessage = null;
      for (const node of [resource.source, resource.node, resource.mute]) { try { node?.disconnect(); } catch { /* already detached */ } }
      try { Promise.resolve(resource.context.close()).catch(() => {}); } catch { /* already closed */ }
    }
    async start(tabId, onSamples, onEnded) {
      this.stop();
      const generation = this.generation;
      const { chrome, navigator, AudioContext, AudioWorkletNode } = this.api;
      if (!Number.isInteger(tabId) || !chrome.tabCapture?.getMediaStreamId || !navigator.mediaDevices?.getUserMedia || !AudioContext || !AudioWorkletNode) throw new Error("浏览器不支持本机标签页音频采集，请更新 Edge / Chrome");
      const context = new AudioContext();
      const resource = { context, stream: null, ended: null }; this.resources = resource;
      let resume = Promise.resolve();
      try {
        resume = context.resume();
        Promise.resolve(resume).catch(() => {});
        // Request a one-use ID in the same frame that consumes it; keep the user gesture.
        const requested = chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
        const streamId = await requested;
        if (generation !== this.generation) return false;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }, video: false });
        if (generation !== this.generation) { for (const track of stream.getTracks()) track.stop(); return false; }
        resource.stream = stream;
        if (!stream.getTracks().length || stream.getTracks().some((track) => track.readyState === "ended")) throw new Error("标签页音频流已经结束");
        if (!context.audioWorklet?.addModule) throw new Error("当前浏览器不支持音频工作线程");
        await context.audioWorklet.addModule(chrome.runtime.getURL("tab-audio-worklet.js"));
        if (generation !== this.generation) return false;
        resource.source = context.createMediaStreamSource(stream);
        resource.node = new AudioWorkletNode(context, "hovergloss-pcm", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        resource.mute = context.createGain(); resource.mute.gain.value = 0;
        resource.node.port.onmessage = (event) => {
          if (generation === this.generation && event.data?.type === "pcm" && event.data.samples instanceof Float32Array) onSamples(event.data.samples);
        };
        // tabCapture suppresses original playback. Restore it once, at native sample rate.
        resource.source.connect(context.destination);
        resource.source.connect(resource.node); resource.node.connect(resource.mute); resource.mute.connect(context.destination);
        resource.ended = () => { if (generation === this.generation) { this.stop(); onEnded(); } };
        for (const track of stream.getTracks()) track.addEventListener("ended", resource.ended);
        await resume;
        if (generation !== this.generation) return false;
        if (context.state !== "running") throw new Error("音频播放未启动，请再次点击开始；不会静默采集");
        return true;
      } catch (error) {
        if (generation === this.generation) this.stop();
        throw new Error(error?.message || "无法采集标签页声音，请从当前 YouTube 页的 HoverGloss 图标重新打开侧栏");
      } finally { Promise.resolve(resume).catch(() => {}); }
    }
  }
  return { Capture };
});
