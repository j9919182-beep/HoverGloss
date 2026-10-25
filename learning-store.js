(function (root) {
  "use strict";
  const KEY = "hoverglossLearningV1";
  const keyFor = (language) => language === "fr" ? "hoverglossFrenchLearningV1" : KEY;
  const DAY = 86400000;
  let queue = Promise.resolve();
  const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
  function safeUrl(value) {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) return "";
      url.username = "";
      url.password = "";
      return url.href.slice(0, 2000);
    } catch { return ""; }
  }
  function capture(raw = {}) {
    const term = clean(raw.term, 100);
    const meaning = clean(raw.meaning, 500);
    if (!term || !meaning) throw new Error("缺少单词或释义，暂时无法加入学习库。");
    const origin = raw.origin || {};
    const phrases = phrasePairs(raw);
    return {
      term, meaning, language: raw.language === "fr" ? "fr" : "en", meaningLabel: clean(raw.meaningLabel, 50), uncertain: Boolean(raw.uncertain),
      context: clean(raw.context, 3000), sentenceTranslation: clean(raw.sentenceTranslation, 3000),
      phrase: phrases[0]?.phrase || "", phraseTranslation: phrases[0]?.phraseTranslation || "", phrases,
      commonMeaning: clean(raw.commonMeaning, 500), pos: clean(raw.pos, 50), topic: clean(raw.topic, 200),
      translationSource: clean(raw.translationSource, 100),
      origin: {
        type: origin.type === "pdf" ? "pdf" : "web",
        title: clean(origin.title, 300) || "未命名来源", url: safeUrl(origin.url),
        fingerprint: clean(origin.fingerprint, 128),
        page: Number.isInteger(origin.page) && origin.page > 0 ? origin.page : null
      }
    };
  }
  function phrasePairs(entry) {
    const pairs = [], seen = new Set();
    for (const pair of [{ phrase: entry.phrase, phraseTranslation: entry.phraseTranslation },
      ...(Array.isArray(entry.phrases) ? entry.phrases.slice(0, 40) : [])]) {
      const phrase = clean(pair?.phrase, 200), phraseTranslation = clean(pair?.phraseTranslation, 500);
      const key = phrase.toLowerCase() + "\u0000" + phraseTranslation;
      if (!phrase || !phraseTranslation || phrase.toLowerCase() === clean(entry.term, 100).toLowerCase() || seen.has(key)) continue;
      seen.add(key); pairs.push({ phrase, phraseTranslation });
      if (pairs.length === 20) break;
    }
    return pairs;
  }
  function identity(entry) {
    const origin = entry.origin;
    return JSON.stringify([entry.term.toLowerCase(), entry.context, origin.type,
      origin.fingerprint || origin.url || origin.title, origin.page]);
  }
  async function read(language = "en") {
    const key = keyFor(language);
    const stored = (await chrome.storage.local.get(key))[key];
    if (!stored) return [];
    if (stored.version !== 1 || !Array.isArray(stored.entries)) throw new Error("学习库格式异常，请先导出或备份浏览器数据。");
    return stored.entries;
  }
  function update(action, language = "en") {
    const task = queue.then(async () => {
      const entries = await read(language);
      const result = action(entries);
      const record = { version: 1, entries };
      if (new TextEncoder().encode(JSON.stringify(record)).length > 6 * 1024 * 1024) {
        throw new Error("学习库已达到本地容量上限，请导出并整理部分记录后重试。");
      }
      await chrome.storage.local.set({ [keyFor(language)]: record });
      return result;
    });
    queue = task.catch(() => {});
    return task;
  }
  async function list(language = "en") { await queue; return read(language); }
  function save(raw) {
    const captured = capture(raw);
    return update((entries) => {
      const existing = entries.find((entry) => identity(entry) === identity(captured));
      if (existing) {
        const previous = phrasePairs(existing);
        const additions = captured.phrases.filter((pair) => !previous.some((old) =>
          old.phrase.toLowerCase() === pair.phrase.toLowerCase() && old.phraseTranslation === pair.phraseTranslation));
        if (previous.length + additions.length > 20) throw new Error("当前语境最多关联 20 个短语，请先整理后再添加。");
        const merged = phrasePairs({ ...existing,
          phrases: [...previous, ...captured.phrases] });
        const updated = merged.length > previous.length;
        if (updated) {
          existing.phrases = merged;
          existing.phrase = merged[0].phrase; existing.phraseTranslation = merged[0].phraseTranslation;
          existing.updatedAt = Date.now();
        }
        return { entry: existing, duplicate: true, updated };
      }
      if (entries.length >= 1000) throw new Error("学习库最多保存 1000 条语境记录，请先导出并整理。");
      const now = Date.now();
      const entry = { ...captured, id: crypto.randomUUID(), notes: "", createdAt: now,
        updatedAt: now, dueAt: now, stage: 0, reviews: 0, lastReviewedAt: null };
      entries.push(entry);
      return { entry, duplicate: false };
    }, captured.language);
  }
  function edit(id, patch = {}, language = "en") {
    return update((entries) => {
      const entry = entries.find((item) => item.id === id);
      if (!entry) throw new Error("记录已不存在，请刷新学习库。");
      const meaning = clean(patch.meaning, 500);
      if (!meaning) throw new Error("释义不能为空。");
      entry.meaning = meaning;
      entry.notes = clean(patch.notes, 2000);
      if (patch.confirmed === true) { entry.uncertain = false; entry.meaningLabel = "手动确认的释义"; }
      entry.updatedAt = Date.now();
      return { entry };
    }, language);
  }
  function review(id, rating, language = "en") {
    if (!["again", "remember"].includes(rating)) throw new Error("无效的复习选项。");
    return update((entries) => {
      const entry = entries.find((item) => item.id === id);
      if (!entry) throw new Error("记录已不存在，请刷新学习库。");
      const now = Date.now();
      entry.stage = rating === "again" ? 0 : Math.min(5, (entry.stage || 0) + 1);
      entry.dueAt = now + (rating === "again" ? 10 * 60000 : [0, 1, 3, 7, 14, 30][entry.stage] * DAY);
      entry.reviews = (entry.reviews || 0) + 1;
      entry.lastReviewedAt = now;
      entry.updatedAt = now;
      return { entry };
    }, language);
  }
  function remove(id, language = "en") {
    return update((entries) => {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index >= 0) entries.splice(index, 1);
      return { deleted: index >= 0 };
    }, language);
  }
  function saveGrammar(id, context, analysis, model) {
    const validated = root.HoverGlossFrenchGrammar.validate(analysis, context);
    return update((entries) => {
      const entry = entries.find((item) => item.id === id);
      if (!entry || entry.context !== context) throw new Error("原记录已删除或语境已改变，解析未保存。");
      entry.grammar = { version: 1, context, analysis: validated, source: "ai", model: clean(model, 100), createdAt: Date.now() };
      return { entry };
    }, "fr");
  }
  function importRecords(document, language) {
    if (!document || document.app !== "HoverGloss" || document.version !== 1 || !Array.isArray(document.entries)) throw new Error("请选择 HoverGloss 导出的学习库 JSON 文件。");
    const sourceLanguage = document.language === undefined ? "en" : document.language;
    if (!["en", "fr"].includes(sourceLanguage) || sourceLanguage !== language) throw new Error("文件语言与当前学习库不一致，请先切换到对应语言库。");
    if (document.entries.length > 1000) throw new Error("单个导入文件最多 1000 条记录。");
    const timestamp = (value, fallback) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? value : fallback;
    const now = Date.now();
    return document.entries.map((raw, index) => {
      if (!raw || typeof raw !== "object" || raw.language && raw.language !== sourceLanguage) throw new Error(`第 ${index + 1} 条记录语言或格式异常。`);
      const entry = capture({ ...raw, language: sourceLanguage });
      if (typeof raw.term !== "string" || raw.term.length > 100 || typeof raw.meaning !== "string" || raw.meaning.length > 500 ||
          typeof raw.context !== "string" || raw.context.length > 3000 || typeof raw.notes === "string" && raw.notes.length > 2000) throw new Error(`第 ${index + 1} 条记录字段超出支持范围。`);
      Object.assign(entry, {
        notes: clean(raw.notes, 2000), createdAt: timestamp(raw.createdAt, now), updatedAt: timestamp(raw.updatedAt, now),
        dueAt: timestamp(raw.dueAt, now), stage: Number.isInteger(raw.stage) && raw.stage >= 0 && raw.stage <= 5 ? raw.stage : 0,
        reviews: Number.isSafeInteger(raw.reviews) && raw.reviews >= 0 ? raw.reviews : 0, lastReviewedAt: timestamp(raw.lastReviewedAt, null)
      });
      if (sourceLanguage === "fr" && raw.grammar?.version === 1 && raw.grammar.context === entry.context && root.HoverGlossFrenchGrammar?.validate) {
        entry.grammar = { version: 1, context: entry.context, analysis: root.HoverGlossFrenchGrammar.validate(raw.grammar.analysis, entry.context),
          source: "ai", model: clean(raw.grammar.model, 100), createdAt: timestamp(raw.grammar.createdAt, now) };
      }
      return entry;
    });
  }
  function mergeImport(entries, imported, commit) {
    const byIdentity = new Map(entries.map((entry) => [identity(entry), entry]));
    let added = 0, duplicates = 0, supplemented = 0;
    for (const candidate of imported) {
      const key = identity(candidate), existing = byIdentity.get(key);
      if (existing) {
        duplicates++;
        const previous = phrasePairs(existing), merged = [...previous];
        for (const pair of candidate.phrases) if (!merged.some((old) => old.phrase.toLowerCase() === pair.phrase.toLowerCase() && old.phraseTranslation === pair.phraseTranslation)) merged.push(pair);
        if (merged.length > 20) throw new Error(`“${candidate.term}”合并后超过 20 个关联短语，请先整理文件。`);
        if (merged.length > previous.length) {
          supplemented++; existing.phrases = merged; existing.phrase = merged[0].phrase;
          existing.phraseTranslation = merged[0].phraseTranslation;
        }
      } else {
        if (entries.length >= 1000) throw new Error("合并后超过 1000 条记录，请先整理学习库。");
        const entry = { ...candidate, id: commit ? crypto.randomUUID() : `preview-${added}` };
        entries.push(entry); byIdentity.set(key, entry); added++;
      }
    }
    if (new TextEncoder().encode(JSON.stringify({ version: 1, entries })).length > 6 * 1024 * 1024) throw new Error("合并后超过学习库容量上限，请先整理记录。");
    return { added, duplicates, supplemented, total: entries.length };
  }
  async function previewImport(document, language = "en") {
    const imported = importRecords(document, language);
    const entries = JSON.parse(JSON.stringify(await list(language)));
    return { ...mergeImport(entries, imported, false), language,
      sample: imported.slice(0, 6).map(({ term, meaning }) => ({ term, meaning })) };
  }
  async function importLibrary(document, language = "en") {
    const imported = importRecords(document, language);
    return update((entries) => mergeImport(entries, imported, true), language);
  }
  root.HoverGlossLearningStore = { list, save, edit, review, remove, saveGrammar, previewImport, importLibrary };
})(globalThis);
