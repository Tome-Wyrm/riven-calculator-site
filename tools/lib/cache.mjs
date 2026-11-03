// Upstream data with a local fallback. Each source is fetched fresh when it can be; the copy is kept
// in tools/data/cache/ (git-ignored), and used instead when the fetch fails or the data no longer
// looks right (an API change). An outdated copy beats nothing, and it's something to compare against.
//   --offline   use the cached copies only

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DIR = new URL('../data/cache/', import.meta.url);
const META = new URL('sources.json', DIR);
export const OFFLINE = process.argv.includes('--offline');

/** @returns {Promise<Record<string, {url: string, fetched: string, bytes: number}>>} */
async function readMeta() {
  try { return JSON.parse(await readFile(META, 'utf8')); } catch { return {}; }
}

/**
 * A source's text, fresh or cached. `check` turns the text into the data and says what's wrong with
 * it (an exception counts as wrong); a fresh copy that fails it isn't kept.
 * @template T
 * @param {string} file  cache file name @param {string} name  source name (for sources.json)
 * @param {string} url @param {(text: string) => T} check
 * @returns {Promise<{data: T, fetched: string, fromCache: boolean}>}
 */
async function cached(file, name, url, check) {
  const path = new URL(file, DIR);
  const meta = await readMeta();
  if (!OFFLINE) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'riven-calculator data build' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = check(text);
      await mkdir(DIR, { recursive: true });
      await writeFile(path, text);
      const fetched = new Date().toISOString();
      meta[name] = { url, fetched, bytes: text.length };
      await writeFile(META, JSON.stringify(meta, null, 1));
      return { data, fetched, fromCache: false };
    } catch (e) {
      console.warn(`${name}: ${e instanceof Error ? e.message : e}; using the cached copy`);
    }
  }
  let text;
  try { text = await readFile(path, 'utf8'); } catch { throw new Error(`${name}: no cached copy (${path.pathname})`); }
  return { data: check(text), fetched: meta[name]?.fetched ?? 'unknown', fromCache: true };
}

/**
 * A JSON source, fresh or cached.
 * @template T
 * @param {string} name  cache file name (without .json)
 * @param {string} url
 * @param {{validate?: (data: any) => string | null, clean?: (text: string) => string}} [opts]
 *   validate returns a reason the data looks wrong, or null; clean fixes the raw text before parsing
 * @returns {Promise<{data: T, fetched: string, fromCache: boolean}>}
 */
export function cachedJson(name, url, opts = {}) {
  return cached(`${name}.json`, name, url, text => {
    const data = JSON.parse((opts.clean ?? (t => t))(text));
    const problem = opts.validate?.(data);
    if (problem) throw new Error(`unexpected data: ${problem}`);
    return data;
  });
}

/**
 * A text source (a Lua module, a CSV…), fresh or cached.
 * @param {string} name  cache file name (without extension) @param {string} ext  e.g. 'lua'
 * @param {string} url @param {{validate?: (text: string) => string | null}} [opts]
 * @returns {Promise<{data: string, fetched: string, fromCache: boolean}>}
 */
export function cachedText(name, ext, url, opts = {}) {
  return cached(`${name}.${ext}`, name, url, text => {
    const problem = opts.validate?.(text);
    if (problem) throw new Error(`unexpected data: ${problem}`);
    return text;
  });
}
