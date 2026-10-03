// Ring Invaders — a round take on the arcade classic. Your ship flies around the rim and fires inward;
// the invaders pour out of the core in rings that slowly turn and step outward. Shields erode, a
// mothership sometimes cruises past for big points, and if an invader reaches the rim it's over.
import { TAU, rand, clamp, lerp, angDiff, ease } from './kit.js';

// ---------------------------------------------------------------- sprites (our own designs, 11×8, two frames)
const SPRITES = [
  { // 0 — "Lantern": inner ring, 30 pts
    color: '#ff8ad8', pts: 30,
    frames: [[
      '....###....',
      '..#######..',
      '.##.###.##.',
      '.#########.',
      '..#.###.#..',
      '...#...#...',
      '..#.....#..',
      '...#...#...',
    ], [
      '....###....',
      '..#######..',
      '.##.###.##.',
      '.#########.',
      '..#.###.#..',
      '..#.....#..',
      '...#...#...',
      '..#.....#..',
    ]],
  },
  { // 1 — "Horn-eye": middle rings, 20 pts
    color: '#ffc857', pts: 20,
    frames: [[
      '#.........#',
      '.#.#####.#.',
      '..#######..',
      '.###...###.',
      '.###.#.###.',
      '..#######..',
      '..#.#.#.#..',
      '.#.......#.',
    ], [
      '.#.......#.',
      '.#.#####.#.',
      '..#######..',
      '.###...###.',
      '.###.#.###.',
      '..#######..',
      '.#.#...#.#.',
      '#.........#',
    ]],
  },
  { // 2 — "Drone": outer rings, 10 pts
    color: '#2ee6d6', pts: 10,
    frames: [[
      '....###....',
      '..#.###.#..',
      '.#########.',
      '###.#.#.###',
      '.#########.',
      '...#...#...',
      '..##...##..',
      '.#.......#.',
    ], [
      '....###....',
      '..#.###.#..',
      '.#########.',
      '###.#.#.###',
      '.#########.',
      '...#...#...',
      '...##.##...',
      '..#.....#..',
    ]],
  },
];

export default {
  howTo: 'Drag anywhere to fly your ship around the rim — it fires while you touch. Stop the rings of invaders before they reach the edge. (← → or wheel to fly, space to fire.)',
  scoring: 'high',
  create(g) {
    const TRACK = 0.86, SHIELD_R = 0.705, SHIELD_T = 0.05, INV = 0.07, DANGER = TRACK - 0.075;
    const MAX_SPIN = 3.6;                              // ship's max angular speed, rad/s
    const SH_COLS = 6, SH_ROWS = 3, SH_SPAN = 0.27, SH_N = 6;
    const ME = '#8bff6a', UFO = '#ff5a6a';

    let lives = 3, wave = 0, phase = 'play', phaseT = 0;
    const ship = { a: Math.PI, v: 0, target: Math.PI, alive: true, inv: 0, respawn: 0, fireT: 0, recoil: 0 };
    let invaders = [], shots = [], bombs = [], shields = [], ufo = null, ufoT = rand(16, 24);
    const form = { rot: 0, dir: 1, expand: 0, expandTo: 0, beat: 0, beatT: 0, beatN: 0, emerge: 0, total: 1 };
    let fireT = 2, flash = 0, flashCol = UFO, shake = 0, coreKick = 0;
    let touching = false, ptrA = null, keyDir = 0, keyT = 0, keyFire = false;

    // ---------- pre-rendered glowing sprites ----------
    let sprites = [];
    function buildSprites() {
      const px = (INV * g.R) / 11, pad = px * 3, dpr = g.dpr || 1;
      sprites = SPRITES.map((s) => s.frames.map((rows) => {
        const w = 11 * px + pad * 2, h = 8 * px + pad * 2;
        const c = document.createElement('canvas');
        c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
        const x = c.getContext('2d'); x.scale(dpr, dpr);
        x.shadowColor = s.color; x.shadowBlur = px * 2.4; x.fillStyle = s.color;
        rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') x.fillRect(pad + i * px, pad + j * px, px + 0.4, px + 0.4); }));
        x.shadowBlur = 0; x.globalAlpha = 0.35; x.fillStyle = '#fff';  // a lighter core so they read as neon
        rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') x.fillRect(pad + i * px + px * 0.25, pad + j * px + px * 0.25, px * 0.5, px * 0.5); }));
        return { c, w, h };
      }));
    }
    buildSprites();
    g.on('resize', buildSprites);

    // background stars (fixed, drift slowly)
    const stars = Array.from({ length: 60 }, () => ({ a: rand(TAU), r: Math.sqrt(rand(0.02, 0.9)), s: rand(0.6, 1.6), tw: rand(TAU) }));

    // ---------- waves ----------
    function buildShields() {
      shields = [];
      for (let k = 0; k < SH_N; k++) {
        const a0 = (k + 0.5) * (TAU / SH_N) - SH_SPAN / 2;
        const cells = [];
        for (let i = 0; i < SH_COLS * SH_ROWS; i++) cells.push(2);
        // round the outer corners off a bit, like a bunker
        cells[0] = cells[SH_COLS - 1] = 0;
        shields.push({ a0, cells });
      }
    }
    function newWave() {
      wave++;
      invaders = []; bombs = []; shots = [];
      const rings = Math.min(3 + Math.ceil(wave / 2), 5);
      const pattern = (wave - 1) % 3;                        // 0 full rings · 1 sectors · 2 twisted
      for (let ring = 0; ring < rings; ring++) {
        const base = 0.15 + ring * 0.088;
        const type = ring === 0 ? 0 : ring < Math.ceil(rings / 2) ? 1 : 2;
        const n = clamp(Math.round((TAU * base) / (INV * 2.2)), 6, 20);
        const twist = pattern === 2 ? ring * 0.22 : 0;
        for (let i = 0; i < n; i++) {
          const off = (i / n) * TAU + twist;
          if (pattern === 1) { const sec = (((i / n) * 4) % 1); if (sec > 0.72 && ring > 0) continue; }  // four sectors with gaps
          invaders.push({ ring, base, off, type, alive: true, x: 0, y: 0, a: 0, r: 0 });
        }
      }
      form.total = invaders.length;
      form.rot = 0; form.dir = wave % 2 ? 1 : -1;
      form.expand = form.expandTo = Math.min(0.025 * (wave - 1), 0.1);
      form.beat = 0; form.beatT = 0.5; form.beatN = 0; form.emerge = 0;
      fireT = 2.2;
      buildShields();
      phase = 'play';
      coreKick = 1;
      g.toast(wave === 1 ? 'Defend the rim!' : `Wave ${wave}`, 1300);
      g.sfx('whoosh');
      sub();
    }
    const sub = () => g.sub(`Wave ${wave}  ·  ${'♥'.repeat(Math.max(0, lives))}${'♡'.repeat(Math.max(0, 3 - lives))}`);

    newWave();
    ship.inv = 1.5;

    // ---------- input ----------
    g.on('down', (p) => { touching = true; if (p.r > 0.14) ptrA = p.a; });
    g.on('move', (p) => { if (touching && p.r > 0.14) ptrA = p.a; });
    g.on('up', () => { touching = false; ptrA = null; });
    g.on('key', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        keyDir = e.key === 'ArrowLeft' ? -1 : 1; keyT = 0;
        ship.target = ship.a + keyDir * 0.22;              // a tap (or one rotary click) is a small step
      } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') { keyFire = true; fire(); }
    });
    g.on('keyup', (e) => {
      if ((e.key === 'ArrowLeft' && keyDir < 0) || (e.key === 'ArrowRight' && keyDir > 0)) {
        if (keyT > 0.18) ship.target = ship.a + ship.v * 0.04;
        keyDir = 0;
      } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') keyFire = false;
    });
    g.on('wheel', (e) => { ship.target += e.delta * 0.2; });

    // ---------- actions ----------
    function fire() {
      if (!ship.alive || phase === 'over' || ship.fireT > 0 || shots.length >= 4) return;
      ship.fireT = 0.27; ship.recoil = 1;
      shots.push({ a: ship.a, r: (TRACK - 0.05) * g.R });
      g.sfx('laser', { volume: 0.45, pitch: rand(0.95, 1.08) });
    }
    function pos(a, r) { return [g.cx + Math.sin(a) * r, g.cy - Math.cos(a) * r]; }

    function killInvader(v) {
      v.alive = false;
      const sp = SPRITES[v.type];
      g.draw.burst(v.x, v.y, sp.color, 12, g.R * 0.45, g.R * 0.009);
      g.draw.float(`${sp.pts}`, v.x, v.y, sp.color, g.R * 0.045);
      g.add(sp.pts);
      g.sfx('pop', { pitch: [1.3, 1.1, 0.9][v.type], volume: 0.7 });
    }
    function hitShip() {
      ship.alive = false; ship.respawn = 1.7; lives--;
      const [x, y] = pos(ship.a, TRACK * g.R);
      g.draw.burst(x, y, ME, 34, g.R * 0.8, g.R * 0.014);
      g.draw.burst(x, y, '#fff', 14, g.R * 0.5, g.R * 0.01);
      flash = 1; flashCol = UFO; shake = 0.45;
      g.sfx('boom'); g.vibrate(60);
      bombs = [];
      sub();
      if (lives <= 0) end(`You held out until wave ${wave}.`);
      else g.toast(lives === 1 ? 'Last ship!' : 'Ship lost', 1000);
    }
    function invaded() {
      if (phase === 'over') return;
      if (ship.alive) {
        ship.alive = false;
        const [x, y] = pos(ship.a, TRACK * g.R);
        g.draw.burst(x, y, ME, 34, g.R * 0.8, g.R * 0.014);
      }
      lives = 0; sub();
      flash = 1; flashCol = UFO; shake = 0.6; g.sfx('boom'); g.vibrate(80);
      end(`They reached the rim on wave ${wave}.`);
    }
    function end(note) {
      phase = 'over';
      g.over(g.scoreValue, { note, label: `Wave ${wave}`, delay: 1500 });
    }
    function spawnUfo() {
      let outer = 0, inner = 9;
      for (const v of invaders) if (v.alive) { outer = Math.max(outer, v.base + form.expand); inner = Math.min(inner, v.base + form.expand); }
      let r = 0;
      if (outer + 0.12 < SHIELD_R - 0.07) r = SHIELD_R - 0.075;
      else if (inner - 0.12 > 0.1) r = inner - 0.1;
      if (!r) return false;
      const dir = Math.random() < 0.5 ? 1 : -1;
      ufo = { a: rand(TAU), dir, r, left: TAU * 0.65, pts: [50, 100, 150, 300][Math.floor(rand(4))], t: 0 };
      g.sfx('whoosh', { pitch: 0.6 });
      return true;
    }

    // ---------- frame ----------
    g.loop((dt, t) => {
      const { ctx, cx, cy, R } = g;
      const live = phase !== 'over';
      // ---- ship ----
      ship.fireT -= dt; ship.recoil = Math.max(0, ship.recoil - dt * 6); ship.inv -= dt;
      if (keyDir) { keyT += dt; if (keyT > 0.12) ship.target = ship.a + keyDir * 0.6; }
      if (touching && ptrA != null) ship.target = ship.a + angDiff(ship.a, ptrA);
      if (ship.alive) {
        const want = clamp(angDiff(ship.a, ship.target) * 12, -MAX_SPIN, MAX_SPIN);
        ship.v += (want - ship.v) * Math.min(1, dt * 16);
        ship.a += ship.v * dt;
        if (live && (touching || keyFire)) fire();
      } else if (live && (ship.respawn -= dt) <= 0 && lives > 0) {
        ship.alive = true; ship.inv = 2; ship.v = 0; ship.target = ship.a;
        g.sfx('jump', { volume: 0.6 });
      }

      // ---- formation ----
      let alive = 0, outer = 0;
      if (phase === 'play' || phase === 'over') {
        form.emerge = Math.min(1, form.emerge + dt * 0.9);
        for (const v of invaders) if (v.alive) alive++;
        const killed = 1 - alive / Math.max(1, form.total);
        const beatLen = lerp(0.7, 0.13, killed ** 0.85) * Math.max(0.55, 1 - 0.07 * (wave - 1));
        if (live && form.emerge >= 1 && (form.beatT -= dt) <= 0) {
          form.beatT = beatLen; form.beat ^= 1; form.beatN++;
          g.sfx('place', { pitch: [1, 0.89, 0.79, 0.75][form.beatN % 4], volume: 0.45 });
          const every = wave < 3 ? 6 : wave < 6 ? 5 : 4;
          if (form.beatN % every === 0) { form.expandTo += 0.026; form.dir = -form.dir; }
        }
        form.expand += (form.expandTo - form.expand) * Math.min(1, dt * 9);
        if (live) form.rot += form.dir * clamp(0.085 / beatLen, 0.12, 0.62) * dt;
        const em = ease.out(form.emerge);
        for (const v of invaders) {
          if (!v.alive) continue;
          v.a = v.off + form.rot * (v.ring % 2 ? -1 : 1);
          v.r = (v.base + form.expand) * R * em;
          v.x = cx + Math.sin(v.a) * v.r; v.y = cy - Math.cos(v.a) * v.r;
          outer = Math.max(outer, v.r);
        }
        if (live && alive && outer >= DANGER * R) invaded();
        // invaders flatten the shields they reach
        if (outer + INV * R * 0.5 > (SHIELD_R - SHIELD_T / 2) * R) {
          for (const v of invaders) {
            if (!v.alive || v.r + INV * R * 0.5 < (SHIELD_R - SHIELD_T / 2) * R) continue;
            for (const s of shields) {
              const d = angDiff(s.a0, v.a);
              const half = (INV * 0.55) / (v.r / R);
              for (let c = 0; c < SH_COLS; c++) {
                const ca = (c + 0.5) * (SH_SPAN / SH_COLS);
                if (Math.abs(d - ca) < half) for (let rr = 0; rr < SH_ROWS; rr++) s.cells[rr * SH_COLS + c] = 0;
              }
            }
          }
        }
        if (live && alive === 0 && phase === 'play') {
          phase = 'clear'; phaseT = 1.8;
          const bonus = 100 * wave;
          g.add(bonus); g.toast(`Wave cleared  +${bonus}`, 1300); g.sfx('win');
          shots = []; bombs = [];
        }
      }
      if (phase === 'clear' && (phaseT -= dt) <= 0) newWave();

      // ---- invader fire ----
      if (live && phase === 'play' && form.emerge >= 1 && alive && (fireT -= dt) <= 0) {
        fireT = rand(0.55, 1.3) * Math.max(0.45, 1 - 0.07 * (wave - 1)) * lerp(1, 0.7, 1 - alive / form.total);
        if (bombs.length < Math.min(2 + wave, 7)) {
          let shooter = null;
          if (ship.alive && Math.random() < 0.55) {   // someone near your line of fire
            for (const v of invaders) if (v.alive && Math.abs(angDiff(v.a, ship.a)) < 0.45 && (!shooter || v.r > shooter.r)) shooter = v;
          }
          if (!shooter) { const list = invaders.filter((v) => v.alive); shooter = list[Math.floor(rand(list.length))]; }
          if (shooter) bombs.push({ a: shooter.a, r: shooter.r + INV * R * 0.4, sp: R * (0.36 + Math.min(0.2, wave * 0.025)) * rand(0.9, 1.15), kind: Math.random() < 0.5 ? 0 : 1 });
        }
      }

      // ---- mothership ----
      if (live && phase === 'play' && !ufo && form.emerge >= 1 && (ufoT -= dt) <= 0) { if (!spawnUfo()) ufoT = 3; else ufoT = rand(20, 32); }
      if (ufo) {
        ufo.t += dt;
        const step = (R * 0.3 / (ufo.r * R)) * dt;
        ufo.a += ufo.dir * step; ufo.left -= step;
        if (ufo.left <= 0) ufo = null;
      }

      // ---- player shots ----
      const shotSp = R * 1.55;
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.r -= shotSp * dt;
        let hit = s.r < R * 0.03;
        const x = cx + Math.sin(s.a) * s.r, y = cy - Math.cos(s.a) * s.r;
        if (!hit) hit = hitShield(s.a, s.r, x, y);
        if (!hit) {
          const hr = INV * R * 0.58;
          for (const v of invaders) {
            if (v.alive && Math.abs(v.x - x) < hr && Math.abs(v.y - y) < hr && (v.x - x) ** 2 + (v.y - y) ** 2 < hr * hr) { killInvader(v); hit = true; break; }
          }
        }
        if (!hit && ufo && Math.abs(s.r - ufo.r * R) < R * 0.04 && Math.abs(angDiff(ufo.a, s.a)) * ufo.r * R < R * 0.065) {
          const [ux, uy] = pos(ufo.a, ufo.r * R);
          g.add(ufo.pts); g.draw.float(`+${ufo.pts}`, ux, uy, '#fff', R * 0.08); g.toast('Mothership!', 900);
          g.draw.burst(ux, uy, UFO, 30, R * 0.7, R * 0.013); g.draw.burst(ux, uy, '#fff', 12, R * 0.4, R * 0.01);
          g.sfx('score'); g.sfx('boom', { volume: 0.5 }); flash = 0.5; flashCol = '#fff'; ufo = null; hit = true;
        }
        if (hit) shots.splice(i, 1);
      }
      // ---- bombs ----
      for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.r += b.sp * dt;
        if (b.kind && ship.alive) b.a += clamp(angDiff(b.a, ship.a), -0.3 * dt, 0.3 * dt);   // the wiggly ones home in a little
        const x = cx + Math.sin(b.a) * b.r, y = cy - Math.cos(b.a) * b.r;
        let hit = b.r > R * 0.97 || hitShield(b.a, b.r, x, y);
        if (!hit && live && ship.alive && ship.inv <= 0 && Math.abs(b.r - TRACK * R) < R * 0.04 && Math.abs(angDiff(ship.a, b.a)) * TRACK * R < R * 0.042) {
          hit = true; hitShip();
        }
        if (hit) bombs.splice(i, 1);
      }

      // ================= draw =================
      const sk = shake > 0 ? shake * R * 0.03 : 0;
      shake = Math.max(0, shake - dt * 1.4);
      flash = Math.max(0, flash - dt * 2.5);
      coreKick = Math.max(0, coreKick - dt * 0.8);
      g.draw.bg({ glow: 0.1 + flash * 0.1 });
      ctx.save();
      if (sk) ctx.translate(rand(-sk, sk), rand(-sk, sk));
      // stars
      ctx.fillStyle = '#fff';
      for (const s of stars) {
        const a = s.a + t * 0.015;
        ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t * 1.3 + s.tw);
        ctx.fillRect(cx + Math.sin(a) * s.r * R, cy - Math.cos(a) * s.r * R, s.s, s.s);
      }
      ctx.globalAlpha = 1;
      // the core they come out of
      const cr = R * (0.1 + 0.015 * Math.sin(t * 2.2) + coreKick * 0.08);
      // flat core: two solid tones (an outer disc and a brighter inner one)
      ctx.fillStyle = g.draw.alpha(ME, 0.08 + coreKick * 0.12); ctx.beginPath(); ctx.arc(cx, cy, cr * 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = g.draw.alpha(ME, 0.16 + coreKick * 0.3); ctx.beginPath(); ctx.arc(cx, cy, cr * 0.85, 0, TAU); ctx.fill();
      g.draw.circle(cx, cy, R * 0.05, null, { stroke: 'rgba(255,255,255,.12)', lw: 1.5 });
      // ship track + danger line
      ctx.save();
      ctx.setLineDash([R * 0.006, R * 0.03]); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, TRACK * R, 0, TAU); ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = R * 0.006; ctx.stroke();
      ctx.restore();
      const close = clamp((outer / R - (DANGER - 0.22)) / 0.22, 0, 1);
      if (close > 0) {
        ctx.beginPath(); ctx.arc(cx, cy, DANGER * R + INV * R * 0.5, 0, TAU);
        ctx.strokeStyle = g.draw.alpha(UFO, close * (0.25 + 0.2 * Math.sin(t * 8))); ctx.lineWidth = R * 0.005; ctx.stroke();
      }
      // shields
      const cw = SH_SPAN / SH_COLS, rt = SHIELD_T / SH_ROWS;
      ctx.lineCap = 'butt';
      for (const s of shields) {
        for (let rr = 0; rr < SH_ROWS; rr++) for (let c = 0; c < SH_COLS; c++) {
          const hp = s.cells[rr * SH_COLS + c];
          if (!hp) continue;
          const rad = (SHIELD_R - SHIELD_T / 2 + (rr + 0.5) * rt) * R;
          const a0 = s.a0 + c * cw - Math.PI / 2;
          ctx.beginPath(); ctx.arc(cx, cy, rad, a0 + 0.004, a0 + cw - 0.004);
          ctx.strokeStyle = hp === 2 ? g.draw.alpha(ME, 0.55) : g.draw.alpha(ME, 0.22);
          ctx.lineWidth = rt * R - 1; ctx.stroke();
        }
      }
      // invaders
      for (const v of invaders) {
        if (!v.alive) continue;
        const sp = sprites[v.type][form.beat];
        const k = 0.35 + 0.65 * ease.out(form.emerge);
        ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.a + Math.PI);
        ctx.drawImage(sp.c, (-sp.w / 2) * k, (-sp.h / 2) * k, sp.w * k, sp.h * k);
        ctx.restore();
      }
      // mothership
      if (ufo) drawUfo(ufo, t);
      // bombs: little zig-zag bolts
      ctx.lineWidth = R * 0.01; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#ff8c96';
      ctx.shadowColor = UFO; ctx.shadowBlur = R * 0.025;
      ctx.beginPath();
      for (const b of bombs) {
        const ca = Math.cos(b.a), sa = Math.sin(b.a), L = R * 0.055, W = R * 0.013;
        const ph = Math.floor(t * 12) % 2 ? 1 : -1;
        for (let k = 0; k <= 3; k++) {
          const rr = b.r - L + (k / 3) * L, side = (k % 2 ? 1 : -1) * W * (b.kind ? ph : 1);
          const x = cx + sa * rr + ca * side, y = cy - ca * rr + sa * side;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      // shots: bright streaks
      ctx.strokeStyle = '#eaffdf'; ctx.shadowColor = ME; ctx.lineWidth = R * 0.01;
      ctx.beginPath();
      for (const s of shots) {
        const [x1, y1] = pos(s.a, s.r), [x2, y2] = pos(s.a, s.r + R * 0.05);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
      // ship
      if (ship.alive && !(ship.inv > 0 && Math.floor(t * 10) % 2)) drawShip(t);
      g.draw.particles(dt);
      g.draw.floaters(dt);
      ctx.restore();
      if (flash > 0) { ctx.fillStyle = g.draw.alpha(flashCol, flash * 0.22); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill(); }
    });

    function hitShield(a, r, x, y) {
      const rr0 = (SHIELD_R - SHIELD_T / 2) * g.R;
      if (r < rr0 - g.R * 0.01 || r > rr0 + SHIELD_T * g.R + g.R * 0.01) return false;
      for (const s of shields) {
        const d = angDiff(s.a0, a);
        if (d < 0 || d >= SH_SPAN) continue;
        const c = Math.floor((d / SH_SPAN) * SH_COLS);
        const row = clamp(Math.floor((r - rr0) / ((SHIELD_T / SH_ROWS) * g.R)), 0, SH_ROWS - 1);
        const i = row * SH_COLS + c;
        if (!s.cells[i]) return false;
        s.cells[i]--;
        g.draw.burst(x, y, ME, 5, g.R * 0.25, g.R * 0.007);
        g.sfx('hit', { volume: 0.4, pitch: 1.4 });
        return true;
      }
      return false;
    }

    function drawShip(t) {
      const { ctx, R } = g;
      const [x, y] = pos(ship.a, TRACK * R + ship.recoil * R * 0.008);
      const s = R * 0.05;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ship.a + Math.PI);   // local −y points at the centre
      // engine glow
      const fl = 0.7 + 0.3 * Math.sin(t * 40);
      ctx.fillStyle = 'rgba(200,255,180,.45)'; ctx.beginPath(); ctx.arc(0, s * 0.75, s * 0.42 * fl, 0, TAU); ctx.fill();
      // hull
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.05);
      ctx.lineTo(s * 0.32, -s * 0.35); ctx.lineTo(s * 0.95, s * 0.45); ctx.lineTo(s * 0.9, s * 0.72);
      ctx.lineTo(s * 0.3, s * 0.5); ctx.lineTo(0, s * 0.68); ctx.lineTo(-s * 0.3, s * 0.5);
      ctx.lineTo(-s * 0.9, s * 0.72); ctx.lineTo(-s * 0.95, s * 0.45); ctx.lineTo(-s * 0.32, -s * 0.35);
      ctx.closePath();
      ctx.shadowColor = ME; ctx.shadowBlur = R * 0.04;
      ctx.fillStyle = ME; ctx.fill();
      ctx.shadowBlur = 0;
      // cockpit
      ctx.beginPath(); ctx.ellipse(0, -s * 0.12, s * 0.16, s * 0.3, 0, 0, TAU); ctx.fillStyle = '#0c2a10'; ctx.fill();
      ctx.restore();
    }

    function drawUfo(u, t) {
      const { ctx, R } = g;
      const [x, y] = pos(u.a, u.r * R);
      const s = R * 0.06;
      const al = clamp(Math.min(u.t * 3, u.left * 3), 0, 1);
      ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.rotate(u.a + Math.PI);
      // dome (towards the centre) and the saucer — flat fills
      ctx.beginPath(); ctx.ellipse(0, -s * 0.18, s * 0.42, s * 0.42, 0, Math.PI, 0); ctx.fillStyle = 'rgba(255,190,200,.85)'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 0, s * 1.15, s * 0.36, 0, 0, TAU); ctx.fillStyle = UFO; ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, s * 0.1, s * 0.75, s * 0.13, 0, 0, TAU); ctx.fillStyle = 'rgba(80,0,10,.45)'; ctx.fill();
      for (let i = 0; i < 5; i++) {
        const on = (Math.floor(t * 8) + i) % 3 === 0;
        ctx.beginPath(); ctx.arc((i - 2) * s * 0.42, s * 0.02, s * 0.075, 0, TAU);
        ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,.35)'; ctx.fill();
      }
      ctx.restore();
    }

    // forget held input over a pause (the release may happen while paused)
    return { pause() { touching = false; ptrA = null; keyDir = 0; keyFire = false; } };
  },
};
