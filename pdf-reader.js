import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

const source = globalThis.HoverGlossPdfSource;
const fileInput = document.querySelector("#fileInput");
const urlInput = document.querySelector("#pdfUrl");
const status = document.querySelector("#status");
const stage = document.querySelector("#pageStage");
const paper = document.querySelector("#paper");
const canvas = document.querySelector("#pageCanvas");
const textLayerElement = document.querySelector("#textLayer");
const documentTabs = document.querySelector("#documentTabs");
const resumePrompt = document.querySelector("#resumePrompt");
const resumeText = document.querySelector("#resumeText");
const navigation = globalThis.HoverGlossPdfNavigation;
const tocDetect = globalThis.HoverGlossTocDetect;
const pdfSession = globalThis.HoverGlossPdfSession;
const pageInput = document.querySelector("#pageInput");
const pageTotal = document.querySelector("#pageTotal");
const outlinePanel = document.querySelector("#outlinePanel");
const outlineList = document.querySelector("#outlineList");
const outlineEmpty = document.querySelector("#outlineEmpty");
const tocTools = document.querySelector("#tocTools");
const tocStatus = document.querySelector("#tocStatus");
const tocCalibration = document.querySelector("#tocCalibration");
const tocOffsetInput = document.querySelector("#tocOffset");
const tocMappingHint = document.querySelector("#tocMappingHint");
const scanTocButton = document.querySelector("#scanToc");
const scanCurrentTocButton = document.querySelector("#scanCurrentToc");
const saveTocButton = document.querySelector("#saveToc");
const clearTocButton = document.querySelector("#clearToc");
const toggleOutline = document.querySelector("#toggleOutline");
const zoomValue = document.querySelector("#zoomValue");
const prevPage = document.querySelector("#prevPage");
const nextPage = document.querySelector("#nextPage");
const zoomOut = document.querySelector("#zoomOut");
const zoomIn = document.querySelector("#zoomIn");
const cleanCopy = globalThis.HoverGlossPdfCleanCopy;
const cleanSelection = document.querySelector("#cleanSelection");
const cleanPage = document.querySelector("#cleanPage");
const cleanCopyPanel = document.querySelector("#cleanCopyPanel");
const cleanCopyOrder = document.querySelector("#cleanCopyOrder");
const cleanMergeLines = document.querySelector("#cleanMergeLines");
const cleanJoinHyphens = document.querySelector("#cleanJoinHyphens");
const cleanCopyRaw = document.querySelector("#cleanCopyRaw");
const cleanCopyResult = document.querySelector("#cleanCopyResult");
const cleanCopyNotice = document.querySelector("#cleanCopyNotice");
const cleanCopyStatus = document.querySelector("#cleanCopyStatus");
const copyCleanText = document.querySelector("#copyCleanText");
let copyPageSource = null;
let copyPreviewSource = null;
let copyPreviewSequence = 0;
const pdfOcr = globalThis.HoverGlossPdfOcr;
const ocrClient = pdfOcr.createClient({ getURL: (path) => chrome.runtime.getURL(path) });
const toggleOcr = document.querySelector("#toggleOcr");
const ocrTools = document.querySelector("#ocrTools");
const ocrLanguage = document.querySelector("#ocrLanguage");
const ocrCurrentPage = document.querySelector("#ocrCurrentPage");
const ocrSelectRegion = document.querySelector("#ocrSelectRegion");
const ocrCancel = document.querySelector("#ocrCancel");
const ocrStatus = document.querySelector("#ocrStatus");
const ocrRegionOverlay = document.querySelector("#ocrRegionOverlay");
const ocrRegionBox = document.querySelector("#ocrRegionBox");
let ocrPageSource = null;
let ocrSequence = 0;
let ocrBusy = false;
let ocrRenderTask = null;
let ocrDragStart = null;
let ocrPointerId = null;
const ocrReadingCache = new Map();
function ocrReadingKey() { return `${activeDocumentId}:${pageNumber}`; }
function applyOcrReading(record) {
  const reading = pdfOcr.readingLayer(record.data, record.plan, scale);
  if (!reading.textContent.items.length) return false;
  textLayerTask?.cancel();
  textLayerTask = pdfOcr.mountReadingLayer(textLayerElement, reading);
  copyPageSource = reading;
  cleanPage.disabled = false;
  return true;
}

function updateOcrControls() {
  toggleOcr.disabled = !ocrPageSource;
  ocrCurrentPage.disabled = ocrSelectRegion.disabled = ocrLanguage.disabled = !ocrPageSource || ocrBusy;
  ocrCancel.hidden = !ocrBusy && ocrRegionOverlay.hidden;
  ocrTools.setAttribute("aria-busy", String(ocrBusy));
}

function stopRegionSelection() {
  if (ocrPointerId !== null && ocrRegionOverlay.hasPointerCapture?.(ocrPointerId)) ocrRegionOverlay.releasePointerCapture(ocrPointerId);
  ocrPointerId = null;
  ocrDragStart = null;
  ocrRegionOverlay.hidden = ocrRegionBox.hidden = true;
}

function cancelOcr(message = "已取消识别。") {
  ocrSequence += 1;
  ocrClient.cancel();
  ocrRenderTask?.cancel();
  ocrRenderTask = null;
  ocrBusy = false;
  stopRegionSelection();
  ocrStatus.textContent = message;
  updateOcrControls();
}

toggleOcr.addEventListener("click", () => {
  if (ocrTools.hidden) {
    ocrTools.hidden = false;
    if (!ocrStatus.textContent) ocrStatus.textContent = "识别后可在原页 Alt 悬停查词、拖选翻译；点击“整理当前页”可核对并复制。识字在本机完成。";
    setOutlineOpen(false);
    ocrTools.style.scrollMarginTop = `${(document.querySelector(".reader-toolbar")?.offsetHeight || 108) + 12}px`;
    ocrTools.scrollIntoView({ block: "start" });
  } else { cancelOcr(); ocrTools.hidden = true; }
  toggleOcr.setAttribute("aria-expanded", String(!ocrTools.hidden));
});
ocrCancel.addEventListener("click", () => cancelOcr());
ocrCurrentPage.addEventListener("click", () => { void runOcr(); });
ocrSelectRegion.addEventListener("click", () => {
  if (!ocrPageSource || ocrBusy) return;
  stopRegionSelection();
  setOutlineOpen(false);
  cleanCopyPanel.hidden = true;
  ocrRegionOverlay.hidden = false;
  ocrStatus.textContent = "在 PDF 页面上拖动框选，松开后开始识别；按 Esc 或点击取消可退出。";
  updateOcrControls();
  stage.style.scrollMarginTop = `${(document.querySelector(".reader-toolbar")?.offsetHeight || 108) + 12}px`;
  stage.scrollIntoView({ block: "start" });
});
function ocrPoint(event) {
  const bounds = ocrRegionOverlay.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
}
ocrRegionOverlay.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || ocrBusy || ocrPointerId !== null) return;
  event.preventDefault();
  ocrPointerId = event.pointerId;
  ocrDragStart = ocrPoint(event);
  ocrRegionBox.hidden = false;
  ocrRegionBox.style.width = ocrRegionBox.style.height = "0";
  ocrRegionBox.style.left = `${ocrDragStart.x * 100}%`;
  ocrRegionBox.style.top = `${ocrDragStart.y * 100}%`;
  ocrRegionOverlay.setPointerCapture(event.pointerId);
});
ocrRegionOverlay.addEventListener("pointermove", (event) => {
  if (!ocrDragStart || event.pointerId !== ocrPointerId) return;
  const rect = pdfOcr.normalizedRect(ocrDragStart, ocrPoint(event));
  Object.assign(ocrRegionBox.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });
});
ocrRegionOverlay.addEventListener("pointerup", (event) => {
  if (!ocrDragStart || event.pointerId !== ocrPointerId) return;
  const rect = pdfOcr.normalizedRect(ocrDragStart, ocrPoint(event));
  const bounds = ocrRegionOverlay.getBoundingClientRect();
  stopRegionSelection();
  updateOcrControls();
  if (rect.width * bounds.width < 8 || rect.height * bounds.height < 8) {
    ocrStatus.textContent = "框选范围太小，请重新点击“框选区域识别”并拖出文字区域。";
    return;
  }
  void runOcr(rect);
});
ocrRegionOverlay.addEventListener("pointercancel", () => { stopRegionSelection(); updateOcrControls(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && (ocrBusy || !ocrRegionOverlay.hidden)) cancelOcr(); });
window.addEventListener?.("pagehide", () => cancelOcr(""));

async function runOcr(rectangle) {
  if (!ocrPageSource || ocrBusy) return;
  cancelOcr("");
  const sequence = ocrSequence;
  const sourcePage = ocrPageSource;
  ocrBusy = true;
  ocrTools.hidden = false;
  toggleOcr.setAttribute("aria-expanded", "true");
  copyPreviewSequence += 1;
  copyPreviewSource = null;
  cleanCopyPanel.hidden = true;
  cleanCopyRaw.value = cleanCopyResult.value = "";
  copyCleanText.disabled = true;
  updateOcrControls();
  ocrStatus.textContent = "正在准备页面图像…";
  ocrTools.style.scrollMarginTop = `${(document.querySelector(".reader-toolbar")?.offsetHeight || 108) + 12}px`;
  ocrTools.scrollIntoView({ block: "start" });
  const imageCanvas = document.createElement("canvas");
  try {
    const plan = pdfOcr.renderPlan(sourcePage.page.getViewport({ scale: 1 }), rectangle);
    const viewport = sourcePage.page.getViewport({ scale: plan.scale, offsetX: -plan.left, offsetY: -plan.top });
    imageCanvas.width = plan.width; imageCanvas.height = plan.height;
    const imageContext = imageCanvas.getContext("2d", { alpha: false });
    if (!imageContext) throw new Error("浏览器无法准备 OCR 图像。");
    ocrRenderTask = sourcePage.page.render({ canvasContext: imageContext, viewport });
    await ocrRenderTask.promise;
    if (sequence !== ocrSequence) return;
    const imageBlob = await new Promise((resolve) => imageCanvas.toBlob(resolve, "image/png"));
    if (!imageBlob) throw new Error("无法读取页面图像，请重试。");
    const image = new Uint8Array(await imageBlob.arrayBuffer());
    if (sequence !== ocrSequence) return;
    const data = await ocrClient.recognize(image, ocrLanguage.value, { region: Boolean(rectangle), onProgress: (progress) => {
      if (sequence !== ocrSequence) return;
      const labels = { "loading tesseract core": "载入本地引擎", "initializing tesseract": "初始化引擎", "loading language traineddata": "载入本地语言包", "initializing api": "准备识别", "recognizing text": "识别文字" };
      const percent = Number.isFinite(progress.progress) ? ` ${Math.round(progress.progress * 100)}%` : "";
      ocrStatus.textContent = `${labels[progress.status] || "正在识别"}${percent}…`;
    } });
    if (sequence !== ocrSequence || sourcePage !== ocrPageSource) return;
    const record = { data, plan };
    const canTranslate = applyOcrReading(record);
    if (canTranslate) {
      ocrReadingCache.delete(ocrReadingKey());
      ocrReadingCache.set(ocrReadingKey(), record);
      while (ocrReadingCache.size > 8) ocrReadingCache.delete(ocrReadingCache.keys().next().value);
      setStatus(`第 ${pageNumber} 页已识字，可 Alt 悬停查词、拖选翻译。OCR 可能有错字，请核对原页。`);
    }
    copyPreviewSource = pdfOcr.toPreview(data, plan.height);
    cleanCopyOrder.value = "auto";
    cleanMergeLines.checked = true; cleanJoinHyphens.checked = false;
    document.querySelector("#cleanCopyTitle").textContent = `OCR 干净复制 · 第 ${pageNumber} 页${rectangle ? "框选区域" : ""}`;
    setOutlineOpen(false);
    cleanCopyPanel.hidden = false;
    updateCleanPreview();
    ocrStatus.textContent = canTranslate ? "识别完成，可回到原页悬停或拖选翻译；识别文字也可在预览中修改后复制。" : data.text?.trim() ? "已提取文字，但未获得可靠位置，暂不能在原页悬停；可复制预览文字。" : "未识别到文字；可更换语言、框选更清晰的区域后重试。";
    cleanCopyPanel.hidden = canTranslate;
    (canTranslate ? paper : cleanCopyPanel).scrollIntoView({ block: "start" });
  } catch (error) {
    if (sequence !== ocrSequence || error?.name === "AbortError" || error?.name === "RenderingCancelledException") return;
    ocrStatus.textContent = error.message || "OCR 识别失败，请重试。";
  } finally {
    imageCanvas.width = imageCanvas.height = 0;
    if (sequence === ocrSequence) { ocrBusy = false; ocrRenderTask = null; updateOcrControls(); }
  }
}

function resetCleanCopy() {
  cancelOcr("");
  ocrPageSource = null;
  ocrTools.hidden = true;
  toggleOcr.setAttribute("aria-expanded", "false");
  updateOcrControls();
  copyPreviewSequence += 1;
  copyPageSource = null;
  copyPreviewSource = null;
  cleanCopyPanel.hidden = true;
  cleanPage.disabled = cleanSelection.disabled = copyCleanText.disabled = true;
  cleanCopyRaw.value = cleanCopyResult.value = "";
  cleanCopyStatus.textContent = "";
}

function hasPageSelection() {
  const selection = window.getSelection();
  return Boolean(copyPageSource && selection && !selection.isCollapsed && selection.rangeCount
    && textLayerElement.contains(selection.anchorNode) && textLayerElement.contains(selection.focusNode));
}

document.addEventListener("hovergloss:pagechange", resetCleanCopy);
document.addEventListener("selectionchange", () => { cleanSelection.disabled = !hasPageSelection(); });
cleanSelection.addEventListener("pointerdown", (event) => { if (event.button === 0) event.preventDefault(); });
cleanSelection.addEventListener("click", () => openCleanCopy(true));
cleanPage.addEventListener("click", () => openCleanCopy(false));
document.querySelector("#closeCleanCopy").addEventListener("click", () => {
  copyPreviewSequence += 1;
  copyPreviewSource = null;
  cleanCopyPanel.hidden = true;
});
for (const control of [cleanCopyOrder, cleanMergeLines, cleanJoinHyphens]) control.addEventListener("change", updateCleanPreview);
cleanCopyResult.addEventListener("input", () => {
  copyPreviewSequence += 1;
  copyCleanText.disabled = !cleanCopyResult.value.trim();
  cleanCopyStatus.textContent = "";
});
copyCleanText.addEventListener("click", async () => {
  if (cleanCopyPanel.hidden || !cleanCopyResult.value.trim()) return;
  const sequence = copyPreviewSequence;
  try {
    await navigator.clipboard.writeText(cleanCopyResult.value);
    if (sequence === copyPreviewSequence) cleanCopyStatus.textContent = "已复制整理结果。";
  } catch {
    if (sequence !== copyPreviewSequence) return;
    cleanCopyResult.focus();
    cleanCopyResult.select();
    cleanCopyStatus.textContent = "浏览器未允许写入剪贴板，已选中结果；请按 Ctrl+C 复制。";
  }
});

function openCleanCopy(selectedOnly) {
  if (!copyPageSource) return;
  if (selectedOnly && !hasPageSelection()) return;
  cancelOcr("");
  const textContent = selectedOnly
    ? cleanCopy.selectedContent(textLayerTask, copyPageSource.textContent, window.getSelection()) : copyPageSource.textContent;
  if (selectedOnly && !textContent.items.length) {
    setStatus("无法准确提取此处的选中文字，请尝试“整理当前页”后在结果中选取。", true);
    return;
  }
  copyPreviewSequence += 1;
  copyPreviewSource = { ...copyPageSource, textContent,
    raw: selectedOnly ? textContent.items.map((item) => item.str).join(" ") : copyPageSource.raw };
  cleanCopyOrder.value = "auto";
  cleanMergeLines.checked = true;
  cleanJoinHyphens.checked = false;
  document.querySelector("#cleanCopyTitle").textContent = `PDF 干净复制 · 第 ${pageNumber} 页${selectedOnly ? "选中内容" : ""}`;
  setOutlineOpen(false);
  cleanCopyPanel.hidden = false;
  updateCleanPreview();
  cleanCopyPanel.style.scrollMarginTop = `${(document.querySelector(".reader-toolbar")?.offsetHeight || 108) + 12}px`;
  cleanCopyPanel.scrollIntoView({ block: "start" });
}

function updateCleanPreview() {
  if (!copyPreviewSource) return;
  copyPreviewSequence += 1;
  const original = cleanCopyOrder.value === "original";
  cleanMergeLines.disabled = cleanJoinHyphens.disabled = original;
  const result = cleanCopy.prepare(copyPreviewSource.textContent, copyPreviewSource.viewport, {
    order: cleanCopyOrder.value, mergeLines: cleanMergeLines.checked, joinHyphens: cleanJoinHyphens.checked
  });
  cleanCopyRaw.value = copyPreviewSource.ocr ? copyPreviewSource.raw : result.raw;
  cleanCopyResult.value = result.text;
  cleanCopyNotice.textContent = result.quality.message + (result.uncertainLayout ? " 部分文字的方向或位置无法确认，已单独保留；请核对顺序。" : "");
  cleanCopyNotice.classList.toggle("is-warning", result.quality.kind !== "text" || result.uncertainLayout);
  if (copyPreviewSource.ocr) {
    cleanCopyNotice.textContent = result.text.trim() ? "来源：本地 OCR。请对照原页核对错字、数字和阅读顺序。" : "OCR 未识别到文字，请更换语言或识别范围后重试。";
    if (copyPreviewSource.layoutFallback) cleanCopyNotice.textContent += " 未获得可靠位置，当前按识别顺序保留文字。";
    if (Number.isFinite(copyPreviewSource.confidence) && copyPreviewSource.confidence < 70) cleanCopyNotice.textContent += " 本次识别把握较低。";
    cleanCopyNotice.classList.toggle("is-warning", !result.text.trim() || copyPreviewSource.layoutFallback || copyPreviewSource.confidence < 70);
  }
  copyCleanText.disabled = !result.text.trim();
  cleanCopyStatus.textContent = "";
}

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs");

let pdfDocument = null;
let loadingTask = null;
let renderTask = null;
let textLayerTask = null;
const openDocuments = [];
const MAX_OPEN_DOCUMENTS = 8;
let activeDocumentId = null;
let nextDocumentId = 0;
let pageNumber = 1;
let scale = 1;
let documentName = "PDF";
let loadSequence = 0;
let renderSequence = 0;
let activeOutlineButton = null;
let tocScanSequence = 0;
let tocEntries = [];
let tocSourceLastPage = 0;
let tocLabels = null;
let tocOffset = 0;
let tocUseLabels = false;
let tocCacheKey = null;

const learningMode = document.querySelector("#learningMode");
chrome.storage.local.get({ learningMode: false }).then((settings) => { learningMode.checked = Boolean(settings.learningMode); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.learningMode) learningMode.checked = Boolean(changes.learningMode.newValue);
});
learningMode.addEventListener("change", async () => {
  try { await chrome.storage.local.set({ learningMode: learningMode.checked }); }
  catch { learningMode.checked = !learningMode.checked; setStatus("学习模式设置保存失败，请重试。", true); }
});
document.querySelector("#openLearning").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("learning.html") }));

document.querySelector("#openFile").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  fileInput.value = "";
  if (openDocuments.length >= MAX_OPEN_DOCUMENTS) return setStatus("最多同时打开 8 份 PDF；请先关闭一个文件标签。", true);
  if (file.size > source.MAX_PDF_BYTES) return setStatus("PDF 超过 60 MB，暂不支持直接打开。", true);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await openBytes(bytes, file.name);
  } catch (error) {
    setStatus(error.message || "无法读取本地 PDF。", true);
  }
});

document.querySelector("#urlForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await openRemote(urlInput.value.trim());
});

prevPage.addEventListener("click", () => showPage(pageNumber - 1));
nextPage.addEventListener("click", () => showPage(pageNumber + 1));
document.querySelector("#resumeContinue").addEventListener("click", () => { void resolveResume(true); });
document.querySelector("#resumeStart").addEventListener("click", () => { void resolveResume(false); });
zoomOut.addEventListener("click", () => changeZoom(-0.2));
zoomIn.addEventListener("click", () => changeZoom(0.2));
toggleOutline.addEventListener("click", () => setOutlineOpen(outlinePanel.hidden));
document.querySelector("#closeOutline").addEventListener("click", () => setOutlineOpen(false));
scanTocButton.addEventListener("click", () => { void scanPrintedToc(false); });
scanCurrentTocButton.addEventListener("click", () => { void scanPrintedToc(true); });
tocOffsetInput.addEventListener("input", () => {
  const value = Number(tocOffsetInput.value);
  if (!Number.isInteger(value) || Math.abs(value) > 2000) return;
  tocOffset = value;
  tocUseLabels = false;
  renderPrintedToc();
  tocMappingHint.textContent = "已按手动页码差更新跳转位置；确认正确后可保存本地目录。";
});
saveTocButton.addEventListener("click", () => { void savePrintedToc(); });
clearTocButton.addEventListener("click", () => { void clearSavedToc(); });
document.querySelector("#pageJumpForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pdfDocument) return;
  const target = navigation.parsePageNumber(pageInput.value, pdfDocument.numPages);
  if (target === null) {
    setStatus(`请输入 1–${pdfDocument.numPages} 之间的页码。`, true);
    pageInput.value = String(pageNumber);
    return;
  }
  pageInput.blur();
  void showPage(target);
});
document.addEventListener("keydown", (event) => {
  if (!pdfDocument || activeDocument()?.resumePage) return;
  const delta = navigation.pageArrowDelta(event, window.getSelection()?.toString() || "");
  const target = pageNumber + delta;
  if (!delta || target < 1 || target > pdfDocument.numPages) return;
  event.preventDefault();
  void showPage(target);
});

const requestId = new URL(location.href).searchParams.get("requestId");
if (requestId && /^pdfOpen:[0-9a-f-]{36}$/i.test(requestId)) {
  const stored = await chrome.storage.session.get(requestId);
  await chrome.storage.session.remove(requestId);
  const pdfUrl = stored[requestId];
  if (source.isAllowedRemoteUrl(pdfUrl)) {
    urlInput.value = pdfUrl;
    await openRemote(pdfUrl);
  }
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function updateControls() {
  const waiting = Boolean(activeDocument()?.resumePage);
  pageInput.disabled = !pdfDocument || waiting;
  pageInput.value = pdfDocument ? String(pageNumber) : "";
  pageInput.max = pdfDocument ? String(pdfDocument.numPages) : "";
  pageTotal.textContent = pdfDocument ? `/ ${pdfDocument.numPages}` : "/ —";
  zoomValue.textContent = `${Math.round(scale * 100)}%`;
  prevPage.disabled = !pdfDocument || waiting || pageNumber <= 1;
  nextPage.disabled = !pdfDocument || waiting || pageNumber >= pdfDocument.numPages;
  zoomOut.disabled = !pdfDocument || waiting || scale <= 0.6;
  zoomIn.disabled = !pdfDocument || waiting || scale >= 1.8;
}

function setOutlineOpen(open) {
  if (toggleOutline.disabled) return;
  outlinePanel.hidden = !open;
  toggleOutline.setAttribute("aria-expanded", String(open));
}

function resetOutline() {
  tocScanSequence += 1;
  tocEntries = [];
  tocSourceLastPage = 0;
  tocLabels = null;
  tocOffset = 0;
  tocUseLabels = false;
  tocCacheKey = null;
  tocOffsetInput.value = "0";
  tocOffsetInput.disabled = false;
  tocOffsetInput.parentElement.hidden = false;
  tocTools.hidden = true;
  tocCalibration.hidden = true;
  clearTocButton.hidden = true;
  scanTocButton.disabled = false;
  scanCurrentTocButton.disabled = false;
  tocStatus.textContent = "按需读取可选中文字和 PDF 自带的目录按钮；扫描图片暂不支持。";
  outlineList.replaceChildren();
  outlineEmpty.hidden = false;
  outlineEmpty.textContent = "此 PDF 没有内置章节目录。可以识别书页上印刷的目录，或输入页码跳转。";
  outlinePanel.hidden = true;
  toggleOutline.disabled = true;
  toggleOutline.setAttribute("aria-expanded", "false");
  activeOutlineButton = null;
}

async function loadOutline(documentProxy, sequence) {
  try {
    const outline = await documentProxy.getOutline();
    if (sequence !== loadSequence || documentProxy !== pdfDocument) return;
    toggleOutline.disabled = false;
    if (!Array.isArray(outline) || outline.length === 0) {
      await showTocTools(documentProxy, sequence);
      return;
    }
    const count = { value: 0, links: 0 };
    appendOutlineItems(outline, outlineList, 0, count);
    if (count.links === 0) {
      outlineList.replaceChildren();
      await showTocTools(documentProxy, sequence);
      return;
    }
    outlineEmpty.hidden = count.value > 0;
    if (count.value >= 2000) {
      outlineEmpty.hidden = false;
      outlineEmpty.textContent = "目录很长，当前仅显示前 2000 项。";
    }
    setOutlineOpen(true);
  } catch {
    if (sequence !== loadSequence || documentProxy !== pdfDocument) return;
    toggleOutline.disabled = false;
    outlineEmpty.textContent = "无法读取内置书签；可以尝试识别书页上的目录。";
    await showTocTools(documentProxy, sequence);
  }
}

async function showTocTools(documentProxy, sequence) {
  tocTools.hidden = false;
  setOutlineOpen(true);
  try {
    const labels = await documentProxy.getPageLabels();
    if (sequence !== loadSequence || documentProxy !== pdfDocument) return;
    tocLabels = Array.isArray(labels) ? labels : null;
  } catch { /* Page labels are optional. */ }
  if (sequence !== loadSequence || documentProxy !== pdfDocument) return;
  const fingerprint = documentProxy.fingerprints?.[0];
  if (typeof fingerprint !== "string" || !/^[a-z\d]{8,128}$/i.test(fingerprint)) return;
  tocCacheKey = `pdfToc:${fingerprint}`;
  try {
    const stored = (await chrome.storage.local.get(tocCacheKey))[tocCacheKey];
    if (sequence !== loadSequence || documentProxy !== pdfDocument) return;
    if (!stored || stored.version !== 1 || !Array.isArray(stored.entries) || stored.entries.length < 2 || stored.entries.length > tocDetect.MAX_ENTRIES) return;
    const entries = stored.entries.filter((entry) =>
      entry && typeof entry.title === "string" && entry.title.length <= 160 &&
      typeof entry.label === "string" && entry.label.length <= 8 &&
      (entry.number === null || Number.isInteger(entry.number)) && Number.isInteger(entry.level) &&
      (entry.targetPage === undefined || (Number.isInteger(entry.targetPage) && entry.targetPage >= 1 && entry.targetPage <= documentProxy.numPages))
    );
    if (entries.length !== stored.entries.length) return;
    tocEntries = entries;
    tocSourceLastPage = Number.isInteger(stored.sourceLastPage) ? stored.sourceLastPage : 0;
    tocOffset = Number.isInteger(stored.offset) ? stored.offset : 0;
    tocUseLabels = Boolean(stored.useLabels) && Array.isArray(tocLabels);
    tocOffsetInput.value = String(tocOffset);
    tocCalibration.hidden = false;
    clearTocButton.hidden = false;
    tocStatus.textContent = `已载入本地保存的目录（${tocEntries.length} 项）。`;
    const direct = tocEntries.every((entry) => Number.isInteger(entry.targetPage));
    tocOffsetInput.disabled = direct;
    tocOffsetInput.parentElement.hidden = direct;
    tocMappingHint.textContent = direct
      ? "章节直接使用 PDF 自带的跳转目标，无需校准页码。"
      : "如跳转不准，请调整页码差后重新保存。";
    renderPrintedToc();
  } catch {
    tocStatus.textContent = "无法读取本地目录；仍可重新识别。";
  }
}

async function scanPrintedToc(currentOnly) {
  const documentProxy = pdfDocument;
  if (!documentProxy) return;
  const sequence = loadSequence;
  const scanSequence = ++tocScanSequence;
  const first = currentOnly ? pageNumber : 1;
  const last = currentOnly ? pageNumber : Math.min(40, documentProxy.numPages);
  const pages = [];
  const linkedPages = [];
  let linkedButtonsSeen = false;
  scanTocButton.disabled = true;
  scanCurrentTocButton.disabled = true;
  tocStatus.textContent = currentOnly ? `正在读取第 ${first} 页…` : `正在检查前 ${last} 页…`;
  try {
    for (let number = first; number <= last; number += 1) {
      const page = await documentProxy.getPage(number);
      const content = await page.getTextContent();
      if (scanSequence !== tocScanSequence || sequence !== loadSequence || documentProxy !== pdfDocument) return;
      const parsed = tocDetect.parseTocPage(content, number);
      pages.push(parsed);
      if (parsed.hasHeading || currentOnly) {
        try {
          const annotations = await page.getAnnotations({ intent: "display" });
          const links = annotations.filter((annotation) => annotation?.dest);
          if (links.length >= 2) {
            linkedButtonsSeen = true;
            const operatorList = await page.getOperatorList();
            const visibleEntries = tocDetect.parseAnnotationTocPage(links, operatorList, pdfjsLib.OPS, number);
            const entries = [];
            for (const { dest, y, ...entry } of visibleEntries) {
              try {
                const targetPage = await navigation.resolveDestinationPage(documentProxy, dest);
                if (targetPage !== null) entries.push({ ...entry, targetPage });
              } catch { /* Skip only the broken link, not the whole contents page. */ }
            }
            if (entries.length >= 2) linkedPages.push({ pageNumber: number, entries });
          }
        } catch { /* A malformed annotation must not prevent ordinary text TOC detection. */ }
      }
      if (scanSequence !== tocScanSequence || sequence !== loadSequence || documentProxy !== pdfDocument) return;
      if (!currentOnly && (number % 5 === 0 || number === last)) tocStatus.textContent = `已检查 ${number} / ${last} 页…`;
    }
    const linked = linkedPages.sort((a, b) => b.entries.length - a.entries.length || a.pageNumber - b.pageNumber)[0];
    let candidate = linked
      ? { entries: linked.entries, firstPage: linked.pageNumber, lastPage: linked.pageNumber, direct: true }
      : tocDetect.selectTocCandidate(pages);
    if (currentOnly && !candidate && pages[0]?.entries.length >= 2) {
      candidate = { entries: pages[0].entries.map((entry) => ({ ...entry, sourcePage: first, level: 0 })), firstPage: first, lastPage: first };
    }
    if (!candidate) {
      tocStatus.textContent = linkedButtonsSeen
        ? "发现目录链接，但暂时无法读取按钮上的章节文字；可先输入页码跳转。"
        : pages.some((page) => page.hasText)
        ? "没有找到可信的目录格式。请翻到书中的目录页，再点“将当前页识别为目录”。"
        : "这些页面没有可选中文字，可能是扫描图片；目录识别不包含 OCR，可用“OCR 识字”单独提取页面文字。";
      return;
    }
    tocEntries = candidate.entries;
    tocSourceLastPage = candidate.lastPage;
    const labelOffset = candidate.direct ? null : tocDetect.offsetFromPageLabels(tocEntries, tocLabels, tocSourceLastPage);
    const headingOffset = candidate.direct || currentOnly ? null : tocDetect.offsetFromHeadings(tocEntries, pages, tocSourceLastPage);
    tocOffset = labelOffset ?? headingOffset ?? 0;
    tocUseLabels = labelOffset !== null;
    tocOffsetInput.value = String(tocOffset);
    tocCalibration.hidden = false;
    tocOffsetInput.disabled = Boolean(candidate.direct);
    tocOffsetInput.parentElement.hidden = Boolean(candidate.direct);
    tocMappingHint.textContent = candidate.direct
      ? "章节直接使用 PDF 自带的跳转目标，无需校准页码。"
      : tocUseLabels
      ? "已根据 PDF 页码标签对齐；如跳转不准，可手动修改页码差。"
      : headingOffset !== null
        ? "已通过正文中至少两处章节标题估算页码差；请点一项核对。"
        : "未能自动核对书中页码与 PDF 页码。请先点一项核对，再调整页码差。";
    tocStatus.textContent = candidate.direct
      ? `从 PDF 第 ${candidate.firstPage} 页的可跳转目录按钮中找到 ${tocEntries.length} 项。`
      : `找到 ${tocEntries.length} 个目录条目（PDF 第 ${candidate.firstPage}–${candidate.lastPage} 页）。`;
    renderPrintedToc();
    setOutlineOpen(true);
  } catch (error) {
    if (scanSequence === tocScanSequence && documentProxy === pdfDocument) tocStatus.textContent = error.message || "目录识别失败，请重试。";
  } finally {
    if (scanSequence === tocScanSequence && documentProxy === pdfDocument) {
      scanTocButton.disabled = false;
      scanCurrentTocButton.disabled = false;
    }
  }
}

function renderPrintedToc() {
  if (!pdfDocument || !tocEntries.length) return;
  outlineList.replaceChildren();
  const list = document.createElement("ul");
  list.className = "outline-list";
  for (const entry of tocEntries) {
    const target = tocDetect.mapEntryPage(entry, tocUseLabels ? tocLabels : null, tocOffset, tocSourceLastPage, pdfDocument.numPages);
    const item = document.createElement("li");
    item.className = "outline-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outline-link toc-entry";
    button.style.paddingLeft = `${8 + Math.min(2, Math.max(0, entry.level)) * 13}px`;
    button.disabled = target === null;
    button.title = target === null ? "无法确定 PDF 页码；请调整页码差" : `跳到 PDF 第 ${target} 页`;
    const name = document.createElement("span");
    name.className = "toc-entry-name";
    name.textContent = entry.title;
    const page = document.createElement("span");
    page.className = "toc-entry-page";
    page.textContent = entry.label;
    button.append(name, page);
    if (target !== null) button.addEventListener("click", async () => {
      if (await showPage(target)) {
        activeOutlineButton?.classList.remove("is-active");
        activeOutlineButton = button;
        button.classList.add("is-active");
        if (window.innerWidth <= 900) setOutlineOpen(false);
        stage.scrollIntoView({ block: "start" });
      }
    });
    item.appendChild(button);
    list.appendChild(item);
  }
  outlineList.appendChild(list);
  outlineEmpty.hidden = true;
  activeOutlineButton = null;
}

async function savePrintedToc() {
  if (!tocCacheKey || !tocEntries.length) {
    tocStatus.textContent = "此文件缺少稳定标识，无法保存目录；当前阅读仍可使用。";
    return;
  }
  try {
    await chrome.storage.local.set({ [tocCacheKey]: {
      version: 1,
      entries: tocEntries.map(({ title, label, number, level, targetPage }) => ({ title, label, number, level, ...(Number.isInteger(targetPage) ? { targetPage } : {}) })),
      sourceLastPage: tocSourceLastPage,
      offset: tocOffset,
      useLabels: tocUseLabels
    } });
    clearTocButton.hidden = false;
    tocStatus.textContent = "目录和页码差已保存在此浏览器，可随时删除。";
  } catch {
    tocStatus.textContent = "保存失败；当前目录仍可继续使用。";
  }
}

async function clearSavedToc() {
  if (!tocCacheKey) return;
  try {
    await chrome.storage.local.remove(tocCacheKey);
    clearTocButton.hidden = true;
    tocStatus.textContent = "已删除本地保存的目录；当前打开的目录仍可继续使用。";
  } catch {
    tocStatus.textContent = "删除本地目录失败，请稍后重试。";
  }
}

function appendOutlineItems(items, parent, depth, count) {
  if (depth > 20 || count.value >= 2000) return;
  const list = document.createElement("ul");
  list.className = "outline-list";
  for (const item of items) {
    if (count.value >= 2000) break;
    if (!item || typeof item !== "object") continue;
    count.value += 1;
    const entry = document.createElement("li");
    entry.className = "outline-item";
    const title = String(item.title || "未命名章节").trim().slice(0, 200);
    if (item.dest) {
      count.links += 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "outline-link";
      button.textContent = title;
      button.addEventListener("click", () => { void jumpToOutline(item.dest, button); });
      entry.appendChild(button);
    } else {
      const label = document.createElement("span");
      label.className = "outline-label";
      label.textContent = title;
      entry.appendChild(label);
    }
    if (Array.isArray(item.items) && item.items.length) appendOutlineItems(item.items, entry, depth + 1, count);
    list.appendChild(entry);
  }
  parent.appendChild(list);
}

async function jumpToOutline(destination, button) {
  const documentProxy = pdfDocument;
  if (!documentProxy) return;
  try {
    const target = await navigation.resolveDestinationPage(documentProxy, destination);
    if (documentProxy !== pdfDocument) return;
    if (target === null) throw new Error("该章节未指向有效页码。");
    if (await showPage(target)) {
      activeOutlineButton?.classList.remove("is-active");
      activeOutlineButton = button;
      button.classList.add("is-active");
      if (window.innerWidth <= 900) setOutlineOpen(false);
      stage.scrollIntoView({ block: "start" });
    }
  } catch (error) {
    if (documentProxy === pdfDocument) setStatus(error.message?.trim() || "无法跳转到该章节。", true);
  }
}

function activeDocument() {
  return openDocuments.find((entry) => entry.id === activeDocumentId) || null;
}

function renderDocumentTabs() {
  documentTabs.replaceChildren();
  documentTabs.hidden = openDocuments.length === 0;
  for (const entry of openDocuments) {
    const tab = document.createElement("div");
    tab.className = `document-tab${entry.id === activeDocumentId ? " is-active" : ""}`;
    const select = document.createElement("button");
    select.type = "button";
    select.className = "document-tab-select";
    select.setAttribute("role", "tab");
    select.setAttribute("aria-selected", String(entry.id === activeDocumentId));
    select.title = entry.name;
    select.textContent = entry.name;
    select.addEventListener("click", () => { void activateDocument(entry); });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "document-tab-close";
    close.setAttribute("aria-label", `关闭 ${entry.name}`);
    close.textContent = "×";
    close.addEventListener("click", () => { void closeDocument(entry); });
    tab.append(select, close);
    documentTabs.appendChild(tab);
  }
}

function captureOutlineState() {
  if (toggleOutline.disabled && !tocEntries.length && !outlineList.childNodes.length) return null;
  return {
    nodes: [...outlineList.childNodes], entries: tocEntries, sourceLastPage: tocSourceLastPage,
    labels: tocLabels, offset: tocOffset, useLabels: tocUseLabels, cacheKey: tocCacheKey,
    activeButton: activeOutlineButton, panelHidden: outlinePanel.hidden,
    toggleDisabled: toggleOutline.disabled, emptyHidden: outlineEmpty.hidden,
    emptyText: outlineEmpty.textContent, toolsHidden: tocTools.hidden,
    statusText: scanTocButton.disabled ? "目录识别因切换文件而停止，可重新开始。" : tocStatus.textContent,
    calibrationHidden: tocCalibration.hidden,
    clearHidden: clearTocButton.hidden,
    offsetDisabled: tocOffsetInput.disabled, offsetParentHidden: tocOffsetInput.parentElement.hidden,
    mappingHint: tocMappingHint.textContent
  };
}

function restoreOutlineState(saved) {
  tocEntries = saved.entries;
  tocSourceLastPage = saved.sourceLastPage;
  tocLabels = saved.labels;
  tocOffset = saved.offset;
  tocUseLabels = saved.useLabels;
  tocCacheKey = saved.cacheKey;
  activeOutlineButton = saved.activeButton;
  outlineList.replaceChildren(...saved.nodes);
  outlinePanel.hidden = saved.panelHidden;
  toggleOutline.disabled = saved.toggleDisabled;
  toggleOutline.setAttribute("aria-expanded", String(!saved.panelHidden));
  outlineEmpty.hidden = saved.emptyHidden;
  outlineEmpty.textContent = saved.emptyText;
  tocTools.hidden = saved.toolsHidden;
  tocStatus.textContent = saved.statusText;
  tocCalibration.hidden = saved.calibrationHidden;
  clearTocButton.hidden = saved.clearHidden;
  scanTocButton.disabled = false;
  scanCurrentTocButton.disabled = false;
  tocOffsetInput.value = String(saved.offset);
  tocOffsetInput.disabled = saved.offsetDisabled;
  tocOffsetInput.parentElement.hidden = saved.offsetParentHidden;
  tocMappingHint.textContent = saved.mappingHint;
}

function captureActiveDocument() {
  const current = activeDocument();
  if (!current) return;
  current.page = pageNumber;
  current.scale = scale;
  current.outline = captureOutlineState();
}

async function activateDocument(entry) {
  if (!openDocuments.includes(entry)) return;
  if (activeDocumentId === entry.id && pdfDocument === entry.proxy) return;
  captureActiveDocument();
  const sequence = ++loadSequence;
  renderSequence += 1;
  renderTask?.cancel();
  textLayerTask?.cancel();
  document.dispatchEvent(new Event("hovergloss:pagechange"));
  globalThis.HoverGlossPdfReadingSource = null;
  activeDocumentId = entry.id;
  pdfDocument = entry.proxy;
  documentName = entry.name;
  pageNumber = entry.page;
  scale = entry.scale;
  document.title = `${entry.name} · HoverGloss`;
  urlInput.value = entry.url || "";
  resetOutline();
  if (entry.outline) restoreOutlineState(entry.outline);
  else void loadOutline(entry.proxy, sequence);
  resumePrompt.hidden = !entry.resumePage;
  if (entry.resumePage) resumeText.textContent = `“${entry.name}”上次读到第 ${entry.resumePage} 页。`;
  stage.hidden = Boolean(entry.resumePage);
  renderDocumentTabs();
  updateControls();
  if (entry.resumePage) {
    setStatus("选择继续阅读，或从第 1 页开始。");
    return;
  }
  await showPage(entry.page);
}

async function resolveResume(continueReading) {
  const entry = activeDocument();
  if (!entry?.resumePage) return;
  const target = continueReading ? entry.resumePage : 1;
  entry.resumePage = null;
  resumePrompt.hidden = true;
  updateControls();
  await showPage(target);
}

async function closeDocument(entry) {
  const index = openDocuments.indexOf(entry);
  if (index < 0) return;
  const wasActive = entry.id === activeDocumentId;
  openDocuments.splice(index, 1);
  for (const key of ocrReadingCache.keys()) if (key.startsWith(`${entry.id}:`)) ocrReadingCache.delete(key);
  if (wasActive) {
    activeDocumentId = null;
    if (openDocuments.length) {
      await activateDocument(openDocuments[Math.min(index, openDocuments.length - 1)]);
    } else {
      loadSequence += 1;
      renderSequence += 1;
      renderTask?.cancel();
      textLayerTask?.cancel();
      pdfDocument = null;
      globalThis.HoverGlossPdfReadingSource = null;
      document.dispatchEvent(new Event("hovergloss:pagechange"));
      pageNumber = 1;
      scale = 1;
      stage.hidden = true;
      resumePrompt.hidden = true;
      resetOutline();
      updateControls();
      document.title = "PDF 阅读 · HoverGloss";
      setStatus("打开本地 PDF，或粘贴可直接下载的 HTTPS PDF 链接。");
    }
  }
  renderDocumentTabs();
  entry.contextPages?.clear();
  try { await entry.task.destroy(); } catch { /* Closing a document should not block other tabs. */ }
}

async function openRemote(value) {
  if (!source.isAllowedRemoteUrl(value)) {
    setStatus("只接受 HTTPS PDF 链接；本地文件请使用“打开本地 PDF”。", true);
    return;
  }
  const alreadyOpen = openDocuments.find((entry) => entry.url === value);
  if (alreadyOpen) return activateDocument(alreadyOpen);
  if (openDocuments.length >= MAX_OPEN_DOCUMENTS) {
    setStatus("最多同时打开 8 份 PDF；请先关闭一个文件标签。", true);
    return;
  }
  const sequence = ++loadSequence;
  setStatus("正在读取 PDF…");
  try {
    const response = await fetch(value, { credentials: "include", cache: "no-store" });
    if (sequence !== loadSequence) return;
    if (!response.ok) throw new Error(`无法获取 PDF（HTTP ${response.status}）。`);
    if (!source.isAllowedRemoteUrl(response.url)) throw new Error("PDF 链接跳转到了非 HTTPS 地址，已停止加载。");
    const declaredSize = Number(response.headers.get("content-length"));
    if (declaredSize > source.MAX_PDF_BYTES) throw new Error("PDF 超过 60 MB，暂不支持直接打开。");
    const bytes = await readLimited(response);
    if (sequence !== loadSequence) return;
    const name = new URL(response.url).pathname.split("/").pop() || "在线 PDF";
    await openBytes(bytes, name, sequence, value);
  } catch (error) {
    if (sequence === loadSequence) setStatus(error.message || "无法打开 PDF；可先下载文件后从本地导入。", true);
  }
}

async function readLimited(response) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > source.MAX_PDF_BYTES) throw new Error("PDF 超过 60 MB，暂不支持直接打开。");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > source.MAX_PDF_BYTES) throw new Error("PDF 超过 60 MB，暂不支持直接打开。");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function openBytes(bytes, name, sequence = ++loadSequence, url = "") {
  if (!source.hasPdfHeader(bytes)) throw new Error("读取到的内容不是 PDF；请检查链接或文件。");
  if (loadingTask) await loadingTask.destroy();
  if (sequence !== loadSequence) return;
  setStatus("正在解析 PDF…");
  const task = pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: chrome.runtime.getURL("vendor/pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL("vendor/pdfjs/standard_fonts/"),
    isEvalSupported: false
  });
  loadingTask = task;
  let loaded;
  try { loaded = await task.promise; }
  catch (error) {
    await task.destroy().catch(() => {});
    throw error;
  }
  finally { if (loadingTask === task) loadingTask = null; }
  if (sequence !== loadSequence) {
    await task.destroy();
    return;
  }
  const fingerprint = loaded.fingerprints?.[0] || "";
  const existing = openDocuments.find((entry) => fingerprint && entry.fingerprint === fingerprint);
  if (existing) {
    await task.destroy();
    await activateDocument(existing);
    return;
  }
  if (openDocuments.length >= MAX_OPEN_DOCUMENTS) {
    await task.destroy();
    setStatus("最多同时打开 8 份 PDF；请先关闭一个文件标签。", true);
    return;
  }
  const progressKey = pdfSession.progressKey(fingerprint);
  let progress = null;
  if (progressKey) {
    try {
      const stored = await chrome.storage.local.get(progressKey);
      progress = pdfSession.readProgress(stored[progressKey], loaded.numPages);
    } catch { /* Reading remains available when progress storage is unavailable. */ }
  }
  if (sequence !== loadSequence) {
    await task.destroy();
    return;
  }
  const entry = {
    id: ++nextDocumentId, name, url, task, proxy: loaded, fingerprint,
    progressKey, page: 1, scale: progress?.scale || 1,
    resumePage: progress?.page > 1 ? progress.page : null,
    outline: null, progressWrite: Promise.resolve()
  };
  openDocuments.push(entry);
  await activateDocument(entry);
}

async function changeZoom(delta) {
  scale = Math.max(0.6, Math.min(1.8, Math.round((scale + delta) * 10) / 10));
  await showPage(pageNumber);
}

function pageContext(entry, number, loadedPage = null, loadedText = null) {
  if (!entry || number < 1 || number > entry.proxy.numPages) return Promise.resolve(null);
  const cache = entry.contextPages || (entry.contextPages = new Map());
  if (cache.has(number)) return cache.get(number);
  const operation = (async () => {
    const page = loadedPage || await entry.proxy.getPage(number);
    const content = loadedText || await page.getTextContent();
    return globalThis.HoverGlossPdfContext.build(content, page.getViewport({ scale: 1 }));
  })();
  cache.set(number, operation);
  // Only neighbouring page layouts are retained, scoped to this open document.
  while (cache.size > 6) cache.delete(cache.keys().next().value);
  operation.catch(() => { if (cache.get(number) === operation) cache.delete(number); });
  return operation;
}

async function pageReadingContext(entry, number, page, text) {
  const current = await pageContext(entry, number, page, text);
  if (!current) return globalThis.HoverGlossPdfContext.build(text, page.getViewport({ scale: 1 }));
  const neighbours = await Promise.allSettled([pageContext(entry, number - 1), pageContext(entry, number + 1)]);
  return globalThis.HoverGlossPdfContext.bridgePages(current,
    neighbours[0].status === "fulfilled" ? neighbours[0].value : null,
    neighbours[1].status === "fulfilled" ? neighbours[1].value : null);
}

async function showPage(number) {
  if (!pdfDocument || number < 1 || number > pdfDocument.numPages) return false;
  const entry = activeDocument();
  if (entry?.resumePage) {
    entry.resumePage = null;
    resumePrompt.hidden = true;
  }
  const sequence = ++renderSequence;
  const pageChanged = pageNumber !== number;
  pageNumber = number;
  if (pageChanged) {
    activeOutlineButton?.classList.remove("is-active");
    activeOutlineButton = null;
  }
  updateControls();
  document.dispatchEvent(new Event("hovergloss:pagechange"));
  window.getSelection()?.removeAllRanges();
  const previousRender = renderTask;
  previousRender?.cancel();
  textLayerTask?.cancel();
  if (previousRender) {
    try { await previousRender.promise; } catch { /* A cancelled render is expected. */ }
  }
  if (sequence !== renderSequence) return false;
  setStatus(`正在显示第 ${number} 页…`);
  try {
    const page = await pdfDocument.getPage(number);
    if (sequence !== renderSequence) return false;
    const viewport = page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法绘制 PDF 页面。");
    canvas.width = Math.ceil(viewport.width * dpr);
    canvas.height = Math.ceil(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    paper.style.width = `${viewport.width}px`;
    paper.style.height = `${viewport.height}px`;
    paper.style.setProperty("--total-scale-factor", String(viewport.scale));
    textLayerElement.replaceChildren();
    stage.hidden = false;
    renderTask = page.render({
      canvasContext: context,
      viewport,
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0]
    });
    await renderTask.promise;
    if (sequence !== renderSequence) return false;
    ocrPageSource = { page, number };
    updateOcrControls();
    const textContent = await page.getTextContent();
    if (sequence !== renderSequence) return false;
    const readingContext = await pageReadingContext(entry, number, page, textContent);
    if (sequence !== renderSequence || entry?.id !== activeDocumentId) return false;
    textLayerTask = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textLayerElement,
      viewport
    });
    await textLayerTask.render();
    if (sequence !== renderSequence) return false;
    const chunks = textLayerTask.textContentItemsStr;
    globalThis.HoverGlossPdfReadingSource = {
      type: "pdf", title: entry?.name || documentName, url: entry?.url || "",
      fingerprint: entry?.fingerprint || "", page: number
    };
    globalThis.HoverGlossPdfContext.attach(textLayerTask, textContent, viewport, readingContext);
    copyPageSource = { textContent, viewport };
    cleanPage.disabled = false;
    const cachedOcr = ocrReadingCache.get(ocrReadingKey());
    const restoredOcr = cachedOcr && applyOcrReading(cachedOcr);
    setStatus(restoredOcr ? `第 ${number} 页已恢复 OCR 文字，可 Alt 悬停或拖选翻译；请核对识别结果。` : chunks.some((part) => part.trim())
      ? `${documentName} · 第 ${number} / ${pdfDocument.numPages} 页`
      : `第 ${number} 页没有可选中的文字；可点击“OCR 识字”识别当前页或框选区域。`);
    if (entry && entry.id === activeDocumentId) {
      entry.page = number;
      entry.scale = scale;
      if (entry.progressKey) {
        const saved = pdfSession.progressRecord(number, scale);
        entry.progressWrite = entry.progressWrite.then(() =>
          chrome.storage.local.set({ [entry.progressKey]: saved })
        ).catch(() => { /* An unavailable store must not interrupt reading. */ });
      }
    }
    if (pageChanged) stage.scrollIntoView({ block: "start" });
    return true;
  } catch (error) {
    if (sequence !== renderSequence || error?.name === "RenderingCancelledException") return false;
    setStatus(error.message || "PDF 页面显示失败。", true);
    return false;
  }
}
