// Puts the Discord webhook from .env (DISCORD_WEBHOOK_URL) into src/ui/share.js, written backwards so
// bots searching GitHub for webhook URLs don't match it. Checks that it works first, and never prints it.
//
//   node tools/hide-webhook.mjs

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'src/ui/share.js');

try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env: checked below */ }
const url = process.env.DISCORD_WEBHOOK_URL ?? '';
const found = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/(\d+\/[\w-]+)$/.exec(url.trim());
if (!found) throw new Error('DISCORD_WEBHOOK_URL in .env is missing or isn\'t a webhook URL.');

const res = await fetch(url.trim());
if (!res.ok) throw new Error(`Discord said ${res.status} for that webhook.`);
const { name, channel_id: channel } = await res.json();

const text = fs.readFileSync(FILE, 'utf8');
const next = text.replace(/const HOOK = '[^']*';/, `const HOOK = '${[...found[1]].reverse().join('')}';`);
if (!/const HOOK = '/.test(text)) throw new Error('No HOOK line in share.js.');
fs.writeFileSync(FILE, next);
console.log(next === text ? `Already in place: "${name}", channel ${channel}.` : `Installed "${name}", channel ${channel}.`);
