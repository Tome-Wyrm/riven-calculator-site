import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { md5 } from '../src/md5.js';
import { ALLOWED } from '../src/data/allowlist.js';

test('MD5: the RFC 1321 test suite, and Node for long and non-ASCII text', () => {
  assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5('a'), '0cc175b9c0f1b6a831c399e269772661');
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
  assert.equal(md5('abcdefghijklmnopqrstuvwxyz'), 'c3fcd3d76192e4007dfb496cca67e13b');
  assert.equal(md5('1234567890'.repeat(8)), '57edf4a22be3c955ac49da2e2107b67a');
  for (const s of ['x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'Riven ✓ ü'])
    assert.equal(md5(s), createHash('md5').update(s, 'utf8').digest('hex'), `${s.length} chars`);
});

test('the allowlist holds hashes only', () => {
  assert.ok(ALLOWED.size > 0);
  for (const h of ALLOWED) assert.match(h, /^[0-9a-f]{32}$/);
  assert.ok(ALLOWED.has('485c264d44820de10d8cfa64441c143e'));   // a listed name's hash (names stay local)
  assert.ok(!ALLOWED.has(md5('nobody')));
});
