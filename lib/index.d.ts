/**
 * A located diagnostic: the error a parser minted, carrying the metadata an
 * embedder may rely on.
 *
 * Every field is optional here because which ones a diagnostic carries is the
 * minting package's business — a syntax fault has a span, an exhausted budget
 * has a limit and neither has both.
 *
 * `Code` is the minting package's own union. Naming it once, on the store, is
 * what puts every code literal that package throws under `tsc`: a package
 * writes `interface XDiagnostic extends Diagnostic<XErrorCode> {}` and adds
 * whatever else it carries.
 */
export interface Diagnostic<Code extends string = string> extends Error {
  readonly code?: Code;
  /**
   * Zero-based offset into the parser's own source. Located faults only, and
   * always paired with `end` — relocation moves a span, never half of one.
   */
  readonly start?: number;
  /** Exclusive offset into the parser's own source. Paired with `start`. */
  readonly end?: number;
  /** The budget that was passed. Exhausted-budget diagnostics only. */
  readonly limit?: number;
  /** The value that passed it, where one existed. */
  readonly actual?: number;
}

/**
 * The metadata a mint attaches. Each entry is defined non-writable,
 * non-configurable and enumerable, so a frozen value stays frozen and survives
 * relocation unchanged.
 *
 * `code` is named alongside the index signature rather than intersected with
 * it. An intersection would let the open branch satisfy the key and the union
 * would stop binding — the constraint would compile and check nothing.
 */
export type Fields<Code extends string = string> = {
  readonly code?: Code;
  readonly [key: string]: unknown;
};

/**
 * The scope a diagnostic came from — a per-compile token an evaluator scopes
 * its own narrower guard to. A package with no use for one passes nothing.
 */
export type Origin = unknown;

/**
 * One package's identity, carrying that package's code union.
 *
 * The union is declared here and nowhere else: `mint`, `adopt` and `capped`
 * take their code against this store's `Code`, so a code the package has not
 * declared fails at the call site that throws it rather than shipping.
 */
export interface Store<Code extends string = string> {
  /**
   * Whether this store minted `error`. Identity, never shape.
   *
   * A bound function, not a method: it carries no `this`, and declaring it as
   * one would make every consumer suppress a `unbound-method` lint to
   * re-export it.
   */
  isDiagnostic: (error: unknown) => error is Diagnostic<Code>;
  /** The origin recorded at mint, or `undefined`. */
  origin: (error: unknown) => Origin;
  /**
   * The package this store belongs to, as `relocate` names it when it refuses
   * a foreign error. Passed to `store()`; without one it reads `waarmerk`, which
   * names a dependency the caller never chose.
   */
  readonly name: string;
}

export interface Relocation {
  /** Prepended to the message verbatim. */
  prefix?: string;
  /**
   * Shifts the span: the parser's text was a verbatim slice of the embedder's
   * at this position.
   */
  offset?: number;
  /**
   * Replaces the span: the parser's text was a decode of this region, so no
   * shift can reach through it. Wins over `offset`.
   */
  span?: readonly [number, number];
}

/**
 * Make a store: the identity one package authenticates its diagnostics
 * against. One per package, module-wide.
 *
 * Annotate the binding with the package's own union — `\@type {Store<XErrorCode>}`
 * — and every code that package throws is checked against it from then on.
 *
 * `name` is how `relocate` refuses a foreign error. Pass your package's, so a
 * caller is told which package turned it away rather than the name of a
 * dependency it never chose to install.
 */
export function store<Code extends string = string>(name?: string): Store<Code>;

/**
 * Throw a located diagnostic authenticated against `store`.
 *
 * @throws {Error} Always: the minted diagnostic.
 */
export function mint<Code extends string>(
  store: Store<Code>,
  Kind: (message: string) => Error,
  message: string,
  fields?: NoInfer<Fields<Code>>,
  origin?: Origin,
): never;

/**
 * Take an error into `store`, defining `fields` on it, and hand it back.
 *
 * The one case a mint cannot serve: a diagnostic another package minted and
 * relocated, which an embedder adds its own context to and vouches for as
 * well. The copy then belongs to both stores and passes both guards.
 */
export function adopt<Code extends string, E extends object>(
  store: Store<Code>,
  error: E,
  fields?: NoInfer<Fields<Code>>,
  origin?: Origin,
): E;

/**
 * Throw an exhausted-budget diagnostic: a `RangeError` naming the budget, with
 * the limit it passed and — where a count existed — the value that passed it.
 *
 * @throws {RangeError} Always.
 */
export function capped<Code extends string>(
  store: Store<Code>,
  name: string,
  code: NoInfer<Code>,
  limit: number,
  actual?: number,
  origin?: Origin,
): never;

/**
 * Copy a diagnostic into an embedder's coordinates. The copy joins the same
 * store under the same origin, the original is never mutated, and every own
 * field comes across by descriptor. Relocation never invents a span.
 *
 * @throws {TypeError} When `diag` is not a diagnostic from `store`.
 */
export function relocate<Code extends string>(
  store: Store<Code>,
  diag: unknown,
  opts?: Relocation,
): Diagnostic<Code>;
