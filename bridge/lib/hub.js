// Zone registry shared by all adapters. Adapters push normalized zones in; the HTTP
// server streams them to the app over Server-Sent Events.
import { EventEmitter } from 'node:events';

/**
 * Normalized zone:
 * { id: 'adapter:localId', adapter, localId, name, sourceApp,
 *   state: { track:{id,title,artist,album,art,durationMs}|null, isPlaying, progressMs, volume, muted, shuffle, repeat },
 *   caps: { seek, volume, next, prev, playlists, search, shuffle, repeat },
 *   sampledAt: epoch ms when progressMs was measured }
 */
export class Hub extends EventEmitter {
  constructor() {
    super();
    this.zones = new Map();
    this.adapters = new Map();
    this.setMaxListeners(100);
    this._pending = new Map();
  }
  addAdapter(a) { this.adapters.set(a.id, a); }
  adapterFor(zoneId) { return this.adapters.get(String(zoneId).split(':')[0]); }
  list() { return [...this.zones.values()]; }
  get(id) { return this.zones.get(id); }

  upsert(adapter, localId, zone) {
    const id = `${adapter}:${localId}`;
    const prev = this.zones.get(id);
    const z = {
      id, adapter, localId,
      name: zone.name ?? prev?.name ?? localId,
      sourceApp: zone.sourceApp ?? prev?.sourceApp ?? '',
      state: { track: null, isPlaying: false, progressMs: 0, volume: null, muted: false, shuffle: null, repeat: null, ...(prev?.state || {}), ...(zone.state || {}) },
      caps: { seek: false, volume: false, next: false, prev: false, playlists: false, search: false, shuffle: false, repeat: false, ...(prev?.caps || {}), ...(zone.caps || {}) },
      sampledAt: zone.sampledAt ?? (zone.state && 'progressMs' in zone.state ? Date.now() : prev?.sampledAt ?? Date.now()),
    };
    this.zones.set(id, z);
    this._schedule(id);
    return z;
  }
  remove(adapter, localId) {
    const id = `${adapter}:${localId}`;
    if (this.zones.delete(id)) this.emit('zones', this.list());
  }
  removeAdapterZones(adapter) {
    let changed = false;
    for (const id of [...this.zones.keys()]) if (id.startsWith(adapter + ':')) { this.zones.delete(id); changed = true; }
    if (changed) this.emit('zones', this.list());
  }
  // Coalesce bursts (e.g. Roon seek ticks every second for every zone) to ≤ 5 events/s per zone.
  _schedule(id) {
    if (this._pending.has(id)) return;
    this._pending.set(id, setTimeout(() => {
      this._pending.delete(id);
      const z = this.zones.get(id);
      if (z) this.emit('zone', z);
    }, 200));
  }
}
