// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Bookmarks: saved books, reading progress, notes, the reading streak, Open Library search and the reading reminders
// (a background scheduler like the clock's alarms: they ring on any screen while Round Remote is open).
// main.js starts the reminders at boot when one is on:  import('../apps/books-store.js').then((m) => m.startReminders())
//
// Saved in settings.appData.books: { books, cur, reminders, days }
//   book: { id, title, author, cover, olKey, year, format: 'paper' | 'ebook' | 'audio', total (pages, or minutes for audio),
//           pos (page, or minutes listened), status: 'reading' | 'want' | 'done', added, started, finished,
//           startPos, notes: [{ id, t, kind: 'note' | 'quote', text, at }], hist: [{ d: 'YYYY-MM-DD', pos }] }
//   reminders: [{ id, h, m, days: [0…6] (empty = every day), label, on, snoozeUntil }]
//   days: { 'YYYY-MM-DD': amount read (pages or minutes) } — the reading streak
import { store } from '../js/core/store.js';
import { Emitter } from '../js/core/util.js';
import { ring } from './clock-ring.js';
import { icon } from '../js/ui/icons.js';

export const COLOR = '#8b5cf6';
export const events = new Emitter();   // 'change'
const DAY = 864e5;
export const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const daysAgo = (n, t = Date.now()) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 12).getTime(); };

export function bkData() { return (store.get('appData') || {}).books || {}; }
function saveBk(patch) { const all = store.get('appData') || {}; store.set('appData', { ...all, books: { ...(all.books || {}), ...patch } }); events.emit('change'); }

export const books = () => bkData().books || [];
export const bookById = (id) => books().find((b) => b.id === id) || null;
export const reading = () => books().filter((b) => b.status === 'reading');
export function saveBooks(list) { saveBk({ books: list }); }
export function putBook(b) {
  const list = books();
  const i = list.findIndex((x) => x.id === b.id);
  if (i >= 0) list[i] = b; else list.unshift(b);
  saveBooks(list);
  return b;
}
export function deleteBook(id) { saveBooks(books().filter((b) => b.id !== id)); if (bkData().cur === id) saveBk({ cur: null }); }
export const curId = () => { const c = bkData().cur; const r = reading(); return r.some((b) => b.id === c) ? c : r[0]?.id || null; };
export function setCur(id) { saveBk({ cur: id }); }
export function newBook(o = {}) {
  return { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, title: '', author: '', cover: '', olKey: '', year: 0,
    format: 'paper', total: 300, pos: 0, status: 'reading', added: Date.now(), started: 0, finished: 0, startPos: 0, notes: [], hist: [], ...o };
}

// ------------------------------------------------------------------ progress
export const isAudio = (b) => b.format === 'audio';
export const progress = (b) => (b.total > 0 ? Math.max(0, Math.min(1, b.pos / b.total)) : 0);
export const fmtMins = (m) => { m = Math.max(0, Math.round(m)); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
/** "p. 154" / "2:35" */
export const posText = (b, v = b.pos) => (isAudio(b) ? fmtMins(v) : `p. ${Math.round(v)}`);
export const totalText = (b) => (isAudio(b) ? fmtMins(b.total) : `${b.total} pages`);
/** Set where you are; records today's reading (pages or minutes) for the pace and the streak. Returns the amount read. */
export function setPos(id, value) {
  const b = bookById(id);
  if (!b) return 0;
  value = Math.max(0, Math.min(b.total || Infinity, Math.round(value)));
  const delta = value - b.pos;
  const today = dayKey();
  if (!b.started) { b.started = Date.now(); b.startPos = b.pos; }
  b.pos = value;
  b.hist = [...(b.hist || []).filter((x) => x.d !== today), { d: today, pos: value }].slice(-400);
  if (b.status !== 'reading' && b.status !== 'done') b.status = 'reading';
  if (delta > 0) { const days = { ...(bkData().days || {}) }; days[today] = (days[today] || 0) + delta; pruneDays(days); saveBk({ days }); }
  putBook(b);
  return delta;
}
function pruneDays(days) { const cut = dayKey(daysAgo(400)); for (const k of Object.keys(days)) if (k < cut) delete days[k]; }
/** Pages (or minutes) a day since you started — null until there's something to go on. */
export function pace(b, now = Date.now()) {
  if (!b.started) return null;
  const read = b.pos - (b.startPos || 0);
  if (read <= 0) return null;
  const days = Math.max(1, Math.ceil((now - b.started) / DAY + 0.01));
  return read / days;
}
/** When you'll finish at your pace (ms) — or null. */
export function eta(b, now = Date.now()) {
  const p = pace(b, now);
  if (!p || b.pos >= b.total) return null;
  return now + Math.ceil((b.total - b.pos) / p) * DAY;
}
export function finish(id) {
  const b = bookById(id);
  if (!b) return;
  if (b.pos < b.total) setPos(id, b.total);
  putBook({ ...bookById(id), status: 'done', finished: Date.now() });
}
/** { current, best, today } — days in a row with some reading (today counts once you've read; until then yesterday's run holds). */
export function streak(now = Date.now()) {
  const days = bkData().days || {};
  const today = !!days[dayKey(now)];
  let current = 0;
  for (let i = today ? 0 : 1; i < 400; i++) { if (days[dayKey(daysAgo(i, now))]) current++; else break; }
  let best = 0, run = 0;
  for (let i = 399; i >= 0; i--) { if (days[dayKey(daysAgo(i, now))]) { run++; best = Math.max(best, run); } else run = 0; }
  return { current, best, today };
}
export const readToday = () => (bkData().days || {})[dayKey()] || 0;

// ------------------------------------------------------------------ notes & quotes
export function addNote(id, { kind = 'note', text, at = null }) {
  const b = bookById(id);
  if (!b || !text) return;
  b.notes = [{ id: `n${Date.now().toString(36)}`, t: Date.now(), kind, text, at }, ...(b.notes || [])];
  putBook(b);
}
export function deleteNote(id, nid) { const b = bookById(id); if (!b) return; b.notes = (b.notes || []).filter((n) => n.id !== nid); putBook(b); }

// ------------------------------------------------------------------ Open Library
export const coverUrl = (coverId, size = 'M') => (coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : '');
/** Search Open Library (https://openlibrary.org/search.json — CORS is open). Resolves to [{ title, author, cover, pages, year, olKey }]. */
export async function searchBooks(q, { limit = 16 } = {}) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=key,title,author_name,cover_i,number_of_pages_median,first_publish_year`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`Open Library answered ${r.status}`);
    const j = await r.json();
    return (j.docs || []).map((d) => ({ title: d.title || 'Untitled', author: (d.author_name || []).slice(0, 2).join(', '), cover: coverUrl(d.cover_i),
      pages: +d.number_of_pages_median || 0, year: +d.first_publish_year || 0, olKey: d.key || '' }));
  } finally { clearTimeout(t); }
}

// ------------------------------------------------------------------ Wish Lists (another app; optional)
/** Add a book to Wish Lists (apps/wishlist-store.js). Resolves true when it worked. */
export async function addToWishlist(b) {
  try {
    const m = await import('./wishlist-store.js');
    if (typeof m.addWish !== 'function') return false;
    await m.addWish({ kind: 'book', title: b.title, by: b.author || '', art: b.cover || '', source: 'openlibrary' });
    return true;
  } catch (e) { console.info('[books] wish lists not available', e); return false; }
}

// ------------------------------------------------------------------ reminders
export const reminders = () => bkData().reminders || [];
export function saveReminders(list) { saveBk({ reminders: list }); }
export function describeDays(days) {
  const d = [...(days || [])].sort();
  if (!d.length || d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Weekdays';
  if (d.join() === '0,1,2,3,4') return 'Sun – Thu';
  if (d.join() === '0,6') return 'Weekends';
  if (d.join() === '5,6') return 'Fri & Sat';
  return d.map((i) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]).join(' ');
}
/** The next time (ms) after `from` this reminder rings, or null when it's off. */
export function nextRing(r, from = Date.now()) {
  if (!r.on) return null;
  const base = new Date(from);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, r.h, r.m, 0, 0);
    if (d.getTime() <= from) continue;
    if (r.days?.length && !r.days.includes(d.getDay())) continue;
    return d.getTime();
  }
  return null;
}
let started = false, last = 0, ringing = null;
export function startReminders() {
  if (started) return;
  started = true;
  last = Date.now();
  setInterval(check, 1000);
}
function check() {
  const now = Date.now();
  const from = Math.max(last, now - 5 * 60000);   // after a sleep, still ring one missed by up to 5 min
  last = now;
  for (const r of reminders()) {
    const at = nextRing(r, from - 1);
    const snz = r.snoozeUntil && r.snoozeUntil > from - 1 && r.snoozeUntil <= now;
    if ((at && at <= now) || snz) {
      if (snz) saveReminders(reminders().map((x) => (x.id === r.id ? { ...x, snoozeUntil: 0 } : x)));
      fire(r);
      break;
    }
  }
}
/** Ring a reminder now (also used by "Test"). */
export function fire(r) {
  const b = bookById(curId());
  const label = r.label || 'Time to read';
  const where = b ? `${b.title}${b.status === 'reading' ? ` · ${posText(b)}` : ''}` : 'Pick up your book';
  ringing?.close({ pause: false });
  // ring() (clock-ring.js) shows it on any screen and calls notify() (js/core/alerts.js) with source 'books' — lights /
  // speaker / phone as set up in Settings → Alerts; closing it calls stopAlert()
  const hnd = ring({ time: `${pad(r.h)}:${pad(r.m)}`, title: label, color: COLOR, icon: 'clock', what: { what: 'sound', sound: 'marimba' },
    source: 'books', level: 'info', message: b ? `${label} — ${b.title}${isAudio(b) ? '' : `, page ${b.pos}`}` : label,
    snooze: '+10 min', snoozeIcon: 'plus',
    onSnooze: () => saveReminders(reminders().map((x) => (x.id === r.id ? { ...x, snoozeUntil: Date.now() + 10 * 60000 } : x))),
    onClose: () => { if (ringing === hnd) ringing = null; } });
  ringing = hnd;
  const sub = hnd.el.querySelector('.rk-sub');
  // the book you're on, under the title (the sound label replaces it a moment later in clock-ring; put it back)
  const showBook = () => { if (sub) sub.replaceChildren(Object.assign(document.createElement('span'), { textContent: where, dir: 'auto' })); };
  setTimeout(showBook, 400);
  const stop = hnd.el.querySelector('.rk-stop');
  if (stop) { stop.lastChild.textContent = 'OK'; const i = stop.querySelector('i'); if (i) i.innerHTML = icon('check'); }
  // a reminder is a nudge, not an alarm: it stops by itself after a minute
  setTimeout(() => { if (ringing === hnd) hnd.close({ pause: false }); }, 60000);
  events.emit('ring', r);
  return hnd;
}
/** main.js: start the reminders at boot only when one is on. */
export const wanted = () => (bkData().reminders || []).some((r) => r.on);
