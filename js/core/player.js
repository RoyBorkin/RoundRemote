// The Player controller sits between the UI and the active Provider.
// It adds optimistic updates (so the UI reacts instantly on a slow remote API),
// guards against stale poll results right after a command, and exposes a smooth,
// interpolated playback position for animations.
import { Emitter, clamp, now } from './util.js';
import { emptyState, positionOf } from '../providers/base.js';

const HOLD_MS = 2500;

export class Player extends Emitter {
  constructor() {
    super();
    this.provider = null;
    this.state = emptyState();
    this._off = null;
    this._hold = {};      // field -> { value, until }
    this._trackKey = null;
  }

  get caps() { return this.provider?.caps || {}; }

  async use(provider) {
    if (this.provider === provider) return;
    this.release();
    this.provider = provider;
    this.state = emptyState();
    this._trackKey = null;
    this._off = provider.on('state', (s) => this._ingest(s));
    this.emit('provider', provider);
    this.emit('state', this.state);
    try { await provider.start(); } catch (e) { this._error(e); }
  }

  release() {
    if (this._off) this._off();
    this._off = null;
    try { this.provider?.stop(); } catch {}
    this.provider = null;
  }

  position() { return positionOf(this.state); }
  duration() { return this.state.track?.durationMs || 0; }

  _held(field) {
    const h = this._hold[field];
    if (!h) return undefined;
    if (now() > h.until) { delete this._hold[field]; return undefined; }
    return h;
  }
  _setHold(field, value) { this._hold[field] = { value, until: now() + HOLD_MS }; }

  _ingest(s) {
    const next = { ...s };
    // A poll that lands right after a command may still report the old value.
    const hp = this._held('isPlaying');
    if (hp && s.isPlaying !== hp.value) { next.isPlaying = hp.value; }
    else if (hp) delete this._hold.isPlaying;
    const hs = this._held('seek');
    if (hs) {
      const expected = hs.value + (next.isPlaying ? now() - hs.at : 0);
      if (Math.abs((s.progressMs + (now() - s.updatedAt)) - expected) > 2500) {
        next.progressMs = expected; next.updatedAt = now();
      } else delete this._hold.seek;
    }
    const hv = this._held('volume');
    if (hv && s.volume !== hv.value) next.volume = hv.value;
    const tk = next.track ? (next.track.id || `${next.track.title}|${next.track.artist}`) : null;
    if (tk !== this._trackKey) {
      // New track: drop seek hold (it belonged to the previous song).
      if (this._trackKey !== null) delete this._hold.seek;
      this._trackKey = tk;
      this.state = next;
      this.emit('track', next.track);
    } else {
      this.state = next;
    }
    this.emit('state', this.state);
  }

  _local(patch) {
    // Apply an optimistic patch without waiting for the provider.
    const s = { ...this.state, ...patch };
    this.state = s;
    this.emit('state', s);
  }

  _error(e) {
    console.warn('[player]', e);
    this.emit('error', e?.userMessage || e?.message || String(e));
  }

  async _run(fn) {
    if (!this.provider) return;
    try { await fn(); } catch (e) { this._error(e); }
    // Ask the provider for a fresh state shortly after a command.
    setTimeout(() => this.provider?.refresh().catch(() => {}), 450);
  }

  toggle() { return this.state.isPlaying ? this.pause() : this.play(); }
  play() {
    this._setHold('isPlaying', true);
    this._local({ isPlaying: true, progressMs: this.position(), updatedAt: now() });
    return this._run(() => this.provider.play());
  }
  pause() {
    this._setHold('isPlaying', false);
    this._local({ isPlaying: false, progressMs: this.position(), updatedAt: now() });
    return this._run(() => this.provider.pause());
  }
  next() { return this._run(() => this.provider.next()); }
  prev() {
    // Most services restart the song if >3s in; mirror that locally for instant feedback.
    if (this.position() > 3000) this._local({ progressMs: 0, updatedAt: now() });
    return this._run(() => this.provider.prev());
  }
  seek(ms) {
    if (!this.caps.seek) return;
    ms = clamp(Math.round(ms), 0, Math.max(0, this.duration() - 500));
    this._hold.seek = { value: ms, at: now(), until: now() + HOLD_MS };
    this._local({ progressMs: ms, updatedAt: now() });
    return this._run(() => this.provider.seek(ms));
  }
  seekBy(deltaMs) { return this.seek(this.position() + deltaMs); }
  setVolume(pct) {
    if (!this.caps.volume) return;
    pct = clamp(Math.round(pct), 0, 100);
    this._setHold('volume', pct);
    this._local({ volume: pct, muted: pct === 0 ? this.state.muted : false });
    return this._run(() => this.provider.setVolume(pct));
  }
  setShuffle(on) { this._local({ shuffle: on }); return this._run(() => this.provider.setShuffle(on)); }
  setRepeat(mode) { this._local({ repeat: mode }); return this._run(() => this.provider.setRepeat(mode)); }
  cycleRepeat() {
    const order = ['off', 'all', 'one'];
    return this.setRepeat(order[(order.indexOf(this.state.repeat || 'off') + 1) % 3]);
  }
}

export const player = new Player();
