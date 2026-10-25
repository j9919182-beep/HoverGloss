(function () {
  "use strict";
  const api = HoverGlossReportComparison;
  const elements = Object.fromEntries(["before", "after", "beforeName", "afterName", "status", "filter",
    "exportComparison", "summary", "warnings", "results"].map((id) => [id, document.getElementById(id)]));
  const reports = { before: null, after: null }, generation = { before: 0, after: 0 };
  let comparison = null;
  const names = { improved: "人工复核改善", regressed: "人工复核退步", mixed: "有改善也有退步",
    unchanged: "已复核维度未变", pending: "待确认", error: "运行失败" };
  const dimensions = { word: "单词义", sentence: "句意", phrase: "短语" };
  const judgments = { correct: "正确", wrong: "有误", unsure: "不确定", "phrase-only": "只能按短语理解" };
  function node(tag, text, parent) {
    const item = document.createElement(tag); if (text) item.textContent = text; parent?.appendChild(item); return item;
  }
  function render() {
    elements.results.replaceChildren();
    if (!comparison) { elements.summary.textContent = ""; elements.warnings.textContent = ""; return; }
    const c = comparison.counts;
    elements.summary.textContent = comparison.beforeVersion + " → " + comparison.afterVersion +
      " · 共同例句 " + comparison.matched + " · 改善 " + c.improved + " · 退步 " + c.regressed +
      " · 混合变化 " + c.mixed + " · 待确认 " + c.pending + " · 仅较早报告 " + comparison.onlyOld + " · 仅较新报告 " + comparison.onlyNew;
    elements.warnings.textContent = comparison.warnings.join(" ");
    for (const row of comparison.rows) {
      if (elements.filter.value && elements.filter.value !== row.category) continue;
      const card = node("details", "", elements.results); card.className = "case";
      node("summary", row.after.target + " · " + names[row.category], card);
      node("p", row.after.context, card).className = "english";
      const table = node("table", "", card); table.className = "comparison-table";
      const header = node("tr", "", node("thead", "", table));
      for (const label of ["项目", "较早报告", "较新报告"]) node("th", label, header);
      const body = node("tbody", "", table);
      const pair = (label, old, next) => { const tr = node("tr", "", body);
        for (const value of [label, old || "—", next || "—"]) node("td", value, tr); };
      pair("单词结果", row.before.result.translation, row.after.result.translation);
      const phraseText = (result) => result.phrase || result.phraseTranslation
        ? (result.phrase || "未定位") + " → " + (result.phraseTranslation || "未确认") : "";
      pair("短语", phraseText(row.before.result), phraseText(row.after.result));
      pair("整句", row.before.result.sentenceTranslation, row.after.result.sentenceTranslation);
      for (const dimension of ["word", "sentence", "phrase"]) pair(dimensions[dimension] + "人工判断",
        judgments[row.before.review[dimension]] || "未复核", judgments[row.after.review[dimension]] || "未复核");
      if (row.before.error || row.after.error) pair("运行错误", row.before.error, row.after.error);
      node("p", "仍待确认：" + (row.pending.map((name) => dimensions[name]).join("、") || "无"), card).className = "hint";
    }
  }
  function refresh() {
    comparison = null; elements.exportComparison.disabled = true;
    if (reports.before && reports.after) {
      comparison = api.compare(reports.before, reports.after);
      elements.exportComparison.disabled = false;
      elements.status.textContent = "对比已生成。";
    }
    render();
  }
  for (const side of ["before", "after"]) {
    elements[side].addEventListener("change", async () => {
      const ticket = ++generation[side];
      reports[side] = null; elements[side + "Name"].textContent = ""; refresh();
      const file = elements[side].files?.[0]; if (!file) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error("报告请控制在 2 MB 以内。");
        const report = api.validate(JSON.parse(await file.text()));
        if (ticket !== generation[side]) return;
        reports[side] = report;
        elements[side + "Name"].textContent = file.name + " · v" + report.extensionVersion + " · " + report.records.length + " 条";
        refresh();
      } catch (error) {
        if (ticket !== generation[side]) return;
        elements.status.textContent = "无法读取报告：" + error.message; refresh();
      }
    });
  }
  elements.filter.addEventListener("change", render);
  elements.exportComparison.addEventListener("click", () => {
    if (!comparison) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(comparison, null, 2)], { type: "application/json" }));
    const link = node("a"); link.href = url; link.download = "HoverGloss-comparison-" + Date.now() + ".json";
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
