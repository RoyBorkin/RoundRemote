// Provider for everything that lives on your local network and needs the companion
// bridge (bridge/server.js): Roon, UPnP/DLNA, AirPlay (shairport-sync), Google Cast.
// Tidal and Qobuz have no public remote-control API, so their tiles attach to whichever
// bridge zone is playing Tidal/Qobuz (Roon, a Cast device, a UPnP renderer...).
import { Provider } from './base.js';
import { store } from '../core/store.js';
import { http, qs } from '../core/util.js';
import { directZones, directTvs, directKey, directLaunch, DIRECT_APPS } from '../core/tvapp.js';

let detected = null;       // cached bridge base URL
let detecting = null;

function fetchOpts(base) {
  // Chrome's Local Network Access lets an https page reach http://<LAN IP> when it opts in.
  try {
    const u = new URL(base);
    if (location.protocol === 'https:' && u.protocol === 'http:' && !/^(localhost|127\.)/.test(u.hostname)) return { targetAddressSpace: 'local' };
  } catch {}
  return {};
}

// On a public https site (GitHub Pages), probing localhost triggers Chrome's "local network
// access" prompt, so only do it passively once a bridge has been found or asked for.
export function mayProbe() {
  if (store.get('bridgeUrl') || store.get('bridgeKnown')) return true;
  const host = location.hostname;
  return location.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith('.local');
}

export async function bridgeBase({ force = false } = {}) {
  const manual = (store.get('bridgeUrl') || '').trim().replace(/\/$/, '');
  if (manual) return manual;
  if (detected && !force) return detected;
  if (detecting) return detecting;
  detecting = (async () => {
    const candidates = [];
    if (/^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname)) candidates.push(location.origin);
    candidates.push('http://localhost:8765', 'http://127.0.0.1:8765');
    for (const c of candidates) {
      try {
        const info = await http(`${c}/api/info`, { timeout: 1800, ...fetchOpts(c) });
        if (info?.app === 'roundremote-bridge') { detected = c; store.set('bridgeKnown', true); return c; }
      } catch {}
    }
    return null;
  })().finally(() => { detecting = null; });
  return detecting;
}

export async function bridgeFetch(path, opts = {}) {
  const base = await bridgeBase();
  if (!base) throw Object.assign(new Error('Bridge not found'), { userMessage: 'Bridge not reachable — is bridge/server.js running?' });
  return http(base + path, { timeout: 10000, ...fetchOpts(base), ...opts });
}

export async function bridgeInfo({ passive = false } = {}) {
  if (passive && !mayProbe()) return null;
  try { return await bridgeFetch('/api/info'); } catch { return null; }
}

/** Zones the bridge knows about right now (empty when there's no bridge). */
export async function bridgeZones(filter = () => true) {
  try { return ((await bridgeFetch('/api/zones')) || []).filter(filter); } catch { return []; }
}
const DESKTOP = ['cider', 'mpris', 'winmedia'];
/** Apple Music playing on a computer: Cider, Sidra, the Apple Music app for Windows, iTunes. */
export const isAppleZone = (z) => z.adapter === 'cider' || (DESKTOP.includes(z.adapter) && /apple music|itunes|cider|sidra/i.test(z.sourceApp || ''));
/** A web browser on a computer (YouTube / YouTube Music tabs). */
export const isBrowserZone = (z) => ['mpris', 'winmedia'].includes(z.adapter) && /chrom|edge|firefox|brave|opera|vivaldi|safari/i.test(z.sourceApp || '');

const SOURCE_MATCH = {
  tidal: /tidal/i,
  qobuz: /qobuz/i,
};

export class BridgeProvider extends Provider {
  /** @param meta  @param {{adapter?:string, source?:string}} opts */
  constructor(meta, { adapter = null, source = null, prefer = null, direct = false } = {}) {
    super(meta);
    this.direct = direct;       // also offer Google TVs controlled straight from this page (TV Remote app, no bridge)
    if (direct) store.on('change:tvDirect', () => this._ingest(this.zones.filter((z) => !z.direct)));
    this.prefer = prefer;       // zones to pick first when none was chosen (e.g. video for the Chromecast media tile)
    this.adapter = adapter;      // 'roon' | 'upnp' | 'airplay' | 'cast' | null (any)
    this.source = source;        // 'tidal' | 'qobuz' | null
    this.zones = [];
    this.zoneId = store.getZone(meta.id);
    this.es = null;
    this.pollT = null;
    this.base = null;
  }
  isAuthed() { return !this.direct || mayProbe() || directTvs().length > 0; }  // the bridge handles sign-in/pairing itself
  /** Zones that don't come from the bridge: Google TVs reached directly (see core/tvapp.js). */
  _extraZones() { return this.direct ? directZones().filter((z) => this._mine(z)) : []; }
  setupHint() { return ''; }

  _mine(z) {
    if (this.adapter && ![].concat(this.adapter).includes(z.adapter)) return false;
    return true;
  }
  _pickZone() {
    const zs = this.zones.filter((z) => this._mine(z));
    const re = this.source && SOURCE_MATCH[this.source];
    let z = zs.find((x) => x.id === this.zoneId);
    if (re) {
      const playingSrc = zs.find((x) => re.test(x.sourceApp || '') && x.state?.isPlaying) || zs.find((x) => re.test(x.sourceApp || ''));
      if (playingSrc && !this.userPicked && (!z || !re.test(z.sourceApp || ''))) z = playingSrc;
    }
    if (!z && this.prefer) z = zs.find((x) => this.prefer(x) && x.state?.isPlaying) || zs.find((x) => this.prefer(x));
    if (!z) z = zs.find((x) => x.state?.isPlaying) || zs[0] || null;
    return z;
  }
  _abs(u) { return u && u.startsWith('/') ? this.base + u : u; }
  _publishZone() {
    const z = this._pickZone();
    this.zone = z;
    if (!z) {
      const what = this.source ? `${this.name} playback on Roon, Cast, UPnP or AirPlay` : `${this.name} devices`;
      this.publish({ track: null, isPlaying: false, device: null, status: 'nodevice', message: `No ${what} found yet` });
      return;
    }
    this.zoneId = z.id;
    Object.assign(this.caps, { seek: false, volume: false, next: false, prev: false, playlists: false, search: false, shuffle: false, repeat: false, remote: false, stop: false, ...(z.caps || {}), devices: true });
    const s = z.state || {};
    const age = s.isPlaying && z.sampledAt ? Math.max(0, Date.now() - z.sampledAt) : 0;
    const t = s.track;
    this.publish({
      track: t ? { ...t, art: this._abs(t.art), ...(t.media ? { media: { ...t.media, poster: this._abs(t.media.poster), backdrop: this._abs(t.media.backdrop) } } : {}) } : null,
      isPlaying: !!s.isPlaying,
      progressMs: (s.progressMs || 0) + age,
      volume: s.volume ?? null, muted: !!s.muted,
      shuffle: s.shuffle ?? null, repeat: s.repeat ?? null,
      device: { id: z.id, name: z.name, type: z.adapter },
      status: t ? 'ok' : 'nodevice',
      message: t ? '' : z.direct ? `${z.name} · direct, no bridge` : `${z.name} is idle`,
    });
  }
  _ingest(list) {
    this.zones = [...(list || []), ...this._extraZones()];
    this._publishZone();
  }
  _ingestOne(z) {
    const i = this.zones.findIndex((x) => x.id === z.id);
    if (i >= 0) this.zones[i] = z; else this.zones.push(z);
    if (!this.zone || z.id === this.zone.id || this.source) this._publishZone();
  }

  async start() {
    const saved = store.getZone(this.id); // a device picked on the setup screen since this provider was made
    if (saved) this.zoneId = saved;
    const extra = this._extraZones().length > 0;
    if (extra) this._ingest(this.zones.filter((z) => !z.direct));   // direct TVs work straight away
    else this.publish({ status: 'loading', message: 'Looking for the bridge…' });
    this.base = extra && !mayProbe() ? null : await bridgeBase();
    if (!this.base && extra) { this.pollT = setTimeout(() => this.start(), 30000); return; }
    if (!this.base) {
      this.publish({ status: 'error', message: 'Bridge not found. Run the bridge on your Pi (see README), or set its address in Settings.' });
      // keep retrying quietly
      this.pollT = setTimeout(() => this.start(), 8000);
      return;
    }
    await this.refresh().catch(() => {});
    try {
      this.es = new EventSource(`${this.base}/api/events`);
      this.es.addEventListener('zones', (e) => this._ingest(JSON.parse(e.data)));
      this.es.addEventListener('zone', (e) => this._ingestOne(JSON.parse(e.data)));
      this.es.onerror = () => { /* EventSource auto-reconnects; polling covers gaps */ };
    } catch { this.es = null; }
    const poll = async () => {
      if (!this.es || this.es.readyState !== 1) await this.refresh().catch(() => {});
      this.pollT = setTimeout(poll, 4000);
    };
    this.pollT = setTimeout(poll, 4000);
  }
  stop() { this.es?.close(); this.es = null; clearTimeout(this.pollT); }
  async refresh() {
    if (!this.base && this._extraZones().length) { this._ingest([]); return; }
    const list = await bridgeFetch('/api/zones');
    this._ingest(list);
  }

  _cmd(cmd, value) {
    if (!this.zone) throw Object.assign(new Error('No zone'), { userMessage: 'Pick a device first' });
    if (this.zone.direct) {
      const key = { play: 'play', pause: 'pause', next: 'next', prev: 'prev', stop: 'stop' }[cmd];
      if (!key) return Promise.reject(Object.assign(new Error('Needs the bridge'), { userMessage: 'Use the volume keys on the remote (direct control can’t set an exact level)' }));
      return directKey(this.zone, key);
    }
    return bridgeFetch(`/api/zones/${encodeURIComponent(this.zone.id)}/command`, { method: 'POST', json: { cmd, value } });
  }
  play() { return this._cmd('play'); }
  pause() { return this._cmd('pause'); }
  next() { return this._cmd('next'); }
  prev() { return this._cmd('prev'); }
  seek(ms) { return this._cmd('seek', Math.round(ms)); }
  setVolume(v) { return this._cmd('volume', Math.round(v)); }
  stopPlayback() { return this._cmd('stop'); }
  /** TV remote key (up/down/left/right/ok/back/home/power/mute/volup/voldown/playpause) for adapters with a D-pad. */
  remoteKey(key) {
    if (this.zone?.direct) return directKey(this.zone, key);
    return bridgeFetch(`/api/adapters/${this.zone.adapter}/key`, { method: 'POST', json: { id: this.zone.id, key } });
  }
  setShuffle(on) { return this._cmd('shuffle', !!on); }
  setRepeat(m) { return this._cmd('repeat', m); }

  async getPlaylists() {
    if (!this.zone) return [];
    if (this.zone.direct) return DIRECT_APPS.map((a) => ({ kind: 'app', id: a.id, name: a.name, subtitle: 'Open on the TV', mono: a.name.slice(0, 2) }));
    const list = await bridgeFetch(`/api/zones/${encodeURIComponent(this.zone.id)}/playlists`);
    return (list || []).map((p) => ({ ...p, art: p.art && p.art.startsWith('/') ? this.base + p.art : p.art }));
  }
  playPlaylist(pl) {
    if (this.zone?.direct) return directLaunch(this.zone, pl.id);
    return bridgeFetch(`/api/zones/${encodeURIComponent(this.zone.id)}/play`, { method: 'POST', json: { item: pl } });
  }
  async search(q) {
    if (!this.zone || this.zone.direct) return [];
    const list = await bridgeFetch(`/api/zones/${encodeURIComponent(this.zone.id)}/search?${qs({ q })}`);
    return (list || []).map((p) => ({ ...p, art: p.art && p.art.startsWith('/') ? this.base + p.art : p.art }));
  }
  playItem(item) { return this.playPlaylist(item); }
  async getDevices() {
    await this.refresh().catch(() => {});
    const re = this.source && SOURCE_MATCH[this.source];
    return this.zones.filter((z) => this._mine(z)).map((z) => ({
      id: z.id, name: z.name,
      type: z.direct ? `Google TV · direct (${z.localId})` : `${z.adapter}${z.sourceApp ? ' · ' + z.sourceApp : ''}${re && re.test(z.sourceApp || '') ? ' ✓' : ''}`,
      active: this.zone?.id === z.id, volume: z.state?.volume,
    }));
  }
  async selectDevice(dev) {
    this.zoneId = dev.id;
    this.userPicked = true;
    store.setZone(this.id, dev.id);
    this._publishZone();
  }
}
