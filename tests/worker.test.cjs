"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const HoverGlossContextAligner = require("../context-aligner.js");
const HoverGlossLocalAlignmentCore = require("../local-alignment-core.js");
const { getGlossaryCandidates: realGlossaryCandidates } = require("../glossary.js");

const workerCode = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");
const settings = {
  provider: "smart",
  aiEndpoint: "https://example.test/v1/chat/completions",
  aiModel: "test-model",
  aiKey: "",
  customGlossary: ""
};
const requests = [];
let messageListener;
let storageListener;
let aiReply = "语境译义";
let offscreenCreated = false;
let alignerFailure = "";
let alignmentReply = null;
let phraseTranslatorUnavailable = false;
const offscreenRequests = [];

const chrome = {
  runtime: {
    onMessage: { addListener(listener) { messageListener = listener; } },
    getURL(pathname) { return `chrome-extension://test/${pathname}`; },
    async getContexts() { return offscreenCreated ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : []; },
    async sendMessage(message) {
      offscreenRequests.push(message);
      if (message.type === "alignWordLocally") {
        if (alignerFailure) return { ok: false, error: alignerFailure };
        if (alignmentReply) return alignmentReply;
        return { ok: true, span: message.payload.context === "The function returns a value." ? "返回" : "收益", score: 0.8, margin: 0.2, mutual: true };
      }
      if (phraseTranslatorUnavailable && message.payload.target === "prime minister") {
        return { ok: false, error: "当前扩展后台不能启动本机翻译" };
      }
      const investmentReturn = message.payload.target === "return" && /investment/i.test(message.payload.context || "");
      const europeanCommission = message.payload.target === "Commission" && /European Commission/i.test(message.payload.context || "");
      return {
        ok: true,
        translation: message.payload.target === "prime minister" ? "总理" :
          europeanCommission ? "佣金" : investmentReturn ? "返回" : "本机译文",
        sentenceTranslation: europeanCommission ? "欧盟委员会主席发表了讲话。" : investmentReturn ? "这项投资产生了很高的收益。" : message.payload.context ? "本机整句译文" : "",
        source: "browser",
        phrase: message.payload.target,
        confidence: null
      };
    }
  },
  offscreen: {
    async createDocument(options) {
      assert.equal(options.url, "offscreen.html");
      assert.equal(options.reasons.length, 1);
      assert.equal(options.reasons[0], "DOM_PARSER");
      offscreenCreated = true;
    }
  },
  storage: {
    local: { async get(defaults) { return { ...defaults, ...settings }; } },
    onChanged: { addListener(listener) { storageListener = listener; } }
  }
};

const sandbox = {
  chrome,
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
  importScripts() {},
  lookupGlossary(target) {
    return target === "return" ? { translation: "返回", pos: "v.", source: "contextual" } : null;
  },
  getGlossaryCandidates(target, context) {
    if (target === "Commission") return realGlossaryCandidates(target, context, "", context.indexOf(target), context.indexOf(target) + target.length);
    if (target !== "return") return [];
    return [
      { translation: "收益", pos: "n.", source: /investment/i.test(context) ? "contextual" : "contextual-candidate", matched: /investment/i.test(context) },
      { translation: "返回", pos: "v.", source: /function|value/i.test(context) ? "contextual" : "contextual-candidate", matched: /function|value/i.test(context) }
    ];
  },
  HoverGlossContextAligner,
  HoverGlossLocalAlignmentCore,
  getTopicSeedEntries() { return []; },
  TopicStore: new Proxy({}, { get() { throw new Error("Retired topic database must not be accessed"); } }),
  async fetch(url, options) {
    requests.push({ url: String(url), options });
    return { ok: true, async json() { return { choices: [{ message: { content: aiReply } }] }; } };
  }
};
vm.runInNewContext(workerCode, sandbox, { filename: "service-worker.js" });

function send(payload) {
  return new Promise((resolve) => messageListener({ type: "translate", payload }, {}, resolve));
}

async function run() {
  assert.equal(typeof messageListener, "function");
  assert.equal(typeof storageListener, "function");

  let response = await send({ target: "equivocal", context: "The result is equivocal.", topic: "SQL", kind: "word" });
  assert.equal(response.ok, true);
  assert.equal(response.source, "browser");
  assert.equal(response.translation, "本机译文");
  assert.equal(response.sentenceTranslation, "本机整句译文");
  assert.equal(offscreenCreated, true);
  assert.equal(offscreenRequests.length, 1);
  assert.equal(offscreenRequests[0].target, "hovergloss-offscreen-translator");
  assert.equal(offscreenRequests[0].payload.context, "The result is equivocal.");
  assert.equal(requests.length, 0, "Default fallback must not call a public translation service");

  settings.localAlignmentEnabled = true;
  storageListener({}, "local");
  response = await send({ target: "equivocal", context: "The result is equivocal.", kind: "word" });
  assert.equal(response.localAlignmentEnabled, true);
  const aligned = await new Promise((resolve) => messageListener({
    type: "alignWord",
    payload: {
      context: "The investment generated a high return.", targetStart: 32, targetEnd: 38,
      result: { translation: "返回", sentenceTranslation: "这项投资产生了很高的收益。", confidence: 0.56, source: "browser" }
    }
  }, {}, resolve));
  assert.equal(aligned.ok, true);
  assert.equal(aligned.result.translation, "收益");
  assert.equal(aligned.result.alignmentMethod, "awesome-align-local");
  assert.equal(aligned.result.contextReview, "aligned");
  const verified = await new Promise((resolve) => messageListener({ type: "testLocalAligner" }, {}, resolve));
  assert.equal(verified.ok, true);
  assert.equal(verified.ready, true);
  assert.equal(verified.sampleSpan, "返回");
  assert.equal(offscreenRequests.at(-1).payload.context, "The function returns a value.");
  alignmentReply = { ok: true, span: "", phrase: "European Commission", phraseTranslation: "欧盟委员会", phraseScore: 0.8 };
  const phraseOnly = await new Promise((resolve) => messageListener({
    type: "alignWord",
    payload: {
      context: "The European Commission president spoke.", targetStart: 13, targetEnd: 23,
      result: { translation: "佣金", sentenceTranslation: "欧盟委员会主席发表了讲话。", confidence: 0.56, source: "browser" }
    }
  }, {}, resolve));
  assert.equal(phraseOnly.result.contextReview, "phrase-only");
  assert.equal(phraseOnly.result.translation, "欧盟委员会");
  alignmentReply = { ok: true };
  const translatedPhrase = await new Promise((resolve) => messageListener({
    type: "alignWord",
    payload: {
      context: "The prime minister spoke.", targetStart: 4, targetEnd: 9,
      result: { translation: "质数", sentenceTranslation: "总理发表了讲话。", confidence: 0.56, source: "browser" }
    }
  }, {}, resolve));
  assert.equal(translatedPhrase.result.contextReview, "phrase-only");
  assert.equal(translatedPhrase.result.phrase, "prime minister");
  assert.equal(translatedPhrase.result.translation, "总理");
  assert.equal(offscreenRequests.at(-1).payload.target, "prime minister");
  phraseTranslatorUnavailable = true;
  const delegatedPhrase = await new Promise((resolve) => messageListener({
    type: "alignWord",
    payload: {
      context: "The prime minister spoke.", targetStart: 4, targetEnd: 9,
      result: { translation: "质数", sentenceTranslation: "总理发表了讲话。", confidence: 0.56, source: "browser" }
    }
  }, {}, resolve));
  assert.equal(delegatedPhrase.result.contextReview, "unresolved");
  assert.equal(delegatedPhrase.phraseCandidates[0], "prime minister", "Page-context fallback must receive nearby phrase candidates");
  phraseTranslatorUnavailable = false;
  assert.equal(requests.length, 0, "Phrase fallback must not call a public translation service");
  alignmentReply = null;
  alignerFailure = "对齐模型缓存不存在";
  const failedVerification = await new Promise((resolve) => messageListener({ type: "testLocalAligner" }, {}, resolve));
  assert.equal(failedVerification.ok, false);
  assert.match(failedVerification.error, /缓存不存在/);
  alignerFailure = "";
  settings.localAlignmentEnabled = false;
  storageListener({}, "local");

  settings.provider = "browser";
  storageListener({}, "local");
  response = await send({
    target: "return",
    context: "The investment generated a high return.",
    topic: "资产评估",
    kind: "word",
    targetStart: 32,
    targetEnd: 38
  });
  assert.equal(response.ok, true);
  assert.equal(response.translation, "收益");
  assert.equal(response.alignedChineseSpan, "收益");
  assert.equal(response.source, "browser-context");

  response = await send({
    target: "Commission", context: "The European Commission president spoke.",
    kind: "word", targetStart: 13, targetEnd: 23
  });
  assert.equal(response.translation, "委员会");
  assert.equal(response.phraseTranslation, "欧盟委员会");
  assert.equal(response.alignedChineseSpan, "委员会");
  const beforeCaseSensitiveCalls = offscreenRequests.length;
  await send({ target: "The US helped us.", kind: "sentence" });
  await send({ target: "The us helped us.", kind: "sentence" });
  assert.equal(offscreenRequests.length - beforeCaseSensitiveCalls, 2,
    "Worker cache must preserve case distinctions before the browser model sees the text");

  settings.provider = "local";
  settings.customGlossary = "unlisted=旧自定义译义";
  storageListener({}, "local");
  response = await send({ target: "unlisted", kind: "word" });
  assert.equal(response.ok, true);
  assert.equal(response.source, "browser");
  assert.equal(response.translation, "本机译文", "Retired custom glossary must not override translation");
  assert.equal(requests.length, 0, "Legacy local mode migrates to browser translation without AI");
  for (const type of ["getTopicStats", "listTopics", "getTopicTerms", "buildTopicGlossary", "saveTopicTerm", "deleteTopicTerm", "deleteTopic", "exportTopics", "importTopics"]) {
    const retired = await new Promise((resolve) => messageListener({ type, topic: "SQL" }, {}, resolve));
    assert.equal(retired.ok, false, `${type} must be disabled`);
    assert.match(retired.error, /不支持/);
  }
  assert.equal(requests.length, 0, "Retired glossary operations never generate terms remotely");

  settings.provider = "ai";
  settings.aiKey = "test-only-key";
  settings.aiEndpoint = "http://example.test/v1/chat/completions";
  storageListener({}, "local");
  response = await send({ target: "equivocal", context: "The result is equivocal.", topic: "SQL", kind: "word" });
  assert.equal(response.ok, false);
  assert.match(response.error, /HTTPS/);
  assert.equal(requests.length, 0, "An insecure endpoint must never receive a key");

  settings.aiEndpoint = "https://example.test/v1/chat/completions";
  storageListener({}, "local");
  response = await send({ target: "equivocal", context: "The result is equivocal.", topic: "SQL", kind: "word" });
  assert.equal(response.ok, true);
  assert.equal(response.source, "ai");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-only-key");
  const body = JSON.parse(requests[0].options.body);
  assert.doesNotMatch(body.messages[1].content, /"topic"|SQL/, "Legacy topic must not enter AI input");
  assert.match(body.messages[1].content, /The result is equivocal/);

  aiReply = JSON.stringify({
    translation: "收益",
    phrase: "a high return",
    partOfSpeech: "名词",
    sentenceTranslation: "这项投资产生了很高的收益。",
    alignedChineseSpan: "收益",
    confidence: 0.97
  });
  storageListener({}, "local");
  response = await send({
    target: "return",
    context: "The investment generated a high return.",
    topic: "资产评估",
    kind: "word"
  });
  assert.equal(response.ok, true);
  assert.equal(response.source, "ai", "AI mode must not be short-circuited by a fixed local sense");
  assert.equal(response.translation, "收益");
  assert.equal(response.phrase, "a high return");
  assert.equal(response.pos, "名词");
  assert.equal(response.sentenceTranslation, "这项投资产生了很高的收益。");
  assert.equal(response.alignedChineseSpan, "收益");
  assert.equal(response.confidence, 0.97);
  const contextualBody = JSON.parse(requests[1].options.body);
  assert.match(contextualBody.messages[0].content, /先理解并在内部翻译整个英文句子/);
  assert.match(contextualBody.messages[1].content, /The investment generated a high return/);
  assert.match(contextualBody.messages[1].content, /返回/);

  settings.customGlossary = "return=回报";
  storageListener({}, "local");
  response = await send({ target: "return", context: "A return value.", topic: "资产评估", kind: "word" });
  assert.equal(response.ok, true);
  assert.equal(response.source, "ai");
  assert.equal(response.translation, "收益");
  assert.equal(requests.length, 3, "Old topic and custom terms no longer bypass contextual translation");
  const beforeTopicChange = requests.length;
  await send({ target: "return", context: "A return value.", topic: "SQL", kind: "word" });
  assert.equal(requests.length, beforeTopicChange, "Ignored legacy topics must not split the translation cache");

  settings.provider = "browser";
  settings.localAlignmentEnabled = true;
  settings.customGlossary = "pain=疼痛";
  storageListener({}, "local");
  response = await send({ target: "pain", context: "Le pain est frais.", sourceLanguage: "fr", kind: "word" });
  assert.equal(response.ok, true);
  assert.notEqual(response.translation, "疼痛", "French must not read English custom/builtin/topic senses");
  assert.equal(offscreenRequests.at(-1).payload.sourceLanguage, "fr");
  assert.equal(response.localAlignmentEnabled, undefined, "English-only alignment is not used for French");
  settings.provider = "ai";
  aiReply = JSON.stringify({ translation: "面包", sentenceTranslation: "面包很新鲜。", confidence: .9 });
  storageListener({}, "local");
  response = await send({ target: "pain", context: "Le pain est frais.", sourceLanguage: "fr", kind: "word" });
  assert.equal(response.translation, "面包");
  assert.match(JSON.parse(requests.at(-1).options.body).messages[0].content, /法汉.*法文/);
  assert.doesNotMatch(JSON.parse(requests.at(-1).options.body).messages[1].content, /疼痛/);
  settings.provider = "local"; storageListener({}, "local");
  const beforeLegacyFrench = requests.length;
  response = await send({ target: "pain", sourceLanguage: "fr" });
  assert.equal(response.ok, true);
  assert.equal(response.source, "browser");
  assert.equal(offscreenRequests.at(-1).payload.sourceLanguage, "fr");
  assert.equal(requests.length, beforeLegacyFrench, "Legacy mode must not enable AI even with stored credentials");
  settings.localAlignmentEnabled = true;
  const longContext = "The members considered the evidence, ".repeat(20) + "the European Commission announced its decision.";
  const targetStart = longContext.lastIndexOf("Commission");
  const original = { translation: "佣金", sentenceTranslation: "欧盟委员会宣布了决定。", confidence: null };
  await sandbox.alignWord({ context: longContext, targetStart, targetEnd: targetStart + 10, result: original });
  const focused = offscreenRequests.findLast((request) => request.type === "alignWordLocally").payload;
  assert.equal(focused.context.slice(focused.targetStart, focused.targetEnd), "Commission");
  assert.ok(focused.context.length <= 400); assert.ok(targetStart > 500);
  assert.equal(original.sentenceTranslation, "欧盟委员会宣布了决定。", "Alignment windows must preserve displayed sentence translation");
  console.log("worker English/French routing, long sentence focus/offsets, glossary isolation and AI language tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
