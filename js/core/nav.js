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
  store.set('lastService', id);
  document.getElementById('app').style.setProperty('--accent', getService(id).color);
  document.getElementById('app').style.setProperty('--brand', getService(id).color);
  const ready = player.provider !== p ? player.use(p) : null;
  go('player');
  await ready;
}
