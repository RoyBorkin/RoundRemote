// Block Destroyer — Breakout for the round screen. Your paddle is an arc on the rim that follows your
// finger; bounce the ball into the rings of blocks in the middle and clear every breakable one. Strong
// blocks take several hits, metal never breaks, explosive ones take their neighbours with them, and in
// later levels whole rings turn. Broken blocks drop power-ups that drift out to the rim — catch them with
// the paddle (the dark red ones are bad). 12 levels, then they loop with a faster ball.
//
// Everything is in polar form and in units of R: a block is a ring segment (inner/outer radius, centre
// angle ± half span) on a "ring" that may turn. The ball collides with a block through the closest point
// of that segment (an arc face or a radial face), so it reflects correctly off either.
import { TAU, rand, clamp, lerp, angDiff, THEME } from './kit.js';

const PR = 0.885, TH = 0.036, BR = 0.022;            // paddle radius, paddle thickness, ball radius (× R)
const CR = PR - TH / 2 - BR;                         // where the ball touches the paddle
const SHIELD_R = 0.935, OUT_R = 1.04, CAP_R = 0.034;
const GAP = 0.0065;                                  // half the gap between neighbouring blocks (× R)
const BAND0 = 0.12, BAND_STEP = 0.07, BAND_W = 0.058; // band b spans BAND0 + b·STEP … + W  (b = 0…5)
const NSEG = [8, 12, 16, 20, 24, 28];                // cells per band (keeps the blocks about the same length)
const MAX_BLOCK_R = BAND0 + 5 * BAND_STEP + BAND_W;  // ≈ 0.53 — clear of the score at the top
const PAL = ['#c084fc', '#ff8ad8', '#ffc857', '#3ddc84', '#2ee6d6', '#4d9bff', '#b57bff', '#f0abfc'];
const METAL = '#79808f', METAL_HI = '#b4bac6', BOOM = THEME.danger;
const BALL = '#f4efff', FIRE = '#ff9f43';

// power-ups: colour, name, duration (s) and how often they drop (weight)
const PU = {
  wide: { col: '#4d9bff', name: 'Wide paddle', time: 18, w: 14 },
  multi: { col: '#2ee6d6', name: 'Multi-ball', w: 13 },
  fire: { col: FIRE, name: 'Fireball', time: 8, w: 8 },
  laser: { col: '#ff5a6a', name: 'Laser — tap to fire', time: 10, w: 10 },
  sticky: { col: '#ffc857', name: 'Sticky paddle', time: 15, w: 9 },
  slow: { col: '#b57bff', name: 'Slow ball', time: 12, w: 10 },
  life: { col: '#ff8ad8', name: '+1 life', w: 4 },
  shield: { col: '#3ddc84', name: 'Shield', w: 8 },
  shrink: { col: THEME.danger, name: 'Shrink!', time: 12, w: 9, bad: true },
  fast: { col: THEME.danger, name: 'Fast ball!', time: 10, w: 9, bad: true },
};
const PU_KEYS = Object.keys(PU);
const PU_TOTAL = PU_KEYS.reduce((s, k) => s + PU[k].w, 0);
const EFFECTS = ['wide', 'shrink', 'fire', 'laser', 'sticky', 'slow', 'fast'];   // the timed ones
const BAD_FILL = '#2a141a';

// ---------------------------------------------------------------- levels
// Each build(L) gets:
//   L.band(b, fn, { n, ring, off })  walk the n cells of band b (0 = innermost … 5). fn(i, θ) returns null
//                                    (empty) or [type, colour, hp]: 'n' normal, 's' strong, 'm' metal, 'x' explosive
//   L.spin(w, { amp, ph }) → ring    a ring turning at w rad/s (or swinging ±amp at w)
const near = (arms, twist, b, th, width, phase = 0) => {
  for (let k = 0; k < arms; k++) if (Math.abs(angDiff(phase + (k * TAU) / arms + b * twist, th)) < width) return k;
  return -1;
};
const LEVELS = [
  { name: 'Halo', build(L) {
    L.band(2, (i) => (i % 2 ? null : ['n', PAL[4]])); L.band(3, () => ['n', PAL[5]]); L.band(4, () => ['n', PAL[0]]);
  } },
  { name: 'Quarters', build(L) {
    for (let b = 1; b <= 5; b++) L.band(b, (i, th) => {
      const q = Math.round(th / (Math.PI / 2)) % 4;
      if (Math.abs(angDiff((q * Math.PI) / 2, th)) > 0.62) return null;
      return [b === 5 ? 's' : 'n', PAL[[1, 2, 3, 5][q]], 2];
    });
  } },
  { name: 'Checkers', build(L) {
    // 8 sectors × 6 bands, every other tile filled (each band split into a multiple of 8 cells)
    const ns = [8, 16, 16, 24, 24, 32];
    for (let b = 0; b <= 5; b++) L.band(b, (i) => ((b + Math.floor((i * 8) / ns[b])) % 2 ? null : [b === 0 ? 's' : 'n', PAL[[2, 1, 0, 6, 5, 4][b]], 2]), { n: ns[b] });
  } },
  { name: 'Spiral', build(L) {
    L.band(0, (i) => (i % 2 ? ['s', PAL[2], 2] : ['m']));
    for (let b = 1; b <= 5; b++) L.band(b, (i, th) => (near(3, 0.42, b, th, 0.5) < 0 ? null : ['n', PAL[[6, 0, 1, 7, 4][b - 1]]]));
  } },
  { name: 'Fortress', build(L) {
    L.band(0, () => ['s', PAL[2], 2]); L.band(1, () => ['s', PAL[2], 2]);
    L.band(2, (i) => (i % 4 === 0 ? null : ['m']));
    L.band(4, (i) => ['n', PAL[i % 2 ? 5 : 4]]);
    L.band(5, (i) => (i % 2 ? null : ['n', PAL[0]]));
  } },
  { name: 'Rotor', build(L) {
    const r = L.spin(0.32);
    L.band(1, () => ['s', PAL[6], 2]);
    L.band(3, (i) => (i % 5 === 0 ? ['x'] : ['n', PAL[3]]));
    L.band(5, (i) => (i % 4 === 3 ? null : ['n', PAL[1]]), { ring: r });
  } },
  { name: 'Bullseye', build(L) {
    const r = L.spin(0.9, { amp: 0.7 });
    L.band(0, (i) => (i % 2 ? ['s', PAL[2], 2] : ['x']));
    L.band(1, () => ['n', PAL[0]]);
    L.band(2, (i) => (i % 4 === 0 ? null : ['m']), { ring: r });
    L.band(3, () => ['n', PAL[4]]);
    L.band(4, (i) => (i % 6 === 0 ? ['x'] : ['n', PAL[5]]));
    L.band(5, (i) => (i % 2 ? null : ['s', PAL[1], 2]));
  } },
  { name: 'Bloom', build(L) {
    L.band(0, () => ['s', PAL[2], 2]);
    for (let b = 1; b <= 5; b++) L.band(b, (i, th) => {
      const reach = 1 + 4.6 * Math.abs(Math.cos(3 * th));
      if (b > reach) return null;
      const petal = Math.round(th / (TAU / 6)) % 6;
      return [b + 1 > reach ? 's' : 'n', PAL[[1, 0, 7, 1, 0, 7][petal]], 2];
    });
  } },
  { name: 'Gears', build(L) {
    const a = L.spin(0.45), c = L.spin(-0.3);
    L.band(1, (i) => (i % 2 ? null : ['n', PAL[4]]), { ring: a });
    L.band(2, () => ['n', PAL[5]], { ring: a });
    L.band(3, (i) => (i % 2 ? null : ['s', PAL[2], 2]));
    L.band(4, (i) => (i % 3 === 0 ? ['m'] : ['n', PAL[0]]), { ring: c });
    L.band(5, (i) => (i % 2 ? ['n', PAL[1]] : null), { ring: c });
  } },
  { name: 'Vortex', build(L) {
    for (let b = 0; b <= 5; b++) {
      const r = L.spin(0.1 + b * 0.05);
      L.band(b, (i, th) => {
        const k = near(4, 0.35, b, th, 0.42);
        if (k < 0) return null;
        return b === 5 ? ['s', PAL[6], 2] : b === 2 && k % 2 === 0 ? ['x'] : ['n', PAL[[7, 0, 1, 5, 4][b]]];
      }, { ring: r });
    }
  } },
  { name: 'Vault', build(L) {
    const r = L.spin(0.26);
    L.band(0, (i) => (i % 2 ? ['s', PAL[2], 3] : ['x']));
    L.band(1, () => ['s', PAL[0], 2]);
    L.band(2, (i) => (i % 2 ? ['s', PAL[6], 2] : ['n', PAL[1]]));
    L.band(3, () => ['n', PAL[4]]);
    L.band(5, (i) => (i % 9 < 2 ? null : ['m']), { ring: r, n: 27 });
  } },
  { name: 'Galaxy', build(L) {
    const r = L.spin(0.16);
    for (const b of [0, 1, 2, 4, 5]) L.band(b, (i, th) => {
      if (near(2, 0.6, b, th, 0.55) < 0) return null;
      return b === 2 ? ['x'] : b >= 4 ? ['s', PAL[b === 5 ? 6 : 7], b === 5 ? 3 : 2] : ['n', PAL[0]];
    }, { ring: r });
    L.band(3, (i) => (i % 4 === 0 ? ['m'] : i % 4 === 2 ? ['n', PAL[4]] : null));
  } },
];

export default {
  howTo: 'Slide anywhere to swing the paddle round the rim; release (or tap / space) to launch. Break every block and catch the power-ups drifting out — dodge the dark red ones. (← → or wheel too.)',
  scoring: 'high',
  create(g) {
    const Q = Math.PI / 2;
    let levelIdx = 0, loop = 0, lives = 3, phase = 'play', phaseT = 0;   // play | lost | clear | over
    let blocks = [], rings = [], breakable = 0, introT = 0;
    const balls = [], caps = [], beams = [], waves = [], pending = [], ripples = [];
    let chain = 0, hitsLevel = 0, lastSnd = 0, serveT = 0, laserCD = 0, holdFire = 0, bump = 0, shield = 0, shieldFx = 0, drops = 0;
    const eff = { wide: 0, shrink: 0, fire: 0, laser: 0, sticky: 0, slow: 0, fast: 0 };
    const paddle = { a: Math.PI, target: Math.PI, hw: 0.3, v: 0, flash: 0 };
    let touching = false, keyDir = 0;

    const levelNo = () => levelIdx + 1 + loop * LEVELS.length;
    const sub = () => g.sub(`Level ${levelNo()}  ·  ${'♥'.repeat(Math.max(0, lives))}`);
    const px = (a, r) => [g.cx + Math.sin(a) * r * g.R, g.cy - Math.cos(a) * r * g.R];
    const ringRot = (k) => rings[k.ring].rot;
    const blockXY = (k) => { const a = k.a + ringRot(k); return [Math.sin(a) * k.rm, -Math.cos(a) * k.rm]; };
    const snd = (name, o) => { if (g.time - lastSnd < 0.035) return; lastSnd = g.time; g.sfx(name, o); };

    // ---------------------------------------------------------------- level building
    function buildLevel() {
      blocks = []; rings = [{ rot: 0, w: 0, amp: 0, ph: 0 }];
      const spd = 1 + 0.25 * loop;
      const L = {
        spin(w, { amp = 0, ph = 0 } = {}) { rings.push({ rot: 0, w: w * spd, amp, ph }); return rings.length - 1; },
        band(b, fn, { n = NSEG[b], ring = 0, off = 0 } = {}) {
          const r0 = BAND0 + b * BAND_STEP, r1 = r0 + BAND_W, rm = (r0 + r1) / 2, half = Math.PI / n;
          for (let i = 0; i < n; i++) {
            const a = (i + 0.5) * 2 * half + off;
            const spec = fn(i, ((a % TAU) + TAU) % TAU);
            if (!spec) continue;
            let [type, col = PAL[0], hp = 1] = spec;
            if (type === 's') hp = Math.min(3, hp + (loop > 0 ? 1 : 0));
            else if (type === 'n' && loop > 0 && (b + i) % 4 === 0) { type = 's'; hp = 2; }
            if (type !== 's') hp = 1;
            if (type === 'm') col = METAL;
            if (type === 'x') col = BOOM;
            const k = { band: b, i, n, ring, a, half, h: half - GAP / rm, r0, r1, rm, type, hp, max: hp, col, flash: 0, dead: false, pend: false, cracks: null };
            k.fill = type === 's' ? g.draw.shade(col, -0.45) : col;
            if (type === 's') k.cracks = [0, 1].map((c) => {
              const v0 = c ? 0.05 : 0.95, v3 = rand(0.35, 0.65), u0 = rand(-0.8, 0.8), u3 = rand(-0.3, 0.3);
              return [[u0, v0], [lerp(u0, u3, 0.4) + rand(-0.25, 0.25), lerp(v0, v3, 0.4)], [lerp(u0, u3, 0.75) + rand(-0.2, 0.2), lerp(v0, v3, 0.75)], [u3, v3]];
            });
            k.appear = b * 0.07 + (i / n) * 0.18;
            blocks.push(k);
          }
        },
      };
      LEVELS[levelIdx].build(L);
      breakable = blocks.filter((k) => k.type !== 'm').length;
      introT = 0; hitsLevel = 0; chain = 0;
      for (const k in eff) eff[k] = 0;
      sub();
    }

    // ---------------------------------------------------------------- balls
    function newBall() {
      const b = { x: 0, y: 0, vx: 0, vy: 0, held: true, serve: true, holdOff: 0, holdT: 0, past: false, dead: false,
        last: null, lastT: 1, idle: 0, metalRun: 0, padRun: 0, hitT: 0, trail: [], ti: 0 };
      for (let i = 0; i < 10; i++) b.trail.push({ x: 0, y: 0 });
      placeHeld(b); for (const p of b.trail) { p.x = b.x; p.y = b.y; }
      balls.push(b);
      serveT = 0;
      return b;
    }
    function placeHeld(b) {
      b.holdOff = clamp(b.holdOff, -paddle.hw, paddle.hw);
      const a = paddle.a + b.holdOff, d = CR - 0.003;
      b.x = Math.sin(a) * d; b.y = -Math.cos(a) * d;
    }
    function targetSpeed() {
      let s = (0.66 + 0.017 * Math.min(levelIdx, 11)) * (1 + 0.12 * loop) * (1 + Math.min(0.22, hitsLevel * 0.006));
      if (eff.slow > 0) s *= 0.68;
      if (eff.fast > 0) s *= 1.35;
      return clamp(s, 0.4, 1.45);
    }
    function setDir(b, a, s = targetSpeed()) { b.vx = Math.sin(a) * s; b.vy = -Math.cos(a) * s; }
    function launch(b) {
      const rel = b.serve ? (Math.random() < 0.5 ? -1 : 1) * rand(0.14, 0.34) : -clamp(b.holdOff / paddle.hw, -1, 1) * 1.05;
      setDir(b, paddle.a + b.holdOff + Math.PI + rel);
      b.held = false; b.serve = false; b.past = false; b.idle = 0;
      g.sfx('whoosh', { volume: 0.6 });
    }
    /** Launch every ball waiting on the paddle; true if there was one. */
    function release() {
      if (phase !== 'play') return false;
      let any = false;
      for (const b of balls) if (b.held) { launch(b); any = true; }
      return any;
    }
    const rotate = (b, da) => { const c = Math.cos(da), s = Math.sin(da), vx = b.vx; b.vx = vx * c - b.vy * s; b.vy = vx * s + b.vy * c; };
    const nudge = (b) => { rotate(b, (Math.random() < 0.5 ? -1 : 1) * rand(0.18, 0.32)); b.metalRun = 0; b.idle = 0; };

    function paddleHit(b, ang, off) {
      const k = clamp(off / paddle.hw, -1, 1);
      b.x = Math.sin(ang) * CR; b.y = -Math.cos(ang) * CR;
      hitsLevel++; paddle.flash = 1; bump = 1; b.hitT = 1;
      b.metalRun = 0; b.idle = 0; b.padRun++;
      ripples.push({ a: ang, t: 0 });
      if (chain >= 3) comboBonus(ang);
      chain = 0;
      const [hx, hy] = px(ang, PR - TH);
      g.draw.burst(hx, hy, g.color, 6, g.R * 0.3, g.R * 0.007);
      g.vibrate(10);
      if (eff.sticky > 0) {   // caught: it rides the paddle until released
        b.held = true; b.holdOff = clamp(off, -paddle.hw, paddle.hw); b.holdT = 0;
        g.sfx('place');
        return;
      }
      let rel = -k * 1.05;                                          // where it hit sets the angle
      if (b.padRun >= 4) { rel += rand(-0.25, 0.25); b.padRun = 0; } // never the exact same loop forever
      setDir(b, ang + Math.PI + clamp(rel, -1.15, 1.15));
      g.sfx('bounce', { pitch: 0.9 + Math.min(0.5, hitsLevel * 0.01) });
    }
    function comboBonus(ang) {
      const n = chain, pts = Math.round(5 * n * (n - 1) * mult());
      g.add(pts);
      if (ang == null) g.draw.float(`Combo ×${n}  +${pts}`, g.cx, g.cy - g.R * 0.08, '#fff', g.R * 0.065);
      else label(`Combo ×${n}  +${pts}`, ang, 0.7, '#fff', g.R * (n >= 8 ? 0.075 : 0.06));
      if (n >= 6) g.sfx('perfect'); else g.sfx('score');
    }
    const mult = () => 1 + 0.5 * loop;
    /** A floating label near a rim angle, kept well inside the circle so wide text isn't cut off. */
    function label(text, ang, r, col, size) {
      const [x, y] = px(ang, r);
      g.draw.float(text, clamp(x, g.cx - g.R * 0.42, g.cx + g.R * 0.42), clamp(y, g.cy - g.R * 0.5, g.cy + g.R * 0.78), col, size);
    }

    // ---------------------------------------------------------------- blocks
    /** Push the ball out of the deepest block it overlaps and reflect it off that face. */
    function collideBlocks(b) {
      const d = Math.hypot(b.x, b.y);
      if (d - BR > MAX_BLOCK_R || d < 1e-6) return;
      const th = Math.atan2(b.x, -b.y);
      let best = null, bd = 0, bnx = 0, bny = 0;
      for (const k of blocks) {
        if (k.dead || d + BR < k.r0 || d - BR > k.r1) continue;
        const ac = k.a + rings[k.ring].rot, phi = angDiff(ac, th), aphi = Math.abs(phi);
        if (aphi > k.h + (BR * 1.7) / d) continue;
        let depth, nx, ny;
        if (aphi <= k.h) {
          if (d >= k.r0 && d <= k.r1) {          // centre inside (a turning ring swept over it): nearest face
            const pIn = d - k.r0, pOut = k.r1 - d, pSide = (k.h - aphi) * d;
            if (pSide < pIn && pSide < pOut) { const s = phi < 0 ? -1 : 1, e = ac + s * k.h; nx = Math.cos(e) * s; ny = Math.sin(e) * s; depth = pSide + BR; }
            else if (pOut <= pIn) { nx = b.x / d; ny = b.y / d; depth = pOut + BR; }
            else { nx = -b.x / d; ny = -b.y / d; depth = pIn + BR; }
          } else {                                // an arc face (tangential): radial normal
            const out = d > k.r1, dist = out ? d - k.r1 : k.r0 - d;
            if (dist >= BR) continue;
            const s = out ? 1 : -1; nx = (s * b.x) / d; ny = (s * b.y) / d; depth = BR - dist;
          }
        } else {                                  // a radial face or a corner: closest point on that edge
          const s = phi < 0 ? -1 : 1, e = ac + s * k.h, ux = Math.sin(e), uy = -Math.cos(e);
          const t = clamp(b.x * ux + b.y * uy, k.r0, k.r1), qx = b.x - ux * t, qy = b.y - uy * t, dist = Math.hypot(qx, qy);
          if (dist >= BR) continue;
          if (dist > 1e-7) { nx = qx / dist; ny = qy / dist; } else { nx = Math.cos(e) * s; ny = Math.sin(e) * s; }
          depth = BR - dist;
        }
        if (eff.fire > 0 && k.type !== 'm') { damage(k, 9, b); continue; }   // the fireball ploughs through
        if (depth > bd) { bd = depth; best = k; bnx = nx; bny = ny; }
      }
      if (!best) return;
      const vn = b.vx * bnx + b.vy * bny;
      if (vn < 0) { b.vx -= 2 * vn * bnx; b.vy -= 2 * vn * bny; }
      b.x += bnx * (bd + 1e-4); b.y += bny * (bd + 1e-4);
      if (best !== b.last || b.lastT > 0.08) {
        b.last = best; b.lastT = 0;
        if (best.type === 'm') {
          best.flash = 1; snd('tick', { pitch: 0.7 }); b.idle = 0;
          if (++b.metalRun > 7) nudge(b);
        } else damage(best, 1, b);
      }
      // a ball moving almost exactly along a ring (or straight back and forth) gets a gentle nudge
      const s = Math.hypot(b.vx, b.vy), radial = Math.abs(b.vx * b.x + b.vy * b.y) / (s * Math.hypot(b.x, b.y) || 1);
      if (radial < 0.06) rotate(b, (Math.random() < 0.5 ? -1 : 1) * 0.12);
    }

    function damage(k, n, b) {
      if (k.dead || k.type === 'm') return;
      k.flash = 1;
      if (b) { b.metalRun = 0; b.padRun = 0; b.idle = 0; }
      k.hp -= n;
      if (k.hp > 0) {
        g.add(Math.round(5 * mult()));
        snd('hit', { pitch: 1 + k.hp * 0.15 });
        const [x, y] = blockXY(k);
        g.draw.burst(g.cx + x * g.R, g.cy + y * g.R, k.col, 4, g.R * 0.2, g.R * 0.007);
        return;
      }
      destroy(k, b ? 1 : 0.6);
    }
    function destroy(k, dropOdds) {
      if (k.dead) return;
      k.dead = true; breakable--; chain++;
      const pts = { n: 10, s: 20 * k.max, x: 25 }[k.type] || 10;
      g.add(Math.round(pts * mult()));
      const [x, y] = blockXY(k), sx = g.cx + x * g.R, sy = g.cy + y * g.R;
      g.draw.burst(sx, sy, k.type === 's' ? k.col : k.fill, k.type === 'x' ? 16 : 9, g.R * (k.type === 'x' ? 0.55 : 0.35), g.R * 0.009);
      if (k.type === 'x') {
        waves.push({ x, y, t: 0 });
        g.sfx('boom', { volume: 0.7 }); g.vibrate(30);
        for (const o of blocks) {
          if (o.dead || o.pend || o.type === 'm' || o === k) continue;
          const [ox, oy] = blockXY(o);
          if (Math.hypot(ox - x, oy - y) < 0.17) { o.pend = true; pending.push({ k: o, t: 0.09 }); }
        }
      } else snd('pop', { pitch: 0.85 + Math.min(0.9, chain * 0.06) });
      if (Math.random() < 0.16 * dropOdds && caps.length < 3 && breakable > 0) dropCap(x, y);
      if (breakable <= 0 && phase === 'play') levelClear();
    }

    // ---------------------------------------------------------------- power-ups
    function dropCap(x, y, type) {
      if (!type) {
        let r = rand(PU_TOTAL);
        type = PU_KEYS.find((k) => (r -= PU[k].w) < 0) || 'wide';
        if (drops++ < 1 && PU[type].bad) type = 'wide';   // the first drop of a game is always a good one
      }
      const r = Math.max(0.12, Math.hypot(x, y));
      caps.push({ type, a: Math.hypot(x, y) < 0.05 ? rand(TAU) : Math.atan2(x, -y), r, t: 0, missed: false });
    }
    function power(type) {
      const p = PU[type];
      if (p.time) eff[type] = p.time;
      if (type === 'wide') eff.shrink = 0;
      if (type === 'shrink') eff.wide = 0;
      if (type === 'slow') eff.fast = 0;
      if (type === 'fast') eff.slow = 0;
      if (type === 'life') { lives = Math.min(5, lives + 1); sub(); }
      if (type === 'shield') { shield = 1; shieldFx = 1; }
      if (type === 'multi') {
        const src = balls.find((b) => !b.held) || balls[0];
        if (src) {
          if (src.held) launch(src);
          for (const s of [-1, 1]) {
            if (balls.length >= 9) break;
            const nb = newBall(); nb.held = false; nb.serve = false;
            nb.x = src.x; nb.y = src.y; nb.vx = src.vx; nb.vy = src.vy; rotate(nb, s * 0.42);
            for (const q of nb.trail) { q.x = src.x; q.y = src.y; }
          }
        }
      }
      label(p.name, paddle.a, 0.74, p.bad ? THEME.danger : '#fff', g.R * 0.055);
      g.add(Math.round(25 * mult()));
      if (p.bad) { g.sfx('drop'); g.vibrate(25); } else g.sfx(type === 'life' ? 'perfect' : 'coin');
    }
    function shoot() {
      if (eff.laser <= 0 || laserCD > 0 || phase !== 'play') return false;
      laserCD = 0.26;
      for (const s of [-1, 1]) beams.push({ a: paddle.a + s * paddle.hw * 0.78, r: PR - TH, dead: false });
      g.sfx('laser', { volume: 0.7 });
      return true;
    }
    function beamHit(bm) {
      for (const k of blocks) {
        if (k.dead || bm.r < k.r0 || bm.r > k.r1) continue;
        if (Math.abs(angDiff(k.a + rings[k.ring].rot, bm.a)) > k.h) continue;
        bm.dead = true;
        const [x, y] = px(bm.a, bm.r);
        if (k.type === 'm') { k.flash = 1; snd('tick'); g.draw.burst(x, y, METAL_HI, 4, g.R * 0.2, g.R * 0.006); }
        else damage(k, 1, null);
        return;
      }
    }

    // ---------------------------------------------------------------- lives & levels
    function loseLife() {
      lives--; chain = 0; sub();
      caps.length = 0; beams.length = 0;
      for (const k in eff) eff[k] = 0;
      g.sfx('drop'); g.vibrate(60);
      if (lives <= 0) {
        phase = 'over';
        g.over(g.scoreValue, { label: `Level ${levelNo()}`, note: `You reached level ${levelNo()}.`, delay: 1300 });
      } else { phase = 'lost'; phaseT = 1; g.toast(lives === 1 ? 'Last ball!' : 'Ball lost', 900); }
    }
    function levelClear() {
      phase = 'clear'; phaseT = 1.7;
      if (chain >= 3) comboBonus(null);
      chain = 0;
      const bonus = Math.round((200 + 50 * levelNo()) * mult());
      g.add(bonus);
      g.draw.float(`Clear!  +${bonus}`, g.cx, g.cy + g.R * 0.1, '#fff', g.R * 0.075);
      g.sfx('win');
      for (const b of balls) g.draw.burst(g.cx + b.x * g.R, g.cy + b.y * g.R, BALL, 10, g.R * 0.4, g.R * 0.008);
      balls.length = 0; caps.length = 0; beams.length = 0; pending.length = 0;
    }
    function nextLevel() {
      levelIdx++;
      if (levelIdx >= LEVELS.length) { levelIdx = 0; loop++; }
      buildLevel();
      g.toast(levelIdx === 0 ? `Level ${levelNo()} · faster!` : `Level ${levelNo()}`, 1400);
      newBall();
      phase = 'play';
    }

    // ---------------------------------------------------------------- input
    const follow = (p) => { if (p.r > 0.12) paddle.target = paddle.a + angDiff(paddle.a, p.a); };
    g.on('down', (p) => { touching = true; follow(p); holdFire = 0; if (!balls.some((b) => b.held)) shoot(); });
    g.on('move', (p) => { if (touching) follow(p); });
    g.on('up', () => { touching = false; release(); });
    g.on('key', (e) => {
      if (e.key === 'ArrowLeft') { keyDir = -1; paddle.target = paddle.a - 0.18; }
      else if (e.key === 'ArrowRight') { keyDir = 1; paddle.target = paddle.a + 0.18; }
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') { if (!release()) shoot(); }
    });
    g.on('keyup', (e) => { if ((e.key === 'ArrowLeft' && keyDir < 0) || (e.key === 'ArrowRight' && keyDir > 0)) keyDir = 0; });
    g.on('wheel', (e) => { paddle.target += e.delta * 0.16; });

    buildLevel();
    newBall();
    g.score(0);
    g.toast('Level 1', 1400);

    // ---------------------------------------------------------------- update
    function stepBall(b, h) {
      if (b.dead) return;
      if (b.held) { placeHeld(b); return; }
      b.x += b.vx * h; b.y += b.vy * h;
      b.lastT += h;
      collideBlocks(b);
      const d = Math.hypot(b.x, b.y), outward = b.vx * b.x + b.vy * b.y > 0;
      if (!b.past) {
        if (d >= CR && outward) {
          const ang = Math.atan2(b.x, -b.y), off = angDiff(paddle.a, ang);
          if (Math.abs(off) <= paddle.hw + BR / PR) paddleHit(b, ang, off);
          else b.past = true;
        }
      } else if (shield && d >= SHIELD_R - BR && outward) {   // the shield ring saves it once
        const nx = b.x / d, ny = b.y / d, vn = b.vx * nx + b.vy * ny;
        b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; rotate(b, rand(-0.2, 0.2));
        b.past = false; shield = 0; shieldFx = 1;
        ripples.push({ a: Math.atan2(b.x, -b.y), t: 0, col: THEME.ok, big: true });
        g.sfx('bounce', { pitch: 0.6 }); g.vibrate(20);
      } else if (d > OUT_R) b.dead = true;
    }

    function update(dt) {
      // paddle
      if (keyDir) paddle.target = paddle.a + keyDir * 0.5;
      const want = angDiff(paddle.a, paddle.target), maxV = keyDir ? 4.4 : 14;
      paddle.v = clamp(want * 24, -maxV, maxV);
      if (phase !== 'over') paddle.a += clamp(paddle.v * dt, -Math.abs(want), Math.abs(want));
      const hwT = (eff.wide > 0 ? 0.46 : eff.shrink > 0 ? 0.2 : 0.3) - Math.min(0.04, loop * 0.02);
      paddle.hw += (hwT - paddle.hw) * Math.min(1, dt * 6);
      paddle.flash = Math.max(0, paddle.flash - dt * 4);
      bump = Math.max(0, bump - dt * 3);
      shieldFx = Math.max(0, shieldFx - dt * 2);
      introT += dt;
      // rings
      for (const r of rings) r.rot = r.amp ? r.amp * Math.sin(g.time * r.w + r.ph) : r.rot + r.w * dt;
      for (const k of blocks) if (k.flash) k.flash = Math.max(0, k.flash - dt * 5);
      // timed effects
      for (const k of EFFECTS) {
        if (eff[k] <= 0) continue;
        eff[k] = Math.max(0, eff[k] - dt);
        if (k === 'sticky' && eff[k] === 0) for (const b of balls) if (b.held && !b.serve) launch(b);
      }
      laserCD = Math.max(0, laserCD - dt);
      if (touching && eff.laser > 0 && (holdFire += dt) > 0.45) { holdFire = 0; shoot(); }

      if (phase === 'lost' && (phaseT -= dt) <= 0) { phase = 'play'; newBall(); }
      if (phase === 'clear' && (phaseT -= dt) <= 0) nextLevel();
      if (phase !== 'play') return;

      // balls (sub-stepped so they never tunnel through a block)
      const s = targetSpeed();
      for (const b of balls) {
        if (b.held) {
          b.holdT += dt;
          if (b.serve) { if (!touching && (serveT += dt) > 6) launch(b); }   // a nudge for encoder-only setups
          else if (b.holdT > 3) launch(b);
          continue;
        }
        const cur = Math.hypot(b.vx, b.vy) || 1, ns = lerp(cur, s, Math.min(1, dt * 3)) / cur;   // ease to the target speed
        b.vx *= ns; b.vy *= ns;
        b.idle += dt;
        if (b.idle > 6) nudge(b);
        b.hitT = Math.max(0, b.hitT - dt * 4);
      }
      const steps = clamp(Math.ceil((s * 1.1 * dt) / (BR * 0.45)), 1, 40), h = dt / steps;
      for (let i = 0; i < steps; i++) for (const b of balls) stepBall(b, h);
      for (let i = balls.length - 1; i >= 0; i--) if (balls[i].dead) balls.splice(i, 1);
      if (phase === 'play' && !balls.length) loseLife();
      for (const b of balls) { b.ti = (b.ti + 1) % b.trail.length; b.trail[b.ti].x = b.x; b.trail[b.ti].y = b.y; }

      // explosions spreading
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i];
        if ((p.t -= dt) > 0) continue;
        pending.splice(i, 1);
        if (phase === 'play') destroy(p.k, 0.5);
      }
      // capsules drift out to the rim
      for (let i = caps.length - 1; i >= 0; i--) {
        const c = caps[i];
        c.t += dt; c.r += dt * (0.17 + Math.min(0.06, c.t * 0.03));
        if (!c.missed && c.r >= PR - TH / 2 - CAP_R) {
          if (Math.abs(angDiff(paddle.a, c.a)) <= paddle.hw + CAP_R / PR) { caps.splice(i, 1); power(c.type); continue; }
          if (c.r > PR + TH / 2) c.missed = true;
        }
        if (c.r > 1.06) caps.splice(i, 1);
      }
      // laser beams
      for (let i = beams.length - 1; i >= 0; i--) {
        const bm = beams[i];
        for (let j = 0; j < 4 && !bm.dead; j++) { bm.r -= dt * 0.5; beamHit(bm); }
        if (bm.dead || bm.r < 0.05) beams.splice(i, 1);
      }
    }

    // ---------------------------------------------------------------- drawing
    function sector(k, rot, scale) {
      const { ctx, cx, cy, R } = g, A = k.a + rot - Q;
      const r0 = k.r0 * scale, r1 = k.r1 * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, r1 * R, A - k.half + GAP / r1, A + k.half - GAP / r1);
      ctx.arc(cx, cy, r0 * R, A + k.half - GAP / r0, A - k.half + GAP / r0, true);
      ctx.closePath();
    }
    function drawBlocks(t) {
      const { ctx, cx, cy, R } = g;
      ctx.lineJoin = 'round';
      for (const k of blocks) {
        if (k.dead) continue;
        const p = clamp((introT - k.appear) / 0.35, 0, 1);
        if (p <= 0) continue;
        const e = 1 - (1 - p) ** 3, rot = rings[k.ring].rot, sc = 0.82 + 0.18 * e;
        ctx.globalAlpha = e;
        sector(k, rot, sc);
        ctx.fillStyle = k.fill; ctx.fill();
        ctx.lineWidth = R * 0.004; ctx.strokeStyle = k.fill; ctx.stroke();   // softens the corners a touch
        if (k.type === 'm' || k.type === 's') {        // a flat inner line: metal sheen / armour
          const A = k.a + rot - Q, ins = 0.013, r0 = (k.r0 + ins) * sc, r1 = (k.r1 - ins) * sc;
          ctx.beginPath();
          ctx.arc(cx, cy, r1 * R, A - k.half + (GAP + ins) / r1, A + k.half - (GAP + ins) / r1);
          ctx.arc(cx, cy, r0 * R, A + k.half - (GAP + ins) / r0, A - k.half + (GAP + ins) / r0, true);
          ctx.closePath();
          ctx.strokeStyle = k.type === 'm' ? METAL_HI : k.col; ctx.lineWidth = R * 0.0045; ctx.stroke();
        }
        if (k.type === 's' && k.hp < k.max) {          // cracks
          ctx.strokeStyle = 'rgba(5,5,6,.75)'; ctx.lineWidth = R * 0.005; ctx.lineCap = 'round';
          const A = k.a + rot;
          for (let c = 0; c < Math.min(2, k.max - k.hp); c++) {
            ctx.beginPath();
            for (const [u, v] of k.cracks[c]) {
              const a = A + u * k.h, r = lerp(k.r0, k.r1, v) * sc * R;
              ctx.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
            }
            ctx.stroke();
          }
        }
        if (k.type === 'x') {                          // explosive: a small fuse dot that blinks
          const A = k.a + rot, r = k.rm * sc * R, x = cx + Math.sin(A) * r, y = cy - Math.cos(A) * r;
          g.draw.ball(x, y, R * 0.015, 'rgba(5,5,6,.55)');
          g.draw.ball(x, y, R * (0.006 + 0.002 * Math.sin(t * 9 + k.i)), '#fff');
        }
        if (k.flash > 0) { sector(k, rot, sc); ctx.fillStyle = `rgba(255,255,255,${k.flash * 0.55})`; ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
    function glyph(type, x, y, s, col) {
      const c = g.ctx;
      c.save(); c.translate(x, y);
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = s * 0.17; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      switch (type) {
        case 'wide':
          c.moveTo(-0.55 * s, 0); c.lineTo(0.55 * s, 0);
          c.moveTo(-0.3 * s, -0.26 * s); c.lineTo(-0.55 * s, 0); c.lineTo(-0.3 * s, 0.26 * s);
          c.moveTo(0.3 * s, -0.26 * s); c.lineTo(0.55 * s, 0); c.lineTo(0.3 * s, 0.26 * s); c.stroke(); break;
        case 'shrink':
          for (const m of [-1, 1]) {
            c.moveTo(m * 0.62 * s, 0); c.lineTo(m * 0.12 * s, 0);
            c.moveTo(m * 0.36 * s, -0.26 * s); c.lineTo(m * 0.12 * s, 0); c.lineTo(m * 0.36 * s, 0.26 * s);
          }
          c.stroke(); break;
        case 'multi':
          for (const [u, v] of [[0, -0.27], [-0.29, 0.22], [0.29, 0.22]]) { c.moveTo(u * s + 0.17 * s, v * s); c.arc(u * s, v * s, 0.17 * s, 0, TAU); }
          c.fill(); break;
        case 'fire':
          c.moveTo(0, -0.62 * s);
          c.bezierCurveTo(0.5 * s, -0.12 * s, 0.5 * s, 0.55 * s, 0, 0.55 * s);
          c.bezierCurveTo(-0.5 * s, 0.55 * s, -0.5 * s, -0.12 * s, 0, -0.62 * s); c.fill(); break;
        case 'laser':
          c.moveTo(-0.22 * s, -0.5 * s); c.lineTo(-0.22 * s, 0.5 * s); c.moveTo(0.22 * s, -0.5 * s); c.lineTo(0.22 * s, 0.5 * s); c.stroke(); break;
        case 'sticky':
          c.moveTo(-0.34 * s, -0.48 * s); c.lineTo(-0.34 * s, 0.02 * s); c.arc(0, 0.02 * s, 0.34 * s, Math.PI, 0, true); c.lineTo(0.34 * s, -0.48 * s); c.stroke(); break;
        case 'slow':
          c.arc(0, 0, 0.5 * s, 0, TAU); c.moveTo(0, 0); c.lineTo(0, -0.3 * s); c.moveTo(0, 0); c.lineTo(0.22 * s, 0.08 * s); c.stroke(); break;
        case 'life':
          c.moveTo(0, 0.48 * s);
          c.bezierCurveTo(-0.75 * s, 0, -0.48 * s, -0.62 * s, 0, -0.26 * s);
          c.bezierCurveTo(0.48 * s, -0.62 * s, 0.75 * s, 0, 0, 0.48 * s); c.fill(); break;
        case 'shield':
          c.arc(0, -0.15 * s, 0.6 * s, 0.22 * Math.PI, 0.78 * Math.PI); c.stroke();
          c.beginPath(); c.arc(0, -0.2 * s, 0.17 * s, 0, TAU); c.fill(); break;
        case 'fast':
          for (const o of [-0.22, 0.2]) { c.moveTo((o - 0.17) * s, -0.32 * s); c.lineTo((o + 0.15) * s, 0); c.lineTo((o - 0.17) * s, 0.32 * s); }
          c.stroke(); break;
      }
      c.restore();
    }
    function capsule(type, x, y, r) {
      const p = PU[type];
      if (p.bad) { g.draw.circle(x, y, r, BAD_FILL, { stroke: p.col, lw: r * 0.14 }); glyph(type, x, y, r * 0.95, p.col); }
      else { g.draw.ball(x, y, r, p.col); glyph(type, x, y, r * 0.95, '#fff'); }
    }

    g.loop((dt, t) => {
      update(dt);
      const { ctx, cx, cy, R } = g;
      g.draw.bg({ glow: 0.12 + bump * 0.05 });
      // guide ring along the paddle's track
      ctx.save();
      ctx.setLineDash([R * 0.01, R * 0.025]); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, PR * R, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = R * 0.006; ctx.stroke();
      ctx.restore();
      // shield ring
      if (shield || shieldFx > 0) {
        const a = shield ? 0.55 + 0.15 * Math.sin(t * 4) : shieldFx * 0.8;
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, SHIELD_R * R * (shield ? 1 : 1 + (1 - shieldFx) * 0.04), 0, TAU);
        ctx.strokeStyle = g.draw.alpha(THEME.ok, a); ctx.lineWidth = R * 0.01 * (shield ? 1 : 1 + shieldFx);
        ctx.shadowColor = THEME.ok; ctx.shadowBlur = R * 0.03; ctx.stroke(); ctx.restore();
      }
      drawBlocks(t);
      // explosion shock rings
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i]; w.t += dt * 2.6;
        if (w.t >= 1) { waves.splice(i, 1); continue; }
        g.draw.circle(cx + w.x * R, cy + w.y * R, R * (0.03 + 0.17 * w.t), null, { stroke: g.draw.alpha(BOOM, 0.7 * (1 - w.t)), lw: R * 0.012 * (1 - w.t) + 1 });
      }
      // capsules
      for (const c of caps) {
        const [x, y] = px(c.a, c.r), k = clamp((1.04 - c.r) / 0.1, 0, 1);
        ctx.globalAlpha = c.missed ? k * 0.7 : Math.min(1, c.t * 4);
        capsule(c.type, x, y, CAP_R * R * (1 + 0.06 * Math.sin(c.t * 7)));
        ctx.globalAlpha = 1;
      }
      // laser beams
      if (beams.length) {
        ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = '#ff8a98'; ctx.lineWidth = R * 0.011; ctx.shadowColor = '#ff5a6a'; ctx.shadowBlur = R * 0.03;
        ctx.beginPath();
        for (const bm of beams) { const [x0, y0] = px(bm.a, bm.r), [x1, y1] = px(bm.a, bm.r + 0.09); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
        ctx.stroke(); ctx.restore();
      }
      // balls: a soft trail, then the flat ball
      const fire = eff.fire > 0;
      for (const b of balls) {
        if (!b.held) {
          const n = b.trail.length;
          ctx.lineCap = 'round'; ctx.strokeStyle = fire ? FIRE : g.color;
          for (let j = 1; j < n; j++) {
            const p0 = b.trail[(b.ti + j) % n], p1 = b.trail[(b.ti + j + 1) % n], f = j / n;
            ctx.globalAlpha = f * (fire ? 0.6 : 0.4); ctx.lineWidth = BR * R * 2 * (0.2 + f * 0.7);
            ctx.beginPath(); ctx.moveTo(cx + p0.x * R, cy + p0.y * R); ctx.lineTo(cx + p1.x * R, cy + p1.y * R); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        g.draw.ball(cx + b.x * R, cy + b.y * R, BR * R * (1 + b.hitT * 0.3), fire ? FIRE : BALL);
        if (b.serve) {
          const k = 0.5 + 0.5 * Math.sin(t * 7);
          g.draw.circle(cx + b.x * R, cy + b.y * R, BR * R * (1.7 + k * 0.5), null, { stroke: g.draw.alpha(BALL, 0.25 + 0.3 * k), lw: R * 0.005 });
        }
      }
      // rim ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]; r.t += dt * (r.big ? 1 : 1.8);
        if (r.t >= 1) { ripples.splice(i, 1); continue; }
        const span = (r.big ? 0.4 : 0.2) + r.t * (r.big ? 0.7 : 0.35);
        g.draw.arc(cx, cy, ((r.big ? SHIELD_R : PR) + 0.02 + r.t * 0.04) * R, r.a - span, r.a + span, g.draw.alpha(r.col || g.color, (1 - r.t) * 0.5), R * 0.01 * (1 - r.t * 0.6));
      }
      // the paddle: a neon arc with a bright core (gold core when sticky, red cannons with the laser)
      const pc = paddle.flash > 0 ? g.draw.shade(g.color, paddle.flash * 0.5) : g.color;
      g.draw.arc(cx, cy, PR * R, paddle.a - paddle.hw, paddle.a + paddle.hw, pc, TH * R, { glow: R * (0.04 + paddle.flash * 0.05) });
      g.draw.arc(cx, cy, PR * R, paddle.a - paddle.hw * 0.92, paddle.a + paddle.hw * 0.92, eff.sticky > 0 ? PU.sticky.col : 'rgba(255,255,255,.55)', TH * R * (eff.sticky > 0 ? 0.36 : 0.22));
      if (eff.laser > 0) for (const s of [-1, 1]) {
        const [x, y] = px(paddle.a + s * paddle.hw * 0.78, PR - TH * 0.75);
        g.draw.ball(x, y, R * 0.012, PU.laser.col);
      }
      g.draw.particles(dt);
      g.draw.floaters(dt);
      // active effects: small icons with a timer arc, fanned out either side of the score
      let n = 0;
      for (const k of EFFECTS) {
        if (eff[k] <= 0) continue;
        const side = n % 2 ? -1 : 1, a = side * (0.4 + Math.floor(n / 2) * 0.15); n++;
        const [x, y] = px(a, 0.79), r = R * 0.029, p = PU[k];
        const blink = eff[k] < 2 && Math.sin(t * 16) < 0 ? 0.35 : 1;
        ctx.globalAlpha = blink;
        capsule(k, x, y, r);
        ctx.globalAlpha = 1;
        g.draw.circle(x, y, r * 1.45, null, { stroke: 'rgba(255,255,255,.1)', lw: R * 0.006 });
        ctx.beginPath(); ctx.arc(x, y, r * 1.45, -Q, -Q + TAU * (eff[k] / p.time));
        ctx.strokeStyle = p.col; ctx.lineWidth = R * 0.006; ctx.lineCap = 'round'; ctx.stroke();
      }
      // serve hint
      if (phase === 'play' && balls.some((b) => b.serve)) {
        const k = 0.55 + 0.25 * Math.sin(t * 3);
        g.draw.text(touching ? 'RELEASE TO LAUNCH' : 'TAP TO LAUNCH', cx, cy + R * 0.69, R * 0.042, { color: `rgba(255,255,255,${k})`, weight: 600, font: THEME.font });
      }
      if (phase === 'lost' || phase === 'over') {   // red vignette as the last ball slips out
        const k = phase === 'lost' ? phaseT : 1;
        const vg = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
        vg.addColorStop(0, 'rgba(255,90,106,0)'); vg.addColorStop(1, `rgba(255,90,106,${0.24 * k})`);
        ctx.fillStyle = vg; ctx.fillRect(0, 0, g.S, g.S);
      }
    });

    return {
      pause() { touching = false; keyDir = 0; },
    };
  },
};
