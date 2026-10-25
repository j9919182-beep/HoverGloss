(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossPdfContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function point(matrix, x, y) {
    return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
  }

  function makeRun(item, index, matrix) {
    const text = item.str;
    const t = item.transform;
    if (!text.trim() || !Array.isArray(t) || t.length < 6 || !t.every(Number.isFinite)) return null;
    const advance = Math.hypot(t[0], t[1]);
    if (!advance) return null;
    const start = point(matrix, t[4], t[5]);
    const end = point(matrix, t[4] + t[0] / advance * item.width, t[5] + t[1] / advance * item.width);
    const size = Math.hypot(matrix[0] * t[2] + matrix[2] * t[3], matrix[1] * t[2] + matrix[3] * t[3]);
    if (!size || ![...start, ...end, size].every(Number.isFinite)) return null;
    // Uncertain/vertical reading directions keep their own text instead of absorbing nearby columns.
    if (item.dir === "ttb" || item.dir === "rtl" || end[0] < start[0] || Math.abs(end[1] - start[1]) > size * 0.3) return null;
    return {
      index, text, x: start[0], right: end[0], y: start[1], size,
      font: item.fontName || "", hasEOL: item.hasEOL === true
    };
  }

  function dominant(runs, key) {
    const weights = new Map();
    for (const run of runs) weights.set(run[key], (weights.get(run[key]) || 0) + run.text.trim().length);
    return [...weights].sort((left, right) => right[1] - left[1])[0]?.[0];
  }

  function makeLine(runs) {
    return {
      runs, x: Math.min(...runs.map((run) => run.x)), right: Math.max(...runs.map((run) => run.right)),
      y: runs.reduce((sum, run) => sum + run.y, 0) / runs.length,
      size: dominant(runs, "size"), font: dominant(runs, "font"),
      text: runs.map((run) => run.text).join(" ").trim()
    };
  }

  function buildLines(runs) {
    const rows = [];
    for (const run of [...runs].sort((a, b) => a.y - b.y || a.x - b.x)) {
      let row = rows.slice(-8).find((candidate) => Math.abs(candidate.y - run.y) <= Math.min(candidate.size, run.size) * 0.25);
      if (!row) {
        row = { y: run.y, size: run.size, runs: [] };
        rows.push(row);
      }
      row.runs.push(run);
      row.size = Math.min(row.size, run.size);
    }
    const lines = [];
    for (const row of rows) {
      let group = [];
      for (const run of row.runs.sort((a, b) => a.x - b.x)) {
        const previous = group.at(-1);
        const size = previous ? Math.min(previous.size, run.size) : run.size;
        const gap = previous ? run.x - previous.right : 0;
        const differentSize = previous && Math.max(previous.size, run.size) / size > 1.25;
        if (previous && (gap > size * 1.2 || previous.hasEOL && gap > size * 0.4 || differentSize)) {
          lines.push(makeLine(group));
          group = [];
        }
        group.push(run);
      }
      if (group.length) lines.push(makeLine(group));
    }
    return lines.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function canContinue(block, line) {
    const previous = block.lines.at(-1);
    const size = Math.min(previous.size, line.size);
    const gap = line.y - previous.y;
    if (gap < size * 0.7 || gap > size * 1.65) return false;
    if (Math.max(previous.size, line.size) / size > 1.18) return false;
    if (previous.font && line.font && previous.font !== line.font) return false;
    if (block.lineGap && gap > block.lineGap * 1.25) return false;
    const shift = line.x - block.x;
    // A new first-line indent starts a new paragraph; a following line may return to the left margin.
    if (shift > size * 0.7 || shift < -size * (block.lines.length === 1 ? 2 : 0.7)) return false;
    const previousWidth = previous.right - previous.x;
    const nextWidth = line.right - line.x;
    if (previousWidth < Math.max(block.maxWidth, nextWidth) * 0.72) return false;
    return true;
  }

  function runSeparator(previous, current) {
    if (!previous || /\s$/.test(previous.text) || /^\s/.test(current.text)) return "";
    if (/^[,.;:!?，。！？、)\]}]/.test(current.text) || /[(\[{]$/.test(previous.text)) return "";
    return current.x - previous.right > Math.min(previous.size, current.size) * 0.08 ? " " : "";
  }

  function build(textContent = {}, viewport = {}) {
    const items = (textContent.items || []).filter((item) => typeof item.str === "string");
    const matrix = Array.isArray(viewport.transform) ? viewport.transform : [1, 0, 0, -1, 0, 0];
    const runs = items.map((item, index) => makeRun(item, index, matrix)).filter(Boolean);
    const groups = [];
    for (const line of buildLines(runs)) {
      const candidates = groups.filter((group) => canContinue(group, line));
      const group = candidates.sort((a, b) =>
        line.y - a.lines.at(-1).y - (line.y - b.lines.at(-1).y) || Math.abs(a.x - line.x) - Math.abs(b.x - line.x)
      )[0];
      if (group) {
        const gap = line.y - group.lines.at(-1).y;
        group.lineGap = group.lineGap ? Math.min(group.lineGap, gap) : gap;
        group.lines.push(line);
        group.x = Math.min(group.x, line.x);
        group.maxWidth = Math.max(group.maxWidth, line.right - line.x);
      } else groups.push({ lines: [line], x: line.x, maxWidth: line.right - line.x, lineGap: 0 });
    }
    const contexts = Array(items.length).fill(null);
    const blocks = [];
    for (const group of groups) {
      let text = "";
      const offsets = [];
      const lines = [];
      for (const line of group.lines) {
        if (text && !/\s$/.test(text)) text += " ";
        const lineStart = text.length;
        let previous = null;
        for (const run of line.runs) {
          text += runSeparator(previous, run);
          offsets.push({ index: run.index, offset: text.length });
          text += run.text;
          previous = run;
        }
        lines.push({ text: text.slice(lineStart), x: line.x, right: line.right, y: line.y, size: line.size });
      }
      const blockId = blocks.length;
      const font = dominant(group.lines.flatMap((line) => line.runs), "font");
      blocks.push({ text, lines, x: group.x, right: Math.max(...lines.map((line) => line.right)),
        y: lines[0].y - lines[0].size, bottom: lines.at(-1).y, size: lines[0].size,
        font, family: textContent.styles?.[font]?.fontFamily || "" });
      for (const entry of offsets) contexts[entry.index] = { text, offset: entry.offset, blockId };
    }
    // Missing coordinates and unusual layouts never fall back to text from the entire page.
    items.forEach((item, index) => {
      if (!contexts[index]) contexts[index] = { text: item.str, offset: 0, blockId: -1 };
    });
    return { blocks, contexts, width: viewport.width, height: viewport.height };
  }

  // Read one column fully before moving to the next; painting order is not reading order.
  function readingOrder(blocks, depth = 0) {
    if (blocks.length < 2 || depth > 32) return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
    const sizes = blocks.map((block) => block.size).sort((a, b) => a - b), size = sizes[Math.floor(sizes.length / 2)];
    for (const axis of ["x", "y"]) {
      const end = axis === "x" ? "right" : "bottom", sorted = [...blocks].sort((a, b) => a[axis] - b[axis]);
      let boundary = sorted[0][end], bestGap = size * (axis === "x" ? 1.2 : 0.6), split = -1;
      for (let index = 1; index < sorted.length; index++) {
        const gap = sorted[index][axis] - boundary;
        if (gap > bestGap) { bestGap = gap; split = index; }
        boundary = Math.max(boundary, sorted[index][end]);
      }
      if (split > 0) return [...readingOrder(sorted.slice(0, split), depth + 1), ...readingOrder(sorted.slice(split), depth + 1)];
    }
    return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function repeatedMargin(layout, block, neighbours) {
    const key = (text) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
    if (block.lines.length !== 1 || block.text.length > 100 || /[.!?。！？][”’"')\]]*$/.test(block.text.trim())) return false;
    if (!(block.y < layout.height * 0.15 || block.bottom > layout.height * 0.85)) return false;
    return neighbours.some((neighbour) => neighbour?.height && neighbour.blocks.some((other) =>
      Math.abs(other.y / neighbour.height - block.y / layout.height) < 0.04 && key(other.text) === key(block.text)));
  }

  function bodyBlocks(layout, neighbours = []) {
    if (!layout || !Number.isFinite(layout.height) || layout.height <= 0) return [];
    const candidates = layout.blocks.filter((block) => block.y >= layout.height * 0.045 && block.bottom <= layout.height * 0.94 &&
      block.text.trim().length >= 8 && /[\p{Script=Latin}]/u.test(block.text) && !repeatedMargin(layout, block, neighbours) &&
      !/^(?:https?:\/\/|www\.|Source\s*:|©)/i.test(block.text.trim()));
    if (!candidates.length) return [];
    const size = dominant(candidates, "size");
    return readingOrder(candidates.filter((block) => Math.max(block.size, size) / Math.min(block.size, size) <= 1.1));
  }

  function continuation(left, right) {
    if (!left || !right || left.text.length > 6000 || right.text.length > 6000 ||
        Math.max(left.size, right.size) / Math.min(left.size, right.size) > 1.1) return false;
    if (left.font && right.font && left.font !== right.font && !(left.family && left.family === right.family)) return false;
    if (right.lines[0].x - right.x > right.size * 0.7) return false;
    const tail = left.text.trim(), head = right.text.trim();
    if (!tail || !head || /[.!?。！？][”’"')\]]*$/.test(tail)) return false;
    if (/^(?:[•●▪◦]|\d+[.)]\s|Chapter\s|Contents\b)/i.test(head)) return false;
    if (/^[“”"'‘’(\[]*[\p{Ll}\p{N},;:]/u.test(head)) return true;
    // Upper-case names can follow a hanging determiner, preposition or auxiliary.
    return !/^(?:The|A|An|Le|La|Les|Un|Une)\b/.test(head) && /\b(?:a|an|the|of|to|for|with|from|by|in|on|at|and|or|but|is|are|was|were|has|have|had|be|been|that|which|as|de|du|des|le|la|les|un|une|et|à|au|aux)\s*$/iu.test(tail) && /^[“”"'‘’(\[]*\p{Lu}/u.test(head);
  }

  function clearEdge(layout, block, first) {
    if (!block) return false;
    return !layout.blocks.some((other) => other !== block && other.y >= layout.height * 0.035 && other.bottom >= layout.height * 0.065 && other.bottom <= layout.height * 0.94 &&
      other.text.trim().length >= 8 && other.size > block.size * 1.18 &&
      Math.min(block.right, other.right) - Math.max(block.x, other.x) > Math.min(block.right - block.x, other.right - other.x) * 0.5 &&
      (first ? other.bottom <= block.y : other.y >= block.bottom));
  }

  function bridgePages(current, previous, next) {
    const body = bodyBlocks(current, [previous, next]), before = bodyBlocks(previous, [current]).at(-1), after = bodyBlocks(next, [current])[0];
    if (!body.length) return current;
    const first = body[0], last = body.at(-1);
    const join = (left, right) => /[-‐‑\u00ad]$/.test(left) && /^\p{Ll}/u.test(right) ? "" : " ";
    const prefix = clearEdge(previous, before, false) && clearEdge(current, first, true) && continuation(before, first)
      ? before.text + join(before.text, first.text) : "";
    const suffix = clearEdge(current, last, false) && clearEdge(next, after, true) && continuation(last, after)
      ? join(last.text, after.text) + after.text : "";
    if (!prefix && !suffix) return current;
    const firstId = current.blocks.indexOf(first), lastId = current.blocks.indexOf(last);
    return { ...current, contexts: current.contexts.map((context) => {
      const start = context.blockId === firstId ? prefix : "", end = context.blockId === lastId ? suffix : "";
      return start || end ? { ...context, text: start + context.text + end, offset: start.length + context.offset } : context;
    }) };
  }

  function attach(textLayer, textContent, viewport, result = build(textContent, viewport)) {
    for (let index = 0; index < textLayer.textDivs.length; index += 1) {
      const span = textLayer.textDivs[index];
      const raw = textLayer.textContentItemsStr[index] || "";
      const context = result.contexts[index];
      // Check the PDF.js index mapping before attaching a context to a rendered span.
      span.__hoverGlossContext = context?.text.slice(context.offset, context.offset + raw.length) === raw
        ? context : { text: raw, offset: 0, blockId: -1 };
    }
    return result;
  }

  return { build, attach, bridgePages };
});
