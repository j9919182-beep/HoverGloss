(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossPdfOcr = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const LANGUAGES = new Set(["eng", "chi_sim+eng"]);
  const abortError = () => Object.assign(new Error("OCR 已取消。"), { name: "AbortError" });

  // The wire protocol belongs to the pinned Tesseract.js 6.0.1 worker.
  // Owning the Worker directly lets cancellation terminate even initialization immediately.
  function createClient({ getURL, WorkerClass = globalThis.Worker, timeoutMs = 120000 } = {}) {
    let current = null;
    function stop(error = abortError()) {
      if (!current) return;
      const session = current;
      current = null;
      clearTimeout(session.timer);
      session.worker.terminate();
      for (const pending of session.pending.values()) pending.reject(error);
      session.pending.clear();
    }
    async function recognize(image, language = "eng", { onProgress = () => {}, region = false } = {}) {
      if (!LANGUAGES.has(language)) throw new Error("请选择英文或简体中文＋英文。");
      if (!(image instanceof Uint8Array) || !image.byteLength || image.byteLength > 32 * 1024 * 1024) throw new Error("OCR 图像无效或过大，请缩小识别范围。");
      stop();
      const worker = new WorkerClass(getURL("vendor/local-ocr/worker.min.js"));
      const session = { worker, pending: new Map(), nextId: 0, timer: null };
      current = session;
      session.timer = setTimeout(() => { if (current === session) stop(new Error("识别超时，请缩小范围后重试。")); }, timeoutMs);
      worker.onmessage = ({ data: packet }) => {
        if (current !== session) return;
        if (packet.status === "progress") { onProgress(packet.data); return; }
        const pending = session.pending.get(packet.jobId);
        if (!pending) return;
        session.pending.delete(packet.jobId);
        if (packet.status === "resolve") pending.resolve(packet.data);
        else pending.reject(new Error("本地 OCR 识别失败，请重试或更换识别语言。"));
      };
      worker.onerror = (event) => { event.preventDefault?.(); if (current === session) stop(new Error("本地 OCR 引擎无法启动，请检查扩展文件是否完整。")); };
      worker.onmessageerror = () => { if (current === session) stop(new Error("OCR 数据传输失败，请重试。")); };
      const ask = (action, payload) => new Promise((resolve, reject) => {
        if (current !== session) { reject(abortError()); return; }
        const jobId = String(++session.nextId);
        session.pending.set(jobId, { resolve, reject });
        try { worker.postMessage({ workerId: "hovergloss-ocr", jobId, action, payload }); }
        catch (error) { session.pending.delete(jobId); reject(error); }
      });
      try {
        await ask("load", { options: { lstmOnly: true, corePath: getURL("vendor/local-ocr/core"), logging: false } });
        await ask("loadLanguage", { langs: language, options: {
          langPath: getURL("vendor/local-ocr/languages"), cacheMethod: "none", gzip: true, lstmOnly: true
        } });
        await ask("initialize", { langs: language, oem: 1, config: {} });
        await ask("setParameters", { params: { tessedit_pageseg_mode: region ? "6" : "3", user_defined_dpi: "216" } });
        return await ask("recognize", { image, options: {}, output: { text: true, blocks: true } });
      } finally { if (current === session) stop(); }
    }
    return { recognize, cancel: stop };
  }

  function normalizedRect(start, end) {
    const clamp = (value) => Math.max(0, Math.min(1, value));
    const x0 = clamp(Math.min(start.x, end.x)), x1 = clamp(Math.max(start.x, end.x));
    const y0 = clamp(Math.min(start.y, end.y)), y1 = clamp(Math.max(start.y, end.y));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  function renderPlan(viewport, rectangle = { x: 0, y: 0, width: 1, height: 1 }) {
    if (![viewport.width, viewport.height, rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite)
      || viewport.width <= 0 || viewport.height <= 0 || rectangle.width <= 0 || rectangle.height <= 0
      || rectangle.x < 0 || rectangle.y < 0 || rectangle.x + rectangle.width > 1.000001 || rectangle.y + rectangle.height > 1.000001) throw new Error("识别范围无效，请重新框选。");
    const width = viewport.width * rectangle.width, height = viewport.height * rectangle.height;
    const scale = Math.min(3, Math.sqrt(16000000 / (width * height)), 6000 / Math.max(width, height));
    return { scale, left: viewport.width * rectangle.x * scale, top: viewport.height * rectangle.y * scale,
      width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
  }

  function toPreview(data, imageHeight) {
    const items = [];
    let layoutFallback = false;
    const addLine = (text, bbox, font) => {
      if (!text?.trim() || !bbox || ![bbox.x0, bbox.x1, bbox.y0, bbox.y1].every(Number.isFinite) || bbox.x1 <= bbox.x0 || bbox.y1 <= bbox.y0) return;
      const size = Math.max(1, bbox.y1 - bbox.y0);
      items.push({ str: text.trim(), width: bbox.x1 - bbox.x0, height: size,
        transform: [size, 0, 0, size, bbox.x0, imageHeight - bbox.y1], fontName: font, hasEOL: true, dir: "ltr" });
    };
    (data.blocks || []).forEach((block, blockIndex) => {
      (block.paragraphs || []).forEach((paragraph, paragraphIndex) => {
        (paragraph.lines || []).forEach((line) => addLine(line.text || (line.words || []).map((word) => word.text).join(" "), line.bbox, `ocr-${blockIndex}-${paragraphIndex}`));
      });
    });
    if (!items.length && data.text?.trim()) {
      layoutFallback = true;
      let y = 0;
      for (const line of data.text.split(/\r?\n/)) {
        y += line.trim() ? 13 : 26;
        addLine(line, { x0: 0, x1: Math.max(10, line.length * 6), y0: y, y1: y + 10 }, "ocr-fallback");
      }
    }
    return { textContent: { items }, viewport: { transform: [1, 0, 0, -1, 0, imageHeight] },
      raw: data.text || "", confidence: data.confidence, layoutFallback, ocr: true };
  }
  // Keep OCR paragraph boundaries and word boxes: a page-wide string is not a reading context.
  function readingLayer(data, plan, displayScale) {
    const items = [], contexts = [], boxes = [];
    const ratio = displayScale / plan.scale;
    for (const block of data.blocks || []) for (const paragraph of block.paragraphs || []) {
      const blockId = items.length;
      let text = "";
      const entries = [];
      for (const line of paragraph.lines || []) {
        const words = line.words?.length ? line.words : [line];
        for (const word of words) {
          const value = word.text?.trim(), b = word.bbox;
          if (!value || !b || ![b.x0, b.x1, b.y0, b.y1].every(Number.isFinite)
            || b.x1 <= b.x0 || b.y1 <= b.y0) continue;
          if (text) text += " ";
          entries.push({ value, b, offset: text.length });
          text += value;
        }
      }
      for (const { value, b, offset } of entries) {
        const x = (plan.left + b.x0) * ratio, y = (plan.top + b.y0) * ratio;
        const width = (b.x1 - b.x0) * ratio, height = (b.y1 - b.y0) * ratio;
        const str = value + (offset + value.length < text.length ? " " : "\n\n");
        items.push({ str, width, height, transform: [height, 0, 0, height, x, -y - height], dir: "ltr", fontName: `ocr-${blockId}` });
        boxes.push({ x, y, width, height });
        contexts.push({ text, offset, blockId });
      }
    }
    return { textContent: { items }, viewport: { transform: [1, 0, 0, -1, 0, 0] }, contexts, boxes,
      ocr: true, raw: data.text || "", confidence: data.confidence };
  }

  function mountReadingLayer(container, reading) {
    const doc = container.ownerDocument;
    const measure = doc.createElement("canvas").getContext("2d");
    const fragment = doc.createDocumentFragment();
    const textDivs = reading.textContent.items.map((item, index) => {
      const span = doc.createElement("span"), box = reading.boxes[index];
      span.textContent = item.str;
      span.__hoverGlossContext = reading.contexts[index];
      measure.font = `${box.height}px sans-serif`;
      const width = measure.measureText(item.str.trimEnd()).width || box.width;
      Object.assign(span.style, { left: `${box.x}px`, top: `${box.y}px`, fontSize: `${box.height}px`,
        fontFamily: "sans-serif", lineHeight: "1", height: `${box.height}px`, transform: `scaleX(${box.width / width})` });
      fragment.append(span);
      // Spaces belong inside positioned spans; browsers omit standalone whitespace between them.
      return span;
    });
    container.replaceChildren(fragment);
    return { textDivs, textContentItemsStr: reading.textContent.items.map((item) => item.str), cancel() {} };
  }
  return { createClient, normalizedRect, renderPlan, toPreview, readingLayer, mountReadingLayer };
});
