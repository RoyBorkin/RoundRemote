// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Startup animation: the logo + ring overlay in index.html (#rr-splash) plays from the first paint, before any module
// loads (an inline script there picks the variant from the saved settings: full / Reduce effects / quick repeat /
// continuing the Raspberry Pi's boot splash / off). This module only takes it away again: once the first screen is
// mounted under it and its own animation has finished (sped up 2× once the app is ready), it fades out into the app.
// So it never holds the app back for long (~0.5 s at most), a tap or key skips it, and it gives up after 8 s regardless.
// Settings → General → Startup animation (js/screens/settings-startup.js): Always / First load only / Off.
const root = document.documentElement;
const MODES = ['rs-play', 'rs-lite', 'rs-quick', 'rs-cont'];
let tpl = null;   // a pristine copy for previewSplash()

function waitScreen(app, maxMs) {
  return new Promise((resolve) => {
    if (!app || app.querySelector(':scope > .screen')) return resolve();
    const mo = new MutationObserver(() => { if (app.querySelector(':scope > .screen')) { mo.disconnect(); resolve(); } });
    mo.observe(app, { childList: true });
    setTimeout(() => { mo.disconnect(); resolve(); }, maxMs);
  });
}
const frames = (n) => new Promise((r) => { const f = () => (n-- <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const animsDone = (el) => Promise.all((el.getAnimations?.({ subtree: true }) || []).map((a) => a.finished.catch(() => {})));

function dismiss(el, { skip = false } = {}) {
  if (!el.isConnected || el.classList.contains('rs-gone')) return;
  el.classList.add(skip ? 'rs-skip' : 'rs-out', 'rs-gone');
  const done = () => { el.remove(); root.classList.remove(...MODES, 'rs-light', 'rs-preview'); };
  el.addEventListener('transitionend', (e) => { if (e.target === el) done(); });
  setTimeout(done, 600);   // no transition (hidden tab, reduced motion…)
}

/** Runs once at startup (imported first by js/main.js). */
function start() {
  const el = document.getElementById('rr-splash');
  if (!el) return;
  tpl = el.cloneNode(true);
  tpl.classList.remove('rs-skip');
  if (root.classList.contains('rs-off')) { el.remove(); return; }
  try { sessionStorage.setItem('rr.splash', '1'); } catch {}
  const skip = () => dismiss(el, { skip: true });
  el.addEventListener('pointerdown', skip);
  window.addEventListener('keydown', skip, { once: true, capture: true });
  if (el.classList.contains('rs-skip')) { skip(); return; }   // tapped before this module loaded
  const app = document.getElementById('app');
  waitScreen(app, 8000).then(() => frames(2)).then(() => {
    // the app is ready: finish the animation at double speed rather than make it wait
    for (const a of el.getAnimations?.({ subtree: true }) || []) { try { a.updatePlaybackRate(2); } catch {} }
    return Promise.race([animsDone(el), new Promise((r) => setTimeout(r, 1000))]);
  }).then(() => { window.removeEventListener('keydown', skip, true); dismiss(el); });
}

/** Plays the animation again over the app (the Preview button in Settings). */
export function previewSplash({ variant = 'rs-play', light = false } = {}) {
  if (!tpl || document.getElementById('rr-splash')) return;
  const el = tpl.cloneNode(true);
  root.classList.remove('rs-off', ...MODES, 'rs-light');
  root.classList.add(variant, 'rs-preview');
  if (light) root.classList.add('rs-light');
  document.body.prepend(el);
  el.addEventListener('pointerdown', () => dismiss(el, { skip: true }));
  Promise.race([animsDone(el), new Promise((r) => setTimeout(r, 1600))]).then(() => setTimeout(() => dismiss(el), 350));
}

start();
