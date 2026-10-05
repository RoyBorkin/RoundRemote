// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Rope Snip — level data and the deterministic rope physics (no imports, so the tests / solver can run it headless).
//
// Coordinates: the round screen is the unit circle, centre (0, 0), x to the right, y DOWN (1 = the edge).
// A level:
//   candy:   [x, y]                       where the sweet starts
//   critter: [x, y]                       the hungry critter (feed it the sweet)
//   ropes:   [[ax, ay, len?, track?], …]  a rope from a pin to the sweet; len defaults to the distance.
//            track (moving pin): { to: [x, y], T }  ping-pong between the pin and `to` (T s per round trip)
//                                { c: [x, y], T }   circle around c (T < 0 = anticlockwise)
//   stars:   [[x, y] × 3]
//   bubbles: [[x, y]]                     the sweet touching one gets wrapped and floats up (tap to pop)
//   puffers: [[x, y, angle]]              tap to blow air; angle in degrees, 0 = up, clockwise
//   autos:   [[x, y, r, track?]]          a pin that ties a new rope on when the sweet comes within r
//   spikes:  [[x1, y1, x2, y2]]           a spiky bar — it bursts the sweet
//   flip:    [x, y]                       a gravity button (tap to turn gravity upside down)
//   hint:    'text'                       a short line shown when the level starts

export const H = 1 / 120;          // fixed physics step (s)
export const GRAV = 2.4;           // gravity, screen radii / s²
export const CANDY_R = 0.055, CRIT_R = 0.12, STAR_R = 0.058, BUBBLE_R = 0.085, PUFF_R = 0.075, FLIP_R = 0.075;
const ITER = 8;                    // constraint passes per step
const CANDY_IM = 0.25;             // inverse mass of the sweet (rope nodes are 1 → the sweet is 4× heavier)
const FEED = 0.13, STAR_HIT = CANDY_R + STAR_R * 0.75, BUBBLE_HIT = CANDY_R + BUBBLE_R * 0.6, SPIKE_HIT = CANDY_R + 0.02;
const CAP = 600;

export const ropeSegs = (L) => Math.max(6, Math.min(16, Math.round(L / 0.06)));

function segHit(ax, ay, bx, by, cx, cy, dx, dy) {   // do segments AB and CD cross?
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-12) return false;
  const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}
export function segDist(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1, vy = y2 - y1, l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / l2)) : 0;
  return Math.hypot(px - x1 - vx * t, py - y1 - vy * t);
}

/** A pin (fixed or moving on a track). */
function makePin(x, y, track) {
  const p = { x, y, x0: x, y0: y, track: track || null, a0: 0, rad: 0 };
  if (track?.c) { p.rad = Math.hypot(x - track.c[0], y - track.c[1]); p.a0 = Math.atan2(y - track.c[1], x - track.c[0]); }
  return p;
}
function pinAt(p, t) {
  const tr = p.track;
  if (!tr) return;
  if (tr.to) {
    const k = (1 - Math.cos((2 * Math.PI * t) / tr.T)) / 2;
    p.x = p.x0 + (tr.to[0] - p.x0) * k; p.y = p.y0 + (tr.to[1] - p.y0) * k;
  } else if (tr.c) {
    const a = p.a0 + (2 * Math.PI * t) / tr.T;
    p.x = tr.c[0] + Math.cos(a) * p.rad; p.y = tr.c[1] + Math.sin(a) * p.rad;
  }
}

/**
 * The simulation of one level. step() advances H seconds. The game and the solver call the same actions:
 * cutLine(x1, y1, x2, y2) / cut(rope), pop(), puff(i), flip(). Things that happened are pushed to `events`.
 */
export class Sim {
  constructor(lv) {
    this.lv = lv;
    this.px = new Float64Array(CAP); this.py = new Float64Array(CAP);
    this.ox = new Float64Array(CAP); this.oy = new Float64Array(CAP); this.im = new Float64Array(CAP);
    this.np = 1;
    this.px[0] = this.ox[0] = lv.candy[0]; this.py[0] = this.oy[0] = lv.candy[1]; this.im[0] = CANDY_IM;
    this.t = 0; this.steps = 0; this.state = 'run'; this.why = ''; this.gdir = 1; this.bubbled = false; this.gone = false;
    this.events = [];
    this.pins = []; this.ropes = [];
    for (const r of lv.ropes || []) this.addRope(this.pin(makePin(r[0], r[1], r[3])), r[2] || 0);
    this.stars = (lv.stars || []).map(([x, y]) => ({ x, y, got: false }));
    this.bubbles = (lv.bubbles || []).map(([x, y]) => ({ x, y, used: false }));
    this.puffers = (lv.puffers || []).map(([x, y, a]) => ({ x, y, a: (a * Math.PI) / 180, dx: Math.sin((a * Math.PI) / 180), dy: -Math.cos((a * Math.PI) / 180) }));
    this.autos = (lv.autos || []).map(([x, y, r, tr]) => ({ pin: this.pin(makePin(x, y, tr)), r, used: false }));
    this.spikes = (lv.spikes || []).map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));
    this.critter = { x: lv.critter[0], y: lv.critter[1] };
    this.flipBtn = lv.flip ? { x: lv.flip[0], y: lv.flip[1] } : null;
  }
  pin(p) { this.pins.push(p); return p; }
  get stars3() { let n = 0; for (const s of this.stars) if (s.got) n++; return n; }
  get cx() { return this.px[0]; }
  get cy() { return this.py[0]; }
  get vx() { return (this.px[0] - this.ox[0]) / H; }
  get vy() { return (this.py[0] - this.oy[0]) / H; }

  /** Tie a rope from pin p to the sweet (length L, 0 = the current distance). */
  addRope(p, L) {
    const { px, py, ox, oy, im } = this;
    const d = Math.hypot(px[0] - p.x, py[0] - p.y);
    L = L || d;
    const n = ropeSegs(L);
    if (this.np + n + 1 > CAP) return null;
    const idx = new Int16Array(n + 1);
    const vx = px[0] - ox[0], vy = py[0] - oy[0];
    for (let k = 0; k < n; k++) {
      const i = this.np++, f = k / n;
      px[i] = p.x + (px[0] - p.x) * f; py[i] = p.y + (py[0] - p.y) * f;
      ox[i] = px[i] - vx * f; oy[i] = py[i] - vy * f;   // the new rope moves along with the sweet
      im[i] = k === 0 ? 0 : 1;
      idx[k] = i;
    }
    idx[n] = 0;
    const rope = { pin: p, idx, n, rest: L / n, L, cut: -1, fade: 0, alive: true, born: this.t, id: this.ropes.length };
    this.ropes.push(rope);
    return rope;
  }

  step() {
    const { px, py, ox, oy, im, ropes } = this;
    this.t += H; this.steps++;
    for (const p of this.pins) pinAt(p, this.t);
    for (const r of ropes) if (r.alive) { const a = r.idx[0]; ox[a] = px[a]; oy[a] = py[a]; px[a] = r.pin.x; py[a] = r.pin.y; }
    // integrate (Verlet)
    const g = GRAV * this.gdir * H * H;
    const frozen = this.state === 'won' || this.gone;
    for (let i = 0; i < this.np; i++) {
      if (im[i] === 0) continue;
      if (i === 0) {
        if (frozen) continue;
        const damp = this.bubbled ? 0.985 : 0.9993;
        const vx = (px[0] - ox[0]) * damp, vy = (py[0] - oy[0]) * damp;
        ox[0] = px[0]; oy[0] = py[0];
        px[0] += vx; py[0] += vy + (this.bubbled ? -0.4 * g : g);
      } else {
        const vx = (px[i] - ox[i]) * 0.998, vy = (py[i] - oy[i]) * 0.998;
        ox[i] = px[i]; oy[i] = py[i];
        px[i] += vx; py[i] += vy + g;
      }
    }
    // constraints
    for (let it = 0; it < ITER; it++) {
      for (const r of ropes) {
        if (!r.alive) continue;
        const { idx, n, rest, cut } = r;
        for (let k = 0; k < n; k++) {
          if (k === cut) continue;
          const a = idx[k], b = idx[k + 1];
          const wa = im[a], wb = b === 0 && (cut >= 0 || frozen) ? 0 : im[b];
          const w = wa + wb;
          if (!w) continue;
          const dx = px[b] - px[a], dy = py[b] - py[a];
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 1e-9) continue;
          const f = (d - rest) / (d * w);
          px[a] += dx * f * wa; py[a] += dy * f * wa;
          px[b] -= dx * f * wb; py[b] -= dy * f * wb;
        }
        // leash: the sweet can't get further from the pin than the rope is long
        if (cut < 0 && !frozen) {
          const dx = px[0] - r.pin.x, dy = py[0] - r.pin.y, d = Math.sqrt(dx * dx + dy * dy), m = r.L * 1.03;
          if (d > m) { px[0] = r.pin.x + (dx / d) * m; py[0] = r.pin.y + (dy / d) * m; }
        }
      }
    }
    for (const r of ropes) if (r.alive && r.cut >= 0 && (r.fade += H) > 1.4) r.alive = false;
    if (this.state === 'run') this.interact();
    else if (this.state === 'lost' && !this.gone) this.lostT += H;
  }

  interact() {
    const x = this.px[0], y = this.py[0];
    for (const s of this.stars) if (!s.got && Math.hypot(x - s.x, y - s.y) < STAR_HIT) { s.got = true; this.events.push({ type: 'star', s }); }
    if (!this.bubbled) for (const b of this.bubbles) {
      if (!b.used && Math.hypot(x - b.x, y - b.y) < BUBBLE_HIT) {
        b.used = true; this.bubbled = true;
        this.ox[0] = x - (x - this.ox[0]) * 0.25; this.oy[0] = y - (y - this.oy[0]) * 0.25;   // the bubble soaks up most of the speed
        this.events.push({ type: 'bubble', b }); break; }
    }
    for (const a of this.autos) {
      if (!a.used && Math.hypot(x - a.pin.x, y - a.pin.y) < a.r) { a.used = true; const r = this.addRope(a.pin, 0); this.events.push({ type: 'tie', a, r }); }
    }
    for (const s of this.spikes) if (segDist(x, y, s.x1, s.y1, s.x2, s.y2) < SPIKE_HIT) { this.lose('spike'); return; }
    if (Math.hypot(x - this.critter.x, y - this.critter.y) < FEED) { this.win(); return; }
    if (Math.hypot(x, y) > 1.12) this.lose('out');
  }
  detach() { for (const r of this.ropes) if (r.alive && r.cut < 0) { r.cut = r.n - 1; r.fade = 0.4; } }
  win() { this.state = 'won'; this.bubbled = false; this.detach(); this.events.push({ type: 'won' }); }
  lose(why) {
    this.state = 'lost'; this.why = why; this.lostT = 0;
    if (why === 'spike') { this.gone = true; this.bubbled = false; this.detach(); }
    this.events.push({ type: 'lost', why });
  }

  // ---- actions ----
  cut(r, k = -1) {
    if (!r || !r.alive || r.cut >= 0) return false;
    r.cut = k >= 0 ? k : r.n >> 1; r.fade = 0;
    this.events.push({ type: 'cut', r });
    return true;
  }
  /** A swipe from (x1,y1) to (x2,y2) cuts every rope it crosses. Returns how many. */
  cutLine(x1, y1, x2, y2) {
    const { px, py } = this;
    let n = 0;
    for (const r of this.ropes) {
      if (!r.alive || r.cut >= 0) continue;
      for (let k = 0; k < r.n; k++) {
        const a = r.idx[k], b = r.idx[k + 1];
        if (segHit(x1, y1, x2, y2, px[a], py[a], px[b], py[b])) { this.cut(r, k); n++; break; }
      }
    }
    return n;
  }
  pop() {
    if (!this.bubbled || this.state !== 'run') return false;
    this.bubbled = false; this.events.push({ type: 'pop' });
    return true;
  }
  puff(i) {
    const p = this.puffers[i];
    if (!p || this.state !== 'run') return false;
    this.events.push({ type: 'puff', p });
    const dx = this.px[0] - p.x, dy = this.py[0] - p.y;
    const along = dx * p.dx + dy * p.dy, side = Math.abs(dx * p.dy - dy * p.dx);
    if (along > 0 && along < 0.85 && side < 0.12 + along * 0.3) {
      const k = (this.bubbled ? 0.6 : 1.1) * (1 - (along / 0.85) * 0.5) * H;
      this.ox[0] -= p.dx * k; this.oy[0] -= p.dy * k;
    }
    return true;
  }
  flip() {
    if (!this.flipBtn || this.state !== 'run') return false;
    this.gdir = -this.gdir; this.events.push({ type: 'flip' });
    return true;
  }
}

// ------------------------------------------------------------------------------------------------ levels
const L = (o) => o;
export const BOXES = [
  {
    name: 'Cardboard Box', col: '#f59e0b',
    levels: [
      {hint: "Swipe across the rope",candy: [0, -0.28],ropes: [[0, -0.62]],critter: [0, 0.56],stars: [[0, -0.06], [0, 0.12], [0, 0.3]]},
      {hint: "Cut one, then the other",candy: [0, -0.2],ropes: [[-0.42, -0.55], [0.42, -0.55]],critter: [-0.3, 0.52],stars: [[-0.09, -0.13], [-0.15, 0.06], [-0.19, 0.25]]},
      {hint: "Cut at the right moment",candy: [-0.5, -0.42],ropes: [[0, -0.55]],critter: [0.32, 0.5],stars: [[-0.22, -0.08], [0.31, -0.13], [0.39, -0.09]]},
      {candy: [0, -0.3],ropes: [[-0.38, -0.5], [0.38, -0.5], [0, -0.62]],critter: [0.3, 0.52],stars: [[0.07, -0.19], [0.18, 0.01], [0.24, 0.22]]},
      {candy: [-0.3, -0.45],ropes: [[-0.3, -0.62], [0, -0.55, 0.6]],critter: [0.28, 0.52],stars: [[-0.22, -0.18], [0.03, 0.02], [0.3, 0.04]]},
      {hint: "Rings tie on a new rope",candy: [-0.25, -0.35],ropes: [[-0.25, -0.62]],autos: [[0.05, 0.05, 0.35]],critter: [0.3, 0.55],stars: [[-0.29, 0.12], [0.17, 0.38], [0.36, -0.08]]},
      {candy: [-0.42, -0.4],ropes: [[-0.42, -0.62]],autos: [[-0.12, -0.12, 0.34], [0.42, 0.02, 0.3]],critter: [0.32, 0.56],stars: [[-0.44, -0.03], [-0.09, 0.22], [0.18, 0.05]]},
      {hint: "Spikes burst the sweet",candy: [0, -0.25],ropes: [[0.35, -0.55], [-0.3, -0.45]],spikes: [[0.12, 0.12, 0.6, 0.12]],critter: [-0.2, 0.52],stars: [[0.32, -0.1], [0.55, -0.14], [0.08, 0.02]]},
      {candy: [0.4, -0.4],ropes: [[0.4, -0.6]],autos: [[0.1, -0.05, 0.36]],spikes: [[0.25, 0.42, 0.62, 0.42]],critter: [-0.4, 0.42],stars: [[0.45, -0.12], [0.34, 0.22], [0.02, 0.32]]},
      {candy: [-0.3, -0.25],ropes: [[-0.62, -0.25], [0.1, -0.55]],spikes: [[-0.6, 0.22, -0.14, 0.22], [0.14, 0.22, 0.6, 0.22]],critter: [0, 0.55],stars: [[-0.2, -0.15], [-0.11, 0.05], [-0.04, 0.25]]},
      {candy: [0.35, -0.45],ropes: [[0.35, -0.62]],autos: [[0.05, -0.2, 0.33], [-0.35, 0.1, 0.3], [0.1, 0.38, 0.25]],critter: [0.45, 0.4],stars: [[0.29, 0.02], [-0.15, 0.04], [-0.09, 0.54]]},
      {candy: [0, -0.3],ropes: [[-0.4, -0.5], [0.4, -0.5], [0, -0.62]],autos: [[0.3, 0.15, 0.3]],spikes: [[-0.15, 0.25, 0.15, 0.25]],critter: [-0.25, 0.55],stars: [[0.06, -0.31], [-0.17, -0.1], [-0.27, 0.19]]},
    ],
  },
  {
    name: 'Bubble Wrap', col: '#38bdf8',
    levels: [
      {hint: "Bubbles float up",candy: [0, 0.12],ropes: [[0, -0.05]],bubbles: [[0, 0.42]],critter: [0, -0.5],stars: [[0, 0.3], [0, -0.05], [0, -0.25]]},
      {hint: "Tap the bubble to pop",candy: [0, -0.05],ropes: [[0, -0.25]],bubbles: [[0, 0.18]],critter: [0, 0.6],stars: [[0, 0.07], [0, -0.38], [0, -0.56]]},
      {hint: "Tap a puffer to blow",candy: [-0.4, -0.15],ropes: [[-0.4, -0.4]],bubbles: [[-0.4, 0.25]],puffers: [[-0.72, -0.05, 90]],critter: [0.22, -0.32],stars: [[-0.4, 0.09], [-0.16, 0.17], [0.04, -0.02]]},
      {candy: [0, -0.1],ropes: [[0, -0.5]],puffers: [[-0.62, -0.1, 90]],critter: [0.45, 0.35],stars: [[0.13, -0.12], [0.25, -0.01], [0.32, 0.12]]},
      {candy: [0.3, -0.1],ropes: [[0.3, -0.35]],bubbles: [[0.3, 0.25]],spikes: [[0.08, -0.52, 0.52, -0.52]],puffers: [[0.72, -0.22, 270]],critter: [-0.3, 0.5],stars: [[0.29, -0.02], [-0.07, -0.48], [-0.22, -0.11]]},
      {candy: [-0.45, -0.1],ropes: [[-0.45, -0.35]],bubbles: [[-0.45, 0.25]],autos: [[-0.15, -0.4, 0.35]],critter: [0.35, 0.45],stars: [[-0.45, 0.06], [-0.38, -0.15], [0.02, 0.03]]},
      {candy: [-0.1, 0.05],ropes: [[-0.1, -0.15]],bubbles: [[-0.1, 0.35]],spikes: [[0.15, -0.05, 0.15, 0.55]],puffers: [[-0.66, -0.08, 90]],critter: [0.36, -0.5],stars: [[-0.1, 0.25], [0.01, 0], [0.14, -0.24]]},
      {candy: [0, -0.35],ropes: [[0, -0.6]],spikes: [[-0.22, 0.18, 0.12, 0.18]],puffers: [[-0.55, -0.1, 90]],critter: [0.3, 0.55],stars: [[0.04, -0.17], [0.18, 0.05], [0.28, 0.25]]},
      {candy: [-0.5, -0.3],ropes: [[0, -0.45]],bubbles: [[0, 0.08]],critter: [0.35, -0.5],stars: [[-0.34, -0.08], [-0.06, 0.05], [0.15, -0.18]]},
      {candy: [0, -0.2],ropes: [[-0.4, -0.5], [0.25, -0.55]],bubbles: [[0.42, -0.2]],spikes: [[-0.6, 0.35, 0.2, 0.35]],critter: [0.5, -0.42],stars: [[0.05, -0.17], [0.23, -0.12], [0.38, -0.18]]},
      {candy: [0.4, -0.35],ropes: [[0.4, -0.6]],bubbles: [[0.4, 0.3]],autos: [[0.05, -0.35, 0.36], [-0.4, 0.05, 0.3]],critter: [-0.15, 0.55],stars: [[0.19, -0.15], [-0.09, -0.08], [-0.1, 0.12]]},
      {candy: [-0.4, -0.3],ropes: [[-0.4, -0.55]],bubbles: [[-0.4, 0.2]],puffers: [[-0.75, -0.2, 90], [0.2, -0.75, 180]],spikes: [[-0.1, -0.05, 0.6, -0.05]],autos: [[0.35, 0.15, 0.3]],critter: [0.1, 0.55],stars: [[-0.4, 0.04], [-0.35, -0.12], [-0.05, 0.13]]},
    ],
  },
  {
    name: 'Toy Shop', col: '#a78bfa',
    levels: [
      {hint: "Some pins ride on rails",candy: [-0.45, -0.3],ropes: [[-0.45, -0.55, 0, {to: [0.45, -0.55],T: 5}]],critter: [0.3, 0.5],stars: [[-0.21, -0.32], [0.01, -0.09], [0.13, 0.16]]},
      {candy: [-0.4, -0.25],ropes: [[-0.4, -0.58, 0, {to: [0.4, -0.58],T: 4}]],spikes: [[-0.6, 0.2, -0.12, 0.2], [0.12, 0.2, 0.6, 0.2]],critter: [0, 0.55],stars: [[-0.22, -0.26], [-0.1, -0.02], [-0.03, 0.21]]},
      {candy: [0.25, 0],ropes: [[0.25, -0.3, 0, {c: [0, -0.3],T: 3}]],critter: [-0.35, 0.5],stars: [[0.25, 0.17], [0.05, 0.22], [-0.13, 0.29]]},
      {hint: "Tap the arrow to flip",candy: [0, 0.35],ropes: [[0, 0.1]],flip: [-0.5, 0.42],critter: [0, -0.5],stars: [[0, 0.19], [0, -0.01], [0, -0.21]]},
      {candy: [-0.45, 0.1],ropes: [[0, 0.15]],flip: [0.55, 0.4],spikes: [[-0.25, -0.55, -0.25, -0.15]],critter: [0.35, -0.42],stars: [[-0.32, 0.31], [-0.16, -0.02], [-0.02, -0.31]]},
      {candy: [-0.4, 0.5],ropes: [[-0.4, 0.28, 0, {to: [0.4, 0.28],T: 4}]],flip: [0.62, 0],critter: [0.25, -0.45],stars: [[-0.17, 0.43], [0, 0.17], [0.1, -0.11]]},
      {candy: [0, -0.4],ropes: [[0, -0.62]],autos: [[-0.4, 0, 0.3, {to: [0.4, 0],T: 3}]],critter: [-0.35, 0.5],stars: [[-0.02, -0.12], [-0.08, 0.22], [-0.14, 0.14]]},
      {candy: [0, -0.25],ropes: [[-0.5, -0.5, 0, {to: [-0.1, -0.5],T: 3}], [0.5, -0.5, 0, {to: [0.1, -0.5],T: 4}]],critter: [0.3, 0.5],stars: [[0.03, -0.07], [0.2, 0.06], [0.31, 0.18]]},
      {candy: [0, -0.05],ropes: [[0, -0.3]],flip: [-0.6, 0.3],autos: [[-0.25, -0.5, 0.3]],critter: [-0.3, 0.45],stars: [[0.04, -0.54], [-0.44, -0.73], [-0.44, -0.2]]},
      {candy: [-0.4, -0.25],ropes: [[-0.4, -0.55, 0, {to: [0.4, -0.55],T: 4}]],puffers: [[0.7, 0.12, 270]],spikes: [[-0.55, 0.3, -0.12, 0.3]],critter: [0.02, 0.58],stars: [[-0.19, -0.28], [0, -0.05], [0.06, 0.22]]},
      {candy: [0.2, -0.05],ropes: [[0.2, -0.3, 0, {c: [0, -0.3],T: -3}]],bubbles: [[-0.35, 0.25]],critter: [-0.35, -0.45],stars: [[0.06, -0.28], [-0.21, 0.07], [-0.32, 0.06]]},
      {candy: [0, -0.3],ropes: [[-0.4, -0.55], [0.4, -0.55]],autos: [[0.3, 0.1, 0.28, {c: [0, 0.1],T: 4}]],spikes: [[-0.3, 0.45, 0.3, 0.45]],critter: [-0.45, 0.35],stars: [[0.36, -0.09], [0.63, -0.15], [0.1, 0.01]]},
    ],
  },
];
export const LEVELS = BOXES.flatMap((b) => b.levels);
