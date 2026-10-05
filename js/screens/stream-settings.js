// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Settings → Movies & TV → Streaming library: the country whose catalogue the Netflix / Disney+ / Prime Video /
// Apple TV+ / HBO Max libraries show, and the TMDB key (the bridge's, or one kept on this display). The library itself is
// js/core/stream-library.js; who's watching (local profiles) is Settings → Accounts → Profiles per service (users.js).
import { h, clear } from '../ui/dom.js';
import { toast } from '../ui/overlay.js';
import { editText } from '../ui/keyboard.js';
import { store } from '../core/store.js';
import { registerSettings } from './settings-registry.js';
import { chips } from './panels.js';
import { REGIONS, region, regionName, tmdbAccess, localTmdbKey, setLocalTmdbKey, tmdb, forgetAccess } from '../core/stream-library.js';

const errMsg = (e) => e?.userMessage || e?.message || 'Something went wrong';

/** Ask for a TMDB key and keep it on this display (checked once against TMDB). Resolves true when saved. */
export async function askTmdbKey() {
  const v = await editText({ title: 'TMDB API key', placeholder: 'v3 API key or read access token', value: localTmdbKey(), okLabel: 'Save' });
  if (v == null) return false;
  const key = String(v).trim();
  if (!key) { setLocalTmdbKey(''); toast('TMDB key removed from this display'); return true; }
  const old = localTmdbKey();
  setLocalTmdbKey(key);
  try {
    const a = await tmdbAccess({ fresh: true });
    if (a.via === 'direct') await tmdb('/genre/movie/list', { language: 'en-US' }, 1000);
    toast('TMDB key saved — the streaming library is ready');
    return true;
  } catch (e) {
    setLocalTmdbKey(old);
    toast(errMsg(e), { kind: 'error', ms: 4200 });
    return false;
  }
}

function build(el) {
  const hint = (t) => h('div.opt-hint', t);
  el.append(
    hint('Netflix, Disney+, Prime Video, Apple TV+ and HBO Max have no public catalogue, so their Library tab shows what TMDB (with JustWatch data) lists on each service in your country: popular, newest, top rated, genres and search. Kids profiles only see movies rated up to PG (US rating) and family & kids series.'),
    h('div.section', 'Country'),
    chips(REGIONS.map(([id, name]) => ({ id, name })), region(), (id) => { store.set('streamRegion', id); toast(`Showing what’s streaming in ${regionName(id)}`); }),
    h('div.section', 'TMDB key'),
  );
  const status = h('div.opt-hint', 'Checking…');
  const btns = h('div.center', { style: { gap: '2cqmin', flexWrap: 'wrap' } });
  el.append(status, btns);
  const render = async () => {
    forgetAccess();
    const a = await tmdbAccess({ fresh: true }).catch(() => ({ via: null }));
    status.textContent = a.bridge ? 'Using the bridge’s TMDB key (Collection → Connections → TMDB) — the bridge also caches the library for every display.'
      : a.local ? 'Using the TMDB key saved on this display (straight from the browser — works on GitHub Pages without a bridge).'
        : 'No TMDB key yet. It’s free: sign up at themoviedb.org → Settings → API → copy the “API Key” (or the read access token).';
    clear(btns).append(
      h('button.pill', { type: 'button', onclick: async (e) => { e.stopPropagation(); if (await askTmdbKey()) render(); } }, localTmdbKey() ? 'Change key on this display' : 'Add key on this display'),
      h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); import('./setup-remote.js').then((m) => m.openRemoteSetup({ service: 'collection' })); } }, 'Set up on your phone'),
      localTmdbKey() ? h('button.pill.danger', { type: 'button', onclick: (e) => { e.stopPropagation(); setLocalTmdbKey(''); toast('Removed'); render(); } }, 'Remove') : null,
    );
  };
  render();
  el.append(h('div.section', 'Play on TV'),
    hint('Netflix and Disney+ titles open straight on a Google TV (through the bridge or Home Assistant) when Wikidata knows their Netflix / Disney+ id. Otherwise — and for Prime Video, Apple TV+ and HBO Max — Round Remote opens the app and offers to type the title into its search with the TV remote (bridge, Home Assistant with “Enable IME” in the Android TV Remote integration, or the TV Remote app). An Apple TV just opens the app. The TV app’s own profile picker can’t be controlled from here.'));
}

registerSettings({
  group: 'media', id: 'stream-library', title: 'Streaming library', icon: 'film', order: 45,
  summary: 'Netflix, Disney+ & co.: country and TMDB key',
  keywords: 'netflix disney prime video apple tv max hbo tmdb catalogue library country region key search kids',
  sub: () => `What’s on in ${regionName()}`,
  build,
});
