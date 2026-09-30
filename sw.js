// Round Remote service worker — makes the app installable and load offline.
// Strategy: network-first for the app's own files (so updates show up immediately when
// online), falling back to the cache when offline. Music-service APIs are never cached.
const VERSION = 'rr-2.3.0';
const SHELL = [
    "./",
    "index.html",
    "manifest.webmanifest",
    "css/app.css",
    "js/core/color.js",
    "js/core/nav.js",
    "js/core/player.js",
    "js/core/router.js",
    "js/core/store.js",
    "js/core/util.js",
    "js/views/video.js",
    "js/providers/youtube.js",
    "js/core/youtube.js",
    "js/lyrics/lrc.js",
    "js/main.js",
    "js/providers/apple.js",
    "js/providers/base.js",
    "js/providers/bridge.js",
    "js/providers/demo.js",
    "js/providers/jellyfin.js",
    "js/providers/plex.js",
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
