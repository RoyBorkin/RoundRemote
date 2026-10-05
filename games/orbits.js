// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Orbits — two ways to play with gravity on the round screen.
//  Spinning: 30 hand-made levels. Touch where a planet should start, drag to set its speed and direction
//    (a dotted line shows where it will go), let go to fling it. Keep planets circling the black holes until the
//    orbit ring fills (a full turn round a hole = one orbit; a planet that's swallowed, smashed or flies off takes
//    its orbits with it). Every level has a few planets to spend; the run ends when they're all gone and the ring
//    isn't full. Score = orbits + 10 per level + 5 per planet left over. Progress is saved: the next run can
//    continue from the furthest level reached.
//  Targets: endless. Your planet circles a sun; tap to let go — it flies off along the tangent (nearby suns bend
//    the path a little) and must cross the next orbit ring to be caught. Hit the sun or miss the ring and you lose
//    a life; wait too long and the orbit decays. Stars on the way and grazing catches are worth extra. 3 lives.
import { TAU, rand, clamp, angDiff, polar, THEME } from './kit.js';
import { store } from '../js/core/store.js';
import { LEVELS, PHYS, posAt, holeR, makeWorld, addPlanet, stepWorld, orbitCount, predict, hazard } from './orbits-levels.js';

const ID = 'orbits';
const prog = () => (store.get('gameProgress') || {})[ID] || {};
function saveProg(patch) {
  const all = store.get('gameProgress') || {};
  store.set('gameProgress', { ...all, [ID]: { ...(all[ID] || {}), ...patch } });
}
const unlocked = () => clamp(prog().unlocked || 1, 1, LEVELS.length);
// the start-card choice shows how far you've got ("Continue · L7")
const START = { id: 'start', name: 'Start', choices: [{ id: 'cont', name: 'Continue' }, { id: 'one', name: 'Level 1' }] };
function labelStart() { const n = unlocked(); START.choices[0].name = n > 1 ? `Continue · L${n}` : 'Continue'; }
labelStart();

const PLANETS = ['#4d9bff', '#ff5a6a', '#3ddc84', '#ffc857', '#b57bff', '#2ee6d6', '#ff8ad8', '#ff9f43'];
const SUNS = ['#ffc857', '#ff9f43', '#ff5a6a', '#ff8ad8', '#b57bff', '#2ee6d6', '#3ddc84', '#4d9bff'];
const pal = () => (THEME.light ? {
  hole: '#191926', rim: '#f97316', white: '#ffffff', wrim: '#0284c7', rock: '#8d92a1', rockEdge: '#5d6272', star: '#e0a000', outline: true,
} : {
  hole: '#000000', rim: '#ffb36b', white: '#f4f1ff', wrim: '#8be3ff', rock: '#666b79', rockEdge: '#9aa0ae', star: '#ffd166', outline: false,
});

// a faint starfield (fixed per page; drawn in three alpha groups so it costs three fills)
const SKY = Array.from({ length: 90 }, () => ({ x: rand(-1, 1), y: rand(-1, 1), r: rand(0.0018, 0.0042), k: Math.floor(rand(3)) }));
function drawSky(g, ox = 0, oy = 0) {
  const { ctx, cx, cy, R } = g;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    for (const s of SKY) {
      if (s.k !== k) continue;
      const x = ((s.x - ox * (0.1 + 0.06 * k) + 3) % 2) - 1, y = ((s.y - oy * (0.1 + 0.06 * k) + 3) % 2) - 1;
      const px = cx + x * R, py = cy + y * R, r = s.r * R;
      ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, TAU);
    }
    ctx.fillStyle = THEME.ink(THEME.light ? 0.1 + k * 0.06 : 0.14 + k * 0.12); ctx.fill();
  }
}
function planet(g, x, y, r, col) {
  g.draw.ball(x, y, r, col);
  if (pal().outline) { const { ctx } = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = g.draw.shade(col, -0.4); ctx.lineWidth = Math.max(1, g.R * 0.004); ctx.stroke(); }
}
function star5(g, x, y, r, rot, col) {
  const { ctx } = g;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = rot + (i / 10) * TAU, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.sin(a) * rr, y - Math.cos(a) * rr); }
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
}
/** Fading trail from a ring buffer of world points (drawn as a few strokes of rising alpha). */
function drawTrail(g, buf, n, head, cap, col, toX, toY, width) {
  if (n < 2) return;
  const { ctx } = g, K = 5;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const start = (head - n + cap) % cap;
  for (let k = 0; k < K; k++) {
    const i0 = Math.floor((k * (n - 1)) / K), i1 = Math.floor(((k + 1) * (n - 1)) / K);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) { const j = ((start + i) % cap) * 2; const X = toX(buf[j]), Y = toY(buf[j + 1]); if (i === i0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
    ctx.strokeStyle = g.draw.alpha(col, (0.08 + 0.62 * (k + 1) / K) * (THEME.light ? 1 : 0.9));
    ctx.lineWidth = width * (0.35 + 0.65 * (k + 1) / K);
    ctx.stroke();
  }
}

export default {
  howTo: 'Spinning: touch where a planet should start, drag to aim, let go — keep planets circling the black holes until the ring fills. Planets per level are limited. Targets: tap to leave your orbit and fly into the next ring; grab stars, 3 lives.',
  modes: [
    { id: 'spin', name: 'Spinning', options: [START] },
    { id: 'targets', name: 'Targets' },
  ],
  scoring: 'high',
  create(g, { mode, opts }) {
    return mode === 'targets' ? targets(g) : spinning(g, opts || {});
  },
};

// =================================================================================== Spinning
function spinning(g, opts) {
  const { DT, PR, VK, VMAX } = PHYS;
  const first = opts.start === 'one' ? 0 : unlocked() - 1;
  let li = first, lv = null, w = null, banked = 0, launched = 0, phase = 'play', phaseT = 0, levelT = 0;
  let aim = null, acc = 0, count = 0, lastCount = 0, stallT = 0, pulse = 0, hintOn = true, cleared = 0;
  let rocks = [];
  const pred = new Float32Array(2 * 200);
  const TRN = 70;
  let art = null, actx = null;

  const X = (x) => g.cx + x * g.R, Y = (y) => g.cy + y * g.R;

  function makeArt(keep) {
    const old = art;
    art = document.createElement('canvas');
    art.width = Math.max(1, Math.round(g.S * g.dpr)); art.height = art.width;
    actx = art.getContext('2d');
    if (keep && old) actx.drawImage(old, 0, 0, art.width, art.height);
    actx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    actx.lineCap = 'round'; actx.lineJoin = 'round';
  }
  makeArt(false);
  const offResize = g.on('resize', () => makeArt(true));

  function startLevel(i) {
    li = i; lv = LEVELS[i]; w = makeWorld(lv);
    launched = 0; phase = 'play'; phaseT = 0; levelT = 0; count = 0; lastCount = 0; stallT = 0; aim = null; acc = 0;
    hintOn = !!lv.hint || i === 0;
    rocks = (lv.rocks || []).map((r) => ({ pts: Array.from({ length: 9 }, (_, k) => ({ a: (k / 9) * TAU + rand(-0.2, 0.2), r: r.r * rand(0.78, 1.12) })), spin: rand(-1, 1) }));
    actx.save(); actx.setTransform(1, 0, 0, 1, 0, 0); actx.clearRect(0, 0, art.width, art.height); actx.restore();
    updSub();
  }
  function updSub() { g.sub(`Level ${li + 1}  ·  ${count} / ${lv.target} orbits`); }
  const nextCol = () => PLANETS[(launched + li) % PLANETS.length];

  function onEvent(type, p, data) {
    if (type === 'orbit') {
      if (phase !== 'play') return;
      g.draw.float('+1', X(p.x), Y(p.y) - g.R * 0.04, p.col, g.R * 0.05);
      g.sfx('tick'); pulse = 1;
    } else if (type === 'die') {
      const x = X(p.x), y = Y(p.y);
      if (data === 'hole') { g.draw.burst(x, y, p.col, 10, g.R * 0.25, g.R * 0.008); g.sfx('drop'); }
      else if (data === 'rock') { g.draw.burst(x, y, p.col, 22, g.R * 0.6, g.R * 0.012); g.sfx('hit'); g.vibrate(25); }
      else g.sfx('whoosh');
      if (phase === 'play' && p.orbits > 0 && data !== 'lost') g.draw.float(`−${p.orbits}`, x, y - g.R * 0.04, THEME.danger, g.R * 0.055);
      if (phase === 'play' && p.orbits > 0 && data === 'lost') g.toast(`Lost ${p.orbits} orbit${p.orbits > 1 ? 's' : ''}`, 900);
    }
  }

  function launch() {
    const v = aimVel();
    if (Math.hypot(aim.px - aim.x, aim.py - aim.y) < 0.03) { aim = null; return; }
    const p = addPlanet(w, aim.x, aim.y, v[0], v[1], { col: nextCol(), tr: new Float32Array(TRN * 2), tn: 0, th: 0, lx: aim.x, ly: aim.y });
    launched++; aim = null; hintOn = false; stallT = 0;
    g.sfx('whoosh', { pitch: 1.6, volume: 0.6 });
    if (hazard(w, p.x, p.y)) { p.alive = false; p.dead = 'hole'; onEvent('die', p, 'hole'); }
  }
  function aimVel() {
    let vx = (aim.px - aim.x) * VK, vy = (aim.py - aim.y) * VK;
    const s = Math.hypot(vx, vy);
    if (s > VMAX) { vx *= VMAX / s; vy *= VMAX / s; }
    return [vx, vy];
  }

  function clearLevel() {
    phase = 'clear'; phaseT = 0; cleared++;
    const spare = lv.planets - launched, bonus = 10 + 5 * spare;
    banked += lv.target + bonus;
    g.score(banked);
    g.sfx('win'); g.vibrate(30);
    g.draw.burst(g.cx, g.cy, g.color, 30, g.R * 0.9, g.R * 0.012);
    clearInfo = { bonus, spare };
    if (li + 2 > unlocked() && li + 1 < LEVELS.length) { saveProg({ unlocked: li + 2 }); labelStart(); }
    if (li + 1 >= LEVELS.length) {
      saveProg({ done: true });
      g.over(banked, { win: true, title: 'All 30 levels!', note: 'Every ring filled. What a sky you painted.', label: runLabel(true), delay: 3200 });
    }
  }
  let clearInfo = null;
  const runLabel = (won) => (first === li && !won ? `Level ${li + 1}` : `L${first + 1}–${li + 1}`);
  function fail(why) {
    if (phase !== 'play') return;
    phase = 'fail'; phaseT = 0; aim = null;
    const score = banked + count;
    g.over(score, {
      title: why,
      note: `Level ${li + 1} · ${cleared} level${cleared === 1 ? '' : 's'} cleared this run.${unlocked() > 1 ? ` Continue from level ${unlocked()} next time.` : ''}`,
      label: runLabel(false), delay: 1500,
    });
  }
  function nextLevel() { if (li + 1 < LEVELS.length) { startLevel(li + 1); g.sfx('tap'); } }

  // ---------- input ----------
  g.on('down', (p) => {
    if (phase === 'clear') { if (phaseT > 0.5) nextLevel(); return; }
    if (phase !== 'play') return;
    if (launched >= lv.planets) { g.toast('No planets left', 900); return; }
    const x = p.dx / g.R, y = p.dy / g.R;
    if (x * x + y * y > 0.93 * 0.93) return;
    if (hazard(w, x, y, 0.025)) { g.toast('Too close', 700); g.sfx('hit', { volume: 0.5 }); return; }
    aim = { x, y, px: x, py: y };
    g.sfx('tap', { volume: 0.6 });
  });
  g.on('move', (p) => { if (aim) { aim.px = p.dx / g.R; aim.py = p.dy / g.R; } });
  g.on('up', () => { if (aim && phase === 'play') launch(); else aim = null; });
  g.on('key', ({ key }) => { if ((key === ' ' || key === 'Enter') && phase === 'clear' && phaseT > 0.5) nextLevel(); });

  startLevel(first);
  g.score(0);

  // ---------- frame ----------
  g.loop((dt, t) => {
    const { ctx, R } = g;
    const P = pal();
    phaseT += dt; levelT += dt; pulse = Math.max(0, pulse - dt * 2.5);
    // physics at a fixed 120 Hz
    acc = Math.min(acc + dt, DT * 10);
    while (acc >= DT) { stepWorld(w, onEvent); acc -= DT; }
    if (phase === 'play') {
      count = Math.min(orbitCount(w), lv.target);
      if (count !== lastCount) { if (count > lastCount) stallT = 0; lastCount = count; updSub(); }
      if (g.scoreValue !== banked + count) g.score(banked + count);
      if (count >= lv.target) clearLevel();
      else if (launched >= lv.planets && !aim) {
        const alive = w.planets.some((q) => q.alive);
        stallT += dt;
        if (!alive) fail('Out of planets');
        else if (stallT > 14) fail('Out of planets');
      }
    }

    // trails into the art layer + the short live trail
    for (const q of w.planets) {
      if (!q.alive) continue;
      const dx = q.x - q.lx, dy = q.y - q.ly;
      if (dx * dx + dy * dy > 0.00004) {
        actx.beginPath(); actx.moveTo(X(q.lx), Y(q.ly)); actx.lineTo(X(q.x), Y(q.y));
        actx.strokeStyle = g.draw.alpha(q.col, THEME.light ? 0.4 : 0.32); actx.lineWidth = R * 0.0055; actx.stroke();
        q.lx = q.x; q.ly = q.y;
      }
      q.tr[q.th * 2] = q.x; q.tr[q.th * 2 + 1] = q.y; q.th = (q.th + 1) % TRN; q.tn = Math.min(TRN, q.tn + 1);
    }

    // ---- draw ----
    g.draw.bg({ glow: 0.1, ring: false });
    drawSky(g);
    ctx.drawImage(art, 0, 0, g.S, g.S);
    // rocks
    (lv.rocks || []).forEach((r, i) => {
      const [x, y] = w.rp[i], rk = rocks[i], rot = t * rk.spin * 0.6;
      ctx.beginPath();
      rk.pts.forEach((v, k) => { const a = v.a + rot; const px = X(x) + Math.cos(a) * v.r * R, py = Y(y) + Math.sin(a) * v.r * R; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.closePath(); ctx.fillStyle = P.rock; ctx.fill(); ctx.strokeStyle = P.rockEdge; ctx.lineWidth = Math.max(1, R * 0.004); ctx.stroke();
    });
    // holes
    lv.holes.forEach((h, i) => drawHole(g, X(w.hp[i][0]), Y(w.hp[i][1]), holeR(h) * R, h.m, t + i * 1.7, P));
    // planets + live trails
    for (const q of w.planets) {
      if (!q.alive) continue;
      drawTrail(g, q.tr, q.tn, q.th, TRN, q.col, X, Y, R * 0.012);
      planet(g, X(q.x), Y(q.y), PR * R, q.col);
    }
    // aiming: the planet, the drag line and the dotted preview
    if (aim) {
      const col = nextCol(), v = aimVel();
      const n = predict(w, aim.x, aim.y, v[0], v[1], lv.preview || 1.15, 6, pred);
      for (let i = 0; i < n; i++) g.draw.ball(X(pred[i * 2]), Y(pred[i * 2 + 1]), R * (0.0075 - i * 0.00012), g.draw.alpha(col, 0.85 * (1 - i / (n + 4))));
      if (pred.dead && n) {
        const ex = X(pred[(n - 1) * 2]), ey = Y(pred[(n - 1) * 2 + 1]), s = R * 0.018;
        ctx.beginPath(); ctx.moveTo(ex - s, ey - s); ctx.lineTo(ex + s, ey + s); ctx.moveTo(ex + s, ey - s); ctx.lineTo(ex - s, ey + s);
        ctx.strokeStyle = THEME.danger; ctx.lineWidth = R * 0.007; ctx.lineCap = 'round'; ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(X(aim.x), Y(aim.y)); ctx.lineTo(X(aim.px), Y(aim.py));
      ctx.strokeStyle = THEME.ink(0.22); ctx.lineWidth = R * 0.005; ctx.setLineDash([R * 0.012, R * 0.014]); ctx.stroke(); ctx.setLineDash([]);
      g.draw.circle(X(aim.px), Y(aim.py), R * 0.022, null, { stroke: THEME.ink(0.3), lw: R * 0.004 });
      planet(g, X(aim.x), Y(aim.y), PR * R, col);
    }
    // the orbit ring round the edge: one segment per orbit needed
    const segs = lv.target, gap = Math.min(0.06, 0.9 / segs) * 0.5, rr = R * 0.948;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * TAU + gap, a1 = ((i + 1) / segs) * TAU - gap, on = i < count;
      const col = on ? g.color : THEME.ink(THEME.light ? 0.12 : 0.1);
      g.draw.arc(g.cx, g.cy, rr, a0, a1, col, R * (on ? 0.016 + (i === count - 1 ? pulse * 0.01 : 0) : 0.012), { glow: on && i === count - 1 && pulse > 0 ? R * 0.04 : 0, cap: 'butt' });
    }
    // planets left to fling (bottom)
    const left = lv.planets, sp = 0.062;
    for (let i = 0; i < left; i++) {
      const [x, y] = polar(g.cx, g.cy, Math.PI + (i - (left - 1) / 2) * sp, R * 0.875);
      if (i >= launched) planet(g, x, y, R * 0.014, PLANETS[(i + li) % PLANETS.length]);
      else g.draw.circle(x, y, R * 0.011, null, { stroke: THEME.ink(0.22), lw: Math.max(1, R * 0.004) });
    }
    // level name, hint
    if (levelT < 3 && phase === 'play') {
      const a = clamp(Math.min(levelT * 3, (3 - levelT) * 1.5), 0, 1);
      g.draw.text(lv.name, g.cx, g.cy - R * 0.44, R * 0.08, { alpha: a });
    }
    if (hintOn && phase === 'play') {
      const a = clamp(levelT * 2, 0, 1) * (0.75 + 0.25 * Math.sin(t * 3));
      g.draw.text(li === 0 && launched === 0 ? 'Touch, drag sideways, let go' : lv.hint || '', g.cx, g.cy + R * 0.66, R * 0.048, { color: THEME.ink(0.7), alpha: a, weight: 600, font: THEME.font });
    }
    if (phase === 'clear' && clearInfo) {
      const a = clamp(phaseT * 3, 0, 1), y0 = g.cy + R * 0.5;
      g.draw.roundRect(g.cx - R * 0.36, y0 - R * 0.15, R * 0.72, R * 0.3, R * 0.08, THEME.paper(0.5 * a), { stroke: THEME.ink(0.12 * a), lw: 1 });
      g.draw.text(li + 1 >= LEVELS.length ? 'Sky complete!' : `Level ${li + 1} clear!`, g.cx, y0 - R * 0.07, R * 0.065, { alpha: a });
      g.draw.text(`+${lv.target} orbits  +${clearInfo.bonus} bonus`, g.cx, y0 + R * 0.005, R * 0.042, { color: THEME.ink(0.75), alpha: a, weight: 600, font: THEME.font });
      if (li + 1 < LEVELS.length) g.draw.text('Tap for the next level', g.cx, y0 + R * 0.075, R * 0.04, { color: g.color, alpha: a * (0.7 + 0.3 * Math.sin(t * 4)), weight: 600, font: THEME.font });
      if (phaseT > 12) nextLevel();
    }
    g.draw.particles(dt);
    g.draw.floaters(dt);
  });

  return {
    pause() { aim = null; },
    destroy() { offResize(); art = null; actx = null; },
  };
}

/** A black hole (dark disc, thin bright accretion ring, a slow swirl) or a white hole (bright disc, ripples). */
function drawHole(g, x, y, r, m, t, P) {
  const { ctx, R } = g;
  if (m > 0) {
    // swirl: two faint arcs turning round the hole
    ctx.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      const rr = r * (1.45 + k * 0.35), a = t * (1.6 - k * 0.5) + k * 2;
      ctx.beginPath(); ctx.arc(x, y, rr, a, a + 1.1);
      ctx.strokeStyle = g.draw.alpha(P.rim, (THEME.light ? 0.4 : 0.3) - k * 0.12); ctx.lineWidth = R * 0.004; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, rr, a + Math.PI, a + Math.PI + 0.7); ctx.stroke();
    }
    g.draw.ball(x, y, r, P.hole);
    ctx.save();
    if (THEME.glow) { ctx.shadowColor = P.rim; ctx.shadowBlur = R * 0.03; }
    ctx.beginPath(); ctx.arc(x, y, r * 1.06, 0, TAU); ctx.strokeStyle = P.rim; ctx.lineWidth = R * 0.006; ctx.stroke();
    ctx.restore();
  } else {
    // ripples pushing outwards
    for (let k = 0; k < 2; k++) {
      const f = ((t * 0.6 + k * 0.5) % 1), rr = r * (1.15 + f * 1.4);
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU);
      ctx.strokeStyle = g.draw.alpha(P.wrim, (1 - f) * 0.5); ctx.lineWidth = R * 0.004; ctx.stroke();
    }
    g.draw.ball(x, y, r, P.white);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = P.wrim; ctx.lineWidth = R * 0.006; ctx.stroke();
  }
}

// =================================================================================== Targets
function targets(g) {
  const DT = 1 / 120, PR = 0.024, GW = 0.022;
  let lives = 3, jumps = 0, starsGot = 0, perfects = 0, score = 0;
  let cur, nxt, prevAng = null, colI = 0, winC = 0;
  const cam = { x: 0, y: 0 }, camTo = { x: 0, y: 0 };
  const pl = { st: 'orbit', th: 0, dir: 1, x: 0, y: 0, vx: 0, vy: 0, t: 0, fade: 1 };
  let decay = 0, decayMax = 6, settle = 0, deadT = 0, acc = 0, time = 0;
  let stars = [];
  const TRN = 50, tr = new Float32Array(TRN * 2); let tn = 0, th = 0;

  const bodyPos = (b, t = time) => {
    if (!b.drift) return [b.x, b.y];
    const s = Math.sin((TAU * t) / b.drift.T + b.drift.ph) * b.drift.a;
    return [b.x + b.drift.ux * s, b.y + b.drift.uy * s];
  };
  const mass = (b) => (b.sr / 0.08) ** 2;
  const speedOf = (b) => clamp((TAU / b.T) * b.rr * 1.25, 0.65, 1.45);

  function makeBody(x, y, k) {
    const rr = clamp(0.24 - 0.0025 * k, 0.15, 0.24) * rand(0.92, 1.08);
    return { x, y, rr, sr: rr * rand(0.3, 0.36), T: clamp(2.6 - 0.03 * k, 1.5, 2.6) * rand(0.92, 1.08), col: SUNS[colI++ % SUNS.length], drift: null };
  }
  /** Fly from release angle `a` on `from` (orbit direction `dir`) towards `to`: 'catch' | 'crash' | 'miss', plus the path. */
  function sim(from, to, a, dir, path, t0 = null) {
    const [fx, fy] = bodyPos(from); let tx = to.x, ty = to.y;
    let x = fx + Math.cos(a) * from.rr, y = fy + Math.sin(a) * from.rr;
    const sp = speedOf(from);
    let vx = -Math.sin(a) * dir * sp, vy = Math.cos(a) * dir * sp;
    if (path) path.length = 0;
    for (let s = 0; s < 480; s++) {
      if (t0 != null) [tx, ty] = bodyPos(to, t0 + s * DT);
      [vx, vy] = grav(x, y, vx, vy, [[fx, fy, from], [tx, ty, to]]);
      x += vx * DT; y += vy * DT;
      if (path && s % 3 === 0) path.push(x, y);
      const rx = x - tx, ry = y - ty, d = Math.hypot(rx, ry);
      if (d <= to.rr) { const b = Math.abs(rx * vy - ry * vx) / Math.hypot(vx, vy); return { res: b < to.sr + PR * 0.6 ? 'crash' : 'catch', b }; }
      if (Math.hypot(x - (fx + tx) / 2, y - (fy + ty) / 2) > 1.3) break;
    }
    return { res: 'miss', b: 0 };
  }
  function grav(x, y, vx, vy, list) {
    for (const [bx, by, b] of list) {
      const dx = bx - x, dy = by - y, d2 = dx * dx + dy * dy + 0.01, k = (GW * mass(b)) / (d2 * Math.sqrt(d2));
      vx += dx * k * DT; vy += dy * k * DT;
    }
    return [vx, vy];
  }
  /** The next body: further on, smaller and faster as you go; never too tight a window to release in. */
  function genNext() {
    const k = jumps;
    const [cx0, cy0] = bodyPos(cur);
    const need = Math.max(0.1, 0.22 - k * 0.004);       // seconds of release window, at least
    for (let tries = 0; tries < 40; tries++) {
      const b = makeBody(0, 0, k);
      const gap = (rand(0.08, 0.16) + Math.min(0.1, k * 0.003)) * (tries > 20 ? 0.5 : 1);
      let ang = rand(TAU);
      if (prevAng != null) for (let i = 0; i < 20 && Math.abs(angDiff(ang, prevAng)) < 1.5; i++) ang = rand(TAU);
      // fit on the round screen (and below the score strip when the pair stands upright)
      const D = Math.min(cur.rr + b.rr + gap, 2 * (0.84 - Math.max(b.rr, cur.rr)), (1.3 - cur.rr - b.rr) / Math.max(0.01, Math.abs(Math.sin(ang))));
      b.x = cx0 + Math.cos(ang) * D; b.y = cy0 + Math.sin(ang) * D;
      // which release angles get caught?
      const ok = [];
      for (let i = 0; i < 240; i++) { const a = (i / 240) * TAU; const r = sim(cur, b, a, pl.dir); if (r.res === 'catch') ok.push(a); }
      const win = (ok.length / 240) * cur.T;
      if (win < need || !ok.length) { colI--; continue; }
      if (k >= 8 && Math.random() < Math.min(0.5, (k - 6) * 0.04)) {
        const pa = ang + Math.PI / 2;
        b.drift = { ux: Math.cos(pa), uy: Math.sin(pa), a: rand(0.03, 0.055), T: rand(4, 6), ph: rand(TAU) };
      }
      nxt = b; prevAng = Math.atan2(cy0 - b.y, cx0 - b.x);
      winC = Math.atan2(ok.reduce((s, a) => s + Math.sin(a), 0), ok.reduce((s, a) => s + Math.cos(a), 0));
      // stars along one real path through the window
      const path = [];
      sim(cur, { ...b, drift: null }, ok[Math.floor(rand(ok.length))], pl.dir, path);
      const pts = [];
      for (let i = 0; i < path.length; i += 2) {
        const x = path[i], y = path[i + 1];
        if (Math.hypot(x - cx0, y - cy0) > cur.rr + 0.04 && Math.hypot(x - b.x, y - b.y) > b.rr + 0.03) pts.push([x, y]);
      }
      const ns = pts.length < 3 ? 0 : k < 2 || pts.length < 8 ? 1 : 1 + Math.floor(rand(Math.min(3, pts.length / 5)));
      stars = [];
      for (let i = 0; i < ns; i++) { const p = pts[Math.floor(((i + 1) / (ns + 1)) * pts.length)]; stars.push({ x: p[0], y: p[1], got: 0, rot: rand(TAU) }); }
      return;
    }
    // fall-back: a close, big, easy ring (practically never needed)
    const b = makeBody(cx0 + 0.6, cy0, 0); nxt = b; stars = []; winC = 0;
  }
  function aimCamera() {
    const [ax, ay] = bodyPos(cur), [bx, by] = bodyPos(nxt);
    camTo.x = (ax + bx) / 2;
    // keep the score strip clear: the higher ring may reach at most 0.5 R above the centre
    const top = Math.min(ay - cur.rr, by - nxt.rr);
    camTo.y = Math.max((ay + by) / 2 + 0.03, top + 0.5);
  }
  function placeOnOrbit(b, a) {
    const [bx, by] = bodyPos(b);
    pl.th = a; pl.x = bx + Math.cos(a) * b.rr; pl.y = by + Math.sin(a) * b.rr;
  }

  // ---- start ----
  cur = makeBody(0, 0, 0); cur.rr = 0.24; cur.sr = 0.085; cur.T = 2.6;
  pl.dir = 1;
  genNext();
  // start on the side away from the next ring, so there's a moment to get ready
  placeOnOrbit(cur, winC - pl.dir * TAU * 0.7);
  aimCamera(); cam.x = camTo.x; cam.y = camTo.y;
  decayMax = 7; decay = decayMax;
  g.sub('♥♥♥');
  g.toast('Tap to let go', 1600);
  const updSub = () => g.sub(`${'♥'.repeat(lives)}${'♡'.repeat(3 - lives)}  ·  ${jumps} jump${jumps === 1 ? '' : 's'}`);
  updSub();

  function release() {
    if (pl.st !== 'orbit' || pl.fade < 1) return;
    const sp = speedOf(cur);
    pl.vx = -Math.sin(pl.th) * pl.dir * sp; pl.vy = Math.cos(pl.th) * pl.dir * sp;
    pl.st = 'fly'; pl.t = 0;
    g.sfx('whoosh', { pitch: 1.4, volume: 0.6 });
  }
  g.on('down', release);
  g.on('key', ({ key }) => { if (key === ' ' || key === 'Enter' || key === 'ArrowUp') release(); });

  function capture(b) {
    const [bx, by] = bodyPos(nxt);
    const rx = pl.x - bx, ry = pl.y - by;
    pl.dir = Math.sign(rx * pl.vy - ry * pl.vx) || 1;
    pl.th = Math.atan2(ry, rx); pl.st = 'orbit';
    jumps++;
    const perfect = b / nxt.rr > 0.8;
    let pts = 10; if (perfect) { pts += 5; perfects++; }
    score += pts; g.score(score);
    g.draw.float(perfect ? `Perfect +${pts}` : `+${pts}`, g.cx + (pl.x - cam.x) * g.R, g.cy + (pl.y - cam.y) * g.R - g.R * 0.05, perfect ? g.color : THEME.fg, g.R * 0.055);
    g.sfx(perfect ? 'perfect' : 'score'); g.vibrate(15);
    cur = nxt; genNext(); aimCamera();
    decayMax = Math.max(3.6, cur.T * 2.4); decay = decayMax; settle = 0.6;
    updSub();
  }
  function lose(why) {
    lives--; pl.st = 'dead'; deadT = 0; updSub();
    g.vibrate(40);
    if (lives <= 0) {
      g.over(score, { title: why, note: `${jumps} jump${jumps === 1 ? '' : 's'} · ${starsGot} star${starsGot === 1 ? '' : 's'} · ${perfects} perfect`, delay: 1300 });
    } else g.toast(why, 1000);
  }
  function respawn() {
    placeOnOrbit(cur, winC - pl.dir * TAU * 0.6);
    pl.st = 'orbit'; pl.fade = 0; tn = 0;
    decayMax = Math.max(4.5, cur.T * 2.6); decay = decayMax; settle = 0.4;
  }

  function step() {
    time += DT;
    if (pl.st === 'orbit' || pl.st === 'fall') {
      const [bx, by] = bodyPos(cur);
      pl.th += (pl.dir * TAU * DT) / cur.T * (pl.st === 'fall' ? 1.6 : 1);
      let r = cur.rr;
      if (pl.st === 'fall') { pl.t += DT; r = cur.rr + (cur.sr - cur.rr) * clamp(pl.t / 0.8, 0, 1) ** 2; if (pl.t >= 0.8) { burstAt(pl.x, pl.y, cur.col); g.sfx('boom'); lose('Fell in'); return; } }
      pl.x = bx + Math.cos(pl.th) * r; pl.y = by + Math.sin(pl.th) * r;
    } else if (pl.st === 'fly' || pl.st === 'doom') {
      pl.t += DT;
      const [cx0, cy0] = bodyPos(cur), [nx, ny] = bodyPos(nxt);
      [pl.vx, pl.vy] = grav(pl.x, pl.y, pl.vx, pl.vy, [[cx0, cy0, cur], [nx, ny, nxt]]);
      pl.x += pl.vx * DT; pl.y += pl.vy * DT;
      for (const s of stars) {
        if (!s.got && Math.hypot(s.x - pl.x, s.y - pl.y) < 0.05) {
          s.got = 1; starsGot++; score += 5; g.score(score); g.sfx('coin');
          g.draw.float('+5', g.cx + (s.x - cam.x) * g.R, g.cy + (s.y - cam.y) * g.R - g.R * 0.04, pal().star, g.R * 0.05);
          burstAt(s.x, s.y, pal().star, 8);
        }
      }
      const rx = pl.x - nx, ry = pl.y - ny, d = Math.hypot(rx, ry);
      if (pl.st === 'fly' && d <= nxt.rr) {
        const b = Math.abs(rx * pl.vy - ry * pl.vx) / Math.hypot(pl.vx, pl.vy);
        if (b < nxt.sr + PR * 0.6) pl.st = 'doom'; else { capture(b); return; }
      }
      if (pl.st === 'doom' && d <= nxt.sr + PR * 0.5) { burstAt(pl.x, pl.y, nxt.col, 26); g.sfx('boom'); lose('Crashed'); return; }
      if (Math.hypot(pl.x - cam.x, pl.y - cam.y) > 1.12 || pl.t > 5) { g.sfx('drop'); lose('Missed'); }
    }
  }
  const burstAt = (x, y, col, n = 22) => g.draw.burst(g.cx + (x - cam.x) * g.R, g.cy + (y - cam.y) * g.R, col, n, g.R * 0.6, g.R * 0.012);

  g.loop((dt, t) => {
    const { ctx, R } = g;
    const P = pal();
    // ---- update ----
    acc = Math.min(acc + dt, DT * 10);
    while (acc >= DT) { if (pl.st === 'dead') { acc = 0; break; } step(); acc -= DT; }
    if (pl.st === 'dead') { time += dt; deadT += dt; if (deadT > 0.9 && lives > 0) respawn(); }
    pl.fade = Math.min(1, pl.fade + dt * 2.5);
    if (pl.st === 'orbit') {
      if (settle > 0) settle -= dt;
      else if ((decay -= dt) <= 0) { pl.st = 'fall'; pl.t = 0; g.sfx('drop'); }
    }
    if (nxt.drift && pl.st !== 'fly') aimCamera();
    const k = 1 - Math.exp(-dt * 4);
    cam.x += (camTo.x - cam.x) * k; cam.y += (camTo.y - cam.y) * k;
    if (pl.st !== 'dead') { tr[th * 2] = pl.x; tr[th * 2 + 1] = pl.y; th = (th + 1) % TRN; tn = Math.min(TRN, tn + 1); }
    else tn = Math.max(0, tn - 2);

    // ---- draw ----
    const X = (x) => g.cx + (x - cam.x) * R, Y = (y) => g.cy + (y - cam.y) * R;
    g.draw.bg({ glow: 0.1 });
    drawSky(g, cam.x, cam.y);
    const [cx0, cy0] = bodyPos(cur), [nx, ny] = bodyPos(nxt);
    // the next ring: dashed, turning slowly
    ctx.save();
    ctx.setLineDash([R * 0.022, R * 0.018]); ctx.lineDashOffset = -t * R * 0.05;
    ctx.beginPath(); ctx.arc(X(nx), Y(ny), nxt.rr * R, 0, TAU);
    ctx.strokeStyle = g.draw.alpha(g.color, pl.st === 'fly' ? 0.95 : 0.7); ctx.lineWidth = R * 0.007; ctx.stroke();
    ctx.restore();
    // the current ring + what's left of the orbit (decay)
    ctx.beginPath(); ctx.arc(X(cx0), Y(cy0), cur.rr * R, 0, TAU); ctx.strokeStyle = THEME.ink(0.13); ctx.lineWidth = R * 0.005; ctx.stroke();
    if (pl.st === 'orbit' || pl.st === 'fall') {
      const f = pl.st === 'fall' ? 0 : clamp(decay / decayMax, 0, 1);
      const col = f < 0.3 ? THEME.danger : THEME.ink(0.45);
      ctx.beginPath();
      const a0 = pl.th, a1 = pl.th + pl.dir * f * TAU;
      ctx.arc(X(cx0), Y(cy0), (cur.rr + 0.035) * R, Math.min(a0, a1), Math.max(a0, a1));
      ctx.strokeStyle = col; ctx.lineWidth = R * 0.006; ctx.lineCap = 'round'; ctx.stroke();
    }
    // suns: flat discs with a flat inner tone
    for (const [b, x, y] of [[cur, cx0, cy0], [nxt, nx, ny]]) {
      g.draw.ball(X(x), Y(y), b.sr * R, b.col);
      g.draw.ball(X(x), Y(y), b.sr * R * 0.62, g.draw.shade(b.col, THEME.light ? -0.15 : 0.25));
    }
    // stars to collect
    for (const s of stars) if (!s.got) star5(g, X(s.x), Y(s.y), R * 0.032, s.rot + t * 0.8, P.star);
    // trail + planet
    drawTrail(g, tr, tn, th, TRN, g.color, X, Y, R * 0.014);
    if (pl.st !== 'dead') {
      ctx.save(); ctx.globalAlpha = pl.fade;
      planet(g, X(pl.x), Y(pl.y), PR * R, THEME.light ? '#4f46e5' : '#c7d2fe');
      ctx.restore();
      // a short stub of the tangent — where "now" would send it
      if (pl.st === 'orbit' && pl.fade >= 1) {
        const tx = -Math.sin(pl.th) * pl.dir, ty = Math.cos(pl.th) * pl.dir;
        for (let i = 1; i <= 4; i++) g.draw.ball(X(pl.x + tx * (0.02 + i * 0.03)), Y(pl.y + ty * (0.02 + i * 0.03)), R * 0.0068, THEME.ink(0.55 - i * 0.1));
      }
    }
    g.draw.particles(dt);
    g.draw.floaters(dt);
  });
  return {};
}
