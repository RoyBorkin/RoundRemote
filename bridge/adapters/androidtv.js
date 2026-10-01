// Google TV / Android TV through the Android TV Remote protocol (v2) — the protocol Google's own
// "Google TV" phone remote uses: TLS on ports 6466/6467, paired once with a code shown on the TV.
// Uses the androidtv-remote package (https://github.com/louis49/androidtv-remote, also used by
// Home Assistant); install it with `npm run androidtv` in bridge/ (a fresh `npm install` includes it).
//
// Gives the TV's own volume + mute, power, media keys (play/pause, next, previous), D-pad / OK / Back /
// Home, and launching apps (YouTube, YouTube Music, Netflix, Spotify…). The protocol reports which app is
// open but not the song or video, so for now-playing on YouTube use "YouTube on your TV" alongside it.
//
// Zones: androidtv:<host>. Paired TVs (with their client certificate) are kept in bridge/androidtv.json.
// Actions: GET  /api/adapters/androidtv/discover          → TVs found on the network (mDNS)
//          POST /api/adapters/androidtv/pair   {host,name} → starts pairing; the TV shows a code
//          POST /api/adapters/androidtv/code   {host,code} → finishes pairing
//          GET  /api/adapters/androidtv/list               → paired TVs
//          POST /api/adapters/androidtv/unpair {host}
//          POST /api/adapters/androidtv/key    {id,key}    → up/down/left/right/ok/back/home/power/mute/…
//          POST /api/adapters/androidtv/app    {id,link}   → open an app by its link
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { log } from '../lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(__dirname, '..', 'androidtv.json');
const require = createRequire(import.meta.url);

// Android KeyEvent codes (the Remote protocol uses the same numbers) — fallbacks if the library's enum differs
const KEYS = {
  playpause: ['KEYCODE_MEDIA_PLAY_PAUSE', 85], play: ['KEYCODE_MEDIA_PLAY', 126], pause: ['KEYCODE_MEDIA_PAUSE', 127],
  next: ['KEYCODE_MEDIA_NEXT', 87], prev: ['KEYCODE_MEDIA_PREVIOUS', 88], rewind: ['KEYCODE_MEDIA_REWIND', 89], forward: ['KEYCODE_MEDIA_FAST_FORWARD', 90], stop: ['KEYCODE_MEDIA_STOP', 86],
  up: ['KEYCODE_DPAD_UP', 19], down: ['KEYCODE_DPAD_DOWN', 20], left: ['KEYCODE_DPAD_LEFT', 21], right: ['KEYCODE_DPAD_RIGHT', 22], ok: ['KEYCODE_DPAD_CENTER', 23],
  back: ['KEYCODE_BACK', 4], home: ['KEYCODE_HOME', 3], power: ['KEYCODE_POWER', 26], mute: ['KEYCODE_VOLUME_MUTE', 164],
  volup: ['KEYCODE_VOLUME_UP', 24], voldown: ['KEYCODE_VOLUME_DOWN', 25], menu: ['KEYCODE_MENU', 82], settings: ['KEYCODE_SETTINGS', 176],
  input: ['KEYCODE_TV_INPUT', 178], guide: ['KEYCODE_GUIDE', 172], captions: ['KEYCODE_CAPTIONS', 175],
};
// Apps the round screen can open (the links Google TV understands)
export const TV_APPS = [
  { id: 'youtube', name: 'YouTube', link: 'https://www.youtube.com' },
  { id: 'ytmusic', name: 'YouTube Music', link: 'https://music.youtube.com' },
  { id: 'spotify', name: 'Spotify', link: 'spotify://' },
  { id: 'netflix', name: 'Netflix', link: 'https://www.netflix.com/title' },
  { id: 'prime', name: 'Prime Video', link: 'https://app.primevideo.com' },
  { id: 'disney', name: 'Disney+', link: 'https://www.disneyplus.com' },
  { id: 'plex', name: 'Plex', link: 'plex://' },
  { id: 'twitch', name: 'Twitch', link: 'twitch://home' },
];
const APP_NAMES = [
  [/youtube\.tvmusic|youtube\.music/i, 'YouTube Music'], [/youtube/i, 'YouTube'], [/netflix/i, 'Netflix'], [/spotify/i, 'Spotify'],
  [/amazonvideo|primevideo/i, 'Prime Video'], [/disney/i, 'Disney+'], [/plexapp|plex/i, 'Plex'], [/twitch/i, 'Twitch'], [/appletv|apple\.atve/i, 'Apple TV'],
  [/tidal/i, 'TIDAL'], [/deezer/i, 'Deezer'], [/kodi/i, 'Kodi'], [/hbo|max/i, 'Max'], [/launcher|tvlauncher|leanbacklauncher/i, 'Home screen'],
  [/tv\.settings|android\.settings/i, 'Settings'], [/tunerframework|tv\.tuner|livetv/i, 'Live TV'],
];
export const appName = (pkg = '') => { for (const [re, n] of APP_NAMES) if (re.test(pkg)) return n; return pkg ? pkg.split('.').filter((x) => !/^(com|tv|android|app|google)$/.test(x)).pop() || pkg : ''; };

function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { tvs: [] }; } }
function saveState(s) { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); } catch (e) { log('androidtv', `could not save ${STATE}: ${e.message}`); } }

export function create({ hub, cfg = {}, setStatus }) {
  const c = { module: 'androidtv-remote', ...(cfg.androidtv || {}) }; // module: override for tests
  let lib = null;
  const state = loadState();
  const tvs = new Map(); // host → { host, name, remote, powered, volume:{level,maximum,muted}, app, ready }
  const pairing = new Map(); // host → { remote, secretSeen, done: Promise }
  let stopped = false;

  const keyOf = (name) => {
    const [enumName, code] = KEYS[name] || [];
    return lib?.RemoteKeyCode?.[enumName] ?? code;
  };
  const status = () => setStatus(state.tvs.length ? `running · ${state.tvs.length} TV${state.tvs.length > 1 ? 's' : ''}` : 'running · no TV paired yet');
  const SHORT = () => lib?.RemoteDirection?.SHORT ?? 3;

  function publish(tv) {
    const v = tv.volume;
    const app = appName(tv.app);
    hub.upsert('androidtv', tv.host, {
      name: tv.name, sourceApp: app || 'Google TV',
      state: {
        track: tv.powered === false ? null : { id: tv.app || 'tv', title: app || 'Google TV', artist: tv.name, album: tv.ready ? 'Google TV remote' : 'Connecting…', art: '', durationMs: 0, notSong: true },
        isPlaying: tv.powered !== false && !!tv.ready,
        progressMs: 0,
        volume: v && v.maximum ? Math.round((v.level / v.maximum) * 100) : null,
        muted: !!v?.muted,
      },
      caps: { seek: false, volume: !!v?.maximum, next: true, prev: true, playlists: true, search: false, shuffle: false, repeat: false, remote: true },
    });
  }

  function connect(entry) {
    const { AndroidRemote } = lib;
    const tv = { host: entry.host, name: entry.name || `TV ${entry.host}`, powered: null, volume: null, app: '', ready: false };
    const remote = new AndroidRemote(entry.host, { pairing_port: 6467, remote_port: 6466, name: 'Round Remote', service_name: 'Round Remote', cert: entry.cert });
    tv.remote = remote;
    tvs.set(entry.host, tv);
    remote.on('powered', (p) => { tv.powered = !!p; publish(tv); });
    remote.on('volume', (v) => { tv.volume = v; publish(tv); });
    remote.on('current_app', (a) => { tv.app = String(a || ''); publish(tv); });
    remote.on('ready', () => { tv.ready = true; publish(tv); log('androidtv', `${tv.name} connected`); });
    remote.on('unpaired', () => { tv.ready = false; publish(tv); log('androidtv', `${tv.name} forgot this bridge — pair it again`); });
    remote.on('error', (e) => log('androidtv', `${tv.name}: ${e?.message || e}`));
    publish(tv);
    remote.start().catch((e) => { log('androidtv', `${tv.name}: ${e.message}`); if (!stopped) setTimeout(() => { if (tvs.get(entry.host) === tv) { try { remote.stop(); } catch {} connect(entry); } }, 15000); });
  }

  // ---------- discovery (mDNS: _androidtvremote2._tcp) ----------
  function discover(ms = 2500) {
    return new Promise((resolve) => {
      let mdns;
      try { mdns = require('multicast-dns')(); } catch { resolve([]); return; }
      const found = new Map(); // instance → { name, host }
      const ips = new Map();   // target hostname → ip
      mdns.on('response', (r) => {
        for (const a of [...r.answers, ...r.additionals]) {
          if (a.type === 'PTR' && a.name === '_androidtvremote2._tcp.local') found.set(a.data, found.get(a.data) || { name: a.data.replace(/\._androidtvremote2\._tcp\.local$/, '') });
          if (a.type === 'SRV' && a.name.endsWith('._androidtvremote2._tcp.local')) { const f = found.get(a.name) || { name: a.name.replace(/\._androidtvremote2\._tcp\.local$/, '') }; f.target = a.data.target; found.set(a.name, f); }
          if (a.type === 'A') ips.set(a.name, a.data);
        }
      });
      mdns.query({ questions: [{ name: '_androidtvremote2._tcp.local', type: 'PTR' }] });
      setTimeout(() => {
        try { mdns.destroy(); } catch {}
        resolve([...found.values()].map((f) => ({ name: f.name, host: ips.get(f.target) || null })).filter((f) => f.host));
      }, ms);
    });
  }

  function volumeTo(tv, pct) {
    const v = tv.volume;
    if (!v?.maximum) return;
    const target = Math.round((pct / 100) * v.maximum);
    let diff = Math.max(-40, Math.min(40, target - v.level));
    const key = keyOf(diff > 0 ? 'volup' : 'voldown');
    let n = Math.abs(diff);
    const step = () => { if (n-- <= 0) return; try { tv.remote.sendKey(key, SHORT()); } catch {} setTimeout(step, 70); };
    step();
  }

  const actions = {
    async discover() {
      const list = await discover();
      const paired = new Set(state.tvs.map((t) => t.host));
      return list.map((t) => ({ ...t, paired: paired.has(t.host) }));
    },
    async list() { return state.tvs.map((t) => ({ id: `androidtv:${t.host}`, host: t.host, name: t.name, connected: !!tvs.get(t.host)?.ready })); },
    async pair({ host, name }) {
      if (!lib) throw new Error('The Google TV add-on isn’t installed — run "npm run androidtv" in the bridge folder');
      if (!host) throw new Error('Enter the TV’s IP address');
      pairing.get(host)?.remote?.stop?.();
      const remote = new lib.AndroidRemote(host, { pairing_port: 6467, remote_port: 6466, name: 'Round Remote', service_name: 'Round Remote', cert: {} });
      const p = { remote, name: name || `TV ${host}` };
      pairing.set(host, p);
      let timer;
      const secret = new Promise((resolve, reject) => {
        remote.on('secret', () => resolve(true));
        remote.on('error', (e) => reject(new Error(e?.message || 'The TV refused the connection')));
        timer = setTimeout(() => reject(new Error('The TV didn’t answer — check the IP address and that the TV is on')), 12000);
        remote.start().catch((e) => { log('androidtv', `pairing ${host}: ${e.message}`); reject(new Error(`Couldn’t reach the TV at ${host} (${e.code || e.message}) — check the IP address and that the TV is on`)); });
      });
      p.ready = new Promise((resolve) => remote.on('ready', () => resolve(true)));
      try { await secret; } catch (e) { pairing.delete(host); try { remote.stop(); } catch {} throw e; } finally { clearTimeout(timer); }
      return { ok: true, message: 'Enter the code shown on the TV' };
    },
    async code({ host, code }) {
      const p = pairing.get(host);
      if (!p) throw new Error('Start pairing first');
      const ok = await p.remote.sendCode(String(code || '').trim().toUpperCase());
      if (ok === false) throw new Error('That code didn’t match — try again');
      await Promise.race([p.ready, new Promise((r) => setTimeout(r, 8000))]);
      const entry = { host, name: p.name, cert: p.remote.getCertificate() };
      pairing.delete(host);
      try { p.remote.stop(); } catch {}
      state.tvs = state.tvs.filter((t) => t.host !== host).concat(entry);
      saveState(state);
      connect(entry);
      status();
      return { id: `androidtv:${host}`, name: entry.name };
    },
    async unpair({ host }) {
      state.tvs = state.tvs.filter((t) => t.host !== host);
      saveState(state);
      const tv = tvs.get(host);
      if (tv) { try { tv.remote.stop(); } catch {} tvs.delete(host); hub.remove('androidtv', host); }
      status();
      return { ok: true };
    },
    async key({ id, key }) {
      const tv = tvs.get(String(id).replace(/^androidtv:/, ''));
      if (!tv?.remote) throw new Error('TV not connected');
      if (key === 'power' && tv.remote.sendPower) tv.remote.sendPower(); else tv.remote.sendKey(keyOf(key), SHORT());
      return { ok: true };
    },
    async app({ id, link }) {
      const tv = tvs.get(String(id).replace(/^androidtv:/, ''));
      if (!tv?.remote) throw new Error('TV not connected');
      tv.remote.sendAppLink(link);
      return { ok: true };
    },
  };

  return {
    id: 'androidtv',
    actions,
    async start() {
      try {
        const mod = await import(c.module);
        lib = mod.AndroidRemote ? mod : (mod.default || mod);
        if (!lib.AndroidRemote) throw new Error('unexpected androidtv-remote module');
      } catch (e) {
        setStatus('not installed: run "npm run androidtv" in the bridge folder', false);
        log('androidtv', 'androidtv-remote not installed (cd bridge && npm run androidtv)');
        return;
      }
      state.tvs.forEach(connect);
      status();
    },
    stop() { stopped = true; for (const tv of tvs.values()) try { tv.remote.stop(); } catch {} },
    async command(host, cmd, value) {
      const tv = tvs.get(host);
      if (!tv?.remote) return;
      const send = (k) => tv.remote.sendKey(keyOf(k), SHORT());
      if (cmd === 'play' || cmd === 'pause') send('playpause');
      else if (cmd === 'next') send('next');
      else if (cmd === 'prev') send('prev');
      else if (cmd === 'volume') volumeTo(tv, value);
      else if (cmd === 'mute') send('mute');
    },
    // the Playlists panel doubles as an app launcher for the TV
    async playlists() { return TV_APPS.map((a) => ({ kind: 'app', id: a.id, name: a.name, subtitle: 'Open on the TV', mono: a.name.slice(0, 2), link: a.link })); },
    async play(host, item) {
      const tv = tvs.get(host);
      const app = TV_APPS.find((a) => a.id === item.id);
      if (tv?.remote && (item.link || app)) tv.remote.sendAppLink(item.link || app.link);
    },
  };
}
