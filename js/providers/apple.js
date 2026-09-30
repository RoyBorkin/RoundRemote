// Apple Music via MusicKit JS v3. MusicKit plays audio in *this* browser (on the Pi that
// means the Pi's speakers/DAC), so this provider is a player rather than a remote.
// Needs an Apple Music developer token (JWT): paste it in Settings, or let the bridge
// generate one from your .p8 key (see bridge/config.example.json).
import { Provider } from './base.js';
import { store } from '../core/store.js';
import { bridgeFetch } from './bridge.js';

const SDK = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
let sdkPromise = null;

function loadSdk() {
  if (window.MusicKit?.configure) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('MusicKit failed to load')), 15000);
    document.addEventListener('musickitloaded', () => { clearTimeout(t); resolve(); }, { once: true });
    const s = document.createElement('script');
    s.src = SDK; s.async = true; s.setAttribute('data-web-components', '');
    s.onerror = () => { clearTimeout(t); sdkPromise = null; reject(new Error('Could not load MusicKit (offline?)')); };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

const art = (a, size = 600) => (a?.url || '').replace('{w}', size).replace('{h}', size).replace('{f}', 'jpg');

export class AppleProvider extends Provider {
  constructor(meta) {
    super(meta);
    Object.assign(this.caps, { seek: true, volume: true, next: true, prev: true, playlists: true, search: true, shuffle: true, repeat: true });
    this.local = true;
    this.music = null;
    this.handlers = [];
  }
  setupHint() { return ''; }
  isAuthed() { return !!store.auth('apple')?.authorized; }

  async _token() {
    const t = (store.get('appleDeveloperToken') || '').trim();
    if (t) return t;
    try { const r = await bridgeFetch('/api/apple/token'); if (r?.token) return r.token; } catch {}
    throw new Error('Apple Music needs a developer token — add it in Settings or configure the bridge.');
  }
  async _init() {
    if (this.music) return this.music;
    const developerToken = await this._token();
    await loadSdk();
    this.music = await window.MusicKit.configure({ developerToken, app: { name: 'Round Remote', build: '2.0.0' } });
    return this.music;
  }
  async connect() {
    const m = await this._init();
    await m.authorize();
    store.setAuth('apple', { authorized: true });
  }

  async start() {
    this.publish({ status: 'loading' });
    const m = await this._init();
    if (!m.isAuthorized) { store.setAuth('apple', null); throw new Error('Apple Music sign-in expired — connect again'); }
    const E = window.MusicKit.Events;
    const on = (ev, fn) => { m.addEventListener(ev, fn); this.handlers.push([ev, fn]); };
    on(E.nowPlayingItemDidChange, () => this.refresh());
    on(E.playbackStateDidChange, () => this.refresh());
    on(E.playbackVolumeDidChange, () => this.refresh());
    // Time events fire ~4x/s; our UI interpolates, so only resync occasionally.
    let last = 0;
    on(E.playbackTimeDidChange, () => { const n = performance.now(); if (n - last > 2000) { last = n; this.refresh(); } });
    await this.refresh();
  }
  stop() {
    for (const [ev, fn] of this.handlers) this.music?.removeEventListener(ev, fn);
    this.handlers = [];
  }
  async refresh() {
    const m = this.music; if (!m) return;
    const it = m.nowPlayingItem;
    if (!it) { this.publish({ track: null, isPlaying: false, status: 'nodevice', message: 'Pick a playlist or search to start playing' }); return; }
    this.publish({
      track: {
        id: it.id, title: it.title || it.attributes?.name, artist: it.artistName || it.attributes?.artistName || '',
        album: it.albumName || it.attributes?.albumName || '', art: art(it.artwork || it.attributes?.artwork),
        durationMs: (m.currentPlaybackDuration || 0) * 1000 || it.playbackDuration || it.attributes?.durationInMillis || 0,
      },
      isPlaying: !!m.isPlaying,
      progressMs: (m.currentPlaybackTime || 0) * 1000,
      volume: Math.round((m.volume ?? 1) * 100),
      device: { id: 'local', name: 'This display', type: 'Computer' },
      shuffle: !!m.shuffleMode,
      repeat: ['off', 'one', 'all'][m.repeatMode] || 'off',
      status: 'ok', message: '',
    });
  }
  play() { return this.music.play(); }
  pause() { return this.music.pause(); }
  next() { return this.music.skipToNextItem(); }
  prev() { return this.music.skipToPreviousItem(); }
  seek(ms) { return this.music.seekToTime(ms / 1000); }
  async setVolume(v) { this.music.volume = v / 100; }
  async setShuffle(on) { this.music.shuffleMode = on ? 1 : 0; }
  async setRepeat(mode) { this.music.repeatMode = { off: 0, one: 1, all: 2 }[mode] ?? 0; }

  async getPlaylists() {
    const r = await this.music.api.music('/v1/me/library/playlists', { limit: 100 });
    return (r?.data?.data || []).map((p) => ({
      id: p.id, name: p.attributes?.name || 'Playlist', art: art(p.attributes?.artwork, 120), subtitle: 'Library playlist',
    }));
  }
  async playPlaylist(pl) { await this.music.setQueue({ playlist: pl.id, startPlaying: true }); }
  async search(q) {
    const r = await this.music.api.music('/v1/catalog/{{storefrontId}}/search', { term: q, types: 'songs,albums,playlists', limit: 10 });
    const res = r?.data?.results || {};
    const songs = (res.songs?.data || []).map((s) => ({ kind: 'track', id: s.id, title: s.attributes.name, subtitle: `${s.attributes.artistName} · ${s.attributes.albumName}`, art: art(s.attributes.artwork, 120) }));
    const albums = (res.albums?.data || []).slice(0, 4).map((a) => ({ kind: 'album', id: a.id, title: a.attributes.name, subtitle: `Album · ${a.attributes.artistName}`, art: art(a.attributes.artwork, 120) }));
    const pls = (res.playlists?.data || []).slice(0, 4).map((p) => ({ kind: 'playlist', id: p.id, title: p.attributes.name, subtitle: 'Playlist', art: art(p.attributes.artwork, 120) }));
    return [...songs, ...albums, ...pls];
  }
  async playItem(item) {
    const key = { track: 'song', album: 'album', playlist: 'playlist' }[item.kind] || 'song';
    await this.music.setQueue({ [key]: item.id, startPlaying: true });
  }
  async getDevices() { return [{ id: 'local', name: 'This display', type: 'Computer', active: true }]; }
  async signOut() { try { await this.music?.unauthorize(); } catch {} store.setAuth('apple', null); }
}
