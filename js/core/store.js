// Persistent settings + per-service auth storage (localStorage, guarded).
import { Emitter } from './util.js';

const SETTINGS_KEY = 'rr.settings.v2';
const AUTH_PREFIX = 'rr.auth.';

// The client ID from the original RoundSpotify project. Change it in Settings if you
// create a new Spotify app (remember to add this page's URL as a Redirect URI there).
const DEFAULT_SPOTIFY_CLIENT_ID = 'ae4f9dd4cc124d92b33737be4ff31c1f';

export const DEFAULTS = Object.freeze({
  lastService: null,
  autoResume: true,            // jump straight to the last service on launch
  view: 'info',                // info | vinyl | lyrics
  lyricsStyle: 'basic',        // basic | animated | typing | roll | kinetic
  lyricsOffsetMs: 0,
  vinylSecondsPerTurn: 12,     // scratch sensitivity; 1.8 = real 33⅓ rpm
  vinylRealSpeed: true,        // spin at 33⅓ rpm while playing
  autoHideChrome: true,
  liteMode: false,             // fewer blur effects for slower GPUs (Pi 3/Zero)
  artAccent: true,
  keyboard: 'auto',            // on-screen keyboard: auto | on | off
  dimAfterMin: 10,             // 0 = never
  pollMs: 2000,
  bridgeUrl: '',               // '' = auto (same origin if served by the bridge, else http://localhost:8765)
  bridgeKnown: false,          // a bridge was found before → OK to probe for it in the background
  spotifyClientId: DEFAULT_SPOTIFY_CLIENT_ID,
  appleDeveloperToken: '',
  jellyfinServer: '',
  plexServerId: '',
  zone: {},                    // last selected zone/device per service id
});

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, val) { try { localStorage.setItem(key, val); } catch {} }
function safeDel(key) { try { localStorage.removeItem(key); } catch {} }

class Store extends Emitter {
  constructor() {
    super();
    let saved = {};
    try { saved = JSON.parse(safeGet(SETTINGS_KEY) || '{}') || {}; } catch {}
    this.s = { ...DEFAULTS, ...saved, zone: { ...(saved.zone || {}) } };
  }
  get(k) { return this.s[k]; }
  set(k, v) {
    if (this.s[k] === v && typeof v !== 'object') return;
    this.s[k] = v;
    this._save();
    this.emit('change', k, v);
    this.emit(`change:${k}`, v);
  }
  patch(obj) { for (const [k, v] of Object.entries(obj)) this.set(k, v); }
  setZone(service, zoneId) { this.s.zone = { ...this.s.zone, [service]: zoneId }; this._save(); }
  getZone(service) { return this.s.zone?.[service] || null; }
  /** Settings supplied by the bridge's config.json fill in anything the user hasn't set. */
  applyRemoteDefaults(cfg = {}) {
    for (const [k, v] of Object.entries(cfg)) {
      if (!(k in DEFAULTS) || v === undefined || v === null || v === '') continue;
      const cur = this.s[k];
      if (cur === DEFAULTS[k] || cur === '' || cur == null) this.s[k] = v;
    }
    this._save();
  }
  reset() { this.s = { ...DEFAULTS, zone: {} }; this._save(); this.emit('change', '*'); }
  _save() { safeSet(SETTINGS_KEY, JSON.stringify(this.s)); }

  // ---- auth blobs (tokens etc.) per service ----
  auth(service) { try { return JSON.parse(safeGet(AUTH_PREFIX + service) || 'null'); } catch { return null; } }
  setAuth(service, data) {
    if (data == null) safeDel(AUTH_PREFIX + service); else safeSet(AUTH_PREFIX + service, JSON.stringify(data));
    this.emit('auth', service);
  }
  // scratch values (e.g. PKCE verifier) that survive a redirect
  temp(key, val) {
    if (val === undefined) { const v = safeGet('rr.tmp.' + key); return v; }
    if (val === null) safeDel('rr.tmp.' + key); else safeSet('rr.tmp.' + key, val);
  }
}

export const store = new Store();
