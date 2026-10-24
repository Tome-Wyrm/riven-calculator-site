// @ts-check
// "Send this as test data?" A small card in the corner, shown after a screenshot read or an
// inventory import. Sending is anonymous: it posts to a Discord channel through a webhook (no
// account needed). Or people copy the data and share it wherever they like.
//
// The webhook URL is public (it's in this file). Anyone could post to that one channel with it;
// if that's abused, delete the webhook in Discord, make a new one, and replace WEBHOOK below.

import { el } from './dom.js';

const WEBHOOK = 'https://discord.com/api/webhooks/1563434905793466441/8qA_SLQwXGu9_46h_QFautTeDf5b2RD2-Ehm9rok37emxn9Cst3C1Y5OLKGR9XTcy-dN';
const ISSUES_URL = 'https://github.com/Tome-Wyrm/riven-calculator-site/issues/new';
const COOLDOWN_MS = 30_000;
const MAX_IMAGE = 8 * 1024 * 1024;        // Discord's limit for webhook files without boosts
const OPT_OUT = 'share-opt-out';

/**
 * @typedef {object} Offer
 * @property {'screenshot' | 'import'} kind
 * @property {string} summary     one line for the Discord message, e.g. "Soma, rank 8: +267.2% Damage, …"
 * @property {() => object} data  the test data, built when it's sent (so later corrections are included)
 * @property {Blob} [image]       the screenshot
 */

let lastSent = 0;
/** @type {Set<string>} */
const sent = new Set();
/** @type {HTMLElement | null} */
let card = null;

const optedOut = () => { try { return localStorage.getItem(OPT_OUT) === '1'; } catch { return false; } };

/** The data as text, for copying. @param {Offer} offer */
const asText = offer => `Riven test data (${offer.kind})\n${offer.summary}\n\`\`\`json\n${JSON.stringify(offer.data(), null, 1)}\n\`\`\``;

/** @param {Offer} offer @returns {Promise<void>} */
async function send(offer) {
  const form = new FormData();
  const data = offer.data();
  form.append('payload_json', JSON.stringify({
    content: `**${offer.kind === 'screenshot' ? 'Screenshot' : 'Inventory import'}**: ${offer.summary}`.slice(0, 1900),
    allowed_mentions: { parse: [] },
  }));
  form.append('files[0]', new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), 'data.json');
  if (offer.image && offer.image.size <= MAX_IMAGE) {
    const ext = (offer.image.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    form.append('files[1]', offer.image, `screenshot.${ext}`);
  }
  const res = await fetch(WEBHOOK, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Discord said ${res.status}`);
}

/** Shows the card for this riven or import (replacing any earlier one). @param {Offer} offer */
export function offerShare(offer) {
  if (optedOut()) return;
  card?.remove();
  const key = offer.summary;
  const status = el('p', { class: 'sub', 'aria-live': 'polite' }, [
    'Sends the stats', offer.image ? ' and the screenshot' : '', offer.kind === 'import' ? ' of the rivens it read (not your inventory file)' : '',
    ' to the site’s Discord. No account needed.']);

  const sendBtn = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: 'primary' }, ['Send anonymously']));
  sendBtn.addEventListener('click', async () => {
    if (sent.has(key)) { status.textContent = 'Already sent. Thank you!'; return; }
    const wait = lastSent + COOLDOWN_MS - Date.now();
    if (wait > 0) { status.textContent = `Please wait ${Math.ceil(wait / 1000)} s before sending another.`; return; }
    sendBtn.disabled = true;
    status.textContent = 'Sending…';
    try {
      await send(offer);
      sent.add(key);
      lastSent = Date.now();
      status.textContent = 'Sent. Thank you!';
      setTimeout(() => card?.remove(), 2500);
    } catch (e) {
      sendBtn.disabled = false;
      status.textContent = `Couldn’t send (${e instanceof Error ? e.message : e}). Copying the data and posting it yourself works too.`;
    }
  });

  const copyBtn = el('button', { type: 'button', class: 'copy-link' }, ['Copy data']);
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(asText(offer));
      status.textContent = 'Copied. Paste it (with the screenshot, if you have one) anywhere: Discord, a GitHub issue, a message…';
    } catch {
      status.textContent = 'Couldn’t copy: your browser blocked the clipboard.';
    }
  });

  const close = el('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close' }, ['×']);
  close.addEventListener('click', () => card?.remove());
  const never = el('button', { type: 'button', class: 'link-button' }, ['Don’t ask again']);
  never.addEventListener('click', () => { try { localStorage.setItem(OPT_OUT, '1'); } catch { /* ignore */ } card?.remove(); });

  card = el('aside', { class: 'share-card', 'aria-label': 'Send as test data' }, [
    el('div', { class: 'share-head' }, [el('strong', {}, ['Help improve the reader?']), close]),
    el('p', {}, [offer.kind === 'screenshot'
      ? 'Send this screenshot and what was read as test data. Correct anything wrong in the grader first, and the fixes go too.'
      : 'Send these rivens as test data. Their exact rolls help check the odds the planner uses.']),
    el('div', { class: 'share-actions' }, [sendBtn, copyBtn]),
    status,
    el('p', { class: 'sub' }, [
      el('a', { href: ISSUES_URL, target: '_blank', rel: 'noopener' }, ['Or open a GitHub issue']), ' · ', never]),
  ]);
  document.body.append(card);
}
