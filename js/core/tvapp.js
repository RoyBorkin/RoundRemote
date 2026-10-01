// Google TV / Android TV without the bridge. Two ways:
//
// 1. Home Assistant — its built-in "Android TV Remote" integration pairs with the TV (code on the TV, the
//    same protocol as the Google TV phone app). Round Remote already talks to Home Assistant directly,
//    so it sends keys / text / app links through HA's remote.* actions. Nothing to install on the TV.
//
// 2. The "TV Remote" app on the TV (below).
//
// A web page can't speak the TV's own remote protocol (TLS on port 6466/6467) or ADB — browsers
// don't open raw sockets. What a page *can* do is call a small web server running on the TV
// itself. The free "TV Remote" app (Legvan/tv-remote, package com.porter.tvremote, on Google Play)
// is exactly that: it runs on the TV, listens on http://<tv>:8080 and turns
//   POST /api/key/<keycode>   POST /api/launch/<app|package>   POST /api/assistant
// into key presses through the TV's own "Network debugging" (no root, no computer).
//
// It doesn't send CORS headers, so this page can't read its replies — but plain POSTs with no
// body go through fine as "no-cors" requests. So: keys, apps and typing work; "what's playing"
// still needs the bridge (or Chromecast / Plex / Jellyfin for the video itself).
import { store } from './store.js';
import { lanOpts } from './util.js';

export const TV_APP_PORT = 8080;
export const TV_APP_URL = 'https://play.google.com/store/apps/details?id=com.porter.tvremote';
// not in every TV's Play Store: the same app from its GitHub release, for Downloader / Send files to TV
export const TV_APP_APK = 'https://github.com/Legvan/tv-remote/releases/download/v1.6/tv-remote-v1.6.apk';

// Android key codes (KeyEvent.KEYCODE_*) for the remote's key names (same names the bridge uses)
export const KEYCODES = {
  up: 19, down: 20, left: 21, right: 22, ok: 23, back: 4, home: 3, menu: 82,
  power: 26, mute: 164, volup: 24, voldown: 25,
  playpause: 85, play: 126, pause: 127, stop: 86, next: 87, prev: 88, rewind: 89, forward: 90,
  settings: 176, input: 178, guide: 172, captions: 175, search: 84, enter: 66, del: 67,
};

// Apps the TV Remote app knows by name, plus a few common ones by package name
export const DIRECT_APPS = [
  { id: 'youtube', name: 'YouTube' },
  { id: 'netflix', name: 'Netflix' },
  { id: 'disney', name: 'Disney+' },
  { id: 'prime', name: 'Prime Video' },
  { id: 'spotify', name: 'Spotify' },
  { id: 'com.google.android.youtube.tvmusic', name: 'YouTube Music' },
  { id: 'com.plexapp.android', name: 'Plex' },
  { id: 'org.jellyfin.androidtv', name: 'Jellyfin' },
  { id: 'org.xbmc.kodi', name: 'Kodi' },
  { id: 'com.apple.atve.androidtv.appletv', name: 'Apple TV' },
  { id: 'settings', name: 'Settings' },
];
// what the streaming tiles ask for → the TV Remote app's names
const APP_ALIASES = { ytvideo: 'youtube', ytmusic: 'com.google.android.youtube.tvmusic', plex: 'com.plexapp.android', jellyfin: 'org.jellyfin.androidtv' };
// Home Assistant opens apps with app links (launching by package name doesn't work for most apps there)
export const HA_APPS = [
  { id: 'youtube', name: 'YouTube', link: 'https://www.youtube.com' },
  { id: 'ytmusic', name: 'YouTube Music', link: 'https://music.youtube.com' },
  { id: 'netflix', name: 'Netflix', link: 'https://www.netflix.com/title' },
  { id: 'disney', name: 'Disney+', link: 'https://www.disneyplus.com' },
  { id: 'prime', name: 'Prime Video', link: 'https://app.primevideo.com' },
  { id: 'spotify', name: 'Spotify', link: 'spotify://' },
  { id: 'plex', name: 'Plex', link: 'plex://' },
  { id: 'twitch', name: 'Twitch', link: 'twitch://home' },
];
/** A link or app id → the TV Remote app's app name (it can only open apps, not links). */
function appName(app) {
  if (!String(app).includes('://')) return APP_ALIASES[app] || app;
  const l = String(app).toLowerCase();
  if (/music\.youtube/.test(l)) return APP_ALIASES.ytmusic;
  for (const k of ['youtube', 'netflix', 'disney', 'spotify', 'plex']) if (l.includes(k)) return APP_ALIASES[k] || k;
  if (/prime|amazon/.test(l)) return 'prime';
  return app;
}
const haLink = (app) => (String(app).includes('://') ? app : HA_APPS.find((a) => a.id === (app === 'ytvideo' ? 'youtube' : app))?.link || null);

// ---------------------------------------------------------------- Home Assistant
let ha = null;
import('../providers/registry.js').then((m) => { ha = m.provider('homeassistant'); }).catch(() => {});
export const haReady = () => !!ha && ha.isAuthed?.() && !ha.setupHint?.();
const KEYNAMES = {
  up: 'DPAD_UP', down: 'DPAD_DOWN', left: 'DPAD_LEFT', right: 'DPAD_RIGHT', ok: 'DPAD_CENTER', back: 'BACK', home: 'HOME', menu: 'MENU',
  power: 'POWER', mute: 'VOLUME_MUTE', volup: 'VOLUME_UP', voldown: 'VOLUME_DOWN',
  playpause: 'MEDIA_PLAY_PAUSE', play: 'MEDIA_PLAY', pause: 'MEDIA_PAUSE', stop: 'MEDIA_STOP', next: 'MEDIA_NEXT', prev: 'MEDIA_PREVIOUS',
  rewind: 'MEDIA_REWIND', forward: 'MEDIA_FAST_FORWARD', settings: 'SETTINGS', input: 'TV_INPUT', guide: 'GUIDE', captions: 'CAPTIONS',
  search: 'SEARCH', enter: 'ENTER', del: 'DEL',
};
/** Google TVs paired in Home Assistant (Android TV Remote integration), as zones. Empty until HA is connected. */
export function haTvZones() {
  if (!haReady() || ha.status !== 'ready') return [];
  const remotes = ha.entitiesOf('androidtv_remote').filter((e) => e.startsWith('remote.') && ha.entity(e));
  return remotes.map((rid) => {
    const r = ha.entity(rid);
    const obj = rid.slice(7), dev = ha.deviceOf.get(rid);
    const mpId = ha.entitiesOf('androidtv_remote').find((e) => e.startsWith('media_player.') && ((dev && ha.deviceOf.get(e) === dev) || e.slice(13) === obj));
    const mp = mpId ? ha.entity(mpId) : null;
    const on = r.state === 'on';
    const app = mp?.attributes?.app_name || r.attributes?.current_activity || '';
    const vol = mp?.attributes?.volume_level;
    return {
      id: `ha:${rid}`, name: r.attributes?.friendly_name || obj, adapter: 'androidtv', direct: true, via: 'ha', remoteId: rid, mpId,
      caps: { remote: true, next: true, prev: true, stop: true, playlists: true, volume: !!mp && vol != null, seek: false, search: false },
      sourceApp: on ? app : '', unavailable: r.state === 'unavailable',
      state: { isPlaying: mp?.state === 'playing', track: on && app ? { title: app, artist: '', notSong: true } : null, volume: vol != null ? Math.round(vol * 100) : null, muted: !!mp?.attributes?.is_volume_muted },
    };
  });
}
/** Connect to Home Assistant (if set up) and call back whenever its TVs change. Returns an unsubscribe function. */
export function watchHaTvs(cb) {
  if (!haReady()) return null;
  const off = ha.on('change', (id) => { if (!id || ha.platformOf.get(id) === 'androidtv_remote') cb(); });
  const offS = ha.on('status', (s) => { if (s === 'ready') cb(); });
  const ready = ha.connect().then(cb).catch(() => {});
  const stop = () => { off?.(); offS?.(); ha.release?.(); };
  stop.ready = ready;
  return stop;
}
const haErr = (e) => Object.assign(new Error(e?.message || 'Home Assistant error'), { userMessage: `Home Assistant: ${e?.userMessage || e?.message || 'didn’t take the command'}` });
async function haKey(z, name) {
  try { await ha.call('remote', 'send_command', z.remoteId, { command: name }); } catch (e) { throw haErr(e); }
}


/** TVs added for direct control: [{ host, port, name }] */
export function directTvs() { return (store.get('tvDirect') || []).filter((t) => t?.host); }
export function directId(t) { return `direct:${t.host}:${t.port || TV_APP_PORT}`; }
export function saveDirectTv(t) {
  const host = String(t.host || '').trim().replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
  const port = Number(t.port) || TV_APP_PORT;
  const list = directTvs().filter((x) => !(x.host === host && (x.port || TV_APP_PORT) === port));
  const tv = { host, port, name: (t.name || '').trim() || `TV ${host}` };
  store.set('tvDirect', [...list, tv]);
  return tv;
}
export function forgetDirectTv(id) { store.set('tvDirect', directTvs().filter((t) => directId(t) !== id)); }

/** Direct TVs (TV Remote app + Home Assistant) dressed as bridge zones, so every screen treats them like a paired Google TV. */
export function directZones() { return [...appZones(), ...haTvZones()]; }
function appZones() {
  return directTvs().map((t) => ({
    id: directId(t), localId: t.host, name: t.name, adapter: 'androidtv', direct: true, tv: t,
    caps: { remote: true, next: true, prev: true, stop: true, playlists: true, volume: false, seek: false, search: false },
    state: { isPlaying: false, track: null, volume: null },
  }));
}

const base = (t) => `http://${t.host}:${t.port || TV_APP_PORT}`;

/** Fire-and-forget POST. Resolves when the TV app took the request; rejects if it can't be reached. */
async function post(t, path, timeout = 4000) {
  const url = base(t) + path;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    await fetch(url, { method: 'POST', mode: 'no-cors', cache: 'no-store', signal: ctrl.signal, ...lanOpts(url) });
  } catch (e) {
    throw Object.assign(new Error('TV not reachable'), {
      cause: e,
      userMessage: e.name === 'AbortError'
        ? `${t.name} didn’t answer — is the TV on and the TV Remote app’s server started?`
        : `Can’t reach ${t.name} at ${t.host}:${t.port || TV_APP_PORT}. Check the address, that the TV Remote app is running, and allow “local network access” if the browser asks.`,
    });
  } finally { clearTimeout(timer); }
}

const tvOf = (zoneOrTv) => zoneOrTv?.tv || zoneOrTv;

export function directKey(zone, key) {
  if (zone?.via === 'ha') {
    if (key === 'mute' && zone.mpId) return ha.call('media_player', 'volume_mute', zone.mpId, { is_volume_muted: !zone.state?.muted }).catch((e) => { throw haErr(e); });
    const name = typeof key === 'number' ? key : KEYNAMES[key];
    if (name == null) return Promise.reject(Object.assign(new Error('Unknown key'), { userMessage: `The TV can’t do “${key}”` }));
    return haKey(zone, name);
  }
  const code = typeof key === 'number' ? key : KEYCODES[key];
  if (code == null) return Promise.reject(Object.assign(new Error('Unknown key'), { userMessage: `The TV can’t do “${key}”` }));
  return post(tvOf(zone), `/api/key/${code}`);
}
/** Open an app: a name the TV Remote app knows (youtube, netflix…), a package name, or 'home'. */
export function directLaunch(zone, app) {
  if (zone?.via === 'ha') {
    const link = haLink(app);
    if (!link) return Promise.reject(Object.assign(new Error('No link'), { userMessage: 'Home Assistant can only open apps it has a link for' }));
    return ha.call('remote', 'turn_on', zone.remoteId, { activity: link }).catch((e) => { throw haErr(e); });
  }
  return post(tvOf(zone), `/api/launch/${encodeURIComponent(appName(app))}`);
}
export async function directAssistant(zone) {
  if (zone?.via === 'ha') { try { return await haKey(zone, 'ASSIST'); } catch { return haKey(zone, 'SEARCH'); } }
  return post(tvOf(zone), '/api/assistant');
}
/** Volume 0–100 (Home Assistant only — the TV Remote app has just up / down). */
export function directVolume(zone, v) {
  if (zone?.via !== 'ha' || !zone.mpId) return Promise.reject(Object.assign(new Error('no volume'), { userMessage: 'Use the volume keys on the remote' }));
  return ha.call('media_player', 'volume_set', zone.mpId, { volume_level: Math.max(0, Math.min(1, v / 100)) }).catch((e) => { throw haErr(e); });
}
/** Apps for the launcher. */
export const directApps = (zone) => (zone?.via === 'ha' ? HA_APPS : DIRECT_APPS);

// Typing: /api/text wants a JSON body (which a no-cors request can't send), so type with key presses.
const CHAR_KEYS = { ' ': 62, '.': 56, ',': 55, '-': 69, '=': 70, '/': 76, '@': 77, "'": 75, ';': 74, '[': 71, ']': 72, '\\': 73, '`': 68, '+': 81, '#': 18, '*': 17, '\n': 66 };
export function charKey(ch) {
  const c = ch.toLowerCase();
  if (c >= 'a' && c <= 'z') return 29 + c.charCodeAt(0) - 97;
  if (c >= '0' && c <= '9') return 7 + c.charCodeAt(0) - 48;
  return CHAR_KEYS[c] ?? null;
}
export async function directType(zone, text) {
  if (zone?.via === 'ha') {   // needs "Enable IME" in the integration's options
    await haKey(zone, `text:${text}`);
    return { skipped: 0 };
  }
  const t = tvOf(zone);
  let skipped = 0;
  for (const ch of String(text)) {
    const code = charKey(ch);
    if (code == null) { skipped++; continue; }
    await post(t, `/api/key/${code}`);
  }
  return { skipped };
}

/** Is the TV Remote app's server answering at this address? (true / false — its replies can't be read) */
export async function pingDirect(t, timeout = 3000) {
  const url = `${base(t)}/api/adb`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try { await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal, ...lanOpts(url) }); return true; }
  catch { return false; }
  finally { clearTimeout(timer); }
}
