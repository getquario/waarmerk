import { adopt, capped, mint, relocate, store } from "/lib/index.js";

const result = document.querySelector("#result");
const violations = [];

document.addEventListener("securitypolicyviolation", (event) => {
  violations.push(`${event.violatedDirective}: ${event.blockedURI}`);
});

const assert = (value, message) => {
  if (!value) throw Error(message);
};

const caught = (run) => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

try {
  // What this suite is for: the guarantees rest on engine behaviour — WeakMap
  // identity, property descriptors, intrinsics captured at load — so they are
  // worth confirming in a real engine rather than assuming from Node.
  const diags = store();
  const other = store();
  const compile = Symbol("one compile");

  const located = caught(() =>
    mint(diags, SyntaxError, "Unexpected {", { code: "X_SYNTAX", start: 3, end: 4 }, compile),
  );
  assert(located instanceof SyntaxError, "mint did not throw its own class");
  assert(diags.isDiagnostic(located), "a minted diagnostic failed its own store");
  assert(!other.isDiagnostic(located), "a diagnostic authenticated against another store");
  assert(!diags.isDiagnostic(SyntaxError("spoof")), "an error shaped like one passed");
  assert(diags.origin(located) === compile, "the origin was not recorded");

  const field = Object.getOwnPropertyDescriptor(located, "code");
  assert(!field.writable && !field.configurable, "fields were assigned, not defined");

  const copy = relocate(diags, located, { prefix: "cell: ", offset: 1 });
  assert(copy.message === "cell: Unexpected {", "the prefix was not prepended");
  assert(copy.start === 4 && copy.end === 5, "the span did not shift");
  assert(diags.isDiagnostic(copy), "the copy was not authenticated");
  assert(located.start === 3, "the original was mutated");

  const replaced = relocate(diags, located, { span: [16, 24] });
  assert(replaced.start === 16 && replaced.end === 24, "the span was not replaced");

  const budget = caught(() => capped(diags, "maxNodes", "X_MAX_NODES", 100, 101));
  assert(budget instanceof RangeError, "capped did not throw a RangeError");
  assert(budget.message === "maxNodes limit of 100 exceeded", "the budget sentence changed");
  const kept = relocate(diags, budget, { prefix: "data: " });
  assert(!Object.hasOwn(kept, "start"), "relocation invented a span");

  const frozen = Object.freeze(["#each"]);
  const shared = adopt(other, copy, { blocks: frozen }, compile);
  assert(diags.isDiagnostic(shared) && other.isDiagnostic(shared), "adopt lost a store");
  assert(Object.isFrozen(shared.blocks), "a frozen field did not stay frozen");

  assert(caught(() => relocate(other, located)) instanceof TypeError, "a foreign error passed");

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(violations.length === 0, `CSP violation: ${violations.join(", ")}`);
  result.dataset.status = "passed";
  result.textContent = "passed";
} catch (error) {
  result.dataset.status = "failed";
  result.textContent = error.stack || String(error);
}
