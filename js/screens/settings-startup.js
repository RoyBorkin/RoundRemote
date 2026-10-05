// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Settings → General → Startup animation: the logo animation while Round Remote loads (index.html #rr-splash,
// js/core/splash.js) and hiding the mouse pointer (js/core/pointer.js). Registered through settings-registry.js.
import { h } from '../ui/dom.js';
import { chips } from './panels.js';
import { store, isLite } from '../core/store.js';
import { registerSettings } from './settings-registry.js';
import { previewSplash } from '../core/splash.js';
import { themeConfig } from '../core/theme.js';

const SPLASH = [
  { id: 'always', name: 'Always' },
  { id: 'first', name: 'First load only' },
  { id: 'off', name: 'Off' },
];
const SPLASH_HINT = {
  always: 'The logo draws itself and the ring sweeps round every time the app opens (about a second — it never holds the app back, and a tap skips it).',
  first: 'The full animation the first time the app opens; reloads after that only show the logo for a moment.',
  off: 'No animation — the app appears as soon as it’s ready.',
};
const POINTER = [
  { id: 'auto', name: 'Auto' },
  { id: 'always', name: 'Always hide' },
  { id: 'never', name: 'Never hide' },
];
const POINTER_HINT = {
  auto: 'Hidden while you use touch and 2 s after the mouse stops; moving a mouse brings it back.',
  always: 'The pointer is never shown (touch only).',
  never: 'The normal mouse pointer.',
};

export function buildStartupSettings(el) {
  const opt = (label, ...kids) => h('div.opt', h('div.opt-label', label), ...kids);
  const splashHint = h('div.opt-hint', SPLASH_HINT[store.get('bootSplash') || 'first']);
  const pointerHint = h('div.opt-hint', POINTER_HINT[store.get('hidePointer') || 'auto']);
  const preview = h('button.pill', {
    type: 'button',
    onclick: (e) => {
      e.stopPropagation();
      previewSplash({ variant: isLite() ? 'rs-lite' : 'rs-play', light: themeConfig().mode === 'light' && !isKiosk() });
    },
  }, 'Preview');
  el.append(
    opt('Startup animation',
      chips(SPLASH, store.get('bootSplash') || 'first', (v) => { store.set('bootSplash', v); splashHint.textContent = SPLASH_HINT[v]; }),
      splashHint, h('div.center', preview)),
    opt('Mouse pointer',
      chips(POINTER, store.get('hidePointer') || 'auto', (v) => { store.set('hidePointer', v); pointerHint.textContent = POINTER_HINT[v]; }),
      pointerHint),
    h('div.opt-hint', isKiosk()
      ? 'On this Raspberry Pi the boot screen (logo + ring) leads straight into this animation. The system pointer is hidden too while no mouse is plugged in.'
      : 'On the Raspberry Pi the same logo and ring show while it boots (pi/install.sh sets that up).'),
  );
}

// the Pi kiosk opens the app from its own bridge on this machine
function isKiosk() { return location.port === '8765' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname); }

registerSettings({ group: 'general', id: 'boot-splash', title: 'Startup animation', icon: 'sparkle', order: 80, build: buildStartupSettings });
