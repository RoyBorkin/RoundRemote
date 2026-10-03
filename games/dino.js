// Dino Run — our own little glowing dino runs along a ground line across the lower part of the circle.
// Tap / space to jump (hold for a bit more height), swipe down / ArrowDown to duck (and to drop fast in
// the air). Cacti come in ones, twos and threes; gliders fly at three heights — the middle ones must be
// ducked. The run speeds up; the score is the distance. Day turns to night now and then.
import { TAU, clamp, rand, lerp, ease } from './kit.js';
import { topScores } from './scores.js';

const GY = 0.35;            // ground, × R below the centre
const DX = -0.55;           // the dino's x, × R from the centre
const U = 0.0085;           // one dino drawing unit, × R
const GRAV = 5.2, V0 = 1.62, HOLD = 0.6, HOLD_T = 0.22;
const SPEED0 = 1.25, SPEED_MAX = 2.75, ACCEL = 0.011;
const CACTUS = '#b9f3d6', BIRD = '#cdd5ff', DINO = '#f1f5f9', PLATE = '#9ee8ff';

// hit boxes in dino units [x0, y0, x1, y1] (y up is negative), a little smaller than the art
const BOX_STAND = [[-6, -13, 3.5, 0], [2.5, -21.5, 10.5, -15.5]];
const BOX_DUCK = [[-7, -8.6, 15.5, 0]];

// small deterministic hash for the scrolling ground details
const hash = (i) => { let x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export default {
  howTo: 'Tap or space to jump — hold for a higher jump. Swipe down or ArrowDown to duck under the gliders. How far can you run?',
  scoring: 'high',
  hud: false,
  create(g) {
    let phase = 'wait', now = 0, speed = SPEED0, score = 0, world = 0, milestone = 0, flashT = -9;
    const best = (topScores('dino', 'default')[0] || {}).score || 0;
    const dino = { y: 0, vy: 0, held: false, air: 0, leg: 0, blink: 2.5, duck: false, land: -9 };
    let keyDuck = false, touchDuck = false, duckUntil = -1, pending = false, touch = null, jumpBuf = -9, deadT = 0;
    let nightK = 0, nightNo = 0, wasNight = false;
    const obs = [];
    let nextGap = 1.6;      // distance (× R) the field scrolls before the next obstacle appears
    const stars = Array.from({ length: 34 }, (_, i) => ({ x: hash(i + 1) * 2 - 1, y: -0.9 + hash(i + 50) * 1.0, s: 0.4 + hash(i + 90) * 1.1, tw: hash(i + 7) * TAU }));
    const clouds = Array.from({ length: 4 }, (_, i) => ({ x: -0.8 + i * 0.6 + rand(-0.1, 0.1), y: rand(-0.55, -0.12), s: rand(0.8, 1.25) }));
    const sprites = {};
    let spriteFor = '';

    // ---------- helpers ----------
    const onGround = () => dino.y <= 0 && dino.vy <= 0;
    function jump(held) {
      if (phase === 'wait') start();
      if (phase !== 'run') return;
      if (!onGround()) { jumpBuf = now; dino.bufHeld = held; return; }
      dino.vy = V0; dino.y = 0.0001; dino.held = held; dino.air = 0;
      g.sfx('jump', { volume: 0.7 });
    }
    function start() {
      phase = 'run'; speed = SPEED0;
      g.sfx('tap');
    }
    function spawn() {
      const x = 1.12;
      const birdsOk = score > 280;
      if (birdsOk && Math.random() < Math.min(0.42, 0.22 + score / 4000)) {
        const lvl = Math.floor(Math.random() * 3);              // 0 low (jump), 1 middle (duck), 2 high (run under)
        const bottom = [0.03, 0.105, 0.205][lvl];
        obs.push({ kind: 'bird', x, bottom, w: 0.15, h: 0.075, flap: rand(TAU), vx: speed > 1.7 ? rand(0, 0.18) : 0 });
      } else {
        const maxN = score < 120 ? 1 : score < 450 ? 2 : 3;
        const n = 1 + Math.floor(Math.random() * maxN);
        const big = Math.random() < (score < 120 ? 0.25 : 0.5) && !(n === 3 && speed < 1.75);
        const parts = [];
        let w = 0;
        for (let i = 0; i < n; i++) {
          const ph = big ? rand(0.155, 0.175) : rand(0.105, 0.125), pw = big ? 0.08 : 0.064;
          parts.push({ dx: w, h: ph, w: pw, arms: [Math.random() < 0.8 ? rand(0.35, 0.6) : 0, Math.random() < 0.8 ? rand(0.4, 0.68) : 0] });
          w += pw * 1.08;
        }
        obs.push({ kind: 'cactus', x, parts, w: w - parts[n - 1].w * 0.08 });
      }
      const last = obs[obs.length - 1];
      nextGap = last.w + speed * rand(0.8, 1.45) * (last.kind === 'bird' ? 1.1 : 1);
    }
    function boxes() {
      const set = dino.duck && onGround() ? BOX_DUCK : BOX_STAND;
      return set.map(([x0, y0, x1, y1]) => [DX + x0 * U, GY - dino.y + y0 * U, DX + x1 * U, GY - dino.y + y1 * U]);
    }
    function obsBoxes(o) {
      if (o.kind === 'bird') return [[o.x - o.w * 0.4, GY - o.bottom - o.h * 0.85, o.x + o.w * 0.42, GY - o.bottom - o.h * 0.15]];
      return o.parts.map((p) => [o.x + p.dx + p.w * 0.14, GY - p.h * 0.93, o.x + p.dx + p.w * 0.86, GY]);
    }
    const overlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    function die() {
      phase = 'dead'; deadT = now;
      g.sfx('hit'); g.vibrate(70);
      g.draw.burst(g.cx + DX * g.R, g.cy + (GY - dino.y - 0.1) * g.R, '#fff', 22, g.R * 0.5, g.R * 0.01);
      g.over(Math.floor(score), { note: Math.floor(score) > best && best > 0 ? 'A new record run!' : `Top speed ${(speed / SPEED0).toFixed(1)}×`, delay: 1200 });
    }

    // ---------- input ----------
    // a touch jumps after a few ms unless it turns into a swipe down (duck / drop); if the finger only starts
    // sliding down after the jump began, the dino drops straight back down
    g.on('down', (p) => {
      touch = { y: p.y, t0: now };
      if (phase === 'wait') { start(); jump(true); return; }
      if (phase === 'run') pending = true;
    });
    g.on('move', (p) => {
      if (!touch || touchDuck) return;
      if (p.y - touch.y > g.R * 0.06) { touchDuck = true; pending = false; dino.held = false; }
    });
    g.on('up', () => {
      if (pending) jump(false);
      pending = false; touch = null; dino.held = false;
      if (touchDuck) { touchDuck = false; duckUntil = now + 0.28; }
    });
    g.on('key', (e) => {
      const k = e.key;
      if (k === ' ' || k === 'ArrowUp' || k === 'Enter' || k === 'w') jump(true);
      else if (k === 'ArrowDown' || k === 's') { keyDuck = true; dino.held = false; }
    });
    g.on('keyup', (e) => {
      const k = e.key;
      if (k === ' ' || k === 'ArrowUp' || k === 'Enter' || k === 'w') dino.held = false;
      else if (k === 'ArrowDown' || k === 's') keyDuck = false;
    });

    // ---------- sprites (pre-rendered once per size) ----------
    function makeSprites() {
      const R = g.R, dpr = g.dpr;
      const mk = (w, h, fn) => { const c = document.createElement('canvas'); c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr); const x = c.getContext('2d'); x.scale(dpr, dpr); fn(x, w, h); return c; };
      sprites.glow = mk(64, 64, (x) => { const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); });
      const cw = R * 0.3, ch = R * 0.11;
      sprites.cloud = mk(cw, ch, (x) => {
        x.fillStyle = 'rgba(255,255,255,1)';
        x.beginPath();
        x.ellipse(cw * 0.3, ch * 0.66, cw * 0.2, ch * 0.3, 0, 0, TAU);
        x.ellipse(cw * 0.52, ch * 0.45, cw * 0.2, ch * 0.4, 0, 0, TAU);
        x.ellipse(cw * 0.72, ch * 0.66, cw * 0.18, ch * 0.28, 0, 0, TAU);
        x.fill();
        x.fillRect(cw * 0.12, ch * 0.66, cw * 0.76, ch * 0.28);
      });
      const mr = R * 0.06;
      sprites.moonR = mr;
      sprites.moon = (phase) => mk(mr * 2 + 4, mr * 2 + 4, (x) => {
        const c = mr + 2;
        x.fillStyle = '#e9ecf7'; x.beginPath(); x.arc(c, c, mr, 0, TAU); x.fill();   // flat moon, flat craters
        x.fillStyle = '#c9cfe2';
        for (const [a, b, r] of [[-0.3, -0.2, 0.18], [0.25, 0.3, 0.13], [0.1, -0.45, 0.09]]) { x.beginPath(); x.arc(c + a * mr, c + b * mr, r * mr, 0, TAU); x.fill(); }
        if (phase) { x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(c + phase * mr, c - mr * 0.1, mr * 1.02, 0, TAU); x.fill(); }
      });
      sprites.moons = [-0.62, -0.9, 0, 0.9, 0.62].map((p) => sprites.moon(p));
      spriteFor = `${R}|${dpr}`;
    }

    // ---------- drawing the dino (our own design: a round-headed little runner with back plates) ----------
    function drawDino(x, y, pose, t) {
      const { ctx } = g;
      const u = U * g.R;
      ctx.save(); ctx.translate(x, y); ctx.scale(u, u);
      // glow
      ctx.drawImage(sprites.glow, -20, pose === 'duck' ? -18 : -28, 40, pose === 'duck' ? 26 : 34);
      ctx.fillStyle = DINO; ctx.strokeStyle = DINO; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const dead = pose === 'dead';
      if (pose === 'duck') {
        const bob = Math.sin(t * 2) * 0.4;
        // plates
        ctx.fillStyle = PLATE;
        for (const [px, s] of [[-6, 2.2], [-2.5, 2.6], [1, 2.2]]) { ctx.beginPath(); ctx.moveTo(px - s, -7.6 + bob); ctx.quadraticCurveTo(px, -8 - s * 1.5 + bob, px + s, -7.6 + bob); ctx.fill(); }
        ctx.fillStyle = DINO;
        // tail
        ctx.beginPath(); ctx.moveTo(-6, -7.5 + bob); ctx.quadraticCurveTo(-12, -8.5, -17, -8.2 + bob); ctx.quadraticCurveTo(-12, -5.5, -6, -3.6 + bob); ctx.fill();
        // body + head
        ctx.beginPath(); ctx.ellipse(0, -5.6 + bob, 8.6, 3.8, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.roundRect(6, -10 + bob, 10.5, 6.4, 3); ctx.fill();
        // legs (short, fast)
        legs(-3.6, 1.6, -2.5, 2.5, t, 1.6);
        // eye
        eye(13.2, -7.6 + bob, false);
        ctx.fillStyle = 'rgba(5,5,6,.75)'; ctx.fillRect(13.6, -5.2 + bob, 2.4, 0.5);
      } else {
        const air = pose === 'jump';
        const bob = pose === 'run' ? Math.abs(Math.sin(t * 2)) * -0.6 : 0;
        ctx.translate(0, bob);
        ctx.fillStyle = PLATE;
        for (const [px, py, s] of [[-6.2, -12.2, 2], [-3, -13.8, 2.5], [0.4, -14, 2.2]]) { ctx.beginPath(); ctx.moveTo(px - s, py + 0.8); ctx.quadraticCurveTo(px - s * 0.2, py - s * 1.7, px + s, py + 0.8); ctx.fill(); }
        ctx.fillStyle = DINO;
        // tail
        const tw = pose === 'run' ? Math.sin(t * 2) * 0.8 : 0;
        ctx.beginPath(); ctx.moveTo(-5.5, -12); ctx.quadraticCurveTo(-11, -12 + tw, -15.5, -15.5 + tw); ctx.quadraticCurveTo(-12, -9.5 + tw, -6.5, -6.5); ctx.fill();
        // body
        ctx.beginPath(); ctx.ellipse(-1.2, -9.4, 6.8, 5.1, -0.12, 0, TAU); ctx.fill();
        // neck + head
        ctx.beginPath(); ctx.roundRect(1.2, -17.5, 4.6, 9, 2.2); ctx.fill();
        ctx.beginPath(); ctx.roundRect(1.4, -23, 10.6, 7.4, 3.4); ctx.fill();
        // arm
        ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(4, -10.5); ctx.lineTo(6.8, -8.6); ctx.lineTo(7.4, -9.6); ctx.stroke();
        // legs
        if (air) legs(-3.6, 0.6, -1.6, 2.2, 0, 0, true);
        else if (pose === 'run') legs(-3.6, 0.6, -bob - 0.2, 2.6, t, 2.2);
        else legs(-3.6, 0.6, 0, 2.6, 0, 0);
        // face
        eye(8.2, -20, dead);
        ctx.strokeStyle = 'rgba(5,5,6,.75)'; ctx.lineWidth = 0.55;
        if (dead) { ctx.beginPath(); ctx.arc(10, -17.4, 0.9, 0, TAU); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(8.6, -17.5); ctx.quadraticCurveTo(10.2, -16.9, 11.4, -17.6); ctx.stroke(); }
        ctx.fillStyle = 'rgba(255,138,216,.45)'; ctx.beginPath(); ctx.arc(6.4, -17.6, 0.9, 0, TAU); ctx.fill();
      }
      ctx.restore();

      function eye(ex, ey, x) {
        if (x) {
          ctx.strokeStyle = '#050506'; ctx.lineWidth = 0.75;
          ctx.beginPath(); ctx.moveTo(ex - 1.3, ey - 1.3); ctx.lineTo(ex + 1.3, ey + 1.3); ctx.moveTo(ex + 1.3, ey - 1.3); ctx.lineTo(ex - 1.3, ey + 1.3); ctx.stroke();
          return;
        }
        if (dino.blink < 0.13) { ctx.fillStyle = '#050506'; ctx.fillRect(ex - 1.1, ey - 0.15, 2.2, 0.45); return; }
        ctx.fillStyle = '#050506'; ctx.beginPath(); ctx.arc(ex, ey, 1.15, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + 0.35, ey - 0.4, 0.38, 0, TAU); ctx.fill();
      }
      // two legs from the hips (hx0, hx1), foot level fy; swing animates a run cycle
      function legs(hx0, hx1, fy, len, tt, swing, tucked = false) {
        ctx.strokeStyle = DINO; ctx.lineWidth = 2.3;
        [hx0, hx1].forEach((hx, i) => {
          const ph = tt * 2 + i * Math.PI;
          const lift = swing ? Math.max(0, Math.sin(ph)) * swing : 0;
          const fwd = swing ? Math.cos(ph) * swing * 0.8 : 0;
          const hipY = fy - 5.4;
          const footX = hx + fwd + (tucked ? 1.2 : 0), footY = fy - lift - (tucked ? 1.4 : 0);
          ctx.beginPath(); ctx.moveTo(hx, hipY); ctx.lineTo(footX, footY - 0.4); ctx.lineTo(footX + len * 0.8, footY - 0.4); ctx.stroke();
        });
      }
    }

    function drawCactus(o) {
      const { ctx, cx, cy, R } = g;
      for (const p of o.parts) {
        const x = cx + (o.x + p.dx) * R, w = p.w * R, h = p.h * R, base = cy + GY * R;
        ctx.drawImage(sprites.glow, x - w * 0.6, base - h * 1.15, w * 2.2, h * 1.35);
        ctx.fillStyle = CACTUS; ctx.strokeStyle = CACTUS; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const tw = w * 0.48, tx = x + (w - tw) / 2;
        ctx.beginPath(); ctx.roundRect(tx, base - h, tw, h + 1, [tw / 2, tw / 2, 2, 2]); ctx.fill();
        ctx.lineWidth = tw * 0.58;
        const [l, r] = p.arms;
        if (l) { const ay = base - h * l; ctx.beginPath(); ctx.moveTo(tx + tw * 0.3, ay); ctx.lineTo(x + w * 0.12, ay); ctx.lineTo(x + w * 0.12, ay - h * 0.2); ctx.stroke(); }
        if (r) { const ay = base - h * r; ctx.beginPath(); ctx.moveTo(tx + tw * 0.7, ay); ctx.lineTo(x + w * 0.88, ay); ctx.lineTo(x + w * 0.88, ay - h * 0.24); ctx.stroke(); }
        // a few spines
        ctx.strokeStyle = 'rgba(5,5,6,.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(tx + tw / 2, base - h * 0.85); ctx.lineTo(tx + tw / 2, base - h * 0.15); ctx.stroke();
      }
    }
    function drawBird(o, t) {
      const { ctx, cx, cy, R } = g;
      const x = cx + o.x * R, y = cy + (GY - o.bottom - o.h * 0.5) * R, s = o.w * R / 22;
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      ctx.drawImage(sprites.glow, -16, -12, 32, 24);
      const tip = -3 - 10 * Math.sin(o.flap);
      ctx.fillStyle = BIRD; ctx.strokeStyle = BIRD; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // far wing
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(-1, -0.5); ctx.quadraticCurveTo(-2.5, tip * 0.8, 1.5, tip * 0.85); ctx.quadraticCurveTo(3, tip * 0.3, 5, 0); ctx.fill();
      ctx.globalAlpha = 1;
      // a little glider with a crest, flying at you (facing left)
      ctx.beginPath(); ctx.ellipse(2, 0.4, 6.2, 2.5, 0.06, 0, TAU); ctx.fill();                                // body
      ctx.beginPath(); ctx.arc(-4.8, -0.8, 2.6, 0, TAU); ctx.fill();                                           // head
      ctx.beginPath(); ctx.moveTo(-6.6, -1.6); ctx.lineTo(-13, 0.2); ctx.lineTo(-6.8, 0.8); ctx.fill();         // beak
      ctx.beginPath(); ctx.moveTo(-5, -2.8); ctx.lineTo(0.8, -5); ctx.lineTo(-2.6, -1.4); ctx.fill();           // crest
      ctx.beginPath(); ctx.moveTo(7.5, 0); ctx.lineTo(12, -2.2); ctx.lineTo(11, 2); ctx.fill();                 // tail
      // near wing
      ctx.beginPath(); ctx.moveTo(-1.5, 0); ctx.quadraticCurveTo(-1, tip, 3.5, tip * 1.05); ctx.quadraticCurveTo(4.5, tip * 0.35, 6.5, 0.6); ctx.fill();
      ctx.fillStyle = '#050506'; ctx.beginPath(); ctx.arc(-5.4, -1.2, 0.8, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // ---------- frame ----------
    g.loop((dt, t) => {
      now += dt;
      const { ctx, cx, cy, R } = g;
      if (spriteFor !== `${R}|${g.dpr}`) makeSprites();
      dino.blink -= dt; if (dino.blink < 0) dino.blink = rand(2, 4.5);

      // ---- update ----
      if (phase === 'run') {
        speed = Math.min(SPEED_MAX, speed + ACCEL * dt * (speed < 2 ? 1 : 0.7));
        const step = speed * dt;
        world += step; score += step * 7.5;
        const m = Math.floor(score / 100);
        if (m > milestone) { milestone = m; flashT = now; g.sfx('score'); }
        // pending touch → a jump once we know it isn't a swipe down
        if (pending && now - touch.t0 > 0.07) { jump(true); pending = false; }
        dino.duck = keyDuck || touchDuck || now < duckUntil;
        // physics
        if (!onGround() || dino.vy > 0) {
          dino.air += dt;
          let gr = GRAV;
          if (dino.held && dino.vy > 0 && dino.air < HOLD_T) gr *= HOLD;
          if (dino.duck) { gr *= 2.6; if (dino.vy > 0) dino.vy *= 0.6; }
          dino.vy -= gr * dt; dino.y += dino.vy * dt;
          if (dino.y <= 0) {
            dino.y = 0; dino.vy = 0; dino.land = now;
            g.draw.burst(cx + (DX - 0.01) * R, cy + GY * R, 'rgba(255,255,255,.6)', 6, R * 0.18, R * 0.006);
            if (now - jumpBuf < 0.12) { jumpBuf = -9; jump(dino.bufHeld); }
          }
        }
        dino.leg += dt * speed * 6.5;
        // obstacles
        for (const o of obs) { o.x -= step + (o.vx || 0) * dt; if (o.flap !== undefined) o.flap += dt * 9; }
        while (obs.length && obs[0].x + (obs[0].w || 0.1) < -1.2) obs.shift();
        nextGap -= step;
        if (nextGap <= 0 && now > 0.6) spawn();
        // collisions
        const db = boxes();
        for (const o of obs) {
          if (o.x > DX + 0.35 || o.x + (o.w || 0.1) < DX - 0.2) continue;
          if (obsBoxes(o).some((b) => db.some((d) => overlap(b, d)))) { die(); break; }
        }
        // day / night
        const cyc = score % 700;
        const night = cyc > 440;
        if (night && !wasNight) nightNo++;
        wasNight = night;
        nightK += ((night ? 1 : 0) - nightK) * Math.min(1, dt * 0.8);
      } else if (phase === 'dead') {
        for (const o of obs) if (o.flap !== undefined) o.flap += dt * 3;
      }

      // ---- draw ----
      g.draw.bg({ glow: 0.1 * (1 - nightK) + 0.03, glowAt: [0, -0.35] });
      const shake = phase === 'dead' ? Math.max(0, 1 - (now - deadT) / 0.35) : 0;
      ctx.save();
      if (shake) ctx.translate(rand(-1, 1) * shake * R * 0.018, rand(-1, 1) * shake * R * 0.018);
      if (nightK > 0.01) {
        const gr = ctx.createRadialGradient(cx, cy - R * 0.35, 0, cx, cy, R * 1.05);
        gr.addColorStop(0, `rgba(80,96,255,${0.16 * nightK})`); gr.addColorStop(0.7, `rgba(60,70,200,${0.05 * nightK})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, g.S, g.S);
        // stars
        ctx.fillStyle = '#fff';
        for (const s of stars) {
          let sx = s.x - (world * 0.02) % 2; if (sx < -1) sx += 2;
          const tw = 0.55 + 0.45 * Math.sin(t * 2 + s.tw);
          ctx.globalAlpha = nightK * tw * 0.9;
          ctx.beginPath(); ctx.arc(cx + sx * R, cy + s.y * R, s.s * R * 0.004 + 0.5, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // the moon drifts across during the night
        const cyc = score % 700, k = clamp((cyc - 440) / 260, 0, 1);
        const mx = lerp(0.55, -0.55, phase === 'run' ? k : k), my = -0.34 - 0.08 * Math.sin(k * Math.PI);
        const img = sprites.moons[nightNo % sprites.moons.length];
        ctx.globalAlpha = nightK;
        const mr = sprites.moonR;
        ctx.drawImage(img, cx + mx * R - mr - 2, cy + my * R - mr - 2, mr * 2 + 4, mr * 2 + 4);
        ctx.globalAlpha = 1;
      }
      // clouds
      for (const c of clouds) {
        if (phase === 'run') c.x -= speed * dt * 0.16;
        if (c.x < -1.3) { c.x = 1.2 + rand(0.3); c.y = rand(-0.55, -0.12); c.s = rand(0.8, 1.25); }
        ctx.globalAlpha = 0.055 - 0.025 * nightK;
        const w = R * 0.22 * c.s, h = R * 0.08 * c.s;
        ctx.drawImage(sprites.cloud, cx + c.x * R, cy + c.y * R, w, h);
      }
      ctx.globalAlpha = 1;

      // ground line with bumps, and pebbles underneath
      const gy = cy + GY * R, stepX = 0.02;
      const earth = ctx.createLinearGradient(0, gy, 0, gy + R * 0.6);
      earth.addColorStop(0, `rgba(226,232,240,${0.05 + 0.02 * nightK})`); earth.addColorStop(1, 'rgba(226,232,240,0)');
      ctx.fillStyle = earth; ctx.fillRect(0, gy, g.S, R * 0.6);
      ctx.save();
      ctx.beginPath();
      for (let x = -1; x <= 1.0001; x += stepX) {
        const wx = (x + world) / 0.07, i = Math.floor(wx), f = wx - i;
        const b0 = hash(i) > 0.82 ? (hash(i + 0.5) - 0.4) : 0, b1 = hash(i + 1) > 0.82 ? (hash(i + 1.5) - 0.4) : 0;
        const bump = lerp(b0, b1, (1 - Math.cos(f * Math.PI)) / 2) * R * 0.012;
        const px = cx + x * R, py = gy - bump;
        if (x === -1) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(241,245,249,.7)'; ctx.lineWidth = Math.max(1.5, R * 0.005); ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(226,232,240,.6)'; ctx.shadowBlur = R * 0.02; ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(241,245,249,.35)';
      const pe = 0.045, first = Math.floor((world - 1) / pe);
      for (let i = first; i < first + 2 / pe + 2; i++) {
        if (hash(i * 3.1) < 0.45) continue;
        const x = i * pe + hash(i * 7.3) * pe - world;
        const y = 0.018 + hash(i * 1.7) * 0.07, w = (0.004 + hash(i * 5.9) * 0.012) * R;
        ctx.fillRect(cx + x * R, gy + y * R, w, Math.max(1, R * 0.004));
      }

      // obstacles
      for (const o of obs) { if (o.kind === 'cactus') drawCactus(o); else drawBird(o, t); }

      // the dino
      const pose = phase === 'dead' ? 'dead' : phase === 'wait' ? 'stand' : !onGround() ? 'jump' : dino.duck ? 'duck' : 'run';
      const sq = now - dino.land < 0.12 ? 1 - (now - dino.land) / 0.12 : 0;
      ctx.save();
      ctx.translate(cx + DX * R, gy - dino.y * R);
      ctx.scale(1 + sq * 0.08, 1 - sq * 0.1);
      drawDino(0, 0, pose, dino.leg);
      ctx.restore();

      ctx.restore();
      if (shake) { ctx.fillStyle = `rgba(255,255,255,${0.16 * shake})`; ctx.fillRect(0, 0, g.S, g.S); }

      // hint before the start
      if (phase === 'wait') {
        const a = 0.55 + 0.45 * Math.sin(now * 3.5);
        g.draw.text('Tap to run', cx, cy + R * 0.56, R * 0.07, { alpha: a, glow: 10 });
        g.draw.text('tap / space = jump  ·  swipe down = duck', cx, cy + R * 0.67, R * 0.036, { color: g.theme.muted, weight: 600, font: g.theme.font });
      }

      // score: best + current, blinking on every 100
      const blinking = now - flashT < 0.9;
      const shown = blinking ? milestone * 100 : Math.floor(score);
      const ty = cy - R * 0.66;
      if (best > 0) g.draw.text(`HI ${String(Math.floor(best)).padStart(5, '0')}`, cx - R * 0.17, ty, R * 0.05, { color: g.theme.dim, weight: 600 });
      if (!blinking || Math.floor((now - flashT) / 0.15) % 2 === 0) {
        g.draw.text(String(shown).padStart(5, '0'), best > 0 ? cx + R * 0.17 : cx, ty, R * 0.075, { color: '#fff', glow: blinking ? 18 : 8 });
      }

      g.draw.particles(dt);
      g.draw.floaters(dt);
    });
    return {};
  },
};
