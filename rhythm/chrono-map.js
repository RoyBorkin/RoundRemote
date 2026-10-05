// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Chrono Ring: chart (rhythm/chart.js) → positions on the ring and note kinds. Pure, deterministic (same chart +
// difficulty + seed → same layout), no DOM — the game (rhythm/chrono.js) draws and judges what this returns.
//
//   layoutRing(notes, { difficulty, seed, bpm }) mutates `notes` IN PLACE (the kit keeps a reference to the array):
//     removes chord notes the ring can't use, and gives every note
//       deg   angle in degrees (0 = 12 o'clock, clockwise)      a   the same in radians
//       kind  'tap' | 'hold' | 'chain' (slide dot) | 'flick'
//       head  (chain) first dot of a slide      next  (chain) the following dot      chainId
//       pair  the other note of a two-hand double (same time, opposite side)
//
// Movement follows the melody: the chart's lane steps (pitch contour, seeded) turn into steps round the ring,
// so a rising line turns one way and a falling line the other, and the walk drifts round the whole ring.
// Jumps are limited by the time to the next note; new phrases may jump further. Nothing lands under the
// pause button at the top except on Easy (whose top position the game frees by moving the pause button).

/** Per difficulty: positions (n; 0 = continuous), their offset, travel time ms, angular tolerance °, extras. */
export const RING = [
  { n: 4, off: 0, travel: 2300, tol: 44, chords: false, slides: false, flicks: false },
  { n: 6, off: 30, travel: 1900, tol: 32, chords: false, slides: false, flicks: false },
  { n: 8, off: 22.5, travel: 1550, tol: 26, chords: true, slides: true, slideMin: 4, slideEvery: 8, slideStep: 22.5, slideP: 0.55, flicks: false },
  { n: 12, off: 15, travel: 1250, tol: 20, chords: true, slides: true, slideMin: 3, slideEvery: 4, slideStep: 20, slideP: 0.6, flicks: false },
  { n: 0, off: 0, travel: 1000, tol: 22, chords: true, slides: true, slideMin: 3, slideEvery: 4, slideStep: 17, slideP: 0.65, flicks: true },
];
/** No notes this close (°) to 12 o'clock (the pause button), except Easy. */
export const TOP_GAP = 14;

const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2d); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
const norm = (d) => ((d % 360) + 360) % 360;
/** Shortest signed difference b − a in degrees (−180…180]. */
export const dDeg = (a, b) => { let d = norm(b - a); if (d > 180) d -= 360; return d; };
/** Largest angular jump (°) a player can make in gapMs. */
export const maxJump = (gapMs) => Math.min(180, 30 + gapMs * 0.3);

export function layoutRing(notes, { difficulty = 1, seed = 1, bpm = 120 } = {}) {
  const D = Math.max(0, Math.min(4, difficulty | 0));
  const C = RING[D];
  const cont = C.n === 0;
  const span = cont ? 22.5 : 360 / C.n;
  const beatMs = 60000 / (bpm || 120);
  const H = (i, k) => hash(seed * 7717 + D * 131 + k, i);
  const topOK = D === 0;
  const inTop = (deg) => !topOK && Math.abs(dDeg(0, deg)) < TOP_GAP;

  // ---- doubles: at most two notes at a time, and only where the difficulty has them
  const byT = new Map();
  for (const n of notes) { const g = byT.get(n.t); if (g) g.push(n); else byT.set(n.t, [n]); }
  const drop = new Set();
  const holdEnds = [];   // [t, end] of holds, to keep doubles off running holds
  for (const n of notes) if (n.dur > 0) holdEnds.push([n.t, n.t + n.dur]);
  const holdRunning = (t) => holdEnds.some(([a, b]) => a < t - 1 && b > t - 60);
  for (const g of byT.values()) {
    if (g.length < 2) continue;
    // keep the main note (a hold if there is one), maybe one partner
    g.sort((a, b) => (b.dur > 0) - (a.dur > 0) || a.lane - b.lane);
    const keep = C.chords && !holdRunning(g[0].t) ? 2 : 1;
    for (let i = keep; i < g.length; i++) drop.add(g[i]);
    if (keep === 2 && g[1].dur > 0 && g[0].dur > 0) g[1].dur = 0;   // never two holds at once
  }
  if (drop.size) { let w = 0; for (const n of notes) if (!drop.has(n)) notes[w++] = n; notes.length = w; }
  for (const n of notes) { n.chord = false; n.pair = null; }
  const mains = [];
  { const seen = new Map(); for (const n of notes) { const o = seen.get(n.t); if (o) { o.pair = n; n.pair = o; } else { seen.set(n.t, n); mains.push(n); } } }

  // ---- slides: fast runs of single notes become a chain of dots to drag along the ring
  const chainOf = new Map();   // main index → { id, k, len, dir }
  if (C.slides) {
    let lastStartB = -1e9, id = 0;
    let i = 0;
    while (i < mains.length) {
      let j = i;
      const ok = (m) => !m.pair && !(m.dur > 0) && !holdRunning(m.t);
      if (!ok(mains[i])) { i++; continue; }
      while (j + 1 < mains.length && ok(mains[j + 1]) && mains[j + 1].beat - mains[j].beat <= 0.51 && mains[j + 1].t - mains[j].t <= Math.max(330, beatMs * 0.51)) j++;
      let len = j - i + 1;
      if (len >= C.slideMin) {
        len = Math.min(len, 8);
        const startB = mains[i].beat;
        if (startB - lastStartB >= C.slideEvery && H(i, 1) < C.slideP) {
          let s = 0; for (let k = i + 1; k < i + len; k++) s += Math.sign(mains[k].lane - mains[k - 1].lane);
          const dir = s ? Math.sign(s) : (H(i, 2) < 0.5 ? -1 : 1);
          for (let k = 0; k < len; k++) chainOf.set(i + k, { id, k, len, dir });
          id++; lastStartB = startB;
          i += len; continue;
        }
      }
      i = j + 1;
    }
  }

  // ---- the walk
  let pos = 0, deg = 0;          // grid index / degrees of the previous note
  let prev = null, flowDir = H(0, 3) < 0.5 ? -1 : 1, lastFlickB = -1e9;
  const gridDeg = (p) => norm(C.off + p * span);
  const snapIdx = (d) => Math.round(norm(d - C.off) / span) % C.n;
  const active = [];             // holds still running: { end, deg }
  const blocked = (d, t) => active.some((h) => h.end > t - 40 && Math.abs(dDeg(h.deg, d)) < C.tol * 1.5);
  let chainHeadDeg = 0, chainDir = 1;
  const pick = (want, t, lim) => {
    const st = cont ? 7.5 : span;
    const base = cont ? norm(Math.round(want / 7.5) * 7.5) : gridDeg(snapIdx(want));
    const towards = prev && dDeg(deg, base) > 0 ? -1 : 1;   // when moving, try shorter jumps first
    for (let k = 0; k <= 360 / st; k++) {
      for (const sg of k ? [towards, -towards] : [1]) {
        const c = norm(base + sg * k * st);
        if (inTop(c) || blocked(c, t) || (prev && Math.abs(dDeg(deg, c)) > lim + 0.01)) continue;
        return c;
      }
    }
    return deg;
  };
  for (let i = 0; i < mains.length; i++) {
    const n = mains[i];
    for (let k = active.length - 1; k >= 0; k--) if (active[k].end < n.t - 40) active.splice(k, 1);
    const gapMs = prev ? n.t - prev.t : 1e9;
    const gapB = prev ? n.beat - prev.beat : 99;
    const dL = prev ? n.lane - prev.lane : 0;
    const dp = prev ? Math.abs((n.p ?? 0.5) - (prev.p ?? 0.5)) : 0;
    const ch = chainOf.get(i);
    let d;
    if (ch && ch.k > 0) {
      d = norm(chainHeadDeg + chainDir * ch.k * C.slideStep);
    } else {
      const lim = maxJump(gapMs);
      if (!prev) {
        d = cont ? 180 : gridDeg(snapIdx(180 + (H(i, 4) < 0.5 ? -1 : 1) * span * 0.5));
      } else if (gapB >= 2.5) {
        // a new phrase: jump somewhere fresh (seeded), and maybe turn the flow round
        if (H(i, 5) < 0.5) flowDir = -flowDir;
        const sgn = H(i, 6) < 0.5 ? -1 : 1;
        if (cont) d = deg + sgn * (45 + Math.round(H(i, 7) * 12) * 7.5);
        else { const steps = 1 + Math.floor(H(i, 7) * Math.max(1, C.n / 2)); d = gridDeg(pos + sgn * Math.min(steps, Math.floor(lim / span) || 1)); }
      } else if (dL === 0) {
        // the same pitch again: a repeat on the spot, or (Master) a step in the flow's direction
        d = cont && H(i, 8) < 0.55 ? deg + flowDir * 15 : deg;
      } else {
        const dir = Math.sign(dL);
        const big = Math.abs(dL) >= 2;
        if (cont) {
          const mag = big ? 52.5 + 37.5 * Math.min(1, dp * 3) : 15 + 22.5 * Math.min(1, dp * 4);
          d = deg + dir * Math.min(lim, Math.round(mag / 7.5) * 7.5);
          if (dir === flowDir) d += dir * 7.5;   // the flow carries the melody a little further round
        } else {
          let steps;
          if (D === 0) steps = big && gapB >= 1.5 ? 2 : 1;
          else if (D === 1) steps = big ? 2 : 1;
          else if (D === 2) steps = big ? (dp > 0.2 && gapB >= 1 ? 3 : 2) : 1;
          else steps = big ? (gapB >= 1 ? 4 : 3) : (dp > 0.08 && gapB >= 0.5 ? 2 : 1);
          steps = Math.max(1, Math.min(steps, Math.floor(lim / span)));
          d = gridDeg(pos + dir * steps);
        }
      }
      // the nearest free spot to where the melody wants to go: reachable in time, not under a finger that is
      // holding a hold, not under the pause button at the top (Medium…Expert grids leave the top free anyway)
      d = pick(d, n.t, prev ? lim : 360);
      if (ch) {
        // a slide starts here; it must not cross the top
        chainHeadDeg = d; chainDir = ch.dir;
        const crosses = (dir) => { for (let k = 1; k < ch.len; k++) if (inTop(d + dir * k * C.slideStep)) return true; return false; };
        if (crosses(chainDir)) chainDir = -chainDir;
        if (crosses(chainDir)) chainDir = 0;   // (cannot happen with ≤ 8 dots; keep it safe)
      }
    }
    if (!cont && !(ch && ch.k > 0)) pos = snapIdx(d);
    n.deg = d; deg = d;
    if (ch && ch.k === ch.len - 1 && !cont) pos = snapIdx(d);
    // kind
    if (ch) { n.kind = 'chain'; n.chainId = ch.id; n.head = ch.k === 0; n.dur = 0; if (ch.k > 0) mains[i - 1].next = n; }
    else if (n.dur > 0) { n.kind = 'hold'; active.push({ end: n.t + n.dur, deg: d }); }
    else n.kind = 'tap';
    if (C.flicks && n.kind === 'tap' && !n.pair && n.s >= 0.4 && Math.abs(n.beat - Math.round(n.beat)) < 0.02 && gapB >= 0.5 && n.beat - lastFlickB >= 4) {
      const nx = mains[i + 1];
      if ((!nx || nx.beat - n.beat >= 0.5) && H(i, 9) < 0.6) { n.kind = 'flick'; lastFlickB = n.beat; }
    }
    // the double's other note: the opposite side (both hands)
    if (n.pair) {
      const m = n.pair;
      let od = norm(d + 180);
      if (inTop(od)) od = norm(od + (dDeg(0, od) >= 0 ? 1 : -1) * (cont ? 30 : span));
      m.deg = od; m.kind = m.dur > 0 ? 'hold' : 'tap';
      if (m.kind === 'hold') active.push({ end: m.t + m.dur, deg: od });
    }
    prev = n;
  }
  for (const n of notes) { n.a = (n.deg * Math.PI) / 180; n.kind ||= 'tap'; }
  return notes;
}

/** Stats for tests: counts per kind, top-zone hits and reachability violations. */
export function ringStats(notes, difficulty) {
  const C = RING[difficulty];
  const k = { tap: 0, hold: 0, chain: 0, flick: 0, pairs: 0, top: 0, far: 0, maxJumpSeen: 0 };
  let prev = null;
  for (const n of notes) {
    k[n.kind]++;
    if (n.pair && n.pair.t === n.t && n.pair.deg !== n.deg && n === n.pair.pair && n.pair !== prev) k.pairs += 0.5;
    if (difficulty > 0 && Math.abs(dDeg(0, n.deg)) < TOP_GAP) k.top++;
    if (prev && n.t > prev.t && !n.pair && !prev.pair) {
      const j = Math.abs(dDeg(prev.deg, n.deg));
      k.maxJumpSeen = Math.max(k.maxJumpSeen, j);
      if (j > maxJump(n.t - prev.t) + 0.01 && n.kind !== 'chain') k.far++;
    }
    prev = n;
  }
  k.tol = C.tol;
  return k;
}
