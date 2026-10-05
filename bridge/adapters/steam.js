// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Steam — your profile and status (online / away / in-game), the game being played now, recently played
// games with hours, the current game's achievements (progress, latest unlocks, what's next) and the friends
// who are online, from the Steam Web API (a free key from steamcommunity.com/dev/apikey). The key stays here
// on the bridge (bridge/steam.json); the app never sees it.
//
// Control on this computer: launch a game (steam://rungameid/<appid>) or open Big Picture
// (steam://open/bigpicture) through the OS opener (start / open / xdg-open) — Steam must be installed here.
//
// Actions: GET status · POST setup {apiKey, user} · POST signout · GET summary · POST launch {appid} · POST bigpicture
//          GET owned (every game you own: IPlayerService/GetOwnedGames with app info, cached 6 h — also in the summary as
//          `owned` [{appid, name, hours}] for Decide, and the Collection app's Steam connection)
//          Wish Lists app (apps/wishlist.js): GET store {term} (Steam store search) · GET wishlist (your Steam wishlist)
//          · GET fetchjson {url} (JSON from the few public APIs the app searches when the browser can't reach them: fetchHosts)
// config.json → "steam": { apiKey, steamId, language, control, opener, apiBase, cdnBase, mediaBase, storeBase, country, fetchHosts, stateFile, owned }
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { log } from '../lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PERSONA = ['offline', 'online', 'busy', 'away', 'snooze', 'trade', 'play'];

/** SteamID64, a profile URL (…/profiles/7656… or …/id/name) or a custom URL name → { id } | { vanity } */
export function parseSteamUser(v) {
  const s = String(v || '').trim().replace(/\/+$/, '');
  if (/^7656\d{13}$/.test(s)) return { id: s };
  const p = /steamcommunity\.com\/profiles\/(\d{17})/i.exec(s);
  if (p) return { id: p[1] };
  const n = /steamcommunity\.com\/id\/([^/?#]+)/i.exec(s);
  if (n) return { vanity: decodeURIComponent(n[1]) };
  return s ? { vanity: s } : {};
}

export function create({ cfg = {}, setStatus }) {
  const c = {
    apiBase: 'https://api.steampowered.com',
    cdnBase: 'https://cdn.cloudflare.steamstatic.com/steam/apps',
    mediaBase: 'https://media.steampowered.com/steamcommunity/public/images/apps',
    storeBase: 'https://store.steampowered.com', country: 'US',
    fetchHosts: ['itunes.apple.com', 'store.steampowered.com', 'openlibrary.org'],
    language: 'english', control: true, opener: '', apiKey: '', steamId: '', owned: true,
    stateFile: path.join(__dirname, '..', 'steam.json'),
    ...(cfg.steam || {}),
  };
  const load = () => { try { return JSON.parse(fs.readFileSync(c.stateFile, 'utf8')); } catch { return {}; } };
  const save = () => { try { fs.writeFileSync(c.stateFile, JSON.stringify(st, null, 2)); } catch (e) { log('steam', `could not save ${c.stateFile}: ${e.message}`); } };
  let st = load();
  const key = () => st.apiKey || c.apiKey;
  const me = () => st.steamId || (/^\d{17}$/.test(c.steamId) ? c.steamId : '');
  const ready = () => !!(key() && me());
  const status = () => setStatus(ready() ? `running · ${st.name || me()}` : 'running · needs a Steam Web API key', ready());
  const cache = new Map();

  const art = (appid) => ({ header: `${c.cdnBase}/${appid}/header.jpg`, hero: `${c.cdnBase}/${appid}/library_hero.jpg`, capsule: `${c.cdnBase}/${appid}/library_600x900.jpg` });
  const fail = (msg, extra = {}) => Object.assign(new Error(msg), extra);

  async function api(iface, method, ver, params = {}, k = key()) {
    const url = `${c.apiBase}/${iface}/${method}/v${ver}/?${new URLSearchParams({ key: k, format: 'json', ...params })}`;
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(15000) }); }
    catch (e) { throw fail(`Can't reach Steam (${e.cause?.code || e.message})`); }
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    // a bad key gets an HTML "Forbidden" page; private profiles answer 401/403 too (JSON, or for the friend list)
    if ((r.status === 403 || r.status === 401) && !j && method !== 'GetFriendList') throw fail('Steam refused the Web API key — check it at steamcommunity.com/dev/apikey', { status: r.status, auth: true });
    if (!r.ok || !j) throw fail(j?.playerstats?.error || `Steam error ${r.status}`, { status: r.status, body: j });
    return j;
  }
  async function cached(key, ttlMs, fn) {
    const e = cache.get(key);
    if (e?.data !== undefined && Date.now() - e.at < ttlMs) return e.data;
    if (e?.p) return e.p;
    const p = fn().then((data) => { cache.set(key, { at: Date.now(), data }); return data; })
      .catch((err) => { if (e?.data !== undefined && !err.auth) { cache.set(key, { ...e, p: null }); return e.data; } cache.delete(key); throw err; });
    cache.set(key, { ...(e || {}), p });
    return p;
  }
  async function resolve(user, k) {
    const u = parseSteamUser(user);
    if (u.id) return u.id;
    if (!u.vanity) throw fail('Enter your SteamID64, profile link or custom URL name');
    const j = await api('ISteamUser', 'ResolveVanityURL', 1, { vanityurl: u.vanity }, k);
    if (j.response?.success !== 1) throw fail(`No Steam profile with the custom URL “${u.vanity}” — use your SteamID64 or profile link`);
    return j.response.steamid;
  }
  const summaries = async (ids) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) out.push(...((await api('ISteamUser', 'GetPlayerSummaries', 2, { steamids: ids.slice(i, i + 100).join(',') })).response?.players || []));
    return out;
  };
  const person = (p) => ({
    steamid: p.steamid, name: p.personaname, avatar: p.avatarfull || p.avatarmedium || p.avatar || '', profileUrl: p.profileurl || '',
    state: PERSONA[p.personastate] || 'offline', stateCode: p.personastate || 0, public: p.communityvisibilitystate === 3,
    lastOnline: p.lastlogoff ? p.lastlogoff * 1000 : null, country: p.loccountrycode || '',
    game: p.gameid ? { appid: +p.gameid, name: p.gameextrainfo || 'a game', ...art(p.gameid) } : null,
  });

  const profile = () => cached('profile', 15000, async () => {
    const p = (await summaries([me()]))[0];
    if (!p) throw fail('Steam doesn’t know this profile');
    if (p.personaname && st.name !== p.personaname) { st.name = p.personaname; save(); status(); }
    return person(p);
  });
  const level = () => cached('level', 3600e3, async () => (await api('IPlayerService', 'GetSteamLevel', 1, { steamid: me() })).response?.player_level ?? null);
  const recent = () => cached('recent', 5 * 60e3, async () => ((await api('IPlayerService', 'GetRecentlyPlayedGames', 1, { steamid: me(), count: 12 })).response?.games || []).map((g) => ({
    appid: g.appid, name: g.name, hours2w: Math.round((g.playtime_2weeks || 0) / 6) / 10, hours: Math.round((g.playtime_forever || 0) / 6) / 10,
    icon: g.img_icon_url ? `${c.mediaBase}/${g.appid}/${g.img_icon_url}.jpg` : '', ...art(g.appid),
  })));
  // every game you own (private "game details" → an empty list); 6 h cache — it changes when you buy something
  const owned = () => cached('owned', 6 * 3600e3, async () => ((await api('IPlayerService', 'GetOwnedGames', 1, { steamid: me(), include_appinfo: 1, include_played_free_games: 1 })).response?.games || [])
    .filter((g) => g?.name).map((g) => ({ appid: g.appid, name: g.name, hours: Math.round((g.playtime_forever || 0) / 6) / 10, lastPlayed: g.rtime_last_played ? g.rtime_last_played * 1000 : null })));
  async function achievements(appid, current) {
    const [mine, schema, global] = await Promise.all([
      cached(`ach:${appid}`, current ? 60e3 : 5 * 60e3, () => api('ISteamUserStats', 'GetPlayerAchievements', 1, { steamid: me(), appid, l: c.language })
        .catch((e) => { if (e.body?.playerstats) return e.body; throw e; })),   // "Requested app has no stats" / private game details
      cached(`schema:${appid}`, 24 * 3600e3, () => api('ISteamUserStats', 'GetSchemaForGame', 2, { appid, l: c.language }).catch(() => ({}))),
      cached(`global:${appid}`, 24 * 3600e3, () => api('ISteamUserStats', 'GetGlobalAchievementPercentagesForApp', 2, { gameid: appid }).catch(() => ({}))),
    ]);
    const ps = mine.playerstats || {};
    if (ps.success === false || !ps.achievements) return null;   // no achievements / private game details
    const defs = new Map((schema.game?.availableGameStats?.achievements || []).map((a) => [a.name, a]));
    const pct = new Map((global.achievementpercentages?.achievements || []).map((a) => [a.name, +a.percent]));
    const all = ps.achievements.map((a) => {
      const d = defs.get(a.apiname) || {};
      const hidden = !!d.hidden && !a.achieved;
      return { id: a.apiname, name: hidden ? 'Hidden achievement' : a.name || d.displayName || a.apiname, desc: hidden ? '' : a.description || d.description || '',
        icon: (a.achieved ? d.icon : d.icongray) || d.icon || '', at: a.achieved ? (a.unlocktime || 0) * 1000 : null, rate: pct.has(a.apiname) ? Math.round(pct.get(a.apiname) * 10) / 10 : null, hidden: !!d.hidden };
    });
    const got = all.filter((a) => a.at != null).sort((a, b) => b.at - a.at);
    return {
      appid, name: ps.gameName || schema.game?.gameName || '', current, unlocked: got.length, total: all.length,
      percent: all.length ? Math.round((got.length / all.length) * 1000) / 10 : 0,
      recent: got.slice(0, 8), next: all.filter((a) => a.at == null && !a.hidden).sort((a, b) => (b.rate || 0) - (a.rate || 0)).slice(0, 3),
    };
  }
  const friends = () => cached('friends', 60e3, async () => {
    let list;
    try { list = (await api('ISteamUser', 'GetFriendList', 1, { steamid: me(), relationship: 'friend' })).friendslist?.friends || []; }
    catch (e) { if (e.status === 401) return { total: null, online: [], private: true }; throw e; }
    const people = (await summaries(list.map((f) => f.steamid))).map(person).filter((p) => p.stateCode > 0);
    people.sort((a, b) => (b.game ? 1 : 0) - (a.game ? 1 : 0) || (a.state === 'online' ? 0 : 1) - (b.state === 'online' ? 0 : 1) || a.name.localeCompare(b.name));
    return { total: list.length, online: people.slice(0, 40) };
  });

  async function summary() {
    if (!ready()) return { signedIn: false, error: key() ? 'Add your Steam profile' : 'Add a Steam Web API key' };
    const errors = {};
    const safe = (k, p) => p.catch((e) => { if (e.auth) throw e; errors[k] = e.message; return null; });
    try {
      const [prof, lvl, games, fr, own] = await Promise.all([profile(), safe('level', level()), safe('recent', recent()), safe('friends', friends()), c.owned ? safe('owned', owned()) : null]);
      let now = prof.game ? { ...prof.game } : null;
      if (now) { const g = games?.find((x) => x.appid === now.appid); if (g) Object.assign(now, { hours: g.hours, hours2w: g.hours2w, icon: g.icon }); }
      let ach = null;
      const appid = now?.appid || games?.[0]?.appid;
      if (appid) { try { ach = await achievements(appid, !!now); } catch (e) { if (e.auth) throw e; errors.achievements = e.message; } }
      if (ach && !ach.name) ach.name = now?.name || games?.find((g) => g.appid === appid)?.name || '';
      return { signedIn: true, profile: { ...prof, level: lvl }, now, achievements: ach, recent: games, friends: fr, control: !!c.control, errors, at: Date.now(),
        ...(own ? { owned: own.map(({ appid, name, hours }) => ({ appid, name, hours })) } : {}) };
    } catch (e) {
      if (e.auth) return { signedIn: false, error: e.message };
      throw e;
    }
  }

  // ---------------------------------------------------------------- control (on this computer)
  function open(url) {
    if (!c.control) throw fail('Steam control is turned off in the bridge config (steam.control)');
    const [cmd, ...args] = c.opener ? [...String(c.opener).split(' ').filter(Boolean), url]
      : process.platform === 'win32' ? ['cmd', '/c', 'start', '""', url]
        : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url];
    return new Promise((resolve, reject) => {
      const ch = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: process.platform === 'win32' && !c.opener });
      ch.on('error', (e) => reject(fail(`Couldn’t open Steam on the bridge computer (${cmd}: ${e.code || e.message})`)));
      ch.on('spawn', () => { ch.unref(); log('steam', `opened ${url}`); resolve({ ok: true }); });
    });
  }

  // ---------------------------------------------------------------- Wish Lists: store search, your wishlist, a small JSON fetcher
  async function getJson(url, what) {
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } }); }
    catch (e) { throw fail(`Can't reach ${what} (${e.cause?.code || e.message})`); }
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { throw fail(`${what} answered ${r.status} without JSON`); }
    if (!r.ok) throw fail(`${what} error ${r.status}`);
    return j;
  }
  const yearOf = (t) => (t ? new Date(t * 1000).getUTCFullYear() : null);
  async function storeSearch(term) {
    term = String(term || '').trim().slice(0, 100);
    if (!term) return { items: [] };
    return cached(`store:${term.toLowerCase()}`, 10 * 60e3, async () => {
      const j = await getJson(`${c.storeBase}/api/storesearch/?${new URLSearchParams({ term, l: c.language, cc: c.country })}`, 'the Steam store');
      return { items: (j.items || []).filter((x) => x.type === 'app' || !x.type).slice(0, 20).map((x) => ({
        appid: x.id, name: x.name, ...art(x.id), small: x.tiny_image || '', metascore: +x.metascore || null,
        price: x.price ? { final: x.price.final / 100, currency: x.price.currency } : null,
        platforms: Object.entries(x.platforms || {}).filter(([, v]) => v).map(([k]) => k),
      })) };
    });
  }
  /** Names, studio and year for appids (IStoreBrowseService/GetItems, 50 at a time). */
  async function storeItems(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      const input = { ids: ids.slice(i, i + 50).map((appid) => ({ appid })), context: { language: c.language, country_code: c.country }, data_request: { include_basic_info: true, include_release: true } };
      try {
        const j = await api('IStoreBrowseService', 'GetItems', 1, { input_json: JSON.stringify(input) });
        for (const x of j.response?.store_items || []) if (x.appid && x.name) out.set(x.appid, { name: x.name, by: x.basic_info?.developers?.[0]?.name || x.basic_info?.publishers?.[0]?.name || '', year: yearOf(x.release?.steam_release_date || x.release?.original_release_date) });
      } catch (e) { if (e.auth) throw e; log('steam', `store items: ${e.message}`); }
    }
    return out;
  }
  const wishlist = () => cached('wishlist', 10 * 60e3, async () => {
    const j = await api('IWishlistService', 'GetWishlist', 1, { steamid: me() });
    const rows = (j.response?.items || []).sort((a, b) => (a.priority || 0) - (b.priority || 0) || (b.date_added || 0) - (a.date_added || 0)).slice(0, 300);
    const info = await storeItems(rows.map((x) => x.appid));
    // anything GetItems didn't name: the store's appdetails (one app per call, so only a few)
    let n = 0;
    for (const x of rows) {
      if (info.has(x.appid) || n++ >= 15) continue;
      try {
        const d = (await getJson(`${c.storeBase}/api/appdetails?${new URLSearchParams({ appids: x.appid, l: c.language, cc: c.country })}`, 'the Steam store'))?.[x.appid]?.data;
        if (d?.name) info.set(x.appid, { name: d.name, by: d.developers?.[0] || '', year: parseInt(String(d.release_date?.date || '').match(/\d{4}/)?.[0], 10) || null });
      } catch {}
    }
    return rows.filter((x) => info.has(x.appid)).map((x) => ({ appid: x.appid, ...info.get(x.appid), ...art(x.appid), priority: x.priority || 0, added: x.date_added ? x.date_added * 1000 : null }));
  });

  const actions = {
    async store({ term }) { return storeSearch(term); },
    async wishlist() {
      if (!ready()) throw fail(key() ? 'Add your Steam profile in Steam setup first' : 'Set up Steam (Home → Steam) to import your wishlist');
      return { items: await wishlist() };
    },
    async fetchjson({ url }) {
      let u;
      try { u = new URL(String(url || '')); } catch { throw fail('bad url'); }
      const hosts = Array.isArray(c.fetchHosts) ? c.fetchHosts : [];
      if (!/^https?:$/.test(u.protocol) || !hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) throw fail(`${u.hostname} is not on the bridge's list (steam.fetchHosts)`);
      return cached(`fetch:${u.href}`, 5 * 60e3, () => getJson(u.href, u.hostname));
    },
    async status() { return { signedIn: ready(), hasKey: !!key(), steamId: me(), name: st.name || '', control: !!c.control }; },
    async owned({ force } = {}) {
      if (!ready()) throw fail(key() ? 'Add your Steam profile in Steam setup first' : 'Set up Steam (Home → Steam) first');
      if (force === '1' || force === true) cache.delete('owned');
      const games = await owned();
      return { items: games.map((g) => ({ ...g, ...art(g.appid) })), count: games.length, at: cache.get('owned')?.at || Date.now() };
    },
    async setup({ apiKey, user }) {
      const k = String(apiKey || '').trim() || key();
      if (!/^[0-9A-F]{32}$/i.test(k || '')) throw fail('A Steam Web API key is 32 letters and digits (steamcommunity.com/dev/apikey)');
      const id = await resolve(user || me(), k);
      const p = (await api('ISteamUser', 'GetPlayerSummaries', 2, { steamids: id }, k)).response?.players?.[0];
      if (!p) throw fail('Steam doesn’t know that profile');
      st = { apiKey: k, steamId: id, name: p.personaname };
      save(); cache.clear(); status(); log('steam', `set up for ${p.personaname} (${id})`);
      return { ok: true, steamId: id, name: p.personaname, public: p.communityvisibilitystate === 3 };
    },
    async signout() { st = {}; save(); cache.clear(); status(); return { ok: true }; },
    summary,
    async launch({ appid }) {
      if (!/^\d{1,10}$/.test(String(appid || ''))) throw fail('Which game? (appid)');
      return open(`steam://rungameid/${appid}`);
    },
    async bigpicture() { return open('steam://open/bigpicture'); },
  };

  return { id: 'steam', actions, async start() { status(); }, stop() {} };
}
