// Specs (for render.py) that copy every real screenshot in test/fixtures/local/expected.json, to
// compare synthetic cards with real ones side by side. The answer file has no riven name, MR or
// cycle count, so the name is rebuilt from the positives (in some order) and MR/cycles are made up.
//
//   node tools/ocr-train/from-expected.mjs > tools/ocr-train/out/expected-specs.jsonl

import fs from 'node:fs';
import { STAT_BY_ID } from '../../src/data/stats.js';
import { inferSign } from '../../src/engine.js';
import { WEAPONS } from '../../src/data/weapons.js';
import { ICONS, line, rivenName } from './specs.mjs';

const expected = JSON.parse(fs.readFileSync(new URL('../../test/fixtures/local/expected.json', import.meta.url), 'utf8'));
for (const [file, a] of Object.entries(expected)) {
  if (a.twoCards || !a.weapon || !a.stats?.length) continue;
  const w = WEAPONS.find(x => x[0] === a.weapon);
  if (!w) continue;
  const [weapon, cls, isBow] = w;
  const stats = a.stats.map(s => {
    const [v, statId] = s.split(' ');
    const stat = STAT_BY_ID[statId];
    if (!stat || !v) return null;
    const n = Number(v.replace(/^x/i, ''));
    const sign = inferSign(stat, cls, n);
    return { statId, sign, text: line(stat, cls, isBow, n), icon: ICONS.has(statId) ? statId : null, locked: (a.locked ?? []).includes(statId) };
  }).filter(Boolean);
  const named = stats.filter(s => s.sign === '+' && STAT_BY_ID[s.statId].prefix).map(s => s.statId);
  console.log(JSON.stringify({
    file, weapon, cls, rank: a.rank ?? 8,
    title: `${weapon.replace(/\s*\((Zaw|Kitgun)\)$/, '')} ${named.length ? rivenName(named.slice(0, 3)) : 'Visitio'}`,
    drain: 10 + (a.rank ?? 8), mr: 16, cycles: 0, stats,
  }));
}
