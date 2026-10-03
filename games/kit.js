// Shared bits for the games: sound effects, drawing helpers in the app's look, small maths.
// Every game gets these through its `g` object (see shell.js) — e.g. g.sfx('pop'), g.draw.bg().
import { store } from '../js/core/store.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
/** Angle difference in -π…π. */
export const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
/** Angle with 0 at 12 o'clock, clockwise (the way the app measures rings) → point. */
export const polar = (cx, cy, a, r) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
export const ease = { out: (t) => 1 - (1 - t) ** 3, inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2), back: (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2 };

/** Colours that match the music & media screens. */
export const THEME = {
  bg: '#050506', fg: '#f5f5f7', muted: 'rgba(255,255,255,.64)', dim: 'rgba(255,255,255,.38)',
  glass: 'rgba(255,255,255,.075)', glass2: 'rgba(255,255,255,.14)', line: 'rgba(255,255,255,.13)',
  danger: '#ff5a6a', ok: '#3ddc84', warn: '#ffc857',
  // a bright, distinct set for game pieces (marbles, discs, tiles…)
  pieces: ['#ff5a6a', '#ffc857', '#3ddc84', '#4d9bff', '#b57bff', '#ff8ad8', '#2ee6d6', '#ff9f43'],
  display: "'Space Grotesk', 'Rubik', 'Inter', system-ui, sans-serif",
  font: "'Inter', 'Rubik', system-ui, sans-serif",
};

// ---------------------------------------------------------------- sound (tiny Web Audio synth, no files)
let ac = null;
function audio() {
  if (store.get('gameSound') === false) return null;
  try { ac ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
function tone(a, { f = 440, f2 = null, d = 0.12, type = 'sine', v = 0.12, at = 0, noise = false }) {
  const t0 = a.currentTime + at;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  g.connect(a.destination);
  let src;
  if (noise) {
    const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * d)), a.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    src = a.createBufferSource(); src.buffer = buf;
    const flt = a.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = f;
    src.connect(flt); flt.connect(g);
  } else {
    src = a.createOscillator(); src.type = type;
    src.frequency.setValueAtTime(f, t0);
    if (f2) src.frequency.exponentialRampToValueAtTime(f2, t0 + d);
    src.connect(g);
  }
  src.start(t0); src.stop(t0 + d + 0.02);
}
const SFX = {
  tap: [{ f: 660, d: 0.05, type: 'triangle', v: 0.08 }],
  click: [{ f: 1200, d: 0.03, type: 'square', v: 0.04 }],
  pop: [{ f: 520, f2: 1200, d: 0.09, type: 'sine', v: 0.14 }],
  hit: [{ f: 300, f2: 180, d: 0.08, type: 'square', v: 0.07 }],
  bounce: [{ f: 420, f2: 620, d: 0.06, type: 'triangle', v: 0.12 }],
  score: [{ f: 880, d: 0.08, type: 'triangle', v: 0.1 }, { f: 1320, d: 0.12, type: 'triangle', v: 0.1, at: 0.07 }],
  coin: [{ f: 988, d: 0.06, type: 'square', v: 0.05 }, { f: 1319, d: 0.14, type: 'square', v: 0.05, at: 0.06 }],
  jump: [{ f: 300, f2: 700, d: 0.14, type: 'sine', v: 0.12 }],
  flap: [{ f: 500, f2: 820, d: 0.07, type: 'triangle', v: 0.09 }],
  laser: [{ f: 1400, f2: 300, d: 0.12, type: 'sawtooth', v: 0.04 }],
  boom: [{ f: 900, d: 0.35, noise: true, v: 0.22 }, { f: 120, f2: 40, d: 0.3, type: 'sine', v: 0.2 }],
  whoosh: [{ f: 2400, d: 0.18, noise: true, v: 0.07 }],
  drop: [{ f: 700, f2: 260, d: 0.1, type: 'sine', v: 0.12 }],
  place: [{ f: 220, d: 0.08, type: 'triangle', v: 0.16 }],
  perfect: [{ f: 784, d: 0.08, type: 'sine', v: 0.11 }, { f: 1175, d: 0.08, type: 'sine', v: 0.11, at: 0.06 }, { f: 1568, d: 0.16, type: 'sine', v: 0.11, at: 0.12 }],
  win: [{ f: 523, d: 0.12, type: 'triangle', v: 0.12 }, { f: 659, d: 0.12, type: 'triangle', v: 0.12, at: 0.11 }, { f: 784, d: 0.12, type: 'triangle', v: 0.12, at: 0.22 }, { f: 1047, d: 0.3, type: 'triangle', v: 0.12, at: 0.33 }],
  over: [{ f: 392, d: 0.16, type: 'triangle', v: 0.12 }, { f: 330, d: 0.16, type: 'triangle', v: 0.12, at: 0.15 }, { f: 262, d: 0.34, type: 'triangle', v: 0.12, at: 0.3 }],
  tick: [{ f: 1800, d: 0.02, type: 'square', v: 0.03 }],
};
/** Play a named effect: tap click pop hit bounce score coin jump flap laser boom whoosh drop place perfect win over tick. */
export function sfx(name, opts) {
  const { pitch = 1, volume = 1 } = opts || {};
  const a = audio();
  const parts = SFX[name];
  if (!a || !parts) return;
  try { for (const p of parts) tone(a, { ...p, f: p.f * pitch, f2: p.f2 ? p.f2 * pitch : null, v: p.v * volume }); } catch {}
}
export function vibrate(ms = 12) { try { navigator.vibrate?.(ms); } catch {} }

// ---------------------------------------------------------------- drawing helpers
/**
 * Drawing helpers bound to a game's canvas. Coordinates are CSS pixels; the round screen is centred at
 * (cx, cy) with radius R. They keep the games in the app's look: dark glass, soft glow, a ring track.
 */
export function makeDraw(g) {
  const d = {
    /** Dark background with a soft glow in the game's colour and the faint ring at the edge. */
    bg({ color = g.color, glow = 0.16, ring = true, fill = THEME.bg, glowAt = [0, 0] } = {}) {
      const { ctx, cx, cy, R, S } = g;
      ctx.fillStyle = fill; ctx.fillRect(0, 0, S, S);
      const gr = ctx.createRadialGradient(cx + glowAt[0] * R, cy + glowAt[1] * R, 0, cx, cy, R * 1.05);
      gr.addColorStop(0, d.alpha(color, glow)); gr.addColorStop(0.65, d.alpha(color, glow * 0.25)); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, S, S);
      if (ring) { ctx.beginPath(); ctx.arc(cx, cy, R * 0.948, 0, TAU); ctx.strokeStyle = THEME.line; ctx.lineWidth = Math.max(1, R * 0.008); ctx.stroke(); }
    },
    /** A colour with alpha: '#ff0' / '#ff8800' / 'rgb()' → rgba. */
    alpha(col, a) {
      if (col.startsWith('#')) {
        let h = col.slice(1); if (h.length === 3) h = [...h].map((x) => x + x).join('');
        const n = parseInt(h, 16);
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
      }
      return col.replace(/rgba?\(([^)]+)\)/, (_, v) => `rgba(${v.split(',').slice(0, 3).join(',')},${a})`);
    },
    /** Lighter (+) or darker (−) version of a #hex colour. */
    shade(col, amt) {
      let h = col.slice(1); if (h.length === 3) h = [...h].map((x) => x + x).join('');
      const n = parseInt(h, 16);
      const f = (v) => clamp(Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)), 0, 255);
      return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
    },
    circle(x, y, r, fill, { glow = 0, stroke = null, lw = 2 } = {}) {
      const { ctx } = g;
      ctx.save();
      if (glow) { ctx.shadowColor = typeof glow === 'string' ? glow : fill; ctx.shadowBlur = typeof glow === 'number' ? glow : g.R * 0.05; }
      ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.shadowBlur = 0; ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
      ctx.restore();
    },
    /** A ball / disc (marbles, bubbles…) in the flat style: one solid colour, no gloss or shadow. */
    ball(x, y, r, col) {
      const { ctx } = g;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); ctx.fill();
    },
    /** Arc along a circle (angles: 0 = top, clockwise), with round caps like the progress ring. */
    arc(cx, cy, r, a0, a1, color, width, { glow = 0, cap = 'round' } = {}) {
      const { ctx } = g;
      ctx.save();
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
      ctx.beginPath(); ctx.arc(cx, cy, r, a0 - Math.PI / 2, a1 - Math.PI / 2);
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = cap; ctx.stroke();
      ctx.restore();
    },
    roundRect(x, y, w, h, r, fill, { stroke = null, lw = 2, glow = 0 } = {}) {
      const { ctx } = g;
      ctx.save();
      if (glow) { ctx.shadowColor = typeof glow === 'string' ? glow : fill; ctx.shadowBlur = typeof glow === 'number' ? glow : g.R * 0.04; }
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.shadowBlur = 0; ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
      ctx.restore();
    },
    /** Text in the app's display font. size in px. */
    text(str, x, y, size, { color = THEME.fg, align = 'center', base = 'middle', weight = 700, font = THEME.display, glow = 0, alpha = 1 } = {}) {
      const { ctx } = g;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
      ctx.fillText(str, x, y);
      ctx.restore();
    },
    /** Clip everything after this to the round screen (call inside save/restore). */
    clipCircle(r = g.R) { const { ctx, cx, cy } = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip(); },
    /** Floating "+10" style text that rises and fades. Call d.floaters() every frame to draw them. */
    float(str, x, y, color = THEME.fg, size = g.R * 0.07) { floaters.push({ str, x, y, color, size, t: 0 }); },
    floaters(dt) {
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i]; f.t += dt;
        if (f.t > 0.9) { floaters.splice(i, 1); continue; }
        d.text(f.str, f.x, f.y - f.t * g.R * 0.12, f.size, { color: f.color, alpha: 1 - f.t / 0.9, glow: 8 });
      }
    },
    /** Particle burst; call d.particles(dt) every frame to draw them. */
    burst(x, y, color, n = 14, speed = g.R * 0.5, size = g.R * 0.012) {
      for (let i = 0; i < n; i++) {
        const a = rand(TAU), s = rand(0.3, 1) * speed;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.8), t: 0, color, size: size * rand(0.6, 1.4) });
      }
    },
    particles(dt, gravity = 0) {
      const { ctx } = g;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.t += dt;
        if (p.t > p.life) { parts.splice(i, 1); continue; }
        p.vy += gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98; p.vy *= 0.98;
        ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    clearFx() { parts.length = 0; floaters.length = 0; },
  };
  const parts = [], floaters = [];
  return d;
}
