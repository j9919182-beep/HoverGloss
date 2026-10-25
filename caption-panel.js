(function () {
  "use strict";
  if (!chrome.sidePanel?.setOptions || !chrome.tabs?.onUpdated) return;
  const videoId = HoverGlossLiveCaptions.videoId;
  const pending = new Map();
  function configure(id, url) {
    if (!Number.isInteger(id)) return Promise.resolve();
    const operation = (pending.get(id) || Promise.resolve()).catch(() => {}).then(() =>
      chrome.sidePanel.setOptions({ tabId: id, enabled: !!videoId(url || ""),
        path: `live-captions.html?tabId=${id}` }));
    pending.set(id, operation);
    return operation.catch(() => {}).finally(() => { if (pending.get(id) === operation) pending.delete(id); });
  }
  chrome.tabs.onUpdated.addListener((id, change, tab) => {
    if (change.url || change.status === "complete") void configure(id, change.url || tab?.url);
  });
  chrome.tabs.onActivated?.addListener(({ tabId }) => {
    chrome.tabs.get(tabId).then((tab) => configure(tabId, tab.url)).catch(() => {});
  });
  // Disable the manifest's global fallback before enabling individual video tabs.
  chrome.sidePanel.setOptions({ enabled: false }).then(async () => {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((tab) => configure(tab.id, tab.url)));
  }).catch(() => {});
})();
