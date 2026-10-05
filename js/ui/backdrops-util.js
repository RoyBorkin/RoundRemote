// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Shared helpers for the home-screen backdrops (js/ui/backdrops.js): colour maths, offscreen layers,
// reusable unit gradients and small sprites. Everything here allocates only while a scene is being
// built — never per frame.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const WHITE = [255, 255, 255];
export const BLACK = [0, 0, 0];

/** '#rrggbb' / '#rgb' → [r, g, b] (fallback when the value is missing or invalid). */
export function hexRgb(hex, fb = [128, 128, 128]) {
  if (Array.isArray(hex)) return hex.slice(0, 3);
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}/i.test(h)) return fb.slice();
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c, a = 1) => `rgba(${Math.round(clamp(c[0], 0, 255))},${Math.round(clamp(c[1], 0, 255))},${Math.round(clamp(c[2], 0, 255))},${+a.toFixed(4)})`;
export const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

export function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function fromHsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
/** The same colour with its hue turned, saturation multiplied and lightness set (or kept when l is null). */
export function tone(c, { hue = 0, sat = 1, l = null, lMul = 1 } = {}) {
  const [h, s, L] = toHsl(c);
  return fromHsl(h + hue, s * sat, l === null ? L * lMul : l);
}

/** Small deterministic random generator so still frames look the same on every redraw. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An offscreen canvas (+ its 2D context), optionally painted once by fn(ctx). */
export function layer(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d');
  if (fn) fn(g, c);
  return c;
}

/** A soft round glow centred on (0,0) with radius 1 (a gaussian-like falloff that reaches 0 at the edge). */
export function softGrad(ctx, c, a = 1, k = 3) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  const e = Math.exp(-k);
  for (let i = 0; i <= 8; i++) {
    const x = i / 8;
    g.addColorStop(x, css(c, a * Math.max(0, (Math.exp(-k * x * x) - e) / (1 - e))));
  }
  return g;
}

/** Fill a unit gradient (defined around 0,0) scaled to rx/ry, rotated by rot and placed at x,y. */
export function blob(ctx, grad, x, y, rx, ry = rx, rot = 0) {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  ctx.setTransform(rx * cs, rx * sn, -ry * sn, ry * cs, x, y);
  ctx.fillStyle = grad;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** A pre-rendered soft dot sprite (diameter d px): hard = 0 → pure glow, 1 → crisp disc. */
export function dotSprite(d, c, { hard = 0.35, rim = 0 } = {}) {
  d = Math.max(4, Math.ceil(d));
  return layer(d, d, (g) => {
    const r = d / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, css(c, 1));
    gr.addColorStop(clamp(hard, 0, 0.95), css(c, rim ? 0.55 : 0.85));
    if (rim) { gr.addColorStop(clamp(hard + 0.02, 0, 0.97), css(c, rim)); gr.addColorStop(0.985, css(c, rim * 0.6)); }
    gr.addColorStop(1, css(c, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, d, d);
  });
}

/** A tiny four-point twinkle (a soft dot plus a thin cross). */
export function starSprite(d, c) {
  d = Math.max(6, Math.ceil(d));
  return layer(d, d, (g) => {
    const r = d / 2;
    let gr = g.createRadialGradient(r, r, 0, r, r, r * 0.45);
    gr.addColorStop(0, css(c, 1)); gr.addColorStop(0.3, css(c, 0.5)); gr.addColorStop(1, css(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, d, d);
    for (const vert of [0, 1]) {
      gr = vert ? g.createLinearGradient(r, 0, r, d) : g.createLinearGradient(0, r, d, r);
      gr.addColorStop(0, css(c, 0)); gr.addColorStop(0.5, css(c, 0.9)); gr.addColorStop(1, css(c, 0));
      g.fillStyle = gr;
      const w = Math.max(1, d / 18);
      if (vert) g.fillRect(r - w / 2, 0, w, d); else g.fillRect(0, r - w / 2, d, w);
    }
  });
}

/** Blur a canvas once (offscreen) — falls back to the shadow trick when ctx.filter is missing. */
export function blurred(src, px) {
  return layer(src.width, src.height, (g) => {
    if ('filter' in g) { g.filter = `blur(${px}px)`; g.drawImage(src, 0, 0); g.filter = 'none'; return; }
    g.shadowColor = '#000'; g.shadowBlur = px * 2; g.shadowOffsetX = src.width;
    g.drawImage(src, -src.width, 0);
  });
}

/** Smooth closed curve through points (xs, ys, n) using midpoint quadratic segments. */
export function closedCurve(ctx, xs, ys, n) {
  ctx.beginPath();
  let mx = (xs[n - 1] + xs[0]) / 2, my = (ys[n - 1] + ys[0]) / 2;
  ctx.moveTo(mx, my);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mx = (xs[i] + xs[j]) / 2; my = (ys[i] + ys[j]) / 2;
    ctx.quadraticCurveTo(xs[i], ys[i], mx, my);
  }
  ctx.closePath();
}

/** PS3/PSP-style colour of the month (index 0 = January). */
export const MONTH_COLOURS = ['#b8bcc6', '#d6ad3c', '#76b852', '#ef8fb4', '#2fbf74', '#9a5cc6',
  '#1fb3a6', '#3a8fe0', '#8448c0', '#e8842e', '#a8603c', '#c8403a'];
export const monthColour = (d = new Date()) => MONTH_COLOURS[d.getMonth()];
