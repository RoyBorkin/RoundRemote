// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// App icons for the TV remote's apps grid (js/screens/tvapps.js): the real icon of an Android app, taken from its
// Google Play page and kept in the data folder, so the round screen shows the same tile the TV does.
//
//   GET /api/tvapps/icon/<package>   → the icon (PNG / WebP / JPEG), Cache-Control a week
//   GET /api/tvapps/status?pkgs=a,b  → { a: { ok, fetchedAt } … } what's in the cache (diagnostics)
//   GET /api/tvapps/search?q=<name | Play Store link | package> → { results: [{ pkg, name, dev, icon }], from }
//        (Manage apps → Add app: find an app that isn't in the list; cached 10 minutes)
//
// How: fetch https://play.google.com/store/apps/details?id=<package>, read the icon address from the page
// (og:image, else the "Icon image" <img>, else the first play-lh.googleusercontent.com picture), ask Google's image
// server for a 256 px copy, and save it as <data dir>/cache/tvapps/<package>.<ext> with a small .json beside it.
// Each package is looked up at most once a week (also when it failed: unknown package, no TV icon), one fetch at a
// time per package. A failed refresh keeps serving the old icon. Works the same on the Pi (standalone), on the
// Docker server, and through a companion Pi (it forwards /api/* to its server, so the server keeps the cache).
//
// config.json: "tvapps": { "playBase": "https://play.google.com", "refreshDays": 7, "timeoutMs": 12000 }
import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from './paths.js';
import { log } from './util.js';

const DAY = 86400000;
const PKG = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const jobs = new Map();   // package → Promise (one fetch at a time)

const opts = (cfg) => ({ playBase: 'https://play.google.com', refreshDays: 7, timeoutMs: 12000, maxBytes: 1.5e6, ...(cfg?.tvapps || {}) });
const dir = () => dataPath('cache', 'tvapps');
const metaFile = (pkg) => path.join(dir(), `${pkg}.json`);
const EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif' };

function readMeta(pkg) { try { return JSON.parse(fs.readFileSync(metaFile(pkg), 'utf8')); } catch { return null; } }
function writeMeta(pkg, m) { try { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(metaFile(pkg), JSON.stringify(m)); } catch (e) { log('tvapps', `can't write the icon cache: ${e.message}`); } }

async function get(url, { timeoutMs, accept }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.8', Accept: accept } });
  } finally { clearTimeout(t); }
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"');
/** The app icon's address in a Google Play app page (null when there's none). */
export function iconFromPlayPage(html) {
  const s = String(html || '');
  const meta = s.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || s.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  const img = s.match(/<img[^>]+src=["']([^"']+)["'][^>]*alt=["']Icon image["']/i) || s.match(/<img[^>]+alt=["']Icon image["'][^>]*src=["']([^"']+)["']/i);
  const any = s.match(/https:\/\/play-lh\.googleusercontent\.com\/[A-Za-z0-9_\-]+(?:=[\w-]+)?/);
  const url = decode((meta || img || [])[1] || (any || [])[0] || '');
  return /^https?:\/\//.test(url) ? url : null;
}
/** Google's image server: ask for a 256 px square ("=s256") instead of whatever size the page used. */
export function sized(url, px = 256) {
  if (!/googleusercontent\.com\//.test(url)) return url;
  return `${url.replace(/=[\w-]*$/, '')}=s${px}`;
}

// ---------------------------------------------------------------- search (Add app)
// The search page https://play.google.com/store/search?q=<q>&c=apps is server-rendered: the results are in the
// page's AF_initDataCallback({ key: 'ds:4', … data: [...] }) script (the same data google-play-scraper reads:
// sections at data[0][1]; a section's [22][0] is a list of apps, each app's [0] = [[pkg], [.., .., .., [.., .., iconUrl]],
// .., title, …, [14] = developer]; the exact-match "featured" app is a section's [23]) and in the HTML cards
// (<a href="/store/apps/details?id=…"> with the icon <img src="https://play-lh.googleusercontent.com/…"> and the
// title / developer spans). Google changes both from time to time, so three readers run in turn: the known data
// paths, a walk over the data for anything app-shaped, and the HTML links — whatever finds apps first wins.
const at = (o, pathArr) => pathArr.reduce((x, k) => (x == null ? undefined : x[k]), o);
const strip = (s) => decode(String(s || '').replace(/<[^>]*>/g, '')).replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
/** The AF_initDataCallback data blocks of a Google Play page: { 'ds:4': [...], … } */
export function scriptData(html) {
  const out = {};
  for (const block of String(html || '').match(/AF_initDataCallback\([\s\S]*?<\/script/g) || []) {
    const key = (block.match(/key:\s*'(ds:\d+)'/) || [])[1];
    const val = (block.match(/data:([\s\S]*?), sideChannel: \{\}\}\);\s*<\/script/) || [])[1];
    if (!key || !val) continue;
    try { out[key] = JSON.parse(val); } catch {}
  }
  return out;
}
const appOf = (n) => {   // one regular result's [0]
  const pkg = at(n, [0, 0]);
  if (typeof pkg !== 'string' || !PKG.test(pkg) || typeof n[3] !== 'string') return null;
  const icon = at(n, [1, 3, 2]);
  return { pkg, name: n[3], dev: typeof n[14] === 'string' ? n[14] : '', icon: typeof icon === 'string' ? icon : '' };
};
function fromData(data) {
  const out = [];
  const sections = at(data, [0, 1]);
  if (Array.isArray(sections)) {
    for (const sec of sections) {
      const f = sec?.[23];   // the featured (exact match) app
      if (f) {
        const pkg = at(f, [16, 3, 12, 0, 0]), name = at(f, [16, 2, 0, 0]);
        if (typeof pkg === 'string' && PKG.test(pkg) && typeof name === 'string') out.push({ pkg, name, dev: at(f, [16, 2, 68, 0]) || '', icon: at(f, [16, 2, 95, 0, 3, 2]) || '' });
      }
      for (const it of at(sec, [22, 0]) || []) { const a = Array.isArray(it) && appOf(it[0]); if (a) out.push(a); }
    }
  }
  return out;
}
function walkData(data) {
  const out = [];
  const seen = new Set();
  const walk = (n, depth) => {
    if (!Array.isArray(n) || depth > 40 || out.length > 60) return;
    const a = appOf(n);
    if (a) { if (!seen.has(a.pkg)) { seen.add(a.pkg); out.push(a); } return; }
    for (const c of n) walk(c, depth + 1);
  };
  walk(data, 0);
  return out;
}
function fromHtml(html) {
  const s = String(html || '');
  const out = [];
  const re = /href="\/store\/apps\/details\?id=([A-Za-z][\w.]*)[^"]*"/g;
  const hits = [...s.matchAll(re)];
  hits.forEach((m, i) => {
    const pkg = m[1];
    if (!PKG.test(pkg) || out.some((x) => x.pkg === pkg)) return;
    const chunk = s.slice(m.index, hits[i + 1]?.index ?? m.index + 6000).slice(0, 6000);
    const icon = (chunk.match(/<img[^>]+(?:src|data-src)="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/) || [])[1] || '';
    const name = strip((chunk.match(/<span[^>]*class="[^"]*\bDdYX5\b[^"]*"[^>]*>([\s\S]*?)<\/span>/) || chunk.match(/<div[^>]*class="[^"]*\bvWM94c\b[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1]
      || (chunk.match(/aria-label="([^"]+)"/) || [])[1] || '');
    const dev = strip((chunk.match(/<span[^>]*class="[^"]*\bwMUdtb\b[^"]*"[^>]*>([\s\S]*?)<\/span>/) || chunk.match(/<div[^>]*class="[^"]*\bLbQbAe\b[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '');
    if (name) out.push({ pkg, name, dev, icon: decode(icon) });
  });
  return out;
}
/** The apps on a Google Play search page: [{ pkg, name, dev, icon }] (best first, no duplicates). */
export function parseSearch(html) {
  const ds = scriptData(html);
  let list = ds['ds:4'] ? fromData(ds['ds:4']) : [];
  if (!list.length) list = Object.values(ds).flatMap(walkData);
  const cards = fromHtml(html);
  if (!list.length) list = cards;
  else for (const c of cards) { const x = list.find((a) => a.pkg === c.pkg); if (x) { x.icon ||= c.icon; x.dev ||= c.dev; } }
  const seen = new Set();
  return list.filter((a) => !seen.has(a.pkg) && seen.add(a.pkg)).map((a) => ({ ...a, name: strip(a.name), dev: strip(a.dev), icon: a.icon ? sized(decode(a.icon), 128) : '' })).slice(0, 24);
}
/** One app's name / developer / icon from its Google Play page (JSON-LD, else og: tags, else <title>). */
export function parseDetails(html, pkg) {
  const s = String(html || '');
  let name = '', dev = '';
  for (const m of s.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { const j = JSON.parse(m[1]); if (j?.name) { name = j.name; dev = j.author?.name || ''; break; } } catch {}
  }
  if (!name) name = (s.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || s.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';
  name = strip(name).replace(/\s*[-–]\s*Apps on Google Play\s*$/i, '');
  const icon = iconFromPlayPage(s);
  return name ? { pkg, name, dev: strip(dev), icon: icon ? sized(icon, 128) : '' } : null;
}
/** A package name from what was typed: the package itself, or a Play Store link (…details?id=<pkg>, market://details?id=). */
export function pkgFromInput(q) {
  const s = String(q || '').trim();
  const m = s.match(/[?&]id=([A-Za-z][\w.]*)/);
  if (m && PKG.test(m[1])) return m[1];
  return PKG.test(s) && !/\s/.test(s) && /^[a-z]/i.test(s) && s.split('.').length >= 2 && !/^(www\.|https?:)/i.test(s) && !/\.(com|net|org|io|tv|co\.il)$/i.test(s) ? s : null;
}
const found = new Map();   // query → { at, data } (10 minutes)
async function search(q, o) {
  const key = q.toLowerCase();
  const hit = found.get(key);
  if (hit && Date.now() - hit.at < 600000) return hit.data;
  const base = o.playBase.replace(/\/$/, '');
  const pkg = pkgFromInput(q);
  let data;
  if (pkg) {
    const r = await get(`${base}/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en&gl=US`, { timeoutMs: o.timeoutMs, accept: 'text/html' });
    if (r.status === 404) data = { results: [{ pkg, name: pkg.split('.').pop().replace(/^./, (c) => c.toUpperCase()), dev: '', icon: '', missing: true }], from: 'details', pkg, error: 'Not on Google Play — fine if it’s installed on the TV anyway' };
    else if (!r.ok) throw new Error(`Google Play answered ${r.status}`);
    else { const d = parseDetails(await r.text(), pkg); data = { results: d ? [d] : [{ pkg, name: pkg.split('.').pop().replace(/^./, (c) => c.toUpperCase()), dev: '', icon: '' }], from: 'details', pkg }; }
  } else {
    const r = await get(`${base}/store/search?q=${encodeURIComponent(q)}&c=apps&hl=en&gl=US`, { timeoutMs: o.timeoutMs, accept: 'text/html' });
    if (!r.ok) throw new Error(`Google Play answered ${r.status}`);
    data = { results: parseSearch(await r.text()), from: 'search' };
  }
  if (found.size > 100) found.delete(found.keys().next().value);
  found.set(key, { at: Date.now(), data });
  return data;
}

async function fetchIcon(pkg, o) {
  const page = await get(`${o.playBase.replace(/\/$/, '')}/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en&gl=US`, { timeoutMs: o.timeoutMs, accept: 'text/html' });
  if (page.status === 404) return { ok: false, reason: 'not on Google Play' };
  if (!page.ok) throw new Error(`Google Play answered ${page.status}`);
  const src = iconFromPlayPage(await page.text());
  if (!src) return { ok: false, reason: 'no icon on the page' };
  const img = await get(sized(src), { timeoutMs: o.timeoutMs, accept: 'image/webp,image/png,image/*' });
  if (!img.ok) throw new Error(`icon download answered ${img.status}`);
  const type = String(img.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!EXT[type]) return { ok: false, reason: `not an image (${type || 'no type'})` };
  const buf = Buffer.from(await img.arrayBuffer());
  if (!buf.length || buf.length > o.maxBytes) return { ok: false, reason: 'icon too big' };
  fs.mkdirSync(dir(), { recursive: true });
  const file = `${pkg}.${EXT[type]}`;
  // replace an older copy (it may have another type)
  for (const e of Object.values(EXT)) if (e !== EXT[type]) try { fs.unlinkSync(path.join(dir(), `${pkg}.${e}`)); } catch {}
  fs.writeFileSync(path.join(dir(), file), buf);
  return { ok: true, file, type, src, bytes: buf.length };
}

/** The cached icon for a package — fetched from Google Play when missing or older than refreshDays. */
export async function icon(pkg, cfg) {
  const o = opts(cfg);
  const m = readMeta(pkg);
  const fresh = m && Date.now() - (m.fetchedAt || 0) < o.refreshDays * DAY;
  const have = m?.ok && m.file && fs.existsSync(path.join(dir(), m.file));
  if (fresh && (have || !m.ok)) return have ? m : null;
  if (!jobs.has(pkg)) {
    jobs.set(pkg, (async () => {
      try {
        const r = await fetchIcon(pkg, o);
        const meta = r.ok ? { ...r, fetchedAt: Date.now() } : { ...(have ? m : {}), ok: !!have, failed: r.reason, fetchedAt: Date.now() };
        writeMeta(pkg, meta);
        if (!r.ok) log('tvapps', `${pkg}: ${r.reason}`);
        return meta;
      } catch (e) {
        // network trouble: keep what we have, try again in an hour (not counted as a lookup)
        log('tvapps', `${pkg}: ${e.name === 'AbortError' ? 'Google Play took too long' : e.cause?.code || e.message}`);
        const retry = Date.now() - (o.refreshDays * DAY - 3600000);
        if (have) { writeMeta(pkg, { ...m, fetchedAt: retry }); return m; }
        writeMeta(pkg, { ok: false, failed: 'offline', fetchedAt: retry });
        return null;
      } finally { jobs.delete(pkg); }
    })());
  }
  const r = await jobs.get(pkg);
  return r?.ok && r.file && fs.existsSync(path.join(dir(), r.file)) ? r : null;
}

export async function route(req, res, url, { json, cfg }) {
  const p = url.pathname;
  const m = p.match(/^\/api\/tvapps\/icon\/([^/]+?)(?:\.(?:png|webp|jpg))?$/);
  if (m) {
    const pkg = decodeURIComponent(m[1]);
    if (!PKG.test(pkg) || pkg.length > 150) return json(res, 400, { error: 'not a package name' });
    const r = await icon(pkg, cfg);
    if (!r) { res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }); return res.end('{"error":"no icon"}'); }
    const file = path.join(dir(), r.file);
    const st = fs.statSync(file);
    const etag = `"${pkg}-${r.fetchedAt || st.mtimeMs}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    res.writeHead(200, { 'Content-Type': r.type || 'image/png', 'Content-Length': st.size, 'Cache-Control': 'public, max-age=604800', ETag: etag });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file).pipe(res);
  }
  if (p === '/api/tvapps/status') {
    const pkgs = String(url.searchParams.get('pkgs') || '').split(',').filter((x) => PKG.test(x)).slice(0, 200);
    return json(res, 200, Object.fromEntries(pkgs.map((k) => { const mm = readMeta(k); return [k, mm ? { ok: !!mm.ok, fetchedAt: mm.fetchedAt, failed: mm.failed || undefined } : null]; })));
  }
  if (p === '/api/tvapps/search') {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 200);
    if (q.length < 2) return json(res, 400, { error: 'Type at least two letters' });
    try { return json(res, 200, await search(q, opts(cfg))); }
    catch (e) {
      log('tvapps', `search “${q}”: ${e.name === 'AbortError' ? 'Google Play took too long' : e.cause?.code || e.message}`);
      return json(res, 502, { error: e.name === 'AbortError' ? 'Google Play took too long to answer' : 'Can’t reach Google Play from the bridge right now' });
    }
  }
  return json(res, 404, { error: 'not found' });
}
