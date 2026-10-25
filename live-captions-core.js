(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossLiveCaptions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PORT = "hovergloss-live-captions";
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  function videoId(value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && ["bilibili.com", "www.bilibili.com"].includes(url.hostname)) {
        const match = /^\/video\/(BV[a-zA-Z0-9]{10}|av\d{1,15})\/?$/.exec(url.pathname);
        const part = url.searchParams.get("p") || "1";
        return match && /^[1-9]\d{0,4}$/.test(part) ? `bilibili:${match[1]}:p${Number(part)}` : "";
      }
      const id = url.searchParams.get("v") || "";
      return url.protocol === "https:" && ["youtube.com", "www.youtube.com"].includes(url.hostname) && url.pathname === "/watch" && /^[\w-]{6,32}$/.test(id) ? id : "";
    } catch { return ""; }
  }

  function playerOptions(value = {}) {
    const options = value && typeof value === "object" ? value : {};
    const mode = ["native", "below", "bilingual"].includes(options.mode) ? options.mode : "native";
    const number = (name, fallback, low, high) => {
      const n = Number(options[name]);
      return Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : fallback;
    };
    return { mode, size: number("size", 22, 16, 32), offset: number("offset", 72, 40, 200), opacity: number("opacity", 0.65, 0, 0.9),
      hold: number("hold", 4000, 2000, 8000), fullscreen: options.fullscreen === true,
      ratio: number("ratio", 0.9, 0.8, 1) };
  }

  // The visible player cue is deliberately separate from the sidebar's rolling
  // sentence feed. Each text change/clear invalidates all older translations.
  class PlayerCue {
    constructor() { this.serial = 0; this.reset(); }
    reset() { this.current = null; }
    update(value, now) {
      const text = normalize(value);
      if (!text) {
        if (!this.current) return [];
        this.reset(); return [{ type: "player-clear" }];
      }
      if (!this.current || this.current.text !== text) {
        this.current = { id: ++this.serial, text, changed: now, stable: false };
        return [{ type: "player-cue", id: this.current.id, revision: 1, text, stable: false }];
      }
      if (!this.current.stable && now - this.current.changed >= 500) {
        this.current.stable = true;
        return [{ type: "player-cue", id: this.current.id, revision: 1, text, stable: true }];
      }
      return [];
    }
  }

  class CaptionFeed {
    constructor() { this.serial = 0; this.reset(); }
    reset() { this.previous = ""; this.draft = null; }
    event(stable) {
      const d = this.draft;
      if (stable) d.stableRevision = d.revision;
      return { type: "caption", id: d.id, revision: d.revision, text: d.text, time: d.time, stable };
    }
    finish() {
      const events = this.draft && this.draft.stableRevision !== this.draft.revision ? [this.event(true)] : [];
      this.reset();
      return events;
    }
    update(value, now, mediaTime) {
      const text = normalize(value);
      if (!text || text === this.previous) return [];
      const events = [];
      const old = this.previous;
      let novel = text, correction = false;
      if (old && text.startsWith(old + " ")) novel = text.slice(old.length).trim();
      else if (old && old.includes(text)) return [];
      else if (old) {
        const before = old.split(" "), after = text.split(" ");
        let overlap = 0;
        for (let n = Math.min(before.length, after.length); n > 0; n--) {
          if ((n >= 2 || before[before.length - 1].length > 3) && before.slice(-n).join(" ") === after.slice(0, n).join(" ")) { overlap = n; break; }
        }
        if (overlap) novel = after.slice(overlap).join(" ");
        else {
          let common = 0;
          while (common < Math.min(before.length, after.length) && before[common] === after[common]) common++;
          correction = !!this.draft && this.draft.text === old && common >= 2 && common >= Math.min(before.length, after.length) / 2;
          if (!correction) events.push(...this.finish());
        }
      }
      if (!novel) { this.previous = text; return events; }
      if (this.draft && !correction && (now - this.draft.started >= 8000 || this.draft.text.length + novel.length > 500)) events.push(...this.finish());
      if (!this.draft) {
        this.draft = { id: ++this.serial, revision: 0, text: novel, time: Number.isFinite(mediaTime) ? Math.max(0, mediaTime) : 0, started: now, changed: now, stableRevision: 0 };
      } else this.draft.text = correction ? text : this.draft.text + " " + novel;
      this.previous = text;
      this.draft.revision++;
      this.draft.changed = now;
      events.push(this.event(false));
      return events;
    }
    tick(now) {
      if (this.draft && now - this.draft.changed >= 900 && this.draft.stableRevision !== this.draft.revision) return [this.event(true)];
      return [];
    }
  }

  // One local request at a time; keep only the latest revision of each visible row.
  class TranslationQueue {
    constructor(translate, report, limit = 12) {
      this.translate = translate; this.report = report; this.limit = limit;
      this.pending = new Map(); this.latest = new Map(); this.submitted = new Map();
      this.generation = 0; this.active = false;
    }
    reset() { this.generation++; this.pending.clear(); this.latest.clear(); this.submitted.clear(); }
    forget(id) { this.pending.delete(id); this.latest.delete(id); this.submitted.delete(id); }
    observe(row) {
      if ((this.latest.get(row.id) || 0) > row.revision) return;
      this.latest.set(row.id, row.revision);
      if (!row.stable) { this.pending.delete(row.id); return; }
      if (this.submitted.get(row.id) === row.revision) return;
      this.submitted.set(row.id, row.revision);
      this.pending.set(row.id, { ...row, generation: this.generation });
      while (this.pending.size > this.limit) {
        const id = this.pending.keys().next().value, dropped = this.pending.get(id);
        this.pending.delete(id); this.report(dropped, "", "字幕更新较快，本条暂未翻译");
      }
      this.pump();
    }
    async pump() {
      if (this.active || !this.pending.size) return;
      // Current on-video text takes precedence over history, but still shares
      // the same serial translator (no second model or parallel request).
      let job = this.pending.values().next().value;
      for (const candidate of this.pending.values()) {
        if ((candidate.priority || 0) > (job.priority || 0)) job = candidate;
      }
      this.pending.delete(job.id); this.active = true;
      try {
        const value = await this.translate(job.text);
        if (job.generation === this.generation && this.latest.get(job.id) === job.revision) this.report(job, value, "");
      } catch (error) {
        if (job.generation === this.generation && this.latest.get(job.id) === job.revision) this.report(job, "", String(error?.message || "本机翻译失败").slice(0, 240));
      } finally { this.active = false; this.pump(); }
    }
  }
  return { PORT, normalize, videoId, playerOptions, PlayerCue, CaptionFeed, TranslationQueue };
});
