const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const sentence = "Je ne mange pas de viande.";
const analysis = { sentences: [{ text: sentence, meaning: "我不吃肉。", structure: "主语 Je ＋ 否定谓语 ne mange pas ＋ 直接宾语 de viande。",
  parts: [{ text: "Je", role: "主语", explanation: "我，是动作的执行者。" }, { text: "ne mange pas", role: "否定谓语", explanation: "ne…pas 围绕动词构成否定。" }, { text: "de viande", role: "直接宾语", explanation: "说明不吃什么。" }],
  verbs: [{ text: "mange", infinitive: "manger", tense: "présent de l’indicatif（直陈式现在时）", explanation: "对应第一人称单数 je，表达现在的饮食习惯。" }],
  points: [{ text: "de viande", explanation: "一般否定句中，直接宾语前的部分冠词变为 de。" }] }], tip: "先找变位动词，再找它的主语；注意 ne…pas 的位置。" };
function createHarness() {
  const data = { provider: "browser", aiEndpoint: "https://grammar.example.test/chat/completions", aiModel: "fixture-model", aiKey: "test-only-key" };
  const requests = [];
  let listener;
  const state = { reply: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(analysis) } }] }) }) };
  const get = async (key) => structuredClone(typeof key === "string" ? { [key]: data[key] } : { ...key, ...data });
  const set = async (values) => { Object.assign(data, structuredClone(values)); };
  const sandbox = { URL, TextEncoder, crypto: webcrypto, AbortController, setTimeout, clearTimeout, importScripts() {},
    chrome: { storage: { local: { get, set }, onChanged: { addListener() {} } }, runtime: {
      getURL: (name) => "chrome-extension://fixture/" + name,
      onMessage: { addListener(fn) { listener = fn; } }
    } }, fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return state.reply(options); } };
  vm.createContext(sandbox);
  for (const name of ["french-grammar.js", "learning-store.js", "service-worker.js"]) vm.runInContext(fs.readFileSync(path.join(root, name), "utf8"), sandbox, { filename: name });
  const send = (message, url = "chrome-extension://fixture/learning.html?language=fr") => new Promise((resolve) => listener(message, { url }, resolve));
  const seed = async () => {
    const entry = (await sandbox.HoverGlossLearningStore.save({ language: "fr", term: "viande", meaning: "肉", context: sentence, origin: { title: "Private title", url: "https://private.example/article" } })).entry;
    await sandbox.HoverGlossLearningStore.save({ term: "pain", meaning: "疼痛", context: "The pain eased.", origin: { title: "English" } });
    return entry;
  };
  return { data, requests, state, get, set, send, seed, store: sandbox.HoverGlossLearningStore };
}
module.exports = { createHarness, analysis, sentence, root };
