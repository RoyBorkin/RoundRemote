// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The app screen: a round box that hosts one app from apps/<file>.js, plus the chrome every app shares —
// a Back button (top), the app's title, Escape = back. Apps build their own UI with DOM (see apps/index.js).
import { h, iconBtn, clear } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { editText } from '../js/ui/keyboard.js';
import { openPanel, toast, topPanel, closeAllPanels } from '../js/ui/overlay.js';
import { go } from '../js/core/router.js';
import { store } from '../js/core/store.js';
import { player } from '../js/core/player.js';
import { sfx, vibrate } from '../games/kit.js';
import { appById, loadApp } from './index.js';

/** Per-app saved data lives in one settings key, `appData`, keyed by app id (merged, never overwriting other apps). */
function readData(id) { return (store.get('appData') || {})[id] || {}; }
function writeData(id, patch) { const all = store.get('appData') || {}; store.set('appData', { ...all, [id]: { ...(all[id] || {}), ...patch } }); }

export function AppScreen({ id }) {
  const meta = appById(id) || { id, name: 'App', color: '#888' };
  const body = h('div.app-body');
  const title = h('div.app-title', meta.name);
  const btnBack = iconBtn('back', 'Back', () => back(), 'app-back');
  const el = h('div.app-screen', { '--ac': meta.color, dataset: { app: id } }, body, title, btnBack);
  const offs = [];
  let inst = null, destroyed = false;

  function back() {
    if (topPanel()) { topPanel().close(); return; }
    try { if (inst?.back?.()) return; } catch (e) { console.error(`[app ${id}] back`, e); }
    go('apps');
  }
  const app = {
    id, meta, el: body, store, player, go, toast, editText, openPanel, sfx, vibrate, h, icon, iconBtn,
    setTitle(text) { title.textContent = text ?? meta.name; },
    hideTitle(hide = true) { title.hidden = hide; },
    back,
    onKey(fn) { const f = (e) => { if (e.target.matches?.('input, textarea')) return; fn(e); }; window.addEventListener('keydown', f); const off = () => window.removeEventListener('keydown', f); offs.push(off); return off; },
    every(ms, fn) { const t = setInterval(fn, ms); const off = () => clearInterval(t); offs.push(off); return off; },
    raf(fn) {
      let r = 0, last = performance.now(), on = true;
      const loop = (now) => { if (!on) return; const dt = Math.min(0.1, (now - last) / 1000); last = now; try { fn(dt, now / 1000); } catch (e) { console.error(`[app ${id}]`, e); } r = requestAnimationFrame(loop); };
      r = requestAnimationFrame(loop);
      const off = () => { on = false; cancelAnimationFrame(r); }; offs.push(off); return off;
    },
    data(key, init) { const v = readData(id)[key]; return v === undefined ? init : v; },
    save(key, value) { writeData(id, { [key]: value }); },
  };

  const onKey = (e) => {
    if (e.target.matches?.('input, textarea')) return;
    if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); back(); }
  };
  window.addEventListener('keydown', onKey);
  store.set('lastApp', id);

  // an app may ship its own stylesheet: apps/<id>.css (loaded once)
  loadApp(id).then(({ def }) => {
    if (destroyed) return;
    if (def.css && !document.querySelector(`link[data-app-css="${id}"]`)) {
      document.head.append(h('link', { rel: 'stylesheet', href: new URL(def.css, new URL('./index.js', import.meta.url)).href, dataset: { appCss: id } }));
    }
    try { inst = def.create(body, app) || {}; } catch (err) { console.error(`[app ${id}]`, err); showError(err); }
  }).catch((err) => { console.error(err); showError(err); });

  function showError(err) {
    clear(body);
    body.append(h('div.app-error', h('div.app-error-t', 'This app didn’t load'), h('div.app-error-m', String(err?.message || err))));
  }

  return {
    el,
    destroy() {
      destroyed = true;
      window.removeEventListener('keydown', onKey);
      for (const off of offs.splice(0)) { try { off(); } catch {} }
      try { inst?.destroy?.(); } catch (e) { console.error(`[app ${id}] destroy`, e); }
      closeAllPanels();
    },
  };
}
