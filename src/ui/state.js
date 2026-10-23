// @ts-check
// Shareable state in the URL hash, e.g. #g.weapon=Felarx&g.stat=ammoEfficiency&g.op=gte&g.t=70
// Each view owns a key prefix ("r." range viewer, "g." goal calculator). Pure string helpers are
// exported separately so they can be tested without a browser.

/**
 * Reads one view's fields out of a hash string.
 * @param {string} hash  location.hash, with or without the leading '#'
 * @param {string} prefix
 * @returns {Record<string, string>}
 */
export function parseHash(hash, prefix) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of new URLSearchParams(hash.replace(/^#/, ''))) {
    if (k.startsWith(prefix + '.')) out[k.slice(prefix.length + 1)] = v;
  }
  return out;
}

/**
 * Returns `hash` with one view's fields replaced by `fields` (empty values are dropped).
 * @param {string} hash @param {string} prefix @param {Record<string, string | number>} fields
 */
export function updateHash(hash, prefix, fields) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  for (const k of [...params.keys()]) if (k.startsWith(prefix + '.')) params.delete(k);
  for (const [k, v] of Object.entries(fields)) if (v !== '') params.set(`${prefix}.${k}`, String(v));
  return params.toString();
}

/** @param {string} prefix */
export const loadState = prefix => parseHash(location.hash, prefix);

/** @param {string} prefix @param {Record<string, string | number>} fields */
export function saveState(prefix, fields) {
  const next = updateHash(location.hash, prefix, fields);
  history.replaceState(null, '', next ? `#${next}` : location.pathname + location.search);
}

/**
 * Keeps only the fields that pass their validators, converting where needed.
 * @template T
 * @param {Record<string, string>} raw
 * @param {{[K in keyof T]?: (v: string) => T[K] | undefined}} rules
 * @returns {Partial<T>}
 */
export function pick(raw, rules) {
  /** @type {Partial<T>} */
  const out = {};
  for (const key of /** @type {(keyof T)[]} */ (Object.keys(rules))) {
    const v = raw[/** @type {string} */ (key)];
    if (v === undefined) continue;
    const parsed = rules[key]?.(v);
    if (parsed !== undefined) out[key] = parsed;
  }
  return out;
}

/** Validator: one of a fixed set of strings. @template {string} S @param {readonly S[]} options */
export const oneOf = options => (/** @type {string} */ v) => (options.includes(/** @type {S} */ (v)) ? /** @type {S} */ (v) : undefined);

/** Validator: a finite number, optionally within [min, max]. */
export const num = (min = -Infinity, max = Infinity) => (/** @type {string} */ v) => {
  const n = Number(v);
  return v !== '' && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
