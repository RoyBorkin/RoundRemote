// PlayStation Network — your profile, presence (online / the game you're playing now), recently played
// games with play time, trophies (level + counts, the current game's progress and latest trophies) and the
// friends who are online. Same endpoints the PlayStation App uses, called directly like the psn-api
// library does (github.com/achievements-app/psn-api) — no npm packages.
//
// Sign-in (once): sign in at playstation.com, open https://ca.account.sony.com/api/v1/ssocookie and copy
// the "npsso" value → the app sends it here (POST signin) → exchanged for an access + refresh token, kept
// in bridge/psn.json and refreshed by themselves (the refresh token lasts about two months).
//
// Console power (optional): with the `playactor` CLI installed on this computer (npm i -g playactor, then a
// one-time `playactor login --ps5`), GET console / POST console {action:'wake'|'standby'}.
//
// Actions: GET status · POST signin {npsso} · POST signout · GET summary · GET console · POST console {action}
// config.json → "psn": { npsso, language, authBase, apiBase, stateFile, playactor: { bin, ip, hostId, ps4, args } | false }
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { log } from '../lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The PlayStation App's OAuth client (public; the same values every PSN library uses).
const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const CLIENT_BASIC = 'MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';
const REDIRECT = 'com.scee.psxandroid.scecompcall://redirect';
const SCOPE = 'psn:mobile.v2.core psn:clientapp';

/** "PT228H56M33S" → minutes */
export function isoMinutes(d = '') {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(String(d));
  if (!m) return 0;
  return (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + Math.round((+m[4] || 0) / 60);
}
const PLATFORM = { ps5_native_game: 'PS5', ps4_game: 'PS4', pspc_game: 'PC' };
const platformName = (p) => (p ? (/^ps\d$/i.test(p) ? p.toUpperCase() : PLATFORM[p] || String(p).toUpperCase()) : '');
const bigAvatar = (avatars = []) => {
  const order = ['xl', 'l', 'm', 's'];
  return [...avatars].sort((a, b) => order.indexOf(String(a.size).toLowerCase()) - order.indexOf(String(b.size).toLowerCase()))[0]?.url || '';
};
/** Pull an NPSSO out of whatever was pasted: the bare value, or the JSON the ssocookie page shows. */
export function parseNpsso(v) {
  const s = String(v || '').trim();
  const m = /"npsso"\s*:\s*"([^"]+)"/.exec(s) || /npsso=([A-Za-z0-9]+)/.exec(s);
  return (m ? m[1] : s).trim();
}

export function create({ cfg = {}, setStatus }) {
  const c = {
    authBase: 'https://ca.account.sony.com/api/authz/v3/oauth',
    apiBase: 'https://m.np.playstation.com/api',
    language: 'en-US', npsso: '', playactor: {},
    stateFile: path.join(__dirname, '..', 'psn.json'),
    ...(cfg.psn || {}),
  };
  const pa = c.playactor === false ? null : { bin: 'playactor', ip: '', hostId: '', ps4: false, args: [], ...(c.playactor || {}) };
  const load = () => { try { return JSON.parse(fs.readFileSync(c.stateFile, 'utf8')); } catch { return {}; } };
  const save = () => { try { fs.writeFileSync(c.stateFile, JSON.stringify(st, null, 2)); } catch (e) { log('psn', `could not save ${c.stateFile}: ${e.message}`); } };
  let st = load();
  const cache = new Map();   // key → { at, data, p }
  const signedIn = () => !!st.refreshToken && (!st.refreshExp || st.refreshExp > Date.now());
  const status = () => setStatus(signedIn() ? `running · signed in${st.onlineId ? ` as ${st.onlineId}` : ''}` : 'running · sign in with an NPSSO token', signedIn());

  // ---------------------------------------------------------------- auth
  const fail = (msg, extra = {}) => Object.assign(new Error(msg), extra);
  async function tokenRequest(params) {
    const r = await fetch(`${c.authBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${CLIENT_BASIC}` },
      body: new URLSearchParams({ ...params, token_format: 'jwt' }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw fail(j.error_description || j.error || `Sony sign-in failed (HTTP ${r.status})`, { status: r.status, auth: true });
    st = {
      ...st, accessToken: j.access_token, accessExp: Date.now() + (j.expires_in || 3600) * 1000,
      refreshToken: j.refresh_token || st.refreshToken, refreshExp: j.refresh_token_expires_in ? Date.now() + j.refresh_token_expires_in * 1000 : st.refreshExp,
    };
    save();
    return st.accessToken;
  }
  async function exchangeNpsso(npsso) {
    const q = new URLSearchParams({ access_type: 'offline', client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE });
    let r;
    try { r = await fetch(`${c.authBase}/authorize?${q}`, { headers: { Cookie: `npsso=${npsso}` }, redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
    catch (e) { throw fail(`Can't reach Sony (${e.cause?.code || e.message})`); }
    const loc = r.headers.get('location') || '';
    if (!loc.includes('?code=')) throw fail('Sony didn’t accept that NPSSO token. Sign in at playstation.com again and copy a fresh one (it changes every time you sign in).', { auth: true });
    const code = new URLSearchParams(loc.split('?')[1]).get('code');
    return tokenRequest({ code, redirect_uri: REDIRECT, grant_type: 'authorization_code' });
  }
  let refreshing = null;
  async function token({ force = false } = {}) {
    if (!force && st.accessToken && st.accessExp > Date.now() + 60000) return st.accessToken;
    if (!signedIn()) {
      if (c.npsso && !st.triedConfigNpsso) { st.triedConfigNpsso = true; return exchangeNpsso(parseNpsso(c.npsso)); }
      throw fail(st.refreshToken ? 'The PlayStation sign-in expired — paste a new NPSSO token' : 'Not signed in to PlayStation Network yet', { signin: true });
    }
    refreshing ||= tokenRequest({ refresh_token: st.refreshToken, grant_type: 'refresh_token', scope: SCOPE })
      .catch((e) => { if (e.status === 400 || e.status === 401) { delete st.refreshToken; save(); status(); e.signin = true; e.message = 'The PlayStation sign-in expired — paste a new NPSSO token'; } throw e; })
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  async function api(p, query = null, retry = true) {
    const tok = await token();
    const url = `${c.apiBase}${p}${query ? `?${new URLSearchParams(query)}` : ''}`;
    let r;
    try { r = await fetch(url, { headers: { Authorization: `Bearer ${tok}`, 'Accept-Language': c.language, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); }
    catch (e) { throw fail(`Can't reach PlayStation Network (${e.cause?.code || e.message})`); }
    if (r.status === 401 && retry) { await token({ force: true }); return api(p, query, false); }
    const j = await r.json().catch(() => null);
    if (!r.ok || j?.error) throw fail(j?.error?.message || `PlayStation Network error ${r.status}`, { status: r.status });
    return j;
  }
  /** Cached value with its own lifetime; concurrent callers share one request; a stale value beats an error. */
  async function cached(key, ttlMs, fn) {
    const e = cache.get(key);
    if (e?.data !== undefined && Date.now() - e.at < ttlMs) return e.data;
    if (e?.p) return e.p;
    const p = fn().then((data) => { cache.set(key, { at: Date.now(), data }); return data; })
      .catch((err) => { if (e?.data !== undefined && !err.signin) { cache.set(key, { ...e, p: null }); return e.data; } cache.delete(key); throw err; });
    cache.set(key, { ...(e || {}), p });
    return p;
  }

  // ---------------------------------------------------------------- data
  const U = '/userProfile/v1/internal/users';
  const profile = () => cached('profile', 6 * 3600e3, async () => {
    const j = await api(`${U}/me/profiles`);
    if (j.onlineId && st.onlineId !== j.onlineId) { st.onlineId = j.onlineId; save(); status(); }
    return { onlineId: j.onlineId, avatar: bigAvatar(j.avatars), isPlus: !!j.isPlus, aboutMe: j.aboutMe || '', verified: !!j.isOfficiallyVerified };
  });
  const normPresence = (bp = {}) => {
    const pp = bp.primaryPlatformInfo || {};
    const g = (bp.gameTitleInfoList || [])[0];
    const online = (pp.onlineStatus || bp.onlineStatus) === 'online';
    return {
      online, availability: bp.availability || '', platform: platformName(pp.platform || bp.platform),
      lastOnline: pp.lastOnlineDate || bp.lastOnlineDate || bp.lastAvailableDate || null,
      game: g && online ? { titleId: g.npTitleId, name: g.titleName, icon: g.conceptIconUrl || g.npTitleIconUrl || '', platform: platformName(g.format || g.launchPlatform) } : null,
    };
  };
  const presence = () => cached('presence', 15000, async () => normPresence((await api(`${U}/me/basicPresences`, { type: 'primary' })).basicPresence));
  const trophySummary = () => cached('trophySummary', 10 * 60e3, async () => {
    const j = await api('/trophy/v1/users/me/trophySummary');
    return { level: +j.trophyLevel || 0, progress: +j.progress || 0, tier: +j.tier || 0, counts: { platinum: 0, gold: 0, silver: 0, bronze: 0, ...(j.earnedTrophies || {}) } };
  });
  const HERO_TYPES = ['GAMEHUB_COVER_ART', 'BACKGROUND_LAYER_ART', 'FOUR_BY_THREE_BANNER', 'SIXTEEN_BY_NINE_BANNER', 'MASTER'];
  const recent = () => cached('recent', 5 * 60e3, async () => {
    const j = await api('/gamelist/v2/users/me/titles', { categories: 'ps4_game,ps5_native_game', limit: 12, offset: 0 });
    return (j.titles || []).map((t) => {
      const imgs = t.concept?.media?.images || [];
      const hero = HERO_TYPES.map((k) => imgs.find((i) => i.type === k)?.url).find(Boolean) || '';
      return {
        titleId: t.titleId, name: t.localizedName || t.name, art: t.localizedImageUrl || t.imageUrl || '', hero,
        platform: platformName(t.category), playtimeMin: isoMinutes(t.playDuration), playCount: t.playCount || 0,
        lastPlayed: t.lastPlayedDateTime || null, titleIds: t.concept?.titleIds || [t.titleId],
      };
    });
  });
  // the trophy set of a game: by its title id (PPSA…/CUSA…) when playing, else your most recently updated set
  const trophyTitleFor = (titleId) => cached(`tt:${titleId}`, 2 * 60e3, async () => {
    const j = await api('/trophy/v1/users/me/titles/trophyTitles', { npTitleIds: titleId });
    return j.titles?.find((t) => t.npTitleId === titleId)?.trophyTitles?.[0] || j.titles?.[0]?.trophyTitles?.[0] || null;
  });
  const latestTrophyTitle = () => cached('ttLatest', 5 * 60e3, async () => (await api('/trophy/v1/users/me/trophyTitles', { limit: 3, offset: 0 })).trophyTitles?.[0] || null);
  async function gameTrophies(tt, current) {
    const id = encodeURIComponent(tt.npCommunicationId), svc = tt.npServiceName || 'trophy2';
    const [defs, mine] = await Promise.all([
      cached(`defs:${tt.npCommunicationId}`, 24 * 3600e3, () => api(`/trophy/v1/npCommunicationIds/${id}/trophyGroups/all/trophies`, { npServiceName: svc })),
      cached(`earned:${tt.npCommunicationId}`, current ? 60e3 : 5 * 60e3, () => api(`/trophy/v1/users/me/npCommunicationIds/${id}/trophyGroups/all/trophies`, { npServiceName: svc })),
    ]);
    const def = new Map((defs.trophies || []).map((t) => [t.trophyId, t]));
    const all = (mine.trophies || []).map((t) => ({ ...(def.get(t.trophyId) || {}), ...t }));
    const shape = (t) => ({ id: t.trophyId, name: t.trophyHidden && !t.earned ? 'Hidden trophy' : t.trophyName || 'Trophy', detail: t.trophyHidden && !t.earned ? '' : t.trophyDetail || '',
      type: t.trophyType, icon: t.trophyIconUrl || '', earnedAt: t.earnedDateTime || null, rate: t.trophyEarnedRate != null ? +t.trophyEarnedRate : null });
    const earned = all.filter((t) => t.earned).sort((a, b) => String(b.earnedDateTime).localeCompare(String(a.earnedDateTime)));
    const next = all.filter((t) => !t.earned && !t.trophyHidden).sort((a, b) => (+b.trophyEarnedRate || 0) - (+a.trophyEarnedRate || 0));
    return {
      npCommunicationId: tt.npCommunicationId, name: tt.trophyTitleName, icon: tt.trophyTitleIconUrl || '', platform: tt.trophyTitlePlatform || '',
      progress: +tt.progress || 0, current, earned: { platinum: 0, gold: 0, silver: 0, bronze: 0, ...(tt.earnedTrophies || {}) }, defined: { platinum: 0, gold: 0, silver: 0, bronze: 0, ...(tt.definedTrophies || {}) },
      recent: earned.slice(0, 8).map(shape), next: next.slice(0, 3).map(shape),
    };
  }
  async function bulkOrEach(ids, bulk, one, chunk = 50) {
    const out = [];
    for (let i = 0; i < ids.length; i += chunk) {
      const part = ids.slice(i, i + chunk);
      try { out.push(...await bulk(part)); }
      catch { for (const id of part.slice(0, 30)) { try { out.push(await one(id)); } catch {} } }
    }
    return out;
  }
  const friendProfiles = new Map();   // accountId → { at, onlineId, avatar }
  const friends = () => cached('friends', 60e3, async () => {
    const ids = (await api(`${U}/me/friends`, { limit: 200 })).friends || [];
    if (!ids.length) return { total: 0, online: [] };
    const pres = await bulkOrEach(ids,
      async (part) => ((await api(`${U}/basicPresences`, { type: 'primary', accountIds: part.join(',') })).basicPresences || []),
      async (id) => ({ accountId: id, ...(await api(`${U}/${id}/basicPresences`, { type: 'primary' })).basicPresence }));
    const online = pres.map((p) => ({ accountId: p.accountId, ...normPresence(p) })).filter((p) => p.online);
    const need = online.map((p) => p.accountId).filter((id) => !(friendProfiles.get(id)?.at > Date.now() - 12 * 3600e3));
    if (need.length) {
      const profs = await bulkOrEach(need,
        async (part) => ((await api(`${U}/profiles`, { accountIds: part.join(',') })).profiles || []).map((pr, i) => ({ accountId: pr.accountId || part[i], ...pr })),
        async (id) => ({ accountId: id, ...(await api(`${U}/${id}/profiles`)) }));
      for (const pr of profs) friendProfiles.set(pr.accountId, { at: Date.now(), onlineId: pr.onlineId, avatar: bigAvatar(pr.avatars) });
    }
    const list = online.map((p) => ({ ...p, onlineId: friendProfiles.get(p.accountId)?.onlineId || 'Friend', avatar: friendProfiles.get(p.accountId)?.avatar || '' }))
      .sort((a, b) => (b.game ? 1 : 0) - (a.game ? 1 : 0) || a.onlineId.localeCompare(b.onlineId));
    return { total: ids.length, online: list.slice(0, 40) };
  });

  async function summary() {
    if (!signedIn() && !c.npsso) return { signedIn: false, error: st.refreshToken ? 'The PlayStation sign-in expired — paste a new NPSSO token' : 'Not signed in to PlayStation Network yet' };
    const errors = {};
    const safe = (k, p) => p.catch((e) => { if (e.signin) throw e; errors[k] = e.message; return null; });
    try {
      const [prof, pres, troph, games, fr] = await Promise.all([
        safe('profile', profile()), safe('presence', presence()), safe('trophies', trophySummary()), safe('recent', recent()), safe('friends', friends())]);
      // the game being played now: name + art from presence, play time / hero art from the game list
      let now = pres?.game ? { ...pres.game } : null;
      if (now && games) {
        const g = games.find((x) => x.titleIds.includes(now.titleId) || x.titleId === now.titleId || x.name === now.name);
        if (g) Object.assign(now, { art: g.art || now.icon, hero: g.hero, playtimeMin: g.playtimeMin, playCount: g.playCount });
      }
      if (now) now.art ||= now.icon;
      let game = null;
      try {
        const tt = now ? await trophyTitleFor(now.titleId) : await latestTrophyTitle();
        if (tt) game = await gameTrophies(tt, !!now);
      } catch (e) { if (e.signin) throw e; errors.game = e.message; }
      return { signedIn: true, profile: prof, presence: pres, now, trophies: troph, game, recent: games, friends: fr, errors, at: Date.now() };
    } catch (e) {
      if (e.signin) return { signedIn: false, error: e.message };
      throw e;
    }
  }

  // ---------------------------------------------------------------- console power (playactor)
  const target = () => (pa.ip ? ['--ip', pa.ip] : pa.hostId ? ['--host-id', pa.hostId] : [pa.ps4 ? '--ps4' : '--ps5']);
  const run = (args, timeout = 20000) => new Promise((resolve) => {
    execFile(pa.bin, [...args, ...(pa.args || [])], { timeout, windowsHide: true, shell: process.platform === 'win32' }, (err, stdout = '', stderr = '') =>
      resolve({ ok: !err, code: err?.code, out: `${stdout}\n${stderr}` }));
  });
  let installed = null, installedAt = 0;
  async function hasPlayactor() {
    if (!pa) return false;
    if (installed !== null && Date.now() - installedAt < 10 * 60e3) return installed;
    const r = await run(['--help'], 8000);
    installed = r.ok || (/\bwake\b|\bstandby\b/i.test(r.out) && !/not recognized|not found|ENOENT/i.test(r.out) && r.code !== 'ENOENT' && r.code !== 127);
    installedAt = Date.now();
    return installed;
  }
  const consoleState = () => cached('console', 20000, async () => {
    if (!(await hasPlayactor())) return { available: false, via: null };
    const r = await run(['check', ...target()]);
    const state = /200\s*ok|\bawake\b/i.test(r.out) ? 'awake' : /620|standby/i.test(r.out) ? 'standby' : r.ok ? 'unknown' : 'unreachable';
    return { available: true, via: 'playactor', state };
  });

  const actions = {
    async status() { return { signedIn: signedIn(), onlineId: st.onlineId || '', playactor: pa ? await hasPlayactor() : false }; },
    async signin({ npsso }) {
      const v = parseNpsso(npsso);
      if (!/^[A-Za-z0-9]{40,100}$/.test(v)) throw new Error('That doesn’t look like an NPSSO token — it’s 64 letters and digits (copy just the value after "npsso":)');
      cache.clear(); st = {};
      await exchangeNpsso(v);
      const p = await profile().catch(() => null);
      status(); log('psn', `signed in${st.onlineId ? ` as ${st.onlineId}` : ''}`);
      return { ok: true, onlineId: p?.onlineId || st.onlineId || '' };
    },
    async signout() { st = {}; save(); cache.clear(); status(); return { ok: true }; },
    summary,
    async console(body, { req }) {
      if (req.method !== 'POST') return consoleState();
      const action = body.action;
      if (!['wake', 'standby'].includes(action)) throw new Error('action must be wake or standby');
      if (!(await hasPlayactor())) throw new Error('playactor isn’t installed on the bridge computer (npm i -g playactor)');
      const r = await run([action, ...target(), '--no-open-urls'], 45000);
      cache.delete('console');
      if (!r.ok) throw new Error(/credentials|login|auth/i.test(r.out) ? 'Pair playactor once on the bridge computer: playactor login --ps5' : `playactor ${action} failed: ${r.out.trim().split('\n').pop() || r.code}`);
      log('psn', `console ${action}`);
      return { ok: true };
    },
  };

  return { id: 'psn', actions, async start() { status(); }, stop() {} };
}
