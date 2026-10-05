// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Small helpers for the bridge (no dependencies).

/** Decode the XML entities we meet in UPnP/DIDL payloads. */
export function unescapeXml(s = '') {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
export function escapeXml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** First <tag>…</tag> value (namespace prefix optional), entity-decoded. */
export function tag(xml, name) {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i');
  const m = re.exec(xml || '');
  return m ? unescapeXml(m[1].trim()) : '';
}
export function tags(xml, name) {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'gi');
  return [...(xml || '').matchAll(re)].map((m) => m[1]);
}

/** "0:03:12" / "03:12.500" → ms */
export function hmsToMs(s) {
  if (!s || /NOT_IMPLEMENTED/i.test(s)) return 0;
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return Math.round(sec * 1000);
}
export function msToHms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, opts = {}, timeout = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, body: text });
    return text;
  } finally { clearTimeout(t); }
}

/** Is this hostname on the local network? (used to keep /api/proxy from being an open proxy) */
export function isPrivateHost(host) {
  host = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan') || !host.includes('.') && !host.includes(':')) return true;
  if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;
  return false;
}

export function log(scope, ...args) {
  console.log(new Date().toISOString().slice(11, 19), `[${scope}]`, ...args);
}
