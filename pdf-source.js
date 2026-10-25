(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossPdfSource = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_PDF_BYTES = 60 * 1024 * 1024;

  function isPdfPage(value) {
    try {
      const url = new URL(value);
      return ["https:", "http:", "file:"].includes(url.protocol) && /\.pdf$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function isAllowedRemoteUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function hasPdfHeader(bytes) {
    if (!(bytes instanceof Uint8Array)) return false;
    const limit = Math.min(bytes.length - 4, 1024);
    for (let i = 0; i < limit; i += 1) {
      if (bytes[i] === 37 && bytes[i + 1] === 80 && bytes[i + 2] === 68 && bytes[i + 3] === 70 && bytes[i + 4] === 45) return true;
    }
    return false;
  }

  return { MAX_PDF_BYTES, isPdfPage, isAllowedRemoteUrl, hasPdfHeader };
});
