// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Small, dependency-free helpers shared across the app.

export class Emitter {
  constructor() { this._h = new Map(); }
  on(evt, fn) {
    if (!this._h.has(evt)) this._h.set(evt, new Set());
    this._h.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) { this._h.get(evt)?.delete(fn); }
  emit(evt, ...args) {
    for (const fn of [...(this._h.get(evt) || [])]) {
      try { fn(...args); } catch (e) { console.error(`[emit ${evt}]`, e); }
    }
  }
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => performance.now();

export function fmtTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function throttle(fn, ms) {
  let last = 0, t = null, pending = null;
  return (...a) => {
    const n = Date.now();
    pending = a;
    if (n - last >= ms) { last = n; fn(...a); pending = null; }
    else if (!t) {
      t = setTimeout(() => { t = null; last = Date.now(); if (pending) fn(...pending); pending = null; }, ms - (n - last));
    }
  };
}

export function uid(len = 16) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

export function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return [...a].map((b) => chars[b % chars.length]).join('');
}

export async function sha256base64url(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** fetch with timeout; throws HttpError on non-2xx. Returns parsed JSON, text, or null (204). */
export class HttpError extends Error {
  constructor(status, body, url) { super(`HTTP ${status}`); this.status = status; this.body = body; this.url = url; }
}

export async function http(url, { method = 'GET', headers = {}, body, json, timeout = 12000, raw = false, ...rest } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const opts = { method, headers: { ...headers }, signal: ctrl.signal, ...lanOpts(url), ...rest };
  if (json !== undefined) { opts.body = JSON.stringify(json); opts.headers['Content-Type'] = 'application/json'; }
  else if (body !== undefined) opts.body = body;
  try {
    const res = await fetch(url, opts);
    if (raw) return res;
    if (res.status === 204 || res.status === 202 && !res.headers.get('content-length')) return null;
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
    if (!res.ok) throw new HttpError(res.status, data, url);
    return data;
  } finally { clearTimeout(timer); }
}

/** True when this https page wants a plain-http URL (mixed content). */
export function isMixed(url) {
  try { return location.protocol === 'https:' && new URL(url, location.href).protocol === 'http:'; } catch { return false; }
}
/**
 * Chrome's Local Network Access lets an https page (e.g. GitHub Pages) call http:// servers on
 * your LAN (Jellyfin, Plex, the bridge) after a one-time permission prompt — but only when the
 * request says it's going to the local network.
 */
export function lanOpts(url) {
  try {
    const u = new URL(url, location.href);
    if (isMixed(u.href) && isPrivateHost(u.hostname) && !/^(localhost|127\.)/.test(u.hostname)) return { targetAddressSpace: 'local' };
  } catch {}
  return {};
}
const blobCache = new Map();
/** Image URL usable from this page: LAN http images are fetched (with LNA) and turned into blob: URLs. */
export async function lanImage(url) {
  if (!url || !isMixed(url)) return url;
  if (blobCache.has(url)) return blobCache.get(url);
  try {
    const r = await fetch(url, lanOpts(url));
    if (!r.ok) return '';
    const obj = URL.createObjectURL(await r.blob());
    blobCache.set(url, obj);
    if (blobCache.size > 80) { const [k, v] = blobCache.entries().next().value; URL.revokeObjectURL(v); blobCache.delete(k); }
    return obj;
  } catch { return ''; }
}

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return p.toString();
}

// ---- the app's own (unrotated) frame: js/core/orientation.js may rotate #app with CSS; pointer maths that compares
// clientX/Y with element positions uses these so drags, dials and canvases keep working at 90°, 180°, 45°…
/** Set by js/core/orientation.js: { el: #app, active: rotation in use }. */
export const frame = { el: null, active: false };
/** The rotation (degrees, clockwise) #app is drawn with right now — mid-animation too. */
export function frameDeg() {
  if (!frame.active || !frame.el) return 0;
  const v = parseFloat(getComputedStyle(frame.el).rotate);
  return Number.isFinite(v) ? v : 0;
}
/** A screen point (clientX/Y) → the same point in the unrotated app frame (what getBoundingClientRect would give with no rotation). */
export function toLocal(x, y, deg = frameDeg()) {
  if (!deg) return [x, y];
  const r = frame.el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const t = (-deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}
/** getBoundingClientRect() in the unrotated app frame. Takes an element (exact at any angle) or a DOMRect (exact at multiples of 90°). */
export function localRect(target, deg = frameDeg()) {
  const r = target.getBoundingClientRect ? target.getBoundingClientRect() : target;
  if (!deg) return r;
  const [cx, cy] = toLocal(r.left + r.width / 2, r.top + r.height / 2, deg);
  const t = (deg * Math.PI) / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  let w, h;
  const w0 = target.offsetWidth ?? target.clientWidth, h0 = target.offsetHeight ?? target.clientHeight;
  if (w0 && h0) { const k = r.width / (w0 * c + h0 * s || 1); w = w0 * k; h = h0 * k; }
  else {
    const d = c * c - s * s;
    if (Math.abs(d) > 0.15) { w = (r.width * c - r.height * s) / d; h = (r.height * c - r.width * s) / d; }
    else w = h = r.width / (c + s);   // ~45° and no layout size: assume square
  }
  return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2, width: w, height: h, x: cx - w / 2, y: cy - h / 2 };
}

/** Angle (radians) from the element's centre to a point, 0 = 12 o'clock, clockwise positive. */
export function angleFromCenter(el, x, y) {
  const r = localRect(el);
  [x, y] = toLocal(x, y);
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return Math.atan2(x - cx, -(y - cy));
}

export function distFromCenter(el, x, y) {
  const r = localRect(el);
  [x, y] = toLocal(x, y);
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return Math.hypot(x - cx, y - cy) / (r.width / 2); // 0 centre .. 1 edge
}

/** Shortest signed difference between two angles in radians. */
export function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const isPrivateHost = (host) =>
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|[^.]+\.local$|[^.]+$)/i.test(host);

export function normalizeText(s = '') {
  return s.toLowerCase()
    .replace(/\s*[\(\[].*?(remaster|live|version|edit|mix|mono|stereo|feat|with|deluxe).*?[\)\]]/gi, '')
    .replace(/\s+-\s+.*(remaster|live|version|edit|mix|mono|stereo).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const coarsePointer = () => matchMedia('(pointer: coarse)').matches;
