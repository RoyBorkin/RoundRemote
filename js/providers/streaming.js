// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Netflix, Disney+, Prime Video, Apple TV+, Max and YouTube in Movies & TV. These apps have no remote-control API of
// their own, so the tile follows the app wherever it's running on a TV the bridge knows:
//   • Google TV / Android TV (paired in Media → Google TV): which app is open, the remote, open the app
//   • Apple TV (pyatv): the title, series, season and episode playing in the app, the remote, open the app
//   • Chromecast: whatever the app casts (title, season/episode when the app sends them)
//   • YouTube on your TV (linked with a TV code), for YouTube
// YouTube also gets a Library tab: search YouTube and your playlists, and play a video on the TV.
// Netflix, Disney+, Prime Video, Apple TV+ and Max get a Library tab from TMDB's watch providers (what's on the service
// in your country; js/core/stream-library.js) with "Play on TV" (a deep link, or open the app and type the title).
// Local "Who's watching?" profiles (js/core/service-profiles.js) keep My list, Recently opened and a kids filter apart.
import { BridgeProvider, bridgeFetch } from './bridge.js';
import { store } from '../core/store.js';
import { directLaunch } from '../core/tvapp.js';
import { catalogApp, appLink } from '../core/tv-apps.js';
import * as SL from '../core/stream-library.js';
import { recents, pushRecent, isFavourite, toggleFavourite } from '../core/service-profiles.js';
import { videoSearch, playlistVideos, videoDetails, myPlaylists, googleSignedIn } from '../core/youtube.js';

// androidLink: the app link from the shared TV apps catalog (js/core/tv-apps.js)
const APPS = {
  netflix: { re: /netflix/i, androidLink: catalogApp('netflix').link, appleBundle: 'com.netflix.Netflix' },
  disney: { re: /disney/i, androidLink: catalogApp('disney').link, appleBundle: 'com.disney.disneyplus' },
  youtube: { re: /youtube(?!\s*music)/i, androidLink: catalogApp('youtube').link, appleBundle: 'com.google.ios.youtube' },
  prime: { re: /prime\s*video|amazon\s*video|amazonvideo/i, androidLink: appLink(catalogApp('prime')), appleBundle: 'com.amazon.aiv.AIVApp' },
  appletvplus: { re: /apple\s*tv|TVWatchList/i, androidLink: appLink(catalogApp('appletv')), appleBundle: 'com.apple.TVWatchList' },
  max: { re: /\bmax\b|hbo/i, androidLink: appLink(catalogApp('max')), appleBundle: 'com.wbd.stream' },
};
export const STREAMING_ADAPTERS = ['androidtv', 'appletv', 'cast', 'youtubetv'];
const LAUNCH = ['androidtv', 'appletv'];
const err = (m) => Object.assign(new Error(m), { userMessage: m });

export class StreamingProvider extends BridgeProvider {
  constructor(meta, { app }) {
    super(meta, { adapter: STREAMING_ADAPTERS, direct: true });
    this.appId = app;
    this.app = APPS[app];
    this.lib = SL.hasStreamLibrary(meta.id) ? meta.id : null;   // the TMDB library (service id = STREAM_APPS key)
    this.caps.library = app === 'youtube' || !!this.lib;
    this.liveRoot = this.caps.library;   // the library's first page is drawn again when you come back to it
    // another local profile (or its kids filter): the Movies & TV screen redraws the library ('user', as for Plex users)
    store.on('profile', (svc) => { if (svc === this.id) this.emit?.('user'); });
  }
  // the library works without a TV (a TMDB key on this display is enough — GitHub Pages without a bridge)
  isAuthed() { return super.isAuthed() || (!!this.lib && !!SL.localTmdbKey()); }
  _mine(z) {
    if (!STREAMING_ADAPTERS.includes(z.adapter)) return false;
    return z.adapter !== 'youtubetv' || this.appId === 'youtube';
  }
  /** Is this zone showing our app right now? */
  matches(z) { return !!z && ((this.appId === 'youtube' && z.adapter === 'youtubetv') || this.app.re.test(`${z.sourceApp || ''} ${z.state?.track?.media?.app || ''}`)); }
  _pickZone() {
    const zs = this.zones.filter((z) => this._mine(z));
    const saved = zs.find((z) => z.id === this.zoneId);
    const running = zs.filter((z) => this.matches(z));
    if (saved && (this.userPicked || this.matches(saved) || !running.length)) return saved;
    // prefer a TV that says what's playing (Apple TV, Chromecast) over one that only knows the app is open
    return running.find((z) => z.state?.isPlaying && z.state?.track?.media) || running.find((z) => z.state?.isPlaying) || running[0] || saved || zs.find((z) => LAUNCH.includes(z.adapter)) || zs[0] || null;
  }
  _publishZone() {
    super._publishZone();
    const z = this.zone;
    this.caps.launch = !!z && LAUNCH.includes(z.adapter);
    this.caps.library = this.appId === 'youtube' || !!this.lib;
    if (z && !this.matches(z)) {
      this.publish({ track: null, isPlaying: false, status: 'nodevice', message: this.caps.launch ? `${this.name} isn’t open on ${z.name}` : `Nothing from ${this.name} on ${z.name}` });
    }
  }
  async getDevices() {
    const list = await super.getDevices();
    return list.map((d) => {
      const z = this.zones.find((x) => x.id === d.id);
      return { ...d, type: `${{ androidtv: 'Google TV', appletv: 'Apple TV', cast: 'Chromecast', youtubetv: 'YouTube on TV' }[z?.adapter] || z?.adapter}${this.matches(z) ? ` · ${this.name} ✓` : ''}` };
    });
  }
  /** Open the app (or a link inside it) on the selected TV. */
  async launch(link) {
    const z = this.zone;
    if (!z) throw err('Pick a TV in Devices first');
    if (z.direct) return directLaunch(z, z.via === 'ha' ? link || this.app.androidLink : this.appId);   // HA opens links; the TV Remote app only apps
    if (z.adapter === 'androidtv') return bridgeFetch('/api/adapters/androidtv/app', { method: 'POST', json: { id: z.id, link: link || this.app.androidLink } });
    if (z.adapter === 'appletv') return bridgeFetch('/api/adapters/appletv/app', { method: 'POST', json: { id: z.id, bundle: link || this.app.appleBundle } });
    throw err(`${z.name} can’t open apps — open ${this.name} on the TV itself`);
  }

  // ---------- the library: TMDB for the streaming services, YouTube search + playlists ----------
  async libraryRoot() {
    if (this.lib) return SL.libraryRoot(this.lib);
    if (this.appId !== 'youtube') return { title: this.name, items: [] };
    let items = [];
    const rec = recents(this.id);
    if (rec.length) items.push({ id: 'recent', type: 'folder', title: 'Recently played', subtitle: rec.slice(0, 3).map((e) => e.title).join(' · '), icon: 'clock', node: { kind: 'recent' } });
    if (googleSignedIn()) {
      try {
        items = (await myPlaylists()).map((p) => ({ id: `pl-${p.id}`, type: 'folder', title: p.name, subtitle: p.subtitle, poster: p.art || '', icon: p.liked ? 'star' : 'list', node: { kind: 'playlist', pl: p, title: p.name } }));
      } catch {}
    }
    return { title: 'YouTube', items, emptyText: 'Tap 🔍 to search YouTube. Sign in with Google (YouTube tile in Music) for your playlists.' };
  }
  async browse(node, opts = {}) {
    if (node.kind === 'root') return this.libraryRoot();
    if (this.lib) return SL.browse(this.lib, node, opts);
    if (node.kind === 'recent') return { title: 'Recently played', items: opts.start ? [] : recents(this.id) };
    if (node.kind === 'playlist') return { title: node.title, items: await playlistVideos(node.pl) };
    return { title: '', items: [] };
  }
  searchMedia(q) { return this.lib ? SL.search(this.lib, q) : videoSearch(q); }
  details(entry) { return this.lib ? SL.details(this.lib, entry) : videoDetails(entry.itemId || entry.id); }
  related(d) { return this.lib ? SL.related(this.lib, d) : Promise.resolve([]); }
  /** Extra buttons on a title's page: ＋ My list (the active local profile's). */
  detailActions(d) {
    if (!this.lib) return [];
    const b = document.createElement('button');
    b.type = 'button';
    const paint = () => { const on = isFavourite(this.lib, d); b.className = on ? 'pill on' : 'pill'; b.textContent = on ? '✓ My list' : '＋ My list'; b.setAttribute('aria-pressed', String(on)); };
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleFavourite(this.lib, d); paint(); });
    paint();
    return [b];
  }
  async playMedia(entry) {
    if (this.lib) {   // "Play on TV": the TV used last (or a picker) — js/screens/open-on-tv.js says what happens
      const [{ openOnTv }, { forEntry }] = await Promise.all([import('../screens/open-on-tv.js'), import('../core/open-on-tv.js')]);
      await openOnTv(forEntry(this, entry));
      return { handled: true };
    }
    if (this.appId === 'youtube') pushRecent(this.id, { ...entry, type: entry.type || 'video' });
    const z = this.zone;
    const id = entry.itemId || entry.id;
    if (!z) throw err('Pick a TV in Devices first');
    if (z.adapter === 'youtubetv') return bridgeFetch(`/api/zones/${encodeURIComponent(z.id)}/play`, { method: 'POST', json: { item: { id, kind: 'track' } } });
    if (z.direct && z.via !== 'ha') {
      await this.launch();
      throw err('Opened YouTube on the TV. To start a chosen video, link the TV under YouTube → “YouTube on your TV” (or pair it through the bridge).');
    }
    if (LAUNCH.includes(z.adapter)) return this.launch(`https://www.youtube.com/watch?v=${id}`);
    throw err('Pick a TV linked under YouTube → “YouTube on your TV”, a Google TV or an Apple TV in Devices');
  }
}
