// Orbits — the "Spinning" levels and the little gravity simulator they run on (pure, no DOM, so the
// tests can import it and search launch parameters headlessly with exactly the game's physics).
//
// World units: the round screen's radius = 1, centre (0, 0), y down. Time in seconds.
// A level: { name, target (orbits to fill the ring), planets (launch budget), holes, rocks?, mutual?, hint? }
//   hole: { x, y, m }            m > 0 black hole (attracts), m < 0 white hole (repels); |m| ≈ 1 normal
//   rock: { x, y, r }            an asteroid — touching it destroys a planet
//   move (on a hole or rock):    { cx, cy, r, T, ph?, dir? }  circles round (cx, cy) in T seconds
//                                { x2, y2, T, ph? }           glides to (x2, y2) and back in T seconds
//   mutual: true                 planets also pull on each other

const TAU = Math.PI * 2;

export const PHYS = {
  G: 0.8,          // gravity of a hole with m = 1
  SOFT: 0.015,     // softening (no singularities near a hole's centre)
  DT: 1 / 120,     // fixed physics step
  PR: 0.022,       // planet radius
  LOST: 1.04,      // a planet this far from the centre is lost
  MUT: 0.045,      // a planet's own gravity in "mutual" levels
  VK: 4,         // launch speed per unit of drag
  VMAX: 3,       // fastest launch
};

/** Where a (possibly moving) hole / rock is at time t. */
export function posAt(o, t, out = [0, 0]) {
  const m = o.move;
  if (!m) { out[0] = o.x; out[1] = o.y; return out; }
  if (m.r != null) {
    const a = (m.ph || 0) + (TAU * t / m.T) * (m.dir || 1);
    out[0] = m.cx + Math.cos(a) * m.r; out[1] = m.cy + Math.sin(a) * m.r; return out;
  }
  const s = (1 - Math.cos(TAU * t / m.T + (m.ph || 0))) / 2;
  out[0] = o.x + (m.x2 - o.x) * s; out[1] = o.y + (m.y2 - o.y) * s; return out;
}
/** Drawn radius of a hole (planets closer than 85 % of it are swallowed). */
export const holeR = (h) => 0.032 + 0.022 * Math.sqrt(Math.abs(h.m));

/** A fresh simulation of a level. */
export function makeWorld(lv) {
  const w = { lv, t: 0, planets: [], hp: lv.holes.map((h) => posAt(h, 0, [0, 0])), rp: (lv.rocks || []).map((r) => posAt(r, 0, [0, 0])), _a: [0, 0] };
  return w;
}
/** A planet launched at (x, y) with velocity (vx, vy). */
export function addPlanet(w, x, y, vx, vy, extra = {}) {
  const n = w.lv.holes.length;
  const p = { x, y, vx, vy, alive: true, dead: null, orbits: 0, acc: new Float64Array(n), pa: new Float64Array(n), born: w.t, ...extra };
  for (let i = 0; i < n; i++) p.pa[i] = Math.atan2(y - w.hp[i][1], x - w.hp[i][0]);
  w.planets.push(p);
  return p;
}

function accel(w, px, py, self, out) {
  const { G, SOFT, MUT } = PHYS;
  let ax = 0, ay = 0;
  const hs = w.lv.holes;
  for (let i = 0; i < hs.length; i++) {
    const dx = w.hp[i][0] - px, dy = w.hp[i][1] - py;
    const d2 = dx * dx + dy * dy + SOFT * SOFT;
    const k = (G * hs[i].m) / (d2 * Math.sqrt(d2));
    ax += dx * k; ay += dy * k;
  }
  if (w.lv.mutual) {
    for (const q of w.planets) {
      if (q === self || !q.alive) continue;
      const dx = q.x - px, dy = q.y - py;
      const d2 = dx * dx + dy * dy + 0.03 * 0.03;
      const k = (G * MUT) / (d2 * Math.sqrt(d2));
      ax += dx * k; ay += dy * k;
    }
  }
  out[0] = ax; out[1] = ay;
  return out;
}

/** Why a planet at (x, y) would die right now ('hole' | 'rock' | 'lost' | null). */
export function hazard(w, x, y, pad = 0) {
  const hs = w.lv.holes;
  for (let i = 0; i < hs.length; i++) {
    const dx = x - w.hp[i][0], dy = y - w.hp[i][1];
    if (dx * dx + dy * dy < (holeR(hs[i]) * 0.85 + pad) ** 2) return 'hole';
  }
  const rs = w.lv.rocks || [];
  for (let i = 0; i < rs.length; i++) {
    const dx = x - w.rp[i][0], dy = y - w.rp[i][1];
    if (dx * dx + dy * dy < (rs[i].r + PHYS.PR * 0.7 + pad) ** 2) return 'rock';
  }
  if (x * x + y * y > PHYS.LOST * PHYS.LOST) return 'lost';
  return null;
}

/**
 * Advance one fixed step. Calls onEvent(type, planet, data) for 'die' (data = cause) and 'orbit' (data = new count).
 */
export function stepWorld(w, onEvent) {
  const { DT } = PHYS;
  const ps = w.planets, a = w._a;
  // velocities first (all planets see the same positions), then positions — symplectic Euler
  for (const p of ps) {
    if (!p.alive) continue;
    accel(w, p.x, p.y, p, a);
    p.vx += a[0] * DT; p.vy += a[1] * DT;
  }
  w.t += DT;
  const hs = w.lv.holes;
  for (let i = 0; i < hs.length; i++) posAt(hs[i], w.t, w.hp[i]);
  const rs = w.lv.rocks || [];
  for (let i = 0; i < rs.length; i++) posAt(rs[i], w.t, w.rp[i]);
  for (const p of ps) {
    if (!p.alive) continue;
    p.x += p.vx * DT; p.y += p.vy * DT;
    // swept angle round every black hole; an orbit = a full turn round any one of them
    let best = 0;
    for (let i = 0; i < hs.length; i++) {
      if (hs[i].m <= 0) continue;
      const ang = Math.atan2(p.y - w.hp[i][1], p.x - w.hp[i][0]);
      let d = ang - p.pa[i];
      if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
      p.acc[i] += d; p.pa[i] = ang;
      const v = Math.abs(p.acc[i]); if (v > best) best = v;
    }
    const n = Math.floor(best / TAU);
    if (n > p.orbits) { p.orbits = n; onEvent?.('orbit', p, n); }
    const why = hazard(w, p.x, p.y);
    if (why) { p.alive = false; p.dead = why; onEvent?.('die', p, why); }
  }
}

/** Total orbits of the planets still alive. */
export const orbitCount = (w) => w.planets.reduce((s, p) => s + (p.alive ? p.orbits : 0), 0);

/**
 * Where a planet launched now would go: fills `out` with [x, y, …] every `every` steps for `secs` seconds
 * (other planets stay where they are). Returns the number of points; out.dead = cause if it dies on the way.
 */
export function predict(w, x, y, vx, vy, secs, every, out) {
  const { DT } = PHYS;
  const ghost = { lv: w.lv, t: w.t, planets: w.planets, hp: w.hp.map((h) => [h[0], h[1]]), rp: w.rp.map((r) => [r[0], r[1]]), _a: [0, 0] };
  const self = {}; const a = ghost._a;
  const hs = w.lv.holes, rs = w.lv.rocks || [];
  let n = 0; out.dead = null;
  const steps = Math.round(secs / DT);
  for (let s = 1; s <= steps; s++) {
    accel(ghost, x, y, self, a);
    vx += a[0] * DT; vy += a[1] * DT;
    ghost.t += DT;
    for (let i = 0; i < hs.length; i++) posAt(hs[i], ghost.t, ghost.hp[i]);
    for (let i = 0; i < rs.length; i++) posAt(rs[i], ghost.t, ghost.rp[i]);
    x += vx * DT; y += vy * DT;
    const why = hazard(ghost, x, y);
    if (s % every === 0 || why) { out[n * 2] = x; out[n * 2 + 1] = y; n++; }
    if (why) { out.dead = why; break; }
  }
  return n;
}

/** Headless check: one planet launched at t = 0 — how many orbits before it dies or `secs` pass. */
export function trial(lv, x, y, vx, vy, secs = 60, need = lv.target) {
  const w = makeWorld(lv);
  if (hazard(w, x, y, 0.03)) return { orbits: 0, dead: 'spawn', t: 0 };
  const p = addPlanet(w, x, y, vx, vy);
  const steps = Math.round(secs / PHYS.DT);
  for (let s = 0; s < steps && p.alive && p.orbits < need; s++) stepWorld(w);
  return { orbits: p.orbits, dead: p.dead, t: w.t };
}

// ------------------------------------------------------------------ the levels
const ring = (n, r, rr, a0 = 0, move = null) => Array.from({ length: n }, (_, i) => {
  const a = a0 + (i / n) * TAU;
  return move ? { x: 0, y: 0, r: rr, move: { cx: 0, cy: 0, r, T: move.T, ph: a, dir: move.dir || 1 } } : { x: Math.cos(a) * r, y: Math.sin(a) * r, r: rr };
});

const POOL = [
  // ---- 1–5: one or two holes, learn the fling
  { name: 'First Orbit', target: 5, planets: 8, holes: [{ x: 0, y: 0.04, m: 1 }], hint: 'Touch, drag sideways, let go' },
  { name: 'Off Centre', target: 8, planets: 7, holes: [{ x: 0.22, y: 0.14, m: 1 }], hint: 'Fling across the hole, not at it' },
  { name: 'Heavyweight', target: 10, planets: 7, holes: [{ x: 0, y: 0.05, m: 2 }], hint: 'A heavier hole wants faster planets' },
  { name: 'Featherweight', target: 8, planets: 7, holes: [{ x: -0.1, y: 0.1, m: 0.45 }], hint: 'A light touch' },
  { name: 'Twins', target: 10, planets: 6, holes: [{ x: -0.42, y: 0.05, m: 0.8 }, { x: 0.42, y: 0.05, m: 0.8 }] },
  // ---- 6–10: binaries, asteroids, a white hole
  { name: 'Binary', target: 12, planets: 6, holes: [{ x: -0.13, y: 0.04, m: 0.7 }, { x: 0.13, y: 0.04, m: 0.7 }], hint: 'Circle both at once' },
  { name: 'Rock Garden', target: 10, planets: 6, holes: [{ x: 0, y: 0.04, m: 1 }], rocks: ring(8, 0.56, 0.05, 0.2).map((r) => ({ ...r, y: r.y + 0.04 })), hint: 'Asteroids smash planets' },
  { name: 'Asteroid Belt', target: 12, planets: 6, holes: [{ x: 0, y: 0.04, m: 1.2 }], rocks: ring(5, 0.27, 0.04, 0.3).map((r) => ({ ...r, y: r.y + 0.04 })), hint: 'Inside or outside the belt?' },
  { name: 'White Hole', target: 12, planets: 6, holes: [{ x: -0.12, y: 0.1, m: 1.1 }, { x: 0.56, y: -0.42, m: -0.25 }], hint: 'White holes push planets away' },
  { name: 'Lopsided', target: 12, planets: 6, holes: [{ x: -0.32, y: -0.12, m: 1.5 }, { x: 0.4, y: 0.3, m: 0.5 }] },
  // ---- 11–15: things start to move, planets pull each other
  { name: 'Drifter', target: 12, planets: 6, holes: [{ x: -0.22, y: 0.05, m: 1, move: { x2: 0.22, y2: 0.05, T: 14 } }], hint: 'Black holes can move' },
  { name: 'Carousel', target: 12, planets: 6, holes: [{ x: 0, y: 0, m: 1, move: { cx: 0, cy: 0.04, r: 0.2, T: 16 } }] },
  { name: 'Company', target: 18, planets: 8, mutual: true, holes: [{ x: 0, y: 0.04, m: 1.4 }], hint: 'Planets pull on each other now' },
  { name: 'Moonlet', target: 12, planets: 6, holes: [{ x: 0, y: 0.04, m: 1.1 }], rocks: [{ x: 0, y: 0, r: 0.05, move: { cx: 0, cy: 0.04, r: 0.36, T: 5 } }], hint: 'Mind the moon' },
  { name: 'Triangle', target: 13, planets: 6, holes: [0, 1, 2].map((i) => ({ x: Math.sin(i * TAU / 3) * 0.24, y: 0.06 - Math.cos(i * TAU / 3) * 0.24, m: 0.6 })) },
  // ---- 16–20
  { name: 'Mirror', target: 14, planets: 6, holes: [{ x: 0, y: 0.04, m: -0.3 }, { x: -0.45, y: 0.04, m: 1 }, { x: 0.45, y: 0.04, m: 1 }] },
  { name: 'Pendulum', target: 14, planets: 6, holes: [{ x: 0, y: -0.24, m: 1, move: { x2: 0, y2: 0.3, T: 10 } }] },
  { name: 'Crossfire', target: 14, planets: 6, holes: [{ x: 0, y: 0.04, m: 1 }, { x: -0.7, y: 0.04, m: -0.45 }, { x: 0.7, y: 0.04, m: -0.45 }], hint: 'The white holes guard the edges' },
  { name: 'Waltz', target: 16, planets: 6, holes: [{ x: 0, y: 0, m: 0.8, move: { cx: 0, cy: 0.04, r: 0.17, T: 9 } }, { x: 0, y: 0, m: 0.8, move: { cx: 0, cy: 0.04, r: 0.17, T: 9, ph: Math.PI } }], hint: 'Two holes, one dance' },
  { name: 'Swarm', target: 20, planets: 9, mutual: true, holes: [{ x: -0.3, y: 0.05, m: 1 }, { x: 0.3, y: 0.05, m: 1 }] },
  // ---- 21–25
  { name: 'Sentinels', target: 14, planets: 6, holes: [{ x: 0, y: 0.04, m: 1.2 }], rocks: [
    { x: 0, y: 0, r: 0.045, move: { cx: 0, cy: 0.04, r: 0.3, T: 6 } }, { x: 0, y: 0, r: 0.045, move: { cx: 0, cy: 0.04, r: 0.62, T: 11, dir: -1, ph: 2 } }] },
  { name: 'Fence', target: 16, planets: 6, holes: [{ x: 0, y: 0.04, m: 1 }, ...[0, 1, 2, 3].map((i) => ({ x: Math.cos(i * TAU / 4 + 0.78) * 0.72, y: 0.04 + Math.sin(i * TAU / 4 + 0.78) * 0.72, m: -0.3 }))], hint: 'White holes can help too' },
  { name: 'Wanderers', target: 15, planets: 6, holes: [{ x: -0.38, y: -0.2, m: 0.9, move: { x2: -0.38, y2: 0.3, T: 12 } }, { x: 0.38, y: 0.3, m: 0.9, move: { x2: 0.38, y2: -0.2, T: 12 } }] },
  { name: 'Quartet', target: 14, planets: 6, holes: [0, 1, 2, 3].map((i) => ({ x: Math.cos(i * TAU / 4 + 0.78) * 0.3, y: 0.04 + Math.sin(i * TAU / 4 + 0.78) * 0.3, m: 0.5 })) },
  { name: 'Eclipse', target: 16, planets: 6, holes: [{ x: 0, y: 0, m: 1, move: { cx: 0, cy: 0.04, r: 0.18, T: 14 } }], rocks: [{ x: 0, y: 0, r: 0.05, move: { cx: 0, cy: 0.04, r: 0.6, T: 9, dir: -1 } }] },
  // ---- 26–30
  { name: 'Crowd', target: 24, planets: 9, mutual: true, holes: [{ x: 0, y: 0.04, m: 1.2 }], rocks: [...ring(7, 0.52, 0.04, 0.5).map((r) => ({ ...r, y: r.y + 0.04 })), ...ring(2, 0.27, 0.035, 0, { T: 5 }).map((r) => ({ ...r, move: { ...r.move, cy: 0.04 } }))] },
  { name: 'Gauntlet', target: 18, planets: 6, holes: [{ x: 0, y: -0.02, m: 1.1 }, { x: 0, y: 0.66, m: -0.4 }], rocks: ring(3, 0.42, 0.045, 0, { T: 8 }).map((r) => ({ ...r, move: { ...r.move, cy: -0.02 } })) },
  { name: 'Three Body', target: 15, planets: 6, holes: [{ x: -0.26, y: 0.2, m: 0.7 }, { x: 0.26, y: 0.2, m: 0.7 }, { x: 0, y: -0.26, m: 0.7, move: { x2: 0, y2: -0.1, T: 7 } }] },
  { name: 'Storm', target: 22, planets: 8, mutual: true, holes: [{ x: 0, y: 0.04, m: 1.3 }], rocks: [
    ...ring(3, 0.3, 0.035, 0, { T: 7 }), ...ring(4, 0.6, 0.04, 0.4, { T: 13, dir: -1 })].map((r) => ({ ...r, move: { ...r.move, cy: 0.04 } })) },
  { name: 'Grand Finale', target: 24, planets: 8, mutual: true, holes: [
    { x: 0, y: 0, m: 0.8, move: { cx: 0, cy: 0.04, r: 0.15, T: 9 } }, { x: 0, y: 0, m: 0.8, move: { cx: 0, cy: 0.04, r: 0.15, T: 9, ph: Math.PI } },
    { x: -0.6, y: 0.56, m: -0.2 }], rocks: [{ x: 0, y: 0, r: 0.045, move: { cx: 0, cy: 0.04, r: 0.64, T: 12, dir: -1 } }] },
];

// difficulty ramp (checked headlessly: share of sensible launches that make a lasting orbit goes ~85 % → ~4 %)
const ORDER = ['First Orbit', 'Off Centre', 'Heavyweight', 'Featherweight', 'Binary',
  'Rock Garden', 'Asteroid Belt', 'Drifter', 'Carousel', 'Pendulum',
  'Company', 'Moonlet', 'Waltz', 'Eclipse', 'White Hole',
  'Fence', 'Twins', 'Triangle', 'Mirror', 'Swarm',
  'Sentinels', 'Storm', 'Lopsided', 'Crossfire', 'Gauntlet',
  'Crowd', 'Wanderers', 'Three Body', 'Quartet', 'Grand Finale'];
export const LEVELS = ORDER.map((n) => POOL.find((l) => l.name === n));

