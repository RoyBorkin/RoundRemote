// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Collection — the shared data module: your physical (and digital) video games, board games, books, vinyl, CDs and
// DVD / Blu-ray discs, kept in the app's
// settings (appData.collection, like apps/wishlist-store.js), so other screens and apps can read it without the
// Collection app being open — Decide spins "What to play" / "What video game" from it, Wish Lists adds a game here
// when you got it.
//
//   items(kind?) → [item] (A–Z) · getItem(id) · findItem({ kind, title, platform }) → item | null
//   addItem({ kind: one of KINDS, title, platform?, by?, … , source? }) → item (an existing one when kind + title + platform
//     (video) / author or artist (books, music) match; it then has `duplicate: true`)
//   groupOf(item) → { key, name, rank } — the shelf's grouping: platform (video), type (board), genre (the rest)
//   addClassic(id) — one of the no-equipment classics (collection-sources.js → NO_EQUIP)
//   updateItem(id, patch, { user = true }) → item   (user edits are marked so a sync never overwrites them)
//   removeItem(id) · onItems(fn(list)) → off   (fires after every change, also for changes made by other screens)
//   applySource(src, entries, { mirror }) → { added, updated, removed, unlinked }   (see apps/collection-sources.js)
//   disconnect(src, { removeItems }) · conn(src) / setConn(src, patch) — per-connection state (never secrets)
//   addPlay(id) · lend(id, name) / unlend(id) · stats()
//
// Images are kept as URLs only (never data:), and empty fields are left out, to keep localStorage small.
import { store } from '../js/core/store.js';
import { Emitter } from '../js/core/util.js';
import * as S from './collection-sources.js';

export const { KINDS, MEDIA, normTitle, canonPlatform, platformName, platformShort, platformFamily, familyName, FAMILIES, SOURCES, sourceName, OWNERSHIP, GENRES, BOARD_TYPES,
  BOARD_TRAITS, boardTypeName, FORMATS, formatName, GRADES, NO_EQUIP, isMusic } = S;
export const MEEPLE = 'M12 2.5a3.2 3.2 0 0 1 3.2 3.2c0 .9-.4 1.8-1 2.4 2.9.6 6.3 1.8 6.3 3.4 0 1.1-1.8 1.4-3.3 1.4l2.6 5.3c.4.8-.2 1.8-1.1 1.8h-3.6L12 15.6 8.9 20h-3.6c-.9 0-1.5-1-1.1-1.8l2.6-5.3c-1.5 0-3.3-.3-3.3-1.4 0-1.6 3.4-2.8 6.3-3.4a3.2 3.2 0 0 1 2.2-5.6z';
const circ = (r, x = 12, y = 12) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
/** shelf glyphs (24×24, even-odd) — video uses the app's gamepad icon */
export const GLYPHS = {
  board: MEEPLE,
  book: 'M6 2h12a1 1 0 0 1 1 1v15H7.5a1.5 1.5 0 0 0 0 3H19v1H7.5A3.5 3.5 0 0 1 4 18.5V4a2 2 0 0 1 2-2zm3 4v2h7V6z',
  vinyl: circ(10) + circ(7.4) + circ(6.6) + circ(3.3) + circ(1),
  cd: circ(10) + circ(2.8) + 'M12 4.6A7.4 7.4 0 0 0 4.6 12h1.8A5.6 5.6 0 0 1 12 6.4z',
  movie: 'M4 10h17v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM3.3 6.4l14.6-3.9a1 1 0 0 1 1.2.7l.6 2.3-16 4.3-.6-2.3a1 1 0 0 1 .2-1.1zM7 5.4l2.2 2.9 2-.5L9 4.9zm5.3-1.4l2.2 2.9 2-.5-2.2-2.9z',
};
export const KIND_META = {
  video: { name: 'Video game', plural: 'Video games', short: 'Video', color: '#38bdf8', group: 'platform', unit: ['game', 'games'], by: 'Developer' },
  board: { name: 'Board game', plural: 'Board games', short: 'Board', color: '#f59e0b', group: 'type', unit: ['game', 'games'], by: 'Designer' },
  book: { name: 'Book', plural: 'Books', short: 'Books', color: '#a78bfa', group: 'genre', unit: ['book', 'books'], by: 'Author' },
  vinyl: { name: 'Record', plural: 'Vinyl', short: 'Vinyl', color: '#f43f5e', group: 'genre', unit: ['record', 'records'], by: 'Artist' },
  cd: { name: 'CD', plural: 'CDs', short: 'CDs', color: '#2dd4bf', group: 'genre', unit: ['CD', 'CDs'], by: 'Artist' },
  movie: { name: 'Movie disc', plural: 'DVD & Blu-ray', short: 'Movies', color: '#a3e635', group: 'genre', unit: ['disc', 'discs'], by: 'Director' },
};
export const unitOf = (kind, n) => `${n} ${KIND_META[kind]?.unit[n === 1 ? 0 : 1] || (n === 1 ? 'item' : 'items')}`;

const APP = 'collection';
const events = new Emitter();
const D = () => (store.get('appData') || {})[APP] || {};
function W(patch) {
  const all = store.get('appData') || {};
  store.set('appData', { ...all, [APP]: { ...(all[APP] || {}), ...patch } });
}
const raw = () => D().items || {};
let cache = null, lastRaw = null;
const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
function list() {
  const r = raw();
  if (cache && r === lastRaw) return cache;
  lastRaw = r;
  cache = Object.values(r).filter((x) => x && x.title && KINDS.includes(x.kind)).sort(byTitle);
  return cache;
}
/** drop empty fields and data: images before saving */
function compact(it) {
  const o = {};
  for (const [k, v] of Object.entries(it)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (k === 'art' && /^data:/i.test(v)) continue;
    if (v === false && !['beaten'].includes(k)) continue;
    if (k === 'own' && !Object.keys(v).length) continue;
    o[k] = v;
  }
  return o;
}
function put(items) {
  const out = {};
  for (const [id, it] of Object.entries(items)) out[id] = compact(it);
  W({ items: out });
  if (raw() !== lastRaw) { cache = null; emit(); }
}
let emitting = false;
function emit() { if (emitting) return; emitting = true; try { events.emit('change', list()); } finally { emitting = false; } }
store.on('change', (k) => { if ((k === 'appData' || k === '*') && raw() !== lastRaw) { cache = null; emit(); } });

export function items(kind) { const l = list(); return kind ? l.filter((x) => x.kind === kind) : l.slice(); }
export const getItem = (id) => raw()[id] || null;
export const count = (kind) => items(kind).length;
export function findItem({ kind, title, platform, by } = {}) {
  const t = normTitle(title);
  if (!t) return null;
  const l = list().filter((x) => (!kind || x.kind === kind) && normTitle(x.title) === t);
  return l.find((x) => { const a = S.secondKey(x.kind, { platform, by }), b = S.secondKey(x.kind, x); return !a || !b || a === b; }) || null;
}
export const hasItem = (e) => !!findItem(e);

const newId = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export function addItem(e = {}) {
  const kind = KINDS.includes(e.kind) ? e.kind : 'video';
  const title = String(e.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!title) return null;
  const src = SRC_KEY(e.source || 'manual');
  const old = findItem({ kind, title, platform: e.platform, by: e.by });
  if (old) {
    if (kind === 'video' && e.platform && !old.platform) updateItem(old.id, { platform: e.platform }, { user: src === 'manual' });
    return { ...getItem(old.id), duplicate: true };
  }
  const { source, sid, ...rest } = e;
  const it = S.entry({ ...rest, kind, title });
  const now = Date.now();
  // what you typed yourself counts as your edit; what a search / wish gave us is that source's
  const who = src === 'manual' ? 'user' : src;
  const own = Object.fromEntries(Object.keys(it).filter((k) => S.FIELDS.includes(k)).map((k) => [k, who]));
  const id = newId();
  put({ ...raw(), [id]: { ...it, id, sources: { [src]: sid ?? true }, own, added: now, updated: now } });
  return getItem(id);
}
/** Change an item. `user` (default) marks the fields as yours: syncs won't overwrite them. */
export function updateItem(id, patch = {}, { user = true } = {}) {
  const r = raw(), old = r[id];
  if (!old) return null;
  const it = { ...old, ...patch, id, updated: Date.now() };
  if (patch.title !== undefined) it.title = String(patch.title).replace(/\s+/g, ' ').trim().slice(0, 200) || old.title;
  if (patch.platform !== undefined) it.platform = old.kind === 'video' ? canonPlatform(patch.platform) : '';
  if (patch.genres !== undefined) it.genres = [...new Set([].concat(patch.genres || []).map((g) => String(g).trim().slice(0, 24)).filter(Boolean))].slice(0, 4);
  if (patch.notes !== undefined) it.notes = String(patch.notes).trim().slice(0, 600);
  if (user) {
    const own = { ...(old.own || {}) };
    for (const k of Object.keys(patch)) if (S.FIELDS.includes(k)) own[k] = 'user';
    it.own = own;
  }
  put({ ...r, [id]: it });
  return getItem(id);
}
export function removeItem(id) {
  const r = { ...raw() };
  if (!r[id]) return false;
  delete r[id];
  put(r);
  return true;
}
export function onItems(fn) { return events.on('change', fn); }

// ---------------------------------------------------------------- the things you do with a copy
export function addPlay(id, n = 1) {
  const it = getItem(id);
  if (!it) return null;
  return updateItem(id, { plays: Math.max(0, (it.plays || 0) + n), lastPlayed: n > 0 ? Date.now() : it.lastPlayed });
}
/** One of the no-equipment classics (Petakiot, Charades, 20 Questions…) as a board game you "own". */
export function addClassic(id) {
  const c = NO_EQUIP.find((x) => x.id === id);
  if (!c) return null;
  return addItem({ kind: 'board', title: c.title, players: c.players, mins: c.mins, type: 'noequip', traits: c.traits || [], notes: c.blurb, game: c.game || '', source: 'classics', sid: c.id });
}
const GROUP_NONE = { genre: 'No genre yet', platform: 'No platform', type: 'Board game' };
/** The group an item sits in on its shelf: { key, name, rank: [sort numbers…] } */
export function groupOf(x) {
  const how = KIND_META[x.kind]?.group;
  if (how === 'platform') {
    const p = x.platform || '';
    if (!p) return { key: x.digital ? '~digital' : '~none', name: x.digital ? 'Digital' : GROUP_NONE.platform, rank: [99, 0], fam: 'other' };
    const [f, i] = S.platformRank(p);
    return { key: p, name: platformName(p), rank: [f, i], fam: platformFamily(p) };
  }
  if (how === 'type') { const t = x.type || 'board'; return { key: t, name: boardTypeName(t), rank: [BOARD_TYPES.findIndex((b) => b[0] === t)] }; }
  const g = (x.genres || [])[0];
  if (!g) return { key: '~none', name: GROUP_NONE.genre, rank: [999] };
  const i = (GENRES[x.kind] || []).indexOf(g);
  return { key: g, name: g, rank: [i < 0 ? 500 : i] };
}
export const lend = (id, name) => updateItem(id, { lent: { name: String(name).trim().slice(0, 60), at: Date.now() } });
export const unlend = (id) => updateItem(id, { lent: null });

/** Expansions you own for a base game (by BGG id, else "Base: …" title prefix). */
export function expansionsOf(base) {
  if (!base || base.kind !== 'board') return [];
  const t = normTitle(base.title);
  return items('board').filter((x) => x.expansion && x.id !== base.id && ((base.bggId && (x.baseIds || []).includes(String(base.bggId))) || (!(x.baseIds || []).length && t.length > 2 && normTitle(x.title).startsWith(t + ' '))));
}
/** Is this an expansion whose base game you own (so it shows inside the base game, not on the shelf)? */
export function underBase(x, all = items('board')) {
  if (!x.expansion) return false;
  const ids = x.baseIds || [];
  const t = normTitle(x.title);
  return all.some((b) => !b.expansion && b.id !== x.id && ((b.bggId && ids.includes(String(b.bggId))) || (!ids.length && normTitle(b.title).length > 2 && t.startsWith(normTitle(b.title) + ' '))));
}

// ---------------------------------------------------------------- syncs and imports
const SRC_KEY = (src) => String(src).replace(/[^\w:.-]/g, '').slice(0, 30) || 'manual';
/** Merge a source's entries (see apps/collection-sources.js → mergeEntries for the rules). */
export function applySource(src, entries, { mirror = false } = {}) {
  const r = S.mergeEntries(raw(), entries, SRC_KEY(src), { mirror, newId });
  put(r.items);
  return r;
}
export function disconnect(src, { removeItems = false } = {}) {
  const r = S.dropSource(raw(), SRC_KEY(src), { removeItems });
  put(r.items);
  const conns = { ...(D().conns || {}) }; delete conns[src];
  W({ conns });
  return r;
}
export const sourceCount = (src) => list().filter((x) => x.sources && src in x.sources).length;

// per-connection state: { on, user, lastSync, lastResult, error, … } — never tokens or keys (those stay on the bridge)
export const conns = () => D().conns || {};
export const conn = (src) => conns()[src] || {};
export function setConn(src, patch) { const c = conns(); W({ conns: { ...c, [src]: { ...(c[src] || {}), ...patch } } }); }
export const pref = (k, init) => { const v = (D().prefs || {})[k]; return v === undefined ? init : v; };
export function setPref(k, v) { W({ prefs: { ...(D().prefs || {}), [k]: v } }); }

// ---------------------------------------------------------------- stats
export function stats() {
  const all = list();
  const per = (kind) => {
    const l = all.filter((x) => x.kind === kind);
    const plats = new Map();
    for (const x of l) { const k = kind === 'board' ? (x.expansion ? 'Expansions' : boardTypeName(x.type)) : kind === 'video' ? (x.digital ? 'Digital' : platformName(x.platform) || 'Unknown platform') : groupOf(x).name; plats.set(k, (plats.get(k) || 0) + (x.qty || 1)); }
    const valued = l.filter((x) => x.value);
    return {
      count: l.length, copies: l.reduce((n, x) => n + (x.qty || 1), 0),
      platforms: [...plats.entries()].sort((a, b) => b[1] - a[1]),
      value: valued.reduce((n, x) => n + x.value * (x.qty || 1), 0), valued: valued.length,
      paid: l.reduce((n, x) => n + (x.paid || 0), 0),
      plays: l.reduce((n, x) => n + (x.plays || 0), 0), hours: Math.round(l.reduce((n, x) => n + (x.hours || 0), 0)),
      beaten: l.filter((x) => x.beaten).length, unplayed: l.filter((x) => !x.plays && !x.hours && !x.beaten).length,
      read: l.filter((x) => x.read === 'read').length, pages: l.reduce((n, x) => n + (x.pages || 0), 0), minutes: l.reduce((n, x) => n + (x.runtime || 0), 0),
      lent: l.filter((x) => x.lent?.name).length,
      top: l.filter((x) => x.plays || x.hours).sort((a, b) => (b.plays || 0) - (a.plays || 0) || (b.hours || 0) - (a.hours || 0)).slice(0, 3),
    };
  };
  return Object.fromEntries(KINDS.map((k) => [k, per(k)]));
}
export const fmtMoney = (cents, cur = 'USD') => (cents == null ? '' : new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: cents >= 100000 ? 0 : 2 }).format(cents / 100));

// ---------------------------------------------------------------- "Got it → Add to Collection" (Wish Lists)
const gl = (k, icon) => (k === 'video' ? icon('gamepad') : `<svg class="ic" viewBox="0 0 24 24"><path fill-rule="evenodd" d="${GLYPHS[k]}"/></svg>`);
/** A small round panel: a game asks video game or board game (+ platform), a movie asks DVD / Blu-ray / 4K, a book is added
 *  straight away. Resolves the item or null. */
export function openAddToCollection(app, e) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const { h } = app;
    const wishKind = e.kind === 'book' ? 'book' : e.kind === 'movie' || e.kind === 'show' ? 'movie' : 'game';
    if (wishKind === 'book') {
      // a book you got goes straight onto the Books shelf
      const it = addItem({ kind: 'book', title: e.title, year: e.year, art: e.art, by: e.by || '', source: 'wishlist', notes: e.note || '' });
      if (it) { app.sfx?.('coin'); app.toast?.(it.duplicate ? 'Already in your collection' : `Added “${it.title}” to Books`); }
      finish(it);
      return;
    }
    app.openPanel({
      title: 'Add to Collection', className: 'cl-add-to',
      onClose: () => finish(null),
      build(body, panel) {
        injectAddStyle();
        const add = (kind, extra = {}) => {
          const it = addItem({ kind, title: e.title, year: e.year, art: e.art, by: kind === 'video' || kind === 'board' ? '' : e.by || '', source: 'wishlist', notes: e.note || '', ...extra });
          if (it) { app.sfx?.('coin'); app.toast?.(it.duplicate ? 'Already in your collection' : `Added “${it.title}” to ${KIND_META[kind].plural}`); }
          finish(it); panel.close();
        };
        const plats = h('div.cl-at-plats');
        const draw = (kind) => {
          plats.replaceChildren();
          body.querySelectorAll('.cl-at-k').forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
          if (kind === 'board') { add('board'); return; }
          plats.append(h('div.cl-at-q', 'Which platform?'),
            h('div.cl-at-chips', S.PLATFORM_CHOICES.slice(0, 12).map((p) => h('button.chip', { type: 'button', onclick: () => add('video', { platform: p }) }, platformShort(p)))),
            h('button.pill.small', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Platform', placeholder: 'e.g. Sega Saturn', okLabel: 'Add' }); if (v !== null) add('video', { platform: v }); } }, 'Other…'));
        };
        const kbtn = (k, label, fn) => h('button.cl-at-k', { type: 'button', '--k': KIND_META[k].color, dataset: { k }, onclick: fn }, h('i', { html: gl(k, app.icon) }), label);
        if (wishKind === 'movie') {
          body.append(h('div.cl-at', h('div.cl-at-t', { dir: 'auto' }, e.title), h('div.cl-at-q', 'Did you buy a disc? Which one?'),
            h('div.cl-at-chips', FORMATS.movie.slice(0, 4).map(([f, l]) => h('button.chip', { type: 'button', dataset: { f }, onclick: () => add('movie', { format: f }) }, l))),
            h('button.pill.small.cl-at-skip', { type: 'button', onclick: () => { app.sfx?.('tap'); app.toast?.('Digital or streamed — nothing to put on the shelf'); finish(null); panel.close(); } }, 'No — digital / streamed')));
          return;
        }
        body.append(h('div.cl-at',
          h('div.cl-at-t', { dir: 'auto' }, e.title),
          h('div.cl-at-kinds', kbtn('video', 'Video game', () => draw('video')), kbtn('board', 'Board game', () => draw('board'))),
          plats));
      },
    });
  });
}
function injectAddStyle() {
  if (document.querySelector('style[data-cl-addto]')) return;
  const s = document.createElement('style');
  s.dataset.clAddto = '';
  s.textContent = `
.cl-add-to .panel-body { justify-content: center; }
.cl-at { display: flex; flex-direction: column; align-items: center; gap: 2.4cqmin; text-align: center; }
.cl-at-t { font-family: var(--display); font-size: 4cqmin; font-weight: 700; max-width: 60cqmin; unicode-bidi: plaintext; }
.cl-at-kinds { display: flex; gap: 2.4cqmin; }
.cl-at-k { display: flex; flex-direction: column; align-items: center; gap: 1cqmin; width: 20cqmin; padding: 2.4cqmin 1cqmin; border-radius: 3cqmin; font-weight: 700; font-size: 2.5cqmin;
  background: color-mix(in srgb, var(--k) 14%, transparent); border: 1px solid color-mix(in srgb, var(--k) 45%, transparent); }
.cl-at-k i { font-size: 6cqmin; color: var(--k); display: grid; }
.cl-at-k:active { transform: scale(.95); }
.cl-at-k.on { background: var(--k); color: #0c1620; border-color: transparent; }
.cl-at-k.on i { color: #0c1620; }
.cl-at-plats { display: flex; flex-direction: column; align-items: center; gap: 1.2cqmin; }
.cl-at-q { font-size: 2.4cqmin; color: var(--muted); font-weight: 700; }
.cl-at-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 1cqmin; max-width: 62cqmin; }
.cl-at-chips .chip { font-size: 2.3cqmin; padding: 1.2cqmin 2.4cqmin; }`;
  document.head.append(s);
}
