// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Hides the mouse pointer while it isn't being used — the round screen is a touch screen, and a pointer arrow sitting
// in the middle of it looks broken. Settings → General → Startup animation → Mouse pointer (store key `hidePointer`):
//   auto   (default) hidden from the start, after touch / pen input, and 2 s after the mouse stops; it comes back
//          as soon as a real mouse moves. Touch panels that report taps as mouse clicks (the pointer jumps to the
//          tap, no hover in between) don't bring it back: it takes a few hover moves in a row.
//   always hidden all the time ·  never   the browser's normal pointer
// On the Raspberry Pi the kiosk also hides the system pointer when no mouse is plugged in (pi/kiosk.sh).
import { store } from './store.js';

const root = document.documentElement;
const IDLE_MS = 2000;
const css = document.createElement('style');
css.textContent = 'html.rr-nocursor, html.rr-nocursor * { cursor: none !important; }';
document.head.append(css);

let timer = 0, moves = 0, lastMove = 0;
const mode = () => { const m = store.get('hidePointer'); return m === 'always' || m === 'never' ? m : 'auto'; };
const hide = () => { clearTimeout(timer); root.classList.add('rr-nocursor'); };
const show = () => { root.classList.remove('rr-nocursor'); clearTimeout(timer); timer = setTimeout(hide, IDLE_MS); };

function onMove(e) {
  if (mode() !== 'auto') return;
  if (e.pointerType !== 'mouse') { moves = 0; hide(); return; }
  if (!root.classList.contains('rr-nocursor')) { show(); return; }   // visible: keep it while it moves
  if (!e.movementX && !e.movementY) return;
  if (e.timeStamp - lastMove > 250) moves = 0;
  lastMove = e.timeStamp;
  if (++moves >= 3) { moves = 0; show(); }
}
function onDown(e) {
  if (mode() !== 'auto') return;
  if (e.pointerType !== 'mouse') hide();
  else if (!root.classList.contains('rr-nocursor')) show();   // a click keeps a visible pointer up
}
function apply() {
  const m = mode();
  if (m === 'never') { clearTimeout(timer); root.classList.remove('rr-nocursor'); } else hide();
}

window.addEventListener('pointermove', onMove, { capture: true, passive: true });
window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
store.on('change:hidePointer', apply);
apply();
