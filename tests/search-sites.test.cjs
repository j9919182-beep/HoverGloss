"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { siteFor, isSearchField, eventField, deepActive } = require("../search-sites.js");
function field(options = {}) {
  const { action, ancestors = [], attributes = {}, ...rest } = options;
  return {
    tagName: "INPUT", type: "text", name: "q",
    closest(selector) { return ancestors.includes(selector) || selector.split(", ").some((part) => ancestors.includes(part)) ? {} : null; },
    getAttribute(name) { return attributes[name] || null; },
    form: action ? { getAttribute(name) { return name === "action" ? action : null; } } : null,
    ...rest
  };
}
const examples = [
  // QuickSearch's combobox/aria-label/container prefix checked in GitHub's own
  // chunk-2dn-fb4ab624454efd58.js on 2026-10-08; do not broaden to arbitrary dialogs.
  ["www.youtube.com", field({ name: "search_query", ancestors: ["ytd-masthead, #masthead-container"] })],
  ["www.google.com", field({ tagName: "TEXTAREA", action: "/search" })],
  ["www.google.co.uk", field({ action: "/search" })],
  ["www.bing.com", field({ id: "sb_form_q", action: "/search" })],
  ["cn.bing.com", field({ id: "sb_form_q", action: "/search" })],
  ["github.com", field({ action: "/search" })],
  ["github.com", field({ name: "", id: "query-builder-test", ancestors: ["qbsearch-input"] })],
  ["github.com", field({ name: "", attributes: { "data-target": "query-builder.input another.target" }, ancestors: ["qbsearch-input"] })],
  ["github.com", field({ name: "", attributes: { role: "combobox", "aria-label": "Search or jump to" },
    ancestors: ['[class*="quick-search-input-module__searchContainer__"]'] })],
  ["stackoverflow.com", field({ action: "/search" })],
  ["www.reddit.com", field({ action: "/search/" })],
  ["old.reddit.com", field({ action: "/search" })],
  ["en.wikipedia.org", field({ name: "search", id: "searchInput" })]
];
for (const [host, element] of examples) {
  assert.equal(isSearchField(element, host), true, host + " recognized search");
  assert.equal(isSearchField({ ...element, disabled: true }, host), false);
  assert.equal(isSearchField({ ...element, readOnly: true }, host), false);
  assert.equal(isSearchField({ ...element, tagName: "INPUT", type: "password" }, host), false);
  assert.equal(isSearchField(field({ name: "comment" }), host), false);
}
assert.equal(isSearchField(field({ tagName: "TEXTAREA", name: "q" }), "www.google.com"), false, "A named textarea without a search form is excluded");
assert.equal(isSearchField(field({ name: "q", action: "/issues/new" }), "github.com"), false);
assert.equal(isSearchField(field({ name: "", attributes: { role: "combobox", "aria-label": "Search or jump to" } }), "github.com"), false,
  "A lookalike combobox outside the GitHub QuickSearch component is not accepted");
assert.equal(isSearchField(field({ name: "", attributes: { role: "combobox", "aria-label": "Ask Copilot" },
  ancestors: ['[class*="quick-search-input-module__searchContainer__"]'] }), "github.com"), false);
assert.equal(isSearchField(field({ name: "", attributes: { "data-target": "query-builder.input" } }), "github.com"), false,
  "Other query builders without global qbsearch ancestry are excluded");
const listbox = { getAttribute(name) { return name === "role" ? "listbox" : null; } };
const ownerDocument = { getElementById(id) {
  return id === "global-results" ? listbox : id === "search-label" ? { textContent: "Search GitHub" } : null;
} };
for (const label of ["Search GitHub", "Search all of GitHub", "Search or jump to", "搜索 GitHub"]) {
  const modern = field({ name: "", ownerDocument, attributes: { role: "combobox", "aria-label": label, "aria-controls": "global-results" } });
  assert.equal(isSearchField(modern, "github.com"), true, "Semantic global search survives generated class changes: " + label);
}
assert.equal(isSearchField(field({ name: "", ancestors: ["header"], attributes: { placeholder: "Search GitHub" } }), "github.com"), true);
assert.equal(isSearchField(field({ name: "", ownerDocument, attributes: { role: "combobox", "aria-labelledby": "search-label", "aria-controls": "global-results" } }), "github.com"), true);
assert.equal(isSearchField(field({ name: "", ownerDocument, ancestors: ['[data-testid="global-search"]'],
  attributes: { role: "combobox", "aria-label": "Search", placeholder: "Search", "aria-controls": "global-results" } }), "github.com"), true);
for (const label of ["Ask Copilot", "Search comments", "Search issues", "Search files", "Search users"]) {
  assert.equal(isSearchField(field({ name: "", ownerDocument, ancestors: ["header"],
    attributes: { role: "combobox", "aria-label": label, "aria-controls": "global-results" } }), "github.com"), false, label);
}
assert.equal(isSearchField(field({ name: "", attributes: { role: "combobox", "aria-label": "Search", "aria-controls": "global-results" } }), "github.com"), false,
  "A generic search label without a known global boundary is not sufficient");
assert.equal(isSearchField(field({ name: "", ownerDocument, attributes: { role: "combobox", "aria-label": "Search GitHub", "aria-controls": "missing" } }), "github.com"), false,
  "A stale listbox reference does not authorize an arbitrary input");
assert.equal(isSearchField(field({ name: "q", action: "https://evil.test/search" }), "www.google.com"), false);
assert.equal(siteFor("www.google.com.evil.test"), null);
assert.equal(siteFor("mail.google.com"), null);
assert.equal(siteFor("chat.stackoverflow.com"), null);
assert.equal(siteFor("example.com"), null);
assert.equal(siteFor("www.youtube.com").enabledKey, "youtubeSearchEnabled");
assert.equal(siteFor("www.google.com").enabledKey, siteFor("www.google.co.uk").enabledKey);
assert.notEqual(siteFor("www.google.com").enabledKey, siteFor("github.com").enabledKey);

const redditHost = { closest(selector) { return selector.includes("reddit-search-large") ? this : null; } };
const shadowInput = field({ name: "", type: "search", getRootNode: () => ({ host: redditHost }) });
assert.equal(isSearchField(shadowInput, "www.reddit.com"), true, "Open shadow root ancestry identifies the Reddit main search");
assert.equal(eventField({ target: redditHost, composedPath: () => [shadowInput, redditHost] }, "www.reddit.com"), shadowInput);
redditHost.shadowRoot = { activeElement: shadowInput };
assert.equal(deepActive({ activeElement: redditHost }), shadowInput);

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
const matches = manifest.content_scripts.find((entry) => entry.js.includes("search-sites.js")).matches;
for (const [host] of examples) {
  assert.ok(matches.some((pattern) => pattern === "https://" + host + "/*" ||
    (pattern === "https://*.wikipedia.org/*" && host.endsWith(".wikipedia.org"))), host + " is included in extension injection");
}
console.log("Cross-platform search scopes, shadow input, preference isolation and manifest coverage tests passed");
