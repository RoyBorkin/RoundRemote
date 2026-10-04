// Grow — hold anywhere and a bubble grows under your finger. Let go to keep it: the bigger, the more
// points. If it touches the edge (or one of the drifting spikes) it pops and you lose a life.
// Each round adds a spike. Three lives.
import { TAU, rand, dist, clamp, THEME } from './kit.js';

export default {
  howTo: 'Hold to grow the bubble, let go to bank it. Bigger = more points — but touch the edge or a spike and it pops.',
  scoring: 'high',
  create(g) {
    const ARENA = 0.86;                       // arena radius, × R
    let lives = 3, round = 1, phase = 'ready'; // ready → growing → banked | popped → ready
    let bubble = null, wait = 0, spikes = [], pulse = 0;

    const arenaR = () => g.R * ARENA;
    function addSpike() {
      const a = rand(TAU), r = rand(0.2, 0.7) * arenaR(), sp = g.R * rand(0.18, 0.26) * (1 + round * 0.06), d = rand(TAU);
      spikes.push({ x: Math.sin(a) * r, y: -Math.cos(a) * r, vx: Math.cos(d) * sp, vy: Math.sin(d) * sp, rot: rand(TAU), size: g.R * 0.034 });
    }
    function newRound() {
      phase = 'ready'; bubble = null;
      if (spikes.length < round - 1) addSpike();
      g.sub(`Round ${round}  ·  ${'♥'.repeat(lives)}${'♡'.repeat(3 - lives)}`);
    }
    newRound();
    g.toast('Hold to grow', 1500);

    g.on('down', (p) => {
      if (phase !== 'ready' || p.r > ARENA - 0.02) return;
      bubble = { x: p.dx, y: p.dy, r: g.R * 0.012, max: arenaR() - Math.hypot(p.dx, p.dy) };
      phase = 'growing';
    });
    g.on('up', () => { if (phase === 'growing') bank(); });
    g.on('key', (e) => { if (e.key === ' ' && phase === 'ready') { bubble = { x: 0, y: 0, r: g.R * 0.012, max: arenaR() }; phase = 'growing'; } });
    g.on('keyup', (e) => { if (e.key === ' ' && phase === 'growing') bank(); });

    function bank() {
      const frac = (bubble.r / arenaR()) ** 2;          // share of the arena it covers
      const ratio = bubble.r / Math.max(1, bubble.max);  // how close to the edge you dared
      let pts = Math.round(frac * 1000);
      let word = '';
      if (ratio > 0.93) { pts *= 2; word = 'Perfect!'; g.sfx('perfect'); }
      else if (ratio > 0.82) { pts = Math.round(pts * 1.5); word = 'Great!'; g.sfx('score'); }
      else g.sfx('place');
      g.add(pts);
      g.draw.float(`+${pts}`, g.cx + bubble.x, g.cy + bubble.y - bubble.r * 0.2, THEME.fg, g.R * 0.09);
      if (word) g.toast(word, 900);
      phase = 'banked'; wait = 1.1; round++;
    }
    function pop() {
      g.sfx('boom'); g.vibrate(40);
      g.draw.burst(g.cx + bubble.x, g.cy + bubble.y, g.color, 30, g.R * 0.9, g.R * 0.016);
      lives--; phase = 'popped'; wait = 1.1;
      if (lives <= 0) g.over(g.scoreValue, { note: `You reached round ${round}.` });
      else g.toast('Pop!', 800);
    }

    g.loop((dt, t) => {
      const { ctx, cx, cy } = g;
      pulse += dt;
      // ---- update ----
      for (const s of spikes) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.rot += dt * 2;
        const d = Math.hypot(s.x, s.y), lim = arenaR() - s.size;
        if (d > lim) {        // bounce off the arena wall
          const nx = s.x / d, ny = s.y / d, dot = s.vx * nx + s.vy * ny;
          s.vx -= 2 * dot * nx; s.vy -= 2 * dot * ny; s.x = nx * lim; s.y = ny * lim;
        }
      }
      if (phase === 'growing') {
        bubble.r += (g.R * 0.1 + bubble.r * 0.9) * dt * (1 + round * 0.04);
        const hitEdge = Math.hypot(bubble.x, bubble.y) + bubble.r >= arenaR();
        const hitSpike = spikes.some((s) => dist(s.x, s.y, bubble.x, bubble.y) < bubble.r + s.size * 0.8);
        if (hitEdge || hitSpike) pop();
      }
      if ((phase === 'banked' || phase === 'popped') && (wait -= dt) <= 0 && lives > 0) newRound();

      // ---- draw ----
      g.draw.bg({ glow: 0.14 + (phase === 'growing' ? 0.06 : 0) });
      // the arena edge: a dashed danger ring that turns red when the bubble gets close
      const close = phase === 'growing' ? clamp(bubble.r / Math.max(1, bubble.max), 0, 1) : 0;
      ctx.save();
      ctx.setLineDash([g.R * 0.02, g.R * 0.025]); ctx.lineDashOffset = -t * 20;
      ctx.beginPath(); ctx.arc(cx, cy, arenaR(), 0, TAU);
      ctx.strokeStyle = close > 0.75 ? `rgba(255,90,106,${0.4 + 0.6 * (close - 0.75) / 0.25})` : THEME.ink(0.22);
      ctx.lineWidth = g.R * (close > 0.75 ? 0.011 : 0.008); ctx.stroke();
      ctx.restore();
      // spikes
      for (const s of spikes) {
        ctx.save(); ctx.translate(cx + s.x, cy + s.y); ctx.rotate(s.rot);
        ctx.beginPath();
        for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, r = i % 2 ? s.size * 0.5 : s.size; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fillStyle = '#ff5a6a'; if (THEME.glow) { ctx.shadowColor = '#ff5a6a'; ctx.shadowBlur = 10; } ctx.fill();
        ctx.restore();
      }
      // the bubble
      if (bubble && phase !== 'popped') {
        const x = cx + bubble.x, y = cy + bubble.y;
        const k = phase === 'banked' ? Math.max(0, wait / 1.1) : 1;
        const r = bubble.r * (phase === 'banked' ? 0.85 + 0.15 * k : 1);
        ctx.save(); ctx.globalAlpha = phase === 'banked' ? k : 1;
        // flat bubble: one solid fill and a thin solid rim
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = g.color; ctx.fill();
        ctx.lineWidth = g.R * 0.008; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.stroke();
        ctx.restore();
        if (phase === 'growing') g.draw.text(`${Math.round((bubble.r / arenaR()) ** 2 * 100)}%`, x, y, clamp(r * 0.5, g.R * 0.04, g.R * 0.14), { color: '#fff' });
      }
      // a soft hint where to hold
      if (phase === 'ready') g.draw.circle(cx, cy, g.R * (0.05 + 0.01 * Math.sin(pulse * 4)), null, { stroke: THEME.ink(0.35), lw: 2 });
      g.draw.particles(dt);
      g.draw.floaters(dt);
    });
    return {};
  },
};
