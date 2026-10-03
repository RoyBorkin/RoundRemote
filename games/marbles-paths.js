// Marble Chain — the six tracks. Pure geometry, no DOM: every path is a list of points in normalised screen
// coordinates (centre 0,0 · radius of the round screen = 1 · y points down), resampled into an arc-length table
// so the marbles can move by distance.

const rad = (d) => (d * Math.PI) / 180;
/** 0 = 12 o'clock, clockwise (like the rest of the app). */
const polarPt = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A curve in polar form: angle runs a0 → a1 (degrees, clockwise), radius r(u, a) with u = 0…1. */
function polar(a0, a1, rf, n = 3000) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const u = i / n, a = rad(a0 + (a1 - a0) * u); pts.push(polarPt(a, rf(u, a))); }
  return pts;
}
/** Turtle graphics: start at x,y heading `hdg` degrees (screen angle, 0 = east, 90 = south). Commands:
 *  ['f', len]  straight ahead ·  ['t', deg, radius]  arc, + deg = turn right (clockwise on screen). */
/** Mirror left ↔ right (turns a clockwise track into an anticlockwise one). */
const mirror = (pts) => pts.map(([x, y]) => [-x, y]);
function turtle(x, y, hdg, cmds) {
  const pts = [[x, y]], ds = 0.003;
  let h = rad(hdg);
  for (const [k, a, b] of cmds) {
    const len = k === 'f' ? a : Math.abs(rad(a)) * b;
    const n = Math.max(1, Math.ceil(len / ds)), st = len / n, turn = k === 'f' ? 0 : (Math.sign(a) * st) / b;
    for (let i = 0; i < n; i++) { h += turn / 2; x += Math.cos(h) * st; y += Math.sin(h) * st; h += turn / 2; pts.push([x, y]); }
  }
  return pts;
}

// Shooter position per path (normalised). Four sit in the middle, two near the edge.
export const PATHS = [
  { name: 'Spiral', shooter: [0, 0],
    // 1½ turns inward, starting just right of the score so 12 o'clock is only crossed below the score
    pts: () => polar(38, 558, (u) => 0.83 - 0.54 * u) },
  { name: 'Bloom', shooter: [0, 0],
    // a wavy flower ring with five petals (anticlockwise), gap at the top (keeps the score clear), dives in to the hole
    pts: () => mirror(polar(22, 342, (u, a) => 0.68 - 0.04 * u + 0.14 * Math.cos(5 * (a - rad(58))) * (1 - 0.3 * u) - 0.3 * smooth(0.82, 1, u))) },
  { name: 'Meander', shooter: [0, 0],
    // outer arc anticlockwise, a hairpin at the top right, inner arc back the other way (12 o'clock stays clear)
    pts: () => {
      const a0 = 32, r1 = 0.79, r2 = 0.49, [x, y] = polarPt(rad(a0), r1);
      return mirror(turtle(x, y, a0, [['t', 296, r1], ['t', 180, (r1 - r2) / 2], ['t', -284, r2], ['t', -80, 0.14]]));
    } },
  { name: 'Clover', shooter: [0, 0],
    // three fat petals (big right turns at the tips, left turns in the valleys), 2½ of them, ending in the
    // valley under the score
    pts: () => {
      const petal = [['f', 0.05], ['t', 225, 0.2], ['f', 0.05], ['t', -105, 0.2]];
      const loop = turtle(0, 0, 0, [...petal, ...petal, ...petal]);
      // centre it, put a valley (the end of a petal) at 12 o'clock and scale it to the screen
      const cx = loop.reduce((s, p) => s + p[0], 0) / loop.length, cy = loop.reduce((s, p) => s + p[1], 0) / loop.length;
      const per = Math.floor((loop.length - 1) / 3), end = loop[per * 3];
      const rot = -Math.atan2(end[0] - cx, -(end[1] - cy)), c = Math.cos(rot), s = Math.sin(rot);
      let pts = loop.map(([x, y]) => [(x - cx) * c - (y - cy) * s, (x - cx) * s + (y - cy) * c]);
      const k = 0.86 / Math.max(...pts.map(([x, y]) => Math.hypot(x, y)));
      pts = pts.map(([x, y]) => [x * k, y * k]);
      // start at the tip of the first petal (the point furthest out), finish in the third valley
      let tip = 0;
      for (let i = 0; i < per; i++) if (Math.hypot(...pts[i]) > Math.hypot(...pts[tip])) tip = i;
      return pts.slice(tip, per * 3 + 1);
    } },
  { name: 'Snake', shooter: [0, 0.6],
    // rows across the top half, the shooter sits low
    pts: () => turtle(-0.8, -0.4, 0, [
      ['f', 1.3], ['t', 180, 0.12], ['f', 1.15], ['t', -180, 0.12], ['f', 1.26], ['t', 180, 0.12], ['f', 0.86],
    ]) },
  { name: 'Zigzag', shooter: [-0.6, 0.02],
    // columns up and down the right half, the shooter sits on the left
    pts: () => turtle(0.62, 0.62, -90, [
      ['f', 1.02], ['t', -180, 0.12], ['f', 1.02], ['t', 180, 0.12], ['f', 0.92], ['t', -180, 0.12], ['f', 0.72],
    ]) },
];

/** Arc-length table: xs/ys every `step` along the path. */
export function buildTable(pts, step = 0.01) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1], n = Math.floor(L / step) + 1;
  const xs = new Float32Array(n + 1), ys = new Float32Array(n + 1);
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = Math.min(L, i * step);
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    xs[i] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f;
    ys[i] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f;
  }
  return { L, n, step, xs, ys };
}
