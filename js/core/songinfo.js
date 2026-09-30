// Song information from free public sources that work straight from the browser (no keys):
//   • Wikipedia (song, album and artist articles) – text for Fun Facts, photos for the slideshow
//   • MusicBrainz – release year, first release date, how many releases, artist origin & start year
//   • Wikimedia Commons – freely licensed photos of the artist
//   • Deezer (JSONP) – a large artist photo and album cover
// Everything is cached in memory (and the small bits in localStorage) so each song is looked up once.
// Hebrew songs are looked up on he.wikipedia.org, so their facts come back in Hebrew.
import { normalizeText } from './util.js';
import { isRTL } from '../lyrics/bidi.js';

const mem = new Map();
const once = (key, fn) => { if (!mem.has(key)) mem.set(key, fn().catch((e) => { mem.delete(key); throw e; })); return mem.get(key); };
const keyOf = (t) => `${normalizeText(t?.artist || '')}|${normalizeText(t?.title || '')}`;
const mainArtist = (a = '') => a.split(/,|&| feat\.? | ft\.? | x | and /i)[0].trim();
const cleanTitle = (t = '') => t.replace(/\s*[([].*?(remaster|version|edit|mix|live|feat|ft\.|mono|stereo|deluxe|bonus).*?[)\]]/gi, '').replace(/\s+-\s+.*(remaster|version|edit|live).*$/i, '').trim();
const langOf = (t) => (isRTL(`${t?.title || ''} ${t?.artist || ''}`) ? 'he' : 'en');

async function getJSON(url, ms = 9000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
let jsonpN = 0;
function jsonp(url, ms = 8000) {
  return new Promise((resolve, reject) => {
    const cb = `__rrjsonp${++jsonpN}`;
    const s = document.createElement('script');
    const done = (v, e) => { clearTimeout(t); delete window[cb]; s.remove(); e ? reject(e) : resolve(v); };
    const t = setTimeout(() => done(null, new Error('timeout')), ms);
    window[cb] = (d) => done(d);
    s.onerror = () => done(null, new Error('jsonp failed'));
    s.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${cb}`;
    document.head.appendChild(s);
  });
}

// ------------------------------------------------------------------ MusicBrainz (≈1 request / second)
let mbLast = 0;
async function mb(path) {
  const wait = Math.max(0, mbLast + 1100 - Date.now());
  mbLast = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return getJSON(`https://musicbrainz.org/ws/2/${path}${path.includes('?') ? '&' : '?'}fmt=json`);
}
const q = (s) => `"${String(s).replace(/"/g, '')}"`;
function mbRecording(t) {
  return once(`mbrec|${keyOf(t)}`, async () => {
    const d = await mb(`recording?limit=8&query=${encodeURIComponent(`recording:${q(cleanTitle(t.title))} AND artist:${q(mainArtist(t.artist))}`)}`);
    const want = normalizeText(cleanTitle(t.title));
    const recs = (d.recordings || []).filter((r) => normalizeText(r.title) === want || normalizeText(r.title).startsWith(want));
    if (!recs.length) return null;
    // earliest known release among the matches
    const dates = recs.map((r) => r['first-release-date']).filter(Boolean).sort();
    const releases = new Set(recs.flatMap((r) => (r.releases || []).map((x) => x['release-group']?.id || x.id)));
    const r0 = recs[0];
    return {
      firstRelease: dates[0] || null,
      releaseCount: releases.size,
      lengthMs: r0.length || null,
      artistId: r0['artist-credit']?.[0]?.artist?.id || null,
      artistName: r0['artist-credit']?.[0]?.artist?.name || mainArtist(t.artist),
      albums: [...new Set(recs.flatMap((r) => (r.releases || []).filter((x) => x['release-group']?.['primary-type'] === 'Album').map((x) => x.title)))].slice(0, 6),
    };
  });
}
function mbArtist(id) {
  return once(`mbart|${id}`, () => mb(`artist/${id}?inc=genres`));
}

/** Release year of the song, from the provider if it gave one, otherwise MusicBrainz. */
export async function songYear(t) {
  if (!t?.title) return null;
  if (t.year) return t.year;
  const cache = lsGet('rr.year.v1');
  const k = keyOf(t);
  if (k in cache) return cache[k];
  let y = null;
  try { const r = await mbRecording(t); y = r?.firstRelease ? parseInt(r.firstRelease.slice(0, 4), 10) || null : null; } catch { return null; }
  const c = lsGet('rr.year.v1'); c[k] = y;
  const ks = Object.keys(c); if (ks.length > 400) delete c[ks[0]];
  try { localStorage.setItem('rr.year.v1', JSON.stringify(c)); } catch {}
  return y;
}
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } }

// ------------------------------------------------------------------ Wikipedia
function wikiSearch(lang, query, limit = 5) {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1`
    + `&generator=search&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(query)}`
    + '&prop=extracts|pageimages|description&exintro=1&explaintext=1&exlimit=max&piprop=thumbnail&pithumbsize=1400';
  return once(`wiki|${lang}|${query}`, async () => {
    const d = await getJSON(u);
    return Object.values(d?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  });
}
const SONGISH = { en: /\b(song|single|track|ballad|anthem)\b/i, he: /(שיר|סינגל|להיט)/ };
const ALBUMISH = { en: /\b(album|EP|record|mixtape|soundtrack)\b/i, he: /(אלבום|תקליט)/ };
const ARTISTISH = { en: /\b(singer|songwriter|rapper|band|group|musician|duo|DJ|producer|composer|artist|vocalist)\b/i, he: /(זמר|זמרת|להקה|להקת|מוזיקאי|ראפר|יוצר|יוצרת|מלחין|הרכב|צמד)/ };
function pickPage(pages, name, kind, lang, alsoMention) {
  const n = normalizeText(name);
  const re = (kind === 'song' ? SONGISH : kind === 'album' ? ALBUMISH : ARTISTISH)[lang];
  return pages.find((p) => {
    const title = normalizeText(p.title.replace(/\s*\(.*\)$/, ''));
    const text = `${p.description || ''} ${p.extract || ''}`;
    if (!(title === n || title.startsWith(n) || n.startsWith(title))) return false;
    if (!re.test(text)) return false;
    return !alsoMention || normalizeText(text).includes(normalizeText(alsoMention));
  }) || null;
}
async function wikiPages(t) {
  const lang = langOf(t);
  const artist = mainArtist(t.artist), title = cleanTitle(t.title);
  const words = lang === 'he' ? { song: 'שיר', album: 'אלבום', artist: 'זמר' } : { song: 'song', album: 'album', artist: 'singer band' };
  const [songs, albums, artists] = await Promise.all([
    wikiSearch(lang, `${title} ${artist} ${words.song}`).catch(() => []),
    t.album && normalizeText(t.album) !== normalizeText(title) ? wikiSearch(lang, `${t.album} ${artist} ${words.album}`).catch(() => []) : Promise.resolve([]),
    wikiSearch(lang, `${artist} ${words.artist}`).catch(() => []),
  ]);
  return {
    lang,
    song: pickPage(songs, title, 'song', lang, artist),
    album: t.album ? pickPage(albums, t.album, 'album', lang, artist) : null,
    artist: pickPage(artists, artist, 'artist', lang),
  };
}
function sentences(text = '') {
  return text
    .replace(/\s*\([^()]*(pronounced|IPA|born|listen|;)[^()]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=["“'A-Z֐-׿0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 260 && !/may refer to|^this article|^for other/i.test(s));
}

// ------------------------------------------------------------------ Fun facts
const T = {
  en: {
    firstRelease: (t, d) => `“${t}” was first released on ${d}.`,
    yearsAgo: (t, n) => `“${t}” came out ${n} year${n === 1 ? '' : 's'} ago.`,
    releases: (t, n) => `“${t}” appears on ${n} different releases — singles, albums, compilations and more.`,
    albums: (t, list) => `You can also find “${t}” on ${list}.`,
    origin: (a, type, area) => `${a} ${type === 'Group' ? 'are a group' : type === 'Person' ? 'is an artist' : 'come'} from ${area}.`,
    since: (a, y, type) => (type === 'Person' ? `${a} was born in ${y}.` : `${a} ${type === 'Group' ? 'formed' : 'started out'} in ${y}.`),
    genres: (a, g) => `${a}'s music is usually tagged as ${g}.`,
    length: (t, m) => `“${t}” runs for ${m}.`,
  },
  he: {
    firstRelease: (t, d) => `״${t}״ יצא לראשונה ב־${d}.`,
    yearsAgo: (t, n) => `״${t}״ יצא לפני ${n} שנים.`,
    releases: (t, n) => `״${t}״ מופיע ב־${n} הוצאות שונות — סינגלים, אלבומים ואוספים.`,
    albums: (t, list) => `אפשר למצוא את ״${t}״ גם ב־${list}.`,
    origin: (a, type, area) => `${a} ${type === 'Group' ? '— הרכב' : ''} מ${area}.`,
    since: (a, y, type) => (type === 'Person' ? `${a} נולד/ה ב־${y}.` : `${a} התחילו את דרכם ב־${y}.`),
    genres: (a, g) => `המוזיקה של ${a} מתויגת בדרך כלל כ־${g}.`,
    length: (t, m) => `אורכו של ״${t}״ הוא ${m}.`,
  },
};
const fmtLen = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;

/**
 * Fun facts for a track: [{ text, source, about, dir }]. Song facts come first, then the album,
 * then the artist, mixed with a few numbers from MusicBrainz. A provider can supply its own via
 * provider.getFacts(track) (the Demo does, since its songs are fictional).
 */
export function funFacts(t, provider) {
  return once(`facts|${keyOf(t)}|${t?.album || ''}`, async () => {
    if (!t?.title) return [];
    if (provider?.getFacts) { const own = await provider.getFacts(t).catch(() => null); if (own?.length) return own; }
    const lang = langOf(t), L = T[lang], dir = lang === 'he' ? 'rtl' : 'ltr';
    const title = cleanTitle(t.title), artist = mainArtist(t.artist);
    const [wiki, rec] = await Promise.all([wikiPages(t).catch(() => ({})), mbRecording(t).catch(() => null)]);
    const art = rec?.artistId ? await mbArtist(rec.artistId).catch(() => null) : null;
    const song = sentences(wiki.song?.extract).map((text) => ({ text, source: 'Wikipedia', about: title }));
    const album = sentences(wiki.album?.extract).map((text) => ({ text, source: 'Wikipedia', about: t.album }));
    const band = sentences(wiki.artist?.extract).map((text) => ({ text, source: 'Wikipedia', about: artist }));
    const nums = [];
    if (rec?.firstRelease) {
      const d = rec.firstRelease.length >= 10 ? new Date(rec.firstRelease).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : rec.firstRelease.slice(0, 4);
      nums.push(L.firstRelease(title, d));
      const ago = new Date().getFullYear() - parseInt(rec.firstRelease.slice(0, 4), 10);
      if (ago >= 2) nums.push(L.yearsAgo(title, ago));
    }
    if (rec?.releaseCount >= 3) nums.push(L.releases(title, rec.releaseCount));
    if (rec?.albums?.length > 1) nums.push(L.albums(title, rec.albums.slice(0, 3).join(lang === 'he' ? ', ' : ', ')));
    if (art?.area?.name) nums.push(L.origin(art.name || artist, art.type, art['begin-area']?.name ? `${art['begin-area'].name}, ${art.area.name}` : art.area.name));
    if (art?.['life-span']?.begin) nums.push(L.since(art.name || artist, art['life-span'].begin.slice(0, 4), art.type));
    const g = (art?.genres || []).sort((a, b) => b.count - a.count).slice(0, 3).map((x) => x.name);
    if (g.length) nums.push(L.genres(art.name || artist, g.join(', ')));
    if (!song.length && (t.durationMs || rec?.lengthMs)) nums.push(L.length(title, fmtLen(t.durationMs || rec.lengthMs)));
    const numFacts = nums.map((text) => ({ text, source: 'MusicBrainz', about: title }));
    // interleave so it isn't five artist facts in a row
    const out = [], lists = [song, numFacts, album, band];
    for (let i = 0; out.length < 40 && lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i]) out.push(l[i]);
    return out.map((f) => ({ ...f, dir: isRTL(f.text) ? 'rtl' : dir }));
  });
}

// ------------------------------------------------------------------ Photos for the slideshow
/** Photos related to the song: [{ url, credit }]. Album art first, then artist photos. */
export function songPhotos(t) {
  return once(`photos|${keyOf(t)}|${t?.album || ''}`, async () => {
    if (!t?.title) return [];
    const artist = mainArtist(t.artist);
    const out = [];
    const add = (url, credit) => { if (url && !out.some((p) => p.url === url)) out.push({ url, credit }); };
    const [wiki, dz, commons] = await Promise.all([
      wikiPages(t).catch(() => ({})),
      jsonp(`https://api.deezer.com/search?q=${encodeURIComponent(`artist:"${artist}" track:"${cleanTitle(t.title)}"`)}&limit=3`).catch(() => null),
      getJSON(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=24`
        + `&gsrsearch=${encodeURIComponent(`${artist} filetype:bitmap`)}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1400`).catch(() => null),
    ]);
    add(t.art, 'Album art');
    const hit = (dz?.data || []).find((d) => normalizeText(d.artist?.name || '').includes(normalizeText(artist).split(' ')[0]));
    if (hit?.album?.cover_xl) add(hit.album.cover_xl, 'Album art · Deezer');
    if (hit?.artist?.picture_xl && !/\/artist\/\/?/.test(hit.artist.picture_xl)) add(hit.artist.picture_xl, `${artist} · Deezer`);
    for (const k of ['song', 'album', 'artist']) if (wiki[k]?.thumbnail?.source) add(wiki[k].thumbnail.source, 'Wikipedia');
    const na = normalizeText(artist);
    Object.values(commons?.query?.pages || {})
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((p) => ({ p, ii: p.imageinfo?.[0] }))
      .filter(({ p, ii }) => ii && /jpe?g|png|webp/i.test(ii.mime) && ii.width >= 700 && ii.height >= 500
        && normalizeText(p.title).includes(na.split(' ')[0]) && !/logo|signature|autograph|poster|cover|album|flag|map|icon/i.test(p.title))
      .slice(0, 12)
      .forEach(({ ii }) => add(ii.thumburl || ii.url, 'Wikimedia Commons'));
    return out;
  });
}
