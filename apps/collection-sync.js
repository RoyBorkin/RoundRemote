// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Collection — the six connections (display side). BoardGameGeek, PriceCharting and RAWG go through the bridge
// (bridge/lib/collection.js keeps their tokens / keys); Steam through the Steam adapter (bridge/adapters/steam.js →
// owned); PlayStation from the PlayStation screen's data (js/providers/playstation.js); spreadsheets (GamEye, CLZ,
// Grouvee, BGG CSV, BG Stats, any CSV) from the phone page or a file chosen here, parsed by apps/collection-sources.js.
// Every sync merges with the rules in collection-sources.js (never overwrites your edits).
import { bridgeBase, bridgeFetch, mayProbe } from '../js/providers/bridge.js';
import { provider } from '../js/providers/registry.js';
import * as C from './collection-store.js';
import { importText } from './collection-sources.js';

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
  sheet: [
    'Export your list: GamEye (Settings → Export → CSV), CLZ Games (Export to CSV), Grouvee (Export), BoardGameGeek (Collection → Export) or BG Stats (Export → JSON) — or any spreadsheet saved as CSV.',
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
  { id: 'sheet', name: 'Spreadsheet import', kind: null, color: '#7c3aed', blurb: 'GamEye, CLZ, Grouvee, BGG, BG Stats or any CSV', steps: STEPS.sheet },
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
  return false;
}

async function entriesFor(id, { force = false } = {}) {
  if (id === 'bgg') { const r = await viaBridge(`/api/collection/bgg${force ? '?force=1' : ''}`, { timeout: 120000 }); return { entries: r.items, user: r.username, note: r.counts ? `${r.counts.games} games · ${r.counts.expansions} expansions` : '' }; }
  if (id === 'pricecharting') { const r = await viaBridge('/api/collection/pricecharting', { timeout: 45000 }); return { entries: r.items }; }
  if (id === 'rawg') { const r = await viaBridge('/api/collection/rawg', { timeout: 120000 }); return { entries: r.items, user: r.username }; }
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
/** → { items: [entry], error } — RAWG for video games, BGG for board games (through the bridge, when set up). */
export async function search(kind, q) {
  const src = kind === 'board' ? 'bgg' : 'rawg';
  const r = await viaBridge(`/api/collection/search?src=${src}&q=${encodeURIComponent(q)}`, { timeout: 30000 });
  return (r.items || []).map((x) => ({ ...x, source: src }));
}
