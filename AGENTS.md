# waarmerk

The located diagnostic for the quario parser family. Plain JS + JSDoc, zero runtime dependencies. `lib/index.js` is the implementation and the package.

Work is done when `npm run check` is green. Scripts live in `package.json`. Run them on Node: Bun accepts `--disallow-code-generation-from-strings` but does not enforce it. A single suite is `node --disallow-code-generation-from-strings --test test/relocate.test.js`. The contract is normative in `README.md`, and `## Used by` there names the four packages that mint through this one; this file is how to work on it.

## Architecture

Five exports and one private table. `store()` mints a frozen `{ isDiagnostic, origin }` and files the WeakMap behind it in a module-private `STORES` map, so a caller holding a store can ask about membership and origin and has no way to add one. `adopt()` takes an error into a store and defines fields on it; `mint()` is `adopt()` over a fresh error, and throws; `capped()` is `mint()` with the budget sentence composed. `relocate()` copies by descriptor into a fresh error built from a captured class table.

Every identity is **per store, and a store belongs to one package**. waarmerk keeps the `STORES` table so a store cannot hand out a way to add a member, but it owns no identity of its own and shares none between packages: an error is a diagnostic exactly to the store that took it in. That is what lets four packages depend on this one and still version independently — and it is why a second copy of waarmerk in a tree changes nothing, since a package always calls the copy it imported.

## Safety

- Intrinsics are captured at module load (`WM_SET`, `WM_GET`, `WM_HAS`, `DESCS`, `DEFINE`, `DEFINE_ONE`, `KEYS`, `PROTO`, `FREEZE`, `KINDS`), and the `WeakMap` operations are always called against an explicit receiver. Reading `map.set` off the prototype instead would let a replacement stop a package authenticating anything it throws. A copy is built from the fixed class table, never through the original's `constructor`, so neither replacing a prototype's `constructor` nor swapping an `Object` method after load can mint an authenticated value that is not an Error. `test/safety.test.js` pins both.
- The WeakMap behind a store never leaves this module. Handing out `map.set` would make authentication forgeable.
- Fields are defined non-writable and non-configurable. A frozen value a caller attaches stays frozen through a relocation.
- Relocation never invents a span, and never drops one.
- Compose closures that already exist in the shipped source. A source-scan test greps `lib/` for `\beval\b`, `Function(` and `new Function`, so comments in `lib/` have to avoid those spellings. The suite runs under `--disallow-code-generation-from-strings`.

Size is a soft goal (budget in `package.json`). Name bindings for readers; `lib/` ships verbatim so those names show up in stack traces.

## Semantics

`test/` is the executable spec. These look like bugs if you tidy them:

- `mint` and `capped` **throw**; they do not return the error. A caller writes `mint(...)` as a statement, and TypeScript propagates the `never` through control-flow analysis only when the callee binding cannot be reassigned.
- `adopt` **returns**. It decorates an error the caller already holds — typically one another package minted and relocated — so the throw reads better at the call site. It is the only way a diagnostic ends up in two stores at once, which is what an embedder needs when the package that knows the syntax stays the authority on the fault.
- `start` and `end` travel as a pair. A field bag carrying one half is not a located fault, and relocation leaves it where it was rather than reading through the half that is missing.
- `span` wins over `offset` when both are passed. It is not a shift with extra steps: it exists because a decode leaves no linear relation between the two coordinate systems.
- A diagnostic with no span never gains one, whichever relocation option was given.
- `relocate` throws `TypeError` on a foreign error rather than passing it through, so a caller cannot mistake a host throw for a diagnostic.
- `Store<Code>` carries the minting package's code union, and `mint`/`adopt`/`capped` take their code as `NoInfer<Code>`. Two things make that work and both look removable: `Fields` names `code` _alongside_ its index signature rather than intersecting with it (an intersection lets the open branch satisfy the key, and the union stops binding), and `NoInfer` keeps the code argument from widening the union it is supposed to be checked against. Drop either and the constraint still compiles while checking nothing.
- `relocate` refuses a foreign error by the store's `name`, which is why `store()` takes one. All four adopters used to hand-roll a pre-check purely to get their own name into that message; the store carrying it deleted four copies of the same guard.
- `capped` composes its message. It is the only place this module writes words, and the wording is padvinder's — `<name> limit of <limit> exceeded`. treffer's own budget faults currently read `I-Regexp resource limit exceeded`, with no name and no number, so adopting `capped` there changes a shipped message. The code is the contract and the message is not, but it is a deliberate change to make, not one to make by accident.

## Conventions

Omakase: one obvious path over knobs. Test the guarantee a user relies on. Add complexity when concrete pressure shows up.

- oxfmt owns formatting on its defaults. `npm run fmt`.
- Comments only where the code cannot: safety rationale, non-obvious tricks.
- Tests are `node:test` in `test/*.test.js` (`mint`, `relocate`, `safety`), run against `lib/`. A new field kind or a new relocation option belongs in the matching suite.
- `test/browser/` serves the shipped file under a strict CSP in Chromium. It is not a duplicate of the Node suites: every guarantee here rests on engine behaviour — WeakMap identity, property descriptors, intrinsics captured at load — and those are worth confirming in a real engine rather than assuming from Node. `lib/` is served **verbatim**, and a check in the harness fetches every served module back and fails if any differs from its source on disk. There is no import map, because this package has no dependency whose bare specifier a browser would fail to resolve; its siblings declare one, and if this package ever gains a dependency it gains a map too rather than rewriting the source.
- **No fuzz target, unlike every sibling.** Nothing here parses: the inputs are a store, an error class, a message, a field bag and relocation options, all built by the calling package rather than by anyone untrusted. A target over that saturated at 22 features and a two-entry corpus after 1.5M executions, and found nothing in the four defects this module has had. The risk that is real — a replaced prototype, a swapped `Object` method or `WeakMap` operation, an accessor where a span belongs — is adversarial and named, so it lives in `test/safety.test.js` as tests with names. Add to that suite instead. The untrusted text stops at the siblings' parsers, which is where their fuzzing earns its keep.
- ESM only. Two module formats would split a store's WeakMap across a `require` / `import` seam.
- Conventional Commits, at most 80 characters.
- `lib/index.d.ts` is hand-written and pulled into `lib/index.js` with `@import`. `checkJs` under `strict` keeps the pair honest.
- Suppress `no-unused-expressions` on the expression that trips it with `// oxlint-disable-next-line` directly above it. oxfmt moves lines, so a trailing comment slips off its target.
- `oxlint-tsgolint` is the binary that runs the type-aware rules; without it they drop silently.
- `test/types.check.ts` ends scopes with `void [...]` so type-only bindings stay live under `no-unused-vars`. It also models how a package narrows `Diagnostic` — by restating its store's predicate over its own diagnostic type, which is what the hand-written declarations downstream do.
- Fallow defaults are the gate.

## Scope

waarmerk is not a shared-primitives package. The blocked-key guard is out of scope on purpose, and so is anything that arrives only because more than one sibling wants it. `README.md` says so publicly; keep it that way, and take the refusal to the quario repo's ADRs rather than reversing it here.
