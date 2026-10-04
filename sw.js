// Round Remote service worker — makes the app installable and load offline.
// Strategy: network-first for the app's own files (so updates show up immediately when
// online), falling back to the cache when offline. Music-service APIs are never cached.
const VERSION = 'rr-4.1.2';
const SHELL = [
    "apps/apps.css",
    "apps/bg-catan.js",
    "apps/bg-clue.js",
    "apps/bg-coin.js",
    "apps/bg-dice-engine.js",
    "apps/bg-dice.js",
    "apps/bg-games.js",
    "apps/bg-jungle.js",
    "apps/bg-monopoly.js",
    "apps/bg-rules.js",
    "apps/bg-rulesview.js",
    "apps/bg-scores.js",
    "apps/bg-sheets.js",
    "apps/bg-taki.js",
    "apps/bg-ttr.js",
    "apps/bg-twister.js",
    "apps/bg-ui.js",
    "apps/boardgames.css",
    "apps/boardgames.js",
    "apps/bottle.css",
    "apps/bottle.js",
    "apps/calc.css",
    "apps/calc.js",
    "apps/clock-alarms.js",
    "apps/clock-cities.js",
    "apps/clock-ring.js",
    "apps/clock.css",
    "apps/clock.js",
    "apps/hub.js",
    "apps/index.js",
    "apps/qr.js",
    "apps/random-data.js",
    "apps/random.css",
    "apps/random.js",
    "apps/shell.js",
    "apps/tasks-packs.js",
    "apps/tasks-store.js",
    "apps/tasks.css",
    "apps/tasks.js",
    "apps/timer.css",
    "apps/timer.js",
    "rhythm/hits-bingo.js",
    "rhythm/hits-deck.js",
    "rhythm/hits-text.js",
    "rhythm/hits-ui.js",
    "rhythm/hits-update.js",
    "./",
    "index.html",
    "manifest.webmanifest",
    "css/app.css",
    "css/themes.css",
    "js/core/color.js",
    "js/core/nav.js",
    "js/core/player.js",
    "js/core/router.js",
    "js/core/store.js",
    "js/core/util.js",
    "js/views/video.js",
    "js/views/lyrics-kinetic2.js",
    "js/views/lyrics-kinetic3.js",
    "js/views/lyrics-crt.js",
    "js/views/tone.js",
    "js/views/facts.js",
    "js/core/songinfo.js",
    "js/views/tone-visuals.js",
    "js/core/sound.js",
    "js/providers/youtube.js",
    "js/core/youtube.js",
    "js/lyrics/lrc.js",
    "js/lyrics/bidi.js",
    "js/main.js",
    "js/providers/apple.js",
    "js/providers/base.js",
    "js/providers/bridge.js",
    "js/providers/demo.js",
    "js/providers/jellyfin.js",
    "js/providers/plex.js",
    "js/providers/plex-media.js",
    "js/providers/jellyfin-media.js",
    "js/screens/media.js",
    "js/screens/media-panels.js",
    "js/views/media-library.js",
    "js/core/mediainfo.js",
    "js/core/profiles.js",
    "js/core/languages.js",
    "js/views/media-views.js",
    "js/providers/streaming.js",
    "js/providers/homeassistant.js",
    "js/core/tvapp.js",
    "js/core/theme.js",
    "js/views/vinyl-styles.js",
    "js/views/deck-styles.js",
    "js/views/decks.js",
    "js/ui/backdrops-console.js",
    "js/ui/backdrops-themes.js",
    "js/ui/backdrops-util.js",
    "js/ui/backdrops.js",
    "css/vinyl.css",
    "css/decks.css",
    "games/blocks.js",
    "games/bricks.js",
    "games/bubbles.js",
    "games/connect4.js",
    "games/dino.js",
    "games/dino-pixels.js",
    "games/floppy.js",
    "games/g2048.js",
    "games/games.css",
    "games/grow.js",
    "games/hit.js",
    "games/hub.js",
    "games/index.js",
    "games/flow-gen.js",
    "games/flow.js",
    "games/hop.js",
    "games/marbles-gen.js",
    "games/orbits-levels.js",
    "games/orbits.js",
    "games/rope-levels.js",
    "games/rope.js",
    "games/rps-ai.js",
    "games/rps.js",
    "games/zoo.js",
    "games/invaders.js",
    "games/jetpack.js",
    "games/kit.js",
    "games/marbles-paths.js",
    "games/marbles.js",
    "games/mines.js",
    "games/perfect.js",
    "games/pong-power.js",
    "games/pong.js",
    "games/running.js",
    "games/rushhour-levels.js",
    "games/rushhour.js",
    "games/scores.js",
    "games/shell.js",
    "games/stack.js",
    "games/subway.js",
    "games/temple.js",
    "games/tictactoe.js",
    "rhythm/rhythm.css",
    "rhythm/index.js",
    "rhythm/chrono-map.js",
    "rhythm/spin-chart.js",
    "rhythm/hub.js",
    "rhythm/session.js",
    "rhythm/store.js",
    "rhythm/clock.js",
    "rhythm/kit.js",
    "rhythm/analyzer.js",
    "rhythm/analyzer-worker.js",
    "rhythm/chart.js",
    "rhythm/synth.js",
    "rhythm/bridge-audio.js",
    "rhythm/charts.js",
    "rhythm/charts-data.js",
    "rhythm/charts-sng.js",
    "rhythm/dsp-fft.js",
    "rhythm/dsp-features.js",
    "rhythm/dsp-post.js",
    "rhythm/dsp-songs.js",
    "rhythm/hits.js",
    "rhythm/hits-songs.js",
    "rhythm/frets.js",
    "rhythm/tiles.js",
    "rhythm/chrono.js",
    "rhythm/circles.js",
    "rhythm/spin.js",
    "js/providers/googlehome.js",
    "js/screens/smarthome.js",
    "js/screens/consoles.js",
    "js/providers/playstation.js",
    "js/providers/steam.js",
    "css/consoles.css",
    "js/screens/streamer.js",
    "js/providers/streamer.js",
    "css/streamer.css",
    "js/views/ha-controls.js",
    "js/providers/registry.js",
    "js/providers/spotify.js",
    "js/screens/connect.js",
    "js/screens/home.js",
    "js/screens/panels.js",
    "js/screens/player.js",
    "js/screens/settings.js",
    "js/ui/dom.js",
    "js/ui/icons.js",
    "js/ui/keyboard.js",
    "js/ui/overlay.js",
    "js/views/info.js",
    "js/views/lyrics-extra.js",
    "js/views/lyrics.js",
    "js/views/vinyl.js",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/maskable-512.png",
    "icons/apple-touch-icon.png"
  ];
// Fonts and the platform icons (Simple Icons on jsDelivr) never change: cache-first.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: cache-first (they never change).
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      // Opaque (no-cors) responses are only safe to cache for Google Fonts' stylesheet requests.
      if (res.ok || (res.type === 'opaque' && url.hostname.startsWith('fonts.'))) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return; // APIs, bridge, artwork: straight to network

  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    try {
      const res = await Promise.race([fetch(req), timeout(4000)]);
      if (res.ok) c.put(req.mode === 'navigate' ? './' : req, res.clone());
      return res;
    } catch {
      const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./') : null);
      return hit || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
