// Circle Pong — keep the ball inside the circle. Your paddle is an arc on the rim that follows your
// finger; every return is a point. Where the ball lands on the paddle sets its new angle, and it speeds
// up a little with each hit.
//   Classic     one ball, one paddle.          Two balls   a second ball joins after 10 hits.
//   Power-ups   classic plus pick-ups the ball collects (good and bad ones) — see pong-power.js.
//   Against     the rim is split into 2–4 sectors; you guard the bottom one, COM paddles guard the rest.
//               A goal costs that sector's owner a life; a knocked-out sector turns into a wall.
//   2 players   one half each on the same screen (two fingers at once, or ←/→ and A/D).
import { TAU, rand, clamp, lerp, angDiff, ease, THEME } from './kit.js';
import { POWERS, pickPower, drawPowerIcon } from './pong-power.js';

const LEVELS = {
  // think every (s) · max speed (rad/s) · accel · aim error · error left near the ball · blunder chance ·
  // wall bounces it reads ahead · how far off-centre it hits · how often it aims its return away from a paddle
  easy: { name: 'Easy', react: 0.3, speed: 2.0, accel: 14, sigma: 0.24, keep: 0.45, blunder: 0.2, depth: 0, sharp: 0.45, smart: 0.15, mult: 1 },
  normal: { name: 'Normal', react: 0.18, speed: 2.9, accel: 22, sigma: 0.15, keep: 0.26, blunder: 0.13, depth: 1, sharp: 0.62, smart: 0.5, mult: 2 },
  hard: { name: 'Hard', react: 0.09, speed: 4.2, accel: 34, sigma: 0.09, keep: 0.12, blunder: 0.085, depth: 2, sharp: 0.8, smart: 0.85, mult: 3 },
};
const OTHER_COLS = ['#ff9f43', '#b57bff', '#3ddc84'];   // COM / player 2 sectors (THEME.pieces)
const BALL_COL = '#e9f2ff';

export default {
  howTo: 'Slide your finger around the edge to move your paddle and keep the ball inside. Against: guard your sector and knock the COMs out. 2 players: each touches their own half (or ←/→ and A/D).',
  modes: [
    { id: 'classic', name: 'Classic' },
    { id: 'two', name: 'Two balls' },
    { id: 'power', name: 'Power-ups' },
    {
      id: 'vs', name: 'Against', options: [
        { id: 'split', name: 'Split', choices: [{ id: '2', name: '2' }, { id: '3', name: '3' }, { id: '4', name: '4' }] },
        { id: 'level', name: 'COM', choices: [{ id: 'easy', name: 'Easy' }, { id: 'normal', name: 'Normal' }, { id: 'hard', name: 'Hard' }], default: 'normal' },
      ],
    },
    { id: '2p', name: '2 players', unit: 'hits' },
  ],
  scoring: 'high',
  hud: false,                                   // the score sits big and faint in the middle, like the watch game
  create(g, { mode, opts = {} }) {
    const PR = 0.88, TH = 0.042, BR = 0.03;     // paddle radius, thickness, ball radius (× R)
    const TWO_AT = 10;
    const solo = mode !== 'vs' && mode !== '2p';
    const power = mode === 'power';
    const N = mode === '2p' ? 2 : mode === 'vs' ? clamp(Math.round(+opts.split) || 2, 2, 4) : 1;
    const LV = LEVELS[opts.level] || LEVELS.normal;
    const HALF = Math.PI / N;                   // half a sector
    const LIVES = mode === '2p' ? 5 : 3;
    const SPMAX = () => g.R * 1.9;
    // the pause button sits on a sector boundary (where no paddle can be) instead of over the top paddle
    if (N > 1) {
      let best = 0, bd = 9;
      for (let k = 0; k < N; k++) { const b = (Math.PI + HALF + (k * TAU) / N) % TAU, d = Math.abs(angDiff(0, b)); if (d < bd - 1e-6) { bd = d; best = b; } }
      g.pauseAt(Math.sin(best) * 0.876, -Math.cos(best) * 0.876);
    }

    // ---------- players (solo modes: one paddle that can go all the way round) ----------
    const players = [];
    for (let i = 0; i < N; i++) {
      const c = (Math.PI + (i * TAU) / N) % TAU;
      const w = solo ? 0.3 : N === 2 ? 0.3 : 0.27;
      players.push({
        i, c, a: c, target: c, v: 0, w, col: i === 0 ? g.color : OTHER_COLS[(i - 1) % 3],
        kind: solo || i === 0 || mode === '2p' ? 'human' : 'com',
        name: mode === '2p' ? `P${i + 1}` : i === 0 ? 'You' : N === 2 ? 'COM' : `COM ${i}`,
        lives: LIVES, out: false, outT: 0, flash: 0, hurt: 0, keyDir: 0, keys: new Set(),
        ai: { t: 0, ver: -1, err: 0, k: 0, blunder: false, tgt: null, goal: c, idle: 0 },
      });
    }
    const me = players[0];
    const lim = (pl) => Math.max(0, HALF - pl.w);
    const sectorOf = (ang) => {
      if (N === 1) return 0;
      let rel = (ang - Math.PI) % TAU; if (rel < 0) rel += TAU;
      return Math.floor((rel + HALF) / (2 * HALF)) % N;
    };
    const inSector = (pl, ang) => pl.c + clamp(angDiff(pl.c, ang), -lim(pl), lim(pl));

    let hits = 0, score = 0, total = 0, elims = 0, phase = 'play', missT = 0, slow = 1, bump = 0, goalT = 0, ver = 0;
    let endInfo = null, won = false;
    const balls = [], ripples = [];
    let pending2 = false;

    function makeBall(col, delay, dirA, speed) {
      const b = { x: 0, y: 0, vx: 0, vy: 0, sp: speed, col, live: true, out: false, serve: delay, dirA, trail: [], ti: 0, hitT: 0, last: -1, ver: ++ver, stuck: null };
      for (let i = 0; i < 14; i++) b.trail.push({ x: 0, y: 0 });
      balls.push(b);
      return b;
    }
    const baseSpeed = () => g.R * Math.min(1.75, 0.78 + hits * 0.022);
    if (solo) makeBall('#ffffff', 1.1, Math.PI + rand(-0.5, 0.5), g.R * 0.7);
    else {
      // the first serve goes to a COM (or the top player) so nobody is caught cold
      const to = players[1 + Math.floor(Math.random() * (N - 1))];
      makeBall('#ffffff', 1.3, to.c + rand(-0.35, 0.35) * HALF, g.R * 0.66);
    }
    g.score(0);
    if (mode === 'two') g.toast(`Second ball at ${TWO_AT}`, 1500);
    if (mode === 'vs') g.toast(N === 2 ? 'Guard the bottom!' : `${N}-way · ${LV.name}`, 1400);
    if (mode === '2p') g.toast('First to lose 5 is out', 1500);

    // ---------- power-ups ----------
    const fx = { wide: 0, slow: 0, sticky: 0, double: 0, shrink: 0, fast: 0, reverse: 0 };
    const OPP = { wide: 'shrink', shrink: 'wide', slow: 'fast', fast: 'slow' };
    let shield = false, shieldT = 0, spawnT = 4;
    const pups = [];   // { kind, x, y (× R from the centre), t, life }
    function spawnPower() {
      const kind = pickPower((k) => (k === 'shield' && shield) || (k === 'multi' && balls.filter((b) => b.live).length >= 3) || (k === 'sticky' && fx.sticky > 0));
      for (let tries = 0; tries < 12; tries++) {
        const a = rand(TAU), r = rand(0.12, 0.56);
        const x = Math.sin(a) * r, y = -Math.cos(a) * r;
        if (pups.some((p) => Math.hypot(p.x - x, p.y - y) < 0.25)) continue;
        if (balls.some((b) => b.live && Math.hypot(b.x / g.R - x, b.y / g.R - y) < 0.22)) continue;
        pups.push({ kind, x, y, t: 0, life: 9 });
        g.sfx('pop', { volume: 0.5, pitch: 1.3 });
        return;
      }
    }
    function collect(p, b) {
      const P = POWERS[p.kind];
      const [px, py] = [g.cx + p.x * g.R, g.cy + p.y * g.R];
      g.draw.burst(px, py, P.col, 14, g.R * 0.4, g.R * 0.01);
      g.draw.float(P.name, px, py - g.R * 0.06, P.col, g.R * 0.055);
      if (P.good) { addPoints(2, px, py + g.R * 0.04); g.sfx('coin'); } else { g.sfx('laser', { pitch: 0.6 }); g.vibrate(30); }
      if (OPP[p.kind]) fx[OPP[p.kind]] = 0;
      if (P.dur) fx[p.kind] = P.dur;
      if (p.kind === 'shield') { shield = true; shieldT = 0; }
      if (p.kind === 'multi') {
        const ang = Math.atan2(b.vx, -b.vy), sp = Math.max(b.sp, g.R * 0.75);
        [-0.55, 0.55].forEach((d, j) => {
          const nb = makeBall(j ? THEME.warn : '#2ee6d6', 0, ang + d, sp);
          nb.x = b.x; nb.y = b.y; nb.vx = Math.sin(ang + d) * sp; nb.vy = -Math.cos(ang + d) * sp; nb.serve = -2;
          for (const tp of nb.trail) { tp.x = b.x; tp.y = b.y; }
        });
      }
      if (p.kind === 'reverse') for (const pl of players) pl.target = pl.a;
      bump = 0.6;
    }
    function addPoints(n, x, y) {
      const v = power && fx.double > 0 ? n * 2 : n;
      score += v; g.score(score);
      if (power && x != null) g.draw.float(`+${v}`, x, y, fx.double > 0 ? POWERS.double.col : THEME.fg, g.R * 0.05);
    }

    // ---------- input ----------
    const ptrs = new Map();   // pointer id → which player it steers
    const rev = () => power && fx.reverse > 0;
    function aim(pl, ang) {
      if (pl.out || pl.kind !== 'human') return;
      if (rev()) ang = TAU - ang;              // mirrored left ↔ right
      pl.target = solo ? pl.a + angDiff(pl.a, ang) : inSector(pl, ang);
    }
    g.on('down', (p) => {
      const who = mode === '2p' && p.dy < 0 ? 1 : 0;
      ptrs.set(p.id, who);
      if (p.r > 0.12) aim(players[who], p.a);
    });
    g.on('move', (p) => { if (ptrs.has(p.id) && p.r > 0.12) aim(players[ptrs.get(p.id)], p.a); });
    g.on('up', (p) => { ptrs.delete(p.id); if (power && !ptrs.size) release(); });
    g.on('tap', () => { if (power) release(); });
    // keys: a direction along the rim per player. Solo: ← = anticlockwise (like the rotary knob);
    // in the split modes the arrows move the bottom paddle left / right on screen, A / D the top one.
    const KEYMAP = solo
      ? { ArrowLeft: [0, -1], ArrowRight: [0, 1] }
      : { ArrowLeft: [0, 1], ArrowRight: [0, -1], ...(mode === '2p' ? { a: [1, -1], A: [1, -1], d: [1, 1], D: [1, 1] } : {}) };
    const keyDirOf = (pl) => { let d = 0; for (const k of pl.keys) d = KEYMAP[k][1]; return d; };
    g.on('key', (e) => {
      if (power && [' ', 'Enter', 'ArrowUp'].includes(e.key)) { release(); return; }
      const m = KEYMAP[e.key];
      if (!m) return;
      const pl = players[m[0]];
      pl.keys.delete(e.key); pl.keys.add(e.key);   // the latest key held wins
      pl.keyDir = keyDirOf(pl);
      if (solo) pl.target = pl.a + pl.keyDir * (rev() ? -1 : 1) * 0.18;
    });
    g.on('keyup', (e) => {
      const m = KEYMAP[e.key];
      if (!m) return;
      const pl = players[m[0]];
      pl.keys.delete(e.key); pl.keyDir = keyDirOf(pl);
    });
    g.on('wheel', (e) => {
      if (me.out) return;
      me.target += e.delta * 0.16 * (rev() ? -1 : 1);
      if (!solo) me.target = inSector(me, me.target);
    });
    let R0 = g.R;
    g.on('resize', () => {
      const k = g.R / (R0 || g.R); R0 = g.R;
      if (k === 1) return;
      for (const b of balls) { b.x *= k; b.y *= k; b.vx *= k; b.vy *= k; b.sp *= k; for (const tp of b.trail) { tp.x *= k; tp.y *= k; } }
    });

    // ---------- the COM paddles ----------
    const contactR = () => (PR - TH / 2 - BR) * g.R;
    /** Where a ball from (x, y) going (vx, vy) next reaches the rim — reading `depth` wall bounces ahead. */
    function predict(x, y, vx, vy, depth) {
      const rc = contactR();
      let t = 0;
      for (let k = 0; k <= depth; k++) {
        const vv = vx * vx + vy * vy;
        if (vv < 1e-6) return null;
        const pv = x * vx + y * vy, disc = pv * pv - vv * (x * x + y * y - rc * rc);
        if (disc < 0) return null;
        const tt = (-pv + Math.sqrt(disc)) / vv;
        x += vx * tt; y += vy * tt; t += tt;
        const ang = Math.atan2(x, -y), s = sectorOf(ang);
        if (!players[s].out || k === depth) return { ang, t, s, vx, vy };
        const nx = x / rc, ny = y / rc, dot = vx * nx + vy * ny;
        vx -= 2 * dot * nx; vy -= 2 * dot * ny;
      }
      return null;
    }
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.75;
    /** Someone to aim the return at: any other player still in, you twice as likely. */
    function pickTarget(pl) {
      const opp = players.filter((p) => p !== pl && !p.out);
      const wts = opp.map((p) => (p === me ? 2 : 1));
      let n = wts.reduce((a, b) => a + b, 0) * Math.random();
      for (let j = 0; j < opp.length; j++) if ((n -= wts[j]) <= 0) return opp[j];
      return opp[0] || null;
    }
    /** The paddle offset k that sends the ball to the far side of `tgt`'s sector, away from its paddle. */
    function aimAt(pr, pl, tgt) {
      const ends = [tgt.c - HALF * 0.72, tgt.c + HALF * 0.72];
      const T = Math.abs(angDiff(tgt.a, ends[0])) > Math.abs(angDiff(tgt.a, ends[1])) ? ends[0] : ends[1];
      const px = Math.sin(pr.ang), py = -Math.cos(pr.ang), tx = Math.sin(T), ty = -Math.cos(T);
      const want = angDiff(pr.ang + Math.PI, Math.atan2(tx - px, -(ty - py)));
      const dot = pr.vx * px + pr.vy * py, rx = pr.vx - 2 * dot * px, ry = pr.vy - 2 * dot * py;
      const refl = angDiff(pr.ang + Math.PI, Math.atan2(rx, -ry));
      return clamp((refl - want) / 0.85, -LV.sharp, LV.sharp);
    }
    function comMove(pl, dt) {
      const ai = pl.ai;
      if ((ai.t -= dt) <= 0) {
        ai.t = LV.react * rand(0.8, 1.25);
        let best = null;
        for (const b of balls) {
          if (!b.live || b.out) continue;
          const serving = b.serve > 0;
          const vx = serving ? Math.sin(b.dirA) * b.sp : b.vx, vy = serving ? -Math.cos(b.dirA) * b.sp : b.vy;
          const pr = predict(serving ? 0 : b.x, serving ? 0 : b.y, vx, vy, LV.depth);
          if (!pr || pr.s !== pl.i) continue;
          const t = pr.t + (serving ? b.serve : 0);
          if (!best || t < best.t) best = { ...pr, t, b };
        }
        if (best) {
          if (ai.ver !== best.b.ver) {        // a new approach: misjudge it a little (or a lot, now and then)
            ai.ver = best.b.ver;
            ai.k = (Math.random() < 0.5 ? -1 : 1) * rand(0.1, LV.sharp);
            ai.tgt = Math.random() < LV.smart ? pickTarget(pl) : null;
            ai.blunder = Math.random() < LV.blunder && phase === 'play';
            ai.err = ai.blunder ? rand(0.6, 0.85) : gauss() * LV.sigma;
          }
          if (ai.tgt && !ai.tgt.out) ai.k = aimAt(best, pl, ai.tgt);
          const f = ai.blunder ? 1 : LV.keep + (1 - LV.keep) * clamp(best.t / 1.3, 0, 1);
          // a blunder goes the wrong way: towards the middle of its sector, so the edge can't save it
          const err = ai.blunder ? (angDiff(pl.c, best.ang) > 0 ? -ai.err : ai.err) : ai.err * f;
          ai.goal = best.ang - ai.k * pl.w + err;
        } else {
          if (ai.ver !== -1) { ai.ver = -1; ai.idle = rand(-0.25, 0.25) * lim(pl); }
          ai.goal = pl.c + ai.idle;
        }
        ai.goal = inSector(pl, ai.goal);
      }
      const want = angDiff(pl.a, ai.goal);
      const desired = clamp(want * 7, -LV.speed, LV.speed);
      pl.v += clamp(desired - pl.v, -LV.accel * dt, LV.accel * dt);
      pl.a += pl.v * dt;
    }
    function movePaddle(pl, dt) {
      if (pl.out) { pl.outT = Math.min(1, pl.outT + dt * 1.6); return; }
      pl.flash = Math.max(0, pl.flash - dt * 4);
      pl.hurt = Math.max(0, pl.hurt - dt * 1.5);
      if (phase === 'end' || phase === 'over' || (solo && phase !== 'play')) return;
      if (pl.kind === 'com') comMove(pl, dt);
      else {
        const kd = pl.keyDir * (rev() ? -1 : 1);
        if (kd) pl.target = pl.a + kd * 0.5;
        if (!solo) pl.target = inSector(pl, pl.target);
        const want = angDiff(pl.a, pl.target);
        const maxV = kd ? 4.2 : 14;
        pl.v = clamp(want * 24, -maxV, maxV);
        pl.a += clamp(pl.v * dt, -Math.abs(want), Math.abs(want));
      }
      if (!solo) {
        const off = angDiff(pl.c, pl.a), l = lim(pl);
        if (Math.abs(off) > l) { pl.a = pl.c + Math.sign(off) * l; if (pl.kind === 'com') pl.v = 0; }
      }
    }

    // ---------- physics ----------
    function launch(b) {
      b.vx = Math.sin(b.dirA) * b.sp; b.vy = -Math.cos(b.dirA) * b.sp; b.ver = ++ver;
      g.sfx('whoosh', { volume: 0.6 });
    }
    /** Send the ball off at `rel` from the inward normal at rim angle `ang`. */
    function sendOff(b, ang, rel) {
      const outA = ang + Math.PI + rel;
      b.vx = Math.sin(outA) * b.sp; b.vy = -Math.cos(outA) * b.sp; b.ver = ++ver;
    }
    const reflRel = (b, ang) => {
      // angle of the reflected ray relative to the inward normal
      const nx = Math.sin(ang), ny = -Math.cos(ang), dot = b.vx * nx + b.vy * ny;
      const rx = b.vx - 2 * dot * nx, ry = b.vy - 2 * dot * ny;
      return angDiff(ang + Math.PI, Math.atan2(rx, -ry));
    };
    function paddleHit(b, ang, pl) {
      // reflect off the rim's normal, then bend by where it hit the paddle (Arkanoid-style)
      const off = angDiff(pl.a, ang), k = clamp(off / pl.w, -1, 1);
      let rel = reflRel(b, ang) - k * 0.85 + rand(-0.07, 0.07);   // hit the left end → it flies left
      if (Math.abs(rel) < 0.12) rel = (rel < 0 ? -1 : 1) * rand(0.12, 0.25);   // never dead straight across
      rel = clamp(rel, -1.15, 1.15);
      total++;
      if (solo) {
        hits++;
        if (power) addPoints(1, null); else { score = hits; g.score(hits); }
        b.sp = Math.max(b.sp, baseSpeed()) + g.R * 0.004;
      } else {
        if (pl === me) { hits++; score++; g.score(score); }
        b.sp = Math.min(SPMAX(), b.sp + g.R * 0.035);
      }
      sendOff(b, ang, rel);
      b.hitT = 1; b.last = pl.i; pl.flash = 1; bump = 1;
      ripples.push({ a: ang, t: 0, col: pl.col });
      g.sfx('bounce', { pitch: 0.85 + Math.min(0.9, (solo ? hits : total) * 0.012) });
      if (pl.kind === 'human') g.vibrate(10);
      const hx = g.cx + Math.sin(ang) * PR * g.R * 0.97, hy = g.cy - Math.cos(ang) * PR * g.R * 0.97;
      g.draw.burst(hx, hy, pl.col, 8, g.R * 0.35, g.R * 0.008);
      if (solo && hits % 25 === 0) { g.toast(`${hits}!`, 900); g.sfx('score'); }
      if (mode === '2p' && total % 20 === 0) g.toast(`${total} hits!`, 900);
      if (mode === 'two' && hits === TWO_AT) { pending2 = true; g.toast('Second ball!', 1200); makeBall(THEME.warn, 99, 0, g.R * 0.6); }
      else if (pending2) {
        // launch the waiting ball towards where the paddle is now, while the first one crosses the circle
        pending2 = false;
        const b2 = balls[1]; b2.serve = 0.25; b2.dirA = me.a + rand(-0.45, 0.45); b2.sp = Math.max(g.R * 0.7, baseSpeed() * 0.8);
      }
      if (power && fx.sticky > 0) {   // caught: it rides on the paddle until you let go
        b.stuck = { off: clamp(off, -pl.w * 0.8, pl.w * 0.8), t: 0 };
        b.vx = b.vy = 0;
      }
    }
    function release() {
      for (const b of balls) if (b.stuck) {
        const k = clamp(b.stuck.off / me.w, -1, 1);
        b.stuck = null;
        let rel = -k * 0.85; if (Math.abs(rel) < 0.1) rel = (rel < 0 ? -1 : 1) * 0.1;
        sendOff(b, me.a + k * me.w, rel);
        g.sfx('flap', { volume: 0.7 });
      }
    }
    function wallHit(b, ang, col, sound = true) {
      let rel = reflRel(b, ang) + rand(-0.05, 0.05);
      if (Math.abs(rel) < 0.08) rel = (rel < 0 ? -1 : 1) * 0.08;
      sendOff(b, ang, clamp(rel, -1.2, 1.2));
      ripples.push({ a: ang, t: 0, col });
      if (sound) g.sfx('hit', { volume: 0.7 });
    }
    function miss(b, ang) {
      if (power && shield) {                   // the shield takes it, once
        shield = false; wallHit(b, ang, POWERS.shield.col, false);
        g.sfx('pop'); g.toast('Saved!', 800); g.vibrate(20);
        return;
      }
      b.live = false; b.out = true; b.stuck = null;
      if (phase !== 'play') return;
      ripples.push({ a: ang, t: 0, col: THEME.danger, big: true });
      g.sfx('drop'); g.vibrate(40);
      if (power && balls.some((o) => o.live)) return;   // multi-ball: fine as long as one is left
      phase = 'miss'; missT = 0.75;
    }
    function goal(b, ang) {
      const pl = players[sectorOf(ang)];
      b.live = false; b.out = true;
      if (phase !== 'play') return;
      pl.lives--; pl.hurt = 1;
      ripples.push({ a: ang, t: 0, col: THEME.danger, big: true });
      g.vibrate(pl === me || mode === '2p' ? 40 : 15);
      if (pl.lives <= 0) {
        pl.out = true; pl.outT = 0;
        g.sfx('boom', { volume: 0.6 });
        for (let j = -2; j <= 2; j++) {
          const aa = pl.c + j * HALF * 0.4;
          g.draw.burst(g.cx + Math.sin(aa) * PR * g.R, g.cy - Math.cos(aa) * PR * g.R, pl.col, 8, g.R * 0.3, g.R * 0.01);
        }
        if (mode === 'vs' && pl !== me) {
          elims++; score += 10; g.score(score);
          g.draw.float('+10', g.cx + Math.sin(pl.c) * g.R * 0.55, g.cy - Math.cos(pl.c) * g.R * 0.55, pl.col, g.R * 0.08);
        }
        const alive = players.filter((p) => !p.out);
        if (mode === '2p') return finish(alive[0]);
        if (pl === me) return finish(null);
        if (alive.length === 1) return finish(me);
        g.toast(`${pl.name} is out!`, 1100);
      } else {
        g.sfx(pl === me ? 'drop' : 'score', { volume: 0.8 });
        if (mode === 'vs' && pl !== me) g.draw.float('Goal!', g.cx + Math.sin(pl.c) * g.R * 0.55, g.cy - Math.cos(pl.c) * g.R * 0.55, pl.col, g.R * 0.06);
      }
      phase = 'goal'; goalT = 1.1;
    }
    function finish(winner) {
      phase = 'end'; missT = 0.85; won = winner === me;
      if (mode === '2p') {
        const lo = players.find((p) => p !== winner);
        endInfo = [total, { win: true, title: `${winner.name} wins!`, label: `${winner.name} wins`, note: `Lives left ${winner.lives} – ${lo.lives} · ${total} hits in the match`, delay: 900 }];
        g.toast(`${winner.name} wins!`, 1400);
      } else {
        const tag = `${N}-way · ${LV.name}`;
        if (won) {
          const bonus = 50 * (N - 1) * LV.mult;
          score += bonus; g.score(score);
          g.draw.float(`+${bonus}`, g.cx, g.cy - g.R * 0.25, THEME.ok, g.R * 0.09);
          endInfo = [score, { win: true, title: 'You win!', label: tag, note: `${hits} returns · ${elims} knocked out · win bonus ${bonus}`, delay: 900 }];
          for (let j = 0; j < 4; j++) g.draw.burst(g.cx + rand(-0.3, 0.3) * g.R, g.cy + rand(-0.3, 0.3) * g.R, THEME.pieces[j * 2], 14, g.R * 0.5, g.R * 0.012);
        } else {
          endInfo = [score || null, { win: false, title: 'Knocked out', label: tag, note: `${hits} returns · ${elims} of ${N - 1} COM${N > 2 ? 's' : ''} knocked out`, delay: 900 }];
        }
      }
    }
    function serve() {
      const alive = players.filter((p) => !p.out);
      const to = alive[Math.floor(Math.random() * alive.length)];
      balls.length = 0;
      const goals = players.reduce((s, p) => s + LIVES - p.lives, 0);
      makeBall('#ffffff', 0.9, to.c + rand(-0.35, 0.35) * HALF, g.R * Math.min(0.9, 0.7 + goals * 0.03));
      phase = 'play';
    }

    function step(b, dt) {
      if (!b.live && !b.out) return;
      if (b.serve > 0) {
        b.serve -= dt;
        if (b.serve <= 0 && b.serve > -1) launch(b);
        return;
      }
      if (b.stuck) {                            // riding on the sticky paddle
        b.stuck.t += dt;
        const ang = me.a + b.stuck.off, rc = contactR();
        b.x = Math.sin(ang) * rc; b.y = -Math.cos(ang) * rc;
        if (b.stuck.t > 2) release();
        return;
      }
      if (!solo && b.live && phase === 'play') {   // the rally speeds up the longer it lasts
        const sp = Math.min(SPMAX(), b.sp + g.R * 0.03 * dt);
        if (sp !== b.sp) { const k = sp / b.sp; b.vx *= k; b.vy *= k; b.sp = sp; }
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.hitT = Math.max(0, b.hitT - dt * 4);
      if (!b.live || phase !== 'play') return;
      if (power) for (let i = pups.length - 1; i >= 0; i--) {
        const p = pups[i];
        if (p.t > 0.2 && Math.hypot(b.x - p.x * g.R, b.y - p.y * g.R) < (BR + 0.055) * g.R) { pups.splice(i, 1); collect(p, b); }
      }
      const d = Math.hypot(b.x, b.y);
      const contact = contactR();
      if (d >= contact && b.vx * b.x + b.vy * b.y > 0) {
        const ang = Math.atan2(b.x, -b.y);
        // any paddle in reach (near a boundary the neighbour's paddle may get there)
        let hit = null, bestOff = Infinity;
        for (const pl of players) {
          if (pl.out) continue;
          const off = Math.abs(angDiff(pl.a, ang));
          if (off <= pl.w + (BR * 0.9) / PR && off < bestOff) { hit = pl; bestOff = off; }
        }
        if (hit) { b.x *= contact / d; b.y *= contact / d; paddleHit(b, ang, hit); return; }
        if (solo) return miss(b, ang);
        const owner = players[sectorOf(ang)];
        if (owner.out) { b.x *= contact / d; b.y *= contact / d; wallHit(b, ang, owner.col); }
        else goal(b, ang);
      }
    }

    // ---------- frame ----------
    g.loop((dt, t) => {
      const { ctx, cx, cy, R } = g;
      // power-up timers, spawns
      if (power && phase === 'play') {
        for (const k in fx) if (fx[k] > 0) { fx[k] = Math.max(0, fx[k] - dt); if (!fx[k] && k === 'reverse') g.toast('Controls back', 700); }
        for (let i = pups.length - 1; i >= 0; i--) if ((pups[i].t += dt) > pups[i].life) pups.splice(i, 1);
        if (hits >= 2 && pups.length < 2 && (spawnT -= dt) <= 0) { spawnPower(); spawnT = rand(4.5, 8); }
      }
      shieldT += dt;
      // paddles
      if (solo) {
        const wT = mode === 'two' ? 0.31 - clamp((hits - 30) / 50, 0, 1) * 0.1 : 0.3 - clamp((hits - 15) / 45, 0, 1) * 0.12;
        const wMul = fx.wide > 0 ? 1.55 : fx.shrink > 0 ? 0.6 : 1;
        me.w += (wT * wMul - me.w) * Math.min(1, dt * (power ? 6 : 3));
      }
      for (const pl of players) movePaddle(pl, dt);
      bump = Math.max(0, bump - dt * 3);

      // slow motion after a miss / at the end, then the game-over card
      if (phase === 'miss' || phase === 'end') {
        slow += ((phase === 'end' && won ? 0.45 : 0.25) - slow) * Math.min(1, dt * 8);
        if ((missT -= dt) <= 0) {
          if (phase === 'end') { phase = 'over'; g.over(...endInfo); }
          else {
            phase = 'over';
            const note = mode === 'two' ? (balls.length > 1 ? 'Both balls were in play.' : `The second ball joins at ${TWO_AT}.`) : '';
            g.over(score || null, { note: score ? note : 'Missed the very first one!', delay: 900 });
          }
        }
      } else if (phase === 'over') slow += (0.5 - slow) * Math.min(1, dt * 4);
      else if (phase === 'goal') { if ((goalT -= dt) <= 0) serve(); }
      const tScale = power ? (fx.slow > 0 ? 0.55 : 1) * (fx.fast > 0 ? 1.45 : 1) : 1;
      const wdt = dt * slow * tScale;
      let spSum = 0; for (const b of balls) spSum += b.sp * b.sp;
      const sub = Math.max(1, Math.ceil((Math.sqrt(spSum) * wdt) / (R * 0.02)));
      for (let i = 0; i < sub; i++) for (const b of balls) step(b, wdt / sub);
      for (let i = balls.length - 1; i >= 0; i--) if (power && balls[i].out && Math.hypot(balls[i].x, balls[i].y) > R * 1.4 && balls.length > 1) balls.splice(i, 1);
      for (const b of balls) { b.ti = (b.ti + 1) % b.trail.length; b.trail[b.ti].x = b.x; b.trail[b.ti].y = b.y; }

      // ================= draw =================
      const glowCol = power && fx.slow > 0 ? POWERS.slow.col : power && fx.reverse > 0 ? THEME.danger : g.color;
      g.draw.bg({ color: glowCol, glow: 0.12 + bump * 0.06 + (power && fx.reverse > 0 ? 0.05 * Math.sin(t * 10) : 0) });
      // the score, big and faint in the middle
      const sc = 1 + bump * 0.12;
      g.draw.text(String(mode === '2p' ? total : score), cx, cy, R * 0.36 * sc, { color: 'rgba(255,255,255,.09)' });
      if (mode === 'two' && hits < TWO_AT) g.draw.text(`2nd ball at ${TWO_AT}`, cx, cy + R * 0.25, R * 0.05, { color: THEME.dim, weight: 600, font: THEME.font });
      if (mode === '2p') g.draw.text('hits', cx, cy + R * 0.2, R * 0.045, { color: 'rgba(255,255,255,.16)', weight: 600, font: THEME.font });
      if (solo) drawGuide(ctx, cx, cy, R, 0, TAU, 'rgba(255,255,255,.1)');
      else drawSectors(ctx, cx, cy, R, t);
      // rim ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]; r.t += dt * (r.big ? 0.9 : 1.6);
        if (r.t >= 1) { ripples.splice(i, 1); continue; }
        const span = (r.big ? 0.5 : 0.25) + r.t * (r.big ? 0.8 : 0.45);
        g.draw.arc(cx, cy, (PR + 0.02 + r.t * 0.05) * R, r.a - span, r.a + span, g.draw.alpha(r.col, (1 - r.t) * 0.55), R * 0.012 * (1 - r.t * 0.6));
      }
      if (power) drawPowers(ctx, cx, cy, R, t);
      // paddles: flat solid arcs that flash white on a hit
      for (const pl of players) {
        if (pl.out) {
          if (pl.outT < 1) {   // shrinks away as the wall grows
            const k = 1 - pl.outT;
            g.draw.arc(cx, cy, PR * R, pl.a - pl.w * k, pl.a + pl.w * k, g.draw.alpha(pl.col, k), TH * R * k);
          }
          continue;
        }
        let col = pl.flash > 0 ? mix(pl.col, '#ffffff', pl.flash * 0.6) : pl.col;
        if (pl.hurt > 0) col = mix(pl.col, THEME.danger, pl.hurt * (0.5 + 0.5 * Math.sin(t * 30)));
        g.draw.arc(cx, cy, PR * R, pl.a - pl.w, pl.a + pl.w, col, TH * R);
      }
      // balls: flat fading trail, then the ball
      for (const b of balls) {
        const bc = b.col === '#ffffff' ? BALL_COL : b.col;
        const tc = b.col !== '#ffffff' ? b.col : b.last >= 0 ? players[b.last].col : g.color;
        if (b.serve > 0) {      // waiting in the middle, pulsing
          const k = 0.5 + 0.5 * Math.sin(t * 8);
          g.draw.circle(cx, cy, BR * R * (1.6 + k * 0.6), null, { stroke: g.draw.alpha(bc, 0.35 + k * 0.3), lw: 2 });
          if (!solo && b.serve < 10) {   // which way it'll go
            const to = players[sectorOf(b.dirA)];
            g.draw.arc(cx, cy, BR * R * 3.4, b.dirA - 0.35, b.dirA + 0.35, g.draw.alpha(to.col, 0.5 + k * 0.4), R * 0.01);
          }
          g.draw.ball(cx, cy, BR * R, bc);
          continue;
        }
        if (b.stuck) {   // aim line
          const k = clamp(b.stuck.off / me.w, -1, 1), oa = me.a + k * me.w + Math.PI - k * 0.85;
          ctx.save(); ctx.setLineDash([R * 0.012, R * 0.03]); ctx.lineCap = 'round';
          ctx.strokeStyle = g.draw.alpha(POWERS.sticky.col, 0.6); ctx.lineWidth = R * 0.008;
          ctx.beginPath(); ctx.moveTo(cx + b.x, cy + b.y); ctx.lineTo(cx + b.x + Math.sin(oa) * R * 0.55, cy + b.y - Math.cos(oa) * R * 0.55); ctx.stroke();
          ctx.restore();
        }
        const n = b.trail.length;
        ctx.lineCap = 'round'; ctx.strokeStyle = tc;
        for (let j = 1; j < n; j++) {
          const p0 = b.trail[(b.ti + j) % n], p1 = b.trail[(b.ti + j + 1) % n], f = j / n;
          ctx.globalAlpha = f * 0.4; ctx.lineWidth = BR * R * 2 * (0.25 + f * 0.7);
          ctx.beginPath(); ctx.moveTo(cx + p0.x, cy + p0.y); ctx.lineTo(cx + p1.x, cy + p1.y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        g.draw.ball(cx + b.x, cy + b.y, BR * R * (1 + b.hitT * 0.35), bc);
      }
      if (!solo) drawLives(ctx, cx, cy, R, t);
      if (power) drawTimers(ctx, cx, cy, R, t);
      g.draw.particles(dt);
      g.draw.floaters(dt);
      if (phase === 'miss' || phase === 'over' || (phase === 'end' && !won && mode !== '2p')) {   // red vignette as it slips out
        const k = phase === 'over' ? 1 : 1 - missT / 0.85;
        const vg = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
        const rgb = won || mode === '2p' ? '61,220,132' : '255,90,106';
        vg.addColorStop(0, `rgba(${rgb},0)`); vg.addColorStop(1, `rgba(${rgb},${0.22 * clamp(k, 0, 1)})`);
        ctx.fillStyle = vg; ctx.fillRect(0, 0, g.S, g.S);
      }
    });

    // ---------- drawing bits ----------
    function drawGuide(ctx, cx, cy, R, a0, a1, col) {
      ctx.save();
      ctx.setLineDash([R * 0.01, R * 0.025]); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, PR * R, a0 - Math.PI / 2, a1 - Math.PI / 2);
      ctx.strokeStyle = col; ctx.lineWidth = R * 0.006; ctx.stroke();
      ctx.restore();
    }
    function drawSectors(ctx, cx, cy, R, t) {
      for (const pl of players) {
        const a0 = pl.c - HALF, a1 = pl.c + HALF;
        // a faint band of the owner's colour just outside the paddle track
        g.draw.arc(cx, cy, R * 0.918, a0 + 0.03, a1 - 0.03, g.draw.alpha(pl.col, pl.out ? 0.08 : 0.22 + pl.hurt * 0.5), R * 0.01);
        if (!pl.out) { drawGuide(ctx, cx, cy, R, a0 + 0.04, a1 - 0.04, g.draw.alpha(pl.col, 0.16)); continue; }
        // knocked out: the sector grows into a solid wall from its middle
        const e = ease.out(pl.outT), s = HALF * e;
        g.draw.arc(cx, cy, PR * R, pl.c - s, pl.c + s, mix('#1c1e26', pl.col, 0.28), TH * R * 1.15, { cap: 'butt' });
        g.draw.arc(cx, cy, (PR - TH * 0.575) * R, pl.c - s, pl.c + s, g.draw.alpha(pl.col, 0.55), R * 0.005, { cap: 'butt' });
      }
      // divider ticks on the boundaries
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = R * 0.008;
      for (const pl of players) {
        const a = pl.c - HALF, s = Math.sin(a), c = -Math.cos(a);
        ctx.beginPath(); ctx.moveTo(cx + s * R * 0.83, cy + c * R * 0.83); ctx.lineTo(cx + s * R * 0.935, cy + c * R * 0.935); ctx.stroke();
      }
      ctx.restore();
    }
    function drawLives(ctx, cx, cy, R, t) {
      const rr = R * 0.72, dot = R * 0.016, gap = (R * 0.052) / rr;
      for (const pl of players) {
        if (pl.out) continue;
        for (let j = 0; j < LIVES; j++) {
          const a = pl.c + (j - (LIVES - 1) / 2) * gap;
          const x = cx + Math.sin(a) * rr, y = cy - Math.cos(a) * rr;
          if (j < pl.lives) g.draw.ball(x, y, dot, pl.col);
          else g.draw.circle(x, y, dot * 0.8, null, { stroke: 'rgba(255,255,255,.22)', lw: Math.max(1, R * 0.004) });
        }
        // the name, facing its player, for the first seconds (always in 2 players)
        const na = mode === '2p' ? 0.55 : clamp(1 - (g.time - 3) / 0.6, 0, 1) * 0.8;
        if (na > 0) {
          ctx.save();
          ctx.translate(cx + Math.sin(pl.c) * R * 0.63, cy - Math.cos(pl.c) * R * 0.63);
          ctx.rotate(pl.c - Math.PI);
          g.draw.text(pl.name, 0, 0, R * 0.042, { color: pl.col, alpha: na, weight: 700 });
          ctx.restore();
        }
      }
    }
    function drawPowers(ctx, cx, cy, R, t) {
      // shield: a ring just outside the paddle track
      if (shield) g.draw.arc(cx, cy, (PR + 0.045) * R, 0, TAU, g.draw.alpha(POWERS.shield.col, 0.5 + 0.2 * Math.sin(t * 4) * Math.min(1, shieldT)), R * 0.008);
      for (const p of pups) {
        const left = p.life - p.t;
        if (left < 2 && Math.sin(p.t * 22) < -0.2) continue;   // blinks before it goes
        const s = p.t < 0.35 ? Math.max(0.01, ease.back(p.t / 0.35)) : 1;
        const x = cx + p.x * R, y = cy + p.y * R + Math.sin(p.t * 3 + p.x * 9) * R * 0.008, r = R * 0.05 * s;
        g.draw.arc(x, y, r * 1.38, 0, TAU * (left / p.life), g.draw.alpha(POWERS[p.kind].col, 0.45), R * 0.006);
        drawPowerIcon(g, p.kind, x, y, r);
      }
    }
    function drawTimers(ctx, cx, cy, R, t) {
      const list = [];
      for (const k in fx) if (fx[k] > 0) list.push(k);
      if (shield) list.push('shield');
      const n = list.length, sp = R * 0.13, y = cy - R * 0.58;
      list.forEach((k, j) => {
        const x = cx + (j - (n - 1) / 2) * sp, P = POWERS[k];
        const left = k === 'shield' ? 1 : fx[k] / P.dur;
        const blink = k !== 'shield' && fx[k] < 1.5 && Math.sin(t * 20) < 0 ? 0.35 : 1;
        g.draw.arc(x, y, R * 0.052, 0, TAU, 'rgba(255,255,255,.1)', R * 0.008);
        g.draw.arc(x, y, R * 0.052, 0, TAU * left, P.col, R * 0.008);
        drawPowerIcon(g, k, x, y, R * 0.036, blink);
      });
    }
    function mix(a, b, k) {
      const p = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
      const A = p(a), B = p(b);
      return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], k))).join(',')})`;
    }
    return {
      pause() { ptrs.clear(); for (const pl of players) { pl.keys.clear(); pl.keyDir = 0; } },
    };
  },
};
