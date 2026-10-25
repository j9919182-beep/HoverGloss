(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const core = HoverGlossLiveCaptions, translator = HoverGlossBrowserTranslator;
  let port = null, ready = false, boundId = null, boundWindow = null, video = "", session = "";
  let state = "stopped", prepared = false, binding = 0, follow = true, heartbeat = null;
  let audioPermission = false, audioAttempt = 0, modelAttempt = 0, audioSerial = 0, audioClock = 0, audioElapsed = 0;
  let permissionRevision = 0;
  let playerCue = null;
  let playerFullscreen = false, visibilityTimer = null, visibilityToken = "";
  let pageOwned = false, pagePrepared = false, localPrepared = false, pageSuspended = false;
  const panelTab = /[?&]tabId=(\d+)(?:&|$)/.exec(globalThis.location?.search || "");
  const panelTabId = panelTab ? Number(panelTab[1]) : null;
  const isAudio = () => $("captionMode").value === "audio";
  if (!["native", "below", "bilingual"].includes($("playerDisplay").value)) $("playerDisplay").value = "below";
  const playerSettings = () => core.playerOptions({ mode: $("playerDisplay").value, size: $("playerFontSize").value,
    ratio: $("playerRatio").value,
    offset: $("playerOffset").value, opacity: $("playerOpacity").value,
    hold: Number($("playerHold").value) * 1000, fullscreen: $("keepFullscreen").checked });
  const capture = new HoverGlossTabAudio.Capture();
  const records = new Map();
  const setStatus = (message) => { $("status").textContent = message; };
  const scrollLatest = () => { if (follow) $("transcript").scrollTop = $("transcript").scrollHeight; };
  const asr = new HoverGlossLocalASR.Client({
    createWorker: () => new Worker(chrome.runtime.getURL("vendor/local-asr/asr-worker.mjs"), { type: "module" }),
    onStatus: (message) => {
      setStatus(message);
      if (isAudio() && state !== "stopped" && !asr.ready) stop();
      controls();
    },
    onResult: (result) => {
      if (!isAudio() || state !== "running") return;
      const text = HoverGlossAudioCaptions.cleanTranscript(result.text);
      if (!text || !/[A-Za-z]/.test(text) || /^\[[^\]]+\]$/.test(text)) return;
      $("audioMetrics").textContent = `片段 ${result.duration.toFixed(1)}s · 识别 ${(result.elapsed / 1000).toFixed(1)}s · 提交至出文 ${(result.delay / 1000).toFixed(1)}s`;
      if (result.elapsed > result.duration * 1000) setStatus("本机识别慢于播放速度，可能跳过积压片段；可试 GPU 或使用 CC");
      else setStatus("正在识别标签页英文声音 · 自动识别可能有误，请核对原声");
      caption({ id: ++audioSerial, revision: 1, text, time: result.time, stable: true });
    }
  });
  const segmenter = new HoverGlossAudioCaptions.Segmenter(({ samples, time }) => {
    if (isAudio() && state === "running") asr.recognize(samples, time);
  });
  const queue = new core.TranslationQueue(async (text) => {
    const result = await translator.translate({ target: text, kind: "sentence" });
    return result.translation;
  }, (job, value, error) => {
    if (job.kind === "player") {
      if (state === "running" && !isAudio() && playerCue?.id === job.cueId && playerCue.text === job.text) {
        send("player-translation", { id: job.cueId, text: job.text, translation: core.normalize(value), error: Boolean(error) });
      }
      return;
    }
    const record = records.get(job.id);
    if (!record || record.revision !== job.revision) return;
    record.chinese.textContent = error || value;
    record.chinese.classList.toggle("pending", !!error);
    scrollLatest();
  });
  function controls() {
    $("englishControl").hidden = isAudio() || pageOwned;
    $("prepare").hidden = pageOwned && !isAudio();
    $("start").hidden = pageOwned && !isAudio() && state !== "paused";
    const sourceReady = isAudio() ? asr.ready && audioPermission && $("audioConsent").checked : $("englishConfirmed").checked;
    $("start").disabled = !(ready && video && prepared && sourceReady) || ["running", "starting"].includes(state);
    $("start").textContent = state === "paused" ? "继续" : "开始";
    $("pause").disabled = state !== "running";
    $("stop").disabled = state === "stopped";
    $("captionMode").disabled = state !== "stopped";
    $("asrBackend").disabled = state !== "stopped" || !!asr.preparing;
    $("prepareASR").disabled = state !== "stopped" || !!asr.preparing;
    $("releaseASR").disabled = !asr.worker;
    $("grantAudio").disabled = audioPermission;
    $("grantAudio").textContent = audioPermission ? "标签页音频已授权" : "授权标签页音频";
    $("playerControls").hidden = isAudio();
  }
  function send(type, extra = {}) {
    try { port?.postMessage({ ...extra, type, session, videoId: video }); return !!port; }
    catch { ready = false; stop(); setStatus("连接已断开，请点击“重新连接”"); return false; }
  }
  function cancelVisibilityCheck() {
    if (visibilityTimer !== null) clearTimeout(visibilityTimer);
    visibilityTimer = null; visibilityToken = "";
  }
  function hiddenPanel() {
    if (state === "stopped") return;
    if (pageOwned && !isAudio()) {
      cancelVisibilityCheck();
      setStatus(state === "paused" && !pageSuspended ? "已保留暂停的字幕会话；回来后点击“继续”" :
        "英文 CC 翻译继续运行；可在视频画面暂停或停止");
      return;
    }
    if (isAudio() || state !== "running" || !playerSettings().fullscreen || playerSettings().mode === "native") {
      stop(); setStatus("侧栏已隐藏，读取已停止；回来后请手动开始"); return;
    }
    if (visibilityTimer !== null) return;
    // Visibility and fullscreen events can arrive in either order. Confirm the
    // actual visible player's DOM fullscreen state, with a bounded grace period.
    playerFullscreen = false; visibilityToken = crypto.randomUUID();
    visibilityTimer = setTimeout(() => {
      visibilityTimer = null; visibilityToken = "";
      if (document.visibilityState === "hidden" && !playerFullscreen) {
        stop(); setStatus("侧栏隐藏且未确认视频全屏，字幕已停止");
      }
    }, 600);
    send("fullscreen-probe", { token: visibilityToken });
  }
  function stop(notify = true) {
    // Clear identity before disconnect/error callbacks can re-enter this function.
    const oldSession = session; session = ""; state = "stopped";
    cancelVisibilityCheck(); playerFullscreen = false; pageSuspended = false;
    audioAttempt++; capture.stop(); segmenter.reset(); asr.cancel(); audioClock = 0; audioElapsed = 0;
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
    if (notify && oldSession && port) { try { port.postMessage({ type: "stop", session: oldSession, videoId: video }); } catch { /* disconnected */ } }
    queue.reset();
    playerCue = null;
    for (const record of records.values()) if (record.chinese.classList.contains("pending")) record.chinese.textContent = "已停止；未完成译文不再更新";
    controls();
  }
  function clearRows() {
    queue.reset(); playerCue = null; records.clear(); $("transcript").replaceChildren($("empty"));
    $("empty").hidden = false; $("count").textContent = "0 条字幕";
    follow = true; $("latest").hidden = true;
  }
  function currentPlayerCue(message) {
    if (state !== "running" || isAudio() || playerSettings().mode === "native") return;
    if (message.type === "player-clear") {
      if (playerCue) queue.forget("player-" + playerCue.id);
      playerCue = null; return;
    }
    if (!Number.isSafeInteger(message.id) || message.id < 1 || typeof message.text !== "string" || !core.normalize(message.text)) return;
    if (playerCue && message.id < playerCue.id) return;
    if (playerCue && playerCue.id !== message.id) queue.forget("player-" + playerCue.id);
    playerCue = { id: message.id, text: core.normalize(message.text) };
    queue.observe({ id: "player-" + message.id, cueId: message.id, revision: 1, kind: "player", priority: 1,
      text: playerCue.text, stable: message.stable === true });
  }
  function caption(message) {
    if (!["running", "paused"].includes(state) || !Number.isInteger(message.id) || !Number.isInteger(message.revision) || message.revision < 1) return;
    const text = core.normalize(message.text);
    if (!text) return;
    let record = records.get(message.id);
    if (record && record.revision > message.revision) return;
    if (!record) {
      const node = document.createElement("article"), stamp = document.createElement("span");
      const english = document.createElement("p"), chinese = document.createElement("p");
      node.className = "caption"; stamp.className = "stamp"; english.className = "english"; chinese.className = "chinese pending";
      const seconds = Math.max(0, Math.floor(Number(message.time) || 0));
      stamp.textContent = `${isAudio() ? "本次采集 " : ""}${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      node.append(stamp, english, chinese); $("transcript").append(node);
      record = { node, english, chinese, revision: 0, stableRevision: 0 };
      records.set(message.id, record);
    }
    if (record.revision !== message.revision) {
      record.revision = message.revision; record.english.textContent = text;
      record.chinese.textContent = "等待字幕稳定…"; record.chinese.classList.add("pending");
    }
    if (message.stable && record.stableRevision !== message.revision) {
      record.stableRevision = message.revision; record.chinese.textContent = "本机翻译中…";
    }
    if (pageOwned && !isAudio()) {
      record.chinese.textContent = core.normalize(message.translation) || "等待本机译文…";
      record.chinese.classList.toggle("pending", !message.translation);
    } else queue.observe({ ...message, text });
    while (records.size > 80) {
      const id = records.keys().next().value;
      records.get(id).node.remove(); records.delete(id); queue.forget(id);
    }
    $("empty").hidden = true; $("count").textContent = `${records.size} 条字幕`;
    scrollLatest();
  }
  function restoreSession(snapshot) {
    if (!pageOwned || isAudio() || snapshot?.protocol !== 2 || snapshot.videoId !== video) return;
    const nextSession = typeof snapshot.session === "string" ? snapshot.session : "";
    if (session !== nextSession) clearRows();
    session = nextSession; state = ["running", "paused"].includes(snapshot.state) && session ? snapshot.state : "stopped";
    pageSuspended = snapshot.suspended === true && state === "paused";
    pagePrepared = snapshot.prepared === true; prepared = pagePrepared;
    $("prepare").textContent = prepared ? "本机英中翻译已就绪" : "准备本机英中翻译";
    if (state !== "stopped") $("englishConfirmed").checked = true;
    const settings = core.playerOptions(snapshot.options);
    $("playerDisplay").value = settings.mode; $("playerFontSize").value = String(settings.size);
    $("playerOffset").value = String(settings.offset); $("playerOpacity").value = String(settings.opacity);
    $("playerHold").value = String(settings.hold / 1000); $("keepFullscreen").checked = settings.fullscreen;
    $("playerRatio").value = String(settings.ratio);
    // Replay already-translated pairs without starting another translation queue.
    if (Array.isArray(snapshot.history)) {
      const savedState = state; state = "paused";
      for (const row of snapshot.history.slice(-80)) caption(row);
      state = savedState;
    }
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = state === "running" ? setInterval(() => send("heartbeat"), 2000) : null;
    setStatus(String(snapshot.message || "已恢复字幕会话").slice(0, 240)); controls();
  }
  async function bind() {
    const attempt = ++binding;
    stop(!pageOwned || isAudio()); ready = false;
    const previousPort = port; port = null;
    try { previousPort?.disconnect(); } catch { /* old tab closed */ }
    boundId = null; video = ""; clearRows(); $("englishConfirmed").checked = false;
    $("audioConsent").checked = false;
    if (isAudio() && pageOwned) send("disarm-start");
    controls(); setStatus("连接当前标签页…");
    try {
      const tab = panelTabId !== null ? await chrome.tabs.get(panelTabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (attempt !== binding) return;
      boundWindow = tab?.windowId ?? null;
      video = core.videoId(tab?.url || "");
      if (!video) { $("videoTitle").textContent = "请打开 YouTube 或 B站视频页面"; setStatus("当前仅支持 YouTube /watch 和 B站 /video/BV、av 视频页；不支持 Shorts、B站直播或番剧"); return; }
      const bili = video.startsWith("bilibili:");
      $("audioModeOption").disabled = bili;
      if (bili && isAudio()) {
        $("captionMode").value = "cc"; prepared = false;
        $("englishControl").hidden = false; $("audioOptions").hidden = true;
      }
      boundId = tab.id;
      const connection = chrome.tabs.connect(tab.id, { name: core.PORT });
      port = connection;
      connection.onMessage.addListener((message) => {
        if (port !== connection || attempt !== binding) return;
        if (message?.type === "ready") {
          if (message.videoId !== video) { setStatus("视频页面已变化，请重新连接"); return; }
          ready = true; $("videoTitle").textContent = String(message.title || "YouTube").slice(0, 180);
          pageOwned = message.protocol === 2;
          if (pageOwned && !isAudio()) {
            restoreSession(message.snapshot); controls();
            send("arm-start", { player: playerSettings() }); return;
          }
          setStatus(isAudio() ? "已连接；准备两个本机模型，授权并确认音频后点击“开始”" : "已连接；确认英文 CC 并准备本机翻译后，点击“开始”"); controls(); return;
        }
        if (pageOwned && !isAudio() && message?.videoId === video) {
          if (message.type === "session") { restoreSession(message.snapshot); return; }
          if (message.type === "status") { setStatus(String(message.message || "").slice(0, 240)); return; }
          if (message.type === "navigation") { bind(); return; }
        }
        if (isAudio() || message?.session !== session || !session || message.videoId !== video) return;
        if (message.type === "player-fullscreen") {
          playerFullscreen = message.active === true && state === "running" && playerSettings().fullscreen && playerSettings().mode !== "native";
          if (playerFullscreen) {
            cancelVisibilityCheck();
            if (document.visibilityState === "hidden") setStatus("全屏 CC 字幕继续运行；退出全屏后可在侧栏停止");
          } else if (document.visibilityState === "hidden") hiddenPanel();
        }
        else if (message.type === "player-cue" || message.type === "player-clear") currentPlayerCue(message);
        else if (message.type === "caption") caption(message);
        else if (message.type === "status") setStatus(String(message.message || "").slice(0, 240));
        else if (message.type === "reset") { clearRows(); setStatus(message.message); }
        else if (message.type === "navigation") { bind(); }
        else if (message.type === "expired") { stop(); setStatus(String(message.message || "侧栏连接超时，已停止读取；点击“开始”可重试").slice(0, 240)); }
      });
      connection.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (port !== connection) return;
        port = null; ready = false; stop();
        setStatus("未连接字幕脚本。更新扩展后请刷新视频页面，再点击“重新连接”");
      });
    } catch {
      ready = false; stop(); setStatus("连接失败，请刷新视频页面后重新连接");
    }
  }
  $("prepare").addEventListener("click", async () => {
    if (pageOwned && !isAudio()) {
      send("prepare-page"); setStatus("请在视频画面右上方点击“启用本机翻译”，完成后回到侧栏开始"); return;
    }
    $("prepare").disabled = true; setStatus("准备本机英中翻译…首次可能需要下载语言包");
    try {
      // Invoke create() through activate() directly from the user click.
      await translator.activate((value) => setStatus(`正在准备语言包 ${Math.round(value * 100)}%`));
      prepared = localPrepared = true; $("prepare").textContent = "本机英中翻译已就绪";
      setStatus(isAudio() ? "本机英中翻译已就绪；还需准备语音模型、授权并确认音频后开始" : "本机翻译已就绪，不调用 AI 或远程翻译；确认英文 CC 后点击“开始”");
    } catch (error) {
      prepared = localPrepared = false; setStatus(String(error?.message || "本机翻译准备失败") + "。字幕功能仅使用本机翻译，不会转用 AI 或远程服务。");
    } finally { $("prepare").disabled = false; controls(); }
  });
  $("englishConfirmed").addEventListener("change", () => { if (!$("englishConfirmed").checked) stop(); controls(); });
  $("captionMode").addEventListener("change", () => {
    if (video.startsWith("bilibili:") && isAudio()) $("captionMode").value = "cc";
    stop(); clearRows();
    if (pageOwned) {
      prepared = isAudio() ? localPrepared : pagePrepared;
      $("prepare").textContent = prepared ? "本机英中翻译已就绪" : "准备本机英中翻译";
    }
    $("englishControl").hidden = isAudio(); $("audioOptions").hidden = !isAudio();
    $("audioConsent").checked = false;
    if (isAudio() && pageOwned) send("disarm-start");
    if (!isAudio()) {
      modelAttempt++; asr.dispose();
      if (pageOwned) send("arm-start", { player: playerSettings() });
    }
    setStatus(isAudio() ? "无 CC 识别为实验功能：先准备语音模型、英中翻译并授权音频，再手动开始" : "已切回轻量 CC 模式，不采集音频");
    controls();
  });
  $("grantAudio").addEventListener("click", () => {
    const revision = ++permissionRevision;
    // Optional permission is requested only from this explicit button, not on load.
    try {
      const request = chrome.permissions.request({ permissions: ["tabCapture"] });
      Promise.resolve(request).then((granted) => {
        if (revision !== permissionRevision) return;
        audioPermission = granted === true; controls();
        setStatus(audioPermission ? "已授权，尚未采集声音；确认并准备模型后点击“开始”" : "未授权；不会采集声音，仍可使用 CC 模式");
      }).catch(() => setStatus("音频授权失败，请重新加载扩展后重试"));
    } catch { setStatus("当前浏览器不能申请标签页音频权限"); }
  });
  $("audioConsent").addEventListener("change", () => { if (!$("audioConsent").checked) stop(); controls(); });
  $("prepareASR").addEventListener("click", async () => {
    const attempt = ++modelAttempt;
    setStatus("准备语音模型；只下载模型数据，不采集声音…");
    const operation = asr.prepare($("asrBackend").value);
    controls();
    try {
      await operation;
      if (attempt !== modelAttempt) return;
      setStatus("本机语音模型已就绪；还需准备英中翻译、音频授权与确认，然后点击“开始”");
    } catch (error) { if (attempt === modelAttempt) setStatus(String(error?.message || "语音模型准备失败")); }
    finally { controls(); }
  });
  $("releaseASR").addEventListener("click", () => {
    stop(); modelAttempt++; asr.dispose(); controls();
    $("audioMetrics").textContent = "语音模型已释放 · 下载缓存保留，下次需主动准备";
    setStatus("已停止音频采集并释放语音工作线程，未删除模型缓存");
  });
  $("asrBackend").addEventListener("change", () => {
    stop(); modelAttempt++; asr.dispose(); controls(); setStatus("运行方式已变更，请主动准备对应语音模型");
  });
  async function startAudio() {
    const attempt = ++audioAttempt;
    state = "starting"; controls(); setStatus("正在启动当前选定标签页音频…");
    try {
      const started = await capture.start(boundId, (samples) => {
        if (attempt === audioAttempt && state === "running") segmenter.push(samples, audioElapsed + (Date.now() - audioClock) / 1000);
      }, () => {
        if (attempt === audioAttempt) { stop(); setStatus("标签页音频已结束；重新开始需手动点击"); }
      });
      if (attempt !== audioAttempt) return;
      if (!started) throw new Error("音频启动已取消");
      audioClock = Date.now(); state = "running"; controls();
      setStatus("正在采集当前标签页的声音（不含麦克风）· 等待英文语音片段");
      $("audioMetrics").textContent = "正在采集 · 字幕时间为本次采集时间，不是视频原始时间码";
    } catch (error) {
      if (attempt !== audioAttempt) return;
      stop(); setStatus(`音频启动失败：${error?.message || error}。请从当前 YouTube 页点击 HoverGloss 图标重新打开侧栏再试。`);
    }
  }
  $("start").addEventListener("click", () => {
    if ($("start").disabled) return;
    if (state !== "paused") { clearRows(); session = crypto.randomUUID(); }
    if (isAudio()) { startAudio(); return; }
    state = "running"; follow = true; $("latest").hidden = true; controls();
    setStatus("等待英文 CC…");
    if (send("start", { player: playerSettings(), confirmed: $("englishConfirmed").checked })) {
      if (heartbeat !== null) clearInterval(heartbeat);
      heartbeat = setInterval(() => { if (state === "running") send("heartbeat"); }, 2000);
    }
  });
  $("pause").addEventListener("click", () => {
    if (state !== "running") return;
    if (isAudio()) {
      audioElapsed += (Date.now() - audioClock) / 1000; audioClock = 0; audioAttempt++;
      capture.stop(); segmenter.reset(); asr.cancel(); state = "paused"; controls();
      setStatus("已暂停并释放音频流；未完成识别片段已丢弃，已有中文翻译可继续完成"); return;
    }
    if (!send("pause")) return;
    state = "paused";
    if (playerCue) queue.forget("player-" + playerCue.id);
    playerCue = null;
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null; controls(); setStatus("已暂停读取，可以回看字幕；已有翻译任务可能继续完成");
  });
  $("stop").addEventListener("click", () => { stop(); setStatus("已停止读取，当前字幕仍可回看；再次开始会清空旧字幕"); });
  $("clear").addEventListener("click", () => { if (pageOwned && !isAudio()) send("clear-history"); stop(); clearRows(); setStatus("字幕已清空"); });
  $("reconnect").addEventListener("click", bind);
  $("fontSize").addEventListener("change", () => {
    const size = Number($("fontSize").value);
    if ([15, 18, 21].includes(size)) document.documentElement.style.setProperty("--caption-size", `${size}px`);
  });
  for (const id of ["playerDisplay", "playerFontSize", "playerRatio", "playerOffset", "playerOpacity", "playerHold", "keepFullscreen"]) {
    $(id).addEventListener("change", () => {
      if (playerCue) queue.forget("player-" + playerCue.id);
      playerCue = null;
      if (["running", "paused"].includes(state) && !isAudio()) send("player-settings", { options: playerSettings() });
      else if (pageOwned && !isAudio() && state === "stopped") send("arm-start", { player: playerSettings() });
    });
  }
  $("transcript").addEventListener("scroll", () => {
    const node = $("transcript"); follow = node.scrollHeight - node.scrollTop - node.clientHeight < 45;
    $("latest").hidden = follow;
  });
  $("latest").addEventListener("click", () => { follow = true; $("latest").hidden = true; scrollLatest(); });
  $("minimizePanel").addEventListener("click", async () => {
    if (boundId === null) return;
    if (isAudio()) { setStatus("本机听音依赖侧栏，请先停止听音，再收起面板；英文 CC 支持收起后继续"); return; }
    if (state === "running" && playerSettings().mode === "native") {
      $("playerDisplay").value = "below";
      send("player-settings", { options: playerSettings() });
    }
    try {
      if (chrome.sidePanel?.close) await chrome.sidePanel.close({ tabId: boundId });
      else await chrome.sidePanel.setOptions({ tabId: boundId, enabled: false });
    } catch { setStatus("请点击浏览器侧栏右上角 × 收起；画面 CC 字幕将继续"); }
  });
  chrome.tabs.onActivated.addListener((info) => { if (panelTabId === null && info.windowId === boundWindow) bind(); });
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (id === boundId && (info.status === "loading" || (info.url && core.videoId(info.url) !== video))) bind();
  });
  chrome.tabs.onRemoved.addListener((id) => { if (id === boundId) { stop(); ready = false; port = null; video = ""; controls(); setStatus("视频标签页已关闭"); } });
  window.addEventListener("pagehide", () => { stop(!pageOwned || isAudio()); modelAttempt++; asr.dispose(); try { port?.disconnect(); } catch { /* closed */ } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hiddenPanel();
    else cancelVisibilityCheck();
  });
  if (chrome.permissions?.contains) {
    const revision = permissionRevision;
    chrome.permissions.contains({ permissions: ["tabCapture"] }).then((granted) => { if (revision === permissionRevision) { audioPermission = granted === true; controls(); } }).catch(() => {});
    chrome.permissions.onRemoved?.addListener((removed) => {
      if (removed.permissions?.includes("tabCapture")) { permissionRevision++; audioPermission = false; if (isAudio()) stop(); controls(); setStatus("标签页音频权限已撤回，采集已停止"); }
    });
  }
  bind();
})();
