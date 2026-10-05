// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Spin Beat — a round take on spinning-wheel DJ rhythm games.
// A turntable fills the lower half of the round screen; its rim is split into two colours (amber / blue).
// Notes race down a curving track to the catch point on top of the wheel. Turn the wheel so the colour at the
// top matches each note as it lands:
//   match  small pills — just be on the right colour when they land (no tap)
//   tap    wide outlined bars — tap anywhere (or Space) as they land, on the right colour
//   hold   bars with a trail — tap, keep holding (finger / Space) and keep the colour until the trail ends
//   beat   full-width drum bars — hit the centre hub (or J)
//   spin   big chevron bars — spin the wheel a full turn in the arrow's direction (bonus)
// Wheel: drag around it (1:1, flicks keep spinning, it settles lightly on a colour), mouse wheel / rotary knob
// or ←/→ (60° a step, hold to keep turning), A / D flip the colour instantly (turning left / right).
import { rhythmGame, DIFF_OPTION } from './kit.js';
import { THEME, TAU, clamp, angDiff } from '../games/kit.js';
import { buildNotes } from './spin-chart.js';

const LEVELS = ['easy', 'medium', 'hard', 'expert', 'master'];
const LOOK = [1900, 1650, 1420, 1200, 1000];      // look-ahead (ms) = note speed
const STEP = Math.PI / 3;                         // one knob detent / arrow press
const SPIN_NEED = (300 / 180) * Math.PI;          // a "full" spin
const K = 2.6, S1 = 1 / (1 + K);                   // track perspective

const palette = () => (THEME.light
  ? { c: ['#e5650b', '#1f62de'], spin: '#079c8f', chev: '#ffffff' }
  : { c: ['#ff8a1f', '#3d8bff'], spin: '#2ee6d6', chev: '#06302c' });

export default {
  howTo: 'Turn the wheel so the colour on top matches each note as it lands. Tap outlined notes (Space), hold trails, hit the hub on drum bars (J) and spin on arrows. Drag the wheel, use the knob or ←/→; A / D flip it.',
  modes: [{ id: 'play', name: 'Play', options: [DIFF_OPTION] }],
  keyRepeat: false,
  create(g) {
    const lv = LEVELS.indexOf(g.opts?.level);
    const D0 = lv < 0 ? 1 : lv;
    const G = { wx: 0, wy: 0, rw: 0, rimW: 0, hubR: 0, yC: 0, yH: 0, w0: 0 };
    let popSide = 0, lastPop = 0;
    const R = rhythmGame(g, {
      game: 'spin', lanes: 4, holds: D0 >= 2, chords: false, leadMs: 2000, hud: false, comboHud: false,
      // match notes need no input: their catch flare is the feedback (only a miss gets a label); the other
      // judgements sit between rim and hub, nudged sideways when they come thick and fast
      popupAt: (n) => {
        if (n.type === 'match' && n.judged !== 'miss') return [-9999, -9999];
        const t = performance.now(), quick = t - lastPop < 320;
        lastPop = t; popSide = quick ? (popSide > 0 ? -1 : 1) : 0;
        return [g.cx + popSide * g.R * 0.18, G.wy - G.rw * 0.6];
      },
    });
    const D = R.difficulty;
    const LA = LOOK[D];

    // ------------------------------------------------------------ chart → Spin Beat notes
    R.onReady((chart) => { buildNotes(chart, D, R.analysis?.downbeats); });

    // ------------------------------------------------------------ the wheel (physics + colour)
    let theta = 0, omega = 0, target = 0, mode = 'free';   // mode: 'free' (momentum + snap) | 'drag' | 'step' (keys / knob)
    let colour = 0, lastInput = 0, arrowHeld = 0, arrowSince = 0, lastWheel = 0;
    let drag = null;
    const presses = new Set();
    const keysDown = new Set();
    let hist = [{ t: -1e12, c: 0 }];
    let pending = null;
    const holds = [], spins = [];
    let lastNow = -1e9;
    const perf = () => performance.now();
    const logical = () => (mode === 'step' ? target : theta);
    const centreOf = (phi, c) => (c === 0 ? Math.round(phi / TAU) * TAU : Math.round((phi - Math.PI) / TAU) * TAU + Math.PI);
    function changed(t) {
      const phi = logical();
      const c = Math.cos(phi) >= 0 ? 0 : 1;
      if (c !== colour) {
        colour = c; hist.push({ t, c }); if (hist.length > 48) hist.shift();
        fx.colour = 1;
        if (pending && pending.n.c === c && t <= pending.until && !pending.n.done) { const p = pending; pending = null; doHit(p.n, t); }
      }
      spinTrack(phi, t);
    }
    const colourAt = (t) => { for (let i = hist.length - 1; i >= 0; i--) if (hist[i].t <= t) return hist[i].c; return hist[0].c; };
    const switchTo = (c, t0, t1) => { for (const e of hist) if (e.t > t0 && e.t <= t1 && e.c === c) return e.t; return null; };

    function physics(dt, now) {
      if (mode === 'step') {
        if (arrowHeld && perf() - arrowSince > 170) { target += arrowHeld * 11 * dt; lastInput = perf(); changed(now); }
        else if (perf() - lastInput > 260) { const c0 = centreOf(target, colour); if (Math.abs(target - c0) > 1e-4) { target = c0; changed(now); } }
        theta += (target - theta) * (1 - Math.exp(-dt / 0.035));
      } else if (mode === 'free') {
        if (Math.abs(omega) > 5) { omega *= Math.exp(-3.2 * dt); theta += omega * dt; changed(now); }
        else {
          const c0 = centreOf(theta, colour), d = theta - c0;
          if (Math.abs(d) < 1e-3 && Math.abs(omega) < 0.02) { theta = c0; omega = 0; }
          else { omega += (-70 * d - 13 * omega) * dt; theta += omega * dt; changed(now); }
        }
      }
    }
    function flip(dir, t) {
      const base = mode === 'step' ? target : theta;
      if (drag) drag = null;
      target = centreOf(base, colour) + dir * Math.PI;
      mode = 'step'; omega = 0; lastInput = perf();
      changed(t);
    }
    function step(dir, t) {
      const base = mode === 'step' ? target : theta;
      if (drag) drag = null;
      target = base + dir * STEP;
      mode = 'step'; omega = 0; lastInput = perf();
      changed(t);
    }
    const angW = (p) => Math.atan2(p.x - G.wx, -(p.y - G.wy));
    const onHub = (p) => Math.hypot(p.x - G.wx, p.y - G.wy) <= G.hubR * 1.12;

    // ------------------------------------------------------------ judging
    const W = () => R.windows.good;
    function doHit(n, t) {
      const lab = R.hit(n, t);
      if (!lab) return null;
      n.fx = 1;
      if (lab !== 'miss') {
        if (n.type === 'hold') holds.push(n);
        flare(n.type === 'beat' ? null : n.c, lab === 'perfect', n.type);
        if (n.type === 'beat') { fx.hub = 1; g.sfx('hit', { volume: 0.5 }); }
        else if (n.type === 'tap' || n.type === 'hold') g.sfx('tick', { volume: 0.7 });
      } else fx.miss = 1;
      return lab;
    }
    function tapPress(t) {
      const w = W();
      let best = null;
      for (const n of R.window(t - w, t + w)) if (!n.done && (n.type === 'tap' || n.type === 'hold') && n.t >= t - w) { best = n; break; }
      if (!best) return false;
      if (best.c === colour) doHit(best, t);
      else pending = { n: best, until: t + 110 };   // the colour may land a hair later (keys pressed together)
      return true;
    }
    function beatPress(t) {
      fx.hubTap = 1;
      const w = W();
      for (const n of R.window(t - w, t + w)) if (!n.done && n.type === 'beat' && n.t >= t - w) { doHit(n, t); return; }
      tapPress(t);   // the hub works as a tap when no drum bar is due
    }
    function spinTrack(phi, t) {
      for (const n of spins) {
        const k = n.trk;
        if (n.spun) continue;
        const v = n.dir * phi;
        if (!k.started) {
          if (n.done) continue;
          if (v <= k.base + 0.05) { if (v < k.base) k.base = v; k.baseT = t; k.last = Math.max(0, v - k.base); continue; }
          const prog = v - k.base;
          if (prog >= 0.5) {
            const th = k.last < 0.06 && prog > 0.9 ? t : k.baseT;   // a jump (key / knob) starts now
            k.started = true;
            const lab = R.hit(n, Math.max(th, n.t - W()));
            n.fx = 1;
            if (lab && lab !== 'miss') g.sfx('whoosh', { volume: 0.7 });
          }
          k.last = prog;
        } else if (n.holding) {
          k.prog = v - k.base;
          if (k.prog >= SPIN_NEED) {
            n.spun = true;
            const bonus = 250 * R.multiplier;
            R.score += bonus; g.score(R.score);
            R.popup('SPIN!', g.cx, G.wy - G.rw * 0.6 - g.R * 0.075, palette().spin);
            flare(null, true, 'spin');
            fx.spin = 1;
            g.sfx('score', { volume: 0.6 });
          }
        }
      }
    }
    function judgePass(now) {
      const w = W();
      if (now < lastNow - 400) { hist = [{ t: -1e12, c: colour }]; pending = null; lastNow = now; }   // the song jumped back (resume)
      const from = Math.min(now, lastNow) - w - 40;   // a slow frame must not let notes slip past unjudged
      lastNow = now;
      if (pending && (now > pending.until || pending.n.done)) pending = null;
      // match notes: be on the colour when they land (a late switch still counts, judged by its time)
      for (const n of R.window(from, now + 1)) {
        if (n.done || n.type !== 'match' || n.t > now) continue;
        if (colourAt(n.t) === n.c) doHit(n, n.t);
        else { const ts = switchTo(n.c, n.t, now); if (ts != null && ts - n.t <= w) doHit(n, ts); }
      }
      // holds: keep pressing (Hard+) and keep the colour
      const pressed = presses.size > 0 || keysDown.size > 0;
      for (let i = holds.length - 1; i >= 0; i--) {
        const n = holds[i];
        if (!n.holding) { holds.splice(i, 1); if (n.held) flare(n.c, true, 'held'); continue; }
        const ok = pressed && colour === n.c;
        if (ok) { n.bad = null; if (Math.random() < 0.5) spark(n.c); continue; }
        if (n.bad == null) n.bad = now;
        if (now - n.bad > (pressed ? 140 : 110)) {
          holds.splice(i, 1);
          if (R.release(n, n.bad) === 'miss') { R.popup('DROP', g.cx, G.wy - G.rw * 0.6 - g.R * 0.075, THEME.danger); fx.miss = 1; }
          else flare(n.c, true, 'held');
        }
      }
      // spins: track from the moment their window opens
      for (const n of R.window(now - w, now + w)) {
        if (n.type === 'spin' && !n.trk && !n.done && now >= n.t - w) { const v = n.dir * logical(); n.trk = { base: v, baseT: now, started: false, last: 0, prog: 0 }; spins.push(n); }
      }
      for (let i = spins.length - 1; i >= 0; i--) {
        const n = spins[i], k = n.trk;
        if (n.spun) { if (!n.holding) spins.splice(i, 1); continue; }
        if (n.done && !k.started) { spins.splice(i, 1); continue; }   // never started: missed by the kit
        if (k.started && n.holding && now >= n.t + n.dur - w - 30) {
          spins.splice(i, 1);
          R.release(n, Math.min(now, n.t + n.dur - w - 1));
          R.popup('TOO SLOW', g.cx, G.wy - G.rw * 0.6 - g.R * 0.075, THEME.danger); fx.miss = 1;
        } else if (k.started && !n.holding) spins.splice(i, 1);
      }
      spinTrack(logical(), now);
    }

    // ------------------------------------------------------------ input
    g.on('down', (p) => {
      const t = R.now();
      presses.add(p.id);
      if (onHub(p)) { beatPress(t); return; }
      tapPress(t);
      if (!drag) {
        if (mode === 'step') theta = target;
        omega = 0; mode = 'drag';
        drag = { id: p.id, a: angW(p), s: [{ t: perf(), th: theta }] };
        changed(t);
      }
    });
    g.on('move', (p) => {
      if (!drag || p.id !== drag.id) return;
      if (Math.hypot(p.x - G.wx, p.y - G.wy) < G.hubR * 0.5) { drag.a = angW(p); return; }   // too close to the axle: jumpy
      const a = angW(p);
      theta += angDiff(drag.a, a);
      drag.a = a;
      drag.s.push({ t: perf(), th: theta }); if (drag.s.length > 8) drag.s.shift();
      changed(R.now());
    });
    g.on('up', (p) => {
      presses.delete(p.id);
      if (!drag || p.id !== drag.id) return;
      const tn = perf();
      let w = 0;
      const s = drag.s, lastS = s[s.length - 1];
      if (tn - lastS.t < 60) {
        let ref = s[0];
        for (const e of s) if (tn - e.t >= 25) ref = e;
        const dt = (lastS.t - ref.t) / 1000;
        if (dt > 0.008) w = (lastS.th - ref.th) / dt;
      }
      omega = Math.abs(w) < 6 ? 0 : clamp(w, -45, 45);
      drag = null; mode = 'free';
    });
    g.on('key', (e) => {
      const t = R.now(), k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === ' ' || k === 'Enter') { keysDown.add(k); tapPress(t); }
      else if (k === 'j') { keysDown.add(k); beatPress(t); }
      else if (k === 'a') flip(-1, t);
      else if (k === 'd') flip(1, t);
      else if (k === 'ArrowUp') flip(1, t);
      else if (k === 'ArrowDown') flip(-1, t);
      else if (k === 'ArrowLeft' || k === 'ArrowRight') { const dir = k === 'ArrowLeft' ? -1 : 1; step(dir, t); arrowHeld = dir; arrowSince = perf(); }
    });
    g.on('keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keysDown.delete(k);
      if ((k === 'ArrowLeft' && arrowHeld < 0) || (k === 'ArrowRight' && arrowHeld > 0)) arrowHeld = 0;
    });
    g.on('wheel', (e) => {
      const tn = perf();
      if (tn - lastWheel < 35 || !e.delta) return;   // trackpads send a flood
      lastWheel = tn;
      step(e.delta > 0 ? 1 : -1, R.now());
    });

    // ------------------------------------------------------------ effects
    const fx = { colour: 0, hub: 0, hubTap: 0, miss: 0, spin: 0 };
    const flares = Array.from({ length: 6 }, () => ({ on: false, t: 0, col: '', big: false }));
    const flames = Array.from({ length: 90 }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, size: 1, c: 0 }));
    function flare(c, big, kind) {
      const P = palette();
      const col = kind === 'spin' ? P.spin : c == null || c < 0 ? THEME.fg : P.c[c];
      let f = flares[0];
      for (const x of flares) { if (!x.on) { f = x; break; } if (x.t > f.t) f = x; }
      f.on = true; f.t = 0; f.col = col; f.big = big;
      g.draw.burst(g.cx, G.yC, col, big ? 12 : 7, g.R * (big ? 0.55 : 0.4), g.R * 0.011);
    }
    function flame(x, y, vx, vy, life, size, c) {
      for (const f of flames) if (!f.on) { f.on = true; f.x = x; f.y = y; f.vx = vx; f.vy = vy; f.t = 0; f.life = life; f.size = size; f.c = c; return; }
    }
    function spark(c) {
      const r = g.R;
      flame(g.cx + (Math.random() - 0.5) * G.w0 * 1.2, G.yC, (Math.random() - 0.5) * r * 0.4, -r * (0.3 + Math.random() * 0.5), 0.25 + Math.random() * 0.2, r * 0.012, c);
    }

    // ------------------------------------------------------------ drawing
    let platter = null, platterKey = '';
    function layout() {
      const r = g.R;
      G.wx = g.cx; G.wy = g.cy + r * 0.4; G.rw = r * 0.44; G.rimW = r * 0.085; G.hubR = r * 0.155;
      G.yC = G.wy - G.rw - G.rimW / 2 - r * 0.03; G.yH = g.cy - r * 0.73; G.w0 = r * 0.215;
    }
    function buildPlatter() {
      const key = `${THEME.id}|${THEME.mode}|${THEME.light}|${g.R}|${g.dpr}`;
      if (key === platterKey && platter) return;
      platterKey = key;
      const rad = G.rw - G.rimW / 2, dpr = g.dpr || 1;
      const size = Math.ceil(rad * 2 * dpr) + 2;
      const cv = platter || document.createElement('canvas');
      cv.width = cv.height = size;
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, size, size);
      const o = size / 2 / dpr;
      c.beginPath(); c.arc(o, o, rad, 0, TAU); c.fillStyle = THEME.light ? THEME.ink(0.07) : THEME.ink(0.05); c.fill();
      // two faint sheen sectors (they turn with the platter, so you see it spin)
      c.fillStyle = THEME.ink(THEME.light ? 0.035 : 0.03);
      for (const a of [0.35, 0.35 + Math.PI]) { c.beginPath(); c.moveTo(o, o); c.arc(o, o, rad, a, a + 0.55); c.closePath(); c.fill(); }
      // grooves
      c.lineWidth = 1;
      for (let i = 0, rr = G.hubR * 1.3; rr < rad * 0.93; rr += rad * 0.045, i++) {
        c.strokeStyle = THEME.ink(i % 2 ? 0.05 : 0.085); c.beginPath(); c.arc(o, o, rr, 0, TAU); c.stroke();
      }
      // strobe ticks near the edge
      c.strokeStyle = THEME.ink(THEME.light ? 0.3 : 0.22); c.lineWidth = Math.max(1, g.R * 0.006); c.lineCap = 'round';
      c.beginPath();
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * TAU, r0 = rad * (i % 5 ? 0.93 : 0.895), r1 = rad * 0.97;
        c.moveTo(o + Math.sin(a) * r0, o - Math.cos(a) * r0); c.lineTo(o + Math.sin(a) * r1, o - Math.cos(a) * r1);
      }
      c.stroke();
      c.strokeStyle = THEME.ink(0.14); c.lineWidth = Math.max(1, g.R * 0.004);
      c.beginPath(); c.arc(o, o, G.hubR * 1.18, 0, TAU); c.stroke();
      platter = cv;
    }

    const pj = { x: 0, y: 0, s: 1, hw: 0, u: 0 };
    let bend = 0;
    function proj(tau, out = pj) {
      const s = tau >= 0 ? 1 / (1 + K * tau) : 1 - K * tau;
      const u = (1 - s) / (1 - S1);
      out.s = s; out.u = u;
      out.y = G.yC - u * (G.yC - G.yH);
      out.x = g.cx + bend * u * u;
      out.hw = G.w0 * s;
      return out;
    }
    const pill = (ctx, x, y, w, h) => { ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); };

    function drawTrack(ctx, now, P) {
      const r = g.R;
      // surface
      ctx.beginPath();
      const steps = 14, u0 = -0.06;
      for (let i = 0; i <= steps; i++) { const u = u0 + (1 - u0) * (i / steps), s = 1 - u * (1 - S1); const y = G.yC - u * (G.yC - G.yH), x = g.cx + bend * u * u; const hw = G.w0 * s; if (i) ctx.lineTo(x - hw, y); else ctx.moveTo(x - hw, y); }
      for (let i = steps; i >= 0; i--) { const u = u0 + (1 - u0) * (i / steps), s = 1 - u * (1 - S1); const y = G.yC - u * (G.yC - G.yH), x = g.cx + bend * u * u; ctx.lineTo(x + G.w0 * s, y); }
      ctx.closePath();
      ctx.fillStyle = THEME.ink(THEME.light ? 0.06 : 0.055); ctx.fill();
      // rails
      ctx.lineWidth = Math.max(1.5, r * 0.007); ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) { const u = u0 + (1 - u0) * (i / steps), s = 1 - u * (1 - S1); const y = G.yC - u * (G.yC - G.yH), x = g.cx + bend * u * u + side * G.w0 * s; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.strokeStyle = THEME.ink(0.22); ctx.stroke();
      }
      // beat lines scrolling with the music
      const B = R.chart?.beats;
      if (B && B.length) {
        let lo = 0, hi = B.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (B[m] < now) lo = m + 1; else hi = m; }
        for (let i = lo; i < B.length && B[i] <= now + LA; i++) {
          const tau = (B[i] - now) / LA; proj(tau);
          const strong = downSet.has(i);
          ctx.strokeStyle = THEME.ink((strong ? 0.2 : 0.09) * clamp((1 - tau) * 5, 0, 1));
          ctx.lineWidth = Math.max(1, r * (strong ? 0.008 : 0.005) * pj.s);
          ctx.beginPath(); ctx.moveTo(pj.x - pj.hw, pj.y); ctx.lineTo(pj.x + pj.hw, pj.y); ctx.stroke();
        }
      }
      // the catch line, in the colour you're on
      const cc = P.c[colour];
      ctx.save();
      if (THEME.glow) { ctx.shadowColor = cc; ctx.shadowBlur = r * (0.03 + 0.05 * fx.colour); }
      ctx.strokeStyle = fx.miss > 0.5 ? THEME.danger : cc;   // a miss flashes the line red
      ctx.lineWidth = r * (0.014 + 0.008 * fx.colour);
      ctx.beginPath(); ctx.moveTo(g.cx - G.w0 * 1.08, G.yC); ctx.lineTo(g.cx + G.w0 * 1.08, G.yC); ctx.stroke();
      ctx.restore();
    }

    function drawRibbon(ctx, t0, t1, now, col, alpha, wk) {
      let a = (t0 - now) / LA, b = (t1 - now) / LA;
      a = Math.max(a, -0.04); b = Math.min(b, 1.02);
      if (b <= a) return;
      const steps = 8;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) { proj(a + (b - a) * (i / steps)); if (i) ctx.lineTo(pj.x - pj.hw * wk, pj.y); else ctx.moveTo(pj.x - pj.hw * wk, pj.y); }
      for (let i = steps; i >= 0; i--) { proj(a + (b - a) * (i / steps)); ctx.lineTo(pj.x + pj.hw * wk, pj.y); }
      ctx.closePath();
      ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
    }
    function drawNote(ctx, n, now, P) {
      const r = g.R;
      const missed = n.judged === 'miss';
      if (n.type === 'hold') {
        const col = P.c[n.c];
        const from = n.holding ? Math.max(n.t, now) : n.t;
        drawRibbon(ctx, from, n.t + n.dur, now, col, missed || n.dropped ? 0.18 : n.holding ? 0.62 : 0.4, 0.5);
        const te = (n.t + n.dur - now) / LA;
        if (te <= 1 && te > -0.05) { proj(te); ctx.globalAlpha = missed || n.dropped ? 0.3 : 0.9; ctx.fillStyle = col; pill(ctx, pj.x, pj.y, pj.hw * 1.1, r * 0.03 * pj.s); ctx.fill(); ctx.globalAlpha = 1; }
        if (n.holding || n.held || n.dropped) return;
      }
      if (n.done && !missed) return;
      const tau = (n.t - now) / LA;
      if (tau > 1.02 || tau < -0.14) return;
      proj(tau);
      const { x, y, s, hw } = pj;
      ctx.globalAlpha = (missed ? 0.3 : 1) * clamp((1.02 - tau) * 5, 0, 1) * (tau < 0 ? clamp(1 + tau / 0.14, 0, 1) : 1);
      switch (n.type) {
        case 'match': {
          ctx.fillStyle = P.c[n.c]; pill(ctx, x, y, hw * 1.05, r * 0.05 * s); ctx.fill();
          break;
        }
        case 'tap': case 'hold': {
          const h = r * 0.066 * s;
          ctx.fillStyle = P.c[n.c]; pill(ctx, x, y, hw * 1.8, h); ctx.fill();
          ctx.lineWidth = Math.max(1.5, r * 0.009 * s); ctx.strokeStyle = THEME.fg; ctx.stroke();
          ctx.fillStyle = THEME.fg; ctx.beginPath(); ctx.arc(x, y, h * 0.2, 0, TAU); ctx.fill();
          break;
        }
        case 'beat': {
          const h = r * 0.05 * s;
          ctx.fillStyle = THEME.fg; pill(ctx, x, y, hw * 2.2, h); ctx.fill();
          ctx.fillStyle = THEME.bg; ctx.beginPath(); ctx.arc(x, y, h * 0.28, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.arc(x - hw * 0.62, y, h * 0.16, 0, TAU); ctx.arc(x + hw * 0.62, y, h * 0.16, 0, TAU); ctx.fill();
          break;
        }
        case 'spin': {
          const h = r * 0.09 * s, w = hw * 2.35;
          ctx.fillStyle = P.spin; pill(ctx, x, y, w, h); ctx.fill();
          ctx.strokeStyle = P.chev; ctx.lineWidth = Math.max(1.5, h * 0.17); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();
          for (let k = -1; k <= 1; k++) {
            const cx0 = x + k * w * 0.24, a = h * 0.22 * n.dir;
            ctx.moveTo(cx0 - a, y - h * 0.26); ctx.lineTo(cx0 + a, y); ctx.lineTo(cx0 - a, y + h * 0.26);
          }
          ctx.stroke();
          break;
        }
      }
      ctx.globalAlpha = 1;
    }

    let beatPulse = 0, downSet = new Set();
    R.onReady(() => { downSet = new Set(R.analysis?.downbeats || []); });
    function drawWheel(ctx, now, P) {
      const r = g.R, { wx, wy, rw, rimW, hubR } = G;
      buildPlatter();
      g.draw.ball(wx, wy, rw + rimW / 2, THEME.bg);   // solid: notes that pass the catch line go under the wheel
      ctx.save(); ctx.translate(wx, wy); ctx.rotate(theta);
      ctx.drawImage(platter, -platter.width / (g.dpr || 1) / 2, -platter.height / (g.dpr || 1) / 2, platter.width / (g.dpr || 1), platter.height / (g.dpr || 1));
      ctx.restore();
      // the rim: two colour halves (top half = colour A when theta = 0)
      g.draw.arc(wx, wy, rw, theta - Math.PI / 2, theta + Math.PI / 2, P.c[0], rimW, { cap: 'butt' });
      g.draw.arc(wx, wy, rw, theta + Math.PI / 2, theta + Math.PI * 1.5, P.c[1], rimW, { cap: 'butt' });
      // seams between the halves
      ctx.strokeStyle = THEME.bg; ctx.lineWidth = Math.max(2, r * 0.008);
      ctx.beginPath();
      for (const a of [theta + Math.PI / 2, theta - Math.PI / 2]) {
        const sx = Math.sin(a), sy = -Math.cos(a);
        ctx.moveTo(wx + sx * (rw - rimW / 2), wy + sy * (rw - rimW / 2)); ctx.lineTo(wx + sx * (rw + rimW / 2), wy + sy * (rw + rimW / 2));
      }
      ctx.stroke();
      // rim lights, pulsing on the beat
      const n = 24, lr = r * 0.0075 * (1 + 0.6 * beatPulse);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.3 + 0.6 * beatPulse;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = theta + ((i + 0.5) / n) * TAU;
        const x = wx + Math.sin(a) * rw, y = wy - Math.cos(a) * rw;
        ctx.moveTo(x + lr, y); ctx.arc(x, y, lr, 0, TAU);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      // the catcher on top: a bright collar in the colour you're on
      const cc = P.c[colour];
      const cr = rw + rimW / 2 + r * 0.012;
      g.draw.arc(wx, wy, cr, -0.3, 0.3, cc, r * (0.012 + 0.01 * fx.colour), { glow: THEME.glow ? r * 0.04 : 0 });
      // the pointer shows the colour the next note wants (it swells when that means turning the wheel)
      const want = nextC >= 0 && nextC !== colour, pw = r * (want ? 0.03 + 0.006 * Math.sin(now / 60) : 0.022);
      ctx.fillStyle = nextC >= 0 ? P.c[nextC] : THEME.fg;
      ctx.strokeStyle = THEME.fg; ctx.lineWidth = Math.max(1.5, r * 0.005); ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(wx, wy - cr + r * 0.004); ctx.lineTo(wx - pw, wy - cr - pw * 1.36); ctx.lineTo(wx + pw, wy - cr - pw * 1.36); ctx.closePath(); ctx.fill(); ctx.stroke();
      // spin ring: a big arrow round the wheel while a spin is coming / running
      drawSpinRing(ctx, now, P);
      // the hub (drum pad) with the score
      const hp = Math.max(fx.hub, fx.hubTap * 0.5);
      g.draw.circle(wx, wy, hubR * (1 + 0.05 * fx.hub), THEME.bg, { stroke: THEME.ink(0.22 + 0.6 * hp), lw: Math.max(2, r * (0.008 + 0.01 * hp)) });
      if (fx.hub > 0.02) g.draw.circle(wx, wy, hubR * (1 + 0.05 * fx.hub), THEME.ink(0.12 * fx.hub));
      // a dot on the hub turns with the wheel
      const da = theta;
      g.draw.ball(wx + Math.sin(da) * hubR * 0.82, wy - Math.cos(da) * hubR * 0.82, r * 0.012, THEME.ink(0.45));
      // drum bars coming: approach rings close in on the hub
      for (const m of upcomingBeats) {
        const tau = (m.t - now) / LA;
        if (tau < 0 || tau > 0.4) continue;
        ctx.globalAlpha = clamp(1 - tau / 0.4, 0, 1) * 0.9;
        ctx.strokeStyle = THEME.fg; ctx.lineWidth = Math.max(2, r * 0.009);
        ctx.beginPath(); ctx.arc(wx, wy, hubR * (1.04 + tau * 2.4), 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const sc = R.score.toLocaleString();
      let fs = r * 0.07;
      ctx.font = `700 ${fs}px ${THEME.display}`;
      const wd = ctx.measureText(sc).width; if (wd > hubR * 1.6) fs *= (hubR * 1.6) / wd;
      if (R.state === 'count') return;   // the kit's count-in caption sits here
      g.draw.text(sc, wx, wy - r * 0.012, fs, { color: THEME.fg });
      const sub = R.combo >= 2 ? `${R.combo} combo${R.multiplier > 1 ? ` · ×${R.multiplier}` : ''}` : R.diffName;
      g.draw.text(sub, wx, wy + r * 0.055, r * 0.032, { color: THEME.muted, weight: 700, font: THEME.font });
    }
    function drawSpinRing(ctx, now, P) {
      const r = g.R;
      let n = null, prog = 0;
      for (const m of spins) if (!m.spun && m.trk.started && m.holding) { n = m; prog = m.trk.prog; break; }
      let k = 1;
      if (!n) for (const m of upcomingSpins) { const tau = (m.t - now) / LA; if (tau >= -0.1 && tau <= 0.55 && !m.done) { n = m; k = clamp(1 - tau / 0.55, 0, 1); break; } }
      if (!n && fx.spin < 0.02) return;
      const rr = G.rw + G.rimW / 2 + r * 0.055, lw = r * 0.022;
      if (!n) { ctx.globalAlpha = fx.spin; g.draw.arc(G.wx, G.wy, rr, 0, TAU, P.spin, lw); ctx.globalAlpha = 1; return; }
      const dir = n.dir, span = SPIN_NEED;
      const a0 = 0, a1 = dir * span;
      ctx.globalAlpha = 0.25 + 0.45 * k;
      g.draw.arc(G.wx, G.wy, rr, Math.min(a0, a1), Math.max(a0, a1), P.spin, lw * 0.45);
      ctx.globalAlpha = 1;
      if (prog > 0) { const p = clamp(prog, 0, span) * dir; g.draw.arc(G.wx, G.wy, rr, Math.min(0, p), Math.max(0, p), P.spin, lw, { glow: r * 0.04 }); }
      // arrow head at the end
      const ae = a1, hx = G.wx + Math.sin(ae) * rr, hy = G.wy - Math.cos(ae) * rr;
      const tx = Math.cos(ae) * dir, ty = Math.sin(ae) * dir;   // tangent in the spin direction
      const nx = Math.sin(ae), ny = -Math.cos(ae);
      const L = r * 0.05, Wd = r * 0.035;
      ctx.globalAlpha = 0.35 + 0.65 * k;
      ctx.fillStyle = P.spin;
      ctx.beginPath(); ctx.moveTo(hx + tx * L, hy + ty * L); ctx.lineTo(hx + nx * Wd, hy + ny * Wd); ctx.lineTo(hx - nx * Wd, hy - ny * Wd); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    const upcomingBeats = [], upcomingSpins = [];
    let nextC = -1;

    function drawFx(ctx, dt, P) {
      const r = g.R;
      // catch flares
      for (const f of flares) {
        if (!f.on) continue;
        f.t += dt;
        const life = f.big ? 0.42 : 0.3;
        if (f.t > life) { f.on = false; continue; }
        const k = f.t / life, e = 1 - (1 - k) ** 3;
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.strokeStyle = f.col; ctx.lineWidth = r * 0.012 * (1 - k) + 1;
        ctx.beginPath(); ctx.ellipse(g.cx, G.yC, G.w0 * (1 + e * (f.big ? 0.9 : 0.6)), r * 0.03 + r * 0.06 * e, 0, 0, TAU); ctx.stroke();
        // a light beam up the track
        ctx.globalAlpha = (1 - k) * (f.big ? 0.2 : 0.12);
        ctx.fillStyle = f.col;
        ctx.beginPath(); ctx.moveTo(g.cx - G.w0 * 0.9, G.yC); ctx.lineTo(g.cx + G.w0 * 0.9, G.yC);
        ctx.lineTo(g.cx + bend * 0.1 + G.w0 * 0.35, G.yC - r * (0.22 + 0.2 * e)); ctx.lineTo(g.cx + bend * 0.1 - G.w0 * 0.35, G.yC - r * (0.22 + 0.2 * e)); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // streak flames along the rails
      const tier = R.combo >= 100 ? 3 : R.combo >= 50 ? 2 : R.combo >= 20 ? 1 : 0;
      if (tier && R.state === 'play') {
        const rate = [0, 22, 40, 64][tier] * dt;
        for (let i = 0; i < 2; i++) {
          let m = rate / 2;
          while (m > 0) {
            if (Math.random() < m) {
              const side = i ? 1 : -1;
              flame(g.cx + side * G.w0 * (1.0 + Math.random() * 0.1), G.yC + r * 0.01, side * r * (0.02 + Math.random() * 0.08) - side * r * 0.06,
                -r * (0.35 + Math.random() * 0.35 + tier * 0.08), 0.35 + Math.random() * 0.25 + tier * 0.05, r * (0.012 + tier * 0.004), colour);
            }
            m -= 1;
          }
        }
      }
      const add = !THEME.light && THEME.glow;
      if (add) ctx.globalCompositeOperation = 'lighter';
      for (const f of flames) {
        if (!f.on) continue;
        f.t += dt;
        if (f.t >= f.life) { f.on = false; continue; }
        f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.96;
        const k = f.t / f.life;
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.fillStyle = P.c[f.c] || P.spin;
        // a flame tongue: round at the bottom, pointed up
        const w = f.size * (1 - k * 0.6), h = w * (2.6 + k * 1.5), x = f.x, y = f.y, lean = f.vx * 0.04;
        ctx.beginPath(); ctx.moveTo(x + lean, y - h); ctx.quadraticCurveTo(x + w * 1.3, y - w * 0.2, x, y + w); ctx.quadraticCurveTo(x - w * 1.3, y - w * 0.2, x + lean, y - h); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (add) ctx.globalCompositeOperation = 'source-over';
    }

    g.loop((dt) => {
      layout();
      if (R.state === 'play' || R.state === 'count') { const now0 = R.now(); physics(dt, now0); judgePass(now0); }
      if (!R.drawPre(dt)) return;
      const ctx = g.ctx, now = R.now(), P = palette();
      if (R.state === 'done') physics(dt, now);
      for (const k in fx) fx[k] = Math.max(0, fx[k] - dt * (k === 'colour' ? 5 : 3.2));
      // beat pulse from the chart's beat grid
      const B = R.chart?.beats;
      if (B && B.length) {
        let lo = 0, hi = B.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (B[m] <= now) lo = m + 1; else hi = m; }
        const i = lo - 1;
        beatPulse = i >= 0 ? Math.exp(-(now - B[i]) / 150) * (downSet.has(i) ? 1 : 0.6) : 0;
      }
      bend = g.R * 0.1 * Math.sin(now / 2700) * (D >= 2 ? 1 : 0.6);
      g.draw.bg({ glow: 0.13 + 0.05 * beatPulse, glowAt: [0, 0.35] });
      drawTrack(ctx, now, P);
      const vis = R.window(now - LA * 0.15, now + LA * 1.02);
      upcomingBeats.length = 0; upcomingSpins.length = 0; nextC = -1;
      for (let i = vis.length - 1; i >= 0; i--) {
        const n = vis[i];
        if (n.type === 'beat' && !n.done) upcomingBeats.push(n);
        if (n.type === 'spin') upcomingSpins.unshift(n);
        if (!n.done && n.c >= 0 && n.t >= now - 60) nextC = n.c;
        drawNote(ctx, n, now, P);
        if (n.judged === 'miss' && !n.fx) { n.fx = 1; fx.miss = 1; }
      }
      drawWheel(ctx, now, P);
      drawFx(ctx, dt, P);
      g.draw.particles(dt);
    });

    // let go of everything held when the game pauses (keyup / pointerup can land while the pause card is up)
    const release = () => { arrowHeld = 0; keysDown.clear(); presses.clear(); if (drag) { drag = null; mode = 'free'; omega = 0; } };
    return { destroy: R.handle.destroy, pause() { release(); R.handle.pause(); }, resume() { release(); R.handle.resume(); } };
  },
};
