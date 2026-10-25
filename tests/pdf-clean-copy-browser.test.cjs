"use strict";
// Optional real-browser check: set PLAYWRIGHT_MODULE to a local Playwright installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");

function fixture() {
  const stream = [
    "BT /F1 20 Tf 40 760 Td (PDF clean copy test across columns) Tj ET",
    "BT /F1 10 Tf 320 650 Td (Right column begins with important ideas) Tj 0 -13 Td (and ends here.) Tj ET",
    "BT /F1 10 Tf 40 650 Td (Left column begins with important ideas) Tj 0 -13 Td (and ends here.) Tj ET",
    "BT /F1 10 Tf 40 610 Td (A new left paragraph.) Tj ET"
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> /Contents 7 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream"
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  text += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

function scannedFixture(jpeg) {
  const stream = "q 600 0 0 800 0 0 cm /Scan Do Q";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>",
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 600 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from("\nendstream")]),
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> /Contents 7 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream"
  ];
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let size = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.isBuffer(object) ? object : Buffer.from(object), Buffer.from("\nendobj\n")]);
    chunks.push(chunk); size += chunk.length;
  });
  const xref = size;
  chunks.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

async function run() {
  const server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(root, `.${relative}`);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const type = file.endsWith(".html") ? "text/html" : /\.(?:js|mjs)$/.test(file) ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream";
      const data = fs.readFileSync(file);
      response.writeHead(200, { "Content-Type": type, "Content-Security-Policy": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" }); response.end(data);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    const remoteRequests = [];
    page.context().on("request", (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith(`http://127.0.0.1:${server.address().port}/`)) remoteRequests.push(request.url()); });
    await page.context().route(/^https:\/\//, (route) => route.abort());
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const storage = { enabledHosts: ["127.0.0.1"] };
      window.translationRequests = [];
      window.chrome = {
        runtime: { getURL: (name) => `${location.origin}/${name}`, async sendMessage(message) {
          if (message.type === "translate") window.translationRequests.push(message.payload);
          return { ok: true, translation: "测试译文", source: "test" };
        } },
        tabs: { create() {} },
        storage: { onChanged: { addListener() {} },
          local: { async get(defaults) { return typeof defaults === "object" ? { ...defaults, ...storage } : { [defaults]: storage[defaults] }; },
            async set(values) { Object.assign(storage, values); }, async remove(key) { delete storage[key]; } },
          session: { async get() { return {}; }, async remove() {} } }
      };
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        async writeText(value) { if (window.denyClipboard) throw new Error("Denied"); window.copiedText = value; }
      } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/pdf.html`);
    await page.locator("#fileInput").setInputFiles({ name: "copy-fixture.pdf", mimeType: "application/pdf", buffer: fixture() });
    await page.waitForFunction(() => !document.querySelector("#cleanPage").disabled);
    await page.locator("#cleanPage").click();
    const whole = await page.locator("#cleanCopyResult").inputValue();
    assert.equal(whole, "PDF clean copy test across columns\n\nLeft column begins with important ideas and ends here.\n\nA new left paragraph.\n\nRight column begins with important ideas and ends here.");
    const makeSelection = async (reverse = false) => page.evaluate((reverse) => {
      const span = [...document.querySelectorAll("#textLayer span")].find((entry) => entry.textContent === "Left column begins with important ideas");
      const selection = window.getSelection();
      selection.setBaseAndExtent(span.firstChild, reverse ? 11 : 5, span.firstChild, reverse ? 5 : 11);
    }, reverse);
    for (const reverse of [false, true]) {
      await makeSelection(reverse);
      await page.locator("#cleanSelection").click();
      assert.equal(await page.locator("#cleanCopyResult").inputValue(), "column", "Real selection must preserve exact partial words in either direction");
    }
    await page.locator("#cleanCopyResult").fill("Edited copy 123");
    await page.locator("#copyCleanText").click();
    assert.equal(await page.evaluate(() => window.copiedText), "Edited copy 123");
    await page.evaluate(() => { window.denyClipboard = true; });
    await page.locator("#copyCleanText").click();
    assert.match(await page.locator("#cleanCopyStatus").textContent(), /Ctrl\+C/);
    assert.equal(await page.locator("#cleanCopyResult").evaluate((element) => element.selectionEnd - element.selectionStart), 15);
    await page.locator("#cleanPage").click();
    await page.screenshot({ path: path.join(root, "..", "tmp", "pdf-clean-copy-desktop.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 1100 });
    await page.locator("#cleanPage").click();
    assert.ok(await page.locator("#cleanCopyResult").evaluate((element) => element.getBoundingClientRect().right <= innerWidth));
    assert.equal(await page.locator("#outlinePanel").isVisible(), false, "The outline must not cover the copy panel on narrow screens");
    await page.screenshot({ path: path.join(root, "..", "tmp", "pdf-clean-copy-mobile.png") });
    await page.locator("#nextPage").click();
    await page.waitForFunction(() => !document.querySelector("#cleanPage").disabled);
    assert.equal(await page.locator("#cleanCopyPanel").isVisible(), false);
    await page.locator("#cleanPage").click();
    assert.match(await page.locator("#cleanCopyNotice").textContent(), /OCR/);
    assert.equal(await page.locator("#copyCleanText").isDisabled(), true);
    await page.setViewportSize({ width: 1280, height: 1000 });
    const jpeg = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 800;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 600, 800); ctx.fillStyle = "black";
      ctx.font = "bold 30px Arial"; ctx.fillText("LOCAL OCR TEST", 40, 65);
      ctx.font = "26px Arial"; ctx.fillText("Invoice number 12345", 40, 135); ctx.fillText("Clean text for copying.", 40, 180);
      ctx.font = "30px Microsoft YaHei"; ctx.fillText("中文识别测试", 40, 265); ctx.fillText("资产评估报告", 40, 315);
      return canvas.toDataURL("image/jpeg", .98).split(",")[1];
    });
    await page.locator("#fileInput").setInputFiles({ name: "scanned-fixture.pdf", mimeType: "application/pdf", buffer: scannedFixture(Buffer.from(jpeg, "base64")) });
    await page.waitForFunction(() => document.title.startsWith("scanned-fixture.pdf") && !document.querySelector("#toggleOcr").disabled && /没有可选中/.test(document.querySelector("#status").textContent));
    assert.match(await page.locator("#status").textContent(), /没有可选中/);
    await page.locator("#toggleOcr").click();
    await page.locator("#ocrLanguage").selectOption("chi_sim+eng");
    await page.locator("#ocrCurrentPage").click();
    await page.waitForFunction(() => /识别完成|识别失败|无法启动|超时/.test(document.querySelector("#ocrStatus").textContent), { timeout: 60000 });
    const recognized = await page.locator("#cleanCopyResult").inputValue();
    assert.match(recognized, /Invoice number 12345/, await page.locator("#ocrStatus").textContent());
    assert.ok(recognized.replace(/\s/g, "").includes("中文识别测试"), recognized);
    // OCR can misread individual Chinese glyphs; verify the language works without claiming perfect transcription.
    assert.ok(recognized.replace(/\s/g, "").includes("评估报告"), recognized);
    assert.match(await page.locator("#cleanCopyNotice").textContent(), /本地 OCR/);
    assert.match(await page.locator("#status").textContent(), /可 Alt 悬停/);
    const invoice = page.locator("#textLayer span").filter({ hasText: /^Invoice\s*$/ });
    await invoice.scrollIntoViewIfNeeded();
    await page.keyboard.down("Alt");
    await invoice.hover();
    await page.waitForFunction(() => window.translationRequests.some((request) => request.target === "Invoice"));
    await page.keyboard.up("Alt");
    const hoverRequest = await page.evaluate(() => window.translationRequests.find((request) => request.target === "Invoice"));
    assert.match(hoverRequest.context, /Invoice number 12345/);
    assert.doesNotMatch(hoverRequest.context, /LOCAL OCR TEST/);
    await page.evaluate(() => {
      const spans = [...document.querySelectorAll("#textLayer span")];
      const start = spans.find((span) => span.textContent.trim() === "Invoice");
      const end = spans.find((span) => span.textContent.trim() === "12345");
      window.getSelection().setBaseAndExtent(start.firstChild, 0, end.firstChild, end.textContent.length);
      end.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForFunction(() => window.translationRequests.some((request) => /Invoice\s+number\s+12345/.test(request.target) && request.kind !== "word"));
    const original = await invoice.boundingBox();
    const paperBefore = await page.locator("#paper").boundingBox();
    await page.locator("#zoomIn").click();
    await page.waitForFunction(() => /已恢复 OCR/.test(document.querySelector("#status").textContent));
    const zoomed = await invoice.boundingBox();
    const paperAfter = await page.locator("#paper").boundingBox();
    const factor = paperAfter.width / paperBefore.width;
    assert.ok(Math.abs((zoomed.x - paperAfter.x) - (original.x - paperBefore.x) * factor) < 2);
    await page.locator("#zoomOut").click();
    await page.waitForFunction(() => /已恢复 OCR/.test(document.querySelector("#status").textContent));
    await page.locator("#toggleOcr").click();
    await page.screenshot({ path: path.join(root, "..", "tmp", "pdf-ocr-desktop.png") });
    await page.locator("#ocrSelectRegion").click();
    const overlay = await page.locator("#ocrRegionOverlay").boundingBox();
    await page.mouse.move(overlay.x + 560, overlay.y + 200); await page.mouse.down();
    await page.mouse.move(overlay.x + 25, overlay.y + 100, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => /识别完成|识别失败|无法启动|超时/.test(document.querySelector("#ocrStatus").textContent), { timeout: 60000 });
    const cropped = await page.locator("#cleanCopyResult").inputValue();
    assert.match(cropped, /Invoice number 12345/);
    assert.doesNotMatch(cropped, /LOCAL OCR TEST|中文|资产/);
    const croppedBox = await invoice.boundingBox();
    const croppedPaper = await page.locator("#paper").boundingBox();
    assert.ok(Math.abs((croppedBox.x - croppedPaper.x) - (original.x - paperBefore.x)) < 3, "Region OCR must not shift words to the page origin");
    await page.locator("#ocrSelectRegion").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#ocrRegionOverlay").isVisible(), false);
    assert.match(await page.locator("#ocrStatus").textContent(), /已取消/);
    await page.locator("#ocrCurrentPage").click();
    await page.locator("#ocrCancel").click();
    assert.match(await page.locator("#ocrStatus").textContent(), /已取消/);
    assert.equal(await page.locator("#ocrCurrentPage").isDisabled(), false);
    await page.locator("#ocrCurrentPage").click();
    await page.locator("#nextPage").click();
    await page.waitForFunction(() => !document.querySelector("#cleanPage").disabled);
    assert.equal(await page.locator("#ocrTools").isVisible(), false);
    assert.equal(await page.locator("#cleanCopyPanel").isVisible(), false);
    assert.equal(await page.locator("#cleanCopyResult").inputValue(), "");
    await page.locator("#prevPage").click();
    await page.waitForFunction(() => !document.querySelector("#toggleOcr").disabled && /已恢复 OCR/.test(document.querySelector("#status").textContent));
    await page.locator("#toggleOcr").click();
    await page.locator("#ocrCurrentPage").click();
    await page.locator(".document-tab-select").filter({ hasText: "copy-fixture.pdf" }).click();
    await page.waitForFunction(() => document.title.startsWith("copy-fixture.pdf") && !document.querySelector("#toggleOcr").disabled);
    assert.equal(await page.locator("#cleanCopyResult").inputValue(), "");
    assert.equal(await page.locator("#ocrTools").isVisible(), false);
    await page.setViewportSize({ width: 390, height: 1100 });
    await page.locator("#toggleOcr").click();
    assert.ok(await page.locator("#ocrLanguage").evaluate((element) => element.getBoundingClientRect().right <= innerWidth));
    await page.screenshot({ path: path.join(root, "..", "tmp", "pdf-ocr-mobile.png") });
    assert.deepEqual(remoteRequests, [], "OCR must not download remote models or upload page images");
    assert.deepEqual(errors, []);
    console.log("PDF copy and local OCR real Edge/PDF.js tests passed: scanned Chinese/English, cropped recognition, cancellation, navigation, extension CSP and no external requests");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
