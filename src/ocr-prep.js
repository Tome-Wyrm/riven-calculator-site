// @ts-check
// Screenshot preprocessing for text recognition, in plain JavaScript, for the tuning harness and
// training (tools/ocr-train), in Node. With the Mitchell filter and colour profiles applied it matches
// the browser's own pipeline when run there (same 18 misses on the real set), but the site keeps the
// browser canvas, which reads a few more screenshots right (see src/ocr-read.js prepare).
//
// Riven text is pale lavender on a dark purple card: greyscale, optional contrast, scale up
// (bilinear), and invert to dark text on light. A hard black/white threshold was tried and lost
// decimal points; Tesseract's own binarisation does better on the inverted greyscale.

/** @typedef {{width?: number, maxScale?: number, contrast?: number, invert?: boolean, cubic?: boolean | 'mitchell' | 'lanczos'}} PrepOptions */

export const PREP_DEFAULTS = /** @type {Required<PrepOptions>} */ ({ width: 2400, maxScale: 4, contrast: 1, invert: true, cubic: 'mitchell' });

/**
 * @param {Uint8ClampedArray | Uint8Array} rgba  pixels, 4 bytes each
 * @param {number} w @param {number} h
 * @param {PrepOptions} [options]
 * @returns {{grey: Uint8ClampedArray, width: number, height: number}}
 */
export function prepPixels(rgba, w, h, options = {}) {
  const o = { ...PREP_DEFAULTS, ...options };
  // Greyscale at the original size.
  const g = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    sum += g[i];
  }
  if (o.contrast !== 1) {
    const mean = sum / g.length;
    for (let i = 0; i < g.length; i++) g[i] = mean + (g[i] - mean) * o.contrast;
  }
  // Scale up (never down), sampling pixel centres, in two separable passes (rows, then columns).
  const scale = Math.max(1, Math.min(o.maxScale, o.width / w));
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const [k, R] = KERNELS[o.cubic === true ? 'keys' : o.cubic || 'bilinear'];
  /** Weights for each output position: [first source index, weights]. @param {number} n @param {number} N */
  const taps = (n, N) => Array.from({ length: N }, (_, x) => {
    const s = (x + 0.5) / scale - 0.5, x0 = Math.floor(s) + 1 - R;
    const wts = Array.from({ length: 2 * R }, (_, i) => k(x0 + i - s));
    const sum = wts.reduce((a, b) => a + b, 0);
    return { x0, wts: wts.map(v => v / sum) };
  });
  const tx = taps(w, W), ty = taps(h, H);
  const clampI = (/** @type {number} */ i, /** @type {number} */ n) => (i < 0 ? 0 : i >= n ? n - 1 : i);
  const mid = new Float32Array(W * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < W; x++) {
      const { x0, wts } = tx[x];
      let v = 0;
      for (let i = 0; i < wts.length; i++) v += wts[i] * g[y * w + clampI(x0 + i, w)];
      mid[y * W + x] = v;
    }
  }
  const out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    const { x0: y0, wts } = ty[y];
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = 0; i < wts.length; i++) v += wts[i] * mid[clampI(y0 + i, h) * W + x];
      out[y * W + x] = o.invert ? 255 - v : v;
    }
  }
  return { grey: out, width: W, height: H };
}

const sinc = (/** @type {number} */ t) => (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t));
/** Resampling kernels: [function, radius]. */
const KERNELS = /** @type {Record<string, [(t: number) => number, number]>} */ ({
  bilinear: [t => Math.max(0, 1 - Math.abs(t)), 1],
  // Keys cubic (a = -0.5): sharper than bilinear.
  keys: [t => { t = Math.abs(t); return t <= 1 ? 1.5 * t ** 3 - 2.5 * t ** 2 + 1 : t < 2 ? -0.5 * t ** 3 + 2.5 * t ** 2 - 4 * t + 2 : 0; }, 2],
  // Mitchell-Netravali (B = C = 1/3): smoother, common in browsers.
  mitchell: [t => { t = Math.abs(t); return (t < 1 ? 7 * t ** 3 - 12 * t ** 2 + 16 / 3 : t < 2 ? -7 / 3 * t ** 3 + 12 * t ** 2 - 20 * t + 32 / 3 : 0) / 6; }, 2],
  lanczos: [t => (Math.abs(t) < 3 ? sinc(t) * sinc(t / 3) : 0), 3],
});

/** A greyscale image as a binary PGM file (Tesseract reads these directly). @param {{grey: Uint8ClampedArray, width: number, height: number}} img */
export function toPGM(img) {
  const head = new TextEncoder().encode(`P5\n${img.width} ${img.height}\n255\n`);
  const file = new Uint8Array(head.length + img.grey.length);
  file.set(head, 0);
  file.set(img.grey, head.length);
  return file;
}
