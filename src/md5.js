// @ts-check
// MD5 of a string (UTF-8), as lower-case hex: the browser has no MD5 of its own (crypto.subtle
// leaves it out). RFC 1321; checked against its test suite (test/md5.test.js).

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** @param {string} text */
export function md5(text) {
  const bytes = new TextEncoder().encode(text);
  const n = (((bytes.length + 8) >> 6) + 1) * 64;          // padded to a whole number of 64-byte blocks
  const buf = new Uint8Array(n);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(n - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(n - 4, Math.floor(bytes.length / 2 ** 29), true);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let off = 0; off < n; off += 64) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      const r = i >> 4;
      const f = r === 0 ? (b & c) | (~b & d) : r === 1 ? (d & b) | (~d & c) : r === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = r === 0 ? i : r === 1 ? (5 * i + 1) & 15 : r === 2 ? (3 * i + 5) & 15 : (7 * i) & 15;
      const s = S[r * 4 + (i & 3)];
      const x = (a + f + K[i] + view.getUint32(off + 4 * g, true)) | 0;
      [a, d, c] = [d, c, b];
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((w, i) => out.setUint32(4 * i, w, true));
  return [...new Uint8Array(out.buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
}
