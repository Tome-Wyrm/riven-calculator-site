// @ts-check
// Runs riven studies (src/study.js) off the page's thread: {key, input} in, {key, result | error} out.
// One study at a time, its searches shared out over the cores (src/search-worker.js), or run here
// where a worker can't start another (or there's only the one core).

import { study, studyWith } from './study.js';
import { runJob } from './build.js';

/** The helpers, leaving a core for the page. */
const HELPERS = Math.min(8, Math.max(0, (self.navigator?.hardwareConcurrency ?? 1) - 2));

/** @type {Worker[] | null} */
let helpers = null;

/** @returns {Worker[]} */
function startHelpers() {
  if (helpers) return helpers;
  helpers = [];
  try {
    for (let i = 0; i < HELPERS; i++) helpers.push(new Worker(new URL('./search-worker.js', import.meta.url), { type: 'module' }));
  } catch {
    for (const h of helpers) h.terminate();
    helpers = [];
  }
  return helpers;
}

/**
 * A batch of searches, each helper taking the next as it comes free. A batch of one runs here: there's
 * nothing to share, and no copying. A helper that fails leaves its search to be run here.
 * @param {import('./build.js').Searches} batch @returns {Promise<import('./build.js').Build[]>}
 */
function run(batch) {
  const { jobs, ...searches } = batch;
  const workers = jobs.length > 1 ? startHelpers() : [];
  if (!workers.length) return Promise.resolve(jobs.map(j => runJob(searches, j)));
  return new Promise((resolve, reject) => {
    /** @type {import('./build.js').Build[]} */
    const builds = new Array(jobs.length);
    let next = 0, done = 0;
    const finish = (/** @type {number} */ id, /** @type {import('./build.js').Build} */ build) => {
      builds[id] = build;
      if (++done === jobs.length) resolve(builds);
    };
    const here = (/** @type {number} */ id) => {
      try { finish(id, runJob(searches, jobs[id])); } catch (err) { reject(err); }
    };
    const give = (/** @type {Worker} */ h) => {
      if (next >= jobs.length) return;
      const id = next++;
      h.onmessage = e => { if (e.data.build) finish(id, e.data.build); else here(id); give(h); };
      h.onerror = e => {
        e.preventDefault();
        workers.splice(workers.indexOf(h), 1);
        here(id);
        // (The last helper gone: the rest run here too.)
        while (!workers.length && next < jobs.length) here(next++);
      };
      h.postMessage({ id, searches, job: jobs[id] });
    };
    [...workers].forEach(give);
  });
}

/** The study waiting its turn: only the latest asked for, as the page shows one at a time. @type {{key: string, input: any} | null} */
let waiting = null;
let busy = false;

async function next() {
  if (busy || !waiting) return;
  const { key, input } = waiting;
  waiting = null;
  busy = true;
  try {
    self.postMessage({ key, result: HELPERS ? await studyWith(input, run) : study(input) });
  } catch (err) {
    self.postMessage({ key, error: err instanceof Error ? err.message : String(err) });
  }
  busy = false;
  next();
}

self.onmessage = (/** @type {MessageEvent} */ e) => {
  // One asked for while another waits: nobody is waiting for that one any more.
  if (waiting) self.postMessage({ key: waiting.key, dropped: true });
  waiting = e.data;
  next();
};
