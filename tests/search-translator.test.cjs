"use strict";
const assert = require("node:assert/strict");
const { createClient, OPTIONS } = require("../search-translator.js");
async function run() {
  let creates = 0;
  const calls = [];
  let result = "how to join two tables in SQL";
  const client = createClient({ create(options) {
    creates += 1;
    assert.equal(options.sourceLanguage, "zh");
    assert.equal(options.targetLanguage, "en");
    return Promise.resolve({ async translate(value) { calls.push(value); return result; } });
  } });
  await assert.rejects(client.translate("SQL连接两个表"), /准备/);
  const preparation = client.prepare();
  assert.equal(creates, 1, "Model creation begins synchronously during the user's click");
  await preparation;
  await client.prepare();
  assert.equal(creates, 1);
  assert.equal(client.ready, true);
  assert.equal(await client.translate("SQL连接两个表"), result);
  await client.translate("SQL连接两个表");
  assert.equal(calls.length, 1, "Repeated queries reuse the in-memory cache");
  await assert.rejects(client.translate("pure English"), /中文/);
  await assert.rejects(client.translate("中".repeat(301)), /300/);
  result = "仍然是中文";
  await assert.rejects(client.translate("另一个问题"), /完整英文/);
  let fail = true;
  const retry = createClient({ create() { return fail ? Promise.reject(new Error("download failed")) : Promise.resolve({ translate: async () => "test" }); } });
  await assert.rejects(retry.prepare(), /download failed/);
  fail = false;
  await retry.prepare();
  assert.equal(retry.ready, true, "A failed preparation can be retried");
  assert.equal(OPTIONS.sourceLanguage, "zh");
  console.log("search translator language direction, activation, cache and failure tests passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
