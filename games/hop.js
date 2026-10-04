// Sketch Jump — an endless bouncer on a page of graph paper. A little round critter (orange puff with a
// beak and a sprout on its head) bounces by itself; steer it left and right from ledge to ledge while the
// page scrolls up. It wraps across the notebook margins. Springs launch it, a balloon lifts it, scribble
// monsters bite — stomp them from above or tap to shoot pencil pellets at them. Fall off the page = over.
// Everything is in units of R (the screen radius); world y grows upwards.
import { TAU, rand, clamp, THEME } from './kit.js';
import { store } from '../js/core/store.js';

const W = 0.76;          // half width of the play column — the notebook margins; the critter wraps across them
const G = 4.0;           // gravity
const V0 = 2.2;          // bounce speed → jump height V0² / 2G ≈ 0.6
const VSPRING = 3.6;     // spring → ≈ 1.6
const VBAL = 2.6;        // balloon lift speed
const VMAX = 1.45;       // steering speed
const PR = 0.062;        // the critter's body radius
const FOOT = PR + 0.034; // centre → soles
const PH = 0.042;        // platform thickness
const CAM = 0.12;        // the camera keeps the critter at most this far above the centre
const PTS = 20;          // points per R climbed (1 R = 5 m)
const MAXGAP = 0.5;      // never a bigger vertical gap between reachable ledges (jump ≈ 0.6)

const BODY = '#ff9f43', BELLY = '#ffd7a8', BEAK = '#ffd34d', LEAF = '#a3e635';
const COL = { normal: '#a3e635', moving: '#4d9bff', breaking: '#c9925a', vanish: null };
const MONSTER = ['#ff5a6a', '#ff8ad8', '#b57bff'];
/** A theme accent, unless it's too grey to stand out as a special item (then a fallback colour). */
const vivid = (c, fb) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c || '');
  if (!m) return c || fb;
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  return Math.max(r, gg, b) - Math.min(r, gg, b) < 50 ? fb : c;
};

// ---- pre-generated wobble: sketchy strokes keep their shape from frame to frame
const jit = (n) => { const a = new Float32Array(n * 2); for (let i = 0; i < a.length; i++) a[i] = rand(-1, 1); return a; };
const CAPS = Array.from({ length: 10 }, () => jit(22));      // platform outlines
const BLOBS = Array.from({ length: 6 }, () => jit(16));      // round outlines (critter, monsters, balloon)
const CRACK = jit(5);

let PX = 0, PY = 0;
/** Point at fraction s along the outline of a capsule (w × h, centred) → PX, PY. */
function capPt(s, w, h) {
  s -= Math.floor(s);
  const r = h / 2, st = Math.max(0, w - h), arc = Math.PI * r, L = 2 * st + 2 * arc;
  let d = s * L;
  if (d < st) { PX = -st / 2 + d; PY = -r; return; }
  d -= st;
  if (d < arc) { const a = -Math.PI / 2 + d / r; PX = st / 2 + Math.cos(a) * r; PY = Math.sin(a) * r; return; }
  d -= arc;
  if (d < st) { PX = st / 2 - d; PY = r; return; }
  d -= st;
  const a = Math.PI / 2 + d / r; PX = -st / 2 + Math.cos(a) * r; PY = Math.sin(a) * r;
}
/** A wobbly hand-drawn capsule outline (a little overshoot at the end, like a pencil loop). */
function capPath(ctx, x, y, w, h, j, amp) {
  const n = j.length / 2;
  ctx.beginPath();
  for (let i = 0; i <= n + 2; i++) {
    const k = i % n;
    capPt(i / n, w, h);
    const ox = i > n ? amp * 1.2 : 0, oy = i > n ? -amp * 0.8 : 0;
    const px = x + PX + j[k * 2] * amp + ox, py = y + PY + j[k * 2 + 1] * amp * 0.6 + oy;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
}
/** A wobbly round outline (radius r, lumps of `amp` × r). */
function blobPath(ctx, x, y, r, j, amp, sx = 1, sy = 1) {
  const n = j.length / 2;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const k = i % n, a = (i / n) * TAU, rr = r * (1 + j[k * 2] * amp);
    const px = x + Math.cos(a) * rr * sx, py = y + Math.sin(a) * rr * sy;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

export default {
  howTo: 'Bounce up the page. Hold the left or right side (or ←/→) to steer, tap to shoot. Stomp monsters from above — don\'t fall off!',
  scoring: 'high',
  create(g) {
    const { ctx } = g;
    const progress = () => store.get('gameProgress') || {};
    const bestH = progress().hop?.bestH || 0;

    // ---------- state ----------
    const hero = { x: 0, y: FOOT, vx: 0, vy: V0, face: 1, squash: 0, spin: 0, balloon: 0, dead: false, rot: 0, look: 0 };
    let camY = 0.42, maxH = 0, bonus = 0, shownScore = -1, shownM = -1, ended = false, killer = null;
    let genY = 0, genX = 0, lastEnemy = 0, lastBalloon = 0, sinceExtra = 0;
    const plats = [], mons = [], falling = [];
    const pellets = Array.from({ length: 12 }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0 }));
    let shotCd = 0, hintT = 0;

    // ---------- the page: generation ----------
    const diff = (y) => clamp((y - 4) / 85, 0, 1) ** 0.9;
    const wrapD = (a, b) => { let d = Math.abs(a - b); if (d > W) d = 2 * W - d; return d; };
    function plat(type, x, y, w) {
      const p = { type, x, y, w, vx: 0, item: null, ix: 0, it: 0, dip: 0, gone: 0, broken: false, j1: (Math.random() * CAPS.length) | 0, j2: (Math.random() * CAPS.length) | 0, t: rand(TAU) };
      plats.push(p);
      return p;
    }
    // the start ledge
    plat('normal', 0, 0, 0.5);
    function spawnStep() {
      const d = diff(genY);
      const lo = 0.12 + 0.2 * d, hi = Math.min(MAXGAP, 0.21 + 0.3 * d);
      const gap = rand(lo, hi);
      const y = genY + gap;
      const w = 0.3 - 0.09 * d;
      const lim = W - w / 2 - 0.02;
      let x = rand(-lim, lim);
      if (wrapD(x, genX) < 0.12 && gap < 0.25) x = clamp(-x, -lim, lim);   // a little zig-zag
      let type = 'normal';
      const r = Math.random();
      if (y > 5 && r < 0.05 + 0.33 * d) type = 'moving';
      else if (y > 16 && Math.random() < 0.05 + 0.2 * d) type = 'vanish';
      const p = plat(type, x, y, w);
      if (type === 'moving') { p.vx = (0.22 + 0.45 * d) * (Math.random() < 0.5 ? -1 : 1); }
      // items
      if (type !== 'vanish' && y > 3) {
        if (y > 12 && y - lastBalloon > 22 && Math.random() < 0.03) { p.item = 'balloon'; lastBalloon = y; }
        else if (Math.random() < 0.075) p.item = 'spring';
        if (p.item) p.ix = rand(-1, 1) * (w / 2 - 0.045);
      }
      // a crumbly decoy between this ledge and the last one
      if (y > 4 && gap > 0.17 && Math.random() < 0.14 + 0.3 * d) {
        for (let tries = 0; tries < 6; tries++) {
          const bx = rand(-lim, lim);
          if (wrapD(bx, x) > w * 1.05 && wrapD(bx, genX) > w * 1.05) { plat('breaking', bx, genY + gap * rand(0.4, 0.6), w); break; }
        }
      }
      // early on, the odd extra ledge to make it friendly
      sinceExtra++;
      if (type !== 'moving' && Math.random() < 0.45 * (1 - d) && sinceExtra > 1) {
        const bx = rand(-lim, lim);
        if (wrapD(bx, x) > w * 1.2) { plat('normal', bx, y + rand(-0.04, 0.04), w * 0.9); sinceExtra = 0; }
      }
      // a scribble monster in the gap, away from both ledges
      if (y > 14 && y - lastEnemy > 4.2 - 2.2 * d && Math.random() < 0.14 + 0.25 * d) {
        for (let tries = 0; tries < 8; tries++) {
          const big = d > 0.45 && Math.random() < 0.35;
          const er = big ? 0.095 : 0.075;
          const patrol = d > 0.25 && Math.random() < 0.3 + 0.4 * d;
          const range = patrol ? rand(0.12, 0.3) : 0.03;
          const bx = rand(-(W - er - range), W - er - range);
          if (wrapD(bx, x) > 0.38 && wrapD(bx, genX) > 0.38) {
            mons.push({ x: bx, bx, y: genY + gap * 0.5 + 0.12, r: er, range, sp: rand(0.8, 1.5) * (patrol ? 1 : 0.6), t: rand(TAU), j: (Math.random() * BLOBS.length) | 0, col: MONSTER[(Math.random() * MONSTER.length) | 0], eyes: big ? 1 : 2, dead: false, vy: 0, rot: 0 });
            lastEnemy = y; break;
          }
        }
      }
      genY = y; genX = x;
    }
    while (genY < camY + 1.4) spawnStep();

    // ---------- input ----------
    let ptr = null, kl = false, kr = false, nudge = 0, nudgeT = 0, anyInput = false;
    g.on('down', (p) => { anyInput = true; if (!ptr) ptr = { id: p.id, x0: p.x, x: p.x, t0: performance.now(), moved: false }; });
    g.on('move', (p) => { if (ptr && p.id === ptr.id) { ptr.x = p.x; if (Math.abs(p.x - ptr.x0) > g.R * 0.05) ptr.moved = true; } });
    g.on('up', (p) => { if (ptr && p.id === ptr.id) ptr = null; });
    g.on('tap', (p) => shoot(p));
    const nudgeBy = (dir) => { anyInput = true; if (nudge !== dir) nudgeT = 0; nudge = dir; nudgeT = Math.min(0.32, nudgeT + 0.13); };
    g.on('key', (e) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { kl = true; nudgeBy(-1); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { kr = true; nudgeBy(1); }
      else if (k === ' ' || k === 'ArrowUp' || k === 'Enter' || k === 'w' || k === 'W') { anyInput = true; shoot(null); }
    });
    g.on('keyup', (e) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') kl = false;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') kr = false;
    });
    g.on('wheel', (e) => nudgeBy(e.delta > 0 ? 1 : -1));
    function steerNow(dt) {
      if (kl !== kr) return kl ? -1 : 1;
      if (ptr) {
        if (ptr.moved) return clamp((ptr.x - ptr.x0) / (g.R * 0.16), -1, 1);
        if (performance.now() - ptr.t0 > 110) return ptr.x < g.cx ? -1 : 1;
      }
      if (nudgeT > 0) { nudgeT -= dt; return nudge; }
      return 0;
    }
    function shoot(p) {
      if (hero.dead || ended || shotCd > 0) return;
      const b = pellets.find((q) => !q.on);
      if (!b) return;
      let a = 0;   // aim a little towards a tap above the critter
      if (p) {
        const hx = g.cx + hero.x * g.R, hy = g.cy - (hero.y - camY) * g.R;
        if (p.y < hy - g.R * 0.05) a = clamp(Math.atan2(p.x - hx, hy - p.y), -0.55, 0.55);
      }
      b.on = true; b.x = hero.x; b.y = hero.y + PR * 0.9; b.vx = Math.sin(a) * 3.2; b.vy = Math.cos(a) * 3.2;
      shotCd = 0.16; hero.look = 0.35;
      g.sfx('laser', { volume: 0.6, pitch: 1.3 });
    }

    // ---------- events ----------
    function bounce(v, p) {
      hero.vy = v; hero.squash = 1;
      if (p) p.dip = 1;
    }
    function scoreFx(n, x, y) {
      bonus += n;
      g.draw.float(`+${n}`, g.cx + x * g.R, g.cy - (y - camY) * g.R, THEME.fg, g.R * 0.065);
    }
    function killMonster(m, how) {
      m.dead = true; m.vy = how === 'stomp' ? -0.6 : 0.6; m.rot = 0;
      g.draw.burst(g.cx + m.x * g.R, g.cy - (m.y - camY) * g.R, m.col, 16, g.R * 0.55, g.R * 0.012);
      scoreFx(how === 'stomp' ? 50 : 30, m.x, m.y + m.r);
      g.sfx(how === 'stomp' ? 'hit' : 'pop'); g.vibrate(15);
    }
    function die(m) {
      hero.dead = true; killer = m; hero.vx = 0; hero.vy = Math.min(hero.vy, 0.6); hero.balloon = 0;
      g.sfx('hit'); g.vibrate(60);
      g.draw.burst(g.cx + hero.x * g.R, g.cy - (hero.y - camY) * g.R, BODY, 18, g.R * 0.5, g.R * 0.012);
    }
    function finish() {
      if (ended) return;
      ended = true;
      const m = Math.floor(maxH * 5);
      const all = progress();
      if (maxH > (all.hop?.bestH || 0)) store.set('gameProgress', { ...all, hop: { ...(all.hop || {}), bestH: maxH } });
      g.over(g.scoreValue, { title: killer ? 'Scribbled out!' : 'Fell off the page', note: `You climbed ${m} m.`, label: `${m} m`, delay: 900 });
    }

    // ---------- update ----------
    function step(dt) {
      // steering
      const target = hero.dead ? 0 : steerNow(dt) * VMAX;
      if (target) hero.face = target > 0 ? 1 : -1;
      hero.vx += (target - hero.vx) * Math.min(1, dt * 14);
      hero.x += hero.vx * dt;
      if (hero.x > W) hero.x -= 2 * W; else if (hero.x < -W) hero.x += 2 * W;
      // vertical
      const prevFeet = hero.y - FOOT;
      if (hero.balloon > 0) {
        hero.balloon -= dt;
        hero.vy += (VBAL - hero.vy) * Math.min(1, dt * 5);
        if (hero.balloon <= 0) {
          const bx = g.cx + hero.x * g.R, by = g.cy - (hero.y + 0.3 - camY) * g.R;
          g.draw.burst(bx, by, vivid(THEME.c2, '#2ee6d6'), 18, g.R * 0.5, g.R * 0.012); g.sfx('pop');
        }
      } else hero.vy -= G * dt;
      hero.vy = Math.max(hero.vy, -3.4);
      hero.y += hero.vy * dt;
      const feet = hero.y - FOOT;
      // ledges (only when falling onto them from above)
      if (!hero.dead && hero.balloon <= 0 && hero.vy < 0) {
        for (const p of plats) {
          if (p.gone || p.broken) continue;
          if (prevFeet >= p.y - 0.004 && feet <= p.y && Math.abs(hero.x - p.x) < p.w / 2 + PR * 0.55) {
            if (p.type === 'breaking') {
              p.broken = true; p.vy = 0; g.sfx('drop', { volume: 0.8 });
              g.draw.burst(g.cx + p.x * g.R, g.cy - (p.y - camY) * g.R, COL.breaking, 8, g.R * 0.25, g.R * 0.01);
              continue;
            }
            hero.y = p.y + FOOT;
            if (p.item === 'spring' && Math.abs(hero.x - (p.x + p.ix)) < 0.04 + PR * 0.55) {
              bounce(VSPRING, p); p.it = 1; hero.spin = 1;
              g.sfx('jump', { pitch: 1.5 }); g.sfx('whoosh');
            } else {
              bounce(V0, p);
              g.sfx('jump', { volume: 0.8, pitch: 0.9 + Math.min(0.5, maxH / 300) });
            }
            if (p.type === 'vanish') { p.gone = 0.001; g.draw.burst(g.cx + p.x * g.R, g.cy - (p.y - camY) * g.R, THEME.ink(0.6), 10, g.R * 0.3, g.R * 0.009); }
            break;
          }
        }
      }
      // balloon pick-up
      if (!hero.dead) {
        for (const p of plats) {
          if (p.item !== 'balloon' || p.gone) continue;
          const bx = p.x + p.ix, by = p.y + 0.15 + Math.sin(p.t * 2) * 0.01;
          if (Math.abs(hero.x - bx) < PR + 0.05 && Math.abs(hero.y - by) < PR + 0.09) {
            p.item = null; hero.balloon = 2.4; hero.spin = 0; g.sfx('pop', { pitch: 0.8 }); g.sfx('whoosh');
            g.toast('Up, up and away!', 900);
          }
        }
      }
      // monsters
      for (const m of mons) {
        if (m.dead) continue;
        if (!hero.dead) {
          const dx = hero.x - m.x, dy = hero.y - m.y, rr = m.r * 0.85 + PR * 0.85;
          if (dx * dx + dy * dy < rr * rr) {
            if (hero.balloon > 0) killMonster(m, 'shot');
            else if (hero.vy < 0 && dy > m.r * 0.25) { killMonster(m, 'stomp'); bounce(V0 * 1.08, null); }
            else die(m);
          }
        }
        for (const b of pellets) {
          if (!b.on || m.dead) continue;
          const dx = b.x - m.x, dy = b.y - m.y, rr = m.r + 0.02;
          if (dx * dx + dy * dy < rr * rr) { b.on = false; killMonster(m, 'shot'); }
        }
      }
      // pellets
      for (const b of pellets) {
        if (!b.on) continue;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x > W) b.x -= 2 * W; else if (b.x < -W) b.x += 2 * W;
        if (b.y - camY > 1.1) b.on = false;
      }
    }

    function update(dt, t) {
      const n = Math.ceil(dt / 0.0125), h = dt / n;
      for (let i = 0; i < n; i++) step(h);
      shotCd -= dt; hero.look = Math.max(0, hero.look - dt);
      hero.squash = Math.max(0, hero.squash - dt * 5);
      if (hero.spin > 0) hero.spin = Math.max(0, hero.spin - dt * 1.5);
      hero.rot = hero.dead ? hero.rot + dt * 7 : (hero.spin > 0 ? (1 - hero.spin) * TAU * hero.face : hero.vx * 0.1);
      // moving bits
      for (const p of plats) {
        p.t += dt; p.dip = Math.max(0, p.dip - dt * 4); p.it = Math.max(0, p.it - dt * 2.5);
        if (p.type === 'moving' && !p.gone) {
          p.x += p.vx * dt;
          const lim = W - p.w / 2 - 0.01;
          if (p.x > lim) { p.x = lim; p.vx = -Math.abs(p.vx); } else if (p.x < -lim) { p.x = -lim; p.vx = Math.abs(p.vx); }
        }
        if (p.gone) p.gone += dt * 3;
        if (p.broken) { p.vy -= G * 0.8 * dt; p.y += p.vy * dt; }
      }
      for (const m of mons) {
        m.t += dt;
        if (m.dead) { m.vy -= G * dt; m.y += m.vy * dt; m.rot += dt * 6; continue; }
        m.x = m.bx + Math.sin(m.t * m.sp) * m.range;
      }
      // camera + score
      if (!hero.dead && hero.y - camY > CAM) camY = hero.y - CAM;
      if (hero.y > maxH) maxH = hero.y;
      const s = Math.floor(maxH * PTS) + bonus;
      if (s !== shownScore) { shownScore = s; g.score(s); }
      const mm = Math.floor(maxH * 5);
      if (mm !== shownM) { shownM = mm; g.sub(`${mm} m`); }
      // the page ahead, and tidy up below
      while (genY < camY + 1.4) spawnStep();
      for (let i = plats.length - 1; i >= 0; i--) { const p = plats[i]; if (p.y < camY - 1.3 || p.gone > 1) plats.splice(i, 1); }
      for (let i = mons.length - 1; i >= 0; i--) if (mons[i].y < camY - 1.4) mons.splice(i, 1);
      // fell off the page (fully below the round edge at its x)
      const ex = Math.min(0.99, Math.abs(hero.x));
      if (hero.y - camY + PR * 1.6 < -Math.sqrt(1 - ex * ex)) finish();
      if (hero.dead && hero.y - camY < -1.25) finish();
    }

    // ---------- drawing ----------
    const sx = (x) => g.cx + x * g.R;
    const sy = (y) => g.cy - (y - camY) * g.R;
    const inkC = () => THEME.ink(THEME.light ? 0.82 : 0.85);

    function drawPaper() {
      const { R, cx, cy, S } = g;
      const paper = THEME.light ? '#fbfaf4' : THEME.bg;
      g.draw.bg({ fill: paper, glow: THEME.light ? 0.06 : 0.1, ring: false });
      // beyond the margins: a slightly darker strip
      ctx.fillStyle = THEME.ink(THEME.light ? 0.035 : 0.03);
      ctx.fillRect(0, 0, cx - W * R, S); ctx.fillRect(cx + W * R, 0, S, S);
      // graph paper: minor and major lines (the horizontal ones scroll with the page)
      const step = 0.1 * R;
      const minor = THEME.light ? 'rgba(70,120,200,.16)' : THEME.ink(0.05);
      const major = THEME.light ? 'rgba(70,120,200,.3)' : THEME.ink(0.1);
      const off = ((camY * 10) % 1 + 1) % 1;            // fraction of a cell scrolled
      const base = Math.floor(camY * 10);
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (let k = -10; k <= 10; k++) {
          if ((Math.abs(k) % 5 === 0) !== (pass === 1)) continue;
          const x = cx + k * step; ctx.moveTo(x, 0); ctx.lineTo(x, S);
        }
        for (let k = -11; k <= 11; k++) {
          if ((((base + k) % 5 + 5) % 5 === 0) !== (pass === 1)) continue;
          const y = cy + (off - k) * step; ctx.moveTo(0, y); ctx.lineTo(S, y);
        }
        ctx.strokeStyle = pass ? major : minor; ctx.lineWidth = pass ? 1.2 : 1; ctx.stroke();
      }
      // notebook margins (the critter wraps across them)
      ctx.beginPath();
      ctx.moveTo(cx - W * R, 0); ctx.lineTo(cx - W * R, S);
      ctx.moveTo(cx - W * R - R * 0.014, 0); ctx.lineTo(cx - W * R - R * 0.014, S);
      ctx.moveTo(cx + W * R, 0); ctx.lineTo(cx + W * R, S);
      ctx.strokeStyle = THEME.light ? 'rgba(235,70,90,.5)' : 'rgba(255,90,106,.38)'; ctx.lineWidth = Math.max(1, R * 0.004); ctx.stroke();
      // punched holes on the left strip
      const hy0 = Math.floor((camY - 1) / 0.7) * 0.7;
      for (let y = hy0; y < camY + 1.1; y += 0.7) {
        const ry = y - camY, hx = -0.87;
        if (hx * hx + ry * ry > 0.9 * 0.9) continue;
        ctx.beginPath(); ctx.arc(cx + hx * R, sy(y), R * 0.028, 0, TAU);
        ctx.fillStyle = THEME.light ? 'rgba(0,0,0,.08)' : THEME.ink(0.06); ctx.fill();
        ctx.strokeStyle = THEME.ink(0.16); ctx.lineWidth = 1; ctx.stroke();
      }
    }

    function drawMarks() {
      const { R, cx } = g;
      // every 25 m a ruler mark, and the best height so far
      const m0 = Math.ceil((camY - 1) / 5) * 5;
      ctx.save();
      ctx.setLineDash([R * 0.012, R * 0.018]); ctx.lineWidth = Math.max(1, R * 0.004);
      for (let y = Math.max(5, m0); y < camY + 1; y += 5) {
        const yy = sy(y);
        ctx.beginPath(); ctx.moveTo(cx - W * R, yy); ctx.lineTo(cx + W * R, yy); ctx.strokeStyle = THEME.ink(0.22); ctx.stroke();
        g.draw.text(`${Math.round(y * 5)} m`, cx - R * 0.5, yy - R * 0.03, R * 0.04, { color: THEME.ink(0.45), align: 'left', weight: 600 });
      }
      if (bestH > 3 && Math.abs(bestH - camY) < 1) {
        const yy = sy(bestH);
        ctx.beginPath(); ctx.moveTo(cx - W * R, yy); ctx.lineTo(cx + W * R, yy); ctx.strokeStyle = vivid(THEME.c1, '#4d9bff'); ctx.lineWidth = Math.max(1.5, R * 0.006); ctx.stroke();
        g.draw.text('best', cx + R * 0.5, yy - R * 0.032, R * 0.042, { color: vivid(THEME.c1, '#4d9bff'), align: 'right' });
      }
      ctx.restore();
    }

    function drawPlat(p) {
      const { R } = g;
      const x = sx(p.x), y = sy(p.y) + (PH / 2 + p.dip * 0.012) * R;
      const w = p.w * R, h = PH * R, ink = inkC();
      if (y < -h * 2 || y > g.S + h * 2) return;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (p.broken) {           // two halves tumbling away
        for (let s = -1; s <= 1; s += 2) {
          ctx.save(); ctx.translate(x + s * w * 0.27 + s * (-p.vy) * R * 0.06, y); ctx.rotate(s * Math.min(0.9, -p.vy * 0.5));
          ctx.fillStyle = COL.breaking; ctx.beginPath(); ctx.roundRect(-w * 0.24, -h / 2, w * 0.48, h, h / 2); ctx.fill();
          ctx.strokeStyle = ink; ctx.lineWidth = R * 0.007; capPath(ctx, 0, 0, w * 0.48, h, CAPS[s > 0 ? p.j1 : p.j2], R * 0.004); ctx.stroke();
          ctx.restore();
        }
        return;
      }
      const fade = p.gone ? Math.max(0, 1 - p.gone) : 1;
      ctx.globalAlpha = fade;
      const fill = COL[p.type];
      if (fill) {              // a highlighter swipe, a little off the pencil line
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.roundRect(x - w / 2 + R * 0.006, y - h / 2 + R * 0.005, w, h, h / 2); ctx.fill();
      }
      ctx.strokeStyle = ink; ctx.lineWidth = R * 0.0075;
      if (p.type === 'vanish') ctx.setLineDash([R * 0.022, R * 0.016]);
      const gw = p.gone ? 1 + p.gone * 0.3 : 1;
      capPath(ctx, x, y, w * gw, h, CAPS[p.j1], R * 0.004); ctx.stroke();
      ctx.globalAlpha = fade * 0.38;
      capPath(ctx, x, y, w * gw, h, CAPS[p.j2], R * 0.007); ctx.stroke();
      ctx.globalAlpha = fade;
      ctx.setLineDash([]);
      if (p.type === 'breaking') {   // a crack and some hatching
        ctx.beginPath();
        for (let i = 0; i < 5; i++) { const px = x + (CRACK[i * 2] * 0.12) * w, py = y - h / 2 + (i / 4) * h; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
        for (let i = -3; i <= 3; i++) { if (!i) continue; const hx = x + i * w * 0.13; ctx.moveTo(hx - h * 0.25, y + h * 0.3); ctx.lineTo(hx + h * 0.25, y - h * 0.3); }
        ctx.lineWidth = R * 0.005; ctx.stroke();
      } else if (p.type === 'moving') {   // speed marks on the trailing side
        const s = p.vx > 0 ? -1 : 1, ex = x + s * (w / 2 + R * 0.02);
        ctx.beginPath();
        ctx.moveTo(ex, y - h * 0.25); ctx.lineTo(ex + s * R * 0.035, y - h * 0.25);
        ctx.moveTo(ex + s * R * 0.01, y + h * 0.3); ctx.lineTo(ex + s * R * 0.05, y + h * 0.3);
        ctx.globalAlpha = fade * 0.55; ctx.lineWidth = R * 0.006; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (p.item === 'spring') drawSpring(p, x + p.ix * R, y - h / 2);
      else if (p.item === 'balloon') drawBalloon(x + p.ix * R, sy(p.y + 0.15 + Math.sin(p.t * 2) * 0.01), y - h / 2, p.t, 1);
    }
    function drawSpring(p, x, base) {
      const { R } = g, ink = inkC();
      const hh = R * (0.05 + 0.04 * p.it), ww = R * 0.03;
      ctx.beginPath(); ctx.moveTo(x, base);
      for (let i = 1; i <= 6; i++) ctx.lineTo(x + (i % 2 ? ww : -ww), base - (hh * i) / 6.5);
      ctx.lineTo(x, base - hh);
      ctx.strokeStyle = ink; ctx.lineWidth = R * 0.007; ctx.stroke();
      ctx.beginPath(); ctx.roundRect(x - R * 0.045, base - hh - R * 0.02, R * 0.09, R * 0.022, R * 0.011);
      ctx.fillStyle = vivid(THEME.c1, '#4d9bff'); ctx.fill(); ctx.lineWidth = R * 0.005; ctx.stroke();
    }
    function drawBalloon(x, y, anchorY, t, a) {
      const { R } = g, ink = inkC(), r = R * 0.07;
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.moveTo(x, y + r * 1.15);
      ctx.quadraticCurveTo(x + Math.sin(t * 3) * R * 0.03, (y + anchorY) / 2, x, anchorY);
      ctx.strokeStyle = ink; ctx.lineWidth = R * 0.004; ctx.stroke();
      blobPath(ctx, x, y, r, BLOBS[5], 0.04, 0.88, 1.08);
      ctx.fillStyle = vivid(THEME.c2, '#2ee6d6'); ctx.fill();
      ctx.lineWidth = R * 0.007; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 0.18, y + r * 1.22); ctx.lineTo(x, y + r * 1.06); ctx.lineTo(x + r * 0.18, y + r * 1.22); ctx.closePath();
      ctx.fillStyle = vivid(THEME.c2, '#2ee6d6'); ctx.fill(); ctx.stroke();
      // a little pencil shine stroke (a line, not a gloss)
      ctx.beginPath(); ctx.arc(x, y, r * 0.62, -2.6, -1.9); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = R * 0.008; ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function drawMonster(m) {
      const { R } = g, ink = inkC();
      const x = sx(m.x), y = sy(m.y + Math.sin(m.t * 3) * 0.012), r = m.r * R;
      if (y < -r * 2 || y > g.S + r * 2) return;
      ctx.save(); ctx.translate(x, y); if (m.dead) ctx.rotate(m.rot);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = ink;
      // little horns
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.7); ctx.lineTo(-r * 0.62, -r * 1.22); ctx.lineTo(-r * 0.2, -r * 0.88);
      ctx.moveTo(r * 0.55, -r * 0.7); ctx.lineTo(r * 0.62, -r * 1.22); ctx.lineTo(r * 0.2, -r * 0.88);
      ctx.lineWidth = R * 0.007; ctx.stroke();
      // wiggly feet
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        const fx = i * r * 0.45, w = Math.sin(m.t * 8 + i) * r * 0.12;
        ctx.moveTo(fx, r * 0.8); ctx.quadraticCurveTo(fx + w, r * 1.05, fx - w * 0.5, r * 1.25);
      }
      ctx.stroke();
      // the blob
      const sq = 1 + Math.sin(m.t * 6) * 0.04;
      blobPath(ctx, 0, 0, r, BLOBS[m.j], 0.1, sq, 2 - sq);
      ctx.fillStyle = m.col; ctx.fill(); ctx.lineWidth = R * 0.008; ctx.stroke();
      ctx.globalAlpha = 0.35; blobPath(ctx, r * 0.03, -r * 0.02, r * 1.02, BLOBS[(m.j + 3) % BLOBS.length], 0.12, sq, 2 - sq); ctx.stroke(); ctx.globalAlpha = 1;
      // eyes, watching the critter
      let lx = hero.x - m.x, ly = -(hero.y - m.y); const ll = Math.hypot(lx, ly) || 1; lx /= ll; ly /= ll;
      const er = r * (m.eyes === 1 ? 0.36 : 0.26);
      for (let i = 0; i < m.eyes; i++) {
        const ex = m.eyes === 1 ? 0 : (i ? 0.32 : -0.32) * r, ey = -r * 0.18;
        ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = R * 0.005; ctx.stroke();
        if (m.dead) {
          ctx.beginPath(); ctx.moveTo(ex - er * 0.5, ey - er * 0.5); ctx.lineTo(ex + er * 0.5, ey + er * 0.5); ctx.moveTo(ex + er * 0.5, ey - er * 0.5); ctx.lineTo(ex - er * 0.5, ey + er * 0.5); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(ex + lx * er * 0.45, ey + ly * er * 0.45, er * 0.45, 0, TAU); ctx.fillStyle = '#1b1b22'; ctx.fill();
        }
      }
      // a zig-zag grin
      ctx.beginPath();
      const my = r * 0.38;
      for (let i = 0; i <= 6; i++) { const mx = -r * 0.42 + (i / 6) * r * 0.84; ctx.lineTo(mx, my + (i % 2 ? r * 0.12 : 0)); }
      ctx.lineWidth = R * 0.006; ctx.stroke();
      ctx.restore();
    }

    function drawHero(x, y) {
      const { R } = g, ink = inkC(), r = PR * R, f = hero.face;
      ctx.save(); ctx.translate(x, y);
      ctx.rotate(hero.rot);
      const s = hero.squash * 0.22, stretch = hero.balloon > 0 || hero.dead ? 0 : clamp(hero.vy / V0, 0, 1) * 0.06;
      ctx.translate(0, r); ctx.scale(1 + s - stretch, 1 - s + stretch); ctx.translate(0, -r);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = ink; ctx.lineWidth = R * 0.0075;
      // legs + feet (dangle while rising, tucked as it comes down)
      const leg = r * (hero.vy > 0.6 || hero.balloon > 0 ? 0.62 : 0.42);
      ctx.beginPath();
      for (let i = -1; i <= 1; i += 2) {
        const lx = i * r * 0.36, kick = hero.balloon > 0 ? Math.sin(g.time * 14 + i) * r * 0.12 : 0;
        ctx.moveTo(lx, r * 0.75); ctx.lineTo(lx + kick, r * 0.75 + leg); ctx.lineTo(lx + kick + f * r * 0.26, r * 0.75 + leg);
      }
      ctx.stroke();
      // the sprout on its head
      ctx.beginPath(); ctx.moveTo(-f * r * 0.08, -r * 0.92); ctx.quadraticCurveTo(-f * r * 0.12, -r * 1.25, f * r * 0.08, -r * 1.38); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(f * r * 0.06, -r * 1.36);
      ctx.quadraticCurveTo(f * r * 0.42, -r * 1.62, f * r * 0.62, -r * 1.32);
      ctx.quadraticCurveTo(f * r * 0.3, -r * 1.12, f * r * 0.06, -r * 1.36);
      ctx.fillStyle = LEAF; ctx.fill(); ctx.lineWidth = R * 0.006; ctx.stroke();
      // body: a flat orange puff with a pencil outline (twice, like a sketch)
      ctx.lineWidth = R * 0.0075;
      blobPath(ctx, 0, 0, r, BLOBS[0], 0.045);
      ctx.fillStyle = BODY; ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.35; blobPath(ctx, r * 0.02, r * 0.01, r * 1.03, BLOBS[1], 0.06); ctx.stroke(); ctx.globalAlpha = 1;
      // belly patch
      ctx.beginPath(); ctx.ellipse(f * r * 0.12, r * 0.38, r * 0.5, r * 0.36, 0, 0, TAU); ctx.fillStyle = BELLY; ctx.fill();
      // cheek scribble
      ctx.beginPath(); ctx.moveTo(-f * r * 0.42, r * 0.05); ctx.lineTo(-f * r * 0.28, r * 0.12); ctx.moveTo(-f * r * 0.46, r * 0.17); ctx.lineTo(-f * r * 0.32, r * 0.24);
      ctx.lineWidth = R * 0.004; ctx.stroke(); ctx.lineWidth = R * 0.0075;
      // beak (short and pointy, towards where it's heading)
      ctx.beginPath(); ctx.moveTo(f * r * 0.78, -r * 0.2); ctx.quadraticCurveTo(f * r * 1.38, -r * 0.08, f * r * 1.45, r * 0.08); ctx.quadraticCurveTo(f * r * 1.1, r * 0.22, f * r * 0.8, r * 0.18);
      ctx.fillStyle = BEAK; ctx.fill(); ctx.stroke();
      // eyes
      const up = hero.look > 0 ? 1 : 0;
      for (let i = 0; i < 2; i++) {
        const ex = f * r * (i ? 0.55 : 0.12), ey = -r * (i ? 0.34 : 0.38), er = r * (i ? 0.2 : 0.23);
        ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = R * 0.005; ctx.stroke();
        if (hero.dead) {
          ctx.beginPath(); ctx.moveTo(ex - er * 0.55, ey - er * 0.55); ctx.lineTo(ex + er * 0.55, ey + er * 0.55); ctx.moveTo(ex + er * 0.55, ey - er * 0.55); ctx.lineTo(ex - er * 0.55, ey + er * 0.55); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(ex + f * er * 0.35 * (1 - up), ey - er * (0.1 + 0.4 * up), er * 0.48, 0, TAU); ctx.fillStyle = '#1b1b22'; ctx.fill();
        }
      }
      ctx.restore();
    }

    function drawPellets() {
      const { R } = g, ink = inkC();
      ctx.lineCap = 'round';
      for (const b of pellets) {
        if (!b.on) continue;
        const x = sx(b.x), y = sy(b.y);
        ctx.beginPath(); ctx.moveTo(x - b.vx * R * 0.02, y + b.vy * R * 0.02); ctx.lineTo(x - b.vx * R * 0.006, y + b.vy * R * 0.006);
        ctx.strokeStyle = THEME.ink(0.35); ctx.lineWidth = R * 0.008; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, R * 0.018, 0, TAU); ctx.fillStyle = vivid(THEME.c1, '#4d9bff'); ctx.fill();
        ctx.strokeStyle = ink; ctx.lineWidth = R * 0.004; ctx.stroke();
      }
    }

    g.loop((dt, t) => {
      if (!ended) update(dt, t);
      else { hero.vy -= G * dt; hero.y += hero.vy * dt; hero.rot += hero.dead ? dt * 7 : 0; }
      hintT += dt;
      const { R, cx, S } = g;
      drawPaper();
      drawMarks();
      for (const p of plats) drawPlat(p);
      for (const m of mons) drawMonster(m);
      drawPellets();
      // the critter, clipped to the page column, with its wrap-around twin near a margin
      ctx.save();
      ctx.beginPath(); ctx.rect(cx - W * R, 0, 2 * W * R, S); ctx.clip();
      const hx = sx(hero.x), hy = sy(hero.y);
      if (hero.balloon > 0) drawBalloon(hx, sy(hero.y + 0.3), hy - PR * R * 0.9, t, Math.min(1, hero.balloon * 3));
      drawHero(hx, hy);
      if (Math.abs(hero.x) > W - PR * 1.8) drawHero(hx - Math.sign(hero.x) * 2 * W * R, hy);
      ctx.restore();
      g.draw.particles(dt, R * 0.6);
      g.draw.floaters(dt);
      // first-seconds hint
      if (hintT < 5 && !(anyInput && hintT > 2.5)) {
        const a = Math.min(1, hintT * 2, (5 - hintT) * 1.5);
        const y = g.cy + R * 0.74;
        g.draw.roundRect(cx - R * 0.42, y - R * 0.055, R * 0.84, R * 0.11, R * 0.055, THEME.paper(0.55 * a));
        g.draw.text('hold ◀ ▶ to steer  ·  tap to shoot', cx, y, R * 0.04, { color: THEME.ink(0.85 * a), weight: 600, font: THEME.font });
      }
    });

    return {};
  },
};
