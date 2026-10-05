// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Plants & Pets: the data (profiles, care tasks, the done log, household members), the schedules, today's list,
// the streak and the reminder engine (rings on any screen while Round Remote is open, like the clock's alarms).
// main.js starts the engine at boot when there are tasks:  import('../apps/plants-store.js').then((m) => m.startPlants())
//
// Saved in settings.appData.plants:
//   profiles: [{ id, name, kind: plant|cat|dog|fish|bird|rabbit|reptile|other, color, photo (URL), sensor: { entity, below } | null, created }]
//   tasks:    [{ id, pid, type, label, dose, remind, created, last (ms, last done),
//                sched: { kind: 'daily', times: ['08:00', …] } | { kind: 'weekly', days: [0…6], at } | { kind: 'every', n, unit: d|w|m|y, start: 'YYYY-MM-DD', at } }]
//   log:      [{ id, tid, pid, at, who }]   (newest first, at most 600)
//   members:  ['Dana', …]   remindOn: true   fired: { key: ms }   snoozed: { key: until }
//
// Occurrences: a daily / weekly task has slots (each time on each day); a slot counts as done when the log has an entry
// in its window (from halfway since the previous slot, at most 4 h early, up to the next slot's window). An "every N"
// task has one pending due time: N days / weeks / months / years after it was last done (or its start date).
import { store } from '../js/core/store.js';
import { Emitter } from '../js/core/util.js';
import { ring } from './clock-ring.js';
import { icon } from '../js/ui/icons.js';
import { pad, dayKey, parseDay, startOfDay, addDays, hm, uid, WD, DAY, fmtTime } from './plants-ui.js';
import { sensorValue, haReady, ha } from './plants-ha.js';

export const COLOR = '#22c55e';
export const events = new Emitter();   // 'change', 'ring'
const H = 36e5;

export const KINDS = [
  { id: 'plant', name: 'Plant' }, { id: 'cat', name: 'Cat' }, { id: 'dog', name: 'Dog' }, { id: 'fish', name: 'Fish' },
  { id: 'bird', name: 'Bird' }, { id: 'rabbit', name: 'Rabbit' }, { id: 'reptile', name: 'Reptile' }, { id: 'other', name: 'Other' },
];
export const TYPES = {
  water: { name: 'Water', past: 'Watered' }, fert: { name: 'Fertilise', past: 'Fertilised' }, mist: { name: 'Mist', past: 'Misted' },
  repot: { name: 'Repot', past: 'Repotted' }, feed: { name: 'Feed', past: 'Fed' }, walk: { name: 'Walk', past: 'Walked' },
  litter: { name: 'Litter box', past: 'Cleaned the litter' }, tank: { name: 'Clean tank', past: 'Cleaned the tank' }, med: { name: 'Medicine', past: 'Gave medicine to' },
  vet: { name: 'Vet visit', past: 'Vet visit for' }, vacc: { name: 'Vaccination', past: 'Vaccinated' }, groom: { name: 'Grooming', past: 'Groomed' },
  flea: { name: 'Flea treatment', past: 'Flea treatment for' }, clean: { name: 'Clean cage', past: 'Cleaned the cage of' }, task: { name: 'Other', past: 'Done for' },
};
/** Task types offered first for each kind. */
export const KIND_TYPES = {
  plant: ['water', 'fert', 'mist', 'repot', 'task'],
  cat: ['feed', 'water', 'litter', 'groom', 'flea', 'med', 'vacc', 'vet', 'task'],
  dog: ['feed', 'walk', 'water', 'groom', 'flea', 'med', 'vacc', 'vet', 'task'],
  fish: ['feed', 'tank', 'water', 'med', 'task'],
  bird: ['feed', 'water', 'clean', 'med', 'vet', 'task'],
  rabbit: ['feed', 'water', 'clean', 'groom', 'med', 'vacc', 'vet', 'task'],
  reptile: ['feed', 'mist', 'tank', 'med', 'vet', 'task'],
  other: ['feed', 'water', 'clean', 'groom', 'med', 'vet', 'task'],
};
const D = (times) => ({ kind: 'daily', times });
const E = (n, unit, at = '09:00') => ({ kind: 'every', n, unit, at });
const W = (days, at) => ({ kind: 'weekly', days, at });
/** Sensible starting tasks per kind (on: picked by default). */
export const PRESETS = {
  plant: [{ type: 'water', sched: E(7, 'd'), on: 1 }, { type: 'fert', sched: E(4, 'w'), on: 1 }, { type: 'mist', sched: E(3, 'd') }, { type: 'repot', sched: E(1, 'y') }],
  cat: [{ type: 'feed', sched: D(['08:00', '18:00']), on: 1 }, { type: 'water', label: 'Fresh water', sched: D(['08:00']), on: 1 }, { type: 'litter', sched: D(['20:00']), on: 1 },
    { type: 'groom', sched: W([0], '10:00') }, { type: 'flea', sched: E(1, 'm'), on: 1 }, { type: 'vacc', sched: E(1, 'y'), on: 1 }],
  dog: [{ type: 'feed', sched: D(['07:30', '18:30']), on: 1 }, { type: 'walk', sched: D(['07:00', '13:00', '19:30']), on: 1 }, { type: 'water', label: 'Fresh water', sched: D(['08:00']) },
    { type: 'flea', sched: E(1, 'm'), on: 1 }, { type: 'vacc', sched: E(1, 'y'), on: 1 }, { type: 'groom', sched: E(6, 'w') }, { type: 'vet', label: 'Check-up', sched: E(1, 'y') }],
  fish: [{ type: 'feed', sched: D(['08:00']), on: 1 }, { type: 'tank', sched: E(2, 'w'), on: 1 }, { type: 'water', label: 'Water change', sched: W([6], '10:00') }],
  bird: [{ type: 'feed', sched: D(['08:00']), on: 1 }, { type: 'water', label: 'Fresh water', sched: D(['08:00']), on: 1 }, { type: 'clean', sched: E(1, 'w'), on: 1 }],
  rabbit: [{ type: 'feed', label: 'Hay & veg', sched: D(['08:00', '18:00']), on: 1 }, { type: 'clean', sched: E(1, 'w'), on: 1 }, { type: 'groom', sched: E(1, 'w') }, { type: 'vacc', sched: E(1, 'y'), on: 1 }],
  reptile: [{ type: 'feed', sched: E(3, 'd', '18:00'), on: 1 }, { type: 'mist', sched: D(['09:00']), on: 1 }, { type: 'tank', sched: E(2, 'w'), on: 1 }],
  other: [{ type: 'feed', sched: D(['08:00']), on: 1 }],
};
export const UNITS = [{ id: 'd', name: 'days', one: 'day' }, { id: 'w', name: 'weeks', one: 'week' }, { id: 'm', name: 'months', one: 'month' }, { id: 'y', name: 'years', one: 'year' }];

// ------------------------------------------------------------------ data
export const pData = () => (store.get('appData') || {}).plants || {};
function save(patch) { const all = store.get('appData') || {}; store.set('appData', { ...all, plants: { ...(all.plants || {}), ...patch } }); events.emit('change'); }
export const profiles = () => pData().profiles || [];
export const tasks = () => pData().tasks || [];
export const log = () => pData().log || [];
export const members = () => pData().members || [];
export const profileById = (id) => profiles().find((p) => p.id === id) || null;
export const taskById = (id) => tasks().find((t) => t.id === id) || null;
export const remindOn = () => pData().remindOn !== false;
export function setMembers(list) { save({ members: list }); }
export function setRemindOn(on) { save({ remindOn: !!on }); }
export function putProfile(p) { const l = profiles(); const i = l.findIndex((x) => x.id === p.id); if (i >= 0) l[i] = p; else l.push(p); save({ profiles: l }); return p; }
export function deleteProfile(id) { save({ profiles: profiles().filter((p) => p.id !== id), tasks: tasks().filter((t) => t.pid !== id) }); }
export function putTask(t) { const l = tasks(); const i = l.findIndex((x) => x.id === t.id); if (i >= 0) l[i] = t; else l.push(t); save({ tasks: l }); startPlants(); return t; }
export function deleteTask(id) { save({ tasks: tasks().filter((t) => t.id !== id) }); }
export const newProfile = (o = {}) => ({ id: uid('p'), name: '', kind: 'plant', color: '#22c55e', photo: '', sensor: null, created: Date.now(), ...o });
export function newTask(pid, o = {}) {
  const t = { id: uid('t'), pid, type: 'task', label: '', dose: '', remind: true, created: Date.now(), last: 0, sched: D(['09:00']), ...o };
  t.sched = JSON.parse(JSON.stringify(t.sched));
  if (t.sched.kind === 'every' && !t.sched.start) t.sched.start = dayKey(['m', 'y'].includes(t.sched.unit) ? addInterval(startOfDay(), t.sched.n, t.sched.unit) : Date.now());
  return t;
}
export const taskName = (t) => t.label || TYPES[t.type]?.name || 'Task';

// ------------------------------------------------------------------ schedules
export function addInterval(t, n, unit) {
  const d = new Date(t);
  if (unit === 'w') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * n, d.getHours(), d.getMinutes()).getTime();
  if (unit === 'm' || unit === 'y') {
    const months = unit === 'm' ? n : 12 * n;
    const y = d.getFullYear(), m = d.getMonth() + months;
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(d.getDate(), last), d.getHours(), d.getMinutes()).getTime();
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime();
}
const at = (day0, s) => { const [a, b] = hm(s); const d = new Date(day0); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), a, b).getTime(); };
/** The slot times (ms) of a daily / weekly task on the day starting at day0. */
export function slotsOn(t, day0) {
  const s = t.sched || {};
  if (s.kind === 'daily') return [...(s.times || [])].sort().map((x) => at(day0, x));
  if (s.kind === 'weekly') return (s.days || []).includes(new Date(day0).getDay()) ? [at(day0, s.at)] : [];
  return [];
}
const isSlot = (t) => t.sched?.kind === 'daily' || t.sched?.kind === 'weekly';
/** Slot before / after `ts` (searching up to 8 days). */
function slotNear(t, ts, dir) {
  const d0 = startOfDay(ts);
  for (let i = 0; i <= 8; i++) {
    const day = addDays(d0, dir * i);
    const sl = slotsOn(t, day);
    const c = dir < 0 ? sl.filter((x) => x < ts).pop() : sl.find((x) => x > ts);
    if (c != null) return c;
  }
  return null;
}
/** The window [from, to) in which marking a slot done counts for it. */
export function slotWindow(t, T) {
  const P = slotNear(t, T, -1), N = slotNear(t, T, 1);
  const from = T - Math.min(4 * H, P != null ? (T - P) / 2 : 4 * H);
  const to = N != null ? N - Math.min(4 * H, (N - T) / 2) : T + 7 * DAY;
  return [from, to];
}
const doneIn = (tid, from, to, lg = log()) => lg.find((e) => e.tid === tid && e.at >= from && e.at < to) || null;
/** When an "every N" task is next due (ms). */
export function nextDue(t) {
  const s = t.sched || {};
  if (s.kind !== 'every') return null;
  const base = t.last ? addInterval(startOfDay(t.last), s.n || 1, s.unit || 'd') : parseDay(s.start || dayKey(t.created)).getTime();
  return at(base, s.at || '09:00');
}
/** Due date after the next (for the week view). */
const dueAfter = (t, due) => at(addInterval(startOfDay(due), t.sched.n || 1, t.sched.unit || 'd'), t.sched.at || '09:00');

/**
 * Occurrences between day0 and day0 + days (slots, and the due "every" tasks; overdue ones on the first day).
 * Each: { key, task, profile, at, done (log entry | null), status: done | upcoming | due | late }
 */
export function occurrences(day0 = startOfDay(), days = 1, now = Date.now()) {
  const out = [];
  const end = addDays(day0, days);
  const lg = log();
  const today0 = startOfDay(now);
  for (const t of tasks()) {
    const p = profileById(t.pid);
    if (!p) continue;
    if (isSlot(t)) {
      for (let i = 0; i < days; i++) {
        for (const T of slotsOn(t, addDays(day0, i))) {
          if (T < (t.created || 0) - H) continue;   // slots from before the task existed don't count
          const [from, to] = slotWindow(t, T);
          const done = doneIn(t.id, from, to, lg);
          out.push({ key: `${t.id}@${T}`, task: t, profile: p, at: T, done, status: status(T, done, now) });
        }
      }
    } else if (t.sched?.kind === 'every') {
      let due = nextDue(t);
      // done on one of these days → show it as done
      for (const e of lg) if (e.tid === t.id && e.at >= day0 && e.at < end) out.push({ key: `${t.id}#${e.id}`, task: t, profile: p, at: e.at, done: e, status: 'done' });
      let n = 0;
      while (due < end && n++ < 40) {
        const showAt = due < day0 ? (day0 === today0 ? due : null) : due;   // overdue ones show on today's list
        if (showAt != null) out.push({ key: `${t.id}@${due}`, task: t, profile: p, at: due, done: null, status: status(Math.max(due, t.last ? 0 : (t.created || 0)), null, now) });
        if (days === 1) break;
        due = dueAfter(t, due);
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
function status(T, done, now) {
  if (done) return 'done';
  if (now < T) return 'upcoming';
  return now - T > H ? 'late' : 'due';
}
/** Today's list: late first, then by time. */
export function today(now = Date.now()) {
  const list = occurrences(startOfDay(now), 1, now);
  return list;
}
export const lateBy = (o, now = Date.now()) => {
  const m = Math.round((now - o.at) / 60000);
  if (m < 60) return `${m} min late`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h late`;
  const d = Math.round((startOfDay(now) - startOfDay(o.at)) / DAY);
  return `${d} day${d === 1 ? '' : 's'} late`;
};

export function describe(t) {
  const s = t.sched || {};
  if (s.kind === 'daily') return (s.times || []).length > 1 ? `Daily · ${[...s.times].sort().join(', ')}` : `Daily · ${(s.times || [])[0] || ''}`;
  if (s.kind === 'weekly') {
    const ds = [...(s.days || [])].sort();
    return `${ds.length === 7 ? 'Every day' : ds.map((d) => WD[d]).join(' ')} · ${s.at}`;
  }
  if (s.kind === 'every') {
    const u = UNITS.find((x) => x.id === s.unit) || UNITS[0];
    return s.n === 1 ? `Every ${u.one}` : `Every ${s.n} ${u.name}`;
  }
  return '';
}

// ------------------------------------------------------------------ done / undo
export function markDone(tid, { who = '', at: when = Date.now() } = {}) {
  const t = taskById(tid);
  if (!t) return null;
  const e = { id: uid('l'), tid, pid: t.pid, at: when, who: who || '' };
  const lg = [e, ...log()].slice(0, 600);
  const ts = tasks().map((x) => (x.id === tid ? { ...x, last: Math.max(x.last || 0, when) } : x));
  const snoozed = { ...(pData().snoozed || {}) };
  for (const k of Object.keys(snoozed)) if (k.startsWith(tid + '@')) delete snoozed[k];
  save({ log: lg, tasks: ts, snoozed, lastWho: who || pData().lastWho || '' });
  return e;
}
export function undo(logId) {
  const e = log().find((x) => x.id === logId);
  if (!e) return;
  const lg = log().filter((x) => x.id !== logId);
  const last = lg.filter((x) => x.tid === e.tid).reduce((m, x) => Math.max(m, x.at), 0);
  save({ log: lg, tasks: tasks().map((x) => (x.id === e.tid ? { ...x, last } : x)) });
}
export const lastWho = () => pData().lastWho || '';

// ------------------------------------------------------------------ streak
/**
 * Days in a row when everything due got done. A day counts when it had something scheduled and all its daily / weekly
 * slots were done (and, today, nothing is late); days with nothing scheduled are skipped. Today only counts once it's complete.
 */
export function streak(now = Date.now()) {
  const lg = log();
  const ts = tasks().filter((t) => profileById(t.pid));
  if (!ts.length) return { current: 0, today: false };
  const firstDay = startOfDay(Math.min(...ts.map((t) => t.created || now)));
  const dayOk = (d0) => {
    let any = false;
    for (const t of ts) {
      if (isSlot(t)) {
        for (const T of slotsOn(t, d0)) {
          if (T < (t.created || 0) - H) continue;   // slots from before the task existed don't count
          any = true;
          const [from, to] = slotWindow(t, T);
          if (!doneIn(t.id, from, to, lg)) return false;
        }
      } else if (lg.some((e) => e.tid === t.id && e.at >= d0 && e.at < addDays(d0, 1))) any = true;
    }
    return any ? true : null;
  };
  const t0 = startOfDay(now);
  const todayList = occurrences(t0, 1, now);
  const todayDone = todayList.length > 0 && todayList.every((o) => o.status === 'done');
  let current = todayDone ? 1 : 0;
  for (let i = 1; i < 366; i++) {
    const d0 = addDays(t0, -i);
    if (d0 < firstDay) break;
    const ok = dayOk(d0);
    if (ok === null) continue;
    if (!ok) break;
    current++;
  }
  return { current, today: todayDone };
}

// ------------------------------------------------------------------ soil moisture (Home Assistant)
/** { value, unit, dry } for a profile with a sensor, or null. */
export function soil(p) {
  if (!p?.sensor?.entity || !haReady()) return null;
  const v = sensorValue(p.sensor.entity);
  if (v == null) return null;
  return { value: v, unit: ha()?.entity?.(p.sensor.entity)?.attributes?.unit_of_measurement || '%', dry: v < (p.sensor.below ?? 30) };
}

// ------------------------------------------------------------------ reminders
let started = false, timer = 0, ringing = null;
const MISS = 10 * 60000;   // after a sleep, still remind about one missed by up to 10 min
export function startPlants() {
  if (started) return;
  started = true;
  if (haReady()) ha()?.connect?.().catch(() => {});
  timer = setInterval(() => { try { check(); } catch (e) { console.warn('[plants]', e); } }, 5000);
  setTimeout(() => { try { check(); } catch {} }, 1200);
}
/** One pass: what should ring now? (exported for tests) */
export function check(now = Date.now()) {
  if (!remindOn()) return null;
  const d = pData();
  const fired = { ...(d.fired || {}) }, snoozed = { ...(d.snoozed || {}) };
  const items = [];
  let warn = false;
  const list = occurrences(startOfDay(now), 1, now);
  for (const o of list) {
    if (o.done || !o.task.remind) continue;
    const k = o.key;
    if (snoozed[k]) {
      if (snoozed[k] <= now) { delete snoozed[k]; items.push(o); fired[k] = now; }
      continue;
    }
    if (!fired[k] && o.at <= now && o.at > now - MISS) { items.push(o); fired[k] = now; continue; }
    // an "every N" task still late from an earlier day: again each day at its time
    if (o.at < startOfDay(now) && o.task.sched?.kind === 'every') {
      const T = at(startOfDay(now), o.task.sched.at || '09:00'), k2 = `${k}:${dayKey(now)}`;
      if (!fired[k2] && T <= now && T > now - MISS) { items.push({ ...o, late: true }); fired[k2] = now; continue; }
    }
    // medicine still not given an hour later → a stronger reminder, once
    if (o.task.type === 'med' && !fired[k + '!'] && now - o.at >= H && now - o.at < 6 * H) { items.push({ ...o, late: true }); fired[k + '!'] = now; warn = true; }
  }
  // plants with a soil sensor that's too dry: once a day, in the daytime
  const hr = new Date(now).getHours();
  if (hr >= 8 && hr < 21) {
    for (const p of profiles()) {
      const s = soil(p);
      const k = `soil:${p.id}:${dayKey(now)}`;
      if (!s?.dry) continue;
      const it = { key: k, soil: s, profile: p, task: null, at: now };
      if (snoozed[k]) { if (snoozed[k] <= now) { delete snoozed[k]; items.push(it); } continue; }
      if (!fired[k]) { items.push(it); fired[k] = now; }
    }
  }
  if (!items.length) return null;
  for (const k of Object.keys(fired)) if (fired[k] < now - 3 * DAY) delete fired[k];
  save({ fired, snoozed });
  fire(items, { warn });
  return items;
}
export const lineFor = (o) => (o.task
  ? `${taskName(o.task)}${o.task.dose ? ` (${o.task.dose})` : ''} · ${o.profile.name}${o.late ? ' — overdue' : ''}`
  : `${o.profile.name} needs water (soil ${Math.round(o.soil.value)}${o.soil.unit})`);
/** Ring for these occurrences (one ring for all of them). */
export function fire(items, { warn = false } = {}) {
  const first = items[0];
  const title = items.length === 1 ? (first.task ? `${first.late ? 'Overdue: ' : ''}${taskName(first.task)} · ${first.profile.name}` : `${first.profile.name} needs water`) : `${items.length} things to do`;
  const message = items.map(lineFor).join('\n');
  ringing?.close({ pause: false, silent: true });
  const hnd = ring({
    time: fmtTime(first.at || Date.now()), title, color: first.profile?.color || COLOR, icon: 'drop', what: { what: 'sound', sound: 'marimba' },
    source: 'plants', level: warn ? 'warn' : 'info', message: message.replace(/\n/g, ' · '),
    snooze: '1 hour', snoozeIcon: 'clock',
    onSnooze: () => snooze(items, H),
    onClose: () => { if (ringing === hnd) ringing = null; },
  });
  ringing = hnd;
  const sub = hnd.el.querySelector('.rk-sub');
  const showList = () => { if (sub) sub.replaceChildren(Object.assign(document.createElement('span'), { textContent: items.slice(0, 3).map(lineFor).join(' · '), dir: 'auto' })); };
  setTimeout(showList, 400);
  const stop = hnd.el.querySelector('.rk-stop');
  if (stop) { stop.lastChild.textContent = 'OK'; const i = stop.querySelector('i'); if (i) i.innerHTML = icon('check'); }
  // "Mark done" (everything in this reminder)
  const tasksIn = items.filter((o) => o.task);
  if (tasksIn.length) {
    const done = document.createElement('button');
    done.type = 'button'; done.className = 'rk-keep pp-ringdone';
    done.textContent = tasksIn.length > 1 ? 'Mark all done' : 'Mark done';
    done.style.cssText = 'background: var(--glass-2); border: 1px solid var(--line); color: var(--fg); top: 92%';
    done.addEventListener('click', (e) => { e.stopPropagation(); for (const o of tasksIn) markDone(o.task.id, { who: lastWho() }); hnd.close({ pause: false }); });
    hnd.el.append(done);
  }
  setTimeout(() => { if (ringing === hnd) hnd.close({ pause: false }); }, 120000);
  events.emit('ring', items);
  return hnd;
}
export function snooze(items, ms = H) {
  const snoozed = { ...(pData().snoozed || {}) }, fired = { ...(pData().fired || {}) };
  for (const o of items) snoozed[o.key] = Date.now() + ms;
  save({ snoozed, fired });
}
/** main.js: start at boot only when there's something to remind about. */
export const wanted = () => (pData().tasks || []).length > 0;
export { pad, WD };
