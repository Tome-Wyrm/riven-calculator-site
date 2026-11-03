// @ts-check
// Runs riven studies (src/study.js) off the page's thread: {key, input} in, {key, result | error} out.

import { study } from './study.js';

self.onmessage = (/** @type {MessageEvent} */ e) => {
  const { key, input } = e.data;
  try {
    self.postMessage({ key, result: study(input) });
  } catch (err) {
    self.postMessage({ key, error: err instanceof Error ? err.message : String(err) });
  }
};
