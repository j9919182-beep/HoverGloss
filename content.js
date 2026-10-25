(function () {
  "use strict";

  const rules = globalThis.ConciseHoverRules;
  const DEFAULTS = {
    sourceLanguage: "en",
    enabledHosts: [],
    triggerMode: "alt-hover",
    hoverDelay: 450,
    skipCommonWords: true,
    skipAcronyms: true,
    showPartOfSpeech: false,
    enableSentenceTranslation: true,
    selectionAutoTranslate: true,
    learningMode: false
  };

  let settings = { ...DEFAULTS };
  let hoverTimer = null;
  let activeToken = 0;
  let lastKey = "";
  let tooltip = null;
  let tooltipPinned = false;
  let hoverSticky = false;
  let detailsExpanded = false;
  let learningCapture = null;
  let learningHideTimer = null;
  let tooltipHovered = false;
  let feedbackCapture = null;

  init();

  async function init() {
    settings = await chrome.storage.local.get(DEFAULTS);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const keys = Object.keys(changes).filter((key) => Object.hasOwn(DEFAULTS, key));
      if (!keys.length) return;
      keys.forEach((key) => { settings[key] = changes[key].newValue; });
      hideTooltip();
    });
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("dblclick", onDoubleClick, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("mousedown", (event) => {
      if (tooltip && !tooltip.contains(event.target)) hideTooltip();
    }, true);
    document.addEventListener("keyup", (event) => {
      if ((settings.triggerMode === "alt-hover" && event.key === "Alt") ||
          (settings.triggerMode === "ctrl-hover" && event.key === "Control")) dismissWebHover();
    }, true);
    document.addEventListener("mouseleave", dismissWebHover);
    document.addEventListener("scroll", (event) => {
      if (!tooltip?.contains(event.target)) dismissWebHover();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideTooltip();
      if (event.altKey && event.key.toLowerCase() === "t") translateCurrentSelection(event);
    }, true);
    document.addEventListener("hovergloss:pagechange", hideTooltip);
  }

  function isEnabledHere() {
    if (location.protocol === "chrome-extension:" && /\/(?:demo|pdf)\.html$/.test(location.pathname)) return true;
    return Array.isArray(settings.enabledHosts) && settings.enabledHosts.includes(location.hostname);
  }

  function isPdfReader() {
    return location.protocol === "chrome-extension:" && /\/pdf\.html$/.test(location.pathname);
  }

  function cancelLearningHide() {
    if (learningHideTimer) clearTimeout(learningHideTimer);
    learningHideTimer = null;
  }

  function dismissWebHover(immediate = false) {
    if (isPdfReader() || tooltipPinned) return;
    const canInteract = settings.learningMode && learningCapture || tooltip?.querySelector?.(".cht-feedback-open");
    if (immediate === true || !canInteract) return hideTooltip();
    if (tooltipHovered || learningHideTimer) return;
    learningHideTimer = setTimeout(() => { learningHideTimer = null; hideTooltip(); }, 500);
  }

  function modifierSatisfied(event) {
    if (settings.triggerMode === "always-hover") return true;
    if (settings.triggerMode === "ctrl-hover") return event.ctrlKey;
    return event.altKey;
  }

  function cancelHoverTimer() {
    if (!hoverTimer) return;
    clearTimeout(hoverTimer);
    hoverTimer = null;
    lastKey = "";
  }

  function onMouseMove(event) {
    if (!isEnabledHere()) {
      hideTooltip();
      return;
    }
    if (tooltipPinned) return;
    if (!settings.triggerMode.endsWith("hover")) return;
    if (tooltip && tooltip.contains(event.target)) {
      tooltipHovered = true;
      cancelLearningHide();
      cancelHoverTimer();
      return;
    }
    tooltipHovered = false;
    if (!modifierSatisfied(event) || rules.isBlockedElement(event.target)) {
      cancelHoverTimer();
      dismissWebHover();
      return;
    }
    const kind = settings.enableSentenceTranslation && event.shiftKey ? "sentence" : "word";
    const hit = kind === "sentence"
      ? getSentenceAtPoint(event.clientX, event.clientY)
      : getWordAtPoint(event.clientX, event.clientY);
    const invalid = !hit || (kind === "sentence"
      ? !rules.isSentenceTarget(hit.text)
      : rules.shouldSkipTarget(hit.text, settings));
    if (invalid) {
      cancelHoverTimer();
      dismissWebHover();
      return;
    }
    const key = `${kind}|${hit.text}|${Math.round(hit.rect.left)}|${Math.round(hit.rect.top)}`;
    if (key === lastKey) { cancelLearningHide(); return; }
    cancelHoverTimer();
    dismissWebHover(true);
    lastKey = key;
    hoverTimer = setTimeout(
      () => requestTranslation(hit.text, hit.rect, hit.element, kind, hit.context, false, hit),
      Number(settings.hoverDelay) || 450
    );
  }

  function onDoubleClick(event) {
    if (!isEnabledHere() || settings.triggerMode !== "double-click" || rules.isBlockedElement(event.target)) return;
    const selection = window.getSelection();
    const text = rules.normalizeText(selection?.toString());
    if (rules.shouldSkipTarget(text, settings) || !selection.rangeCount) return;
    const details = contextDetailsForSelection(selection, text);
    requestTranslation(text, selection.getRangeAt(0).getBoundingClientRect(), event.target, "word", details.context, true, details);
  }

  function onMouseUp(event) {
    if (!isEnabledHere() || rules.isBlockedElement(event.target)) return;
    if (!settings.selectionAutoTranslate && settings.triggerMode !== "selection") return;
    setTimeout(() => {
      const selection = window.getSelection();
      const text = rules.normalizePassage(selection?.toString());
      if (!selection.rangeCount) return;
      const wordCount = (text.match(/[\p{Script=Latin}][\p{Script=Latin}\p{M}'’-]*/gu) || []).length;
      let kind = "word";
      if (wordCount >= 2) kind = text.length > 500 || text.includes("\n") ? "passage" : "sentence";
      if (kind === "word" && settings.triggerMode !== "selection") return;
      const invalid = kind === "passage"
        ? !rules.isPassageTarget(text)
        : kind === "sentence"
          ? !rules.isSentenceTarget(text)
          : rules.shouldSkipTarget(text, settings);
      if (invalid) return;
      const details = kind === "word" || settings.learningMode && selectedPhraseWords(text).length
        ? contextDetailsForSelection(selection, text) : { context: text };
      requestTranslation(text, pointRect(event.clientX, event.clientY), event.target, kind, details.context, true, details);
    }, 0);
  }

  function translateCurrentSelection(event) {
    if (!isEnabledHere() || !settings.enableSentenceTranslation) return;
    const selection = window.getSelection();
    const text = rules.normalizeText(selection?.toString());
    if (!selection?.rangeCount || !rules.isSentenceTarget(text)) return;
    event.preventDefault();
    const kind = text.length > 500 || text.includes("\n") ? "passage" : "sentence";
    const details = settings.learningMode && selectedPhraseWords(text).length
      ? contextDetailsForSelection(selection, text) : { context: text };
    requestTranslation(text, selection.getRangeAt(0).getBoundingClientRect(), selection.anchorNode?.parentElement, kind, details.context, true, details);
  }

  function clearPending() {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    lastKey = "";
  }

  async function requestTranslation(target, rect, element, kind = "word", explicitContext = "", pinned = false, targetRange = {}) {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    const token = ++activeToken;
    const sourceLanguage = settings.sourceLanguage === "fr" ? "fr" : "en";
    detailsExpanded = false;
    cancelLearningHide();
    learningCapture = { saved: false, saving: false };
    feedbackCapture = null;
    const learningSource = isPdfReader()
      ? { ...(globalThis.HoverGlossPdfReadingSource || { type: "pdf", title: document.title }) }
      : { type: "web", title: document.title, url: location.href };
    tooltipPinned = pinned;
    hoverSticky = !pinned && isPdfReader();
    showTooltip("…", rect, true, false, kind, pinned);
    const context = explicitContext || rules.compactContext(element?.parentElement?.innerText || element?.textContent || "", target);
    const targetStart = Number.isInteger(targetRange?.targetStart) ? targetRange.targetStart : locateTargetRange(context, target).targetStart;
    const targetEnd = Number.isInteger(targetRange?.targetEnd)
      ? targetRange.targetEnd
      : targetStart >= 0 ? targetStart + target.length : -1;
    try {
      let response = await chrome.runtime.sendMessage({
        type: "translate",
        payload: { target, context, kind, targetStart, targetEnd, sourceLanguage }
      });
      if (token !== activeToken) return;
      if (!response?.ok) throw new Error(response?.error || "翻译失败");
      if (response.delegate === "browser") {
        const localResult = await globalThis.HoverGlossBrowserTranslator.translate({ target, context, kind, sourceLanguage });
        const refined = kind === "word" && sourceLanguage === "en"
          ? globalThis.HoverGlossContextAligner.refine(localResult, {
              target,
              context,
              targetStart,
              targetEnd,
              candidates: response.candidateSenses || []
            })
          : localResult;
        response = { ...response, ...refined, ok: true };
      }
      if (token !== activeToken) return;
      const present = (translated) => {
        if (feedbackCapture) return;
        const displayUncertain = translated.contextReview === "unresolved" &&
          translated.sentenceTranslation && !translated.alignedChineseSpan &&
          !translated.sentenceTranslation.includes(translated.translation);
        const compact = displayUncertain ? "暂无法确定" : kind === "passage"
          ? rules.cleanPassageTranslation(translated.translation)
          : kind === "sentence"
            ? rules.cleanSentenceTranslation(translated.translation)
            : rules.cleanTranslation(translated.translation, target.includes(" "));
        const label = settings.showPartOfSpeech && translated.pos ? `${compact}  ${translated.pos}` : compact;
        const source = translated.source || "unknown";
        showTooltip(label, rect, false, false, kind, pinned, {
          target,
          sourceLanguage,
          targetStart,
          targetEnd,
          translation: translated.translation,
          learningSource,
          context,
          pos: translated.pos || "",
          source,
          phrase: translated.phrase || "",
          phraseTranslation: translated.phraseTranslation || "",
          sentenceTranslation: translated.sentenceTranslation || "",
          alignedChineseSpan: translated.alignedChineseSpan || "",
          confidence: translated.confidence,
          evidenceSource: translated.evidenceSource || "",
          contextReview: translated.contextReview || "",
          displayUncertain: Boolean(displayUncertain),
          isolatedTranslation: translated.isolatedTranslation || "",
          unconfirmedTranslation: translated.unconfirmedTranslation || (displayUncertain ? translated.translation : ""),
          alternatives: Array.isArray(translated.alternatives) ? translated.alternatives : [],
          warning: translated.warning || ""
        });
      };
      const needsReview = sourceLanguage === "en" && kind === "word" && ["browser", "browser-context"].includes(response.source) &&
        (!Number.isFinite(response.confidence) || response.confidence < 0.7);
      const canAlign = needsReview && response.localAlignmentEnabled && response.sentenceTranslation &&
        targetStart >= 0 && targetEnd > targetStart;
      const reviewState = canAlign ? "pending"
        : !response.sentenceTranslation ? "no-sentence"
          : response.localAlignmentEnabled ? "unavailable" : "not-enabled";
      present(needsReview ? { ...response, contextReview: reviewState } : response);
      if (canAlign) {
        chrome.runtime.sendMessage({
          type: "alignWord",
          payload: { context, targetStart, targetEnd, result: response }
        }).then(async (aligned) => {
          if (token !== activeToken) return;
          let reviewed = aligned?.ok && aligned.result
            ? aligned.result
            : { ...response, contextReview: "unavailable" };
          if (reviewed.contextReview === "unresolved" && Array.isArray(aligned?.phraseCandidates)) {
            for (const phrase of aligned.phraseCandidates.slice(0, 3)) {
              try {
                const translated = await globalThis.HoverGlossBrowserTranslator.translate({ target: phrase, kind: "sentence" });
                if (token !== activeToken) return;
                reviewed = globalThis.HoverGlossLocalAlignmentCore.applyPhraseTranslation(reviewed, phrase, translated.translation);
                if (reviewed.contextReview === "phrase-only") break;
              } catch { break; }
            }
          }
          if (token === activeToken) present(reviewed);
        }).catch(() => {
          if (token === activeToken) present({ ...response, contextReview: "unavailable" });
        });
      }
    } catch (error) {
      if (token === activeToken) showTooltip(error.message || "翻译失败", rect, false, true, kind, pinned);
    }
  }

  function ensureTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.id = "concise-hover-translator";
    tooltip.setAttribute("data-concise-hover-ignore", "");
    tooltip.setAttribute("role", "status");
    tooltip.setAttribute("aria-live", "polite");
    tooltip.addEventListener("mouseenter", () => {
      tooltipHovered = true;
      cancelHoverTimer();
      cancelLearningHide();
    });
    tooltip.addEventListener("mouseleave", () => { tooltipHovered = false; dismissWebHover(); });
    document.documentElement.appendChild(tooltip);
    return tooltip;
  }

  function sourceLabel(source, evidenceSource = "") {
    if (evidenceSource === "phrase") return "短语语境匹配";
    if (source === "custom") return "自定义术语";
    if (/^stored:/.test(source)) return "本地词库匹配";
    if (source === "contextual") return "本地语境判断";
    if (/^(topic|builtin):/.test(source) || source === "local") return "本地术语匹配";
    if (source === "ai") return "AI 上下文判断";
    if (source === "browser-context") return "本机句意对齐";
    if (source === "browser-local-align") return "本机模型对齐（参考）";
    if (source === "browser-phrase-align") return "本机短语对齐（参考）";
    if (source === "browser-phrase-context") return "本机短语译意（参考）";
    if (source === "browser") return "浏览器本机翻译";
    return "上下文翻译";
  }

  function evidenceLabel(details) {
    if (details.source === "browser-local-align") return "整句译文 + 本机词语对齐";
    if (details.source === "browser-phrase-align") return "整句译文 + 短语对齐，单词未定位";
    if (details.source === "browser-phrase-context") return "整句译文 + 独立短语翻译，单词未定位";
    if (details.evidenceSource === "phrase") return "完整短语匹配";
    if (details.alignedChineseSpan) return "候选词义出现在句译中";
    if (details.evidenceSource === "browser-isolated" || details.source === "browser") return "单词直译，句意尚未确认";
    if (details.evidenceSource === "contextual") return "上下文词库匹配";
    if (details.evidenceSource) return "术语或候选词义";
    return "当前语境";
  }

  function appendPronunciation(parent, term, onError, sourceLanguage = settings.sourceLanguage) {
    const button = globalThis.HoverGlossPronunciation?.createButton(term, {
      className: "cht-action cht-pronounce", onError, language: sourceLanguage
    });
    if (button) parent.appendChild(button);
  }

  function studySaveButton(entry, phraseControl = false) {
    const libraryName = entry.language === "fr" ? "法语学习库" : "学习库";
    const state = learningCapture || (learningCapture = { saved: false, saving: false });
    state.keys ||= new Set(); state.labels ||= new Map(); state.controls ||= [];
    const wordKey = entry.term.toLowerCase();
    const key = wordKey + "|" + (entry.phrase || "").toLowerCase() + "|" + (entry.phraseTranslation || "");
    const button = document.createElement("button");
    button.className = "cht-action cht-study-save" + (phraseControl ? " cht-study-phrase" : "");
    button.type = "button";
    button.title = entry.phrase ? "将单词义、关联短语、原句和来源保存在同一条学习记录中" : "保存单词义、原句和来源";
    const control = { button, key, error: "" };
    state.controls.push(control);
    function refresh() {
      for (const item of state.controls) {
        const saved = state.keys.has(item.key);
        item.button.disabled = saved || state.saving;
        item.button.textContent = state.saving ? "保存中…" : saved ? state.labels.get(item.key) || `已加入${libraryName}`
          : item.error ? "重试加入" : item.button.className.includes("cht-study-phrase")
            ? state.saved ? "＋ 补存短语" : "＋ 词与短语一起收藏" : `＋ 加入${libraryName}`;
      }
    }
    refresh();
    button.addEventListener("click", async () => {
      if (state.saving || state.keys.has(key)) return;
      state.saving = true; control.error = ""; refresh();
      try {
        const response = await chrome.runtime.sendMessage({ type: "learningSave", entry });
        if (!response?.ok) throw new Error(response?.error || "保存失败，请重试");
        state.saved = true; state.keys.add(key);
        state.labels.set(key, response.updated ? "已补入原记录" : response.duplicate ? `${libraryName}中已有` : `已加入${libraryName}`);
      } catch (error) { control.error = error.message || "保存失败"; button.title = control.error; }
      finally { state.saving = false; refresh(); }
    });
    return button;
  }

  function selectedPhraseWords(value) {
    const text = rules.normalizeText(value || "");
    if (text.length > 100 || !/^[\p{Script=Latin}][\p{Script=Latin}\p{M}'’-]*(?:\s+[\p{Script=Latin}][\p{Script=Latin}\p{M}'’-]*){1,7}$/u.test(text)) return [];
    return [...new Set(text.split(/\s+/))];
  }

  function buildWordTooltip(box, text, details) {
    const topicBar = document.createElement("div");
    topicBar.className = "cht-topic-bar";
    const topicName = document.createElement("strong");
    topicName.textContent = details.sourceLanguage === "fr" ? "法语 · 当前语境" : "当前语境";
    const source = document.createElement("span");
    source.className = "cht-source";
    source.textContent = sourceLabel(details.source, details.evidenceSource);
    topicBar.append(topicName, source);

    const body = document.createElement("div");
    body.className = "cht-word-body";
    const head = document.createElement("div");
    head.className = "cht-word-head";
    const titleBlock = document.createElement("div");
    const target = document.createElement("div");
    target.className = "cht-target";
    target.textContent = details.target;
    titleBlock.appendChild(target);
    if (details.pos) {
      const pos = document.createElement("span");
      pos.className = "cht-pos";
      pos.textContent = details.pos;
      titleBlock.appendChild(pos);
    }
    head.appendChild(titleBlock);

    const phrase = rules.normalizeText(details.phrase || "");
    const hasDistinctPhrase = Boolean(phrase && details.phraseTranslation &&
      phrase.toLowerCase() !== details.target.toLowerCase());
    const wordUnconfirmed = details.contextReview === "phrase-only" || details.displayUncertain ||
      (/^browser/.test(details.source || "") && details.contextReview !== "aligned" &&
        (!Number.isFinite(details.confidence) || details.confidence < 0.7));
    const commonSense = wordUnconfirmed && details.sourceLanguage !== "fr" ? globalThis.HoverGlossWordSenses?.lookup(details.target) : null;
    const machineCandidate = details.isolatedTranslation || "";
    const preliminaryCandidate = details.unconfirmedTranslation || "";
    const wordLabel = wordUnconfirmed ? commonSense ? "单词常见义"
      : machineCandidate ? "单独机译参考" : preliminaryCandidate ? "初步候选（未确认）" : "句中义待确认"
      : details.contextReview === "aligned" ? "单词句中义" : "单词释义";
    const wordTranslation = wordUnconfirmed ? commonSense?.gloss || machineCandidate || preliminaryCandidate || "待确认" : text;
    const wordStatus = wordUnconfirmed ? commonSense ? "非句中定论" : "未确认" : "";
    const learningEntry = {
        term: details.target, meaning: wordTranslation, meaningLabel: wordLabel, language: details.sourceLanguage || "en",
        uncertain: wordUnconfirmed || (Number.isFinite(details.confidence) && details.confidence < 0.7),
        context: details.context, sentenceTranslation: details.sentenceTranslation,
        phrase, phraseTranslation: details.phraseTranslation,
        commonMeaning: details.sourceLanguage === "fr" ? "" : globalThis.HoverGlossWordSenses?.lookup(details.target)?.gloss || "",
        pos: details.pos, translationSource: sourceLabel(details.source, details.evidenceSource),
        origin: details.learningSource
      };
    const speechError = (message) => {
      let status = body.querySelector?.(".cht-speech-status");
      if (!status) { status = document.createElement("p"); status.className = "cht-speech-status"; body.appendChild(status); }
      status.textContent = message;
    };
    if (settings.learningMode) {
      appendPronunciation(titleBlock, details.target, speechError);
      head.appendChild(studySaveButton(learningEntry));
    }
    let meanings;
    if (hasDistinctPhrase || wordUnconfirmed) {
      meanings = document.createElement("div");
      meanings.className = "cht-meanings";
      const addMeaning = (label, original, translation, type, status = "") => {
        const row = document.createElement("div");
        row.className = `cht-meaning cht-meaning-${type}`;
        const heading = document.createElement("div");
        heading.className = "cht-meaning-heading";
        const headingLabel = document.createElement("span");
        headingLabel.textContent = label;
        heading.appendChild(headingLabel);
        if (status) {
          const note = document.createElement("small");
          note.textContent = status;
          heading.appendChild(note);
        }
        const pair = document.createElement("div");
        pair.className = "cht-meaning-pair";
        const english = document.createElement("span");
        english.className = "cht-meaning-original";
        english.textContent = original;
        const chinese = document.createElement("strong");
        chinese.className = "cht-meaning-translation";
        chinese.textContent = translation;
        pair.append(english, chinese);
        row.append(heading, pair);
        if (type === "phrase" && settings.learningMode) {
          const actions = document.createElement("div"); actions.className = "cht-phrase-actions";
          appendPronunciation(actions, original, speechError);
          actions.appendChild(studySaveButton(learningEntry, true)); row.appendChild(actions);
        }
        meanings.appendChild(row);
      };
      if (hasDistinctPhrase && wordUnconfirmed) addMeaning("短语义", phrase, details.phraseTranslation, "phrase", "整短语");
      addMeaning(wordLabel, details.target, wordTranslation,
        wordUnconfirmed ? commonSense ? "common" : "tentative" : "word", wordStatus);
      if (hasDistinctPhrase && !wordUnconfirmed) addMeaning("短语义", phrase, details.phraseTranslation, "phrase");
    } else {
      meanings = document.createElement("div");
      meanings.className = "cht-best";
      const bestLabel = document.createElement("span");
      bestLabel.textContent = details.contextReview === "phrase-only" ? "短语义"
        : details.displayUncertain ? "句中词义"
        : details.contextReview === "aligned"
        ? "句中释义"
        : Number.isFinite(details.confidence) && details.confidence < 0.7 ? "可能是" : "最佳翻译";
      const bestText = document.createElement("strong");
      bestText.textContent = text;
      meanings.append(bestLabel, bestText);
    }

    const explanation = document.createElement("details");
    explanation.className = "cht-explanation";
    explanation.open = detailsExpanded;
    const explanationSummary = document.createElement("summary");
    explanationSummary.textContent = detailsExpanded ? "收起判断依据" : "查看判断依据";
    explanation.addEventListener("toggle", () => {
      detailsExpanded = explanation.open;
      explanationSummary.textContent = detailsExpanded ? "收起判断依据" : "查看判断依据";
      requestAnimationFrame(() => {
        if (!box.isConnected) return;
        const bounds = box.getBoundingClientRect();
        const top = Math.max(8, window.innerHeight - bounds.height - 8);
        if (bounds.top > top) box.style.top = `${top}px`;
      });
    });
    const context = document.createElement("div");
    context.className = "cht-context";
    const phraseEvidence = phrase && !details.phraseTranslation && phrase.toLowerCase() !== details.target.toLowerCase()
      ? `识别短语“${phrase}”。`
      : "";
    const rationale = details.source === "browser-phrase-align"
      ? `${phraseEvidence}已定位整短语，但不能可靠拆出目标词的单独译义。`
      : details.source === "browser-phrase-context"
      ? `${phraseEvidence}短语单独翻译与整句译文一致，但目标词的单独译义仍待确认。`
      : details.source === "browser-local-align"
      ? `${phraseEvidence}根据整句译文定位目标词；若整句译错，词义也可能不准。`
      : details.source === "browser-context"
      ? `${phraseEvidence}先翻译完整句子，再将候选词义与句中中文对应。`
      : details.source === "browser"
      ? `${details.warning ? `${details.warning}。` : ""}译文在设备本地生成；整句译意用于辅助判断多义词。`
      : `${phraseEvidence}结合当前句意判断。`;
    context.appendChild(document.createTextNode(rationale));
    const evidence = document.createElement("div");
    evidence.className = "cht-evidence";
    evidence.textContent = `判断依据：${evidenceLabel(details)}`;
    context.appendChild(evidence);
    if (details.context) {
      const original = document.createElement("div");
      original.className = "cht-evidence";
      original.textContent = `原句：${details.context}`;
      context.appendChild(original);
    }
    if (details.alignedChineseSpan) {
      const alignment = document.createElement("div");
      alignment.className = "cht-alignment";
      alignment.textContent = `句中对应：${details.alignedChineseSpan}`;
      context.appendChild(alignment);
    }
    if (Number.isFinite(details.confidence)) {
      const confidence = document.createElement("div");
      confidence.className = "cht-confidence";
      const level = details.confidence >= 0.85 ? "高" : details.confidence >= 0.7 ? "中" : "低";
      confidence.textContent = `${["aligned", "phrase-only"].includes(details.contextReview) ? "初步线索" : "匹配线索"}：${level}`;
      context.appendChild(confidence);
    }
    if (details.contextReview) {
      const review = document.createElement("div");
      review.className = "cht-review";
      review.textContent = details.contextReview === "aligned"
        ? "句意复核：已定位对应片段（仅供参考）"
        : details.contextReview === "phrase-only"
          ? "句意复核：短语已定位，单词义仍待确认"
        : details.contextReview === "pending"
          ? "句意复核：正在定位词义…"
          : details.contextReview === "unavailable"
            ? "句意复核：后台模型运行失败，请到设置页重新测试"
            : details.contextReview === "not-enabled"
              ? "句意复核：未启用本机对齐，释义待确认"
              : details.contextReview === "no-sentence"
                ? "句意复核：缺少整句译文，释义待确认"
                : "句意复核：未找到可靠对应，释义待确认";
      context.appendChild(review);
    }
    if (machineCandidate && (commonSense && machineCandidate !== commonSense.gloss || !wordUnconfirmed)) {
      const unconfirmed = document.createElement("div");
      unconfirmed.className = "cht-alternatives";
      unconfirmed.textContent = `单独机译参考（未确认）：${machineCandidate}`;
      context.appendChild(unconfirmed);
    }
    if (preliminaryCandidate && preliminaryCandidate !== machineCandidate && preliminaryCandidate !== wordTranslation) {
      const preliminary = document.createElement("div");
      preliminary.className = "cht-alternatives";
      preliminary.textContent = `初步候选（未确认）：${preliminaryCandidate}`;
      context.appendChild(preliminary);
    }
    if (!details.displayUncertain && details.contextReview !== "phrase-only" &&
        details.confidence < 0.7 && details.alternatives?.length) {
      const alternatives = document.createElement("div");
      alternatives.className = "cht-alternatives";
      alternatives.textContent = `其他可能：${details.alternatives.join("、")}`;
      context.appendChild(alternatives);
    }
    explanation.append(explanationSummary, context);
    body.appendChild(head);
    if (wordUnconfirmed) {
      const note = document.createElement("div");
      note.className = "cht-word-review-note";
      note.textContent = details.contextReview === "pending" ? "正在根据原句定位词义…"
        : hasDistinctPhrase ? "短语已定位，单词的句中义待确认"
        : "句中词义待确认，下方释义仅供参考";
      body.appendChild(note);
    }
    if (!wordUnconfirmed || hasDistinctPhrase) body.appendChild(meanings);
    if (details.sentenceTranslation) {
      const sentenceMeaning = document.createElement("div");
      sentenceMeaning.className = "cht-sentence-meaning" + (wordUnconfirmed ? " cht-sentence-fallback" : "");
      sentenceMeaning.textContent = `句意：${details.sentenceTranslation}`;
      body.appendChild(sentenceMeaning);
    }
    if (wordUnconfirmed && !hasDistinctPhrase) body.appendChild(meanings);
    body.appendChild(explanation);
    buildFeedbackControl(body, box, details, wordTranslation, wordLabel);
    box.append(topicBar, body);
  }

  function buildFeedbackControl(body, box, details, displayedWordMeaning, displayedWordLabel) {
    const footer = document.createElement("div");
    footer.className = "cht-feedback-footer";
    const open = document.createElement("button");
    open.type = "button"; open.className = "cht-feedback-open"; open.textContent = "释义不对";
    const form = document.createElement("div");
    form.className = "cht-feedback-form"; form.hidden = true;
    const hint = document.createElement("p");
    hint.textContent = "记录当前原句与译文，仅保存到本机。";
    const label = document.createElement("label");
    label.textContent = "问题类型";
    const issue = document.createElement("select");
    for (const [value, text] of [["word", "单词义不对"], ["phrase", "短语拆分或译义不对"],
      ["context", "原句混入其他内容"], ["sentence", "整句翻译不对"], ["other", "其他"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = text; issue.appendChild(option);
    }
    issue.value = "word"; label.appendChild(issue);
    const correctionLabel = document.createElement("label");
    correctionLabel.textContent = "正确释义或问题说明（可选）";
    const correction = document.createElement("textarea");
    correction.rows = 2; correction.maxLength = 1000; correctionLabel.appendChild(correction);
    const actions = document.createElement("div");
    actions.className = "cht-feedback-actions";
    const save = document.createElement("button");
    save.type = "button"; save.className = "cht-action"; save.textContent = "保存问题";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "cht-action"; cancel.textContent = "取消";
    const message = document.createElement("p"); message.className = "cht-feedback-status";
    actions.append(save, cancel);
    form.append(hint, label, correctionLabel, actions, message);
    footer.append(open, form); body.appendChild(footer);
    let captured = null;
    open.addEventListener("click", () => {
      if (!form.hidden) return;
      cancelHoverTimer(); cancelLearningHide();
      captured = {
        previousPinned: tooltipPinned,
        entry: {
          target: details.target, context: details.context, targetStart: details.targetStart, targetEnd: details.targetEnd,
          origin: details.learningSource,
          result: { translation: details.translation || displayedWordMeaning, displayedWordMeaning, displayedWordLabel,
            isolatedTranslation: details.isolatedTranslation, sentenceTranslation: details.sentenceTranslation,
            phrase: details.phrase, phraseTranslation: details.phraseTranslation,
            source: details.source, contextReview: details.contextReview, confidence: details.confidence }
        }
      };
      feedbackCapture = captured; tooltipPinned = true; box.classList?.add("is-pinned");
      form.hidden = false; open.hidden = true;
      requestAnimationFrame(() => {
        if (!box.isConnected) return;
        const bounds = box.getBoundingClientRect();
        const top = Math.max(8, window.innerHeight - bounds.height - 8);
        if (bounds.top > top) box.style.top = top + "px";
      });
    });
    cancel.addEventListener("click", () => {
      form.hidden = true; open.hidden = false;
      if (feedbackCapture === captured) {
        feedbackCapture = null; tooltipPinned = captured.previousPinned;
        if (!tooltipPinned && !hoverSticky) box.classList?.remove("is-pinned");
      }
    });
    save.addEventListener("click", async () => {
      if (!captured || save.disabled) return;
      const entry = { ...captured.entry, issue: issue.value, correction: correction.value || "" };
      save.disabled = true; message.textContent = "保存中…";
      try {
        const response = await chrome.runtime.sendMessage({ type: "feedbackSave", entry });
        if (!response?.ok) throw new Error(response?.error || "保存失败");
        message.textContent = response.duplicate ? "已记录过此问题" : "已保存，可在测试页的“问题记录”查看或导出。";
        cancel.textContent = "完成"; open.textContent = "问题已记录";
      } catch (error) { save.disabled = false; message.textContent = error.message || "保存失败，请重试"; }
    });
  }

  function buildSelectedPhraseStudy(body, box, details, translation) {
    const words = selectedPhraseWords(details.target);
    if (!settings.learningMode || !words.length) return;
    const section = document.createElement("div"); section.className = "cht-phrase-study";
    const toggle = document.createElement("button"); toggle.type = "button";
    toggle.className = "cht-action"; toggle.textContent = "＋ 收藏为关联短语";
    const form = document.createElement("div"); form.className = "cht-phrase-form"; form.hidden = true;
    const hint = document.createElement("p"); hint.textContent = "将选中内容作为短语，与所选单词保存在同一条记录中。";
    const label = document.createElement("label"); label.textContent = "关联单词";
    const select = document.createElement("select");
    const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "请选择要关联的单词";
    select.appendChild(placeholder);
    for (const word of words) { const option = document.createElement("option"); option.value = word; option.textContent = word; select.appendChild(option); }
    label.appendChild(select);
    const meaningLabel = document.createElement("label"); meaningLabel.textContent = "单词释义（可选，不是整短语译义）";
    const meaning = document.createElement("input"); meaning.type = "text"; meaning.maxLength = 500;
    meaning.placeholder = "未知可留空，保存为待确认"; meaningLabel.appendChild(meaning);
    const audio = document.createElement("div");
    const save = document.createElement("button"); save.type = "button"; save.className = "cht-action"; save.textContent = "保存词与短语";
    const status = document.createElement("p"); status.className = "cht-study-status";
    let suggestedMeaning = "";
    const showError = (message) => { status.textContent = message; };
    appendPronunciation(audio, details.target, showError);
    select.addEventListener("change", () => {
      suggestedMeaning = details.sourceLanguage === "fr" ? "" : globalThis.HoverGlossWordSenses?.lookup(select.value)?.gloss || "";
      meaning.value = suggestedMeaning;
    });
    toggle.addEventListener("click", () => {
      form.hidden = !form.hidden;
      requestAnimationFrame(() => {
        if (!box.isConnected) return;
        const bounds = box.getBoundingClientRect();
        const top = Math.max(8, window.innerHeight - bounds.height - 8);
        if (bounds.top > top) box.style.top = top + "px";
      });
    });
    save.addEventListener("click", async () => {
      if (save.disabled) return;
      if (!words.includes(select.value)) { status.textContent = "请先选择这个短语要关联的单词。"; return; }
      const entry = { term: select.value, meaning: meaning.value.trim() || "待确认", language: details.sourceLanguage || "en",
        meaningLabel: meaning.value.trim() ? meaning.value.trim() === suggestedMeaning ? "单词常见义" : "手动填写（待核对）" : "句中义待确认",
        uncertain: true, phrase: details.target, phraseTranslation: translation,
        context: details.context || details.target, sentenceTranslation: "",
        commonMeaning: suggestedMeaning, origin: details.learningSource,
        translationSource: sourceLabel(details.source, details.evidenceSource) };
      save.disabled = true; select.disabled = meaning.disabled = true; status.textContent = "保存中…";
      try {
        const response = await chrome.runtime.sendMessage({ type: "learningSave", entry });
        if (!response?.ok) throw new Error(response?.error || "保存失败，请重试");
        save.textContent = "已保存词与短语";
        status.textContent = response.updated ? "短语已补入原单词记录，笔记与复习进度保留。" : "已保存在同一条记录中，单词义可在学习库核对。";
      } catch (error) { save.disabled = false; select.disabled = meaning.disabled = false; status.textContent = error.message; }
    });
    form.append(hint, label, meaningLabel, audio, save, status);
    section.append(toggle, form); body.appendChild(section);
  }

  function buildPassageTooltip(box, text, kind, details) {
    const head = document.createElement("div");
    head.className = "cht-passage-head";
    const title = document.createElement("span");
    title.textContent = `${kind === "passage" ? "自然段" : "句子"}翻译`;
    const close = document.createElement("button");
    close.className = "cht-close";
    close.type = "button";
    close.textContent = "关闭";
    close.addEventListener("click", hideTooltip);
    head.append(title, close);

    const body = document.createElement("div");
    body.className = "cht-passage-body";
    const original = document.createElement("p");
    original.className = "cht-original";
    original.textContent = details.target;
    const translation = document.createElement("p");
    translation.className = "cht-translation";
    translation.textContent = text;
    const actions = document.createElement("div");
    actions.className = "cht-passage-actions";
    const copy = document.createElement("button");
    copy.className = "cht-action";
    copy.type = "button";
    copy.textContent = "复制译文";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = "已复制";
      } catch {
        copy.textContent = "复制失败";
      }
    });
    actions.appendChild(copy);
    body.append(original, translation, actions);
    buildSelectedPhraseStudy(body, box, details, text);
    box.append(head, body);
  }

  function showTooltip(text, rect, loading, error = false, kind = "word", pinned = false, details = null) {
    const box = ensureTooltip();
    box.replaceChildren();
    if (loading || error || !details) {
      const textNode = document.createElement("span");
      textNode.textContent = text;
      box.appendChild(textNode);
    } else if (kind === "word") {
      buildWordTooltip(box, text, details);
    } else {
      buildPassageTooltip(box, text, kind, details);
    }
    box.className = [
      loading ? "is-loading" : "",
      error ? "is-error" : "",
      kind === "sentence" ? "is-sentence" : "",
      kind === "passage" ? "is-passage" : "",
      pinned || hoverSticky ? "is-pinned" : ""
    ].filter(Boolean).join(" ");
    box.style.visibility = "hidden";
    box.style.display = "block";
    const boxRect = box.getBoundingClientRect();
    const margin = 8;
    let left = rect.left + rect.width / 2 - boxRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - boxRect.width - margin));
    let top = rect.top - boxRect.height - 9;
    if (top < margin) top = rect.bottom + 9;
    top = Math.max(margin, Math.min(top, window.innerHeight - boxRect.height - margin));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.visibility = "visible";
  }

  function hideTooltip() {
    globalThis.HoverGlossPronunciation?.stop();
    feedbackCapture = null;
    cancelLearningHide();
    tooltipHovered = false;
    learningCapture = null;
    activeToken += 1;
    tooltipPinned = false;
    hoverSticky = false;
    detailsExpanded = false;
    clearPending();
    if (tooltip) tooltip.style.display = "none";
  }

  function pointRect(x, y) {
    return { left: x, right: x, top: y, bottom: y, width: 0, height: 0 };
  }

  function getCaretAtPoint(x, y) {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    }
    if (!range || range.startContainer?.nodeType !== Node.TEXT_NODE) return null;
    const node = range.startContainer;
    const text = node.textContent || "";
    let offset = Math.min(range.startOffset, Math.max(0, text.length - 1));
    return { node, text, offset };
  }

  function getWordAtPoint(x, y) {
    const caret = getCaretAtPoint(x, y);
    if (!caret) return null;
    const { node, text } = caret;
    let { offset } = caret;
    const wordChar = /[\p{Script=Latin}\p{M}'’-]/u;
    if (!wordChar.test(text[offset] || "") && offset > 0 && wordChar.test(text[offset - 1])) offset -= 1;
    if (!/[\p{Script=Latin}]/u.test(text[offset] || "")) return null;
    let start = offset;
    let end = offset + 1;
    while (start > 0 && wordChar.test(text[start - 1])) start -= 1;
    while (end < text.length && wordChar.test(text[end])) end += 1;
    const word = rules.normalizeText(text.slice(start, end).replace(/^[-'’]+|[-'’]+$/g, ""));
    const wordRange = document.createRange();
    wordRange.setStart(node, start);
    wordRange.setEnd(node, end);
    const rect = wordRange.getBoundingClientRect();
    if (!rect.width || !rect.height || x < rect.left - 2 || x > rect.right + 2) return null;
    const sentence = sentenceForCaret(node, text, offset);
    return {
      text: word,
      rect,
      element: node.parentElement,
      context: sentence.text,
      ...locateTargetRange(sentence.text, word, sentence.offset)
    };
  }

  function getSentenceAtPoint(x, y) {
    const caret = getCaretAtPoint(x, y);
    if (!caret) return null;
    const { node, text, offset } = caret;
    const sentence = sentenceForCaret(node, text, offset);
    if (!sentence.text) return null;
    const sentenceRange = document.createRange();
    sentenceRange.setStart(node, Math.min(offset, text.length));
    sentenceRange.setEnd(node, Math.min(offset + 1, text.length));
    const rect = sentenceRange.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { text: sentence.text, rect, element: node.parentElement, context: sentence.text };
  }

  function contextDetailsForSelection(selection, fallback) {
    const node = selection?.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return { context: fallback, ...locateTargetRange(fallback, fallback) };
    }
    const offset = Math.min(selection.anchorOffset || 0, (node.textContent || "").length);
    const sentence = sentenceForCaret(node, node.textContent || "", offset);
    const context = sentence.text || fallback;
    return { context, ...locateTargetRange(context, fallback, sentence.offset) };
  }

  function sentenceForCaret(node, text, offset) {
    const span = node.parentElement?.closest(".textLayer span");
    const layer = span?.closest(".textLayer");
    if (layer) {
      const context = span.__hoverGlossContext;
      if (typeof context?.text === "string" && Number.isFinite(context.offset)) {
        return sentenceAtOffset(context.text, context.offset + offset);
      }
      return sentenceAtOffset(text, offset);
    }
    const blockContext = textAcrossContextBlock(node, offset);
    if (blockContext) return sentenceAtOffset(blockContext.text, blockContext.offset);
    return sentenceAtOffset(text, offset);
  }

  function textAcrossContextBlock(targetNode, targetOffset) {
    const parent = targetNode.parentElement;
    if (!parent) return null;
    const semanticRoot = parent.closest([
      "p", "li", "blockquote", "figcaption", "caption", "td", "th", "dd", "dt",
      "h1", "h2", "h3", "h4", "h5", "h6", "[role='heading']", "[role='paragraph']"
    ].join(","));
    const root = semanticRoot || parent;
    const headingLike = !semanticRoot || /^H[1-6]$/.test(root.tagName) || root.getAttribute?.("role") === "heading";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent?.trim() || rules.isBlockedElement(node.parentElement)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let combined = "";
    let caretOffset = -1;
    let current;
    let previous = null;
    let visited = 0;
    while ((current = walker.nextNode()) && visited < 300) {
      visited += 1;
      const raw = current.textContent || "";
      const piece = rules.normalizeText(raw);
      if (!piece) continue;
      const separator = previous && isVisualContextBoundary(previous, current, root, headingLike)
        ? "\n" : needsTextSeparator(combined, piece) ? " " : "";
      if (current === targetNode) {
        const prefix = rules.normalizeText(raw.slice(0, Math.min(targetOffset, raw.length)));
        caretOffset = combined.length + separator.length + prefix.length;
      }
      combined += separator + piece;
      previous = current;
    }
    if (caretOffset < 0 || !combined) return null;
    return { text: combined.slice(0, 12000), offset: Math.min(caretOffset, 11999) };
  }

  function contextBranches(previous, current, root) {
    const ancestors = new Set();
    for (let element = previous.parentElement; element; element = element.parentElement) {
      ancestors.add(element);
      if (element === root) break;
    }
    let common = current.parentElement;
    while (common && !ancestors.has(common)) common = common.parentElement;
    if (!common) return [null, null];
    const branch = (node) => {
      let element = node.parentElement;
      if (element === common) return null;
      while (element?.parentElement && element.parentElement !== common) element = element.parentElement;
      return element?.parentElement === common ? element : null;
    };
    return [branch(previous), branch(current)];
  }

  function isVisualContextBoundary(previous, current, root, headingLike) {
    const [before, after] = contextBranches(previous, current, root);
    if (before === after) return false;
    if (typeof getComputedStyle !== "function") return false;
    const blockDisplay = (element) => element && /^(?:block|flex|grid|table|list-item|flow-root)$/.test(getComputedStyle(element).display);
    if (blockDisplay(before) || blockDisplay(after)) return true;
    if (!headingLike) return false;
    const beforeSize = parseFloat(getComputedStyle(previous.parentElement).fontSize);
    const afterSize = parseFloat(getComputedStyle(current.parentElement).fontSize);
    return beforeSize > 0 && afterSize > 0 && Math.max(beforeSize, afterSize) / Math.min(beforeSize, afterSize) >= 1.25;
  }

  function needsTextSeparator(left, right) {
    if (!left || !right) return false;
    const last = left[left.length - 1];
    const first = right[0];
    if (/\s|[(\[{/\-]/.test(last) || /[\s,.;:!?%)\]}]/.test(first)) return false;
    return true;
  }

  function isSentenceBoundary(text, index) {
    const mark = text[index];
    if (mark !== ".") return /[!?。！？\n]/.test(mark || "");

    // A point inside a decimal, version, dotted abbreviation, URL or email
    // is not a full stop. Keep source characters and offsets unchanged.
    const before = text[index - 1] || "";
    const after = text[index + 1] || "";
    if (/[0-9]/.test(before) && /[0-9]/.test(after)) return false;
    if (/[0-9]/.test(after) && (!before || /[\s(+$€£-]/.test(before))) return false;
    if (/[A-Za-z0-9]/.test(before) && /[A-Za-z0-9]/.test(after)) {
      const left = text.slice(0, index).match(/[^\s"'<>()[\]{}]+$/)?.[0] || "";
      const right = text.slice(index + 1).match(/^[^\s"'<>()[\]{}]+/)?.[0] || "";
      const dottedToken = `${left}.${right}`;
      if (/^(?:[A-Za-z]\.){2,}[,;:!?]?$/.test(dottedToken)) return false;
      if (/(?:^https?:\/\/|^www\.|@)/i.test(dottedToken)) return false;
      if (/^(?:[A-Za-z0-9-]+\.)+(?:com|org|net|edu|gov|io|ai|co|uk|de|fr|jp|cn|dev|app|info|tech)\b/i.test(dottedToken)) return false;
    }
    if (after === ".") return false; // An ellipsis ends at its last dot.

    const following = text.slice(index + 1);
    // Do not let an abbreviation swallow a separate visual block.
    if (/^[\t \r"'”’)\]]*\n/.test(following)) return true;
    const next = following.match(/^[\t \r]*(?:["'”’\)\]]\s*)*([A-Za-z0-9])/);
    if (!next) return true;
    const token = text.slice(Math.max(0, index - 40), index + 1)
      .match(/(?:^|[^A-Za-z.])([A-Za-z][A-Za-z.]*\.)$/)?.[1] || "";

    // These abbreviations introduce a name, explanation or numbered reference.
    if (/^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|cf|e\.g|i\.e)\.$/i.test(token)) return false;
    if (/^(?:Fig|Figs|Eq|Eqs|Sec|Secs|Ch|Chap|No|Vol|pp|p)\.$/i.test(token) && /[0-9]/.test(next[1])) return false;
    if (/^[A-HJ-Z]\.$/.test(token) && /[A-Z]/.test(next[1])) return false;
    // Acronyms and time abbreviations may also finish a sentence. Only merge
    // their final point when the next word clearly continues in lower case.
    if ((/^(?:[A-Za-z]\.){2,}$/.test(token) || /^etc\.$/i.test(token)) && /[a-z0-9]/.test(next[1])) return false;
    return true;
  }

  function sentenceAtOffset(text, offset) {
    let start = Math.max(0, Math.min(offset, text.length));
    let end = start;
    while (start > 0 && !isSentenceBoundary(text, start - 1)) start -= 1;
    while (end < text.length && !isSentenceBoundary(text, end)) end += 1;
    if (end < text.length && /[.!?。！？]/.test(text[end])) end += 1;
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    const raw = text.slice(start, end);
    const rawOffset = Math.max(0, Math.min(raw.length, offset - start));
    return {
      start,
      end,
      text: rules.normalizeText(raw),
      offset: rules.normalizeText(raw.slice(0, rawOffset)).length
    };
  }

  function locateTargetRange(context, target, approximateOffset = -1) {
    const sentence = String(context || "");
    const wanted = String(target || "").trim();
    if (!sentence || !wanted) return { targetStart: -1, targetEnd: -1 };
    const matches = [];
    const pattern = new RegExp(`(^|[^\\p{Script=Latin}\\p{M}0-9'’])(${escapeRegExp(wanted)})(?=$|[^\\p{Script=Latin}\\p{M}0-9'’])`, "giu");
    let match;
    while ((match = pattern.exec(sentence))) {
      const start = match.index + match[1].length;
      matches.push({ targetStart: start, targetEnd: start + match[2].length });
      if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
    }
    if (!matches.length) {
      const start = sentence.toLowerCase().indexOf(wanted.toLowerCase());
      return { targetStart: start, targetEnd: start < 0 ? -1 : start + wanted.length };
    }
    if (!Number.isFinite(approximateOffset) || approximateOffset < 0) return matches[0];
    return matches.sort((left, right) =>
      Math.abs(left.targetStart - approximateOffset) - Math.abs(right.targetStart - approximateOffset)
    )[0];
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
})();
