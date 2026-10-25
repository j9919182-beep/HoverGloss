# Packaged local OCR

Runtime: Tesseract.js 6.0.1 browser worker; Tesseract.js-core 6.1.2 LSTM-only embedded-WASM builds (SIMD and non-SIMD).
Models: @tesseract.js-data/eng 1.0.0 and @tesseract.js-data/chi_sim 1.0.0, using 4.0.0_best_int.

Registry archives and their SHA-512 integrity strings are recorded in sources.json. The build verifies archives before copying. Language files are served from this extension; worker caching is disabled and no external model endpoints are used.

The client in pdf-ocr.js owns the native Worker and uses the pinned 6.0.1 message protocol so cancellation can terminate initialization as well as recognition. Upgrade this protocol and its browser tests together with the worker.

Tesseract.js and Tesseract.js-core: Apache-2.0; see LICENSE-TESSERACT-JS and LICENSE-TESSERACT-CORE. The worker bundle's additional notices are in worker.min.js.LICENSE.txt. Model packages declare MIT in their package metadata; the underlying tessdata repository distributes the trained data under Apache-2.0, included as LICENSE-TESSDATA (https://github.com/naptha/tessdata/blob/gh-pages/LICENSE). Model provenance: https://github.com/naptha/tessdata.

Rebuild: download/extract the exact registry archives listed in sources.json to ../tmp/ocr-download/{engine,core,eng,chi_sim}/package, retain their .tgz archives and sources.json at that directory, and provide the upstream tessdata license there as tessdata.LICENSE. Run node scripts/build-local-ocr.cjs. The application does not require a build or dependency installation to use the packaged OCR.
