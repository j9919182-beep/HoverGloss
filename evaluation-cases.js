(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossEvaluationCases = api;
})(globalThis, function () {
  "use strict";
  // Original, hand-labelled diagnostic sentences. References are never supplied to the translator.
  const groups = [
    ["多义词", "", [
      ["The investment generated a high return.", "return", ["收益", "回报"]],
      ["Please return the item before Friday.", "return", ["退回", "退还", "归还"]],
      ["The function will return a value.", "return", ["返回"]],
      ["The customer placed a new order.", "order", ["订单"]],
      ["Keep the files in alphabetical order.", "order", ["顺序"]],
      ["The warehouse has insufficient stock.", "stock", ["库存", "存货"]],
      ["Investors bought more stock yesterday.", "stock", ["股票"]],
      ["This phone model sells well.", "model", ["型号"]],
      ["The model walked down the runway.", "model", ["模特"]],
      ["Her field of research is zoology.", "field", ["领域"]]
    ]],
    ["短语与意译", "", [
      ["The prime minister spoke at the meeting.", "prime", [], "prime minister", ["总理", "首相"]],
      ["Her credit card expired yesterday.", "credit", ["信用"], "credit card", ["信用卡"]],
      ["We need to take stock of the situation.", "stock", [], "take stock of", ["评估", "盘点", "审视"]],
      ["This product is out of stock.", "stock", [], "out of stock", ["缺货", "售罄", "无库存"]],
      ["She made up her mind yesterday.", "mind", [], "made up her mind", ["下定决心", "决定"]],
      ["Please keep an eye on the shipment.", "eye", [], "keep an eye on", ["留意", "关注", "留心"]],
      ["The project is still up in the air.", "air", [], "up in the air", ["悬而未决", "未定", "不确定"]],
      ["The key metric improved this quarter.", "metric", ["指标"], "key metric", ["关键指标"]],
      ["They reached a turning point in negotiations.", "turning", ["转折"], "turning point", ["转折点"]],
      ["The team met the deadline.", "met", ["赶上", "按时完成", "满足"], "met the deadline", ["按时完成", "赶上截止日期"]]
    ]],
    ["专名与大小写", "", [
      ["The European Commission announced the decision.", "Commission", ["委员会"], "European Commission", ["欧盟委员会", "欧洲委员会"]],
      ["The sales commission increased this year.", "commission", ["佣金", "提成"]],
      ["The European Parliament debated the proposal.", "Parliament", ["议会"], "European Parliament", ["欧洲议会", "欧盟议会"]],
      ["Apple announced a new product.", "Apple", ["苹果", "苹果公司"]],
      ["She ate an apple after lunch.", "apple", ["苹果"]],
      ["The US signed the agreement.", "US", ["美国"]],
      ["Please send the report to us.", "us", ["我们"]],
      ["May is the busiest month.", "May", ["五月", "5月"]],
      ["The bank appointed a new chair.", "chair", ["主席", "董事长"]],
      ["He moved the chair near the window.", "chair", ["椅子"]]
    ]],
    ["SQL", "SQL", [
      ["Create an index on the customer table.", "index", ["索引"]],
      ["A primary key uniquely identifies each row.", "key", ["键", "主键"], "primary key", ["主键"]],
      ["A foreign key connects the two tables.", "key", ["键", "外键"], "foreign key", ["外键"]],
      ["The query returns ten rows.", "query", ["查询"]],
      ["The window function ranks each row.", "function", ["函数"], "window function", ["窗口函数"]],
      ["The result set contains duplicate rows.", "set", ["集", "集合"], "result set", ["结果集"]],
      ["Commit the transaction after validation.", "Commit", ["提交", "提交事务"]],
      ["The view hides unnecessary columns.", "view", ["视图"]],
      ["The value in this column is null.", "value", ["值", "数值"]],
      ["The join combines rows from two tables.", "join", ["连接", "联接"]]
    ]],
    ["数据分析", "数据分析", [
      ["The dashboard shows customer retention.", "retention", ["留存", "留存率"]],
      ["The sample contains an outlier.", "outlier", ["异常值", "离群值"]],
      ["The margin increased after costs fell.", "margin", ["利润率", "利润", "毛利率"]],
      ["The average masks the seasonal trend.", "trend", ["趋势"]],
      ["The analyst calculated the variance.", "variance", ["方差", "差异"]],
      ["Filter the records by date.", "Filter", ["筛选", "过滤"]],
      ["This measure tracks repeat purchases.", "measure", ["指标", "度量"]],
      ["The report groups customers by segment.", "segment", ["细分群体", "群体", "细分市场"]],
      ["The conversion rate increased.", "conversion", ["转化"], "conversion rate", ["转化率"]],
      ["Aggregate sales by region.", "Aggregate", ["汇总", "聚合"]]
    ]],
    ["机器学习", "机器学习", [
      ["Train a model on the new dataset.", "model", ["模型"]],
      ["The network learns useful features.", "features", ["特征"]],
      ["The loss decreased during training.", "loss", ["损失", "损失值"]],
      ["The classifier assigns a label.", "label", ["标签", "类别"]],
      ["The model has a strong bias.", "bias", ["偏差", "偏倚"]],
      ["Regularization reduces overfitting.", "Regularization", ["正则化"]],
      ["The attention layer weighs the tokens.", "attention", ["注意力"]],
      ["The embeddings capture semantic similarity.", "embeddings", ["嵌入", "嵌入向量"]],
      ["The agent receives a reward.", "reward", ["奖励", "回报"]],
      ["The training batch contains thirty samples.", "batch", ["批次", "批", "批量"]]
    ]],
    ["资产评估", "资产评估", [
      ["Estimate the market value of the asset.", "value", ["价值"], "market value", ["市场价值"]],
      ["The discount rate reflects risk.", "discount", ["折现"], "discount rate", ["折现率"]],
      ["The firm needs to raise capital.", "capital", ["资本", "资金"]],
      ["The investor holds equity in the company.", "equity", ["股权", "权益"]],
      ["The asset generates stable cash flow.", "flow", ["流"], "cash flow", ["现金流", "现金流量"]],
      ["The company recorded an impairment loss.", "impairment", ["减值"]],
      ["The residual value is uncertain.", "residual", ["剩余", "残余"], "residual value", ["残值", "剩余价值"]],
      ["The bond yield fell this week.", "yield", ["收益率", "收益"]],
      ["The firm has a large liability.", "liability", ["负债"]],
      ["The appraisal uses comparable transactions.", "appraisal", ["评估", "估价"]]
    ]],
    ["供应链", "供应链", [
      ["The supplier reduced the lead time.", "lead", [], "lead time", ["交货期", "提前期", "前置时间", "交货时间"]],
      ["The plant increased its capacity.", "capacity", ["产能", "生产能力", "容量"]],
      ["The carrier delayed the shipment.", "carrier", ["承运人", "承运商", "运输公司"]],
      ["Demand exceeded supply.", "Demand", ["需求"]],
      ["The warehouse received the shipment.", "warehouse", ["仓库"]],
      ["The procurement team chose a supplier.", "procurement", ["采购"]],
      ["The stock is below the safety level.", "stock", ["库存", "存货"]],
      ["The bottleneck limits throughput.", "throughput", ["吞吐量", "产出量"]],
      ["The customer requested a return.", "return", ["退货"]],
      ["The vendor issued an invoice.", "invoice", ["发票"]]
    ]],
    ["动物学与日常对照", "动物学", [
      ["This species belongs to the order Primates.", "order", ["目"]],
      ["The professor explained the class Mammalia.", "class", ["纲"]],
      ["The biology class begins tomorrow.", "class", ["课", "课堂", "课程"]],
      ["This family includes several genera.", "family", ["科"]],
      ["Her family lives near the coast.", "family", ["家人", "家庭"]],
      ["The species occupies a coastal habitat.", "habitat", ["栖息地", "生境"]],
      ["The bird preys on small insects.", "preys", ["捕食"]],
      ["The bats form a colony in the cave.", "colony", ["群落", "群体"]],
      ["The animal sheds its coat each spring.", "coat", ["皮毛", "毛"]],
      ["The population declined after the drought.", "population", ["种群", "数量", "群体"]]
    ]],
    ["同句多义与重复目标", "", [
      ["The stock market rose while the warehouse ran out of stock.", "stock", [], "out of stock", ["缺货", "无库存"], 2],
      ["The customer order determines the order of processing.", "order", ["订单"], "", [], 1],
      ["The customer order determines the order of processing.", "order", ["顺序"], "", [], 2],
      ["The investment return helped pay for the product return.", "return", ["收益", "回报"], "", [], 1],
      ["The investment return helped pay for the product return.", "return", ["退货"], "", [], 2],
      ["The model checked the prediction model before the show.", "model", ["模特"], "", [], 1],
      ["The model checked the prediction model before the show.", "model", ["模型"], "", [], 2],
      ["She left the door key beside a list of key metrics.", "key", ["钥匙"], "", [], 1],
      ["She left the door key beside a list of key metrics.", "key", ["关键"], "key metrics", ["关键指标"], 2],
      ["The firm raised capital in the capital city.", "capital", ["首都"], "capital city", ["首都"], 2]
    ]]
  ];
  const cases = groups.flatMap(([group, topic, rows]) => rows.map((row, index) => {
    const [context, target, words, phrase = "", phraseMeanings = [], occurrence = 1] = row;
    const matches = [...context.matchAll(new RegExp("\\b" + target + "\\b", "gi"))];
    const targetStart = matches[occurrence - 1]?.index;
    if (!Number.isInteger(targetStart)) throw new Error("Missing target: " + target);
    return { id: group + "-" + (index + 1), group, topic, context, target, targetStart,
      targetEnd: targetStart + target.length, expected: { words, phrase, phraseMeanings },
      provenance: "project-authored", split: group === "同句多义与重复目标" ? "diagnostic" : "evaluation" };
  }));
  return { version: "2026-10-08-1", cases };
});
