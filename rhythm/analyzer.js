// Rhythm analyser: PCM → Analysis (see RHYTHM_GUIDE.md "Analysis").
//   analyzePCM(samples, sampleRate, { key, source, onProgress })   synchronous, chunked internally
//   analyzePCMAsync(...)                                            same, yields to the event loop (UI stays alive)
//   analyzeInWorker(...)                                            module Worker (transfers samples.buffer!), falls back
//   tempoAnalysis({ key, bpm, firstBeatMs, durMs, seed })           synthetic Analysis from a beat grid (source 'tempo')
//   LiveLearner                                                     real-time version (mic / bridge PCM chunks)
//   decodeToMono(arrayBuffer, sampleRate)                           OfflineAudioContext decode + downmix + resample
// No DOM here except decodeToMono; runs in Workers and Node.
import { FeatureStore, FrameProcessor, N, HOP, decimate2 } from './dsp-features.js';
import { postProcess, estimateTempo } from './dsp-post.js';

export const ANALYSIS_VERSION = 1;
const TARGET_RMS = 0.1;
const DEFAULT_QUALITY = { file: 0.9, synth: 0.92, bridge: 0.85, mic: 0.7, tempo: 0.2 };

function rmsOf(x) {
  const step = x.length > 2e6 ? 4 : 1;
  let s = 0, c = 0;
  for (let i = 0; i < x.length; i += step) { s += x[i] * x[i]; c++; }
  return Math.sqrt(s / Math.max(1, c));
}

/** Brings any rate down to ≤ 32 kHz by halving (the feature extractor adapts to the remaining rate). */
function prepare(samples, sampleRate) {
  let x = samples, sr = sampleRate;
  while (sr > 32000) { x = decimate2(x); sr /= 2; }
  return { x, sr };
}

function* analyzeGen(samples, sampleRate, { key = '', source = 'file', durMs } = {}) {
  if (!samples || !samples.length) throw new Error('analyzePCM: no samples');
  const { x, sr } = prepare(samples, sampleRate);
  const len = x.length;
  const rms = rmsOf(x);
  const gain = Math.min(1000, TARGET_RMS / Math.max(rms, 1e-5));
  const frames = Math.floor(len / HOP) + 1;
  const st = new FeatureStore(sr, frames + 2);
  const proc = new FrameProcessor(sr);
  const win = new Float64Array(N);
  const half = N / 2;
  for (let f = 0; f < frames; f++) {
    const c = f * HOP, a = c - half;
    if (a >= 0 && a + N <= len) for (let i = 0; i < N; i++) win[i] = x[a + i] * gain;
    else for (let i = 0; i < N; i++) { const k = a + i; win[i] = k >= 0 && k < len ? x[k] * gain : 0; }
    proc.frame(win, f, st);
    if ((f & 255) === 255) yield 0.85 * (f / frames);
  }
  yield 0.85;
  const dur = durMs || Math.round((len / sr) * 1000);
  const res = postProcess(st, { key, source, durMs: dur, quality: DEFAULT_QUALITY[source] ?? 0.9 });
  return res;
}

/** Offline analysis (synchronous). samples: mono Float32Array. */
export function analyzePCM(samples, sampleRate, opts = {}) {
  const g = analyzeGen(samples, sampleRate, opts);
  for (;;) {
    const r = g.next();
    if (r.done) { opts.onProgress?.(1); return r.value; }
    opts.onProgress?.(r.value);
  }
}

/** Same as analyzePCM but yields to the event loop every ~25 ms (main-thread fallback). */
export async function analyzePCMAsync(samples, sampleRate, opts = {}) {
  const g = analyzeGen(samples, sampleRate, opts);
  let t = Date.now();
  for (;;) {
    const r = g.next();
    if (r.done) { opts.onProgress?.(1); return r.value; }
    opts.onProgress?.(r.value);
    if (Date.now() - t > 25) { await new Promise((res) => setTimeout(res, 0)); t = Date.now(); }
  }
}

/**
 * Analyse in a module Worker. NOTE: samples.buffer is TRANSFERRED to the worker (the caller's array becomes
 * detached) once the worker is up; if the worker cannot start, the analysis runs on the main thread instead.
 */
export function analyzeInWorker(samples, sampleRate, opts = {}) {
  const { key = '', source = 'file', onProgress } = opts;
  return new Promise((resolve, reject) => {
    let w = null, started = false, finished = false, timer = 0;
    const fallback = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { w?.terminate(); } catch {}
      analyzePCMAsync(samples, sampleRate, { key, source, onProgress }).then(resolve, reject);
    };
    if (typeof Worker === 'undefined') { fallback(); return; }
    try { w = new Worker(new URL('./analyzer-worker.js', import.meta.url), { type: 'module' }); } catch { fallback(); return; }
    timer = setTimeout(() => { if (!started) fallback(); }, 5000);
    w.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'ready' && !started && !finished) {
        started = true; clearTimeout(timer);
        let arr = samples;
        if (arr.byteOffset !== 0 || arr.byteLength !== arr.buffer.byteLength) arr = arr.slice();
        try { w.postMessage({ type: 'analyze', samples: arr, sampleRate, key, source }, [arr.buffer]); }
        catch { started = false; fallback(); }
      } else if (m.type === 'progress') onProgress?.(m.p);
      else if (m.type === 'done') { finished = true; w.terminate(); resolve(m.analysis); }
      else if (m.type === 'error') { finished = true; w.terminate(); reject(new Error(m.message || 'analysis failed')); }
    };
    w.onerror = (e) => {
      e?.preventDefault?.();
      if (!started) fallback();
      else if (!finished) { finished = true; try { w.terminate(); } catch {} reject(new Error(e?.message || 'analysis worker failed')); }
    };
  });
}

/** Decode any audio file the browser understands → mono Float32Array at `sampleRate`. */
export async function decodeToMono(arrayBuffer, sampleRate = 22050) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) throw new Error('OfflineAudioContext not available');
  const ctx = new OAC(1, 1, sampleRate);
  const buf = await new Promise((res, rej) => {
    const p = ctx.decodeAudioData(arrayBuffer, res, rej);
    if (p && p.then) p.then(res, rej);
  });
  if (buf.sampleRate === sampleRate) {
    const n = buf.length, ch = buf.numberOfChannels;
    if (ch === 1) return { samples: buf.getChannelData(0).slice(), sampleRate };
    const out = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i]; }
    const k = 1 / ch; for (let i = 0; i < n; i++) out[i] *= k;
    return { samples: out, sampleRate };
  }
  // resample (and downmix: 1 output channel) by rendering
  const len = Math.ceil((buf.duration || buf.length / buf.sampleRate) * sampleRate);
  const r = new OAC(1, len, sampleRate);
  const src = r.createBufferSource(); src.buffer = buf; src.connect(r.destination); src.start();
  const out = await r.startRendering();
  return { samples: out.getChannelData(0).slice(), sampleRate };
}

// ------------------------------------------------------------------ tempo-only analysis
function prng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// 16-step (one bar of 16ths) patterns. Digit = strength 1–9, '.' = rest.
const KICKS = ['9...7...9...7...', '9.....7.9.......', '9..6..7...8.....', '9.......9.6.....', '9...7...9...7.6.'];
const SNARES = ['....8.......8...', '....8.......8..5', '....8..4....8...', '........8.......'];
const HATS = ['4.3.4.3.4.3.4.3.', '..4...4...4...4.', '3232323232323232', '4...4...4...4...'];
// melody rhythm over 2 bars (32 steps): digit = note start, '-' = held, '.' = rest
const MELS = [
  '6.5.6...5-6.4---6.5.6...7-5.6---',
  '7--5--6-5---4---7--5--6-7-------',
  '6.6.5.6.7---5.4.6.6.5.6.4-------',
  '7---6---5-4-5---7---6---7-------',
  '6..5..6.5.4.5.6.6..5..6.7.6.5---',
  '7-------6-------5---6---7-------',
];
const SECTION_PLAN = [['intro', 8], ['verse', 16], ['chorus', 16], ['verse', 16], ['chorus', 16], ['bridge', 8], ['chorus', 16]];
const LEVEL = { intro: 0.45, verse: 0.65, chorus: 0.9, bridge: 0.55, outro: 0.4 };

/** Synthetic but musical Analysis from a beat grid (no audio). quality 0.2. */
export function tempoAnalysis({ key = '', bpm = 120, firstBeatMs = 0, durMs = 200000, seed = 1 } = {}) {
  bpm = Math.min(220, Math.max(40, +bpm || 120));
  durMs = Math.max(10000, +durMs || 200000);
  const per = 60000 / bpm;
  const rnd = prng(hashStr(String(key)) ^ (seed * 2654435761));
  let t0 = +firstBeatMs || 0;
  let k0 = 0;
  while (t0 - per >= 0) { t0 -= per; k0++; }
  const beats = [];
  for (let t = t0; t < durMs; t += per) beats.push(Math.round(t));
  const firstIdx = k0;                       // index of firstBeatMs = a downbeat
  const downbeats = [];
  for (let i = firstIdx % 4; i < beats.length; i += 4) downbeats.push(i);
  // sections in bars, from the first downbeat
  const bars = Math.floor((beats.length - (firstIdx % 4)) / 4);
  const secs = [];
  let bar = 0, pi = 0;
  while (bar < bars) {
    const left = bars - bar;
    let [type, len] = SECTION_PLAN[pi] || (pi % 2 ? ['chorus', 16] : ['verse', 16]);
    if (left <= 8 && bar > 0) { type = 'outro'; len = left; }
    else if (left < len + 8) len = left;
    secs.push({ type, bar, len });
    bar += len; pi++;
  }
  const db0 = firstIdx % 4;
  const barT = (b) => { const i = db0 + b * 4; return i < beats.length ? beats[i] : beats[beats.length - 1] + (i - beats.length + 1) * per; };
  const labels = { intro: 0, verse: 1, chorus: 2, bridge: 3, outro: 4 };
  // per section type: pattern choice (same type → same patterns → recognisable repeats)
  const choice = {};
  for (const type of Object.keys(LEVEL)) {
    choice[type] = {
      kick: KICKS[Math.floor(rnd() * KICKS.length)], snare: SNARES[Math.floor(rnd() * 3)],
      hat: HATS[Math.floor(rnd() * HATS.length)], mel: MELS[Math.floor(rnd() * MELS.length)],
      contour: Array.from({ length: 32 }, () => Math.floor(rnd() * 3) - 1), base: 2 + Math.floor(rnd() * 3),
    };
  }
  choice.bridge.snare = SNARES[3]; choice.bridge.kick = '9.......6.......'; choice.bridge.mel = MELS[5];
  choice.intro.kick = '9...............'; choice.intro.snare = '................';
  choice.outro.snare = '................';
  const onsets = [];
  const step16 = per / 4;
  const add = (t, s, b, p, d) => { if (t >= 0 && t < durMs) onsets.push({ t: Math.round(t), s, b, p, d: Math.round(d) }); };
  // pickup before the first downbeat: hats on beats
  for (let i = 0; i < db0; i++) add(beats[i], 0.3, 2, 0.75, 0);
  for (const sec of secs) {
    const c = choice[sec.type];
    const lvl = LEVEL[sec.type];
    // melody pitches for this section: random walk over the 2-bar motif, re-used every 2 bars
    const pitches = [];
    let deg = c.base + (sec.type === 'chorus' ? 2 : 0);
    for (let i = 0; i < 32; i++) { deg = Math.min(8, Math.max(0, deg + c.contour[i])); pitches.push(deg); }
    for (let b = 0; b < sec.len; b++) {
      const bt = barT(sec.bar + b);
      const bp = barT(sec.bar + b + 1) - bt;
      const st = bp / 16;
      const fill = b === sec.len - 1 && sec.type !== 'outro' && sec.len >= 8;
      for (let q = 0; q < 16; q++) {
        const tq = bt + q * st;
        const hits = [];
        const kc = c.kick[q], sc = fill && q >= 12 ? '7' : c.snare[q], hc = c.hat[q];
        if (kc !== '.') hits.push({ s: (+kc / 9) * (0.6 + 0.4 * lvl), b: 0, p: 0.12 });
        if (sc !== '.') hits.push({ s: (+sc / 9) * (0.55 + 0.4 * lvl), b: 1, p: 0.45 });
        if (hc !== '.' && sec.type !== 'intro' || (sec.type === 'intro' && q % 4 === 2)) hits.push({ s: (+hc || 3) / 9 * 0.6, b: 2, p: 0.85 });
        const mq = (b % 2) * 16 + q;
        const mc = c.mel[mq];
        if (sec.type !== 'intro' && sec.type !== 'outro' && mc >= '1' && mc <= '9') {
          let held = 0; while (mq + held + 1 < 32 && c.mel[mq + held + 1] === '-') held++;
          let last = true; for (let r = mq + 1; r < 32; r++) if (c.mel[r] >= '1' && c.mel[r] <= '9') { last = false; break; }
          if (last && b % 2 === 1) held = Math.max(held, 31 - mq);            // phrase ends ring to the bar line
          const variation = b % 4 === 3 ? 1 : 0;
          const p = Math.min(1, 0.18 + 0.085 * (pitches[mq] + variation));
          hits.push({ s: (+mc / 9) * (0.5 + 0.4 * lvl), b: 1, p, d: held >= 3 ? (held + 1) * st : 0, mel: true });
        }
        if (q === 0 && b === 0 && sec.type === 'chorus') hits.push({ s: 1, b: 2, p: 0.95 });
        if (!hits.length) continue;
        hits.sort((x, y) => y.s - x.s);
        const top = hits[0], mel = hits.find((h) => h.mel);
        let s = top.s; for (let i = 1; i < hits.length; i++) s += 0.12 * hits[i].s;
        add(tq, Math.round(Math.min(1, s) * 1000) / 1000, top.b, mel ? mel.p : top.p, mel ? mel.d || 0 : 0);
      }
    }
  }
  onsets.sort((a, b) => a.t - b.t);
  // energy arc per 250 ms
  const nbk = Math.ceil(durMs / 250);
  const energy = new Array(nbk);
  const secAt = (t) => { let s = secs[0]; for (const x of secs) if (barT(x.bar) <= t) s = x; return s; };
  for (let b = 0; b < nbk; b++) {
    const t = b * 250;
    const s = secs.length ? secAt(t) : { type: 'verse' };
    let e = LEVEL[s.type] ?? 0.6;
    if (t < (secs.length ? barT(0) : 0)) e = 0.35;
    e += 0.04 * Math.sin(b * 0.7) + (rnd() - 0.5) * 0.05;
    e *= Math.min(1, (durMs - t) / 6000 + 0.3);
    energy[b] = Math.round(Math.min(1, Math.max(0, e)) * 1000) / 1000;
  }
  const sections = secs.map((s, i) => ({ t: i === 0 ? 0 : Math.round(barT(s.bar)), e: LEVEL[s.type], k: labels[s.type] }));
  if (!sections.length) sections.push({ t: 0, e: 0.6, k: 0 });
  return {
    v: 1, key, source: 'tempo', created: Date.now(), durMs: Math.round(durMs), bpm: Math.round(bpm * 100) / 100,
    beats, downbeats, onsets, energy, sections, quality: 0.2,
  };
}

// ------------------------------------------------------------------ live learning
const LOG_EDGES = Array.from({ length: 17 }, (_, i) => 40 * (10000 / 40) ** (i / 16));

/** Streaming 2× decimator (same filter as the offline one; keeps its history across chunks). */
const DEC_TAPS = [[-5, 0.0121], [-3, -0.0647], [-1, 0.3024], [0, 0.5], [1, 0.3024], [3, -0.0647], [5, 0.0121]];
class Decim2 {
  constructor() { this.buf = new Float32Array(0); this.pos = 0; this.next = 0; }
  push(x) {
    const all = new Float32Array(this.buf.length + x.length);
    all.set(this.buf); all.set(x, this.buf.length);
    const end = this.pos + all.length, out = [];
    while (this.next + 5 < end) {
      let s = 0;
      for (const [o, w] of DEC_TAPS) { const k = this.next + o; if (k >= this.pos) s += all[k - this.pos] * w; }
      out.push(s); this.next += 2;
    }
    const keepFrom = Math.max(this.pos, this.next - 5);
    this.buf = all.slice(keepFrom - this.pos); this.pos = keepFrom;
    return Float32Array.from(out);
  }
}

export class LiveLearner {
  constructor({ sampleRate = 22050, key = '', source = 'mic' } = {}) {
    this.key = key; this.source = source;
    this.inRate = sampleRate;
    this.decims = 0; let sr = sampleRate; while (sr > 32000) { sr /= 2; this.decims++; }
    this.sr = sr;
    this.durMs = 0;
    this.st = new FeatureStore(sr, Math.ceil((sr * 300) / HOP));
    this.proc = new FrameProcessor(sr);
    this.win = new Float64Array(N);
    this.seg = null;
    this.gainPow = 0;               // running mean power (for the automatic gain)
    this.features = { level: 0, bands: new Float32Array(16), beat: false, bpm: 0 };
    this._bandPeak = 1e-6;
    this._fluxAvg = 0; this._lastBeatF = -1e9;
    this._lastTempoF = 0;
    this._dec = [];
    // band edges in bins
    const binHz = sr / N;
    this._bandBins = LOG_EDGES.map((f) => Math.max(1, Math.min(N / 2, Math.round(f / binHz))));
  }

  get coverage() {
    const nF = this.durMs ? Math.ceil((this.durMs / 1000) * this.st.fps) : this.st.n;
    if (!nF) return 0;
    let h = 0; const lim = Math.min(nF, this.st.n);
    for (let i = 0; i < lim; i++) h += this.st.heard[i];
    return Math.min(1, h / nF);
  }

  /** samples: mono chunk at the constructor's sampleRate; songTimeMs: song time of samples[0]. */
  push(samples, songTimeMs) {
    if (!samples || !samples.length) return;
    // level (before gain)
    let pw = 0; for (let i = 0; i < samples.length; i++) pw += samples[i] * samples[i];
    pw /= samples.length;
    const lvlDb = 10 * Math.log10(pw + 1e-12);
    this.features.level = Math.max(0, Math.min(1, (lvlDb + 60) / 54));
    const startIn = Math.round((songTimeMs / 1000) * this.inRate);
    // segment continuity (in input samples)
    const tol = Math.round(this.inRate * 0.04);
    let fresh = !this.seg || Math.abs(startIn - this.seg.nextIn) > tol;
    let x = samples;
    if (fresh) this._dec = Array.from({ length: this.decims }, () => new Decim2());
    for (const d of this._dec) x = d.push(x);
    if (fresh) {
      const start = Math.round((songTimeMs / 1000) * this.sr);
      this.seg = { start, bufStart: start, len: 0, buf: new Float32Array(Math.max(N * 4, x.length * 2)), nextIn: startIn, nextF: 0 };
      // first frame whose window lies inside the segment (a segment starting at 0 is zero-padded like offline)
      const half = N / 2;
      if (start <= 0) {
        this.seg.bufStart = -half; this.seg.len = half + start; // zeros before the song start
        this.seg.buf.fill(0, 0, this.seg.len);
        this.seg.nextF = 0;
      } else this.seg.nextF = Math.ceil((start + half) / HOP);
      this.proc.reset();
    }
    const seg = this.seg;
    seg.nextIn = startIn + samples.length;
    // automatic gain from a running power estimate
    this.gainPow = this.gainPow ? this.gainPow + (pw - this.gainPow) * Math.min(1, samples.length / (this.inRate * 4)) : pw;
    const gain = Math.min(1000, TARGET_RMS / Math.max(Math.sqrt(this.gainPow), 1e-5));
    // append
    if (seg.len + x.length > seg.buf.length) { const nb = new Float32Array((seg.len + x.length) * 2); nb.set(seg.buf.subarray(0, seg.len)); seg.buf = nb; }
    seg.buf.set(x, seg.len); seg.len += x.length;
    // process frames
    const half = N / 2, st = this.st, win = this.win;
    let beat = false;
    while (true) {
      const c = seg.nextF * HOP;
      const a = c - half - seg.bufStart;
      if (a + N > seg.len) break;
      if (a < 0) { seg.nextF++; continue; }
      for (let i = 0; i < N; i++) win[i] = seg.buf[a + i] * gain;
      st.ensure(seg.nextF + 2);
      this.proc.frame(win, seg.nextF, st);
      // live beat: low+mid flux against its running mean
      const f = seg.nextF;
      const v = st.fluxL[f] * 1.2 + st.fluxM[f];
      if (v > this._fluxAvg * 1.8 + 0.02 && f - this._lastBeatF > st.fps * 0.25) { beat = true; this._lastBeatF = f; }
      this._fluxAvg += (v - this._fluxAvg) * 0.02;
      seg.nextF++;
    }
    // drop consumed samples
    const keep = seg.nextF * HOP - half - seg.bufStart;
    if (keep > N * 2) { seg.buf.copyWithin(0, keep, seg.len); seg.len -= keep; seg.bufStart += keep; }
    // display features
    this.features.beat = beat;
    const P = this.proc.P, B = this.features.bands, bb = this._bandBins;
    let mx = 0;
    const tmp = new Float32Array(16);
    for (let i = 0; i < 16; i++) {
      let s = 0; for (let k = bb[i]; k < Math.max(bb[i] + 1, bb[i + 1]); k++) s += P[k];
      tmp[i] = 10 * Math.log10(s + 1e-10); if (tmp[i] > mx) mx = tmp[i];
    }
    this._bandPeak = Math.max(mx, this._bandPeak - samples.length / this.inRate * 3);
    for (let i = 0; i < 16; i++) B[i] = Math.max(0, Math.min(1, (tmp[i] - this._bandPeak + 48) / 48)) * Math.min(1, this.features.level * 3);
    // running tempo every ~2 s over the last 12 s heard
    const fNow = seg.nextF;
    if (fNow - this._lastTempoF > st.fps * 2) {
      this._lastTempoF = fNow;
      const from = Math.max(0, fNow - Math.round(st.fps * 12));
      let h = 0; for (let i = from; i < fNow; i++) h += st.heard[i];
      if (h > st.fps * 6) this.features.bpm = Math.round(this._windowTempo(from, fNow) * 10) / 10;
    }
  }

  _windowTempo(from, to) {
    const st = this.st, n = to - from;
    const o = new Float32Array(n), heard = new Uint8Array(n);
    const sd = [0, 0, 0];
    for (let i = 0; i < n; i++) { sd[0] += st.fluxL[from + i]; sd[1] += st.fluxM[from + i]; sd[2] += st.fluxH[from + i]; }
    for (let i = 0; i < n; i++) {
      const f = from + i;
      heard[i] = st.heard[f];
      o[i] = st.fluxL[f] / (sd[0] / n + 1e-9) + 0.85 * st.fluxM[f] / (sd[1] / n + 1e-9) + 0.7 * st.fluxH[f] / (sd[2] / n + 1e-9);
    }
    const env = new Float32Array(n);
    const half = Math.round(st.fps * 0.5);
    for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k += 4) { s += o[k]; c++; } env[i] = heard[i] ? o[i] - s / c : 0; }
    return estimateTempo(env, heard, n, st.fps).bpm;
  }

  /** Full Analysis from everything heard; unheard spans get beats by extrapolation and synthetic onsets. */
  finish() {
    const cov = this.coverage;
    const base = DEFAULT_QUALITY[this.source] ?? 0.7;
    return postProcess(this.st, {
      key: this.key, source: this.source, durMs: this.durMs || undefined,
      quality: base * (0.35 + 0.65 * cov), fillGaps: cov < 0.999,
    });
  }
}
