"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const pdfSource = require("../pdf-source.js");
const pdfNavigation = require("../pdf-navigation.js");
const pdfContext = require("../pdf-context.js");
const pdfSession = require("../pdf-session.js");
const pdfCleanCopy = require("../pdf-clean-copy.js");
const pdfOcr = require("../pdf-ocr.js");

const source = fs.readFileSync(path.join(__dirname, "..", "pdf-reader.js"), "utf8")
  .replace(/^import \* as pdfjsLib from .*;\r?\n/, "const pdfjsLib = globalThis.fakePdfjsLib;\n");
const saved = new Map();
const destroyed = [];

class Element {
  constructor() {
    this.children = [];
    this.childNodes = this.children;
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.parentElement = { hidden: false };
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.style = { setProperty() {} };
    this.listeners = new Map();
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  setAttribute() {}
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; this.childNodes = this.children; }
  scrollIntoView() {}
  getContext() { return {}; }
  contains() { return false; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}

function createReader({ pageFactory } = {}) {
  const elements = new Map();
  const documentListeners = new Map();
  const clipboard = { value: "", fail: false, async writeText(value) { if (this.fail) throw new Error("Denied"); this.value = value; } };
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument({ data }) {
      const marker = String.fromCharCode(data[5] || 65).toLowerCase();
      const fingerprint = marker.repeat(16);
      const proxy = {
        fingerprints: [fingerprint], numPages: 10,
        async getOutline() { return []; },
        async getPageLabels() { return null; },
        async getPage(number) {
          if (pageFactory) return pageFactory(marker, number);
          return {
            getViewport({ scale }) { return { scale, width: 100, height: 120, transform: [scale, 0, 0, -scale, 0, 120 * scale] }; },
            render() { return { promise: Promise.resolve(), cancel() {} }; },
            async getTextContent() { return { items: [{ str: "Hello", width: 20, transform: [10, 0, 0, 10, 10, 100], fontName: "body", dir: "ltr" }] }; }
          };
        }
      };
      return { promise: Promise.resolve(proxy), async destroy() { destroyed.push(fingerprint); } };
    },
    TextLayer: class {
      constructor({ textContentSource }) { this.textContentItemsStr = textContentSource.items.map((item) => item.str); this.textDivs = this.textContentItemsStr.map(() => ({})); }
      async render() {}
      cancel() {}
    }
  };
  const sandbox = {
    fakePdfjsLib: pdfjsLib,
    HoverGlossPdfSource: pdfSource,
    HoverGlossPdfNavigation: pdfNavigation,
    HoverGlossPdfContext: pdfContext,
    HoverGlossPdfSession: pdfSession,
    HoverGlossPdfCleanCopy: pdfCleanCopy,
    HoverGlossPdfOcr: pdfOcr,
    navigator: { clipboard },
    HoverGlossTocDetect: { MAX_ENTRIES: 250 },
    chrome: {
      runtime: { getURL(name) { return `chrome-extension://test/${name}`; } },
      storage: {
        onChanged: { addListener() {} },
        local: {
          async get(key) { return { [key]: saved.get(key) }; },
          async set(entries) { for (const [key, value] of Object.entries(entries)) saved.set(key, value); },
          async remove(key) { saved.delete(key); }
        },
        session: { async get() { return {}; }, async remove() {} }
      }
    },
    document: {
      title: "PDF 阅读 · HoverGloss",
      querySelector: element,
      createElement() { return new Element(); },
      addEventListener(type, listener) { documentListeners.set(type, listener); },
      dispatchEvent(event) { documentListeners.get(event.type)?.(event); }
    },
    window: { devicePixelRatio: 1, innerWidth: 1200, getSelection() { return { removeAllRanges() {} }; } },
    location: { href: "chrome-extension://test/pdf.html" },
    URL,
    Event: class { constructor(type) { this.type = type; } }
  };
  const exported = `\n globalThis.readerTest = {
    openBytes, activateDocument, closeDocument, showPage, changeZoom, resolveResume, openCleanCopy,
    get textSpans() { return textLayerTask?.textDivs || []; },
    get state() { return {
      active: activeDocument(), documents: [...openDocuments], pageNumber, scale,
      learningSource: globalThis.HoverGlossPdfReadingSource,
      promptHidden: resumePrompt.hidden, stageHidden: stage.hidden
    }; }
  };`;
  return vm.runInNewContext(`(async () => { ${source}${exported} })()`, sandbox, { filename: "pdf-reader.js" })
    .then(() => ({ api: sandbox.readerTest, elements, clipboard }));
}

function pdfBytes(letter) { return Uint8Array.from(Buffer.from(`%PDF-${letter}`)); }

async function run() {
  const { api, elements, clipboard } = await createReader();
  await api.openBytes(pdfBytes("A"), "same-name.pdf");
  assert.equal(api.state.documents.length, 1);
  api.openCleanCopy(false);
  assert.equal(elements.get("#cleanCopyResult").value, "Hello");
  elements.get("#cleanCopyResult").value = "Manually edited";
  await elements.get("#copyCleanText").listeners.get("click")();
  assert.equal(clipboard.value, "Manually edited", "Copy the edited preview exactly");
  clipboard.fail = true;
  await elements.get("#copyCleanText").listeners.get("click")();
  assert.equal(elements.get("#cleanCopyResult").selected, true, "Clipboard denial must allow manual copy");
  clipboard.fail = false;
  await api.changeZoom(0.2);
  assert.equal(elements.get("#cleanCopyPanel").hidden, true);
  assert.equal(elements.get("#cleanCopyResult").value, "", "Zoom must discard stale text");
  api.openCleanCopy(false);
  await api.showPage(5);
  assert.equal(elements.get("#cleanCopyPanel").hidden, true, "Page navigation must discard the old preview");
  await api.state.active.progressWrite;
  assert.equal(saved.get("pdfProgress:aaaaaaaaaaaaaaaa").page, 5);
  elements.get("#scanToc").disabled = true;
  elements.get("#scanCurrentToc").disabled = true;

  api.openCleanCopy(false);
  await api.openBytes(pdfBytes("B"), "same-name.pdf");
  assert.equal(elements.get("#cleanCopyResult").value, "", "Switching documents must discard stale text");
  assert.equal(api.state.documents.length, 2, "Opening a second PDF must retain the first document");
  assert.equal(api.state.pageNumber, 1);
  const [first, second] = api.state.documents;
  await api.activateDocument(first);
  assert.equal(api.state.pageNumber, 5);
  assert.equal(api.state.scale, 1.2);
  assert.equal(api.state.learningSource.page, 5);
  assert.equal(api.state.learningSource.fingerprint, "aaaaaaaaaaaaaaaa");
  assert.equal(elements.get("#scanToc").disabled, false, "Switching back must allow restarting an interrupted scan");
  await api.activateDocument(second);
  assert.equal(api.state.pageNumber, 1);
  assert.equal(api.state.scale, 1);
  assert.equal(api.state.learningSource.fingerprint, "bbbbbbbbbbbbbbbb");

  await api.openBytes(pdfBytes("A"), "same-name.pdf");
  assert.equal(api.state.documents.length, 2, "Reopening a file already in this reader should select its tab");
  assert.equal(api.state.active.id, first.id);
  await api.closeDocument(first);
  assert.equal(api.state.documents.length, 1);
  assert.equal(api.state.active.id, second.id);

  const reopened = await createReader();
  await reopened.api.openBytes(pdfBytes("A"), "same-name.pdf");
  assert.equal(reopened.api.state.active.resumePage, 5);
  assert.equal(reopened.api.state.promptHidden, false);
  assert.equal(reopened.api.state.stageHidden, true);
  assert.equal(saved.get("pdfProgress:aaaaaaaaaaaaaaaa").page, 5,
    "Showing the resume choice must not overwrite the previous position");
  await reopened.api.resolveResume(true);
  assert.equal(reopened.api.state.pageNumber, 5);
  assert.equal(reopened.api.state.scale, 1.2);

  const restart = await createReader();
  await restart.api.openBytes(pdfBytes("A"), "same-name.pdf");
  await restart.api.resolveResume(false);
  assert.equal(restart.api.state.pageNumber, 1);
  await restart.api.state.active.progressWrite;
  assert.equal(saved.get("pdfProgress:aaaaaaaaaaaaaaaa").page, 1);
  const many = await createReader();
  for (const marker of "CDEFGHIJ") await many.api.openBytes(pdfBytes(marker), `${marker}.pdf`);
  await many.api.openBytes(pdfBytes("K"), "K.pdf");
  assert.equal(many.api.state.documents.length, 8, "The document limit must also hold inside the open operation");
  for (const entry of [...many.api.state.documents]) await many.api.closeDocument(entry);
  assert.equal(many.elements.get("#cleanPage").disabled, true);
  assert.equal(many.api.state.active, null);
  assert.equal(many.api.state.learningSource, null);
  assert.equal(many.api.state.stageHidden, true);
  assert.ok(destroyed.length >= 2, "Duplicate and closed PDF parsing tasks are released");
  let releaseNeighbour;
  const pendingNeighbour = new Promise((resolve) => { releaseNeighbour = resolve; });
  const cross = await createReader({ pageFactory(marker, number) {
    return {
      getViewport({ scale }) { return { scale, width: 600 * scale, height: 800 * scale, transform: [scale, 0, 0, -scale, 0, 800 * scale] }; },
      render() { return { promise: Promise.resolve(), cancel() {} }; },
      async getTextContent() {
        if (marker === "l" && number === 2) await pendingNeighbour;
        const text = marker === "l" ? number === 1 ? "His son has" : "alleged connections to the criminal underworld." : "A different document ends here.";
        return { items: [{ str: text, width: 220, transform: [10, 0, 0, 10, 40, 700], fontName: "body", dir: "ltr" }] };
      }
    };
  } });
  const oldOpen = cross.api.openBytes(pdfBytes("L"), "cross-page.pdf");
  await new Promise(setImmediate);
  await cross.api.openBytes(pdfBytes("M"), "other-document.pdf");
  releaseNeighbour(); await oldOpen;
  assert.equal(cross.api.state.active.name, "other-document.pdf");
  assert.equal(cross.api.textSpans[0].__hoverGlossContext.text, "A different document ends here.", "Late neighbour reads must not overwrite another document");
  await cross.api.activateDocument(cross.api.state.documents.find((entry) => entry.name === "cross-page.pdf"));
  assert.match(cross.api.textSpans[0].__hoverGlossContext.text, /His son has alleged connections/);
  await cross.api.showPage(2);
  assert.match(cross.api.textSpans[0].__hoverGlossContext.text, /His son has alleged connections/);
  assert.ok(cross.api.state.active.contextPages.size <= 6);
  console.log("PDF reader multi-document and resume tests passed");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
