// Reads the wiki's Lua data modules into plain values.

/**
 * Reads a Lua data module (`return { ... }`: tables, strings, numbers, booleans, comments) into
 * plain values. A table with only positional entries becomes an array. `at` is where the
 * table starts: after "return" by default, or after "local X =" for a module that names it first.
 * @param {string} src @param {string} [at]
 */
export function parseLua(src, at = 'return') {
  let i = 0;
  const fail = (/** @type {string} */ msg) => { throw new Error(`${msg} at ${src.slice(i, i + 40)}`); };
  const skip = () => {
    for (;;) {
      while (/\s/.test(src[i] ?? '')) i++;
      if (src.startsWith('--[[', i)) { i = src.indexOf(']]', i) + 2; continue; }
      if (src.startsWith('--', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
      return;
    }
  };
  const string = () => {
    const q = src[i++];
    let s = '';
    while (src[i] !== q) {
      if (src[i] === '\\') { i++; s += { n: '\n', t: '\t' }[src[i]] ?? src[i]; } else s += src[i];
      i++;
    }
    i++;
    return s;
  };
  /** @returns {any} */
  const value = () => {
    skip();
    const c = src[i];
    if (c === '{') return table();
    if (c === '"' || c === "'") return string();
    const m = src.slice(i, i + 40).match(/^(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|true|false|nil|math\.huge)/);
    // A bare word is a typo for a string (the stance module's `Procs = { "", Knockdown, "" }`): Lua
    // would read nil, but the author meant the name.
    const word = !m && src.slice(i, i + 40).match(/^[A-Za-z_]\w*(?=\s*[,}])/);
    if (word) { i += word[0].length; return word[0]; }
    if (!m) fail('Unexpected value');
    i += m[0].length;
    return { true: true, false: false, nil: null, 'math.huge': Infinity }[m[0]] ?? Number(m[0]);
  };
  const table = () => {
    i++;                                                    // {
    /** @type {Record<string, any>} */
    const named = {};
    const list = [];
    for (;;) {
      skip();
      if (src[i] === '}') { i++; break; }
      let key = null;
      if (src[i] === '[') {
        i++; skip(); key = String(value()); skip();
        if (src[i] !== ']') fail('Expected ]');
        i++; skip(); i++;                                   // ] =
      } else {
        const m = src.slice(i).match(/^([A-Za-z_]\w*)\s*=(?!=)/);
        if (m) { key = m[1]; i += m[0].length; }
      }
      const v = value();
      if (key === null) list.push(v); else named[key] = v;
      skip();
      if (src[i] === ',' || src[i] === ';') i++;
    }
    return Object.keys(named).length ? named : list;
  };
  skip();
  i = src.indexOf(at);
  if (i < 0) fail(`Expected ${at}`);
  i += at.length;
  return value();
}


