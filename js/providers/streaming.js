// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Netflix, Disney+ and YouTube in Movies & TV. These apps have no remote-control API of their own, so the
// tile follows the app wherever it's running on a TV the bridge knows:
//   • Google TV / Android TV (paired in Media → Google TV): which app is open, the remote, open the app
//   • Apple TV (pyatv): the title, series, season and episode playing in the app, the remote, open the app
//   • Chromecast: whatever the app casts (title, season/episode when the app sends them)
//   • YouTube on your TV (linked with a TV code), for YouTube
// YouTube also gets a Library tab: search YouTube and your playlists, and play a video on the TV.
import { BridgeProvider, bridgeFetch } from './bridge.js';
import { directLaunch } from '../core/tvapp.js';
import { videoSearch, playlistVideos, videoDetails, myPlaylists, googleSignedIn } from '../core/youtube.js';

const APPS = {
  netflix: { re: /netflix/i, androidLink: 'https://www.netflix.com/title', appleBundle: 'com.netflix.Netflix' },
  disney: { re: /disney/i, androidLink: 'https://www.disneyplus.com', appleBundle: 'com.disney.disneyplus' },
  youtube: { re: /youtube(?!\s*music)/i, androidLink: 'https://www.youtube.com', appleBundle: 'com.google.ios.youtube' },
};
export const STREAMING_ADAPTERS = ['androidtv', 'appletv', 'cast', 'youtubetv'];
const LAUNCH = ['androidtv', 'appletv'];
const err = (m) => Object.assign(new Error(m), { userMessage: m });

export class StreamingProvider extends BridgeProvider {
  constructor(meta, { app }) {
    super(meta, { adapter: STREAMING_ADAPTERS, direct: true });
    this.appId = app;
    this.app = APPS[app];
    if (app === 'youtube') this.caps.library = true;
  }
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
    this.caps.library = this.appId === 'youtube';
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

  // ---------- YouTube library ----------
  async libraryRoot() {
    if (this.appId !== 'youtube') return { title: this.name, items: [] };
    let items = [];
    if (googleSignedIn()) {
      try {
        items = (await myPlaylists()).map((p) => ({ id: `pl-${p.id}`, type: 'folder', title: p.name, subtitle: p.subtitle, poster: p.art || '', icon: p.liked ? 'star' : 'list', node: { kind: 'playlist', pl: p, title: p.name } }));
      } catch {}
    }
    return { title: 'YouTube', items, emptyText: 'Tap 🔍 to search YouTube. Sign in with Google (YouTube tile in Music) for your playlists.' };
  }
  async browse(node) {
    if (node.kind === 'root') return this.libraryRoot();
    if (node.kind === 'playlist') return { title: node.title, items: await playlistVideos(node.pl) };
    return { title: '', items: [] };
  }
  searchMedia(q) { return videoSearch(q); }
  details(entry) { return videoDetails(entry.itemId || entry.id); }
  async playMedia(entry) {
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
