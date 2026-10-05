// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Collection: your physical media — six shelves along the top rim: Video games · Board games · Books · Vinyl · CDs ·
// DVD & Blu-ray. Each shelf is a fan of covers you turn with a finger or the knob, a plain list, or a grouped list
// (video games by platform, board games by type, books / music / movies by genre) with group chips to filter.
// Per item: platform and edition, CIB / loose, hours and "beaten" (video); players, play time, plays +1 and type
// (board — incl. "No equipment needed" classics like פתקיות); author, ISBN, pages, read status and "Start reading"
// in Bookmarks (books); artist, label, catalogue number, LP / 7″ / colour / RPM, Goldmine grades and "Play on <your
// music service>" (vinyl, CDs); DVD / Blu-ray / 4K, region, director, runtime and "Play from Plex / Jellyfin" when
// you also own it digitally (movies). Notes, tags, genres, loans, search, filters, sort, stats with the value.
// Connections (⋯): BoardGameGeek, PriceCharting, RAWG, Steam, PlayStation, Discogs, TMDB, Open Library, MusicBrainz
// and spreadsheet imports (GamEye, CLZ Games / Books / Music / Movies, Grouvee, BGG, BG Stats, Discogs, Goodreads,
// any CSV — from your phone by QR code). Phones can also add anything by scanning its barcode.
// Data: apps/collection-store.js · connections: apps/collection-sync.js · parsers + merge rules: apps/collection-sources.js
import { clear } from '../js/ui/dom.js';
import { curve, topPanel } from '../js/ui/overlay.js';
import { createKeyboard, wantsKeyboard } from '../js/ui/keyboard.js';
import { debounce } from '../js/core/util.js';
import { qrSvg } from './qr.js';
import * as C from './collection-store.js';
import * as Y from './collection-sync.js';
import { PLATFORM_CHOICES, PRESETS, FORMATS, GRADES, SLEEVE_EXTRA, GENRES, BOARD_TYPES, BOARD_TRAITS, NO_EQUIP, FAMILIES, isbnOf, formatName, familyName, isMusic } from './collection-sources.js';

const { KIND_META, OWNERSHIP, platformName, platformShort } = C;
const KINDS = C.KINDS;
const SQUARE = new Set(['board', 'vinyl', 'cd']);
const svgPath = (d, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>`;
const ICON = {
  meeple: C.MEEPLE,
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  filter: 'M3 5h18v2l-7 7v5l-4 2v-7L3 7z',
  grid: 'M4 5h4v6H4zm6 0h4v6h-4zm6 0h4v6h-4zM4 13h4v6H4zm6 0h4v6h-4zm6 0h4v6h-4z',
  groups: 'M3 4h8v2H3zm0 4h18v3H3zm0 6h8v2H3zm0 4h18v3H3z',
  hand: 'M9 11V4.5a1.5 1.5 0 0 1 3 0V10h.5V3.5a1.5 1.5 0 0 1 3 0V10h.5V5.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-.6a7 7 0 0 1-5.3-2.5L2.6 15.4a1.6 1.6 0 0 1 2.3-2.2L7.5 15V7.5a1.5 1.5 0 0 1 1.5-1.5z',
  chart: 'M4 20V10h3v10zm6.5 0V4h3v16zM17 20v-7h3v7z',
  plug: 'M7 2h2v5h6V2h2v5h1a1 1 0 0 1 1 1v3a6 6 0 0 1-5 5.9V22h-4v-5.1A6 6 0 0 1 5 11V8a1 1 0 0 1 1-1h1z',
  phone: 'M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm0 3v15h10V4zm4 16.2a.9.9 0 1 0 1.8 0 .9.9 0 0 0-1.8 0z',
  tag: 'M3 3h8l10 10-8 8L3 11zm4 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  trophy: 'M6 3h12v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.3 12H7a4 4 0 0 1-4-4V5h3zm0 4H5v1a2 2 0 0 0 1 1.7zm12 0v2.7A2 2 0 0 0 19 8V7z',
  barcode: 'M3 5h2v14H3zm3 0h1v14H6zm2 0h2v14H8zm3 0h1v14h-1zm3 0h2v14h-2zm3 0h1v14h-1zm2 0h2v14h-2z',
  file: 'M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5z',
  sync: 'M12 4V1L8 5l4 4V6a6 6 0 0 1 6 6 6 6 0 0 1-.7 2.8l1.5 1.5A8 8 0 0 0 12 4zm0 14a6 6 0 0 1-6-6c0-1 .3-2 .7-2.8L5.2 7.7A8 8 0 0 0 12 20v3l4-4-4-4z',
  open: 'M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  bookmark: 'M6 2h12a1 1 0 0 1 1 1v19l-7-4-7 4V3a1 1 0 0 1 1-1z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.3 6.7 8 8zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4z',
  hands0: 'M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM5 21l2-9 5 2 5-2 2 9h-2.2l-1.3-5.6L12 16.6l-3.5-1.2L7.2 21z',
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
const fmtRuntime = (m) => (!m ? '' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`);
const steamArt = (it) => (it.appid ? [`https://cdn.cloudflare.steamstatic.com/steam/apps/${it.appid}/library_600x900.jpg`, `https://cdn.cloudflare.steamstatic.com/steam/apps/${it.appid}/header.jpg`] : []);
const ownShort = { cib: 'CIB', loose: 'Loose', new: 'Sealed', digital: 'Digital', graded: 'Graded', box: 'Box only', manual: 'Manual only' };
const READ = [['want', 'To read'], ['reading', 'Reading'], ['read', 'Read']];
const REGIONS = [['A', 'A (Americas, East Asia)'], ['B', 'B (Europe, Africa, Oceania)'], ['C', 'C (Asia)'], ['ABC', 'Region free (Blu-ray)'], ['1', 'DVD 1'], ['2', 'DVD 2'], ['3', 'DVD 3'], ['4', 'DVD 4'], ['5', 'DVD 5'], ['0', 'DVD region free']];
const SORTS = {
  video: [['title', 'A – Z'], ['platform', 'Platform'], ['added', 'Newest'], ['hours', 'Most played'], ['value', 'Value'], ['year', 'Year']],
  board: [['title', 'A – Z'], ['type', 'Type'], ['added', 'Newest'], ['plays', 'Most played'], ['lastPlayed', 'Played lately'], ['rating', 'Rating'], ['value', 'Value']],
  book: [['title', 'A – Z'], ['by', 'Author'], ['genre', 'Genre'], ['added', 'Newest'], ['year', 'Year'], ['pages', 'Pages']],
  vinyl: [['by', 'Artist'], ['title', 'A – Z'], ['genre', 'Genre'], ['added', 'Newest'], ['year', 'Year'], ['value', 'Value']],
  cd: [['by', 'Artist'], ['title', 'A – Z'], ['genre', 'Genre'], ['added', 'Newest'], ['year', 'Year'], ['value', 'Value']],
  movie: [['title', 'A – Z'], ['genre', 'Genre'], ['format', 'Format'], ['added', 'Newest'], ['year', 'Year'], ['runtime', 'Length']],
};
const DEF_F = { sort: 'title', plat: 'any', pl: 'any', time: 'any', status: 'any', quick: 'all', hideDigital: false, grp: 'any', trait: 'any', fmt: 'any', read: 'any' };
const DEF_SORT = { vinyl: 'by', cd: 'by' };
const GROUP_WORD = { platform: 'By platform', type: 'By type', genre: 'By genre' };
const NEW_LABEL = { video: 'Unplayed', board: 'Never played', book: 'Unread' };
// the six shelves sit on the top rim, three each side of the Back button
const CAT_ANG = [-43, -28.5, -14, 14, 28.5, 43];

export default {
  css: './collection.css',
  create(el, app) {
    const { h, icon } = app;
    const kglyph = (k) => (k === 'video' ? icon('gamepad') : svgPath(C.GLYPHS[k] || ICON.meeple));
    // panels live outside the app box: give them the shelf's colour
    const openPanel = (o) => { const p = app.openPanel(o); if (!p.el.style.getPropertyValue('--k')) p.el.style.setProperty('--k', KIND_META[kind].color); return p; };
    let kind = KINDS.includes(app.data('kind')) ? app.data('kind') : 'video';
    let view = ['ring', 'list', 'groups'].includes(app.data('view')) ? app.data('view') : 'ring';
    const saved = app.data('filters', {});
    const filters = Object.fromEntries(KINDS.map((k) => [k, { ...DEF_F, sort: DEF_SORT[k] || 'title', ...(saved[k] || {}) }]));
    const F = () => filters[kind];
    const saveF = () => app.save('filters', filters);
    const resetF = (k = kind) => { filters[k] = { ...DEF_F, sort: filters[k].sort }; saveF(); };
    let sel = 0, items = [], flashId = null;
    const offs = [];

    // ------------------------------------------------------------ skeleton
    const cats = h('div.cl-cats', { role: 'tablist', 'aria-label': 'Shelves' });
    const kname = h('div.cl-kname');
    const quick = h('div.cl-quick');
    const ring = h('div.cl-ring', { tabindex: '-1' });
    const info = h('div.cl-info');
    const rim = h('div.cl-rim', { html: '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="cl-rim-t" d="M 18.82 87.13 A 48.5 48.5 0 0 0 81.18 87.13"/><circle class="cl-rim-k" r="1.3" cx="50" cy="98.5"/></svg>' });
    const listEl = h('div.cl-list.list');
    const reCurve = curve(listEl);
    const empty = h('div.cl-empty');
    const btn = (cls, label, ic, fn) => h(`button.cl-btn${cls}`, { type: 'button', 'aria-label': label, onclick: fn }, h('i', { html: ic }), h('span', label));
    const nextView = () => (view === 'ring' ? 'list' : view === 'list' ? 'groups' : 'ring');
    const btnView = btn('.b-view', 'List', icon('list'), () => setView(nextView()));
    const btnSearch = btn('.b-search', 'Search', icon('search'), () => openSearch());
    const btnAdd = h('button.cl-add', { type: 'button', 'aria-label': 'Add', onclick: () => openAdd() }, h('i', { html: icon('plus') }));
    const btnFilter = btn('.b-filter', 'Filter', svgPath(ICON.filter), () => openFilters());
    const btnMore = btn('.b-more', 'More', icon('more'), () => openMenu());
    const fdot = h('b.cl-fdot');
    btnFilter.querySelector('i').append(fdot);
    el.classList.add('cl');
    app.hideTitle();
    const catBtns = KINDS.map((k, i) => {
      const a = (CAT_ANG[i] * Math.PI) / 180;
      const b = h('button.cl-cat', { type: 'button', role: 'tab', dataset: { k }, '--kc': KIND_META[k].color, style: { left: `${(50 + 43.5 * Math.sin(a)).toFixed(2)}%`, top: `${(50 - 43.5 * Math.cos(a)).toFixed(2)}%` },
        onclick: () => setKind(k) }, h('i', { html: kglyph(k) }), h('b.cl-cat-n'));
      cats.append(b);
      return b;
    });
    el.append(cats, kname, quick, ring, rim, info, listEl, empty, h('div.cl-bar', btnView, btnSearch, btnAdd, btnFilter, btnMore));

    // ------------------------------------------------------------ the shelf: filters + sort
    const shelfAll = (k = kind) => { const all = C.items(k); return k === 'board' ? all.filter((x) => !C.underBase(x, all)) : all; };
    const isPlayed = (x) => (x.plays || 0) > 0 || (x.hours || 0) > 0 || !!x.beaten || !!x.lastPlayed;
    const isNew = (x, k = x.kind) => (k === 'book' ? x.read !== 'read' && x.read !== 'reading' : !isPlayed(x));
    const grpKey = (x, k = x.kind) => (k === 'video' ? C.groupOf(x).fam || 'other' : C.groupOf(x).key);
    function passes(x, f = F(), k = kind) {
      if (k === 'video' && f.hideDigital && x.digital) return false;
      if (f.quick === 'lent' && !x.lent?.name) return false;
      if (f.quick === 'new' && !isNew(x, k)) return false;
      if (f.grp !== 'any' && grpKey(x, k) !== f.grp) return false;
      if (k === 'video' && f.plat !== 'any' && (f.plat === 'digital' ? !x.digital : (x.platform || '') !== f.plat)) return false;
      if (k === 'board' && f.trait !== 'any' && !(x.traits || []).includes(f.trait)) return false;
      if (C.MEDIA.includes(k) && f.fmt !== 'any' && (x.format || '') !== f.fmt) return false;
      if (k === 'book' && f.read !== 'any' && (f.read === 'want' ? x.read === 'read' || x.read === 'reading' : x.read !== f.read)) return false;
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
    const tcmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
    const sortTitle = (x) => String(x.title).replace(/^(the|a|an)\s+/i, '');
    const byName = (x) => String(x.by || '￿').replace(/^the\s+/i, '');
    const rankCmp = (a, b) => { const ra = C.groupOf(a).rank, rb = C.groupOf(b).rank; for (let i = 0; i < Math.max(ra.length, rb.length); i++) { const d = (ra[i] ?? 0) - (rb[i] ?? 0); if (d) return d; } return 0; };
    function sorted() {
      const f = F();
      const l = shelfAll().filter((x) => passes(x));
      const t = (a, b) => tcmp(sortTitle(a), sortTitle(b));
      const by = {
        title: t, added: (a, b) => (b.added || 0) - (a.added || 0) || t(a, b),
        platform: (a, b) => rankCmp(a, b) || tcmp(platformName(a.platform || 'zzz'), platformName(b.platform || 'zzz')) || t(a, b),
        type: (a, b) => rankCmp(a, b) || t(a, b), genre: (a, b) => rankCmp(a, b) || tcmp(C.groupOf(a).name, C.groupOf(b).name) || t(a, b),
        by: (a, b) => tcmp(byName(a), byName(b)) || (a.year || 0) - (b.year || 0) || t(a, b),
        format: (a, b) => tcmp(a.format || 'zz', b.format || 'zz') || t(a, b),
        hours: (a, b) => (b.hours || 0) - (a.hours || 0) || t(a, b), plays: (a, b) => (b.plays || 0) - (a.plays || 0) || t(a, b),
        lastPlayed: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || t(a, b), rating: (a, b) => (b.rating || 0) - (a.rating || 0) || t(a, b),
        value: (a, b) => (b.value || 0) - (a.value || 0) || t(a, b), year: (a, b) => (b.year || 0) - (a.year || 0) || t(a, b),
        pages: (a, b) => (b.pages || 0) - (a.pages || 0) || t(a, b), runtime: (a, b) => (b.runtime || 0) - (a.runtime || 0) || t(a, b),
      }[f.sort] || t;
      // the grouped view: groups first (platform family + platform, board type, genre), then the chosen order inside
      if (view === 'groups') return l.sort((a, b) => rankCmp(a, b) || tcmp(C.groupOf(a).name, C.groupOf(b).name) || by(a, b));
      return l.sort(by);
    }
    const activeFilters = (f = F(), k = kind) => [f.grp !== 'any', k === 'video' && f.plat !== 'any', k === 'board' && f.pl !== 'any', k === 'board' && f.time !== 'any', k === 'board' && f.trait !== 'any',
      f.status !== 'any', k === 'video' && f.hideDigital, C.MEDIA.includes(k) && f.fmt !== 'any', k === 'book' && f.read !== 'any'].filter(Boolean).length;
    /** the chips of the groups on this shelf: [key, name, count] (video games: platform families) */
    function groupChips(k = kind) {
      const f = F();
      const base = shelfAll(k).filter((x) => passes(x, { ...f, grp: 'any', quick: 'all' }, k));
      const m = new Map();
      for (const x of base) {
        const key = grpKey(x, k);
        const name = k === 'video' ? familyName(key) : C.groupOf(x).name;
        const rank = k === 'video' ? FAMILIES.findIndex((y) => y[0] === key) : C.groupOf(x).rank[0];
        const e = m.get(key) || { key, name, rank, n: 0 }; e.n++; m.set(key, e);
      }
      return [...m.values()].sort((a, b) => a.rank - b.rank || tcmp(a.name, b.name));
    }

    // ------------------------------------------------------------ chrome
    function renderCats() {
      KINDS.forEach((k, i) => {
        const b = catBtns[i];
        const n = shelfAll(k).length;
        b.classList.toggle('on', k === kind);
        b.setAttribute('aria-selected', String(k === kind));
        b.setAttribute('aria-label', `${KIND_META[k].plural}, ${n}`);
        b.querySelector('.cl-cat-n').textContent = n ? String(n) : '';
      });
      el.style.setProperty('--k', KIND_META[kind].color);
      el.dataset.kind = kind;
      el.dataset.shape = SQUARE.has(kind) ? 'sq' : 'tall';
      clear(kname);
      kname.append(h('span', KIND_META[kind].plural));
    }
    function renderQuick() {
      clear(quick);
      const f = F();
      quick.classList.toggle('groups', view === 'groups');
      const chip = (val, label, n, on, fn, attrs = {}) => h(`button.chip${on ? '.on' : ''}`, { type: 'button', ...attrs, onclick: fn }, label, n != null ? h('b', String(n)) : null);
      if (view === 'groups') {
        // group chips: filter the grouped list to one platform family / type / genre
        const gs = groupChips();
        quick.append(chip('any', 'All', null, f.grp === 'any', () => setGrp('any'), { dataset: { g: 'any' } }),
          ...gs.map((g) => chip(g.key, g.name + ' ', g.n, f.grp === g.key, () => setGrp(g.key), { dataset: { g: g.key }, dir: 'auto' })),
          h('button.chip.cl-pick', { type: 'button', 'aria-label': kind === 'video' || kind === 'board' ? 'Pick something to play' : 'Pick one at random', onclick: () => pickToPlay() }, h('i', { html: svgPath(ICON.dice) }), 'Pick'));
        requestAnimationFrame(() => quick.querySelector('.chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
      } else {
        const base = shelfAll().filter((x) => passes(x, { ...f, quick: 'all' }));
        const nLent = base.filter((x) => x.lent?.name).length, nNew = base.filter((x) => isNew(x)).length;
        if (f.grp !== 'any') quick.append(h('button.chip.on.cl-gchip', { type: 'button', dir: 'auto', onclick: () => setGrp('any') }, groupChips().find((g) => g.key === f.grp)?.name || f.grp, h('i', { html: icon('close') })));
        quick.append(chip('all', 'All ', base.length, f.quick === 'all', () => setQuick('all'), { dataset: { q: 'all' } }),
          nLent || f.quick === 'lent' ? chip('lent', 'Lent out ', nLent, f.quick === 'lent', () => setQuick('lent'), { dataset: { q: 'lent' } }) : '');
        if (NEW_LABEL[kind]) quick.append(chip('new', `${NEW_LABEL[kind]} `, nNew, f.quick === 'new', () => setQuick('new'), { dataset: { q: 'new' } }));
        quick.append(h('button.chip.cl-pick', { type: 'button', 'aria-label': kind === 'video' || kind === 'board' ? 'Pick something to play' : 'Pick one at random', onclick: () => pickToPlay() }, h('i', { html: svgPath(ICON.dice) }), 'Pick'));
      }
      const n = activeFilters();
      fdot.textContent = n ? String(n) : '';
      btnFilter.classList.toggle('has', !!n);
      const nv = nextView();
      btnView.querySelector('i').innerHTML = nv === 'list' ? icon('list') : nv === 'groups' ? svgPath(ICON.groups) : svgPath(ICON.grid);
      const label = nv === 'list' ? 'List' : nv === 'groups' ? 'Groups' : 'Covers';
      btnView.querySelector('span').textContent = label;
      btnView.setAttribute('aria-label', nv === 'groups' ? `Show ${GROUP_WORD[KIND_META[kind].group].toLowerCase()}` : `Show as ${label.toLowerCase()}`);
    }
    function setKind(k) {
      if (k === kind || !KINDS.includes(k)) return;
      kind = k; app.save('kind', k); sel = 0; app.sfx('tick');
      render();
    }
    function setQuick(v) { if (F().quick === v) v = 'all'; F().quick = v; saveF(); sel = 0; app.sfx('tap'); render(); }
    function setGrp(v) { F().grp = F().grp === v ? 'any' : v; saveF(); sel = 0; app.sfx('tap'); render(); }
    function setView(v) { view = v; app.save('view', v); app.sfx('tap'); render(); }

    // ------------------------------------------------------------ covers
    function artBox(it, cls = '') {
      const box = h(`div.cl-art${cls ? '.' + cls : ''}`, { '--h': String(hue(it.title)), dataset: { kind: it.kind || kind } },
        h('div.cl-art-ph', h('i', { html: kglyph(it.kind || kind) }), h('span', { dir: 'auto' }, it.title), it.by ? h('small', { dir: 'auto' }, it.by) : null));
      const urls = [it.art, ...steamArt(it)].filter(Boolean);
      const sq = SQUARE.has(it.kind || kind);
      const tryNext = () => {
        const u = urls.shift();
        if (!u) return;
        const im = new Image();
        im.onload = () => {
          if (im.naturalWidth < 8) { tryNext(); return; }
          const r = im.naturalWidth / (im.naturalHeight || 1);
          box.style.setProperty('--img', `url("${u.replace(/"/g, '%22')}")`);
          box.classList.add('loaded'); box.classList.toggle('fit', sq ? r > 1.25 || r < 0.8 : r > 0.82);
        };
        im.onerror = tryNext;
        im.src = u;
      };
      box._load = () => { if (!box._started) { box._started = true; tryNext(); } };
      return box;
    }
    const fmtLine = (it) => [formatName(it.kind, it.format), it.steelbook ? 'Steelbook' : '', isMusic(it.kind) && it.rpm && it.format !== 'lp' && it.format !== '2lp' ? `${it.rpm} RPM` : '', it.variant].filter(Boolean).join(' · ');
    const metaBits = (it) => ({
      board: () => [it.type === 'noequip' ? 'No equipment' : '', fmtPlayers(it.players), fmtMins(it.mins), it.expansion ? 'Expansion' : '', it.year],
      book: () => [it.by, formatName('book', it.format), it.year],
      vinyl: () => [it.by, formatName('vinyl', it.format), it.year],
      cd: () => [it.by, formatName('cd', it.format), it.year],
      movie: () => [formatName('movie', it.format) + (it.steelbook ? ' Steelbook' : ''), it.year, fmtRuntime(it.runtime)],
    }[it.kind] || (() => [it.digital && !it.platform ? 'Digital' : platformShort(it.platform), it.digital ? (it.platform ? 'Digital' : '') : ownShort[it.ownership] || '', it.edition, it.year]))().filter(Boolean);
    const statusBits = (it) => [
      it.lent?.name ? h('span.cl-mini.lent', h('i', { html: svgPath(ICON.hand) }), `Lent to ${it.lent.name}`) : null,
      it.kind === 'board' && it.plays ? h('span.cl-mini', h('i', { html: svgPath(ICON.dice) }), `${it.plays} play${it.plays === 1 ? '' : 's'}`) : null,
      it.kind === 'video' && it.beaten ? h('span.cl-mini.ok', h('i', { html: svgPath(ICON.trophy) }), 'Beaten') : null,
      it.kind === 'video' && it.hours ? h('span.cl-mini', h('i', { html: icon('clock') }), `${it.hours} h`) : null,
      it.kind === 'book' && it.read ? h(`span.cl-mini${it.read === 'read' ? '.ok' : ''}`, h('i', { html: svgPath(ICON.bookmark) }), READ.find((r) => r[0] === it.read)?.[1]) : null,
      isMusic(it.kind) && it.grade ? h('span.cl-mini', `${it.grade}${it.sleeve ? ` / ${it.sleeve}` : ''}`) : null,
      C.MEDIA.includes(it.kind) && (it.genres || [])[0] ? h('span.cl-mini', { dir: 'auto' }, it.genres[0]) : null,
      (it.qty || 1) > 1 ? h('span.cl-mini', `×${it.qty}`) : null,
    ].filter(Boolean);
    const srcDots = (it) => h('span.cl-dots', Object.keys(it.sources || {}).map((s) => h('i', { '--s': C.SOURCES[s]?.color || '#94a3b8', title: C.sourceName(s) })));

    // ------------------------------------------------------------ the fan of covers
    let cards = [], pos = 0, touched = new Set(), raf = 0;
    const slot = () => ring.clientWidth * (SQUARE.has(kind) ? 0.25 : 0.205);
    function renderRing() {
      clear(ring); cards = []; touched = new Set();
      items.forEach((it, i) => {
        const art = artBox(it);
        const card = h('button.cl-card', { type: 'button', dataset: { id: it.id, i: String(i) }, 'aria-label': it.title,
          onclick: () => { if (i === Math.round(pos)) openItem(it.id); else goTo(i); } },
          art, it.lent?.name ? h('span.cl-lent-tag', { title: `Lent to ${it.lent.name}`, html: svgPath(ICON.hand) }) : null,
          it.beaten || it.read === 'read' ? h('span.cl-beat-tag', { html: svgPath(it.kind === 'book' ? ICON.bookmark : ICON.trophy) }) : null, it.digital ? h('span.cl-dig-tag', 'DIGITAL') : null,
          it.kind === 'movie' && it.format && it.format !== 'dvd' ? h('span.cl-fmt-tag', { dataset: { f: it.format } }, it.format === 'uhd' ? '4K' : it.format === 'bluray' || it.format === 'bluray3d' ? 'BLU-RAY' : formatName('movie', it.format).toUpperCase()) : null);
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
      if (e.target.closest?.('.cl-quick')) return;
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
        h('div.cl-info-m', { dir: 'auto' }, metaBits(it).join(' · ') || C.sourceName(Object.keys(it.sources || {})[0])),
        ...(st.length ? [h('div.cl-info-s', ...st.slice(0, 2))] : []),
      );
      info.classList.remove('in'); void info.offsetWidth; info.classList.add('in');
    }

    // ------------------------------------------------------------ list view (and the grouped list)
    function rowFor(it, i) {
      const row = h(`button.row.cl-row${i === sel ? '.sel' : ''}${it.id === flashId ? '.flash' : ''}`, { type: 'button', dataset: { id: it.id, i: String(i) }, onclick: () => { sel = i; openItem(it.id); } },
        artBox(it, 'thumb'),
        h('div.row-text', h('div.row-title', { dir: 'auto' }, it.title),
          h('div.row-sub', { dir: 'auto' }, [...metaBits(it).slice(0, 3), it.lent?.name ? `Lent to ${it.lent.name}` : '', it.kind === 'board' && it.plays ? `${it.plays} plays` : '', it.beaten ? 'Beaten' : '',
            view === 'groups' && C.MEDIA.includes(it.kind) ? '' : (it.genres || [])[0] || ''].filter(Boolean).join(' · '))),
        srcDots(it));
      row.querySelector('.cl-art')._load();
      return row;
    }
    function renderList() {
      clear(listEl);
      let last = null;
      const counts = new Map();
      if (view === 'groups') for (const it of items) { const g = C.groupOf(it).key; counts.set(g, (counts.get(g) || 0) + 1); }
      items.forEach((it, i) => {
        if (view === 'groups') {
          const g = C.groupOf(it);
          if (g.key !== last) {
            last = g.key;
            const fam = it.kind === 'video' && g.fam ? familyName(g.fam) : '';
            listEl.append(h('div.cl-ghead', { dataset: { g: g.key }, dir: 'auto' }, h('span', g.name), fam && !g.name.toLowerCase().includes(fam.split(' ')[0].toLowerCase()) ? h('small', fam) : null, h('b', String(counts.get(g.key)))));
          }
        }
        listEl.append(rowFor(it, i));
      });
      reCurve();
      markListSel(false);
    }
    function markListSel(scroll) {
      const rows = listEl.querySelectorAll('.cl-row');
      rows.forEach((r, i) => r.classList.toggle('sel', i === sel));
      if (scroll) rows[sel]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    // ------------------------------------------------------------ empty state
    const EMPTY_HINT = {
      video: 'Import your GamEye, CLZ or Grouvee list from your phone, connect PriceCharting, RAWG, Steam or PlayStation — or scan a barcode.',
      board: 'Sync your BoardGameGeek collection, import a BG Stats or BGG export — or add the games you can play with nothing at all.',
      book: 'Import your Goodreads or CLZ Books export, scan a book’s barcode with your phone — or search Open Library.',
      vinyl: 'Connect Discogs, import a Discogs or CLZ Music export, scan a sleeve’s barcode — or search MusicBrainz.',
      cd: 'Connect Discogs, import a Discogs or CLZ Music export, scan the barcode on the case — or search MusicBrainz.',
      movie: 'Import your CLZ Movies export, scan a disc’s barcode with your phone — or search TMDB.',
    };
    function renderEmpty() {
      clear(empty);
      const m = KIND_META[kind];
      const total = shelfAll().length;
      const filtered = total > 0;
      empty.append(
        h('div.cl-empty-ic', { html: kglyph(kind) }),
        h('div.cl-empty-t', filtered ? 'Nothing matches' : `No ${m.plural.toLowerCase().replace(/^dvd/, 'DVD').replace(/blu-ray/, 'Blu-ray').replace(/^cds$/, 'CDs')} yet`),
        h('div.cl-empty-m', filtered ? (F().quick === 'lent' ? 'Nothing is lent out right now.' : 'Loosen the filters to see more of your shelf.') : EMPTY_HINT[kind]),
        h('div.cl-empty-b',
          filtered ? h('button.pill.small', { type: 'button', onclick: () => { resetF(); render(); } }, 'Show everything')
            : kind === 'board' ? h('button.pill.small', { type: 'button', onclick: () => openClassics() }, 'No-equipment games')
              : h('button.pill.small', { type: 'button', onclick: () => openConnections() }, 'Connect'),
          h('button.pill.small.primary', { type: 'button', onclick: () => openAdd() }, `Add ${['a', 'e', 'i', 'o', 'u'].includes(m.name[0].toLowerCase()) ? 'an' : 'a'} ${kind === 'cd' ? 'CD' : kind === 'movie' ? 'movie' : m.name.toLowerCase()}`)));
    }

    function render() {
      items = sorted();
      if (flashId) { const i = items.findIndex((x) => x.id === flashId); if (i >= 0) sel = i; }
      sel = Math.max(0, Math.min(items.length - 1, sel));
      el.dataset.view = view; el.dataset.empty = String(!items.length);
      renderCats(); renderQuick();
      if (!items.length) { clear(ring); clear(listEl); clear(info); cards = []; renderEmpty(); paintRim(); return; }
      if (view === 'ring') { clear(listEl); renderRing(); } else { clear(ring); cards = []; clear(info); renderList(); paintRim(); }
      if (flashId) { const id = flashId; setTimeout(() => { if (flashId === id) flashId = null; }, 1600); }
    }

    // ------------------------------------------------------------ one item
    function openItem(id) {
      openPanel({
        title: '', className: 'cl-item-panel',
        build(body, panel) {
          let digital, digitalFor = null, bm = undefined;
          const draw = () => {
            const it = C.getItem(id);
            if (!it) { panel.close(); return; }
            const m = KIND_META[it.kind];
            panel.setTitle(it.kind === 'board' ? (it.expansion ? 'Expansion' : C.boardTypeName(it.type)) : it.kind === 'video' ? (it.digital ? 'Digital game' : 'Video game')
              : it.kind === 'movie' ? (formatName('movie', it.format) || 'Movie') : it.kind === 'book' ? 'Book' : it.kind === 'vinyl' ? 'Vinyl' : 'CD');
            panel.el.style.setProperty('--k', m.color);
            panel.el.dataset.kind = it.kind;
            panel.el.dataset.shape = SQUARE.has(it.kind) ? 'sq' : 'tall';
            const keep = body.scrollTop;
            clear(body);
            const art = artBox(it, 'hero'); art._load();
            const chips = [];
            if (it.kind === 'board') {
              if (it.players) chips.push(['people', fmtPlayers(it.players)]);
              if (it.mins) chips.push(['clock', fmtMins(it.mins)]);
              if (it.age) chips.push(['person', `${it.age}+`]);
              if (it.rating) chips.push(['star', (Math.round(it.rating * 10) / 10).toFixed(1)]);
            } else if (it.kind === 'video') {
              if (it.platform) chips.push(['gamepad', platformName(it.platform)]);
              if (it.ownership) chips.push(['check', OWNERSHIP[it.ownership] || it.ownership]);
              if (it.hours) chips.push(['clock', `${it.hours} h played`]);
            } else if (it.kind === 'book') {
              if (it.format) chips.push(['book', formatName('book', it.format)]);
              if (it.pages) chips.push(['text', `${it.pages} pages`]);
            } else if (isMusic(it.kind)) {
              if (it.format) chips.push([it.kind === 'vinyl' ? 'vinyl' : 'disc', fmtLine(it)]);
              if (it.label || it.catno) chips.push(['tag', [it.label, it.catno].filter(Boolean).join(' · ')]);
              if (it.grade || it.sleeve) chips.push(['star', `Media ${it.grade || '—'} · Sleeve ${it.sleeve || '—'}`]);
            } else if (it.kind === 'movie') {
              if (it.format) chips.push(['film', fmtLine(it)]);
              if (it.region) chips.push(['globe', `Region ${it.region}`]);
              if (it.runtime) chips.push(['clock', fmtRuntime(it.runtime)]);
            }
            if (it.value) chips.push(['tag', `${C.fmtMoney(it.value)}${(it.qty || 1) > 1 ? ` ×${it.qty}` : ''}`]);
            const exps = C.expansionsOf(it);
            const sub = it.kind === 'video' ? [platformName(it.platform) || 'Platform?', it.edition, it.year]
              : it.kind === 'board' ? [it.edition, it.year] : [it.by || (it.kind === 'movie' ? '' : `${m.by}?`), it.kind === 'movie' && it.by ? `dir. ${it.by}` : '', it.year].filter((x, i) => !(it.kind === 'movie' && i === 0));
            body.append(h('div.cl-item',
              h('div.cl-head', art, h('div.cl-head-r',
                h('button.cl-item-t', { type: 'button', dir: 'auto', onclick: () => editField('title'), 'aria-label': 'Edit title' }, it.title),
                h('button.cl-item-m', { type: 'button', dir: 'auto', 'aria-label': sub.filter(Boolean).join(' · ') || (it.kind === 'video' || it.kind === 'board' ? 'Edit details' : `Add the ${(C.KIND_META?.[it.kind]?.by || 'author').toLowerCase()}`), onclick: () => (it.kind === 'video' || it.kind === 'board' ? openEdit(id) : editField('by')) }, sub.filter(Boolean).join(' · ') || ' '),
                h('div.cl-badges', Object.keys(it.sources || { manual: 1 }).map((s) => h('span.cl-src', { '--s': C.SOURCES[s]?.color || '#94a3b8' }, h('i'), C.SOURCES[s]?.short || C.sourceName(s)))),
                h('div.cl-when', `Added ${ago(it.added)}`))),
              chips.length ? h('div.cl-chips', chips.map(([ic, t]) => h('span.cl-chip', { dir: 'auto' }, h('i', { html: ICON[ic] ? svgPath(ICON[ic]) : ic === 'book' ? svgPath(C.GLYPHS.book) : icon(ic) }), t))) : null,
              actionBox(it),
              genreBox(it),
              lendBox(it),
              h(`button.cl-note${it.notes ? '' : '.empty'}`, { type: 'button', dir: 'auto', onclick: () => editField('notes') }, h('i', { html: icon('edit') }), h('span', it.notes || NOTE_HINT[it.kind])),
              h('div.cl-tags', (it.tags || []).map((t) => h('span.cl-tagc', { dir: 'auto' }, `#${t}`)), h('button.cl-tagc.add', { type: 'button', onclick: () => editField('tags') }, (it.tags || []).length ? 'Edit tags' : '+ Tags')),
              exps.length ? h('div.cl-exps', h('div.cl-sec', `${exps.length} expansion${exps.length === 1 ? '' : 's'}`),
                exps.map((x) => h('button.row.cl-exp', { type: 'button', onclick: () => openItem(x.id) }, artBox(x, 'thumb.sq'), h('div.row-text', h('div.row-title', { dir: 'auto' }, x.title), h('div.row-sub', [x.year, x.plays ? `${x.plays} plays` : ''].filter(Boolean).join(' · ') || 'Expansion'))))) : null,
              fine(it),
              h('div.cl-item-acts',
                h('button.pill.small', { type: 'button', onclick: () => openEdit(id) }, 'Edit details'),
                h('button.pill.small.danger', { type: 'button', onclick: () => confirmRemove(it, panel) }, 'Remove'))));
            body.scrollTop = keep;
            body.querySelectorAll('.cl-exp .cl-art').forEach((a) => a._load?.());
            // a movie you also have on Plex / Jellyfin; a book that's already in Bookmarks
            if (it.kind === 'movie' && digitalFor !== it.title) { digitalFor = it.title; Y.digitalCopy(it).then((d) => { digital = d; if (!panel.closed) draw(); }).catch(() => {}); }
            if (it.kind === 'book' && bm === undefined) { bm = null; Y.inBookmarks(it).then((b) => { bm = b; if (!panel.closed && b) draw(); }); }
          };
          const NOTE_HINT = { video: 'Add a note — edition, where it is…', board: 'Add a note — where it is, house rules…', book: 'Add a note — signed copy, where it is, who recommended it…',
            vinyl: 'Add a note — pressing, matrix, where you bought it…', cd: 'Add a note — edition, where you bought it…', movie: 'Add a note — edition, extras, where it is…' };
          const fine = (it) => {
            const bits = [it.condition, it.isbn ? `ISBN ${it.isbn}` : '', it.kind === 'book' ? it.publisher : '', it.country, it.edition && it.kind !== 'video' ? it.edition : '', it.paid ? `Paid ${C.fmtMoney(it.paid)}` : '', it.upc && it.upc !== it.isbn ? `Barcode ${it.upc}` : ''].filter(Boolean);
            return bits.length ? h('div.cl-fine', { dir: 'auto' }, bits.join(' · ')) : null;
          };
          const actionBox = (it) => {
            if (it.kind === 'board') return h('div.cl-acol', playsBox(it), it.game ? h('button.pill.small.primary.cl-go', { type: 'button', onclick: () => { app.sfx('whoosh'); app.go('game', { id: it.game }); } }, h('i', { html: icon('play') }), 'Play it on this screen') : null);
            if (it.kind === 'video') return beatBox(it);
            if (it.kind === 'book') return h('div.cl-acol', readBox(it), h('button.pill.small.primary.cl-go', { type: 'button', onclick: () => startReading(it) }, h('i', { html: svgPath(ICON.bookmark) }), bm ? 'Open in Bookmarks' : 'Start reading'));
            if (isMusic(it.kind)) {
              const svc = app.player?.provider?.name || 'your music service';
              return h('button.pill.small.primary.cl-go.cl-playalbum', { type: 'button', onclick: (e) => playAlbum(it, e.currentTarget) }, h('i', { html: icon('play') }), `Play on ${svc}`);
            }
            if (it.kind === 'movie') return digital ? h('button.pill.small.primary.cl-go.cl-playdig', { type: 'button', onclick: () => playDig(it) }, h('i', { html: icon('play') }), `Play from ${digital.server}`) : null;
            return null;
          };
          const genreBox = (it) => {
            if (it.kind === 'board') {
              return h('div.cl-tags.cl-genres', h('button.cl-tagc.gen', { type: 'button', onclick: () => editField('type') }, C.boardTypeName(it.type)),
                ...(it.traits || []).map((t) => h('span.cl-tagc', BOARD_TRAITS.find((x) => x[0] === t)?.[1] || t)), h('button.cl-tagc.add', { type: 'button', onclick: () => editField('traits') }, (it.traits || []).length ? 'Edit' : '+ Strategy, co-op…'));
            }
            if (!C.MEDIA.includes(it.kind)) return null;
            return h('div.cl-tags.cl-genres', (it.genres || []).map((g) => h('button.cl-tagc.gen', { type: 'button', dir: 'auto', onclick: () => editField('genres') }, g)),
              h('button.cl-tagc.add', { type: 'button', onclick: () => editField('genres') }, (it.genres || []).length ? 'Edit genre' : '+ Genre'));
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
          // books: to read / reading / read
          const readBox = (it) => h('div.cl-seg2.cl-read', READ.map(([v, l]) => h(`button.cl-st${v === 'read' ? '.ok' : ''}${(it.read || 'want') === v ? '.on' : ''}`, { type: 'button', dataset: { r: v },
            onclick: () => { C.updateItem(id, { read: v }); app.sfx(v === 'read' ? 'score' : 'tap'); } }, l)));
          const lendBox = (it) => (it.lent?.name
            ? h('div.cl-lend.on', h('i', { html: svgPath(ICON.hand) }), h('div', h('b', { dir: 'auto' }, `Lent to ${it.lent.name}`), h('span', it.lent.at ? `${since(it.lent.at)} ago · ${new Date(it.lent.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : '')),
              h('button.pill.small', { type: 'button', onclick: () => { C.unlend(id); app.sfx('coin'); app.toast(`“${it.title}” is back`); } }, 'Returned'))
            : h('button.cl-lend', { type: 'button', onclick: async () => {
              const v = await app.editText({ title: 'Lend it to…', placeholder: 'Name', okLabel: 'Lend' });
              if (v) { C.lend(id, v); app.sfx('pop'); }
            } }, h('i', { html: svgPath(ICON.hand) }), h('span', 'Lend it to someone…')));
          async function playAlbum(it, b) {
            b.classList.add('busy');
            try { const r = await Y.playAlbum(it); app.sfx('win'); app.toast(`Playing “${r.title}” on ${r.service}`); }
            catch (e) { app.toast(errText(e), { kind: 'error', ms: 3800 }); }
            b.classList.remove('busy');
          }
          async function playDig(it) {
            try { await Y.playDigital(digital); app.sfx('win'); app.toast(`Playing “${digital.title}” from ${digital.server}`); }
            catch (e) { app.toast(errText(e), { kind: 'error', ms: 4200 }); }
            void it;
          }
          async function startReading(it) {
            try {
              const b = await Y.startReading(it); bm = b;
              app.sfx('pop'); app.toast(`“${b.title}” is in Bookmarks`);
              if (it.read !== 'reading' && it.read !== 'read') C.updateItem(id, { read: 'reading' });
              setTimeout(() => app.go('app', { id: 'books' }), 450);
            } catch (e) { app.toast(errText(e), { kind: 'error' }); }
          }
          async function editField(f) {
            const it = C.getItem(id);
            if (f === 'title') { const v = await app.editText({ title: 'Title', value: it.title }); if (v) C.updateItem(id, { title: v }); }
            if (f === 'by') { const v = await app.editText({ title: KIND_META[it.kind].by, value: it.by || '', okLabel: 'Save' }); if (v !== null) C.updateItem(id, { by: v.trim() }); }
            if (f === 'notes') { const v = await app.editText({ title: 'Note', value: it.notes || '', placeholder: NOTE_HINT[it.kind], okLabel: 'Save' }); if (v !== null) C.updateItem(id, { notes: v }); }
            if (f === 'tags') {
              const v = await app.editText({ title: 'Tags (comma separated)', value: (it.tags || []).join(', '), placeholder: 'favourite, signed, family', okLabel: 'Save' });
              if (v !== null) C.updateItem(id, { tags: [...new Set(v.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean))].slice(0, 12) });
            }
            if (f === 'genres') chooseMulti('Genre', [...new Set([...(it.genres || []), ...(GENRES[it.kind] || [])])].map((g) => [g, g]), it.genres || [], (v) => C.updateItem(id, { genres: v }), 'e.g. Shoegaze');
            if (f === 'type') choose('Type', BOARD_TYPES, it.type || 'board', (v) => C.updateItem(id, { type: v }));
            if (f === 'traits') chooseMulti('Also', BOARD_TRAITS, it.traits || [], (v) => C.updateItem(id, { traits: v }));
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
            Object.keys(it.sources || {}).some((s) => ['bgg', 'pricecharting', 'rawg', 'steam', 'discogs'].includes(s)) ? h('div.cl-conf-m', 'It will come back on the next sync unless you remove it there too.') : null,
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
            const row = (label, value, fn, f) => list.append(h('button.row.cl-erow', { type: 'button', dataset: { f: f || label }, onclick: fn }, h('div.row-text', h('div.row-sub', label), h('div.row-title', { dir: 'auto' }, value || '—')), h('i.cl-chev', { html: icon('chevron') })));
            const text = (f, label, ph = '', conv = (v) => v, show = (v) => v) => row(label, show(it[f]), async () => {
              const v = await app.editText({ title: label, value: it[f] != null ? String(show(it[f])) : '', placeholder: ph, okLabel: 'Save' });
              if (v !== null) C.updateItem(id, { [f]: conv(v) });
            }, f);
            const int = (v) => parseInt(v, 10) || null;
            const pick = (f, label, opts) => row(label, opts.find((o) => o[0] === it[f])?.[1] || it[f] || '', () => choose(label, [['', 'Not set'], ...opts], it[f] || '', (v) => C.updateItem(id, { [f]: v })), f);
            const genres = () => row('Genre', (it.genres || []).join(', '), () => chooseMulti('Genre', [...new Set([...(it.genres || []), ...(GENRES[it.kind] || [])])].map((g) => [g, g]), it.genres || [], (v) => C.updateItem(id, { genres: v }), 'e.g. Shoegaze'), 'genres');
            const range2 = (v) => { const m = [...v.matchAll(/\d+/g)].map((x) => +x[0]); return m.length ? [m[0], Math.max(m[0], m[m.length - 1] || m[0])] : null; };
            text('title', 'Title');
            if (it.kind === 'video') {
              row('Platform', platformName(it.platform), () => choose('Platform', [...new Set([it.platform, ...PLATFORM_CHOICES].filter(Boolean))].map((p) => [p, platformShort(p)]), it.platform, (v) => C.updateItem(id, { platform: v }), true), 'platform');
              row('What you have', OWNERSHIP[it.ownership] || '', () => choose('What you have', [['', 'Not set'], ...Object.entries(OWNERSHIP)], it.ownership || '', (v) => C.updateItem(id, { ownership: v, digital: v === 'digital' })), 'ownership');
              text('hours', 'Hours played', 'e.g. 42', (v) => Math.max(0, parseFloat(v) || 0));
              text('completion', 'Progress', 'e.g. 100%, main story done');
            } else if (it.kind === 'board') {
              row('Type', C.boardTypeName(it.type), () => choose('Type', BOARD_TYPES, it.type || 'board', (v) => C.updateItem(id, { type: v })), 'type');
              row('Also', (it.traits || []).map((t) => BOARD_TRAITS.find((x) => x[0] === t)?.[1] || t).join(', '), () => chooseMulti('Also', BOARD_TRAITS, it.traits || [], (v) => C.updateItem(id, { traits: v })), 'traits');
              text('players', 'Players', 'e.g. 2-4', range2, (v) => (v ? `${v[0]}–${v[1]}` : ''));
              text('mins', 'Play time (minutes)', 'e.g. 30-60', range2, (v) => (v ? `${v[0]}–${v[1]}` : ''));
              text('plays', 'Plays', '0', (v) => Math.max(0, parseInt(v, 10) || 0));
            } else if (it.kind === 'book') {
              text('by', 'Author', 'e.g. Ursula K. Le Guin');
              text('isbn', 'ISBN', '978…', (v) => isbnOf(v) || v.replace(/[^\dXx]/g, ''));
              text('publisher', 'Publisher');
              pick('format', 'Format', FORMATS.book);
              text('pages', 'Pages', 'e.g. 320', int);
              pick('read', 'Read', READ);
              genres();
            } else if (isMusic(it.kind)) {
              text('by', 'Artist');
              text('label', 'Label', 'e.g. Blue Note');
              text('catno', 'Catalogue number', 'e.g. BST 84003');
              pick('format', 'Format', FORMATS[it.kind]);
              if (it.kind === 'vinyl') {
                text('variant', 'Colour / pressing', 'e.g. Red marbled, 180 g');
                row('Speed', it.rpm ? `${it.rpm} RPM` : '', () => choose('Speed', [['', 'Not set'], ['33', '33⅓ RPM'], ['45', '45 RPM'], ['78', '78 RPM']], it.rpm ? String(it.rpm) : '', (v) => C.updateItem(id, { rpm: +v || null })), 'rpm');
              }
              text('discs', 'Discs', 'e.g. 2', int);
              pick('grade', it.kind === 'vinyl' ? 'Record grade (Goldmine)' : 'Disc grade', GRADES.map(([g, l]) => [g, `${g} · ${l}`]));
              pick('sleeve', it.kind === 'vinyl' ? 'Sleeve grade' : 'Case / booklet grade', [...GRADES.map(([g, l]) => [g, `${g} · ${l}`]), ...SLEEVE_EXTRA]);
              text('country', 'Country', 'e.g. UK');
              genres();
            } else if (it.kind === 'movie') {
              pick('format', 'Format', FORMATS.movie);
              row('Steelbook', it.steelbook ? 'Yes' : 'No', () => C.updateItem(id, { steelbook: !it.steelbook }), 'steelbook');
              pick('region', 'Region', REGIONS);
              text('by', 'Director');
              text('runtime', 'Runtime (minutes)', 'e.g. 136', int);
              genres();
            }
            text('edition', it.kind === 'video' ? 'Edition / region' : 'Edition', it.kind === 'movie' ? 'e.g. Criterion, Director’s cut' : 'e.g. Collector’s, first edition');
            text('condition', 'Condition', it.kind === 'book' ? 'e.g. Dust jacket worn' : 'e.g. Box worn, manual missing');
            text('year', 'Year', 'e.g. 2017', (v) => parseInt(v, 10) || null);
            text('qty', 'Copies', '1', (v) => Math.max(1, parseInt(v, 10) || 1));
            text('paid', 'Price paid', 'e.g. 39.99', (v) => (v.trim() ? Math.round(parseFloat(v.replace(',', '.')) * 100) || null : null), (v) => (v ? (v / 100).toFixed(2) : ''));
            text('value', 'Value', 'e.g. 25', (v) => (v.trim() ? Math.round(parseFloat(v.replace(',', '.')) * 100) || null : null), (v) => (v ? (v / 100).toFixed(2) : ''));
            if (it.kind === 'board') row('Expansion', it.expansion ? 'Yes' : 'No', () => C.updateItem(id, { expansion: !it.expansion }), 'expansion');
            else if (it.kind === 'video') row('Digital copy', it.digital ? 'Yes' : 'No', () => C.updateItem(id, { digital: !it.digital }), 'digital');
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
          body.append(h('div.cl-choose-c', opts.map(([v, label]) => h(`button.chip${v === cur ? '.on' : ''}`, { type: 'button', dataset: { v }, onclick: () => { onPick(v); app.sfx('tick'); panel.close(); } }, label)),
            other ? h('button.chip', { type: 'button', onclick: async () => { const v = await app.editText({ title, placeholder: typeof other === 'string' ? other : 'e.g. Sega Saturn', okLabel: 'Save' }); if (v) { onPick(v); panel.close(); } } }, 'Other…') : null));
        },
      });
    }
    function chooseMulti(title, opts, cur, onDone, other = '') {
      const picked = new Set(cur);
      openPanel({
        title, className: 'cl-choose',
        build(body, panel) {
          const box = h('div.cl-choose-c.multi');
          const draw = () => {
            clear(box);
            box.append(...opts.map(([v, label]) => h(`button.chip${picked.has(v) ? '.on' : ''}`, { type: 'button', dir: 'auto', dataset: { v }, onclick: () => { if (picked.has(v)) picked.delete(v); else if (picked.size < 4) picked.add(v); app.sfx('tick'); draw(); } }, label)),
              ...(other ? [h('button.chip', { type: 'button', onclick: async () => { const v = await app.editText({ title, placeholder: other, okLabel: 'Add' }); if (v?.trim()) { opts.unshift([v.trim(), v.trim()]); picked.add(v.trim()); draw(); } } }, 'Other…')] : []),
              h('button.pill.small.primary.cl-done', { type: 'button', onclick: () => { onDone(opts.map((o) => o[0]).filter((v) => picked.has(v))); app.sfx('pop'); panel.close(); } }, 'Done'));
          };
          body.append(box); draw();
        },
      });
    }

    // ------------------------------------------------------------ add
    const ADD_PH = { video: 'Search games', board: 'Search board games', book: 'Title, author or ISBN', vinyl: 'Artist and album', cd: 'Artist and album', movie: 'Search movies and shows' };
    const MANUAL_PH = { video: 'e.g. Super Mario Odyssey', board: 'e.g. Wingspan', book: 'e.g. The Left Hand of Darkness', vinyl: 'e.g. Kind of Blue', cd: 'e.g. OK Computer', movie: 'e.g. Spirited Away' };
    function openAdd(k = kind) {
      const m = KIND_META[k];
      openPanel({
        title: k === 'movie' ? 'Add a movie or show' : k === 'cd' ? 'Add a CD' : k === 'vinyl' ? 'Add a record' : `Add a ${m.name.toLowerCase()}`, className: 'search-panel cl-add-panel',
        build(body, panel) {
          panel.el.style.setProperty('--k', m.color);
          const input = h('input.search-input', { type: 'search', placeholder: ADD_PH[k], autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
          const list = h('div.list.cl-res');
          const useKbd = wantsKeyboard();
          const setKbd = (on) => panel.el.classList.toggle('kbd-open', on);
          body.append(h('div.search-bar', input, useKbd ? app.iconBtn('keyboard', 'Keyboard', () => setKbd(!panel.el.classList.contains('kbd-open')), 'kbd-toggle') : null), list);
          const recurve = curve(list);
          let seq = 0, src = null;
          const note = (msg) => h('div.cl-res-note', msg);
          const sec = (t) => h('div.cl-sec', t);
          const byHand = (q) => h('button.row.cl-rrow.manual', { type: 'button', onclick: () => manual(q) },
            h('div.cl-art.thumb.hand', { html: icon('edit') }), h('div.row-text', h('div.row-title', { dir: 'auto' }, q ? `Add “${q}”` : 'Type the title'), h('div.row-sub', q ? 'As you typed it' : 'Add the details later')));
          const phoneRow = () => h('button.row.cl-rrow.manual', { type: 'button', onclick: () => { panel.close(); openPhone('add', k); } },
            h('div.cl-art.thumb.hand', { html: svgPath(ICON.barcode) }), h('div.row-text', h('div.row-title', 'Scan a barcode with your phone'),
              h('div.row-sub', { video: 'Or upload your GamEye / CLZ export', board: 'Or upload your BGG / BG Stats export', book: 'Or upload your Goodreads / CLZ Books export', vinyl: 'Or upload your Discogs / CLZ Music export', cd: 'Or upload your Discogs / CLZ Music export', movie: 'Or upload your CLZ Movies export' }[k])));
          const classicsRow = () => h('button.row.cl-rrow.manual.cl-classics-row', { type: 'button', onclick: () => { panel.close(); openClassics(); } },
            h('div.cl-art.thumb.hand', { html: svgPath(ICON.hands0) }), h('div.row-text', h('div.row-title', 'Games you need nothing for'), h('div.row-sub', 'פתקיות, Charades, 20 Questions, Mafia…')));
          const added = (it) => {
            if (!it) return null;
            app.sfx('pop'); flashId = it.id;
            panel.close();
            if (it.kind !== kind) { kind = it.kind; app.save('kind', kind); }
            if (!it.duplicate && !passes(it)) resetF();
            app.toast(it.duplicate ? 'Already in your collection' : `Added “${it.title}”`);
            render(); setTimeout(() => openItem(it.id), 160);
            return it;
          };
          async function manual(q) {
            let v = q;
            if (!v) { v = await app.editText({ title: `${k === 'movie' ? 'Movie' : m.name} title`, placeholder: MANUAL_PH[k], okLabel: 'Next' }); if (!v) return; }
            if (k === 'board') { added(C.addItem({ kind: 'board', title: v, source: 'manual' })); return; }
            if (k === 'video') { choosePlatform(null, (p) => added(C.addItem({ kind: 'video', title: v, platform: p, source: 'manual' }))); return; }
            if (k === 'movie') { chooseFormat('movie', (f) => added(C.addItem({ kind: 'movie', title: v, format: f, source: 'manual' }))); return; }
            const by = await app.editText({ title: m.by, placeholder: k === 'book' ? 'e.g. Ursula K. Le Guin' : 'e.g. Miles Davis', okLabel: 'Add' });
            if (by === null) return;
            added(C.addItem({ kind: k, title: v, by: by.trim(), format: k === 'vinyl' ? 'lp' : k === 'cd' ? 'cd' : '', source: 'manual' }));
          }
          function choosePlatform(e, done) {
            const opts = (e?.platforms || []).map((p) => C.canonPlatform(p)).filter(Boolean);
            const list2 = [...new Set([...opts, ...PLATFORM_CHOICES])].slice(0, opts.length ? Math.max(opts.length, 8) : 14);
            choose('Which platform?', list2.map((p) => [p, platformShort(p)]), null, done, true);
          }
          function chooseFormat(kk, done) { choose(kk === 'movie' ? 'Which disc?' : 'Which format?', FORMATS[kk].slice(0, kk === 'movie' ? 5 : 8), null, done); }
          const pickResult = (e) => {
            const source = e.source || src?.src || 'manual';
            if (k === 'board') return added(C.addItem({ ...e, kind: 'board', source }));
            if (k === 'video') {
              if (e.platform) return added(C.addItem({ ...e, kind: 'video', source }));
              return choosePlatform(e, (p) => added(C.addItem({ ...e, kind: 'video', platform: p, source })));
            }
            if (k === 'movie') {
              return chooseFormat('movie', async (f) => {
                const it = added(C.addItem({ ...e, kind: 'movie', format: f, source }));
                if (it && !it.duplicate && e.tmdbId) {
                  const d = await Y.tmdbDetails(e.tmdbId, e.tmdbType);
                  if (d) C.updateItem(it.id, { runtime: d.runtime || it.runtime || null, by: d.by || '', ...(d.genres?.length ? { genres: d.genres } : {}) }, { user: false });
                }
              });
            }
            if (isMusic(k)) {
              const kk = source === 'discogs' && isMusic(e.kind) ? e.kind : k;
              return added(C.addItem({ ...e, kind: kk, format: e.format || (kk === 'vinyl' ? 'lp' : 'cd'), source }));
            }
            return added(C.addItem({ ...e, kind: k, source }));
          };
          const resultRow = (e) => {
            const art = artBox({ ...e, kind: k }, 'thumb'); art._load();
            const have = C.findItem({ kind: k, title: e.title, platform: e.platform, by: e.by });
            const subBits = k === 'board' ? [e.year, fmtPlayers(e.players), e.type && e.type !== 'board' ? C.boardTypeName(e.type) : '']
              : k === 'video' ? [e.year, (e.platforms || []).slice(0, 3).map((p) => platformShort(C.canonPlatform(p))).join(', ')]
                : k === 'movie' ? [e.year, e.tmdbType === 'tv' ? 'TV show' : 'Movie', (e.genres || []).slice(0, 2).join(', ')]
                  : [e.by, e.year, e.format ? formatName(e.kind || k, e.format) : '', e.label || e.publisher || '', (e.genres || [])[0] || ''];
            return h(`button.row.cl-rrow${have ? '.on' : ''}`, { type: 'button', onclick: () => pickResult(e) }, art, h('div.row-text', h('div.row-title', { dir: 'auto' }, e.title),
              h('div.row-sub', { dir: 'auto' }, [...subBits, have ? 'In your collection' : ''].filter(Boolean).join(' · '))),
            have ? h('i.cl-have', { html: icon('check') }) : null);
          };
          function hintPage() {
            clear(list);
            const name = src?.name || '';
            list.append(note(!src ? 'Type a title.' : src.ready ? `Searches ${name}${k === 'book' ? ' — or type an ISBN' : ''}. Covers and details included.`
              : `Type a title. (Set up ${name} in ⋯ → Connections to search with covers.)`), byHand(''), phoneRow());
            if (k === 'board') list.append(classicsRow());
            recurve();
          }
          async function run(q) {
            q = q.trim();
            const my = ++seq;
            if (q.length < 2) { hintPage(); return; }
            clear(list);
            const isbn = k === 'book' ? isbnOf(q) : '';
            const code = !isbn && /^\d{8,14}$/.test(q.replace(/\s/g, '')) ? q.replace(/\s/g, '') : '';
            if (src?.ready || isbn || code) {
              list.append(h('div.loading', h('div.spin'), h('div', isbn || code ? 'Looking it up…' : 'Searching…')));
              let r = null, err = null;
              try { r = isbn || code ? (await Y.lookupCode(isbn || code)).filter((x) => !x.kind || x.kind === k || (isMusic(k) && isMusic(x.kind))) : await Y.search(k, q); } catch (e) { err = errText(e); }
              if (my !== seq) return;
              clear(list);
              if (err) list.append(note(err));
              else if (!r.length) list.append(note('Nothing found'));
              else { list.append(sec(isbn ? 'ISBN' : code ? 'Barcode' : src?.name || '')); r.forEach((e) => list.append(resultRow(e))); }
            }
            const mine = C.items(k).filter((x) => C.normTitle(x.title).includes(C.normTitle(q)) || (x.by && C.normTitle(x.by).includes(C.normTitle(q)))).slice(0, 3);
            if (mine.length) { list.append(sec('Already in your collection')); mine.forEach((x) => list.append(h('button.row.cl-rrow.on', { type: 'button', onclick: () => { panel.close(); openItem(x.id); } }, (() => { const a = artBox(x, 'thumb'); a._load(); return a; })(), h('div.row-text', h('div.row-title', { dir: 'auto' }, x.title), h('div.row-sub', { dir: 'auto' }, metaBits(x).join(' · '))), h('i.cl-have', { html: icon('check') })))); }
            if (src?.ready || mine.length) list.append(sec('Not here?'));
            if (!isbn && !code) list.append(byHand(q));
            list.scrollTop = 0; recurve();
          }
          const debounced = debounce((v) => run(v), 500);
          input.addEventListener('input', () => debounced(input.value));
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { run(input.value); setKbd(false); } });
          list.addEventListener('pointerdown', () => setKbd(false));
          hintPage();
          const known = (inf) => { src = Y.searchSource(k, inf); if (k === 'board') src.ready = Y.configured('bgg', inf); if (!input.value.trim()) hintPage(); };
          Y.info().then(known).catch(() => { src = C.MEDIA.includes(k) && k !== 'movie' ? Y.searchSource(k, null) : { ...Y.searchSource(k, null), ready: false }; if (!input.value.trim()) hintPage(); });
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

    // ------------------------------------------------------------ games you need nothing for (one tap each)
    function openClassics() {
      openPanel({
        title: 'No equipment needed', className: 'cl-classics-panel',
        build(body, panel) {
          panel.el.style.setProperty('--k', KIND_META.board.color);
          const list = h('div.list.cl-clist');
          body.append(list);
          const recurve = curve(list);
          const draw = () => {
            clear(list);
            list.append(h('div.cl-res-note', 'Games you can play anywhere, with nothing but people. Tap to put one on your board-game shelf.'));
            const have = (c) => C.findItem({ kind: 'board', title: c.title });
            const missing = NO_EQUIP.filter((c) => !have(c));
            if (missing.length > 1) list.append(h('div.cl-classics-all', h('button.pill.small.primary', { type: 'button', onclick: () => { for (const c of missing) C.addClassic(c.id); app.sfx('score'); app.toast(`Added ${missing.length} games`); draw(); } }, `Add all ${missing.length}`)));
            for (const c of NO_EQUIP) {
              const it = have(c);
              list.append(h(`button.row.cl-rrow.cl-classic${it ? '.on' : ''}`, { type: 'button', dataset: { c: c.id }, onclick: () => {
                if (it) { panel.close(); openItem(it.id); return; }
                const x = C.addClassic(c.id); app.sfx('pop'); app.toast(`Added “${x.title}”`); flashId = x.id; draw();
              } }, h('div.cl-art.thumb.sq.hand.cl-cl-ic', { html: svgPath(ICON.hands0) }),
              h('div.row-text', h('div.row-title', { dir: 'auto' }, c.title, c.he && !c.title.includes(c.he) ? h('span.cl-he', { dir: 'rtl' }, c.he) : null),
                h('div.row-sub', [fmtPlayers(c.players), fmtMins(c.mins), c.aka || (c.game ? 'also on this screen' : '')].filter(Boolean).join(' · '))),
              h('i.cl-have', { html: it ? icon('check') : icon('plus') })));
            }
            recurve();
          };
          draw();
          panel.onDestroy = () => { if (kind !== 'board') { kind = 'board'; app.save('kind', kind); } render(); };
        },
      });
    }

    // ------------------------------------------------------------ search your collection
    function openSearch() {
      openPanel({
        title: 'Search your collection', className: 'search-panel cl-add-panel',
        build(body, panel) {
          panel.el.style.setProperty('--k', KIND_META[kind].color);
          const input = h('input.search-input', { type: 'search', placeholder: 'Title, artist, author, genre, who has it…', autocomplete: 'off', spellcheck: 'false' });
          const list = h('div.list.cl-res');
          const useKbd = wantsKeyboard();
          const setKbd = (on) => panel.el.classList.toggle('kbd-open', on);
          body.append(h('div.search-bar', input, useKbd ? app.iconBtn('keyboard', 'Keyboard', () => setKbd(!panel.el.classList.contains('kbd-open')), 'kbd-toggle') : null), list);
          const recurve = curve(list);
          const run = () => {
            const q = C.normTitle(input.value);
            clear(list);
            const all = C.items();
            const hits = !q ? [] : all.filter((x) => [x.title, x.by, platformName(x.platform), platformShort(x.platform), x.edition, x.notes, (x.tags || []).join(' '), (x.genres || []).join(' '), x.label, x.catno, x.isbn, x.lent?.name, x.digital ? 'digital' : ''].some((s) => s && C.normTitle(s).includes(q)));
            if (!q) list.append(h('div.cl-res-note', `${all.length} things on your shelves — type to find one.`));
            else if (!hits.length) list.append(h('div.cl-res-note', 'Nothing found'));
            for (const x of hits.slice(0, 60)) {
              const a = artBox(x, 'thumb'); a._load();
              list.append(h('button.row.cl-rrow', { type: 'button', onclick: () => { panel.close(); if (x.kind !== kind) { kind = x.kind; app.save('kind', kind); render(); } openItem(x.id); } }, a,
                h('div.row-text', h('div.row-title', { dir: 'auto' }, x.title), h('div.row-sub', { dir: 'auto' }, [KIND_META[x.kind].short, ...metaBits(x).slice(0, 2), x.lent?.name ? `Lent to ${x.lent.name}` : ''].filter(Boolean).join(' · ')))));
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
            const group = (label, key, opts, id) => box.append(h('div.cl-fg', { dataset: { g: id || key } }, h('div.cl-fl', label),
              h('div.cl-fopts', opts.map(([v, l]) => h(`button.chip${f[key] === v ? '.on' : ''}`, { type: 'button', dir: 'auto', dataset: { v }, onclick: () => { f[key] = v; saveF(); sel = 0; app.sfx('tick'); draw(); render(); } }, l)))));
            group('Sort', 'sort', SORTS[kind]);
            const gopts = [['any', 'Any'], ...groupChips().map((g) => [g.key, `${g.name} · ${g.n}`])];
            if (kind === 'video') {
              group('Platform family', 'grp', gopts, 'family');
              const plats = [...new Set(shelfAll().filter((x) => f.grp === 'any' || grpKey(x) === f.grp).map((x) => x.platform).filter(Boolean))].sort((a, b) => { const ra = C.groupOf({ kind: 'video', platform: a }).rank, rb = C.groupOf({ kind: 'video', platform: b }).rank; return ra[0] - rb[0] || ra[1] - rb[1]; });
              group('Platform', 'plat', [['any', 'Any'], ...plats.map((p) => [p, platformShort(p)]), ...(shelfAll().some((x) => x.digital) ? [['digital', 'Digital']] : [])]);
              group('Status', 'status', [['any', 'Any'], ['unplayed', 'Unplayed'], ['played', 'Played'], ['beaten', 'Beaten'], ['unbeaten', 'Not beaten']]);
              box.append(h('div.cl-fg', h('div.cl-fl', 'Digital games'), h('div.cl-fopts',
                h(`button.chip${!f.hideDigital ? '.on' : ''}`, { type: 'button', onclick: () => { f.hideDigital = false; saveF(); draw(); render(); } }, 'Show'),
                h(`button.chip${f.hideDigital ? '.on' : ''}`, { type: 'button', dataset: { hd: '1' }, onclick: () => { f.hideDigital = true; saveF(); sel = 0; draw(); render(); } }, 'Hide'))));
            } else if (kind === 'board') {
              group('Type', 'grp', gopts, 'type');
              const traits = BOARD_TRAITS.filter(([t]) => shelfAll().some((x) => (x.traits || []).includes(t)));
              if (traits.length) group('Also', 'trait', [['any', 'Any'], ...traits]);
              group('Players', 'pl', [['any', 'Any'], ['1', 'Solo'], ['2', '2'], ['34', '3–4'], ['5', '5+']]);
              group('Time', 'time', [['any', 'Any'], ['30', '≤ 30 min'], ['60', '≤ 1 h'], ['120', '≤ 2 h'], ['long', 'Longer']]);
              group('Status', 'status', [['any', 'Any'], ['unplayed', 'Never played'], ['played', 'Played']]);
            } else {
              group('Genre', 'grp', gopts, 'genre');
              if (kind === 'book') group('Read', 'read', [['any', 'Any'], ...READ]);
              const fmts = FORMATS[kind].filter(([v]) => shelfAll().some((x) => x.format === v));
              if (fmts.length > 1 || f.fmt !== 'any') group('Format', 'fmt', [['any', 'Any'], ...fmts]);
            }
            group('Show', 'quick', [['all', 'Everything'], ['lent', 'Lent out'], ...(NEW_LABEL[kind] ? [['new', NEW_LABEL[kind]]] : [])]);
            const n = sorted().length;
            box.append(h('div.cl-fsum', `${C.unitOf(kind, n)} match`),
              h('button.pill.small', { type: 'button', onclick: () => { resetF(); sel = 0; app.sfx('drop'); draw(); render(); } }, 'Reset filters'));
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
          const game = kind === 'video' || kind === 'board';
          body.append(h('div.cl-menu',
            row(svgPath(ICON.dice), game ? 'Pick something to play' : 'Pick one at random', game ? `Decide spins your ${KIND_META[kind].plural.toLowerCase()}` : `A spin through your ${KIND_META[kind].plural.replace(/^CDs$/, 'CDs')}`, pickToPlay, '.hl'),
            row(svgPath(ICON.chart), 'Stats', 'Counts per shelf, platform, genre, value', openStats),
            row(svgPath(ICON.plug), 'Connections & import', nConn ? `${nConn} connected · BGG, Discogs, Steam, PlayStation, files…` : 'BGG, Discogs, PriceCharting, Steam, PlayStation, Goodreads…', openConnections),
            row(svgPath(ICON.phone), 'Add from your phone', 'Scan a barcode or upload an export', () => openPhone('add'))));
        },
      });
    }

    function pickToPlay() {
      const pool = shelfAll().filter((x) => passes(x));
      if (!pool.length) { app.toast(shelfAll().length ? 'Nothing matches your filters' : `Add some ${KIND_META[kind].plural.toLowerCase()} first`); return; }
      if (kind !== 'video' && kind !== 'board') {
        // books, music, movies: a quick spin along the shelf, then open the pick
        const i = Math.floor(Math.random() * items.length);
        app.sfx('whoosh');
        if (view !== 'ring') setView('ring');
        setTimeout(() => goTo(i), 60);
        setTimeout(() => { if (items[i]) { app.sfx('win'); openItem(items[i].id); } }, 900);
        return;
      }
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
            const all = C.stats();
            const s = all[sk];
            const m = KIND_META[sk];
            box.style.setProperty('--k', m.color);
            const max = Math.max(1, ...s.platforms.map((p) => p[1]));
            const third = sk === 'board' ? [String(s.plays), 'plays'] : sk === 'video' ? [String(s.beaten), 'beaten'] : sk === 'book' ? [String(s.read), s.pages ? `read · ${s.pages.toLocaleString()} pages` : 'read']
              : sk === 'movie' ? [s.minutes ? `${Math.round(s.minutes / 60)} h` : '—', 'of film'] : [String(s.platforms.length), s.platforms.length === 1 ? 'genre' : 'genres'];
            box.append(...[
              h('div.cl-stabs', KINDS.map((k) => h(`button.chip${k === sk ? '.on' : ''}`, { type: 'button', '--kc': KIND_META[k].color, onclick: () => { sk = k; draw(); } }, h('i', { html: kglyph(k) }), h('span', KIND_META[k].short), h('b', String(all[k].count))))),
              h('div.cl-big',
                h('div', h('b', String(s.count)), h('span', s.copies !== s.count ? `${m.unit[1]} · ${s.copies} copies` : m.unit[1])),
                h('div', h('b', s.valued ? C.fmtMoney(s.value) : '—'), h('span', s.valued ? `value (${s.valued} priced)` : 'no prices yet')),
                h('div', h('b', third[0]), h('span', third[1]))),
              h('div.cl-bars', s.platforms.slice(0, 8).map(([name, n]) => h('div.cl-bar-r', h('span.cl-bar-l', { dir: 'auto' }, name), h('span.cl-bar-t', h('i', { style: { width: `${(n / max) * 100}%` } })), h('b', String(n))))),
              h('div.cl-sline', [sk === 'board' ? `${s.unplayed} never played` : sk === 'video' ? `${s.unplayed} unplayed` : '', sk === 'video' && s.hours ? `${s.hours} h played` : '', s.lent ? `${s.lent} lent out` : '', s.paid ? `paid ${C.fmtMoney(s.paid)}` : ''].filter(Boolean).join(' · ')),
              s.top.length ? h('div.cl-sline.top', `Most played: ${s.top.map((x) => x.title).join(', ')}`) : null].filter(Boolean)
            );
          };
          draw(); curve(box);
        },
      });
    }

    // ------------------------------------------------------------ phone (QR)
    function openPhone(tab = 'add', k = kind) {
      openPanel({
        title: 'Add from your phone', className: 'cl-qr-panel',
        build(body, panel) {
          const box = h('div.cl-qr');
          body.append(box);
          box.append(h('div.loading', h('div.spin'), h('div', 'Finding the bridge…')));
          Y.phoneUrl(`?tab=${tab}&kind=${k}`).then((r) => {
            if (panel.closed) return;
            clear(box);
            if (!r.url) {
              box.append(h('div.cl-qr-off', h('div.cl-qr-off-ic', { html: svgPath(ICON.phone) }), h('div.cl-qr-off-t', 'Phones can’t connect yet'),
                h('div.cl-qr-off-m', r.reason === 'noip' ? 'The bridge has no network address phones can reach. Set "collection.publicUrl" in bridge/config.json.'
                  : r.reason === 'old' ? 'This bridge is too old for the Collection page — update bridge/ and restart it.'
                    : 'Start the bridge (bridge/server.js) on this network, then scan the code with your phone.')));
              return;
            }
            box.append(h('div.cl-qr-h', tab === 'file' ? 'Upload your export' : 'Scan a barcode or type it in'),
              h('div.cl-qr-code', { html: qrSvg(r.url, { margin: 3, dark: '#111', light: '#fff' }), dataset: { url: r.url } }),
              h('div.cl-qr-m', tab === 'file' ? 'Scan the code, pick the file — GamEye, CLZ, Grouvee, BGG, BG Stats, Discogs, Goodreads or any CSV — and send it here.'
                : 'Scan the code with your phone, then scan a game, book, record, CD or movie — it lands on the right shelf.'),
              h('div.cl-qr-url', r.url.replace(/^https?:\/\//, '')));
          });
        },
      });
    }

    // ------------------------------------------------------------ connections
    const PRESET_SRC = Object.fromEntries(PRESETS.map((p) => [p.id, 1]));
    function connStatus(c, inf) {
      const st = C.conn(c.id);
      const n = c.id === 'sheet' ? Object.keys(PRESET_SRC).reduce((a, s) => a + C.sourceCount(s), 0) : C.sourceCount(c.id);
      if (Y.syncing(c.id)) return { t: 'Syncing…', cls: 'busy' };
      if (st.error && (!st.lastSync || st.errorAt > st.lastSync)) return { t: st.error, cls: 'err' };
      if (c.searchOnly) {
        if (c.fields && inf === null) return { t: 'Needs the bridge', cls: '' };
        if (inf && Y.configured(c.id, inf)) return { t: n ? `Ready · ${n} added with it` : `Ready — used by + Add${c.fields ? '' : ' (no account)'}`, cls: 'ok' };
        return { t: c.fields ? 'Not set up' : 'No account needed', cls: c.fields ? '' : 'ready' };
      }
      if (st.lastSync) return { t: `${n} item${n === 1 ? '' : 's'} · ${c.id === 'sheet' ? 'last import' : 'synced'} ${ago(st.lastSync)}`, cls: 'ok' };
      if (inf && Y.configured(c.id, inf)) return { t: 'Ready — tap to sync', cls: 'ready' };
      return { t: inf === null ? 'Needs the bridge' : 'Not set up', cls: '' };
    }
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
                h('div.row-text', h('div.row-title', c.name, c.kind ? h('i.cl-ckind', { '--kc': KIND_META[c.kind].color, html: kglyph(c.kind), title: KIND_META[c.kind].plural }) : null, c.untested ? h('span.cl-untested', 'untested live') : null), h('div.row-sub', s.t)), h('i.cl-chev', { html: icon('chevron') })));
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
            if (st.lastResult && id !== 'sheet' && !c.searchOnly) {
              const r = st.lastResult;
              box.append(h('div.cl-conn-r', [`${r.total} from ${c.name}`, r.added ? `${r.added} new` : '', r.updated ? `${r.updated} updated` : '', r.removed ? `${r.removed} removed` : '', r.unlinked ? `${r.unlinked} kept (you edited them)` : '', r.note].filter(Boolean).join(' · ')));
            }
            if (id === 'sheet' && st.lastResult) {
              const r = st.lastResult;
              box.append(h('div.cl-conn-r', `${r.presetName}${r.name ? ` · ${r.name}` : ''}: ${r.total} rows (${r.added} new, ${r.updated} updated)${r.wishes ? ` · ${r.wishes} to Wish Lists` : ''}`));
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
              if (inf?.watch) box.append(h('div.cl-conn-r', `Watching ${String(inf.watch.file).split(/[\\/]/).pop()}${inf.watch.error ? ` — ${inf.watch.error}` : inf.watch.at ? ` · imported ${ago(inf.watch.at)} (${inf.watch.count} items)` : ''}`));
            } else if (c.searchOnly) {
              acts.append(h('button.pill.small.primary.cl-sync', { type: 'button', disabled: busy, onclick: () => tryIt() }, h('i', { html: icon('search') }), busy ? 'Searching…' : 'Try a search'));
            } else {
              acts.append(h('button.pill.small.primary.cl-sync', { type: 'button', disabled: busy, onclick: () => run() }, h('i', { html: svgPath(ICON.sync) }), busy ? 'Syncing…' : 'Sync now'));
            }
            const n = id === 'sheet' ? Object.keys(PRESET_SRC).reduce((a, s) => a + C.sourceCount(s), 0) : C.sourceCount(id);
            if (!c.searchOnly && (n || st.lastSync || (c.fields && inf?.conns?.[id] && (inf.conns[id].hasToken || inf.conns[id].hasKey)))) acts.append(h('button.pill.small.danger', { type: 'button', onclick: () => disconnect() }, 'Disconnect'));
            if (c.searchOnly && c.fields && inf?.conns?.[id]?.hasKey) acts.append(h('button.pill.small.danger', { type: 'button', onclick: async () => { try { await Y.saveConfig({ [id]: Object.fromEntries(c.fields.map(([f]) => [f, ''])) }); inf = await Y.info({ force: true }); app.toast('Key removed from the bridge'); draw(); } catch (e) { app.toast(errText(e), { kind: 'error' }); } } }, 'Remove key'));
            box.append(...[acts,
              h('div.cl-sec', 'How to connect'),
              h('ol.cl-steps', c.steps.map((t) => h('li', t))),
              id === 'sheet' ? h('div.cl-presets', PRESETS.filter((p) => p.id !== 'generic').map((p) => h('div.cl-preset', h('b', p.name), h('span', p.hint)))) : null].filter(Boolean));
            curve(box);
          };
          async function tryIt() {
            if (busy) return;
            busy = true; draw();
            const k = c.kind;
            const q = { book: 'Dune', vinyl: 'Kind of Blue', movie: 'Spirited Away' }[k] || 'Dune';
            try { const r = await Y.search(k, q); app.sfx('score'); app.toast(`${c.name}: ${r.length} results for “${q}”${r[0] ? ` — ${r[0].title}${r[0].by ? ` · ${r[0].by}` : ''}` : ''}`, { ms: 3600 }); C.setConn(id, { error: '' }); }
            catch (e) { app.sfx('over'); app.toast(errText(e), { kind: 'error', ms: 4200 }); }
            busy = false;
            if (!panel.closed) draw();
          }
          async function run() {
            if (busy) return;
            busy = true; draw();
            try {
              const r = await Y.sync(id, { force: true });
              app.sfx('score');
              app.toast(`${c.name}: ${r.total} · ${r.added} new${r.updated ? `, ${r.updated} updated` : ''}${r.removed ? `, ${r.removed} removed` : ''}`, { ms: 3200 });
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
                  app.toast(removeItems ? `Disconnected · removed ${removed} item${removed === 1 ? '' : 's'}` : 'Disconnected · its items stay in your collection');
                  p2.close(); panel.close(); render(); after?.();
                };
                b2.append(h('div.cl-conf', h('div.cl-conf-t', n ? `${n} item${n === 1 ? '' : 's'} came from ${c.name}. Keep them?` : `Stop using ${c.name}?`),
                  n ? h('div.cl-conf-m', 'Things you edited (notes, plays, loans…) or that another source also has are always kept.') : null,
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
        app.sfx('coin'); app.toast(res.duplicate ? `“${res.title}” is already in your collection` : `📱 Added “${res.title}” to ${KIND_META[res.kind].plural}`, { ms: 3000 });
      } else if (e.type === 'import' && res) {
        app.sfx('score');
        app.toast(`${res.presetName}: ${res.total} rows — ${res.added} new, ${res.updated} updated${res.wishes ? ` · ${res.wishes} to Wish Lists` : ''}`, { ms: 4200 });
      }
      render();
    }));
    // connections that haven't synced for a while: once, quietly, when the app opens
    setTimeout(() => {
      for (const c of Y.CONNECTIONS) {
        const st = C.conn(c.id);
        if (c.id !== 'sheet' && !c.searchOnly && st.on && st.lastSync && Date.now() - st.lastSync > 12 * 3600e3 && !Y.syncing(c.id)) Y.sync(c.id).then(() => render()).catch(() => {});
      }
    }, 2500);

    // ------------------------------------------------------------ knob / keys
    app.onKey((e) => {
      if (topPanel()) return;
      const k = e.key;
      const step = (d) => setKind(KINDS[(KINDS.indexOf(kind) + d + KINDS.length) % KINDS.length]);
      if (k === 'ArrowRight' || (k === 'ArrowDown' && view !== 'ring')) { e.preventDefault(); goTo(sel + 1); }
      else if (k === 'ArrowLeft' || (k === 'ArrowUp' && view !== 'ring')) { e.preventDefault(); goTo(sel - 1); }
      else if (k === 'ArrowDown' || k === 'PageDown' || k === 'Tab') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
      else if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); step(-1); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); if (items[sel]) openItem(items[sel].id); else openAdd(); }
      else if (k === '+' || k === 'a') { e.preventDefault(); openAdd(); }
      else if (k === '/' || k === 's') { e.preventDefault(); openSearch(); }
      else if (k === 'f') openFilters();
      else if (k === 'p') pickToPlay();
      else if (k === 'v' || k === 'g') setView(k === 'g' ? (view === 'groups' ? 'ring' : 'groups') : nextView());
      else if (k === 'm') openMenu();
      else if (/^[1-6]$/.test(k)) setKind(KINDS[+k - 1]);
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
