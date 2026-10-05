// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Home-screen backgrounds ("backdrops") drawn on a canvas behind the clock and the service ring.
//
//   mountBackdrop(host, spec)        → { set(spec), destroy() }   a <canvas class="backdrop"> filling host
//   drawBackdropPreview(canvas, spec)                             one still frame (settings thumbnails)
//   BACKDROPS                                                     the choices, in display order
//
// spec = { kind, theme, animated, mode: 'dark'|'oled'|'light', c1, c2, color, color2, monthColour, lite }
//   kind 'theme'        the theme's own background (classic, glass, soft, slate, vivid, bauhaus, xmb, ps5, amusic, spot, ipod)
//        'solid'        spec.color                     'gradient'  spec.color → spec.color2
//        'splashes'     soft organic colour splashes from c1 / c2
//        'ps2' 'ps3' 'ps4' 'ps5' 'psp-wave' 'psp-classic'   console-menu inspired scenes (original drawings)
//
// Every scene has a still version (drawn once, redrawn on resize) and an animated one
// (requestAnimationFrame capped at 30 fps — 15 fps when lite — paused while the page is hidden or the
// canvas is detached). Scenes precompute their static layers offscreen and composite a handful of
// gradient fills / short paths per frame, so they stay cheap on a Raspberry Pi 4 at 720×720.
// The screen is round: everything important sits inside the inner ~85%, and the centre stays calm
// for the clock drawn on top.
import { hexRgb, mix, css, tone, toHsl, fromHsl, softGrad, blob, closedCurve, layer, rng, lum, TAU, WHITE, BLACK, monthColour } from './backdrops-util.js';
import * as TH from './backdrops-themes.js';
import * as CO from './backdrops-console.js';

export { monthColour, MONTH_COLOURS } from './backdrops-util.js';

export const BACKDROPS = [
  { id: 'theme', name: 'Theme', group: 'Theme', animated: true },
  { id: 'solid', name: 'Solid colour', group: 'Colour', animated: true },
  { id: 'gradient', name: 'Gradient', group: 'Colour', animated: true },
  { id: 'splashes', name: 'Colour splashes', group: 'Colour', animated: true },
  { id: 'ps2', name: 'PS2 style', group: 'Console', animated: true },
  { id: 'ps3', name: 'PS3 style', group: 'Console', animated: true },
  { id: 'ps4', name: 'PS4 style', group: 'Console', animated: true },
  { id: 'ps5', name: 'PS5 style', group: 'Console', animated: true },
  { id: 'psp-wave', name: 'PSP style · wave', group: 'Console', animated: true },
  { id: 'psp-classic', name: 'PSP style · classic', group: 'Console', animated: true },
];

// default colours per theme (used when the spec has none)
const THEME_COLOURS = {
  classic: ['#1ed760', '#7c5cff'], glass: ['#ff7a45', '#7b5cff'], soft: ['#ff6a1a', '#5b7cfa'], slate: ['#9b8cff', '#f0b46b'],
  vivid: ['#4f6bff', '#ff4fa3'], bauhaus: ['#ff4b2b', '#ffc400'], xmb: ['#2f6fd6', '#8fb8ff'], ps5: ['#3d7bff', '#9ab8ff'],
  amusic: ['#fa2d48', '#ff9f43'], spot: ['#1ed760', '#2e77d0'], ipod: ['#4d9bff', '#9aa0a6'],
};
const PS5_BLUE = [70, 140, 255];

// ── simple kinds ─────────────────────────────────────────────────────────────────────────────

// solid — one flat colour; animated: a gentle brightness breathing from the centre
function solid(E) {
  const { W, H, S, cx, cy, ctx } = E;
  const col = E.color || (E.light ? [233, 235, 239] : E.oled ? [0, 0, 0] : [22, 23, 27]);
  const fill = css(col);
  const glow = softGrad(ctx, lum(col) > 0.6 ? BLACK : WHITE, lum(col) > 0.6 ? 0.06 : 0.09, 2);
  return {
    draw(c, t) {
      c.fillStyle = fill; c.fillRect(0, 0, W, H);
      const b = 0.5 - 0.5 * Math.cos((t * TAU) / 9);
      if (b > 0.004) { c.globalAlpha = b; blob(c, glow, cx, cy, S * 0.85); c.globalAlpha = 1; }
    },
  };
}

// gradient — color → color2 on a diagonal, with a soft rim shade for the round glass; animated: the angle turns
function gradient(E) {
  const { W, H, S, cx, cy, ctx } = E;
  const a = E.color || E.c1, b = E.color2 || E.c2;
  const mid = tone(mix(a, b, 0.5), { sat: 1.2 });
  const L = S * 0.6, D = S * 0.75;
  const g = ctx.createLinearGradient(-L, 0, L, 0);
  g.addColorStop(0, css(a)); g.addColorStop(0.5, css(mid)); g.addColorStop(1, css(b));
  const darkish = (lum(a) + lum(b)) / 2 < 0.55;
  const rim = layer(W, H, (lg) => {
    const r = lg.createRadialGradient(cx, cy, S * 0.32, cx, cy, S * 0.56);
    r.addColorStop(0, css(BLACK, 0)); r.addColorStop(1, css(BLACK, darkish ? 0.22 : 0.08));
    lg.fillStyle = r; lg.fillRect(0, 0, W, H);
  });
  return {
    draw(c, t) {
      const an = Math.PI / 4 + (t * TAU) / 60, cs = Math.cos(an), sn = Math.sin(an);
      c.setTransform(cs, sn, -sn, cs, cx, cy);
      c.fillStyle = g; c.fillRect(-D, -D, 2 * D, 2 * D);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(rim, 0, 0);
    },
  };
}

// splashes — amorphous colour splashes like ink in water: each one is a few translucent organic layers
// (outer wash, body, bright core + droplets) that slowly morph and float over static soft glows
function splashes(E) {
  const { W, H, S, cx, cy, ctx, few } = E;
  const bgRgb = E.light ? [246, 244, 240] : E.oled ? [0, 0, 0] : [11, 10, 16];
  let cols = [E.c1, E.c2, hueMix(E.c1, E.c2, 0.5), tone(E.c1, { hue: 40 }), tone(E.c2, { hue: -40 }), hueMix(E.c1, E.c2, 0.25)];
  if (E.light) cols = cols.map((c) => tone(mix(c, WHITE, 0.15), { sat: 1.1 }));
  const R = rng(21), N = 12;
  const lay = [
    { x: -0.24, y: -0.22, r: 0.2 }, { x: 0.27, y: -0.21, r: 0.15 }, { x: 0.22, y: 0.25, r: 0.21 },
    { x: -0.24, y: 0.27, r: 0.14 }, { x: 0.02, y: -0.4, r: 0.09 }, { x: -0.41, y: 0.03, r: 0.085 }, { x: 0.41, y: 0.05, r: 0.095 },
  ].slice(0, few ? 5 : 7);
  const sz = E.oled ? 0.78 : 1;
  const LAYERS = [{ s: 1, a: 0.34, ox: 0, oy: 0 }, { s: 0.76, a: 0.4, ox: 0.17, oy: -0.12 }, { s: 0.52, a: 0.46, ox: -0.13, oy: 0.15 }];
  const blobs = lay.map((o, i) => {
    const c = cols[i % cols.length];
    return {
      ...o, r: o.r * sz, p: 28 + R() * 30, q: R() * TAU,
      fills: [css(c), css(tone(c, { hue: 16, lMul: E.light ? 0.95 : 1.06 })), css(tone(c, { hue: -18, lMul: E.light ? 0.9 : 1.18, sat: 1.1 }))],
      // each layer's outline: radius = 1 + three low angular harmonics, each drifting at its own speed
      layers: LAYERS.map(() => ({ ph: [R() * TAU, R() * TAU, R() * TAU], w: [0.15 + R() * 0.2, -(0.12 + R() * 0.2), 0.1 + R() * 0.15], amp: [0.1 + R() * 0.08, 0.1 + R() * 0.08, 0.05 + R() * 0.05] })),
      drops: Array.from({ length: 3 }, () => ({ a: R() * TAU, d: 1.25 + R() * 0.5, s: 0.04 + R() * 0.07 })),
      halo: c,
    };
  });
  const base = layer(W, H, (g) => {
    g.fillStyle = css(bgRgb); g.fillRect(0, 0, W, H);
    if (!E.oled) for (const b of blobs) blob(g, softGrad(g, b.halo, E.light ? 0.3 : 0.32, 2.4), cx + b.x * S, cy + b.y * S, b.r * S * 2.1);
  });
  const xs = new Float32Array(N), ys = new Float32Array(N);
  const k = E.light ? 1.15 : E.oled ? 1.25 : 1;
  const scrim = softGrad(ctx, bgRgb, E.light ? 0.55 : 0.5, 2.2);
  return {
    draw(c, t) {
      c.drawImage(base, 0, 0);
      c.globalCompositeOperation = E.light ? 'multiply' : 'screen';
      for (const b of blobs) {
        const p = (t * TAU) / b.p + b.q;
        const x = cx + (b.x + 0.025 * Math.sin(p)) * S, y = cy + (b.y + 0.025 * Math.cos(p * 1.3)) * S, rot = t * 0.025 + b.q;
        const s = b.r * S, cs = Math.cos(rot) * s, sn = Math.sin(rot) * s;
        c.setTransform(cs, sn, -sn, cs, x, y);
        for (let l = 0; l < LAYERS.length; l++) {
          const L = LAYERS[l], ly = b.layers[l];
          for (let i = 0; i < N; i++) {
            const a = (i / N) * TAU, rr = L.s * (1 + ly.amp[0] * Math.sin(a + ly.ph[0] + t * ly.w[0]) + ly.amp[1] * Math.sin(2 * a + ly.ph[1] + t * ly.w[1]) + ly.amp[2] * Math.sin(3 * a + ly.ph[2] + t * ly.w[2]));
            xs[i] = L.ox + Math.cos(a) * rr; ys[i] = L.oy + Math.sin(a) * rr;
          }
          closedCurve(c, xs, ys, N);
          if (l === 0) for (const d of b.drops) {
            const da = d.a + Math.sin(t * 0.2 + d.a) * 0.2, dx = Math.cos(da) * d.d, dy = Math.sin(da) * d.d;
            c.moveTo(dx + d.s, dy); c.arc(dx, dy, d.s, 0, TAU);
          }
          c.globalAlpha = Math.min(1, L.a * k);
          c.fillStyle = b.fills[l]; c.fill();
        }
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      blob(c, scrim, cx, cy, S * 0.34);
    },
  };
}
/** Mix two colours through hue (keeps them vivid instead of going grey). */
function hueMix(a, b, t) {
  const A = toHsl(a), B = toHsl(b);
  let dh = B[0] - A[0];
  if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  return fromHsl(A[0] + dh * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

/**
 * Soft scenes (only glows and gradients) are animated at a low resolution and scaled up — the result looks
 * the same but costs a fraction of the fill rate. Still frames are drawn at full resolution.
 */
function lowres(fn, target = 200) {
  return (E) => {
    const k = Math.min(1, target / E.S);
    if (!E.animated || k > 0.8) return fn(E);
    const w = Math.max(8, Math.round(E.W * k)), h = Math.max(8, Math.round(E.H * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { alpha: false }) || cv.getContext('2d');
    const inner = fn({ ...E, ctx: g, W: w, H: h, S: Math.min(w, h), cx: w / 2, cy: h / 2, px: E.px * k });
    return {
      draw(c, t) {
        paint(g, inner, t);
        c.imageSmoothingEnabled = true;
        c.drawImage(cv, 0, 0, E.W, E.H);
      },
    };
  };
}
const SOFT_THEMES = {
  classic: lowres(TH.classic), glass: lowres(TH.glass), vivid: lowres(TH.vivid), amusic: lowres(TH.amusic), spot: lowres(TH.spot),
};
function themeScene(E) {
  switch (E.theme) {
    case 'soft': return TH.soft(E);
    case 'slate': return TH.slate(E);
    case 'bauhaus': return TH.bauhaus(E);
    case 'xmb': return CO.waves(E, E.c1, 'xmb');
    case 'ps5': return CO.ps5(E, E.c1);
    case 'ipod': return TH.ipod(E);
    default: return (SOFT_THEMES[E.theme] || SOFT_THEMES.classic)(E);
  }
}
const menuColour = (E) => (E.monthColour ? hexRgb(monthColour()) : E.c1);
const KINDS = {
  theme: themeScene, solid: lowres(solid), gradient: lowres(gradient), splashes: lowres(splashes, 360),
  ps2: (E) => CO.ps2(E),
  ps3: (E) => CO.waves(E, menuColour(E), 'ps3'),
  ps4: (E) => CO.ps4(E),
  ps5: (E) => CO.ps5(E, PS5_BLUE),
  'psp-wave': (E) => CO.waves(E, menuColour(E), 'psp'),
  'psp-classic': (E) => CO.pspClassic(E, menuColour(E)),
};

function normalize(spec = {}) {
  const theme = THEME_COLOURS[spec.theme] ? spec.theme : 'classic';
  const mode = spec.mode === 'light' || spec.mode === 'oled' ? spec.mode : 'dark';
  const kind = KINDS[spec.kind] ? spec.kind : 'theme';
  return { ...spec, kind, theme, mode, animated: !!spec.animated, lite: !!spec.lite, monthColour: !!spec.monthColour };
}

function build(ctx, W, H, spec, preview) {
  const S = Math.min(W, H);
  const dc = THEME_COLOURS[spec.theme];
  const E = {
    ctx, W, H, S, cx: W / 2, cy: H / 2, px: S / 720, theme: spec.theme, mode: spec.mode,
    light: spec.mode === 'light', oled: spec.mode === 'oled', dark: spec.mode === 'dark',
    c1: hexRgb(spec.c1, hexRgb(dc[0])), c2: hexRgb(spec.c2, hexRgb(dc[1])),
    color: spec.color ? hexRgb(spec.color) : null, color2: spec.color2 ? hexRgb(spec.color2) : null,
    monthColour: spec.monthColour, lite: spec.lite, few: spec.lite || preview, animated: spec.animated && !preview,
  };
  try { return KINDS[spec.kind](E); } catch (e) {
    console.warn('backdrop:', e);
    const fill = E.light ? '#eceef2' : E.oled ? '#000' : '#101114';
    return { draw(c) { c.fillStyle = fill; c.fillRect(0, 0, W, H); } };
  }
}

function paint(ctx, scene, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  scene.draw(ctx, t);
}

const monthKey = () => new Date().getMonth();

/** Mount a backdrop canvas into `host` (behind its content). */
export function mountBackdrop(host, spec) {
  const canvas = document.createElement('canvas');
  canvas.className = 'backdrop';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border-radius:50%;pointer-events:none;z-index:0;display:block';
  host.insertBefore(canvas, host.firstChild);
  const ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');

  let cur = normalize(spec), scene = null, W = 0, H = 0, raf = 0, last = 0, clock = 0, alive = true, month = monthKey(), monthTimer = 0;

  const rebuild = () => {
    if (!W || !H) return;
    scene = build(ctx, W, H, cur, false);
    paint(ctx, scene, cur.animated ? clock : 0);
  };
  const measure = () => {
    const dpr = Math.min(cur.lite ? 1 : 2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return false;
    if (w !== W || h !== H) { W = canvas.width = w; H = canvas.height = h; rebuild(); }
    return true;
  };
  const loop = (now) => {
    raf = 0;
    if (!alive || !cur.animated || !scene || document.hidden || !canvas.isConnected) return; // paused; kick() resumes
    raf = requestAnimationFrame(loop);
    const step = 1000 / (cur.lite ? 15 : 30);
    if (last && now - last < step - 4) return;
    clock += last ? Math.min(now - last, 100) / 1000 : 0;
    last = now;
    paint(ctx, scene, clock);
  };
  const kick = () => {
    if (raf || !alive || !cur.animated || !scene || document.hidden || !canvas.isConnected) return;
    last = 0;
    raf = requestAnimationFrame(loop);
  };
  const onVis = () => { if (!document.hidden) { measure(); kick(); } };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (alive && measure()) kick(); }) : null;
  const onResize = () => { if (measure()) kick(); };
  if (ro) ro.observe(canvas); else window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVis);
  // month colours change at the turn of the month
  const watchMonth = () => {
    clearInterval(monthTimer); monthTimer = 0;
    if (cur.monthColour) monthTimer = setInterval(() => { if (monthKey() !== month) { month = monthKey(); rebuild(); } }, 3600e3);
  };

  measure(); watchMonth(); kick();

  return {
    canvas,
    set(next) {
      if (!alive) return;
      cur = normalize(next); month = monthKey();
      scene = null; W = H = 0;   // force a rebuild at the current size
      measure(); watchMonth(); kick();
    },
    destroy() {
      if (!alive) return;
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(monthTimer);
      scene = null;
      canvas.remove();
      canvas.width = canvas.height = 0;
    },
  };
}

/** Draw one still frame of `spec` into a (small) canvas — for the settings thumbnails. */
export function drawBackdropPreview(canvas, spec) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (cw && ch) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
  const W = canvas.width || 120, H = canvas.height || 120;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const scene = build(ctx, W, H, normalize(spec), true);
  paint(ctx, scene, 0);
}
