(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossTocDetect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_ENTRIES = 250;
  const HEADING = /^(?:table\s+of\s+contents|contents|目\s*录|目次)$/i;

  function extractLines(textContent = {}) {
    const rows = [];
    const fallback = [];
    let pending = "";
    for (const item of textContent.items || []) {
      const value = String(item.str || "");
      if (!value.trim()) continue;
      const transform = item.transform;
      if (Array.isArray(transform) && Number.isFinite(transform[4]) && Number.isFinite(transform[5])) {
        const x = transform[4];
        const y = transform[5];
        let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
        if (!row) {
          row = { y, parts: [] };
          rows.push(row);
        }
        row.parts.push({ text: value, x, width: Number(item.width) || 0 });
      } else {
        pending += value;
        if (item.hasEOL) {
          fallback.push({ text: pending.trim(), x: 0, y: -fallback.length });
          pending = "";
        }
      }
    }
    if (pending.trim()) fallback.push({ text: pending.trim(), x: 0, y: -fallback.length });
    if (!rows.length) return fallback;
    return rows.sort((a, b) => b.y - a.y).map((row) => {
      const parts = row.parts.sort((a, b) => a.x - b.x);
      let text = "";
      let right = null;
      for (const part of parts) {
        if (right !== null) {
          const gap = part.x - right;
          if (gap > 14) text += "   ";
          else if (gap > 2) text += " ";
        }
        text += part.text;
        right = Math.max(right ?? -Infinity, part.x + part.width);
      }
      return { text: text.trim(), x: parts[0]?.x || 0, y: row.y };
    }).filter((line) => line.text);
  }

  function parseTocLine(line) {
    const raw = String(line.text || "").trim();
    const match = raw.match(/^(.*?)(?:\s+|[.．·•…_]{2,})(\d{1,4}|[ivxlcdm]{1,8})\s*$/i);
    if (!match) return null;
    const prefix = match[1];
    const hasLeader = /(?:[.．·•…_]{2,}|\s{2,})\s*$/.test(prefix) || /[.．·•…_]{2,}\s*(?:\d{1,4}|[ivxlcdm]{1,8})$/i.test(raw);
    const title = prefix.replace(/[.．·•…_\s]+$/g, "").trim();
    if (title.length < 2 || title.length > 160) return null;
    if (!/[A-Za-z\u3400-\u9fff]/.test(title)) return null;
    if (!hasLeader && /^(?:chapter|section|part|第.{1,8}[章节篇])$/i.test(title)) return null;
    const label = match[2];
    const number = /^\d+$/.test(label) ? Number(label) : null;
    if (number !== null && number > 2000) return null;
    return { title, label, number, x: Number(line.x) || 0, hasLeader };
  }

  function parseTocPage(textContent, pageNumber) {
    const lines = extractLines(textContent);
    const hasHeading = lines.slice(0, 20).some((line) => HEADING.test(line.text.trim()));
    const entries = lines.map(parseTocLine).filter(Boolean).slice(0, MAX_ENTRIES);
    const leaders = entries.filter((entry) => entry.hasLeader).length;
    return {
      pageNumber,
      entries,
      hasHeading,
      hasText: lines.length > 0,
      headingLines: lines.slice(0, 30).map((line) => line.text).filter((text) => text.length <= 120),
      score: entries.length + (hasHeading ? 4 : 0) + Math.min(leaders, 4)
    };
  }

  function extractAnnotationText(operatorList, ops) {
    const result = new Map();
    if (!operatorList || !ops || !Array.isArray(operatorList.fnArray) || !Array.isArray(operatorList.argsArray)) return result;
    let id = null;
    let parts = [];
    const count = Math.min(operatorList.fnArray.length, operatorList.argsArray.length);
    for (let index = 0; index < count; index += 1) {
      const kind = operatorList.fnArray[index];
      const args = operatorList.argsArray[index];
      if (kind === ops.beginAnnotation) {
        id = typeof args?.[0] === "string" ? args[0] : null;
        parts = [];
      } else if (id && (kind === ops.showText || kind === ops.showSpacedText)) {
        for (const segment of args || []) {
          if (!Array.isArray(segment)) continue;
          const text = segment.map((glyph) => typeof glyph?.unicode === "string" ? glyph.unicode : "").join("");
          if (text) parts.push(text);
        }
      } else if (kind === ops.endAnnotation && id) {
        result.set(id, parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 300));
        id = null;
        parts = [];
      }
    }
    return result;
  }

  function parseAnnotationTocPage(annotations, operatorList, ops, pageNumber) {
    if (!Array.isArray(annotations) || annotations.length < 2) return [];
    const appearance = extractAnnotationText(operatorList, ops);
    const entries = [];
    for (const annotation of annotations) {
      if (!annotation || !["Widget", "Link"].includes(annotation.subtype)) continue;
      if (!(typeof annotation.dest === "string" || Array.isArray(annotation.dest))) continue;
      if (!Array.isArray(annotation.rect) || annotation.rect.length !== 4) continue;
      const raw = appearance.get(annotation.id) || annotation.contents || annotation.title || "";
      const parsed = parseTocLine({ text: raw, x: annotation.rect[0] });
      if (!parsed) continue;
      entries.push({
        ...parsed,
        sourcePage: pageNumber,
        dest: annotation.dest,
        y: Number(annotation.rect[3]) || 0
      });
      if (entries.length >= MAX_ENTRIES) break;
    }
    entries.sort((a, b) => b.y - a.y || a.x - b.x);
    const minX = Math.min(...entries.map((entry) => entry.x));
    for (const entry of entries) {
      entry.level = /^IVS\s+\d{3}\b/i.test(entry.title) ? 1
        : Math.min(2, Math.max(0, Math.round((entry.x - minX) / 18)));
    }
    return entries;
  }

  function selectTocCandidate(pages) {
    const eligible = pages.filter((page) =>
      page.entries.length >= 2 && (page.hasHeading || (page.entries.length >= 5 && page.entries.filter((entry) => entry.hasLeader).length >= 2))
    );
    if (!eligible.length) return null;
    const best = eligible.sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber)[0];
    const neighbors = pages.filter((page) => Math.abs(page.pageNumber - best.pageNumber) <= 2 && page.entries.length >= 2);
    neighbors.sort((a, b) => a.pageNumber - b.pageNumber);
    const seen = new Set();
    const entries = [];
    for (const page of neighbors) {
      for (const entry of page.entries) {
        const key = `${entry.title.toLowerCase()}|${entry.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ ...entry, sourcePage: page.pageNumber });
        if (entries.length >= MAX_ENTRIES) break;
      }
      if (entries.length >= MAX_ENTRIES) break;
    }
    const minX = Math.min(...entries.map((entry) => entry.x));
    for (const entry of entries) {
      const numeric = entry.title.match(/^\d+(?:\.\d+)+/);
      entry.level = numeric ? Math.min(2, (numeric[0].match(/\./g) || []).length)
        : /^第.{1,8}节/.test(entry.title) ? 1
          : Math.min(2, Math.max(0, Math.round((entry.x - minX) / 18)));
    }
    return { entries, firstPage: neighbors[0].pageNumber, lastPage: neighbors.at(-1).pageNumber };
  }

  function offsetFromPageLabels(entries, labels, afterPage) {
    if (!Array.isArray(labels) || !labels.length) return null;
    const votes = [];
    for (const entry of entries.slice(0, 30)) {
      if (entry.number === null) continue;
      const index = labels.findIndex((label, position) => position + 1 > afterPage && label === entry.label);
      if (index >= 0) votes.push(index + 1 - entry.number);
    }
    if (votes.length < 2) return null;
    const counts = new Map();
    for (const vote of votes) counts.set(vote, (counts.get(vote) || 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return ranked[0][1] >= 2 && ranked[0][1] > (ranked[1]?.[1] || 0) ? ranked[0][0] : null;
  }

  function normalizeHeading(value) {
    return String(value || "")
      .replace(/^(?:chapter|section|part)\s+[\divxlcdm]+\s*[:.\-–—]?\s*/i, "")
      .replace(/^\d+(?:\.\d+)*[.、\s-]*/, "")
      .replace(/^第.{1,8}[章节篇][\s:：]*/, "")
      .toLowerCase()
      .replace(/[^a-z\u3400-\u9fff0-9]/g, "");
  }

  function offsetFromHeadings(entries, pages, afterPage) {
    const votes = new Map();
    for (const entry of entries.slice(0, 40)) {
      if (entry.number === null) continue;
      const heading = normalizeHeading(entry.title);
      if (heading.length < 5) continue;
      for (const page of pages) {
        if (page.pageNumber <= afterPage || !Array.isArray(page.headingLines)) continue;
        if (!page.headingLines.some((line) => normalizeHeading(line) === heading)) continue;
        const offset = page.pageNumber - entry.number;
        const matched = votes.get(offset) || new Set();
        matched.add(heading);
        votes.set(offset, matched);
        break;
      }
    }
    const ranked = [...votes.entries()].sort((a, b) => b[1].size - a[1].size);
    return ranked[0]?.[1].size >= 2 && ranked[0][1].size > (ranked[1]?.[1].size || 0) ? ranked[0][0] : null;
  }

  function mapEntryPage(entry, labels, offset, afterPage, pageCount) {
    if (Number.isInteger(entry.targetPage) && entry.targetPage >= 1 && entry.targetPage <= pageCount) return entry.targetPage;
    if (Array.isArray(labels)) {
      const index = labels.findIndex((label, position) => position + 1 > afterPage && label === entry.label);
      if (index >= 0) return index + 1;
    }
    if (entry.number === null) return null;
    const page = entry.number + offset;
    return Number.isInteger(page) && page >= 1 && page <= pageCount ? page : null;
  }

  return { MAX_ENTRIES, extractLines, parseTocLine, parseTocPage, extractAnnotationText, parseAnnotationTocPage, selectTocCandidate, offsetFromPageLabels, offsetFromHeadings, normalizeHeading, mapEntryPage };
});
