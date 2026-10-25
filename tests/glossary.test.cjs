const assert = require("node:assert/strict");
const {
  lookupGlossary,
  getGlossaryCandidates,
  findGlossaryPhrase,
  normalizeTopic,
  getTopicSeedEntries
} = require("../glossary.js");

assert.equal(lookupGlossary("query", "Write a SQL query.").translation, "查询");
assert.equal(lookupGlossary("model", "Train a machine learning model.").translation, "模型");
assert.equal(lookupGlossary("model", "The company's business model is changing.").translation, "业务模式");
assert.equal(lookupGlossary("return", "The function will return a value.").translation, "返回");
assert.equal(lookupGlossary("return", "Expected annual investment return.").translation, "收益");
assert.equal(lookupGlossary("return", "Customers can return the product within seven days.").translation, "退回");
assert.equal(lookupGlossary("return", "Read the product return policy.").translation, "退货");
assert.equal(lookupGlossary("order", "The order of execution of a query.").translation, "顺序");
assert.equal(lookupGlossary("order", "Use ORDER BY to sort the query result.").translation, "排序");
assert.equal(lookupGlossary("order", "The customer placed a new order.").translation, "订单");
assert.equal(lookupGlossary("stock", "The warehouse has insufficient stock.").translation, "库存");
assert.equal(lookupGlossary("stock", "The stock market opened lower.").translation, "股票");
assert.equal(normalizeTopic("MySQL query optimization"), "sql");
assert.equal(lookupGlossary("index", "Create an index on the table.", "SQL").translation, "索引");
assert.equal(lookupGlossary("recall", "Evaluate the classifier.", "机器学习").translation, "召回率");
assert.equal(getTopicSeedEntries("SQL").some((item) => item.term === "index" && item.translation === "索引"), true);
assert.equal(getTopicSeedEntries("动物学").some((item) => item.term === "order" && item.translation === "目"), true);
assert.equal(lookupGlossary("family", "This family belongs to a larger order.", "动物学").translation, "科");
assert.equal(findGlossaryPhrase("return", "The return on assets improved.", "资产评估", 4, 10).translation, "资产收益率");
assert.equal(findGlossaryPhrase("key", "Use a primary key for this table.", "SQL", 14, 17).phrase, "primary key");
assert.equal(lookupGlossary("Commission", "The European Commission president spoke.").translation, "委员会");
assert.equal(findGlossaryPhrase("Commission", "The European Commission president spoke.", "").phraseTranslation, "欧盟委员会");
assert.equal(findGlossaryPhrase("Commission", "The sales commission increased.", ""), null);
assert.equal(findGlossaryPhrase("European", "The European Commission president spoke.", ""), null);
assert.equal(lookupGlossary("commission", "The government commission issued a report.").translation, "委员会");
assert.equal(lookupGlossary("commission", "The sales commission increased.").translation, "佣金");
const returnCandidates = getGlossaryCandidates("return", "The investment generated a high return.", "资产评估");
assert.equal(returnCandidates.some((item) => item.translation === "收益" && item.matched), true);
assert.equal(returnCandidates.some((item) => item.translation === "返回"), true);

console.log("glossary tests passed");
