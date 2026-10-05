// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Collection app (apps/collection.js) — the bridge side: syncs with the collection services that need a server
// (no CORS, or a secret that shouldn't live in the browser) and the phone page for imports and barcodes.
//
//   GET  /collection                     phone page: upload a CSV / JSON export, scan a barcode or type a game / book / album / movie
//   GET  /api/collection/info            { ips, port, publicUrl, rev, conns: { bgg, pricecharting, rawg, discogs, tmdb }, watch, upc }
//   POST /api/collection/config          { bgg: { username, token }, pricecharting: { token }, rawg: { username, key }, discogs: { username, token },
//                                        tmdb: { key } } ('' clears a secret, a missing field keeps it) — saved in bridge/collection.json
//   GET  /api/collection/bgg             BoardGameGeek collection (own=1, + expansions; categories → board / card / party game)
//   GET  /api/collection/pricecharting   PriceCharting collection (offers?status=collection) — your API token
//   GET  /api/collection/rawg            RAWG library (statuses=owned, every page) — your RAWG key
//   GET  /api/collection/discogs         Discogs collection (folder 0, 100 a page, every page; ≤ 60 requests a minute) — your token
//   GET  /api/collection/search?src=rawg|bgg|discogs|musicbrainz|openlibrary|tmdb&kind=…&q=…   search to add by hand (with covers)
//   GET  /api/collection/tmdb?id=…&type=movie|tv   runtime, director and genres of a movie / show
//   GET  /api/collection/upc?code=…      barcode → product: ISBNs → Open Library; other codes → UPCitemdb's free trial endpoint
//                                        (rate-limited), then Discogs (with a token) / MusicBrainz for records and CDs
//   POST /api/collection/parse           { text, preset, map } → what the file holds (the phone page's preview)
//   GET  /api/collection/inbox?since=rev entries for the display: { rev, entries: [{ id, rev, at, type: 'import'|'item', … }] }
//   POST /api/collection/inbox           { type: 'import', preset, name, text, map } | { type: 'item', item }
//
// Secrets (BGG token, PriceCharting token, RAWG key) come from bridge/config.json → "collection", or are posted once
// from the display's settings and kept in bridge/collection.json. They are only ever sent to their own service.
// A "watched file" (config collection.watchFile) is re-imported whenever it changes (e.g. a synced GamEye export).
//
// Discogs (personal token: 60 requests a minute) and MusicBrainz (no key; 1 request a second, a User-Agent required) are
// throttled here; Open Library and MusicBrainz need no account.
//
// config.json → "collection": { file, publicUrl, bgg: { username, token }, pricecharting: { token }, rawg: { username, key },
//   discogs: { username, token }, tmdb: { key }, watchFile, watchPreset, upcLookup, userAgent, bggBase, pricechartingBase, rawgBase,
//   upcBase, discogsBase, openLibraryBase, musicBrainzBase, tmdbBase, tmdbImageBase, bggRetryMs, discogsGapMs, discogsRetryMs, mbGapMs }
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { log } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARED = path.resolve(__dirname, '..', '..', 'apps', 'collection-sources.js');

// ---------------------------------------------------------------- the shared parsers (apps/collection-sources.js)
// That file is the display's own ES module. It has no imports, so we load its text as a data: module — that works
// on every Node version, whatever package.json (or none) sits next to apps/.
let shared = null;
export async function sources() {
  if (!shared) {
    const src = fs.readFileSync(SHARED, 'utf8');
    shared = import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  }
  return shared;
}

// ---------------------------------------------------------------- a tiny XML reader (BGG's XML API2)
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export const unxml = (s = '') => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m));
/** XML → { name, attrs, children, text } tree. Enough for BGG (no DTDs, CDATA kept as text). */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!(?:DOCTYPE)[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.text += m[1]; continue; }
    if (m[3]) {
      if (m[2]) {   // closing tag
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === m[3]) { stack.length = i; break; }
        continue;
      }
      const attrs = {};
      for (const a of (m[4] || '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unxml(a[2] ?? a[3] ?? '');
      const node = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
      continue;
    }
    if (m[6] !== undefined) top.text += unxml(m[6]);
  }
  return root;
}
const kids = (n, name) => (n?.children || []).filter((c) => c.name === name);
const kid = (n, name) => (n?.children || []).find((c) => c.name === name) || null;
const txt = (n) => (n?.text || '').trim();
const val = (n, name) => kid(n, name)?.attrs?.value ?? txt(kid(n, name));
const numOr = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const intOr = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
const span = (a, b) => { a = intOr(a); b = intOr(b); if (!a && !b) return null; return [a || b, Math.max(a || b, b || a)]; };
const absUrl = (u) => (u ? (u.startsWith('//') ? `https:${u}` : u) : '');

/** <items><item objectid subtype collid>…</item></items> → collection entries */
export function bggCollection(xml, { expansion = false } = {}) {
  const doc = parseXml(xml);
  const err = findErr(doc);
  if (err) throw Object.assign(new Error(`BoardGameGeek: ${err}`), { status: 400 });
  const items = kid(doc, 'items');
  if (!items) throw new Error('BoardGameGeek answered something unexpected');
  return kids(items, 'item').map((it) => {
    const st = kid(it, 'stats'), rating = kid(st, 'rating'), status = kid(it, 'status');
    if (status && status.attrs.own === '0') return null;
    const own = +(rating?.attrs?.value) || null;
    return {
      sid: it.attrs.collid || it.attrs.objectid, bggId: it.attrs.objectid, kind: 'board', title: txt(kid(it, 'name')), year: intOr(txt(kid(it, 'yearpublished'))),
      art: absUrl(txt(kid(it, 'image')) || txt(kid(it, 'thumbnail'))), thumb: absUrl(txt(kid(it, 'thumbnail'))),
      players: span(st?.attrs.minplayers, st?.attrs.maxplayers), mins: span(st?.attrs.minplaytime || st?.attrs.playingtime, st?.attrs.maxplaytime || st?.attrs.playingtime),
      rating: own || numOr(kid(rating, 'average')?.attrs?.value), avg: numOr(kid(rating, 'average')?.attrs?.value),
      plays: intOr(txt(kid(it, 'numplays'))) || 0, notes: txt(kid(it, 'comment')).slice(0, 600), expansion: expansion || it.attrs.subtype === 'boardgameexpansion',
    };
  }).filter((x) => x && x.title);
}
function findErr(doc) {
  const e = kid(doc, 'errors') || kid(doc, 'error');
  if (e) return txt(kid(kid(e, 'error') || e, 'message')) || txt(e) || 'error';
  const msg = kid(doc, 'message');
  return msg && !kid(doc, 'items') ? txt(msg) : '';
}
/** /thing?id=… → Map(id → { title, year, art, players, mins, age, baseIds }) */
export function bggThings(xml) {
  const out = new Map();
  for (const it of kids(kid(parseXml(xml), 'items'), 'item')) {
    const name = kids(it, 'name').find((n) => n.attrs.type === 'primary') || kid(it, 'name');
    out.set(it.attrs.id, {
      bggId: it.attrs.id, kind: 'board', title: name?.attrs?.value || '', year: intOr(val(it, 'yearpublished')), art: absUrl(txt(kid(it, 'image')) || txt(kid(it, 'thumbnail'))),
      thumb: absUrl(txt(kid(it, 'thumbnail'))), players: span(val(it, 'minplayers'), val(it, 'maxplayers')), mins: span(val(it, 'minplaytime') || val(it, 'playingtime'), val(it, 'maxplaytime') || val(it, 'playingtime')),
      age: intOr(val(it, 'minage')), expansion: it.attrs.type === 'boardgameexpansion',
      cats: kids(it, 'link').filter((l) => l.attrs.type === 'boardgamecategory').map((l) => l.attrs.value),
      mechs: kids(it, 'link').filter((l) => l.attrs.type === 'boardgamemechanic').map((l) => l.attrs.value),
      baseIds: kids(it, 'link').filter((l) => l.attrs.type === 'boardgameexpansion' && l.attrs.inbound === 'true').map((l) => l.attrs.id),
    });
  }
  return out;
}

// ---------------------------------------------------------------- state (bridge/collection.json)
let st = null, file = null, conf = null;
function load(cfg, dir) {
  conf = { publicUrl: '', upcLookup: true, watchPreset: 'auto', bggBase: 'https://boardgamegeek.com', pricechartingBase: 'https://www.pricecharting.com', rawgBase: 'https://api.rawg.io',
    upcBase: 'https://api.upcitemdb.com', discogsBase: 'https://api.discogs.com', openLibraryBase: 'https://openlibrary.org', musicBrainzBase: 'https://musicbrainz.org',
    tmdbBase: 'https://api.themoviedb.org', tmdbImageBase: 'https://image.tmdb.org/t/p/w500', bggRetryMs: 2000, discogsGapMs: 1050, discogsRetryMs: 61000, mbGapMs: 1150,
    userAgent: 'RoundRemote-Collection/1.0 ( https://github.com/royborkin/RoundSpotify )', ...(cfg.collection || {}) };
  if (st) return;
  file = path.resolve(dir, conf.file || 'collection.json');
  st = { bgg: {}, pricecharting: {}, rawg: {}, discogs: {}, tmdb: {}, inbox: { rev: 0, entries: [] }, watch: {} };
  try { if (fs.existsSync(file)) st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { log('collection', `could not read ${file}: ${e.message}`); }
  st.inbox ||= { rev: 0, entries: [] };
  st.discogs ||= {}; st.tmdb ||= {};
}
function save() {
  try { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(st, null, 1)); fs.renameSync(tmp, file); }
  catch (e) { log('collection', `could not save ${file}: ${e.message}`); }
}
const secret = (k) => {
  const [svc, f] = k.split('.');
  return String(st[svc]?.[f] || conf[svc]?.[f] || '').trim();
};
const fail = (msg, status = 400, extra = {}) => Object.assign(new Error(msg), { status, ...extra });

// ---------------------------------------------------------------- fetching
async function get(url, { headers = {}, timeout = 20000, what = 'the service' } = {}) {
  let r;
  try { r = await fetch(url, { headers: { 'User-Agent': conf?.userAgent || 'RoundRemote-Collection/1.0', ...headers }, signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw fail(`Can't reach ${what} (${e.cause?.code || e.name === 'TimeoutError' ? 'timeout' : e.message})`, 502); }
  return { status: r.status, text: await r.text(), headers: r.headers };
}
const cache = new Map();
async function cached(key, ttl, fn) {
  const e = cache.get(key);
  if (e && Date.now() - e.at < ttl) return e.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// BoardGameGeek: a registered application token is required (boardgamegeek.com/applications). A collection request is
// often answered 202 "queued — try again later" while BGG builds it: wait and retry (2, 4, 8, 12, 16 s).
async function bggGet(p, { retries = 6 } = {}) {
  const token = secret('bgg.token');
  if (!token) throw fail('Add your BoardGameGeek application token first (Collection → Settings → BoardGameGeek)', 400, { setup: true });
  const url = `${conf.bggBase.replace(/\/$/, '')}/xmlapi2/${p}`;
  for (let i = 0; ; i++) {
    const r = await get(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/xml' }, what: 'BoardGameGeek' });
    if (r.status === 200) return r.text;
    if ((r.status === 202 || r.status === 429 || r.status === 503) && i < retries) {
      const wait = Math.min(16, [1, 2, 4, 6, 8, 8][i] ?? 8) * (+conf.bggRetryMs || 2000);
      log('collection', `BGG ${r.status} (${r.status === 202 ? 'queued' : 'busy'}) — retrying in ${Math.round(wait / 1000)} s`);
      await sleep(wait); continue;
    }
    if (r.status === 202) throw fail('BoardGameGeek is still preparing your collection — try Sync again in a minute', 503, { retry: true });
    if (r.status === 401 || r.status === 403) throw fail('BoardGameGeek refused the token — check it at boardgamegeek.com/applications', 401, { auth: true });
    if (r.status === 429) throw fail('BoardGameGeek says too many requests — wait a minute and try again', 429);
    throw fail(`BoardGameGeek error ${r.status}`, 502);
  }
}
async function bggSync(username) {
  username = String(username || st.bgg.username || conf.bgg?.username || '').trim();
  if (!username) throw fail('Which BoardGameGeek user? Add your username', 400, { setup: true });
  const q = (extra) => `collection?${new URLSearchParams({ username, own: '1', stats: '1', ...extra })}`;
  const base = bggCollection(await bggGet(q({ excludesubtype: 'boardgameexpansion' })));
  let exps = [];
  try { exps = bggCollection(await bggGet(q({ subtype: 'boardgameexpansion' })), { expansion: true }); }
  catch (e) { if (e.auth) throw e; log('collection', `BGG expansions: ${e.message}`); }
  // which base game each expansion belongs to (best effort: /thing, 20 ids a call, a few calls)
  const ids = exps.map((x) => x.bggId).filter(Boolean);
  for (let i = 0; i < ids.length && i < 100; i += 20) {
    try {
      const things = bggThings(await bggGet(`thing?id=${ids.slice(i, i + 20).join(',')}`, { retries: 2 }));
      for (const x of exps) { const t = things.get(x.bggId); if (t?.baseIds?.length) x.baseIds = t.baseIds; if (!x.players && t?.players) x.players = t.players; }
    } catch (e) { if (e.auth) throw e; log('collection', `BGG expansion details: ${e.message}`); break; }
  }
  // board / card / party game from BGG's categories (best effort: 20 ids a call, the first 100 games)
  const S = await sources();
  const bids = base.map((x) => x.bggId).filter(Boolean);
  for (let i = 0; i < bids.length && i < 100; i += 20) {
    try {
      const things = bggThings(await bggGet(`thing?id=${bids.slice(i, i + 20).join(',')}`, { retries: 2 }));
      for (const x of base) { const t = things.get(x.bggId); if (t && (t.cats.length || t.mechs.length)) Object.assign(x, S.classifyBoard({ cats: t.cats, mechs: t.mechs, title: x.title })); }
    } catch (e) { if (e.auth) throw e; log('collection', `BGG categories: ${e.message}`); break; }
  }
  for (const x of base) if (!x.type) { const c = S.classifyBoard({ title: x.title }); if (c.type) x.type = c.type; }
  return { username, items: [...base, ...exps], counts: { games: base.length, expansions: exps.length }, at: Date.now() };
}
async function bggSearch(q) {
  const doc = parseXml(await bggGet(`search?${new URLSearchParams({ query: q, type: 'boardgame' })}`, { retries: 2 }));
  const hits = kids(kid(doc, 'items'), 'item').slice(0, 12).map((it) => ({ bggId: it.attrs.id, title: (kids(it, 'name').find((n) => n.attrs.type === 'primary') || kid(it, 'name'))?.attrs?.value || '', year: intOr(val(it, 'yearpublished')) }));
  if (!hits.length) return [];
  let things = new Map();
  try { things = bggThings(await bggGet(`thing?id=${hits.map((x) => x.bggId).join(',')}`, { retries: 2 })); } catch (e) { if (e.auth) throw e; }
  const S = await sources();
  return hits.map((x) => { const t = things.get(x.bggId) || {}; const { cats = [], mechs = [], ...rest } = t; return { ...x, ...rest, ...S.classifyBoard({ cats, mechs, title: t.title || x.title }), title: t.title || x.title, kind: 'board', source: 'bgg', sid: x.bggId }; });
}

// PriceCharting (paid subscription → API token): your collection with today's prices.
async function pcSync() {
  const t = secret('pricecharting.token');
  if (!t) throw fail('Add your PriceCharting API token first (Collection → Settings → PriceCharting)', 400, { setup: true });
  const r = await get(`${conf.pricechartingBase.replace(/\/$/, '')}/api/offers?${new URLSearchParams({ t, status: 'collection' })}`, { what: 'PriceCharting' });
  let j; try { j = JSON.parse(r.text); } catch { throw fail(`PriceCharting answered ${r.status} without JSON`, 502); }
  if (r.status === 401 || r.status === 403 || /token|auth|subscri/i.test(j?.['error-message'] || '')) throw fail(j?.['error-message'] || 'PriceCharting refused the token', 401, { auth: true });
  if (r.status !== 200 || j?.status === 'error') throw fail(`PriceCharting: ${j?.['error-message'] || `error ${r.status}`}`, 502);
  const NOT_GAMES = /\b(card|cards|pokemon|magic|yu-?gi-?oh|comic|funko|lego|coin|sports card)\b/i;
  const items = (j.offers || j.products || []).map((o) => {
    const con = String(o['console-name'] || '');
    if (NOT_GAMES.test(con)) return null;
    const inc = `${o['include-string'] || ''} ${o['condition-string'] || ''}`;
    const value = Number.isFinite(+o.value) ? Math.round(+o.value) : Number.isFinite(+o.price) ? Math.round(+o.price) : null;
    return { sid: String(o['offer-id'] || o.id || ''), kind: 'video', title: String(o['product-name'] || '').trim(), platform: con, ownership: ownershipFromPc(inc), condition: String(o['condition-string'] || ''),
      value, qty: +o.quantity || 1, pcId: String(o['product-id'] || o.id || '') };
  }).filter((x) => x && x.title);
  return { items, at: Date.now() };
}
function ownershipFromPc(s) {
  s = s.toLowerCase();
  if (/graded/.test(s)) return 'graded';
  if (/new|sealed/.test(s)) return 'new';
  if (/box/.test(s) && /manual/.test(s) || /complete|cib/.test(s)) return 'cib';
  if (/box only/.test(s)) return 'box';
  if (/manual only/.test(s)) return 'manual';
  if (/loose|game only|cart|disc only/.test(s)) return 'loose';
  return '';
}

// RAWG (free API key from rawg.io/apidocs): your library's "owned" games, 40 a page.
const rawgGame = (g) => {
  const plats = (g.platforms || []).map((p) => p.platform?.name || p.name).filter(Boolean);
  return { sid: String(g.id), rawgId: String(g.id), kind: 'video', title: g.name, year: g.released ? +String(g.released).slice(0, 4) : null, art: g.background_image || '',
    platform: plats.length === 1 ? plats[0] : '', platforms: plats.slice(0, 10) };
};
async function rawgGet(u) {
  const r = await get(u, { what: 'RAWG' });
  let j; try { j = JSON.parse(r.text); } catch { throw fail(`RAWG answered ${r.status} without JSON`, 502); }
  if (r.status === 401 || /key/i.test(j?.error || '') && r.status >= 400) throw fail('RAWG refused the API key — check it at rawg.io/apidocs', 401, { auth: true });
  if (r.status === 404) throw fail('RAWG doesn’t know that username (or the profile is private)', 404);
  if (r.status !== 200) throw fail(`RAWG error ${r.status}`, 502);
  return j;
}
async function rawgSync(username) {
  const key = secret('rawg.key');
  username = String(username || st.rawg.username || conf.rawg?.username || '').trim();
  if (!key) throw fail('Add your RAWG API key first (Collection → Settings → RAWG)', 400, { setup: true });
  if (!username) throw fail('Which RAWG user? Add your username', 400, { setup: true });
  const base = new URL(conf.rawgBase);
  let url = `${conf.rawgBase.replace(/\/$/, '')}/api/users/${encodeURIComponent(username)}/games?${new URLSearchParams({ statuses: 'owned', key, page_size: '40' })}`;
  const items = [];
  for (let page = 0; url && page < 60; page++) {
    const j = await rawgGet(url);
    items.push(...(j.results || []).filter((g) => g?.name).map(rawgGame));
    let next = null;
    if (j.next) { try { const n = new URL(j.next, url); if (n.origin === base.origin) { if (!n.searchParams.get('key')) n.searchParams.set('key', key); next = n.href; } } catch {} }
    url = next;
  }
  return { username, items, at: Date.now() };
}
async function rawgSearch(q) {
  const key = secret('rawg.key');
  if (!key) throw fail('Add a RAWG API key to search with covers (Collection → Settings → RAWG)', 400, { setup: true });
  const j = await rawgGet(`${conf.rawgBase.replace(/\/$/, '')}/api/games?${new URLSearchParams({ search: q, key, page_size: '12' })}`);
  return (j.results || []).filter((g) => g?.name).map((g) => ({ ...rawgGame(g), source: 'rawg' }));
}

// ---------------------------------------------------------------- throttling (Discogs 60 / min, MusicBrainz 1 / s)
const lanes = new Map(), laneAt = new Map();
export const throttleLog = [];
/** run fn() on a lane, at least `gap` ms after the previous call on that lane finished starting */
function throttled(lane, gap, fn) {
  const prev = lanes.get(lane) || Promise.resolve();
  const p = prev.then(async () => {
    const wait = (laneAt.get(lane) || 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);
    laneAt.set(lane, Date.now());
    throttleLog.push([lane, Date.now()]); if (throttleLog.length > 200) throttleLog.shift();
    return fn();
  });
  lanes.set(lane, p.catch(() => {}));
  return p;
}
const baseOf = (k) => String(conf[k] || '').replace(/\/$/, '');
const jsonOf = (r, what) => { try { return JSON.parse(r.text); } catch { throw fail(`${what} answered ${r.status} without JSON`, 502); } };

// Discogs: a personal access token (discogs.com → Settings → Developers). Authenticated: 60 requests a minute.
async function discogsGet(p, { auth = true, retries = 2 } = {}) {
  const token = secret('discogs.token');
  if (auth && !token) throw fail('Add your Discogs personal access token first (Collection → Connections → Discogs)', 400, { setup: true });
  for (let i = 0; ; i++) {
    const r = await throttled('discogs', +conf.discogsGapMs || 1050, () => get(`${baseOf('discogsBase')}${p}`, { headers: { ...(token ? { Authorization: `Discogs token=${token}` } : {}), Accept: 'application/vnd.discogs.v2.discogs+json' }, what: 'Discogs' }));
    const left = +(r.headers.get('x-discogs-ratelimit-remaining') ?? 99);
    if (left <= 1) { log('collection', 'Discogs rate limit nearly used — pausing'); laneAt.set('discogs', Date.now() + Math.min(60000, +conf.discogsRetryMs || 61000) - (+conf.discogsGapMs || 1050)); }
    if (r.status === 429 && i < retries) { log('collection', 'Discogs 429 — waiting'); await sleep(+conf.discogsRetryMs || 61000); continue; }
    if (r.status === 401) throw fail('Discogs refused the token — make a new one at discogs.com → Settings → Developers', 401, { auth: true });
    if (r.status === 403) throw fail('Discogs says this collection is private — make it public or use your own token', 403, { auth: true });
    if (r.status === 404) throw fail('Discogs doesn’t know that username', 404);
    if (r.status === 429) throw fail('Discogs says too many requests — try again in a minute', 429);
    if (r.status !== 200) throw fail(`Discogs error ${r.status}`, 502);
    return jsonOf(r, 'Discogs');
  }
}
async function discogsSync(username) {
  username = String(username || st.discogs.username || conf.discogs?.username || '').trim();
  if (!secret('discogs.token')) throw fail('Add your Discogs personal access token first (Collection → Connections → Discogs)', 400, { setup: true });
  if (!username) throw fail('Which Discogs user? Add your username', 400, { setup: true });
  const S = await sources();
  const items = [];
  let pages = 1;
  for (let page = 1; page <= pages && page <= 100; page++) {
    const j = await discogsGet(`/users/${encodeURIComponent(username)}/collection/folders/0/releases?${new URLSearchParams({ per_page: '100', page: String(page), sort: 'added', sort_order: 'desc' })}`);
    pages = +j.pagination?.pages || 1;
    for (const r of j.releases || []) { const e = S.discogsEntry(r); if (e) items.push(e); }
  }
  return { username, items, counts: { vinyl: items.filter((x) => x.kind === 'vinyl').length, cd: items.filter((x) => x.kind === 'cd').length }, pages, at: Date.now() };
}
async function discogsSearch(q, kind, barcode = '') {
  const S = await sources();
  const qs = new URLSearchParams({ type: 'release', per_page: '12', ...(barcode ? { barcode } : { q }), ...(kind === 'vinyl' ? { format: 'Vinyl' } : kind === 'cd' ? { format: 'CD' } : {}) });
  const j = await discogsGet(`/database/search?${qs}`);
  return (j.results || []).map(S.discogsSearchEntry).filter(Boolean).map((x) => ({ ...x, source: 'discogs' }));
}

// MusicBrainz: no key; 1 request a second and a User-Agent that says who we are.
async function mbGet(p) {
  const r = await throttled('mb', +conf.mbGapMs || 1100, () => get(`${baseOf('musicBrainzBase')}${p}`, { headers: { Accept: 'application/json' }, what: 'MusicBrainz' }));
  if (r.status === 503 || r.status === 429) throw fail('MusicBrainz is busy — try again in a moment', 503);
  if (r.status !== 200) throw fail(`MusicBrainz error ${r.status}`, 502);
  return jsonOf(r, 'MusicBrainz');
}
async function mbSearch(q, kind) {
  const S = await sources();
  const j = await mbGet(`/ws/2/release-group?${new URLSearchParams({ query: q, fmt: 'json', limit: '12' })}`);
  return (j['release-groups'] || []).map((g) => S.mbReleaseGroup(g, kind)).filter(Boolean).map((x) => ({ ...x, source: 'musicbrainz' }));
}
async function mbBarcode(code) {
  const S = await sources();
  const j = await mbGet(`/ws/2/release?${new URLSearchParams({ query: `barcode:${code}`, fmt: 'json', limit: '3' })}`);
  return (j.releases || []).map(S.mbRelease).filter(Boolean).map((x) => ({ ...x, source: 'musicbrainz', upc: code }));
}

// Open Library: no key (please identify yourself with a User-Agent).
async function olGet(p) {
  const r = await throttled('ol', 350, () => get(`${baseOf('openLibraryBase')}${p}`, { headers: { Accept: 'application/json' }, what: 'Open Library' }));
  if (r.status === 404) return null;
  if (r.status !== 200) throw fail(`Open Library error ${r.status}`, 502);
  return jsonOf(r, 'Open Library');
}
async function isbnLookup(isbn) {
  return cached(`isbn:${isbn}`, 24 * 3600e3, async () => {
    const S = await sources();
    const ed = await olGet(`/isbn/${isbn}.json`);
    if (!ed) return null;
    const authors = [];
    for (const a of (ed.authors || []).slice(0, 3)) { try { const j = await olGet(`${a.key}.json`); if (j?.name) authors.push(j.name); } catch {} }
    let work = null;
    try { if (ed.works?.[0]?.key) work = await olGet(`${ed.works[0].key}.json`); } catch {}
    const e = S.olEdition(ed, { authors, work });
    return e ? { ...e, source: 'openlibrary', upc: isbn } : null;
  });
}
async function olSearch(q) {
  const S = await sources();
  const isbn = S.isbnOf(q);
  if (isbn) { const e = await isbnLookup(isbn); return e ? [e] : []; }
  const j = await olGet(`/search.json?${new URLSearchParams({ q, limit: '12', fields: 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median,isbn,publisher,subject' })}`);
  return (j?.docs || []).map(S.olDoc).filter(Boolean).map((x) => ({ ...x, isbn: x.isbn, source: 'openlibrary' }));
}

// TMDB: a free API key (v3 "api_key") or the longer API Read Access Token (sent as a Bearer token).
async function tmdbGet(p, params = {}) {
  const key = secret('tmdb.key');
  if (!key) throw fail('Add a TMDB API key first (Collection → Connections → TMDB)', 400, { setup: true });
  const bearer = /^eyJ/.test(key);
  const qs = new URLSearchParams({ ...params, ...(bearer ? {} : { api_key: key }) });
  const r = await get(`${baseOf('tmdbBase')}/3${p}?${qs}`, { headers: { Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${key}` } : {}) }, what: 'TMDB' });
  if (r.status === 401) throw fail('TMDB refused the key — check it at themoviedb.org → Settings → API', 401, { auth: true });
  if (r.status === 429) throw fail('TMDB says too many requests — try again in a moment', 429);
  if (r.status !== 200) throw fail(`TMDB error ${r.status}`, 502);
  return jsonOf(r, 'TMDB');
}
async function tmdbGenres() {
  return cached('tmdb:genres', 24 * 3600e3, async () => {
    const S = await sources();
    const out = { ...S.TMDB_GENRES };
    for (const t of ['movie', 'tv']) { try { for (const g of (await tmdbGet(`/genre/${t}/list`, { language: 'en' })).genres || []) out[g.id] = g.name; } catch (e) { if (e.auth) throw e; } }
    return out;
  });
}
async function tmdbSearch(q) {
  const S = await sources();
  const names = await tmdbGenres();
  const img = baseOf('tmdbImageBase');
  const [m, t] = await Promise.all([tmdbGet('/search/movie', { query: q, include_adult: 'false' }), tmdbGet('/search/tv', { query: q }).catch(() => ({ results: [] }))]);
  const movies = (m.results || []).slice(0, 9).map((x) => S.tmdbEntry(x, 'movie', names, img));
  const shows = (t.results || []).slice(0, 4).map((x) => S.tmdbEntry(x, 'tv', names, img));
  return [...movies, ...shows].filter(Boolean).map((x) => ({ ...x, source: 'tmdb' }));
}
async function tmdbDetails(id, type) {
  const S = await sources();
  const t = type === 'tv' ? 'tv' : 'movie';
  const j = await tmdbGet(`/${t}/${encodeURIComponent(id)}`, { append_to_response: 'credits' });
  const director = t === 'movie' ? (j.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name).slice(0, 2).join(', ') : (j.created_by || []).map((c) => c.name).slice(0, 2).join(', ');
  return { id: String(j.id), type: t, runtime: +j.runtime || (j.episode_run_time || [])[0] || null, by: director, genres: S.genresOf('movie', (j.genres || []).map((g) => g.name)), year: S.yearOf(j.release_date || j.first_air_date) };
}

// UPCitemdb's free trial: 100 lookups a day, a few a minute. Fails often → the phone falls back to typing.
const PLAT_RE = [[/\bps5\b|playstation\s*5/i, 'PlayStation 5'], [/\bps4\b|playstation\s*4/i, 'PlayStation 4'], [/\bps3\b|playstation\s*3/i, 'PlayStation 3'], [/switch\s*2/i, 'Nintendo Switch 2'],
  [/nintendo\s*switch|\bswitch\b/i, 'Nintendo Switch'], [/xbox\s*series/i, 'Xbox Series X|S'], [/xbox\s*one/i, 'Xbox One'], [/xbox\s*360/i, 'Xbox 360'], [/\bwii\s*u\b/i, 'Wii U'], [/\bwii\b/i, 'Wii'],
  [/\b3ds\b/i, 'Nintendo 3DS'], [/\bnintendo ds\b|\bds\b/i, 'Nintendo DS'], [/\bpc\b|windows/i, 'PC']];
/** a UPCitemdb product → { kind, title, platform, by, format, art, upc, brand } — which shelf it belongs on, from its category and title */
export function upcItem(x) {
  const t = String(x.title || '').trim();
  const cat = String(x.category || '');
  const all = `${t} ${cat} ${x.description || ''}`;
  const board = /board game|tabletop|card game|puzzle|toys\s*&\s*games\s*>\s*games/i.test(cat) && !/video game/i.test(cat);
  const video = /video game/i.test(cat) || PLAT_RE.some(([re]) => re.test(t));
  const book = !video && !board && /\bbooks?\b/i.test(cat) && !/comic book box|book ?case|bookend/i.test(cat);
  const movie = !video && !board && !book && (/dvds? ?& ?videos|movies|\bdvd\b|blu-?ray|4k ultra|\buhd\b|steelbook/i.test(cat) || /\b(dvd|blu-?ray|4k ultra hd|uhd)\b/i.test(t));
  const music = !video && !board && !book && !movie && (/music|vinyl|\bcds?\b|records?\b|albums?/i.test(cat) || /\b(vinyl|lp|cd)\b/i.test(t));
  const kind = board ? 'board' : book ? 'book' : movie ? 'movie' : music ? (/vinyl|\blp\b|\brecords?\b|\b(7|10|12)("|″|\s*inch)/i.test(all) && !/\bcd\b/i.test(t) ? 'vinyl' : 'cd') : 'video';
  const plat = kind === 'video' ? (PLAT_RE.find(([re]) => re.test(`${t} ${cat} ${x.model || ''}`))?.[1] || '') : '';
  // "Mario Kart 8 Deluxe - Nintendo Switch" → "Mario Kart 8 Deluxe"; "The Matrix (Blu-ray)" → "The Matrix"; "Abbey Road [Vinyl]" → "Abbey Road"
  let title = kind === 'video' ? t.replace(/\s*[-–(,]\s*(for\s+)?(sony\s+)?(playstation\s*\d|ps\d|nintendo\s+switch(\s*2)?|switch|xbox[\w\s|]*|wii\s*u?|nintendo\s+3?ds|pc)\b.*$/i, '').replace(/\s*\((standard|deluxe)? ?edition\)\s*$/i, '') : t;
  if (kind !== 'video') title = title.replace(/\s*[([](?:[^)\]]*\b(?:vinyl|lp|cd|dvd|blu-?ray|4k|uhd|ultra hd|steelbook|widescreen|digital|import|remaster(?:ed)?|hardcover|paperback)\b[^)\]]*)[)\]]/gi, '')
    .replace(/\s+[-–]\s+(vinyl|lp|cd|dvd|blu-?ray|4k ultra hd)\s*$/i, '').trim();
  const fm = /4k|uhd|ultra hd/i.test(all) ? 'uhd' : /blu-?ray/i.test(all) ? 'bluray' : /\bdvd\b/i.test(all) ? 'dvd' : '';
  return { kind, title: title.trim() || t, platform: plat, art: (x.images || [])[0] || '', upc: x.upc || x.ean || '', brand: x.brand || '',
    ...(kind === 'movie' ? { format: fm, steelbook: /steel ?book/i.test(all) || null } : {}), ...(kind === 'vinyl' ? { format: 'lp' } : kind === 'cd' ? { format: 'cd' } : {}),
    ...(kind === 'book' ? { publisher: x.publisher || x.brand || '' } : {}), ...(music ? { label: x.brand || '' } : {}) };
}
const upcErr = (e) => e?.status === 429 || /busy/i.test(e?.message || '');
async function upcDb(code) {
  const r = await get(`${conf.upcBase.replace(/\/$/, '')}/prod/trial/lookup?${new URLSearchParams({ upc: code })}`, { what: 'the barcode database', timeout: 12000 });
  let j = null; try { j = JSON.parse(r.text); } catch {}
  if (r.status === 429 || /TOO_FAST|EXCEED/i.test(j?.code || '')) throw fail('The free barcode lookup is busy (a few per minute, 100 a day) — type the title instead', 429);
  if (r.status === 404 || j?.code === 'INVALID_UPC' || !j?.items?.length) return [];
  if (r.status !== 200) throw fail(`Barcode lookup failed (${j?.message || r.status}) — type the title instead`, 502);
  return j.items.slice(0, 3).map(upcItem);
}
/** records & CDs: Discogs (with a token) or MusicBrainz know the barcode — artist, format, label, year */
async function musicBarcode(code) {
  if (secret('discogs.token')) { try { const r = await discogsSearch('', null, code); if (r.length) return r.slice(0, 3).map((x) => ({ ...x, upc: code })); } catch (e) { if (e.auth) log('collection', e.message); } }
  try { return await mbBarcode(code); } catch { return []; }
}
async function upcLookup(code) {
  if (conf.upcLookup === false) throw fail('Barcode lookup is turned off on the bridge (collection.upcLookup)', 400);
  const raw = String(code || '').replace(/[^\dXx]/g, '');
  code = raw.replace(/\D/g, '');
  const S = await sources();
  const isbn = S.isbnOf(raw);
  if (!isbn && (code.length < 8 || code.length > 14)) throw fail('A barcode number has 8 to 14 digits', 400);
  return cached(`upc:${raw}`, 24 * 3600e3, async () => {
    // a book's barcode is its ISBN (978… / 979…) → Open Library
    if (isbn) { try { const b = await isbnLookup(isbn); if (b) return { code: raw, items: [b] }; } catch (e) { log('collection', `ISBN ${isbn}: ${e.message}`); } }
    let items = [], busy = null;
    try { items = await upcDb(code); } catch (e) { if (!upcErr(e)) throw e; busy = e; }
    const m = items[0];
    // a record or CD: fill in the artist, format and label from Discogs / MusicBrainz
    if (m && (m.kind === 'vinyl' || m.kind === 'cd')) {
      const mu = await musicBarcode(code);
      if (mu.length) items = [{ ...mu[0], art: mu[0].art || m.art, kind: mu[0].kind || m.kind }, ...items.slice(1)];
    }
    if (!items.length) { const mu = await musicBarcode(code); if (mu.length) items = mu; }
    if (!items.length && busy) throw busy;
    if (isbn && !items.length) return { code: raw, items: [] };
    return { code: raw, items: items.map((x) => (isbn && !x.kind ? { ...x, kind: 'book' } : x)) };
  });
}

// ---------------------------------------------------------------- the inbox (phone → display) and the watched file
function addEntry(e) {
  const box = st.inbox;
  const now = Date.now();
  box.entries = box.entries.filter((x) => now - x.at < 48 * 3600e3).slice(-39);
  const entry = { id: 'i_' + now.toString(36) + crypto.randomBytes(3).toString('hex'), rev: ++box.rev, at: now, ...e };
  box.entries.push(entry);
  save();
  return entry;
}
let watchCheck = 0;
async function checkWatch() {
  const f = conf.watchFile;
  if (!f || Date.now() - watchCheck < 8000) return;
  watchCheck = Date.now();
  const p = path.resolve(path.dirname(file), f);
  let s;
  try { s = fs.statSync(p); } catch { st.watch = { ...st.watch, file: f, error: 'file not found' }; return; }
  if (st.watch.mtime === s.mtimeMs && st.watch.size === s.size && st.watch.file === f) return;
  try {
    const text = fs.readFileSync(p, 'utf8');
    const hash = crypto.createHash('sha1').update(text).digest('hex');
    st.watch = { ...st.watch, file: f, mtime: s.mtimeMs, size: s.size };
    if (st.watch.hash === hash) { save(); return; }
    const S = await sources();
    const r = S.importText(text, { preset: conf.watchPreset || 'auto' });
    if (r.error) { st.watch = { ...st.watch, error: r.error, at: Date.now() }; save(); return; }
    addEntry({ type: 'import', from: 'file', name: path.basename(p), preset: r.preset, presetName: r.presetName, items: r.items, wishes: r.wishes, skipped: r.skipped || 0 });
    st.watch = { ...st.watch, hash, at: Date.now(), count: r.items.length, preset: r.preset, error: '' };
    save();
    log('collection', `re-imported ${path.basename(p)} (${r.presetName}): ${r.items.length} games`);
  } catch (e) { st.watch = { ...st.watch, error: e.message }; save(); }
}

// a little flood protection: 40 writes / lookups a minute per address
const hits = new Map();
function limited(req, n = 40) {
  const ip = req.socket.remoteAddress || '';
  const now = Date.now();
  const h = (hits.get(ip) || []).filter((t) => now - t < 60000);
  h.push(now); hits.set(ip, h);
  return h.length > n;
}
function lanIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) if (!a.internal && (a.family === 'IPv4' || a.family === 4)) out.push({ name, address: a.address });
  const rank = (a) => (/^(docker|br-|veth|virbr|vmnet|vboxnet|tailscale|zt|utun)/i.test(a.name) ? 10 : 0) + (a.address.startsWith('192.168.') ? 0 : a.address.startsWith('10.') ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b)).map((a) => a.address);
}
function connInfo() {
  return {
    bgg: { username: st.bgg.username || conf.bgg?.username || '', hasToken: !!secret('bgg.token'), inConfig: !!conf.bgg?.token },
    pricecharting: { hasToken: !!secret('pricecharting.token'), inConfig: !!conf.pricecharting?.token },
    rawg: { username: st.rawg.username || conf.rawg?.username || '', hasKey: !!secret('rawg.key'), inConfig: !!conf.rawg?.key },
    discogs: { username: st.discogs.username || conf.discogs?.username || '', hasToken: !!secret('discogs.token'), inConfig: !!conf.discogs?.token },
    tmdb: { hasKey: !!secret('tmdb.key'), inConfig: !!conf.tmdb?.key },
  };
}
const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

export async function route(req, res, url, { cfg, cors, json, readJson, originAllowed, dir }) {
  load(cfg, dir);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (p === '/collection') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(PAGE);
  }
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!originAllowed(req)) return json(res, 403, { error: `origin ${req.headers.origin} not allowed` });
  const send = (code, data) => json(res, code, data);
  try {
    if (p === '/api/collection/info') {
      await checkWatch();
      return send(200, { app: 'roundremote-collection', ips: lanIps(), port: req.socket.localPort, publicUrl: conf.publicUrl || '', rev: st.inbox.rev, conns: connInfo(),
        watch: conf.watchFile ? { file: conf.watchFile, preset: conf.watchPreset || 'auto', at: st.watch.at || null, count: st.watch.count ?? null, error: st.watch.error || '' } : null, upc: conf.upcLookup !== false });
    }
    if (p === '/api/collection/config' && req.method === 'POST') {
      const b = await readJson(req);
      const set = (svc, f, v, max) => { if (v === undefined) return; st[svc] ||= {}; const s = clean(v, max); if (s) st[svc][f] = s; else delete st[svc][f]; };
      set('bgg', 'username', b.bgg?.username, 60); set('bgg', 'token', b.bgg?.token, 400);
      set('pricecharting', 'token', b.pricecharting?.token, 200);
      set('rawg', 'username', b.rawg?.username, 60); set('rawg', 'key', b.rawg?.key, 100);
      set('discogs', 'username', b.discogs?.username, 60); set('discogs', 'token', b.discogs?.token, 200);
      set('tmdb', 'key', b.tmdb?.key, 600);
      for (const k of [...cache.keys()]) if (/^(bgg|rawg|discogs|tmdb|upc)/.test(k)) cache.delete(k);
      save();
      return send(200, { ok: true, conns: connInfo() });
    }
    if (p === '/api/collection/bgg') {
      const user = url.searchParams.get('username') || '';
      const force = url.searchParams.get('force') === '1';
      if (force) cache.delete(`bgg:${user || st.bgg.username}`);
      return send(200, await cached(`bgg:${user || st.bgg.username}`, 10 * 60e3, () => bggSync(user)));
    }
    if (p === '/api/collection/pricecharting') return send(200, await pcSync());
    if (p === '/api/collection/rawg') return send(200, await rawgSync(url.searchParams.get('username')));
    if (p === '/api/collection/discogs') {
      const user = url.searchParams.get('username') || st.discogs.username || conf.discogs?.username || '';
      if (url.searchParams.get('force') === '1') cache.delete(`discogs:${user}`);
      return send(200, await cached(`discogs:${user}`, 10 * 60e3, () => discogsSync(user)));
    }
    if (p === '/api/collection/tmdb') return send(200, await cached(`tmdbd:${url.searchParams.get('type')}:${url.searchParams.get('id')}`, 24 * 3600e3, () => tmdbDetails(clean(url.searchParams.get('id'), 20), url.searchParams.get('type'))));
    if (p === '/api/collection/search') {
      const q = clean(url.searchParams.get('q'), 100);
      if (q.length < 2) return send(200, { items: [] });
      const src = url.searchParams.get('src');
      if (src === 'bgg') return send(200, { items: await cached(`bggs:${q.toLowerCase()}`, 30 * 60e3, () => bggSearch(q)) });
      if (src === 'rawg') return send(200, { items: await cached(`rawgs:${q.toLowerCase()}`, 30 * 60e3, () => rawgSearch(q)) });
      const kind = ['vinyl', 'cd', 'book', 'movie'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : '';
      if (src === 'discogs') return send(200, { items: await cached(`discogss:${kind}:${q.toLowerCase()}`, 30 * 60e3, () => discogsSearch(q, kind)) });
      if (src === 'musicbrainz') return send(200, { items: await cached(`mbs:${kind}:${q.toLowerCase()}`, 30 * 60e3, () => mbSearch(q, kind || 'vinyl')) });
      if (src === 'openlibrary') return send(200, { items: await cached(`ols:${q.toLowerCase()}`, 30 * 60e3, () => olSearch(q)) });
      if (src === 'tmdb') return send(200, { items: await cached(`tmdbs:${q.toLowerCase()}`, 30 * 60e3, () => tmdbSearch(q)) });
      return send(400, { error: 'src must be rawg, bgg, discogs, musicbrainz, openlibrary or tmdb' });
    }
    if (p === '/api/collection/upc') {
      if (limited(req, 20)) return send(429, { error: 'Slow down a little' });
      return send(200, await upcLookup(url.searchParams.get('code')));
    }
    if (p === '/api/collection/parse' && req.method === 'POST') {
      if (limited(req)) return send(429, { error: 'Slow down a little' });
      const b = await readJson(req);
      const S = await sources();
      const r = S.importText(String(b.text || ''), { preset: b.preset || 'auto', map: b.map || null });
      if (r.error) return send(400, { error: r.error });
      return send(200, { preset: r.preset, presetName: r.presetName, kind: r.kind, count: r.items.length, wishes: r.wishes.length, skipped: r.skipped || 0, total: r.total,
        headers: r.headers.slice(0, 60), map: r.map, kinds: r.items.reduce((o, x) => ({ ...o, [x.kind]: (o[x.kind] || 0) + 1 }), {}),
        sample: r.items.slice(0, 6).map((x) => ({ title: x.title, platform: x.platform ? S.platformName(x.platform) : '', by: x.kind === 'video' || x.kind === 'board' ? '' : x.by || '', players: x.players || null })) });
    }
    if (p === '/api/collection/inbox') {
      if (req.method === 'GET') {
        await checkWatch();
        const since = +url.searchParams.get('since') || 0;
        return send(200, { rev: st.inbox.rev, entries: st.inbox.entries.filter((e) => e.rev > since) });
      }
      if (req.method === 'POST') {
        if (limited(req)) return send(429, { error: 'Slow down a little' });
        const b = await readJson(req);
        if (b.type === 'import') {
          const S = await sources();
          const r = S.importText(String(b.text || ''), { preset: b.preset || 'auto', map: b.map || null });
          if (r.error) return send(400, { error: r.error });
          if (!r.items.length && !r.wishes.length) return send(400, { error: 'Nothing to import in this file' });
          const e = addEntry({ type: 'import', from: 'phone', name: clean(b.name, 80), preset: r.preset, presetName: r.presetName, items: r.items, wishes: r.wishes, skipped: r.skipped || 0 });
          log('collection', `phone import ${e.name || ''} (${r.presetName}): ${r.items.length} games, ${r.wishes.length} wishes`);
          return send(200, { ok: true, rev: e.rev, count: r.items.length, wishes: r.wishes.length });
        }
        if (b.type === 'item') {
          const it = b.item || {};
          const title = clean(it.title, 200);
          if (!title) return send(400, { error: 'Type a title first' });
          const S = await sources();
          const kind = S.KINDS.includes(it.kind) ? it.kind : 'video';
          const item = { kind, title, platform: kind === 'video' ? clean(it.platform, 40) : '', art: /^https?:\/\//.test(it.art || '') ? clean(it.art, 600) : '', upc: clean(it.upc, 20).replace(/\D/g, ''),
            ownership: kind === 'video' ? clean(it.ownership, 20) : '', notes: clean(it.notes, 300), by: clean(it.by, 120), format: clean(it.format, 20), isbn: S.isbnOf(it.isbn || ''),
            year: +it.year || null, label: clean(it.label, 80), catno: clean(it.catno, 40), publisher: clean(it.publisher, 80), pages: +it.pages || null, runtime: +it.runtime || null,
            genres: Array.isArray(it.genres) ? it.genres.slice(0, 4).map((g) => clean(g, 24)) : [], discogsId: clean(it.discogsId, 20), mbid: clean(it.mbid, 40), olid: clean(it.olid, 30),
            rpm: +it.rpm || null, discs: +it.discs || null, steelbook: it.steelbook ? true : null };
          const e = addEntry({ type: 'item', from: 'phone', item, by: clean(b.by, 40) });
          log('collection', `phone add: ${title}`);
          return send(200, { ok: true, rev: e.rev });
        }
        return send(400, { error: 'type must be import or item' });
      }
      return send(405, { error: 'method not allowed' });
    }
    return send(404, { error: 'not found' });
  } catch (e) {
    if (!e.status || e.status >= 500) log('collection', `${p}: ${e.message}`);
    return send(e.status && e.status < 600 ? e.status : 500, { error: e.message, setup: !!e.setup, auth: !!e.auth });
  }
}

// ---------------------------------------------------------------- the phone page (self-contained, EN + HE)
const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b1620">
<title>Collection — add from your phone</title>
<style>
:root{--bg:#0b1620;--card:#132230;--card2:#1b2e3e;--fg:#eef6fb;--muted:#a6b9c7;--dim:#6f8597;--line:#26394a;--c:#0ea5e9;--b:#f59e0b;--ok:#34d399;--err:#ff6b7d}
@media (prefers-color-scheme:light){:root{--bg:#f2f7fb;--card:#fff;--card2:#e8f0f6;--fg:#10202c;--muted:#4c6272;--dim:#8398a7;--line:#d6e2ea;--c:#0284c7;--b:#d97706}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 Inter,Rubik,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
body{padding:max(16px,env(safe-area-inset-top)) 16px 48px;max-width:560px;margin:0 auto}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none}
header{display:flex;align-items:center;gap:10px;margin:4px 2px 16px}
.logo{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,var(--c),var(--b));color:#fff;flex:none}
.logo svg{width:24px;height:24px;fill:currentColor}
h1{font-size:19px;margin:0;line-height:1.15}
.sub{color:var(--muted);font-size:13px}
.lang{margin-inline-start:auto;padding:6px 12px;border-radius:99px;background:var(--card2);font-weight:700;font-size:13px}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--card2);padding:5px;border-radius:99px;margin-bottom:14px}
.tabs button{padding:11px 4px;border-radius:99px;font-weight:800;color:var(--muted)}
.tabs button.on{background:var(--c);color:#fff}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:16px;margin-bottom:14px}
label.l{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:12px 0 6px}
label.l:first-child{margin-top:0}
.in{width:100%;padding:13px 15px;border-radius:14px;border:1px solid var(--line);background:var(--card2);outline:none;font-size:16px}
.in:focus{border-color:var(--c)}
.row{display:flex;gap:8px}.row>*{flex:1;min-width:0}
.seg{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.seg button{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:13px;padding:9px 4px}
.seg button svg{width:22px;height:22px;fill:var(--k,var(--c))}
.seg button{padding:11px;border-radius:14px;border:1px solid var(--line);background:var(--card2);font-weight:700;color:var(--muted)}
.seg button.on{border-color:var(--k,var(--c));color:var(--fg);background:color-mix(in srgb,var(--k,var(--c)) 20%,var(--card2))}
.big{width:100%;padding:15px;border-radius:99px;background:var(--c);color:#fff;font-weight:800;font-size:17px;margin-top:14px;transition:transform .15s,opacity .2s}
.big:active{transform:scale(.97)}.big:disabled{opacity:.45}
.ghost{width:100%;padding:13px;border-radius:99px;border:1px solid var(--line);background:var(--card2);font-weight:700;margin-top:10px}
.scan{display:flex;align-items:center;justify-content:center;gap:10px}
.scan svg{width:22px;height:22px;fill:currentColor}
video{width:100%;border-radius:14px;background:#000;margin-top:10px;max-height:260px;object-fit:cover}
.note{font-size:13px;color:var(--dim);margin-top:8px}
.found{display:flex;gap:12px;align-items:center;padding:12px;border-radius:14px;background:var(--card2);margin-top:12px}
.found img{width:56px;height:56px;object-fit:contain;border-radius:8px;background:#fff;flex:none}
.found b{display:block}
.prev{margin-top:12px;padding:12px 14px;border-radius:14px;background:var(--card2)}
.prev .n{font-size:24px;font-weight:800}
.prev .d{font-size:13px;color:var(--muted);margin-top:2px}
.prev ul{margin:8px 0 0;padding-inline-start:18px;color:var(--muted);font-size:14px}
.maps{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.maps label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--dim)}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);opacity:0;background:var(--fg);color:var(--bg);padding:11px 20px;border-radius:16px;font-weight:700;transition:.25s;pointer-events:none;z-index:9;max-width:90%;text-align:center}
.toast.show{opacity:1;transform:translate(-50%,0)}.toast.err{background:var(--err);color:#fff}
[hidden]{display:none!important}
</style></head>
<body>
<header><div class="logo"><svg viewBox="0 0 24 24"><path d="M3 4h4v16H3zm5 2h4v14H8zm5-3h3v17h-3zm4.2 2.3l2.9-.8 3.6 13.6-2.9.8z"/></svg></div>
<div><h1 data-t="title"></h1><div class="sub" data-t="sub"></div></div><button class="lang" id="lang"></button></header>
<div class="tabs" id="tabs"><button data-tab="add"></button><button data-tab="file"></button></div>

<section id="add">
  <div class="card">
    <div class="seg" id="kind"></div>
    <button class="ghost scan" id="scan" hidden><svg viewBox="0 0 24 24"><path d="M3 5h2v14H3zm3 0h1v14H6zm2 0h2v14H8zm3 0h1v14h-1zm3 0h2v14h-2zm3 0h1v14h-1zm2 0h2v14h-2z"/></svg><span data-t="scan"></span></button>
    <input type="file" id="photo" accept="image/*" capture="environment" hidden>
    <video id="cam" playsinline muted hidden></video>
    <div class="note" id="scanNote" hidden></div>
    <label class="l" for="upc" data-t="upc"></label>
    <div class="row"><input class="in" id="upc" inputmode="numeric" autocomplete="off" placeholder="0 45496 59036 3"><button class="ghost" id="look" style="flex:0 0 auto;width:auto;margin:0;padding:0 18px" data-t="look"></button></div>
    <div class="found" id="found" hidden><img id="fimg" alt=""><div><b id="ftitle"></b><span class="sub" id="fsub"></span></div></div>
    <label class="l" for="title" data-t="name"></label>
    <input class="in" id="title" dir="auto" maxlength="200" autocomplete="off">
    <div id="byWrap" hidden><label class="l" for="by" id="byLabel"></label>
    <input class="in" id="by" dir="auto" maxlength="120" autocomplete="off"></div>
    <div id="platWrap"><label class="l" for="plat" data-t="platform"></label>
    <input class="in" id="plat" list="plats" autocomplete="off" maxlength="40"><datalist id="plats"></datalist></div>
    <div id="fmtWrap" hidden><label class="l" for="fmt" data-t="format"></label><select class="in" id="fmt"></select></div>
    <div id="ownWrap"><label class="l" for="own" data-t="own"></label>
    <select class="in" id="own"><option value=""></option><option value="cib"></option><option value="loose"></option><option value="new"></option><option value="digital"></option></select></div>
    <button class="big" id="send" disabled data-t="send"></button>
  </div>
</section>

<section id="file" hidden>
  <div class="card">
    <label class="l" for="pick" data-t="file"></label>
    <input class="in" type="file" id="pick" accept=".csv,.txt,.json,.tsv,text/csv,application/json">
    <label class="l" for="preset" data-t="preset"></label>
    <select class="in" id="preset"></select>
    <div class="note" id="hint"></div>
    <div class="prev" id="prev" hidden></div>
    <div id="mapper" hidden>
      <label class="l" data-t="cols"></label>
      <div class="maps"><label><span data-t="c_title"></span><select class="in" id="mTitle"></select></label><label><span data-t="c_plat"></span><select class="in" id="mPlat"></select></label><label><span data-t="c_by"></span><select class="in" id="mBy"></select></label><label><span data-t="c_players"></span><select class="in" id="mPlayers"></select></label><label><span data-t="c_kind"></span><select class="in" id="mKind"><option value="video"></option><option value="board"></option><option value="book"></option><option value="vinyl"></option><option value="cd"></option><option value="movie"></option></select></label></div>
    </div>
    <button class="big" id="upload" disabled data-t="upload"></button>
  </div>
</section>
<div class="toast" id="toast"></div>
<script>
(() => {
const $ = (s) => document.querySelector(s);
const ls = { get: (k) => { try { return localStorage.getItem('rrcoll.' + k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('rrcoll.' + k, v); } catch {} } };
const T = {
  en: { title: 'Collection', sub: 'Add to the round display', add: 'Add', file: 'Import a file', video: 'Video game', board: 'Board game', book: 'Book', vinyl: 'Vinyl', cd: 'CD', movie: 'DVD / Blu-ray',
    by_book: 'Author', by_vinyl: 'Artist', by_cd: 'Artist', by_movie: 'Director', format: 'Format', c_by: 'Artist / author', f_: '—',
    kinds: { video: ['game', 'games'], board: ['board game', 'board games'], book: ['book', 'books'], vinyl: ['record', 'records'], cd: ['CD', 'CDs'], movie: ['disc', 'discs'] },
    scan: 'Scan barcode', upc: 'Barcode number (UPC / EAN)', look: 'Look up', name: 'Title', platform: 'Platform', own: 'What you have',
    o_: '—', o_cib: 'Complete in box', o_loose: 'Loose (game only)', o_new: 'New / sealed', o_digital: 'Digital',
    send: 'Send to the display', sent: 'Sent! It’s on the display now ✓', preset: 'What exported it?', cols: 'Which columns?', upload: 'Send to the display',
    p_auto: 'Detect it for me', notFound: 'Not in the barcode database — type the title', looking: 'Looking it up…', scanning: 'Point the camera at the barcode…',
    noCam: 'Live scanning needs this page over https — take a photo of the barcode, or type the number.', noScan: 'This browser can’t read barcodes — type the number under the barcode.',
    games: (n) => n + (n === 1 ? ' game' : ' games'), found: (p, w, s) => [p, w ? w + ' to Wish Lists' : '', s ? s + (s === 1 ? ' row skipped' : ' rows skipped') : ''].filter(Boolean).join(' · '),
    imported: (n) => 'Sent ' + n + ' items to the display ✓', c_title: 'Title', c_plat: 'Platform', c_players: 'Players', c_kind: 'Kind', none: '— none —', offline: 'Can’t reach the bridge' },
  he: { title: 'האוסף', sub: 'הוספה למסך העגול', add: 'הוספה', file: 'ייבוא קובץ', video: 'משחק וידאו', board: 'משחק קופסה', book: 'ספר', vinyl: 'תקליט', cd: 'דיסק', movie: 'DVD / בלו-ריי',
    by_book: 'סופר/ת', by_vinyl: 'אמן', by_cd: 'אמן', by_movie: 'במאי', format: 'פורמט', c_by: 'אמן / סופר', f_: '—',
    kinds: { video: ['משחק', 'משחקים'], board: ['משחק קופסה', 'משחקי קופסה'], book: ['ספר', 'ספרים'], vinyl: ['תקליט', 'תקליטים'], cd: ['דיסק', 'דיסקים'], movie: ['סרט', 'סרטים'] },
    scan: 'סריקת ברקוד', upc: 'מספר ברקוד (UPC / EAN)', look: 'חיפוש', name: 'שם', platform: 'פלטפורמה', own: 'מה יש לך',
    o_: '—', o_cib: 'מלא בקופסה', o_loose: 'דיסק / קלטת בלבד', o_new: 'חדש / סגור', o_digital: 'דיגיטלי',
    send: 'שליחה למסך', sent: 'נשלח! זה כבר על המסך ✓', preset: 'מאיזו אפליקציה הייצוא?', cols: 'אילו עמודות?', upload: 'שליחה למסך',
    p_auto: 'לזהות לבד', notFound: 'לא נמצא במאגר הברקודים — כתבו את השם', looking: 'מחפש…', scanning: 'כוונו את המצלמה לברקוד…',
    noCam: 'סריקה חיה דורשת https — צלמו את הברקוד או הקלידו את המספר.', noScan: 'הדפדפן לא קורא ברקודים — הקלידו את המספר שמתחת לברקוד.',
    games: (n) => n + ' פריטים', found: (p, w, s) => [p, w ? w + ' ברשימת המשאלות' : '', s ? s + ' שורות דולגו' : ''].filter(Boolean).join(' · '),
    imported: (n) => 'נשלחו ' + n + ' משחקים למסך ✓', c_title: 'שם', c_plat: 'פלטפורמה', c_players: 'שחקנים', c_kind: 'סוג', none: '— אין —', offline: 'אין חיבור לגשר' },
};
const PRESETS = [['auto'], ['gameye', 'GamEye'], ['clz', 'CLZ Games'], ['grouvee', 'Grouvee'], ['bggcsv', 'BoardGameGeek (CSV)'], ['bgstats', 'BG Stats (JSON)'], ['discogscsv', 'Discogs (CSV)'],
  ['goodreads', 'Goodreads (CSV)'], ['clzbooks', 'CLZ Books'], ['clzmusic', 'CLZ Music'], ['clzmovies', 'CLZ Movies'], ['generic', { en: 'Another spreadsheet', he: 'גיליון אחר' }]];
const HINTS = { gameye: 'GamEye → Settings → Export → CSV', clz: 'CLZ Games → Menu → Export to CSV', grouvee: 'grouvee.com → Settings → Export', bggcsv: 'boardgamegeek.com → Collection → Export', bgstats: 'BG Stats → Settings → Backup & export → JSON',
  discogscsv: 'discogs.com → Collection → Export (CSV)', goodreads: 'goodreads.com → My Books → Import and export → Export library', clzbooks: 'CLZ Books → Export to CSV', clzmusic: 'CLZ Music → Export to CSV', clzmovies: 'CLZ Movies → Export to CSV', generic: '' };
const KINDS = ['video', 'board', 'book', 'vinyl', 'cd', 'movie'];
const KCOL = { video: '#0ea5e9', board: '#f59e0b', book: '#8b5cf6', vinyl: '#f43f5e', cd: '#14b8a6', movie: '#65a30d' };
const KIC = { video: 'M7 6h10a5 5 0 0 1 4.9 6l-.9 4.4a2.6 2.6 0 0 1-4.6 1.1L14.6 15H9.4l-1.8 2.5A2.6 2.6 0 0 1 3 16.4L2.1 12A5 5 0 0 1 7 6zm0 3v1.5H5.5v2H7V14h2v-1.5h1.5v-2H9V9z',
  board: 'M12 2.5a3.2 3.2 0 0 1 3.2 3.2c0 .9-.4 1.8-1 2.4 2.9.6 6.3 1.8 6.3 3.4 0 1.1-1.8 1.4-3.3 1.4l2.6 5.3c.4.8-.2 1.8-1.1 1.8h-3.6L12 15.6 8.9 20h-3.6c-.9 0-1.5-1-1.1-1.8l2.6-5.3c-1.5 0-3.3-.3-3.3-1.4 0-1.6 3.4-2.8 6.3-3.4a3.2 3.2 0 0 1 2.2-5.6z',
  book: 'M6 2h12a1 1 0 0 1 1 1v15H7.5a1.5 1.5 0 0 0 0 3H19v1H7.5A3.5 3.5 0 0 1 4 18.5V4a2 2 0 0 1 2-2zm3 4v2h7V6z',
  vinyl: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0zM8.7 12a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0-6.6 0zM11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0z',
  cd: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0zM9.2 12a2.8 2.8 0 1 0 5.6 0a2.8 2.8 0 1 0-5.6 0z',
  movie: 'M4 10h17v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM3.3 6.4l14.6-3.9a1 1 0 0 1 1.2.7l.6 2.3-16 4.3-.6-2.3a1 1 0 0 1 .2-1.1z' };
const FMTS = { book: [['hardcover', 'Hardcover'], ['paperback', 'Paperback'], ['comic', 'Comic / graphic novel'], ['boardbook', 'Board book']], vinyl: [['lp', 'LP'], ['2lp', '2LP'], ['3lp', '3LP+'], ['ep', 'EP'], ['7', '7″'], ['10', '10″'], ['12', '12″ single'], ['box', 'Box set']],
  cd: [['cd', 'CD'], ['2cd', '2CD+'], ['sacd', 'SACD'], ['single', 'CD single'], ['box', 'Box set'], ['cassette', 'Cassette']], movie: [['dvd', 'DVD'], ['bluray', 'Blu-ray'], ['uhd', '4K UHD'], ['bluray3d', 'Blu-ray 3D'], ['vhs', 'VHS']] };
const PLATS = ['PlayStation 5', 'PlayStation 4', 'Nintendo Switch', 'Nintendo Switch 2', 'Xbox Series X|S', 'Xbox One', 'PC', 'PlayStation 3', 'Xbox 360', 'Wii', 'Wii U', 'Nintendo 3DS', 'Nintendo DS', 'PlayStation 2', 'GameCube', 'Nintendo 64', 'Super Nintendo', 'NES', 'Game Boy Advance', 'PlayStation'];
let lang = ls.get('lang') || (/^(he|iw)/i.test(navigator.language || '') ? 'he' : 'en');
const t = (k) => T[lang][k] ?? T.en[k] ?? k;
let tab = ls.get('tab') || 'add', kind = ls.get('kind') || 'video', fileText = '', fileName = '', parsed = null, busy = false, found = null;

function toast(m, err) { const el = $('#toast'); el.textContent = m; el.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => el.className = 'toast', 2600); }
async function api(p, o = {}) {
  let r;
  try { r = await fetch(p, { ...o, headers: { 'Content-Type': 'application/json' } }); } catch { throw new Error(t('offline')); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}
function render() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((el) => { const v = t(el.dataset.t); if (typeof v === 'string') el.textContent = v; });
  $('#lang').textContent = lang === 'he' ? 'EN' : 'עב';
  document.querySelectorAll('[data-tab]').forEach((b) => { b.textContent = t(b.dataset.tab); b.classList.toggle('on', b.dataset.tab === tab); });
  $('#add').hidden = tab !== 'add'; $('#file').hidden = tab !== 'file';
  const seg = $('#kind');
  if (!seg.children.length) for (const k of KINDS) { const b = document.createElement('button'); b.dataset.k = k; b.style.setProperty('--k', KCOL[k]); b.onclick = () => { kind = k; ls.set('kind', kind); found = null; $('#found').hidden = true; render(); }; seg.append(b); }
  seg.querySelectorAll('[data-k]').forEach((b) => { b.innerHTML = '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="' + KIC[b.dataset.k] + '"/></svg><span></span>'; b.lastChild.textContent = t(b.dataset.k); b.classList.toggle('on', b.dataset.k === kind); });
  $('#platWrap').hidden = kind !== 'video'; $('#ownWrap').hidden = kind !== 'video';
  $('#byWrap').hidden = kind === 'video' || kind === 'board'; $('#byLabel').textContent = t('by_' + kind);
  $('#fmtWrap').hidden = !FMTS[kind];
  if (FMTS[kind]) { const f = $('#fmt'), cur = f.dataset.kind === kind ? f.value : ''; f.textContent = ''; f.dataset.kind = kind; for (const [v, l] of [['', t('f_')], ...FMTS[kind]]) { const o = document.createElement('option'); o.value = v; o.textContent = l; f.append(o); } f.value = cur; }
  document.querySelectorAll('#own option').forEach((o) => o.textContent = t('o_' + o.value));
  const sel = $('#preset'), cur = sel.value || ls.get('preset') || 'auto';
  sel.textContent = '';
  for (const [id, name] of PRESETS) { const o = document.createElement('option'); o.value = id; o.textContent = id === 'auto' ? t('p_auto') : typeof name === 'object' ? name[lang] : name; sel.append(o); }
  sel.value = cur;
  $('#hint').textContent = HINTS[cur] || '';
  document.querySelectorAll('#mKind option').forEach((o) => o.textContent = t(o.value));
  $('#plats').textContent = ''; for (const p of PLATS) { const o = document.createElement('option'); o.value = p; $('#plats').append(o); }
  check(); preview();
}
function check() { $('#send').disabled = busy || !$('#title').value.trim(); $('#upload').disabled = busy || !parsed || !parsed.count && !parsed.wishes; }

// ------------------------------------------------ barcode
const canDetect = 'BarcodeDetector' in window;
const canCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
let detector = null, stream = null, scanning = false;
if (canDetect) { try { detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }); } catch { detector = null; } }
$('#scan').hidden = !detector;
if (!detector) { $('#scanNote').hidden = false; $('#scanNote').dataset.t = 'noScan'; }
else if (!canCam) { $('#scanNote').hidden = false; $('#scanNote').dataset.t = 'noCam'; }
$('#scan').onclick = async () => {
  if (!detector) return;
  if (!canCam) { $('#photo').click(); return; }
  if (scanning) return stopCam();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('#cam'); v.srcObject = stream; v.hidden = false; await v.play(); scanning = true; toast(t('scanning'));
    const tick = async () => {
      if (!scanning) return;
      try { const codes = await detector.detect(v); if (codes.length) { stopCam(); $('#upc').value = codes[0].rawValue; lookup(); return; } } catch {}
      setTimeout(tick, 250);
    };
    tick();
  } catch (e) { toast(e.message, true); $('#photo').click(); }
};
function stopCam() { scanning = false; if (stream) stream.getTracks().forEach((x) => x.stop()); stream = null; $('#cam').hidden = true; }
$('#photo').onchange = async () => {
  const f = $('#photo').files[0]; if (!f) return;
  try { const bmp = await createImageBitmap(f); const codes = await detector.detect(bmp); if (codes.length) { $('#upc').value = codes[0].rawValue; lookup(); } else toast(t('notFound'), true); }
  catch (e) { toast(e.message, true); }
  $('#photo').value = '';
};
async function lookup() {
  const code = $('#upc').value.replace(/\\D/g, '');
  if (code.length < 8) return;
  $('#look').textContent = t('looking');
  try {
    const d = await api('/api/collection/upc?code=' + code);
    const it = d.items && d.items[0];
    if (!it) { toast(t('notFound'), true); $('#found').hidden = true; found = null; $('#title').focus(); }
    else {
      found = it;
      $('#found').hidden = false; $('#fimg').hidden = !it.art; if (it.art) $('#fimg').src = it.art;
      $('#ftitle').textContent = it.title; $('#fsub').textContent = [t(it.kind), it.by, it.platform, it.year, it.label || it.publisher || it.brand].filter(Boolean).join(' · ');
      if (KINDS.includes(it.kind) && it.kind !== kind) { kind = it.kind; ls.set('kind', kind); }
      render();
      $('#title').value = it.title; if (it.platform) $('#plat').value = it.platform; $('#by').value = it.by || '';
      if (it.format) $('#fmt').value = it.format;
    }
  } catch (e) { toast(e.message, true); $('#title').focus(); }
  $('#look').textContent = t('look'); render();
}
$('#look').onclick = lookup;
$('#upc').onkeydown = (e) => { if (e.key === 'Enter') lookup(); };
$('#title').oninput = check;
$('#send').onclick = async () => {
  if (busy) return; busy = true; check();
  try {
    const f = found && found.kind === kind ? found : {};
    const item = { ...f, kind, title: $('#title').value.trim(), platform: kind === 'video' ? $('#plat').value.trim() : '', ownership: kind === 'video' ? $('#own').value : '', art: f.art || '', upc: $('#upc').value,
      by: kind === 'video' || kind === 'board' ? '' : $('#by').value.trim(), format: FMTS[kind] ? $('#fmt').value : '' };
    await api('/api/collection/inbox', { method: 'POST', body: JSON.stringify({ type: 'item', item }) });
    toast(t('sent')); $('#title').value = ''; $('#upc').value = ''; $('#by').value = ''; $('#found').hidden = true; found = null;
    if (navigator.vibrate) navigator.vibrate(20);
  } catch (e) { toast(e.message, true); }
  busy = false; check();
};

// ------------------------------------------------ file import
function opts(sel, headers, cur, none) {
  sel.textContent = '';
  if (none) { const o = document.createElement('option'); o.value = '-1'; o.textContent = t('none'); sel.append(o); }
  headers.forEach((h, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = h || ('#' + (i + 1)); sel.append(o); });
  sel.value = String(cur == null ? -1 : cur);
}
function mapNow() { return { title: +$('#mTitle').value, platform: +$('#mPlat').value, by: +$('#mBy').value, players: +$('#mPlayers').value, kind: $('#mKind').value }; }
let mapTouched = false;
async function parse() {
  parsed = null; check();
  if (!fileText) return preview();
  const preset = $('#preset').value;
  try {
    parsed = await api('/api/collection/parse', { method: 'POST', body: JSON.stringify({ text: fileText, preset, map: preset === 'generic' && mapTouched ? mapNow() : null }) });
    if (parsed.map && !mapTouched) {
      opts($('#mTitle'), parsed.headers, parsed.map.title, false); opts($('#mPlat'), parsed.headers, parsed.map.platform, true); opts($('#mPlayers'), parsed.headers, parsed.map.players, true); opts($('#mBy'), parsed.headers, parsed.map.by, true);
      $('#mKind').value = parsed.map.kind || 'video';
    }
  } catch (e) { parsed = { error: e.message }; }
  preview(); check();
}
function preview() {
  const p = $('#prev');
  $('#mapper').hidden = !(parsed && parsed.preset === 'generic' && parsed.headers && parsed.headers.length);
  if (!parsed) { p.hidden = true; return; }
  p.hidden = false; p.textContent = '';
  if (parsed.error) { p.textContent = parsed.error; return; }
  const n = document.createElement('div'); n.className = 'n';
  const ks = Object.entries(parsed.kinds || {});
  n.textContent = ks.length ? ks.map(([k, c]) => c + ' ' + ((T[lang].kinds || T.en.kinds)[k] || [k, k])[c === 1 ? 0 : 1]).join(' · ') : t('games')(parsed.count);
  const d = document.createElement('div'); d.className = 'd'; d.textContent = t('found')(parsed.presetName, parsed.wishes, parsed.skipped);
  const ul = document.createElement('ul');
  for (const s of parsed.sample || []) { const li = document.createElement('li'); li.dir = 'auto'; li.textContent = s.title + (s.by ? ' · ' + s.by : '') + (s.platform ? ' · ' + s.platform : '') + (s.players ? ' · ' + s.players.join('–') : ''); ul.append(li); }
  p.append(n, d, ul);
}
$('#pick').onchange = async () => {
  const f = $('#pick').files[0]; if (!f) return;
  if (f.size > 1.8e6) { toast('Too big (max 1.8 MB)', true); return; }
  fileText = await f.text(); fileName = f.name; mapTouched = false;
  if (/\\.json$/i.test(f.name) && $('#preset').value !== 'bgstats') $('#preset').value = 'auto';
  parse();
};
$('#preset').onchange = () => { ls.set('preset', $('#preset').value); $('#hint').textContent = HINTS[$('#preset').value] || ''; mapTouched = false; parse(); };
['#mTitle', '#mPlat', '#mBy', '#mPlayers', '#mKind'].forEach((s) => $(s).onchange = () => { mapTouched = true; parse(); });
$('#upload').onclick = async () => {
  if (busy || !parsed) return; busy = true; check();
  try {
    const preset = $('#preset').value;
    const d = await api('/api/collection/inbox', { method: 'POST', body: JSON.stringify({ type: 'import', text: fileText, name: fileName, preset, map: preset === 'generic' ? mapNow() : null }) });
    toast(t('imported')(d.count)); if (navigator.vibrate) navigator.vibrate(20);
  } catch (e) { toast(e.message, true); }
  busy = false; check();
};
document.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; ls.set('tab', tab); stopCam(); render(); });
$('#lang').onclick = () => { lang = lang === 'he' ? 'en' : 'he'; ls.set('lang', lang); render(); };
const q = new URLSearchParams(location.search); if (q.get('tab')) tab = q.get('tab') === 'file' ? 'file' : 'add'; if (KINDS.includes(q.get('kind'))) kind = q.get('kind');
if (!KINDS.includes(kind)) kind = 'video';
render();
})();
</script>
</body></html>`;
