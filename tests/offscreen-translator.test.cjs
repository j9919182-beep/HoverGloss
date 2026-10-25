"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "offscreen-translator.js"), "utf8");
let listener;
let translatedPayload;

const sandbox = {
  chrome: {
    runtime: {
      onMessage: {
        addListener(callback) { listener = callback; }
      }
    }
  },
  HoverGlossBrowserTranslator: {
    async translate(payload) {
      translatedPayload = payload;
      return { translation: "收益", source: "browser", sentenceTranslation: "这项投资产生了很高的收益。" };
    }
  }
};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "offscreen-translator.js" });

function send(message) {
  return new Promise((resolve, reject) => {
    const handled = listener(message, {}, resolve);
    if (!handled) reject(new Error("message was not handled"));
  });
}

async function run() {
  assert.equal(typeof listener, "function");
  assert.equal(listener({ type: "translateBrowserLocally", target: "other" }, {}, () => {}), false);

  const payload = {
    target: "return",
    context: "The investment generated a high return.",
    kind: "word"
  };
  const response = await send({
    target: "hovergloss-offscreen-translator",
    type: "translateBrowserLocally",
    payload
  });
  assert.equal(response.ok, true);
  assert.equal(response.translation, "收益");
  assert.deepEqual(translatedPayload, payload);

  console.log("offscreen translator tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
