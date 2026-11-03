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
 * A JSON source, fresh or cached.
 * @template T
 * @param {string} name  cache file name (without .json)
 * @param {string} url
 * @param {{validate?: (data: any) => string | null, clean?: (text: string) => string}} [opts]
 *   validate returns a reason the data looks wrong, or null; clean fixes the raw text before parsing
 * @returns {Promise<{data: T, fetched: string, fromCache: boolean}>}
 */
export async function cachedJson(name, url, opts = {}) {
  const file = new URL(`${name}.json`, DIR);
  const meta = await readMeta();
  if (!OFFLINE) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'riven-calculator data build' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = (opts.clean ?? (t => t))(await res.text());
      const data = JSON.parse(text);
      const problem = opts.validate?.(data);
      if (problem) throw new Error(`unexpected data: ${problem}`);
      await mkdir(DIR, { recursive: true });
      await writeFile(file, text);
      const fetched = new Date().toISOString();
      meta[name] = { url, fetched, bytes: text.length };
      await writeFile(META, JSON.stringify(meta, null, 1));
      return { data, fetched, fromCache: false };
    } catch (e) {
      console.warn(`${name}: ${e instanceof Error ? e.message : e}; using the cached copy`);
    }
  }
  let text;
  try { text = await readFile(file, 'utf8'); } catch { throw new Error(`${name}: no cached copy (${file.pathname})`); }
  return { data: JSON.parse(text), fetched: meta[name]?.fetched ?? 'unknown', fromCache: true };
}
