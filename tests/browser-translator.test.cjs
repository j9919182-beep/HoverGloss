"use strict";

const assert = require("node:assert/strict");
const browserTranslator = require("../browser-translator.js");

function fakeTranslatorApi(initialAvailability = "available") {
  const calls = [];
  let destroyed = 0;
  const api = {
    async availability(options) {
      assert.deepEqual(options, { sourceLanguage: "en", targetLanguage: "zh" });
      return initialAvailability;
    },
    async create(options) {
      assert.equal(options.sourceLanguage, "en");
      assert.equal(options.targetLanguage, "zh");
      options.monitor({ addEventListener(type, listener) {
        if (type === "downloadprogress") listener({ loaded: 0.5 });
      } });
      return {
        async translate(text) {
          calls.push(text);
          if (text === "return") return "返回";
          if (text.includes("investment")) return "这项投资产生了很高的收益。";
          if (text === "Hello") return "你好";
          return `译：${text}`;
        },
        destroy() { destroyed += 1; }
      };
    }
  };
  return { api, calls, destroyed: () => destroyed };
}

async function run() {
  const longCalls = [], longContext = "The members considered the evidence, ".repeat(20) + "and the Commission announced its decision.";
  const longApi = { availability: async () => "available", create: async () => ({ translate: async (text) => { longCalls.push(text); return "模拟译文"; } }) };
  browserTranslator.reset();
  await browserTranslator.translate({ target: "Commission", context: longContext, kind: "word" }, longApi);
  assert.equal(longCalls[1], longContext, "Sentence translation must include a target beyond character 500");
  browserTranslator.reset();
  let fixture = fakeTranslatorApi();
  assert.equal(await browserTranslator.availability(fixture.api), "available");
  let progress = 0;
  assert.equal(await browserTranslator.prepare((value) => { progress = value; }, fixture.api), "你好");
  assert.equal(progress, 0.5);
  assert.equal(fixture.destroyed(), 1);

  browserTranslator.reset();
  fixture = fakeTranslatorApi();
  const result = await browserTranslator.translate({
    target: "return",
    context: "The investment generated a high return.",
    kind: "word"
  }, fixture.api);
  assert.equal(result.source, "browser");
  assert.equal(result.translation, "返回");
  assert.equal(result.isolatedTranslation, "返回");
  assert.equal(result.sentenceTranslation, "这项投资产生了很高的收益。");
  assert.deepEqual(fixture.calls, ["return", "The investment generated a high return."]);

  const cached = await browserTranslator.translate({
    target: "return",
    context: "The investment generated a high return.",
    kind: "word"
  }, fixture.api);
  assert.equal(cached, result);
  assert.equal(fixture.calls.length, 2, "Repeated browser translations should use the in-page cache");

  browserTranslator.reset();
  fixture = fakeTranslatorApi("downloadable");
  const sharedSentence = "The investment generated a high return.";
  const sharedResults = await Promise.all([
    browserTranslator.translate({ target: "return", context: sharedSentence, kind: "word" }, fixture.api),
    browserTranslator.translate({ target: "value", context: sharedSentence, kind: "word" }, fixture.api)
  ]);
  assert.equal(sharedResults[0].sentenceTranslation, sharedResults[1].sentenceTranslation);
  assert.equal(fixture.calls.filter((text) => text === sharedSentence).length, 1,
    "Different hovered words share one in-flight sentence translation");
  await browserTranslator.translate({ target: "US", kind: "word" }, fixture.api);
  await browserTranslator.translate({ target: "us", kind: "word" }, fixture.api);
  assert.ok(fixture.calls.includes("US") && fixture.calls.includes("us"), "Case-sensitive source texts must not share a translation");
  const requestsBeforeRetry = fixture.calls.length;
  await browserTranslator.translate({ target: "US", kind: "word" }, fixture.api);
  assert.equal(fixture.calls.length, requestsBeforeRetry);
  browserTranslator.reset();
  fixture = fakeTranslatorApi("downloadable");
  const privacyMasked = await browserTranslator.translate({ target: "example", kind: "word" }, fixture.api);
  assert.equal(privacyMasked.translation, "译：example");
  assert.deepEqual(fixture.calls, ["example"], "A downloadable status must still attempt Translator.create()");

  browserTranslator.reset();
  fixture = fakeTranslatorApi("unavailable");
  await assert.rejects(browserTranslator.translate({ target: "example", kind: "word" }, fixture.api), /不可用/);

  browserTranslator.reset();
  const createdLanguages = [];
  const multilingualApi = {
    async availability(options) { return options.sourceLanguage === "fr" || options.sourceLanguage === "en" ? "available" : "unavailable"; },
    async create(options) {
      createdLanguages.push(options.sourceLanguage);
      return { async translate(text) { return text === "pain" ? options.sourceLanguage === "fr" ? "面包" : "疼痛" : "你好"; }, destroy() {} };
    }
  };
  assert.equal(await browserTranslator.availability(multilingualApi, "fr"), "available");
  await browserTranslator.prepare(null, multilingualApi, "fr");
  assert.equal((await browserTranslator.translate({ target: "pain", sourceLanguage: "fr" }, multilingualApi)).translation, "面包");
  assert.equal((await browserTranslator.translate({ target: "pain" }, multilingualApi)).translation, "疼痛", "Identical spelling must use separate sessions and caches");
  assert.deepEqual(createdLanguages, ["fr", "fr", "en"]);
  console.log("browser translator English/French pairs, session and cache separation tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
