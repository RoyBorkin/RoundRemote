// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The Apps category: every app on a ring (like the Games ring). Tap one to see it in the middle, tap Open
// (or the middle) to start it. Drag around the ring, scroll, or use ← → to move through them.
import { h, iconBtn } from '../js/ui/dom.js';
import { go } from '../js/core/router.js';
import { store } from '../js/core/store.js';
import { iconSvg } from '../games/index.js';
import { sfx } from '../games/kit.js';
import { APPS } from './index.js';

export function AppsHubScreen() {
  const n = APPS.length;
  let sel = Math.max(0, APPS.findIndex((x) => x.id === store.get('lastApp')));
  const ring = h('div.gh-ring');
  ring.style.setProperty('--gi', `${Math.min(11.5, (2 * Math.PI * 40 / n) * 0.7).toFixed(2)}cqmin`);
  const items = APPS.map((ap, i) => {
    const a = (i / n) * Math.PI * 2;
    const b = h('button.gh-item.ap-item', {
      type: 'button', 'aria-label': ap.name, '--c': ap.color, dataset: { id: ap.id },
      style: { left: `${50 + 40 * Math.sin(a)}%`, top: `${50 - 40 * Math.cos(a)}%`, animationDelay: `${i * 30}ms` },
      onclick: (e) => { e.stopPropagation(); if (sel === i) open(); else select(i); },
      html: iconSvg(ap.icon),
    });
    ring.append(b);
    return b;
  });
  const badge = h('div.gh-badge');
  const name = h('div.gh-name');
  const blurb = h('div.gh-blurb');
  const openBtn = h('button.gh-play', { type: 'button', onclick: (e) => { e.stopPropagation(); open(); } }, 'Open');
  const center = h('div.gh-center', badge, name, blurb, openBtn);
  const pointer = h('div.gh-pointer.ap-pointer');
  const home = iconBtn('home', 'Home', () => go('home'), 'gh-home ap-home');
  const el = h('div.games-hub.apps-hub', h('div.gh-glow'), ring, pointer, center, h('div.gh-label', 'APPS'), home);

  function select(i, quiet = false) {
    sel = (i + n) % n;
    const ap = APPS[sel];
    items.forEach((b, j) => b.classList.toggle('on', j === sel));
    el.style.setProperty('--gc', ap.color);
    badge.innerHTML = iconSvg(ap.icon);
    name.textContent = ap.name;
    blurb.textContent = ap.blurb;
    pointer.style.transform = `rotate(${(sel / n) * 360}deg)`;
    center.classList.remove('swap'); void center.offsetWidth; center.classList.add('swap');
    store.set('lastApp', ap.id);
    if (!quiet) sfx('tick');
  }
  function open() { sfx('tap'); go('app', { id: APPS[sel].id }); }

  // drag around the ring to move through the apps
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.3) return;
    drag = { moved: false, r };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { r } = drag;
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    let a = Math.atan2(dx, -dy); if (a < 0) a += Math.PI * 2;
    const i = Math.round((a / (Math.PI * 2)) * n) % n;
    if (i !== sel) { drag.moved = true; select(i); }
  });
  const end = () => { if (drag?.moved) { const stop = (c) => { c.stopPropagation(); c.preventDefault(); }; window.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', stop, true), 50); } drag = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => { e.preventDefault(); select(sel + Math.sign(e.deltaY || e.deltaX)); }, { passive: false });
  const onKey = (e) => {
    if (e.target.matches?.('input, textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    else if (e.key === 'Escape') go('home');
  };
  window.addEventListener('keydown', onKey);
  select(sel, true);
  return { el, destroy() { window.removeEventListener('keydown', onKey); } };
}
