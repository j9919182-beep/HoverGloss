"use strict";

const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "node_modules", "@huggingface", "transformers");
const destination = path.join(root, "vendor", "local-aligner");
fs.mkdirSync(destination, { recursive: true });
for (const [from, to] of [
  ["dist/ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.mjs"],
  ["dist/ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.wasm"],
  ["LICENSE", "LICENSE-TRANSFORMERS"]
]) {
  fs.copyFileSync(path.join(source, from), path.join(destination, to));
}
esbuild.buildSync({
  absWorkingDir: root,
  entryPoints: ["local-aligner-runtime.mjs"],
  outfile: "vendor/local-aligner/aligner.mjs",
  bundle: true,
  minify: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  conditions: ["browser", "module", "default"],
  logLevel: "warning"
});
console.log("Local aligner runtime bundled into vendor/local-aligner");
