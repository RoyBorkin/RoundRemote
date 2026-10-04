// Pipe Link — join each pair of matching dots with a pipe; pipes may not cross and every cell must be filled.
// Endless generated puzzles (see flow-gen.js) on two board shapes: "Round" (rings × sectors around a hole that
// holds the score) and "Square" (a classic grid inscribed in the circle), each in four sizes.
// A round is a timed run: solve as many puzzles as you can before the run clock runs out. Each puzzle scores
// 100 plus a speed bonus of up to 100; holding "Skip" passes a puzzle you're stuck on (no points).
import { TAU, clamp, lerp, ease, angDiff, THEME } from './kit.js';
import { makeBoard, generate, SIZES } from './flow-gen.js';

// pipe colours: THEME.pieces first (most distinct), then a few more; null = the theme's ink colour
const COLS = ['#ff5a6a', '#ffc857', '#3ddc84', '#4d9bff', '#ff9f43', '#b57bff', '#2ee6d6', '#ff8ad8',
  '#a3e635', null, '#b07a4f', '#d6336c', '#6a6cf0', '#94a3b8'];
const SIZE_OPT = {
  id: 'size', name: 'Size', default: 'medium',
  choices: [{ id: 'small', name: 'Small' }, { id: 'medium', name: 'Medium' }, { id: 'large', name: 'Large' }, { id: 'huge', name: 'Huge' }],
};
const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const SKIP_HOLD = 0.7;     // seconds to hold "Skip"

export default {
  howTo: 'Drag from a dot to its twin to lay a pipe; link every pair and fill every cell. Pipes can’t cross — ' +
    'drawing over one cuts it. Timed run (2–6 min by size): each solved puzzle scores 100 + up to 100 for speed. ' +
    'Hold Skip to pass one.',
  modes: [
    { id: 'round', name: 'Round', options: [SIZE_OPT] },
    { id: 'square', name: 'Square', options: [SIZE_OPT] },
  ],
  scoring: 'high',
  create(g, { mode, opts = {} }) {
    const shape = mode === 'square' ? 'square' : 'round';
    const B = makeBoard(shape, opts.size || 'medium');
    const spec = B.spec, n = B.n, adj = B.adj, polar = B.type === 'polar';
    const genOpts = { minP: spec.minP, maxP: spec.maxP, budget: 120 };
    B.specId = SIZES[shape][opts.size] ? opts.size : 'medium';
    let worker = null, reqId = 0;
    try {
      worker = new Worker(new URL('./flow-gen.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => { if (e.data.id === reqId) next = e.data.pz; };
      worker.onerror = () => { worker?.terminate(); worker = null; if (!next) requestNext(); };
    } catch { worker = null; }

    // ---------- run state
    let clock = spec.run, score = 0, solved = 0, phase = 'play', phaseT = 0, lastTick = 99;
    // ---------- puzzle state
    let K = 0, ends = [], cols = [], paths = [], done = [], popT = [];
    const endK = new Int16Array(n), owner = new Int16Array(n), inActive = new Uint8Array(n), cov = new Uint8Array(n);
    let puzzleT = 0, next = null, genTimer = 0, hintT = 0, waveT = -1, filled = 0, linked = 0;
    // ---------- input state
    let drag = null, cur = 0, kb = false, skipHold = -1, tickAt = 0;
    const finger = { x: 0, y: 0, on: false, a: 0 }, loupe = { x: 0, y: 0, init: false };

    g.hud(shape === 'square');      // the round board shows its score in the middle hole
    g.score(0);

    const colOf = (k) => cols[k] || THEME.fg;
    const X = (c) => g.cx + B.x[c] * g.R, Y = (c) => g.cy + B.y[c] * g.R;
    const subText = () => `${fmtClock(clock)} · pairs ${linked}/${K} · fill ${Math.floor((filled / n) * 100)}%`;
    const isDone = (k) => { const p = paths[k]; return p.length > 1 && p[p.length - 1] !== p[0] && endK[p[p.length - 1]] === k; };

    function load(pz) {
      K = pz.pairs.length;
      ends = pz.pairs.map((p) => p.slice());
      // colours: the first K of the list, shuffled among the pairs
      const pal = COLS.slice(0, K);
      for (let i = pal.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pal[i], pal[j]] = [pal[j], pal[i]]; }
      cols = pal;
      paths = ends.map(() => []);
      done = ends.map(() => false); popT = ends.map(() => 9);
      endK.fill(-1);
      ends.forEach(([a, b], k) => { endK[a] = k; endK[b] = k; });
      puzzleT = 0; drag = null; hintT = 0; waveT = -1;
      cur = ends[0][0];
      refresh(true);
      requestNext();
    }
    /** Make the next puzzle while this one is played: in a worker if possible (a longer uniqueness check,
     *  no frame hitch), else on the main thread a moment after the board appears. */
    function requestNext() {
      clearTimeout(genTimer);
      next = null;
      if (worker) worker.postMessage({ id: ++reqId, shape, size: B.specId, budget: 450 });
      else genTimer = setTimeout(() => { next = generate(B, genOpts); }, 400);
    }
    function newPuzzle() { load(next || generate(B, genOpts)); }

    /** Rebuild ownership, link/fill counts; pop newly linked pairs (only the one being drawn makes noise). */
    function refresh(quiet = false) {
      owner.fill(-1); cov.fill(0);
      paths.forEach((p, k) => { for (const c of p) { owner[c] = k; if (p.length > 1) cov[c] = 1; } });
      ends.forEach(([a, b], k) => { owner[a] = k; owner[b] = k; });
      filled = 0; linked = 0;
      for (let c = 0; c < n; c++) filled += cov[c];
      for (let k = 0; k < K; k++) {
        const d = isDone(k);
        if (d) linked++;
        if (d && !done[k] && !quiet && (!drag || drag.k === k)) {
          popT[k] = 0;
          g.sfx('pop', { pitch: 0.8 + (k % 6) * 0.08 }); g.vibrate(10);
          for (const c of ends[k]) g.draw.burst(X(c), Y(c), colOf(k), 8, g.R * 0.25, g.R * 0.008);
        }
        done[k] = d;
      }
      g.sub(subText());
      if (phase === 'play' && linked === K && filled === n) win();
    }

    // ---------- drawing pipes
    function begin(c) {
      let k = endK[c];
      if (k >= 0) paths[k] = [c];
      else if (owner[c] >= 0) { k = owner[c]; const p = paths[k]; paths[k] = p.slice(0, p.indexOf(c) + 1); }
      else return false;
      drag = { k, base: paths.map((p) => p.slice()), kbd: false };
      g.sfx('tap', { volume: 0.6 });
      refresh();
      return true;
    }
    /** The pipes the drawn one crosses are cut back (and come back if you retreat, until you let go). */
    function applyCuts() {
      const k = drag.k;
      inActive.fill(0);
      for (const c of paths[k]) inActive[c] = 1;
      for (let j = 0; j < K; j++) {
        if (j === k) continue;
        const b = drag.base[j];
        let cut = b.length;
        for (let i = 0; i < b.length; i++) if (inActive[b[i]]) { cut = i; break; }
        paths[j] = b.slice(0, cut);
      }
      refresh();
    }
    /** Move the drawing end onto cell c (neighbour → extend, own pipe → shorten). True if the pipe changed. */
    function step(c) {
      if (!drag || c < 0) return false;
      const k = drag.k, p = paths[k], last = p[p.length - 1];
      if (c === last) return false;
      const i = p.indexOf(c);
      if (i >= 0) { paths[k] = p.slice(0, i + 1); applyCuts(); return true; }
      if (!adj[last].includes(c) || isDone(k)) return false;
      if (endK[c] >= 0 && endK[c] !== k) return false;
      // keyboard on the round board: where a wide cell meets two narrow ones, a sideways step from the cell
      // just entered swaps it for its twin (a pipe never needs to touch itself like that)
      if (drag.kbd && p.length > 1 && endK[last] < 0 && adj[p[p.length - 2]].includes(c)) p.pop();
      p.push(c);
      const now = performance.now();
      if (now - tickAt > 45) { tickAt = now; g.sfx('tick', { volume: 0.7 }); }
      applyCuts();
      return true;
    }
    /** Step towards c; a diagonal hop (finger cutting a corner) goes through the better shared neighbour. */
    function stepTo(c, px, py) {
      if (!drag) return;
      const p = paths[drag.k], last = p[p.length - 1];
      if (c === last || step(c)) return;
      if (p.includes(c)) return;
      const via = adj[last].filter((m) => adj[m].includes(c))
        .sort((a, b) => Math.hypot(X(a) - px, Y(a) - py) - Math.hypot(X(b) - px, Y(b) - py));
      for (const m of via) {
        const save = paths[drag.k].slice();
        if (step(m)) { if (!drag || step(c)) return; paths[drag.k] = save; applyCuts(); }
      }
    }
    function endDrag() {
      if (!drag) return;
      drag = null; finger.on = false;
      refresh(true);
      if (phase === 'play' && linked === K && filled < n) { hintT = 1.6; g.toast('Fill every cell', 1100); }
    }

    // ---------- solve / skip / time
    function win() {
      phase = 'solved'; phaseT = 0; drag = null; finger.on = false; waveT = 0;
      const par = n * 1.2, bonus = Math.round(100 * clamp(1 - puzzleT / par, 0, 1));
      const pts = 100 + bonus;
      score += pts; solved++;
      g.add(pts);
      g.sfx('win'); g.vibrate(30);
      g.draw.float(`+${pts}`, g.cx, g.cy + g.R * (polar ? 0.3 : 0.12), THEME.fg, g.R * 0.1);
      if (bonus >= 60) setTimeout(() => g.toast(bonus >= 85 ? 'Lightning!' : 'Quick!', 900), 250);
      for (let k = 0; k < K; k++) for (const c of ends[k]) g.draw.burst(X(c), Y(c), colOf(k), 10, g.R * 0.4, g.R * 0.01);
    }
    function skip() {
      if (phase !== 'play') return;
      g.sfx('whoosh');
      phase = 'out'; phaseT = 0; drag = null; finger.on = false;
    }
    function timeUp() {
      phase = 'over'; drag = null; finger.on = false;
      g.over(score, { title: 'Time’s up', note: `${solved} puzzle${solved === 1 ? '' : 's'} solved`, label: `${solved} solved`, win: solved > 0, delay: 1100 });
    }

    // ---------- input
    const SKIP_Y = 0.865;
    const onSkip = (p) => Math.abs(p.dx) < g.R * 0.16 && Math.abs(p.dy - g.R * SKIP_Y) < g.R * 0.06;
    g.on('down', (p) => {
      if (phase !== 'play') return;
      if (onSkip(p)) { skipHold = 0; return; }
      kb = false;
      const c = B.cellAt(p.dx / g.R, p.dy / g.R);
      if (c < 0) return;
      cur = c;
      if (begin(c)) Object.assign(finger, { x: p.x, y: p.y, on: true, a: 0 });
    });
    g.on('move', (p) => {
      if (!drag || drag.kbd) return;
      // sample the way from the last point, so a quick swipe still visits every cell on it
      const step0 = g.R * B.minCell * 0.2;
      const len = Math.hypot(p.x - finger.x, p.y - finger.y), ns = Math.max(1, Math.ceil(len / step0));
      for (let s = 1; s <= ns && drag; s++) {
        const x = lerp(finger.x, p.x, s / ns), y = lerp(finger.y, p.y, s / ns);
        const c = B.cellAt((x - g.cx) / g.R, (y - g.cy) / g.R, 0.16);   // a margin at cell edges = no flicker
        if (c >= 0) stepTo(c, x, y);
      }
      finger.x = p.x; finger.y = p.y;
      if (drag) cur = paths[drag.k][paths[drag.k].length - 1];
    });
    g.on('up', () => {
      if (skipHold >= 0) { if (skipHold < SKIP_HOLD && phase === 'play') g.toast('Hold to skip', 900); skipHold = -1; return; }
      if (drag && !drag.kbd) endDrag();
    });

    /**
     * Arrow keys → neighbours, per cell: the assignment that gives the most neighbours a key, each key pointing
     * roughly (within ~80°) the way its neighbour lies on screen. Works on both boards.
     */
    const ARROWS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const keyMap = Array.from({ length: n }, (_, c) => {
      const nb = adj[c], dots = nb.map((m) => {
        const vx = B.x[m] - B.x[c], vy = B.y[m] - B.y[c], l = Math.hypot(vx, vy) || 1;
        return ARROWS.map(([ax, ay]) => (vx * ax + vy * ay) / l);
      });
      let best = -1, bestMap = [-1, -1, -1, -1];
      const cur = [-1, -1, -1, -1];
      (function rec(i, score) {
        if (i === nb.length) { if (score > best) { best = score; bestMap = cur.slice(); } return; }
        rec(i + 1, score);                                   // this neighbour gets no key
        for (let a = 0; a < 4; a++) {
          if (cur[a] >= 0 || dots[i][a] < 0.17) continue;
          cur[a] = nb[i]; rec(i + 1, score + 2 + dots[i][a]); cur[a] = -1;
        }
      })(0, 0);
      return bestMap;
    });
    const toward = (c, dx, dy) => keyMap[c][ARROWS.findIndex(([ax, ay]) => ax === dx && ay === dy)] ?? -1;
    function moveCursor(m) {
      if (m < 0) return;
      if (drag) { step(m); if (drag) cur = paths[drag.k][paths[drag.k].length - 1]; }
      else { cur = m; g.sfx('tick', { volume: 0.5 }); }
    }
    const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    g.on('key', (e) => {
      if (phase !== 'play') return;
      if (drag && !drag.kbd) return;
      kb = true;
      const d = DIRS[e.key];
      if (d) { moveCursor(toward(cur, d[0], d[1])); return; }
      if (e.key === ' ' || e.key === 'Enter') {
        if (drag) { endDrag(); g.sfx('place', { volume: 0.6 }); } else if (begin(cur)) drag.kbd = true;
        return;
      }
      if (e.key === 'n' || e.key === 'N') skip();
    });
    g.on('wheel', (e) => {
      if (phase !== 'play' || (drag && !drag.kbd)) return;
      kb = true;
      let m;
      if (polar) { const R = B.rings[B.ring[cur]]; m = R.first + (B.sec[cur] + (e.delta > 0 ? 1 : R.S - 1)) % R.S; }
      else m = (cur + (e.delta > 0 ? 1 : n - 1)) % n;
      if (drag && !adj[paths[drag.k][paths[drag.k].length - 1]].includes(m) && !paths[drag.k].includes(m)) return;
      moveCursor(m);
    });

    // ---------- geometry caches (rebuilt when the screen size changes)
    let cache = { R: 0 };
    function shapes() {
      if (cache.R === g.R && cache.cx === g.cx) return cache;
      const R = g.R, cx = g.cx, cy = g.cy, gap = Math.max(1, R * 0.007);
      const cells = [];
      for (let c = 0; c < n; c++) {
        const p = new Path2D();
        if (polar) {
          const Rg = B.rings[B.ring[c]], j = B.sec[c];
          const r0 = Rg.r0 * R + gap, r1 = Rg.r1 * R - gap;
          const a0 = (j / Rg.S) * TAU - Math.PI / 2, a1 = ((j + 1) / Rg.S) * TAU - Math.PI / 2;
          p.arc(cx, cy, r1, a0 + gap / r1, a1 - gap / r1);
          p.arc(cx, cy, r0, a1 - gap / r0, a0 + gap / r0, true);
          p.closePath();
        } else {
          const s = B.cs * R;
          p.roundRect(cx + (B.x0 + B.col[c] * B.cs) * R + gap, cy + (B.y0 + B.row[c] * B.cs) * R + gap, s - 2 * gap, s - 2 * gap, s * 0.16);
        }
        cells.push(p);
      }
      cache = { R, cx, cy, cells, dotR: B.minCell * R * 0.36, pipeW: B.minCell * R * 0.34 };
      return cache;
    }

    /**
     * Polar pipes run along arcs (around a ring) and radials (between rings). A wide cell (next to a ring with
     * twice the sectors) is crossed at the angle of its denser-ring neighbour on the path, so a pipe that turns
     * there takes a clean corner instead of doubling back through the cell's centre.
     */
    const wpA = new Float64Array(n);
    function tracePipe(ctx, p) {
      ctx.moveTo(X(p[0]), Y(p[0]));
      if (!polar) { for (let i = 1; i < p.length; i++) ctx.lineTo(X(p[i]), Y(p[i])); return; }
      const PI2 = Math.PI / 2, ox = g.cx, oy = g.cy, R = g.R;
      for (let i = 0; i < p.length; i++) {
        const c = p[i], S = B.rings[B.ring[c]].S;
        wpA[i] = B.ang[c];
        if (i === 0 || i === p.length - 1) continue;
        const a = p[i - 1], b = p[i + 1];
        const da = B.rings[B.ring[a]].S > S, db = B.rings[B.ring[b]].S > S;
        if (da !== db) wpA[i] = B.ang[da ? a : b];
      }
      const arcTo = (r, a0, a1) => { const d = angDiff(a0, a1); if (Math.abs(d) > 1e-6) ctx.arc(ox, oy, r, a0 - PI2, a0 + d - PI2, d < 0); };
      const radTo = (a, r) => ctx.lineTo(ox + Math.sin(a) * r, oy - Math.cos(a) * r);
      for (let i = 1; i < p.length; i++) {
        const u = p[i - 1], v = p[i], au = wpA[i - 1], av = wpA[i], ru = B.rad[u] * R, rv = B.rad[v] * R;
        if (B.ring[u] === B.ring[v]) { arcTo(ru, au, av); continue; }
        // between rings: turn inside the wider cell (an arc at its radius), go radially at the narrow one's angle
        if (B.rings[B.ring[u]].S <= B.rings[B.ring[v]].S) { arcTo(ru, au, av); radTo(av, rv); }
        else { radTo(au, rv); arcTo(rv, au, av); }
      }
    }

    /** The whole board (cells, pipes, dots). Also used, magnified, for the loupe. */
    function drawBoard(ctx, t, { loupeView = false } = {}) {
      const S = shapes(), A = g.draw.alpha;
      // cells: glass when empty, a tint of the pipe colour when filled
      const pulse = hintT > 0 ? 0.5 + 0.5 * Math.sin(t * 12) : 0;
      for (let c = 0; c < n; c++) {
        const k = owner[c];
        let f;
        if (cov[c]) f = A(colOf(k), THEME.light ? 0.2 : 0.17);
        else f = hintT > 0 && endK[c] < 0 ? A(THEME.danger, 0.08 + 0.16 * pulse * Math.min(1, hintT)) : THEME.ink(THEME.light ? 0.07 : 0.06);
        if (waveT >= 0) {
          const dd = Math.hypot(B.x[c], B.y[c]), w = clamp(1 - Math.abs(waveT * 2.2 - dd * 2.4) * 2.2, 0, 1);
          if (w > 0 && cov[c]) f = A(colOf(k), 0.17 + 0.4 * w);
        }
        ctx.fillStyle = f; ctx.fill(S.cells[c]);
      }
      // pipes
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let k = 0; k < K; k++) {
        const p = paths[k];
        if (p.length < 2) continue;
        ctx.save();
        const active = drag && drag.k === k && !loupeView;
        if (active && THEME.glow) { ctx.shadowColor = colOf(k); ctx.shadowBlur = g.R * 0.035; }
        ctx.beginPath(); tracePipe(ctx, p);
        ctx.strokeStyle = colOf(k); ctx.lineWidth = S.pipeW * (done[k] ? 1 : 0.9); ctx.stroke();
        ctx.restore();
      }
      // dots
      for (let k = 0; k < K; k++) {
        const col = colOf(k), pt = popT[k], pop = pt < 0.45 ? 1 + 0.35 * Math.sin((pt / 0.45) * Math.PI) : 1;
        for (const c of ends[k]) {
          const x = X(c), y = Y(c);
          let r = S.dotR * pop;
          if (waveT >= 0) { const dd = Math.hypot(B.x[c], B.y[c]); r *= 1 + 0.25 * clamp(1 - Math.abs(waveT * 2.2 - dd * 2.4) * 2, 0, 1); }
          if (done[k]) g.draw.circle(x, y, r * 1.38, null, { stroke: A(col, 0.55), lw: Math.max(1.5, g.R * 0.007) });
          g.draw.ball(x, y, r, col);
          if (THEME.light) g.draw.circle(x, y, r, null, { stroke: 'rgba(0,0,0,.28)', lw: Math.max(1, g.R * 0.005) });
        }
      }
      // the drawing end
      if (drag) {
        const p = paths[drag.k], h = p[p.length - 1];
        if (endK[h] < 0) g.draw.ball(X(h), Y(h), S.pipeW * 0.75, colOf(drag.k));
      }
    }

    function drawLoupe(ctx, t) {
      const S = shapes(), Lr = g.R * 0.15, mag = 1.75, off = g.R * 0.29;
      const fx = finger.x, fy = finger.y;
      // place it next to the finger, preferring above, always inside the screen
      let tx = fx, ty = fy - off;
      for (const a of [0, -0.6, 0.6, -1.2, 1.2, -1.9, 1.9, Math.PI]) {
        const x = fx + Math.sin(a) * off, y = fy - Math.cos(a) * off;
        if (Math.hypot(x - g.cx, y - g.cy) + Lr < g.R * 0.93) { tx = x; ty = y; break; }
      }
      if (!loupe.init) { loupe.x = tx; loupe.y = ty; loupe.init = true; }
      loupe.x = lerp(loupe.x, tx, 0.3); loupe.y = lerp(loupe.y, ty, 0.3);
      const k = clamp(finger.a / 0.15, 0, 1);
      if (k <= 0) return;
      const lx = loupe.x, ly = loupe.y, rr = Lr * (0.6 + 0.4 * ease.out(k));
      ctx.save();
      ctx.globalAlpha = k;
      ctx.beginPath(); ctx.arc(lx, ly, rr, 0, TAU);
      ctx.fillStyle = THEME.bg; ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.translate(lx, ly); ctx.scale(mag, mag); ctx.translate(-fx, -fy);
      drawBoard(ctx, t, { loupeView: true });
      ctx.restore();
      // crosshair = where the finger is
      g.draw.circle(lx, ly, S.pipeW * mag * 0.5, null, { stroke: THEME.ink(0.8), lw: 1.5 });
      ctx.beginPath(); ctx.arc(lx, ly, rr, 0, TAU);
      ctx.strokeStyle = drag ? colOf(drag.k) : THEME.line; ctx.lineWidth = Math.max(2, g.R * 0.01); ctx.stroke();
      ctx.restore();
    }

    function drawHud(t) {
      const { ctx, cx, cy, R } = g;
      const low = clock < 15;
      // run clock around the rim
      const frac = clamp(clock / spec.run, 0, 1);
      const rimCol = low ? THEME.danger : g.color;
      g.draw.arc(cx, cy, R * 0.948, 0, TAU, THEME.ink(0.08), Math.max(2, R * 0.012));
      if (frac > 0) g.draw.arc(cx, cy, R * 0.948, 0, frac * TAU, rimCol, Math.max(2, R * 0.012), { glow: low ? R * 0.03 : 0 });
      if (polar) {
        // score, clock and progress in the middle hole
        const blink = low && phase === 'play' ? 0.55 + 0.45 * Math.cos(t * 8) : 1;
        g.draw.text(Math.round(g.scoreValue).toLocaleString(), cx, cy - R * 0.07, R * 0.1, { color: THEME.fg, glow: R * 0.03 });
        g.draw.text(fmtClock(clock), cx, cy + R * 0.025, R * 0.058, { color: low ? THEME.danger : THEME.muted, alpha: blink, weight: 600 });
        g.draw.text(`pairs ${linked}/${K}`, cx, cy + R * 0.088, R * 0.036, { color: THEME.dim, weight: 700, font: THEME.font });
        g.draw.text(`fill ${Math.floor((filled / n) * 100)}%`, cx, cy + R * 0.132, R * 0.036, { color: THEME.dim, weight: 700, font: THEME.font });
      }
      // skip pill at the bottom
      if (phase === 'play' || phase === 'out') {
        const w = R * 0.25, h = R * 0.078, x = cx - w / 2, y = cy + R * SKIP_Y - h / 2;
        g.draw.roundRect(x, y, w, h, h / 2, THEME.ink(0.08), { stroke: THEME.line, lw: 1 });
        if (skipHold > 0) g.draw.roundRect(x, y, Math.max(h, w * clamp(skipHold / SKIP_HOLD, 0, 1)), h, h / 2, g.draw.alpha(g.color, 0.45));
        g.draw.text('Skip ›', cx, cy + R * SKIP_Y + 1, R * 0.04, { color: THEME.muted, weight: 700 });
      }
    }

    // ---------- go
    load(generate(B, genOpts));
    g.toast(polar ? 'Link the dots — fill the ring' : 'Link the dots — fill the grid', 1500);

    g.loop((dt, t) => {
      const { ctx, cx, cy } = g;
      // ---- update
      for (let k = 0; k < K; k++) popT[k] += dt;
      if (hintT > 0) hintT -= dt;
      if (finger.on) finger.a += dt;
      if (skipHold >= 0 && phase === 'play') { skipHold += dt; if (skipHold >= SKIP_HOLD) { skipHold = -1; skip(); } }
      if (phase === 'play') {
        puzzleT += dt; clock -= dt;
        if (clock <= 10 && Math.ceil(clock) !== lastTick && clock > 0) { lastTick = Math.ceil(clock); g.sfx('tick'); }
        if (clock <= 0) { clock = 0; timeUp(); }
        else if (Math.floor(clock + dt) !== Math.floor(clock)) g.sub(subText());
      } else phaseT += dt;
      if (waveT >= 0) waveT += dt;
      if (phase === 'solved' && phaseT > 1.25) { phase = 'out'; phaseT = 0.0001; }
      if (phase === 'out' && phaseT > 0.28) { newPuzzle(); phase = 'in'; phaseT = 0; }
      if (phase === 'in' && phaseT > 0.32) { phase = 'play'; phaseT = 0; }

      // ---- draw
      g.draw.bg({ glow: 0.12 });
      let sc = 1, al = 1;
      if (phase === 'out') { const k = ease.inOut(clamp(phaseT / 0.28, 0, 1)); sc = 1 - 0.08 * k; al = 1 - k; }
      if (phase === 'in') { const k = ease.out(clamp(phaseT / 0.32, 0, 1)); sc = 1.06 - 0.06 * k; al = k; }
      ctx.save();
      ctx.globalAlpha = al;
      ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
      drawBoard(ctx, t);
      // keyboard cursor
      if (kb && phase === 'play') {
        const S = shapes();
        ctx.save();
        ctx.lineWidth = Math.max(2, g.R * 0.009); ctx.strokeStyle = drag ? colOf(drag.k) : THEME.fg;
        ctx.globalAlpha = al * (0.65 + 0.35 * Math.sin(t * 6));
        ctx.stroke(S.cells[cur]);
        ctx.restore();
      }
      ctx.restore();
      // under the finger: a soft disc in the pipe's colour, and the loupe beside it
      if (drag && !drag.kbd && finger.on) {
        g.draw.circle(finger.x, finger.y, g.R * 0.1, g.draw.alpha(colOf(drag.k), 0.2), { stroke: g.draw.alpha(colOf(drag.k), 0.5), lw: 2 });
        drawLoupe(ctx, t);
      } else loupe.init = false;
      drawHud(t);
      g.draw.particles(dt);
      g.draw.floaters(dt);
    });

    return {
      destroy() { clearTimeout(genTimer); worker?.terminate(); worker = null; },
    };
  },
};
