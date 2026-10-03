// Circle Pong — keep the ball inside the circle. Your paddle is an arc on the rim that follows your
// finger; every return is a point. Where the ball lands on the paddle sets its new angle, and it speeds
// up a little with each hit. In "Two balls" a second ball joins after 10 hits.
import { TAU, rand, clamp, lerp, angDiff, THEME } from './kit.js';

export default {
  howTo: 'Hold and slide your finger around the edge to move the paddle. Keep the ball inside — every return is a point. (← → or wheel work too.)',
  modes: [{ id: 'classic', name: 'Classic' }, { id: 'two', name: 'Two balls' }],
  scoring: 'high',
  hud: false,                                   // the score sits big and faint in the middle, like the watch game
  create(g, { mode }) {
    const PR = 0.88, TH = 0.042, BR = 0.03;     // paddle radius, thickness, ball radius (× R)
    const TWO_AT = 10;
    const BALL2 = THEME.warn;
    const paddle = { a: Math.PI, target: Math.PI, w: 0.3, flash: 0, v: 0 };
    let hits = 0, phase = 'play', missT = 0, slow = 1, bump = 0, ringPulse = 0;
    let touching = false, keyDir = 0;
    const balls = [], ripples = [];
    let pending2 = false;

    function makeBall(col, delay, dirA, speed) {
      const b = { x: 0, y: 0, vx: 0, vy: 0, sp: speed, col, live: true, out: false, serve: delay, dirA, trail: [], ti: 0, hitT: 0 };
      for (let i = 0; i < 14; i++) b.trail.push({ x: 0, y: 0 });
      balls.push(b);
      return b;
    }
    const baseSpeed = () => g.R * Math.min(1.75, 0.78 + hits * 0.022);
    makeBall('#ffffff', 1.1, Math.PI + rand(-0.5, 0.5), g.R * 0.7);
    g.score(0);
    if (mode === 'two') g.toast(`Second ball at ${TWO_AT}`, 1500);

    // ---------- input ----------
    const follow = (p) => { if (p.r > 0.12) paddle.target = paddle.a + angDiff(paddle.a, p.a); };
    g.on('down', (p) => { touching = true; follow(p); });
    g.on('move', (p) => { if (touching) follow(p); });
    g.on('up', () => { touching = false; });
    g.on('key', (e) => {
      if (e.key === 'ArrowLeft') { keyDir = -1; paddle.target = paddle.a - 0.18; }
      if (e.key === 'ArrowRight') { keyDir = 1; paddle.target = paddle.a + 0.18; }
    });
    g.on('keyup', (e) => { if ((e.key === 'ArrowLeft' && keyDir < 0) || (e.key === 'ArrowRight' && keyDir > 0)) keyDir = 0; });
    g.on('wheel', (e) => { paddle.target += e.delta * 0.16; });

    // ---------- physics ----------
    function launch(b) {
      b.vx = Math.sin(b.dirA) * b.sp; b.vy = -Math.cos(b.dirA) * b.sp;
      g.sfx('whoosh', { volume: 0.6 });
    }
    function bounce(b, ang, k) {
      // reflect off the rim's normal, then bend by where it hit the paddle (Arkanoid-style)
      const nx = Math.sin(ang), ny = -Math.cos(ang);
      const dot = b.vx * nx + b.vy * ny;
      let rx = b.vx - 2 * dot * nx, ry = b.vy - 2 * dot * ny;
      // angle of the reflected ray relative to the inward normal
      const inA = Math.atan2(-nx, ny);                     // inward normal as an app angle (0 = up, clockwise)
      let outA = Math.atan2(rx, -ry);
      let rel = angDiff(inA, outA) - k * 0.85 + rand(-0.07, 0.07);   // hit the left end → it flies left
      if (Math.abs(rel) < 0.12) rel = (rel < 0 ? -1 : 1) * rand(0.12, 0.25);   // never dead straight across
      rel = clamp(rel, -1.15, 1.15);
      outA = inA + rel;
      hits++; g.score(hits);
      b.sp = Math.max(b.sp, baseSpeed()) + g.R * 0.004;
      b.vx = Math.sin(outA) * b.sp; b.vy = -Math.cos(outA) * b.sp;
      b.hitT = 1; paddle.flash = 1; bump = 1;
      ripples.push({ a: ang, t: 0, col: b.col });
      g.sfx('bounce', { pitch: 0.85 + Math.min(0.9, hits * 0.012) });
      g.vibrate(10);
      const [hx, hy] = [g.cx + nx * PR * g.R * 0.97, g.cy + ny * PR * g.R * 0.97];
      g.draw.burst(hx, hy, b.col === '#ffffff' ? g.color : b.col, 8, g.R * 0.35, g.R * 0.008);
      if (hits % 25 === 0) { g.toast(`${hits}!`, 900); g.sfx('score'); }
      if (mode === 'two' && hits === TWO_AT) { pending2 = true; g.toast('Second ball!', 1200); makeBall(BALL2, 99, 0, g.R * 0.6); }
      else if (pending2) {
        // launch the waiting ball towards where the paddle is now, while the first one crosses the circle
        pending2 = false;
        const b2 = balls[1]; b2.serve = 0.25; b2.dirA = paddle.a + rand(-0.45, 0.45); b2.sp = Math.max(g.R * 0.7, baseSpeed() * 0.8);
      }
    }
    function miss(b) {
      b.live = false; b.out = true;
      if (phase !== 'play') return;
      phase = 'miss'; missT = 0.75;
      const a = Math.atan2(b.x, -b.y);
      ripples.push({ a, t: 0, col: THEME.danger, big: true });
      g.sfx('drop'); g.vibrate(40);
    }

    function step(b, dt) {
      if (!b.live && !b.out) return;
      if (b.serve > 0) {
        b.serve -= dt;
        if (b.serve <= 0 && b.serve > -1) launch(b);
        return;
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.hitT = Math.max(0, b.hitT - dt * 4);
      if (!b.live || phase !== 'play') return;
      const d = Math.hypot(b.x, b.y);
      const contact = (PR - TH / 2 - BR) * g.R;
      if (d >= contact && b.vx * b.x + b.vy * b.y > 0) {
        const ang = Math.atan2(b.x, -b.y);
        const off = angDiff(paddle.a, ang);
        const reach = paddle.w + (BR * 0.9) / PR;
        if (Math.abs(off) <= reach) {
          const k = clamp(off / paddle.w, -1, 1);
          b.x *= contact / d; b.y *= contact / d;
          bounce(b, ang, k);
        } else miss(b);
      }
    }

    // ---------- frame ----------
    g.loop((dt, t) => {
      const { ctx, cx, cy, R } = g;
      // paddle
      if (keyDir) paddle.target = paddle.a + keyDir * 0.5;
      const want = angDiff(paddle.a, paddle.target);
      const maxV = keyDir ? 4.2 : 14;
      paddle.v = clamp(want * 24, -maxV, maxV);
      if (phase === 'play') paddle.a += clamp(paddle.v * dt, -Math.abs(want), Math.abs(want));
      const wTarget = mode === 'classic' ? 0.3 - clamp((hits - 15) / 45, 0, 1) * 0.12 : 0.31 - clamp((hits - 30) / 50, 0, 1) * 0.1;
      paddle.w += (wTarget - paddle.w) * Math.min(1, dt * 3);
      paddle.flash = Math.max(0, paddle.flash - dt * 4);
      bump = Math.max(0, bump - dt * 3);
      ringPulse += dt;

      // slow motion after a miss, then the game-over card
      if (phase === 'miss') {
        slow += (0.25 - slow) * Math.min(1, dt * 8);
        if ((missT -= dt) <= 0) {
          phase = 'over';
          const note = mode === 'two' ? (balls.length > 1 ? 'Both balls were in play.' : `The second ball joins at ${TWO_AT}.`) : '';
          g.over(hits || null, { note: hits ? note : 'Missed the very first one!', delay: 900 });
        }
      } else if (phase === 'over') slow += (0.5 - slow) * Math.min(1, dt * 4);
      const wdt = dt * slow;
      const sub = Math.max(1, Math.ceil((Math.hypot(...balls.map((b) => b.sp)) * wdt) / (R * 0.02)));
      for (let i = 0; i < sub; i++) for (const b of balls) step(b, wdt / sub);
      for (const b of balls) { b.ti = (b.ti + 1) % b.trail.length; b.trail[b.ti].x = b.x; b.trail[b.ti].y = b.y; }

      // ================= draw =================
      g.draw.bg({ glow: 0.12 + bump * 0.06 });
      // the score, big and faint in the middle
      const sc = 1 + bump * 0.12;
      g.draw.text(String(hits), cx, cy, R * 0.36 * sc, { color: 'rgba(255,255,255,.09)' });
      if (mode === 'two' && hits < TWO_AT) g.draw.text(`2nd ball at ${TWO_AT}`, cx, cy + R * 0.25, R * 0.05, { color: THEME.dim, weight: 600, font: THEME.font });
      // guide ring
      ctx.save();
      ctx.setLineDash([R * 0.01, R * 0.025]); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, PR * R, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = R * 0.006; ctx.stroke();
      ctx.restore();
      // rim ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]; r.t += dt * (r.big ? 0.9 : 1.6);
        if (r.t >= 1) { ripples.splice(i, 1); continue; }
        const span = (r.big ? 0.5 : 0.25) + r.t * (r.big ? 0.8 : 0.45);
        g.draw.arc(cx, cy, (PR + 0.02 + r.t * 0.05) * R, r.a - span, r.a + span, g.draw.alpha(r.col === '#ffffff' ? g.color : r.col, (1 - r.t) * 0.55), R * 0.012 * (1 - r.t * 0.6));
      }
      // the paddle: a thick neon arc with a bright core
      const pc = paddle.flash > 0 ? mix(g.color, '#ffffff', paddle.flash * 0.6) : g.color;
      g.draw.arc(cx, cy, PR * R, paddle.a - paddle.w, paddle.a + paddle.w, pc, TH * R, { glow: R * (0.05 + paddle.flash * 0.05) });
      g.draw.arc(cx, cy, PR * R, paddle.a - paddle.w * 0.94, paddle.a + paddle.w * 0.94, 'rgba(255,255,255,.55)', TH * R * 0.22);
      // balls: trail, glow, ball
      for (const b of balls) {
        if (b.serve > 0) {      // waiting in the middle, pulsing
          const k = 0.5 + 0.5 * Math.sin(t * 8);
          g.draw.circle(cx, cy, BR * R * (1.6 + k * 0.6), null, { stroke: g.draw.alpha(b.col, 0.35 + k * 0.3), lw: 2 });
          g.draw.ball(cx, cy, BR * R, b.col === '#ffffff' ? '#e9f2ff' : b.col, { glow: true });
          continue;
        }
        const n = b.trail.length;
        ctx.lineCap = 'round'; ctx.strokeStyle = b.col === '#ffffff' ? g.color : b.col;
        for (let j = 1; j < n; j++) {
          const p0 = b.trail[(b.ti + j) % n], p1 = b.trail[(b.ti + j + 1) % n], f = j / n;
          ctx.globalAlpha = f * 0.45; ctx.lineWidth = BR * R * 2 * (0.25 + f * 0.7);
          ctx.beginPath(); ctx.moveTo(cx + p0.x, cy + p0.y); ctx.lineTo(cx + p1.x, cy + p1.y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        const s = 1 + b.hitT * 0.35;
        g.draw.ball(cx + b.x, cy + b.y, BR * R * s, b.col === '#ffffff' ? '#e9f2ff' : b.col, { glow: true });
      }
      g.draw.particles(dt);
      g.draw.floaters(dt);
      if (phase !== 'play') {   // red vignette as it slips out
        const k = phase === 'miss' ? 1 - missT / 0.75 : 1;
        const vg = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
        vg.addColorStop(0, 'rgba(255,90,106,0)'); vg.addColorStop(1, `rgba(255,90,106,${0.22 * k})`);
        ctx.fillStyle = vg; ctx.fillRect(0, 0, g.S, g.S);
      }
    });

    function mix(a, b, k) {
      const p = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
      const A = p(a), B = p(b);
      return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], k))).join(',')})`;
    }
    return { pause() { touching = false; keyDir = 0; } };
  },
};
