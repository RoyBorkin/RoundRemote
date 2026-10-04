// The Games category: every game on a ring (like the services on Home). Tap one to see it in the middle,
// tap Play (or the middle) to start. Drag around the ring, scroll, or use ← → to move through them.
import { h, iconBtn } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { go } from '../js/core/router.js';
import { store } from '../js/core/store.js';
import { GAMES, iconSvg } from './index.js';
import { sfx } from './kit.js';

/** Best score for a game in the mode last played (formatted text saved with the score). */
function bestText(id) {
  const all = store.get('gameScores') || {};
  const key = (store.get('gameKeys') || {})[id] || (store.get('gameModes') || {})[id] || 'default';
  const list = all[`${id}:${key}`] || Object.entries(all).find(([k]) => k.startsWith(`${id}:`))?.[1] || [];
  const b = list[0];
  return b ? `${b.text || Math.round(b.score).toLocaleString()}${b.name ? ` · ${b.name}` : ''}` : '';
}

export function GamesHubScreen() {
  const n = GAMES.length;
  let sel = Math.max(0, GAMES.findIndex((x) => x.id === store.get('lastGame')));
  const ring = h('div.gh-ring');
  // the icons shrink a little when there are many games so they never touch (ring radius 42% of the screen)
  ring.style.setProperty('--gi', `${Math.min(9.6, (2 * Math.PI * 42 / n) * 0.8).toFixed(2)}cqmin`);
  const items = GAMES.map((gm, i) => {
    const a = (i / n) * Math.PI * 2;
    const b = h('button.gh-item', {
      type: 'button', 'aria-label': gm.name, '--c': gm.color,
      style: { left: `${50 + 42 * Math.sin(a)}%`, top: `${50 - 42 * Math.cos(a)}%`, animationDelay: `${i * 25}ms` },
      onclick: (e) => { e.stopPropagation(); if (sel === i) play(); else select(i); },
      html: iconSvg(gm.icon),
    });
    { // a near-white colour vanishes on light themes — mark it so the CSS swaps in the ink colour
      const n = parseInt(String(gm.color).replace('#', ''), 16);
      if ((0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.88) b.classList.add('pale');
    }
    ring.append(b);
    return b;
  });
  const badge = h('div.gh-badge');
  const name = h('div.gh-name');
  const blurb = h('div.gh-blurb');
  const best = h('div.gh-best');
  const playBtn = h('button.gh-play', { type: 'button', onclick: (e) => { e.stopPropagation(); play(); } }, 'Play');
  const center = h('div.gh-center', badge, name, blurb, best, playBtn);
  const pointer = h('div.gh-pointer');
  const snd = iconBtn(store.get('gameSound') === false ? 'mute' : 'volume', 'Game sound', () => {
    store.set('gameSound', store.get('gameSound') === false);
    snd.innerHTML = icon(store.get('gameSound') === false ? 'mute' : 'volume');
    if (store.get('gameSound') !== false) sfx('tap');
  }, 'gh-sound');
  const home = iconBtn('home', 'Home', () => go('home'), 'gh-home');
  const el = h('div.games-hub', h('div.gh-glow'), ring, pointer, center, h('div.gh-label', 'GAMES'), home, snd);

  function select(i, quiet = false) {
    sel = (i + n) % n;
    const gm = GAMES[sel];
    items.forEach((b, j) => b.classList.toggle('on', j === sel));
    el.style.setProperty('--gc', gm.color);
    badge.innerHTML = iconSvg(gm.icon);
    name.textContent = gm.name;
    blurb.textContent = gm.blurb;
    const bt = bestText(gm.id);
    best.textContent = bt ? `Best  ${bt}` : 'No score yet';
    pointer.style.transform = `rotate(${(sel / n) * 360}deg)`;
    center.classList.remove('swap'); void center.offsetWidth; center.classList.add('swap');
    store.set('lastGame', gm.id);
    if (!quiet) sfx('tick');
  }
  function play() { sfx('tap'); go('game', { id: GAMES[sel].id }); }

  // drag around the ring to move through the games
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
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
    else if (e.key === 'Escape') go('home');
  };
  window.addEventListener('keydown', onKey);
  select(sel, true);
  return { el, destroy() { window.removeEventListener('keydown', onKey); } };
}
