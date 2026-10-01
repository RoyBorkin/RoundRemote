// Google TV / Android TV without the bridge.
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

/** Direct TVs dressed as bridge zones, so every screen treats them like a paired Google TV. */
export function directZones() {
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
  const code = typeof key === 'number' ? key : KEYCODES[key];
  if (code == null) return Promise.reject(Object.assign(new Error('Unknown key'), { userMessage: `The TV can’t do “${key}”` }));
  return post(tvOf(zone), `/api/key/${code}`);
}
/** Open an app: a name the TV Remote app knows (youtube, netflix…), a package name, or 'home'. */
export function directLaunch(zone, app) {
  const name = APP_ALIASES[app] || app;
  return post(tvOf(zone), `/api/launch/${encodeURIComponent(name)}`);
}
export function directAssistant(zone) { return post(tvOf(zone), '/api/assistant'); }

// Typing: /api/text wants a JSON body (which a no-cors request can't send), so type with key presses.
const CHAR_KEYS = { ' ': 62, '.': 56, ',': 55, '-': 69, '=': 70, '/': 76, '@': 77, "'": 75, ';': 74, '[': 71, ']': 72, '\\': 73, '`': 68, '+': 81, '#': 18, '*': 17, '\n': 66 };
export function charKey(ch) {
  const c = ch.toLowerCase();
  if (c >= 'a' && c <= 'z') return 29 + c.charCodeAt(0) - 97;
  if (c >= '0' && c <= '9') return 7 + c.charCodeAt(0) - 48;
  return CHAR_KEYS[c] ?? null;
}
export async function directType(zone, text) {
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
