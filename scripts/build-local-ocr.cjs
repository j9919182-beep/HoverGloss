"use strict";
// Packages are downloaded/extracted separately; this build verifies registry integrity before copying.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const downloads = path.resolve(process.argv[2] || path.join(root, "../tmp/ocr-download"));
const specs = JSON.parse(fs.readFileSync(path.join(downloads, "sources.json"), "utf8").replace(/^\ufeff/, ""));
for (const spec of specs) {
  const actual = "sha512-" + crypto.createHash("sha512").update(fs.readFileSync(path.join(downloads, spec.Folder + ".tgz"))).digest("base64");
  if (actual !== spec.Integrity) throw new Error("OCR package integrity mismatch: " + spec.Name);
}
const destination = path.join(root, "vendor/local-ocr");
fs.mkdirSync(path.join(destination, "core"), { recursive: true });
fs.mkdirSync(path.join(destination, "languages"), { recursive: true });
const copy = (from, to) => fs.copyFileSync(path.join(downloads, from), path.join(destination, to));
copy("engine/package/dist/worker.min.js", "worker.min.js");
copy("engine/package/dist/worker.min.js.LICENSE.txt", "worker.min.js.LICENSE.txt");
copy("engine/package/LICENSE.md", "LICENSE-TESSERACT-JS");
copy("core/package/LICENSE", "LICENSE-TESSERACT-CORE");
copy("tessdata.LICENSE", "LICENSE-TESSDATA");
// Only LSTM is enabled. Both SIMD and non-SIMD embedded-WASM builds are packaged.
for (const name of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"]) copy("core/package/" + name, "core/" + name);
for (const lang of ["eng", "chi_sim"]) copy(`${lang}/package/4.0.0_best_int/${lang}.traineddata.gz`, `languages/${lang}.traineddata.gz`);
fs.writeFileSync(path.join(destination, "sources.json"), JSON.stringify(specs, null, 2) + "\n");
console.log("Bundled OCR worker, LSTM cores and English/Simplified Chinese models; SHA-512 registry integrity passed.");
