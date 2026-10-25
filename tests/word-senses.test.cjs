"use strict";

const assert = require("node:assert/strict");
const senses = require("../word-senses.js");

assert.deepEqual(senses.lookup("Prime"), { gloss: "主要的；首要的", pos: "adj." });
assert.deepEqual(senses.lookup("COMMISSION"), { gloss: "委员会；佣金", pos: "n." });
assert.equal(senses.lookup("quantum"), null, "Uncurated words must not receive an invented dictionary meaning");
assert.equal(senses.lookup("prime minister"), null, "A word lookup must not pretend to define a phrase");
assert.equal(senses.lookup("primes"), null, "Inflections must not be guessed without validation");

console.log("common word sense tests passed");
