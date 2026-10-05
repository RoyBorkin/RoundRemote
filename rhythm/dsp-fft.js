// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Radix-2 FFT for real input (size n = power of two), computed as an n/2-point complex FFT plus the
// usual split step. Tables are built once per size; forward() allocates nothing.
// Used by the rhythm analyser (rhythm/analyzer.js). Plain ES module, runs in Workers and Node.
export class RealFFT {
  constructor(n) {
    if (n < 4 || (n & (n - 1))) throw new Error('RealFFT size must be a power of two ≥ 4');
    const m = n >> 1;
    this.n = n; this.m = m;
    this.re = new Float64Array(m); this.im = new Float64Array(m);
    const bits = Math.round(Math.log2(m));
    this.rev = new Uint32Array(m);
    for (let i = 0; i < m; i++) {
      let r = 0;
      for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
      this.rev[i] = r;
    }
    this.cosT = new Float64Array(m >> 1); this.sinT = new Float64Array(m >> 1);
    for (let k = 0; k < m >> 1; k++) { this.cosT[k] = Math.cos((2 * Math.PI * k) / m); this.sinT[k] = Math.sin((2 * Math.PI * k) / m); }
    this.cosR = new Float64Array(m + 1); this.sinR = new Float64Array(m + 1);
    for (let k = 0; k <= m; k++) { this.cosR[k] = Math.cos((2 * Math.PI * k) / n); this.sinR[k] = Math.sin((2 * Math.PI * k) / n); }
  }

  /** x: real array of length n. Writes bins 0..n/2 into outRe/outIm (length ≥ n/2 + 1). */
  forward(x, outRe, outIm) {
    const { m, re, im, rev, cosT, sinT } = this;
    for (let k = 0; k < m; k++) { const j = rev[k]; re[j] = x[2 * k]; im[j] = x[2 * k + 1]; }
    for (let size = 2; size <= m; size <<= 1) {
      const half = size >> 1, step = m / size;
      for (let i = 0; i < m; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const wr = cosT[k], wi = -sinT[k];
          const br = re[b], bi = im[b];
          const tr = wr * br - wi * bi, ti = wr * bi + wi * br;
          const ar = re[a], ai = im[a];
          re[b] = ar - tr; im[b] = ai - ti;
          re[a] = ar + tr; im[a] = ai + ti;
        }
      }
    }
    const { cosR, sinR } = this;
    for (let k = 0; k <= m; k++) {
      const k1 = k === m ? 0 : k, k2 = k === 0 ? 0 : m - k;
      const zr = re[k1], zi = im[k1], yr = re[k2], yi = im[k2];
      const er = (zr + yr) * 0.5, ei = (zi - yi) * 0.5;
      const or = (zi + yi) * 0.5, oi = -(zr - yr) * 0.5;
      const c = cosR[k], s = sinR[k];
      outRe[k] = er + c * or + s * oi;
      outIm[k] = ei + c * oi - s * or;
    }
  }
}

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
