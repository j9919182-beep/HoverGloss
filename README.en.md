# HoverGloss

[中文](README.md) · [Installation guide (Chinese)](docs/INSTALL.md) · [Privacy](PRIVACY.md)

Context-aware English/French-to-Chinese reading assistance for Chrome and Edge. Hover over words, read PDFs, and save vocabulary together with its original sentence and source.

**v0.9.31 Preview.** This is an unpacked extension, not a browser-store release. Translations, alignment, OCR and captions can be wrong.

## Features

- Alt-hover word translation; Alt+Shift for sentences and selection translation.
- PDF reader with multiple documents, outlines, page navigation, resume prompts and conservative cross-page sentence recovery. Scanned pages require manual OCR.
- Separate English and French learning libraries: phrases, sentences, sources, pronunciation, notes, review and JSON import/export. Basic French grammar hints run offline.
- Chinese-to-English search assistance in recognized search fields.
- Optional local translation of readable English CC on supported YouTube/Bilibili videos. Audio-based recognition without CC is experimental and requires separate consent.

## Try it

1. Download `HoverGloss-v0.9.31-preview.zip` from this repository's Releases and extract it, or download the complete source.
2. Open `chrome://extensions` or `edge://extensions`, enable Developer mode and choose **Load unpacked**.
3. Select the directory containing `manifest.json`. No build step is required.
4. In settings, choose English or French and explicitly prepare browser-local translation. Enable the current website in the popup.
5. Hold Alt and hover over a word.

Browser-local translation requires the browser's Translator API, a supported language pair and a compatible device. First use may download a language pack. Availability is detected in settings; browser version alone is not a guarantee. A user-provided HTTPS AI endpoint is an optional alternative and may incur provider charges.

Local translation and OCR run on the device. A configured AI provider receives requested text/context; explicitly permitted online voices receive the text you ask to read. Optional model downloads use external providers. See the [privacy policy](PRIVACY.md).

## Limitations and feedback

Complex PDF layouts, OCR accuracy and precise word-to-phrase alignment are not guaranteed. Only readable English CC is supported directly; burned-in subtitles, picture-in-picture, Shorts and Bilibili live/bangumi are not supported. Background captions can be delayed. Learning records stay in the current browser; export them before uninstalling.

Automated tests include mocked translation/caption providers and do not establish real-model accuracy or universal compatibility. Please report reproducible problems with sanitized examples through Issues.

## Development and license

Node.js 20+ is required for checks: `npm run check`. Optional runtime rebuilds use the committed pnpm lockfile; see [testing](TESTING.md) and [contributing](CONTRIBUTING.md).

Own code/icons: [MIT](LICENSE). Bundled libraries, fonts, OCR data and optional models have separate upstream licenses: [third-party notices](THIRD_PARTY_NOTICES.md).
