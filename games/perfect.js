// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Perfect Circle — draw a circle in one go. While you draw, the stroke shows how round it is (green = on the
// circle, red = off) with a live estimate; when you let go the ideal circle is laid over it and you get a
// percentage. Each drawing is one round; the chart keeps your five best circles.
import { TAU, clamp, lerp, ease, angDiff, THEME } from './kit.js';
import { bestScore } from './scores.js';

const HEAT_DARK = Array.from({ length: 12 }, (_, i) => `hsl(${Math.round(140 - (140 * i) / 11)}, 92%, ${58 + (i > 6 ? 4 : 0)}%)`);
// on a light background the same scale a little deeper, so the yellows still read
const HEAT_LIGHT = Array.from({ length: 12 }, (_, i) => `hsl(${Math.round(140 - (140 * i) / 11)}, 85%, ${40 + (i > 6 ? 6 : 0)}%)`);
const HEAT_FULL = 0.09;                 // relative deviation that is fully red

/** Points spaced evenly along a polyline. */
function resample(pts, n) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1], out = [];
  if (L <= 0) return pts.slice(0, 1);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (L * i) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]);
  }
  return out;
}
const pathLength = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };

/** Best-fit circle: algebraic (Kåsa) fit, then a few Gauss-Newton steps of the true geometric fit. */
function fitCircle(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x, y] of pts) {
    const u = x - mx, v = y - my;
    suu += u * u; suv += u * v; svv += v * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const bu = 0.5 * (suuu + suvv), bv = 0.5 * (svvv + svuu);
  let a = (bu * svv - bv * suv) / det + mx, b = (bv * suu - bu * suv) / det + my;
  let r = Math.sqrt((a - mx) ** 2 + (b - my) ** 2 + (suu + svv) / n);
  for (let it = 0; it < 6; it++) {            // geometric refinement
    let A11 = 0, A12 = 0, A13 = 0, A22 = 0, A23 = 0, A33 = 0, g1 = 0, g2 = 0, g3 = 0;
    for (const [x, y] of pts) {
      const dx = x - a, dy = y - b, d = Math.hypot(dx, dy) || 1e-9, f = d - r;
      const j1 = -dx / d, j2 = -dy / d, j3 = -1;
      A11 += j1 * j1; A12 += j1 * j2; A13 += j1 * j3; A22 += j2 * j2; A23 += j2 * j3; A33 += j3 * j3;
      g1 += j1 * f; g2 += j2 * f; g3 += j3 * f;
    }
    // solve A·δ = −g (3×3, Cramer)
    const D3 = A11 * (A22 * A33 - A23 * A23) - A12 * (A12 * A33 - A23 * A13) + A13 * (A12 * A23 - A22 * A13);
    if (Math.abs(D3) < 1e-12) break;
    const r1 = -g1, r2 = -g2, r3 = -g3;
    const d1 = (r1 * (A22 * A33 - A23 * A23) - A12 * (r2 * A33 - A23 * r3) + A13 * (r2 * A23 - A22 * r3)) / D3;
    const d2 = (A11 * (r2 * A33 - A23 * r3) - r1 * (A12 * A33 - A23 * A13) + A13 * (A12 * r3 - r2 * A13)) / D3;
    const d3 = (A11 * (A22 * r3 - r2 * A23) - A12 * (A12 * r3 - r2 * A13) + r1 * (A12 * A23 - A22 * A13)) / D3;
    if (!Number.isFinite(d1 + d2 + d3)) break;
    a += d1; b += d2; r += d3;
    if (Math.abs(d1) + Math.abs(d2) + Math.abs(d3) < 1e-4) break;
  }
  return r > 0 && Number.isFinite(a + b + r) ? { x: a, y: b, r } : null;
}

/** Everything about a drawing. Coordinates in px; R = screen radius. */
export function analyse(raw, R) {
  if (raw.length < 6 || pathLength(raw) < R * 0.12) return { err: 'few' };
  const pts = resample(raw, 240);
  const c = fitCircle(pts);
  if (!c || c.r > R * 3) return { err: 'open', c: null };
  let sum2 = 0, maxDev = 0, sweep = 0, prev = Math.atan2(pts[0][1] - c.y, pts[0][0] - c.x);
  for (const [x, y] of pts) {
    const dev = (Math.hypot(x - c.x, y - c.y) - c.r) / c.r;
    sum2 += dev * dev; maxDev = Math.max(maxDev, Math.abs(dev));
    const a = Math.atan2(y - c.y, x - c.x);
    sweep += angDiff(prev, a); prev = a;
  }
  const rms = Math.sqrt(sum2 / pts.length), turns = Math.abs(sweep) / TAU;
  const first = raw[0], last = raw[raw.length - 1];
  const gap = Math.hypot(last[0] - first[0], last[1] - first[1]) / c.r;
  const res = { c, rms, maxDev, turns, gap, dir: Math.sign(sweep) || 1 };
  if (c.r < R * 0.1) return { ...res, err: 'small' };
  if (turns < 0.75) return { ...res, err: 'open' };
  const round = clamp(1 - 2.8 * rms - 0.7 * maxDev, 0, 1);
  const cover = turns >= 0.97 ? 1 : lerp(0.55, 1, (turns - 0.75) / 0.22);       // not all the way round: heavy penalty
  const close = turns >= 1 ? 1 : 1 - 0.3 * clamp((gap - 0.05) / 0.6, 0, 1);     // a gap between start and end
  const over = 1 - 0.15 * clamp((turns - 1.15) / 0.6, 0, 1);                     // went round much more than once
  res.pct = Math.round(1000 * round * cover * close * over) / 10;
  res.round = round;
  return res;
}
const wordFor = (p) => (p >= 97 ? 'Perfect!' : p >= 93 ? 'Superb!' : p >= 88 ? 'Great' : p >= 80 ? 'Good' : p >= 70 ? 'Not bad' : p >= 55 ? 'Wobbly' : 'Hmm…');

export default {
  howTo: 'Draw a circle in one go with your finger. Green is round, red is off. How close to perfect can you get?',
  scoring: 'high',
  unit: '%',
  format: (n) => n.toFixed(1),
  hud: false,
  create(g) {
    let phase = 'ready', phaseT = 0, pid = null;
    let pts = [], live = null, liveT = 0, result = null, failMsg = '', pulse = 0;
    const best = bestScore('perfect', g.mode || 'default');
    const devs = [];                               // per point deviation for the heat colours

    function begin(p) {
      if (phase !== 'ready' && phase !== 'fail') return;
      phase = 'drawing'; phaseT = 0; pid = p.id; pts = [[p.x, p.y]]; live = null; devs.length = 0;
      g.sfx('tick');
    }
    function addPoint(p) {
      const l = pts[pts.length - 1];
      if (Math.hypot(p.x - l[0], p.y - l[1]) < 1.5) return;
      pts.push([p.x, p.y]);
    }
    function finish() {
      const a = analyse(pts, g.R);
      if (a.err) {
        phase = 'fail'; phaseT = 0;
        failMsg = a.err === 'small' ? 'Too small — draw bigger' : a.err === 'open' ? 'Not a full circle' : 'Draw a circle in one go';
        g.sfx('drop'); g.vibrate(15);
        return;
      }
      result = a; phase = 'result'; phaseT = 0;
      recolour(a.c);
      const word = wordFor(a.pct);
      g.sfx(a.pct >= 93 ? 'perfect' : a.pct >= 80 ? 'score' : 'place');
      if (a.pct >= 97) g.vibrate(30);
      const notes = [`Average wobble ${(a.rms * 100).toFixed(1)}%`, `${Math.round(a.turns * 360)}° around`];
      if (a.turns < 0.97) notes.push('not quite all the way round');
      else if (a.gap > 0.3 && a.turns < 1) notes.push('mind the gap');
      g.over(a.pct, { title: word, label: word.replace('!', ''), note: notes.join(' · '), delay: 2700, sfx: false });
    }
    function recolour(c) {
      devs.length = pts.length;
      for (let i = 0; i < pts.length; i++) devs[i] = c ? Math.abs(Math.hypot(pts[i][0] - c.x, pts[i][1] - c.y) - c.r) / c.r : -1;
    }

    g.on('down', (p) => begin(p));
    g.on('move', (p) => { if (phase === 'drawing' && p.id === pid) addPoint(p); });
    g.on('up', (p) => { if (phase === 'drawing' && p.id === pid) { addPoint(p); finish(); } });

    function strokeHeat(alpha = 1) {
      const { ctx } = g;
      const n = pts.length;
      if (n < 2) return;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalAlpha = alpha; ctx.lineWidth = g.R * 0.022;
      const neutral = devs.length < n || devs[0] < 0;
      if (neutral) {
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.strokeStyle = g.color; ctx.stroke();
      } else {
        const HEAT = THEME.light ? HEAT_LIGHT : HEAT_DARK;
        for (let b = 0; b < HEAT.length; b++) {
          ctx.beginPath(); let open = false;
          for (let i = 1; i < n; i++) {
            const k = Math.min(HEAT.length - 1, Math.floor((Math.min(devs[i], HEAT_FULL) / HEAT_FULL) * (HEAT.length - 1) + 0.5));
            if (k === b) { if (!open) { ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); open = true; } ctx.lineTo(pts[i][0], pts[i][1]); }
            else open = false;
          }
          ctx.strokeStyle = HEAT[b]; ctx.stroke();
        }
      }
      ctx.restore();
    }
    function bigText(main, sub, k, y = g.cy, size = 0.2) {
      const s = ease.back(clamp(k, 0, 1));
      g.draw.text(main, g.cx, y, g.R * size * (0.6 + 0.4 * s), { glow: 18, color: THEME.fg, alpha: clamp(k * 2, 0, 1) });
      if (sub) g.draw.text(sub, g.cx, y + g.R * (size * 0.6 + 0.065), g.R * 0.075, { color: THEME.muted, weight: 600, alpha: clamp(k * 2 - 0.4, 0, 1) });
    }

    g.loop((dt, t) => {
      const { ctx, cx, cy, R } = g;
      phaseT += dt; pulse += dt;
      g.draw.bg({ glow: 0.12 + (phase === 'result' ? 0.08 : 0) });

      // hint: a faint ring + centre dot while waiting
      const hintA = phase === 'ready' ? Math.min(1, phaseT / 0.4) : phase === 'fail' ? clamp((phaseT - 0.8) / 0.4, 0, 1) : phase === 'drawing' ? Math.max(0, 1 - phaseT / 0.3) : 0;
      if (hintA > 0) {
        ctx.save(); ctx.globalAlpha = hintA;
        ctx.setLineDash([R * 0.012, R * 0.035]); ctx.lineDashOffset = -t * R * 0.03;
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, TAU); ctx.strokeStyle = THEME.line; ctx.lineWidth = R * 0.006; ctx.stroke();
        ctx.restore();
        g.draw.circle(cx, cy, R * (0.012 + 0.003 * Math.sin(pulse * 3)), g.draw.alpha(g.color, 0.8 * hintA));
        if (phase !== 'drawing') {
          g.draw.text('Draw a circle', cx, cy - R * 0.11, R * 0.07, { color: THEME.fg, alpha: 0.85 * hintA });
          g.draw.text('in one go', cx, cy + R * 0.11, R * 0.045, { color: THEME.muted, weight: 500, alpha: hintA });
        }
        if (best && phase !== 'drawing') g.draw.text(`Best ${best.score.toFixed(1)}%`, cx, cy - R * 0.68, R * 0.05, { color: THEME.muted, weight: 600, alpha: hintA });
      }

      if (phase === 'drawing') {
        // live fit (a few times a second is plenty)
        liveT -= dt;
        if (liveT <= 0 && pts.length > 8) {
          liveT = 0.06;
          const r = resample(pts, 100), c = fitCircle(r);
          let sweep = 0;
          if (c && c.r < R * 3) {
            let prev = Math.atan2(r[0][1] - c.y, r[0][0] - c.x), sum2 = 0, mx = 0;
            for (const [x, y] of r) {
              const a = Math.atan2(y - c.y, x - c.x); sweep += angDiff(prev, a); prev = a;
              const d = (Math.hypot(x - c.x, y - c.y) - c.r) / c.r; sum2 += d * d; mx = Math.max(mx, Math.abs(d));
            }
            const turns = Math.abs(sweep) / TAU;
            live = turns > 0.25 ? { c, pct: Math.round(1000 * clamp(1 - 2.8 * Math.sqrt(sum2 / r.length) - 0.7 * mx, 0, 1)) / 10, turns } : null;
          } else live = null;
          if (live) recolour(live.c); else devs.length = 0;
        } else if (live && devs.length < pts.length) {       // colour new points against the last fit
          for (let i = devs.length; i < pts.length; i++) devs[i] = Math.abs(Math.hypot(pts[i][0] - live.c.x, pts[i][1] - live.c.y) - live.c.r) / live.c.r;
        }
        strokeHeat();
        const l = pts[pts.length - 1];
        g.draw.circle(l[0], l[1], R * 0.018, THEME.fg, { stroke: g.color, lw: R * 0.006 });
        if (live) {
          g.draw.text(`${live.pct.toFixed(1)}%`, cx, cy, R * 0.13, { color: THEME.fg, alpha: 0.9, glow: 12 });
        }
      } else if (phase === 'fail') {
        strokeHeat(Math.max(0, 1 - phaseT / 0.9));
        if (phaseT < 1.6) bigText(failMsg, 'try again', Math.min(1, phaseT * 3) * Math.min(1, (1.6 - phaseT) * 3), cy, 0.1);
        if (phaseT > 1.6) { phase = 'ready'; phaseT = 0.4; }
      } else if (phase === 'result') {
        const a = result, c = a.c;
        strokeHeat(1 - 0.35 * clamp(phaseT / 1, 0, 1));
        // the ideal circle sweeps in over the drawing
        const k = ease.out(clamp(phaseT / 0.7, 0, 1));
        const a0 = Math.atan2(pts[0][1] - c.y, pts[0][0] - c.x);
        ctx.save();
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, a0, a0 + a.dir * TAU * k, a.dir < 0);
        ctx.strokeStyle = THEME.ink(0.85); ctx.lineWidth = R * 0.008; ctx.stroke();
        ctx.restore();
        g.draw.circle(c.x, c.y, R * 0.012, THEME.fg);
        // the score counts up
        const shown = a.pct * ease.out(clamp((phaseT - 0.2) / 0.9, 0, 1));
        const word = wordFor(a.pct);
        bigText(`${shown.toFixed(1)}%`, phaseT > 1.0 ? word : '', clamp(phaseT / 0.35, 0, 1), cy - R * 0.04);
        if (phaseT > 1.1 && (!best || a.pct > best.score)) g.draw.text(best ? 'New best!' : 'First circle!', cx, cy + R * 0.3, R * 0.055, { color: THEME.light ? g.draw.shade(g.color, -0.35) : g.color, glow: 10, alpha: clamp((phaseT - 1.1) * 3, 0, 1) });
        if (phaseT > 1.0 && phaseT - dt <= 1.0 && a.pct >= 90) g.draw.burst(cx, cy - R * 0.04, g.color, 24, R * 0.6);
      }
      g.draw.particles(dt);
    });
    return {};
  },
};
