"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
assert.match(source, /\}\)\(\);\s*$/);

class Element {
  constructor(tagName, display = "inline", fontSize = 16) {
    this.tagName = tagName.toUpperCase();
    this.display = display;
    this.fontSize = fontSize;
    this.childNodes = [];
    this.parentElement = null;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.childNodes.push(node);
    }
    return this;
  }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
  getAttribute() { return null; }
  closest(selector) {
    if (selector.includes(".textLayer")) return null;
    const tags = selector.match(/(?:^|,)([a-z][a-z0-9]*)/g)?.map((part) => part.replace(/^,/, "")) || [];
    for (let element = this; element; element = element.parentElement) {
      if (tags.includes(element.tagName.toLowerCase())) return element;
    }
    return null;
  }
}

class TextNode {
  constructor(textContent) {
    this.nodeType = 3;
    this.textContent = textContent;
    this.parentElement = null;
  }
}

const sandbox = {
  chrome: { storage: { local: { async get(defaults) { return defaults; } }, onChanged: { addListener() {} } } },
  document: {
    addEventListener() {},
    createTreeWalker(root, _type, filter) {
      const nodes = [];
      function visit(node) {
        if (node instanceof TextNode) {
          if (filter.acceptNode(node) === 1) nodes.push(node);
        } else for (const child of node.childNodes) visit(child);
      }
      visit(root);
      let index = 0;
      return { nextNode() { return nodes[index++] || null; } };
    }
  },
  NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
  getComputedStyle(element) { return { display: element.display, fontSize: `${element.fontSize}px` }; },
  ConciseHoverRules: {
    isBlockedElement() { return false; },
    normalizeText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  }
};
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,
  "globalThis.testContext = { sentenceForCaret, locateTargetRange };})();"), sandbox, { filename: "content.js" });

const heading = new Element("h1", "block", 28);
const eyebrow = new Element("span", "block", 14).append(new TextNode("Leaders | Our cover"));
const title = new Element("span", "block", 28);
const prefix = new TextNode("Can the AI ");
const emphasis = new Element("em", "inline", 28).append(new TextNode("arms"));
const suffix = new TextNode(" race be stopped?");
title.append(prefix, emphasis, suffix);
heading.append(eyebrow, title);

let sentence = sandbox.testContext.sentenceForCaret(emphasis.childNodes[0], "arms", 2);
assert.equal(sentence.text, "Can the AI arms race be stopped?");
assert.equal(sandbox.testContext.locateTargetRange(sentence.text, "arms", sentence.offset).targetStart, 11);

const inlineHeading = new Element("h2", "block", 26);
const inlineEyebrow = new Element("span", "inline", 14).append(new TextNode("Leaders | Our cover"));
const inlineTitle = new Element("span", "inline", 26).append(new TextNode("Can the AI arms race be stopped?"));
inlineHeading.append(inlineEyebrow, inlineTitle);
sentence = sandbox.testContext.sentenceForCaret(inlineTitle.childNodes[0], inlineTitle.textContent, 11);
assert.equal(sentence.text, "Can the AI arms race be stopped?", "A typographically distinct eyebrow stays outside the title context");

const linkedHeading = new Element("h1", "block", 28);
const titleLink = new Element("a", "inline", 28);
const linkedEyebrow = new Element("span", "block", 14).append(new TextNode("Leaders | Our cover"));
const linkedTitle = new Element("span", "block", 28).append(new TextNode("Can the AI arms race be stopped?"));
linkedHeading.append(titleLink.append(linkedEyebrow, linkedTitle));
sentence = sandbox.testContext.sentenceForCaret(linkedTitle.childNodes[0], linkedTitle.textContent, 11);
assert.equal(sentence.text, "Can the AI arms race be stopped?", "A link around the full heading must not merge its label and title");

const plainWrapper = new Element("div", "block", 28);
const wrapperTitle = new TextNode("Can the AI arms race be stopped?");
plainWrapper.append(new Element("span", "block", 14).append(new TextNode("Leaders | Our cover")), wrapperTitle);
sentence = sandbox.testContext.sentenceForCaret(wrapperTitle, wrapperTitle.textContent, 11);
assert.equal(sentence.text, "Can the AI arms race be stopped?", "A title without an h1 element still excludes a separate label");

const paragraph = new Element("p", "block", 16);
const link = new Element("a", "inline", 16).append(new TextNode("AI arms"));
paragraph.append(new TextNode("The "), link, new TextNode(" race continues."));
sentence = sandbox.testContext.sentenceForCaret(link.childNodes[0], "AI arms", 4);
assert.equal(sentence.text, "The AI arms race continues.", "Inline styling must not split an ordinary sentence");

console.log("context boundary tests passed");
