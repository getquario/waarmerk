/**
 * Located diagnostics: errors a parser mints and authenticates as its own.
 *
 * @import { Diagnostic, Fields, Origin, Relocation, Store } from './index.js'
 */

// Saved, never called through the prototype; every use below passes an
// explicit receiver.
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
  KINDS = [SyntaxError, TypeError, RangeError];

/**
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
 * @template {object} E
 * @param {Store} store The adopting package's store.
 * @param {E} error The error to take in.
 * @param {Fields} [fields] Metadata to define on it.
 * @param {Origin} [origin]
 * @returns {E} `error`, now a member of `store`.
 */
export let adopt = (store, error, fields, origin) => {
  const map = members(store);
  if (fields) {
    for (const key of KEYS(fields))
      DEFINE_ONE(error, key, { value: fields[key], enumerable: true });
  }
  WM_SET.call(map, error, origin);
  return error;
};

/**
 * Throw an exhausted-budget diagnostic: a `RangeError` naming the budget, with
 * the limit it passed and the value that passed it.
 *
 * `actual` is optional: a guard that rejects before a count exists has none.
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
 * @param {any} d
 * @param {Relocation} opts
 * @returns {any}
 */
let copyOf = (d, opts) => {
  const proto = PROTO(d);
  return (KINDS.find((Kind) => Kind.prototype === proto) || Error)((opts.prefix || "") + d.message);
};

/**
 * The original's own descriptors, less `message` and `stack`, which the fresh
 * error mints for itself, with the span moved into the embedder's coordinates.
 *
 * @param {any} props
 * @param {Relocation} opts
 * @returns {any}
 */
let located = (props, { offset = 0, span }) => {
  delete props.message;
  delete props.stack;
  // An accessor `adopt` took in has no value to shift, and spreading one
  // alongside a `value` makes a descriptor `defineProperties` rejects.
  if (props.start && "value" in props.start && props.end && "value" in props.end) {
    const [start, end] = span || [props.start.value + offset, props.end.value + offset];
    props.start = { ...props.start, value: start };
    props.end = { ...props.end, value: end };
  }
  return props;
};
