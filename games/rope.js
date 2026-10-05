// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Rope Snip — swipe across the ropes so the wrapped sweet swings and drops into the hungry critter's mouth.
// Grab the three stars on the way. Bubbles float the sweet up (tap to pop), puffers blow air, ringed pins tie a
// new rope on, spikes burst the sweet, some pins ride on rails and the arrow button flips gravity.
// 36 levels in 3 boxes of 12 (rope-levels.js, which also holds the deterministic rope physics).
// A round = a visit to the level rings: play any unlocked level; "Done" (or finishing the last level) submits the
// total of stars collected over all levels to the top 5. Progress is kept in store 'gameProgress'.rope.
import { TAU, clamp, ease, THEME } from './kit.js';
import { store } from '../js/core/store.js';
import { Sim, BOXES, LEVELS, H, CANDY_R, CRIT_R, STAR_R, BUBBLE_R, PUFF_R, FLIP_R } from './rope-levels.js';

const NL = LEVELS.length, PER = 12, NB = BOXES.length;
const STAR = '#ffc857', STAR_D = '#d08a00';
const CANDY = '#ff4d6d', CANDY_S = '#ffe4ea', WRAP = '#ffd166', WRAP_D = '#e9a93a';
const CRIT = '#8b5cf6', CRIT_B = '#b9a2ff', CRIT_D = '#5b34c9', MOUTH = '#3a0f35', TONGUE = '#ff8fab';
const ROPE = '#6e4424', ROPE_L = '#c08a52';
const PIN = '#a3acb9', PIN_D = '#59616e';
const PUFF = '#2ec4b6', PUFF_D = '#1a8a80';
const FLIP = '#f97316';
const SPIKE = '#ef4444', SPIKE_D = '#5b2330';
const RING_A0 = 40;

const loadProg = () => {
  const p = store.get('gameProgress')?.rope;
  const s = Array.from({ length: NL }, (_, i) => (Number.isInteger(p?.s?.[i]) ? clamp(p.s[i], 0, 3) : null));
  return { s };
};
const saveProg = (p) => { store.set('gameProgress', { ...(store.get('gameProgress') || {}), rope: { s: p.s } }); };
const boxOf = (i) => Math.floor(i / PER);
const lvName = (i) => `${boxOf(i) + 1}-${(i % PER) + 1}`;

export default {
  howTo: 'Swipe across a rope to cut it and feed the sweet to the hungry critter — grab the stars on the way. Tap bubbles, puffers and arrow buttons. R restarts.',
  scoring: 'high',
  unit: '★',
  hud: false,
  create(g) {
    const { ctx } = g;
    const draw = g.draw;
    const prog = loadProg();
    const unlocked = (i) => i === 0 || prog.s[i - 1] != null || prog.s[i] != null;
    const totalStars = () => prog.s.reduce((a, v) => a + (v || 0), 0);
    const doneCount = () => prog.s.filter((v) => v != null).length;

    let scene = 'pick', sceneT = 0, ended = false;
    let sel = 0, page = 0, pageX = 0, shake = { i: -1, t: 0 };
    let lv = 0, sim = null, acc = 0, endT = 0, result = null;
    let pressed = null, btnUpAt = 0;
    const btns = [];
    // critter animation state
    const cr = { open: 0, blink: 0, nextBlink: 2, mood: 'idle', moodT: 0, chomp: 0, bounce: 0, look: [0, 0] };
    let candyAng = 0, eatT = -1, trail = [], swipe = null, airs = [], starFx = [], popFx = [], puffAnim = [], flipAnim = 0, gravShow = 1;
    let kSel = 0, kShow = 0;

    // unit circle → px
    const X = (u) => g.cx + u * g.R, Y = (v) => g.cy + v * g.R, U = (v) => v * g.R;

    // first level worth playing: the next unlocked one not done yet, else the first without 3 stars
    sel = (() => { for (let i = 0; i < NL; i++) if (unlocked(i) && prog.s[i] == null) return i; for (let i = 0; i < NL; i++) if (prog.s[i] < 3) return i; return 0; })();
    page = boxOf(sel); pageX = page;
    g.score(totalStars());   // (hidden HUD; shown on the pause card)
    g.toast('', 1);

    // ------------------------------------------------------------------ background (cached texture)
    let bgCache = null, bgKey = '';
    function texture() {
      const key = `${THEME.id}|${THEME.mode}|${THEME.light}|${g.S}|${g.dpr}`;
      if (bgCache && key === bgKey) return bgCache;
      bgKey = key;
      const c = document.createElement('canvas');
      c.width = c.height = Math.max(1, Math.round(g.S * g.dpr));
      const x = c.getContext('2d');
      x.scale(g.dpr, g.dpr);
      const R = g.R, cx = g.cx, cy = g.cy;
      x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.clip();
      let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      if (THEME.light) {
        // cardboard: a warm tan wash, the flutes and two folds with a strip of tape
        x.fillStyle = 'rgba(205,160,100,.20)'; x.fillRect(0, 0, g.S, g.S);
        const step = R * 0.034;
        for (let k = 0, xx = cx - R; xx < cx + R; xx += step, k++) {
          x.fillStyle = k % 2 ? 'rgba(140,95,45,.055)' : 'rgba(255,240,215,.10)';
          x.fillRect(xx, 0, step / 2, g.S);
        }
        x.strokeStyle = 'rgba(120,80,35,.16)'; x.lineWidth = Math.max(1, R * 0.006);
        x.beginPath(); x.moveTo(cx - R, cy - R * 0.36); x.lineTo(cx + R, cy - R * 0.36); x.stroke();
        x.beginPath(); x.moveTo(cx - R, cy + R * 0.66); x.lineTo(cx + R, cy + R * 0.66); x.stroke();
        x.fillStyle = 'rgba(214,186,140,.35)'; x.fillRect(cx - R * 0.09, 0, R * 0.18, cy - R * 0.36);
        for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(110,70,30,${0.03 + rnd() * 0.05})`; x.fillRect(cx + (rnd() * 2 - 1) * R, cy + (rnd() * 2 - 1) * R, 1.2, 1.2); }
      } else {
        // dark felt: fine fibres in the theme's ink
        const ink = THEME.ink;
        for (let k = 0; k < 2600; k++) {
          const px = cx + (rnd() * 2 - 1) * R, py = cy + (rnd() * 2 - 1) * R, a = rnd() * Math.PI, l = R * (0.004 + rnd() * 0.012);
          x.strokeStyle = ink(0.018 + rnd() * 0.035); x.lineWidth = 1;
          x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
        }
        x.strokeStyle = ink(0.05); x.lineWidth = Math.max(1, R * 0.005); x.setLineDash([R * 0.02, R * 0.016]);
        x.beginPath(); x.arc(cx, cy, R * 0.9, 0, TAU); x.stroke();
      }
      bgCache = c;
      return c;
    }
    function background(glow = 0.12) {
      draw.bg({ glow, glowAt: [0, 0.1] });
      ctx.drawImage(texture(), 0, 0, g.S, g.S);
    }

    // ------------------------------------------------------------------ levels
    function startLevel(i) {
      lv = i; sel = i; page = boxOf(i);
      sim = new Sim(LEVELS[i]);
      acc = 0; endT = 0; result = null; eatT = -1; trail = []; swipe = null; airs = []; starFx = []; popFx = [];
      puffAnim = sim.puffers.map(() => 0); flipAnim = 0; gravShow = 1; kSel = 0; kShow = 0;
      Object.assign(cr, { open: 0, blink: 0, nextBlink: 1.5, mood: 'idle', moodT: 0, chomp: 0, bounce: 0 });
      candyAng = 0;
      scene = 'play'; sceneT = 0;
      draw.clearFx();
      g.toast(LEVELS[i].hint || '', LEVELS[i].hint ? 2600 : 1);
    }
    function restart() { if (scene === 'play' || scene === 'done') { startLevel(lv); g.sfx('whoosh', { volume: 0.6 }); } }
    function toPicker() { g.toast('', 1); scene = 'pick'; sceneT = 0; sel = clamp(lv + (prog.s[lv] != null && lv + 1 < NL ? 1 : 0), 0, NL - 1); page = boxOf(sel); draw.clearFx(); }
    function finishLevel() {
      const stars = sim.stars3, prev = prog.s[lv];
      const gain = Math.max(0, stars - (prev || 0));
      prog.s[lv] = Math.max(stars, prev ?? 0);
      saveProg(prog);
      g.score(totalStars());
      result = { stars, gain, first: prev == null, last: lv === NL - 1 };
      scene = 'done'; sceneT = 0;
      g.sfx(stars === 3 ? 'perfect' : 'win');
    }
    function finishRun(complete = false) {
      if (ended) return;
      ended = true;
      const tot = totalStars(), n = doneCount();
      g.score(tot);
      g.over(tot, {
        title: complete ? 'Every box done!' : 'Rope Snip',
        win: true,
        label: `${n}/${NL} levels`,
        note: `${n} of ${NL} levels fed · ${tot} of ${NL * 3} stars`,
        delay: 500,
      });
    }

    // ------------------------------------------------------------------ input
    const inBtn = (b, p) => (b.w ? Math.abs(p.x - b.x) <= b.w / 2 + 6 && Math.abs(p.y - b.y) <= b.h / 2 + 6 : Math.hypot(p.x - b.x, p.y - b.y) <= b.r * 1.25);
    function tapItems(ux, uy) {
      if (!sim || sim.state !== 'run') return false;
      if (sim.flipBtn && Math.hypot(ux - sim.flipBtn.x, uy - sim.flipBtn.y) < FLIP_R * 1.5) { sim.flip(); return true; }
      for (let i = 0; i < sim.puffers.length; i++) { const p = sim.puffers[i]; if (Math.hypot(ux - p.x, uy - p.y) < PUFF_R * 1.6) { sim.puff(i); return true; } }
      if (sim.bubbled && Math.hypot(ux - sim.cx, uy - sim.cy) < BUBBLE_R * 1.6) { sim.pop(); return true; }
      return false;
    }
    g.on('down', (p) => {
      if (ended) return;
      pressed = btns.find((b) => inBtn(b, p)) || null;
      if (pressed) return;
      if (scene === 'play') {
        const ux = p.dx / g.R, uy = p.dy / g.R;
        tapItems(ux, uy);
        swipe = { id: p.id, x: ux, y: uy };
        trail.push({ x: ux, y: uy, t: 0 });
      } else if (scene === 'pick') swipe = { id: p.id, x: p.x, y: p.y, pick: true };
    });
    g.on('move', (p) => {
      if (!swipe || p.id !== swipe.id || swipe.pick) return;
      const ux = p.dx / g.R, uy = p.dy / g.R;
      if (scene === 'play' && sim) {
        const n = sim.cutLine(swipe.x, swipe.y, ux, uy);
        if (n) { g.vibrate(10); }
      }
      swipe.x = ux; swipe.y = uy;
      trail.push({ x: ux, y: uy, t: 0 });
      if (trail.length > 40) trail.shift();
    });
    g.on('up', (p) => {
      if (swipe && swipe.id === p.id) swipe = null;
      if (pressed) {
        const b = pressed; pressed = null; btnUpAt = performance.now();
        if (inBtn(b, p)) { g.sfx('click'); b.fn(); }
      }
    });
    g.on('swipe', (p) => {
      if (scene !== 'pick' || pressed || performance.now() - btnUpAt < 80) return;
      if (p.dir === 'left') setPage(page + 1); else if (p.dir === 'right') setPage(page - 1);
    });
    function setPage(b) {
      b = clamp(b, 0, NB - 1);
      if (b === page) return;
      page = b; g.sfx('tick');
      if (boxOf(sel) !== page) sel = page * PER;
    }
    function openLevel(i) {
      if (!unlocked(i)) { shake = { i, t: 0.4 }; g.sfx('hit'); g.toast(`Feed level ${lvName(i - 1)} first`, 1100); return; }
      g.sfx('pop'); startLevel(i);
    }
    function pickStep(d) {
      sel = (sel + d + NL + 1) % (NL + 1);
      if (sel < NL) page = boxOf(sel);
      g.sfx('tick');
    }
    // keyboard / rotary targets in a level: the ropes still whole, puffers, the gravity button, a bubble
    function targets() {
      const t = [];
      if (!sim) return t;
      for (const r of sim.ropes) if (r.alive && r.cut < 0) t.push({ k: 'rope', r });
      sim.puffers.forEach((p, i) => t.push({ k: 'puff', i }));
      if (sim.flipBtn) t.push({ k: 'flip' });
      return t;
    }
    function actTarget() {
      const t = targets(); if (!t.length || !sim || sim.state !== 'run') return;
      const it = t[kSel % t.length];
      if (it.k === 'rope') sim.cut(it.r); else if (it.k === 'puff') sim.puff(it.i); else sim.flip();
    }
    g.on('key', ({ key }) => {
      if (ended) return;
      const k = key.length === 1 ? key.toLowerCase() : key;
      if (scene === 'pick') {
        if (k === 'ArrowRight' || k === 'ArrowDown') pickStep(1);
        else if (k === 'ArrowLeft' || k === 'ArrowUp') pickStep(-1);
        else if (k === 'PageDown') setPage(page + 1);
        else if (k === 'PageUp') setPage(page - 1);
        else if (k === 'Enter' || k === ' ') { if (sel === NL) finishRun(false); else openLevel(sel); }
      } else if (scene === 'play') {
        if (k === 'r') restart();
        else if (k === 'l') toPicker();
        else if (k === ' ') sim.pop();
        else if (k === 'ArrowRight' || k === 'ArrowDown') { const n = targets().length; if (n) { kSel = (kSel + 1) % n; kShow = 3; g.sfx('tick'); } }
        else if (k === 'ArrowLeft' || k === 'ArrowUp') { const n = targets().length; if (n) { kSel = (kSel - 1 + n) % n; kShow = 3; g.sfx('tick'); } }
        else if (k === 'Enter') { kShow = 3; actTarget(); }
        else if (k === 'g' || k === 'f') sim.flip();
        else if (/^[1-9]$/.test(k)) sim.puff(Number(k) - 1);
      } else if (scene === 'done' && sceneT > 0.4) {
        if (k === 'Enter' || k === ' ') { if (result.last) finishRun(true); else startLevel(lv + 1); }
        else if (k === 'r') restart();
        else if (k === 'l') toPicker();
      }
    });
    g.on('wheel', ({ delta }) => {
      if (scene === 'pick') pickStep(delta);
      else if (scene === 'play') { const n = targets().length; if (n) { kSel = (kSel + delta + n) % n; kShow = 3; g.sfx('tick'); } }
    });

    // ------------------------------------------------------------------ drawing helpers
    function rr(x, y, w, h, r, fill) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); ctx.fillStyle = fill; ctx.fill(); }
    function star(x, y, r, fill, stroke, rot = 0) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + rot + i * Math.PI / 5, q = i % 2 ? r * 0.48 : r; ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
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
    function pill(x, y, w, h, label, { primary = false, fn = null, size = h * 0.42 } = {}) {
      const down = pressed && pressed.x === x && pressed.y === y;
      ctx.save(); ctx.translate(x, y); if (down) ctx.scale(0.95, 0.95);
      if (primary) rr(-w / 2, -h / 2, w, h, h / 2, g.color);
      else { rr(-w / 2, -h / 2, w, h, h / 2, THEME.surface); rr(-w / 2, -h / 2, w, h, h / 2, THEME.ink(0.12)); ctx.strokeStyle = THEME.ink(0.16); ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.restore();
      draw.text(label, x, y + 1, size, { color: primary ? '#fff' : THEME.fg });
      if (fn) btns.push({ x, y, w, h, fn });
    }
    function roundBtn(x, y, r, kind, fn, { solid = false } = {}) {
      const down = pressed && pressed.x === x && pressed.y === y;
      const k = down ? 0.92 : 1;
      if (solid) { draw.circle(x, y, r * k, THEME.surface); }
      draw.circle(x, y, r * k, THEME.ink(solid ? 0.1 : 0.075), { stroke: THEME.ink(0.16), lw: 1.5 });
      const s = r * 0.62 * k;
      ctx.save();
      ctx.strokeStyle = THEME.fg; ctx.fillStyle = THEME.fg; ctx.lineWidth = Math.max(2, r * 0.11); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (kind === 'restart') {
        const r0 = s * 0.6, a0 = -Math.PI / 2 + 0.25, a1 = a0 + TAU * 0.78;
        ctx.beginPath(); ctx.arc(x, y, r0, a0, a1); ctx.stroke();
        const hx = x + Math.cos(a1) * r0, hy = y + Math.sin(a1) * r0, dx = -Math.sin(a1), dy = Math.cos(a1), sz = s * 0.3;
        ctx.beginPath(); ctx.moveTo(hx + dx * sz, hy + dy * sz); ctx.lineTo(hx - dy * sz * 0.8, hy + dx * sz * 0.8); ctx.lineTo(hx + dy * sz * 0.8, hy - dx * sz * 0.8); ctx.closePath(); ctx.fill();
      } else if (kind === 'levels') {
        const q = s * 0.5, gp = s * 0.14;
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rr(x + (dx < 0 ? -q - gp / 2 : gp / 2), y + (dy < 0 ? -q - gp / 2 : gp / 2), q, q, q * 0.3, THEME.fg);
      } else if (kind === 'left' || kind === 'right') {
        const d = kind === 'left' ? -1 : 1;
        ctx.beginPath(); ctx.moveTo(x - d * s * 0.2, y - s * 0.45); ctx.lineTo(x + d * s * 0.25, y); ctx.lineTo(x - d * s * 0.2, y + s * 0.45); ctx.stroke();
      }
      ctx.restore();
      if (fn) btns.push({ x, y, r, fn });
    }

    // ---- level pieces ----
    function ropePath(idx, from, to) {
      const { px, py } = sim;
      ctx.beginPath();
      ctx.moveTo(X(px[idx[from]]), Y(py[idx[from]]));
      for (let k = from + 1; k < to; k++) {
        const a = idx[k], b = idx[k + 1];
        ctx.quadraticCurveTo(X(px[a]), Y(py[a]), X((px[a] + px[b]) / 2), Y((py[a] + py[b]) / 2));
      }
      ctx.lineTo(X(px[idx[to]]), Y(py[idx[to]]));
    }
    function drawRope(r, hi) {
      const a = r.cut >= 0 ? clamp(1 - r.fade / 1.4, 0, 1) : 1;
      if (a <= 0) return;
      ctx.save(); ctx.globalAlpha = a; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const w = U(0.017);
      const pieces = r.cut >= 0 ? [[0, r.cut], [r.cut + 1, r.n]] : [[0, r.n]];
      for (const [f, t] of pieces) {
        if (t <= f) continue;
        if (hi) { ropePath(r.idx, f, t); ctx.strokeStyle = THEME.ink(0.8); ctx.lineWidth = w * 2.2; ctx.stroke(); }
        ropePath(r.idx, f, t); ctx.strokeStyle = ROPE; ctx.lineWidth = w; ctx.setLineDash([]); ctx.stroke();
        ctx.setLineDash([w * 1.1, w * 1.1]); ctx.lineDashOffset = 0;
        ropePath(r.idx, f, t); ctx.strokeStyle = ROPE_L; ctx.lineWidth = w * 0.45; ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
    function drawPin(x, y, col = PIN) {
      draw.circle(X(x), Y(y), U(0.03), PIN_D);
      draw.circle(X(x), Y(y), U(0.022), col);
      draw.circle(X(x), Y(y), U(0.008), PIN_D);
    }
    function drawTrack(p) {
      const tr = p.track;
      if (!tr) return;
      ctx.save(); ctx.lineCap = 'round';
      ctx.strokeStyle = THEME.ink(0.12); ctx.lineWidth = U(0.045);
      ctx.beginPath();
      if (tr.to) { ctx.moveTo(X(p.x0), Y(p.y0)); ctx.lineTo(X(tr.to[0]), Y(tr.to[1])); } else ctx.arc(X(tr.c[0]), Y(tr.c[1]), U(p.rad), 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = THEME.ink(0.22); ctx.lineWidth = U(0.008); ctx.stroke();
      ctx.restore();
    }
    function drawSpikes(s) {
      const x1 = X(s.x1), y1 = Y(s.y1), x2 = X(s.x2), y2 = Y(s.y2);
      const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len, nx = -uy, ny = ux;
      const tw = U(0.04), th = U(0.04), n = Math.max(2, Math.round(len / tw));
      ctx.save();
      ctx.fillStyle = SPIKE;
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const a = (k / n) * len, b = ((k + 1) / n) * len, m = (a + b) / 2;
        for (const sd of [1, -1]) {
          ctx.moveTo(x1 + ux * a, y1 + uy * a); ctx.lineTo(x1 + ux * m + nx * th * sd, y1 + uy * m + ny * th * sd); ctx.lineTo(x1 + ux * b, y1 + uy * b);
        }
      }
      ctx.fill();
      ctx.strokeStyle = SPIKE_D; ctx.lineWidth = U(0.026); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    }
    function drawPuffer(p, i, t, hi) {
      const k = puffAnim[i] || 0, sq = 1 - 0.25 * Math.sin(Math.min(1, k) * Math.PI);
      const s = U(PUFF_R);
      ctx.save(); ctx.translate(X(p.x), Y(p.y)); ctx.rotate(p.a);
      if (hi) draw.circle(0, 0, s * 1.5, null, { stroke: THEME.ink(0.6 + 0.3 * Math.sin(t * 6)), lw: 2.5 });
      // bellows body (pointing up = the blowing direction), squashed when it puffs
      ctx.scale(1, sq);
      rr(-s * 0.8, -s * 0.1, s * 1.6, s * 1.0, s * 0.3, PUFF);
      ctx.fillStyle = PUFF_D;
      for (let j = 0; j < 3; j++) ctx.fillRect(-s * 0.7, s * (0.12 + j * 0.24), s * 1.4, s * 0.07);
      ctx.beginPath(); ctx.moveTo(-s * 0.32, -s * 0.1); ctx.lineTo(-s * 0.16, -s * 0.72); ctx.lineTo(s * 0.16, -s * 0.72); ctx.lineTo(s * 0.32, -s * 0.1); ctx.closePath(); ctx.fillStyle = PUFF_D; ctx.fill();
      ctx.restore();
    }
    function drawFlip(t, hi) {
      const b = sim.flipBtn; if (!b) return;
      const x = X(b.x), y = Y(b.y), r = U(FLIP_R);
      if (hi) draw.circle(x, y, r * 1.35, null, { stroke: THEME.ink(0.6 + 0.3 * Math.sin(t * 6)), lw: 2.5 });
      draw.circle(x, y, r, FLIP, { stroke: draw.shade(FLIP, -0.3), lw: U(0.008) });
      ctx.save(); ctx.translate(x, y);
      const dir = gravShow;   // 1 = down … -1 = up (animated)
      ctx.scale(1, dir);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(-r * 0.16, -r * 0.5); ctx.lineTo(r * 0.16, -r * 0.5); ctx.lineTo(r * 0.16, r * 0.05); ctx.lineTo(r * 0.42, r * 0.05); ctx.lineTo(0, r * 0.55); ctx.lineTo(-r * 0.42, r * 0.05); ctx.lineTo(-r * 0.16, r * 0.05); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    function drawBubble(x, y, r, t) {
      const w = 1 + 0.04 * Math.sin(t * 5);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(x, y, r * w, r / w, 0, 0, TAU);
      ctx.fillStyle = THEME.light ? 'rgba(120,190,255,.22)' : 'rgba(140,205,255,.16)'; ctx.fill();
      ctx.strokeStyle = THEME.light ? 'rgba(40,130,220,.75)' : 'rgba(170,220,255,.8)'; ctx.lineWidth = Math.max(1.5, r * 0.07); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 0.72, -2.5, -1.7);
      ctx.strokeStyle = THEME.light ? 'rgba(40,130,220,.45)' : 'rgba(200,235,255,.55)'; ctx.lineWidth = Math.max(1.5, r * 0.08); ctx.lineCap = 'round'; ctx.stroke();
      ctx.restore();
    }
    function drawCandy(x, y, s, ang) {
      const r = U(CANDY_R) * s;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      // wrapper ends: little twisted fans either side
      for (const d of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(d * r * 0.7, 0); ctx.lineTo(d * r * 1.75, -r * 0.7); ctx.quadraticCurveTo(d * r * 1.55, 0, d * r * 1.75, r * 0.7); ctx.closePath();
        ctx.fillStyle = WRAP; ctx.fill();
        ctx.strokeStyle = WRAP_D; ctx.lineWidth = r * 0.12; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(d * r * 0.95, -r * 0.1); ctx.lineTo(d * r * 1.5, -r * 0.42); ctx.moveTo(d * r * 0.95, r * 0.1); ctx.lineTo(d * r * 1.5, r * 0.42); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(d * r * 0.85, 0, r * 0.16, r * 0.3, 0, 0, TAU); ctx.fillStyle = WRAP_D; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = CANDY; ctx.fill();
      // swirl stripes
      ctx.save(); ctx.clip();
      ctx.strokeStyle = CANDY_S; ctx.lineWidth = r * 0.2; ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(r * 0.18, r * 0.05, r * (0.32 + k * 0.36), Math.PI * 0.8 + k * 0.5, Math.PI * 1.75 + k * 0.5); ctx.stroke(); }
      ctx.restore();
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.strokeStyle = draw.shade(CANDY, -0.35); ctx.lineWidth = Math.max(1, r * 0.08); ctx.stroke();
      ctx.restore();
    }
    function drawCritter(t, dt) {
      const c = sim.critter, x = X(c.x), y = Y(c.y), r = U(CRIT_R);
      // little cushion it sits on
      const by = y + r * 0.92;
      rr(x - r * 1.05, by - r * 0.06, r * 2.1, r * 0.3, r * 0.15, THEME.light ? '#c99a62' : '#7a5636');
      rr(x - r * 1.05, by - r * 0.06, r * 2.1, r * 0.1, r * 0.05, THEME.light ? '#dcb27c' : '#946a44');
      const sq = 1 + cr.bounce;
      ctx.save(); ctx.translate(x, y + r * 0.9); ctx.scale(1 / Math.sqrt(sq), sq); ctx.translate(0, -r * 0.9);
      // ears
      for (const d of [-1, 1]) {
        const ex = d * r * 0.62, ey = -r * 0.72;
        ctx.beginPath(); ctx.arc(ex, ey, r * 0.3, 0, TAU); ctx.fillStyle = CRIT; ctx.fill();
        ctx.beginPath(); ctx.arc(ex, ey, r * 0.16, 0, TAU); ctx.fillStyle = '#ff9ec4'; ctx.fill();
      }
      // body + belly
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = CRIT; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.beginPath(); ctx.ellipse(0, r * 0.62, r * 0.72, r * 0.55, 0, 0, TAU); ctx.fillStyle = CRIT_B; ctx.fill();
      ctx.restore();
      // feet
      for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * r * 0.45, r * 0.92, r * 0.24, r * 0.12, 0, 0, TAU); ctx.fillStyle = CRIT_D; ctx.fill(); }
      // cheeks
      for (const d of [-1, 1]) { ctx.beginPath(); ctx.arc(d * r * 0.62, r * 0.12, r * 0.12, 0, TAU); ctx.fillStyle = 'rgba(255,140,190,.55)'; ctx.fill(); }
      // eyes
      const happy = cr.mood === 'happy', sad = cr.mood === 'sad';
      const bl = cr.blink > 0 ? Math.max(0.08, Math.abs(1 - cr.blink / 0.075)) : 1;
      for (const d of [-1, 1]) {
        const ex = d * r * 0.36, ey = -r * 0.24, er = r * 0.3;
        if (happy) {
          ctx.beginPath(); ctx.arc(ex, ey + er * 0.25, er * 0.62, Math.PI * 1.1, Math.PI * 1.9);
          ctx.strokeStyle = MOUTH; ctx.lineWidth = r * 0.1; ctx.lineCap = 'round'; ctx.stroke();
          continue;
        }
        ctx.save(); ctx.translate(ex, ey); ctx.scale(1, bl);
        ctx.beginPath(); ctx.arc(0, 0, er, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.lineWidth = r * 0.05; ctx.strokeStyle = CRIT_D; ctx.stroke();
        const [lx, ly] = cr.look;
        ctx.beginPath(); ctx.arc(lx * er * 0.42, ly * er * 0.42 + (sad ? er * 0.3 : 0), er * 0.48, 0, TAU); ctx.fillStyle = '#1b1030'; ctx.fill();
        ctx.beginPath(); ctx.arc(lx * er * 0.42 + er * 0.16, ly * er * 0.42 - er * 0.16 + (sad ? er * 0.3 : 0), er * 0.14, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.restore();
        if (sad) { ctx.beginPath(); ctx.moveTo(ex - d * er * 0.9, ey - er * 1.05); ctx.lineTo(ex + d * er * 0.6, ey - er * 1.35); ctx.strokeStyle = CRIT_D; ctx.lineWidth = r * 0.08; ctx.lineCap = 'round'; ctx.stroke(); }
      }
      // mouth
      const my = r * 0.36, o = cr.open;
      if (sad) {
        ctx.beginPath(); ctx.arc(0, my + r * 0.22, r * 0.24, Math.PI * 1.2, Math.PI * 1.8); ctx.strokeStyle = MOUTH; ctx.lineWidth = r * 0.09; ctx.lineCap = 'round'; ctx.stroke();
      } else if (o < 0.08) {
        ctx.beginPath(); ctx.arc(0, my - r * 0.12, r * 0.3, Math.PI * 0.2, Math.PI * 0.8); ctx.strokeStyle = MOUTH; ctx.lineWidth = r * 0.09; ctx.lineCap = 'round'; ctx.stroke();
      } else {
        const mw = r * (0.36 + 0.24 * o), mh = r * 0.42 * o;
        ctx.save();
        ctx.beginPath(); ctx.ellipse(0, my, mw, mh, 0, 0, TAU); ctx.fillStyle = MOUTH; ctx.fill();
        ctx.clip();
        ctx.beginPath(); ctx.ellipse(0, my + mh * 0.75, mw * 0.65, mh * 0.55, 0, 0, TAU); ctx.fillStyle = TONGUE; ctx.fill();
        ctx.fillStyle = '#fff';
        for (const d of [-1, 1]) rr(d * mw * 0.32 - r * 0.07, my - mh - 1, r * 0.14, r * 0.13 + mh * 0.12, r * 0.04, '#fff');
        ctx.restore();
      }
      ctx.restore();
    }

    // ------------------------------------------------------------------ scenes
    function updateSim(dt) {
      acc += dt;
      let n = 0;
      while (acc >= H && n < 10) { sim.step(); acc -= H; n++; }
      if (n >= 10) acc = 0;
      const ev = sim.events;
      for (const e of ev) {
        if (e.type === 'star') {
          const got = sim.stars3;
          g.sfx('coin', { pitch: 1 + got * 0.12 });
          starFx.push({ x: e.s.x, y: e.s.y, t: 0 });
          draw.burst(X(e.s.x), Y(e.s.y), STAR, 16, g.R * 0.45, g.R * 0.011);
        } else if (e.type === 'cut') { g.sfx('whoosh', { volume: 0.7 }); }
        else if (e.type === 'tie') { g.sfx('place'); draw.burst(X(e.a.pin.x), Y(e.a.pin.y), THEME.ink(0.6), 8, g.R * 0.25, g.R * 0.008); }
        else if (e.type === 'bubble') g.sfx('bounce', { volume: 0.8 });
        else if (e.type === 'pop') { g.sfx('pop'); popFx.push({ x: sim.cx, y: sim.cy, t: 0 }); }
        else if (e.type === 'puff') {
          const i = sim.puffers.indexOf(e.p); puffAnim[i] = 0.001;
          g.sfx('whoosh', { pitch: 1.4, volume: 0.6 });
          for (let k = 0; k < 7; k++) airs.push({ x: e.p.x + e.p.dx * 0.07, y: e.p.y + e.p.dy * 0.07, vx: e.p.dx * (0.6 + k * 0.08) + (Math.random() - 0.5) * 0.15, vy: e.p.dy * (0.6 + k * 0.08) + (Math.random() - 0.5) * 0.15, t: -k * 0.02, r: 0.02 + Math.random() * 0.015 });
        } else if (e.type === 'flip') { g.sfx('jump', { pitch: sim.gdir > 0 ? 0.8 : 1.2 }); }
        else if (e.type === 'won') {
          eatT = 0; cr.mood = 'happy'; cr.moodT = 0; cr.chomp = 0.001;
          g.sfx('score'); g.vibrate(25);
          draw.burst(X(sim.critter.x), Y(sim.critter.y + 0.03), CANDY, 14, g.R * 0.4, g.R * 0.01);
          endT = 1.3;
        } else if (e.type === 'lost') {
          cr.mood = 'sad'; cr.moodT = 0;
          if (e.why === 'spike') { g.sfx('boom', { volume: 0.6 }); g.vibrate(40); draw.burst(X(sim.cx), Y(sim.cy), CANDY, 22, g.R * 0.6, g.R * 0.013); draw.burst(X(sim.cx), Y(sim.cy), WRAP, 10, g.R * 0.5, g.R * 0.01); }
          else g.sfx('drop');
          g.toast('Oops!', 900);
          endT = 1.4;
        }
      }
      ev.length = 0;
      if (endT > 0 && (endT -= dt) <= 0) { if (sim.state === 'won') finishLevel(); else startLevel(lv); }
    }

    function updateCritter(dt) {
      const c = sim.critter;
      const dx = sim.cx - c.x, dy = sim.cy - c.y, d = Math.hypot(dx, dy) || 1;
      const lk = sim.gone ? [0, 0.4] : [dx / d * Math.min(1, d * 3), dy / d * Math.min(1, d * 3)];
      cr.look[0] += (lk[0] - cr.look[0]) * Math.min(1, dt * 10); cr.look[1] += (lk[1] - cr.look[1]) * Math.min(1, dt * 10);
      let target = 0;
      if (sim.state === 'run' && d < 0.5) target = clamp(1 - (d - 0.13) / 0.35, 0, 1);
      if (cr.chomp > 0) { cr.chomp += dt; target = cr.chomp < 0.12 ? 1 : 0; cr.bounce = 0.12 * Math.sin(Math.min(1, cr.chomp / 0.6) * Math.PI * 3) * Math.max(0, 1 - cr.chomp / 0.9); }
      else cr.bounce = cr.mood === 'idle' ? 0.015 * Math.sin(sceneT * 2.4) : cr.bounce * 0.9;
      cr.open += (target - cr.open) * Math.min(1, dt * (cr.chomp > 0 ? 25 : 9));
      if (cr.blink > 0) { cr.blink += dt; if (cr.blink > 0.15) cr.blink = 0; }
      else if ((cr.nextBlink -= dt) <= 0) { cr.blink = 0.001; cr.nextBlink = 2 + Math.random() * 3; }
    }

    function drawPlay(t, dt) {
      if (scene === 'play') updateSim(dt);
      updateCritter(dt);
      candyAng += sim.vx * dt * 2.2;
      puffAnim = puffAnim.map((k) => (k > 0 ? (k + dt * 4 > 1 ? 0 : k + dt * 4) : 0));
      gravShow += (sim.gdir - gravShow) * Math.min(1, dt * 12);
      if (kShow > 0) kShow -= dt;
      const intro = ease.out(clamp(sceneT / 0.35, 0, 1));
      const tg = targets(), hiT = kShow > 0 && scene === 'play' && tg.length ? tg[kSel % tg.length] : null;

      ctx.save();
      draw.clipCircle(g.R * 0.985);
      ctx.globalAlpha = intro;
      // rails, spikes
      for (const p of sim.pins) drawTrack(p);
      for (const s of sim.spikes) drawSpikes(s);
      // auto-rope rings
      for (const a of sim.autos) {
        if (a.used) continue;
        ctx.save(); ctx.setLineDash([U(0.03), U(0.024)]); ctx.lineDashOffset = -t * U(0.06);
        draw.circle(X(a.pin.x), Y(a.pin.y), U(a.r), THEME.ink(0.035), { stroke: draw.alpha(g.color, THEME.light ? 0.75 : 0.6), lw: Math.max(1.5, U(0.007)) });
        ctx.restore();
      }
      // stars
      for (let i = 0; i < sim.stars.length; i++) {
        const s = sim.stars[i];
        if (s.got) continue;
        const bob = Math.sin(t * 2.5 + i * 1.7) * U(0.012), rot = Math.sin(t * 1.3 + i) * 0.25;
        const pop = ease.back(clamp((sceneT - 0.15 - i * 0.08) / 0.35, 0, 1));
        ctx.save();
        if (THEME.glow) { ctx.shadowColor = STAR; ctx.shadowBlur = U(0.05); }
        star(X(s.x), Y(s.y) + bob, U(STAR_R) * pop, STAR, THEME.light ? STAR_D : null, rot);
        ctx.restore();
        star(X(s.x), Y(s.y) + bob, U(STAR_R) * 0.45 * pop, '#ffe39a', null, rot);
      }
      for (const f of starFx) { f.t += dt; const k = f.t / 0.45; if (k < 1) { ctx.save(); ctx.globalAlpha = 1 - k; star(X(f.x), Y(f.y) - U(0.08) * k, U(STAR_R) * (1 + k * 0.9), STAR); ctx.restore(); } }
      starFx = starFx.filter((f) => f.t < 0.45);
      // free bubbles
      for (const b of sim.bubbles) if (!b.used) drawBubble(X(b.x), Y(b.y), U(BUBBLE_R), t);
      // critter
      drawCritter(t, dt);
      // ropes (and their pins)
      for (const r of sim.ropes) if (r.alive) drawRope(r, hiT && hiT.k === 'rope' && hiT.r === r);
      const seen = new Set();
      for (const r of sim.ropes) { if (!seen.has(r.pin)) { seen.add(r.pin); drawPin(r.pin.x, r.pin.y); } }
      for (const a of sim.autos) if (!seen.has(a.pin)) { seen.add(a.pin); drawPin(a.pin.x, a.pin.y, a.used ? PIN : g.color); }
      for (const p of sim.pins) if (!seen.has(p)) drawPin(p.x, p.y);
      // puffers, flip button
      sim.puffers.forEach((p, i) => drawPuffer(p, i, t, hiT && hiT.k === 'puff' && hiT.i === i));
      drawFlip(t, hiT && hiT.k === 'flip');
      // air puffs
      for (const a of airs) {
        a.t += dt; if (a.t < 0) continue;
        a.x += a.vx * dt; a.y += a.vy * dt; a.vx *= 0.94; a.vy *= 0.94;
        const k = a.t / 0.6; if (k >= 1) continue;
        draw.circle(X(a.x), Y(a.y), U(a.r * (1 + k * 1.5)), THEME.ink(0.28 * (1 - k)));
      }
      airs = airs.filter((a) => a.t < 0.6);
      // the sweet
      if (!sim.gone) {
        let x = X(sim.cx), y = Y(sim.cy), s = 1;
        if (eatT >= 0) {
          eatT += dt;
          const k = ease.out(clamp(eatT / 0.22, 0, 1));
          const mx = X(sim.critter.x), my = Y(sim.critter.y) + U(CRIT_R) * 0.36;
          x += (mx - x) * k; y += (my - y) * k; s = 1 - k;
        }
        if (s > 0.02) {
          drawCandy(x, y, s, candyAng);
          if (sim.bubbled) drawBubble(x, y, U(BUBBLE_R) * 1.12, t);
        }
      }
      for (const p of popFx) { p.t += dt; const k = p.t / 0.3; if (k < 1) draw.circle(X(p.x), Y(p.y), U(BUBBLE_R) * (1.1 + k * 0.6), null, { stroke: THEME.light ? `rgba(40,130,220,${1 - k})` : `rgba(170,220,255,${1 - k})`, lw: 2 }); }
      popFx = popFx.filter((p) => p.t < 0.3);
      // the blade trail
      for (const p of trail) p.t += dt;
      trail = trail.filter((p) => p.t < 0.14);
      if (trail.length > 1) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1], b = trail[i], k = 1 - b.t / 0.14;
          ctx.strokeStyle = THEME.ink(0.85 * k); ctx.lineWidth = U(0.004 + 0.012 * k * (i / trail.length));
          ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
        }
      }
      ctx.restore();
      draw.particles(dt, g.R * 0.8);
      draw.floaters(dt);

      // HUD: level name and the three star slots
      const hy = g.cy - g.R * 0.715;
      draw.text(lvName(lv), g.cx - g.R * 0.2, hy, g.R * 0.058, { color: THEME.ink(0.75) });
      for (let i = 0; i < 3; i++) {
        const x = g.cx + g.R * (0.13 + i * 0.075);
        const got = i < sim.stars3;
        star(x, hy, g.R * 0.03, got ? STAR : null, got ? (THEME.light ? STAR_D : null) : THEME.ink(0.35));
      }
      // bottom buttons
      if (scene === 'play') {
        roundBtn(g.cx - g.R * 0.38, g.cy + g.R * 0.72, g.R * 0.07, 'levels', () => toPicker());
        roundBtn(g.cx + g.R * 0.38, g.cy + g.R * 0.72, g.R * 0.07, 'restart', () => restart());
      }
    }

    function drawDone(t) {
      const k = ease.out(clamp(sceneT / 0.35, 0, 1));
      ctx.save(); ctx.globalAlpha = k;
      draw.circle(g.cx, g.cy, g.R, THEME.paper(0.6));
      rr(g.cx - g.R * 0.56, g.cy - g.R * 0.46, g.R * 1.12, g.R * 0.9, g.R * 0.1, THEME.paper(0.82));
      ctx.restore();
      ctx.save(); ctx.globalAlpha = k;
      const s = result;
      draw.text(s.stars === 3 ? 'Delicious!' : s.stars ? 'Yum!' : 'Fed!', g.cx, g.cy - g.R * 0.33, g.R * 0.1, { color: THEME.fg });
      for (let i = 0; i < 3; i++) {
        const sk = ease.back(clamp((sceneT - 0.2 - i * 0.2) / 0.35, 0, 1));
        const x = g.cx + (i - 1) * g.R * 0.22, y = g.cy - g.R * 0.13 - (i === 1 ? g.R * 0.03 : 0), r = g.R * (i === 1 ? 0.085 : 0.07);
        star(x, y, r, THEME.ink(0.1));
        if (i < s.stars && sk > 0) {
          ctx.save(); if (THEME.glow) { ctx.shadowColor = STAR; ctx.shadowBlur = g.R * 0.05; }
          star(x, y, r * sk, STAR, THEME.light ? STAR_D : null); ctx.restore();
          if (!s[`b${i}`] && sk > 0.6) { s[`b${i}`] = 1; draw.burst(x, y, STAR, 10, g.R * 0.35, g.R * 0.01); g.sfx('coin', { pitch: 1 + i * 0.15, volume: 0.6 }); }
        }
      }
      const tot = totalStars();
      draw.text(`Level ${lvName(lv)}  ·  ★ ${tot} / ${NL * 3}`, g.cx, g.cy + g.R * 0.03, g.R * 0.05, { color: THEME.ink(0.7), weight: 600, font: THEME.font });
      if (s.gain > 0 && !s.first) draw.text(`+${s.gain} ★ new best`, g.cx, g.cy + g.R * 0.1, g.R * 0.045, { color: THEME.light ? '#b97d00' : STAR, weight: 700 });
      ctx.restore();
      if (sceneT > 0.35) {
        const by = g.cy + g.R * 0.25;
        roundBtn(g.cx - g.R * 0.33, by, g.R * 0.075, 'levels', () => toPicker(), { solid: true });
        roundBtn(g.cx - g.R * 0.15, by, g.R * 0.075, 'restart', () => restart(), { solid: true });
        if (s.last) pill(g.cx + g.R * 0.17, by, g.R * 0.36, g.R * 0.14, 'Finish', { primary: true, fn: () => finishRun(true), size: g.R * 0.055 });
        else pill(g.cx + g.R * 0.17, by, g.R * 0.36, g.R * 0.14, 'Next', { primary: true, fn: () => startLevel(lv + 1), size: g.R * 0.058 });
      }
    }

    function drawPicker(t, dt) {
      const a = ease.out(clamp(sceneT / 0.35, 0, 1));
      pageX += (page - pageX) * Math.min(1, dt * 10);
      const ringR = g.R * 0.655, bubR = g.R * 0.118;
      const box = BOXES[page], bcol = box.col;
      ctx.save(); ctx.globalAlpha = a;
      draw.arc(g.cx, g.cy, ringR, TAU * RING_A0 / 360, TAU * (360 - RING_A0) / 360, THEME.ink(0.06), g.R * 0.012);
      const slide = (pageX - page) * g.R * 0.25;
      for (let j = 0; j < PER; j++) {
        const i = page * PER + j;
        if (i >= NL) break;
        const ang = (RING_A0 + j * (360 - 2 * RING_A0) / (PER - 1)) * Math.PI / 180;
        let bx = g.cx + Math.sin(ang) * ringR + slide, by = g.cy - Math.cos(ang) * ringR;
        if (shake.i === i && shake.t > 0) bx += Math.sin(shake.t * 60) * g.R * 0.012 * (shake.t / 0.4);
        const sc = 0.6 + 0.4 * ease.back(clamp((sceneT - j * 0.025) / 0.35, 0, 1));
        const r = bubR * sc;
        const open = unlocked(i), st = prog.s[i];
        if (st != null) draw.circle(bx, by, r, draw.alpha(bcol, THEME.light ? 0.3 : 0.24), { stroke: draw.alpha(bcol, 0.9), lw: 2 });
        else if (open) draw.circle(bx, by, r, THEME.ink(0.1), { stroke: draw.alpha(bcol, 0.6 + 0.4 * Math.sin(t * 4)), lw: 2.5 });
        else draw.circle(bx, by, r, THEME.ink(0.04), { stroke: THEME.ink(0.1), lw: 1.5 });
        if (sel === i) draw.circle(bx, by, r + g.R * 0.022, null, { stroke: THEME.ink(0.85), lw: 2.5 });
        if (open) {
          draw.text(String(j + 1), bx, by - r * (st != null ? 0.16 : 0.02), r * 0.62, { color: THEME.fg });
          if (st != null) for (let k = 0; k < 3; k++) star(bx + (k - 1) * r * 0.34, by + r * 0.45, r * 0.15, k < st ? STAR : null, k < st ? (THEME.light ? STAR_D : null) : THEME.ink(0.35));
        } else lock(bx, by - r * 0.08, r * 0.55, THEME.ink(0.32));
        btns.push({ x: bx, y: by, r: bubR, fn: () => { sel = i; openLevel(i); } });
      }
      // centre: box name, stars, box arrows, Done
      let bs = 0; for (let j = 0; j < PER; j++) bs += prog.s[page * PER + j] || 0;
      draw.text(`Box ${page + 1}`, g.cx, g.cy - g.R * 0.33, g.R * 0.045, { color: THEME.ink(0.55), weight: 600, font: THEME.font });
      draw.text(box.name, g.cx, g.cy - g.R * 0.24, g.R * 0.078, { color: THEME.light ? draw.shade(bcol, -0.35) : bcol });
      star(g.cx - g.R * 0.1, g.cy - g.R * 0.115, g.R * 0.04, STAR);
      draw.text(`${bs} / ${PER * 3}`, g.cx - g.R * 0.04, g.cy - g.R * 0.11, g.R * 0.062, { color: THEME.fg, align: 'left' });
      draw.text(`All boxes  ★ ${totalStars()} / ${NL * 3}`, g.cx, g.cy - g.R * 0.02, g.R * 0.042, { color: THEME.ink(0.6), weight: 600, font: THEME.font });
      // box dots
      for (let b = 0; b < NB; b++) draw.circle(g.cx + (b - (NB - 1) / 2) * g.R * 0.05, g.cy + g.R * 0.065, g.R * (b === page ? 0.013 : 0.009), b === page ? THEME.ink(0.8) : THEME.ink(0.25));
      if (page > 0) roundBtn(g.cx - g.R * 0.36, g.cy - g.R * 0.06, g.R * 0.065, 'left', () => setPage(page - 1));
      if (page < NB - 1) roundBtn(g.cx + g.R * 0.36, g.cy - g.R * 0.06, g.R * 0.065, 'right', () => setPage(page + 1));
      const fy = g.cy + g.R * 0.21;
      pill(g.cx, fy, g.R * 0.4, g.R * 0.13, 'Done', { primary: doneCount() > 0, fn: () => finishRun(false), size: g.R * 0.056 });
      if (sel === NL) { ctx.beginPath(); ctx.roundRect(g.cx - g.R * 0.22, fy - g.R * 0.085, g.R * 0.44, g.R * 0.17, g.R * 0.085); ctx.strokeStyle = THEME.ink(0.85); ctx.lineWidth = 2.5; ctx.stroke(); }
      draw.text('Tap a level  ·  swipe for more boxes', g.cx, g.cy + g.R * 0.36, g.R * 0.036, { color: THEME.ink(0.45), weight: 600, font: THEME.font });
      ctx.restore();
      draw.particles(dt);
    }

    // ------------------------------------------------------------------ frame
    g.loop((dt, t) => {
      sceneT += dt;
      if (shake.t > 0) shake.t -= dt;
      btns.length = 0;
      background(scene === 'pick' ? 0.16 : 0.12);
      if (scene === 'pick') drawPicker(t, dt);
      else {
        drawPlay(t, dt);
        if (scene === 'done') drawDone(t);
      }
    });

    return {};
  },
};
