// Spotify Web API provider (Authorization Code + PKCE, no server needed).
// Uses the post-February-2026 API: playlist `items` (not `tracks`), search limit ≤ 10.
import { Provider } from './base.js';
import { store } from '../core/store.js';
import { http, HttpError, qs, randomString, sha256base64url, sleep } from '../core/util.js';

const AUTH = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1/';
const SCOPES = [
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'playlist-read-private', 'playlist-read-collaborative', 'user-library-read',
].join(' ');
const STATE = 'rr-spotify';

export function redirectUri() { return location.origin + location.pathname; }

export class SpotifyProvider extends Provider {
  constructor(meta) {
    super(meta);
    Object.assign(this.caps, { seek: true, volume: true, next: true, prev: true, playlists: true, search: true, devices: true, shuffle: true, repeat: true });
    this.timer = null;
    this.refreshing = null;
    this.backoffUntil = 0;
  }
  get clientId() { return (store.get('spotifyClientId') || '').trim(); }
  setupHint() { return this.clientId ? '' : 'Add your Spotify Client ID in Settings.'; }
  isAuthed() { return !!store.auth('spotify')?.refresh; }

  // ---------- auth ----------
  async connect() {
    if (!this.clientId) throw new Error('Spotify Client ID missing (Settings → Spotify).');
    const verifier = randomString(96);
    store.temp('spotify_verifier', verifier);
    const challenge = await sha256base64url(verifier);
    location.href = `${AUTH}/authorize?${qs({
      response_type: 'code', client_id: this.clientId, scope: SCOPES, redirect_uri: redirectUri(),
      code_challenge_method: 'S256', code_challenge: challenge, state: STATE,
    })}`;
  }
  async handleRedirect(params) {
    if (params.get('state') !== STATE) return false;
    if (params.get('error')) throw new Error(`Spotify sign-in cancelled (${params.get('error')})`);
    const code = params.get('code');
    const verifier = store.temp('spotify_verifier');
    const res = await http(`${AUTH}/api/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier }),
    });
    store.temp('spotify_verifier', null);
    this._saveToken(res);
    return true;
  }
  _saveToken(res) {
    const prev = store.auth('spotify') || {};
    store.setAuth('spotify', {
      access: res.access_token,
      refresh: res.refresh_token || prev.refresh,
      expiresAt: Date.now() + (res.expires_in || 3600) * 1000,
    });
  }
  async _refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const a = store.auth('spotify');
      if (!a?.refresh) throw new Error('Not signed in to Spotify');
      try {
        const res = await http(`${AUTH}/api/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: this.clientId, grant_type: 'refresh_token', refresh_token: a.refresh }),
        });
        this._saveToken(res);
      } catch (e) {
        if (e.status === 400 || e.status === 401) { store.setAuth('spotify', null); this.emit('signedout'); }
        throw e;
      }
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async _token() {
    const a = store.auth('spotify');
    if (!a) throw new Error('Not signed in to Spotify');
    if (!a.access || Date.now() > a.expiresAt - 60000) await this._refresh();
    return store.auth('spotify').access;
  }
  async api(path, { method = 'GET', json, retry = true } = {}) {
    const token = await this._token();
    try {
      return await http(API + path, { method, json, headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      if (e.status === 401 && retry) { await this._refresh(); return this.api(path, { method, json, retry: false }); }
      if (e.status === 429) {
        this.backoffUntil = Date.now() + 5000;
        throw Object.assign(new Error('Spotify is rate limiting — slowing down'), { userMessage: 'Spotify rate limit — slowing down' });
      }
      const reason = e.body?.error?.reason || e.body?.error?.message || '';
      if (/NO_ACTIVE_DEVICE/i.test(reason) || e.status === 404) {
        throw Object.assign(e, { userMessage: 'No active Spotify device — pick one in Devices', code: 'NO_DEVICE' });
      }
      if (/PREMIUM/i.test(reason)) throw Object.assign(e, { userMessage: 'Spotify Premium is required for remote control' });
      if (e.status === 403 && /restrict|disallow/i.test(reason)) throw Object.assign(e, { userMessage: 'Not allowed right now (e.g. ad or restricted track)' });
      throw Object.assign(e, { userMessage: `Spotify: ${reason || e.message}` });
    }
  }

  // ---------- state ----------
  async start() {
    this.publish({ status: 'loading' });
    await this.refresh().catch(() => {});
    const loop = async () => {
      const hidden = document.hidden;
      const wait = hidden ? 10000 : Math.max(1000, store.get('pollMs') || 2000);
      this.timer = setTimeout(async () => {
        if (Date.now() >= this.backoffUntil) await this.refresh().catch((e) => console.info('spotify poll', e.message));
        if (this.timer) loop();
      }, wait);
    };
    loop();
  }
  stop() { clearTimeout(this.timer); this.timer = null; }

  async refresh() {
    const d = await this.api('me/player?additional_types=episode');
    if (!d || !d.item) {
      this.publish({ track: null, isPlaying: false, progressMs: 0, status: 'nodevice', device: d?.device ? this._dev(d.device) : null,
        message: d?.device ? 'Nothing playing' : 'Open Spotify on any device, or pick one in Devices' });
      return;
    }
    const it = d.item;
    const isEp = it.type === 'episode';
    const images = isEp ? (it.images || it.show?.images || []) : (it.album?.images || []);
    this.caps.volume = d.device?.supports_volume !== false;
    this.publish({
      track: {
        id: it.id || it.uri, uri: it.uri, title: it.name,
        artist: isEp ? (it.show?.name || '') : (it.artists || []).map((a) => a.name).join(', '),
        album: isEp ? (it.show?.publisher || '') : (it.album?.name || ''),
        art: images[0]?.url || '', durationMs: it.duration_ms, albumUri: it.album?.uri,
      },
      isPlaying: !!d.is_playing,
      progressMs: d.progress_ms || 0,
      volume: d.device?.volume_percent ?? null,
      device: d.device ? this._dev(d.device) : null,
      shuffle: !!d.shuffle_state,
      repeat: { off: 'off', context: 'all', track: 'one' }[d.repeat_state] || 'off',
      status: 'ok', message: '',
    });
    if (d.device?.id) store.setZone('spotify', d.device.id);
  }
  _dev(d) { return { id: d.id, name: d.name, type: d.type }; }

  // ---------- transport ----------
  async _withDevice(fn) {
    try { return await fn(); } catch (e) {
      if (e.code !== 'NO_DEVICE') throw e;
      // Nothing active: wake the last used (or first available) device and retry.
      const { devices = [] } = (await this.api('me/player/devices')) || {};
      const want = store.getZone('spotify');
      const dev = devices.find((d) => d.id === want) || devices[0];
      if (!dev) throw e;
      await this.api('me/player', { method: 'PUT', json: { device_ids: [dev.id], play: false } });
      await sleep(700);
      return fn();
    }
  }
  play() { return this._withDevice(() => this.api('me/player/play', { method: 'PUT' })); }
  pause() { return this.api('me/player/pause', { method: 'PUT' }); }
  next() { return this.api('me/player/next', { method: 'POST' }); }
  prev() { return this.api('me/player/previous', { method: 'POST' }); }
  seek(ms) { return this.api(`me/player/seek?position_ms=${Math.round(ms)}`, { method: 'PUT' }); }
  setVolume(v) { return this.api(`me/player/volume?volume_percent=${Math.round(v)}`, { method: 'PUT' }); }
  setShuffle(on) { return this.api(`me/player/shuffle?state=${!!on}`, { method: 'PUT' }); }
  setRepeat(m) { return this.api(`me/player/repeat?state=${{ off: 'off', all: 'context', one: 'track' }[m] || 'off'}`, { method: 'PUT' }); }

  // ---------- library ----------
  async getPlaylists() {
    const out = [{ id: 'liked', name: 'Liked Songs', subtitle: 'Your library', art: '', mono: '♥', liked: true }];
    let url = 'me/playlists?limit=50';
    for (let page = 0; url && page < 4; page++) {
      const d = await this.api(url);
      for (const p of d?.items || []) {
        if (!p) continue;
        const count = p.items?.total ?? p.tracks?.total;
        out.push({ id: p.id, uri: p.uri, name: p.name, art: p.images?.[0]?.url || '',
          subtitle: [p.owner?.display_name, count != null ? `${count} songs` : ''].filter(Boolean).join(' · ') });
      }
      url = d?.next ? d.next.replace(API, '') : null;
    }
    return out;
  }
  async playPlaylist(pl) {
    if (pl.liked) {
      const d = await this.api('me/tracks?limit=50');
      const uris = (d?.items || []).map((x) => x.track?.uri).filter(Boolean);
      if (!uris.length) throw new Error('No liked songs');
      return this._withDevice(() => this.api('me/player/play', { method: 'PUT', json: { uris } }));
    }
    return this._withDevice(() => this.api('me/player/play', { method: 'PUT', json: { context_uri: pl.uri } }));
  }
  async search(q) {
    const d = await this.api(`search?${qs({ q, type: 'track,album,playlist', limit: 10 })}`);
    const tracks = (d?.tracks?.items || []).filter(Boolean).map((t) => ({
      kind: 'track', id: t.id, uri: t.uri, albumUri: t.album?.uri, title: t.name,
      subtitle: `${t.artists.map((a) => a.name).join(', ')} · ${t.album?.name || ''}`, art: t.album?.images?.at(-1)?.url || t.album?.images?.[0]?.url || '',
    }));
    const albums = (d?.albums?.items || []).filter(Boolean).slice(0, 4).map((a) => ({
      kind: 'album', id: a.id, uri: a.uri, title: a.name, subtitle: `Album · ${a.artists.map((x) => x.name).join(', ')}`, art: a.images?.at(-1)?.url || '',
    }));
    const pls = (d?.playlists?.items || []).filter(Boolean).slice(0, 4).map((p) => ({
      kind: 'playlist', id: p.id, uri: p.uri, title: p.name, subtitle: `Playlist · ${p.owner?.display_name || ''}`, art: p.images?.[0]?.url || '',
    }));
    return [...tracks, ...albums, ...pls];
  }
  async playItem(item) {
    let body;
    if (item.kind === 'track') body = item.albumUri ? { context_uri: item.albumUri, offset: { uri: item.uri } } : { uris: [item.uri] };
    else body = { context_uri: item.uri };
    return this._withDevice(() => this.api('me/player/play', { method: 'PUT', json: body }));
  }
  async getDevices() {
    const d = await this.api('me/player/devices');
    return (d?.devices || []).map((x) => ({ id: x.id, name: x.name, type: x.type, active: x.is_active, volume: x.volume_percent }));
  }
  async selectDevice(dev) {
    await this.api('me/player', { method: 'PUT', json: { device_ids: [dev.id], play: this.state.isPlaying || undefined } });
    store.setZone('spotify', dev.id);
  }
  signOut() { store.setAuth('spotify', null); }
}
