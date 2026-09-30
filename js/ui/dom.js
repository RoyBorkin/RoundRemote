// Tiny hyperscript helper: h('div.cls#id', {onclick, style:{}, attrs}, ...children)
import { icon } from './icons.js';

export function h(sel, props, ...children) {
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props); props = null;
  }
  const [, tag = 'div', rest = ''] = sel.match(/^([a-z0-9-]*)(.*)$/i) || [];
  const el = document.createElement(tag || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className += ' ' + v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k.startsWith('--')) el.style.setProperty(k, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Round icon button. */
export function iconBtn(name, label, onClick, extraClass = '') {
  const b = h(`button.ibtn${extraClass ? '.' + extraClass.split(' ').join('.') : ''}`,
    { type: 'button', 'aria-label': label, title: label, onclick: (e) => { e.stopPropagation(); onClick?.(e); } });
  b.innerHTML = icon(name);
  return b;
}

/** Position an element on a circle: angle in degrees (0 = top, clockwise), radius in % of the container. */
export function onCircle(el, angleDeg, radiusPct) {
  const a = (angleDeg * Math.PI) / 180;
  // --rad lets CSS pull buttons inward (e.g. for the XL control size).
  el.style.left = `calc(50% + ${Math.sin(a).toFixed(4)} * var(--rad, ${radiusPct}) * 1%)`;
  el.style.top = `calc(50% - ${Math.cos(a).toFixed(4)} * var(--rad, ${radiusPct}) * 1%)`;
  el.classList.add('on-circle');
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** Recognise a tap vs. a drag on an element (pointer events). */
export function onTap(el, fn, { slop = 10 } = {}) {
  let sx = 0, sy = 0, down = false;
  el.addEventListener('pointerdown', (e) => { down = true; sx = e.clientX; sy = e.clientY; });
  el.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - sx, e.clientY - sy) < slop) fn(e);
    down = false;
  });
  el.addEventListener('pointercancel', () => { down = false; });
}

/** Long-press helper. */
export function onLongPress(el, fn, ms = 550) {
  let t = null, sx = 0, sy = 0;
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; t = setTimeout(() => { t = null; fn(e); }, ms); });
  el.addEventListener('pointermove', (e) => { if (t && Math.hypot(e.clientX - sx, e.clientY - sy) > 12) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** Service monogram badge. */
// Platform logos come from Simple Icons (CC0, simpleicons.org). Each SVG is fetched once,
// its path is kept in localStorage (so the Pi shows logos offline after the first run), and
// it's drawn inline in the service's brand colour. If it can't be loaded, the initials show.
const ICON_SOURCES = [
  (slug) => `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`,
  (slug) => `https://unpkg.com/simple-icons@latest/icons/${slug}.svg`,
];
const ICON_STORE = 'rr.icons.v1';
const iconJobs = new Map();
function iconCache() { try { return JSON.parse(localStorage.getItem(ICON_STORE) || '{}'); } catch { return {}; } }
function loadIconPath(slug) {
  const cached = iconCache()[slug];
  if (cached) return Promise.resolve(cached);
  if (!iconJobs.has(slug)) {
    iconJobs.set(slug, (async () => {
      for (const src of ICON_SOURCES) {
        try {
          const r = await fetch(src(slug), { mode: 'cors' });
          if (!r.ok) continue;
          const svg = await r.text();
          const d = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]).join(' ');
          if (!d) continue;
          const c = iconCache(); c[slug] = d;
          try { localStorage.setItem(ICON_STORE, JSON.stringify(c)); } catch {}
          return d;
        } catch {}
      }
      iconJobs.delete(slug); // allow a retry later (e.g. when back online)
      return null;
    })());
  }
  return iconJobs.get(slug);
}

/** Service badge: the platform's logo in its brand colour (initials until/unless it loads). */
export function badge(svc, size = '') {
  const el = h(`div.badge${size ? '.' + size : ''}`, { '--c': svc.color, 'aria-hidden': 'true' }, h('span.badge-mono', svc.mono));
  if (svc.glyph) { el.classList.add('has-icon'); el.append(h('i.badge-glyph', { html: icon(svc.glyph) })); }
  else if (svc.icon) {
    const put = (d) => {
      if (!d) return;
      el.append(h('i.badge-ic', { html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>` }));
      el.classList.add('has-icon');
    };
    const cached = iconCache()[svc.icon];
    if (cached) put(cached); else loadIconPath(svc.icon).then(put);
  }
  return el;
}
