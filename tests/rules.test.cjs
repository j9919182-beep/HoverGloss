const assert = require("node:assert/strict");
const rules = require("../rules.js");

assert.equal(rules.isEnglishTarget("query"), true);
assert.equal(rules.isEnglishTarget("window function"), true);
assert.equal(rules.isEnglishTarget("https://example.com"), false);
assert.equal(rules.isEnglishTarget("SQL查询"), false);
assert.equal(rules.isSentenceTarget("A query retrieves rows from a table."), true);
assert.equal(rules.isSentenceTarget("查询数据"), false);
assert.equal(rules.isPassageTarget("SQL retrieves data. Analysts then inspect the results and explain the findings."), true);
assert.equal(rules.isPassageTarget("https://example.com"), false);
assert.equal(rules.shouldSkipTarget("the", { skipCommonWords: true }), true);
assert.equal(rules.shouldSkipTarget("query", { skipCommonWords: true }), false);
assert.equal(rules.shouldSkipTarget("SQL", { skipAcronyms: true }), true);
assert.equal(rules.cleanTranslation("翻译：查询；检索", false), "查询");
assert.equal(rules.cleanSentenceTranslation("译文：查询从数据表中检索行。"), "查询从数据表中检索行。");
assert.equal(rules.cleanPassageTranslation("译文：第一句。\n第二句。"), "第一句。\n第二句。");
assert.equal(rules.compactContext("A query retrieves rows from a table.", "query").includes("query"), true);

console.log("rules tests passed");
