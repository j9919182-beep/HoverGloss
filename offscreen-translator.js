"use strict";

const OFFSCREEN_TARGET = "hovergloss-offscreen-translator";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== OFFSCREEN_TARGET) return false;
  if (!["translateBrowserLocally", "alignWordLocally"].includes(message.type)) return false;

  const operation = message.type === "translateBrowserLocally"
    ? globalThis.HoverGlossBrowserTranslator.translate(message.payload)
    : import(chrome.runtime.getURL("vendor/local-aligner/aligner.mjs"))
      .then((aligner) => aligner.align(message.payload));
  operation
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "本机模型运行失败" }));
  return true;
});
