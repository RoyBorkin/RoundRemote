// Chrono Ring — notes are born at the centre of the round screen and fly out to the judgement ring near the
// rim; tap the ring where each one lands, right as it arrives. Holds are long arcs you keep pressed, slides
// are chains of dots you follow with your finger along the ring (Hard+), flicks are swiped outward (Master).
// The song's art pulses in the middle with the beat, with the score, the combo and a thin health / progress
// ring around it. Layout of the notes on the ring: rhythm/chrono-map.js. Runtime (learning, judging, results):
// rhythm/kit.js.
import { rhythmGame, DIFF_OPTION, judgeColor } from './kit.js';
import { THEME, TAU, clamp, ease } from '../games/kit.js';
import { layoutRing, RING, dDeg } from './chrono-map.js';

const PI = Math.PI;
const DEG = PI / 180;
/** Angular half-width of a note's arc per difficulty (°). */
const HALF = [14, 12, 10.5, 8.5, 8];
/** Ring geometry (× R). */
const RING_R = 0.82, BIRTH_R = 0.275, DISC_R = 0.19, BAND_IN = 0.5, BAND_OUT = 1.1;

export default {
  howTo: 'Notes fly out from the centre: tap the ring where each one lands, on the beat. Hold long arcs, drag along dot chains (Hard+), flick arrows outward (Master). Keys or knob: ←/→ turn the cursor, Space hits.',
  modes: [{ id: 'play', name: 'Play', options: [DIFF_OPTION] }],
  keyRepeat: false,
  hud: false,
  create(g) {
    const R = rhythmGame(g, {
      game: 'chrono', lanes: 6, holds: true, chords: true, leadMs: 2600,
      rim: false, hud: false, comboHud: false,
      // judgement text inside the ring, next to the hit (alternating rows so quick runs don't pile up);
      // slide dots only say something when they're missed — their sparks are enough
      // and in fast runs the same word is shown at most every 150 ms
      popupAt: (n) => {
        const t = performance.now();
        if ((n.kind === 'chain' && n.judged !== 'miss') || (n.judged === lastPop.label && t - lastPop.t < 150)) return [-9999, -9999];
        lastPop.label = n.judged; lastPop.t = t;
        return polar(n.a ?? 0, g.R * (0.66 - 0.075 * (popRow ^= 1)));
      },
    });
    let popRow = 0;
    const lastPop = { label: '', t: 0 };
    const D = R.difficulty, C = RING[D];
    const T = C.travel;                 // look-ahead ms: centre → ring
    const HW = HALF[D] * DEG;
    const TOL = C.tol;                  // ° either side of a note that still counts
    const CHAIN_TOL = Math.max(TOL, 24);
    const cont = C.n === 0;
    const curSteps = cont ? 24 : C.n;
    const curDeg = (i) => (cont ? i * 15 : C.off + i * (360 / C.n)) % 360;
    // Easy uses the top position: the pause button moves to the gap at 1:30
    if (D === 0) g.pauseAt(Math.SQRT1_2 * 0.876, -Math.SQRT1_2 * 0.876);

    let N = [], maxDur = 0, beats = [], downs = new Set(), bi = 0;
    let art = null, artImg = null, artKey = '';
    let stat = null, statKey = '';
    let beatP = 0, downP = 0, ringFlash = 0, comboPop = 0, lastCombo = 0, scoreShown = 0;
    let cursor = 0, cursorT = 0, kbShow = false, kbHold = null, kbDown = false;
    const ptrs = new Map();             // pointer id → { a, r, hold, fr, ft, flicked }
    const live = new Set();             // holds being held
    const flashes = [];                 // ring flashes { a, t, col, w }
    const sparks = [];                  // pooled particles
    for (let i = 0; i < 160; i++) sparks.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0, col: '#fff', s: 1 });

    function polar(a, r) { return [g.cx + Math.sin(a) * r, g.cy - Math.cos(a) * r]; }
    const pal = () => (THEME.light
      ? { tap: '#8a4dff', hold: '#0c9a8f', chain: '#cf8500', flick: '#e2337d' }
      : { tap: g.color, hold: '#2ee6d6', chain: '#ffc857', flick: '#ff5fa2' });

    // ---------------------------------------------------------------- chart → ring
    R.onReady((chart) => {
      layoutRing(chart.notes, { difficulty: D, seed: R.version?.seed || 1, bpm: chart.bpm });
      N = chart.notes;
      maxDur = N.reduce((m, n) => Math.max(m, n.dur || 0), 0);
      beats = chart.beats || [];
      downs = new Set(R.analysis?.downbeats || []);
      // start the keyboard cursor where the first note lands
      if (N.length) cursor = nearestCursor(N[0].deg);
      loadArt();
    });
    function nearestCursor(deg) {
      let best = 0, bd = 999;
      for (let i = 0; i < curSteps; i++) { const d = Math.abs(dDeg(curDeg(i), deg)); if (d < bd) { bd = d; best = i; } }
      return best;
    }
    function loadArt() {
      const src = R.song?.track?.art;
      if (!src) return;
      const img = new Image();
      img.onload = () => { artImg = img; artKey = ''; };
      img.src = src;
    }

    // ---------------------------------------------------------------- pre-rendered layers
    function buildArt() {
      const key = `${g.S}|${g.dpr}|${!!artImg}|${THEME.light}|${g.color}`;
      if (key === artKey && art) return;
      artKey = key;
      const r = g.R * DISC_R, px = Math.ceil(r * 2 * g.dpr);
      art ||= document.createElement('canvas');
      art.width = art.height = Math.max(2, px);
      const c = art.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, px, px);
      c.save();
      c.beginPath(); c.arc(px / 2, px / 2, px / 2, 0, TAU); c.clip();
      if (artImg) {
        const s = Math.max(px / artImg.width, px / artImg.height) * 1.25;   // a little zoomed: text at the art's edge stays out
        c.drawImage(artImg, (px - artImg.width * s) / 2, (px - artImg.height * s) / 2, artImg.width * s, artImg.height * s);
      } else {
        c.fillStyle = g.color; c.fillRect(0, 0, px, px);
        c.fillStyle = 'rgba(255,255,255,.85)'; c.font = `700 ${px * 0.42}px ${THEME.display}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('♪', px / 2, px / 2);
      }
      c.restore();
    }
    function buildStatic() {
      const key = `${g.S}|${g.dpr}|${THEME.id}|${THEME.mode}|${THEME.light}`;
      if (key === statKey && stat) return;
      statKey = key;
      stat ||= document.createElement('canvas');
      stat.width = stat.height = Math.max(2, Math.round(g.S * g.dpr));
      const c = stat.getContext('2d');
      c.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      c.clearRect(0, 0, g.S, g.S);
      const { cx, cy } = g, r = g.R, rr = r * RING_R;
      c.lineCap = 'round';
      // guides from the centre to each landing spot
      if (!cont) {
        c.strokeStyle = THEME.ink(0.05); c.lineWidth = Math.max(1, r * 0.004);
        c.beginPath();
        for (let i = 0; i < C.n; i++) {
          const a = curDeg(i) * DEG;
          c.moveTo(cx + Math.sin(a) * r * BIRTH_R, cy - Math.cos(a) * r * BIRTH_R);
          c.lineTo(cx + Math.sin(a) * rr, cy - Math.cos(a) * rr);
        }
        c.stroke();
      }
      // the judgement ring
      c.strokeStyle = THEME.ink(0.2); c.lineWidth = Math.max(1.5, r * 0.007);
      c.beginPath(); c.arc(cx, cy, rr, 0, TAU); c.stroke();
      // landing pads (soft) on the ring
      c.strokeStyle = THEME.ink(THEME.light ? 0.1 : 0.08); c.lineWidth = r * 0.05;
      if (!cont) {
        for (let i = 0; i < C.n; i++) { const a = curDeg(i) * DEG; c.beginPath(); c.arc(cx, cy, rr, a - HW - PI / 2, a + HW - PI / 2); c.stroke(); }
      } else {
        c.strokeStyle = THEME.ink(0.22); c.lineWidth = Math.max(1, r * 0.006);
        c.beginPath();
        for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU; c.moveTo(cx + Math.sin(a) * (rr - r * 0.012), cy - Math.cos(a) * (rr - r * 0.012)); c.lineTo(cx + Math.sin(a) * (rr + r * 0.012), cy - Math.cos(a) * (rr + r * 0.012)); }
        c.stroke();
      }
      // the inner edge of the ring band
      c.strokeStyle = THEME.ink(0.06); c.lineWidth = Math.max(1, r * 0.004);
      c.beginPath(); c.arc(cx, cy, r * (RING_R - 0.06), 0, TAU); c.stroke();
      // rim ticks (they pulse with the beat on top of this)
      ticks(c, THEME.ink(0.13), THEME.ink(0.22), 0);
    }
    /** 60 rim ticks (every 5th a long one) as two paths. */
    function ticks(c, minor, major, ext) {
      const { cx, cy } = g, r = g.R;
      const r0 = r * 0.872, l1 = r * (0.018 + ext * 0.022), l2 = r * (0.032 + ext * 0.03);
      c.lineCap = 'round';
      c.lineWidth = Math.max(1, r * 0.0055);
      for (const big of [false, true]) {
        c.strokeStyle = big ? major : minor;
        c.beginPath();
        for (let i = 0; i < 60; i++) {
          if ((i % 5 === 0) !== big) continue;
          const a = (i / 60) * TAU, s = Math.sin(a), co = Math.cos(a), l = big ? l2 : l1;
          c.moveTo(cx + s * r0, cy - co * r0); c.lineTo(cx + s * (r0 + l), cy - co * (r0 + l));
        }
        c.stroke();
      }
    }

    // ---------------------------------------------------------------- effects
    function spark(x, y, a, col, n, speed) {
      let k = 0;
      for (const p of sparks) {
        if (p.on) continue;
        const d = a + (Math.random() - 0.5) * 1.6, v = speed * (0.35 + Math.random() * 0.75);
        Object.assign(p, { on: true, x, y, vx: Math.sin(d) * v, vy: -Math.cos(d) * v, t: 0, life: 0.3 + Math.random() * 0.35, col, s: g.R * (0.006 + Math.random() * 0.008) });
        if (++k >= n) break;
      }
    }
    function flash(a, col, w = 1) { flashes.push({ a, t: 0, col, w }); if (flashes.length > 14) flashes.shift(); }
    function hitFx(n, label) {
      const col = judgeColor(label);
      const [x, y] = polar(n.a, g.R * RING_R);
      if (label === 'miss') { flash(n.a, THEME.danger, 0.7); return; }
      const big = label === 'perfect';
      flash(n.a, n.kind === 'chain' ? pal().chain : col, n.kind === 'chain' ? 0.6 : 1);
      spark(x, y, n.a, col, n.kind === 'chain' ? 4 : big ? 12 : 8, g.R * (big ? 0.95 : 0.7));
      if (big) ringFlash = Math.max(ringFlash, n.kind === 'chain' ? 0.35 : 0.7);
      if (n.kind !== 'chain') g.sfx(n.kind === 'flick' ? 'whoosh' : 'tap', { volume: 0.45, pitch: big ? 1.15 : 1 });
    }

    // ---------------------------------------------------------------- judging
    const W = () => R.windows;
    function firstIdx(t) { let lo = 0, hi = N.length; while (lo < hi) { const m = (lo + hi) >> 1; if (N[m].t < t) lo = m + 1; else hi = m; } return lo; }
    /** The best unjudged note of the given kinds near angle a (rad) at time t. */
    function best(a, t, kinds, tolMul = 1) {
      const good = W().good, deg = a / DEG;
      let pick = null, ps = Infinity;
      for (let i = firstIdx(t - good); i < N.length && N[i].t <= t + good; i++) {
        const n = N[i];
        if (n.done || !kinds(n)) continue;
        const da = Math.abs(dDeg(n.deg, deg));
        if (da > TOL * tolMul) continue;
        const s = Math.abs(t - n.t) + da * 1.5;
        if (s < ps) { ps = s; pick = n; }
      }
      return pick;
    }
    const tappable = (n) => n.kind === 'tap' || n.kind === 'hold' || (n.kind === 'chain' && n.head);
    const flickable = (n) => n.kind === 'flick';
    function hit(n, t, owner) {
      const label = R.hit(n, t);
      if (!label) return null;
      hitFx(n, label);
      if (label !== 'miss' && n.kind === 'hold' && n.holding) { live.add(n); if (owner) owner.hold = n; }
      return label;
    }
    function letGo(n, t) {
      if (!n?.holding) return;
      const l = R.release(n, t);
      if (l === 'miss') { R.popup('miss', ...polar(n.a, g.R * 0.645)); flash(n.a, THEME.danger, 0.7); }
      else if (l) holdDone(n);
      live.delete(n);
    }
    function holdDone(n) {
      const [x, y] = polar(n.a, g.R * RING_R);
      spark(x, y, n.a, pal().hold, 14, g.R * 0.9);
      flash(n.a, pal().hold, 1.2);
      ringFlash = Math.max(ringFlash, 0.6);
      g.sfx('pop', { volume: 0.4 });
    }

    /**
     * Slide dots count when a finger (or the key cursor) is on them as they reach the ring. A pointer that has
     * not moved since time mt was there from mt on, so the dot is judged at max(its time, mt) — exact, whatever
     * the frame rate.
     */
    function followChains(now) {
      // (looks back further than the window: after a long frame a dot the finger was on still counts)
      for (let i = firstIdx(now - 1000); i < N.length && N[i].t <= now; i++) {
        const n = N[i];
        if (n.done || n.kind !== 'chain') continue;
        let at = Infinity;
        if (kbShow && Math.abs(dDeg(n.deg, curDeg(cursor))) <= CHAIN_TOL) at = Math.max(n.t, cursorT);
        for (const p of ptrs.values()) if (inBand(p.r) && Math.abs(dDeg(n.deg, p.a / DEG)) <= CHAIN_TOL) at = Math.min(at, Math.max(n.t, p.mt));
        if (at <= now) hit(n, at, null);
      }
    }

    // ---------------------------------------------------------------- input: touch / mouse
    const inBand = (r) => r >= BAND_IN && r <= BAND_OUT;
    g.on('down', (e) => {
      const now = R.now();
      const p = { a: e.a, r: e.r, hold: null, fr: e.r, ft: now, flicked: false, mt: now };
      ptrs.set(e.id, p);
      if (!inBand(e.r)) return;
      const n = best(e.a, now, tappable);
      if (n) hit(n, now, p);
      else if (!best(e.a, now, flickable, 1.3)) flash(e.a, THEME.ink(0.35), 0.5);   // (a flick starts with a touch)
      followChains(now);
    });
    g.on('move', (e) => {
      const p = ptrs.get(e.id);
      if (!p) return;
      const now = R.now();
      followChains(now);                                  // it was where it was until now
      p.a = e.a; p.r = e.r; p.mt = now;
      if (p.hold && !p.hold.holding) p.hold = null;
      if (p.hold && (Math.abs(dDeg(p.hold.deg, e.a / DEG)) > TOL * 1.8 || e.r < BAND_IN - 0.1)) { letGo(p.hold, now); p.hold = null; }
      tryFlick(p, now);
      followChains(now);
    });
    g.on('up', (e) => {
      const p = ptrs.get(e.id);
      if (!p) return;
      const now = R.now();
      followChains(now);
      ptrs.delete(e.id);
      p.a = e.a; p.r = e.r;
      tryFlick(p, now);
      if (p.hold) letGo(p.hold, now);
    });
    function tryFlick(p, now) {
      if (!cont) return;
      if (p.r < p.fr - 0.04) p.flicked = false;            // moved back in: ready for another flick
      if (now - p.ft > 240 || p.r < p.fr) { p.fr = p.r; p.ft = now; }
      if (p.flicked || p.r - p.fr < 0.06 || p.r < BAND_IN - 0.08) return;
      const n = best(p.a, now, flickable, 1.3);
      if (n) { p.flicked = true; hit(n, now); }
    }

    // ---------------------------------------------------------------- input: keyboard / rotary knob
    function turn(d) {
      if (kbShow) followChains(R.now());
      cursor = (cursor + d + curSteps) % curSteps;
      cursorT = R.now();
      kbShow = true;
      followChains(cursorT);
      if (kbHold?.holding && Math.abs(dDeg(kbHold.deg, curDeg(cursor))) > TOL * 1.8) { letGo(kbHold, R.now()); kbHold = null; }
    }
    g.on('wheel', (e) => turn(e.delta > 0 ? 1 : -1));
    g.on('key', (e) => {
      if (e.key === 'ArrowLeft') turn(-1);
      else if (e.key === 'ArrowRight') turn(1);
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') {
        kbShow = true;
        const now = R.now(), a = curDeg(cursor) * DEG;
        if (e.key !== 'ArrowUp') kbDown = true;
        const n = best(a, now, e.key === 'ArrowUp' ? flickable : (m) => tappable(m) || flickable(m));
        if (!n) { flash(a, THEME.ink(0.35), 0.5); return; }
        const o = { hold: null };
        const label = hit(n, now, o);
        if (o.hold) kbHold = o.hold;
        // one cursor can't reach both sides: a double counts both of its notes from the keys
        if (label && n.pair && !n.pair.done) hit(n.pair, now, null);
      }
    });
    g.on('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { kbDown = false; if (kbHold) { letGo(kbHold, R.now()); kbHold = null; } }
    });

    // ---------------------------------------------------------------- frame
    g.loop((dt) => {
      // slides first, so the kit's miss sweep (in drawPre) never beats a finger that was already there
      if (R.state === 'play' || R.state === 'count') followChains(R.now());
      if (!R.drawPre(dt)) return;
      const { ctx, cx, cy } = g, r = g.R;
      const now = R.now();
      const P = pal();
      const rr = r * RING_R, rb = r * BIRTH_R;

      for (const n of live) if (!n.holding) { live.delete(n); if (n.held) holdDone(n); }
      if (beats.length) {
        if (bi >= beats.length || beats[bi] > now) { bi = 0; let lo = 0, hi = beats.length; while (lo < hi) { const m = (lo + hi) >> 1; if (beats[m] <= now) lo = m + 1; else hi = m; } bi = Math.max(0, lo - 1); }
        while (bi + 1 < beats.length && beats[bi + 1] <= now) bi++;
        const since = now - beats[bi];
        beatP = since >= 0 ? Math.exp(-since / 120) : 0;
        downP = downs.has(bi) ? beatP : 0;
      }
      if (R.combo !== lastCombo) { if (R.combo > lastCombo) comboPop = 1; lastCombo = R.combo; }
      comboPop = Math.max(0, comboPop - dt * 5);
      ringFlash = Math.max(0, ringFlash - dt * 3);
      scoreShown += (R.score - scoreShown) * Math.min(1, dt * 14);
      if (Math.abs(R.score - scoreShown) < 1) scoreShown = R.score;

      // ---- scene
      g.draw.bg({ glow: 0.13 + 0.05 * beatP });
      buildStatic();
      ctx.drawImage(stat, 0, 0, g.S, g.S);
      if (beatP > 0.04) ticks(ctx, g.draw.alpha(g.color, 0.55 * beatP), g.draw.alpha(g.color, 0.8 * Math.max(beatP * 0.7, downP)), beatP * (0.6 + 0.4 * downP));
      // ring flash on perfects
      if (ringFlash > 0.01) g.draw.arc(cx, cy, rr, 0, TAU, g.draw.alpha(g.color, 0.5 * ringFlash), r * (0.008 + 0.01 * ringFlash), { glow: r * 0.04 * ringFlash });
      drawCentre(now);
      drawNotes(now, P, rr, rb);
      // ring flashes
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]; f.t += dt;
        if (f.t > 0.32) { flashes.splice(i, 1); continue; }
        const k = f.t / 0.32, w = HW * (1.1 + 0.6 * k) * f.w;
        ctx.globalAlpha = (1 - k) * (1 - k);
        g.draw.arc(cx, cy, rr, f.a - w, f.a + w, f.col, r * (0.05 - 0.035 * k) * Math.min(1, f.w), { glow: f.w >= 1 ? r * 0.05 : 0 });
        ctx.globalAlpha = 1;
      }
      // sparks
      for (const p of sparks) {
        if (!p.on) continue;
        p.t += dt;
        if (p.t > p.life) { p.on = false; continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93;
        ctx.globalAlpha = 1 - p.t / p.life;
        ctx.fillStyle = p.col;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 - 0.5 * p.t / p.life), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // keyboard / knob cursor
      if (kbShow) {
        const a = curDeg(cursor) * DEG;
        g.draw.arc(cx, cy, rr, a - HW, a + HW, THEME.ink(kbDown ? 0.75 : 0.45), r * 0.016);
        const [tx, ty] = polar(a, r * 0.905), [lx, ly] = polar(a - 0.035, r * 0.94), [qx, qy] = polar(a + 0.035, r * 0.94);
        ctx.fillStyle = THEME.ink(0.85);
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(lx, ly); ctx.lineTo(qx, qy); ctx.closePath(); ctx.fill();
      }
    });

    function drawCentre(now) {
      const { ctx, cx, cy } = g, r = g.R;
      buildArt();
      const pulse = 1 + 0.035 * beatP + 0.03 * downP;
      const ar = r * DISC_R * pulse;
      ctx.drawImage(art, cx - ar, cy - ar, ar * 2, ar * 2);
      g.draw.circle(cx, cy, ar, THEME.paper(R.state === 'count' ? 0.2 : 0.42), { stroke: THEME.ink(0.22), lw: Math.max(1, r * 0.005) });
      // health (left half, filling up from the bottom) and song progress (right half, from the top)
      const gr = r * (DISC_R + 0.04), w = Math.max(2, r * 0.011), gap = 5 * DEG;
      g.draw.arc(cx, cy, gr, gap, PI - gap, THEME.ink(0.1), w);
      g.draw.arc(cx, cy, gr, PI + gap, TAU - gap, THEME.ink(0.1), w);
      if (R.progress > 0.003) g.draw.arc(cx, cy, gr, gap, gap + (PI - 2 * gap) * R.progress, THEME.ink(0.6), w);
      const hp = R.health, hcol = hp > 0.5 ? THEME.ok : hp > 0.25 ? THEME.warn : THEME.danger;
      if (hp > 0.003) g.draw.arc(cx, cy, gr, PI + gap, PI + gap + (PI - 2 * gap) * hp, hcol, w);
      if (R.state === 'count') return;     // the kit draws the count-in here
      // score, combo
      g.draw.text(Math.round(scoreShown).toLocaleString(), cx, cy - r * 0.085, r * 0.046, { color: THEME.fg, weight: 700 });
      if (R.combo >= 2) {
        const s = 1 + 0.22 * ease.out(comboPop);
        g.draw.text(String(R.combo), cx, cy + r * 0.012, r * 0.1 * s, { color: THEME.fg, weight: 700, glow: r * 0.03 });
        g.draw.text(R.multiplier > 1 ? `COMBO ×${R.multiplier}` : 'COMBO', cx, cy + r * 0.09, r * 0.03, { color: THEME.muted, weight: 800, font: THEME.font });
      } else {
        g.draw.text(R.diffName.toUpperCase(), cx, cy + r * 0.03, r * 0.034, { color: THEME.muted, weight: 800, font: THEME.font });
      }
    }

    function drawNotes(now, P, rr, rb) {
      const { ctx, cx, cy } = g, r = g.R;
      const span = rr - rb;
      const radAt = (t) => rb + span * (1 - (t - now) / T);
      const lo = firstIdx(now - maxDur - 500);
      let hi = lo;
      while (hi < N.length && N[hi].t <= now + T) hi++;
      ctx.lineCap = 'round';
      // pass 1: hold bodies and slide links (under the heads)
      for (let i = lo; i < hi; i++) {
        const n = N[i];
        if (n.kind === 'hold') {
          if (n.done && !n.holding && !n.dropped && n.judged !== 'miss') continue;
          const end = n.t + n.dur;
          if (end < now - 200) continue;
          const rh = n.holding ? rr : Math.min(radAt(n.t), rr + r * 0.1);
          const rt = clamp(radAt(end), rb, rr);
          if (rt >= rh) continue;
          const dim = n.dropped || n.judged === 'miss';
          const fa = clamp((rt - rb) / span, 0, 1);
          ctx.fillStyle = dim ? THEME.ink(0.12) : g.draw.alpha(P.hold, n.holding ? 0.55 + 0.2 * beatP : 0.32);
          const hw = HW * 0.78;
          ctx.beginPath();
          ctx.arc(cx, cy, rh, n.a - hw - PI / 2, n.a + hw - PI / 2);
          ctx.arc(cx, cy, Math.max(rb, rt), n.a + hw - PI / 2, n.a - hw - PI / 2, true);
          ctx.closePath(); ctx.fill();
          // tail cap
          if (!dim) g.draw.arc(cx, cy, Math.max(rb, rt), n.a - hw, n.a + hw, g.draw.alpha(P.hold, 0.9), r * (0.008 + 0.01 * fa));
          if (n.holding) {
            g.draw.arc(cx, cy, rr, n.a - HW * 1.15, n.a + HW * 1.15, P.hold, r * 0.05, { glow: r * 0.06 });
            if (Math.random() < 0.35) { const [x, y] = polar(n.a + (Math.random() - 0.5) * HW * 2, rr); spark(x, y, n.a, P.hold, 1, r * 0.5); }
          }
        } else if (n.kind === 'chain' && n.next && !n.next.done) {
          const m = n.next;
          if (m.t - now > T) continue;
          const [x0, y0] = n.done ? polar(n.a, rr) : polar(n.a, Math.max(rb, radAt(n.t)));
          const [x1, y1] = polar(m.a, Math.max(rb, radAt(m.t)));
          ctx.strokeStyle = g.draw.alpha(P.chain, 0.45);
          ctx.lineWidth = r * 0.009;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
      }
      // pass 2: heads, latest first so the next note to hit sits on top
      for (let i = hi - 1; i >= lo; i--) {
        const n = N[i];
        const dtn = n.t - now;
        if (n.done) {
          // a miss carries on outward and fades
          if (n.judged === 'miss' && n.kind !== 'hold' && dtn > -300) {
            const k = -dtn / 300, rad = radAt(n.t);
            ctx.globalAlpha = Math.max(0, 0.6 * (1 - k));
            if (n.kind === 'chain') g.draw.ball(...polar(n.a, rad), r * 0.02, THEME.danger);
            else g.draw.arc(cx, cy, rad, n.a - HW, n.a + HW, THEME.danger, r * 0.03);
            ctx.globalAlpha = 1;
          }
          continue;
        }
        if (n.kind === 'hold' && n.holding) continue;
        const f = 1 - dtn / T;
        if (f < 0) continue;
        const rad = rb + span * f;
        const fade = clamp(f / 0.12, 0, 1);
        const k = clamp(f, 0, 1.1);
        const w = r * (0.016 + 0.03 * k);
        ctx.globalAlpha = fade;
        if (n.kind === 'chain') {
          const s = r * (n.head ? 0.012 + 0.022 * k : 0.008 + 0.014 * k);
          const [x, y] = polar(n.a, rad);
          if (n.head) g.draw.circle(x, y, s * 1.45, null, { stroke: P.chain, lw: Math.max(1.5, r * 0.007) });
          g.draw.ball(x, y, s, P.chain);
        } else {
          const col = n.kind === 'hold' ? P.hold : n.kind === 'flick' ? P.flick : P.tap;
          if (n.pair) g.draw.arc(cx, cy, rad, n.a - HW - 0.01, n.a + HW + 0.01, THEME.fg, w + r * 0.014);
          g.draw.arc(cx, cy, rad, n.a - HW, n.a + HW, col, w);
          if (n.kind === 'flick') {
            // an arrowhead pointing outward
            const r0 = rad + w * 0.75, r1 = r0 + r * (0.012 + 0.032 * k), da = HW * 0.42;
            const [ax, ay] = polar(n.a - da, r0), [bx, by] = polar(n.a, r1), [qx, qy] = polar(n.a + da, r0);
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(qx, qy); ctx.closePath(); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
    }

    // ---------------------------------------------------------------- shell hooks
    return {
      destroy() { R.handle.destroy(); },
      pause() {
        // fingers lift while the pause card is up: let go of any hold now
        const now = R.now();
        for (const p of ptrs.values()) if (p.hold) letGo(p.hold, now);
        ptrs.clear();
        if (kbHold) { letGo(kbHold, now); kbHold = null; }
        kbDown = false;
        R.handle.pause();
      },
      resume() { R.handle.resume(); },
    };
  },
};
