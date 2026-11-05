// @ts-check
// Runs one search of a study (src/worker.js hands them out): {id, searches, job} in, {id, build | error} out.

import { runJob } from './build.js';

self.onmessage = (/** @type {MessageEvent} */ e) => {
  const { id, searches, job } = e.data;
  try {
    self.postMessage({ id, build: runJob(searches, job) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
