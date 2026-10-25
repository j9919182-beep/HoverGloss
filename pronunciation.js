(function (root) {
  "use strict";
  let current = null;
  const preferenceKey = "allowOnlinePronunciation";
  let allowOnline = false, settingsLoaded = true, settingsPromise = Promise.resolve(), preferenceRevision = 0;
  function applyPreference(value) {
    const revoked = allowOnline && value !== true;
    allowOnline = value === true;
    if (revoked && current && (!current.started || current.source === "online")) stop();
  }
  async function getSettings() { await settingsPromise; return { allowOnline }; }
  async function setAllowOnline(value) {
    if (typeof value !== "boolean") throw new Error("发音设置无效。");
    await settingsPromise;
    if (!root.chrome?.storage?.local?.set) throw new Error("无法保存发音设置，请在扩展的学习库中操作。");
    const revision = preferenceRevision;
    await root.chrome.storage.local.set({ [preferenceKey]: value });
    if (revision === preferenceRevision) applyPreference(value);
  }
  const isLanguage = (voice, language = "en") => new RegExp(`^${language === "fr" ? "fr" : "en"}(?:[-_]|$)`, "i").test(voice.lang);
  const isMicrosoftOnline = (voice) => voice.localService === false && /^Microsoft\b/i.test(voice.name || "") && /\bOnline\b/i.test(voice.name || "");
  function inspect(options = {}) {
    const report = inspectLanguage(options);
    if (options.language === "fr") report.message = report.message.replace(/英文/g, "法语").replace(/英语/g, "法语");
    return report;
  }
  function inspectLanguage(options = {}) {
    const engine = root.speechSynthesis;
    if (!engine || typeof root.SpeechSynthesisUtterance !== "function") {
      return { status: "unsupported", voices: [], message: "当前环境不支持英文发音，请在 Edge / Chrome 中重试。" };
    }
    let voices;
    try { voices = [...engine.getVoices()]; }
    catch { return { status: "error", voices: [], message: "浏览器读取语音列表失败，请在学习库中重新检测。" }; }
    const candidates = options.kind === "sentence" ? voices.filter((item) => item.localService === true || isMicrosoftOnline(item)) : voices;
    const voice = chooseVoice(candidates, allowOnline, options.language);
    if (voice) {
      const source = voice.localService === true ? "local" : "online";
      const label = source === "local" ? "本机" : "在线";
      return { status: "ready", voices, voice, source, message: `浏览器已提供${label}英文语音：${voice.name || voice.lang}。` +
        (source === "online" ? "已允许在线发音；仅点击才将所选单词、短语或原句交给远程语音服务。" : "请点击发音测试。") };
    }
    const english = voices.filter((voice) => isLanguage(voice, options.language));
    let status, message;
    if (options.kind === "sentence" && allowOnline && english.some((item) => item.localService === false) && !english.some(isMicrosoftOnline)) {
      status = "unsupported-provider"; message = "原句在线朗读仅使用浏览器提供的 Microsoft 在线英文声音；当前未找到，不会转发给其他服务。";
    }
    else if (!voices.length) { status = "empty"; message = "浏览器尚未返回任何语音，不能据此判断系统没有安装英文语音。"; }
    else if (!english.length) { status = "no-english"; message = "浏览器返回的语音列表中没有英文声音；系统中已安装的桌面语音不一定能被浏览器读取。"; }
    else if (english.every((item) => item.localService === false)) { status = "remote-only"; message = "浏览器只提供在线英文语音，没有可用的本机英文语音。可在学习库手动开启“允许在线发音”；未开启时不会使用。"; }
    else { status = "unverified"; message = "浏览器返回了英文语音，但未确认它是本机服务；为避免联网，不会使用该声音。"; }
    return { status, voices, message: message + " 可展开学习库的“发音检测”查看详情。" };
  }
  // Poll as well as listening: some browsers populate voices without an event.
  // Detection never plays a silent utterance or selects an unverified voice.
  function waitForVoices(onResult, options = {}) {
    const engine = root.speechSynthesis;
    let deadline, poll, finished = false;
    function cleanup() {
      finished = true; clearTimeout(deadline); clearTimeout(poll);
      engine?.removeEventListener?.("voiceschanged", check);
    }
    function finish(report) { cleanup(); onResult(report); }
    function check() {
      if (finished) return;
      const report = inspect(options);
      if (["ready", "unsupported", "error"].includes(report.status)) finish(report);
    }
    function tick() { check(); if (!finished) poll = setTimeout(tick, 250); }
    engine?.addEventListener?.("voiceschanged", check);
    deadline = setTimeout(() => { if (!finished) finish(inspect(options)); }, 5000);
    tick();
    return cleanup;
  }
  function detect(options = {}) {
    if (!settingsLoaded) return settingsPromise.then(() => detect(options));
    return new Promise((resolve) => { waitForVoices(resolve, options); });
  }
  function chooseVoice(voices, onlineAllowed = false, language = "en") {
    const preferred = language === "fr" ? /^fr-FR$/i : /^en-US$/i;
    return [...voices].filter((voice) => isLanguage(voice, language) &&
      (voice.localService === true || (onlineAllowed === true && voice.localService === false)))
      .sort((a, b) => Number(b.localService === true) - Number(a.localService === true) ||
        Number(b.default) - Number(a.default) ||
        Number(preferred.test(b.lang)) - Number(preferred.test(a.lang)))[0];
  }
  function stop() {
    if (!current) return;
    const task = current; current = null;
    task.finish({ cancelled: true });
    if (task.started) root.speechSynthesis?.cancel();
  }
  function splitSentence(text) {
    const chunks = [];
    while (text.length > 180) {
      const prefix = text.slice(0, 180);
      let cut = Math.max(prefix.lastIndexOf(" "), prefix.lastIndexOf("\n"), prefix.lastIndexOf("\t")) + 1;
      if (cut < 80) cut = 180;
      if (/[\uD800-\uDBFF]/.test(text[cut - 1])) cut--;
      chunks.push(text.slice(0, cut)); text = text.slice(cut);
    }
    if (text) chunks.push(text);
    return chunks;
  }
  function speak(value, options = {}) {
    const languageName = options.language === "fr" ? "法语" : "英文";
    const text = typeof value === "string" ? value.trim() : "";
    const sentence = options.kind === "sentence";
    if (!text || text.length > (sentence ? 3000 : 200) || !/[\p{Script=Latin}]/u.test(text)) {
      return Promise.reject(new Error(sentence ? `请提供不超过 3000 字符、包含${languageName}的记录原句。` : `请提供不超过 200 字的${languageName}单词或短语。`));
    }
    const chunks = sentence ? splitSentence(text) : [text];
    const engine = root.speechSynthesis;
    if (!engine || typeof root.SpeechSynthesisUtterance !== "function") return Promise.reject(new Error(`当前环境不支持${languageName}发音，请在 Edge / Chrome 中重试。`));
    stop();
    if (engine.speaking) return Promise.reject(new Error("当前页面正在朗读，请先停止其他朗读后再试。"));
    return new Promise((resolve, reject) => {
      let timer, finished = false, index = 0, cancelDetection = () => {};
      const task = { started: false, finish(result, error) {
        if (finished) return;
        finished = true; clearTimeout(timer);
        cancelDetection();
        task.utterance = null;
        if (current === task) current = null;
        error ? reject(error) : resolve(result);
      } };
      current = task;
      function tryStart(report) {
        if (current !== task || task.started || finished) return;
        try {
          const voice = report.voice;
          if (!voice) { task.finish(null, new Error(report.message)); return; }
          // Re-check consent immediately before playback; detection may have waited.
          if (voice.localService !== true && (!allowOnline || voice.localService !== false)) {
            task.finish(null, new Error("在线发音未获允许，请在学习库中开启后再试。")); return;
          }
          if (sentence && voice.localService === false && !isMicrosoftOnline(voice)) {
            task.finish(null, new Error("原句在线朗读不会转发给其他语音提供商。")); return;
          }
          task.source = report.source;
          const label = task.source === "online" ? "在线" : "本机";
          task.started = true;
          options.onStart?.({ source: task.source, voiceName: voice.name });
          function playChunk() {
            if (current !== task || finished) return;
            if (task.source === "online" && !allowOnline) { stop(); return; }
            try {
              const utterance = new root.SpeechSynthesisUtterance(chunks[index]);
              task.utterance = utterance;
              utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 0.9;
              const active = () => current === task && !finished && task.utterance === utterance;
              utterance.onend = () => {
                if (!active()) return;
                clearTimeout(timer); index++;
                if (index < chunks.length) playChunk();
                else task.finish({ cancelled: false, source: task.source, voiceName: voice.name });
              };
              utterance.onerror = (event) => {
                if (!active()) return;
                task.finish(null, new Error(`已找到${label}${languageName}语音，但播放失败（${event?.error || "未知错误"}）。` +
                  (task.source === "online" ? "请检查网络或稍后手动重试；不会自动切换其他服务。" : "请检查系统语音和音量。")));
              };
              const timeout = sentence ? Math.max(30000, chunks[index].trim().split(/\s+/).length * 500 + 10000) : 20000;
              timer = setTimeout(() => {
                if (!active()) return;
                task.finish(null, new Error(`${languageName}发音超时，请重试。`)); engine.cancel();
              }, timeout);
              engine.speak(utterance);
            } catch { task.finish(null, new Error(`无法播放${languageName}语音，请重新检测语音后再试。`)); }
          }
          playChunk();
        } catch { task.finish(null, new Error(`无法播放${languageName}语音，请重新检测语音后再试。`)); }
      }
      function prepare() {
        if (current !== task || finished) return;
        cancelDetection = waitForVoices(tryStart, { kind: options.kind, language: options.language });
      }
      if (settingsLoaded) prepare(); else settingsPromise.then(prepare);
    });
  }
  function createButton(text, options = {}) {
    const languageName = options.language === "fr" ? "法语" : "英文";
    const button = document.createElement("button");
    const sentence = options.kind === "sentence";
    const idleLabel = sentence ? "▶ 朗读原句" : "▶ 发音";
    let playing = false;
    button.type = "button"; button.className = options.className || "pronounce";
    button.textContent = idleLabel;
    button.title = sentence ? `朗读记录时的${languageName}原句；在线模式会发送该原句，再次点击可停止` : "本机语音优先；仅手动允许后使用在线语音，不自动播放";
    button.setAttribute("aria-label", sentence ? `朗读记录时的${languageName}原句，再次点击停止` : `播放 ${text} 的${languageName}发音`);
    if (sentence) button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", async () => {
      if (sentence && playing) { stop(); return; }
      if (button.disabled) return;
      playing = true; button.disabled = !sentence;
      button.textContent = sentence ? "■ 停止朗读" : "播放中…";
      if (sentence) button.setAttribute("aria-pressed", "true");
      try {
        const result = await speak(text, { kind: options.kind, language: options.language, onStart: (info) => {
          button.textContent = sentence ? (info.source === "online" ? "■ 停止朗读（在线）" : "■ 停止朗读") :
            (info.source === "online" ? "在线播放中…" : "播放中…");
          button.title = `${info.source === "online" ? "在线" : "本机"}语音：${info.voiceName || languageName + "声音"}`;
        } });
        button.textContent = idleLabel;
        button.title = result.cancelled ? "已停止；按当前发音设置播放" :
          `上次使用${result.source === "online" ? "在线" : "本机"}语音；再次点击按当前发音设置播放`;
      }
      catch (error) { button.textContent = sentence ? "重试原句朗读" : "重试发音"; button.title = error.message; options.onError?.(error.message); }
      finally { playing = false; button.disabled = false; if (sentence) button.setAttribute("aria-pressed", "false"); }
    });
    return button;
  }
  root.addEventListener?.("pagehide", stop);
  const storage = root.chrome?.storage;
  if (storage?.local?.get) {
    settingsLoaded = false;
    const revision = preferenceRevision;
    try {
      settingsPromise = Promise.resolve(storage.local.get({ [preferenceKey]: false }))
        .then((values) => { if (revision === preferenceRevision) applyPreference(values?.[preferenceKey]); })
        .catch(() => { if (revision === preferenceRevision) applyPreference(false); })
        .finally(() => { settingsLoaded = true; });
    } catch { settingsLoaded = true; }
    storage.onChanged?.addListener((changes, area) => {
      if (area === "local" && changes[preferenceKey]) {
        preferenceRevision++; applyPreference(changes[preferenceKey].newValue);
      }
    });
  }
  root.HoverGlossPronunciation = { speak, stop, createButton, chooseVoice, inspect, detect, getSettings, setAllowOnline };
  if (typeof module === "object" && module.exports) module.exports = root.HoverGlossPronunciation;
})(globalThis);
