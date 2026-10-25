(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossReportComparison = api;
})(globalThis, function () {
  "use strict";
  const text = (value, max = 4000) => typeof value === "string" ? value.slice(0, max) : "";
  const key = (record) => JSON.stringify([record.context, record.target, record.targetStart, record.targetEnd, record.topic]);
  function validate(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.records) || raw.records.length > 1000 ||
      typeof raw.datasetVersion !== "string" || !raw.datasetVersion ||
      typeof raw.extensionVersion !== "string" || !raw.extensionVersion) throw new Error("请选择 HoverGloss 导出的质量检查报告。");
    const seen = new Set();
    const records = raw.records.map((record) => {
      if (!record || typeof record.context !== "string" || record.context.length > 4000 || typeof record.target !== "string" ||
        !record.target || record.target.length > 100 || !Number.isInteger(record.targetStart) || !Number.isInteger(record.targetEnd) ||
        record.targetStart < 0 || record.targetEnd <= record.targetStart ||
        record.targetEnd > record.context.length || record.targetEnd - record.targetStart !== record.target.length ||
        record.context.slice(record.targetStart, record.targetEnd).toLowerCase() !== record.target.toLowerCase()) {
        throw new Error("报告包含无效的原句或目标词位置。");
      }
      if (!record.error && (!record.result || typeof record.result.translation !== "string")) throw new Error("报告缺少翻译结果。");
      if (record.error !== undefined && typeof record.error !== "string") throw new Error("运行错误字段格式无效。");
      const review = {};
      for (const name of ["word", "sentence", "phrase"]) {
        const value = record.review?.[name] || "";
        if (!["", "correct", "wrong", "unsure", "phrase-only"].includes(value)) throw new Error("人工复核字段格式无效。");
        review[name] = value;
      }
      review.note = text(record.review?.note, 2000);
      const result = {};
      for (const name of ["translation", "sentenceTranslation", "phrase", "phraseTranslation", "contextReview", "source"]) result[name] = text(record.result?.[name]);
      const cleaned = { id: text(record.id, 200), group: text(record.group, 200), topic: text(record.topic, 200),
        context: record.context, target: record.target, targetStart: record.targetStart, targetEnd: record.targetEnd,
        result, review, error: text(record.error, 1000), alignmentEnabled: Boolean(record.alignmentEnabled) };
      const identity = key(cleaned);
      if (seen.has(identity)) throw new Error("同一目标位置出现重复记录，无法可靠比较。");
      seen.add(identity); return cleaned;
    });
    return { datasetVersion: text(raw.datasetVersion, 100), extensionVersion: text(raw.extensionVersion, 100),
      browser: text(raw.browser, 500), model: text(raw.model, 100), candidateScope: text(raw.candidateScope, 100), records };
  }
  function compare(oldReport, newReport) {
    const old = validate(oldReport), next = validate(newReport);
    const before = new Map(old.records.map((record) => [key(record), record]));
    const rows = [];
    let onlyNew = 0;
    for (const record of next.records) {
      const previous = before.get(key(record));
      if (!previous) { onlyNew += 1; continue; }
      before.delete(key(record));
      const improvements = [], regressions = [], reviewed = [], pending = [];
      for (const dimension of ["word", "sentence", "phrase"]) {
        const left = previous.review[dimension], right = record.review[dimension];
        if (["correct", "wrong"].includes(left) && ["correct", "wrong"].includes(right)) {
          reviewed.push(dimension);
          if (left === "wrong" && right === "correct") improvements.push(dimension);
          if (left === "correct" && right === "wrong") regressions.push(dimension);
        } else pending.push(dimension);
      }
      const category = previous.error || record.error ? "error" : improvements.length && regressions.length ? "mixed"
        : improvements.length ? "improved" : regressions.length ? "regressed" : reviewed.length ? "unchanged" : "pending";
      rows.push({ category, improvements, regressions, reviewed, pending, before: previous, after: record });
    }
    const counts = Object.fromEntries(["improved", "regressed", "mixed", "unchanged", "pending", "error"]
      .map((category) => [category, rows.filter((row) => row.category === category).length]));
    const warnings = [];
    if (old.datasetVersion !== next.datasetVersion) warnings.push("数据集版本不同，仅比较原句、目标位置和主题一致的记录。");
    if (old.browser !== next.browser || old.model !== next.model || old.candidateScope !== next.candidateScope) {
      warnings.push("浏览器、模型或候选词库条件不同，变化不能全部归因于扩展版本。");
    }
    if (rows.some((row) => row.before.alignmentEnabled !== row.after.alignmentEnabled)) warnings.push("部分记录的本机对齐开关不同。");
    return { beforeVersion: old.extensionVersion, afterVersion: next.extensionVersion, counts, warnings,
      matched: rows.length, onlyOld: before.size, onlyNew, rows };
  }
  return { validate, compare };
});
