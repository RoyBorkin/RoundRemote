// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The Raspberry Pi appliance: a small client for the bridge's /api/system/* routes (bridge/lib/system.js) —
// Wi-Fi, Bluetooth, sound, battery, power, screen, updates, restart — plus a cached capability check and an
// SSE helper (the IMU stream). Everything degrades quietly when there is no bridge or it isn't on a Pi:
// info() then says { pi: false, caps: {} } and Settings → Device stays hidden.
import { bridgeBase, bridgeFetch, mayProbe } from '../providers/bridge.js';
import { Emitter } from './util.js';

export const deviceEvents = new Emitter();   // 'info' (info), 'wake'
const NO_INFO = Object.freeze({ pi: false, caps: {} });
let infoCache = null, infoAt = 0, infoJob = null;

/** ?device=1 in the address: show Settings → Device even without a Pi (for testing the screens). */
export const forcedDevice = () => { try { return new URLSearchParams(location.search).get('device') === '1'; } catch { return false; } };

/** Messages for the bridge's precise error codes (bridge/lib/system-net.js mapError). */
export const CODE_TEXT = {
  'wrong-password': 'Wrong password',
  'bad-password': 'Wi-Fi passwords have 8–63 characters',
  'not-found': 'Network not found — is it in range?',
  timeout: 'The network didn’t answer in time',
  denied: 'The Pi didn’t allow the change — run pi/install.sh again',
};
/** The bridge's error code of a failed call ('wrong-password', 'not-found', …) or ''. */
export const errCode = (e) => String(e?.body?.code || '');
export const REMOTE_TEXT = 'Changes can only be made on the round display itself (or set "system": { "allowRemote": true } in the bridge’s config.json)';
/** A readable message for a failed call. */
export function errText(e) {
  if (!e) return 'Something went wrong';
  if (e.status === 403) return e.body?.error && !/only allowed on the display/i.test(e.body.error) ? e.body.error : REMOTE_TEXT;
  if (e.status === 404) return e.body?.error || 'This bridge doesn’t support that yet — update it';
  if (e.status === 429) return 'Too many tries — wait a minute';
  if (CODE_TEXT[errCode(e)]) return CODE_TEXT[errCode(e)];
  return e.body?.error || e.userMessage || (e.name === 'AbortError' ? 'The bridge didn’t answer in time' : e.message) || String(e);
}

/** GET /api/system/info (cached for a minute). Never throws. */
export async function systemInfo({ fresh = false } = {}) {
  if (!fresh && infoCache && Date.now() - infoAt < 60000) return infoCache;
  if (infoJob) return infoJob;
  infoJob = (async () => {
    try {
      if (!mayProbe()) return NO_INFO;   // a public https page with no bridge set up: don't probe localhost
      const base = await bridgeBase();
      if (!base) return NO_INFO;
      lastBase = base;
      const r = await bridgeFetch('/api/system/info', { timeout: 6000 });
      return { ...NO_INFO, ...(r || {}), caps: { ...(r?.caps || {}) } };
    } catch { return NO_INFO; }
  })().then((r) => { infoCache = r; infoAt = Date.now(); infoJob = null; deviceEvents.emit('info', r); return r; });
  return infoJob;
}
/** The last info seen (or null) — synchronous. */
export const cachedInfo = () => infoCache;
/** caps.<name> from the bridge (false when unknown). */
export async function hasCap(name) { return !!(await systemInfo()).caps?.[name]; }
export async function isPi() { return !!(await systemInfo()).pi; }
/**
 * May this screen change the Pi's settings? The bridge accepts changes only from the Pi itself (loopback) unless
 * system.allowRemote is on; it says so in info.writable. (An older bridge: judge by the bridge address.)
 */
export function canWrite(info = infoCache) {
  if (!info?.pi) return false;
  if (typeof info.writable === 'boolean') return info.writable;
  try { return /^(localhost|127\.|\[::1\]$)/.test(new URL(lastBase || location.href).hostname); } catch { return false; }
}
/** This screen IS the Pi (or may act for it): the bridge's screen, battery and power settings belong to it. */
export async function isPiDisplay() { return canWrite(await systemInfo()); }
let lastBase = '';

/** GET /api/system/<path>. Throws (see errText). */
export function sysGet(path, opts = {}) { return bridgeFetch(`/api/system/${path}`, { timeout: 15000, ...opts }); }
/** POST /api/system/<path> with a JSON body. Resolves the reply; a reply of { ok:false, error } throws. */
export async function sysPost(path, body = {}, opts = {}) {
  const r = await bridgeFetch(`/api/system/${path}`, { method: 'POST', json: body, timeout: 30000, ...opts });
  if (r && r.ok === false) throw Object.assign(new Error(r.error || 'Failed'), { body: r });
  return r;
}

/**
 * Server-sent events from the bridge (e.g. stream('imu', fn)). Reconnects with a back-off.
 * onData(obj) for each JSON message; onState('open' | 'error' | 'closed'); events = { name: fn(obj) } for named
 * events (the IMU's `event: sensor` → { ready, chip } or { error }). Returns close().
 */
export function stream(path, onData, onState = () => {}, events = {}) {
  let es = null, closed = false, retry = 1000, t = 0;
  const open = async () => {
    if (closed) return;
    const base = await bridgeBase().catch(() => null);
    if (closed) return;
    if (!base || typeof EventSource === 'undefined') { onState('error'); t = setTimeout(open, (retry = Math.min(retry * 2, 30000))); return; }
    es = new EventSource(`${base}/api/system/${path}`);
    es.onopen = () => { retry = 1000; onState('open'); };
    es.onmessage = (ev) => { let d = null; try { d = JSON.parse(ev.data); } catch { return; } if (d) onData(d); };
    for (const [name, fn] of Object.entries(events)) es.addEventListener(name, (ev) => { let d = null; try { d = JSON.parse(ev.data); } catch { return; } if (d) fn(d); });
    es.onerror = () => {
      onState('error');
      es?.close(); es = null;
      if (!closed) t = setTimeout(open, (retry = Math.min(retry * 2, 30000)));
    };
  };
  open();
  return () => { closed = true; clearTimeout(t); es?.close(); es = null; onState('closed'); };
}

/** Wake the screen (an alarm or timer rings, a touch on the black screen): js/core/power.js does the work. */
export function wake(reason = 'wake') { deviceEvents.emit('wake', reason); }

/** The app's own version (the service-worker cache name, e.g. rr-5.0.0). */
export async function appVersion() {
  try {
    const t = await (await fetch('sw.js', { cache: 'no-store' })).text();
    return (t.match(/VERSION\s*=\s*'([^']+)'/) || [])[1] || '';
  } catch { return ''; }
}

/** css/device.css (rotation, dim and screen-off overlays, Settings → Device) — loaded once, from wherever it's needed first. */
export function ensureCss() {
  if (document.getElementById('device-css')) return;
  const l = document.createElement('link');
  l.id = 'device-css'; l.rel = 'stylesheet'; l.href = new URL('../../css/device.css', import.meta.url).href;
  document.head.append(l);
}
