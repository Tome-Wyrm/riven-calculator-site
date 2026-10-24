// @ts-check
// Screenshot check (tools/ocr-check.html): runs the site's screenshot reader over every image in test/fixtures/local/
// and compares the result with test/fixtures/local/expected.json. Open tools/ocr-check.html from
// the dev server (python -m http.server 8000, then http://localhost:8000/tools/ocr-check.html);
// it reads the folder through the server's directory listing.
//
// expected.json maps an image's file name to its answer:
//   { "weapon": "Soma", "rank": 8, "stats": ["+267.2 damage", "-31.7 ammoMax"], "locked": [] }
// or, for a picture of two cards side by side, { "twoCards": true }. "weapon": null means the
// weapon can't be read (OCR mangles it), and a stat with no value is written as " corpus".

import { readScreenshot } from '../src/ocr-read.js';

const DIR = '../test/fixtures/local/';
const IMAGE = /\.(png|jpe?g|webp)$/i;

/** @typedef {{weapon?: string | null, rank?: number | null, stats?: string[], locked?: string[], twoCards?: boolean}} Answer */

/** Sorts file names the way people number them: x9 before x10. @param {string} a @param {string} b */
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/** The images in the folder, from the server's directory listing. */
async function listImages() {
  const html = await (await fetch(DIR)).text();
  const names = [...html.matchAll(/href="([^"]+)"/g)].map(m => decodeURIComponent(m[1])).filter(n => IMAGE.test(n));
  return [...new Set(names)].sort(natural);
}

/** @returns {Promise<Record<string, Answer>>} */
async function loadExpected() {
  const res = await fetch(`${DIR}expected.json`, { cache: 'no-store' });
  return res.ok ? res.json() : {};
}

/** A read, in the answer file's shape. @param {import('../src/ocr-read.js').ScreenshotRead} r @returns {Answer} */
function toAnswer(r) {
  if (r.twoCards) return { twoCards: true };
  return {
    weapon: r.weapon?.name ?? null,
    rank: r.rank,
    stats: r.rows.map(s => `${s.value} ${s.statId}`),
    locked: r.rows.filter(s => s.locked).map(s => s.statId),
  };
}

/** What differs between an answer and a read. @param {Answer} want @param {Answer} got @returns {string[]} */
function differences(want, got) {
  if (want.twoCards || got.twoCards) {
    return want.twoCards === got.twoCards ? [] : [want.twoCards ? 'should be flagged as two cards' : 'flagged as two cards, but is one'];
  }
  const out = [];
  if ((want.weapon ?? null) !== (got.weapon ?? null)) out.push(`weapon: ${got.weapon ?? 'not read'}, should be ${want.weapon ?? 'not read'}`);
  if (want.rank !== got.rank) out.push(`rank: ${got.rank}, should be ${want.rank}`);
  const [ws, gs] = [want.stats ?? [], got.stats ?? []];
  const missing = ws.filter(s => !gs.includes(s));
  const extra = gs.filter(s => !ws.includes(s));
  if (missing.length) out.push(`missing ${missing.join(', ')}`);
  if (extra.length) out.push(`read ${extra.join(', ')}`);
  const [wl, gl] = [[...(want.locked ?? [])].sort().join(), [...(got.locked ?? [])].sort().join()];
  if (wl !== gl) out.push(`locked: ${gl || 'none'}, should be ${wl || 'none'}`);
  return out;
}

/** @param {Answer} a */
const describe = a => (a.twoCards ? 'two cards' : `${a.weapon ?? '(no weapon)'} r${a.rank}: ${(a.stats ?? []).join(', ')}`
  + (a.locked?.length ? ` · locked ${a.locked.join(', ')}` : ''));

/** @param {string} tag @param {Record<string, string>} attrs @param {(Node | string)[]} kids */
function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

async function run() {
  const summary = /** @type {HTMLElement} */ (document.getElementById('summary'));
  const tbody = /** @type {HTMLElement} */ (document.getElementById('rows'));
  const json = /** @type {HTMLTextAreaElement} */ (document.getElementById('json'));
  const only = new URLSearchParams(location.search).get('only')?.split(',').map(s => s.trim()).filter(Boolean);
  const expected = await loadExpected();
  const images = (await listImages()).filter(n => !only || only.some(o => n.startsWith(o)));
  /** @type {Record<string, Answer>} */
  const merged = { ...expected };
  const counts = { pass: 0, fail: 0, new: 0 };
  /** @type {Record<string, boolean>} */
  const failed = {};

  for (const [i, name] of images.entries()) {
    summary.textContent = `Reading ${i + 1} of ${images.length}: ${name}…`;
    const blob = await (await fetch(DIR + encodeURIComponent(name))).blob();
    let got;
    try {
      got = toAnswer(await readScreenshot(blob));
    } catch (e) {
      got = /** @type {Answer} */ ({ weapon: null, rank: null, stats: [`error: ${e instanceof Error ? e.message : e}`] });
    }
    const want = expected[name];
    const diff = want ? differences(want, got) : [];
    const status = !want ? 'new' : diff.length ? 'fail' : 'pass';
    counts[status]++;
    if (status === 'fail') failed[name] = true;
    if (!want) merged[name] = got;
    tbody.append(el('tr', {}, [
      el('th', { scope: 'row' }, [name]),
      el('td', { class: status }, [status]),
      el('td', { class: 'read' }, [describe(got)]),
      el('td', { class: 'diff' }, [diff.join('; ')]),
    ]));
  }
  const sorted = Object.fromEntries(Object.keys(merged).sort(natural).map(k => [k, merged[k]]));
  json.value = JSON.stringify(sorted, null, 1);
  summary.textContent = `${counts.pass} pass, ${counts.fail} fail, ${counts.new} new (of ${images.length}).`
    + (counts.fail ? ` Failing: ${Object.keys(failed).join(', ')}.` : '');
  /** @type {any} */ (window).ocrCheck = { counts, failed, merged: sorted };
}

run();
