"use strict";

const DEFAULTS = {
  sourceLanguage: "en",
  provider: "smart",
  aiEndpoint: "https://api.openai.com/v1/chat/completions",
  aiModel: "",
  aiKey: "",
  hoverDelay: 450,
  skipCommonWords: true,
  skipAcronyms: true,
  showPartOfSpeech: false,
  enableSentenceTranslation: true,
  selectionAutoTranslate: true,
  localAlignmentEnabled: false
};

const fields = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, document.querySelector(`#${key}`)]));
const aiFields = document.querySelector("#aiFields");
const privacyHint = document.querySelector("#privacyHint");
const delayValue = document.querySelector("#delayValue");
const saveStatus = document.querySelector("#saveStatus");
const aiNote = document.querySelector("#aiNote");
const prepareLocalTranslator = document.querySelector("#prepareLocalTranslator");
const localTranslatorStatus = document.querySelector("#localTranslatorStatus");
const prepareLocalAligner = document.querySelector("#prepareLocalAligner");
const localAlignerStatus = document.querySelector("#localAlignerStatus");

init();

async function init() {
  const settings = await chrome.storage.local.get({ ...DEFAULTS, localAlignmentPrepared: false });
  if (settings.provider === "local") settings.provider = "browser";
  Object.entries(fields).forEach(([key, element]) => {
    if (element.type === "checkbox") element.checked = Boolean(settings[key]);
    else element.value = settings[key];
  });
  updateProviderUI();
  updateDelay();
  fields.localAlignmentEnabled.disabled = !settings.localAlignmentPrepared;
  prepareLocalAligner.textContent = settings.localAlignmentPrepared ? "重新测试模型" : "下载并启用对齐模型";
  localAlignerStatus.textContent = settings.localAlignmentEnabled
    ? "已开启；点击“重新测试模型”确认后台可用"
    : "未启用";
  await refreshLocalTranslatorStatus();
}

fields.provider.addEventListener("change", updateProviderUI);
fields.sourceLanguage.addEventListener("change", () => { void refreshLocalTranslatorStatus(); });
fields.hoverDelay.addEventListener("input", updateDelay);
document.querySelector("#save").addEventListener("click", save);
prepareLocalTranslator.addEventListener("click", prepareBrowserTranslator);
prepareLocalAligner.addEventListener("click", prepareAlignmentModel);

async function prepareAlignmentModel() {
  prepareLocalAligner.disabled = true;
  localAlignerStatus.textContent = "正在下载并加载模型，请保持设置页打开…";
  try {
    const aligner = await import(chrome.runtime.getURL("vendor/local-aligner/aligner.mjs"));
    const response = await aligner.prepare();
    if (!response?.ready) throw new Error("模型准备失败");
    const verification = await chrome.runtime.sendMessage({ type: "testLocalAligner" });
    if (!verification?.ok || !verification.ready) throw new Error(verification?.error || "后台本机对齐测试失败");
    await chrome.storage.local.set({ localAlignmentEnabled: true, localAlignmentPrepared: true });
    fields.localAlignmentEnabled.checked = true;
    fields.localAlignmentEnabled.disabled = false;
    localAlignerStatus.textContent = "模型已就绪，后台对齐测试通过";
    prepareLocalAligner.textContent = "重新测试模型";
  } catch (error) {
    await chrome.storage.local.set({ localAlignmentEnabled: false, localAlignmentPrepared: false });
    fields.localAlignmentEnabled.checked = false;
    fields.localAlignmentEnabled.disabled = true;
    prepareLocalAligner.textContent = "下载并启用对齐模型";
    localAlignerStatus.textContent = `对齐测试失败：${error.message || "模型准备失败"}；普通翻译仍可使用`;
  } finally {
    prepareLocalAligner.disabled = false;
  }
}

function updateProviderUI() {
  const value = fields.provider.value;
  const grammarSetup = new URLSearchParams(globalThis.location?.search || "").get("grammar") === "1";
  aiFields.hidden = value === "browser" && !grammarSetup;
  aiNote.textContent = grammarSetup && value === "browser"
    ? "这些设置用于手动语法解析。日常翻译仍采用上方选定的模式；只有在法语学习库点击解析时，才发送原句并可能产生接口费用。填写后请点击底部保存。"
    : value === "smart"
    ? "以下三项可留空。填写完整后，智能模式会结合所在句子判断单词在句中的含义。"
    : "AI模式必须完整填写接口、模型和密钥。单词会结合整句进行判断。";
  privacyHint.textContent = value === "browser"
      ? "翻译由浏览器自带模型在设备本地完成，无需密钥或在线额度。"
    : value === "ai"
      ? "仅在你主动触发时发送目标词和所在句子；密钥保存在本机。"
      : "若已配置AI，会结合完整句子消歧，否则使用浏览器本机翻译。";
}

async function refreshLocalTranslatorStatus() {
  try {
    const selectedLanguage = fields.sourceLanguage.value;
    const name = selectedLanguage === "fr" ? "法中" : "英中";
    const state = await HoverGlossBrowserTranslator.availability(undefined, selectedLanguage);
    if (selectedLanguage !== fields.sourceLanguage.value) return;
    if (state === "available" || state === "readily") {
      localTranslatorStatus.textContent = `本机${name}翻译已就绪`;
      prepareLocalTranslator.textContent = "测试本机翻译";
      prepareLocalTranslator.disabled = false;
    } else if (["downloadable", "downloading", "after-download"].includes(state)) {
      localTranslatorStatus.textContent = `${name}语言包尚未下载`;
      prepareLocalTranslator.textContent = "下载并启用本机翻译";
      prepareLocalTranslator.disabled = false;
    } else {
      localTranslatorStatus.textContent = "当前设备不支持本机翻译，可继续使用自备AI接口";
      prepareLocalTranslator.disabled = true;
    }
  } catch (error) {
    localTranslatorStatus.textContent = error.message || "无法检测本机翻译";
    prepareLocalTranslator.disabled = true;
  }
}

async function prepareBrowserTranslator() {
  const sourceLanguage = fields.sourceLanguage.value;
  const name = sourceLanguage === "fr" ? "法中" : "英中";
  fields.sourceLanguage.disabled = true;
  prepareLocalTranslator.disabled = true;
  localTranslatorStatus.textContent = `正在准备${name}语言包，请保持此页面打开…`;
  try {
    const preparing = HoverGlossBrowserTranslator.prepare((progress) => {
      localTranslatorStatus.textContent = `正在下载${name}语言包：${Math.round(progress * 100)}%`;
    }, undefined, sourceLanguage);
    await preparing;
    localTranslatorStatus.textContent = `本机${name}翻译已就绪，可以开始使用`;
    prepareLocalTranslator.textContent = "测试本机翻译";
  } catch (error) {
    localTranslatorStatus.textContent = error.message || "本机翻译准备失败";
  } finally {
    prepareLocalTranslator.disabled = false;
    fields.sourceLanguage.disabled = false;
  }
}

function updateDelay() {
  delayValue.textContent = fields.hoverDelay.value;
}

async function save() {
  const endpoint = fields.aiEndpoint.value.trim();
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch {
      saveStatus.textContent = "AI 接口须为不含账号密码的 HTTPS 地址";
      return;
    }
  }
  const values = {
    sourceLanguage: fields.sourceLanguage.value,
    provider: fields.provider.value,
    aiEndpoint: endpoint,
    aiModel: fields.aiModel.value.trim(),
    aiKey: fields.aiKey.value.trim(),
    hoverDelay: Number(fields.hoverDelay.value),
    skipCommonWords: fields.skipCommonWords.checked,
    skipAcronyms: fields.skipAcronyms.checked,
    showPartOfSpeech: fields.showPartOfSpeech.checked,
    enableSentenceTranslation: fields.enableSentenceTranslation.checked,
    selectionAutoTranslate: fields.selectionAutoTranslate.checked,
    localAlignmentEnabled: fields.localAlignmentEnabled.checked
  };
  await chrome.storage.local.set(values);
  saveStatus.textContent = "已保存";
  setTimeout(() => { saveStatus.textContent = ""; }, 1800);
}
