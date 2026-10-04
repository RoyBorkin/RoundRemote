// Feature store → Analysis (shared by analyzePCM and LiveLearner.finish).
//   onsets     multi-band peak picking with adaptive thresholds, merged across bands
//   tempo      autocorrelation of the onset envelope + comb over 4 multiples + log-Gaussian prior (120 BPM),
//              octave-error handling towards 80–160 BPM
//   beats      dynamic-programming beat tracker (Ellis 2007), sub-frame refined, extrapolated to the song edges
//   downbeats  bar phase from low-band accents + harmonic change at the beat
//   energy     loudness per 250 ms; sections from a novelty curve on smoothed energy/timbre/chroma (≥ 8 s)
import { NSEMI, MIDI0, BLOCK_SEC, PITCH_LO } from './dsp-features.js';

// Systematic offset between the flux peak (frame centre) and the true onset, measured on click tracks.
export const ONSET_LAG_MS = 5;
const W = [1, 0.85, 0.7]; // band weights low/mid/high
const SUS_K = 0.55;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function quantile(vals, q) {
  if (!vals.length) return 0;
  const a = Float64Array.from(vals).sort();
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))];
}
function maskedQuantile(arr, n, mask, q) {
  const v = [];
  for (let i = 0; i < n; i++) if (mask[i]) v.push(arr[i]);
  return quantile(v, q);
}
function movMean(x, n, half) {
  const out = new Float32Array(n);
  let s = 0, a = 0, b = -1; // window [a, b]
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half);
    while (b < hi) s += x[++b];
    while (a < lo) s -= x[a++];
    out[i] = s / (b - a + 1);
  }
  return out;
}

// ------------------------------------------------------------------ onsets
function pickPeaks(o, n, heard, band, out) {
  const delta = 0.07, floor = 0.05;
  const preMax = 3, postMax = 3, preAvg = 12, postAvg = 6, wait = 4;
  let last = -1e9;
  // running mean over [f - preAvg, f + postAvg]
  let s = 0, a = 0, b = -1;
  for (let f = 0; f < n; f++) {
    const lo = Math.max(0, f - preAvg), hi = Math.min(n - 1, f + postAvg);
    while (b < hi) s += o[++b];
    while (a < lo) s -= o[a++];
    const v = o[f];
    if (v < floor || !heard[f]) continue;
    let isMax = true;
    for (let k = Math.max(0, f - preMax); k <= Math.min(n - 1, f + postMax); k++) {
      if (k < f ? o[k] >= v : o[k] > v) { isMax = false; break; }
    }
    if (!isMax) continue;
    const mean = s / (b - a + 1);
    if (v >= mean + delta && f - last >= wait) { out.push({ f, band, v }); last = f; }
  }
}

function parabola(y, i, n) {
  if (i <= 0 || i >= n - 1) return 0;
  const a = y[i - 1], b = y[i], c = y[i + 1];
  const den = a - 2 * b + c;
  if (den >= 0) return 0;
  return clamp((0.5 * (a - c)) / den, -0.5, 0.5);
}

// ------------------------------------------------------------------ tempo
export function tempoPrior(bpm) {
  const g = Math.log2(bpm / 120) / 0.9;
  let w = Math.exp(-0.5 * g * g);
  if (bpm < 80) w *= Math.exp(-0.5 * (Math.log2(80 / bpm) / 0.25) ** 2);
  if (bpm > 160) w *= Math.exp(-0.5 * (Math.log2(bpm / 160) / 0.25) ** 2);
  return w;
}

/** env: high-passed onset envelope, heard: mask. Returns { period (frames), bpm, conf }. */
export function estimateTempo(env, heard, n, fps, from = 0) {
  const tauMin = (60 * fps) / 220, tauMax = (60 * fps) / 50;
  const maxLag = Math.min(n - from - 2, Math.ceil(tauMax * 4) + 2);
  if (maxLag < tauMin * 2) return { period: (60 * fps) / 120, bpm: 120, conf: 0 };
  const A = new Float64Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0, c = 0;
    for (let i = from; i + lag < n; i++) {
      if (heard[i] && heard[i + lag]) { s += env[i] * env[i + lag]; c++; }
    }
    A[lag] = c > 0 ? s / c : 0;
  }
  const a0 = A[0] || 1;
  for (let i = 0; i <= maxLag; i++) A[i] /= a0;
  const at = (x) => { if (x >= maxLag) return 0; const i = Math.floor(x), fr = x - i; return A[i] * (1 - fr) + A[i + 1] * fr; };
  const comb = (tau) => {
    let s = 0, wsum = 0;
    const wk = [1, 0.8, 0.6, 0.5];
    for (let k = 1; k <= 4; k++) { if (k * tau >= maxLag) break; s += wk[k - 1] * at(k * tau); wsum += wk[k - 1]; }
    // penalise lags whose half-multiples are as strong (the true period is then shorter)
    return wsum ? s / wsum : 0;
  };
  let best = 0, bestTau = (60 * fps) / 120, bestRaw = 0;
  const cand = [];
  for (let tau = tauMin; tau <= tauMax; tau += 0.1) {
    const raw = comb(tau);
    const sc = raw * tempoPrior((60 * fps) / tau);
    cand.push([tau, raw]);
    if (sc > best) { best = sc; bestTau = tau; bestRaw = raw; }
  }
  // fine refinement around the best lag
  for (let tau = bestTau - 0.1; tau <= bestTau + 0.1; tau += 0.01) {
    const sc = comb(tau) * tempoPrior((60 * fps) / tau);
    if (sc > best) { best = sc; bestTau = tau; bestRaw = comb(tau); }
  }
  // octave handling: prefer 80–160 BPM when the alternative is almost as well supported
  let bpm = (60 * fps) / bestTau;
  const rawAt = (b) => { let m = 0; const t0 = (60 * fps) / b; for (let t = t0 * 0.985; t <= t0 * 1.015; t += 0.05) m = Math.max(m, comb(t)); return m; };
  if (bpm < 80 && rawAt(bpm * 2) > 0.62 * bestRaw) bpm *= 2;
  else if (bpm > 160 && rawAt(bpm / 2) > 0.62 * bestRaw) bpm /= 2;
  if (bpm !== (60 * fps) / bestTau) {
    const t0 = (60 * fps) / bpm; let m = -1;
    for (let t = t0 * 0.985; t <= t0 * 1.015; t += 0.01) { const r = comb(t); if (r > m) { m = r; bestTau = t; } }
    bpm = (60 * fps) / bestTau;
  }
  // confidence: peak vs mean of the comb over all lags
  let mean = 0; for (const c of cand) mean += c[1]; mean /= cand.length || 1;
  return { period: bestTau, bpm, conf: clamp((bestRaw - mean) / (Math.abs(mean) + 0.15), 0, 1) };
}

/** Ellis 2007 dynamic-programming beat tracker. Returns beat frame positions (fractional). */
export function trackBeats(odf, n, period, tightness = 100) {
  // local score: odf / std, smoothed by a Gaussian of width period/32
  let mean = 0, sq = 0;
  for (let i = 0; i < n; i++) { mean += odf[i]; sq += odf[i] * odf[i]; }
  mean /= n || 1;
  const std = Math.sqrt(Math.max(1e-12, sq / (n || 1) - mean * mean));
  const sig = Math.max(0.6, period / 32), half = Math.ceil(sig * 3);
  const g = []; let gs = 0;
  for (let k = -half; k <= half; k++) { const v = Math.exp(-0.5 * (k / sig) ** 2); g.push(v); gs += v; }
  const local = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -half; k <= half; k++) { const j = i + k; if (j >= 0 && j < n) s += g[k + half] * odf[j]; }
    local[i] = s / gs / std;
  }
  let maxL = 0; for (let i = 0; i < n; i++) if (local[i] > maxL) maxL = local[i];
  const cum = new Float32Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(period * 2), hi = Math.max(1, Math.round(period / 2));
  const txw = new Float32Array(lo + 1);
  for (let d = hi; d <= lo; d++) txw[d] = -tightness * Math.log(d / period) ** 2;
  let started = false;
  for (let i = 0; i < n; i++) {
    let best = -Infinity, bi = -1;
    for (let d = hi; d <= lo; d++) {
      const j = i - d;
      if (j < 0) break;
      const v = cum[j] + txw[d];
      if (v > best) { best = v; bi = j; }
    }
    if (!started || bi < 0) {
      cum[i] = local[i];
      back[i] = -1;
      if (local[i] >= 0.01 * maxL && maxL > 0) started = true;
    } else { cum[i] = local[i] + best; back[i] = bi; }
  }
  // last beat: best cumulative score in the final period
  let last = n - 1, lv = -Infinity;
  for (let i = Math.max(0, n - Math.ceil(period)); i < n; i++) if (cum[i] > lv) { lv = cum[i]; last = i; }
  const beats = [];
  for (let i = last; i >= 0; i = back[i]) { beats.push(i); if (back[i] < 0) break; }
  beats.reverse();
  return { frames: beats.map((f) => f + parabola(local, f, n)), local };
}

// ------------------------------------------------------------------ main
/**
 * st: FeatureStore; opts: { key, source, durMs, quality, fillGaps, onProgress }
 * Returns an Analysis (v: 1).
 */
export function postProcess(st, { key = '', source = 'file', durMs, quality = 0.9, fillGaps = false, onProgress } = {}) {
  const fps = st.fps, frameMs = 1000 / fps;
  const n = Math.max(1, Math.max(st.n, durMs ? Math.ceil((durMs / 1000) * fps) : 0));
  st.ensure(n + 1);
  durMs = durMs || Math.round(n * frameMs);
  const heard = st.heard;
  let heardCount = 0; for (let i = 0; i < n; i++) heardCount += heard[i];
  const prog = (p) => onProgress && onProgress(p);

  // band onset detection functions, normalised per band
  const fluxes = [st.fluxL, st.fluxM, st.fluxH];
  const p95 = fluxes.map((x) => maskedQuantile(x, n, heard, 0.995));
  const top = Math.max(...p95, 1e-9);
  const O = fluxes.map((x, b) => {
    const norm = Math.max(p95[b], 0.15 * top, 1e-9);
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = heard[i] ? x[i] / norm : 0;
    return o;
  });
  const oc = new Float32Array(n);
  for (let i = 0; i < n; i++) oc[i] = (W[0] * O[0][i] + W[1] * O[1][i] + W[2] * O[2][i]) / (W[0] + W[1] + W[2]);
  prog(0.15);

  // --- onsets
  const cands = [];
  for (let b = 0; b < 3; b++) pickPeaks(O[b], n, heard, b, cands);
  cands.sort((a, b) => a.f - b.f);
  const raw = [];
  for (let i = 0; i < cands.length;) {
    let j = i, best = cands[i];
    while (j + 1 < cands.length && cands[j + 1].f - cands[i].f <= 3) { j++; if (cands[j].v * W[cands[j].band] > best.v * W[best.band]) best = cands[j]; }
    const f = best.f;
    let sum = 0, bb = 0, bv = -1;
    for (let b = 0; b < 3; b++) {
      let m = 0; for (let k = Math.max(0, f - 1); k <= Math.min(n - 1, f + 1); k++) m = Math.max(m, O[b][k]);
      sum += W[b] * m;
      if (m > bv) { bv = m; bb = b; }
    }
    raw.push({ f, ff: f + parabola(O[best.band], f, n), band: bb, v: sum });
    i = j + 1;
  }
  const vq = quantile(raw.map((r) => r.v), 0.9) || 1;
  // pitch & brightness
  const cent = st.cent;
  const c05 = maskedQuantile(cent, n, heard, 0.05), c95 = maskedQuantile(cent, n, heard, 0.95);
  // predominant pitch just after the onset: mean harmonic salience over frames f+2..f+6 (≈ 25–70 ms)
  const acc = new Float32Array(NSEMI);
  const salAt = [];
  for (const r of raw) {
    acc.fill(0);
    const f0 = Math.min(n - 1, r.f + 2), f1 = Math.min(n - 1, r.f + 6);
    for (let k = f0; k <= f1; k++) { const base = k * NSEMI; for (let q = PITCH_LO; q < NSEMI; q++) acc[q] += st.sal[base + q]; }
    let bm = -1, bv = 0, sum = 0;
    for (let q = PITCH_LO; q < NSEMI; q++) { sum += acc[q]; if (acc[q] > bv) { bv = acc[q]; bm = q; } }
    const cnt = f1 - f0 + 1;
    r.pm = bm >= 0 ? MIDI0 + bm : 0; r.ps = bv / cnt; r.pmean = sum / (NSEMI - PITCH_LO) / cnt;
    salAt.push(r.ps);
  }
  const salRef = quantile(salAt, 0.75) || 1;
  const onsets = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const s = clamp(r.v / vq, 0, 1);
    if (s < 0.05) continue;
    const m = r.pm;
    const pitched = m > 0 && r.ps / (r.pmean + 1e-6) >= 2.2 && r.ps >= 0.2 * salRef;
    // p: the predominant pitch when there is tonal content at all (keeps drum hits inside the melodic
    // context, so lanes follow the tune instead of zig-zagging between drums and notes), else brightness
    const bright = clamp(0.1 + 0.8 * ((cent[r.f] - c05) / Math.max(1e-6, c95 - c05)), 0, 1);
    let p;
    if (m > 0 && (pitched || r.ps >= 0.08 * salRef)) p = clamp((m - MIDI0 - PITCH_LO) / (NSEMI - PITCH_LO - 1), 0, 1);
    else p = bright * (r.band === 0 ? 0.6 : 1);
    onsets.push({ r, s, p, pitched, m });
  }
  // sustain: excess level over the pre-onset level stays above half of its peak
  const maxSus = Math.round(4 * fps);
  const E = [st.eL, st.eM, st.eH];
  for (let i = 0; i < onsets.length; i++) {
    const o = onsets[i], f = o.r.f;
    let g = f;
    if (o.pitched) {
      // the note rings while its salience stays above ~55 % of its level just after the onset, until the
      // melody moves on (next pitched onset) — short dips (≤ 2 frames) are tolerated
      const idx = o.m - MIDI0;
      const level = o.r.ps * SUS_K;
      let stop = Math.min(n, f + maxSus);
      for (let j = i + 1; j < onsets.length && onsets[j].r.f < stop; j++) if (onsets[j].pitched && onsets[j].m !== o.m && onsets[j].r.f > f + 3) { stop = onsets[j].r.f; break; }
      g = f + 2;
      let miss = 0;
      while (g < stop && heard[g]) {
        if (st.sal[g * NSEMI + idx] >= level) miss = 0; else if (++miss > 2) { g -= 2; break; }
        g++;
      }
    } else {
      const e = E[o.r.band];
      const pre = e[Math.max(0, f - 3)];
      let peak = 0;
      for (let k = f; k <= Math.min(n - 1, f + 3); k++) peak = Math.max(peak, e[k]);
      const thr = pre + 0.4 * (peak - pre);
      if (peak > pre * 1.5) { g = f + 3; while (g < n && g < f + maxSus && heard[g] && e[g] >= thr) g++; }
    }
    let d = (g - f) * frameMs;
    if (d < 200) d = 0;
    o.d = d;
  }
  prog(0.3);

  // --- tempo
  const smooth = movMean(oc, n, Math.round(fps * 0.5));
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) env[i] = heard[i] ? oc[i] - smooth[i] : 0;
  const tempo = estimateTempo(env, heard, n, fps);
  prog(0.55);
  // beat tracking listens mostly to the low band (kick drums define the beat; off-beat bass / hats less)
  const ob = new Float32Array(n);
  for (let i = 0; i < n; i++) ob[i] = (1.4 * O[0][i] + 0.6 * O[1][i] + 0.4 * O[2][i]) / 2.4;
  const obS = movMean(ob, n, Math.round(fps * 0.5));
  const odf = new Float32Array(n);
  for (let i = 0; i < n; i++) odf[i] = Math.max(0, ob[i] - 0.5 * obS[i]);
  const tb = trackBeats(odf, n, tempo.period);
  prog(0.7);
  let beatsMs = tb.frames.map((f) => f * frameMs - ONSET_LAG_MS);
  // keep only beats from heard regions to estimate tempo precisely
  let bpm = tempo.bpm;
  const heardBeats = beatsMs.filter((t) => heard[Math.min(n - 1, Math.max(0, Math.round((t + ONSET_LAG_MS) / frameMs)))]);
  if (heardBeats.length >= 8) {
    // least-squares line through beat times vs index (steady songs), else median interval
    const k = heardBeats.length;
    const idx = heardBeats.map((t) => Math.round((t - heardBeats[0]) / (60000 / tempo.bpm)));
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < k; i++) { sx += idx[i]; sy += heardBeats[i]; sxx += idx[i] * idx[i]; sxy += idx[i] * heardBeats[i]; }
    const slope = (k * sxy - sx * sy) / Math.max(1e-9, k * sxx - sx * sx);
    const icp = (sy - slope * sx) / k;
    let res = 0; for (let i = 0; i < k; i++) res += (heardBeats[i] - (icp + slope * idx[i])) ** 2;
    res = Math.sqrt(res / k);
    const ibis = [];
    for (let i = 1; i < beatsMs.length; i++) ibis.push(beatsMs[i] - beatsMs[i - 1]);
    const med = quantile(ibis, 0.5);
    bpm = res < 25 && slope > 0 && Math.abs(slope - med) / med < 0.08 ? 60000 / slope : 60000 / med;
  }
  // anchor on beats heard (tracked), bridge unheard gaps with evenly spaced beats, extrapolate to [0, durMs]
  const per = 60000 / bpm;
  const heardNear = (t) => { const f = Math.round((t + ONSET_LAG_MS) / frameMs); return f >= 0 && f < n && heard[f] && heard[Math.max(0, f - 8)] && heard[Math.min(n - 1, f + 8)]; };
  let anchors = beatsMs.filter(heardNear);
  if (anchors.length < 2) anchors = beatsMs.length ? beatsMs.slice() : [0];
  const localPer = (from, dir) => { // least-squares period over up to 16 anchors starting at `from` going `dir`
    const idx = []; for (let i = from, k = 0; i >= 0 && i < anchors.length && k < 16; i += dir, k++) idx.push(anchors[i]);
    if (idx.length < 4) return per;
    if (dir < 0) idx.reverse();
    const m = idx.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < m; i++) { sx += i; sy += idx[i]; sxx += i * i; sxy += i * idx[i]; }
    const sl = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    return sl > per * 0.8 && sl < per * 1.25 ? sl : per;
  };
  const full = [];
  for (let i = 0; i < anchors.length; i++) {
    full.push(anchors[i]);
    if (i + 1 < anchors.length) {
      const gap = anchors[i + 1] - anchors[i];
      if (gap > per * 1.5) { const k = Math.max(1, Math.round(gap / per)); for (let j = 1; j < k; j++) full.push(anchors[i] + (gap * j) / k); }
    }
  }
  const head = [], tail = [];
  const p0 = localPer(0, 1), p1 = localPer(anchors.length - 1, -1);
  for (let t = full[0] - p0; t >= -p0 * 0.25; t -= p0) head.push(t);
  for (let t = full[full.length - 1] + p1; t < durMs; t += p1) tail.push(t);
  beatsMs = head.reverse().concat(full, tail).map((t) => Math.max(0, Math.round(t)));
  for (let i = 1; i < beatsMs.length; i++) if (beatsMs[i] <= beatsMs[i - 1]) beatsMs[i] = beatsMs[i - 1] + 1;

  // --- downbeats: low-band accent + harmonic change at each beat
  const B = beatsMs.length;
  const fr = (t) => clamp(Math.round((t + ONSET_LAG_MS) / frameMs), 0, n - 1);
  const lowAt = new Float32Array(B), chg = new Float32Array(B);
  const prevV = new Float32Array(NSEMI), curV = new Float32Array(NSEMI);
  for (let i = 0; i < B; i++) {
    const f = fr(beatsMs[i]);
    let m = 0; for (let k = Math.max(0, f - 2); k <= Math.min(n - 1, f + 2); k++) m = Math.max(m, O[0][k]);
    lowAt[i] = m;
    // harmonic content of the beat interval [beat i, beat i+1)
    const f1 = i + 1 < B ? fr(beatsMs[i + 1]) : Math.min(n - 1, f + 20);
    curV.fill(0);
    let cnt = 0;
    for (let k = f; k < f1; k++) { if (!heard[k]) continue; cnt++; for (let q = 0; q < NSEMI; q++) curV[q] += st.sal[k * NSEMI + q]; }
    if (cnt) {
      let dot = 0, na = 0, nb2 = 0;
      for (let q = 0; q < NSEMI; q++) { const a = curV[q] / cnt; curV[q] = a; dot += a * prevV[q]; na += a * a; nb2 += prevV[q] * prevV[q]; }
      chg[i] = i > 0 && na > 0 && nb2 > 0 ? 1 - dot / Math.sqrt(na * nb2) : 0;
      prevV.set(curV);
    }
  }
  const nl = quantile(Array.from(lowAt), 0.9) || 1, nc = quantile(Array.from(chg), 0.9) || 1;
  let phase = 0, bestPh = -1;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0, c = 0;
    for (let i = ph; i < B; i += 4) { s += lowAt[i] / nl + 1.5 * (chg[i] / nc); c++; }
    s /= c || 1;
    if (s > bestPh) { bestPh = s; phase = ph; }
  }
  const downbeats = [];
  for (let i = phase; i < B; i += 4) downbeats.push(i);
  prog(0.8);

  // --- energy per 250 ms: loudness (band powers weighted towards what we hear: mids / highs) mixed with
  //     rhythmic intensity (onset strength density over ±1 s)
  const nbk = Math.max(1, Math.ceil(durMs / 1000 / BLOCK_SEC));
  const dB = new Float32Array(nbk), hb = new Uint8Array(nbk);
  const dbs = [];
  for (let b = 0; b < nbk; b++) {
    if (b < st.bcap && st.bCnt[b] > 0) {
      const pw = (0.3 * st.bBand[b * 3] + st.bBand[b * 3 + 1] + 2 * st.bBand[b * 3 + 2]) / st.bCnt[b];
      dB[b] = 10 * Math.log10(pw + 1e-12); hb[b] = 1; dbs.push(dB[b]);
    }
  }
  const dTop = quantile(dbs, 0.95);
  const dens = new Float32Array(nbk);
  for (const o of onsets) { const b = Math.floor((o.r.f * frameMs) / 1000 / BLOCK_SEC); if (b < nbk) dens[b] += o.s; }
  const densS = movMean(dens, nbk, 4);
  const dTopD = quantile(Array.from(densS).filter((v, b) => hb[b]), 0.95) || 1;
  const energy = new Array(nbk);
  for (let b = 0; b < nbk; b++) energy[b] = hb[b] ? clamp(0.65 * clamp((dB[b] - dTop + 30) / 30, 0, 1) + 0.35 * clamp(densS[b] / dTopD, 0, 1), 0, 1) : -1;
  // fill unheard blocks with the nearest heard value
  for (let b = 0, lastV = -1; b < nbk; b++) { if (energy[b] >= 0) lastV = energy[b]; else if (lastV >= 0) energy[b] = lastV; }
  for (let b = nbk - 1, lastV = 0.5; b >= 0; b--) { if (energy[b] >= 0) lastV = energy[b]; else energy[b] = lastV; }

  // --- sections: novelty on block features
  const D = 20; // energy, 3 band ratios, centroid, onset density per band (3), 12 chroma
  const C0 = 8;  // first chroma slot
  const feat = new Float32Array(nbk * D);
  const centB = new Float32Array(nbk), centC = new Float32Array(nbk);
  for (let f = 0; f < n; f++) if (heard[f]) { const b = st.blockOf(f); if (b < nbk) { centB[b] += cent[f]; centC[b]++; } }
  const densB = [0, 1, 2].map(() => new Float32Array(nbk));
  for (const o of onsets) { const b = Math.floor((o.r.f * frameMs) / 1000 / BLOCK_SEC); if (b < nbk) densB[o.r.band][b] += o.s; }
  const densBS = densB.map((x) => movMean(x, nbk, 4));
  for (let b = 0; b < nbk; b++) {
    const r = b * D;
    feat[r] = energy[b] * 3;
    if (hb[b]) {
      const t = st.bBand[b * 3] + st.bBand[b * 3 + 1] + st.bBand[b * 3 + 2] + 1e-12;
      for (let q = 0; q < 3; q++) feat[r + 1 + q] = Math.log10(st.bBand[b * 3 + q] / t + 1e-6);
      let cs = 0; for (let q = 0; q < 12; q++) cs += st.bChroma[b * 12 + q];
      for (let q = 0; q < 12; q++) feat[r + C0 + q] = cs > 0 ? st.bChroma[b * 12 + q] / cs : 1 / 12;
    } else if (b > 0) for (let q = 1; q < D; q++) feat[r + q] = feat[r - D + q];
    feat[r + 4] = centC[b] ? centB[b] / centC[b] : (b > 0 ? feat[r - D + 4] : 0);
    for (let q = 0; q < 3; q++) feat[r + 5 + q] = densBS[q][b];
  }
  // z-score + weights
  const wts = [1.4, 0.8, 0.8, 0.8, 1, 1, 1, 1].concat(new Array(12).fill(0.45));
  for (let q = 0; q < D; q++) {
    let m = 0, s2 = 0;
    for (let b = 0; b < nbk; b++) m += feat[b * D + q];
    m /= nbk;
    for (let b = 0; b < nbk; b++) s2 += (feat[b * D + q] - m) ** 2;
    // floor the spread so a feature that barely changes (uniform songs) does not turn its noise into novelty
    const minSd = q === 0 ? 0.15 : q < 4 ? 0.06 : q === 4 ? 0.025 : q < 8 ? Math.max(0.1, 0.25 * Math.abs(m)) : 0.012;
    const sd = Math.max(minSd, Math.sqrt(s2 / nbk));
    for (let b = 0; b < nbk; b++) feat[b * D + q] = ((feat[b * D + q] - m) / sd) * wts[q];
  }
  const Wn = 24;
  const pre = new Float64Array((nbk + 1) * D);
  for (let b = 0; b < nbk; b++) for (let q = 0; q < D; q++) pre[(b + 1) * D + q] = pre[b * D + q] + feat[b * D + q];
  const novelty = (Wn) => {
    const nov = new Float32Array(nbk);
    for (let b = 4; b < nbk - 4; b++) {
      const w1 = Math.min(Wn, b), w2 = Math.min(Wn, nbk - b);
      let s = 0;
      for (let q = 0; q < D; q++) {
        const m1 = (pre[b * D + q] - pre[(b - w1) * D + q]) / w1;
        const m2 = (pre[(b + w2) * D + q] - pre[b * D + q]) / w2;
        s += (m1 - m2) ** 2;
      }
      nov[b] = Math.sqrt(s) * Math.min(1, Math.min(w1, w2) / 8);
    }
    return nov;
  };
  const nov = novelty(Wn);       // ±6 s: finds the changes
  const novF = novelty(8);       // ±2 s: places them
  let nm = 0, ns2 = 0; for (let b = 0; b < nbk; b++) { nm += nov[b]; ns2 += nov[b] * nov[b]; }
  nm /= nbk; const nsd = Math.sqrt(Math.max(0, ns2 / nbk - nm * nm));
  const peaks = [];
  for (let b = 1; b < nbk - 1; b++) {
    let isMax = true;
    for (let k = Math.max(0, b - 12); k <= Math.min(nbk - 1, b + 12); k++) if (nov[k] > nov[b] || (k < b && nov[k] === nov[b])) { isMax = false; break; }
    if (isMax && nov[b] > Math.max(nm + 0.5 * nsd, 1.2)) peaks.push(b);
  }
  peaks.sort((a, b) => nov[b] - nov[a]);
  const minSecBlocks = Math.round(8 / BLOCK_SEC);
  const bounds = [];
  for (const b of peaks) {
    if (b < minSecBlocks || nbk - b < minSecBlocks) continue;
    if (bounds.every((x) => Math.abs(x - b) >= minSecBlocks)) bounds.push(b);
  }
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i]; let bb = b, bv = -1;
    for (let k = Math.max(1, b - 12); k <= Math.min(nbk - 2, b + 12); k++) { const v = novF[k] * (1 - Math.abs(k - b) / 30); if (v > bv) { bv = v; bb = k; } }
    bounds[i] = bb;
  }
  bounds.sort((a, b) => a - b);
  // snap to downbeats (else beats)
  const dbT = downbeats.map((i) => beatsMs[i]);
  const nearest = (arr, t) => { let best = t, bd = Infinity; for (const x of arr) { const d = Math.abs(x - t); if (d < bd) { bd = d; best = x; } } return [best, bd]; };
  const starts = [0];
  for (const b of bounds) {
    const t = b * BLOCK_SEC * 1000;
    let [s, d] = nearest(dbT, t);
    if (d > per * 2.5) [s, d] = nearest(beatsMs, t);
    if (s - starts[starts.length - 1] >= 8000 && durMs - s >= 8000) starts.push(s);
  }
  const secVec = [];
  const sections = starts.map((t, i) => {
    const t1 = i + 1 < starts.length ? starts[i + 1] : durMs;
    const b0 = Math.floor(t / 250), b1 = Math.max(b0 + 1, Math.floor(t1 / 250));
    let e = 0; const v = new Float32Array(D);
    for (let b = b0; b < b1 && b < nbk; b++) { e += energy[b]; for (let q = 0; q < D; q++) v[q] += feat[b * D + q]; }
    const c = Math.max(1, Math.min(b1, nbk) - b0);
    for (let q = 0; q < D; q++) v[q] /= c;
    secVec.push(v);
    return { t: Math.round(t), e: Math.round((e / c) * 1000) / 1000 };
  });
  // section similarity labels (repeated verse / chorus → same k)
  let nextK = 0;
  for (let i = 0; i < sections.length; i++) {
    let bestK = -1, bd = Infinity;
    for (let j = 0; j < i; j++) {
      let d = 0; for (let q = 0; q < D; q++) d += (secVec[i][q] - secVec[j][q]) ** 2;
      d = Math.sqrt(d / D);
      if (d < bd) { bd = d; bestK = sections[j].k; }
    }
    sections[i].k = bd < 0.35 ? bestK : nextK++;
  }
  prog(0.9);

  // --- assemble onsets
  let outOnsets = onsets.map((o) => ({
    t: Math.max(0, Math.round(o.r.ff * frameMs - ONSET_LAG_MS)),
    s: Math.round(o.s * 1000) / 1000,
    b: o.r.band,
    p: Math.round(o.p * 1000) / 1000,
    d: Math.round(o.d),
  }));
  if (fillGaps) outOnsets = fillGapOnsets(outOnsets, beatsMs, downbeats, heard, n, frameMs, energy);
  outOnsets.sort((a, b) => a.t - b.t);
  const coverage = heardCount / n;
  prog(1);
  return {
    v: 1, key, source, created: Date.now(), durMs: Math.round(durMs),
    bpm: Math.round(bpm * 100) / 100,
    beats: beatsMs, downbeats,
    onsets: outOnsets,
    energy: energy.map((x) => Math.round(x * 1000) / 1000),
    sections,
    quality: Math.round(quality * 100) / 100,
    tempoConf: Math.round(tempo.conf * 100) / 100,
    coverage: Math.round(coverage * 1000) / 1000,
  };
}

/** Unheard spans (LiveLearner gaps): plausible onsets on the extrapolated beat grid so charts stay playable. */
function fillGapOnsets(onsets, beats, downbeats, heard, n, frameMs, energy) {
  const isDown = new Set(downbeats);
  const out = onsets.slice();
  const heardAt = (t) => { const f = Math.round(t / frameMs); return f >= 0 && f < n && heard[f]; };
  for (let i = 0; i < beats.length; i++) {
    const t = beats[i];
    if (heardAt(t)) continue;
    // a gap only if the whole beat neighbourhood is unheard
    if (heardAt(t - 120) || heardAt(t + 120)) continue;
    const e = energy[Math.min(energy.length - 1, Math.floor(t / 250))] ?? 0.5;
    const down = isDown.has(i);
    out.push({ t, s: Math.round((down ? 0.55 : 0.4) * (0.6 + 0.4 * e) * 1000) / 1000, b: down || i % 2 === 0 ? 0 : 1, p: down ? 0.25 : i % 2 ? 0.55 : 0.4, d: 0 });
    if (i + 1 < beats.length && e > 0.6) {
      const h = Math.round((t + beats[i + 1]) / 2);
      if (!heardAt(h)) out.push({ t: h, s: 0.2, b: 2, p: 0.8, d: 0 });
    }
  }
  return out;
}
