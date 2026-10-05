// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Library views for Movies & TV — the same items drawn nine ways:
//   list · posters · grid · flow (iPod / Mac Cover Flow) · rings (one full-screen ring at a time)
//   watch (Apple Watch honeycomb) · dvd (DVD cases) · disc (discs) · dvddisc (case with the disc sliding out)
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { curve, spinner, emptyNote } from '../ui/overlay.js';
import { clamp, toLocal } from '../core/util.js';
import { store } from '../core/store.js';

export const LIB_VIEWS = [
  { id: 'list', name: 'List' }, { id: 'posters', name: 'Posters' }, { id: 'grid', name: 'Grid' }, { id: 'flow', name: 'Cover Flow' },
  { id: 'rings', name: 'Rings' }, { id: 'watch', name: 'Watch' }, { id: 'dvd', name: 'DVD' }, { id: 'disc', name: 'Disc' }, { id: 'dvddisc', name: 'DVD + disc' },
];
const TYPE_ICON = { movie: 'film', show: 'tv', season: 'tv', episode: 'play', collection: 'stack', folder: 'library' };
const spoiler = (e) => e.type === 'episode' && !e.watched && store.get('mediaNoSpoilers');

/** A picture box (poster / still), with a placeholder icon when there's no image. */
function pic(e, cls) {
  return h(`div.${cls}${e.wide ? '.wide' : ''}${spoiler(e) ? '.spoiler' : ''}${e.poster ? '' : '.noimg'}${e.type === 'folder' ? '.folderpic' : ''}`,
    e.poster ? { style: { backgroundImage: `url("${e.poster}")` } } : null,
    e.poster ? null : h('span', { html: icon(e.icon || TYPE_ICON[e.type] || 'film') }),
    !e.poster && e.type === 'folder' ? h('b.folder-name', e.title) : null);
}
function marks(e) {
  return [
    e.progress > 0.02 && !e.watched ? h('i.mv-prog', h('b', { style: { width: `${Math.round(e.progress * 100)}%` } })) : null,
    e.watched ? h('span.mv-seen', { html: icon('check') }) : null,
  ];
}
const caption = (e, cls = 'mv-cap') => h(`div.${cls}`, h('div.mv-t', e.title || ''), e.subtitle ? h('div.mv-s', e.subtitle) : null);

/**
 * @param {string} view  one of LIB_VIEWS
 * @param {{ onPick:Function, onNeedMore?:Function, row?:Function }} opts  row = the list-view row builder
 * @returns {{ el, add(items), setMore(bool), loading(bool), error(msg, retry), destroy() }}
 */
export function createItemsView(view, { onPick, onNeedMore, row }) {
  const tap = (e) => (ev) => { ev.stopPropagation(); onPick(e); };
  const all = [];
  let more = false, moreBtn = null, cleanup = () => {};

  // ---------- scrolling views built from cells ----------
  const cellViews = {
    list: { cls: 'list.mlib-list', cell: (e) => row(e, onPick) },
    posters: { cls: 'list.mv-posters', cell: (e) => h(`button.mv-poster${e.wide ? '.wide' : ''}`, { type: 'button', onclick: tap(e) }, h('div.mv-frame', pic(e, 'mvp-img'), ...marks(e)), caption(e)) },
    grid: { cls: 'list.mv-grid', cell: (e) => h(`button.mv-cell${e.wide ? '.wide' : ''}`, { type: 'button', onclick: tap(e) }, h('div.mv-frame', pic(e, 'mvc-img'), ...marks(e)), caption(e)) },
    dvd: { cls: 'list.mv-dvd', cell: (e) => h('button.mv-dvdcell', { type: 'button', onclick: tap(e) }, dvdCase(e), caption(e)) },
    disc: { cls: 'list.mv-disc', cell: (e) => h('button.mv-disccell', { type: 'button', onclick: tap(e) }, disc(e), caption(e)) },
    dvddisc: { cls: 'list.mv-dvddisc', cell: (e) => h('button.mv-ddcell', { type: 'button', onclick: tap(e) }, h('div.dd', disc(e, 'dd-disc'), dvdCase(e, 'dd-case')), caption(e)) },
  };
  if (cellViews[view] || !['flow', 'rings', 'watch'].includes(view)) {
    const cv = cellViews[view] || cellViews.list;
    const el = h(`div.${cv.cls}`);
    if (view === 'list' || view === 'posters') curve(el);
    const api = {
      el,
      add(items) {
        moreBtn?.remove();
        for (const e of items) {
          all.push(e);
          // folders (Recently added, Collections…) become a row of chips at the top in the picture views
          if (e.type === 'folder' && view !== 'list') {
            let row = el.querySelector(':scope > .mv-folders');
            if (!row) { row = h('div.mv-folders'); el.prepend(row); }
            row.append(h('button.chip', { type: 'button', onclick: tap(e) }, h('span', { html: icon(e.icon || 'library') }), e.title));
            continue;
          }
          el.append(cv.cell(e));
        }
        if (more) el.append(moreBtn);
      },
      setMore(m) { more = m; moreBtn?.remove(); if (m) { moreBtn = moreBtn || h('button.pill.mlib-more', { type: 'button', onclick: (ev) => { ev.stopPropagation(); onNeedMore?.(); } }, 'Load more'); el.append(moreBtn); } },
      loading(on) { el.querySelector(':scope > .loading')?.remove(); if (on) el.append(spinner()); },
      error(msg, retry) { el.append(emptyNote(msg, retry ? { label: 'Retry', onClick: retry } : null)); },
      empty(msg) { el.append(emptyNote(msg)); },
      destroy() {},
    };
    return api;
  }

  // ---------- Cover Flow ----------
  if (view === 'flow') {
    const stage = h('div.mvf-stage');
    const cap = h('div.mvf-cap');
    const el = h('div.mv-flow', stage, cap);
    let pos = 0, target = 0, drag = null, raf = 0;
    const cells = [];
    const W = () => el.clientWidth || 500;
    const layout = (animate = true) => {
      el.classList.toggle('dragging', !animate);
      cells.forEach((c, i) => {
        const o = i - pos, a = Math.abs(o);
        if (a > 7) { c.style.visibility = 'hidden'; return; }
        c.style.visibility = '';
        const side = Math.sign(o);
        const x = a < 1 ? o * 26 : side * (26 + (a - 1) * 9);
        const rot = a < 1 ? -o * 62 : -side * 62;
        const z = a < 1 ? -a * 14 : -14 - (a - 1) * 2;
        c.style.transform = `translate(-50%, -50%) translateX(${x.toFixed(2)}cqmin) translateZ(${z.toFixed(2)}cqmin) rotateY(${rot.toFixed(1)}deg)`;
        c.style.zIndex = String(100 - Math.round(a * 10));
        c.style.opacity = String(clamp(1.25 - a * 0.16, 0, 1));
      });
      const e = all[clamp(Math.round(pos), 0, all.length - 1)];
      if (e && cap.dataset.id !== String(e.id)) { cap.dataset.id = String(e.id); clear(cap).append(caption(e, 'mvf-text')); }
      if (more && pos > all.length - 5) onNeedMore?.();
    };
    const go = (to) => { target = clamp(Math.round(to), 0, Math.max(0, all.length - 1)); pos = target; layout(true); };
    el.addEventListener('pointerdown', (e) => { drag = { x: toLocal(e.clientX, e.clientY)[0], start: pos, moved: false, id: e.pointerId }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = toLocal(e.clientX, e.clientY)[0] - drag.x;   // the screen may be turned (js/core/orientation.js)
      if (Math.abs(dx) > 6) drag.moved = true;
      pos = clamp(drag.start - dx / (W() * 0.22), -0.4, all.length - 0.6);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(() => layout(false));
    });
    el.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.moved) {
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('.mvf-item');
        const i = hit ? cells.indexOf(hit) : -1;
        if (i >= 0) { if (i === Math.round(pos)) onPick(all[i]); else go(i); }
        return;
      }
      go(pos);
    });
    el.addEventListener('wheel', (e) => { e.preventDefault(); go(pos + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1)); }, { passive: false });
    return {
      el,
      add(items) { for (const e of items) { all.push(e); const c = h(`div.mvf-item${e.wide ? '.wide' : ''}`, pic(e, 'mvf-img'), ...marks(e)); cells.push(c); stage.append(c); } layout(true); },
      setMore(m) { more = m; },
      loading(on) { el.querySelector(':scope > .loading')?.remove(); if (on) el.append(spinner()); },
      error(msg, retry) { el.append(emptyNote(msg, retry ? { label: 'Retry', onClick: retry } : null)); },
      empty(msg) { el.append(emptyNote(msg)); },
      destroy() { cancelAnimationFrame(raf); },
    };
  }

  // ---------- full-screen rings: one item at a time, swipe sideways ----------
  if (view === 'rings') {
    const el = h('div.mv-rings');
    const dots = h('div.mvr-count');
    const wrap = h('div.mv-rings-wrap', el, dots);
    const R = 46, CIRC = 2 * Math.PI * R;
    const page = (e) => {
      const p = e.watched ? 1 : e.progress || 0;
      const ring = `<svg viewBox="0 0 100 100" class="mvr-svg"><circle cx="50" cy="50" r="${R}" class="mvr-track"/><circle cx="50" cy="50" r="${R}" class="mvr-fill" stroke-dasharray="${(CIRC * p).toFixed(1)} ${CIRC.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>`;
      return h('div.mvr-page', h('button.mvr-ring', { type: 'button', 'aria-label': e.title || e.name || null, onclick: tap(e), html: ring }, pic(e, 'mvr-img')), caption(e, 'mvr-cap'));
    };
    const onScroll = () => {
      const i = Math.round(el.scrollLeft / (el.clientWidth || 1));
      dots.textContent = all.length ? `${i + 1} / ${all.length}${more ? '+' : ''}` : '';
      if (more && i > all.length - 4) onNeedMore?.();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return {
      el: wrap,
      add(items) { for (const e of items) { all.push(e); el.append(page(e)); } onScroll(); },
      setMore(m) { more = m; onScroll(); },
      loading(on) { wrap.querySelector(':scope > .loading')?.remove(); if (on) wrap.append(spinner()); },
      error(msg, retry) { wrap.append(emptyNote(msg, retry ? { label: 'Retry', onClick: retry } : null)); },
      empty(msg) { wrap.append(emptyNote(msg)); },
      destroy() {},
    };
  }

  // ---------- Apple Watch honeycomb: drag around, bubbles grow near the middle ----------
  const el = h('div.mv-watch');
  const inner = h('div.mvw-inner');
  const cap = h('div.mvw-cap');
  const wrap = h('div.mv-watch-wrap', el, cap);
  el.append(inner);
  const bubbles = [];
  let raf = 0, centred = false;
  const S = () => (el.clientWidth || 600) / 100; // px per cqmin-ish (the view fills the circle)
  const layout = () => {
    const n = all.length, cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.25)));
    const u = S(), step = 19.5 * u, rowH = step * 0.866, pad = (el.clientWidth || 600) * 0.5;
    const rows = Math.ceil(n / cols);
    bubbles.forEach((b, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      b.cx = pad + c * step + (r % 2 ? step / 2 : 0); b.cy = pad + r * rowH;
      b.el.style.left = `${b.cx}px`; b.el.style.top = `${b.cy}px`;
    });
    inner.style.width = `${pad * 2 + (cols - 0.5) * step}px`;
    inner.style.height = `${pad * 2 + Math.max(0, rows - 1) * rowH}px`;
    if (!centred && n) {
      centred = true;
      const mid = bubbles[Math.min(n - 1, Math.floor(Math.min(rows, 3) / 2) * cols + Math.floor(cols / 2))];
      requestAnimationFrame(() => { el.scrollLeft = mid.cx - el.clientWidth / 2; el.scrollTop = Math.max(0, mid.cy - el.clientHeight / 2); fisheye(); });
    }
    fisheye();
  };
  const fisheye = () => {
    raf = 0;
    const W = el.clientWidth, H = el.clientHeight, cx = el.scrollLeft + W / 2, cy = el.scrollTop + H / 2, R = Math.min(W, H) / 2;
    let best = null, bd = Infinity;
    for (const b of bubbles) {
      const d = Math.hypot(b.cx - cx, b.cy - cy) / R;
      if (d < bd) { bd = d; best = b; }
      const s = d < 0.38 ? 1.08 - d * 0.2 : clamp(1.0 - (d - 0.38) * 1.25, 0.18, 1);
      // pull the outer ones a little toward the middle, like the watch does
      const pull = d > 0.38 ? Math.min(0.22, (d - 0.38) * 0.3) : 0;
      const tx = (cx - b.cx) * pull, ty = (cy - b.cy) * pull;
      b.el.style.transform = `translate(-50%, -50%) translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
      b.el.style.opacity = String(clamp(1.3 - d * 0.75, 0, 1));
    }
    if (best && cap.dataset.id !== String(best.e.id)) { cap.dataset.id = String(best.e.id); clear(cap).append(caption(best.e, 'mvw-text')); }
  };
  el.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(fisheye); }, { passive: true });
  const ro = new ResizeObserver(() => layout());
  ro.observe(el);
  return {
    el: wrap,
    add(items) {
      for (const e of items) { all.push(e); const b = { e, el: h('button.mvw-bubble', { type: 'button', onclick: tap(e), 'aria-label': e.title }, pic(e, 'mvw-img'), ...marks(e)) }; bubbles.push(b); inner.append(b.el); }
      layout();
    },
    setMore(m) { more = m; },    // the library loads the whole honeycomb (it's laid out as one shape)
    loading(on) { wrap.querySelector(':scope > .loading')?.remove(); if (on) wrap.append(spinner()); },
    error(msg, retry) { wrap.append(emptyNote(msg, retry ? { label: 'Retry', onClick: retry } : null)); },
    empty(msg) { wrap.append(emptyNote(msg)); },
    destroy() { ro.disconnect(); cancelAnimationFrame(raf); cleanup(); },
  };
}

/** A DVD case: plastic frame, the cover, the "DVD" band and a spine with the title. */
export function dvdCase(e, extra = '') {
  return h(`div.dvd-case${extra ? '.' + extra : ''}`,
    h('div.dvd-spine', h('span', e.title || '')),
    h('div.dvd-front', pic(e, 'dvd-cover'), h('div.dvd-band', 'DVD'), h('div.dvd-gloss'), ...marks(e)));
}
/** A disc printed with the artwork: hub, hole, rainbow sheen. */
export function disc(e, extra = '') {
  return h(`div.disc${extra ? '.' + extra : ''}`, pic(e, 'disc-print'), h('div.disc-sheen'), h('div.disc-hub'));
}
