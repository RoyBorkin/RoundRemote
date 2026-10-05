// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Collection — the connections (display side). BoardGameGeek, PriceCharting, RAWG, Discogs and TMDB go through the
// bridge (bridge/lib/collection.js keeps their tokens / keys); Open Library and MusicBrainz need no account (through the
// bridge when there is one — it sends the User-Agent MusicBrainz asks for and keeps to its 1 request a second — else
// straight from the browser: both allow it); Steam through the Steam adapter (bridge/adapters/steam.js → owned);
// PlayStation from the PlayStation screen's data (js/providers/playstation.js); spreadsheets (GamEye, CLZ Games / Books /
// Music / Movies, Grouvee, BGG CSV, BG Stats, Discogs CSV, Goodreads, any CSV) from the phone page or a file chosen here,
// parsed by apps/collection-sources.js. Every sync merges with the rules in collection-sources.js (never overwrites your
// edits). Also here: "Play on <music service>" for a record or CD, "Play from Plex / Jellyfin" for a movie you also own
// digitally, and "Start reading" (Bookmarks) for a book.
import { bridgeBase, bridgeFetch, mayProbe } from '../js/providers/bridge.js';
import { provider } from '../js/providers/registry.js';
import { player } from '../js/core/player.js';
import * as C from './collection-store.js';
import { importText, isbnOf, olDoc, olEdition, mbReleaseGroup, normTitle } from './collection-sources.js';

const errText = (e) => e?.body?.error || e?.userMessage || e?.message || 'Something went wrong';
const viaBridge = async (path, opts = {}) => {
  try { return await bridgeFetch(path, { timeout: 20000, ...opts }); }
  catch (e) {
    if (/bridge not/i.test(errText(e))) throw Object.assign(new Error('The bridge isn’t reachable — start bridge/server.js on this network'), { bridge: true });
    if (e?.status === 404 && /not found/i.test(errText(e)) && !e?.body?.error) throw Object.assign(new Error('This bridge is too old for the Collection app — update it and restart'), { old: true });
    throw Object.assign(new Error(errText(e)), { status: e?.status, setup: !!e?.body?.setup, auth: !!e?.body?.auth });
  }
};

// ---------------------------------------------------------------- bridge info (cached a few seconds)
let infoCache = null;
export async function info({ force = false } = {}) {
  if (!force && infoCache && Date.now() - infoCache.at < 5000) return infoCache.data;
  const data = await viaBridge('/api/collection/info', { timeout: 6000 });
  infoCache = { at: Date.now(), data };
  return data;
}
export async function saveConfig(patch) {
  const r = await viaBridge('/api/collection/config', { method: 'POST', json: patch });
  infoCache = null;
  return r;
}

/** The phone page's address for the QR code. */
export async function phoneUrl(q = '') {
  const base = await bridgeBase();
  if (!base) return { url: null, reason: 'nobridge' };
  let i;
  try { i = await info({ force: true }); } catch (e) { return { url: null, reason: e.old ? 'old' : 'nobridge' }; }
  const path = `/collection${q}`;
  if (i?.publicUrl) return { url: i.publicUrl.replace(/\/$/, '') + path, info: i };
  const u = new URL(base);
  if (!/^(localhost|127\.|\[?::1)/.test(u.hostname)) return { url: u.origin + path, info: i };
  const ip = i?.ips?.[0];
  if (!ip) return { url: null, reason: 'noip', info: i };
  return { url: `http://${ip}:${i.port || u.port || 8765}${path}`, info: i };
}

// ---------------------------------------------------------------- the connections
const STEPS = {
  bgg: [
    'Sign in at boardgamegeek.com and open boardgamegeek.com/applications.',
    'Register a free non-commercial application (any name, e.g. “Round Remote”) and create a token for it.',
    'Enter your BGG username and paste the token here (or put both in bridge/config.json → collection.bgg).',
    'Sync now: your owned games and expansions come in with covers, players, play time, rating and plays.',
  ],
  pricecharting: [
    'PriceCharting’s API needs a paid subscription (Legendary or a retailer plan).',
    'Copy your API token from pricecharting.com → your account → Subscription / API.',
    'Paste it here (or bridge/config.json → collection.pricecharting.token).',
    'Sync now: your PriceCharting collection comes in with today’s value per game.',
  ],
  rawg: [
    'Create a free account at rawg.io and get an API key at rawg.io/apidocs.',
    'Mark games as “Owned” in your RAWG library (it can import Steam, PlayStation, Xbox and GOG).',
    'Enter your RAWG username and the key (or bridge/config.json → collection.rawg).',
    'The key also lets “+ Add” search RAWG for covers. (Not yet tested against the live RAWG service.)',
  ],
  steam: [
    'Set up Steam first: Home → Steam (a free Steam Web API key and your profile).',
    'Your profile’s “Game details” must be public for Steam to list your games.',
    'Sync now: every game you own comes in as Digital (PC) with your hours — hide them with the “Hide digital” filter.',
  ],
  psn: [
    'Sign in on the PlayStation screen first: Home → PlayStation (an NPSSO token).',
    'PlayStation lists the PS4 / PS5 games you’ve played — not whether you own the disc — so they come in as “disc or digital?”.',
    'Each sync adds new ones and never removes games; turn on “Count as digital” if you buy everything from the PlayStation Store.',
  ],
  discogs: [
    'Sign in at discogs.com → Settings → Developers and press “Generate new token” (a free personal access token).',
    'Enter your Discogs username and paste the token here (or bridge/config.json → collection.discogs).',
    'Sync now: every record and CD in your Discogs collection comes in — format (LP, 2LP, 7″, colour, RPM; CD, box set), label, catalogue number, genres, your media / sleeve grades.',
    'Discogs allows 60 requests a minute; big collections (100 a page) take a little while. The token also lets “+ Add” and barcodes search Discogs.',
  ],
  tmdb: [
    'Create a free account at themoviedb.org → Settings → API and request an API key (personal use).',
    'Paste the API key — or the longer “API Read Access Token” — here (or bridge/config.json → collection.tmdb.key).',
    '“+ Add” on the DVD & Blu-ray shelf then finds movies and shows with posters, genres, runtime and director.',
  ],
  openlibrary: [
    'Nothing to set up: Open Library is free and needs no account.',
    '“+ Add” on the Books shelf searches it by title, author or ISBN (covers, pages, publisher, subjects → genre).',
    'Your phone can scan a book’s barcode (an ISBN) — it’s looked up here too.',
  ],
  musicbrainz: [
    'Nothing to set up: MusicBrainz is free and needs no account (Cover Art Archive gives the covers).',
    '“+ Add” on the Vinyl and CD shelves searches it when Discogs isn’t connected; barcodes of records and CDs are looked up here too.',
    'MusicBrainz allows about one request a second — the bridge keeps to that.',
  ],
  sheet: [
    'Export your list: GamEye (Settings → Export → CSV), CLZ Games / Books / Music / Movies (Export to CSV), Grouvee (Export), BoardGameGeek (Collection → Export), BG Stats (Export → JSON), Discogs (Collection → Export) or Goodreads (Import and export → Export library) — or any spreadsheet saved as CSV.',
    'Scan the QR code with your phone, pick the file and the app it came from, check the preview and send it — it appears here.',
    'Imports add and update games; they never remove anything. Wish-list rows go to Wish Lists.',
    'Or let the bridge watch a file (bridge/config.json → collection.watchFile): it re-imports whenever the file changes.',
  ],
};
export const CONNECTIONS = [
  { id: 'bgg', name: 'BoardGameGeek', kind: 'board', color: '#ff5100', blurb: 'Your BGG collection — games, expansions, plays', steps: STEPS.bgg, fields: [['username', 'BGG username'], ['token', 'Application token', true]] },
  { id: 'pricecharting', name: 'PriceCharting', kind: 'video', color: '#2f9e44', blurb: 'Your games with today’s prices (subscription)', steps: STEPS.pricecharting, fields: [['token', 'API token', true]] },
  { id: 'rawg', name: 'RAWG', kind: 'video', color: '#6366f1', blurb: 'Your RAWG library (owned) + cover search', steps: STEPS.rawg, fields: [['username', 'RAWG username'], ['key', 'API key', true]], untested: true },
  { id: 'steam', name: 'Steam', kind: 'video', color: '#66c0f4', blurb: 'Every game you own on Steam (digital)', steps: STEPS.steam },
  { id: 'psn', name: 'PlayStation', kind: 'video', color: '#3b8ef0', blurb: 'PS4 / PS5 games you’ve played', steps: STEPS.psn },
  { id: 'discogs', name: 'Discogs', kind: 'vinyl', color: '#ff5a3c', blurb: 'Your Discogs collection — vinyl and CDs', steps: STEPS.discogs, fields: [['username', 'Discogs username'], ['token', 'Personal access token', true]], untested: true },
  { id: 'tmdb', name: 'TMDB', kind: 'movie', color: '#01b4e4', blurb: 'Movie & show search for DVD / Blu-ray (free key)', steps: STEPS.tmdb, fields: [['key', 'API key or read token', true]], searchOnly: true, untested: true },
  { id: 'openlibrary', name: 'Open Library', kind: 'book', color: '#3b82f6', blurb: 'Book search and ISBN lookups — no account', steps: STEPS.openlibrary, searchOnly: true, untested: true },
  { id: 'musicbrainz', name: 'MusicBrainz', kind: 'vinyl', color: '#ba478f', blurb: 'Album search and barcodes — no account', steps: STEPS.musicbrainz, searchOnly: true, untested: true },
  { id: 'sheet', name: 'Spreadsheet import', kind: null, color: '#7c3aed', blurb: 'GamEye, CLZ, Grouvee, BGG, Discogs, Goodreads or any CSV', steps: STEPS.sheet },
];
export const connById = (id) => CONNECTIONS.find((c) => c.id === id);

/** Is this connection set up (as far as we can tell without the network)? */
export function configured(id, inf) {
  if (id === 'bgg') return !!(inf?.conns?.bgg?.hasToken && inf?.conns?.bgg?.username);
  if (id === 'pricecharting') return !!inf?.conns?.pricecharting?.hasToken;
  if (id === 'rawg') return !!(inf?.conns?.rawg?.hasKey && inf?.conns?.rawg?.username);
  if (id === 'steam') return !!provider('steam')?.isAuthed?.();
  if (id === 'psn') return !!provider('playstation')?.isAuthed?.();
  if (id === 'sheet') return !!C.conn('sheet').lastSync || !!inf?.watch;
  if (id === 'discogs') return !!(inf?.conns?.discogs?.hasToken && inf?.conns?.discogs?.username);
  if (id === 'tmdb') return !!inf?.conns?.tmdb?.hasKey;
  if (id === 'openlibrary' || id === 'musicbrainz') return true;
  return false;
}

async function entriesFor(id, { force = false } = {}) {
  if (id === 'bgg') { const r = await viaBridge(`/api/collection/bgg${force ? '?force=1' : ''}`, { timeout: 120000 }); return { entries: r.items, user: r.username, note: r.counts ? `${r.counts.games} games · ${r.counts.expansions} expansions` : '' }; }
  if (id === 'pricecharting') { const r = await viaBridge('/api/collection/pricecharting', { timeout: 45000 }); return { entries: r.items }; }
  if (id === 'rawg') { const r = await viaBridge('/api/collection/rawg', { timeout: 120000 }); return { entries: r.items, user: r.username }; }
  if (id === 'discogs') { const r = await viaBridge(`/api/collection/discogs${force ? '?force=1' : ''}`, { timeout: 600000 }); return { entries: r.items, user: r.username, note: r.counts ? `${r.counts.vinyl} records · ${r.counts.cd} CDs` : '' }; }
  if (id === 'steam') {
    let r;
    try { r = await bridgeFetch(`/api/adapters/steam/owned${force ? '?force=1' : ''}`, { timeout: 45000 }); }
    catch (e) {
      if (/bridge not/i.test(errText(e))) throw new Error('The bridge isn’t reachable — start bridge/server.js on this network');
      if (/unknown adapter action/i.test(errText(e))) throw new Error('Update the bridge: this one can’t list owned Steam games yet');
      throw new Error(errText(e));
    }
    return { entries: (r.items || []).map((g) => ({ sid: String(g.appid), appid: String(g.appid), kind: 'video', title: g.name, platform: 'pc', digital: true, ownership: 'digital', hours: g.hours || 0,
      lastPlayed: g.lastPlayed || null })) };
  }
  if (id === 'psn') {
    const p = provider('playstation');
    if (!p?.isAuthed?.()) throw new Error('Sign in on the PlayStation screen first (Home → PlayStation)');
    // the whole played list (bridges that have the `titles` action), else the 12 most recent games from the summary
    let list = null, all = false;
    try { const r = await bridgeFetch(`/api/adapters/psn/titles${force ? '?force=1' : ''}`, { timeout: 120000 }); if (Array.isArray(r?.titles)) { list = r.titles; all = true; } }
    catch (e) { if (!/unknown adapter action|404/i.test(errText(e))) console.info('[collection] psn titles', errText(e)); }
    if (!list) {
      const d = await p.refresh();
      if (!d) throw new Error(p.error?.message || 'PlayStation isn’t reachable');
      list = d.recent || [];
    }
    const digital = !!C.conn('psn').digital;
    return { entries: list.filter((g) => g?.name).map((g) => ({ sid: String(g.titleId || g.name), psnId: g.titleId || '', kind: 'video', title: g.name,
      platform: /ps5/i.test(g.platform || '') ? 'ps5' : /ps4/i.test(g.platform || '') ? 'ps4' : (g.platform || 'ps5'), art: g.art || '', hours: g.playtimeMin ? Math.round(g.playtimeMin / 6) / 10 : 0,
      lastPlayed: g.lastPlayed ? Date.parse(g.lastPlayed) || null : null, digital, ownership: digital ? 'digital' : '' })), note: all ? `${list.length} games you’ve played on PlayStation` : 'Recently played on PlayStation' };
  }
  throw new Error('Nothing to sync');
}

const running = new Map();
/** Sync one connection now → the merge result (also saved as the connection's lastResult). */
export function sync(id, opts = {}) {
  if (running.has(id)) return running.get(id);
  const p = (async () => {
    try {
      const { entries, user, note } = await entriesFor(id, opts);
      // PlayStation only lists games you've played (older bridges: only the recent ones): merge, never mirror
      const r = C.applySource(id, entries, { mirror: id !== 'psn' });
      const res = { added: r.added, updated: r.updated, removed: r.removed, unlinked: r.unlinked, total: entries.length, note: note || '' };
      C.setConn(id, { on: true, lastSync: Date.now(), lastResult: res, error: '', ...(user ? { user } : {}) });
      return res;
    } catch (e) {
      C.setConn(id, { error: errText(e), errorAt: Date.now() });
      throw e;
    } finally { running.delete(id); }
  })();
  running.set(id, p);
  return p;
}
export const syncing = (id) => running.has(id);

// ---------------------------------------------------------------- imports (phone, watched file, a file chosen here)
/** Apply one parsed import: games into the collection (source = the preset), wish-list rows into Wish Lists. */
export async function applyImport({ preset, presetName, items = [], wishes = [], name = '', from = 'phone' }) {
  const src = preset || 'generic';
  const r = C.applySource(src, items, { mirror: false });
  let w = 0;
  if (wishes.length) {
    try {
      const W = await import('./wishlist-store.js');
      for (const e of wishes) { const it = W.addWish(e); if (it && !it.duplicate) w++; }
    } catch (e) { console.warn('[collection] wishes', e); }
  }
  const res = { added: r.added, updated: r.updated, wishes: w, total: items.length, preset: src, presetName: presetName || src, name, from };
  C.setConn('sheet', { on: true, lastSync: Date.now(), lastResult: res, error: '' });
  return res;
}
export function parseLocal(text, preset = 'auto', map = null) { return importText(text, { preset, map }); }

/** Poll the bridge inbox (phone adds, imports, the watched file) while the app is open. fn(entry, applied) per new entry. */
export function watchInbox(fn, { every = 3000 } = {}) {
  let stop = false, t = 0, fails = 0;
  const tick = async () => {
    if (stop) return;
    // on the public https site, don't go looking for a bridge nobody asked for (Chrome's local-network prompt)
    if (!mayProbe()) { t = setTimeout(tick, 15000); return; }
    try {
      const since = C.pref('inboxRev', null);
      const r = await bridgeFetch(`/api/collection/inbox?since=${since ?? 0}`, { timeout: 8000 });
      fails = 0;
      if (since === null) {
        // first contact with this bridge: only take what arrived in the last 10 minutes
        C.setPref('inboxRev', r.rev);
        for (const e of r.entries || []) if (Date.now() - e.at < 10 * 60000) await handle(e);
      } else {
        if (r.rev < since) C.setPref('inboxRev', 0);   // a new bridge (or its file was reset)
        for (const e of r.entries || []) { await handle(e); C.setPref('inboxRev', e.rev); }
        if ((r.rev || 0) > (C.pref('inboxRev', 0) || 0) && !(r.entries || []).length) C.setPref('inboxRev', r.rev);
      }
    } catch { fails++; }
    if (!stop) t = setTimeout(tick, fails ? Math.min(30000, every * (1 + fails)) : every);
  };
  const handle = async (e) => {
    try {
      if (e.type === 'import') fn(e, await applyImport(e));
      else if (e.type === 'item' && e.item?.title) {
        const it = C.addItem({ ...e.item, source: 'phone' });
        fn(e, it);
      }
    } catch (err) { console.warn('[collection] inbox', err); }
  };
  tick();
  return () => { stop = true; clearTimeout(t); };
}

// ---------------------------------------------------------------- search to add by hand
/** Which service "+ Add" searches on a shelf (as far as we know): { src, name, ready } */
export function searchSource(kind, inf) {
  if (kind === 'board') return { src: 'bgg', name: 'BoardGameGeek', ready: configured('bgg', inf) };
  if (kind === 'video') return { src: 'rawg', name: 'RAWG', ready: !!inf?.conns?.rawg?.hasKey };
  if (kind === 'book') return { src: 'openlibrary', name: 'Open Library', ready: true };
  if (kind === 'movie') return { src: 'tmdb', name: 'TMDB', ready: !!inf?.conns?.tmdb?.hasKey };
  if (inf?.conns?.discogs?.hasToken) return { src: 'discogs', name: 'Discogs', ready: true };
  return { src: 'musicbrainz', name: 'MusicBrainz', ready: true };
}
async function direct(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (r.status === 503 || r.status === 429) throw new Error('The service is busy — try again in a moment');
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`It answered ${r.status}`);
    return await r.json();
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'It took too long' : e.message); } finally { clearTimeout(t); }
}
/** Without a bridge: Open Library and MusicBrainz straight from the browser (both send CORS headers). */
async function directSearch(kind, q) {
  if (kind === 'book') {
    const isbn = isbnOf(q);
    if (isbn) { const e = await isbnDirect(isbn); return e ? [e] : []; }
    const j = await direct(`https://openlibrary.org/search.json?${new URLSearchParams({ q, limit: '12', fields: 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median,isbn,publisher,subject' })}`);
    return (j?.docs || []).map(olDoc).filter(Boolean);
  }
  if (kind === 'vinyl' || kind === 'cd') {
    const j = await direct(`https://musicbrainz.org/ws/2/release-group?${new URLSearchParams({ query: q, fmt: 'json', limit: '12' })}`);
    return (j?.['release-groups'] || []).map((g) => mbReleaseGroup(g, kind)).filter(Boolean);
  }
  return [];
}
async function isbnDirect(isbn) {
  const ed = await direct(`https://openlibrary.org/isbn/${isbn}.json`);
  if (!ed) return null;
  const authors = [];
  for (const a of (ed.authors || []).slice(0, 2)) { try { const j = await direct(`https://openlibrary.org${a.key}.json`); if (j?.name) authors.push(j.name); } catch {} }
  let work = null;
  try { if (ed.works?.[0]?.key) work = await direct(`https://openlibrary.org${ed.works[0].key}.json`); } catch {}
  return olEdition(ed, { authors, work });
}
/** → [entry] — through the bridge (keys stay there); books and albums straight from the browser when there's no bridge. */
export async function search(kind, q) {
  if (kind === 'board' || kind === 'video') {
    const src = kind === 'board' ? 'bgg' : 'rawg';
    const r = await viaBridge(`/api/collection/search?src=${src}&q=${encodeURIComponent(q)}`, { timeout: 30000 });
    return (r.items || []).map((x) => ({ ...x, source: src }));
  }
  let inf = null;
  try { inf = await info(); } catch (e) {
    if (kind === 'movie') throw new Error('Searching movies needs the bridge with a TMDB key (Connections → TMDB)');
    return (await directSearch(kind, q)).map((x) => ({ ...x, kind: x.kind || kind, source: kind === 'book' ? 'openlibrary' : 'musicbrainz' }));
  }
  const s = searchSource(kind, inf);
  const r = await viaBridge(`/api/collection/search?src=${s.src}&kind=${kind}&q=${encodeURIComponent(q)}`, { timeout: 30000 });
  return (r.items || []).map((x) => ({ ...x, source: s.src }));
}
/** A barcode or ISBN typed on the display → [entry] (ISBNs → Open Library; other codes → the bridge's lookups). */
export async function lookupCode(code) {
  const isbn = isbnOf(code);
  try {
    const r = await viaBridge(`/api/collection/upc?code=${encodeURIComponent(String(code).replace(/[^\dXx]/g, ''))}`, { timeout: 30000 });
    return r.items || [];
  } catch (e) {
    if (isbn && e.bridge) { const x = await isbnDirect(isbn); return x ? [{ ...x, source: 'openlibrary' }] : []; }
    throw e;
  }
}
/** TMDB details for a movie / show you picked: runtime, director, genres (best effort). */
export async function tmdbDetails(id, type = 'movie') {
  try { return await viaBridge(`/api/collection/tmdb?id=${encodeURIComponent(id)}&type=${type}`, { timeout: 15000 }); } catch { return null; }
}

// ---------------------------------------------------------------- doing things with what you own
/** Search the music service you're using for the album and play it. → { title, service } */
export async function playAlbum(it) {
  const p = player.provider;
  if (!p || typeof p.search !== 'function' || p.caps?.search === false) throw new Error('Pick a music service first (Home → Settings → Music)');
  const res = (await p.search([it.by, it.title].filter(Boolean).join(' '))) || [];
  const t = normTitle(it.title), a = normTitle(String(it.by || '').split(',')[0]);
  const albums = res.filter((x) => x.kind === 'album');
  const fit = (x) => normTitle(x.title).includes(t) || t.includes(normTitle(x.title));
  const pick = albums.find((x) => fit(x) && (!a || normTitle(x.subtitle || '').includes(a))) || albums.find(fit)
    || res.find((x) => x.kind === 'track' && normTitle(x.subtitle || '').includes(t)) || albums[0] || res.find((x) => x.kind === 'track');
  if (!pick) throw new Error(`“${it.title}” isn’t on ${p.name || 'your music service'}`);
  await p.playItem(pick);
  setTimeout(() => p.refresh?.().catch(() => {}), 800);
  return { title: pick.title, service: p.name || 'your music service', kind: pick.kind };
}
/** A movie you also have on Plex / Jellyfin → { title, pid, entry, server } | null (reads Decide's library cache) */
export async function digitalCopy(it) {
  let lib;
  try { lib = await (await import('./decide-sources.js')).loadWatchLibrary(); } catch { return null; }
  const t = normTitle(it.title).replace(/^the /, '');
  const hits = (lib?.items || []).filter((x) => normTitle(x.title).replace(/^the /, '') === t);
  const m = hits.find((x) => !it.year || !x.year || Math.abs(x.year - it.year) <= 1) || null;
  return m ? { title: m.title, year: m.year, pid: m.ref.pid, entry: m.ref.entry, server: m.srcName } : null;
}
export async function playDigital(m) {
  const p = provider(m.pid);
  if (!p) throw new Error('That server isn’t set up');
  if (!(p.playerId || p.session)) await p.refresh?.().catch(() => {});
  if (!(p.playerId || p.session)) throw new Error(`Open ${m.server} on your TV first (or pick a player on the Movies screen)`);
  await p.playMedia(m.entry, {});
}
/** Put a book you own on the Bookmarks app as "reading" (or find it there). → the Bookmarks book */
export async function startReading(it) {
  const B = await import('./books-store.js');
  const t = normTitle(it.title);
  let b = B.books().find((x) => normTitle(x.title) === t);
  if (b) { if (b.status !== 'reading') { b = { ...b, status: 'reading', started: b.started || Date.now() }; B.putBook(b); } }
  else b = B.putBook(B.newBook({ title: it.title, author: it.by || '', cover: it.art || '', olKey: it.olid ? `/works/${it.olid}` : '', year: it.year || 0, total: it.pages || 300,
    format: it.format === 'audio' ? 'audio' : it.format === 'ebook' ? 'ebook' : 'paper', status: 'reading', started: Date.now() }));
  B.setCur(b.id);
  return b;
}
export async function inBookmarks(it) {
  try { const B = await import('./books-store.js'); const t = normTitle(it.title); return B.books().find((x) => normTitle(x.title) === t) || null; } catch { return null; }
}
