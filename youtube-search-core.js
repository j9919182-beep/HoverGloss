(function (root, factory) {
  const sites = root.HoverGlossSearchSites || (typeof require === "function" ? require("./search-sites.js") : null);
  const api = factory(sites);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossYoutubeSearch = api;
})(globalThis, function (sites) {
  "use strict";
  const hasChinese = (value) => /\p{Script=Han}/u.test(value);
  function isMainSearch(input, hostname) {
    return sites.isSearchField(input, hostname);
  }
  function missingTokens(original, english) {
    const tokens = [...new Set(original.match(/[A-Za-z][A-Za-z0-9.+#_-]*|\d+(?:[.-]\d+)*/g) || [])];
    return tokens.filter((token) => {
      const escaped = token.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
      return !new RegExp("(^|[^A-Za-z0-9])" + escaped + "(?=$|[^A-Za-z0-9])", "i").test(english);
    });
  }
  function createController({ getValue, setValue, translate, ready, active = () => true, requested = () => true, render, delay = 800, timeout = 15000,
    setTimer = setTimeout, clearTimer = clearTimeout }) {
    let enabled = false;
    let automatic = false;
    let composing = false;
    let generation = 0;
    let timer = null;
    let deadline = null;
    let candidate = null;
    let replacement = null;
    let restoredValue = null;
    function cancel() {
      generation += 1;
      if (timer !== null) clearTimer(timer);
      if (deadline !== null) clearTimer(deadline);
      timer = deadline = null;
      candidate = null;
    }
    function show(status, extra = {}) {
      render({ status, enabled, automatic, candidate, canUndo: Boolean(replacement && getValue() === replacement.english), ...extra });
    }
    function apply() {
      if (!enabled || composing || !candidate || !active() || getValue() !== candidate.original) return false;
      const next = candidate;
      cancel();
      restoredValue = null;
      replacement = { original: next.original, english: next.english };
      setValue(next.english);
      show("applied", { message: "已填入英文，可修改后按回车搜索。" });
      return true;
    }
    function undo() {
      if (!replacement || getValue() !== replacement.english || composing) return false;
      const value = replacement.original;
      cancel(); replacement = null;
      restoredValue = value;
      setValue(value);
      show("restored", { message: "已恢复中文，继续编辑才会再次翻译。" });
      return true;
    }
    function changed() {
      cancel();
      if (replacement && getValue() !== replacement.english) replacement = null;
      if (!enabled) { show("off"); return; }
      if (composing) { show("composing"); return; }
      const original = getValue();
      if (restoredValue !== null && original === restoredValue) {
        show("restored", { message: "已恢复中文，继续编辑才会再次翻译。" }); return;
      }
      restoredValue = null;
      if (!original.trim() || !hasChinese(original)) { show("idle"); return; }
      if (!requested()) { show("idle"); return; }
      if (original.trim().length > 300) { show("error", { message: "搜索词请控制在 300 字以内。" }); return; }
      if (!ready()) { show("prepare"); return; }
      const ticket = generation;
      show("waiting");
      timer = setTimer(async () => {
        timer = null;
        if (ticket !== generation || !active() || !requested()) return;
        show("translating");
        deadline = setTimer(() => {
          if (ticket !== generation) return;
          cancel();
          show("error", { message: "翻译等待超时，原文保留。可点击重试或直接搜索。" });
        }, timeout);
        try {
          const english = await translate(original.trim());
          if (ticket !== generation || composing || !enabled || !active() || getValue() !== original) return;
          if (deadline !== null) clearTimer(deadline);
          deadline = null;
          if (typeof english !== "string" || !english.trim() || hasChinese(english) || english.length > 1000) throw new Error("未得到可用的英文候选，原文已保留。");
          const missing = missingTokens(original, english);
          const syntax = /(?:^|\s)(?:-?[A-Za-z][\w-]*:|[-+][A-Za-z])|["“”\[\]]/.test(original);
          const warnings = [];
          if (missing.length) warnings.push("请核对术语或数字：" + missing.join("、"));
          if (syntax) warnings.push("包含搜索语法或引号，请核对筛选条件。");
          candidate = { original, english, warning: warnings.join("；") };
          show("candidate");
          if (automatic && !candidate.warning) apply();
        } catch (error) {
          if (ticket !== generation) return;
          if (deadline !== null) clearTimer(deadline);
          deadline = null;
          show("error", { message: error.message || "翻译失败，已保留原文。" });
        }
      }, delay);
    }
    return {
      changed, apply, undo,
      request() { restoredValue = null; changed(); },
      compositionStart() { composing = true; cancel(); show("composing"); },
      compositionEnd() { composing = false; changed(); },
      suspend() { composing = false; cancel(); show("idle"); },
      configure(value, auto) {
        const differs = enabled !== Boolean(value) || automatic !== Boolean(auto);
        enabled = Boolean(value); automatic = Boolean(auto);
        if (differs) changed();
      }
    };
  }
  return { isMainSearch, missingTokens, createController };
});
