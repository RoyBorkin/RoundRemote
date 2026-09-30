// Apple Music via MusicKit JS v3. MusicKit plays audio in *this* browser (on the Pi that
// means the Pi's speakers/DAC), so this provider is a player rather than a remote.
// Needs an Apple Music developer token (JWT): paste it in Settings, or let the bridge
// generate one from your .p8 key (see bridge/config.example.json).
// Without a token it can instead remote-control Apple Music playing on a computer through the
// bridge: Cider (Windows/macOS/Linux), Sidra (Linux) or the Apple Music app for Windows.
import { Provider } from './base.js';
import { store } from '../core/store.js';
import { bridgeFetch, bridgeBase, bridgeZones, isAppleZone, BridgeProvider } from './bridge.js';

const REMOTE = /^(cider|mpris|winmedia):/;

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
  isAuthed() { return !!store.auth('apple')?.authorized || REMOTE.test(store.getZone(this.id) || ''); }

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
    const want = store.getZone(this.id);
    if (want && REMOTE.test(want)) {
      try { await this._attach(want); return; } catch (e) {
        if (!store.auth('apple')?.authorized) throw e;
        this.emit('notice', e.userMessage || 'Apple Music on your computer isn’t reachable — playing here instead');
      }
    }
    if (!store.auth('apple')?.authorized) {
      // not signed in to MusicKit: use Apple Music on a computer if the bridge sees one
      const z = (await bridgeZones(isAppleZone))[0];
      if (z) { store.setZone(this.id, z.id); return this._attach(z.id); }
      throw Object.assign(new Error('not signed in'), { userMessage: 'Sign in with Apple Music, or play it in Cider / the Apple Music app on a computer running the bridge' });
    }
    return this._startLocal();
  }
  // ---------- Apple Music on a computer, through the bridge ----------
  async _attach(zoneId) {
    if (!(await bridgeBase())) throw Object.assign(new Error('no bridge'), { userMessage: 'Start the bridge to control Apple Music on your computer' });
    this._stopLocal();
    this.remote?.stop();
    const r = new BridgeProvider({ id: `${this.id}-remote`, name: this.name }, { adapter: zoneId.split(':')[0] });
    r.zoneId = zoneId; r.userPicked = true;
    r.on('state', (st) => { Object.assign(this.caps, r.caps, { devices: true }); this.publish(st); });
    this.remote = r;
    await r.start();
  }
  _detach() { this.remote?.stop(); this.remote = null; Object.assign(this.caps, { seek: true, volume: true, next: true, prev: true, playlists: true, search: true, shuffle: true, repeat: true }); }
  async _startLocal() {
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
  stop() { this.remote?.stop(); this._stopLocal(); }
  _stopLocal() {
    for (const [ev, fn] of this.handlers) this.music?.removeEventListener(ev, fn);
    this.handlers = [];
    try { if (this.music?.isPlaying) this.music.pause(); } catch {}
  }
  async refresh() {
    if (this.remote) return this.remote.refresh();
    const m = this.music; if (!m) return;
    const it = m.nowPlayingItem;
    if (!it) { this.publish({ track: null, isPlaying: false, status: 'nodevice', message: 'Pick a playlist or search to start playing' }); return; }
    this.publish({
      track: {
        id: it.id, title: it.title || it.attributes?.name, artist: it.artistName || it.attributes?.artistName || '',
        album: it.albumName || it.attributes?.albumName || '', art: art(it.artwork || it.attributes?.artwork),
        durationMs: (m.currentPlaybackDuration || 0) * 1000 || it.playbackDuration || it.attributes?.durationInMillis || 0,
        year: parseInt((it.releaseDate?.toISOString?.() || it.attributes?.releaseDate || '').slice(0, 4), 10) || null,
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
  play() { return this.remote ? this.remote.play() : this.music.play(); }
  pause() { return this.remote ? this.remote.pause() : this.music.pause(); }
  next() { return this.remote ? this.remote.next() : this.music.skipToNextItem(); }
  prev() { return this.remote ? this.remote.prev() : this.music.skipToPreviousItem(); }
  seek(ms) { return this.remote ? this.remote.seek(ms) : this.music.seekToTime(ms / 1000); }
  async setVolume(v) { if (this.remote) return this.remote.setVolume(v); this.music.volume = v / 100; }
  async setShuffle(on) { if (this.remote) return this.remote.setShuffle(on); this.music.shuffleMode = on ? 1 : 0; }
  async setRepeat(mode) { if (this.remote) return this.remote.setRepeat(mode); this.music.repeatMode = { off: 0, one: 1, all: 2 }[mode] ?? 0; }

  async getPlaylists() {
    if (this.remote) return this.remote.getPlaylists();
    const r = await this.music.api.music('/v1/me/library/playlists', { limit: 100 });
    return (r?.data?.data || []).map((p) => ({
      id: p.id, name: p.attributes?.name || 'Playlist', art: art(p.attributes?.artwork, 120), subtitle: 'Library playlist',
    }));
  }
  async playPlaylist(pl) { if (this.remote) return this.remote.playPlaylist(pl); await this.music.setQueue({ playlist: pl.id, startPlaying: true }); }
  async search(q) {
    if (this.remote) return this.remote.search(q);
    const r = await this.music.api.music('/v1/catalog/{{storefrontId}}/search', { term: q, types: 'songs,albums,playlists', limit: 10 });
    const res = r?.data?.results || {};
    const songs = (res.songs?.data || []).map((s) => ({ kind: 'track', id: s.id, title: s.attributes.name, subtitle: `${s.attributes.artistName} · ${s.attributes.albumName}`, art: art(s.attributes.artwork, 120) }));
    const albums = (res.albums?.data || []).slice(0, 4).map((a) => ({ kind: 'album', id: a.id, title: a.attributes.name, subtitle: `Album · ${a.attributes.artistName}`, art: art(a.attributes.artwork, 120) }));
    const pls = (res.playlists?.data || []).slice(0, 4).map((p) => ({ kind: 'playlist', id: p.id, title: p.attributes.name, subtitle: 'Playlist', art: art(p.attributes.artwork, 120) }));
    return [...songs, ...albums, ...pls];
  }
  async playItem(item) {
    if (this.remote) return this.remote.playItem(item);
    const key = { track: 'song', album: 'album', playlist: 'playlist' }[item.kind] || 'song';
    await this.music.setQueue({ [key]: item.id, startPlaying: true });
  }
  async getDevices() {
    const list = [];
    if (store.auth('apple')?.authorized) list.push({ id: 'local', name: 'This display', type: 'MusicKit player here', active: !this.remote });
    for (const z of await bridgeZones(isAppleZone)) list.push({ id: z.id, name: z.name, type: z.state?.track ? `${z.sourceApp} · ${z.state.track.title}` : z.sourceApp, active: this.remote?.zoneId === z.id, volume: z.state?.volume });
    return list;
  }
  async selectDevice(dev) {
    if (dev.id === 'local') { store.setZone(this.id, null); this._detach(); await this._startLocal(); return; }
    store.setZone(this.id, dev.id);
    await this._attach(dev.id);
  }
  async signOut() { try { await this.music?.unauthorize(); } catch {} store.setAuth('apple', null); if (REMOTE.test(store.getZone(this.id) || '')) store.setZone(this.id, null); this._detach(); }
}
