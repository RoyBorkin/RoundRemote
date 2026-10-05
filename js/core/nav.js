// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Navigation helpers shared by screens.
import { go } from './router.js';
import { player } from './player.js';
import { store } from './store.js';
import { provider, getService } from '../providers/registry.js';

/** Open a service: sign-in/setup if needed, otherwise straight to the remote. */
export async function openService(id, { forceSetup = false } = {}) {
  const p = provider(id);
  if (!p) return;
  if (forceSetup || p.setupHint() || !p.isAuthed()) { go('connect', { id }); return; }
  const svcMeta = getService(id);
  if (svcMeta.section === 'home') {   // smart home: its own screen, the music/video player keeps playing
    store.set('lastService', id); store.set('homeMode', 'home');
    document.getElementById('app').style.setProperty('--accent', svcMeta.color);
    go(svcMeta.screen || 'smarthome', { id });   // game consoles: js/screens/consoles.js
    return;
  }
  store.set('lastService', id);
  document.getElementById('app').style.setProperty('--accent', getService(id).color);
  document.getElementById('app').style.setProperty('--brand', getService(id).color);
  const ready = player.provider !== p ? player.use(p) : null;
  const svc = getService(id);
  if (svc.section === 'media') store.set('homeMode', 'media');
  go(svc.section === 'media' ? 'media' : 'player');
  // Movies & TV: "Who's watching?" first, when that's switched on (Settings → Plex users / Jellyfin users)
  if (id === 'plexvideo' || id === 'jellyfinvideo') import('../screens/users.js').then((m) => m.askWhoIsWatching(id)).catch(() => {});
  await ready;
}
