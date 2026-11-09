// Run: node --test
const test = require("node:test");
const assert = require("node:assert");
const { findMatch } = require("./match.js");

const snippets = { ";addr": "123 Main St", ";a": "A", "sig": "Regards" };
const triggers = Object.keys(snippets).sort((a, b) => b.length - a.length);
const m = (t) => findMatch(t, triggers, snippets);

test("expands at start, after space, after punctuation", () => {
  assert.equal(m(";addr").snippet, "123 Main St");
  assert.equal(m("hi ;addr").start, 3);
  assert.equal(m("(;addr").trigger, ";addr");
  assert.equal(m("x\n;addr").trigger, ";addr");
});
test("no expansion glued to a word", () => {
  assert.equal(m("hello;addr"), null);
  assert.equal(m("mysig"), null);
  assert.equal(m("é;addr"), null);
  assert.equal(m("a1;addr"), null);
});
test("prefers longest trigger, only matches at end", () => {
  assert.equal(m(";addr").trigger, ";addr");
  assert.equal(m(";a").trigger, ";a");
  assert.equal(m(";addr more"), null);
  assert.equal(m(""), null);
});
test("astral-plane preceding char counts as non-word symbol", () => {
  assert.equal(m("😀;addr").trigger, ";addr");
});
