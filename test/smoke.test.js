import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('index.html loads every local module and stylesheet it references', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]);
  assert.ok(refs.includes('src/main.js'), 'entry module is referenced');
  for (const ref of refs) {
    await access(new URL(ref, root));
  }
});
