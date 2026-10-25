"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function file(relativePath) {
  assert.equal(typeof relativePath, "string");
  assert.ok(!path.isAbsolute(relativePath) && !relativePath.includes(".."), `Unsafe path: ${relativePath}`);
  const fullPath = path.join(root, relativePath);
  assert.ok(fs.statSync(fullPath).isFile(), `Missing file: ${relativePath}`);
  return fullPath;
}

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, pkg.version);
assert.match(manifest.name, /HoverGloss/);
for (const document of ["README.md", "PRIVACY.md", "TESTING.md", "LICENSE"]) file(document);
for (const pdfAsset of [
  "pdf-source.js", "pdf-navigation.js", "pdf-context.js", "pdf-clean-copy.js", "pdf-ocr.js", "pdf-session.js", "toc-detect.js", "pdf-reader.js", "pdf-reader.css", "pdf.html",
  "vendor/local-ocr/worker.min.js", "vendor/local-ocr/core/tesseract-core-lstm.wasm.js", "vendor/local-ocr/core/tesseract-core-simd-lstm.wasm.js",
  "vendor/local-ocr/languages/eng.traineddata.gz", "vendor/local-ocr/languages/chi_sim.traineddata.gz", "vendor/local-ocr/LICENSE-TESSERACT-JS", "vendor/local-ocr/LICENSE-TESSERACT-CORE", "vendor/local-ocr/LICENSE-TESSDATA",
  "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs", "vendor/pdfjs/LICENSE",
  "vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf", "vendor/pdfjs/standard_fonts/LICENSE_FOXIT",
  "vendor/pdfjs/cmaps/78-EUC-H.bcmap"
]) file(pdfAsset);
file(manifest.background.service_worker);
assert.ok(manifest.permissions.includes("offscreen"), "Browser translation requires the offscreen permission");
assert.ok(manifest.permissions.includes("sidePanel"), "Bilingual captions require the sidePanel permission");
assert.equal(manifest.side_panel.default_path, "live-captions.html");
for (const asset of ["live-captions-core.js", "caption-sites.js", "cc-session.js", "player-captions.js", "youtube-captions.js", "live-captions.js", "live-captions.css", "live-captions.html"]) file(asset);
assert.ok(manifest.optional_permissions?.includes("tabCapture"), "Audio captions request optional tabCapture only on user action");
assert.ok(!manifest.permissions.includes("tabCapture"), "Audio capture must not be a mandatory permission");
for (const asset of ["audio-captions-core.js", "tab-audio-capture.js", "tab-audio-worklet.js", "local-asr-client.js", "local-asr-runtime.mjs", "vendor/local-asr/asr-worker.mjs", "vendor/local-asr/LICENSE-TRANSFORMERS"]) file(asset);
file("context-aligner.js");
file("word-senses.js");
file("pronunciation.js");
file("feedback-store.js");
file("report-comparison.js");
for (const asset of ["learning-store.js", "learning.js", "learning.html", "learning.css"]) file(asset);
file("offscreen.html");
file("offscreen-translator.js");
for (const asset of [
  "local-alignment-core.js", "local-aligner-runtime.mjs",
  "vendor/local-aligner/aligner.mjs",
  "vendor/local-aligner/ort-wasm-simd-threaded.jsep.mjs",
  "vendor/local-aligner/ort-wasm-simd-threaded.jsep.wasm",
  "vendor/local-aligner/LICENSE-TRANSFORMERS",
  "vendor/local-aligner/LICENSE-ONNX"
]) file(asset);
file(manifest.action.default_popup);
file(manifest.options_page);
const workerSource = fs.readFileSync(file(manifest.background.service_worker), "utf8");
assert.doesNotMatch(workerSource, /api\.mymemory\.translated\.net/i, "MyMemory must not remain in the free fallback path");
assert.ok(
  manifest.content_scripts.some((entry) =>
    entry.js.includes("browser-translator.js") &&
    entry.js.includes("context-aligner.js") &&
    entry.js.includes("local-alignment-core.js") &&
    entry.js.includes("word-senses.js") &&
    entry.js.includes("pronunciation.js") &&
    entry.js.includes("content.js") &&
    entry.js.indexOf("browser-translator.js") < entry.js.indexOf("content.js") &&
    entry.js.indexOf("context-aligner.js") < entry.js.indexOf("content.js") &&
    entry.js.indexOf("local-alignment-core.js") < entry.js.indexOf("content.js") &&
    entry.js.indexOf("word-senses.js") < entry.js.indexOf("content.js") &&
    entry.js.indexOf("pronunciation.js") < entry.js.indexOf("content.js")
  ),
  "The page-context Translator fallback must load before content translation"
);
for (const icon of Object.values(manifest.icons)) file(icon);
for (const icon of Object.values(manifest.action.default_icon)) file(icon);
for (const entry of manifest.content_scripts) {
  for (const source of [...(entry.js || []), ...(entry.css || [])]) file(source);
}

for (const [size, iconPath] of Object.entries(manifest.icons)) {
  const data = fs.readFileSync(file(iconPath));
  assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `Not PNG: ${iconPath}`);
  assert.equal(data.readUInt32BE(16), Number(size), `Wrong width: ${iconPath}`);
  assert.equal(data.readUInt32BE(20), Number(size), `Wrong height: ${iconPath}`);
}

for (const html of [manifest.action.default_popup, manifest.options_page, "topics.html", "demo.html", "pdf.html", "offscreen.html", "learning.html", "evaluation.html", "feedback.html", "comparison.html", manifest.side_panel.default_path]) {
  const source = fs.readFileSync(file(html), "utf8");
  for (const match of source.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (!/^(?:https?:|#)/.test(match[1])) file(match[1].split(/[?#]/)[0]);
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".git"].includes(entry.name)) walk(fullPath);
    } else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) {
      execFileSync(process.execPath, ["--check", fullPath], { stdio: "pipe" });
    }
  }
}

walk(root);
console.log("release structure and syntax checks passed");
