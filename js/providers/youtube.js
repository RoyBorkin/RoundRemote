// YouTube and YouTube Music. Plays through the official YouTube IFrame player on this
// display (YouTube has no public API to remote-control the YouTube app on a phone or TV;
// for a TV/Chromecast use the Google Cast tile). Search uses the YouTube Data API (free API
// key); "Sign in with Google" adds your playlists and liked videos.
// YouTube's terms don't allow hiding the player, so the video always stays visible: as the
// background in Video view, as the artwork in Info / Vinyl, or as a small bubble elsewhere.
import { Provider } from './base.js';
import { store } from '../core/store.js';
import {
  loadIframeApi, apiKey, googleClientId, googleSignedIn, googleSignIn, googleSignOut,
  search as ytSearch, myPlaylists, playlistVideoIds, splitTitle, bigThumb,
} from '../core/youtube.js';
import { h } from '../ui/dom.js';

let host = null, ytPlayer = null, readyP = null, owner = null;

/** The single shared YouTube player element, living directly in #app so it survives screen changes. */
export function ytHost() {
  if (!host) {
    host = h('div#yt-host', h('div#yt-frame'));
    document.getElementById('app').prepend(host);
  }
  return host;
}

async function ensurePlayer() {
  if (readyP) return readyP;
  readyP = (async () => {
    const YT = await loadIframeApi();
    ytHost();
    await new Promise((resolve) => {
      ytPlayer = new YT.Player('yt-frame', {
        width: '100%', height: '100%',
        playerVars: { controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: () => resolve(),
          onStateChange: (e) => owner?._onState(e.data),
          onError: (e) => owner?._onError(e.data),
        },
      });
    });
    return ytPlayer;
  })().catch((e) => { readyP = null; throw e; });
  return readyP;
}

export class YouTubeProvider extends Provider {
  constructor(meta, { music = false } = {}) {
    super(meta);
    this.music = music;
    this.local = true;
    this.videoHost = true; // the Video view shows this provider's own player
    Object.assign(this.caps, { seek: true, volume: true, next: true, prev: true, playlists: true, search: true, shuffle: true, repeat: true, devices: false });
    this.queue = []; this.qi = -1;
    this.shuffle = false; this.repeat = 'off';
    this.lastResults = [];
  }
  setupHint() { return apiKey() || googleClientId() ? '' : 'Add a free YouTube Data API key in Settings.'; }
  isAuthed() { return true; }

  async start() {
    owner = this;
    this.publish({ status: 'loading', message: 'Loading YouTube player…' });
    await ensurePlayer();
    document.getElementById('app').classList.add('has-yt');
    const last = store.get(this.music ? 'ytmLast' : 'ytLast');
    if (last?.ids?.length && !ytPlayer.getVideoData?.()?.video_id) {
      ytPlayer.cuePlaylist(last.ids, Math.max(0, last.index || 0));
    }
    clearInterval(this.timer);
    this.timer = setInterval(() => this._emit(), 1000);
    this._emit();
  }
  stop() {
    clearInterval(this.timer);
    try { ytPlayer?.pauseVideo(); } catch {}
    document.getElementById('app').classList.remove('has-yt');
    if (owner === this) owner = null;
  }
  async refresh() { this._emit(); }
  signOut() { googleSignOut(); }

  _remember() {
    const ids = ytPlayer?.getPlaylist?.() || this.queue.map((x) => x.id);
    const index = ytPlayer?.getPlaylistIndex?.() ?? this.qi;
    if (ids?.length) store.set(this.music ? 'ytmLast' : 'ytLast', { ids: ids.slice(0, 200), index });
  }
  _emit() {
    const p = ytPlayer;
    if (!p?.getPlayerState) return;
    const st = p.getPlayerState();
    const vd = p.getVideoData?.() || {};
    if (!vd.video_id) {
      this.publish({ track: null, isPlaying: false, status: 'nodevice', device: { id: 'local', name: 'This display' }, message: 'Search or pick a playlist to start' });
      return;
    }
    const { artist, title } = splitTitle(vd.title, vd.author);
    this.publish({
      track: {
        id: vd.video_id, title: title || vd.title || 'YouTube', artist: artist || vd.author || '',
        album: this.music ? '' : 'YouTube', art: bigThumb(vd.video_id), durationMs: (p.getDuration?.() || 0) * 1000,
      },
      isPlaying: st === 1 || st === 3,
      progressMs: (p.getCurrentTime?.() || 0) * 1000,
      volume: p.isMuted?.() ? 0 : Math.round(p.getVolume?.() ?? 100),
      device: { id: 'local', name: 'This display', type: 'YouTube' },
      shuffle: this.shuffle, repeat: this.repeat, status: 'ok', message: '',
    });
  }
  _onState(s) {
    if (s === 0) { // ended
      if (this.repeat === 'one') { ytPlayer.seekTo(0, true); ytPlayer.playVideo(); }
      else if (!(ytPlayer.getPlaylist?.()?.length) && this.queue.length) this.next();
    }
    if (s === 1) this._remember();
    this._emit();
  }
  _onError(code) {
    const msg = code === 101 || code === 150 ? 'The owner doesn’t allow this video outside YouTube — skipping'
      : code === 100 ? 'Video not found — skipping' : 'YouTube couldn’t play this video — skipping';
    this.emit('notice', msg);
    setTimeout(() => this.next().catch(() => {}), 800);
  }
  _load(id) { ytPlayer.loadVideoById(id); }

  // ---------- transport ----------
  async play() { ytPlayer.playVideo(); }
  async pause() { ytPlayer.pauseVideo(); }
  async next() {
    if (ytPlayer.getPlaylist?.()?.length) return ytPlayer.nextVideo();
    if (!this.queue.length) return;
    this.qi = this.shuffle ? Math.floor(Math.random() * this.queue.length) : (this.qi + 1) % this.queue.length;
    this._load(this.queue[this.qi].id);
  }
  async prev() {
    if ((ytPlayer.getCurrentTime?.() || 0) > 3) return ytPlayer.seekTo(0, true);
    if (ytPlayer.getPlaylist?.()?.length) return ytPlayer.previousVideo();
    if (!this.queue.length) return;
    this.qi = (this.qi - 1 + this.queue.length) % this.queue.length;
    this._load(this.queue[this.qi].id);
  }
  async seek(ms) { ytPlayer.seekTo(ms / 1000, true); }
  async setVolume(v) { if (v > 0) ytPlayer.unMute(); else ytPlayer.mute(); ytPlayer.setVolume(v); }
  async setShuffle(on) { this.shuffle = on; try { ytPlayer.setShuffle(on); } catch {} }
  async setRepeat(m) { this.repeat = m; try { ytPlayer.setLoop(m === 'all'); } catch {} }

  // ---------- library ----------
  async getPlaylists() {
    if (!googleClientId()) return [{ id: '__help', name: 'Your playlists need Google sign-in', subtitle: 'Add a Google OAuth Client ID in Settings (see README)', mono: 'G' }];
    if (!googleSignedIn()) return [{ id: '__signin', name: 'Sign in with Google', subtitle: 'to see your playlists and liked videos', mono: 'G' }];
    return myPlaylists();
  }
  async playPlaylist(pl) {
    if (pl.id === '__help') return;
    if (pl.id === '__signin') { await googleSignIn(); this.emit('notice', 'Signed in — open Playlists again'); return; }
    const ids = await playlistVideoIds(pl);
    if (!ids.length) throw Object.assign(new Error('empty'), { userMessage: 'That playlist is empty' });
    this.queue = []; this.qi = -1;
    ytPlayer.loadPlaylist(ids, 0);
    if (this.shuffle) setTimeout(() => ytPlayer.setShuffle(true), 500);
  }
  async search(q) {
    const res = await ytSearch(q, { music: this.music });
    this.lastResults = res.filter((r) => r.kind === 'track');
    return res;
  }
  async playItem(item) {
    if (item.kind === 'playlist') {
      const ids = await playlistVideoIds({ id: item.id });
      this.queue = []; this.qi = -1;
      ytPlayer.loadPlaylist(ids, 0);
      return;
    }
    // Play the tapped result and keep the rest of the results as the up-next queue.
    this.queue = this.lastResults.length ? this.lastResults : [item];
    this.qi = Math.max(0, this.queue.findIndex((x) => x.id === item.id));
    this._load(item.id);
  }
}
