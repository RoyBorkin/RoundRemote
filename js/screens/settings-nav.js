// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Settings navigation, Android style: a root list of categories → a category's page (its controls and rows for
// deeper pages) → deeper pages, each with the Back button at the top and its title. Back / Escape / Backspace (or
// the knob's back key) go up one level; ↑ ↓ (or ← →, the knob) move between the controls, Enter opens.
// Pages are built once, the first time they open, and kept (hidden) while Settings is open, so what they hold
// (bridge polling, previews…) keeps working; a search can build them all to look through every label.
//
// A page node: { id, title, icon?, color?, summary?, keywords?, order?,
//   content?(ctx) → Node[]   controls at the top of the page
//   children?(ctx) → node[]  deeper pages, listed as rows under the controls
//   footer?(ctx) → Node[]    controls under those rows
//   build?(el, ctx)          fill the page yourself (registered pages, see settings-registry.js)
//   hidden?() → bool, sub?() → string (a live row subtitle; else summary), onShow?(ctx) }
import { h, iconBtn, onCircle } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { curve, topPanel, toast } from '../ui/overlay.js';
import { isLite } from '../core/store.js';
import { wantsKeyboard, editText } from '../ui/keyboard.js';

// a few extra icons (Material Icons paths, Apache-2.0) for the settings rows
const EXTRA = {
  wifi: 'M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8 3 3 3-3a4.237 4.237 0 0 0-6 0zm-4-4 2 2a7.074 7.074 0 0 1 10 0l2-2C15.14 9.14 8.87 9.14 5 13z',
  bluetooth: 'M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z',
  battery: 'M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z',
  screen: 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z',
  rotate: 'M16.48 2.52c3.27 1.55 5.61 4.72 5.97 8.48h1.5C23.44 4.84 18.29 0 12 0l-.66.03 3.81 3.81 1.33-1.32zm-6.25-.77a1.49 1.49 0 0 0-2.12 0L1.75 8.11a1.49 1.49 0 0 0 0 2.12l12.02 12.02c.59.59 1.54.59 2.12 0l6.36-6.36c.59-.59.59-1.54 0-2.12L10.23 1.75zm4.6 19.44L2.81 9.17l6.36-6.36 12.02 12.02-6.36 6.36zm-7.31.29A10.487 10.487 0 0 1 1.55 13H.05C.56 19.16 5.71 24 12 24l.66-.03-3.81-3.81-1.33 1.32z',
  update: 'M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1a6.875 6.875 0 0 0 0 9.79 7.02 7.02 0 0 0 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58a8.987 8.987 0 0 1 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z',
  restart: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  palette: 'M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10a2.5 2.5 0 0 0 2.5-2.5c0-.61-.23-1.2-.64-1.67a.528.528 0 0 1-.13-.33c0-.28.22-.5.5-.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9zm5.5 11c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm-3-4c-.83 0-1.5-.67-1.5-1.5S13.67 6 14.5 6s1.5.67 1.5 1.5S15.33 9 14.5 9zM5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S7.33 13 6.5 13 5 12.33 5 11.5zm6-4c0 .83-.67 1.5-1.5 1.5S8 8.33 8 7.5 8.67 6 9.5 6s1.5.67 1.5 1.5z',
  key: 'M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
  hub: 'M8.4 18.2c.38.5.6 1.12.6 1.8 0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3c.44 0 .85.09 1.23.26l1.41-1.77c-.92-1.03-1.29-2.39-1.09-3.69l-2.03-.68c-.54.83-1.46 1.38-2.52 1.38-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3c0 .07 0 .14-.01.21l2.03.68c.64-1.21 1.82-2.09 3.22-2.32V5.91C9.96 5.57 9 4.4 9 3c0-1.66 1.34-3 3-3s3 1.34 3 3c0 1.4-.96 2.57-2.25 2.91v2.16c1.4.23 2.58 1.11 3.22 2.32l2.03-.68c-.01-.07-.01-.14-.01-.21 0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3c-1.06 0-1.98-.55-2.51-1.37l-2.03.68c.2 1.29-.16 2.65-1.09 3.69l1.41 1.77c.38-.17.79-.26 1.23-.26 1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3c0-.68.22-1.3.6-1.8l-1.41-1.77c-1.35.75-3.01.76-4.37 0L8.4 18.2z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  bell: 'M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  sliders: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
};
export const ico = (name) => (EXTRA[name] ? `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${EXTRA[name]}"/></svg>` : icon(name));

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'“”"()·.,:;!?–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
const LABELS = '.opt-label, .field-label, .section, .row-title, .pill, .th-name, .bd-name, button.switch[aria-label]';

// where Settings was left (it opens there again for a while), and each page's scroll position
const memory = { path: '', at: 0, scroll: new Map() };
const REMEMBER_MS = 10 * 60 * 1000;

/**
 * Build the navigator into `el` (the Settings screen). `root` is the root node; `onExit` leaves Settings.
 * `start`: a path to open ('music/lyrics'), or null to open where Settings was left.
 */
export function createNav({ el, root, onExit, start = null }) {
  const stage = h('div.set-stage');
  const title = h('div.settings-title.set-title', { 'aria-live': 'polite' }, root.title);
  const backBtn = onCircle(iconBtn('back', 'Back', () => back()), 0, 42);
  backBtn.classList.add('set-back');
  el.append(stage, title, backBtn);

  const pages = new Map();   // path → page record
  const stack = [];          // paths, root ('') first
  const cleanups = [];
  let current = null, alive = true;
  const join = (a, b) => (a ? `${a}/${b}` : b);

  // ---------------------------------------------------------------- pages
  function ctxFor(rec) {
    return {
      path: rec.path, page: rec.scroller,
      open: (p) => openPath(p),
      back: () => back(),
      refresh: () => renderRows(rec),
      onClose: (fn) => { cleanups.push(fn); },
      toast,
    };
  }
  function kidsOf(rec) {
    const list = (rec.node.children?.(ctxFor(rec)) || []).filter(Boolean);
    return list.map((k, i) => ({ order: (i + 1) * 10, ...k })).sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  }
  function page(node, path, parent) {
    let rec = pages.get(path);
    if (rec) return rec;
    const scroller = h('div.settings-list.set-list', { role: 'list' });
    const pageEl = h('div.set-page', { dataset: { path: path || 'root' }, 'aria-label': node.title }, scroller);
    stage.append(pageEl);
    rec = { node, path, parent, el: pageEl, scroller, rows: [], kids: [], end: null };
    pages.set(path, rec);
    const ctx = ctxFor(rec);
    const put = (fn) => {
      try { (fn() || []).filter(Boolean).forEach((n) => scroller.append(n)); }
      catch (e) { console.error('settings page', path, e); scroller.append(h('div.opt-hint', 'Couldn’t show part of this page.')); }
    };
    if (node.content) put(() => node.content(ctx));
    if (node.build) put(() => { node.build(scroller, ctx); return []; });
    rec.end = h('div.set-end');   // rows go just before this (footer controls after it)
    scroller.append(rec.end);
    if (node.footer) put(() => node.footer(ctx));
    scroller.append(h('div.spacer'));
    try { rec.kids = kidsOf(rec); } catch (e) { console.error('settings rows', path, e); rec.kids = []; }
    renderRows(rec);
    rec.reflow = curve(scroller);
    return rec;
  }
  const isHidden = (k) => { try { return !!k.hidden?.(); } catch { return false; } };
  function navRow(kid, rec) {
    const sub = (() => { try { return kid.sub?.() ?? kid.summary ?? ''; } catch { return kid.summary || ''; } })();
    const b = h('button.row.set-nav', {
      type: 'button', role: 'listitem', dataset: { to: join(rec.path, kid.id) }, '--ic': kid.color || '',
      onclick: (e) => { e.stopPropagation(); push(kid, rec); },
    },
    h('span.set-ic', { html: ico(kid.icon || 'settings') }),
    h('span.row-text', h('span.row-title', kid.title), sub ? h('span.row-sub', sub) : null),
    h('span.set-chev', { html: icon('chevron') }));
    return b;
  }
  function renderRows(rec) {
    rec.rows.forEach((r) => r.remove());
    rec.rows = rec.kids.filter((k) => !isHidden(k)).map((k) => navRow(k, rec));
    rec.rows.forEach((r) => rec.scroller.insertBefore(r, rec.end));
    rec.reflow?.();
  }

  // ---------------------------------------------------------------- moving between pages
  function show(rec, dir, { focus = null, instant = false } = {}) {
    const prev = current;
    current = rec;
    rec.el.classList.add('shown');
    rec.el.setAttribute('aria-hidden', 'false');
    el.dataset.depth = String(stack.length - 1);
    title.textContent = rec.node.title;
    backBtn.setAttribute('aria-label', stack.length > 1 ? `Back to ${pages.get(stack[stack.length - 2])?.node.title || 'Settings'}` : 'Back to Home');
    if (rec !== prev) { renderRows(rec); try { rec.node.onShow?.(ctxFor(rec)); } catch {} }
    const restore = memory.scroll.get(rec.path);
    if (dir > 0 && !instant) rec.scroller.scrollTop = 0; else if (restore != null) rec.scroller.scrollTop = restore;
    rec.reflow?.();
    const anim = !instant && !isLite() && prev && prev !== rec && rec.el.animate;
    if (prev && prev !== rec) {
      prev.el.setAttribute('aria-hidden', 'true');
      prev.el.getAnimations?.().forEach((a) => a.cancel());
      if (anim) {
        const a = prev.el.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-dir * 26}%)`, opacity: 0 }], { duration: 230, easing: 'cubic-bezier(.4,0,.2,1)' });
        a.onfinish = () => { if (current !== prev) prev.el.classList.remove('shown'); };
      } else prev.el.classList.remove('shown');
    }
    if (anim) {
      rec.el.getAnimations?.().forEach((a) => a.cancel());
      rec.el.animate([{ transform: `translateX(${dir * 30}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
      title.animate?.([{ opacity: 0, transform: `translate(-50%, 0) translateX(${dir * 4}cqmin)` }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 260, easing: 'ease-out' });
    }
    if (focus) {
      const f = typeof focus === 'string' ? rec.scroller.querySelector(`[data-to="${CSS.escape(focus)}"]`) : focus;
      if (f) { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'center' }); }
    }
    memory.path = stack.filter((p) => p !== SEARCH).at(-1) || '';
  }
  const SEARCH = '\u0000search';
  function push(kid, from, opts = {}) {
    const path = kid === searchNode ? SEARCH : join(from.path, kid.id);
    if (current) memory.scroll.set(current.path, current.scroller.scrollTop);
    const rec = page(kid, path, from);
    stack.push(path);
    show(rec, 1, opts);
    if (keyMode && kid !== searchNode) focusFirst();
    return rec;
  }
  function back() {
    if (stack.length <= 1) { onExit(); return; }
    if (current) memory.scroll.set(current.path, current.scroller.scrollTop);
    const leaving = stack.pop();
    const rec = pages.get(stack[stack.length - 1]);
    show(rec, -1, { focus: keyMode ? leaving : null });
  }
  /** Open a page by its path ('device/wifi'); goes as deep as it can. */
  function openPath(path, { instant = false } = {}) {
    const ids = String(path || '').split('/').filter(Boolean);
    if (current) memory.scroll.set(current.path, current.scroller.scrollTop);
    stack.length = 0; stack.push('');
    let rec = page(root, '', null);
    const walk = (from, rest) => {
      let r = from;
      while (rest.length) {
        const kid = r.kids.find((k) => k.id === rest[0] && !isHidden(k));
        if (!kid) break;
        const p = join(r.path, rest.shift());
        r = page(kid, p, r);
        stack.push(p);
      }
      return r;
    };
    const rest = [...ids];
    rec = walk(rec, rest);
    show(rec, 1, { instant });
    // a page whose rows appear later (Device: once the bridge answers) — carry on then, unless the user moved on
    const later = (at, tries = 0) => {
      if (!rest.length || !at.node.ready || tries > 4) return;
      Promise.resolve(at.node.ready()).then(() => setTimeout(() => {
        if (!alive || current !== at) return;
        renderRows(at);
        const r = walk(at, rest);
        if (r !== at) { show(r, 1); later(r); }
      }, 0)).catch(() => {});
    };
    later(rec);
    return rec;
  }

  // ---------------------------------------------------------------- search
  const searchNode = {
    id: 'search', title: 'Search',
    content: (ctx) => {
      const input = h('input.field-input.set-q', { type: 'search', placeholder: 'Search settings', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Search settings', enterkeyhint: 'search' });
      const box = h('label.set-qbox', h('span.set-q-ic', { html: icon('search') }), input);
      let results = [];
      const scroller = ctx.page;
      const paint = () => {
        results.forEach((r) => r.remove());
        const q = input.value.trim();
        results = q ? searchFor(q) : [h('div.opt-hint.set-q-hint', 'Type a word: “wifi”, “lyrics”, “battery”, “subtitles”…')];
        const anchor = box.nextSibling;
        results.forEach((r) => scroller.insertBefore(r, anchor));
        pages.get(SEARCH)?.reflow?.();
      };
      if (wantsKeyboard()) {
        input.readOnly = true;
        const ask = async () => { const v = await editText({ title: 'Search settings', value: input.value, placeholder: 'wifi, lyrics, battery…', okLabel: 'Search' }); if (v !== null) { input.value = v; paint(); } };
        input.addEventListener('click', (e) => { e.preventDefault(); ask(); });
        searchNode.onShow = () => { if (!input.value) setTimeout(() => { if (current?.path === SEARCH && !topPanel()) ask(); }, 320); };
      } else {
        input.addEventListener('input', paint);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (input.value) { input.value = ''; paint(); } else back(); }
          if (e.key === 'ArrowDown' || e.key === 'Enter') { const r = scroller.querySelector('.set-res'); if (r) { e.preventDefault(); if (e.key === 'Enter') r.click(); else r.focus(); } }
        });
        searchNode.onShow = () => setTimeout(() => input.focus({ preventScroll: true }), 60);
      }
      // build every page now; pages whose rows come later (Device) are searched again once they're there
      setTimeout(() => {
        buildAll();
        paint();
        const waits = [...pages.values()].map((r) => r.node.ready?.()).filter(Boolean);
        if (waits.length) Promise.allSettled(waits).then(() => setTimeout(() => { if (!alive) return; buildAll(); if (input.value.trim()) paint(); }, 50));
      }, 0);
      return [box];
    },
  };
  /** Every page, built (once) so its labels can be searched. */
  function buildAll() {
    const walk = (rec, depth) => {
      if (depth > 6) return;
      for (const k of rec.kids) if (!isHidden(k)) walk(page(k, join(rec.path, k.id), rec), depth + 1);
    };
    walk(page(root, '', null), 0);
  }
  function crumbsOf(rec) {
    const out = [];
    for (let r = rec; r && r.path; r = r.parent) out.unshift(r.node.title);
    return out;
  }
  function searchFor(q) {
    buildAll();
    const words = norm(q).split(' ').filter(Boolean);
    if (!words.length) return [];
    const hits = [];
    const seen = new Set();
    for (const rec of pages.values()) {
      if (rec.path === SEARCH || !rec.path) continue;
      // is every page above it shown?
      let ok = true;
      for (let r = rec; r?.parent; r = r.parent) if (!r.parent.kids.some((k) => k === r.node && !isHidden(k))) { ok = false; break; }
      if (!ok) continue;
      const crumbs = crumbsOf(rec);
      const score = (label, extra = '') => {
        // "wifi" finds "Wi-Fi", "on screen" finds "On-screen": also compare without the spaces
        const L = norm(label), H = `${L} ${norm(crumbs.join(' '))} ${norm(extra)}`;
        const has = (s, w) => s.includes(w) || s.replace(/ /g, '').includes(w);
        if (!words.every((w) => has(H, w))) return 0;
        if (L.startsWith(words.join(' ')) || L.replace(/ /g, '').startsWith(words.join(''))) return 4;
        if (words.every((w) => has(L, w))) return 3;
        return 1;
      };
      const s = score(rec.node.title, `${rec.node.summary || ''} ${rec.node.keywords || ''}`);
      if (s) hits.push({ s: s + 0.5, label: rec.node.title, sub: crumbs.slice(0, -1).join(' › ') || 'Settings', rec, item: null });
      for (const item of rec.scroller.children) {
        if (item.hidden || item.classList.contains('set-nav') || item.classList.contains('set-end') || item.classList.contains('spacer')) continue;
        const labels = new Set();
        const take = (e) => {
          if (e.closest('[hidden], .dv-list, .prof-list, .al-log')) return;   // live lists (networks, devices, profiles) aren't settings
          const t = (e.matches('button.switch') ? e.getAttribute('aria-label') : e.textContent).replace(/\s+/g, ' ').trim();
          if (t && t.length <= 80) labels.add(t);
        };
        if (item.matches(LABELS)) take(item);
        item.querySelectorAll(LABELS).forEach(take);
        for (const label of labels) {
          const key = `${rec.path}|${norm(label)}`;
          if (seen.has(key) || norm(label) === norm(rec.node.title)) continue;   // the page itself is listed already
          seen.add(key);
          const s2 = score(label);
          if (s2) hits.push({ s: s2, label, sub: crumbs.join(' › '), rec, item });
        }
      }
    }
    hits.sort((a, b) => b.s - a.s || a.sub.length - b.sub.length);
    if (!hits.length) return [h('div.opt-hint.set-q-hint', `Nothing found for “${q}”.`)];
    return hits.slice(0, 40).map((x) => h('button.row.set-res', {
      type: 'button', role: 'listitem',
      onclick: (e) => { e.stopPropagation(); jumpTo(x); },
    }, h('span.set-ic.sm', { html: ico(topIcon(x.rec)) }), h('span.row-text', h('span.row-title', x.label), h('span.row-sub', x.sub))));
  }
  const topIcon = (rec) => { let r = rec; while (r.parent?.path) r = r.parent; return r.node.icon || 'settings'; };
  function jumpTo(x) {
    if (current) memory.scroll.set(current.path, current.scroller.scrollTop);
    const ids = x.rec.path.split('/');
    // keep the search under it, so Back returns to the results
    let rec = pages.get('');
    for (const id of ids) { const kid = rec.kids.find((k) => k.id === id); if (!kid) break; rec = page(kid, join(rec.path, id), rec); }
    stack.length = 0; stack.push('', SEARCH, rec.path);
    show(rec, 1);
    if (x.item) {
      requestAnimationFrame(() => {
        x.item.scrollIntoView({ block: 'center', behavior: isLite() ? 'auto' : 'smooth' });
        x.item.classList.remove('set-flash'); void x.item.offsetWidth; x.item.classList.add('set-flash');
        setTimeout(() => x.item.classList.remove('set-flash'), 1800);
        if (keyMode) x.item.querySelector('button, input, label.th-any')?.focus({ preventScroll: true });
      });
    }
  }

  // ---------------------------------------------------------------- keys / knob
  let keyMode = false;
  const focusables = () => [...(current?.scroller.querySelectorAll('button:not([disabled]), input:not([type="hidden"]), [tabindex="0"]') || [])]
    .filter((n) => !n.closest('[hidden]') && n.offsetParent !== null);
  function focusFirst() { const f = focusables()[0]; if (f) { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'center' }); } }
  function step(d) {
    const list = focusables();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const n = i < 0 ? (d > 0 ? list[0] : list[list.length - 1]) : list[Math.max(0, Math.min(list.length - 1, i + d))];
    n.focus({ preventScroll: true });
    n.scrollIntoView({ block: 'center', behavior: isLite() ? 'auto' : 'smooth' });
  }
  const onKey = (e) => {
    if (!alive || !el.isConnected || e.altKey || e.ctrlKey || e.metaKey) return;
    if (topPanel()) return;   // a panel (on-screen keyboard, pickers…) is open: main.js closes it on Escape
    if (e.target?.matches?.('input, textarea, select')) return;   // typing (the search box handles its own Escape)
    const k = e.key;
    if (k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack') { e.preventDefault(); e.stopPropagation(); keyMode = true; back(); return; }
    if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(k)) {
      e.preventDefault(); keyMode = true;
      step(k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1);
      return;
    }
    if ((k === 'Enter' || k === ' ') && !current?.scroller.contains(document.activeElement)) { e.preventDefault(); keyMode = true; focusFirst(); }
  };
  window.addEventListener('keydown', onKey, true);
  const onPointer = () => { keyMode = false; };
  el.addEventListener('pointerdown', onPointer, true);

  // ---------------------------------------------------------------- start
  const resume = start == null && memory.path && Date.now() - memory.at < REMEMBER_MS ? memory.path : null;
  openPath(start ?? resume ?? '', { instant: true });

  return {
    open: (p) => openPath(p),
    back,
    search: () => push(searchNode, pages.get('')),
    searchNode,
    refresh: () => { for (const rec of pages.values()) renderRows(rec); },
    buildAll,
    current: () => current?.path,
    destroy() {
      alive = false;
      if (current) memory.scroll.set(current.path, current.scroller.scrollTop);
      memory.at = Date.now();
      window.removeEventListener('keydown', onKey, true);
      cleanups.splice(0).forEach((f) => { try { f(); } catch {} });
    },
  };
}
