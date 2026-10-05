// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Tic Tac Toe — the classic 3×3, drawn as glowing neon strokes on the round screen.
// 1P vs COM (Easy / Normal / Hard): a run of rounds, win +3, draw +1, until COM wins.
// 2 players on one screen: first to 3 wins; fewer rounds = a more dominant win.
import { TAU, clamp, ease, pick, rand, THEME } from './kit.js';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const X = 1, O = 2;
const COL = { [X]: '#ff6a5c', [O]: '#2ee6d6' };
const NAME = { [X]: 'X', [O]: 'O' };

/** { p, line } when someone has three in a row, { p: 0 } on a full board, else null. */
function outcome(b) {
  for (const l of LINES) { const v = b[l[0]]; if (v && v === b[l[1]] && v === b[l[2]]) return { p: v, line: l }; }
  for (let i = 0; i < 9; i++) if (!b[i]) return null;
  return { p: 0, line: null };
}

// ---- perfect play: negamax with a memo (scores are absolute: faster wins score higher) ----
const memo = new Map();
function negamax(b, p) {
  let key = p;
  for (let i = 0; i < 9; i++) key = key * 3 + b[i];
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let best = -Infinity, empties = 0;
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    empties++;
    b[i] = p;
    const o = outcome(b);
    let s;
    if (o) s = o.p ? 1 + countEmpty(b) : 0; // the mover just won (or drew)
    else s = -negamax(b, 3 - p);
    b[i] = 0;
    if (s > best) best = s;
  }
  if (!empties) best = 0;
  memo.set(key, best);
  return best;
}
function countEmpty(b) { let n = 0; for (let i = 0; i < 9; i++) if (!b[i]) n++; return n; }
function scoredMoves(b, p) {
  const out = [];
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = p;
    const o = outcome(b);
    const s = o ? (o.p ? 1 + countEmpty(b) : 0) : -negamax(b, 3 - p);
    b[i] = 0;
    out.push({ i, s });
  }
  return out;
}
const empty = (b) => { const r = []; for (let i = 0; i < 9; i++) if (!b[i]) r.push(i); return r; };
/** A cell that completes a line for player p, or -1. */
function finisher(b, p) {
  for (const l of LINES) {
    let mine = 0, gap = -1;
    for (const i of l) { if (b[i] === p) mine++; else if (!b[i]) gap = i; }
    if (mine === 2 && gap >= 0) return gap;
  }
  return -1;
}
function bestOf(b, p) {
  if (countEmpty(b) === 9) return pick([0, 2, 6, 8, 4]); // every opening draws with perfect play
  const ms = scoredMoves(b, p);
  const top = Math.max(...ms.map((m) => m.s));
  return pick(ms.filter((m) => m.s === top)).i;
}
function comMove(b, p, level) {
  const win = finisher(b, p), block = finisher(b, 3 - p);
  if (level === 'easy') {
    if (win >= 0 && Math.random() < 0.35) return win;
    if (block >= 0 && Math.random() < 0.2) return block;
    return pick(empty(b));
  }
  if (level === 'normal') {
    if (win >= 0 && Math.random() < 0.92) return win;
    if (block >= 0 && Math.random() < 0.8) return block;
    if (Math.random() < 0.4) return pick(empty(b));
    return bestOf(b, p);
  }
  return bestOf(b, p);
}

export default {
  howTo: 'Tap a square to play. Line up three to win the round. Vs COM: win +3, draw +1 — the run ends when COM wins.',
  modes: [
    { id: '1p-easy', name: '1P vs COM · Easy' },
    { id: '1p-normal', name: '1P vs COM · Normal' },
    { id: '1p-hard', name: '1P vs COM · Hard' },
    { id: '2p', name: '2 players', scoring: 'low', unit: 'rounds' },
  ],
  scoring: 'high',
  unit: 'pts',
  create(g, { mode }) {
    const { draw } = g;
    const two = mode === '2p';
    const level = two ? null : (mode || '1p-normal').slice(3);
    const HUMAN = X, CPU = O;

    let board = new Array(9).fill(0);
    let cells = new Array(9).fill(null);     // { p, t } drawing state per cell
    let round = 0, turn = X, phase = 'play'; // play → result → clear → play …
    let wait = 0, think = 0, res = null, resT = 0, clearT = 0, gridT = 0;
    let wins = 0, draws = 0, tally = { [X]: 0, [O]: 0 };
    let cursor = 4, kbd = false, hover = -1, downCell = -1, ending = false, matchWinner = 0;
    let pendingFx = null;                    // the win burst, fired a moment after the line starts

    // ---- layout (relative to R, centred a little low so the score strip stays clear) ----
    const L = () => { const s = g.R * 1.04; return { s, cs: s / 3, x0: g.cx - s / 2, y0: g.cy + g.R * 0.1 - s / 2 }; };
    const cellAt = (x, y) => {
      const { cs, x0, y0 } = L();
      const c = Math.floor((x - x0) / cs), r = Math.floor((y - y0) / cs);
      return c >= 0 && c < 3 && r >= 0 && r < 3 ? r * 3 + c : -1;
    };
    const centre = (i) => { const { cs, x0, y0 } = L(); return [x0 + (i % 3 + 0.5) * cs, y0 + (Math.floor(i / 3) + 0.5) * cs]; };

    function status() {
      if (two) g.sub(`X ${tally[X]}  ·  O ${tally[O]}`);
      else g.sub(`Round ${round}  ·  W ${wins}  ·  D ${draws}`);
    }
    function newRound() {
      round++;
      board = new Array(9).fill(0); cells = new Array(9).fill(null);
      res = null; phase = 'play'; gridT = 0;
      turn = round % 2 ? X : O;                 // X starts odd rounds, O (COM in 1P) even rounds
      if (two) g.score(round);
      status();
      if (!two && turn === CPU) think = 0.75;
      g.toast(two ? `Round ${round} · ${NAME[turn]} starts` : turn === HUMAN ? `Round ${round} · You start` : `Round ${round} · COM starts`, 1100);
    }

    function place(i, p) {
      if (phase !== 'play' || board[i] || turn !== p) return false;
      board[i] = p; cells[i] = { p, t: 0 };
      g.sfx('place', { pitch: p === X ? 1 : 1.25 }); g.vibrate(10);
      const o = outcome(board);
      if (o) finish(o); else { turn = 3 - p; if (!two && turn === CPU) think = rand(0.45, 0.8); }
      return true;
    }

    function finish(o) {
      res = o; resT = 0; phase = 'result'; wait = 1.9;
      if (o.p) {
        const [x1, y1] = centre(o.line[0]), [x2, y2] = centre(o.line[2]);
        pendingFx = () => { for (let k = 0; k <= 4; k++) draw.burst(x1 + (x2 - x1) * k / 4, y1 + (y2 - y1) * k / 4, COL[o.p], 6, g.R * 0.45); };
      }
      if (two) {
        if (o.p) {
          tally[o.p]++;
          g.sfx('score');
          if (tally[o.p] >= 3) {
            ending = true; wait = 1.4;
            matchWinner = o.p;
          }
        } else g.sfx('tick');
        status();
        return;
      }
      if (o.p === HUMAN) {
        wins++; g.add(3); g.sfx('score');
        const [x, y] = centre(o.line[1]); draw.float('+3', x, y - L().cs * 0.2, COL[X], g.R * 0.11);
      } else if (o.p === CPU) {
        g.sfx('hit'); g.vibrate(40);
        ending = true; wait = 1.5;
      } else {
        draws++; g.add(1); g.sfx('tick');
        draw.float('+1', g.cx, g.cy + g.R * 0.1, THEME.fg, g.R * 0.1);
      }
      status();
    }
    function endGame() {
      const note = `W ${wins} · D ${draws}`;
      if (two) g.over(round, { title: `${NAME[matchWinner]} wins the match!`, label: NAME[matchWinner], note: `X ${tally[X]} · O ${tally[O]} in ${round} rounds`, win: true, delay: 700 });
      else g.over(g.scoreValue || null, { title: 'COM wins', note: g.scoreValue ? note : 'No points this run — try again!', label: note, delay: 700 });
    }

    const humanTurn = () => phase === 'play' && (two || turn === HUMAN);

    // ---- input ----
    g.on('down', (p) => { kbd = false; downCell = humanTurn() ? cellAt(p.x, p.y) : -1; hover = downCell; });
    g.on('move', (p) => { hover = humanTurn() ? cellAt(p.x, p.y) : -1; });
    g.on('up', (p) => {
      const c = cellAt(p.x, p.y);
      if (c >= 0 && c === downCell && humanTurn()) { if (!place(c, turn)) g.sfx('click'); }
      downCell = -1;
    });
    g.on('key', ({ key }) => {
      const k = key.length === 1 ? key.toLowerCase() : key;
      if (!kbd) { kbd = true; if (!['Enter', ' '].includes(k)) return; }
      if (k === 'ArrowLeft' || k === 'a') cursor = (cursor + 8) % 9;
      else if (k === 'ArrowRight' || k === 'd') cursor = (cursor + 1) % 9;
      else if (k === 'ArrowUp' || k === 'w') cursor = (cursor + 6) % 9;
      else if (k === 'ArrowDown' || k === 's') cursor = (cursor + 3) % 9;
      else if (k === 'Enter' || k === ' ') { if (humanTurn()) { if (!place(cursor, turn)) g.sfx('click'); } return; }
      else return;
      g.sfx('tick');
    });
    g.on('wheel', ({ delta }) => { kbd = true; cursor = (cursor + (delta > 0 ? 1 : 8)) % 9; g.sfx('tick'); });

    newRound();

    // ---- drawing helpers ----
    function strokeX(x, y, a, k, col, lw) {
      const { ctx } = g;
      const k1 = ease.out(clamp(k * 2, 0, 1)), k2 = ease.out(clamp(k * 2 - 1, 0, 1));
      ctx.beginPath();
      ctx.moveTo(x - a, y - a); ctx.lineTo(x - a + 2 * a * k1, y - a + 2 * a * k1);
      if (k2 > 0) { ctx.moveTo(x + a, y - a); ctx.lineTo(x + a - 2 * a * k2, y - a + 2 * a * k2); }
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
    }
    function strokeO(x, y, a, k, col, lw) {
      const { ctx } = g;
      ctx.beginPath(); ctx.arc(x, y, a, -Math.PI / 2, -Math.PI / 2 + TAU * ease.out(clamp(k, 0, 1)) * 0.999);
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
    }
    function piece(p, x, y, cs, k, alpha = 1, scale = 1, glow = 1) {
      const { ctx } = g;
      const a = cs * (p === X ? 0.25 : 0.28) * scale, col = COL[p];
      ctx.save();
      ctx.globalAlpha = alpha; ctx.lineCap = 'round';
      // flat strokes (no glow); `glow` only makes the winning pieces a touch bolder
      (p === X ? strokeX : strokeO)(x, y, a, k, col, cs * (0.11 + 0.01 * glow) * scale);
      (p === X ? strokeX : strokeO)(x, y, a, k, 'rgba(255,255,255,.55)', cs * 0.035 * scale);
      ctx.restore();
    }

    // ---- frame ----
    g.loop((dt, t) => {
      const { ctx, cx } = g;
      const { s, cs, x0, y0 } = L();
      gridT += dt;
      for (const c of cells) if (c) c.t += dt;
      if (pendingFx && resT > 0.25) { pendingFx(); pendingFx = null; }

      // ---- update ----
      if (phase === 'play' && !two && turn === CPU && (think -= dt) <= 0) place(comMove(board, CPU, level), CPU);
      if (phase === 'result') {
        resT += dt;
        if ((wait -= dt) <= 0) {
          if (ending) { ending = false; phase = 'done'; endGame(); }
          else { phase = 'clear'; clearT = 0; }
        }
      }
      if (phase === 'clear' && (clearT += dt) >= 0.35) newRound();

      // ---- draw ----
      const winCol = res?.p ? COL[res.p] : g.color;
      draw.bg({ glow: 0.13, color: phase === 'result' && res?.p ? winCol : g.color });

      // cell highlight (hover / keyboard cursor)
      const hl = kbd ? cursor : hover;
      if (humanTurn() && hl >= 0 && (kbd || !board[hl])) {
        const hx = x0 + (hl % 3) * cs, hy = y0 + Math.floor(hl / 3) * cs, pad = cs * 0.1;
        draw.roundRect(hx + pad, hy + pad, cs - 2 * pad, cs - 2 * pad, cs * 0.16, board[hl] ? THEME.ink(0.04) : THEME.glass,
          { stroke: kbd ? draw.alpha(COL[turn], 0.7) : null, lw: Math.max(1.5, g.R * 0.006) });
        if (!board[hl]) piece(turn, hx + cs / 2, hy + cs / 2, cs, 1, 0.18 + 0.06 * Math.sin(t * 5), 1, 0);
      }

      // the grid: four soft lines that draw themselves in each round
      const clearK = phase === 'clear' ? clamp(clearT / 0.35, 0, 1) : 0;
      ctx.save();
      ctx.lineCap = 'round'; ctx.strokeStyle = THEME.ink(0.2); ctx.lineWidth = Math.max(2, cs * 0.035);
      const gk = ease.out(clamp(gridT / 0.45, 0, 1)), inset = cs * 0.08;
      for (let i = 1; i < 3; i++) {
        const len = (s - 2 * inset) * gk;
        ctx.beginPath(); ctx.moveTo(x0 + i * cs, y0 + inset); ctx.lineTo(x0 + i * cs, y0 + inset + len); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x0 + inset, y0 + i * cs); ctx.lineTo(x0 + inset + len, y0 + i * cs); ctx.stroke();
      }
      ctx.restore();

      // pieces
      const inLine = (i) => res?.line?.includes(i);
      for (let i = 0; i < 9; i++) {
        const c = cells[i]; if (!c) continue;
        const [x, y] = centre(i);
        let alpha = 1, scale = 1, glow = 0.8;
        if (phase === 'result' || phase === 'done') {
          if (res.p && !inLine(i)) alpha = 1 - 0.65 * clamp(resT / 0.4, 0, 1);
          if (inLine(i)) { scale = 1 + 0.08 * Math.sin(clamp(resT * 3, 0, 1) * Math.PI) + 0.03 * Math.sin(t * 6); glow = 1.4; }
        }
        if (phase === 'clear') { alpha = (res?.p && !inLine(i) ? 0.35 : 1) * (1 - clearK); scale = 1 - 0.35 * clearK; }
        piece(c.p, x, y, cs, c.t / 0.32, alpha, scale, glow);
      }

      // the winning line
      if (res?.p && phase !== 'play') {
        const [x1, y1] = centre(res.line[0]), [x2, y2] = centre(res.line[2]);
        const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len, ext = cs * 0.38;
        const ax = x1 - ux * ext, ay = y1 - uy * ext, k = ease.out(clamp((resT - 0.15) / 0.4, 0, 1));
        const tl = (len + 2 * ext) * k;
        if (k > 0) {
          ctx.save();
          ctx.globalAlpha = 1 - clearK; ctx.lineCap = 'round';
          if (THEME.glow) { ctx.shadowColor = winCol; ctx.shadowBlur = g.R * 0.06; }
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + ux * tl, ay + uy * tl);
          ctx.strokeStyle = winCol; ctx.lineWidth = cs * 0.075; ctx.stroke();
          ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = cs * 0.025; ctx.stroke();
          ctx.restore();
        }
      }

      // whose turn, below the board
      const ty = y0 + s + g.R * 0.115;
      if (phase === 'play') {
        const who = two ? `${NAME[turn]} to play` : turn === HUMAN ? 'Your turn' : 'COM';
        const ic = g.R * 0.05;
        ctx.save(); ctx.font = `700 ${g.R * 0.05}px ${g.theme.display}`;
        const tw = ctx.measureText(who).width; ctx.restore();
        const dots = !two && turn === CPU;
        const total = ic * 1.75 + tw + (dots ? ic * 1.4 : 0);
        const sx = cx - total / 2;
        piece(turn, sx + ic * 0.5, ty, ic * 2.1, 1, 1, 1, 0.5);
        draw.text(who, sx + ic * 1.75, ty + 1, g.R * 0.05, { align: 'left', color: THEME.ink(0.82) });
        if (dots) for (let k = 0; k < 3; k++) draw.circle(sx + ic * 1.75 + tw + ic * (0.5 + k * 0.42), ty + g.R * 0.008, g.R * 0.008, THEME.ink(0.3 + 0.6 * Math.max(0, Math.sin(t * 7 - k * 0.8))));
      } else if (phase === 'result' || phase === 'done') {
        const txt = !res.p ? (two ? 'Draw' : 'Draw  +1') : two ? (matchWinner ? `${NAME[res.p]} wins the match!` : `${NAME[res.p]} wins the round`) : res.p === HUMAN ? 'You win  +3' : 'COM wins';
        const pk = ease.back(clamp(resT * 3.5, 0, 1));
        draw.text(txt, cx, ty + 1, g.R * 0.064 * (0.6 + 0.4 * pk), { color: res.p ? winCol : THEME.ink(0.85), alpha: clamp(resT * 4, 0, 1) * (1 - clearK), glow: res.p ? g.R * 0.03 : 0 });
      }
      if (two) { // little match pips: three per player
        const py = ty + g.R * 0.085;
        for (const p of [X, O]) for (let k = 0; k < 3; k++) {
          const x = cx + (p === X ? -1 : 1) * (g.R * 0.07 + k * g.R * 0.045);
          draw.circle(x, py, g.R * 0.013, k < tally[p] ? COL[p] : THEME.ink(0.14));
        }
      }
      draw.particles(dt);
      draw.floaters(dt);
    });
    return {};
  },
};
