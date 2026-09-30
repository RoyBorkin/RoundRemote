// Round Remote — boot, routing, OAuth redirects, keyboard shortcuts, idle dimming.
import { store } from './core/store.js';
import { player } from './core/player.js';
import { initRouter, register, go, currentScreen } from './core/router.js';
import { openService } from './core/nav.js';
import { SERVICES, provider } from './providers/registry.js';
import { bridgeInfo } from './providers/bridge.js';
import { setOverlayRoot, toast, topPanel, closeAllPanels } from './ui/overlay.js';
import { HomeScreen } from './screens/home.js';
import { PlayerScreen } from './screens/player.js';
import { MediaScreen } from './screens/media.js';
import { ConnectScreen } from './screens/connect.js';
import { SettingsScreen } from './screens/settings.js';
import { openVolume, openLibrary, openSearch } from './screens/panels.js';

const app = document.getElementById('app');
initRouter(app);
setOverlayRoot(app);

let playerScreen = null;
register('home', () => { closeAllPanels(); return HomeScreen(); });
register('player', () => { playerScreen = PlayerScreen(); return playerScreen; });
let mediaScreen = null;
register('media', () => { mediaScreen = MediaScreen(); return mediaScreen; });
register('connect', (p) => { closeAllPanels(); return ConnectScreen(p); });
register('settings', () => { closeAllPanels(); return SettingsScreen(); });

// ---------- control size (XS … XL; L is the original size) ----------
export const UI_SIZES = { XS: 0.7, S: 0.8, M: 0.9, L: 1, XL: 1.12 };
const applyUi = () => app.style.setProperty('--ui', UI_SIZES[store.get('uiSize')] || 1);
applyUi();
store.on('change:uiSize', applyUi);

// Animated and Moving Words used to be separate lyric styles; they're Kinetic Type variants now.
if (['animated', 'kinetic'].includes(store.get('lyricsStyle'))) {
  store.set('typoVariant', store.get('lyricsStyle') === 'animated' ? 'animated' : 'moving');
  store.set('lyricsStyle', 'typo');
}

// Record speed used to be a scratch-only setting with other values; map old values over.
{
  const v = store.get('vinylSecondsPerTurn');
  if (![1.333, 1.8, 3.75, 7.5, 15].includes(v)) store.set('vinylSecondsPerTurn', v <= 2 || v === 12 ? 1.8 : v <= 5 ? 3.75 : v <= 10 ? 7.5 : 15);
}

// ---------- low-power look ----------
const applyLite = () => app.classList.toggle('lite', !!store.get('liteMode'));
applyLite();
store.on('change:liteMode', applyLite);

// ---------- idle dimming ----------
let lastInput = Date.now();
const wake = (e) => { lastInput = Date.now(); if (e.type !== 'pointerdown') app.classList.remove('dim'); };
['pointerdown', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, wake, { capture: true, passive: true }));
setInterval(() => {
  const mins = store.get('dimAfterMin');
  if (!mins) return;
  const idle = Date.now() - lastInput > mins * 60000;
  app.classList.toggle('dim', idle && !player.state.isPlaying);
}, 5000);
// Tapping a dimmed screen only wakes it.
app.addEventListener('pointerdown', (e) => {
  if (!app.classList.contains('dim')) return;
  app.classList.remove('dim');
  e.stopPropagation(); e.preventDefault();
  // swallow the matching click too
  window.addEventListener('click', (c) => { c.stopPropagation(); c.preventDefault(); }, { capture: true, once: true });
}, true);

// ---------- keyboard / rotary-encoder shortcuts ----------
window.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, textarea')) { if (e.key === 'Escape') topPanel()?.close(); return; }
  const inPlayer = currentScreen() === 'player';
  const inMedia = currentScreen() === 'media';
  const k = e.key;
  if (inMedia) {
    if (k === 'Escape') { if (topPanel()) topPanel().close(); else go('home'); return; }
    const skip = (key) => (store.get(key) || 10) * 1000;
    const m = {
      ' ': () => player.toggle(), k: () => player.toggle(), MediaPlayPause: () => player.toggle(),
      ArrowRight: () => player.seekBy(skip('mediaSkipFwd')), ArrowLeft: () => player.seekBy(-skip('mediaSkipBack')),
      ArrowUp: () => player.caps.volume && player.setVolume((player.state.volume ?? 50) + 5),
      ArrowDown: () => player.caps.volume && player.setVolume((player.state.volume ?? 50) - 5),
      n: () => player.next(), MediaTrackNext: () => player.next(), p: () => player.prev(), MediaTrackPrevious: () => player.prev(),
      l: () => mediaScreen?.setTab?.('lib'), v: () => openVolume(),
    }[k];
    if (m) { e.preventDefault(); m(); mediaScreen?.showChrome?.(); }
    return;
  }
  if (k === 'Escape') { if (topPanel()) topPanel().close(); else if (inPlayer) go('home'); return; }
  if (!inPlayer) return;
  const map = {
    ' ': () => player.toggle(), k: () => player.toggle(), MediaPlayPause: () => player.toggle(),
    ArrowRight: () => player.seekBy(10000), ArrowLeft: () => player.seekBy(-10000),
    ArrowUp: () => player.caps.volume && player.setVolume((player.state.volume ?? 50) + 5),
    ArrowDown: () => player.caps.volume && player.setVolume((player.state.volume ?? 50) - 5),
    n: () => player.next(), MediaTrackNext: () => player.next(),
    p: () => player.prev(), MediaTrackPrevious: () => player.prev(),
    1: () => playerScreen?.setView('info'), 2: () => playerScreen?.setView('vinyl'), 3: () => playerScreen?.setView('lyrics'), 4: () => playerScreen?.setView('video'), 5: () => playerScreen?.setView('tone'), 6: () => playerScreen?.setView('facts'),
    l: () => playerScreen?.cycleLyricStyle(), v: () => openVolume(), '/': () => openSearch(), b: () => openLibrary(),
  };
  const fn = map[k] || map[k.toLowerCase?.()];
  if (fn) { e.preventDefault(); fn(); playerScreen?.showChrome(); }
});

// ---------- boot ----------
async function boot() {
  // Optional defaults from the bridge's config.json (client IDs, server URLs…).
  const info = await Promise.race([bridgeInfo({ passive: true }), new Promise((r) => setTimeout(() => r(null), 2500))]);
  if (info?.config) store.applyRemoteDefaults(info.config);

  // OAuth / PIN redirects.
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error') || params.has('plexpin')) {
    history.replaceState({}, document.title, location.pathname);
    for (const svc of SERVICES) {
      const p = provider(svc.id);
      try {
        if (await p.handleRedirect(params)) { toast(`${svc.name} connected`); return openService(svc.id); }
      } catch (e) { toast(e.message, { kind: 'error', ms: 4000 }); return go('connect', { id: svc.id }); }
    }
  }
  // ?service=demo deep link (handy for testing and kiosk start-up)
  const deep = params.get('service');
  if (deep && provider(deep)) { history.replaceState({}, document.title, location.pathname); return openService(deep); }

  const last = store.get('lastService');
  if (store.get('autoResume') && last && (last !== 'demo' || store.get('showDemo'))) {
    const p = provider(last);
    if (p && !p.setupHint() && p.isAuthed()) return openService(last);
  }
  go('home');
}

// Signed-out mid-session (refresh token revoked etc.)
for (const svc of SERVICES) provider(svc.id).on('signedout', () => { toast(`${svc.name}: please sign in again`, { kind: 'error' }); go('connect', { id: svc.id }); });

boot().catch((e) => { console.error(e); go('home'); });

// Installable + works offline (GitHub Pages is https; the Pi uses 127.0.0.1).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.info('sw', e.message)));
}
