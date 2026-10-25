(function (root) {
  "use strict";
  const pending = new Map();
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  async function send(type, fields = {}) {
    const result = await chrome.runtime.sendMessage({ type, language: "fr", ...fields });
    if (!result?.ok) throw new Error(result?.error || "语法解析失败，请重试。");
    return result;
  }
  function saved(entry) {
    return entry.grammar?.version === 1 && entry.grammar.context === entry.context ? entry.grammar : null;
  }
  function renderLocal(container, context) {
    const result = root.HoverGlossFrenchGrammarLocal.analyze(context);
    const local = node("section", "", "local-grammar");
    local.append(node("p", "免费 · 离线 · 无需下载模型或配置密钥", "grammar-offline-label"),
      node("p", "以下来自内置词形和句型规则，只提示能识别的部分；未识别到不代表句子有错。", "muted small"));
    if (result.message) local.append(node("p", result.message));
    for (const [index, sentence] of result.sentences.entries()) {
      const section = node("section", "", "grammar-sentence local-sentence");
      section.append(node("h4", `第 ${index + 1} 句 · 基础提示`), node("p", sentence.text, "original"), node("p", sentence.structure, "grammar-structure"));
      const parts = node("dl", "", "local-parts");
      for (const part of sentence.parts) parts.append(node("dt", `${part.role} · ${part.text}`), node("dd", part.explanation));
      section.append(parts);
      if (sentence.verbs.length) section.append(node("h4", "动词词形与时态线索"));
      for (const verb of sentence.verbs) section.append(node("p", `${verb.text}：${verb.explanation}`, "local-verb"));
      if (sentence.points.length) {
        const details = node("details", "", "local-points");
        details.append(node("summary", "查看否定、冠词与省音等提示"));
        for (const point of sentence.points) details.append(node("p", `${point.text}：${point.explanation}`));
        section.append(details);
      }
      for (const message of sentence.notices) section.append(node("p", message, "muted small"));
      local.append(section);
    }
    container.append(local);
  }
  function render(container, entry, language) {
    const generation = container.grammarGeneration = (container.grammarGeneration || 0) + 1;
    const current = () => container.grammarGeneration === generation;
    container.replaceChildren();
    container.hidden = language !== "fr";
    if (container.hidden) return;
    container.className = "grammar-panel";
    container.append(node("h3", "句子语法 · 初学者"));
    if (!entry.context?.trim()) {
      container.append(node("p", "这条记录没有保存原句，暂时无法解析。", "muted")); return;
    }
    renderLocal(container, entry.context);
    const grammar = saved(entry);
    const ai = node("details", "", "grammar-ai");
    ai.open = Boolean(grammar || pending.has(entry.id));
    ai.append(node("summary", "可选：AI 详细解析"));
    container.append(ai);
    if (grammar) {
      for (const [index, sentence] of grammar.analysis.sentences.entries()) {
        const section = node("section", "", "grammar-sentence");
        section.append(node("h4", `第 ${index + 1} 句`), node("p", sentence.text, "original"),
          node("p", sentence.meaning, "muted"), node("p", sentence.structure, "grammar-structure"));
        const parts = node("dl", "", "grammar-parts");
        for (const part of sentence.parts) {
          parts.append(node("dt", `${part.role} · ${part.text}`), node("dd", part.explanation));
        }
        section.append(parts);
        if (sentence.verbs.length) {
          section.append(node("h4", "动词与时态"));
          for (const verb of sentence.verbs) section.append(node("p", `${verb.text} ← ${verb.infinitive}\n${verb.tense}：${verb.explanation}`));
        }
        if (sentence.points.length) {
          const details = node("details", "", "grammar-points");
          details.append(node("summary", "展开常见结构与易错点"));
          for (const point of sentence.points) details.append(node("p", `${point.text}：${point.explanation}`));
          section.append(details);
        }
        ai.append(section);
      }
      ai.append(node("p", `记住这一点：${grammar.analysis.tip}`, "grammar-tip"),
        node("p", `AI 解析参考 · ${grammar.model || "已配置模型"} · ${new Date(grammar.createdAt).toLocaleDateString("zh-CN")} · 已保存在本地，可能有误，可在学习笔记中记录纠正。`, "muted small"));
    } else {
      ai.append(node("p", "需要更完整的句子成分和中文讲解时，可手动调用 AI。", "muted"));
    }
    ai.append(node("p", "点击下方按钮会将本条原句发送给你配置的 AI 服务商，可能产生接口费用；不附带文件名、链接或其他学习记录。已有解析可直接查看，无需再次请求。", "muted small"));
    const actions = node("div", "", "grammar-actions");
    const button = node("button", grammar ? "重新解析（发送原句至 AI）" : "解析语法（发送原句至 AI）", "grammar-generate");
    button.type = "button"; button.disabled = true;
    const settings = node("a", "配置 AI 接口"); settings.href = "options.html?grammar=1#aiEndpoint"; settings.target = "_blank"; settings.rel = "noopener";
    actions.append(button, settings);
    const status = node("p", "正在检查接口设置…", "grammar-status muted small");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    ai.append(actions, status);
    const running = pending.get(entry.id);
    if (running) {
      button.textContent = "正在解析…";
      status.textContent = "正在分析原句，通常需要数秒；结果会保存在此记录中。";
      running.then((grammar) => { entry.grammar = grammar; if (current()) render(container, entry, language); }, (error) => {
        if (current()) { button.disabled = false; button.textContent = "重试解析（发送原句至 AI）"; status.textContent = error.message; }
      });
    } else {
      send("learningGrammarStatus").then((result) => {
        if (!current()) return;
        button.disabled = !result.ready;
        status.textContent = result.ready ? `将使用：${result.model}。仅点击解析时才发送。` :
          "尚未配置可用 AI 接口，仍可直接使用上方离线提示。若需要 AI 详细解析，请在设置填写接口地址、模型和密钥并保存，然后刷新学习库。";
      }, (error) => { if (current()) status.textContent = error.message; });
    }
    button.addEventListener("click", () => {
      if (button.disabled || pending.has(entry.id)) return;
      const task = send("learningGrammar", { id: entry.id, confirmSend: true, regenerate: Boolean(saved(entry)) })
        .then((result) => { entry.grammar = result.entry.grammar; return entry.grammar; })
        .finally(() => pending.delete(entry.id));
      pending.set(entry.id, task);
      render(container, entry, language);
    });
  }
  root.HoverGlossLearningGrammar = { render };
})(globalThis);
