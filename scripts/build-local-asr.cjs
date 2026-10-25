"use strict";
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
const destination = path.join(root, "vendor/local-asr");
fs.mkdirSync(destination, { recursive: true });
esbuild.buildSync({
  absWorkingDir: root, entryPoints: ["local-asr-runtime.mjs"], outfile: "vendor/local-asr/asr-worker.mjs",
  bundle: true, minify: true, platform: "browser", format: "esm", target: "es2022",
  conditions: ["browser", "module", "default"], logLevel: "warning"
});
fs.copyFileSync(path.join(root, "node_modules/@huggingface/transformers/LICENSE"), path.join(destination, "LICENSE-TRANSFORMERS"));
console.log("ASR worker bundled. WASM reuses packaged vendor/local-aligner runtime; no model weights downloaded.");
