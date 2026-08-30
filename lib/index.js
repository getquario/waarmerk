/**
 * The located diagnostic: an error a parser minted and authenticated as its
 * own, carrying a code and where in its source the fault is.
 *
 * Authentication is by identity, never by shape — an error that merely carries
 * a `code` and a `start` is not one — and relocation lives with it, because a
 * copy an embedder made would be a spoof to the guard upstream. What this
 * module does not hold is the identity itself: a store belongs to the package
 * that mints into it, so two copies of `waarmerk` in one dependency tree cannot
 * disagree about who threw what.
 *
 * @import { Diagnostic, Fields, Origin, Relocation, Store } from './index.js'
 */

/**
 * Intrinsics captured at module load. A copy is built from a fixed table of
 * error classes rather than through the original's `constructor`, so neither
 * replacing a prototype's `constructor` nor swapping an `Object` method after
 * load can make `relocate` mint an authenticated value that is not an Error.
 *
 * The `WeakMap` operations are captured for the same reason and are always
 * called against an explicit receiver. Every store's membership lives behind
 * them, so a replaced `WeakMap.prototype.set` would otherwise be enough to
 * stop a package authenticating anything it throws.
 */
// Captured, never called through the prototype — `unbound-method` reads the
// saving of a prototype method as the scoping hazard of calling one, and every
// use below passes an explicit receiver.
// oxlint-disable-next-line typescript/unbound-method
const WM_SET = WeakMap.prototype.set;
// oxlint-disable-next-line typescript/unbound-method
const WM_GET = WeakMap.prototype.get;
// oxlint-disable-next-line typescript/unbound-method
const WM_HAS = WeakMap.prototype.has;
const DESCS = Object.getOwnPropertyDescriptors,
  DEFINE = Object.defineProperties,
  DEFINE_ONE = Object.defineProperty,
  KEYS = Object.keys,
  PROTO = Object.getPrototypeOf,
  FREEZE = Object.freeze,
  // The three classes a parser in this family throws. A diagnostic whose
  // prototype a caller replaced falls back to plain Error rather than to
  // whatever the replacement was.
  KINDS = [SyntaxError, TypeError, RangeError];

/**
 * Store -> the WeakMap behind it. Keeping the map here rather than on the store
 * is the whole of the authentication: a caller holding a store can ask whether
 * an error is a member and what its origin is, and has no way to make one.
 *
 * @type {WeakMap<any, WeakMap<any, any>>}
 */
const STORES = new WeakMap();

/**
 * @param {any} store
 * @returns {WeakMap<any, any>}
 */
let members = (store) => {
  const map = WM_GET.call(STORES, store);
  if (!map) throw TypeError("Not a waarmerk store");
  return map;
};

/**
 * Make a store: the identity a package authenticates its own diagnostics
 * against.
 *
 * One per package, module-wide. `isDiagnostic` answers membership, and `origin`
 * hands back whatever the mint recorded — the per-compile token an evaluator
 * scopes its own narrower guard to, or `undefined` where a package has no use
 * for one.
 *
 * @returns {Store} A frozen store.
 */
export let store = (name = "waarmerk") => {
  const map = new WeakMap(),
    s = FREEZE({ isDiagnostic: WM_HAS.bind(map), origin: WM_GET.bind(map), name });
  return (WM_SET.call(STORES, s, map), /** @type {any} */ (s));
};

/**
 * Throw a located diagnostic, authenticated against `store`.
 *
 * Every field is **defined**, not assigned: non-writable, non-configurable and
 * enumerable. That is one door for a plain `start` and for a frozen context a
 * template carries, and it is what makes the metadata survive `relocate`
 * unchanged — the copy goes across by descriptor.
 *
 * @param {Store} store The minting package's store.
 * @param {(msg: string) => Error} Kind The error class to throw.
 * @param {string} message
 * @param {Fields} [fields] The metadata this diagnostic carries.
 * @param {Origin} [origin] The scope this diagnostic came from, when there is one.
 * @returns {never}
 * @throws {Error} Always: the minted diagnostic.
 */
export let mint = (store, Kind, message, fields, origin) => {
  throw adopt(store, Kind(message), fields, origin);
};

/**
 * Take an error into `store`, defining `fields` on it, and hand it back.
 *
 * The one case a mint cannot serve: a diagnostic another package minted and
 * relocated, which an embedder adds its own context to and vouches for as
 * well. The copy then belongs to both stores, and passes both guards — which
 * is the point, because the embedder rethrows it as its own while the package
 * that knows the syntax stays the authority on the fault.
 *
 * Returns rather than throws: the caller is decorating an error it already
 * holds, and the throw reads better at its own call site.
 *
 * @template {object} E
 * @param {Store} store The adopting package's store.
 * @param {E} error The error to take in.
 * @param {Fields} [fields] Metadata to define on it.
 * @param {Origin} [origin]
 * @returns {E} `error`, now a member of `store`.
 */
export let adopt = (store, error, fields, origin) => {
  const map = members(store);
  if (fields) for (const key of KEYS(fields)) DEFINE_ONE(error, key, descriptor(fields[key]));
  WM_SET.call(map, error, origin);
  return error;
};

/**
 * Every field goes in like this: enumerable, so it shows up in a spread, and
 * neither writable nor configurable, so a frozen value a caller attaches stays
 * frozen through any number of relocations.
 *
 * @param {any} value
 * @returns {PropertyDescriptor}
 */
let descriptor = (value) => ({ value, enumerable: true });

/**
 * Throw an exhausted-budget diagnostic: a `RangeError` naming the budget, with
 * the limit it passed and the value that passed it.
 *
 * `actual` is optional because a guard that rejects before a count exists —
 * a length pre-check — has no value to report.
 *
 * @param {Store} store The minting package's store.
 * @param {string} name The budget's own name, as its options spell it.
 * @param {string} code
 * @param {number} limit
 * @param {number} [actual]
 * @param {Origin} [origin]
 * @returns {never}
 */
export let capped = (store, name, code, limit, actual, origin) =>
  mint(
    store,
    RangeError,
    name + " limit of " + limit + " exceeded",
    actual === undefined ? { code, limit } : { code, limit, actual },
    origin,
  );

/**
 * Copy a diagnostic into an embedder's coordinates.
 *
 * The copy joins the same store under the same origin, so it passes the guard
 * the original passed and the narrower guard of whatever scope minted it. The
 * original is never mutated, and every own field comes across by descriptor —
 * so a field the minting package adds later is never a field an embedder
 * forgets.
 *
 * `offset` and `span` are the two ways an embedder's coordinates relate to the
 * parser's. `offset` **shifts**: the text handed over was a verbatim slice of
 * the embedder's own at that position. `span` **replaces**: the text was a
 * decode of that region — a pattern read out of a JSON string literal, say —
 * and no shift can reach through the escapes, so the embedder names the region
 * instead. `span` wins when both are given.
 *
 * Relocation never invents a span. A budget diagnostic has none, and a copy of
 * one has none either, whichever option was passed.
 *
 * @param {Store} store The store that minted `diag`.
 * @param {unknown} diag A diagnostic from that store.
 * @param {Relocation} [opts]
 * @returns {Diagnostic} The relocated copy.
 * @throws {TypeError} When `diag` is not a diagnostic from `store`.
 */
export let relocate = (store, diag, opts = {}) => {
  const map = members(store),
    d = /** @type {any} */ (diag);
  if (!WM_HAS.call(map, d)) throw TypeError("Not a diagnostic from " + store.name);
  const copy = copyOf(d, opts);
  DEFINE(copy, located(DESCS(d), opts));
  WM_SET.call(map, copy, WM_GET.call(map, d));
  return /** @type {Diagnostic} */ (copy);
};

/**
 * The fresh error a relocation copies into.
 *
 * @param {any} d
 * @param {Relocation} opts
 * @returns {any}
 */
let copyOf = (d, opts) => {
  const proto = PROTO(d);
  return (KINDS.find((Kind) => Kind.prototype === proto) || Error)((opts.prefix || "") + d.message);
};

/**
 * The descriptors a copy is defined from: the original's own, less the two an
 * Error mints for itself, with the span moved into the embedder's coordinates.
 *
 * A span is a pair, so both halves are checked before either moves — which is
 * also what keeps relocation from inventing one where there is none.
 *
 * @param {any} props
 * @param {Relocation} opts
 * @returns {any}
 */
let located = (props, { offset = 0, span }) => {
  delete props.message;
  delete props.stack;
  if (movable(props.start) && movable(props.end)) {
    const [start, end] = span || [props.start.value + offset, props.end.value + offset];
    props.start = { ...props.start, value: start };
    props.end = { ...props.end, value: end };
  }
  return props;
};

/**
 * Whether a descriptor is half of a span this module can move.
 *
 * A mint only ever makes data descriptors, but `adopt` takes in errors this
 * module did not make, and one can arrive with an accessor where a span
 * belongs. There is no value on it to shift, and spreading one alongside a
 * `value` makes a descriptor that is both — which `defineProperties` rejects.
 * So it copies across untouched, the same way a diagnostic with no span does.
 *
 * @param {PropertyDescriptor} [d]
 * @returns {boolean}
 */
let movable = (d) => !!d && "value" in d;
