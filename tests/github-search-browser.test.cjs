"use strict";
// Optional offline integration test. The GitHub-shaped DOM and translation API
// are fixtures; modal stacking, focus, clicks and input events use real Edge.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const url = "https://github.com/__hovergloss_offline_test__";
const sourceFiles = ["search-sites.js", "search-translator.js", "youtube-search-core.js", "youtube-search.js"];
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font:16px Arial} header{padding:10px}
  dialog{position:fixed;inset:20px 90px auto;width:calc(100vw - 220px);height:160px;padding:16px;border:1px solid #ccc;border-radius:12px;overflow:hidden;transform:translateY(0)}
  #global-query{box-sizing:border-box;width:100%;height:40px}
  [role=listbox]{padding:20px}
  </style></head><body><header>
  <input id="copilot" role="combobox" aria-label="Ask Copilot" aria-controls="global-results">
  <textarea id="comment" name="comment"></textarea></header>
  <dialog aria-label="Search"><div class="renamed-header-search-component">
  <input id="global-query" role="combobox" aria-label="Search GitHub" aria-controls="global-results">
  <div id="global-results" role="listbox">Search all of GitHub</div>
  </div></dialog></body></html>`;

async function run() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const failPopover of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1476, height: 900 } });
      const errors = [];
      let allowedRequests = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        if (route.request().url() === url) { allowedRequests += 1; return route.fulfill({ contentType: "text/html", body: fixture }); }
        return route.abort();
      });
      await page.goto(url);
      await page.evaluate((fail) => {
        const state = {};
        window.chrome = { storage: { local: {
          async get(defaults) { return { ...defaults, ...state }; },
          async set(values) { Object.assign(state, values); }
        }, onChanged: { addListener() {} } } };
        window.prepareCount = 0; window.inputWrites = []; window.submissions = 0;
        window.Translator = { async create() {
          window.prepareCount += 1;
          return { async translate() { return "website"; } };
        } };
        document.addEventListener("input", (event) => {
          if (event.target.id === "global-query") window.inputWrites.push(event.target.value);
        });
        document.addEventListener("submit", () => window.submissions += 1);
        if (fail) {
          // A normal overlay cannot escape a clipped ancestor. This fallback
          // fixture leaves room; the supported popover case tests real clipping.
          document.querySelector("dialog").style.overflow = "visible";
          Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value() { throw new Error("Unavailable"); } });
        }
      }, failPopover);
      for (const file of sourceFiles) await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), "utf8") });
      await page.evaluate(() => document.querySelector("dialog").showModal());
      const input = page.locator("#global-query");
      const host = page.locator("#hovergloss-search-assistant");
      const launcher = host.getByRole("button", { name: "打开 HoverGloss 英文搜索候选" });
      await input.fill("网站");
      await launcher.waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => window.prepareCount), 0);
      assert.equal(await host.evaluate((node) => node.parentElement.tagName), "DIALOG");
      assert.equal(await host.evaluate((node) => node.matches(":popover-open")), !failPopover);
      assert.equal(await launcher.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return top === node.getRootNode().host;
      }), true, "Launcher is not behind the modal or its clipping boundary");
      await launcher.click();
      await host.getByLabel("在 GitHub 搜索框启用 中 → 英").check();
      await host.getByRole("button", { name: "准备中译英", exact: true }).click();
      try {
        await host.getByText("英文候选：website", { exact: true }).waitFor({ timeout: 5000 });
      } catch (error) {
        console.error(await page.evaluate(() => {
          const node = document.querySelector("#hovergloss-search-assistant");
          return { panel: node.shadowRoot.querySelector(".panel").textContent, display: node.style.display,
            active: document.activeElement?.outerHTML.slice(0, 300),
            innerActive: node.shadowRoot.activeElement?.outerHTML, count: window.prepareCount };
        }));
        throw error;
      }
      assert.equal(await page.evaluate(() => document.activeElement?.id), "global-query", "Focus remains on the search after the prepare button disappears");
      assert.equal(await input.inputValue(), "网站");
      await host.getByRole("button", { name: "替换为英文", exact: true }).click();
      assert.equal(await input.inputValue(), "website");
      await host.getByRole("button", { name: "恢复中文", exact: true }).click();
      assert.equal(await input.inputValue(), "网站");
      assert.equal(await page.evaluate(() => window.submissions), 0);

      // Hydration adds search attributes after focus; no new input/focus event
      // follows, so discovery must recover the entry from DOM mutations.
      await page.evaluate(() => {
        const old = document.querySelector("#global-query");
        const next = document.createElement("input");
        next.id = "global-query"; next.value = "网站";
        old.replaceWith(next); next.focus();
        next.setAttribute("role", "combobox");
        next.setAttribute("aria-label", "Search GitHub");
        next.setAttribute("aria-controls", "global-results");
      });
      await launcher.waitFor({ state: "visible" });
      await page.evaluate(() => document.querySelector("dialog").close());
      await host.waitFor({ state: "hidden" });
      await page.locator("#copilot").fill("网站");
      assert.equal(await host.isVisible(), false, "Copilot is excluded");
      await page.locator("#comment").fill("网站");
      assert.equal(await host.isVisible(), false, "Comments are excluded");
      assert.equal(await page.evaluate(() => window.prepareCount), 1);
      assert.equal(allowedRequests, 1, "Only the offline fixture request is fulfilled");
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("Offline Edge GitHub search integration passed: real modal/popover, focus, preview/apply/undo, hydration, exclusion and fallback; translator mocked");
  } finally { await browser.close(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
