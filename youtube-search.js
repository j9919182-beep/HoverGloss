(function () {
  "use strict";
  const sites = globalThis.HoverGlossSearchSites;
  const site = sites.siteFor(location.hostname);
  if (window.top !== window || !site) return;
  const { enabledKey, autoKey } = site;
  const core = globalThis.HoverGlossYoutubeSearch;
  const client = globalThis.HoverGlossSearchTranslator.createClient();
  const defaults = { [enabledKey]: false, [autoKey]: false };
  let settings = { ...defaults };
  let input = null;
  let controller = null;
  let writing = false;
  let preparing = false;
  let lastState = null;
  let frame = null;
  let boundUrl = "";
  let expanded = false;
  let hiding = false;
  let searchOverlay = null;
  let overlayObserver = null;
  let discoveryObserver = null;
  let discoveryFrame = null;
  let dismissed = false;
  const host = document.createElement("div");
  host.id = "hovergloss-search-assistant";
  host.setAttribute("data-concise-hover-ignore", "");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483646;display:none;width:310px;max-width:calc(100vw - 16px)";
  let useTopLayer = site.id === "github" && typeof host.showPopover === "function";
  if (useTopLayer) {
    host.setAttribute("popover", "manual");
    Object.assign(host.style, { margin: "0", inset: "auto", padding: "0", border: "0", background: "transparent" });
  }
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .panel{max-height:min(70vh,480px);overflow-y:auto}
    :host{color-scheme:light} *{box-sizing:border-box} [hidden]{display:none!important}
    .panel{padding:13px;border:1px solid #cdd9ec;border-radius:13px;color:#20304c;background:#fff;box-shadow:0 10px 35px #14254126;font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
    .row{display:flex;align-items:center;justify-content:space-between;gap:8px}.title{font-weight:700;color:#315fc7}button,input{font:inherit}button{padding:5px 9px;border:1px solid #d3dff2;border-radius:7px;color:#315fc7;background:#eef4ff;cursor:pointer}button:disabled{opacity:.55;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #3867d6;outline-offset:2px}.close{border:0;background:none;color:#708099}label{display:flex;gap:6px;align-items:center;margin-top:9px}input{accent-color:#3867d6}.message{margin:10px 0;color:#62718a;font-size:12px}.candidate{margin:8px 0;padding:9px;border-radius:8px;background:#f0f5ff;overflow-wrap:anywhere;color:#203b65;font-weight:600}.warning{font-size:11px;color:#916023;margin:5px 0}.actions{display:flex;flex-wrap:wrap;gap:7px}.foot{color:#8590a2;font-size:10px;margin-top:9px}
    @media(prefers-color-scheme:dark){.panel{background:#202938;color:#e8effc;border-color:#41506a}.title{color:#a9c1ff}button{background:#283b5c;color:#c6d8ff;border-color:#425779}.candidate{background:#2a3850;color:#dce8ff}.message{color:#b0bdd1}.warning{color:#efcd93}}
  `;
  shadow.appendChild(style);
  function el(tag, className, text, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    if (tag === "button") node.type = "button";
    parent?.appendChild(node);
    return node;
  }
  const launcher = el("button", "launcher", "转英文", shadow);
  launcher.setAttribute("aria-label", "打开 HoverGloss 英文搜索候选");
  launcher.setAttribute("aria-expanded", "false");
  launcher.style.cssText = "padding:5px 10px;border-radius:999px;font-size:12px;box-shadow:0 3px 12px #1425411a;white-space:nowrap";
  const panel = el("section", "panel", "", shadow);
  panel.hidden = true;
  panel.setAttribute("aria-label", "HoverGloss 英文搜索助手");
  const header = el("div", "row", "", panel);
  el("span", "title", "HoverGloss · 英文搜索", header);
  const close = el("button", "close", "收起", header);
  const enabledLabel = el("label", "", "", panel);
  const enabled = el("input", "", "", enabledLabel); enabled.type = "checkbox";
  el("span", "", "在 " + site.label + " 搜索框启用 中 → 英", enabledLabel);
  const autoLabel = el("label", "", "", panel);
  const automatic = el("input", "", "", autoLabel); automatic.type = "checkbox";
  el("span", "", "自动替换（仍需自己按回车搜索）", autoLabel);
  const message = el("p", "message", "", panel); message.setAttribute("role", "status");
  const original = el("p", "message", "", panel);
  original.hidden = true;
  const candidate = el("p", "candidate", "", panel);
  const warning = el("p", "warning", "", panel);
  const actions = el("div", "actions", "", panel);
  const prepare = el("button", "", "准备中译英", actions);
  const apply = el("button", "", "替换为英文", actions);
  const undo = el("button", "", "恢复中文", actions);
  const retry = el("button", "", "重试翻译", actions);
  el("div", "foot", "本机翻译 · 输入停顿后生成候选 · 不自动搜索", panel);
  document.documentElement.appendChild(host);

  // Keep controls in GitHub's dialog focus boundary; a manual popover escapes
  // transformed/clipped ancestors and native top-layer stacking, without stealing focus.
  function mountSearchOverlay(target) {
    if (site.id !== "github") return;
    const next = target.closest?.('dialog, [role="dialog"], [popover]') || null;
    if (next !== searchOverlay) {
      searchOverlay?.removeEventListener?.("close", hide);
      overlayObserver?.disconnect();
      searchOverlay = next;
      searchOverlay?.addEventListener("close", hide);
      if (typeof MutationObserver === "function" && searchOverlay) {
        overlayObserver = new MutationObserver(schedulePosition);
        overlayObserver.observe(searchOverlay, { attributes: true, attributeFilter: ["open", "hidden", "aria-hidden", "style", "class"] });
        overlayObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
    }
    const parent = searchOverlay || document.documentElement;
    if (host.parentElement !== parent) {
      if (useTopLayer && host.matches(":popover-open")) host.hidePopover();
      parent.appendChild(host);
    }
  }
  function syncTopLayer() {
    if (!useTopLayer) return;
    try {
      const open = host.matches(":popover-open");
      if (host.style.display !== "none" && !open) host.showPopover();
      else if (host.style.display === "none" && open) host.hidePopover();
    } catch {
      // A failed popover must not leave a permanently hidden launcher. Keep the
      // ordinary fixed overlay inside the search dialog as a safe fallback.
      useTopLayer = false;
      host.removeAttribute("popover");
    }
  }

  function active() {
    return host.style.display !== "none" && input?.isConnected && boundUrl === location.href &&
      document.visibilityState !== "hidden" && (sites.deepActive(document) === input || document.activeElement === host);
  }
  function returnFocusToSearch() {
    if (hiding || !input?.isConnected || !input.getClientRects().length) return;
    const wasWriting = writing;
    writing = true;
    try { input.focus({ preventScroll: true }); }
    finally { writing = wasWriting; }
  }
  const field = (event) => sites.eventField(event, location.hostname);
  const inPanel = (event) => event.target === host || (event.composedPath?.() || []).includes(host);
  function position() {
    if (boundUrl !== location.href || !host.isConnected || !input?.isConnected || !input.getClientRects().length ||
        searchOverlay?.hidden || searchOverlay?.getAttribute?.("aria-hidden") === "true" ||
        (searchOverlay?.tagName === "DIALOG" && searchOverlay.hasAttribute?.("open") === false)) { hide(); return; }
    const rect = input.getBoundingClientRect();
    const width = expanded ? Math.min(310, window.innerWidth - 16) : 96;
    const beside = rect.right + width + 18 < window.innerWidth;
    const left = beside ? rect.right + 8 : Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const top = beside ? (rect.top ?? rect.bottom) : rect.bottom + 8;
    host.style.width = expanded ? width + "px" : "max-content";
    host.style.left = `${left}px`;
    host.style.top = `${Math.max(8, Math.min(top, window.innerHeight - host.getBoundingClientRect().height - 8))}px`;
  }
  function render(state) {
    lastState = state;
    // Hiding the focused "prepare" button drops focus to <body> in Chromium.
    // The queued translation then fails its active-field guard. Transfer focus
    // before hiding controls, without reconfiguring/cancelling the controller.
    const focused = shadow.activeElement;
    if (focused && (
      (focused === prepare && (!state.enabled || client.ready)) ||
      (focused === apply && !state.candidate) ||
      (focused === undo && !state.canUndo) ||
      (focused === retry && (state.status !== "error" || !client.ready)) ||
      (focused === launcher && expanded) ||
      (focused !== launcher && !expanded)
    )) returnFocusToSearch();
    enabled.checked = settings[enabledKey];
    automatic.checked = settings[autoKey];
    autoLabel.hidden = !state.enabled;
    const labels = { off: "开启后仅处理主搜索框，不处理评论或其他输入框。", idle: "输入中文搜索词，可保留 SQL、Python 等英文。", composing: "正在输入中文…", waiting: "输入停顿后生成英文候选…", prepare: "请点击准备中译英；首次可能需要下载语言包。", translating: "正在生成英文候选，原文保持不变。", candidate: "英文候选已生成，可替换后再搜索。" };
    message.textContent = state.message || labels[state.status] || "";
    candidate.hidden = !state.candidate;
    candidate.textContent = state.candidate ? "英文候选：" + state.candidate.english : "";
    original.hidden = !state.candidate;
    original.textContent = state.candidate ? "原文：" + state.candidate.original : "";
    warning.hidden = !state.candidate?.warning;
    warning.textContent = state.candidate?.warning || "";
    apply.hidden = !state.candidate;
    undo.hidden = !state.canUndo;
    prepare.hidden = !state.enabled || client.ready;
    prepare.disabled = preparing;
    retry.hidden = state.status !== "error" || !client.ready;
    panel.hidden = !expanded;
    launcher.hidden = expanded;
    launcher.textContent = state.canUndo ? "已转英文" : state.status === "translating" ? "翻译中…" : state.candidate ? "查看英文" : state.status === "error" ? "翻译失败" : "转英文";
    launcher.setAttribute("aria-expanded", String(expanded));
    if (!hiding && input?.isConnected && boundUrl === location.href && (sites.deepActive(document) === input || document.activeElement === host)) {
      const visible = expanded || state.canUndo || (state.status !== "composing" && /\p{Script=Han}/u.test(input.value));
      host.style.display = visible ? "block" : "none";
    }
    syncTopLayer();
    if (host.style.display !== "none") position();
  }
  function hide() {
    dismissed = true;
    hiding = true;
    expanded = false;
    host.style.display = "none";
    syncTopLayer();
    try { controller?.suspend(); } finally { hiding = false; }
  }
  function show(target) {
    if (hiding) return;
    if (!core.isMainSearch(target, location.hostname)) return;
    dismissed = false;
    mountSearchOverlay(target);
    if (input !== target || boundUrl !== location.href) {
      expanded = false;
      controller?.suspend();
      input = target;
      boundUrl = location.href;
      lastState = null;
      const bound = target;
      controller = core.createController({
        getValue: () => bound.value,
        setValue(value) {
          writing = true;
          try {
            const prototype = bound.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
            setter.call(bound, value);
            bound.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
            bound.focus();
            bound.setSelectionRange(value.length, value.length);
          } finally { writing = false; }
        },
        ready: () => client.ready, translate: (value) => client.translate(value), active,
        requested: () => expanded || settings[autoKey],
        render
      });
    }
    host.style.display = "block";
    controller.configure(settings[enabledKey], settings[autoKey]);
    if (lastState) render(lastState);
    else controller.changed();
  }
  async function saveSettings() {
    const previous = { ...settings };
    settings = { [enabledKey]: enabled.checked, [autoKey]: automatic.checked };
    controller?.configure(settings[enabledKey], settings[autoKey]);
    try { await chrome.storage.local.set(settings); }
    catch { settings = previous; controller?.configure(settings[enabledKey], settings[autoKey]); message.textContent = "设置保存失败，请重试。"; }
  }
  enabled.addEventListener("change", saveSettings);
  automatic.addEventListener("change", saveSettings);
  launcher.addEventListener("click", () => {
    expanded = true;
    if (lastState?.candidate || lastState?.canUndo) render(lastState);
    else controller?.request();
  });
  close.addEventListener("click", () => { expanded = false; controller?.suspend(); });
  apply.addEventListener("click", () => controller?.apply());
  undo.addEventListener("click", () => controller?.undo());
  retry.addEventListener("click", () => controller?.changed());
  prepare.addEventListener("click", async () => {
    if (preparing) return;
    preparing = true; prepare.disabled = true;
    message.textContent = "正在准备本机中译英…";
    try {
      // prepare starts Translator.create before the first await to preserve the click.
      await client.prepare((fraction) => { message.textContent = `中译英语言包准备中：${Math.round(fraction * 100)}%`; });
      if (active()) controller?.changed();
      if (lastState?.status === "idle") message.textContent = "中译英已就绪，可以输入中文搜索词。";
    } catch (error) { message.textContent = `准备失败：${error.message || "请更新浏览器后重试"}`; }
    finally { preparing = false; prepare.disabled = false; }
  });
  document.addEventListener("focusin", (event) => {
    if (inPanel(event)) return;
    const target = field(event);
    if (target) { if (!writing) { show(target); controller.changed(); } }
    else hide();
  }, true);
  document.addEventListener("pointerdown", (event) => {
    const target = field(event);
    if (target) show(target);
    else if (!inPanel(event)) hide();
  }, true);
  document.addEventListener("input", (event) => {
    if (writing) return;
    const target = field(event);
    if (!target) return;
    if (target !== input || boundUrl !== location.href) show(target);
    else controller?.changed();
  }, true);
  document.addEventListener("compositionstart", (event) => { if (field(event) === input) controller?.compositionStart(); }, true);
  document.addEventListener("compositionend", (event) => { if (field(event) === input) controller?.compositionEnd(); }, true);
  document.addEventListener("keydown", (event) => {
    if (field(event) === input && !event.isComposing && event.keyCode !== 229 && ["Escape", "Enter"].includes(event.key)) hide();
    if (inPanel(event) && event.key === "Escape") hide();
  }, true);
  document.addEventListener("submit", (event) => { if (event.target.contains?.(input)) hide(); }, true);
  document.addEventListener("yt-navigate-start", hide);
  document.addEventListener("turbo:before-visit", hide);
  window.addEventListener("popstate", hide);
  window.addEventListener("pagehide", hide);
  // GitHub can hydrate/replace a focused input without another focus or input
  // event. Reconcile only DOM changes, at most once per frame, never by polling.
  function scheduleDiscovery(records) {
    if (discoveryFrame !== null) return;
    if (records?.length && records.every((record) =>
      record.target === host || host.contains?.(record.target) ||
      (record.type === "childList" && [...record.addedNodes, ...record.removedNodes].length > 0 &&
        [...record.addedNodes, ...record.removedNodes].every((node) => node === host)))) return;
    discoveryFrame = requestAnimationFrame(() => {
      discoveryFrame = null;
      if (document.visibilityState === "hidden") { hide(); return; }
      const target = sites.deepActive(document);
      if (core.isMainSearch(target, location.hostname) && (target !== input || (!dismissed && !host.isConnected))) {
        show(target);
        controller?.changed();
      } else if (host.style.display !== "none") {
        if (boundUrl !== location.href || !input?.isConnected || (!active() && target !== input)) { hide(); return; }
        mountSearchOverlay(input);
        syncTopLayer();
        position();
      }
    });
  }
  if (site.id === "github" && typeof MutationObserver === "function") {
    discoveryObserver = new MutationObserver(scheduleDiscovery);
    discoveryObserver.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["role", "aria-label", "aria-labelledby", "aria-controls", "placeholder", "open", "hidden", "aria-hidden"]
    });
    window.addEventListener("pagehide", () => discoveryObserver.disconnect());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") hide(); });
  }
  function schedulePosition() {
    if (frame !== null || host.style.display === "none") return;
    frame = requestAnimationFrame(() => { frame = null; position(); });
  }
  window.addEventListener("resize", schedulePosition, { passive: true });
  document.addEventListener("scroll", schedulePosition, { passive: true, capture: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(changes[enabledKey] || changes[autoKey])) return;
    for (const key of Object.keys(defaults)) if (changes[key]) settings[key] = Boolean(changes[key].newValue);
    controller?.configure(settings[enabledKey], settings[autoKey]);
    if (lastState) render({ ...lastState, enabled: settings[enabledKey] });
  });
  chrome.storage.local.get(defaults).then((value) => {
    settings = value;
    const target = sites.deepActive(document);
    if (core.isMainSearch(target, location.hostname)) { show(target); controller.changed(); }
  }).catch(() => { message.textContent = "无法读取设置，请刷新页面后重试。"; });
})();
