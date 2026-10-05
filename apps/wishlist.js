// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Wish Lists: games, movies, shows and books you want. Four lists (tabs at the top), each a ring of covers
// you turn with a finger or the knob (or a plain list), with priority stars, notes and a Wanted → Done status
// (Got it / Watched / Read). "+" searches where things live: the Steam store, your Steam wishlist and
// PlayStation games; your Plex / Jellyfin libraries and iTunes for movies and shows; Open Library for books
// — or type a title. The Movies & TV library and the PlayStation / Steam screens save here with a ♡.
// A game you got can go straight into your Collection (apps/collection-store.js): "Add to Collection".
// Data: apps/wishlist-store.js (appData.wishlist) · searches: apps/wishlist-sources.js
import { clear } from '../js/ui/dom.js';
import { curve } from '../js/ui/overlay.js';
import { createKeyboard, wantsKeyboard } from '../js/ui/keyboard.js';
import { debounce } from '../js/core/util.js';
import * as W from './wishlist-store.js';
import * as S from './wishlist-sources.js';

const { KINDS, KIND_META, SOURCES } = W;
const BOOK = 'M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 4h5v8l-2.5-1.5L6 12V4z';
const GRID = 'M4 5h4v6H4zm6 0h4v6h-4zm6 0h4v6h-4zM4 13h4v6H4zm6 0h4v6h-4zm6 0h4v6h-4z';
const KIND_ICON = { game: 'gamepad', movie: 'film', show: 'tv', book: null };
const SORTS = [['priority', 'Priority'], ['newest', 'Newest'], ['title', 'A – Z'], ['year', 'Year']];
const errText = (e) => e?.body?.error || e?.userMessage || e?.message || 'Something went wrong';
const svgPath = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
function hue(s) { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x % 360; }
function ago(ms) {
  if (!ms) return '';
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d < 1 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}
/** "Dune (2021)" / "Dune 2021" → { title, year } */
function parseTitle(s) {
  const m = /^(.*?)[\s,]*\(?((?:19|20)\d\d)\)?\s*$/.exec(s.trim());
  return m && m[1].trim() ? { title: m[1].trim(), year: +m[2] } : { title: s.trim(), year: null };
}

export default {
  css: './wishlist.css',
  create(el, app) {
    const { h, icon } = app;
    const kicon = (k) => (KIND_ICON[k] ? icon(KIND_ICON[k]) : svgPath(BOOK));
    let kind = KINDS.includes(app.data('kind')) ? app.data('kind') : 'game';
    let filter = app.data('filter', 'wanted');           // wanted | done
    let sort = app.data('sort', 'priority');
    let view = app.data('view', 'ring');                 // ring | list
    let sel = 0;                                         // selected item index in the current list
    let items = [];
    let flashId = null;
    const offs = [];

    // ------------------------------------------------------------ skeleton
    const tabs = h('div.wl-tabs', { role: 'tablist' });
    const seg = h('div.wl-seg');
    const ring = h('div.wl-ring', { tabindex: '-1' });
    const info = h('div.wl-info');
    // where you are in the ring: a short arc along the bottom of the rim (knob feedback)
    const rim = h('div.wl-rim', { html: '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="wl-rim-t" d="M 18.82 87.13 A 48.5 48.5 0 0 0 81.18 87.13"/><circle class="wl-rim-k" r="1.3" cx="50" cy="98.5"/></svg>' });
    const listEl = h('div.wl-list.list');
    const reCurve = curve(listEl);
    const empty = h('div.wl-empty');
    const btnView = h('button.wl-btn', { type: 'button', onclick: () => setView(view === 'ring' ? 'list' : 'ring') });
    const btnAdd = h('button.wl-add', { type: 'button', 'aria-label': 'Add', onclick: () => openAdd() }, h('i', { html: icon('plus') }));
    const btnSort = h('button.wl-btn', { type: 'button', onclick: () => cycleSort() });
    el.classList.add('wl');
    app.hideTitle();
    el.append(tabs, seg, ring, rim, info, listEl, empty, h('div.wl-bar', btnView, btnAdd, btnSort));

    // ------------------------------------------------------------ data
    function sorted() {
      const l = W.wishes(kind).filter((x) => (filter === 'done' ? x.status === 'done' : x.status !== 'done'));
      const by = {
        priority: (a, b) => (b.priority || 0) - (a.priority || 0) || (b.added || 0) - (a.added || 0),
        newest: (a, b) => (filter === 'done' ? (b.doneAt || 0) - (a.doneAt || 0) : (b.added || 0) - (a.added || 0)),
        title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
        year: (a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title),
      }[sort] || (() => 0);
      return l.sort(by);
    }

    // ------------------------------------------------------------ chrome
    function renderTabs() {
      clear(tabs);
      for (const k of KINDS) {
        const n = W.wishes(k).filter((x) => x.status !== 'done').length;
        tabs.append(h(`button.wl-tab${k === kind ? '.on' : ''}`, { type: 'button', role: 'tab', '--k': KIND_META[k].color, 'aria-selected': String(k === kind), 'aria-label': KIND_META[k].plural, dataset: { k },
          onclick: () => setKind(k) },
          h('i', { html: kicon(k) }), h('span.wl-tab-n', KIND_META[k].plural), n ? h('span.wl-tab-c', String(n)) : null));
      }
      el.style.setProperty('--k', KIND_META[kind].color);
    }
    function renderSeg() {
      clear(seg);
      const all = W.wishes(kind);
      const nW = all.filter((x) => x.status !== 'done').length, nD = all.length - nW;
      const chip = (val, label, n) => h(`button.chip${filter === val ? '.on' : ''}`, { type: 'button', dataset: { f: val }, onclick: () => setFilter(val) }, label, h('b', String(n)));
      seg.append(chip('wanted', 'Wanted ', nW), chip('done', `${KIND_META[kind].done} `, nD));
      btnView.innerHTML = '';
      btnView.append(h('i', { html: view === 'ring' ? icon('list') : svgPath(GRID) }), h('span', view === 'ring' ? 'List' : 'Covers'));
      btnView.setAttribute('aria-label', view === 'ring' ? 'Show as a list' : 'Show as covers');
      btnSort.innerHTML = '';
      btnSort.append(h('i', { html: sort === 'priority' ? icon('star') : sort === 'newest' ? icon('clock') : sort === 'year' ? icon('replay') : icon('text') }), h('span', SORTS.find((s) => s[0] === sort)?.[1] || 'Sort'));
      btnSort.setAttribute('aria-label', `Sort: ${SORTS.find((s) => s[0] === sort)?.[1]}`);
    }
    function setKind(k, { keepSel = false } = {}) {
      if (k === kind && keepSel) return;
      if (k !== kind) app.sfx('tick');
      kind = k; app.save('kind', k);
      if (!keepSel) sel = 0;
      render();
    }
    function setFilter(f) { if (f === filter) return; filter = f; app.save('filter', f); sel = 0; app.sfx('tap'); render(); }
    function cycleSort() {
      const i = SORTS.findIndex((s) => s[0] === sort);
      sort = SORTS[(i + 1) % SORTS.length][0]; app.save('sort', sort); sel = 0; app.sfx('tap');
      render(); app.toast(`Sorted by ${SORTS.find((s) => s[0] === sort)[1].toLowerCase()}`, { ms: 1200 });
    }
    function setView(v) { view = v; app.save('view', v); app.sfx('tap'); render(); }

    // ------------------------------------------------------------ cover art (portrait posters fill; wide / square art sits on its own blur)
    function artBox(it, cls = '') {
      const box = h(`div.wl-art${cls ? '.' + cls : ''}`, { '--h': String(hue(it.title)) },
        h('div.wl-art-ph', h('i', { html: kicon(it.kind) }), h('span', it.title)));
      const urls = [it.art, it.artAlt].filter(Boolean);
      const tryNext = () => {
        const u = urls.shift();
        if (!u) return;
        const im = new Image();
        im.onload = () => {
          const r = im.naturalWidth / (im.naturalHeight || 1);
          if (im.naturalWidth < 8) { tryNext(); return; }   // Open Library answers a 1×1 gif for a missing cover
          box.style.setProperty('--img', `url("${u.replace(/"/g, '%22')}")`);
          box.classList.add('loaded'); box.classList.toggle('fit', r > 0.82);
        };
        im.onerror = tryNext;
        im.src = u;
      };
      box._load = () => { if (!box._started) { box._started = true; tryNext(); } };
      return box;
    }
    const stars = (it, { big = false, onSet } = {}) => h(`div.wl-stars${big ? '.big' : ''}`, { role: 'radiogroup', 'aria-label': 'Priority' },
      [1, 2, 3].map((n) => h(`button.wl-star${(it.priority || 0) >= n ? '.on' : ''}`, { type: 'button', role: 'radio', 'aria-checked': String((it.priority || 0) === n), 'aria-label': `${n} star${n > 1 ? 's' : ''}`,
        html: icon((it.priority || 0) >= n ? 'star' : 'starOutline'),
        onclick: (e) => { e.stopPropagation(); const p = (it.priority || 0) === n ? 0 : n; W.updateWish(it.id, { priority: p }); app.sfx('tick'); app.vibrate(8); onSet?.(p); } })));
    const srcBadge = (s) => h('span.wl-src', { '--s': SOURCES[s]?.color || '#94a3b8' }, h('i'), W.sourceName(s));
    const libBadge = () => h('span.wl-lib', h('i', { html: icon('check') }), 'In your library');
    const metaLine = (it) => [it.year, it.by].filter(Boolean).join(' · ');

    // ------------------------------------------------------------ the ring of covers
    let cards = [], pos = 0, touched = new Set(), raf = 0;
    const slot = () => ring.clientWidth * 0.205;   // keep in sync with .wl-card width (20.5cqmin of the 100cqmin box)
    function renderRing() {
      clear(ring); cards = []; touched = new Set();
      items.forEach((it, i) => {
        const art = artBox(it);
        const card = h('button.wl-card', { type: 'button', dataset: { id: it.id, i: String(i) }, 'aria-label': `${it.title}${it.year ? ` (${it.year})` : ''}`,
          onclick: () => { if (i === Math.round(pos)) openItem(it.id); else goTo(i); } },
          art, it.status === 'done' ? h('span.wl-done-tag', { html: icon('check') }) : null, it.inLibrary ? h('span.wl-lib-dot', { title: 'In your library' }) : null);
        card._art = art;
        cards.push(card);
        ring.append(card);
      });
      requestAnimationFrame(() => { ring.scrollLeft = sel * slot(); pos = sel; paintRing(true); });
    }
    function paintRing(force = false) {
      raf = 0;
      const s = slot() || 1;
      pos = ring.scrollLeft / s;
      const lo = Math.max(0, Math.floor(pos) - 5), hi = Math.min(cards.length - 1, Math.ceil(pos) + 5);
      const now = new Set();
      for (let i = lo; i <= hi; i++) {
        const t = i - pos, a = Math.abs(t);
        const c = cards[i];
        c.style.transform = `translateY(${(Math.min(a, 4) ** 2 * 2.1).toFixed(2)}cqmin) rotate(${(t * 9).toFixed(2)}deg) scale(${(1 - Math.min(0.42, a * 0.19)).toFixed(3)})`;
        c.style.opacity = Math.max(0, 1 - Math.max(0, a - 0.6) * 0.32).toFixed(3);
        c.style.zIndex = String(100 - Math.round(a * 10));
        c.classList.toggle('mid', a < 0.5);
        if (a < 6) c._art._load();
        now.add(i);
      }
      for (const i of touched) if (!now.has(i) && cards[i]) { cards[i].style.opacity = '0'; }
      touched = now;
      paintRim();
      const i = Math.max(0, Math.min(items.length - 1, Math.round(pos)));
      if (items.length && (i !== sel || force || !info.firstChild)) { sel = i; renderInfo(); }
    }
    ring.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => paintRing()); }, { passive: true });
    function paintRim() {
      const n = items.length;
      rim.classList.toggle('on', view === 'ring' && n > 1);
      if (n < 2) return;
      // the arc runs from 220° to 140° (clockwise from the top) through the bottom
      const f = Math.max(0, Math.min(1, pos / (n - 1)));
      const a = ((220 - 80 * f) * Math.PI) / 180;
      const k = rim.querySelector('.wl-rim-k');
      k.setAttribute('cx', (50 + 48.5 * Math.sin(a)).toFixed(2)); k.setAttribute('cy', (50 - 48.5 * Math.cos(a)).toFixed(2));
    }
    function goTo(i, smooth = true) {
      if (!items.length) return;
      i = Math.max(0, Math.min(items.length - 1, i));
      if (view === 'ring') ring.scrollTo({ left: i * slot(), behavior: smooth ? 'smooth' : 'auto' });
      else { sel = i; markListSel(true); }
      if (i !== sel) app.sfx('tick');
    }
    // the knob / a mouse wheel turns the ring one cover per notch
    let wheelAcc = 0, wheelT = 0;
    el.addEventListener('wheel', (e) => {
      if (view !== 'ring' || !items.length || document.querySelector('.panel')) return;
      e.preventDefault();
      wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(wheelAcc) >= 40 && performance.now() - wheelT > 90) { goTo(Math.round(pos) + Math.sign(wheelAcc)); wheelAcc = 0; wheelT = performance.now(); }
    }, { passive: false });

    function renderInfo() {
      clear(info);
      const it = items[sel];
      if (!it) return;
      info.append(
        h('div.wl-info-t', { dir: 'auto' }, it.title),
        h('div.wl-info-m', metaLine(it) || (it.status === 'done' ? `${KIND_META[it.kind].done} ${ago(it.doneAt)}` : `Added ${ago(it.added)}`)),
        h('div.wl-info-r', stars(it, { onSet: () => {} }), it.note ? h('span.wl-note-ic', { title: it.note, html: icon('edit') }) : null),
      );
      info.classList.remove('in'); void info.offsetWidth; info.classList.add('in');
    }

    // ------------------------------------------------------------ the list view
    function renderList() {
      clear(listEl);
      items.forEach((it, i) => {
        const row = h(`button.row.wl-row${i === sel ? '.sel' : ''}${it.id === flashId ? '.flash' : ''}`, { type: 'button', dataset: { id: it.id }, onclick: () => { sel = i; openItem(it.id); } },
          artBox(it, 'thumb'),
          h('div.row-text', h('div.row-title', { dir: 'auto' }, it.title),
            h('div.row-sub', [metaLine(it), it.note ? `“${it.note}”` : '', it.status === 'done' ? `${KIND_META[it.kind].doneShort} ${ago(it.doneAt)}` : ''].filter(Boolean).join(' · ') || W.sourceName(it.source))),
          it.priority ? h('span.wl-row-p', '★'.repeat(it.priority)) : null);
        row.querySelector('.wl-art')._load();
        listEl.append(row);
      });
      reCurve();
      markListSel(false);
    }
    function markListSel(scroll) {
      [...listEl.children].forEach((r, i) => r.classList.toggle('sel', i === sel));
      if (scroll) listEl.children[sel]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    // ------------------------------------------------------------ empty state
    function renderEmpty() {
      clear(empty);
      const m = KIND_META[kind];
      const total = W.wishes(kind).length;
      const hint = { game: 'Search the Steam store, import your Steam wishlist or pick from PlayStation — or tap ♡ on a game in the PlayStation and Steam screens.',
        movie: 'Search your Plex or Jellyfin library and iTunes — or tap “Wish list” on a movie in Movies & TV.',
        show: 'Search your Plex or Jellyfin library and iTunes — or tap “Wish list” on a show in Movies & TV.',
        book: 'Search Open Library by title or author, or type one in.' }[kind];
      empty.append(...[h('div.wl-empty-ic', { html: W.heartSvg(false) }),
        h('div.wl-empty-t', filter === 'done' ? `Nothing ${m.done.toLowerCase()} yet` : total ? `Every ${m.name.toLowerCase()} is done!` : `No ${m.plural.toLowerCase()} on your wish list`),
        h('div.wl-empty-m', filter === 'done' ? `When you get one, open it and tap “${m.done}”.` : hint),
        filter === 'done' ? null : h('button.pill.primary', { type: 'button', onclick: () => openAdd() }, `Add a ${m.name.toLowerCase()}`)].filter(Boolean));
    }

    function render() {
      items = sorted();
      if (flashId) { const i = items.findIndex((x) => x.id === flashId); if (i >= 0) sel = i; }
      sel = Math.max(0, Math.min(items.length - 1, sel));
      el.dataset.view = view; el.dataset.empty = String(!items.length); el.dataset.filter = filter;
      renderTabs(); renderSeg();
      if (!items.length) { clear(ring); clear(listEl); clear(info); cards = []; renderEmpty(); paintRim(); return; }
      if (view === 'ring') { clear(listEl); renderRing(); } else { clear(ring); cards = []; clear(info); renderList(); paintRim(); }
      if (flashId) { const id = flashId; setTimeout(() => { if (flashId === id) flashId = null; }, 1600); }
    }

    // ------------------------------------------------------------ one item
    function openItem(id) {
      app.openPanel({
        title: '', className: 'wl-item-panel',
        build(body, panel) {
          const draw = () => {
            const it = W.getWish(id);
            if (!it) { panel.close(); return; }
            const m = KIND_META[it.kind];
            panel.setTitle(m.name);
            panel.el.style.setProperty('--k', m.color);
            clear(body);
            const art = artBox(it, 'hero'); art._load();
            const status = h('div.wl-status',
              h(`button.wl-st${it.status !== 'done' ? '.on' : ''}`, { type: 'button', dataset: { s: 'wanted' }, onclick: () => setStatus('wanted') }, h('i', { html: W.heartSvg(true) }), 'Wanted'),
              h(`button.wl-st${it.status === 'done' ? '.on' : ''}`, { type: 'button', dataset: { s: 'done' }, onclick: () => setStatus('done') }, h('i', { html: icon('check') }), m.done));
            body.append(h('div.wl-item',
              h('div.wl-head', art, h('div.wl-head-r',
                h('button.wl-item-t', { type: 'button', dir: 'auto', onclick: editTitle, 'aria-label': 'Edit title' }, it.title),
                metaLine(it) ? h('div.wl-item-m', metaLine(it)) : null,
                h('div.wl-badges', srcBadge(it.source), it.inLibrary ? libBadge() : null),
                h('div.wl-when', it.status === 'done' && it.doneAt ? `${m.doneShort} ${ago(it.doneAt)}` : `Added ${ago(it.added)}`),
                stars(it, { big: true, onSet: () => draw() }))),
              status,
              collectRow(it),
              h(`button.wl-note${it.note ? '' : '.empty'}`, { type: 'button', dir: 'auto', onclick: editNote }, h('i', { html: icon('edit') }), h('span', it.note || 'Add a note — where to buy, who recommended it…')),
              h('div.wl-item-acts',
                h('button.pill.small', { type: 'button', onclick: editTitle }, 'Edit'),
                h('button.pill.small.danger', { type: 'button', onclick: () => { W.removeWish(id); app.sfx('drop'); app.toast(`Removed “${it.title}”`); panel.close(); } }, 'Remove'))));
          };
          // Got it → offer to put it on the Collection's shelf (a video game or a board game)
          let coll = null;
          import('./collection-store.js').then((m) => { coll = m; if (!panel.closed) draw(); }).catch(() => {});
          function collectRow(it) {
            if (!coll || it.kind !== 'game' || it.status !== 'done') return null;
            const have = coll.findItem({ kind: 'video', title: it.title }) || coll.findItem({ kind: 'board', title: it.title });
            if (have) return h('button.pill.small.wl-coll.on', { type: 'button', onclick: () => app.go('app', { id: 'collection' }) }, h('i', { html: icon('check') }), 'In your Collection');
            return h('button.pill.small.primary.wl-coll', { type: 'button', onclick: async () => { const r = await coll.openAddToCollection(app, it); if (r && !panel.closed) draw(); } }, h('i', { html: icon('plus') }), 'Add to Collection');
          }
          function setStatus(s) {
            const it = W.getWish(id);
            if (!it || (s === 'done') === (it.status === 'done')) return;
            W.updateWish(id, { status: s });
            app.sfx(s === 'done' ? 'score' : 'tap'); app.vibrate(15);
            app.toast(s === 'done' ? (it.kind === 'game' && coll ? 'Got it! Add it to your Collection?' : `${KIND_META[it.kind].done}! Moved to ${KIND_META[it.kind].done}`) : 'Back on your wish list');
            draw();
          }
          async function editNote() {
            const it = W.getWish(id);
            const v = await app.editText({ title: 'Note', value: it?.note || '', placeholder: 'Where to buy, who recommended it…', okLabel: 'Save' });
            if (v !== null) { W.updateWish(id, { note: v }); draw(); }
          }
          async function editTitle() {
            const it = W.getWish(id);
            const v = await app.editText({ title: `${KIND_META[it.kind].name} title`, value: it.year ? `${it.title} (${it.year})` : it.title });
            if (v) { const p = parseTitle(v); W.updateWish(id, { title: p.title, year: p.year ?? it.year }); draw(); }
          }
          draw();
          panel.onDestroy = W.onWishes(() => { if (!panel.closed) draw(); });
        },
      });
    }

    // ------------------------------------------------------------ add: search the sources
    function openAdd(k = kind) {
      const m = KIND_META[k];
      const modes = k === 'game'
        ? [['store', 'Steam store'], ['wishlist', 'Steam wishlist'], ['psn', 'PlayStation'], ['steamplayed', 'Steam friends']]
        : [];
      let mode = modes[0]?.[0] || 'search';
      app.openPanel({
        title: `Add a ${m.name.toLowerCase()}`, className: 'search-panel wl-add-panel',
        build(body, panel) {
          panel.el.style.setProperty('--k', m.color);
          const ph = { game: 'Search games', movie: 'Search movies', show: 'Search shows', book: 'Title or author' }[k];
          const input = h('input.search-input', { type: 'search', placeholder: ph, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
          const list = h('div.list.wl-res');
          const chips = modes.length ? h('div.wl-modes') : null;
          const useKbd = wantsKeyboard();
          const setKbd = (on) => panel.el.classList.toggle('kbd-open', on);
          body.append(...[h('div.search-bar', input, useKbd ? app.iconBtn('keyboard', 'Keyboard', () => setKbd(!panel.el.classList.contains('kbd-open')), 'kbd-toggle') : null), chips, list].filter(Boolean));
          const recurve = curve(list);
          let seq = 0;
          const drawChips = () => {
            if (!chips) return;
            clear(chips);
            for (const [id, label] of modes) chips.append(h(`button.chip${mode === id ? '.on' : ''}`, { type: 'button', dataset: { m: id }, onclick: () => { setMode(id); } }, label));
          };
          const setMode = (id) => { mode = id; drawChips(); setKbd(false); if (id === 'store') { if (input.value.trim().length >= 2) run(input.value); else hintPage(); } else loadList(id); };

          // rows
          const resultRow = (e) => {
            const on = () => W.hasWish(e);
            const heart = h('span.wl-res-h');
            const paint = () => { const o = on(); heart.innerHTML = W.heartSvg(o); row.classList.toggle('on', o); };
            const art = artBox(e, `thumb${e.source === 'steam' ? '.wide' : ''}`); art._load();
            const row = h('button.row.wl-rrow', { type: 'button', onclick: () => {
              const { item, added } = W.toggleWish({ ...e, inLibrary: e.inLibrary || inLib(e) });
              paint(); heart.classList.remove('pop'); void heart.offsetWidth; heart.classList.add('pop');
              app.sfx(added ? 'pop' : 'drop'); app.vibrate(10);
              if (added && item) { flashId = item.id; app.toast(`♥ ${item.title}`, { ms: 1400 }); }
            } }, art, h('div.row-text', h('div.row-title', { dir: 'auto' }, e.title), e.sub ? h('div.row-sub', e.sub) : null), heart);
            paint();
            return row;
          };
          let libTitles = new Set();
          const inLib = (e) => libTitles.has(`${W.normTitle(e.title)}|${e.year || ''}`) || libTitles.has(`${W.normTitle(e.title)}|`);
          const sec = (t, extra) => h('div.wl-sec', h('span', t), extra || null);
          const byHand = (q) => h('button.row.wl-rrow.manual', { type: 'button', onclick: () => manual(q) },
            h('div.wl-art.thumb.hand', { html: app.icon('edit') }), h('div.row-text', h('div.row-title', q ? `Add “${q}”` : `Type a ${m.name.toLowerCase()}`), h('div.row-sub', q ? 'As you typed it' : 'Just a title — add a note later')));
          const note = (msg) => h('div.wl-res-note', msg);
          async function manual(q) {
            let v = q;
            if (!v) { v = await app.editText({ title: `${m.name} title`, placeholder: k === 'book' ? 'e.g. Project Hail Mary' : k === 'game' ? 'e.g. Hollow Knight: Silksong' : 'e.g. Dune (2021)', okLabel: 'Add' }); if (!v) return; }
            const p = parseTitle(v);
            const it = W.addWish({ kind: k, title: p.title, year: p.year, source: 'manual' });
            if (!it) return;
            app.sfx('pop'); flashId = it.id;
            panel.close();
            if (k !== kind) setKind(k);
            if (filter !== 'wanted' && !it.duplicate) setFilter('wanted');
            app.toast(it.duplicate ? 'Already on your wish list' : `♥ ${it.title}`);
            render(); setTimeout(() => openItem(it.id), 150);
          }
          function hintPage() {
            clear(list);
            const msg = { game: 'Search the Steam store — or pick your Steam wishlist or PlayStation games above.',
              movie: S.libraries().length ? 'Searches your library and iTunes.' : 'Searches iTunes. (Sign in to Plex or Jellyfin to see what you already have.)',
              show: S.libraries().length ? 'Searches your library and iTunes.' : 'Searches iTunes. (Sign in to Plex or Jellyfin to see what you already have.)',
              book: 'Searches Open Library — millions of books.' }[k];
            list.append(note(msg), byHand(''));
            recurve();
          }

          async function run(q) {
            q = q.trim();
            const my = ++seq;
            if (q.length < 2) { hintPage(); return; }
            if (mode !== 'store' && modes.length) { mode = 'store'; drawChips(); }
            clear(list); list.append(h('div.loading', h('div.spin'), h('div', 'Searching…')));
            const parts = [];   // [title, promise]
            if (k === 'book') parts.push(['Open Library', S.searchBooks(q)]);
            else if (k === 'game') parts.push(['Steam store', S.searchSteam(q)]);
            else {
              if (S.libraries().length) parts.push(['In your library', S.searchLibrary(q, k)]);
              parts.push(['iTunes', S.searchItunes(q, k)]);
            }
            const res = await Promise.all(parts.map(([t, p]) => p.then((r) => ({ t, r })).catch((e) => ({ t, err: errText(e) }))));
            if (my !== seq) return;
            clear(list);
            const lib = res.find((x) => x.t === 'In your library')?.r || [];
            libTitles = new Set(lib.flatMap((e) => [`${W.normTitle(e.title)}|${e.year || ''}`, `${W.normTitle(e.title)}|`]));
            let any = false;
            for (const { t, r, err } of res) {
              if (err) { list.append(sec(t), note(err)); continue; }
              if (!r.length) { if (t !== 'In your library') list.append(sec(t), note('Nothing found')); continue; }
              any = true;
              list.append(sec(t));
              for (const e of r) {
                if (t === 'iTunes' && inLib(e)) e.sub = `In your library · ${e.sub}`;
                list.append(resultRow(e));
              }
            }
            list.append(sec(any ? 'Not here?' : 'Add it anyway'), byHand(q));
            list.scrollTop = 0; recurve();
          }
          async function loadList(id) {
            const my = ++seq;
            clear(list); list.append(h('div.loading', h('div.spin'), h('div', 'Loading…')));
            try {
              if (id === 'wishlist') {
                const r = await S.steamWishlist();
                if (my !== seq) return;
                clear(list);
                if (!r.length) { list.append(note('Your Steam wishlist is empty (or private).')); recurve(); return; }
                const addAll = h('button.pill.small.primary', { type: 'button', onclick: () => {
                  let n = 0;
                  for (const e of r) { const it = W.addWish({ ...e, priority: 0 }); if (it && !it.duplicate) n++; }
                  app.sfx('score'); app.toast(n ? `Added ${n} game${n === 1 ? '' : 's'} from your Steam wishlist` : 'They’re all on your list already');
                  [...list.querySelectorAll('.wl-rrow')].forEach((row) => row.classList.add('on'));
                  loadList('wishlist');
                } }, `Add all ${r.length}`);
                list.append(sec(`${r.length} on your Steam wishlist`, addAll));
                r.forEach((e) => list.append(resultRow(e)));
              } else {
                const g = await S.consoleGames(id === 'psn' ? 'playstation' : 'steam');
                if (my !== seq) return;
                clear(list);
                if (g.friends.length) { list.append(sec('Your friends are playing')); g.friends.forEach((e) => list.append(resultRow(e))); }
                if (g.recent.length) { list.append(sec(id === 'psn' ? 'You played recently' : 'You played recently on Steam')); g.recent.forEach((e) => list.append(resultRow(e))); }
                if (!g.friends.length && !g.recent.length) list.append(note('No games to show yet.'));
              }
            } catch (e) {
              if (my !== seq) return;
              clear(list); list.append(note(errText(e)));
            }
            list.scrollTop = 0; recurve();
          }

          const debounced = debounce((v) => run(v), 500);
          input.addEventListener('input', () => debounced(input.value));
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { run(input.value); setKbd(false); } });
          list.addEventListener('pointerdown', () => setKbd(false));
          drawChips(); hintPage();
          if (useKbd) {
            input.readOnly = true;
            input.addEventListener('pointerdown', () => setKbd(true));
            panel.el.appendChild(createKeyboard(input, { onEnter: (v) => { run(v); setKbd(false); } }));
            setKbd(true);
          } else setTimeout(() => input.focus(), 250);
          panel.onDestroy = () => { seq++; render(); };
        },
      });
    }

    // ------------------------------------------------------------ knob / keys
    app.onKey((e) => {
      if (document.querySelector('.panel')) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' && view === 'list') { e.preventDefault(); goTo(sel + 1); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' && view === 'list') { e.preventDefault(); goTo(sel - 1); }
      else if (k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); setKind(KINDS[(KINDS.indexOf(kind) + 1) % 4]); }
      else if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); setKind(KINDS[(KINDS.indexOf(kind) + 3) % 4]); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); if (items[sel]) openItem(items[sel].id); else openAdd(); }
      else if (k === '+' || k === 'a') { e.preventDefault(); openAdd(); }
      else if (/^[0-3]$/.test(k) && items[sel]) { W.updateWish(items[sel].id, { priority: +k }); }
      else if (k === 'd' && items[sel]) { const it = items[sel]; W.updateWish(it.id, { status: it.status === 'done' ? 'wanted' : 'done' }); app.toast(it.status === 'done' ? 'Back on your wish list' : `Moved to ${KIND_META[it.kind].done}`); }
      else if (k === 'v') setView(view === 'ring' ? 'list' : 'ring');
      else if (k === 'Tab') { e.preventDefault(); setFilter(filter === 'done' ? 'wanted' : 'done'); }
    });

    // re-draw on any change (also from other screens), keeping the selected item in place
    offs.push(W.onWishes(() => {
      const cur = items[sel]?.id;
      items = sorted();
      const i = cur ? items.findIndex((x) => x.id === cur) : -1;
      if (i >= 0) sel = i;
      render();
    }));
    let rz = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (view === 'ring' && cards.length) { ring.scrollLeft = sel * slot(); paintRing(true); } }); });
    ro.observe(el);

    render();
    return {
      destroy() { offs.forEach((f) => f()); ro.disconnect(); cancelAnimationFrame(raf); },
    };
  },
};
