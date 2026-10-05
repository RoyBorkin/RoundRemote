// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Every music service implements this interface. The UI only ever talks to a Provider
// through the Player controller, so adding a service = adding one provider file.
import { Emitter } from '../core/util.js';

export const ALL_CAPS = ['seek', 'volume', 'next', 'prev', 'playlists', 'search', 'devices', 'shuffle', 'repeat'];

export function emptyState() {
  return {
    track: null,          // { id, title, artist, album, art, durationMs, uri }
    isPlaying: false,
    progressMs: 0,
    updatedAt: performance.now(),
    volume: null,         // 0..100 or null if unknown/unsupported
    muted: false,
    device: null,         // { id, name, type }
    shuffle: null,        // true/false/null(unsupported)
    repeat: null,         // 'off' | 'all' | 'one' | null
    status: 'idle',       // idle | loading | ok | error | nodevice
    message: '',
  };
}

/** Interpolated playback position for a state snapshot. */
export function positionOf(s) {
  if (!s?.track) return 0;
  let p = s.progressMs || 0;
  if (s.isPlaying) p += performance.now() - s.updatedAt;
  const d = s.track.durationMs || 0;
  return d > 0 ? Math.min(Math.max(0, p), d) : Math.max(0, p);
}

export class Provider extends Emitter {
  /** @param {{id:string,name:string,mono:string,color:string,blurb?:string}} meta */
  constructor(meta) {
    super();
    Object.assign(this, meta);
    this.caps = Object.fromEntries(ALL_CAPS.map((c) => [c, false]));
    this.local = false;   // true when audio plays in this browser (Apple MusicKit, Demo) -> live scrubbing is cheap
    this.state = emptyState();
  }
  // ---- lifecycle ----
  /** Missing configuration (client ID, server URL...). Return a message string or ''. */
  setupHint() { return ''; }
  isAuthed() { return false; }
  /** Kick off sign-in. May redirect the page. */
  async connect() {}
  /** Called on page load with URL params; return true if this provider consumed them. */
  async handleRedirect(_params) { return false; }
  async start() {}
  stop() {}
  async refresh() {}
  signOut() {}
  // ---- transport ----
  async play() {} async pause() {} async next() {} async prev() {}
  async seek(_ms) {} async setVolume(_pct) {} async setShuffle(_on) {} async setRepeat(_mode) {}
  // ---- library ----
  async getPlaylists() { return []; }
  async playPlaylist(_pl) {}
  async search(_q) { return []; }
  async playItem(_item) {}
  async getDevices() { return []; }
  async selectDevice(_dev) {}

  /** Providers call this to publish new normalized state. */
  publish(patch) {
    const prev = this.state;
    // Keep the interpolated clock continuous when only non-time fields change.
    if (!('progressMs' in patch) && 'isPlaying' in patch && patch.isPlaying !== prev.isPlaying) {
      patch = { ...patch, progressMs: positionOf(prev) };
    }
    this.state = { ...prev, ...patch };
    if ('progressMs' in patch && !('updatedAt' in patch)) this.state.updatedAt = performance.now();
    this.emit('state', this.state);
  }
}
