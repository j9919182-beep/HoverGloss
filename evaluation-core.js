(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossEvaluationCore = api;
})(globalThis, function () {
  "use strict";
  const clean = (value) => String(value || "").replace(/\s+/g, "").replace(/[。，！!？?；;：:]/g, "").toLowerCase();
  function snapshot(result) {
    const names = ["translation", "isolatedTranslation", "sentenceTranslation", "source", "phrase",
      "phraseTranslation", "alignedChineseSpan", "confidence", "contextReview", "evidenceSource", "evidenceIssues"];
    return Object.fromEntries(names.filter((name) => result[name] !== undefined).map((name) => [name, result[name]]));
  }
  function assess(item, result) {
    const phraseOnly = result.contextReview === "phrase-only" ||
      (result.phrase && result.phrase.toLowerCase() !== item.target.toLowerCase() &&
        result.phraseTranslation && clean(result.translation) === clean(result.phraseTranslation));
    const phraseMatch = Boolean(item.expected.phrase && clean(result.phrase) === clean(item.expected.phrase) &&
      item.expected.phraseMeanings.some((meaning) => clean(meaning) === clean(result.phraseTranslation)));
    const wordMatch = !phraseOnly && item.expected.words.some((meaning) => clean(meaning) === clean(result.translation));
    const confirmed = result.contextReview === "aligned" || Number.isFinite(result.confidence) && result.confidence >= 0.7;
    return { suggestion: wordMatch ? "word-match" : phraseMatch ? "phrase-match" : confirmed ? "mismatch" : "pending",
      wordMatch, phraseMatch, phraseOnly, confirmed };
  }
  async function runCase(item, dependencies) {
    const start = dependencies.now ? dependencies.now() : performance.now();
    const raw = await dependencies.translate({ target: item.target, context: item.context, kind: "word" });
    const candidates = dependencies.candidates(item.target, item.context, item.topic, item.targetStart, item.targetEnd);
    const initial = dependencies.refine(raw, { target: item.target, context: item.context,
      targetStart: item.targetStart, targetEnd: item.targetEnd, candidates });
    let result = initial;
    const needsReview = !Number.isFinite(result.confidence) || result.confidence < 0.7;
    if (needsReview && dependencies.align && result.sentenceTranslation) {
      const alignment = await dependencies.align({ context: item.context, targetStart: item.targetStart,
        targetEnd: item.targetEnd, result });
      result = alignment?.ok && alignment.result ? alignment.result : { ...result, contextReview: "unavailable" };
      if (result.contextReview === "unresolved" && Array.isArray(alignment?.phraseCandidates)) {
        for (const phrase of alignment.phraseCandidates.slice(0, 3)) {
          try {
            const translated = await dependencies.translate({ target: phrase, kind: "sentence" });
            result = dependencies.applyPhrase(result, phrase, translated.translation);
            if (result.contextReview === "phrase-only") break;
          } catch { break; }
        }
      }
    } else if (needsReview) result = { ...result, contextReview: result.sentenceTranslation ? "not-enabled" : "no-sentence" };
    const end = dependencies.now ? dependencies.now() : performance.now();
    return { id: item.id, raw: snapshot(raw), initial: snapshot(initial), result: snapshot(result),
      elapsedMs: Math.round(end - start), assessment: assess(item, result),
      review: { sentence: "", word: "", phrase: "", cause: "", note: "" } };
  }
  function summarize(records) {
    const valid = records.filter((record) => !record.error);
    const reviewed = valid.filter((record) => ["correct", "wrong"].includes(record.review?.word));
    return { completed: records.length, errors: records.length - valid.length,
      referenceMatches: valid.filter((record) => ["word-match", "phrase-match"].includes(record.assessment?.suggestion)).length,
      reviewedWords: reviewed.length, correctWords: reviewed.filter((record) => record.review.word === "correct").length,
      phraseOnly: valid.filter((record) => record.review?.word === "phrase-only").length,
      reviewedSentences: valid.filter((record) => ["correct", "wrong"].includes(record.review?.sentence)).length,
      wrongSentences: valid.filter((record) => record.review?.sentence === "wrong").length };
  }
  return { runCase, assess, summarize };
});
