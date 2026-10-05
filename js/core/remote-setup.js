// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Set up this display from a phone or computer (the display's side of bridge/lib/setup.js).
// The display registers with the bridge it uses (an id + a secret key kept in this browser), opens a pairing
// (6-digit code + a one-time QR token, 15 minutes), publishes a live checklist of every service, and carries out what
// the phone sends — with the providers' own sign-in code, exactly as its own setup screens do — replying how it went.
//
//   remoteSetup.start({ service }) → opens pairing; .stop() ends it (and every phone's session); .kick(phoneId)
//   remoteSetup.state: { status: 'off'|'connecting'|'ok'|'nobridge'|'old', pair: { code, token, exp } | null, phones: [], url, shortUrl }
//   remoteSetup.events: 'state' · 'phones' · 'adopted' (service id) · 'act'
import { store } from './store.js';
import { Emitter, isMixed } from './util.js';
import { bridgeBase, bridgeFetch } from '../providers/bridge.js';
import { provider } from '../providers/registry.js';
import { SCOPES, redirectUri } from '../providers/spotify.js';
import { googleSignedIn } from './youtube.js';
import { setJellyfinServer, connectHass, hassMessage, connectStreamer, saveYouTube } from './service-setup.js';
import { buildProfile, applyProfile, saveBridgeProfile, loadBridgeProfile } from './profiles.js';
import { systemInfo, canWrite, sysGet, sysPost, errText } from './device.js';
import { toast } from '../ui/overlay.js';

const events = new Emitter();
const ABC = 'abcdefghijkmnopqrstuvwxyz23456789';
const rnd = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => ABC[b % ABC.length]).join('');
const errMsg = (e) => e?.body?.error || e?.userMessage || e?.message || String(e);
const RELAY = 'https://royborkin.github.io/RoundSpotify/';

function ids() {
  let id = store.temp('setupDisplay'), key = store.temp('setupKey');
  if (!id) { id = 'd' + rnd(14); store.temp('setupDisplay', id); }
  if (!key) { key = rnd(32); store.temp('setupKey', key); }
  return { display: id, key };
}
const displayName = () => (store.get('profileName') || '').trim() || 'Round display';

const state = { status: 'off', reason: '', pair: null, phones: [], url: '', shortUrl: '', info: null, base: '', service: '' };
let es = null, pollT = 0, pubT = 0, aliveT = 0, seq = 0, boot = '', running = false, users = 0, lastStatus = '';
const flows = {};   // running sign-in flows (Plex PIN, Jellyfin Quick Connect) → AbortController

function set(patch) { Object.assign(state, patch); events.emit('state', state); }
const qsAuth = () => { const { display, key } = ids(); return `display=${encodeURIComponent(display)}&key=${encodeURIComponent(key)}`; };
const post = (path, json = {}) => bridgeFetch(`/api/setup/${path}`, { method: 'POST', json: { ...ids(), ...json } });

/** The address phones open: the bridge's public URL, else its own address (a LAN IP when the display uses localhost). */
function phoneBase(base, info) {
  if (info?.publicUrl) return info.publicUrl.replace(/\/$/, '');
  try {
    const u = new URL(base);
    if (!/^(localhost|127\.|\[?::1)/.test(u.hostname)) return u.origin;
    const ip = info?.ips?.[0];
    return ip ? `http://${ip}:${info.port || u.port || 8765}` : '';
  } catch { return ''; }
}
function buildUrls() {
  const root = phoneBase(state.base, state.info);
  if (!root) return set({ url: '', shortUrl: '' });
  const p = state.pair;
  const url = `${root}/setup${p?.token ? `?t=${p.token}&d=${ids().display}${state.service ? `&s=${state.service}` : ''}` : ''}`;
  set({ url, shortUrl: state.info?.shortUrl || `${root}/setup` });
}

// ------------------------------------------------------------------ connection
async function connect() {
  const base = await bridgeBase().catch(() => null);
  if (!base) { set({ status: 'nobridge', reason: 'nobridge' }); return false; }
  let info;
  try { info = await bridgeFetch('/api/setup/info', { timeout: 5000 }); }
  catch (e) { set({ status: e.status === 404 ? 'old' : 'nobridge', reason: e.status === 404 ? 'old' : 'nobridge' }); return false; }
  const r = await post('claim', { name: displayName() }).catch((e) => ({ error: e }));
  if (r.error) {
    if (r.error.status === 403) { store.temp('setupDisplay', null); store.temp('setupKey', null); return connect(); }   // someone else's id: start over
    set({ status: 'nobridge', reason: errMsg(r.error) }); return false;
  }
  if (r.boot !== boot) { boot = r.boot; seq = 0; }
  set({ base, info, pair: r.pair, phones: r.phones || [], status: 'ok' });
  buildUrls();
  openStream(base);
  return true;
}
function closeStream() { try { es?.close(); } catch {} es = null; clearTimeout(pollT); }
function openStream(base) {
  closeStream();
  if (typeof EventSource === 'undefined' || isMixed(base)) return poll();
  const src = new EventSource(`${base}/api/setup/host?${qsAuth()}&since=${seq}`);
  es = src;
  src.addEventListener('hello', (e) => { const d = JSON.parse(e.data); hello(d); });
  src.addEventListener('act', (e) => { try { handle(JSON.parse(e.data)); } catch (x) { console.error(x); } });
  src.addEventListener('phones', (e) => setPhones(JSON.parse(e.data)));
  src.addEventListener('pair', (e) => { set({ pair: JSON.parse(e.data) }); buildUrls(); });
  src.onerror = () => {
    if (es !== src) return;
    if (src.readyState === 2) { es = null; if (running) setTimeout(() => running && connect(), 2500); }
  };
}
function hello(d) {
  if (d.boot && d.boot !== boot) { boot = d.boot; seq = 0; }
  set({ pair: d.pair || null }); buildUrls(); setPhones(d.phones || []);
}
async function poll() {
  clearTimeout(pollT);
  if (!running) return;
  try {
    const d = await bridgeFetch(`/api/setup/inbox?${qsAuth()}&since=${seq}`, { timeout: 8000 });
    if (d.boot !== boot) { boot = d.boot; seq = 0; }
    if (JSON.stringify(d.pair) !== JSON.stringify(state.pair)) { set({ pair: d.pair }); buildUrls(); }
    setPhones(d.phones || []);
    for (const a of d.acts || []) handle(a);
  } catch (e) { if (e.status === 404) { connect(); return; } }
  pollT = setTimeout(poll, 1500);
}
function setPhones(list) {
  const before = new Set(state.phones.map((p) => p.id));
  set({ phones: list });
  events.emit('phones', list);
  if (list.length && list.some((p) => !before.has(p.id))) publish(true);
}

// ------------------------------------------------------------------ checklist
async function buildStatus() {
  const P = (id) => provider(id);
  const ok = (text = '') => ({ state: 'ok', text }), todo = (text = '') => ({ state: 'todo', text }), warn = (text = '') => ({ state: 'warn', text });
  const services = {};
  const sp = store.auth('spotify');
  services.spotify = P('spotify').isAuthed() ? ok(sp?.name ? `Signed in as ${sp.name}` : 'Signed in') : todo();
  let appleKey = !!(store.get('appleDeveloperToken') || '').trim();
  if (!appleKey) { try { appleKey = !!(await bridgeFetch('/api/apple/token', { timeout: 4000 }))?.token; } catch {} }
  services.apple = store.auth('apple')?.authorized ? ok('Signed in on the display') : appleKey ? warn('Key ready — tap “Sign in with Apple Music” on the display') : todo('Cider / the Apple Music app work without this');
  const yk = !!(store.get('youtubeApiKey') || '').trim();
  services.youtube = yk ? ok(`API key saved${googleSignedIn() ? ' · Google account' : ''}`) : todo();
  services.plex = P('plex').isAuthed() ? ok('Signed in') : todo();
  const jf = store.auth('jellyfin');
  services.jellyfin = P('jellyfin').isAuthed() ? ok(`${jf?.user || 'Signed in'} · ${store.get('jellyfinServer')}`) : todo(store.get('jellyfinServer') || '');
  services.homeassistant = P('homeassistant').isAuthed() ? ok(store.get('haUrl')) : todo(store.get('haUrl') || '');
  const fs = store.auth('streamer');
  services.streamer = fs?.host ? ok(fs.name ? `${fs.name} · ${fs.host}` : fs.host) : todo();
  const a = store.get('alerts') || {};
  let wifi = null, pi = false;
  try {
    const info = await systemInfo();
    pi = !!(info.pi && info.caps?.wifi && canWrite(info));
    if (pi) { const w = await sysGet('wifi', { timeout: 6000 }).catch(() => null); wifi = { ssid: w?.current?.ssid || '' }; }
  } catch {}
  const tvs = ['androidtv', 'appletv', 'youtube', 'ytvideo'].filter((k) => store.getZone(k)).length;
  return {
    v: 1,
    display: { name: displayName(), pi, origin: location.origin, secure: window.isSecureContext },
    services,
    values: {
      spotifyClientId: store.get('spotifyClientId') || '', spotifyScopes: SCOPES,
      spotifyRelay: /^https:/.test(redirectUri()) ? redirectUri() : (state.info?.relay || RELAY),
      jellyfinServer: store.get('jellyfinServer') || '', haUrl: store.get('haUrl') || '', streamerHost: fs?.host || '',
      youtubeKey: yk, googleClientId: store.get('googleClientId') || '', profileName: store.get('profileName') || '',
      alerts: { lights: (a.lights || []).length, speaker: a.speaker || '', notify: a.notify || '', gh: !!a.gh },
      wifi, tvs,
    },
  };
}
/** Send the checklist to the bridge (→ every paired phone). Debounced; `now` skips the wait. */
function publish(now = false) {
  if (!running || state.status !== 'ok') return;
  clearTimeout(pubT);
  pubT = setTimeout(async () => {
    try {
      const status = await buildStatus();
      const s = JSON.stringify(status);
      if (s === lastStatus && !now) return;
      lastStatus = s;
      await bridgeFetch('/api/setup/status', { method: 'PUT', json: { ...ids(), status } });
    } catch {}
  }, now ? 50 : 500);
}
store.on('change', () => publish());
store.on('auth', () => publish());

// ------------------------------------------------------------------ what phones send
async function reply(a, stage, ok, message = '', data = null) {
  try { await post('reply', { seq: a.seq, ref: a.ref, svc: a.svc, stage, ok, message, data }); } catch {}
}
const adopted = (svc, a, what) => {
  events.emit('adopted', svc);
  if (what) toast(`${what}${a?.name ? ` — from ${a.name}` : ''}`);
  publish(true);
};
const cancelFlow = (k) => { flows[k]?.abort(); delete flows[k]; };

const HANDLERS = {
  hello: async () => { publish(true); },
  joined: async (a) => { toast(`${a.name || 'A phone'} connected for setup`); publish(true); },
  refresh: async () => { publish(true); },
  'spotify-client': async (a) => {
    const id = String(a.data.clientId || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error('A Spotify Client ID is 32 letters and digits');
    store.set('spotifyClientId', id);
    adopted('spotify', a);
    return 'Client ID saved on the display';
  },
  'spotify-code': async (a) => {
    const { code, verifier, redirectUri: redirect, clientId } = a.data;
    if (!code || !verifier || !redirect) throw new Error('The sign-in didn’t come back complete — try again');
    if (clientId) store.set('spotifyClientId', String(clientId).trim());
    const p = provider('spotify');
    try { await p.exchangeCode(String(code), String(verifier), String(redirect)); }
    catch (e) { throw new Error(e.status === 400 ? `Spotify refused the sign-in (${e.body?.error_description || e.body?.error || 'invalid code'}) — is ${redirect} listed as a Redirect URI?` : errMsg(e)); }
    const name = store.auth('spotify')?.name;
    adopted('spotify', a, 'Spotify connected');
    return `Signed in${name ? ` as ${name}` : ''} — the display can control Spotify now`;
  },
  'plex-start': async (a) => {
    cancelFlow('plex');
    const p = provider('plex'), ctl = new AbortController(); flows.plex = ctl;
    const [strong, short] = await Promise.all([p.pinStart(true), p.pinStart(false)]);
    const back = `${phoneBase(state.base, state.info) || ''}/setup?s=plex`;
    await reply(a, 'progress', true, 'Sign in on Plex — the display is waiting…', { authUrl: p.authUrl(strong.code, back), code: short.code });
    const wait = (id) => p.pinWait(id, ctl.signal).then((v) => { if (v) ctl.abort(); return v; });
    const res = await Promise.allSettled([wait(strong.id), wait(short.id)]);
    delete flows.plex;
    if (!res.some((r) => r.value === true)) {
      if (ctl.signal.aborted && !res.some((r) => r.status === 'rejected')) return null;   // cancelled: no answer needed
      throw new Error(res.find((r) => r.status === 'rejected')?.reason?.message || 'Plex sign-in was not completed');
    }
    adopted('plex', a, 'Plex connected');
    let server = '';
    try { server = (await Promise.race([p._connectServer(), new Promise((_, rj) => setTimeout(() => rj(new Error('t')), 8000))]))?.name || ''; } catch {}
    return `Signed in to Plex${server ? ` · server “${server}”` : ''}`;
  },
  'plex-cancel': async () => { cancelFlow('plex'); return 'Cancelled'; },
  'jellyfin-login': async (a) => {
    setJellyfinServer(a.data.server);
    try { await provider('jellyfin').login(String(a.data.user || ''), String(a.data.pass || '')); }
    catch (e) { throw new Error(e.status === 401 ? 'Wrong username or password' : errMsg(e)); }
    adopted('jellyfin', a, 'Jellyfin connected');
    return `Signed in as ${store.auth('jellyfin')?.user || a.data.user}`;
  },
  'jellyfin-qc': async (a) => {
    cancelFlow('jellyfin');
    setJellyfinServer(a.data.server);
    const p = provider('jellyfin');
    let qc;
    try { qc = await p.quickConnectStart(); } catch (e) { throw new Error(e.status === 401 ? 'Quick Connect is turned off on this server — use username & password' : errMsg(e)); }
    const ctl = new AbortController(); flows.jellyfin = ctl;
    await reply(a, 'progress', true, 'Waiting for you to approve the code in Jellyfin…', { code: qc.code });
    const okd = await p.quickConnectWait(qc.secret, ctl.signal);
    delete flows.jellyfin;
    if (!okd) return null;
    adopted('jellyfin', a, 'Jellyfin connected');
    return `Signed in as ${store.auth('jellyfin')?.user || 'you'}`;
  },
  'jellyfin-cancel': async () => { cancelFlow('jellyfin'); return 'Cancelled'; },
  ha: async (a) => {
    const r = await connectHass(a.data.url, a.data.token);
    adopted('homeassistant', a, 'Home Assistant connected');
    return hassMessage(r);
  },
  youtube: async (a) => {
    const r = await saveYouTube({ apiKey: a.data.apiKey, clientId: a.data.clientId });
    adopted('youtube', a, 'YouTube keys saved');
    return r.key ? 'Saved — the API key works' : 'Saved (no API key yet)';
  },
  'apple-token': async (a) => {
    const tk = String(a.data.token || '').trim();
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(tk)) throw new Error('A developer token looks like eyJ….….… (three parts)');
    store.set('appleDeveloperToken', tk);
    adopted('apple', a, 'Apple Music token saved');
    return 'Saved — now tap “Sign in with Apple Music” on the display';
  },
  'apple-check': async (a) => {
    const r = await bridgeFetch('/api/apple/token', { timeout: 6000 }).catch((e) => { throw new Error(errMsg(e)); });
    if (!r?.token) throw new Error('The bridge couldn’t make a token');
    adopted('apple', a);
    return 'The bridge signs Apple Music tokens now — tap “Sign in with Apple Music” on the display';
  },
  streamer: async (a) => {
    const r = await connectStreamer(a.data.host);
    adopted('streamer', a, `${r.name || 'Streamer'} connected`);
    return `Connected to ${r.name || 'the streamer'}${r.product ? ` (${r.product})` : ''}`;
  },
  'wifi-scan': async (a) => {
    const r = await sysGet('wifi/scan', { timeout: 30000 }).catch((e) => { throw new Error(errText(e)); });
    await reply(a, 'done', true, `${(r.networks || []).length} networks found`, { networks: (r.networks || []).map((n) => ({ ssid: n.ssid, signal: n.signal, security: n.security, inUse: !!n.inUse, saved: !!n.saved })) });
    return null;
  },
  'wifi-connect': async (a) => {
    const ssid = String(a.data.ssid || '').trim();
    if (!ssid) throw new Error('Pick a network');
    await sysPost('wifi/connect', { ssid, password: a.data.password || undefined }, { timeout: 60000 }).catch((e) => { throw new Error(errText(e)); });
    adopted('wifi', a, `Wi-Fi: ${ssid}`);
    return `Connected to ${ssid}`;
  },
  'profile-save': async (a) => {
    const name = String(a.data.name || '').trim().slice(0, 60) || displayName();
    store.set('profileName', name);
    await saveBridgeProfile(name, buildProfile({ name, includeSignIns: !!a.data.signIns }));
    publish(true);
    return `Saved “${name}” on the bridge${a.data.signIns ? ' (with sign-ins)' : ''}`;
  },
  'profile-load': async (a) => {
    const p = await loadBridgeProfile(String(a.data.name || ''));
    applyProfile(p);
    toast(`Loaded “${p.name}” — restarting`);
    setTimeout(() => location.reload(), 1600);
    return `Loaded “${p.name}” — the display restarts`;
  },
  'alert-test': async (a) => {
    const { notify } = await import('./alerts.js');
    const h = await notify({ title: 'Test alert', message: `A test from ${a.name || 'your phone'}`, level: 'info', source: 'setup' });
    return h ? 'Sent — watch your lights / speaker' : 'Sent (nothing set up to alert yet)';
  },
  // ---- the bridge did something on its own (keys it keeps) — this display catches up
  'app-config': async (a) => {
    for (const [k, v] of Object.entries(a.values || {})) if (typeof v === 'string' && v) store.set(k, v);
    adopted('advanced', a, 'Keys updated');
    return null;
  },
  'bridge-done': async (a) => {
    const k = a.kind;
    if (k === 'steam') { provider('steam').markLinked(a.name || ''); adopted('steam', a, 'Steam connected'); }
    else if (k === 'psn') { provider('playstation').markLinked(a.name || ''); adopted('playstation', a, 'PlayStation connected'); }
    else if (k === 'tv' && a.id) {
      const svc = { androidtv: 'androidtv', appletv: 'appletv', youtubetv: 'youtube' }[a.adapter];
      if (svc) store.setZone(svc, a.id);
      adopted(svc || 'tvs', a, `${a.tv || 'TV'} paired`);
    } else adopted(k, a, { 'apple-key': 'Apple Music key saved on the bridge', googlehome: 'Google Home client saved', collection: 'Collection connections saved' }[k] || '');
    return null;
  },
};

async function handle(a) {
  if (!a || !(a.seq > seq)) return;
  seq = a.seq;
  events.emit('act', a);
  const fn = HANDLERS[a.type];
  if (!fn) return;
  try {
    const msg = await fn(a);
    if (msg != null && (a.svc || a.ref)) await reply(a, 'done', true, msg);
  } catch (e) {
    console.info('[setup]', a.type, e.message);
    if (a.ref || a.svc) await reply(a, 'done', false, errMsg(e));
  }
  publish();
}

// ------------------------------------------------------------------ lifecycle
const active = () => !!((state.pair && state.pair.exp > Date.now()) || state.phones.length);
function watchAlive() {
  clearInterval(aliveT);
  aliveT = setInterval(() => {
    if (!running) return;
    if (state.pair && state.pair.exp <= Date.now()) { set({ pair: null }); buildUrls(); }
    if (users > 0 && !state.pair && state.status === 'ok') { post('pair').then((r) => { set({ pair: r }); buildUrls(); }).catch(() => {}); return; }   // keep a code ready while it's on screen
    if (!users && !active()) halt();
    else if (state.phones.length) publish();
  }, 5000);
}
function halt() {
  running = false; closeStream(); clearInterval(aliveT);
  for (const k of Object.keys(flows)) cancelFlow(k);
  store.temp('setupActive', null);
  set({ status: 'off' });
}

export const remoteSetup = {
  state, events,
  /** Open (or keep) a pairing; `service` makes the QR open that service on the phone. */
  async start({ service = '' } = {}) {
    state.service = service || '';
    const was = running && state.status === 'ok';
    running = true;
    if (!was) {
      set({ status: 'connecting' });
      if (!(await connect())) { running = false; return state; }
    }
    if (!state.pair || state.pair.exp - Date.now() < 60e3) {
      try { const r = await post('pair'); set({ pair: r }); } catch (e) { set({ status: 'nobridge', reason: errMsg(e) }); running = false; return state; }
    }
    buildUrls();
    store.temp('setupActive', String(Date.now() + 20 * 60e3));
    watchAlive();
    publish(true);
    return state;
  },
  setService(service) { state.service = service || ''; buildUrls(); },
  /** A screen showing the pairing is open (keeps a fresh code ready); call the returned function when it closes. */
  attach() { users++; let done = false; return () => { if (!done) { done = true; users = Math.max(0, users - 1); } }; },
  async newCode() { const r = await post('pair'); set({ pair: r }); buildUrls(); return r; },
  async kick(phone) { const r = await post('kick', phone ? { phone } : {}); setPhones(r.phones || []); },
  /** End setup: the code stops working and every phone is disconnected. */
  async stop() {
    try { await post('unpair'); await post('kick'); } catch {}
    set({ pair: null, phones: [] });
    halt();
  },
  get running() { return running; },
  publish,
};

// After a reload (a profile was loaded, the kiosk restarted…) carry on where setup was.
setTimeout(() => {
  const until = +(store.temp('setupActive') || 0);
  if (until > Date.now() && !running) { running = true; connect().then((ok) => { if (ok) { watchAlive(); publish(true); } else running = false; }); }
}, 2500);
