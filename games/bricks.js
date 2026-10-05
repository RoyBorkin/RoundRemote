// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Bricks Breaker — a round take on the "ballz" brick breakers. The launcher sits in the middle; numbered
// bricks sit on rings around it. Drag anywhere to aim (the dotted guide shows the first bounce), let go and
// the whole volley streams out. Balls bounce off bricks and the rim and are caught again when they fall
// back into the core. Then every ring moves one step in and a new, tougher ring appears at the rim —
// a brick that reaches the red danger ring ends the game. Catch white rings for more balls, and power-ups.
//
// Physics run in units of R (the screen radius) around the centre, so a resize never disturbs a volley.
import { TAU, rand, clamp, ease, THEME } from './kit.js';

const NR = 7;                    // rings 0…6; ring 0 is the danger ring (no brick may enter it)
const NS = 16;                   // sectors per ring
const W = TAU / NS;
const R0 = 0.235, RH = 0.095;    // inner radius of ring 0, ring thickness (× R)
const WALL = 0.935;              // the rim the balls bounce off
const BR = 0.017;                // ball radius
const CORE = 0.1;                // balls that fall back inside this are caught
const ARM = R0 + RH * 0.6;       // a ball has to get this far out before the core can catch it
const RC = 0.016, GAP = 0.005;   // brick corner radius, half the gap between bricks
const PR = 0.033;                // pickup radius
const SPEED = 2.05;              // ball speed, R per second
const GAP_T = 0.07;              // seconds between two balls of a volley
const WALL_DAMP = 0.6;           // the rim takes a bit of the sideways speed, so balls drift home
const STEP = BR * 0.5;           // physics sub-step (a ball never moves more than half its radius at once)

const PICKS = {
  ball:   { color: '#ffffff', name: '+1 ball' },
  ring:   { color: '#2ee6d6', name: 'Ring laser', w: 17 },
  ray:    { color: '#4d9bff', name: 'Line laser', w: 17 },
  bomb:   { color: '#ff5a6a', name: 'Bomb', w: 15 },
  power:  { color: '#ffc857', name: 'Double damage', w: 12, from: 3 },
  fire:   { color: '#ff7a3d', name: 'Fire balls', w: 9, from: 5 },
  multi:  { color: '#3ddc84', name: 'Balls ×2', w: 11, from: 4 },
  shield: { color: '#b57bff', name: 'Shield', w: 8, from: 6 },
};
// the bricks' colour ramp, low → high numbers
const RAMP = ['#ffd166', '#ffa94d', '#f97316', '#ff5a6a', '#ff4f9a', '#c06bff', '#7b7dff'].map((h) => {
  const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

const P = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];
const H = W / 2, CH = Math.cos(H), SH = Math.sin(H), D = GAP + RC;
/** A cell (ring k, sector s) as a brick: its ring sector shrunk by gap + corner radius — the brick is that
 *  shape grown by RC (round corners), so a ball touches it when its centre is within BR + RC of the shape.
 *  Ring k may be fractional (for the slide-in animation). */
function cellGeom(k, s) {
  const a = R0 + k * RH, A = a + D, B = a + RH - D, tm = s * W + H;
  const aA = H - Math.asin(D / A), aB = H - Math.asin(D / B);
  const [mx, my] = P(tm, a + RH / 2);
  return { A, B, aA, aB, tm, mx, my, Tx: Math.cos(tm), Ty: Math.sin(tm), Rx: Math.sin(tm), Ry: -Math.cos(tm),
    ca: [A * Math.sin(aA), A * Math.cos(aA)], cb: [B * Math.sin(aB), B * Math.cos(aB)] };
}
const CELLS = [];
for (let k = 0; k < NR; k++) { CELLS.push([]); for (let s = 0; s < NS; s++) CELLS[k].push(cellGeom(k, s)); }

// a contact: true normal (out of the brick, towards the ball), depth, and the normal the ball bounces off.
// On the curved inner / outer faces a ball bounces as if the face were flat (normal through the brick's
// middle), so a ball that hits a brick off-centre glances off sideways — without that, every ball fired
// from the centre would come straight back, and aiming at edges and gaps wouldn't matter.
const hit = { nx: 0, ny: 0, d: 0, bx: 0, by: 0 };
function touch(c, x, y, rad) {
  let u = x * c.Tx + y * c.Ty;
  const w = x * c.Rx + y * c.Ry, m = u < 0 ? -1 : 1;
  u *= m;
  const r = Math.hypot(u, w) || 1e-9, th = Math.atan2(u, w), e = -u * CH + w * SH;
  let nu, nw, bu, bw, dep;
  if (r >= c.A && r <= c.B && e >= D) {            // centre inside the shape: push out the shortest way
    const pa = r - c.A, pb = c.B - r, pe = e - D;
    if (pa <= pb && pa <= pe) { nu = -u / r; nw = -w / r; bu = 0; bw = -1; dep = pa + rad; }
    else if (pb <= pe) { nu = u / r; nw = w / r; bu = 0; bw = 1; dep = pb + rad; }
    else { nu = bu = CH; nw = bw = -SH; dep = pe + rad; }
  } else {
    let best = Infinity;
    if (th <= c.aA) { best = Math.abs(r - c.A); const sg = r < c.A ? -1 : 1; nu = sg * u / r; nw = sg * w / r; bu = 0; bw = sg; }
    if (th <= c.aB && Math.abs(r - c.B) < best) { best = Math.abs(r - c.B); const sg = r < c.B ? -1 : 1; nu = sg * u / r; nw = sg * w / r; bu = 0; bw = sg; }
    const [ax, ay] = c.ca, [qx, qy] = c.cb, ex = qx - ax, ey = qy - ay;
    const t = clamp(((u - ax) * ex + (w - ay) * ey) / (ex * ex + ey * ey), 0, 1);
    const px = ax + ex * t, py = ay + ey * t, dd = Math.hypot(u - px, w - py);
    if (dd < best) { best = dd; nu = bu = (u - px) / (dd || 1e-9); nw = bw = (w - py) / (dd || 1e-9); }
    if (best >= rad) return false;
    dep = rad - best;
  }
  nu *= m; bu *= m;
  hit.nx = nu * c.Tx + nw * c.Rx; hit.ny = nu * c.Ty + nw * c.Ry;
  hit.bx = bu * c.Tx + bw * c.Rx; hit.by = bu * c.Ty + bw * c.Ry;
  hit.d = dep;
  return true;
}
const angleOf = (x, y) => { const a = Math.atan2(x, -y); return a < 0 ? a + TAU : a; };

export default {
  howTo: 'Drag anywhere to aim, let go to fire the volley. Numbers are hits left; every turn the rings move in — keep the bricks off the red ring. Grab white rings for more balls.',
  scoring: 'high',
  keyRepeat: true,
  create(g) {
    const { draw } = g;
    // grid[k][s]: a brick { kind: 'brick', hp, max } or a pickup { kind: 'pick', type } or null
    const grid = Array.from({ length: NR }, () => new Array(NS).fill(null));
    let turn = 1, balls = 1, gain = 0, phase = 'aim', aim = Math.PI, aiming = false, kbT = 0;
    let shots = [], toLaunch = 0, launchT = 0, volT = 0, back = 0, recalled = false, nextId = 1, now = 0;
    let cur = { dmg: 1, fire: false, mult: 1 }, next = { dmg: false, fire: false, mult: false }, shields = 0;
    let advT = 0, doomed = [], fading = [], fx = [], shake = 0, overDone = false, coreHit = 0, recallHint = false;
    let guide = null, guideKey = '', version = 0, sfxT = {}, combo = 0;
    const colCache = new Map();

    const X = (x) => g.cx + x * g.R, Y = (y) => g.cy + y * g.R;
    const say = () => g.sub(`Turn ${turn}  ·  ${balls} ball${balls === 1 ? '' : 's'}${shields ? '  ·  shield' : ''}`);
    function snd(name, opt, gap = 0.045) { if (now - (sfxT[name] || -1) < gap) return; sfxT[name] = now; g.sfx(name, opt); }

    // ---------- colours ----------
    function rgbFor(hp) {
      const top = Math.max(4, turn * 1.25);
      const t = clamp((hp - 1) / (top - 1), 0, 1) ** 0.85 * (RAMP.length - 1);
      const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i, A = RAMP[i], B = RAMP[i + 1];
      return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
    }
    function colFor(hp, flash = 0) {
      if (!flash) {
        let c = colCache.get(hp);
        if (!c) { const [r, gg, b] = rgbFor(hp); c = `rgb(${r | 0},${gg | 0},${b | 0})`; colCache.set(hp, c); }
        return c;
      }
      const [r, gg, b] = rgbFor(hp), m = flash * 0.75;
      return `rgb(${(r + (255 - r) * m) | 0},${(gg + (255 - gg) * m) | 0},${(b + (255 - b) * m) | 0})`;
    }

    // ---------- spawning ----------
    function pickType() {
      const list = Object.entries(PICKS).filter(([id, p]) => p.w && turn >= (p.from || 1) && !(id === 'shield' && (shields || onBoard('shield'))));
      let r = rand(list.reduce((a, [, p]) => a + p.w, 0));
      for (const [id, p] of list) { r -= p.w; if (r <= 0) return id; }
      return list[0][0];
    }
    const onBoard = (type) => grid.some((row) => row.some((o) => o && o.kind === 'pick' && o.type === type));
    function spawnRing() {
      const k = NR - 1, order = [...Array(NS).keys()].sort(() => Math.random() - 0.5);
      const n = clamp(Math.round(5 + turn * 0.25 + rand(-1, 1.6)), 4, 11);
      const p2 = clamp(0.06 + turn * 0.012, 0, 0.4);
      let i = 0;
      const put = (o) => { const s = order[i++]; grid[k][s] = { ...o, k, s, vis: 1, flash: 0, pop: 0, ph: rand(TAU) }; };
      put({ kind: 'pick', type: 'ball' });
      if (turn > 1 && Math.random() < 0.3 + Math.min(0.15, turn * 0.006)) put({ kind: 'pick', type: pickType() });
      const base = Math.max(1, Math.round(turn * 0.75));
      for (let j = 0; j < n; j++) {
        const v = Math.random() < p2 ? base * 2 : Math.max(1, Math.round(base * rand(0.7, 1.2)));
        put({ kind: 'brick', hp: v, max: v });
      }
      version++;
    }

    // ---------- damage & pickups ----------
    function damage(o, n) {
      if (!o || o.kind !== 'brick' || o.hp <= 0) return;
      o.hp -= n; o.flash = 1; o.pop = 1; version++;
      if (o.hp > 0) { snd('hit', { pitch: rand(0.9, 1.15), volume: 0.6 }); return; }
      grid[o.k][o.s] = null;
      g.add(o.max);
      combo++;
      const c = CELLS[o.k][o.s], col = colFor(1);
      draw.burst(X(c.mx), Y(c.my), colFor(o.max), 9, g.R * 0.45, g.R * 0.011);
      draw.burst(X(c.mx), Y(c.my), col, 4, g.R * 0.3, g.R * 0.008);
      fx.push({ kind: 'break', k: o.k, s: o.s, col: colFor(o.max), t: 0 });
      snd('pop', { pitch: 0.8 + Math.min(1, combo * 0.03), volume: 0.8 }, 0.035);
    }
    function trigger(o) {
      const p = PICKS[o.type], c = CELLS[o.k][o.s];
      if (o.type === 'ring') {
        o.used = true; fx.push({ kind: 'ring', k: o.k, t: 0 });
        for (let s = 0; s < NS; s++) damage(grid[o.k][s], cur.dmg);
        snd('laser', undefined, 0.08); return;
      }
      if (o.type === 'ray') {
        o.used = true; fx.push({ kind: 'ray', s: o.s, t: 0 });
        for (let k = 1; k < NR; k++) damage(grid[k][o.s], cur.dmg);
        snd('laser', undefined, 0.08); return;
      }
      grid[o.k][o.s] = null; version++;
      if (o.type === 'ball') { gain++; g.sfx('coin'); draw.float('+1', X(c.mx), Y(c.my), THEME.fg, g.R * 0.06); return; }
      if (o.type === 'bomb') {
        const n = Math.max(3, turn) * cur.dmg;
        fx.push({ kind: 'boom', x: c.mx, y: c.my, t: 0 });
        draw.burst(X(c.mx), Y(c.my), p.color, 16, g.R * 0.6, g.R * 0.012);
        for (let dk = -1; dk <= 1; dk++) for (let ds = -1; ds <= 1; ds++) {
          const k = o.k + dk; if (k < 1 || k >= NR) continue;
          damage(grid[k][(o.s + ds + NS) % NS], n);
        }
        g.sfx('boom'); g.vibrate(30); shake = 0.25; return;
      }
      if (o.type === 'power') next.dmg = true;
      if (o.type === 'fire') next.fire = true;
      if (o.type === 'multi') next.mult = true;
      if (o.type === 'shield') { shields = 1; say(); }
      g.sfx('score');
      draw.burst(X(c.mx), Y(c.my), p.color, 10, g.R * 0.35, g.R * 0.01);
      g.toast(o.type === 'shield' ? 'Shield!' : `${p.name} — next turn`, 1200);
    }

    // ---------- physics ----------
    /** Deepest contact of a ball at (x, y) with the rim or a brick (for the aim guide). */
    const probeHit = { nx: 0, ny: 0, d: 0, bx: 0, by: 0, o: null };
    function probe(x, y) {
      let found = false; probeHit.d = 0;
      const r = Math.hypot(x, y);
      if (r > WALL - BR) { found = true; probeHit.nx = -x / r; probeHit.ny = -y / r; probeHit.d = r - (WALL - BR); probeHit.bx = probeHit.nx; probeHit.by = probeHit.ny; probeHit.o = null; }
      if (r + BR < R0 + RH) return found;
      const k0 = Math.max(1, Math.floor((r - BR - R0) / RH)), k1 = Math.min(NR - 1, Math.floor((r + BR - R0) / RH));
      const s0 = Math.floor(angleOf(x, y) / W);
      for (let k = k0; k <= k1; k++) for (let ds = -1; ds <= 1; ds++) {
        const s = (s0 + ds + NS) % NS, o = grid[k][s];
        if (!o || o.kind !== 'brick') continue;
        if (touch(CELLS[k][s], x, y, BR + RC) && hit.d > probeHit.d) { found = true; Object.assign(probeHit, hit); probeHit.o = o; }
      }
      return found;
    }
    /** Bounce a ball (or the guide's ghost) off the contact in `hit`; false if it's already moving away. */
    function bounce(b) {
      const vt = b.vx * hit.nx + b.vy * hit.ny;
      if (vt >= 0) return false;
      const vb = b.vx * hit.bx + b.vy * hit.by;
      if (vb < 0) {
        const vx = b.vx - 2 * vb * hit.bx, vy = b.vy - 2 * vb * hit.by;
        if (vx * hit.nx + vy * hit.ny > 0.2) { b.vx = vx; b.vy = vy; return true; }
      }
      b.vx -= 2 * vt * hit.nx; b.vy -= 2 * vt * hit.ny;
      return true;
    }
    function stepBall(b, len) {
      b.x += b.vx * len; b.y += b.vy * len;
      const r = Math.hypot(b.x, b.y);
      if (!b.armed && r > ARM) b.armed = true;
      // the core catches a ball on its second trip through the middle — the first time it flies across
      if (b.armed && r < CORE) { if (b.pass) { b.ret = true; return; } b.inCore = true; }
      else if (b.inCore && r >= CORE) { b.inCore = false; b.pass = true; b.armed = false; }
      // the rim
      if (r > WALL - BR) {
        const ux = b.x / r, uy = b.y / r, vr = b.vx * ux + b.vy * uy;
        if (vr > 0) {
          const tx = (b.vx - vr * ux) * WALL_DAMP, ty = (b.vy - vr * uy) * WALL_DAMP;
          b.vx = tx - vr * ux; b.vy = ty - vr * uy;
          const m = Math.hypot(b.vx, b.vy); b.vx /= m; b.vy /= m;
          b.armed = true;
        }
        b.x = ux * (WALL - BR); b.y = uy * (WALL - BR);
      }
      if (r + BR < R0 + RH) return;
      const k0 = Math.max(1, Math.floor((r - BR - R0) / RH)), k1 = Math.min(NR - 1, Math.floor((r + BR - R0) / RH));
      const s0 = Math.floor(angleOf(b.x, b.y) / W);
      for (let k = k0; k <= k1; k++) for (let ds = -1; ds <= 1; ds++) {
        const s = (s0 + ds + NS) % NS, o = grid[k][s];
        if (!o) continue;
        if (o.kind === 'pick') {
          const c = CELLS[k][s];
          // a laser fires once for every ball that touches it; the other pickups go on the first touch
          if ((b.x - c.mx) ** 2 + (b.y - c.my) ** 2 < (BR + PR) ** 2 && !b.zapped.includes(o)) { b.zapped.push(o); trigger(o); }
          continue;
        }
        if (!touch(CELLS[k][s], b.x, b.y, BR + RC)) continue;
        b.armed = true;
        if (b.fire) {           // fire balls burn straight through, once per brick per pass
          if (o.tag !== b.id || now - o.tagT > 0.25) { o.tag = b.id; o.tagT = now; damage(o, cur.dmg); }
          else o.tagT = now;
          continue;
        }
        b.x += hit.nx * (hit.d + 1e-4); b.y += hit.ny * (hit.d + 1e-4);
        if (bounce(b)) { b.hits++; damage(o, cur.dmg); }
      }
    }

    // ---------- the aim guide ----------
    function computeGuide() {
      const key = `${aim.toFixed(4)}|${version}`;
      if (key === guideKey) return guide;
      guideKey = key;
      const gh = { vx: Math.sin(aim), vy: -Math.cos(aim) };
      let x = 0, y = 0;
      const segs = [];
      for (let seg = 0; seg < 2; seg++) {
        const sx = x, sy = y, max = seg === 0 ? 3 : 0.32;
        let len = 0, found = false;
        while (len < max) {
          x += gh.vx * STEP; y += gh.vy * STEP; len += STEP;
          if (probe(x, y)) { found = true; break; }
        }
        segs.push([sx, sy, x, y, found]);
        if (!found) break;
        x += probeHit.nx * probeHit.d; y += probeHit.ny * probeHit.d;
        const wall = !probeHit.o;
        Object.assign(hit, probeHit); bounce(gh);
        if (wall) {          // the rim also takes some sideways speed
          const r = Math.hypot(x, y), ux = x / r, uy = y / r, vr = gh.vx * ux + gh.vy * uy;
          gh.vx = (gh.vx - vr * ux) * WALL_DAMP + vr * ux; gh.vy = (gh.vy - vr * uy) * WALL_DAMP + vr * uy;
          const m = Math.hypot(gh.vx, gh.vy); gh.vx /= m; gh.vy /= m;
        }
      }
      guide = segs;
      return guide;
    }

    // ---------- turns ----------
    function fire() {
      if (phase !== 'aim') return;
      aiming = false;
      phase = 'volley'; volT = 0; launchT = 0; back = 0; recalled = false; combo = 0;
      toLaunch = balls * cur.mult;
      g.sfx('whoosh');
    }
    function recall() {
      if (phase !== 'volley' || recalled) return;
      recalled = true;
      back += toLaunch; toLaunch = 0;
      for (const b of shots) b.ret = true;
      g.sfx('drop');
    }
    function endVolley() {
      phase = 'advance'; advT = 0;
      if (gain) { balls += gain; draw.float(`+${gain}`, g.cx, g.cy - g.R * 0.14, THEME.fg, g.R * 0.06); gain = 0; }
      doomed = []; fading = [];
      // used lasers go, then everything steps one ring in
      for (let k = 1; k < NR; k++) for (let s = 0; s < NS; s++) {
        const o = grid[k][s];
        if (o && o.used) { grid[k][s] = null; fading.push({ ...o, t: 0 }); }
      }
      let left = 0;
      for (let k = 1; k < NR; k++) for (let s = 0; s < NS; s++) {
        const o = grid[k][s]; if (!o) continue;
        grid[k][s] = null; o.k = k - 1; o.vis = 1;
        if (o.kind === 'brick') left++;
        if (o.k === 0) { if (o.kind === 'brick') doomed.push(o); else fading.push({ ...o, t: 0 }); }
        else grid[o.k][s] = o;
      }
      if (doomed.length && shields) {   // the shield blasts away whatever reached the danger ring
        shields = 0;
        fx.push({ kind: 'shield', t: 0 });
        for (const o of doomed) { const c = CELLS[1][o.s]; draw.burst(X(c.mx), Y(c.my), PICKS.shield.color, 8, g.R * 0.4, g.R * 0.01); }
        doomed = [];
        g.toast('Shield saved you!', 1300); g.sfx('boom');
      }
      if (!doomed.length) {
        if (!left && turn > 1) { g.toast('Clear!', 900); g.add(turn * 10); g.sfx('perfect'); }
        turn++;
        colCache.clear();
        spawnRing();
        g.add(10); g.sfx('place');
      }
      cur = { dmg: next.dmg ? 2 : 1, fire: next.fire, mult: next.mult ? 2 : 1 };
      next = { dmg: false, fire: false, mult: false };
      version++;
      say();
    }

    // ---------- input ----------
    g.on('down', (p) => {
      if (phase === 'aim' || phase === 'advance') { aiming = true; if (p.r > 0.05) aim = p.a; return; }
      if (phase === 'volley' && volT > 2.5 && p.r < 0.2) recall();
    });
    g.on('move', (p) => { if (aiming && p.r > 0.05) aim = p.a; });
    g.on('up', (p) => {
      if (!aiming) return;
      aiming = false;
      if (phase !== 'aim') return;
      if (p.r < 0.07) { g.sfx('tick'); return; }   // let go on the launcher: cancel
      aim = p.a; fire();
    });
    const turnAim = (deg) => { aim = (aim + deg * Math.PI / 180 + TAU) % TAU; kbT = 1.6; if (phase === 'aim') snd('tick', undefined, 0.06); };
    g.on('key', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') turnAim(-2);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') turnAim(2);
      else if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        if (phase === 'aim') fire();
        else if (phase === 'volley' && volT > 2.5) recall();
      }
    });
    g.on('wheel', (e) => turnAim(e.delta * 2));

    // ---------- start ----------
    spawnRing();
    phase = 'advance';                               // the first ring slides in
    say();
    g.toast('Drag to aim · let go to fire', 1800);

    // ---------- drawing helpers ----------
    /** The brick's core shape; filled and stroked 2·RC wide with round joins it is exactly the brick. */
    function cellPath(c) {
      const { ctx } = g, t = c.tm - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, c.A * g.R, t - c.aA, t + c.aA);
      ctx.arc(g.cx, g.cy, c.B * g.R, t + c.aB, t - c.aB, true);
      ctx.closePath();
    }
    function drawBrick(o, kf, alpha = 1, warn = 0) {
      const { ctx } = g;
      const cell = o.vis || kf !== o.k ? cellGeom(kf, o.s) : CELLS[o.k][o.s];
      ctx.globalAlpha = alpha;
      if (warn) {
        cellPath(cell); ctx.lineWidth = (2 * RC + 0.012) * g.R; ctx.strokeStyle = `rgba(255,90,106,${warn})`; ctx.stroke();
      }
      cellPath(cell);
      ctx.lineWidth = 2 * RC * g.R;
      ctx.fillStyle = ctx.strokeStyle = colFor(Math.max(1, o.hp), o.flash);
      ctx.fill(); ctx.stroke();
      const digits = String(Math.max(0, o.hp)).length;
      const fs = g.R * (digits <= 2 ? 0.042 : digits === 3 ? 0.036 : 0.03) * (1 + 0.35 * ease.out(o.pop));
      ctx.font = `700 ${fs}px ${g.theme.display}`;
      ctx.fillStyle = 'rgba(14,9,6,.9)';
      ctx.fillText(String(o.hp), X(cell.mx), Y(cell.my) + fs * 0.04);
      ctx.globalAlpha = 1;
    }
    function glyph(type, x, y, r, a) {
      const { ctx } = g;
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = ctx.strokeStyle = '#111114'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = r * 0.2;
      if (type === 'ring' || type === 'ray') {   // a double arrow: along the ring, or along the radius
        ctx.rotate(a + (type === 'ray' ? Math.PI / 2 : 0));
        const L = r * 0.58, hd = r * 0.26;
        ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L, 0);
        ctx.moveTo(-L + hd, -hd); ctx.lineTo(-L, 0); ctx.lineTo(-L + hd, hd);
        ctx.moveTo(L - hd, -hd); ctx.lineTo(L, 0); ctx.lineTo(L - hd, hd); ctx.stroke();
      } else if (type === 'bomb') {   // a little burst
        ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, TAU); ctx.fill();
        ctx.lineWidth = r * 0.14; ctx.beginPath();
        for (let i = 0; i < 8; i++) { const t = (i / 8) * TAU; ctx.moveTo(Math.cos(t) * r * 0.42, Math.sin(t) * r * 0.42); ctx.lineTo(Math.cos(t) * r * 0.62, Math.sin(t) * r * 0.62); }
        ctx.stroke();
      } else if (type === 'power') {  // a bolt
        ctx.beginPath(); const s = r * 0.62;
        ctx.moveTo(0.15 * s, -1 * s); ctx.lineTo(-0.5 * s, 0.12 * s); ctx.lineTo(-0.02 * s, 0.12 * s); ctx.lineTo(-0.15 * s, 1 * s);
        ctx.lineTo(0.5 * s, -0.15 * s); ctx.lineTo(0.02 * s, -0.15 * s); ctx.closePath(); ctx.fill();
      } else if (type === 'fire') {   // a flame
        const s = r * 0.6; ctx.beginPath();
        ctx.moveTo(0, -s); ctx.bezierCurveTo(s * 0.9, -s * 0.1, s * 0.75, s * 0.85, 0, s * 0.85);
        ctx.bezierCurveTo(-s * 0.75, s * 0.85, -s * 0.9, -s * 0.1, 0, -s); ctx.fill();
      } else if (type === 'multi') {  // ×2
        ctx.font = `700 ${r * 0.95}px ${g.theme.display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('×2', 0, r * 0.05);
      } else if (type === 'shield') { // a shield
        const s = r * 0.6; ctx.beginPath();
        ctx.moveTo(0, -s); ctx.lineTo(s * 0.8, -s * 0.6); ctx.quadraticCurveTo(s * 0.75, s * 0.6, 0, s);
        ctx.quadraticCurveTo(-s * 0.75, s * 0.6, -s * 0.8, -s * 0.6); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    function drawPick(o, kf, alpha = 1, scale = 1) {
      const { ctx } = g;
      const a = o.s * W + W / 2, rr = R0 + (kf + 0.5) * RH;
      const [px, py] = P(a, rr), x = X(px), y = Y(py);
      const pulse = 1 + 0.07 * Math.sin(now * 5 + o.ph);
      const r = PR * g.R * scale * pulse;
      ctx.globalAlpha = alpha;
      if (o.type === 'ball') {        // the classic white ring
        ctx.beginPath(); ctx.arc(x, y, r * 0.78, 0, TAU);
        ctx.strokeStyle = THEME.fg; ctx.lineWidth = g.R * 0.011; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, r * 0.26, 0, TAU); ctx.fillStyle = THEME.fg; ctx.fill();
      } else {
        const p = PICKS[o.type];
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = p.color; ctx.fill();
        if (o.used) { ctx.lineWidth = g.R * 0.006; ctx.strokeStyle = THEME.fg; ctx.stroke(); }
        glyph(o.type, x, y, r, a);
      }
      ctx.globalAlpha = 1;
    }
    function drawGuide(alpha) {
      const { ctx } = g, segs = computeGuide();
      const dot = g.R * 0.0075, gap = 0.032;
      ctx.fillStyle = THEME.fg;
      segs.forEach(([x0, y0, x1, y1, found], i) => {
        const L = Math.hypot(x1 - x0, y1 - y0); if (L < 1e-6) return;
        const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
        for (let d = i === 0 ? CORE + 0.02 : gap; d < L - BR * 0.5; d += gap) {
          ctx.globalAlpha = alpha * (i === 0 ? 1 : Math.max(0, 1 - d / 0.32) * 0.8);
          ctx.beginPath(); ctx.arc(X(x0 + ux * d), Y(y0 + uy * d), i === 0 ? dot : dot * 0.85, 0, TAU); ctx.fill();
        }
        if (i === 0 && found) {         // ghost ball at the first contact
          ctx.globalAlpha = alpha;
          ctx.beginPath(); ctx.arc(X(x1), Y(y1), BR * g.R, 0, TAU);
          ctx.lineWidth = g.R * 0.005; ctx.strokeStyle = THEME.fg; ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
    }
    function badge(type, x, y, r, alpha) {
      const { ctx } = g;
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = PICKS[type].color; ctx.fill();
      glyph(type, x, y, r, Math.PI / 2);
      ctx.globalAlpha = 1;
    }

    // ---------- the frame ----------
    g.loop((dt) => {
      const { ctx, R } = g;
      now += dt;
      kbT = Math.max(0, kbT - dt);
      shake = Math.max(0, shake - dt);
      coreHit = Math.max(0, coreHit - dt * 3);

      // ---- update ----
      if (phase === 'volley') {
        volT += dt;
        const boost = volT < 4 ? 1 : 1 + Math.min(1.5, (volT - 4) * 0.35);   // long volleys speed up
        launchT -= dt;
        while (toLaunch > 0 && launchT <= 0) {
          shots.push({ id: nextId++, x: 0, y: 0, vx: Math.sin(aim), vy: -Math.cos(aim), armed: false, ret: false, pass: false, inCore: false, fire: cur.fire, age: 0, hits: 0, zapped: [] });
          toLaunch--; launchT += GAP_T / Math.min(boost, 1.6);
        }
        const len = SPEED * boost * dt, n = Math.max(1, Math.ceil(len / STEP)), step = len / n;
        for (let i = shots.length - 1; i >= 0; i--) {
          const b = shots[i];
          b.age += dt;
          if (b.ret) {                 // flying home into the launcher
            const r = Math.hypot(b.x, b.y), mv = Math.min(r, (recalled ? 3 : 1.6) * dt * (1 + boost) * 0.5 + r * dt * 8);
            if (r < 0.012) { shots.splice(i, 1); back++; coreHit = 1; continue; }
            b.x -= (b.x / r) * mv; b.y -= (b.y / r) * mv;
            continue;
          }
          if (b.age > 5) {            // a ball that's been out for ages gets pulled home
            const r = Math.hypot(b.x, b.y) || 1, k = Math.min(1, (b.age - 5) * 0.4) * dt * 4;
            b.vx -= (b.x / r) * k; b.vy -= (b.y / r) * k;
            const m = Math.hypot(b.vx, b.vy); b.vx /= m; b.vy /= m;
          }
          for (let j = 0; j < n && !b.ret; j++) stepBall(b, step);
        }
        if (volT > 20) recall();       // nobody wants to watch one ball rattle around forever
        if (volT > 2.5 && !recallHint && (shots.length || toLaunch)) { recallHint = true; g.toast('Tap the centre to recall', 1500); }
        if (!toLaunch && !shots.length) endVolley();
      } else if (phase === 'advance') {
        advT += dt;
        const k = 1 - ease.out(clamp(advT / 0.45, 0, 1));
        for (const row of grid) for (const o of row) if (o) o.vis = k;
        for (const o of doomed) o.vis = k;
        if (advT >= 0.45) {
          for (const row of grid) for (const o of row) if (o) o.vis = 0;
          if (doomed.length) {
            if (!overDone) {
              overDone = true; phase = 'over';
              g.vibrate(60); shake = 0.4;
              draw.burst(g.cx, g.cy, '#ff5a6a', 26, R * 0.7, R * 0.014);
              g.over(g.scoreValue, { note: `The bricks reached the core on turn ${turn} · ${balls} balls`, label: `Turn ${turn}`, delay: 1500 });
            }
          } else phase = 'aim';
        }
      }
      for (const row of grid) for (const o of row) if (o && o.kind === 'brick') { o.flash = Math.max(0, o.flash - dt * 6); o.pop = Math.max(0, o.pop - dt * 4); }
      for (let i = fx.length - 1; i >= 0; i--) if ((fx[i].t += dt) > 0.5) fx.splice(i, 1);
      for (let i = fading.length - 1; i >= 0; i--) if ((fading[i].t += dt) > 0.4) fading.splice(i, 1);

      // ---- draw ----
      draw.bg({ glow: 0.1, ring: false });
      ctx.save();
      if (shake) ctx.translate(rand(-1, 1) * shake * R * 0.03, rand(-1, 1) * shake * R * 0.03);
      const danger = grid[1].some((o) => o && o.kind === 'brick');
      const pulse = 0.5 + 0.5 * Math.sin(now * 6);
      // the danger ring
      ctx.beginPath(); ctx.arc(g.cx, g.cy, (R0 + RH / 2) * R, 0, TAU);
      ctx.lineWidth = RH * R; ctx.strokeStyle = `rgba(255,90,106,${phase === 'over' ? 0.18 + 0.12 * pulse : danger ? 0.05 + 0.06 * pulse : 0.035})`; ctx.stroke();
      ctx.save();
      if (shields) {
        ctx.beginPath(); ctx.arc(g.cx, g.cy, (R0 + RH) * R, 0, TAU);
        ctx.lineWidth = R * 0.012; ctx.strokeStyle = PICKS.shield.color; ctx.globalAlpha = 0.75 + 0.25 * pulse; ctx.stroke();
      } else {
        ctx.setLineDash([R * 0.018, R * 0.022]); ctx.lineDashOffset = -now * R * 0.03;
        ctx.beginPath(); ctx.arc(g.cx, g.cy, (R0 + RH) * R, 0, TAU);
        ctx.lineWidth = R * 0.006; ctx.strokeStyle = `rgba(255,90,106,${danger ? 0.5 + 0.4 * pulse : 0.38})`; ctx.stroke();
      }
      ctx.restore();
      // the rim
      ctx.beginPath(); ctx.arc(g.cx, g.cy, WALL * R, 0, TAU);
      ctx.lineWidth = Math.max(1, R * 0.008); ctx.strokeStyle = THEME.ink(0.16); ctx.stroke();

      // bricks and pickups (clipped to the rim, so a new ring slides in from outside)
      ctx.save();
      ctx.beginPath(); ctx.arc(g.cx, g.cy, WALL * R, 0, TAU); ctx.clip();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      for (let k = 1; k < NR; k++) for (const o of grid[k]) {
        if (!o || o.kind !== 'brick') continue;
        drawBrick(o, o.k + o.vis, 1, o.k === 1 && phase === 'aim' ? 0.35 + 0.5 * pulse : 0);
      }
      for (const o of doomed) drawBrick(o, o.k + o.vis, 1, 0.6 + 0.4 * pulse);
      for (let k = 1; k < NR; k++) for (const o of grid[k]) if (o && o.kind === 'pick') drawPick(o, o.k + o.vis);
      for (const o of fading) drawPick(o, o.k, 1 - o.t / 0.4, 1 + o.t);
      ctx.restore();
      // a soft dark scrim under the score at the top, so it stays readable over the bricks
      ctx.save();
      ctx.translate(g.cx, g.cy - R * 0.635); ctx.scale(1, 0.5);
      if (THEME.flat) {               // flat themes: a solid patch of the background colour instead of a soft gradient
        ctx.fillStyle = THEME.paper(0.82); ctx.beginPath(); ctx.arc(0, 0, R * 0.25, 0, TAU); ctx.fill();
      } else {
        const scrim = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.34);
        scrim.addColorStop(0, THEME.paper(0.8)); scrim.addColorStop(0.6, THEME.paper(0.6)); scrim.addColorStop(1, THEME.paper(0));
        ctx.fillStyle = scrim; ctx.beginPath(); ctx.arc(0, 0, R * 0.34, 0, TAU); ctx.fill();
      }
      ctx.restore();

      // effects: lasers, bomb waves, broken-brick outlines, the shield wave
      for (const f of fx) {
        const k = 1 - f.t / 0.5;
        if (f.kind === 'ring') {
          ctx.beginPath(); ctx.arc(g.cx, g.cy, (R0 + (f.k + 0.5) * RH) * R, 0, TAU);
          ctx.strokeStyle = draw.alpha(PICKS.ring.color, 0.25 * k); ctx.lineWidth = R * 0.05 * k; ctx.stroke();
          ctx.strokeStyle = draw.alpha(THEME.light ? PICKS.ring.color : '#ffffff', k); ctx.lineWidth = R * 0.012 * k; ctx.stroke();
        } else if (f.kind === 'ray') {
          const a = f.s * W + W / 2, [x0, y0] = P(a, R0 + RH), [x1, y1] = P(a, WALL);
          ctx.save(); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1));
          ctx.strokeStyle = draw.alpha(PICKS.ray.color, 0.3 * k); ctx.lineWidth = R * 0.05 * k; ctx.stroke();
          ctx.strokeStyle = draw.alpha(THEME.light ? PICKS.ray.color : '#ffffff', k); ctx.lineWidth = R * 0.012 * k; ctx.stroke(); ctx.restore();
        } else if (f.kind === 'boom') {
          ctx.beginPath(); ctx.arc(X(f.x), Y(f.y), R * (0.04 + 0.22 * ease.out(f.t / 0.5)), 0, TAU);
          ctx.lineWidth = R * 0.014 * k; ctx.strokeStyle = draw.alpha(PICKS.bomb.color, k); ctx.stroke();
        } else if (f.kind === 'break') {
          if (f.t > 0.22) continue;
          const e = f.t / 0.22, c = cellGeom(f.k, f.s);
          ctx.save(); ctx.globalAlpha = 1 - e;
          ctx.translate(X(c.mx), Y(c.my)); ctx.scale(1 + e * 0.25, 1 + e * 0.25); ctx.translate(-X(c.mx), -Y(c.my));
          cellPath(c); ctx.lineJoin = 'round'; ctx.lineWidth = 2 * RC * R; ctx.fillStyle = ctx.strokeStyle = THEME.fg; ctx.fill(); ctx.stroke();
          ctx.restore();
        } else if (f.kind === 'shield') {
          ctx.beginPath(); ctx.arc(g.cx, g.cy, (R0 + RH) * R * (1 + 0.6 * ease.out(f.t / 0.5)), 0, TAU);
          ctx.lineWidth = R * 0.02 * k; ctx.strokeStyle = draw.alpha(PICKS.shield.color, k); ctx.stroke();
        }
      }

      // the aim guide
      if (phase === 'aim') drawGuide(aiming ? 0.9 : kbT ? 0.75 : 0.32 + 0.1 * pulse);

      // the launcher
      const recallable = phase === 'volley' && volT > 2.5 && !recalled;
      ctx.beginPath(); ctx.arc(g.cx, g.cy, CORE * R, 0, TAU);
      ctx.fillStyle = recallable ? draw.alpha(g.color, 0.14 + 0.1 * pulse) : THEME.ink(0.05 + 0.05 * coreHit); ctx.fill();
      ctx.lineWidth = R * 0.007; ctx.strokeStyle = draw.alpha(g.color, 0.55 + 0.3 * coreHit); ctx.stroke();
      if (recallable) {                // inward chevrons: tap to call the balls home
        ctx.save(); ctx.strokeStyle = THEME.fg; ctx.lineWidth = R * 0.008; ctx.lineCap = ctx.lineJoin = 'round';
        const rr = CORE * R * (0.62 - 0.08 * pulse), w = CORE * R * 0.18;
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + Math.PI / 4, ux = Math.sin(a), uy = -Math.cos(a), tx = -uy, ty = ux;
          const x = g.cx + ux * rr, y = g.cy + uy * rr;
          ctx.beginPath(); ctx.moveTo(x + tx * w + ux * w * 0.6, y + ty * w + uy * w * 0.6); ctx.lineTo(x, y); ctx.lineTo(x - tx * w + ux * w * 0.6, y - ty * w + uy * w * 0.6); ctx.stroke();
        }
        ctx.restore();
      }
      const waiting = phase === 'volley' ? toLaunch : phase === 'over' ? 0 : balls * cur.mult;
      if ((waiting > 0 || phase !== 'volley') && !recallable) {
        if (phase !== 'over') draw.ball(g.cx, g.cy, BR * R * 1.15, cur.fire ? PICKS.fire.color : THEME.fg);
        draw.text(`×${phase === 'volley' ? toLaunch : balls * cur.mult}`, g.cx, g.cy + CORE * R * 0.55, R * 0.034, { color: THEME.ink(0.8) });
      }
      // power-ups ready for this volley (bright) and won for the next one (faint)
      const badges = [];
      if (phase !== 'volley') { if (cur.dmg > 1) badges.push(['power', 1]); if (cur.fire) badges.push(['fire', 1]); if (cur.mult > 1) badges.push(['multi', 1]); }
      else { if (cur.dmg > 1) badges.push(['power', 0.9]); if (cur.fire) badges.push(['fire', 0.9]); if (cur.mult > 1) badges.push(['multi', 0.9]); }
      if (next.dmg) badges.push(['power', 0.45]); if (next.fire) badges.push(['fire', 0.45]); if (next.mult) badges.push(['multi', 0.45]);
      badges.forEach(([type, al], i) => {
        const a = Math.PI + (i - (badges.length - 1) / 2) * 0.42, [bx, by] = P(a, CORE + 0.055);
        badge(type, X(bx), Y(by), R * 0.024, al);
      });

      // the balls
      for (const b of shots) {
        const r = b.ret ? BR * R * clamp(Math.hypot(b.x, b.y) / CORE, 0.4, 1) : BR * R;
        if (b.fire) { draw.ball(X(b.x), Y(b.y), r * 1.15, PICKS.fire.color); draw.ball(X(b.x), Y(b.y), r * 0.55, '#ffd166'); }
        else draw.ball(X(b.x), Y(b.y), r, THEME.fg);
      }
      ctx.restore();
      draw.particles(dt);
      draw.floaters(dt);
    });
    return {};
  },
};
