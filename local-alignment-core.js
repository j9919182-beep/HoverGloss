(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossLocalAlignmentCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function focusContext(context, targetStart, targetEnd, limit = 400) {
    const text = String(context || "");
    if (!Number.isInteger(targetStart) || !Number.isInteger(targetEnd) || targetStart < 0 || targetEnd <= targetStart || targetEnd > text.length) return null;
    if (text.length <= limit) return { context: text, targetStart, targetEnd };
    const size = Math.max(limit, targetEnd - targetStart);
    let start = Math.max(0, Math.min(text.length - size, targetStart - Math.floor((size - (targetEnd - targetStart)) / 2)));
    let end = Math.min(text.length, start + size);
    // Trim partial neighbouring words while always keeping the selected occurrence.
    while (start < targetStart && start > 0 && /[\p{L}\p{M}\p{N}]/u.test(text[start - 1]) && /[\p{L}\p{M}\p{N}]/u.test(text[start])) start++;
    while (end > targetEnd && end < text.length && /[\p{L}\p{M}\p{N}]/u.test(text[end - 1]) && /[\p{L}\p{M}\p{N}]/u.test(text[end])) end--;
    return { context: text.slice(start, end), targetStart: targetStart - start, targetEnd: targetEnd - start };
  }

  function tokenRange(tokenizer, text, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) return null;
    const first = tokenizer.tokenize(text.slice(0, start)).length + 1; // [CLS]
    const last = tokenizer.tokenize(text.slice(0, end)).length + 1;
    return last > first ? { first, last } : null;
  }

  function hanUnits(text, tokenizer) {
    return [...text.matchAll(/\p{Script=Han}/gu)]
      .map((match) => ({
        text: match[0], start: match.index, end: match.index + match[0].length,
        range: tokenRange(tokenizer, text, match.index, match.index + match[0].length)
      }))
      .filter((unit) => unit.range);
  }

  const BOUNDARY_WORDS = new Set([
    "a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their",
    "i", "you", "he", "she", "it", "we", "they", "is", "are", "was", "were", "be", "been", "being",
    "and", "or", "but", "of", "for", "to", "with", "in", "on", "at", "by", "from", "as"
  ]);
  const PHRASE_ENDINGS = new Set(["of", "for", "to", "with", "up", "out", "in", "on", "off", "by"]);

  function nearbyPhrases(text, targetStart, targetEnd) {
    const words = [...text.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)]
      .map((match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
    const index = words.findIndex((word) => word.start <= targetStart && word.end >= targetEnd);
    if (index < 0) return [];
    const candidates = [];
    for (const length of [2, 3]) {
      for (let first = Math.max(0, index - length + 1); first <= index; first++) {
        const part = words.slice(first, first + length);
        if (part.length !== length || part.some((word, position) => position > 0 &&
            !/^\s+$/.test(text.slice(part[position - 1].end, word.start)))) continue;
        const content = part.filter((word) => word.text.length >= 2 && !BOUNDARY_WORDS.has(word.text.toLowerCase()));
        const collocation = length === 3 && first + 1 === index && content.length === 2 &&
          PHRASE_ENDINGS.has(part[2].text.toLowerCase()) && content[0] === part[0] && content[1] === part[1];
        if (!collocation && content.length !== length) continue;
        const name = !collocation && part.every((word) => /^[A-Z]/.test(word.text));
        candidates.push({
          text: text.slice(part[0].start, part.at(-1).end), start: part[0].start, end: part.at(-1).end,
          words: content, kind: collocation ? "collocation" : name ? "name" : "adjacent",
          targetAtPhraseStart: first === index, targetAtPhraseEnd: first + length - 1 === index
        });
      }
    }
    return candidates;
  }

  function cosine(left, right, leftIndex, rightIndex) {
    const width = left.dims[2];
    let dot = 0, leftNorm = 0, rightNorm = 0;
    for (let i = 0; i < width; i++) {
      const a = left.data[leftIndex * width + i];
      const b = right.data[rightIndex * width + i];
      dot += a * b;
      leftNorm += a * a;
      rightNorm += b * b;
    }
    return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
  }

  function choose({ sourceText, targetText, targetStart, targetEnd, tokenizer, sourceVectors, targetVectors }) {
    const sourceRange = tokenRange(tokenizer, sourceText, targetStart, targetEnd);
    if (!sourceRange || !sourceVectors?.dims || !targetVectors?.dims) return null;
    const sourceLength = sourceVectors.dims[1];
    const targetLength = targetVectors.dims[1];
    if (sourceRange.last > sourceLength - 1 || targetLength < 3) return null;
    const similarity = Array.from({ length: sourceLength }, () => new Float32Array(targetLength));
    for (let s = 1; s < sourceLength - 1; s++) {
      for (let t = 1; t < targetLength - 1; t++) {
        similarity[s][t] = cosine(sourceVectors, targetVectors, s, t);
      }
    }
    const units = hanUnits(targetText, tokenizer)
      .filter((unit) => unit.range.last <= targetLength - 1)
      .map((unit) => {
        let owner = -1, ownerScore = -Infinity, wordScore = -Infinity;
        for (let t = unit.range.first; t < unit.range.last; t++) {
          for (let s = 1; s < sourceLength - 1; s++) {
            const value = similarity[s][t];
            if (value > ownerScore) { ownerScore = value; owner = s; }
            if (s >= sourceRange.first && s < sourceRange.last) wordScore = Math.max(wordScore, value);
          }
        }
        return { ...unit, owner, ownerScore, wordScore,
          wordOwned: owner >= sourceRange.first && owner < sourceRange.last };
      });
    if (!units.length) return null;
    const wordAnchors = units.filter((unit) => unit.wordOwned && unit.wordScore >= 0.38);
    const anchor = wordAnchors.sort((left, right) => right.wordScore - left.wordScore)[0];
    let first = -1, last = -1;
    if (anchor) {
      first = last = units.indexOf(anchor);
      const threshold = Math.max(0.38, anchor.wordScore - 0.12);
      while (first > 0 && units[first - 1].end === units[first].start &&
        units[first - 1].wordOwned && units[first - 1].wordScore >= threshold) first -= 1;
      while (last + 1 < units.length && units[last].end === units[last + 1].start &&
        units[last + 1].wordOwned && units[last + 1].wordScore >= threshold) last += 1;
    }
    const span = first >= 0 ? targetText.slice(units[first].start, units[last].end) : "";
    let competingScore = -Infinity;
    units.forEach((unit, index) => {
      if (index < first || index > last) competingScore = Math.max(competingScore, unit.wordScore);
    });
    const score = first >= 0 ? Math.min(...units.slice(first, last + 1).map((unit) => unit.wordScore)) : 0;
    const margin = Number.isFinite(competingScore) ? score - competingScore : 0;
    let mutual = false;
    if (anchor) {
      for (let s = sourceRange.first; s < sourceRange.last && !mutual; s++) {
        let bestTarget = -1, bestScore = -Infinity;
        for (let t = 1; t < targetLength - 1; t++) {
          const value = similarity[s][t];
          if (value > bestScore) { bestScore = value; bestTarget = t; }
        }
        mutual = units.slice(first, last + 1).some((unit) => bestTarget >= unit.range.first && bestTarget < unit.range.last);
      }
    }
    let bestPhrase = null;
    for (const phrase of nearbyPhrases(sourceText, targetStart, targetEnd)) {
      const phraseRange = tokenRange(tokenizer, sourceText, phrase.start, phrase.end);
      if (!phraseRange || phraseRange.last > sourceLength - 1) continue;
      const owned = (unit) => unit.owner >= phraseRange.first && unit.owner < phraseRange.last && unit.ownerScore >= 0.38;
      const phraseAnchor = anchor && owned(anchor) ? anchor : units.find(owned);
      if (!phraseAnchor) continue;
      let left = units.indexOf(phraseAnchor), right = left;
      while (left > 0 && units[left - 1].end === units[left].start && owned(units[left - 1])) left -= 1;
      while (right + 1 < units.length && units[right].end === units[right + 1].start && owned(units[right + 1])) right += 1;
      const phraseUnits = units.slice(left, right + 1);
      const phraseTranslation = targetText.slice(phraseUnits[0].start, phraseUnits.at(-1).end);
      if (phraseTranslation.length < 2 || phraseTranslation.length > 16 ||
          (span && !phraseTranslation.includes(span))) continue;
      // An ordinary adjacent pair needs evidence from both words, not merely a nearby translated word.
      const supportedWords = phrase.words.filter((word) => {
        const range = tokenRange(tokenizer, sourceText, word.start, word.end);
        if (!range) return false;
        for (let s = range.first; s < range.last; s++) {
          let bestTarget = -1, bestScore = -Infinity;
          for (let t = 1; t < targetLength - 1; t++) {
            if (similarity[s][t] > bestScore) { bestScore = similarity[s][t]; bestTarget = t; }
          }
          if (bestScore >= 0.38 && phraseUnits.some((unit) =>
            bestTarget >= unit.range.first && bestTarget < unit.range.last)) return true;
        }
        return false;
      }).length;
      if (phrase.kind === "adjacent" && supportedWords < phrase.words.length) continue;
      const phraseScore = Math.min(...phraseUnits.map((unit) => unit.ownerScore));
      const rank = phraseScore + 0.04 * supportedWords - 0.015 * phraseTranslation.length -
        0.05 * (phrase.words.length - 2) + (phrase.kind === "name" ? 0.04 : 0);
      if (!bestPhrase || rank > bestPhrase.rank) bestPhrase = { phrase, phraseTranslation, phraseScore, rank };
    }
    return span || bestPhrase
      ? { span, score, margin, mutual, phrase: bestPhrase?.phrase.text || "",
          phraseTranslation: bestPhrase?.phraseTranslation || "", phraseScore: bestPhrase?.phraseScore || 0,
          phraseKind: bestPhrase?.phrase.kind || "", targetAtPhraseStart: bestPhrase?.phrase.targetAtPhraseStart || false,
          targetAtPhraseEnd: bestPhrase?.phrase.targetAtPhraseEnd || false }
      : null;
  }

  function reliable(alignment, result) {
    const span = String(alignment?.span || "").trim();
    if (!span || !result?.sentenceTranslation?.includes(span) || !alignment.mutual) return false;
    if (!/^[\p{Script=Han}]{1,12}$/u.test(span)) return false;
    if (/^(?:的|了|在|是|有|和|与|或|也|都|就|将|会|被|把|个|一|这|那|其|它)$/u.test(span)) return false;
    // If two or more English words jointly map to this whole Chinese span, it is not a proven word-level gloss.
    if (alignment.phrase && alignment.phraseTranslation === span) return false;
    const corroborated = result.alignedChineseSpan === span || result.translation === span;
    if (alignment.phraseTranslation && !corroborated) {
      if (alignment.phraseKind === "collocation") return false;
      if (span.length === 1) return false;
      if (alignment.targetAtPhraseStart && !alignment.phraseTranslation.startsWith(span)) return false;
      if (alignment.targetAtPhraseEnd && !alignment.phraseTranslation.endsWith(span)) return false;
    }
    const minScore = span.length === 1 ? 0.65 : corroborated ? 0.45 : 0.5;
    const minMargin = span.length === 1 ? 0.15 : corroborated ? 0.05 : 0.08;
    return Number.isFinite(alignment.score) && alignment.score >= minScore &&
      Number.isFinite(alignment.margin) && alignment.margin >= minMargin;
  }

  function apply(result, alignment) {
    if (Number.isFinite(result.confidence) && result.confidence >= 0.7) return result;
    const phraseTranslation = String(alignment?.phraseTranslation || "");
    const phraseSupported = alignment?.phrase && phraseTranslation.length >= 2 &&
      result?.sentenceTranslation?.includes(phraseTranslation) && alignment.phraseScore >= 0.5;
    if (reliable(alignment, result)) {
      return {
        ...result,
        translation: alignment.span,
        alignedChineseSpan: alignment.span,
        phrase: phraseSupported ? alignment.phrase : result.phrase,
        phraseTranslation: phraseSupported ? phraseTranslation : result.phraseTranslation,
        source: "browser-local-align",
        evidenceSource: "local-alignment",
        alignmentMethod: "awesome-align-local",
        contextReview: "aligned",
        alternatives: result.translation !== alignment.span ? [result.translation, ...(result.alternatives || [])].slice(0, 2) : result.alternatives || []
      };
    }
    if (phraseSupported && (phraseTranslation === alignment.span || phraseTranslation === result.translation ||
        !result.sentenceTranslation.includes(result.translation))) {
      return {
        ...result,
        translation: phraseTranslation,
        phrase: alignment.phrase,
        phraseTranslation,
        alignedChineseSpan: "",
        source: "browser-phrase-align",
        evidenceSource: "phrase-alignment",
        alignmentMethod: "awesome-align-local",
        contextReview: "phrase-only",
        unconfirmedTranslation: result.translation,
        alternatives: []
      };
    }
    return { ...result, contextReview: "unresolved" };
  }

  function applyPhraseTranslation(result, phrase, translatedPhrase) {
    if (result?.contextReview !== "unresolved" || !phrase || !result.sentenceTranslation) return result;
    const translation = String(translatedPhrase || "").replace(/\s+/g, "").replace(/^[“"'（(]+|[”"'）)。，！!?？]+$/g, "");
    const sentence = String(result.sentenceTranslation).replace(/\s+/g, "");
    if (!/^[\p{Script=Han}]{2,16}$/u.test(translation) ||
        sentence.indexOf(translation) < 0 || sentence.indexOf(translation) !== sentence.lastIndexOf(translation)) return result;
    return {
      ...result,
      translation,
      phrase,
      phraseTranslation: translation,
      alignedChineseSpan: "",
      source: "browser-phrase-context",
      evidenceSource: "local-phrase-translation",
      contextReview: "phrase-only",
      unconfirmedTranslation: result.unconfirmedTranslation || result.translation,
      alternatives: []
    };
  }

  return { focusContext, tokenRange, nearbyPhrases, choose, reliable, apply, applyPhraseTranslation };
});
