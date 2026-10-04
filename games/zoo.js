// Zoo Splash — two teams of animal pucks on a little grassy island in the sea. On your turn pull one of
// your animals back like a slingshot and let go: pucks slide, bump and bounce off the stone walls, and any
// puck whose middle leaves the island falls into the sea. Knock the whole other team in to win.
// 1P vs COM (Easy / Normal / Hard — the COM tries shots in its head with the same physics and picks one)
// or 2 players taking turns on one screen. The island scene keeps its own bright palette in every theme.
import { TAU, clamp, rand, ease, angDiff, THEME } from './kit.js';

// ------------------------------------------------------------------ the island (all sizes × R)
const A = 0.74, B = 0.62, C = 0.34;       // island half width / half height / corner radius
const PR = 0.06;                          // puck radius
const SR = 0.042;                         // stone (capsule) radius
const SOFF = 0.012;                       // stones sit this far outside the grass edge
const VMAX = 3.0;                         // fastest shot (R per second)
const KFR = 1.1, CFR = 0.16;              // friction: proportional + constant (rolling) part
const E_BALL = 0.88, E_WALL = 0.68;       // restitution puck↔puck, puck↔stone
const HSTEP = 1 / 120;                    // fixed physics step
const PULL = 0.42;                        // drag length for full power
const N_TEAM = 7, N = N_TEAM * 2;

/** Signed distance to the island edge (negative = on the grass). */
function sdIsland(x, y) {
  const qx = Math.abs(x) - (A - C), qy = Math.abs(y) - (B - C);
  const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - C;
}

// The edge as a path parameter s (clockwise from the top middle): point + outward normal.
const PIECES = (() => {
  const a = A - C, b = B - C, q = (Math.PI / 2) * C;
  const line = (x0, y0, x1, y1, nx, ny) => ({ len: Math.hypot(x1 - x0, y1 - y0), at: (u) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, nx, ny] });
  const arc = (ox, oy, t0) => ({ len: q, at: (u) => { const t = t0 + u * Math.PI / 2, c = Math.cos(t), s = Math.sin(t); return [ox + c * C, oy + s * C, c, s]; } });
  return [line(0, -B, a, -B, 0, -1), arc(a, -b, -Math.PI / 2), line(A, -b, A, b, 1, 0), arc(a, b, 0),
    line(a, B, -a, B, 0, 1), arc(-a, b, Math.PI / 2), line(-A, b, -A, -b, -1, 0), arc(-a, -b, Math.PI), line(-a, -B, 0, -B, 0, -1)];
})();
const PERIM = PIECES.reduce((s, p) => s + p.len, 0);
function edgeAt(s) {
  s = ((s % PERIM) + PERIM) % PERIM;
  for (const p of PIECES) { if (s <= p.len) return p.at(p.len ? s / p.len : 0); s -= p.len; }
  return PIECES[0].at(0);
}
// gaps: top & bottom middle and the four corners (centre s, visible width)
const GAPS = (() => {
  const a = A - C, q = (Math.PI / 2) * C, side = 2 * (B - C), top = 2 * a;
  const tr = a + q / 2, br = a + q + side + q / 2, bl = br + q / 2 + top + q / 2, tl = bl + q / 2 + side + q / 2;
  return [[0, 0.21], [tr, 0.24], [br, 0.24], [PERIM / 2, 0.21], [bl, 0.24], [tl, 0.24]];
})();
const GAP_PTS = GAPS.map(([s]) => edgeAt(s));
// the stone walls between the gaps: a chain of capsules ({ ax, ay, bx, by, r, ... })
const STONES = (() => {
  const out = [], gs = GAPS.map(([s, w]) => [s - w / 2, s + w / 2]).sort((p, q) => p[0] - q[0]);
  // wall ranges: from the end of one gap to the start of the next (wrapping)
  for (let k = 0; k < gs.length; k++) {
    const s0 = gs[k][1], s1 = k + 1 < gs.length ? gs[k + 1][0] : gs[0][0] + PERIM;
    const a = s0 + SR * 0.9, b = s1 - SR * 0.9, n = Math.max(1, Math.round((b - a) / 0.105));
    for (let i = 0; i < n; i++) {
      const [x0, y0, nx0, ny0] = edgeAt(a + (b - a) * i / n), [x1, y1, nx1, ny1] = edgeAt(a + (b - a) * (i + 1) / n);
      const seed = out.length * 7.31 + 1.7;
      const ax = x0 + nx0 * SOFF, ay = y0 + ny0 * SOFF, bx = x1 + nx1 * SOFF, by = y1 + ny1 * SOFF;
      out.push({ ax, ay, bx, by, r: SR, mx: (ax + bx) / 2, my: (ay + by) / 2, reach: Math.hypot(bx - ax, by - ay) / 2 + SR + PR + 0.01,
        w: 0.92 + 0.16 * Math.abs(Math.sin(seed * 3.1)), h: 0.9 + 0.2 * Math.abs(Math.sin(seed * 1.7)), seed });
    }
  }
  return out;
})();

// ------------------------------------------------------------------ physics (shared by the game and the COM)
function makeWorld() {
  return { x: new Float64Array(N), y: new Float64Array(N), vx: new Float64Array(N), vy: new Float64Array(N), alive: new Uint8Array(N), team: new Uint8Array(N) };
}
function copyWorld(src, dst) {
  dst.x.set(src.x); dst.y.set(src.y); dst.vx.set(src.vx); dst.vy.set(src.vy); dst.alive.set(src.alive); dst.team.set(src.team);
}
/** One fixed step. `ev` (optional) gets hit / wall / fall callbacks for sound and effects. */
function step(w, ev) {
  const { x, y, vx, vy, alive } = w, H = HSTEP, d2min = 4 * PR * PR;
  for (let i = 0; i < N; i++) {
    if (!alive[i]) continue;
    let sx = vx[i], sy = vy[i];
    if (sx || sy) {
      const sp = Math.sqrt(sx * sx + sy * sy), ns = sp * (1 - KFR * H) - CFR * H;
      if (ns <= 0.004) { sx = sy = 0; } else { sx *= ns / sp; sy *= ns / sp; }
      vx[i] = sx; vy[i] = sy;
      x[i] += sx * H; y[i] += sy * H;
    }
    if (sdIsland(x[i], y[i]) > -(PR + 2 * SR + 0.03)) {
      for (const st of STONES) {
        if (Math.abs(x[i] - st.mx) > st.reach || Math.abs(y[i] - st.my) > st.reach) continue;
        const ex = st.bx - st.ax, ey = st.by - st.ay;
        const t = clamp(((x[i] - st.ax) * ex + (y[i] - st.ay) * ey) / (ex * ex + ey * ey), 0, 1);
        const dx = x[i] - (st.ax + ex * t), dy = y[i] - (st.ay + ey * t), dd = dx * dx + dy * dy, rr = PR + st.r;
        if (dd >= rr * rr || dd === 0) continue;
        const d = Math.sqrt(dd), nx = dx / d, ny = dy / d;
        x[i] += nx * (rr - d); y[i] += ny * (rr - d);
        const vn = vx[i] * nx + vy[i] * ny;
        if (vn < 0) {
          vx[i] -= (1 + E_WALL) * vn * nx; vy[i] -= (1 + E_WALL) * vn * ny;
          if (ev) ev.wall(i, -vn);
        }
      }
      if (sdIsland(x[i], y[i]) > 0) { alive[i] = 0; if (ev) ev.fall(i); }
    }
  }
  for (let i = 0; i < N; i++) {
    if (!alive[i]) continue;
    for (let j = i + 1; j < N; j++) {
      if (!alive[j]) continue;
      const dx = x[i] - x[j], dy = y[i] - y[j], dd = dx * dx + dy * dy;
      if (dd >= d2min) continue;
      const d = Math.sqrt(dd) || 1e-6, nx = dx / d, ny = dy / d, push = (2 * PR - d) * 0.5;
      x[i] += nx * push; y[i] += ny * push; x[j] -= nx * push; y[j] -= ny * push;
      const vr = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
      if (vr < 0) {
        const imp = -(1 + E_BALL) * vr / 2;
        vx[i] += imp * nx; vy[i] += imp * ny; vx[j] -= imp * nx; vy[j] -= imp * ny;
        if (ev) ev.hit(i, j, -vr, (vx[i] - vx[j]) * -ny + (vy[i] - vy[j]) * nx);
      }
    }
  }
}
function moving(w) { for (let i = 0; i < N; i++) if (w.alive[i] && (w.vx[i] || w.vy[i])) return true; return false; }
const count = (w, t) => { let n = 0; for (let i = 0; i < N; i++) if (w.alive[i] && w.team[i] === t) n++; return n; };
/** How close a spot is to one of the gaps (0 … 1). */
function danger(x, y) {
  let m = 9;
  for (const [gx, gy] of GAP_PTS) m = Math.min(m, Math.hypot(x - gx, y - gy));
  const d = clamp(1 - m / 0.34, 0, 1);
  return d * d;
}

// ------------------------------------------------------------------ the COM
const SIM = makeWorld();
const LEVELS = {
  easy: { cands: 30, top: 0.35, aim: 0.13, pow: [0.75, 1.2], refine: false },
  normal: { cands: 70, top: 5, aim: 0.075, pow: [0.88, 1.12], refine: false },
  hard: { cands: 300, top: 1, aim: 0.01, pow: [0.98, 1.02], refine: true },
};
/** Play one candidate shot in the head and score the result for team `me`. */
function trial(world, me, c) {
  copyWorld(world, SIM);
  const opp = 1 - me, own0 = count(SIM, me), opp0 = count(SIM, opp);
  SIM.vx[c.i] = Math.cos(c.ang) * c.pw * VMAX; SIM.vy[c.i] = Math.sin(c.ang) * c.pw * VMAX;
  for (let k = 0; k < 840; k++) { step(SIM, null); if ((k & 3) === 3 && !moving(SIM)) break; }
  const own1 = count(SIM, me), opp1 = count(SIM, opp);
  let s = 100 * (opp0 - opp1) - 140 * (own0 - own1);
  if (opp1 === 0 && own1 > 0) s += 2000;
  if (own1 === 0) s -= 2000;
  for (let i = 0; i < N; i++) if (SIM.alive[i]) s += (SIM.team[i] === opp ? 7 : -9) * danger(SIM.x[i], SIM.y[i]);
  return s;
}
function candidates(world, me, lv) {
  const out = [], opp = 1 - me;
  for (let i = 0; i < N; i++) {
    if (!world.alive[i] || world.team[i] !== me) continue;
    for (let j = 0; j < N; j++) {
      if (!world.alive[j] || world.team[j] !== opp) continue;
      const base = Math.atan2(world.y[j] - world.y[i], world.x[j] - world.x[i]);
      for (const off of [0, -0.07, 0.07, -0.16, 0.16]) for (const pw of [0.5, 0.75, 1]) out.push({ i, ang: base + off, pw });
    }
    for (let k = 0; k < 3; k++) out.push({ i, ang: rand(TAU), pw: rand(0.4, 1) });
  }
  for (let k = out.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [out[k], out[r]] = [out[r], out[k]]; }
  return out.slice(0, lv.cands);
}

// ------------------------------------------------------------------ look
const TEAM = [
  { name: 'Orange', col: '#ff8a1f', dark: '#c75a0c', ink: '#5a2604', dot: '#ffd2a1', species: ['pig', 'bear', 'frog'] },
  { name: 'Purple', col: '#9b5cf0', dark: '#6a33c0', ink: '#2c0f5e', dot: '#dcc6ff', species: ['panda', 'cow', 'cat'] },
];
const LINE = '#2a211e';
const SEA = { base: '#1c5fb5', deep: '#0f3c85', shallow: '#3488d8', foam: 'rgba(255,255,255,.55)' };
const GRASS = { a: '#79c83f', b: '#86d24b', edge: '#4c9326', tuft: '#5fa92f' };
const SAND = { top: '#efdda4', cliff: '#c6a160', line: '#9a7a40' };
const STONE = { fill: '#b9bab2', light: '#d6d7cf', dark: '#8d8f88', line: '#3d4046' };

function ell(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); }
function fillStroke(ctx, fill, lw = 0.07) { ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = LINE; ctx.stroke(); }

/** An animal face at the origin, radius 1 (the caller scales). mood: 'idle' | 'fall' | 'happy'. */
function face(ctx, sp, blink, mood) {
  const eyes = (ex, ey, er = 0.12) => {
    if (mood === 'happy') {
      ctx.lineWidth = 0.09; ctx.strokeStyle = LINE; ctx.lineCap = 'round';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * ex, ey + 0.05, er * 0.9, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
      return;
    }
    const k = mood === 'fall' ? 1.35 : 1, by = blink ? 0.18 : 1;
    for (const s of [-1, 1]) {
      ell(ctx, s * ex, ey, er * k, er * k * by); ctx.fillStyle = LINE; ctx.fill();
      if (!blink) { ctx.beginPath(); ctx.arc(s * ex + er * 0.35, ey - er * 0.35, er * 0.33, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); }
    }
  };
  const mouth = (y, w = 0.16) => {
    ctx.lineWidth = 0.07; ctx.strokeStyle = LINE; ctx.lineCap = 'round';
    if (mood === 'fall') { ell(ctx, 0, y + 0.04, 0.09, 0.12); ctx.fillStyle = LINE; ctx.fill(); return; }
    ctx.beginPath(); ctx.arc(-w / 2, y, w / 2, 0.15 * Math.PI, 0.95 * Math.PI); ctx.moveTo(w, y); ctx.arc(w / 2, y, w / 2, 0.05 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  };
  const cheeks = (y, x = 0.6) => { for (const s of [-1, 1]) { ell(ctx, s * x, y, 0.13, 0.08); ctx.fillStyle = 'rgba(255,105,140,.45)'; ctx.fill(); } };
  const head = (col) => { ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); fillStroke(ctx, col, 0.08); };
  if (sp === 'pig') {
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 0.78, -0.3); ctx.lineTo(s * 0.86, -1.05); ctx.lineTo(s * 0.22, -0.82); ctx.closePath(); fillStroke(ctx, '#f28ca3'); }
    head('#f9b6c4'); cheeks(0.12, 0.66); eyes(0.36, -0.2);
    ell(ctx, 0, 0.32, 0.38, 0.26); fillStroke(ctx, '#ef8ea4');
    for (const s of [-1, 1]) { ell(ctx, s * 0.13, 0.32, 0.06, 0.1); ctx.fillStyle = '#8a3449'; ctx.fill(); }
  } else if (sp === 'bear') {
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 0.68, -0.68, 0.32, 0, TAU); fillStroke(ctx, '#c98e56'); ctx.beginPath(); ctx.arc(s * 0.68, -0.68, 0.15, 0, TAU); ctx.fillStyle = '#ecc093'; ctx.fill(); }
    head('#cc9158'); eyes(0.37, -0.16);
    ell(ctx, 0, 0.33, 0.42, 0.3); fillStroke(ctx, '#f3d6ad');
    ell(ctx, 0, 0.2, 0.15, 0.1); ctx.fillStyle = LINE; ctx.fill();
    mouth(0.36, 0.14);
  } else if (sp === 'frog') {
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 0.43, -0.62, 0.33, 0, TAU); fillStroke(ctx, '#89d156'); }
    head('#93d95f'); cheeks(0.25, 0.62);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 0.43, -0.62, 0.21, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); }
    ctx.save(); ctx.translate(0, -0.62); eyes(0.43, 0, 0.11); ctx.restore();
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 0.1, -0.08, 0.04, 0, TAU); ctx.fillStyle = LINE; ctx.fill(); }
    if (mood === 'fall') { ell(ctx, 0, 0.35, 0.12, 0.15); ctx.fillStyle = LINE; ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(0, 0.02, 0.52, 0.2 * Math.PI, 0.8 * Math.PI); ctx.lineWidth = 0.08; ctx.strokeStyle = LINE; ctx.lineCap = 'round'; ctx.stroke(); }
  } else if (sp === 'panda') {
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 0.67, -0.67, 0.3, 0, TAU); fillStroke(ctx, '#2e2a2a'); }
    head('#f7f5f0');
    for (const s of [-1, 1]) { ell(ctx, s * 0.36, -0.08, 0.21, 0.27, s * 0.55); ctx.fillStyle = '#2e2a2a'; ctx.fill(); }
    if (mood === 'happy') { ctx.save(); ctx.globalCompositeOperation = 'source-over'; }
    for (const s of [-1, 1]) {
      if (mood === 'happy') { ctx.beginPath(); ctx.arc(s * 0.36, -0.03, 0.1, Math.PI * 1.1, Math.PI * 1.9); ctx.lineWidth = 0.08; ctx.strokeStyle = '#fff'; ctx.stroke(); continue; }
      const k = mood === 'fall' ? 1.3 : 1;
      ell(ctx, s * 0.36, -0.1, 0.1 * k, 0.1 * k * (blink ? 0.2 : 1)); ctx.fillStyle = '#fff'; ctx.fill();
      if (!blink) { ctx.beginPath(); ctx.arc(s * 0.36 + 0.02, -0.1, 0.055 * k, 0, TAU); ctx.fillStyle = LINE; ctx.fill(); }
    }
    if (mood === 'happy') ctx.restore();
    ell(ctx, 0, 0.27, 0.13, 0.09); ctx.fillStyle = LINE; ctx.fill();
    mouth(0.4, 0.13);
  } else if (sp === 'cow') {
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(s * 0.3, -0.85); ctx.quadraticCurveTo(s * 0.55, -1.12, s * 0.62, -0.78); ctx.closePath(); fillStroke(ctx, '#f1e0ad', 0.06);
      ell(ctx, s * 0.92, -0.3, 0.26, 0.13, s * 0.35); fillStroke(ctx, '#f4eee2', 0.06);
    }
    head('#f6f1e7');
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 0.96, 0, TAU); ctx.clip();
    ell(ctx, -0.55, -0.55, 0.48, 0.4, 0.4); ctx.fillStyle = '#5d3f2b'; ctx.fill();
    ell(ctx, 0.75, 0.05, 0.22, 0.3, 0.2); ctx.fill();
    ctx.restore();
    eyes(0.34, -0.12);
    ell(ctx, 0, 0.47, 0.56, 0.32); fillStroke(ctx, '#f4b8aa');
    for (const s of [-1, 1]) { ell(ctx, s * 0.2, 0.45, 0.07, 0.1); ctx.fillStyle = '#8a4a40'; ctx.fill(); }
  } else { // cat
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(s * 0.88, -0.22); ctx.lineTo(s * 0.74, -1.02); ctx.lineTo(s * 0.22, -0.8); ctx.closePath(); fillStroke(ctx, '#d4d0dc');
      ctx.beginPath(); ctx.moveTo(s * 0.74, -0.38); ctx.lineTo(s * 0.68, -0.82); ctx.lineTo(s * 0.4, -0.72); ctx.closePath(); ctx.fillStyle = '#f2a8bb'; ctx.fill();
    }
    head('#dad6e2');
    ctx.lineWidth = 0.07; ctx.strokeStyle = '#8e88a0'; ctx.lineCap = 'round';
    for (const x of [-0.16, 0, 0.16]) { ctx.beginPath(); ctx.moveTo(x, -0.92); ctx.lineTo(x, -0.66); ctx.stroke(); }
    eyes(0.36, -0.12);
    ctx.beginPath(); ctx.moveTo(-0.1, 0.13); ctx.lineTo(0.1, 0.13); ctx.lineTo(0, 0.25); ctx.closePath(); ctx.fillStyle = '#f08aa3'; ctx.fill();
    mouth(0.3, 0.14);
    ctx.lineWidth = 0.04; ctx.strokeStyle = LINE;
    for (const s of [-1, 1]) for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 0.42, 0.22 + k * 0.05); ctx.lineTo(s * 0.86, 0.17 + k * 0.13); ctx.stroke(); }
  }
}

/** A team puck (flat team disc + rim dots + the animal face), in island units. */
function puck(ctx, x, y, team, sp, rot, scale, blink, mood) {
  const T = TEAM[team];
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale);
  ctx.beginPath(); ctx.arc(0, 0, PR, 0, TAU); ctx.fillStyle = T.col; ctx.fill();
  ctx.lineWidth = PR * 0.1; ctx.strokeStyle = T.ink; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, PR * 0.8, 0, TAU); ctx.lineWidth = PR * 0.06; ctx.strokeStyle = T.dark; ctx.stroke();
  ctx.fillStyle = T.dot;
  for (let k = 0; k < 8; k++) { const a = (k + 0.5) * TAU / 8; ctx.beginPath(); ctx.arc(Math.cos(a) * PR * 0.89, Math.sin(a) * PR * 0.89, PR * 0.06, 0, TAU); ctx.fill(); }
  ctx.scale(PR * 0.63, PR * 0.63);
  face(ctx, sp, blink, mood);
  ctx.restore();
}

// island outline paths (unit coords)
function islandPath(ctx, grow = 0) { ctx.beginPath(); ctx.roundRect(-A - grow, -B - grow, 2 * (A + grow), 2 * (B + grow), C + grow); }
function shorePath(ctx, grow, wob, dy = 0) {
  ctx.beginPath();
  for (let s = 0; s < PERIM; s += 0.02) {
    const [x, y, nx, ny] = edgeAt(s), o = grow + wob * (Math.sin(s * 23) * 0.6 + Math.sin(s * 57 + 1) * 0.4);
    ctx.lineTo(x + nx * o, y + ny * o + dy);
  }
  ctx.closePath();
}

export default {
  howTo: 'Pull one of your animals back like a slingshot and let go. Knock the whole other team into the sea! Keys: ←/→ pick, ↑/↓ aim, hold Space.',
  modes: [
    { id: 'com', name: '1P vs COM', unit: 'pts',
      options: [{ id: 'level', name: 'Level', choices: [{ id: 'easy', name: 'Easy' }, { id: 'normal', name: 'Normal' }, { id: 'hard', name: 'Hard' }], default: 'normal' }] },
    { id: '2p', name: '2 players', unit: 'left' },
  ],
  scoring: 'high',
  hud: false,
  create(g, { mode, opts = {} }) {
    const two = mode === '2p';
    const levelId = LEVELS[opts.level] ? opts.level : 'normal';
    const LV = LEVELS[levelId];
    const isCom = (t) => !two && t === 1;
    const world = makeWorld();
    const rot = new Float64Array(N), spin = new Float64Array(N), blinkAt = new Float64Array(N), species = [];
    const fallers = [], splashes = [], confetti = [];
    const turns = [0, 0], bump = [0, 0];
    let turn = 0, phase = 'aim', settle = 0, rollT = 0, time = 0, winner = -1, endT = 0;
    let drag = null, kbd = false, kSel = -1, kAim = 0, charging = false, chargeT = 0, keyHeld = { up: 0, down: 0 };
    let banner = null, plan = null, comShot = null, lastHit = 0, paused = false;
    let lastSel = [-1, -1];

    // ---- the starting ring: 12 alternating on an oval + one of each in the middle
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + TAU / 24;
      world.x[k] = Math.cos(a) * 0.45; world.y[k] = Math.sin(a) * 0.37; world.team[k] = k % 2; world.alive[k] = 1;
    }
    world.x[12] = -0.075; world.y[12] = 0; world.team[12] = 0; world.alive[12] = 1;
    world.x[13] = 0.075; world.y[13] = 0; world.team[13] = 1; world.alive[13] = 1;
    const perTeam = [0, 0];
    for (let i = 0; i < N; i++) { const t = world.team[i]; species[i] = TEAM[t].species[perTeam[t]++ % 3]; rot[i] = rand(-0.25, 0.25); blinkAt[i] = rand(1, 5); }

    // ---- effects from the physics
    const ev = {
      hit(i, j, v, vt) {
        spin[i] = clamp(spin[i] + vt / PR * 0.25, -18, 18); spin[j] = clamp(spin[j] + vt / PR * 0.25, -18, 18);
        if (v > 0.15 && time - lastHit > 0.05) { lastHit = time; g.sfx('hit', { volume: clamp(v / 2, 0.25, 1), pitch: rand(0.9, 1.15) }); }
      },
      wall(i, v) {
        spin[i] = clamp(spin[i] * -0.6, -18, 18);
        if (v > 0.2 && time - lastHit > 0.05) { lastHit = time; g.sfx('bounce', { volume: clamp(v / 2.5, 0.2, 0.9), pitch: 0.7 }); }
      },
      fall(i) {
        // keep it drifting out over the water so the splash lands in the sea, not on the sand
        const x = world.x[i], y = world.y[i], e = 0.004;
        let nx = sdIsland(x + e, y) - sdIsland(x - e, y), ny = sdIsland(x, y + e) - sdIsland(x, y - e);
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        let vx = world.vx[i], vy = world.vy[i];
        const vn = vx * nx + vy * ny;
        if (vn < 0.4) { vx += (0.4 - vn) * nx; vy += (0.4 - vn) * ny; }
        const sp = Math.hypot(vx, vy); if (sp > 0.55) { vx *= 0.55 / sp; vy *= 0.55 / sp; }
        fallers.push({ i, x, y, vx, vy, t: 0 }); world.vx[i] = world.vy[i] = 0;
        g.sfx('drop', { pitch: 1.3, volume: 0.5 });
      },
    };

    // ---- turns
    const own = (t) => { const a = []; for (let i = 0; i < N; i++) if (world.alive[i] && world.team[i] === t) a.push(i); return a; };
    const turnText = (t) => (two ? `${TEAM[t].name.toUpperCase()}'S TURN` : isCom(t) ? "COM'S TURN" : 'YOUR TURN');
    function aimAtNearest(i) {
      let best = 9, a = Math.atan2(-world.y[i], -world.x[i]);
      for (let j = 0; j < N; j++) {
        if (!world.alive[j] || world.team[j] === world.team[i]) continue;
        const d = Math.hypot(world.x[j] - world.x[i], world.y[j] - world.y[i]);
        if (d < best) { best = d; a = Math.atan2(world.y[j] - world.y[i], world.x[j] - world.x[i]); }
      }
      kAim = a;
    }
    function selectKbd(dir) {
      const mine = own(turn).sort((p, q) => Math.atan2(world.y[p], world.x[p]) - Math.atan2(world.y[q], world.x[q]));
      if (!mine.length) return;
      let k = mine.indexOf(kSel);
      k = k < 0 ? 0 : (k + dir + mine.length) % mine.length;
      kSel = mine[k]; lastSel[turn] = kSel; aimAtNearest(kSel);
    }
    function beginTurn() {
      phase = isCom(turn) ? 'think' : 'aim';
      banner = { t: 0, team: turn, text: turnText(turn) };
      drag = null; charging = false; chargeT = 0;
      const mine = own(turn);
      kSel = mine.includes(lastSel[turn]) ? lastSel[turn] : mine[0];
      if (kSel >= 0) aimAtNearest(kSel);
      if (phase === 'think') { plan = { cands: candidates(world, turn, LV), idx: 0, t: 0, refined: !LV.refine }; }
      g.sfx('tap');
    }
    function shoot(i, ang, pw) {
      world.vx[i] = Math.cos(ang) * pw * VMAX; world.vy[i] = Math.sin(ang) * pw * VMAX;
      spin[i] += rand(-3, 3);
      turns[turn]++; lastSel[turn] = i;
      phase = 'roll'; settle = 0; rollT = 0; drag = null; charging = false; comShot = null;
      if (banner) banner.t = Math.max(banner.t, 0.95);
      g.sfx('whoosh', { volume: 0.5 + pw * 0.6 }); g.vibrate(12);
    }
    function endRoll() {
      const c0 = count(world, 0), c1 = count(world, 1);
      if (c0 && c1) { turn = 1 - turn; beginTurn(); return; }
      phase = 'end'; winner = c0 ? 0 : c1 ? 1 : -1; endT = 0;
      if (winner >= 0) for (let k = 0; k < 3; k++) setTimeout(() => burstConfetti(winner), k * 260);
      const left = winner >= 0 ? count(world, winner) : 0;
      if (winner < 0) g.over(null, { title: 'Splash — a draw!', note: 'Both teams ended up in the sea.', delay: 1800 });
      else if (two) g.over(left, { title: `${TEAM[winner].name} wins!`, label: TEAM[winner].name, win: true, delay: 1900,
        note: `${left} of ${N_TEAM} animals still on the island · ${turns[winner]} shots` });
      else if (winner === 0) {
        const score = left * 100 + Math.max(0, 16 - turns[0]) * 25;
        g.over(score, { title: 'You win!', label: levelId[0].toUpperCase() + levelId.slice(1), win: true, delay: 1900,
          note: `${left} of ${N_TEAM} animals left (${left * 100}) + ${turns[0]} shots bonus (${Math.max(0, 16 - turns[0]) * 25})` });
      } else g.over(null, { title: 'COM wins', note: `COM still has ${left} on the island. Try again!`, delay: 1900 });
    }
    function burstConfetti(t) {
      for (let k = 0; k < 26; k++) {
        const a = rand(TAU), s = rand(0.3, 0.9);
        confetti.push({ x: rand(-0.3, 0.3), y: rand(-0.1, 0.1), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.5, t: 0, life: rand(1, 1.6),
          col: k % 3 ? TEAM[t].col : k % 2 ? '#fff4b0' : TEAM[t].dot, r: rand(0.008, 0.016), rot: rand(TAU) });
      }
    }
    const humanTurn = () => phase === 'aim' && !isCom(turn);

    // ---- COM thinking (a few ms per frame)
    function think(dt) {
      plan.t += dt;
      const t0 = performance.now();
      while (plan.idx < plan.cands.length && performance.now() - t0 < 6) { const c = plan.cands[plan.idx++]; c.s = trial(world, turn, c); }
      if (plan.idx >= plan.cands.length && !plan.refined) {
        plan.refined = true;
        const top = plan.cands.slice().sort((p, q) => q.s - p.s).slice(0, 3);
        for (const c of top) for (const da of [-0.03, -0.012, 0.012, 0.03]) for (const dp of [-0.08, 0, 0.08]) plan.cands.push({ i: c.i, ang: c.ang + da, pw: clamp(c.pw + dp, 0.3, 1) });
      }
      if (plan.idx < plan.cands.length || plan.t < 1.2) return;
      const list = plan.cands.slice().sort((p, q) => q.s - p.s);
      const n = LV.top < 1 ? Math.max(3, Math.round(list.length * LV.top)) : LV.top;
      const c = list[Math.floor(Math.random() * Math.min(n, list.length))] || { i: own(turn)[0], ang: 0, pw: 0.6 };
      const err = (Math.random() + Math.random() - 1) * LV.aim * 1.6;
      comShot = { i: c.i, ang: c.ang + err, pw: clamp(c.pw * rand(...LV.pow), 0.25, 1), t: 0 };
      plan = null; phase = 'comAim';
    }

    // ---- input
    const toU = (p) => [(p.x - g.cx) / g.R, (p.y - g.cy) / g.R];
    const pullOf = (d) => {
      const i = d.i, dx = world.x[i] - d.ux, dy = world.y[i] - d.uy, m = Math.hypot(dx, dy);
      const eff = clamp((m - PR * 0.8) / PULL, 0, 1);
      return { ang: Math.atan2(dy, dx), pw: eff < 0.06 ? 0 : eff, m };
    };
    g.on('down', (p) => {
      if (!humanTurn() || drag) return;
      const [ux, uy] = toU(p);
      let best = -1, bd = 0.2;
      for (let i = 0; i < N; i++) {
        if (!world.alive[i] || world.team[i] !== turn) continue;
        const d = Math.hypot(world.x[i] - ux, world.y[i] - uy);
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) { g.sfx('click'); return; }
      drag = { i: best, ux, uy, id: p.id }; kbd = false; charging = false; kSel = best;
      if (banner && banner.t < 0.95) banner.t = 0.95;
      g.sfx('tap');
    });
    g.on('move', (p) => { if (drag && (p.id === undefined || p.id === drag.id)) [drag.ux, drag.uy] = toU(p); });
    g.on('up', (p) => {
      if (!drag || (p.id !== undefined && p.id !== drag.id)) return;
      [drag.ux, drag.uy] = toU(p);
      const s = pullOf(drag), i = drag.i;
      drag = null;
      if (humanTurn() && s.pw > 0) shoot(i, s.ang, s.pw);
    });
    g.on('key', ({ key }) => {
      if (!humanTurn()) return;
      if (banner && banner.t < 0.95) banner.t = 0.95;
      if (key === 'Tab' || key === 'ArrowRight') { kbd = true; selectKbd(1); g.sfx('tick'); }
      else if (key === 'ArrowLeft') { kbd = true; selectKbd(-1); g.sfx('tick'); }
      else if (key === 'ArrowUp' || key === 'ArrowDown') {
        if (!kbd) { kbd = true; return; }
        kAim += key === 'ArrowUp' ? -0.035 : 0.035; keyHeld[key === 'ArrowUp' ? 'up' : 'down'] = 0.0001;
      } else if ((key === ' ' || key === 'Enter') && !charging && !drag) { kbd = true; charging = true; chargeT = 0; if (kSel < 0 || !world.alive[kSel]) selectKbd(0); }
    });
    g.on('keyup', ({ key }) => {
      if (key === 'ArrowUp') keyHeld.up = 0;
      if (key === 'ArrowDown') keyHeld.down = 0;
      if ((key === ' ' || key === 'Enter') && charging) {
        charging = false;
        const pw = chargePower();
        if (humanTurn() && pw > 0.05 && kSel >= 0 && world.alive[kSel]) shoot(kSel, kAim, pw);
      }
    });
    g.on('wheel', ({ delta }) => { if (humanTurn()) { kbd = true; kAim += delta * 0.06; } });
    // Tab would move the page focus to the buttons — keep it for picking pucks while playing
    const tabKey = (e) => { if (e.key === 'Tab' && !paused && phase !== 'end') e.preventDefault(); };
    window.addEventListener('keydown', tabKey, true);
    const chargePower = () => { const u = (chargeT / 1.1) % 2; return u <= 1 ? u : 2 - u; };

    // ---- scene caches (redrawn on resize / theme change)
    let seaC = null, isleC = null, cacheKey = '';
    const sprites = new Map();
    /** A puck drawn once into a little canvas, then stamped (rotated / scaled) every frame. */
    function stamp(ctx, x, y, team, sp, r, scale, blink, mood) {
      const key = `${team}${sp}${blink ? 1 : 0}${mood}`;
      let c = sprites.get(key);
      const half = PR * 1.12;
      if (!c) {
        c = document.createElement('canvas');
        const px = Math.ceil(half * 2 * g.R * g.dpr); c.width = c.height = px;
        const x2 = c.getContext('2d'); x2.setTransform(px / (half * 2), 0, 0, px / (half * 2), px / 2, px / 2);
        puck(x2, 0, 0, team, sp, 0, 1, blink, mood);
        sprites.set(key, c);
      }
      ctx.save(); ctx.translate(x, y); ctx.rotate(r); ctx.scale(scale, scale);
      ctx.drawImage(c, -half, -half, half * 2, half * 2);
      ctx.restore();
    }
    const mk = () => { const c = document.createElement('canvas'); c.width = Math.round(g.S * g.dpr); c.height = c.width; const x = c.getContext('2d'); x.setTransform(g.dpr * g.R, 0, 0, g.dpr * g.R, g.dpr * g.cx, g.dpr * g.cy); return [c, x]; };
    function buildCaches() {
      cacheKey = `${g.S}|${g.dpr}|${THEME.flat}|${THEME.id}|${THEME.mode}`;
      sprites.clear();
      let ctx;
      // the sea
      [seaC, ctx] = mk();
      ctx.fillStyle = SEA.base; ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
      if (!THEME.flat) {
        const gr = ctx.createRadialGradient(0, 0, 0.3, 0, 0, 1.05);
        gr.addColorStop(0, '#2a74c9'); gr.addColorStop(0.6, SEA.base); gr.addColorStop(1, THEME.mode === 'oled' ? '#06204d' : SEA.deep);
        ctx.fillStyle = gr; ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
      }
      shorePath(ctx, 0.11, 0.012); ctx.fillStyle = 'rgba(70,150,225,.55)'; ctx.fill();
      shorePath(ctx, 0.075, 0.01); ctx.fillStyle = 'rgba(95,175,235,.45)'; ctx.fill();
      // the island
      [isleC, ctx] = mk();
      shorePath(ctx, 0.042, 0.008, 0.028); ctx.fillStyle = SAND.cliff; ctx.fill(); ctx.lineWidth = 0.007; ctx.strokeStyle = SAND.line; ctx.stroke();
      shorePath(ctx, 0.042, 0.008); ctx.fillStyle = SAND.top; ctx.fill(); ctx.lineWidth = 0.006; ctx.strokeStyle = SAND.line; ctx.stroke();
      ctx.save(); islandPath(ctx); ctx.clip();
      ctx.fillStyle = GRASS.a; ctx.fillRect(-A, -B, 2 * A, 2 * B);
      ctx.fillStyle = GRASS.b;
      for (let x = -A, k = 0; x < A; x += 0.135, k++) if (k % 2) ctx.fillRect(x, -B, 0.135, 2 * B);
      if (!THEME.flat) {
        const gr = ctx.createRadialGradient(0, 0, 0.15, 0, 0, 0.95);
        gr.addColorStop(0, 'rgba(255,255,170,.13)'); gr.addColorStop(0.6, 'rgba(255,255,170,0)'); gr.addColorStop(1, 'rgba(25,80,0,.32)');
        ctx.fillStyle = gr; ctx.fillRect(-A, -B, 2 * A, 2 * B);
      } else { islandPath(ctx); ctx.lineWidth = 0.09; ctx.strokeStyle = 'rgba(30,90,10,.18)'; ctx.stroke(); }
      // field markings: an inner line and the lighter centre circle
      ctx.beginPath(); ctx.roundRect(-A + 0.11, -B + 0.11, 2 * (A - 0.11), 2 * (B - 0.11), C - 0.07);
      ctx.lineWidth = 0.008; ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 0.27, 0, TAU); ctx.fillStyle = 'rgba(225,255,160,.16)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 0.025, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fill();
      // little grass tufts
      ctx.strokeStyle = GRASS.tuft; ctx.lineWidth = 0.006; ctx.lineCap = 'round';
      for (let k = 0; k < 46; k++) {
        const x = Math.sin(k * 12.9898) * 0.68, y = Math.sin(k * 78.233 + 3) * 0.56;
        if (sdIsland(x, y) > -0.07 || Math.hypot(x, y) < 0.3) continue;
        ctx.beginPath(); ctx.moveTo(x - 0.012, y - 0.016); ctx.lineTo(x, y); ctx.lineTo(x + 0.004, y - 0.022); ctx.moveTo(x, y); ctx.lineTo(x + 0.014, y - 0.014); ctx.stroke();
      }
      ctx.restore();
      islandPath(ctx); ctx.lineWidth = 0.01; ctx.strokeStyle = GRASS.edge; ctx.stroke();
      // the stone walls: chunky boulders (shadow, body, outline, a lighter top, a crack)
      const blob = (L, Hh, seed) => {
        ctx.beginPath();
        const pts = [];
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * TAU, c = Math.cos(a), sn = Math.sin(a), j = 1 + 0.07 * Math.sin(seed * 3.7 + k * 2.3);
          pts.push([Math.sign(c) * Math.abs(c) ** 0.6 * L / 2 * j, Math.sign(sn) * Math.abs(sn) ** 0.6 * Hh / 2 * j]);
        }
        for (let k = 0; k <= 12; k++) {
          const [x0, y0] = pts[k % 12], [x1, y1] = pts[(k + 1) % 12], mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          if (k === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(x0, y0, mx, my);
        }
        ctx.closePath();
      };
      for (const pass of [0, 1]) for (const st of STONES) {
        const len = Math.hypot(st.bx - st.ax, st.by - st.ay);
        const L = (len + st.r * 1.8) * st.w, Hh = st.r * 2.15 * st.h, ang = Math.atan2(st.by - st.ay, st.bx - st.ax);
        ctx.save(); ctx.translate(st.mx, st.my + (pass ? 0 : 0.014)); ctx.rotate(ang);
        blob(L, Hh, st.seed);
        if (!pass) { ctx.fillStyle = 'rgba(40,45,30,.45)'; ctx.fill(); ctx.restore(); continue; }
        ctx.fillStyle = STONE.fill; ctx.fill(); ctx.lineWidth = 0.0075; ctx.strokeStyle = STONE.line; ctx.stroke();
        ctx.save(); ctx.clip();
        // lower part a tone darker, upper a tone lighter (in screen space: light from the top)
        ctx.rotate(-ang);
        ctx.fillStyle = STONE.dark; ctx.beginPath(); ctx.ellipse(0.01, Hh * 0.75 + 0.012, L * 0.75, Hh * 0.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = STONE.light; ctx.beginPath(); ctx.ellipse(-L * 0.12, -Hh * 0.38, L * 0.32, Hh * 0.22, -0.15, 0, TAU); ctx.fill();
        ctx.restore();
        ctx.lineWidth = 0.0045; ctx.strokeStyle = 'rgba(61,64,70,.6)'; ctx.lineCap = 'round'; ctx.beginPath();
        const cx0 = Math.sin(st.seed * 5) * L * 0.22, up = Math.sin(st.seed * 2) > 0 ? 1 : -1;
        ctx.moveTo(cx0, up * Hh * 0.46); ctx.lineTo(cx0 + 0.008, up * Hh * 0.12); ctx.lineTo(cx0 + 0.001, -up * 0.002); ctx.stroke();
        ctx.fillStyle = STONE.dark;
        ctx.beginPath(); ctx.arc(-cx0 * 0.8, Hh * 0.12, 0.005, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }

    // ---- sea decoration
    const WAVES = [];
    for (let k = 0; k < 40 && WAVES.length < 26; k++) {
      const a = k * 2.39996, r = 0.82 + (k * 0.618 % 1) * 0.2, x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (sdIsland(x, y) > 0.13 && Math.hypot(x, y) < 1.0) WAVES.push({ x, y, ph: k * 1.7, w: 0.035 + (k % 3) * 0.012 });
    }

    // ---- drawing helpers
    function drawArrow(ctx, x, y, ang, pw, team, alpha = 1) {
      const T = TEAM[team];
      const s0 = PR * 1.2, L = 0.07 + 0.42 * pw, hw = 0.022 + 0.012 * pw, hl = 0.06, hW = 0.055 + 0.018 * pw;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(s0, -hw); ctx.lineTo(s0 + L - hl, -hw); ctx.lineTo(s0 + L - hl, -hW); ctx.lineTo(s0 + L, 0);
      ctx.lineTo(s0 + L - hl, hW); ctx.lineTo(s0 + L - hl, hw); ctx.lineTo(s0, hw); ctx.closePath();
      ctx.fillStyle = pw > 0.9 ? 'rgba(255,240,170,.82)' : 'rgba(255,255,255,.72)'; ctx.fill();
      ctx.lineJoin = 'round'; ctx.lineWidth = 0.007; ctx.strokeStyle = T.ink; ctx.stroke();
      ctx.restore();
    }
    function drawBand(ctx, x, y, ex, ey) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.setLineDash([0.018, 0.014]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.lineWidth = 0.007; ctx.strokeStyle = 'rgba(30,25,20,.7)'; ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(ex, ey, 0.014, 0, TAU); ctx.fillStyle = '#2a211e'; ctx.fill();
      ctx.restore();
    }
    function plaque(t, active) {
      const { ctx, R, cx, cy } = g;
      const k = 1 + bump[t] * 0.25 + (active ? 0.04 * Math.sin(time * 5) + 0.04 : 0);
      const x = cx + (t ? 0.27 : -0.27) * R, y = cy - 0.672 * R, w = 0.25 * R * k, h = 0.11 * R * k;
      const T = TEAM[t];
      ctx.save();
      ctx.globalAlpha = active || phase === 'end' ? 1 : 0.85;
      g.draw.roundRect(x - w / 2, y - h / 2 + R * 0.012, w, h, h * 0.32, STONE.line);
      g.draw.roundRect(x - w / 2, y - h / 2, w, h, h * 0.32, T.col, { stroke: STONE.line, lw: R * 0.007 });
      g.draw.roundRect(x - w * 0.06, y - h * 0.32, w * 0.47, h * 0.64, h * 0.16, T.ink);
      g.draw.text(String(N_TEAM - count(world, 1 - t)), x + w * 0.175, y + h * 0.03, h * 0.5, { color: '#fff', weight: 800 });
      // a mini animal of the team on the plaque
      ctx.save(); ctx.translate(x - w * 0.26, y); ctx.scale(R * 0.68 * k, R * 0.68 * k);
      puck(ctx, 0, 0, t, TEAM[t].species[0], 0, 1, false, 'idle');
      ctx.restore();
      const label = two ? (t ? 'P2' : 'P1') : t ? 'COM' : 'YOU';
      ctx.font = `800 ${Math.round(R * 0.045)}px ${THEME.display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = R * 0.014; ctx.strokeStyle = T.ink; ctx.strokeText(label, x, y - h * 0.9);
      ctx.fillStyle = '#fff'; ctx.fillText(label, x, y - h * 0.9);
      ctx.restore();
    }
    function pill(cxp, cyp, text, team, alpha = 1, scale = 1, big = false) {
      const { ctx, R } = g, T = TEAM[team];
      const fs = R * (big ? 0.09 : 0.052) * scale;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.font = `800 ${Math.round(fs)}px ${THEME.display}`;
      const tw = ctx.measureText(text).width, ic = big ? 0 : fs * 1.25;
      const w = tw + fs * 1.6 + ic, h = fs * 1.9, x = cxp - w / 2, y = cyp - h / 2;
      g.draw.roundRect(x, y + R * 0.01 * scale, w, h, h / 2, T.ink);
      g.draw.roundRect(x, y, w, h, h / 2, T.col, { stroke: T.ink, lw: R * 0.008 * scale });
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = fs * 0.22; ctx.strokeStyle = T.ink; ctx.strokeText(text, cxp + ic / 2, cyp + fs * 0.04);
      ctx.fillStyle = '#fff'; ctx.fillText(text, cxp + ic / 2, cyp + fs * 0.04);
      if (ic) {   // a mini animal of that team
        ctx.save(); ctx.translate(x + fs * 0.75 + ic * 0.3, cyp); ctx.scale(R * fs / (R * PR * 2.1), R * fs / (R * PR * 2.1));
        puck(ctx, 0, 0, team, TEAM[team].species[0], 0, 1, false, 'idle');
        ctx.restore();
      }
      ctx.restore();
    }

    // ---- frame
    let acc = 0;
    g.loop((dt) => {
      const { ctx, R, cx, cy } = g;
      time += dt;
      if (cacheKey !== `${g.S}|${g.dpr}|${THEME.flat}|${THEME.id}|${THEME.mode}`) buildCaches();

      // ---- update
      acc = Math.min(acc + dt, 0.1);
      while (acc >= HSTEP) { step(world, ev); acc -= HSTEP; }
      for (let i = 0; i < N; i++) {
        if (!world.alive[i]) continue;
        const sp = Math.hypot(world.vx[i], world.vy[i]);
        rot[i] += spin[i] * dt; spin[i] *= Math.exp(-2.5 * dt);
        if (!sp && Math.abs(spin[i]) < 0.6) { spin[i] = 0; rot[i] += angDiff(rot[i], Math.round(rot[i] / TAU) * TAU) * Math.min(1, dt * 2.5); }
        if ((blinkAt[i] -= dt) < -0.14) blinkAt[i] = rand(1.5, 5);
      }
      for (let k = fallers.length - 1; k >= 0; k--) {
        const f = fallers[k]; f.t += dt;
        f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= Math.exp(-3 * dt); f.vy *= Math.exp(-3 * dt);
        rot[f.i] += (spin[f.i] + 4) * dt;
        if (f.t >= 0.42) {
          fallers.splice(k, 1);
          const t = world.team[f.i];
          splashes.push({ x: f.x, y: f.y + 0.02, t: 0, col: TEAM[t].col,
            drops: Array.from({ length: 14 }, () => ({ a: rand(TAU), s: rand(0.1, 0.3), up: rand(0.3, 0.65), r: rand(0.009, 0.017) })) });
          g.sfx('drop', { pitch: rand(0.6, 0.8) }); g.sfx('whoosh', { volume: 0.6 });
          bump[1 - t] = 1; g.vibrate(25);
          const mine = phase === 'roll' && t === turn;
          const fd = Math.hypot(f.x, f.y), fk = fd > 0.66 ? 0.66 / fd : 1;
          g.draw.float(mine ? 'Oops!' : 'Splash!', cx + f.x * fk * R, cy + f.y * fk * R, '#fff', R * 0.07);
        }
      }
      for (const b of [0, 1]) bump[b] = Math.max(0, bump[b] - dt * 3);
      if (banner && (banner.t += dt) > 1.2) banner = null;

      if (phase === 'think') think(dt);
      else if (phase === 'comAim') {
        comShot.t += dt;
        if (comShot.t > 0.85) shoot(comShot.i, comShot.ang, comShot.pw);
      } else if (phase === 'roll') {
        rollT += dt;
        if (rollT > 25) { world.vx.fill(0); world.vy.fill(0); }
        if (!moving(world) && !fallers.length) { if ((settle += dt) > 0.35) endRoll(); } else settle = 0;
      } else if (phase === 'end') endT += dt;
      if (charging) chargeT += dt;
      for (const [k, d] of [['up', -1], ['down', 1]]) if (keyHeld[k]) { keyHeld[k] += dt; if (keyHeld[k] > 0.28) kAim += d * 1.5 * dt; }

      // ---- draw: sea, waves, foam
      ctx.drawImage(seaC, 0, 0, g.S, g.S);
      ctx.save(); ctx.translate(cx, cy); ctx.scale(R, R);
      ctx.lineCap = 'round'; ctx.lineWidth = 0.008; ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.beginPath();
      for (const w of WAVES) {
        const x = w.x + Math.sin(time * 0.5 + w.ph) * 0.025, y = w.y + Math.cos(time * 0.7 + w.ph) * 0.008;
        ctx.moveTo(x - w.w, y); ctx.quadraticCurveTo(x - w.w / 2, y - 0.018, x, y); ctx.quadraticCurveTo(x + w.w / 2, y + 0.018, x + w.w, y);
      }
      ctx.stroke();
      shorePath(ctx, 0.058 + 0.01 * Math.sin(time * 1.6), 0.01);
      ctx.setLineDash([0.05, 0.03]); ctx.lineDashOffset = -time * 0.03;
      ctx.lineWidth = 0.012; ctx.strokeStyle = SEA.foam; ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      ctx.drawImage(isleC, 0, 0, g.S, g.S);

      // ---- pucks
      ctx.save(); ctx.translate(cx, cy); ctx.scale(R, R);
      const myTurn = phase === 'aim' || phase === 'think' || phase === 'comAim';
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      const selI = drag ? drag.i : comShot ? comShot.i : kbd && humanTurn() ? kSel : -1;
      for (let i = 0; i < N; i++) {
        if (!world.alive[i]) continue;
        const t = world.team[i], active = myTurn && t === turn;
        let sc = 1, mood = 'idle';
        if (phase === 'end') {
          if (t === winner) { mood = 'happy'; sc = 1 + 0.06 * Math.abs(Math.sin(time * 7 + i)); }
        } else if (active) sc = 1 + 0.025 * pulse;
        if (active) {
          ctx.beginPath(); ctx.arc(world.x[i], world.y[i], PR * sc + 0.011, 0, TAU);
          ctx.lineWidth = 0.008; ctx.strokeStyle = `rgba(255,255,255,${0.45 + 0.4 * pulse})`; ctx.stroke();
        }
        stamp(ctx, world.x[i], world.y[i], t, species[i], rot[i], sc, blinkAt[i] < 0, mood);
      }
      // selection ring + aim
      if (selI >= 0 && world.alive[selI]) {
        const x = world.x[selI], y = world.y[selI];
        ctx.save(); ctx.setLineDash([0.02, 0.014]); ctx.lineDashOffset = -time * 0.06;
        ctx.beginPath(); ctx.arc(x, y, PR + 0.022, 0, TAU); ctx.lineWidth = 0.009; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.restore();
        let ang = null, pw = 0, ex = x, ey = y;
        if (drag) {
          const s = pullOf(drag); ang = s.ang; pw = s.pw;
          const m = Math.min(s.m, PULL + PR); ex = x - Math.cos(ang) * m; ey = y - Math.sin(ang) * m;
        } else if (comShot) {
          const k = ease.out(clamp(comShot.t / 0.7, 0, 1)); ang = comShot.ang; pw = comShot.pw * k;
          ex = x - Math.cos(ang) * (PR + pw * PULL); ey = y - Math.sin(ang) * (PR + pw * PULL);
        } else if (kbd) {
          ang = kAim; pw = charging ? chargePower() : 0;
          ex = x - Math.cos(ang) * (PR + pw * PULL); ey = y - Math.sin(ang) * (PR + pw * PULL);
        }
        if (ang !== null) {
          if (pw > 0 || drag || comShot) drawBand(ctx, x, y, ex, ey);
          if (pw > 0) drawArrow(ctx, x, y, ang, pw, turn);
          else if (kbd && !drag) drawArrow(ctx, x, y, ang, 0, turn, 0.55);
        }
      }
      ctx.restore();

      // ---- HUD: score plaques, whose turn
      plaque(0, myTurn && turn === 0); plaque(1, myTurn && turn === 1);
      // falling animals, splashes and confetti go over the plaques
      ctx.save(); ctx.translate(cx, cy); ctx.scale(R, R);
      for (const f of fallers) {
        const k = f.t / 0.42;
        ctx.save(); ctx.globalAlpha = 1 - k * 0.6;
        stamp(ctx, f.x, f.y + k * k * 0.04, world.team[f.i], species[f.i], rot[f.i], 1 - 0.65 * ease.inOut(k), false, 'fall');
        ctx.restore();
      }
      // splashes: ripples, a foamy crown and flying drops
      for (let k = splashes.length - 1; k >= 0; k--) {
        const s = splashes[k]; s.t += dt;
        if (s.t > 1.25) { splashes.splice(k, 1); continue; }
        const u = s.t / 1.25;
        for (const d of [0, 0.22, 0.44]) {
          const v = clamp((s.t - d) / 0.8, 0, 1); if (v <= 0 || v >= 1) continue;
          const rr = 0.04 + ease.out(v) * 0.15;
          ell(ctx, s.x, s.y, rr, rr * 0.55); ctx.lineWidth = 0.012 * (1 - v) + 0.003; ctx.strokeStyle = `rgba(255,255,255,${(1 - v) * 0.9})`; ctx.stroke();
        }
        if (s.t < 0.7) {
          const a = 1 - s.t / 0.7;
          ell(ctx, s.x, s.y, 0.075, 0.04); ctx.fillStyle = `rgba(225,245,255,${0.85 * a})`; ctx.fill();
          const hgt = 0.11 * Math.sin(Math.PI * Math.min(1, s.t / 0.55));
          ctx.fillStyle = `rgba(255,255,255,${0.95 * a})`;
          for (let j = 0; j < 7; j++) {
            const ang = -Math.PI / 2 + (j - 3) * 0.32, len = hgt * (j % 2 ? 0.75 : 1);
            ell(ctx, s.x + Math.cos(ang) * len * 0.5, s.y + Math.sin(ang) * len * 0.5, len * 0.5, 0.012, ang); ctx.fill();
          }
        }
        for (const d of s.drops) {
          const tt = Math.min(s.t, 1), x = s.x + Math.cos(d.a) * d.s * tt, y = s.y + Math.sin(d.a) * d.s * tt * 0.5 - (d.up * tt - 0.75 * tt * tt);
          ctx.globalAlpha = clamp(1.2 - u * 1.3, 0, 1);
          ctx.beginPath(); ctx.arc(x, y, d.r * (1 - u * 0.5), 0, TAU); ctx.fillStyle = d.a > 3 ? '#ffffff' : '#bfe6ff'; ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // confetti
      for (let k = confetti.length - 1; k >= 0; k--) {
        const c = confetti[k]; c.t += dt;
        if (c.t > c.life) { confetti.splice(k, 1); continue; }
        c.vy += 1.2 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += dt * 6;
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.globalAlpha = 1 - c.t / c.life;
        ctx.fillStyle = c.col; ctx.fillRect(-c.r, -c.r * 0.5, c.r * 2, c.r); ctx.restore();
      }
      ctx.restore();
      if (phase !== 'end') {
        const T = TEAM[turn];
        let text = turnText(turn);
        if (phase === 'think' || phase === 'comAim') text = 'COM is aiming…';
        if (phase === 'roll') text = two ? `${T.name}…` : isCom(turn) ? 'COM…' : 'Nice shot…';
        pill(cx, cy + R * 0.81, text, turn, phase === 'roll' ? 0.7 : 1);
      }
      if (banner) {
        const u = banner.t, k = u < 0.3 ? ease.back(u / 0.3) : 1, a = u > 1 ? 1 - (u - 1) / 0.2 : 1;
        pill(cx, cy, banner.text, banner.team, clamp(a, 0, 1), (0.6 + 0.4 * k) * (u > 1 ? 1 + (u - 1) * 0.6 : 1), true);
      }
      g.draw.floaters(dt);
    });

    // ---- go
    beginTurn();
    return {
      pause() { paused = true; charging = false; drag = null; keyHeld = { up: 0, down: 0 }; },
      resume() { paused = false; },
      destroy() { window.removeEventListener('keydown', tabKey, true); },
    };
  },
};
