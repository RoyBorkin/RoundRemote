// All services shown on the home ring. Order = clockwise from the top.
import { DemoProvider } from './demo.js';
import { SpotifyProvider } from './spotify.js';
import { AppleProvider } from './apple.js';
import { PlexProvider } from './plex.js';
import { JellyfinProvider } from './jellyfin.js';
import { BridgeProvider } from './bridge.js';
import { YouTubeProvider } from './youtube.js';
import { PlexMediaProvider } from './plex-media.js';
import { JellyfinMediaProvider } from './jellyfin-media.js';
import { HomeAssistantService } from './homeassistant.js';
import { GoogleHomeService } from './googlehome.js';
import { StreamingProvider, STREAMING_ADAPTERS } from './streaming.js';

// section: 'media' = Movies & shows (the home screen's Media side); everything else is music.
// signIn: shares the sign-in of another tile · bridgeAdapter: the bridge adapter behind a bridge tile (default: its id)
// remote: the service is a TV remote (its screen is the D-pad)
// kind: 'hass' (Home Assistant address + token)
// kind: 'oauth' (sign in via redirect/code), 'bridge' (needs bridge/server.js), 'local' (no sign-in)
// icon: Simple Icons slug (https://simpleicons.org, loaded from jsDelivr); falls back to `mono`.
export const SERVICES = [
  { id: 'spotify', name: 'Spotify', mono: 'Sp', icon: 'spotify', color: '#1ed760', kind: 'oauth',
    blurb: 'Remote-control Spotify on any of your devices (Premium needed for control).',
    make: (m) => new SpotifyProvider(m) },
  { id: 'apple', name: 'Apple Music', mono: 'Am', icon: 'applemusic', color: '#fa2d48', kind: 'oauth',
    blurb: 'Control Apple Music in Cider, Sidra or the Windows app on a computer (with the bridge), or play it on this display with MusicKit (needs a developer token).',
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
  { id: 'computer', name: 'Computer', mono: 'PC', glyph: 'desktop', color: '#94a3b8', kind: 'bridge',
    blurb: 'Music and video apps on the computer running the bridge: Apple Music (Cider, Sidra, the Windows app), Spotify desktop, YouTube in the browser, VLC…',
    make: (m) => new BridgeProvider(m, { adapter: ['cider', 'winmedia', 'mpris'] }) },
  { id: 'upnp', name: 'UPnP / DLNA', short: 'UPnP', mono: 'Up', icon: 'dlna', color: '#2dd4bf', kind: 'bridge',
    blurb: 'Any UPnP AV / DLNA renderer: WiiM, Bluesound, Denon/Marantz, BubbleUPnP, Volumio, moOde…',
    make: (m) => new BridgeProvider(m, { adapter: 'upnp' }) },
  { id: 'demo', name: 'Demo', mono: 'De', glyph: 'note', color: '#e5e7eb', kind: 'local',
    blurb: 'A simulated player with fictional songs and lyrics. Try everything without an account.',
    make: (m) => new DemoProvider(m) },

  // ---------------- Movies & shows ----------------
  { id: 'plexvideo', section: 'media', signIn: 'plex', name: 'Plex', mono: 'Px', icon: 'plex', color: '#e5a00d', kind: 'oauth',
    blurb: 'Movies and shows on your Plex server: control Plex on your TV, browse libraries and collections, search, and see cast, info and suggestions.',
    make: (m) => new PlexMediaProvider(m) },
  { id: 'jellyfinvideo', section: 'media', signIn: 'jellyfin', name: 'Jellyfin', mono: 'Jf', icon: 'jellyfin', color: '#00a4dc', kind: 'oauth',
    blurb: 'Movies and shows on your Jellyfin server: control Jellyfin on your TV, browse libraries and collections, search, and see cast, info and suggestions.',
    make: (m) => new JellyfinMediaProvider(m) },
  { id: 'castvideo', section: 'media', bridgeAdapter: 'cast', name: 'Chromecast', mono: 'Cc', icon: 'googlecast', color: '#ff8a3d', kind: 'bridge',
    blurb: 'Whatever is cast to a Chromecast or Google TV: movie or show name, season and episode, progress, skip and volume.',
    make: (m) => new BridgeProvider(m, { adapter: 'cast', prefer: (z) => !!z.state?.track?.media }) },
  { id: 'appletv', section: 'media', name: 'AirPlay · Apple TV', short: 'Apple TV', mono: 'tv', icon: 'appletv', color: '#e5e7eb', kind: 'bridge',
    blurb: 'Apple TV (and what is AirPlayed to it): the movie or show playing in any app, progress, skip, volume, a D-pad remote and your apps. Pairs once with a code on the TV.',
    make: (m) => new BridgeProvider(m, { adapter: 'appletv' }) },
  { id: 'netflix', section: 'media', adapters: STREAMING_ADAPTERS, name: 'Netflix', mono: 'N', icon: 'netflix', color: '#e50914', kind: 'bridge',
    blurb: 'Netflix on your TV: what’s playing (on Apple TV and Chromecast), the remote, and opening Netflix on a Google TV or Apple TV.',
    make: (m) => new StreamingProvider(m, { app: 'netflix' }) },
  { id: 'disney', section: 'media', adapters: STREAMING_ADAPTERS, name: 'Disney+', mono: 'D+', icon: 'disneyplus', color: '#2c6bff', kind: 'bridge',
    blurb: 'Disney+ on your TV: the title, season and episode (on Apple TV and Chromecast), the remote, and opening Disney+ on a Google TV or Apple TV.',
    make: (m) => new StreamingProvider(m, { app: 'disney' }) },
  { id: 'ytvideo', section: 'media', adapters: STREAMING_ADAPTERS, name: 'YouTube', mono: 'YT', icon: 'youtube', color: '#ff0033', kind: 'bridge',
    blurb: 'YouTube on your TV: search YouTube and your playlists, play videos on the TV (YouTube on your TV, Google TV or Apple TV), with the remote.',
    make: (m) => new StreamingProvider(m, { app: 'youtube' }) },
  { id: 'androidtv', section: 'media', remote: true, name: 'Google TV', short: 'Google TV', mono: 'TV', glyph: 'tv', color: '#4285f4', kind: 'bridge',
    blurb: 'A remote for Google TV / Android TV (Chromecast with Google TV, Sony, TCL, Philips, Shield…): D-pad, Back, Home, power, volume, play/pause and your apps. Pairs once with a code on the TV — or works with no bridge at all through the free TV Remote app on the TV.',
    make: (m) => new BridgeProvider(m, { adapter: 'androidtv', direct: true }) },

  // ---------------- Home (smart home) ----------------
  { id: 'homeassistant', section: 'home', name: 'Home Assistant', short: 'Home Assistant', mono: 'HA', icon: 'homeassistant', color: '#18bcf2', kind: 'hass',
    blurb: 'Your whole Home Assistant: favourites, rooms and scenes, with round controls for lights, climate, blinds, fans, locks, speakers, cameras and sensors.',
    make: (m) => new HomeAssistantService(m) },
  { id: 'googlehome', section: 'home', name: 'Google Home', mono: 'GH', icon: 'googlehome', color: '#4285f4', kind: 'bridge',
    blurb: 'Tell Google Assistant what to do — your own command tiles, routines, broadcasts — and control your Google / Nest speakers and displays.',
    make: (m) => new GoogleHomeService(m) },
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
export const inSection = (svc, section) => (svc.section || 'music') === section;
export const adapterOf = (svc) => svc.bridgeAdapter || svc.id;
/** Bridge adapters a tile needs (any one enabled is enough). */
export const adaptersOf = (svc) => svc.adapters || (svc.id === 'computer' ? ['cider', 'winmedia', 'mpris'] : [adapterOf(svc)]);
export function allProviders() { return SERVICES.map((s) => provider(s.id)); }
