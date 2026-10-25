"use strict";

const $ = (selector) => document.querySelector(selector);
let libraryLanguage = new URLSearchParams(location.search).get("language") === "fr" ? "fr" : "en";
let reloadSequence = 0;
let entries = [];
let selectedId = null;
let reviewIds = [];
let reviewTotal = 0;
let reviewBusy = false;
let editBusy = false;
let importDocument = null, importLanguage = "", importSequence = 0, importBusy = false;
const date = (value) => new Date(value).toLocaleString("zh-CN", { hour12: false });
const notice = (message) => { $("#notice").textContent = message; };
function speechError(message) { notice(message); $("#speechDiagnostics").open = true; }
const selected = () => entries.find((entry) => entry.id === selectedId);
const sourceText = (entry) => `${entry.origin.type === "pdf" ? "PDF · " : "网页 · "}${entry.origin.title}${entry.origin.page ? ` · 第 ${entry.origin.page} 页` : ""}`;

function phrasesOf(entry) {
  const candidates = Array.isArray(entry.phrases) && entry.phrases.length ? entry.phrases :
    [{ phrase: entry.phrase, phraseTranslation: entry.phraseTranslation }];
  return candidates.filter((pair) => pair?.phrase && pair.phraseTranslation);
}
function renderAudio(container, term) {
  container.replaceChildren();
  const button = globalThis.HoverGlossPronunciation?.createButton(term, { onError: speechError, language: libraryLanguage });
  if (button) container.appendChild(button);
}
function renderSentenceAudio(container, hint, context) {
  container.replaceChildren();
  const text = typeof context === "string" ? context.trim() : "";
  hint.hidden = !text || !/[\p{Script=Latin}]/u.test(text);
  if (hint.hidden) return;
  hint.textContent = "使用在线声音时，点击会将上方原句交给 Edge 提供的 Microsoft 同语言在线语音服务；再次点击可停止。";
  const button = globalThis.HoverGlossPronunciation?.createButton(text, { kind: "sentence", onError: speechError, language: libraryLanguage });
  if (button) container.appendChild(button);
}
function renderPhrases(container, entry) {
  container.replaceChildren();
  for (const pair of phrasesOf(entry)) {
    const card = document.createElement("div"); card.className = "linked-phrase";
    const line = document.createElement("div"); line.className = "term-line";
    const english = document.createElement("strong"); english.textContent = pair.phrase;
    line.appendChild(english);
    const button = globalThis.HoverGlossPronunciation?.createButton(pair.phrase, { onError: speechError, language: libraryLanguage });
    if (button) line.appendChild(button);
    const meaning = document.createElement("p"); meaning.textContent = pair.phraseTranslation;
    card.append(line, meaning); container.appendChild(card);
  }
}

async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, language: libraryLanguage, ...fields });
  if (!response?.ok) throw new Error(response?.error || "操作失败，请重试。");
  return response;
}

async function reload() {
  const sequence = ++reloadSequence;
  const response = await send("learningList");
  if (sequence !== reloadSequence) return;
  entries = response.entries.sort((a, b) => b.createdAt - a.createdAt);
  if (!entries.some((entry) => entry.id === selectedId)) selectedId = entries[0]?.id || null;
  renderList();
  renderDetail();
}

function renderList() {
  const due = entries.filter((entry) => entry.dueAt <= Date.now()).length;
  $("#stats").textContent = `${entries.length} 条语境记录 · ${new Set(entries.map((entry) => entry.term.toLowerCase())).size} 个主词条 · ${entries.reduce((sum, entry) => sum + phrasesOf(entry).length, 0)} 组关联短语 · ${due} 条待复习`;
  $("#startReview").disabled = !due || reviewIds.length > 0;
  const query = $("#search").value.trim().toLowerCase();
  const filter = $("#filter").value;
  const filtered = entries.filter((entry) =>
    (!query || [entry.term, entry.meaning, entry.context, entry.origin.title, entry.notes,
      ...phrasesOf(entry).flatMap((pair) => [pair.phrase, pair.phraseTranslation])].join(" ").toLowerCase().includes(query)) &&
    (filter !== "due" || entry.dueAt <= Date.now()) &&
    (filter !== "uncertain" || entry.uncertain) &&
    (filter !== "familiar" || entry.stage >= 3));
  $("#listCount").textContent = `显示 ${filtered.length} / ${entries.length} 条记录`;
  $("#entries").replaceChildren();
  for (const entry of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `entry${entry.id === selectedId ? " active" : ""}`;
    button.setAttribute("aria-pressed", String(entry.id === selectedId));
    const term = document.createElement("strong");
    term.textContent = entry.term;
    const subtitle = document.createElement("span");
    subtitle.textContent = `${entry.uncertain ? "待核对 · " : ""}${entry.meaning}`;
    const origin = document.createElement("span");
    origin.textContent = sourceText(entry);
    button.append(term, subtitle, origin);
    if (phrasesOf(entry).length) {
      const phrasePreview = document.createElement("span"); phrasePreview.className = "phrase-preview";
      phrasePreview.textContent = "关联短语：" + phrasesOf(entry).map((pair) => pair.phrase).join(" · ");
      button.appendChild(phrasePreview);
    }
    button.addEventListener("click", () => { selectedId = entry.id; renderList(); renderDetail(); });
    $("#entries").appendChild(button);
  }
}

function renderDetail() {
  globalThis.HoverGlossPronunciation?.stop();
  const entry = selected();
  $("#empty").hidden = Boolean(entry);
  $("#detail").hidden = !entry;
  if (!entry) return;
  $("#term").textContent = entry.term;
  renderAudio($("#termAudio"), entry.term);
  $("#meaning").textContent = entry.meaning;
  $("#meaningLabel").textContent = entry.meaningLabel || "收藏时的释义";
  $("#uncertain").hidden = !entry.uncertain;
  renderPhrases($("#phrase"), entry);
  $("#phraseHeading").hidden = !phrasesOf(entry).length;
  $("#commonMeaning").textContent = entry.commonMeaning ? `单词常见义：${entry.commonMeaning}` : "";
  $("#context").textContent = entry.context || "记录时未获取到完整原句。";
  renderSentenceAudio($("#contextAudio"), $("#contextAudioHint"), entry.context);
  $("#sentenceTranslation").textContent = entry.sentenceTranslation ? `句意：${entry.sentenceTranslation}` : "";
  globalThis.HoverGlossLearningGrammar?.render($("#grammar"), entry, libraryLanguage);
  $("#sourceName").textContent = sourceText(entry);
  const link = $("#sourceLink");
  link.hidden = true;
  link.removeAttribute("href");
  if (entry.origin.url) {
    try {
      const url = new URL(entry.origin.url);
      if (/^https?:$/.test(url.protocol)) {
        if (entry.origin.type === "pdf" && entry.origin.page) url.hash = `page=${entry.origin.page}`;
        link.href = url.href;
        link.hidden = false;
      }
    } catch { /* An invalid source cannot become a clickable link. */ }
  }
  $("#sourceHint").textContent = entry.origin.type === "pdf"
    ? entry.origin.url ? "打开来源会进入浏览器 PDF 页面；原站点可能要求重新登录。" : "本地 PDF 未保存文件路径或原文件。请在 HoverGloss 中重新选择此文件，再跳转到记录页码。"
    : "网页链接可能发生变化；原句已保存在此记录中。";
  $("#metadata").textContent = `收藏于 ${date(entry.createdAt)} · 已复习 ${entry.reviews} 次\n下次复习：${date(entry.dueAt)} · ${entry.translationSource || "翻译来源未记录"}${entry.topic ? ` · 主题：${entry.topic}` : ""}${entry.pos ? ` · ${entry.pos}` : ""}`;
  $("#editMeaning").value = entry.meaning;
  $("#notes").value = entry.notes;
  $("#confirmed").checked = false;
}

$("#search").addEventListener("input", renderList);
$("#filter").addEventListener("change", renderList);
$("#learningMode").addEventListener("change", async (event) => {
  try {
    await chrome.storage.local.set({ learningMode: event.target.checked });
    notice(event.target.checked ? "已开启学习模式，在翻译卡片中手动选择加入。" : "学习模式已关闭，已有记录仍可查看和复习。");
  } catch { event.target.checked = !event.target.checked; notice("设置保存失败，请重试。"); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.learningMode) $("#learningMode").checked = Boolean(changes.learningMode.newValue);
  if (changes[libraryLanguage === "fr" ? "hoverglossFrenchLearningV1" : "hoverglossLearningV1"]) notice("学习记录已更新；完成当前操作后，可点击下方“刷新列表”。");
});
$("#editForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selected() || editBusy) return;
  editBusy = true;
  try {
    await send("learningEdit", { id: selectedId, patch: {
      meaning: $("#editMeaning").value, notes: $("#notes").value, confirmed: $("#confirmed").checked
    } });
    await reload();
    notice("释义与笔记已保存。");
  } catch (error) { notice(error.message); }
  finally { editBusy = false; }
});
$("#deleteEntry").addEventListener("click", async () => {
  const entry = selected();
  if (!entry || !confirm(`删除“${entry.term}”的这条语境记录？删除后无法撤销。`)) return;
  try { await send("learningDelete", { id: entry.id }); await reload(); notice("已删除此条记录。"); }
  catch (error) { notice(error.message); }
});
$("#exportLibrary").addEventListener("click", async () => {
  try {
    const exportLanguage = libraryLanguage;
    const records = (await send("learningList")).entries;
    const blob = new Blob([JSON.stringify({ app: "HoverGloss", version: 1, language: exportLanguage, exportedAt: new Date().toISOString(), entries: records }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `HoverGloss-learning-${exportLanguage}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notice("已导出原句、来源和复习记录，可用“导入记录”恢复。");
  } catch (error) { notice(error.message); }
});

function cancelImport() {
  importSequence++; importDocument = null; importLanguage = "";
  $("#importFile").value = ""; $("#importPreview").hidden = true;
}
$("#importLibrary").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  cancelImport();
  const sequence = importSequence, language = libraryLanguage;
  if (!file) return;
  try {
    if (file.size > 12 * 1024 * 1024) throw new Error("文件超过 12 MB，请先拆分或整理备份。");
    const backup = JSON.parse(await file.text());
    if (sequence !== importSequence || language !== libraryLanguage) return;
    const preview = await send("learningImportPreview", { document: backup });
    if (sequence !== importSequence || language !== libraryLanguage) return;
    importDocument = backup; importLanguage = language;
    $("#importSummary").textContent = `${language === "fr" ? "法语" : "英语"}学习库：新增 ${preview.added} 条，重复 ${preview.duplicates} 条，补充短语 ${preview.supplemented} 条；合并后 ${preview.total} 条。`;
    $("#importSamples").replaceChildren();
    for (const entry of preview.sample) { const row = document.createElement("li"); row.textContent = `${entry.term} → ${entry.meaning}`; $("#importSamples").appendChild(row); }
    $("#importPreview").hidden = false;
    notice("已读取预览，点击确认后才会保存。");
  } catch (error) { if (sequence === importSequence) notice(error.message || "导入文件读取失败。"); }
});
$("#cancelImport").addEventListener("click", () => { if (!importBusy) cancelImport(); });
$("#libraryLanguage").addEventListener("change", cancelImport);
$("#confirmImport").addEventListener("click", async () => {
  if (importBusy || !importDocument || importLanguage !== libraryLanguage) return;
  const document = importDocument;
  importBusy = true;
  for (const id of ["#confirmImport", "#cancelImport", "#importLibrary", "#importFile", "#libraryLanguage"]) $(id).disabled = true;
  try {
    const result = await send("learningImport", { document });
    cancelImport(); await reload();
    notice(`已导入 ${result.added} 条，合并重复 ${result.duplicates} 条，补充短语 ${result.supplemented} 条。`);
  } catch (error) { notice(error.message || "导入失败，原记录保持不变。"); }
  finally {
    importBusy = false;
    for (const id of ["#confirmImport", "#cancelImport", "#importLibrary", "#importFile", "#libraryLanguage"]) $(id).disabled = false;
  }
});

function renderReview() {
  globalThis.HoverGlossPronunciation?.stop();
  const entry = entries.find((item) => item.id === reviewIds[0]);
  if (!entry) { endReview(); notice("本次待复习记录已完成。"); return; }
  $("#reviewProgress").textContent = `本次第 ${reviewTotal - reviewIds.length + 1} / ${reviewTotal} 条`;
  $("#reviewWord").textContent = entry.term;
  renderAudio($("#reviewAudio"), entry.term);
  $("#reviewContext").textContent = entry.context || "回想这个词的释义，再显示答案。";
  renderSentenceAudio($("#reviewContextAudio"), $("#reviewContextAudioHint"), entry.context);
  $("#reviewMeaning").textContent = `${entry.meaningLabel || "释义"}：${entry.meaning}`;
  renderPhrases($("#reviewPhrase"), entry);
  $("#reviewSentence").textContent = entry.sentenceTranslation;
  globalThis.HoverGlossLearningGrammar?.render($("#reviewGrammar"), entry, libraryLanguage);
  $("#reviewWarning").textContent = entry.uncertain ? "这条释义尚待核对，请勿把它当作确定的句中义。可结束复习后编辑确认。" : "";
  $("#reviewWarning").hidden = !entry.uncertain;
  $("#reviewSource").textContent = sourceText(entry);
  $("#reviewAnswer").hidden = true;
  $("#showAnswer").hidden = false;
}
function endReview() {
  reviewIds = [];
  $("#reviewPanel").hidden = true;
  $("#libraryPanel").hidden = false;
  renderList(); renderDetail();
}
$("#startReview").addEventListener("click", async () => {
  try {
    const language = libraryLanguage;
    await reload();
    if (language !== libraryLanguage) return;
    reviewIds = entries.filter((entry) => entry.dueAt <= Date.now()).sort((a, b) => a.dueAt - b.dueAt).map((entry) => entry.id);
    if (!reviewIds.length) { notice("暂时没有到期记录。"); return; }
    reviewTotal = reviewIds.length;
    $("#libraryPanel").hidden = true;
    $("#reviewPanel").hidden = false;
    $("#startReview").disabled = true;
    notice(""); renderReview();
  } catch (error) { notice(error.message); }
});
$("#showAnswer").addEventListener("click", () => { $("#reviewAnswer").hidden = false; $("#showAnswer").hidden = true; });
$("#exitReview").addEventListener("click", () => { if (!reviewBusy) { endReview(); notice("已保留完成的复习进度，未作答记录仍待复习。"); } });
async function rate(rating) {
  if (reviewBusy || !reviewIds.length || $("#reviewAnswer").hidden) return;
  reviewBusy = true;
  $("#reviewAgain").disabled = $("#reviewRemember").disabled = true;
  try {
    const result = await send("learningReview", { id: reviewIds[0], rating });
    entries = entries.map((entry) => entry.id === result.entry.id ? result.entry : entry);
    reviewIds.shift();
    notice(`已保存，下次复习：${date(result.entry.dueAt)}`);
    renderReview();
  } catch (error) { notice(error.message); }
  finally { reviewBusy = false; $("#reviewAgain").disabled = $("#reviewRemember").disabled = false; }
}
$("#reviewAgain").addEventListener("click", () => { void rate("again"); });
$("#reviewRemember").addEventListener("click", () => { void rate("remember"); });
$("#refreshLibrary").addEventListener("click", async () => {
  try { await reload(); notice("列表已刷新。"); } catch (error) { notice(error.message); }
});

function renderSpeechReport(report) {
  $("#voiceStatus").textContent = report.message;
  $("#voiceList").replaceChildren();
  const allowed = $("#allowOnlineSpeech").checked;
  for (const voice of report.voices) {
    const row = document.createElement("li");
    const english = new RegExp(`^${libraryLanguage}(?:[-_]|$)`, "i").test(voice.lang);
    const service = voice.localService === true ? "本机" : voice.localService === false ?
      (allowed && english ? "在线，已允许（本机优先）" : "在线，不使用") : "来源未确认，不使用";
    row.textContent = `${voice.name || "未命名声音"} · ${voice.lang || "语言未知"} · ${service}`;
    $("#voiceList").appendChild(row);
  }
}
async function syncSpeechPreference() {
  const settings = await globalThis.HoverGlossPronunciation.getSettings();
  const languageName = libraryLanguage === "fr" ? "法语" : "英文";
  $("#allowOnlineSpeech").checked = settings.allowOnline;
  $("#onlineSpeechStatus").textContent = settings.allowOnline ?
    `已允许在线发音，本机${languageName}声音仍优先；仅点击才朗读。` : `在线发音已关闭，仅使用本机${languageName}声音。`;
}
$("#allowOnlineSpeech").addEventListener("change", async (event) => {
  const checkbox = event.target;
  if (checkbox.disabled) return;
  checkbox.disabled = true;
  try {
    await globalThis.HoverGlossPronunciation.setAllowOnline(checkbox.checked);
    await syncSpeechPreference();
    renderSpeechReport(globalThis.HoverGlossPronunciation.inspect({ language: libraryLanguage }));
  } catch (error) { await syncSpeechPreference(); notice("发音设置保存失败：" + error.message); }
  finally { checkbox.disabled = false; }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.allowOnlinePronunciation) {
    void syncSpeechPreference().then(() => renderSpeechReport(globalThis.HoverGlossPronunciation.inspect({ language: libraryLanguage })));
  }
});
$("#detectVoices").addEventListener("click", async () => {
  const button = $("#detectVoices");
  if (button.disabled) return;
  button.disabled = true;
  $("#voiceStatus").textContent = "正在检测，最多等待 5 秒…";
  $("#voiceList").replaceChildren();
  try {
    const language = libraryLanguage;
    const report = await globalThis.HoverGlossPronunciation.detect({ language });
    if (language === libraryLanguage) renderSpeechReport(report);
  } catch { $("#voiceStatus").textContent = "语音检测失败，请重试。"; }
  finally { button.disabled = false; }
});

async function init() {
  try {
    $("#libraryLanguage").value = libraryLanguage;
    $("#libraryTitle").textContent = libraryLanguage === "fr" ? "法语学习库" : "英语学习库";
    document.title = `${$("#libraryTitle").textContent} · HoverGloss`;
    await syncSpeechPreference();
    $("#allowOnlineSpeech").disabled = false;
    $("#learningMode").checked = Boolean((await chrome.storage.local.get({ learningMode: false })).learningMode);
    await reload();
  } catch (error) { notice(error.message); }
}
void init();
$("#libraryLanguage").addEventListener("change", async (event) => {
  if (reviewBusy || editBusy) { event.target.value = libraryLanguage; return; }
  globalThis.HoverGlossPronunciation.stop();
  libraryLanguage = event.target.value === "fr" ? "fr" : "en";
  selectedId = null; entries = []; reviewIds = [];
  $("#search").value = ""; $("#filter").value = "all";
  $("#libraryTitle").textContent = libraryLanguage === "fr" ? "法语学习库" : "英语学习库";
  document.title = `${$("#libraryTitle").textContent} · HoverGloss`;
  endReview();
  void syncSpeechPreference();
  renderSpeechReport(globalThis.HoverGlossPronunciation.inspect({ language: libraryLanguage }));
  try { await reload(); notice("已切换学习库，记录与复习进度分别保存。"); } catch (error) { notice(error.message); }
});
