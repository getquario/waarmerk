// Manual micro-benchmarks for waarmerk. Run with `npm run bench`.
//
// Both paths are error paths, so neither is hot in the sense a matcher's inner
// loop is. What they have to stay is cheap enough that a parser can afford to
// mint a located fault rather than a bare one, and that an embedder can afford
// to relocate rather than to re-word.
import { adopt, capped, mint, relocate, store } from "../lib/index.js";

let sink = 0;

function consume(value) {
  sink += value ? 1 : 0;
}

function micro(name, fn) {
  for (let t = performance.now(); performance.now() - t < 50;) consume(fn());
  let best = 0;
  for (let sample = 0; sample < 5; sample++) {
    let ops = 0;
    const start = performance.now();
    let elapsed;
    do {
      for (let i = 0; i < 100; i++) consume(fn());
      ops += 100;
      elapsed = performance.now() - start;
    } while (elapsed < 100);
    best = Math.max(best, ops / (elapsed / 1e3));
  }
  console.log(name.padEnd(30), Math.round(best).toLocaleString().padStart(14), "ops/sec");
}

const diags = store(),
  compile = Symbol("one compile"),
  blocks = Object.freeze(["#each", "#if"]);

let caught = (run) => {
  try {
    run();
  } catch (e) {
    return e;
  }
};

const located = caught(() =>
  mint(diags, SyntaxError, "Unexpected {", { code: "X_SYNTAX", start: 3, end: 4 }, compile),
);
const heavy = caught(() =>
  mint(diags, SyntaxError, "Unexpected {", { code: "S_SYNTAX", start: 3, end: 4, blocks }, compile),
);
const budget = caught(() => capped(diags, "maxNodes", "P_MAX_NODES", 100, 101, compile));

console.log(`Node ${process.version} · ${process.platform} ${process.arch}`);
console.log("\nMicrobenchmarks (best of 5)");
micro("mint located", () =>
  caught(() => mint(diags, SyntaxError, "m", { code: "X", start: 1, end: 2 })),
);
micro("mint bare", () => caught(() => mint(diags, TypeError, "m")));
micro("capped", () => caught(() => capped(diags, "maxNodes", "P_MAX_NODES", 100, 101)));
micro("relocate located", () => relocate(diags, located, { prefix: "cell: ", offset: 1 }));
micro("relocate with a frozen field", () =>
  relocate(diags, heavy, { prefix: "cell: ", offset: 1 }),
);
micro("relocate by span", () => relocate(diags, located, { prefix: "data: ", span: [16, 20] }));
micro("relocate span-less", () => relocate(diags, budget, { prefix: "data: " }));
micro("isDiagnostic hit", () => diags.isDiagnostic(located));
// A foreign Error, not a primitive: a primitive takes WeakMap's fast path and
// the miss a consumer actually hits is on an object.
const foreign = TypeError("from a host function");
micro("isDiagnostic miss", () => diags.isDiagnostic(foreign));
micro("adopt onto an existing error", () => adopt(diags, TypeError("m"), { code: "X" }));
