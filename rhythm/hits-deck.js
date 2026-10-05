// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Hitster's deck: the built-in songs plus the ones "Update song lists" downloaded (hits-update.js), filtered by the
// time period (the start card's Songs option), the song languages and the blocked genres (setup screen, remembered).
import { store } from '../js/core/store.js';
import { SONGS, IL_SONGS, DEMO_SONGS, ERAS } from './hits-songs.js';
import { hitsterLang } from './hits-text.js';

// ------------------------------------------------------------------ text helpers (shared with the matcher and the updater)
export const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[’'`´"“”]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Title without "(Remastered 2011)", "[Live]", " - Single Version" … */
export const baseTitle = (s) => norm(String(s || '').replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(/\s+[-–—]\s+.*$/, '')) || norm(s);
export const mainArtist = (a) => String(a || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim();
export const firstArtist = (a) => mainArtist(a).split(/\s+&\s+|,\s*|\s+and\s+|\s+x\s+/i)[0].trim();
/** Keys a song is known by (its own spelling and the Latin one), for de-duplicating. */
export function songKeys(s) {
  const out = [`${baseTitle(s.t)}|${norm(firstArtist(s.a))}`];
  if (s.ta || s.aa) out.push(`${baseTitle(s.ta || s.t)}|${norm(firstArtist(s.aa || s.a))}`);
  return out;
}

// ------------------------------------------------------------------ the songs
const IL_SET = new Set(IL_SONGS);
export const BUILTIN = [...SONGS, ...IL_SONGS];
export const isIsraeli = (s) => !!s.il || IL_SET.has(s);
const HEB = /[֐-׿]/, LATIN = /[A-Za-z]/;
/** A song's language group: 'en', 'he' or 'other'. */
export function langGroup(s) {
  const l = s.l || (HEB.test(s.t) ? 'he' : LATIN.test(s.t) ? 'en' : 'other');
  return l === 'en' || l === 'he' ? l : 'other';
}

let extra = [];          // downloaded songs (hits-update.js sets them)
let merged = null;
/** The downloaded songs changed (hits-update.js): they join the deck. */
export function setExtraSongs(list) { extra = Array.isArray(list) ? list : []; merged = null; version++; }
export let version = 0;
/** Built-in + downloaded, de-duplicated (a built-in song always wins). */
export function allSongs() {
  if (merged) return merged;
  const seen = new Set(); merged = [];
  for (const s of [...BUILTIN, ...extra]) {
    const keys = songKeys(s);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    merged.push(s);
  }
  return merged;
}
export const builtinCount = () => BUILTIN.length;
export const extraCount = () => allSongs().length - BUILTIN.length;

// ------------------------------------------------------------------ preferences (remembered in gameProgress.hits)
const P = () => store.get('gameProgress')?.hits || {};
/** { langs: ['en', 'he', 'other'], blocked: ['metal', …] } — languages default to the UI language's. */
export function deckPrefs() {
  const p = P();
  const langs = Array.isArray(p.songLangs) && p.songLangs.length ? p.songLangs : (hitsterLang() === 'he' ? ['he', 'en', 'other'] : ['en', 'other']);
  return { langs, blocked: Array.isArray(p.blocked) ? p.blocked : [] };
}
export function saveDeckPrefs(patch) {
  const all = store.get('gameProgress') || {};
  const cur = all.hits || {};
  const next = { ...cur };
  if (patch.langs) next.songLangs = patch.langs;
  if (patch.blocked) next.blocked = patch.blocked;
  store.set('gameProgress', { ...all, hits: next });
}

// ------------------------------------------------------------------ building a deck
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/** Songs that pass the language and genre filters. */
export function passes(s, { langs, blocked }) {
  if (!langs.includes(langGroup(s))) return false;
  if (blocked.length && (s.g || []).some((g) => blocked.includes(g))) return false;
  return true;
}
/**
 * The deck for a game: deck = the Songs option ('all' | 'il' | 'old' | 'new'), demo = the Demo service's own songs.
 * With Hebrew and another language both on (and not "Israeli hits"), the deck is about half Hebrew songs — otherwise
 * the few Hebrew ones would hardly ever come up.
 */
export function buildPool({ deck = 'all', demo = false, prefs = deckPrefs(), balance = true } = {}) {
  if (demo) return DEMO_SONGS.filter((s) => passes(s, prefs));
  let list;
  if (deck === 'il') list = allSongs().filter(isIsraeli);
  else {
    const era = ERAS[deck] || ERAS.all;
    list = allSongs().filter((s) => s.y >= era.from && s.y <= era.to);
  }
  list = list.filter((s) => passes(s, prefs));
  if (!balance || deck === 'il' || !prefs.langs.includes('he') || prefs.langs.length < 2) return list;
  const he = list.filter((s) => langGroup(s) === 'he'), rest = list.filter((s) => langGroup(s) !== 'he');
  if (!he.length) return rest;
  const keep = Math.max(he.length, 30);
  return rest.length > keep ? [...he, ...shuffle(rest).slice(0, keep)] : list;
}
/** How many songs a deck would have (the balanced size), cached until the filters or the songs change. */
const countCache = new Map();
export function poolSize(opts) {
  const p = opts.prefs || deckPrefs();
  const key = `${version}|${opts.deck}|${opts.demo ? 1 : 0}|${p.langs.join(',')}|${p.blocked.join(',')}`;
  if (!countCache.has(key)) {
    if (countCache.size > 60) countCache.clear();
    const all = buildPool({ ...opts, prefs: p, balance: false });
    let n = all.length;
    if (!opts.demo && opts.deck !== 'il' && p.langs.includes('he') && p.langs.length > 1) {
      const he = all.filter((s) => langGroup(s) === 'he').length;
      if (he) n = he + Math.min(all.length - he, Math.max(he, 30));
    }
    countCache.set(key, n);
  }
  return countCache.get(key);
}
/** Songs per genre / per language group in a deck (before those filters), for the chips. */
const gcCache = new Map();
export function genreCounts({ deck = 'all', demo = false } = {}) {
  const key = `${version}|${deck}|${demo ? 1 : 0}`;
  if (!gcCache.has(key)) { if (gcCache.size > 30) gcCache.clear(); gcCache.set(key, countTags(deck, demo)); }
  return gcCache.get(key);
}
function countTags(deck, demo) {
  const base = demo ? DEMO_SONGS : deck === 'il' ? allSongs().filter(isIsraeli)
    : allSongs().filter((s) => s.y >= (ERAS[deck] || ERAS.all).from && s.y <= (ERAS[deck] || ERAS.all).to);
  const g = {}, l = { en: 0, he: 0, other: 0 };
  for (const s of base) { for (const x of s.g || []) g[x] = (g[x] || 0) + 1; l[langGroup(s)]++; }
  return { g, l };
}
export { DEMO_SONGS, ERAS };
