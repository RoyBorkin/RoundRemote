// Board Games — shared UI bits: icons, the ring menu, a round number pad, the player editor, celebration.
import { h, clear } from '../js/ui/dom.js';
import { openPanel, curve } from '../js/ui/overlay.js';
import { editText } from '../js/ui/keyboard.js';

const c = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0z`;
const rr = (x, y, w, hh, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hh - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(hh - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

/** 24×24 icon paths, drawn with fill-rule even-odd (inner shapes become holes). */
export const IC = {
  dice: rr(3, 3, 18, 18, 3.4) + c(7.8, 7.8, 1.7) + c(12, 12, 1.7) + c(16.2, 16.2, 1.7),
  coin: c(12, 12, 10) + c(12, 12, 8.2) + 'M12 6.2l1.75 3.6 3.95.55-2.86 2.77.68 3.93L12 15.2l-3.52 1.85.68-3.93L6.3 10.35l3.95-.55z',
  scores: 'M6 3h12v2h3v3a4 4 0 0 1-4 4h-.4A6 6 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A6 6 0 0 1 7.4 12H7a4 4 0 0 1-4-4V5h3zM5 7v1a2 2 0 0 0 1.2 1.85A6 6 0 0 1 6 8.5V7zm13 0v1.5a6 6 0 0 1-.2 1.35A2 2 0 0 0 19 8V7z',
  meeple: 'M12 2.2a3.2 3.2 0 0 1 3.2 3.2c0 .9-.35 1.65-.9 2.2 3 .45 6.2 1.5 7.2 2.8.6.95-.6 1.95-2.8 2.15l-2.3.25 3 6.6c.3.6 0 1.1-.65 1.1H15.3L12 16.4l-3.3 4.1H5.25c-.65 0-.95-.5-.65-1.1l3-6.6-2.3-.25C3.1 12.35 1.9 11.35 2.5 10.4c1-1.3 4.2-2.35 7.2-2.8-.55-.55-.9-1.3-.9-2.2A3.2 3.2 0 0 1 12 2.2z',
  book: 'M12 6.1C10.2 4.8 7.7 4 5 4c-1 0-2 .1-3 .4v14.4c1-.3 2-.4 3-.4 2.7 0 5.2.75 7 2 1.8-1.25 4.3-2 7-2 1 0 2 .1 3 .4V4.4C21 4.1 20 4 19 4c-1.4 0-4.7.3-7 2.1zM11 7.9v10.6c-1.8-.8-3.8-1.2-6-1.2-.35 0-.7 0-1 .05V6.05C4.35 6 4.7 6 5 6c2.2 0 4.3.65 6 1.9zm2 0C14.7 6.65 16.8 6 19 6c.3 0 .65 0 1 .05v11.3c-.3-.05-.65-.05-1-.05-2.2 0-4.2.4-6 1.2z',
  train: 'M12 2c-4 0-8 .5-8 4v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h2.2l2-2h3.6l2 2H18v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-4-4-8-4zM6 6.2h5V10H6zm7 0h5V10h-5z' + c(7.6, 15.4, 1.5) + c(16.4, 15.4, 1.5),
  hex: 'M12 1.6l9 5.2v10.4l-9 5.2-9-5.2V6.8zM12 4l-6.9 4v8l6.9 4 6.9-4V8z' + c(12, 12, 3.6),
  money: rr(1.5, 5, 21, 14, 2) + rr(3.5, 7, 17, 10, 1) + c(12, 12, 3) + c(5.8, 12, 1) + c(18.2, 12, 1),
  cards: rr(8, 2.5, 12, 18, 2) + 'M11 8.5h6v6h-6z' + 'M6.6 5.2l.4 13.4L3.3 18a1.2 1.2 0 0 1-1-1.4L4.6 6.2a1.2 1.2 0 0 1 1.4-1z',
  spinner: c(12, 12, 10.2) + c(12, 12, 8.5) + c(8.2, 8.2, 1.7) + c(15.8, 8.2, 1.7) + c(8.2, 15.8, 1.7) + c(15.8, 15.8, 1.7) + 'M11.1 13.4l4.6-6.3 1 .8-4.3 6.5z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  totem: 'M9 1.5h6v4h1.8v3.2H15V10h2.2v3.2H15v9.3H9v-9.3H6.8V10H9V8.7H7.2V5.5H9z' + c(10.6, 4.1, .8) + c(13.4, 4.1, .8) + 'M10 15.5h4v1.4h-4z',
  cup: 'M5.5 3h13l-1.6 18H7.1zM7.3 7.2h9.4l-.2 2.3H7.5z',
  unocard: rr(5, 2, 14, 20, 2.4) + c(12, 12, 4.6) + c(12, 12, 2.4),
  tile: rr(4.5, 2, 15, 20, 2.6) + 'M10.8 5.5h2.6v8.5h-2.6zM9.2 5.5h4.2v2H9.2z' + c(12, 17.5, 1.5),
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.98 7.98 0 0 1 12.5 10.5c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.9 3.9.07.14L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8z',
  people: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  list: 'M3 5h2.4v2.4H3zm4.4.2h13.6v2H7.4zM3 10.8h2.4v2.4H3zm4.4.2h13.6v2H7.4zM3 16.6h2.4V19H3zm4.4.2h13.6v2H7.4z',
  table: 'M3 3h18v18H3zM5 5v4h6V5zm8 0v4h6V5zM5 11v4h6v-4zm8 0v4h6v-4zM5 17v2h6v-2zm8 0v2h6v-2z',
  flag: 'M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z',
  eyeOff: 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z',
  speak: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  crown: 'M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5zM5.3 19.5h13.4V21H5.3z',
  shake: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v13h10V5zM1 7h2v10H1zm20 0h2v10h-2z',
  swords: 'M6.9 2 13 8.1 11.6 9.5 5.5 3.4V2zM17.1 2h1.4v1.4L9 12.9l1.4 1.4-1.4 1.4-1.4-1.4-2.8 2.8 1.4 1.4-1.4 1.4-4.2-4.2 1.4-1.4 1.4 1.4 2.8-2.8-1.4-1.4 1.4-1.4L7 11zm-.3 9.4 1.4 1.4-1.4 1.4 2.8 2.8 1.4-1.4 1.4 1.4-4.2 4.2-1.4-1.4 1.4-1.4-2.8-2.8-1.4 1.4-1.4-1.4z',
};

export const svgIcon = (d, cls = '') => `<svg class="bgi ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>`;

/** Player colours (bright enough on dark, deep enough on light). */
export const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#64748b', '#84cc16'];
export const uid = () => Math.random().toString(36).slice(2, 9);

/** Remembered player names across tools (Scores, Duel, companions). */
export function roster(app, n = 4) {
  const names = app.data('roster', []);
  return Array.from({ length: n }, (_, i) => ({ id: uid(), name: names[i] || `Player ${i + 1}`, color: COLORS[i % COLORS.length] }));
}
export function rememberNames(app, players) {
  const old = app.data('roster', []);
  const names = players.map((p) => p.name);
  for (let i = names.length; i < old.length; i++) names.push(old[i]);
  app.save('roster', names.slice(0, 10));
}

/** Small segmented chooser built from .chip buttons. */
export function seg(options, value, onChange, cls = '') {
  const el = h(`div.bg-seg${cls ? '.' + cls : ''}`);
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

/** A small − value + stepper. */
export function stepper(label, value, { min = -Infinity, max = Infinity, step = 1, fmt = (v) => String(v), onChange } = {}) {
  const val = h('span.bg-step-v');
  const set = (v) => { value = Math.max(min, Math.min(max, v)); val.textContent = fmt(value); };
  const btn = (d, t) => h('button.bg-step-b', { type: 'button', 'aria-label': t, onclick: (e) => { e.stopPropagation(); set(value + d); onChange?.(value); } }, d > 0 ? '+' : '−');
  const el = h('div.bg-step', label ? h('span.bg-step-l', label) : null, btn(-step, 'Less'), val, btn(step, 'More'));
  set(value);
  el.set = set; el.get = () => value;
  return el;
}

/** Round number pad. Resolves with a number, or null if closed. */
export function numPad({ title = 'Number', value = 0, allowNeg = true, sign = 0, hint = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let s = value ? String(Math.abs(value)) : '';
    let neg = sign ? sign < 0 : value < 0;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openPanel({
      title, className: 'bg-numpad',
      onClose: () => finish(null),
      build(body, panel) {
        const disp = h('div.bg-np-disp');
        const render = () => { disp.textContent = (neg ? '−' : (allowNeg && sign ? '+' : '')) + (s || '0'); disp.classList.toggle('fresh', fresh && !!s); };
        const ok = () => { const n = parseInt(s || '0', 10) * (neg ? -1 : 1); finish(n); panel.close(); };
        let fresh = true;    // the first digit replaces the shown value (like a calculator)
        const press = (k) => {
          if (k === '⌫') s = fresh ? '' : s.slice(0, -1);
          else if (k === '±') { if (allowNeg) neg = !neg; render(); return; }
          else if (fresh) s = k === '0' ? '' : k;
          else if (s.length < 7) s = (s === '0' ? '' : s) + k;
          fresh = false;
          render();
        };
        const keys = h('div.bg-np-keys', ['1', '2', '3', '4', '5', '6', '7', '8', '9', allowNeg ? '±' : '', '0', '⌫'].map((k) =>
          k ? h('button.bg-np-k', { type: 'button', onclick: () => press(k), dataset: { k } }, k) : h('span')));
        body.append(...[hint ? h('div.bg-np-hint', hint) : null, disp, keys].filter(Boolean), h('button.pill.primary.bg-np-ok', { type: 'button', onclick: ok }, 'OK'));
        render();
        const onKey = (e) => {
          if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); e.stopPropagation(); }
          else if (e.key === 'Backspace') { press('⌫'); e.preventDefault(); e.stopPropagation(); }
          else if (e.key === '-') { press('±'); e.preventDefault(); }
          else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ok(); }
        };
        window.addEventListener('keydown', onKey, true);
        panel.onDestroy = () => window.removeEventListener('keydown', onKey, true);
      },
    });
  });
}

/** Choose one option in a round panel (list of rows). Resolves with the value or null. */
export function choose({ title, options, value }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openPanel({
      title, className: 'bg-choose', onClose: () => finish(null),
      build(body, panel) {
        const list = h('div.list');
        for (const o of options) {
          list.append(h(`button.row${o.v === value ? '.active' : ''}`, { type: 'button', onclick: () => { finish(o.v); panel.close(); } },
            o.color ? h('span.bg-dot', { style: { background: o.color } }) : null,
            h('div.row-text', h('div.row-title', o.label), o.sub ? h('div.row-sub', o.sub) : null)));
        }
        body.append(list);
        curve(list);
      },
    });
  });
}

/** Edit a list of players (names, colours, add/remove). Calls onChange(players) after every edit. */
export function editPlayers(app, { players, min = 1, max = 8, onChange, title = 'Players', extra }) {
  openPanel({
    title, className: 'bg-players',
    build(body, panel) {
      const list = h('div.list.bg-pl-list');
      const addBtn = h('button.pill.small.bg-pl-add', { type: 'button', onclick: async () => {
        if (players.length >= max) return;
        const used = new Set(players.map((p) => p.color));
        const color = COLORS.find((x) => !used.has(x)) || COLORS[players.length % COLORS.length];
        const names = app.data('roster', []);
        players.push({ id: uid(), name: names[players.length] || `Player ${players.length + 1}`, color });
        changed();
        list.lastElementChild?.scrollIntoView({ block: 'nearest' });
      } }, '+ Add player');
      const render = () => {
        clear(list);
        players.forEach((p, i) => {
          const dot = h('button.bg-pl-color', { type: 'button', 'aria-label': 'Colour', style: { background: p.color }, onclick: () => {
            const k = (COLORS.indexOf(p.color) + 1) % COLORS.length; p.color = COLORS[k]; changed();
          } });
          const name = h('button.bg-pl-name', { type: 'button', onclick: async () => {
            const v = await app.editText({ title: 'Name', value: p.name });
            if (v) { p.name = v.slice(0, 18); changed(); }
          } }, p.name);
          const up = h('button.bg-pl-x', { type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { players.splice(i - 1, 0, players.splice(i, 1)[0]); changed(); } }, '↑');
          const del = h('button.bg-pl-x', { type: 'button', 'aria-label': 'Remove', disabled: players.length <= min, onclick: () => { players.splice(i, 1); changed(); } }, '×');
          list.append(h('div.bg-pl-row', dot, name, up, del));
        });
        addBtn.disabled = players.length >= max;
      };
      const changed = () => { render(); rememberNames(app, players); onChange?.(players); };
      body.append(...[list, extra ? extra() : null, addBtn].filter(Boolean));
      render();
    },
  });
}

/** Big centred celebration with confetti; returns a function that removes it. */
export function celebrate(host, text, color = '#f59e0b', sub = '') {
  const cv = h('canvas.bg-confetti');
  const el = h('div.bg-celebrate', { '--cc': color, onclick: () => stop() }, cv,
    h('div.bg-cel-box', h('div.bg-cel-crown', { html: svgIcon(IC.crown) }), h('div.bg-cel-t', text), sub ? h('div.bg-cel-s', sub) : null, h('div.bg-cel-tap', 'tap to close')));
  host.append(el);
  const r = host.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const g = cv.getContext('2d');
  const cols = [color, '#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#ffffff'];
  const parts = Array.from({ length: 90 }, () => ({
    x: r.width * (0.2 + Math.random() * 0.6), y: r.height * 0.45, vx: (Math.random() - 0.5) * 520, vy: -200 - Math.random() * 520,
    s: 5 + Math.random() * 7, a: Math.random() * 6, va: (Math.random() - 0.5) * 12, c: cols[(Math.random() * cols.length) | 0],
  }));
  let raf = 0, last = performance.now(), t0 = last, alive = true;
  const step = (now) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    for (const p of parts) {
      p.vy += 700 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
      g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.restore();
    }
    if (now - t0 < 3500) raf = requestAnimationFrame(step); else g.clearRect(0, 0, r.width, r.height);
  };
  raf = requestAnimationFrame(step);
  function stop() { alive = false; cancelAnimationFrame(raf); el.classList.add('out'); setTimeout(() => el.remove(), 250); }
  return stop;
}

/** Simple confirm in a round panel. */
export function confirm(title, msg, okLabel = 'OK') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openPanel({
      title, className: 'bg-confirm', onClose: () => finish(false),
      build(body, panel) {
        body.append(h('div.bg-confirm-m', msg), h('button.pill.primary', { type: 'button', onclick: () => { finish(true); panel.close(); } }, okLabel));
      },
    });
  });
}

export { h, clear, editText };

/**
 * A ring of big round buttons around a centre card (like the Apps ring). Tap a button to open it straight away;
 * the knob / arrow keys move the highlight and Enter opens it.
 * items: [{ id, name, blurb, color, icon }]
 */
export function ringMenu({ items, sel = 0, onOpen, labels = false, spread = 0, radius = 38, size = 12, label = '' }) {
  const n = items.length;
  const el = h(`div.bg-ring${labels ? '.labels' : ''}`, { '--is': `${size}cqmin` });
  const glow = h('div.bg-ring-glow');
  const a0 = spread || 180 / n;
  const step = n > 1 ? (360 - 2 * a0) / (n - 1) : 0;
  const btns = items.map((it, i) => {
    const a = ((a0 + step * i) * Math.PI) / 180;
    const b = h('button.bg-ring-item', {
      type: 'button', 'aria-label': it.name, '--c': it.color, dataset: { id: it.id },
      style: { left: `${50 + radius * Math.sin(a)}%`, top: `${50 - radius * Math.cos(a)}%`, animationDelay: `${i * 35}ms` },
      onclick: (e) => { e.stopPropagation(); select(i, true); onOpen(it, i); },
    }, h('span.bg-ring-ic', { html: svgIcon(it.icon) }), labels ? h('span.bg-ring-l', it.name) : null);
    el.append(b);
    return b;
  });
  const badge = h('div.bg-ring-badge');
  const name = h('div.bg-ring-name');
  const blurb = h('div.bg-ring-blurb');
  const open = h('button.pill.primary.bg-ring-open', { type: 'button', onclick: (e) => { e.stopPropagation(); onOpen(items[sel], sel); } }, 'Open');
  const center = h('div.bg-ring-center', label ? h('div.bg-ring-label', label) : null, badge, name, blurb, open);
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
