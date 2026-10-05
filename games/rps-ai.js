// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// RPS Battle — the rules (pure, no drawing) and the COM player.
// Board: 7 columns × 6 rows, cell index = row * 7 + col. Red starts in rows 4–5 (bottom), Blue in rows 0–1.
// A piece: { id, side, w: 'R'|'P'|'S'|'F'|'T', revealed, moved }. Flag (F) and trap (T) never move.
// The COM only ever reads its own pieces' weapons, the opponent's REVEALED weapons, which opponent pieces
// have moved, and public duel results (passed in `mem`) — it never peeks at hidden information.

export const W = 7, H = 6, N = W * H;
export const RED = 0, BLUE = 1;
export const RPS = ['R', 'P', 'S'];
/** What each weapon beats, and what beats it. */
export const BEATS = { R: 'S', S: 'P', P: 'R' };
export const LOSES = { R: 'P', S: 'R', P: 'S' };
export const beats = (a, b) => BEATS[a] === b;
export const mobile = (w) => w === 'R' || w === 'P' || w === 'S';
export const colOf = (i) => i % W;
export const rowOf = (i) => (i / W) | 0;
export const at = (c, r) => r * W + c;
export const dist = (a, b) => Math.abs(colOf(a) - colOf(b)) + Math.abs(rowOf(a) - rowOf(b));
/** Rows a side starts on (back row first). */
export const homeRows = (side) => (side === RED ? [5, 4] : [0, 1]);
/** +1 / −1: the row direction towards the enemy. */
export const fwd = (side) => (side === RED ? -1 : 1);

/** Neighbour cells (up, down, left, right) of every cell. */
export const NB = Array.from({ length: N }, (_, i) => {
  const c = colOf(i), r = rowOf(i), out = [];
  if (r > 0) out.push(i - W);
  if (r < H - 1) out.push(i + W);
  if (c > 0) out.push(i - 1);
  if (c < W - 1) out.push(i + 1);
  return out;
});

export const TUNE = { flagV: 1000, guard: 0, guardT: 0.45, expo: 0.35, hunt: 1.6, fresh: 0.07, noise: 0.08, atkBonus: 0, backW: 1.5, trapW: 1, flagBack: 0.92, trapFront: 0.75, trapSide: 0.15, corner: 0.5 };

let nextId = 1;
export const newBoard = () => new Array(N).fill(null);
const shuffled = (a, rnd = Math.random) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Fill a side's two home rows with fresh soldiers (no weapons yet). */
export function fillSide(board, side) {
  for (const r of homeRows(side)) for (let c = 0; c < W; c++) board[at(c, r)] = { id: nextId++, side, w: null, revealed: false, moved: false };
}
/** Give the side's soldiers that aren't the flag or the trap 4 rock, 4 paper and 4 scissors, in a random order. */
export function dealWeapons(board, side, rnd = Math.random) {
  const ps = board.filter((p) => p && p.side === side && p.w !== 'F' && p.w !== 'T');
  const bag = shuffled(ps.map((_, k) => RPS[k % 3]), rnd);
  ps.forEach((p, k) => { p.w = bag[k]; });
}

/** Every legal move of a side: { from, to, attack }. */
export function legalMoves(board, side) {
  const out = [];
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (!p || p.side !== side || !mobile(p.w)) continue;
    for (const n of NB[i]) {
      const q = board[n];
      if (!q) out.push({ from: i, to: n, attack: false });
      else if (q.side !== side) out.push({ from: i, to: n, attack: true });
    }
  }
  return out;
}

/** The outcome of an attack, from the attacker's side: 'flag' (game won) 'trap' 'win' 'lose' 'tie'. */
export function fight(aw, dw) {
  if (dw === 'F') return 'flag';
  if (dw === 'T') return 'trap';
  if (aw === dw) return 'tie';
  return beats(aw, dw) ? 'win' : 'lose';
}

// ------------------------------------------------------------------ COM setup
/** Place the COM's flag and trap (index pairs in the home rows) for a level. */
export function comSetup(side, level, rnd = Math.random) {
  const [back, front] = homeRows(side);
  const rc = () => Math.floor(rnd() * W);
  let flag, trap;
  if (level === 'easy') {
    flag = at(rc(), back);
    do trap = at(rc(), rnd() < 0.5 ? back : front); while (trap === flag);
  } else if (level === 'normal') {
    flag = at(rc(), back);
    const c = colOf(flag);
    const opts = [at(c, front), at(c, front), at(c, front)];
    if (c > 0) opts.push(at(c - 1, back));
    if (c < W - 1) opts.push(at(c + 1, back));
    trap = opts[Math.floor(rnd() * opts.length)];
  } else {
    // hard: mostly the back row (sometimes the front row as a surprise); the trap guards the flag
    // or sits somewhere that looks like a flag spot (a decoy)
    flag = at(rnd() < TUNE.corner ? (rnd() < 0.5 ? 0 : W - 1) : rc(), rnd() < TUNE.flagBack ? back : front);
    const c = colOf(flag), r = rowOf(flag);
    const x = rnd();
    if (x < TUNE.trapFront) trap = at(c, r === back ? front : back);
    else if (x < TUNE.trapFront + TUNE.trapSide) {
      const side2 = [c - 1, c + 1].filter((cc) => cc >= 0 && cc < W);
      trap = at(side2[Math.floor(rnd() * side2.length)], r);
    } else do trap = at(rc(), back); while (trap === flag);
  }
  return { flag, trap };
}

// ------------------------------------------------------------------ COM beliefs
/**
 * The COM's belief about each opponent piece: cell → { R, P, S, F, T } probabilities, built from
 * public information only (revealed weapons, which pieces have moved, which weapons have died).
 */
export function beliefs(board, me, mem, level) {
  const en = 1 - me, hard = level === 'hard';
  const B = new Map();
  const est = { R: 1, P: 1, S: 1 };
  const unknown = [];
  if (hard) { est.R = est.P = est.S = 4; for (const w of RPS) est[w] -= mem.dead?.[w] || 0; }
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (!p || p.side !== en) continue;
    if (p.revealed) {
      const d = { R: 0, P: 0, S: 0, F: 0, T: 0 }; d[p.w] = 1; B.set(i, d);
      if (hard && mobile(p.w)) est[p.w]--;
    } else unknown.push(i);
  }
  for (const w of RPS) est[w] = Math.max(0.35, est[w]);
  const estSum = est.R + est.P + est.S;
  const back = homeRows(en)[0];
  const unmoved = unknown.filter((i) => !board[i].moved);
  // where would a human hide the flag? anywhere it hasn't moved from — a little more often in the back row
  // a revealed trap usually sits right next to the flag it guards
  let trapAt = -1;
  if (hard) for (let i = 0; i < N; i++) { const p = board[i]; if (p && p.side === en && p.revealed && p.w === 'T') trapAt = i; }
  const fw = (i) => (hard ? (rowOf(i) === back ? TUNE.backW : 1) * (colOf(i) === 0 || colOf(i) === W - 1 ? 1.1 : 1) * (trapAt >= 0 && dist(i, trapAt) === 1 ? TUNE.trapW : 1) : 1);
  let sumF = 0;
  for (const i of unmoved) sumF += fw(i);
  const tLeft = mem.trapFound ? 0 : 1;
  for (const i of unknown) {
    let pF = 0, pT = 0;
    if (!board[i].moved) {
      pF = sumF ? fw(i) / sumF : 0;
      pT = unmoved.length > 1 ? tLeft * (1 - pF) / (unmoved.length - 1) : 0;
    }
    const rest = Math.max(0, 1 - pF - pT);
    B.set(i, { F: pF, T: pT, R: rest * est.R / estSum, P: rest * est.P / estSum, S: rest * est.S / estSum });
  }
  return B;
}

// ------------------------------------------------------------------ COM move
/**
 * Pick the COM's move. level: 'easy' | 'normal' | 'hard'.
 * mem: { dead: {R,P,S} (opponent weapons seen dying), trapFound, lastFrom: {pieceId: cell} }.
 */
export function chooseMove(board, me, level, mem = {}, rnd = Math.random) {
  const K = TUNE;
  const moves = legalMoves(board, me);
  if (!moves.length) return null;
  if (level === 'easy') return easyMove(board, me, moves, rnd);
  const hard = level === 'hard';
  const en = 1 - me;
  const B = beliefs(board, me, mem, level);
  let myFlag = -1;
  const enemies = [];
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (!p) continue;
    if (p.side === me && p.w === 'F') myFlag = i;
    else if (p.side === en) enemies.push(i);
  }
  const threatNearFlag = myFlag >= 0 && enemies.some((e) => dist(e, myFlag) <= 3);

  // how much a piece with weapon w at `cell` stands to lose to the opponent's next move
  function exposure(cell, w, revealed, skip = -1) {
    let t = 0;
    for (const n of NB[cell]) {
      if (n === skip) continue;
      const q = board[n];
      if (!q || q.side !== en) continue;
      const d = B.get(n);
      const canMove = 1 - d.F - d.T;
      const pBeat = d[LOSES[w]], pWe = d[BEATS[w]];
      t += canMove * (revealed ? pBeat * 0.95 - pWe * 0.1 : K.expo * (pBeat - pWe));
    }
    return t;
  }

  let best = null, bv = -Infinity;
  for (const m of moves) {
    const p = board[m.from], w = p.w;
    let v = 0;
    if (m.attack) {
      const d = B.get(m.to);
      const pw = d[BEATS[w]], pl = d[LOSES[w]], pt = d[w];
      const rc = p.revealed ? 0 : hard ? 0.22 : 0.1;
      v += d.F * (hard ? K.flagV : 1000) - d.T * 0.85 + pw * (1 - rc) - pl * 0.8;
      // a tie is a coin flip after both re-pick
      v += pt * 0;
      if (hard) v -= pw * exposure(m.to, w, true, m.to) * 0.9;
      // defend the flag: knock out whoever is closing in on it
      if (myFlag >= 0) {
        const df = dist(m.to, myFlag);
        if (df <= 2) v += (3 - df) * 1.4 * (pw + pt * 0.5);
      }
      if (!hard) v += 0.05;
    } else {
      const adv = (rowOf(m.to) - rowOf(m.from)) * fwd(me);
      v += adv * (hard ? 0.05 : 0.09);
      // chase revealed pieces we beat, keep away from revealed pieces that beat us
      for (const e of enemies) {
        const q = board[e];
        if (!q.revealed || !mobile(q.w)) continue;
        const d0 = dist(m.from, e), d1 = dist(m.to, e);
        if (BEATS[w] === q.w) v += (d0 - d1) * 0.14;
        else if (LOSES[w] === q.w) {
          v -= (d0 - d1) * 0.12;
          if (d1 === 1) v -= p.revealed ? 1.0 : hard ? 0.3 : 0.5;
        }
      }
      if (hard) v -= exposure(m.to, w, p.revealed) - 0.6 * exposure(m.from, w, p.revealed);
      // intercept enemies that approach the flag; don't walk away from guarding it
      if (myFlag >= 0) {
        for (const e of enemies) {
          const de = dist(e, myFlag);
          if (de > 3) continue;
          v += (dist(m.from, e) - dist(m.to, e)) * 0.22 * (4 - de) / 3;
        }
        if (dist(m.from, myFlag) === 1 && dist(m.to, myFlag) > 1) v -= threatNearFlag ? (hard ? K.guardT : 0.45) : hard ? K.guard : 0;
      }
      // hunt: drift towards the pieces most likely to be the flag
      if (hard) {
        for (const e of enemies) {
          const f = B.get(e).F;
          if (f > 0) v += (dist(m.from, e) - dist(m.to, e)) * f * K.hunt;
        }
        // keep the flag hidden among pieces that haven't moved yet (bluff): moving a fresh piece costs a bit
        if (!p.moved) v -= K.fresh;
      }
    }
    if (mem.lastFrom && mem.lastFrom[p.id] === m.to) v -= 0.22;
    if (hard && m.attack) v += K.atkBonus;
    v += (rnd() - 0.5) * (hard ? K.noise : 0.25);
    if (v > bv) { bv = v; best = m; }
  }
  return best;
}

function easyMove(board, me, moves, rnd) {
  const atk = moves.filter((m) => m.attack);
  if (atk.length && rnd() < 0.5) return atk[Math.floor(rnd() * atk.length)];
  let sum = 0;
  const wt = moves.map((m) => {
    const adv = (rowOf(m.to) - rowOf(m.from)) * fwd(me);
    const x = adv > 0 ? 3 : adv < 0 ? 0.4 : 1.4;
    sum += x; return x;
  });
  let r = rnd() * sum;
  for (let k = 0; k < moves.length; k++) { r -= wt[k]; if (r <= 0) return moves[k]; }
  return moves[moves.length - 1];
}

/** A random legal move (the turn timer ran out). */
export function randomMove(board, side, rnd = Math.random) {
  const ms = legalMoves(board, side);
  return ms.length ? ms[Math.floor(rnd() * ms.length)] : null;
}
