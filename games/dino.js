// Dino Run — our own little dino runs along the ground across the lower part of the circle, drawn flat and
// 8-bit (pixel sprites in games/dino-pixels.js, snapped to a chunky pixel grid). Tap / space to jump (hold for
// a bit more height), swipe down / ArrowDown to duck (and to drop fast in the air). Cacti come in ones, twos and
// threes; gliders fly at three heights — the middle ones must be ducked. The run speeds up; the score is the
// distance. Day turns to night now and then (in stepped palette changes, like an old console).
import { TAU, clamp, rand, lerp, THEME } from './kit.js';
import { topScores } from './scores.js';
import { INK, DINO, DUCK, CACTI, BIRD, CLOUD, SUN, MOON, SKIES, bake, pixelText } from './dino-pixels.js';

const GY = 0.35;            // ground, × R below the centre
const DX = -0.55;           // the dino's x, × R from the centre
const U = 0.0085;           // one dino drawing unit, × R
const GRAV = 5.2, V0 = 1.62, HOLD = 0.6, HOLD_T = 0.22;
const SPEED0 = 1.25, SPEED_MAX = 2.75, ACCEL = 0.011;
// The longest a jump can last (held all the way), worked out once from the same physics the game uses.
// Obstacles are always spaced so that you can land and jump again: never an impossible sequence.
const AIR_MAX = (() => { let y = 0.0001, vy = V0, t = 0; const dt = 1 / 240; while (y > 0) { const gr = t < HOLD_T ? GRAV * HOLD : GRAV; vy -= gr * dt; y += vy * dt; t += dt; } return t; })();
const REACT = 0.16;   // seconds on the ground between two jumps, at the least
const PX = U * 1.5;   // one art pixel, × R

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
    const stars = Array.from({ length: 30 }, (_, i) => ({ x: hash(i + 1) * 2 - 1, y: -0.9 + hash(i + 50) * 0.95, big: hash(i + 90) > 0.75, tw: hash(i + 7) * TAU }));
    const clouds = Array.from({ length: 4 }, (_, i) => ({ x: -0.8 + i * 0.6 + rand(-0.1, 0.1), y: rand(-0.55, -0.12), s: rand(0.8, 1.25) }));
    const sprites = {};
    let spriteFor = '';
    const bits = [];   // pixel dust: { x, y, vx, vy, life, col } in R units

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
        const vx = speed > 1.7 ? rand(0, 0.18) : 0;
        // a faster glider starts further out so it reaches you no sooner than a still one would
        obs.push({ kind: 'bird', x: x + vx * (x - DX) / speed, bottom, w: 0.15, h: 0.075, flap: rand(TAU), vx });
      } else {
        const maxN = score < 120 ? 1 : score < 450 ? 2 : 3;
        const n = 1 + Math.floor(Math.random() * maxN);
        const big = Math.random() < (score < 120 ? 0.25 : 0.5) && !(n === 3 && speed < 1.75);
        const mixed = n > 1 && score > 300 && Math.random() < 0.35;   // a big one among small ones
        const bigAt = mixed ? Math.floor(Math.random() * n) : -1;
        const parts = [];
        let w = 0;
        for (let i = 0; i < n; i++) {
          const b = mixed ? i === bigAt : big;
          // sizes come from the pixel sprites (small 5 × 9, big 7 × 13 pixels) so the hit box matches the art
          const ph = (b ? 13 : 9) * PX, pw = (b ? 7 : 5) * PX;
          parts.push({ dx: w, h: ph, w: pw, big: b, v: Math.floor(Math.random() * 2) });
          w += pw + PX;
        }
        obs.push({ kind: 'cactus', x, parts, w: w - PX });
      }
      const last = obs[obs.length - 1];
      // time between this obstacle and the next: random, but never shorter than a full jump + a beat
      // (a bit more after a glider, which you may have to duck under first)
      const minT = AIR_MAX + REACT + (last.kind === 'bird' ? 0.12 : 0);
      const t = Math.max(minT, rand(0.8, 1.45) * (last.kind === 'bird' ? 1.1 : 1));
      // now and then a quick double (two obstacles in a row, the second only just reachable) once you're warmed up
      const tight = score > 600 && Math.random() < 0.18;
      nextGap = last.w + speed * (tight ? minT : t);
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
      dust(DX, GY - dino.y - 0.1, 18, 0.9, [INK.G, INK.P, INK.B, '#ffffff']);
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

    // ---------- 8-bit art ----------
    // the sky set: dark themes go from dusk to night (OLED: true black at night), light themes from day to dusk
    const skyPair = () => (THEME.light ? [SKIES.day, SKIES.dusk] : [SKIES.dusk, THEME.mode === 'oled' ? SKIES.black : SKIES.night]);
    // the palette steps between day and night in 4 hard steps, like an old console fading its palette
    const mixHex = (a, b, k) => { const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16); return `rgb(${[0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * k)).join(',')})`; };
    const skyCache = new Map();
    function sky() {
      const step = Math.round(nightK * 4) / 4, key = `${THEME.light}|${THEME.mode}|${step}`;
      let v = skyCache.get(key);
      if (!v) {
        const [A, B] = skyPair();
        v = { step };
        for (const k of Object.keys(A)) v[k] = Array.isArray(A[k]) ? A[k].map((c, i) => mixHex(c, B[k][i], step)) : typeof A[k] === 'number' ? A[k] + (B[k] - A[k]) * step : mixHex(A[k], B[k], step);
        skyCache.set(key, v);
      }
      return v;
    }
    function makeSprites() {
      sprites.dino = Object.fromEntries(['stand', 'runA', 'runB', 'jump', 'dead'].map((k) => [k, bake(DINO[k])]));
      sprites.duck = { a: bake(DUCK.a), b: bake(DUCK.b) };
      sprites.cacti = { small: CACTI.small.map((g) => bake(g)), big: CACTI.big.map((g) => bake(g)) };
      sprites.bird = { up: bake(BIRD.up), down: bake(BIRD.down) };
      sprites.cloud = bake(CLOUD); sprites.sun = bake(SUN); sprites.moon = bake(MOON);
      spriteFor = themeKey();
    }
    const themeKey = () => `${g.R}|${g.dpr}`;
    // one art pixel in screen px, and snapping to the pixel grid (anchored on the dino's ground point)
    const P = () => PX * g.R;
    const snapX = (x) => { const p = P(), o = g.cx + DX * g.R; return o + Math.round((x - o) / p) * p; };
    const snapY = (y) => { const p = P(), o = g.cy + GY * g.R; return o + Math.round((y - o) / p) * p; };
    /** Draw a baked sprite with its pixel (ox, bottom row) at screen (x, y), optionally mirrored. */
    function blit(img, x, y, ox, flip = false) {
      const { ctx } = g, p = P();
      const w = img.width * p, h = img.height * p;
      const left = snapX(x) - ox * p, top = snapY(y) - h;
      if (!flip) ctx.drawImage(img, left, top, w, h);
      else { ctx.save(); ctx.translate(left + w, top); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, w, h); ctx.restore(); }
    }
    function dust(x, y, n, sp, cols) {
      for (let i = 0; i < n; i++) {
        const a = rand(Math.PI * 1.05, Math.PI * 1.95), v = sp * rand(0.3, 1);
        bits.push({ x, y, vx: Math.cos(a) * v * (n > 8 ? 1 : 0.6), vy: Math.sin(a) * v, life: rand(0.35, 0.8), col: cols[i % cols.length] });
      }
    }

    function drawDino(pose) {
      const { cx, cy, R } = g;
      const x = cx + DX * R, y = cy + (GY - dino.y) * R;
      if (pose === 'duck') { blit(Math.floor(dino.leg) % 2 ? sprites.duck.a : sprites.duck.b, x, y, DUCK.ox); return; }
      const img = pose === 'run' ? (Math.floor(dino.leg) % 2 ? sprites.dino.runA : sprites.dino.runB) : sprites.dino[pose] || sprites.dino.stand;
      blit(img, x, y, DINO.ox);
      // blink: cover the eye with body colour for a moment
      if (pose !== 'dead' && dino.blink < 0.13) {
        const p = P(), left = snapX(x) - DINO.ox * p, top = snapY(y) - img.height * p;
        g.ctx.fillStyle = INK.G; g.ctx.fillRect(left + 13 * p, top + 2 * p, 2 * p, p);
      }
    }
    function drawCactus(o) {
      const { cx, cy, R } = g;
      for (const pt of o.parts) {
        const img = sprites.cacti[pt.big ? 'big' : 'small'][pt.v];
        blit(img, cx + (o.x + pt.dx) * R, cy + GY * R, 0);
      }
    }
    function drawBird(o) {
      const { cx, cy, R } = g;
      const img = Math.sin(o.flap) > 0 ? sprites.bird.up : sprites.bird.down;
      // centred on the hit box: bottom of the sprite half its height below the glider's middle
      blit(img, cx + (o.x - o.w * 0.5) * R, cy + (GY - o.bottom - o.h * 0.5) * R + img.height * P() * 0.5, 0);
    }

    // ---------- frame ----------
    g.loop((dt, t) => {
      now += dt;
      const { ctx, cx, cy, R } = g;
      if (spriteFor !== themeKey()) makeSprites();
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
            dust(DX - 0.02, GY, 5, 0.3, [sky().edge, sky().pebble]);
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

      // ---- draw (flat 8-bit: hard-edged rects and pixel sprites, no gradients or glows) ----
      const sk = sky(), p = P(), gy = cy + GY * R;
      ctx.imageSmoothingEnabled = false;
      const shake = phase === 'dead' ? Math.max(0, 1 - (now - deadT) / 0.35) : 0;
      ctx.save();
      if (shake) ctx.translate(Math.round(rand(-1, 1) * shake * 2) * p, Math.round(rand(-1, 1) * shake * 2) * p);
      // sky: flat bands, the lowest ones near the horizon
      const top = cy - R * 1.05, bandH = [0.62, 0.22, 0.13, 0.1];
      let by = top;
      sk.bands.forEach((col, i) => {
        const hgt = i === 0 ? gy - top - R * (bandH[1] + bandH[2] + bandH[3]) : R * bandH[i];
        ctx.fillStyle = col; ctx.fillRect(0, snapY(by), g.S, Math.ceil(hgt / p) * p + p); by += hgt;
      });
      // stars come out as it gets dark (they blink on and off, no soft twinkle)
      if (sk.step > 0.4) {
        for (const st of stars) {
          let sx = st.x - (world * 0.02) % 2; if (sx < -1) sx += 2;
          if (Math.sin(t * 2.2 + st.tw) < -0.6) continue;
          ctx.fillStyle = st.big ? '#ffffff' : sk.dim;
          const sz = st.big ? p : Math.max(1, Math.round(p / 2));
          ctx.fillRect(snapX(cx + sx * R), snapY(cy + st.y * R), sz, sz);
        }
      }
      // the sun by day, the moon at night (it drifts across while it's dark)
      {
        const cyc = score % 700, k = sk.step > 0.5 ? clamp((cyc - 440) / 260, 0, 1) : clamp(cyc / 440, 0, 1);
        const mx = lerp(0.5, -0.5, k), my = -0.42 - 0.08 * Math.sin(k * Math.PI);
        const img = sk.step > 0.5 ? sprites.moon : sprites.sun;
        ctx.drawImage(img, snapX(cx + mx * R), snapY(cy + my * R), img.width * p * 1.5, img.height * p * 1.5);
      }
      // clouds
      ctx.globalAlpha = sk.cloud;
      for (const c of clouds) {
        if (phase === 'run') c.x -= speed * dt * 0.16;
        if (c.x < -1.3) { c.x = 1.2 + rand(0.3); c.y = rand(-0.55, -0.12); c.s = rand(0.8, 1.25); }
        const sc = c.s > 1.05 ? 2 : 1.5;
        ctx.drawImage(sprites.cloud, snapX(cx + c.x * R), snapY(cy + c.y * R), sprites.cloud.width * p * sc, sprites.cloud.height * p * sc);
      }
      ctx.globalAlpha = 1;
      // far mesas: flat-topped and stepped, scrolling slowly (two layers)
      for (const [layer, col, par, hMax] of [[0, sk.mesa2, 0.12, 14], [1, sk.mesa, 0.25, 8]]) {
        ctx.fillStyle = col;
        const off = world * par / PX, first = Math.floor(off) - 2, cols = Math.ceil(2.2 / PX) + 4;
        const runH = (r) => (hash(r * 2.3 + layer * 11) > 0.45 ? Math.floor(3 + hash(r * 5.1 + layer * 7) * hMax) : 0);
        for (let i = first; i < first + cols; i++) {
          const j = i + layer * 5, run = Math.floor(j / 10), c = j - run * 10;   // runs of 10 columns share a height
          let h = runH(run);
          if (c < 2) h = Math.min(h, Math.max(runH(run - 1), h - (2 - c) * 2));   // step down into a lower neighbour
          if (c > 7) h = Math.min(h, Math.max(runH(run + 1), h - (c - 7) * 2));
          if (h <= 0) continue;
          ctx.fillRect(Math.floor(cx - R + (i - off) * p), gy - h * p, Math.ceil(p) + 1, h * p);
        }
      }
      // the ground: flat fill, a lighter top edge, scrolling pebbles
      ctx.fillStyle = sk.ground; ctx.fillRect(0, gy, g.S, g.S - gy);
      ctx.fillStyle = sk.edge; ctx.fillRect(0, gy, g.S, p);
      ctx.fillStyle = sk.pebble;
      const pe = 0.045, first = Math.floor((world - 1) / pe);
      for (let i = first; i < first + 2 / pe + 2; i++) {
        if (hash(i * 3.1) < 0.4) continue;
        const x = i * pe + hash(i * 7.3) * pe - world;
        const y = 0.03 + hash(i * 1.7) * 0.08, w = hash(i * 5.9) > 0.6 ? 2 : 1;
        ctx.fillRect(snapX(cx + x * R), snapY(gy + y * R), w * p, p);
      }

      // obstacles
      for (const o of obs) { if (o.kind === 'cactus') drawCactus(o); else drawBird(o); }

      // the dino
      const pose = phase === 'dead' ? 'dead' : phase === 'wait' ? 'stand' : !onGround() ? 'jump' : dino.duck ? 'duck' : 'run';
      drawDino(pose);

      // pixel dust
      for (let i = bits.length - 1; i >= 0; i--) {
        const d = bits[i];
        d.life -= dt; if (d.life <= 0) { bits.splice(i, 1); continue; }
        d.vy += 2.2 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.y > GY + 0.01) { d.y = GY + 0.01; d.vy *= -0.3; d.vx *= 0.6; }
        ctx.fillStyle = d.col; ctx.fillRect(snapX(cx + d.x * R), snapY(cy + d.y * R), p, p);
      }

      ctx.restore();
      // the hit flash: two hard frames of white
      if (phase === 'dead' && now - deadT < 0.1) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(0, 0, g.S, g.S); }

      // hint before the start
      if (phase === 'wait') {
        if (Math.floor(now * 2.5) % 2 === 0) pixelText(ctx, 'TAP TO RUN', cx, cy + R * 0.56, R * 0.016, sk.text);
        g.draw.text('tap / space = jump  ·  swipe down = duck', cx, cy + R * 0.68, R * 0.036, { color: sk.dim, weight: 600, font: THEME.font });
      }

      // score: best + current in the pixel font, blinking on every 100
      const blinking = now - flashT < 0.9;
      const shown = blinking ? milestone * 100 : Math.floor(score);
      const ty = cy - R * 0.66;
      if (best > 0) pixelText(ctx, `HI ${String(Math.floor(best)).padStart(5, '0')}`, cx - R * 0.2, ty, R * 0.011, sk.dim);
      if (!blinking || Math.floor((now - flashT) / 0.15) % 2 === 0) {
        pixelText(ctx, String(shown).padStart(5, '0'), best > 0 ? cx + R * 0.2 : cx, ty, R * 0.015, sk.text);
      }

      g.draw.particles(dt);
      g.draw.floaters(dt);
    });
    return {};
  },
};
