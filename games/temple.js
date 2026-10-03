// Temple Dash — run along an ancient stone path hanging over a dark void, seen from behind the runner.
// The path turns 90° at corners (swipe left/right near the corner or you run off the edge); between
// corners a swipe changes lane. Swipe up to jump (logs, gaps), down to slide (stone arches).
// Something with glowing eyes follows: stumble once and it closes in — stumble again soon after and it
// catches you. Score = metres + 10 per coin.
import { TAU, rand, clamp, lerp } from './kit.js';

// ground plane: x east, y north; heights up. A piece of path runs straight in one of 4 directions.
const DX = [0, 1, 0, -1], DY = [1, 0, -1, 0];
const HW = 1.5;                    // half the path width (3 lanes of 1)
const TL = 2.4;                    // stone slab length
const VIEW = 56;                   // draw distance
const CB = 6, CH = 4, NEAR = 0.35; // camera: behind, height, near plane
const GRAV = 22, JUMP_V = 7.6;
const FOG = [34, 27, 18];

export default {
  howTo: 'Swipe left/right to turn at corners and switch lanes, up to jump, down to slide. Stumble twice and it catches you.',
  scoring: 'high',
  create(g) {
    const { ctx } = g;
    // ---------------------------------------------------------------- state
    const pieces = [];
    let cur = 0;
    let s = 0, lat = 0, laneT = 0, h = 0, vh = 0, slideT = 0, slideQ = false, grounded = true;
    let speed = 9, dist = 0, coins = 0, runPh = 0, shownScore = -1, shownSub = '';
    let state = 'run', stateT = 0, fallS = 0, overSent = false, turnQ = 0, flash = 0;
    let camAng = 0, camTarget = 0, camOff = 0;
    let chase = 1, stumbleT = 0, slowT = 0, chaseX = g.cx;
    let camX = 0, camY = -CB, fX = 0, fY = 1, rX = 1, rY = 0, F = 1, HY = 0, CXs = 0, camH = CH;
    let backdrop = null, vignette = null, band = null, glowSpr = null;
    const diff = () => clamp(dist / 2600, 0, 1);

    // ---------------------------------------------------------------- the path
    function cornerOf(pc) { return [pc.sx + DX[pc.dir] * pc.len, pc.sy + DY[pc.dir] * pc.len]; }
    function makePiece(sx, sy, dir, { first = false, startAt = 9 } = {}) {
      const d = diff();
      const len = first ? 48 : Math.round(rand(28, 46) - d * 6);
      const r = Math.random();
      const turn = r < 0.2 ? 'T' : r < 0.6 ? 'L' : 'R';
      const pc = { sx, sy, dir, len, turn, from: first ? -40 : HW, obs: [], coins: [], gaps: [], torches: [], stubs: null };
      populate(pc, first ? 26 : startAt);
      if (turn === 'T') {
        const [cx0, cy0] = cornerOf(pc);
        pc.stubs = [-1, 1].map((sg) => ({ sx: cx0, sy: cy0, dir: (dir + sg + 4) % 4, len: 24, from: HW, obs: [], coins: [], gaps: [], torches: [], stub: true }));
      }
      pieces.push(pc);
      return pc;
    }
    function populate(pc, at) {
      const d = diff();
      const end = pc.len - 10;
      for (let k = 6; k < pc.len - 2; k += rand(9, 14)) pc.torches.push({ s: k, l: Math.random() < 0.5 ? -HW - 0.35 : HW + 0.35, ph: rand(TAU) });
      while (at < end) {
        const r = Math.random();
        const lane = Math.floor(rand(3)) - 1;
        let used = 1;
        if (r < 0.2) {
          for (let i = 0; i < 6; i++) pc.coins.push({ s: at + i * 1.3, l: lane, h: 0.6, got: false, gt: 0 });
          used = 7;
        } else if (r < 0.38) {
          pc.obs.push({ type: 'rock', s: at, l: lane, d: 0.8 });
          if (d > 0.35 && Math.random() < 0.4) pc.obs.push({ type: 'rock', s: at, l: lane === 1 ? -1 : lane + 1, d: 0.8 });
          if (Math.random() < 0.5) { const l2 = lane === 0 ? (Math.random() < 0.5 ? -1 : 1) : 0; for (let i = 0; i < 4; i++) pc.coins.push({ s: at - 2 + i * 1.3, l: l2, h: 0.6, got: false, gt: 0 }); }
        } else if (r < 0.55) {
          pc.obs.push({ type: 'log', s: at, l: 0, d: 0.7 });
          if (Math.random() < 0.6) for (let i = 0; i < 5; i++) { const k = (i - 2) / 2; pc.coins.push({ s: at + k * 1.8, l: lane, h: 0.7 + (1 - k * k) * 0.8, got: false, gt: 0 }); }
        } else if (r < 0.72) {
          pc.obs.push({ type: 'arch', s: at, l: 0, d: 0.7 });
        } else if (r < 0.88) {
          pc.obs.push({ type: 'statue', s: at, l: lane, d: 1.0 });
          if (d > 0.25 && Math.random() < 0.5) pc.obs.push({ type: 'statue', s: at, l: lane === 0 ? (Math.random() < 0.5 ? -1 : 1) : -lane, d: 1.0 });
        } else if (at > 12 && at < end - 4) {
          const gl = 2.2 + d * 0.9;
          pc.gaps.push([at, at + gl]);
          used = gl + 2;
        }
        at += used + Math.max(8, speed * 0.85) + rand(0, 7);
      }
    }
    function ensureAhead() {
      // keep enough path generated in front (stop at an unresolved T junction)
      let ahead = pieces[cur].len - s;
      for (let i = cur + 1; i < pieces.length; i++) ahead += pieces[i].len;
      let last = pieces[pieces.length - 1];
      while (ahead < VIEW * 1.6 && last.turn !== 'T') {
        const [x, y] = cornerOf(last);
        const nd = (last.dir + (last.turn === 'L' ? -1 : 1) + 4) % 4;
        last = makePiece(x, y, nd);
        ahead += last.len;
      }
      while (cur > 1) { pieces.shift(); cur--; }
    }
    makePiece(0, 0, 0, { first: true });
    ensureAhead();

    // ---------------------------------------------------------------- input
    function act(dir) {
      if (state !== 'run') return;
      if (dir === 'left' || dir === 'right') {
        const sg = dir === 'left' ? -1 : 1;
        const pc = pieces[cur];
        const win = Math.max(7, speed * 0.6);
        const allowed = pc.turn === 'T' || (pc.turn === 'L' && sg < 0) || (pc.turn === 'R' && sg > 0);
        if (allowed && s > pc.len - win) { turnQ = sg; return; }
        laneT = clamp(laneT + sg, -1, 1);
        g.sfx('whoosh', { volume: 0.5 });
      } else if (dir === 'up') {
        if (grounded) { vh = JUMP_V; grounded = false; slideT = 0; g.sfx('jump'); }
      } else if (dir === 'down') {
        if (grounded) { if (slideT <= 0) g.sfx('whoosh'); slideT = 0.72; }
        else { vh = Math.min(vh, -14); slideQ = true; }
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
    g.toast('Swipe to turn & dodge', 1700);

    function doTurn(sg) {
      const pc = pieces[cur];
      const [kx, ky] = cornerOf(pc);
      const d0 = pc.dir;
      const ox = DX[d0] * (s - pc.len) + DX[(d0 + 1) % 4] * lat, oy = DY[d0] * (s - pc.len) + DY[(d0 + 1) % 4] * lat;
      const nd = (d0 + sg + 4) % 4;
      if (pc.turn === 'T') { pc.turn = sg < 0 ? 'L' : 'R'; pc.stubs = null; makePiece(kx, ky, nd, { startAt: 15 }); }
      cur++;
      s = ox * DX[nd] + oy * DY[nd];
      lat = ox * DX[(nd + 1) % 4] + oy * DY[(nd + 1) % 4];
      laneT = clamp(Math.round(lat), -1, 1);
      camTarget += sg * Math.PI / 2;
      turnQ = 0;
      g.sfx('whoosh');
      ensureAhead();
    }

    function stumble() {
      g.vibrate(30); flash = 0.5;
      if (stumbleT > 0) { caught(); return; }
      stumbleT = 7; slowT = 0.7; chase = 1;
      g.sfx('hit'); g.toast('Watch out!', 900);
    }
    function crash() {
      if (state !== 'run') return;
      state = 'crash'; stateT = 0; flash = 1; g.sfx('boom'); g.vibrate(70);
    }
    function caught() {
      if (state !== 'run') return;
      state = 'caught'; stateT = 0; g.sfx('hit'); g.vibrate(80);
    }
    function fall() {
      if (state !== 'run') return;
      state = 'fall'; stateT = 0; fallS = s; g.sfx('drop'); g.vibrate(40);
    }
    function finish(why) {
      if (overSent) return;
      overSent = true;
      const m = Math.floor(dist);
      g.over(m + coins * 10, { title: why, note: `${m.toLocaleString()} m · ${coins} coins`, delay: 900 });
    }

    // ---------------------------------------------------------------- update
    function update(dt) {
      const pc = pieces[cur];
      if (state === 'run') {
        speed = 9 + 10 * (1 - Math.exp(-dist / 2200));
        const v = speed * (slowT > 0 ? 0.7 : 1);
        slowT -= dt; stumbleT -= dt;
        s += v * dt; dist += v * dt;
        runPh += dt * v * 1.35;
        lat += (laneT - lat) * (1 - Math.exp(-16 * dt));
        // turning
        if (turnQ && s >= pc.len - 0.3) { doTurn(turnQ); update2(dt); return; }
        if (s > pc.len + HW - 0.15) { fall(); return; }
        update2(dt);
      } else if (state === 'fall') {
        stateT += dt;
        s += speed * 0.55 * dt; vh -= GRAV * 0.8 * dt; h += vh * dt;
        if (stateT > 1.1) finish('You fell!');
      } else if (state === 'crash') {
        stateT += dt;
        chase = Math.min(1.6, chase + dt * 1.6);
        if (stateT > 0.9) finish('Crashed!');
      } else if (state === 'caught') {
        stateT += dt;
        chase = Math.min(1.9, chase + dt * 1.4);
        if (stateT > 1.0) finish('Caught!');
      }
    }
    function update2(dt) {
      const pc = pieces[cur];
      // vertical: jump / slide / gaps
      const overGap = pc.gaps.some(([a, b]) => s > a + 0.25 && s < b - 0.25);
      if (!grounded || overGap) {
        vh -= GRAV * dt; h += vh * dt;
        if (h <= 0) {
          if (overGap) { if (h < -0.15) { fall(); return; } }
          else { h = 0; vh = 0; grounded = true; if (slideQ) { slideT = 0.6; slideQ = false; } }
        } else grounded = false;
      }
      slideT -= dt;
      const sliding = slideT > 0 && grounded;
      // obstacles on this piece
      for (const o of pc.obs) {
        if (o.done) continue;
        if (Math.abs(s - o.s) > o.d / 2 + 0.25) continue;
        if (o.type === 'rock') {
          if (Math.abs(lat - o.l) < 0.62 && h < 0.45) { o.done = true; o.smash = 0.001; stumble(); if (projP(pc, o.s, o.l, 0.3)) g.draw.burst(SX, SY, '#a8977a', 14, g.R * 0.5); }
        } else if (o.type === 'log') {
          if (h < 0.42) { o.done = true; stumble(); }
        } else if (o.type === 'arch') {
          if (!sliding || h > 0.3) { o.done = true; crash(); return; }
        } else if (o.type === 'statue') {
          if (Math.abs(lat - o.l) < 0.7 && h < 1.85) { o.done = true; crash(); return; }
        }
      }
      // coins
      for (const c of pc.coins) {
        if (c.got) { c.gt += dt; continue; }
        if (Math.abs(s - c.s) < 0.7 && Math.abs(lat - c.l) < 0.6 && Math.abs(h + 0.6 - c.h) < 0.9) {
          c.got = true; coins++; g.sfx('coin', { volume: 0.55 });
        }
      }
      chase = Math.max(stumbleT > 0 ? 0.75 : 0.12, chase - dt * (stumbleT > 0 ? 0.05 : 0.3));
    }

    // ---------------------------------------------------------------- camera & projection
    function setCamera(dt) {
      camAng += (camTarget - camAng) * (1 - Math.exp(-9 * dt));
      const pc = pieces[cur];
      if (state === 'run' || state === 'crash' || state === 'caught') {
        camOff += (lat * 0.3 - camOff) * (1 - Math.exp(-8 * dt));
      }
      fX = Math.sin(camAng); fY = Math.cos(camAng); rX = Math.cos(camAng); rY = -Math.sin(camAng);
      if (state !== 'fall') {
        const px = pc.sx + DX[pc.dir] * s + DX[(pc.dir + 1) % 4] * lat, py = pc.sy + DY[pc.dir] * s + DY[(pc.dir + 1) % 4] * lat;
        camX = px - fX * CB - rX * camOff; camY = py - fY * CB - rY * camOff;
      }
      F = g.R * 0.95; HY = g.cy - g.R * 0.3; CXs = g.cx;
    }
    let WX = 0, WY = 0, SX = 0, SY = 0, SZ = 0, SK = 0;
    function wp(pc, ss, ll) { const d = pc.dir, r = (d + 1) & 3; WX = pc.sx + DX[d] * ss + DX[r] * ll; WY = pc.sy + DY[d] * ss + DY[r] * ll; }
    function proj(X, Y, H) {
      const dx = X - camX, dy = Y - camY;
      SZ = dx * fX + dy * fY;
      if (SZ < NEAR) return false;
      SK = F / SZ; SX = CXs + (dx * rX + dy * rY) * SK; SY = HY + (camH - H) * SK;
      return true;
    }
    function projP(pc, ss, ll, hh) { wp(pc, ss, ll); return proj(WX, WY, hh); }
    // polygons: collect world points, clip at the near plane, fill
    const PW = new Float64Array(3 * 8), CA = new Float64Array(3 * 8), PC = new Float64Array(3 * 16);
    let pn = 0, polyZ = 0;
    function pt(pc, ss, ll, hh) { wp(pc, ss, ll); PW[pn * 3] = WX; PW[pn * 3 + 1] = WY; PW[pn * 3 + 2] = hh; pn++; }
    function poly(style) {
      let near = 0, zs = 0;
      for (let i = 0; i < pn; i++) {
        const dx = PW[i * 3] - camX, dy = PW[i * 3 + 1] - camY;
        CA[i * 3] = dx * rX + dy * rY; CA[i * 3 + 1] = dx * fX + dy * fY; CA[i * 3 + 2] = PW[i * 3 + 2];
        if (CA[i * 3 + 1] >= NEAR) near++;
        zs += CA[i * 3 + 1];
      }
      polyZ = zs / pn;
      if (!near) { pn = 0; return false; }
      let m = 0;
      for (let i = 0; i < pn; i++) {
        const j = (i + 1) % pn, zi = CA[i * 3 + 1], zj = CA[j * 3 + 1];
        if (zi >= NEAR) { PC[m * 3] = CA[i * 3]; PC[m * 3 + 1] = zi; PC[m * 3 + 2] = CA[i * 3 + 2]; m++; }
        if ((zi >= NEAR) !== (zj >= NEAR)) {
          const t = (NEAR - zi) / (zj - zi);
          PC[m * 3] = CA[i * 3] + (CA[j * 3] - CA[i * 3]) * t; PC[m * 3 + 1] = NEAR; PC[m * 3 + 2] = CA[i * 3 + 2] + (CA[j * 3 + 2] - CA[i * 3 + 2]) * t; m++;
        }
      }
      pn = 0;
      if (m < 3) return false;
      ctx.beginPath();
      for (let i = 0; i < m; i++) {
        const k = F / PC[i * 3 + 1], x = CXs + PC[i * 3] * k, y = HY + (camH - PC[i * 3 + 2]) * k;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      if (style) { ctx.fillStyle = style; ctx.fill(); }
      return true;
    }
    // fog palettes: 17 shades from the colour to the haze
    function pal(hex) {
      const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      return Array.from({ length: 17 }, (_, i) => { const t = (i / 16) ** 0.9; return `rgb(${c.map((v, j) => Math.round(lerp(v, FOG[j], t))).join(',')})`; });
    }
    const fogI = (z) => clamp(Math.round((z - 10) / (VIEW - 10) * 16), 0, 16);
    const STONE = [pal('#958060'), pal('#857256'), pal('#9f8a66')];
    const CURB = pal('#a89470'), CLIFF = pal('#3b3024'), CLIFF2 = pal('#2a2219'), GROOVE = pal('#4a3e2e');
    const LOG = pal('#6b4a2b'), LOGTOP = pal('#8a6238'), ROCK = pal('#8d8778'), ROCKD = pal('#5d584d');
    const ARCH = pal('#6f6250'), ARCHD = pal('#4f4538'), ARCHT = pal('#8b7c64');
    const GOLD = pal('#ffc94a'), GOLDD = pal('#c8901a');

    // ---------------------------------------------------------------- drawing
    function buildArt() {
      const R = g.R, S = g.S, dpr = g.dpr || 1;
      // the backdrop (sky, void, the warm glow at the horizon) never moves: paint it once
      backdrop = document.createElement('canvas');
      backdrop.width = backdrop.height = Math.max(1, Math.round(S * dpr));
      const k = backdrop.getContext('2d'); k.scale(dpr, dpr);
      const hy = g.cy - R * 0.3;
      const sky = k.createLinearGradient(0, g.cy - R, 0, hy);
      sky.addColorStop(0, '#06080d'); sky.addColorStop(0.55, '#121310'); sky.addColorStop(1, `rgb(${FOG.join(',')})`);
      k.fillStyle = sky; k.fillRect(0, 0, S, hy + 1);
      const vd = k.createLinearGradient(0, hy, 0, g.cy + R);
      vd.addColorStop(0, `rgb(${FOG.join(',')})`); vd.addColorStop(0.18, '#0c0a08'); vd.addColorStop(1, '#020202');
      k.fillStyle = vd; k.fillRect(0, hy, S, S - hy);
      const hg = k.createRadialGradient(g.cx, hy, 0, g.cx, hy, R * 0.95);
      hg.addColorStop(0, g.draw.alpha(g.color, 0.2)); hg.addColorStop(0.5, g.draw.alpha(g.color, 0.06)); hg.addColorStop(1, 'rgba(0,0,0,0)');
      k.fillStyle = hg; k.fillRect(0, 0, S, S);
      // a dark rim (drawn as a thick ring so only the edge pixels are touched)
      vignette = ctx.createRadialGradient(g.cx, g.cy, R * 0.6, g.cx, g.cy, R);
      vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.7)');
      // a wrap-around band of jungle ridges and glowing ruins along the horizon
      const BW = Math.round(R * 4.8), BH = Math.round(R * 0.5);
      band = document.createElement('canvas');
      band.width = Math.round(BW * dpr); band.height = Math.round(BH * dpr);
      const b = band.getContext('2d'); b.scale(dpr, dpr);
      const ridge = (amp, base, seeds, col) => {
        b.beginPath(); b.moveTo(0, BH);
        for (let x = 0; x <= BW; x += 4) {
          let y = 0; for (const [k, ph, a] of seeds) y += Math.sin((x / BW) * TAU * k + ph) * a;
          b.lineTo(x, BH - base - y * amp);
        }
        b.lineTo(BW, BH); b.closePath(); b.fillStyle = col; b.fill();
      };
      // stars
      b.fillStyle = 'rgba(255,240,210,.5)';
      for (let i = 0; i < 70; i++) b.fillRect(rand(BW), rand(BH * 0.55), rand(0.8, 1.8), rand(0.8, 1.8));
      ridge(R * 0.05, BH * 0.38, [[3, 0.3, 1], [7, 1.1, 0.6], [13, 2.4, 0.35]], '#141512');
      // ruins: stepped temples with glowing doorways
      const ruins = 6;
      for (let i = 0; i < ruins; i++) {
        const x0 = (i + rand(0.15, 0.6)) * BW / ruins, w = R * rand(0.22, 0.34), steps = 4 + Math.floor(rand(3));
        const hgt = R * rand(0.16, 0.26);
        b.fillStyle = '#221f17';
        for (let st = 0; st < steps; st++) {
          const ww = w * (1 - st / (steps + 1)), hh = hgt / steps;
          b.fillRect(x0 - ww / 2, BH - BH * 0.18 - hh * (st + 1), ww, hh + 1);
        }
        b.save(); b.shadowColor = '#eab308'; b.shadowBlur = 14;
        b.fillStyle = 'rgba(255,190,70,.85)';
        b.fillRect(x0 - w * 0.04, BH - BH * 0.18 - hgt * 0.35, w * 0.08, hgt * 0.35);
        b.beginPath(); b.arc(x0, BH - BH * 0.18 - hgt - 4, 3, 0, TAU); b.fill();
        b.restore();
        // broken pillars nearby
        b.fillStyle = '#17150f';
        for (let k = 0; k < 3; k++) { const px = x0 + w * rand(0.6, 1.4) * (k % 2 ? 1 : -1), ph = R * rand(0.06, 0.16); b.fillRect(px, BH - BH * 0.18 - ph, R * 0.025, ph); }
      }
      ridge(R * 0.035, BH * 0.16, [[5, 0.8, 1], [11, 0.2, 0.7], [23, 1.7, 0.4]], '#0e110d');
      // haze along the bottom
      const hz = b.createLinearGradient(0, BH * 0.6, 0, BH);
      hz.addColorStop(0, 'rgba(34,27,18,0)'); hz.addColorStop(1, 'rgba(34,27,18,.75)');
      b.fillStyle = hz; b.fillRect(0, BH * 0.6, BW, BH * 0.4);
      band.bw = BW; band.bh = BH;
      // a soft glow sprite for torches and eyes
      glowSpr = document.createElement('canvas'); glowSpr.width = glowSpr.height = 64;
      const gg = glowSpr.getContext('2d'), gr = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,200,90,.9)'); gr.addColorStop(0.3, 'rgba(255,150,40,.35)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
      gg.fillStyle = gr; gg.fillRect(0, 0, 64, 64);
    }
    g.on('resize', () => buildArt());
    buildArt();

    function drawSky() {
      ctx.drawImage(backdrop, 0, 0, g.S, g.S);
      const BW = band.bw, BH = band.bh;
      let ox = (-camAng / TAU) * BW * 1.0;
      ox = ((ox % BW) + BW) % BW;
      const y = HY - BH;
      for (let x = ox - BW; x < g.S; x += BW) if (x + BW > 0) ctx.drawImage(band, x, y, BW, BH);
    }

    // visible pieces with the s-range to draw: [piece, a, b]
    const vis = [];
    function collectVisible() {
      vis.length = 0;
      const pc = pieces[cur];
      if (cur > 0) { const pv = pieces[cur - 1]; vis.push([pv, pv.len - 8, pv.len + HW]); }
      const sv = state === 'fall' ? fallS : s;
      vis.push([pc, Math.max(pc.from, sv - CB - 4), Math.min(pc.len + HW, sv + VIEW)]);
      let acc = pc.len - sv, i = cur + 1;
      for (; i < pieces.length && acc < VIEW * 1.25; i++) {
        const p = pieces[i];
        vis.push([p, p.from, Math.min(p.len + HW, VIEW * 1.25 - acc)]);
        acc += p.len;
      }
      const last = pieces[pieces.length - 1];
      if (i === pieces.length && last.stubs && acc < VIEW * 1.25) for (const st of last.stubs) vis.push([st, st.from, Math.min(st.len, VIEW * 1.25 - acc + 6)]);
    }
    function solidRanges(p, a, b, out) {
      out.length = 0;
      let x = a;
      for (const [ga, gb] of p.gaps) {
        if (gb <= x) continue; if (ga >= b) break;
        if (ga > x) out.push(x, Math.min(ga, b));
        x = Math.max(x, gb);
      }
      if (x < b) out.push(x, b);
      return out;
    }
    const rng = [];
    function drawGround() {
      // 1) cliff faces below the path (only the ones facing the camera)
      for (const [p, a, b] of vis) {
        const d = p.dir, r = (d + 1) & 3;
        const cs = (camX - p.sx) * DX[d] + (camY - p.sy) * DY[d], cl = (camX - p.sx) * DX[r] + (camY - p.sy) * DY[r];
        solidRanges(p, a, b, rng);
        for (let i = 0; i < rng.length; i += 2) {
          const ra = rng[i], rb = rng[i + 1];
          if (cl < -HW) { pt(p, ra, -HW, 0); pt(p, rb, -HW, 0); pt(p, rb, -HW, -5); pt(p, ra, -HW, -5); poly(null) && (ctx.fillStyle = CLIFF[fogI(polyZ)], ctx.fill()); }
          if (cl > HW) { pt(p, ra, HW, 0); pt(p, rb, HW, 0); pt(p, rb, HW, -5); pt(p, ra, HW, -5); poly(null) && (ctx.fillStyle = CLIFF[fogI(polyZ)], ctx.fill()); }
          const isStart = ra <= p.from + 0.01 && p.from > 0;
          if (cs < ra && !isStart) { pt(p, ra, -HW, 0); pt(p, ra, HW, 0); pt(p, ra, HW, -5); pt(p, ra, -HW, -5); poly(null) && (ctx.fillStyle = CLIFF2[fogI(polyZ)], ctx.fill()); }
          if (cs > rb) { pt(p, rb, -HW, 0); pt(p, rb, HW, 0); pt(p, rb, HW, -5); pt(p, rb, -HW, -5); poly(null) && (ctx.fillStyle = CLIFF2[fogI(polyZ)], ctx.fill()); }
        }
      }
      // 2) the stone slabs
      for (const [p, a, b] of vis) {
        solidRanges(p, a, b, rng);
        const fade = p.stub ? 1 : 0;
        for (let i = 0; i < rng.length; i += 2) {
          const ra = rng[i], rb = rng[i + 1];
          for (let k = Math.floor(ra / TL); k * TL < rb; k++) {
            const s0 = Math.max(ra, k * TL), s1 = Math.min(rb, (k + 1) * TL - 0.12);
            if (s1 - s0 < 0.05) continue;
            pt(p, s0, -HW + 0.12, 0); pt(p, s1, -HW + 0.12, 0); pt(p, s1, HW - 0.12, 0); pt(p, s0, HW - 0.12, 0);
            if (poly(null)) { const pl = STONE[((k % 3) + 3) % 3]; ctx.fillStyle = pl[Math.min(16, fogI(polyZ) + fade * 3)]; ctx.fill(); }
          }
          // curbs along both edges
          for (const sd of [-1, 1]) {
            pt(p, ra, sd * HW, 0); pt(p, rb, sd * HW, 0); pt(p, rb, sd * (HW - 0.12), 0); pt(p, ra, sd * (HW - 0.12), 0);
            if (poly(null)) { ctx.fillStyle = CURB[fogI(polyZ * 0.8)]; ctx.fill(); }
          }
          // lane grooves
          for (const ll of [-0.5, 0.5]) {
            pt(p, ra, ll - 0.03, 0); pt(p, rb, ll - 0.03, 0); pt(p, rb, ll + 0.03, 0); pt(p, ra, ll + 0.03, 0);
            if (poly(null)) { ctx.fillStyle = GROOVE[fogI(polyZ * 0.8)]; ctx.fill(); }
          }
        }
      }
      // 3) glowing chevrons on the corner ahead, pointing the way
      const pc = pieces[cur];
      if (state === 'run' && pc.len - s < VIEW && pc.len - s > -1) {
        const near = clamp(1 - (pc.len - s) / 30, 0, 1);
        const pulse = 0.5 + 0.5 * Math.sin(g.time * 10);
        ctx.globalAlpha = 0.25 + near * 0.55 * (0.6 + 0.4 * pulse);
        const dirs = pc.turn === 'T' ? [-1, 1] : [pc.turn === 'L' ? -1 : 1];
        for (const sg of dirs) {
          for (let i = 0; i < 2; i++) {
            const o = 0.2 + i * 0.55;
            // chevron pointing sideways (sg) on the corner square
            pt(pc, pc.len - 0.6, sg * o, 0.01); pt(pc, pc.len, sg * (o + 0.45), 0.01); pt(pc, pc.len + 0.6, sg * o, 0.01);
            pt(pc, pc.len + 0.35, sg * o, 0.01); pt(pc, pc.len, sg * (o + 0.22), 0.01); pt(pc, pc.len - 0.35, sg * o, 0.01);
            poly('#ffd25a');
          }
        }
        ctx.globalAlpha = 1;
      }
    }

    // sprites sorted by depth
    const spr = Array.from({ length: 160 }, () => ({ z: 0, kind: 0, o: null, p: null }));
    let sprN = 0;
    const sprList = [];
    function addSpr(kind, o, p, z) { if (sprN >= spr.length) return; const e = spr[sprN++]; e.kind = kind; e.o = o; e.p = p; e.z = z; }
    function camZ(p, ss, ll) { wp(p, ss, ll); return (WX - camX) * fX + (WY - camY) * fY; }
    function drawSprites() {
      sprN = 0;
      for (const [p, a, b] of vis) {
        for (const o of p.obs) if (o.s > a - 2 && o.s < b + 1) { const z = camZ(p, o.s, o.l); if (z > NEAR && z < VIEW + 4) addSpr(1, o, p, z); }
        for (const c of p.coins) if ((!c.got || c.gt < 0.3) && c.s > a && c.s < b) { const z = camZ(p, c.s, c.l); if (z > 2.6 && z < VIEW) addSpr(2, c, p, z); }
        for (const t of p.torches) if (t.s > a && t.s < b) { const z = camZ(p, t.s, t.l); if (z > 2.2 && z < VIEW) addSpr(3, t, p, z); }
      }
      addSpr(0, null, pieces[cur], camZ(pieces[cur], s, lat));
      sprList.length = 0;
      for (let i = 0; i < sprN; i++) sprList.push(spr[i]);
      sprList.sort((x, y) => y.z - x.z);
      for (const e of sprList) {
        if (e.kind === 0) drawRunner();
        else if (e.kind === 1) drawObstacle(e.o, e.p);
        else if (e.kind === 2) drawCoin(e.o, e.p);
        else drawTorch(e.o, e.p);
      }
    }
    function drawObstacle(o, p) {
      const s0 = o.s - o.d / 2, s1 = o.s + o.d / 2;
      if (o.type === 'log') {
        const hh = 0.42;
        pt(p, s0, -HW - 0.25, 0); pt(p, s0, HW + 0.25, 0); pt(p, s0, HW + 0.25, hh); pt(p, s0, -HW - 0.25, hh);
        if (!poly(null)) return;
        const fi = fogI(polyZ);
        ctx.fillStyle = LOG[fi]; ctx.fill();
        pt(p, s0, -HW - 0.25, hh); pt(p, s0, HW + 0.25, hh); pt(p, s1, HW + 0.25, hh); pt(p, s1, -HW - 0.25, hh);
        poly(LOGTOP[fi]);
        // bark rings at the ends + a few grain lines
        for (const sd of [-1, 1]) if (projP(p, s0, sd * (HW + 0.25), hh / 2)) { ctx.fillStyle = LOGTOP[fi]; ctx.beginPath(); ctx.ellipse(SX, SY, hh * 0.35 * SK, hh * 0.5 * SK, 0, 0, TAU); ctx.fill(); }
        ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = Math.max(1, SK * 0.03);
        ctx.beginPath();
        for (const hl of [0.14, 0.28]) { if (projP(p, s0, -HW, hl)) { ctx.moveTo(SX, SY); if (projP(p, s0, HW, hl)) ctx.lineTo(SX, SY); } }
        ctx.stroke();
      } else if (o.type === 'rock') {
        if (o.smash) return;
        if (!projP(p, o.s, o.l, 0.3)) return;
        const fi = fogI(SZ), r = 0.4 * SK;
        ctx.fillStyle = ROCKD[fi]; ctx.beginPath(); ctx.ellipse(SX, SY + r * 0.15, r * 1.1, r * 0.85, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = ROCK[fi]; ctx.beginPath(); ctx.ellipse(SX - r * 0.12, SY - r * 0.05, r * 0.9, r * 0.7, -0.2, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.ellipse(SX - r * 0.35, SY - r * 0.35, r * 0.3, r * 0.15, -0.3, 0, TAU); ctx.fill();
      } else if (o.type === 'arch') {
        const bot = 1.0, top = 1.75;
        let fi = 0;
        // pillars
        for (const sd of [-1, 1]) {
          const l0 = sd * (HW + 0.05), l1 = sd * (HW + 0.6);
          pt(p, s0, l0, -1); pt(p, s0, l1, -1); pt(p, s0, l1, top); pt(p, s0, l0, top);
          if (poly(null)) { fi = fogI(polyZ); ctx.fillStyle = ARCH[fi]; ctx.fill(); }
          // inner side face
          pt(p, s0, l0, -1); pt(p, s1, l0, -1); pt(p, s1, l0, top); pt(p, s0, l0, top);
          poly(ARCHD[fi]);
        }
        // lintel: underside, front, top
        pt(p, s0, -HW - 0.7, bot); pt(p, s0, HW + 0.7, bot); pt(p, s1, HW + 0.7, bot); pt(p, s1, -HW - 0.7, bot);
        poly(ARCHD[fi]);
        pt(p, s0, -HW - 0.7, top); pt(p, s0, HW + 0.7, top); pt(p, s1, HW + 0.7, top); pt(p, s1, -HW - 0.7, top);
        poly(ARCHT[fi]);
        pt(p, s0, -HW - 0.7, bot); pt(p, s0, HW + 0.7, bot); pt(p, s0, HW + 0.7, top); pt(p, s0, -HW - 0.7, top);
        poly(ARCH[fi]);
        // a glowing rune in the middle
        if (projP(p, s0, 0, (bot + top) / 2)) {
          const r = 0.16 * SK;
          ctx.globalAlpha = 1 - fi / 20;
          ctx.fillStyle = '#ffcf4a';
          ctx.beginPath(); ctx.moveTo(SX, SY - r); ctx.lineTo(SX + r * 0.7, SY); ctx.lineTo(SX, SY + r); ctx.lineTo(SX - r * 0.7, SY); ctx.closePath(); ctx.fill();
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(glowSpr, SX - r * 3, SY - r * 3, r * 6, r * 6);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
        // hanging vines
        ctx.strokeStyle = `rgba(60,90,40,${0.9 - fi / 20})`; ctx.lineWidth = Math.max(1, SK * 0.05);
        ctx.beginPath();
        for (let i = 0; i < 5; i++) { const ll = -1.3 + i * 0.65, len = 0.18 + ((i * 37) % 5) * 0.05; if (projP(p, s0, ll, bot)) { ctx.moveTo(SX, SY); if (projP(p, s0, ll + 0.05, bot - len)) ctx.lineTo(SX, SY); } }
        ctx.stroke();
      } else if (o.type === 'statue') {
        const top = 1.9, l0 = o.l - 0.44, l1 = o.l + 0.44;
        const cl = (camX - p.sx) * DX[(p.dir + 1) & 3] + (camY - p.sy) * DY[(p.dir + 1) & 3];
        pt(p, s0, l0, 0); pt(p, s0, l1, 0); pt(p, s0, l1, top); pt(p, s0, l0, top);
        if (!poly(null)) return;
        const fi = fogI(polyZ);
        ctx.fillStyle = ARCH[fi]; ctx.fill();
        if (cl < l0) { pt(p, s0, l0, 0); pt(p, s1, l0, 0); pt(p, s1, l0, top); pt(p, s0, l0, top); poly(ARCHD[fi]); }
        if (cl > l1) { pt(p, s0, l1, 0); pt(p, s1, l1, 0); pt(p, s1, l1, top); pt(p, s0, l1, top); poly(ARCHD[fi]); }
        pt(p, s0, l0, top); pt(p, s0, l1, top); pt(p, s1, l1, top); pt(p, s1, l0, top); poly(ARCHT[fi]);
        // a carved face with glowing eyes
        pt(p, s0, l0 + 0.12, 0.95); pt(p, s0, l1 - 0.12, 0.95); pt(p, s0, l1 - 0.12, 1.02); pt(p, s0, l0 + 0.12, 1.02); poly(ARCHD[fi]);
        pt(p, s0, l0 + 0.18, 0.35); pt(p, s0, l1 - 0.18, 0.35); pt(p, s0, l1 - 0.18, 0.55); pt(p, s0, l0 + 0.18, 0.55); poly(ARCHD[fi]);
        ctx.globalAlpha = 1 - fi / 18;
        for (const sd of [-1, 1]) {
          if (!projP(p, s0, o.l + sd * 0.17, 1.35)) continue;
          const r = 0.07 * SK;
          ctx.fillStyle = '#ffdf7a'; ctx.fillRect(SX - r, SY - r * 0.6, r * 2, r * 1.2);
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(glowSpr, SX - r * 4, SY - r * 4, r * 8, r * 8);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.globalAlpha = 1;
      }
    }
    function drawCoin(c, p) {
      const bob = Math.sin(g.time * 4 + c.s) * 0.06;
      if (!projP(p, c.s, c.l, c.h + bob + (c.got ? c.gt * 3 : 0))) return;
      const fi = fogI(SZ), r = 0.27 * SK, w = Math.max(0.2, Math.abs(Math.cos(g.time * 4 + c.s * 0.7)));
      ctx.globalAlpha = c.got ? Math.max(0, 1 - c.gt / 0.3) : 1;
      ctx.fillStyle = GOLDD[fi]; ctx.beginPath(); ctx.ellipse(SX, SY, r * w, r, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = GOLD[fi]; ctx.beginPath(); ctx.ellipse(SX, SY, r * w * 0.72, r * 0.72, 0, 0, TAU); ctx.fill();
      if (fi < 8) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.ellipse(SX - r * w * 0.3, SY - r * 0.3, r * w * 0.18, r * 0.18, 0, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    function drawTorch(t, p) {
      if (!projP(p, t.s, t.l, 0)) return;
      const x0 = SX, y0 = SY, fi = fogI(SZ);
      projP(p, t.s, t.l, 1.3);
      ctx.strokeStyle = ARCHD[fi]; ctx.lineWidth = Math.max(1.5, 0.12 * SK); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(SX, SY); ctx.stroke();
      const fl = 1 + Math.sin(g.time * 17 + t.ph) * 0.12 + Math.sin(g.time * 7 + t.ph) * 0.08;
      const r = 0.22 * SK * fl;
      ctx.fillStyle = '#ffcf6a';
      ctx.beginPath(); ctx.ellipse(SX, SY - r * 0.6, r * 0.45, r * 0.9, 0, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9 - fi / 20;
      ctx.drawImage(glowSpr, SX - r * 5, SY - r * 5.6, r * 10, r * 10);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawRunner() {
      const pc = pieces[cur];
      // shadow
      const overGap = pc.gaps.some(([a, b]) => s > a && s < b);
      if (state !== 'fall' && !overGap && projP(pc, s, lat, 0)) {
        ctx.fillStyle = `rgba(0,0,0,${0.35 / (1 + h)})`;
        ctx.beginPath(); ctx.ellipse(SX, SY, 0.45 * SK, 0.13 * SK, 0, 0, TAU); ctx.fill();
      }
      if (!projP(pc, s, lat, h)) return;
      const k = SK, x = SX, y = SY;
      ctx.save();
      ctx.translate(x, y); ctx.scale(k, k);
      if (state === 'crash') { ctx.rotate(-0.25 * Math.min(1, stateT * 4)); ctx.translate(0, -0.2 * Math.sin(Math.min(1, stateT * 3) * Math.PI)); }
      if (state === 'fall') ctx.rotate(Math.sin(stateT * 9) * 0.25);
      const sliding = slideT > 0 && grounded && state === 'run';
      const air = !grounded && state === 'run';
      const lean = (laneT - lat) * 0.25;
      ctx.rotate(lean);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (sliding) {
        // low slide: knees forward, leaning back — we see the back and the head low
        ctx.fillStyle = '#3d4a2f'; ctx.beginPath(); ctx.ellipse(0, -0.25, 0.32, 0.2, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#7a4f2a'; ctx.beginPath(); ctx.roundRect(-0.2, -0.5, 0.4, 0.3, 0.08); ctx.fill();
        ctx.fillStyle = '#2b1d14'; ctx.beginPath(); ctx.arc(0, -0.62, 0.15, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#d9483b'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(-0.14, -0.64); ctx.lineTo(0.14, -0.64); ctx.stroke();
        ctx.strokeStyle = '#c99a6b'; ctx.lineWidth = 0.09;
        ctx.beginPath(); ctx.moveTo(-0.28, -0.3); ctx.lineTo(-0.45, -0.08); ctx.moveTo(0.28, -0.3); ctx.lineTo(0.45, -0.08); ctx.stroke();
        ctx.restore();
        return;
      }
      const ph = runPh;
      const legs = (sd) => {
        // from behind: the lifted leg's foot kicks up and shows the sole
        const lift = air ? 0.25 : Math.max(0, Math.sin(ph + (sd > 0 ? Math.PI : 0)));
        const hipX = sd * 0.11, hipY = -0.72;
        const footX = sd * 0.13, footY = -lift * (air ? 0.3 : 0.32);
        const kneeY = (hipY + footY) / 2 - lift * 0.08, kneeX = sd * 0.15;
        ctx.strokeStyle = '#b9945f'; ctx.lineWidth = 0.15;
        ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
        ctx.strokeStyle = '#c99a6b'; ctx.lineWidth = 0.1;
        ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footY - 0.06); ctx.stroke();
        ctx.fillStyle = lift > 0.3 ? '#3a2a1c' : '#5a3d24';
        ctx.beginPath(); ctx.ellipse(footX, footY - 0.03, 0.08, 0.05 + lift * 0.03, 0, 0, TAU); ctx.fill();
      };
      legs(-1); legs(1);
      // shorts
      ctx.fillStyle = '#9b7b4c'; ctx.beginPath(); ctx.roundRect(-0.22, -0.86, 0.44, 0.2, 0.06); ctx.fill();
      // arms swinging
      const sw = air ? -0.6 : Math.sin(ph) * 0.5;
      ctx.strokeStyle = '#c99a6b'; ctx.lineWidth = 0.085;
      for (const sd of [-1, 1]) {
        const a = sd * sw;
        ctx.beginPath(); ctx.moveTo(sd * 0.22, -1.18); ctx.lineTo(sd * (0.3 + (air ? 0.12 : 0)), -0.98 + a * 0.12 - (air ? 0.25 : 0)); ctx.lineTo(sd * (0.3 + (air ? 0.2 : 0)), -0.82 + a * 0.2 - (air ? 0.45 : 0)); ctx.stroke();
      }
      // torso (green tunic) with a backpack
      ctx.fillStyle = '#3d4a2f'; ctx.beginPath(); ctx.roundRect(-0.23, -1.25, 0.46, 0.45, 0.1); ctx.fill();
      ctx.fillStyle = '#7a4f2a'; ctx.beginPath(); ctx.roundRect(-0.17, -1.18, 0.34, 0.32, 0.07); ctx.fill();
      ctx.fillStyle = '#5e3c1f'; ctx.fillRect(-0.17, -1.06, 0.34, 0.04);
      ctx.strokeStyle = '#2e2318'; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.moveTo(-0.13, -1.24); ctx.lineTo(-0.13, -1.18); ctx.moveTo(0.13, -1.24); ctx.lineTo(0.13, -1.18); ctx.stroke();
      // head: dark hair, a red headband whose tails flutter, ponytail swinging
      const bob = Math.sin(ph * 2) * 0.015;
      ctx.fillStyle = '#2b1d14'; ctx.beginPath(); ctx.arc(0, -1.38 + bob, 0.15, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2b1d14'; ctx.lineWidth = 0.08;
      ctx.beginPath(); ctx.moveTo(0, -1.36 + bob); ctx.quadraticCurveTo(Math.sin(ph) * 0.12, -1.22, Math.sin(ph - 0.6) * 0.16, -1.12); ctx.stroke();
      ctx.strokeStyle = '#d9483b'; ctx.lineWidth = 0.045;
      ctx.beginPath(); ctx.moveTo(-0.15, -1.42 + bob); ctx.lineTo(0.15, -1.42 + bob); ctx.stroke();
      ctx.lineWidth = 0.03;
      ctx.beginPath(); ctx.moveTo(0.05, -1.42 + bob); ctx.lineTo(0.2, -1.36 + Math.sin(ph * 3) * 0.05); ctx.moveTo(0.05, -1.42 + bob); ctx.lineTo(0.22, -1.42 + Math.sin(ph * 3 + 1) * 0.05); ctx.stroke();
      ctx.restore();
    }

    function drawChaser() {
      const c = chase;
      if (c < 0.05) return;
      const R = g.R;
      const pc = pieces[cur];
      if (projP(pc, s, lat, 0)) chaseX += (SX - chaseX) * 0.08;
      const y = g.cy + R * (1.05 - 0.42 * Math.min(c, 1.2) - Math.max(0, c - 1.2) * 1.0);
      const sz = R * (0.22 + 0.18 * Math.min(c, 1.4));
      const t = g.time;
      ctx.fillStyle = 'rgba(4,3,3,.92)';
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * Math.PI, wob = Math.sin(t * 6 + i * 1.7) * 0.08;
        const bx = chaseX + Math.cos(a) * sz * (0.75 + wob), by = y - Math.sin(a) * sz * (0.35 + wob);
        ctx.moveTo(bx + sz * 0.42, by);
        ctx.arc(bx, by, sz * 0.42, 0, TAU);
      }
      ctx.moveTo(chaseX + sz * 1.25, y + sz * 1.1);
      ctx.ellipse(chaseX, y + sz * 1.1, sz * 1.25, sz * 1.2, 0, 0, TAU);
      ctx.fill();
      // eyes
      const blink = Math.sin(t * 1.3) > 0.97 ? 0.15 : 1;
      for (const sd of [-1, 1]) {
        const ex = chaseX + sd * sz * 0.28, ey = y - sz * 0.25;
        ctx.fillStyle = '#ff6a2a';
        ctx.beginPath(); ctx.ellipse(ex, ey, sz * 0.09, sz * 0.05 * blink, sd * -0.35, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.8;
        ctx.drawImage(glowSpr, ex - sz * 0.35, ey - sz * 0.35, sz * 0.7, sz * 0.7);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // ---------------------------------------------------------------- frame
    g.loop((dt) => {
      update(dt);
      setCamera(dt);
      flash = Math.max(0, flash - dt * 2);
      const sc = Math.floor(dist) + coins * 10;
      if (sc !== shownScore) { shownScore = sc; g.score(sc); }
      const sub = `${Math.floor(dist)} m  ·  ◆ ${coins}`;
      if (sub !== shownSub) { shownSub = sub; g.sub(sub); }

      const R = g.R;
      ctx.save();
      g.draw.clipCircle(R);
      drawSky();
      collectVisible();
      drawGround();
      drawSprites();
      drawChaser();
      if (state === 'caught') { ctx.fillStyle = `rgba(0,0,0,${Math.min(0.75, stateT * 0.8)})`; ctx.fillRect(0, 0, g.S, g.S); }
      ctx.beginPath(); ctx.arc(g.cx, g.cy, R * 0.8, 0, TAU); ctx.strokeStyle = vignette; ctx.lineWidth = R * 0.4; ctx.stroke();
      if (flash > 0) { ctx.fillStyle = `rgba(255,${state === 'crash' ? 230 : 120},${state === 'crash' ? 200 : 90},${flash * 0.35})`; ctx.fillRect(0, 0, g.S, g.S); }
      ctx.restore();
      ctx.beginPath(); ctx.arc(g.cx, g.cy, R * 0.948, 0, TAU); ctx.strokeStyle = g.theme.line; ctx.lineWidth = Math.max(1, R * 0.008); ctx.stroke();
      g.draw.particles(dt, R);
      g.draw.floaters(dt);
    });
    return {};
  },
};
