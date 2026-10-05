// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Circle Pong — the power-ups of the "Power-ups" mode: what each one is and its flat round icon.
import { TAU, THEME } from './kit.js';

const BAD = THEME.danger;
/** dur = seconds it lasts (0 = instant / until used). w = how often it turns up. */
export const POWERS = {
  wide: { good: true, col: '#3ddc84', dur: 12, w: 3, name: 'Wide paddle' },
  slow: { good: true, col: '#2ee6d6', dur: 8, w: 2, name: 'Slow-mo' },
  multi: { good: true, col: '#ffc857', dur: 0, w: 2, name: '+2 balls' },
  shield: { good: true, col: '#b57bff', dur: 0, w: 2, name: 'Shield' },
  sticky: { good: true, col: '#ff8ad8', dur: 12, w: 2, name: 'Sticky paddle' },
  double: { good: true, col: '#ff9f43', dur: 10, w: 2, name: '×2 points' },
  shrink: { good: false, col: BAD, dur: 9, w: 2, name: 'Tiny paddle' },
  fast: { good: false, col: BAD, dur: 7, w: 2, name: 'Fast ball' },
  reverse: { good: false, col: BAD, dur: 5, w: 1.4, name: 'Reversed!' },
};
export const POWER_KINDS = Object.keys(POWERS);

/** Pick a kind by weight, skipping the ones `skip(kind)` rules out. */
export function pickPower(skip = () => false) {
  const list = POWER_KINDS.filter((k) => !skip(k));
  let n = list.reduce((s, k) => s + POWERS[k].w, 0) * Math.random();
  for (const k of list) { n -= POWERS[k].w; if (n <= 0) return k; }
  return list[0];
}

/** A flat round icon: a solid disc in the power's colour with a simple dark glyph on it. */
export function drawPowerIcon(g, kind, x, y, r, alpha = 1) {
  const { ctx } = g;
  const P = POWERS[kind];
  ctx.save();
  ctx.globalAlpha = alpha;
  g.draw.ball(x, y, r, P.col);
  ctx.translate(x, y);
  const ink = '#101116';
  ctx.strokeStyle = ink; ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(1.2, r * 0.17); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const L = (pts) => { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px * r, py * r) : ctx.moveTo(px * r, py * r))); ctx.stroke(); };
  switch (kind) {
    case 'wide': L([[-0.52, 0], [0.52, 0]]); L([[-0.28, -0.24], [-0.52, 0], [-0.28, 0.24]]); L([[0.28, -0.24], [0.52, 0], [0.28, 0.24]]); break;
    case 'shrink': L([[-0.56, -0.26], [-0.18, 0], [-0.56, 0.26]]); L([[0.56, -0.26], [0.18, 0], [0.56, 0.26]]); break;
    case 'slow':
      ctx.beginPath(); ctx.arc(0, 0, r * 0.46, 0, TAU); ctx.stroke();
      L([[0, 0], [0, -0.28]]); L([[0, 0], [0.2, 0.08]]); break;
    case 'fast': L([[-0.44, -0.3], [-0.1, 0], [-0.44, 0.3]]); L([[0.04, -0.3], [0.38, 0], [0.04, 0.3]]); break;
    case 'multi':
      for (const [px, py] of [[0, -0.27], [-0.27, 0.19], [0.27, 0.19]]) { ctx.beginPath(); ctx.arc(px * r, py * r, r * 0.16, 0, TAU); ctx.fill(); }
      break;
    case 'shield':
      ctx.beginPath(); ctx.moveTo(-0.36 * r, -0.4 * r); ctx.lineTo(0.36 * r, -0.4 * r); ctx.lineTo(0.36 * r, 0);
      ctx.quadraticCurveTo(0.3 * r, 0.36 * r, 0, 0.5 * r); ctx.quadraticCurveTo(-0.3 * r, 0.36 * r, -0.36 * r, 0); ctx.closePath(); ctx.stroke();
      break;
    case 'sticky':   // a magnet
      ctx.beginPath(); ctx.moveTo(-0.3 * r, -0.42 * r); ctx.lineTo(-0.3 * r, 0.02 * r); ctx.arc(0, 0.02 * r, 0.3 * r, Math.PI, 0, true); ctx.lineTo(0.3 * r, -0.42 * r); ctx.stroke();
      break;
    case 'double':
      ctx.font = `800 ${r * 0.82}px ${THEME.display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('×2', 0, r * 0.04);
      break;
    case 'reverse':
      L([[-0.44, -0.2], [0.44, -0.2]]); L([[0.24, -0.38], [0.44, -0.2], [0.24, -0.02]]);
      L([[0.44, 0.22], [-0.44, 0.22]]); L([[-0.24, 0.04], [-0.44, 0.22], [-0.24, 0.4]]);
      break;
  }
  ctx.restore();
}
