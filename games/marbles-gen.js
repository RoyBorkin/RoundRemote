// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Marble Chain — procedural levels. Every level gets a new random layout: where the shooter sits, a smooth
// track from an entry at the rim to the vortex (or two tracks, on Hard), all from a seeded RNG so a level can
// be rebuilt exactly. Pure geometry, no DOM — same coordinates as marbles-paths.js (centre 0,0 · radius of the
// round screen = 1 · y points down).
//
// How: a layout family builds a candidate (spiral around the shooter, meander of arcs with hairpins, a crown
// zig-zagging along the rim, rows of a serpentine, rows swinging in S-curves, or — for two
// tracks — one half-disc piece on each side of a centred shooter). The candidate is cut to a length picked
// from the difficulty's range and checked:
//   · every point inside RCHECK (marbles never touch the circle), ≥ CLEAR from the shooter, the score strip free
//   · no bend tighter than RHO_MIN, passes ≥ SPACING apart (this also rules out crossings), tracks apart too
//   · the entry near the rim, the vortex well away from it
//   · seen from the shooter, later parts of a track are not hidden behind earlier parts (which are full of
//     marbles by the time the head gets there) — so the dangerous end can always be reached
// Rejection sampling with an attempt and a time budget; when nothing passes, a classic track (turned / mirrored at
// random) or, for two tracks, a known-good pair of meanders is used.
import { PATHS, buildTable } from './marbles-paths.js';

const TAU = Math.PI * 2;
export const MR = 0.042, D = MR * 2;
export const RB = 0.845;          // the outermost a family puts a track centre
export const RCHECK = 0.858;      // … and the hard limit (marble edge stays inside 0.9 R)
export const SPACING = 0.222;     // neighbouring passes, centre to centre (≈ 2.6 marble diameters)
export const CLEAR = 0.28;        // track centre ↔ shooter centre
export const RHO_MIN = 0.1;       // the tightest bend
const ARC_SKIP = 0.42;            // points further apart than this along a track count as different passes
const CS = 0.03;                  // step of the coarse table the checks run on
const BUDGET = 90;                // attempts before the fallback …
const TIME_BUDGET = 120;          // … or ms (typically < 1 ms, a few ms at worst; this only guards slow devices)

/** Track length (× R) per difficulty; L2 = each of the two tracks on a double level. */
export const DIFFS = {
  easy: { L: [5.0, 6.8] },
  normal: { L: [4.3, 5.8] },
  hard: { L: [3.6, 4.9], L2: [2.4, 3.5] },
};

/** Where the score sits (track centres stay out) and where the shooter may not go. */
export const inScore = (x, y) => Math.abs(x) < 0.23 && y < -0.5;
/** The vortex (a wide disc) and the entry marker keep clear of the score and the line under it. */
const nearScore = (x, y, r) => Math.abs(x) < 0.24 + r && y < -0.5 + r;
export const endsClear = (a, b) => !nearScore(a[0], a[1], 0.06) && !nearScore(b[0], b[1], 0.12);
const shooterBad = (x, y) => (Math.abs(x) < 0.36 && y < -0.34) || Math.hypot(x, y) > 0.66;

// ------------------------------------------------------------------ rng
/** mulberry32 with a few helpers. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.sign = () => (f() < 0.5 ? -1 : 1);
  return f;
}
/** A level's seed from the round's seed. */
export const levelSeed = (base, level) => (Math.imul(base ^ (level * 0x9e3779b9), 0x85ebca6b) ^ (level * 0xc2b2ae35)) >>> 0;

const now = () => (globalThis.performance?.now?.() ?? Date.now());
const randS = (R, rmax) => { const a = R.range(0, TAU), r = rmax * Math.sqrt(R()); return [Math.cos(a) * r, Math.sin(a) * r]; };

// ------------------------------------------------------------------ a polar field around the shooter
// (a, λ) → point: angle a around the shooter S, λ = 0 at rIn from S, λ = 1 on the circle of radius RB.
// Rays from the shooter are lines of constant a, so "in front of / behind" is just λ.
function field(S, rIn) {
  const [sx, sy] = S, s2 = sx * sx + sy * sy;
  const B = (a) => { const b = sx * Math.cos(a) + sy * Math.sin(a); return -b + Math.sqrt(b * b - s2 + RB * RB); };
  const rho = (a, lam) => rIn + (B(a) - rIn) * lam;
  const at = (a, lam) => { const r = rho(a, lam); return [sx + Math.cos(a) * r, sy + Math.sin(a) * r]; };
  const Wmin = (a0, a1) => { let w = Infinity; for (let i = 0; i <= 24; i++) w = Math.min(w, B(a0 + ((a1 - a0) * i) / 24) - rIn); return w; };
  return { B, rho, at, W: (a) => B(a) - rIn, Wmin };
}
/** Arc at a fixed lane from a0 to a1; lam(a) may wobble. */
function arc(F, a0, a1, lam, out) {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * F.rho(a0, lam(a0))) / 0.01));
  for (let i = out.length ? 1 : 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push(F.at(a, lam(a))); }
}
/** A round U-turn at angle a from lane lamA to lamB, bulging further in direction dir. */
function hairpin(F, a, lamA, lamB, dir, out) {
  const lc = (lamA + lamB) / 2, hl = (lamA - lamB) / 2;
  const dl = (Math.abs(hl) * F.W(a)) / F.rho(a, lc);
  for (let i = 1; i < 36; i++) { const t = (i / 36) * Math.PI; out.push(F.at(a + dir * dl * Math.sin(t), lc + hl * Math.cos(t))); }
}

// ------------------------------------------------------------------ families (canonical orientation)
// Each returns { S, tracks: [points] } or null. `sec` (two-track levels) = { S, a0, a1 }: stay in that sector.

/** 1–2½ turns spiralling in to the shooter; the lanes follow the circle when the shooter is off-centre. */
function spiral(R, Lr) {
  const rIn = R.range(0.3, 0.35), lam0 = R.range(0.93, 1), lam1 = R.range(0, 0.1);
  const target = R.range(Lr[0], Lr[1]) * 1.04;
  let S = randS(R, 0.3), F, rhoAvg, maxTurns;
  for (let k = 0; k < 4; k++) {   // an off-centre shooter leaves less room: move it in until the length fits
    F = field(S, rIn);
    let Bm = 0; for (let i = 0; i < 16; i++) Bm += F.B((i * TAU) / 16) / 16;
    rhoAvg = rIn + (Bm - rIn) * (lam0 + lam1) / 2;
    maxTurns = (F.Wmin(0, TAU) * (lam0 - lam1)) / 0.232;
    if (TAU * rhoAvg * maxTurns >= target) break;
    S = [S[0] * 0.5, S[1] * 0.5];
  }
  const turns = Math.min(target / (TAU * rhoAvg), maxTurns);
  if (turns < 0.95) return null;
  const a0 = R.range(0, TAU), wob = R() < 0.5 ? R.range(0, 0.03) : R.range(0.04, 0.09), wk = R.int(3, 6), wph = R.range(0, TAU);
  const pts = [], n = Math.ceil(turns * 260);
  for (let i = 0; i <= n; i++) {
    const u = i / n, a = a0 + u * turns * TAU, lam = lam0 + (lam1 - lam0) * u;
    let r = F.rho(a, lam);
    r += wob * Math.sin(wk * a + wph) * (r / 0.75) ** 2 * Math.min(1, u * 8);   // petals, softer further in
    pts.push([S[0] + Math.cos(a) * r, S[1] + Math.sin(a) * r]);
  }
  return { S, tracks: [pts] };
}

/** Lanes of arcs around the shooter, joined by hairpins, outermost first.
 *  w (two-track levels): [left, right] — the shooter sits at the centre and the track stays in the upper
 *  half-disc, at least w[0] (left end) / w[1] (right end) above the split line. */
function meander(R, Lr, w = null) {
  const S = w ? [0, 0] : randS(R, 0.28), rIn = w ? R.range(0.29, 0.32) : R.range(0.3, 0.35), F = field(S, rIn);
  const wa = w || R() < 0.5 ? 0 : R.range(0.015, 0.04), wk = R.int(3, 6), wph = R.range(0, TAU);
  const wob = (a) => wa * Math.sin(wk * a + wph);
  // the outer lane takes about half the length (so there's always a hairpin and an inner lane)
  const outer = rIn + (RB - rIn - Math.hypot(...S)) * 0.95;
  let A = R.range(0, TAU), Bn = A + Math.max(2.4, Math.min(5.3, (R.range(Lr[0], Lr[1]) * R.range(0.42, 0.62)) / outer));
  if (w) { A = -Math.PI; Bn = 0; }
  const Wmin = F.Wmin(A, Bn), lamTop = R.range(0.9, 1) - wa, dlMin = 0.238 / Wmin;
  const kMax = Math.min(4, Math.floor((lamTop - wa) / dlMin) + 1);
  if (kMax < 2) return null;
  const k = R.int(2, kMax), dl = R.range(dlMin, Math.min(dlMin * 1.3, (lamTop - wa) / (k - 1)));
  const pts = [];
  if (w) {
    // each lane ends as close to the split as it can: hairpins need room for their bulge
    const rhoOf = (i) => F.rho(0, lamTop - i * dl), rh = (dl / 2) * Wmin;
    const end = (side, rho, extra) => { const x = (w[side < 0 ? 0 : 1] + extra) / rho; return x >= 1 ? null : side < 0 ? -Math.PI + Math.asin(x) : -Math.asin(x); };
    let side = R.sign(), from = end(side, rhoOf(0), 0.02);
    for (let i = 0; i < k; i++) {
      const last = i === k - 1, to = last ? end(-side, rhoOf(i), 0.03) : end(-side, (rhoOf(i) + rhoOf(i + 1)) / 2, rh + 0.03);
      if (to === null || from === null || Math.abs(to - from) < 0.5) return i >= 2 ? { S, tracks: [pts] } : null;
      const base = lamTop - i * dl;
      arc(F, from, to, () => base, pts);
      if (!last) hairpin(F, to, base, base - dl, Math.sign(to - from), pts);
      from = to; side = -side;
    }
    return { S, tracks: [pts] };
  }
  if (R() < 0.5) [A, Bn] = [Bn, A];
  let from = A, to = Bn;
  for (let i = 0; i < k; i++) {
    const base = lamTop - i * dl, lam = (a) => base + wob(a);
    arc(F, from, to, lam, pts);
    if (i < k - 1) { hairpin(F, to, lam(to), lam(to) - dl, Math.sign(to - from), pts); [from, to] = [to, from]; }
  }
  return { S, tracks: [pts] };
}

/** A ring zig-zagging in and out (square-ish teeth, or soft petals), entering at the rim. w: as meander. */
function crown(R, Lr, w = null) {
  const S = w ? [0, 0] : randS(R, 0.15), rIn = R.range(0.29, 0.34), F = field(S, rIn);
  const beta = R.pick([0.7, 1.2, 1.8]), tb = Math.tanh(beta), sq = (x) => Math.tanh(beta * Math.sin(x)) / tb;
  let A = R.range(0, TAU), Bn = A + R.range(4.6, 5.9);
  if (w) { A = -Math.PI; Bn = 0; }
  const Wmin = F.Wmin(A, Bn);
  const amp = R.range(0.26, 0.4), lc = R.range(0.96, 1) - amp, trough = lc - amp;
  if (trough < 0.08 || 2 * amp * Wmin < 0.2) return null;
  const rt = rIn + trough * Wmin;
  if (w) { // start (at a peak) and end (anywhere: assume a trough) clear of the split
    const a0 = (wi) => Math.asin(Math.min(1, (wi + 0.03) / F.rho(0, lc + amp))), a1 = (wi) => Math.asin(Math.min(1, (wi + 0.05) / rt));
    if (R() < 0.5) { A = -Math.PI + a0(w[0]); Bn = -a1(w[1]); } else { A = -a0(w[1]); Bn = -Math.PI + a1(w[0]); }
  }
  const kk = (R.range(0.62, 0.86) * Math.PI * rt) / (beta < 1 ? 0.3 : 0.25);   // angular frequency (teeth per radian)
  const dive = !w && R() < 0.5;
  if (!w && R() < 0.5) [A, Bn] = [Bn, A];
  const dir = Math.sign(Bn - A), span = Math.abs(Bn - A);
  const lam = (a) => {
    const x = Math.abs(a - A), wave = amp * sq(kk * x + Math.PI / 2);
    if (!dive) return lc + wave;
    // the teeth fade out while the track curls in toward the shooter
    const u = Math.max(0, (x - (span - 1.3)) / 1.3), sm = u * u * (3 - 2 * u);
    return lc + wave * (1 - sm) + (0.03 - lc) * sm;
  };
  const pts = [];
  arc(F, A, A + dir * span, lam, pts);
  return { S, tracks: [pts] };
}

/** Rows across the screen joined by U-turns, the shooter in front of the last row. half: one half-disc only.
 *  wavy: the rows swing in big S-curves (all in step, so the lanes keep their spacing). */
function serp(R, Lr, half = 0, wavy = false) {
  const sp = wavy ? R.range(0.29, 0.33) : R.range(0.24, 0.29), rows = [];
  const wa = wavy ? R.range(0.06, 0.1) : R.range(0, 0.025), wk = wavy ? R.range(3.5, 5.5) : R.range(3, 7), wph = R.range(0, TAU);
  let S;
  if (half) {
    S = [0, 0];
    for (let y = -R.range(0.29, 0.33) - wa; y > -(RB - 0.1); y -= sp) rows.unshift(y);
  } else {
    // rows until the length is about right (or the shooter would get too close to the rim)
    const target = R.range(Lr[0], Lr[1]) * 1.08, gapS = R.range(0.3, 0.4) + wa;
    let y = -RB + R.range(0.12, 0.2), est = 0;
    while (est < target && y + gapS <= 0.62) {
      rows.push(y);
      est += 1.8 * Math.sqrt(Math.max(0, RB * RB - y * y)) + (Math.PI * sp) / 2;
      y += sp;
    }
    S = [R.range(-0.28, 0.28), rows[rows.length - 1] + gapS];
  }
  if (rows.length < 2) return null;
  const chord = (y, m) => Math.sqrt(Math.max(0, (RB - m) ** 2 - y * y));
  // each row sways a little (a lot when wavy), fading out toward its ends so the U-turns stay round
  const pts = [];
  const row = (x0, x1, y) => {
    const n = Math.max(2, Math.ceil(Math.abs(x1 - x0) / 0.015));
    for (let k = pts.length ? 1 : 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, e = Math.min(1, Math.min(Math.abs(x - x0), Math.abs(x1 - x)) / 0.3);
      pts.push([x, y + wa * Math.sin(wk * x + wph) * e * e * (3 - 2 * e)]);
    }
  };
  let sg = R.sign(), x0 = -sg * (chord(rows[0], 0) - R.range(0, 0.03));
  for (let i = 0; i < rows.length; i++) {
    const y = rows[i];
    if (i === rows.length - 1) { row(x0, sg * (chord(y, 0.05) - R.range(0, 0.1)), y); break; }
    const ym = y + sp / 2, xt = sg * (Math.sqrt(Math.max(0, (RB - sp / 2) ** 2 - ym * ym)) - R.range(0, 0.12));
    row(x0, xt, y);
    for (let q = 1; q <= 30; q++) { const t = (q / 30) * Math.PI; pts.push([xt + sg * Math.sin(t) * sp / 2, ym - Math.cos(t) * sp / 2]); }
    x0 = xt; sg = -sg;
  }
  return { S, tracks: [pts] };
}

/** Two tracks: a centred shooter, one half-disc piece on each side of a strip through it (each side its own
 *  family — meander, serpentine or wavy rows — the second one turned half a turn). */
function double(R, Lr) {
  // the layout is later turned a quarter turn (the split upright): the score then sits over the left end of
  // the split for the first track and over the right end for the second, so the lanes stop further off there
  const S = [0, 0], w = R.range(0.115, 0.135), tracks = [], fams = [];
  for (let side = 0; side < 2; side++) {
    const fam = R.pick(['meander', 'meander', 'serp', 'wave']), flip = R() < 0.5;
    let ww = side ? [w, 0.27] : [0.27, w];
    if (flip) ww = [ww[1], ww[0]];
    const lay = fam === 'meander' ? meander(R, Lr, ww) : serp(R, Lr, w, fam === 'wave');
    if (!lay) return null;
    let pts = lay.tracks[0];
    if (flip) pts = pts.map(([x, y]) => [-x, y]);
    if (side) pts = pts.map(([x, y]) => [-x, -y]);
    tracks.push(pts); fams.push(fam);
  }
  return { S, tracks, fam: fams.join('+') };
}
/** Known-good pair for the fallback: plain serpentines on both sides (every random choice at its middle). */
function safeDouble() {
  const mid = () => 0.5;
  Object.assign(mid, { range: (a, b) => (a + b) / 2, int: (a, b) => Math.round((a + b) / 2), pick: (arr) => arr[0], sign: () => 1 });
  const a = cut(serp(mid, [2.4, 3.5], 0.125).tracks[0], 3);
  return { S: [0, 0], tracks: [a, a.map(([x, y]) => [-x, -y])] };
}

export const FAMS = { spiral, meander, crown, serp, wave: (R, Lr) => serp(R, Lr, 0, true), double };
export const FAMILIES = ['spiral', 'meander', 'crown', 'serp', 'wave'];

// ------------------------------------------------------------------ geometry helpers
function dense(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}
/** Centripetal Catmull-Rom through the points (ends extended straight). */
function catmull(P) {
  const ext = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1]];
  const Q = [ext(P[0], P[1]), ...P, ext(P[P.length - 1], P[P.length - 2])], out = [P[0]];
  for (let i = 1; i < Q.length - 2; i++) {
    const p0 = Q[i - 1], p1 = Q[i], p2 = Q[i + 1], p3 = Q[i + 2];
    const t1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) ** 0.5 || 1e-4;
    const t2 = t1 + (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) ** 0.5 || 1e-4);
    const t3 = t2 + (Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) ** 0.5 || 1e-4);
    for (let k = 1; k <= 20; k++) {
      const t = t1 + ((t2 - t1) * k) / 20, r = [0, 0];
      for (let c = 0; c < 2; c++) {
        const a1 = ((t1 - t) * p0[c] + t * p1[c]) / t1, a2 = ((t2 - t) * p1[c] + (t - t1) * p2[c]) / (t2 - t1);
        const a3 = ((t3 - t) * p2[c] + (t - t2) * p3[c]) / (t3 - t2);
        const b1 = ((t2 - t) * a1 + t * a2) / t2, b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
        r[c] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
      }
      out.push(r);
    }
  }
  return out;
}
/** The first `len` of a polyline. */
function cut(pts, len) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], l = Math.hypot(x1 - x0, y1 - y0);
    if (acc + l >= len) { const f = (len - acc) / (l || 1); return [...pts.slice(0, i), [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]]; }
    acc += l;
  }
  return pts;
}

// ------------------------------------------------------------------ checks
/** The quick checks (one pass) on a coarse table → null or why it fails. */
export function checkShape(T, S, Lr, endsMin = 0.4) {
  const { xs, ys, n, L } = T;
  if (L < Lr[0] - 1e-6 || L > Lr[1] + 0.02) return 'length';
  if (Math.hypot(xs[0], ys[0]) < 0.66) return 'entry';
  if (Math.hypot(xs[n] - xs[0], ys[n] - ys[0]) < endsMin) return 'ends';
  for (let i = 0; i <= n; i++) {
    if (xs[i] * xs[i] + ys[i] * ys[i] > RCHECK * RCHECK) return 'rim';
    if (Math.hypot(xs[i] - S[0], ys[i] - S[1]) < CLEAR) return 'shooter';
  }
  const maxTurn = (T.step / RHO_MIN) * 1.05;
  for (let i = 1; i < n; i++) {
    const ax = xs[i] - xs[i - 1], ay = ys[i] - ys[i - 1], bx = xs[i + 1] - xs[i], by = ys[i + 1] - ys[i];
    if (Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) > maxTurn) return 'bend';
  }
  return null;
}
/** Passes of one track at least SPACING apart (this also catches any crossing). */
export function checkSpacing(T) {
  const { xs, ys, n } = T, skip = Math.ceil(ARC_SKIP / T.step), sp2 = SPACING * SPACING;
  for (let i = 0; i <= n; i++) for (let j = i + skip; j <= n; j++) {
    const dx = xs[i] - xs[j], dy = ys[i] - ys[j];
    if (dx * dx + dy * dy < sp2) return 'spacing';
  }
  return null;
}
export function checkTrack(T, S, Lr, endsMin) { return checkShape(T, S, Lr, endsMin) || checkSpacing(T); }
export function minDistance(A, B) {
  let m = Infinity;
  for (let i = 0; i <= A.n; i++) for (let j = 0; j <= B.n; j++) m = Math.min(m, (A.xs[i] - B.xs[j]) ** 2 + (A.ys[i] - B.ys[j]) ** 2);
  return Math.sqrt(m);
}
/** How much of each track is hidden from the shooter by marbles that are already there when the head
 *  arrives: earlier parts of the same track and anything on the other track. → [{ all, end }] (fractions). */
export function hiddenShare(Ts, S) {
  const rr = D * 0.95;
  return Ts.map((T, ti) => {
    let hid = 0, cnt = 0, hidEnd = 0, cntEnd = 0;
    const back = Math.ceil(0.3 / T.step);
    for (let i = 0; i <= T.n; i += 2) {
      const px = T.xs[i] - S[0], py = T.ys[i] - S[1], d = Math.hypot(px, py), ux = px / d, uy = py / d;
      let blocked = false;
      for (let tj = 0; tj < Ts.length && !blocked; tj++) {
        const U = Ts[tj], lim = tj === ti ? i - back : U.n;
        for (let j = 0; j <= lim && !blocked; j++) {
          const wx = U.xs[j] - S[0], wy = U.ys[j] - S[1], al = wx * ux + wy * uy;
          if (al <= 0.1 || al >= d - D * 0.6) continue;
          if (Math.abs(wx * uy - wy * ux) < rr) blocked = true;
        }
      }
      cnt++; if (blocked) hid++;
      if (i >= T.n * 0.5) { cntEnd++; if (blocked) hidEnd++; }
    }
    return { all: hid / cnt, end: hidEnd / Math.max(1, cntEnd) };
  });
}
/** The slow checks: spacing, the tracks apart, nothing important hidden. */
function checkDeep(S, Ts) {
  for (const T of Ts) if (checkSpacing(T)) return 'spacing';
  for (let i = 0; i < Ts.length; i++) for (let j = i + 1; j < Ts.length; j++) if (minDistance(Ts[i], Ts[j]) < SPACING) return 'apart';
  for (const h of hiddenShare(Ts, S)) if (h.end > 0.1 || h.all > 0.3) return 'hidden';
  return null;
}
/** Everything (for tests). → null or the reason. */
export function checkLayout(S, Ts, Lr, endsMin = Ts.length > 1 ? 0.25 : 0.4) {
  for (const T of Ts) { const why = checkShape(T, S, Lr, endsMin); if (why) return why; }
  if (Ts.some((T) => !T.xs.every((x, i) => !inScore(x, T.ys[i])))) return 'score';
  if (Ts.some((T) => !endsClear([T.xs[0], T.ys[0]], [T.xs[T.n], T.ys[T.n]]))) return 'score-ends';
  if (shooterBad(S[0], S[1])) return 'shooter-spot';
  return checkDeep(S, Ts);
}

/** Turn + mirror about the centre so the score strip stays clear. → transform fn or null. */
function orient(R, S, Ts) {
  const m = R.sign(), two = Ts.length > 1, th0 = two ? Math.PI / 2 : R.range(0, TAU);
  for (let k = 0; k < (two ? 6 : 32); k++) {
    const th = two ? th0 + (k < 5 ? R.range(-0.25, 0.25) : 0) : th0 + (k * TAU) / 32, c = Math.cos(th), s = Math.sin(th);
    const tf = two ? ([x, y]) => [m * (x * c - y * s), x * s + y * c] : ([x, y]) => [m * x * c - y * s, m * x * s + y * c];
    const [qx, qy] = tf(S);
    if (shooterBad(qx, qy)) continue;
    let ok = true;
    for (const T of Ts) for (let i = 0; i <= T.n && ok; i++) { const [x, y] = tf([T.xs[i], T.ys[i]]); if (Math.abs(x) < 0.25 && y < -0.48) ok = false; }   // (a little margin: this is the coarse table)
    for (const T of Ts) if (ok && !endsClear(tf([T.xs[0], T.ys[0]]), tf([T.xs[T.n], T.ys[T.n]]))) ok = false;
    if (ok) return tf;
  }
  return null;
}

// ------------------------------------------------------------------ the generator
/** Families per difficulty (a crown is too short for Easy). */
const FAM_BY_DIFF = { easy: ['spiral', 'meander', 'serp', 'wave'], normal: FAMILIES, hard: FAMILIES };
const PER_FAM = 12;   // attempts with one family before trying the next

/**
 * A new layout. → { shooter: [x, y], tracks: [points…], fam, attempts, ms, fallback, fails }
 * diff: 'easy' | 'normal' | 'hard'; two: two tracks; avoid: a family not to use (the previous level's);
 * only: force a family (tests).
 */
export function generateLevel(seed, diff = 'normal', { two = false, avoid = null, only = null } = {}) {
  const t0 = now(), R = makeRng(seed), cfg = DIFFS[diff] || DIFFS.normal;
  const Lr = two ? cfg.L2 || cfg.L : cfg.L, fails = {}, endsMin = two ? 0.25 : 0.4;
  // the family order for this level: shuffled, the previous level's family last
  const fams = only ? [only] : (FAM_BY_DIFF[diff] || FAMILIES).slice();
  for (let i = fams.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [fams[i], fams[j]] = [fams[j], fams[i]]; }
  if (avoid && fams.includes(avoid)) fams.push(...fams.splice(fams.indexOf(avoid), 1));
  const fail = (why) => { fails[why] = (fails[why] || 0) + 1; };
  let att = 1;
  for (; att <= BUDGET && (att < 4 || now() - t0 < TIME_BUDGET); att++) {
    const fam = two ? 'double' : fams[Math.floor((att - 1) / PER_FAM) % fams.length];
    const lay = FAMS[fam](R, Lr);
    if (!lay) { fail('build'); continue; }
    const tracks = lay.tracks.map((p) => cut(p, R.range(Lr[0], Lr[1])));
    const Ts = tracks.map((p) => buildTable(p, CS));
    let why = null;
    for (const T of Ts) if ((why = checkShape(T, lay.S, Lr, endsMin))) break;
    if (why) { fail(why); continue; }
    const tf = orient(R, lay.S, Ts);
    if (!tf) { fail('score'); continue; }
    if ((why = checkDeep(lay.S, Ts))) { fail(why); continue; }
    return { shooter: tf(lay.S), tracks: tracks.map((p) => p.map(tf)), fam: lay.fam || fam, attempts: att, ms: now() - t0, fallback: false, fails };
  }
  return { ...fallback(R, two), attempts: att - 1, ms: now() - t0, fallback: true, fails };
}

/** A classic track turned / mirrored at random (the turn that keeps the score clearest), or the safe pair. */
function fallback(R, two) {
  if (two) {
    const lay = safeDouble(), Ts = lay.tracks.map((p) => buildTable(p, CS));
    const tf = orient(R, lay.S, Ts) || ((p) => [p[1], -p[0]]);
    return { shooter: tf(lay.S), tracks: lay.tracks.map((p) => p.map(tf)), fam: 'safe-double' };
  }
  const P = R.pick(PATHS), pts = P.pts(), m = R.sign();
  let best = null;
  for (let k = 0; k < 12; k++) {
    const th = k ? R.range(0, TAU) : 0, c = Math.cos(th), s = Math.sin(th);
    const tf = ([x, y]) => [m * x * c - y * s, m * x * s + y * c];
    let bad = 0;
    for (let i = 0; i < pts.length; i += 20) if (inScore(...tf(pts[i]))) bad++;
    const [qx, qy] = tf(P.shooter);
    if (shooterBad(qx, qy) && Math.hypot(qx, qy) > 0.01) bad += 1000;
    if (!endsClear(tf(pts[0]), tf(pts[pts.length - 1]))) bad += 100;
    if (!best || bad < best.bad) best = { bad, tf };
  }
  return { shooter: best.tf(P.shooter), tracks: [pts.map(best.tf)], fam: `classic-${P.name}` };
}
