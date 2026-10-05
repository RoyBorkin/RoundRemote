// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Stack — an isometric tower of slabs. A new slab slides back and forth over the top (alternating
// axes); tap to drop it. Whatever hangs over the slab below is sliced off and tumbles away, so the
// tower gets narrower. Land it (almost) exactly for a "Perfect": nothing is cut, and from five
// perfects in a row the slab even grows back a little. Miss the tower completely and it's over.
import { clamp, lerp, rand, THEME } from './kit.js';

const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
const H = 0.16;        // slab thickness (world units — the base slab is 1 × 1)
const RANGE = 1.3;     // how far the sliding slab travels either side of the tower
const TOL = 0.035;     // perfect-drop tolerance (world units)
const GROW = 0.08;     // how much a long perfect streak gives back

/** hsl → [r, g, b] (0…255). */
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}
const rgb = (c, k = 1, a = 1) => `rgba(${clamp(c[0] * k, 0, 255) | 0},${clamp(c[1] * k, 0, 255) | 0},${clamp(c[2] * k, 0, 255) | 0},${a})`;
// #ffd23f is hsl(46°, 100%, 62%) — start there and drift slowly round the colour wheel
const slabColor = (i) => hsl(46 + i * 4.5, 88 + 12 * Math.cos(i * 0.09), 62 - 5 * Math.sin(i * 0.05) ** 2);

// a box's 8 corners: index bits x=1, y=2, z=4; faces as corner cycles + their outward normal
const FACES = [
  { c: [1, 3, 7, 5], n: [1, 0, 0] }, { c: [0, 2, 6, 4], n: [-1, 0, 0] },
  { c: [2, 3, 7, 6], n: [0, 1, 0] }, { c: [0, 1, 5, 4], n: [0, -1, 0] },
  { c: [4, 5, 7, 6], n: [0, 0, 1] }, { c: [0, 1, 3, 2], n: [0, 0, -1] },
];
const LIGHT_TOP = 1, LIGHT_LEFT = 0.8, LIGHT_RIGHT = 0.6; // +y, +z (lower left on screen), +x (lower right)
const shadeOf = (nx, ny, nz) =>
  (ny > 0 ? LIGHT_TOP : 0.35) * ny * ny + (nx > 0 ? LIGHT_RIGHT : 0.35) * nx * nx + (nz > 0 ? LIGHT_LEFT : 0.35) * nz * nz;

export default {
  howTo: 'Tap to drop the sliding block on the tower. Anything hanging over is cut off — land it perfectly to keep it whole.',
  scoring: 'high',
  create(g) {
    const slabs = [{ x: 0, z: 0, w: 1, d: 1, col: slabColor(0), flash: 0 }]; // slabs[0] is the base
    const debris = [], ripples = [];
    let cur = null;                       // the sliding slab
    let streak = 0, bestStreak = 0, perfects = 0, alive = true, endT = 0;
    const cam = { u: 0, v: 0, s: 0.4, anchor: 0.05 };   // s and anchor are × R
    const pts = new Float32Array(16);     // scratch: projected corners of a tumbling box

    const level = () => slabs.length - 1;               // slabs placed so far (= score)
    const top = () => slabs[slabs.length - 1];
    const speed = () => Math.min(3.7, 1.55 + level() * 0.035);

    function spawn() {
      const n = level() + 1, t = top();
      const axis = n % 2 ? 'x' : 'z';
      cur = { axis, x: t.x, z: t.z, w: t.w, d: t.d, dir: 1, col: slabColor(n), age: 0 };
      cur[axis] = t[axis] - RANGE;
    }
    spawn();
    g.score(0);

    // ---------------------------------------------------------------- drop
    function drop() {
      if (!alive || !cur) return;
      const t = top(), ax = cur.axis, size = ax === 'x' ? 'w' : 'd';
      const delta = cur[ax] - t[ax];
      const yb = level() * H;              // bottom of the new slab
      if (Math.abs(delta) <= TOL) {        // ---- perfect
        streak++; perfects++; bestStreak = Math.max(bestStreak, streak);
        const s = { x: t.x, z: t.z, w: cur.w, d: cur.d, col: cur.col, flash: 1 };
        if (streak >= 5 && s[size] < 1) { s[size] = Math.min(1, s[size] + GROW); s.grow = 1; }
        slabs.push(s);
        for (let i = 0; i < Math.min(3, Math.ceil(streak / 2)); i++) ripples.push({ x: s.x, z: s.z, w: s.w, d: s.d, y: yb, t: -i * 0.12 });
        g.sfx('perfect', { pitch: 1 + Math.min(10, streak - 1) * 0.06 });
        g.vibrate(15);
        const [px, py] = proj(s.x, yb + H, s.z);
        g.draw.float(streak > 1 ? `Perfect ×${streak}` : 'Perfect', px, py - g.R * 0.16, THEME.fg, g.R * 0.075);
        if (s.grow) g.draw.burst(px, py, rgb(s.col), 16, g.R * 0.45, g.R * 0.01);
      } else {
        const over = Math.abs(delta), keep = cur[size] - over;
        if (keep <= 0) { miss(); return; }
        streak = 0;
        const s = { x: cur.x, z: cur.z, w: cur.w, d: cur.d, col: cur.col, flash: 0.35 };
        s[size] = keep; s[ax] = t[ax] + delta / 2;
        slabs.push(s);
        // the sliced-off part
        const side = Math.sign(delta);
        const c = { x: cur.x, z: cur.z, w: cur.w, d: cur.d };
        c[size] = over; c[ax] = s[ax] + side * (keep / 2 + over / 2);
        addDebris(c, yb, cur.col, ax, side);
        g.sfx('place', { pitch: 1 + Math.random() * 0.1 });
        g.vibrate(8);
      }
      g.score(level());
      g.sub(streak >= 2 ? `Perfect streak ${streak}` : '');
      spawn();
    }
    function addDebris(c, y, col, axis, side) {
      debris.push({ ...c, y: y + H / 2, col, axis, side, vy: 0, vh: side * 0.55, rot: 0, vr: side * rand(2.4, 3.6), t: 0,
        behind: side < 0 });
    }
    function miss() {
      alive = false; streak = 0;
      addDebris({ x: cur.x, z: cur.z, w: cur.w, d: cur.d }, level() * H, cur.col, cur.axis, Math.sign(cur[cur.axis] - top()[cur.axis]) || 1);
      cur = null;
      g.sfx('drop'); g.vibrate(40);
      const n = level();
      g.over(n, {
        title: n >= 50 ? 'What a tower!' : 'Game over',
        note: perfects ? `${perfects} perfect drop${perfects === 1 ? '' : 's'} · best streak ${bestStreak}` : `${n} block${n === 1 ? '' : 's'} high`,
        delay: 1900,
      });
    }

    g.on('down', drop);
    g.on('key', (e) => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') drop(); });

    // ---------------------------------------------------------------- projection
    // world (x, y, z) → screen; the camera keeps the tower top near the centre of the circle
    function proj(x, y, z) {
      const s = cam.s * g.R;
      return [g.cx + ((x - z) * C30 - cam.u) * s, g.cy + cam.anchor * g.R + ((x + z) * S30 - y - cam.v) * s];
    }
    const PX = (x, z) => g.cx + ((x - z) * C30 - cam.u) * cam.s * g.R;
    const PY = (x, y, z) => g.cy + cam.anchor * g.R + ((x + z) * S30 - y - cam.v) * cam.s * g.R;
    const mv = (x, y, z) => g.ctx.moveTo(PX(x, z), PY(x, y, z));
    const ln = (x, y, z) => g.ctx.lineTo(PX(x, z), PY(x, y, z));

    /** An axis-aligned slab: top, left (+z) and right (+x) faces. */
    function slab(s, y0, y1, k = 1, alpha = 1, glow = 0) {
      const { ctx } = g;
      const x0 = s.x - s.w / 2, x1 = s.x + s.w / 2, z0 = s.z - s.d / 2, z1 = s.z + s.d / 2;
      ctx.save();
      if (glow && THEME.glow) { ctx.shadowColor = rgb(s.col, 1, 0.55); ctx.shadowBlur = glow; }
      ctx.globalAlpha = alpha;
      // right (+x)
      ctx.beginPath(); mv(x1, y0, z0); ln(x1, y1, z0); ln(x1, y1, z1); ln(x1, y0, z1); ctx.closePath();
      ctx.fillStyle = rgb(s.col, LIGHT_RIGHT * k); ctx.fill();
      ctx.shadowBlur = 0;
      // left (+z)
      ctx.beginPath(); mv(x0, y0, z1); ln(x1, y0, z1); ln(x1, y1, z1); ln(x0, y1, z1); ctx.closePath();
      ctx.fillStyle = rgb(s.col, LIGHT_LEFT * k); ctx.fill();
      // top
      const f = s.flash || 0;
      ctx.beginPath(); mv(x0, y1, z0); ln(x1, y1, z0); ln(x1, y1, z1); ln(x0, y1, z1); ctx.closePath();
      ctx.fillStyle = f > 0 ? rgb(s.col.map((c) => lerp(c, 255, f * 0.7)), k) : rgb(s.col, k); ctx.fill();
      // thin light edges along the front of the top face
      ctx.beginPath(); mv(x0, y1, z1); ln(x1, y1, z1); ln(x1, y1, z0);
      ctx.strokeStyle = `rgba(255,255,255,${0.28 * k})`; ctx.lineWidth = Math.max(1, g.R * 0.004); ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
    }

    /** A tumbling piece: rotate its corners around the cut axis and draw the faces that look at us. */
    function tumbling(p) {
      const { ctx } = g;
      const hx = p.w / 2, hy = H / 2, hz = p.d / 2, c = Math.cos(p.rot), sn = Math.sin(p.rot);
      const rotN = (x, y, z) => (p.axis === 'x' ? [x * c + y * sn, -x * sn + y * c, z] : [x, y * c - z * sn, y * sn + z * c]);
      for (let i = 0; i < 8; i++) {
        const [x, y, z] = rotN(i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz);
        pts[i * 2] = PX(p.x + x, p.z + z); pts[i * 2 + 1] = PY(p.x + x, p.y + y, p.z + z);
      }
      ctx.save();
      ctx.globalAlpha = clamp(1.4 - p.t * 0.9, 0, 1);
      for (const f of FACES) {
        const [nx, ny, nz] = rotN(f.n[0], f.n[1], f.n[2]);
        if (nx + ny + nz <= 0.001) continue;          // facing away
        ctx.beginPath();
        ctx.moveTo(pts[f.c[0] * 2], pts[f.c[0] * 2 + 1]);
        for (let j = 1; j < 4; j++) ctx.lineTo(pts[f.c[j] * 2], pts[f.c[j] * 2 + 1]);
        ctx.closePath(); ctx.fillStyle = rgb(p.col, shadeOf(nx, ny, nz)); ctx.fill();
      }
      ctx.restore();
    }

    function ripple(r) {
      const { ctx } = g;
      if (r.t < 0) return;
      const e = 0.04 + ease(r.t / 0.7) * 0.32, a = 1 - r.t / 0.7;
      const x0 = r.x - r.w / 2 - e, x1 = r.x + r.w / 2 + e, z0 = r.z - r.d / 2 - e, z1 = r.z + r.d / 2 + e;
      ctx.save();
      ctx.beginPath(); mv(x0, r.y, z0); ln(x1, r.y, z0); ln(x1, r.y, z1); ln(x0, r.y, z1); ctx.closePath();
      ctx.strokeStyle = THEME.ink(0.85 * a); ctx.lineWidth = g.R * 0.009 * (0.5 + a * 0.5); ctx.lineJoin = 'round';
      if (THEME.glow) { ctx.shadowColor = THEME.fg; ctx.shadowBlur = 10 * a; }
      ctx.stroke();
      ctx.restore();
    }
    const ease = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;

    /** The base: a tall pedestal under slab 0 that fades into the background (solid in flat themes). */
    function pedestal() {
      const { ctx, R } = g;
      const b = slabs[0], x0 = -0.5, x1 = 0.5, z0 = -0.5, z1 = 0.5, y1 = 0, y0 = -14;
      const yTop = PY(0, 0, 0), fadeTo = yTop + R * 0.9 * (cam.s / 0.4);
      ctx.save();
      const grad = (k) => { if (THEME.flat) return rgb(b.col, k); const gr = ctx.createLinearGradient(0, yTop, 0, fadeTo); gr.addColorStop(0, rgb(b.col, k)); gr.addColorStop(0.12, rgb(b.col, k * 0.55)); gr.addColorStop(1, rgb(b.col, k * 0.12, 0)); return gr; };
      ctx.beginPath(); mv(x1, y0, z0); ln(x1, y1, z0); ln(x1, y1, z1); ln(x1, y0, z1); ctx.closePath(); ctx.fillStyle = grad(LIGHT_RIGHT); ctx.fill();
      ctx.beginPath(); mv(x0, y0, z1); ln(x1, y0, z1); ln(x1, y1, z1); ln(x0, y1, z1); ctx.closePath(); ctx.fillStyle = grad(LIGHT_LEFT); ctx.fill();
      ctx.beginPath(); mv(x0, y1, z0); ln(x1, y1, z0); ln(x1, y1, z1); ln(x0, y1, z1); ctx.closePath(); ctx.fillStyle = rgb(b.col, 1); ctx.fill();
      ctx.beginPath(); mv(x0, y1, z1); ln(x1, y1, z1); ln(x1, y1, z0);
      ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = Math.max(1, R * 0.004); ctx.stroke();
      ctx.restore();
    }

    // ---------------------------------------------------------------- frame
    g.loop((dt) => {
      const { ctx, R } = g;
      // ---- update ----
      if (cur) {
        cur.age += dt;
        const ax = cur.axis, base = top()[ax];
        cur[ax] += cur.dir * speed() * dt;
        if (cur[ax] > base + RANGE) { cur[ax] = base + RANGE; cur.dir = -1; }
        if (cur[ax] < base - RANGE) { cur[ax] = base - RANGE; cur.dir = 1; }
      }
      for (let i = debris.length - 1; i >= 0; i--) {
        const p = debris[i];
        p.t += dt; p.vy -= 9 * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        p[p.axis] += p.vh * dt;
        if (p.t > 1.8) debris.splice(i, 1);
      }
      for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].t += dt; if (ripples[i].t > 0.7) ripples.splice(i, 1); }
      for (const s of slabs) if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.2);

      // camera: follow the top of the tower; after a miss, pull back to show the whole thing
      const t = top(), n = level();
      let tu = (t.x - t.z) * C30, tv = (t.x + t.z) * S30 - n * H, ts = 0.4, ta = 0.05;
      if (!alive) {
        endT += dt;
        const span = n * H + 1.6;
        ts = Math.min(0.4, 1.35 / span);
        tu = 0; tv = (-(n * H) - 0.5 + 0.9) / 2; ta = 0;
      }
      const k = 1 - Math.exp(-dt * (alive ? 7 : 3.2));
      cam.u = lerp(cam.u, tu, k); cam.v = lerp(cam.v, tv, k); cam.s = lerp(cam.s, ts, k); cam.anchor = lerp(cam.anchor, ta, k);

      // ---- draw ----
      const glowCol = rgb(cur ? cur.col : t.col);
      g.draw.bg({ color: glowCol, glow: 0.17 + (t.flash || 0) * 0.08 });
      ctx.save();
      g.draw.clipCircle();
      for (const p of debris) if (p.behind) tumbling(p);
      pedestal();
      // only the slabs that can be on screen
      const bottomY = cam.v + (R - cam.anchor * R) / (cam.s * R) + 1.5; // in "v" units below the camera
      for (let i = 1; i < slabs.length; i++) {
        const s = slabs[i];
        const v = (s.x + s.z) * S30 - i * H;
        if (v > bottomY) continue;
        const depth = n - i;
        const kk = alive ? 1 - Math.min(0.4, depth * 0.022) : 1;
        slab(s, (i - 1) * H, i * H, kk);
      }
      for (const r of ripples) ripple(r);
      for (const p of debris) if (!p.behind) tumbling(p);
      if (cur) {
        const a = clamp(cur.age * 6, 0, 1);
        slab(cur, n * H, (n + 1) * H, 1, a, R * 0.06);
      }
      ctx.restore();
      g.draw.particles(dt);
      g.draw.floaters(dt);
    });

    return {};
  },
};
