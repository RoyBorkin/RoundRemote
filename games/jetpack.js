// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Jetpack Dash — a side-scrolling lab corridor. Hold to fire the jetpack and climb, let go to drop.
// Dodge zappers (some spin), missiles (announced by a blinking warning on the right) and, later,
// lasers that charge up across the whole corridor. Coins come in lines, waves and little shapes.
// Score = metres flown + coins. One hit and the pilot tumbles down the corridor.
import { TAU, rand, clamp, lerp, pick, THEME } from './kit.js';

// Lab palettes: the night-shift lab (Dark — the original look), an all-black OLED lab and a bright day lab (Light).
const PAL_DARK = {
  wall: ['#141826', '#10131d', '#0b0d14'], band: 'rgba(0,0,0,.22)', trim: 'rgba(251,146,60,.35)', trim2: 'rgba(251,146,60,.55)',
  ceil: '#090a0f', ceilLip: '#1b1f2b', ceilLine: '#151924', ceilHi: 'rgba(255,255,255,.06)',
  floor: ['#1c202c', '#0f1118', '#060709'], floorLip: '#262b3a', cone: 'rgba(255,190,120,.13)', cone0: 'rgba(255,190,120,0)',
  seam: 'rgba(255,255,255,.05)', port: '#07080c', portGlass: 'rgba(77,155,255,.10)', star: 'rgba(255,255,255,.75)', frame: '#2a3042',
  tank: '#0a0c12', liquid: 'rgba(52,211,153,.16)', fizz: 'rgba(52,211,153,.5)', lamp: '#ffe2bf', floorSeam: 'rgba(255,255,255,.07)',
  hazard: 'rgba(255,200,87,.16)', mark: 'rgba(255,255,255,.16)', zapHalo: 'rgba(125,211,252,.16)', zapMid: 'rgba(125,211,252,.55)',
  zapCore: '#f0fbff', zapNode: 'rgba(125,211,252,.22)', flash: '255,255,255',
};
const PAL_OLED = { ...PAL_DARK, wall: ['#0a0c13', '#07080e', '#030406'], band: 'rgba(0,0,0,.35)', ceil: '#000000', ceilLip: '#10131c', ceilLine: '#0b0d14',
  floor: ['#11141c', '#06070a', '#000000'], floorLip: '#191d28', port: '#000000', tank: '#000000' };
const PAL_LIGHT = {
  wall: ['#e6ebf2', '#dde3ec', '#d2d9e4'], band: 'rgba(40,52,76,.06)', trim: 'rgba(234,110,30,.45)', trim2: 'rgba(234,110,30,.7)',
  ceil: '#a9b3c5', ceilLip: '#c2cad7', ceilLine: '#b3bdcd', ceilHi: 'rgba(255,255,255,.55)',
  floor: ['#c3cbd7', '#b4bdcb', '#9ea8b9'], floorLip: '#a6afc0', cone: 'rgba(255,196,120,.30)', cone0: 'rgba(255,196,120,0)',
  seam: 'rgba(30,40,62,.08)', port: '#1d2438', portGlass: 'rgba(77,155,255,.22)', star: 'rgba(255,255,255,.8)', frame: '#8792a8',
  tank: '#c6cedb', liquid: 'rgba(16,185,129,.30)', fizz: 'rgba(5,150,105,.6)', lamp: '#fff8ec', floorSeam: 'rgba(30,40,62,.10)',
  hazard: 'rgba(214,140,10,.38)', mark: 'rgba(30,40,62,.22)', zapHalo: 'rgba(14,165,233,.20)', zapMid: 'rgba(2,132,199,.75)',
  zapCore: '#f0fbff', zapNode: 'rgba(14,165,233,.25)', flash: '255,255,255',
};
const lab = () => (THEME.light ? PAL_LIGHT : THEME.mode === 'oled' ? PAL_OLED : PAL_DARK);

// The world is measured in units of R (the screen radius); y = 0 is the screen centre.
const CEIL = -0.5, FLOOR = 0.58;          // the playable band, fully inside the round screen
const PX = -0.42;                          // the pilot's x
const HR = 0.046;                          // the pilot's hit radius
const YMIN = CEIL + 0.075, YMAX = FLOOR - 0.078;
const GRAV = 3.3, THRUST = 7.0;
const M_PER_U = 10;                        // metres per unit of R

// coin shapes ('#' = coin); a few look like little words
const SHAPES = [
  ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  ['...#..', '...##.', '######', '...##.', '...#..'],
  ['.###..###.', '#....#...#', '#.##.#...#', '#..#.#...#', '.###..###.'],
  ['#..#.###.', '#..#.#..#', '#..#.###.', '#..#.#...', '.##..#...'],
  ['..#..', '.###.', '#####', '.###.', '..#..'],
  ['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#'],
];

export default {
  howTo: 'Hold to fire the jetpack and fly, let go to drop. Dodge zappers, missiles and lasers — and grab the coins.',
  scoring: 'high',
  create(g) {
    const { ctx } = g;
    let dist = 0, speed = 0.8, coins = 0, shownM = -1, shownC = -1;
    let py = YMAX, vy = 0, onFloor = true, runPh = 0, flick = 0;
    let ptrs = 0; const keys = new Set();
    let dead = false, deadAng = 0, deadAngV = 0, restT = 0, overSent = false, hitFlash = 0, shake = 0;
    let nextX = 2.2;                         // the first hazards start well ahead (a grace second or two)
    let missileT = 7, laserT = 34, laserLock = 0, coinSndT = 0;
    const zaps = [], coinList = [], missiles = [], lasers = [];
    const smoke = Array.from({ length: 56 }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, t: 0, life: 1, hot: false }));
    let smokeI = 0, smokeAcc = 0;
    const beamPts = new Float32Array(24);    // jagged beam scratch buffer

    const metres = () => Math.floor(dist * M_PER_U);
    const diff = () => clamp(metres() / 2200, 0, 1);
    const thrusting = () => !dead && (ptrs > 0 || keys.size > 0);

    g.toast('Hold to fly', 1600);
    g.sub('● 0');

    // ---------------------------------------------------------------- input
    g.on('down', () => { ptrs++; });
    g.on('up', () => { ptrs = Math.max(0, ptrs - 1); });
    const THR_KEYS = [' ', 'ArrowUp', 'Enter', 'w', 'W'];
    g.on('key', (e) => { if (THR_KEYS.includes(e.key)) keys.add(e.key); });
    g.on('keyup', (e) => { keys.delete(e.key); });

    // ---------------------------------------------------------------- spawning
    function puff(x, y, vx, vy, r, life, hot) {
      const p = smoke[smokeI]; smokeI = (smokeI + 1) % smoke.length;
      p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.r = r; p.t = 0; p.life = life; p.hot = hot;
    }
    function addZap(x, y, len, a, rotV = 0) {
      if (!rotV) { // keep both nodes inside the corridor
        const hy = Math.abs(Math.sin(a)) * len / 2 + 0.045;
        y = clamp(y, CEIL + hy, FLOOR - hy);
      }
      zaps.push({ x, y, len, a, rotV, seed: rand(100) });
      return Math.abs(Math.cos(a)) * len;
    }
    function addCoinLine(x, y, n, dy = 0) {
      for (let i = 0; i < n; i++) coinList.push({ x: x + i * 0.065, y: clamp(y + dy * i, YMIN, YMAX), got: false, gt: 0 });
      return n * 0.065;
    }
    function addShape(x, yc, rows) {
      const s = 0.062, h = rows.length * s;
      rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '#') coinList.push({ x: x + c * s, y: yc - h / 2 + r * s, got: false, gt: 0 }); });
      return rows[0].length * s;
    }
    function spawnChunk() {
      const d = diff(), m = metres(), x = nextX;
      const mid = (CEIL + FLOOR) / 2;
      let w = 0;
      const r = Math.random();
      if (m < 40 || r < 0.2) {
        // a coin pattern
        const k = Math.random();
        if (k < 0.3) w = addCoinLine(x, rand(YMIN + 0.05, YMAX - 0.05), randN(7, 11));
        else if (k < 0.55) { const n = randN(12, 16), yc = rand(-0.2, 0.25), A = rand(0.08, 0.16); for (let i = 0; i < n; i++) coinList.push({ x: x + i * 0.062, y: yc + Math.sin(i / (n - 1) * TAU) * A, got: false, gt: 0 }); w = n * 0.062; }
        else w = addShape(x, rand(-0.12, 0.2), pick(SHAPES));
      } else if (r < 0.52) {
        // a single zapper, maybe spinning, with coins on the safe side
        const len = rand(0.26, 0.38 + d * 0.08), spin = Math.random() < 0.15 + d * 0.35;
        const a = pick([0, Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI / 2]);
        const y = rand(CEIL + 0.2, FLOOR - 0.2);
        w = spin ? len : addZap(x + len / 2, y, len, a);
        if (spin) addZap(x + len / 2, clamp(y, CEIL + len / 2 + 0.05, FLOOR - len / 2 - 0.05), len, rand(TAU), (Math.random() < 0.5 ? -1 : 1) * rand(1.1, 1.6 + d));
        w = Math.max(w, 0.08);
        if (Math.random() < 0.6) { const cy = y > mid ? rand(YMIN, mid - 0.15) : rand(mid + 0.15, YMAX); addCoinLine(x - 0.1, cy, 6); }
      } else if (r < 0.72) {
        // slalom: ceiling zapper, then a floor zapper (or the other way)
        const top = Math.random() < 0.5, len = rand(0.42, 0.52 + d * 0.1), gapX = lerp(0.62, 0.42, d);
        addZap(x, top ? CEIL + len / 2 + 0.04 : FLOOR - len / 2 - 0.04, len, Math.PI / 2);
        addZap(x + gapX, top ? FLOOR - len / 2 - 0.04 : CEIL + len / 2 + 0.04, len, Math.PI / 2);
        if (Math.random() < 0.5) addCoinLine(x + gapX / 2 - 0.1, top ? FLOOR - 0.12 : CEIL + 0.12, 4);
        w = gapX + 0.05;
      } else if (r < 0.88) {
        // a gate: zappers above and below a gap
        const gap = lerp(0.36, 0.25, d), gc = rand(CEIL + gap / 2 + 0.2, FLOOR - gap / 2 - 0.2);
        const l1 = gc - gap / 2 - CEIL - 0.05, l2 = FLOOR - (gc + gap / 2) - 0.05;
        if (l1 > 0.08) addZap(x, CEIL + 0.04 + l1 / 2, l1, Math.PI / 2);
        if (l2 > 0.08) addZap(x, FLOOR - 0.04 - l2 / 2, l2, Math.PI / 2);
        addCoinLine(x - 0.2, gc, 7);
        w = 0.25;
      } else {
        // a diagonal staircase
        const n = d > 0.4 ? 3 : 2, up = Math.random() < 0.5, len = 0.26;
        for (let i = 0; i < n; i++) {
          const yy = lerp(up ? FLOOR - 0.2 : CEIL + 0.2, up ? CEIL + 0.2 : FLOOR - 0.2, n === 1 ? 0.5 : i / (n - 1));
          addZap(x + i * 0.48, yy, len, up ? -Math.PI / 4 : Math.PI / 4);
        }
        w = (n - 1) * 0.48 + 0.2;
      }
      nextX = x + w + lerp(0.95, 0.6, d) + rand(0, 0.25);
    }
    const randN = (a, b) => Math.floor(rand(a, b + 1));

    function startLasers() {
      const d = diff();
      const slots = [-0.34, -0.17, 0, 0.17, 0.34];
      const n = d > 0.6 ? 3 : 2;
      const free = Math.floor(rand(slots.length));
      const pool = slots.map((s, i) => i).filter((i) => i !== free && i !== (free + 1) % slots.length);
      const pickd = [];
      while (pickd.length < n && pool.length) pickd.push(pool.splice(Math.floor(rand(pool.length)), 1)[0]);
      for (const i of pickd) lasers.push({ y: slots[i] + 0.04, t: 0, charge: 1.6, fire: 1.1 });
      if (Math.random() < 0.5 + d * 0.4) { // a second wave somewhere else
        const s2 = slots.filter((s, i) => !pickd.includes(i));
        for (let k = 0; k < Math.min(n, s2.length); k++) lasers.push({ y: s2[k] + 0.04, t: -2.9, charge: 1.4, fire: 1.0 });
      }
      laserLock = lasers.reduce((mx, l) => Math.max(mx, l.charge + l.fire - l.t), 0) + 0.4;
      g.sfx('tick');
    }

    function die(kind) {
      if (dead) return;
      dead = true; hitFlash = 1; shake = 1;
      deadAngV = rand(9, 13); vy = Math.min(vy, 0) - 0.7;
      g.sfx(kind === 'missile' ? 'boom' : 'laser'); g.sfx('hit'); g.vibrate(60);
      g.draw.burst(g.cx + PX * g.R, g.cy + py * g.R, kind === 'missile' ? '#ffb347' : '#7dd3fc', 26, g.R * 0.7, g.R * 0.012);
    }

    // ---------------------------------------------------------------- collisions
    function segDist(px, pyy, ax, ay, bx, by) {
      const vx = bx - ax, vyy = by - ay, l2 = vx * vx + vyy * vyy || 1;
      const t = clamp(((px - ax) * vx + (pyy - ay) * vyy) / l2, 0, 1);
      return Math.hypot(px - ax - vx * t, pyy - ay - vyy * t);
    }

    // ---------------------------------------------------------------- the frame
    g.loop((dt, t) => {
      const R = g.R, cx = g.cx, cy = g.cy;
      flick += dt;
      // ---- update: the pilot
      if (!dead) {
        speed = 0.8 + 1.0 * (1 - Math.exp(-metres() / 1800));
        const th = thrusting();
        const acc = th ? (vy > 0 ? -THRUST * 1.35 : -THRUST) + GRAV : GRAV;
        vy = clamp(vy + acc * dt, -1.45, 1.9);
        py += vy * dt;
        if (py >= YMAX) { if (!onFloor && vy > 1) { for (let i = 0; i < 4; i++) puff(PX + rand(-0.03, 0.03), YMAX + 0.07, rand(-0.3, 0.1) - speed * 0.2, rand(-0.15, -0.05), 0.012, 0.5, false); g.sfx('place', { volume: 0.5 }); } py = YMAX; vy = 0; onFloor = true; }
        else onFloor = false;
        if (py <= YMIN) { py = YMIN; vy = Math.max(0, vy * -0.2); }
        if (onFloor) runPh += dt * speed * 22;
        if (th) {
          smokeAcc += dt;
          while (smokeAcc > 0.028) { smokeAcc -= 0.028; puff(PX - 0.04 + rand(-0.006, 0.006), py + 0.06, -speed * 0.85 + rand(-0.08, 0.08), rand(0.45, 0.75), rand(0.008, 0.014), rand(0.45, 0.7), Math.random() < 0.5); }
        }
      } else {
        // ragdoll: tumble, bounce along the floor while the corridor slows down
        vy += GRAV * dt; py += vy * dt; deadAng += deadAngV * dt;
        const floorY = FLOOR - 0.05;
        if (py >= floorY) {
          py = floorY;
          if (vy > 0.25) { vy = -vy * 0.45; deadAngV *= 0.62; g.sfx('drop', { volume: 0.6 }); for (let i = 0; i < 5; i++) puff(PX + rand(-0.04, 0.04), FLOOR, rand(-0.2, 0.2), rand(-0.25, -0.08), 0.014, 0.6, false); }
          else { vy = 0; deadAngV *= Math.pow(0.05, dt); }
          speed = Math.max(0, speed - 1.3 * dt);
          if (speed > 0.15 && Math.random() < dt * 25) puff(PX + 0.04, FLOOR, -speed * 0.3, rand(-0.2, -0.05), 0.01, 0.4, true);
        } else speed = Math.max(0, speed - 0.25 * dt);
        if (speed <= 0.01 && vy === 0) {
          // settle flat on the floor
          const target = Math.round(deadAng / Math.PI) * Math.PI + Math.PI / 2;
          deadAng = lerp(deadAng, target, 1 - Math.pow(0.002, dt));
          restT += dt;
          if (restT > 0.45 && !overSent) {
            overSent = true;
            const m = metres();
            g.over(m + coins, { note: `${m.toLocaleString()} m flown + ${coins} coins`, delay: 1000 });
          }
        }
      }
      dist += speed * dt;
      hitFlash = Math.max(0, hitFlash - dt * 2.5); shake = Math.max(0, shake - dt * 2.2);
      coinSndT -= dt;

      // ---- update: spawning
      if (!dead) {
        if (laserLock > 0) { laserLock -= dt; nextX = Math.max(nextX, dist + 1.25); }
        else if (dist + 1.25 >= nextX) spawnChunk();
        const m = metres();
        if (m > 120 && laserLock <= 0) {
          missileT -= dt;
          if (missileT <= 0) {
            const salvo = Math.random() < diff() * 0.6 ? 2 : 1;
            for (let i = 0; i < salvo; i++) missiles.push({ state: 'warn', t: -i * 0.55, y: clamp(py + (i ? rand(-0.2, 0.2) : 0), YMIN, YMAX), x: 1.2, bl: 0 });
            missileT = rand(5.5, 9) - diff() * 3;
          }
        }
        if (m > 450) { laserT -= dt; if (laserT <= 0 && laserLock <= 0 && !missiles.length) { startLasers(); laserT = rand(20, 30); } }
      }

      // zappers
      for (let i = zaps.length - 1; i >= 0; i--) {
        const z = zaps[i];
        z.a += z.rotV * dt;
        const sx = z.x - dist;
        if (sx < -1.4) { zaps.splice(i, 1); continue; }
        const hx = Math.cos(z.a) * z.len / 2, hy = Math.sin(z.a) * z.len / 2;
        z.ax = sx - hx; z.ay = z.y - hy; z.bx = sx + hx; z.by = z.y + hy;
        if (!dead && Math.abs(sx - PX) < z.len / 2 + 0.1 && segDist(PX, py, z.ax, z.ay, z.bx, z.by) < HR + 0.016) die('zap');
      }
      // coins
      for (let i = coinList.length - 1; i >= 0; i--) {
        const c = coinList[i];
        const sx = c.x - dist;
        if (sx < -1.2) { coinList.splice(i, 1); continue; }
        if (c.got) { c.gt += dt; if (c.gt > 0.35) coinList.splice(i, 1); continue; }
        if (!dead && Math.abs(sx - PX) < 0.07 && Math.abs(c.y - py) < 0.085) {
          c.got = true; coins++;
          if (coinSndT <= 0) { g.sfx('coin', { volume: 0.6 }); coinSndT = 0.07; }
        }
      }
      // missiles
      for (let i = missiles.length - 1; i >= 0; i--) {
        const ms = missiles[i];
        ms.t += dt;
        if (ms.state === 'warn') {
          if (ms.t < 0) continue;
          if (ms.t < 1.05 && !dead) ms.y = lerp(ms.y, py, 1 - Math.pow(0.02, dt));
          const blink = Math.floor(ms.t * (ms.t > 1.05 ? 14 : 6));
          if (blink !== ms.bl) { ms.bl = blink; if (blink % 2 === 0) g.sfx('tick'); }
          if (ms.t > 1.45) { ms.state = 'fly'; ms.x = 1.15; g.sfx('whoosh'); }
        } else {
          ms.x -= (1.6 + speed) * dt;
          if (Math.random() < dt * 40) puff(ms.x + 0.07, ms.y + rand(-0.01, 0.01), rand(0.1, 0.3), rand(-0.05, 0.05), 0.012, 0.5, Math.random() < 0.4);
          if (ms.x < -1.3) { missiles.splice(i, 1); continue; }
          if (!dead && Math.abs(ms.x - PX) < HR + 0.05 && Math.abs(ms.y - py) < HR + 0.018) die('missile');
        }
      }
      // lasers
      for (let i = lasers.length - 1; i >= 0; i--) {
        const L = lasers[i];
        L.t += dt;
        if (L.t > L.charge && L.t - dt <= L.charge) { g.sfx('laser'); g.vibrate(15); }
        if (L.t > L.charge + L.fire + 0.35) { lasers.splice(i, 1); continue; }
        if (!dead && L.t > L.charge + 0.05 && L.t < L.charge + L.fire && Math.abs(L.y - py) < HR + 0.02) die('laser');
      }
      // smoke
      for (const p of smoke) {
        if (!p.on) continue;
        p.t += dt; if (p.t > p.life) { p.on = false; continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= Math.pow(0.15, dt); p.vx *= Math.pow(0.6, dt);
        if (p.y > FLOOR - 0.005) { p.y = FLOOR - 0.005; p.vy = -Math.abs(p.vy) * 0.2; }
        p.r += dt * 0.06;
      }

      const m = metres();
      if (m !== shownM) { shownM = m; g.score(m); }
      if (coins !== shownC) { shownC = coins; g.sub(`● ${coins}`); }

      // ---------------------------------------------------------------- draw
      buildStatic();
      ctx.drawImage(stat, 0, 0, g.S, g.S);
      ctx.save();
      g.draw.clipCircle(R * 0.995);
      const sk = shake * shake * R * 0.025;
      ctx.translate(cx + rand(-sk, sk), cy + rand(-sk, sk));
      ctx.scale(R, R);
      drawCorridor(t);

      // coins
      ctx.fillStyle = '#ffc857';
      for (const c of coinList) {
        const sx = c.x - dist;
        if (sx > 1.05 || sx < -1.05) continue;
        if (c.got) {
          const k = c.gt / 0.35;
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 0.006;
          ctx.beginPath(); ctx.arc(sx, c.y - k * 0.04, 0.022 + k * 0.03, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
          continue;
        }
        const w = Math.max(0.2, Math.abs(Math.cos(t * 3.2 + c.x * 6)));
        ctx.fillStyle = '#e09a1c';
        ctx.beginPath(); ctx.ellipse(sx, c.y, 0.022 * w, 0.022, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffc857';   // flat: a solid rim tone and a solid face, no shine
        ctx.beginPath(); ctx.ellipse(sx, c.y, 0.016 * w, 0.016, 0, 0, TAU); ctx.fill();
      }

      // zappers
      for (const z of zaps) {
        if (z.ax === undefined || Math.min(z.ax, z.bx) > 1.1 || Math.max(z.ax, z.bx) < -1.1) continue;
        drawZap(z, t);
      }
      // lasers
      for (const L of lasers) if (L.t >= 0) drawLaser(L, t);
      // smoke (behind the pilot)
      for (const p of smoke) {
        if (!p.on) continue;
        const k = p.t / p.life;
        ctx.globalAlpha = (1 - k) * (p.hot ? 0.75 : 0.4);
        ctx.fillStyle = p.hot && k < 0.35 ? '#ffb347' : '#8a8f9c';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // missiles in flight
      for (const ms of missiles) if (ms.state === 'fly') drawMissile(ms.x, ms.y, t);
      // the pilot
      drawPilot(PX, py, t);
      // missile warnings at the right edge
      for (const ms of missiles) if (ms.state === 'warn' && ms.t >= 0) drawWarning(ms);
      ctx.restore();

      // distance markers painted on the wall (text drawn unscaled)
      const nextMark = Math.ceil((dist - 1.2) * M_PER_U / 100) * 100;
      for (let mk = Math.max(100, nextMark); mk <= (dist + 1.2) * M_PER_U; mk += 100) {
        const sx = mk / M_PER_U - dist;
        g.draw.text(`${mk} m`, cx + sx * R, cy + (FLOOR - 0.1) * R, R * 0.05, { color: lab().mark, weight: 700 });
      }

      ctx.beginPath(); ctx.arc(cx, cy, R * 0.948, 0, TAU); ctx.strokeStyle = g.theme.line; ctx.lineWidth = Math.max(1, R * 0.008); ctx.stroke();
      if (hitFlash > 0) { ctx.fillStyle = `rgba(${lab().flash},${hitFlash * 0.35})`; ctx.fillRect(0, 0, g.S, g.S); }
      g.draw.particles(dt, R * 1.2);
      g.draw.floaters(dt);
    });

    // ---------------------------------------------------------------- drawing helpers (in R units)
    // everything that doesn't scroll is painted once into an offscreen layer (cheap on the Pi)
    let stat = null, statKey = '', coneGrad = null;
    function buildStatic() {
      const key = `${g.S}|${g.dpr}|${THEME.id}|${THEME.mode}`;
      if (stat && statKey === key) return;
      statKey = key;
      stat ||= document.createElement('canvas');
      stat.width = Math.max(1, Math.round(g.S * g.dpr)); stat.height = stat.width;
      const c = stat.getContext('2d');
      c.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      c.fillStyle = g.theme.bg; c.fillRect(0, 0, g.S, g.S);
      c.save();
      c.beginPath(); c.arc(g.cx, g.cy, g.R * 0.995, 0, TAU); c.clip();
      c.translate(g.cx, g.cy); c.scale(g.R, g.R);
      const pal = lab(), flat = THEME.flat;
      const vgrad = (y0, y1, cols, stops) => {
        if (flat) return cols[1];   // flat themes: no gradients
        const gr = c.createLinearGradient(0, y0, 0, y1);
        cols.forEach((col, i) => gr.addColorStop(stops[i], col));
        return gr;
      };
      c.fillStyle = vgrad(CEIL, FLOOR, pal.wall, [0, 0.55, 1]); c.fillRect(-1, CEIL, 2, FLOOR - CEIL);
      // lower wall band
      c.fillStyle = pal.band; c.fillRect(-1, 0.3, 2, FLOOR - 0.3);
      c.fillStyle = pal.trim; c.fillRect(-1, 0.3, 2, 0.004);
      // ceiling
      c.fillStyle = pal.ceil; c.fillRect(-1, -1, 2, 1 + CEIL);
      c.fillStyle = pal.ceilLip; c.fillRect(-1, CEIL - 0.035, 2, 0.035);
      c.strokeStyle = pal.ceilLine; c.lineWidth = 0.022; c.beginPath(); c.moveTo(-1, CEIL - 0.07); c.lineTo(1, CEIL - 0.07); c.stroke();
      c.strokeStyle = pal.ceilHi; c.lineWidth = 0.004; c.beginPath(); c.moveTo(-1, CEIL - 0.077); c.lineTo(1, CEIL - 0.077); c.stroke();
      c.fillStyle = pal.trim2; c.fillRect(-1, CEIL - 0.002, 2, 0.004);
      // floor
      c.fillStyle = vgrad(FLOOR, 1, pal.floor, [0, 0.25, 1]); c.fillRect(-1, FLOOR, 2, 1 - FLOOR);
      c.fillStyle = pal.floorLip; c.fillRect(-1, FLOOR, 2, 0.022);
      c.fillStyle = pal.trim2; c.fillRect(-1, FLOOR - 0.002, 2, 0.004);
      c.restore();
      if (flat) coneGrad = g.draw.alpha(pal.cone, THEME.light ? 0.16 : 0.07);
      else {
        coneGrad = ctx.createLinearGradient(0, CEIL, 0, CEIL + 0.55);
        coneGrad.addColorStop(0, pal.cone); coneGrad.addColorStop(1, pal.cone0);
      }
    }
    function drawCorridor(t) {
      const o = dist * 0.5;  // the wall scrolls at half speed (parallax)
      const pal = lab();
      // panel seams
      ctx.strokeStyle = pal.seam; ctx.lineWidth = 0.004;
      ctx.beginPath();
      const P = 0.42;
      for (let k = Math.floor((o - 1) / P); k * P - o < 1.05; k++) { const x = k * P - o; ctx.moveTo(x, CEIL); ctx.lineTo(x, FLOOR); }
      ctx.stroke();
      // portholes and glowing tanks, every third panel
      for (let k = Math.floor((o - 1.2) / (P * 3)); k * P * 3 - o < 1.2; k++) {
        const x = k * P * 3 - o + P * 1.5;
        if (((k % 2) + 2) % 2 === 0) {
          ctx.fillStyle = pal.port; ctx.beginPath(); ctx.arc(x, -0.1, 0.1, 0, TAU); ctx.fill();
          ctx.fillStyle = pal.portGlass; ctx.beginPath(); ctx.arc(x, -0.1, 0.085, 0, TAU); ctx.fill();
          ctx.fillStyle = pal.star;
          for (let s = 0; s < 3; s++) { const a = k * 1.7 + s * 2.1; ctx.fillRect(x + Math.cos(a) * 0.05, -0.1 + Math.sin(a * 1.3) * 0.05, 0.005, 0.005); }
          ctx.strokeStyle = pal.frame; ctx.lineWidth = 0.016; ctx.beginPath(); ctx.arc(x, -0.1, 0.1, 0, TAU); ctx.stroke();
        } else {
          // a bubbling tank
          ctx.fillStyle = pal.tank; ctx.beginPath(); ctx.roundRect(x - 0.055, -0.3, 0.11, 0.5, 0.05); ctx.fill();
          ctx.fillStyle = pal.liquid; ctx.beginPath(); ctx.roundRect(x - 0.042, -0.22, 0.084, 0.4, 0.04); ctx.fill();
          ctx.fillStyle = pal.fizz;
          for (let s = 0; s < 4; s++) { const ph = (t * 0.35 + s * 0.27 + k * 0.13) % 1; ctx.beginPath(); ctx.arc(x + Math.sin(s * 2.3 + k) * 0.022, 0.16 - ph * 0.36, 0.007 + s * 0.002, 0, TAU); ctx.fill(); }
          ctx.strokeStyle = pal.frame; ctx.lineWidth = 0.01; ctx.beginPath(); ctx.roundRect(x - 0.055, -0.3, 0.11, 0.5, 0.05); ctx.stroke();
        }
      }
      // ceiling: lamps with soft light cones (they scroll with the floor)
      const L = 0.84;
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      for (let k = Math.floor((dist - 1.3) / L); k * L - dist < 1.3; k++) { const x = k * L - dist + 0.3; ctx.moveTo(x - 0.05, CEIL); ctx.lineTo(x + 0.05, CEIL); ctx.lineTo(x + 0.22, CEIL + 0.55); ctx.lineTo(x - 0.22, CEIL + 0.55); ctx.closePath(); }
      ctx.fill();
      ctx.fillStyle = pal.lamp;
      for (let k = Math.floor((dist - 1.3) / L); k * L - dist < 1.3; k++) { const x = k * L - dist + 0.3; ctx.fillRect(x - 0.05, CEIL - 0.008, 0.1, 0.012); }
      // floor seams
      ctx.strokeStyle = pal.floorSeam; ctx.lineWidth = 0.004;
      ctx.beginPath();
      const T = 0.21;
      for (let k = Math.floor((dist - 1) / T); k * T - dist < 1.05; k++) { const x = k * T - dist; ctx.moveTo(x, FLOOR + 0.022); ctx.lineTo(x - 0.06, 1); }
      ctx.stroke();
      // hazard stripes on the floor lip
      ctx.fillStyle = pal.hazard;
      ctx.beginPath();
      for (let k = Math.floor((dist - 1) / 0.06); k * 0.06 - dist < 1.05; k++) { if (k % 14 > 5) continue; const x = k * 0.06 - dist; ctx.moveTo(x, FLOOR + 0.022); ctx.lineTo(x + 0.025, FLOOR + 0.022); ctx.lineTo(x + 0.045, FLOOR); ctx.lineTo(x + 0.02, FLOOR); ctx.closePath(); }
      ctx.fill();
    }
    function drawZap(z, t) {
      const { ax, ay, bx, by } = z;
      // jagged beam, re-rolled ~20 times a second
      const n = 10, seg = Math.floor(t * 22 + z.seed);
      const nx = -(by - ay) / z.len, ny = (bx - ax) / z.len;
      for (let i = 0; i <= n; i++) {
        const k = i / n, j = i === 0 || i === n ? 0 : (hash(seg * 31 + i * 7 + z.seed) - 0.5) * 0.03;
        beamPts[i * 2] = ax + (bx - ax) * k + nx * j; beamPts[i * 2 + 1] = ay + (by - ay) * k + ny * j;
      }
      const path = () => { ctx.beginPath(); ctx.moveTo(beamPts[0], beamPts[1]); for (let i = 1; i <= n; i++) ctx.lineTo(beamPts[i * 2], beamPts[i * 2 + 1]); };
      const pal = lab();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = pal.zapHalo; ctx.lineWidth = 0.05;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      path(); ctx.strokeStyle = pal.zapMid; ctx.lineWidth = 0.016; ctx.stroke();
      path(); ctx.strokeStyle = pal.zapCore; ctx.lineWidth = 0.006; ctx.stroke();
      // nodes
      for (let e = 0; e < 2; e++) {
        const x = e ? bx : ax, y = e ? by : ay;
        ctx.fillStyle = pal.zapNode; ctx.beginPath(); ctx.arc(x, y, 0.05, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3a4258'; ctx.beginPath(); ctx.arc(x, y, 0.033, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e8f7ff'; ctx.beginPath(); ctx.arc(x, y, 0.017 + Math.sin(t * 30 + e) * 0.002, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 0.005; ctx.beginPath(); ctx.arc(x, y, 0.033, 0, TAU); ctx.stroke();
      }
    }
    function drawLaser(L, t) {
      const y = L.y, ex = Math.sqrt(Math.max(0, 0.79 - y * y));
      const slide = clamp(L.t / 0.3, 0, 1) * clamp((L.charge + L.fire + 0.35 - L.t) / 0.3, 0, 1);
      const firing = L.t > L.charge && L.t < L.charge + L.fire;
      const ch = clamp(L.t / L.charge, 0, 1);
      if (firing) {
        const w = 1 + Math.sin(t * 60) * 0.12;
        ctx.fillStyle = 'rgba(255,90,106,.22)'; ctx.fillRect(-ex, y - 0.04 * w, ex * 2, 0.08 * w);
        if (THEME.glow) { ctx.shadowColor = '#ff5a6a'; ctx.shadowBlur = 16; }
        ctx.fillStyle = 'rgba(255,90,106,.8)'; ctx.fillRect(-ex, y - 0.018 * w, ex * 2, 0.036 * w);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff4f5'; ctx.fillRect(-ex, y - 0.006, ex * 2, 0.012);
      } else if (L.t <= L.charge) {
        // charge-up: a thin flickering line that gets brighter
        ctx.globalAlpha = 0.25 + 0.5 * ch * (0.6 + 0.4 * Math.sin(t * 40));
        ctx.fillStyle = '#ff5a6a'; ctx.fillRect(-ex, y - 0.0025, ex * 2, 0.005);
        ctx.globalAlpha = 1;
      }
      // emitters on both sides
      for (let s = -1; s <= 1; s += 2) {
        const x = s * (ex + 0.06 - 0.06 * slide);
        ctx.fillStyle = '#2a3042'; ctx.beginPath(); ctx.roundRect(x - (s > 0 ? 0 : 0.07), y - 0.035, 0.07, 0.07, 0.015); ctx.fill();
        const glow = firing ? 1 : ch;
        ctx.fillStyle = `rgba(255,90,106,${0.25 + 0.6 * glow})`;
        ctx.beginPath(); ctx.arc(x + (s > 0 ? 0.01 : -0.01), y, 0.014 + glow * 0.012, 0, TAU); ctx.fill();
        if (!firing && L.t <= L.charge) { ctx.strokeStyle = 'rgba(255,90,106,.6)'; ctx.lineWidth = 0.004; ctx.beginPath(); ctx.arc(x + (s > 0 ? 0.01 : -0.01), y, 0.05 * (1 - ch) + 0.02, 0, TAU); ctx.stroke(); }
      }
    }
    function drawMissile(x, y, t) {
      ctx.save(); ctx.translate(x, y);
      // flame
      const f = 0.05 + Math.sin(t * 50) * 0.012;
      ctx.fillStyle = 'rgba(255,170,60,.85)';
      ctx.beginPath(); ctx.moveTo(0.06, -0.012); ctx.lineTo(0.06 + f, 0); ctx.lineTo(0.06, 0.012); ctx.fill();
      ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.moveTo(0.06, -0.006); ctx.lineTo(0.06 + f * 0.5, 0); ctx.lineTo(0.06, 0.006); ctx.fill();
      // body
      ctx.fillStyle = '#d9dde6'; ctx.beginPath(); ctx.roundRect(-0.04, -0.015, 0.1, 0.03, 0.01); ctx.fill();
      ctx.fillStyle = '#ff5a6a'; ctx.beginPath(); ctx.moveTo(-0.04, -0.015); ctx.quadraticCurveTo(-0.075, 0, -0.04, 0.015); ctx.fill();
      ctx.fillRect(0.0, -0.015, 0.012, 0.03);
      ctx.fillStyle = '#9aa1b2';
      ctx.beginPath(); ctx.moveTo(0.03, -0.015); ctx.lineTo(0.06, -0.032); ctx.lineTo(0.06, -0.015); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0.03, 0.015); ctx.lineTo(0.06, 0.032); ctx.lineTo(0.06, 0.015); ctx.fill();
      ctx.restore();
    }
    function drawWarning(ms) {
      const y = ms.y, ex = Math.sqrt(Math.max(0, 0.85 - y * y)) - 0.08;
      const locked = ms.t > 1.05;
      const on = Math.floor(ms.t * (locked ? 14 : 6)) % 2 === 0;
      const s = locked ? 1.15 : 1;
      ctx.save(); ctx.translate(ex, y); ctx.scale(s, s);
      if (on && THEME.glow) { ctx.shadowColor = '#ff5a6a'; ctx.shadowBlur = 14; }
      ctx.fillStyle = on ? '#ff5a6a' : 'rgba(255,90,106,.35)';
      ctx.beginPath(); ctx.moveTo(0, -0.05); ctx.lineTo(0.047, 0.035); ctx.lineTo(-0.047, 0.035); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.fillRect(-0.005, -0.022, 0.01, 0.034); ctx.fillRect(-0.005, 0.018, 0.01, 0.01);
      ctx.restore();
    }
    function drawPilot(x, y, t) {
      const th = thrusting();
      ctx.save(); ctx.translate(x, y); ctx.scale(1.15, 1.15);
      if (dead) ctx.rotate(-deadAng);
      else ctx.rotate(clamp(vy * 0.12, -0.15, 0.2));
      // flame from the jetpack nozzle
      if (th) {
        const fl = 0.07 + Math.sin(flick * 70) * 0.012 + Math.sin(flick * 23) * 0.01;
        if (!THEME.light) ctx.globalCompositeOperation = 'lighter';   // additive fire would wash out on the bright day lab
        ctx.fillStyle = 'rgba(255,120,40,.75)';
        ctx.beginPath(); ctx.moveTo(-0.055, 0.045); ctx.quadraticCurveTo(-0.04, 0.045 + fl * 0.7, -0.04 + Math.sin(flick * 40) * 0.006, 0.045 + fl); ctx.quadraticCurveTo(-0.025, 0.045 + fl * 0.7, -0.025, 0.045); ctx.fill();
        ctx.fillStyle = 'rgba(255,240,180,.9)';
        ctx.beginPath(); ctx.moveTo(-0.049, 0.045); ctx.quadraticCurveTo(-0.04, 0.045 + fl * 0.45, -0.04, 0.045 + fl * 0.6); ctx.quadraticCurveTo(-0.031, 0.045 + fl * 0.45, -0.031, 0.045); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      // legs
      const running = onFloor && !dead;
      const sw = running ? Math.sin(runPh) : 0;
      const dangle = dead ? Math.sin(t * 18) * 0.6 : th ? 0.25 : -0.15;
      const leg = (ph, back) => {
        const a1 = running ? ph * 0.75 : dangle * (back ? 1 : -0.6) + (back ? 0.15 : -0.1);
        const kx = Math.sin(a1) * 0.032, ky = 0.03 + Math.cos(a1) * 0.032;
        const a2 = running ? a1 - 0.6 - Math.max(0, -ph) * 0.9 : a1 - 0.4;
        const fx = kx + Math.sin(a2) * 0.03, fy = ky + Math.cos(a2) * 0.03;
        ctx.strokeStyle = back ? '#2b3140' : '#3a4256'; ctx.lineWidth = 0.02; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 0.03); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
        ctx.fillStyle = back ? '#c75d1f' : '#fb923c';
        ctx.beginPath(); ctx.ellipse(fx + 0.008, fy + 0.004, 0.016, 0.009, 0, 0, TAU); ctx.fill();
      };
      leg(-sw, true);
      // jetpack
      ctx.fillStyle = '#5b6478'; ctx.beginPath(); ctx.roundRect(-0.058, -0.045, 0.036, 0.085, 0.012); ctx.fill();
      ctx.fillStyle = '#8c95aa'; ctx.beginPath(); ctx.roundRect(-0.054, -0.041, 0.012, 0.07, 0.006); ctx.fill();
      ctx.fillStyle = '#fb923c'; ctx.fillRect(-0.058, -0.012, 0.036, 0.008);
      ctx.fillStyle = '#2b3140'; ctx.beginPath(); ctx.roundRect(-0.052, 0.036, 0.024, 0.014, 0.004); ctx.fill();
      // body (a little lab suit)
      ctx.fillStyle = '#e9edf5'; ctx.beginPath(); ctx.roundRect(-0.028, -0.035, 0.054, 0.072, 0.02); ctx.fill();
      if (THEME.light) { ctx.strokeStyle = '#7d889e'; ctx.lineWidth = 0.005; ctx.stroke(); }   // keep the white suit apart from the bright wall
      ctx.fillStyle = '#cfd5e2'; ctx.fillRect(-0.028, 0.014, 0.054, 0.01);
      ctx.fillStyle = '#fb923c'; ctx.fillRect(0.004, -0.02, 0.012, 0.008);
      leg(sw, false);
      // arm
      const arm = running ? -Math.sin(runPh) * 0.6 : th ? -0.9 : -0.3;
      ctx.strokeStyle = '#dfe4ee'; ctx.lineWidth = 0.017;
      ctx.beginPath(); ctx.moveTo(0.0, -0.018); ctx.lineTo(Math.sin(arm + 0.6) * 0.03, -0.018 + Math.cos(arm + 0.6) * 0.03); ctx.lineTo(Math.sin(arm + 1.4) * 0.03 + Math.sin(arm + 0.6) * 0.03, -0.018 + Math.cos(arm + 0.6) * 0.03 + Math.cos(arm + 1.4) * 0.024); ctx.stroke();
      // head: round helmet with a visor
      ctx.fillStyle = '#fb923c'; ctx.beginPath(); ctx.arc(0.004, -0.064, 0.034, 0, TAU); ctx.fill();
      ctx.fillStyle = dead ? '#38415a' : '#1c2333'; ctx.beginPath(); ctx.roundRect(0.006, -0.077, 0.034, 0.024, 0.011); ctx.fill();
      ctx.fillStyle = dead ? 'rgba(255,255,255,.25)' : '#67e8f9'; ctx.beginPath(); ctx.roundRect(0.012, -0.072, 0.024, 0.008, 0.004); ctx.fill();
      ctx.restore();
    }
    const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

    return {
      pause() { ptrs = 0; keys.clear(); },
      resume() { ptrs = 0; keys.clear(); },
    };
  },
};
