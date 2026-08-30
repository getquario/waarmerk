import assert from "node:assert/strict";
import test from "node:test";
import { adopt, capped, mint, relocate, store } from "../lib/index.js";

// Every case needs a diagnostic in hand rather than a throw to assert on, so
// each one mints and catches once. `caught` takes the mint whole, because
// `capped` composes its own message and has no field bag to pass.
let caught = (run) => {
  try {
    run();
  } catch (e) {
    return e;
  }
};
let minted = (diags, Kind, message, fields, origin) =>
  caught(() => mint(diags, Kind, message, fields, origin));

test("the prefix is prepended verbatim and the span is shifted by the offset", () => {
  const diags = store(),
    original = minted(diags, SyntaxError, "Unexpected {", { code: "X_SYNTAX", start: 3, end: 4 }),
    copy = relocate(diags, original, { prefix: "detail.cells[0].value: ", offset: 1 });
  assert.strictEqual(copy.message, "detail.cells[0].value: Unexpected {");
  assert.strictEqual(copy.start, 4);
  assert.strictEqual(copy.end, 5);
});

test("the copy authenticates against the store that minted the original", () => {
  const diags = store(),
    compile = Symbol("one compile"),
    original = minted(diags, SyntaxError, "m", { code: "X_SYNTAX", start: 0, end: 1 }, compile),
    copy = relocate(diags, original, { prefix: "cell: " });
  assert.ok(diags.isDiagnostic(copy));
  assert.strictEqual(diags.origin(copy), compile);
});

test("the original is never mutated", () => {
  const diags = store(),
    original = minted(diags, SyntaxError, "Unexpected {", { code: "X_SYNTAX", start: 3, end: 4 });
  relocate(diags, original, { prefix: "cell: ", offset: 10 });
  assert.strictEqual(original.message, "Unexpected {");
  assert.strictEqual(original.start, 3);
  assert.strictEqual(original.end, 4);
});

test("the copy keeps the original's class", () => {
  const diags = store();
  for (const Kind of [SyntaxError, TypeError, RangeError]) {
    const copy = relocate(diags, minted(diags, Kind, "m", { code: "X" }), {});
    assert.ok(copy instanceof Kind);
  }
});

test("a class this module does not mint falls back to Error", () => {
  const diags = store(),
    original = minted(diags, SyntaxError, "m", { code: "X" });
  Object.setPrototypeOf(original, EvalError.prototype);
  const copy = relocate(diags, original, { prefix: "cell: " });
  assert.strictEqual(Object.getPrototypeOf(copy), Error.prototype);
  assert.strictEqual(copy.message, "cell: m");
});

test("every own field comes across, including one added since", () => {
  const diags = store(),
    blocks = Object.freeze(["#each"]),
    original = minted(diags, SyntaxError, "m", { code: "S_SYNTAX", start: 2, end: 3, blocks }),
    copy = relocate(diags, original, { offset: 5 });
  assert.strictEqual(copy.code, "S_SYNTAX");
  assert.strictEqual(copy.blocks, blocks);
  assert.ok(Object.isFrozen(copy.blocks));
  assert.strictEqual(Object.getOwnPropertyDescriptor(copy, "blocks").configurable, false);
});

test("the copy carries its own message and stack, not the original's descriptors", () => {
  const diags = store(),
    original = minted(diags, SyntaxError, "m", { code: "X" }),
    copy = relocate(diags, original, { prefix: "cell: " });
  assert.strictEqual(copy.message, "cell: m");
  assert.ok(typeof copy.stack === "string");
  assert.ok(!Object.keys(copy).includes("message"));
});

test("a span-less diagnostic keeps none, whatever the offset", () => {
  const diags = store(),
    original = caught(() => capped(diags, "maxNodes", "P_MAX_NODES", 100, 101)),
    copy = relocate(diags, original, { prefix: "data: ", offset: 12 });
  assert.strictEqual(copy.message, "data: maxNodes limit of 100 exceeded");
  assert.strictEqual(copy.limit, 100);
  assert.strictEqual(copy.actual, 101);
  assert.ok(!Object.hasOwn(copy, "start"));
  assert.ok(!Object.hasOwn(copy, "end"));
});

test("span replaces the span outright, for text that crossed a decode", () => {
  const diags = store(),
    // treffer's span is an offset into the decoded pattern; the same characters
    // in the query source sit behind a JSON escape, so no shift can reach them.
    original = minted(diags, SyntaxError, "Invalid I-Regexp", {
      code: "T_SYNTAX",
      start: 1,
      end: 2,
    }),
    copy = relocate(diags, original, { prefix: "$.a[?match(@.b, '\\\\d')]: ", span: [16, 20] });
  assert.strictEqual(copy.start, 16);
  assert.strictEqual(copy.end, 20);
});

test("relocation never invents a span", () => {
  const diags = store(),
    original = caught(() => capped(diags, "patternScalars", "T_MAX_PATTERN_SCALARS", 4096)),
    copy = relocate(diags, original, { span: [16, 20] });
  assert.ok(!Object.hasOwn(copy, "start"));
  assert.ok(!Object.hasOwn(copy, "end"));
});

test("span wins over offset when a caller passes both", () => {
  const diags = store(),
    original = minted(diags, SyntaxError, "m", { code: "X", start: 3, end: 4 }),
    copy = relocate(diags, original, { offset: 100, span: [7, 9] });
  assert.strictEqual(copy.start, 7);
  assert.strictEqual(copy.end, 9);
});

test("the defaults are an empty prefix and no shift", () => {
  const diags = store(),
    original = minted(diags, SyntaxError, "m", { code: "X", start: 3, end: 4 }),
    copy = relocate(diags, original);
  assert.strictEqual(copy.message, "m");
  assert.strictEqual(copy.start, 3);
  assert.strictEqual(copy.end, 4);
});

test("relocate refuses an error this store did not mint", () => {
  const mine = store(),
    yours = store(),
    theirs = minted(yours, SyntaxError, "m", { code: "X" });
  assert.throws(
    () => relocate(mine, theirs, { prefix: "cell: " }),
    (e) => (
      assert.ok(e instanceof TypeError),
      assert.strictEqual(e.message, "Not a diagnostic from waarmerk"),
      true
    ),
  );
  assert.throws(() => relocate(mine, SyntaxError("plain")), TypeError);
});

test("relocate refuses a value that is not one of this module's stores", () => {
  const diags = store(),
    original = minted(diags, SyntaxError, "m", { code: "X" });
  assert.throws(
    () => relocate({ isDiagnostic: () => true, origin: () => {} }, original),
    (e) => (
      assert.ok(e instanceof TypeError),
      assert.strictEqual(e.message, "Not a waarmerk store"),
      true
    ),
  );
});

test("a copy relocates again, composing the coordinates", () => {
  const diags = store(),
    original = minted(diags, SyntaxError, "m", { code: "X", start: 3, end: 4 }),
    once = relocate(diags, original, { prefix: "value: ", offset: 1 }),
    twice = relocate(diags, once, { prefix: "detail.cells[0].", offset: 10 });
  assert.strictEqual(twice.message, "detail.cells[0].value: m");
  assert.strictEqual(twice.start, 14);
  assert.strictEqual(twice.end, 15);
});

test("a half span is not a span, and does not move", () => {
  // `start` and `end` travel as a pair. A field bag carrying only one half is
  // not a located fault, and relocation leaves it exactly where it was rather
  // than reading through the half that is missing.
  const diags = store(),
    original = adopt(diags, SyntaxError("m"), { code: "X", start: 3 }),
    copy = relocate(diags, original, { prefix: "cell: ", offset: 10 });
  assert.strictEqual(copy.message, "cell: m");
  assert.strictEqual(copy.start, 3);
  assert.ok(!Object.hasOwn(copy, "end"));
});

test("the refusal names the package the store belongs to", () => {
  // Without this a package re-exporting relocate has to pre-check itself, only
  // to name itself in the message — which is what all four consumers did.
  const diags = store("xprsn");
  assert.strictEqual(diags.name, "xprsn");
  assert.throws(
    () => relocate(diags, SyntaxError("from somewhere else")),
    (e) => (assert.strictEqual(e.message, "Not a diagnostic from xprsn"), true),
  );
});
