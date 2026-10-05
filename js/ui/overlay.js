// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Toasts, circular panels, and the "curved list" effect used by every scrolling list.
import { h, iconBtn } from './dom.js';
import { frameDeg, localRect, toLocal } from '../core/util.js';

let root = null;
export function setOverlayRoot(el) { root = el; }

// ---------- toast ----------
let toastEl = null, toastTimer = null;
export function toast(msg, { ms = 2400, kind = '' } = {}) {
  if (!root) return;
  if (!toastEl) { toastEl = h('div.toast', { role: 'status' }); root.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

// ---------- panels ----------
const stack = [];
export function openPanel({ title = '', build, onClose, className = '', closeIcon = 'close' }) {
  const body = h('div.panel-body');
  const titleEl = h('div.panel-title', title);
  const cls = String(className || '').trim().split(/[\s.]+/).filter(Boolean).join('.');   // 'a b' and 'a.b' both work
  const el = h(`div.panel${cls ? '.' + cls : ''}`, { role: 'dialog', 'aria-label': title },
    titleEl, body);
  const panel = {
    el, body,
    setTitle(t) { titleEl.textContent = t; },
    close() {
      if (panel.closed) return;
      panel.closed = true;
      el.classList.remove('in');
      const i = stack.indexOf(panel); if (i >= 0) stack.splice(i, 1);
      setTimeout(() => el.remove(), 260);
      onClose?.();
      panel.onDestroy?.();
    },
  };
  const closeBtn = iconBtn(closeIcon, 'Close', () => panel.close(), 'panel-close');
  el.appendChild(closeBtn);
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  root.appendChild(el);
  stack.push(panel);
  requestAnimationFrame(() => el.classList.add('in'));
  build?.(body, panel);
  return panel;
}
export function closeAllPanels() { [...stack].forEach((p) => p.close()); }
export function topPanel() { return stack[stack.length - 1] || null; }

// ---------- curved list (watch-style: items shrink/fade toward the circle's edge) ----------
export function curve(scroller) {
  let raf = 0;
  const update = () => {
    raf = 0;
    const deg = frameDeg();   // the screen may be turned (js/core/orientation.js): measure in the app's own frame
    const r = localRect(scroller, deg);
    const mid = r.top + r.height / 2;
    const half = r.height / 2 || 1;
    for (const item of scroller.children) {
      const ir = item.getBoundingClientRect();
      const iy = deg ? toLocal(ir.left + ir.width / 2, ir.top + ir.height / 2, deg)[1] : ir.top + ir.height / 2;
      const t = Math.min(1.2, Math.abs(iy - mid) / half);
      const s = 1 - 0.16 * t * t;
      item.style.transform = `scale(${s.toFixed(3)})`;
      item.style.opacity = (1 - 0.55 * Math.min(1, t * t)).toFixed(3);
    }
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
  scroller.addEventListener('scroll', schedule, { passive: true });
  new ResizeObserver(schedule).observe(scroller);
  const mo = new MutationObserver(schedule);
  mo.observe(scroller, { childList: true });
  schedule();
  return schedule;
}

/** Standard list row with optional artwork. */
export function listRow({ title, subtitle = '', art = '', mono = '', color = '', active = false, onClick, right = null }) {
  const thumb = art
    ? h('div.row-art', { style: { backgroundImage: `url("${art}")` } })
    : h('div.row-art.placeholder', { '--c': color || 'var(--accent)' }, mono || '♪');
  return h(`button.row${active ? '.active' : ''}`, { type: 'button', onclick: onClick },
    thumb,
    h('div.row-text', h('div.row-title', title), subtitle ? h('div.row-sub', subtitle) : null),
    right);
}

export function spinner(label = 'Loading…') {
  return h('div.loading', h('div.spin'), h('div', label));
}

export function emptyNote(msg, action) {
  return h('div.empty', h('div', msg), action ? h('button.pill', { type: 'button', onclick: action.onClick }, action.label) : null);
}
