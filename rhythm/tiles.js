// Rhythm Rush — a round take on the falling-tiles piano games. Tiles slide down lanes that curve in with the
// round screen towards a soft horizon at the top; tap a tile's lane (or the tile itself) as it lands on the
// line in the lower third. Long tiles are holds (keep pressing — a fill runs up the tile — and let go at the
// end), chords are tiles side by side (Hard and up), violet "double" tiles want two quick taps (Master).
// The rhythm kit (./kit.js) learns the song, charts it, judges, scores and draws the results; this file is
// the look, the geometry and the input.
import { rhythmGame, DIFF_OPTION, judgeColor } from './kit.js';
import { THEME, TAU, clamp, ease } from '../games/kit.js';

const DIFFS = ['easy', 'medium', 'hard', 'expert', 'master'];
/** ms a tile takes from the horizon to the line at "Auto" speed, per difficulty. */
const LOOK = [2400, 2000, 1650, 1350, 1100];
/** ms at ×1 — the Speed option divides it. */
const BASE_LOOK = 2600;
const SPEED_OPTION = {
  id: 'speed', name: 'Speed', default: 'auto',
  choices: [{ id: 'auto', name: 'Auto' }, { id: '1', name: '×1' }, { id: '1.5', name: '×1.5' }, { id: '2', name: '×2' }, { id: '3', name: '×3' }],
};
const KEYS = {
  4: { d: 0, f: 1, j: 2, k: 3, arrowleft: 0, arrowdown: 1, arrowup: 2, arrowright: 3 },
  3: { d: 0, f: 0, ' ': 1, j: 2, k: 2, arrowleft: 0, arrowdown: 1, arrowup: 1, arrowright: 2 },
};
const LABELS = { 4: ['D', 'F', 'J', 'K'], 3: ['F', 'SPACE', 'J'] };

export default {
  howTo: 'Tap each tile as it lands on the line: touch its lane or press D F J K (Easy: F Space J). Hold long tiles to the end; violet ones take two quick taps.',
  modes: [{ id: 'play', name: 'Play', options: [DIFF_OPTION, SPEED_OPTION] }],
  keyRepeat: false,

  create(g, { opts = {} } = {}) {
    const di = DIFFS.indexOf(g.opts?.level ?? opts.level);
    const D = di < 0 ? 1 : di;                       // same rule as the kit (unknown → Medium)
    const L = D === 0 ? 3 : 4;
    const spd = Number(opts.speed);
    const LOOKMS = spd > 0 ? BASE_LOOK / spd : LOOK[D];
    const R = rhythmGame(g, { game: 'tiles', lanes: L, holds: true, chords: D >= 2 });

    // ------------------------------------------------------------ geometry
    // The field: straight columns from the bottom up to the centre, then the sides follow a quarter ellipse
    // in to a point near the top (y0 → yTop), so the lanes narrow gracefully with the round screen.
    const G = { r: 0 };
    const RIM = 0.946;
    function geom() {
      const { cx, cy, R: r } = g;
      G.r = r; G.cx = cx; G.cy = cy;
      G.hitY = cy + r * 0.52;
      G.Wh = r * 0.775;                                // half width of the lanes at the line (≈ the chord there)
      G.y0 = cy;
      G.yTop = cy - r * 0.93;
      G.gap = r * 0.011;                               // gap between tiles and lane edges
      G.rad = r * 0.026;                               // tile corner radius
      G.Ht = r * (L === 3 ? 0.17 : 0.15);              // tap-tile height (px)
      G.travel = G.hitY - G.yTop;
      G.spd = G.travel / LOOKMS;                       // px per ms
      G.below = (cy + r - G.hitY) / G.spd + 60;        // ms a tile stays visible past the line
      G.insetF = G.gap / G.Wh;
      G.fadeA = G.yTop + r * 0.05; G.fadeB = cy - r * 0.3;
      offKey = '';
      placeNotes();
    }
    const wAt = (y) => {
      if (y >= G.y0) return G.Wh;
      const s = (G.y0 - y) / (G.y0 - G.yTop);
      return s >= 1 ? 0 : G.Wh * Math.sqrt(1 - s * s);
    };
    const yOf = (t, now) => G.hitY - (t - now) * G.spd;
    const fOf = (l) => -1 + (2 * l) / L;               // lane edge as a fraction of the half width
    const laneX = (l, y) => G.cx + (fOf(l) + 1 / L) * wAt(y);
    const laneAt = (x, y) => {
      const w = wAt(clamp(y, G.yTop + G.r * 0.06, G.cy * 3));
      const f = clamp((x - G.cx) / Math.max(1, w), -1, 0.9999);
      return clamp(Math.floor(((f + 1) / 2) * L), 0, L - 1);
    };

    // a lane-shaped quad (sides follow the curved lane edges) with rounded corners
    const YS = new Float32Array(72), XL = new Float32Array(72), XR = new Float32Array(72);
    function lanePath(c, f0, f1, yb, yt, rad) {
      let n = 0, y = yb;
      YS[n++] = yb;
      if (yt < G.y0) {
        if (yb > G.y0 + 0.5) { y = G.y0; YS[n++] = y; }
        const step = G.r * 0.04;
        while (y - step > yt + step * 0.35 && n < 70) { y -= step; YS[n++] = y; }
      }
      YS[n++] = yt;
      for (let k = 0; k < n; k++) { const w = wAt(YS[k]); XL[k] = G.cx + f0 * w; XR[k] = G.cx + f1 * w; }
      const h2 = Math.max(0, (yb - yt) / 2);
      const rb = Math.max(0, Math.min(rad, h2, (XR[0] - XL[0]) / 2));
      const rt = Math.max(0, Math.min(rad, h2, (XR[n - 1] - XL[n - 1]) / 2));
      c.beginPath();
      c.moveTo((XL[0] + XR[0]) / 2, YS[0]);
      c.arcTo(XL[0], YS[0], XL[1], YS[1], rb);
      for (let k = 1; k < n - 1; k++) c.lineTo(XL[k], YS[k]);
      c.arcTo(XL[n - 1], YS[n - 1], (XL[n - 1] + XR[n - 1]) / 2, YS[n - 1], rt);
      c.arcTo(XR[n - 1], YS[n - 1], XR[n - 2], YS[n - 2], rt);
      for (let k = n - 2; k >= 1; k--) c.lineTo(XR[k], YS[k]);
      c.arcTo(XR[0], YS[0], (XL[0] + XR[0]) / 2, YS[0], rb);
      c.closePath();
    }
    function sidePath(c, f, yb, yt) {
      c.moveTo(G.cx + f * wAt(yb), yb);
      if (yt < G.y0) {
        let y = Math.min(yb, G.y0);
        c.lineTo(G.cx + f * wAt(y), y);
        const step = G.r * 0.035;
        while (y - step > yt) { y -= step; c.lineTo(G.cx + f * wAt(y), y); }
      }
      c.lineTo(G.cx + f * wAt(yt), yt);
    }
    const tilePath = (c, l, yb, yt, rad = G.rad, grow = 0) => lanePath(c, fOf(l) + G.insetF - grow, fOf(l + 1) - G.insetF + grow, yb, yt, rad);

    // ------------------------------------------------------------ palette (follows the theme)
    const P = {};
    function palette() {
      const Lm = THEME.light;
      P.tap = Lm ? g.draw.shade(g.color, -0.16) : g.color;
      P.hold = Lm ? '#0d9aad' : '#3bd8ea';
      P.holdFill = Lm ? '#0a7685' : '#b4f5fc';
      P.dbl = Lm ? '#6a4fe0' : '#a08cff';
      P.lip = Lm ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.6)';
      P.miss = THEME.danger;
    }
    const colorOf = (n) => (n.dur > 0 ? P.hold : n.dbl ? P.dbl : P.tap);

    // ------------------------------------------------------------ static layer (field, lane edges, pads, key labels)
    let off = null, offKey = '';
    function ensureStatic() {
      const key = [THEME.id, THEME.mode, THEME.light, THEME.fg, THEME.flat, g.S, g.dpr, L].join('|');
      if (key === offKey && off) return;
      offKey = key;
      palette();
      off ||= document.createElement('canvas');
      off.width = Math.max(1, Math.round(g.S * g.dpr)); off.height = off.width;
      const c = off.getContext('2d');
      c.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      c.clearRect(0, 0, g.S, g.S);
      const { cx, cy, r } = G;
      c.save();
      c.beginPath(); c.arc(cx, cy, r * RIM, 0, TAU); c.clip();
      const fade = (a) => {
        if (THEME.flat) return THEME.ink(a);
        const gr = c.createLinearGradient(0, G.yTop, 0, cy - r * 0.35);
        gr.addColorStop(0, THEME.ink(0)); gr.addColorStop(1, THEME.ink(a));
        return gr;
      };
      // the field
      lanePath(c, -1, 1, cy + r, G.yTop, 0);
      c.fillStyle = fade(THEME.light ? 0.045 : 0.05); c.fill();
      // every other lane a touch deeper — columns read at a glance
      for (let l = 1; l < L; l += 2) { lanePath(c, fOf(l), fOf(l + 1), G.hitY, G.yTop, 0); c.fillStyle = fade(THEME.light ? 0.025 : 0.025); c.fill(); }
      // lane edges
      c.lineCap = 'round';
      c.beginPath();
      for (let l = 1; l < L; l++) sidePath(c, fOf(l), G.hitY, G.yTop + r * 0.03);
      c.strokeStyle = fade(0.1); c.lineWidth = Math.max(1, r * 0.004); c.stroke();
      c.beginPath(); sidePath(c, -1, cy + r, G.yTop); sidePath(c, 1, cy + r, G.yTop);
      c.strokeStyle = fade(0.18); c.lineWidth = Math.max(1, r * 0.006); c.stroke();
      // the pads under the line
      for (let l = 0; l < L; l++) { tilePath(c, l, cy + r * 1.2, G.hitY + r * 0.022); c.fillStyle = THEME.ink(THEME.light ? 0.05 : 0.055); c.fill(); }
      // key labels, in the slots the tiles land in
      c.font = `700 ${r * (L === 3 ? 0.032 : 0.038)}px ${THEME.font}`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = THEME.ink(0.26);
      const ly = G.hitY - G.Ht / 2;
      for (let l = 0; l < L; l++) c.fillText(LABELS[L][l], laneX(l, ly), ly);
      c.restore();
      // outline of the field (for the combo glow)
      outline = new Path2D();
      sidePath(outline, -1, G.hitY, G.yTop); sidePath(outline, 1, G.hitY, G.yTop);
    }
    let outline = null;

    // ------------------------------------------------------------ notes
    function placeNotes() {
      // judgement popups sit just under the line in their lane (the kit draws them 0.08·R above note.y)
      for (const n of R.notes) { n.x = G.cx + (laneX(n.lane, G.hitY) - G.cx) * 0.93; n.y = G.hitY + G.r * 0.16; }
    }
    R.onReady((chart) => {
      const N = chart.notes;
      // Master: "double" tiles — two quick taps in one lane. About one every bar and a half: either the next
      // note (a 16th / 8th later) moves into this lane, or, where the music leaves room, a twin is added.
      if (D === 4 && N.length) {
        const per = 60000 / (chart.bpm || 120);
        let step = per / 4; if (step < 105) step = per / 2;
        const add = [];
        let last = -1e9;
        const lone = (m) => m && !m.chord && !(m.dur > 0) && !m.dbl;
        const holdIn = (lane, t0, t1) => N.some((m) => m.dur > 0 && m.lane === lane && m.t < t1 && m.t + m.dur > t0);
        for (let i = 1; i < N.length - 1; i++) {
          const n = N[i], prev = N[i - 1], next = N[i + 1], after = N[i + 2];
          if (!lone(n) || n.s < 0.3 || n.t - last < per * 5.5 || n.t - prev.t < 120) continue;
          const gap = next.t - n.t;
          if (lone(next) && gap >= 90 && gap <= per / 2 + 5 && (!after || after.t - next.t >= 200 || (after.lane !== n.lane && after.t - next.t >= 100))
            && !holdIn(n.lane, n.t, next.t + 120)) {
            next.lane = n.lane; next.dbl = 2; n.mate = next;
          } else {
            const t2 = Math.round(n.t + step);
            if (next.t < t2 + Math.max(step, 150) || holdIn(n.lane, n.t - 150, t2 + 150)) continue;
            n.mate = { t: t2, lane: n.lane, dur: 0, s: n.s, b: n.b, p: n.p, beat: Math.round((n.beat + step / per) * 1000) / 1000, chord: false, dbl: 2 };
            add.push(n.mate);
          }
          n.dbl = 1;
          last = n.t;
        }
        N.push(...add);
        N.sort((a, b) => a.t - b.t || a.lane - b.lane);
        N.forEach((n, i) => { n.id = i; });
      }
      // visual length of each tile (ms): a fixed tile height, shortened so tiles in a lane never overlap
      const tileMs = (G.Ht || 0.15) / (G.travel || 1.45) * LOOKMS;
      const sepMs = (0.022 / 1.45) * LOOKMS, minMs = (0.04 / 1.45) * LOOKMS;
      const nextT = new Array(L).fill(Infinity);
      for (let i = N.length - 1; i >= 0; i--) {
        const n = N[i];
        n._h = n.dur > 0 ? n.dur : Math.max(minMs, Math.min(tileMs, nextT[n.lane] - n.t - sepMs));
        nextT[n.lane] = n.t;
      }
      down = new Set(R.analysis?.downbeats || []);
      if (G.r) placeNotes();
    });
    let down = new Set();

    // ------------------------------------------------------------ input
    const pressers = Array.from({ length: L }, () => new Set());
    const laneHold = new Array(L).fill(null);
    const ptrLane = new Map();
    const padK = new Float32Array(L), flashK = new Float32Array(L), flashCol = new Array(L).fill('#fff');
    const fx = [];
    let T = 0, sparkT = 0, emptyT = new Float32Array(L);

    function press(lane, src, t = R.now()) {
      pressers[lane].add(src);
      padK[lane] = 1;
      const W = R.windows.good;
      let n = null;
      for (const m of R.window(t - W - 1, t + W + 1)) if (m.lane === lane && !m.done) { n = m; break; }
      if (!n) { emptyT[lane] = 1; return null; }
      const label = R.hit(n, t);
      if (!label) return null;
      judged(n, label);
      if (label !== 'miss' && n.dur > 0 && n.holding) laneHold[lane] = n;
      return label;
    }
    function lift(lane, src, t = R.now()) {
      const s = pressers[lane];
      s.delete(src);
      if (s.size) return;
      const n = laneHold[lane];
      if (n && n.holding) { R.release(n, t); holdEnded(lane); }
    }
    function judged(n, label) {
      if (label === 'miss') { missFx(n); return; }
      const col = colorOf(n);
      fx.push({ k: 'ghost', lane: n.lane, col, t0: T, perfect: label === 'perfect' });
      fx.push({ k: 'ripple', lane: n.lane, col, t0: T, big: label === 'perfect' });
      flashK[n.lane] = label === 'perfect' ? 1 : label === 'great' ? 0.8 : 0.55; flashCol[n.lane] = col;
      g.draw.burst(laneX(n.lane, G.hitY), G.hitY, col, label === 'perfect' ? 9 : 5, G.r * 0.42, G.r * 0.009);
      if (R.combo > 0 && R.combo % 50 === 0) { g.sfx('score'); fx.push({ k: 'wave', t0: T }); }
      trimFx();
    }
    function missFx(n) {
      if (n._mt != null) return;
      n._mt = T;
      flashK[n.lane] = 1; flashCol[n.lane] = P.miss;
      if (D >= 2) g.vibrate(20);
    }
    function holdEnded(lane) {
      const n = laneHold[lane];
      if (!n || n.holding) return;
      laneHold[lane] = null;
      const x = laneX(lane, G.hitY);
      if (n.held) {
        fx.push({ k: 'ghost', lane, col: P.hold, t0: T, perfect: true });
        fx.push({ k: 'ripple', lane, col: P.hold, t0: T, big: true });
        g.draw.burst(x, G.hitY, P.hold, 10, G.r * 0.45, G.r * 0.009);
        R.popup('HOLD', n.x, n.y - G.r * 0.08, judgeColor('hold'));
      } else if (n.dropped) {
        n._dt = T;
        R.popup('DROP', n.x, n.y - G.r * 0.08, THEME.danger);
      }
      trimFx();
    }
    const trimFx = () => { while (fx.length > 40) fx.shift(); };

    g.on('down', (e) => {
      const lane = laneAt(e.x, e.y);
      ptrLane.set(e.id, lane);
      press(lane, `p${e.id}`);
    });
    g.on('up', (e) => {
      const lane = ptrLane.get(e.id);
      if (lane == null) return;
      ptrLane.delete(e.id);
      lift(lane, `p${e.id}`);
    });
    g.on('key', (e) => {
      if (e.repeat) return;
      const k = String(e.key).toLowerCase(), lane = KEYS[L][k];
      if (lane != null) press(lane, `k${k}`);
    });
    g.on('keyup', (e) => {
      const k = String(e.key).toLowerCase(), lane = KEYS[L][k];
      if (lane != null) lift(lane, `k${k}`);
    });
    g.on('resize', () => geom());

    // ------------------------------------------------------------ the music: beats & energy
    let bi = 0;
    function beatPulse(now) {
      const B = R.chart?.beats;
      if (!B || B.length < 2 || now < B[0]) return 0;
      while (bi + 1 < B.length && B[bi + 1] <= now) bi++;
      while (bi > 0 && B[bi] > now) bi--;
      const per = (bi + 1 < B.length ? B[bi + 1] : B[bi] + (B[1] - B[0])) - B[bi];
      const k = clamp(1 - (now - B[bi]) / Math.max(1, per), 0, 1);
      return k * k * k * (down.has(bi) ? 1 : 0.6);
    }
    const energyAt = (now) => { const E = R.analysis?.energy; return E?.length ? clamp(E[Math.max(0, Math.floor(now / 250))] ?? 0.4, 0, 1) : 0.5; };

    // ------------------------------------------------------------ drawing
    function drawBeatLines(now) {
      const B = R.chart?.beats;
      if (!B) return;
      const { ctx } = g;
      ctx.lineWidth = Math.max(1, G.r * 0.003);
      for (let j = Math.max(0, bi - 2); j < B.length && B[j] <= now + LOOKMS; j++) {
        const y = yOf(B[j], now);
        if (y > G.hitY - 2 || y < G.fadeA) continue;
        const w = wAt(y) - G.gap, a = clamp((y - G.fadeA) / (G.fadeB - G.fadeA), 0, 1);
        ctx.strokeStyle = THEME.ink((down.has(j) ? 0.13 : 0.055) * a);
        ctx.beginPath(); ctx.moveTo(G.cx - w, y); ctx.lineTo(G.cx + w, y); ctx.stroke();
      }
    }

    function drawLanes(dt, pulse) {
      const { ctx } = g, r = G.r;
      for (let l = 0; l < L; l++) {
        const held = pressers[l].size > 0;
        padK[l] = held ? 1 : Math.max(0, padK[l] - dt * 7);
        flashK[l] = Math.max(0, flashK[l] - dt * 3.2);
        emptyT[l] = Math.max(0, emptyT[l] - dt * 5);
        // the column lights up from the line after a hit (red after a miss)
        if (flashK[l] > 0.01) {
          const k = flashK[l], top = THEME.flat ? G.hitY - G.Ht : G.hitY - r * (0.25 + 0.3 * k);
          tilePath(ctx, l, G.hitY, top, G.rad, THEME.flat ? 0 : -G.insetF);
          if (THEME.flat) ctx.fillStyle = g.draw.alpha(flashCol[l], 0.3 * k);
          else {
            const gr = ctx.createLinearGradient(0, G.hitY, 0, top);
            gr.addColorStop(0, g.draw.alpha(flashCol[l], 0.32 * k)); gr.addColorStop(1, g.draw.alpha(flashCol[l], 0));
            ctx.fillStyle = gr;
          }
          ctx.fill();
        }
        // pressed pad
        const pk = Math.max(padK[l] * 0.6, laneHold[l]?.holding ? 1 : 0);
        if (pk > 0.01) {
          tilePath(ctx, l, G.cy + r * 1.2, G.hitY + r * 0.022);
          ctx.fillStyle = laneHold[l]?.holding ? g.draw.alpha(P.hold, 0.22) : THEME.ink(0.09 * pk);
          ctx.fill();
        }
        // the slot each tile lands in
        tilePath(ctx, l, G.hitY, G.hitY - G.Ht);
        ctx.fillStyle = THEME.ink(0.025 + 0.05 * padK[l] + 0.03 * pulse);
        ctx.fill();
        ctx.strokeStyle = THEME.ink(0.1 + 0.08 * pulse + 0.15 * emptyT[l]);
        ctx.lineWidth = Math.max(1, r * 0.004);
        ctx.stroke();
      }
    }

    function drawHitLine(pulse) {
      const { ctx } = g, r = G.r;
      const lvl = clamp(R.combo / 50, 0, 1);
      const x0 = G.cx - G.Wh, x1 = G.cx + G.Wh, y = G.hitY;
      ctx.save();
      ctx.lineCap = 'round';
      // field edges: glow with the combo streak, red when health runs low (Hard and up)
      const danger = D >= 2 && R.health < 0.3 ? 0.5 + 0.5 * Math.sin(T * 9) : 0;
      if (outline && (lvl > 0.05 || danger > 0)) {
        ctx.strokeStyle = danger > 0 ? g.draw.alpha(THEME.danger, 0.25 + 0.35 * danger) : g.draw.alpha(P.tap, (0.12 + 0.4 * lvl) * (0.65 + 0.35 * pulse));
        ctx.lineWidth = r * (0.006 + 0.004 * lvl);
        ctx.stroke(outline);
      }
      // the line itself (thickens on the beat)
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.strokeStyle = THEME.ink(0.42 + 0.25 * pulse);
      ctx.lineWidth = r * (0.009 + 0.006 * pulse);
      ctx.stroke();
      if (lvl > 0.05) {
        ctx.strokeStyle = g.draw.alpha(P.tap, lvl * (0.7 + 0.3 * pulse));
        if (THEME.glow) { ctx.shadowColor = P.tap; ctx.shadowBlur = r * (0.02 + 0.04 * lvl); }
        ctx.lineWidth = r * (0.01 + 0.006 * pulse);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawTile(n, now, alpha) {
      const { ctx } = g, r = G.r;
      const yb = yOf(n.t, now);
      let yt = Math.max(yOf(n.t + n._h, now), G.yTop + 0.5);
      if (yb - yt < 1) yt = yb - 1;
      const l = n.lane;
      ctx.globalAlpha = alpha;
      if (n.judged === 'miss') {
        // a missed tile flashes red and fades out as it falls away
        const k = clamp((T - (n._mt ?? T)) / 0.6, 0, 1);
        ctx.globalAlpha = alpha * (1 - k) * (k < 0.12 ? 1 : 0.75);
        tilePath(ctx, l, yb, yt);
        ctx.fillStyle = k < 0.12 ? P.miss : g.draw.alpha(P.miss, 0.55);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      if (n.dur > 0) {
        const dropped = n.dropped;
        const col = dropped ? THEME.ink(0.3) : P.hold;
        if (dropped) ctx.globalAlpha = alpha * clamp(1 - (T - (n._dt ?? T)) / 0.8, 0.25, 1);
        // body: translucent with a solid edge
        tilePath(ctx, l, yb, yt);
        ctx.fillStyle = dropped ? THEME.ink(0.1) : g.draw.alpha(P.hold, THEME.light ? 0.22 : 0.26);
        ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, r * 0.007); ctx.stroke();
        // spine
        const headH = Math.min(G.Ht * 0.55, (yb - yt) * 0.5);
        if (yb - headH - yt > r * 0.03) {
          ctx.beginPath();
          sidePath(ctx, fOf(l) + 1 / L, yb - headH, yt + r * 0.02);
          ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, r * 0.011); ctx.lineCap = 'round';
          ctx.stroke();
        }
        if (n.holding) {
          // the fill runs up the tile while it is held: everything that has passed the line
          const fb = yb, ft = Math.max(yt, G.hitY);
          if (fb > ft) {
            tilePath(ctx, l, fb, ft);
            ctx.fillStyle = P.holdFill; ctx.fill();
            // bright cap riding on the line
            ctx.save();
            if (THEME.glow) { ctx.shadowColor = P.hold; ctx.shadowBlur = r * 0.04; }
            tilePath(ctx, l, G.hitY + r * 0.012, G.hitY - r * 0.012, r * 0.01, -G.insetF * 0.5);
            ctx.fillStyle = P.holdFill; ctx.fill();
            ctx.restore();
          }
        } else if (!dropped) {
          tilePath(ctx, l, yb, yb - headH);
          ctx.fillStyle = P.hold; ctx.fill();
          lip(l, yb, alpha);
        }
        // end cap
        tilePath(ctx, l, yt + r * 0.016, yt, r * 0.008);
        ctx.fillStyle = col; ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      const col = n.dbl ? P.dbl : P.tap;
      if (n.dbl === 1 && n.mate && !n.mate.done) {
        // the pair is joined by a bar: one double tile, two taps
        const y2 = yOf(n.mate.t, now);
        if (y2 < yt) {
          const w = wAt(Math.max(y2, G.yTop)), xm = G.cx + (fOf(l) + 1 / L) * w, bw = (G.Wh / L) * 0.34 * (w / G.Wh);
          ctx.fillStyle = g.draw.alpha(P.dbl, 0.45);
          ctx.fillRect(xm - bw, y2 - 1, bw * 2, yt - y2 + 2);
        }
      }
      tilePath(ctx, l, yb, yt);
      ctx.fillStyle = col; ctx.fill();
      lip(l, yb, alpha);
      if (n.dbl) {
        // two dots: "tap twice"
        const ym = (yb + yt) / 2, xm = laneX(l, ym), s = Math.min(r * 0.016, (yb - yt) * 0.2);
        ctx.fillStyle = P.lip;
        if (n.dbl === 1) { ctx.beginPath(); ctx.arc(xm - s * 1.6, ym, s, 0, TAU); ctx.arc(xm + s * 1.6, ym, s, 0, TAU); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(xm, ym, s, 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
    // a light lip on the bottom (landing) edge of a tile
    function lip(l, yb, alpha) {
      const { ctx } = g, r = G.r, w = wAt(yb);
      const x0 = G.cx + (fOf(l) + G.insetF) * w + G.rad * 0.9, x1 = G.cx + (fOf(l + 1) - G.insetF) * w - G.rad * 0.9;
      if (x1 <= x0) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = P.lip;
      ctx.fillRect(x0, yb - r * 0.022, x1 - x0, Math.max(1.5, r * 0.009));
    }

    function drawNotes(now) {
      const vis = R.window(now - G.below, now + LOOKMS + 40);
      for (let i = vis.length - 1; i >= 0; i--) {     // far ones first, the next tile on top
        const n = vis[i];
        if (n.judged === 'miss' && n._mt == null) missFx(n);
        if (n.held || (n.done && !n.holding && !n.dropped && n.judged !== 'miss')) continue;
        if (n.judged === 'miss' && T - n._mt > 0.6) continue;
        const yb = yOf(n.t, now);
        if (yb < G.fadeA) continue;
        const k = clamp((yb - G.fadeA) / (G.fadeB - G.fadeA), 0, 1), a = k * k;
        if (a > 0.01) drawTile(n, now, a);
      }
    }

    function drawFx(dt) {
      const { ctx } = g, r = G.r;
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i], age = T - f.t0;
        if (f.k === 'ghost') {
          const k = age / 0.24;
          if (k >= 1) { fx.splice(i, 1); continue; }
          ctx.globalAlpha = (1 - k) * (f.perfect ? 0.7 : 0.5);
          tilePath(ctx, f.lane, G.hitY, G.hitY - G.Ht * (1 + 0.35 * ease.out(k)), G.rad, G.insetF * 1.5 * ease.out(k));
          ctx.fillStyle = f.col; ctx.fill();
          ctx.globalAlpha = 1;
        } else if (f.k === 'ripple') {
          const k = age / 0.45;
          if (k >= 1) { fx.splice(i, 1); continue; }
          const half = G.Wh / L, rx = half * (0.35 + (f.big ? 1.05 : 0.8) * ease.out(k));
          ctx.globalAlpha = 1 - k;
          ctx.beginPath(); ctx.ellipse(laneX(f.lane, G.hitY), G.hitY, rx, rx * 0.26, 0, 0, TAU);
          ctx.strokeStyle = f.col; ctx.lineWidth = Math.max(1, r * 0.008 * (1 - k));
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (f.k === 'wave') {
          // every 50 in a row: a ring rolls out over the whole field
          const k = age / 0.7;
          if (k >= 1) { fx.splice(i, 1); continue; }
          ctx.globalAlpha = (1 - k) * 0.8;
          ctx.beginPath(); ctx.ellipse(G.cx, G.hitY, G.Wh * (0.2 + 1.1 * ease.out(k)), G.Wh * 0.3 * (0.2 + 1.1 * ease.out(k)), 0, 0, TAU);
          ctx.strokeStyle = P.tap; ctx.lineWidth = r * 0.012 * (1 - k) + 1; ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      // sparks while holding
      sparkT -= dt;
      if (sparkT <= 0) {
        sparkT = 0.09;
        for (let l = 0; l < L; l++) if (laneHold[l]?.holding) g.draw.burst(laneX(l, G.hitY), G.hitY, P.hold, 1, r * 0.3, r * 0.008);
      }
    }

    g.loop((dt) => {
      if (!R.drawPre(dt)) return;
      T += dt;
      if (G.r !== g.R) geom();
      ensureStatic();
      const { ctx } = g;
      const now = R.now();
      for (let l = 0; l < L; l++) if (laneHold[l] && !laneHold[l].holding) holdEnded(l);   // the kit ended a hold
      const pulse = beatPulse(now);
      g.draw.bg({ glow: 0.09 + 0.08 * energyAt(now) + 0.1 * pulse });
      ctx.drawImage(off, 0, 0, g.S, g.S);
      ctx.save();
      g.draw.clipCircle(G.r * RIM);
      drawBeatLines(now);
      drawLanes(dt, pulse);
      drawNotes(now);
      drawHitLine(pulse);
      drawFx(dt);
      ctx.restore();
      g.draw.particles(dt);
    });

    if (g.R) geom();

    return {
      ...R.handle,
      pause() {
        R.handle.pause();
        // fingers / keys lifted while the pause card is up never reach us: forget them (holds finish on their own)
        for (const s of pressers) s.clear();
        ptrLane.clear();
      },
    };
  },
};
