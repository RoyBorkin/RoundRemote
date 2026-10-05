// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Home-screen backdrops: each theme's own background (used by kind 'theme' in js/ui/backdrops.js).
// Every scene is build(E) → { draw(ctx, t) } where E is the environment from backdrops.js
// ({ W, H, S, cx, cy, px, mode, light, oled, c1, c2, lite, few, ctx }); t is seconds of animation
// time — the still version is simply t = 0. Scenes precompute their static parts once and only
// composite a handful of fills per frame.
import { TAU, WHITE, BLACK, mix, css, tone, layer, softGrad, blob, blurred } from './backdrops-util.js';

const HOPS = [0, 1, 0, -1];
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** Holds still most of the time, then glides to the next step: returns a value in [0, n) that eases between integers. */
function stepper(t, period, n, hold = 0.65, offset = 0) {
  const p = t / period + offset, k = Math.floor(p), f = ease((p - k - hold) / (1 - hold));
  return ((k + f) % n + n) % n;
}

// classic — near-black radial with a soft breathing glow of the main colour and an orbiting second glow
export function classic(E) {
  const { W, H, S, cx, cy, ctx } = E;
  const base = layer(W, H, (g) => {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.72);
    const [a, b] = E.light ? ['#ffffff', '#e6e8ed'] : E.oled ? ['#0a0a0c', '#000000'] : ['#151518', '#050506'];
    gr.addColorStop(0, a); gr.addColorStop(1, b);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  });
  const k = E.light ? 0.24 : E.oled ? 0.2 : 0.3;
  const g1 = softGrad(ctx, E.c1, k), g2 = softGrad(ctx, E.c2, k * (E.oled ? 0.6 : 0.75));
  return {
    draw(c, t) {
      c.drawImage(base, 0, 0);
      const br = 0.5 - 0.5 * Math.cos((t * TAU) / 9);
      c.globalAlpha = 0.7 + 0.3 * br;
      blob(c, g1, cx, cy - S * 0.2, S * (0.52 + 0.05 * br), S * (0.4 + 0.04 * br));
      c.globalAlpha = 1;
      const a = (t * TAU) / 56 + 0.75;
      blob(c, g2, cx + Math.cos(a) * S * 0.3, cy + Math.sin(a) * S * 0.3, S * 0.34);
    },
  };
}

// glass — a few large soft colour blobs (c1, c2 and mixes) drifting behind frosted glass
export function glass(E) {
  const { W, H, S, ctx } = E;
  const bg = E.light ? '#eef0f8' : E.oled ? '#000000' : '#0b0a18';
  let cols = [E.c1, E.c2, mix(E.c1, E.c2, 0.5), tone(E.c1, { hue: -32 })];
  if (E.light) cols = cols.map((c) => mix(c, WHITE, 0.12));
  const a = E.light ? 0.5 : E.oled ? 0.45 : 0.62, rs = E.oled ? 0.72 : 1;
  const grads = cols.map((c) => softGrad(ctx, c, a, 2.6));
  const B = [
    { x: 0.28, y: 0.3, r: 0.46, ax: 0.08, ay: 0.06, p: 37, ph: 0 },
    { x: 0.73, y: 0.72, r: 0.48, ax: 0.07, ay: 0.08, p: 43, ph: 2 },
    { x: 0.75, y: 0.25, r: 0.33, ax: 0.06, ay: 0.07, p: 31, ph: 4 },
    { x: 0.25, y: 0.76, r: 0.35, ax: 0.08, ay: 0.05, p: 53, ph: 1 },
  ];
  // a faint frosted sheen from the top-left
  const sheen = softGrad(ctx, WHITE, E.light ? 0.5 : 0.05);
  return {
    draw(c, t) {
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      if (!E.light) c.globalCompositeOperation = 'screen';
      for (let i = 0; i < B.length; i++) {
        const b = B[i], p = (t * TAU) / b.p + b.ph;
        blob(c, grads[i], (b.x + b.ax * Math.sin(p)) * W, (b.y + b.ay * Math.cos(p * 0.8)) * H,
          b.r * S * rs * (1 + 0.07 * Math.sin(p * 1.3)), b.r * S * rs * (1 + 0.07 * Math.cos(p * 1.1)), p * 0.2);
      }
      c.globalCompositeOperation = 'source-over';
      blob(c, sheen, W * 0.3, H * 0.18, S * 0.55, S * 0.35, -0.5);
    },
  };
}

// soft — neumorphic flat surface with an embossed ring, lit from the top-left (the light slowly moves)
export function soft(E) {
  const { W, H, S, cx, cy, ctx } = E;
  const P = E.light ? { b: '#e0e5ec', hi: '#ffffff', lo: '#a3b1c6', bh: [255, 255, 255], bl: [163, 177, 198], la: 0.55, sa: 0.35 }
    : E.oled ? { b: '#000000', hi: '#202024', lo: '#000000', bh: [40, 40, 46], bl: [0, 0, 0], la: 0.35, sa: 0 }
      : { b: '#2a2d32', hi: '#3b3f46', lo: '#141619', bh: [70, 75, 84], bl: [12, 13, 16], la: 0.4, sa: 0.5 };
  // everything soft (surface light + the ring's blurred highlight/shadow) is drawn into a small canvas
  // when animated and scaled up; the crisp ring face is drawn on top at full resolution
  const k = E.animated ? Math.min(1, 240 / S) : 1;
  const lw = Math.round(W * k), lh = Math.round(H * k), ls = Math.min(lw, lh), lcx = lw / 2, lcy = lh / 2;
  const low = k < 1 ? layer(lw, lh) : null, lg = low ? low.getContext('2d') : null;
  const rr = S * 0.425, rw = S * 0.05;
  const ring = (col) => layer(lw, lh, (g) => { g.strokeStyle = col; g.lineWidth = rw * k; g.beginPath(); g.arc(lcx, lcy, rr * k, 0, TAU); g.stroke(); });
  const hiS = blurred(ring(P.hi), S * 0.02 * k), loS = blurred(ring(P.lo), S * 0.02 * k);
  const gctx = lg || ctx;
  const lightG = softGrad(gctx, P.bh, P.la, 2.2), shadeG = softGrad(gctx, P.bl, P.sa, 2.2);
  const bRgb = E.light ? [224, 229, 236] : E.oled ? [0, 0, 0] : [42, 45, 50];
  const face = ctx.createLinearGradient(-rr, 0, rr, 0);
  face.addColorStop(0, css(mix(bRgb, P.bh, 0.35)));
  face.addColorStop(0.5, css(bRgb));
  face.addColorStop(1, css(mix(bRgb, P.bl, 0.3)));
  const d = ls * 0.013;
  return {
    draw(c, t) {
      const g = lg || c;
      const th = -2.36 + 0.55 * Math.sin((t * TAU) / 40);
      const lx = Math.cos(th), ly = Math.sin(th);
      g.fillStyle = P.b; g.fillRect(0, 0, lw, lh);
      blob(g, lightG, lcx + lx * ls * 0.5, lcy + ly * ls * 0.5, ls * 0.95);
      if (P.sa) blob(g, shadeG, lcx - lx * ls * 0.6, lcy - ly * ls * 0.6, ls * 0.8);
      g.drawImage(loS, -lx * d, -ly * d);
      g.drawImage(hiS, lx * d, ly * d);
      if (low) c.drawImage(low, 0, 0, W, H);
      const a = th + Math.PI;
      c.setTransform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cx, cy);
      c.strokeStyle = face; c.lineWidth = rw;
      c.beginPath(); c.arc(0, 0, rr, 0, TAU); c.stroke();
      c.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
}

// slate — calm vertical gradient with hairline concentric arcs that slowly turn
export function slate(E) {
  const { W, H, S, cx, cy, px } = E;
  const base = layer(W, H, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    const [a, b] = E.light ? ['#f8f9fa', '#eceef2'] : E.oled ? ['#0b0c0f', '#000000'] : ['#2b3038', '#1f232a'];
    gr.addColorStop(0, a); gr.addColorStop(1, b);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (!E.oled) blob(g, softGrad(g, WHITE, E.light ? 0.5 : 0.05, 2.2), cx, H * 0.08, S * 0.7, S * 0.4);
  });
  const ink = E.light ? [32, 36, 44] : [236, 238, 242];
  const k = E.light ? 1.5 : E.oled ? 1.1 : 1.35;
  const A = [
    { r: 0.475, a0: 0, span: TAU, a: 0.05, sp: 0 },
    { r: 0.445, a0: -2.3, span: 2.3, a: 0.13, sp: 1 / 150 },
    { r: 0.445, a0: 1.4, span: 0.4, a: 0.5, sp: 1 / 150, col: E.c2, w: 1.6 },
    { r: 0.405, a0: 0.7, span: 1.5, a: 0.1, sp: -1 / 115 },
    { r: 0.405, a0: 3.5, span: 0.9, a: 0.1, sp: -1 / 115 },
    { r: 0.368, a0: 2.1, span: 0.75, a: 0.6, sp: 1 / 95, col: E.c1, w: 1.8, dot: true },
    { r: 0.335, a0: -0.7, span: 1.9, a: 0.07, sp: 1 / 210 },
  ].map((o) => ({ ...o, style: css(o.col || ink, Math.min(1, o.a * (o.col ? 1 : k))), w: (o.w || 1) * Math.max(1, px) }));
  return {
    draw(c, t) {
      c.drawImage(base, 0, 0);
      for (const o of A) {
        const a = o.a0 + t * TAU * o.sp;
        c.strokeStyle = o.style; c.lineWidth = o.w;
        c.beginPath(); c.arc(cx, cy, o.r * S, a, a + o.span); c.stroke();
        if (o.dot) {
          c.fillStyle = o.style;
          c.beginPath(); c.arc(cx + Math.cos(a + o.span) * o.r * S, cy + Math.sin(a + o.span) * o.r * S, 3.2 * px, 0, TAU); c.fill();
        }
      }
    },
  };
}

// vivid — bold c1 glow from the top with a c2 tint; animated: a slowly turning conic wash c1 → c2
export function vivid(E) {
  const { W, H, S, cx, cy, ctx } = E;
  const bg = E.light ? '#f1f2f7' : E.oled ? '#000000' : '#0c0d12';
  const glows = layer(W, H, (g) => {
    const a1 = E.light ? 0.38 : E.oled ? 0.5 : 0.62, a2 = E.light ? 0.26 : E.oled ? 0.3 : 0.34;
    blob(g, softGrad(g, E.c1, a1, 2.2), cx, -S * 0.05, S * (E.oled ? 0.75 : 0.95), S * (E.oled ? 0.55 : 0.72));
    blob(g, softGrad(g, E.c2, a2, 2.6), W * 0.86, H * 0.9, S * (E.oled ? 0.45 : 0.6));
  });
  let cg = null;
  if (ctx.createConicGradient) {
    cg = ctx.createConicGradient(0, 0, 0);
    const m = mix(E.c1, E.c2, 0.5);
    cg.addColorStop(0, css(E.c1)); cg.addColorStop(0.3, css(E.c2)); cg.addColorStop(0.55, css(m));
    cg.addColorStop(0.78, css(E.c2)); cg.addColorStop(1, css(E.c1));
  }
  const ca = E.light ? 0.1 : E.oled ? 0.05 : 0.11, D = S * 0.75;
  return {
    draw(c, t) {
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      if (cg) {
        const a = (t * TAU) / 70 - 1.2, cs = Math.cos(a), sn = Math.sin(a);
        c.globalAlpha = ca;
        c.setTransform(cs, sn, -sn, cs, cx, cy);
        c.fillStyle = cg; c.fillRect(-D, -D, 2 * D, 2 * D);
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
      }
      c.drawImage(glows, 0, 0);
    },
  };
}

// bauhaus — flat cream (or near-black) with a big two-tone circle resting on a thin line, a small
// circle on a thin ring and a black half-disc; animated: the circle rolls, the dot hops, the half-disc turns
export function bauhaus(E) {
  const { W, H, S, px } = E;
  const bg = E.light ? '#ebe5d9' : E.oled ? '#000000' : '#161514';
  const ink = E.light ? '#141414' : css([239, 233, 223], 0.85);
  const halfInk = E.light ? '#141414' : '#efe9df';
  const c1 = css(E.c1), c1d = css(tone(E.c1, { lMul: 0.78 })), c2 = css(E.c2);
  const R = S * 0.12, r = S * 0.05, lw = Math.max(1, 1.6 * px);
  // tangent line x + y = 1.41 (in 0..1 units) under the big circle at (.79,.79)
  const T = 1.41, dir = [Math.SQRT1_2, -Math.SQRT1_2];
  const ring = { x: 0.3 * W, y: 0.29 * H, r: S * 0.127 }, ring0 = Math.atan2(0.2 * H - ring.y, 0.21 * W - ring.x);
  return {
    draw(c, t) {
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      // thin line
      c.strokeStyle = ink; c.lineWidth = lw;
      c.beginPath(); c.moveTo(0.47 * W, (T - 0.47) * H); c.lineTo(0.94 * W, (T - 0.94) * H); c.stroke();
      // ring + dot that hops around it
      c.beginPath(); c.arc(ring.x, ring.y, ring.r, 0, TAU); c.stroke();
      const v = stepper(t, 7, 4, 0.7), k = Math.floor(v), f = v - k;
      const ra = ring0 + (HOPS[k] + (HOPS[(k + 1) % 4] - HOPS[k]) * f) * (Math.PI / 2);
      c.fillStyle = c2;
      c.beginPath(); c.arc(ring.x + Math.cos(ra) * ring.r, ring.y + Math.sin(ra) * ring.r, r, 0, TAU); c.fill();
      // black half-disc turning in quarter steps
      const ha = -Math.PI / 4 + (stepper(t, 9, 4, 0.72, 0.4) * Math.PI) / 2;
      c.fillStyle = halfInk;
      c.beginPath(); c.arc(0.2 * W, 0.64 * H, S * 0.06, ha, ha + Math.PI); c.closePath(); c.fill();
      // big two-tone circle rolling along the line
      const s = Math.sin((t * TAU) / 26) * S * 0.07;
      const x = 0.79 * W + dir[0] * s, y = 0.79 * H + dir[1] * s, rot = s / R + Math.PI / 4;
      c.fillStyle = c1; c.beginPath(); c.arc(x, y, R, 0, TAU); c.fill();
      c.fillStyle = c1d; c.beginPath(); c.arc(x, y, R, rot, rot + Math.PI); c.closePath(); c.fill();
    },
  };
}

// amusic — Apple Music-like blurred artwork: big soft blobs from c1 / c2 slowly morphing
export function amusic(E) {
  const { W, H, S, cx, cy, ctx } = E;
  const bg = E.light ? '#ffffff' : '#000000';
  let cols = [E.c1, tone(E.c1, { hue: -26 }), E.c2, mix(E.c1, E.c2, 0.5), tone(E.c1, { hue: 24, lMul: 1.15 })];
  if (E.light) cols = cols.map((c) => mix(c, WHITE, 0.1));
  const a = E.light ? 0.55 : E.oled ? 0.7 : 0.92, rs = E.oled ? 0.8 : 1;
  const grads = cols.map((c) => softGrad(ctx, c, a, 2.2));
  const B = [
    { x: 0.24, y: 0.26, r: 0.55, p: 29, ph: 0 }, { x: 0.8, y: 0.3, r: 0.5, p: 37, ph: 1.5 },
    { x: 0.72, y: 0.8, r: 0.56, p: 41, ph: 3 }, { x: 0.2, y: 0.76, r: 0.5, p: 33, ph: 4.4 },
    { x: 0.52, y: 0.5, r: 0.36, p: 47, ph: 2.2 },
  ];
  const veil = layer(W, H, (g) => {
    g.fillStyle = E.light ? 'rgba(255,255,255,.2)' : E.oled ? 'rgba(0,0,0,.3)' : 'rgba(0,0,0,.1)';
    g.fillRect(0, 0, W, H);
    blob(g, softGrad(g, E.light ? WHITE : BLACK, E.light ? 0.35 : 0.4, 2), cx, cy, S * 0.45);
  });
  return {
    draw(c, t) {
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      if (!E.light) c.globalCompositeOperation = 'screen';
      for (let i = 0; i < B.length; i++) {
        const b = B[i], p = (t * TAU) / b.p + b.ph;
        blob(c, grads[i], (b.x + 0.1 * Math.sin(p)) * W, (b.y + 0.08 * Math.cos(p * 0.7)) * H,
          b.r * S * rs * (1 + 0.14 * Math.sin(p * 1.4)), b.r * S * rs * (0.8 + 0.12 * Math.cos(p * 1.2)), p * 0.35);
      }
      c.globalCompositeOperation = 'source-over';
      c.drawImage(veil, 0, 0);
    },
  };
}

// spot — #121212 with a c1 tint fading down from the top like a playlist header (it breathes, hue drifts)
export function spot(E) {
  const { W, H, S, cx, ctx } = E;
  const bg = E.light ? '#f6f6f6' : E.oled ? '#000000' : '#121212';
  const a = E.light ? 0.4 : E.oled ? 0.36 : 0.6;
  const tint = (col) => {
    const g = ctx.createLinearGradient(0, 0, 0, H * (E.oled ? 0.55 : 0.68));
    g.addColorStop(0, css(col, a)); g.addColorStop(0.4, css(col, a * 0.45)); g.addColorStop(0.75, css(col, a * 0.12)); g.addColorStop(1, css(col, 0));
    return g;
  };
  const tA = tint(E.c1), tB = tint(tone(E.c1, { hue: 18 }));
  const top = softGrad(ctx, E.c1, E.light ? 0.25 : 0.3, 2.4);
  return {
    draw(c, t) {
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      const br = 0.5 - 0.5 * Math.cos((t * TAU) / 11), hm = 0.5 - 0.5 * Math.cos((t * TAU) / 37);
      c.globalAlpha = 0.82 + 0.18 * br;
      c.fillStyle = tA; c.fillRect(0, 0, W, H);
      c.globalAlpha = hm * 0.8;
      c.fillStyle = tB; c.fillRect(0, 0, W, H);
      c.globalAlpha = 0.7 + 0.3 * br;
      blob(c, top, cx, -S * 0.05, S * 0.75, S * 0.42);
      c.globalAlpha = 1;
    },
  };
}

// ipod — brushed aluminium (light) / graphite (dark) with a faint click-wheel ring and a slowly sweeping sheen
export function ipod(E) {
  const { W, H, S, cx, cy, ctx, px } = E;
  const P = E.light ? { s: ['#f2f3f5', '#d5d8dc', '#e7e9ec'], grain: 0.09, sheen: 0.55, ring: 0.03, edgeHi: 0.8, edgeLo: 0.12 }
    : E.oled ? { s: ['#0c0c0d', '#000000', '#060606'], grain: 0.035, sheen: 0.045, ring: 0.0, edgeHi: 0.07, edgeLo: 0.0 }
      : { s: ['#3b3d42', '#232427', '#2d2e32'], grain: 0.06, sheen: 0.09, ring: 0.1, edgeHi: 0.1, edgeLo: 0.35 };
  const metal = layer(W, H, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, P.s[0]); gr.addColorStop(0.55, P.s[1]); gr.addColorStop(1, P.s[2]);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // brushing: random rows stretched horizontally → long fine streaks
    const streaks = (nw, amp) => {
      const n = layer(nw, H, (ng) => {
        const id = ng.createImageData(nw, H), d = id.data;
        let s = 1234567;
        for (let i = 0; i < d.length; i += 4) {
          s = (s * 1103515245 + 12345) >>> 0;
          const v = (s >>> 8) / 16777216 - 0.5;
          const c = v > 0 ? 255 : 0;
          d[i] = d[i + 1] = d[i + 2] = c; d[i + 3] = Math.min(255, Math.abs(v) * 2 * amp * 255);
        }
        ng.putImageData(id, 0, 0);
      });
      g.imageSmoothingEnabled = true;
      g.drawImage(n, 0, 0, W, H);
    };
    streaks(5, P.grain);
    streaks(40, P.grain * 0.8);
    // broad static highlight band in the upper third
    blob(g, softGrad(g, WHITE, P.sheen * 0.5, 2), cx, H * 0.3, S * 0.9, S * 0.2);
  });
  // click-wheel echo
  const ringL = layer(W, H, (g) => {
    const ro = S * 0.405, ri = S * 0.17;
    g.fillStyle = css(BLACK, P.ring * (E.light ? 0.6 : 1));
    g.beginPath(); g.arc(cx, cy, ro, 0, TAU); g.arc(cx, cy, ri, 0, TAU, true); g.fill();
    const edge = (rad, flip) => {
      const gr = g.createLinearGradient(0, cy - rad, 0, cy + rad);
      const hi = css(WHITE, P.edgeHi), lo = css(BLACK, P.edgeLo);
      gr.addColorStop(0, flip ? hi : lo); gr.addColorStop(1, flip ? lo : hi);
      g.strokeStyle = gr; g.lineWidth = Math.max(1, 1.2 * px);
      g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.stroke();
    };
    edge(ro, false); edge(ri, true);
  });
  const sheen = ctx.createLinearGradient(-1, 0, 1, 0);
  sheen.addColorStop(0, css(WHITE, 0)); sheen.addColorStop(0.5, css(WHITE, P.sheen)); sheen.addColorStop(1, css(WHITE, 0));
  return {
    draw(c, t) {
      c.drawImage(metal, 0, 0);
      const x = cx + Math.sin((t * TAU) / 18 - 0.45) * S * 0.62;
      blob(c, sheen, x, cy, S * 0.28, S * 1.2, 0.35);
      c.drawImage(ringL, 0, 0);
    },
  };
}
