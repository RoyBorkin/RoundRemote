// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Play Time engine: players (profiles) with a daily gaming budget, the running sessions, the history, the warnings
// and the auto-detection of games from the PlayStation / Steam services. It lives at module level so it keeps
// counting and warning when the Play Time app isn't open (main.js starts it at boot when a session is running or a
// player has a console linked):  import('../apps/playtime-engine.js').then((m) => m.startPlaytime())
//
// Saved in settings.appData.playtime: { profiles, cur, run, log, fired, pin, testMinMs? }
//   profiles: [{ id, name, color, budget: [min × 7, Sun…Sat], session: min | 0, bed: {h,m} | null, wake: {h,m},
//                links: ['playstation' | 'steam'], restPs, pauseMusic, created }]
//   run:   { [pid]: { since, last, auto: svcId | null, game } }   (`last` = when the time was last added to the log)
//   log:   { [pid]: { 'YYYY-MM-DD': { used: ms, bonus: min, grace: min } } }
//   testMinMs: a test option — how long a "minute" lasts (e.g. 1000 → a 15 minute warning comes after 15 s)
import { store } from '../js/core/store.js';
import { Emitter } from '../js/core/util.js';
import { player } from '../js/core/player.js';
import { provider } from '../js/providers/registry.js';
import { ring } from './clock-ring.js';

export const COLOR = '#ef4444';
export const PCOLORS = ['#60a5fa', '#f472b6', '#34d399', '#f59e0b', '#a78bfa', '#22d3ee', '#fb7185', '#a3e635'];
export const SVCS = [{ id: 'playstation', name: 'PlayStation' }, { id: 'steam', name: 'Steam' }];
export const WARN_AT = [15, 5, 0, -15, -30, -45, -60];      // minutes left (negative = over)
export const events = new Emitter();                       // 'change' (sessions, profiles, log) · 'alert'

const DAY = 864e5;
export const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const dayStart = (t = Date.now()) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const nextMidnight = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };
/** The day `n` days before `t` (calendar days, DST-safe). */
export const daysAgo = (n, t = Date.now()) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 12).getTime(); };

// ------------------------------------------------------------------ saved data
export function ptData() { return (store.get('appData') || {}).playtime || {}; }
function savePt(patch) { const all = store.get('appData') || {}; store.set('appData', { ...all, playtime: { ...(all.playtime || {}), ...patch } }); }
/** How long a "minute" lasts (the test option shortens it). */
export const MIN = () => +ptData().testMinMs || 60000;

export const profiles = () => ptData().profiles || [];
export const profileById = (id) => profiles().find((p) => p.id === id) || null;
export function saveProfiles(list) { savePt({ profiles: list }); syncWatch(); events.emit('change'); }
export function newProfile(name = '') {
  const n = profiles().length;
  return { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`, name: name || `Player ${n + 1}`, color: PCOLORS[n % PCOLORS.length],
    budget: [120, 90, 90, 90, 90, 90, 120], session: 0, bed: null, wake: { h: 7, m: 0 }, links: [], restPs: false, pauseMusic: false, created: Date.now() };
}
export function deleteProfile(id) {
  if (D.run[id]) stopSession(id);
  delete D.log[id]; delete D.fired[id];
  saveProfiles(profiles().filter((p) => p.id !== id));
  persist();
}
export const getPin = () => ptData().pin || '';
export function setPin(pin) { savePt({ pin: pin || '' }); }
export const curId = () => { const c = ptData().cur; return profileById(c) ? c : profiles()[0]?.id || null; };
export function setCur(id) { savePt({ cur: id }); }

// ------------------------------------------------------------------ engine state (mirrored to the saved data)
const D = { run: {}, log: {}, fired: {} };
let loaded = false;
function load() {
  if (loaded) return;
  loaded = true;
  const d = ptData();
  D.run = { ...(d.run || {}) }; D.log = JSON.parse(JSON.stringify(d.log || {})); D.fired = { ...(d.fired || {}) };
  const now = Date.now();
  for (const [pid, r] of Object.entries(D.run)) {
    if (!profileById(pid)) { delete D.run[pid]; continue; }
    const gap = now - r.last;
    // a session the page lost track of: an auto-detected one waits for the console to say so again; a manual one keeps
    // counting through a short gap (a reload), but one left running for hours (the display was off) ends where it was
    if (r.auto && gap > 120000) delete D.run[pid];
    else if (gap > 3 * 3600e3) delete D.run[pid];
  }
  prune();
}
function persist() { savePt({ run: D.run, log: D.log, fired: D.fired }); }
function prune() {
  const cut = dayKey(daysAgo(180));
  for (const days of Object.values(D.log)) for (const k of Object.keys(days)) if (k < cut) delete days[k];
}
const dayRec = (pid, key = dayKey()) => ((D.log[pid] ||= {})[key] ||= { used: 0, bonus: 0, grace: 0 });
const peekDay = (pid, key = dayKey()) => (loaded ? D.log : ptData().log || {})[pid]?.[key] || null;
/** Add the played time a → b to the log, split at midnight. */
function addSpan(pid, a, b) {
  while (a < b) { const e = Math.min(b, nextMidnight(a)); dayRec(pid, dayKey(a)).used += e - a; a = e; }
}
function commit(pid, now = Date.now()) {
  const r = D.run[pid];
  if (!r) return;
  if (now > r.last) addSpan(pid, r.last, now);
  r.last = now;
}

// ------------------------------------------------------------------ budget maths
/** Minutes allowed on the day of `t` (without bonus). */
export const baseBudget = (p, t = Date.now()) => +(p.budget?.[new Date(t).getDay()] ?? 90);
export const runOf = (pid) => (loaded ? D.run : ptData().run || {})[pid] || null;
export const isRunning = (pid) => !!runOf(pid);
/** Played (ms) on day `key` (today includes the running session). */
export function usedOn(pid, key = dayKey(), now = Date.now()) {
  let ms = peekDay(pid, key)?.used || 0;
  const r = runOf(pid);
  if (r && key === dayKey(now)) ms += Math.max(0, now - Math.max(r.last, dayStart(now)));
  else if (r && key === dayKey(now - DAY) && r.last < dayStart(now)) ms += dayStart(now) - r.last;   // not yet committed across midnight
  return ms;
}
const mins = (hm) => (hm ? hm.h * 60 + hm.m : 0);
/** Is `t` in the player's quiet hours (bedtime → wake-up)? */
export function inQuiet(p, t = Date.now()) {
  if (!p.bed) return false;
  const d = new Date(t), m = d.getHours() * 60 + d.getMinutes(), b = mins(p.bed), w = mins(p.wake || { h: 7, m: 0 });
  return b > w ? m >= b || m < w : m >= b && m < w;
}
/** ms until the next bedtime (0 inside quiet hours, Infinity with none). */
export function untilBed(p, t = Date.now()) {
  if (!p.bed) return Infinity;
  if (inQuiet(p, t)) return 0;
  const d = new Date(t);
  let at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), p.bed.h, p.bed.m).getTime();
  if (at <= t) at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, p.bed.h, p.bed.m).getTime();
  return at - t;
}
/**
 * Everything the screen and the warnings need for a player right now.
 * left: what's left (ms, negative = over) — the smallest of the day's budget, the session limit and bedtime (+ grace).
 */
export function status(p, now = Date.now()) {
  const M = MIN(), key = dayKey(now), day = peekDay(p.id, key) || { used: 0, bonus: 0, grace: 0 };
  const r = runOf(p.id);
  const used = usedOn(p.id, key, now);
  const budget = (baseBudget(p, now) + (day.bonus || 0)) * M;
  const grace = (day.grace || 0) * M;
  const session = r ? now - r.since : 0;
  const lefts = [{ why: 'budget', ms: budget - used }];
  if (p.session) lefts.push({ why: 'session', ms: r ? p.session * M - session : p.session * M });
  if (p.bed) lefts.push({ why: 'bed', ms: untilBed(p, now) });
  const lim = lefts.reduce((a, b) => (b.ms < a.ms ? b : a));
  return { p, running: !!r, run: r, used, budget, bonus: day.bonus || 0, grace: day.grace || 0, session, why: lim.why,
    left: lim.ms + grace, budgetLeft: budget - used, quiet: inQuiet(p, now) };
}
/** green → amber → red, by minutes left. */
export function levelOf(leftMs) { const m = leftMs / MIN(); return m <= 0 ? 'over' : m <= 5 ? 'red' : m <= 15 ? 'amber' : 'ok'; }

// ------------------------------------------------------------------ sessions
export function startSession(pid, { auto = null, game = '' } = {}) {
  load();
  if (D.run[pid] || !profileById(pid)) return;
  const now = Date.now();
  D.run[pid] = { since: now, last: now, auto, game };
  persist(); events.emit('change');
  startPlaytime();
}
export function stopSession(pid, at = Date.now()) {
  load();
  if (!D.run[pid]) return;
  commit(pid, Math.max(D.run[pid].last, at));
  delete D.run[pid];
  persist(); events.emit('change');
}
export function grantBonus(pid, minutes) {
  load();
  const d = dayRec(pid);
  d.bonus = Math.max(0, (d.bonus || 0) + minutes);
  persist(); events.emit('change');
}
export function clearBonus(pid) { load(); dayRec(pid).bonus = 0; persist(); events.emit('change'); }
/** "Saving? +5 min": once a day, a few minutes past whatever the limit was. */
export function graceUsed(pid) { return !!peekDay(pid)?.grace; }
function addGrace(pid, minutes = 5) { load(); dayRec(pid).grace = (dayRec(pid).grace || 0) + minutes; persist(); events.emit('change'); }

// ------------------------------------------------------------------ history
export function dayInfo(p, t) {
  const key = dayKey(t), rec = peekDay(p.id, key) || {};
  const used = usedOn(p.id, key);
  const budget = (baseBudget(p, t) + (rec.bonus || 0) + (rec.grace || 0)) * MIN();
  const before = dayStart(t) < dayStart(p.created || 0);   // the player didn't exist yet
  return { key, t, used, budget, bonus: rec.bonus || 0, ok: used <= budget, before };
}
/** { current, best } — days in a row within budget (today counts while it's within; days before the player existed don't). */
export function streaks(p, now = Date.now()) {
  const first = dayStart(p.created || now);
  let current = 0, best = 0, run = 0, broken = false;
  for (let i = 0; i < 180; i++) {
    const t = daysAgo(i, now);
    if (dayStart(t) < first) break;
    const ok = dayInfo(p, t).ok;
    if (!broken) { if (ok) current++; else broken = true; }
    run = ok ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, best };
}

// ------------------------------------------------------------------ auto-detect (PlayStation / Steam presence)
const watching = new Map();   // svcId → { svc, off, miss }
export function linkedProfile(svcId) { return profiles().find((p) => p.links?.includes(svcId)) || null; }
function syncWatch() {
  if (!started) return;
  for (const { id } of SVCS) {
    const want = !!linkedProfile(id);
    let w = watching.get(id);
    if (want && !w) {
      const svc = provider(id);
      if (!svc || !svc.isAuthed?.()) continue;           // signed in later → picked up by the next sync
      w = { svc, miss: 0, off: svc.on('change', () => onPresence(id)) };
      watching.set(id, w);
      svc.start();                                       // shares the service's polite poll (one loop for every screen)
      onPresence(id);
    } else if (!want && w) {
      w.off(); w.svc.stop(); watching.delete(id);
    }
  }
}
/** What the service says is being played right now: { name } | null (in a game) — undefined when it doesn't know. */
export function presenceOf(svcId) {
  const svc = provider(svcId);
  if (!svc?.data || svc.error) return undefined;
  return svc.data.now ? { name: svc.data.now.name || 'a game', platform: svc.data.now.platform || '' } : null;
}
function onPresence(id) {
  const w = watching.get(id);
  if (!w || w.svc.loading) return;
  const p = linkedProfile(id);
  if (!p) return;
  const now = presenceOf(id);
  if (now === undefined) return;
  const r = D.run[p.id];
  if (now) {
    w.miss = 0;
    if (!r) startSession(p.id, { auto: id, game: now.name });
    else if (r.game !== now.name && (r.auto === id || !r.game)) { r.game = now.name; persist(); events.emit('change'); }
  } else if (r?.auto === id) {
    // stopped playing: wait for a second answer (a blip in the presence shouldn't end the session)
    const t = Date.now();
    if (!w.miss) w.miss = t;
    else if (t - w.miss >= Math.min(30000, MIN() / 2)) { stopSession(p.id, w.miss); w.miss = 0; }
  }
}

// ------------------------------------------------------------------ warnings
let current = null;          // { pid, th, ring }
let countdown = 0;
export const alerting = () => current;
function closeAlert() {
  if (!current) return;
  const c = current; current = null;
  clearInterval(countdown); clearTimeout(c.auto);
  c.ring?.close({ pause: false });
}
const fmtLeft = (ms) => { const m = Math.round(Math.abs(ms) / MIN()); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`; };
const WHY = { budget: 'today', session: 'in this session', bed: 'until bedtime' };
function texts(p, th, st) {
  const n = p.name;
  if (th > 0) return { title: `${n}: ${th} minutes left`, message: `${n} has ${th} minutes of play time left ${WHY[st.why]}.`, big: `${th} min` };
  if (th === 0) {
    if (st.why === 'bed') return { title: `Bedtime, ${n}!`, message: `It's bedtime — time to stop playing, ${n}.`, big: 'Bedtime' };
    if (st.why === 'session') return { title: `Time for a break, ${n}`, message: `${n}'s session is over — time for a break.`, big: '0:00' };
    return { title: `Time's up, ${n}!`, message: `${n}'s play time for today is up.`, big: '0:00' };
  }
  return { title: `${n} is still playing`, message: `${n} is ${-th} minutes over the play time.`, big: `+${-th} min` };
}
function relabel(r, sel, ic, text) {
  const b = r.el.querySelector(sel);
  if (!b) return;
  const i = b.querySelector('i');
  if (i && ic) i.innerHTML = ic;
  b.lastChild.textContent = text;
}
const ICON_OK = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
const ICON_PAD = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h10a5 5 0 0 1 4.9 6l-.9 4.4a2.6 2.6 0 0 1-4.6 1.1L14.6 15H9.4l-1.8 2.5A2.6 2.6 0 0 1 3 16.4L2.1 12A5 5 0 0 1 7 6zm0 3v1.5H5.5v2H7V14h2v-1.5h1.5v-2H9V9z"/></svg>';

function fire(p, th, st) {
  closeAlert();
  const t = texts(p, th, st);
  const level = th > 0 ? 'warn' : 'alarm';
  // ring() (clock-ring.js) shows the overlay on any screen and calls notify() from js/core/alerts.js with these
  // (source 'playtime': lights / speakers / phone, as set up in Settings → Alerts); closing it calls stopAlert()
  const alertOpts = { source: 'playtime', message: t.message, level };
  const me = { pid: p.id, th, ring: null, auto: 0 };
  current = me;
  events.emit('alert', { pid: p.id, th, title: t.title, level });
  const color = th > 5 ? '#f59e0b' : '#ef4444';
  if (th > 0) {
    // a heads-up: a gentle chime, OK, closes by itself
    me.ring = ring({ ...alertOpts, time: t.big, title: t.title, color, icon: 'clock', what: { what: 'sound', sound: 'chime' },
      onClose: () => { if (current === me) closeAlert(); } });
    relabel(me.ring, '.rk-stop', ICON_OK, 'OK');
    me.auto = setTimeout(() => { if (current === me) closeAlert(); }, 30000);
    return;
  }
  // time's up (or still playing): optionally pause the music, then offer "Saving? +5 min" and maybe rest the PS5
  if (th === 0 && p.pauseMusic) { try { if (player.state?.isPlaying) player.pause(); } catch {} }
  const ps = provider('playstation');
  const canRest = th === 0 && p.restPs && (p.links?.includes('playstation') || st.run?.auto === 'playstation') && !!ps?.power && ps.power.state !== 'standby';
  const grace = th === 0 && !graceUsed(p.id);
  const opts = { ...alertOpts, time: t.big, title: t.title, color, icon: 'clock', what: { what: 'sound', sound: th === 0 ? 'marimba' : 'beeps' },
    onClose: () => { if (current === me) closeAlert(); } };
  if (grace) Object.assign(opts, { snooze: canRest ? 'Saving? +5' : '+5 min', snoozeIcon: 'plus', onSnooze: () => { addGrace(p.id, 5); closeAlert(); } });
  if (canRest) {
    opts.onStop = () => restNow(ps);
    opts.title = `${{ bed: 'Bedtime', session: 'Break time' }[st.why] || 'Time’s up'} · PS5 rests in`;
    me.ring = ring(opts);
    relabel(me.ring, '.rk-stop', null, 'Rest now');
    // a 60 s countdown, then the console goes to rest mode (shorter with the test option)
    let n = Math.max(3, Math.round(MIN() / 1000));
    const mmss = (s) => `${Math.floor(s / 60)}:${pad(s % 60)}`;
    me.ring.setTime(mmss(n));
    countdown = setInterval(() => {
      if (current !== me) { clearInterval(countdown); return; }
      n--;
      me.ring.setTime(mmss(Math.max(0, n)));
      if (n <= 0) { clearInterval(countdown); restNow(ps); closeAlert(); }
    }, 1000);
  } else {
    opts.onStop = () => { const r = D.run[p.id]; if (th === 0 && r && !r.auto) stopSession(p.id); };
    me.ring = ring(opts);
    relabel(me.ring, '.rk-stop', null, th === 0 && st.run && !st.run.auto ? 'Stop' : 'OK');
  }
}
async function restNow(ps) {
  try { await ps.setPower('standby'); events.emit('rest'); } catch (e) { console.warn('[playtime] rest mode failed', e); }
}
/** Check one player's warnings. */
function checkWarn(p, now) {
  const st = status(p, now);
  const key = dayKey(now);
  let f = D.fired[p.id];
  if (!f || f.day !== key) f = D.fired[p.id] = { day: key, marks: [] };
  const M = MIN();
  // re-arm warnings when time was added (a bonus) — so "15 minutes left" comes again later
  const before = f.marks.length;
  f.marks = f.marks.filter((th) => st.left <= th * M + M / 2);
  if (!st.running) { if (f.marks.length !== before) persist(); return; }
  const due = WARN_AT.filter((th) => st.left <= th * M && !f.marks.includes(th));
  if (!due.length) { if (f.marks.length !== before) persist(); return; }
  // only the most urgent one rings (starting with 3 min left gives "5 min", not "15" too)
  const th = Math.min(...due);
  for (const x of WARN_AT) if (x >= th && !f.marks.includes(x)) f.marks.push(x);
  persist();
  fire(p, th, st);
}

// ------------------------------------------------------------------ the loop
let started = false, ticks = 0;
export function startPlaytime() {
  load();
  if (started) return;
  started = true;
  syncWatch();
  setInterval(tick, 1000);
  addEventListener('pagehide', () => { for (const pid of Object.keys(D.run)) commit(pid); persist(); });
}
function tick() {
  const now = Date.now();
  ticks++;
  for (const p of profiles()) checkWarn(p, now);
  // the presence of a linked console: end an auto session the service lost track of (bridge gone) after 3 min
  for (const [pid, r] of Object.entries(D.run)) {
    if (!r.auto) continue;
    const w = watching.get(r.auto);
    if (!w) continue;
    const at = w.svc.data?.at || 0;
    if (w.svc.error && now - Math.max(at, r.since) > 180000) stopSession(pid, Math.max(r.last, at || r.since));
  }
  if (ticks % 15 === 0 && Object.keys(D.run).length) { for (const pid of Object.keys(D.run)) commit(pid, now); persist(); }
  if (ticks % 30 === 0) syncWatch();
}
/** Should main.js start the engine at boot? (a session is running or a console is linked) */
export function wanted() { const d = ptData(); return !!(Object.keys(d.run || {}).length || (d.profiles || []).some((p) => p.links?.length)); }
export { closeAlert as dismissAlert };
