// Hit Circle — a reflex game. Circles pop up around the round screen, each with an approach ring that
// shrinks onto it. Tap the circle the moment its ring closes: ±60 ms is Perfect, then Good, then OK.
// Let a ring close without tapping and you lose a life (three in all). Good hits build a combo and a
// multiplier; it all speeds up as you go, and later several circles are up at once — the number says
// which comes first.
import { TAU, clamp, lerp, rand, dist, ease } from './kit.js';

const PERFECT = 0.06, GOOD = 0.13, OK = 0.22, EARLY = 0.45;  // timing windows (s)
const PTS = { Perfect: 300, Good: 100, OK: 50, Early: 20 };
const PENALTY = 50;                                          // a stray tap
const LIVES = 3;

export default {
  howTo: 'Tap each circle just as its ring closes in. Perfect timing scores most; a ring that closes untouched costs a life.',
  scoring: 'high',
  create(g) {
    const COLS = [g.color, '#4d9bff', '#2ee6d6', '#ffc857', '#b57bff', '#3ddc84', '#ff9f43'];
    const targets = [];
    let now = 0, nextSpawn = 0.7, count = 0, lives = LIVES, combo = 0, maxCombo = 0, perfects = 0;
    let pulse = 0, hurt = 0, comboPop = 0, alive = true, lastPos = [0, 0];
    const fx = [];   // expanding hit rings

    const mult = () => 1 + Math.min(3, Math.floor(combo / 8));
    const diff = () => clamp((now - 1) / 110, 0, 1);         // 0 → 1 over ~2 minutes
    const interval = () => lerp(1.15, 0.42, diff()) * rand(0.85, 1.15);
    const approach = () => lerp(1.45, 0.7, diff());
    const tr = () => lerp(0.115, 0.092, diff());             // target radius, × R

    function hudLine() {
      g.sub(`${'♥'.repeat(lives)}${'♡'.repeat(LIVES - lives)}${mult() > 1 ? `  ·  ×${mult()}` : ''}`);
    }
    hudLine();
    g.toast('Tap as the ring closes', 1600);

    function spawn() {
      const r = tr();
      let best = null, bestScore = -1;
      for (let i = 0; i < 24; i++) {
        const a = rand(TAU), d = Math.sqrt(Math.random()) * (0.64 - r);
        const x = Math.sin(a) * d, y = -Math.cos(a) * d;
        if (y < -0.46 + r) continue;                          // keep clear of the score at the top
        let clear = Infinity;
        for (const t of targets) if (t.state === 'live') clear = Math.min(clear, dist(x, y, t.x, t.y) - t.r - r);
        const hop = dist(x, y, lastPos[0], lastPos[1]);
        const sc = Math.min(clear, 0.5) + (hop > 0.22 && hop < 0.8 ? 0.2 : 0);
        if (sc > bestScore) { bestScore = sc; best = [x, y]; }
      }
      if (!best) best = [rand(-0.3, 0.3), rand(-0.1, 0.4)];
      lastPos = best;
      const T = count === 0 ? 1.7 : approach();
      targets.push({ x: best[0], y: best[1], r, born: now, T, at: now + T, col: COLS[count % COLS.length], num: (count % 9) + 1, state: 'live', end: 0 });
      count++;
    }

    function judge(t, word) {
      t.state = 'hit'; t.end = now; t.word = word;
      const m = mult();
      if (word === 'Perfect' || word === 'Good') { combo++; maxCombo = Math.max(maxCombo, combo); comboPop = 1; }
      else if (word === 'Early') combo = 0;
      if (word === 'Perfect') perfects++;
      const pts = PTS[word] * (word === 'Early' ? 1 : m);
      g.add(pts);
      const X = g.cx + t.x * g.R, Y = g.cy + t.y * g.R;
      const big = word === 'Perfect';
      g.draw.burst(X, Y, t.col, big ? 22 : 14, g.R * (big ? 0.6 : 0.42), g.R * 0.013);
      if (big) g.draw.burst(X, Y, '#fff', 8, g.R * 0.35, g.R * 0.008);
      g.draw.float(word, X, Y - t.r * g.R * 1.25, big ? '#fff' : word === 'Good' ? t.col : 'rgba(255,255,255,.7)', g.R * (big ? 0.085 : 0.068));
      g.draw.float(`+${pts.toLocaleString()}`, X, Y + t.r * g.R * 1.45, g.draw.alpha(t.col, 0.95), g.R * 0.045);
      fx.push({ x: t.x, y: t.y, r: t.r, col: t.col, t: 0 });
      pulse = Math.min(1, pulse + (big ? 0.7 : 0.4));
      g.sfx(big ? 'pop' : word === 'Early' ? 'tap' : 'click', { pitch: big ? 1 + Math.min(combo, 24) * 0.02 : 1 });
      g.vibrate(big ? 14 : 8);
      hudLine();
    }

    function stray(x, y) {
      // a tap that doesn't hit anything (or hits a circle far too early): lose the combo and a few points
      combo = 0;
      const lose = Math.min(PENALTY, g.scoreValue);
      if (lose > 0) g.score(g.scoreValue - lose);
      g.draw.float(lose > 0 ? `−${lose}` : '×', x, y, 'rgba(255,90,106,.85)', g.R * 0.05);
      g.sfx('tick');
      hudLine();
    }

    function miss(t) {
      t.state = 'miss'; t.end = now;
      lives--; combo = 0; hurt = 1;
      const X = g.cx + t.x * g.R, Y = g.cy + t.y * g.R;
      g.draw.float('Miss', X, Y - t.r * g.R * 1.2, '#ff5a6a', g.R * 0.075);
      g.sfx('hit'); g.vibrate(45);
      hudLine();
      if (lives <= 0 && alive) {
        alive = false;
        g.over(g.scoreValue, { note: `Max combo ${maxCombo}  ·  ${perfects} perfect${perfects === 1 ? '' : 's'}  ·  ${count - targets.filter((x) => x.state === 'live').length} circles`, delay: 1200 });
      }
    }

    function tapAt(px, py, keyboard = false) {
      if (!alive) return;
      // the live circle under the finger that's due first (keyboard: simply the one due first)
      let pick = null;
      for (const t of targets) {
        if (t.state !== 'live') continue;
        if (!keyboard && dist(px, py, t.x, t.y) > t.r * 1.35) continue;
        if (!pick || t.at < pick.at) pick = t;
      }
      const sx = g.cx + px * g.R, sy = g.cy + py * g.R;
      if (!pick) { stray(sx, sy); return; }
      const d = now - pick.at, a = Math.abs(d);
      if (d < -EARLY) { stray(sx, sy); return; }
      judge(pick, a <= PERFECT ? 'Perfect' : a <= GOOD ? 'Good' : a <= OK ? 'OK' : 'Early');
    }
    g.on('down', (p) => tapAt(p.dx / g.R, p.dy / g.R));
    g.on('key', (e) => { if (e.key === ' ' || e.key === 'Enter') tapAt(0, 0, true); });

    // ---------------------------------------------------------------- frame
    g.loop((dt) => {
      const { ctx, cx, cy, R } = g;
      now += dt;
      pulse = Math.max(0, pulse - dt * 2.6); hurt = Math.max(0, hurt - dt * 1.8); comboPop = Math.max(0, comboPop - dt * 4);
      if (alive && now >= nextSpawn) { spawn(); nextSpawn = now + interval(); }
      if (alive) for (const t of targets) if (t.state === 'live' && now > t.at + OK) miss(t);
      for (let i = targets.length - 1; i >= 0; i--) if (targets[i].state !== 'live' && now - targets[i].end > 0.45) targets.splice(i, 1);
      for (let i = fx.length - 1; i >= 0; i--) { fx[i].t += dt; if (fx[i].t > 0.4) fx.splice(i, 1); }

      // ---- draw ----
      g.draw.bg({ glow: 0.13 + pulse * 0.12 });
      if (hurt > 0) {
        const gr = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R);
        gr.addColorStop(0, 'rgba(255,90,106,0)'); gr.addColorStop(1, `rgba(255,90,106,${0.28 * hurt})`);
        ctx.fillStyle = gr; ctx.fillRect(0, 0, g.S, g.S);
      }
      // a soft ring that breathes with the hits
      g.draw.circle(cx, cy, R * (0.8 + pulse * 0.015), null, { stroke: `rgba(255,255,255,${0.05 + pulse * 0.08})`, lw: R * 0.004 });

      // follow lines between consecutive live circles show the order
      const live = targets.filter((t) => t.state === 'live').sort((a, b) => a.at - b.at);
      ctx.save();
      ctx.setLineDash([R * 0.012, R * 0.022]); ctx.lineCap = 'round'; ctx.lineWidth = R * 0.006;
      for (let i = 1; i < live.length; i++) {
        const a = live[i - 1], b = live[i], d = dist(a.x, a.y, b.x, b.y);
        if (d < a.r + b.r + 0.02) continue;
        const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
        ctx.strokeStyle = `rgba(255,255,255,${0.16 * clamp((now - b.born) * 4, 0, 1)})`;
        ctx.beginPath(); ctx.moveTo(cx + (a.x + ux * a.r * 1.15) * R, cy + (a.y + uy * a.r * 1.15) * R);
        ctx.lineTo(cx + (b.x - ux * b.r * 1.15) * R, cy + (b.y - uy * b.r * 1.15) * R); ctx.stroke();
      }
      ctx.restore();

      // later circles underneath, the next one on top
      for (let i = live.length - 1; i >= 0; i--) drawTarget(live[i], i === 0);
      for (const t of targets) if (t.state !== 'live') drawGone(t);
      for (const f of fx) {
        const k = f.t / 0.4;
        g.draw.circle(cx + f.x * R, cy + f.y * R, (f.r * (1 + ease.out(k) * 0.9)) * R, null, { stroke: g.draw.alpha(f.col, 0.8 * (1 - k)), lw: R * 0.012 * (1 - k) + 1 });
      }
      g.draw.particles(dt);
      g.draw.floaters(dt);

      // combo counter at the bottom
      if (combo >= 2) {
        const s = 1 + comboPop * 0.25;
        g.draw.text(String(combo), cx, cy + R * 0.745, R * 0.08 * s, { color: '#fff', glow: 12 + comboPop * 10 });
        g.draw.text(`COMBO${mult() > 1 ? `  ×${mult()}` : ''}`, cx, cy + R * 0.825, R * 0.032, { color: g.draw.alpha(g.color, 0.9), weight: 800, font: g.theme.font });
      }
    });

    function drawTarget(t, first) {
      const { ctx, cx, cy, R } = g;
      const X = cx + t.x * R, Y = cy + t.y * R, r = t.r * R;
      const age = now - t.born, p = clamp(age / t.T, 0, 1);
      const inK = clamp(age / 0.16, 0, 1), sc = ease.back(inK) * 1;
      const late = now > t.at;
      // approach ring
      const ar = r * (1 + 2.3 * (1 - p));
      const sweet = Math.abs(now - t.at) <= PERFECT;
      ctx.save();
      ctx.globalAlpha = clamp(age * 5, 0, 1) * (late ? 1 - (now - t.at) / OK : 1);
      ctx.beginPath(); ctx.arc(X, Y, ar, 0, TAU);
      ctx.strokeStyle = sweet ? '#fff' : t.col; ctx.lineWidth = R * (0.008 + p * 0.008);
      if (first) { ctx.shadowColor = t.col; ctx.shadowBlur = R * 0.03; }
      ctx.stroke();
      ctx.restore();
      // the circle itself
      ctx.save();
      ctx.globalAlpha = inK * (late ? 0.5 + 0.5 * (1 - (now - t.at) / OK) : 1);
      ctx.translate(X, Y); ctx.scale(sc, sc);
      const gr = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
      gr.addColorStop(0, g.draw.alpha(t.col, 0.55)); gr.addColorStop(0.7, g.draw.alpha(t.col, 0.32)); gr.addColorStop(1, g.draw.alpha(t.col, 0.6));
      if (first || sweet) { ctx.shadowColor = t.col; ctx.shadowBlur = R * (sweet ? 0.08 : 0.04); }
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = gr; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = R * 0.012; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, TAU); ctx.lineWidth = R * 0.004; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.stroke();
      ctx.restore();
      g.draw.text(String(t.num), X, Y + r * 0.04, r * 0.9 * sc, { color: '#fff', alpha: inK, weight: 700 });
    }

    function drawGone(t) {
      const { ctx, cx, cy, R } = g;
      const k = clamp((now - t.end) / 0.45, 0, 1), X = cx + t.x * R, Y = cy + t.y * R;
      ctx.save();
      if (t.state === 'hit') {
        const r = t.r * R * (1 + ease.out(k) * 0.35);
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fillStyle = g.draw.alpha(t.col, 0.35); ctx.fill();
        ctx.lineWidth = R * 0.01; ctx.strokeStyle = '#fff'; ctx.stroke();
      } else {
        const r = t.r * R * (1 - k * 0.3);
        ctx.globalAlpha = 1 - k;
        ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fillStyle = 'rgba(255,90,106,.18)'; ctx.fill();
        ctx.lineWidth = R * 0.01; ctx.strokeStyle = '#ff5a6a'; ctx.stroke();
        const s = r * 0.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(X - s, Y - s); ctx.lineTo(X + s, Y + s); ctx.moveTo(X + s, Y - s); ctx.lineTo(X - s, Y + s); ctx.stroke();
      }
      ctx.restore();
    }

    return {};
  },
};
