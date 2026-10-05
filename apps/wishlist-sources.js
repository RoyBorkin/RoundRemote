// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Wish Lists — where "Add" looks things up. Every search answers [entry] with
// { kind, title, year, by, art, artAlt, source, ref, inLibrary, sub } (sub = a short line for the result row).
//   Books  — Open Library (search.json + covers.openlibrary.org; open CORS)
//   Movies & shows — your Plex / Jellyfin libraries (marked "in library") + the iTunes Search API
//   Games  — the Steam store (through the bridge: no CORS), your Steam wishlist, PlayStation recent / friends' games
// iTunes and Open Library are fetched straight from the browser; if that's blocked, through the bridge's small
// JSON fetcher (bridge/adapters/steam.js → fetchjson, an allow-list of these hosts).
import { http } from '../js/core/util.js';
import { bridgeFetch } from '../js/providers/bridge.js';
import { provider } from '../js/providers/registry.js';

const OL = 'https://openlibrary.org';
const ITUNES = 'https://itunes.apple.com';
const errText = (e) => e?.body?.error || e?.userMessage || e?.message || 'Something went wrong';
const yearOf = (s) => { const n = parseInt(String(s ?? '').slice(0, 4), 10); return n > 1000 && n < 3000 ? n : null; };
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

let viaBridge = new Set();   // hosts the browser couldn't reach directly (CORS / blocked) → use the bridge from then on
async function getJson(url) {
  const host = new URL(url).hostname;
  if (!viaBridge.has(host)) {
    try { const r = await http(url, { timeout: 12000 }); return typeof r === 'string' ? JSON.parse(r) : r; }   // iTunes answers text/javascript
    catch (e) {
      // HTTP errors are real answers; a TypeError / abort means CORS or no route → try the bridge
      if (e?.status && e.status !== 0) throw e;
      viaBridge.add(host);
    }
  }
  try { return await bridgeFetch(`/api/adapters/steam/fetchjson?url=${encodeURIComponent(url)}`, { timeout: 15000 }); }
  catch (e) { throw Object.assign(new Error(`Couldn’t reach ${host.replace(/^www\./, '')} — check the internet connection (or start the bridge)`), { cause: e }); }
}

// ---------------------------------------------------------------- books
export async function searchBooks(q) {
  const j = await getJson(`${OL}/search.json?${new URLSearchParams({ q, limit: '12', fields: 'key,title,author_name,first_publish_year,cover_i,edition_count' })}`);
  return (j?.docs || []).filter((d) => d.title).map((d) => ({
    kind: 'book', title: d.title, year: d.first_publish_year || null, by: d.author_name?.[0] || '',
    art: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '', source: 'openlibrary', ref: d.key ? `${OL}${d.key}` : '',
    sub: [d.author_name?.slice(0, 2).join(', '), d.first_publish_year].filter(Boolean).join(' · '),
  }));
}

// ---------------------------------------------------------------- movies & shows
const bigArt = (u) => (u ? u.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/600x600bb.$2') : '');
export async function searchItunes(q, kind) {
  const movie = kind === 'movie';
  const j = await getJson(`${ITUNES}/search?${new URLSearchParams({ term: q, media: movie ? 'movie' : 'tvShow', entity: movie ? 'movie' : 'tvSeason', limit: '20', country: 'US' })}`);
  const rows = j?.results || [];
  if (movie) {
    return rows.filter((r) => r.trackName).slice(0, 12).map((r) => ({
      kind: 'movie', title: r.trackName, year: yearOf(r.releaseDate), by: r.artistName || '', art: bigArt(r.artworkUrl100 || r.artworkUrl60), source: 'itunes',
      ref: r.trackViewUrl || String(r.trackId || ''), sub: [yearOf(r.releaseDate), r.artistName, r.primaryGenreName].filter(Boolean).join(' · '),
    }));
  }
  // seasons → one entry per show (its first season's year and art)
  const shows = new Map();
  for (const r of rows) {
    const name = r.artistName || String(r.collectionName || '').replace(/,?\s*(Season|Series|Staffel|Saison)\s*\d+.*$/i, '').trim();
    if (!name) continue;
    const key = name.toLowerCase(), y = yearOf(r.releaseDate);
    const cur = shows.get(key);
    if (!cur || (y && (!cur.year || y < cur.year))) {
      shows.set(key, { kind: 'show', title: name, year: y, by: '', art: bigArt(r.artworkUrl100 || r.artworkUrl60) || cur?.art || '', source: 'itunes',
        ref: r.artistViewUrl || r.collectionViewUrl || '', genre: r.primaryGenreName || cur?.genre || '', seasons: (cur?.seasons || 0) + 1 });
    } else cur.seasons++;
  }
  return [...shows.values()].slice(0, 12).map((s) => ({ ...s, sub: [s.year && `Since ${s.year}`, s.genre, `${s.seasons} season${s.seasons === 1 ? '' : 's'} on iTunes`].filter(Boolean).join(' · ') }));
}

/** Signed-in movie servers (Plex / Jellyfin). */
export function libraries() {
  const out = [];
  for (const [id, source] of [['plexvideo', 'plex'], ['jellyfinvideo', 'jellyfin']]) {
    const p = provider(id);
    try { if (p?.isAuthed?.() && !p.setupHint?.() && p.searchMedia) out.push({ p, source }); } catch {}
  }
  return out;
}
export async function searchLibrary(q, kind) {
  const libs = libraries();
  const res = await Promise.all(libs.map(({ p, source }) => withTimeout(p.searchMedia(q), 9000, 'timeout').then((list) => list
    .filter((e) => e.type === kind)
    .map((e) => ({ kind, title: e.title, year: e.year || null, by: '', art: e.poster || '', source, ref: String(e.itemId || e.id || ''), inLibrary: true,
      sub: [e.year, e.subtitle && !String(e.subtitle).startsWith(String(e.year)) ? e.subtitle : '', `In your ${source === 'plex' ? 'Plex' : 'Jellyfin'} library`].filter(Boolean).join(' · ') })))
    .catch(() => [])));
  return res.flat().slice(0, 16);
}

// ---------------------------------------------------------------- games
const steamEntry = (g, sub) => ({ kind: 'game', title: g.name, year: g.year || null, by: g.by || '', art: g.capsule || g.header || '', artAlt: g.header || '',
  source: 'steam', ref: String(g.appid || ''), sub });
export async function searchSteam(q) {
  let r;
  try { r = await bridgeFetch(`/api/adapters/steam/store?term=${encodeURIComponent(q)}`, { timeout: 16000 }); }
  catch (e) { throw new Error(/bridge not/i.test(errText(e)) ? 'The Steam store search goes through the bridge — start bridge/server.js' : errText(e)); }
  return (r?.items || []).map((g) => steamEntry(g, [g.price ? (g.price.final ? `${g.price.currency === 'USD' ? '$' : ''}${g.price.final.toFixed(2)}${g.price.currency !== 'USD' ? ` ${g.price.currency}` : ''}` : 'Free') : '',
    g.metascore ? `Metacritic ${g.metascore}` : '', 'Steam store'].filter(Boolean).join(' · ')));
}
export async function steamWishlist() {
  let r;
  try { r = await bridgeFetch('/api/adapters/steam/wishlist', { timeout: 30000 }); }
  catch (e) { throw new Error(/bridge not/i.test(errText(e)) ? 'Your Steam wishlist comes through the bridge — start bridge/server.js' : errText(e)); }
  return (r?.items || []).map((g) => steamEntry(g, [g.year, g.by, 'On your Steam wishlist'].filter(Boolean).join(' · ')));
}
/** Recent titles and the games friends are playing, from the PlayStation / Steam screens' data (fetched if needed). */
export async function consoleGames(id) {
  const p = provider(id);
  if (!p) return { recent: [], friends: [] };
  let d = p.data;
  if (!d) { d = await p.refresh(); if (!d) throw new Error(p.error?.message || `${id === 'steam' ? 'Steam' : 'PlayStation'} isn’t set up`); }
  const seen = new Set();
  const uniq = (e) => { const k = e.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; };
  if (id === 'playstation') {
    const recent = (d.recent || []).map((g) => ({ kind: 'game', title: g.name, year: null, by: '', art: g.art || '', source: 'psn', ref: g.titleId || '', sub: [g.platform, 'Recently played'].filter(Boolean).join(' · ') })).filter(uniq);
    const friends = (d.friends?.online || []).filter((f) => f.game?.name).map((f) => ({ kind: 'game', title: f.game.name, year: null, by: '', art: f.game.icon || '', source: 'psn', ref: f.game.titleId || '', sub: `${f.onlineId} is playing` })).filter(uniq);
    return { recent, friends };
  }
  const recent = (d.recent || []).map((g) => steamEntry(g, 'Recently played')).filter(uniq);
  const friends = (d.friends?.online || []).filter((f) => f.game?.name).map((f) => steamEntry(f.game, `${f.name} is playing`)).filter(uniq);
  return { recent, friends };
}
