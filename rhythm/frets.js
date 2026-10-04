// Fret Fire — a round take on fret-highway rhythm games. Notes ride down a perspective highway from a
// vanishing point near the top of the circle to a strike line of fret buttons on the lower part of the
// screen. Lanes by difficulty (Easy 3, Medium 4, Hard+ 5), sustains with a glowing tail you keep held,
// chords from Hard up, hit flames & sparks, beat lines from the chart's beat grid, and Overdrive:
// glowing phrases charge a meter; at half or more, a tap up top (or Space) doubles the score for a while
// and turns the highway the game's colour. The rock meter (health) and Overdrive meter sit on the rim.
import { rhythmGame, DIFF_OPTION, DIFFICULTIES, POINTS, judgeColor } from './kit.js';
import { THEME, TAU, clamp, ease } from '../games/kit.js';

const LANES = [3, 4, 5, 5, 5];
const LOOK = [2100, 1750, 1450, 1200, 1000];          // look-ahead in ms: the note speed rises with difficulty
const WIDTH = { 3: 1.0, 4: 1.13, 5: 1.25 };            // highway width at the strike line (× R)
const PAL = ['#ff4fb8', '#8a63ff', '#2f9bff', '#19c9a0', '#ffa62b'];   // magenta · violet · azure · mint · amber
const PAL_OF = { 3: [0, 2, 4], 4: [0, 1, 2, 4], 5: [0, 1, 2, 3, 4] };
const PHRASE_LEN = [[4, 5], [5, 6], [6, 7], [6, 8], [7, 9]];     // overdrive phrase length (note events)
const KEYS = ['1', '2', '3', '4', '5'], KEYS2 = ['a', 's', 'd', 'f', 'g'];
const ZMAX = 2.6;            // depth of the highway (perspective strength)
const OD_FULL_S = 16;        // a full Overdrive meter lasts this many seconds
const EARLY = 1.7;           // a press this much earlier than the good window (× good) counts as a miss
const SPARKS = 260;

function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export default {
  howTo: 'Strike each note as it reaches the fret line — touch the buttons (several at once for chords) or press 1–5 / A S D F G — and keep holding the long ones. Hit every note of a glowing phrase to charge Overdrive, then tap the top of the screen (or Space) for double points.',
  modes: [{ id: 'play', name: 'Play', options: [DIFF_OPTION] }],
  keyRepeat: false,

  create(g) {
    const D = Math.max(0, DIFFICULTIES.findIndex((d) => d.id === (g.opts?.level || DIFF_OPTION.default)));
    const N = LANES[D], look = LOOK[D];
    const col = PAL_OF[N].map((i) => PAL[i]);
    const G = { yv: 0, ys: 0, h: 0, W: 0, lw: 0, x0: 0, split: 0 };
    const R = rhythmGame(g, {
      game: 'frets', lanes: N, holds: true, chords: D >= 2, leadMs: 1800, rim: false,
      popupAt: () => [-9999, -9999],   // judgements are drawn by the game (one at a time, above the frets)
    });

    // ------------------------------------------------------------ geometry (perspective highway)
    function layout() {
      const { cx, cy, R: r } = g;
      G.yv = cy - 0.88 * r; G.ys = cy + 0.5 * r; G.h = G.ys - G.yv;
      U_BOTTOM = (G.h / (cy + 0.95 * r - G.yv) - 1) / ZMAX;   // where the highway leaves the screen
      G.W = WIDTH[N] * r; G.lw = G.W / N; G.x0 = cx - G.W / 2; G.split = cy - 0.05 * r;
      layerSig = '';
    }
    const sAt = (u) => 1 / (1 + u * ZMAX);                 // u: 0 = strike line, 1 = horizon
    const yAt = (s) => G.yv + G.h * s;
    const xAt = (lane, s) => g.cx + (lane - (N - 1) / 2) * G.lw * s;
    let U_BOTTOM = -0.08;
    const fadeTop = (u) => clamp((1 - u) / 0.16, 0, 1);

    // ------------------------------------------------------------ pre-rendered static layer
    let layer = null, layerSig = '';
    const hwy = document.createElement('canvas');
    function trap(c, u0, u1, a = -0.5, b = 0.5) {   // quad of the highway between depths u0..u1, lanes a..b (× W)
      const s0 = sAt(u0), s1 = sAt(u1), y0 = yAt(s0), y1 = yAt(s1);
      c.beginPath();
      c.moveTo(g.cx + a * G.W * s0, y0); c.lineTo(g.cx + b * G.W * s0, y0);
      c.lineTo(g.cx + b * G.W * s1, y1); c.lineTo(g.cx + a * G.W * s1, y1); c.closePath();
    }
    let tone = [];   // per-lane colours for the current theme (built with the layer: no colour parsing per frame)
    function buildTones() {
      const lt = THEME.light, sh = g.draw.shade, al = g.draw.alpha;
      tone = col.map((c) => ({
        c, inner: sh(c, lt ? 0.6 : 0.55), outline: sh(c, -0.35), core: lt ? sh(c, -0.25) : sh(c, 0.6),
        f1: lt ? c : sh(c, 0.15), f2: lt ? sh(c, 0.45) : sh(c, 0.75), sp: lt ? c : sh(c, 0.35), sp2: lt ? sh(c, -0.3) : '#fff',
        on: al(c, 0.9), onIn: sh(c, 0.5), idleIn: al(c, lt ? 0.22 : 0.18),
      }));
    }
    function buildLayer() {
      const S = g.S, dpr = g.dpr || 1, r = g.R;
      buildTones();
      layer ||= document.createElement('canvas');
      for (const cv of [layer, hwy]) { cv.width = Math.max(1, Math.round(S * dpr)); cv.height = cv.width; }
      const L = layer.getContext('2d');
      L.setTransform(dpr, 0, 0, dpr, 0, 0);
      const saved = g.ctx;
      g.ctx = L;
      try { g.draw.bg({ glow: 0.15, glowAt: [0, -0.4] }); } finally { g.ctx = saved; }
      // the highway on its own canvas (so its far end can fade out)
      const c = hwy.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, S, S);
      if (!THEME.light) { trap(c, U_BOTTOM, 1); c.fillStyle = THEME.paper(0.5); c.fill(); }
      trap(c, U_BOTTOM, 1); c.fillStyle = THEME.ink(THEME.light ? 0.06 : 0.045); c.fill();
      // lane colour strips glowing up from the strike line
      for (let i = 0; i < N; i++) {
        const a = i / N - 0.5, b = (i + 1) / N - 0.5;
        trap(c, U_BOTTOM, THEME.flat ? 1 : 0.55, a + 0.004, b - 0.004);   // flat themes: no gradient, so the tint runs the full length
        if (THEME.flat) c.fillStyle = g.draw.alpha(col[i], THEME.light ? 0.08 : 0.07);
        else {
          const gr = c.createLinearGradient(0, yAt(sAt(0.55)), 0, G.ys);
          gr.addColorStop(0, g.draw.alpha(col[i], 0)); gr.addColorStop(1, g.draw.alpha(col[i], THEME.light ? 0.14 : 0.13));
          c.fillStyle = gr;
        }
        c.fill();
      }
      // lane dividers and rails
      const sT = sAt(1), sB = sAt(U_BOTTOM), yT = yAt(sT), yB = yAt(sB);
      c.lineCap = 'round';
      c.strokeStyle = THEME.ink(0.1); c.lineWidth = Math.max(1, r * 0.004);
      c.beginPath();
      for (let i = 1; i < N; i++) { const f = i / N - 0.5; c.moveTo(g.cx + f * G.W * sT, yT); c.lineTo(g.cx + f * G.W * sB, yB); }
      c.stroke();
      c.strokeStyle = THEME.ink(0.3); c.lineWidth = Math.max(1.5, r * 0.009);
      c.beginPath();
      for (const f of [-0.5, 0.5]) { c.moveTo(g.cx + f * G.W * sT, yT); c.lineTo(g.cx + f * G.W * sB, yB); }
      c.stroke();
      // the strike bar
      c.strokeStyle = THEME.ink(0.22); c.lineWidth = r * 0.014;
      c.beginPath(); c.moveTo(G.x0 - r * 0.01, G.ys); c.lineTo(G.x0 + G.W + r * 0.01, G.ys); c.stroke();
      // fade the far end into the background
      if (!THEME.flat) {
        c.globalCompositeOperation = 'destination-out';
        const gr = c.createLinearGradient(0, yT - 1, 0, yT + G.h * 0.22);
        gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = gr; c.fillRect(0, yT - 2, S, G.h * 0.22 + 3);
        c.globalCompositeOperation = 'source-over';
      }
      L.drawImage(hwy, 0, 0, S, S);
    }
    g.on('resize', layout);
    layout();

    // ------------------------------------------------------------ chart, phrases
    let byLane = [], lanePtr = new Int32Array(N), phrases = [], phIdx = 0, beats = [], downs = new Set(), beatPtr = 0, firstT = 0;
    R.onReady((chart) => {
      byLane = Array.from({ length: N }, () => []);
      for (const n of chart.notes) byLane[clamp(n.lane, 0, N - 1)].push(n);
      beats = chart.beats || [];
      downs = new Set(R.analysis?.downbeats || []);
      firstT = chart.notes[0]?.t ?? 0;
      // Overdrive phrases: every ~16–24 note events, a run of consecutive events is marked
      const ev = [];
      for (const n of chart.notes) { if (ev.length && ev[ev.length - 1].t === n.t) ev[ev.length - 1].notes.push(n); else ev.push({ t: n.t, notes: [n] }); }
      const rnd = prng((R.version?.seed || 1) * 977 + D * 131 + 7);
      const [l0, l1] = PHRASE_LEN[D];
      let e = 8 + Math.floor(rnd() * 6);
      while (e < ev.length) {
        const len = l0 + Math.floor(rnd() * (l1 - l0 + 1));
        if (e + len > ev.length) break;
        const ph = { notes: [], state: 0 };
        for (let k = e; k < e + len; k++) for (const n of ev[k].notes) { n.ph = ph; ph.notes.push(n); }
        phrases.push(ph);
        e += len + 16 + Math.floor(rnd() * 9);
      }
    });

    // ------------------------------------------------------------ state
    const press = new Int8Array(N), held = new Array(N).fill(null);
    const flame = new Float32Array(N), shock = new Float32Array(N), missF = new Float32Array(N);
    const shockCol = new Array(N).fill('#fff');
    const ptr = new Map(), keysDown = new Set();
    const JUDGE_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
    let judg = '', judgT = 9;
    const showJudge = (label) => { judg = label; judgT = 0; };
    let od = 0, odOn = false, odFlash = 0, odGain = 0, readyHinted = false, time = 0, lastMissSfx = 0, wasReady = false;
    const SP = Array.from({ length: SPARKS }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, c: '#fff', s: 1 }));
    let spI = 0;
    function spark(x, y, vx, vy, life, c, s) {
      const p = SP[spI]; spI = (spI + 1) % SPARKS;
      p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.life = life; p.c = c; p.s = s;
    }
    function sparkBurst(lane, n, power = 1) {
      const r = g.R, x = xAt(lane, 1), c = tone[lane].sp, c2 = tone[lane].sp2;
      for (let i = 0; i < n; i++) {
        spark(x + (Math.random() - 0.5) * G.lw * 0.5, G.ys - r * 0.01, (Math.random() - 0.5) * r * 0.9 * power,
          -r * (0.7 + Math.random() * 1.0) * power, 0.25 + Math.random() * 0.35, Math.random() < 0.3 ? c2 : c, r * (0.007 + Math.random() * 0.006));
      }
    }
    const bonus = (n) => { if (n > 0) { R.score += n; g.score(R.score); } };   // Overdrive doubles: the kit scored once, add it again

    // ------------------------------------------------------------ judging
    function onHit(n, label) {
      const L = n.lane;
      showJudge(label);
      if (label === 'miss') { n._fx = 1; missF[L] = 1; missSfx(); return; }
      flame[L] = label === 'perfect' ? 1 : label === 'great' ? 0.8 : 0.6;
      shock[L] = 1; shockCol[L] = col[L];
      sparkBurst(L, label === 'perfect' ? 14 : 9, label === 'perfect' ? 1.1 : 0.8);
      if (odOn) bonus(POINTS[label] * R.multiplier);
      if (n.dur > 0 && n.holding) held[L] = n;
    }
    function onRelease(n, res) {
      const x = xAt(n.lane, 1);
      if (res === 'perfect') {
        R.popup('SUSTAIN', x, G.ys - g.R * 0.12, judgeColor('hold'));
        sparkBurst(n.lane, 10, 0.9); shock[n.lane] = 1; shockCol[n.lane] = col[n.lane];
        if (odOn) bonus(Math.round((n.dur / 1000) * 100) * R.multiplier);
      } else if (res === 'miss') {
        R.popup('DROPPED', x, G.ys - g.R * 0.12, THEME.danger);
        missF[n.lane] = 1;
      }
    }
    function missSfx() {
      if (time - lastMissSfx < 0.12) return;
      lastMissSfx = time;
      g.sfx('hit', { volume: 0.55, pitch: 0.8 });
    }
    function tryHit(L, t, slide) {
      const list = byLane[L];
      if (!list) return;
      let i = lanePtr[L];
      while (i < list.length && list[i].done) i++;
      lanePtr[L] = i;
      const n = list[i];
      if (!n) return;
      if (R.inWindow(n, t)) { const label = R.hit(n, t); if (label) onHit(n, label); }
      else if (!slide && R.state === 'play' && n.t - t <= R.windows.good * EARLY) {
        // too early → a miss (no mashing), unless it was a late try at the note that just went by in this lane
        const prev = list[i - 1];
        if (prev && prev.judged === 'miss' && t - prev.t < R.windows.good * 2.2) return;
        R.missed(n); onHit(n, 'miss');
      }
    }
    function lanePress(L, t, slide = false) {
      if (L < 0 || L >= N) return;
      if (press[L]++ > 0) return;
      tryHit(L, t, slide);
    }
    function laneRelease(L, t) {
      if (L < 0 || L >= N || press[L] <= 0) return;
      if (--press[L] > 0) return;
      const n = held[L];
      if (n) { held[L] = null; if (n.holding) onRelease(n, R.release(n, t)); }
    }
    function clearInput() { press.fill(0); ptr.clear(); keysDown.clear(); }
    function tryOD() {
      if (odOn || od < 0.5 || R.state !== 'play') return;
      odOn = true; odFlash = 1;
      g.sfx('whoosh'); g.sfx('perfect', { pitch: 0.75 }); g.vibrate(30);
      for (let L = 0; L < N; L++) sparkBurst(L, 10, 1.3);
    }

    // ------------------------------------------------------------ input
    const laneOfX = (x) => clamp(Math.floor((x - G.x0) / G.lw), 0, N - 1);
    g.on('down', (e) => {
      const t = R.now();
      if (e.y < G.split) { ptr.set(e.id, -1); tryOD(); return; }
      const L = laneOfX(e.x);
      ptr.set(e.id, L);
      lanePress(L, t);
    });
    g.on('move', (e) => {
      const cur = ptr.get(e.id);
      if (cur == null || cur < 0) return;
      const f = (e.x - G.x0) / G.lw;               // slide between frets (a little hysteresis at the borders)
      if (f > cur - 0.12 && f < cur + 1.12) return;
      const L = laneOfX(e.x);
      if (L === cur) return;
      const t = R.now();
      ptr.set(e.id, L);
      laneRelease(cur, t);
      lanePress(L, t, true);
    });
    g.on('up', (e) => {
      const L = ptr.get(e.id);
      if (L == null) return;
      ptr.delete(e.id);
      if (L >= 0) laneRelease(L, R.now());
    });
    const keyLane = (k) => { let i = KEYS.indexOf(k); if (i < 0) i = KEYS2.indexOf(k); return i < N ? i : -1; };
    const normKey = (k) => (k && k.length === 1 ? k.toLowerCase() : k);
    g.on('key', (e) => {
      const k = normKey(e.key);
      if (k === ' ' || k === 'Enter' || k === 'ArrowUp') { tryOD(); return; }
      const L = keyLane(k);
      if (L < 0 || keysDown.has(k)) return;
      keysDown.add(k);
      lanePress(L, R.now());
    });
    g.on('keyup', (e) => {
      const k = normKey(e.key);
      if (!keysDown.has(k)) return;
      keysDown.delete(k);
      laneRelease(keyLane(k), R.now());
    });

    // ------------------------------------------------------------ per-frame logic
    function update(dt, now) {
      time += dt;
      for (let L = 0; L < N; L++) {
        flame[L] = Math.max(0, flame[L] - dt * 4.5); shock[L] = Math.max(0, shock[L] - dt * 4);
        missF[L] = Math.max(0, missF[L] - dt * 3.5);
        const n = held[L];
        if (n && !n.holding) { held[L] = null; onRelease(n, n.held ? 'perfect' : 'miss'); }   // the kit ended it at its tail
        else if (n) { flame[L] = Math.max(flame[L], 0.55 + 0.15 * Math.sin(time * 31 + L)); if (Math.random() < 0.55) sparkBurst(L, 1, 0.7); }
      }
      // phrases
      while (phIdx < phrases.length) {
        const p = phrases[phIdx];
        let all = true, fail = false;
        for (const n of p.notes) { if (!n.done) all = false; else if (n.judged === 'miss') fail = true; }
        if (fail) { p.state = -1; phIdx++; continue; }
        if (!all) break;
        p.state = 1; phIdx++;
        od = Math.min(1, od + 0.25); odGain = 1;
        R.popup('OVERDRIVE +', g.cx, g.cy - g.R * 0.2, odColor());
        g.sfx('coin');
      }
      if (odOn && R.state === 'play') { od -= dt / OD_FULL_S; if (od <= 0) { od = 0; odOn = false; g.sfx('drop', { volume: 0.6 }); } }
      const ready = od >= 0.5 && !odOn;
      if (ready && !wasReady) { g.sfx('score'); if (!readyHinted) { readyHinted = true; g.toast('Overdrive ready!', 1600); } }
      wasReady = ready;
      odFlash = Math.max(0, odFlash - dt * 1.4); odGain = Math.max(0, odGain - dt * 2);
      // beat pulse
      if (beatPtr > 0 && beats[beatPtr - 1] > now) beatPtr = 0;
      while (beatPtr < beats.length && beats[beatPtr] <= now) beatPtr++;
    }
    const odColor = () => g.color;
    function beatPulse(now) {
      if (!beatPtr) return 0;
      const b = beats[beatPtr - 1];
      return Math.max(0, 1 - (now - b) / 200) * (downs.has(beatPtr - 1) ? 1 : 0.6);
    }

    // ------------------------------------------------------------ drawing
    function drawOD(pulse) {
      const { ctx } = g;
      const k = odOn ? 1 : 0;
      if (!k && odFlash <= 0) return;
      const a = k * (0.12 + 0.08 * pulse) + odFlash * 0.25;
      ctx.save();
      trap(ctx, U_BOTTOM, 1);
      const oc = odColor(), yT = yAt(sAt(1));
      if (THEME.flat) ctx.fillStyle = g.draw.alpha(oc, a);
      else {   // fades in from the horizon like the highway itself
        const gr = ctx.createLinearGradient(0, yT, 0, yT + G.h * 0.3);
        gr.addColorStop(0, g.draw.alpha(oc, 0)); gr.addColorStop(1, g.draw.alpha(oc, a));
        ctx.fillStyle = gr;
      }
      ctx.fill();
      if (k) {
        const sT = sAt(1), sB = sAt(U_BOTTOM), yT = yAt(sT), yB = yAt(sB);
        ctx.strokeStyle = odColor(); ctx.lineWidth = g.R * 0.012; ctx.lineCap = 'round';
        if (THEME.glow) { ctx.shadowColor = odColor(); ctx.shadowBlur = g.R * 0.04; }
        ctx.beginPath();
        for (const f of [-0.5, 0.5]) { ctx.moveTo(g.cx + f * G.W * sT, yT + G.h * 0.05); ctx.lineTo(g.cx + f * G.W * sB, yB); }
        ctx.stroke();
      }
      ctx.restore();
    }
    function drawBeats(now) {
      const { ctx } = g;
      if (!beats.length) return;
      const t0 = now + U_BOTTOM * look, t1 = now + look;
      let lo = 0, hi = beats.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (beats[m] < t0) lo = m + 1; else hi = m; }
      const lineC = odOn ? odColor() : null;
      ctx.lineCap = 'round';
      for (let i = lo; i < beats.length && beats[i] <= t1; i++) {
        const u = (beats[i] - now) / look, s = sAt(u), y = yAt(s), hw = (G.W / 2) * s;
        const down = downs.has(i);
        const a = fadeTop(u) * (down ? 0.34 : 0.15) * (u < 0 ? clamp(1 + u * 8, 0, 1) : 1);
        if (a <= 0.005) continue;
        ctx.globalAlpha = lineC ? Math.min(1, a * 1.6) : a;
        ctx.strokeStyle = lineC || THEME.fg;
        ctx.lineWidth = Math.max(1, g.R * (down ? 0.011 : 0.005) * s);
        ctx.beginPath(); ctx.moveTo(g.cx - hw, y); ctx.lineTo(g.cx + hw, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function tail(n, now) {
      const { ctx } = g;
      if (n.held) return;
      const holding = !!n.holding, dead = n.dropped || n.judged === 'miss';
      const ts = holding ? Math.max(now, n.t) : n.t, te = n.t + n.dur;
      const u0 = Math.max(U_BOTTOM, (ts - now) / look), u1 = Math.min(1, (te - now) / look);
      if (u1 <= u0) return;
      const K = holding ? 16 : 6, L = n.lane, w = G.lw * (holding ? 0.17 : 0.14);
      const wob = holding ? G.lw * 0.05 : 0;
      ctx.beginPath();
      for (let k = 0; k <= K; k++) {
        const u = u0 + ((u1 - u0) * k) / K, s = sAt(u);
        const x = xAt(L, s) - (w / 2) * s + Math.sin(time * 26 - k * 1.4) * wob * s * (k ? 1 : 0);
        if (k) ctx.lineTo(x, yAt(s)); else ctx.moveTo(x, yAt(s));
      }
      for (let k = K; k >= 0; k--) {
        const u = u0 + ((u1 - u0) * k) / K, s = sAt(u);
        ctx.lineTo(xAt(L, s) + (w / 2) * s + Math.sin(time * 26 - k * 1.4) * wob * s * (k ? 1 : 0), yAt(s));
      }
      ctx.closePath();
      const c = dead ? THEME.ink(0.18) : col[L];
      ctx.globalAlpha = dead ? 1 : holding ? 0.95 : 0.7 * fadeTop(u0);
      ctx.fillStyle = c;
      if (holding && THEME.glow) { ctx.shadowColor = c; ctx.shadowBlur = g.R * 0.04; }
      ctx.fill();
      ctx.shadowBlur = 0;
      if (holding) {   // bright core
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = tone[L].core;
        ctx.lineWidth = Math.max(1.5, w * 0.22);
        ctx.beginPath();
        for (let k = 0; k <= K; k++) {
          const u = u0 + ((u1 - u0) * k) / K, s = sAt(u);
          const x = xAt(L, s) + Math.sin(time * 26 - k * 1.4) * wob * s * (k ? 1 : 0);
          if (k) ctx.lineTo(x, yAt(s)); else ctx.moveTo(x, yAt(s));
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function head(n, now) {
      const { ctx } = g;
      const hit = n.done && n.judged !== 'miss';
      if (hit && !n.holding) return;
      const miss = n.judged === 'miss';
      if (miss && !n._fx) { n._fx = 1; missF[n.lane] = 1; missSfx(); showJudge('miss'); }
      const u = n.holding ? 0 : (n.t - now) / look;
      if (u < U_BOTTOM || u > 1) return;
      const s = sAt(u), y = yAt(s), x = xAt(n.lane, s);
      const pulse = n.holding ? 1 + 0.06 * Math.sin(time * 30) : 1;
      const rx = G.lw * 0.37 * s * pulse, ry = rx * 0.52;
      const a = miss ? 0.4 * clamp(1 + u * 6, 0, 1) : fadeTop(u);
      if (a <= 0.01) return;
      const c = miss ? THEME.ink(0.35) : col[n.lane];
      ctx.globalAlpha = a;
      // overdrive phrase: a glowing outline
      if (n.ph && n.ph.state >= 0 && !miss) {
        const oc = odColor(), sh = 0.5 + 0.5 * Math.sin(time * 9 + n.t * 0.01);
        ctx.globalAlpha = a * (0.25 + 0.2 * sh); ctx.strokeStyle = oc;
        ctx.lineWidth = rx * 0.34;
        ctx.beginPath(); ctx.ellipse(x, y, rx * 1.3, ry * 1.42, 0, 0, TAU); ctx.stroke();
        ctx.globalAlpha = a; ctx.lineWidth = Math.max(1.5, rx * 0.12);
        ctx.beginPath(); ctx.ellipse(x, y, rx * 1.14, ry * 1.2, 0, 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
      if (!miss) {
        const T = tone[n.lane];
        if (THEME.light) { ctx.strokeStyle = T.outline; ctx.lineWidth = Math.max(1, rx * 0.08); ctx.stroke(); }
        ctx.fillStyle = T.inner;
        ctx.beginPath(); ctx.ellipse(x, y - ry * 0.06, rx * 0.5, ry * 0.46, 0, 0, TAU); ctx.fill();
        if (n.chord) { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y - ry * 0.06, rx * 0.2, ry * 0.18, 0, 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
    function drawButtons(pulse) {
      const { ctx } = g;
      const r = g.R;
      for (let L = 0; L < N; L++) {
        const x = xAt(L, 1), y = G.ys, c = col[L], T = tone[L];
        const on = press[L] > 0;
        const rx = G.lw * 0.4 * (on ? 0.93 : 1), ry = rx * 0.55;
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
        ctx.fillStyle = on ? T.on : THEME.light ? THEME.bg : THEME.paper(0.65);
        ctx.fill();
        ctx.lineWidth = r * (0.013 + 0.006 * pulse);
        ctx.strokeStyle = missF[L] > 0 ? THEME.danger : c;
        ctx.globalAlpha = missF[L] > 0 ? 0.5 + 0.5 * missF[L] : on ? 1 : 0.75 + 0.25 * pulse;
        ctx.stroke();
        ctx.globalAlpha = 1;
        // inner ring
        ctx.beginPath(); ctx.ellipse(x, y, rx * 0.56, ry * 0.56, 0, 0, TAU);
        ctx.fillStyle = on ? T.onIn : T.idleIn;
        ctx.fill();
        if (shock[L] > 0) {
          const k = 1 - shock[L];
          ctx.globalAlpha = shock[L];
          ctx.strokeStyle = shockCol[L]; ctx.lineWidth = r * 0.012 * shock[L] + 1;
          ctx.beginPath(); ctx.ellipse(x, y, rx * (1 + 0.7 * ease.out(k)), ry * (1 + 0.9 * ease.out(k)), 0, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
    function drawFlames() {
      const { ctx } = g;
      const lighter = !THEME.light;
      if (lighter) ctx.globalCompositeOperation = 'lighter';
      for (let L = 0; L < N; L++) {
        const f = flame[L];
        if (f <= 0.02) continue;
        const x = xAt(L, 1), y = G.ys, w = G.lw * 0.32 * (0.7 + 0.3 * f);
        const h = g.R * 0.24 * f * (0.85 + 0.15 * Math.sin(time * 37 + L * 2));
        flameShape(x, y, w, h, tone[L].f1, 0.75 * f);
        flameShape(x, y, w * 0.5, h * 0.62, tone[L].f2, 0.9 * f);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    function flameShape(x, y, w, h, c, a) {
      const { ctx } = g;
      ctx.globalAlpha = a; ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(x - w, y);
      ctx.quadraticCurveTo(x - w * 0.95, y - h * 0.55, x, y - h);
      ctx.quadraticCurveTo(x + w * 0.95, y - h * 0.55, x + w, y);
      ctx.quadraticCurveTo(x, y + w * 0.3, x - w, y);
      ctx.fill();
    }
    function drawSparks(dt) {
      const { ctx } = g;
      const grav = g.R * 2.2;
      if (!THEME.light) ctx.globalCompositeOperation = 'lighter';
      for (const p of SP) {
        if (!p.on) continue;
        p.t += dt;
        if (p.t >= p.life) { p.on = false; continue; }
        p.vy += grav * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        const k = 1 - p.t / p.life;
        ctx.globalAlpha = k; ctx.fillStyle = p.c;
        ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s * (p.vy < 0 ? 1.8 : 1));
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    function drawGauges(pulse) {
      const { cx, cy, R: r } = g;
      const deg = Math.PI / 180, rr = r * 0.912, w = r * 0.026;
      // rock meter (health), left: fills from the bottom up through red / amber / green zones
      const A0 = 208, A1 = 332, span = A1 - A0;
      const zones = [[0, 0.25, THEME.danger], [0.25, 0.5, THEME.warn], [0.5, 1, THEME.ok]];
      for (const [z0, z1, c] of zones) g.draw.arc(cx, cy, rr, (A0 + span * z0 + 0.8) * deg, (A0 + span * z1 - 0.8) * deg, g.draw.alpha(c, THEME.light ? 0.2 : 0.16), w, { cap: 'butt' });
      const hp = R.health, hc = hp > 0.5 ? THEME.ok : hp > 0.25 ? THEME.warn : THEME.danger;
      if (hp > 0.005) g.draw.arc(cx, cy, rr, A0 * deg, (A0 + span * hp) * deg, hc, w * 0.6);
      const ha = (A0 + span * hp) * deg, hx = cx + Math.sin(ha) * rr, hy = cy - Math.cos(ha) * rr;
      const danger = hp <= 0.25 ? 0.5 + 0.5 * Math.sin(time * 12) : 0;
      g.draw.circle(hx, hy, w * (0.75 + 0.25 * danger), THEME.fg, { stroke: hc, lw: Math.max(2, w * 0.3) });
      // overdrive meter, right: four segments filling from the bottom up
      const B0 = 152, seg = 31, oc = odColor(), ready = od >= 0.5 && !odOn;
      const glowA = ready ? 0.6 + 0.4 * Math.sin(time * 6) : 1;
      for (let k = 0; k < 4; k++) {
        const hiA = B0 - seg * k - 1.2, loA = B0 - seg * (k + 1) + 1.2;
        g.draw.arc(cx, cy, rr, loA * deg, hiA * deg, THEME.ink(0.1), w, { cap: 'butt' });
        const f = clamp(od * 4 - k, 0, 1);
        if (f > 0.01) g.draw.arc(cx, cy, rr, (hiA - (hiA - loA) * f) * deg, hiA * deg, g.draw.alpha(oc, glowA), w, { cap: 'butt', glow: (odOn || ready) && k === 0 ? r * 0.04 : 0 });
      }
      if (odGain > 0) g.draw.arc(cx, cy, rr, (B0 - seg * 4) * deg, B0 * deg, g.draw.alpha(oc, odGain * 0.5), w * (1 + odGain));
      // song progress, bottom
      g.draw.arc(cx, cy, rr, 166 * deg, 194 * deg, THEME.ink(0.1), r * 0.01);
      if (R.progress > 0.005) g.draw.arc(cx, cy, rr, 166 * deg, (166 + 28 * R.progress) * deg, THEME.ink(0.55), r * 0.01);
      // labels at the bottom ends
      const lab = (t, a, c) => g.draw.text(t, cx + Math.sin(a * deg) * r * 0.835, cy - Math.cos(a * deg) * r * 0.835, r * 0.03, { color: c, weight: 800, font: THEME.font });
      lab('ROCK', 214, THEME.dim);
      lab('OVERDRIVE', 143, ready || odOn ? oc : THEME.dim);
    }
    function drawMult(pulse) {
      const { cx, cy, R: r } = g;
      const x = cx, y = cy + r * 0.745, rad = r * 0.068;
      const m = R.multiplier * (odOn ? 2 : 1);
      const oc = odColor();
      g.draw.circle(x, y, rad, odOn ? oc : THEME.light ? THEME.bg : THEME.paper(0.6), { stroke: THEME.ink(0.14), lw: Math.max(1.5, r * 0.006) });
      const prog = R.multiplier >= 4 ? 1 : (R.combo % 10) / 10;
      if (prog > 0.01) g.draw.arc(x, y, rad + r * 0.012, 0, TAU * prog, odOn ? oc : R.multiplier >= 4 ? judgeColor('perfect') : THEME.ink(0.65), r * 0.012);
      g.draw.text(`×${m}`, x, y + 1, r * (0.055 + 0.008 * pulse), { color: odOn ? '#fff' : THEME.fg, weight: 800 });
    }
    function drawJudge(dt) {
      judgT += dt;
      if (!judg || judgT > 0.6) return;
      const r = g.R, s = judgT < 0.1 ? ease.back(judgT / 0.1) : 1, a = judgT < 0.4 ? 1 : 1 - (judgT - 0.4) / 0.2;
      const y = G.ys - r * 0.26 - judgT * r * 0.04;
      g.draw.text(JUDGE_TEXT[judg], g.cx, y, r * (judg === 'perfect' ? 0.064 : 0.056) * s, { color: judgeColor(judg), alpha: a, weight: 800, glow: r * 0.03 });
    }
    function drawHints(now) {
      const { cx, cy, R: r } = g;
      if (R.state === 'count' || now < firstT - 400) {
        for (let L = 0; L < N; L++) g.draw.text(`${KEYS[L]} · ${KEYS2[L].toUpperCase()}`, xAt(L, 1), G.ys + r * 0.115, r * 0.032, { color: THEME.dim, weight: 700, font: THEME.font });
      }
      if (od >= 0.5 && !odOn && R.state === 'play') {
        const a = 0.55 + 0.45 * Math.sin(time * 5);
        const y = cy - r * 0.34, w = r * 0.66, h = r * 0.078;
        g.draw.roundRect(cx - w / 2, y - h / 2, w, h, h / 2, THEME.light ? 'rgba(255,255,255,.75)' : THEME.paper(0.55), { stroke: g.draw.alpha(odColor(), a), lw: Math.max(1.5, r * 0.007) });
        g.draw.text('TAP HERE FOR OVERDRIVE', cx, y + 1, r * 0.036, { color: odColor(), weight: 800, font: THEME.font, alpha: 0.7 + 0.3 * a });
      }
      if (odFlash > 0.02) {
        const k = 1 - odFlash, s = 0.8 + 0.4 * ease.out(Math.min(1, k * 2.5));
        g.draw.text('OVERDRIVE!', cx, cy - r * 0.2, r * 0.11 * s, { color: odColor(), alpha: Math.min(1, odFlash * 1.6), weight: 800, glow: r * 0.05 });
      }
    }

    g.loop((dt) => {
      if (!R.drawPre(dt)) return;
      const sig = `${g.S}|${THEME.id}|${THEME.mode}|${THEME.light}|${THEME.bg}|${THEME.flat}`;
      if (sig !== layerSig) { layerSig = sig; buildLayer(); }
      const { ctx } = g;
      ctx.drawImage(layer, 0, 0, g.S, g.S);
      const now = R.now();
      update(dt, now);
      const pulse = beatPulse(now);
      ctx.save();
      g.draw.clipCircle(g.R * 0.946);
      drawOD(pulse);
      drawBeats(now);
      // strike line beat pulse
      ctx.strokeStyle = odOn ? g.draw.alpha(odColor(), 0.4 + 0.5 * pulse) : THEME.ink(0.1 + 0.3 * pulse);
      ctx.lineWidth = g.R * 0.006; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(G.x0, G.ys); ctx.lineTo(G.x0 + G.W, G.ys); ctx.stroke();
      drawJudge(dt);   // under the notes: they matter more
      if (R.notes.length) {
        const vis = R.window(now + U_BOTTOM * look, now + look);
        for (let i = vis.length - 1; i >= 0; i--) if (vis[i].dur > 0) tail(vis[i], now);
        drawButtons(pulse);
        for (let i = vis.length - 1; i >= 0; i--) head(vis[i], now);
      } else drawButtons(pulse);
      drawFlames();
      drawSparks(dt);
      ctx.restore();
      drawMult(pulse);
      drawGauges(pulse);
      drawHints(now);
    });

    const h = R.handle;
    return {
      destroy() { h.destroy(); },
      pause() { h.pause(); },
      resume() { clearInput(); h.resume(); },
    };
  },
};
