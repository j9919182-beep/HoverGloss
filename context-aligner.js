(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossContextAligner = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function uniqueCandidates(candidates = [], isolatedTranslation = "") {
    const values = [...candidates];
    if (clean(isolatedTranslation)) {
      values.push({ translation: clean(isolatedTranslation), source: "browser-isolated", matched: false });
    }
    const byTranslation = new Map();
    for (const item of values) {
      const translation = clean(item?.translation);
      if (!translation) continue;
      const key = translation.toLowerCase();
      const candidate = {
        translation,
        source: clean(item.source) || "candidate",
        phrase: clean(item.phrase),
        phraseTranslation: clean(item.phraseTranslation),
        pos: clean(item.pos || item.note),
        matched: item.matched === true
      };
      const previous = byTranslation.get(key);
      if (!previous || baseScore(candidate) + Number(candidate.matched) * 18 > baseScore(previous) + Number(previous.matched) * 18) {
        byTranslation.set(key, candidate);
      }
    }
    return [...byTranslation.values()];
  }

  function alignedSpan(sentenceTranslation, translation) {
    const sentence = clean(sentenceTranslation);
    const value = clean(translation);
    if (!sentence || !value) return "";
    if (sentence.includes(value)) return value;
    const compactSentence = sentence.replace(/\s+/g, "");
    const compactValue = value.replace(/\s+/g, "");
    return compactValue && compactSentence.includes(compactValue) ? value : "";
  }

  function baseScore(candidate) {
    if (candidate.source === "phrase") return 72;
    if (candidate.source === "contextual") return 58;
    if (/^stored:(?:confirmed|manual)/.test(candidate.source)) return 54;
    if (/^topic:/.test(candidate.source) || /^stored:/.test(candidate.source)) return 38;
    if (candidate.source === "local") return 28;
    if (candidate.source === "contextual-candidate") return 20;
    if (candidate.source === "browser-isolated") return 24;
    return 18;
  }

  function scoreCandidate(candidate, sentenceTranslation) {
    const aligned = alignedSpan(sentenceTranslation, candidate.translation);
    let score = baseScore(candidate);
    if (candidate.matched) score += 18;
    if (aligned) score += candidate.translation.length === 1 ? 28 : 52;
    else if (clean(sentenceTranslation)) score -= 40;
    if (candidate.phrase) score += 10;
    return { ...candidate, aligned, score };
  }

  function confidenceFor(best, runnerUp) {
    let confidence = 0.5;
    if (best.aligned && best.translation.length === 1 && !best.matched) confidence = 0.62;
    else if (best.aligned && best.source === "phrase") confidence = 0.96;
    else if (best.aligned && best.matched) confidence = 0.93;
    else if (best.aligned) confidence = 0.84;
    else if (best.source === "phrase") confidence = 0.84;
    else if (best.matched) confidence = 0.76;
    else if (best.source === "browser-isolated") confidence = 0.56;
    else confidence = 0.62;
    if (runnerUp && best.score - runnerUp.score < 8) confidence -= 0.12;
    return Math.max(0.35, Math.min(0.98, Number(confidence.toFixed(2))));
  }

  function refine(browserResult = {}, options = {}) {
    const sentenceTranslation = clean(browserResult.sentenceTranslation);
    const isolatedTranslation = clean(browserResult.isolatedTranslation || browserResult.translation);
    const candidates = uniqueCandidates(options.candidates, isolatedTranslation);
    if (!candidates.length) return { ...browserResult, isolatedTranslation, confidence: browserResult.confidence ?? null };

    const ranked = candidates
      .map((candidate) => scoreCandidate(candidate, sentenceTranslation))
      .sort((left, right) => right.score - left.score || Number(right.source === "browser-isolated") - Number(left.source === "browser-isolated"));
    const best = ranked[0];
    const phrase = best.phrase || clean(browserResult.phrase) || clean(options.target);
    const phraseOnly = best.source === "phrase" && best.phraseTranslation === best.translation &&
      phrase.toLowerCase() !== clean(options.target).toLowerCase();
    const alternatives = ranked
      .slice(1)
      .filter((item) => item.translation !== best.translation)
      .slice(0, 2)
      .map((item) => item.translation);
    const evidenceIssues = [];
    let confidence = confidenceFor(best, ranked[1]);
    if (sentenceTranslation && !best.aligned) {
      evidenceIssues.push("not-in-sentence");
      confidence = Math.min(confidence, 0.62);
    }
    if (best.aligned && best.source !== "phrase" && ranked.some((item) =>
      item.translation !== best.translation && item.aligned)) {
      evidenceIssues.push("multiple-meanings-in-sentence");
      confidence = Math.min(confidence, 0.66);
    }

    return {
      ...browserResult,
      isolatedTranslation,
      translation: best.translation,
      pos: best.pos || clean(browserResult.pos),
      source: best.source === "browser-isolated" ? "browser" : "browser-context",
      evidenceSource: best.source,
      phrase,
      phraseTranslation: best.phraseTranslation || "",
      sentenceTranslation,
      alignedChineseSpan: phraseOnly ? "" : best.aligned,
      ...(phraseOnly ? { contextReview: "phrase-only" } : {}),
      confidence,
      evidenceIssues,
      alternatives: confidence < 0.7 ? alternatives : []
    };
  }

  return { refine, alignedSpan, uniqueCandidates };
});
