// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Countdowns: events (birthdays, anniversaries, trips, holidays…), their next date, Jewish and common holidays
// computed on the device (Intl's Hebrew calendar — no API), and the reminder engine (N days before, on any screen).
// main.js starts the engine at boot when an event has reminders:
//   import('../apps/countdown-store.js').then((m) => m.startCountdowns())
//
// Saved in settings.appData.countdown: { events, featured (id), remindAt: 'HH:MM', fired: { key: ms } }
//   event: { id, name, kind: birthday | anniversary | holiday | trip | event, date: 'YYYY-MM-DD', time: 'HH:MM' | '',
//            yearly, noYear (a birthday without the year), hol (holiday key — its date is computed every year),
//            icon, color, photo, remind: [days before…], created }
//
// Jewish holidays begin at sunset the evening before. The countdown runs to the first full day (e.g. Rosh Hashana 5787
// → Sat 12 Sep 2026) and the event shows “begins the evening of Fri 11 Sep”.
import { store } from '../js/core/store.js';
import { Emitter } from '../js/core/util.js';
import { ring } from './clock-ring.js';
import { icon } from '../js/ui/icons.js';
import { pad, dayKey, parseDay, startOfDay, addDays, hm, uid, fmtDay, DAY } from './plants-ui.js';

export const COLOR = '#f59e0b';
export const events = new Emitter();   // 'change'
export const KINDS = [
  { id: 'birthday', name: 'Birthday', icon: 'cake', yearly: true }, { id: 'anniversary', name: 'Anniversary', icon: 'ring', yearly: true },
  { id: 'trip', name: 'Trip', icon: 'plane' }, { id: 'holiday', name: 'Holiday', icon: 'star', yearly: true }, { id: 'event', name: 'Event', icon: 'calendar' },
];
export const REMINDS = [{ id: 0, name: 'On the day' }, { id: 1, name: '1 day before' }, { id: 3, name: '3 days' }, { id: 7, name: '1 week' }, { id: 14, name: '2 weeks' }, { id: 30, name: '1 month' }];

// ------------------------------------------------------------------ holidays
const hebFmt = (() => { try { return new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return null; } })();
/** { day, month ('Tishri' … 'Adar I', 'Adar II'), year } of a local date. */
export function hebrewDate(t) {
  if (!hebFmt) return null;
  const p = hebFmt.formatToParts(new Date(t));
  return { day: +p.find((x) => x.type === 'day').value, month: p.find((x) => x.type === 'month').value, year: +p.find((x) => x.type === 'year').value };
}
const heb = (months, day) => ({ heb: true, test: (hd) => months.includes(hd.month) && hd.day === day });
export const HOLIDAYS = [
  { id: 'rosh', name: 'Rosh Hashana', he: 'ראש השנה', icon: 'apple', color: '#ef4444', eve: true, ...heb(['Tishri'], 1) },
  { id: 'kippur', name: 'Yom Kippur', he: 'יום כיפור', icon: 'david', color: '#94a3b8', eve: true, ...heb(['Tishri'], 10) },
  { id: 'sukkot', name: 'Sukkot', he: 'סוכות', icon: 'leaf', color: '#22c55e', eve: true, ...heb(['Tishri'], 15) },
  { id: 'hanukkah', name: 'Hanukkah', he: 'חנוכה', icon: 'menorah', color: '#3b82f6', eve: true, ...heb(['Kislev'], 25) },
  { id: 'tubishvat', name: 'Tu BiShvat', he: 'ט״ו בשבט', icon: 'tree', color: '#16a34a', eve: true, ...heb(['Shevat'], 15) },
  { id: 'purim', name: 'Purim', he: 'פורים', icon: 'party', color: '#ec4899', eve: true, ...heb(['Adar', 'Adar II'], 14) },
  { id: 'pesach', name: 'Pesach', he: 'פסח', icon: 'david', color: '#f59e0b', eve: true, ...heb(['Nisan'], 15) },
  { id: 'atzmaut', name: 'Yom HaAtzmaut', he: 'יום העצמאות', icon: 'flag', color: '#2563eb', eve: true, ...heb(['Iyar'], 5), atzmaut: true },
  { id: 'lagbaomer', name: 'Lag BaOmer', he: 'ל״ג בעומר', icon: 'flame', color: '#f97316', eve: true, ...heb(['Iyar'], 18) },
  { id: 'shavuot', name: 'Shavuot', he: 'שבועות', icon: 'wheat', color: '#eab308', eve: true, ...heb(['Sivan'], 6) },
  { id: 'newyear', name: 'New Year’s Day', icon: 'party', color: '#a855f7', md: [1, 1] },
  { id: 'valentine', name: 'Valentine’s Day', icon: 'heart', color: '#f43f5e', md: [2, 14] },
  { id: 'halloween', name: 'Halloween', icon: 'pumpkin', color: '#f97316', md: [10, 31] },
  { id: 'christmas', name: 'Christmas', icon: 'tree', color: '#dc2626', md: [12, 25] },
];
export const holidayById = (id) => HOLIDAYS.find((x) => x.id === id) || null;
const memo = new Map();
/** The next date (local midnight, ms) of a holiday on or after `from`'s day. */
export function holidayNext(id, from = Date.now()) {
  const hd = holidayById(id);
  if (!hd) return null;
  const f0 = startOfDay(from);
  const key = `${id}|${f0}`;
  if (memo.has(key)) return memo.get(key);
  let out = null;
  if (hd.md) {
    const d = new Date(f0);
    let t = new Date(d.getFullYear(), hd.md[0] - 1, hd.md[1]).getTime();
    if (t < f0) t = new Date(d.getFullYear() + 1, hd.md[0] - 1, hd.md[1]).getTime();
    out = t;
  } else if (hebFmt) {
    // walk the days (from a few days back, so a moved Yom HaAtzmaut is still found) until the Hebrew date matches
    for (let i = -3; i < 420 && out == null; i++) {
      const t = addDays(f0, i) + 12 * 36e5;   // noon: no DST edge
      if (!hd.test(hebrewDate(t))) continue;
      let day = startOfDay(t);
      if (hd.atzmaut) {   // moved off Shabbat: Fri / Sat → Thursday; Monday → Tuesday
        const wd = new Date(day).getDay();
        if (wd === 5) day = addDays(day, -1); else if (wd === 6) day = addDays(day, -2); else if (wd === 1) day = addDays(day, 1);
      }
      if (day >= f0) out = day;
    }
  }
  if (memo.size > 400) memo.clear();
  memo.set(key, out);
  return out;
}

// ------------------------------------------------------------------ data
export const cData = () => (store.get('appData') || {}).countdown || {};
function save(patch) { const all = store.get('appData') || {}; store.set('appData', { ...all, countdown: { ...(all.countdown || {}), ...patch } }); events.emit('change'); }
export const list = () => cData().events || [];
export const byId = (id) => list().find((e) => e.id === id) || null;
export const remindAt = () => cData().remindAt || '09:00';
export function setRemindAt(v) { save({ remindAt: v }); }
export function put(ev) { const l = list(); const i = l.findIndex((x) => x.id === ev.id); if (i >= 0) l[i] = ev; else l.push(ev); save({ events: l }); if (ev.remind?.length) startCountdowns(); return ev; }
export function remove(id) { save({ events: list().filter((e) => e.id !== id), featured: cData().featured === id ? null : cData().featured }); }
export function setFeatured(id) { save({ featured: id }); }
export function newEvent(o = {}) {
  return { id: uid('e'), name: '', kind: 'event', date: dayKey(addDays(Date.now(), 30)), time: '', yearly: false, noYear: false, hol: null, icon: 'calendar', color: COLOR, photo: '', remind: [1], created: Date.now(), ...o };
}
export function fromHoliday(id) {
  const hd = holidayById(id);
  const t = holidayNext(id);
  return newEvent({ name: hd.name, kind: 'holiday', hol: id, yearly: true, icon: hd.icon, color: hd.color, date: dayKey(t), remind: [1] });
}

// ------------------------------------------------------------------ dates
/** The next occurrence (ms: the day at its time, or midnight) on or after today — or the date itself for one-off events. */
export function nextAt(ev, now = Date.now()) {
  const t0 = startOfDay(now);
  let day;
  if (ev.hol) day = holidayNext(ev.hol, now);
  else {
    const d = parseDay(ev.date);
    if (!ev.yearly) day = d.getTime();
    else {
      const y = new Date(t0).getFullYear();
      const md = (yy) => { const last = new Date(yy, d.getMonth() + 1, 0).getDate(); return new Date(yy, d.getMonth(), Math.min(d.getDate(), last)).getTime(); };
      day = md(y);
      if (day < t0) day = md(y + 1);
    }
  }
  if (day == null) return null;
  const [h, m] = ev.time ? hm(ev.time) : [0, 0];
  const dd = new Date(day);
  return new Date(dd.getFullYear(), dd.getMonth(), dd.getDate(), h, m).getTime();
}
/** The previous occurrence (for the progress ring) — a year before for yearly events, else when it was added. */
export function prevAt(ev, now = Date.now()) {
  const n = nextAt(ev, now);
  if (ev.yearly || ev.hol) {
    if (ev.hol) { const p = holidayNext(ev.hol, n - 400 * DAY); return p && p < n ? p : n - 365 * DAY; }
    const d = new Date(n); return new Date(d.getFullYear() - 1, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()).getTime();
  }
  return Math.min(ev.created || n - 30 * DAY, n - DAY);
}
/** Whole days from today to the event's day (0 = today, negative = past). */
export const daysLeft = (ev, now = Date.now()) => { const n = nextAt(ev, now); return n == null ? null : Math.round((startOfDay(n) - startOfDay(now)) / DAY); };
export const isToday = (ev, now = Date.now()) => daysLeft(ev, now) === 0;
/** “turns 31” / “31 years” for yearly events with a known year. */
export function ageText(ev, now = Date.now()) {
  if (!ev.yearly || ev.hol || ev.noYear) return '';
  const y0 = parseDay(ev.date).getFullYear(), y = new Date(nextAt(ev, now)).getFullYear();
  const n = y - y0;
  if (n <= 0) return '';
  if (ev.kind === 'birthday') return `turns ${n}`;
  if (ev.kind === 'anniversary') return `${n} year${n === 1 ? '' : 's'} together`;
  return `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]} time`;
}
/** “Begins the evening of Fri 11 Sep” for Jewish holidays. */
export function eveText(ev, now = Date.now()) {
  const hd = ev.hol && holidayById(ev.hol);
  if (!hd?.eve) return '';
  return `begins the evening of ${fmtDay(addDays(startOfDay(nextAt(ev, now)), -1))}`;
}
/** Upcoming first (soonest first), then past one-off events (most recent first). */
export function sorted(now = Date.now()) {
  const l = list().map((e) => ({ e, at: nextAt(e, now), d: daysLeft(e, now) })).filter((x) => x.at != null);
  const up = l.filter((x) => x.d >= 0).sort((a, b) => a.at - b.at);
  const past = l.filter((x) => x.d < 0).sort((a, b) => b.at - a.at);
  return [...up, ...past];
}
export function featured(now = Date.now()) {
  const s = sorted(now);
  const f = s.find((x) => x.e.id === cData().featured);
  return (f || s.find((x) => x.d >= 0) || s[0])?.e || null;
}

// ------------------------------------------------------------------ reminders
let started = false, ringing = null;
const MISS = 10 * 60000;
export function startCountdowns() {
  if (started) return;
  started = true;
  setInterval(() => { try { check(); } catch (e) { console.warn('[countdown]', e); } }, 15000);
  setTimeout(() => { try { check(); } catch {} }, 1500);
}
/** One pass (exported for tests). */
export function check(now = Date.now()) {
  const fired = { ...(cData().fired || {}) };
  const due = [];
  const [rh, rm] = hm(remindAt());
  for (const ev of list()) {
    if (!ev.remind?.length) continue;
    const at = nextAt(ev, now);
    if (at == null) continue;
    const day0 = startOfDay(at);
    for (const n of ev.remind) {
      const d = new Date(addDays(day0, -n));
      const when = new Date(d.getFullYear(), d.getMonth(), d.getDate(), rh, rm).getTime();
      const key = `${ev.id}:${dayKey(day0)}:${n}`;
      if (!fired[key] && when <= now && when > now - MISS) { due.push({ ev, n }); fired[key] = now; }
    }
  }
  if (!due.length) return null;
  for (const k of Object.keys(fired)) if (fired[k] < now - 60 * DAY) delete fired[k];
  save({ fired });
  fire(due[0].ev, due[0].n);
  return due;
}
export function reminderText(ev, n) {
  const age = ageText(ev);
  if (n === 0) return { title: `Today: ${ev.name}!`, message: [age, eveText(ev)].filter(Boolean).join(' · ') || 'It’s today!' };
  return { title: `${ev.name} in ${n === 1 ? '1 day' : `${n} days`}`, message: [fmtDay(nextAt(ev)), age, eveText(ev)].filter(Boolean).join(' · ') };
}
export function fire(ev, n) {
  const { title, message } = reminderText(ev, n);
  ringing?.close({ pause: false, silent: true });
  const hnd = ring({
    time: n === 0 ? 'Today!' : n === 1 ? 'Tomorrow' : `${n} days`, title, color: ev.color || COLOR, icon: 'star', what: { what: 'sound', sound: 'chime' },
    source: 'countdown', level: 'info', message,
    onClose: () => { if (ringing === hnd) ringing = null; },
  });
  ringing = hnd;
  const t = hnd.el.querySelector('.rk-time'); if (t) t.style.fontSize = '13cqmin';
  const sub = hnd.el.querySelector('.rk-sub');
  setTimeout(() => { if (sub) sub.replaceChildren(Object.assign(document.createElement('span'), { textContent: message, dir: 'auto' })); }, 400);
  const stop = hnd.el.querySelector('.rk-stop');
  if (stop) { stop.lastChild.textContent = 'OK'; const i = stop.querySelector('i'); if (i) i.innerHTML = icon('check'); }
  setTimeout(() => { if (ringing === hnd) hnd.close({ pause: false }); }, 60000);
  return hnd;
}
/** main.js: start at boot only when an event has reminders. */
export const wanted = () => (cData().events || []).some((e) => e.remind?.length);
export { pad };
