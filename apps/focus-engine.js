// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Focus (Pomodoro) engine — module level, so a session keeps running when you leave the app; the phase change
// rings on any screen. main.js starts it at boot when a session is running:
//   import('../apps/focus-engine.js').then((m) => m.startFocus())
//
// Saved in settings.appData.focus:
//   cfg:  { focus, short, long (minutes), every (long break after N focus sessions), auto (start the next phase by itself),
//           chime, music: { kind: 'none' | 'resume' | 'playlist' | 'noise', svc, playlist, noise: [sound ids], pauseOnBreak },
//           lights: { on, ids: [light ids], focus: { kind: 'scene' | 'colour', scene, color, pct }, brk: { … } } }
//   run:  { phase: 'idle' | 'focus' | 'short' | 'long', running, endAt, remain, total, done (focus sessions in this cycle), credited }
//   task: what you're working on · recent: [labels] · days: { 'YYYY-MM-DD': { min, n } }
import { store } from '../js/core/store.js';
import { Emitter } from '../js/core/util.js';
import { player } from '../js/core/player.js';
import { toast } from '../js/ui/overlay.js';
import { notify } from '../js/core/alerts.js';
import { ring, playSound, startWhat } from './clock-ring.js';
import { sceneOn, lightsColour, snapLights, restoreLights } from './plants-ha.js';

export const COLOR = '#f43f5e';
export const PHASES = {
  idle: { name: 'Ready', color: COLOR },
  focus: { name: 'Focus', color: COLOR },
  short: { name: 'Short break', color: '#14b8a6' },
  long: { name: 'Long break', color: '#6366f1' },
};
export const PRESETS = [{ id: '25', focus: 25, short: 5, long: 15, name: '25 / 5' }, { id: '50', focus: 50, short: 10, long: 20, name: '50 / 10' }, { id: '90', focus: 90, short: 20, long: 30, name: '90 / 20' }];
export const DEFAULT_CFG = Object.freeze({
  focus: 25, short: 5, long: 15, every: 4, auto: false, chime: true,
  music: { kind: 'none', svc: null, playlist: null, noise: ['rain'], pauseOnBreak: true },
  lights: { on: false, ids: [], focus: { kind: 'colour', scene: '', color: '#fff4e0', pct: 90 }, brk: { kind: 'colour', scene: '', color: '#7dd3fc', pct: 50 } },
});
export const events = new Emitter();   // 'tick' · 'change' · 'end' ({ from, to })
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// ------------------------------------------------------------------ data
const fData = () => (store.get('appData') || {}).focus || {};
function save(patch) { const all = store.get('appData') || {}; store.set('appData', { ...all, focus: { ...(all.focus || {}), ...patch } }); }
export function cfg() {
  const c = fData().cfg || {};
  return { ...DEFAULT_CFG, ...c, music: { ...DEFAULT_CFG.music, ...(c.music || {}) }, lights: { ...DEFAULT_CFG.lights, ...(c.lights || {}), focus: { ...DEFAULT_CFG.lights.focus, ...(c.lights?.focus || {}) }, brk: { ...DEFAULT_CFG.lights.brk, ...(c.lights?.brk || {}) } } };
}
export function setCfg(patch) { save({ cfg: { ...cfg(), ...patch } }); emit(); }
const IDLE = { phase: 'idle', running: false, endAt: 0, remain: 0, total: 0, done: 0, credited: 0 };
let R = { ...IDLE };
export const run = () => R;
export const task = () => fData().task || '';
export const recent = () => fData().recent || [];
export function setTask(t) {
  t = String(t || '').trim();
  const rec = t ? [t, ...recent().filter((x) => x !== t)].slice(0, 8) : recent();
  save({ task: t, recent: rec }); emit();
}
export function forgetRecent(t) { save({ recent: recent().filter((x) => x !== t) }); emit(); }
const persist = () => save({ run: R });
function emit() { events.emit('change', R); }

export const phaseMs = (ph, c = cfg()) => Math.max(1000, (ph === 'focus' || ph === 'idle' ? c.focus : ph === 'short' ? c.short : c.long) * 60000);
/** ms left in the current phase. */
export const remaining = (now = Date.now()) => (R.running ? Math.max(0, R.endAt - now) : R.phase === 'idle' ? phaseMs('focus') : R.remain);
export const progress = (now = Date.now()) => { const t = R.total || phaseMs(R.phase); return R.phase === 'idle' ? 0 : Math.max(0, Math.min(1, 1 - remaining(now) / t)); };
/** The phase after this one. */
export function nextPhase(ph = R.phase, done = R.done) {
  if (ph === 'focus') return done > 0 && done % cfg().every === 0 ? 'long' : 'short';
  return 'focus';
}

// ------------------------------------------------------------------ stats
export const days = () => fData().days || {};
function credit(ms, session = false) {
  const min = ms / 60000;
  if (min <= 0 && !session) return;
  const d = { ...days() };
  const k = dayKey();
  const cur = d[k] || { min: 0, n: 0 };
  d[k] = { min: Math.round((cur.min + min) * 100) / 100, n: cur.n + (session ? 1 : 0) };
  const cut = dayKey(Date.now() - 400 * 864e5);
  for (const x of Object.keys(d)) if (x < cut) delete d[x];
  save({ days: d });
}
/** Focus minutes on the last 7 days (oldest first): [{ key, min, n, label }]. */
export function week(now = Date.now()) {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
    const k = dayKey(d.getTime()), v = days()[k] || { min: 0, n: 0 };
    out.push({ key: k, min: v.min, n: v.n, label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()], today: i === 0 });
  }
  return out;
}
/** Days in a row with at least one finished focus session (today counts once you've done one). */
export function streak(now = Date.now()) {
  const d = days();
  let n = 0;
  const today = (d[dayKey(now)]?.n || 0) > 0;
  for (let i = today ? 0 : 1; i < 400; i++) {
    const t = new Date(now); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() - i);
    if ((d[dayKey(t.getTime())]?.n || 0) > 0) n++; else break;
  }
  return { current: n, today };
}
export const todayStats = (now = Date.now()) => days()[dayKey(now)] || { min: 0, n: 0 };

// ------------------------------------------------------------------ phase effects (music, lights)
let snap = null, musicOn = false, noiseOn = false;
async function effects(ph) {
  const c = cfg();
  // lights
  if (c.lights.on) {
    try {
      if (ph === 'idle') { if (snap) { const s = snap; snap = null; await restoreLights(s); } }
      else {
        if (!snap && c.lights.ids.length) snap = snapLights(c.lights.ids);
        const L = ph === 'focus' ? c.lights.focus : c.lights.brk;
        if (L.kind === 'scene' && L.scene) await sceneOn(L.scene);
        else if (L.kind === 'colour' && c.lights.ids.length) await lightsColour(c.lights.ids, L.color, L.pct);
      }
    } catch (e) { console.warn('[focus] lights', e); }
  }
  // music
  try {
    const m = c.music;
    if (ph === 'focus') {
      if (m.kind === 'playlist' && m.playlist) { if (!musicOn || !player.state.isPlaying) { await startWhat({ what: 'playlist', svc: m.svc, playlist: m.playlist }); musicOn = true; } }
      else if (m.kind === 'resume') { if (player.provider && !player.state.isPlaying) await player.play(); musicOn = true; }
      else if (m.kind === 'noise') { const N = await import('./noise-engine.js'); if (!N.isPlaying()) N.play(m.noise?.length ? m.noise : ['rain'], { source: 'focus' }); noiseOn = true; }
    } else if (ph === 'idle' || m.pauseOnBreak) {
      if (musicOn) { musicOn = false; if (player.state.isPlaying) await player.pause(); }
      if (noiseOn) { noiseOn = false; const N = await import('./noise-engine.js'); if (N.owner() === 'focus') N.stop({ fade: 3 }); }
    }
  } catch (e) { console.warn('[focus] music', e); }
}

// ------------------------------------------------------------------ controls
function begin(ph) {
  const t = phaseMs(ph);
  R = { ...R, phase: ph, running: true, total: t, remain: t, endAt: Date.now() + t, credited: 0 };
  persist(); emit();
  effects(ph);
}
/** Start / resume. */
export function start() {
  if (R.phase === 'idle') { begin('focus'); return; }
  if (R.running) return;
  if (R.remain >= R.total || !R.total) { begin(R.phase); return; }   // a phase that's ready → its effects too
  R = { ...R, running: true, endAt: Date.now() + R.remain };
  persist(); emit();
}
export function pause() {
  if (!R.running) return;
  R = { ...R, running: false, remain: Math.max(0, R.endAt - Date.now()) };
  persist(); emit();
}
export const toggle = () => (R.running ? pause() : start());
/** Skip to the next phase (focus time so far still counts). */
export function skip() {
  if (R.phase === 'idle') return;
  creditPartial();
  const from = R.phase;
  const to = from === 'focus' ? nextPhase('focus', R.done + 1) : 'focus';
  if (from === 'focus') R = { ...R, done: R.done + 1 };
  if (from === 'long') R = { ...R, done: 0 };
  ready(to);
  events.emit('end', { from, to, skipped: true });
}
/** Back to Ready (the cycle's dots stay unless `cycle`). */
export function reset({ cycle = false } = {}) {
  creditPartial();
  R = { ...IDLE, done: cycle ? 0 : R.done % cfg().every };
  persist(); emit();
  effects('idle');
}
function creditPartial() {
  if (R.phase !== 'focus') return;
  const used = R.total - remaining() - (R.credited || 0);
  if (used > 1000) credit(used);
  R = { ...R, credited: (R.credited || 0) + Math.max(0, used) };
}
/** A phase set up but not started (auto-start off). */
function ready(ph) {
  const t = phaseMs(ph);
  R = { ...R, phase: ph, running: false, total: t, remain: t, endAt: 0, credited: 0 };
  persist(); emit();
  if (ph !== 'focus' && cfg().music.pauseOnBreak) effects(ph);   // music stops when focus time is up
}

// ------------------------------------------------------------------ the clock
let started = false, viewers = 0, ringing = null;
export function viewer(on) { viewers = Math.max(0, viewers + (on ? 1 : -1)); }
export function startFocus() {
  if (started) return;
  started = true;
  const d = fData().run;
  if (d && d.phase) R = { ...IDLE, ...d };
  // a session that ended long ago (page closed) doesn't ring hours later
  if (R.running && R.endAt < Date.now() - 10 * 60000) { R = { ...R, running: false, remain: 0 }; phaseOver(true); }
  setInterval(tick, 250);
}
function tick() {
  if (R.running && Date.now() >= R.endAt) phaseOver();
  events.emit('tick', R);
}
function phaseOver(quiet = false) {
  const from = R.phase;
  if (from === 'focus') {
    const left = R.total - (R.credited || 0);
    credit(Math.max(0, left), true);
    R = { ...R, done: R.done + 1 };
  }
  const to = from === 'focus' ? nextPhase('focus', R.done) : 'focus';
  const c = cfg();
  if (from === 'long') R = { ...R, done: 0 };
  if (c.auto) begin(to); else ready(to);
  events.emit('end', { from, to });
  if (!quiet) announce(from, to, c);
}
const MSG = {
  focus: (to) => ({ title: 'Focus session done', message: to === 'long' ? 'Great work — take a long break.' : 'Nice — time for a short break.' }),
  short: () => ({ title: 'Break’s over', message: 'Back to focus.' }),
  long: () => ({ title: 'Long break over', message: 'Ready for the next round?' }),
};
function announce(from, to, c) {
  const { title, message } = (MSG[from] || MSG.focus)(to);
  const label = to === 'focus' ? 'Start focus' : to === 'long' ? 'Start long break' : 'Start break';
  if (viewers > 0 || c.auto) {
    if (c.chime) { try { playSound(from === 'focus' ? 'chime' : 'marimba', { ramp: false, maxSeconds: 2.4 }); } catch {} }
    try { notify({ title, message, level: 'info', source: 'focus' }).catch(() => null); } catch {}
    if (viewers === 0) toast(`${title} · ${PHASES[to].name}${c.auto ? ' started' : ''}`, { ms: 5000 });
    return;
  }
  // not in the app, nothing starts by itself: ring on any screen (ring() also calls notify())
  ringing?.close({ pause: false, silent: true });
  const hnd = ring({
    time: PHASES[to].name, title, color: PHASES[from === 'focus' ? to : 'focus'].color, icon: 'clock', what: { what: 'sound', sound: from === 'focus' ? 'chime' : 'marimba' },
    source: 'focus', level: 'info', message, snooze: label, snoozeIcon: 'play',
    onSnooze: () => start(), onClose: () => { if (ringing === hnd) ringing = null; },
  });
  ringing = hnd;
  const t = hnd.el.querySelector('.rk-time'); if (t) t.style.fontSize = '9cqmin';
  const stop = hnd.el.querySelector('.rk-stop'); if (stop) stop.lastChild.textContent = 'Later';
  setTimeout(() => { if (ringing === hnd) hnd.close({ pause: false }); }, 45000);
}
/** main.js: start at boot only when a session is on. */
export const wanted = () => { const r = fData().run; return !!(r && r.phase && r.phase !== 'idle'); };
