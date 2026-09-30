// Provider for everything that lives on your local network and needs the companion
// bridge (bridge/server.js): Roon, UPnP/DLNA, AirPlay (shairport-sync), Google Cast.
// Tidal and Qobuz have no public remote-control API, so their tiles attach to whichever
// bridge zone is playing Tidal/Qobuz (Roon, a Cast device, a UPnP renderer...).
import { Provider } from './base.js';
import { store } from '../core/store.js';
import { http, qs } from '../core/util.js';

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

const SOURCE_MATCH = {
  tidal: /tidal/i,
  qobuz: /qobuz/i,
};

export class BridgeProvider extends Provider {
  /** @param meta  @param {{adapter?:string, source?:string}} opts */
  constructor(meta, { adapter = null, source = null } = {}) {
    super(meta);
    this.adapter = adapter;      // 'roon' | 'upnp' | 'airplay' | 'cast' | null (any)
    this.source = source;        // 'tidal' | 'qobuz' | null
    this.zones = [];
    this.zoneId = store.getZone(meta.id);
    this.es = null;
    this.pollT = null;
    this.base = null;
  }
  isAuthed() { return true; }            // the bridge handles sign-in/pairing itself
  setupHint() { return ''; }

  _mine(z) {
    if (this.adapter && z.adapter !== this.adapter) return false;
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
    if (!z) z = zs.find((x) => x.state?.isPlaying) || zs[0] || null;
    return z;
  }
  _publishZone() {
    const z = this._pickZone();
    this.zone = z;
    if (!z) {
      const what = this.source ? `${this.name} playback on Roon, Cast, UPnP or AirPlay` : `${this.name} devices`;
      this.publish({ track: null, isPlaying: false, device: null, status: 'nodevice', message: `No ${what} found yet` });
      return;
    }
    this.zoneId = z.id;
    Object.assign(this.caps, { seek: false, volume: false, next: false, prev: false, playlists: false, search: false, shuffle: false, repeat: false, ...(z.caps || {}), devices: true });
    const s = z.state || {};
    const age = s.isPlaying && z.sampledAt ? Math.max(0, Date.now() - z.sampledAt) : 0;
    const t = s.track;
    this.publish({
      track: t ? { ...t, art: t.art && t.art.startsWith('/') ? this.base + t.art : t.art } : null,
      isPlaying: !!s.isPlaying,
      progressMs: (s.progressMs || 0) + age,
      volume: s.volume ?? null, muted: !!s.muted,
      shuffle: s.shuffle ?? null, repeat: s.repeat ?? null,
      device: { id: z.id, name: z.name, type: z.adapter },
      status: t ? 'ok' : 'nodevice',
      message: t ? '' : `${z.name} is idle`,
    });
  }
  _ingest(list) {
    this.zones = list || [];
    this._publishZone();
  }
  _ingestOne(z) {
    const i = this.zones.findIndex((x) => x.id === z.id);
    if (i >= 0) this.zones[i] = z; else this.zones.push(z);
    if (!this.zone || z.id === this.zone.id || this.source) this._publishZone();
  }

  async start() {
    this.publish({ status: 'loading', message: 'Looking for the bridge…' });
    this.base = await bridgeBase();
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
    const list = await bridgeFetch('/api/zones');
    this._ingest(list);
  }

  _cmd(cmd, value) {
    if (!this.zone) throw Object.assign(new Error('No zone'), { userMessage: 'Pick a device first' });
    return bridgeFetch(`/api/zones/${encodeURIComponent(this.zone.id)}/command`, { method: 'POST', json: { cmd, value } });
  }
  play() { return this._cmd('play'); }
  pause() { return this._cmd('pause'); }
  next() { return this._cmd('next'); }
  prev() { return this._cmd('prev'); }
  seek(ms) { return this._cmd('seek', Math.round(ms)); }
  setVolume(v) { return this._cmd('volume', Math.round(v)); }
  setShuffle(on) { return this._cmd('shuffle', !!on); }
  setRepeat(m) { return this._cmd('repeat', m); }

  async getPlaylists() {
    if (!this.zone) return [];
    const list = await bridgeFetch(`/api/zones/${encodeURIComponent(this.zone.id)}/playlists`);
    return (list || []).map((p) => ({ ...p, art: p.art && p.art.startsWith('/') ? this.base + p.art : p.art }));
  }
  playPlaylist(pl) { return bridgeFetch(`/api/zones/${encodeURIComponent(this.zone.id)}/play`, { method: 'POST', json: { item: pl } }); }
  async search(q) {
    if (!this.zone) return [];
    const list = await bridgeFetch(`/api/zones/${encodeURIComponent(this.zone.id)}/search?${qs({ q })}`);
    return (list || []).map((p) => ({ ...p, art: p.art && p.art.startsWith('/') ? this.base + p.art : p.art }));
  }
  playItem(item) { return this.playPlaylist(item); }
  async getDevices() {
    await this.refresh().catch(() => {});
    const re = this.source && SOURCE_MATCH[this.source];
    return this.zones.filter((z) => this._mine(z)).map((z) => ({
      id: z.id, name: z.name,
      type: `${z.adapter}${z.sourceApp ? ' · ' + z.sourceApp : ''}${re && re.test(z.sourceApp || '') ? ' ✓' : ''}`,
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
