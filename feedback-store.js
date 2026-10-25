(function (root) {
  "use strict";
  const KEY = "hoverglossFeedbackV1";
  let queue = Promise.resolve();
  const text = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
  function capture(raw = {}) {
    if (!["word", "phrase", "context", "sentence", "other"].includes(raw.issue)) throw new Error("请选择问题类型。");
    const target = text(raw.target, 100).trim(), context = text(raw.context, 4000);
    if (!target || !context) throw new Error("缺少目标词或原句，无法记录。");
    const start = raw.targetStart, end = raw.targetEnd;
    const located = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= context.length &&
      context.slice(start, end).toLowerCase() === target.toLowerCase();
    const result = {};
    for (const key of ["translation", "displayedWordMeaning", "displayedWordLabel", "isolatedTranslation",
      "sentenceTranslation", "phrase", "phraseTranslation", "source", "contextReview"]) {
      result[key] = text(raw.result?.[key], key === "sentenceTranslation" ? 4000 : 500);
    }
    if (Number.isFinite(raw.result?.confidence)) result.confidence = raw.result.confidence;
    let url = "";
    try {
      const source = new URL(raw.origin?.url);
      if (/^https?:$/.test(source.protocol)) { source.username = ""; source.password = ""; url = source.href.slice(0, 2000); }
    } catch {}
    return { target, context, targetStart: located ? start : null, targetEnd: located ? end : null,
      topic: text(raw.topic, 200), issue: raw.issue, correction: text(raw.correction, 1000).trim(), result,
      origin: { type: raw.origin?.type === "pdf" ? "pdf" : "web", title: text(raw.origin?.title, 300),
        url, fingerprint: text(raw.origin?.fingerprint, 128),
        page: Number.isInteger(raw.origin?.page) && raw.origin.page > 0 ? raw.origin.page : null } };
  }
  async function read() {
    const record = (await chrome.storage.local.get(KEY))[KEY];
    if (!record) return [];
    if (record.version !== 1 || !Array.isArray(record.entries)) throw new Error("问题记录格式异常，请先备份。");
    return record.entries;
  }
  function update(action) {
    const task = queue.then(async () => {
      const entries = await read();
      const response = action(entries);
      const stored = { version: 1, entries };
      if (new TextEncoder().encode(JSON.stringify(stored)).length > 2 * 1024 * 1024) throw new Error("问题记录已达到容量上限，请导出并整理。");
      await chrome.storage.local.set({ [KEY]: stored });
      return response;
    });
    queue = task.catch(() => {});
    return task;
  }
  function save(raw) {
    const captured = capture(raw);
    return update((entries) => {
      const existing = entries.find((entry) => JSON.stringify({ ...entry, id: undefined, createdAt: undefined, extensionVersion: undefined }) === JSON.stringify(captured));
      if (existing) return { entry: existing, duplicate: true };
      if (entries.length >= 200) throw new Error("最多保存 200 条问题记录，请先导出并整理。");
      const entry = { ...captured, id: crypto.randomUUID(), createdAt: Date.now(),
        extensionVersion: chrome.runtime.getManifest().version };
      entries.push(entry);
      return { entry, duplicate: false };
    });
  }
  async function list() { await queue; return read(); }
  function remove(id) { return update((entries) => {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error("记录已不存在，请刷新。");
    entries.splice(index, 1); return { deleted: true };
  }); }
  root.HoverGlossFeedbackStore = { capture, save, list, remove };
  if (typeof module === "object" && module.exports) module.exports = root.HoverGlossFeedbackStore;
})(globalThis);
