// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The TV apps catalog — one list for every TV remote (Google TV / Android TV through the bridge, Home Assistant's
// "Android TV Remote" integration, the "TV Remote" app on the TV; Apple TV borrows the icons and colours by name).
// Plain data, no imports: the round apps grid (js/screens/tvapps.js) and the settings page read it, and tests can
// import it in Node.
//
// Each app: { id, name, short?, he?, pkg, link?, color, cat, region, si?, mono?, tv?, alias?, key? }
//   pkg     Android package id — checked on Google Play (https://play.google.com/store/apps/details?id=<pkg>)
//           in Oct 2026; 'system' entries are built into the TV and have no store page.
//   link    a deep link the app opens from (Home Assistant and the bridge open apps by link: launching by package
//           — market://launch?id=<pkg> — opens the app on most TVs, but some Google TV builds show its Play page instead)
//   cat     il · stream · music · kids · sports · news · games · tools        region: 'il' | 'global'
//   si      Simple Icons slug (https://simpleicons.org) for the logo when the bridge can't fetch the real icon
//   mono    the letters on the plain tile when there's no logo
//   tv      false = Google Play has only a phone / tablet version (it opens only if it's on the TV anyway)
//   alias   the name the "TV Remote" app (Legvan/tv-remote) opens it by (else the package name)
//   key     a remote key instead of an app (Settings)

export const TV_APP_CATEGORIES = [
  ['il', 'Israeli TV', 'ערוצי ישראל'], ['stream', 'Streaming', 'סטרימינג'], ['music', 'Music', 'מוזיקה'], ['kids', 'Kids', 'ילדים'],
  ['sports', 'Sports', 'ספורט'], ['news', 'News', 'חדשות'], ['games', 'Games', 'משחקים'], ['tools', 'Tools', 'כלים'],
];

export const TV_APP_CATALOG = [
  // ---------------- Israeli TV
  { id: 'mako12', name: '12+ Keshet', short: '12+', he: 'קשת 12+', pkg: 'com.keshet.mako.VODAndroidTV', color: '#1e5bd7', cat: 'il', region: 'il', mono: '12' },
  { id: 'kan', name: 'Kan 11 · Kan Box', short: 'Kan', he: 'כאן 11 · כאן BOX', pkg: 'com.applicaster.il.ch1', color: '#26282b', cat: 'il', region: 'il', mono: 'כאן' },
  { id: 'reshet13', name: '13+ Reshet', short: '13+', he: 'רשת 13+', pkg: 'com.applicaster.iReshet', color: '#d4145a', cat: 'il', region: 'il', mono: '13' },
  { id: 'now14', name: 'Now 14', he: 'עכשיו 14', pkg: 'com.channelfourteen.univ', color: '#0b3d91', cat: 'il', region: 'il', mono: '14' },
  { id: 'i24', name: 'i24NEWS', he: 'i24NEWS', pkg: 'tv.accedo.ott.flow.i24news', color: '#d6001c', cat: 'news', region: 'il', mono: 'i24' },
  { id: 'yesplus', name: 'yes+', he: 'yes+', pkg: 'il.co.yes.yesgo', color: '#00a8e6', cat: 'il', region: 'il', mono: 'yes' },
  { id: 'sting', name: 'STING+', he: 'STING+', pkg: 'il.co.stingtv.atv', color: '#e6007e', cat: 'il', region: 'il', mono: 'S+' },
  { id: 'nexttv', name: 'NEXT TV · HOT', short: 'NEXT TV', he: 'NEXT TV של HOT', pkg: 'com.hotnext', color: '#e3051b', cat: 'il', region: 'il', mono: 'HOT' },
  { id: 'partnertv', name: 'Partner tv+', he: 'פרטנר tv+', pkg: 'il.co.partnertv.atv', color: '#00a99d', cat: 'il', region: 'il', mono: 'P' },
  { id: 'cellcomtv', name: 'Cellcom tv', he: 'סלקום tv', pkg: 'com.cellcom.cellcom_tv.lab', color: '#5b2c86', cat: 'il', region: 'il', mono: 'C' },
  { id: 'freetv', name: 'FreeTV', he: 'FreeTV', pkg: 'tv.freetv.androidtv', color: '#ff5a1f', cat: 'il', region: 'il', mono: 'F' },
  { id: 'hotplay', name: 'HOT play', he: 'HOT play', pkg: 'com.applicaster.il.hotvod', color: '#c8102e', cat: 'il', region: 'il', mono: 'HOT', tv: false },
  { id: 'n12', name: 'N12 News', he: 'חדשות 12', pkg: 'com.channel2.mobile.ui', color: '#e2231a', cat: 'news', region: 'il', mono: 'N12', tv: false },
  { id: 'c14', name: 'C14 News', he: 'C14 החדשות', pkg: 'com.gaiamobile.channel20', color: '#0b3d91', cat: 'news', region: 'il', mono: 'C14', tv: false },
  { id: 'live14', name: '14 LIVE', he: '14 LIVE', pkg: 'com.channel.fourteen.univ', color: '#163f8c', cat: 'news', region: 'il', mono: '14', tv: false },
  { id: 'sport5', name: 'Sport 5', he: 'ספורט 5', pkg: 'com.rge.sport5', color: '#e4032e', cat: 'sports', region: 'il', mono: '5', tv: false },
  { id: 'sport1', name: 'Sport 1', he: 'ספורט 1', pkg: 'com.sport2.msport2', color: '#0057b8', cat: 'sports', region: 'il', mono: '1', tv: false },
  { id: 'one', name: 'ONE Sport', he: 'ONE ספורט', pkg: 'com.tss.one', color: '#f05a28', cat: 'sports', region: 'il', mono: 'ONE', tv: false },
  { id: 'kanedu', name: 'Kan Educational', he: 'כאן חינוכית', pkg: 'com.channel23', color: '#f39200', cat: 'kids', region: 'il', mono: 'כ', tv: false },

  // ---------------- streaming
  { id: 'youtube', name: 'YouTube', pkg: 'com.google.android.youtube.tv', link: 'https://www.youtube.com', color: '#ff0033', cat: 'stream', region: 'global', si: 'youtube', alias: 'youtube' },
  { id: 'netflix', name: 'Netflix', pkg: 'com.netflix.ninja', link: 'https://www.netflix.com/title', color: '#e50914', cat: 'stream', region: 'global', si: 'netflix', alias: 'netflix' },
  { id: 'disney', name: 'Disney+', pkg: 'com.disney.disneyplus', link: 'https://www.disneyplus.com', color: '#0f3cc9', cat: 'stream', region: 'global', mono: 'D+', alias: 'disney' },
  { id: 'prime', name: 'Prime Video', pkg: 'com.amazon.amazonvideo.livingroom', link: 'https://app.primevideo.com', color: '#00a8e1', cat: 'stream', region: 'global', si: 'primevideo', alias: 'prime' },
  { id: 'appletv', name: 'Apple TV', pkg: 'com.apple.atve.androidtv.appletv', color: '#1d1d1f', cat: 'stream', region: 'global', si: 'appletv' },
  { id: 'max', name: 'HBO Max', pkg: 'com.wbd.stream', color: '#002be7', cat: 'stream', region: 'global', si: 'hbomax' },
  { id: 'paramount', name: 'Paramount+', pkg: 'com.cbs.ott', color: '#0064ff', cat: 'stream', region: 'global', si: 'paramountplus' },
  { id: 'plex', name: 'Plex', pkg: 'com.plexapp.android', link: 'plex://', color: '#e5a00d', cat: 'stream', region: 'global', si: 'plex' },
  { id: 'jellyfin', name: 'Jellyfin', pkg: 'org.jellyfin.androidtv', color: '#00a4dc', cat: 'stream', region: 'global', si: 'jellyfin' },
  { id: 'emby', name: 'Emby', pkg: 'tv.emby.embyatv', color: '#52b54b', cat: 'stream', region: 'global', si: 'emby' },
  { id: 'kodi', name: 'Kodi', pkg: 'org.xbmc.kodi', color: '#17b2e7', cat: 'stream', region: 'global', si: 'kodi', alias: 'kodi' },
  { id: 'twitch', name: 'Twitch', pkg: 'tv.twitch.android.app', link: 'twitch://home', color: '#9146ff', cat: 'stream', region: 'global', si: 'twitch' },
  { id: 'ted', name: 'TED', pkg: 'com.ted.android.tv', color: '#e62b1e', cat: 'stream', region: 'global', si: 'ted' },
  { id: 'pluto', name: 'Pluto TV', pkg: 'tv.pluto.android', color: '#2d2d8f', cat: 'stream', region: 'global', mono: 'P' },
  { id: 'tubi', name: 'Tubi', pkg: 'com.tubitv', color: '#7408ff', cat: 'stream', region: 'global', si: 'tubi' },
  { id: 'crunchyroll', name: 'Crunchyroll', pkg: 'com.crunchyroll.crunchyroid', color: '#f47521', cat: 'stream', region: 'global', si: 'crunchyroll' },
  { id: 'mubi', name: 'MUBI', pkg: 'com.mubi', color: '#0a0a0a', cat: 'stream', region: 'global', si: 'mubi' },
  { id: 'stremio', name: 'Stremio', pkg: 'com.stremio.one', color: '#7b5bf5', cat: 'stream', region: 'global', si: 'stremio' },

  // ---------------- music
  { id: 'spotify', name: 'Spotify', pkg: 'com.spotify.tv.android', link: 'spotify://', color: '#1ed760', cat: 'music', region: 'global', si: 'spotify', alias: 'spotify' },
  { id: 'ytmusic', name: 'YouTube Music', pkg: 'com.google.android.youtube.tvmusic', link: 'https://music.youtube.com', color: '#ff0000', cat: 'music', region: 'global', si: 'youtubemusic' },
  { id: 'tidal', name: 'TIDAL', pkg: 'com.aspiro.tidal', color: '#111111', cat: 'music', region: 'global', si: 'tidal' },
  { id: 'qobuz', name: 'Qobuz', pkg: 'com.qobuz.music', color: '#0070ef', cat: 'music', region: 'global', mono: 'Qb' },
  { id: 'deezer', name: 'Deezer', pkg: 'deezer.android.tv', color: '#a238ff', cat: 'music', region: 'global', si: 'deezer' },
  { id: 'soundcloud', name: 'SoundCloud', pkg: 'com.soundcloud.android', color: '#ff5500', cat: 'music', region: 'global', si: 'soundcloud' },
  { id: 'tunein', name: 'TuneIn Radio', pkg: 'tunein.player', color: '#1c203c', cat: 'music', region: 'global', si: 'tunein' },
  { id: 'applemusic', name: 'Apple Music', pkg: 'com.apple.android.music', color: '#fa2d48', cat: 'music', region: 'global', si: 'applemusic', tv: false },

  // ---------------- kids
  { id: 'ytkids', name: 'YouTube Kids', pkg: 'com.google.android.apps.youtube.kids', color: '#ff0000', cat: 'kids', region: 'global', si: 'youtubekids' },

  // ---------------- sports
  { id: 'dazn', name: 'DAZN', pkg: 'com.dazn', color: '#0c161c', cat: 'sports', region: 'global', si: 'dazn' },

  // ---------------- games
  { id: 'steamlink', name: 'Steam Link', pkg: 'com.valvesoftware.steamlink', color: '#1b2838', cat: 'games', region: 'global', si: 'steam' },
  { id: 'geforcenow', name: 'GeForce NOW', short: 'GeForce NOW', pkg: 'com.nvidia.geforcenow', color: '#76b900', cat: 'games', region: 'global', si: 'nvidia' },
  { id: 'moonlight', name: 'Moonlight', pkg: 'com.limelight', color: '#3f51b5', cat: 'games', region: 'global', mono: 'M' },

  // ---------------- tools & system
  { id: 'settings', name: 'Settings', he: 'הגדרות', pkg: 'com.android.tv.settings', color: '#5f6b7a', cat: 'tools', region: 'global', glyph: 'settings', key: 'settings', alias: 'settings', system: true },
  { id: 'playstore', name: 'Google Play', he: 'חנות Play', pkg: 'com.android.vending', color: '#01875f', cat: 'tools', region: 'global', si: 'googleplay', system: true },
  { id: 'tvbro', name: 'TV Bro browser', short: 'TV Bro', pkg: 'com.phlox.tvwebbrowser', color: '#2e7d32', cat: 'tools', region: 'global', mono: 'Br' },
  { id: 'vlc', name: 'VLC', pkg: 'org.videolan.vlc', color: '#ff8800', cat: 'tools', region: 'global', si: 'vlcmediaplayer' },
  { id: 'xplore', name: 'X-plore files', short: 'X-plore', pkg: 'com.lonelycatgames.Xplore', color: '#1565c0', cat: 'tools', region: 'global', mono: 'X' },
  { id: 'downloader', name: 'Downloader', pkg: 'com.esaba.downloader', color: '#f57c00', cat: 'tools', region: 'global', mono: 'D' },
  { id: 'sendfiles', name: 'Send files to TV', short: 'Send files', pkg: 'com.yablio.sendfilestotv', color: '#00897b', cat: 'tools', region: 'global', mono: 'SF' },
  { id: 'airscreen', name: 'AirScreen', pkg: 'com.ionitech.airscreen', color: '#1e88e5', cat: 'tools', region: 'global', mono: 'AS' },
];

/** Shown on a new remote, in this order: Israel first, then the big streamers. */
export const TV_APPS_DEFAULT = ['mako12', 'kan', 'reshet13', 'now14', 'i24', 'youtube', 'netflix', 'disney', 'prime', 'appletv', 'spotify', 'ytmusic', 'plex', 'settings'];

const byId = new Map(TV_APP_CATALOG.map((a) => [a.id, a]));
const byPkg = new Map(TV_APP_CATALOG.map((a) => [a.pkg.toLowerCase(), a]));
// older ids the streaming tiles and earlier versions used
const ALIASES = { ytvideo: 'youtube', disneyplus: 'disney', primevideo: 'prime', hbo: 'max', amazon: 'prime' };

/** A catalog app by id, package or old alias (null when unknown). */
export function catalogApp(x) {
  if (!x) return null;
  const s = String(x);
  return byId.get(s) || byId.get(ALIASES[s]) || byPkg.get(s.toLowerCase()) || null;
}
// Apple TV's own names for its apps
const NAME_ALIASES = { tv: 'appletv', appletv: 'appletv', music: 'applemusic', max: 'max', hbomax: 'max', primevideo: 'prime', amazonprimevideo: 'prime',
  // short names people give the Israeli apps (Home Assistant's app list, Apple TV)
  kan: 'kan', kanbox: 'kan', kan11: 'kan', כאן: 'kan', mako: 'mako12', keshet: 'mako12', keshet12: 'mako12', '12': 'mako12', reshet: 'reshet13', reshet13: 'reshet13', '13': 'reshet13',
  now14: 'now14', channel14: 'now14', '14': 'now14', yes: 'yesplus', sting: 'sting', stingtv: 'sting', hot: 'nexttv', next: 'nexttv', partner: 'partnertv', cellcom: 'cellcomtv' };
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
/** A catalog app by its display name (Apple TV lists apps by name), loosely. */
export function catalogAppByName(name) {
  const n = fold(name);
  if (!n) return null;
  if (NAME_ALIASES[n]) return byId.get(NAME_ALIASES[n]);
  const exact = TV_APP_CATALOG.find((a) => fold(a.name) === n || (a.he && fold(a.he) === n));
  if (exact || n.length < 4) return exact || null;
  // "Prime Video" ↔ "Amazon Prime Video", "Kan" ↔ "Kan 11 · Kan Box": the longest name that one starts with
  let best = null;
  for (const a of TV_APP_CATALOG) {
    const f = fold(a.name);
    if (f.length >= 4 && (n.startsWith(f) || f.startsWith(n)) && (!best || f.length > fold(best.name).length)) best = a;
  }
  return best;
}
/** Which catalog app a package / activity / app link the TV reports belongs to. */
export function appFromActivity(act) {
  const s = String(act || '').trim();
  if (!s) return null;
  const pkg = s.split('/')[0];
  return byPkg.get(pkg.toLowerCase()) || TV_APP_CATALOG.find((a) => a.link && s.startsWith(a.link)) || null;
}

const HEB = /[֐-׿]/;
/** The letters for a plain tile: the app's own `mono`, else initials (Hebrew names: their first letters). */
export function monogram(app) {
  if (app?.mono) return app.mono;
  const name = String(app?.name || '?').trim();
  if (HEB.test(name)) return name.replace(/[^א-ת\s]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || name[0];
  const words = name.split(/[\s\-·+]+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).replace(/^./, (c) => c.toUpperCase());
}

/** Valid Android package name? (two or more dot-separated parts of letters, digits and underscores) */
export const isPackage = (s) => /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(String(s || '').trim()) && String(s).length <= 150;

/** What to send to open an app: the link Home Assistant / the bridge open (a deep link, else market://launch?id=). */
export function appLink(app) {
  if (!app) return '';
  if (app.link) return app.link;
  return app.pkg ? `market://launch?id=${app.pkg}` : '';
}
/** A stable brand colour for apps you add yourself (from the package name). */
export function colorFor(s) {
  let h = 0;
  for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 62% 44%)`;
}
