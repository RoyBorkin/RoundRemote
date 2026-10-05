// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Decide — the six deciders: their filters, their built-in items and the loaders that read your libraries
// (Plex / Jellyfin movies & shows, Steam / PlayStation recently played), your Collection (board games and video
// games you own — apps/collection-store.js) and the app's own games.
// An item: { key, title, he?, sub, info?, art?, shape ('poster'|'wide'|'square'), glyph, color, src ('lib'|'coll'|'idea'|'mine'),
//   tags: {…filter tags…}, ref: {…what the actions need…} }
import { provider } from '../js/providers/registry.js';
import { WATCH, GENRES, GENRE_RE, DO_EN, DO_HE, MOODS, GO, GO_MOODS, VGAMES, VMOODS, CUISINES, DISHES, EAT_WAYS, EAT_TAGS } from './decide-data.js';
import { GAMES } from '../games/index.js';
import { RHYTHM } from '../rhythm/index.js';
import { RULES } from './bg-rules.js';
import { APPS } from './index.js';
import * as COLL from './collection-store.js';

const any = ['any', 'Any'];
const has = (list, v) => Array.isArray(list) && list.includes(v);
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} took too long`)), ms))]);
const fmtMins = (m) => (!m ? '' : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(Math.round(m % 60)).padStart(2, '0')} min` : ''}` : `${Math.round(m)} min`);
export { fmtMins };

// ---------------------------------------------------------------- source filter (shared)
// smart = your library / collection + your own items (+ the games on this screen) when you have enough, otherwise everything
export const SRC = { id: 'src', label: 'Pick from', strict: true, def: 'smart',
  opts: (d, ctx) => [['smart', 'Smart'], ['all', 'Everything'], ...(d.lib ? [['lib', d.libLabel]] : []), ...(ctx?.collCount ? [['coll', 'My collection']] : []), ['idea', 'Ideas'], ['mine', 'Added by me'], ['fav', 'Favourites']],
  test: (it, v, ctx) => v === 'all' ? true : v === 'fav' ? ctx.isFav(it.key) : v === 'smart' ? (ctx.libCount + (ctx.collCount || 0) >= (ctx.d.smartMin || 1) ? it.src !== 'idea' || !!it.ref?.go : true) : it.src === v };

// ---------------------------------------------------------------- your Collection (apps/collection-store.js)
let collMemo = {};
COLL.onItems(() => { collMemo = {}; });
const fmtPl = (p) => (!p ? '' : p[0] === p[1] ? `${p[0]} player${p[0] === 1 ? '' : 's'}` : p[1] >= 20 ? `${p[0]}+ players` : `${p[0]}–${p[1]} players`);
const fmtSpan = (t) => (!t ? '' : t[0] === t[1] ? fmtMins(t[0]) : `${t[0]}–${fmtMins(t[1])}`);
/** Board games you own (expansions stay inside their base game), with the rules / helper when we have them. */
function collBoard() {
  if (collMemo.board) return collMemo.board;
  const all = COLL.items('board');
  const rules = new Map(RULES.map((r) => [norm(r.name), r]));
  return (collMemo.board = all.filter((x) => !COLL.underBase(x, all)).map((x) => {
    const r = rules.get(norm(x.title));
    const players = x.players || (r ? parsePlayers(r.players) : [1, 99]);
    const mins = x.mins ? Math.round((x.mins[0] + x.mins[1]) / 2) : r ? parseMinutes(r.time) : 45;
    return {
      key: `p:c:${x.id}`, title: x.title, sub: [fmtPl(x.players), fmtSpan(x.mins), x.plays ? `${x.plays} play${x.plays === 1 ? '' : 's'}` : 'never played', x.lent?.name ? `lent to ${x.lent.name}` : ''].filter(Boolean).join(' · '),
      info: x.notes || (r && typeof r.goal === 'string' ? r.goal : ''), art: x.art || '', shape: 'square', glyph: 'meeple', color: '#f59e0b', src: 'coll', srcName: 'collection', year: x.year,
      tags: { players, mins, kind: 'board', lent: !!x.lent?.name }, ref: { coll: x.id, rules: r?.id || null, companion: r ? COMPANION[r.id] || null : null },
    };
  }));
}
/** Video games you own (physical and digital), with what we know about them (modes, session length, mood). */
function collVideo() {
  if (collMemo.video) return collMemo.video;
  return (collMemo.video = COLL.items('video').map((x) => {
    const steam = !!(x.appid && x.sources?.steam);
    const it = vgItem({ appid: x.appid || null, name: x.title, art: x.art, src: 'coll', platform: COLL.platformShort(x.platform) || (x.digital ? 'Digital' : ''), hours: x.hours, srcName: 'collection' });
    it.key = `v:c:${x.id}`;
    it.shape = x.art && !steam ? (x.sources?.bgg || x.sources?.psn ? 'square' : 'poster') : 'wide';
    if (!x.art && !x.appid) it.art = '';
    it.sub = [it.sub, x.beaten ? 'beaten' : '', x.digital ? 'digital' : '', x.lent?.name ? `lent to ${x.lent.name}` : ''].filter(Boolean).join(' · ');
    it.ref = { ...it.ref, coll: x.id, appid: steam ? x.appid : null, steam, platform: steam ? 'Steam' : COLL.platformShort(x.platform) };
    it.tags = { ...it.tags, lent: !!x.lent?.name };
    return it;
  }));
}

// ---------------------------------------------------------------- 1 · what to watch
const WATCH_D = {
  id: 'watch', name: 'What to watch', color: '#f43f5e', glyph: 'film', lib: true, libLabel: 'My library',
  blurb: 'A movie or a show — from your Plex or Jellyfin library, or from our list of favourites.',
  add: { title: 'Add a movie or show', placeholder: 'Title (and year)' },
  groups: [
    { id: 'type', label: 'Movie or show', opts: [any, ['m', 'Movie'], ['s', 'Show']], test: (it, v) => !it.tags.type || it.tags.type === v },
    { id: 'genre', label: 'Genre', strict: true, opts: [any, ...GENRES], test: (it, v) => has(it.tags.genres, v) },
    { id: 'len', label: 'Length', opts: [any, ['90', 'Under 1½ h'], ['120', 'Under 2 h'], ['long', 'Long (2h20+)']],
      test: (it, v) => !it.tags.mins || (v === 'long' ? it.tags.mins >= 140 : it.tags.mins <= +v) },
    { id: 'seen', label: 'Watched', opts: [any, ['new', 'Unwatched']], test: (it) => !it.tags.watched },
    { id: 'cont', label: 'Continue watching', strict: true, opts: [any, ['yes', 'Only those']], needsLib: true, test: (it) => !!it.tags.cont },
    SRC,
  ],
  quick: [['type', 'm', 'Movies'], ['type', 's', 'Shows'], ['seen', 'new', 'Unwatched'], ['len', '120', 'Under 2 h'], ['cont', 'yes', 'Continue', 'lib']],
  ideas() {
    return WATCH.map(([title, year, t, g, mins]) => ({
      key: `w:${title}`, title, sub: [year, t === 's' ? 'Series' : fmtMins(mins), g.split(',').map((x) => GENRES.find((y) => y[0] === x)?.[1]).filter(Boolean).slice(0, 2).join(' · ')].filter(Boolean).join(' · '),
      glyph: t === 's' ? 'tv' : 'film', color: t === 's' ? '#8b5cf6' : '#f43f5e', src: 'idea', year,
      tags: { type: t, genres: g.split(','), mins: t === 'm' ? mins : mins, watched: false }, ref: { kind: t === 's' ? 'show' : 'movie', year },
    }));
  },
  mine(u) { const m = /^(.*?)\s*\((\d{4})\)\s*$/.exec(u.title) || /^(.*?)\s+(\d{4})$/.exec(u.title); return { title: m ? m[1] : u.title, year: m ? +m[2] : null }; },
  load: loadWatchLibrary,
};

const genresOf = (names) => [...new Set((names || []).flatMap((n) => GENRE_RE.filter(([, re]) => re.test(n)).map(([id]) => id)))];
let watchCache = null;
/** Every movie and show in your Plex / Jellyfin libraries (plus Continue watching), cached for 10 minutes. */
export async function loadWatchLibrary({ force = false } = {}) {
  if (!force && watchCache && Date.now() - watchCache.at < 10 * 60000) return watchCache.res;
  const items = [], errors = [], names = [];
  for (const pid of ['plexvideo', 'jellyfinvideo']) {
    const p = provider(pid);
    if (!p?.isAuthed?.() || p.setupHint?.()) continue;
    const name = pid === 'plexvideo' ? 'Plex' : 'Jellyfin';
    try { items.push(...await withTimeout(libItems(p, pid, name), 25000, name)); names.push(name); }
    catch (e) { console.warn('[decide]', name, e); errors.push(`${name}: ${e?.userMessage || e?.message || e}`); }
  }
  const res = { items, errors, names };
  if (names.length || !errors.length) watchCache = { at: Date.now(), res };
  return res;
}
async function libItems(p, pid, name) {
  const root = await p.libraryRoot();
  const libs = (root?.items || []).filter((x) => x.node?.kind === 'library');
  const out = new Map();
  const add = (e, x = {}) => {
    if (!e || !['movie', 'show', 'episode'].includes(e.type)) return;
    const key = `${pid}:${e.id}`;
    const prev = out.get(key);
    const t = e.type === 'movie' ? 'm' : 's';
    const mins = x.mins || prev?.tags.mins || runtimeFromSub(e.subtitle);
    const it = {
      key, title: e.title, sub: e.subtitle || '', info: x.summary || prev?.info || '', art: e.poster || '', shape: e.wide ? 'wide' : 'poster',
      glyph: t === 's' ? 'tv' : 'film', color: '#f43f5e', src: 'lib', year: e.year, srcName: name,
      tags: { type: t, genres: x.genres || prev?.tags.genres, mins, watched: !!e.watched, cont: !!(x.cont || prev?.tags.cont) },
      ref: { pid, kind: t === 's' ? 'show' : 'movie', year: e.year, entry: slimEntry(e) },
    };
    out.set(key, it);
  };
  for (const lib of libs.slice(0, 8)) {
    const node = lib.node;
    let rich = null;
    try {
      if (pid === 'plexvideo' && p.pms) {
        const d = await p.pms(`/library/sections/${node.id}/all?type=${node.libType === 'show' ? 2 : 1}&X-Plex-Container-Start=0&X-Plex-Container-Size=1200`);
        rich = (d?.MediaContainer?.Metadata || []).map((x) => ({ e: p._entry(x), genres: genresOf((x.Genre || []).map((g) => g.tag)), mins: x.duration ? x.duration / 60000 : 0, summary: x.summary || '' }));
      } else if (pid === 'jellyfinvideo' && p._items) {
        const types = node.libType === 'tvshows' ? 'Series' : node.libType === 'movies' ? 'Movie' : 'Movie,Series';
        const r = await p._items({ ParentId: node.id, IncludeItemTypes: types, Fields: 'Genres,Overview,ProductionYear,RunTimeTicks,ChildCount', Limit: 1200, SortBy: 'Random' });
        rich = await Promise.all((r?.Items || []).map(async (x) => ({ e: await p._entry(x), genres: genresOf(x.Genres), mins: x.RunTimeTicks ? x.RunTimeTicks / 1e4 / 60000 : 0, summary: x.Overview || '' })));
      }
    } catch (e) { console.warn('[decide] rich library read failed, browsing instead', e); rich = null; }
    if (!rich) {
      const r = await p.browse(node);
      rich = (r?.items || []).map((e) => ({ e }));
    }
    rich.forEach((x) => add(x.e, x));
  }
  for (const kind of ['continue', 'nextup']) {
    try { const r = await p.browse({ kind }); (r?.items || []).slice(0, 30).forEach((e) => add(e, { cont: true })); } catch {}
  }
  return [...out.values()];
}
const slimEntry = (e) => ({ id: e.id, type: e.type, title: e.title, showId: e.showId || null, viewOffset: e.viewOffset || 0, index: e.index, parentIndex: e.parentIndex, watched: !!e.watched, seasonId: e.seasonId || null });
function runtimeFromSub(s) { const m = /(?:(\d+)h\s*)?(\d+)m\b/.exec(s || ''); return m ? (+(m[1] || 0)) * 60 + +m[2] : 0; }

// ---------------------------------------------------------------- 2 · what to do
const DO_D = {
  id: 'do', name: 'What to do', color: '#f59e0b', glyph: 'sparkle',
  blurb: 'Bored? Things to do by mood — chill, active, social, creative or productive.',
  add: { title: 'Add an idea', placeholder: 'Something you like doing' },
  groups: [
    { id: 'mood', label: 'Mood', opts: [any, ...MOODS.map(([v, l]) => [v, l])], test: (it, v) => has(it.tags.moods, v) },
    { id: 'where', label: 'Where', opts: [any, ['i', 'Indoors'], ['o', 'Outdoors']], test: (it, v) => it.tags.where === 'b' || it.tags.where === v },
    { id: 'who', label: 'With', opts: [any, ['1', 'Alone'], ['2', 'With others']], test: (it, v) => it.tags.who === 'b' || it.tags.who === v },
    { id: 'time', label: 'Time I have', opts: [any, ['15', '15 min'], ['60', 'An hour'], ['180', 'A few hours']], test: (it, v) => it.tags.mins <= +v },
    { id: 'cost', label: 'Cost', opts: [any, ['0', 'Free'], ['1', 'Cheap'], ['2', 'A treat']], test: (it, v) => (v === '0' ? it.tags.cost === 0 : v === '1' ? it.tags.cost <= 1 : it.tags.cost === 2) },
    { id: 'lang', label: 'Language', def: 'both', opts: [['both', 'Both'], ['en', 'English'], ['he', 'עברית']], test: (it, v) => v === 'both' || !it.tags.lang || it.tags.lang === v },
    SRC,
  ],
  quick: MOODS.map(([v, l]) => ['mood', v, l]),
  ideas() {
    const rows = (txt, lang) => txt.trim().split('\n').map((line, i) => {
      const [text, moods, where, who, mins, cost] = line.split('|');
      const m = moods.split(','), first = MOODS.find((x) => x[0] === m[0]) || MOODS[0];
      return {
        key: `d:${lang}:${text}`, title: text, rtl: lang === 'he',
        sub: [m.map((x) => MOODS.find((y) => y[0] === x)?.[1]).filter(Boolean).join(' · '), where === 'i' ? 'Indoors' : where === 'o' ? 'Outdoors' : '', fmtMins(+mins), ['Free', 'Cheap', 'A treat'][+cost]].filter(Boolean).join(' · '),
        glyph: first[2], color: first[3], src: 'idea', tags: { moods: m, where, who, mins: +mins, cost: +cost, lang },
      };
    });
    return [...rows(DO_EN, 'en'), ...rows(DO_HE, 'he')];
  },
};

// ---------------------------------------------------------------- 3 · what to play (this app's games + board & card games)
const COMPANION = { 'ticket-to-ride': 'ttr', catan: 'catan', monopoly: 'monopoly', taki: 'taki', twister: 'twister', clue: 'clue', 'jungle-speed': 'jungle',
  yahtzee: 'yahtzee', uno: 'uno', talisman: 'talisman', rummikub: 'rummikub' };
const TWO_PLAYER = { tictactoe: 1, connect4: 1, zoo: 1, rps: 1, pong: 0 };
export function parsePlayers(s) {
  const t = String(s || '').replace(/\([^)]*\)/g, ' ');
  const nums = [...t.matchAll(/(\d+)(\+?)/g)];
  if (!nums.length) return [1, 99];
  const lo = +nums[0][1], last = nums[nums.length - 1];
  return [lo, last[2] ? 99 : Math.max(lo, +last[1])];
}
export function parseMinutes(s) {
  const t = String(s || '');
  if (/any/i.test(t)) return 30;
  const nums = [...t.matchAll(/\d+/g)].map((m) => +m[0]);
  if (!nums.length) return 30;
  const avg = nums.length > 1 ? (nums[0] + nums[1]) / 2 : nums[0];
  return /hour/i.test(t) ? avg * 60 : avg;
}
const KIND_LABEL = { screen: 'On this screen', board: 'Board game', classic: 'Classic', party: 'Party game', cards: 'Card game', app: 'Party app' };
const PLAY_D = {
  id: 'play', name: 'What to play', color: '#8b5cf6', glyph: 'dice', smartMin: 6, coll: () => collBoard(),
  blurb: 'Your board games, card and party games — and the games on this screen — for the players you have.',
  add: { title: 'Add a game', placeholder: 'A game you own' },
  groups: [
    { id: 'pl', label: 'Players', opts: [any, ['1', 'Just me'], ['2', '2'], ['4', '3–4'], ['5', '5+']],
      test: (it, v) => { const [lo, hi] = it.tags.players || [1, 99]; return v === '1' ? lo <= 1 : v === '2' ? lo <= 2 && hi >= 2 : v === '4' ? lo <= 4 && hi >= 3 : hi >= 5; } },
    { id: 'time', label: 'Time', opts: [any, ['15', '15 min'], ['30', '30 min'], ['60', 'An hour'], ['long', 'Longer']], test: (it, v) => (v === 'long' ? it.tags.mins > 60 : it.tags.mins <= +v) },
    { id: 'kind', label: 'Kind', opts: [any, ['screen', 'On this screen'], ['board', 'Board'], ['cards', 'Cards'], ['party', 'Party']],
      test: (it, v) => it.tags.kind === v || (v === 'board' && it.tags.kind === 'classic') || (v === 'party' && it.tags.kind === 'app') },
    { id: 'adult', label: '18+ games', opts: [['no', 'Hide'], ['yes', 'Show']], def: 'no', test: (it, v) => v === 'yes' || !it.tags.adult },
    SRC,
  ],
  quick: [['src', 'coll', 'My games', 'coll'], ['pl', '1', 'Solo'], ['pl', '2', '2 players'], ['pl', '4', '3–4'], ['pl', '5', '5+'], ['time', '30', '≤ 30 min']],
  ideas() {
    const out = [];
    for (const g of GAMES) {
      const two = TWO_PLAYER[g.id];
      out.push({ key: `p:g:${g.id}`, title: g.name, sub: `${two ? '1–2 players' : '1 player'} · a few minutes · on this screen`, info: g.blurb, glyph: 'pad', icon: g.icon, color: g.color, src: 'idea',
        tags: { players: [1, two ? 2 : 1], mins: 5, kind: 'screen' }, ref: { go: ['game', { id: g.id }] } });
    }
    for (const g of RHYTHM) {
      const party = g.id === 'hits';
      out.push({ key: `p:r:${g.id}`, title: g.name, sub: `${party ? '1–10 players · 20 min' : '1 player · a song or two'} · rhythm game`, info: g.blurb, glyph: 'note', icon: g.icon, color: g.color, src: 'idea',
        tags: { players: [1, party ? 10 : 1], mins: party ? 20 : 5, kind: party ? 'party' : 'screen' }, ref: { go: ['game', { id: g.id }] } });
    }
    for (const r of RULES) {
      const players = parsePlayers(r.players), mins = parseMinutes(r.time);
      out.push({ key: `p:b:${r.id}`, title: r.name, he: r.he, sub: `${r.players.replace(/ \(.*\)/, '')} players · ${r.time} · ${KIND_LABEL[r.cat] || ''}`, info: typeof r.goal === 'string' ? r.goal : '',
        glyph: r.cat === 'cards' ? 'cards' : r.cat === 'party' ? 'party' : 'meeple', color: { board: '#3b82f6', classic: '#a16207', party: '#ec4899', cards: '#16a34a' }[r.cat] || '#8b5cf6', src: 'idea',
        tags: { players, mins, kind: r.cat }, ref: { rules: r.id, companion: COMPANION[r.id] || null } });
    }
    const app = (id, extra) => { const a = APPS.find((x) => x.id === id); if (a) out.push({ key: `p:a:${id}`, title: a.name, info: a.blurb, icon: a.icon, glyph: 'party', color: a.color, src: 'idea', ref: { go: ['app', { id }] }, ...extra }); };
    app('bottle', { sub: '3+ players · 20 min · party app', tags: { players: [3, 20], mins: 20, kind: 'app' } });
    app('drinks', { sub: '18+ · 3+ players · 30 min · party app', tags: { players: [3, 20], mins: 30, kind: 'app', adult: true } });
    return out;
  },
};

// ---------------------------------------------------------------- 4 · where to go
const GO_D = {
  id: 'go', name: 'Where to go', color: '#10b981', glyph: 'pin',
  blurb: 'Out of the house — parks, cafés, museums, beaches… or one of your own places.',
  add: { title: 'Add a place', placeholder: 'Place name', note: 'A note (optional) — what to do there' },
  groups: [
    { id: 'mood', label: 'Mood', opts: [any, ...GO_MOODS], test: (it, v) => has(it.tags.moods, v) },
    { id: 'budget', label: 'Budget', opts: [any, ['0', 'Free'], ['1', 'Cheap'], ['2', 'Splurge']], test: (it, v) => (v === '0' ? it.tags.budget === 0 : v === '1' ? it.tags.budget <= 1 : it.tags.budget === 2) },
    { id: 'dist', label: 'How far', opts: [any, ['1', 'Walking'], ['2', 'Short drive'], ['3', 'Day trip']], test: (it, v) => (v === '2' ? it.tags.dist <= 2 : it.tags.dist === +v) },
    { id: 'where', label: 'Weather', opts: [any, ['i', 'Indoors'], ['o', 'Outdoors']], test: (it, v) => it.tags.where === 'b' || it.tags.where === v },
    SRC,
  ],
  quick: GO_MOODS.slice(0, 5).map(([v, l]) => ['mood', v, l]),
  ideas() {
    return GO.map(([title, q, moods, budget, dist, where, glyph, tip]) => ({
      key: `g:${title}`, title, sub: [moods.split(',').map((m) => GO_MOODS.find((x) => x[0] === m)?.[1]).join(' · '), ['Free', 'Cheap', 'Splurge'][budget], ['', 'Walking distance', 'A short drive', 'A day trip'][dist]].filter(Boolean).join(' · '),
      info: tip, glyph, color: '#10b981', src: 'idea', tags: { moods: moods.split(','), budget, dist, where }, ref: { maps: q },
    }));
  },
};

// ---------------------------------------------------------------- 5 · what video game to play
const VG_D = {
  id: 'vgame', name: 'Video game', color: '#3b82f6', glyph: 'pad', lib: true, libLabel: 'Steam & PlayStation', smartMin: 6, coll: () => collVideo(),
  blurb: 'Your collection, Steam and PlayStation games (and our picks) — by time, mood and players.',
  add: { title: 'Add a game', placeholder: 'A game you own (any platform)' },
  groups: [
    { id: 'mode', label: 'Players', opts: [any, ['s', 'Solo'], ['c', 'Co-op'], ['v', 'Versus']], test: (it, v) => !it.tags.modes || has(it.tags.modes, v) },
    { id: 'time', label: 'Time I have', opts: [any, ['30', '30 min'], ['60', 'An hour'], ['long', 'All evening']], test: (it, v) => !it.tags.mins || (v === 'long' ? it.tags.mins >= 90 : it.tags.mins <= +v) },
    { id: 'mood', label: 'Mood', opts: [any, ...VMOODS], test: (it, v) => !it.tags.moods || has(it.tags.moods, v) },
    SRC,
  ],
  quick: [['src', 'coll', 'My collection', 'coll'], ['mode', 's', 'Solo'], ['mode', 'c', 'Co-op'], ['mode', 'v', 'Versus'], ['time', '30', 'Quick'], ['mood', 'chill', 'Chill']],
  ideas() {
    return VGAMES.map(([appid, name, modes, mins, moods]) => vgItem({ appid, name, src: 'idea' }));
  },
  load: loadGameLibrary,
};
const VG_BY_ID = new Map(VGAMES.map((g) => [g[0], g]));
const VG_BY_NAME = new Map(VGAMES.map((g) => [norm(g[1]), g]));
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function vgItem({ appid, name, art, src, platform, hours, srcName }) {
  const known = VG_BY_ID.get(+appid) || VG_BY_NAME.get(norm(name));
  const modes = known?.[2].split(','), mins = known?.[3], moods = known?.[4].split(',');
  const id = appid || known?.[0] || null;
  const modeTxt = modes ? modes.map((m) => ({ s: 'Solo', c: 'Co-op', v: 'Versus' })[m]).join(' / ') : '';
  return {
    key: id ? `v:${id}` : `v:${norm(name)}`, title: name, srcName,
    sub: [platform || (id ? 'Steam' : ''), hours ? `${hours} h played` : '', modeTxt, mins ? `~${fmtMins(mins)} a session` : ''].filter(Boolean).join(' · '),
    info: moods ? `Good for: ${moods.map((m) => VMOODS.find((x) => x[0] === m)?.[1]).join(', ')}.` : '',
    art: art || (id ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg` : ''), shape: 'wide', glyph: 'pad', color: '#3b82f6', src,
    tags: { modes, mins, moods }, ref: { appid: platform && platform !== 'Steam' ? null : id, kind: 'game', platform: platform || 'Steam' },
  };
}
let gameCache = null;
/** Recently played games from Steam and PlayStation (through the bridge), cached for 10 minutes. */
export async function loadGameLibrary({ force = false } = {}) {
  if (!force && gameCache && Date.now() - gameCache.at < 10 * 60000) return gameCache.res;
  const items = [], errors = [], names = [];
  const read = async (id, name, map) => {
    const p = provider(id);
    if (!p?.isAuthed?.()) return;
    try {
      const d = (p.data && Date.now() - (p.data.at || 0) < 5 * 60000) ? p.data : await withTimeout(p.refresh(), 12000, name);
      if (!d) { if (p.error) errors.push(`${name}: ${p.error.message}`); return; }
      (d.recent || []).forEach((g) => { const it = map(g); if (it) items.push(it); });
      if (d.owned) d.owned.forEach((g) => { const it = map(g); if (it) items.push(it); });
      names.push(name);
    } catch (e) { errors.push(`${name}: ${e?.message || e}`); }
  };
  await Promise.all([
    read('steam', 'Steam', (g) => g?.name ? vgItem({ appid: g.appid, name: g.name, art: g.header || g.capsule, src: 'lib', platform: 'Steam', hours: g.hours, srcName: 'Steam' }) : null),
    read('playstation', 'PlayStation', (g) => g?.name ? vgItem({ name: g.name, art: g.art, src: 'lib', platform: g.platform || 'PlayStation', hours: g.playtimeMin ? Math.round(g.playtimeMin / 6) / 10 : 0, srcName: 'PlayStation' }) : null),
  ]);
  const seen = new Set();
  const res = { items: items.filter((x) => (seen.has(x.key) ? false : seen.add(x.key))), errors, names };
  gameCache = { at: Date.now(), res };
  return res;
}

// ---------------------------------------------------------------- 6 · what to eat
const CZ = new Map(CUISINES.map(([id, name, he, color]) => [id, { id, name, he, color }]));
const EAT_D = {
  id: 'eat', name: 'What to eat', color: '#f97316', glyph: 'fork',
  blurb: 'Cook, order in or go out — dishes from 15 cuisines. Spin the cuisine first if you like.',
  add: { title: 'Add a dish', placeholder: 'A dish you love' },
  groups: [
    { id: 'way', label: 'How', opts: [any, ...EAT_WAYS], test: (it, v) => has(it.tags.ways, v) },
    { id: 'tag', label: 'Style', opts: [any, ...EAT_TAGS], test: (it, v) => has(it.tags.tags, v) },
    { id: 'cz', label: 'Cuisine', opts: [any, ...CUISINES.map(([id, name]) => [id, name])], test: (it, v) => !it.tags.cz || it.tags.cz === v },
    { id: 'flow', label: 'Spin', def: 'dish', opts: [['dish', 'Straight to a dish'], ['cz', 'Cuisine first, then a dish']], test: () => true },
    SRC,
  ],
  quick: [['way', 'c', 'Cook'], ['way', 'o', 'Order in'], ['way', 'g', 'Go out'], ['tag', 'v', 'Veggie'], ['tag', 'q', 'Quick']],
  ideas() {
    return DISHES.trim().split('\n').map((line) => {
      const [name, cz, ways, tags, he] = line.split('|');
      const c = CZ.get(cz);
      const w = ways.split(','), t = tags.split(',');
      return {
        key: `e:${name}`, title: name, he, sub: [c.name, w.map((x) => EAT_WAYS.find((y) => y[0] === x)?.[1]).join(' / '), t.map((x) => EAT_TAGS.find((y) => y[0] === x)?.[1]).join(' · ')].filter(Boolean).join(' · '),
        glyph: /pizza/i.test(name) ? 'pizza' : /soup|ramen|pho|udon|harira|curry|hot pot|hamin|stew/i.test(name) ? 'bowl' : /salad/i.test(name) ? 'leaf' : 'fork',
        color: c.color, src: 'idea', tags: { cz, ways: w, tags: t }, ref: { cz },
      };
    });
  },
  cuisine: (id) => CZ.get(id),
};

export const DECIDERS = [WATCH_D, DO_D, PLAY_D, GO_D, VG_D, EAT_D];
export const CUISINE_LIST = CUISINES.map(([id, name, he, color]) => ({ id, name, he, color }));
