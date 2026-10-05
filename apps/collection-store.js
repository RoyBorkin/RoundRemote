// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Collection — the shared data module: your physical (and digital) video games and board games, kept in the app's
// settings (appData.collection, like apps/wishlist-store.js), so other screens and apps can read it without the
// Collection app being open — Decide spins "What to play" / "What video game" from it, Wish Lists adds a game here
// when you got it.
//
//   items(kind?) → [item] (A–Z) · getItem(id) · findItem({ kind, title, platform }) → item | null
//   addItem({ kind: 'video'|'board', title, platform?, … , source? }) → item (an existing one when kind + title + platform
//     match; it then has `duplicate: true`)
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

export const { KINDS, normTitle, canonPlatform, platformName, platformShort, SOURCES, sourceName, OWNERSHIP } = S;
export const KIND_META = {
  video: { name: 'Video game', plural: 'Video games', short: 'Video', color: '#38bdf8' },
  board: { name: 'Board game', plural: 'Board games', short: 'Board', color: '#f59e0b' },
};

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
export function findItem({ kind, title, platform } = {}) {
  const t = normTitle(title);
  if (!t) return null;
  const p = kind === 'board' ? '' : canonPlatform(platform);
  const l = list().filter((x) => (!kind || x.kind === kind) && normTitle(x.title) === t);
  return l.find((x) => !p || !x.platform || x.platform === p) || null;
}
export const hasItem = (e) => !!findItem(e);

const newId = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export function addItem(e = {}) {
  const kind = KINDS.includes(e.kind) ? e.kind : 'video';
  const title = String(e.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!title) return null;
  const src = SRC_KEY(e.source || 'manual');
  const old = findItem({ kind, title, platform: e.platform });
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
  if (patch.platform !== undefined) it.platform = old.kind === 'board' ? '' : canonPlatform(patch.platform);
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
    for (const x of l) { const k = kind === 'board' ? (x.expansion ? 'Expansions' : 'Base games') : (x.digital ? 'Digital' : platformName(x.platform) || 'Unknown platform'); plats.set(k, (plats.get(k) || 0) + (x.qty || 1)); }
    const valued = l.filter((x) => x.value);
    return {
      count: l.length, copies: l.reduce((n, x) => n + (x.qty || 1), 0),
      platforms: [...plats.entries()].sort((a, b) => b[1] - a[1]),
      value: valued.reduce((n, x) => n + x.value * (x.qty || 1), 0), valued: valued.length,
      paid: l.reduce((n, x) => n + (x.paid || 0), 0),
      plays: l.reduce((n, x) => n + (x.plays || 0), 0), hours: Math.round(l.reduce((n, x) => n + (x.hours || 0), 0)),
      beaten: l.filter((x) => x.beaten).length, unplayed: l.filter((x) => !x.plays && !x.hours && !x.beaten).length,
      lent: l.filter((x) => x.lent?.name).length,
      top: l.filter((x) => x.plays || x.hours).sort((a, b) => (b.plays || 0) - (a.plays || 0) || (b.hours || 0) - (a.hours || 0)).slice(0, 3),
    };
  };
  return { video: per('video'), board: per('board') };
}
export const fmtMoney = (cents, cur = 'USD') => (cents == null ? '' : new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: cents >= 100000 ? 0 : 2 }).format(cents / 100));

// ---------------------------------------------------------------- "Got it → Add to Collection" (Wish Lists)
/** A small round panel asking video game or board game (+ platform), then adds it. Resolves the item or null. */
export function openAddToCollection(app, e) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const { h } = app;
    app.openPanel({
      title: 'Add to Collection', className: 'cl-add-to',
      onClose: () => finish(null),
      build(body, panel) {
        injectAddStyle();
        const add = (kind, platform) => {
          const it = addItem({ kind, title: e.title, year: e.year, art: e.art, platform, source: 'wishlist', notes: e.note || '' });
          if (it) { app.sfx?.('coin'); app.toast?.(it.duplicate ? 'Already in your collection' : `Added “${it.title}” to your ${KIND_META[kind].plural.toLowerCase()}`); }
          finish(it); panel.close();
        };
        const plats = h('div.cl-at-plats');
        const draw = (kind) => {
          plats.replaceChildren();
          body.querySelectorAll('.cl-at-k').forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
          if (kind === 'board') { add('board'); return; }
          plats.append(h('div.cl-at-q', 'Which platform?'),
            h('div.cl-at-chips', S.PLATFORM_CHOICES.slice(0, 12).map((p) => h('button.chip', { type: 'button', onclick: () => add('video', p) }, platformShort(p)))),
            h('button.pill.small', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Platform', placeholder: 'e.g. Sega Saturn', okLabel: 'Add' }); if (v !== null) add('video', v); } }, 'Other…'));
        };
        body.append(h('div.cl-at',
          h('div.cl-at-t', { dir: 'auto' }, e.title),
          h('div.cl-at-kinds',
            h('button.cl-at-k', { type: 'button', '--k': KIND_META.video.color, dataset: { k: 'video' }, onclick: () => draw('video') }, h('i', { html: app.icon('gamepad') }), 'Video game'),
            h('button.cl-at-k', { type: 'button', '--k': KIND_META.board.color, dataset: { k: 'board' }, onclick: () => draw('board') }, h('i', { html: `<svg class="ic" viewBox="0 0 24 24"><path d="${MEEPLE}"/></svg>` }), 'Board game')),
          plats));
      },
    });
  });
}
export const MEEPLE = 'M12 2.5a3.2 3.2 0 0 1 3.2 3.2c0 .9-.4 1.8-1 2.4 2.9.6 6.3 1.8 6.3 3.4 0 1.1-1.8 1.4-3.3 1.4l2.6 5.3c.4.8-.2 1.8-1.1 1.8h-3.6L12 15.6 8.9 20h-3.6c-.9 0-1.5-1-1.1-1.8l2.6-5.3c-1.5 0-3.3-.3-3.3-1.4 0-1.6 3.4-2.8 6.3-3.4a3.2 3.2 0 0 1 2.2-5.6z';
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
