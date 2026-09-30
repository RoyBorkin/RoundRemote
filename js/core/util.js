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
  const opts = { method, headers: { ...headers }, signal: ctrl.signal, ...rest };
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

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return p.toString();
}

/** Angle (radians) from the element's centre to a point, 0 = 12 o'clock, clockwise positive. */
export function angleFromCenter(el, x, y) {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return Math.atan2(x - cx, -(y - cy));
}

export function distFromCenter(el, x, y) {
  const r = el.getBoundingClientRect();
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
