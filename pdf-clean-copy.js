(function (root, factory) {
  const context = typeof module === "object" && module.exports ? require("./pdf-context.js") : root.HoverGlossPdfContext;
  const api = factory(context);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossPdfCleanCopy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (context) {
  "use strict";

  const ligatures = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };
  function clean(text) {
    return text.replace(/[ﬀ-ﬆ]/g, (char) => ligatures[char]).replace(/\u00ad/g, "")
      .replace(/[\u00a0\u2007\u202f]/g, " ").replace(/[\u200b\ufeff]/g, "")
      .replace(/[\t ]+/g, " ").replace(/([\p{Script=Han}]) +(?=[\p{Script=Han}])/gu, "$1")
      .replace(/ +([，。！？、；：])/g, "$1").trim();
  }

  function joinLines(lines, options) {
    let result = "";
    for (const line of lines) {
      const text = clean(line.text);
      if (!text) continue;
      if (!result) { result = text; continue; }
      if (/^(?:[•●▪◦]|[-*] |\d+[.)] )/.test(text)) { result += `\n${text}`; continue; }
      if (!options.mergeLines) { result += `\n${text}`; continue; }
      // Ambiguous hyphens stay intact unless the user explicitly enables this option.
      if (options.joinHyphens && /[a-z]-$/.test(result) && /^[a-z]/.test(text)) result = result.slice(0, -1) + text;
      else if (/[-‐‑]$/.test(result) && /^[a-z]/i.test(text)) result += text;
      else result += /\p{Script=Han}$|[，。！？、；：]$/u.test(result) && /^\p{Script=Han}/u.test(text)
        || /^[,.;:!?，。！？、；：)\]}]/.test(text) ? text : ` ${text}`;
    }
    return result;
  }

  // Recursive whitespace cuts: columns are read top-to-bottom before moving right.
  // Full-width headings prevent a vertical cut, so a horizontal cut isolates them first.
  function readingOrder(blocks, depth = 0) {
    if (blocks.length < 2 || depth > 64) return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
    const size = [...blocks].map((block) => block.size).sort((a, b) => a - b)[Math.floor(blocks.length / 2)];
    for (const axis of ["x", "y"]) {
      const end = axis === "x" ? "right" : "bottom";
      const sorted = [...blocks].sort((a, b) => a[axis] - b[axis]);
      let boundary = sorted[0][end];
      let bestGap = axis === "x" ? size * 1.2 : size * 0.6;
      let split = -1;
      for (let index = 1; index < sorted.length; index += 1) {
        const gap = sorted[index][axis] - boundary;
        if (gap > bestGap) { bestGap = gap; split = index; }
        boundary = Math.max(boundary, sorted[index][end]);
      }
      if (split > 0) return [...readingOrder(sorted.slice(0, split), depth + 1), ...readingOrder(sorted.slice(split), depth + 1)];
    }
    return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function originalText(items) {
    let text = "";
    for (const item of items) {
      text += item.str;
      text += item.hasEOL ? "\n" : " ";
    }
    return text.trim();
  }

  function assess(text) {
    if (!text.trim()) return { kind: "empty", message: "没有可提取的文字，可能是扫描图片或文字层不可用。可点击“OCR 识字”从页面图像重新识别。" };
    if (/[\ufffd\ue000-\uf8ff\u{f0000}-\u{ffffd}\u{100000}-\u{10fffd}\x00-\x08\x0b\x0e-\x1f]|\(cid:\d+\)/u.test(text)) {
      return { kind: "suspect", message: "检测到疑似乱码或异常字形。整理只能调整排版，无法恢复错误字符；请对照原页，必要时使用 OCR。" };
    }
    return { kind: "text", message: "已整理文字层。请核对阅读顺序、表格和特殊符号；未检测到异常字符也不代表文字一定正确。" };
  }

  function prepare(textContent, viewport, settings = {}) {
    const options = { mergeLines: true, joinHyphens: false, order: "auto", ...settings };
    const items = (textContent.items || []).filter((item) => typeof item.str === "string");
    const raw = originalText(items);
    const quality = assess(raw);
    const layout = context.build({ ...textContent, items }, viewport);
    const unplaced = items.filter((item, index) => item.str.trim() && layout.contexts[index].blockId === -1);
    const blocks = readingOrder(layout.blocks);
    const text = options.order === "original" ? raw.split(/\r?\n/).map(clean).join("\n")
      : [...blocks.map((block) => joinLines(block.lines, options)), ...unplaced.map((item) => clean(item.str))].filter(Boolean).join("\n\n");
    return { raw, text, quality, uncertainLayout: unplaced.length > 0 };
  }

  // Read exact character intersections from PDF.js spans, including partial first/last words.
  function selectedContent(layer, textContent, selection) {
    if (!selection || selection.isCollapsed || !selection.rangeCount) return { items: [] };
    const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index));
    const items = (textContent.items || []).filter((item) => typeof item.str === "string");
    const selected = [];
    layer.textDivs.forEach((span, index) => {
      const item = items[index];
      if (!item || span.textContent !== item.str) return;
      const walker = span.ownerDocument.createTreeWalker(span, 4);
      let node;
      let base = 0;
      const intervals = [];
      while ((node = walker.nextNode())) {
        for (const range of ranges) {
          if (!range.intersectsNode(node)) continue;
          const lower = (test) => {
            let low = 0, high = node.length;
            while (low < high) {
              const mid = Math.floor((low + high) / 2);
              if (test(range.comparePoint(node, mid))) high = mid; else low = mid + 1;
            }
            return low;
          };
          const start = lower((position) => position >= 0);
          const end = lower((position) => position > 0);
          // comparePoint includes the end boundary; locate it without copying the next character.
          const last = end > start && range.comparePoint(node, end) > 0 ? end - 1 : end;
          if (last > start) intervals.push([base + start, base + last]);
        }
        base += node.length;
      }
      intervals.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const interval of intervals) {
        const previous = merged.at(-1);
        if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
        else merged.push([...interval]);
      }
      for (const [start, end] of merged) {
        const part = { ...item, str: item.str.slice(start, end) };
        if (Array.isArray(item.transform) && item.str.length) {
          const transform = [...item.transform];
          const advance = Math.hypot(transform[0], transform[1]);
          const shift = item.width * start / item.str.length;
          if (advance) { transform[4] += transform[0] / advance * shift; transform[5] += transform[1] / advance * shift; }
          part.transform = transform;
          part.width = item.width * (end - start) / item.str.length;
        }
        selected.push(part);
      }
    });
    return { ...textContent, items: selected };
  }

  return { prepare, assess, selectedContent };
});
