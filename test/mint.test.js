import assert from "node:assert/strict";
import test from "node:test";
import { adopt, capped, mint, relocate, store } from "../lib/index.js";

// The metadata a diagnostic carries is defined, not assigned: the pair a caller
// reads back has to be non-writable and enumerable, which is what lets a frozen
// context ride along beside a plain span.
let descriptor = (e, key) => Object.getOwnPropertyDescriptor(e, key);

test("mint throws, and the thrown error authenticates against its own store", () => {
  const diags = store();
  assert.throws(
    () => mint(diags, SyntaxError, "Unexpected {", { code: "X_SYNTAX", start: 3, end: 4 }),
    (e) => {
      assert.ok(e instanceof SyntaxError);
      assert.ok(diags.isDiagnostic(e));
      assert.strictEqual(e.message, "Unexpected {");
      assert.strictEqual(e.code, "X_SYNTAX");
      assert.strictEqual(e.start, 3);
      assert.strictEqual(e.end, 4);
      return true;
    },
  );
});

test("a diagnostic does not authenticate against another store", () => {
  const mine = store(),
    yours = store();
  assert.throws(
    () => mint(mine, SyntaxError, "mine", { code: "X_SYNTAX" }),
    (e) => (assert.ok(!yours.isDiagnostic(e)), true),
  );
});

test("an error shaped like a diagnostic is not one", () => {
  const diags = store(),
    forged = SyntaxError("Unexpected {");
  forged.code = "X_SYNTAX";
  forged.start = 3;
  forged.end = 4;
  assert.ok(!diags.isDiagnostic(forged));
});

test("fields are defined non-writable and enumerable, never assigned", () => {
  const diags = store();
  assert.throws(
    () => mint(diags, SyntaxError, "m", { code: "X_SYNTAX", start: 0, end: 1 }),
    (e) => {
      assert.deepStrictEqual(descriptor(e, "code"), {
        value: "X_SYNTAX",
        writable: false,
        enumerable: true,
        configurable: false,
      });
      // Enumerable is the half a consumer can see: the metadata shows up in a
      // spread, unlike `message`, which every Error keeps non-enumerable.
      assert.deepStrictEqual(Object.keys(e).sort(), ["code", "end", "start"]);
      return true;
    },
  );
});

test("a frozen context field goes through the same door as a span", () => {
  const diags = store(),
    blocks = Object.freeze(["#each", "#if"]);
  assert.throws(
    () => mint(diags, SyntaxError, "m", { code: "S_SYNTAX", start: 0, end: 1, blocks }),
    (e) => {
      assert.strictEqual(e.blocks, blocks);
      assert.ok(Object.isFrozen(e.blocks));
      assert.strictEqual(descriptor(e, "blocks").configurable, false);
      return true;
    },
  );
});

test("the origin is recorded for a store to hand back", () => {
  const diags = store(),
    compile = Symbol("one compile");
  assert.throws(
    () => mint(diags, SyntaxError, "m", { code: "X_SYNTAX" }, compile),
    (e) => (assert.strictEqual(diags.origin(e), compile), true),
  );
});

test("a diagnostic minted without an origin has none", () => {
  const diags = store();
  assert.throws(
    () => mint(diags, RangeError, "m", { code: "T_MAX" }),
    (e) => (assert.strictEqual(diags.origin(e), undefined), assert.ok(diags.isDiagnostic(e)), true),
  );
});

test("mint carries no fields when a caller passes none", () => {
  const diags = store();
  assert.throws(
    () => mint(diags, TypeError, "bare"),
    (e) => (assert.deepStrictEqual(Object.keys(e), []), assert.ok(diags.isDiagnostic(e)), true),
  );
});

test("mint refuses a value that is not one of this module's stores", () => {
  assert.throws(
    () => mint({ isDiagnostic: () => true, origin: () => {} }, SyntaxError, "m"),
    (e) => (
      assert.ok(e instanceof TypeError),
      assert.strictEqual(e.message, "Not a waarmerk store"),
      true
    ),
  );
});

test("capped names the budget in the message and carries limit and actual", () => {
  const diags = store();
  assert.throws(
    () => capped(diags, "maxNodes", "P_MAX_NODES", 100, 101),
    (e) => {
      assert.ok(e instanceof RangeError);
      assert.ok(diags.isDiagnostic(e));
      assert.strictEqual(e.message, "maxNodes limit of 100 exceeded");
      assert.strictEqual(e.code, "P_MAX_NODES");
      assert.strictEqual(e.limit, 100);
      assert.strictEqual(e.actual, 101);
      assert.ok(!Object.hasOwn(e, "start"));
      return true;
    },
  );
});

test("capped omits actual when the guard rejected before a count existed", () => {
  const diags = store();
  assert.throws(
    () => capped(diags, "patternScalars", "T_MAX_PATTERN_SCALARS", 4096),
    (e) => {
      assert.strictEqual(e.limit, 4096);
      assert.ok(!Object.hasOwn(e, "actual"));
      return true;
    },
  );
});

test("capped records an origin like any other mint", () => {
  const diags = store(),
    run = Symbol("one run");
  assert.throws(
    () => capped(diags, "maxDepth", "P_MAX_DEPTH", 500, 501, run),
    (e) => (assert.strictEqual(diags.origin(e), run), true),
  );
});

test("adopt takes an error another package minted, and both stores vouch for it", () => {
  // sjabloon's shape: xprsn relocated the diagnostic into template coordinates,
  // and sjabloon defines its own context on the copy and vouches for it too.
  const upstream = store(),
    embedder = store(),
    blocks = Object.freeze(["#each"]),
    template = Symbol("one template");
  let translated;
  try {
    mint(upstream, SyntaxError, "Unexpected {", { code: "X_SYNTAX", start: 3, end: 4 });
  } catch (e) {
    translated = relocate(upstream, e, { offset: 12 });
  }
  const ours = adopt(embedder, translated, { blocks }, template);
  assert.strictEqual(ours, translated);
  assert.ok(upstream.isDiagnostic(ours));
  assert.ok(embedder.isDiagnostic(ours));
  assert.strictEqual(embedder.origin(ours), template);
  assert.strictEqual(ours.blocks, blocks);
  assert.strictEqual(ours.start, 15);
});

test("adopt returns rather than throws, and needs neither fields nor origin", () => {
  const diags = store(),
    plain = TypeError("a host function threw");
  assert.strictEqual(adopt(diags, plain), plain);
  assert.ok(diags.isDiagnostic(plain));
  assert.strictEqual(diags.origin(plain), undefined);
  assert.deepStrictEqual(Object.keys(plain), []);
});

test("adopt refuses a value that is not one of this module's stores", () => {
  assert.throws(
    () => adopt({ isDiagnostic: () => true, origin: () => {} }, SyntaxError("m")),
    (e) => (assert.strictEqual(e.message, "Not a waarmerk store"), true),
  );
});
