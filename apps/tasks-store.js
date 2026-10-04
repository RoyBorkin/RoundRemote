// Shared data for the Tasks app and Truth or Dare: truths, dares and tasks (built-in starter packs + everything
// players add), game sessions, the "All / This session" filter, tags, and the sync with the bridge
// (bridge/lib/tasks.js), where phones add items through the QR-code page. Everything is kept in the app's
// settings (appData.tasks) so the lists work without the bridge too; local and bridge copies merge by id.
import { store } from '../js/core/store.js';
import { Emitter } from '../js/core/util.js';
import { bridgeBase, bridgeFetch, mayProbe } from '../js/providers/bridge.js';
import { PACKS } from './tasks-packs.js';

export const TYPES = ['truth', 'dare', 'task'];
export const TYPE_META = {
  truth: { name: 'Truth', plural: 'Truths', color: '#60a5fa', he: 'אמת' },
  dare: { name: 'Dare', plural: 'Dares', color: '#f472b6', he: 'חובה' },
  task: { name: 'Task', plural: 'Tasks', color: '#a78bfa', he: 'משימה' },
};
export const TAGS = ['family', 'party', 'funny', 'active', '18+'];
export const TAG_NAMES = { family: 'Family', party: 'Party', funny: 'Funny', active: 'Active', '18+': '18+' };

export const events = new Emitter();  // 'change' (items/settings), 'status' (bridge), 'fresh' (items added from a phone)

// ---------------------------------------------------------------- persistence (appData.tasks)
const D = () => (store.get('appData') || {}).tasks || {};
function W(patch) {
  const all = store.get('appData') || {};
  store.set('appData', { ...all, tasks: { ...(all.tasks || {}), ...patch } });
}
const local = () => D().items || {};
const setLocal = (items) => { W({ items }); bump(); };
let ver = 0, cache = null;
function bump() { ver++; cache = null; events.emit('change'); }

const hebrewFirst = () => store.get('kbdLang') === 'he' || /^(he|iw)/i.test(navigator.language || '');
export function settings() {
  const d = D();
  return {
    filter: d.filter === 'session' ? 'session' : 'all',
    adult: !!d.adult,
    packs: { en: true, he: hebrewFirst(), ...(d.packs || {}) },
    tags: Array.isArray(d.tags) ? d.tags : [],   // [] = any tag
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

// ---------------------------------------------------------------- items
const isBuiltin = (id) => String(id).startsWith('b:');
const builtinById = new Map(Object.values(PACKS).flatMap((p) => p.items).map((i) => [i.id, i]));

/** Every live item: enabled starter packs (with your edits) and everything added on the display or a phone. */
export function allItems() {
  if (cache) return cache;
  const loc = local(), { packs } = settings();
  const out = [];
  for (const [lang, pack] of Object.entries(PACKS)) {
    if (!packs[lang]) continue;
    for (const it of pack.items) { const o = loc[it.id]; if (!o) out.push(it); else if (!o.deleted) out.push({ ...it, ...o }); }
  }
  for (const it of Object.values(loc)) if (!isBuiltin(it.id) && !it.deleted && it.text) out.push(it);
  cache = out;
  return out;
}
export const getItem = (id) => allItems().find((i) => i.id === id) || null;
export const isAdult = (it) => (it.tags || []).includes('18+');

/** Items for a game: type ('truth' | 'dare' | 'task' | null = all), the All/This-session filter, tags and the 18+ gate. */
export function pool({ type = null, filter, adult, tags } = {}) {
  const s = settings();
  filter ??= s.filter; adult ??= s.adult; tags ??= s.tags;
  const sid = session().id;
  return allItems().filter((it) => (!type || it.type === type)
    && (filter !== 'session' || it.session === sid)
    && (adult || !isAdult(it))
    && (!tags.length || (it.tags || []).some((t) => tags.includes(t))));
}
export function counts(opts = {}) {
  const c = { truth: 0, dare: 0, task: 0 };
  for (const it of pool(opts)) c[it.type] = (c[it.type] || 0) + 1;
  return c;
}

const newId = () => 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
export function addItem({ type, text, tags = ['family'], author }) {
  text = String(text || '').trim().slice(0, 300);
  if (!text || !TYPE_META[type]) return null;
  const now = Date.now();
  const it = { id: newId(), type, text, tags: [...new Set(tags)], author: author ?? settings().name, session: session().id, created: now, updated: now, dirty: true };
  setLocal({ ...local(), [it.id]: it });
  syncSoon();
  return it;
}
export function updateItem(id, patch) {
  const loc = local();
  const base = loc[id] || builtinById.get(id);
  if (!base) return null;
  const it = { ...base, ...patch, id, updated: Date.now() };
  if (patch.text !== undefined) it.text = String(patch.text).trim().slice(0, 300);
  if (!isBuiltin(id)) it.dirty = true; else delete it.builtin;
  setLocal({ ...loc, [id]: it });
  syncSoon();
  return it;
}
export function removeItem(id) { return updateItem(id, { deleted: true }); }
/** Undo every edit / deletion of the starter packs. */
export function resetPacks() {
  const loc = { ...local() };
  for (const id of Object.keys(loc)) if (isBuiltin(id)) delete loc[id];
  setLocal(loc);
}

/** A random item for the game, avoiding the ids in `used` until the pool runs out. */
export function pick(type, used = new Set(), opts = {}) {
  let t = type;
  if (type === 'random') {
    const c = counts(opts);
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

// ---------------------------------------------------------------- bridge sync
export const bridge = { status: 'unknown', info: null, error: '' };
function setStatus(s, error = '') {
  if (bridge.status === s && bridge.error === error) return;
  bridge.status = s; bridge.error = error;
  events.emit('status', bridge);
}

let syncing = null, again = false;
/** One round trip: push our new/edited items, pull everything that changed on the bridge. */
export function sync({ passive = false } = {}) {
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    if (passive && !mayProbe()) { setStatus('down', 'no bridge'); return; }
    const base = await bridgeBase();
    if (!base) { setStatus('down', 'Bridge not reachable'); return; }
    try {
      const dirty = Object.values(local()).filter((i) => i.dirty && !isBuiltin(i.id));
      if (dirty.length) {
        await bridgeFetch('/api/tasks', { method: 'POST', json: { items: dirty.map(({ dirty: _, ...i }) => ({ ...i, device: 'display' })) } });
        const loc = { ...local() };
        for (const d of dirty) if (loc[d.id] && loc[d.id].updated === d.updated) loc[d.id] = { ...loc[d.id], dirty: false };
        W({ items: loc });
      }
      const rev = D().rev || 0, first = !D().synced;
      const res = await bridgeFetch(`/api/tasks?since=${rev}`);
      if ((res?.rev ?? 0) < rev) { W({ rev: 0 }); again = true; return; }  // the bridge's list was reset: fetch it all again
      const loc = { ...local() }, fresh = [];
      let changed = false;
      for (const r of res?.items || []) {
        const l = loc[r.id];
        if (l && (l.updated || 0) > (r.updated || 0)) continue;  // our edit is newer (it'll be pushed)
        if (l && l.updated === r.updated && !!l.deleted === !!r.deleted && l.text === r.text) continue;
        if (!l && !r.deleted && !first) fresh.push(r);
        const { rev: _r, device: _d, ...it } = r;
        loc[r.id] = { ...it, dirty: false };
        changed = true;
      }
      W({ rev: res?.rev ?? rev, synced: true, ...(changed ? { items: loc } : {}) });
      if (changed) bump();
      setStatus('ok');
      if (fresh.length) events.emit('fresh', fresh);
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

/** The link the QR code shows: http://<bridge LAN IP>:<port>/tasks?s=<session>. Null when there's no bridge. */
export async function phoneUrl() {
  const base = await bridgeBase();
  if (!base) { setStatus('down', 'Bridge not reachable'); return { url: null, reason: 'nobridge' }; }
  let info;
  try { info = await bridgeFetch('/api/tasks/info'); } catch (e) {
    setStatus('down', e.message);
    return { url: null, reason: e.status === 404 ? 'old' : 'nobridge' };
  }
  bridge.info = info;
  setStatus('ok');
  const q = `/tasks?s=${encodeURIComponent(session().id)}${settings().adult ? '&x=1' : ''}`;
  if (info?.publicUrl) return { url: info.publicUrl.replace(/\/$/, '') + q, info };
  const u = new URL(base);
  if (!/^(localhost|127\.|\[?::1)/.test(u.hostname)) return { url: u.origin + q, info };
  const ip = info?.ips?.[0];
  if (!ip) return { url: null, reason: 'noip', info };
  return { url: `http://${ip}:${info.port || u.port || 8765}${q}`, info };
}
