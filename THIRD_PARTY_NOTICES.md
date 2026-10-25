# 第三方组件与许可

HoverGloss 自有代码和图标采用 MIT。以下组件保留各自版权与许可，不能统一视为本项目的 MIT。核对日期：2026-10-25。

## 随源码及安装包分发

| 组件/数据 | 用途与来源 | 随包许可文件 |
| --- | --- | --- |
| PDF.js / pdfjs-dist 5.6.205 | [Mozilla PDF.js](https://github.com/mozilla/pdf.js)，PDF 解析、渲染、文字层 | [Apache-2.0](vendor/pdfjs/LICENSE)、[来源说明](vendor/pdfjs/README.md) |
| PDF.js CMaps | Adobe 字符映射数据 | [Adobe 许可](vendor/pdfjs/cmaps/LICENSE) |
| Foxit/PDFium 标准字体 | PDF.js 随附字体资源 | [版权与再分发条款](vendor/pdfjs/standard_fonts/LICENSE_FOXIT) |
| Liberation 字体 | PDF.js 随附字体资源 | [SIL OFL 1.1](vendor/pdfjs/standard_fonts/LICENSE_LIBERATION) |
| Transformers.js 3.8.1 | [Hugging Face Transformers.js](https://github.com/huggingface/transformers.js)，对齐/ASR 推理代码 | [Apache-2.0（对齐）](vendor/local-aligner/LICENSE-TRANSFORMERS)、[Apache-2.0（ASR）](vendor/local-asr/LICENSE-TRANSFORMERS) |
| ONNX Runtime Web | [Microsoft ONNX Runtime](https://github.com/microsoft/onnxruntime)，对齐/ASR 共用 WASM 运行文件 | [MIT](vendor/local-aligner/LICENSE-ONNX) |
| Tesseract.js 6.0.1 | [Tesseract.js](https://github.com/naptha/tesseract.js)，手动 OCR worker | [Apache-2.0](vendor/local-ocr/LICENSE-TESSERACT-JS)、[worker 附加声明](vendor/local-ocr/worker.min.js.LICENSE.txt) |
| Tesseract.js-core 6.1.2 | OCR LSTM WASM 运行代码 | [Apache-2.0](vendor/local-ocr/LICENSE-TESSERACT-CORE) |
| 英文/简体中文 tessdata | `@tesseract.js-data/eng`、`chi_sim` 1.0.0 的 `4.0.0_best_int` 数据；上游 [naptha/tessdata](https://github.com/naptha/tessdata) | [底层训练数据 Apache-2.0](vendor/local-ocr/LICENSE-TESSDATA) |

OCR 下载源、版本和 SHA-512 来源记录见 [sources.json](vendor/local-ocr/sources.json)；运行方式见 [OCR README](vendor/local-ocr/README.md)。ONNX 运行构建版本由 [package.json](package.json)、[pnpm 锁文件](pnpm-lock.yaml) 和构建脚本记录。

## 仅由用户按需下载

- **词语对齐**：[`cstr/awesome-align-onnx-int8`](https://huggingface.co/cstr/awesome-align-onnx-int8)，固定 revision `e803a2f501474044099b539160aaca461976ecd0`。上游模型卡标注 Apache-2.0；权重不包含在源码/安装 ZIP 中。
- **英文听音识别**：[`onnx-community/whisper-tiny.en`](https://huggingface.co/onnx-community/whisper-tiny.en)，固定 revision `3a6d57ee9c665610614068e8592d8baee0188181`，来源为 Whisper 的 ONNX 转换。原始 [Whisper 许可为 MIT](https://github.com/openai/whisper/blob/main/LICENSE)；转换仓库应按其自身说明使用，不能把原模型许可当作额外的转换方授权声明。权重不随包分发。
- **浏览器翻译/朗读**：由浏览器和系统提供，遵循对应提供方条款；不属于 HoverGloss MIT 授权的自有模型。

预览包只分发已经保留许可的运行资源。模型卡与来源地址用于说明来源，不代表本项目与上游厂商存在合作或获得其背书。
