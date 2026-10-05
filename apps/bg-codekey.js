// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Codenames companion — random key cards from a short seed, so the display and the spymasters' phones
// (apps/phone/codekey.html, which carries an identical copy of this generator) draw the very same key.
//   classic  5×5: starting team 9, other team 8, 7 bystanders, 1 assassin (the border shows who starts)
//   pictures 5×4: starting team 8, other team 7, 4 bystanders, 1 assassin
//   duet     5×5, two sides: 9 green + 3 assassins + 13 bystanders on each side, 15 different agents in all —
//            3 cells green on both sides, 1 assassin on both sides, 1 of each side's assassins is green on the
//            other side and 1 is a bystander there.
// Key string: <mode letter><seed in base 36>, e.g. "c1k9zq" — goes into the QR link as ?k=…
export const MODES = { c: 'classic', p: 'pictures', d: 'duet' };

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
const fill = (pairs) => pairs.flatMap(([v, n]) => Array(n).fill(v));

/** Cells: classic/pictures → 'r' red agent, 'b' blue agent, 'n' bystander, 'x' assassin; duet → [sideA, sideB] with 'g'/'n'/'x'. */
export function genKey(key) {
  const mode = MODES[key[0]] || 'classic';
  const seed = parseInt(key.slice(1), 36) || 1;
  const rnd = mulberry32(seed);
  if (mode === 'duet') {
    const cells = shuffle(fill([['gg', 3], ['gn', 5], ['gx', 1], ['xg', 1], ['xx', 1], ['xn', 1], ['ng', 5], ['nx', 1], ['nn', 7]]), rnd);
    return { mode, cols: 5, rows: 5, cells: cells.map((c) => [c[0], c[1]]) };
  }
  const start = rnd() < 0.5 ? 'r' : 'b', other = start === 'r' ? 'b' : 'r';
  const [a, b, n, cols, rows] = mode === 'pictures' ? [8, 7, 4, 5, 4] : [9, 8, 7, 5, 5];
  return { mode, start, cols, rows, cells: shuffle(fill([[start, a], [other, b], ['n', n], ['x', 1]]), rnd) };
}
export const newKey = (mode = 'c') => mode[0] + (1 + Math.floor(Math.random() * 2176782334)).toString(36);
export const count = (cells, v, side) => cells.filter((c) => (side == null ? c : c[side]) === v).length;
