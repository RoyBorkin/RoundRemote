// All services shown on the home ring. Order = clockwise from the top.
import { DemoProvider } from './demo.js';
import { SpotifyProvider } from './spotify.js';
import { AppleProvider } from './apple.js';
import { PlexProvider } from './plex.js';
import { JellyfinProvider } from './jellyfin.js';
import { BridgeProvider } from './bridge.js';

// kind: 'oauth' (sign in via redirect/code), 'bridge' (needs bridge/server.js), 'local' (no sign-in)
export const SERVICES = [
  { id: 'spotify', name: 'Spotify', mono: 'Sp', color: '#1ed760', kind: 'oauth',
    blurb: 'Remote-control Spotify on any of your devices (Premium needed for control).',
    make: (m) => new SpotifyProvider(m) },
  { id: 'apple', name: 'Apple Music', mono: 'Am', color: '#fa2d48', kind: 'oauth',
    blurb: 'Plays through this display with MusicKit. Needs an Apple developer token.',
    make: (m) => new AppleProvider(m) },
  { id: 'tidal', name: 'Tidal', mono: 'Ti', color: '#33ffee', kind: 'bridge',
    blurb: 'TIDAL has no public remote API, so this follows TIDAL playing through Roon, a Cast device, a UPnP renderer or AirPlay.',
    make: (m) => new BridgeProvider(m, { source: 'tidal' }) },
  { id: 'qobuz', name: 'Qobuz', mono: 'Qb', color: '#4d9dff', kind: 'bridge',
    blurb: 'Qobuz Connect is closed to third parties, so this follows Qobuz playing through Roon, Cast, UPnP or AirPlay.',
    make: (m) => new BridgeProvider(m, { source: 'qobuz' }) },
  { id: 'roon', name: 'Roon', mono: 'Rn', color: '#a78bfa', kind: 'bridge',
    blurb: 'Every Roon zone, with playlists and search. Enable "Round Remote" in Roon → Settings → Extensions.',
    make: (m) => new BridgeProvider(m, { adapter: 'roon' }) },
  { id: 'plex', name: 'Plex / Plexamp', mono: 'Px', color: '#f5b31b', kind: 'oauth',
    blurb: 'Control Plexamp (incl. headless) and Plex players through your server.',
    make: (m) => new PlexProvider(m) },
  { id: 'jellyfin', name: 'Jellyfin', mono: 'Jf', color: '#9b6bf2', kind: 'oauth',
    blurb: 'Control any Jellyfin client session: web, Finamp, Jellyfin Media Player, Kodi…',
    make: (m) => new JellyfinProvider(m) },
  { id: 'cast', name: 'Google Cast', mono: 'Gc', color: '#ff8a3d', kind: 'bridge',
    blurb: 'Chromecast, Nest and Cast-enabled speakers on your network.',
    make: (m) => new BridgeProvider(m, { adapter: 'cast' }) },
  { id: 'airplay', name: 'AirPlay', mono: 'Ap', color: '#5ac8fa', kind: 'bridge',
    blurb: 'Turns the Pi into an AirPlay 1/2 speaker (shairport-sync) and remote-controls the phone or Mac that is streaming.',
    make: (m) => new BridgeProvider(m, { adapter: 'airplay' }) },
  { id: 'upnp', name: 'UPnP / DLNA', mono: 'Up', color: '#2dd4bf', kind: 'bridge',
    blurb: 'Any UPnP AV / DLNA renderer: WiiM, Bluesound, Denon/Marantz, BubbleUPnP, Volumio, moOde…',
    make: (m) => new BridgeProvider(m, { adapter: 'upnp' }) },
  { id: 'demo', name: 'Demo', mono: 'De', color: '#e5e7eb', kind: 'local',
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
