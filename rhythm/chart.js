// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Analysis → note chart (deterministic). See RHYTHM_GUIDE.md "chart.js".
//   makeChart(analysis, { lanes, difficulty 0..4, seed, holds, chords, leadMs, authored })
//   → { notes: [{ t, lane, dur, s, b, p, beat, chord }], bpm, beats, durMs, difficulty, seed, lanes }
// An Analysis from the chart library (source 'chart') carries `authored` note charts per difficulty: with
// `authored` (default: only when lanes === 5) those are used as written instead of generating from the onsets.
// Musical rules: onsets are quantised to the beat grid (per-difficulty divisions), chosen by strength × metric
// weight with per-difficulty density targets scaled by section energy (choruses denser), minimum gaps,
// lanes follow the pitch contour (p) with seeded variation, repeated sections reuse their lane motif,
// chords only on strong (down)beats, holds from sustained onsets. The seed changes lanes and the secondary
// note choices; the rhythmic skeleton (strong notes) stays.

export const DIFFICULTIES = [
  { id: 'easy', name: 'Easy' }, { id: 'medium', name: 'Medium' }, { id: 'hard', name: 'Hard' },
  { id: 'expert', name: 'Expert' }, { id: 'master', name: 'Master' },
];

const CFG = [
  // div: allowed grid divisions per beat (coarse first); nps: density range; gap: min gap (beats, ms)
  { div: [1, 2], nps: [0.8, 1.5], gapB: 0.5, gapMs: 330, chord: 1, chordS: 2, holdB: 1.5, holdMax: 4, jack: 0, halfS: 0.55 },
  { div: [1, 2], nps: [1.5, 2.5], gapB: 0.5, gapMs: 220, chord: 2, chordS: 0.85, holdB: 1.25, holdMax: 4, jack: 0, chordEvery: 32 },
  { div: [1, 2, 4], nps: [2.5, 4], gapB: 0.25, gapMs: 140, chord: 2, chordS: 0.72, holdB: 1, holdMax: 4, jack: 1, chordEvery: 16 },
  { div: [1, 2, 4, 3], nps: [4, 6], gapB: 0.25, gapMs: 100, chord: 2, chordS: 0.62, holdB: 0.75, holdMax: 6, jack: 2, chordEvery: 8 },
  { div: [1, 2, 4, 8, 3, 6], nps: [6, 9], gapB: 0.125, gapMs: 70, chord: 3, chordS: 0.5, holdB: 0.75, holdMax: 8, jack: 2, chordEvery: 4 },
];
const HOLD_SHARE = [0.06, 0.08, 0.11, 0.14, 0.16];
const FINGERS = [1, 2, 2, 2, 3];          // max simultaneous presses (holds + taps)
const METRIC = { 1: 0.82, 2: 0.62, 4: 0.46, 8: 0.32, 3: 0.4, 6: 0.3 };

function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const hash2 = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2d); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };

/** Beat grid helpers over a (possibly drifting) beat list. */
function grid(beats, bpm) {
  const B = beats && beats.length >= 2 ? beats : [0, 60000 / (bpm || 120)];
  const n = B.length;
  const p0 = B[1] - B[0], p1 = B[n - 1] - B[n - 2];
  const toBeat = (t) => {
    if (t <= B[0]) return (t - B[0]) / p0;
    if (t >= B[n - 1]) return n - 1 + (t - B[n - 1]) / p1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m] <= t) lo = m; else hi = m; }
    return lo + (t - B[lo]) / (B[hi] - B[lo]);
  };
  const toTime = (b) => {
    if (b <= 0) return B[0] + b * p0;
    if (b >= n - 1) return B[n - 1] + (b - n + 1) * p1;
    const i = Math.floor(b), f = b - i;
    return B[i] + f * (B[i + 1] - B[i]);
  };
  const periodAt = (b) => { const i = clamp(Math.floor(b), 0, n - 2); return B[i + 1] - B[i]; };
  return { toBeat, toTime, periodAt, n };
}

export function makeChart(analysis, { lanes = 4, difficulty = 1, seed = 1, holds = true, chords = true, leadMs = 1800, authored } = {}) {
  const A = analysis || {};
  lanes = Math.max(1, Math.round(lanes));
  const diff = clamp(Math.round(difficulty), 0, 4);
  // a chart from the chart library carries the charter's own notes per difficulty: use them as written (5 lanes)
  // or folded onto fewer lanes. authored: true | false | undefined (= only with 5 lanes)
  const auth = A.authored?.[AUTHORED_OF[diff]];
  if (auth?.length && (authored ?? lanes === 5)) return authoredChart(A, auth, { lanes, diff, seed: Math.round(seed) || 1, holds, chords, leadMs });
  const C = CFG[diff];
  seed = Math.round(seed) || 1;
  const rnd = prng(seed * 7919 + diff * 104729 + lanes * 31);
  const bpm = A.bpm || 120;
  const beats = A.beats && A.beats.length >= 2 ? A.beats : (() => { const out = [], per = 60000 / bpm; for (let t = 0; t < (A.durMs || 180000); t += per) out.push(Math.round(t)); return out; })();
  const G = grid(beats, bpm);
  const durMs = A.durMs || beats[beats.length - 1] || 180000;
  const downSet = new Set(A.downbeats || []);
  const barStartOf = (bi) => { // beat index of the bar containing beat bi
    for (let k = bi; k > bi - 8; k--) if (downSet.has(k)) return k;
    return bi - (((bi % 4) + 4) % 4);
  };
  // ---- sections & energy
  const secs = (A.sections && A.sections.length ? A.sections : [{ t: 0, e: 0.6 }]).map((s, i) => ({ ...s, i, k: s.k ?? i }));
  const eVals = secs.map((s) => s.e ?? 0.6);
  const eMin = Math.min(...eVals), eMax = Math.max(...eVals);
  const secAt = (t) => { let s = secs[0]; for (const x of secs) if (x.t <= t) s = x; return s; };
  const energy = A.energy || [];
  const localE = (t0, t1) => {
    if (!energy.length) return 0.6;
    let s = 0, c = 0;
    for (let b = Math.max(0, Math.floor(t0 / 250)); b < Math.min(energy.length, Math.ceil(t1 / 250)); b++) { s += energy[b]; c++; }
    return c ? s / c : 0.6;
  };

  // ---- quantise onsets
  const cand = new Map(); // key: quantised beat (×24 integer) → candidate
  for (const o of A.onsets || []) {
    if (o.t < leadMs - 30 || o.t > durMs) continue;
    const bp = G.toBeat(o.t);
    const pms = G.periodAt(bp);
    let best = null;
    for (const dv of C.div) {
      const q = Math.round(bp * dv) / dv;
      const errMs = Math.abs(q - bp) * pms;
      const tol = Math.min(70, Math.max(22, (pms / dv) * 0.3));
      if (dv === 3 || dv === 6) { // triplets only when the binary grid does not fit
        if (best && best.errMs <= tol * 0.6) continue;
      }
      if (errMs <= tol && (!best || (dv === 3 || dv === 6 ? errMs < best.errMs * 0.6 : errMs < best.errMs - 6))) best = { q, dv, errMs };
      if (best && best.dv === dv && errMs < 12) break;  // coarse grid already fits well
    }
    if (!best) continue;
    if (diff === 0 && best.dv === 2 && o.s < C.halfS) continue;
    const key = Math.round(best.q * 24);
    const prev = cand.get(key);
    if (!prev || o.s > prev.s) cand.set(key, { q: best.q, dv: best.dv, s: Math.max(o.s, prev ? prev.s : 0), b: o.b, p: o.p, d: Math.max(o.d || 0, prev ? prev.d : 0) });
    else { prev.s = Math.min(1, prev.s + 0.1 * o.s); prev.d = Math.max(prev.d, o.d || 0); }
  }
  let list = [...cand.values()].sort((a, b) => a.q - b.q);
  for (const c of list) {
    c.t = Math.round(G.toTime(c.q));
    const bi = Math.round(c.q);
    let w = METRIC[c.dv] ?? 0.4;
    if (c.dv === 1) w = downSet.has(bi) ? 1 : ((bi - barStartOf(bi)) % 2 === 0 ? 0.9 : 0.8);
    c.w = w;
    const core = c.s * (0.5 + 0.5 * w);
    // seed only reshuffles the secondary choices (weak notes)
    c.pri = core + (rnd() - 0.5) * 0.16 * (1 - c.s) * (core < 0.6 ? 1 : 0.2);
  }
  list = list.filter((c) => c.t >= leadMs && c.t <= durMs);

  // ---- choose notes per 4-bar window with a density target
  const picked = [];
  const minGapAt = (b) => Math.max(C.gapB * G.periodAt(b), C.gapMs);
  const pickedSorted = []; // times, kept sorted
  const okGap = (c) => {
    const g = minGapAt(c.q) - 1;
    let lo = 0, hi = pickedSorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pickedSorted[m] < c.t) lo = m + 1; else hi = m; }
    if (lo < pickedSorted.length && pickedSorted[lo] - c.t < g) return false;
    if (lo > 0 && c.t - pickedSorted[lo - 1] < g) return false;
    return true;
  };
  const insertT = (t) => { let lo = 0, hi = pickedSorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (pickedSorted[m] < t) lo = m + 1; else hi = m; } pickedSorted.splice(lo, 0, t); };
  const W = 16; // beats per window
  const firstB = Math.floor(G.toBeat(leadMs) / W) * W;
  const lastB = G.toBeat(durMs);
  let li = 0;
  for (let wb = firstB; wb < lastB; wb += W) {
    const t0 = G.toTime(wb), t1 = G.toTime(wb + W);
    const inWin = [];
    while (li < list.length && list[li].q < wb + W) { if (list[li].q >= wb) inWin.push(list[li]); li++; }
    if (!inWin.length) continue;
    const sec = secAt((t0 + t1) / 2);
    const eSec = eMax > eMin ? (sec.e - eMin) / (eMax - eMin) : 0.6;
    const eLoc = localE(t0, t1);
    const eN = clamp(0.6 * eSec + 0.4 * eLoc, 0, 1);
    const nps = C.nps[0] + (C.nps[1] - C.nps[0]) * eN;
    const quiet = eLoc < 0.12 ? 0.3 : 1;
    const target = Math.max(1, Math.round((nps * (t1 - t0)) / 1000 * quiet));
    inWin.sort((a, b) => b.pri - a.pri);
    let n = 0;
    for (const c of inWin) {
      if (n >= target) break;
      if (c.s < 0.04) continue;
      if (!okGap(c)) continue;
      picked.push(c); insertT(c.t); n++;
    }
  }
  picked.sort((a, b) => a.t - b.t);

  // ---- lanes: follow the pitch contour. Pitch is normalised over a local window (±3 beats) so a melody
  //      moving inside a few semitones still travels across the lanes; seeded mirror / spread per section;
  //      repeated sections (same label k) reuse the lane motif of their first occurrence.
  const L = lanes - 1;
  const loc = new Float32Array(picked.length);
  for (let i = 0, a = 0, z = 0; i < picked.length; i++) {
    const c = picked[i], wMs = 3 * G.periodAt(c.q);
    while (picked[a].t < c.t - wMs) a++;
    if (z < i) z = i;
    while (z + 1 < picked.length && picked[z + 1].t <= c.t + wMs) z++;
    let lo = 1, hi = 0;
    for (let k = a; k <= z; k++) { const p = picked[k].p; if (p < lo) lo = p; if (p > hi) hi = p; }
    loc[i] = hi - lo > 0.03 ? (c.p - lo) / (hi - lo) : 0.5;
  }
  // holds: the most sustained (and strongest) notes, limited to a share of the chart per difficulty
  if (holds) {
    const hc = picked.filter((c) => c.d > 0 && c.d / G.periodAt(c.q) >= C.holdB);
    hc.sort((a, b) => (b.d / G.periodAt(b.q)) * (0.5 + b.s) - (a.d / G.periodAt(a.q)) * (0.5 + a.s));
    const k = Math.round(HOLD_SHARE[diff] * picked.length);
    for (let i = 0; i < Math.min(k, hc.length); i++) hc[i].holdOK = true;
  }
  const mirror = new Map(), spread = new Map();
  for (const s of secs) { mirror.set(s.i, hash2(seed * 13 + 7, s.k) < 0.5); spread.set(s.i, 0.75 + 0.25 * hash2(seed * 17 + 3, s.k)); }
  const motif = new Map(); // `${k}:${relBeat×24}` → lane (first occurrence of a section label)
  const holdUntil = new Float64Array(lanes); // lane busy with a hold until (ms)
  const notes = [];
  let prevLane = Math.round(L / 2), prevP = 0.5, prevT = -1e9, run = 0;
  const free = (lane, t) => holdUntil[lane] <= t - 1;
  for (let i = 0; i < picked.length; i++) {
    const c = picked[i];
    if (c.skip) continue;
    const sec = secAt(c.t);
    const pBeat = G.periodAt(c.q);
    const gapB = (c.t - prevT) / pBeat;
    const mir = mirror.get(sec.i);
    const x = mir ? 1 - loc[i] : loc[i];
    const target = clamp(L / 2 + (x - 0.5) * L * spread.get(sec.i) * 1.15, 0, L);
    let lane;
    const relKey = `${sec.k}:${Math.round((c.q - G.toBeat(sec.t)) * 24)}`;
    if (lanes === 1) lane = 0;
    else if (motif.has(relKey) && motif.get(relKey).sec !== sec.i) lane = motif.get(relKey).lane;
    else if (gapB > 3 || i === 0) lane = Math.round(target);
    else {
      let dp = c.p - prevP;
      if (mir) dp = -dp;
      const want = Math.round(target);
      if (Math.abs(dp) < 0.012) {
        // repeated pitch: stay (jack) where allowed, else step towards the target / alternate
        const allowJack = C.jack === 2 ? run < 2 : C.jack === 1 ? gapB >= 0.5 && run < 1 : false;
        if (allowJack && hash2(seed, i) < 0.4) lane = prevLane;
        else {
          // same pitch: the sound decides — low hits lean left, bright hits lean right (mirrored with the section)
          let dir = c.b === 0 ? -1 : c.b === 2 ? 1 : want > prevLane ? 1 : want < prevLane ? -1 : (hash2(seed + 1, i) < 0.5 ? -1 : 1);
          if (mir && c.b !== 1) dir = -dir;
          if (prevLane + dir < 0 || prevLane + dir > L) dir = -dir;
          lane = prevLane + dir;
        }
      } else {
        const dir = Math.sign(dp);
        const maxStep = lanes >= 5 && gapB >= 0.5 ? 2 : lanes >= 4 && gapB >= 1 ? 2 : 1;
        // move in the melody's direction: to the target lane if it lies that way, at least one lane
        if ((want - prevLane) * dir >= 1) lane = prevLane + dir * Math.min(maxStep, Math.abs(want - prevLane));
        else lane = prevLane + dir;
      }
      if (lane < 0) lane = Math.min(L, 1);
      if (lane > L) lane = Math.max(0, L - 1);
    }
    lane = clamp(Math.round(lane), 0, L);
    // jacks on low difficulties / after a run
    if (lanes > 1 && lane === prevLane && (C.jack === 0 || (C.jack === 1 && gapB < 0.5) || run >= 2)) lane = lane === L ? lane - 1 : lane === 0 ? 1 : lane + (hash2(seed + 2, i) < 0.5 ? -1 : 1);
    // lanes held by a hold note are not available
    if (!free(lane, c.t)) {
      let best = -1, bd = 99;
      for (let k = 0; k < lanes; k++) if (free(k, c.t) && Math.abs(k - lane) < bd && k !== prevLane) { bd = Math.abs(k - lane); best = k; }
      if (best < 0) for (let k = 0; k < lanes; k++) if (free(k, c.t)) { best = k; break; }
      if (best < 0) continue;            // every lane held: skip the note
      lane = best;
    }
    // fingers: holds still running + this note must fit the difficulty's limit, else end the oldest hold early
    {
      const active = [];
      for (let k = notes.length - 1; k >= 0 && c.t - notes[k].t < 20000; k--) { const m = notes[k]; if (m.dur > 0 && m.t + m.dur > c.t - 1 && m.lane !== lane) active.push(m); }
      active.sort((a, b) => a.t - b.t);
      while (active.length + 1 > FINGERS[diff] && active.length) {
        const m = active.shift(), g = minGapAt(c.q);
        const nd = c.t - g - m.t;
        m.dur = nd >= 350 ? Math.round(nd) : 0;
        holdUntil[m.lane] = m.t + Math.max(1, m.dur) + (m.dur ? g : 0);
      }
    }
    if (!motif.has(relKey)) motif.set(relKey, { lane, sec: sec.i });
    run = lane === prevLane ? run + 1 : 0;
    const note = { t: c.t, lane, dur: 0, s: Math.round(c.s * 1000) / 1000, b: c.b, p: c.p, beat: Math.round(c.q * 1000) / 1000, chord: false, _c: c };
    // hold?
    if (holds && c.holdOK) {
      const dB = c.d / pBeat;
      if (dB >= C.holdB) {
        const snap = diff <= 1 ? 2 : 4;
        let endB = Math.round((c.q + Math.min(dB, C.holdMax)) * snap) / snap;
        // easy / medium: one finger — the hold ends before the next note, unless at most two weaker notes
        // lie under it (they make way for a long hold)
        if (diff <= 1) {
          const gapQ = Math.max(C.gapB, C.gapMs / pBeat);
          const under = [];
          for (let j = i + 1; j < picked.length && picked[j].q < endB + gapQ; j++) under.push(picked[j]);
          if (under.length && (under.length > 2 || under.some((u) => u.s > c.s + 0.05))) endB = Math.min(endB, Math.floor((under[0].q - gapQ) * snap) / snap);
          else for (const u of under) u.skip = true;
        }
        const durH = G.toTime(endB) - c.t;
        if (endB - c.q >= Math.min(C.holdB, 1) && durH >= 350) { note.dur = Math.round(durH); holdUntil[lane] = c.t + durH + minGapAt(endB); }
      }
    }
    if (note.dur === 0) holdUntil[lane] = Math.max(holdUntil[lane], c.t + 1);
    notes.push(note);
    prevLane = lane; prevP = c.p; prevT = c.t;
  }

  // ---- chords: strong (down)beats in energetic sections, limited rate
  if (chords && C.chord > 1 && lanes >= 3) {
    let lastChordB = -1e9;
    const baseN = notes.slice(), added = [];
    for (let i = 0; i < baseN.length; i++) {
      const n = baseN[i], c = n._c;
      if (c.dv !== 1) continue;
      const bi = Math.round(c.q);
      const strongBeat = downSet.has(bi) || (diff >= 4 && (bi - barStartOf(bi)) % 2 === 0);
      if (!strongBeat || n.s < C.chordS || c.q - lastChordB < C.chordEvery - 0.01) continue;
      const sec = secAt(n.t);
      const eSec = eMax > eMin ? (sec.e - eMin) / (eMax - eMin) : 0.6;
      if (eSec < 0.45 && diff < 4) continue;
      // a hold in progress counts as a finger
      const used = new Set([n.lane]);
      for (let j = i - 1; j >= 0 && n.t - baseN[j].t < 9000; j--) { const m = baseN[j]; if (m.dur > 0 && m.t + m.dur > n.t - 1) used.add(m.lane); }
      const size = Math.min(C.chord, n.s >= 0.85 && diff >= 4 ? 3 : 2, lanes - 1) - (used.size - 1);
      if (size < 2) continue;
      const prev = baseN[i - 1], next = baseN[i + 1];
      const extra = [];
      for (let k = 1; k < size; k++) {
        const order = [];
        for (let d = 2; d <= lanes; d++) for (const sgn of [1, -1]) order.push(n.lane + sgn * (d === 2 ? 2 : d === 3 ? 1 : d));
        let lane = -1;
        for (const cand of order) {
          if (cand < 0 || cand >= lanes || used.has(cand)) continue;
          if (next && next.lane === cand && next.t - n.t < minGapAt(c.q) * 2) continue; // avoid instant jack after the chord
          if (prev && prev.lane === cand && n.t - prev.t < minGapAt(c.q) * 2) continue;
          lane = cand; break;
        }
        if (lane < 0) break;
        used.add(lane);
        extra.push({ t: n.t, lane, dur: 0, s: n.s, b: n.b, p: n.p, beat: n.beat, chord: true });
      }
      if (extra.length) { n.chord = true; added.push(...extra); lastChordB = c.q; }
    }
    notes.push(...added);
  }
  for (const n of notes) delete n._c;
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  return { notes, bpm, beats: beats.slice(), durMs, difficulty: diff, seed, lanes };
}

// ---------------------------------------------------------------- authored charts (rhythm/charts-data.js)
const AUTHORED_OF = ['easy', 'medium', 'hard', 'expert', 'expert'];   // Master plays the Expert chart
/**
 * The charter's notes ({ t, lane 0–4, dur }) as a chart for `lanes` lanes. Fewer than 5 lanes: a sliding "hand
 * position" keeps the shape of every phrase (G R Y B O on 4 lanes moves the window up when orange comes, back down
 * for green). Even seeds (New version) mirror the lanes. chords: false keeps the top note; holds: false drops sustains.
 */
function authoredChart(A, auth, { lanes, diff, seed, holds, chords, leadMs }) {
  const bpm = A.bpm || 120;
  const beats = A.beats && A.beats.length >= 2 ? A.beats : (() => { const out = [], per = 60000 / bpm; for (let t = 0; t < (A.durMs || 180000); t += per) out.push(Math.round(t)); return out; })();
  const G = grid(beats, bpm);
  const durMs = A.durMs || beats[beats.length - 1] || 180000;
  const L = lanes - 1;
  const mirror = seed > 1 && seed % 2 === 0;
  const groups = [];
  for (const n of auth) {
    if (n.t < leadMs - 30 || n.t > durMs) continue;
    const g = groups[groups.length - 1];
    if (g && g.t === n.t) g.n.push(n); else groups.push({ t: n.t, n: [n] });
  }
  const notes = [];
  const holdUntil = new Float64Array(Math.max(lanes, 5)).fill(-1);
  const holdNote = [];
  let sh = 0;   // hand position: authored lane − shown lane
  for (const g of groups) {
    let src = g.n;
    if (!chords && src.length > 1) src = [src.reduce((a, b) => (b.lane > a.lane ? b : a))];
    let ls = src.map((n) => n.lane);
    if (mirror) ls = ls.map((l) => 4 - l);
    if (lanes >= 5) sh = 0;
    else if (lanes >= 3) {
      const lo = Math.min(...ls), hi = Math.max(...ls);
      if (hi - sh > L) sh = hi - L;
      if (lo - sh < 0) sh = lo;
    }
    const used = new Set();
    src.forEach((n, i) => {
      let lane = lanes >= 3 ? clamp(ls[i] - sh, 0, L) : Math.round((ls[i] / 4) * L);
      if (used.has(lane)) { const alt = [lane + 1, lane - 1].find((k) => k >= 0 && k <= L && !used.has(k)); if (alt == null) return; lane = alt; }
      used.add(lane);
      // a lane still held by a sustain (after folding): end that hold a little before this note
      if (holdUntil[lane] > g.t - 60 && holdNote[lane]) {
        const m = holdNote[lane], nd = g.t - 120 - m.t;
        m.dur = nd >= 300 ? Math.round(nd) : 0;
        holdUntil[lane] = -1;
      }
      const dur = holds && n.dur > 0 ? Math.round(n.dur) : 0;
      const q = G.toBeat(g.t);
      const note = { t: Math.round(g.t), lane, dur, s: src.length > 1 ? 0.9 : 0.7, b: 1, p: L ? lane / L : 0.5, beat: Math.round(q * 1000) / 1000, chord: false };
      if (dur) { holdUntil[lane] = g.t + dur; holdNote[lane] = note; }
      notes.push(note);
    });
  }
  // chord flags
  for (let i = 0; i < notes.length; i++) if ((i > 0 && notes[i - 1].t === notes[i].t) || (i + 1 < notes.length && notes[i + 1].t === notes[i].t)) notes[i].chord = true;
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  return { notes, bpm, beats: beats.slice(), durMs, difficulty: diff, seed, lanes, authored: true };
}

/** Quick stats (for tests / debug UIs). */
export function chartStats(chart) {
  const N = chart.notes, times = [...new Set(N.map((n) => n.t))].sort((a, b) => a - b);
  let minGap = Infinity; for (let i = 1; i < times.length; i++) minGap = Math.min(minGap, times[i] - times[i - 1]);
  const span = times.length > 1 ? (times[times.length - 1] - times[0]) / 1000 : 1;
  let jacks = 0; const byT = N.filter((n) => !n.chord);
  for (let i = 1; i < byT.length; i++) if (byT[i].lane === byT[i - 1].lane) jacks++;
  let maxSim = 0; const m = new Map(); for (const n of N) m.set(n.t, (m.get(n.t) || 0) + 1); for (const v of m.values()) maxSim = Math.max(maxSim, v);
  // fingers: presses at a time + holds still running then
  let fingers = 0; const holdsL = N.filter((n) => n.dur > 0);
  for (const [t, v] of m) { let h = 0; for (const x of holdsL) if (x.t < t && x.t + x.dur > t) h++; fingers = Math.max(fingers, v + h); }
  return { notes: N.length, nps: Math.round((times.length / span) * 100) / 100, chords: N.filter((n) => n.chord).length, holds: holdsL.length, minGap, jacks, maxSim, fingers };
}
