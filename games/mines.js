// Minesweeper — a round minefield. The field is a dartboard: concentric rings split into sectors
// (inner rings have fewer, so every cell stays about the same size). A cell's neighbours are the cells
// left and right of it on its ring plus every cell of the rings inside / outside whose span overlaps or
// touches its own. Tap to dig, hold (or flag mode in the centre) to flag, tap a satisfied number to chord.
import { TAU, clamp, rand, ease } from './kit.js';

const LEVELS = {
  easy:   { rings: 4, w: 1.12, mines: 10, name: 'Easy' },
  medium: { rings: 5, w: 1.08, mines: 19, name: 'Medium' },
  hard:   { rings: 6, w: 1.04, mines: 32, name: 'Hard' },
};
const IN = 0.215, OUT = 0.9;          // the field, × R (the disc inside IN is the status button)
const NOTCH = 0.8;                    // rings reaching past this (× R) leave a gap for the pause button
const NUM = ['', '#4d9bff', '#3ddc84', '#ff5a6a', '#b57bff', '#ff9f43', '#2ee6d6', '#ff8ad8', '#ffc857', '#f5f5f7', '#f5f5f7', '#f5f5f7', '#f5f5f7'];
const FLAG = '#ff5a6a';
const HALF_PI = Math.PI / 2;

const clock = (n) => { n = Math.round(n * 10) / 10; if (n < 60) return n.toFixed(1); const m = Math.floor(n / 60); return `${m}:${(n - m * 60).toFixed(1).padStart(4, '0')}`; };
const fmt = (n) => (Math.round(n * 10) / 10 < 60 ? `${clock(n)} s` : clock(n));

/** Does the span a0…a1 (radians, any turn) overlap the span -hw…hw around 12 o'clock? */
function hitsTop(a0, a1, hw) {
  for (const s of [-TAU, 0, TAU]) if (a0 + s < hw && a1 + s > -hw) return true;
  return false;
}
/** Do two angular spans overlap or touch (modulo a full turn)? */
function spansMeet(a, b) {
  const eps = 1e-6;
  for (const s of [-TAU, 0, TAU]) if (b.a0 + s <= a.a1 + eps && b.a1 + s >= a.a0 - eps) return true;
  return false;
}

/** Build the polar grid for a level: rings[k] = { r0, r1, n, step, off, cells[] }, cells (flat list). */
function buildField(lv) {
  const t = (OUT - IN) / lv.rings;
  const rings = [], cells = [];
  for (let k = 0; k < lv.rings; k++) {
    const r0 = IN + k * t, r1 = r0 + t, rm = (r0 + r1) / 2;
    const n = Math.max(6, Math.round((TAU * rm) / (t * lv.w)));
    const step = TAU / n;
    let off = k % 2 ? step / 2 : 0;
    const hw = 0.1 / r0;
    const blocked = (o, i) => r1 > NOTCH && hitsTop(o + i * step, o + (i + 1) * step, hw);
    if (r1 > NOTCH) {      // pick the rotation that hides the fewest cells under the pause button
      const count = (o) => { let c = 0; for (let i = 0; i < n; i++) if (blocked(o, i)) c++; return c; };
      off = count(0) <= count(step / 2) ? 0 : step / 2;
    }
    const ring = { k, r0, r1, rm, n, step, off, cells: [] };
    for (let i = 0; i < n; i++) {
      if (blocked(off, i)) { ring.cells.push(null); continue; }
      const a0 = off + i * step, a1 = a0 + step;
      const c = { id: cells.length, k, i, r0, r1, rm, a0, a1, am: (a0 + a1) / 2, nb: [], mine: false, open: false, flag: false, n: 0, t: 0, ft: -9, boomT: -1, boomed: false, wrong: false, path: null, x: 0, y: 0 };
      ring.cells.push(c); cells.push(c);
    }
    rings.push(ring);
  }
  // neighbours: left / right on the ring, and every overlapping-or-touching cell on the rings next to it
  for (const ring of rings) {
    for (const c of ring.cells) {
      if (!c) continue;
      for (const j of [c.i - 1, c.i + 1]) {
        const d = ring.cells[(j + ring.n) % ring.n];
        if (d && d !== c && !c.nb.includes(d.id)) c.nb.push(d.id);
      }
      const out = rings[ring.k + 1];
      if (out) for (const d of out.cells) if (d && spansMeet(c, d)) { c.nb.push(d.id); d.nb.push(c.id); }
    }
  }
  return { rings, cells, t };
}

export default {
  howTo: 'Tap to dig, hold to plant a flag (or switch to flag mode in the centre). Numbers count the mines touching a cell — ring neighbours included.',
  modes: [{ id: 'easy', name: 'Easy' }, { id: 'medium', name: 'Medium' }, { id: 'hard', name: 'Hard' }],
  scoring: 'low',
  format: fmt,
  hud: false,
  create(g, { mode }) {
    const lv = LEVELS[mode] || LEVELS.easy;
    const { rings, cells, t: thick } = buildField(lv);
    const safeTotal = cells.length - lv.mines;

    let phase = 'ready';          // ready → play → won | lost
    let now = 0, elapsed = 0, flagMode = false, flags = 0, opened = 0;
    let press = null, cursor = null, kbOn = false, shake = 0, lastBoomSfx = -1, loseEnd = 0, overSfx = false, winT = 0;
    let built = '';
    const waves = [];             // shock rings { x, y, t0, max, col }

    // ---------- geometry ----------
    function rebuild() {
      const { cx, cy, R } = g;
      const G = Math.max(2, R * 0.012);
      for (const c of cells) {
        const ri = c.r0 * R + G / 2, ro = c.r1 * R - G / 2;
        const p = new Path2D();
        p.arc(cx, cy, ro, c.a0 + G / 2 / ro - HALF_PI, c.a1 - G / 2 / ro - HALF_PI);
        p.arc(cx, cy, ri, c.a1 - G / 2 / ri - HALF_PI, c.a0 + G / 2 / ri - HALF_PI, true);
        p.closePath();
        c.path = p;
        c.x = cx + Math.sin(c.am) * c.rm * R; c.y = cy - Math.cos(c.am) * c.rm * R;
      }
      built = `${R}|${cx}|${cy}`;
    }
    g.on('resize', rebuild);

    function cellAt(p) {
      const k = Math.floor((p.r - IN) / thick);
      const ring = rings[k];
      if (!ring) return null;
      const a = (((p.a - ring.off) % TAU) + TAU) % TAU;
      return ring.cells[Math.floor(a / ring.step) % ring.n] || null;
    }

    // ---------- rules ----------
    function layMines(first) {
      const keep = new Set([first.id, ...first.nb]);
      const pool = cells.filter((c) => !keep.has(c.id));
      for (let m = 0; m < lv.mines && pool.length; m++) {
        const j = Math.floor(Math.random() * pool.length);
        pool[j].mine = true; pool.splice(j, 1);
      }
      for (const c of cells) c.n = c.nb.reduce((s, j) => s + (cells[j].mine ? 1 : 0), 0);
    }

    function reveal(start) {
      if (start.open || start.flag) return;
      if (phase === 'ready') { layMines(start); phase = 'play'; }
      if (start.mine) { lose(start); return; }
      const q = [start]; start.open = true; start.t = now; start.d = 0;
      let count = 0;
      for (let qi = 0; qi < q.length; qi++) {
        const c = q[qi]; count++;
        if (c.n !== 0) continue;
        for (const j of c.nb) {
          const e = cells[j];
          if (e.open || e.flag || e.mine) continue;
          e.open = true; e.d = c.d + 1; e.t = now + e.d * 0.035; q.push(e);
        }
      }
      opened += count;
      g.sfx(count > 1 ? 'whoosh' : 'tap', { pitch: count > 1 ? 1 : rand(0.9, 1.15) });
      if (count > 6) g.vibrate(10);
      if (opened >= safeTotal) win();
    }

    function chord(c) {
      const around = c.nb.map((j) => cells[j]);
      if (around.filter((e) => e.flag).length !== c.n) { g.sfx('click'); return; }
      const todo = around.filter((e) => !e.open && !e.flag);
      if (!todo.length) return;
      const bad = todo.find((e) => e.mine);
      if (bad) { lose(bad); return; }
      for (const e of todo) if (phase === 'play') reveal(e);
    }

    function toggleFlag(c) {
      if (!c || c.open || phase === 'won' || phase === 'lost') return;
      c.flag = !c.flag; c.ft = now;
      flags += c.flag ? 1 : -1;
      g.sfx(c.flag ? 'place' : 'drop', { volume: 0.8 }); g.vibrate(15);
    }

    function lose(hit) {
      phase = 'lost';
      hit.open = true; hit.boomT = now; hit.hit = true;
      const others = cells.filter((c) => c.mine && !c.flag && c !== hit)
        .sort((a, b) => Math.hypot(a.x - hit.x, a.y - hit.y) - Math.hypot(b.x - hit.x, b.y - hit.y));
      const step = Math.min(0.09, 1.6 / Math.max(1, others.length));
      others.forEach((c, i) => { c.boomT = now + 0.45 + i * step; });
      for (const c of cells) if (c.flag && !c.mine) c.wrong = true;
      loseEnd = now + 0.45 + others.length * step + 0.35;
      g.over(null, { title: 'Boom!', note: `${opened} of ${safeTotal} safe cells cleared.`, delay: (loseEnd - now + 1) * 1000, sfx: false });
    }

    function win() {
      phase = 'won'; winT = now;
      const score = Math.round(elapsed * 10) / 10;
      let i = 0;
      for (const c of cells) if (c.mine && !c.flag) { c.flag = true; c.ft = now + 0.25 + (i++) * 0.04; }
      flags = lv.mines;
      g.over(score, { win: true, label: lv.name, note: `All ${lv.mines} mines found.`, delay: 2000 });
    }

    // ---------- input ----------
    function act(c, wantFlag) {
      if (phase === 'won' || phase === 'lost' || !c) return;
      if (c.open) { if (c.n > 0 && (now - c.t) > 0.05) chord(c); return; }
      if (wantFlag) toggleFlag(c);
      else if (!c.flag) reveal(c);
      else g.sfx('click');
    }
    g.on('tap', (p) => {
      if (phase === 'won' || phase === 'lost') return;
      if (p.r < IN) { flagMode = !flagMode; g.sfx('click'); g.vibrate(8); return; }
      kbOn = false;
      act(cellAt(p), flagMode);
    });
    g.on('hold', (p) => {
      press = null;
      if (p.r < IN) return;
      const c = cellAt(p);
      if (c && !c.open) toggleFlag(c);
    });
    g.on('down', (p) => {
      const c = p.r >= IN ? cellAt(p) : null;
      press = { c, x: p.x, y: p.y, t0: now, centre: p.r < IN };
    });
    g.on('move', (p) => { if (press && Math.hypot(p.x - press.x, p.y - press.y) > g.R * 0.06) press = null; });
    g.on('up', () => { press = null; });

    function moveCursor(dRing, dSide) {
      if (!cursor) { cursor = rings[Math.min(1, rings.length - 1)].cells.find(Boolean); return; }
      if (dSide) {
        const ring = rings[cursor.k];
        for (let s = 1; s <= ring.n; s++) {
          const d = ring.cells[(cursor.i + dSide * s + ring.n * 2) % ring.n];
          if (d) { cursor = d; return; }
        }
      }
      if (dRing) {
        const ring = rings[cursor.k + dRing];
        if (!ring) return;
        let best = null, bd = 9;
        for (const d of ring.cells) {
          if (!d) continue;
          const diff = Math.abs(((d.am - cursor.am + Math.PI * 3) % TAU) - Math.PI);
          if (diff < bd) { bd = diff; best = d; }
        }
        if (best) cursor = best;
      }
    }
    g.on('key', (e) => {
      if (phase === 'won' || phase === 'lost') return;
      const k = e.key;
      const moves = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (moves[k]) { if (kbOn) moveCursor(...moves[k]); else moveCursor(0, 0); kbOn = true; g.sfx('tick'); return; }
      if (!kbOn || !cursor) { if (k === ' ' || k === 'Enter' || k === 'f') { kbOn = true; moveCursor(0, 0); } return; }
      if (k === ' ' || k === 'Enter') act(cursor, flagMode);
      else if (k === 'f' || k === 'F') { if (!cursor.open) toggleFlag(cursor); }
      else if (k === 'm' || k === 'M') { flagMode = !flagMode; g.sfx('click'); }
    });
    g.on('wheel', (e) => { kbOn = true; if (!cursor) moveCursor(0, 0); else moveCursor(0, e.delta); g.sfx('tick'); });

    g.toast('Tap to dig · hold to flag', 1800);

    // ---------- drawing ----------
    function drawFlag(x, y, s, a = 1, wrong = false) {
      const { ctx } = g;
      ctx.save(); ctx.translate(x, y); ctx.globalAlpha = a;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1.5, s * 0.13);
      ctx.beginPath(); ctx.moveTo(-s * 0.28, s * 0.62); ctx.lineTo(-s * 0.28, -s * 0.66); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s * 0.52, s * 0.64); ctx.lineTo(-s * 0.02, s * 0.64); ctx.stroke();
      ctx.fillStyle = FLAG;
      ctx.beginPath(); ctx.moveTo(-s * 0.24, -s * 0.7);
      ctx.quadraticCurveTo(s * 0.2, -s * 0.56, s * 0.66, -s * 0.38);
      ctx.quadraticCurveTo(s * 0.2, -s * 0.2, -s * 0.24, -s * 0.06);
      ctx.closePath(); ctx.fill();
      if (wrong) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, s * 0.16);
        ctx.beginPath(); ctx.moveTo(-s * 0.6, -s * 0.6); ctx.lineTo(s * 0.6, s * 0.6); ctx.moveTo(s * 0.6, -s * 0.6); ctx.lineTo(-s * 0.6, s * 0.6); ctx.stroke();
      }
      ctx.restore();
    }
    function drawMine(x, y, s, hot = 0) {
      const { ctx } = g;
      ctx.save(); ctx.translate(x, y);
      // flat: one solid colour for the spikes and the round body
      const col = hot ? '#ffb347' : '#cdd3e0';
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, s * 0.14); ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; ctx.moveTo(Math.cos(a) * s * 0.3, Math.sin(a) * s * 0.3); ctx.lineTo(Math.cos(a) * s * 0.92, Math.sin(a) * s * 0.92); }
      ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.fill();
      ctx.restore();
    }

    g.loop((dt) => {
      now += dt;
      if (phase === 'play') elapsed += dt;
      if (built !== `${g.R}|${g.cx}|${g.cy}`) rebuild();
      const { ctx, cx, cy, R } = g;
      const A = g.draw.alpha;

      // explosions of the loss cascade
      if (phase === 'lost') {
        for (const c of cells) {
          if (!c.mine || c.boomed || c.boomT < 0 || now < c.boomT) continue;
          c.boomed = true; c.open = true;
          g.draw.burst(c.x, c.y, c.hit ? '#ffb347' : pickHot(), c.hit ? 34 : 14, R * (c.hit ? 0.75 : 0.42), R * 0.012);
          waves.push({ x: c.x, y: c.y, t0: now, max: R * (c.hit ? 0.5 : 0.2), col: c.hit ? '#ffb347' : '#ff7a45' });
          shake = Math.min(1, shake + (c.hit ? 1 : 0.28));
          if (now - lastBoomSfx > 0.08) { g.sfx('boom', { volume: c.hit ? 1 : 0.45, pitch: c.hit ? 1 : rand(0.8, 1.4) }); lastBoomSfx = now; }
          if (c.hit) g.vibrate(90);
        }
        if (!overSfx && now >= loseEnd) { overSfx = true; g.sfx('over'); }
      }
      shake = Math.max(0, shake - dt * 2.2);

      // ---- draw ----
      g.draw.bg({ glow: phase === 'won' ? 0.24 : 0.15 });
      ctx.save();
      if (shake > 0) ctx.translate(rand(-1, 1) * shake * R * 0.02, rand(-1, 1) * shake * R * 0.02);

      // the field behind the cells
      ctx.beginPath(); ctx.arc(cx, cy, OUT * R + R * 0.012, 0, TAU); ctx.arc(cx, cy, IN * R - R * 0.006, 0, TAU, true);
      ctx.fillStyle = 'rgba(255,255,255,.018)'; ctx.fill();

      const closed = ctx.createRadialGradient(cx, cy, IN * R, cx, cy, OUT * R);
      closed.addColorStop(0, A(g.color, 0.3)); closed.addColorStop(1, A(g.color, 0.14));
      const lit = ctx.createRadialGradient(cx, cy, IN * R, cx, cy, OUT * R);
      lit.addColorStop(0, 'rgba(255,255,255,.34)'); lit.addColorStop(1, A(g.color, 0.42));
      const pressed = press && press.c && !press.c.open ? press.c : null;

      // pass 1: cell bodies
      ctx.lineWidth = 1; ctx.lineJoin = 'round';
      for (const c of cells) {
        const showOpen = c.open && now >= c.t && !(c.mine && !c.boomed);
        if (!showOpen) {
          ctx.fillStyle = c === pressed ? lit : closed; ctx.fill(c.path);
          ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.stroke(c.path);
        } else {
          const k = clamp((now - c.t) / 0.28, 0, 1);
          ctx.fillStyle = c.mine ? (c.hit ? 'rgba(255,90,106,.42)' : 'rgba(255,122,69,.13)') : c.n ? A(NUM[c.n], 0.055) : 'rgba(255,255,255,.028)';
          ctx.fill(c.path);
          if (k < 1) { ctx.fillStyle = `rgba(255,255,255,${0.42 * (1 - k)})`; ctx.fill(c.path); }
        }
      }
      // win: a wave of light rolling outwards
      if (phase === 'won') {
        const w = (now - winT) * 1.4 + IN - 0.1;
        for (const c of cells) {
          const k = 1 - Math.abs(w - c.rm) / 0.16;
          if (k > 0) { ctx.fillStyle = A(g.color, 0.4 * k); ctx.fill(c.path); }
        }
      }

      // pass 2: contents
      const cs = Math.min(thick * R, (TAU * (IN + thick / 2) * R) / rings[0].n);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(thick * R * 0.46)}px ${g.theme.display}`;
      for (const c of cells) {
        if (c.open && now >= c.t && !c.mine && c.n) {
          const k = ease.back(clamp((now - c.t) / 0.3, 0, 1));
          if (k < 1) { ctx.save(); ctx.translate(c.x, c.y); ctx.scale(k, k); ctx.fillStyle = NUM[c.n]; ctx.fillText(String(c.n), 0, 1); ctx.restore(); }
          else { ctx.fillStyle = NUM[c.n]; ctx.fillText(String(c.n), c.x, c.y + 1); }
        }
      }
      for (const c of cells) {
        if (c.mine && c.boomed) drawMine(c.x, c.y, cs * 0.3 * (1 + 0.3 * Math.max(0, 1 - (now - c.boomT) * 4)), c.hit ? 1 : 0);
        else if (c.flag && now >= c.ft) {
          const k = ease.back(clamp((now - c.ft) / 0.25, 0, 1));
          drawFlag(c.x, c.y, cs * 0.3 * Math.max(0.01, k), 1, c.wrong && phase === 'lost' && now > loseEnd - 0.3);
        }
      }

      // keyboard cursor
      if (kbOn && cursor && phase !== 'won' && phase !== 'lost') {
        ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, R * 0.009); ctx.shadowColor = g.color; ctx.shadowBlur = R * 0.04;
        ctx.stroke(cursor.path); ctx.restore();
      }
      // holding on a cell: a ring fills up until the flag drops in
      if (press && press.c && !press.c.open && !flagMode && phase !== 'won' && phase !== 'lost') {
        const k = clamp((now - press.t0 - 0.12) / 0.33, 0, 1);
        if (k > 0) {
          g.draw.arc(press.x, press.y, R * 0.085, 0, TAU, 'rgba(255,255,255,.12)', R * 0.012);
          g.draw.arc(press.x, press.y, R * 0.085, 0, TAU * k, FLAG, R * 0.012);
        }
      }

      // shock rings
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i], k = (now - w.t0) / 0.55;
        if (k >= 1) { waves.splice(i, 1); continue; }
        ctx.beginPath(); ctx.arc(w.x, w.y, w.max * ease.out(k), 0, TAU);
        ctx.strokeStyle = A(w.col, 0.7 * (1 - k)); ctx.lineWidth = R * 0.012 * (1 - k) + 1; ctx.stroke();
      }

      drawCentre();
      ctx.restore();
      g.draw.particles(dt);
      g.draw.floaters(dt);
    });

    const HOT = ['#ff7a45', '#ffb347', '#ff5a6a', '#ffc857'];
    function pickHot() { return HOT[Math.floor(Math.random() * HOT.length)]; }

    function drawCentre() {
      const { ctx, cx, cy, R } = g;
      const rr = IN * R - R * 0.022;
      const lost = phase === 'lost', won = phase === 'won';
      const tint = lost ? '#ff5a6a' : won ? '#3ddc84' : flagMode ? FLAG : g.color;
      ctx.save();
      // flat centre disc: one solid tinted fill and a solid rim
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU);
      ctx.fillStyle = g.draw.alpha(tint, flagMode || lost || won ? 0.2 : 0.12); ctx.fill();
      ctx.lineWidth = Math.max(1.5, R * 0.007);
      ctx.strokeStyle = flagMode || lost || won ? g.draw.alpha(tint, 0.85) : 'rgba(255,255,255,.18)'; ctx.stroke();
      ctx.restore();
      // timer
      g.draw.text(clock(elapsed), cx, cy - rr * 0.5, rr * 0.25, { color: won ? '#3ddc84' : g.theme.muted, weight: 600 });
      // mines left
      const left = lv.mines - flags;
      drawMine(cx - rr * 0.36, cy + rr * 0.01, rr * 0.2, lost ? 1 : 0);
      g.draw.text(String(left), cx + rr * 0.14, cy + rr * 0.03, rr * 0.46, { color: left < 0 ? '#ff5a6a' : '#fff' });
      // flag-mode switch
      const fy = cy + rr * 0.58;
      if (flagMode) g.draw.roundRect(cx - rr * 0.36, fy - rr * 0.2, rr * 0.72, rr * 0.4, rr * 0.2, g.draw.alpha(FLAG, 0.22), { stroke: g.draw.alpha(FLAG, 0.7), lw: 1.5 });
      drawFlag(cx - rr * 0.12, fy + rr * 0.02, rr * 0.2, flagMode ? 1 : 0.45);
      g.draw.text(flagMode ? 'ON' : 'OFF', cx + rr * 0.16, fy + rr * 0.01, rr * 0.15, { color: flagMode ? '#fff' : g.theme.dim, weight: 800 });
    }

    return {};
  },
};
