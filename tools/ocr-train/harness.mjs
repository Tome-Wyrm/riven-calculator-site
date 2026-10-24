// OCR tuning harness: runs the site's screenshot reader (same Tesseract.js version, same parsing)
// in Node over a set of images with known answers, and scores it field by field.
//
//   node tools/ocr-train/harness.mjs real                         the real screenshots (expected.json)
//   node tools/ocr-train/harness.mjs tools/ocr-train/out/fuzzed   synthetic cards (each n.png + n.json)
//   ... --limit 50  --workers 4  --psm 11  --width 2400 --maxscale 4 --invert 1 --contrast 1
//   ... --show 10   (print the first 10 misses)
//
// Images are decoded by prep.py (Pillow) and preprocessed by src/ocr-prep.js, the same code the
// site runs in the browser, so a setting that helps here helps on the site.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createScheduler, createWorker } from 'tesseract.js';
import { interpretText } from '../../src/ocr-read.js';
import { prepPixels, toPGM } from '../../src/ocr-prep.js';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const opt = (/** @type {string} */ k, /** @type {any} */ d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const set = args[0] ?? 'real';
const limit = Number(opt('limit', Infinity));
const workers = Number(opt('workers', Math.max(1, Math.min(6, os.cpus().length - 1))));
const psm = String(opt('psm', '11'));
const show = Number(opt('show', 0));
/** @type {import('../../src/ocr-prep.js').PrepOptions} */
const prep = {};
if (opt('width') !== undefined) prep.width = Number(opt('width'));
if (opt('maxscale') !== undefined) prep.maxScale = Number(opt('maxscale'));
if (opt('contrast') !== undefined) prep.contrast = Number(opt('contrast'));
if (opt('invert') !== undefined) prep.invert = opt('invert') !== '0';
if (opt('cubic') !== undefined) prep.cubic = ['mitchell', 'lanczos'].includes(opt('cubic')) ? opt('cubic') : opt('cubic') !== '0';
const prepOpts = Object.entries(prep).map(([k, v]) => `${k}=${v}`);

/** @typedef {{weapon: string | null, rank: number | null, stats: string[], locked: string[]}} Answer */

/** A synthetic card's spec, as an answer in expected.json's shape. @returns {Answer} */
function specAnswer(spec) {
  return {
    weapon: spec.weapon,
    rank: spec.rank,
    stats: spec.stats.map(s => {
      const v = s.text.split(' ')[0].replace(/[%sm]$/, '');
      return `${v.startsWith('x') ? v : (v.startsWith('-') ? '' : '') + v} ${s.statId}`;
    }),
    locked: spec.stats.filter(s => s.locked).map(s => s.statId),
  };
}

/** [image path, answer] pairs for the chosen set. */
function cases() {
  if (set === 'real') {
    const dir = path.join(ROOT, 'test/fixtures/local');
    const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
    return Object.entries(expected).filter(([, a]) => !a.twoCards && !a.unverified).map(([f, a]) => [path.join(dir, f), a]);
  }
  return fs.readdirSync(set).filter(f => f.endsWith('.png')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(f => [path.join(set, f), specAnswer(JSON.parse(fs.readFileSync(path.join(set, f.replace(/\.png$/, '.json')), 'utf8')))]);
}

const norm = (/** @type {string} */ s) => s.replace(/^\+/, '');

async function main() {
  const all = cases().slice(0, limit);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-prep-'));
  execFileSync('python', [path.join(HERE, 'prep.py'), tmp, ...all.map(c => c[0])], { stdio: 'inherit' });

  const scheduler = createScheduler();
  for (let i = 0; i < workers; i++) {
    const w = await createWorker('eng');
    await w.setParameters({ tessedit_pageseg_mode: psm });
    scheduler.addWorker(w);
  }
  const t0 = Date.now();
  const results = await Promise.all(all.map(async ([file, want], n) => {
    const raw = fs.readFileSync(path.join(tmp, `${n}.rgba`));
    const [w, h] = [raw.readUInt32LE(0), raw.readUInt32LE(4)];
    const img = prepPixels(new Uint8Array(raw.buffer, raw.byteOffset + 8, w * h * 4), w, h, prep);
    const { data } = await scheduler.addJob('recognize', Buffer.from(toPGM(img)));
    const r = interpretText(data.text);
    return { file, want, got: { weapon: r.weapon?.name ?? null, rank: r.rank, stats: r.rows.map(s => `${s.value} ${s.statId}`), locked: r.rows.filter(s => s.locked).map(s => s.statId) } };
  }));
  await scheduler.terminate();
  fs.rmSync(tmp, { recursive: true, force: true });

  const score = { cards: 0, perfect: 0, weapon: 0, rank: 0, statsAll: 0, stats: 0, statsTotal: 0, locks: 0 };
  const misses = [];
  for (const { file, want, got } of results) {
    score.cards++;
    const ws = (want.stats ?? []).map(norm), gs = got.stats.map(norm);
    const okW = (want.weapon ?? null) === got.weapon, okR = want.rank === got.rank;
    const hit = ws.filter(s => gs.includes(s)).length;
    const okS = hit === ws.length && gs.length === ws.length;
    const okL = [...(want.locked ?? [])].sort().join() === [...got.locked].sort().join();
    score.weapon += +okW; score.rank += +okR; score.statsAll += +okS; score.locks += +okL;
    score.stats += hit; score.statsTotal += ws.length;
    if (okW && okR && okS && okL) score.perfect++;
    else misses.push(`${path.basename(file)}: ${[!okW && `weapon ${got.weapon} ≠ ${want.weapon}`, !okR && `rank ${got.rank} ≠ ${want.rank}`,
      !okS && `stats [${gs.join(', ')}] ≠ [${ws.join(', ')}]`, !okL && 'locks'].filter(Boolean).join('; ')}`);
  }
  const pct = (/** @type {number} */ a, /** @type {number} */ b) => `${(100 * a / b).toFixed(1)}%`;
  console.log(`${set}  psm=${psm} ${prepOpts.join(' ')}  (${score.cards} cards, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(`  all right ${pct(score.perfect, score.cards)} · weapon ${pct(score.weapon, score.cards)} · rank ${pct(score.rank, score.cards)}`
    + ` · every stat ${pct(score.statsAll, score.cards)} · stat lines ${pct(score.stats, score.statsTotal)} · locks ${pct(score.locks, score.cards)}`);
  for (const m of misses.slice(0, show)) console.log('  ' + m);
}

main().catch(e => { console.error(e); process.exit(1); });
