// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Collection app (apps/collection.js) — the bridge side: syncs with the collection services that need a server
// (no CORS, or a secret that shouldn't live in the browser) and the phone page for imports and barcodes.
//
//   GET  /collection                     phone page: upload a CSV / JSON export, scan a barcode or type a game → the display
//   GET  /api/collection/info            { ips, port, publicUrl, rev, conns: { bgg, pricecharting, rawg }, watch, upc }
//   POST /api/collection/config          { bgg: { username, token }, pricecharting: { token }, rawg: { username, key } }
//                                        ('' clears a secret, a missing field keeps it) — saved in bridge/collection.json
//   GET  /api/collection/bgg             BoardGameGeek collection (own=1, + expansions) — XML API2 with your app token
//   GET  /api/collection/pricecharting   PriceCharting collection (offers?status=collection) — your API token
//   GET  /api/collection/rawg            RAWG library (statuses=owned, every page) — your RAWG key
//   GET  /api/collection/search?src=rawg|bgg&q=…   search to add a game by hand (with covers)
//   GET  /api/collection/upc?code=…      barcode → product (UPCitemdb's free trial endpoint; rate-limited)
//   POST /api/collection/parse           { text, preset, map } → what the file holds (the phone page's preview)
//   GET  /api/collection/inbox?since=rev entries for the display: { rev, entries: [{ id, rev, at, type: 'import'|'item', … }] }
//   POST /api/collection/inbox           { type: 'import', preset, name, text, map } | { type: 'item', item }
//
// Secrets (BGG token, PriceCharting token, RAWG key) come from bridge/config.json → "collection", or are posted once
// from the display's settings and kept in bridge/collection.json. They are only ever sent to their own service.
// A "watched file" (config collection.watchFile) is re-imported whenever it changes (e.g. a synced GamEye export).
//
// config.json → "collection": { file, publicUrl, bgg: { username, token }, pricecharting: { token }, rawg: { username, key },
//   watchFile, watchPreset, upcLookup, bggBase, pricechartingBase, rawgBase, upcBase, bggRetryMs }
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
      baseIds: kids(it, 'link').filter((l) => l.attrs.type === 'boardgameexpansion' && l.attrs.inbound === 'true').map((l) => l.attrs.id),
    });
  }
  return out;
}

// ---------------------------------------------------------------- state (bridge/collection.json)
let st = null, file = null, conf = null;
function load(cfg, dir) {
  conf = { publicUrl: '', upcLookup: true, watchPreset: 'auto', bggBase: 'https://boardgamegeek.com', pricechartingBase: 'https://www.pricecharting.com', rawgBase: 'https://api.rawg.io',
    upcBase: 'https://api.upcitemdb.com', bggRetryMs: 2000, ...(cfg.collection || {}) };
  if (st) return;
  file = path.resolve(dir, conf.file || 'collection.json');
  st = { bgg: {}, pricecharting: {}, rawg: {}, inbox: { rev: 0, entries: [] }, watch: {} };
  try { if (fs.existsSync(file)) st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { log('collection', `could not read ${file}: ${e.message}`); }
  st.inbox ||= { rev: 0, entries: [] };
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
  try { r = await fetch(url, { headers: { 'User-Agent': 'RoundRemote-Collection/1.0', ...headers }, signal: AbortSignal.timeout(timeout) }); }
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
  return { username, items: [...base, ...exps], counts: { games: base.length, expansions: exps.length }, at: Date.now() };
}
async function bggSearch(q) {
  const doc = parseXml(await bggGet(`search?${new URLSearchParams({ query: q, type: 'boardgame' })}`, { retries: 2 }));
  const hits = kids(kid(doc, 'items'), 'item').slice(0, 12).map((it) => ({ bggId: it.attrs.id, title: (kids(it, 'name').find((n) => n.attrs.type === 'primary') || kid(it, 'name'))?.attrs?.value || '', year: intOr(val(it, 'yearpublished')) }));
  if (!hits.length) return [];
  let things = new Map();
  try { things = bggThings(await bggGet(`thing?id=${hits.map((x) => x.bggId).join(',')}`, { retries: 2 })); } catch (e) { if (e.auth) throw e; }
  return hits.map((x) => ({ ...x, ...(things.get(x.bggId) || {}), title: things.get(x.bggId)?.title || x.title, kind: 'board', source: 'bgg', sid: x.bggId }));
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

// UPCitemdb's free trial: 100 lookups a day, a few a minute. Fails often → the phone falls back to typing.
const PLAT_RE = [[/\bps5\b|playstation\s*5/i, 'PlayStation 5'], [/\bps4\b|playstation\s*4/i, 'PlayStation 4'], [/\bps3\b|playstation\s*3/i, 'PlayStation 3'], [/switch\s*2/i, 'Nintendo Switch 2'],
  [/nintendo\s*switch|\bswitch\b/i, 'Nintendo Switch'], [/xbox\s*series/i, 'Xbox Series X|S'], [/xbox\s*one/i, 'Xbox One'], [/xbox\s*360/i, 'Xbox 360'], [/\bwii\s*u\b/i, 'Wii U'], [/\bwii\b/i, 'Wii'],
  [/\b3ds\b/i, 'Nintendo 3DS'], [/\bnintendo ds\b|\bds\b/i, 'Nintendo DS'], [/\bpc\b|windows/i, 'PC']];
export function upcItem(x) {
  const t = String(x.title || '').trim();
  const cat = String(x.category || '');
  const board = /board game|tabletop|card game|puzzle|toys\s*&\s*games\s*>\s*games/i.test(cat) && !/video game/i.test(cat);
  const plat = board ? '' : (PLAT_RE.find(([re]) => re.test(`${t} ${cat} ${x.model || ''}`))?.[1] || '');
  // "Mario Kart 8 Deluxe - Nintendo Switch" → "Mario Kart 8 Deluxe"
  const title = t.replace(/\s*[-–(,]\s*(for\s+)?(sony\s+)?(playstation\s*\d|ps\d|nintendo\s+switch(\s*2)?|switch|xbox[\w\s|]*|wii\s*u?|nintendo\s+3?ds|pc)\b.*$/i, '').replace(/\s*\((standard|deluxe)? ?edition\)\s*$/i, '').trim() || t;
  return { kind: board ? 'board' : 'video', title, platform: plat, art: (x.images || [])[0] || '', upc: x.upc || x.ean || '', brand: x.brand || '' };
}
async function upcLookup(code) {
  if (conf.upcLookup === false) throw fail('Barcode lookup is turned off on the bridge (collection.upcLookup)', 400);
  code = String(code || '').replace(/\D/g, '');
  if (code.length < 8 || code.length > 14) throw fail('A barcode number has 8 to 14 digits', 400);
  return cached(`upc:${code}`, 24 * 3600e3, async () => {
    const r = await get(`${conf.upcBase.replace(/\/$/, '')}/prod/trial/lookup?${new URLSearchParams({ upc: code })}`, { what: 'the barcode database', timeout: 12000 });
    let j = null; try { j = JSON.parse(r.text); } catch {}
    if (r.status === 429 || /TOO_FAST|EXCEED/i.test(j?.code || '')) throw fail('The free barcode lookup is busy (a few per minute, 100 a day) — type the title instead', 429);
    if (r.status === 404 || j?.code === 'INVALID_UPC' || !j?.items?.length) return { code, items: [] };
    if (r.status !== 200) throw fail(`Barcode lookup failed (${j?.message || r.status}) — type the title instead`, 502);
    return { code, items: j.items.slice(0, 3).map(upcItem) };
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
      for (const k of [...cache.keys()]) if (/^(bgg|rawg)/.test(k)) cache.delete(k);
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
    if (p === '/api/collection/search') {
      const q = clean(url.searchParams.get('q'), 100);
      if (q.length < 2) return send(200, { items: [] });
      const src = url.searchParams.get('src');
      if (src === 'bgg') return send(200, { items: await cached(`bggs:${q.toLowerCase()}`, 30 * 60e3, () => bggSearch(q)) });
      if (src === 'rawg') return send(200, { items: await cached(`rawgs:${q.toLowerCase()}`, 30 * 60e3, () => rawgSearch(q)) });
      return send(400, { error: 'src must be rawg or bgg' });
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
        headers: r.headers.slice(0, 60), map: r.map, sample: r.items.slice(0, 6).map((x) => ({ title: x.title, platform: x.platform ? S.platformName(x.platform) : '', players: x.players || null })) });
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
          const item = { kind: it.kind === 'board' ? 'board' : 'video', title, platform: clean(it.platform, 40), art: /^https?:\/\//.test(it.art || '') ? clean(it.art, 600) : '', upc: clean(it.upc, 20).replace(/\D/g, ''),
            ownership: clean(it.ownership, 20), notes: clean(it.notes, 300) };
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
.seg{display:grid;grid-template-columns:1fr 1fr;gap:6px}
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
    <div class="seg" id="kind"><button data-k="video" style="--k:var(--c)"></button><button data-k="board" style="--k:var(--b)"></button></div>
    <button class="ghost scan" id="scan" hidden><svg viewBox="0 0 24 24"><path d="M3 5h2v14H3zm3 0h1v14H6zm2 0h2v14H8zm3 0h1v14h-1zm3 0h2v14h-2zm3 0h1v14h-1zm2 0h2v14h-2z"/></svg><span data-t="scan"></span></button>
    <input type="file" id="photo" accept="image/*" capture="environment" hidden>
    <video id="cam" playsinline muted hidden></video>
    <div class="note" id="scanNote" hidden></div>
    <label class="l" for="upc" data-t="upc"></label>
    <div class="row"><input class="in" id="upc" inputmode="numeric" autocomplete="off" placeholder="0 45496 59036 3"><button class="ghost" id="look" style="flex:0 0 auto;width:auto;margin:0;padding:0 18px" data-t="look"></button></div>
    <div class="found" id="found" hidden><img id="fimg" alt=""><div><b id="ftitle"></b><span class="sub" id="fsub"></span></div></div>
    <label class="l" for="title" data-t="name"></label>
    <input class="in" id="title" dir="auto" maxlength="200" autocomplete="off">
    <div id="platWrap"><label class="l" for="plat" data-t="platform"></label>
    <input class="in" id="plat" list="plats" autocomplete="off" maxlength="40"><datalist id="plats"></datalist></div>
    <label class="l" for="own" data-t="own"></label>
    <select class="in" id="own"><option value=""></option><option value="cib"></option><option value="loose"></option><option value="new"></option><option value="digital"></option></select>
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
      <div class="maps"><label><span data-t="c_title"></span><select class="in" id="mTitle"></select></label><label><span data-t="c_plat"></span><select class="in" id="mPlat"></select></label><label><span data-t="c_players"></span><select class="in" id="mPlayers"></select></label><label><span data-t="c_kind"></span><select class="in" id="mKind"><option value="video"></option><option value="board"></option></select></label></div>
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
  en: { title: 'Collection', sub: 'Add to the round display', add: 'Add a game', file: 'Import a file', video: 'Video game', board: 'Board game',
    scan: 'Scan barcode', upc: 'Barcode number (UPC / EAN)', look: 'Look up', name: 'Title', platform: 'Platform', own: 'What you have',
    o_: '—', o_cib: 'Complete in box', o_loose: 'Loose (game only)', o_new: 'New / sealed', o_digital: 'Digital',
    send: 'Send to the display', sent: 'Sent! It’s on the display now ✓', preset: 'What exported it?', cols: 'Which columns?', upload: 'Send to the display',
    p_auto: 'Detect it for me', notFound: 'Not in the barcode database — type the title', looking: 'Looking it up…', scanning: 'Point the camera at the barcode…',
    noCam: 'Live scanning needs this page over https — take a photo of the barcode, or type the number.', noScan: 'This browser can’t read barcodes — type the number under the barcode.',
    games: (n) => n + (n === 1 ? ' game' : ' games'), found: (p, w, s) => [p, w ? w + (w === 1 ? ' wish-list game' : ' wish-list games') : '', s ? s + (s === 1 ? ' row skipped' : ' rows skipped') : ''].filter(Boolean).join(' · '),
    imported: (n) => 'Sent ' + n + ' games to the display ✓', c_title: 'Title', c_plat: 'Platform', c_players: 'Players', c_kind: 'Kind', none: '— none —', offline: 'Can’t reach the bridge' },
  he: { title: 'האוסף', sub: 'הוספה למסך העגול', add: 'הוספת משחק', file: 'ייבוא קובץ', video: 'משחק וידאו', board: 'משחק קופסה',
    scan: 'סריקת ברקוד', upc: 'מספר ברקוד (UPC / EAN)', look: 'חיפוש', name: 'שם', platform: 'פלטפורמה', own: 'מה יש לך',
    o_: '—', o_cib: 'מלא בקופסה', o_loose: 'דיסק / קלטת בלבד', o_new: 'חדש / סגור', o_digital: 'דיגיטלי',
    send: 'שליחה למסך', sent: 'נשלח! זה כבר על המסך ✓', preset: 'מאיזו אפליקציה הייצוא?', cols: 'אילו עמודות?', upload: 'שליחה למסך',
    p_auto: 'לזהות לבד', notFound: 'לא נמצא במאגר הברקודים — כתבו את השם', looking: 'מחפש…', scanning: 'כוונו את המצלמה לברקוד…',
    noCam: 'סריקה חיה דורשת https — צלמו את הברקוד או הקלידו את המספר.', noScan: 'הדפדפן לא קורא ברקודים — הקלידו את המספר שמתחת לברקוד.',
    games: (n) => n + ' משחקים', found: (p, w, s) => [p, w ? w + ' ברשימת המשאלות' : '', s ? s + ' שורות דולגו' : ''].filter(Boolean).join(' · '),
    imported: (n) => 'נשלחו ' + n + ' משחקים למסך ✓', c_title: 'שם', c_plat: 'פלטפורמה', c_players: 'שחקנים', c_kind: 'סוג', none: '— אין —', offline: 'אין חיבור לגשר' },
};
const PRESETS = [['auto'], ['gameye', 'GamEye'], ['clz', 'CLZ Games'], ['grouvee', 'Grouvee'], ['bggcsv', 'BoardGameGeek (CSV)'], ['bgstats', 'BG Stats (JSON)'], ['generic', { en: 'Another spreadsheet', he: 'גיליון אחר' }]];
const HINTS = { gameye: 'GamEye → Settings → Export → CSV', clz: 'CLZ Games → Menu → Export to CSV', grouvee: 'grouvee.com → Settings → Export', bggcsv: 'boardgamegeek.com → Collection → Export', bgstats: 'BG Stats → Settings → Backup & export → JSON', generic: '' };
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
  document.querySelectorAll('#kind [data-k]').forEach((b) => { b.textContent = t(b.dataset.k); b.classList.toggle('on', b.dataset.k === kind); });
  $('#platWrap').hidden = kind === 'board';
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
      $('#ftitle').textContent = it.title; $('#fsub').textContent = [it.platform, it.brand].filter(Boolean).join(' · ');
      $('#title').value = it.title; if (it.platform) $('#plat').value = it.platform;
      if (it.kind !== kind) { kind = it.kind; ls.set('kind', kind); }
    }
  } catch (e) { toast(e.message, true); $('#title').focus(); }
  $('#look').textContent = t('look'); render();
}
$('#look').onclick = lookup;
$('#upc').onkeydown = (e) => { if (e.key === 'Enter') lookup(); };
$('#title').oninput = check;
document.querySelectorAll('#kind [data-k]').forEach((b) => b.onclick = () => { kind = b.dataset.k; ls.set('kind', kind); render(); });
$('#send').onclick = async () => {
  if (busy) return; busy = true; check();
  try {
    await api('/api/collection/inbox', { method: 'POST', body: JSON.stringify({ type: 'item', item: { kind, title: $('#title').value.trim(), platform: kind === 'board' ? '' : $('#plat').value.trim(), ownership: $('#own').value, art: found && found.art || '', upc: $('#upc').value } }) });
    toast(t('sent')); $('#title').value = ''; $('#upc').value = ''; $('#found').hidden = true; found = null;
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
function mapNow() { return { title: +$('#mTitle').value, platform: +$('#mPlat').value, players: +$('#mPlayers').value, kind: $('#mKind').value }; }
let mapTouched = false;
async function parse() {
  parsed = null; check();
  if (!fileText) return preview();
  const preset = $('#preset').value;
  try {
    parsed = await api('/api/collection/parse', { method: 'POST', body: JSON.stringify({ text: fileText, preset, map: preset === 'generic' && mapTouched ? mapNow() : null }) });
    if (parsed.map && !mapTouched) {
      opts($('#mTitle'), parsed.headers, parsed.map.title, false); opts($('#mPlat'), parsed.headers, parsed.map.platform, true); opts($('#mPlayers'), parsed.headers, parsed.map.players, true);
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
  const n = document.createElement('div'); n.className = 'n'; n.textContent = t('games')(parsed.count);
  const d = document.createElement('div'); d.className = 'd'; d.textContent = t('found')(parsed.presetName, parsed.wishes, parsed.skipped);
  const ul = document.createElement('ul');
  for (const s of parsed.sample || []) { const li = document.createElement('li'); li.dir = 'auto'; li.textContent = s.title + (s.platform ? ' · ' + s.platform : '') + (s.players ? ' · ' + s.players.join('–') : ''); ul.append(li); }
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
['#mTitle', '#mPlat', '#mPlayers', '#mKind'].forEach((s) => $(s).onchange = () => { mapTouched = true; parse(); });
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
const q = new URLSearchParams(location.search); if (q.get('tab')) tab = q.get('tab') === 'file' ? 'file' : 'add'; if (q.get('kind') === 'board') kind = 'board';
render();
})();
</script>
</body></html>`;
