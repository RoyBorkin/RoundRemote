// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Collection: your physical video games and board games (and, if you like, your digital ones). Two shelves —
// Video games · Board games — each a fan of covers you turn with a finger or the knob (or a plain list), with
// platform and edition, complete-in-box / loose, players and play time, hours and "beaten", plays with a +1
// button, notes and tags, and loans ("Lent to Dana · 3 weeks") with a Lent-out filter. Search, filters, sort,
// stats with the collection's value, and "Pick something to play" which opens Decide on your own games.
// Six connections (Settings): BoardGameGeek, PriceCharting, RAWG, Steam, PlayStation and spreadsheet imports
// (GamEye, CLZ, Grouvee, BGG CSV, BG Stats, any CSV — from your phone by QR code). Phones can also add a game by
// scanning its barcode.
// Data: apps/collection-store.js · connections: apps/collection-sync.js · parsers + merge rules: apps/collection-sources.js
import { clear } from '../js/ui/dom.js';
import { curve, topPanel } from '../js/ui/overlay.js';
import { createKeyboard, wantsKeyboard } from '../js/ui/keyboard.js';
import { debounce } from '../js/core/util.js';
import { qrSvg } from './qr.js';
import * as C from './collection-store.js';
import * as Y from './collection-sync.js';
import { PLATFORM_CHOICES, PRESETS } from './collection-sources.js';

const { KIND_META, OWNERSHIP, platformName, platformShort } = C;
const KINDS = ['video', 'board'];
const svgPath = (d, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
  meeple: C.MEEPLE,
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  filter: 'M3 5h18v2l-7 7v5l-4 2v-7L3 7z',
  grid: 'M4 5h4v6H4zm6 0h4v6h-4zm6 0h4v6h-4zM4 13h4v6H4zm6 0h4v6h-4zm6 0h4v6h-4z',
  hand: 'M9 11V4.5a1.5 1.5 0 0 1 3 0V10h.5V3.5a1.5 1.5 0 0 1 3 0V10h.5V5.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-.6a7 7 0 0 1-5.3-2.5L2.6 15.4a1.6 1.6 0 0 1 2.3-2.2L7.5 15V7.5a1.5 1.5 0 0 1 1.5-1.5z',
  chart: 'M4 20V10h3v10zm6.5 0V4h3v16zM17 20v-7h3v7z',
  plug: 'M7 2h2v5h6V2h2v5h1a1 1 0 0 1 1 1v3a6 6 0 0 1-5 5.9V22h-4v-5.1A6 6 0 0 1 5 11V8a1 1 0 0 1 1-1h1z',
  phone: 'M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm0 3v15h10V4zm4 16.2a.9.9 0 1 0 1.8 0 .9.9 0 0 0-1.8 0z',
  tag: 'M3 3h8l10 10-8 8L3 11zm4 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  trophy: 'M6 3h12v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.3 12H7a4 4 0 0 1-4-4V5h3zm0 4H5v1a2 2 0 0 0 1 1.7zm12 0v2.7A2 2 0 0 0 19 8V7z',
  barcode: 'M3 5h2v14H3zm3 0h1v14H6zm2 0h2v14H8zm3 0h1v14h-1zm3 0h2v14h-2zm3 0h1v14h-1zm2 0h2v14h-2z',
  file: 'M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5z',
  sync: 'M12 4V1L8 5l4 4V6a6 6 0 0 1 6 6 6 6 0 0 1-.7 2.8l1.5 1.5A8 8 0 0 0 12 4zm0 14a6 6 0 0 1-6-6c0-1 .3-2 .7-2.8L5.2 7.7A8 8 0 0 0 12 20v3l4-4-4-4z',
};
const errText = (e) => e?.body?.error || e?.userMessage || e?.message || 'Something went wrong';
function hue(s) { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x % 360; }
function ago(ms) {
  if (!ms) return '';
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  const d = Math.floor(m / 1440);
  return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : d < 60 ? 'a month ago' : d < 365 ? `${Math.floor(d / 30)} months ago` : new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
const since = (ms) => { const d = Math.floor((Date.now() - ms) / 86400000); return d < 1 ? 'today' : d === 1 ? '1 day' : d < 14 ? `${d} days` : d < 60 ? `${Math.round(d / 7)} weeks` : `${Math.round(d / 30)} months`; };
const fmtPlayers = (p) => (!p ? '' : p[0] === p[1] ? `${p[0]} player${p[0] === 1 ? '' : 's'}` : p[1] >= 20 ? `${p[0]}+ players` : `${p[0]}–${p[1]} players`);
const fmtMin = (m) => (m >= 60 ? `${Math.round(m / 6) / 10} h`.replace('.0 h', ' h') : `${m} min`);
const fmtMins = (t) => (!t ? '' : t[0] === t[1] ? fmtMin(t[0]) : t[1] <= 60 ? `${t[0]}–${t[1]} min` : `${fmtMin(t[0])}–${fmtMin(t[1])}`);
const steamArt = (it) => (it.appid ? [`https://cdn.cloudflare.steamstatic.com/steam/apps/${it.appid}/library_600x900.jpg`, `https://cdn.cloudflare.steamstatic.com/steam/apps/${it.appid}/header.jpg`] : []);
const ownShort = { cib: 'CIB', loose: 'Loose', new: 'Sealed', digital: 'Digital', graded: 'Graded', box: 'Box only', manual: 'Manual only' };
const SORTS = { video: [['title', 'A – Z'], ['added', 'Newest'], ['platform', 'Platform'], ['hours', 'Most played'], ['value', 'Value'], ['year', 'Year']],
  board: [['title', 'A – Z'], ['added', 'Newest'], ['plays', 'Most played'], ['lastPlayed', 'Played lately'], ['rating', 'Rating'], ['value', 'Value']] };
const DEF_F = { sort: 'title', plat: 'any', pl: 'any', time: 'any', status: 'any', quick: 'all', hideDigital: false };

export default {
  css: './collection.css',
  create(el, app) {
    const { h, icon } = app;
    const kglyph = (k) => (k === 'board' ? svgPath(ICON.meeple) : icon('gamepad'));
    // panels live outside the app box: give them the shelf's colour
    const openPanel = (o) => { const p = app.openPanel(o); if (!p.el.style.getPropertyValue('--k')) p.el.style.setProperty('--k', KIND_META[kind].color); return p; };
    let kind = KINDS.includes(app.data('kind')) ? app.data('kind') : 'video';
    let view = app.data('view', 'ring');
    const filters = { video: { ...DEF_F, ...(app.data('filters', {}).video || {}) }, board: { ...DEF_F, ...(app.data('filters', {}).board || {}) } };
    const F = () => filters[kind];
    const saveF = () => app.save('filters', filters);
    let sel = 0, items = [], flashId = null;
    const offs = [];

    // ------------------------------------------------------------ skeleton
    const tabs = h('div.cl-tabs', { role: 'tablist' });
    const quick = h('div.cl-quick');
    const ring = h('div.cl-ring', { tabindex: '-1' });
    const info = h('div.cl-info');
    const rim = h('div.cl-rim', { html: '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="cl-rim-t" d="M 18.82 87.13 A 48.5 48.5 0 0 0 81.18 87.13"/><circle class="cl-rim-k" r="1.3" cx="50" cy="98.5"/></svg>' });
    const listEl = h('div.cl-list.list');
    const reCurve = curve(listEl);
    const empty = h('div.cl-empty');
    const btn = (cls, label, ic, fn) => h(`button.cl-btn${cls}`, { type: 'button', 'aria-label': label, onclick: fn }, h('i', { html: ic }), h('span', label));
    const btnView = btn('.b-view', 'List', icon('list'), () => setView(view === 'ring' ? 'list' : 'ring'));
    const btnSearch = btn('.b-search', 'Search', icon('search'), () => openSearch());
    const btnAdd = h('button.cl-add', { type: 'button', 'aria-label': 'Add a game', onclick: () => openAdd() }, h('i', { html: icon('plus') }));
    const btnFilter = btn('.b-filter', 'Filter', svgPath(ICON.filter), () => openFilters());
    const btnMore = btn('.b-more', 'More', icon('more'), () => openMenu());
    const fdot = h('b.cl-fdot');
    btnFilter.querySelector('i').append(fdot);
    el.classList.add('cl');
    app.hideTitle();
    el.append(tabs, quick, ring, rim, info, listEl, empty, h('div.cl-bar', btnView, btnSearch, btnAdd, btnFilter, btnMore));

    // ------------------------------------------------------------ the shelf: filters + sort
    const shelfAll = (k = kind) => { const all = C.items(k); return k === 'board' ? all.filter((x) => !C.underBase(x, all)) : all; };
    const isPlayed = (x) => (x.plays || 0) > 0 || (x.hours || 0) > 0 || !!x.beaten || !!x.lastPlayed;
    function passes(x, f = F(), k = kind) {
      if (k === 'video' && f.hideDigital && x.digital) return false;
      if (f.quick === 'lent' && !x.lent?.name) return false;
      if (f.quick === 'new' && isPlayed(x)) return false;
      if (k === 'video' && f.plat !== 'any' && (f.plat === 'digital' ? !x.digital : (x.platform || '') !== f.plat)) return false;
      if (f.status === 'unplayed' && isPlayed(x)) return false;
      if (f.status === 'played' && !isPlayed(x)) return false;
      if (f.status === 'beaten' && !x.beaten) return false;
      if (f.status === 'unbeaten' && x.beaten) return false;
      if (k === 'board' && f.pl !== 'any') {
        const [lo, hi] = x.players || [1, 99];
        const n = f.pl === '5' ? 5 : f.pl === '34' ? 3 : +f.pl;
        if (f.pl === '34' ? !(lo <= 4 && hi >= 3) : f.pl === '5' ? hi < 5 : !(lo <= n && hi >= n)) return false;
      }
      if (k === 'board' && f.time !== 'any') {
        const t = x.mins ? x.mins[0] : null;
        if (t == null) return false;
        if (f.time === 'long' ? t <= 120 : t > +f.time) return false;
      }
      return true;
    }
    function sorted() {
      const f = F();
      const l = shelfAll().filter((x) => passes(x));
      const t = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
      const by = {
        title: t, added: (a, b) => (b.added || 0) - (a.added || 0) || t(a, b),
        platform: (a, b) => platformName(a.platform || 'zzz').localeCompare(platformName(b.platform || 'zzz')) || t(a, b),
        hours: (a, b) => (b.hours || 0) - (a.hours || 0) || t(a, b), plays: (a, b) => (b.plays || 0) - (a.plays || 0) || t(a, b),
        lastPlayed: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || t(a, b), rating: (a, b) => (b.rating || 0) - (a.rating || 0) || t(a, b),
        value: (a, b) => (b.value || 0) - (a.value || 0) || t(a, b), year: (a, b) => (b.year || 0) - (a.year || 0) || t(a, b),
      }[f.sort] || t;
      return l.sort(by);
    }
    const activeFilters = (f = F(), k = kind) => [k === 'video' && f.plat !== 'any', k === 'board' && f.pl !== 'any', k === 'board' && f.time !== 'any', f.status !== 'any', k === 'video' && f.hideDigital].filter(Boolean).length;

    // ------------------------------------------------------------ chrome
    function renderTabs() {
      clear(tabs);
      for (const k of KINDS) {
        const n = shelfAll(k).length;
        tabs.append(h(`button.cl-tab${k === kind ? '.on' : ''}`, { type: 'button', role: 'tab', '--k': KIND_META[k].color, 'aria-selected': String(k === kind), 'aria-label': KIND_META[k].plural, dataset: { k },
          onclick: () => setKind(k) }, h('i', { html: kglyph(k) }), h('span.cl-tab-n', KIND_META[k].plural), h('span.cl-tab-c', String(n))));
      }
      el.style.setProperty('--k', KIND_META[kind].color);
      el.dataset.kind = kind;
    }
    function renderQuick() {
      clear(quick);
      const f = F();
      const base = shelfAll().filter((x) => passes(x, { ...f, quick: 'all' }));
      const nLent = base.filter((x) => x.lent?.name).length, nNew = base.filter((x) => !isPlayed(x)).length;
      const chip = (val, label, n) => h(`button.chip${f.quick === val ? '.on' : ''}`, { type: 'button', dataset: { q: val }, onclick: () => setQuick(val) }, label, n != null ? h('b', String(n)) : null);
      quick.append(chip('all', 'All ', base.length), chip('lent', 'Lent out ', nLent), chip('new', kind === 'board' ? 'Never played ' : 'Unplayed ', nNew),
        h('button.chip.cl-pick', { type: 'button', 'aria-label': 'Pick something to play', onclick: () => pickToPlay() }, h('i', { html: svgPath(ICON.dice) }), 'Pick'));
      const n = activeFilters();
      fdot.textContent = n ? String(n) : '';
      btnFilter.classList.toggle('has', !!n);
      btnView.querySelector('i').innerHTML = view === 'ring' ? icon('list') : svgPath(ICON.grid);
      btnView.querySelector('span').textContent = view === 'ring' ? 'List' : 'Covers';
      btnView.setAttribute('aria-label', view === 'ring' ? 'Show as a list' : 'Show as covers');
    }
    function setKind(k) {
      if (k === kind) return;
      kind = k; app.save('kind', k); sel = 0; app.sfx('tick');
      render();
    }
    function setQuick(v) { if (F().quick === v) v = 'all'; F().quick = v; saveF(); sel = 0; app.sfx('tap'); render(); }
    function setView(v) { view = v; app.save('view', v); app.sfx('tap'); render(); }

    // ------------------------------------------------------------ covers
    function artBox(it, cls = '') {
      const box = h(`div.cl-art${cls ? '.' + cls : ''}`, { '--h': String(hue(it.title)) },
        h('div.cl-art-ph', h('i', { html: kglyph(it.kind) }), h('span', { dir: 'auto' }, it.title)));
      const urls = [it.art, ...steamArt(it)].filter(Boolean);
      const tryNext = () => {
        const u = urls.shift();
        if (!u) return;
        const im = new Image();
        im.onload = () => {
          if (im.naturalWidth < 8) { tryNext(); return; }
          const r = im.naturalWidth / (im.naturalHeight || 1);
          box.style.setProperty('--img', `url("${u.replace(/"/g, '%22')}")`);
          box.classList.add('loaded'); box.classList.toggle('fit', it.kind === 'board' ? r > 1.25 || r < 0.8 : r > 0.82);
        };
        im.onerror = tryNext;
        im.src = u;
      };
      box._load = () => { if (!box._started) { box._started = true; tryNext(); } };
      return box;
    }
    const metaBits = (it) => (it.kind === 'board'
      ? [fmtPlayers(it.players), fmtMins(it.mins), it.expansion ? 'Expansion' : '', it.year]
      : [it.digital && !it.platform ? 'Digital' : platformShort(it.platform), it.digital ? (it.platform ? 'Digital' : '') : ownShort[it.ownership] || '', it.edition, it.year]).filter(Boolean);
    const statusBits = (it) => [
      it.lent?.name ? h('span.cl-mini.lent', h('i', { html: svgPath(ICON.hand) }), `Lent to ${it.lent.name}`) : null,
      it.kind === 'board' && it.plays ? h('span.cl-mini', h('i', { html: svgPath(ICON.dice) }), `${it.plays} play${it.plays === 1 ? '' : 's'}`) : null,
      it.kind === 'video' && it.beaten ? h('span.cl-mini.ok', h('i', { html: svgPath(ICON.trophy) }), 'Beaten') : null,
      it.kind === 'video' && it.hours ? h('span.cl-mini', h('i', { html: icon('clock') }), `${it.hours} h`) : null,
      (it.qty || 1) > 1 ? h('span.cl-mini', `×${it.qty}`) : null,
    ].filter(Boolean);
    const srcDots = (it) => h('span.cl-dots', Object.keys(it.sources || {}).map((s) => h('i', { '--s': C.SOURCES[s]?.color || '#94a3b8', title: C.sourceName(s) })));

    // ------------------------------------------------------------ the fan of covers
    let cards = [], pos = 0, touched = new Set(), raf = 0;
    const slot = () => ring.clientWidth * (kind === 'board' ? 0.25 : 0.205);
    function renderRing() {
      clear(ring); cards = []; touched = new Set();
      items.forEach((it, i) => {
        const art = artBox(it);
        const card = h('button.cl-card', { type: 'button', dataset: { id: it.id, i: String(i) }, 'aria-label': it.title,
          onclick: () => { if (i === Math.round(pos)) openItem(it.id); else goTo(i); } },
          art, it.lent?.name ? h('span.cl-lent-tag', { title: `Lent to ${it.lent.name}`, html: svgPath(ICON.hand) }) : null,
          it.beaten ? h('span.cl-beat-tag', { html: svgPath(ICON.trophy) }) : null, it.digital ? h('span.cl-dig-tag', 'DIGITAL') : null);
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
      for (const i of touched) if (!now.has(i) && cards[i]) cards[i].style.opacity = '0';
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
      const f = Math.max(0, Math.min(1, pos / (n - 1)));
      const a = ((220 - 80 * f) * Math.PI) / 180;
      const k = rim.querySelector('.cl-rim-k');
      k.setAttribute('cx', (50 + 48.5 * Math.sin(a)).toFixed(2)); k.setAttribute('cy', (50 - 48.5 * Math.cos(a)).toFixed(2));
    }
    function goTo(i, smooth = true) {
      if (!items.length) return;
      i = Math.max(0, Math.min(items.length - 1, i));
      if (i !== sel) app.sfx('tick');
      if (view === 'ring') ring.scrollTo({ left: i * slot(), behavior: smooth ? 'smooth' : 'auto' });
      else { sel = i; markListSel(true); }
    }
    let wheelAcc = 0, wheelT = 0;
    el.addEventListener('wheel', (e) => {
      if (!items.length || topPanel()) return;
      e.preventDefault();
      wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(wheelAcc) >= 40 && performance.now() - wheelT > 90) { goTo(sel + Math.sign(wheelAcc)); wheelAcc = 0; wheelT = performance.now(); }
    }, { passive: false });

    function renderInfo() {
      clear(info);
      const it = items[sel];
      if (!it) return;
      const st = statusBits(it);
      info.append(
        h('div.cl-info-t', { dir: 'auto' }, it.title),
        h('div.cl-info-m', metaBits(it).join(' · ') || C.sourceName(Object.keys(it.sources || {})[0])),
        ...(st.length ? [h('div.cl-info-s', ...st.slice(0, 2))] : []),
      );
      info.classList.remove('in'); void info.offsetWidth; info.classList.add('in');
    }

    // ------------------------------------------------------------ list view
    function renderList() {
      clear(listEl);
      items.forEach((it, i) => {
        const row = h(`button.row.cl-row${i === sel ? '.sel' : ''}${it.id === flashId ? '.flash' : ''}`, { type: 'button', dataset: { id: it.id }, onclick: () => { sel = i; openItem(it.id); } },
          artBox(it, 'thumb'),
          h('div.row-text', h('div.row-title', { dir: 'auto' }, it.title),
            h('div.row-sub', [...metaBits(it).slice(0, 3), it.lent?.name ? `Lent to ${it.lent.name}` : '', it.kind === 'board' && it.plays ? `${it.plays} plays` : '', it.beaten ? 'Beaten' : ''].filter(Boolean).join(' · '))),
          srcDots(it));
        row.querySelector('.cl-art')._load();
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
      const total = shelfAll().length;
      const filtered = total > 0;
      empty.append(
        h('div.cl-empty-ic', { html: kglyph(kind) }),
        h('div.cl-empty-t', filtered ? 'Nothing matches' : `No ${m.plural.toLowerCase()} yet`),
        h('div.cl-empty-m', filtered ? (F().quick === 'lent' ? 'Nothing is lent out right now.' : 'Loosen the filters to see more of your shelf.')
          : kind === 'board' ? 'Sync your BoardGameGeek collection, import a BG Stats or BGG export from your phone — or add games one by one.'
            : 'Import your GamEye, CLZ or Grouvee list from your phone, connect PriceCharting, RAWG, Steam or PlayStation — or scan a barcode.'),
        h('div.cl-empty-b',
          filtered ? h('button.pill.small', { type: 'button', onclick: () => { filters[kind] = { ...DEF_F, sort: F().sort }; saveF(); render(); } }, 'Show everything')
            : h('button.pill.small', { type: 'button', onclick: () => openConnections() }, 'Connect'),
          h('button.pill.small.primary', { type: 'button', onclick: () => openAdd() }, 'Add a game')));
    }

    function render() {
      items = sorted();
      if (flashId) { const i = items.findIndex((x) => x.id === flashId); if (i >= 0) sel = i; }
      sel = Math.max(0, Math.min(items.length - 1, sel));
      el.dataset.view = view; el.dataset.empty = String(!items.length);
      renderTabs(); renderQuick();
      if (!items.length) { clear(ring); clear(listEl); clear(info); cards = []; renderEmpty(); paintRim(); return; }
      if (view === 'ring') { clear(listEl); renderRing(); } else { clear(ring); cards = []; clear(info); renderList(); paintRim(); }
      if (flashId) { const id = flashId; setTimeout(() => { if (flashId === id) flashId = null; }, 1600); }
    }

    // ------------------------------------------------------------ one game
    function openItem(id) {
      openPanel({
        title: '', className: 'cl-item-panel',
        build(body, panel) {
          const draw = () => {
            const it = C.getItem(id);
            if (!it) { panel.close(); return; }
            const m = KIND_META[it.kind];
            panel.setTitle(it.kind === 'board' ? (it.expansion ? 'Expansion' : 'Board game') : (it.digital ? 'Digital game' : 'Video game'));
            panel.el.style.setProperty('--k', m.color);
            panel.el.dataset.kind = it.kind;
            const keep = body.scrollTop;
            clear(body);
            const art = artBox(it, 'hero'); art._load();
            const chips = [];
            if (it.kind === 'board') {
              if (it.players) chips.push(['people', fmtPlayers(it.players)]);
              if (it.mins) chips.push(['clock', fmtMins(it.mins)]);
              if (it.age) chips.push(['person', `${it.age}+`]);
              if (it.rating) chips.push(['star', (Math.round(it.rating * 10) / 10).toFixed(1)]);
            } else {
              if (it.platform) chips.push(['gamepad', platformName(it.platform)]);
              if (it.ownership) chips.push(['check', OWNERSHIP[it.ownership] || it.ownership]);
              if (it.hours) chips.push(['clock', `${it.hours} h played`]);
            }
            if (it.value) chips.push(['tag', `${C.fmtMoney(it.value)}${(it.qty || 1) > 1 ? ` ×${it.qty}` : ''}`]);
            const exps = C.expansionsOf(it);
            body.append(h('div.cl-item',
              h('div.cl-head', art, h('div.cl-head-r',
                h('button.cl-item-t', { type: 'button', dir: 'auto', onclick: () => editField('title'), 'aria-label': 'Edit title' }, it.title),
                h('div.cl-item-m', [it.kind === 'video' ? platformName(it.platform) || 'Platform?' : '', it.edition, it.year].filter(Boolean).join(' · ') || ' '),
                h('div.cl-badges', Object.keys(it.sources || { manual: 1 }).map((s) => h('span.cl-src', { '--s': C.SOURCES[s]?.color || '#94a3b8' }, h('i'), C.SOURCES[s]?.short || C.sourceName(s)))),
                h('div.cl-when', `Added ${ago(it.added)}`))),
              chips.length ? h('div.cl-chips', chips.map(([ic, t]) => h('span.cl-chip', h('i', { html: ic === 'tag' ? svgPath(ICON.tag) : icon(ic) }), t))) : null,
              it.kind === 'board' ? playsBox(it) : beatBox(it),
              lendBox(it),
              h(`button.cl-note${it.notes ? '' : '.empty'}`, { type: 'button', dir: 'auto', onclick: () => editField('notes') }, h('i', { html: icon('edit') }), h('span', it.notes || 'Add a note — edition, where it is, house rules…')),
              h('div.cl-tags', (it.tags || []).map((t) => h('span.cl-tagc', { dir: 'auto' }, `#${t}`)), h('button.cl-tagc.add', { type: 'button', onclick: () => editField('tags') }, (it.tags || []).length ? 'Edit tags' : '+ Tags')),
              exps.length ? h('div.cl-exps', h('div.cl-sec', `${exps.length} expansion${exps.length === 1 ? '' : 's'}`),
                exps.map((x) => h('button.row.cl-exp', { type: 'button', onclick: () => openItem(x.id) }, artBox(x, 'thumb.sq'), h('div.row-text', h('div.row-title', { dir: 'auto' }, x.title), h('div.row-sub', [x.year, x.plays ? `${x.plays} plays` : ''].filter(Boolean).join(' · ') || 'Expansion'))))) : null,
              it.paid || it.condition ? h('div.cl-fine', [it.condition, it.paid ? `Paid ${C.fmtMoney(it.paid)}` : ''].filter(Boolean).join(' · ')) : null,
              h('div.cl-item-acts',
                h('button.pill.small', { type: 'button', onclick: () => openEdit(id) }, 'Edit details'),
                h('button.pill.small.danger', { type: 'button', onclick: () => confirmRemove(it, panel) }, 'Remove'))));
            body.scrollTop = keep;
            body.querySelectorAll('.cl-exp .cl-art').forEach((a) => a._load?.());
          };
          // board games: plays with +1
          const playsBox = (it) => h('div.cl-plays',
            h('button.cl-pm', { type: 'button', 'aria-label': 'One play less', disabled: !it.plays, onclick: () => { C.addPlay(id, -1); app.sfx('drop'); } }, '−'),
            h('div.cl-plays-c', h('b', String(it.plays || 0)), h('span', `${it.plays === 1 ? 'play' : 'plays'}${it.lastPlayed ? ` · last ${ago(it.lastPlayed)}` : ''}`)),
            h('button.cl-pm.plus', { type: 'button', 'aria-label': 'Played it (+1)', onclick: () => { C.addPlay(id, 1); app.sfx('score'); app.vibrate(15); } }, '+1'));
          // video games: beaten / not yet
          const beatBox = (it) => h('div.cl-seg2',
            h(`button.cl-st${!it.beaten ? '.on' : ''}`, { type: 'button', onclick: () => { C.updateItem(id, { beaten: false }); app.sfx('tap'); } }, isPlayed(it) && !it.beaten ? 'Playing' : 'Not beaten'),
            h(`button.cl-st.ok${it.beaten ? '.on' : ''}`, { type: 'button', onclick: () => { C.updateItem(id, { beaten: true }); app.sfx('score'); app.vibrate(15); } }, h('i', { html: svgPath(ICON.trophy) }), 'Beaten'));
          const lendBox = (it) => (it.lent?.name
            ? h('div.cl-lend.on', h('i', { html: svgPath(ICON.hand) }), h('div', h('b', { dir: 'auto' }, `Lent to ${it.lent.name}`), h('span', it.lent.at ? `${since(it.lent.at)} ago · ${new Date(it.lent.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : '')),
              h('button.pill.small', { type: 'button', onclick: () => { C.unlend(id); app.sfx('coin'); app.toast(`“${it.title}” is back`); } }, 'Returned'))
            : h('button.cl-lend', { type: 'button', onclick: async () => {
              const v = await app.editText({ title: 'Lend it to…', placeholder: 'Name', okLabel: 'Lend' });
              if (v) { C.lend(id, v); app.sfx('pop'); }
            } }, h('i', { html: svgPath(ICON.hand) }), h('span', 'Lend it to someone…')));
          async function editField(f) {
            const it = C.getItem(id);
            if (f === 'title') { const v = await app.editText({ title: 'Title', value: it.title }); if (v) C.updateItem(id, { title: v }); }
            if (f === 'notes') { const v = await app.editText({ title: 'Note', value: it.notes || '', placeholder: 'Edition, where it is, house rules…', okLabel: 'Save' }); if (v !== null) C.updateItem(id, { notes: v }); }
            if (f === 'tags') {
              const v = await app.editText({ title: 'Tags (comma separated)', value: (it.tags || []).join(', '), placeholder: 'favourite, family, co-op', okLabel: 'Save' });
              if (v !== null) C.updateItem(id, { tags: [...new Set(v.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean))].slice(0, 12) });
            }
          }
          draw();
          panel.onDestroy = C.onItems(() => { if (!panel.closed) draw(); });
        },
      });
    }
    function confirmRemove(it, itemPanel) {
      openPanel({
        title: 'Remove?', className: 'cl-confirm',
        build(body, panel) {
          body.append(h('div.cl-conf', h('div.cl-conf-t', { dir: 'auto' }, `Remove “${it.title}” from your collection?`),
            Object.keys(it.sources || {}).some((s) => ['bgg', 'pricecharting', 'rawg', 'steam'].includes(s)) ? h('div.cl-conf-m', 'It will come back on the next sync unless you remove it there too.') : null,
            h('div.cl-conf-b', h('button.pill', { type: 'button', onclick: () => panel.close() }, 'Keep'),
              h('button.pill.danger', { type: 'button', onclick: () => { C.removeItem(it.id); app.sfx('drop'); app.toast(`Removed “${it.title}”`); panel.close(); itemPanel.close(); } }, 'Remove'))));
        },
      });
    }

    // ------------------------------------------------------------ edit details
    function openEdit(id) {
      openPanel({
        title: 'Edit details', className: 'cl-edit-panel',
        build(body, panel) {
          const list = h('div.list.cl-elist');
          body.append(list);
          const recurve = curve(list);
          const draw = () => {
            const it = C.getItem(id);
            if (!it) { panel.close(); return; }
            clear(list);
            const row = (label, value, fn) => list.append(h('button.row.cl-erow', { type: 'button', onclick: fn }, h('div.row-text', h('div.row-sub', label), h('div.row-title', { dir: 'auto' }, value || '—')), h('i.cl-chev', { html: icon('chevron') })));
            const text = (f, label, ph = '', conv = (v) => v, show = (v) => v) => row(label, show(it[f]), async () => {
              const v = await app.editText({ title: label, value: it[f] != null ? String(show(it[f])) : '', placeholder: ph, okLabel: 'Save' });
              if (v !== null) C.updateItem(id, { [f]: conv(v) });
            });
            text('title', 'Title');
            if (it.kind === 'video') {
              row('Platform', platformName(it.platform), () => choose('Platform', [...new Set([it.platform, ...PLATFORM_CHOICES].filter(Boolean))].map((p) => [p, platformShort(p)]), it.platform, (v) => C.updateItem(id, { platform: v }), true));
              row('What you have', OWNERSHIP[it.ownership] || '', () => choose('What you have', [['', 'Not set'], ...Object.entries(OWNERSHIP)], it.ownership || '', (v) => C.updateItem(id, { ownership: v, digital: v === 'digital' })));
              text('hours', 'Hours played', 'e.g. 42', (v) => Math.max(0, parseFloat(v) || 0));
              text('completion', 'Progress', 'e.g. 100%, main story done');
            } else {
              text('players', 'Players', 'e.g. 2-4', (v) => { const m = [...v.matchAll(/\d+/g)].map((x) => +x[0]); return m.length ? [m[0], Math.max(m[0], m[m.length - 1] || m[0])] : null; }, (v) => (v ? `${v[0]}–${v[1]}` : ''));
              text('mins', 'Play time (minutes)', 'e.g. 30-60', (v) => { const m = [...v.matchAll(/\d+/g)].map((x) => +x[0]); return m.length ? [m[0], Math.max(m[0], m[m.length - 1] || m[0])] : null; }, (v) => (v ? `${v[0]}–${v[1]}` : ''));
              text('plays', 'Plays', '0', (v) => Math.max(0, parseInt(v, 10) || 0));
            }
            text('edition', 'Edition / region', 'e.g. Collector’s, PAL');
            text('condition', 'Condition', 'e.g. Box worn, manual missing');
            text('year', 'Year', 'e.g. 2017', (v) => parseInt(v, 10) || null);
            text('qty', 'Copies', '1', (v) => Math.max(1, parseInt(v, 10) || 1));
            text('paid', 'Price paid', 'e.g. 39.99', (v) => (v.trim() ? Math.round(parseFloat(v.replace(',', '.')) * 100) || null : null), (v) => (v ? (v / 100).toFixed(2) : ''));
            text('value', 'Value', 'e.g. 25', (v) => (v.trim() ? Math.round(parseFloat(v.replace(',', '.')) * 100) || null : null), (v) => (v ? (v / 100).toFixed(2) : ''));
            if (it.kind === 'board') row('Expansion', it.expansion ? 'Yes' : 'No', () => C.updateItem(id, { expansion: !it.expansion }));
            else row('Digital copy', it.digital ? 'Yes' : 'No', () => C.updateItem(id, { digital: !it.digital }));
            recurve();
          };
          draw();
          panel.onDestroy = C.onItems(() => { if (!panel.closed) draw(); });
        },
      });
    }
    function choose(title, opts, cur, onPick, other = false) {
      openPanel({
        title, className: 'cl-choose',
        build(body, panel) {
          body.append(h('div.cl-choose-c', opts.map(([v, label]) => h(`button.chip${v === cur ? '.on' : ''}`, { type: 'button', onclick: () => { onPick(v); app.sfx('tick'); panel.close(); } }, label)),
            other ? h('button.chip', { type: 'button', onclick: async () => { const v = await app.editText({ title, placeholder: 'e.g. Sega Saturn', okLabel: 'Save' }); if (v) { onPick(v); panel.close(); } } }, 'Other…') : null));
        },
      });
    }

    // ------------------------------------------------------------ add a game
    function openAdd(k = kind) {
      const m = KIND_META[k];
      openPanel({
        title: `Add a ${m.name.toLowerCase()}`, className: 'search-panel cl-add-panel',
        build(body, panel) {
          panel.el.style.setProperty('--k', m.color);
          const input = h('input.search-input', { type: 'search', placeholder: k === 'board' ? 'Search board games' : 'Search games', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
          const list = h('div.list.cl-res');
          const useKbd = wantsKeyboard();
          const setKbd = (on) => panel.el.classList.toggle('kbd-open', on);
          body.append(h('div.search-bar', input, useKbd ? app.iconBtn('keyboard', 'Keyboard', () => setKbd(!panel.el.classList.contains('kbd-open')), 'kbd-toggle') : null), list);
          const recurve = curve(list);
          let seq = 0, can = null;
          const note = (msg) => h('div.cl-res-note', msg);
          const sec = (t) => h('div.cl-sec', t);
          const byHand = (q) => h('button.row.cl-rrow.manual', { type: 'button', onclick: () => manual(q) },
            h('div.cl-art.thumb.hand', { html: icon('edit') }), h('div.row-text', h('div.row-title', q ? `Add “${q}”` : 'Type the title'), h('div.row-sub', q ? 'As you typed it' : 'Add the details later')));
          const phoneRow = () => h('button.row.cl-rrow.manual', { type: 'button', onclick: () => { panel.close(); openPhone('add'); } },
            h('div.cl-art.thumb.hand', { html: svgPath(ICON.barcode) }), h('div.row-text', h('div.row-title', 'Scan a barcode with your phone'), h('div.row-sub', 'Or upload your GamEye / CLZ / BGG export')));
          const added = (it) => {
            if (!it) return;
            app.sfx('pop'); flashId = it.id;
            panel.close();
            if (it.kind !== kind) { kind = it.kind; app.save('kind', kind); }
            if (!it.duplicate && !passes(it)) { filters[kind] = { ...DEF_F, sort: F().sort }; saveF(); }
            app.toast(it.duplicate ? 'Already in your collection' : `Added “${it.title}”`);
            render(); setTimeout(() => openItem(it.id), 160);
          };
          async function manual(q) {
            let v = q;
            if (!v) { v = await app.editText({ title: `${m.name} title`, placeholder: k === 'board' ? 'e.g. Wingspan' : 'e.g. Super Mario Odyssey', okLabel: 'Next' }); if (!v) return; }
            if (k === 'board') { added(C.addItem({ kind: 'board', title: v, source: 'manual' })); return; }
            choosePlatform(null, (p) => added(C.addItem({ kind: 'video', title: v, platform: p, source: 'manual' })));
          }
          function choosePlatform(e, done) {
            const opts = (e?.platforms || []).map((p) => C.canonPlatform(p)).filter(Boolean);
            const list2 = [...new Set([...opts, ...PLATFORM_CHOICES])].slice(0, opts.length ? Math.max(opts.length, 8) : 14);
            choose('Which platform?', list2.map((p) => [p, platformShort(p)]), null, done, true);
          }
          const resultRow = (e) => {
            const art = artBox({ ...e, kind: k }, 'thumb'); art._load();
            const have = C.findItem({ kind: k, title: e.title, platform: e.platform });
            return h(`button.row.cl-rrow${have ? '.on' : ''}`, { type: 'button', onclick: () => {
              if (k === 'board') added(C.addItem({ ...e, kind: 'board', source: e.source || 'bgg' }));
              else if (e.platform) added(C.addItem({ ...e, kind: 'video', source: e.source || 'rawg' }));
              else choosePlatform(e, (p) => added(C.addItem({ ...e, kind: 'video', platform: p, source: e.source || 'rawg' })));
            } }, art, h('div.row-text', h('div.row-title', { dir: 'auto' }, e.title),
              h('div.row-sub', [e.year, k === 'board' ? fmtPlayers(e.players) : (e.platforms || []).slice(0, 3).map((p) => platformShort(C.canonPlatform(p))).join(', '), have ? 'In your collection' : ''].filter(Boolean).join(' · '))),
            have ? h('i.cl-have', { html: icon('check') }) : null);
          };
          function hintPage() {
            clear(list);
            const src = k === 'board' ? 'BoardGameGeek' : 'RAWG';
            list.append(note(can === false ? `Type a title. (Set up ${src} in Settings → Connections to search with covers.)` : can ? `Searches ${src} — covers and details included.` : 'Type a title.'), byHand(''), phoneRow());
            recurve();
          }
          async function run(q) {
            q = q.trim();
            const my = ++seq;
            if (q.length < 2) { hintPage(); return; }
            clear(list);
            if (can) {
              list.append(h('div.loading', h('div.spin'), h('div', 'Searching…')));
              let r = null, err = null;
              try { r = await Y.search(k, q); } catch (e) { err = errText(e); }
              if (my !== seq) return;
              clear(list);
              if (err) list.append(note(err));
              else if (!r.length) list.append(note('Nothing found'));
              else { list.append(sec(k === 'board' ? 'BoardGameGeek' : 'RAWG')); r.forEach((e) => list.append(resultRow(e))); }
            }
            const mine = C.items(k).filter((x) => C.normTitle(x.title).includes(C.normTitle(q))).slice(0, 3);
            if (mine.length) { list.append(sec('Already in your collection')); mine.forEach((x) => list.append(h('button.row.cl-rrow.on', { type: 'button', onclick: () => { panel.close(); openItem(x.id); } }, (() => { const a = artBox(x, 'thumb'); a._load(); return a; })(), h('div.row-text', h('div.row-title', { dir: 'auto' }, x.title), h('div.row-sub', metaBits(x).join(' · '))), h('i.cl-have', { html: icon('check') })))); }
            if (can || mine.length) list.append(sec('Not here?'));
            list.append(byHand(q));
            list.scrollTop = 0; recurve();
          }
          const debounced = debounce((v) => run(v), 500);
          input.addEventListener('input', () => debounced(input.value));
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { run(input.value); setKbd(false); } });
          list.addEventListener('pointerdown', () => setKbd(false));
          hintPage();
          Y.info().then((inf) => { can = Y.configured(k === 'board' ? 'bgg' : 'rawg', inf) || (k === 'video' && !!inf?.conns?.rawg?.hasKey); if (!input.value.trim()) hintPage(); }).catch(() => { can = false; if (!input.value.trim()) hintPage(); });
          if (useKbd) {
            input.readOnly = true;
            input.addEventListener('pointerdown', () => setKbd(true));
            panel.el.appendChild(createKeyboard(input, { onEnter: (v) => { run(v); setKbd(false); } }));
            setKbd(true);
          } else setTimeout(() => input.focus(), 250);
          panel.onDestroy = () => { seq++; };
        },
      });
    }

    // ------------------------------------------------------------ search your collection
    function openSearch() {
      openPanel({
        title: 'Search your collection', className: 'search-panel cl-add-panel',
        build(body, panel) {
          panel.el.style.setProperty('--k', KIND_META[kind].color);
          const input = h('input.search-input', { type: 'search', placeholder: 'Title, platform, tag, who has it…', autocomplete: 'off', spellcheck: 'false' });
          const list = h('div.list.cl-res');
          const useKbd = wantsKeyboard();
          const setKbd = (on) => panel.el.classList.toggle('kbd-open', on);
          body.append(h('div.search-bar', input, useKbd ? app.iconBtn('keyboard', 'Keyboard', () => setKbd(!panel.el.classList.contains('kbd-open')), 'kbd-toggle') : null), list);
          const recurve = curve(list);
          const run = () => {
            const q = C.normTitle(input.value);
            clear(list);
            const all = C.items();
            const hits = !q ? [] : all.filter((x) => [x.title, platformName(x.platform), platformShort(x.platform), x.edition, x.notes, (x.tags || []).join(' '), x.lent?.name, x.digital ? 'digital' : ''].some((s) => s && C.normTitle(s).includes(q)));
            if (!q) list.append(h('div.cl-res-note', `${all.length} games on your shelves — type to find one.`));
            else if (!hits.length) list.append(h('div.cl-res-note', 'Nothing found'));
            for (const x of hits.slice(0, 60)) {
              const a = artBox(x, 'thumb'); a._load();
              list.append(h('button.row.cl-rrow', { type: 'button', onclick: () => { panel.close(); openItem(x.id); } }, a,
                h('div.row-text', h('div.row-title', { dir: 'auto' }, x.title), h('div.row-sub', [KIND_META[x.kind].short, ...metaBits(x).slice(0, 2), x.lent?.name ? `Lent to ${x.lent.name}` : ''].filter(Boolean).join(' · ')))));
            }
            recurve();
          };
          input.addEventListener('input', run);
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') setKbd(false); });
          list.addEventListener('pointerdown', () => setKbd(false));
          run();
          if (useKbd) {
            input.readOnly = true;
            input.addEventListener('pointerdown', () => setKbd(true));
            panel.el.appendChild(createKeyboard(input, { onEnter: () => setKbd(false) }));
            setKbd(true);
          } else setTimeout(() => input.focus(), 250);
        },
      });
    }

    // ------------------------------------------------------------ sort & filter
    function openFilters() {
      openPanel({
        title: 'Sort & filter', className: 'cl-filter-panel',
        build(body) {
          const box = h('div.cl-filters');
          body.append(box);
          const draw = () => {
            clear(box);
            const f = F();
            const group = (label, key, opts) => box.append(h('div.cl-fg', h('div.cl-fl', label),
              h('div.cl-fopts', opts.map(([v, l]) => h(`button.chip${f[key] === v ? '.on' : ''}`, { type: 'button', onclick: () => { f[key] = v; saveF(); sel = 0; app.sfx('tick'); draw(); render(); } }, l)))));
            group('Sort', 'sort', SORTS[kind]);
            if (kind === 'video') {
              const plats = [...new Set(shelfAll().map((x) => x.platform).filter(Boolean))].sort((a, b) => platformName(a).localeCompare(platformName(b)));
              group('Platform', 'plat', [['any', 'Any'], ...plats.map((p) => [p, platformShort(p)]), ...(shelfAll().some((x) => x.digital) ? [['digital', 'Digital']] : [])]);
              group('Status', 'status', [['any', 'Any'], ['unplayed', 'Unplayed'], ['played', 'Played'], ['beaten', 'Beaten'], ['unbeaten', 'Not beaten']]);
              box.append(h('div.cl-fg', h('div.cl-fl', 'Digital games'), h('div.cl-fopts',
                h(`button.chip${!f.hideDigital ? '.on' : ''}`, { type: 'button', onclick: () => { f.hideDigital = false; saveF(); draw(); render(); } }, 'Show'),
                h(`button.chip${f.hideDigital ? '.on' : ''}`, { type: 'button', dataset: { hd: '1' }, onclick: () => { f.hideDigital = true; saveF(); sel = 0; draw(); render(); } }, 'Hide'))));
            } else {
              group('Players', 'pl', [['any', 'Any'], ['1', 'Solo'], ['2', '2'], ['34', '3–4'], ['5', '5+']]);
              group('Time', 'time', [['any', 'Any'], ['30', '≤ 30 min'], ['60', '≤ 1 h'], ['120', '≤ 2 h'], ['long', 'Longer']]);
              group('Status', 'status', [['any', 'Any'], ['unplayed', 'Never played'], ['played', 'Played']]);
            }
            group('Show', 'quick', [['all', 'Everything'], ['lent', 'Lent out'], ['new', kind === 'board' ? 'Never played' : 'Unplayed']]);
            const n = sorted().length;
            box.append(h('div.cl-fsum', `${n} game${n === 1 ? '' : 's'} match`),
              h('button.pill.small', { type: 'button', onclick: () => { filters[kind] = { ...DEF_F, sort: f.sort }; saveF(); sel = 0; app.sfx('drop'); draw(); render(); } }, 'Reset filters'));
          };
          draw(); curve(box);
        },
      });
    }

    // ------------------------------------------------------------ more: pick, stats, connections, phone
    function openMenu() {
      openPanel({
        title: 'Collection', className: 'cl-menu-panel',
        build(body, panel) {
          const go = (fn) => () => { panel.close(); setTimeout(fn, 60); };
          const row = (ic, t, s, fn, cls = '') => h(`button.cl-mrow${cls}`, { type: 'button', onclick: go(fn) }, h('i', { html: ic }), h('div', h('b', t), h('span', s)));
          const nConn = Y.CONNECTIONS.filter((c) => C.conn(c.id).lastSync).length;
          body.append(h('div.cl-menu',
            row(svgPath(ICON.dice), 'Pick something to play', `Decide spins your ${KIND_META[kind].plural.toLowerCase()}`, pickToPlay, '.hl'),
            row(svgPath(ICON.chart), 'Stats', 'Counts per platform, value, plays', openStats),
            row(svgPath(ICON.plug), 'Connections & import', nConn ? `${nConn} connected · BGG, PriceCharting, RAWG, Steam, PlayStation, files` : 'BGG, PriceCharting, RAWG, Steam, PlayStation, GamEye…', openConnections),
            row(svgPath(ICON.phone), 'Add from your phone', 'Scan a barcode or upload an export', () => openPhone('add'))));
        },
      });
    }

    function pickToPlay() {
      const pool = shelfAll().filter((x) => passes(x));
      if (!pool.length) { app.toast(shelfAll().length ? 'Nothing matches your filters' : `Add some ${KIND_META[kind].plural.toLowerCase()} first`); return; }
      const did = kind === 'board' ? 'play' : 'vgame';
      const all = app.store.get('appData') || {};
      const dec = all.decide || {};
      const fl = { ...(dec.filters || {}) };
      const f = F();
      const df = { ...(fl[did] || {}), src: 'coll' };
      if (kind === 'board') {
        df.pl = { 1: '1', 2: '2', 34: '4', 5: '5' }[f.pl] || 'any';
        df.time = { 30: '30', 60: '60', long: 'long' }[f.time] || 'any';
        df.kind = 'any';
      }
      fl[did] = df;
      app.store.set('appData', { ...all, decide: { ...dec, filters: fl, sel: did, jump: { d: did, at: Date.now() } } });
      app.sfx('whoosh');
      app.go('app', { id: 'decide' });
    }

    function openStats() {
      let sk = kind;
      openPanel({
        title: 'Stats', className: 'cl-stats-panel',
        build(body) {
          const box = h('div.cl-stats');
          body.append(box);
          const draw = () => {
            clear(box);
            const s = C.stats()[sk];
            const m = KIND_META[sk];
            box.style.setProperty('--k', m.color);
            const max = Math.max(1, ...s.platforms.map((p) => p[1]));
            box.append(...[
              h('div.cl-stabs', KINDS.map((k) => h(`button.chip${k === sk ? '.on' : ''}`, { type: 'button', onclick: () => { sk = k; draw(); } }, KIND_META[k].plural))),
              h('div.cl-big',
                h('div', h('b', String(s.count)), h('span', s.copies !== s.count ? `games · ${s.copies} copies` : 'games')),
                h('div', h('b', s.valued ? C.fmtMoney(s.value) : '—'), h('span', s.valued ? `value (${s.valued} priced)` : 'no prices yet')),
                h('div', h('b', sk === 'board' ? String(s.plays) : String(s.beaten)), h('span', sk === 'board' ? 'plays' : 'beaten'))),
              h('div.cl-bars', s.platforms.slice(0, 8).map(([name, n]) => h('div.cl-bar-r', h('span.cl-bar-l', { dir: 'auto' }, name), h('span.cl-bar-t', h('i', { style: { width: `${(n / max) * 100}%` } })), h('b', String(n))))),
              h('div.cl-sline', [sk === 'board' ? `${s.unplayed} never played` : `${s.unplayed} unplayed`, sk === 'video' && s.hours ? `${s.hours} h played` : '', s.lent ? `${s.lent} lent out` : '', s.paid ? `paid ${C.fmtMoney(s.paid)}` : ''].filter(Boolean).join(' · ')),
              s.top.length ? h('div.cl-sline.top', `Most played: ${s.top.map((x) => x.title).join(', ')}`) : null].filter(Boolean)
            );
          };
          draw(); curve(box);
        },
      });
    }

    // ------------------------------------------------------------ phone (QR)
    function openPhone(tab = 'add') {
      openPanel({
        title: 'Add from your phone', className: 'cl-qr-panel',
        build(body, panel) {
          const box = h('div.cl-qr');
          body.append(box);
          box.append(h('div.loading', h('div.spin'), h('div', 'Finding the bridge…')));
          Y.phoneUrl(`?tab=${tab}${kind === 'board' ? '&kind=board' : ''}`).then((r) => {
            if (panel.closed) return;
            clear(box);
            if (!r.url) {
              box.append(h('div.cl-qr-off', h('div.cl-qr-off-ic', { html: svgPath(ICON.phone) }), h('div.cl-qr-off-t', 'Phones can’t connect yet'),
                h('div.cl-qr-off-m', r.reason === 'noip' ? 'The bridge has no network address phones can reach. Set "collection.publicUrl" in bridge/config.json.'
                  : r.reason === 'old' ? 'This bridge is too old for the Collection page — update bridge/ and restart it.'
                    : 'Start the bridge (bridge/server.js) on this network, then scan the code with your phone.')));
              return;
            }
            box.append(h('div.cl-qr-h', tab === 'file' ? 'Upload your export' : 'Scan a barcode or type a game'),
              h('div.cl-qr-code', { html: qrSvg(r.url, { margin: 3, dark: '#111', light: '#fff' }), dataset: { url: r.url } }),
              h('div.cl-qr-m', tab === 'file' ? 'Scan the code, pick the file — GamEye, CLZ, Grouvee, BoardGameGeek, BG Stats or any CSV — and send it here.' : 'Scan the code with your phone. It can also upload a GamEye, CLZ or BoardGameGeek export.'),
              h('div.cl-qr-url', r.url.replace(/^https?:\/\//, '')));
          });
        },
      });
    }

    // ------------------------------------------------------------ connections
    function connStatus(c, inf) {
      const st = C.conn(c.id);
      const n = c.id === 'sheet' ? Object.keys(PRESET_SRC).reduce((a, s) => a + C.sourceCount(s), 0) : C.sourceCount(c.id);
      if (Y.syncing(c.id)) return { t: 'Syncing…', cls: 'busy' };
      if (st.error && (!st.lastSync || st.errorAt > st.lastSync)) return { t: st.error, cls: 'err' };
      if (st.lastSync) return { t: `${n} game${n === 1 ? '' : 's'} · ${c.id === 'sheet' ? 'last import' : 'synced'} ${ago(st.lastSync)}`, cls: 'ok' };
      if (inf && Y.configured(c.id, inf)) return { t: 'Ready — tap to sync', cls: 'ready' };
      return { t: inf === null ? 'Needs the bridge' : 'Not set up', cls: '' };
    }
    const PRESET_SRC = Object.fromEntries(PRESETS.map((p) => [p.id, 1]));
    function openConnections() {
      openPanel({
        title: 'Connections', className: 'cl-conn-panel',
        build(body, panel) {
          const list = h('div.list.cl-clist');
          body.append(list);
          const recurve = curve(list);
          let inf;
          const draw = () => {
            clear(list);
            for (const c of Y.CONNECTIONS) {
              const s = connStatus(c, inf);
              list.append(h(`button.row.cl-crow.${s.cls || 'none'}`, { type: 'button', dataset: { c: c.id }, onclick: () => openConn(c.id, draw) },
                h('i.cl-clogo', { '--s': c.color }, c.name.slice(0, 1)),
                h('div.row-text', h('div.row-title', c.name, c.untested ? h('span.cl-untested', 'untested live') : null), h('div.row-sub', s.t)), h('i.cl-chev', { html: icon('chevron') })));
            }
            list.append(h('div.cl-res-note', 'Syncs never overwrite what you edited here. Tokens and keys stay on the bridge.'));
            recurve();
          };
          draw();
          Y.info({ force: true }).then((i) => { inf = i; if (!panel.closed) draw(); }).catch(() => { inf = null; if (!panel.closed) draw(); });
          panel.onDestroy = C.onItems(() => { if (!panel.closed) draw(); });
        },
      });
    }
    function openConn(id, after) {
      const c = Y.connById(id);
      openPanel({
        title: c.name, className: 'cl-conn1-panel',
        build(body, panel) {
          panel.el.style.setProperty('--s', c.color);
          const box = h('div.cl-conn');
          body.append(box);
          let inf, busy = false;
          const draw = () => {
            clear(box);
            const st = C.conn(id);
            const s = connStatus(c, inf);
            box.append(h('div.cl-conn-b', c.blurb, c.untested ? h('span.cl-untested', 'untested live') : null),
              h(`div.cl-conn-s.${s.cls || 'none'}`, s.t));
            if (st.lastResult && id !== 'sheet') {
              const r = st.lastResult;
              box.append(h('div.cl-conn-r', [`${r.total} from ${c.name}`, r.added ? `${r.added} new` : '', r.updated ? `${r.updated} updated` : '', r.removed ? `${r.removed} removed` : '', r.unlinked ? `${r.unlinked} kept (you edited them)` : '', r.note].filter(Boolean).join(' · ')));
            }
            if (id === 'sheet' && st.lastResult) {
              const r = st.lastResult;
              box.append(h('div.cl-conn-r', `${r.presetName}${r.name ? ` · ${r.name}` : ''}: ${r.total} games (${r.added} new, ${r.updated} updated)${r.wishes ? ` · ${r.wishes} to Wish Lists` : ''}`));
            }
            // fields (secrets go to the bridge)
            for (const [f, label, secret] of c.fields || []) {
              const cur = inf?.conns?.[id] || {};
              const has = f === 'username' ? cur.username : f === 'key' ? cur.hasKey : cur.hasToken;
              box.append(h('button.row.cl-erow', { type: 'button', dataset: { f }, onclick: async () => {
                const v = await app.editText({ title: label, value: secret ? '' : (cur.username || ''), placeholder: secret ? (has ? 'Paste a new one (empty = keep)' : 'Paste it here') : 'Your username', secret: !!secret, okLabel: 'Save' });
                if (v === null || (secret && !v)) return;
                try { await Y.saveConfig({ [id]: { [f]: v } }); inf = await Y.info({ force: true }); app.toast(secret ? 'Saved on the bridge' : 'Saved'); draw(); }
                catch (e) { app.toast(errText(e), { kind: 'error', ms: 4000 }); }
              } }, h('div.row-text', h('div.row-sub', label), h('div.row-title', secret ? (has ? (cur.inConfig ? '•••••• (bridge config)' : '•••••• saved on the bridge') : 'Not set') : (has || 'Not set'))), h('i.cl-chev', { html: icon('edit') })));
            }
            if (id === 'psn') {
              box.append(h('button.row.cl-erow', { type: 'button', onclick: () => { C.setConn('psn', { digital: !st.digital }); draw(); } },
                h('div.row-text', h('div.row-sub', 'Count PlayStation games as'), h('div.row-title', st.digital ? 'Digital (hidden by “Hide digital”)' : 'Disc or digital — unknown')), h('i.cl-chev', { html: icon('toggle') })));
            }
            const acts = h('div.cl-conn-acts');
            if (id === 'sheet') {
              const fileIn = h('input', { type: 'file', accept: '.csv,.txt,.json,.tsv', hidden: true, onchange: async () => {
                const f = fileIn.files[0]; if (!f) return;
                const r = Y.parseLocal(await f.text());
                if (r.error) { app.toast(r.error, { kind: 'error' }); return; }
                const res = await Y.applyImport({ ...r, name: f.name, from: 'local' });
                app.toast(`${res.presetName}: ${res.added} new, ${res.updated} updated${res.wishes ? `, ${res.wishes} wishes` : ''}`); render(); draw();
              } });
              acts.append(h('button.pill.small.primary', { type: 'button', onclick: () => openPhone('file') }, h('i', { html: svgPath(ICON.phone) }), 'Upload from phone'),
                h('button.pill.small', { type: 'button', onclick: () => fileIn.click() }, 'Choose a file here'), fileIn);
              if (inf?.watch) box.append(h('div.cl-conn-r', `Watching ${String(inf.watch.file).split(/[\\/]/).pop()}${inf.watch.error ? ` — ${inf.watch.error}` : inf.watch.at ? ` · imported ${ago(inf.watch.at)} (${inf.watch.count} games)` : ''}`));
            } else {
              acts.append(h('button.pill.small.primary.cl-sync', { type: 'button', disabled: busy, onclick: () => run() }, h('i', { html: svgPath(ICON.sync) }), busy ? 'Syncing…' : 'Sync now'));
            }
            const n = id === 'sheet' ? Object.keys(PRESET_SRC).reduce((a, s) => a + C.sourceCount(s), 0) : C.sourceCount(id);
            if (n || st.lastSync || (c.fields && inf?.conns?.[id] && (inf.conns[id].hasToken || inf.conns[id].hasKey))) acts.append(h('button.pill.small.danger', { type: 'button', onclick: () => disconnect() }, 'Disconnect'));
            box.append(...[acts,
              h('div.cl-sec', 'How to connect'),
              h('ol.cl-steps', c.steps.map((t) => h('li', t))),
              id === 'sheet' ? h('div.cl-presets', PRESETS.filter((p) => p.id !== 'generic').map((p) => h('div.cl-preset', h('b', p.name), h('span', p.hint)))) : null].filter(Boolean));
            curve(box);
          };
          async function run() {
            if (busy) return;
            busy = true; draw();
            try {
              const r = await Y.sync(id, { force: true });
              app.sfx('score');
              app.toast(`${c.name}: ${r.total} games · ${r.added} new${r.updated ? `, ${r.updated} updated` : ''}${r.removed ? `, ${r.removed} removed` : ''}`, { ms: 3200 });
              render();
            } catch (e) { app.sfx('over'); app.toast(errText(e), { kind: 'error', ms: 4200 }); }
            busy = false;
            if (!panel.closed) draw();
            after?.();
          }
          function disconnect() {
            const srcs = id === 'sheet' ? Object.keys(PRESET_SRC) : [id];
            const n = srcs.reduce((a, s) => a + C.sourceCount(s), 0);
            openPanel({
              title: 'Disconnect', className: 'cl-confirm',
              build(b2, p2) {
                const done = async (removeItems) => {
                  let removed = 0;
                  for (const s of srcs) removed += C.disconnect(s, { removeItems }).removed;
                  C.disconnect(id, { removeItems: false });
                  if (c.fields) { try { await Y.saveConfig({ [id]: Object.fromEntries(c.fields.map(([f]) => [f, ''])) }); } catch {} }
                  app.toast(removeItems ? `Disconnected · removed ${removed} game${removed === 1 ? '' : 's'}` : 'Disconnected · its games stay in your collection');
                  p2.close(); panel.close(); render(); after?.();
                };
                b2.append(h('div.cl-conf', h('div.cl-conf-t', n ? `${n} game${n === 1 ? '' : 's'} came from ${c.name}. Keep them?` : `Stop using ${c.name}?`),
                  n ? h('div.cl-conf-m', 'Games you edited (notes, plays, loans…) or that another source also has are always kept.') : null,
                  h('div.cl-conf-b', h('button.pill', { type: 'button', onclick: () => done(false) }, n ? 'Keep them' : 'Disconnect'),
                    n ? h('button.pill.danger', { type: 'button', onclick: () => done(true) }, 'Remove them') : null)));
              },
            });
          }
          draw();
          Y.info({ force: true }).then((i) => { inf = i; if (!panel.closed) draw(); }).catch(() => { inf = null; if (!panel.closed) draw(); });
        },
      });
    }

    // ------------------------------------------------------------ phones, imports and the watched file arrive here
    offs.push(Y.watchInbox((e, res) => {
      if (e.type === 'item' && res) {
        flashId = res.id;
        if (res.kind !== kind) { kind = res.kind; app.save('kind', kind); }
        app.sfx('coin'); app.toast(res.duplicate ? `“${res.title}” is already in your collection` : `📱 Added “${res.title}”`, { ms: 3000 });
      } else if (e.type === 'import' && res) {
        app.sfx('score');
        app.toast(`${res.presetName}: ${res.total} games — ${res.added} new, ${res.updated} updated${res.wishes ? ` · ${res.wishes} to Wish Lists` : ''}`, { ms: 4200 });
      }
      render();
    }));
    // connections that haven't synced for a while: once, quietly, when the app opens
    setTimeout(() => {
      for (const c of Y.CONNECTIONS) {
        const st = C.conn(c.id);
        if (c.id !== 'sheet' && st.on && st.lastSync && Date.now() - st.lastSync > 12 * 3600e3 && !Y.syncing(c.id)) Y.sync(c.id).then(() => render()).catch(() => {});
      }
    }, 2500);

    // ------------------------------------------------------------ knob / keys
    app.onKey((e) => {
      if (topPanel()) return;
      const k = e.key;
      if (k === 'ArrowRight' || (k === 'ArrowDown' && view === 'list')) { e.preventDefault(); goTo(sel + 1); }
      else if (k === 'ArrowLeft' || (k === 'ArrowUp' && view === 'list')) { e.preventDefault(); goTo(sel - 1); }
      else if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'PageDown' || k === 'PageUp' || k === 'Tab') { e.preventDefault(); setKind(kind === 'video' ? 'board' : 'video'); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); if (items[sel]) openItem(items[sel].id); else openAdd(); }
      else if (k === '+' || k === 'a') { e.preventDefault(); openAdd(); }
      else if (k === '/' || k === 's') { e.preventDefault(); openSearch(); }
      else if (k === 'f') openFilters();
      else if (k === 'p') pickToPlay();
      else if (k === 'v') setView(view === 'ring' ? 'list' : 'ring');
      else if (k === 'm') openMenu();
    });

    offs.push(C.onItems(() => {
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
