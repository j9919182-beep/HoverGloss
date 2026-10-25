(function (root, factory) {
  const api = factory(root.HoverGlossLiveCaptions || (typeof require === "function" ? require("./live-captions-core.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossCaptionSites = api;
})(globalThis, function (core) {
  "use strict";
  const youtube = { name: "YouTube", platform: "youtube", player: "#movie_player",
    text: [".ytp-caption-window-container .ytp-caption-segment"], native: ".ytp-caption-window-container", defaultMode: "below" };
  const bilibili = { name: "B站", platform: "bilibili",
    player: "#bilibili-player .bpx-player-container, .bpx-player-container, #bilibili-player .bilibili-player-video-wrap, #bilibili-player",
    text: [".bpx-player-subtitle-panel-text", ".bilibili-player-video-subtitle span", ".bilibili-player-video-subtitle"],
    native: ".bpx-player-subtitle-wrap, .bpx-player-subtitle-panel, .bilibili-player-video-subtitle", defaultMode: "bilingual" };
  function forURL(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return null;
      if (["www.bilibili.com", "bilibili.com"].includes(url.hostname)) return bilibili;
      if (["www.youtube.com", "youtube.com"].includes(url.hostname)) return youtube;
    } catch { /* Unsupported page. */ }
    return null;
  }
  function player(document, site) {
    if (!site) return null;
    // querySelector with a comma list returns document order, not selector
    // priority: the outer fallback could otherwise win over the positioned root.
    let node = null;
    for (const selector of site.player.split(",")) {
      node = document.querySelector(selector.trim()); if (node) break;
    }
    const full = document.fullscreenElement;
    // Some player versions fullscreen an inner video area, not the outer root.
    return node && full && node.contains?.(full) && full.querySelector?.("video") ? full : node;
  }
  function segments(node, site) {
    for (const selector of site.text) {
      const found = [...node.querySelectorAll(selector)];
      if (found.length) return found;
    }
    return [];
  }
  return { forURL, player, segments };
});
