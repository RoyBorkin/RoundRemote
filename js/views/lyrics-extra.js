// Two extra lyric styles:
//   fluid – in the spirit of Lyricify / BetterLyrics / Apple Music: a flowing, blurred
//           album-art colour field; big bold lines that glide with a staggered spring
//           cascade; words fill with a soft glowing edge and lift as they're sung;
//           long held words glow letter by letter; distance-based blur.
//   typo  – kinetic typography (lyric-video style) with three variants:
//           stack  – each phrase becomes a justified poster: words fitted to the full
//                    width and stacked, slamming in; the block spins away on each new line
//           camera – words laid out in blocks on an endless canvas; a virtual camera
//                    pans, zooms and rotates 90° from block to block to follow the words
//           slam   – one word (or a small lockup) at a time, huge, with varied entrances,
//                    pulse rings and a shake on big words
import { h } from '../ui/dom.js';
import { lineAt } from '../lyrics/lrc.js';
import { clamp } from '../core/util.js';


const lineEnd = (L, i) => (L[i + 1] ? L[i + 1].t : L[i].t + 6000);
const wordEnd = (ln, j, L, i) => (ln.words[j + 1] ? ln.words[j + 1].t : Math.min(lineEnd(L, i), ln.words[j].t + 1600));
const isGap = (L, i, ms) => (i >= 0 && !L[i].text.trim()) || (i >= 0 && L[i + 1] && L[i + 1].t - L[i].t > 12000 && ms > L[i].t + 7000);
const dots = () => h('span.dots', h('i'), h('i'), h('i'));
const clean = (w) => w.replace(/[^\p{L}\p{N}'’&]/gu, '');
const SMALL = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'and', 'or', 'but', 'i', 'my', 'me', 'we', 'you', 'is', 'it', 'be', 'so', 'as', 'by', 'for', 'oh', 'if', 'up', "i'm", "it's", 'am', 'are', 'all', 'our', 'your', 'his', 'her', 'with']);
const isSmall = (w) => SMALL.has(clean(w).toLowerCase()) || clean(w).length <= 2;

// Measure text width without touching layout.
const mctx = document.createElement('canvas').getContext('2d');
function textWidth(text, px, weight = 700, family = "'Space Grotesk', Inter, system-ui, sans-serif") {
  mctx.font = `${weight} ${px}px ${family}`;
  return mctx.measureText(text).width;
}
const fitSize = (text, width, min, max) => clamp((width / Math.max(1, textWidth(text, 100))) * 100 * 0.96, min, max);

// =====================================================================================
// FLUID
// =====================================================================================
export function fluidStyle(box, lyr, api) {
  const L = lyr.lines;
  // Flowing colour field behind everything (full view, not clipped to the lyric area).
  const art = api.track?.art;
  const field = h('div.flu-field',
    ...[0, 1, 2, 3].map((k) => h(`div.flu-blob.b${k}`, { style: art ? { backgroundImage: `url("${art}")` } : {} })),
    h('div.flu-veil'));
  if (!art) field.classList.add('noart');
  api.bg.appendChild(field);

  const list = h('div.flu-list');
  const lead = h('div.flu-line.lead', dots());
  const rows = L.map((ln, i) => {
    const el = h('div.flu-line');
    const words = (ln.words || []).map((w, j) => {
      const dur = wordEnd(ln, j, L, i) - w.t;
      const emph = dur > 950 && clean(w.text).length >= 3;
      const span = h(`span.flu-w${emph ? '.emph' : ''}`);
      if (emph) [...w.text].forEach((ch) => span.appendChild(h('span.flu-ch', ch)));
      else span.textContent = w.text;
      el.append(span, ' ');
      return span;
    });
    if (!words.length) el.append(dots());
    return { el, words };
  });
  list.append(lead, ...rows.map((r) => r.el));
  const gapDots = h('div.flu-gap', dots());
  box.append(list, gapDots);

  let tops = [], cur = -99, gap = false;
  function measure() {
    const all = [lead, ...rows.map((r) => r.el)];
    let y = 0;
    tops = all.map((el) => { const t = y; y += el.offsetHeight + box.clientHeight * 0.035; return t; });
    place(cur, true);
  }
  function place(i, instant = false) {
    const all = [lead, ...rows.map((r) => r.el)];
    const k0 = Math.max(0, i + 1);
    const anchor = box.clientHeight * 0.34;
    all.forEach((el, k) => {
      const d = k - k0;
      const y = tops[k] - tops[k0] + anchor;
      el.style.transitionDelay = instant ? '0ms' : `${clamp(d, -2, 8) * 55 + 60}ms`;
      el.style.transform = `translateY(${y.toFixed(1)}px)${d === 0 ? ' scale(1)' : ' scale(.965)'}`;
      el.style.setProperty('--d', Math.min(Math.abs(d), 6));
      el.classList.toggle('on', d === 0 && !gap);
      el.classList.toggle('past', d < 0);
      el.style.visibility = Math.abs(d) > 9 ? 'hidden' : '';
    });
  }
  const ro = new ResizeObserver(() => measure());
  ro.observe(box);
  requestAnimationFrame(measure);

  return {
    tick(ms) {
      const i = lineAt(L, ms);
      const g = isGap(L, i, ms);
      if (i !== cur || g !== gap) { cur = i; gap = g; place(i); gapDots.classList.toggle('show', g || i < 0); }
      if (i < 0 || g) return;
      const ln = L[i];
      rows[i].words.forEach((span, j) => {
        const w = ln.words[j];
        const end = wordEnd(ln, j, L, i);
        const p = clamp((ms - w.t) / Math.max(150, end - w.t), 0, 1);
        span.style.setProperty('--p', `${(-12 + 124 * p).toFixed(1)}%`);
        span.style.setProperty('--lift', p.toFixed(3));
        if (span.classList.contains('emph')) {
          const chs = span.children, n = chs.length;
          for (let c = 0; c < n; c++) {
            const cp = clamp(p * n - c, 0, 1);
            chs[c].style.setProperty('--p', `${(-20 + 140 * cp).toFixed(0)}%`);
            chs[c].style.setProperty('--glow', (Math.sin(Math.PI * clamp(p * 1.1, 0, 1)) * (p < 1 ? 1 : 0)).toFixed(3));
            chs[c].style.setProperty('--lift', cp.toFixed(3));
          }
        }
      });
    },
    destroy() { ro.disconnect(); field.remove(); },
  };
}

// =====================================================================================
// KINETIC TYPOGRAPHY
// =====================================================================================
export function typoStyle(box, lyr, api, variant = 'stack') {
  if (variant === 'camera') return typoCamera(box, lyr, api);
  if (variant === 'slam') return typoSlam(box, lyr, api);
  return typoStack(box, lyr, api);
}

/** Group words into rows: short function words ride along with the next word. */
function rowsOf(words) {
  const rows = [];
  let pending = [];
  words.forEach((w, j) => {
    pending.push(j);
    const last = j === words.length - 1;
    const smallRun = pending.every((k) => isSmall(words[k].text));
    if (last || !smallRun || pending.length >= 3) { rows.push(pending); pending = []; }
  });
  if (pending.length) rows.push(pending);
  return rows;
}

// ------------------------------------------------------------------ variant: stack
function typoStack(box, lyr, api) {
  const L = lyr.lines;
  const cam = h('div.kt-cam');
  box.appendChild(h('div.kt.kt-stack', cam));
  let cur = -99, block = null, spans = [], rowEls = [], flip = 0;

  function build(i) {
    const ln = L[i];
    const W = box.clientWidth * 0.8, H = box.clientHeight;
    cam.style.width = `${W}px`;
    const b = h('div.kt-block', { style: { width: `${W}px` } });
    spans = []; rowEls = [];
    rowsOf(ln.words || []).forEach((idxs, r) => {
      const text = idxs.map((k) => ln.words[k].text).join(' ').toUpperCase();
      const size = fitSize(text, W, H * 0.075, H * 0.3);
      const styleCls = ['', '.accent', '.outline', '', '.accent'][r % 5];
      const row = h(`div.kt-row${styleCls}.e${r % 4}`, { style: { fontSize: `${size.toFixed(1)}px` } });
      idxs.forEach((k, n) => { const s = h('span.kt-w', ln.words[k].text); spans[k] = s; row.append(s); if (n < idxs.length - 1) row.append(' '); });
      b.appendChild(row); rowEls.push({ row, idxs });
    });
    if (!rowEls.length) b.append(h('div.kt-row', dots()));
    return b;
  }
  function frame(activeRow) {
    if (!block) return;
    const H = box.clientHeight;
    const bh = block.offsetHeight || 1;
    const s = clamp((H * 0.86) / bh, 0.5, 1);
    let ty;
    if (bh * s <= H * 0.92) ty = (H - bh * s) / 2;
    else {
      const r = rowEls[activeRow]?.row;
      const cy = r ? r.offsetTop + r.offsetHeight / 2 : 0;
      ty = clamp(H / 2 - cy * s, H * 0.94 - bh * s, H * 0.04);
    }
    cam.style.transform = `translate(-50%, ${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
  }
  return {
    tick(ms) {
      let i = lineAt(L, ms);
      if (isGap(L, i, ms)) i = -1 - Math.max(0, i);
      if (i !== cur) {
        cur = i;
        if (block) { const old = block; old.classList.add(flip++ % 2 ? 'out-r' : 'out-l'); setTimeout(() => old.remove(), 900); }
        block = i >= 0 ? build(i) : h('div.kt-block.gap', dots());
        cam.appendChild(block);
        frame(0);
      }
      if (i < 0) return;
      const ln = L[i];
      let active = 0;
      rowEls.forEach(({ idxs }, r) => {
        idxs.forEach((k) => {
          const s = spans[k];
          if (!s.classList.contains('in') && ms >= ln.words[k].t - 40) { s.classList.add('in'); active = r; frame(r); }
          else if (s.classList.contains('in')) active = Math.max(active, r);
        });
      });
    },
    destroy() {},
  };
}

// ------------------------------------------------------------------ variant: camera
function typoCamera(box, lyr, api) {
  const L = lyr.lines;
  const canvas = h('div.kt-canvas');
  box.appendChild(h('div.kt.kt-camera', canvas));
  let cur = -99, blk = null, turtle = { x: 0, y: 0, th: 0 }, n = 0;
  const blocks = [];

  const rot = (x, y, deg) => { const a = (deg * Math.PI) / 180; return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; };

  function build(i) {
    const ln = L[i];
    const W = box.clientWidth * 0.78, H = box.clientHeight;
    const el = h('div.kt-cblock', { style: { width: `${W}px` } });
    const base = H * 0.085;
    const spans = (ln.words || []).map((w, j) => {
      const len = clean(w.text).length;
      const big = !isSmall(w.text) && (len >= 5 || j === ln.words.length - 1);
      const size = big ? Math.min(base * 2, fitSize(w.text.toUpperCase(), W, base, base * 2.2)) : base * (isSmall(w.text) ? 0.8 : 1.15);
      const s = h(`span.kt-cw${big ? '.big' : ''}${j % 4 === 2 ? '.accent' : ''}`, { style: { fontSize: `${size.toFixed(1)}px` } }, w.text);
      el.append(s);
      return s;
    });
    if (!spans.length) el.append(dots());
    canvas.appendChild(el);
    // Place the block at the turtle, rotated to its heading, centred on the path.
    const th = turtle.th;
    const [ox, oy] = rot(W / 2, 0, th);
    const x = turtle.x - ox, y = turtle.y - oy;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${th}deg)`;
    const bh = el.offsetHeight;
    const b = { el, spans, x, y, th, W, bh, ln };
    // Advance the turtle past this block, then turn ±90° for the next one.
    const [dx, dy] = rot(0, bh + H * 0.06, th);
    turtle = { x: turtle.x + dx, y: turtle.y + dy, th: th + (n++ % 2 === 0 ? 90 : -90) };
    return b;
  }
  function look(b, j) {
    const H = box.clientHeight, Wb = box.clientWidth;
    // focus: blend of block centre and the newest word
    let fx = b.W / 2, fy = b.bh / 2;
    const s = b.spans[j];
    if (s) { fx = fx * 0.55 + (s.offsetLeft + s.offsetWidth / 2) * 0.45; fy = fy * 0.55 + (s.offsetTop + s.offsetHeight / 2) * 0.45; }
    const [rx, ry] = rot(fx, fy, b.th);
    const px = b.x + rx, py = b.y + ry;
    const fit = Math.min((Wb * 0.86) / b.W, (H * 0.8) / Math.max(1, b.bh));
    const zoom = clamp(fit * (1 + 0.1 * ((j + 1) / Math.max(1, b.spans.length))), 0.35, 1.6);
    canvas.style.transform = `translate(${(Wb / 2).toFixed(1)}px, ${(H / 2).toFixed(1)}px) scale(${zoom.toFixed(3)}) rotate(${-b.th}deg) translate(${(-px).toFixed(1)}px, ${(-py).toFixed(1)}px)`;
  }
  return {
    tick(ms) {
      let i = lineAt(L, ms);
      if (isGap(L, i, ms)) i = -1 - Math.max(0, i);
      if (i !== cur) {
        cur = i;
        blocks.forEach((b) => b.el.classList.add('old'));
        if (i >= 0) {
          blk = build(i);
          blocks.push(blk);
          while (blocks.length > 3) blocks.shift().el.remove();
          look(blk, -1);
        }
      }
      if (i < 0 || !blk) return;
      const ln = L[i];
      blk.spans.forEach((s, j) => {
        if (!s.classList.contains('in') && ms >= ln.words[j].t - 40) { s.classList.add('in'); look(blk, j); }
      });
    },
    destroy() {},
  };
}

// ------------------------------------------------------------------ variant: slam
const ENTRANCES = ['zoom', 'drop', 'spin', 'slide', 'stamp', 'rise'];
function typoSlam(box, lyr, api) {
  const L = lyr.lines;
  const rings = h('div.ks-rings');
  const stage = h('div.ks-stage');
  const strip = h('div.ks-strip');
  const root = h('div.kt.kt-slam', rings, stage, strip);
  box.appendChild(root);
  let cur = -99, groups = [], gi = -1, curEl = null, stripSpans = [], k = 0;

  function plan(ln) {
    // lockups: small words sit on top of the following big word
    const gs = [];
    let pend = [];
    (ln.words || []).forEach((w, j) => {
      pend.push(j);
      const next = ln.words[j + 1];
      if (isSmall(w.text) && next && next.t - w.t < 700 && pend.length < 3) return;
      gs.push(pend); pend = [];
    });
    if (pend.length) gs.push(pend);
    return gs;
  }
  function show(ln, g) {
    const W = box.clientWidth * 0.84, H = box.clientHeight;
    const words = g.map((j) => ln.words[j].text.toUpperCase());
    const main = words[words.length - 1];
    const top = words.slice(0, -1).join(' ');
    const bigSize = fitSize(main, W, H * 0.12, H * 0.36);
    const el = h(`div.ks-word.${ENTRANCES[k++ % ENTRANCES.length]}${clean(main).length >= 6 ? '.heavy' : ''}${k % 3 === 0 ? '.accent' : ''}`,
      top ? h('div.ks-top', { style: { fontSize: `${Math.min(bigSize * 0.42, fitSize(top, W * 0.8, H * 0.05, H * 0.12)).toFixed(1)}px` } }, top) : null,
      h('div.ks-main', { style: { fontSize: `${bigSize.toFixed(1)}px` } }, main));
    if (curEl) { const old = curEl; old.classList.add('out'); setTimeout(() => old.remove(), 600); }
    curEl = el; stage.appendChild(el);
    // pulse ring + shake for heavy words
    const ring = h('i.ks-ring'); rings.appendChild(ring); setTimeout(() => ring.remove(), 1200);
    if (el.classList.contains('heavy')) { root.classList.remove('shake'); void root.offsetWidth; root.classList.add('shake'); }
  }
  return {
    tick(ms) {
      let i = lineAt(L, ms);
      if (isGap(L, i, ms)) i = -1 - Math.max(0, i);
      if (i !== cur) {
        cur = i; gi = -1; strip.innerHTML = ''; stripSpans = [];
        if (i >= 0) {
          groups = plan(L[i]);
          stripSpans = (L[i].words || []).map((w) => { const s = h('span', w.text); strip.append(s, ' '); return s; });
        } else {
          groups = [];
          if (curEl) { curEl.classList.add('out'); const o = curEl; setTimeout(() => o.remove(), 600); }
          curEl = h('div.ks-word.rise', dots()); stage.appendChild(curEl);
        }
      }
      if (i < 0) return;
      const ln = L[i];
      while (gi + 1 < groups.length && ms >= ln.words[groups[gi + 1][0]].t - 40) { gi++; show(ln, groups[gi]); }
      stripSpans.forEach((s, j) => s.classList.toggle('lit', ms >= ln.words[j].t - 40));
    },
    destroy() {},
  };
}
