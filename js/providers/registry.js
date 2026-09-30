// All services shown on the home ring. Order = clockwise from the top.
import { DemoProvider } from './demo.js';
import { SpotifyProvider } from './spotify.js';
import { AppleProvider } from './apple.js';
import { PlexProvider } from './plex.js';
import { JellyfinProvider } from './jellyfin.js';
import { BridgeProvider } from './bridge.js';
import { YouTubeProvider } from './youtube.js';

// kind: 'oauth' (sign in via redirect/code), 'bridge' (needs bridge/server.js), 'local' (no sign-in)
// icon: Simple Icons slug (https://simpleicons.org, loaded from jsDelivr); falls back to `mono`.
export const SERVICES = [
  { id: 'spotify', name: 'Spotify', mono: 'Sp', icon: 'spotify', color: '#1ed760', kind: 'oauth',
    blurb: 'Remote-control Spotify on any of your devices (Premium needed for control).',
    make: (m) => new SpotifyProvider(m) },
  { id: 'apple', name: 'Apple Music', mono: 'Am', icon: 'applemusic', color: '#fa2d48', kind: 'oauth',
    blurb: 'Plays through this display with MusicKit. Needs an Apple developer token.',
    make: (m) => new AppleProvider(m) },
  { id: 'ytmusic', name: 'YouTube Music', short: 'YT Music', mono: 'YM', icon: 'youtubemusic', color: '#ff3d3d', kind: 'youtube',
    blurb: 'Search and play music from YouTube on this display, with your YouTube Music playlists after Google sign-in.',
    make: (m) => new YouTubeProvider(m, { music: true }) },
  { id: 'youtube', name: 'YouTube', mono: 'YT', icon: 'youtube', color: '#ff0033', kind: 'youtube',
    blurb: 'Play any YouTube video on this display — the video becomes the background in Video view.',
    make: (m) => new YouTubeProvider(m, { music: false }) },
  { id: 'tidal', name: 'Tidal', mono: 'Ti', icon: 'tidal', color: '#33ffee', kind: 'bridge',
    blurb: 'TIDAL has no public remote API, so this follows TIDAL playing through Roon, a Cast device, a UPnP renderer or AirPlay.',
    make: (m) => new BridgeProvider(m, { source: 'tidal' }) },
  { id: 'qobuz', name: 'Qobuz', mono: 'Qb', color: '#4d9dff', kind: 'bridge',
    blurb: 'Qobuz Connect is closed to third parties, so this follows Qobuz playing through Roon, Cast, UPnP or AirPlay.',
    make: (m) => new BridgeProvider(m, { source: 'qobuz' }) },
  { id: 'roon', name: 'Roon', mono: 'Rn', icon: 'roon', color: '#a78bfa', kind: 'bridge',
    blurb: 'Every Roon zone, with playlists and search. Enable "Round Remote" in Roon → Settings → Extensions.',
    make: (m) => new BridgeProvider(m, { adapter: 'roon' }) },
  { id: 'plex', name: 'Plex / Plexamp', short: 'Plex', mono: 'Px', icon: 'plex', color: '#f5b31b', kind: 'oauth',
    blurb: 'Control Plexamp (incl. headless) and Plex players through your server.',
    make: (m) => new PlexProvider(m) },
  { id: 'jellyfin', name: 'Jellyfin', mono: 'Jf', icon: 'jellyfin', color: '#9b6bf2', kind: 'oauth',
    blurb: 'Control any Jellyfin client session: web, Finamp, Jellyfin Media Player, Kodi…',
    make: (m) => new JellyfinProvider(m) },
  { id: 'cast', name: 'Google Cast', short: 'Cast', mono: 'Gc', icon: 'googlecast', color: '#ff8a3d', kind: 'bridge',
    blurb: 'Chromecast, Nest and Cast-enabled speakers on your network.',
    make: (m) => new BridgeProvider(m, { adapter: 'cast' }) },
  { id: 'airplay', name: 'AirPlay', mono: 'Ap', icon: 'airplayaudio', color: '#5ac8fa', kind: 'bridge',
    blurb: 'Turns the Pi into an AirPlay 1/2 speaker (shairport-sync) and remote-controls the phone or Mac that is streaming.',
    make: (m) => new BridgeProvider(m, { adapter: 'airplay' }) },
  { id: 'upnp', name: 'UPnP / DLNA', short: 'UPnP', mono: 'Up', icon: 'dlna', color: '#2dd4bf', kind: 'bridge',
    blurb: 'Any UPnP AV / DLNA renderer: WiiM, Bluesound, Denon/Marantz, BubbleUPnP, Volumio, moOde…',
    make: (m) => new BridgeProvider(m, { adapter: 'upnp' }) },
  { id: 'demo', name: 'Demo', mono: 'De', glyph: 'note', color: '#e5e7eb', kind: 'local',
    blurb: 'A simulated player with fictional songs and lyrics. Try everything without an account.',
    make: (m) => new DemoProvider(m) },
];

const instances = new Map();
export function getService(id) { return SERVICES.find((s) => s.id === id) || null; }
export function provider(id) {
  if (!instances.has(id)) {
    const svc = getService(id);
    if (!svc) return null;
    const { make, ...meta } = svc;
    instances.set(id, make(meta));
  }
  return instances.get(id);
}
export function allProviders() { return SERVICES.map((s) => provider(s.id)); }
