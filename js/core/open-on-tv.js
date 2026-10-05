// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// "Open on TV": hand what's playing (or a movie / video you picked) to a TV — the best way each service has.
//
// The TVs: every way Round Remote reaches a TV, grouped by TV (one TV can be paired through the bridge, linked in
// "YouTube on your TV" and be a Cast / Spotify Connect device all at once — matched by name, or by address):
//   • Google TV / Android TV through the bridge (bridge/adapters/androidtv.js)          → open apps and app links
//   • Google TV through Home Assistant's Android TV Remote integration (js/core/tvapp.js) → open apps and app links
//   • Google TV with the "TV Remote" app on it (js/core/tvapp.js)                        → open apps (no links)
//   • Apple TV through the bridge (pyatv)                                                 → open apps (bundle id or link)
//   • YouTube on your TV (the YouTube app linked with a TV code, bridge)                  → play a video at a position
//   • Chromecast (bridge) — only joins a TV found another way (for its name)
// The first three work without a bridge (GitHub Pages: Home Assistant, the TV Remote app); the rest need one
// (a Pi, the Docker server, or a companion Pi that forwards /api to its server — all the same here).
//
// Per service (plan()):
//   Spotify            → transfer playback to the TV's Spotify Connect device (matched by name); else open Spotify on
//                        the TV and offer the transfer once the TV shows up in Spotify's device list
//   YouTube / YT Music → play the video on the TV: YouTube on your TV (with position), else the app link
//                        https://www.youtube.com/watch?v=ID&t=Ns (Google TV / Home Assistant / Apple TV); else open YouTube
//   Plex               → play on the TV's Plex app (Plex Companion, same as Movies & TV); else open Plex (+ offer)
//   Jellyfin           → play on the TV's Jellyfin session (Sessions API); else open Jellyfin (+ offer)
//   Netflix, Disney+, Prime Video, Apple TV+, Max: a title from the streaming library → its deep link (Netflix / Disney+ ids
//                        from Wikidata), else open the app and offer to type the title into its search (stream-library.js);
//                        what's playing → open the app
//   Apple Music, TIDAL, Qobuz, … → open the app (nothing to hand over: no public API)
//   anything else      → the matching app from the TV apps catalog (js/core/tv-apps.js), if there is one
import { store } from './store.js';
import { player } from './player.js';
import { qs, sleep } from './util.js';
import { directZones, directLaunch, haReady } from './tvapp.js';
import { catalogApp, catalogAppByName } from './tv-apps.js';
import { bridgeFetch, bridgeZones, mayProbe } from '../providers/bridge.js';

const fail = (m) => Object.assign(new Error(m), { userMessage: m });
const errText = (e) => e?.userMessage || e?.body?.error || e?.message || 'Something went wrong';
export const LAST_KEY = 'openOnTvLast';
// services that are a TV themselves (no "Open on TV" there)
const TV_SERVICES = new Set(['androidtv', 'appletv', 'castvideo']);
// Apple TV (tvOS) bundle ids for the catalog apps that have one
const APPLE_BUNDLES = {
  netflix: 'com.netflix.Netflix', disney: 'com.disney.disneyplus', youtube: 'com.google.ios.youtube', prime: 'com.amazon.aiv.AIVApp',
  appletv: 'com.apple.TVWatchList', applemusic: 'com.apple.TVMusic', spotify: 'com.spotify.client', plex: 'com.plexapp.plex',
  jellyfin: 'org.jellyfin.swiftfin', tidal: 'com.aspiro.TIDAL', max: 'com.wbd.stream', paramount: 'com.cbsvideo.app', twitch: 'tv.twitch',
};
// a service → its app in the TV catalog (when the ids differ)
const SVC_APP = { apple: 'applemusic', plexvideo: 'plex', jellyfinvideo: 'jellyfin', ytvideo: 'youtube', ytmusic: 'ytmusic', appletvplus: 'appletv' };

// ---------------------------------------------------------------- the TVs
export const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '').replace(/^the/, '');
/** Do two device names mean the same TV? ("Living Room TV" ↔ "Living room", "[TV] Samsung Q80" ↔ "Samsung Q80") */
export function sameName(a, b) {
  const x = norm(a).replace(/^tv|tv$/g, ''), y = norm(b).replace(/^tv|tv$/g, '');
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
}
const PATH_NAME = { androidtv: 'Google TV · bridge', ha: 'Google TV · Home Assistant', app: 'Google TV · TV Remote app', appletv: 'Apple TV', youtubetv: 'YouTube on TV', cast: 'Chromecast' };
const kindOf = (z) => (z.direct ? (z.via === 'ha' ? 'ha' : 'app') : z.adapter);

/** Group zones (bridge + direct) into TVs: [{ key, name, zones: { androidtv, ha, app, appletv, youtubetv, cast } }] */
export function groupTvs(zones) {
  const groups = [];
  const order = ['androidtv', 'ha', 'app', 'appletv', 'youtubetv'];
  const prim = zones.filter((z) => order.includes(kindOf(z))).sort((a, b) => order.indexOf(kindOf(a)) - order.indexOf(kindOf(b)));
  const find = (z) => groups.find((g) => Object.values(g.zones).some((o) => (o.localId && z.localId && o.localId === z.localId && o.adapter !== z.adapter) || sameName(o.name, z.name)));
  for (const z of prim) {
    const k = kindOf(z);
    const g = find(z);
    if (g && !g.zones[k]) g.zones[k] = z;
    else if (!g) groups.push({ key: norm(z.name) || z.id, name: z.name || 'TV', zones: { [k]: z } });
  }
  for (const z of zones.filter((x) => x.adapter === 'cast')) { const g = find(z); if (g && !g.zones.cast) g.zones.cast = z; }
  for (const g of groups) g.paths = Object.keys(g.zones).map((k) => PATH_NAME[k]);
  return groups;
}

let cache = null;   // { at, p }
/** The TVs Round Remote can reach right now (cached a few seconds). */
export function tvTargets({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 5000) return cache.p;
  const p = (async () => {
    if (haReady()) {   // Home Assistant's TVs appear once it's connected
      try {
        const ha = (await import('../providers/registry.js')).provider('homeassistant');
        if (ha.status !== 'ready') { await Promise.race([ha.connect(), sleep(4000)]); ha.release?.(); }
      } catch {}
    }
    const bridge = mayProbe() ? await Promise.race([bridgeZones((z) => ['androidtv', 'appletv', 'youtubetv', 'cast'].includes(z.adapter)), sleep(4000).then(() => [])]) : [];
    return groupTvs([...bridge, ...directZones()]);
  })();
  cache = { at: Date.now(), p };
  p.catch(() => { cache = null; });
  return p;
}
export function forgetTvCache() { cache = null; }

/** The TV used last (or the only one). */
export function lastTv(tvs) { const k = store.get(LAST_KEY); return tvs.find((g) => g.key === k) || (tvs.length === 1 ? tvs[0] : null); }
export function rememberTv(g) { if (g?.key) store.set(LAST_KEY, g.key); }

// ---------------------------------------------------------------- opening apps / links on a TV
const appleBundle = (app) => APPLE_BUNDLES[app?.id] || app?.bundle || '';
/** Can this TV open `app` (and an app link)? */
export function canOpen(g, app, { link = false } = {}) {
  const z = g.zones;
  if (link) return !!(z.androidtv || z.ha || z.appletv);
  return !!(z.androidtv || z.ha || (z.app && (app?.alias || app?.pkg)) || (z.appletv && appleBundle(app)));
}
/** Open an app (or one of its links) on the TV, whichever way reaches it. */
export async function openApp(g, app, link = '') {
  const z = g.zones;
  if (z.androidtv) return bridgeFetch('/api/adapters/androidtv/app', { method: 'POST', json: { id: z.androidtv.id, link: link || app?.link || '', pkg: app?.pkg || '' } });
  if (z.ha) return directLaunch(z.ha, link ? { ...(app || {}), link } : app);
  if (z.app && (app?.alias || app?.pkg)) return directLaunch(z.app, app);
  if (z.appletv) {
    const b = (link && /^https?:/.test(link) ? link : '') || appleBundle(app);
    if (b) return bridgeFetch('/api/adapters/appletv/app', { method: 'POST', json: { id: z.appletv.id, bundle: b } });
  }
  throw fail(`${g.name} can’t open ${app?.name || 'apps'}`);
}

// ---------------------------------------------------------------- what to hand over
async function svcMeta(id) { return (await import('../providers/registry.js')).getService(id); }
async function prov(id) { return (await import('../providers/registry.js')).provider(id); }

/** What's playing now, as a context for plan(). */
export function nowPlaying() {
  const p = player.provider;
  if (!p) return null;
  const t = player.state.track;
  return { svc: p.id, prov: p, track: t, media: t?.media || null, pos: player.position?.() || player.state.progressMs || 0, device: player.state.device || null };
}
/** A movie / show / video picked in Movies & TV. */
export function forEntry(provider, entry) { return { svc: provider.id, prov: provider, entry }; }

/** Is "Open on TV" worth showing for this service at all? (cheap, no network) */
export function supports(ctx) {
  if (!ctx?.svc || TV_SERVICES.has(ctx.svc)) return false;
  if (['spotify', 'youtube', 'ytmusic', 'ytvideo', 'plex', 'jellyfin', 'plexvideo', 'jellyfinvideo', 'apple', 'tidal', 'qobuz', 'netflix', 'disney', 'prime', 'appletvplus', 'max'].includes(ctx.svc)) return true;
  return !!catalogApp(ctx.svc) || !!ctx.track && !!catalogAppByName(ctx.prov?.zone?.sourceApp || '');
}
const ytId = (s) => (/^[\w-]{11}$/.test(String(s || '')) ? String(s) : '');

/**
 * Make a planner for one context: plan(tv) → { label, how, run(ui) } | null.
 * Device lists (Spotify, Plex, Jellyfin) are fetched once per planner.
 */
export function planner(ctx) {
  const once = new Map();
  const memo = (k, fn) => { if (!once.has(k)) once.set(k, fn().catch(() => null)); return once.get(k); };
  const names = (g) => Object.values(g.zones).map((z) => z.name).concat(g.name);
  const matchDev = (list, g) => (list || []).find((d) => names(g).some((n) => sameName(d.name, n))) || null;

  // ---- open an app, maybe followed by an offer to hand playback over once the TV's app is up
  const openPlan = (g, app, { wait = null } = {}) => {
    if (!app || !canOpen(g, app)) return null;
    return {
      tv: g, verb: 'open', label: `Open ${app.name} on ${g.name}`, how: 'opens the app',
      async run(ui) {
        await openApp(g, app);
        if (wait) waitAndOffer(g, wait, ui).catch(() => {});
        return `Opening ${app.name} on ${g.name}`;
      },
    };
  };

  async function plan(g) {
    if (!g || !supports(ctx)) return null;
    const svc = ctx.svc;
    // Netflix / Disney+ / YouTube in Movies & TV follow an app on a TV: nothing to open on that same TV
    const here = !!ctx.prov?.zone && Object.values(g.zones).some((z) => z.id === ctx.prov.zone.id);
    if (here && !ctx.entry && ['netflix', 'disney', 'prime', 'appletvplus', 'max', 'ytvideo'].includes(svc)) return null;
    // a title from the streaming library (js/core/stream-library.js): its deep link, else open the app + type the title
    if (ctx.entry?.tmdb) return (await import('./stream-library.js')).titlePlan(g, ctx.entry, { canOpen, openApp });
    const meta = await svcMeta(svc);
    const app = catalogApp(SVC_APP[svc] || svc) || catalogAppByName(meta?.name) || (ctx.prov?.zone?.sourceApp ? catalogAppByName(ctx.prov.zone.sourceApp) : null);

    // ---------- Spotify: Spotify Connect
    if (svc === 'spotify') {
      const sp = await prov('spotify');
      if (!sp?.isAuthed?.()) return openPlan(g, app);
      const devs = await memo('sp', () => sp.getDevices());
      const d = matchDev(devs, g);
      if (d) {
        if (d.active) return null;   // already playing there
        return {
          tv: g, verb: 'play', label: `Play on ${g.name}`, how: 'Spotify Connect',
          async run() {
            await sp.api('me/player', { method: 'PUT', json: { device_ids: [d.id], play: true } });
            store.setZone('spotify', d.id);
            setTimeout(() => sp.refresh?.().catch?.(() => {}), 900);
            return `Playing on ${g.name}`;
          },
        };
      }
      return openPlan(g, app, { wait: { what: 'Spotify', find: async () => matchDev(await sp.getDevices().catch(() => []), g), go: (dd) => sp.api('me/player', { method: 'PUT', json: { device_ids: [dd.id], play: true } }).then(() => store.setZone('spotify', dd.id)) } });
    }

    // ---------- YouTube / YouTube Music: the video, at the same spot
    if (['youtube', 'ytmusic', 'ytvideo'].includes(svc)) {
      const id = ytId(ctx.entry ? ctx.entry.itemId || ctx.entry.id : ctx.track?.id);
      const yt = catalogApp('youtube');
      if (!id) return openPlan(g, svc === 'ytmusic' ? app : yt);
      const sec = ctx.entry ? 0 : Math.floor((ctx.pos || 0) / 1000);
      const title = ctx.entry?.title || ctx.track?.title || 'the video';
      const pauseHere = () => { if (!ctx.entry && player.provider === ctx.prov && ctx.prov?.state?.device?.id === 'local' && player.state.isPlaying) player.pause()?.catch?.(() => {}); };
      if (g.zones.youtubetv) {
        if (ctx.prov?.zone?.id === g.zones.youtubetv.id && ctx.track?.id === id) return null;   // it's on that TV already
        return {
          tv: g, verb: 'play', label: `Play on ${g.name}`, how: 'YouTube on your TV',
          async run() {
            await bridgeFetch(`/api/zones/${encodeURIComponent(g.zones.youtubetv.id)}/play`, { method: 'POST', json: { item: { id, kind: 'track', startMs: sec * 1000 } } });
            pauseHere();
            return `Playing “${title}” on ${g.name}`;
          },
        };
      }
      const link = `https://www.youtube.com/watch?v=${id}${sec > 5 ? `&t=${sec}s` : ''}`;
      if (canOpen(g, yt, { link: true })) {
        return {
          tv: g, verb: 'play', label: `Play on ${g.name}`, how: 'YouTube app link',
          async run() { await openApp(g, yt, link); pauseHere(); return `Playing “${title}” on ${g.name}`; },
        };
      }
      return openPlan(g, yt);
    }

    // ---------- Plex (music and Movies & TV): Plex Companion to the TV's Plex app
    if (['plex', 'plexvideo'].includes(svc)) {
      const px = ctx.prov;
      if (!px?.isAuthed?.()) return openPlan(g, app);
      const devs = await memo('px', () => px.getDevices());
      const d = matchDev(devs, g);
      const item = ctx.entry || (ctx.media?.itemId ? { id: ctx.media.itemId, type: ctx.media.type, viewOffset: ctx.pos } : ctx.track?.id ? { id: ctx.track.id, type: 'track' } : null);
      if (!item) return openPlan(g, app);
      const send = async (dd) => {
        await px.selectDevice(dd);
        if (item.type === 'track') await px._playQueue({ uri: `server://${px.server.id}/com.plexapp.plugins.library/library/metadata/${item.id}` }, ctx.pos || 0);
        else await px.playMedia(item, { fromStart: false });
      };
      if (d) {
        if (!ctx.entry && ctx.device && sameName(ctx.device.name, d.name)) return null;   // it's playing there already
        return { tv: g, verb: 'play', label: `Play on ${g.name}`, how: `Plex · ${d.name}`, async run() { await send(d); return `Playing on ${g.name}`; } };
      }
      return openPlan(g, app, { wait: { what: 'Plex', find: async () => matchDev(await px.getDevices().catch(() => []), g), go: send } });
    }

    // ---------- Jellyfin (music and Movies & TV): the Sessions API
    if (['jellyfin', 'jellyfinvideo'].includes(svc)) {
      const jf = ctx.prov;
      if (!jf?.isAuthed?.()) return openPlan(g, app);
      const devs = await memo('jf', () => jf.getDevices());
      const d = matchDev(devs, g);
      const item = ctx.entry || (ctx.media?.itemId ? { id: ctx.media.itemId, type: ctx.media.type, viewOffset: ctx.pos } : ctx.track?.id ? { id: ctx.track.id, type: 'track' } : null);
      if (!item) return openPlan(g, app);
      const send = async (dd) => {
        await jf.selectDevice(dd);
        if (item.type === 'track' || !jf.playMedia) {
          await jf.api(`/Sessions/${dd.id}/Playing?${qs({ playCommand: 'PlayNow', itemIds: item.id, startPositionTicks: ctx.pos ? Math.round(ctx.pos * 10000) : undefined })}`, { method: 'POST' });
        } else await jf.playMedia(item, { fromStart: false });
      };
      if (d) {
        if (!ctx.entry && ctx.device && ctx.device.id === d.id) return null;
        return { tv: g, verb: 'play', label: `Play on ${g.name}`, how: `Jellyfin · ${d.name}`, async run() { await send(d); return `Playing on ${g.name}`; } };
      }
      return openPlan(g, app, { wait: { what: 'Jellyfin', find: async () => matchDev(await jf.getDevices().catch(() => []), g), go: send } });
    }

    // ---------- the rest: open the app
    return openPlan(g, app);
  }
  return plan;
}

/** After opening an app on the TV: watch for the TV to show up in the service's device list, then offer the hand-over. */
async function waitAndOffer(g, wait, ui) {
  const until = Date.now() + 30000;
  await sleep(2500);
  while (Date.now() < until) {
    const d = await wait.find().catch(() => null);
    if (d) {
      ui?.offer?.({
        text: `${wait.what} is open on ${g.name}.`, action: `Play on ${g.name}`,
        run: async () => { await wait.go(d); return `Playing on ${g.name}`; },
      });
      return true;
    }
    await sleep(2500);
  }
  ui?.note?.(`${g.name} didn’t show up in ${wait.what} yet — pick it in Devices once it does`);
  return false;
}

/** Is there a TV this context can go to? (for buttons that must decide quickly whether to show) */
export async function anyPlan(ctx) {
  if (!supports(ctx)) return false;
  const tvs = await tvTargets().catch(() => []);
  const plan = planner(ctx);
  for (const g of tvs) if (await plan(g).catch(() => null)) return true;
  return false;
}

/** Run a plan, with the UI's helpers; resolves to the message to show (or throws with userMessage). */
export async function runPlan(p, ui) {
  if (!p) throw fail('Nothing to open on the TV');
  rememberTv(p.tv);
  try { return await p.run(ui); } catch (e) { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { userMessage: errText(e) }); }
}
