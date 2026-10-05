// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Rail Rush — three rail lanes running into a neon night city, seen from behind the runner.
// Swipe left/right to switch lanes, up to jump (low barriers), down to roll (high barriers, or to drop
// fast from a jump). Trains stand or come at you — switch lanes, or run up a ramp onto the roofs.
// Coins add up, power-ups give a coin magnet or a 2× multiplier. One crash ends the run; bumping into the
// side of a train only knocks you back — twice in a short while and you're down.
import { TAU, rand, clamp, lerp, pick, THEME } from './kit.js';

const LW = 1.3;                         // lane spacing
const CB = 5, CH = 3.0, NEAR = 0.3;     // camera behind / height / near plane
const VIEW = 70, SPAWN = 95;            // draw distance, how far ahead rows are generated
const ROOF = 1.75, TW = 0.575, RL = 3.6;  // train roof height, half width, ramp length
const GRAV = 26, JUMP_V = 8.8;
// scenery per theme mode: the neon night city (Dark — the original look), a pitch-black night (OLED), a bright day (Light)
const SCENE = {
  dark: { fog: [18, 16, 34], sky: ['#05050c', '#0e0c22'], ground: ['#0d0c16', '#050508'], skyline: '#0c0b19', skyWin: 'rgba(255,214,140,.45)',
    moon: 'rgba(230,235,255,.85)', halo: 'rgba(200,210,255,.06)', vig: 'rgba(0,0,0,.75)', win: '#ffd88a', winA: 0.7,
    rail: '#9aa3b8', bed: '#16141d', wall: '#221e33', wallTop: '#3a3354', bld: '#151324', bldF: '#1c1930', sleeper: ['#3a3442', '#2c2735'] },
  oled: { fog: [9, 8, 18], sky: ['#000000', '#08071a'], ground: ['#05050a', '#000000'], skyline: '#04040a', skyWin: 'rgba(255,214,140,.4)',
    moon: 'rgba(230,235,255,.85)', halo: 'rgba(200,210,255,.05)', vig: 'rgba(0,0,0,.8)', win: '#ffd88a', winA: 0.7,
    rail: '#9aa3b8', bed: '#0c0b11', wall: '#18152a', wallTop: '#2e2944', bld: '#0b0a15', bldF: '#110f20', sleeper: ['#302b38', '#24202c'] },
  light: { fog: [212, 220, 234], sky: ['#6fa6dc', '#bcd3ec'], ground: ['#9a9cab', '#6c6f80'], skyline: '#a4b0c6', skyWin: null,
    moon: 'rgba(255,251,228,.95)', halo: 'rgba(255,244,190,.28)', vig: 'rgba(50,62,90,.28)', win: '#eaf3ff', winA: 0.8,
    rail: '#565d72', bed: '#7f7c89', wall: '#a19eb2', wallTop: '#c4c1d2', bld: '#8790a6', bldF: '#a2aabd', sleeper: ['#6e6259', '#5d524a'] },
};
const scene = () => (THEME.light ? SCENE.light : THEME.mode === 'oled' ? SCENE.oled : SCENE.dark);
let FOG = SCENE.dark.fog;
const TRAIN_COLS = ['#34d399', '#ff4fa3', '#4d9bff', '#ffb020', '#b57bff'];

export default {
  howTo: 'Swipe left/right to switch lanes, up to jump, down to roll. Dodge the trains — or ride a ramp onto the roofs.',
  scoring: 'high',
  create(g) {
    const { ctx } = g;
    // ---------------------------------------------------------------- state
    let pz = 0, x = 0, lane = 0, fromLane = 0, y = 0, vy = 0, rollT = 0, rollQ = false, grounded = true;
    let speed = 11, dist = 0, pts = 0, coins = 0, runPh = 0, shownScore = -1, shownSub = '';
    let state = 'run', stateT = 0, overSent = false, flash = 0, shake = 0, bumpT = 0, stumbleT = 0;
    let camX = 0, camY = CH, camZ = -CB, groundS = 0, F = 1, HY = 0, CXs = 0;
    let magnetT = 0, multT = 0, nextPower = 18, nextRowZ = 34;
    const objs = [], coinList = [];
    let backdrop = null, glowSpr = null, vignette = null, artKey = '', SC = SCENE.dark;
    const diff = () => clamp(dist / 3000, 0, 1);
    const laneX = (l) => l * LW;

    // ---------------------------------------------------------------- generation
    function occOverlap(l, za, zb, onlyTrains = false) {
      for (const o of objs) {
        if (o.lane !== l || (onlyTrains && o.type !== 'train')) continue;
        if (o.oa < zb && o.ob > za) return true;
      }
      return false;
    }
    function anyTrainOverlap(za, zb) {
      for (const o of objs) if (o.type === 'train' && o.oa < zb && o.ob > za) return true;
      return false;
    }
    function addCoins(l, z0, n, { yy = 0.55, arc = 0, step = 1.5 } = {}) {
      for (let i = 0; i < n; i++) {
        const k = n > 1 ? i / (n - 1) : 0;
        coinList.push({ l, x: laneX(l), z: z0 + i * step, y: yy + Math.sin(k * Math.PI) * arc, got: false, gt: 0, mag: false });
      }
    }
    function addTrain(l, z, { moving = false, ramp = false, len = 12 } = {}) {
      const vt = moving ? 7 + diff() * 5 : 0;
      const t = { type: 'train', lane: l, x: laneX(l), z0: z, z1: z + len, vt, ramp, col: pick(TRAIN_COLS), px: false, pzz: false, oa: z - (ramp ? RL + 1 : 1), ob: z + len + 1 };
      if (moving) { // the stretch of track it sweeps before it meets the runner
        const zm = pz + (z - pz) * speed / (speed + vt);
        t.oa = zm - 4;
      }
      objs.push(t);
      return t;
    }
    function genRow(z) {
      const d = diff();
      const r = Math.random();
      const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5);
      let gap = Math.max(11, speed * 0.95) + rand(0, 6) - d * 2;
      if (z > pz + 30 && nextPower <= 0 && r < 0.5) {
        const l = lanes.find((q) => !occOverlap(q, z - 2, z + 2));
        if (l !== undefined) { objs.push({ type: 'power', kind: Math.random() < 0.5 ? 'magnet' : 'x2', lane: l, x: laneX(l), z0: z, z1: z, oa: z - 1, ob: z + 1, got: false }); nextPower = rand(22, 32); }
      }
      if (r < 0.3 + d * 0.12 && !anyTrainOverlap(z - 8, z + 26)) {
        // a train row: one or two lanes get a train, at least one lane stays free
        const n = Math.random() < 0.35 + d * 0.4 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const l = lanes[i];
          if (occOverlap(l, z - RL - 2, z + 18)) continue;
          const moving = dist > 150 && Math.random() < 0.2 + d * 0.3 && i === 0;
          const ramp = !moving && Math.random() < (n === 2 ? 0.5 : 0.4);
          const t = addTrain(l, z, { moving, ramp, len: Math.round(rand(10, 16)) });
          if (ramp) addCoins(l, z + 1.5, Math.floor((t.z1 - t.z0 - 2) / 1.5), { yy: ROOF + 0.55 });
        }
        const fl = lanes[2];
        if (Math.random() < 0.55 && !occOverlap(fl, z - 2, z + 12)) addCoins(fl, z, 7);
        gap += 4;
      } else if (r < 0.72) {
        // barriers: low ones to jump, high ones to roll under
        const n = Math.random() < 0.25 + d * 0.35 ? 2 : 1 + (Math.random() < d * 0.25 ? 2 : 0);
        for (let i = 0; i < Math.min(3, n); i++) {
          const l = lanes[i];
          if (occOverlap(l, z - 3, z + 3)) continue;
          const high = Math.random() < 0.45;
          objs.push({ type: high ? 'high' : 'low', lane: l, x: laneX(l), z0: z, z1: z, oa: z - 1.5, ob: z + 1.5 });
          if (!high && Math.random() < 0.4) addCoins(l, z - 3, 5, { arc: 1.2, yy: 0.55 });
        }
        const fl = lanes[2];
        if (n < 3 && Math.random() < 0.4 && !occOverlap(fl, z - 4, z + 10)) addCoins(fl, z - 4, 6);
      } else {
        // a plain coin trail
        const l = lanes[0];
        if (!occOverlap(l, z - 2, z + 14)) addCoins(l, z, 9);
        gap -= 3;
      }
      nextRowZ = z + gap;
    }

    // ---------------------------------------------------------------- input
    function act(dir) {
      if (state !== 'run') return;
      if (dir === 'left' || dir === 'right') {
        const nl = clamp(lane + (dir === 'left' ? -1 : 1), -1, 1);
        if (nl !== lane) { fromLane = lane; lane = nl; g.sfx('whoosh', { volume: 0.45 }); }
      } else if (dir === 'up') {
        if (grounded) { vy = JUMP_V; grounded = false; rollT = 0; g.sfx('jump'); }
      } else if (dir === 'down') {
        if (grounded) { if (rollT <= 0) g.sfx('whoosh'); rollT = 0.62; }
        else { vy = Math.min(vy, -20); rollQ = true; }
      }
    }
    g.on('swipe', (e) => act(e.dir));
    g.on('key', (e) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a') act('left');
      else if (k === 'ArrowRight' || k === 'd') act('right');
      else if (k === 'ArrowUp' || k === 'w' || k === ' ') act('up');
      else if (k === 'ArrowDown' || k === 's') act('down');
    });
    g.on('wheel', (e) => act(e.delta > 0 ? 'right' : 'left'));
    g.toast('Swipe to dodge', 1600);

    function crash() {
      if (state !== 'run') return;
      state = 'crash'; stateT = 0; flash = 1; shake = 1; vy = 4;
      g.sfx('boom'); g.vibrate(80);
      if (proj(x, y + 0.8, pz)) { g.draw.burst(SX, SY, '#ffc83d', 18, g.R * 0.6, g.R * 0.012); g.draw.burst(SX, SY, '#7c5cff', 12, g.R * 0.4, g.R * 0.016); }
    }
    function bump() {
      g.sfx('hit'); g.vibrate(30); shake = 0.5;
      lane = fromLane; bumpT = 0.4;
      if (stumbleT > 0) { crash(); return; }
      stumbleT = 5; g.toast('Careful!', 900);
    }
    function finish() {
      if (overSent) return;
      overSent = true;
      const m = Math.floor(dist);
      g.over(Math.floor(pts), { title: 'Busted!', note: `${m.toLocaleString()} m · ${coins} coins`, delay: 950 });
    }

    // ---------------------------------------------------------------- update
    let onRamp = false;
    function groundAt() {
      let gy = 0; onRamp = false;
      for (const o of objs) {
        if (o.type !== 'train' || Math.abs(x - o.x) > 0.55) continue;
        if (pz >= o.z0 && pz <= o.z1) gy = Math.max(gy, ROOF);
        else if (o.ramp && pz > o.z0 - RL && pz < o.z0) { gy = Math.max(gy, ROOF * (pz - (o.z0 - RL)) / RL); onRamp = true; }
      }
      return gy;
    }
    function update(dt) {
      if (state === 'crash') {
        stateT += dt;
        vy -= GRAV * dt; y = Math.max(groundAt(), y + vy * dt);
        pz -= Math.max(0, 3 - stateT * 6) * dt;
        if (stateT > 0.75) finish();
        return;
      }
      speed = 11 + 13 * (1 - Math.exp(-dist / 2600));
      const v = speed;
      pz += v * dt; dist += v * dt;
      const mult = multT > 0 ? 2 : 1;
      pts += v * dt * mult;
      runPh += dt * v * 1.15;
      magnetT -= dt; multT -= dt; nextPower -= dt; stumbleT -= dt; bumpT -= dt;
      x += (laneX(lane) - x) * (1 - Math.exp(-(bumpT > 0 ? 22 : 16) * dt));
      // spawn rows ahead
      while (nextRowZ < pz + SPAWN) genRow(nextRowZ);
      // trains roll in
      for (const o of objs) if (o.vt) { o.z0 -= o.vt * dt; o.z1 -= o.vt * dt; }
      // vertical motion on ground, ramps and roofs
      const gy = groundAt();
      if (y > gy + 0.001 || vy > 0) {
        vy -= GRAV * dt; y += vy * dt;
        if (y <= gy) { y = gy; vy = 0; if (!grounded && rollQ) { rollT = 0.5; rollQ = false; } grounded = true; }
        else grounded = false;
      } else if (gy - y < 0.9 || onRamp) { y = gy; vy = 0; grounded = true; }
      rollT -= dt;
      const rolling = rollT > 0;
      // collisions
      for (const o of objs) {
        const dz = o.z0 - pz;
        if (o.type === 'train') {
          if (o.z1 < pz - 2 || o.z0 > pz + 3 + (o.ramp ? RL : 0)) { o.px = false; o.pzz = false; continue; }
          const xo = Math.abs(x - o.x) < 0.8, zo = pz + 0.3 > o.z0 && pz - 0.3 < o.z1;
          if (xo && zo && y < ROOF - 0.3) {
            if (o.ramp && pz < o.z0 + 0.6 && y > ROOF * 0.6) { /* coming off the ramp onto the roof */ }
            else if (bumpT > 0) { o.pzz = zo; continue; }   // being knocked back to the old lane
            else if (o.pzz && !o.px) { bump(); if (state !== 'run') return; o.pzz = zo; continue; }
            else { crash(); return; }
          }
          o.px = xo; o.pzz = zo;
        } else if (o.type === 'low' || o.type === 'high') {
          if (Math.abs(dz) > 0.4 || Math.abs(x - o.x) > 0.62) continue;
          if (o.type === 'low' && y < 0.6) { crash(); return; }
          if (o.type === 'high' && !(rolling && y < 0.45) && y < 1.65) { crash(); return; }
        } else if (o.type === 'power' && !o.got) {
          if (Math.abs(dz) < 0.7 && Math.abs(x - o.x) < 0.7 && y < 1.5) {
            o.got = true;
            if (o.kind === 'magnet') { magnetT = 9; g.toast('Coin magnet!', 900); }
            else { multT = 10; g.toast('2× score!', 900); }
            g.sfx('perfect'); g.vibrate(20);
          }
        }
      }
      // coins (pulled in by the magnet)
      for (let i = coinList.length - 1; i >= 0; i--) {
        const c = coinList[i];
        if (c.got) { c.gt += dt; if (c.gt > 0.3) coinList.splice(i, 1); continue; }
        if (c.z < pz - CB - 1) { coinList.splice(i, 1); continue; }
        if (magnetT > 0 && c.z > pz - 0.5 && c.z < pz + 14) c.mag = true;
        if (c.mag) {
          const k = 1 - Math.exp(-14 * dt);
          c.x += (x - c.x) * k; c.y += (y + 0.7 - c.y) * k; c.z += (pz + 0.2 - c.z) * k;
        }
        if (Math.abs(c.z - pz) < 0.6 && Math.abs(c.x - x) < 0.6 && Math.abs(c.y - (y + 0.6)) < 0.9) {
          c.got = true; coins++; pts += 5 * mult;
          g.sfx('coin', { volume: 0.5, pitch: 1 + (coins % 5) * 0.03 });
        }
      }
      // drop what's behind the camera
      for (let i = objs.length - 1; i >= 0; i--) if (objs[i].z1 < pz - CB - 2) objs.splice(i, 1);
    }

    // ---------------------------------------------------------------- projection
    let SX = 0, SY = 0, SK = 0, SZ = 0;
    function proj(X, Y, Z) {
      SZ = Z - camZ;
      if (SZ < NEAR) return false;
      SK = F / SZ; SX = CXs + (X - camX) * SK; SY = HY + (camY - Y) * SK;
      return true;
    }
    const PW = new Float64Array(3 * 8), PC = new Float64Array(3 * 16);
    let pn = 0, polyZ = 0;
    function pt(X, Y, Z) { PW[pn * 3] = X; PW[pn * 3 + 1] = Y; PW[pn * 3 + 2] = Z - camZ; pn++; }
    /** Fill the collected 3D polygon (clipped at the near plane). Returns false if nothing is visible. */
    function poly(style, path = true) {
      let near = 0, zs = 0;
      for (let i = 0; i < pn; i++) { if (PW[i * 3 + 2] >= NEAR) near++; zs += PW[i * 3 + 2]; }
      polyZ = zs / pn;
      if (!near) { pn = 0; return false; }
      let m = 0;
      for (let i = 0; i < pn; i++) {
        const j = (i + 1) % pn, zi = PW[i * 3 + 2], zj = PW[j * 3 + 2];
        if (zi >= NEAR) { PC[m * 3] = PW[i * 3]; PC[m * 3 + 1] = PW[i * 3 + 1]; PC[m * 3 + 2] = zi; m++; }
        if ((zi >= NEAR) !== (zj >= NEAR)) {
          const t = (NEAR - zi) / (zj - zi);
          PC[m * 3] = PW[i * 3] + (PW[j * 3] - PW[i * 3]) * t; PC[m * 3 + 1] = PW[i * 3 + 1] + (PW[j * 3 + 1] - PW[i * 3 + 1]) * t; PC[m * 3 + 2] = NEAR; m++;
        }
      }
      pn = 0;
      if (m < 3) return false;
      if (path) ctx.beginPath();
      for (let i = 0; i < m; i++) {
        const k = F / PC[i * 3 + 2], sx = CXs + (PC[i * 3] - camX) * k, sy = HY + (camY - PC[i * 3 + 1]) * k;
        if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      }
      ctx.closePath();
      if (style) { ctx.fillStyle = style; ctx.fill(); }
      return true;
    }
    function pal(hex) {
      const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      return Array.from({ length: 17 }, (_, i) => { const t = (i / 16) ** 0.85; return `rgb(${c.map((v, j) => Math.round(lerp(v, FOG[j], t))).join(',')})`; });
    }
    const fogI = (z) => clamp(Math.round((z - 14) / (VIEW - 14) * 16), 0, 16);
    const shade = (hex, a) => { const n = parseInt(hex.slice(1), 16); const f = (v) => clamp(Math.round(a >= 0 ? v + (255 - v) * a : v * (1 + a)), 0, 255); return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`; };
    const TRAIN_PAL = {};
    let SLEEPER, RAIL, BED, WALL, WALLTOP, BLD, BLDF, LOWB, RED, YEL, DARK, POST, GOLD, GOLDD, RAMP, RAMPS;
    function buildPalettes() {   // the fog colour follows the theme mode, so these are rebuilt with the art
      for (const c of TRAIN_COLS) TRAIN_PAL[c] = { body: pal(shade(c, -0.62)), side: pal(shade(c, -0.72)), roof: pal(shade(c, -0.45)), stripe: pal(c), light: pal(shade(c, 0.5)) };
      SLEEPER = [pal(SC.sleeper[0]), pal(SC.sleeper[1])]; RAIL = pal(SC.rail); BED = pal(SC.bed);
      WALL = pal(SC.wall); WALLTOP = pal(SC.wallTop); BLD = pal(SC.bld); BLDF = pal(SC.bldF);
      LOWB = pal('#f2f2f5'); RED = pal('#ff4d5e'); YEL = pal('#ffc83d'); DARK = pal('#1a1a22'); POST = pal('#8a8fa0');
      GOLD = pal('#ffc94a'); GOLDD = pal('#c8901a'); RAMP = pal('#4a4f62'); RAMPS = pal('#2e3140');
    }
    // vertical fill: a gradient, or (flat themes) a few solid steps through the same colours
    const toRgb = (c) => (Array.isArray(c) ? c : [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
    function vfill(k, x, y0, w, y1, stops) {
      if (!THEME.flat) {
        const gr = k.createLinearGradient(0, y0, 0, y1);
        for (const [at, c] of stops) gr.addColorStop(at, `rgb(${toRgb(c).join(',')})`);
        k.fillStyle = gr; k.fillRect(x, y0, w, y1 - y0);
        return;
      }
      const n = 6;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        let j = 0; while (j < stops.length - 2 && u > stops[j + 1][0]) j++;
        const [a0, c0] = stops[j], [a1, c1] = stops[j + 1], t = clamp((u - a0) / (a1 - a0 || 1), 0, 1);
        const A = toRgb(c0), B = toRgb(c1);
        k.fillStyle = `rgb(${A.map((v, q) => Math.round(lerp(v, B[q], t))).join(',')})`;
        k.fillRect(x, y0 + (y1 - y0) * i / n, w, (y1 - y0) / n + 1);
      }
    }

    // ---------------------------------------------------------------- city
    const blds = [];  // buildings along both sides
    let bldZ = [-10, -10];
    function genBuildings() {
      for (let side = 0; side < 2; side++) {
        while (bldZ[side] < pz + VIEW + 10) {
          const len = rand(6, 13), z0 = bldZ[side] + rand(0.5, 2.5);
          const hgt = rand(4, 11), sg = side ? 1 : -1;
          const rows = Math.floor(hgt / 1.4), cols = Math.floor(len / 1.6);
          const lit = [];
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (Math.random() < 0.38) lit.push(r, c);
          blds.push({ sg, z0, z1: z0 + len, h: hgt, x0: sg * rand(5.2, 6.2), rows, cols, lit, neon: Math.random() < 0.35 ? pick(['#ff4fa3', '#22d3ee', '#34d399', '#b57bff']) : null, ny: rand(1.6, hgt - 1) });
          bldZ[side] = z0 + len;
        }
      }
      for (let i = blds.length - 1; i >= 0; i--) if (blds[i].z1 < camZ) blds.splice(i, 1);
    }

    function buildArt() {
      const R = g.R, S = g.S, dpr = g.dpr || 1;
      SC = scene(); FOG = SC.fog; buildPalettes();
      artKey = `${THEME.id}|${THEME.mode}`;
      backdrop = document.createElement('canvas');
      backdrop.width = backdrop.height = Math.max(1, Math.round(S * dpr));
      const b = backdrop.getContext('2d'); b.scale(dpr, dpr);
      const hy = g.cy - R * 0.28;
      b.fillStyle = SC.sky[0]; b.fillRect(0, 0, S, g.cy - R);
      vfill(b, 0, g.cy - R, S, hy + 1, [[0, SC.sky[0]], [0.6, SC.sky[1]], [1, FOG]]);
      // moon (the sun by day)
      b.fillStyle = SC.moon; b.beginPath(); b.arc(g.cx + R * 0.42, g.cy - R * 0.55, R * 0.045, 0, TAU); b.fill();
      b.fillStyle = SC.halo; b.beginPath(); b.arc(g.cx + R * 0.42, g.cy - R * 0.55, R * 0.12, 0, TAU); b.fill();
      // far skyline with lit windows
      let x = g.cx - R;
      while (x < g.cx + R) {
        const w = R * rand(0.06, 0.15), hh = R * rand(0.06, 0.3) * (1 - Math.abs(x - g.cx) / R * 0.4);
        b.fillStyle = SC.skyline; b.fillRect(x, hy - hh, w, hh + 1);
        b.fillStyle = SC.skyWin || 'rgba(0,0,0,0)';
        if (SC.skyWin) for (let wy = hy - hh + R * 0.015; wy < hy - R * 0.01; wy += R * 0.022) for (let wx = x + R * 0.01; wx < x + w - R * 0.01; wx += R * 0.02) if (Math.random() < 0.22) b.fillRect(wx, wy, R * 0.007, R * 0.009);
        x += w + R * rand(0, 0.02);
      }
      if (!THEME.flat) {
        const hg = b.createRadialGradient(g.cx, hy, 0, g.cx, hy, R * 0.9);
        hg.addColorStop(0, g.draw.alpha(g.color, 0.22)); hg.addColorStop(0.45, 'rgba(181,123,255,.07)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
        b.fillStyle = hg; b.fillRect(0, 0, S, S);
      }
      // ground below the horizon
      vfill(b, 0, hy, S, g.cy + R, [[0, FOG], [0.15, SC.ground[0]], [1, SC.ground[1]]]);
      b.fillStyle = SC.ground[1]; b.fillRect(0, g.cy + R, S, S);
      if (!THEME.flat) {
        vignette = ctx.createRadialGradient(g.cx, g.cy, R * 0.62, g.cx, g.cy, R);
        vignette.addColorStop(0, g.draw.alpha(SC.vig, 0)); vignette.addColorStop(1, SC.vig);
      } else vignette = null;
      glowSpr = document.createElement('canvas'); glowSpr.width = glowSpr.height = 64;
      const gg = glowSpr.getContext('2d'), rg = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, 'rgba(255,255,255,.9)'); rg.addColorStop(0.3, 'rgba(255,255,255,.3)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      gg.fillStyle = rg; gg.fillRect(0, 0, 64, 64);
    }
    g.on('resize', buildArt);
    buildArt();

    // ---------------------------------------------------------------- drawing
    function drawCity() {
      // buildings, far first
      for (let i = blds.length - 1; i >= 0; i--) {
        const bd = blds[i];
        if (bd.z0 - camZ > VIEW) continue;
        const xi = bd.x0, xo = bd.x0 + bd.sg * 4;
        // the side facing the tracks
        pt(xi, 0, bd.z0); pt(xi, bd.h, bd.z0); pt(xi, bd.h, bd.z1); pt(xi, 0, bd.z1);
        if (!poly(null)) continue;
        const fi = fogI(Math.max(0, polyZ));
        ctx.fillStyle = BLD[fi]; ctx.fill();
        // the front (facing the camera)
        pt(xi, 0, bd.z0); pt(xi, bd.h, bd.z0); pt(xo, bd.h, bd.z0); pt(xo, 0, bd.z0);
        poly(BLDF[fi]);
        // lit windows
        if (bd.z0 - camZ < VIEW * 0.85) {
          ctx.beginPath();
          const cw = (bd.z1 - bd.z0) / bd.cols;
          for (let k = 0; k < bd.lit.length; k += 2) {
            const r = bd.lit[k], c = bd.lit[k + 1], wy = 0.9 + r * 1.4, wz = bd.z0 + c * cw + cw * 0.25;
            pt(xi, wy, wz); pt(xi, wy + 0.7, wz); pt(xi, wy + 0.7, wz + cw * 0.5); pt(xi, wy, wz + cw * 0.5);
            poly(null, false);
          }
          ctx.globalAlpha = SC.winA * (1 - fi / 18); ctx.fillStyle = SC.win; ctx.fill(); ctx.globalAlpha = 1;
        }
        // a neon strip
        if (bd.neon) {
          pt(xi, bd.ny, bd.z0 + 0.6); pt(xi, bd.ny + 0.18, bd.z0 + 0.6); pt(xi, bd.ny + 0.18, bd.z1 - 0.6); pt(xi, bd.ny, bd.z1 - 0.6);
          if (poly(null)) {
            ctx.globalAlpha = 1 - fi / 20;
            ctx.strokeStyle = g.draw.alpha(bd.neon, 0.25); ctx.lineWidth = Math.max(2, F / Math.max(2, polyZ) * 0.35); ctx.stroke();
            ctx.fillStyle = bd.neon; ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      }
    }
    function drawTrack() {
      const z0 = camZ + NEAR, z1 = camZ + VIEW;
      // the gravel bed and low side walls
      const bw = LW * 1.5 + 0.7;
      pt(-bw, 0, z0); pt(bw, 0, z0); pt(bw, 0, z1); pt(-bw, 0, z1); poly(BED[4]);
      for (const sg of [-1, 1]) {
        const xw = sg * (bw + 0.15);
        pt(xw, 0, z0); pt(xw, 0.55, z0); pt(xw, 0.55, z1); pt(xw, 0, z1); poly(WALL[6]);
        pt(xw, 0.55, z0); pt(xw + sg * 0.35, 0.55, z0); pt(xw + sg * 0.35, 0.55, z1); pt(xw, 0.55, z1); poly(WALLTOP[5]);
      }
      // sleepers: batched by distance so they fade into the haze
      const SP = 0.9;
      const first = Math.ceil(z0 / SP);
      for (let band = 0; band < 4; band++) {
        const za = camZ + [NEAR, 12, 26, 44][band], zb = camZ + [12, 26, 44, VIEW][band];
        ctx.beginPath();
        for (let k = Math.max(first, Math.ceil(za / SP)); k * SP < zb; k++) {
          const z = k * SP;
          for (let l = -1; l <= 1; l++) { const lx = laneX(l); pt(lx - 0.62, 0.02, z); pt(lx + 0.62, 0.02, z); pt(lx + 0.62, 0.02, z + 0.26); pt(lx - 0.62, 0.02, z + 0.26); poly(null, false); }
        }
        ctx.fillStyle = SLEEPER[0][[1, 5, 9, 13][band]]; ctx.fill();
      }
      // rails with a faint neon sheen
      ctx.beginPath();
      for (let l = -1; l <= 1; l++) for (const o of [-0.38, 0.38]) {
        const rx = laneX(l) + o;
        pt(rx - 0.035, 0.08, z0); pt(rx + 0.035, 0.08, z0); pt(rx + 0.035, 0.08, z1); pt(rx - 0.035, 0.08, z1); poly(null, false);
      }
      ctx.fillStyle = RAIL[3]; ctx.fill();
      ctx.globalAlpha = 0.18; ctx.strokeStyle = g.color; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    }

    // sprites sorted by depth (trains by their far end)
    const sprs = [];
    function drawObjects() {
      sprs.length = 0;
      for (const o of objs) {
        const zf = (o.type === 'train' ? o.z1 : o.z0) - camZ;
        if (o.z1 - camZ < NEAR || o.z0 - (o.ramp ? RL : 0) - camZ > VIEW) continue;
        o.sz = zf; sprs.push(o);
      }
      for (const c of coinList) { const z = c.z - camZ; if (z > 2.4 && z < VIEW && (!c.got || c.gt < 0.3)) { c.sz = z; c.type = 'coin'; sprs.push(c); } }
      runner.sz = pz - camZ; sprs.push(runner);
      sprs.sort((a, b) => b.sz - a.sz);
      for (const o of sprs) {
        if (o.type === 'train') drawTrain(o);
        else if (o.type === 'low' || o.type === 'high') drawBarrier(o);
        else if (o.type === 'coin') drawCoin(o);
        else if (o.type === 'power') drawPower(o);
        else if (o === runner) drawRunner();
      }
    }
    const runner = { type: 'runner', sz: 0 };

    function drawTrain(t) {
      const P = TRAIN_PAL[t.col];
      const xl = t.x - TW, xr = t.x + TW;
      const fi = fogI(Math.max(0, t.z0 - camZ));
      // ramp in front
      if (t.ramp) {
        const za = t.z0 - RL;
        if (camX < xl) { pt(xl + 0.03, 0, za); pt(xl + 0.03, ROOF, t.z0); pt(xl + 0.03, 0, t.z0); poly(RAMPS[fi]); }
        if (camX > xr) { pt(xr - 0.03, 0, za); pt(xr - 0.03, ROOF, t.z0); pt(xr - 0.03, 0, t.z0); poly(RAMPS[fi]); }
        pt(xl + 0.03, 0, za); pt(xr - 0.03, 0, za); pt(xr - 0.03, ROOF, t.z0); pt(xl + 0.03, ROOF, t.z0);
        if (poly(RAMP[fi])) {
          // yellow chevrons on the ramp
          ctx.beginPath();
          for (let i = 0; i < 4; i++) { const k0 = (i + 0.2) / 4, k1 = (i + 0.55) / 4; pt(xl + 0.15, ROOF * k0, za + RL * k0); pt(xr - 0.15, ROOF * k0, za + RL * k0); pt(xr - 0.15, ROOF * k1, za + RL * k1); pt(xl + 0.15, ROOF * k1, za + RL * k1); poly(null, false); }
          ctx.fillStyle = YEL[fi]; ctx.globalAlpha = 0.75; ctx.fill(); ctx.globalAlpha = 1;
        }
      }
      // the visible side
      const sx = camX < xl ? xl : camX > xr ? xr : null;
      if (sx !== null) {
        pt(sx, 0.12, t.z0); pt(sx, ROOF, t.z0); pt(sx, ROOF, t.z1); pt(sx, 0.12, t.z1);
        if (poly(null)) {
          const fs = fogI(Math.max(0, polyZ * 0.7));
          ctx.fillStyle = P.side[fs]; ctx.fill();
          // window band, a stripe in the line's colour, and lit windows
          ctx.beginPath();
          const n = Math.floor((t.z1 - t.z0 - 1) / 1.7);
          for (let i = 0; i < n; i++) { const wz = t.z0 + 0.8 + i * 1.7; pt(sx, 0.95, wz); pt(sx, 1.45, wz); pt(sx, 1.45, wz + 1.15); pt(sx, 0.95, wz + 1.15); poly(null, false); }
          ctx.fillStyle = P.light[fs]; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
          pt(sx, 0.55, t.z0); pt(sx, 0.7, t.z0); pt(sx, 0.7, t.z1); pt(sx, 0.55, t.z1); poly(P.stripe[fs]);
        }
      }
      // roof
      pt(xl, ROOF, t.z0); pt(xr, ROOF, t.z0); pt(xr, ROOF, t.z1); pt(xl, ROOF, t.z1);
      if (poly(null)) {
        ctx.fillStyle = P.roof[fogI(Math.max(0, polyZ * 0.8))]; ctx.fill();
        pt(t.x - 0.12, ROOF + 0.01, t.z0 + 0.6); pt(t.x + 0.12, ROOF + 0.01, t.z0 + 0.6); pt(t.x + 0.12, ROOF + 0.01, t.z1 - 0.6); pt(t.x - 0.12, ROOF + 0.01, t.z1 - 0.6); poly(P.side[fi]);
      }
      // front face (flat to the camera → a screen rectangle)
      if (t.z0 - camZ > NEAR && proj(xl, ROOF, t.z0)) {
        const ax = SX, ay = SY, k = SK;
        proj(xr, 0.12, t.z0);
        const bx = SX, by = SY, w = bx - ax, h = by - ay;
        ctx.fillStyle = P.body[fi];
        ctx.beginPath(); ctx.roundRect(ax, ay, w, h, k * 0.18); ctx.fill();
        // glossy highlight
        ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(ax + w * 0.06, ay + h * 0.05, w * 0.88, h * 0.08);
        // windshield
        ctx.fillStyle = '#0a0f1c'; ctx.beginPath(); ctx.roundRect(ax + w * 0.12, ay + h * 0.12, w * 0.76, h * 0.3, k * 0.08); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = Math.max(1, k * 0.03);
        ctx.beginPath(); ctx.moveTo(ax + w * 0.2, ay + h * 0.38); ctx.lineTo(ax + w * 0.38, ay + h * 0.16); ctx.stroke();
        // stripe + lights
        ctx.fillStyle = P.stripe[fi]; ctx.fillRect(ax, ay + h * 0.58, w, h * 0.08);
        const lit = t.vt > 0;
        for (const sd of [0.2, 0.8]) {
          const lx = ax + w * sd, ly = ay + h * 0.76, r = k * 0.09;
          ctx.fillStyle = lit ? '#fffbe6' : '#6b6f80';
          ctx.beginPath(); ctx.arc(lx, ly, r, 0, TAU); ctx.fill();
          if (lit && THEME.glow) { if (THEME.light) ctx.globalAlpha = 0.5 - fi / 40; else { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.9 - fi / 20; } ctx.drawImage(glowSpr, lx - r * 6, ly - r * 6, r * 12, r * 12); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
        }
        ctx.fillStyle = '#07070b'; ctx.fillRect(ax + w * 0.05, by - h * 0.05, w * 0.9, h * 0.05 + k * 0.12);
      }
    }
    function drawBarrier(o) {
      const high = o.type === 'high';
      const fi = fogI(o.z0 - camZ);
      const top = high ? 1.68 : 0.62, bot = high ? 1.05 : 0.3;
      // posts
      if (!proj(o.x - 0.56, top, o.z0)) return;
      const ax = SX, ay = SY, k = SK;
      proj(o.x + 0.56, 0, o.z0);
      const bx = SX, gy = SY;
      ctx.fillStyle = POST[fi];
      ctx.fillRect(ax, ay, k * 0.08, gy - ay); ctx.fillRect(bx - k * 0.08, ay, k * 0.08, gy - ay);
      // the board with stripes
      proj(o.x, bot, o.z0);
      const by = SY;
      ctx.save();
      ctx.beginPath(); ctx.roundRect(ax - k * 0.04, ay, bx - ax + k * 0.08, by - ay, k * 0.05); ctx.clip();
      ctx.fillStyle = high ? YEL[fi] : LOWB[fi]; ctx.fillRect(ax - k, ay, bx - ax + 2 * k, by - ay);
      ctx.fillStyle = high ? DARK[fi] : RED[fi];
      ctx.beginPath();
      const st = k * 0.22, hh = by - ay;
      for (let sx = ax - hh; sx < bx + hh; sx += st * 2) { ctx.moveTo(sx, by); ctx.lineTo(sx + st, by); ctx.lineTo(sx + st + hh, ay); ctx.lineTo(sx + hh, ay); ctx.closePath(); }
      ctx.fill();
      ctx.restore();
      if (high) { // a little warning lamp on top
        const on = Math.sin(g.time * 8 + o.z0) > 0;
        ctx.fillStyle = on ? '#ff4d5e' : '#5a1f26';
        ctx.beginPath(); ctx.arc((ax + bx) / 2, ay - k * 0.06, k * 0.06, 0, TAU); ctx.fill();
      }
    }
    function drawCoin(c) {
      const bob = c.mag ? 0 : Math.sin(g.time * 5 + c.z) * 0.05;
      if (!proj(c.x, c.y + bob + (c.got ? c.gt * 3 : 0), c.z)) return;
      const fi = fogI(SZ), r = 0.24 * SK, w = Math.max(0.2, Math.abs(Math.cos(g.time * 5 + c.z * 0.5)));
      if (c.got) ctx.globalAlpha = Math.max(0, 1 - c.gt / 0.3);
      ctx.fillStyle = GOLDD[fi]; ctx.beginPath(); ctx.ellipse(SX, SY, r * w, r, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = GOLD[fi]; ctx.beginPath(); ctx.ellipse(SX, SY, r * w * 0.7, r * 0.7, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    function drawPower(o) {
      if (o.got || !proj(o.x, 0.85 + Math.sin(g.time * 3) * 0.08, o.z0)) return;
      const r = 0.36 * SK, col = o.kind === 'magnet' ? '#ff4fa3' : '#ffc83d';
      g.draw.circle(SX, SY, r, col, { stroke: '#fff', lw: Math.max(1.5, r * 0.12) });   // flat orb: solid fill, white rim
      drawPowerIcon(o.kind, SX, SY, r * 0.62);
    }
    function drawPowerIcon(kind, cx, cy, s, ink = '#fff', tips = '#1a1a22') {
      if (kind === 'magnet') {
        ctx.lineCap = 'butt';
        ctx.strokeStyle = ink; ctx.lineWidth = s * 0.42;
        ctx.beginPath(); ctx.arc(cx, cy - s * 0.05, s * 0.55, Math.PI, 0, true); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - s * 0.55, cy - s * 0.05); ctx.lineTo(cx - s * 0.55, cy - s * 0.65); ctx.moveTo(cx + s * 0.55, cy - s * 0.05); ctx.lineTo(cx + s * 0.55, cy - s * 0.65); ctx.stroke();
        ctx.strokeStyle = tips; ctx.lineWidth = s * 0.44;
        ctx.beginPath(); ctx.moveTo(cx - s * 0.55, cy - s * 0.5); ctx.lineTo(cx - s * 0.55, cy - s * 0.68); ctx.moveTo(cx + s * 0.55, cy - s * 0.5); ctx.lineTo(cx + s * 0.55, cy - s * 0.68); ctx.stroke();
      } else {
        g.draw.text('2×', cx, cy + s * 0.05, s * 1.25, { color: '#1a1a22', weight: 800 });
      }
    }

    function drawRunner() {
      // shadow on whatever is underneath
      const gy = groundAt();
      if (proj(x, gy + 0.01, pz)) {
        ctx.fillStyle = `rgba(0,0,0,${0.4 / (1 + (y - gy))})`;
        ctx.beginPath(); ctx.ellipse(SX, SY, 0.42 * SK, 0.12 * SK, 0, 0, TAU); ctx.fill();
      }
      if (!proj(x, y, pz)) return;
      ctx.save();
      ctx.translate(SX, SY); ctx.scale(SK, SK);
      const lean = clamp((laneX(lane) - x) * 0.28, -0.35, 0.35);
      ctx.rotate(state === 'crash' ? -0.5 * Math.min(1, stateT * 3) : lean);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const HOOD = '#7c5cff', HOODD = '#5b3fd6', JEANS = '#27355f', CAP = '#34d399';
      if (rollT > 0 && state === 'run') {
        // rolled into a ball, spinning
        const a = g.time * 14;
        ctx.fillStyle = HOODD; ctx.beginPath(); ctx.arc(0, -0.38, 0.36, 0, TAU); ctx.fill();
        ctx.fillStyle = HOOD; ctx.beginPath(); ctx.arc(0, -0.38, 0.3, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 0.05;
        ctx.beginPath(); ctx.arc(0, -0.38, 0.22, a, a + 1.6); ctx.stroke();
        ctx.fillStyle = CAP; ctx.beginPath(); ctx.arc(Math.cos(a) * 0.2, -0.38 + Math.sin(a) * 0.2, 0.09, 0, TAU); ctx.fill();
        ctx.restore();
        return;
      }
      const air = !grounded && state === 'run';
      const ph = runPh;
      for (const sd of [-1, 1]) {
        const lift = air ? 0.35 : Math.max(0, Math.sin(ph + (sd > 0 ? Math.PI : 0)));
        const hx = sd * 0.1, hy = -0.62, fx = sd * 0.12, fy = -lift * (air ? 0.25 : 0.3);
        const kx = sd * 0.14, ky = (hy + fy) / 2 - lift * 0.08;
        ctx.strokeStyle = JEANS; ctx.lineWidth = 0.14;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy - 0.05); ctx.stroke();
        // sneakers with glowing soles
        ctx.fillStyle = '#f2f4f8'; ctx.beginPath(); ctx.ellipse(fx, fy - 0.04, 0.085, 0.055, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = lift > 0.3 ? '#34d399' : '#c9ced8'; ctx.fillRect(fx - 0.075, fy - 0.01, 0.15, 0.025);
      }
      // arms
      const sw = air ? 0.7 : Math.sin(ph) * 0.45;
      ctx.strokeStyle = HOODD; ctx.lineWidth = 0.1;
      for (const sd of [-1, 1]) {
        const a = sd * sw;
        ctx.beginPath(); ctx.moveTo(sd * 0.2, -1.02); ctx.lineTo(sd * (0.3 + (air ? 0.08 : 0)), -0.84 + a * 0.12 - (air ? 0.2 : 0)); ctx.lineTo(sd * (0.28 + (air ? 0.16 : 0)), -0.68 + a * 0.2 - (air ? 0.38 : 0)); ctx.stroke();
      }
      // hoodie body with the hood on the back
      ctx.fillStyle = HOOD; ctx.beginPath(); ctx.roundRect(-0.22, -1.1, 0.44, 0.52, 0.12); ctx.fill();
      ctx.fillStyle = HOODD; ctx.beginPath(); ctx.ellipse(0, -1.0, 0.15, 0.1, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(-0.22, -0.67, 0.44, 0.04);
      // head with a cap worn backwards
      const bob = Math.sin(ph * 2) * 0.012;
      ctx.fillStyle = '#3a2618'; ctx.beginPath(); ctx.arc(0, -1.24 + bob, 0.14, 0, TAU); ctx.fill();
      ctx.fillStyle = CAP; ctx.beginPath(); ctx.arc(0, -1.27 + bob, 0.145, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -1.27 + bob, 0.17, 0.045, 0, 0, Math.PI); ctx.fill();
      ctx.strokeStyle = '#eafff6'; ctx.lineWidth = 0.025; ctx.beginPath(); ctx.arc(0, -1.25 + bob, 0.06, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.restore();
    }

    function drawPowerRings() {
      const R = g.R, list = [];
      if (magnetT > 0) list.push(['magnet', magnetT / 9, '#ff4fa3']);
      if (multT > 0) list.push(['x2', multT / 10, '#ffc83d']);
      list.forEach(([kind, frac, col], i) => {
        const cx = g.cx + (i - (list.length - 1) / 2) * R * 0.15, cy = g.cy - R * 0.44, r = R * 0.05;
        g.draw.circle(cx, cy, r, THEME.paper(0.6), { stroke: THEME.ink(0.14), lw: R * 0.006 });
        g.draw.arc(cx, cy, r, 0, TAU * frac, frac < 0.25 && Math.sin(g.time * 14) > 0 ? g.draw.alpha(col, 0.35) : col, R * 0.012);
        ctx.save(); ctx.globalAlpha = 0.95;
        if (kind === 'magnet') { ctx.translate(0, r * 0.15); drawPowerIcon(kind, cx, cy, r * 0.62, THEME.fg, THEME.light ? col : '#1a1a22'); }
        else g.draw.text('2×', cx, cy + r * 0.05, r * 0.8, { color: THEME.fg, weight: 800 });
        ctx.restore();
      });
    }

    // ---------------------------------------------------------------- frame
    g.loop((dt) => {
      update(dt);
      genBuildings();
      flash = Math.max(0, flash - dt * 2.2); shake = Math.max(0, shake - dt * 2.5);
      const R = g.R;
      F = R * 0.95; HY = g.cy - R * 0.28; CXs = g.cx;
      camX += (x * 0.45 - camX) * (1 - Math.exp(-7 * dt));
      groundS += (Math.max(0, y > 0.01 && grounded ? y : groundAt()) - groundS) * (1 - Math.exp(-5 * dt));
      camY = CH + groundS * 0.8; camZ = pz - CB;
      if (shake > 0) { camX += rand(-1, 1) * shake * 0.06; camY += rand(-1, 1) * shake * 0.06; }
      const sc = Math.floor(pts);
      if (sc !== shownScore) { shownScore = sc; g.score(sc); }
      const sub = `◎ ${coins}${multT > 0 ? '  ·  2×' : ''}`;
      if (sub !== shownSub) { shownSub = sub; g.sub(sub); }

      if (artKey !== `${THEME.id}|${THEME.mode}`) buildArt();   // the theme changed: repaint the cached scenery once
      ctx.save();
      g.draw.clipCircle(R);
      ctx.drawImage(backdrop, 0, 0, g.S, g.S);
      drawCity();
      drawTrack();
      drawObjects();
      if (stumbleT > 0 && state === 'run') { ctx.globalAlpha = Math.min(1, stumbleT) * (0.5 + 0.5 * Math.sin(g.time * 10)); ctx.beginPath(); ctx.arc(g.cx, g.cy, R * 0.93, 0, TAU); ctx.strokeStyle = 'rgba(255,77,94,.55)'; ctx.lineWidth = R * 0.05; ctx.stroke(); ctx.globalAlpha = 1; }
      if (vignette) { ctx.beginPath(); ctx.arc(g.cx, g.cy, R * 0.81, 0, TAU); ctx.strokeStyle = vignette; ctx.lineWidth = R * 0.38; ctx.stroke(); }
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.4})`; ctx.fillRect(0, 0, g.S, g.S); }
      ctx.restore();
      ctx.beginPath(); ctx.arc(g.cx, g.cy, R * 0.948, 0, TAU); ctx.strokeStyle = g.theme.line; ctx.lineWidth = Math.max(1, R * 0.008); ctx.stroke();
      drawPowerRings();
      g.draw.particles(dt, R);
      g.draw.floaters(dt);
    });
    return {};
  },
};
