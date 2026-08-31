# waarmerk

Hand a parser's error to the code that embedded it — span moved, metadata intact, and the parser still vouching for it. **~0.5KB min+gzip, zero runtime dependencies.**

[![NPM version](https://img.shields.io/npm/v/waarmerk.svg)](https://www.npmjs.com/package/waarmerk)
[![Build Status](https://github.com/getquario/waarmerk/actions/workflows/test.yml/badge.svg)](https://github.com/getquario/waarmerk/actions/workflows/test.yml)
[![NPM downloads](https://img.shields.io/npm/dm/waarmerk.svg)](https://www.npmjs.com/package/waarmerk)
[![Apache-2.0 license](https://img.shields.io/github/license/getquario/waarmerk.svg)](https://github.com/getquario/waarmerk/blob/main/LICENSE)

<a href="https://webstronauts.com?utm_source=github&utm_medium=readme&utm_campaign=waarmerk">
	<picture>
		<img src="https://webstronauts.com/images/sponsored-by.svg" alt="Sponsored by The Webstronauts" width="200" height="65">
	</picture>
</a>

Any parser embedded in something larger reports faults in its own coordinates: a template engine's expression compiler counts from the start of the expression, not the file; a query engine's pattern matcher counts from the start of the pattern, not the query. The code around it has to move those numbers, and usually does it by rebuilding the error and losing half of what was on it.

waarmerk is the handover. The parser mints an error only it can vouch for, and re-issues it in the caller's coordinates on request — same class, every field, still authentic.

_Waarmerk_ is Dutch for a hallmark — the mark that says whose something is, and that it is genuine.

**This is a package for people writing parsers.** If you are using one, you want its own documentation; waarmerk is what it may be built on.

## Contents

- [Install](#install)
- [Usage](#usage)
- [Why not just throw an error with a code on it?](#why-not-just-throw-an-error-with-a-code-on-it)
- [Used by](#used-by)
- [API](#api)
- [Integrating](#integrating)
  - [Exposing it from your own package](#exposing-it-from-your-own-package)
  - [TypeScript](#typescript)
  - [Budgets](#budgets)
  - [When the text crossed a decode](#when-the-text-crossed-a-decode)
  - [Adding your own context](#adding-your-own-context)
- [Contract](#contract)
- [What waarmerk is not](#what-waarmerk-is-not)
- [Content Security Policy](#content-security-policy)
- [Safety](#safety)
- [Environments](#environments)
- [Contributing](#contributing)
- [License](#license)

## Install

```bash
npm install waarmerk
```

Node.js 22 or newer, ESM only. TypeScript declarations ship with the package; nothing extra to install.

## Usage

A spreadsheet embeds a formula parser. The parser sees `4 * 5` and reports column 2; the user is looking at `=4 * 5` in cell C3. Someone has to move that number, and it should not be the spreadsheet guessing at the parser's internals.

```js
// csv-math/index.js — the parser
import { mint, relocate as relocateFault, store } from "waarmerk";

const diags = store("csv-math");
export const isDiagnostic = diags.isDiagnostic;
export const relocate = (diag, opts) => relocateFault(diags, diag, opts);

export function evaluate(source) {
  const at = source.search(/[^0-9+ ]/);
  if (at !== -1) {
    mint(diags, SyntaxError, `Unexpected "${source[at]}"`, {
      code: "CSVMATH_SYNTAX",
      start: at,
      end: at + 1,
    });
  }
  return source.split("+").reduce((sum, n) => sum + Number(n), 0);
}
```

```js
// your spreadsheet, which embeds it
import { evaluate, isDiagnostic, relocate } from "csv-math";

const recalc = (cells) =>
  cells.map(({ ref, formula }) => {
    try {
      // The parser never sees the leading "=", so its columns are one short.
      return evaluate(formula.slice(1));
    } catch (error) {
      if (!isDiagnostic(error)) throw error;
      throw relocate(error, { prefix: `${ref}: `, offset: 1 });
    }
  });

recalc([{ ref: "C3", formula: "=4 * 5" }]);
// SyntaxError: C3: Unexpected "*"
//   .code  "CSVMATH_SYNTAX"
//   .start 3   .end 4        <- moved from 2, now pointing at "*" in "=4 * 5"
```

The copy is a real `SyntaxError`, carries every field the parser put on it, and still passes `csv-math`'s own `isDiagnostic`. The spreadsheet wrote none of that.

## Why not just throw an error with a code on it?

You can, and for a parser nobody embeds you should. Three things go wrong once something does embed it:

- **Shape is not identity.** `error.code && error.start != null` is true of any error that happens to look right, including one thrown from a callback you were handed. waarmerk authenticates against a `WeakMap` only the parser holds, so a look-alike fails.
- **A hand-rolled copy drops fields.** The embedder copies `message`, `code`, `start`, `end` — then the parser adds a `hint` in a minor release and nobody downstream hears about it. waarmerk copies by descriptor, so a field added later travels for free.
- **A hand-rolled copy is a stranger.** It fails the parser's own guard, so any code that catches it further out no longer recognises it. waarmerk's copy joins the same store.

If none of those bite — your parser is a leaf, its errors are read by humans and not by code — a plain `Error` with a `code` is less machinery for the same result.

## Used by

Four published parsers mint through waarmerk, and they are worth reading as worked integrations:

- **[xprsn](https://github.com/getquario/xprsn)** — an expression language. The worked case for [`origin`](#api): it compiles once and evaluates many times, and scopes a per-evaluator `isDiagnostic` to the compile token it minted with.
- **[sjabloon](https://github.com/getquario/sjabloon)** — a template engine. Mints with a frozen `blocks` array of enclosing-block spans, and uses [`adopt`](#adding-your-own-context) on an xprsn fault it relocated into template coordinates, so the result answers to both packages.
- **[treffer](https://github.com/getquario/treffer)** — an RFC 9485 I-Regexp matcher. Shows the split between located syntax faults and the spanless budget diagnostics `capped` mints.
- **[padvinder](https://github.com/getquario/padvinder)** — an RFC 9535 JSONPath engine. Adopts a treffer pattern fault into query coordinates, and re-exports treffer's code union so its own consumers can name those codes without a treffer dependency.

## API

|                                                      |                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `store(name?)`                                       | A frozen `{ isDiagnostic, origin, name }`. One per package, made at module load. |
| `mint(store, Kind, message, fields?, origin?)`       | **Throws** a diagnostic of class `Kind`, authenticated against `store`.          |
| `adopt(store, error, fields?, origin?)`              | **Returns** `error`, now a member of `store`, with `fields` defined on it.       |
| `capped(store, name, code, limit, actual?, origin?)` | **Throws** a `RangeError` reading `<name> limit of <limit> exceeded`.            |
| `relocate(store, diag, { prefix?, offset?, span? })` | Returns the copy. Throws `TypeError` when `diag` is not from `store`.            |

`mint` and `capped` throw rather than return, so a call site reads as the end of a branch and TypeScript narrows after it. `adopt` and `relocate` hand the error back for you to throw, because both are used mid-expression.

`fields` are defined non-writable, non-configurable and enumerable — so they show up in a spread, resist tampering, and a frozen value you attach stays frozen through any number of relocations.

`origin` is optional and most packages ignore it. It exists for parsers that compile once and evaluate many times: pass a per-compile token and `store.origin(error)` hands it back, so one compilation's runtime errors can be told from another's.

waarmerk defines no error codes and no field names beyond the five it documents — `code`, `start`, `end`, `limit`, `actual`. Which codes exist, and what rides with each, is yours.

## Integrating

### Exposing it from your own package

Callers should never need to know waarmerk is involved, or hold your store. Re-export two names:

```js
const diags = store("csv-math");

export const isDiagnostic = diags.isDiagnostic;
export const relocate = (diag, opts) => relocateFault(diags, diag, opts);
```

That is the whole integration. One store per package, made once at module load.

Name your store, and `relocate` refuses a foreign error as `TypeError("Not a diagnostic from csv-math")` rather than naming a dependency your caller never chose. `store()` without a name says `waarmerk`.

### TypeScript

Types ship with the package. Declare your code union once, on the store, and every code your package throws is checked against it from then on:

```ts
import { type Diagnostic, mint, store } from "waarmerk";

export type CsvMathErrorCode = "CSVMATH_SYNTAX" | "CSVMATH_MAX_NODES";
export interface CsvMathDiagnostic extends Diagnostic<CsvMathErrorCode> {}

const diags = store<CsvMathErrorCode>("csv-math");
export const isDiagnostic = diags.isDiagnostic; // already narrowed — no cast

mint(diags, SyntaxError, "…", { code: "CSVMATH_TYPO", start: 0, end: 1 });
//                               ~~~~ Type '"CSVMATH_TYPO"' is not assignable
```

The point of naming the union on the store is that an undeclared code fails at the line that throws it, rather than shipping and surprising a consumer switching on `code`. Add whatever else your diagnostics carry to the interface; `Diagnostic` names only the five fields waarmerk knows about.

### Budgets

Parsers that accept untrusted input usually cap something. `capped` mints that failure with a consistent shape, so an embedder can tell "your input was malformed" from "your input was too big":

```js
capped(diags, "maxNodes", "CSVMATH_MAX_NODES", 100, 101);
// RangeError: maxNodes limit of 100 exceeded
//   .code "CSVMATH_MAX_NODES"   .limit 100   .actual 101
```

These carry no span, and relocation leaves them that way.

### When the text crossed a decode

`offset` shifts a span, and it is right whenever the parser read a verbatim slice of your text. It is wrong when your text was _decoded_ first — a pattern pulled out of a JSON string literal, where `\\d` is three characters standing for two and every later column slides. There is no offset that fixes that, so name the region instead:

```js
throw relocate(error, { prefix: "$.a[?match(@.b, ...)]: ", span: [16, 24] });
```

`span` replaces the span outright, and wins if you pass both. Neither option ever _adds_ a span to a diagnostic that had none.

### Adding your own context

When you embed a parser and want to be an authority on its faults too, `adopt` takes its diagnostic into your store as well. The copy then belongs to both, and passes both guards:

```js
import { adopt } from "waarmerk";
import { isDiagnostic as isExpression, relocate as relocateExpression } from "csv-math";

try {
  evaluate(body);
} catch (error) {
  if (!isExpression(error)) throw error;
  // csv-math stays the authority on the syntax; you add where it sat.
  throw adopt(diags, relocateExpression(error, { offset: at }), { blocks: open() });
}
```

## Contract

Normative, for anyone implementing against this or relying on it.

**A diagnostic is authenticated by identity, never by shape.** The store that minted it holds the only record. An error carrying a `code` and a `start` that came from somewhere else is not a diagnostic, and its metadata may not be read as if it were.

**A store belongs to the package that mints into it.** waarmerk owns no identity of its own and shares none between packages, so two copies of waarmerk in one dependency tree cannot disagree about who threw what, and packages depending on it version independently.

**A copy is made by the store that minted the original.** It joins that store under the same origin, so it passes the guard the original passed. The original is never mutated, and every own field comes across by descriptor.

**`offset` shifts; `span` replaces.** `span` wins when both are given.

**Relocation never invents a span, and never drops one.** `start` and `end` travel as a pair; a diagnostic carrying one half is not a located fault and does not move, and neither does one whose span is an accessor rather than a value.

**A copy joins only the store that relocated it.** A diagnostic belonging to two stores — one package's fault, re-vouched for by the package that embeds it — has to be `adopt`ed again after relocation to stay in both. That is the isolation guarantee working, not a gap in it.

## What waarmerk is not

It is not a shared-primitives package. Anything that would arrive only because more than one package wants it is out of scope: a module that admits a second unrelated concern stops having an interface and starts having a namespace.

It is not a formatter, an error-reporting library, or a pretty-printer. waarmerk never composes a message beyond `prefix + message`, with the one exception of `capped`. Rendering a span into a caret-and-underline snippet is a separate job and a separate package.

It is not a parser, and has no opinion about how you find the fault — only about handing it over once you have.

## Content Security Policy

waarmerk contains no string-to-code path — no `eval`, no dynamically constructed functions — and needs no `unsafe-eval`. A test greps the shipped source for those spellings, the suite runs under `--disallow-code-generation-from-strings`, and a browser suite serves the shipped file under `default-src 'none'; script-src 'self'` in Chromium and fails on any policy violation.

## Safety

Relocation builds its copy from a class table captured at module load, never through the original's `constructor`, and reads and writes descriptors through `Object` methods captured at the same time. The `WeakMap` operations every store's membership rests on are captured the same way and always called against an explicit receiver. Replacing a prototype's `constructor`, an `Object` method, or a `WeakMap` method after load changes nothing.

The WeakMap behind a store never leaves this module: handing out a way to add a member would make authentication forgeable. Fields are defined non-writable and non-configurable, so a frozen value attached at mint stays frozen through any number of relocations.

Authentication says who minted an error. It says nothing about whether the metadata is safe to render: a `message` built from untrusted input is untrusted text, and escaping it belongs at your output edge. [SECURITY.md](SECURITY.md) has the rest, and the process for reporting a vulnerability.

## Environments

Node.js 22 and newer, ESM only. Browser use is supported through a standards-based ESM bundler in environments supporting ES2024. Direct `<script>` globals, UMD, and CommonJS builds are not provided.

Shipping CommonJS alongside ESM would put two copies of this module in any process that mixed `require` and `import`. Each copy keeps its own table of stores, so a store made through one would not be recognised by the other and every call would throw.

Minting and relocation both cost roughly what constructing an `Error` costs; `isDiagnostic` is a `WeakMap` lookup. Run `npm run bench`.

## Contributing

```bash
git clone https://github.com/getquario/waarmerk.git
cd waarmerk
npm install
git config core.hooksPath .githooks   # enable the commit-msg hook
npm run check
```

`npm run check` is the local gate: formatting, lint, dead-code and dependency checks, the size budget, the unit and type suites, and the browser CSP run. It is the same gate CI runs, so a green `check` locally means a green pull request.

Conventions for this repo live in [AGENTS.md](AGENTS.md); the [Contract](#contract) above is normative and changes to it are breaking.

## License

Copyright 2026 Robin van der Vleuten

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
