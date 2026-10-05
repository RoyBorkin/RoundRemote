// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The shared content store behind the Tasks app ("Task manager") and every game with cards or questions: truths,
// dares and tasks (Truth or Dare), Never Have I Ever / Most Likely To prompts, Party Cards, Kings Cup rules (Drinking
// Games) and trivia questions (Trivia Night). Built-in packs (the games' own data files, see tasks-packs.js and
// tasks-builtins.js) plus everything players add — on a display or from their phones through the QR-code page
// (bridge/lib/tasks.js). Built-in entries can be edited, hidden, marked 18+ or put on lists; those edits are kept as
// overrides under the entry's own b:… id. User-defined lists ("Family night", "Work party"…) are items of type 'list';
// any entry can belong to several. Everything is kept in the app's settings (appData.tasks) so it works without the
// bridge too; local and bridge copies merge by id (rev-based sync).
import { store } from '../js/core/store.js';
import { Emitter } from '../js/core/util.js';
import { bridgeBase, bridgeFetch, mayProbe } from '../js/providers/bridge.js';
import { PACKS } from './tasks-packs.js';
import { builtinItems, TRIVIA_CATS, RANKS, PARTY_KINDS } from './tasks-builtins.js';

export { TRIVIA_CATS, RANKS, PARTY_KINDS };
export const TOD = ['truth', 'dare', 'task'];
export const DRINKS = ['never', 'likely', 'party', 'kings'];
export const TYPES = [...TOD, ...DRINKS, 'trivia'];
export const TYPE_META = {
  truth: { name: 'Truth', plural: 'Truths', color: '#60a5fa', he: 'אמת', group: 'tod' },
  dare: { name: 'Dare', plural: 'Dares', color: '#f472b6', he: 'חובה', group: 'tod' },
  task: { name: 'Task', plural: 'Tasks', color: '#a78bfa', he: 'משימה', group: 'tod' },
  never: { name: 'Never Have I Ever', short: 'Never', plural: 'Never prompts', color: '#ec4899', he: 'אף פעם לא', group: 'drinks', game: 'Never Have I Ever' },
  likely: { name: 'Most Likely To', short: 'Likely', plural: 'Likely prompts', color: '#8b5cf6', he: 'מי הכי סביר', group: 'drinks', game: 'Most Likely To' },
  party: { name: 'Party card', short: 'Party', plural: 'Party cards', color: '#ef4444', he: 'קלף מסיבה', group: 'drinks', game: 'Party Cards' },
  kings: { name: 'Kings Cup rule', short: 'Kings', plural: 'Kings Cup rules', color: '#eab308', he: 'חוק מלכים', group: 'drinks', game: 'Kings Cup' },
  trivia: { name: 'Question', short: 'Trivia', plural: 'Questions', color: '#3b82f6', he: 'שאלה', group: 'trivia', game: 'Trivia Night' },
};
export const GROUPS = [
  { id: 'tod', name: 'Truth or Dare', short: 'Truth or Dare', types: TOD, color: '#f472b6' },
  { id: 'drinks', name: 'Drinking games', short: 'Drinking', types: DRINKS, color: '#f59e0b' },
  { id: 'trivia', name: 'Trivia', short: 'Trivia', types: ['trivia'], color: '#3b82f6' },
  { id: 'more', name: 'More games', short: 'More', types: [], color: '#22c55e' },
];
export const PARTY_KIND_NAMES = { e: 'Everyone', p: 'One player', d: 'Two players', g: 'Mini-game', v: 'Vote', r: 'Rule' };
export const TAGS = ['family', 'party', 'funny', 'active', '18+'];
export const TAG_NAMES = { family: 'Family', party: 'Party', funny: 'Funny', active: 'Active', '18+': '18+' };
export const DIFF_NAMES = ['Any', 'Easy', 'Medium', 'Hard'];

export const events = new Emitter();  // 'change' (items/settings), 'status' (bridge), 'fresh' (items added from a phone)

// ---------------------------------------------------------------- persistence (appData.tasks)
const D = () => (store.get('appData') || {}).tasks || {};
function W(patch) {
  const all = store.get('appData') || {};
  store.set('appData', { ...all, tasks: { ...(all.tasks || {}), ...patch } });
}
const local = () => D().items || {};
const setLocal = (items) => { W({ items }); bump(); };
let cache = null;
function bump() { cache = null; events.emit('change'); }

const hebrewFirst = () => store.get('kbdLang') === 'he' || /^(he|iw)/i.test(navigator.language || '');
export function settings() {
  const d = D();
  return {
    filter: d.filter === 'session' ? 'session' : 'all',
    adult: !!d.adult,
    adultOk: !!d.adultOk,                         // someone confirmed "everyone playing is 18+" once
    mix: d.mix === 'only' ? 'only' : 'mixed',     // with 18+ on, games draw from everything or adult cards only
    packs: { en: true, he: hebrewFirst(), ...(d.packs || {}) },   // the Truth or Dare starter packs per language
    tags: Array.isArray(d.tags) ? d.tags : [],   // [] = any tag
    lists: Array.isArray(d.lists) ? d.lists : [],  // Truth or Dare: only cards on these lists ([] = everything)
    name: d.name || '',
  };
}
export function setSettings(patch) { W(patch); bump(); }

// ---------------------------------------------------------------- sessions
const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function session() {
  let s = D().session;
  if (!s?.id) { s = makeSession(); W({ session: s }); }
  return s;
}
function makeSession() {
  let id = '';
  const r = crypto.getRandomValues(new Uint8Array(4));
  for (const b of r) id += CODE[b % CODE.length];
  return { id, started: Date.now() };
}
export function newSession() {
  const prev = D().session;
  const s = makeSession();
  W({ session: s, pastSessions: [prev, ...(D().pastSessions || [])].filter(Boolean).slice(0, 20) });
  bump();
  return s;
}

// ---------------------------------------------------------------- built-ins
export const isBuiltin = (id) => String(id).startsWith('b:');
let BUILTINS = null, BY_ID = null;
/** Every built-in entry: the Truth or Dare starter packs and the games' own decks / question banks. */
export function builtins() {
  if (!BUILTINS) {
    BUILTINS = [...Object.values(PACKS).flatMap((p) => p.items.map((i) => ({ ...i, lang: i.builtin }))), ...builtinItems()];
    BY_ID = new Map(BUILTINS.map((i) => [i.id, i]));
  }
  return BUILTINS;
}
export const builtinById = (id) => { builtins(); return BY_ID.get(id) || null; };

// ---------------------------------------------------------------- migration of older saved data (once, never lossy)
function migrate() {
  const d = D(), done = d.migrated || {};
  if (done.v2) return;
  const all = store.get('appData') || {};
  const loc = { ...(d.items || {}) }, now = Date.now();
  // Trivia Night "My questions" (typed on the display or added in host mode from a phone) → trivia items
  for (const q of Array.isArray(all.trivia?.mine) ? all.trivia.mine : []) {
    if (!q?.q || !q?.a) continue;
    const id = 't_tq' + String(q.id || q.q.length).replace(/[^\w]/g, '').slice(0, 30);
    if (loc[id]) continue;
    loc[id] = { id, type: 'trivia', text: String(q.q).slice(0, 300), answer: String(q.a).slice(0, 120), wrong: (q.w || []).slice(0, 3).map(String),
      cat: q.cat || 'general', d: [1, 2, 3].includes(+q.d) ? +q.d : 2, lang: q.lang === 'he' ? 'he' : 'en', tags: [], author: '', session: '', created: now, updated: now, dirty: true };
  }
  // Drinking Games: Kings Cup rules edited in the game → overrides of the built-in rules
  for (const [r, v] of Object.entries(all.drinks?.kingsRules || {})) {
    const id = `b:en:r:${r}`, b = builtinById(id);
    if (!b || loc[id] || !v) continue;
    const { builtin: _, ...rest } = b;
    loc[id] = { ...rest, title: String(v.t || b.title).slice(0, 40), text: String(v.d || b.text).slice(0, 300), updated: now, dirty: true };
  }
  W({ items: loc, migrated: { ...done, v2: 1 } });
}

// ---------------------------------------------------------------- items
/** Every live entry of every type, built-in (with your edits) and added — before any game's filters. */
export function everything() {
  if (cache) return cache;
  migrate();
  const loc = local(), out = [];
  for (const it of builtins()) { const o = loc[it.id]; if (!o) out.push(it); else if (!o.deleted) out.push({ ...it, ...o, builtin: it.builtin }); }
  for (const it of Object.values(loc)) if (!isBuiltin(it.id) && !it.deleted && it.text && it.type !== 'list' && TYPE_META[it.type]) out.push(it);
  cache = out;
  return out;
}
/** Truth or Dare's view (kept for older callers): everything, with the starter packs that are switched off left out. */
export function allItems() {
  const { packs } = settings();
  return everything().filter((it) => !it.builtin || !TOD.includes(it.type) || packs[it.builtin]);
}
export const getItem = (id) => everything().find((i) => i.id === id) || null;
/** Built-in entries that were hidden (deleted overrides). */
export const hiddenBuiltins = (types) => Object.values(local()).filter((o) => o.deleted && isBuiltin(o.id) && builtinById(o.id) && (!types || types.includes(builtinById(o.id).type)));

const HEB = /[֐-׿]/;
export const hasHebrew = (s) => HEB.test(s || '');
/** The entry's language: set when added, the pack's language for built-ins, else guessed from the text. */
export const langOf = (it) => (it.lang === 'he' || it.lang === 'en' ? it.lang : it.builtin || (hasHebrew(it.text) ? 'he' : 'en'));

/** 18+ items: the built-in adult sets, and anything someone marked 18+ (the '18+' tag). */
const ADULT_TAG = /^(18\+?|adults?|nsfw)$/i;
export const isAdult = (it) => !!it?.adult || (it?.tags || []).some((t) => ADULT_TAG.test(String(t)));
/** Tags for an item marked (or unmarked) 18+: on adds '18+' and drops 'family'; off drops every adult tag and
 *  falls back to 'family' when nothing is left (the default tag of a new item). */
export function adultTags(tags = [], on) {
  const rest = tags.filter((t) => !ADULT_TAG.test(String(t)));
  if (on) return [...rest.filter((t) => t !== 'family'), '18+'];
  return rest.length ? rest : ['family'];
}
/** Mark any item — built-in (kept as an edit override), added here or on a phone — as 18+ or not. Synced as tags. */
export function setAdult(id, on) {
  const it = getItem(id) || builtinById(id);
  if (!it) return null;
  const tags = TOD.includes(it.type) ? adultTags(it.tags || [], on) : adultTags(it.tags || [], on).filter((t) => t !== 'family');
  return updateItem(id, { tags, ...(it.adult && !on ? { adult: false } : {}) });
}

/** Trivia topics: the built-in categories plus every topic used by an added question. */
export function topics() {
  const out = TRIVIA_CATS.map((c) => ({ ...c, builtin: true }));
  const seen = new Set(out.map((c) => c.id));
  for (const it of everything()) {
    if (it.type !== 'trivia' || !it.cat || seen.has(it.cat)) continue;
    seen.add(it.cat);
    out.push({ id: it.cat, name: it.cat, he: it.cat, color: '#14b8a6', icon: '✦', custom: true });
  }
  return out;
}
export const topicOf = (id) => topics().find((c) => c.id === id) || { id, name: id || 'General', he: id, color: '#14b8a6', icon: '✦', custom: true };

/** Entries for a game or a list view.
 *  type / types   one type ('truth' …) or several; null = all
 *  filter         'all' | 'session' (Truth or Dare's "This session"; default: its setting)
 *  adult          18+ entries allowed (default: the shared 18+ mode); adultOnly keeps just them
 *  tags           any of these tags (default: Truth or Dare's tag filter — pass [] for none)
 *  lang           'en' | 'he' (null = any)  ·  lists: on any of these lists ([] / null = any)
 *  source         'all' | 'builtin' | 'custom'  ·  cats: trivia topics  ·  diff: trivia difficulty (0 = any)
 *  q              search text  ·  packs: leave out the Truth or Dare starter packs that are switched off (default true) */
export function pool({ type = null, types = null, filter, adult, tags, adultOnly = false, lang = null, lists = null, source = 'all', cats = null, diff = 0, q = '', packs = true } = {}) {
  const s = settings();
  filter ??= s.filter; adult ??= s.adult; tags ??= s.tags;
  const sid = filter === 'session' ? session().id : '';
  const ts = types || (type ? [type] : null);
  const query = String(q || '').trim().toLowerCase();
  const listSet = lists?.length ? new Set(lists) : null;
  return (packs ? allItems() : everything()).filter((it) => (!ts || ts.includes(it.type))
    && (filter !== 'session' || it.session === sid)
    && (adult ? (!adultOnly || isAdult(it)) : !isAdult(it))
    && (!tags.length || (it.tags || []).some((t) => tags.includes(t)))
    && (!lang || langOf(it) === lang)
    && (!listSet || (it.lists || []).some((l) => listSet.has(l)))
    && (source === 'all' || (source === 'builtin') === !!it.builtin)
    && (!cats?.length || cats.includes(it.cat))
    && (!diff || !it.d || it.d === diff)
    && (!query || [it.text, it.answer, it.title, it.end, ...(it.wrong || []), it.author, it.cat].some((x) => x && String(x).toLowerCase().includes(query))));
}
/** Pool options for a Truth or Dare draw: the shared settings plus the 18+ "mixed / 18+ only" choice and its lists. */
export function gameOpts(opts = {}) {
  const s = settings();
  return { adultOnly: s.adult && s.mix === 'only', lists: s.lists.filter((id) => listById(id)), ...opts };
}
export function counts(opts = {}) {
  const c = Object.fromEntries(TYPES.map((t) => [t, 0]));
  for (const it of pool(opts)) c[it.type] = (c[it.type] || 0) + 1;
  return c;
}

const newId = (p = 't_') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const FIELDS = ['answer', 'wrong', 'cat', 'd', 'kind', 'end', 'turns', 'rank', 'title', 'lang', 'lists'];
function clean(type, f) {
  const out = {};
  if (f.lang !== undefined) out.lang = f.lang === 'he' ? 'he' : f.lang === 'en' ? 'en' : '';
  if (f.lists !== undefined) out.lists = [...new Set((f.lists || []).filter(Boolean))].slice(0, 20);
  if (type === 'trivia') {
    if (f.answer !== undefined) out.answer = String(f.answer || '').trim().slice(0, 120);
    if (f.wrong !== undefined) out.wrong = (f.wrong || []).map((w) => String(w || '').trim().slice(0, 120)).filter(Boolean).slice(0, 3);
    if (f.cat !== undefined) out.cat = String(f.cat || 'general').trim().slice(0, 40) || 'general';
    if (f.d !== undefined) out.d = [1, 2, 3].includes(+f.d) ? +f.d : 2;
  }
  if (type === 'party') {
    if (f.kind !== undefined) out.kind = PARTY_KINDS.includes(f.kind) ? f.kind : 'e';
    if (f.end !== undefined) out.end = String(f.end || '').trim().slice(0, 200);
    if (f.turns !== undefined) out.turns = Math.max(0, Math.min(20, Math.round(+f.turns || 0)));
  }
  if (type === 'kings') {
    if (f.rank !== undefined) out.rank = RANKS.includes(String(f.rank)) ? String(f.rank) : 'J';
    if (f.title !== undefined) out.title = String(f.title || '').trim().slice(0, 40);
  }
  return out;
}
/** Add an entry: { type, text, tags, author, lang, lists, …type fields } (trivia: answer, wrong, cat, d · party: kind,
 *  end, turns · kings: rank, title). Returns the new item, or null when something required is missing. */
export function addItem({ type, text, tags, author, ...f }) {
  text = String(text || '').trim().slice(0, 300);
  if (!text || !TYPE_META[type]) return null;
  const extra = clean(type, f);
  if (type === 'trivia' && !extra.answer) return null;
  if (!extra.lang) extra.lang = hasHebrew(text) ? 'he' : 'en';
  tags ??= TOD.includes(type) ? ['family'] : [];
  const now = Date.now();
  const it = { id: newId(), type, text, tags: [...new Set(tags)], author: author ?? settings().name, session: session().id, created: now, updated: now, ...extra, dirty: true };
  setLocal({ ...local(), [it.id]: it });
  syncSoon();
  return it;
}
export function updateItem(id, patch) {
  const loc = local();
  const base = loc[id] || builtinById(id);
  if (!base) return null;
  const type = patch.type || base.type;
  const extra = clean(type, Object.fromEntries(FIELDS.filter((k) => k in patch).map((k) => [k, patch[k]])));
  const rest = Object.fromEntries(Object.entries(patch).filter(([k]) => !FIELDS.includes(k)));
  const it = { ...base, ...rest, ...extra, id, updated: Date.now() };
  if (patch.text !== undefined) it.text = String(patch.text).trim().slice(0, 300);
  it.dirty = true;
  if (isBuiltin(id)) delete it.builtin;
  setLocal({ ...loc, [id]: it });
  syncSoon();
  return it;
}
/** Delete an added entry, or hide a built-in one (restore it with resetPacks). */
export function removeItem(id) { return updateItem(id, { deleted: true }); }
/** Undo every edit / hiding of the built-in entries (of these types; all when none given) — as fresh overrides with the
 *  original values, so the bridge and other displays restore them too. */
export function resetPacks(types = null) {
  const loc = { ...local() }, now = Date.now();
  for (const id of Object.keys(loc)) {
    if (!isBuiltin(id)) continue;
    const orig = builtinById(id);
    if (!orig) { delete loc[id]; continue; }
    if (types && !types.includes(orig.type)) continue;
    const { builtin: _, ...base } = orig;
    loc[id] = { ...base, updated: now, dirty: true };
  }
  setLocal(loc);
  syncSoon();
}

/** A random Truth or Dare item for the game, avoiding the ids in `used` until the pool runs out. */
export function pick(type, used = new Set(), opts = {}) {
  opts = gameOpts(opts);
  let t = type;
  if (type === 'random') {
    const c = counts({ ...opts, types: ['truth', 'dare'] });
    const choices = ['truth', 'dare'].filter((k) => c[k]);
    t = choices[Math.floor(Math.random() * choices.length)] || 'truth';
  }
  let list = pool({ ...opts, type: t });
  let fellBack = false;
  if (!list.length && (opts.filter ?? settings().filter) === 'session') { list = pool({ ...opts, type: t, filter: 'all' }); fellBack = true; }
  if (!list.length) return null;
  const fresh = list.filter((i) => !used.has(i.id));
  const from = fresh.length ? fresh : list;
  const it = from[Math.floor(Math.random() * from.length)];
  return { item: it, type: t, fellBack, recycled: !fresh.length };
}

// ---------------------------------------------------------------- lists (named collections; items of type 'list')
export function lists() {
  migrate();
  return Object.values(local()).filter((i) => i.type === 'list' && !i.deleted && i.text).sort((a, b) => a.text.localeCompare(b.text));
}
export const listById = (id) => lists().find((l) => l.id === id) || null;
export function createList(name) {
  name = String(name || '').trim().slice(0, 40);
  if (!name) return null;
  const ex = lists().find((l) => l.text.toLowerCase() === name.toLowerCase());
  if (ex) return ex;
  const now = Date.now();
  const l = { id: newId('l_'), type: 'list', text: name, tags: [], author: settings().name, session: '', created: now, updated: now, dirty: true };
  setLocal({ ...local(), [l.id]: l });
  syncSoon();
  return l;
}
export const renameList = (id, name) => (String(name || '').trim() ? updateItem(id, { text: name }) : null);
export const deleteList = (id) => updateItem(id, { deleted: true });
/** How many live entries are on each list → { [listId]: n } (of these types, when given). */
export function listCounts(types = null) {
  const c = {};
  for (const it of everything()) if (!types || types.includes(it.type)) for (const l of it.lists || []) c[l] = (c[l] || 0) + 1;
  return c;
}
/** Put an entry on a list or take it off. */
export function toggleList(id, listId, on) {
  const it = getItem(id);
  if (!it) return null;
  const set = new Set(it.lists || []);
  (on ?? !set.has(listId)) ? set.add(listId) : set.delete(listId);
  return updateItem(id, { lists: [...set] });
}

// ---------------------------------------------------------------- import / export (JSON, per game)
const EXPORT_KEYS = ['type', 'text', 'tags', 'lang', 'author', 'created', ...FIELDS.filter((k) => k !== 'lists' && k !== 'lang')];
/** The added entries of these types as a JSON-ready object (lists by name, so they come back on any display). */
export function exportData(types) {
  const ls = new Map(lists().map((l) => [l.id, l.text]));
  const items = everything().filter((it) => !it.builtin && types.includes(it.type)).map((it) => {
    const o = {};
    for (const k of EXPORT_KEYS) if (it[k] !== undefined && it[k] !== '' && !(Array.isArray(it[k]) && !it[k].length)) o[k] = it[k];
    const names = (it.lists || []).map((id) => ls.get(id)).filter(Boolean);
    if (names.length) o.lists = names;
    return o;
  });
  return { app: 'roundremote-tasks', version: 2, types, exported: new Date().toISOString(), items };
}
/** Add the entries of an exported file (ours, or a plain array of { type, text … }). Skips exact duplicates.
 *  → { added, skipped } */
export function importData(data, { types = TYPES } = {}) {
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  const have = new Set(everything().map((i) => `${i.type}|${String(i.text).trim().toLowerCase()}`));
  let added = 0, skipped = 0;
  for (const raw of items.slice(0, 5000)) {
    const type = String(raw?.type || '').toLowerCase();
    const key = `${type}|${String(raw?.text || raw?.q || '').trim().toLowerCase()}`;
    if (!types.includes(type) || have.has(key)) { skipped++; continue; }
    const listIds = (Array.isArray(raw.lists) ? raw.lists : []).map((n) => createList(n)?.id).filter(Boolean);
    const it = addItem({ ...raw, type, text: raw.text ?? raw.q, answer: raw.answer ?? raw.a, wrong: raw.wrong ?? raw.w, lists: listIds, author: raw.author ?? '' });
    if (it) { added++; have.add(key); } else skipped++;
  }
  return { added, skipped };
}

// ---------------------------------------------------------------- bridge sync
export const bridge = { status: 'unknown', info: null, error: '' };
// Edits of the built-in items (e.g. one marked 18+) are synced as overrides under their own b:… ids, but only to a
// bridge that says it keeps them (`overrides: true`) — an older one would store them as brand-new items. Entries of
// the newer types (drinking games, trivia, lists) need a bridge that says `types: [...]` includes them.
let overridesOk = false, bridgeTypes = new Set(TOD);
function setStatus(s, error = '') {
  if (bridge.status === s && bridge.error === error) return;
  bridge.status = s; bridge.error = error;
  events.emit('status', bridge);
}
const syncable = (i) => (overridesOk || !isBuiltin(i.id)) && bridgeTypes.has(i.type);

let syncing = null, again = false;
/** One round trip: push our new/edited items, pull everything that changed on the bridge. */
export function sync({ passive = false } = {}) {
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    if (passive && !mayProbe()) { setStatus('down', 'no bridge'); return; }
    const base = await bridgeBase();
    if (!base) { setStatus('down', 'Bridge not reachable'); return; }
    try {
      migrate();
      const dirty = Object.values(local()).filter((i) => i.dirty && syncable(i));
      if (dirty.length) {
        for (let k = 0; k < dirty.length; k += 400) {
          const part = dirty.slice(k, k + 400);
          await bridgeFetch('/api/tasks', { method: 'POST', json: { items: part.map(({ dirty: _, ...i }) => ({ ...i, device: 'display' })) } });
        }
        const loc = { ...local() };
        for (const d of dirty) if (loc[d.id] && loc[d.id].updated === d.updated) loc[d.id] = { ...loc[d.id], dirty: false };
        W({ items: loc });
      }
      const rev = D().rev || 0, first = !D().synced;
      const res = await bridgeFetch(`/api/tasks?since=${rev}`);
      overridesOk = !!res?.overrides;
      const before = bridgeTypes.size;
      bridgeTypes = new Set(Array.isArray(res?.types) ? res.types : TOD);
      if (bridgeTypes.size > before && Object.values(local()).some((i) => i.dirty && syncable(i))) again = true;  // newer bridge: push the rest
      if ((res?.rev ?? 0) < rev) { W({ rev: 0 }); again = true; return; }  // the bridge's list was reset: fetch it all again
      const loc = { ...local() }, fresh = [];
      let changed = false;
      for (const r of res?.items || []) {
        const l = loc[r.id];
        if (l && (l.updated || 0) > (r.updated || 0)) continue;  // our edit is newer (it'll be pushed)
        if (l && l.updated === r.updated && !!l.deleted === !!r.deleted && l.text === r.text) continue;
        if (!l && !r.deleted && !first && !isBuiltin(r.id) && r.type !== 'list') fresh.push(r);
        const { rev: _r, device: _d, ...it } = r;
        loc[r.id] = { ...it, dirty: false };
        changed = true;
      }
      W({ rev: res?.rev ?? rev, synced: true, ...(changed ? { items: loc } : {}) });
      if (changed) bump();
      setStatus('ok');
      const shown = fresh.filter((it) => settings().adult || !isAdult(it));  // never announce 18+ items while it's off
      if (shown.length) events.emit('fresh', shown);
    } catch (e) {
      setStatus('down', e.userMessage || e.message || 'Bridge error');
    }
  })().finally(() => { syncing = null; if (again) { again = false; sync({ passive }); } });
  return syncing;
}
let soonT = 0;
function syncSoon() { clearTimeout(soonT); soonT = setTimeout(() => { if (pollers) sync({ passive: true }); }, 300); }

let pollers = 0, pollT = 0;
/** Keep in sync while an app is open (every few seconds). Returns a stop function. */
export function startSync({ every = 3000, passive = false } = {}) {
  pollers++;
  if (pollers === 1) {
    sync({ passive });
    pollT = setInterval(() => sync({ passive }), every);
  }
  let stopped = false;
  return () => { if (stopped) return; stopped = true; pollers--; if (!pollers) clearInterval(pollT); };
}

/** The link the QR code shows: http://<bridge LAN IP>:<port>/tasks?s=<session>[&type=<type>]. Null when there's no
 *  bridge (→ reason 'nobridge' | 'old' | 'noip'). `type` preselects what the phone adds (never, likely, trivia …). */
export async function phoneUrl({ type = null } = {}) {
  const base = await bridgeBase();
  if (!base) { setStatus('down', 'Bridge not reachable'); return { url: null, reason: 'nobridge' }; }
  let info;
  try { info = await bridgeFetch('/api/tasks/info'); } catch (e) {
    setStatus('down', e.message);
    return { url: null, reason: e.status === 404 ? 'old' : 'nobridge' };
  }
  bridge.info = info;
  setStatus('ok');
  if (type && !TOD.includes(type) && !(info?.types || []).includes(type)) return { url: null, reason: 'old', info };
  const q = `/tasks?s=${encodeURIComponent(session().id)}${type ? `&type=${encodeURIComponent(type)}` : ''}${settings().adult ? '&x=1' : ''}`;
  if (info?.publicUrl) return { url: info.publicUrl.replace(/\/$/, '') + q, info };
  const u = new URL(base);
  if (!/^(localhost|127\.|\[?::1)/.test(u.hostname)) return { url: u.origin + q, info };
  const ip = info?.ips?.[0];
  if (!ip) return { url: null, reason: 'noip', info };
  return { url: `http://${ip}:${info.port || u.port || 8765}${q}`, info };
}

// ---------------------------------------------------------------- 18+ age check (shared by Tasks and the games)
/** Resolves true when 18+ may be turned on: asks "Everyone playing is 18 or older?" the first time, then remembers. */
export function confirmAdult(app) {
  if (D().adultOk) return Promise.resolve(true);
  ageCss();
  return new Promise((resolve) => {
    let ok = false;
    app.openPanel({
      title: '18+ mode', className: 'age-panel', onClose: () => resolve(ok),
      build(body, panel) {
        const { h } = app;
        const yes = h('button.pill.primary.age-yes', { type: 'button', onclick: () => { ok = true; W({ adultOk: true }); app.sfx?.('pop'); panel.close(); } }, 'Yes, we’re all 18+');
        body.append(
          h('div.age-badge', '18+'),
          h('div.age-q', 'Everyone playing is 18 or older?'),
          h('div.age-m', 'Adult cards are cheeky, flirty and party / drinking themed — never explicit. Any card can be skipped with Chicken, and a sip can be any drink (water counts).'),
          h('div.age-acts', h('button.pill', { type: 'button', onclick: () => panel.close() }, 'Cancel'), yes));
        setTimeout(() => yes.focus?.(), 50);
      },
    });
  });
}
function ageCss() {
  if (document.getElementById('age-css')) return;
  const st = document.createElement('style');
  st.id = 'age-css';
  st.textContent = `
.age-panel .panel-body { top: 20%; bottom: 20%; align-items: center; justify-content: center; gap: 2.4cqmin; text-align: center; }
.age-badge { width: 17cqmin; height: 17cqmin; border-radius: 50%; display: grid; place-items: center; font-family: var(--display); font-size: 6cqmin; font-weight: 800;
  color: var(--danger); border: .9cqmin solid var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); letter-spacing: -.02em; }
.age-q { font-family: var(--display); font-size: 4.4cqmin; font-weight: 800; line-height: 1.15; max-width: 54cqmin; }
.age-m { font-size: 2.45cqmin; line-height: 1.4; color: var(--muted); max-width: 56cqmin; }
.age-acts { display: flex; gap: 2cqmin; margin-top: 1cqmin; }
.age-acts .pill { font-size: 2.8cqmin; padding: 2cqmin 4cqmin; }
#app .age-panel .pill.primary.age-yes { background: var(--danger); color: #fff; box-shadow: 0 1cqmin 4cqmin color-mix(in srgb, var(--danger) 35%, transparent); }`;
  document.head.append(st);
}
