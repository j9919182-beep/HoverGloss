(function () {
  "use strict";
  const elements = Object.fromEntries(["refresh", "exportFeedback", "filter", "status", "entries"]
    .map((id) => [id, document.getElementById(id)]));
  const labels = { word: "单词义不对", phrase: "短语问题", context: "原句提取问题", sentence: "整句翻译问题", other: "其他" };
  let entries = [];
  function node(tag, text, parent) { const item = document.createElement(tag);
    if (text) item.textContent = text; parent?.appendChild(item); return item; }
  function render() {
    elements.entries.replaceChildren();
    elements.exportFeedback.disabled = entries.length === 0;
    elements.status.textContent = "已保存 " + entries.length + " 条问题记录";
    for (const entry of [...entries].reverse()) {
      if (elements.filter.value && entry.issue !== elements.filter.value) continue;
      const card = node("details", "", elements.entries); card.className = "case";
      node("summary", entry.target + " · " + labels[entry.issue], card);
      const source = entry.origin.title + (entry.origin.page ? " · 第 " + entry.origin.page + " 页" : "");
      node("p", source + " · v" + entry.extensionVersion, card).className = "hint";
      const original = node("p", "", card); original.className = "english";
      if (Number.isInteger(entry.targetStart) && Number.isInteger(entry.targetEnd)) {
        original.append(document.createTextNode(entry.context.slice(0, entry.targetStart)));
        node("mark", entry.context.slice(entry.targetStart, entry.targetEnd), original);
        original.append(document.createTextNode(entry.context.slice(entry.targetEnd)));
      } else original.textContent = entry.context;
      const pair = (label, value) => { const row = node("div", "", card); row.className = "pair";
        node("span", label, row); node("span", value || "—", row); };
      pair("卡片单词义", entry.result.displayedWordMeaning);
      pair("翻译结果", entry.result.translation);
      pair("整句译文", entry.result.sentenceTranslation);
      pair("短语", entry.result.phraseTranslation ? entry.result.phrase + " → " + entry.result.phraseTranslation : "");
      pair("独立机译", entry.result.isolatedTranslation);
      pair("你的说明", entry.correction);
      const remove = node("button", "删除此记录", card); remove.type = "button";
      remove.addEventListener("click", async () => {
        if (!window.confirm("删除这条问题记录？")) return;
        remove.disabled = true;
        try {
          const response = await chrome.runtime.sendMessage({ type: "feedbackDelete", id: entry.id });
          if (!response?.ok) throw new Error(response?.error || "删除失败");
          entries = entries.filter((item) => item.id !== entry.id); render();
        } catch (error) { remove.disabled = false; elements.status.textContent = error.message; }
      });
    }
  }
  async function refresh() {
    elements.refresh.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "feedbackList" });
      if (!response?.ok || !Array.isArray(response.entries)) throw new Error(response?.error || "读取失败");
      entries = response.entries; render();
    } catch (error) { elements.status.textContent = error.message; }
    finally { elements.refresh.disabled = false; }
  }
  elements.refresh.addEventListener("click", refresh);
  elements.filter.addEventListener("change", render);
  elements.exportFeedback.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ type: "hovergloss-feedback", version: 1,
      exportedAt: new Date().toISOString(), entries }, null, 2)], { type: "application/json" }));
    const link = node("a"); link.href = url; link.download = "HoverGloss-feedback-" + Date.now() + ".json";
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  refresh();
})();
