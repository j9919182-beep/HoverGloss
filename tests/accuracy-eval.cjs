"use strict";

const { execFileSync } = require("node:child_process");
const path = require("node:path");
const vm = require("node:vm");

function fromReleasedZip(entry) {
  const archive = path.resolve(__dirname, "..", "..", "HoverGloss-v0.8.3.zip");
  const source = execFileSync("tar", ["-xOf", archive, entry], { encoding: "utf8" });
  const context = { module: { exports: {} } };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: entry });
  return context.module.exports;
}

const baseline = process.argv.includes("--baseline");
const { getGlossaryCandidates, lookupGlossary } = baseline
  ? fromReleasedZip("glossary.js")
  : require("../glossary.js");
const { refine } = baseline
  ? fromReleasedZip("context-aligner.js")
  : require("../context-aligner.js");

// Hand-labelled diagnostic cases. Chinese sentences are reference translations,
// not claims about what the browser Translator API produces on a user's machine.
const cases = [
  ["The investment generated a high return.", "return", "资产评估", "这项投资产生了很高的收益。", "返回", "收益"],
  ["The function will return a value.", "return", "SQL", "该函数将返回一个值。", "返回", "返回"],
  ["Customers can return the product within seven days.", "return", "供应链", "客户可在七天内退回商品。", "返回", "退回"],
  ["Read the product return policy.", "return", "供应链", "阅读商品退货政策。", "返回", "退货"],
  ["The return on assets increased.", "return", "资产评估", "资产收益率上升了。", "返回", "资产收益率"],
  ["Expected annual return fell to five percent.", "return", "资产评估", "预期年收益降至百分之五。", "返回", "收益"],
  ["She decided to return home early.", "return", "日常英语", "她决定提前回家。", "返回", "回家"],
  ["The customer placed a new order.", "order", "供应链", "客户下了一个新订单。", "顺序", "订单"],
  ["The order of execution matters.", "order", "SQL", "执行顺序很重要。", "订单", "顺序"],
  ["Use ORDER BY to sort the query result.", "order", "SQL", "使用 ORDER BY 对查询结果排序。", "订单", "排序"],
  ["The court issued an order.", "order", "日常英语", "法院发布了一道命令。", "订单", "命令"],
  ["Primates belong to the order Primates.", "order", "动物学", "灵长类属于灵长目。", "顺序", "目"],
  ["The customer order determines the order of processing.", "order", "供应链", "客户订单决定处理顺序。", "订单", "顺序", 2],
  ["The warehouse has insufficient stock.", "stock", "供应链", "仓库库存不足。", "股票", "库存"],
  ["The stock market opened lower.", "stock", "资产评估", "股票市场低开。", "库存", "股票"],
  ["Add vegetable stock to the soup.", "stock", "日常英语", "往汤里加入蔬菜高汤。", "股票", "高汤"],
  ["Train a machine learning model.", "model", "机器学习", "训练一个机器学习模型。", "型号", "模型"],
  ["The company's business model is changing.", "model", "数据分析", "该公司的业务模式正在改变。", "模型", "业务模式"],
  ["This car model sells well.", "model", "日常英语", "这款汽车型号卖得很好。", "模型", "型号"],
  ["The model walked down the runway.", "model", "日常英语", "模特走上了秀台。", "模型", "模特"],
  ["Add a field to the database table.", "field", "SQL", "在数据库表中添加一个字段。", "领域", "字段"],
  ["Her field of research is zoology.", "field", "动物学", "她的研究领域是动物学。", "字段", "领域"],
  ["The children played on the field.", "field", "日常英语", "孩子们在场地上玩耍。", "字段", "场地"],
  ["Estimate the market value of the asset.", "value", "资产评估", "估计该资产的市场价值。", "数值", "市场价值"],
  ["The value in this column is null.", "value", "SQL", "这一列中的数值为空。", "价值", "数值"],
  ["The function returns the value of x.", "value", "SQL", "该函数返回 x 的值。", "价值", "值"],
  ["Create a primary key for the table.", "key", "SQL", "为该表创建主键。", "钥匙", "主键"],
  ["She lost the key to the front door.", "key", "日常英语", "她丢了前门的钥匙。", "主键", "钥匙"],
  ["The query returns ten rows.", "query", "SQL", "该查询返回十行。", "疑问", "查询"],
  ["She raised a query about the bill.", "query", "SQL", "她对账单提出了疑问。", "查询", "疑问"],
  ["The window function ranks each row.", "function", "SQL", "窗口函数对每一行进行排序。", "功能", "窗口函数"],
  ["The function of this button is to reset the form.", "function", "SQL", "这个按钮的功能是重置表单。", "函数", "功能"],
  ["A foreign key links the two tables.", "key", "SQL", "外键关联这两张表。", "钥匙", "外键"],
  ["The result set contains duplicate rows.", "set", "SQL", "结果集包含重复的行。", "设置", "结果集"],
  ["Set the discount rate to five percent.", "set", "资产评估", "将折现率设为百分之五。", "集合", "设为"],
  ["The word class here refers to a taxonomic rank.", "class", "动物学", "这里的纲指一个分类阶元。", "班级", "纲"],
  ["The biology class begins tomorrow.", "class", "动物学", "生物课明天开始。", "纲", "课"]
];

const holdoutCases = [
  ["The analyst calculated the rate of return.", "return", "资产评估", "分析师计算了收益率。", "返回", "收益率"],
  ["Please return the item before Friday.", "return", "供应链", "请在周五前退回商品。", "返回", "退回"],
  ["We need to return to the office.", "return", "日常英语", "我们需要回到办公室。", "返回", "回到"],
  ["This product is out of stock.", "stock", "供应链", "这款产品缺货了。", "股票", "缺货"],
  ["Investors bought more stock yesterday.", "stock", "资产评估", "投资者昨天买入了更多股票。", "库存", "股票"],
  ["She took stock of the situation.", "stock", "日常英语", "她评估了局势。", "股票", "评估"],
  ["We deployed a new model for predictions.", "model", "机器学习", "我们部署了一个新的预测模型。", "型号", "模型"],
  ["Which model of phone did you buy?", "model", "日常英语", "你买的是哪款手机型号？", "模型", "型号"],
  ["The team entered the field after lunch.", "field", "日常英语", "队员午饭后进入了场地。", "字段", "场地"],
  ["This field stores the user's age.", "field", "SQL", "这个字段存储用户的年龄。", "领域", "字段"],
  ["The colonel gave a direct order.", "order", "日常英语", "上校下达了直接命令。", "订单", "命令"],
  ["Orders are listed in chronological order.", "order", "供应链", "订单按时间顺序排列。", "订单", "顺序"],
  ["The client sent a query about delivery.", "query", "供应链", "客户就交货问题发来咨询。", "查询", "咨询"],
  ["The query filters rows by date.", "query", "SQL", "该查询按日期筛选行。", "疑问", "查询"],
  ["The key metric improved this quarter.", "key", "数据分析", "关键指标本季度有所改善。", "钥匙", "关键"],
  ["The key opens the storage room.", "key", "供应链", "这把钥匙能打开储藏室。", "主键", "钥匙"],
  ["Set the default value in settings.", "set", "SQL", "在设置中设定默认值。", "集合", "设定"],
  ["The result set is empty.", "set", "SQL", "结果集为空。", "设置", "结果集"],
  ["The professor explained the class Mammalia.", "class", "动物学", "教授解释了哺乳纲。", "班级", "纲"],
  ["This class meets on Mondays.", "class", "动物学", "这门课每周一上课。", "纲", "课"]
];

function nthIndexOf(text, term, occurrence) {
  let index = -1;
  for (let i = 0; i < occurrence; i += 1) {
    index = text.toLowerCase().indexOf(term.toLowerCase(), index + 1);
    if (index < 0) throw new Error(`Target not found: ${term} in ${text}`);
  }
  return index;
}

function evaluate(label, items) {
  let correct = 0;
  let highConfidenceErrors = 0;
  for (const [sentence, target, topic, sentenceTranslation, isolated, expected, occurrence = 1] of items) {
    const targetStart = nthIndexOf(sentence, target, occurrence);
    const candidates = typeof getGlossaryCandidates === "function"
      ? getGlossaryCandidates(target, sentence, topic, targetStart, targetStart + target.length)
      : [lookupGlossary(target, sentence, topic, targetStart, targetStart + target.length)].filter(Boolean);
    const result = refine({ translation: isolated, sentenceTranslation, source: "browser", phrase: target }, {
      target, context: sentence, targetStart, targetEnd: targetStart + target.length, candidates
    });
    const pass = result.translation === expected;
    correct += Number(pass);
    highConfidenceErrors += Number(!pass && result.confidence >= 0.85);
    console.log(`${label} ${pass ? "PASS" : "FAIL"}  ${target.padEnd(8)} expected=${expected.padEnd(8)} actual=${result.translation.padEnd(8)} confidence=${result.confidence}  ${sentence}`);
  }
  console.log(`${label} TOTAL ${correct}/${items.length} = ${(100 * correct / items.length).toFixed(1)}%; high-confidence errors ${highConfidenceErrors}`);
}

evaluate("DEV", cases);
evaluate("NEW", holdoutCases);
