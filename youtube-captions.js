(function () {
  "use strict";
  if (globalThis.__hoverGlossCaptionsInstalled) return;
  globalThis.__hoverGlossCaptionsInstalled = true;
  const core = HoverGlossLiveCaptions, ports = new Set();
  const sites = HoverGlossCaptionSites, site = sites.forURL(location.href);
  if (!site) return;
  const getPlayer = () => sites.player(document, site);
  const display = new core.PlayerCue(), overlay = new HoverGlossPlayerCaptions.Overlay(document, site.native);
  let options = core.playerOptions({ mode: site.defaultMode, fullscreen: true }), media = null, timer = null, detachTimer = null;
  let state = "stopped", session = "", boundVideo = "", prepared = false, preparing = false;
  let heartbeat = 0, wasFullscreen = false, previousTime = null, emptySince = null, lastSeen = 0;
  let lastStatus = "尚未开始", history = [], bar = null, barStatus = null, enable = null, pauseButton = null, stopButton = null;
  let preparation = 0;
  let quickStart = false, pendingStart = false;
  const preferenceKey = `captionPlayerPreferencesV1:${site.platform}`;
  const preferencesReady = chrome.storage?.local?.get
    ? chrome.storage.local.get({ [preferenceKey]: null }).then((saved) => {
      if (saved[preferenceKey]) options = core.playerOptions(saved[preferenceKey]);
    }).catch(() => {}) : null;
  function savePreferences() {
    chrome.storage?.local?.set?.({ [preferenceKey]: options })?.catch(() => status("字幕设置未能保存，下次打开可能恢复默认"));
  }
  let tabSuspended = false, detachedReturn = false;
  const scheduler = new HoverGlossCCSession.Scheduler(async (text) => {
    status("正在本机翻译英文 CC…");
    const result = await HoverGlossBrowserTranslator.translate({ target: text, kind: "sentence" });
    return core.normalize(result.translation);
  }, (job, value, error) => {
    if (state !== "running") return;
    if (error || !value) {
      overlay.acceptPair(job.id, job.text, "", true);
      status(`本机翻译失败：${String(error?.message || "未返回译文").slice(0, 140)}；将重试，英文 CC 保留`); return;
    }
    const row = { type: "caption", id: job.id, revision: 1, stable: true, text: job.text, time: job.time, translation: value };
    history = history.filter((item) => item.id !== row.id);
    history.push(row); if (history.length > 80) history.shift();
    overlay.acceptPair(job.id, job.text, value); post(row);
    status("正在读取英文 CC · 中文由本机生成");
  });
  function snapshot() {
    return { protocol: 2, prepared, preparing, pendingStart, state, suspended: tabSuspended, session, videoId: core.videoId(location.href), options, history: [...history], message: lastStatus };
  }
  function post(message) {
    for (const port of [...ports]) {
      try { port.postMessage({ ...message, session, videoId: boundVideo || core.videoId(location.href) }); }
      catch { ports.delete(port); }
    }
  }
  function sync() { post({ type: "session", snapshot: snapshot() }); updateBar(); }
  function status(message) {
    if (message !== lastStatus) { lastStatus = message; post({ type: "status", message }); updateBar(); }
  }
  function updateBar() {
    if (!bar) return;
    barStatus.textContent = lastStatus;
    enable.hidden = (!quickStart && prepared) || state !== "stopped";
    enable.disabled = preparing;
    enable.textContent = preparing ? "准备中…" : quickStart ? "开始双语字幕" : "启用本机翻译";
    pauseButton.hidden = state === "stopped";
    pauseButton.textContent = state === "paused" ? "继续" : "暂停";
    stopButton.hidden = !preparing && state === "stopped";
  }
  function mountBar() {
    const player = getPlayer();
    if (!player) { status("未找到播放器，请等待视频加载后再点准备"); return false; }
    if (bar?.parentElement === player) return true;
    bar?.remove(); bar = document.createElement("div");
    bar.id = "hovergloss-cc-session"; bar.setAttribute("data-concise-hover-ignore", "");
    bar.style.cssText = "position:absolute;top:12px;right:12px;z-index:61;max-width:80%;pointer-events:auto";
    const shadow = bar.attachShadow({ mode: "open" }), style = document.createElement("style");
    style.textContent = ":host{font:13px Arial,sans-serif;color:white}*{box-sizing:border-box}[hidden]{display:none!important}.tools{display:flex;gap:6px;align-items:center;background:#111d;padding:7px 9px;border-radius:8px;max-width:100%}span{max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}button{font:inherit;color:#fff;background:#285ac7;border:0;border-radius:5px;padding:6px 9px;cursor:pointer;white-space:nowrap}button:focus-visible{outline:2px solid #fff}";
    const tools = document.createElement("div"); tools.className = "tools";
    barStatus = document.createElement("span"); barStatus.setAttribute("role", "status");
    enable = document.createElement("button"); enable.type = "button"; enable.textContent = "启用本机翻译";
    pauseButton = document.createElement("button"); pauseButton.type = "button";
    stopButton = document.createElement("button"); stopButton.type = "button"; stopButton.textContent = "停止";
    enable.addEventListener("click", (event) => { event.stopPropagation(); return prepareAndStart(); });
    pauseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state === "running") pause();
      else if (state === "paused" && document.visibilityState !== "hidden" &&
          (ports.size || options.mode !== "native" && (!document.fullscreenElement || options.fullscreen))) {
        start({ session, videoId: boundVideo, player: options, confirmed: true }, !ports.size);
      }
      else status("请重新打开字幕侧栏后继续");
    });
    stopButton.addEventListener("click", (event) => { event.stopPropagation(); stop("已停止字幕"); });
    tools.append(barStatus, enable, pauseButton, stopButton); shadow.append(style, tools); player.append(bar); updateBar(); return true;
  }
  async function prepareAndStart(fromSwitch = false) {
      const id = core.videoId(location.href);
      if (preparing || !id) return;
      if (!getPlayer()) { pendingStart = false; status("播放器尚未加载，请稍后重试"); sync(); return; }
      const attempt = ++preparation;
      const begin = quickStart;
      pendingStart = false; preparing = true; mountBar(); status("准备本机英中翻译…"); sync();
      try {
        // Page clicks retain activation. A popup request can use an installed model;
        // if the browser requires a page gesture, keep the page button available.
        const operation = prepared ? Promise.resolve() : HoverGlossBrowserTranslator.activate((value) => {
          if (attempt === preparation) status(`正在准备语言包 ${Math.round(value * 100)}%`);
        });
        await operation;
        if (attempt !== preparation || id !== core.videoId(location.href)) return;
        prepared = true;
        if (begin) {
          const player = getPlayer();
          const cc = site.platform === "youtube" ? player?.querySelector(".ytp-subtitles-button") : null;
          if (cc?.getAttribute("aria-pressed") === "false") cc.click?.();
          start({ session: state === "paused" && session ? session : globalThis.crypto?.randomUUID?.() || `cc-${Date.now()}-${attempt}`, videoId: id, player: options, confirmed: true }, true);
        } else status("本机翻译已就绪");
      } catch (error) {
        if (attempt === preparation) {
          prepared = false;
          pendingStart = fromSwitch && (error?.name === "NotAllowedError" || /user.activation|user.gesture/i.test(String(error?.message || error)));
          status(pendingStart ? "首次启用：请在视频画面点击“开始双语字幕”" : `本机翻译准备失败：${String(error?.message || error).slice(0, 160)}`);
        }
      } finally { if (attempt === preparation) { preparing = false; sync(); } }
  }
  function fullscreenActive() {
    const player = getPlayer(), full = document.fullscreenElement;
    return Boolean(state === "running" && options.fullscreen && options.mode !== "native" && document.visibilityState !== "hidden" &&
      player && full && (full === player || full.contains?.(player)) && core.videoId(location.href) === boundVideo);
  }
  function reportFullscreen(token = "") { post({ type: "player-fullscreen", active: fullscreenActive(), token }); }
  function cancelDetach() { if (detachTimer !== null) clearTimeout(detachTimer); detachTimer = null; }
  function checkDetach() {
    cancelDetach();
    if (session && options.mode !== "native" && (!document.fullscreenElement || options.fullscreen)) detachedReturn = true;
    if (ports.size || state === "stopped" || tabSuspended || detachedReturn || fullscreenActive()) return;
    // A bounded grace accommodates fullscreen/teardown/reconnect event ordering.
    detachTimer = setTimeout(() => {
      detachTimer = null;
      if (session && options.mode !== "native" && (!document.fullscreenElement || options.fullscreen)) detachedReturn = true;
      if (!ports.size && state !== "stopped" && !tabSuspended && !detachedReturn && !fullscreenActive()) stop("侧栏已关闭且视频未全屏，字幕已停止");
    }, 1000);
  }
  function clearPlayer(soft = false) {
    display.reset(); if (soft) overlay.gap(); else { scheduler.reset(); overlay.clear(); }
  }
  function halt() {
    if (timer !== null) clearInterval(timer); timer = null; cancelDetach(); scheduler.reset(); display.reset(); overlay.dispose();
    media?.removeEventListener?.("seeking", seek); media?.removeEventListener?.("emptied", seek); media = null; previousTime = null;
  }
  function stop(message = "已停止字幕") {
    tabSuspended = detachedReturn = false;
    state = "stopped"; preparation++; preparing = pendingStart = false; halt(); session = ""; boundVideo = "";
    bar?.remove(); bar = null; status(message); sync();
    if (quickStart && message === "已停止字幕" && core.videoId(location.href)) mountBar();
  }
  function pause() { tabSuspended = detachedReturn = false; state = "paused"; halt(); status("已暂停字幕"); sync(); }
  function suspendTab() {
    // CC is read and translated in the video page, independently of panel visibility.
    if (state === "running") { detachedReturn = true; sync(); }
  }
  function resumeTab() {
    if (!tabSuspended || state !== "paused" || document.visibilityState === "hidden") return;
    if (core.videoId(location.href) !== boundVideo) { navigate(); return; }
    // Sidebar-only mode needs a display connection; onConnect retries recovery.
    if (!ports.size && (options.mode === "native" || document.fullscreenElement && !options.fullscreen)) return;
    start({ session, videoId: boundVideo, player: options, confirmed: true }, true);
  }
  function seek() {
    if (state !== "running") return;
    clearPlayer(); history = []; previousTime = null;
    post({ type: "reset", message: "播放位置已变化，字幕从当前位置重新开始" });
  }
  function sample() {
    if (state !== "running") return;
    const now = Date.now(), full = fullscreenActive();
    if (wasFullscreen && !full) { heartbeat = now; checkDetach(); }
    wasFullscreen = full;
    if (core.videoId(location.href) !== boundVideo) { navigate(); return; }
    if (ports.size && now - heartbeat > 7000 && !full && !detachedReturn && document.visibilityState !== "hidden") { stop("侧栏连接超时，字幕已停止"); return; }
    const player = getPlayer();
    if (!player) { clearPlayer(); overlay.dispose(); status(`等待 ${site.name} 播放器…`); return; }
    if (bar?.parentElement !== player) mountBar();
    if (player.classList.contains("ad-showing")) { clearPlayer(); previousTime = null; status("广告期间暂停读取字幕"); return; }
    const nextMedia = player.querySelector("video");
    if (nextMedia !== media) {
      media?.removeEventListener?.("seeking", seek); media?.removeEventListener?.("emptied", seek);
      if (media) clearPlayer(); media = nextMedia;
      media?.addEventListener?.("seeking", seek); media?.addEventListener?.("emptied", seek);
    }
    if (media?.seeking) { clearPlayer(); return; }
    if (player.querySelector(".ytp-subtitles-button")?.getAttribute?.("aria-pressed") === "false") {
      clearPlayer(); status("请开启播放器英文 CC"); return;
    }
    const mediaTime = Number(media?.currentTime);
    if (Number.isFinite(mediaTime)) {
      if (previousTime !== null && (mediaTime < previousTime - 3 || mediaTime > previousTime + 12)) seek();
      previousTime = mediaTime;
    }
    const visible = sites.segments(player, site).filter((node) => {
      if (!node.getClientRects().length) return false;
      const style = getComputedStyle(node);
      return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    });
    const text = core.normalize(visible.map((node) => node.textContent).join(" "));
    if (/[\u3400-\u9fff]/.test(text)) { clearPlayer(); status("检测到中文 CC，请切换为英语（不要选择自动翻译）"); return; }
    if (text && /[A-Za-z]/.test(text)) {
      display.update(text, now);
      if (options.mode !== "native") {
        try {
          const rects = visible.map((node) => node.getBoundingClientRect());
          overlay.show(player, display.current, rects.length ? { top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) } : null);
        } catch { overlay.dispose(); options = core.playerOptions({ ...options, mode: "native" }); status("画面显示失败，已恢复原生 CC；侧栏仍可翻译"); }
      }
      lastSeen = now; emptySince = null;
      scheduler.observe(display.current, mediaTime, now);
    } else {
      clearPlayer(true);
      if (emptySince === null) emptySince = now;
      if (now - emptySince >= 1200) scheduler.reset();
      if (now - lastSeen >= 6000) status(site.platform === "bilibili"
        ? "未读取到 B站英文 CC。请开启可选英文字幕；压进画面或其他插件生成的字幕，本版不能直接缩放或替换（不会自动 OCR/听音）"
        : "暂未检测到英文 CC，请开启字幕并选择英语");
    }
    scheduler.tick(now);
  }
  function start(message, returning = false) {
    const id = core.videoId(location.href);
    if (!prepared || message.confirmed !== true || !id || id !== message.videoId ||
        typeof message.session !== "string" || !message.session || message.session.length > 100) return;
    const resume = state === "paused" && session === message.session;
    tabSuspended = false; detachedReturn = returning && options.mode !== "native" && (!document.fullscreenElement || options.fullscreen);
    halt(); if (!resume) history = [];
    session = message.session; boundVideo = id; state = "running"; heartbeat = lastSeen = Date.now();
    emptySince = null; options = core.playerOptions(message.player); overlay.configure(options);
    mountBar(); status("等待英文 CC…"); sync(); reportFullscreen(); sample();
    if (state === "running") timer = setInterval(sample, 250);
  }
  function navigate() {
    if (!boundVideo || core.videoId(location.href) === boundVideo) return;
    history = []; stop("视频已变化，请重新确认英文 CC 并手动开始"); post({ type: "navigation" });
  }
  document.addEventListener("yt-navigate-finish", navigate);
  window.addEventListener("popstate", navigate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") suspendTab(); else { heartbeat = Date.now(); resumeTab(); }
  });
  document.addEventListener("fullscreenchange", () => {
    heartbeat = Date.now(); wasFullscreen = fullscreenActive(); reportFullscreen(); checkDetach();
  });
  window.addEventListener("pagehide", () => stop("视频页面已关闭"));
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== core.PORT) return;
    ports.add(port); cancelDetach(); heartbeat = Date.now(); detachedReturn = false;
    port.onMessage.addListener((message) => {
      if (message?.videoId !== core.videoId(location.href)) return;
      if (message.type === "toggle-captions") {
        if (message.enabled === false) { quickStart = false; stop(); return; }
        if (message.enabled !== true || state === "running" || preparing) { sync(); return; }
        quickStart = true;
        // Popup control always supplies on-video captions, even after sidebar-only mode.
        if (options.mode === "native") options = core.playerOptions({ ...options, mode: site.defaultMode });
        void prepareAndStart(true); return;
      }
      if (message.type === "arm-start") {
        quickStart = true;
        if (state === "stopped" && !preparing) { options = core.playerOptions(message.player || options); savePreferences(); status("点击画面“开始双语字幕”即可翻译英文 CC"); }
        mountBar(); sync(); return;
      }
      if (message.type === "disarm-start") {
        quickStart = false;
        stop("已切换字幕模式");
        return;
      }
      if (message.type === "prepare-page") {
        quickStart = false;
        if (prepared) sync(); else { status("请在视频画面点击“启用本机翻译”"); mountBar(); }
        return;
      }
      if (message.type === "start") { start(message); return; }
      if (message.type === "clear-history") { history = []; sync(); return; }
      if (!session || message.session !== session || message.videoId !== boundVideo) return;
      if (message.type === "heartbeat") heartbeat = Date.now();
      if (message.type === "fullscreen-probe") reportFullscreen(String(message.token || "").slice(0, 100));
      if (message.type === "pause") pause();
      if (message.type === "stop") stop();
      if (message.type === "player-settings") {
        scheduler.reset(); options = core.playerOptions(message.options); savePreferences(); overlay.configure(options); reportFullscreen(); checkDetach();
        if (state === "running") sample(); sync();
      }
    });
    port.onDisconnect.addListener(() => { ports.delete(port); checkDetach(); });
    resumeTab();
    const ready = () => {
      if (!ports.has(port)) return;
      try { port.postMessage({ type: "ready", protocol: 2, videoId: core.videoId(location.href), title: String(document.title || site.name).slice(0, 180), snapshot: snapshot() }); }
      catch { ports.delete(port); checkDetach(); }
    };
    if (preferencesReady) void preferencesReady.then(ready); else ready();
  });
})();
