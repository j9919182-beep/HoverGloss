(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConciseHoverRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COMMON_WORDS = new Set([
    "a", "an", "the", "and", "or", "but", "if", "then", "than", "as", "at",
    "by", "for", "from", "in", "into", "of", "on", "to", "up", "with", "is",
    "am", "are", "was", "were", "be", "been", "being", "do", "does", "did",
    "have", "has", "had", "it", "its", "this", "that", "these", "those", "he",
    "she", "they", "we", "you", "i", "me", "my", "our", "your", "their"
  ]);

  const BLOCKED_SELECTOR = [
    "code", "pre", "kbd", "samp", "input", "textarea", "select", "button",
    "[contenteditable='true']", "[contenteditable='']", ".notranslate",
    "[translate='no']", "[data-concise-hover-ignore]"
  ].join(",");

  function normalizeText(value) {
    return String(value || "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isEnglishTarget(value) {
    const text = normalizeText(value);
    if (!text || text.length < 2 || text.length > 80) return false;
    if (/https?:\/\/|www\.|\S+@\S+\.\S+/.test(text)) return false;
    if (/\d{4,}/.test(text)) return false;
    return /^[A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,5}$/.test(text);
  }

  function shouldSkipTarget(value, options = {}) {
    const text = normalizeText(value);
    const french = options.sourceLanguage === "fr";
    if (french ? text.length < 2 || text.length > 80 || !/^[\p{Script=Latin}][\p{Script=Latin}\p{M}'-]*(?:\s+[\p{Script=Latin}][\p{Script=Latin}\p{M}'-]*){0,5}$/u.test(text) : !isEnglishTarget(text)) return true;
    const lower = text.toLowerCase();
    const common = french ? new Set(["le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "à", "au", "aux", "en", "est", "ce", "ces", "je", "tu", "il", "elle", "nous", "vous", "ils", "elles"]) : COMMON_WORDS;
    if (options.skipCommonWords !== false && !text.includes(" ") && common.has(lower)) return true;
    if (options.skipAcronyms !== false && /^[A-Z]{2,5}$/.test(text)) return true;
    return false;
  }

  function isSentenceTarget(value) {
    const text = normalizeText(value);
    if (!text || text.length < 6 || text.length > 500) return false;
    if (/https?:\/\/|www\.|\S+@\S+\.\S+/.test(text)) return false;
    const englishWords = text.match(/[\p{Script=Latin}][\p{Script=Latin}\p{M}'’-]*/gu) || [];
    if (englishWords.length < 2 || englishWords.length > 100) return false;
    const letterCount = (text.match(/[\p{Script=Latin}]/gu) || []).length;
    const visibleCount = text.replace(/\s/g, "").length || 1;
    return letterCount / visibleCount >= 0.45;
  }

  function normalizePassage(value) {
    return String(value || "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function isPassageTarget(value) {
    const text = normalizePassage(value);
    if (!text || text.length < 6 || text.length > 3000) return false;
    if (/^(?:https?:\/\/|www\.|\S+@\S+\.\S+$)/.test(text)) return false;
    const englishWords = text.match(/[\p{Script=Latin}][\p{Script=Latin}\p{M}'’-]*/gu) || [];
    if (englishWords.length < 2 || englishWords.length > 500) return false;
    const letterCount = (text.match(/[\p{Script=Latin}]/gu) || []).length;
    const visibleCount = text.replace(/\s/g, "").length || 1;
    return letterCount / visibleCount >= 0.35;
  }

  function isBlockedElement(element) {
    return Boolean(element && element.closest && element.closest(BLOCKED_SELECTOR));
  }

  function compactContext(text, target, maxLength = 220) {
    const clean = normalizeText(text);
    if (!clean) return "";
    const lower = clean.toLowerCase();
    const needle = normalizeText(target).toLowerCase();
    const index = lower.indexOf(needle);
    if (index < 0) return clean.slice(0, maxLength);
    const half = Math.floor((maxLength - needle.length) / 2);
    const start = Math.max(0, index - half);
    return clean.slice(start, start + maxLength).trim();
  }

  function cleanTranslation(value, isPhrase = false) {
    let text = normalizeText(value)
      .replace(/^['"“”]+|['"“”]+$/g, "")
      .replace(/^(翻译|译文|中文)\s*[:：]\s*/i, "")
      .replace(/\s*\([^)]{18,}\)\s*$/g, "")
      .trim();
    const limit = isPhrase ? 32 : 16;
    const first = text.split(/[；;\n]|\s{2,}/)[0].trim();
    text = first || text;
    if (text.length > limit) text = text.slice(0, limit).replace(/[，、,:：\s]+$/g, "") + "…";
    return text;
  }

  function cleanSentenceTranslation(value) {
    let text = normalizeText(value)
      .replace(/^['"“”]+|['"“”]+$/g, "")
      .replace(/^(翻译|译文|中文)\s*[:：]\s*/i, "")
      .trim();
    if (text.length > 220) text = text.slice(0, 220).replace(/[，、,:：\s]+$/g, "") + "…";
    return text;
  }

  function cleanPassageTranslation(value) {
    let text = normalizePassage(value)
      .replace(/^['"“”]+|['"“”]+$/g, "")
      .replace(/^(翻译|译文|中文)\s*[:：]\s*/i, "")
      .trim();
    if (text.length > 2200) text = text.slice(0, 2200).replace(/[，、,:：\s]+$/g, "") + "…";
    return text;
  }

  return {
    COMMON_WORDS,
    BLOCKED_SELECTOR,
    normalizeText,
    isEnglishTarget,
    isSentenceTarget,
    normalizePassage,
    isPassageTarget,
    shouldSkipTarget,
    isBlockedElement,
    compactContext,
    cleanTranslation,
    cleanSentenceTranslation,
    cleanPassageTranslation
  };
});
