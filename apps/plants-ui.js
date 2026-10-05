// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Small UI pieces shared by Plants & Pets, Focus, Countdowns and Sleep Sounds: line icons (stroke SVG), a time
// stepper (hh:mm), a date stepper (day / month / year), colour chips, a confirm panel, a Home Assistant entity picker
// and the scrolling form used inside their round panels. Styles are injected once (prefix pk-).
import { h } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { openPanel, listRow, emptyNote, spinner, curve } from '../js/ui/overlay.js';
import { haReady, entities } from './plants-ha.js';

export const pad = (n) => String(n).padStart(2, '0');
export const DAY = 864e5;
export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const parseDay = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const startOfDay = (t = Date.now()) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
export const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime(); };
export const hm = (s) => { const [a, b] = String(s || '09:00').split(':').map(Number); return [a || 0, b || 0]; };
export const uid = (p = 'x') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (t, { wd = true, year = false } = {}) => { const d = new Date(t); return `${wd ? WD[d.getDay()] + ' ' : ''}${d.getDate()} ${MON[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`; };
export const fmtTime = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// ------------------------------------------------------------------ line icons (24×24, stroked)
/** An icon from stroked path data (several sub-paths in one string). */
export const lic = (d, cls = '') => `<svg class="ic pk-li ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const circ = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
export const LI = {
  // who
  plant: 'M7 14h10l-1.4 7H8.4zM6 14h12M12 14V8.5M12 11c0-3.4 2.2-5.6 6.5-5.6 0 3.4-2.2 5.6-6.5 5.6zM12 9.5C12 6.4 10 4.4 6 4.4c0 3.1 2 5.1 6 5.1z',
  cat: 'M4.5 4.5 8.5 8.6h7l4-4.1v9.3c0 3.9-3.4 6.7-7.5 6.7s-7.5-2.8-7.5-6.7zM9.3 13h.01M14.7 13h.01M12 15.4l-1 .9M12 15.4l1 .9M3 15.5l4 .5M3 18l4-.8M21 15.5l-4 .5M21 18l-4-.8',
  dog: 'M8 5.5h8c1.8 0 3 1.3 3 3v6.6c0 3.4-3.1 5.9-7 5.9s-7-2.5-7-5.9V8.5c0-1.7 1.2-3 3-3zM8 5.5 3.6 7.3l1 6.2L7.3 12M16 5.5l4.4 1.8-1 6.2-2.7-1.5M9.5 11.5h.01M14.5 11.5h.01M10.8 15.2h2.4L12 16.6z',
  fish: 'M2.8 12c2.7-4.6 8.7-6.2 13.2-2.8l4.9-3v11.6L16 14.8C11.5 18.2 5.5 16.6 2.8 12zM7.8 11h.01M11.5 9.5c.8 1.6.8 3.4 0 5',
  bird: 'M4 19.5c3.6 0 7.8-.9 10.5-3.6 2.5-2.5 2.5-6 2.5-8.4l3.5-1-3.6-1.6C16 3.5 14.6 3 13.3 3 10.5 3 8.6 5.2 8.6 8c0 2 .8 3 .8 3L4 19.5zM13.6 6.3h.01M9.4 11c2.4.4 4.2-.4 5.2-1.7M10 19.5l1.2 2M7 19.5l.6 2',
  rabbit: 'M9.4 9.6 8.5 3.6c-.2-1.4 2-1.8 2.4-.4l1.1 5.9M14.6 9.6l.9-6c.2-1.4-2-1.8-2.4-.4L12 9.1M12 9.4c3.6 0 6 2.3 6 5.6 0 3.4-2.7 6-6 6s-6-2.6-6-6c0-3.3 2.4-5.6 6-5.6zM9.8 14h.01M14.2 14h.01M11 17h2',
  reptile: 'M4 15.5c0-4.2 3.6-7.5 8-7.5s8 3.3 8 7.5zM2.5 15.5h19M20 12.5h1.6c.8 0 1.4.6 1.4 1.4s-.6 1.6-1.4 1.6M6.5 15.5l-1.2 3M17.5 15.5l1.2 3M9 8.6l3 6.9 3-6.9M5.5 12h13',
  other: `${circ(6, 9.5, 1.8)}${circ(10, 6, 1.8)}${circ(14, 6, 1.8)}${circ(18, 9.5, 1.8)}M12 11.5c2.8 0 5.5 3.7 5.5 6.2 0 2.4-2.3 2.6-3.6 2-1-.5-1.3-.6-1.9-.6s-.9.1-1.9.6c-1.3.6-3.6.4-3.6-2 0-2.5 2.7-6.2 5.5-6.2z`,
  // tasks
  water: 'M12 3c3.2 4.2 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.8-6.8 6-11zM9.2 14.5a2.8 2.8 0 0 0 2.8 2.8',
  fert: 'M7 21h10V10.5L15 7H9l-2 3.5zM9 7V3.5h6V7M12 12.5v5M9.5 15h5',
  mist: 'M7.5 10h6v11h-6zM9 10V6.5h3.5l2.5 1.2M15 6.6l1-.4M18.5 4.5h.01M19.5 7.5h.01M18.5 10.5h.01',
  repot: 'M5 10.5h14l-2 10H7zM4 10.5h16M12 10.5V6M12 8c0-2.2 1.5-3.6 4-3.6 0 2.2-1.5 3.6-4 3.6z',
  feed: 'M3 11.5h18c0 4.4-4 7.5-9 7.5s-9-3.1-9-7.5zM6 21h12M8.5 8.5c.8-1.6 2.6-1.6 3.4 0M12.1 7.5c.8-1.6 2.6-1.6 3.4 0',
  walk: `${circ(13, 4.4, 1.8)}M12.4 8 10.8 13.6M10.8 13.6 8.2 20.8M10.8 13.6l3.1 3.1.6 4.1M12.1 9.4 8.6 12M12.1 9.4l3.4 2.8 3 .6M18.5 12.8l1.5 8`,
  litter: 'M3 12h18l-2 8H5zM7.5 12 9 8.5M16.5 12 15 8.5M12 8V3.5M10 16h.01M14 16.5h.01',
  tank: 'M4 5.5h16v15H4zM4 9.5h16M8.5 15c1.6-2.2 4.4-2.2 6 0-1.6 2.2-4.4 2.2-6 0zM14.5 15l1.8-1.3v2.6z',
  med: 'M10.4 4.6a4.9 4.9 0 0 1 7 7l-5.8 5.8a4.9 4.9 0 0 1-7-7zM7.5 7.5l6.9 6.9',
  vet: `${circ(12, 12, 9)}M12 7.5v9M7.5 12h9`,
  vacc: 'M17.5 3l3.5 3.5M19.2 4.8 15.8 8.2M15.8 8.2l-8.7 8.7-3.5 1 1-3.5 8.7-8.7zM10.5 8.6l4.9 4.9M8.4 12.3l1.8 1.8M3 21l1.6-1.6',
  groom: 'M4 8.5h16v4.5H4zM6.5 13v6.5M9.5 13v6.5M12.5 13v6.5M15.5 13v6.5M18 13v4',
  flea: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.8 12.2l2.2 2.2 4.2-4.4',
  clean: 'M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M5.3 18.7l2.8-2.8M15.9 8.1l2.8-2.8',
  task: `${circ(12, 12, 9)}M8 12.3l2.8 2.8L16.2 9.5`,
  // misc
  check: 'M5 12.5l4.5 4.5L19 7.5',
  people: `${circ(9, 8, 3.2)}M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6M16 5.2a3 3 0 0 1 0 5.6M17.5 14.3c2.2.6 3.5 2.6 3.5 5.7`,
  history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3 3.5v4h4M12 7.5V12l3 2',
  week: 'M4 5h16v15H4zM4 9.5h16M8.5 3v4M15.5 3v4M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2',
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  gear: `${circ(12, 12, 3)}M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z`,
  snooze: `${circ(12, 13, 8)}M12 9v4l2.5 1.5M4 4.5 6.5 2.5M20 4.5l-2.5-2`,
  flame: 'M12 21.5c-3.9 0-6.5-2.7-6.5-6.2 0-4.6 4.3-6.6 4.3-11.3 2.6 1.4 4.3 4.2 4.3 6.6.9-.5 1.6-1.6 1.7-2.8 1.7 1.6 2.7 4.3 2.7 6.9 0 3.9-2.7 6.8-6.5 6.8zM12 21.5c-1.6 0-2.7-1.1-2.7-2.6 0-1.9 2.7-3.2 2.7-4.9 1.6 1 2.7 2.8 2.7 4.9 0 1.5-1.1 2.6-2.7 2.6z',
  sensor: 'M12 3v10.5M8.5 10.5c-1.5 1-2.5 2.7-2.5 4.6a6 6 0 0 0 12 0c0-1.9-1-3.6-2.5-4.6M9 3h6',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18M15.5 9h.01',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
};
export const ico = (name, cls = '') => lic(LI[name] || LI.task, cls);

// ------------------------------------------------------------------ styles
const CSS = `
.pk-li { fill: none !important; }
.pk-panel .panel-body { top: 17%; bottom: 15%; left: 10%; right: 10%; }
.pk-form { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; scrollbar-width: none; display: flex; flex-direction: column; align-items: center;
  gap: 1.8cqmin; padding: 3cqmin 3cqmin 11cqmin; mask-image: linear-gradient(transparent, #000 5%, #000 86%, transparent); -webkit-mask-image: linear-gradient(transparent, #000 5%, #000 86%, transparent); }
.pk-form::-webkit-scrollbar { display: none; }
.pk-form > * { flex: none; }
.pk-form.center { justify-content: center; }
.pk-lbl { font-size: 2.1cqmin; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; color: var(--dim); margin-top: 1.6cqmin; text-align: center; }
.pk-note { font-size: 2.5cqmin; color: var(--muted); text-align: center; line-height: 1.45; max-width: 92%; }
.pk-btns { display: flex; gap: 1.6cqmin; justify-content: center; margin-top: 1.6cqmin; flex-wrap: wrap; }
.pk-btns .pill { margin: 0; }
.pk-panel .chip.on, .pk-scope .chip.on { background: var(--ac); color: #fff; border-color: transparent; }
.pk-panel .pill.primary, .pk-scope .pill.primary { --c: var(--ac); color: #fff; }
.chip.pk-mini { font-size: 2.3cqmin; padding: 1.1cqmin 2.2cqmin; }
.pk-chipi { display: inline-flex; align-items: center; gap: .9cqmin; }
.pk-chipi .ic { font-size: 3cqmin; }
.pk-tset { display: flex; align-items: center; gap: 1.2cqmin; }
.pk-tunit { display: flex; flex-direction: column; align-items: center; gap: .6cqmin; }
.pk-tunit b { font-family: var(--display); font-size: 8cqmin; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 1.3em; text-align: center; line-height: 1.05; }
.pk-tunit.sm b { font-size: 5.4cqmin; min-width: 2.2em; }
.pk-tunit .ibtn { width: 7cqmin; height: 7cqmin; font-size: 3.6cqmin; }
.pk-up .ic { rotate: -90deg; } .pk-down .ic { rotate: 90deg; }
.pk-colon { font-family: var(--display); font-size: 7cqmin; font-weight: 700; color: var(--dim); }
.pk-dsub { font-size: 2.4cqmin; color: var(--muted); font-weight: 700; }
.pk-colors { display: flex; flex-wrap: wrap; justify-content: center; gap: 1.2cqmin; max-width: 92%; }
.pk-col { width: 6.4cqmin; height: 6.4cqmin; border-radius: 50%; background: var(--c); border: .5cqmin solid transparent; box-shadow: 0 0 0 1px var(--line) inset; transition: transform .18s var(--spring); }
.pk-col.on { border-color: var(--fg); transform: scale(1.12); }
.pk-icons { display: flex; flex-wrap: wrap; justify-content: center; gap: 1.2cqmin; max-width: 96%; }
.pk-icn { width: 8.6cqmin; height: 8.6cqmin; border-radius: 50%; display: grid; place-items: center; font-size: 4.4cqmin; background: var(--glass); border: 1px solid var(--line); color: var(--muted); }
.pk-icn.on { background: var(--ac); color: #fff; border-color: transparent; }
.pk-list { padding: 4% 0 14%; }
.pk-ent { display: flex; align-items: center; gap: 2cqmin; width: 100%; padding: 1.4cqmin 2.4cqmin; border-radius: 3cqmin; text-align: left; }
.pk-ent:active { background: var(--glass); }
.pk-ent b { flex: 1; min-width: 0; font-size: 2.8cqmin; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pk-ent small { font-size: 2.2cqmin; color: var(--muted); white-space: nowrap; }
.pk-ent i { width: 4.4cqmin; height: 4.4cqmin; border-radius: 50%; border: .35cqmin solid var(--line); display: grid; place-items: center; font-size: 2.8cqmin; flex: none; color: transparent; }
.pk-ent.on i { background: var(--ac); border-color: transparent; color: #fff; }
.pk-row { display: flex; align-items: center; justify-content: space-between; gap: 2cqmin; width: 92%; padding: 1.2cqmin 2.4cqmin; border-radius: 3cqmin; background: var(--glass); border: 1px solid var(--line); }
.pk-row > span { font-size: 2.7cqmin; font-weight: 700; text-align: left; }
.pk-row > span small { display: block; font-size: 2.1cqmin; font-weight: 600; color: var(--muted); margin-top: .3cqmin; }
.pk-num { display: flex; align-items: center; gap: 1.4cqmin; }
.pk-num b { font-family: var(--display); font-size: 5cqmin; min-width: 2.2em; text-align: center; font-variant-numeric: tabular-nums; }
.pk-num .ibtn { width: 7cqmin; height: 7cqmin; font-size: 3.6cqmin; }
`;
export function ensureStyle() {
  if (document.getElementById('pk-style')) return;
  document.head.append(h('style#pk-style', CSS));
}

/** openPanel with the shared look and the app colour (`--ac`). */
export function panel(o, color) {
  ensureStyle();
  const p = openPanel({ ...o, className: `pk-panel ${o.className || ''}` });
  if (color) p.el.style.setProperty('--ac', color);
  return p;
}
export const form = (...kids) => h('div.pk-form', ...kids);
export const lbl = (t) => h('div.pk-lbl', t);
export const note = (t) => h('div.pk-note', t);
export function chipRow(items, value, set, { multi = false, cls = '' } = {}) {
  return h(`div.chips${multi ? '.multi' : ''}`, items.map((it) => {
    const on = multi ? (value || []).includes(it.id) : it.id === value;
    return h(`button.chip${cls ? '.' + cls : ''}${on ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(on), onclick: () => set(it.id) },
      it.icon ? h('span.pk-chipi', h('i', { html: it.icon }), it.name) : it.name);
  }));
}
/** A yes / no question. */
export function confirm({ title, msg, yes = 'Delete', no = 'Keep', danger = true, onYes, color }) {
  panel({
    title,
    build(body, p) {
      body.append(h('div.pk-form.center', note(msg), h('div.pk-btns',
        h(`button.pill${danger ? '.danger' : '.primary'}`, { type: 'button', onclick: () => { p.close(); onYes(); } }, yes),
        h('button.pill', { type: 'button', onclick: () => p.close() }, no))));
    },
  }, color);
}

// ------------------------------------------------------------------ steppers
const stepBtn = (dir, label, fn) => h(`button.ibtn.small.pk-${dir}`, { type: 'button', 'aria-label': label, onclick: fn, html: icon('chevron') });
/** hh:mm stepper. get() → 'HH:MM', set('HH:MM'). */
export function timeStepper(get, set, { step = 5 } = {}) {
  const H = h('b'), M = h('b');
  const draw = () => { const [a, b] = hm(get()); H.textContent = pad(a); M.textContent = pad(b); };
  const bump = (u, n) => {
    let [a, b] = hm(get());
    if (u === 'h') a = (a + n + 24) % 24; else { b = Math.round((b + n) / Math.abs(n)) * Math.abs(n); if (b >= 60) b -= 60; if (b < 0) b += 60; }
    set(`${pad(a)}:${pad(b)}`); draw();
  };
  const unit = (u, el) => h('div.pk-tunit', stepBtn('up', u === 'h' ? 'Hour up' : 'Minutes up', () => bump(u, u === 'h' ? 1 : step)), el,
    stepBtn('down', u === 'h' ? 'Hour down' : 'Minutes down', () => bump(u, u === 'h' ? -1 : -step)));
  draw();
  const el = h('div.pk-tset', unit('h', H), h('div.pk-colon', ':'), unit('m', M));
  el.redraw = draw;
  return el;
}
/** Day / month / year stepper. get() → 'YYYY-MM-DD', set(…). Shows the weekday under it. */
export function dateStepper(get, set, { years = true, minYear = 1900, maxYear = 2100 } = {}) {
  const D = h('b'), Mo = h('b'), Y = h('b'), sub = h('div.pk-dsub');
  const draw = () => {
    const d = parseDay(get());
    D.textContent = String(d.getDate()); Mo.textContent = MON[d.getMonth()]; Y.textContent = String(d.getFullYear());
    sub.textContent = d.toLocaleDateString(undefined, { weekday: 'long' });
  };
  const bump = (u, n) => {
    const d = parseDay(get());
    let y = d.getFullYear(), m = d.getMonth(), dd = d.getDate();
    if (u === 'd') { const x = new Date(y, m, dd + n); y = x.getFullYear(); m = x.getMonth(); dd = x.getDate(); }
    else if (u === 'm') { m += n; if (m > 11) { m = 0; y++; } if (m < 0) { m = 11; y--; } }
    else y += n;
    y = Math.max(minYear, Math.min(maxYear, y));
    dd = Math.min(dd, new Date(y, m + 1, 0).getDate());
    set(dayKey(new Date(y, m, dd))); draw();
  };
  const unit = (u, el, name) => h('div.pk-tunit.sm', stepBtn('up', `${name} up`, () => bump(u, 1)), el, stepBtn('down', `${name} down`, () => bump(u, -1)));
  draw();
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.8cqmin' } },
    h('div.pk-tset', unit('d', D, 'Day'), unit('m', Mo, 'Month'), years ? unit('y', Y, 'Year') : null), sub);
  el.redraw = draw;
  return el;
}
/** − n + with a label: get() → number. */
export function numStepper(get, set, { min = 1, max = 999, step = 1, fmt = (n) => String(n) } = {}) {
  const b = h('b');
  const draw = () => { b.textContent = fmt(get()); };
  const bump = (n) => { set(Math.max(min, Math.min(max, get() + n))); draw(); };
  draw();
  return h('div.pk-num', h('button.ibtn.small', { type: 'button', 'aria-label': 'Less', onclick: () => bump(-step), html: icon('minus') }), b,
    h('button.ibtn.small', { type: 'button', 'aria-label': 'More', onclick: () => bump(step), html: icon('plus') }));
}
export const COLORS = ['#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#f59e0b', '#84cc16', '#a16207', '#64748b'];
export function colorChips(get, set, colors = COLORS) {
  const el = h('div.pk-colors');
  const draw = () => el.replaceChildren(...colors.map((c) => h(`button.pk-col${get() === c ? '.on' : ''}`, { type: 'button', '--c': c, 'aria-label': `Colour ${c}`, onclick: () => { set(c); draw(); } })));
  draw();
  return el;
}

// ------------------------------------------------------------------ Home Assistant entity picker
/**
 * Pick Home Assistant entities. domains: ['light'] | ['sensor'] …; multi: several. Resolves to an array of ids
 * (single: [id]) or null when closed without choosing.
 */
export function pickEntities({ title = 'Choose', domains = ['light'], multi = false, selected = [], filter = null, color, hint = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const sel = new Set(selected || []);
    panel({
      title,
      onClose: () => { if (!done) resolve(null); },
      build(body, p) {
        const list = h('div.list.pk-list');
        body.append(list);
        curve(list);
        if (!haReady()) { list.append(emptyNote('Set up Home Assistant first (Home → Smart Home → Settings).')); return; }
        list.append(spinner('Loading…'));
        entities(domains, filter).then((ents) => {
          if (p.closed) return;
          if (!ents.length) { list.replaceChildren(emptyNote(hint || 'Nothing suitable found in Home Assistant.')); return; }
          const rows = () => list.replaceChildren(...[...ents.map((e) => h(`button.pk-ent${sel.has(e.id) ? '.on' : ''}`, { type: 'button', onclick: () => {
            if (!multi) { done = true; resolve([e.id]); p.close(); return; }
            if (sel.has(e.id)) sel.delete(e.id); else sel.add(e.id);
            rows();
          } }, h('i', { html: lic(LI.check) }), h('b', { dir: 'auto' }, e.name), h('small', e.unit ? `${e.state} ${e.unit}` : e.state))),
          multi ? h('div.pk-btns', h('button.pill.primary', { type: 'button', onclick: () => { done = true; resolve([...sel]); p.close(); } }, 'Done'),
            sel.size ? h('button.pill', { type: 'button', onclick: () => { done = true; resolve([]); p.close(); } }, 'None') : null) : null].filter(Boolean));
          rows();
        }).catch((e) => list.replaceChildren(emptyNote(`Couldn’t reach Home Assistant: ${e?.message || e}`)));
      },
    }, color);
  });
}
export { listRow };
