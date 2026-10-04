// Jellyfin provider: remote-controls any Jellyfin client session (web, Finamp, Jellyfin
// Media Player, Kodi…) through the server's Sessions API. Sign in with Quick Connect
// (no typing on the round screen) or username/password.
import { Provider } from './base.js';
import { store } from '../core/store.js';
import { http, HttpError, qs, uid, sleep, isMixed, lanImage } from '../core/util.js';
import { bridgeBase } from './bridge.js';

const T = 10000; // ticks per ms

function deviceId() {
  let id = store.temp('deviceId');
  if (!id) { id = 'rr-' + uid(12); store.temp('deviceId', id); }
  return id;
}

export class JellyfinProvider extends Provider {
  constructor(meta) {
    super(meta);
    Object.assign(this.caps, { seek: true, volume: true, next: true, prev: true, playlists: true, search: true, devices: true, shuffle: true, repeat: true });
    this.sessions = [];
    this.timer = null;
    this.proxy = null;
  }
  get server() { return (store.get('jellyfinServer') || '').trim().replace(/\/$/, ''); }
  get auth() { return store.auth('jellyfin'); }
  setupHint() { return this.server ? '' : 'Enter your Jellyfin server address.'; }
  isAuthed() { return !!this.auth?.token && this.auth.server === this.server; }

  _authHeader(token) {
    const parts = [`Client="Round Remote"`, `Device="Round Display"`, `DeviceId="${deviceId()}"`, `Version="2.0.0"`];
    if (token) parts.push(`Token="${token}"`);
    return { Authorization: `MediaBrowser ${parts.join(', ')}` };
  }
  // An https page (GitHub Pages) talking to an http:// Jellyfin server: try Chrome's Local
  // Network Access first (one-time permission prompt), and fall back to the bridge's LAN proxy.
  async _proxyUrl(full) {
    const b = this.proxy || (this.proxy = await bridgeBase());
    if (!b) throw Object.assign(new Error('mixed content'), {
      userMessage: 'Your browser blocked the http:// Jellyfin server. Use Chrome (allow local network access), an https:// address, or run the bridge.',
    });
    return `${b}/api/proxy?${qs({ url: full })}`;
  }
  async api(path, { method = 'GET', json, token = this.auth?.token } = {}) {
    const full = this.server + path;
    const opts = { method, json, headers: { ...this._authHeader(token), Accept: 'application/json' } };
    if (!isMixed(full) || this.route === 'proxy') return http(isMixed(full) ? await this._proxyUrl(full) : full, opts);
    try {
      const r = await http(full, opts);
      this.route = 'direct';
      return r;
    } catch (e) {
      if (e instanceof HttpError || this.route === 'direct') throw e;
      const proxied = await this._proxyUrl(full); // network/mixed-content failure → bridge
      this.route = 'proxy';
      return http(proxied, opts);
    }
  }
  async img(itemId, tag, size = 600) {
    if (!itemId) return '';
    const full = `${this.server}/Items/${itemId}/Images/Primary?${qs({ maxHeight: size, maxWidth: size, tag, quality: 90 })}`;
    if (!isMixed(full)) return full;
    if (this.route === 'proxy') return this._proxyUrl(full).catch(() => '');
    return lanImage(full);
  }

  // ---------- auth ----------
  async quickConnectStart() {
    let r;
    try { r = await this.api('/QuickConnect/Initiate', { method: 'POST', token: null }); }
    catch { r = await this.api('/QuickConnect/Initiate', { token: null }); }
    return { code: r.Code, secret: r.Secret };
  }
  /** Poll until approved (or aborted). */
  async quickConnectWait(secret, signal) {
    while (!signal?.aborted) {
      await sleep(2500);
      const s = await this.api(`/QuickConnect/Connect?${qs({ secret })}`, { token: null }).catch(() => null);
      if (s?.Authenticated) {
        const a = await this.api('/Users/AuthenticateWithQuickConnect', { method: 'POST', json: { Secret: secret }, token: null });
        this._save(a); return true;
      }
    }
    return false;
  }
  async login(username, password) {
    const a = await this.api('/Users/AuthenticateByName', { method: 'POST', json: { Username: username, Pw: password }, token: null });
    this._save(a);
  }
  _save(a) { store.setAuth('jellyfin', { token: a.AccessToken, userId: a.User?.Id, user: a.User?.Name, server: this.server }); }
  async signOut() {
    try { await this.api('/Sessions/Logout', { method: 'POST' }); } catch {}
    store.setAuth('jellyfin', null);
  }

  // ---------- state ----------
  async start() {
    this.publish({ status: 'loading' });
    await this.refresh().catch((e) => this.publish({ status: 'error', message: e.message }));
    const loop = () => { this.timer = setTimeout(async () => { await this.refresh().catch(() => {}); if (this.timer) loop(); }, document.hidden ? 8000 : Math.max(1500, store.get('pollMs'))); };
    loop();
  }
  stop() { clearTimeout(this.timer); this.timer = null; }

  async _sessions() {
    const list = await this.api(`/Sessions?${qs({ ControllableByUserId: this.auth.userId, ActiveWithinSeconds: 960 })}`);
    this.sessions = (list || []).filter((s) => s.SupportsRemoteControl && s.DeviceId !== deviceId());
    return this.sessions;
  }
  _pick() {
    const want = store.getZone(this.id);
    const ss = this.sessions;
    return ss.find((s) => s.Id === want)
      || ss.find((s) => s.NowPlayingItem?.MediaType === 'Audio' && !s.PlayState?.IsPaused)
      || ss.find((s) => s.NowPlayingItem?.MediaType === 'Audio')
      || ss.find((s) => s.NowPlayingItem) || ss[0] || null;
  }
  async refresh() {
    await this._sessions();
    const s = this.session = this._pick();
    if (!s) { this.publish({ track: null, isPlaying: false, device: null, status: 'nodevice', message: 'Open a Jellyfin app (web, Finamp, JMP…) to control it' }); return; }
    const it = s.NowPlayingItem, ps = s.PlayState || {};
    const cmds = s.SupportedCommands || [];
    this.caps.volume = cmds.includes('SetVolume') || cmds.length === 0;
    this.caps.repeat = cmds.includes('SetRepeatMode');
    this.caps.shuffle = cmds.includes('SetShuffleQueue');
    const device = { id: s.Id, name: `${s.DeviceName}`, type: s.Client };
    if (!it) { this.publish({ track: null, isPlaying: false, device, volume: ps.VolumeLevel ?? null, status: 'nodevice', message: `${s.DeviceName} is idle — pick something to play` }); return; }
    this.publish({
      track: {
        id: it.Id, title: it.Name, artist: (it.Artists || []).join(', ') || it.AlbumArtist || '',
        album: it.Album || '', durationMs: (it.RunTimeTicks || 0) / T, year: it.ProductionYear || null,
        art: await this.img(it.AlbumId || it.Id, it.AlbumPrimaryImageTag || it.ImageTags?.Primary),
      },
      isPlaying: !ps.IsPaused, progressMs: (ps.PositionTicks || 0) / T,
      volume: ps.VolumeLevel ?? null, muted: !!ps.IsMuted,
      shuffle: ps.PlaybackOrder ? ps.PlaybackOrder === 'Shuffle' : (ps.ShuffleMode ? ps.ShuffleMode === 'Shuffle' : null),
      repeat: { RepeatNone: 'off', RepeatAll: 'all', RepeatOne: 'one' }[ps.RepeatMode] || 'off',
      device, status: 'ok', message: '',
    });
  }

  // ---------- transport ----------
  _s() { if (!this.session) throw Object.assign(new Error('No session'), { userMessage: 'No Jellyfin player selected' }); return this.session.Id; }
  _playing(cmd, q = '') { return this.api(`/Sessions/${this._s()}/Playing/${cmd}${q}`, { method: 'POST' }); }
  _general(Name, Arguments = {}) { return this.api(`/Sessions/${this._s()}/Command`, { method: 'POST', json: { Name, Arguments } }); }
  play() { return this._playing('Unpause'); }
  pause() { return this._playing('Pause'); }
  next() { return this._playing('NextTrack'); }
  prev() { return this._playing('PreviousTrack'); }
  seek(ms) { return this._playing('Seek', `?${qs({ seekPositionTicks: Math.round(ms * T) })}`); }
  setVolume(v) { return this._general('SetVolume', { Volume: String(v) }); }
  setShuffle(on) { return this._general('SetShuffleQueue', { ShuffleMode: on ? 'Shuffle' : 'Sorted' }); }
  setRepeat(m) { return this._general('SetRepeatMode', { RepeatMode: { off: 'RepeatNone', all: 'RepeatAll', one: 'RepeatOne' }[m] }); }

  async _items(params) {
    const u = this.auth.userId;
    try { return await this.api(`/Items?${qs({ userId: u, Recursive: true, ...params })}`); }
    catch { return this.api(`/Users/${u}/Items?${qs({ Recursive: true, ...params })}`); }
  }
  async getPlaylists() {
    const r = await this._items({ IncludeItemTypes: 'Playlist', SortBy: 'SortName', Fields: 'ChildCount', Limit: 200 });
    const items = (r?.Items || []).filter((p) => !p.MediaType || p.MediaType === 'Audio');
    return Promise.all(items.map(async (p) => ({
      id: p.Id, name: p.Name, subtitle: p.ChildCount != null ? `${p.ChildCount} songs` : 'Playlist',
      art: p.ImageTags?.Primary ? await this.img(p.Id, p.ImageTags.Primary, 120) : '',
    })));
  }
  playPlaylist(pl) { return this._playNow([pl.id]); }
  _playNow(ids) { return this.api(`/Sessions/${this._s()}/Playing?${qs({ playCommand: 'PlayNow', itemIds: ids.join(',') })}`, { method: 'POST' }); }
  async search(q) {
    const r = await this._items({ searchTerm: q, IncludeItemTypes: 'Audio,MusicAlbum,Playlist', Limit: 25 });
    return Promise.all((r?.Items || []).map(async (x) => ({
      kind: x.Type === 'Audio' ? 'track' : x.Type === 'MusicAlbum' ? 'album' : 'playlist',
      id: x.Id, title: x.Name,
      subtitle: x.Type === 'Audio' ? `${(x.Artists || []).join(', ')} · ${x.Album || ''}` : x.Type === 'MusicAlbum' ? `Album · ${x.AlbumArtist || ''}` : 'Playlist',
      art: await this.img(x.AlbumId || x.Id, x.AlbumPrimaryImageTag || x.ImageTags?.Primary, 120),
    })));
  }
  playItem(item) { return this._playNow([item.id]); }
  async getDevices() {
    await this._sessions();
    const cur = this.session?.Id;
    return this.sessions.map((s) => ({ id: s.Id, name: s.DeviceName, type: `${s.Client}${s.NowPlayingItem ? ' · playing' : ''}`, active: s.Id === cur, volume: s.PlayState?.VolumeLevel }));
  }
  async selectDevice(dev) { store.setZone(this.id, dev.id); await this.refresh(); }

  /** URL of the track's original audio file, for the Rhythm games to analyse it offline (bridge LAN proxy for http servers on https pages). */
  async analysisUrl(track) {
    if (!track?.id || !this.auth?.token) return null;
    const full = `${this.server}/Audio/${track.id}/stream?${qs({ static: 'true', api_key: this.auth.token })}`;
    if (isMixed(full)) { try { return await this._proxyUrl(full); } catch { return full; } }
    return full;
  }

  async getLyrics(track) {
    try {
      const r = await this.api(`/Audio/${track.id}/Lyrics`);
      const L = r?.Lyrics || [];
      if (!L.length) return null;
      const synced = L.some((l) => l.Start != null && l.Start > 0);
      if (!synced) return null; // let LRCLIB try for synced lyrics
      return { synced: true, source: 'Jellyfin', lines: L.map((l) => ({ t: (l.Start || 0) / T, text: l.Text || '', words: null })) };
    } catch { return null; }
  }
}
