// Home-screen backdrops inspired by game-console menus (original renderings — no logos or symbols):
//   waves(E, colour, style)  'ps3' (XMB ribbons of thin lines), 'psp' (one glowing band of layered sheets),
//                            'xmb' (the XMB theme: sheets + one ribbon)
//   pspClassic(E, colour)    gradient with gliding diagonal light streaks and twinkles
//   ps2(E)                   dark blue fog with glowing towers of light, the camera slowly orbiting
//   ps4(E)                   blue gradient with bokeh and flowing thin light lines
//   ps5(E, accent)           dark navy with a cool glow, rising light motes and shimmering curved lines
// Same contract as backdrops-themes.js: build(E) → { draw(ctx, t) }.
import { TAU, WHITE, clamp, css, toHsl, fromHsl, layer, softGrad, blob, dotSprite, starSprite, rng } from './backdrops-util.js';

/** Background gradient in the hue of `colour`, normalised in lightness so every month colour reads well. */
function hueBase(E, colour, flat) {
  const { W, H, S } = E;
  const [h, s0] = toHsl(colour), s = clamp(s0 * 1.05, 0, 0.85);
  return layer(W, H, (g) => {
    const gr = g.createLinearGradient(W * 0.35, 0, W * 0.65, H);
    if (E.light) {
      gr.addColorStop(0, css(fromHsl(h, s * 0.55, 0.93))); gr.addColorStop(0.55, css(fromHsl(h, s * 0.6, 0.875))); gr.addColorStop(1, css(fromHsl(h, s * 0.55, 0.81)));
    } else if (E.oled) {
      gr.addColorStop(0, '#000'); gr.addColorStop(0.55, '#000'); gr.addColorStop(1, css(fromHsl(h, s, 0.06)));
    } else if (flat) {
      gr.addColorStop(0, css(fromHsl(h, s * 0.85, 0.36))); gr.addColorStop(1, css(fromHsl(h, s * 0.9, 0.2)));
    } else {
      gr.addColorStop(0, css(fromHsl(h, s * 0.85, 0.4))); gr.addColorStop(0.5, css(fromHsl(h, s * 0.9, 0.26))); gr.addColorStop(1, css(fromHsl(h, s, 0.13)));
    }
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (!E.oled) blob(g, softGrad(g, WHITE, E.light ? 0.45 : 0.1, 2.2), W * 0.3, H * 0.18, S * 0.75, S * 0.5);
  });
}
/** Ink for the wave elements: white on dark, deeper hue on light, the colour itself on OLED. */
function waveInk(E, colour) {
  const [h, s] = toHsl(colour);
  if (E.light) return { line: fromHsl(h, clamp(s, 0.25, 0.7), 0.42), sheet: fromHsl(h, clamp(s, 0.2, 0.6), 0.6), k: 1.15, spark: fromHsl(h, s, 0.5) };
  if (E.oled) return { line: fromHsl(h, clamp(s, 0.35, 0.85), 0.62), sheet: fromHsl(h, clamp(s, 0.35, 0.85), 0.5), k: 1.3, spark: fromHsl(h, s, 0.75) };
  return { line: WHITE, sheet: WHITE, k: 1, spark: WHITE };
}

export function waves(E, colour, style) {
  const { W, H, S, px, ctx, few } = E;
  const base = hueBase(E, colour, style === 'psp');
  const ink = waveInk(E, colour);
  const N = few ? 26 : 40;                                  // samples along x
  const xs = new Float32Array(N), y0 = new Float32Array(N), tw = new Float32Array(N), y1 = new Float32Array(N);
  for (let i = 0; i < N; i++) xs[i] = (-0.06 + (1.12 * i) / (N - 1)) * W;

  // ribbons of thin lines (PS3 / XMB)
  const ribbons = style === 'psp' ? [] : style === 'xmb'
    ? [{ yc: 0.700, A: 0.06, f: 0.8, w: 0.33, f2: 1.7, w2: -0.21, A2: 0.025, sp: 0.075, f3: 0.6, w3: 0.17, n: few ? 6 : 10, a: 0.2, ph: 1 }]
    : [
      { yc: 0.660, A: 0.075, f: 0.75, w: 0.3, f2: 1.6, w2: -0.19, A2: 0.03, sp: 0.13, f3: 0.55, w3: 0.13, n: few ? 8 : 14, a: 0.24, ph: 0 },
      { yc: 0.700, A: 0.05, f: 1.05, w: -0.23, f2: 0.5, w2: 0.15, A2: 0.035, sp: 0.085, f3: 0.8, w3: -0.11, n: few ? 6 : 10, a: 0.15, ph: 2.3 },
    ];
  for (const r of ribbons) {
    r.styles = [];
    for (let i = 0; i < r.n; i++) {
      const m = 1 - Math.abs((i / (r.n - 1)) * 2 - 1);
      r.styles.push(css(ink.line, clamp((0.3 + 0.7 * m) * r.a * 1.3 * ink.k, 0, 1)));
    }
    r.fill = css(ink.sheet, 0.05 * ink.k);
  }
  // translucent sheets (PSP / XMB)
  const sheets = style === 'ps3' ? [] : (style === 'xmb'
    ? [{ yc: 0.650, A: 0.06, f: 0.7, w: 0.26, th: 0.07, a: 0.09, ph: 0.4 }, { yc: 0.670, A: 0.05, f: 0.9, w: -0.2, th: 0.05, a: 0.08, ph: 2.1 }, { yc: 0.680, A: 0.07, f: 0.55, w: 0.16, th: 0.1, a: 0.06, ph: 4 }]
    : [
      { yc: 0.660, A: 0.055, f: 0.7, w: 0.28, th: 0.085, a: 0.1, ph: 0.2, edge: 0.55 },
      { yc: 0.670, A: 0.065, f: 0.85, w: -0.22, th: 0.06, a: 0.08, ph: 1.9 },
      { yc: 0.665, A: 0.05, f: 0.6, w: 0.18, th: 0.11, a: 0.07, ph: 3.3, edge: 0.3 },
      { yc: 0.675, A: 0.07, f: 1.0, w: -0.15, th: 0.045, a: 0.09, ph: 4.6 },
      { yc: 0.655, A: 0.045, f: 0.5, w: 0.12, th: 0.13, a: 0.05, ph: 5.5 },
    ]).slice(0, few ? 3 : 5);
  for (const s of sheets) {
    s.style = css(ink.sheet, s.a * ink.k * (E.light ? 1.4 : 1));
    if (s.edge) { s.edgeStyle = css(ink.line, s.edge * ink.k); s.glow = css(ink.line, 0.07 * ink.k); }
  }
  // sparkles
  const R = rng(7), spr = starSprite(18 * px, ink.spark);
  const sparks = Array.from({ length: style === 'psp' ? 0 : few ? 8 : 16 }, () => ({
    x: R() * W, y: (0.35 + R() * 0.45) * H, s: 0.5 + R() * 0.7, w: 0.6 + R() * 1.4, ph: R() * TAU, dx: (R() - 0.5) * 6 * px,
  }));
  const sparkA = E.light ? 0.5 : 0.75;

  const curve = (c, ys) => {
    c.moveTo(xs[0], ys[0]);
    for (let i = 1; i < N - 1; i++) c.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
    c.lineTo(xs[N - 1], ys[N - 1]);
  };
  const curveBack = (c, ys) => {
    c.lineTo(xs[N - 1], ys[N - 1]);
    for (let i = N - 2; i > 0; i--) c.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i - 1]) / 2, (ys[i] + ys[i - 1]) / 2);
    c.lineTo(xs[0], ys[0]);
  };
  const hl = Math.max(1, px);

  return {
    draw(c, t) {
      c.drawImage(base, 0, 0);
      // sheets
      for (const s of sheets) {
        for (let i = 0; i < N; i++) {
          const u = xs[i] / W;
          const yy = s.yc * H + S * (s.A * Math.sin(TAU * s.f * u + t * s.w + s.ph) + 0.022 * Math.sin(TAU * 1.9 * u - t * s.w * 0.7 + s.ph * 2));
          y0[i] = yy;
          y1[i] = yy + S * s.th * (0.65 + 0.35 * Math.sin(TAU * 0.6 * u + t * 0.17 + s.ph));
        }
        c.fillStyle = s.style;
        c.beginPath(); curve(c, y0); curveBack(c, y1); c.closePath(); c.fill();
        if (s.edgeStyle) {
          c.strokeStyle = s.glow; c.lineWidth = 6 * px;
          c.beginPath(); curve(c, y0); c.stroke();
          c.strokeStyle = s.edgeStyle; c.lineWidth = 1.4 * hl;
          c.beginPath(); curve(c, y0); c.stroke();
        }
      }
      // ribbons
      for (const r of ribbons) {
        for (let i = 0; i < N; i++) {
          const u = xs[i] / W;
          y0[i] = r.yc * H + S * (r.A * Math.sin(TAU * r.f * u + t * r.w + r.ph) + r.A2 * Math.sin(TAU * r.f2 * u + t * r.w2 + r.ph * 1.7));
          tw[i] = S * r.sp * Math.sin(TAU * r.f3 * u + t * r.w3 + r.ph * 0.6);
        }
        // a faint sheet between the outer lines
        for (let i = 0; i < N; i++) y1[i] = y0[i] + tw[i] * 0.5;
        c.fillStyle = r.fill;
        c.beginPath(); curve(c, y1);
        for (let i = 0; i < N; i++) y1[i] = y0[i] - tw[i] * 0.5;
        curveBack(c, y1); c.closePath(); c.fill();
        c.lineWidth = hl;
        for (let l = 0; l < r.n; l++) {
          const k = l / (r.n - 1) - 0.5;
          for (let i = 0; i < N; i++) y1[i] = y0[i] + tw[i] * k + k * k * S * 0.012 * Math.sin(xs[i] / W * 9 + t * 0.4 + l);
          c.strokeStyle = r.styles[l];
          c.beginPath(); curve(c, y1); c.stroke();
        }
      }
      // sparkles
      for (const p of sparks) {
        const a = Math.pow(0.5 + 0.5 * Math.sin(t * p.w + p.ph), 6);
        if (a < 0.02) continue;
        const d = spr.width * p.s;
        c.globalAlpha = a * sparkA;
        c.drawImage(spr, p.x + Math.sin(t * 0.1 + p.ph) * p.dx - d / 2, p.y - d / 2, d, d);
      }
      c.globalAlpha = 1;
    },
  };
}

// PSP classic: the month gradient with soft diagonal light bars gliding across, and tiny twinkles.
// When animated, the gradient and the (soft) bars are drawn small and scaled up; twinkles stay sharp.
export function pspClassic(E, colour) {
  const { W, H, S, px, few } = E;
  const k = E.animated ? Math.min(1, 240 / S) : 1;
  const lw = Math.round(W * k), lh = Math.round(H * k), ls = Math.min(lw, lh);
  const low = k < 1 ? layer(lw, lh) : null, lg = low ? low.getContext('2d') : null;
  const base = hueBase({ ...E, W: lw, H: lh, S: ls }, colour, true);
  const ink = waveInk(E, colour);
  const gctx = lg || E.ctx;
  const bar = (a, plateau) => {
    const g = gctx.createLinearGradient(-1, 0, 1, 0);
    g.addColorStop(0, css(ink.sheet, 0));
    if (plateau) { g.addColorStop(0.3, css(ink.sheet, a)); g.addColorStop(0.7, css(ink.sheet, a)); } else g.addColorStop(0.5, css(ink.sheet, a));
    g.addColorStop(1, css(ink.sheet, 0));
    return g;
  };
  const kk = ink.k * (E.light ? 2.4 : 1);
  const softBar = bar(0.11 * kk, false), hardBar = bar(0.065 * kk, true), thin = bar(0.15 * kk, false);
  const ang = -0.62, nx = Math.cos(ang), ny = Math.sin(ang), span = 0.8;
  const R = rng(11);
  const nb = few ? 4 : 6;
  const bars = Array.from({ length: nb }, (_, i) => ({
    p: -span + (2 * span * (i + R() * 0.6)) / nb, w: i === 2 ? 0.012 : 0.06 + R() * 0.14, v: (0.008 + R() * 0.014) * (i % 2 ? 1 : 0.7),
    g: i === 2 ? thin : i % 2 ? hardBar : softBar,
  }));
  const spr = starSprite(16 * px, ink.spark);
  const tw = Array.from({ length: few ? 12 : 24 }, () => ({ x: R() * W, y: R() * H, s: 0.4 + R() * 0.8, w: 0.5 + R() * 1.5, ph: R() * TAU }));
  return {
    draw(c, t) {
      const g = lg || c;
      g.drawImage(base, 0, 0);
      for (const b of bars) {
        let p = b.p + t * b.v;
        p = ((p + span) % (2 * span) + 2 * span) % (2 * span) - span;
        blob(g, b.g, lw / 2 + nx * p * ls, lh / 2 + ny * p * ls, b.w * ls, ls * 1.3, ang);
      }
      if (low) c.drawImage(low, 0, 0, W, H);
      for (const p of tw) {
        const a = Math.pow(0.5 + 0.5 * Math.sin(t * p.w + p.ph), 5);
        if (a < 0.02) continue;
        const d = spr.width * p.s;
        c.globalAlpha = a * (E.light ? 0.55 : 0.8);
        c.drawImage(spr, p.x - d / 2, p.y - d / 2, d, d);
      }
      c.globalAlpha = 1;
    },
  };
}

// PS2-inspired: deep blue fog, translucent towers of light, drifting motes, the camera slowly orbiting
export function ps2(E) {
  const { W, H, S, cx, px, ctx, few } = E;
  const hy = H * 0.42;
  const base = layer(W, H, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    if (E.light) { gr.addColorStop(0, '#eef2f9'); gr.addColorStop(0.42, '#d5e0f2'); gr.addColorStop(1, '#eaf0f8'); }
    else if (E.oled) { gr.addColorStop(0, '#000'); gr.addColorStop(0.42, '#02060f'); gr.addColorStop(1, '#000'); }
    else { gr.addColorStop(0, '#01030a'); gr.addColorStop(0.34, '#061331'); gr.addColorStop(0.44, '#0b1f4e'); gr.addColorStop(0.62, '#061232'); gr.addColorStop(1, '#02040b'); }
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    blob(g, softGrad(g, E.light ? [120, 160, 230] : [40, 100, 240], E.light ? 0.25 : E.oled ? 0.14 : 0.32, 2.2), cx, hy, S * 0.95, S * 0.22);
  });
  const haze = layer(W, H, (g) => {
    blob(g, softGrad(g, E.light ? [240, 245, 252] : [25, 60, 150], E.light ? 0.7 : E.oled ? 0.1 : 0.22, 2), cx, hy + S * 0.02, S * 0.9, S * 0.09);
  });
  const col = E.light ? [60, 110, 205] : [130, 185, 255];
  const tg = ctx.createLinearGradient(0, 0, 0, 1);
  tg.addColorStop(0, css(col, 0.9)); tg.addColorStop(0.025, css(col, 0.42)); tg.addColorStop(0.2, css(col, 0.22)); tg.addColorStop(0.75, css(col, 0.1)); tg.addColorStop(1, css(col, 0.03));
  const eg = ctx.createLinearGradient(0, 0, 0, 1);
  eg.addColorStop(0, css(col, 1)); eg.addColorStop(0.4, css(col, 0.45)); eg.addColorStop(1, css(col, 0));
  const rg = ctx.createLinearGradient(0, 0, 0, 1);
  rg.addColorStop(0, css(col, 0.1)); rg.addColorStop(1, css(col, 0));
  const cap = dotSprite(48 * px, E.light ? [90, 140, 230] : [190, 220, 255], { hard: 0.12 });
  const mote = dotSprite(10 * px, E.light ? [70, 120, 210] : [170, 210, 255], { hard: 0.3 });
  const R = rng(3);
  const towers = [];
  for (let gx = -6; gx <= 6; gx++) for (let gz = -6; gz <= 6; gz++) {
    const d = Math.hypot(gx, gz);
    if (d > 6.2 || d < 1.4 || R() > 0.36) continue;
    towers.push({ x: gx * 1.05 + (R() - 0.5) * 0.3, z: gz * 1.05 + (R() - 0.5) * 0.3, h: 0.4 + 3.4 * Math.pow(R(), 1.8), w: 0.2 + R() * 0.14, r: R() * TAU, pw: 3 + R() * 5, ph: R() * TAU });
  }
  if (few) towers.length = Math.min(towers.length, 20);
  const motes = Array.from({ length: few ? 16 : 34 }, () => ({ x: R(), y: R(), v: 0.004 + R() * 0.012, s: 0.4 + R() * 0.9, ph: R() * TAU, k: 0.3 + R() * 0.7 }));
  const D = 9, camH = 1.6, f = S * 0.9, ta = E.light ? 0.55 : E.oled ? 0.75 : 0.85, ew = Math.max(1, px);
  return {
    draw(c, t) {
      c.drawImage(base, 0, 0);
      const th = (t * TAU) / 150 + 0.5, cs = Math.cos(th), sn = Math.sin(th);
      if (!E.light) c.globalCompositeOperation = 'lighter';
      for (const o of towers) {
        const xr = o.x * cs - o.z * sn, zr = o.x * sn + o.z * cs + D;
        const fade = clamp((16.5 - zr) / 9, 0, 1) * clamp((zr - 4.6) / 3, 0, 1);
        if (fade < 0.02) continue;
        const sx = cx + (f * xr) / zr, yb = hy + (f * camH) / zr, yt = hy + (f * (camH - o.h)) / zr, w = (f * o.w) / zr, th2 = yb - yt;
        if (sx < -w || sx > W + w) continue;
        const pulse = 0.7 + 0.3 * Math.sin((t * TAU) / o.pw + o.ph), a = fade * pulse * ta;
        // a square pillar: two visible faces whose widths change as the camera turns
        const fa = th + o.r, wa = w * Math.abs(Math.cos(fa)), wb = w * Math.abs(Math.sin(fa)), x0 = sx - (wa + wb) / 2;
        c.globalAlpha = a;
        c.setTransform(wa, 0, 0, th2, x0, yt); c.fillStyle = tg; c.fillRect(0, 0, 1, 1);
        c.setTransform(ew, 0, 0, th2, x0 + wa, yt); c.fillStyle = eg; c.fillRect(0, 0, 1, 1);
        c.globalAlpha = a * 0.55;
        c.setTransform(wb, 0, 0, th2, x0 + wa, yt); c.fillStyle = tg; c.fillRect(0, 0, 1, 1);
        c.globalAlpha = a * 0.7;
        c.setTransform(wa + wb, 0, 0, th2 * 0.3, x0, yb); c.fillStyle = rg; c.fillRect(0, 0, 1, 1);
        c.setTransform(1, 0, 0, 1, 0, 0);
        if (o.h > 1) {
          const d = w * 3;
          c.globalAlpha = a * 0.5;
          c.drawImage(cap, sx - d / 2, yt - d / 2, d, d);
        }
      }
      for (const m of motes) {
        const x = ((m.x + t * 0.004 * (1 + m.k) + 1) % 1.1) * W - W * 0.05;
        const y = ((m.y - t * m.v + 10) % 1) * H;
        c.globalAlpha = (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.3 * m.k + m.ph))) * (E.light ? 0.6 : 0.8);
        const d = mote.width * m.s;
        c.drawImage(mote, x - d / 2, y - d / 2, d, d);
      }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      c.drawImage(haze, 0, 0);
    },
  };
}

// PS4-inspired: blue gradient, soft bokeh discs drifting and a bundle of thin light lines flowing
export function ps4(E) {
  const { W, H, S, px, ctx, few } = E;
  const base = layer(W, H, (g) => {
    const gr = g.createLinearGradient(0, H, W, 0);
    if (E.light) { gr.addColorStop(0, '#cfe0fb'); gr.addColorStop(0.55, '#e4eeff'); gr.addColorStop(1, '#f5f9ff'); }
    else if (E.oled) { gr.addColorStop(0, '#04122e'); gr.addColorStop(0.45, '#000'); gr.addColorStop(1, '#000'); }
    else { gr.addColorStop(0, '#051230'); gr.addColorStop(0.5, '#0b2f7c'); gr.addColorStop(1, '#1462d6'); }
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (!E.oled) blob(g, softGrad(g, WHITE, E.light ? 0.5 : 0.12, 2), W * 0.78, H * 0.2, S * 0.55);
  });
  const bc = E.light ? [255, 255, 255] : E.oled ? [60, 120, 255] : [170, 210, 255];
  const bok = dotSprite(160 * px, bc, { hard: 0.82, rim: 0.95 });
  const R = rng(5);
  const bokeh = Array.from({ length: few ? 9 : 17 }, () => ({
    x: R(), y: R(), r: 0.025 + Math.pow(R(), 2) * 0.09, a: (0.06 + R() * 0.12) * (E.light ? 2.6 : E.oled ? 0.9 : 1), v: 0.003 + R() * 0.008, ph: R() * TAU,
  }));
  const lc = E.light ? [40, 100, 220] : E.oled ? [80, 150, 255] : WHITE;
  const lines = Array.from({ length: few ? 4 : 7 }, (_, i) => ({ i, style: css(lc, (i === 2 ? 0.42 : 0.2 + R() * 0.12) * (E.light ? 1 : 1)), glow: i === 2 || i === 4 }));
  const glowStyle = css(lc, E.light ? 0.06 : 0.05);
  const path = (c, l, t) => {
    const k = l.i, o = k * S * 0.016;
    const y0 = H * 0.72 + o, y3 = H * 0.48 + o * 1.6;
    const c1y = H * 0.5 + S * 0.12 * Math.sin(t * 0.21 + k * 0.35), c2y = H * 0.72 + S * 0.1 * Math.cos(t * 0.17 + k * 0.28);
    c.beginPath(); c.moveTo(-W * 0.05, y0); c.bezierCurveTo(W * 0.33, c1y + o, W * 0.66, c2y + o, W * 1.05, y3);
  };
  return {
    draw(c, t) {
      c.drawImage(base, 0, 0);
      if (!E.light) c.globalCompositeOperation = 'lighter';
      for (const b of bokeh) {
        const x = (((b.x + t * b.v) % 1.2) + 1.2) % 1.2 * W - W * 0.1, y = (b.y + 0.02 * Math.sin(t * 0.3 + b.ph)) * H;
        const d = b.r * S * 2;
        c.globalAlpha = b.a * (0.75 + 0.25 * Math.sin(t * 0.5 + b.ph));
        c.drawImage(bok, x - d / 2, y - d / 2, d, d);
      }
      c.globalAlpha = 1;
      for (const l of lines) {
        if (l.glow) { path(c, l, t); c.strokeStyle = glowStyle; c.lineWidth = 7 * px; c.stroke(); }
        path(c, l, t); c.strokeStyle = l.style; c.lineWidth = Math.max(1, 1.2 * px); c.stroke();
      }
      c.globalCompositeOperation = 'source-over';
    },
  };
}

// PS5-inspired: very dark navy with a cool glow, faint light motes rising and long curved lines shimmering
export function ps5(E, accent = [70, 140, 255]) {
  const { W, H, S, cx, px, few } = E;
  const [h] = toHsl(accent);
  const base = layer(W, H, (g) => {
    const gr = g.createRadialGradient(W * 0.55, H * 0.22, 0, W * 0.5, H * 0.3, S * 0.95);
    if (E.light) { gr.addColorStop(0, '#f7f9fd'); gr.addColorStop(1, css(fromHsl(h, 0.35, 0.89))); }
    else if (E.oled) { gr.addColorStop(0, css(fromHsl(h, 0.6, 0.06))); gr.addColorStop(0.6, '#000'); gr.addColorStop(1, '#000'); }
    else { gr.addColorStop(0, css(fromHsl(h, 0.6, 0.17))); gr.addColorStop(0.55, css(fromHsl(h, 0.65, 0.07))); gr.addColorStop(1, '#020309'); }
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    blob(g, softGrad(g, accent, E.light ? 0.2 : E.oled ? 0.13 : 0.32, 2.2), W * 0.72, H * 0.16, S * 0.6, S * 0.42);
    blob(g, softGrad(g, accent, E.light ? 0.1 : E.oled ? 0.05 : 0.12, 2.2), W * 0.18, H * 0.92, S * 0.5, S * 0.3);
  });
  const lc = E.light ? fromHsl(h, 0.6, 0.45) : fromHsl(h, 0.8, 0.82);
  const arcs = Array.from({ length: few ? 3 : 4 }, (_, i) => ({
    x: cx + (i - 1.5) * S * 0.12, y: H * 1.55 + i * S * 0.02, r: S * (1.12 + i * 0.075), a: 0.09 - i * 0.012,
    dash: [S * (0.22 + i * 0.05), S * (1.5 + i * 0.3)], v: S * (0.05 + i * 0.012) * (i % 2 ? -1 : 1), ph: i * 1.7,
  }));
  for (const a of arcs) { a.style = css(lc, a.a * (E.light ? 1.6 : 1)); a.hi = css(lc, E.light ? 0.45 : 0.4); }
  const mote = dotSprite(12 * px, E.light ? fromHsl(h, 0.6, 0.55) : fromHsl(h, 0.5, 0.88), { hard: 0.3 });
  const R = rng(9);
  const motes = Array.from({ length: E.oled ? (few ? 12 : 22) : few ? 20 : 42 }, () => ({
    x: R(), y: R(), v: 0.006 + R() * 0.018, s: 0.3 + R() * 0.8, a: 0.2 + R() * 0.6, ph: R() * TAU, sw: 0.004 + R() * 0.01,
  }));
  const empty = [];
  return {
    draw(c, t) {
      c.drawImage(base, 0, 0);
      c.lineWidth = Math.max(1, px);
      for (const a of arcs) {
        c.strokeStyle = a.style;
        c.beginPath(); c.arc(a.x, a.y, a.r, Math.PI * 1.22, Math.PI * 1.78); c.stroke();
        c.globalAlpha = 0.55 + 0.45 * Math.sin(t * 0.6 + a.ph);
        c.setLineDash(a.dash); c.lineDashOffset = -t * a.v;
        c.strokeStyle = a.hi; c.lineWidth = Math.max(1, 1.4 * px);
        c.beginPath(); c.arc(a.x, a.y, a.r, Math.PI * 1.22, Math.PI * 1.78); c.stroke();
        c.setLineDash(empty); c.globalAlpha = 1; c.lineWidth = Math.max(1, px);
      }
      if (!E.light) c.globalCompositeOperation = 'lighter';
      for (const m of motes) {
        let y = (m.y - t * m.v) % 1; if (y < 0) y += 1;
        const x = (m.x + Math.sin(t * 0.4 + m.ph) * m.sw) * W;
        const edge = Math.min(1, y * 5, (1 - y) * 5);
        c.globalAlpha = m.a * edge * (0.6 + 0.4 * Math.sin(t * 0.9 + m.ph));
        const d = mote.width * m.s;
        c.drawImage(mote, x - d / 2, y * H - d / 2, d, d);
      }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    },
  };
}
