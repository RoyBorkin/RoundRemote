// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Wish lists — the shared data module. Games, movies, shows and books you want, kept in the app's settings
// (appData.wishlist, the same place apps/shell.js keeps per-app data), so any screen or app can read and add
// to them without the Wish Lists app being open: the Movies & TV library and the PlayStation / Steam screens
// save from there with heartButton() / wishPill(), and other apps (e.g. Decide) call wishes() / addWish().
//
//   addWish({ kind: 'game'|'movie'|'show'|'book', title, year?, art?, artAlt?, by?, source?, ref?, note?, priority?, inLibrary? })
//     → the item (an existing one when kind + title + year match; it then has `duplicate: true`)
//   removeWish(id) · updateWish(id, patch) → item · wishes(kind?) → [item] (newest first) · getWish(id)
//   findWish({ kind, title, year }) → item | null · toggleWish(entry) → { item, added }
//   onWishes(fn(list)) → off   (fires after every change, also for changes made by other screens)
//
// An item: { id, kind, title, year, art, artAlt, by, source, ref, note, priority 0–3, status 'wanted'|'done',
//            inLibrary, added, updated, doneAt }
import { store } from '../js/core/store.js';
import { Emitter } from '../js/core/util.js';

export const KINDS = ['game', 'movie', 'show', 'book'];
export const KIND_META = {
  game: { name: 'Game', plural: 'Games', done: 'Got it', doneShort: 'Got', color: '#22c55e', by: 'Studio' },
  movie: { name: 'Movie', plural: 'Movies', done: 'Watched', doneShort: 'Watched', color: '#f59e0b', by: 'Director' },
  show: { name: 'Show', plural: 'Shows', done: 'Watched', doneShort: 'Watched', color: '#38bdf8', by: 'Network' },
  book: { name: 'Book', plural: 'Books', done: 'Read', doneShort: 'Read', color: '#a78bfa', by: 'Author' },
};
export const SOURCES = {
  plex: { name: 'Plex', color: '#e5a00d' },
  jellyfin: { name: 'Jellyfin', color: '#00a4dc' },
  steam: { name: 'Steam', color: '#66c0f4' },
  psn: { name: 'PlayStation', color: '#3b8ef0' },
  openlibrary: { name: 'Open Library', color: '#e0b25a' },
  itunes: { name: 'iTunes', color: '#fb5bc5' },
  manual: { name: 'Added by hand', color: '#94a3b8' },
  gameye: { name: 'GamEye', color: '#7c3aed' },     // wish-list rows from Collection imports
  clz: { name: 'CLZ Games', color: '#e11d48' },
  grouvee: { name: 'Grouvee', color: '#0ea5e9' },
  bgg: { name: 'BoardGameGeek', color: '#ff5100' },
};
export const sourceName = (s) => SOURCES[s]?.name || (s ? String(s)[0].toUpperCase() + String(s).slice(1) : '');

const APP = 'wishlist';
const events = new Emitter();
const D = () => (store.get('appData') || {})[APP] || {};
function W(patch) {
  const all = store.get('appData') || {};
  store.set('appData', { ...all, [APP]: { ...(all[APP] || {}), ...patch } });
}
const raw = () => D().items || {};
let cache = null, lastRaw = null;
function list() {
  const r = raw();
  if (cache && r === lastRaw) return cache;
  lastRaw = r;
  cache = Object.values(r).filter((x) => x && x.title && KINDS.includes(x.kind)).sort((a, b) => (b.added || 0) - (a.added || 0));
  return cache;
}
function put(items) { W({ items }); if (raw() !== lastRaw) { cache = null; emit(); } }   // (the store listener below usually emits first)
let emitting = false;
function emit() { if (emitting) return; emitting = true; try { events.emit('change', list()); } finally { emitting = false; } }
// changes written by another copy of this module (another tab) or a settings profile load
store.on('change', (k) => { if ((k === 'appData' || k === '*') && raw() !== lastRaw) { cache = null; emit(); } });

/** Lower-case, accent-free, punctuation-free title for matching ("The Witcher 3: Wild Hunt™" = "the witcher 3 wild hunt"). */
export function normTitle(s = '') {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[™®©]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const yearOf = (y) => { const n = parseInt(String(y ?? '').slice(0, 4), 10); return n > 1000 && n < 3000 ? n : null; };
const clean = (s, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function wishes(kind) { const l = list(); return kind ? l.filter((x) => x.kind === kind) : l.slice(); }
export const getWish = (id) => raw()[id] || null;
export function findWish({ kind, title, year } = {}) {
  const t = normTitle(title), y = yearOf(year);
  if (!t) return null;
  return list().find((x) => x.kind === kind && normTitle(x.title) === t && (!y || !x.year || x.year === y)) || null;
}
export const hasWish = (e) => !!findWish(e);

const newId = () => 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export function addWish(e = {}) {
  const kind = KINDS.includes(e.kind) ? e.kind : null;
  const title = clean(e.title);
  if (!kind || !title) return null;
  const year = yearOf(e.year);
  const old = findWish({ kind, title, year });
  if (old) {
    // fill in what the first save didn't know (art, year, studio/author…)
    const fill = {};
    for (const k of ['art', 'artAlt', 'by', 'ref']) if (!old[k] && e[k]) fill[k] = clean(e[k], 600);
    if (!old.year && year) fill.year = year;
    if (e.inLibrary && !old.inLibrary) fill.inLibrary = true;
    const it = Object.keys(fill).length ? updateWish(old.id, fill) : old;
    return { ...it, duplicate: true };
  }
  const now = Date.now();
  const it = {
    id: newId(), kind, title, year, art: clean(e.art, 600), artAlt: clean(e.artAlt, 600), by: clean(e.by, 120),
    source: clean(e.source || 'manual', 30), ref: e.ref != null ? clean(e.ref, 600) : '', note: clean(e.note, 500),
    priority: Math.max(0, Math.min(3, +e.priority || 0)), status: 'wanted', inLibrary: !!e.inLibrary, added: now, updated: now, doneAt: null,
  };
  put({ ...raw(), [it.id]: it });
  return it;
}
export function updateWish(id, patch = {}) {
  const r = raw(), old = r[id];
  if (!old) return null;
  const it = { ...old, ...patch, id, kind: KINDS.includes(patch.kind) ? patch.kind : old.kind, updated: Date.now() };
  if (patch.title !== undefined) it.title = clean(patch.title) || old.title;
  if (patch.note !== undefined) it.note = clean(patch.note, 500);
  if (patch.year !== undefined) it.year = yearOf(patch.year);
  if (patch.priority !== undefined) it.priority = Math.max(0, Math.min(3, +patch.priority || 0));
  if (patch.status !== undefined) {
    it.status = patch.status === 'done' ? 'done' : 'wanted';
    it.doneAt = it.status === 'done' ? (old.status === 'done' ? old.doneAt : Date.now()) : null;
  }
  put({ ...r, [id]: it });
  return it;
}
export function removeWish(id) {
  const r = { ...raw() };
  if (!r[id]) return false;
  delete r[id];
  put(r);
  return true;
}
/** Add the entry, or remove it when it's already on the list. */
export function toggleWish(e) {
  const old = findWish(e);
  if (old) { removeWish(old.id); return { item: old, added: false }; }
  return { item: addWish(e), added: true };
}
export function onWishes(fn) { return events.on('change', fn); }

// ---------------------------------------------------------------- "save from your libraries" buttons
// Small ♡ buttons other screens drop in (Movies & TV details, the PlayStation / Steam screens). They style
// themselves (one <style> tag), follow the list live and stop listening once they leave the page.
const HEART = 'M12 21l-1.4-1.3C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.6 11.6z';
const HEART_O = 'M16.5 2.6c-1.7 0-3.4.8-4.5 2.1-1.1-1.3-2.8-2.1-4.5-2.1C4.4 2.6 2 5 2 8.1c0 3.8 3.4 6.9 8.6 11.6L12 21l1.4-1.3C18.6 15 22 11.9 22 8.1 22 5 19.6 2.6 16.5 2.6zm-4.4 15.6-.1.1-.1-.1C7.1 13.9 4 11.1 4 8.1 4 6.1 5.5 4.6 7.5 4.6c1.5 0 3 1 3.6 2.4h1.9c.5-1.4 2-2.4 3.5-2.4 2 0 3.5 1.5 3.5 3.5 0 3-3.1 5.8-7.9 10.1z';
export const heartSvg = (on) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${on ? HEART : HEART_O}"/></svg>`;
const PINK = '#ec4899';
function injectStyle() {
  if (document.querySelector('style[data-wish-hooks]')) return;
  const s = document.createElement('style');
  s.dataset.wishHooks = '';
  s.textContent = `
.wish-heart { flex: none; width: 7cqmin; height: 7cqmin; border-radius: 50%; display: grid; place-items: center; font-size: 3.4cqmin;
  background: var(--glass); border: 1px solid var(--line); color: var(--muted); transition: transform .2s cubic-bezier(.34,1.56,.64,1), color .2s, background .2s; }
.wish-heart:active { transform: scale(.86); }
.wish-heart.on { color: ${PINK}; background: color-mix(in srgb, ${PINK} 16%, transparent); border-color: color-mix(in srgb, ${PINK} 45%, transparent); }
.wish-heart.pop { animation: wish-pop .45s cubic-bezier(.34,1.56,.64,1); }
@keyframes wish-pop { 40% { transform: scale(1.3); } }
.pill.wish-pill { display: inline-flex; align-items: center; gap: 1cqmin; }
.pill.wish-pill .ic { width: 1.1em; height: 1.1em; fill: currentColor; }
.pill.wish-pill.on { color: ${PINK}; border-color: color-mix(in srgb, ${PINK} 45%, transparent); background: color-mix(in srgb, ${PINK} 12%, transparent); }
.wish-heart .ic { width: 1em; height: 1em; fill: currentColor; }`;
  document.head.append(s);
}
function live(el, paint) {
  let seen = false;
  const off = onWishes(() => { if (el.isConnected) { seen = true; paint(); } else if (seen) off(); });
  // a button that never makes it into the page shouldn't listen forever
  setTimeout(() => { if (!el.isConnected && !seen) off(); else seen = true; }, 4000);
}
async function toastMsg(msg) { try { (await import('../js/ui/overlay.js')).toast(msg); } catch {} }
function toggleWithToast(e) {
  const { item, added } = toggleWish(e);
  if (item) toastMsg(added ? `♥ Added to your ${KIND_META[item.kind].plural.toLowerCase()} wish list` : 'Removed from your wish list');
  return added;
}

/** Round ♡ button; `entry()` (or an object) gives { kind, title, year, art, by, source, ref }. */
export function heartButton(entry, { className = '', label = 'Wish list' } = {}) {
  injectStyle();
  const get = () => (typeof entry === 'function' ? entry() : entry);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `wish-heart ${className}`.trim();
  const paint = () => { const on = hasWish(get()); b.classList.toggle('on', on); b.innerHTML = heartSvg(on); b.setAttribute('aria-pressed', String(on)); const t = on ? "On your wish list — tap to remove" : "Add to wish list"; b.title = t; b.setAttribute("aria-label", t); };
  b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  b.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    toggleWithToast(get());
    paint(); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  });
  paint(); live(b, paint);
  b.dataset.label = label;
  return b;
}
/** A pill ("♡ Wish list" / "♥ On wish list") for detail pages. */
export function wishPill(entry, { className = '' } = {}) {
  injectStyle();
  const get = () => (typeof entry === 'function' ? entry() : entry);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `pill wish-pill ${className}`.trim();
  const paint = () => { const on = hasWish(get()); b.classList.toggle('on', on); b.innerHTML = `${heartSvg(on)}<span>${on ? 'On wish list' : 'Wish list'}</span>`; b.setAttribute('aria-pressed', String(on)); };
  b.addEventListener('click', (ev) => { ev.stopPropagation(); toggleWithToast(get()); paint(); });
  paint(); live(b, paint);
  return b;
}
