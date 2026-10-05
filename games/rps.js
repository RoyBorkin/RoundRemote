// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// RPS Battle — rock-paper-scissors armies on a 7×6 checkerboard (a round take on the old ICQ game).
// Each side hides a FLAG and a TRAP among its 14 soldiers; the other 12 carry hidden rock, paper or
// scissors. Move one soldier a step per turn; walk into an enemy to battle (the winner's weapon is
// revealed, a tie means both pick again). Capture the enemy flag to win — the trap kills any attacker.
// 1P vs COM (Easy / Normal / Hard) or 2 players hot-seat with a "pass the screen" cover between turns.
// The scene keeps its own fresh lime-green palette in every theme (it's scenery, with its own HUD).
import { TAU, clamp, ease, rand, pick, THEME } from './kit.js';
import * as A from './rps-ai.js';

const { W, H, N, RED, BLUE } = A;

// ---- palette (scenery: the same in every theme) ----
const SC = {
  bg: '#8db41b', disc: '#9cc226', rim: '#bfdb5c', panel: '#c5e267', ray: '#d6ee86',
  light: '#e2edb0', dark: '#afcd47', frame: '#f2f8d6', ink: '#365106', inkSoft: 'rgba(54,81,6,.55)',
  out: '#2e2414', skin: '#ffd9ae', cheek: 'rgba(255,110,90,.42)', orange: '#ff8a1f', gold: '#ffd23f',
};
const TEAM = [
  { name: 'Red', main: '#e5402f', dark: '#a8261b', light: '#ff9a7e', text: '#ea3b25' },
  { name: 'Blue', main: '#2f74e6', dark: '#1b4aa6', light: '#8dbbff', text: '#2a6fe8' },
];
const WNAME = { R: 'Rock', P: 'Paper', S: 'Scissors' };
const VERB = { R: 'smashes', P: 'wraps', S: 'cut' };
const PICKS = ['R', 'P', 'S'];

const LEVEL = { id: 'level', name: 'COM', choices: [{ id: 'easy', name: 'Easy' }, { id: 'normal', name: 'Normal' }, { id: 'hard', name: 'Hard' }], default: 'normal' };
const TIMER = { id: 'timer', name: 'Timer', choices: [{ id: 'off', name: 'No timer' }, { id: '10', name: '10 s' }, { id: '20', name: '20 s' }], default: 'off' };

export default {
  howTo: 'Hide your flag and trap, then march your rock-paper-scissors soldiers one step at a time. Win battles and capture the enemy flag — but mind the trap!',
  modes: [
    { id: 'com', name: '1P vs COM', options: [LEVEL, TIMER] },
    { id: '2p', name: '2 players', scoring: 'low', unit: 'moves', options: [TIMER] },
  ],
  scoring: 'high',
  unit: 'pts',
  hud: false,
  create(g, { mode, opts = {} }) {
    const { ctx } = g;
    const two = mode === '2p';
    const level = opts.level || 'normal';
    const tLimit = opts.timer === '10' ? 10 : opts.timer === '20' ? 20 : 0;
    const NAME = (s) => (two ? TEAM[s].name : s === RED ? 'You' : 'COM');

    // ---------------------------------------------------------------- state
    const board = A.newBoard();
    A.fillSide(board, RED); A.fillSide(board, BLUE);
    let phase = 'setup';          // setup → (cover) → play → anim | lunge → duel → (pick) → … → end
    let setupSide = RED, turn = RED, sel = -1;
    const moves = [0, 0];
    const mem = [0, 1].map(() => ({ dead: { R: 0, P: 0, S: 0 }, trapFound: false, lastFrom: {} })); // what each side has seen
    let lastMove = null, anim = null, duel = null, pickSt = null, cover = null, lunge = null;
    let timeLeft = 0, lastTick = 0, comT = 0, comPlan = null, winner = -1, endT = 0, endWhy = '';
    let kbd = false, cur = { c: 3, r: 5 }, drag = null, pickIdx = 1, ghosts = [], shake = 0, T = 0;
    let carry = null;              // the piece that grabbed the enemy flag

    if (!two) placeCom();

    // ---------------------------------------------------------------- layout
    const L = () => { const c = g.R * 0.193; return { c, x0: g.cx - 3.5 * c, y0: g.cy - 3 * c }; };
    const cellXY = (i) => { const { c, x0, y0 } = L(); return [x0 + (A.colOf(i) + 0.5) * c, y0 + (A.rowOf(i) + 0.5) * c]; };
    function cellAt(x, y) {
      const { c, x0, y0 } = L();
      const cc = Math.floor((x - x0) / c), rr = Math.floor((y - y0) / c);
      return cc < 0 || cc >= W || rr < 0 || rr >= H ? -1 : A.at(cc, rr);
    }
    const BTN_Y = 0.75, BTN = [{ x: -0.2, label: 'Shuffle' }, { x: 0.2, label: 'Start' }];
    const btnAt = (x, y) => BTN.findIndex((b) => Math.abs(x - (g.cx + b.x * g.R)) < g.R * 0.17 && Math.abs(y - (g.cy + BTN_Y * g.R)) < g.R * 0.075);
    const pickXY = (k) => [g.cx + (k - 1) * g.R * 0.42, g.cy + g.R * 0.04];

    // ---------------------------------------------------------------- helpers
    const humanTurn = () => phase === 'play' && (two || turn === RED);
    const alive = (s) => board.reduce((n, p) => n + (p && p.side === s ? 1 : 0), 0);
    /** Whose hidden weapons may be drawn right now: a side, -1 (nobody's) or 2 (everyone's). */
    function viewer() {
      if (phase === 'end') return 2;
      if (!two) return RED;
      if (phase === 'setup') return setupSide;
      if (phase === 'play' || phase === 'anim') return turn;
      return -1;
    }
    const targets = (i) => (i < 0 ? [] : A.legalMoves(board, turn).filter((m) => m.from === i));
    const isTarget = (from, to) => targets(from).some((m) => m.to === to);
    const ownMobile = (i) => i >= 0 && board[i] && board[i].side === turn && A.mobile(board[i].w);
    function liveScore() {
      if (two) g.score(moves[turn]);
      else g.score(Math.max(100, 1000 + 50 * alive(RED) - 5 * moves[RED]));
    }

    // ---------------------------------------------------------------- setup
    function placeCom() {
      const { flag, trap } = A.comSetup(BLUE, level);
      board[flag].w = 'F'; board[trap].w = 'T';
      A.dealWeapons(board, BLUE);
    }
    const sidePieces = (s) => board.filter((p) => p && p.side === s);
    const has = (s, w) => sidePieces(s).some((p) => p.w === w);
    const setupStep = () => (!has(setupSide, 'F') ? 0 : !has(setupSide, 'T') ? 1 : 2);
    function setupTap(i) {
      const p = board[i];
      if (!p || p.side !== setupSide) return;
      const clearRps = () => { for (const q of sidePieces(setupSide)) if (A.mobile(q.w)) q.w = null; };
      if (p.w === 'F' || p.w === 'T') { p.w = null; clearRps(); g.sfx('drop'); return; }
      const st = setupStep();
      if (st === 2) { g.sfx('click'); return; }
      p.w = st === 0 ? 'F' : 'T';
      if (st === 0 && has(setupSide, 'T')) A.dealWeapons(board, setupSide);
      if (st === 1) A.dealWeapons(board, setupSide);
      g.sfx('place', { pitch: st === 0 ? 1 : 1.25 });
      pop(i, st === 0 ? TEAM[setupSide].main : SC.gold);
      if (setupStep() === 2) { cur = { c: 1, r: 6 }; }
    }
    function shuffle() {
      if (setupStep() !== 2) return;
      A.dealWeapons(board, setupSide);
      for (const p of sidePieces(setupSide)) if (A.mobile(p.w)) p.hop = rand(0, 0.15);
      g.sfx('whoosh');
    }
    function startBattle() {
      if (setupStep() !== 2) return;
      g.sfx('score');
      if (two && setupSide === RED) {
        setupSide = BLUE; cur = { c: 3, r: 0 };
        showCover(BLUE, 'Blue: set up your army', 'Red, look away!', () => { phase = 'setup'; });
        return;
      }
      startTurn(RED);
    }

    // ---------------------------------------------------------------- turns
    function showCover(side, title, sub, then) { cover = { side, title, sub, then, t: 0 }; phase = 'cover'; sel = -1; drag = null; }
    function startTurn(side) {
      turn = side; sel = -1; drag = null;
      liveScore();
      if (!A.legalMoves(board, side).length) { endGame(1 - side, 'stuck'); return; }
      const begin = () => {
        phase = 'play'; timeLeft = tLimit; lastTick = Math.ceil(tLimit);
        cur = side === RED ? { c: 3, r: 4 } : { c: 3, r: 1 };
        const own = board.findIndex((p, i) => p && p.side === side && A.mobile(p.w) && A.at(cur.c, cur.r) === i);
        if (own < 0) { const k = board.findIndex((p) => p && p.side === side && A.mobile(p.w)); if (k >= 0) cur = { c: A.colOf(k), r: A.rowOf(k) }; }
        if (!two && side === BLUE) { comT = rand(0.5, 0.85); comPlan = null; }
      };
      if (two) showCover(side, `${TEAM[side].name}'s turn`, `${TEAM[1 - side].name}, look away!`, begin);
      else begin();
    }
    function doMove(m) {
      if (!m) return;
      const p = board[m.from];
      p.moved = true; moves[turn]++;
      mem[turn].lastFrom[p.id] = m.from;
      lastMove = { from: m.from, to: m.to, side: turn };
      sel = -1; drag = null; comPlan = null;
      if (!m.attack) {
        board[m.to] = p; board[m.from] = null;
        anim = { p, from: m.from, to: m.to, t: 0, dur: 0.24, f0: 0, then: nextTurn };
        phase = 'anim';
        g.sfx('place', { pitch: turn === RED ? 1 : 0.85, volume: 0.8 });
      } else {
        lunge = { p, from: m.from, to: m.to, f: 0 };
        anim = { p, from: m.from, to: m.to, t: 0, dur: 0.2, f0: 0, f1: 0.42, lunge: true, then: () => startDuel(m.from, m.to) };
        phase = 'lunge';
        g.sfx('whoosh');
      }
      liveScore();
    }
    function nextTurn() { if (phase !== 'end') startTurn(1 - turn); }

    // ---------------------------------------------------------------- battles
    function startDuel(aCell, dCell) {
      const a = board[aCell], d = board[dCell];
      const res = A.fight(a.w, d.w);
      duel = { aCell, dCell, a, d, aw: a.w, dw: d.w, res, t: 0, dur: res === 'tie' ? 1.75 : 2.1, hit: false };
      phase = 'duel';
    }
    function finishDuel() {
      const { a, d, aCell, dCell, res } = duel;
      duel = null;
      const [ax, ay] = cellXY(aCell), [dx, dy] = cellXY(dCell);
      if (res === 'tie') { startPick(a, d); return; }
      lunge = null;
      if (res === 'flag') {
        board[dCell] = a; board[aCell] = null; a.revealed = true; carry = a;
        ghost(d, dx, dy); g.draw.burst(dx, dy, SC.gold, 26, g.R * 0.6);
        endGame(a.side, 'flag');
        return;
      }
      if (res === 'trap') {
        board[aCell] = null; d.revealed = true; mem[a.side].trapFound = true; mem[d.side].dead[a.w]++;
        ghost(a, ax, ay); g.draw.burst(ax, ay, TEAM[a.side].main, 16, g.R * 0.4);
        g.sfx('boom'); g.vibrate(40);
        nextTurn();
      } else if (res === 'win') {
        board[dCell] = a; board[aCell] = null; a.revealed = true; mem[a.side].dead[d.w]++;
        ghost(d, dx, dy); g.draw.burst(dx, dy, TEAM[d.side].main, 16, g.R * 0.4);
        g.sfx('pop');
        anim = { p: a, from: aCell, to: dCell, t: 0, dur: 0.2, f0: 0.42, then: nextTurn };
        phase = 'anim';
      } else {
        board[aCell] = null; d.revealed = true; mem[d.side].dead[a.w]++;
        ghost(a, ax, ay); g.draw.burst(ax, ay, TEAM[a.side].main, 16, g.R * 0.4);
        g.sfx('drop');
        nextTurn();
      }
    }
    function startPick(a, d) {
      g.sfx('bounce');
      pickSt = { a, d, tied: a.w, queue: [], picks: {} };
      if (two) pickSt.queue = [a.side, d.side];
      else { pickSt.queue = [RED]; pickSt.picks[BLUE] = pick(PICKS); }
      nextPicker();
    }
    function nextPicker() {
      const s = pickSt.queue[0];
      const go = () => { phase = 'pick'; pickIdx = 1; timeLeft = tLimit; lastTick = Math.ceil(tLimit); pickSt.t = 0; };
      if (two) showCover(s, `${TEAM[s].name}: pick a new weapon`, `${TEAM[1 - s].name}, look away!`, go);
      else go();
    }
    function choose(w) {
      if (phase !== 'pick') return;
      const s = pickSt.queue.shift();
      pickSt.picks[s] = w;
      g.sfx('place', { pitch: 1.2 });
      if (pickSt.queue.length) { nextPicker(); return; }
      const { a, d, picks } = pickSt;
      a.w = picks[a.side]; d.w = picks[d.side];
      pickSt = null;
      const go = () => startDuel(board.indexOf(a), board.indexOf(d));
      if (two) showCover(-1, 'Battle!', 'Both players watch', go); else go();
    }

    function endGame(w, why) {
      if (phase === 'end') return;
      winner = w; endWhy = why; phase = 'end'; endT = 0; sel = -1; drag = null;
      liveScore();
      const left = alive(w);
      if (two) {
        g.over(moves[w], {
          title: `${TEAM[w].name} wins!`, label: TEAM[w].name, win: true, delay: 2600,
          note: why === 'flag' ? `${TEAM[w].name} captured the flag in ${moves[w]} moves.` : `${TEAM[1 - w].name} had no soldier left to move.`,
        });
      } else if (w === RED) {
        const score = Math.max(100, 1000 + 50 * left - 5 * moves[RED]);
        g.over(score, {
          title: 'You win!', win: true, delay: 2600, label: `${left} left`,
          note: `${why === 'flag' ? 'Flag captured' : 'COM is out of moves'} in ${moves[RED]} moves · ${left} of 14 soldiers left.`,
        });
      } else {
        g.over(null, { title: 'COM wins', delay: 2600, note: why === 'flag' ? 'COM found your flag. Try again!' : 'You have no soldier left to move.' });
      }
    }

    function ghost(p, x, y) { ghosts.push({ p, x, y, t: 0 }); }
    function pop(i, col) { const [x, y] = cellXY(i); g.draw.burst(x, y, col, 10, g.R * 0.25, g.R * 0.01); }

    // ---------------------------------------------------------------- input
    function tapBoardSetup(x, y) {
      const b = setupStep() === 2 ? btnAt(x, y) : -1;
      if (b === 0) { shuffle(); return; }
      if (b === 1) { startBattle(); return; }
      const i = cellAt(x, y);
      if (i >= 0) setupTap(i);
    }
    g.on('tap', (p) => {
      kbd = false;
      if (phase === 'cover') { if (cover.t > 0.35) { g.sfx('click'); const f = cover.then; cover = null; f(); } return; }
      if (phase === 'setup') { tapBoardSetup(p.x, p.y); return; }
      if (phase === 'duel') { if (duel.t > 0.8) duel.t = Math.max(duel.t, duel.dur); return; }
      if (phase === 'pick') {
        for (let k = 0; k < 3; k++) { const [x, y] = pickXY(k); if (Math.hypot(p.x - x, p.y - y) < g.R * 0.18) { choose(PICKS[k]); return; } }
      }
    });
    g.on('down', (p) => {
      kbd = false;
      if (!humanTurn()) return;
      const i = cellAt(p.x, p.y);
      if (ownMobile(i)) {
        drag = { from: i, x: p.x, y: p.y, x0: p.x, y0: p.y, active: false, desel: sel === i };
        if (sel !== i) { sel = i; g.sfx('tap'); }
      } else if (sel >= 0 && isTarget(sel, i)) drag = { target: i };
      else { sel = -1; drag = null; }
    });
    g.on('move', (p) => {
      if (!drag || drag.target !== undefined) return;
      drag.x = p.x; drag.y = p.y;
      if (!drag.active && Math.hypot(p.x - drag.x0, p.y - drag.y0) > L().c * 0.3) drag.active = true;
    });
    g.on('up', (p) => {
      if (!drag || !humanTurn()) { drag = null; return; }
      const d = drag; drag = null;
      const i = cellAt(p.x, p.y);
      if (d.target !== undefined) { if (i === d.target && sel >= 0) doMove(targets(sel).find((m) => m.to === i)); return; }
      if (d.active) { if (isTarget(d.from, i)) doMove(targets(d.from).find((m) => m.to === i)); return; }
      if (d.desel && i === d.from) sel = -1;
    });
    function keyAct() {
      if (phase === 'setup') {
        if (cur.r === 6) { if (cur.c === 0) shuffle(); else startBattle(); }
        else setupTap(A.at(cur.c, cur.r));
        return;
      }
      if (!humanTurn()) return;
      const i = A.at(cur.c, cur.r);
      if (sel >= 0 && isTarget(sel, i)) doMove(targets(sel).find((m) => m.to === i));
      else if (ownMobile(i)) { sel = sel === i ? -1 : i; g.sfx('tap'); }
      else sel = -1;
    }
    function moveCur(dc, dr) {
      kbd = true;
      if (phase === 'setup') {
        const ready = setupStep() === 2;
        if (cur.r === 6) {
          if (dr < 0) cur = { c: setupSide === RED ? 3 : 3, r: 5 };
          else cur.c = clamp(cur.c + dc, 0, 1);
        } else {
          const r = cur.r + dr;
          if (r > 5 && ready) cur = { c: 1, r: 6 };
          else cur = { c: clamp(cur.c + dc, 0, W - 1), r: clamp(r, 0, H - 1) };
        }
      } else cur = { c: clamp(cur.c + dc, 0, W - 1), r: clamp(cur.r + dr, 0, H - 1) };
      g.sfx('tick');
    }
    g.on('key', ({ key }) => {
      const enter = key === 'Enter' || key === ' ';
      if (phase === 'cover') { if (enter && cover.t > 0.35) { const f = cover.then; cover = null; f(); } return; }
      if (phase === 'duel') { if (enter && duel.t > 0.8) duel.t = duel.dur; return; }
      if (phase === 'pick') {
        if (key === 'ArrowLeft') { kbd = true; pickIdx = (pickIdx + 2) % 3; g.sfx('tick'); }
        else if (key === 'ArrowRight') { kbd = true; pickIdx = (pickIdx + 1) % 3; g.sfx('tick'); }
        else if (enter) choose(PICKS[pickIdx]);
        return;
      }
      if (key === 'ArrowLeft') moveCur(-1, 0);
      else if (key === 'ArrowRight') moveCur(1, 0);
      else if (key === 'ArrowUp') moveCur(0, -1);
      else if (key === 'ArrowDown') moveCur(0, 1);
      else if (enter) { kbd = true; keyAct(); }
    });
    g.on('wheel', ({ delta }) => {
      if (phase === 'pick') { kbd = true; pickIdx = (pickIdx + (delta > 0 ? 1 : 2)) % 3; g.sfx('tick'); return; }
      if (phase !== 'setup' && !humanTurn()) return;
      kbd = true;
      let k = A.at(cur.c, cur.r) + (delta > 0 ? 1 : -1);
      k = (k + N) % N; cur = { c: A.colOf(k), r: A.rowOf(k) }; g.sfx('tick');
    });

    // ================================================================= drawing
    // ---- one soldier: a round chibi pawn with a team helmet (drawn once per size into a sprite) ----
    function drawBody(c, u, side) {
      const t = TEAM[side];
      c.lineJoin = 'round'; c.lineCap = 'round';
      c.lineWidth = Math.max(1, u * 0.032); c.strokeStyle = SC.out;
      const fillStroke = (col) => { c.fillStyle = col; c.fill(); c.stroke(); };
      // feet
      for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * 0.11 * u, 0.37 * u, 0.085 * u, 0.05 * u, 0, 0, TAU); fillStroke(t.dark); }
      // tunic + belt
      c.beginPath(); c.roundRect(-0.2 * u, 0.04 * u, 0.4 * u, 0.32 * u, 0.13 * u); fillStroke(t.main);
      c.fillStyle = t.dark; c.fillRect(-0.19 * u, 0.2 * u, 0.38 * u, 0.05 * u);
      c.fillStyle = SC.gold; c.fillRect(-0.035 * u, 0.195 * u, 0.07 * u, 0.06 * u);
      // hands
      for (const s of [-1, 1]) { c.beginPath(); c.arc(s * 0.235 * u, 0.19 * u, 0.06 * u, 0, TAU); fillStroke(SC.skin); }
      // head
      c.beginPath(); c.arc(0, -0.12 * u, 0.27 * u, 0, TAU); fillStroke(SC.skin);
      // helmet dome, brim and topper (red: a round knob, blue: a crest)
      c.beginPath(); c.arc(0, -0.13 * u, 0.29 * u, Math.PI * 1.06, Math.PI * 1.94); c.closePath(); fillStroke(t.main);
      if (side === RED) { c.beginPath(); c.arc(0, -0.45 * u, 0.06 * u, 0, TAU); fillStroke(t.light); }
      else { c.beginPath(); c.roundRect(-0.045 * u, -0.53 * u, 0.09 * u, 0.13 * u, 0.04 * u); fillStroke(t.light); }
      c.beginPath(); c.roundRect(-0.315 * u, -0.215 * u, 0.63 * u, 0.075 * u, 0.035 * u); fillStroke(t.dark);
      // face
      c.fillStyle = SC.cheek;
      for (const s of [-1, 1]) { c.beginPath(); c.arc(s * 0.17 * u, 0.0, 0.04 * u, 0, TAU); c.fill(); }
      c.fillStyle = SC.out;
      for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * 0.09 * u, -0.065 * u, 0.032 * u, 0.045 * u, 0, 0, TAU); c.fill(); }
      c.fillStyle = '#fff';
      for (const s of [-1, 1]) { c.beginPath(); c.arc(s * 0.09 * u + 0.01 * u, -0.08 * u, 0.012 * u, 0, TAU); c.fill(); }
      c.lineWidth = u * 0.034;
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 0.155 * u, -0.135 * u); c.lineTo(s * 0.045 * u, -0.112 * u); c.stroke(); }
      c.lineWidth = u * 0.026;
      c.beginPath(); c.arc(0, 0.005 * u, 0.045 * u, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke();
    }
    const sprites = new Map();
    function sprite(side, u) {
      const dpr = g.dpr || 1, key = `${side}:${Math.round(u * dpr * 4)}`;
      let s = sprites.get(key);
      if (s) return s;
      if (sprites.size > 24) sprites.clear();
      const w = Math.ceil(u * 0.84 * dpr), h = Math.ceil(u * 1.1 * dpr);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const c = cv.getContext('2d'); c.scale(dpr, dpr); c.translate(u * 0.42, u * 0.6);
      drawBody(c, u, side);
      s = { cv, w: w / dpr, h: h / dpr, ox: u * 0.42, oy: u * 0.6 };
      sprites.set(key, s);
      return s;
    }
    function soldier(side, x, y, u, { alpha = 1, rot = 0, sx = 1, sy = 1 } = {}) {
      const s = sprite(side, u);
      ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y);
      if (rot) ctx.rotate(rot);
      if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
      ctx.drawImage(s.cv, -s.ox, -s.oy, s.w, s.h);
      ctx.restore();
    }

    // ---- weapons & items (our own little icons) ----
    function line(c, lw, col = SC.out) { c.lineWidth = lw; c.strokeStyle = col; c.lineJoin = 'round'; c.lineCap = 'round'; }
    const ROCK = [1, 0.84, 0.97, 0.78, 0.95, 0.88, 1, 0.82];
    function drawRock(x, y, r, rot = 0) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot - 0.2);
      ctx.beginPath();
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; ctx.lineTo(Math.cos(a) * r * ROCK[k] * 1.05, Math.sin(a) * r * ROCK[k] * 0.86); }
      ctx.closePath(); ctx.fillStyle = '#9ea5ac'; ctx.fill(); line(ctx, r * 0.16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.62, -r * 0.1); ctx.lineTo(-r * 0.3, -r * 0.55); ctx.lineTo(r * 0.25, -r * 0.6); ctx.lineTo(r * 0.05, -r * 0.18); ctx.closePath();
      ctx.fillStyle = '#c8cdd2'; ctx.fill();
      line(ctx, r * 0.1, 'rgba(46,36,20,.55)'); ctx.beginPath(); ctx.moveTo(r * 0.2, r * 0.1); ctx.lineTo(r * 0.45, r * 0.32); ctx.stroke();
      ctx.restore();
    }
    function drawPaper(x, y, r, rot = 0) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot - 0.18);
      const w = r * 1.45, h = r * 1.8, f = r * 0.45;
      ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2 - f, -h / 2); ctx.lineTo(w / 2, -h / 2 + f); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath();
      ctx.fillStyle = '#fbfbef'; ctx.fill(); line(ctx, r * 0.14); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 2 - f, -h / 2); ctx.lineTo(w / 2 - f, -h / 2 + f); ctx.lineTo(w / 2, -h / 2 + f); ctx.closePath();
      ctx.fillStyle = '#d9dcc4'; ctx.fill(); line(ctx, r * 0.1); ctx.stroke();
      line(ctx, r * 0.1, '#9fb0c8');
      for (let k = 0; k < 3; k++) { const yy = -h * 0.12 + k * h * 0.22; ctx.beginPath(); ctx.moveTo(-w * 0.3, yy); ctx.lineTo(w * 0.3, yy); ctx.stroke(); }
      ctx.restore();
    }
    function drawScissors(x, y, r, rot = 0, open = 0.36) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot + 0.25);
      for (const s of [-1, 1]) {
        ctx.save(); ctx.rotate(s * open);
        // blade
        ctx.beginPath(); ctx.moveTo(0, r * 0.12); ctx.quadraticCurveTo(s * -r * 0.34, -r * 0.3, 0, -r * 1.05); ctx.quadraticCurveTo(s * r * 0.1, -r * 0.3, s * r * 0.1, r * 0.12); ctx.closePath();
        ctx.fillStyle = '#cfd8e0'; ctx.fill(); line(ctx, r * 0.11); ctx.stroke();
        // handle ring
        ctx.beginPath(); ctx.ellipse(s * r * 0.02, r * 0.55, r * 0.22, r * 0.3, 0, 0, TAU);
        line(ctx, r * 0.34); ctx.stroke(); line(ctx, r * 0.18, '#ff7a1a'); ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(0, r * 0.08, r * 0.1, 0, TAU); ctx.fillStyle = SC.out; ctx.fill();
      ctx.restore();
    }
    function drawFlagItem(x, y, r, side, wave = 0) {
      ctx.save(); ctx.translate(x, y);
      line(ctx, r * 0.36); ctx.beginPath(); ctx.moveTo(0, r * 0.9); ctx.lineTo(0, -r * 2.1); ctx.stroke();
      line(ctx, r * 0.2, '#9a6532'); ctx.stroke();
      const top = -r * 2.1, w = r * 1.45, h = r * 1.05, k = Math.sin(wave) * r * 0.12;
      ctx.beginPath(); ctx.moveTo(0, top); ctx.quadraticCurveTo(w * 0.5, top - r * 0.12 + k, w, top + k * 0.5); ctx.lineTo(w, top + h + k * 0.5); ctx.quadraticCurveTo(w * 0.5, top + h - r * 0.12 + k, 0, top + h); ctx.closePath();
      ctx.fillStyle = TEAM[side].main; ctx.fill(); line(ctx, r * 0.14); ctx.stroke();
      ctx.beginPath(); ctx.arc(w * 0.5, top + h * 0.5 + k * 0.4, r * 0.24, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(0, -r * 2.15, r * 0.17, 0, TAU); ctx.fillStyle = SC.gold; ctx.fill(); line(ctx, r * 0.08); ctx.stroke();
      ctx.restore();
    }
    function drawTrap(x, y, r, closed = 0) {
      // a toothy spring trap seen from the front: a golden ring whose jaws snap shut
      ctx.save(); ctx.translate(x, y);
      const rw = r * 1.05, rh = r * (0.78 - 0.5 * closed);
      ctx.beginPath(); ctx.ellipse(0, 0, rw, rh, 0, 0, TAU); ctx.fillStyle = '#5a2d16'; ctx.fill();
      // teeth: down from the top jaw, up from the bottom jaw
      ctx.fillStyle = '#fffbe8';
      for (const s of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const tx = -rw * 0.66 + k * rw * 0.44 + (s > 0 ? rw * 0.22 : 0);
          if (Math.abs(tx) > rw * 0.85) continue;
          const ey = rh * Math.sqrt(Math.max(0, 1 - (tx / rw) ** 2)) * 0.82;
          ctx.beginPath(); ctx.moveTo(tx - rw * 0.15, s * -ey); ctx.lineTo(tx + rw * 0.15, s * -ey); ctx.lineTo(tx, s * -ey + s * rh * 0.95); ctx.closePath(); ctx.fill();
        }
      }
      ctx.beginPath(); ctx.ellipse(0, 0, rw, rh, 0, 0, TAU); line(ctx, r * 0.32); ctx.stroke(); line(ctx, r * 0.2, '#f2b52a'); ctx.stroke();
      // the spring hinges
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * rw, 0, r * 0.2, 0, TAU); ctx.fillStyle = '#9aa1a8'; ctx.fill(); line(ctx, r * 0.1); ctx.stroke(); }
      ctx.restore();
    }
    function item(w, x, y, r, side, extra = 0) {
      if (w === 'R') drawRock(x, y, r * 0.9, extra * 0.3);
      else if (w === 'P') drawPaper(x, y, r * 0.85, extra * 0.3);
      else if (w === 'S') drawScissors(x, y, r * 1.08, extra * 0.3);
      else if (w === 'T') drawTrap(x, y, r * 0.8);
    }
    function eye(x, y, r) {
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.68, 0, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); line(ctx, r * 0.28); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 0.36, 0, TAU); ctx.fillStyle = SC.out; ctx.fill();
    }

    // ---- chunky outlined title text ----
    function ttext(str, x, y, size, fill = '#fff', { stroke = SC.ink, white = false, align = 'center', alpha = 1 } = {}) {
      ctx.save(); ctx.globalAlpha *= alpha;
      ctx.font = `700 ${size}px ${THEME.display}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * (white ? 0.42 : 0.24); ctx.strokeStyle = stroke; ctx.strokeText(str, x, y);
      if (white) { ctx.lineWidth = size * 0.2; ctx.strokeStyle = '#fff'; ctx.strokeText(str, x, y); }
      ctx.fillStyle = fill; ctx.fillText(str, x, y);
      ctx.restore();
    }
    function fitSize(str, size, maxW) {
      ctx.font = `700 ${size}px ${THEME.display}`;
      const w = ctx.measureText(str).width;
      return w > maxW ? size * maxW / w : size;
    }

    // ---- the pieces on the board ----
    function piecePos(p, i) {
      const [x, y] = cellXY(i);
      if (anim && anim.p === p) {
        const [fx, fy] = cellXY(anim.from), [tx, ty] = cellXY(anim.to);
        const k = ease.out(clamp(anim.t / anim.dur, 0, 1));
        const f = anim.lunge ? anim.f0 + (anim.f1 - anim.f0) * k : anim.f0 + (1 - anim.f0) * k;
        const hop = Math.sin(Math.PI * k) * L().c * (anim.lunge ? 0.08 : 0.14);
        return [fx + (tx - fx) * f, fy + (ty - fy) * f - hop];
      }
      if (lunge && lunge.p === p && phase !== 'anim') {
        const [fx, fy] = cellXY(lunge.from), [tx, ty] = cellXY(lunge.to);
        return [fx + (tx - fx) * 0.42, fy + (ty - fy) * 0.42];
      }
      return [x, y];
    }
    function drawPiece(p, x, y, u, vw, t) {
      const showW = vw === 2 || vw === p.side || (p.revealed && p.w !== 'F');
      const bob = p.hop > 0 ? Math.sin((p.hop / 0.15) * Math.PI) * u * 0.08 : 0;
      y -= bob;
      if (p.w === 'F' && showW) drawFlagItem(x + u * 0.26, y + u * 0.12, u * 0.2, p.side, t * 4 + p.id);
      soldier(p.side, x, y + u * 0.02, u);
      if (carry === p) drawFlagItem(x - u * 0.26, y + u * 0.12, u * 0.2, 1 - p.side, t * 5);
      if (showW && p.w && p.w !== 'F') item(p.w, x + u * 0.25, y + u * 0.2, u * 0.27, p.side);
      // your own soldiers the enemy has already seen get a little eye badge
      if (p.revealed && (vw === p.side) && p.w !== 'T') eye(x - u * 0.3, y - u * 0.36, u * 0.085);
    }
    function arrow(x, y, dx, dy, c, col, t) {
      const s = c * 0.26, bob = Math.sin(t * 7) * c * 0.04;
      ctx.save(); ctx.translate(x + dx * bob, y + dy * bob); ctx.rotate(Math.atan2(dy, dx));
      ctx.beginPath();
      ctx.moveTo(s, 0); ctx.lineTo(0, -s * 0.85); ctx.lineTo(0, -s * 0.38); ctx.lineTo(-s, -s * 0.38);
      ctx.lineTo(-s, s * 0.38); ctx.lineTo(0, s * 0.38); ctx.lineTo(0, s * 0.85); ctx.closePath();
      ctx.fillStyle = col; ctx.fill(); line(ctx, c * 0.03, 'rgba(46,60,10,.55)'); ctx.stroke();
      ctx.restore();
    }

    function drawScene() {
      const { cx, cy, R, S } = g;
      ctx.fillStyle = SC.bg; ctx.fillRect(0, 0, S, S);
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.972, 0, TAU); ctx.fillStyle = SC.disc; ctx.fill();
      ctx.lineWidth = R * 0.008; ctx.strokeStyle = SC.rim; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.94, 0, TAU); ctx.lineWidth = R * 0.004; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.stroke();
    }
    function drawBoard(t) {
      const { c, x0, y0 } = L(), pad = g.R * 0.02;
      g.draw.roundRect(x0 - pad, y0 - pad, W * c + 2 * pad, H * c + 2 * pad, g.R * 0.03, SC.frame, { stroke: 'rgba(54,81,6,.35)', lw: g.R * 0.006 });
      for (let r = 0; r < H; r++) for (let cc = 0; cc < W; cc++) {
        ctx.fillStyle = (r + cc) % 2 ? SC.dark : SC.light;
        ctx.fillRect(x0 + cc * c, y0 + r * c, c + 0.5, c + 0.5);
      }
      // the opponent's last move: where it came from, where it went
      if (lastMove && phase !== 'setup' && phase !== 'cover') {
        const col = TEAM[lastMove.side].main;
        for (const [i, a] of [[lastMove.from, 0.32], [lastMove.to, 0.2]]) {
          ctx.fillStyle = g.draw.alpha(col, a * 0.5);
          ctx.fillRect(x0 + A.colOf(i) * c, y0 + A.rowOf(i) * c, c, c);
        }
      }
    }

    function drawPieces(t) {
      const { c } = L(), u = c * 0.94, vw = viewer();
      // selection: an orange frame
      const hl = sel >= 0 ? sel : (!two && turn === BLUE && comPlan && comPlan.m ? comPlan.m.from : -1);
      if (hl >= 0 && (phase === 'play' || phase === 'setup')) {
        const [x, y] = cellXY(hl);
        g.draw.roundRect(x - c * 0.47, y - c * 0.47, c * 0.94, c * 0.94, c * 0.12, 'rgba(255,138,31,.18)', { stroke: SC.orange, lw: c * 0.055 });
      }
      for (let i = 0; i < N; i++) {
        const p = board[i];
        if (!p || (drag && drag.active && drag.from === i)) continue;
        if (anim && anim.p === p) continue;
        const [x, y] = piecePos(p, i);
        const lift = i === sel && phase === 'play' ? Math.abs(Math.sin(t * 5)) * c * 0.05 : 0;
        drawPiece(p, x, y - lift, u, vw, t);
      }
      if (anim) { const i = board.indexOf(anim.p); const [x, y] = piecePos(anim.p, i >= 0 ? i : anim.from); drawPiece(anim.p, x, y, u, vw, t); }
      // fading casualties
      for (let k = ghosts.length - 1; k >= 0; k--) {
        const gh = ghosts[k];
        const a = 1 - gh.t / 0.5;
        if (a <= 0) { ghosts.splice(k, 1); continue; }
        soldier(gh.p.side, gh.x, gh.y - gh.t * c * 0.5, u, { alpha: a, rot: gh.t * 2, sx: 1 + gh.t * 0.6, sy: 1 + gh.t * 0.6 });
      }
      // the move arrows around the selected soldier
      if (sel >= 0 && phase === 'play') {
        for (const m of targets(sel)) {
          const [x, y] = cellXY(m.to);
          const dx = Math.sign(A.colOf(m.to) - A.colOf(sel)), dy = Math.sign(A.rowOf(m.to) - A.rowOf(sel));
          const over = drag && drag.active && cellAt(drag.x, drag.y) === m.to;
          if (over) g.draw.roundRect(x - c * 0.45, y - c * 0.45, c * 0.9, c * 0.9, c * 0.12, 'rgba(255,255,255,.35)', { stroke: '#fff', lw: c * 0.04 });
          arrow(x, y, dx, dy, c, m.attack ? 'rgba(255,110,40,.92)' : 'rgba(255,255,255,.82)', t);
        }
      }
      // the soldier being dragged follows the finger
      if (drag && drag.active && board[drag.from]) {
        drawPiece(board[drag.from], drag.x, drag.y - c * 0.15, u * 1.08, vw, t);
      }
      // end: point out both flags
      if (phase === 'end') {
        for (let i = 0; i < N; i++) {
          const p = board[i];
          if (!p || p.w !== 'F') continue;
          const [x, y] = cellXY(i);
          g.draw.circle(x, y, c * (0.5 + 0.04 * Math.sin(t * 6)), null, { stroke: SC.gold, lw: c * 0.06 });
        }
      }
      // keyboard cursor
      if (kbd && (phase === 'setup' || humanTurn()) && cur.r < 6) {
        const [x, y] = cellXY(A.at(cur.c, cur.r));
        ctx.save(); ctx.setLineDash([c * 0.12, c * 0.08]); ctx.lineDashOffset = -t * 30;
        g.draw.roundRect(x - c * 0.46, y - c * 0.46, c * 0.92, c * 0.92, c * 0.12, null, { stroke: '#fff', lw: c * 0.05 });
        ctx.restore();
      }
    }

    // ---- HUD around the board ----
    function button(x, y, w, h, label, primary, focus) {
      g.draw.roundRect(x - w / 2, y - h / 2 + h * 0.08, w, h, h / 2, SC.ink);
      g.draw.roundRect(x - w / 2, y - h / 2, w, h, h / 2, primary ? SC.orange : SC.frame, { stroke: focus ? '#fff' : SC.ink, lw: focus ? h * 0.1 : h * 0.06 });
      if (primary) ttext(label, x, y + h * 0.02, h * 0.5, '#fff');
      else g.draw.text(label, x, y + h * 0.02, h * 0.46, { color: SC.ink, weight: 700 });
    }
    function drawHud(t) {
      const { cx, cy, R } = g;
      const topY = cy - R * 0.695, botY = cy + R * BTN_Y;
      // top banner: whose turn / what to do
      let msg = '', col = '#fff', white = false;
      if (phase === 'setup') {
        const st = setupStep(), who = two ? `${TEAM[setupSide].name}: ` : '';
        msg = st === 0 ? `${who}Hide your flag` : st === 1 ? `${who}Now set your trap` : `${who}Ready for battle?`;
        col = TEAM[setupSide].text; white = true;
      } else if (phase === 'end') {
        msg = two ? `${TEAM[winner].name} wins!` : winner === RED ? 'You win!' : 'COM wins';
        col = TEAM[winner].text; white = true;
      } else if (phase === 'duel' || phase === 'pick') {
        msg = '';
      } else if (phase !== 'cover') {
        msg = two ? `${TEAM[turn].name}'s turn` : turn === RED ? 'Your turn' : 'COM is thinking…';
        col = TEAM[turn].text; white = true;
      }
      if (msg) ttext(msg, cx, topY, fitSize(msg, R * 0.082, R * 1.15), col, { white });

      if (phase === 'setup') {
        const st = setupStep();
        if (st < 2) {
          ttext(st === 0 ? 'Tap a soldier to carry the flag' : 'Tap another soldier to guard the trap', cx, botY - R * 0.05, R * 0.045, '#fff', { alpha: 0.95 });
          // show what's being placed
          if (st === 0) drawFlagItem(cx, botY + R * 0.13, R * 0.035, setupSide, t * 4);
          else drawTrap(cx, botY + R * 0.08, R * 0.05);
        } else {
          for (let k = 0; k < 2; k++) button(cx + BTN[k].x * R, botY, R * 0.32, R * 0.11, BTN[k].label, k === 1, kbd && cur.r === 6 && cur.c === k);
          ttext('Tap your flag or trap to move it', cx, botY + R * 0.12, R * 0.034, '#fff', { alpha: 0.85 });
        }
        return;
      }
      if (phase === 'cover') return;
      // soldiers left on each side
      for (const s of [RED, BLUE]) {
        const x = cx + (s === RED ? -0.34 : 0.34) * R, y = botY - R * 0.005;
        soldier(s, x - R * 0.05, y, R * 0.11);
        ttext(`×${alive(s)}`, x + R * 0.06, y + R * 0.005, R * 0.055, '#fff');
      }
      // turn timer badge (or the move count)
      if (tLimit && (humanTurn() || phase === 'pick')) {
        const left = Math.max(0, timeLeft), urgent = left <= 3.5;
        g.draw.circle(cx, botY, R * 0.075, urgent ? '#e5402f' : SC.ink, { stroke: '#fff', lw: R * 0.01 });
        ttext(String(Math.ceil(left)), cx, botY + R * 0.004, R * 0.075, '#fff', { stroke: urgent ? '#7a160c' : SC.ink });
        const side = phase === 'pick' ? pickSt.queue[0] : turn;
        g.draw.arc(cx, cy, R * 0.957, 0, TAU * (left / tLimit), TEAM[side].main, R * 0.016);
      } else if (phase !== 'end') {
        const n = two ? moves[turn] : moves[RED];
        g.draw.text(`${n} ${n === 1 ? 'move' : 'moves'}`, cx, botY + R * 0.005, R * 0.042, { color: SC.ink, weight: 700 });
      }
    }

    // ---- overlays: cartoon duel close-up, weapon pick, pass-the-screen cover ----
    function rays(x, y, rad, t, n = 18) {
      ctx.fillStyle = SC.ray;
      for (let k = 0; k < n; k += 2) {
        const a0 = (k / n) * TAU + t * 0.25, a1 = ((k + 1) / n) * TAU + t * 0.25;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, rad, a0, a1); ctx.closePath(); ctx.fill();
      }
    }
    function panel(t, top = -0.44, bot = 0.44) {
      const { cx, cy, R } = g;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = 'rgba(40,58,4,.5)'; ctx.fill();
      const w = R * 1.56, x = cx - w / 2, y = cy + top * R, h = (bot - top) * R;
      g.draw.roundRect(x, y + R * 0.015, w, h, R * 0.08, SC.ink);
      ctx.beginPath(); ctx.roundRect(x, y, w, h, R * 0.08); ctx.fillStyle = SC.panel; ctx.fill();
      ctx.save(); ctx.clip(); rays(cx, cy + R * 0.05, R * 1.2, t);
      ctx.fillStyle = 'rgba(120,160,20,.35)'; ctx.beginPath(); ctx.ellipse(cx, y + h, w * 0.6, R * 0.16, 0, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.roundRect(x, y, w, h, R * 0.08);
      ctx.lineWidth = R * 0.012; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.restore();
    }
    function pow(x, y, r, t) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.6);
      for (const [rr, col] of [[1, SC.out], [0.9, SC.gold], [0.55, '#ff7a1a']]) {
        ctx.beginPath();
        for (let k = 0; k < 20; k++) { const a = (k / 20) * TAU, q = (k % 2 ? 0.55 : 1) * r * rr; ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q); }
        ctx.closePath(); ctx.fillStyle = col; ctx.fill();
      }
      ctx.restore();
    }
    function drawDuel(dt) {
      const { cx, cy, R } = g;
      const d = duel, t = d.t;
      panel(T);
      ttext('BATTLE!', cx, cy - R * 0.355, R * 0.085, '#fff');
      const U = R * 0.44, baseY = cy + R * 0.09;
      const IMPACT = 0.62;
      // sides: red always on the left
      const red = d.a.side === RED ? { p: d.a, w: d.aw, atk: true } : { p: d.d, w: d.dw, atk: false };
      const blue = d.a.side === RED ? { p: d.d, w: d.dw, atk: false } : { p: d.a, w: d.aw, atk: true };
      const res = d.res;
      const winSide = res === 'win' || res === 'flag' ? d.a.side : res === 'lose' || res === 'trap' ? d.d.side : -1;
      for (const [o, s] of [[red, -1], [blue, 1]]) {
        const side = o.p.side;
        let x, y = baseY, rot = 0, alpha = 1, sc = 1;
        const slide = ease.out(clamp(t / 0.38, 0, 1));
        x = s * (1.0 - 0.68 * slide);            // in from the sides to ±0.32
        if (t > 0.38) {                          // wind up, then clash
          const k = clamp((t - 0.38) / (IMPACT - 0.38), 0, 1);
          x = s * (0.32 + 0.06 * Math.sin(k * Math.PI) - 0.17 * ease.inOut(k));
        }
        if (t > IMPACT) {
          const k = clamp((t - IMPACT) / 0.7, 0, 1);
          if (winSide === -1) x = s * (0.15 + 0.17 * ease.out(k));
          else if (side === winSide) { x = s * 0.15; y = baseY - Math.abs(Math.sin(k * Math.PI * 3)) * R * 0.05 * (1 - k); }
          else { x = s * (0.15 + 0.9 * k); y = baseY - Math.sin(k * Math.PI) * R * 0.3 + k * R * 0.2; rot = s * k * 5; alpha = 1 - k * 0.8; }
        }
        const px = cx + x * R;
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.translate(px, y); ctx.rotate(rot); ctx.scale(s > 0 ? -1 : 1, 1);
        soldier(side, 0, 0, U * sc);
        ctx.restore();
        // the weapon, held out towards the enemy
        ctx.save(); ctx.globalAlpha = alpha;
        const hx = px - s * U * 0.36, hy = y + U * 0.05 + (t > 0.38 && t < IMPACT ? -U * 0.18 * Math.sin((t - 0.38) / (IMPACT - 0.38) * Math.PI) : 0);
        const w = o.w;
        if (w === 'T') drawTrap(hx, y + U * 0.2, U * 0.24, t > IMPACT ? clamp((t - IMPACT) / 0.12, 0, 1) : 0);
        else if (w === 'F') drawFlagItem(hx, hy + U * 0.15, U * 0.13, side, T * 4);
        else if (w === 'R') drawRock(hx, hy, U * 0.2, -s * 0.3);
        else if (w === 'P') drawPaper(hx, hy, U * 0.19, -s * 0.2);
        else if (w === 'S') drawScissors(hx, hy, U * 0.22, -s * 0.9 - 0.25, t > IMPACT && t < IMPACT + 0.25 ? 0.05 : 0.36);
        ctx.restore();
        if (t > 0.3 && t < IMPACT + 0.1) ttext(w === 'T' ? 'Trap' : w === 'F' ? 'Flag' : WNAME[w], cx + s * R * 0.34, cy - R * 0.22, R * 0.062, TEAM[side].text, { white: true, alpha: clamp((t - 0.3) / 0.15, 0, 1) });
      }
      if (t > IMPACT && !d.hit) {
        d.hit = true; shake = 0.25;
        g.sfx(res === 'trap' ? 'boom' : res === 'tie' ? 'bounce' : 'hit'); g.vibrate(25);
        g.draw.burst(cx, cy + R * 0.02, SC.gold, 18, R * 0.7, R * 0.014);
      }
      if (t > IMPACT && t < IMPACT + 0.45) pow(cx, cy + R * 0.02, R * 0.12 * ease.back(clamp((t - IMPACT) / 0.15, 0, 1)) * (1 - clamp((t - IMPACT - 0.3) / 0.15, 0, 1)), T);
      if (t > IMPACT + 0.1) {
        let txt;
        if (res === 'tie') txt = 'Tie! Pick again';
        else if (res === 'trap') txt = "It's a trap!";
        else if (res === 'flag') txt = 'Flag captured!';
        else { const ww = res === 'win' ? d.aw : d.dw, lw = res === 'win' ? d.dw : d.aw; txt = `${WNAME[ww]} ${VERB[ww]} ${WNAME[lw].toLowerCase()}`; }
        const k = ease.back(clamp((t - IMPACT - 0.1) / 0.25, 0, 1));
        ctx.save(); ctx.translate(cx, cy + R * 0.34); ctx.scale(k, k);
        ttext(txt, 0, 0, fitSize(txt, R * 0.068, R * 1.3), res === 'tie' ? SC.gold : '#fff');
        ctx.restore();
      }
    }
    function drawPick() {
      const { cx, cy, R } = g;
      panel(T, -0.4, 0.4);
      const s = pickSt.queue[0];
      ttext(`Tie — both had ${WNAME[pickSt.tied].toLowerCase()}!`, cx, cy - R * 0.3, fitSize('Tie — both had scissors!', R * 0.06, R * 1.25), '#fff');
      ttext(two ? `${TEAM[s].name}: pick a new weapon` : 'Pick a new weapon', cx, cy - R * 0.185, R * 0.058, TEAM[s].text, { white: true });
      for (let k = 0; k < 3; k++) {
        const [x, y] = pickXY(k), focus = pickIdx === k && kbd;
        const bob = Math.sin(T * 4 + k) * R * 0.008;
        g.draw.circle(x, y + R * 0.012, R * 0.15, SC.ink);
        g.draw.circle(x, y + bob, R * 0.15, focus ? '#fff6d6' : SC.frame, { stroke: focus ? SC.orange : SC.ink, lw: R * (focus ? 0.016 : 0.009) });
        item(PICKS[k], x, y + bob, R * 0.09, s);
        ttext(WNAME[PICKS[k]], x, y + R * 0.2, R * 0.042, '#fff');
      }
    }
    function drawCover() {
      const { cx, cy, R } = g;
      const c = cover, t = c.t;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = SC.bg; ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R * 0.972, 0, TAU); ctx.fillStyle = SC.disc; ctx.fill(); ctx.clip();
      rays(cx, cy, R * 1.1, T * 0.6, 24);
      ctx.restore();
      const k = ease.back(clamp(t / 0.35, 0, 1));
      if (c.side >= 0) {
        const bob = Math.abs(Math.sin(T * 3)) * R * 0.04;
        soldier(c.side, cx, cy + R * 0.02 - bob, R * 0.5, { sx: k, sy: k });
      } else {
        // both teams for the battle replay
        soldier(RED, cx - R * 0.2, cy + R * 0.02, R * 0.4, { sx: k, sy: k });
        ctx.save(); ctx.translate(cx + R * 0.2, cy + R * 0.02); ctx.scale(-1, 1); soldier(BLUE, 0, 0, R * 0.4, { sx: k, sy: k }); ctx.restore();
      }
      const col = c.side >= 0 ? TEAM[c.side].text : '#fff';
      ttext(c.title, cx, cy - R * 0.43, fitSize(c.title, R * 0.085, R * 1.4), col, { white: c.side >= 0 });
      ttext(c.sub, cx, cy + R * 0.4, R * 0.055, '#fff');
      ttext('Tap when ready', cx, cy + R * 0.56, R * 0.05, '#fff', { alpha: 0.75 + 0.25 * Math.sin(T * 4) });
    }

    // ================================================================= loop
    g.loop((dt) => {
      T += dt;
      // ---- update ----
      for (const p of board) if (p && p.hop > 0) p.hop = Math.max(0, p.hop - dt * 0.5);
      if (anim) {
        anim.t += dt;
        if (anim.t >= anim.dur) { const f = anim.then; anim = null; if (phase === 'anim' || phase === 'lunge') f(); }
      }
      if (phase === 'duel') { duel.t += dt; if (duel.t >= duel.dur) finishDuel(); }
      if (phase === 'cover') cover.t += dt;
      if (phase === 'end') endT += dt;
      for (const gh of ghosts) gh.t += dt;
      // the COM: think, show which soldier it picked, then move
      if (phase === 'play' && !two && turn === BLUE) {
        comT -= dt;
        if (comT <= 0) {
          if (!comPlan) { comPlan = { m: A.chooseMove(board, BLUE, level, mem[BLUE]) }; comT = 0.4; if (!comPlan.m) endGame(RED, 'stuck'); }
          else doMove(comPlan.m);
        }
      }
      // the turn timer: out of time → a random legal move / weapon
      if (tLimit && (humanTurn() || phase === 'pick')) {
        timeLeft -= dt;
        const s = Math.ceil(timeLeft);
        if (s < lastTick) { lastTick = s; if (s <= 3 && s > 0) g.sfx('tick'); }
        if (timeLeft <= 0) {
          g.toast('Time up!', 900);
          if (phase === 'pick') choose(pick(PICKS)); else doMove(A.randomMove(board, turn));
        }
      }
      if (shake > 0) shake = Math.max(0, shake - dt);

      // ---- draw ----
      ctx.save();
      if (shake > 0) ctx.translate(rand(-1, 1) * shake * g.R * 0.04, rand(-1, 1) * shake * g.R * 0.04);
      drawScene();
      if (phase !== 'cover') { drawBoard(T); drawPieces(T); }
      drawHud(T);
      if (phase === 'duel') drawDuel(dt);
      else if (phase === 'pick') drawPick();
      else if (phase === 'cover') drawCover();
      g.draw.particles(dt);
      ctx.restore();
    });
    return {};
  },
};
