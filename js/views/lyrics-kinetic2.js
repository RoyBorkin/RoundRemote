// Two more Kinetic Type variants, modelled on reference lyric videos:
//   bw   – "Black & White" (after the classic "Do I Wanna Know" kinetic video):
//          heavy geometric caps on pure black, a different scene for every line:
//          giant words the camera flies through, small words ticking along a rule,
//          words written around a planet, words riding a drawn wave, a stacked block in
//          a ring, and inverted black-on-white blocks that arrive with an hourglass wipe.
//   hand – "Hand-drawn" (after the "Nothing Arrived" hand-drawn motion video): flat
//          mint / indigo / pink palettes that change with an organic paint-splash wipe;
//          small hand-lettered lead-in words with little burst marks over one big brush
//          word that writes itself on letter by letter, with speed lines; staircases of
//          growing words; words circling a tiny planet; everything "boils" at 8 fps like
//          hand-drawn animation, and letters scatter away at the end of the line.
import { h } from '../ui/dom.js';
import { lineAt } from '../lyrics/lrc.js';
import { clamp } from '../core/util.js';
import { isGap, dots, clean, isSmall, textWidth, rowsOf, wordEnd } from './lyrics-extra.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) if (k) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  return e;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const px = (v) => `${v.toFixed(1)}px`;
const f1 = (v) => v.toFixed(1);
const asked = new Set();
function wantFonts(list) {
  if (!document.fonts?.load) return;
  for (const f of list) if (!asked.has(f)) { asked.add(f); document.fonts.load(f).catch(() => {}); }
}
/** Font size (px) that makes `text` span `width`. */
const fit = (text, width, family, weight, min, max, spacing = 0) =>
  clamp((width / Math.max(1, textWidth(text, 100, weight, family) + spacing * 100 * text.length)) * 100, min, max);
let uid = 0;

/** Runs a line-by-line scene machine: builds a scene per lyric line and reveals words on time. */
function sceneRunner(L, build, gap) {
  let cur = -99, scene = null, seen = 0;
  return {
    tick(ms) {
      let i = lineAt(L, ms);
      if (isGap(L, i, ms)) i = -1 - Math.max(0, i);
      if (i !== cur) {
        cur = i; seen = 0;
        scene?.leave();
        scene = i >= 0 ? build(L[i], i) : gap();
      }
      if (i < 0 || !scene?.reveal) return;
      const words = L[i].words || [];
      while (seen < words.length && ms >= words[seen].t - 50) scene.reveal(seen++);
    },
  };
}
function leaveAfter(el, ms = 700, cls = 'out') {
  return () => { el.classList.add(cls); setTimeout(() => el.remove(), ms); };
}

// =====================================================================================
// BLACK & WHITE
// =====================================================================================
const BW = "'League Spartan', 'Arial Black', Impact, sans-serif";

export function bwStyle(box, lyr, api) {
  wantFonts(['900 50px "League Spartan"', '800 50px "League Spartan"']);
  const field = h('div.kbw-field', h('div.kbw-white'));
  api.bg.appendChild(field);
  const white = field.firstChild;
  const root = h('div.kt.kbw');
  box.appendChild(root);
  let last = '';

  const ctx = {
    root,
    get W() { return box.clientWidth; },
    get H() { return box.clientHeight; },
    invert(on) {
      if (on) { white.classList.remove('off'); void white.offsetWidth; white.classList.add('on'); }
      else if (white.classList.contains('on')) { white.classList.remove('on'); white.classList.add('off'); }
    },
  };

  function choose(ln) {
    const n = (ln.words || []).length;
    const opts = n <= 3 ? ['giant', 'giant', 'invert']
      : n <= 6 ? ['giant', 'invert', 'ticker', 'orbit', 'stack', 'wave']
        : ['ticker', 'orbit', 'wave', 'stack', 'giant'];
    const c = opts.filter((m) => m !== last);
    return (last = pick(c.length ? c : opts));
  }

  const run = sceneRunner(lyr.lines, (ln) => {
    const mode = choose(ln);
    ctx.invert(mode === 'invert');
    return BW_SCENES[mode](ctx, ln);
  }, () => {
    ctx.invert(false);
    const el = h('div.kbw-scene.kbw-gap', dots());
    root.appendChild(el);
    return { el, leave: leaveAfter(el) };
  });

  return {
    tick: run.tick,
    destroy() { field.classList.add('gone'); setTimeout(() => field.remove(), 700); },
  };
}

const BW_SCENES = {
  // Small words tick on one by one along a rule that draws in underneath.
  ticker(ctx, ln) {
    const { W, H } = ctx;
    const words = ln.words || [];
    const text = words.map((w) => w.text).join(' ').toUpperCase();
    const long = textWidth(text, H * 0.065, 800, BW) * 1.3 > W * 0.86;
    const size = fit(text, W * 0.86 * (long ? 1.85 : 1), BW, 800, H * 0.045, H * 0.1, 0.12);
    let acc = -1, best = 0;
    words.forEach((w, j) => { const l = clean(w.text).length; if (l > best) { best = l; acc = j; } });
    const spans = words.map((w, j) => h(`span.kbw-tw${j === acc ? '.acc' : ''}`, w.text));
    const line = h('div.kbw-tline', { style: { fontSize: px(size), maxWidth: px(W * 0.92) } }, ...spans.flatMap((s, j) => (j ? [' ', s] : [s])));
    const el = h('div.kbw-scene.kbw-ticker', h('div.kbw-tcol', line, h('i.kbw-rule')));
    ctx.root.appendChild(el);
    return { el, reveal: (j) => spans[j]?.classList.add('in'), leave: leaveAfter(el) };
  },

  // One word (or a small lockup) at a time, huge; the previous one rushes past the camera.
  giant(ctx, ln) {
    const { W, H } = ctx;
    const words = ln.words || [];
    const units = rowsOf(words);
    const unitOf = [];
    units.forEach((u, ui) => u.forEach((j) => { unitOf[j] = ui; }));
    const el = h('div.kbw-scene.kbw-giant');
    ctx.root.appendChild(el);
    const ENTR = ['blur', 'slide', 'drop', 'spin', 'blur'];
    const off = Math.floor(Math.random() * ENTR.length);
    let curEl = null;
    function show(ui) {
      const text = units[ui].map((j) => words[j].text).join(' ').toUpperCase();
      const size = fit(text, W * 0.92, BW, 900, H * 0.12, H * 0.6);
      const w = h(`div.kbw-big.e-${ENTR[(ui + off) % ENTR.length]}`, { style: { fontSize: px(size) } }, text);
      if (curEl) { const o = curEl; o.classList.add('thru'); setTimeout(() => o.remove(), 500); }
      curEl = w;
      el.appendChild(w);
    }
    return { el, reveal: (j) => { if (units[unitOf[j]]?.[0] === j) show(unitOf[j]); }, leave: leaveAfter(el) };
  },

  // Black-on-white: tight left-aligned stack, rows slam up out of a clip; hourglass wipe in.
  invert(ctx, ln) {
    const { W, H } = ctx;
    const words = ln.words || [];
    const spans = [];
    const bw = Math.min(W * 0.66, H * 0.95);
    const block = h('div.kbw-iblock');
    rowsOf(words).forEach((idxs) => {
      const text = idxs.map((j) => words[j].text).join(' ').toUpperCase();
      const size = fit(text, bw, BW, 900, H * 0.07, H * 0.34);
      block.appendChild(h('div.kbw-irow', { style: { fontSize: px(size) } },
        ...idxs.flatMap((j, n) => { const s = h('span.kbw-iw', words[j].text); spans[j] = s; return n ? [' ', s] : [s]; })));
    });
    const el = h('div.kbw-scene.kbw-invert', block);
    ctx.root.appendChild(el);
    const bh = block.offsetHeight || 1;
    if (bh > H * 0.9) block.style.transform = `scale(${((H * 0.9) / bh).toFixed(3)})`;
    return { el, reveal: (j) => spans[j]?.classList.add('in'), leave: leaveAfter(el) };
  },

  // Words written around a planet; the planet turns so the newest word sits on top.
  orbit(ctx, ln) {
    const { W, H } = ctx;
    const words = ln.words || [];
    const cx = W / 2, cy = H / 2 + H * 0.06;
    const R = Math.min(W, H) * 0.25;
    let fs = Math.min(W, H) * 0.075;
    const rT = R + Math.min(W, H) * 0.018;
    const id = `kbwp${++uid}`;
    const path = svg('path', { id, d: `M${f1(cx - rT)},${f1(cy)} a${f1(rT)},${f1(rT)} 0 1,1 ${f1(2 * rT)},0 a${f1(rT)},${f1(rT)} 0 1,1 ${f1(-2 * rT)},0`, fill: 'none' });
    const tspans = words.map((w) => svg('tspan', {}, `${w.text.toUpperCase()} `));
    const tp = svg('textPath', { href: `#${id}` }, ...tspans);
    const text = svg('text', { class: 'kbw-otext', 'font-size': f1(fs) }, tp);
    const g = svg('g', { class: 'kbw-orbit' }, path, text);
    const planet = svg('circle', { cx: f1(cx), cy: f1(cy), r: f1(R), class: 'kbw-planet', style: `--len:${f1(2 * Math.PI * R)}` });
    const stars = svg('g', {}, ...Array.from({ length: 14 }, () => svg('circle', { cx: f1(rnd(0, W)), cy: f1(rnd(0, H)), r: f1(rnd(0.6, 1.8)), class: 'kbw-star', style: `animation-delay:${-rnd(0, 3).toFixed(2)}s` })));
    const s = svg('svg', { class: 'kbw-svg', width: f1(W), height: f1(H), viewBox: `0 0 ${f1(W)} ${f1(H)}` }, stars, planet, g);
    const el = h('div.kbw-scene.kbw-orb', s);
    ctx.root.appendChild(el);
    g.style.transformOrigin = `${f1(cx)}px ${f1(cy)}px`;
    // shrink the type if the line doesn't fit around the planet
    try {
      const len = text.getComputedTextLength();
      const room = 2 * Math.PI * rT * 0.94;
      if (len > room) { fs *= room / len; text.setAttribute('font-size', f1(fs)); }
    } catch {}
    const starts = [];
    words.reduce((a, w, j) => { starts[j] = a; return a + w.text.length + 1; }, 0);
    let rot = 0;
    function face(j) {
      try {
        const ci = starts[j] + Math.floor(words[j].text.length / 2);
        const p = text.getStartPositionOfChar(ci);
        const ang = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;
        let target = -90 - ang;
        while (target - rot > 180) target -= 360;
        while (target - rot < -180) target += 360;
        rot = target;
        g.style.transform = `rotate(${rot.toFixed(1)}deg)`;
      } catch {}
    }
    return { el, reveal: (j) => { tspans[j]?.classList.add('in'); face(j); }, leave: leaveAfter(el) };
  },

  // Words ride a line that draws itself across the screen in waves.
  wave(ctx, ln) {
    const { W, H } = ctx;
    const words = ln.words || [];
    const cy = H * 0.56, A = H * 0.13, x0 = -W * 0.02, x1 = W * 1.02;
    const ph = rnd(0, Math.PI * 2), cyc = rnd(1.2, 1.8);
    let d = '';
    for (let k = 0; k <= 64; k++) {
      const t = k / 64, x = x0 + (x1 - x0) * t;
      const env = Math.sin(t * Math.PI) ** 0.8; // flat at the ends, tall in the middle
      const y = cy - A * env * Math.sin(ph + t * Math.PI * 2 * cyc);
      d += `${k ? 'L' : 'M'}${f1(x)},${f1(y)}`;
    }
    const id = `kbww${++uid}`;
    const line = svg('path', { id, d, class: 'kbw-wave' });
    let fs = Math.min(W, H) * 0.07;
    const tspans = words.map((w) => svg('tspan', {}, `${w.text.toUpperCase()} `));
    const text = svg('text', { class: 'kbw-otext', 'font-size': f1(fs), dy: f1(-fs * 0.3) }, svg('textPath', { href: `#${id}`, startOffset: '4%' }, ...tspans));
    const s = svg('svg', { class: 'kbw-svg', width: f1(W), height: f1(H), viewBox: `0 0 ${f1(W)} ${f1(H)}` }, line, text);
    const el = h('div.kbw-scene.kbw-wav', s);
    ctx.root.appendChild(el);
    try {
      const total = line.getTotalLength();
      line.style.setProperty('--len', f1(total));
      const len = text.getComputedTextLength();
      if (len > total * 0.9) { fs *= (total * 0.9) / len; text.setAttribute('font-size', f1(fs)); text.setAttribute('dy', f1(-fs * 0.3)); }
    } catch {}
    return { el, reveal: (j) => tspans[j]?.classList.add('in'), leave: leaveAfter(el) };
  },

  // A tight justified block that builds inside a ring drawn around it.
  stack(ctx, ln) {
    const { W, H } = ctx;
    const words = ln.words || [];
    const m = Math.min(W, H);
    const bw = m * 0.6;
    const spans = [];
    const block = h('div.kbw-block');
    rowsOf(words).forEach((idxs) => {
      const text = idxs.map((j) => words[j].text).join(' ').toUpperCase();
      const size = fit(text, bw, BW, 900, m * 0.055, m * 0.2);
      block.appendChild(h('div.kbw-row', { style: { fontSize: px(size) } },
        ...idxs.flatMap((j, n) => { const s = h('span.kbw-sw', words[j].text); spans[j] = s; return n ? [' ', s] : [s]; })));
    });
    const R = m * 0.47;
    const ring = svg('svg', { class: 'kbw-svg', width: f1(W), height: f1(H), viewBox: `0 0 ${f1(W)} ${f1(H)}` },
      svg('circle', { cx: f1(W / 2), cy: f1(H / 2), r: f1(R), class: 'kbw-ring', style: `--len:${f1(2 * Math.PI * R)}` }));
    const el = h('div.kbw-scene.kbw-stack', ring, block);
    ctx.root.appendChild(el);
    const bh = block.offsetHeight || 1;
    const k = Math.min(1, (m * 0.72) / bh);
    if (k < 1) block.style.transform = `scale(${k.toFixed(3)})`;
    return { el, reveal: (j) => spans[j]?.classList.add('in'), leave: leaveAfter(el) };
  },
};

// =====================================================================================
// HAND-DRAWN
// =====================================================================================
const HD_BIG = "'Permanent Marker', 'Comic Sans MS', cursive";
const HD_SMALL = "'Amatic SC', 'Permanent Marker', cursive";
const PALETTES = [
  { bg: '#12f5bd', ink: '#3d0f8f', pop: '#ff2472' },
  { bg: '#3d0f8f', ink: '#12f5bd', pop: '#ff2472' },
  { bg: '#ff2472', ink: '#3d0f8f', pop: '#12f5bd' },
  { bg: '#06121a', ink: '#12f5bd', pop: '#ff2472' },
  { bg: '#12f5bd', ink: '#ff2472', pop: '#3d0f8f' },
];

/** Wobbly closed blob (0–100 box) through jittered radial points, Catmull-Rom smoothed. */
function blobPath(n = 11, jit = 0.18, spikes = 0) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rnd(-0.15, 0.15);
    let r = 45 * (1 - jit + Math.random() * jit * 2);
    if (spikes && Math.random() < spikes) r = Math.min(50, r * rnd(1.08, 1.2));
    pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
  }
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  for (let k = 0; k < n; k++) {
    const p0 = pts[(k - 1 + n) % n], p1 = pts[k], p2 = pts[(k + 1) % n], p3 = pts[(k + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return `${d}Z`;
}
const blobSvg = (fill, cls, n, jit, spikes) => svg('svg', { viewBox: '0 0 100 100', class: cls, preserveAspectRatio: 'none' }, svg('path', { d: blobPath(n, jit, spikes), fill }));
function scatterVars(el) {
  const a = rnd(0, Math.PI * 2), d = rnd(40, 160);
  el.style.setProperty('--sx', `${f1(Math.cos(a) * d)}%`);
  el.style.setProperty('--sy', `${f1(Math.sin(a) * d + 60)}%`);
  el.style.setProperty('--sr', `${f1(rnd(-140, 140))}deg`);
}
const burst = (side) => svg('svg', { viewBox: '0 0 20 30', class: `khd-burst ${side}` },
  svg('path', { d: side === 'l' ? 'M17,7 L7,2 M17,15 L5,15 M17,23 L7,28' : 'M3,7 L13,2 M3,15 L15,15 M3,23 L13,28' }));
const speedLines = (side) => svg('svg', { viewBox: '0 0 40 60', class: `khd-lines ${side}`, preserveAspectRatio: 'none' },
  ...(side === 'l'
    ? ['M38,10 C26,4 14,14 2,6', 'M38,30 C25,26 14,35 3,30', 'M38,50 C26,56 14,46 2,54']
    : ['M2,10 C14,4 26,14 38,6', 'M2,30 C15,26 26,35 37,30', 'M2,50 C14,56 26,46 38,54']).map((d) => svg('path', { d })));

export function handStyle(box, lyr, api) {
  wantFonts(['50px "Permanent Marker"', '700 50px "Amatic SC"']);
  const L = lyr.lines;
  const field = h('div.khd-field');
  api.bg.appendChild(field);
  const root = h('div.kt.khd');
  box.appendChild(root);
  let pi = Math.floor(Math.random() * PALETTES.length), deco = null, first = true;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

  function setVars(el, p) { el.style.setProperty('--bg', p.bg); el.style.setProperty('--ink', p.ink); el.style.setProperty('--pop', p.pop); }
  function makeDeco(p) {
    const d = h('div.khd-deco');
    for (let k = 0; k < 5; k++) {
      const a = rnd(0, Math.PI * 2), r = rnd(38, 50), s = rnd(8, 22);
      const b = blobSvg(k % 3 === 0 ? p.pop : p.ink, 'khd-blob boil', 9, 0.22, 0.3);
      b.style.cssText = `left:${f1(50 + r * Math.cos(a) - s / 2)}%;top:${f1(50 + r * Math.sin(a) - s / 2)}%;width:${f1(s)}%;height:${f1(s * rnd(0.8, 1.2))}%;animation-delay:${(-rnd(0, 0.5)).toFixed(2)}s,${(-rnd(0, 9)).toFixed(2)}s`;
      d.appendChild(b);
    }
    for (let k = 0; k < 9; k++) {
      const a = rnd(0, Math.PI * 2), r = rnd(28, 48), s = rnd(0.8, 2.4);
      d.appendChild(h('i.khd-dot.boil', { style: { left: `${f1(50 + r * Math.cos(a))}%`, top: `${f1(50 + r * Math.sin(a))}%`, width: `${f1(s)}%`, height: `${f1(s)}%`, background: k % 2 ? p.pop : p.ink, animationDelay: `${(-rnd(0, 0.5)).toFixed(2)}s,${(-rnd(0, 9)).toFixed(2)}s` } }));
    }
    return d;
  }
  function repaint() {
    const prev = pi;
    if (!first) pi = (pi + 1 + Math.floor(Math.random() * (PALETTES.length - 1))) % PALETTES.length;
    const p = PALETTES[pi];
    setVars(root, p);
    const oldDeco = deco;
    deco = makeDeco(p);
    if (first || prev === pi) {
      first = false;
      field.style.background = p.bg;
      field.appendChild(deco);
      oldDeco?.remove();
      return;
    }
    const a = rnd(0, Math.PI * 2);
    const sp = blobSvg(p.bg, 'khd-splash', 13, 0.14, 0.45);
    sp.style.left = `${f1(50 + 55 * Math.cos(a))}%`;
    sp.style.top = `${f1(50 + 55 * Math.sin(a))}%`;
    field.append(sp, deco);
    oldDeco?.classList.add('gone');
    later(() => { field.style.background = p.bg; sp.remove(); oldDeco?.remove(); }, 800);
  }

  // Reveal helpers: small words pop; "letters" entries write on across the word's duration.
  function revealer(ln, i, spans) {
    return (j) => {
      const s = spans[j];
      if (!s) return;
      if (s.letters) {
        const dur = clamp(wordEnd(ln, j, L, i) - ln.words[j].t, 220, 1000);
        const step = dur / Math.max(1, s.letters.length);
        s.letters.forEach((l, k) => {
          l.style.animationDelay = `${Math.round(k * step)}ms, ${(-rnd(0, 0.5)).toFixed(2)}s`;
          l.classList.remove('wait');
          l.classList.add('pop');
        });
        if (s.el) later(() => s.el.classList.add('done'), dur + 200);
      } else {
        s.classList.remove('wait');
        s.classList.add('pop');
      }
    };
  }
  const letterSpans = (text) => [...text.toUpperCase()].map((ch) => {
    const l = h('span.hl.wait', ch === ' ' ? ' ' : ch);
    scatterVars(l);
    return l;
  });
  const smallWord = (text, spans, j) => { const s = h('span.hw.wait', text); scatterVars(s); spans[j] = s; return s; };

  function plan(ln) {
    const words = ln.words || [];
    let hero = -1;
    for (let j = words.length - 1; j >= 0; j--) if (!isSmall(words[j].text)) { hero = j; break; }
    if (hero < 0) hero = words.length - 1;
    const lead = [], tail = [];
    words.forEach((_, j) => { if (j < hero) lead.push(j); else if (j > hero) tail.push(j); });
    return { words, hero, lead, tail };
  }

  const LAYOUTS = {
    // small hand-lettered words with burst marks over one big brush word
    lockup(ln, i, P) {
      const W = box.clientWidth, H = box.clientHeight;
      const { words } = P;
      const spans = [];
      const el = h('div.khd-scene.khd-lockup');
      if (P.lead.length) {
        const t = P.lead.map((j) => words[j].text).join(' ').toUpperCase();
        const wide = textWidth(t, H * 0.09, 700, HD_SMALL) > W * 0.62;
        const size = fit(t, W * 0.62 * (wide ? 1.8 : 1), HD_SMALL, 700, H * 0.06, H * 0.16);
        el.appendChild(h('div.khd-leadwrap', { style: { fontSize: px(size), maxWidth: px(W * 0.86) } },
          burst('l'), h('div.khd-lead', ...P.lead.flatMap((j, n) => { const s = smallWord(words[j].text, spans, j); return n ? [' ', s] : [s]; })), burst('r')));
      }
      const ht = words[P.hero]?.text || '';
      const hs = fit(ht.toUpperCase(), W * 0.84, HD_BIG, 400, H * 0.14, H * (P.lead.length ? 0.4 : 0.52));
      const letters = letterSpans(ht);
      const hero = h(`div.khd-hero${Math.random() < 0.5 ? '.popc' : ''}`, { style: { fontSize: px(hs) } }, speedLines('l'), ...letters, speedLines('r'));
      hero.style.rotate = `${f1(rnd(-5, 4))}deg`;
      spans[P.hero] = { letters, el: hero };
      el.appendChild(hero);
      if (P.tail.length) {
        el.appendChild(h('div.khd-tail', { style: { fontSize: px(H * 0.085) } },
          ...P.tail.flatMap((j, n) => { const s = smallWord(words[j].text, spans, j); return n ? [' ', s] : [s]; })));
      }
      root.appendChild(el);
      const eh = el.scrollHeight || 1;
      if (eh > H * 0.94) el.style.transform = `scale(${((H * 0.94) / eh).toFixed(3)})`;
      return { el, spans };
    },

    // words tumble down a staircase, each bigger than the last
    stairs(ln, i, P) {
      const W = box.clientWidth, H = box.clientHeight;
      const { words } = P;
      const spans = [];
      const items = words.map((w, j) => {
        const s = 1.12 ** j * (j === P.hero ? 1.12 : 1);
        const t = w.text.toUpperCase();
        return { j, t, s, w: textWidth(t, 100 * s, 400, HD_BIG) * 1.04, h: 100 * s * 0.9 };
      });
      // one word per step, each stepping right and down (the staircase leans, it doesn't sprawl)
      const step = (items.reduce((a, it) => a + it.w, 0) / Math.max(1, items.length)) * 0.2;
      let y = 0, maxX = 0;
      items.forEach((it, k) => {
        it.x = k * step; it.y = y;
        maxX = Math.max(maxX, it.x + it.w);
        if (k < items.length - 1) y += it.h * 0.8;
      });
      const maxY = y + (items.at(-1)?.h || 0);
      const k = Math.min((W * 0.78) / Math.max(1, maxX), (H * 0.8) / Math.max(1, maxY)); // keep the corners inside the circle
      const wrap = h('div.khd-stairs', { style: { width: px(maxX * k), height: px(maxY * k) } });
      const pc = Math.random() < 0.5;
      items.forEach((it) => {
        const letters = letterSpans(it.t);
        const wd = h(`div.khd-sw${(it.j === P.hero) !== pc ? '.popc' : ''}`, {
          style: { left: px(it.x * k), top: px(it.y * k), fontSize: px(100 * it.s * k), rotate: `${f1(rnd(-7, 7))}deg` },
        }, ...letters);
        spans[it.j] = { letters, el: wd };
        wrap.appendChild(wd);
      });
      const el = h('div.khd-scene', wrap);
      root.appendChild(el);
      return { el, spans };
    },

    // words circling a little planet, with swooshes
    orbit(ln, i, P) {
      const W = box.clientWidth, H = box.clientHeight;
      const { words } = P;
      const m = Math.min(W, H), cx = W / 2, cy = H / 2;
      const R = m * 0.14, rT = m * 0.34;
      const id = `khdp${++uid}`;
      const spans = [];
      const txt = words.map((w) => w.text).join(' ').toUpperCase();
      const fs = clamp(((2 * Math.PI * rT * 0.8) / Math.max(1, textWidth(txt, 100, 700, HD_SMALL))) * 100, m * 0.05, m * 0.14);
      const tsp = words.map((w, j) => { const t = svg('tspan', { class: 'wait' }, `${w.text.toUpperCase()} `); spans[j] = t; return t; });
      const swoosh = (a0, sweep) => svg('g', { class: 'khd-swoosh' }, ...[1, 1.07, 1.14].map((f) => {
        const r = rT * f + fs * 0.4, a1 = a0 + sweep;
        const p = (a) => `${f1(cx + r * Math.cos(a))},${f1(cy + r * Math.sin(a))}`;
        return svg('path', { d: `M${p(a0)} A${f1(r)},${f1(r)} 0 0,1 ${p(a1)}` });
      }));
      const ring = svg('g', { class: 'khd-spin' },
        svg('path', { id, d: `M${f1(cx - rT)},${f1(cy)} a${f1(rT)},${f1(rT)} 0 1,1 ${f1(2 * rT)},0 a${f1(rT)},${f1(rT)} 0 1,1 ${f1(-2 * rT)},0`, fill: 'none' }),
        svg('text', { class: 'khd-otext', 'font-size': f1(fs) }, svg('textPath', { href: `#${id}` }, ...tsp)),
        swoosh(-0.35, 0.5), swoosh(Math.PI - 0.35, 0.5));
      const planet = svg('g', { class: 'khd-planet boil' },
        svg('path', { d: blobPath(12, 0.12, 0.3), transform: `translate(${f1(cx - R)},${f1(cy - R)}) scale(${f1((2 * R) / 100)})` }));
      const s = svg('svg', { class: 'khd-svg', width: f1(W), height: f1(H), viewBox: `0 0 ${f1(W)} ${f1(H)}` }, planet, ring);
      const el = h('div.khd-scene.khd-orb', s);
      root.appendChild(el);
      ring.style.transformOrigin = `${f1(cx)}px ${f1(cy)}px`;
      planet.style.transformOrigin = `${f1(cx)}px ${f1(cy)}px`;
      return { el, spans };
    },
  };

  let lastLayout = '';
  const run = sceneRunner(L, (ln, i) => {
    repaint();
    const P = plan(ln);
    const n = P.words.length;
    let mode = 'lockup';
    if (n >= 3 && n <= 5 && Math.random() < 0.45) mode = 'stairs';
    else if (n >= 5 && Math.random() < 0.3) mode = 'orbit';
    if (mode === lastLayout && mode !== 'lockup') mode = 'lockup';
    lastLayout = mode;
    const { el, spans } = LAYOUTS[mode](ln, i, P);
    return { el, reveal: revealer(ln, i, spans), leave: leaveAfter(el, 650) };
  }, () => {
    const el = h('div.khd-scene.khd-gap', ...[0, 1, 2].map((k) => blobSvg('currentColor', `khd-gapblob g${k}`, 9, 0.16)));
    root.appendChild(el);
    return { el, leave: leaveAfter(el, 650) };
  });
  repaint();

  return {
    tick: run.tick,
    destroy() {
      timers.forEach(clearTimeout);
      field.classList.add('gone');
      setTimeout(() => field.remove(), 700);
    },
  };
}
