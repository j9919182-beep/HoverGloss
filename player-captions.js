(function (root, factory) {
  const core = root.HoverGlossLiveCaptions || (typeof require === "function" ? require("./live-captions-core.js") : null);
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossPlayerCaptions = api;
})(globalThis, function (core) {
  "use strict";
  let serial = 0;
  function sizes(rect, options) {
    const scale = Math.max(0.75, Math.min(1.8, rect.height / 540));
    const english = Math.max(12, Math.min(48, options.size * scale, rect.width / 17));
    return { english, chinese: english * options.ratio, lines: rect.height < 300 ? "1" : "2" };
  }
  class Overlay {
    constructor(document, nativeSelector = ".ytp-caption-window-container") {
      this.document = document; this.token = String(++serial);
      this.nativeSelector = nativeSelector;
      this.options = core.playerOptions(); this.player = null; this.cue = null;
    }
    configure(options) { this.options = core.playerOptions(options); this.clear(); }
    mount(player) {
      if (this.player === player && this.host?.isConnected) return;
      if (this.host?.isConnected) {
        this.restore(); this.player = player; player.append(this.nativeStyle, this.host); this.renderKey = ""; return;
      }
      this.dispose(); this.player = player;
      const document = this.document;
      this.host = document.createElement("div");
      this.host.id = "hovergloss-player-captions";
      this.host.setAttribute("data-concise-hover-ignore", "");
      this.host.setAttribute("aria-hidden", "true");
      this.host.style.cssText = "all:initial;position:absolute;left:8%;right:8%;z-index:60;pointer-events:none;display:none;text-align:center";
      const shadow = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `:host{color-scheme:dark}*{box-sizing:border-box}[hidden]{display:none!important}
        .box{display:inline-block;max-width:min(100%,960px);border-radius:7px;padding:6px 12px;font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.28;text-align:center;text-shadow:0 1px 3px #000;overflow-wrap:anywhere}
        p{margin:0;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
        .english{color:#fff;font-weight:500}.reference{color:#bfcbd9;font-size:12px;line-height:1.3;margin-top:3px;-webkit-line-clamp:1}.chinese{color:#ffe7a1;font-weight:500;margin-top:4px}.chinese:only-child{margin-top:0}`;
      this.box = document.createElement("div"); this.box.className = "box";
      this.english = document.createElement("p"); this.english.className = "english";
      this.reference = document.createElement("p"); this.reference.className = "reference";
      this.chinese = document.createElement("p"); this.chinese.className = "chinese";
      this.box.append(this.english, this.reference, this.chinese); shadow.append(style, this.box);
      this.nativeStyle = document.createElement("style");
      // Opacity on the container leaves the text layer measurable/readable.
      // Never disable CC or use display:none/visibility:hidden on its source.
      this.nativeStyle.textContent = this.nativeSelector.split(",").map((selector) => `[data-hovergloss-player-captions="${this.token}"] ${selector.trim()}`).join(",") + "{opacity:0!important;pointer-events:none!important}";
      player.append(this.nativeStyle, this.host);
    }
    show(player, cue, bounds) {
      if (this.options.mode === "native") { this.clear(); return; }
      this.mount(player);
      if (!this.cue || cue.id !== this.cue.id || cue.text !== this.cue.text) {
        this.cue = { id: cue.id, text: cue.text }; this.failed = false;
      }
      this.bounds = bounds;
      this.advance();
      this.render();
    }
    translation(id, text, value, failed = false) {
      if (!this.cue || this.cue.id !== id || this.cue.text !== text || typeof value !== "string") return false;
      return this.acceptPair(id, text, value, failed);
    }
    // Only the page-owned scheduler calls this after epoch/age validation.
    // Retain the pair's own English when CC has advanced during inference.
    acceptPair(id, text, value, failed = false) {
      if (typeof value !== "string") return false;
      this.failed = failed || !core.normalize(value);
      if (this.failed) { this.shown = this.pending = null; }
      else {
        // Keep one readable pair and only the newest completed candidate. There
        // is no FIFO backlog; a carried translation is labelled with its source.
        this.pending = { id, text, translation: core.normalize(value) };
        this.advance();
      }
      this.render(); return true;
    }
    duration(pair) { return Math.max(this.options.hold, Math.min(8000, pair.translation.replace(/\s/g, "").length * 100)); }
    advance(now = Date.now()) {
      if (this.pending && (!this.shown || now - this.shown.since >= this.duration(this.shown))) {
        this.shown = { ...this.pending, since: now }; this.pending = null;
      }
      const previous = this.shown && this.shown.id !== this.cue?.id;
      if (previous && !this.pending && now - this.shown.since >= this.duration(this.shown)) this.shown = null;
    }
    gap() { this.cue = null; this.advance(); this.render(); }
    restore() {
      if (this.player?.getAttribute("data-hovergloss-player-captions") === this.token) this.player.removeAttribute("data-hovergloss-player-captions");
    }
    render() {
      if (!this.host || (!this.cue && !this.shown) || !this.player?.isConnected || this.failed || this.options.mode === "native") {
        this.renderKey = "";
        if (this.host) this.host.style.display = "none";
        this.restore(); return;
      }
      const bilingual = this.options.mode === "bilingual";
      const rect = this.player.getBoundingClientRect();
      const previous = this.shown && this.shown.id !== this.cue?.id;
      const english = bilingual ? this.cue?.text || this.shown?.text || "" : "";
      const chinese = this.shown?.translation || "";
      const reference = previous ? `上一句 · ${this.shown.text}` : "";
      const key = JSON.stringify([english, chinese, reference, this.options, rect.width, rect.height, this.bounds]);
      if (this.renderKey === key) return;
      this.renderKey = key;
      const write = (node, value) => { if (node.textContent !== value) node.textContent = value; };
      write(this.english, english); write(this.chinese, chinese); write(this.reference, reference);
      this.english.hidden = !bilingual; this.chinese.hidden = !chinese; this.reference.hidden = !reference;
      this.host.style.display = (bilingual && english) || chinese ? "block" : "none";
      if (bilingual && this.host.style.display !== "none") this.player.setAttribute("data-hovergloss-player-captions", this.token);
      else this.restore();
      const size = sizes(rect, this.options), lines = size.lines;
      this.english.style.webkitLineClamp = lines; this.chinese.style.webkitLineClamp = lines;
      this.english.style.fontSize = `${size.english}px`; this.chinese.style.fontSize = `${size.chinese}px`;
      this.box.style.backgroundColor = `rgba(0,0,0,${this.options.opacity})`;
      if (bilingual) {
        this.host.style.top = "auto";
        this.host.style.bottom = `${Math.min(this.options.offset, Math.max(16, rect.height * 0.45))}px`;
      } else {
        const height = this.host.getBoundingClientRect().height;
        const top = (this.bounds?.bottom ?? rect.bottom - 80) - rect.top + 8;
        const available = rect.height - 44 - height;
        // When CC is too close to the bottom controls, put Chinese above it
        // rather than covering either the native caption or player buttons.
        const desired = top <= available ? top : (this.bounds?.top ?? rect.bottom - 80) - rect.top - height - 8;
        this.host.style.bottom = "auto";
        this.host.style.top = `${Math.max(8, Math.min(desired, Math.max(8, available)))}px`;
      }
    }
    clear() {
      this.restore(); this.cue = this.shown = this.pending = null; this.failed = false; this.renderKey = "";
      if (this.host) this.host.style.display = "none";
      if (this.english) this.english.textContent = "";
      if (this.chinese) this.chinese.textContent = "";
      if (this.reference) this.reference.textContent = "";
    }
    dispose() {
      this.clear(); this.host?.remove(); this.nativeStyle?.remove();
      this.player = null; this.host = null; this.nativeStyle = null;
    }
  }
  return { Overlay, sizes };
});
