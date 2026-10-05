// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games — the dice tray: pre-rendered flat "3D-looking" dice faces + a little 2D physics (throw, bounce off the
// round tray wall, knock into each other, tumble with a squash that reads as rolling, settle).
// One canvas covers the page; the tray is a circle (fractions of the page size). Only redraws while something moves.

export const TYPES = {
  d4: { sides: 4, shape: 'tri', color: '#f59e0b', name: 'd4' },
  d6: { sides: 6, shape: 'sq', color: '#f3eee2', ink: '#18181b', pips: true, name: 'd6' },
  d8: { sides: 8, shape: 'dia', color: '#16a34a', name: 'd8' },
  d10: { sides: 10, shape: 'kite', color: '#2563eb', name: 'd10' },
  d12: { sides: 12, shape: 'pent', color: '#9333ea', name: 'd12' },
  d20: { sides: 20, shape: 'hex', color: '#e11d48', name: 'd20' },
  d10t: { sides: 10, shape: 'kite', color: '#0f766e', name: 'd100', tens: true },   // tens die of a d100: 00…90
  d10u: { sides: 10, shape: 'kite', color: '#14b8a6', name: 'd100', units: true },  // units die of a d100: 0…9
};
export const faceLabel = (type, face) => {
  const T = TYPES[type];
  if (T.tens) return face === 0 ? '00' : String(face);
  return String(face);
};
/** A random face for a body type (d10t → 0,10…90; d10u → 0…9; others 1…n). */
export const randFace = (type) => {
  const T = TYPES[type];
  const r = Math.floor(rnd() * T.sides);
  if (T.tens) return r * 10;
  if (T.units) return r;
  return r + 1;
};
/** Uniform random in [0,1) from the crypto source when available (fair dice!). */
const buf = new Uint32Array(64); let bi = 64;
export function rnd() {
  if (globalThis.crypto?.getRandomValues) {
    if (bi >= 64) { crypto.getRandomValues(buf); bi = 0; }
    return buf[bi++] / 4294967296;
  }
  return Math.random();
}

// ---------------------------------------------------------------- shapes (unit radius ≈ 1)
const poly = (n, r, rot = -Math.PI / 2) => Array.from({ length: n }, (_, i) => [Math.cos(rot + (i * 2 * Math.PI) / n) * r, Math.sin(rot + (i * 2 * Math.PI) / n) * r]);
const SHAPES = {
  tri: { outer: poly(3, 1.16).map(([x, y]) => [x, y + 0.16]), inner: null, facets: 'tri', ty: 0.2, fs: 0.62 },
  sq: { round: true, fs: 0.8 },
  dia: { outer: [[0, -1.1], [0.88, 0], [0, 1.1], [-0.88, 0]], facets: 'dia', ty: -0.05, fs: 0.62 },
  kite: { outer: [[0, -1.08], [1, -0.12], [0, 1.04], [-1, -0.12]], inner: [[0, -0.74], [0.56, -0.12], [0, 0.62], [-0.56, -0.12]], ty: -0.04, fs: 0.56 },
  pent: { outer: poly(5, 1.06), inner: poly(5, 0.62), ty: 0.03, fs: 0.62 },
  hex: { outer: poly(6, 1.06), inner: poly(3, 0.74), facets: 'hex', ty: 0.13, fs: 0.6 },
};
const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };

function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
export function mix(hex, to, t) {
  const a = hexToRgb(hex), b = to === 'w' ? [255, 255, 255] : to === 'k' ? [0, 0, 0] : hexToRgb(to);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}
const isLight = (hex) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 165; };

function pathPoly(g, pts, s) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s))); g.closePath(); }
function pathRound(g, s, k = 0.86, r = 0.24) {
  const a = k * s, rad = r * s;
  g.beginPath(); g.moveTo(-a + rad, -a); g.arcTo(a, -a, a, a, rad); g.arcTo(a, a, -a, a, rad); g.arcTo(-a, a, -a, -a, rad); g.arcTo(-a, -a, a, -a, rad); g.closePath();
}

/** Draw one die face centred at 0,0 with radius s (px). */
export function drawFace(g, type, face, s, { color, ink } = {}) {
  const T = TYPES[type], S = SHAPES[T.shape];
  const col = color || T.color;
  const light = isLight(col);
  const inkC = ink || T.ink || (light ? '#18181b' : '#ffffff');
  const outline = () => (S.round ? pathRound(g, s) : pathPoly(g, S.outer, s));
  // body
  outline();
  const gr = g.createLinearGradient(-s, -s, s, s);
  gr.addColorStop(0, mix(col, 'w', light ? 0.5 : 0.28)); gr.addColorStop(0.5, col); gr.addColorStop(1, mix(col, 'k', light ? 0.22 : 0.3));
  g.fillStyle = gr; g.fill();
  g.lineJoin = 'round';
  g.lineWidth = Math.max(1, s * 0.07); g.strokeStyle = mix(col, 'k', light ? 0.35 : 0.42); g.stroke();
  // facets
  g.save(); outline(); g.clip();
  g.lineWidth = Math.max(1, s * 0.04);
  const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1 * s, y1 * s); g.lineTo(x2 * s, y2 * s); g.stroke(); };
  g.strokeStyle = light ? 'rgba(0,0,0,.14)' : 'rgba(0,0,0,.22)';
  if (S.inner) {
    pathPoly(g, S.inner, s);
    g.fillStyle = light ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.12)'; g.fill(); g.stroke();
    if (S.facets === 'hex') {
      const o = S.outer, t = S.inner;
      line(t[0][0], t[0][1], o[0][0], o[0][1]); line(t[1][0], t[1][1], o[2][0], o[2][1]); line(t[2][0], t[2][1], o[4][0], o[4][1]);
      line(t[0][0], t[0][1], o[1][0], o[1][1]); line(t[1][0], t[1][1], o[1][0], o[1][1]);
      line(t[1][0], t[1][1], o[3][0], o[3][1]); line(t[2][0], t[2][1], o[3][0], o[3][1]);
      line(t[2][0], t[2][1], o[5][0], o[5][1]); line(t[0][0], t[0][1], o[5][0], o[5][1]);
    } else {
      S.outer.forEach(([x, y], i) => line(S.inner[i][0], S.inner[i][1], x, y));
    }
  } else if (S.facets === 'tri') {
    const o = S.outer; const cy = 0.16;
    o.forEach(([x, y]) => line(0, cy, x, y));
  } else if (S.facets === 'dia') {
    line(-0.88, 0, 0.88, 0); line(0, -1.1, 0, 1.1);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.moveTo(0, -1.1 * s); g.lineTo(0.88 * s, 0); g.lineTo(-0.88 * s, 0); g.closePath(); g.fill();
  }
  // gloss
  const gl = g.createRadialGradient(-s * 0.45, -s * 0.55, 0, -s * 0.45, -s * 0.55, s * 1.2);
  gl.addColorStop(0, 'rgba(255,255,255,.38)'); gl.addColorStop(0.45, 'rgba(255,255,255,.06)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  outline(); g.fillStyle = gl; g.fill();
  g.restore();
  // face mark
  if (T.pips && face >= 1 && face <= 6) {
    const d = s * 0.46, pr = s * 0.15;
    for (const [px, py] of PIPS[face]) {
      g.beginPath(); g.arc(px * d, py * d, pr, 0, Math.PI * 2);
      g.fillStyle = face === 1 ? '#dc2626' : inkC; g.fill();
      g.beginPath(); g.arc(px * d - pr * 0.25, py * d - pr * 0.3, pr * 0.35, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.25)'; g.fill();
    }
  } else {
    const label = faceLabel(type, face);
    const fsz = s * S.fs * (label.length >= 3 ? 0.62 : label.length === 2 ? 0.82 : 1);
    g.font = `800 ${fsz}px 'Space Grotesk', 'Inter', sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const ty = (S.ty || 0) * s;
    g.fillStyle = light ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.35)';
    g.fillText(label, s * 0.03, ty + s * 0.05);
    g.fillStyle = inkC;
    g.fillText(label, 0, ty);
    if ((label === '6' || label === '9') && T.sides > 6) {   // the classic underline that tells 6 from 9
      const w = g.measureText(label).width;
      g.fillRect(-w / 2, ty + fsz * 0.42, w, Math.max(1, fsz * 0.08));
    }
  }
}

// ---------------------------------------------------------------- tray
export function createTray(host, { tray = { cx: 0.5, cy: 0.5, r: 0.3 }, onHit, onTap, onSettle } = {}) {
  const cv = document.createElement('canvas');
  cv.className = 'bg-tray-cv';
  host.append(cv);
  const g = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R = 0;
  const cache = new Map();
  const bodies = [];
  let dirty = true, rolling = false, t = 0, arranging = false;

  function resize() {
    const r = host.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const oldR = R, ocx = cx, ocy = cy;
    cx = tray.cx * W; cy = tray.cy * H; R = tray.r * Math.min(W, H);
    if (oldR) for (const b of bodies) { const k = R / oldR; b.x = cx + (b.x - ocx) * k; b.y = cy + (b.y - ocy) * k; b.tx = b.tx != null ? cx + (b.tx - ocx) * k : null; b.ty = b.ty != null ? cy + (b.ty - ocy) * k : null; }
    cache.clear(); dirty = true;
  }
  const ro = new ResizeObserver(resize); ro.observe(host);
  resize();

  function sprite(b) {
    const px = Math.ceil(b.size * dpr * 1.3);
    const key = `${b.type}|${b.face}|${px}|${b.color || ''}`;
    let c = cache.get(key);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = px;
      const x = c.getContext('2d'); x.translate(px / 2, px / 2);
      drawFace(x, b.type, b.face, (b.size * dpr) / 2 * 0.92, { color: b.color, ink: b.ink });
      if (cache.size > 400) cache.clear();
      cache.set(key, c);
    }
    return c;
  }

  /** Replace the dice: specs [{ type, face?, held?, color?, group?, id? }]. Keeps positions of matching ids. */
  function setBodies(specs, size) {
    const old = new Map(bodies.map((b) => [b.id, b]));
    bodies.length = 0;
    for (const s of specs) {
      const o = old.get(s.id);
      bodies.push(Object.assign(o || { x: cx, y: cy, vx: 0, vy: 0, a: 0, va: 0, z: 0, vz: 0, phi: 0, sq: 1, settled: true }, s, { size: size || s.size || R * 0.36 }));
    }
    dirty = true;
  }
  /** Tidy rows inside the tray (no animation if instant). */
  function layoutGrid(instant = false, list = bodies) {
    const n = list.length; if (!n) { dirty = true; return; }
    const size = list[0].size, gap = size * 1.18;
    const perRow = n <= 3 ? n : n <= 4 ? 2 : n <= 6 ? 3 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / perRow);
    list.forEach((b, i) => {
      const r = Math.floor(i / perRow), inRow = Math.min(perRow, n - r * perRow), c = i - r * perRow;
      const x = cx + (c - (inRow - 1) / 2) * gap, y = cy + (r - (rows - 1) / 2) * gap;
      if (instant) { b.x = x; b.y = y; b.tx = b.ty = null; } else { b.tx = x; b.ty = y; }
      b.a = instant ? 0 : b.a; b.sq = 1;
    });
    arranging = !instant; dirty = true;
  }
  /** Move bodies to target points (animated). */
  function arrange(points) { bodies.forEach((b, i) => { if (points[i]) { b.tx = points[i][0]; b.ty = points[i][1]; } }); arranging = true; dirty = true; }

  /** Throw every body that isn't held. finals: Map/array of final faces by index. */
  function roll(finals) {
    t = 0; rolling = true; arranging = false;
    const sp = R * 4.2;
    bodies.forEach((b, i) => {
      b.final = finals[i];
      if (b.held) { b.final = b.face; return; }
      // thrown in from the lower rim towards a random spot, hard enough to bounce around a little
      const sa = Math.PI * (0.62 + rnd() * 0.76);            // spawn angle around the bottom of the tray
      b.x = cx + Math.sin(sa) * R * 0.72; b.y = cy - Math.cos(sa) * R * 0.72;
      const ta = rnd() * Math.PI * 2, tr = Math.sqrt(rnd()) * R * 0.5;
      const tx = cx + Math.cos(ta) * tr, ty = cy + Math.sin(ta) * tr;
      const d = Math.hypot(tx - b.x, ty - b.y) || 1;
      const v = Math.min(sp * 1.2, Math.sqrt(2 * R * 2.6 * d) * (1.3 + rnd() * 0.5) + R * 0.6);
      b.vx = ((tx - b.x) / d) * v; b.vy = ((ty - b.y) / d) * v;
      b.va = (rnd() < 0.5 ? -1 : 1) * (7 + rnd() * 9);
      b.z = 0.2; b.vz = 5 + rnd() * 4; b.phi = rnd() * 3; b.sq = 1;
      b.settled = false; b.locked = false; b.tx = b.ty = null; b.t0 = 0;
      b.face = randFace(b.type);
    });
    dirty = true;
  }

  function step(dt) {
    t += dt;
    const fr = R * 2.6;                 // ground friction (px/s²)
    let moving = 0;
    for (const b of bodies) {
      if (b.settled || b.held) continue;
      // height (bounces)
      b.vz -= 34 * dt; b.z += b.vz * dt;
      if (b.z <= 0) {
        b.z = 0;
        if (b.vz < -2.2) { b.vz = -b.vz * 0.42; onHit?.(Math.min(1, -b.vz / 6)); b.va *= 0.8; } else b.vz = 0;
      }
      const ground = b.z <= 0.02;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        const dec = Math.min(sp, (ground ? fr : fr * 0.15) * dt) + sp * (ground ? 1.1 : 0.25) * dt;
        const k = Math.max(0, sp - dec) / sp; b.vx *= k; b.vy *= k;
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.a += b.va * dt; b.va *= Math.exp(-(ground ? 2.6 : 0.6) * dt);
      // tumbling: flip through random faces while fast, show the real face for the last tumble
      const spd = Math.hypot(b.vx, b.vy);
      const prev = Math.floor(b.phi / Math.PI);
      b.phi += (spd / (b.size * 0.5)) * dt * (ground ? 1 : 0.7);
      if (Math.floor(b.phi / Math.PI) !== prev) {
        if (spd > R * 0.75 && t < 1.2) b.face = randFace(b.type); else b.face = b.final;
      }
      b.sq = spd > R * 0.12 ? 0.6 + 0.4 * Math.abs(Math.cos(b.phi)) : b.sq + (1 - b.sq) * Math.min(1, dt * 14);
      // tray wall
      const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), lim = R - b.size * 0.52;
      if (d > lim) {
        const nx = dx / d, ny = dy / d;
        b.x = cx + nx * lim; b.y = cy + ny * lim;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) { b.vx -= 1.55 * vn * nx; b.vy -= 1.55 * vn * ny; b.va += (b.vx * ny - b.vy * nx) / (b.size * 2); onHit?.(Math.min(1, vn / (R * 3))); }
      }
      if (spd < R * 0.05 && b.z <= 0 && Math.abs(b.vz) < 0.01 && t > 0.35 || t > 2.6) {
        b.settled = true; b.vx = b.vy = 0; b.z = 0; b.face = b.final; b.t0 = 0;
        b.aim = Math.round(b.a / (Math.PI * 2)) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
      } else moving++;
    }
    // collisions
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const am = !a.settled && !a.held, bm = !b.settled && !b.held;
        if (!am && !bm) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = (a.size + b.size) * 0.5;
        if (d >= min) continue;
        const nx = dx / d, ny = dy / d, over = min - d;
        if (am && bm) { a.x -= nx * over / 2; a.y -= ny * over / 2; b.x += nx * over / 2; b.y += ny * over / 2; }
        else if (am) { a.x -= nx * over; a.y -= ny * over; } else { b.x += nx * over; b.y += ny * over; }
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const imp = -1.5 * rv;
          if (am && bm) { a.vx -= imp / 2 * nx; a.vy -= imp / 2 * ny; b.vx += imp / 2 * nx; b.vy += imp / 2 * ny; }
          else if (am) { a.vx -= imp * nx; a.vy -= imp * ny; } else { b.vx += imp * nx; b.vy += imp * ny; }
          a.va += 2; b.va -= 2;
          onHit?.(Math.min(1, -rv / (R * 3)));
        }
        // a settled die that gets knocked wakes up again
        if (a.settled && !a.held && bm && over > 1) { a.settled = false; a.final ??= a.face; }
        if (b.settled && !b.held && am && over > 1) { b.settled = false; b.final ??= b.face; }
      }
    }
    // settled: ease to a tidy angle
    for (const b of bodies) if (b.settled && b.aim != null) { b.a += (b.aim - b.a) * Math.min(1, dt * 10); if (Math.abs(b.aim - b.a) < 0.002) { b.a = b.aim; b.aim = null; } }
    if (rolling && !moving && bodies.every((b) => b.aim == null)) { rolling = false; onSettle?.(); }
  }

  function arrangeStep(dt) {
    let busy = false;
    for (const b of bodies) {
      if (b.tx == null) continue;
      const k = Math.min(1, dt * 9);
      b.x += (b.tx - b.x) * k; b.y += (b.ty - b.y) * k; b.a += (0 - b.a) * k;
      if (Math.abs(b.tx - b.x) + Math.abs(b.ty - b.y) < 0.3 && Math.abs(b.a) < 0.003) { b.x = b.tx; b.y = b.ty; b.a = 0; b.tx = b.ty = null; } else busy = true;
    }
    if (!busy) arranging = false;
  }

  function draw() {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // shadows first
    for (const b of bodies) {
      const lift = b.z * b.size * 0.09;
      g.beginPath();
      g.ellipse(b.x + lift * 0.6, b.y + b.size * 0.1 + lift, b.size * 0.48 * (1 - Math.min(0.3, b.z * 0.05)), b.size * 0.4, 0, 0, Math.PI * 2);
      g.fillStyle = `rgba(0,0,0,${(b.dim ? 0.08 : 0.22) * (1 - Math.min(0.5, b.z * 0.06))})`; g.fill();
    }
    for (const b of bodies) {
      const lift = b.z * b.size * 0.09, sc = 1 + Math.min(0.35, b.z * 0.05);
      const img = sprite(b), w = img.width / dpr;
      g.save();
      g.translate(b.x, b.y - lift);
      g.globalAlpha = b.dim ? 0.35 : 1;
      if (b.mark) {   // held / winner ring
        g.beginPath(); g.arc(0, 0, b.size * 0.68, 0, Math.PI * 2);
        g.lineWidth = Math.max(2, b.size * 0.07); g.strokeStyle = b.mark; g.stroke();
      }
      g.rotate(b.a);
      g.scale(sc, sc * b.sq);
      g.drawImage(img, -w / 2, -w / 2, w, w);
      g.restore();
      if (b.badge) {   // small corner tag (e.g. lock or the other advantage roll)
        g.save();
        const bx = b.x + b.size * 0.48, by = b.y - b.size * 0.48 - lift, br = Math.max(9, b.size * 0.2);
        g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fillStyle = b.badgeBg || '#f59e0b'; g.fill();
        g.fillStyle = '#fff'; g.font = `800 ${br * 1.05}px 'Space Grotesk', sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(b.badge, bx, by + br * 0.06);
        g.restore();
      }
    }
  }

  function frame(dt) {
    if (rolling) {
      const n = 3; for (let i = 0; i < n; i++) step(dt / n);
      dirty = true;
    } else if (arranging) { arrangeStep(dt); dirty = true; }
    if (dirty) { dirty = false; draw(); }
  }

  const onDown = (e) => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = Infinity;
    for (const b of bodies) { const d = Math.hypot(b.x - x, b.y - y); if (d < b.size * 0.62 && d < bd) { bd = d; best = b; } }
    if (best && onTap) { onTap(best, e); }
  };
  cv.addEventListener('pointerdown', onDown);

  return {
    cv, bodies, setBodies, layoutGrid, arrange, roll, frame,
    redraw() { dirty = true; },
    get rolling() { return rolling; },
    get geo() { return { cx, cy, R, W, H }; },
    destroy() { ro.disconnect(); cv.removeEventListener('pointerdown', onDown); cv.remove(); cache.clear(); },
  };
}
