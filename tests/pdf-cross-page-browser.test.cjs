"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
function fixture() {
  const first = [
    "BT /F1 9 Tf 40 775 Td (The Economist) Tj ET",
    "BT /F1 10 Tf 40 650 Td (The left column contains an unrelated complete sentence.) Tj ET",
    "BT /F1 10 Tf 320 100 Td (He was barred from office until 2060.) Tj 0 -13 Td (His son has) Tj ET",
    "BT /F1 9 Tf 40 20 Td (24) Tj ET"
  ].join("\n");
  const second = [
    "BT /F1 9 Tf 40 775 Td (The Economist) Tj ET",
    "BT /F1 10 Tf 40 700 Td (alleged connections to the criminal underworld.) Tj 0 -13 Td (Despite that, support remains strong.) Tj ET",
    "BT /F1 10 Tf 40 640 Td (Other news starts in a new paragraph.) Tj ET",
    "BT /F1 10 Tf 320 700 Td (Another column has an independent story.) Tj ET",
    "BT /F1 9 Tf 40 20 Td (25) Tj ET"
  ].join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${first.length} >>\nstream\n${first}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>",
    `<< /Length ${second.length} >>\nstream\n${second}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
(async () => {
  const server = http.createServer((req, res) => {
    const name = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname);
    if (!name.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { res.setHeader("Content-Type", /\.(?:js|mjs)$/.test(name) ? "text/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".wasm") ? "application/wasm" : "text/html; charset=utf-8"); res.end(fs.readFileSync(name)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } }), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.context().route(/^https:\/\//, (route) => route.abort());
    await page.addInitScript(() => {
      const values = { enabledHosts: ["127.0.0.1"], skipCommonWords: false };
      window.requests = [];
      window.chrome = { runtime: { getURL: (name) => `${location.origin}/${name}`, sendMessage: async (message) => {
        if (message.type === "translate") window.requests.push(message.payload);
        return { ok: true, translation: "测试译文", source: "test" };
      } }, storage: { onChanged: { addListener() {} },
        local: { get: async (defaults) => typeof defaults === "object" ? { ...defaults, ...values } : { [defaults]: values[defaults] },
          set: async (data) => Object.assign(values, data), remove: async (key) => delete values[key] },
        session: { get: async () => ({}), remove: async () => {} }
      } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/pdf.html`);
    await page.locator("#fileInput").setInputFiles({ name: "cross-page.pdf", mimeType: "application/pdf", buffer: fixture() });
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("第 1 / 2 页"));
    const hover = async (word, fragment) => {
      const span = page.locator("#textLayer span").filter({ hasText: fragment }).first();
      await span.scrollIntoViewIfNeeded();
      const rect = await span.evaluate((element, word) => {
        const start = element.textContent.indexOf(word), range = document.createRange();
        range.setStart(element.firstChild, start); range.setEnd(element.firstChild, start + word.length);
        const box = range.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }, word);
      await page.keyboard.down("Alt"); await page.mouse.move(rect.x, rect.y);
      await page.waitForFunction((word) => window.requests.some((request) => request.target === word), word);
      await page.keyboard.up("Alt");
      return page.evaluate((word) => window.requests.findLast((request) => request.target === word), word);
    };
    const expected = "His son has alleged connections to the criminal underworld.";
    const son = await hover("son", "His son has");
    assert.equal(son.context, expected); assert.equal(son.context.slice(son.targetStart, son.targetEnd), "son");
    await page.locator("#nextPage").click();
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("第 2 / 2 页"));
    const alleged = await hover("alleged", "alleged connections");
    assert.equal(alleged.context, expected); assert.equal(alleged.context.slice(alleged.targetStart, alleged.targetEnd), "alleged");
    await page.locator("#zoomIn").click();
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("第 2 / 2 页"));
    assert.match(await page.locator("#textLayer span").filter({ hasText: "alleged connections" }).first().evaluate((element) => element.__hoverGlossContext.text), /His son has alleged connections/);
    await page.locator("#cleanPage").click();
    assert.doesNotMatch(await page.locator("#cleanCopyResult").inputValue(), /His son has/, "Clean-copy still contains the current page only");
    assert.deepEqual(errors, []);
    console.log("Browser PDF.js: both cross-page hover directions, exact target offsets, column/header exclusion, zoom and current-page copy passed (translation mocked)");
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
