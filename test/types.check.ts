import {
  adopt,
  capped,
  mint,
  relocate,
  store,
  type Diagnostic,
  type Fields,
  type Origin,
  type Relocation,
  type Store,
} from "../lib/index.js";

type SjabloonErrorCode = "SJABLOON_SYNTAX" | "SJABLOON_TOO_DEEP";

// A package names its union once, on the store. Everything it throws is
// checked against that from here on, with no cast anywhere.
const diags: Store<SjabloonErrorCode> = store();

// A package's own diagnostic is this one, narrowed and extended.
interface SjabloonDiagnostic extends Diagnostic<SjabloonErrorCode> {
  readonly blocks?: readonly string[];
}

const compile: Origin = Symbol("one compile");
const fields: Fields<SjabloonErrorCode> = { code: "SJABLOON_SYNTAX", start: 3, end: 4 };
const opts: Relocation = { prefix: "detail.cells[0].value: ", offset: 1 };

let parse = (): never => mint(diags, SyntaxError, "Unexpected {", fields, compile);
let exhaust = (): never => capped(diags, "nesting", "SJABLOON_TOO_DEEP", 256, 257, compile);

// The store's own predicate narrows: no `as`, and `code` is the package's union.
if (diags.isDiagnostic(parse)) {
  const code: SjabloonErrorCode | undefined = parse.code;
  const start: number | undefined = parse.start;
  const owner: Origin = diags.origin(parse);
  const copy: Diagnostic<SjabloonErrorCode> = relocate(diags, parse, opts);
  const replaced = relocate(diags, parse, { prefix: "data: ", span: [16, 20] });
  void [code, start, owner, copy, replaced];

  // @ts-expect-error diagnostic metadata is readonly
  parse.start = 1;
}

// A diagnostic another package minted, taken into this store with this
// package's own context on it.
const translated: SjabloonDiagnostic = adopt(
  diags,
  SyntaxError("Unexpected {") as SjabloonDiagnostic,
  { blocks: ["#each"] },
  compile,
);

// @ts-expect-error a code this package has not declared fails where it is thrown
const undeclared = (): never => mint(diags, SyntaxError, "m", { code: "SJABLOON_SYNTX" });

// @ts-expect-error the same guarantee on the budget mint
const undeclaredBudget = (): never => capped(diags, "nesting", "SJABLOON_MAX_NEST", 256, 257);

// @ts-expect-error and on adopt, which defines fields the same way
const undeclaredAdopt = () => adopt(diags, SyntaxError("m"), { code: "NOPE" });

// @ts-expect-error a primitive is not an object to define fields on
const wrongAdopt: string = adopt(diags, "not an error");

// @ts-expect-error the second argument is an error class, not its name
const wrongKind: never = mint(diags, "SyntaxError", "m");

// @ts-expect-error a span is a pair, not a single offset
const wrongSpan: Diagnostic = relocate(diags, parse, { span: 16 });

void [
  exhaust,
  translated,
  undeclared,
  undeclaredBudget,
  undeclaredAdopt,
  wrongAdopt,
  wrongKind,
  wrongSpan,
];
