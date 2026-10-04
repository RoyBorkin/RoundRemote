// Frame-level features shared by the offline analyser and the LiveLearner (rhythm/analyzer.js).
// One frame every HOP samples, centred on sample f·HOP (so frame f ↔ song time f·HOP/sr), window N (Hann).
// Per frame: multi-band positive spectral flux (low < 200 Hz, mid 200–2000, high > 2000) on a log-magnitude
// spectrum (lag 2 frames, 3-bin max filter on the reference = SuperFlux-style vibrato suppression),
// band powers, log-frequency centroid, a 48-semitone harmonic salience (for sustain / chroma) and the most
// salient NEW pitch (harmonic sum on the positive-difference spectrum) for the onset's pitch.
// Per 250 ms block: power and chroma sums (energy / sections).
import { RealFFT, hann } from './dsp-fft.js';

export const N = 1024;
export const HOP = 256;
export const NB = N / 2 + 1;
export const MIDI0 = 45;        // pitch candidates A2 …
export const NSEMI = 48;        // … G#6
export const PITCH_LO = 7;      // melody pitch candidates start at E3 (bass lives below)
const SEMI_TOP = MIDI0 + NSEMI + 25; // semitone spectrum needed for 4 harmonics
const GAMMA = 300;              // log compression
export const SALQ = 16;         // quantisation of the stored salience (Uint8)
export const BLOCK_SEC = 0.25;


function grow(a, n) { const b = new a.constructor(n); b.set(a.subarray(0, Math.min(a.length, n))); return b; }

/** Feature storage, indexed by frame (song time). Grows on demand (LiveLearner). */
export class FeatureStore {
  constructor(sr, frames = 1024) {
    this.sr = sr; this.hop = HOP; this.fps = sr / HOP; this.n = 0; // n = frames in use (max index + 1)
    this.cap = 0; this.bcap = 0; this.nb = 0;
    this._alloc(Math.max(16, frames));
  }
  _alloc(cap) {
    const F = ['fluxL', 'fluxM', 'fluxH', 'eL', 'eM', 'eH', 'cent', 'pitchSal', 'pitchMean', 'power'];
    for (const k of F) this[k] = this[k] ? grow(this[k], cap) : new Float32Array(cap);
    this.pitchM = this.pitchM ? grow(this.pitchM, cap) : new Uint8Array(cap);
    this.heard = this.heard ? grow(this.heard, cap) : new Uint8Array(cap);
    this.sal = this.sal ? grow(this.sal, cap * NSEMI) : new Uint8Array(cap * NSEMI);
    this.cap = cap;
    const bc = Math.ceil((cap * HOP) / this.sr / BLOCK_SEC) + 2;
    if (bc > this.bcap) {
      this.bPow = this.bPow ? grow(this.bPow, bc) : new Float64Array(bc);
      this.bCnt = this.bCnt ? grow(this.bCnt, bc) : new Float32Array(bc);
      this.bChroma = this.bChroma ? grow(this.bChroma, bc * 12) : new Float32Array(bc * 12);
      this.bBand = this.bBand ? grow(this.bBand, bc * 3) : new Float32Array(bc * 3);
      this.bcap = bc;
    }
  }
  ensure(frames) {
    if (frames <= this.cap) return;
    let c = this.cap;
    while (c < frames) c *= 2;
    this._alloc(c);
  }
  blockOf(f) { return Math.floor((f * HOP) / this.sr / BLOCK_SEC); }
}

/** Computes one frame's features into a FeatureStore. Keeps the previous two log spectra for the flux. */
export class FrameProcessor {
  constructor(sr) {
    this.sr = sr;
    this.fft = new RealFFT(N);
    this.win = hann(N);
    this.xw = new Float64Array(N);
    this.re = new Float64Array(NB); this.im = new Float64Array(NB);
    this.P = new Float64Array(NB);           // power (normalised) of the last frame
    this.L = new Float64Array(NB);
    this.L1 = new Float64Array(NB);          // previous frame
    this.L2 = new Float64Array(NB);          // two frames ago
    this.D = new Float64Array(NB);
    this.age = 0;                            // frames since reset (flux needs 2)
    const binHz = sr / N;
    this.binHz = binHz;
    this.kLow = Math.max(2, Math.round(200 / binHz));
    this.kMid = Math.round(2000 / binHz);
    this.kTop = Math.min(NB - 1, Math.round(10500 / binHz));
    this.kCent0 = Math.max(1, Math.round(60 / binHz));
    this.kCent1 = Math.min(NB - 1, Math.round(8000 / binHz));
    this.logf = new Float64Array(NB);
    for (let k = 1; k < NB; k++) this.logf[k] = Math.log2(k * binHz);
    this.c0 = Math.log2(60); this.c1 = Math.log2(8000);
    // semitone spectrum mapping
    const ns = SEMI_TOP - MIDI0;
    this.ns = ns;
    this.sLo = new Int32Array(ns); this.sHi = new Int32Array(ns); this.sFr = new Float64Array(ns);
    for (let i = 0; i < ns; i++) {
      const m = MIDI0 + i;
      const f = 440 * 2 ** ((m - 69) / 12);
      const a = (440 * 2 ** ((m - 69.5) / 12)) / binHz, b = (440 * 2 ** ((m - 68.5) / 12)) / binHz;
      if (b - a < 1.5) { const pos = f / binHz; this.sLo[i] = Math.floor(pos); this.sHi[i] = -1; this.sFr[i] = pos - Math.floor(pos); }
      else { this.sLo[i] = Math.max(0, Math.ceil(a)); this.sHi[i] = Math.min(NB - 1, Math.floor(b)); }
    }
    this.S = new Float64Array(ns); this.WD = new Float64Array(NB + 1);
    this.hW = [1, 0.8, 0.6, 0.5, 0.4];
    this.hBin = new Float64Array(NSEMI * 5);
    for (let i = 0; i < NSEMI; i++) for (let h = 0; h < 5; h++) {
      const pos = ((h + 1) * 440 * 2 ** ((MIDI0 + i - 69) / 12)) / binHz;
      this.hBin[i * 5 + h] = pos < this.kTop - 1 ? pos : 0;
    }
    this.magScale = 2 / (N / 2);             // full-scale sine → 1
  }
  reset() { this.age = 0; }

  _semi(src, dst) {
    const { sLo, sHi, sFr, ns } = this;
    for (let i = 0; i < ns; i++) {
      const lo = sLo[i], hi = sHi[i];
      if (hi < 0) dst[i] = src[lo] * (1 - sFr[i]) + src[lo + 1] * sFr[i];
      else { let mx = 0; for (let k = lo; k <= hi; k++) if (src[k] > mx) mx = src[k]; dst[i] = mx; }
    }
  }

  /** x: N samples (already gained), f: frame index, st: FeatureStore. */
  frame(x, f, st) {
    const { xw, win, re, im, P, L, D, magScale } = this;
    for (let i = 0; i < N; i++) xw[i] = x[i] * win[i];
    this.fft.forward(xw, re, im);
    const ms2 = magScale * magScale;
    let tot = 0;
    for (let k = 0; k < NB; k++) {
      const p = (re[k] * re[k] + im[k] * im[k]) * ms2;
      P[k] = p; tot += p;
      L[k] = Math.log(1 + GAMMA * Math.sqrt(p));
    }
    const { kLow, kMid, kTop } = this;
    let fl = 0, fm = 0, fh = 0, eL = 0, eM = 0, eH = 0;
    const ready = this.age >= 2;
    const R = this.L2;
    for (let k = 1; k < kLow; k++) {
      eL += P[k];
      const d = ready ? L[k] - R[k] : 0;
      D[k] = d > 0 ? d : 0; fl += D[k];
    }
    for (let k = kLow; k <= kTop; k++) {
      const p = P[k];
      let ref = R[k];
      if (R[k - 1] > ref) ref = R[k - 1];
      if (k + 1 < NB && R[k + 1] > ref) ref = R[k + 1];
      const d = ready ? L[k] - ref : 0;
      const dd = d > 0 ? d : 0;
      D[k] = dd;
      if (k < kMid) { eM += p; fm += dd; } else { eH += p; fh += dd; }
    }
    st.fluxL[f] = fl / Math.max(1, kLow - 1);
    st.fluxM[f] = fm / (kMid - kLow);
    st.fluxH[f] = fh / (kTop - kMid + 1);
    st.eL[f] = eL; st.eM[f] = eM; st.eH[f] = eH; st.power[f] = tot;
    // centroid on a log-frequency axis
    let cs = 0, cw = 0;
    for (let k = this.kCent0; k <= this.kCent1; k++) { const mg = Math.sqrt(P[k]); cs += mg * this.logf[k]; cw += mg; }
    st.cent[f] = cw > 1e-9 ? Math.min(1, Math.max(0, (cs / cw - this.c0) / (this.c1 - this.c0))) : 0;
    // semitone spectrum (chroma) + harmonic pitch salience on the whitened log spectrum
    const S = this.S;
    this._semi(L, S);
    const WT = this.WD;
    {
      let sum = 0, lo = 1, hi = 0;
      const top = Math.min(NB - 1, this.kTop);
      for (let k = 1; k <= top; k++) {
        const a = Math.max(1, k - 10), z = Math.min(top, k + 10);
        while (hi < z) sum += L[++hi];
        while (lo < a) sum -= L[lo++];
        const v = L[k] - sum / (hi - lo + 1);
        WT[k] = v > 0 ? v : 0;
      }
    }
    const hb = this.hBin, hw = this.hW, HN = hw.length;
    let best = -1, bestV = 0, sumV = 0;
    const base = f * NSEMI, sal = st.sal;
    for (let i = 0; i < NSEMI; i++) {
      let v = 0;
      for (let h = 0; h < HN; h++) {
        const pos = hb[i * HN + h];
        if (pos <= 0) break;
        const k = pos | 0, fr = pos - k;
        v += hw[h] * (WT[k] * (1 - fr) + WT[k + 1] * fr);
      }
      const q = v * SALQ;
      sal[base + i] = q > 255 ? 255 : q;
      if (i < PITCH_LO) continue;
      sumV += v;
      if (v > bestV) { bestV = v; best = i; }
    }
    st.pitchM[f] = best >= 0 ? MIDI0 + best : 0;
    st.pitchSal[f] = bestV;
    st.pitchMean[f] = sumV / (NSEMI - PITCH_LO);
    // 250 ms blocks (a re-heard frame is not counted twice)
    if (!st.heard[f]) {
      const b = st.blockOf(f);
      st.bPow[b] += tot; st.bCnt[b] += 1;
      const cb = b * 12;
      for (let i = 0; i < NSEMI; i++) st.bChroma[cb + ((MIDI0 + i) % 12)] += S[i];
      st.bBand[b * 3] += eL; st.bBand[b * 3 + 1] += eM; st.bBand[b * 3 + 2] += eH;
    }
    st.heard[f] = 1;
    if (f + 1 > st.n) st.n = f + 1;
    // rotate spectra
    const t = this.L2; this.L2 = this.L1; this.L1 = this.L; this.L = t;
    this.age++;
  }
}

/** Integer-factor decimation for high sample rates (2× with a short half-band low-pass). */
export function decimate2(x) {
  const n = x.length >> 1, y = new Float32Array(n);
  // 11-tap half-band FIR (Hann-windowed sinc, cut-off fs/4, DC gain 1)
  const c = [[-5, 0.0121], [-3, -0.0647], [-1, 0.3024], [0, 0.5], [1, 0.3024], [3, -0.0647], [5, 0.0121]];
  const len = x.length;
  for (let i = 0; i < n; i++) {
    const j = i * 2;
    let s = 0;
    for (let q = 0; q < c.length; q++) { const k = j + c[q][0]; if (k >= 0 && k < len) s += x[k] * c[q][1]; }
    y[i] = s;
  }
  return y;
}
