// Hitster's "Update song lists": more well-known songs from Wikidata, kept on this device for good (IndexedDB, or
// localStorage when IndexedDB isn't there) and merged with the built-in deck (hits-deck.js) — de-duplicated, never removed.
//
// Wikidata's query service (https://query.wikidata.org/sparql) answers GET ?format=json&query=… with CORS, so the browser
// asks it directly; when that fails (offline display, blocked host) the bridge's download proxy is tried
// (GET /api/audio/fetch?url= — it passes the application/sparql-results+json answer through). Limits: a query may run
// 60 s; one client gets 60 s of query time per minute and 30 failed queries per minute — so the queries run one after
// another with a pause between them, and a 429 waits for its Retry-After.
//
// What is asked: songs and singles (P31 single Q134556 / song Q7366) with a performer (P175) and a publication date
// (P577, the EARLIEST one = the year the song came out), popular enough — the number of Wikipedia articles about the
// song (wikibase:sitelinks) is the popularity measure. One query per decade (a sitelinks threshold per decade, most
// popular first, 150 at a time) plus one for songs in Hebrew (P407 = Q9288) and one for Israeli songs (country of
// origin P495 / the performer's citizenship P27 = Israel Q801). Each answer also brings: the title in English and
// Hebrew, the performer in English and Hebrew, whether the performer is a person (P31 = human Q5 → solo artist) or a
// group, the languages of the song (P407 → ISO 639-1 code P218), the countries, a Eurovision entry (P1344) and the
// genres (P136, English labels — mapped to the genre chips by keywords). Each run continues where the last one
// stopped (an offset per query), so every update adds the next most popular songs.
import { setExtraSongs, songKeys, BUILTIN, norm } from './hits-deck.js';

export const ENDPOINT = 'https://query.wikidata.org/sparql';
const LIMIT = 150;
const DB = 'rr-hitster', STORE = 'kv', KEY = 'extra', LS_KEY = 'rr.hitster.extra';
const BAD = /\b(live|karaoke|instrumental|cover|tribute|remix|demo|medley|reprise|version|edit)\b/i;

// ------------------------------------------------------------------ storage
let data = { songs: [], lastUpdated: 0, cursor: {} };
let loaded = null;
function idb() {
  return new Promise((ok, fail) => {
    if (typeof indexedDB === 'undefined') { fail(new Error('no IndexedDB')); return; }
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE); };
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => fail(rq.error || new Error('IndexedDB'));
    rq.onblocked = () => fail(new Error('IndexedDB blocked'));
  });
}
async function readStore() {
  try {
    const db = await idb();
    const v = await new Promise((ok, fail) => { const rq = db.transaction(STORE).objectStore(STORE).get(KEY); rq.onsuccess = () => ok(rq.result); rq.onerror = () => fail(rq.error); });
    db.close();
    if (v) return v;
  } catch {}
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
}
async function writeStore(v) {
  try {
    const db = await idb();
    await new Promise((ok, fail) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, KEY); tx.oncomplete = ok; tx.onerror = () => fail(tx.error); });
    db.close();
    return;
  } catch {}
  try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch {}
}
/** Load the downloaded songs once (they join the deck). → { songs, lastUpdated } */
export function loadExtra() {
  loaded ||= readStore().then((v) => {
    if (v && Array.isArray(v.songs)) data = { songs: v.songs, lastUpdated: v.lastUpdated || 0, cursor: v.cursor || {} };
    setExtraSongs(data.songs);
    return data;
  }).catch(() => data);
  return loaded;
}
export const extraInfo = () => ({ count: data.songs.length, lastUpdated: data.lastUpdated });

// ------------------------------------------------------------------ the queries
/** Decade buckets: [from, to, minimum sitelinks]. */
export const BUCKETS = [
  { id: 'd1930', from: 1930, to: 1949, min: 8, label: 1930 },
  { id: 'd1950', from: 1950, to: 1959, min: 10, label: 1950 },
  { id: 'd1960', from: 1960, to: 1969, min: 12, label: 1960 },
  { id: 'd1970', from: 1970, to: 1979, min: 12, label: 1970 },
  { id: 'd1980', from: 1980, to: 1989, min: 12, label: 1980 },
  { id: 'd1990', from: 1990, to: 1999, min: 12, label: 1990 },
  { id: 'd2000', from: 2000, to: 2009, min: 12, label: 2000 },
  { id: 'd2010', from: 2010, to: 2019, min: 10, label: 2010 },
  { id: 'd2020', from: 2020, to: 2029, min: 6, label: 2020 },
  { id: 'he', min: 1, kind: 'he' },
  { id: 'il', min: 3, kind: 'il' },
];
const dt = (y) => `"${y}-01-01T00:00:00Z"^^xsd:dateTime`;
/** The SPARQL for one bucket (offset = how many of its songs earlier updates already fetched). */
export function bucketQuery(b, offset = 0) {
  let pick, after = '';
  if (b.kind === 'he') pick = '?song wdt:P407 wd:Q9288 .';
  else if (b.kind === 'il') pick = '{ ?song wdt:P495 wd:Q801 . } UNION { ?song wdt:P175 ?ip . ?ip wdt:P27 wd:Q801 . } UNION { ?song wdt:P175 ?ip . ?ip wdt:P495 wd:Q801 . }';
  else {
    pick = `?song wdt:P577 ?d . FILTER(?d >= ${dt(b.from)} && ?d < ${dt(b.to + 1)})`;
    // the song's EARLIEST date must be in the decade (not a re-release of an older song)
    after = `FILTER NOT EXISTS { ?song wdt:P577 ?d0 . FILTER(?d0 < ${dt(b.from)}) }`;
  }
  return `SELECT ?song ?links ?first ?perf ?np
  (SAMPLE(?tEn) AS ?titleEn) (SAMPLE(?tHe) AS ?titleHe) (SAMPLE(?aEn) AS ?artistEn) (SAMPLE(?aHe) AS ?artistHe) (MAX(?hum) AS ?human)
  (GROUP_CONCAT(DISTINCT ?langCode; separator=" ") AS ?langs) (GROUP_CONCAT(DISTINCT ?ctry; separator=" ") AS ?countries)
  (SAMPLE(?evl) AS ?eurovision) (GROUP_CONCAT(DISTINCT ?gl; separator="|") AS ?genres)
WHERE {
  {
    SELECT ?song ?links (MIN(?date) AS ?first) (SAMPLE(?p) AS ?perf) (COUNT(DISTINCT ?p) AS ?np) WHERE {
      VALUES ?type { wd:Q134556 wd:Q7366 }
      ?song wdt:P31 ?type .
      ${pick}
      ?song wikibase:sitelinks ?links ; wdt:P577 ?date ; wdt:P175 ?p .
      FILTER(?links >= ${b.min})
    } GROUP BY ?song ?links
  }
  ${after}
  OPTIONAL { ?song rdfs:label ?tEn . FILTER(LANG(?tEn) = "en") }
  OPTIONAL { ?song rdfs:label ?tHe . FILTER(LANG(?tHe) = "he") }
  OPTIONAL { ?perf rdfs:label ?aEn . FILTER(LANG(?aEn) = "en") }
  OPTIONAL { ?perf rdfs:label ?aHe . FILTER(LANG(?aHe) = "he") }
  OPTIONAL { ?perf wdt:P31 wd:Q5 . BIND(1 AS ?hum) }
  OPTIONAL { ?song wdt:P407 ?lang . ?lang wdt:P218 ?langCode . }
  OPTIONAL { { ?song wdt:P495 ?c . } UNION { ?perf wdt:P27 ?c . } UNION { ?perf wdt:P495 ?c . } BIND(STRAFTER(STR(?c), "entity/") AS ?ctry) }
  OPTIONAL { ?song wdt:P1344 ?ev . ?ev rdfs:label ?evl . FILTER(LANG(?evl) = "en" && CONTAINS(?evl, "Eurovision")) }
  OPTIONAL { ?song wdt:P136 ?genre . ?genre rdfs:label ?gl . FILTER(LANG(?gl) = "en") }
}
GROUP BY ?song ?links ?first ?perf ?np
ORDER BY DESC(?links) ?song
LIMIT ${LIMIT} OFFSET ${offset}`;
}

// Wikidata genre labels → the genre chips (first match per rule; a song can get several)
const GENRE_RULES = [
  ['metal', /metal|metalcore|djent/],
  ['hiphop', /hip[ -]?hop|\brap\b|trap music|drill|grime|gangsta/],
  ['rnb', /r&b|rhythm and blues|\bsoul\b|neo soul|motown|doo-?wop|gospel|new jack swing|quiet storm/],
  ['disco', /disco|\bfunk\b|funk music|boogie/],
  ['dance', /dance|electro|house|techno|trance|\bedm\b|eurodance|synth|electronic|drum and bass|dubstep|big beat|hi-nrg|italo/],
  ['country', /country|\bfolk\b|folk music|folk rock|bluegrass|americana|singer-songwriter/],
  ['latin', /latin|reggaeton|salsa|bachata|cumbia|samba|bossa nova|tango|flamenco|merengue|mambo|ranchera|urbano/],
  ['reggae', /reggae|\bska\b|dancehall|\bdub\b|calypso|soca/],
  ['jazz', /jazz|blues|swing|big band|vocal jazz|traditional pop/],
  ['mizrahi', /mizrahi|middle eastern|oriental|mediterranean/],
  ['soundtrack', /soundtrack|film score|show tune|musical theatre|musical theater|film music/],
  ['children', /children|nursery|lullaby/],
  ['rock', /rock|punk|grunge|new wave|indie|alternative|britpop|\bemo\b|shoegaze|post-punk/],
  ['pop', /pop|teen|bubblegum|adult contemporary|ballad|schlager|chanson|k-pop|j-pop/],
];
export function mapGenres(labels) {
  const out = [];
  for (const raw of labels) {
    const l = String(raw).toLowerCase();
    for (const [id, re] of GENRE_RULES) if (re.test(l) && !out.includes(id)) out.push(id);
  }
  return out;
}
const EN_COUNTRIES = new Set(['Q30', 'Q145', 'Q16', 'Q408', 'Q27', 'Q664', 'Q21', 'Q22', 'Q25', 'Q766']);
const HEB = /[֐-׿]/, ASCII_TITLE = /^[\x20-\x7e’‘“”–—…]+$/;
const qid = (uri) => String(uri || '').replace(/^.*\/entity\//, '');

/** One answer row → a song record, or null when it isn't usable. */
export function rowToSong(r, bucket) {
  const v = (k) => r[k]?.value || '';
  const id = qid(v('song'));
  const y = parseInt(v('first').slice(0, 4), 10);
  if (!id || !(y >= 1900 && y <= new Date().getFullYear())) return null;
  const langs = v('langs').split(/\s+/).filter(Boolean);
  const countries = v('countries').split(/\s+/).filter(Boolean);
  const il = countries.includes('Q801') || bucket?.kind === 'he';
  let l = langs.includes('he') ? 'he' : langs.includes('en') ? 'en' : langs[0] || '';
  const tEn = v('titleEn'), tHe = v('titleHe'), aEn = v('artistEn'), aHe = v('artistHe');
  if (!l) {
    if (il && tHe && HEB.test(tHe) && (!tEn || !ASCII_TITLE.test(tEn) || bucket?.kind === 'il')) l = 'he';
    else if (tEn && ASCII_TITLE.test(tEn) && (countries.some((c) => EN_COUNTRIES.has(c)) || !countries.length)) l = 'en';
    else if (tEn && ASCII_TITLE.test(tEn) && !il) l = 'en';
    else l = 'xx';
  }
  if (bucket?.kind === 'il' && l !== 'he' && l !== 'en') return null;   // an Israeli song in another language: rare, skip
  let s;
  if (l === 'he') {
    const t = HEB.test(tHe) ? tHe : '';
    if (!t) return null;
    s = { t, a: aHe || aEn, y };
    if (tEn && tEn !== t && !HEB.test(tEn)) s.ta = tEn;
    if (aEn && aHe && aEn !== aHe) s.aa = aEn;
  } else {
    if (!tEn || HEB.test(tEn)) return null;
    s = { t: tEn, a: aEn || aHe, y };
    if (aHe && aHe !== aEn) s.ah = aHe;
  }
  if (!s.a || s.t.length > 80 || BAD.test(s.t)) return null;
  const g = mapGenres(v('genres').split('|').filter(Boolean));
  if (il && !g.includes('mizrahi') && !g.includes('israeli')) g.push('israeli');
  if (v('eurovision') && !g.includes('eurovision')) g.push('eurovision');
  s.g = g; s.l = l === 'xx' ? 'other' : l;
  if (il) s.il = 1;
  if (+v('np') === 1) s.b = v('human') ? 0 : 1;
  s.id = id; s.p = +v('links') || 0; s.src = 'wd';
  return s;
}

// ------------------------------------------------------------------ fetching
const sleep = (ms, signal) => new Promise((ok, fail) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); fail(new DOMException('aborted', 'AbortError')); }, { once: true });
});
async function viaBridge(url, signal) {
  const { bridgeFetchAudio } = await import('./bridge-audio.js');
  const buf = await bridgeFetchAudio(url, { signal });
  return JSON.parse(new TextDecoder().decode(buf));
}
/** Run one SPARQL query → the JSON answer. Direct first; the bridge as a fallback when the browser can't reach Wikidata. */
export async function sparql(query, { signal } = {}) {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  let direct = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 70000);
      signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
      let r;
      try { r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/sparql-results+json' }, cache: 'no-store' }); }
      finally { clearTimeout(to); }
      if (r.status === 429 || r.status === 503) {   // too many queries: wait as asked, then try again
        const wait = Math.min(60, parseInt(r.headers.get('Retry-After') || '', 10) || 10 * (attempt + 1));
        await sleep(wait * 1000, signal);
        continue;
      }
      if (!r.ok) throw Object.assign(new Error(`Wikidata answered ${r.status}`), { status: r.status });
      return await r.json();
    } catch (e) {
      if (signal?.aborted) throw e;
      direct = e;
      if (e.status) throw e;   // the service answered — a proxy won't do better
      break;                   // network / CORS failure → try the bridge
    }
  }
  try { return await viaBridge(url, signal); } catch (e) { if (signal?.aborted) throw e; }
  throw Object.assign(direct || new Error('Wikidata unreachable'), { unreachable: true });
}

let running = null;
/**
 * Fetch more songs. onProgress({ i, n, bucket, added }) after each query. → { added, total, lastUpdated }
 * Only one update runs at a time (a second call joins the first).
 */
export function updateSongs({ onProgress, signal } = {}) {
  running ||= (async () => {
    await loadExtra();
    const seen = new Set();
    for (const s of [...BUILTIN, ...data.songs]) songKeys(s).forEach((k) => seen.add(k));
    const ids = new Set(data.songs.map((s) => s.id).filter(Boolean));
    const cursor = { ...(data.cursor || {}) };
    let added = 0, ok = 0, lastErr = null;
    const fresh = [];
    for (let i = 0; i < BUCKETS.length; i++) {
      const b = BUCKETS[i];
      onProgress?.({ i, n: BUCKETS.length, bucket: b, added });
      const off = cursor[b.id] || 0;
      const t0 = performance.now();
      let rows;
      try { rows = (await sparql(bucketQuery(b, off), { signal }))?.results?.bindings || []; ok++; }
      catch (e) { if (signal?.aborted) throw e; lastErr = e; if (e.unreachable && !ok) break; continue; }
      for (const r of rows) {
        const s = rowToSong(r, b);
        if (!s || ids.has(s.id)) continue;
        const keys = songKeys(s);
        if (keys.some((k) => seen.has(k))) continue;
        keys.forEach((k) => seen.add(k)); ids.add(s.id);
        fresh.push(s); added++;
      }
      // next time: the next page — or from the top again once this list ran out (new songs appear there)
      cursor[b.id] = rows.length < LIMIT ? 0 : off + rows.length;
      // stay well inside the query service's 60 s of query time per minute
      const took = performance.now() - t0;
      if (i < BUCKETS.length - 1) await sleep(Math.max(1200, Math.min(took * 0.6, 8000)), signal);
    }
    if (!ok) throw Object.assign(lastErr || new Error('Wikidata unreachable'), { unreachable: true });
    data = { songs: [...data.songs, ...fresh], lastUpdated: Date.now(), cursor };
    await writeStore(data);
    setExtraSongs(data.songs);
    onProgress?.({ i: BUCKETS.length, n: BUCKETS.length, bucket: null, added });
    return { added, total: data.songs.length, lastUpdated: data.lastUpdated };
  })().finally(() => { running = null; });
  return running;
}
export const updating = () => !!running;
/** For tests: the normaliser the de-duplication uses. */
export { norm };
