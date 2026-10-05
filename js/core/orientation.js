// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Screen orientation: turn the whole app (#app, the round screen) so it stays upright when the display is turned.
//   modes   off | 90 (every 90°) | 45 (every 45°) | free (follows the angle smoothly)
//   sources pi     — the Pi's motion sensor (IMU) through the bridge: SSE /api/system/imu → { roll, pitch, heading?, angle? }
//           motion — this phone's / tablet's own sensor (DeviceMotion; iOS asks for permission on a tap)
//           manual — the rotate buttons in Settings (±45° / ±90°)
// The snapped modes switch only when the angle is clearly past the half-way point (hysteresis) and animate; Free
// smooths the angle (low-pass) and, with Reduce effects / Battery saver, updates at most 15 times a second without
// animation. A new angle waits while a finger is on the screen, so a drag never turns under the finger.
// Pointer maths that compares clientX/Y with element positions uses toLocal() / localRect() (core/util.js).
import { store, isLite } from './store.js';
import { Emitter, frame, toLocal, localRect, frameDeg } from './util.js';
import { stream, systemInfo, ensureCss } from './device.js';

export { toLocal, localRect, frameDeg };
export const orientation = new Emitter();   // 'change' (status) whenever the angle or the source state changes

export const ORIENT_MODES = [{ id: 'off', name: 'Off' }, { id: '90', name: 'Every 90°' }, { id: '45', name: 'Every 45°' }, { id: 'free', name: 'Free' }];
export const ORIENT_SOURCES = [{ id: 'pi', name: 'Pi sensor' }, { id: 'motion', name: 'This device' }, { id: 'manual', name: 'Manual' }];
const HYST = { 90: 15, 45: 10 };   // degrees beyond the half-way point before the next step
const TAU = 0.18;                  // Free: low-pass time constant (s)

const norm = (a) => ((((a + 180) % 360) + 360) % 360) - 180;   // → -180 … 180
const S = {
  app: null, started: false,
  applied: 0,          // the rotation on #app (unwrapped, so an animation always takes the short way)
  step: 0,             // snapped modes: the current step (content degrees)
  smooth: null, smoothAt: 0, lastFree: 0,
  dev: null,           // last raw sensor angle (before offset), degrees clockwise
  content: 0,          // what the content should be turned by now (before snapping/pausing)
  pending: null,       // an angle waiting for the fingers to lift
  pointers: new Set(),
  close: null,         // stops the current source
  live: false, error: '', at: 0, chip: '',
};

/** Current state, for Settings. */
export function orientState() {
  return {
    mode: store.get('orientMode'), source: store.get('orientSource'), deg: norm(S.applied), live: S.live, error: S.error,
    sensor: S.dev == null ? null : norm(S.dev), at: S.at, paused: S.pending != null, chip: S.chip || '',
  };
}

// ------------------------------------------------------------------ applying
function apply(deg) {
  const app = S.app; if (!app) return;
  const mode = store.get('orientMode');
  if (S.pointers.size && mode !== 'off') { S.pending = deg; return; }
  S.pending = null;
  const next = S.applied + norm(deg - S.applied);
  const free = mode === 'free';
  if (Math.abs(next - S.applied) < (free ? 0.4 : 0.01) && app.style.rotate) return;
  S.applied = next;
  app.classList.toggle('rot-anim', !free);
  app.classList.toggle('rot-free', free && !isLite());
  if (Math.abs(norm(next)) < 0.01 && mode === 'off') {
    // back upright and off: drop the transform once the animation is done (no rotation cost at all)
    app.style.rotate = `${next}deg`;
    clearTimeout(S.clearT);
    S.clearT = setTimeout(() => { if (store.get('orientMode') === 'off' && Math.abs(norm(S.applied)) < 0.01) { app.classList.remove('rot-anim', 'rot-free', 'rot-odd', 'rot-oblique'); app.style.rotate = ''; S.applied = 0; frame.active = false; delete app.dataset.rot; } }, 700);
  } else {
    clearTimeout(S.clearT);
    frame.active = true;
    app.style.rotate = `${next.toFixed(free ? 1 : 2)}deg`;
  }
  app.dataset.rot = String(Math.round(norm(next)));
  const odd = Math.round(norm(next)) % 180 !== 0;
  if (odd && !app.classList.contains('rot-odd')) panFix();
  app.classList.toggle('rot-odd', odd);
  // off the 90° grid (a class for styles; the circle clip is #app's own border-radius + overflow, see css/device.css)
  app.classList.toggle('rot-oblique', Math.round(norm(next)) % 90 !== 0);
  orientation.emit('change', orientState());
}

// Browsers judge touch-action (pan-y lists, pan-x strips) along the SCREEN's axes: turned 90° or 45°, a list's
// own up/down is sideways on the screen and the finger couldn't scroll it. While turned like that, every rule
// that allows only pan-x or pan-y also allows the other axis (the scroller still scrolls along its own axis).
let panObs = null;
function panFix() {
  const sels = new Set();
  const walk = (rules) => {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) { try { walk(r.cssRules); } catch {} continue; }
      const ta = r.style?.touchAction;
      if ((ta === 'pan-x' || ta === 'pan-y') && r.selectorText) sels.add(r.selectorText);
    }
  };
  for (const sh of document.styleSheets) { if (sh.ownerNode?.id === 'rr-panfix') continue; try { walk(sh.cssRules); } catch {} }
  let el = document.getElementById('rr-panfix');
  if (!el) { el = document.createElement('style'); el.id = 'rr-panfix'; document.head.append(el); }
  el.textContent = sels.size ? `#app.rot-odd :is(${[...sels].join(', ')}) { touch-action: pan-x pan-y !important; }` : '';
  // apps add their own styles later: refresh then (only while turned)
  if (!panObs) {
    let t = 0;
    panObs = new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeName === 'LINK') n.addEventListener('load', () => { if (S.app?.classList.contains('rot-odd')) panFix(); }, { once: true });
      if (!S.app?.classList.contains('rot-odd') || ms.every((m) => [...m.addedNodes].every((n) => n.id === 'rr-panfix' || !/^(STYLE|LINK)$/.test(n.nodeName)))) return;
      clearTimeout(t); t = setTimeout(panFix, 300);
    });
    panObs.observe(document.head, { childList: true });
  }
}

/** Work out the content angle for the mode and apply it. `content` = degrees to turn the app (clockwise). */
function decide(content, { explicit = false } = {}) {
  S.content = content;
  const mode = store.get('orientMode');
  if (mode === 'off') return apply(0);
  if (mode === 'free') {
    const now = performance.now();
    if (explicit || S.smooth == null) S.smooth = content;
    else {
      const dt = Math.min(1, (now - (S.smoothAt || now)) / 1000);
      S.smooth = norm(S.smooth + (1 - Math.exp(-dt / TAU)) * norm(content - S.smooth));
    }
    S.smoothAt = now;
    if (!explicit && isLite() && now - S.lastFree < 1000 / 15) return;   // ≤ 15 Hz when saving
    S.lastFree = now;
    return apply(S.smooth);
  }
  const step = Number(mode) || 90;
  const d = norm(content - S.step);
  if (explicit || Math.abs(d) > step / 2 + (HYST[step] || 10)) S.step = norm(Math.round(content / step) * step);
  apply(S.step);
}

// ------------------------------------------------------------------ sources
const rev = () => (store.get('orientReverse') ? -1 : 1);
/** A device angle (degrees the screen is turned clockwise) → content angle. */
function onSample(dev) {
  if (!Number.isFinite(dev)) return;
  S.dev = dev; S.at = Date.now();
  if (!S.live || S.error) { S.live = true; S.error = ''; orientation.emit('change', orientState()); }
  const fresh = S.fresh; S.fresh = false;
  decide(-rev() * norm(dev - (Number(store.get('orientOffset')) || 0)), { explicit: fresh });
}

function startPi() {
  S.error = ''; S.live = false;
  let stop = null, cancelled = false;
  systemInfo().then((info) => {
    if (cancelled) return;
    // no sensor (caps.imu false → /api/system/imu answers 404): say so instead of retrying a stream that can't open
    if (!info.caps?.imu) { S.error = info.pi ? 'No motion sensor found on the Pi' : 'Needs the Round Remote Pi (bridge with a motion sensor)'; orientation.emit('change', orientState()); return; }
    S.chip = info.caps?.imuChip || '';
    // samples: { roll, pitch, heading?, angle?, ts } — `angle` (the bridge's configured plane, offset and direction) wins
    stop = stream('imu', (d) => {
      const axis = store.get('orientAxis') || 'roll';
      onSample(Number.isFinite(d.angle) ? d.angle : Number(d[axis]));
    }, (st) => {
      if (st === 'error' && !S.error) { S.live = false; S.error = 'Sensor stream lost — retrying…'; orientation.emit('change', orientState()); }
      if (st === 'open' && /stream lost/.test(S.error)) { S.error = ''; orientation.emit('change', orientState()); }
    }, {
      // `event: sensor` status lines: { ready, chip } when the helper found the chip, { error } when it gave up
      sensor: (d) => {
        if (d.chip) S.chip = String(d.chip);
        if (d.error) { S.live = false; S.error = `Motion sensor: ${d.error}`; }
        else if (d.ready && S.error) S.error = '';
        orientation.emit('change', orientState());
      },
    });
  });
  return () => { cancelled = true; stop?.(); };
}

const isIOS = () => typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
const screenAngle = () => Number(screen.orientation?.angle ?? window.orientation ?? 0) || 0;
/** This phone's / tablet's sensor: gravity in the screen's plane gives how far it is turned. */
function startMotion() {
  S.error = ''; S.live = false;
  if (typeof window.DeviceMotionEvent === 'undefined' && typeof window.DeviceOrientationEvent === 'undefined') {
    S.error = 'This browser has no motion sensor'; orientation.emit('change', orientState());
    return () => {};
  }
  const onMotion = (e) => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    const ios = isIOS();
    const x = ios ? -g.x : g.x, y = ios ? -g.y : g.y;
    if (Math.hypot(x, y) < 3) return;   // lying flat: keep the last angle
    onSample(norm((Math.atan2(-x, y) * 180) / Math.PI - screenAngle()));
  };
  window.addEventListener('devicemotion', onMotion);
  const t = setTimeout(() => { if (!S.live) { S.error = 'No motion data yet — this device may not have a sensor, or permission is needed'; orientation.emit('change', orientState()); } }, 3000);
  return () => { clearTimeout(t); window.removeEventListener('devicemotion', onMotion); };
}

/** iOS: ask for motion access. Call from a tap (a user gesture). Resolves true when allowed. */
export async function requestMotionPermission() {
  try {
    if (isIOS()) return (await DeviceMotionEvent.requestPermission()) === 'granted';
  } catch { return false; }
  return true;
}

function restart() {
  S.close?.(); S.close = null;
  S.live = false; S.error = ''; S.smooth = null; S.fresh = true;
  const mode = store.get('orientMode'), src = store.get('orientSource');
  if (mode === 'off') { apply(0); orientation.emit('change', orientState()); return; }
  if (src === 'pi') S.close = startPi();
  else if (src === 'motion') S.close = startMotion();
  else { S.live = true; decide(Number(store.get('orientManual')) || 0, { explicit: true }); }
  orientation.emit('change', orientState());
}
/** Re-run the current angle through the mode (after a setting changed). */
function recompute() {
  if (store.get('orientMode') === 'off') return;
  if (store.get('orientSource') === 'manual') decide(Number(store.get('orientManual')) || 0, { explicit: true });
  else if (S.dev != null) decide(-rev() * norm(S.dev - (Number(store.get('orientOffset')) || 0)), { explicit: true });
}

// ------------------------------------------------------------------ controls (Settings)
/** Turn the screen by `d` degrees (clockwise). Manual: changes the angle; with a sensor: shifts what counts as upright. */
export function rotateBy(d) {
  const mode = store.get('orientMode');
  if (mode === 'off') store.set('orientMode', Math.abs(d) % 90 ? '45' : '90');
  else if (mode === '90' && Math.abs(d) % 90) store.set('orientMode', '45');
  if (store.get('orientSource') === 'manual') store.set('orientManual', norm((Number(store.get('orientManual')) || 0) + d));
  else store.set('orientOffset', norm((Number(store.get('orientOffset')) || 0) + d * rev()));
}
/** "Set current as upright": the sensor's angle now counts as 0 (manual: back to 0°). */
export function calibrate() {
  if (store.get('orientSource') === 'manual') store.set('orientManual', 0);
  else if (S.dev != null) store.set('orientOffset', norm(S.dev));
  else return false;
  return true;
}

// ------------------------------------------------------------------ start
/** Call once at start-up with #app. */
export function startOrientation(app = document.getElementById('app')) {
  if (S.started || !app) return;
  S.started = true; S.app = app; frame.el = app;
  ensureCss();
  // a finger on the screen holds the angle; it turns once the finger lifts
  const down = (e) => S.pointers.add(e.pointerId);
  const up = (e) => {
    S.pointers.delete(e.pointerId);
    if (!S.pointers.size && S.pending != null) setTimeout(() => { if (!S.pointers.size && S.pending != null) apply(S.pending); }, 250);
  };
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', () => { S.pointers.clear(); if (S.pending != null) apply(S.pending); });
  store.on('change:orientMode', (m) => { const st = Number(m) || 90; S.step = norm(Math.round(S.applied / st) * st); restart(); });
  store.on('change:orientSource', restart);
  ['orientReverse', 'orientOffset', 'orientManual'].forEach((k) => store.on(`change:${k}`, recompute));
  store.on('change', (k) => { if (k === '*') restart(); });
  restart();
}
