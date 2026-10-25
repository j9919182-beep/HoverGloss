"use strict";

const DOMAIN_GLOSSARY = {
  "aggregate": { value: "聚合", pos: "v." },
  "aggregation": { value: "聚合", pos: "n." },
  "algorithm": { value: "算法", pos: "n." },
  "asset": { value: "资产", pos: "n." },
  "attribute": { value: "属性", pos: "n." },
  "benchmark": { value: "基准", pos: "n." },
  "bias": { value: "偏差", pos: "n." },
  "category": { value: "类别", pos: "n." },
  "clause": { value: "子句", pos: "n." },
  "cluster": { value: "聚类", pos: "n./v." },
  "column": { value: "列", pos: "n." },
  "constraint": { value: "约束条件", pos: "n." },
  "dashboard": { value: "数据看板", pos: "n." },
  "dataset": { value: "数据集", pos: "n." },
  "dimension": { value: "维度", pos: "n." },
  "duplicate": { value: "重复项", pos: "n./adj." },
  "equity": { value: "权益", pos: "n." },
  "estimate": { value: "估计", pos: "v./n." },
  "feature": { value: "特征", pos: "n." },
  "filter": { value: "筛选", pos: "v./n." },
  "forecast": { value: "预测", pos: "n./v." },
  "framework": { value: "框架", pos: "n." },
  "inventory": { value: "库存", pos: "n." },
  "join": { value: "连接", pos: "v./n." },
  "label": { value: "标签", pos: "n." },
  "margin": { value: "利润率", pos: "n." },
  "metric": { value: "指标", pos: "n." },
  "null": { value: "空值", pos: "n." },
  "outlier": { value: "异常值", pos: "n." },
  "pipeline": { value: "流程管道", pos: "n." },
  "procurement": { value: "采购", pos: "n." },
  "query": { value: "查询", pos: "n./v." },
  "regression": { value: "回归", pos: "n." },
  "retention": { value: "留存", pos: "n." },
  "row": { value: "行", pos: "n." },
  "schema": { value: "数据库结构", pos: "n." },
  "segment": { value: "细分群体", pos: "n." },
  "statement": { value: "语句", pos: "n." },
  "table": { value: "数据表", pos: "n." },
  "transaction": { value: "事务", pos: "n." },
  "trend": { value: "趋势", pos: "n." },
  "valuation": { value: "估值", pos: "n." },
  "variance": { value: "差异", pos: "n." },
  "warehouse": { value: "数据仓库", pos: "n." },
  "window function": { value: "窗口函数", pos: "n." },
  "common table expression": { value: "公用表表达式", pos: "n." }
};

const TOPIC_GLOSSARIES = {
  sql: {
    "alias": { value: "别名", pos: "n." },
    "ascending": { value: "升序", pos: "adj." },
    "commit": { value: "提交事务", pos: "v." },
    "correlated": { value: "相关的", pos: "adj." },
    "database": { value: "数据库", pos: "n." },
    "descending": { value: "降序", pos: "adj." },
    "distinct": { value: "去重", pos: "adj." },
    "index": { value: "索引", pos: "n." },
    "operator": { value: "运算符", pos: "n." },
    "partition": { value: "分区", pos: "n." },
    "predicate": { value: "谓词条件", pos: "n." },
    "recursive": { value: "递归的", pos: "adj." },
    "relation": { value: "关系", pos: "n." },
    "relational": { value: "关系型的", pos: "adj." },
    "retrieve": { value: "检索", pos: "v." },
    "rollback": { value: "回滚", pos: "v." },
    "subquery": { value: "子查询", pos: "n." },
    "trigger": { value: "触发器", pos: "n." },
    "tuple": { value: "元组", pos: "n." },
    "view": { value: "视图", pos: "n." }
  },
  "数据分析": {
    "cohort": { value: "同期群", pos: "n." },
    "conversion": { value: "转化", pos: "n." },
    "funnel": { value: "漏斗", pos: "n." },
    "granularity": { value: "数据粒度", pos: "n." },
    "insight": { value: "洞察", pos: "n." },
    "visualization": { value: "数据可视化", pos: "n." }
  },
  "机器学习": {
    "accuracy": { value: "准确率", pos: "n." },
    "classification": { value: "分类", pos: "n." },
    "embedding": { value: "嵌入表示", pos: "n." },
    "inference": { value: "推理", pos: "n." },
    "precision": { value: "精确率", pos: "n." },
    "recall": { value: "召回率", pos: "n." },
    "token": { value: "词元", pos: "n." },
    "training": { value: "训练", pos: "n." }
  },
  "资产评估": {
    "appraisal": { value: "评估", pos: "n." },
    "discount": { value: "折现", pos: "n./v." },
    "enterprise": { value: "企业整体", pos: "n." },
    "impairment": { value: "减值", pos: "n." },
    "intangible": { value: "无形资产", pos: "n." },
    "premium": { value: "溢价", pos: "n." }
  },
  "供应链": {
    "fulfillment": { value: "履约", pos: "n." },
    "lead time": { value: "交付周期", pos: "n." },
    "replenishment": { value: "补货", pos: "n." },
    "shipment": { value: "货运批次", pos: "n." },
    "sku": { value: "库存单位", pos: "n." }
  },
  "动物学": {
    "adaptation": { value: "适应", pos: "n." },
    "anatomy": { value: "解剖学", pos: "n." },
    "biodiversity": { value: "生物多样性", pos: "n." },
    "class": { value: "纲", pos: "n." },
    "ecosystem": { value: "生态系统", pos: "n." },
    "evolution": { value: "进化", pos: "n." },
    "family": { value: "科", pos: "n." },
    "genus": { value: "属", pos: "n." },
    "habitat": { value: "栖息地", pos: "n." },
    "invertebrate": { value: "无脊椎动物", pos: "n." },
    "kingdom": { value: "界", pos: "n." },
    "mammal": { value: "哺乳动物", pos: "n." },
    "morphology": { value: "形态学", pos: "n." },
    "order": { value: "目", pos: "n." },
    "organism": { value: "生物体", pos: "n." },
    "phylum": { value: "门", pos: "n." },
    "population": { value: "种群", pos: "n." },
    "predator": { value: "捕食者", pos: "n." },
    "prey": { value: "猎物", pos: "n." },
    "species": { value: "物种", pos: "n." },
    "specimen": { value: "标本", pos: "n." },
    "taxonomy": { value: "分类学", pos: "n." },
    "vertebrate": { value: "脊椎动物", pos: "n." }
  }
};

const PHRASE_GLOSSARY = {
  "aggregate function": { value: "聚合函数", pos: "n.", topic: "sql" },
  "book value": { value: "账面价值", pos: "n.", topic: "资产评估" },
  "business model": { value: "业务模式", pos: "n." },
  "cash flow": { value: "现金流", pos: "n.", topic: "资产评估" },
  "common table expression": { value: "公用表表达式", pos: "n.", topic: "sql" },
  "data set": { value: "数据集", pos: "n." },
  "european commission": {
    value: "欧盟委员会",
    pos: "n.",
    components: { commission: "委员会" }
  },
  "fair value": { value: "公允价值", pos: "n.", topic: "资产评估" },
  "foreign key": { value: "外键", pos: "n.", topic: "sql" },
  "lead time": { value: "交付周期", pos: "n.", topic: "供应链" },
  "machine learning": { value: "机器学习", pos: "n." },
  "market value": { value: "市场价值", pos: "n.", topic: "资产评估" },
  "order by": { value: "排序", pos: "n./v.", topic: "sql" },
  "present value": { value: "现值", pos: "n.", topic: "资产评估" },
  "primary key": { value: "主键", pos: "n.", topic: "sql" },
  "rate of return": { value: "收益率", pos: "n.", topic: "资产评估" },
  "return home": { value: "回家", pos: "v." },
  "result set": { value: "结果集", pos: "n.", topic: "sql" },
  "return on assets": { value: "资产收益率", pos: "n.", topic: "资产评估" },
  "scalar function": { value: "标量函数", pos: "n.", topic: "sql" },
  "stored procedure": { value: "存储过程", pos: "n.", topic: "sql" },
  "supply chain": { value: "供应链", pos: "n.", topic: "供应链" },
  "unique key": { value: "唯一键", pos: "n.", topic: "sql" },
  "window function": { value: "窗口函数", pos: "n.", topic: "sql" }
};

const CONTEXT_GLOSSARY = {
  "commission": [
    { pattern: /\b(?:european|eu|government|electoral|trade|regulatory)\s+commission\b|\bcommission\s+(?:president|chair|chairman|member|report)\b/i, value: "委员会", pos: "n." },
    { pattern: /\b(?:sales|brokerage|agent|real estate)\s+commission\b|\bcommission\s+(?:rate|fee|payment|income)\b/i, value: "佣金", pos: "n." }
  ],
  "model": [
    { pattern: /machine|training|predict|feature|regression|classification|algorithm/i, value: "模型", pos: "n." },
    { pattern: /business|revenue|operation|pricing/i, value: "业务模式", pos: "n." },
    { pattern: /product|version|device|car/i, value: "型号", pos: "n." },
    { pattern: /runway|fashion|photo shoot/i, value: "模特", pos: "n." }
  ],
  "return": [
    { pattern: /investment|asset|equity|annual|rate|portfolio/i, value: "收益", pos: "n." },
    { pattern: /function|method|query|value|result/i, value: "返回", pos: "v." },
    { pattern: /return(?:ed|ing|s)?\s+(?:the\s+|a\s+|an\s+)?(?:product|item|goods)|customer.*return/i, value: "退回", pos: "v." },
    { pattern: /product return|return policy|refund|returned goods|return order/i, value: "退货", pos: "n." }
  ],
  "order": [
    { pattern: /customer|product|payment|shipping|sales/i, value: "订单", pos: "n." },
    { pattern: /execution|sequence|clause order|in order|order of (?:processing|operations|steps)/i, value: "顺序", pos: "n." },
    { pattern: /order\s+by|sort|ascending|descending|query result/i, value: "排序", pos: "n./v." },
    { pattern: /court|authority|instruction/i, value: "命令", pos: "n." }
  ],
  "value": [
    { pattern: /asset|company|valuation|market|enterprise/i, value: "价值", pos: "n." },
    { pattern: /column|row|field|null|data|variable/i, value: "数值", pos: "n." },
    { pattern: /value of [a-z]\b/i, value: "值", pos: "n." }
  ],
  "field": [
    { pattern: /table|database|column|record|schema/i, value: "字段", pos: "n." },
    { pattern: /research|study|profession|industry/i, value: "领域", pos: "n." },
    { pattern: /played? on the field|sports? field|football field/i, value: "场地", pos: "n." }
  ],
  "stock": [
    { pattern: /warehouse|supply|inventory|sku|replenish/i, value: "库存", pos: "n." },
    { pattern: /market|share|equity|investor|price/i, value: "股票", pos: "n." },
    { pattern: /soup|vegetable|chicken|beef stock/i, value: "高汤", pos: "n." }
  ],
  "operation": [
    { pattern: /business|company|sales|supply|customer/i, value: "运营", pos: "n." },
    { pattern: /database|system|function|mathematical/i, value: "操作", pos: "n." }
  ],
  "function": [
    { pattern: /window\s+function/i, value: "窗口函数", pos: "n." },
    { pattern: /aggregate\s+function/i, value: "聚合函数", pos: "n." },
    { pattern: /scalar\s+function/i, value: "标量函数", pos: "n." }
  ],
  "key": [
    { pattern: /primary\s+key/i, value: "主键", pos: "n." },
    { pattern: /foreign\s+key/i, value: "外键", pos: "n." },
    { pattern: /unique\s+key/i, value: "唯一键", pos: "n." }
  ],
  "set": [
    { pattern: /result\s+set/i, value: "结果集", pos: "n." },
    { pattern: /data\s+set|dataset/i, value: "数据集", pos: "n." }
  ],
  "procedure": [
    { pattern: /stored\s+procedure/i, value: "存储过程", pos: "n." }
  ],
  "query": [
    { pattern: /database|sql|table|rows?|select/i, value: "查询", pos: "n./v." },
    { pattern: /bill|question|raised? a query|query about/i, value: "疑问", pos: "n." }
  ],
  "function": [
    { pattern: /database|sql|window|aggregate|returns?|parameter/i, value: "函数", pos: "n." },
    { pattern: /function of (?:this|the)|button|purpose/i, value: "功能", pos: "n." }
  ],
  "class": [
    { pattern: /taxonomy|taxonomic|species|genus|rank/i, value: "纲", pos: "n." },
    { pattern: /class begins|biology class|attend.*class|classroom/i, value: "课", pos: "n." }
  ],
  "key": [
    { pattern: /primary key|foreign key|unique key|database/i, value: "键", pos: "n." },
    { pattern: /front door|unlock|lost the key|key to the door/i, value: "钥匙", pos: "n." }
  ],
  "set": [
    { pattern: /set (?:the|a) .*? to |set .*? rate to /i, value: "设为", pos: "v." },
    { pattern: /result set|data set|set of/i, value: "集合", pos: "n." }
  ]
};

function normalizeTopic(topic) {
  const value = String(topic || "").trim().toLowerCase();
  if (/sql|mysql|postgres|database|数据库/.test(value)) return "sql";
  if (/数据分析|data analysis|analytics|bi\b/.test(value)) return "数据分析";
  if (/机器学习|machine learning|深度学习|ai\b/.test(value)) return "机器学习";
  if (/资产评估|valuation|appraisal|finance|金融/.test(value)) return "资产评估";
  if (/供应链|supply chain|logistics|物流/.test(value)) return "供应链";
  if (/动物学|zoology|animal biology|taxonomy/.test(value)) return "动物学";
  return "";
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findGlossaryPhrase(target, context, topic, targetStart = -1, targetEnd = -1) {
  const word = String(target || "").trim().toLowerCase();
  const sentence = String(context || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!word || !sentence) return null;
  const topicKey = normalizeTopic(topic);
  const candidates = Object.entries(PHRASE_GLOSSARY)
    .filter(([phrase, item]) => {
      if (item.topic && topicKey && item.topic !== topicKey) return false;
      return new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(phrase);
    })
    .sort((left, right) => right[0].length - left[0].length);

  for (const [phrase, item] of candidates) {
    let index = sentence.indexOf(phrase);
    while (index >= 0) {
      const phraseEnd = index + phrase.length;
      const containsTarget = Number.isFinite(targetStart) && targetStart >= 0
        ? targetStart >= index && Math.max(targetStart + word.length, targetEnd) <= phraseEnd
        : true;
      if (containsTarget) {
        const translation = item.components ? item.components[word] : item.value;
        if (!translation) break;
        return {
          translation,
          pos: item.pos,
          source: "phrase",
          phrase,
          phraseTranslation: item.value,
          matched: true
        };
      }
      index = sentence.indexOf(phrase, index + 1);
    }
  }
  return null;
}

function getGlossaryCandidates(target, context, topic, targetStart = -1, targetEnd = -1) {
  const key = String(target || "").trim().toLowerCase();
  const values = [];
  const phrase = findGlossaryPhrase(target, context, topic, targetStart, targetEnd);
  if (phrase) values.push(phrase);

  const topicKey = normalizeTopic(topic);
  const topicEntry = topicKey ? TOPIC_GLOSSARIES[topicKey]?.[key] : null;
  if (topicEntry) {
    values.push({ translation: topicEntry.value, pos: topicEntry.pos, source: `topic:${topicKey}`, matched: true });
  }

  const contextual = CONTEXT_GLOSSARY[key] || [];
  const nearby = targetStart >= 0
    ? String(context || "").slice(Math.max(0, targetStart - 24), Math.min(String(context || "").length, Math.max(targetEnd, targetStart + key.length) + 24))
    : String(context || "");
  for (const entry of contextual) {
    const matched = entry.pattern.test(nearby);
    values.push({
      translation: entry.value,
      pos: entry.pos,
      source: matched ? "contextual" : "contextual-candidate",
      matched
    });
  }

  const direct = DOMAIN_GLOSSARY[key];
  if (direct) values.push({ translation: direct.value, pos: direct.pos, source: "local", matched: false });

  const seen = new Set();
  return values.filter((item) => {
    const id = `${item.translation}|${item.phrase || ""}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function lookupGlossary(target, context, topic, targetStart = -1, targetEnd = -1) {
  const key = String(target || "").trim().toLowerCase();
  const phrase = findGlossaryPhrase(target, context, topic, targetStart, targetEnd);
  if (phrase) return phrase;
  const topicKey = normalizeTopic(topic);
  const topicEntry = topicKey ? TOPIC_GLOSSARIES[topicKey]?.[key] : null;
  if (topicEntry) return { translation: topicEntry.value, pos: topicEntry.pos, source: `topic:${topicKey}` };
  const contextual = CONTEXT_GLOSSARY[key];
  if (contextual) {
    const match = contextual.find((entry) => entry.pattern.test(context || ""));
    if (match) return { translation: match.value, pos: match.pos, source: "contextual" };
  }
  const direct = DOMAIN_GLOSSARY[key];
  return direct ? { translation: direct.value, pos: direct.pos, source: "local" } : null;
}

function getTopicSeedEntries(topic) {
  const topicKey = normalizeTopic(topic);
  const entries = topicKey ? TOPIC_GLOSSARIES[topicKey] : null;
  if (!entries) return [];
  return Object.entries(entries).map(([term, item]) => ({
    term,
    translation: item.value,
    note: item.pos || "",
    source: `builtin:${topicKey}`,
    status: "generated"
  }));
}

if (typeof globalThis !== "undefined") globalThis.lookupGlossary = lookupGlossary;
if (typeof globalThis !== "undefined") globalThis.getGlossaryCandidates = getGlossaryCandidates;
if (typeof globalThis !== "undefined") globalThis.findGlossaryPhrase = findGlossaryPhrase;
if (typeof globalThis !== "undefined") globalThis.getTopicSeedEntries = getTopicSeedEntries;
if (typeof module === "object" && module.exports) module.exports = {
  lookupGlossary,
  getGlossaryCandidates,
  findGlossaryPhrase,
  normalizeTopic,
  getTopicSeedEntries
};
