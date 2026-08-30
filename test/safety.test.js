import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adopt, mint, relocate, store } from "../lib/index.js";

let caught = (run) => {
  try {
    run();
  } catch (e) {
    return e;
  }
};
let minted = (diags, Kind, message, fields, origin) =>
  caught(() => mint(diags, Kind, message, fields, origin));

const source = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

test("the shipped source contains no string-to-code path", () => {
  // The suite already runs under --disallow-code-generation-from-strings; this
  // scan is what keeps the spellings out of comments too, so a grep across the
  // stack stays a reliable answer.
  for (const pattern of [/\beval\b/, /\bFunction\(/, /new Function/]) {
    assert.ok(!pattern.test(source), "lib/index.js mentions " + pattern);
  }
});

test("a store hands out no way to mark an error", () => {
  const diags = store();
  // The map lives in a module-private table keyed by this object. Authentication
  // is only worth having if a caller holding a store cannot forge a member.
  assert.deepStrictEqual(Object.keys(diags).sort(), ["isDiagnostic", "name", "origin"]);
  assert.ok(Object.isFrozen(diags));
  assert.strictEqual(typeof diags.isDiagnostic, "function");
  assert.strictEqual(typeof diags.origin, "function");
  assert.ok(!diags.isDiagnostic(SyntaxError("m")));
});

test("an own constructor on the diagnostic cannot mint the copy", () => {
  const diags = store(),
    original = minted(diags, SyntaxError, "m", { code: "X", start: 0, end: 1 });
  let called = false;
  Object.defineProperty(original, "constructor", {
    value: () => ((called = true), { not: "an Error" }),
    enumerable: true,
    configurable: true,
  });
  const copy = relocate(diags, original, { prefix: "cell: " });
  assert.ok(!called);
  assert.ok(copy instanceof SyntaxError);
  assert.ok(copy instanceof Error);
});

test("replacing an error class's prototype constructor cannot reshape a copy", () => {
  const diags = store(),
    original = minted(diags, TypeError, "m", { code: "X" }),
    real = TypeError.prototype.constructor;
  Object.defineProperty(TypeError.prototype, "constructor", {
    value: function Evil() {
      return { not: "an Error" };
    },
    configurable: true,
    writable: true,
  });
  try {
    const copy = relocate(diags, original, { prefix: "cell: " });
    assert.ok(copy instanceof TypeError);
    assert.ok(diags.isDiagnostic(copy));
  } finally {
    Object.defineProperty(TypeError.prototype, "constructor", {
      value: real,
      configurable: true,
      writable: true,
    });
  }
});

test("replacing the object intrinsics after load cannot reshape a copy", () => {
  const diags = store(),
    original = minted(diags, SyntaxError, "m", { code: "X", start: 1, end: 2 }),
    descs = Object.getOwnPropertyDescriptors,
    define = Object.defineProperties;
  Object.getOwnPropertyDescriptors = () => ({ hijacked: { value: 1, enumerable: true } });
  Object.defineProperties = () => {
    throw Error("should not be reached");
  };
  try {
    const copy = relocate(diags, original, { offset: 1 });
    assert.strictEqual(copy.code, "X");
    assert.strictEqual(copy.start, 2);
    assert.ok(!Object.hasOwn(copy, "hijacked"));
  } finally {
    Object.getOwnPropertyDescriptors = descs;
    Object.defineProperties = define;
  }
});

test("replacing the WeakMap operations after load cannot break authentication", () => {
  // Every store's membership lives behind these three. A package that captured
  // them at load and then read `map.set` off the prototype anyway would let a
  // replacement stop it authenticating anything it throws — which is how this
  // was found, by a consumer whose own suite already pinned it.
  // oxlint-disable-next-line typescript/unbound-method
  const set = WeakMap.prototype.set;
  // oxlint-disable-next-line typescript/unbound-method
  const get = WeakMap.prototype.get;
  // oxlint-disable-next-line typescript/unbound-method
  const has = WeakMap.prototype.has;
  try {
    WeakMap.prototype.set = function () {
      return this;
    };
    WeakMap.prototype.get = () => ({});
    WeakMap.prototype.has = () => true;
    const diags = store(),
      original = minted(diags, SyntaxError, "m", { code: "X", start: 1, end: 2 });
    assert.ok(diags.isDiagnostic(original));
    assert.ok(!diags.isDiagnostic(SyntaxError("spoof")));
    const copy = relocate(diags, original, { prefix: "cell: ", offset: 1 });
    assert.ok(diags.isDiagnostic(copy));
    assert.strictEqual(copy.start, 2);
  } finally {
    WeakMap.prototype.set = set;
    WeakMap.prototype.get = get;
    WeakMap.prototype.has = has;
  }
});

test("an accessor where a span belongs does not become a broken descriptor", () => {
  // `mint` defines `start` non-configurably, so it cannot become an accessor
  // afterwards — but `adopt` takes errors this module did not make, and one can
  // arrive carrying anything. Relocation has to copy it without minting a
  // descriptor that is both a value and a getter.
  const diags = store(),
    odd = SyntaxError("m");
  Object.defineProperty(odd, "start", { get: () => 3, configurable: true, enumerable: true });
  Object.defineProperty(odd, "end", { get: () => 4, configurable: true, enumerable: true });
  adopt(diags, odd, { code: "X" });
  const copy = relocate(diags, odd, { prefix: "cell: ", offset: 1 });
  assert.strictEqual(copy.message, "cell: m");
  assert.strictEqual(copy.code, "X");
  // Copied across, not shifted: there was no value to shift.
  assert.strictEqual(copy.start, 3);
});

test("a symbol key in fields is not carried", () => {
  // `Object.keys` skips symbols, so a symbol-keyed field never reaches the
  // diagnostic. Pinned because the alternative — carrying it — would put a key
  // on the metadata that no embedder can enumerate.
  const diags = store(),
    key = Symbol("hidden");
  assert.throws(
    () => mint(diags, SyntaxError, "m", { code: "X", [key]: 1 }),
    (e) => (assert.strictEqual(e[key], undefined), assert.strictEqual(e.code, "X"), true),
  );
});

test("a field named message replaces the message, and stack never rides along", () => {
  // Both descriptors are dropped so the copy carries its own. `message` is
  // therefore whatever the original ended up with — a field of that name wins
  // over the minted one, and the prefix goes in front of the winner.
  const diags = store(),
    original = minted(diags, SyntaxError, "m", { code: "X", message: "shadow", stack: "fake" });
  assert.strictEqual(original.message, "shadow");
  const copy = relocate(diags, original, { prefix: "cell: " });
  assert.strictEqual(copy.message, "cell: shadow");
  assert.notStrictEqual(copy.stack, "fake");
});

test("adopting a field over a different value refuses, over the same value does not", () => {
  // Fields are non-configurable, so a second define is legal only when it
  // changes nothing. padvinder leans on the allowed half: it relocates a span
  // into place and then adopts the same numbers as its own.
  const diags = store(),
    original = minted(diags, SyntaxError, "m", { code: "X", start: 3, end: 4 });
  assert.strictEqual(adopt(diags, original, { start: 3 }), original);
  assert.throws(() => adopt(diags, original, { start: 9 }), TypeError);
});
