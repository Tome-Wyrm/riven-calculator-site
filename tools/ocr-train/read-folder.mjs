// Runs the site's screenshot reader over images with no known answers, and writes what it read:
// for sorting a pile of shared screenshots into riven cards and drafting their answers.
//
//   node tools/ocr-train/read-folder.mjs <list.txt | folder> <out.json>  [--workers 4]
//
// out.json: one entry per image: {file, weapon, rank, stats: ["+97.4 fireRate", ...], locked, text}.
// Same preprocessing (prep.py + src/ocr-prep.js) and parsing (src/ocr-read.js) as the harness.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createScheduler, createWorker } from 'tesseract.js';
import { interpretText } from '../../src/ocr-read.js';
import { prepPixels, toPGM } from '../../src/ocr-prep.js';

const HERE = import.meta.dirname;
const [src, out] = process.argv.slice(2);
const wi = process.argv.indexOf('--workers');
const workers = wi > 0 ? Number(process.argv[wi + 1]) : Math.max(1, Math.min(6, os.cpus().length - 1));
if (!src || !out) { console.error('usage: read-folder.mjs <list.txt | folder> <out.json>'); process.exit(1); }

const files = fs.statSync(src).isDirectory()
  ? fs.readdirSync(src).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).map(f => path.join(src, f))
  : fs.readFileSync(src, 'utf8').split(/\r?\n/).filter(Boolean);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-read-'));
// In batches: prep.py takes its file list on the command line.
for (let i = 0; i < files.length; i += 100) {
  execFileSync('python', [path.join(HERE, 'prep.py'), tmp, ...files.slice(i, i + 100), '--start', String(i)], { stdio: 'inherit' });
}

const scheduler = createScheduler();
for (let i = 0; i < workers; i++) {
  const w = await createWorker('eng');
  await w.setParameters({ tessedit_pageseg_mode: '11' });
  scheduler.addWorker(w);
}
let done = 0;
const results = await Promise.all(files.map(async (file, n) => {
  const p = path.join(tmp, `${n}.rgba`);
  if (!fs.existsSync(p)) return { file, error: 'unreadable' };
  const raw = fs.readFileSync(p);
  const [w, h] = [raw.readUInt32LE(0), raw.readUInt32LE(4)];
  const img = prepPixels(new Uint8Array(raw.buffer, raw.byteOffset + 8, w * h * 4), w, h, {});
  const { data } = await scheduler.addJob('recognize', Buffer.from(toPGM(img)));
  const r = interpretText(data.text);
  if (++done % 50 === 0) console.log(`${done} / ${files.length}`);
  return {
    file, weapon: r.weapon?.name ?? null, rank: r.rank,
    stats: r.rows.map(s => `${s.value} ${s.statId}`), locked: r.rows.filter(s => s.locked).map(s => s.statId), text: data.text,
  };
}));
await scheduler.terminate();
fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(out, JSON.stringify(results, null, 1));
const read = results.filter(r => r.stats && r.stats.length >= 2);
console.log(`${files.length} images: ${read.length} read as rivens (2+ stats), ${read.filter(r => r.weapon).length} with a weapon name.`);
