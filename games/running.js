// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Running Circle — a reflex game. Your ball runs around a glowing ring; spikes and blocks sit on the inside
// or the outside of the line. Tap to hop across to the other side. Every obstacle passed is a point, gems
// are a bonus, and the ball keeps speeding up. Patterns are planned ahead so there's always time to react.
import { TAU, rand, randInt, clamp, lerp, ease, THEME } from './kit.js';

/** hsl → #hex (the shared draw helpers take hex colours). */
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export default {
  howTo: 'Your ball runs around the ring. Tap anywhere (or press space) to hop to the other side of the line and dodge the spikes. Grab gems for bonus points.',
  scoring: 'high',
  hud: false,                                     // the score sits in the middle of the ring
  create(g) {
    const TR = 0.6, OFF = 0.056, BALL = 0.034, H = 0.078, LINE = 0.011, FLIP = 0.15;
    const W0 = 1.6, WMAX = 3.7, TOOTH = 0.05;     // angular speeds (rad/s), tooth half-width (rad)
    const BALL_A = BALL / TR;                     // ball radius as an angle on the ring
    const GEM = '#2ee6d6';

    let pos = 0, omega = W0, side = 1, rho = OFF, flipFrom = OFF, flipT = 1;
    let score = 0, gemsTaken = 0, phase = 'play', pulse = 0, hint = 1, lastFlip = -1, deadT = 0;
    const obs = [], plan = [], ripples = [], trail = [];
    for (let i = 0; i < 18; i++) trail.push({ x: 0, y: 0 });
    let ti = 0, trailInit = false;

    // ---------- the pattern planner ----------
    // Each item has a "safe side" (where the ball must be as it passes). Whenever the safe side changes,
    // the planner leaves enough room for a hop plus reaction time at the speed the ball will have.
    let genAt = pos + 2.3, lastEnd = genAt, lastSafe = 1;
    const diff = () => clamp(score / 180, 0, 1);
    const omegaF = () => omega * 1.06 + 0.12;
    const react = () => lerp(0.36, 0.2, diff());
    const flipAng = () => 2 * BALL_A + omegaF() * (FLIP + react());
    function push(kind, sideOf, len) {
      const safe = kind === 'gem' ? sideOf : -sideOf;
      if (safe !== lastSafe) genAt = Math.max(genAt, lastEnd + flipAng());
      const at = genAt + len;
      plan.push({ kind, side: sideOf, len, n: Math.max(1, Math.round(len / TOOTH)), at, passed: false, born: -1, taken: false });
      genAt = at + len; lastEnd = genAt; lastSafe = safe;
    }
    const gap = (sec) => { genAt += omegaF() * sec; };
    const teeth = () => (Math.random() < 0.25 + diff() * 0.35 ? 2 : 1) + (diff() > 0.5 && Math.random() < 0.2 ? 1 : 0);
    let first = true;
    function planPattern() {
      const d = diff();
      if (first) { first = false; push('spike', -1, TOOTH); gap(0.9); push('spike', 1, TOOTH); gap(1.0); return; }
      const s = Math.random() < 0.5 ? 1 : -1;
      const w = [
        ['single', 1 - 0.5 * d], ['alt', 0.35 + 0.55 * d], ['double', d > 0.1 ? 0.2 + 0.6 * d : 0],
        ['wall', 0.3], ['cluster', 0.3],
      ];
      let r = rand(w.reduce((a, x) => a + x[1], 0)), kind = 'single';
      for (const [k, v] of w) { if ((r -= v) <= 0) { kind = k; break; } }
      if (kind === 'single') push('spike', s, TOOTH * teeth());
      else if (kind === 'alt') {
        const k = randInt(2, 3 + Math.round(d));
        for (let i = 0; i < k; i++) { push('spike', i % 2 ? -s : s, TOOTH * teeth()); gap(rand(0.05, 0.3)); }
      } else if (kind === 'double') {          // quick double hop: two taps in a row
        push('spike', s, TOOTH); push('spike', -s, TOOTH);
        if (d > 0.45 && Math.random() < 0.6) push('spike', s, TOOTH);
      } else if (kind === 'wall') push('block', s, rand(0.13, 0.26) + d * 0.08);
      else {
        for (let i = 0; i < 3; i++) { push('spike', s, TOOTH * (i === 1 ? 2 : 1)); if (i < 2) gap(rand(0.07, 0.14)); }
      }
      // rest between patterns, sometimes with a gem in the middle
      const rest = lerp(0.62, 0.32, d) + rand(0, 0.3 * (1 - d) + 0.08);
      if (Math.random() < 0.24) {
        gap(rest * 0.4);
        push('gem', Math.random() < 0.5 ? 1 : -1, 0.03);
        gap(rest * 0.4);
      } else gap(rest);
    }
    const reveal = () => pos + TAU - 1.05;       // items appear this far ahead (just behind the ball on the ring)

    // ---------- input ----------
    function flip() {
      if (phase !== 'play') return;
      side = -side; flipFrom = rho; flipT = 0; pulse = 1; hint = Math.min(hint, 0.35);
      ripples.push({ t: 0 });
      g.sfx('jump', { pitch: side > 0 ? 1.15 : 0.95, volume: 0.6 });
    }
    g.on('down', flip);
    g.on('key', (e) => { if ([' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) flip(); });
    g.on('wheel', () => { if (g.time - lastFlip > 0.14) { lastFlip = g.time; flip(); } });

    function die() {
      phase = 'dead'; deadT = 0;
      const [x, y] = ballXY();
      g.draw.burst(x, y, THEME.fg, 26, g.R * 0.7, g.R * 0.012);
      g.draw.burst(x, y, accent, 20, g.R * 0.5, g.R * 0.01);
      g.sfx('boom'); g.vibrate(60);
      const laps = Math.floor(pos / TAU);
      g.over(score, { note: `${laps} lap${laps === 1 ? '' : 's'}${gemsTaken ? ` · ${gemsTaken} gem${gemsTaken === 1 ? '' : 's'}` : ''}`, delay: 1200 });
    }
    const ballXY = () => {
      const r = (TR + rho) * g.R;
      return [g.cx + Math.sin(pos) * r, g.cy - Math.cos(pos) * r];
    };

    let accent = g.color;
    g.score(0);

    // ---------- frame ----------
    g.loop((dt, t) => {
      const { ctx, cx, cy, R } = g;
      if (phase === 'play') {
        omega = Math.min(WMAX, W0 + score * 0.011);
        pos += omega * dt;
        while (genAt < reveal() + 0.5) planPattern();
        while (plan.length && plan[0].at - plan[0].len < reveal()) { const o = plan.shift(); o.born = t; obs.push(o); }
      } else deadT += dt;
      flipT = Math.min(1, flipT + dt / FLIP);
      rho = lerp(flipFrom, side * OFF, ease.inOut(flipT));
      pulse = Math.max(0, pulse - dt * 3.5);
      hint = Math.max(0, hint - dt * 0.25);

      // ---- collisions & scoring ----
      if (phase === 'play') {
        for (let i = obs.length - 1; i >= 0; i--) {
          const o = obs[i], du = pos - o.at;
          if (o.kind === 'gem') {
            if (!o.taken && Math.abs(du) < BALL_A * 1.3 && Math.sign(rho) === o.side && Math.abs(rho) > OFF * 0.4) {
              o.taken = true; o.tt = t; gemsTaken++; score += 5; g.score(score);
              const [x, y] = ballXY();
              g.draw.float('+5', x, y - R * 0.04, GEM, R * 0.06); g.draw.burst(x, y, GEM, 10, R * 0.3, R * 0.008);
              g.sfx('coin');
            }
            if (du > 0.6) obs.splice(i, 1);
            continue;
          }
          if (!o.passed && Math.abs(du) < o.len * 0.86 + BALL_A * 0.75) {
            const h = (o.kind === 'block' ? H * 0.8 : H) * 0.86;
            const lo = o.side > 0 ? 0 : -h, hi = o.side > 0 ? h : 0;
            if (rho + BALL * 0.72 > lo && rho - BALL * 0.72 < hi) { die(); break; }
          }
          if (!o.passed && du > o.len + BALL_A) {
            o.passed = true; score++; g.score(score);
            if (score % 25 === 0) { g.sfx('score'); g.toast(`${score}!`, 800); pulse = 1; } else g.sfx('tick', { volume: 0.6 });
          }
          if (du > 0.75) obs.splice(i, 1);
        }
      }

      // ================= draw =================
      const sp = clamp((omega - W0) / (WMAX - W0), 0, 1);
      accent = phase === 'dead' ? THEME.danger : hsl(262 + sp * 140, 90, THEME.light ? 60 : 70);   // a deeper tone on light screens
      const bgc = hsl(262 + sp * 140, 80, 55);
      g.draw.bg({ color: bgc, glow: 0.16 + pulse * 0.08 + sp * 0.05 });
      const ringR = TR * R;
      // flip ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]; rp.t += dt * 2.2;
        if (rp.t >= 1) { ripples.splice(i, 1); continue; }
        ctx.strokeStyle = g.draw.alpha(accent, (1 - rp.t) * 0.35); ctx.lineWidth = R * 0.006;
        for (const k of [1, -1]) { ctx.beginPath(); ctx.arc(cx, cy, ringR * (1 + k * ease.out(rp.t) * 0.14), 0, TAU); ctx.stroke(); }
      }
      // the ring
      ctx.save();   // flat: a solid stroke with a thin lighter core line, no glow
      ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, TAU);
      ctx.strokeStyle = accent; ctx.lineWidth = LINE * R * (1 + pulse * 0.9); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = LINE * R * 0.3; ctx.stroke();
      ctx.restore();

      // obstacles: fully-grown ones share one glowing path, growing/fading ones are drawn one by one
      const P = (a, r) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
      const shape = (o, k) => {
        const base = ringR + o.side * LINE * R * 0.5;
        if (o.kind === 'block') {
          const h = H * 0.8 * R * k, lw = h, rr = base + o.side * h / 2;
          const cap = (lw / 2) / rr, a0 = o.at - o.len + cap, a1 = o.at + o.len - cap;
          ctx.moveTo(...P(a0, rr)); ctx.arc(cx, cy, rr, a0 - Math.PI / 2, a1 - Math.PI / 2);
          return lw;
        }
        const n = o.n, tw = (o.len * 2) / n;
        for (let j = 0; j < n; j++) {
          const a0 = o.at - o.len + j * tw;
          ctx.moveTo(...P(a0, base)); ctx.lineTo(...P(a0 + tw / 2, base + o.side * H * R * k)); ctx.lineTo(...P(a0 + tw, base));
        }
        return 0;
      };
      const vis = (o) => {
        const grow = ease.back(clamp((t - o.born) / 0.4, 0, 1));
        const fade = o.passed ? clamp(1 - (pos - o.at - o.len) / 0.5, 0, 1) : 1;
        return [grow, fade];
      };
      ctx.save();
      ctx.fillStyle = THEME.fg; ctx.strokeStyle = THEME.fg; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (THEME.glow) { ctx.shadowColor = accent; ctx.shadowBlur = R * 0.03; }
      ctx.beginPath();
      for (const o of obs) { const [gr, fa] = vis(o); if (o.kind === 'spike' && gr >= 1 && fa >= 1) shape(o, 1); }
      ctx.fill();
      for (const o of obs) {
        const [gr, fa] = vis(o);
        if (o.kind !== 'block' || gr < 1 || fa < 1) continue;
        ctx.beginPath(); ctx.lineWidth = shape(o, 1); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      for (const o of obs) {
        if (o.kind === 'gem') continue;
        const [gr, fa] = vis(o);
        if (gr >= 1 && fa >= 1) continue;
        ctx.globalAlpha = fa;
        ctx.beginPath(); const lw = shape(o, Math.max(0.01, gr));
        if (o.kind === 'block') { ctx.lineWidth = lw; ctx.stroke(); } else ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      // gems
      for (const o of obs) {
        if (o.kind !== 'gem') continue;
        const k = o.taken ? 1 + (t - o.tt) * 3 : ease.back(clamp((t - o.born) / 0.4, 0, 1));
        const al = o.taken ? clamp(1 - (t - o.tt) * 3, 0, 1) : 1;
        if (al <= 0) continue;
        const [x, y] = P(o.at, ringR + o.side * OFF * R);
        const s = R * 0.024 * k;
        ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.rotate(t * 2);
        ctx.beginPath(); ctx.moveTo(0, -s * 1.3); ctx.lineTo(s, 0); ctx.lineTo(0, s * 1.3); ctx.lineTo(-s, 0); ctx.closePath();
        ctx.fillStyle = GEM; ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, -s * 0.7); ctx.lineTo(s * 0.45, 0); ctx.lineTo(0, s * 0.2); ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fill();
        ctx.restore();
      }

      // the ball with its motion trail
      const [bx, by] = ballXY();
      if (!trailInit) { for (const p of trail) { p.x = bx; p.y = by; } trailInit = true; }
      if (phase === 'play') { ti = (ti + 1) % trail.length; trail[ti].x = bx; trail[ti].y = by; }
      if (phase === 'play') {
        const n = trail.length;
        ctx.lineCap = 'round'; ctx.strokeStyle = accent;
        for (let j = 1; j < n; j++) {
          const p0 = trail[(ti + j) % n], p1 = trail[(ti + j + 1) % n], f = j / n;
          ctx.globalAlpha = f * 0.5; ctx.lineWidth = BALL * R * 2 * (0.2 + 0.75 * f);
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        const hop = Math.sin(Math.PI * flipT) * 0.28;          // swells a little mid-hop
        g.draw.ball(bx, by, BALL * R * (1 + hop) * 1.22, accent);      // flat: a solid accent rim…
        g.draw.ball(bx, by, BALL * R * (1 + hop), THEME.fg);            // …around a solid ball in the text colour (white on dark)
      } else {
        // shockwave where it crashed
        const k = clamp(deadT / 0.6, 0, 1);
        g.draw.circle(bx, by, R * (0.04 + ease.out(k) * 0.25), null, { stroke: g.draw.alpha(THEME.danger, 1 - k), lw: R * 0.01 * (1 - k) + 0.5 });
      }

      // score in the middle
      const laps = Math.floor(pos / TAU), ta = phase === 'dead' ? clamp(1 - deadT / 0.9, 0, 1) : 1;   // fades before the game-over card
      g.draw.text(String(score), cx, cy - R * 0.03, R * 0.26, { color: THEME.fg, glow: R * 0.04 * pulse, alpha: ta });
      g.draw.text(`LAP ${laps + 1}`, cx, cy + R * 0.15, R * 0.045, { color: THEME.muted, weight: 700, font: THEME.font, alpha: ta });
      if (hint > 0) g.draw.text('Tap to switch sides', cx, cy + R * 0.25, R * 0.05, { color: THEME.fg, alpha: Math.min(1, hint * 2.5), weight: 600, font: THEME.font });
      g.draw.particles(dt);
      g.draw.floaters(dt);
    });
    return {};
  },
};
