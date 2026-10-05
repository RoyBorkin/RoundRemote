// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The display side of a companion Pi (bridge/lib/companion.js): this screen is served by a Pi whose bridge passes
// everything on to a Round Remote server (the Docker container on the NAS). Here:
//   • the companion's state (GET /api/companion/status + the SSE stream /api/companion/events) — role, server, online
//   • the round "Server offline" overlay while the server can't be reached (the companion's own page in an iframe:
//     /companion/offline?embed=1 — Retry, Wi-Fi, server address…); also raised at once when any answer carries the
//     companion's X-RR-Offline header; it goes away by itself when the server is back
//   • a small status dot on Home (serverDot())
//   • a snapshot of the theme in localStorage (rr.offlineTheme) so the offline page — served without the app's CSS —
//     looks like the app
//   • Reduce effects on by default on a low-memory Pi (Pi Zero 2 W: /api/system/info → lowPower), once — the user
//     can turn it off again
// Only on the device's own origin (the Pi kiosk at http://127.0.0.1:8765/); a no-op on GitHub Pages and on servers.
import { store } from './store.js';
import { Emitter } from './util.js';
import { themeEvents, currentTheme } from './theme.js';

export const companionEvents = new Emitter();   // 'status' (status)
let status = null, es = null, started = false, overlay = null, offSince = 0, dismissedAt = 0;

/** May this page talk to a companion on its own origin? */
const ownOrigin = () => /^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname);
/** The last companion status (null = no companion here, or not known yet). */
export const companionStatus = () => status;
/** This display goes through a Round Remote server right now. */
export const viaServer = () => !!status?.enabled;

/** GET /api/companion/status (null when this origin has none). */
export async function fetchStatus() {
  if (!ownOrigin()) return null;
  try {
    const r = await fetch('/api/companion/status', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (j && typeof j === 'object' && 'available' in j) { setStatus(j); return j; }
  } catch {}
  return null;
}
/** POST /api/companion/<what>. Throws Error(message) with .body/.status on failure. */
export async function companionPost(what, body = {}, ms = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`/api/companion/${what}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok || j?.ok === false) throw Object.assign(new Error(j?.error || `HTTP ${r.status}`), { body: j, status: r.status });
    if (j && 'available' in j) setStatus(j);
    return j;
  } catch (e) { if (e.name === 'AbortError') throw Object.assign(new Error('No answer in time'), { status: 0 }); throw e; } finally { clearTimeout(t); }
}
/** GET /api/companion/discover → [{ name, url, address, port, role, version, self }] */
export async function findServers() {
  const r = await fetch('/api/companion/discover', { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ((await r.json())?.servers || []).filter((s) => !s.self);
}

function setStatus(s) {
  const was = status;
  status = s;
  companionEvents.emit('status', s);
  if (!s.enabled) { hideOverlay(); return; }
  if (s.state === 'offline' || (!s.server && s.mode === 'light')) {
    if (!offSince) offSince = Date.now();
    if (!dismissedAt) showOverlay();
  } else if (s.online) {
    const long = offSince && Date.now() - offSince > 120000;
    offSince = 0; dismissedAt = 0;
    if (overlay) { hideOverlay(); if (long && was && !was.online) setTimeout(() => location.reload(), 300); }   // a long gap: start fresh
  }
}

// ---------------------------------------------------------------- the overlay
const CSS = `
#app .cmp-ov { position: absolute; inset: 0; z-index: 9000; border-radius: 50%; overflow: hidden; background: var(--bg, #000); animation: cmp-in .35s ease both; }
#app .cmp-ov iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; }
@keyframes cmp-in { from { opacity: 0; } }
.cmp-dot { display: inline-block; width: .9em; height: .9em; margin-left: .5em; border-radius: 50%; vertical-align: .05em; background: var(--c1, #1ed760); box-shadow: 0 0 0 .18em rgb(var(--ink, 255 255 255) / .08); }
.cmp-dot.off { background: #ff9f43; animation: cmp-pulse 1.6s ease-in-out infinite; }
.cmp-dot.chk { background: rgb(var(--ink, 255 255 255) / .4); }
#app.lite .cmp-dot.off { animation: none; }
@keyframes cmp-pulse { 50% { opacity: .45; } }
`;
function ensureCss() {
  if (document.getElementById('cmp-css')) return;
  document.head.append(Object.assign(document.createElement('style'), { id: 'cmp-css', textContent: CSS }));
}
function showOverlay() {
  if (overlay) return;
  const app = document.getElementById('app');
  if (!app) return;
  ensureCss();
  overlay = document.createElement('div');
  overlay.className = 'cmp-ov';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Server offline');
  const f = document.createElement('iframe');
  f.src = '/companion/offline?embed=1';
  f.title = 'Server offline';
  overlay.append(f);
  app.append(overlay);
  setTimeout(() => { try { f.focus(); } catch {} }, 400);
}
function hideOverlay() { overlay?.remove(); overlay = null; }
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.rr !== 'companion') return;
  if (e.data.dismiss) { dismissedAt = Date.now(); hideOverlay(); }
  if (e.data.online) fetchStatus();
});

/** A small dot (online / offline) for Home, shown only while this display goes through a server. */
export function serverDot() {
  ensureCss();
  const el = document.createElement('span');
  el.className = 'cmp-dot';
  const paint = (s = status) => {
    el.hidden = !s?.enabled;
    if (!s?.enabled) return;
    el.className = `cmp-dot${s.online ? '' : s.state === 'checking' ? ' chk' : ' off'}`;
    const where = String(s.server || '').replace(/^https?:\/\//, '');
    el.title = s.online ? `Round Remote server ${where} · ${s.latencyMs ?? '?'} ms` : `Server ${where} offline`;
    el.setAttribute('aria-label', el.title);
  };
  paint();
  const off = companionEvents.on('status', (s) => { if (!el.isConnected && el.dataset.seen) { off(); return; } if (el.isConnected) el.dataset.seen = '1'; paint(s); });
  return el;
}

// ---------------------------------------------------------------- start
function saveTheme() {
  try {
    const t = currentTheme();
    const ink = (t.inkRgb || []).join(' ');
    localStorage.setItem('rr.offlineTheme', JSON.stringify({ id: t.id, mode: t.mode, bg: t.bg, bg2: t.bg2, surface: t.surface, ink, c1: t.c1, onC1: t.onC1, font: t.font }));
  } catch {}
}

/** Called once from main.js. */
export async function startCompanion() {
  if (started || !ownOrigin()) return;
  started = true;
  saveTheme();
  themeEvents.on('change', saveTheme);
  // Reduce effects by default on a small Pi (once; the user's own choice wins afterwards)
  import('./device.js').then((d) => d.systemInfo()).then((info) => {
    if (info?.lowPower && !store.get('lowPowerApplied')) { store.set('lowPowerApplied', true); if (!store.get('liteMode')) store.set('liteMode', true); }
  }).catch(() => {});
  const s = await fetchStatus();
  if (!s?.available) return;
  // the companion's 502s carry X-RR-Offline: show the overlay at once, without waiting for the next check
  const orig = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const r = await orig(...args);
    try { if (status?.enabled && r.headers.get('x-rr-offline') && !overlay && !dismissedAt) fetchStatus(); } catch {}
    return r;
  };
  const listen = () => {
    es = new EventSource('/api/companion/events');
    es.onmessage = (ev) => { try { setStatus(JSON.parse(ev.data)); } catch {} };
    // the companion itself restarting (an update): EventSource reconnects by itself
  };
  listen();
}
