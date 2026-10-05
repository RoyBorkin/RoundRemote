// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Battery saver, screen-off when idle and the dim overlay.
//
// Battery saver (store saverMode: off | on | auto at ≤ saverAt %) sets store.batterySaver, which the app treats like
// Reduce effects (isLite() in core/store.js: no blur, still Home backgrounds, slower polling) without changing the
// user's own liteMode. On the Pi it also asks the bridge for the chosen system savings (POST /api/system/power:
// CPU governor, Wi-Fi power save, Bluetooth off), shortens the screen-off time and can dim the screen with a black
// overlay (the round panel's backlight is set only by its buttons). The battery comes from the bridge
// (/api/system/battery, every 60 s) or, in a browser, from navigator.getBattery().
//
// Screen off (Pi): after screenOffMin without a touch, key, knob or wheel the HDMI output goes off
// (POST /api/system/screen { on:false }) behind a black overlay. The first touch only wakes the screen — the
// overlay takes it and it never reaches the app. Music playing doesn't keep the screen on; a ringing alarm or
// timer wakes it (apps/clock-ring.js → device.wake()).
import { store, DEFAULTS } from './store.js';
import { Emitter } from './util.js';
import { systemInfo, sysGet, sysPost, deviceEvents, ensureCss, forcedDevice, canWrite } from './device.js';

export const power = new Emitter();   // 'battery' (state) · 'saver' (on) · 'screen' (on) · 'error' (message)
const P = {
  app: null, started: false,
  battery: null,           // { present, percent, charging, plugged, minutesLeft?, source }
  batteryFrom: '',         // 'pi' | 'browser' | ''
  lastInput: Date.now(),
  screenOff: false, offEl: null, dimEl: null,
  posted: null,            // last saver state sent to the bridge
  btOff: false,            // Battery saver turned Bluetooth off (turn it back on afterwards)
  lastError: '',
};

export const saverActions = () => ({ ...DEFAULTS.saverActions, ...(store.get('saverActions') || {}) });
export const batteryState = () => P.battery;
export const batterySource = () => P.batteryFrom;
export const screenIsOff = () => P.screenOff;
export const lastPowerError = () => P.lastError;

/** Minutes without input before the screen goes off (0 = never), with Battery saver's shorter time. */
export function screenOffMinutes() {
  const m = Number(store.get('screenOffMin')) || 0;
  if (store.get('batterySaver') && saverActions().screen) return m ? Math.min(m, 2) : 2;
  return m;
}

// ------------------------------------------------------------------ battery saver
/** Decide whether Battery saver should be on (mode + battery) and store it. */
export function evaluateSaver() {
  const mode = store.get('saverMode');
  let on = !!store.get('batterySaver');
  if (mode === 'on') on = true;
  else if (mode !== 'auto') on = false;
  else {
    const b = P.battery, at = Number(store.get('saverAt')) || 20;
    if (!b || !b.present || !Number.isFinite(b.percent)) on = false;
    else if (b.charging && store.get('saverOffCharging') !== false) on = false;
    else if (b.percent <= at) on = true;
    else if (b.percent >= at + 5) on = false;   // a little hysteresis around the threshold
  }
  if (on !== !!store.get('batterySaver')) store.set('batterySaver', on);
  return on;
}

function applySaver() {
  const on = !!store.get('batterySaver');
  if (on) document.documentElement.dataset.saver = '1'; else delete document.documentElement.dataset.saver;
  P.app?.classList.toggle('saver', on);
  paintDim();
  sendSystem(on);
  power.emit('saver', on);
}

/** Pi: the system side of Battery saver. Only sent when it changes (and not at start-up while off). */
async function sendSystem(on) {
  if (P.posted === on || (P.posted === null && !on)) return;
  const info = await systemInfo();
  // only the Pi's own screen speaks for the Pi (a phone that reaches its bridge must not change its CPU or Wi-Fi)
  if (!info.pi || !info.caps?.power || !canWrite(info)) { P.posted = on; return; }
  const a = saverActions();
  const body = { saver: on, governor: on && a.governor ? 'powersave' : 'ondemand', wifiPowerSave: !!(on && a.wifi) };
  if (on && a.bluetooth) { body.bluetooth = false; P.btOff = true; }
  else if (!on && P.btOff) { body.bluetooth = true; P.btOff = false; }
  try { await sysPost('power', body); P.posted = on; P.lastError = ''; }
  catch (e) { P.lastError = e.body?.error || e.message || 'Couldn’t change the power settings'; power.emit('error', P.lastError); }
}

// ------------------------------------------------------------------ battery
async function pollBattery() {
  try {
    const b = await sysGet('battery', { timeout: 8000 });
    P.battery = b && b.present !== false ? { present: true, ...b, percent: Number(b.percent) } : { present: false, source: b?.source || 'none' };
  } catch { /* keep the last reading */ }
  power.emit('battery', P.battery);
  evaluateSaver();
}
let batteryT = 0;
function startPiBattery() {
  if (P.batteryFrom === 'pi') return;
  P.batteryFrom = 'pi';
  pollBattery();
  batteryT = setInterval(pollBattery, 60000);
}
async function startBattery() {
  // the bridge may come up after the kiosk: switch to its battery as soon as it says it has one
  // (only on the Pi's own screen: a phone that reaches a Pi's bridge keeps its own battery)
  const piBattery = (i) => i.pi && i.caps?.battery && canWrite(i);
  deviceEvents.on('info', (i) => { if (piBattery(i)) startPiBattery(); });
  setTimeout(() => systemInfo({ fresh: true }), 20000);
  const info = await systemInfo();
  if (piBattery(info)) return startPiBattery();
  if (navigator.getBattery) {
    try {
      const bm = await navigator.getBattery();
      if (P.batteryFrom !== 'pi') P.batteryFrom = 'browser';
      const read = () => {
        if (P.batteryFrom === 'pi') return;
        // desktops without a battery report 100 % and charging
        const present = !(bm.level === 1 && bm.charging && bm.dischargingTime === Infinity && bm.chargingTime === 0);
        P.battery = { present, percent: Math.round(bm.level * 100), charging: bm.charging, plugged: bm.charging, minutesLeft: Number.isFinite(bm.dischargingTime) ? Math.round(bm.dischargingTime / 60) : undefined, source: 'browser' };
        power.emit('battery', P.battery);
        evaluateSaver();
      };
      ['levelchange', 'chargingchange', 'dischargingtimechange'].forEach((ev) => bm.addEventListener(ev, read));
      read();
    } catch {}
  }
}
/** Read the battery again now (Settings opens). */
export function refreshBattery() { if (P.batteryFrom === 'pi') return pollBattery(); return Promise.resolve(); }

// ------------------------------------------------------------------ dim overlay (saver + night)
function minutesNow() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function inWindow(from, to, m = minutesNow()) { return from === to ? false : from < to ? m >= from && m < to : m >= from || m < to; }
/** Opacity of the black overlay right now (0 = none). */
export function dimLevel() {
  let o = 0;
  if (store.get('batterySaver') && saverActions().dim) o = Math.max(o, Number(store.get('saverDim')) || 0);
  const n = store.get('nightDim');
  if (n?.on && inWindow(n.from, n.to)) o = Math.max(o, Number(n.level) || 0);
  return Math.min(0.85, o);
}
function paintDim() {
  const o = dimLevel();
  if (!P.dimEl) { if (!o) return; P.dimEl = document.createElement('div'); P.dimEl.className = 'dv-dim'; P.dimEl.setAttribute('aria-hidden', 'true'); document.body.append(P.dimEl); }
  P.dimEl.style.opacity = String(o);
}

// ------------------------------------------------------------------ screen off / wake
let screenCapable = false;
async function canSwitchScreen() {
  // only a yes is remembered: the bridge may start after the kiosk (systemInfo() asks again at most once a minute)
  if (!screenCapable) { const info = await systemInfo(); screenCapable = !!(info.pi && canWrite(info) && (info.caps?.display ?? info.caps?.power)) || forcedDevice(); }
  return screenCapable;
}
/** Turn the screen off now (Settings → Screen → Turn off now, or the idle timer). */
export async function screenOff() {
  if (P.screenOff) return;
  P.screenOff = true;
  if (!P.offEl) {
    const el = document.createElement('div');
    el.className = 'dv-off';
    el.setAttribute('aria-label', 'Screen off — touch to wake');
    // the waking touch stays here: nothing underneath gets it (no pointerdown, pointerup or click)
    const eat = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); };
    el.addEventListener('pointerdown', (e) => { eat(e); wakeScreen('touch', { keepOverlay: true }); });
    el.addEventListener('pointerup', (e) => { eat(e); hideOff(260); });
    el.addEventListener('pointercancel', () => hideOff(260));
    ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'contextmenu'].forEach((t) => el.addEventListener(t, eat, { passive: false }));
    P.offEl = el;
  }
  document.body.append(P.offEl);
  P.offEl.classList.add('on');
  power.emit('screen', false);
  try { await sysPost('screen', { on: false }, { timeout: 8000 }); } catch { return; }
  watchScreen();
}
// While the HDMI output is off the bridge watches the touch screen itself (some compositors stop sending touches to
// Chromium then) and turns it back on: GET /api/system/screen tells us, and the black overlay goes.
let watchT = 0;
function watchScreen() {
  clearTimeout(watchT);
  if (!P.screenOff) return;
  watchT = setTimeout(async () => {
    if (!P.screenOff) return;
    try {
      const r = await sysGet('screen', { timeout: 4000 });
      if (P.screenOff && r?.on === true) { wakeScreen(r.by === 'input' ? 'input' : 'bridge', { post: false }); return; }
    } catch {}
    watchScreen();
  }, 1500);
}
function hideOff(ms = 0) {
  setTimeout(() => {
    if (P.screenOff || !P.offEl) return;
    P.offEl.classList.remove('on');
    P.offEl.remove();
    // a click the browser makes from that touch must not land on what was underneath
  }, ms);
  const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, true), ms + 400);
}
/** Turn the screen back on (a touch, a key, an alarm…). */
export function wakeScreen(reason = 'wake', { keepOverlay = false, post = true } = {}) {
  P.lastInput = Date.now();
  if (!P.screenOff) return;
  P.screenOff = false;
  clearTimeout(watchT);
  P.app?.classList.remove('dim');   // and no dim to tap away first
  if (!keepOverlay) hideOff(0);
  power.emit('screen', true);
  if (post) sysPost('screen', { on: true }, { timeout: 8000 }).catch(() => {});
}

const ringing = () => !!document.querySelector('.rk-ring');
async function tick() {
  paintDim();
  const mins = screenOffMinutes();
  if (!mins || P.screenOff || ringing()) return;
  if (Date.now() - P.lastInput < mins * 60000) return;
  if (await canSwitchScreen()) screenOff();
}

// ------------------------------------------------------------------ start
/** Call once at start-up with #app. */
export function startPower(app = document.getElementById('app')) {
  if (P.started) return;
  P.started = true; P.app = app;
  ensureCss();
  const activity = (e) => {
    P.lastInput = Date.now();
    if (!P.screenOff || e.type === 'pointerdown') return;   // touches go to the overlay
    wakeScreen(e.type);                                     // keys, the knob, the wheel…
    if (e.type === 'keydown') { e.preventDefault(); e.stopImmediatePropagation(); }   // …and that key only wakes it
  };
  window.addEventListener('keydown', activity, { capture: true });
  ['pointerdown', 'wheel'].forEach((ev) => window.addEventListener(ev, activity, { capture: true, passive: true }));
  deviceEvents.on('wake', (r) => wakeScreen(r));
  store.on('change:batterySaver', applySaver);
  store.on('change:saverActions', () => { P.posted = null; applySaver(); });
  store.on('change:saverDim', paintDim);
  store.on('change:nightDim', paintDim);
  ['saverMode', 'saverAt', 'saverOffCharging'].forEach((k) => store.on(`change:${k}`, evaluateSaver));
  store.on('change', (k) => { if (k === '*') { evaluateSaver(); applySaver(); } });
  evaluateSaver();
  applySaver();
  setInterval(tick, 5000);
  startBattery().catch(() => {});
}
