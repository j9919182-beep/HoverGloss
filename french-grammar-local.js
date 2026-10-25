(function (root) {
  "use strict";
  const forms = new Map(), participles = new Map(), infinitives = new Set();
  const persons = ["第一人称单数", "第二人称单数", "第三人称单数", "第一人称复数", "第二人称复数", "第三人称复数"];
  const pronouns = { je: 0, j: 0, tu: 1, il: 2, elle: 2, on: 2, nous: 3, vous: 4, ils: 5, elles: 5, ce: 2, c: 2, ça: 2, cela: 2, ceci: 2 };
  const articles = new Set(["le", "la", "les", "l", "un", "une", "des", "du", "de", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos", "leur", "leurs", "ce", "cet", "cette", "ces"]);
  const between = new Set(["ne", "n", "me", "m", "te", "t", "se", "s", "nous", "vous", "le", "la", "les", "l", "lui", "leur", "y", "en", "bien", "déjà", "souvent", "toujours", "parfois"]);
  function add(lemma, tense, words) {
    infinitives.add(lemma);
    words.forEach((word, person) => {
      const matches = forms.get(word) || [];
      matches.push({ lemma, tense, person }); forms.set(word, matches);
    });
  }
  function paradigm(lemma, present, imperfectStem, futureStem, participle) {
    add(lemma, "présent · 直陈式现在时", present.split(" "));
    if (imperfectStem) add(lemma, "imparfait · 未完成过去时", ["ais", "ais", "ait", "ions", "iez", "aient"].map((ending) => imperfectStem + ending));
    if (futureStem) {
      add(lemma, "futur simple · 简单将来时", ["ai", "as", "a", "ons", "ez", "ont"].map((ending) => futureStem + ending));
      add(lemma, "conditionnel présent · 条件式现在时", ["ais", "ais", "ait", "ions", "iez", "aient"].map((ending) => futureStem + ending));
    }
    if (participle) for (const word of participle === "dû" ? ["dû", "due", "dus", "dues"] : participle === "été" ? ["été"] : [participle, participle + "e", participle.endsWith("s") ? participle : participle + "s", participle + "es"]) {
      const candidates = participles.get(word) || []; candidates.push(lemma); participles.set(word, [...new Set(candidates)]);
    }
  }
  const irregular = [
    ["être", "suis es est sommes êtes sont", "ét", "ser", "été"],
    ["avoir", "ai as a avons avez ont", "av", "aur", "eu"],
    ["aller", "vais vas va allons allez vont", "all", "ir", "allé"],
    ["faire", "fais fais fait faisons faites font", "fais", "fer", "fait"],
    ["dire", "dis dis dit disons dites disent", "dis", "dir", "dit"],
    ["pouvoir", "peux peux peut pouvons pouvez peuvent", "pouv", "pourr", "pu"],
    ["vouloir", "veux veux veut voulons voulez veulent", "voul", "voudr", "voulu"],
    ["devoir", "dois dois doit devons devez doivent", "dev", "devr", "dû"],
    ["savoir", "sais sais sait savons savez savent", "sav", "saur", "su"],
    ["venir", "viens viens vient venons venez viennent", "ven", "viendr", "venu"],
    ["voir", "vois vois voit voyons voyez voient", "voy", "verr", "vu"],
    ["prendre", "prends prends prend prenons prenez prennent", "pren", "prendr", "pris"],
    ["apprendre", "apprends apprends apprend apprenons apprenez apprennent", "appren", "apprendr", "appris"],
    ["comprendre", "comprends comprends comprend comprenons comprenez comprennent", "compren", "comprendr", "compris"],
    ["lire", "lis lis lit lisons lisez lisent", "lis", "lir", "lu"],
    ["écrire", "écris écris écrit écrivons écrivez écrivent", "écriv", "écrir", "écrit"],
    ["mettre", "mets mets met mettons mettez mettent", "mett", "mettr", "mis"],
    ["boire", "bois bois boit buvons buvez boivent", "buv", "boir", "bu"],
    ["partir", "pars pars part partons partez partent", "part", "partir", "parti"],
    ["sortir", "sors sors sort sortons sortez sortent", "sort", "sortir", "sorti"],
    ["dormir", "dors dors dort dormons dormez dorment", "dorm", "dormir", "dormi"],
    ["connaître", "connais connais connaît connaissons connaissez connaissent", "connaiss", "connaîtr", "connu"],
    ["vivre", "vis vis vit vivons vivez vivent", "viv", "vivr", "vécu"],
    ["suivre", "suis suis suit suivons suivez suivent", "suiv", "suivr", "suivi"],
    ["ouvrir", "ouvre ouvres ouvre ouvrons ouvrez ouvrent", "ouvr", "ouvrir", "ouvert"]
  ];
  for (const row of irregular) paradigm(...row);
  for (const lemma of ["finir", "choisir", "réussir", "remplir", "grandir"]) {
    const stem = lemma.slice(0, -2);
    paradigm(lemma, ["is", "is", "it", "issons", "issez", "issent"].map((ending) => stem + ending).join(" "), stem + "iss", lemma, stem + "i");
  }
  // Only listed verbs are conjugated: suffixes alone cannot distinguish a noun from a verb.
  for (const lemma of "parler aimer travailler habiter regarder écouter chercher trouver demander donner penser jouer marcher rester arriver entrer tomber porter utiliser montrer laisser passer continuer expliquer préparer apporter aider sembler visiter fermer manger commencer étudier laver réveiller coucher".split(" ")) {
    if (infinitives.has(lemma)) continue;
    const stem = lemma.slice(0, -2), present = ["e", "es", "e", "ons", "ez", "ent"].map((ending) => stem + ending);
    if (lemma.endsWith("ger")) present[3] = stem + "eons";
    if (lemma.endsWith("cer")) present[3] = stem.slice(0, -1) + "çons";
    paradigm(lemma, present.join(" "), "", lemma, stem + "é");
    add(lemma, "imparfait · 未完成过去时", ["ais", "ais", "ait", "ions", "iez", "aient"].map((ending, index) => {
      const base = index === 3 || index === 4 ? stem : lemma.endsWith("ger") ? stem + "e" : lemma.endsWith("cer") ? stem.slice(0, -1) + "ç" : stem;
      return base + ending;
    }));
  }
  const normalize = (value) => value.normalize("NFC").toLocaleLowerCase("fr");
  function tokensOf(text) {
    return [...text.matchAll(/[\p{L}\p{M}]+/gu)].map((match) => ({ text: match[0], word: normalize(match[0]), start: match.index, end: match.index + match[0].length }));
  }
  function sentencesOf(text) {
    if (typeof Intl.Segmenter === "function") return [...new Intl.Segmenter("fr", { granularity: "sentence" }).segment(text)].map((item) => item.segment.trim()).filter(Boolean);
    return [text.trim()];
  }
  function analyzeSentence(text) {
    const tokens = tokensOf(text), parts = [], verbs = [], points = [], notices = [], seen = new Set();
    const span = (a, b = a) => text.slice(tokens[a].start, tokens[b].end);
    function point(a, b, explanation) {
      const value = span(a, b), key = value + explanation;
      if (!seen.has(key)) { seen.add(key); points.push({ text: value, explanation }); }
    }
    const complex = tokens.some((token) => ["qui", "que", "qu", "dont", "lequel", "laquelle", "lorsque", "puisque", "si", "quand", "parce"].includes(token.word));
    if (complex) notices.push("句中可能有从句、连接词或疑问结构；这里只提示局部线索，不推断整句的从属关系。");
    let structure = "尚未可靠识别句子主干，可先查看下面的局部语法提示。";
    let mainFound = false;
    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i].word, previous = tokens[i - 1]?.word;
      if ((word === "ne" || word === "n") && (word === "ne" || /['’]/.test(text.slice(tokens[i].end, tokens[i + 1]?.start)))) {
        const end = tokens.findIndex((token, index) => index > i && index <= i + 9 && ["pas", "plus", "jamais", "rien", "personne"].includes(token.word));
        if (end > i) point(i, end, "否定线索：ne / n’ 与后面的否定词呼应。pas 通常表示“不”，plus 表示“不再”，jamais 表示“从不”；具体范围仍需结合句意。");
      }
      if (["le", "la", "les", "un", "une", "des"].includes(word)) {
        point(i, i, ["le", "la", "les"].includes(word)
          ? "可能是定冠词（le 阳性单数、la 阴性单数、les 复数）；位于动词前时也可能是宾语代词，此处不据此确认名词的性数。"
          : word === "des" ? "可能是不定冠词复数，也可能是 de + les 的缩合，要看前面的搭配。" : `不定冠词线索：${word === "un" ? "un 通常配阳性单数名词" : "une 通常配阴性单数名词"}。`);
      }
      if (["au", "aux", "du"].includes(word)) point(i, i, word === "du"
        ? "du 可能是 de + le 的缩合，也可能是部分冠词，不能只凭这个词确定其作用。"
        : `${word} 是 ${word === "au" ? "à + le" : "à + les"} 的缩合，表示方向、地点或动词搭配等关系。`);
      if (word === "de" && tokens.slice(0, i).some((token) => ["pas", "plus", "jamais"].includes(token.word))) {
        point(i, Math.min(i + 1, tokens.length - 1), "否定句中的 de 有时替代直接宾语前的不定冠词或部分冠词，如不吃某类食物。也可能是原搭配中的介词，不能只凭否定词确认。être 后等情况还可能保留原冠词。");
      }
      if (word === "il" && tokens[i + 1]?.word === "y" && tokens[i + 2]?.word === "a") {
        point(i, i + 2, "il y a 是表示“有、存在”的常见结构，il 通常不指具体的人；不要逐词译作“他在那里有”。");
      }
      if (["j", "n", "l", "d", "s", "m", "t", "qu", "c"].includes(word) && tokens[i + 1] && /['’]/.test(text.slice(tokens[i].end, tokens[i + 1].start))) {
        const expanded = { j: "je", n: "ne", l: "le / la", d: "de", s: "se", m: "me", t: "te", qu: "que", c: "ce" }[word];
        point(i, i + 1, `省音线索：${tokens[i].text}’ 常对应 ${expanded}，在元音或哑音 h 前省去末尾元音。l’ 的具体词性仍需结合位置判断。`);
      }
      if (word === "est" && tokens[i + 1]?.word === "ce" && tokens[i + 2]?.word === "que") {
        point(i, i + 2, "est-ce que 是常见的是非疑问句引导结构，后面通常仍按陈述句的主语＋动词顺序。主干以其后的内容为准。"); continue;
      }
      const matches = forms.get(word);
      if (!matches || articles.has(previous) && !["ce", "c", "le", "la", "les", "l"].includes(previous)) continue;
      // A preceding article with no nearby subject is not enough to call e.g. 'le fait' a verb.
      let subject = null;
      for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        if (Object.hasOwn(pronouns, tokens[j].word) && tokens.slice(j + 1, i).every((token) => between.has(token.word)) &&
            !/[.!?;,:]/.test(text.slice(tokens[j].end, tokens[i].start))) {
          const candidate = { index: j, text: tokens[j].text, person: pronouns[tokens[j].word], kind: "代词主语线索" };
          if (matches.some((match) => match.person === candidate.person)) { subject = candidate; break; }
          subject ||= candidate;
        }
      }
      let after = i + 1;
      if (tokens[after]?.word === "t") after++;
      if (!subject && Object.hasOwn(pronouns, tokens[after]?.word) && /-/.test(text.slice(tokens[i].end, tokens[after].start))) {
        subject = { index: after, text: tokens[after].text, person: pronouns[tokens[after].word], kind: "倒装主语线索" };
      }
      if (!subject && !complex && i > 0 && i <= 7 && articles.has(tokens[0].word) && !forms.has(tokens[1]?.word) &&
          !/[,:;]/.test(span(0, i - 1))) {
        let end = i - 1; if (["ne", "n"].includes(tokens[end].word)) end--;
        if (end >= 1) subject = { index: 0, text: span(0, end), person: null, kind: "可能的名词短语主语" };
      }
      if (!subject) {
        // Without a subject, a known spelling is only a verb-form candidate (lit, porte, fait...).
        if (articles.has(previous)) continue;
        const candidates = [...new Set(matches.map((match) => `${match.lemma}（${match.tense}）`))];
        verbs.push({ text: tokens[i].text, explanation: `可能的动词词形：${candidates.join(" / ")}。未定位可靠主语，也可能是其他词性，不能确认其在句中的作用。`, certain: false });
        continue;
      }
      let applicable = subject.person === null ? matches : matches.filter((match) => match.person === subject.person);
      if (!applicable.length) { notices.push(`${span(i)} 的已知变位与附近代词不一致，暂不作肯定判断。`); continue; }
      let next = i + 1;
      while (tokens[next] && ["pas", "plus", "jamais", "bien", "déjà"].includes(tokens[next].word) && next < i + 4) next++;
      const nextWord = tokens[next]?.word;
      if (participles.get(nextWord)?.every((lemma) => ["aller", "venir", "arriver", "partir", "entrer", "sortir", "rester", "tomber"].includes(lemma)) && applicable.some((match) => match.lemma === "être")) {
        applicable = applicable.filter((match) => match.lemma === "être");
      }
      const choices = [...new Set(applicable.map((match) => `${match.lemma}（${match.tense}）`))];
      let end = i, explanation = `词形对应 ${choices.join(" / ")}。${subject.person === null ? "名词短语的人称和数尚未核定。" : `与 ${subject.text} 的${persons[subject.person]}相符。`}`;
      const uniqueLemma = new Set(applicable.map((match) => match.lemma)).size === 1 ? applicable[0].lemma : null;
      if (tokens.slice(subject.index + 1, i).some((token) => ["me", "m", "te", "t", "se", "s", "nous", "vous"].includes(token.word))) {
        point(subject.index, i, "动词前出现 me / te / se / nous / vous 等代词：可能是自反结构，也可能是宾语代词；需要结合动词含义判断，不能都译成“自己”。");
      }
      if (["avoir", "être"].includes(uniqueLemma) && participles.has(nextWord)) {
        const lemmas = participles.get(nextWord);
        const reflexive = tokens.slice(subject.index + 1, i).some((token) => ["se", "s", "me", "m", "te", "t", "nous", "vous"].includes(token.word));
        const movement = lemmas.every((lemma) => ["aller", "venir", "arriver", "partir", "entrer", "sortir", "rester", "tomber"].includes(lemma));
        if (uniqueLemma === "avoir" || reflexive || movement) {
          end = next;
          const tense = applicable[0].tense.startsWith("présent") ? "passé composé · 复合过去时" : applicable[0].tense.startsWith("imparfait") ? "plus-que-parfait · 愈过去时" : "复合时态（需进一步确认）";
          explanation = `${uniqueLemma} 的变位＋过去分词 ${span(next)}（原形 ${lemmas.join(" / ")}），提示 ${tense}。${uniqueLemma === "être" ? "être 结构也需结合上下文区分状态表达，并检查性数配合。" : "此处不要把助动词单独按“拥有”理解。"}`;
        } else point(i, next, "être＋过去分词也可能表示被动态或状态，不能仅凭词形判作复合过去时。");
      } else if (uniqueLemma === "aller" && applicable[0].tense.startsWith("présent") && infinitives.has(nextWord)) {
        end = next; explanation = `aller 的现在时＋不定式 ${nextWord}，提示 futur proche（最近将来时），常用来表达即将发生或计划做的事。`;
      } else if (uniqueLemma && ["pouvoir", "vouloir", "devoir"].includes(uniqueLemma) && infinitives.has(nextWord)) {
        end = next; explanation += ` 后接不定式 ${nextWord}，表达能够、想要或必须做某事。`;
      }
      parts.push({ text: subject.text, role: subject.kind, explanation: "结合附近的已知动词词形得到；这是局部线索。" });
      verbs.push({ text: span(i, end), explanation, certain: choices.length === 1 });
      if (!mainFound && !complex) {
        structure = `${subject.kind}「${subject.text}」＋动词线索「${span(i, end)}」。后面的宾语、表语或状语尚未自动确认。`;
        mainFound = true;
      }
      i = end;
    }
    if (!verbs.length) notices.push("未找到词表覆盖的可靠动词词形；可能是生词、标题、省略句或复杂结构。不会按词尾强行猜动词。");
    return { text, structure, parts, verbs, points, notices: [...new Set(notices)] };
  }
  function analyze(context) {
    if (typeof context !== "string" || !context.trim()) return { sentences: [], version: 1 };
    if (context.length > 3000) return { sentences: [], version: 1, message: "原句超过 3000 字符，请使用较短的语境查看基础提示。" };
    return { version: 1, sentences: sentencesOf(context).map(analyzeSentence) };
  }
  root.HoverGlossFrenchGrammarLocal = { analyze };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HoverGlossFrenchGrammarLocal;
})(globalThis);
