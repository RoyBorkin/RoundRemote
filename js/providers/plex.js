// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Plex provider — controls Plexamp (incl. Plexamp headless on a Pi) and Plex apps that
// advertise as players, via your Plex Media Server. Sign-in uses a plex.tv PIN: either
// type the 4-character code at plex.tv/link on your phone, or sign in on this screen.
import { Provider } from './base.js';
import { store, pollMs } from '../core/store.js';
import { http, qs, uid, sleep } from '../core/util.js';
import { bridgeBase, bridgeFetch, bridgeZones } from './bridge.js';
import { directZones, directKey } from '../core/tvapp.js';

const PLEX_TV = 'https://plex.tv/api/v2';
const PRODUCT = 'Round Remote';

function clientId() {
  let id = store.temp('plexClientId');
  if (!id) { id = 'rr-' + uid(16); store.temp('plexClientId', id); }
  return id;
}
const baseHeaders = (token) => ({
  Accept: 'application/json',
  'X-Plex-Product': PRODUCT, 'X-Plex-Version': '2.0.0', 'X-Plex-Client-Identifier': clientId(),
  'X-Plex-Device-Name': 'Round Display', 'X-Plex-Platform': 'Web',
  ...(token ? { 'X-Plex-Token': token } : {}),
});

export class PlexProvider extends Provider {
  constructor(meta) {
    super(meta);
    Object.assign(this.caps, { seek: true, volume: true, next: true, prev: true, playlists: true, search: true, devices: true, shuffle: true, repeat: true });
    this.server = null;   // { id, name, uri, token }
    this.players = [];
    this.cmdId = 1;
    this.timer = null;
    this.tick = 0;
    this.timeline = {};
    this.ctype = 'music';   // Plex Companion command type: music (Plexamp) | video (Movies & Shows)
  }
  get token() { return store.auth('plex')?.token; }
  isAuthed() { return !!this.token; }

  // ---------- auth ----------
  async pinStart(strong = false) {
    const p = await http(`${PLEX_TV}/pins?${qs({ strong })}`, { method: 'POST', headers: baseHeaders() });
    return { id: p.id, code: p.code };
  }
  async pinWait(id, signal) {
    while (!signal?.aborted) {
      await sleep(2000);
      const p = await http(`${PLEX_TV}/pins/${id}`, { headers: baseHeaders() }).catch(() => null);
      if (p?.authToken) { store.setAuth('plex', { token: p.authToken }); return true; }
      if (p && p.expiresIn != null && p.expiresIn <= 0) throw new Error('Code expired — try again');
    }
    return false;
  }
  async connect() {
    // "Sign in on this screen": redirect to Plex, come back with ?plexpin=
    const { id, code } = await this.pinStart(true);
    store.temp('plex_pin', String(id));
    store.temp('plex_return', this.id); // which tile (music Plex or Movies & Shows Plex) to open afterwards
    const forwardUrl = `${location.origin}${location.pathname.replace(/index\.html$/, '')}?plexpin=${id}`;
    location.href = `https://app.plex.tv/auth#?${qs({ clientID: clientId(), code, forwardUrl, 'context[device][product]': PRODUCT })}`;
  }
  async handleRedirect(params) {
    const id = params.get('plexpin');
    if (!id) return false;
    if ((store.temp('plex_return') || 'plex') !== this.id) return false;
    store.temp('plex_return', null);
    const p = await http(`${PLEX_TV}/pins/${id}`, { headers: baseHeaders() });
    if (!p?.authToken) throw new Error('Plex sign-in was not completed');
    store.setAuth('plex', { token: p.authToken });
    store.temp('plex_pin', null);
    return true;
  }
  signOut() { store.setAuth('plex', null); this.server = null; }

  // ---------- discovery ----------
  async _resources() {
    return http(`${PLEX_TV}/resources?${qs({ includeHttps: 1, includeRelay: 1 })}`, { headers: baseHeaders(this.token) });
  }
  async _probe(uri, token) {
    try { await http(await this._url(`${uri}/identity`), { headers: baseHeaders(token), timeout: 3500 }); return true; } catch { return false; }
  }
  /** Full URL → fetchable URL. Mixed content (https page → http server) goes via the bridge's LAN proxy. */
  async _url(full) {
    if (location.protocol === 'https:' && full.startsWith('http:')) {
      if (this.proxyBase === undefined) this.proxyBase = await bridgeBase();
      if (this.proxyBase) return `${this.proxyBase}/api/proxy?${qs({ url: full })}`;
    }
    return full;
  }
  _urlSync(full) {
    if (location.protocol === 'https:' && full.startsWith('http:') && this.proxyBase) return `${this.proxyBase}/api/proxy?${qs({ url: full })}`;
    return full;
  }
  async _connectServer() {
    const res = await this._resources();
    this.resources = res || [];
    const servers = this.resources.filter((r) => (r.provides || '').includes('server'));
    if (!servers.length) throw new Error('No Plex Media Server found on your account');
    const want = store.get('plexServerId');
    const ordered = [...servers].sort((a, b) => (b.clientIdentifier === want) - (a.clientIdentifier === want) || (b.owned - a.owned) || (b.presence - a.presence));
    for (const s of ordered) {
      const conns = [...(s.connections || [])].sort((a, b) =>
        (a.relay - b.relay) || ((b.protocol === 'https') - (a.protocol === 'https')) || (b.local - a.local));
      for (const c of conns) {
        const uri = c.uri;
        if (await this._probe(uri, s.accessToken || this.token)) {
          const u = new URL(c.uri);
          this.server = { id: s.clientIdentifier, name: s.name, uri, token: s.accessToken || this.token,
            address: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), protocol: u.protocol.replace(':', '') };
          store.set('plexServerId', s.clientIdentifier);
          return this.server;
        }
      }
    }
    throw new Error('Could not reach your Plex server');
  }
  async pms(path, { method = 'GET', headers = {} } = {}) {
    if (!this.server) await this._connectServer();
    return http(await this._url(this.server.uri + path), { method, headers: { ...baseHeaders(this.server.token), ...headers } });
  }
  _thumb(path, size = 600) {
    if (!path) return '';
    return this._urlSync(`${this.server.uri}/photo/:/transcode?${qs({ width: size, height: size, minSize: 1, upscale: 1, url: path, 'X-Plex-Token': this.server.token })}`);
  }

  // ---------- state ----------
  async start() {
    this.publish({ status: 'loading', message: 'Connecting to Plex…' });
    try { await this._connectServer(); } catch (e) { this.publish({ status: 'error', message: e.message }); }
    await this.refresh().catch(() => {});
    const loop = () => { this.timer = setTimeout(async () => { await this.refresh().catch(() => {}); if (this.timer) loop(); }, document.hidden ? 8000 : Math.max(1500, pollMs())); };
    loop();
  }
  stop() { clearTimeout(this.timer); this.timer = null; }

  async _sessions() {
    const d = await this.pms('/status/sessions');
    return (d?.MediaContainer?.Metadata || []).filter((m) => m.type === 'track');
  }
  _pick(sessions) {
    const want = store.getZone(this.id);
    return sessions.find((m) => m.Player?.machineIdentifier === want)
      || sessions.find((m) => m.Player?.state === 'playing') || sessions[0] || null;
  }
  async refresh() {
    if (!this.server) await this._connectServer();
    const sessions = await this._sessions();
    this.sessionsCache = sessions;
    const m = this._pick(sessions);
    const wantId = store.getZone(this.id);
    this.playerId = m?.Player?.machineIdentifier || wantId || null;
    if (this.playerId && this.tick++ % 2 === 0) this._pollTimeline().catch(() => {});
    if (this.tick % 15 === 1) this.pms('/clients').then((d) => { this.clientsCache = d?.MediaContainer?.Server || []; }).catch(() => {});
    if (!m) {
      this.publish({ track: null, isPlaying: false, status: 'nodevice', device: this.playerId ? { id: this.playerId, name: this._playerName(this.playerId) } : null,
        message: 'Start Plexamp (or pick a player in Devices)' });
      return;
    }
    const tl = this.timeline;
    this.publish({
      track: {
        id: m.ratingKey, title: m.title, artist: m.originalTitle || m.grandparentTitle || '', album: m.parentTitle || '',
        durationMs: m.duration || 0, art: this._thumb(m.parentThumb || m.thumb || m.grandparentThumb), key: m.key,
        year: m.parentYear || m.year || null, part: m.Media?.[0]?.Part?.[0]?.key || null,   // the audio file (Rhythm learns from it)
      },
      isPlaying: m.Player?.state === 'playing' || m.Player?.state === 'buffering',
      progressMs: m.viewOffset || 0,
      volume: tl.volume ?? null, shuffle: tl.shuffle ?? null, repeat: tl.repeat ?? null,
      device: { id: m.Player?.machineIdentifier, name: m.Player?.title || 'Plex player', type: m.Player?.product },
      status: 'ok', message: '',
    });
  }
  _playerName(id) {
    const p = (this.sessionsCache || []).find((m) => m.Player?.machineIdentifier === id)?.Player;
    const r = (this.resources || []).find((x) => x.clientIdentifier === id);
    return p?.title || r?.name || 'The Plex player';
  }
  async _pollTimeline() {
    const xml = await this._player('timeline/poll', { wait: 0 }, true);
    if (typeof xml !== 'string') return;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const t = doc.querySelector(`Timeline[type="${this.ctype}"]`);
    if (!t) return;
    const num = (a) => (t.getAttribute(a) != null ? +t.getAttribute(a) : undefined);
    this.timeline = {
      volume: num('volume'),
      shuffle: t.getAttribute('shuffle') != null ? t.getAttribute('shuffle') === '1' : undefined,
      repeat: t.getAttribute('repeat') != null ? ['off', 'one', 'all'][+t.getAttribute('repeat')] : undefined,
      audioStreamID: t.getAttribute('audioStreamID') || undefined,
      subtitleStreamID: t.getAttribute('subtitleStreamID') ?? undefined,
    };
  }

  // ---------- commands ----------
  /**
   * Where Plex Companion commands can go, best first: through your Plex server (it relays to the app), or
   * straight to the player app on the TV (port 32500 — through the bridge, which avoids browser blocks).
   */
  _routes(id) {
    const routes = [];
    const add = (name, base, token) => { if (base && !routes.some((r) => r.base === base)) routes.push({ name, base: base.replace(/\/$/, ''), token }); };
    add('server', this.server.uri, this.server.token);
    const p = (this.sessionsCache || []).find((m) => m.Player?.machineIdentifier === id)?.Player;
    if (p?.address && p.local !== false) add('player', `http://${p.address}:32500`, this.server.token);
    const cl = (this.clientsCache || []).find((c) => c.machineIdentifier === id);
    if (cl) add('player', `${cl.protocol || 'http'}://${cl.address || cl.host}:${cl.port || 32500}`, this.server.token);
    const res = (this.resources || []).find((r) => r.clientIdentifier === id);
    for (const c of res?.connections || []) add('player', c.uri, res.accessToken || this.token);
    const good = this.goodRoute?.[id];
    if (good) routes.sort((a, b) => (b.base === good) - (a.base === good));
    return routes;
  }
  /** URLs to try for a route: a LAN player goes through the bridge first (no browser blocks), then directly. */
  async _routeUrls(r, path) {
    const full = `${r.base}${path}`;
    if (r.name === 'player' && full.startsWith('http:')) {
      if (this.proxyBase === undefined) this.proxyBase = await bridgeBase();
      const out = this.proxyBase ? [`${this.proxyBase}/api/proxy?${qs({ url: full })}`] : [];
      if (location.protocol !== 'https:') out.push(full);
      return out.length ? out : [await this._url(full)];
    }
    return [await this._url(full)];
  }
  async _send(r, path, timeout) {
    let last;
    for (const u of await this._routeUrls(r, path)) {
      try { return await http(u, { headers: { ...baseHeaders(r.token), 'X-Plex-Target-Client-Identifier': this.playerId }, timeout }); }
      catch (e) { last = e; if (e.status && e.status !== 502) throw e; }   // the player answered with an error: no point trying the other way
    }
    throw last;
  }
  /** Send a Plex Companion command to the selected player, trying each route until one answers. */
  async _player(cmd, params = {}, raw = false) {
    const id = this.playerId;
    if (!id) throw Object.assign(new Error('No player'), { userMessage: 'Pick a Plex player in Devices' });
    const q = qs({ type: this.ctype, ...params, commandID: this.cmdId++ });
    const routes = this._routes(id);
    const tried = [];
    // the timeline poll runs in the background: only the route that worked (or the server), and quickly
    for (const r of raw ? routes.slice(0, 1) : routes) {
      try {
        const out = await this._send(r, `/player/${cmd}?${q}`, raw ? 3000 : r.name === 'server' ? 6000 : 4000);
        (this.goodRoute ||= {})[id] = r.base;
        return out;
      } catch (e) { tried.push(`${r.name === 'server' ? 'via the server' : `direct ${r.base.replace(/^https?:\/\//, '')}`}: ${e.status ? `HTTP ${e.status}` : e.name === 'AbortError' ? 'no answer' : e.message}`); }
    }
    if (raw) return null;
    this.lastFailure = { cmd, tried, at: Date.now() };
    console.warn('[plex] command failed', cmd, tried);
    // the Plex app ignores remote control: use the TV's own remote (Google TV / Apple TV) for the basics
    if (await this._tvFallback(cmd, params).catch(() => false)) return null;
    throw Object.assign(new Error('Plex player did not respond'), {
      tried, userMessage: `${this._playerName(id)} didn’t take the command. In the Plex app on the TV turn on Settings → Advanced → “Advertise as player”.`,
    });
  }
  /** The paired Google TV / Apple TV that is this Plex player (same address, or same name). */
  async _matchTv() {
    const zones = [...await bridgeZones((z) => z.adapter === 'androidtv' || z.adapter === 'appletv'), ...directZones()];
    if (!zones.length) return null;
    const p = (this.sessionsCache || []).find((m) => m.Player?.machineIdentifier === this.playerId)?.Player || {};
    const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9א-ת]/g, '');
    const name = norm(p.title || this._playerName(this.playerId));
    return zones.find((z) => p.address && z.localId === p.address)
      || zones.find((z) => name && norm(z.name) && (norm(z.name).includes(name) || name.includes(norm(z.name))))
      || (zones.length === 1 ? zones[0] : null);
  }
  async _tvFallback(cmd, params) {
    const keys = { 'playback/play': 'play', 'playback/pause': 'pause', 'playback/skipNext': 'next', 'playback/skipPrevious': 'prev', 'playback/stop': 'stop', 'playback/stepForward': 'forward', 'playback/stepBack': 'rewind' };
    let key = keys[cmd];
    if (cmd === 'playback/seekTo') key = params.offset >= (this.state.progressMs || 0) ? 'forward' : 'rewind';
    if (!key) return false;
    const tv = await this._matchTv();
    if (!tv) return false;
    if (tv.direct) await directKey(tv, key);
    else await bridgeFetch(`/api/adapters/${tv.adapter}/key`, { method: 'POST', json: { id: tv.id, key } });
    if (!this.fallbackNoted) {
      this.fallbackNoted = true;
      this.emit('notice', `Using the ${tv.name} remote — for full control turn on “Advertise as player” in the Plex app on the TV`);
    }
    return true;
  }
  /** Try every route with a harmless command and report what answered (Options → Test the player). */
  async testPlayer() {
    const id = this.playerId;
    if (!id) return { name: '', results: [], tv: null };
    try { this.clientsCache = (await this.pms('/clients'))?.MediaContainer?.Server || this.clientsCache; } catch {}
    const results = [];
    for (const r of this._routes(id)) {
      const t0 = performance.now();
      try {
        await this._send(r, `/player/timeline/poll?${qs({ wait: 0, type: this.ctype, commandID: this.cmdId++ })}`, 5000);
        results.push({ route: r.name === 'server' ? 'Through your Plex server' : `Straight to ${r.base.replace(/^https?:\/\//, '')}`, ok: true, detail: `${Math.round(performance.now() - t0)} ms` });
        (this.goodRoute ||= {})[id] ||= r.base;
      } catch (e) {
        results.push({ route: r.name === 'server' ? 'Through your Plex server' : `Straight to ${r.base.replace(/^https?:\/\//, '')}`, ok: false, detail: e.status ? `HTTP ${e.status}` : e.name === 'AbortError' ? 'no answer' : e.message });
      }
    }
    const tv = await this._matchTv().catch(() => null);
    return { name: this._playerName(id), results, tv: tv?.name || null };
  }
  play() { return this._player('playback/play'); }
  pause() { return this._player('playback/pause'); }
  next() { return this._player('playback/skipNext'); }
  prev() { return this._player('playback/skipPrevious'); }
  seek(ms) { return this._player('playback/seekTo', { offset: Math.round(ms) }); }
  setVolume(v) { this.timeline.volume = v; return this._player('playback/setParameters', { volume: Math.round(v) }); }
  setShuffle(on) { return this._player('playback/setParameters', { shuffle: on ? 1 : 0 }); }
  setRepeat(m) { return this._player('playback/setParameters', { repeat: { off: 0, one: 1, all: 2 }[m] ?? 0 }); }

  async _playQueue(params, offset = 0) {
    const d = await this.pms(`/playQueues?${qs({ type: this.ctype === 'video' ? 'video' : 'audio', shuffle: 0, continuous: this.ctype === 'video' ? 1 : 0, repeat: 0, own: 1, ...params })}`, { method: 'POST' });
    const mc = d?.MediaContainer;
    const sel = mc?.Metadata?.[mc.playQueueSelectedItemOffset || 0] || mc?.Metadata?.[0];
    if (!mc?.playQueueID || !sel) throw new Error('Plex could not build a play queue');
    return this._player('playback/playMedia', {
      key: sel.key, offset: Math.round(offset || 0), machineIdentifier: this.server.id,
      address: this.server.address, port: this.server.port, protocol: this.server.protocol,
      token: this.server.token, containerKey: `/playQueues/${mc.playQueueID}?window=100&own=1`,
    });
  }
  async getPlaylists() {
    const d = await this.pms(`/playlists?${qs({ playlistType: 'audio' })}`);
    return (d?.MediaContainer?.Metadata || []).map((p) => ({
      id: p.ratingKey, name: p.title, subtitle: p.leafCount != null ? `${p.leafCount} songs` : 'Playlist',
      art: this._thumb(p.composite || p.thumb, 120),
    }));
  }
  playPlaylist(pl) { return this._playQueue({ playlistID: pl.id }); }
  async search(q) {
    const d = await this.pms(`/hubs/search?${qs({ query: q, limit: 10 })}`);
    const out = [];
    for (const hub of d?.MediaContainer?.Hub || []) {
      if (!['track', 'album', 'playlist'].includes(hub.type)) continue;
      for (const x of hub.Metadata || []) {
        out.push({
          kind: hub.type, id: x.ratingKey, title: x.title,
          subtitle: hub.type === 'track' ? `${x.originalTitle || x.grandparentTitle || ''} · ${x.parentTitle || ''}` : hub.type === 'album' ? `Album · ${x.parentTitle || ''}` : 'Playlist',
          art: this._thumb(x.parentThumb || x.thumb || x.composite, 120),
        });
      }
    }
    const rank = { track: 0, album: 1, playlist: 2 };
    return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
  }
  playItem(item) {
    if (item.kind === 'playlist') return this.playPlaylist(item);
    return this._playQueue({ uri: `server://${this.server.id}/com.plexapp.plugins.library/library/metadata/${item.id}` });
  }
  async getDevices() {
    if (!this.server) await this._connectServer();
    const seen = new Map();
    for (const m of this.sessionsCache || []) {
      const p = m.Player; if (!p) continue;
      seen.set(p.machineIdentifier, { id: p.machineIdentifier, name: p.title, type: `${p.product} · ${p.state}` });
    }
    for (const r of (this.resources = await this._resources().catch(() => this.resources || [])) || []) {
      if (!(r.provides || '').includes('player') || seen.has(r.clientIdentifier)) continue;
      seen.set(r.clientIdentifier, { id: r.clientIdentifier, name: r.name, type: `${r.product}${r.presence ? '' : ' · offline'}` });
    }
    try {
      const d = await this.pms('/clients');
      this.clientsCache = d?.MediaContainer?.Server || [];
      for (const c of d?.MediaContainer?.Server || []) if (!seen.has(c.machineIdentifier)) seen.set(c.machineIdentifier, { id: c.machineIdentifier, name: c.name, type: c.product });
    } catch {}
    return [...seen.values()].map((d) => ({ ...d, active: d.id === this.playerId }));
  }
  async selectDevice(dev) { store.setZone(this.id, dev.id); this.playerId = dev.id; await this.refresh(); }

  /** URL of the track's full audio file, for the Rhythm games to analyse it offline (through the bridge's LAN proxy if needed). */
  async analysisUrl(track) {
    if (!track?.id) return null;
    if (!this.server) await this._connectServer();
    let part = track.part;
    if (!part) {
      const d = await this.pms(`/library/metadata/${track.id}`).catch(() => null);
      part = d?.MediaContainer?.Metadata?.[0]?.Media?.[0]?.Part?.[0]?.key || null;
    }
    if (!part) return null;
    return this._url(`${this.server.uri}${part}?${qs({ download: 0, 'X-Plex-Token': this.server.token })}`);
  }
}
