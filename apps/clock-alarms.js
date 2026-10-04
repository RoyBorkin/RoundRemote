// Clock alarms: saved alarms + the background scheduler that rings them.
//
// startAlarms() is idempotent. The Clock app calls it when it opens; from then on the scheduler keeps running in the
// background for as long as Round Remote is open (the module stays loaded), so alarms ring on any screen.
// To have alarms ring right after a page load (without opening the Clock first), main.js can call:
//   import('../apps/clock-alarms.js').then((m) => m.startAlarms());
import { store } from '../js/core/store.js';
import { Emitter } from '../js/core/util.js';
import { ring } from './clock-ring.js';

export const COLOR = '#60a5fa';
export const events = new Emitter();   // 'change' — alarms list changed (rang, snoozed, edited)

// per-app data lives in settings.appData.clock (the same place app.data()/app.save() use)
export function clockData() { return (store.get('appData') || {}).clock || {}; }
export function saveClock(patch) { const all = store.get('appData') || {}; store.set('appData', { ...all, clock: { ...(all.clock || {}), ...patch } }); }

export const alarms = () => clockData().alarms || [];
export function saveAlarms(list) { saveClock({ alarms: list }); events.emit('change'); }

export const pad = (n) => String(n).padStart(2, '0');
export function fmtHM(h, m, h24 = clockData().h24 ?? defaultH24()) {
  if (h24) return `${pad(h)}:${pad(m)}`;
  return `${((h + 11) % 12) + 1}:${pad(m)}`;
}
export const ampm = (h) => (h < 12 ? 'AM' : 'PM');
export function defaultH24() {
  try { return !new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12; } catch { return true; }
}

/** The first time after `from` (ms) this alarm goes off, or null when it's off. */
export function nextRing(a, from = Date.now()) {
  if (!a.on) return null;
  const base = new Date(from);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, a.h, a.m, 0, 0);
    if (d.getTime() <= from) continue;
    if (a.days?.length && !a.days.includes(d.getDay())) continue;
    return d.getTime();
  }
  return null;
}

// snoozed alarms: id → time it rings again (kept in memory and in the saved alarm, so a reload keeps it)
export function snoozedUntil(a) { return a.snoozeUntil && a.snoozeUntil > Date.now() - 60000 ? a.snoozeUntil : 0; }

/** { alarm, at } — the next alarm to ring, or null. */
export function upcoming() {
  let best = null;
  for (const a of alarms()) {
    const at = Math.min(...[nextRing(a), snoozedUntil(a) || null].filter(Boolean));
    if (Number.isFinite(at) && (!best || at < best.at)) best = { alarm: a, at };
  }
  return best;
}

export function describeDays(days) {
  const d = [...(days || [])].sort();
  if (!d.length) return 'Once';
  if (d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Weekdays';
  if (d.join() === '0,6') return 'Weekends';
  if (d.join() === '0,1,2,3,4') return 'Sun – Thu';
  return d.map((i) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]).join(' ');
}

let started = false, last = Date.now(), ringing = null;
export function startAlarms() {
  if (started) return;
  started = true;
  last = Date.now();
  setInterval(check, 1000);
}

function check() {
  const now = Date.now();
  const from = Math.max(last, now - 10 * 60000);   // after a sleep, still ring alarms missed by up to 10 min
  last = now;
  const list = alarms();
  for (const a of list) {
    const due = nextRing(a, from - 1);
    const snz = a.snoozeUntil && a.snoozeUntil > from - 1000 && a.snoozeUntil <= now;
    if ((due && due <= now) || snz) { fire(a); return; }
  }
}

function fire(a) {
  // one-off alarms switch themselves off; snooze state is cleared
  const list = alarms().map((x) => (x.id === a.id ? { ...x, on: x.days?.length ? x.on : false, snoozeUntil: 0 } : x));
  saveAlarms(list);
  ringing?.close({ pause: false, silent: true });
  const n = new Date();
  const mins = a.snoozeMin || 9;
  ringing = ring({
    time: fmtHM(n.getHours(), n.getMinutes()), title: a.label || 'Alarm', color: COLOR, icon: 'clock', what: a.what,
    snooze: `Snooze ${mins}′`, snoozeIcon: 'moon',
    onSnooze: () => {
      const until = Date.now() + mins * 60000;
      saveAlarms(alarms().map((x) => (x.id === a.id ? { ...x, snoozeUntil: until } : x)));
      ringing = null;
    },
    onStop: () => { ringing = null; },
  });
  // give up after 15 minutes
  const h = ringing;
  setTimeout(() => { if (ringing === h) { h.close({ pause: true }); ringing = null; } }, 15 * 60000);
}

/** Ring an alarm now (the editor's "Test" button). */
export const testAlarm = (a) => fire({ ...a, id: '__test__' });
