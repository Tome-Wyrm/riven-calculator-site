// Downloads test-data submissions from the site's Discord channel (posted by the "Help improve
// the reader?" card, src/ui/share.js) into test/fixtures/local/.
//
//   node tools/fetch-submissions.mjs            fetch new submissions
//   node tools/fetch-submissions.mjs --dry-run  list them without saving anything
//   node tools/fetch-submissions.mjs --backfill-edited  mark older answers edited or untouched
//
// Needs a .env file in the repo root (git-ignored; the token must stay private):
//   DISCORD_BOT_TOKEN=...      a bot with Message Content Intent, View Channel, Read Message History
//   DISCORD_CHANNEL_ID=...     the submissions channel
//
// Screenshot submissions: the image is saved as the next free xNN number, and the corrected
// values (what the grader showed when it was sent) go into expected.json as a draft answer,
// marked "unverified" until someone checks it against the image, and "edited" when the sender
// changed anything the reader got (false: it's only the reader's own draft, unchecked by anyone). Inventory imports are saved to
// test/fixtures/local/imports/ for the odds tally. The last message read is remembered in
// test/fixtures/local/submissions-state.json, so each run only fetches what's new.

import fs from 'node:fs';
import path from 'node:path';
import { STAT_BY_ID } from '../src/data/stats.js';
import { inferSign } from '../src/engine.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'test/fixtures/local');
const EXPECTED = path.join(DIR, 'expected.json');
const STATE = path.join(DIR, 'submissions-state.json');
const IMPORTS = path.join(DIR, 'imports');
const API = 'https://discord.com/api/v10';
const dryRun = process.argv.includes('--dry-run');
const backfill = process.argv.includes('--backfill-edited');

try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env: checked below */ }
const { DISCORD_BOT_TOKEN: TOKEN, DISCORD_CHANNEL_ID: CHANNEL } = process.env;

/** GET from Discord's API, waiting out rate limits. @param {string} url */
async function api(url) {
  for (;;) {
    const res = await fetch(API + url, { headers: { Authorization: `Bot ${TOKEN}`, 'User-Agent': 'riven-calculator-site (submissions fetcher)' } });
    if (res.status === 429) {
      const wait = Number((await res.json()).retry_after ?? 1);
      await new Promise(r => setTimeout(r, wait * 1000 + 100));
      continue;
    }
    if (!res.ok) throw new Error(`Discord ${res.status} on ${url}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
}

/** Every message after `after`, oldest first. @param {string | null} after */
async function newMessages(after) {
  const all = [];
  let cursor = after ?? '0';
  for (;;) {
    const page = await api(`/channels/${CHANNEL}/messages?limit=100&after=${cursor}`);
    if (!page.length) break;
    page.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    all.push(...page);
    cursor = page[page.length - 1].id;
    if (page.length < 100) break;
  }
  return all;
}

/** A value as the grader shows it ("+267.2", "x0.58"), with a sign. @param {string} v @param {string} statId @param {string} cls */
export function normalise(v, statId, cls) {
  const t = String(v).trim().replace(/,/g, '.');
  if (/^[x×]/i.test(t)) return `x${Number(t.replace(/^[x×]\s*/i, '').replace(/[^\d.]/g, ''))}`;
  const n = Number((t.match(/[+-]?\d+(?:\.\d+)?/) ?? [''])[0]);
  if (!t || !Number.isFinite(n)) return '';
  if (/^[+-]/.test(t)) return `${n < 0 ? '-' : '+'}${Math.abs(n)}`;
  // No sign typed: the grader decides it from the value (inferSign).
  const stat = STAT_BY_ID[statId];
  return `${stat && inferSign(stat, cls, n) === '-' ? '-' : '+'}${Math.abs(n)}`;
}

/**
 * Whether the sender changed the reader's draft before sending: the weapon, the rank, or any
 * stat, value or lock. Null when the submission doesn't carry both.
 * @param {any} data
 */
export function wasEdited(data) {
  const read = data.read, c = data.corrected;
  if (!read || !c) return null;
  const rows = (/** @type {any[]} */ rs) => JSON.stringify((rs ?? []).filter(r => r.statId)
    .map(r => [r.statId, normalise(r.value, r.statId, c.cls), !!r.locked]));
  // The grader starts at rank 8 when the reader found none.
  return (c.weapon || null) !== (read.weapon || null) || (c.rank ?? null) !== (read.rank ?? 8) || rows(c.rows) !== rows(read.rows);
}

/** The draft answer for a screenshot submission. @param {any} data @param {string} messageId */
export function draftAnswer(data, messageId) {
  const edited = wasEdited(data);
  const note = { unverified: true, ...(edited === null ? {} : { edited }), source: `discord:${messageId}` };
  if (data.read?.twoCards) return { twoCards: true, ...note };
  const c = data.corrected ?? {};
  const rows = (c.rows ?? []).filter(r => r.statId);
  return {
    weapon: c.weapon || data.read?.weapon || null,
    rank: c.rank ?? data.read?.rank ?? null,
    stats: rows.map(r => `${normalise(r.value, r.statId, c.cls)} ${r.statId}`),
    locked: rows.filter(r => r.locked).map(r => r.statId),
    ...note,
  };
}

const natural = (/** @type {string} */ a, /** @type {string} */ b) => a.localeCompare(b, undefined, { numeric: true });

/** @param {Record<string, any>} expected */
function writeExpected(expected) {
  const sorted = Object.fromEntries(Object.keys(expected).sort(natural).map(k => [k, expected[k]]));
  fs.writeFileSync(EXPECTED, `{\n${Object.entries(sorted).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`);
}

/** Marks answers fetched before "edited" existed, from their messages' data.json. @param {Record<string, any>} expected */
async function backfillEdited(expected) {
  let n = 0;
  for (const [file, a] of Object.entries(expected)) {
    const id = /^discord:(\d+)$/.exec(a.source ?? '')?.[1];
    if (!id || 'edited' in a) continue;
    const m = await api(`/channels/${CHANNEL}/messages/${id}`).catch(() => null);
    const dataFile = m?.attachments?.find((/** @type {any} */ x) => x.filename === 'data.json');
    if (!dataFile) continue;
    const edited = wasEdited(await (await fetch(dataFile.url)).json());
    if (edited === null) continue;
    a.edited = edited;
    n++;
    console.log(`${file.padEnd(9)} ${edited ? 'edited' : 'untouched'}`);
  }
  if (!dryRun) writeExpected(expected);
  console.log(`${n} answer(s) marked.${dryRun ? ' (dry run: nothing saved)' : ''}`);
}

async function main() {
  if (!TOKEN || !CHANNEL) throw new Error('Missing DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID (put them in .env in the repo root).');
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { lastId: null };
  const expected = fs.existsSync(EXPECTED) ? JSON.parse(fs.readFileSync(EXPECTED, 'utf8')) : {};
  let next = Math.max(0, ...fs.readdirSync(DIR).map(f => Number(f.match(/^x(\d+)\./)?.[1] ?? 0))) + 1;

  if (backfill) return backfillEdited(expected);
  const messages = await newMessages(state.lastId);
  console.log(`${messages.length} new message(s) in the channel.`);
  let shots = 0, imports = 0, skipped = 0;

  for (const m of messages) {
    const dataFile = m.attachments?.find((/** @type {any} */ a) => a.filename === 'data.json');
    if (!dataFile) { skipped++; continue; }                     // chat, or not from the site
    const data = await (await fetch(dataFile.url)).json();
    const image = m.attachments.find((/** @type {any} */ a) => /^screenshot\./.test(a.filename));

    if (Array.isArray(data.rivens)) {
      imports++;
      console.log(`import  ${m.id}: ${data.rivens.length} riven(s)`);
      if (!dryRun) {
        fs.mkdirSync(IMPORTS, { recursive: true });
        fs.writeFileSync(path.join(IMPORTS, `${m.id}.json`), JSON.stringify(data, null, 1));
      }
    } else if (image) {
      shots++;
      const ext = path.extname(image.filename) || '.png';
      const name = `x${next++}${ext}`;
      const answer = draftAnswer(data, m.id);
      console.log(`${name.padEnd(9)} ${answer.twoCards ? 'two cards' : `${answer.weapon ?? '(no weapon)'} r${answer.rank}: ${answer.stats.join(', ')}`}${answer.edited ? '  (edited)' : ''}`);
      if (!dryRun) {
        fs.writeFileSync(path.join(DIR, name), Buffer.from(await (await fetch(image.url)).arrayBuffer()));
        expected[name] = answer;
      }
    } else {
      skipped++;
    }
    if (!dryRun) state.lastId = m.id;
  }

  if (!dryRun) {
    writeExpected(expected);
    fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  }
  console.log(`${shots} screenshot(s), ${imports} import(s), ${skipped} other message(s) skipped.${dryRun ? ' (dry run: nothing saved)' : ''}`);
  if (shots && !dryRun) console.log('Check the new answers (marked "unverified") against the images, then run tools/ocr-check.html.');
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
