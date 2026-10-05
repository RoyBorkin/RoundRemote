// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Fun facts for movies and TV shows: sentences from the Wikipedia article (film or series) plus facts
// built from the library's own metadata (director, release date, runtime, rating, cast, studio…).
// Hebrew titles are looked up on he.wikipedia.org and get Hebrew metadata facts.
import { normalizeText } from './util.js';
import { isRTL } from '../lyrics/bidi.js';

const mem = new Map();
const once = (key, fn) => { if (!mem.has(key)) mem.set(key, fn().catch((e) => { mem.delete(key); throw e; })); return mem.get(key); };

async function getJSON(url, ms = 9000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

/** Split an article intro into readable, self-contained sentences. */
export function sentences(text = '') {
  return String(text)
    .replace(/\s*\([^()]*\)/g, (m) => (m.length > 60 ? '' : m))  // drop long pronunciation/aka brackets
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“֐-׿])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 320)
    .slice(0, 14);
}

async function wikiArticle(item, lang) {
  const isShow = item.type === 'episode' || item.type === 'show' || item.type === 'season' || !!item.show;
  const name = isShow ? (item.show || item.title) : item.title;
  const hint = lang === 'he' ? (isShow ? 'סדרת טלוויזיה' : 'סרט') : isShow ? 'TV series' : `${item.year || ''} film`;
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&generator=search&gsrlimit=5`
    + `&gsrsearch=${encodeURIComponent(`${name} ${hint}`)}&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=1200`;
  const d = await getJSON(url);
  const pages = Object.values(d?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const want = normalizeText(name);
  const good = (p) => normalizeText(p.title.replace(/\s*\(.*\)$/, '')) === want;
  const year = String(item.year || '');
  return pages.find((p) => good(p) && year && (p.title.includes(year) || (p.extract || '').includes(year)))
    || pages.find((p) => good(p) && /film|series|סרט|סדרה/i.test(`${p.title} ${(p.extract || '').slice(0, 200)}`))
    || pages.find(good) || null;
}

const T = {
  en: {
    directed: (t, d) => `“${t}” was directed by ${d}.`,
    written: (t, w) => `It was written by ${w}.`,
    released: (t, d, n) => `“${t}” came out on ${d}${n >= 2 ? ` — ${n} years ago` : ''}.`,
    runtime: (t, r) => `“${t}” runs ${r}.`,
    rating: (t, r, src) => `${src === 'Critics' ? 'Critics' : 'Audiences'} rate “${t}” ${r} out of 10.`,
    content: (t, c) => `It's rated ${c}.`,
    studio: (t, s) => `It was made by ${s}.`,
    stars: (t, list) => `It stars ${list}.`,
    plays: (a, r) => `${a} plays ${r}.`,
    genres: (t, g) => `It's usually filed under ${g}.`,
    episode: (s, e, show) => `This is episode ${e} of season ${s} of “${show}”.`,
    seasons: (show, n) => `“${show}” has ${n} season${n === 1 ? '' : 's'} in your library.`,
    and: ' and ',
  },
  he: {
    directed: (t, d) => `את ״${t}״ ביים/ה ${d}.`,
    written: (t, w) => `התסריט נכתב על ידי ${w}.`,
    released: (t, d, n) => `״${t}״ יצא ב־${d}${n >= 2 ? ` — לפני ${n} שנים` : ''}.`,
    runtime: (t, r) => `אורכו של ״${t}״ הוא ${r}.`,
    rating: (t, r, src) => `${src === 'Critics' ? 'המבקרים' : 'הצופים'} מדרגים את ״${t}״ ${r} מתוך 10.`,
    content: (t, c) => `הסיווג שלו הוא ${c}.`,
    studio: (t, s) => `הופק על ידי ${s}.`,
    stars: (t, list) => `משחקים בו ${list}.`,
    plays: (a, r) => `${a} מגלם/ת את ${r}.`,
    genres: (t, g) => `הז׳אנר: ${g}.`,
    episode: (s, e, show) => `זה פרק ${e} בעונה ${s} של ״${show}״.`,
    seasons: (show, n) => `ל״${show}״ יש ${n} עונות בספרייה שלך.`,
    and: ' ו',
  },
};
const list = (arr, L) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')}${L.and}${arr[arr.length - 1]}`);
const runtimeText = (ms, lang) => {
  const m = Math.round(ms / 60000); const h = Math.floor(m / 60), r = m % 60;
  if (lang === 'he') return h ? `${h} שעות ו־${r} דקות` : `${m} דקות`;
  return h ? `${h} hour${h > 1 ? 's' : ''} ${r} minute${r === 1 ? '' : 's'}` : `${m} minutes`;
};

/**
 * Facts for a movie / episode / show: [{ text, source, about, dir }].
 * `item` is the details object from a media provider (or just the now-playing media fields).
 */
export function mediaFacts(item) {
  const key = `${item?.type}|${normalizeText(item?.show || item?.title || '')}|${item?.year || ''}|${item?.episode || ''}`;
  return once(key, async () => {
    if (!item?.title) return [];
    const lang = isRTL(`${item.title} ${item.show || ''}`) ? 'he' : 'en';
    const L = T[lang], dir = lang === 'he' ? 'rtl' : 'ltr';
    const title = item.type === 'episode' ? item.title : item.show || item.title;
    const meta = [];
    if (item.type === 'episode' && item.season != null && item.episode != null && item.show) meta.push(L.episode(item.season, item.episode, item.show));
    if (item.directors?.length) meta.push(L.directed(title, list(item.directors.slice(0, 2), L)));
    if (item.originallyAvailableAt) {
      const d = new Date(item.originallyAvailableAt);
      if (!Number.isNaN(+d)) meta.push(L.released(title, d.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), new Date().getFullYear() - d.getFullYear()));
    }
    const stars = (item.cast || []).slice(0, 3).map((c) => c.name);
    if (stars.length) meta.push(L.stars(title, list(stars, L)));
    (item.cast || []).filter((c) => c.role).slice(0, 3).forEach((c) => meta.push(L.plays(c.name, c.role)));
    if (item.writers?.length) meta.push(L.written(title, list(item.writers.slice(0, 2), L)));
    if (item.rating) meta.push(L.rating(title, item.rating, item.ratingSource));
    if (item.durationMs > 20 * 60000 && item.type === 'movie') meta.push(L.runtime(title, runtimeText(item.durationMs, lang)));
    if (item.studio) meta.push(L.studio(title, item.studio));
    if (item.genres?.length) meta.push(L.genres(title, list(item.genres.slice(0, 3).map((g) => g.toLowerCase()), L)));
    if (item.contentRating) meta.push(L.content(title, item.contentRating));
    if (item.type === 'show' && item.children?.length) meta.push(L.seasons(item.title, item.children.length));

    let wiki = [];
    try {
      const page = await wikiArticle(item, lang);
      wiki = sentences(page?.extract).map((text) => ({ text, source: 'Wikipedia', about: page.title }));
    } catch {}
    const metaFacts = meta.map((text) => ({ text, source: 'Library', about: title }));
    const out = [];
    for (let i = 0; out.length < 30 && (wiki[i] || metaFacts[i]); i++) { if (wiki[i]) out.push(wiki[i]); if (metaFacts[i]) out.push(metaFacts[i]); }
    return out.map((f) => ({ ...f, dir: isRTL(f.text) ? 'rtl' : dir }));
  });
}

/** Wikipedia photo for a title (used when a service has no backdrop). */
export async function mediaPhoto(item) {
  try {
    const lang = isRTL(item.title) ? 'he' : 'en';
    return (await wikiArticle(item, lang))?.thumbnail?.source || '';
  } catch { return ''; }
}
