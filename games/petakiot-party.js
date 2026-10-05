// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Shared by the phone-played party games in the Games tab — Notes Game (petakiot.js) and Code Words (codewords.js).
// Those games don't fit the arcade mould (no high score, their own lobby / settings / turns), so they run inside the
// game shell (games/shell.js: start card with the mode chips, pause card, Escape) but draw their own DOM screens on
// a layer above the canvas. This file holds what both need:
//   gameStore(id)               { data(key, init), save(key, value), flush() } — kept in the shared `gameProgress`
//                               setting under the game's id (merged; saves are batched); also what partyLink() needs
//   partyLayer(g, cls)          the DOM layer + knob / keyboard focus (← → step through the buttons, Enter presses)
//   loadCss(file)               the game's own stylesheet (games/<file>), once
//   phoneLink(link)             { url, reason } for the QR (bridge's LAN address), or why phones can't join
//   lite()                      Reduce effects / Battery saver → no continuous animations
//   orderModes(phones, device)  the start card's mode chips, "One device" first where no bridge is expected
//   shuffle(a), uid(), esc(), sameText(a, b)
import { store } from '../js/core/store.js';
import { h } from '../js/ui/dom.js';
import { topPanel } from '../js/ui/overlay.js';
import { mayProbe } from '../js/providers/bridge.js';

export const lite = () => !!(store.get('liteMode') || store.get('batterySaver'));
export const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const uid = () => Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
export const HEB = /[֐-׿]/;
/** Compare names loosely: case, spaces, punctuation, Hebrew niqqud and final letters don't matter. */
export const normText = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[֑-ׇ̀-ͯ]/g, '')
  .replace(/[ךםןףץ]/g, (c) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c]).replace(/[^\p{L}\p{N}]+/gu, '');
export const sameText = (a, b) => normText(a) === normText(b);

/** The start card's modes: "One device" first where no bridge can be expected (e.g. GitHub Pages without one). */
export const orderModes = (phones, device) => (mayProbe() ? [phones, device] : [device, phones]);

/** Saved data for one game in the shared `gameProgress` setting (merged, never overwriting other games). */
export function gameStore(id) {
  let pend = null, t = 0;
  const mine = () => (store.get('gameProgress') || {})[id] || {};
  function flush() {
    clearTimeout(t);
    if (!pend) return;
    const all = store.get('gameProgress') || {};
    store.set('gameProgress', { ...all, [id]: { ...(all[id] || {}), ...pend } });
    pend = null;
  }
  return {
    data(key, init) { const v = pend && key in pend ? pend[key] : mine()[key]; return v === undefined ? init : v; },
    save(key, value) { (pend ||= {})[key] = value; clearTimeout(t); t = setTimeout(flush, 350); },
    flush,
  };
}

const cssDone = new Set();
export function loadCss(file) {
  if (cssDone.has(file) || typeof document === 'undefined') return;
  cssDone.add(file);
  if (document.querySelector(`link[data-game-css="${file}"]`)) return;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL(`./${file}`, import.meta.url).href, dataset: { gameCss: file } }));
}


/**
 * The DOM layer a party game draws on (above the canvas, under the pause button and the shell's cards).
 * Knob / keyboard: ← → (↑ ↓, the wheel) move a focus ring through the visible buttons, Enter / Space presses.
 */
export function partyLayer(g, cls) {
  const screen = g.canvas.closest('.game-screen') || g.canvas.parentElement;
  const root = h(`div.pk-layer.${cls}`);
  if (lite()) root.classList.add('pk-lite');   // Reduce effects / Battery saver: no CSS animations
  screen.append(root);
  let focus = null, kbd = false;
  const visible = (b) => b.offsetParent !== null && !b.disabled && !b.closest('[hidden]') && !b.closest('.pk-nonav');
  const items = () => [...root.querySelectorAll('button, [data-nav]')].filter(visible);
  function setFocus(b) {
    if (focus) focus.classList.remove('pk-kf');
    focus = b || null;
    if (focus && kbd) { focus.classList.add('pk-kf'); try { focus.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {} }
  }
  function step(d) {
    const list = items();
    if (!list.length) return;
    kbd = true;
    let i = list.indexOf(focus);
    if (i < 0) i = d > 0 ? -1 : list.length;
    i = (i + d + list.length) % list.length;
    setFocus(list[i]);
  }
  function press() {
    const list = items();
    let b = list.includes(focus) ? focus : null;
    if (!b) b = root.querySelector('.pk-default:not([disabled])');
    if (b && visible(b)) { kbd = true; b.click(); }
  }
  const busy = () => !!topPanel();
  g.on('key', ({ key }) => {
    if (busy()) return;
    if (key === 'ArrowRight' || key === 'ArrowDown') step(1);
    else if (key === 'ArrowLeft' || key === 'ArrowUp') step(-1);
    else if (key === 'Enter' || key === ' ') press();
  });
  g.on('wheel', ({ delta }) => { if (!busy()) step(delta > 0 ? 1 : -1); });
  root.addEventListener('pointerdown', () => { kbd = false; if (focus) focus.classList.remove('pk-kf'); });
  return {
    root,
    /** After a re-render: keep the focus on the "same" button (by data-k) when the knob is in use. */
    refocus() { if (!kbd) { focus = null; return; } const k = focus?.dataset?.k; const list = items(); setFocus((k && list.find((b) => b.dataset.k === k)) || list.find((b) => b.classList.contains('pk-default')) || list[0]); },
    destroy() { root.remove(); },
  };
}

/** The phone link for the QR code, through the bridge (see apps/party-link.js). */
export async function phoneLink(link) {
  try { return await link.phoneUrl(); } catch { return { url: null, reason: 'nobridge' }; }
}

/** A short "why phones can't join" in English or Hebrew. */
export function noPhones(reason, he) {
  if (reason === 'noip') return he ? 'לגשר אין כתובת ברשת שטלפונים יכולים להגיע אליה. הגדירו "party": { "publicUrl": … } בקובץ bridge/config.json.' : 'The bridge has no network address phones can reach — set "party": { "publicUrl": … } in bridge/config.json.';
  if (reason === 'old') return he ? 'הגשר ישן מדי למשחקי טלפון — עדכנו את הגשר.' : 'This bridge is too old for phone games — update the bridge.';
  return he ? 'כדי לשחק מהטלפונים צריך את הגשר (bridge/server.js) ברשת הזאת — למשל על ה-Pi. בינתיים: מכשיר אחד שעובר מיד ליד.' : 'Phones need the bridge (bridge/server.js) on this network — e.g. on the Pi. Until then: one device, passed around.';
}
