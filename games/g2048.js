// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// 2048 — swipe to slide every tile; two equal tiles that bump join into their sum.
// Score = the sum of all the tiles you made by joining. Reach 2048 (and keep going).
import { clamp, ease, pick, THEME } from './kit.js';

const N = 4, SLIDE = 0.11, POP = 0.17;

// a warm-to-hot ramp: glassy cream for the small tiles, then gold → the game's orange → red → pink → violet
const STYLE = {
  2: { bg: 'rgba(255,236,214,.13)', fg: '#f5f5f7' },
  4: { bg: 'rgba(255,200,150,.24)', fg: '#fff' },
  8: { bg: '#ffc857', fg: '#2a1800' },
  16: { bg: '#ffb04a', fg: '#2a1400' },
  32: { bg: '#ff9f43', fg: '#2a1000' },
  64: { bg: '#ff7a45', fg: '#fff' },
  128: { bg: '#ff5a6a', fg: '#fff', glow: 0.5 },
  256: { bg: '#ff4d8d', fg: '#fff', glow: 0.6 },
  512: { bg: '#ff6ad5', fg: '#fff', glow: 0.7 },
  1024: { bg: '#b57bff', fg: '#fff', glow: 0.8 },
  2048: { bg: '#fff1c1', fg: '#3a2200', glow: 1.2 },
  4096: { bg: '#2ee6d6', fg: '#03201d', glow: 1 },
  8192: { bg: '#4d9bff', fg: '#fff', glow: 1 },
};
// Light mode: the two glassy small tiles become solid warm creams with dark numbers
const STYLE_LIGHT = {
  2: { bg: '#f1e4d3', fg: '#5e4a36' },
  4: { bg: '#f3d3b0', fg: '#5a3818' },
};
const style = (v) => (THEME.light && STYLE_LIGHT[v]) || STYLE[v] || { bg: '#f5f5f7', fg: '#111', glow: 1 };

export default {
  howTo: 'Swipe (or use the arrow keys) to slide all tiles. Two equal tiles that meet join into one. Make 2048!',
  scoring: 'high',
  create(g) {
    const { draw } = g;
    let grid = Array.from({ length: N }, () => new Array(N).fill(null)); // tiles: { v, r, c, fr, fc, t0, show }
    let ghosts = [];          // tiles that merged away, sliding into their partner
    let now = 0, nextId = 1, best = 2, won = false, over = false, overT = 0, moves = 0;
    let nudge = { dx: 0, dy: 0, t: 1 };
    const pendingFx = [];     // particle bursts waiting for their merge to land

    const L = () => {
      const s = g.R * 1.2, gap = s * 0.03;
      return { s, gap, x0: g.cx - s / 2, y0: g.cy + g.R * 0.09 - s / 2, ts: (s - gap * (N + 1)) / N };
    };
    const cellXY = (r, c) => { const { x0, y0, gap, ts } = L(); return [x0 + gap + c * (ts + gap), y0 + gap + r * (ts + gap)]; };

    function spawn(at) {
      const free = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) free.push([r, c]);
      if (!free.length) return;
      const [r, c] = pick(free);
      grid[r][c] = { id: nextId++, v: Math.random() < 0.9 ? 2 : 4, r, c, fr: r, fc: c, t0: at, born: at, pop: 0 };
    }
    spawn(0.05); spawn(0.15);

    function canMove() {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const t = grid[r][c];
        if (!t) return true;
        if (c < N - 1 && grid[r][c + 1]?.v === t.v) return true;
        if (r < N - 1 && grid[r + 1][c]?.v === t.v) return true;
      }
      return false;
    }

    function move(dir) {
      if (over) return;
      const dr = dir === 'up' ? -1 : dir === 'down' ? 1 : 0, dc = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      // finish whatever was still animating
      ghosts = [];
      for (const row of grid) for (const t of row) if (t) { t.fr = t.r; t.fc = t.c; t.born = Math.min(t.born, now); t.pop = Math.min(t.pop, now); }
      const next = Array.from({ length: N }, () => new Array(N).fill(null));
      let moved = false, gained = 0, top = 0;
      for (let line = 0; line < N; line++) {
        // the cells of this line, from the far edge (where tiles slide to) backwards
        const cells = [];
        for (let k = 0; k < N; k++) {
          const i = dr || dc ? (dr + dc > 0 ? N - 1 - k : k) : k;
          cells.push(dr ? [i, line] : [line, i]);
        }
        let slot = 0, last = null;
        for (const [r, c] of cells) {
          const t = grid[r][c];
          if (!t) continue;
          if (last && last.v === t.v && !last.merged) {
            // join: t slides into last's cell and disappears; last doubles (and pops when the slide ends)
            const [tr, tc] = [last.r, last.c];
            ghosts.push({ ...t, fr: t.r, fc: t.c, r: tr, c: tc, t0: now });
            last.v *= 2; last.merged = true; last.pop = now + SLIDE;
            gained += last.v; top = Math.max(top, last.v);
            moved = true;
            continue;
          }
          const [tr, tc] = cells[slot++];
          if (tr !== r || tc !== c) moved = true;
          t.fr = r; t.fc = c; t.r = tr; t.c = tc; t.t0 = now;
          next[tr][tc] = t;
          last = t;
        }
      }
      if (!moved) { nudge = { dx: dc, dy: dr, t: 0 }; return; }
      grid = next;
      for (const row of grid) for (const t of row) if (t) t.merged = false;
      moves++;
      spawn(now + SLIDE);
      if (gained) {
        g.add(gained);
        g.sfx('pop', { pitch: 0.75 + Math.log2(top) * 0.06, volume: 0.8 });
        if (top >= 64) {
          for (const row of grid) for (const t of row) if (t && t.v === top && t.pop > now) {
            const [x, y] = cellXY(t.r, t.c), { ts } = L();
            pendingFx.push({ at: now + SLIDE, x: x + ts / 2, y: y + ts / 2, col: style(top).bg, n: top >= 512 ? 22 : 12 });
          }
        }
        if (top > best) best = top;
        if (top >= 2048 && !won) { won = true; g.toast('2048!', 2200); g.sfx('perfect'); g.vibrate(60); }
      } else g.sfx('tick');
      if (!canMove()) {
        over = true; overT = 0;
        g.over(g.scoreValue, { note: `Best tile ${best}`, label: `${best}`, title: 'No more moves', delay: 1500 });
      }
    }
    g.on('swipe', (e) => move(e.dir));
    g.on('key', ({ key }) => {
      const k = key.length === 1 ? key.toLowerCase() : key;
      const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' }[k];
      if (dir) move(dir);
    });

    // the glassy sheen: one gradient in tile-local coordinates (0…ts), rebuilt only when the size or theme changes
    let sheen = null, sheenKey = '';
    function sheenFor(ts) {
      const key = `${ts}|${THEME.id}|${THEME.mode}`;
      if (key !== sheenKey) {
        sheenKey = key; sheen = null;
        if (!THEME.flat) {
          sheen = g.ctx.createLinearGradient(0, 0, 0, ts);
          sheen.addColorStop(0, 'rgba(255,255,255,.22)'); sheen.addColorStop(0.5, 'rgba(255,255,255,.04)'); sheen.addColorStop(1, 'rgba(0,0,0,.08)');
        }
      }
      return sheen;
    }
    function tile(v, x, y, ts, scale, alpha = 1) {
      const { ctx } = g;
      const st = style(v), rr = ts * 0.14;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x + ts / 2, y + ts / 2); ctx.scale(scale, scale); ctx.translate(-ts / 2, -ts / 2);
      if (st.glow && THEME.glow) { ctx.shadowColor = st.bg; ctx.shadowBlur = g.R * 0.06 * st.glow * scale; }
      ctx.beginPath(); ctx.roundRect(0, 0, ts, ts, rr);
      ctx.fillStyle = st.bg; ctx.fill();
      ctx.shadowBlur = 0;
      const gr = sheenFor(ts);
      if (gr) { ctx.fillStyle = gr; ctx.fill(); }
      ctx.strokeStyle = THEME.light ? THEME.ink(0.1) : 'rgba(255,255,255,.14)'; ctx.lineWidth = Math.max(1, g.R * 0.004) / scale; ctx.stroke();
      const digits = String(v).length;
      const fs = ts * (digits <= 2 ? 0.46 : digits === 3 ? 0.38 : digits === 4 ? 0.3 : 0.24);
      ctx.font = `700 ${fs}px ${THEME.display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = st.fg;
      ctx.fillText(String(v), ts / 2, ts / 2 + fs * 0.04);
      ctx.restore();
    }

    g.loop((dt) => {
      now += dt;
      const { ctx } = g;
      const { s, x0, y0, ts } = L();
      if (over) overT += dt;
      nudge.t += dt;
      for (let i = pendingFx.length - 1; i >= 0; i--) {
        const f = pendingFx[i];
        if (now >= f.at) { draw.burst(f.x, f.y, f.col, f.n, g.R * 0.45, g.R * 0.012); pendingFx.splice(i, 1); }
      }

      draw.bg({ glow: 0.15, glowAt: [0, 0.09] });
      // a little bump when a swipe does nothing
      const nk = nudge.t < 0.22 ? Math.sin((nudge.t / 0.22) * Math.PI) * g.R * 0.018 : 0;
      ctx.save();
      ctx.translate(nudge.dx * nk, nudge.dy * nk);

      // the board and its empty slots
      const lt = THEME.light;
      draw.roundRect(x0, y0, s, s, s * 0.06, THEME.ink(lt ? 0.06 : 0.055), { stroke: THEME.ink(lt ? 0.12 : 0.1), lw: Math.max(1, g.R * 0.005) });
      ctx.fillStyle = THEME.ink(lt ? 0.07 : 0.05);
      ctx.beginPath();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const [x, y] = cellXY(r, c);
        ctx.roundRect(x, y, ts, ts, ts * 0.14);
      }
      ctx.fill();
      const pos = (t) => {
        const e = ease.out(clamp((now - t.t0) / SLIDE, 0, 1));
        const [ax, ay] = cellXY(t.fr, t.fc), [bx, by] = cellXY(t.r, t.c);
        return [ax + (bx - ax) * e, ay + (by - ay) * e];
      };
      // tiles merging away slide under their partner
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const t = ghosts[i];
        if (now - t.t0 > SLIDE) { ghosts.splice(i, 1); continue; }
        const [x, y] = pos(t);
        tile(t.v, x, y, ts, 1);
      }
      for (const row of grid) for (const t of row) {
        if (!t) continue;
        if (now < t.born) continue;                 // a new tile appears once the slide is over
        const [x, y] = pos(t);
        let scale = 1, v = t.v;
        const bt = now - t.born;
        if (bt < POP && t.born > 0) scale = ease.back(clamp(bt / POP, 0, 1)) * 0.9 + 0.1;
        if (t.pop && now < t.pop) v = t.v / 2;      // still the old value while sliding into the merge
        else if (t.pop && now - t.pop < POP) scale = 1 + 0.18 * Math.sin(((now - t.pop) / POP) * Math.PI);
        tile(v, x, y, ts, scale);
      }
      ctx.restore();

      if (over) {
        const a = clamp(overT / 0.6, 0, 1);
        draw.roundRect(x0, y0, s, s, s * 0.06, THEME.paper((THEME.light ? 0.7 : 0.55) * a));
        draw.text('No more moves', g.cx, y0 + s / 2, g.R * 0.09, { alpha: a, glow: g.R * 0.04, color: THEME.fg });
      }
      draw.particles(dt);
      draw.floaters(dt);
    });
    return {};
  },
};
