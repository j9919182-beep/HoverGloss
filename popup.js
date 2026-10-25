"use strict";

const DEFAULTS = { sourceLanguage: "en", enabledHosts: [], triggerMode: "alt-hover", selectionAutoTranslate: true, learningMode: false, youtubeSearchEnabled: false, youtubeSearchAutoReplace: false };
const siteEnabled = document.querySelector("#siteEnabled");
const hostLabel = document.querySelector("#hostLabel");
const triggerMode = document.querySelector("#triggerMode");
const modeHint = document.querySelector("#modeHint");
const notice = document.querySelector("#notice");
const selectionAutoTranslate = document.querySelector("#selectionAutoTranslate");

const HINTS = {
  "alt-hover": "只在按住 Alt 时出现，不打断正常阅读。",
  "ctrl-hover": "只在按住 Ctrl 时出现，适合习惯左手操作。",
  "double-click": "双击才翻译，最不容易误触。",
  "selection": "选中一个单词或不超过6个词的短语后翻译。",
  "always-hover": "无需按键，但阅读时可能频繁弹出。"
};

let currentHost = "";
let currentPdfUrl = "";
let searchSite = null;
let liveTabId = null;
let captionPort = null, captionVideo = "", captionSession = "", captionHeartbeat = null;
const captionsEnabled = document.querySelector("#captionsEnabled");
const captionStatus = document.querySelector("#captionStatus");

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url || "");
    if (HoverGlossPdfSource.isPdfPage(url.href)) {
      currentPdfUrl = HoverGlossPdfSource.isAllowedRemoteUrl(url.href) ? url.href : "";
      hostLabel.textContent = currentPdfUrl
        ? "PDF 文件 · 点击下方 PDF 阅读"
        : url.protocol === "file:"
          ? "本地 PDF · 点击下方 PDF 导入文件"
          : "HTTP PDF · 请先下载再导入";
      siteEnabled.disabled = true;
      throw new Error("pdf-page");
    }
    if (!/^https?:$/.test(url.protocol)) throw new Error();
    currentHost = url.hostname;
    hostLabel.textContent = currentHost;
    if (HoverGlossLiveCaptions.videoId(url.href)) {
      liveTabId = tab.id;
      connectCaptions(tab);
      document.querySelector("#liveCaptionsPanel").hidden = false;
      document.querySelector("#openLiveCaptions").disabled = !chrome.sidePanel?.open;
      if (chrome.sidePanel?.setOptions) {
        try { await chrome.sidePanel.setOptions({ tabId: tab.id, path: `live-captions.html?tabId=${tab.id}`, enabled: true }); }
        catch { document.querySelector("#openLiveCaptions").disabled = true; }
      }
    }
  } catch {
    if (!siteEnabled.disabled) {
      hostLabel.textContent = "此页面不支持扩展";
      siteEnabled.disabled = true;
    }
  }

  const settings = await chrome.storage.local.get(DEFAULTS);
  siteEnabled.checked = settings.enabledHosts.includes(currentHost);
  triggerMode.value = settings.triggerMode;
  document.querySelector("#sourceLanguage").value = settings.sourceLanguage === "fr" ? "fr" : "en";
  document.querySelector("#readingLanguageLabel").textContent = settings.sourceLanguage === "fr" ? "Français" : "English";
  selectionAutoTranslate.checked = settings.selectionAutoTranslate;
  document.querySelector("#learningMode").checked = settings.learningMode;
  searchSite = HoverGlossSearchSites.siteFor(currentHost);
  document.querySelector("#youtubeSearchPanel").hidden = !searchSite;
  if (searchSite) {
    document.querySelector("#searchPlatformLabel").textContent = searchSite.label + " 英文搜索";
    const preferences = await chrome.storage.local.get({ [searchSite.enabledKey]: false, [searchSite.autoKey]: false });
    document.querySelector("#youtubeSearchEnabled").checked = preferences[searchSite.enabledKey];
    document.querySelector("#youtubeSearchAutoReplace").checked = preferences[searchSite.autoKey];
  }
  updateHint();
}

siteEnabled.addEventListener("change", async () => {
  const settings = await chrome.storage.local.get(DEFAULTS);
  const hosts = new Set(settings.enabledHosts);
  siteEnabled.checked ? hosts.add(currentHost) : hosts.delete(currentHost);
  await chrome.storage.local.set({ enabledHosts: [...hosts] });
  showNotice(siteEnabled.checked ? "已在当前网站启用" : "已在当前网站停用");
});

triggerMode.addEventListener("change", async () => {
  await chrome.storage.local.set({ triggerMode: triggerMode.value });
  updateHint();
  showNotice("触发方式已更新");
});

selectionAutoTranslate.addEventListener("change", async () => {
  await chrome.storage.local.set({ selectionAutoTranslate: selectionAutoTranslate.checked });
  showNotice(selectionAutoTranslate.checked ? "选中后自动翻译已开启" : "选中后自动翻译已关闭");
});

document.querySelector("#openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#openLiveCaptions").addEventListener("click", () => {
  if (liveTabId === null || !chrome.sidePanel?.open) return;
  // Keep open() directly in the click handler to preserve browser user activation.
  try { chrome.sidePanel.open({ tabId: liveTabId }).catch(() => showNotice("侧栏打开失败，请更新浏览器并重新加载扩展")); }
  catch { showNotice("当前浏览器无法打开侧栏"); }
});
for (const key of ["youtubeSearchEnabled", "youtubeSearchAutoReplace"]) {
  document.querySelector(`#${key}`).addEventListener("change", async (event) => {
    if (!searchSite) return;
    const storageKey = key === "youtubeSearchEnabled" ? searchSite.enabledKey : searchSite.autoKey;
    try { await chrome.storage.local.set({ [storageKey]: event.target.checked }); showNotice(searchSite.label + " 英文搜索设置已更新"); }
    catch { event.target.checked = !event.target.checked; showNotice("设置保存失败，请重试"); }
  });
}
document.querySelector("#sourceLanguage").addEventListener("change", async (event) => {
  await chrome.storage.local.set({ sourceLanguage: event.target.value });
  document.querySelector("#readingLanguageLabel").textContent = event.target.value === "fr" ? "Français" : "English";
  showNotice(event.target.value === "fr" ? "已切换法语，收藏将进入法语学习库；首次使用请在设置中准备法中翻译" : "已切换英语，收藏将进入英语学习库");
});
document.querySelector("#openLearning").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL(`learning.html?language=${document.querySelector("#sourceLanguage").value}`) }));
document.querySelector("#learningMode").addEventListener("change", async (event) => {
  try {
    await chrome.storage.local.set({ learningMode: event.target.checked });
    showNotice(event.target.checked ? "学习模式已开启，可在翻译卡片中手动收藏" : "学习模式已关闭，已有学习记录仍保留");
  } catch { event.target.checked = !event.target.checked; showNotice("设置保存失败，请重试"); }
});
document.querySelector("#openPdf").addEventListener("click", async () => {
  const reader = new URL(chrome.runtime.getURL("pdf.html"));
  if (currentPdfUrl) {
    const requestId = `pdfOpen:${crypto.randomUUID()}`;
    await chrome.storage.session.set({ [requestId]: currentPdfUrl });
    reader.searchParams.set("requestId", requestId);
  }
  chrome.tabs.create({ url: reader.href });
});
document.querySelector("#openDemo").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("demo.html") });
});

function updateHint() {
  modeHint.textContent = HINTS[triggerMode.value] || "";
}

function connectCaptions(tab) {
  captionVideo = HoverGlossLiveCaptions.videoId(tab.url);
  try {
    const connection = chrome.tabs.connect(tab.id, { name: HoverGlossLiveCaptions.PORT });
    captionPort = connection;
    connection.onMessage.addListener((message) => {
      if (captionPort !== connection || message.videoId !== captionVideo) return;
      if (message.snapshot) {
        const value = message.snapshot;
        captionSession = value.session || "";
        captionsEnabled.disabled = false;
        captionsEnabled.checked = value.state === "running" || value.preparing === true || value.pendingStart === true;
        captionStatus.textContent = value.preparing ? "正在准备语言包…" : value.pendingStart ? "请在视频画面点击开始" : value.state === "running" ? value.message || "正在翻译英文 CC" : value.state === "paused" ? "已暂停，打开开关继续" : "英文 CC → 中文";
        if (value.state === "stopped" && /失败|尚未加载/.test(value.message || "")) captionStatus.textContent = value.message;
      } else if (message.type === "status") captionStatus.textContent = message.message;
      else if (message.type === "navigation") { captionsEnabled.disabled = true; captionsEnabled.checked = false; captionStatus.textContent = "视频已切换，请重新打开弹窗"; }
    });
    connection.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (captionPort !== connection) return;
      captionPort = null; clearInterval(captionHeartbeat);
      captionsEnabled.disabled = true; captionsEnabled.checked = false;
      captionStatus.textContent = "请刷新视频页后重试";
    });
    captionHeartbeat = setInterval(() => {
      try { captionPort?.postMessage({ type: "heartbeat", videoId: captionVideo, session: captionSession }); } catch { /* disconnect updates UI */ }
    }, 2000);
  } catch { captionStatus.textContent = "请刷新视频页后重试"; }
}

captionsEnabled.addEventListener("change", () => {
  try {
    if (!captionPort) throw new Error("disconnected");
    captionPort.postMessage({ type: "toggle-captions", videoId: captionVideo, enabled: captionsEnabled.checked });
    captionStatus.textContent = captionsEnabled.checked ? "正在开启…" : "正在关闭…";
  } catch { captionsEnabled.checked = false; captionStatus.textContent = "连接已断开，请刷新视频页"; }
});
window.addEventListener("pagehide", () => {
  clearInterval(captionHeartbeat);
  try { captionPort?.disconnect(); } catch { /* page already closed */ }
});

function showNotice(message) {
  notice.textContent = message;
  setTimeout(() => { if (notice.textContent === message) notice.textContent = ""; }, 1800);
}
