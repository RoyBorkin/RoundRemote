// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Four more Kinetic Type variants, modelled on reference lyric videos. All of them work for
// right-to-left lyrics too: every line carries dir="rtl"/"ltr", layouts use logical sides
// (start / end), and fonts fall back to Hebrew-capable faces (Suez One, Rubik, Rubik Dirt, Karantina).
//
//   pop    – "Pop" (after the "Closer" kinetic video): flat bright colour screens that change with a
//            circular wipe; one huge striped-3D hero word with the small words stacked beside it,
//            single-word slams with paint drops, and mixed-typeface stacks.
//   pastel – "Pastel" (after the "this is what falling in love feels like" video): pink / lavender /
//            yellow with rough brush lettering; chat bubbles, a highlighter swiped behind the words,
//            a repeating word wallpaper, concentric hearts and a grid of tiles with doodles.
//   comic  – "Comic" (after the Spider-Verse "Sunflower" video): tilted comic caption boxes with hard
//            black shadows on a night halftone background; big words get a burst and an RGB glitch;
//            everything moves "on twos" like the film.
//   neon   – "Neon Drive" (after the "Blinding Lights" video): synthwave — words fly toward you down
//            a neon road, a neon kaleidoscope tunnel, a striped retro sun poster, and a magnifying lens
//            gliding over the blurred lyrics.
import { h } from '../ui/dom.js';
import { clamp } from '../core/util.js';
import { dots, clean, isSmall, textWidth, rowsOf } from './lyrics-extra.js';
import { svg, rnd, pick, px, f1, wantFonts, fit, sceneRunner, leaveAfter } from './lyrics-kinetic2.js';
import { dirOf } from '../lyrics/bidi.js';

const joinWords = (ln, idxs) => idxs.map((j) => ln.words[j].text).join(' ');
/** Index of the "hero" word: the longest word that isn't a little filler word. */
function heroOf(words) {
  let best = -1, bl = 0;
  words.forEach((w, j) => { const l = clean(w.text).length; if (!isSmall(w.text) && l >= bl) { best = j; bl = l; } });
  return best < 0 ? words.length - 1 : best;
}
function field(api, cls) { const f = h(`div.${cls}`); api.bg.appendChild(f); return f; }
function dropField(f) { f.classList.add('gone'); setTimeout(() => f.remove(), 700); }
/** Picks a scene different from the last one, from the options that suit this many words. */
function chooser() {
  let last = '';
  return (opts) => { const c = opts.filter((o) => o !== last); return (last = pick(c.length ? c : opts)); };
}
/** Scale an element down (never up) so its box fits w × h. */
function fitBox(el, w, hh) {
  const bw = el.offsetWidth || 1, bh = el.offsetHeight || 1;
  const k = Math.min(1, w / bw, hh / bh);
  if (k < 1) el.style.scale = k.toFixed(3);
}
const wordSpan = (cls, text, spans, j) => { const s = h(`span.${cls}`, text); spans[j] = s; return s; };
const spaced = (items) => items.flatMap((s, n) => (n ? [' ', s] : [s]));
const reveal = (spans) => (j) => spans[j]?.classList.add('in');

// =====================================================================================
// POP
// =====================================================================================
const POP_PAL = [
  { bg: '#e8344e', ink: '#fff4dc', sh: '#f6c343' },
  { bg: '#2ed8c3', ink: '#fffaf0', sh: '#f2546f' },
  { bg: '#f2c14e', ink: '#fffaf0', sh: '#e8344e' },
  { bg: '#4ddcf0', ink: '#fffaf0', sh: '#f07c9a' },
  { bg: '#f27447', ink: '#fff6e4', sh: '#ffd05a' },
  { bg: '#f3f0ea', ink: '#3aa7e0', sh: '#f25c7a' },
  { bg: '#f05a7e', ink: '#fff3dd', sh: '#2ed8c3' },
];
const POP_FACE = {
  slab: { family: "'Alfa Slab One', 'Suez One', Georgia, serif", weight: 400 },
  thin: { family: "'Karantina', 'Oswald', 'Arial Narrow', sans-serif", weight: 300 },
  round: { family: "'League Spartan', 'Rubik', 'Arial Black', sans-serif", weight: 800 },
};
export function popStyle(box, lyr, api) {
  wantFonts(['400 50px "Alfa Slab One"', '400 50px "Suez One"', '300 50px Karantina', '800 50px "League Spartan"']);
  const f = field(api, 'kp-field');
  const root = h('div.kt.kp');
  box.appendChild(root);
  let pi = Math.floor(Math.random() * POP_PAL.length);
  const setPal = (p) => { for (const el of [f, root]) { el.style.setProperty('--bg', p.bg); el.style.setProperty('--ink', p.ink); el.style.setProperty('--sh', p.sh); } };
  setPal(POP_PAL[pi]); f.style.background = POP_PAL[pi].bg;
  function repaint() {
    pi = (pi + 1 + Math.floor(Math.random() * (POP_PAL.length - 1))) % POP_PAL.length;
    const p = POP_PAL[pi];
    const w = h('div.kp-wipe', { style: { background: p.bg }, '--x': `${Math.round(rnd(20, 80))}%`, '--y': `${Math.round(rnd(20, 80))}%` });
    f.appendChild(w);
    setPal(p);
    setTimeout(() => { f.style.background = p.bg; w.remove(); }, 650);
  }
  const W = () => box.clientWidth, H = () => box.clientHeight;
  const choose = chooser();

  function word(face, text, size, spans, j, extra = '') {
    const s = wordSpan(`kp-w.f-${face}${extra}`, text, spans, j);
    s.style.fontSize = px(size);
    return s;
  }
  const SCENES = {
    // small words stacked on either side of one huge striped hero word
    lockup(ln) {
      const words = ln.words, spans = [], hi = heroOf(words);
      const w = W(), hh = H();
      const before = words.map((_, j) => j).filter((j) => j < hi), after = words.map((_, j) => j).filter((j) => j > hi);
      const heroSize = fit(words[hi].text.toUpperCase(), w * 0.46, POP_FACE.slab.family, 400, hh * 0.14, hh * 0.5);
      const col = (idxs, side) => {
        const c = h(`div.kp-col.${side}`);
        rowsOf(idxs.map((j) => words[j])).forEach((row, r) => {
          const ids = row.map((k) => idxs[k]);
          const face = r % 2 ? 'thin' : 'round';
          const text = joinWords(ln, ids).toUpperCase();
          const size = fit(text, w * 0.26, POP_FACE[face].family, POP_FACE[face].weight, hh * 0.05, heroSize * 0.42);
          c.appendChild(h('div.kp-row', spaced(ids.map((j) => word(face, words[j].text, size, spans, j, r % 3 === 2 ? '.alt' : '')))));
        });
        return c;
      };
      const lock = h('div.kp-lock', { dir: dirOf(ln.text) },
        before.length ? col(before, 'b') : null,
        h('div.kp-hero', word('slab', words[hi].text, heroSize, spans, hi, '.ext')),
        after.length ? col(after, 'a') : null);
      const el = h('div.kp-scene', lock);
      root.appendChild(el);
      fitBox(lock, w * 0.94, hh * 0.9);
      return { el, reveal: reveal(spans), leave: leaveAfter(el, 600) };
    },
    // one word at a time, huge, with paint drops
    slam(ln) {
      const words = ln.words, spans = [];
      const el = h('div.kp-scene.kp-slam', { dir: dirOf(ln.text) });
      root.appendChild(el);
      let cur = null, k = 0;
      return {
        el,
        reveal(j) {
          const text = words[j].text;
          const face = k++ % 2 ? 'round' : 'slab';
          const size = fit(text.toUpperCase(), W() * 0.86, POP_FACE[face].family, POP_FACE[face].weight, H() * 0.14, H() * 0.55);
          const b = h(`div.kp-big.f-${face}.ext`, { style: { fontSize: px(size) }, dir: dirOf(text) }, text);
          for (let d = 0; d < 7; d++) {
            const a = rnd(0, Math.PI * 2), r = rnd(0.55, 0.9);
            b.appendChild(h('i.kp-drop', { '--dx': `${f1(Math.cos(a) * r * 100)}%`, '--dy': `${f1(Math.sin(a) * r * 100)}%`, '--s': rnd(0.06, 0.16).toFixed(2) }));
          }
          if (cur) { const o = cur; o.classList.add('gone'); setTimeout(() => o.remove(), 400); }
          cur = b; el.appendChild(b);
          spans[j] = b;
        },
        leave: leaveAfter(el, 600),
      };
    },
    // mixed-typeface rows, flush to the start side
    stack(ln) {
      const words = ln.words, spans = [];
      const w = W(), hh = H();
      const st = h('div.kp-stack', { dir: dirOf(ln.text) });
      rowsOf(words).forEach((ids, r) => {
        const face = ['round', 'thin', 'slab'][r % 3];
        const text = joinWords(ln, ids).toUpperCase();
        const size = fit(text, w * 0.62, POP_FACE[face].family, POP_FACE[face].weight, hh * 0.06, hh * 0.24);
        st.appendChild(h(`div.kp-row${r % 2 ? '.alt' : ''}`, spaced(ids.map((j) => word(face, words[j].text, size, spans, j, face === 'slab' ? '.ext' : '')))));
      });
      const el = h('div.kp-scene', st);
      root.appendChild(el);
      fitBox(st, w * 0.9, hh * 0.9);
      return { el, reveal: reveal(spans), leave: leaveAfter(el, 600) };
    },
  };
  const run = sceneRunner(lyr.lines, (ln) => {
    repaint();
    const n = (ln.words || []).length;
    const mode = choose(n <= 2 ? ['slam'] : n <= 3 ? ['slam', 'lockup'] : n <= 7 ? ['lockup', 'lockup', 'stack'] : ['stack', 'lockup']);
    return SCENES[mode](ln);
  }, () => { const el = h('div.kp-scene', dots()); root.appendChild(el); return { el, leave: leaveAfter(el, 600) }; });
  return { tick: run.tick, destroy() { dropField(f); } };
}

// =====================================================================================
// PASTEL
// =====================================================================================
const PASTEL = [
  { bg: '#f07aa6', ink: '#ffffff', acc: '#f7d64a', tile: ['#f7c1d9', '#f6d65f', '#e9528c'] },
  { bg: '#d8d2ec', ink: '#e9528c', acc: '#f7d64a', tile: ['#f07aa6', '#f6d65f', '#ffffff'] },
  { bg: '#f6d65f', ink: '#e9528c', acc: '#ffffff', tile: ['#f7c1d9', '#f07aa6', '#fbe8a0'] },
  { bg: '#f5bfd6', ink: '#e04483', acc: '#f7d64a', tile: ['#f07aa6', '#ffffff', '#f6d65f'] },
  { bg: '#a996cc', ink: '#ffffff', acc: '#f7d64a', tile: ['#f07aa6', '#d8d2ec', '#f6d65f'] },
];
const PA_BIG = "'Rubik Dirt', 'Permanent Marker', 'Karantina', cursive";
const PA_SMALL = "'Amatic SC', 'Rubik Dirt', cursive";
const heartPath = 'M50,88 C20,66 4,48 4,30 C4,15 16,5 29,5 C39,5 46,11 50,19 C54,11 61,5 71,5 C84,5 96,15 96,30 C96,48 80,66 50,88 Z';
export function pastelStyle(box, lyr, api) {
  wantFonts(['400 50px "Rubik Dirt"', '700 50px "Amatic SC"']);
  const f = field(api, 'kpa-field');
  const root = h('div.kt.kpa');
  box.appendChild(root);
  let pi = Math.floor(Math.random() * PASTEL.length), P = PASTEL[pi];
  const setPal = () => { f.style.background = P.bg; for (const el of [f, root]) { el.style.setProperty('--ink', P.ink); el.style.setProperty('--acc', P.acc); el.style.setProperty('--bg', P.bg); } };
  setPal();
  const W = () => box.clientWidth, H = () => box.clientHeight;
  const choose = chooser();
  const heart = (cls, fill) => svg('svg', { viewBox: '0 0 100 92', class: cls }, svg('path', { d: heartPath, fill }));

  const SCENES = {
    // the line arrives as chat messages, alternating sides
    chat(ln) {
      const words = ln.words, spans = [];
      const w = W(), hh = H();
      let chunks = rowsOf(words);
      while (chunks.length > 3) { const a = chunks.shift(), b = chunks.shift(); chunks.unshift([...a, ...b]); }
      if (chunks.length > 1) { const merged = []; for (let i = 0; i < chunks.length; i += 2) merged.push(chunks.slice(i, i + 2).flat()); chunks = merged.length > 1 ? merged : chunks; }
      const size = clamp(fit(ln.text, w * 1.4, PA_BIG, 400, hh * 0.05, hh * 0.1), hh * 0.05, hh * 0.1);
      const typing = h('div.kpa-bub.them.typing', dots());
      const list = h('div.kpa-chat', { dir: dirOf(ln.text), style: { fontSize: px(size), maxWidth: px(w * 0.86) } }, typing);
      const firstOf = [];
      chunks.forEach((ids, c) => {
        const b = h(`div.kpa-bub.${c % 2 ? 'me' : 'them'}`, spaced(ids.map((j) => wordSpan('kpa-w', words[j].text, spans, j))));
        firstOf[ids[0]] = b;
        list.appendChild(b);
      });
      const el = h('div.kpa-scene', list, heart('kpa-float h1', P.acc), heart('kpa-float h2', '#ffffff'));
      root.appendChild(el);
      return {
        el,
        reveal(j) { typing.remove(); firstOf[j]?.classList.add('in'); spans[j]?.classList.add('in'); },
        leave: leaveAfter(el, 600),
      };
    },
    // big rough letters with a highlighter swiped behind each word as it's sung
    highlight(ln) {
      const words = ln.words, spans = [];
      const w = W(), hh = H();
      const size = fit(ln.text.toUpperCase(), w * 0.84 * (ln.text.length > 16 ? 1.8 : 1), PA_BIG, 400, hh * 0.07, hh * 0.2);
      const txt = h('div.kpa-hl', { dir: dirOf(ln.text), style: { fontSize: px(size), maxWidth: px(w * 0.9) } }, spaced(words.map((wd, j) => wordSpan('kpa-w', wd.text, spans, j))));
      const el = h('div.kpa-scene', txt, heart('kpa-float h3', P.acc));
      root.appendChild(el);
      fitBox(txt, w * 0.92, hh * 0.9);
      return { el, reveal: reveal(spans), leave: leaveAfter(el, 600) };
    },
    // the hero word repeated as a scrolling wallpaper, the line in a band across the middle
    wall(ln) {
      const words = ln.words, spans = [], hi = heroOf(words);
      const w = W(), hh = H();
      const hero = clean(words[hi].text).toUpperCase() || words[hi].text;
      const rows = h('div.kpa-wall', { dir: dirOf(hero) });
      for (let r = 0; r < 9; r++) rows.appendChild(h(`div.kpa-wrow${r % 2 ? '.rev' : ''}`, { style: { animationDuration: `${(14 + r * 1.3).toFixed(1)}s` } }, `${hero}! `.repeat(14)));
      const size = fit(ln.text.toUpperCase(), w * 0.8 * (ln.text.length > 18 ? 1.7 : 1), PA_BIG, 400, hh * 0.06, hh * 0.15);
      const band = h('div.kpa-band', { dir: dirOf(ln.text), style: { fontSize: px(size) } }, spaced(words.map((wd, j) => wordSpan(`kpa-w${j === hi ? '.hero' : ''}`, wd.text, spans, j))));
      const el = h('div.kpa-scene.kpa-wallscene', rows, band);
      root.appendChild(el);
      return { el, reveal(j) { spans[j]?.classList.add('in'); if (j === hi) rows.classList.add('lit'); }, leave: leaveAfter(el, 600) };
    },
    // words inside pulsing concentric hearts
    hearts(ln) {
      const words = ln.words, spans = [];
      const m = Math.min(W(), H());
      const rings = h('div.kpa-hearts', ...[0, 1, 2, 3, 4].map((k) => heart(`kpa-hring r${k}`, k % 2 ? '#f7c1d9' : '#f07aa6')));
      const size = fit(ln.text.toUpperCase(), m * 0.5 * (words.length > 2 ? 1.6 : 1), PA_BIG, 400, m * 0.06, m * 0.2);
      const txt = h('div.kpa-htxt', { dir: dirOf(ln.text), style: { fontSize: px(size), maxWidth: px(m * 0.52) } }, spaced(words.map((wd, j) => wordSpan('kpa-w', wd.text, spans, j))));
      const el = h('div.kpa-scene', rings, txt);
      root.appendChild(el);
      return { el, reveal: reveal(spans), leave: leaveAfter(el, 600) };
    },
    // a 3×3 grid of pastel tiles; words land in tiles in reading order, the rest get doodles
    tiles(ln) {
      const words = ln.words, spans = [];
      const m = Math.min(W(), H()) * 0.84, n = Math.min(words.length, 6);
      const slots = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5).slice(0, n).sort((a, b) => a - b);
      // words beyond 6 share the last tile
      const groups = slots.map((_, k) => (k < n - 1 ? [k] : words.map((__, j) => j).slice(k)));
      const grid = h('div.kpa-tiles', { dir: dirOf(ln.text), style: { width: px(m), height: px(m) } });
      for (let t = 0; t < 9; t++) {
        const k = slots.indexOf(t);
        const tile = h('div.kpa-tile', { style: { background: P.tile[(t + (t >> 1)) % P.tile.length] } });
        if (k >= 0) {
          const text = joinWords(ln, groups[k]);
          const size = fit(text.toUpperCase(), m * 0.28, PA_BIG, 400, m * 0.04, m * 0.13);
          tile.appendChild(h('div.kpa-tt', { style: { fontSize: px(size) }, dir: dirOf(text) }, spaced(groups[k].map((j) => wordSpan('kpa-w', words[j].text, spans, j)))));
        } else tile.appendChild(t % 2 ? heart('kpa-doodle', '#e9528c') : h('i.kpa-eye'));
        grid.appendChild(tile);
      }
      const el = h('div.kpa-scene', grid);
      root.appendChild(el);
      return { el, reveal: reveal(spans), leave: leaveAfter(el, 600) };
    },
  };
  const run = sceneRunner(lyr.lines, (ln) => {
    pi = (pi + 1 + Math.floor(Math.random() * (PASTEL.length - 1))) % PASTEL.length; P = PASTEL[pi]; setPal();
    const n = (ln.words || []).length;
    const mode = choose(n <= 3 ? ['hearts', 'tiles', 'highlight'] : n <= 6 ? ['tiles', 'chat', 'highlight', 'wall'] : ['chat', 'highlight', 'wall']);
    return SCENES[mode](ln);
  }, () => { const el = h('div.kpa-scene', heart('kpa-gapheart', '#ffffff')); root.appendChild(el); return { el, leave: leaveAfter(el, 600) }; });
  return { tick: run.tick, destroy() { dropField(f); } };
}

// =====================================================================================
// COMIC
// =====================================================================================
const CAP = ['#ffe03a', '#39c6f4', '#ffffff', '#ff4757', '#b6f23a'];
const COMIC = "'Bangers', 'Rubik', 'Impact', sans-serif";
export function comicStyle(box, lyr, api) {
  wantFonts(['400 50px Bangers', '800 50px Rubik']);
  const f = field(api, 'kc-field');
  f.append(h('div.kc-dots'), h('div.kc-snow'));
  const root = h('div.kt.kc');
  box.appendChild(root);
  const W = () => box.clientWidth, H = () => box.clientHeight;
  const choose = chooser();
  let ci = 0;
  function panelFlash() {
    const p = h('div.kc-panel', { style: { background: pick(['#ff4757', '#39c6f4', '#ffe03a', '#7b5cff']) }, '--a': `${Math.round(rnd(-20, 20))}deg` });
    f.appendChild(p); setTimeout(() => p.remove(), 700);
    root.classList.remove('glitch'); void root.offsetWidth; root.classList.add('glitch');
  }
  const cap = (text, size, cls = '') => {
    const c = h(`div.kc-cap${cls}`, { dir: dirOf(text), style: { fontSize: px(size), background: CAP[ci++ % CAP.length], rotate: `${f1(rnd(-6, 6))}deg`, translate: `0 ${f1(rnd(-18, 18))}%` } }, text);
    return c;
  };
  const SCENES = {
    // caption boxes pop in one after another, wrapping in reading order
    captions(ln) {
      const words = ln.words, spans = [];
      const w = W(), hh = H();
      const flow = h('div.kc-flow', { dir: dirOf(ln.text), style: { maxWidth: px(w * 0.9) } });
      rowsOf(words).forEach((ids) => {
        const text = joinWords(ln, ids).toUpperCase();
        const size = fit(text, w * 0.34, COMIC, 400, hh * 0.055, hh * 0.13);
        const c = cap(text, size);
        ids.forEach((j) => { spans[j] = c; });
        flow.appendChild(c);
      });
      const el = h('div.kc-scene', flow);
      root.appendChild(el);
      fitBox(flow, w * 0.94, hh * 0.9);
      return { el, reveal: reveal(spans), leave: leaveAfter(el, 500) };
    },
    // one big glitchy word at a time over a halftone burst
    hero(ln) {
      const words = ln.words, spans = [];
      const el = h('div.kc-scene', h('div.kc-burst'));
      root.appendChild(el);
      let cur = null;
      return {
        el,
        reveal(j) {
          const text = words[j].text.toUpperCase();
          const size = fit(text, W() * 0.72, COMIC, 400, H() * 0.12, H() * 0.4);
          const c = cap(text, size, '.big');
          c.style.background = '#ff4757';
          if (cur) { const o = cur; o.classList.add('gone'); setTimeout(() => o.remove(), 300); }
          cur = c; el.appendChild(c); spans[j] = c;
          requestAnimationFrame(() => c.classList.add('in'));
          el.firstChild.classList.remove('pop'); void el.offsetWidth; el.firstChild.classList.add('pop');
        },
        leave: leaveAfter(el, 500),
      };
    },
  };
  const run = sceneRunner(lyr.lines, (ln) => {
    panelFlash();
    const n = (ln.words || []).length;
    return SCENES[choose(n <= 2 ? ['hero'] : n <= 4 ? ['hero', 'captions'] : ['captions'])](ln);
  }, () => { const el = h('div.kc-scene', dots()); root.appendChild(el); return { el, leave: leaveAfter(el, 500) }; });
  return { tick: run.tick, destroy() { dropField(f); } };
}

// =====================================================================================
// NEON DRIVE
// =====================================================================================
const NEON_THIN = "'Karantina', 'Oswald', 'Arial Narrow', sans-serif";
const NEON_BOLD = "'Rubik', 'League Spartan', 'Arial Black', sans-serif";
export function neonStyle(box, lyr, api) {
  wantFonts(['300 50px Karantina', '700 50px Karantina', 'italic 900 50px Rubik']);
  const f = field(api, 'kn-field');
  const root = h('div.kt.kn');
  box.appendChild(root);
  const W = () => box.clientWidth, H = () => box.clientHeight;
  const choose = chooser();
  const allText = lyr.lines.map((l) => l.text).filter(Boolean).join(' · ');
  // scene backgrounds live in the full-circle field and leave with their scene
  function withBg(scene, bg) {
    f.appendChild(bg);
    const leave = scene.leave;
    scene.leave = () => { bg.classList.add('gone'); setTimeout(() => bg.remove(), 700); leave(); };
    return scene;
  }
  const SCENES = {
    // words fly toward you down a neon road
    road(ln) {
      const words = ln.words, spans = [];
      const sky = h('div.kn-sky', ...Array.from({ length: 14 }, (_, i) => h('i.kn-bld', { style: { left: `${(i / 14) * 100}%`, height: `${f1(rnd(18, 70))}%`, width: `${f1(rnd(4, 8))}%` } })));
      const bg = h('div.kn-roadbg', sky, h('div.kn-ground', h('div.kn-lines')));
      const lane = h('div.kn-lane');
      const el = h('div.kn-scene', lane);
      root.appendChild(el);
      return withBg({
        el,
        reveal(j) {
          const text = words[j].text;
          const size = fit(text.toUpperCase(), W() * 0.62, NEON_BOLD, 900, H() * 0.1, H() * 0.3);
          const s = h('div.kn-rw', { dir: dirOf(text), style: { fontSize: px(size) }, '--x': `${f1(rnd(-8, 8))}%` }, text);
          lane.appendChild(s); spans[j] = s;
          setTimeout(() => s.remove(), 3200);
        },
        leave: leaveAfter(el, 600),
      }, bg);
    },
    // one unit at a time in a pulsing neon kaleidoscope
    tunnel(ln) {
      const words = ln.words, spans = [];
      const bg = h('div.kn-kal', h('div.kn-kal-a'), h('div.kn-kal-b'), h('div.kn-kal-c'));
      const units = rowsOf(words), unitOf = [];
      units.forEach((u, k) => u.forEach((j) => { unitOf[j] = k; }));
      const el = h('div.kn-scene');
      root.appendChild(el);
      let cur = null;
      return withBg({
        el,
        reveal(j) {
          if (units[unitOf[j]][0] !== j) return;
          const text = joinWords(ln, units[unitOf[j]]).toUpperCase();
          const size = fit(text, W() * 0.8, NEON_THIN, 700, H() * 0.14, H() * 0.55);
          const s = h('div.kn-flick', { dir: dirOf(text), style: { fontSize: px(size) } }, text);
          if (cur) { const o = cur; o.classList.add('gone'); setTimeout(() => o.remove(), 300); }
          cur = s; el.appendChild(s); spans[j] = s;
          bg.classList.remove('kick'); void bg.offsetWidth; bg.classList.add('kick');
        },
        leave: leaveAfter(el, 500),
      }, bg);
    },
    // thin words beside a big glowing hero word on a striped retro sun
    poster(ln) {
      const words = ln.words, spans = [], hi = heroOf(words);
      const w = W(), hh = H();
      const bg = h('div.kn-sunbg', h('div.kn-sun'), h('div.kn-city', ...Array.from({ length: 11 }, (_, i) => h('i', { style: { height: `${f1(rnd(25, 100))}%` } }))));
      const col = (idxs, side) => {
        if (!idxs.length) return null;
        const c = h(`div.kn-col.${side}`);
        rowsOf(idxs.map((j) => words[j])).forEach((row) => {
          const ids = row.map((k) => idxs[k]);
          const size = fit(joinWords(ln, ids).toUpperCase(), w * 0.22, NEON_THIN, 300, hh * 0.05, hh * 0.13);
          c.appendChild(h('div.kn-thin', { style: { fontSize: px(size) } }, spaced(ids.map((j) => wordSpan('kn-w', words[j].text, spans, j)))));
        });
        return c;
      };
      const heroSize = fit(words[hi].text.toUpperCase(), w * 0.5, NEON_BOLD, 900, hh * 0.12, hh * 0.36);
      const lock = h('div.kn-lock', { dir: dirOf(ln.text) },
        col(words.map((_, j) => j).filter((j) => j < hi), 'b'),
        h('div.kn-hero', { style: { fontSize: px(heroSize) } }, wordSpan('kn-w', words[hi].text, spans, hi)),
        col(words.map((_, j) => j).filter((j) => j > hi), 'a'));
      const el = h('div.kn-scene', lock);
      root.appendChild(el);
      fitBox(lock, w * 0.94, hh * 0.9);
      return withBg({ el, reveal: reveal(spans), leave: leaveAfter(el, 600) }, bg);
    },
    // a magnifying lens glides to each word over the blurred lyrics
    lens(ln) {
      const words = ln.words, spans = [];
      const bg = h('div.kn-paper', { dir: dirOf(ln.text) }, `${allText} · ${allText}`);
      const m = Math.min(W(), H());
      const glass = h('div.kn-glass', { style: { width: px(m * 0.56), height: px(m * 0.56) } });
      const lens = h('div.kn-lens', glass, h('i.kn-handle'));
      const el = h('div.kn-scene', lens);
      root.appendChild(el);
      return withBg({
        el,
        reveal(j) {
          const text = words[j].text;
          const size = fit(text.toUpperCase(), m * 0.4, NEON_THIN, 700, m * 0.06, m * 0.3);
          const lw = h('div.kn-lw', { dir: dirOf(text), style: { fontSize: px(size) } }, text);
          glass.replaceChildren(lw);
          fitBox(lw, m * 0.44, m * 0.34); // keep long words inside the round lens
          lens.style.translate = `${f1(rnd(-14, 14))}% ${f1(rnd(-12, 12))}%`;
          spans[j] = glass;
        },
        leave: leaveAfter(el, 600),
      }, bg);
    },
  };
  const run = sceneRunner(lyr.lines, (ln) => {
    const n = (ln.words || []).length;
    return SCENES[choose(n <= 2 ? ['tunnel', 'lens'] : n <= 4 ? ['tunnel', 'road', 'lens', 'poster'] : ['road', 'poster', 'lens'])](ln);
  }, () => { const el = h('div.kn-scene', dots()); root.appendChild(el); return { el, leave: leaveAfter(el, 500) }; });
  return { tick: run.tick, destroy() { dropField(f); } };
}
