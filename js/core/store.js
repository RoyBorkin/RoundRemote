// © 2026 Roy Borkin. All rights reserved. See LICENSE.
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
  view: 'info',                // info | vinyl | lyrics | video
  lyricsStyle: 'basic',        // basic | typing | roll | fluid | typo
  typoVariant: 'stack',        // Kinetic Type: stack | camera | slam | animated | moving | random
  lyricsOffsetMs: 0,
  vinylSecondsPerTurn: 1.8,    // record speed = spin + scratch: seconds of music per turn (1.8 = real 33⅓ rpm)
  vinylLabelSize: 46,          // centre artwork size, % of the record (0 = none, 100 = full screen)
  vinylDesign: 'classic',      // record look: classic | clear | flat (js/views/vinyl-styles.js)
  vinylColor: '#111111',       // record colour (#111111 = the classic black record)
  armDesign: 'classic',        // tone arm: classic | s-arm | minimal
  vinylDeck: 'vinyl',          // the Vinyl view plays on: vinyl | tape (cassette) | cdback (CD, data side) | cdtop (CD, label side)
  tapeStyle: 'classic',        // cassette: classic | clear | metal (js/views/deck-styles.js)
  cdBackStyle: 'silver',       // CD data side: silver | gold | black
  cdTopStyle: 'print',         // CD label side: print | marker | ring
  infoFullArt: 'clear',        // Classic view when controls hide: clear | milky (artwork) | card-black | card-blur (song info)
  uiSize: 'L',                 // control size: XS | S | M | L | XL
  autoHideChrome: true,
  liteMode: false,             // fewer blur effects for slower GPUs (Pi 3/Zero)
  artAccent: true,
  keyboard: 'auto',            // on-screen keyboard: auto | on | off
  kbdLang: 'en',               // on-screen keyboard language: en | he
  onlySignedIn: false,         // home: hide services that aren't signed in / reachable
  showDemo: true,              // home: show the Demo service tile
  homeHidden: [],              // home: service ids hidden from the ring (Settings → Home screen → Services, or hold a tile)
  homeOrder: [],               // home: service ids in the order chosen there (the rest follow in the built-in order)
  homeBattery: true,           // home: battery level next to the date (when this device has a battery)
  typoRandomOff: [],           // Kinetic Type variants left out of Random (new variants are in by default)
  playerHide: [],              // parts of the music player's controls to hide (see PLAYER_PARTS)
  showDevicePill: true,        // player: the "Service · Device" line near the top
  infoAutoHide: true,          // Classic view: hide the controls by themselves (with Auto-hide controls on)
  infoShowArt: true,           // Classic view: the round artwork in the middle
  vinylShowTitle: true,        // Vinyl view: song / artist / album text around the label
  videoShowArt: true,          // Video view: the round artwork over the video
  videoMode: 'video',          // Video view: video | slides (photo slideshow)
  videoPreferClip: true,       // Video view: try the official clip first when there is one
  videoHud: false,             // Video view: show song, artist, album and time left while the controls are hidden
  videoKinds: null,            // Video view: kinds of video to use — clip, abstract, live, fan, cover, lyric (null = clip + live)
  factSeconds: 12,             // Fun Facts: seconds per fact
  toneVariant: 'ferro',        // Tone Visual style
  toneSource: 'sim',           // Tone Visual sound: sim (follows playback) | mic (live microphone)
  vinylArmHide: true,          // Vinyl: hide the tone arm together with the controls
  homeMode: 'music',           // home: music | media (movies & shows) | home (smart home)
  profileName: '',             // name used when saving a settings profile
  profileApplied: '',          // last ?profile= applied (name|savedAt), so it's applied again only when re-saved
  // Movies & shows (the media services)
  mediaBg: 'blur',             // background: poster | backdrop | blur | black | slides
  mediaSlideSec: 10,           // slideshow: seconds per picture
  mediaSkipBack: 10,           // skip back, seconds
  mediaSkipFwd: 30,            // skip forward, seconds
  mediaPrevNext: true,         // previous / next episode buttons
  mediaSkip: true,             // skip back / forward buttons
  mediaEpisodes: true,         // function buttons under the controls: seasons & episodes list…
  mediaInfo: true,
  mediaCast: true,
  mediaFacts: true,
  mediaSuggest: true,
  mediaCollection: true,
  mediaTracks: true,           // audio & subtitles
  mediaStop: true,
  mediaEndsAt: true,           // "ends at 22:41" under the time
  mediaHud: true,              // title + time left while the controls are hidden
  mediaClock: false,           // the clock while the controls are hidden
  mediaIdleFacts: false,       // rotate fun facts while the controls are hidden
  mediaAutoHide: true,         // hide the controls by themselves
  mediaLibView: 'list',        // library: list | posters | grid | flow | rings | watch | dvd | disc | dvddisc
  mediaHideWatched: false,     // library: hide what you've already watched
  mediaNoSpoilers: false,      // library: hide summaries and stills of episodes you haven't seen
  mediaHide: [],               // parts of the Now playing controls to hide (see MEDIA_PARTS)
  mediaResume: 'resume',       // play from the library: resume | start | ask
  mediaSubLangs: [],           // preferred subtitle languages for the online search (ISO 639-1), [] = this browser's + English
  mediaSubAuto: true,          // switch to downloaded subtitles straight away
  mediaSkipPop: true,          // "Skip intro" / "Skip credits" button while the TV shows one (Plex, Jellyfin)
  mediaAutoSkip: false,        // skip intros and recaps by themselves
  plexAskWho: false,           // Plex Movies & TV: "Who's watching?" (Plex Home users) every time it opens (js/screens/users.js)
  jellyfinAskWho: false,       // Jellyfin Movies & TV: the same for the Jellyfin users signed in here
  // Home (smart home)
  haUrl: '',                   // Home Assistant address, e.g. http://homeassistant.local:8123
  haFavorites: [],             // entity ids on the Favourites tab (empty = suggestions)
  haTab: 'fav',                // fav | rooms | scenes
  ghCommands: null,            // Google Home command tiles [{ label, cmd, icon }] (null = the default set)
  ghSpeak: true,               // play Google Assistant's spoken answers on this display
  ghLanguage: '',              // Assistant language ('' = the browser's)
  // Smart-home alerts (Settings → Alerts, js/core/alerts.js): how apps get your attention through the home
  alerts: {
    on: true,                  // master switch
    lights: [],                // HA light entities to flash
    lightStyle: 'pulse',       // pulse (colour on/off a few times) | flash (the light's own flash) | solid (colour for a while)
    colors: { info: '#3b82f6', warn: '#f59e0b', alarm: '#ef4444' },
    speaker: '',               // HA media_player for the chime / speech
    chime: true,               // play a chime first
    chimeUrl: '',              // own chime sound URL ('' = sounds/alert-chime.wav from this app)
    speech: true,              // speak the message (text-to-speech)
    tts: '',                   // TTS engine: tts.* entity or tts.*_say service ('' = the first one found)
    volume: null,              // speaker volume for alerts, 0–100 (null = leave it); restored afterwards
    resume: true,              // resume what the speaker was playing before the alert (media_play → play_media → select_source)
    notify: '',                // HA notify service for phone notifications (e.g. mobile_app_pixel_8)
    script: '',                // script.* or scene.* to run
    gh: false,                 // broadcast on Google Home speakers (Google Assistant through the bridge)
    levels: { info: ['lights'], warn: ['lights', 'sound', 'phone'], alarm: ['lights', 'sound', 'phone', 'script', 'gh'] },
    sources: {},               // per app: false = off (missing = on)
    quiet: false, quietFrom: 22 * 60, quietTo: 7 * 60,   // quiet hours (minutes after midnight)
    quietAlarms: true,         // alarms still go through in quiet hours
    repeatSec: 30,             // alarms: lights + speaker again every N s until stopped (0 = once)
  },
  // Look
  theme: 'classic',            // classic | glass | soft | slate | vivid | bauhaus (js/core/theme.js)
  themeCfg: {},                // per theme: { mode: dark|oled|light, c1, c2, follow }
  // Games
  gameScores: {},              // top 5 per game + mode: { 'pong:default': [{ score, label, at, text }] }
  gameModes: {},               // last mode picked per game
  gameOpts: {},                // last options picked per game (e.g. difficulty)
  gameKeys: {},                // which top 5 was last used per game (mode + options)
  gameProgress: {},            // per-game progress that outlives a round (levels unlocked, stars …), keyed by game id
  gamePlayer: '',              // the name last entered for a top-5 score
  gameSound: true,             // sound effects in the games
  lastGame: null,              // the game selected on the Games ring
  // Rhythm (rhythm/)
  rhythmService: '',           // the music service chosen on the Rhythm screen ('' = ask)
  rhythmGame: null,            // the game selected on the Rhythm ring
  rhythmOffsetMs: 0,           // audio + tap latency in ms (Settings → Rhythm → calibrate); subtracted from the song time
  rhythmSource: 'auto',        // how songs are learned: auto | file | mic | bridge | tempo
  rhythmSel: {},               // chosen version per song key
  hitsterLang: 'auto',         // Hitster's language: auto (= the keyboard language) | en | he
  dimAfterMin: 10,             // 0 = never
  // Device (Settings → Device on the Raspberry Pi; Orientation & Battery saver also under General on phones/tablets)
  batterySaver: false,         // Battery saver is ACTIVE now (set by js/core/power.js from saverMode) → the app treats it like liteMode
  saverMode: 'off',            // off | on | auto (on at ≤ saverAt % battery)
  saverAt: 20,                 // auto: battery % at which it turns on
  saverOffCharging: true,      // auto: turn off again while charging
  saverActions: { lite: true, governor: true, wifi: true, bluetooth: false, screen: true, dim: true },   // what Battery saver does
  saverDim: 0.4,               // dim overlay opacity while saving (the panel's backlight is button-only)
  screenOffMin: 0,             // Pi: HDMI off after N min without a touch (0 = never; Battery saver: 2 min at most)
  nightDim: { on: false, from: 22 * 60, to: 7 * 60, level: 0.5 },   // dark overlay at night (minutes after midnight)
  orientMode: 'off',           // screen rotation: off | 90 | 45 | free
  orientSource: 'manual',      // pi (the Pi's IMU) | motion (this phone/tablet's sensor) | manual (buttons)
  orientAxis: 'roll',          // Pi IMU: which angle turns the screen: roll | pitch | heading
  orientReverse: false,        // sensor turns the other way
  orientOffset: 0,             // sensor angle that counts as upright (calibrate)
  orientManual: 0,             // manual rotation, degrees clockwise
  pollMs: 2000,
  bridgeUrl: '',               // '' = auto (same origin if served by the bridge, else http://localhost:8765)
  bridgeKnown: false,          // a bridge was found before → OK to probe for it in the background
  tvDirect: [],                // Google TVs controlled without the bridge (TV Remote app): [{ host, port, name }]
  spotifyClientId: DEFAULT_SPOTIFY_CLIENT_ID,
  spotifyWebPlayer: true,      // make this display a Spotify Connect speaker (Web Playback SDK)
  youtubeApiKey: '',           // YouTube Data API v3 key: YouTube search + music videos for the Video view
  googleClientId: '',          // Google OAuth client ID (optional): your YouTube playlists & likes
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
  /** Replace every setting at once (loading a settings profile). */
  replaceAll(obj) { this.s = { ...DEFAULTS, ...obj, zone: { ...(obj.zone || {}) } }; this._save(); this.emit('change', '*'); }
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

/** "Reduce effects" in force: the user's setting, or Battery saver while it's on (without touching liteMode itself). */
export const isLite = () => !!(store.s.liteMode || (store.s.batterySaver && store.s.saverActions?.lite !== false));
/** How often remote services are polled (ms): the user's choice, at least 4 s while Battery saver is on. */
export const pollMs = () => Math.max(Number(store.s.pollMs) || 2000, store.s.batterySaver ? 4000 : 0);
