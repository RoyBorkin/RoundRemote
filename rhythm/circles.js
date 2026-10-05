// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Beat Circles — a round take on the "click the circles" rhythm game (osu! standard style).
// Circles pop up all over the round screen with a ring closing in on each; tap the circle the moment its ring
// meets it. Numbered combos with cycling colours, follow lines from circle to circle, sliders (hold notes: a
// ball runs along a curved path — tap the head, keep your finger on the ball; repeats on Expert/Master) and
// spinners at long gaps / section breaks (spin your finger around the centre; extra spins = bonus points).
//
// The chart comes from the kit (rhythm/kit.js → chart.js); this file turns it into a flowing 2-D pattern with a
// seeded RNG (spacing ∝ time gap × difficulty, direction changes on downbeats, stacks / streams for very short
// gaps, symmetric jumps on Expert/Master) and draws / plays it.
//
// Controls: tap / click the circles (multi-touch: alternate fingers). Sliders: hold and follow the ball.
// Spinners: circle your finger (or the mouse with a button / key held) around the centre; the knob
// (ArrowLeft/Right, wheel) also spins. Keyboard: Z / X / Space / Enter hit the circle under the mouse pointer
// when a mouse is in use; with no mouse ("keys only" relax mode) they hit the next due circle wherever it is,
// a held key keeps a slider going and every press turns a spinner a little.
import { rhythmGame, DIFF_OPTION, judgeColor } from './kit.js';
import { THEME, TAU, clamp, ease, angDiff } from '../games/kit.js';

// ---- difficulty design (Easy … Master)
const AR_MS = [1600, 1300, 1000, 800, 600];          // approach time: how long a circle is shown before its beat
const CS = [0.135, 0.12, 0.105, 0.092, 0.08];        // circle radius × R
const SPACING = [0.40, 0.48, 0.58, 0.70, 0.82];      // distance per beat of gap × R
const SV = [0.28, 0.32, 0.38, 0.45, 0.52];           // slider length per beat × R
const SPIN_RPS = [0.9, 1.1, 1.3, 1.5, 1.7];          // spins per second a spinner needs
const COMBO_MAX = [6, 8, 10, 12, 14];                // longest numbered combo
const SLIDER_SHARE = [1, 1, 0.08, 0.09, 0.1];        // long holds that may swallow the taps under them
const FIELD = 0.78;                                  // circle centres stay within this × R
const HIT_KEYS = new Set(['z', 'x', ' ', 'Enter']);
const LABELS = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };

function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** '#rgb' / '#rrggbb' / 'rgb(a)(…)' → [r, g, b] */
function rgbOf(c) {
  if (c && c[0] === '#') {
    let h = c.slice(1); if (h.length === 3) h = [...h].map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(c || '');
  if (m) { const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0] | 0, v[1] | 0, v[2] | 0]; }
  return [255, 255, 255];
}
const css = ([r, g, b], a = 1) => (a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`);
const mixRgb = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Cubic Bézier → lookup table of N+1 points evenly spaced by arc length (normalised coords). */
function bezLUT(x0, y0, x1, y1, x2, y2, x3, y3, N = 32) {
  const S = 64, xs = new Float64Array(S + 1), ys = new Float64Array(S + 1), cum = new Float64Array(S + 1);
  for (let i = 0; i <= S; i++) {
    const t = i / S, m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
    xs[i] = a * x0 + b * x1 + c * x2 + d * x3; ys[i] = a * y0 + b * y1 + c * y2 + d * y3;
    if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  const len = cum[S], lut = new Float32Array((N + 1) * 2);
  for (let k = 0, j = 0; k <= N; k++) {
    const target = (len * k) / N;
    while (j < S - 1 && cum[j + 1] < target) j++;
    const f = clamp((target - cum[j]) / ((cum[j + 1] - cum[j]) || 1), 0, 1);
    lut[2 * k] = xs[j] + (xs[j + 1] - xs[j]) * f; lut[2 * k + 1] = ys[j] + (ys[j + 1] - ys[j]) * f;
  }
  return { lut, len, N };
}
/** Point at u (0..1) along a LUT path → writes into out[0], out[1]. */
function lutAt(path, u, out) {
  const { lut, N } = path;
  const p = clamp(u, 0, 1) * N, i = Math.min(N - 1, Math.floor(p)), f = p - i;
  out[0] = lut[2 * i] + (lut[2 * i + 2] - lut[2 * i]) * f;
  out[1] = lut[2 * i + 1] + (lut[2 * i + 3] - lut[2 * i + 1]) * f;
  return out;
}

export default {
  howTo: 'Tap each circle as its ring closes on it, hold sliders and follow the ball, circle your finger to fill spinners. '
    + 'Keys Z / X / Space hit the circle under the mouse — with no mouse, the next circle anywhere (keys-only relax mode).',
  modes: [{ id: 'play', name: 'Play', options: [DIFF_OPTION] }],
  keyRepeat: false,
  create(g) {
    const R = rhythmGame(g, { game: 'circles', lanes: 5, holds: true, chords: false, leadMs: 1800 });
    const D = R.difficulty;
    const AR = AR_MS[D], cr = CS[D];
    const RMAX = FIELD - cr * 0.35;
    // the score / combo strip at the top stays clear (and the pause button above it)
    const inField = (x, y) => x * x + y * y <= RMAX * RMAX && !(y < -0.44 && Math.abs(x) < 0.26 + cr);

    let notes = [], ready = false;
    let scanFrom = 0, drawFrom = 0, fxScan = 0;
    let beats = [], downSet = new Set();
    const fx = [];
    // judgement popups: drawn here at ONE font size and scaled with a transform — animating the font size (as the
    // kit's own popups do) makes the canvas rasterise new glyphs every frame, which stalls slow devices
    const pops = [];
    R.popup = (label, x, y, col) => {
      // a stack hit in quick succession: the new label replaces the one still popping on the same spot
      for (let i = pops.length - 1; i >= 0; i--) if (pops[i].t < 0.3 && Math.abs(pops[i].x - x) + Math.abs(pops[i].y - y) < g.R * 0.08) pops.splice(i, 1);
      pops.push({ text: LABELS[label] || String(label), x, y, col: col || judgeColor(label), t: 0, big: label === 'perfect' });
      if (pops.length > 12) pops.shift();
    };
    let warmKey = '';
    function warmGlyphs() {
      // rasterise the digits / labels once (glyph cache) so the first circles of a song don't hitch
      const key = `${THEME.display}|${g.R}|${cr}`;
      if (key === warmKey) return;
      warmKey = key;
      const c = document.createElement('canvas'); c.width = c.height = 8;
      const x = c.getContext('2d');
      x.font = `700 ${cr * g.R * 0.92}px ${THEME.display}`; x.fillText('0123456789', 0, 4);
      x.font = `800 ${g.R * 0.062}px ${THEME.display}`; x.fillText('PERFECTGRAMISOD', 0, 4);
      x.font = `700 ${g.R * 0.07}px ${THEME.display}`; x.fillText('SPIN!CLEAR+0123456789', 0, 4);
      x.font = `700 ${g.R * 0.055}px ${THEME.display}`; x.fillText('0123456789 /', 0, 4);
    }
    function drawPops(dt) {
      const { ctx } = g, size = g.R * 0.062;
      ctx.font = `800 ${size}px ${THEME.display}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i]; p.t += dt;
        // PERFECT is the norm: smaller and brief; the others stay longer so they register
        const life = p.big ? 0.42 : 0.7;
        if (p.t > life) { pops.splice(i, 1); continue; }
        const k = p.t / life, s = (p.t < 0.12 ? ease.back(p.t / 0.12) : 1) * (p.big ? 0.72 : p.text === 'MISS' ? 0.95 : 0.84);
        ctx.setTransform(g.dpr * s, 0, 0, g.dpr * s, g.dpr * p.x, g.dpr * (p.y - k * g.R * 0.06));
        ctx.globalAlpha = 1 - k * k;
        ctx.lineWidth = size * 0.14; ctx.lineJoin = 'round';
        ctx.strokeStyle = THEME.paper(0.55); ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = p.col; ctx.fillText(p.text, 0, 0);
      }
      ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      ctx.globalAlpha = 1;
    }
    const sliding = [];               // sliders whose head was hit and that are still running
    let fxClock = 0;
    const tmp = [0, 0];

    // ---------------------------------------------------------------- build the pattern from the chart
    R.onReady((chart) => {
      notes = chart.notes;
      const A = R.analysis || {};
      beats = chart.beats && chart.beats.length >= 2 ? chart.beats : [];
      const bpm = chart.bpm || 120;
      const per = (t) => {
        const B = beats, n = B.length;
        if (n < 2) return 60000 / bpm;
        let lo = 0, hi = n - 1;
        if (t <= B[0]) return B[1] - B[0];
        if (t >= B[n - 1]) return B[n - 1] - B[n - 2];
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m] <= t) lo = m; else hi = m; }
        return B[hi] - B[lo];
      };
      const beatAt = (t) => {
        const B = beats, n = B.length;
        if (n < 2) return t / (60000 / bpm);
        if (t <= B[0]) return (t - B[0]) / (B[1] - B[0]);
        if (t >= B[n - 1]) return n - 1 + (t - B[n - 1]) / (B[n - 1] - B[n - 2]);
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m] <= t) lo = m; else hi = m; }
        return lo + (t - B[lo]) / (B[hi] - B[lo]);
      };
      const DB = (A.downbeats || []).slice().sort((a, b) => a - b);
      downSet = new Set(DB);
      const barOf = (beat) => {
        const b = Math.floor(beat + 0.02);
        if (!DB.length) return Math.floor(b / 4);
        let lo = 0, hi = DB.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (DB[m] <= b) lo = m + 1; else hi = m; }
        return lo;
      };
      const energy = A.energy || [];
      const eSorted = energy.slice().sort((a, b) => a - b);
      const eMed = eSorted.length ? eSorted[eSorted.length >> 1] : 0.5;
      const energyAt = (t) => (energy.length ? energy[clamp(Math.floor(t / 250), 0, energy.length - 1)] : 0.6);
      const rng = prng(((R.version?.seed || 1) * 7919 + D * 131 + 17) >>> 0);
      const durMs = chart.durMs || A.durMs || 0;

      // 1) sliders can't overlap other notes (one cursor). The longest, strongest holds stay sliders and take over
      //    the few weaker taps under them (up to a share of the chart); the rest end a little before the next note
      //    — or turn into plain circles when that leaves too little
      const gapAfter = (t) => Math.max((D >= 3 ? 0.25 : 0.5) * per(t), 120);
      const underOf = (i) => {
        const n = notes[i], u = [], end = n.t + n.dur + gapAfter(n.t);
        for (let j = i + 1; j < notes.length && notes[j].t < end; j++) if (!notes[j]._drop) u.push(notes[j]);
        return u;
      };
      const budget = Math.round(SLIDER_SHARE[D] * notes.length);
      const holdIdx = [];
      notes.forEach((n, i) => { if (n.dur > 0) holdIdx.push(i); });
      holdIdx.sort((a, b) => notes[b].dur * (0.5 + notes[b].s) - notes[a].dur * (0.5 + notes[a].s));
      let nSliders = 0;
      for (const i of holdIdx) {
        const n = notes[i];
        if (n._drop) continue;
        const u = underOf(i);
        if (!u.length) { n._keep = true; nSliders++; continue; }
        if (nSliders < budget && u.length <= Math.max(2, Math.round(n.dur / per(n.t))) && u.every((x) => !x._keep)) {
          for (const x of u) { x._drop = true; x.dur = 0; }
          n._keep = true; nSliders++;
        }
      }
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (n._drop || !(n.dur > 0) || n._keep) continue;
        const u = underOf(i);
        if (!u.length) continue;
        const d = u[0].t - gapAfter(n.t) - n.t;
        n.dur = d >= Math.max(0.5 * per(n.t), 200) ? Math.round(d) : 0;
      }
      let live = notes.filter((n) => !n._drop);

      // 2) spinners: long gaps (> 2 s) and breaks into a calmer section
      const spins = [];
      const post = Math.max(600, AR * 0.6);
      for (let i = 0; i < live.length; i++) {
        const prev = live[i - 1], next = live[i];
        const prevEnd = prev ? prev.t + (prev.dur || 0) : 0;
        if (next.t - prevEnd < (prev ? 2000 : 5000)) continue;
        const a = prevEnd + Math.max(400, 0.5 * per(prevEnd)) + (prev ? 0 : 1000);
        const b = next.t - clamp(AR * 0.75, 600, 1000);
        if (b - a >= 1200) spins.push({ a, b });
      }
      const secs = A.sections || [];
      let added = 0;
      for (let k = 1; k < secs.length && added < 3; k++) {
        const s = secs[k], P = per(s.t);
        if (!(s.e < secs[k - 1].e - 0.06) || s.t < 15000 || (durMs && s.t > durMs - 12000)) continue;
        if (spins.some((x) => Math.abs(x.a - s.t) < 25000)) continue;
        const a = s.t + (Math.round(beatAt(s.t)) - beatAt(s.t)) * P;   // snapped to the nearest beat
        const b = a + clamp(8 * P, 2500, 4500);
        const pre = Math.max(300, 0.5 * P);
        // clear the span (a hold running into it is cut short)
        for (const n of live) {
          const end = n.t + (n.dur || 0);
          if (n.t >= a - pre && n.t <= b + post) n._drop = true;
          else if (n.t < a - pre && end > a - pre) { const d = a - pre - n.t; n.dur = d >= 240 ? Math.round(d) : 0; }
        }
        spins.push({ a, b });
        added++;
        live = live.filter((n) => !n._drop);
      }
      const keep = notes.filter((n) => !n._drop);
      notes.length = 0;
      notes.push(...keep);
      for (const sp of spins) {
        const need = Math.max(1, Math.round(((sp.b - sp.a) / 1000) * SPIN_RPS[D]));
        // the spinner's note sits a little after its end so a slow frame can't let the kit auto-miss it before it is judged
        notes.push({ t: Math.round(sp.b) + 400, lane: 0, dur: 0, s: 1, b: 0, p: 0.5, beat: beatAt(sp.b), chord: false, spin: { a: sp.a, b: sp.b, need, rot: 0, vis: 0, bonus: 0, cleared: false } });
      }
      notes.sort((a, b) => a.t - b.t);
      notes.forEach((n, i) => { n.id = i; });

      // 3) the 2-D pattern
      const sg = new Uint8Array(notes.length), runSize = new Int16Array(notes.length);
      for (let i = 1; i < notes.length; i++) {
        const a = notes[i - 1], b = notes[i];
        sg[i] = !a.spin && !b.spin && (b.t - a.t - (a.dur || 0)) / per(b.t) < 0.3 ? 1 : 0;
      }
      for (let i = 1; i < notes.length;) {
        if (!sg[i]) { i++; continue; }
        let j = i; while (j < notes.length && sg[j]) j++;
        for (let k = i; k < j; k++) runSize[k] = j - i;
        i = j;
      }
      let x = (rng() - 0.5) * 0.3, y = 0.1 + (rng() - 0.5) * 0.2, th = rng() * TAU;
      let curv = (rng() < 0.5 ? -1 : 1) * (0.12 + rng() * 0.2);
      let prevEndT = -1e9, prevBar = -99, prevLane = 2, num = 0, col = -1, forceNew = true, fresh = true;
      let jump = 0, jumpKind = 0, lastSpinB = -1e9, curT = 0;
      const recent = [];   // earlier circles still on screen when the next one appears: { x, y, end }
      const bodies = [];   // the last two sliders: new circles keep off their bodies
      const offBodies = (nx, ny) => {
        const m2 = (cr * 1.9) ** 2;
        for (const pth of bodies) for (let k = 0; k <= pth.N; k++) { const dx = nx - pth.lut[2 * k], dy = ny - pth.lut[2 * k + 1]; if (dx * dx + dy * dy < m2) return false; }
        return true;
      };
      const offRecent = (nx, ny) => {
        // every earlier circle that is still visible (except the one we come from) stays uncovered
        for (let k = recent.length - 2; k >= 0; k--) {
          const r = recent[k];
          if (curT - r.end > AR + 250) break;
          if ((nx - r.x) ** 2 + (ny - r.y) ** 2 < (cr * 1.9) ** 2) return false;
        }
        return true;
      };
      const ok = (nx, ny, checkP2) => inField(nx, ny) && (!checkP2 || (offRecent(nx, ny) && offBodies(nx, ny)));
      /** Step d from (fx, fy) heading th; bounce off the edges by trying nearby headings. → [x, y, th] */
      const place = (fx, fy, a, d, checkP2 = true) => {
        // gravity: a step that would land far out turns toward the centre (keeps the pattern off the rim)
        const pr = Math.hypot(fx + Math.cos(a) * d, fy + Math.sin(a) * d);
        if (pr > 0.45 && (fx || fy)) a += angDiff(a, Math.atan2(-fy, -fx)) * clamp((pr - 0.45) * 1.8, 0, 0.75);
        for (let k = 0; k < 18; k++) {
          const aa = a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
          const nx = fx + Math.cos(aa) * d, ny = fy + Math.sin(aa) * d;
          if (ok(nx, ny, checkP2 && k < 14)) return [nx, ny, aa];
        }
        // nothing fits: head for the centre
        const ac = Math.atan2(-fy, -fx), dd = Math.min(d, Math.hypot(fx, fy));
        return [fx + Math.cos(ac) * dd, fy + Math.sin(ac) * dd, ac];
      };
      const OFFS = [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI];
      const buildSlider = (n, a) => {
        const P = per(n.t), durB = n.dur / P;
        let spans = 1;
        if (D >= 3 && durB >= 1 && rng() < 0.7) spans = durB >= 2.5 && rng() < 0.5 ? 3 : 2;
        let L = clamp((durB / spans) * SV[D], cr * 1.6, 0.85);
        const bend0 = (rng() - 0.5) * 1.1, sCurve = rng() < 0.3;
        for (let att = 0; att < 30; att++) {
          const aa = a + OFFS[att % OFFS.length];
          if (att && att % OFFS.length === 0) L = Math.max(cr * 1.2, L * 0.75);
          const bend = L > cr * 3 ? (att < OFFS.length ? bend0 : -bend0) : 0;
          const ch = L * (1 - 0.25 * Math.abs(bend));
          const ex = n.nx + Math.cos(aa) * ch, ey = n.ny + Math.sin(aa) * ch;
          const px = -Math.sin(aa), py = Math.cos(aa), off = bend * ch * 0.6, off2 = sCurve && L > 0.45 ? -off : off;
          const path = bezLUT(n.nx, n.ny, n.nx + (ex - n.nx) / 3 + px * off, n.ny + (ey - n.ny) / 3 + py * off,
            n.nx + (2 * (ex - n.nx)) / 3 + px * off2, n.ny + (2 * (ey - n.ny)) / 3 + py * off2, ex, ey);
          let fits = true;
          for (let k = 1; k <= path.N && fits; k++) fits = inField(path.lut[2 * k], path.lut[2 * k + 1]);
          if (fits) { n.path = path; n.spans = spans; return; }
        }
        const ac = Math.atan2(-n.ny, -n.nx), Lc = cr * 1.4;
        n.path = bezLUT(n.nx, n.ny, n.nx + Math.cos(ac) * Lc / 3, n.ny + Math.sin(ac) * Lc / 3, n.nx + Math.cos(ac) * Lc * 2 / 3, n.ny + Math.sin(ac) * Lc * 2 / 3, n.nx + Math.cos(ac) * Lc, n.ny + Math.sin(ac) * Lc);
        n.spans = 1;
      };
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (n.spin) {
          n.nx = 0; n.ny = 0; n.app = n.spin.a - 450;
          forceNew = true; fresh = true; lastSpinB = n.spin.b; prevEndT = n.t;
          x = (rng() - 0.5) * 0.3; y = (rng() - 0.5) * 0.3; th = rng() * TAU; recent.length = 0; bodies.length = 0;
          continue;
        }
        n.app = Math.max(n.t - AR, lastSpinB);
        curT = n.t;
        const P = per(n.t), gapB = (n.t - prevEndT) / P;
        const bar = barOf(n.beat);
        const phrase = bar !== prevBar && (D >= 2 || bar % 2 === 0);   // Easy / Medium: two-bar phrases
        const isNew = forceNew || gapB >= 2 || num >= COMBO_MAX[D] || (phrase && (num >= 3 || (num >= 2 && gapB >= 1)));
        if (isNew) {
          col++; num = 0; forceNew = false; jump = 0;
          if (rng() < 0.5) curv = -curv;
          if (D >= 3 && energyAt(n.t) >= eMed && rng() < 0.45) { jump = 3 + Math.floor(rng() * 5); jumpKind = rng() < 0.5 ? 0 : 1; }
        }
        num++; n.num = num; n.col = col; n.newCombo = num === 1;
        let nx, ny;
        if (fresh) { // first note (or the first after a spinner): where we are
          [nx, ny, th] = place(x, y, th, 0.001, false); fresh = false;
        } else if (sg[i]) {
          if (D >= 3 && runSize[i] >= 3) { // stream: a curving chain of overlapping circles
            th += curv * 0.5;
            [nx, ny, th] = place(x, y, th, cr * 1.25, false);
          } else { // stack: (almost) on top of the previous one, nudged up-left like a deck of cards
            nx = x - cr * 0.12; ny = y - cr * 0.12;
            if (!inField(nx, ny)) { nx = x + cr * 0.12; ny = y + cr * 0.12; }
          }
        } else if (jump > 0 && gapB >= 0.45 && num > 1) {
          // symmetric jumps: mirror the last circle across the vertical axis (or through the centre)
          const dWant = clamp(Math.min(gapB, 1.6) * SPACING[D] * 1.25, cr * 2.4, 1.15);
          let mx = -x, my = jumpKind ? -y : y + (rng() - 0.5) * 0.14;
          if (Math.abs(2 * x) < dWant * 0.7 || Math.abs(2 * x) > dWant * 1.4) { mx = -(Math.sign(x) || 1) * dWant / 2; }
          jumpKind ^= rng() < 0.3 ? 1 : 0;
          if (inField(mx, my) && Math.hypot(mx - x, my - y) >= cr * 2.2) { nx = mx; ny = my; th = Math.atan2(my - y, mx - x); }
          else { jump = 0; [nx, ny, th] = place(x, y, th + curv, clamp(Math.min(gapB, 1.6) * SPACING[D], cr * 2.1, 0.9)); }
          jump--;
        } else {
          // flow: keep curving, steer with the melody (lane), turn sharply on a new bar
          const d = clamp(Math.min(gapB, 1.6) * SPACING[D], cr * 2.1, 0.9);
          let turn = curv + clamp(n.lane - prevLane, -2, 2) * 0.18;
          if (bar !== prevBar) turn += (rng() < 0.5 ? -1 : 1) * (0.9 + rng() * 1.2);
          [nx, ny, th] = place(x, y, th + turn, d);
        }
        n.nx = nx; n.ny = ny;
        if (n.dur > 0) {
          buildSlider(n, th + (rng() - 0.5) * 0.8);
          bodies.push(n.path); if (bodies.length > 2) bodies.shift();
          const L = n.path.lut, N = n.path.N;
          if (n.spans % 2) { x = L[2 * N]; y = L[2 * N + 1]; th = Math.atan2(L[2 * N + 1] - L[2 * N - 1], L[2 * N] - L[2 * N - 2]); }
          else { x = L[0]; y = L[1]; th = Math.atan2(L[1] - L[3], L[0] - L[2]); }
          n.ex = x; n.ey = y;
        } else { x = nx; y = ny; n.ex = nx; n.ey = ny; }
        prevEndT = n.t + (n.dur || 0); prevBar = barOf(beatAt(prevEndT)); prevLane = n.lane;
        recent.push({ x: nx, y: ny, end: prevEndT }); if (recent.length > 8) recent.shift();
      }
      layout();
      ready = true;
    });
    function layout() {
      for (const n of notes) { n.x = g.cx + n.nx * g.R; n.y = g.cy + n.ny * g.R; }
      bgKey = '';
    }
    g.on('resize', () => { if (ready) layout(); else bgKey = ''; });

    // ---------------------------------------------------------------- colours (follow the theme live)
    let pal = [], palKey = '';
    function palette() {
      const key = `${THEME.c1}|${THEME.c2}|${THEME.light}|${THEME.bg}`;
      if (key === palKey) return pal;
      palKey = key;
      const cands = [THEME.c1, THEME.c2, g.color, ...[1, 6, 3, 0, 4].map((i) => THEME.pieces?.[i] || '#ffffff')].map(rgbOf);
      const chosen = [];
      const sat = (c) => (Math.max(...c) - Math.min(...c)) / (Math.max(...c) || 1);   // greys (e.g. a silver c2) make dull circles
      for (const c of cands) if (chosen.length < 4 && sat(c) > 0.3 && chosen.every((d) => rgbDist(c, d) > 95)) chosen.push(c);
      const bg = rgbOf(THEME.bg);
      pal = chosen.map((c0) => {
        const c = THEME.light && lum(c0) > 0.72 ? mixRgb(c0, [0, 0, 0], 0.18) : c0;   // very light pieces darken a bit on light screens
        return {
          rgb: c, col: css(c), body: css(mixRgb(c, bg, THEME.light ? 0.55 : 0.62)),
          text: lum(c) > 0.62 ? '#17171a' : '#ffffff',
          a: (k) => css(c, k),
        };
      });
      return pal;
    }

    // ---------------------------------------------------------------- background (pre-rendered) + beat pulse
    let bgCanvas = null, bgKey = '';
    function drawBg(now) {
      const key = `${THEME.id}|${THEME.mode}|${THEME.c1}|${THEME.c2}|${THEME.bg}|${g.S}|${g.dpr}`;
      if (key !== bgKey) {
        bgKey = key;
        bgCanvas ||= document.createElement('canvas');
        bgCanvas.width = Math.max(1, Math.round(g.S * g.dpr)); bgCanvas.height = bgCanvas.width;
        const c2 = bgCanvas.getContext('2d');
        c2.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
        const real = g.ctx;
        g.ctx = c2;
        try { g.draw.bg({ glow: 0.13 }); } finally { g.ctx = real; }
      }
      const { ctx } = g;
      ctx.drawImage(bgCanvas, 0, 0, g.S, g.S);
      // beat pulse on the edge ring (stronger on the downbeat)
      if (beats.length > 1 && now > beats[0] - 200) {
        let lo = 0, hi = beats.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= now) lo = m; else hi = m; }
        if (beats[hi] <= now) lo = hi;
        const dtB = now - beats[lo];
        if (dtB >= 0 && dtB < 500) {
          const k = Math.exp(-dtB / 130), down = downSet.has(lo);
          ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R * 0.948, 0, TAU);
          ctx.strokeStyle = g.draw.alpha(g.color, (down ? 0.6 : 0.32) * k);
          ctx.lineWidth = g.R * (0.006 + (down ? 0.014 : 0.008) * k);
          ctx.stroke();
        }
      }
    }

    // ---------------------------------------------------------------- input
    const ptrs = new Map();           // pointers that are down: id → { x, y, a, r }
    const keysDown = new Set();
    const mouse = { x: 0, y: 0, over: false, moved: 0, a: 0, r: 0 };
    let relaxToast = false;
    const mouseMode = () => mouse.over && mouse.moved > g.R * 0.15;
    const onMouseMove = (e) => {
      if (e.pointerType !== 'mouse') return;
      const rc = g.canvas.getBoundingClientRect();
      const x = (e.clientX - rc.left) * (g.S / (rc.width || 1)), y = (e.clientY - rc.top) * (g.S / (rc.height || 1));
      if (mouse.over) mouse.moved += Math.hypot(x - mouse.x, y - mouse.y);
      // a mouse moving with a hit key held (and no button down) spins spinners
      if (R.state === 'play' && keysDown.size && !ptrs.has(e.pointerId)) spinMove(mouse, x, y);
      mouse.x = x; mouse.y = y; mouse.over = true;
    };
    const onMouseLeave = (e) => { if (e.pointerType === 'mouse') mouse.over = false; };
    g.canvas.addEventListener('pointermove', onMouseMove);
    g.canvas.addEventListener('pointerleave', onMouseLeave);
    // judge with the moment the input happened: the browser's event timestamp, caught on the way down (document,
    // capture phase) before the shell hands the event on — a busy frame then doesn't turn a perfect tap into a late
    // one. A stamp only counts inside the same dispatch (caught a moment ago); otherwise the handler time is used.
    let evStamp = -1, evAt = 0;
    const onStamp = (e) => { evStamp = e.timeStamp; evAt = performance.now(); };
    const STAMPED = ['pointerdown', 'pointerup', 'keydown', 'keyup'];
    for (const t of STAMPED) document.addEventListener(t, onStamp, true);
    const eventNow = () => {
      const p = performance.now();
      const lag = evStamp >= 0 && p - evAt < 8 ? p - evStamp : 0;
      evStamp = -1;
      return R.now() - clamp(lag, 0, 250);
    };

    /** The pending circle under (x, y): the earliest one there (stacks resolve in order). */
    function noteAt(x, y, now) {
      const rr = cr * g.R * 1.12;
      for (let i = scanFrom; i < notes.length; i++) {
        const n = notes[i];
        if (n.t - AR > now) break;
        if (n.done || n.spin || n.app > now) continue;
        const dx = x - n.x, dy = y - n.y;
        if (dx * dx + dy * dy <= rr * rr) return n;
      }
      return null;
    }
    function nextDue(now) {
      for (let i = scanFrom; i < notes.length; i++) {
        const n = notes[i];
        if (n.t - AR > now) break;
        if (!n.done && !n.spin) return n;
      }
      return null;
    }
    function tryHit(n, now) {
      const label = R.hit(n, now);
      if (label == null) { n.shake = fxClock; return null; }
      if (label === 'miss') return label;
      n.hitAt = now;
      if (n.holding) sliding.push(n);
      const p = pal[n.col % pal.length] || pal[0];
      fx.push({ k: 'hit', x: n.x, y: n.y, r: cr * g.R, col: p?.col || g.color, t: 0, big: label === 'perfect' });
      if (label === 'perfect' || label === 'great') g.draw.burst(n.x, n.y, p?.col || g.color, label === 'perfect' ? 8 : 5, g.R * 0.45, g.R * 0.01);
      g.sfx('tap', { volume: 0.7, pitch: label === 'perfect' ? 1.15 : 1 });
      return label;
    }
    const spinNote = (now) => {
      for (let i = scanFrom; i < notes.length; i++) {
        const n = notes[i];
        if (n.t - AR - 6000 > now) break;
        if (n.spin && !n.done && now >= n.spin.a && now <= n.spin.b) return n;
      }
      return null;
    };
    function spinAdd(turns) {
      const n = spinNote(R.now());
      if (!n) return;
      const s = n.spin;
      const before = Math.floor(s.rot);
      s.rot += turns;
      s.vis += turns;
      if (!s.cleared && s.rot >= s.need) { s.cleared = true; g.sfx('score'); fx.push({ k: 'ring', x: g.cx, y: g.cy, r: g.R * 0.5, col: g.color, t: 0 }); }
      else if (s.cleared && Math.floor(s.rot) > before) {
        const pts = 100 * R.multiplier;
        R.score += pts; g.add(pts); s.bonus += pts;
        g.sfx('coin', { volume: 0.6 });
      } else if (Math.floor(s.rot) > before) g.sfx('tick');
    }
    // spinning speed is capped (8 turns a second, like a fast human) so jittery input can't farm bonus points
    let spinBudget = 0, spinBudgetT = 0;
    function spinMove(p, x, y) {
      const dx = x - g.cx, dy = y - g.cy, r = Math.hypot(dx, dy) / g.R;
      let a = Math.atan2(dx, -dy);
      if (r > 0.06 && p.r > 0.06) {
        const d = angDiff(p.a, a);
        if (Math.abs(d) < 1.4) {
          const t = performance.now();
          spinBudget = Math.min(0.5, spinBudget + Math.max(0, t - spinBudgetT) * 0.008);
          spinBudgetT = t;
          const turn = Math.min(spinBudget, Math.abs(d) / TAU);
          spinBudget -= turn;
          if (turn > 0) spinAdd(turn);
        }
      }
      p.a = a; p.r = r;
    }

    g.on('down', (e) => {
      const p = { x: e.x, y: e.y, a: e.a, r: e.r };
      ptrs.set(e.id, p);
      if (!ready) return;
      const now = eventNow();
      const n = noteAt(e.x, e.y, now);
      if (n) tryHit(n, now);
    });
    g.on('move', (e) => {
      const p = ptrs.get(e.id);
      if (!p) return;
      if (ready) spinMove(p, e.x, e.y);
      p.x = e.x; p.y = e.y;
    });
    g.on('up', (e) => { ptrs.delete(e.id); if (ready) follow(eventNow(), true); });
    g.on('key', (e) => {
      if (!ready) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') { spinAdd(1 / 12); return; }
      if (!HIT_KEYS.has(k)) return;
      keysDown.add(k);
      const now = eventNow();
      if (mouseMode()) {
        mouse.a = Math.atan2(mouse.x - g.cx, -(mouse.y - g.cy)); mouse.r = Math.hypot(mouse.x - g.cx, mouse.y - g.cy) / g.R;
        const n = noteAt(mouse.x, mouse.y, now);
        if (n) tryHit(n, now);
      } else {
        if (spinNote(now)) { spinAdd(1 / 6); return; }
        const n = nextDue(now);
        if (n) {
          const l = tryHit(n, now);
          if (l && !relaxToast) { relaxToast = true; g.toast('Keys only · relax mode', 1300); }
        }
      }
    });
    g.on('keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!keysDown.delete(k)) return;
      if (ready) follow(eventNow(), true);
    });
    g.on('wheel', () => spinAdd(1 / 12));

    // ---------------------------------------------------------------- sliders: is the ball being followed?
    function ballAt(n, now, out) {
      const u = clamp((now - n.t) / n.dur, 0, 1) * n.spans;
      const k = Math.min(n.spans - 1, Math.floor(u));
      let f = u - k; if (k % 2) f = 1 - f;
      lutAt(n.path, f, out);
      out[0] = g.cx + out[0] * g.R; out[1] = g.cy + out[1] * g.R;
      return out;
    }
    function following(n, now) {
      const [bx, by] = ballAt(n, now, tmp);
      const fr = cr * g.R * 2.4, fr2 = fr * fr;
      for (const p of ptrs.values()) { const dx = p.x - bx, dy = p.y - by; if (dx * dx + dy * dy <= fr2) return true; }
      if (keysDown.size) {
        if (!mouseMode()) return true;                       // keys-only relax: a held key is enough
        const dx = mouse.x - bx, dy = mouse.y - by;
        if (dx * dx + dy * dy <= fr2) return true;
      }
      return false;
    }
    function follow(now, immediate = false) {
      for (let i = sliding.length - 1; i >= 0; i--) {
        const n = sliding[i];
        if (!n.holding) { sliding.splice(i, 1); continue; }
        // repeats passed while holding: a little bonus + tick
        const reps = Math.min(n.spans - 1, Math.floor(clamp((now - n.t) / n.dur, 0, 1) * n.spans));
        if (reps > (n.reps || 0)) {
          n.reps = reps;
          const pts = 30 * R.multiplier; R.score += pts; g.score(R.score);
          ballAt(n, now, tmp);
          fx.push({ k: 'ring', x: tmp[0], y: tmp[1], r: cr * g.R, col: (pal[n.col % pal.length] || pal[0])?.col || g.color, t: 0 });
          g.sfx('tick');
        }
        if (following(n, now)) { n.lost = 0; continue; }
        if (!immediate && !n.lost) { n.lost = now; continue; }
        if (!immediate && now - n.lost < 90) continue;
        const [bx, by] = ballAt(n, now, tmp);
        const l = R.release(n, now);
        if (l === 'miss') {
          R.popup('miss', bx, by - g.R * 0.08);
          fx.push({ k: 'miss', x: bx, y: by, r: cr * g.R * 0.8, t: 0 });
        }
      }
    }

    // ---------------------------------------------------------------- drawing
    function drawCircle(x, y, r, p, alpha, num) {
      const { ctx } = g;
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = p.col; ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.11);
      ctx.strokeStyle = 'rgba(255,255,255,.92)';
      ctx.beginPath(); ctx.arc(x, y, r * 0.89, 0, TAU); ctx.stroke();
      ctx.lineWidth = Math.max(1, g.R * 0.004);
      ctx.strokeStyle = THEME.ink(THEME.light ? 0.45 : 0.25);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      if (num != null) {
        ctx.fillStyle = p.text;
        ctx.fillText(String(num), x, y + r * 0.04);
      }
      ctx.globalAlpha = 1;
    }
    function drawApproach(x, y, k, p, alpha) {
      const { ctx } = g;
      const r = cr * g.R * (1 + 2.3 * (1 - k));
      ctx.globalAlpha = alpha * (0.35 + 0.65 * k);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(2, cr * g.R * 0.09); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    function pathStroke(n) {
      const { ctx } = g, L = n.path.lut, N = n.path.N;
      ctx.beginPath();
      ctx.moveTo(g.cx + L[0] * g.R, g.cy + L[1] * g.R);
      for (let k = 1; k <= N; k++) ctx.lineTo(g.cx + L[2 * k] * g.R, g.cy + L[2 * k + 1] * g.R);
    }
    function drawArrow(n, atEnd, p, alpha) {
      // reverse arrow: a chevron at the end of the path pointing back along it
      const { ctx } = g, L = n.path.lut, N = n.path.N;
      const i0 = atEnd ? N : 0, i1 = atEnd ? N - 2 : 2;
      const x = g.cx + L[2 * i0] * g.R, y = g.cy + L[2 * i0 + 1] * g.R;
      const a = Math.atan2(L[2 * i1 + 1] - L[2 * i0 + 1], L[2 * i1] - L[2 * i0]);
      const s = cr * g.R * 0.5 * (1 + 0.08 * Math.sin(fxClock * 10));
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = THEME.fg;
      ctx.lineWidth = Math.max(2, cr * g.R * 0.16); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a + 2.4) * s * 0.9 + Math.cos(a) * s * 0.5, y + Math.sin(a + 2.4) * s * 0.9 + Math.sin(a) * s * 0.5);
      ctx.lineTo(x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5);
      ctx.lineTo(x + Math.cos(a - 2.4) * s * 0.9 + Math.cos(a) * s * 0.5, y + Math.sin(a - 2.4) * s * 0.9 + Math.sin(a) * s * 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    function drawSlider(n, now, p) {
      const { ctx } = g;
      const end = n.t + n.dur;
      const fadeIn = clamp((now - n.app) / Math.min(400, AR * 0.45), 0, 1);
      let alpha = fadeIn;
      const dead = n.done && !n.holding && !n.held;       // head missed or dropped
      if (n.held || (n.done && !n.holding && n.judged !== 'miss' && !n.dropped)) alpha *= clamp(1 - (now - end) / 220, 0, 1);
      else if (dead) alpha *= 0.35 * clamp(1 - (now - Math.max(end - 200, n.t)) / 300, 0, 1);
      if (alpha <= 0.01) return;
      const rpx = cr * g.R;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalAlpha = alpha;
      pathStroke(n);
      ctx.strokeStyle = THEME.light ? THEME.ink(0.55) : 'rgba(255,255,255,.88)';
      ctx.lineWidth = rpx * 2; ctx.stroke();
      ctx.strokeStyle = p.body; ctx.lineWidth = rpx * 1.8; ctx.stroke();
      ctx.globalAlpha = 1;
      // tail circle
      const L = n.path.lut, N = n.path.N;
      const tx = g.cx + L[2 * N] * g.R, ty = g.cy + L[2 * N + 1] * g.R;
      ctx.globalAlpha = alpha * 0.9;
      ctx.beginPath(); ctx.arc(tx, ty, rpx * 0.89, 0, TAU);
      ctx.strokeStyle = THEME.light ? THEME.ink(0.5) : 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1, rpx * 0.1); ctx.stroke();
      ctx.globalAlpha = 1;
      // reverse arrows still to come
      if (n.spans > 1 && !dead) {
        const u = n.holding || n.done ? clamp((now - n.t) / n.dur, 0, 1) * n.spans : 0;
        const k = Math.floor(u);
        if (k < n.spans - 1) drawArrow(n, k % 2 === 0, p, alpha);
      }
      if (n.holding) {
        const [bx, by] = ballAt(n, now, tmp);
        const fk = clamp((now - (n.hitAt ?? n.t)) / 120, 0, 1);
        const ok = !n.lost;
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(bx, by, rpx * (1.1 + 1.0 * ease.out(fk)), 0, TAU);
        ctx.strokeStyle = ok ? THEME.ink(0.75) : THEME.danger; ctx.lineWidth = Math.max(2, rpx * 0.08); ctx.stroke();
        ctx.globalAlpha = 1;
        g.draw.ball(bx, by, rpx * 0.82, p.col);
        ctx.beginPath(); ctx.arc(bx, by, rpx * 0.82, 0, TAU);
        ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = Math.max(1, rpx * 0.1); ctx.stroke();
      }
    }
    function drawNote(n, now) {
      const p = pal[n.col % pal.length] || pal[0];
      if (n.dur > 0) drawSlider(n, now, p);
      if (n.done) return;
      const fadeIn = clamp((now - n.app) / Math.min(400, AR * 0.45), 0, 1);
      if (fadeIn <= 0) return;
      let x = n.x, y = n.y;
      if (n.shake != null && fxClock - n.shake < 0.25) x += Math.sin((fxClock - n.shake) * 70) * g.R * 0.012 * (1 - (fxClock - n.shake) / 0.25);
      drawCircle(x, y, cr * g.R, p, fadeIn, n.num);
      const k = clamp((now - (n.t - AR)) / AR, 0, 1);
      if (now < n.t + 40) drawApproach(x, y, k, p, fadeIn);
    }
    function drawSpinner(n, now) {
      const s = n.spin, { cx, cy } = g;
      const fade = clamp((now - n.app) / 400, 0, 1) * (n.done ? clamp(1 - (now - s.b) / 300, 0, 1) : 1);
      if (fade <= 0) return;
      const rr = g.R * 0.5, k = clamp((now - s.a) / (s.b - s.a), 0, 1);
      const prog = clamp(s.rot / s.need, 0, 1);
      const p = pal[0];
      const { ctx } = g;
      ctx.globalAlpha = fade;
      g.draw.circle(cx, cy, rr, THEME.ink(0.05), { stroke: THEME.ink(0.2), lw: Math.max(1.5, g.R * 0.006) });
      g.draw.arc(cx, cy, rr * 0.86, 0, TAU, THEME.ink(0.08), g.R * 0.04);
      if (prog > 0.003) g.draw.arc(cx, cy, rr * 0.86, 0, TAU * prog, s.cleared ? g.color : p.col, g.R * 0.04, { glow: s.cleared ? g.R * 0.04 : 0 });
      // the spinning disc
      const ang = s.vis * TAU;
      for (let i = 0; i < 3; i++) {
        const a0 = ang + (i * TAU) / 3;
        g.draw.arc(cx, cy, rr * 0.62, a0, a0 + 1.1, p.a(0.85), g.R * 0.03);
      }
      g.draw.ball(cx, cy, rr * 0.2, p.col);
      ctx.beginPath(); ctx.arc(cx, cy, rr * 0.2, 0, TAU); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1, g.R * 0.006); ctx.stroke();
      // closing ring = time left
      if (!n.done && k < 1) {
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, rr * (1 - k)), 0, TAU);
        ctx.strokeStyle = THEME.ink(0.5); ctx.lineWidth = Math.max(1.5, g.R * 0.006); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const label = now < s.a ? 'SPIN!' : s.cleared ? (s.bonus ? `+${s.bonus}` : 'CLEAR') : `${Math.floor(s.rot)} / ${s.need}`;
      g.draw.text(label, cx, cy + rr * 0.42, g.R * (now < s.a || s.cleared ? 0.07 : 0.055), { color: s.cleared ? g.color : THEME.fg, alpha: fade });
      if (now < s.a + 800 && !n.done) g.draw.text('spin around the centre', cx, cy - rr * 0.42, g.R * 0.04, { color: THEME.muted, weight: 700, font: THEME.font, alpha: fade });
    }
    // follow points: a dashed trail from one circle to the next
    const DASH = [0, 0], NODASH = [];
    function drawFollow(a, b, now) {
      if (now < b.app || now > b.t) return;
      const x0 = g.cx + a.ex * g.R, y0 = g.cy + a.ey * g.R, x1 = b.x, y1 = b.y;
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), rpx = cr * g.R;
      if (len < rpx * 2.6) return;
      const aEnd = a.t + (a.dur || 0);
      const f1 = ease.out(clamp((now - b.app) / Math.max(1, AR * 0.5), 0, 1));
      const f0 = clamp((now - aEnd) / Math.max(1, b.t - aEnd), 0, 1);
      const s0 = rpx + (len - 2 * rpx) * f0, s1 = rpx + (len - 2 * rpx) * f1;
      if (s1 - s0 < 2) return;
      const { ctx } = g, ux = dx / len, uy = dy / len;
      DASH[0] = rpx * 0.22; DASH[1] = rpx * 0.34;
      ctx.setLineDash(DASH);
      ctx.lineDashOffset = -fxClock * rpx * 1.2;
      ctx.beginPath(); ctx.moveTo(x0 + ux * s0, y0 + uy * s0); ctx.lineTo(x0 + ux * s1, y0 + uy * s1);
      ctx.strokeStyle = THEME.ink(0.32); ctx.lineWidth = Math.max(1.5, rpx * 0.09); ctx.lineCap = 'round'; ctx.stroke();
      ctx.setLineDash(NODASH);
    }
    function drawFx(dt) {
      const { ctx } = g;
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i]; f.t += dt;
        if (f.k === 'hit') {
          if (f.t > 0.28) { fx.splice(i, 1); continue; }
          const k = f.t / 0.28, e = ease.out(k);
          ctx.globalAlpha = (1 - k) * (1 - k) * 0.6;
          ctx.fillStyle = f.col; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 + 0.3 * e), 0, TAU); ctx.fill();
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = THEME.light ? THEME.ink(0.6) : 'rgba(255,255,255,.95)'; ctx.lineWidth = Math.max(1, f.r * 0.08 * (1 - k));
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 + 0.7 * e), 0, TAU); ctx.stroke();
        } else if (f.k === 'ring') {
          if (f.t > 0.35) { fx.splice(i, 1); continue; }
          const k = f.t / 0.35;
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = f.col; ctx.lineWidth = Math.max(1.5, g.R * 0.01 * (1 - k));
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 + 0.5 * ease.out(k)), 0, TAU); ctx.stroke();
        } else if (f.k === 'miss') {
          if (f.t > 0.6) { fx.splice(i, 1); continue; }
          const k = f.t / 0.6, s = f.r * 0.55 * (0.8 + 0.3 * ease.out(Math.min(1, f.t / 0.12)));
          ctx.globalAlpha = 1 - k * k;
          ctx.strokeStyle = THEME.danger; ctx.lineWidth = Math.max(2, f.r * 0.16); ctx.lineCap = 'round';
          const y = f.y + k * f.r * 0.3;
          ctx.beginPath();
          ctx.moveTo(f.x - s, y - s); ctx.lineTo(f.x + s, y + s);
          ctx.moveTo(f.x + s, y - s); ctx.lineTo(f.x - s, y + s);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---------------------------------------------------------------- frame
    const vis = [];
    g.loop(frame);
    function frame(dt) {
      if (!R.drawPre(dt)) return;
      fxClock += dt;
      const now = R.now();
      drawBg(now);
      if (!ready) return;
      palette();
      warmGlyphs();
      follow(now);
      // spinner results; misses the kit judged on its own (circles that passed) get their X
      for (let i = fxScan; i < notes.length; i++) {
        const n = notes[i];
        if (n.t > now + 500) break;
        if (n.spin && !n.done && now >= n.spin.b) {
          const s = n.spin, q = s.rot / s.need, W = R.windows;
          const d = q >= 1 ? 0 : q >= 0.7 ? (W.perfect + W.great) / 2 : q >= 0.4 ? (W.great + W.good) / 2 : null;
          if (d == null) R.missed(n); else R.hit(n, n.t + d);
        }
        if (n.done && !n.fxd) {
          n.fxd = true;
          if (n.judged === 'miss' && !n.spin) fx.push({ k: 'miss', x: n.x, y: n.y, r: cr * g.R, t: 0 });
        }
        if (n.dur > 0 && n.held && !n.endFx) {
          n.endFx = true;
          const L = n.path.lut, N = n.path.N, e = n.spans % 2 ? N : 0;
          fx.push({ k: 'ring', x: g.cx + L[2 * e] * g.R, y: g.cy + L[2 * e + 1] * g.R, r: cr * g.R, col: (pal[n.col % pal.length] || pal[0]).col, t: 0 });
        }
        if (i === fxScan && n.done && (!(n.dur > 0) || n.held || n.dropped || !n.holding) && now > n.t + (n.dur || 0)) fxScan++;
      }
      while (scanFrom < notes.length && notes[scanFrom].done) scanFrom++;
      while (drawFrom < notes.length && notes[drawFrom].done && !notes[drawFrom].holding && now > notes[drawFrom].t + (notes[drawFrom].dur || 0) + 800) drawFrom++;
      // collect what's on screen
      vis.length = 0;
      for (let i = drawFrom; i < notes.length; i++) {
        const n = notes[i];
        if (n.t - AR - 6000 > now) break;
        if (n.app > now) continue;
        if (n.done && !n.holding && now > n.t + (n.dur || 0) + 400) continue;
        vis.push(n);
      }
      // spinners underneath, then follow points, then circles — the earliest on top
      for (const n of vis) if (n.spin) drawSpinner(n, now);
      for (let i = 0; i < vis.length; i++) {
        const b = vis[i];
        if (b.spin || b.done) continue;
        const a = notes[b.id - 1];
        if (a && !a.spin) drawFollow(a, b, now);
      }
      const { ctx } = g;
      ctx.font = `700 ${cr * g.R * 0.92}px ${THEME.display}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = vis.length - 1; i >= 0; i--) if (!vis[i].spin) drawNote(vis[i], now);
      drawFx(dt);
      g.draw.particles(dt);
      drawPops(dt);
    }

    return {
      destroy() {
        g.canvas.removeEventListener('pointermove', onMouseMove);
        g.canvas.removeEventListener('pointerleave', onMouseLeave);
        for (const t of STAMPED) document.removeEventListener(t, onStamp, true);
        R.handle.destroy();
      },
      pause() { R.handle.pause(); },
      resume() { ptrs.clear(); keysDown.clear(); R.handle.resume(); },
    };
  },
};
