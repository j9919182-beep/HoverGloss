(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossSearchTranslator = api;
})(globalThis, function () {
  "use strict";
  const OPTIONS = Object.freeze({ sourceLanguage: "zh", targetLanguage: "en" });
  const hasChinese = (text) => /\p{Script=Han}/u.test(text);
  function createClient(provided) {
    let session = null;
    let preparing = null;
    const cache = new Map();
    function prepare(onProgress) {
      if (session) return Promise.resolve();
      if (preparing) return preparing;
      const api = provided || globalThis.Translator;
      if (!api?.create) return Promise.reject(new Error("当前页面无法使用浏览器本机中译英，请更新浏览器后重试。"));
      // Call create directly in the button's user activation, before any await.
      try {
        preparing = Promise.resolve(api.create({ ...OPTIONS, monitor(m) {
          m.addEventListener("downloadprogress", (event) => {
            if (typeof onProgress === "function") onProgress(Math.max(0, Math.min(1, Number(event.loaded) || 0)));
          });
        } })).then((value) => { session = value; }).finally(() => { preparing = null; });
      } catch (error) { return Promise.reject(error); }
      return preparing;
    }
    async function translate(value) {
      const text = String(value || "").trim();
      if (!text || text.length > 300 || !hasChinese(text)) throw new Error("请输入不超过 300 字的中文搜索词，可混合英文。");
      if (cache.has(text)) return cache.get(text);
      if (!session) throw new Error("请先点击“准备中译英”。");
      const output = await session.translate(text);
      const translated = typeof output === "string" ? output.replace(/\s+/g, " ").trim() : "";
      if (!translated || translated.length > 1000 || hasChinese(translated) || !/[A-Za-z]/.test(translated)) {
        throw new Error("未得到完整英文候选，已保留原文；可修改搜索词后重试。");
      }
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(text, translated);
      return translated;
    }
    return { prepare, translate, get ready() { return Boolean(session); } };
  }
  return { OPTIONS, hasChinese, createClient };
});
