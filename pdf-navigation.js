(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossPdfNavigation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function parsePageNumber(value, pageCount) {
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) return null;
    const page = Number(text);
    return Number.isSafeInteger(page) && page >= 1 && page <= pageCount ? page : null;
  }

  async function resolveDestinationPage(document, destination) {
    const explicit = typeof destination === "string"
      ? await document.getDestination(destination)
      : destination;
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const ref = explicit[0];
    const zeroBased = Number.isInteger(ref) ? ref : await document.getPageIndex(ref);
    const page = zeroBased + 1;
    return Number.isSafeInteger(page) && page >= 1 && page <= document.numPages ? page : null;
  }

  function pageArrowDelta(event, selectionText = "") {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || selectionText) return 0;
    if (event.target?.isContentEditable || event.target?.closest?.("input, textarea, select, [contenteditable], [role='textbox'], #concise-hover-translator")) return 0;
    if (event.key === "ArrowLeft") return -1;
    if (event.key === "ArrowRight") return 1;
    return 0;
  }

  return { parsePageNumber, resolveDestinationPage, pageArrowDelta };
});
