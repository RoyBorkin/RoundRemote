// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Drinking Games — shared UI: icons, the ring menu, the players ring around the table, playing cards, small controls.
import { h, clear } from '../js/ui/dom.js';
import { openPanel, curve } from '../js/ui/overlay.js';

const c = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0z`;
const rr = (x, y, w, hh, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hh - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(hh - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

/** 24×24 icon paths (fill-rule even-odd: inner shapes become holes). */
export const IC = {
  crown: 'M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5zM5.3 19.5h13.4V21H5.3z',
  never: c(12, 12, 10) + c(12, 12, 8) + 'M7 8.4L8.4 7l8.6 8.6-1.4 1.4z',
  likely: c(14, 6.5, 3.6) + 'M7.5 21c0-4.2 2.9-7.6 6.5-7.6s6.5 3.4 6.5 7.6zM1.5 8.6h4V6.4l3.4 3.4-3.4 3.4v-2.2h-4z',
  power: 'M9 3h11v13.5a3.5 3.5 0 1 1-2-3.16V7h-7v11.5a3.5 3.5 0 1 1-2-3.16z',
  bus: rr(4, 2.5, 16, 16.5, 3) + rr(6, 5, 12, 5.5, 1) + c(8, 15, 1.2) + c(16, 15, 1.2) + 'M6 19h3v2.5H6zM15 19h3v2.5h-3z',
  party: 'M2.5 21.5l4.6-12.3 7.7 7.7zM12.6 9.6l4.3-4.3 1.1 1.1-4.3 4.3zM14.6 12.5l5.2-1.7.5 1.5-5.2 1.7zM10.4 7.8l.8-5.3 1.5.2-.8 5.3z' + c(19.2, 3.4, 1.3) + c(21, 8, 1) + c(16.2, 18.6, 1.1),
  people: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  drop: 'M12 2.5s-7 7.6-7 12.3a7 7 0 0 0 14 0C19 10.1 12 2.5 12 2.5z',
  cup: 'M5 3h14l-1.6 16.2A2 2 0 0 1 15.4 21H8.6a2 2 0 0 1-2-1.8zm2.2 2l.5 5h8.6l.5-5z',
  list: 'M3 5h2.4v2.4H3zm4.4.2h13.6v2H7.4zM3 10.8h2.4v2.4H3zm4.4.2h13.6v2H7.4zM3 16.6h2.4V19H3zm4.4.2h13.6v2H7.4z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  skip: 'M6 6l8.5 6L6 18zM16 6h2v12h-2z',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M6 4.5h4v15H6zm8 0h4v15h-4z',
  stop: 'M6 6h12v12H6z',
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.98 7.98 0 0 1 12.5 10.5c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  shuffle: 'M10.59 9.17 5.41 4 4 5.41l5.17 5.17zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04z',
  link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4a5 5 0 0 0 0-10z',
  virus: c(12, 12, 5.2) + 'M11 1.8h2v4h-2zM11 18.2h2v4h-2zM1.8 11h4v2h-4zM18.2 11h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8-1.4 1.4zM15.6 17l1.4-1.4 2.8 2.8-1.4 1.4zM4.2 18.4l2.8-2.8 1.4 1.4-2.8 2.8zM15.6 7l2.8-2.8 1.4 1.4L17 8.4z',
};

export const svgIcon = (d, cls = '') => `<svg class="dki ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>`;
export const icEl = (d, cls = '') => h('span.dk-ic', { html: svgIcon(d, cls) });

/** Player colours (bright enough on dark, deep enough on light). */
export const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#64748b', '#84cc16', '#06b6d4', '#e11d48'];
export const uid = () => Math.random().toString(36).slice(2, 9);
export const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** A shuffled bag: draws every item once before repeating (no immediate repeats across refills). */
export function bag(items) {
  let left = [];
  let last = null;
  return {
    next() {
      if (!items.length) return null;
      if (!left.length) { left = shuffle(items); if (left.length > 1 && left[left.length - 1] === last) left.unshift(left.pop()); }
      last = left.pop();
      return last;
    },
    get left() { return left.length; },
    reset(newItems) { if (newItems) items = newItems; left = []; },
  };
}

/** Small segmented chooser (.chip buttons). */
export function seg(options, value, onChange, cls = '') {
  const el = h(`div.dk-seg${cls ? '.' + cls : ''}`);
  const btns = options.map((o) => {
    const opt = typeof o === 'object' ? o : { v: o, label: String(o) };
    const b = h('button.chip', { type: 'button', onclick: (e) => { e.stopPropagation(); set(opt.v); onChange(opt.v); } }, opt.label);
    b._v = opt.v;
    el.append(b);
    return b;
  });
  function set(v) { value = v; btns.forEach((b) => b.classList.toggle('on', b._v === v)); }
  set(value);
  el.set = set;
  return el;
}

/** A labelled on/off switch row. */
export function switchRow(label, on, onChange, sub = '') {
  const sw = h(`span.switch${on ? '.on' : ''}`);
  const el = h('button.dk-opt', { type: 'button', onclick: () => { on = !on; sw.classList.toggle('on', on); onChange(on); } },
    h('span.dk-opt-t', h('span.dk-opt-l', label), sub ? h('span.dk-opt-s', sub) : null), sw);
  return el;
}

/** Round icon button using our icon paths. */
export function rbtn(d, label, onClick, cls = '') {
  return h(`button.dk-rb${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button', 'aria-label': label, title: label, html: svgIcon(d), onclick: (e) => { e.stopPropagation(); onClick?.(e); } });
}

/** Text with player names highlighted: "{A} and {B}" → spans (names isolated for right-to-left text). */
export function fillNames(text, map) {
  const frag = document.createDocumentFragment();
  const re = /\{([A-Z])\}/g;
  let i = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > i) frag.append(text.slice(i, m.index));
    const p = map[m[1]];
    frag.append(p ? h('bdi.dk-name', { '--pc': p.color }, p.name) : m[0]);
    i = m.index + m[0].length;
  }
  if (i < text.length) frag.append(text.slice(i));
  return frag;
}

// ---------------------------------------------------------------- the ring menu (home)
/** A ring of big round buttons around a centre card. Tap one to open it; arrows move, Enter opens. */
export function ringMenu({ items, sel = 0, onOpen, radius = 35, size = 16.5, spread = 38, extra = null }) {
  const n = items.length;
  const el = h('div.dk-ring', { '--is': `${size}cqmin` });
  const glow = h('div.dk-ring-glow');
  const step = n > 1 ? (360 - 2 * spread) / (n - 1) : 0;
  const btns = items.map((it, i) => {
    const a = ((spread + step * i) * Math.PI) / 180;
    const b = h('button.dk-ring-item', {
      type: 'button', 'aria-label': it.name, '--c': it.color, dataset: { id: it.id },
      style: { left: `${50 + radius * Math.sin(a)}%`, top: `${50 - radius * Math.cos(a)}%`, animationDelay: `${i * 40}ms` },
      onclick: (e) => { e.stopPropagation(); select(i, true); onOpen(it, i); },
    }, h('span.dk-ring-ic', { html: svgIcon(it.icon) }), h('span.dk-ring-l', it.short || it.name));
    el.append(b);
    return b;
  });
  const badge = h('div.dk-ring-badge');
  const name = h('div.dk-ring-name');
  const blurb = h('div.dk-ring-blurb');
  const open = h('button.pill.primary.dk-ring-open', { type: 'button', onclick: (e) => { e.stopPropagation(); onOpen(items[sel], sel); } }, 'Play');
  const center = h('div.dk-ring-center', badge, name, blurb, open, extra);
  el.prepend(glow);
  el.append(center);
  function select(i, quiet) {
    sel = (i + n) % n;
    const it = items[sel];
    btns.forEach((b, j) => b.classList.toggle('on', j === sel));
    el.style.setProperty('--gc', it.color);
    badge.innerHTML = svgIcon(it.icon);
    name.textContent = it.name;
    blurb.textContent = it.blurb || '';
    if (!quiet) { center.classList.remove('swap'); void center.offsetWidth; center.classList.add('swap'); }
  }
  el.addEventListener('wheel', (e) => { e.preventDefault(); select(sel + Math.sign(e.deltaY || e.deltaX)); }, { passive: false });
  select(sel, true);
  return {
    el, select, get sel() { return sel; },
    key(e) {
      const k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown') { select(sel + 1); return true; }
      if (k === 'ArrowLeft' || k === 'ArrowUp') { select(sel - 1); return true; }
      if (k === 'Enter' || k === ' ') { onOpen(items[sel], sel); return true; }
      return false;
    },
  };
}

// ---------------------------------------------------------------- players around the table
/**
 * The players as round chips on two side arcs (top and bottom stay free for the title and buttons).
 * opts: { onTap(p, i), count(p) → number|'' , radius }
 * Returns { el, update(), set(cls, ids) }
 */
export function tableRing(players, { onTap, count, radius = 41.5, gap = 36 } = {}) {
  const el = h('div.dk-table');
  let chips = [];
  function layout() {
    clear(el);
    const n = players.length;
    const size = n > 10 ? 11 : n > 8 ? 12 : 13.2;
    el.style.setProperty('--ps', `${size}cqmin`);
    const right = Math.ceil(n / 2), left = n - right;
    // right arc: top → bottom, then left arc: bottom → top — the order runs clockwise round the table
    const pos = [];
    const arc = (k, from, to) => { for (let i = 0; i < k; i++) pos.push(k === 1 ? (from + to) / 2 : from + ((to - from) * i) / (k - 1)); };
    const span = (k) => Math.min(180 - 2 * gap, 24 * Math.max(0, k - 1));
    arc(right, 90 - span(right) / 2, 90 + span(right) / 2);
    arc(left, 270 - span(left) / 2, 270 + span(left) / 2);
    chips = players.map((p, i) => {
      const a = (pos[i] * Math.PI) / 180;
      const cnt = h('span.dk-pc-n');
      const b = h('button.dk-pchip', {
        type: 'button', '--pc': p.color, 'aria-label': p.name, dataset: { i },
        style: { left: `${50 + radius * Math.sin(a)}%`, top: `${50 - radius * Math.cos(a)}%`, animationDelay: `${i * 30}ms` },
        onclick: (e) => { e.stopPropagation(); onTap?.(p, i, b); },
      }, h('bdi.dk-pc-name', p.name), cnt);
      b._cnt = cnt;
      el.append(b);
      return b;
    });
    update();
  }
  function update() {
    chips.forEach((b, i) => {
      const v = count ? count(players[i], i) : '';
      b._cnt.textContent = v === 0 || v === '' || v == null ? '' : String(v);
      b._cnt.hidden = b._cnt.textContent === '';
    });
  }
  layout();
  return {
    el, layout, update,
    chip: (i) => chips[i],
    mark(cls, test) { chips.forEach((b, i) => b.classList.toggle(cls, !!test(players[i], i))); },
  };
}

// ---------------------------------------------------------------- playing cards
export const SUITS = ['S', 'H', 'D', 'C'];
export const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const rankValue = (r) => RANKS.indexOf(r) + 1;      // A = 1 … K = 13
export const isRed = (s) => s === 'H' || s === 'D';
export const newDeck = () => shuffle(SUITS.flatMap((s) => RANKS.map((r) => ({ r, s }))));

const SUIT_SVG = {
  H: '<path d="M12 21.3l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.5z"/>',
  D: '<path d="M12 1.5L20.2 12 12 22.5 3.8 12z"/>',
  S: '<path d="M12 1.5C9.2 5.8 3 9 3 13.6c0 2.7 2.1 4.7 4.6 4.7 1.5 0 2.8-.6 3.6-1.7-.3 2-1.2 3.6-2.7 5h7c-1.5-1.4-2.4-3-2.7-5 .8 1.1 2.1 1.7 3.6 1.7 2.5 0 4.6-2 4.6-4.7C21 9 14.8 5.8 12 1.5z"/>',
  C: '<circle cx="12" cy="6.6" r="4.3"/><circle cx="6.9" cy="13.4" r="4.3"/><circle cx="17.1" cy="13.4" r="4.3"/><path d="M10.9 11h2.2c0 4.5 1 7.7 3.5 10.5H7.4c2.5-2.8 3.5-6 3.5-10.5z"/><path d="M9.5 10.5h5v4h-5z"/>',
};
export const suitSvg = (s, cls = '') => `<svg class="dk-suit ${cls}" viewBox="0 0 24 24" aria-hidden="true">${SUIT_SVG[s]}</svg>`;

// pip positions (x, y in % of the pip area); pips in the lower half are drawn upside down
const PIPS = {
  2: [[50, 0], [50, 100]],
  3: [[50, 0], [50, 50], [50, 100]],
  4: [[0, 0], [100, 0], [0, 100], [100, 100]],
  5: [[0, 0], [100, 0], [50, 50], [0, 100], [100, 100]],
  6: [[0, 0], [100, 0], [0, 50], [100, 50], [0, 100], [100, 100]],
  7: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [0, 100], [100, 100]],
  8: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [50, 75], [0, 100], [100, 100]],
  9: [[0, 0], [100, 0], [0, 33.3], [100, 33.3], [50, 50], [0, 66.7], [100, 66.7], [0, 100], [100, 100]],
  10: [[0, 0], [100, 0], [50, 16.7], [0, 33.3], [100, 33.3], [0, 66.7], [100, 66.7], [50, 83.3], [0, 100], [100, 100]],
};
const FACE = { J: 'Jack', Q: 'Queen', K: 'King' };
const FACE_ART = {
  J: 'M12 3.5l2 3 3-1-1 4H8l-1-4 3 1z',
  Q: 'M4 8l3.5 3L12 5l4.5 6L20 8l-1.5 7.5h-13zM6 17h12v1.6H6z',
  K: 'M3 7l4.5 4L12 4l4.5 7L21 7l-2 9.5H5zM5.3 18h13.4v1.6H5.3z',
};

/** A two-sided playing card element. card = { r, s } or null (face down). Flip with .setCard(card, flip=true). */
export function cardEl(card = null, { big = false, label = '' } = {}) {
  const front = h('div.dk-card-face.dk-card-front');
  const back = h('div.dk-card-face.dk-card-back', h('div.dk-card-back-in', label ? h('span.dk-card-back-l', label) : null));
  const inner = h('div.dk-card-in', front, back);
  const el = h(`div.dk-card${big ? '.big' : ''}`, inner);
  function paint(cd) {
    clear(front);
    if (!cd) return;
    front.classList.toggle('red', isRed(cd.s));
    const corner = (cls) => h(`div.dk-cc.${cls}`, h('span.dk-cc-r', cd.r), h('span.dk-cc-s', { html: suitSvg(cd.s) }));
    front.append(corner('tl'), corner('br'));
    const mid = h('div.dk-card-mid');
    if (PIPS[cd.r]) {
      for (const [x, y] of PIPS[cd.r]) mid.append(h(`span.dk-pip${y > 50 ? '.flip' : ''}`, { style: { left: `${x}%`, top: `${y}%` }, html: suitSvg(cd.s) }));
    } else if (cd.r === 'A') {
      mid.classList.add('ace'); mid.append(h('span.dk-ace', { html: suitSvg(cd.s) }));
    } else {
      mid.classList.add('face');
      mid.append(h('div.dk-face', h('span.dk-face-art', { html: svgIcon(FACE_ART[cd.r]) }), h('span.dk-face-r', cd.r), h('span.dk-face-s', { html: suitSvg(cd.s) })));
    }
    front.append(mid);
    el.setAttribute('aria-label', `${FACE[cd.r] || (cd.r === 'A' ? 'Ace' : cd.r)} of ${SUIT_NAME[cd.s]}`);
  }
  let shown = null;
  return {
    el,
    get card() { return shown; },
    /** Show a card (flip from the back), or turn face down with null. */
    setCard(cd, animate = true) {
      shown = cd;
      if (!cd) { el.classList.remove('up'); return; }
      paint(cd);
      if (!animate) { el.classList.add('up'); return; }
      el.classList.add('instant'); el.classList.remove('up', 'pop'); void el.offsetWidth;
      el.classList.remove('instant'); void el.offsetWidth;
      el.classList.add('up', 'pop');
    },
  };
}

// ---------------------------------------------------------------- panels
/** Choose one option in a round panel. Resolves with the value or null. */
export function choose({ title, options, value, className = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openPanel({
      title, className: `dk-choose ${className}`, onClose: () => finish(null),
      build(body, panel) {
        const list = h('div.list');
        for (const o of options) {
          list.append(h(`button.row${o.v === value ? '.active' : ''}`, { type: 'button', onclick: () => { finish(o.v); panel.close(); } },
            o.color ? h('span.dk-dot', { style: { background: o.color } }) : null,
            h('div.row-text', h('bdi.row-title', o.label), o.sub ? h('div.row-sub', o.sub) : null)));
        }
        body.append(list);
        curve(list);
      },
    });
  });
}

/** Confirm in a round panel. */
export function confirm(title, msg, okLabel = 'OK') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openPanel({
      title, className: 'dk-confirm', onClose: () => finish(false),
      build(body, panel) {
        body.append(h('div.dk-confirm-m', msg), h('button.pill.primary', { type: 'button', onclick: () => { finish(true); panel.close(); } }, okLabel));
      },
    });
  });
}

export { h, clear };
