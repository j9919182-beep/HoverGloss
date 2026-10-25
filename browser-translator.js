(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossBrowserTranslator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const OPTIONS = Object.freeze({ sourceLanguage: "en", targetLanguage: "zh" });
  const cache = new Map();
  const textCache = new Map();
  const pendingTexts = new Map();
  const MAX_CACHE = 500;
  const sessions = new Map();
  const language = (value) => value === "fr" ? "fr" : "en";
  const optionsFor = (value) => ({ sourceLanguage: language(value), targetLanguage: "zh" });

  function translatorApi(provided) {
    const api = provided || globalThis.Translator;
    if (!api || typeof api.create !== "function" || typeof api.availability !== "function") {
      throw new Error("当前浏览器不支持本机翻译；请更新到 Chrome 138+ 或 Edge 148+，也可以在设置中使用自备 AI 接口");
    }
    return api;
  }

  async function availability(provided, sourceLanguage = "en") {
    const api = translatorApi(provided);
    return api.availability(optionsFor(sourceLanguage));
  }

  function create(provided, onProgress, sourceLanguage = "en") {
    const api = translatorApi(provided);
    return api.create({
      ...optionsFor(sourceLanguage),
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const loaded = Number(event.loaded);
          if (typeof onProgress === "function" && Number.isFinite(loaded)) onProgress(Math.max(0, Math.min(1, loaded)));
        });
      }
    });
  }

  async function prepare(onProgress, provided, sourceLanguage = "en") {
    // create() must be started directly from the user's click when a language pack needs downloading.
    const sessionPromise = create(provided, onProgress, sourceLanguage);
    const session = await sessionPromise;
    const sample = await session.translate(sourceLanguage === "fr" ? "Bonjour" : "Hello");
    if (typeof session.destroy === "function") session.destroy();
    return String(sample || "").trim();
  }

  async function getSession(provided, sourceLanguage = "en") {
    if (sessions.has(sourceLanguage)) return sessions.get(sourceLanguage);
    const api = translatorApi(provided);
    const state = await api.availability(optionsFor(sourceLanguage));
    if (["unavailable", "no"].includes(state)) throw new Error(`本机${sourceLanguage === "fr" ? "法中" : "英中"}翻译模型在当前设备上不可用，请在设置中使用自备 AI 接口`);
    // Chrome may deliberately report "downloadable" in a new page context even when the
    // language pack is already present. create() is the authoritative check in that case.
    const operation = create(api, undefined, sourceLanguage).catch((error) => {
      sessions.delete(sourceLanguage);
      if (["downloadable", "downloading", "after-download"].includes(state)) {
        throw new Error("本机翻译器未能在当前页面启动，请返回 HoverGloss 设置测试本机翻译后重试");
      }
      throw error;
    });
    sessions.set(sourceLanguage, operation);
    return operation;
  }

  async function activate(onProgress, provided, sourceLanguage = "en") {
    if (sessions.has(sourceLanguage)) {
      const session = await sessions.get(sourceLanguage);
      return String(await session.translate(sourceLanguage === "fr" ? "Bonjour" : "Hello")).trim();
    }
    const operation = create(provided, onProgress, sourceLanguage);
    sessions.set(sourceLanguage, operation);
    try {
      const session = await operation;
      return String(await session.translate(sourceLanguage === "fr" ? "Bonjour" : "Hello")).trim();
    } catch (error) {
      if (sessions.get(sourceLanguage) === operation) sessions.delete(sourceLanguage);
      throw error;
    }
  }

  function translateText(session, text, sourceLanguage) {
    const key = JSON.stringify([sourceLanguage, text]);
    if (textCache.has(key)) return Promise.resolve(textCache.get(key));
    if (pendingTexts.has(key)) return pendingTexts.get(key);
    const operation = Promise.resolve().then(() => session.translate(text)).then((value) => {
      const translated = String(value || "").trim();
      if (!translated || translated.toLowerCase() === text.toLowerCase()) throw new Error("本机翻译暂未找到合适译文");
      if (pendingTexts.get(key) === operation) {
        if (textCache.size >= MAX_CACHE) textCache.delete(textCache.keys().next().value);
        textCache.set(key, translated);
      }
      return translated;
    }).finally(() => { if (pendingTexts.get(key) === operation) pendingTexts.delete(key); });
    pendingTexts.set(key, operation);
    return operation;
  }

  function cachePut(key, value) {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, value);
  }

  async function translate(payload = {}, provided) {
    const target = String(payload.target || "").trim();
    const context = String(payload.context || "").replace(/\s+/g, " ").trim();
    const kind = payload.kind === "passage" ? "passage" : payload.kind === "sentence" ? "sentence" : "word";
    const sourceLanguage = language(payload.sourceLanguage);
    const key = JSON.stringify([sourceLanguage, kind, target, context]);
    if (cache.has(key)) return cache.get(key);
    const session = await getSession(provided, sourceLanguage);
    const translation = await translateText(session, target, sourceLanguage);
    if (!translation || translation.toLowerCase() === target.toLowerCase()) throw new Error("本机翻译暂未找到合适译文");

    let sentenceTranslation = "";
    if (kind === "word" && context && context.toLowerCase() !== target.toLowerCase()) {
      sentenceTranslation = (await translateText(session, context, sourceLanguage)).replace(/\s+/g, " ").trim();
    }
    const result = {
      translation,
      sourceLanguage,
      isolatedTranslation: kind === "word" ? translation : "",
      pos: "",
      source: "browser",
      phrase: target,
      sentenceTranslation,
      confidence: null
    };
    cachePut(key, result);
    return result;
  }

  function reset() {
    sessions.clear();
    cache.clear();
    textCache.clear();
    pendingTexts.clear();
  }

  return { OPTIONS, availability, prepare, activate, translate, reset };
});
