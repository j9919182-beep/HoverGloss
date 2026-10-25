(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HoverGlossWordSenses = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // A deliberately small, first-party set of common senses. These are reference glosses,
  // not claims about the word's meaning in the current sentence or a full dictionary.
  const COMMON = Object.freeze({
    bank: { gloss: "银行；河岸", pos: "n." },
    capital: { gloss: "资本；首都", pos: "n." },
    charge: { gloss: "收费；指控", pos: "v./n." },
    commission: { gloss: "委员会；佣金", pos: "n." },
    credit: { gloss: "信用；学分", pos: "n." },
    draft: { gloss: "草稿；起草", pos: "n./v." },
    interest: { gloss: "兴趣；利息", pos: "n." },
    issue: { gloss: "问题；议题", pos: "n." },
    key: { gloss: "钥匙；关键的", pos: "n./adj." },
    minister: { gloss: "部长；大臣", pos: "n." },
    prime: { gloss: "主要的；首要的", pos: "adj." },
    return: { gloss: "返回；收益", pos: "v./n." },
    scale: { gloss: "规模；刻度", pos: "n." },
    stock: { gloss: "库存；股票", pos: "n." },
    value: { gloss: "价值；数值", pos: "n." }
  });

  function lookup(word) {
    const key = String(word || "").trim().toLowerCase();
    return /^[a-z]+$/.test(key) ? COMMON[key] || null : null;
  }

  return { lookup };
});
