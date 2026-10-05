// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The streaming library: a browsable catalogue for services with no public content API (Netflix, Disney+, Prime Video,
// Apple TV+, Max), built from TMDB's watch-provider data (JustWatch) for one country, and "Play on TV" for a title.
//
// TMDB (https://developer.themoviedb.org/reference):
//   /discover/movie · /discover/tv  with_watch_providers=<id> & watch_region=<IL> & with_watch_monetization_types=flatrate|free|ads
//   /search/multi → each hit checked with /movie|tv/{id}/watch/providers (results[region].flatrate/free/ads)
//   /movie|tv/{id}?append_to_response=credits,release_dates|content_ratings,watch/providers,external_ids
//   Provider ids (TMDB / JustWatch): Netflix 8 · Disney Plus 337 · Amazon Prime Video 119 (9 in a few countries) ·
//   Apple TV Plus 350 · Max 1899 (384 before the HBO Max → Max rename). Several ids are OR-ed with '|'.
// The key: the bridge's TMDB key (Collection → Connections → TMDB, or the phone setup page) — the bridge then proxies
// and caches every call (/api/collection/tmdbapi); or a key typed on this display (Settings → Movies & TV → Streaming
// library), used straight from the browser (TMDB allows CORS) — that's how GitHub Pages works without a bridge.
//
// Opening a title on the TV: Netflix and Disney+ take https links the TV app opens (Google TV through the bridge or
// Home Assistant). TMDB has no Netflix / Disney+ ids, Wikidata does (SPARQL, CORS-enabled, free):
//   TMDb movie ID P4947 · TMDb TV series ID P4983 → Netflix ID P1874   → https://www.netflix.com/title/<id>
//                                                → Disney+ movie ID P7595  → https://www.disneyplus.com/movies/<slug>/<id>
//                                                → Disney+ series ID P7596 → https://www.disneyplus.com/series/<slug>/<id>
// (also tried by TMDB's own external_ids.wikidata_id). Looked up once per title and cached (bridge + this display).
// No link known (or Prime Video / Apple TV+ / Max): open the app and offer to type the title into its search with the
// TV remote's text input — the UI says so ("Opens Netflix — then types “…” into its search").
import { store } from './store.js';
import { http, qs } from './util.js';
import { catalogApp } from './tv-apps.js';
import { bridgeFetch, mayProbe } from '../providers/bridge.js';
import { directType } from './tvapp.js';
import { kidsMode, favourites, recents, pushRecent } from './service-profiles.js';

export const STREAM_APPS = {
  netflix: { name: 'Netflix', providers: '8', app: 'netflix', ids: 'netflix' },
  disney: { name: 'Disney+', providers: '337', app: 'disney', ids: 'disney' },
  prime: { name: 'Prime Video', providers: '119|9', app: 'prime' },
  appletvplus: { name: 'Apple TV+', providers: '350', app: 'appletv' },
  max: { name: 'Max', providers: '1899|384', app: 'max' },
};
export const hasStreamLibrary = (svc) => !!STREAM_APPS[svc];
export const REGIONS = [
  ['IL', 'Israel'], ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['IE', 'Ireland'], ['DE', 'Germany'],
  ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['SE', 'Sweden'], ['PL', 'Poland'], ['BR', 'Brazil'],
  ['MX', 'Mexico'], ['IN', 'India'], ['JP', 'Japan'], ['KR', 'South Korea'], ['ZA', 'South Africa'],
];
export const region = () => (/^[A-Z]{2}$/.test(store.get('streamRegion') || '') ? store.get('streamRegion') : 'IL');
export const regionName = (r = region()) => REGIONS.find(([c]) => c === r)?.[1] || r;
const IMG = 'https://image.tmdb.org/t/p/';
const fail = (m, extra = {}) => Object.assign(new Error(m), { userMessage: m, ...extra });

// ---------------------------------------------------------------- TMDB access (bridge or this display's key)
export const localTmdbKey = () => String(store.auth('tmdb')?.key || '').trim();
export function setLocalTmdbKey(key) { store.setAuth('tmdb', key ? { key: String(key).trim() } : null); forgetAccess(); }
let acc = null;
export function forgetAccess() { acc = null; }
/** How TMDB is reached: { via: 'bridge' | 'direct' | null, bridge: bridge has a key, local: this display has one } */
export async function tmdbAccess({ fresh = false } = {}) {
  if (!fresh && acc && Date.now() - acc.at < 60000) return acc;
  let bridge = false;
  if (mayProbe()) { try { bridge = !!(await bridgeFetch('/api/collection/info', { timeout: 4000 }))?.conns?.tmdb?.hasKey; } catch {} }
  const local = !!localTmdbKey();
  acc = { at: Date.now(), via: bridge ? 'bridge' : local ? 'direct' : null, bridge, local };
  return acc;
}
const mem = new Map();   // response cache: url → { at, ttl, p }
function remember(k, ttl, fn) {
  const e = mem.get(k);
  if (e && Date.now() - e.at < e.ttl) return e.p;
  const p = fn();
  mem.set(k, { at: Date.now(), ttl, p });
  p.catch(() => mem.delete(k));
  if (mem.size > 400) mem.delete(mem.keys().next().value);
  return p;
}
async function direct(path, params) {
  const key = localTmdbKey();
  if (!key) throw fail('Add a TMDB key first', { setup: true });
  const bearer = /^eyJ/.test(key);
  try {
    return await http(`https://api.themoviedb.org/3${path}?${qs({ ...params, ...(bearer ? {} : { api_key: key }) })}`, { headers: bearer ? { Authorization: `Bearer ${key}` } : {}, timeout: 12000 });
  } catch (e) {
    if (e?.status === 401) throw fail('TMDB refused the key — check it at themoviedb.org → Settings → API', { setup: true });
    if (e?.status === 429) throw fail('TMDB says too many requests — try again in a moment');
    throw fail(e?.status ? `TMDB error ${e.status}` : 'Can’t reach TMDB — check the internet connection');
  }
}
/** GET a TMDB v3 path ('/discover/movie') with params; cached for `ttl` ms. */
export async function tmdb(path, params = {}, ttl = 10 * 60e3) {
  const a = await tmdbAccess();
  if (!a.via) throw fail('The library needs a free TMDB key', { setup: true });
  const k = `${path}?${qs(params)}`;
  return remember(k, ttl, async () => {
    if (a.via === 'direct') return direct(path, params);
    try { return await bridgeFetch(`/api/collection/tmdbapi?${qs({ path, ...params })}`, { timeout: 15000 }); }
    catch (e) {
      if (a.local) return direct(path, params);   // an older bridge without the proxy, or it's gone: use this display's key
      if (e?.status === 404) throw fail('Update the bridge — this one can’t fetch the streaming library yet');
      throw fail(e?.body?.error || e?.userMessage || 'The bridge couldn’t reach TMDB', { setup: !!e?.body?.setup });
    }
  });
}

// ---------------------------------------------------------------- genres (movie id(s) · tv id(s); null = that kind has none)
export const GENRES = [
  ['Action & Adventure', '28|12', '10759'], ['Animation', '16', '16'], ['Comedy', '35', '35'], ['Crime', '80', '80'], ['Documentary', '99', '99'],
  ['Drama', '18', '18'], ['Family', '10751', '10751'], ['Kids', null, '10762'], ['Fantasy & Sci-Fi', '14|878', '10765'], ['Horror', '27', null],
  ['Mystery', '9648', '9648'], ['Romance', '10749', null], ['Thriller', '53', null], ['Reality', null, '10764'], ['History & War', '36|10752', '10768'],
  ['Music', '10402', null], ['Western', '37', '37'],
];
const GENRE_NAME = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics',
};
const KID_GENRES = [10751, 16, 10762];

// ---------------------------------------------------------------- TMDB → library entries
const yearOf = (d) => (d ? String(d).slice(0, 4) : '');
/** A TMDB movie / tv result → a library row entry (js/views/media-library.js). */
function entryOf(x, kind, svc) {
  const k = kind || x.media_type;
  if (k !== 'movie' && k !== 'tv') return null;
  const title = k === 'movie' ? x.title || x.original_title : x.name || x.original_name;
  if (!title) return null;
  const year = yearOf(k === 'movie' ? x.release_date : x.first_air_date);
  const rating = x.vote_count > 20 && x.vote_average ? `★ ${(+x.vote_average).toFixed(1)}` : '';
  return {
    id: `${k}:${x.id}`, itemId: `${k}:${x.id}`, type: k === 'movie' ? 'movie' : 'show', title, year,
    subtitle: [year, k === 'movie' ? 'Movie' : 'Series', rating].filter(Boolean).join(' · '),
    poster: x.poster_path ? `${IMG}w342${x.poster_path}` : '', backdrop: x.backdrop_path ? `${IMG}w780${x.backdrop_path}` : '',
    genres: (x.genre_ids || []).map((g) => GENRE_NAME[g]).filter(Boolean), genreIds: x.genre_ids || [],
    tmdb: { kind: k, id: String(x.id) }, app: svc, pop: x.popularity || 0, votes: x.vote_average || 0, date: (k === 'movie' ? x.release_date : x.first_air_date) || '',
  };
}
const today = () => new Date().toISOString().slice(0, 10);
/** The /discover parameters for one kind (movie | tv) of a list node. */
function discoverParams(svc, kind, node) {
  const S = STREAM_APPS[svc];
  const p = { with_watch_providers: S.providers, watch_region: region(), with_watch_monetization_types: 'flatrate|free|ads', include_adult: 'false', language: 'en-US' };
  const sort = node.sort || 'popular';
  if (sort === 'popular') p.sort_by = 'popularity.desc';
  if (sort === 'top') { p.sort_by = 'vote_average.desc'; p['vote_count.gte'] = kind === 'movie' ? 300 : 150; }
  if (sort === 'new') {
    p.sort_by = kind === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc';
    p[kind === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = today();
    p['vote_count.gte'] = kind === 'movie' ? 10 : 5;
  }
  const g = node.genre ? node.genre[kind === 'movie' ? 0 : 1] : null;
  if (g) p.with_genres = g;
  if (node.not) p.without_genres = node.not;
  if (kidsMode(svc)) {
    if (kind === 'movie') { p.certification_country = 'US'; p['certification.lte'] = 'PG'; p.without_genres = '27'; }
    else p.with_genres = g ? `${g},10762` : '10762|10751';
  }
  return p;
}
const kindsOf = (node) => (node.only ? [node.only] : node.genre ? ['movie', 'tv'].filter((k, i) => node.genre[i]) : ['movie', 'tv']);

/** One page of a list node (both kinds merged, ordered by the list's own order). */
async function listPage(svc, node, start) {
  node.cur ||= new Map([[0, { movie: 1, tv: 1 }]]);   // start → the TMDB page of each kind to fetch next
  const cur = node.cur.get(start) || { movie: 1, tv: 1 };
  const kinds = kindsOf(node).filter((k) => cur[k]);
  const res = await Promise.all(kinds.map((k) => tmdb(`/discover/${k}`, { ...discoverParams(svc, k, node), page: cur[k] }).then((d) => [k, d])));
  let items = [];
  const next = { ...cur };
  for (const [k, d] of res) {
    items.push(...(d.results || []).map((x) => entryOf(x, k, svc)).filter(Boolean));
    next[k] = d.page < Math.min(d.total_pages || 0, 500) ? d.page + 1 : 0;
  }
  const key = node.sort === 'top' ? (e) => e.votes : node.sort === 'new' ? (e) => e.date : (e) => e.pop;
  items.sort((a, b) => (key(b) > key(a) ? 1 : key(b) < key(a) ? -1 : 0));
  node.cur.set(start + items.length, next);
  return { items, more: !!(next.movie || next.tv) && items.length > 0 };
}

// ---------------------------------------------------------------- the library (StreamingProvider calls these)
const folder = (title, subtitle, icon, node) => ({ id: `f:${title}`, type: 'folder', title, subtitle, icon, node });
/** Setup rows when there's no TMDB key anywhere. */
function setupRows(svc, why = '') {
  const S = STREAM_APPS[svc];
  return [
    { id: 'setup-key', type: 'folder', icon: 'edit', title: 'Add a TMDB key here', subtitle: 'Free: themoviedb.org → Settings → API', action: ({ refresh } = {}) => import('../screens/stream-settings.js').then((m) => m.askTmdbKey()).then((ok) => { if (ok) refresh?.(); }) },
    { id: 'setup-phone', type: 'folder', icon: 'link', title: 'Set up on your phone', subtitle: 'Collection → TMDB on the phone page (needs the bridge)', action: () => import('../screens/setup-remote.js').then((m) => m.openRemoteSetup({ service: 'collection' })) },
    { id: 'setup-why', type: 'folder', icon: 'about', title: `Why a key?`, subtitle: `${S.name} has no public catalogue — the list of what’s on ${S.name} in ${regionName()} comes from TMDB${why ? ` · ${why}` : ''}`,
      action: () => import('../ui/overlay.js').then((m) => m.toast(`TMDB (themoviedb.org) knows what’s on ${S.name} in each country. Its key is free — Settings → Movies & TV → Streaming library.`, { ms: 6000 })) },
  ];
}
export async function libraryRoot(svc) {
  const S = STREAM_APPS[svc];
  const a = await tmdbAccess();
  if (!a.via) return { title: S.name, items: setupRows(svc) };
  const items = [];
  const fav = favourites(svc), rec = recents(svc);
  if (fav.length) items.push(folder('My list', `${fav.length} title${fav.length > 1 ? 's' : ''}`, 'star', { kind: 'fav' }));
  if (rec.length) items.push(folder('Recently opened', rec.slice(0, 3).map((e) => e.title).join(' · '), 'clock', { kind: 'recent' }));
  const kids = kidsMode(svc) ? ' · kids' : '';
  items.push(
    folder('Popular', `What people watch on ${S.name}${kids}`, 'sparkle', { kind: 'list', sort: 'popular' }),
    folder('Newest', `Latest releases on ${S.name}${kids}`, 'clock', { kind: 'list', sort: 'new' }),
    folder('Top rated', `Best reviewed${kids}`, 'star', { kind: 'list', sort: 'top' }),
    folder('Movies', `Popular movies${kids}`, 'film', { kind: 'list', sort: 'popular', only: 'movie' }),
    folder('Series', `Popular shows${kids}`, 'tv', { kind: 'list', sort: 'popular', only: 'tv' }),
    folder('Genres', GENRES.slice(0, 5).map((g) => g[0]).join(', ') + '…', 'library', { kind: 'genres' }),
    { id: 'region', type: 'folder', icon: 'about', title: `What’s on ${S.name} in ${regionName()}`, subtitle: 'From TMDB / JustWatch · change the country in Settings',
      action: () => import('../screens/settings.js').then((m) => m.openSettings('media/stream-library')) },
  );
  return { title: S.name, items };
}
export async function browse(svc, node, { start = 0 } = {}) {
  if (node.kind === 'root') return libraryRoot(svc);
  if (node.kind === 'fav') return { title: 'My list', items: start ? [] : favourites(svc).map((e) => ({ ...e, app: svc, subtitle: [e.year, e.type === 'movie' ? 'Movie' : 'Series'].filter(Boolean).join(' · ') })), emptyText: 'Nothing on My list yet — tap “＋ My list” on a title' };
  if (node.kind === 'recent') return { title: 'Recently opened', items: start ? [] : recents(svc).map((e) => ({ ...e, app: svc, subtitle: [e.year, e.type === 'movie' ? 'Movie' : 'Series'].filter(Boolean).join(' · ') })) };
  if (node.kind === 'genres') {
    const kids = kidsMode(svc);
    return { title: 'Genres', items: start ? [] : GENRES.filter((g) => !kids || !['Horror', 'Thriller', 'Crime'].includes(g[0]))
      .map(([name, m, t]) => folder(name, m && t ? 'Movies & series' : m ? 'Movies' : 'Series', 'library', { kind: 'list', sort: 'popular', genre: [m, t], title: name })) };
  }
  if (node.kind === 'list') {
    const r = await listPage(svc, node, start);
    return { ...r, emptyText: kidsMode(svc) ? `Nothing for kids here on ${STREAM_APPS[svc].name} in ${regionName()}` : `Nothing here on ${STREAM_APPS[svc].name} in ${regionName()}` };
  }
  return { title: '', items: [] };
}

/** Which of the region's subscription providers a title is on: [provider_id] */
async function providersOf(kind, id) {
  const d = await tmdb(`/${kind}/${id}/watch/providers`, {}, 6 * 3600e3);
  const r = d?.results?.[region()] || {};
  return [...(r.flatrate || []), ...(r.free || []), ...(r.ads || [])].map((p) => String(p.provider_id));
}
const onService = (svc, ids) => STREAM_APPS[svc].providers.split('|').some((p) => ids.includes(p));
/** Search titles on the service in the region (search/multi, each hit checked against its watch providers). */
export async function search(svc, q) {
  const d = await tmdb('/search/multi', { query: q, include_adult: 'false', language: 'en-US' }, 30 * 60e3);
  let hits = (d.results || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 16);
  if (kidsMode(svc)) hits = hits.filter((x) => (x.genre_ids || []).some((g) => KID_GENRES.includes(g)) && !(x.genre_ids || []).includes(27));
  const ok = await Promise.all(hits.map((x) => providersOf(x.media_type, x.id).then((ids) => onService(svc, ids)).catch(() => false)));
  const out = hits.filter((_, i) => ok[i]).map((x) => entryOf(x, x.media_type, svc)).filter(Boolean);
  if (!out.length && hits.length) throw fail(`Not on ${STREAM_APPS[svc].name} in ${regionName()}: ${hits.slice(0, 3).map((x) => x.title || x.name).join(', ')}`);
  return out;
}

/** The detail page (js/views/media-library.js renderDetail fields + a few of our own). */
export async function details(svc, entry) {
  const S = STREAM_APPS[svc];
  const { kind, id } = entry.tmdb;
  const app = catalogApp(S.app);
  const j = await tmdb(`/${kind}/${id}`, { language: 'en-US', append_to_response: `credits,${kind === 'movie' ? 'release_dates' : 'content_ratings'},watch/providers,external_ids` }, 6 * 3600e3);
  const base = entryOf({ ...j, genre_ids: (j.genres || []).map((g) => g.id) }, kind, svc) || entry;
  const reg = region();
  let cert = '';
  if (kind === 'movie') {
    const pick = (c) => (j.release_dates?.results || []).find((r) => r.iso_3166_1 === c)?.release_dates?.map((x) => x.certification).find(Boolean) || '';
    cert = pick(reg) || pick('US');
  } else {
    const pick = (c) => (j.content_ratings?.results || []).find((r) => r.iso_3166_1 === c)?.rating || '';
    cert = pick(reg) || pick('US');
  }
  const prov = j['watch/providers']?.results?.[reg] || {};
  const provIds = [...(prov.flatrate || []), ...(prov.free || []), ...(prov.ads || [])].map((p) => String(p.provider_id));
  const here = onService(svc, provIds);
  const also = (prov.flatrate || []).filter((p) => !S.providers.split('|').includes(String(p.provider_id))).map((p) => p.provider_name).slice(0, 3);
  const seasons = kind === 'tv' ? [j.number_of_seasons ? `${j.number_of_seasons} season${j.number_of_seasons > 1 ? 's' : ''}` : '', j.number_of_episodes ? `${j.number_of_episodes} episodes` : ''].filter(Boolean).join(' · ') : '';
  const runtime = kind === 'movie' ? +j.runtime : +(j.episode_run_time || [])[0] || 0;
  const d = {
    ...base, app: svc,
    poster: j.poster_path ? `${IMG}w500${j.poster_path}` : base.poster, backdrop: j.backdrop_path ? `${IMG}w1280${j.backdrop_path}` : base.backdrop,
    durationMs: kind === 'movie' && runtime ? runtime * 60000 : 0, contentRating: cert,
    rating: j.vote_count > 20 && j.vote_average ? (+j.vote_average).toFixed(1) : '',
    genres: (j.genres || []).map((g) => g.name), summary: j.overview || '', tagline: j.tagline || '',
    metaExtra: kind === 'tv' ? [seasons, runtime ? `${runtime} min episodes` : ''].filter(Boolean).join(' · ') : '',
    availability: here ? `On ${S.name} in ${regionName()}` : `Not on ${S.name} in ${regionName()} right now${also.length ? ` — try ${also.join(', ')}` : ''}`,
    available: here,
    cast: (j.credits?.cast || []).slice(0, 18).map((c) => ({ name: c.name, role: c.character || '', photo: c.profile_path ? `${IMG}w185${c.profile_path}` : '' })),
    directors: kind === 'movie' ? (j.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name) : (j.created_by || []).map((c) => c.name),
    studio: kind === 'tv' ? (j.networks || []).map((n) => n.name).slice(0, 2).join(', ') : (j.production_companies || []).map((n) => n.name).slice(0, 1).join(''),
    originallyAvailableAt: kind === 'movie' ? j.release_date || '' : j.first_air_date || '',
    wikidata: j.external_ids?.wikidata_id || '',
    playLabel: '▶ Play on TV', noOpenOnTv: true, wishSource: svc,
  };
  pushRecent(svc, d);
  // how "Play on TV" will open it on the TV used last (or the only one) — said plainly
  d.playNote = await Promise.race([playNote(d, app?.name || S.name), new Promise((r) => setTimeout(() => r(''), 6000))]).catch(() => '');
  return d;
}
/** More on the service like this one (same first genre). */
export async function related(svc, d) {
  const g = (j) => (j || []).find((x) => GENRE_NAME[x]);
  const gid = g(d.genreIds);
  if (!gid) return [];
  const kind = d.tmdb.kind;
  const node = { sort: 'popular' };
  const p = { ...discoverParams(svc, kind, node), with_genres: String(gid), page: 1 };
  const r = await tmdb(`/discover/${kind}`, p);
  return (r.results || []).filter((x) => String(x.id) !== d.tmdb.id).slice(0, 12).map((x) => entryOf(x, kind, svc)).filter(Boolean);
}

/** One line saying what "Play on TV" does for this title on the TV it would go to. */
async function playNote(d, appName) {
  await deepLinkFor(d).catch(() => '');
  const O = await import('./open-on-tv.js');
  const tvs = await O.tvTargets().catch(() => []);
  if (!tvs.length) return `No TV set up yet — pair a Google TV or Apple TV under Movies & TV to open ${appName} from here`;
  const g = O.lastTv(tvs);
  if (!g) return d.deepLink ? `Opens “${d.title}” straight in ${appName} on a Google TV; elsewhere opens ${appName} to search` : `Opens ${appName} on the TV you pick and helps you search for “${d.title}”`;
  const p = await titlePlan(g, d, { canOpen: O.canOpen, openApp: O.openApp }).catch(() => null);
  if (!p) return `${g.name} can’t open ${appName}`;
  return p.verb === 'play' ? `Opens “${d.title}” straight in ${appName} on ${g.name}` : `${p.label}, ${p.how}`;
}

// ---------------------------------------------------------------- Netflix / Disney+ ids (Wikidata)
const IDS_KEY = 'rr.streamids.v1';
let idsCache = null;
function idsStore() { if (!idsCache) { try { idsCache = JSON.parse(localStorage.getItem(IDS_KEY) || '{}') || {}; } catch { idsCache = {}; } } return idsCache; }
function idsSave() {
  const c = idsStore(), keys = Object.keys(c);
  if (keys.length > 1500) keys.sort((a, b) => c[a].at - c[b].at).slice(0, keys.length - 1200).forEach((k) => delete c[k]);
  try { localStorage.setItem(IDS_KEY, JSON.stringify(c)); } catch {}
}
/** The SPARQL query for one title: by its TMDB id (P4947 movie / P4983 series), or TMDB's own wikidata_id. */
export function idsQuery(kind, id, qid = '') {
  const prop = kind === 'tv' ? 'P4983' : 'P4947';
  const by = `{ ?i wdt:${prop} "${String(id).replace(/\D/g, '')}" . }${/^Q\d+$/.test(qid) ? ` UNION { VALUES ?i { wd:${qid} } }` : ''}`;
  return `SELECT ?nf ?dm ?ds WHERE { ${by} OPTIONAL { ?i wdt:P1874 ?nf . } OPTIONAL { ?i wdt:P7595 ?dm . } OPTIONAL { ?i wdt:P7596 ?ds . } } LIMIT 5`;
}
export function parseIds(j) {
  const rows = j?.results?.bindings || [];
  const v = (k) => rows.map((r) => r[k]?.value).find(Boolean) || '';
  return { netflix: v('nf'), disneyMovie: v('dm'), disneySeries: v('ds') };
}
/** { netflix, disneyMovie, disneySeries } for a TMDB title (cached 30 days; 7 days when Wikidata has nothing). */
export async function streamIds(entry) {
  const { kind, id } = entry.tmdb || {};
  if (!kind || !id) return {};
  const k = `${kind}:${id}`;
  const c = idsStore()[k];
  if (c && Date.now() - c.at < (c.netflix || c.disneyMovie || c.disneySeries ? 30 : 7) * 86400e3) return c;
  let ids = null;
  if (mayProbe()) { try { ids = await bridgeFetch(`/api/collection/wikidata?${qs({ kind, id, qid: entry.wikidata || '' })}`, { timeout: 12000 }); } catch {} }
  if (!ids) {
    const j = await http(`https://query.wikidata.org/sparql?${qs({ format: 'json', query: idsQuery(kind, id, entry.wikidata) })}`, { headers: { Accept: 'application/sparql-results+json' }, timeout: 12000 });
    ids = parseIds(j);
  }
  const rec = { netflix: ids.netflix || '', disneyMovie: ids.disneyMovie || '', disneySeries: ids.disneySeries || '', at: Date.now() };
  idsStore()[k] = rec; idsSave();
  return rec;
}
const slug = (t) => String(t || 'title').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'title';
/** The https link that opens this title in the service's TV app ('' = none known). */
export async function deepLinkFor(entry) {
  const S = STREAM_APPS[entry.app];
  if (!S?.ids || !entry.tmdb) return '';
  if (entry._linked) return entry.deepLink || '';
  const ids = await streamIds(entry);
  let link = '';
  if (S.ids === 'netflix' && /^\d+$/.test(ids.netflix)) link = `https://www.netflix.com/title/${ids.netflix}`;
  if (S.ids === 'disney') {
    if (entry.tmdb.kind === 'movie' && ids.disneyMovie) link = `https://www.disneyplus.com/movies/${slug(entry.title)}/${encodeURIComponent(ids.disneyMovie)}`;
    if (entry.tmdb.kind === 'tv' && ids.disneySeries) link = `https://www.disneyplus.com/series/${slug(entry.title)}/${encodeURIComponent(ids.disneySeries)}`;
  }
  entry.deepLink = link; entry._linked = true;
  return link;
}

// ---------------------------------------------------------------- typing on the TV
/** Can this TV (a js/core/open-on-tv.js group) type text into the app on screen? */
export const canType = (g) => !!(g?.zones?.androidtv || g?.zones?.ha || g?.zones?.app);
/** Type text on the TV: the bridge's Google TV remote, Home Assistant (needs "Enable IME") or the TV Remote app. */
export async function typeOnTv(g, text) {
  const z = g.zones;
  if (z.androidtv) {
    try { return await bridgeFetch('/api/adapters/androidtv/text', { method: 'POST', json: { id: z.androidtv.id, text }, timeout: 30000 }); }
    catch (e) {
      if (/unknown adapter action|not found/i.test(e?.body?.error || e?.message || '')) throw fail('Update the bridge — this one can’t type on the TV yet');
      throw fail(e?.body?.error || e?.userMessage || 'The TV didn’t take the text');
    }
  }
  if (z.ha) return directType(z.ha, text);
  if (z.app) return directType(z.app, text);
  throw fail(`${g.name} can’t type — search on the TV itself`);
}

/**
 * "Play on <TV>" for a library title (js/core/open-on-tv.js planner): the deep link when there is one, else open the
 * app and offer to type the title into its search. helpers: { canOpen, openApp } from open-on-tv.js.
 */
export async function titlePlan(g, entry, { canOpen, openApp }) {
  const S = STREAM_APPS[entry.app];
  const app = catalogApp(S?.app);
  if (!S || !app) return null;
  const title = entry.title || '';
  const link = await deepLinkFor(entry).catch(() => '');
  if (link && (g.zones.androidtv || g.zones.ha)) {
    return {
      tv: g, verb: 'play', label: `Play on ${g.name}`, how: `opens “${title}” in ${app.name}`,
      async run() { await openApp(g, app, link); return `Opening “${title}” in ${app.name} on ${g.name}`; },
    };
  }
  if (!canOpen(g, app)) return null;
  const typing = canType(g);
  return {
    tv: g, verb: 'open', label: `Open ${app.name} on ${g.name}`, how: typing ? `then type “${title}” into its search` : `then search for “${title}” there`,
    async run(ui) {
      await openApp(g, app);
      if (typing) {
        setTimeout(() => ui?.offer?.({
          text: `${app.name} is opening on ${g.name}. Pick the profile and open Search on the TV, then:`,
          action: `Type “${title.length > 22 ? `${title.slice(0, 21)}…` : title}”`,
          run: async () => {
            const r = await typeOnTv(g, title);
            return r?.skipped ? `Typed it on ${g.name} (${r.skipped} character${r.skipped > 1 ? 's' : ''} couldn’t be typed)` : `Typed “${title}” on ${g.name}`;
          },
        }), 2500);
      }
      return `Opening ${app.name} on ${g.name} — search for “${title}”`;
    },
  };
}
