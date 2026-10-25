(function () {
  "use strict";
  const dataset = HoverGlossEvaluationCases;
  const core = HoverGlossEvaluationCore;
  const byId = new Map(dataset.cases.map((item) => [item.id, item]));
  const elements = Object.fromEntries(["prepare", "alignment", "modelNote", "group", "run", "stop", "reset",
    "export", "status", "summary", "filter", "results"].map((id) => [id, document.getElementById(id)]));
  const storageKey = "accuracyEvaluationRun";
  let report = { datasetVersion: dataset.version, records: [] };
  let ready = false, running = false, stopping = false, saveQueue = Promise.resolve();
  const suggestions = { "word-match": "单词参考命中", "phrase-match": "短语参考命中", mismatch: "候选与参考不符", pending: "待确认" };
  function node(tag, text, parent, className) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (className) item.className = className;
    parent?.appendChild(item);
    return item;
  }
  for (const group of new Set(dataset.cases.map((item) => item.group))) {
    const option = node("option", group, elements.group); option.value = group;
  }
  function status(text) { elements.status.textContent = text; }
  function save() {
    const snapshot = structuredClone(report);
    saveQueue = saveQueue.catch(() => {}).then(() => chrome.storage.local.set({ [storageKey]: snapshot }));
    return saveQueue.catch(() => { status("本地保存失败，请先导出报告保留结果。"); });
  }
  function setBusy(value) {
    running = value;
    for (const name of ["prepare", "reset", "group"]) elements[name].disabled = value;
    elements.alignment.disabled = value || !report.alignmentAvailable;
    elements.run.disabled = value || !ready;
    elements.stop.disabled = !value;
  }
  function render() {
    const stats = core.summarize(report.records);
    elements.summary.textContent = "已运行 " + stats.completed + "/100 · 参考命中 " + stats.referenceMatches +
      "（非准确率） · 单词人工复核 " + stats.reviewedWords + " 条，其中确认正确 " + stats.correctWords +
      " 条 · 整句确认有误 " + stats.wrongSentences + " 条 · 运行失败 " + stats.errors + " 条";
    elements.export.disabled = report.records.length === 0;
    elements.results.replaceChildren();
    for (const record of report.records) {
      const item = byId.get(record.id);
      if (!item) continue;
      const filter = elements.filter.value;
      if (filter === "needs-review" && record.review?.word && record.review?.sentence) continue;
      if (filter === "wrong" && !["word", "sentence", "phrase"].some((key) => record.review?.[key] === "wrong")) continue;
      if (filter === "error" && !record.error) continue;
      if (["mismatch", "pending"].includes(filter) && record.assessment?.suggestion !== filter) continue;
      const card = node("details", "", elements.results, "case");
      node("summary", item.group + " · " + item.target + " · " +
        (record.error ? "运行失败" : suggestions[record.assessment?.suggestion] || "待复核"), card);
      const english = node("p", "", card, "english");
      english.append(document.createTextNode(item.context.slice(0, item.targetStart)));
      node("mark", item.context.slice(item.targetStart, item.targetEnd), english);
      english.append(document.createTextNode(item.context.slice(item.targetEnd)));
      if (record.error) { node("p", record.error, card, "error"); continue; }
      const result = record.result;
      const pair = (label, value) => {
        const row = node("div", "", card, "pair");
        node("span", label, row); node("span", value || "—", row);
      };
      pair("独立机译", record.raw?.isolatedTranslation || record.raw?.translation);
      pair("上下文结果", result.translation + (record.assessment?.phraseOnly ? "（整短语）" : ""));
      pair("短语对应", result.phraseTranslation ? result.phrase + " → " + result.phraseTranslation : "");
      pair("整句译意", result.sentenceTranslation);
      pair("复核状态", result.contextReview || (record.assessment?.confirmed ? "规则支持" : "待确认"));
      pair("处理用时", record.elapsedMs + " ms（可能含缓存）");
      pair("参考单词义", item.expected.words.join("；") || "按整短语理解，不要求拆出单独词义");
      pair("参考短语义", item.expected.phrase ? item.expected.phrase + " → " + item.expected.phraseMeanings.join("；") : "");
      node("p", "参考义项未穷尽同义表达；请结合英文原句判断，不能把文字不一致直接视为翻译错误。", card, "hint");
      const review = node("div", "", card, "review");
      const fields = [
        ["sentence", "整句翻译", [["", "未复核"], ["correct", "意思正确"], ["wrong", "意思有误"], ["unsure", "不确定"]]],
        ["word", "目标词释义", [["", "未复核"], ["correct", "单词义正确"], ["wrong", "单词义有误"], ["phrase-only", "只能按短语理解"], ["unsure", "不确定"]]],
        ["phrase", "短语识别", [["", "未复核／不适用"], ["correct", "边界与译义正确"], ["wrong", "边界或译义有误"], ["unsure", "不确定"]]],
        ["cause", "主要问题", [["", "未分类／无问题"], ["sentence", "整句翻译"], ["alignment", "单词对应"], ["phrase", "短语边界或拆义"], ["other", "其他"]]]
      ];
      for (const [key, label, choices] of fields) {
        const wrapper = node("label", label, review);
        const select = node("select", "", wrapper);
        for (const [value, text] of choices) { const option = node("option", text, select); option.value = value; }
        select.value = record.review[key] || "";
        select.addEventListener("change", () => {
          record.review[key] = select.value;
          record.review.reviewedAt = new Date().toISOString();
          save(); updateSummary();
        });
      }
      const note = node("textarea", "", review);
      note.setAttribute("aria-label", "人工复核笔记");
      note.placeholder = "正确释义或问题说明（可选）"; note.value = record.review.note || "";
      note.addEventListener("change", () => { record.review.note = note.value.slice(0, 2000); save(); });
    }
  }
  function updateSummary() {
    const stats = core.summarize(report.records);
    elements.summary.textContent = "已运行 " + stats.completed + "/100 · 参考命中 " + stats.referenceMatches +
      "（非准确率） · 单词人工复核 " + stats.reviewedWords + " 条，其中确认正确 " + stats.correctWords +
      " 条 · 整句确认有误 " + stats.wrongSentences + " 条 · 运行失败 " + stats.errors + " 条";
  }
  function timeout(promise) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("本条等待超过 60 秒，可稍后重试。")), 60000);
    })]).finally(() => clearTimeout(timer));
  }
  elements.prepare.addEventListener("click", async () => {
    setBusy(true);
    elements.stop.disabled = true;
    status("正在准备本机英中翻译…");
    try {
      await HoverGlossBrowserTranslator.activate((fraction) => status("语言包准备中：" + Math.round(fraction * 100) + "%"));
      ready = true; status("本机翻译已就绪，可按类别运行检查。");
    } catch (error) { ready = false; status("准备失败：" + error.message); }
    finally { setBusy(false); }
  });
  elements.run.addEventListener("click", async () => {
    setBusy(true); stopping = false;
    const currentVersion = chrome.runtime.getManifest().version;
    if (report.records.some((record) => !record.error) && report.extensionVersion !== currentVersion) {
      setBusy(false); status("已有结果属于其他版本；请先导出并清空，再检查新版。"); return;
    }
    const selected = dataset.cases.filter((item) => !elements.group.value || item.group === elements.group.value);
    const pending = selected.filter((item) => !report.records.some((record) => record.id === item.id && !record.error));
    const alignmentEnabled = elements.alignment.checked && report.alignmentAvailable;
    if (report.records.some((record) => !record.error && record.alignmentEnabled !== alignmentEnabled)) {
      setBusy(false); status("本次已有不同对齐设置的结果；请先导出并清空，再运行另一组设置。"); return;
    }
    report.extensionVersion = currentVersion;
    report.browser = navigator.userAgent;
    report.model = "browser-built-in-en-zh";
    report.candidateScope = "shipped-glossary-only";
    report.startedAt ||= new Date().toISOString();
    const dependencies = {
      translate: (payload) => HoverGlossBrowserTranslator.translate(payload),
      candidates: getGlossaryCandidates, refine: HoverGlossContextAligner.refine,
      applyPhrase: HoverGlossLocalAlignmentCore.applyPhraseTranslation,
      ...(alignmentEnabled ? { align: (payload) => chrome.runtime.sendMessage({ type: "alignWord", payload }) } : {})
    };
    let failures = 0;
    try {
      for (const [index, item] of pending.entries()) {
        if (stopping) break;
        status("正在检查 " + (index + 1) + "/" + pending.length + "：" + item.group + " · " + item.target);
        let record;
        try { record = await timeout(core.runCase(item, dependencies)); failures = 0; }
        catch (error) { record = { id: item.id, error: error.message || "运行失败", review: {} }; failures += 1; }
        record.alignmentEnabled = alignmentEnabled;
        record.recordedAt = new Date().toISOString();
        report.records = report.records.filter((old) => old.id !== item.id);
        report.records.push(record);
        await save(); render();
        if (failures >= 3) { stopping = true; status("连续 3 条运行失败，已停止；请检查本机翻译或模型设置。"); break; }
      }
      if (failures < 3) status(stopping ? "已停止，已有结果已保存。再次开始可继续未完成例句。" : "检查完成。请展开结果，分别复核句意、词义和短语。");
    } finally { setBusy(false); }
  });
  elements.stop.addEventListener("click", () => { stopping = true; elements.stop.disabled = true; status("当前条完成后停止并保存。"); });
  elements.reset.addEventListener("click", async () => {
    if (report.records.length && !window.confirm("清空本次评测记录？需要保留时请先导出报告。")) return;
    report = { datasetVersion: dataset.version, records: [], alignmentAvailable: report.alignmentAvailable };
    await save(); render(); status("记录已清空，可开始新的检查。");
  });
  elements.export.addEventListener("click", () => {
    const cases = report.records.map((record) => ({ ...byId.get(record.id), ...record }));
    const exported = { ...report, alignmentAvailable: undefined, records: cases,
      summary: core.summarize(report.records), exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }));
    const link = node("a"); link.href = url;
    link.download = "HoverGloss-quality-" + (report.extensionVersion || "preview") + "-" + Date.now() + ".json";
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  elements.filter.addEventListener("change", render);
  (async () => {
    elements.prepare.disabled = true; elements.reset.disabled = true;
    const saved = await chrome.storage.local.get({ [storageKey]: null, localAlignmentEnabled: false, localAlignmentPrepared: false });
    if (saved[storageKey]?.datasetVersion === dataset.version && Array.isArray(saved[storageKey].records)) {
      report = saved[storageKey];
      report.records = report.records.filter((record) => byId.has(record.id) && (record.result || record.error)).slice(0, 100);
      report.records.forEach((record) => { record.review ||= {}; });
    }
    report.alignmentAvailable = Boolean(saved.localAlignmentEnabled && saved.localAlignmentPrepared);
    elements.alignment.checked = report.records.find((record) => !record.error)?.alignmentEnabled ?? report.alignmentAvailable;
    elements.modelNote.textContent = report.alignmentAvailable ? "已启用，可比较开启或关闭的效果" : "未启用；需要时到翻译设置准备对齐模型";
    setBusy(false); render();
  })().catch((error) => status("读取评测记录失败：" + error.message));
})();
