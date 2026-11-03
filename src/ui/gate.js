// @ts-check
// A light gate on a section (Recommended rolls, still under construction): it starts closed on every
// load, and opening it asks for a name. If the name's MD5 is on the allowlist (src/data/allowlist.js,
// hashes only) the dialog closes and the section opens; otherwise the dialog just closes. Not
// security: the page holds everything; it only keeps the section out of casual view.

import { ALLOWED } from '../data/allowlist.js';
import { md5 } from '../md5.js';
import { el } from './dom.js';

/** @param {HTMLDetailsElement} details */
export function gateSection(details) {
  details.open = false;
  let unlocked = false;
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'text', name: 'name', autocomplete: 'off', 'aria-label': 'Name' }));
  const form = el('form', { method: 'dialog' }, [
    el('p', {}, ['Recommended rolls is still being built. Who are you?']),
    input,
    el('div', { class: 'gate-buttons' }, [
      el('button', { type: 'submit', value: 'ok' }, ['Enter']),
      el('button', { type: 'submit', value: 'cancel', formnovalidate: '' }, ['Cancel']),
    ]),
  ]);
  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'gate' }, [form]));
  document.body.append(dialog);
  // Checked on submit (the dialog's close event can come late in a background tab).
  form.addEventListener('submit', e => {
    e.preventDefault();
    const ok = /** @type {HTMLButtonElement | null} */ (/** @type {SubmitEvent} */ (e).submitter)?.value !== 'cancel'
      && ALLOWED.has(md5(input.value.trim()));
    dialog.close();
    if (ok) { unlocked = true; details.open = true; }
  });
  details.querySelector('summary')?.addEventListener('click', e => {
    if (unlocked || details.open) return;
    e.preventDefault();
    input.value = '';
    dialog.showModal();
  });
}
