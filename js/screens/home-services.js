// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Which services the Home ring shows, and in what order (Settings → Home screen → Services, or hold a tile on Home).
// store.homeHidden: ids hidden from the ring · store.homeOrder: ids in the chosen order (the rest follow in the
// built-in order). The Demo tile keeps its own switch (store.showDemo). Signing in is not affected.
import { SERVICES, inSection } from '../providers/registry.js';
import { store } from '../core/store.js';

export const HOME_MODES = [{ id: 'music', name: 'Music' }, { id: 'media', name: 'Movies & TV' }, { id: 'home', name: 'Home' }];

/** The services of a Home mode (music | media | home), in the chosen order — hidden ones included. */
export function homeServices(mode) {
  const order = store.get('homeOrder') || [];
  const pos = (id) => { const i = order.indexOf(id); return i < 0 ? 1e4 + SERVICES.findIndex((s) => s.id === id) : i; };
  return SERVICES.filter((s) => inSection(s, mode)).sort((a, b) => pos(a.id) - pos(b.id));
}

export function isHomeHidden(id) {
  if (id === 'demo') return store.get('showDemo') === false;
  return (store.get('homeHidden') || []).includes(id);
}

export function setHomeHidden(id, hide) {
  if (id === 'demo') { store.set('showDemo', !hide); return; }
  const cur = (store.get('homeHidden') || []).filter((x) => x !== id);
  store.set('homeHidden', hide ? [...cur, id] : cur);
}

/** Move a service one place earlier (-1) or later (+1) among its mode's services. */
export function moveHomeService(id, dir, mode) {
  const list = homeServices(mode).map((s) => s.id);
  const i = list.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  // keep the other modes' order as it was
  const rest = (store.get('homeOrder') || []).filter((x) => !list.includes(x));
  store.set('homeOrder', [...rest, ...list]);
  return true;
}
