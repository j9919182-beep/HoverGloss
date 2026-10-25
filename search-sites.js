(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossSearchSites = api;
})(globalThis, function () {
  "use strict";
  const GOOGLE = ["google.com", "google.com.hk", "google.co.uk", "google.co.jp", "google.ca", "google.com.au", "google.de", "google.fr", "google.co.in", "google.com.sg"];
  function siteFor(hostname) {
    const host = String(hostname || "").toLowerCase();
    let id, label;
    if (["youtube.com", "www.youtube.com"].includes(host)) { id = "youtube"; label = "YouTube"; }
    else if (GOOGLE.some((domain) => host === domain || host === "www." + domain)) { id = "google"; label = "Google"; }
    else if (["bing.com", "www.bing.com", "cn.bing.com"].includes(host)) { id = "bing"; label = "Bing"; }
    else if (["reddit.com", "www.reddit.com", "old.reddit.com"].includes(host)) { id = "reddit"; label = "Reddit"; }
    else if (host === "github.com") { id = "github"; label = "GitHub"; }
    else if (["stackoverflow.com", "www.stackoverflow.com"].includes(host)) { id = "stackoverflow"; label = "Stack Overflow"; }
    else if (host === "wikipedia.org" || /^(?:www|[a-z]{2,3}(?:-[a-z]+)*)\.wikipedia\.org$/.test(host)) { id = "wikipedia"; label = "Wikipedia"; }
    if (!id) return null;
    return {
      id, label,
      enabledKey: id === "youtube" ? "youtubeSearchEnabled" : "englishSearch_" + id + "_enabled",
      autoKey: id === "youtube" ? "youtubeSearchAutoReplace" : "englishSearch_" + id + "_auto"
    };
  }
  function closestAcross(node, selector) {
    for (let current = node; current; current = current.getRootNode?.()?.host) {
      const match = current.closest?.(selector);
      if (match) return match;
    }
    return null;
  }
  function searchForm(input, hostname) {
    const form = input.form || closestAcross(input, "form");
    const action = form?.getAttribute?.("action");
    if (!action) return false;
    try {
      const url = new URL(action, "https://" + hostname);
      return url.hostname === hostname && /^\/search\/?$/.test(url.pathname);
    } catch { return false; }
  }
  function githubSearchField(input) {
    const attr = (name) => input.getAttribute?.(name) || "";
    const role = attr("role");
    const root = input.getRootNode?.() || input.ownerDocument;
    const byId = (id) => root?.getElementById?.(id) || input.ownerDocument?.getElementById?.(id);
    const labelled = attr("aria-labelledby").split(/\s+/).filter(Boolean)
      .map((id) => byId(id)?.textContent || "").join(" ");
    const label = [attr("aria-label"), attr("placeholder"), labelled].filter(Boolean).join(" ").trim();
    if (/copilot|ask\s+anything|comment|feedback|评论|提问/i.test(label + " " + (input.name || ""))) return false;
    if (input.name === "q" && searchForm(input, "github.com")) return true;
    const legacy = input.id === "query-builder-test" || attr("data-target").split(/\s+/).includes("query-builder.input");
    if (legacy && closestAcross(input, "qbsearch-input")) return true;

    // Prefer semantic/component boundaries over a single generated CSS class.
    const component = closestAcross(input, [
      "qbsearch-input", "#search-suggestions-dialog", '[data-testid="global-search"]',
      '[data-testid="header-search"]', '[data-testid="search-dialog"]',
      'react-partial[partial-name="global-nav-bar"]',
      '[class*="quick-search-input-module__searchContainer__"]'
    ].join(", "));
    const header = closestAcross(input, 'header, [role="banner"], .AppHeader');
    const dialog = closestAcross(input, 'dialog, [role="dialog"]');
    const dialogLabel = dialog?.getAttribute?.("aria-label") ||
      (dialog?.getAttribute?.("aria-labelledby") || "").split(/\s+/).filter(Boolean)
        .map((id) => byId(id)?.textContent || "").join(" ");
    const explicitGlobal = /\bsearch\s+(?:or\s+jump\s+to|(?:all\s+of\s+)?github)\b|搜索\s*(?:或跳转|github)/i.test(label);
    const controlsList = attr("aria-controls").split(/\s+/).filter(Boolean)
      .some((id) => byId(id)?.getAttribute?.("role") === "listbox");
    const searchDialog = /^(?:search(?:\s+(?:github|or jump to))?|搜索(?:\s*github)?)$/i.test(dialogLabel.trim());
    if (explicitGlobal && (component || header || searchDialog || (role === "combobox" && controlsList))) return true;
    const genericSearch = [attr("aria-label"), attr("placeholder"), labelled]
      .some((value) => /^(?:search|搜索)(?:\.\.\.|…)?$/i.test(value.trim()));
    return Boolean(role === "combobox" && genericSearch && (component || header || searchDialog) && controlsList);
  }
  function isSearchField(input, hostname) {
    const site = siteFor(hostname);
    if (!site || !["INPUT", "TEXTAREA"].includes(input?.tagName) || input.disabled || input.readOnly) return false;
    if (input.tagName === "INPUT" && !["text", "search", ""].includes(input.type)) return false;
    if (closestAcross(input, '[contenteditable="true"], [role="dialog"][aria-label="Chat"]')) return false;
    if (input.tagName === "TEXTAREA" && site.id !== "google") return false;
    const name = input.name;
    switch (site.id) {
      case "youtube":
        return Boolean(closestAcross(input, "ytd-masthead, #masthead-container")) &&
          (name === "search_query" || Boolean(closestAcross(input, "ytd-searchbox, yt-searchbox, .ytSearchboxComponentHost")));
      case "google":
        return name === "q" && (searchForm(input, hostname) || Boolean(closestAcross(input, 'form[role="search"]')));
      case "bing":
        return name === "q" && (input.id === "sb_form_q" || Boolean(closestAcross(input, "form#sb_form"))) && searchForm(input, hostname);
      case "github":
        return githubSearchField(input);
      case "stackoverflow":
        return name === "q" && searchForm(input, hostname);
      case "wikipedia":
        return name === "search" && (input.id === "searchInput" || Boolean(closestAcross(input, "#p-search, #searchform, .vector-search-box")));
      case "reddit":
        return (name === "q" && searchForm(input, hostname)) ||
          ((name === "q" || input.type === "search" || input.id === "search-input") &&
            Boolean(closestAcross(input, "reddit-search-large, reddit-search-small, shreddit-search, #header-search-bar")));
      default: return false;
    }
  }
  function eventField(event, hostname) {
    return (event.composedPath?.() || [event.target]).find((node) => isSearchField(node, hostname)) || null;
  }
  function deepActive(document) {
    let node = document.activeElement;
    while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
    return node;
  }
  return { siteFor, isSearchField, eventField, deepActive };
});
