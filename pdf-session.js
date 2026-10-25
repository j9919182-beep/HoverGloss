(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossPdfSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function progressKey(fingerprint) {
    return typeof fingerprint === "string" && /^[a-z\d]{8,128}$/i.test(fingerprint)
      ? `pdfProgress:${fingerprint.toLowerCase()}` : null;
  }

  function readProgress(saved, total) {
    if (!saved || saved.version !== 1 || !Number.isInteger(total) || total < 1 ||
        !Number.isInteger(saved.page) || saved.page < 1 || saved.page > total) return null;
    return {
      page: saved.page,
      scale: Number.isFinite(saved.scale) && saved.scale >= 0.6 && saved.scale <= 1.8
        ? saved.scale : 1
    };
  }

  function progressRecord(page, scale) {
    return { version: 1, page, scale, updatedAt: Date.now() };
  }

  return { progressKey, readProgress, progressRecord };
});
