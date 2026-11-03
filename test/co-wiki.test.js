import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWikiCo, crossCheckCo } from '../tools/lib/co-wiki.mjs';

// A cut-down copy of the page's wikitext: one gun table, one melee table (skipped).
const PAGE = `==Attack Catalog==
===Primaries===
{| class="wikitable sortable"
|-
!Weapon!!Attack Name!!Projectile Type!!Attack Unmodded Damage!!Actual CO Damage Bonus at +100%!!CO Damage Bonus Relative To Base Damage!!Math/Behavior Type!!Notes
|-
|{{Weapon|Coda Bassocyst}}||Normal Attack||Projectile||808||808||100%||Multiplying
|-
|{{Weapon|Cernos}}||Charged Attack||Projectile||380||190||50%||Adding||CO-bonus only applies to base (uncharged) damage
|-
|{{Weapon|Burston}}/{{Weapon|Burston Prime}}||Incarnon Form Radial Attack||AoE||55||13||24%||Adding||Listed values for Burston Prime.
|-
|{{Weapon|Catchmoon (Primary)}} (Tremor)||Normal Attack||Projectile||216||216||100%||Multiplying
|}
===Melees===
{| class="wikitable sortable"
|-
|{{Weapon|Syam}}||Heavy Attack Wave 1||500||500||100%||Multiplying||
|}
`;

test("the wiki's CO catalogue: gun rows, one per weapon named, melee left out", () => {
  const file = join(mkdtempSync(join(tmpdir(), 'co-wiki-')), 'ConditionOverload.wiki');
  writeFileSync(file, PAGE);
  const rows = /** @type {import('../tools/lib/co-wiki.mjs').WikiCo[]} */ (readWikiCo(file));
  assert.deepEqual(rows.map(r => r.weapon), ['Coda Bassocyst', 'Cernos', 'Burston', 'Burston Prime', 'Catchmoon (Primary)']);
  assert.deepEqual([rows[0].share, rows[0].mult], [1, true]);
  assert.deepEqual([rows[1].share, rows[1].mult, rows[1].note], [0.5, false, 'CO-bonus only applies to base (uncharged) damage']);
  assert.equal(readWikiCo(join(tmpdir(), 'no-such-page.wiki')), null);

  const coData = [
    { weapon_name: 'Coda Bassocyst', fire_mode_name: 'Normal Attack', co_factor: '100%', effect: 'Multiplies' },
    { weapon_name: 'Cernos', fire_mode_name: 'Charged Shot', co_factor: '50%', effect: 'Adds' },
    { weapon_name: 'Burston Prime', fire_mode_name: 'Incarnon Form Radial Attack', co_factor: '100%', effect: 'Adds' },
  ];
  // Names that differ ("Charged Attack" vs "Charged Shot") match on any attack with the same share.
  const { agree, differ } = crossCheckCo(rows, coData, new Set(['Coda Bassocyst', 'Cernos', 'Burston Prime']));
  assert.equal(agree, 2);
  assert.deepEqual(differ, ['Burston Prime, Incarnon Form Radial Attack: wiki 24% adding; Underframe Incarnon Form Radial Attack 100% adding']);
});
