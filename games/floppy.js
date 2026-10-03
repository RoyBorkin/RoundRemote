// Floppy Bird — tap to flap, gravity does the rest. Glide through the gaps between the glass pillars;
// every pair you pass is a point. Touch a pillar, the ground or fly off the top and it's over.
// Everything is laid out in units of R so it fits the round screen at any size.
import { TAU, clamp, lerp, rand } from './kit.js';

const GROUND = 0.72;      // ground line, × R below the centre
const CEIL = -0.9;        // fly above this and you're gone
const BIRD_X = -0.3;
const BR = 0.058;         // bird radius
const GRAV = 2.75, FLAP = -0.88, MAXV = 1.55;
const PIPE_W = 0.19;
const SPAWN_X = 1.12;     // pillars appear just outside the circle
const BIRD_COL = '#ffb35c', BELLY = '#ffe3b0', BEAK = '#ff6f61';

const MEDALS = [[50, 'Platinum'], [30, 'Gold'], [20, 'Silver'], [10, 'Bronze']];

export default {
  howTo: 'Tap (or press space) to flap. Fly through the gaps between the pillars — don’t touch them or the ground.',
  scoring: 'high',
  create(g) {
    let phase = 'ready';              // ready → play → dead
    let score = 0, t0 = 0, flash = 0, deadT = 0;
    const bird = { y: -0.05, vy: 0, rot: 0, wing: 0, flapT: 0, spin: 0, onGround: false };
    const pipes = [];
    let scroll = 0;                   // distance travelled (× R), drives the parallax

    // ---- the scenery (generated once, in R units) ----
    const CITY_P = 2.6, HILL_P = 1;   // repeat lengths
    const city = [];
    for (let x = 0; x < CITY_P;) {
      const w = rand(0.09, 0.2), h = rand(0.14, 0.46);
      const lit = [];
      for (let i = 0; i < 6; i++) if (Math.random() < 0.55) lit.push([rand(0.15, 0.75), rand(0.08, 0.9)]);
      city.push({ x, w, h, lit, roof: Math.random() < 0.25 });
      x += w + rand(0.005, 0.03);
    }
    const stars = Array.from({ length: 34 }, () => ({ x: rand(-1, 1), y: rand(-0.95, 0.15), r: rand(0.003, 0.008), tw: rand(TAU) }));

    const speed = () => 0.6 + Math.min(0.16, score * 0.005);
    const gapSize = () => Math.max(0.36, 0.5 - score * 0.006);
    const spacing = () => Math.max(0.66, 0.86 - score * 0.008);

    function addPipe(x) {
      const prev = pipes.length ? pipes[pipes.length - 1].gy : -0.08;
      const gap = gapSize();
      const lo = -0.42, hi = 0.3, reach = 0.42 + Math.min(0.1, score * 0.004);
      const gy = clamp(prev + rand(-reach, reach), lo, hi);
      pipes.push({ x, gy, gap, passed: false, glow: 0 });
    }

    function flap() {
      if (phase === 'dead') return;
      if (phase === 'ready') { phase = 'play'; t0 = g.time; addPipe(SPAWN_X + 0.55); }
      bird.vy = FLAP; bird.flapT = 0.28;
      g.sfx('flap');
    }
    g.on('down', flap);
    g.on('key', (e) => { if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') flap(); });

    function die(why) {
      if (phase === 'dead') return;
      phase = 'dead'; deadT = 0; flash = 1;
      bird.vy = why === 'ground' ? 0 : Math.min(bird.vy, -0.35);
      bird.spin = why === 'ground' ? 0 : 9;
      if (why === 'ground') bird.onGround = true;
      g.sfx('hit'); g.vibrate(60);
      const medal = MEDALS.find(([n]) => score >= n);
      const pipesTxt = `${score} pillar${score === 1 ? '' : 's'}`;
      g.over(score, {
        note: medal ? `${medal[1]} — ${pipesTxt}` : score ? `${pipesTxt} · ${10 - score} more for Bronze` : 'Tap to flap — short taps keep you level.',
        label: medal ? medal[1] : '',
        delay: 1400,
      });
    }

    // circle vs. rectangle (x0..x1, y0..y1), all in R units
    const hitsRect = (cx, cy, r, x0, y0, x1, y1) => {
      const nx = clamp(cx, x0, x1), ny = clamp(cy, y0, y1);
      return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
    };

    // ---------------------------------------------------------------- frame
    g.loop((dt, t) => {
      const { ctx, cx, cy, R } = g;
      // ---- update ----
      flash = Math.max(0, flash - dt * 3);
      bird.flapT = Math.max(0, bird.flapT - dt);
      bird.wing += dt * (bird.flapT > 0 ? 34 : phase === 'dead' ? 0 : 9);
      const v = phase === 'dead' ? 0 : speed();
      if (phase !== 'dead') scroll += v * dt;

      if (phase === 'ready') {
        bird.y = -0.05 + Math.sin(t * 3.2) * 0.035;
        bird.rot = lerp(bird.rot, 0, 1 - Math.exp(-dt * 8));
      } else if (!bird.onGround) {
        bird.vy = Math.min(MAXV, bird.vy + GRAV * dt);
        bird.y += bird.vy * dt;
        if (phase === 'dead') bird.rot += bird.spin * dt, bird.spin *= Math.exp(-dt * 0.6);
        else bird.rot = lerp(bird.rot, clamp(bird.vy * 0.75, -0.45, 1.25), 1 - Math.exp(-dt * (bird.vy > 0 ? 6 : 14)));
        if (bird.y + BR >= GROUND) {
          bird.y = GROUND - BR;
          if (phase === 'dead') { bird.onGround = true; bird.vy = 0; g.sfx('drop'); }
          else die('ground');
        }
      }
      if (phase === 'play') {
        for (const p of pipes) p.x -= v * dt;
        while (pipes.length && pipes[0].x < -1.3) pipes.shift();
        const last = pipes[pipes.length - 1];
        if (!last || last.x < SPAWN_X - spacing()) addPipe(last ? last.x + spacing() : SPAWN_X);
        if (bird.y - BR < CEIL) die('top');
        const r = BR * 0.8;
        for (const p of pipes) {
          const x0 = p.x - PIPE_W / 2, x1 = p.x + PIPE_W / 2;
          if (hitsRect(BIRD_X, bird.y, r, x0, -3, x1, p.gy - p.gap / 2) || hitsRect(BIRD_X, bird.y, r, x0, p.gy + p.gap / 2, x1, 3)) { die('pipe'); break; }
          if (!p.passed && x1 < BIRD_X - BR * 0.4) {
            p.passed = true; p.glow = 1; score++;
            g.add(1); g.sfx('score');
            if (score % 10 === 0) g.toast(MEDALS.slice().reverse().find(([n]) => n === score)?.[1] || `${score}!`, 900);
          }
        }
      }
      if (phase === 'dead') deadT += dt;
      for (const p of pipes) p.glow = Math.max(0, p.glow - dt * 2.5);

      // ---- draw ----
      g.draw.bg({ glow: 0.13, glowAt: [0.35, -0.45] });
      ctx.save();
      g.draw.clipCircle();
      const X = (x) => cx + x * R, Y = (y) => cy + y * R;
      // sky: a faint wash toward the horizon, stars and a moon
      const sky = ctx.createLinearGradient(0, Y(-1), 0, Y(GROUND));
      sky.addColorStop(0, 'rgba(10,18,40,0)'); sky.addColorStop(1, 'rgba(40,110,100,.16)');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, g.S, Y(GROUND));
      for (const s of stars) {
        let sx = ((s.x - scroll * 0.02) % 2 + 3) % 2 - 1;
        ctx.globalAlpha = 0.35 + 0.3 * Math.sin(t * 1.7 + s.tw);
        ctx.fillStyle = '#e8fff6'; ctx.beginPath(); ctx.arc(X(sx), Y(s.y), s.r * R, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // a thin crescent moon
      ctx.save();
      ctx.beginPath(); ctx.arc(X(0.46), Y(-0.5), R * 0.062, 0, TAU);
      ctx.fillStyle = 'rgba(225,250,240,.08)'; ctx.fill();          // the dark side, barely there
      ctx.clip();
      ctx.beginPath(); ctx.rect(X(0.3), Y(-0.7), R * 0.4, R * 0.4); ctx.arc(X(0.49), Y(-0.525), R * 0.058, 0, TAU);
      ctx.fillStyle = 'rgba(225,250,240,.8)'; ctx.fill('evenodd');
      ctx.restore();
      // far city (slow parallax)
      const cOff = (scroll * 0.16) % CITY_P;
      for (let rep = -1; rep <= 1; rep++) {
        for (const b of city) {
          const bx = b.x - cOff + rep * CITY_P - 1.3;
          if (bx > 1.05 || bx + b.w < -1.05) continue;
          const top = GROUND - b.h;
          ctx.fillStyle = '#0d1d1c';
          ctx.fillRect(X(bx), Y(top), b.w * R + 0.5, (GROUND - top) * R);
          if (b.roof) { ctx.fillRect(X(bx + b.w * 0.45), Y(top - 0.05), Math.max(1, R * 0.006), R * 0.05); }
          ctx.fillStyle = 'rgba(110,231,183,.22)';
          for (const [wx, wy] of b.lit) ctx.fillRect(X(bx + wx * b.w), Y(top + wy * b.h * 0.85), R * 0.012, R * 0.014);
        }
      }
      // near hills (medium parallax)
      const hOff = scroll * 0.45;
      ctx.beginPath(); ctx.moveTo(X(-1.05), Y(GROUND));
      for (let x = -1.05; x <= 1.06; x += 0.035) {
        const wx = x + hOff;
        const h = 0.1 + 0.045 * Math.sin(wx * 3.3) + 0.03 * Math.sin(wx * 7.7 + 1.3) + 0.015 * Math.sin(wx * 15 + 0.4);
        ctx.lineTo(X(x), Y(GROUND - h));
      }
      ctx.lineTo(X(1.06), Y(GROUND)); ctx.closePath();
      ctx.fillStyle = '#0a1514'; ctx.fill();

      // pillars
      for (const p of pipes) drawPillar(p);

      // ground band
      ctx.fillStyle = '#081010'; ctx.fillRect(0, Y(GROUND), g.S, g.S);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, Y(GROUND), g.S, g.S); ctx.clip();
      ctx.strokeStyle = 'rgba(110,231,183,.08)'; ctx.lineWidth = R * 0.03;
      const gOff = (scroll % 0.16);
      for (let x = -1.2 - gOff; x < 1.2; x += 0.16) { ctx.beginPath(); ctx.moveTo(X(x), Y(GROUND + 0.02)); ctx.lineTo(X(x - 0.12), Y(GROUND + 0.3)); ctx.stroke(); }
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = g.color; ctx.lineWidth = R * 0.008; ctx.shadowColor = g.color; ctx.shadowBlur = R * 0.04;
      ctx.beginPath(); ctx.moveTo(0, Y(GROUND)); ctx.lineTo(g.S, Y(GROUND)); ctx.stroke();
      ctx.restore();

      drawBird();
      // red flash on a crash
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.35})`; ctx.fillRect(0, 0, g.S, g.S); }
      ctx.restore();

      if (phase === 'ready') {
        const a = 0.6 + 0.4 * Math.sin(t * 4);
        g.draw.text('Get ready', cx, Y(-0.36), R * 0.1, { color: '#fff', glow: 16 });
        g.draw.text('Tap to flap', cx, Y(0.27), R * 0.056, { color: '#fff', weight: 600, font: g.theme.font, alpha: a });
        // a little tap hint under the bird
        g.draw.circle(X(BIRD_X), Y(0.14), R * (0.03 + 0.012 * Math.sin(t * 4)), null, { stroke: 'rgba(255,255,255,.35)', lw: 2 });
      }
      g.draw.particles(dt);
    });

    // ---------------------------------------------------------------- drawing pieces
    function drawPillar(p) {
      const { ctx, R } = g;
      const x0 = g.cx + (p.x - PIPE_W / 2) * R, w = PIPE_W * R;
      const top = g.cy + (p.gy - p.gap / 2) * R, bot = g.cy + (p.gy + p.gap / 2) * R;
      const yA = g.cy - R * 1.05, yB = g.cy + GROUND * R;
      const glow = 0.5 + p.glow * 0.5;
      const body = ctx.createLinearGradient(x0, 0, x0 + w, 0);
      body.addColorStop(0, 'rgba(110,231,183,.10)'); body.addColorStop(0.3, 'rgba(110,231,183,.26)');
      body.addColorStop(0.55, 'rgba(110,231,183,.12)'); body.addColorStop(1, 'rgba(110,231,183,.05)');
      const capH = R * 0.06, capOut = R * 0.018, rr = R * 0.025;
      for (const [y0, y1, capY] of [[yA, top, top - capH], [bot, yB + R * 0.05, bot]]) {
        // soft halo, glass body, bright edge
        ctx.save();
        ctx.beginPath(); ctx.roundRect(x0, y0, w, y1 - y0, rr);
        ctx.fillStyle = body; ctx.fill();
        ctx.lineWidth = R * 0.03; ctx.strokeStyle = `rgba(110,231,183,${0.07 * glow})`; ctx.stroke();
        ctx.lineWidth = R * 0.006; ctx.strokeStyle = `rgba(110,231,183,${0.55 + 0.4 * p.glow})`; ctx.stroke();
        // highlight streak
        ctx.fillStyle = 'rgba(255,255,255,.16)';
        ctx.fillRect(x0 + w * 0.2, y0 + R * 0.02, Math.max(1, w * 0.06), Math.max(0, y1 - y0 - R * 0.04));
        // the rim at the gap
        ctx.beginPath(); ctx.roundRect(x0 - capOut, capY, w + capOut * 2, capH, R * 0.02);
        ctx.fillStyle = `rgba(110,231,183,${0.22 + 0.3 * p.glow})`; ctx.fill();
        ctx.shadowColor = g.color; ctx.shadowBlur = R * 0.04 * glow;
        ctx.lineWidth = R * 0.007; ctx.strokeStyle = g.color; ctx.stroke();
        ctx.restore();
      }
    }

    function drawBird() {
      const { ctx, R } = g;
      const x = g.cx + BIRD_X * R, y = g.cy + bird.y * R, r = BR * R;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(bird.rot);
      // tail feathers
      ctx.fillStyle = '#e88a3a';
      ctx.beginPath(); ctx.moveTo(-r * 0.8, -r * 0.1); ctx.lineTo(-r * 1.45, -r * 0.45); ctx.lineTo(-r * 1.3, r * 0.05); ctx.lineTo(-r * 1.4, r * 0.35); ctx.lineTo(-r * 0.8, r * 0.25); ctx.closePath(); ctx.fill();
      // body
      ctx.fillStyle = BIRD_COL; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();   // flat, one solid colour
      // belly
      ctx.fillStyle = BELLY; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(r * 0.18, r * 0.42, r * 0.58, r * 0.4, -0.15, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      // head tuft
      ctx.strokeStyle = '#e88a3a'; ctx.lineWidth = r * 0.16; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-r * 0.05, -r * 0.92); ctx.quadraticCurveTo(-r * 0.05, -r * 1.35, r * 0.25, -r * 1.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.25, -r * 0.88); ctx.quadraticCurveTo(-r * 0.4, -r * 1.25, -r * 0.1, -r * 1.28); ctx.stroke();
      // beak
      ctx.fillStyle = BEAK;
      ctx.beginPath(); ctx.moveTo(r * 0.78, -r * 0.2); ctx.quadraticCurveTo(r * 1.45, -r * 0.02, r * 0.8, r * 0.22); ctx.closePath(); ctx.fill();
      // eye
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r * 0.42, -r * 0.28, r * 0.3, 0, TAU); ctx.fill();
      const dead = phase === 'dead';
      if (dead) {
        ctx.strokeStyle = '#1b1b22'; ctx.lineWidth = r * 0.1;
        ctx.beginPath(); ctx.moveTo(r * 0.3, -r * 0.4); ctx.lineTo(r * 0.56, -r * 0.16); ctx.moveTo(r * 0.56, -r * 0.4); ctx.lineTo(r * 0.3, -r * 0.16); ctx.stroke();
      } else {
        ctx.fillStyle = '#1b1b22'; ctx.beginPath(); ctx.arc(r * 0.5, -r * 0.26, r * 0.15, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r * 0.55, -r * 0.32, r * 0.05, 0, TAU); ctx.fill();
      }
      // cheek
      ctx.fillStyle = 'rgba(255,111,97,.45)'; ctx.beginPath(); ctx.ellipse(r * 0.42, r * 0.12, r * 0.15, r * 0.09, 0, 0, TAU); ctx.fill();
      // wing (flaps)
      const wa = Math.sin(bird.wing) * 0.6;
      ctx.save(); ctx.translate(-r * 0.2, r * 0.05); ctx.rotate(-0.25 + wa);
      ctx.fillStyle = '#f39a45'; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = r * 0.06;
      ctx.beginPath(); ctx.ellipse(-r * 0.12, 0, r * 0.5, r * 0.28, 0.25, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.restore();
    }

    return {};
  },
};
