// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Rush Hour — the sliding-block traffic puzzle on a 6×6 board. Cars (2 cells) and trucks (3 cells) only slide
// along their own direction; get the red car out through the gate on the right of the third row.
// Four packs of 12 generated levels (see rushhour-levels.js). A round = a run through one pack: pick levels
// from the ring, solve them, collect points (100 × optimal / moves + a small time bonus, best per level)
// and finish the run from the picker — or by solving the pack's last level.
import { TAU, clamp, ease, THEME } from './kit.js';
import { PACKS } from './rushhour-levels.js';

const KEY = 'rr.rushhour.v1';
const loadProg = () => { try { const p = JSON.parse(localStorage.getItem(KEY) || '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; } };
const saveProg = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };

const PACK_COL = { beginner: '#3ddc84', intermediate: '#ffc857', advanced: '#4d9bff', expert: '#b57bff' };
// vehicle colours (THEME.pieces without its red, so the red car stays unique) + two extra calm tones
const CARS = ['#ffc857', '#3ddc84', '#4d9bff', '#b57bff', '#ff8ad8', '#2ee6d6', '#ff9f43', '#a3e635', '#94a3b8'];
const STAR = '#ffc857';
const starText = () => (THEME.light ? '#b97d00' : STAR);   // gold text needs more weight on a light background
const N = 6, EXIT_ROW = 2;
const RING_A0 = 40;      // the level ring leaves the top (score, pause) free: levels sit from 40° to 320°

/** '36-char row-major string' → vehicles (red car 'A' first) and walls. */
function parseLevel(str) {
  const cells = new Map(), walls = [];
  for (let i = 0; i < 36; i++) {
    const ch = str[i];
    if (ch === 'o' || ch === '.') continue;
    if (ch === 'x') { walls.push(i); continue; }
    if (!cells.has(ch)) cells.set(ch, []);
    cells.get(ch).push(i);
  }
  const vs = [...cells.entries()].map(([id, cs]) => {
    const h = cs[1] - cs[0] === 1, r = Math.floor(cs[0] / 6), c = cs[0] % 6;
    return { id, h, len: cs.length, fix: h ? r : c, pos: h ? c : r };
  }).sort((a, b) => (a.id === 'A' ? -1 : b.id === 'A' ? 1 : a.id < b.id ? -1 : 1));
  return { vs, walls };
}
const cellsOf = (v, pos = v.pos) => Array.from({ length: v.len }, (_, k) => (v.h ? v.fix * 6 + pos + k : (pos + k) * 6 + v.fix));

/** Colour the vehicles so that touching ones differ (deterministic per level). */
function paint(vs, seed) {
  const owner = new Array(36).fill(-1);
  vs.forEach((v, i) => cellsOf(v).forEach((c) => { owner[c] = i; }));
  const used = new Array(CARS.length).fill(0);
  vs.forEach((v, i) => {
    if (i === 0) return;
    const near = new Set();
    for (const c of cellsOf(v)) {
      const r = Math.floor(c / 6), q = c % 6;
      for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) {
        const rr = r + dr, qq = q + dq;
        if (rr < 0 || rr > 5 || qq < 0 || qq > 5) continue;
        const o = owner[rr * 6 + qq];
        if (o > 0 && o !== i && vs[o].col) near.add(vs[o].col);
      }
    }
    let best = -1;
    for (let k = 0; k < CARS.length; k++) {
      const j = (k + seed + i * 3) % CARS.length;
      if (near.has(CARS[j])) continue;
      if (best < 0 || used[j] < used[best]) best = j;
    }
    if (best < 0) best = (seed + i) % CARS.length;
    used[best]++; v.col = CARS[best];
  });
}

export default {
  howTo: 'Slide the cars and trucks along their lanes to get the red car out through the gate. Fewer moves = more stars.',
  modes: [
    { id: 'beginner', name: 'Beginner' },
    { id: 'intermediate', name: 'Intermediate' },
    { id: 'advanced', name: 'Advanced' },
    { id: 'expert', name: 'Expert' },
  ],
  scoring: 'high',
  unit: 'pts',
  create(g, { mode }) {
    const { ctx } = g;
    const draw = g.draw;
    const pack = PACKS.find((p) => p.id === mode) || PACKS[0];
    const PC = PACK_COL[pack.id] || g.color;
    const NL = pack.levels.length;
    let prog = loadProg();
    const pp = () => (prog[pack.id] ||= {});
    const solvedEver = (i) => !!pp()[i];
    const unlocked = (i) => i === 0 || solvedEver(i - 1) || solvedEver(i);

    // ---- run state ----
    const run = new Map();          // level → { pts, stars, moves } (best this run)
    let total = 0;
    let scene = 'pick';             // pick | play | exit | solved
    let sceneT = 0;
    let sel = 0;                    // picker selection (0…NL-1, NL = Finish run)
    let shake = { i: -1, t: 0 };
    // ---- level state ----
    let lv = -1, opt = 0, vs = [], walls = [], hist = [], moves = 0, lvTime = 0;
    let drag = null, kSel = 0, kSelShow = 0, solvedInfo = null, ended = false, autoEnd = -1;
    let pressed = null;
    const btns = [];

    const L = {};
    function layout() {
      const R = g.R;
      L.c = R * 0.183;
      L.bcx = g.cx; L.bcy = g.cy + R * 0.06;
      L.x0 = L.bcx - 3 * L.c; L.y0 = L.bcy - 3 * L.c;
      L.pad = R * 0.03;
      L.btnY = g.cy + R * 0.765; L.btnR = R * 0.085;
      L.ringR = R * 0.655; L.bubR = R * 0.128;
    }
    layout();
    g.on('resize', layout);

    const firstOpen = () => { for (let i = 0; i < NL; i++) if (unlocked(i) && !solvedEver(i)) return i; return 0; };
    sel = firstOpen();
    g.score(0);
    toPicker(true);

    function toPicker(first = false) {
      scene = 'pick'; sceneT = 0; drag = null; solvedInfo = null;
      if (!first && lv >= 0) sel = clamp(lv + (solvedEver(lv) && lv + 1 < NL && unlocked(lv + 1) ? 1 : 0), 0, NL - 1);
      g.sub('');
    }
    function startLevel(i) {
      lv = i;
      const [str, o] = pack.levels[i];
      const p = parseLevel(str);
      vs = p.vs; walls = p.walls; opt = o;
      paint(vs, i * 5 + pack.id.length);
      vs.forEach((v, k) => {
        v.x = v.pos; v.k = k;
        v.ang = v.h ? (k === 0 || v.id.charCodeAt(0) % 2 ? 0 : Math.PI) : (v.id.charCodeAt(0) % 2 ? Math.PI / 2 : -Math.PI / 2);
      });
      hist = []; moves = 0; lvTime = 0; drag = null; kSel = 0; kSelShow = 0; solvedInfo = null;
      scene = 'play'; sceneT = 0;
      updSub();
      g.sfx('pop');
    }
    function updSub() { g.sub(`Level ${lv + 1}  ·  Moves ${moves}  ·  Best ${opt}`); }

    // ---- board logic ----
    function occupancy(except = -1) {
      const occ = new Int8Array(36).fill(-1);
      for (const w of walls) occ[w] = 99;
      vs.forEach((v, i) => { if (i !== except) for (const c of cellsOf(v)) occ[c] = i; });
      return occ;
    }
    function range(i) {
      const v = vs[i], occ = occupancy(i);
      const at = (q) => (v.h ? v.fix * 6 + q : q * 6 + v.fix);
      let lo = v.pos, hi = v.pos;
      while (lo - 1 >= 0 && occ[at(lo - 1)] === -1) lo--;
      while (hi + v.len < N && occ[at(hi + v.len)] === -1) hi++;
      return [lo, hi];
    }
    function commit(i, from, to) {
      if (from === to) return;
      const last = hist[hist.length - 1];
      if (last && last.v === i) { last.to = to; if (last.to === last.from) hist.pop(); }   // same vehicle again = still one move
      else hist.push({ v: i, from, to });
      moves = hist.length;
      updSub();
      g.sfx('place', { pitch: 0.9 + Math.random() * 0.2, volume: 0.8 });
      if (i === 0 && vs[0].pos === N - 2) win();
    }
    function undo() {
      if (scene !== 'play' || drag) return;
      const h = hist.pop();
      if (!h) { g.sfx('tick'); return; }
      vs[h.v].pos = h.from; moves = hist.length; kSel = h.v;
      updSub(); g.sfx('drop', { volume: 0.7 });
    }
    function restart() {
      if (scene !== 'play' || drag) return;
      if (!hist.length) { g.sfx('tick'); return; }
      const p = parseLevel(pack.levels[lv][0]);
      p.vs.forEach((pv, k) => { vs[k].pos = pv.pos; });
      hist = []; moves = 0; updSub();
      g.sfx('whoosh');
    }
    function win() {
      scene = 'exit'; sceneT = 0; drag = null;
      const stars = moves <= opt ? 3 : moves <= Math.ceil(opt * 1.5) ? 2 : 1;
      const bonus = Math.round(25 * clamp(1 - lvTime / (10 + opt * 5), 0, 1));
      const pts = Math.round(100 * opt / Math.max(moves, opt)) + bonus;
      const prev = run.get(lv);
      const gain = prev ? Math.max(0, pts - prev.pts) : pts;
      if (!prev || pts > prev.pts) run.set(lv, { pts, stars: Math.max(stars, prev?.stars || 0), moves });
      else if (stars > prev.stars) prev.stars = stars;
      const old = pp()[lv];
      const newBest = !!old && moves < old.m;      // beat your own earlier best on this level
      pp()[lv] = { m: Math.min(moves, old?.m ?? 999), s: Math.max(stars, old?.s || 0) };
      saveProg(prog);
      solvedInfo = { stars, pts, gain, bonus, newBest, last: lv === NL - 1 };
      g.sfx('whoosh'); g.vibrate(25);
      const gy = L.y0 + (EXIT_ROW + 0.5) * L.c;
      draw.burst(L.x0 + 6 * L.c, gy, g.color, 18, g.R * 0.6, g.R * 0.013);
    }
    function showSolved() {
      scene = 'solved'; sceneT = 0;
      const s = solvedInfo;
      if (s.gain > 0) { total += s.gain; g.add(s.gain); }
      g.sfx(s.stars === 3 ? 'perfect' : 'win');
      for (let k = 0; k < 3; k++) draw.burst(L.bcx + (k - 1) * g.R * 0.22, L.bcy - g.R * 0.1, k < s.stars ? STAR : THEME.ink(0.4), 10, g.R * 0.35, g.R * 0.01);
      if (s.last) autoEnd = 3.2;
    }
    function finishRun(complete = false) {
      if (ended) return;
      ended = true;
      const n = run.size;
      let st = 0; for (const r of run.values()) st += r.stars;
      g.sub('');
      g.over(total, {
        title: complete ? 'Pack complete!' : 'Run finished',
        win: complete || n > 0,
        label: `${n} solved`,
        note: n ? `Solved ${n} level${n === 1 ? '' : 's'} · ${st} ★` : 'No level solved in this run.',
        delay: 700,
      });
    }

    // ---- input ----
    const inBtn = (b, p) => (b.w ? Math.abs(p.x - b.x) <= b.w / 2 + 6 && Math.abs(p.y - b.y) <= b.h / 2 + 6 : Math.hypot(p.x - b.x, p.y - b.y) <= b.r * 1.3);
    function vehicleAt(x, y) {
      const q = Math.floor((x - L.x0) / L.c), r = Math.floor((y - L.y0) / L.c);
      if (q < 0 || q >= N || r < 0 || r >= N) return -1;
      const cell = r * 6 + q;
      return vs.findIndex((v) => cellsOf(v).includes(cell));
    }
    g.on('down', (p) => {
      if (ended) return;
      pressed = btns.find((b) => inBtn(b, p)) || null;
      if (pressed) return;
      if (scene === 'play' && !drag) {
        let i = vehicleAt(p.x, p.y);
        if (i < 0) {   // a little forgiveness just outside the board edge
          const x = clamp(p.x, L.x0 + 1, L.x0 + 6 * L.c - 1), y = clamp(p.y, L.y0 + 1, L.y0 + 6 * L.c - 1);
          if (Math.hypot(x - p.x, y - p.y) < L.c * 0.35) i = vehicleAt(x, y);
        }
        if (i < 0) return;
        const v = vs[i];
        const [lo, hi] = range(i);
        const base = clamp(v.x, lo, hi);    // grab it where it is drawn (it may still be gliding)
        drag = { i, id: p.id, base, p0: v.h ? p.x : p.y, lo, hi, f: base };
        kSel = i;
        g.sfx('tick');
      } else if (scene === 'solved' && solvedInfo?.last && sceneT > 0.6) {
        finishRun(true);
      }
    });
    g.on('move', (p) => {
      if (!drag || p.id !== drag.id) return;
      const v = vs[drag.i];
      const d = ((v.h ? p.x : p.y) - drag.p0) / L.c;
      drag.f = clamp(drag.base + d, drag.lo, drag.hi);
    });
    g.on('up', (p) => {
      if (pressed) {
        const b = pressed; pressed = null;
        if (inBtn(b, p)) { g.sfx('click'); b.fn(); }
        return;
      }
      if (!drag || p.id !== drag.id) return;
      const i = drag.i, v = vs[i];
      const to = Math.round(drag.f);
      v.x = drag.f;
      drag = null;
      const from = v.pos;
      v.pos = to;
      commit(i, from, to);
    });

    function moveSel(dir) {   // keyboard: select the nearest vehicle in a direction
      const c = (v) => (v.h ? [v.pos + v.len / 2, v.fix + 0.5] : [v.fix + 0.5, v.pos + v.len / 2]);
      const [sx, sy] = c(vs[kSel]);
      let best = -1, bd = 1e9;
      vs.forEach((v, i) => {
        if (i === kSel) return;
        const [x, y] = c(v), dx = x - sx, dy = y - sy;
        const along = dir === 'ArrowRight' ? dx : dir === 'ArrowLeft' ? -dx : dir === 'ArrowDown' ? dy : -dy;
        const side = dir === 'ArrowRight' || dir === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
        if (along <= 0.1) return;
        const d = along + side * 2;
        if (d < bd) { bd = d; best = i; }
      });
      if (best >= 0) { kSel = best; g.sfx('tick'); }
    }
    function cycleSel(d) { kSel = (kSel + d + vs.length) % vs.length; g.sfx('tick'); }
    function stepVehicle(i, d) {
      const v = vs[i], [lo, hi] = range(i), to = clamp(v.pos + d, lo, hi);
      if (to === v.pos) { g.sfx('hit', { volume: 0.5 }); return; }
      const from = v.pos; v.pos = to; commit(i, from, to);
    }
    function pickerStep(d) { sel = (sel + d + NL + 1) % (NL + 1); g.sfx('tick'); }
    function openSel() {
      if (sel === NL) { finishRun(false); return; }
      if (!unlocked(sel)) { shake = { i: sel, t: 0.4 }; g.sfx('hit'); g.toast(`Solve level ${sel} first`, 1100); return; }
      startLevel(sel);
    }
    g.on('key', ({ key }) => {
      if (ended) return;
      if (scene === 'pick') {
        if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'Tab') pickerStep(1);
        else if (key === 'ArrowLeft' || key === 'ArrowUp') pickerStep(-1);
        else if (key === 'Enter' || key === ' ') openSel();
      } else if (scene === 'play') {
        if (drag) return;
        kSelShow = 3;
        const v = vs[kSel];
        if (key === 'Tab' || key === ' ') cycleSel(1);
        else if (key.startsWith('Arrow')) {
          const along = v.h ? (key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0) : (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0);
          if (along) stepVehicle(kSel, along); else moveSel(key);
        } else if (key === 'u' || key === 'z' || key === 'Backspace') undo();
        else if (key === 'r') restart();
        else if (key === 'l') toPicker();
      } else if (scene === 'solved' && sceneT > 0.5) {
        if (key === 'Enter' || key === ' ') { if (solvedInfo.last) finishRun(true); else startLevel(lv + 1); }
        else if (key === 'l' && !solvedInfo.last) toPicker();
      }
    });
    g.on('wheel', ({ delta }) => {
      if (scene === 'pick') pickerStep(delta);
      else if (scene === 'play' && !drag) { kSelShow = 3; cycleSel(delta); }
    });
    // keep Tab inside the game while playing (it selects vehicles / levels instead of moving the page focus)
    const onTab = (e) => {
      if (e.key !== 'Tab' || ended) return;
      const scr = g.canvas.closest('.game-screen');
      if (scr && scr.classList.contains('playing') && !scr.classList.contains('ov-on')) e.preventDefault();
    };
    window.addEventListener('keydown', onTab, true);

    // ---- drawing helpers ----
    function rr(x, y, w, h, r, fill) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); ctx.fillStyle = fill; ctx.fill(); }
    function star(x, y, r, fill, stroke) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.46 : r; ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
      ctx.closePath(); ctx.lineJoin = 'round';
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, r * 0.14); ctx.stroke(); }
    }
    function lock(x, y, s, col) {
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = s * 0.16; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y - s * 0.12, s * 0.3, Math.PI, 0); ctx.lineTo(x + s * 0.3, y + s * 0.05); ctx.moveTo(x - s * 0.3, y - s * 0.12); ctx.lineTo(x - s * 0.3, y + s * 0.05); ctx.stroke();
      rr(x - s * 0.46, y, s * 0.92, s * 0.66, s * 0.14, col);
      ctx.restore();
    }
    function pill(x, y, w, h, label, { primary = false, col = g.color, fn = null, size = h * 0.42 } = {}) {
      const down = pressed && pressed.x === x && pressed.y === y;
      const k = down ? 0.95 : 1;
      ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
      if (primary) rr(-w / 2, -h / 2, w, h, h / 2, col);
      else {
        rr(-w / 2, -h / 2, w, h, h / 2, THEME.surface);      // opaque base so the board doesn't show through
        rr(-w / 2, -h / 2, w, h, h / 2, THEME.ink(0.12));
        ctx.strokeStyle = THEME.ink(0.16); ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.restore();
      draw.text(label, x, y + 1, size, { color: primary ? '#fff' : THEME.fg, weight: 700 });
      if (fn) btns.push({ x, y, w, h, fn });
    }
    function roundBtn(x, y, r, kind, fn, enabled = true) {
      const down = pressed && pressed.x === x && pressed.y === y;
      const k = down ? 0.92 : 1;
      ctx.save(); ctx.globalAlpha = enabled ? 1 : 0.4;
      draw.circle(x, y, r * k, THEME.ink(0.075), { stroke: THEME.ink(0.14), lw: 1.5 });
      const s = r * 0.62 * k;
      ctx.strokeStyle = THEME.fg; ctx.fillStyle = THEME.fg; ctx.lineWidth = Math.max(2, r * 0.11); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const head = (x1, y1, dx, dy, sz) => {   // filled arrow head at (x1,y1) pointing along (dx,dy)
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        ctx.beginPath(); ctx.moveTo(x1 + dx * sz, y1 + dy * sz); ctx.lineTo(x1 - dy * sz * 0.8, y1 + dx * sz * 0.8); ctx.lineTo(x1 + dy * sz * 0.8, y1 - dx * sz * 0.8); ctx.closePath(); ctx.fill();
      };
      if (kind === 'undo') {
        ctx.beginPath(); ctx.moveTo(x - s * 0.42, y - s * 0.3); ctx.lineTo(x + s * 0.12, y - s * 0.3);
        ctx.arc(x + s * 0.12, y + s * 0.08, s * 0.38, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x - s * 0.3, y + s * 0.46); ctx.stroke();
        head(x - s * 0.42, y - s * 0.3, -1, 0, s * 0.3);
      } else if (kind === 'restart') {
        const rr0 = s * 0.6, a0 = -Math.PI / 2 + 0.2, a1 = a0 + TAU * 0.78;
        ctx.beginPath(); ctx.arc(x, y, rr0, a0, a1); ctx.stroke();
        head(x + Math.cos(a1) * rr0, y + Math.sin(a1) * rr0, -Math.sin(a1), Math.cos(a1), s * 0.3);
      } else if (kind === 'levels') {
        const q = s * 0.5, gp = s * 0.14;
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rr(x + (dx < 0 ? -q - gp / 2 : gp / 2), y + (dy < 0 ? -q - gp / 2 : gp / 2), q, q, q * 0.3, THEME.fg);
      }
      ctx.restore();
      if (enabled) btns.push({ x, y, r, fn });
    }

    /** One vehicle, drawn facing +x around (0,0) after the transform. */
    function vehicleShape(v, Lp, W) {
      const c = L.c, col = v.k === 0 ? g.color : v.col;
      const dark = draw.shade(col, -0.55), light = draw.shade(col, 0.22);
      const hl = Lp / 2, hw = W / 2;
      rr(-hl, -hw, Lp, W, c * 0.2, col);
      if (v.len === 2) {
        rr(-hl + c * 0.36, -hw + c * 0.13, c * 0.86, W - c * 0.26, c * 0.09, light);            // roof
        rr(hl - c * 0.64, -hw + c * 0.11, c * 0.2, W - c * 0.22, c * 0.06, dark);               // windshield
        rr(-hl + c * 0.18, -hw + c * 0.14, c * 0.13, W - c * 0.28, c * 0.05, dark);             // rear window
        rr(hl - c * 0.1, -hw + c * 0.1, c * 0.06, c * 0.14, c * 0.03, '#fff4cf');                // lights
        rr(hl - c * 0.1, hw - c * 0.24, c * 0.06, c * 0.14, c * 0.03, '#fff4cf');
        if (v.k === 0) { rr(-hl + c * 0.5, -c * 0.035, c * 0.56, c * 0.07, c * 0.03, 'rgba(255,255,255,.55)'); }
      } else {
        rr(hl - c * 0.86, -hw + c * 0.05, c * 0.8, W - c * 0.1, c * 0.14, col);                 // cab
        rr(hl - c * 0.5, -hw + c * 0.11, c * 0.2, W - c * 0.22, c * 0.06, dark);                // windshield
        rr(hl - c * 0.98, -hw + c * 0.06, c * 0.08, W - c * 0.12, c * 0.03, dark);              // gap cab / box
        rr(-hl + c * 0.08, -hw + c * 0.08, Lp - c * 1.14, W - c * 0.16, c * 0.12, light);       // cargo box
        ctx.fillStyle = draw.alpha('#000000', 0.14);
        for (let k = 1; k <= 3; k++) ctx.fillRect(-hl + c * 0.08 + (Lp - c * 1.14) * k / 4 - c * 0.015, -hw + c * 0.16, c * 0.03, W - c * 0.32);
        rr(hl - c * 0.1, -hw + c * 0.1, c * 0.06, c * 0.14, c * 0.03, '#fff4cf');
        rr(hl - c * 0.1, hw - c * 0.24, c * 0.06, c * 0.14, c * 0.03, '#fff4cf');
      }
    }
    function drawVehicle(v, i, t) {
      const c = L.c, m = c * 0.075;
      const x = drag && drag.i === i ? drag.f : v.x;
      const Lp = v.len * c - 2 * m, W = c - 2 * m;
      const px = v.h ? L.x0 + x * c + (v.len * c) / 2 : L.x0 + v.fix * c + c / 2;
      const py = v.h ? L.y0 + v.fix * c + c / 2 : L.y0 + x * c + (v.len * c) / 2;
      const ap = clamp((sceneT - i * 0.035) / 0.32, 0, 1);         // pop-in when the level opens
      const sc = scene === 'play' && sceneT < 1 ? 0.6 + 0.4 * ease.back(ap) : 1;
      ctx.save();
      ctx.globalAlpha = scene === 'play' && sceneT < 1 ? ap : 1;
      ctx.translate(px, py);
      // selection / grab: a thin white outline
      const grabbed = drag && drag.i === i;
      if (grabbed || (kSelShow > 0 && kSel === i && scene === 'play')) {
        const a = v.h ? 0 : Math.PI / 2;
        ctx.save(); ctx.rotate(a);
        ctx.beginPath(); ctx.roundRect(-Lp / 2 - 3, -W / 2 - 3, Lp + 6, W + 6, c * 0.23);
        ctx.strokeStyle = THEME.ink(grabbed ? 0.9 : 0.5 + 0.35 * Math.sin(t * 6)); ctx.lineWidth = 2.5; ctx.stroke();
        ctx.restore();
      }
      ctx.rotate(v.ang); ctx.scale(sc, sc);
      vehicleShape(v, Lp, W);
      ctx.restore();
    }

    function drawBoard(t, alpha) {
      const { c, x0, y0, pad } = L;
      const w = 6 * c;
      ctx.save(); ctx.globalAlpha = alpha;
      // glassy board
      rr(x0 - pad, y0 - pad, w + 2 * pad, w + 2 * pad, g.R * 0.06, THEME.ink(0.035));
      for (let r = 0; r < N; r++) for (let q = 0; q < N; q++) rr(x0 + q * c + c * 0.045, y0 + r * c + c * 0.045, c * 0.91, c * 0.91, c * 0.14, THEME.ink(r === EXIT_ROW ? 0.07 : 0.055));
      for (const wcell of walls) {
        const q = wcell % 6, r = Math.floor(wcell / 6);
        rr(x0 + q * c + c * 0.06, y0 + r * c + c * 0.06, c * 0.88, c * 0.88, c * 0.14, THEME.ink(0.2));
        ctx.strokeStyle = THEME.paper(THEME.light ? 0.75 : 0.35); ctx.lineWidth = c * 0.08; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x0 + q * c + c * 0.3, y0 + r * c + c * 0.3); ctx.lineTo(x0 + q * c + c * 0.7, y0 + r * c + c * 0.7);
        ctx.moveTo(x0 + q * c + c * 0.7, y0 + r * c + c * 0.3); ctx.lineTo(x0 + q * c + c * 0.3, y0 + r * c + c * 0.7); ctx.stroke();
      }
      // frame with the exit gap on the right of row 3
      const fx = x0 - pad, fy = y0 - pad, fw = w + 2 * pad, fr = g.R * 0.06;
      const gy0 = y0 + EXIT_ROW * c + c * 0.04, gy1 = y0 + (EXIT_ROW + 1) * c - c * 0.04;
      ctx.beginPath();
      ctx.moveTo(fx + fw, gy1);
      ctx.lineTo(fx + fw, fy + fw - fr); ctx.arcTo(fx + fw, fy + fw, fx + fw - fr, fy + fw, fr);
      ctx.lineTo(fx + fr, fy + fw); ctx.arcTo(fx, fy + fw, fx, fy + fw - fr, fr);
      ctx.lineTo(fx, fy + fr); ctx.arcTo(fx, fy, fx + fr, fy, fr);
      ctx.lineTo(fx + fw - fr, fy); ctx.arcTo(fx + fw, fy, fx + fw, fy + fr, fr);
      ctx.lineTo(fx + fw, gy0);
      ctx.strokeStyle = THEME.ink(0.2); ctx.lineWidth = Math.max(1.5, g.R * 0.008); ctx.lineCap = 'round'; ctx.stroke();
      // the gate: two red posts and a lane with chevrons
      const gx = fx + fw, gm = (gy0 + gy1) / 2;
      ctx.fillStyle = draw.alpha(g.color, 0.12);
      ctx.fillRect(gx - pad, gy0, g.R * 0.1 + pad, gy1 - gy0);
      ctx.lineWidth = Math.max(3, g.R * 0.014);
      ctx.strokeStyle = g.color;
      ctx.beginPath(); ctx.moveTo(gx - pad * 0.6, gy0); ctx.lineTo(gx + pad * 0.6, gy0); ctx.moveTo(gx - pad * 0.6, gy1); ctx.lineTo(gx + pad * 0.6, gy1); ctx.stroke();
      const open = scene === 'exit' || scene === 'solved';
      for (let k = 0; k < 3; k++) {
        const cx = gx + g.R * (0.05 + k * 0.055), s = c * 0.17;
        const a = open ? 1 : 0.25 + 0.6 * Math.max(0, Math.sin(t * 3.2 - k * 0.7));
        ctx.strokeStyle = draw.alpha(g.color, a);
        ctx.beginPath(); ctx.moveTo(cx - s * 0.5, gm - s); ctx.lineTo(cx + s * 0.5, gm); ctx.lineTo(cx - s * 0.5, gm + s); ctx.stroke();
      }
      ctx.restore();
    }

    function drawPicker(t) {
      const a = ease.out(clamp(sceneT / 0.35, 0, 1));
      const { ringR, bubR } = L;
      ctx.save(); ctx.globalAlpha = a;
      // ring track
      draw.arc(g.cx, g.cy, ringR, TAU * RING_A0 / 360, TAU * (360 - RING_A0) / 360, THEME.ink(0.06), g.R * 0.012);
      for (let i = 0; i < NL; i++) {
        const ang = (RING_A0 + i * (360 - 2 * RING_A0) / (NL - 1)) * Math.PI / 180;
        let bx = g.cx + Math.sin(ang) * ringR, by = g.cy - Math.cos(ang) * ringR;
        if (shake.i === i && shake.t > 0) bx += Math.sin(shake.t * 60) * g.R * 0.012 * (shake.t / 0.4);
        const sc = (0.6 + 0.4 * ease.back(clamp((sceneT - i * 0.025) / 0.35, 0, 1))) * (pressed && pressed.x === bx && pressed.y === by ? 0.93 : 1);
        const r = bubR * sc;
        const open = unlocked(i), done = pp()[i], inRun = run.get(i);
        const next = open && !done;
        if (done) draw.circle(bx, by, r, draw.alpha(PC, inRun ? 0.34 : 0.18), { stroke: draw.alpha(PC, 0.85), lw: 2 });
        else if (open) draw.circle(bx, by, r, THEME.ink(0.1), { stroke: draw.alpha(PC, 0.6 + 0.4 * Math.sin(t * 4)), lw: 2.5 });
        else draw.circle(bx, by, r, THEME.ink(0.04), { stroke: THEME.ink(0.1), lw: 1.5 });
        if (sel === i) draw.circle(bx, by, r + g.R * 0.022, null, { stroke: THEME.ink(0.85), lw: 2.5 });
        if (open) {
          draw.text(String(i + 1), bx, by - r * (done ? 0.18 : 0.04), r * 0.62, { color: THEME.fg });
          if (done) for (let k = 0; k < 3; k++) star(bx + (k - 1) * r * 0.34, by + r * 0.42, r * 0.15, k < done.s ? STAR : null, k < done.s ? null : THEME.ink(0.35));
          else if (next) draw.text(`${pack.levels[i][1]} moves`, bx, by + r * 0.45, r * 0.2, { color: THEME.ink(0.6), weight: 600, font: THEME.font });
        } else lock(bx, by - r * 0.08, r * 0.55, THEME.ink(0.32));
        btns.push({ x: bx, y: by, r: bubR, fn: () => { sel = i; openSel(); } });
      }
      // centre: pack, stars, this run, finish
      let starsAll = 0; for (let i = 0; i < NL; i++) starsAll += pp()[i]?.s || 0;
      draw.text(pack.name, g.cx, g.cy - g.R * 0.25, g.R * 0.1, { color: THEME.light ? draw.shade(PC, -0.35) : PC });
      star(g.cx - g.R * 0.115, g.cy - g.R * 0.105, g.R * 0.04, STAR);
      draw.text(`${starsAll} / ${NL * 3}`, g.cx - g.R * 0.055, g.cy - g.R * 0.1, g.R * 0.065, { color: THEME.fg, align: 'left' });
      const n = run.size;
      draw.text(n ? `This run: ${n} solved · ${total} pts` : 'Tap a level to play', g.cx, g.cy + g.R * 0.03, g.R * 0.045, { color: THEME.ink(0.62), weight: 600, font: THEME.font });
      const fy = g.cy + g.R * 0.22;
      pill(g.cx, fy, g.R * 0.5, g.R * 0.15, 'Finish run', { primary: n > 0, col: g.color, fn: () => finishRun(false), size: g.R * 0.058 });
      if (sel === NL) { ctx.beginPath(); ctx.roundRect(g.cx - g.R * 0.27, fy - g.R * 0.095, g.R * 0.54, g.R * 0.19, g.R * 0.095); ctx.strokeStyle = THEME.ink(0.85); ctx.lineWidth = 2.5; ctx.stroke(); }
      ctx.restore();
    }

    function drawSolved(t) {
      const s = solvedInfo, k = ease.out(clamp(sceneT / 0.35, 0, 1));
      const { bcx, bcy } = L;
      const w = 6 * L.c + 2 * L.pad;
      ctx.save(); ctx.globalAlpha = k;
      rr(bcx - w / 2, bcy - w / 2, w, w, g.R * 0.06, THEME.paper(0.84));
      ctx.restore();
      ctx.save(); ctx.globalAlpha = k;
      draw.text(s.last ? 'Pack complete!' : 'Solved!', bcx, bcy - g.R * 0.36, g.R * 0.095, { color: THEME.fg });
      for (let i = 0; i < 3; i++) {
        const sk = ease.back(clamp((sceneT - 0.15 - i * 0.18) / 0.35, 0, 1));
        const x = bcx + (i - 1) * g.R * 0.22, y = bcy - g.R * 0.15 - (i === 1 ? g.R * 0.03 : 0);
        const r = g.R * (i === 1 ? 0.085 : 0.07);
        star(x, y, r, THEME.ink(0.1));
        if (i < s.stars && sk > 0) star(x, y, r * sk, STAR);
      }
      draw.text(`${moves} move${moves === 1 ? '' : 's'}  ·  best ${opt}${s.newBest ? '  ·  new record' : ''}`, bcx, bcy + g.R * 0.02, g.R * 0.05, { color: THEME.ink(0.75), weight: 600, font: THEME.font });
      const ptsTxt = s.gain > 0 ? `+${s.gain} pts` : `${s.pts} pts · no better`;
      draw.text(ptsTxt, bcx, bcy + g.R * 0.115, g.R * 0.062, { color: s.gain > 0 ? starText() : THEME.ink(0.5) });
      ctx.restore();
      if (sceneT > 0.35) {
        const by = bcy + g.R * 0.3;
        if (s.last) pill(bcx, by, g.R * 0.46, g.R * 0.14, 'Finish run', { primary: true, fn: () => finishRun(true), size: g.R * 0.055 });
        else {
          pill(bcx - g.R * 0.2, by, g.R * 0.34, g.R * 0.14, 'Levels', { fn: () => toPicker(), size: g.R * 0.052 });
          pill(bcx + g.R * 0.2, by, g.R * 0.36, g.R * 0.14, 'Next level', { primary: true, fn: () => startLevel(lv + 1), size: g.R * 0.052 });
        }
      }
    }

    // ---- frame ----
    g.loop((dt, t) => {
      sceneT += dt;
      if (shake.t > 0) shake.t -= dt;
      if (kSelShow > 0) kSelShow -= dt;
      btns.length = 0;
      draw.bg({ glow: 0.14, glowAt: [0, 0.05] });

      if (scene === 'pick') drawPicker(t);
      else {
        if (scene === 'play') lvTime += dt;
        // vehicles glide to their cells
        for (const v of vs) if (!(drag && vs[drag.i] === v)) v.x += (v.pos - v.x) * Math.min(1, dt * 20);
        if (scene === 'exit') {        // the red car drives out of the gate
          const red = vs[0];
          red.vx = (red.vx || 0) + dt * 40;
          red.x = Math.max(red.x, red.pos) + red.vx * dt;
          if (Math.random() < 0.5) draw.burst(L.x0 + red.x * L.c, L.y0 + (EXIT_ROW + 0.5) * L.c + (Math.random() - 0.5) * L.c * 0.5, THEME.ink(0.5), 1, g.R * 0.15, g.R * 0.008);
          if (sceneT > 0.75) showSolved();
        }
        const ba = scene === 'play' && sceneT < 0.3 ? ease.out(sceneT / 0.3) : 1;
        drawBoard(t, ba);
        ctx.save();
        draw.clipCircle(g.R * 0.97);
        for (let i = vs.length - 1; i >= 0; i--) if (!(drag && drag.i === i) && !(i === 0 && (scene === 'exit' || scene === 'solved'))) drawVehicle(vs[i], i, t);
        if (drag) drawVehicle(vs[drag.i], drag.i, t);
        if (scene === 'exit') drawVehicle(vs[0], 0, t);
        ctx.restore();
        if (scene === 'solved') drawSolved(t);
        // bottom controls
        const playing = scene === 'play';
        ctx.save(); ctx.globalAlpha = ba;
        roundBtn(g.cx - g.R * 0.25, L.btnY, L.btnR, 'levels', () => toPicker(), playing);
        roundBtn(g.cx, L.btnY, L.btnR, 'undo', undo, playing && hist.length > 0);
        roundBtn(g.cx + g.R * 0.25, L.btnY, L.btnR, 'restart', restart, playing && hist.length > 0);
        ctx.restore();
        if (scene === 'solved' && solvedInfo.last && autoEnd > 0 && (autoEnd -= dt) <= 0) finishRun(true);
      }
      draw.particles(dt);
      draw.floaters(dt);
    });

    return {
      destroy() { window.removeEventListener('keydown', onTab, true); },
    };
  },
};
