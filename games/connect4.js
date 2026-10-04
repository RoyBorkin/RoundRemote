// Four in a Row — drop discs into a 7×6 board, line up four. Discs slide down behind a glassy frame
// with a little bounce. 1P vs COM (Easy / Normal / Hard): a run of rounds, win +3, draw +1, until COM
// wins. 2 players on one screen: first to 3 wins; fewer rounds = a more dominant win.
import { TAU, clamp, ease, rand, pick, THEME } from './kit.js';

const W = 7, H = 6;                       // columns × rows; cell index = col * H + row (row 0 = bottom)
const P1 = 1, P2 = 2;
const COL = { [P1]: '#ff5a6a', [P2]: '#ffc857' };   // THEME.pieces red & yellow
const RING = { [P1]: '#d9404f', [P2]: '#e0a53a' };  // the flat inner ring, a shade darker
const NAME = { [P1]: 'Red', [P2]: 'Yellow' };
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const ORDER = [3, 2, 4, 1, 5, 0, 6];      // centre first: better moves first = faster pruning

// ------------------------------------------------------------------ the COM
const WINDOWS = (() => {                  // every line of four on the board, flattened
  const a = [];
  for (let c = 0; c < W; c++) for (let r = 0; r < H; r++) for (const [dc, dr] of DIRS) {
    const c3 = c + 3 * dc, r3 = r + 3 * dr;
    if (c3 < 0 || c3 >= W || r3 < 0 || r3 >= H) continue;
    for (let k = 0; k < 4; k++) a.push((c + k * dc) * H + r + k * dr);
  }
  return Int8Array.from(a);
})();
const NW = WINDOWS.length / 4;
const SC = [0, 1, 8, 50, 0];
// for every cell, the windows that contain it (CW_LIST[CW_AT[i] … CW_AT[i+1]])
const [CW_AT, CW_LIST] = (() => {
  const per = Array.from({ length: W * H }, () => []);
  for (let w = 0; w < NW; w++) for (let k = 0; k < 4; k++) per[WINDOWS[w * 4 + k]].push(w);
  const at = new Int16Array(W * H + 1), list = [];
  per.forEach((l, i) => { at[i] = list.length; list.push(...l); });
  at[W * H] = list.length;
  return [at, Int16Array.from(list)];
})();

/** The cells of the line(s) through (c, r) that make four or more for p, or null. */
function lineAt(b, c, r, p) {
  let out = null;
  for (const [dc, dr] of DIRS) {
    const cells = [c * H + r];
    for (const s of [1, -1]) for (let k = 1; k < 4; k++) {
      const cc = c + dc * k * s, rr = r + dr * k * s;
      if (cc < 0 || cc >= W || rr < 0 || rr >= H || b[cc * H + rr] !== p) break;
      cells.push(cc * H + rr);
    }
    if (cells.length >= 4) (out ||= []).push(...cells);
  }
  return out;
}

// Search state: board, heights, per-window piece counts and a running heuristic score (from P1's side),
// all updated incrementally as moves are played and undone — so a leaf costs nothing to evaluate.
const sb = new Int8Array(W * H), sh = new Int8Array(W);
const cnt = [null, new Int8Array(NW), new Int8Array(NW)];
let sscore = 0;
const wval = (w) => { const a = cnt[1][w], z = cnt[2][w]; return a && z ? 0 : a ? SC[a] : -SC[z]; };
function play(c, p) {
  const i = c * H + sh[c]++;
  sb[i] = p;
  let win = false;
  for (let k = CW_AT[i], e = CW_AT[i + 1]; k < e; k++) {
    const w = CW_LIST[k];
    sscore -= wval(w);
    if (++cnt[p][w] === 4) win = true;
    sscore += wval(w);
  }
  if (c === 3) sscore += p === 1 ? 3 : -3;
  return win;
}
function undo(c, p) {
  const i = c * H + --sh[c];
  sb[i] = 0;
  for (let k = CW_AT[i], e = CW_AT[i + 1]; k < e; k++) { const w = CW_LIST[k]; sscore -= wval(w); cnt[p][w]--; sscore += wval(w); }
  if (c === 3) sscore -= p === 1 ? 3 : -3;
}
function load(board) {
  sb.fill(0); sh.fill(0); cnt[1].fill(0); cnt[2].fill(0); sscore = 0;
  // replay the pieces bottom-up (order between players doesn't matter for the counts)
  for (let c = 0; c < W; c++) for (let r = 0; r < H && board[c * H + r]; r++) play(c, board[c * H + r]);
}
const WIN = 1e6, ABORT = { abort: true };
let nodes = 0, deadline = 0;
function negamax(p, depth, alpha, beta, ply) {
  if ((++nodes & 255) === 0 && performance.now() > deadline) throw ABORT;
  if (depth === 0) return p === 1 ? sscore : -sscore;
  if (depth > 1) { // a win right now beats anything else
    for (let c = 0; c < W; c++) if (sh[c] < H) { const w = play(c, p); undo(c, p); if (w) return WIN - ply; }
  }
  let best = -Infinity, any = false;
  for (let i = 0; i < W; i++) {
    const c = ORDER[i];
    if (sh[c] >= H) continue;
    any = true;
    let s;
    if (play(c, p)) s = WIN - ply;
    else s = -negamax(3 - p, depth - 1, -beta, -alpha, ply + 1);
    undo(c, p);
    if (s > best) { best = s; if (best > alpha) { alpha = best; if (alpha >= beta) break; } }
  }
  return any ? best : 0;
}
/** Score every legal column for p, searching `depth` plies (throws ABORT if the time runs out). */
function rootScores(p, depth, cols, full = false) {
  const out = [];
  let best = -Infinity;
  for (const c of cols) {
    let s;
    try { s = play(c, p) ? WIN : -negamax(3 - p, depth - 1, -Infinity, full ? Infinity : -(best - 1), 1); }
    finally { undo(c, p); }
    if (s > best) best = s;
    out.push({ c, s });
  }
  return out;
}
const legal = (hts) => ORDER.filter((c) => hts[c] < H);
function immediate(hts, p) { for (const c of ORDER) if (hts[c] < H) { const w = play(c, p); undo(c, p); if (w) return c; } return -1; }

/** Pick COM's column. b: Int8Array(42), hts: Int8Array(7) (copied, not changed). */
export function chooseMove(board, heights, p, level, budgetMs = 200) {
  load(board);
  const cols = legal(heights);
  if (cols.length === 1) return cols[0];
  const win = immediate(heights, p), block = immediate(heights, 3 - p);
  if (level === 'easy') {
    if (win >= 0 && Math.random() < 0.85) return win;
    if (block >= 0 && Math.random() < 0.6) return block;
    return pick(cols.flatMap((c) => (c >= 2 && c <= 4 ? [c, c] : [c])));
  }
  if (win >= 0) return win;
  deadline = performance.now() + budgetMs; nodes = 0;
  if (level === 'normal') {
    if (block >= 0 && Math.random() < 0.9) return block;
    let sc;
    try { sc = rootScores(p, 3, cols, true); } catch (e) { if (e !== ABORT) throw e; return block >= 0 ? block : pick(cols); }
    // full-window scores for a fair "close to the best" pick
    const top = Math.max(...sc.map((m) => m.s));
    const ok = sc.filter((m) => m.s >= top - (top > WIN / 2 ? 0 : 14) && m.s > -WIN / 2);
    return pick(ok.length ? ok : sc.filter((m) => m.s === top)).c;
  }
  // hard: iterative deepening alpha-beta, as deep as the time allows (up to 10 plies)
  let best = block >= 0 ? [block] : [cols[0]], order = cols, reached = 0;
  for (let depth = 2; depth <= 10; depth++) {
    let sc;
    try { sc = rootScores(p, depth, order); } catch (e) { if (e !== ABORT) throw e; break; }
    const top = Math.max(...sc.map((m) => m.s));
    best = sc.filter((m) => m.s === top).map((m) => m.c);
    order = [...sc].sort((a, z) => z.s - a.s).map((m) => m.c);
    reached = depth;
    if (Math.abs(top) > WIN / 2) break;  // a forced result is known
    if (performance.now() > deadline - budgetMs * 0.6) break; // the next ply won't finish in time
  }
  chooseMove.last = { nodes, depth: reached };
  return pick(best);
}

export default {
  howTo: 'Tap a column to drop a disc. Line up four — across, down or diagonal. Vs COM: win +3, draw +1 — the run ends when COM wins.',
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
    const HUMAN = P1, CPU = P2;

    let b = new Int8Array(W * H), hts = new Int8Array(W);
    let discs = [];                          // { c, r, p, y (rows from the bottom, float), vy, done, t }
    let round = 0, turn = P1, phase = 'play'; // play → result → clear → play …
    let think = 0, wait = 0, res = null, resT = 0, clearT = 0, moves = 0, ending = false, matchWinner = 0;
    let wins = 0, draws = 0;
    const tally = { [P1]: 0, [P2]: 0 };
    let ghost = -1, pressed = false, kbd = false, kcol = 3, shake = { c: -1, t: 0 }, introT = 0;

    // ---- layout ----
    let geo = null, frame = null, outer = null, holes = null;
    function layout() {
      const c = g.R * 0.18, pad = c * 0.16;
      const w = W * c, h = H * c, x0 = g.cx - w / 2, y0 = g.cy + g.R * 0.08 - h / 2;
      if (!geo || geo.c !== c || geo.x0 !== x0 || geo.y0 !== y0) {
        geo = { c, pad, w, h, x0, y0, dr: c * 0.4 };
        // the frame: a rounded slab with a hole per slot (even-odd), drawn over the discs
        outer = new Path2D(); holes = new Path2D();
        outer.roundRect(x0 - pad, y0 - pad, w + 2 * pad, h + 2 * pad, c * 0.42);
        for (let cc = 0; cc < W; cc++) for (let r = 0; r < H; r++) {
          const [x, y] = slotXY(cc, r);
          holes.moveTo(x + c * 0.415, y); holes.arc(x, y, c * 0.415, 0, TAU);
        }
        frame = new Path2D(); frame.addPath(outer); frame.addPath(holes);
      }
      return geo;
    }
    const slotXY = (cc, r) => { const { c, x0, y0 } = geo; return [x0 + (cc + 0.5) * c, y0 + (H - r - 0.5) * c]; };
    function colAt(x) {
      const { c, x0, w } = layout();
      if (x < x0 - c * 0.6 || x > x0 + w + c * 0.6) return -1;
      return clamp(Math.floor((x - x0) / c), 0, W - 1);
    }

    function status() {
      if (two) g.sub(`Red ${tally[P1]}  ·  Yellow ${tally[P2]}`);
      else g.sub(`Round ${round}  ·  W ${wins}  ·  D ${draws}`);
    }
    function newRound() {
      round++;
      b = new Int8Array(W * H); hts = new Int8Array(W); discs = []; moves = 0;
      res = null; phase = 'play'; introT = 0;
      turn = round % 2 ? P1 : P2;
      if (two) g.score(round);
      status();
      if (!two && turn === CPU) think = 0.8;
      g.toast(two ? `Round ${round} · ${NAME[turn]} starts` : turn === HUMAN ? `Round ${round} · You start` : `Round ${round} · COM starts`, 1100);
    }

    const falling = () => discs.some((d) => !d.hit);
    const humanTurn = () => phase === 'play' && !falling() && (two || turn === HUMAN);

    function drop(c, p) {
      if (phase !== 'play' || turn !== p || falling()) return false;
      if (hts[c] >= H) { shake = { c, t: 0.3 }; g.sfx('click'); return false; }
      const r = hts[c]++;
      b[c * H + r] = p; moves++;
      discs.push({ c, r, p, y: H + 0.6, vy: -3, done: false, t: 0, bounces: 0 });
      g.sfx('drop', { pitch: p === P1 ? 1 : 1.15, volume: 0.8 });
      return true;
    }
    // called once the disc has come to rest
    function landed(d) {
      const line = lineAt(b, d.c, d.r, d.p);
      if (line) return finish({ p: d.p, line });
      if (moves >= W * H) return finish({ p: 0, line: null });
      turn = 3 - d.p;
      if (!two && turn === CPU) think = rand(0.25, 0.45);
    }
    function finish(o) {
      res = o; resT = 0; phase = 'result'; wait = 2;
      if (o.p) {
        for (const i of o.line) { const [x, y] = slotXY(Math.floor(i / H), i % H); draw.burst(x, y, COL[o.p], 7, g.R * 0.4); }
      }
      if (two) {
        if (o.p) {
          tally[o.p]++; g.sfx('score');
          if (tally[o.p] >= 3) { ending = true; matchWinner = o.p; wait = 1.6; }
        } else g.sfx('tick');
        status();
        return;
      }
      if (o.p === HUMAN) { wins++; g.add(3); g.sfx('score'); draw.float('+3', g.cx, g.cy - g.R * 0.05, COL[HUMAN], g.R * 0.12); }
      else if (o.p === CPU) { g.sfx('hit'); g.vibrate(40); ending = true; wait = 1.7; }
      else { draws++; g.add(1); g.sfx('tick'); draw.float('+1', g.cx, g.cy - g.R * 0.05, THEME.fg, g.R * 0.1); }
      status();
    }
    function endGame() {
      const note = `W ${wins} · D ${draws}`;
      if (two) g.over(round, { title: `${NAME[matchWinner]} wins the match!`, label: NAME[matchWinner], note: `Red ${tally[P1]} · Yellow ${tally[P2]} in ${round} rounds`, win: true, delay: 700 });
      else g.over(g.scoreValue || null, { title: 'COM wins', note: g.scoreValue ? note : 'No points this run — try again!', label: note, delay: 700 });
    }

    // ---- input ----
    g.on('down', (p) => { kbd = false; pressed = p.r < 0.97; ghost = colAt(p.x); });
    g.on('move', (p) => { if (!kbd || pressed) { kbd = false; ghost = colAt(p.x); } });
    g.on('up', (p) => {
      if (!pressed) return;
      pressed = false;
      const c = colAt(p.x);
      if (c >= 0 && humanTurn()) drop(c, turn);
    });
    const step = (d) => { kbd = true; kcol = (kcol + d + W) % W; g.sfx('tick'); };
    g.on('key', ({ key }) => {
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') step(-1);
      else if (key === 'ArrowRight' || key === 'd' || key === 'D') step(1);
      else if (key === 'Enter' || key === ' ' || key === 'ArrowDown') { kbd = true; if (humanTurn()) drop(kcol, turn); }
    });
    g.on('wheel', ({ delta }) => step(delta > 0 ? 1 : -1));

    newRound();

    // ---- drawing ----
    // the frame's fill and sheen, rebuilt only when the layout or the theme changes
    let paint = null, paintKey = '';
    function framePaint() {
      const { pad, h, y0 } = geo;
      const key = `${y0}|${h}|${THEME.id}|${THEME.mode}`;
      if (key === paintKey) return paint;
      paintKey = key;
      const { ctx } = g;
      const lin = (a, b) => { const gr = ctx.createLinearGradient(0, y0 - pad, 0, y0 + h + pad); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
      let fill;
      if (THEME.id === 'classic' && !THEME.light) fill = lin('rgba(34,24,32,.95)', 'rgba(14,11,15,.97)');   // smoky glass slab
      else if (THEME.flat) fill = THEME.surface;
      else fill = lin(draw.alpha(THEME.surface, 0.97), draw.alpha(THEME.bg2, 0.97));
      let sheen = null;
      if (!THEME.flat && !THEME.light) {
        sheen = ctx.createLinearGradient(0, y0 - pad, 0, y0 + h * 0.5);
        sheen.addColorStop(0, 'rgba(255,255,255,.075)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
      }
      paint = { fill, sheen };
      return paint;
    }
    // flat token: one solid colour with a flat, slightly darker inner ring (like a pressed token)
    function disc(x, y, r, p, alpha = 1) {
      const { ctx } = g;
      if (alpha !== 1) { ctx.save(); ctx.globalAlpha = alpha; }
      draw.ball(x, y, r, COL[p]);
      ctx.beginPath(); ctx.arc(x, y, r * 0.66, 0, TAU);
      ctx.strokeStyle = RING[p]; ctx.lineWidth = r * 0.1; ctx.stroke();
      if (alpha !== 1) ctx.restore();
    }

    g.loop((dt, t) => {
      const { ctx, cx } = g;
      const { c, pad, w, h, x0, y0, dr } = layout();
      introT += dt;
      if (shake.t > 0) shake.t -= dt;

      // ---- update: falling discs ----
      const G = 75;                                   // rows / s²
      for (const d of discs) {
        d.t += dt;
        if (d.done) continue;
        d.vy -= G * dt; d.y += d.vy * dt;
        if (d.y <= d.r) {
          d.y = d.r;
          if (d.bounces === 0) { g.sfx('place', { pitch: 0.9 + d.r * 0.04 }); g.vibrate(8); }
          if (Math.abs(d.vy) > 5 && d.bounces < 2) { d.vy = -d.vy * 0.28; d.bounces++; }
          else { d.vy = 0; d.done = true; }
          if (!d.hit) { d.hit = true; landed(d); }   // the game goes on while it settles
        }
      }
      if (phase === 'play' && !two && turn === CPU && !falling() && (think -= dt) <= 0) {
        drop(chooseMove(b, hts, CPU, level), CPU);
      }
      if (phase === 'result') {
        resT += dt;
        if ((wait -= dt) <= 0) {
          if (ending) { ending = false; phase = 'done'; endGame(); }
          else { phase = 'clear'; clearT = 0; for (const d of discs) d.vy = -rand(0, 3); }
        }
      }
      if (phase === 'clear') {
        clearT += dt;
        for (const d of discs) { d.vy -= G * 0.6 * dt; d.y += d.vy * dt; }
        if (clearT >= 0.7) newRound();
      }

      // ---- draw ----
      const winCol = res?.p ? COL[res.p] : g.color;
      draw.bg({ glow: 0.13, color: phase === 'result' && res?.p ? winCol : g.color, glowAt: [0, 0.08] });

      // slot backs (darker wells) — behind the discs
      ctx.save();
      ctx.fillStyle = THEME.shade(THEME.light ? 0.13 : 0.35);
      ctx.fill(holes);
      ctx.restore();

      // the column you're aiming at + a ghost disc where it will land
      const aim = kbd ? kcol : ghost;
      const sx = shake.c === aim && shake.t > 0 ? Math.sin(shake.t * 60) * c * 0.06 : 0;
      if (humanTurn() && aim >= 0) {
        if (hts[aim] < H) { const [x, y] = slotXY(aim, hts[aim]); disc(x, y, dr, turn, 0.3 + 0.1 * Math.sin(t * 5)); }
      }

      // discs (they slide in from above, behind the frame)
      const inLine = (d) => res?.line?.includes(d.c * H + d.r);
      const clearK = phase === 'clear' ? clamp(clearT / 0.7, 0, 1) : 0;
      ctx.save();
      ctx.beginPath(); ctx.rect(x0 - pad, y0 - pad, w + 2 * pad, g.S); ctx.clip();
      for (const d of discs) {
        const [x] = slotXY(d.c, 0);
        const y = y0 + (H - d.y - 0.5) * c;
        let alpha = 1;
        if (res?.p && (phase === 'result' || phase === 'done') && !inLine(d)) alpha = 1 - 0.55 * clamp(resT / 0.4, 0, 1);
        if (phase === 'clear') alpha = (res?.p && !inLine(d) ? 0.45 : 1) * (1 - clearK);
        disc(x, y, dr, d.p, alpha);
      }
      ctx.restore();

      // the frame on top: a slab with round holes (classic: smoky glass)
      const fp = framePaint();
      ctx.save();
      if (THEME.glow) { ctx.shadowColor = draw.alpha(g.color, 0.35); ctx.shadowBlur = g.R * 0.07; }
      ctx.fillStyle = fp.fill; ctx.fill(frame, 'evenodd');
      ctx.shadowColor = 'transparent';
      // a soft sheen across the top, and the rims
      if (fp.sheen) { ctx.fillStyle = fp.sheen; ctx.fill(frame, 'evenodd'); }
      ctx.lineWidth = Math.max(1, g.R * 0.005);
      ctx.strokeStyle = THEME.ink(THEME.light ? 0.12 : 0.07); ctx.stroke(holes);
      ctx.strokeStyle = draw.alpha(g.color, 0.35); ctx.stroke(outer);
      ctx.restore();

      // the column you're aiming at, over the frame
      if (humanTurn() && aim >= 0) {
        draw.roundRect(x0 + aim * c + c * 0.04 + sx, y0 - pad * 0.55, c * 0.92, h + pad * 1.1, c * 0.46, draw.alpha(COL[turn], 0.07),
          { stroke: draw.alpha(COL[turn], kbd ? 0.6 : 0.35), lw: Math.max(1.5, g.R * 0.006) });
      }

      // the winning four: a glowing line through them and rings around each
      if (res?.p && phase !== 'play') {
        const pts = res.line.map((i) => slotXY(Math.floor(i / H), i % H)).sort((a, z) => a[0] - z[0] || a[1] - z[1]);
        const k = ease.out(clamp((resT - 0.1) / 0.45, 0, 1)), fade = 1 - clearK;
        const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
        ctx.save();
        ctx.globalAlpha = fade; ctx.lineCap = 'round';
        for (const [x, y] of pts) {
          ctx.beginPath(); ctx.arc(x, y, dr * (1.05 + 0.05 * Math.sin(t * 6)), -Math.PI / 2, -Math.PI / 2 + TAU * k);
          ctx.strokeStyle = THEME.fg; ctx.lineWidth = c * 0.06; ctx.stroke();
        }
        if (k > 0) {
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (bx - ax) * k, ay + (by - ay) * k);
          ctx.strokeStyle = THEME.ink(0.9); ctx.lineWidth = c * 0.08; ctx.stroke();
        }
        ctx.restore();
      }

      // whose turn / the result, below the board
      const ty = y0 + h + pad + g.R * 0.085;
      if (phase === 'play') {
        const cpu = !two && turn === CPU;
        const who = two ? `${NAME[turn]} to play` : turn === HUMAN ? 'Your turn' : 'COM';
        const fs = g.R * 0.05, ir = g.R * 0.027;
        ctx.save(); ctx.font = `700 ${fs}px ${THEME.display}`; const tw = ctx.measureText(who).width; ctx.restore();
        const total = ir * 2 + g.R * 0.025 + tw + (cpu ? g.R * 0.075 : 0), sx = cx - total / 2;
        disc(sx + ir, ty, ir, turn);
        draw.text(who, sx + ir * 2 + g.R * 0.025, ty + 1, fs, { align: 'left', color: THEME.ink(0.82) });
        if (cpu) for (let k = 0; k < 3; k++) draw.circle(sx + ir * 2 + g.R * 0.025 + tw + g.R * (0.022 + k * 0.021), ty + g.R * 0.008, g.R * 0.008, THEME.ink(0.3 + 0.6 * Math.max(0, Math.sin(t * 7 - k * 0.8))));
      } else if (res && phase !== 'clear' || phase === 'clear' && clearK < 1) {
        const txt = !res.p ? (two ? 'Draw' : 'Draw  +1') : two ? (matchWinner ? `${NAME[res.p]} wins the match!` : `${NAME[res.p]} wins the round`) : res.p === HUMAN ? 'You win  +3' : 'COM wins';
        const pk = ease.back(clamp(resT * 3.5, 0, 1));
        draw.text(txt, cx, ty + 1, g.R * 0.062 * (0.6 + 0.4 * pk), { color: res.p ? winCol : THEME.ink(0.85), alpha: clamp(resT * 4, 0, 1) * (1 - clearK), glow: res.p ? g.R * 0.03 : 0 });
      }
      if (two) {
        const py = ty + g.R * 0.075;
        for (const p of [P1, P2]) for (let k = 0; k < 3; k++) {
          const x = cx + (p === P1 ? -1 : 1) * (g.R * 0.07 + k * g.R * 0.045);
          draw.circle(x, py, g.R * 0.013, k < tally[p] ? COL[p] : THEME.ink(0.14));
        }
      }
      draw.particles(dt);
      draw.floaters(dt);
    });
    return {};
  },
};
