// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Home: every service on a ring around a clock. Green dot = signed in / reachable.
// Under the clock, the main menu in three rows: Music · Media · Rhythm / Home · Apps · Games / Settings
// (arrow keys or the knob: ←/→ step through the buttons, ↑/↓ move between the rows).
import { h, badge, iconBtn } from '../ui/dom.js';
import { toLocal, localRect, frameDeg } from '../core/util.js';
import { SERVICES, provider, inSection, adaptersOf } from '../providers/registry.js';
import { icon } from '../ui/icons.js';
import { bridgeInfo } from '../providers/bridge.js';
import { directTvs, haReady } from '../core/tvapp.js';
import { openService } from '../core/nav.js';
import { player } from '../core/player.js';
import { go } from '../core/router.js';
import { store } from '../core/store.js';
import { backdropSpec, themeEvents } from '../core/theme.js';
import { mountBackdrop } from '../ui/backdrops.js';
import { topPanel } from '../ui/overlay.js';

export function HomeScreen() {
  const ring = h('div.svc-ring');
  const hint = h('div.home-hint');
  const items = SERVICES.map((svc, i) => {
    const btn = h('button.svc', {
      type: 'button', 'aria-label': svc.name, '--c': svc.color,
      style: { animationDelay: `${i * 35}ms` },
      onclick: () => openService(svc.id),
    }, badge(svc), h('span.svc-name', svc.short || svc.name), h('span.svc-dot'), h('span.svc-tag', 'bridge'));
    if (svc.id === store.get('lastService')) btn.classList.add('last');
    ring.appendChild(btn);
    return { svc, btn, ready: false };
  });

  // Spread the visible services evenly around the ring.
  const MODES = ['music', 'media', 'home'];
  const mode = () => (MODES.includes(store.get('homeMode')) ? store.get('homeMode') : 'music');
  function layout() {
    const only = store.get('onlySignedIn');
    const demo = store.get('showDemo');
    const sec = mode();
    el.dataset.mode = sec;
    modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.mode === sec));
    const avail = items.filter((it) => inSection(it.svc, sec) && (demo || it.svc.id !== 'demo'));
    let shown = avail.filter((it) => !only || (it.ready && it.svc.kind !== 'local'));
    hint.textContent = '';
    if (!shown.length) {
      // Nothing signed in yet: show the Demo, or (with the Demo hidden) every service so you can sign in.
      const local = avail.filter((it) => it.svc.kind === 'local');
      shown = demo && local.length ? local : avail;
      hint.textContent = 'No services signed in yet — Settings → “Show only signed-in services”';
    }
    items.forEach((it) => { it.btn.hidden = !shown.includes(it); });
    // the control size (Settings → Control size) scales the tiles too: keep them on the screen
    // (Media and Home already have bigger tiles: they stop growing past 1.04 — css .home[data-mode] .svc)
    const ui0 = parseFloat(document.getElementById('app')?.style.getPropertyValue('--ui')) || 1;
    const ui = sec === 'music' ? ui0 : Math.min(ui0, 1.04);
    const rad = ui > 1 ? 37.5 + (ui - 1) * 20 : 37.5 - (ui - 1) * 10;   // bigger tiles sit further out (orbit() keeps them on the screen)
    const W = ring.clientWidth, n = shown.length;
    const angle = (i) => (i / n) * Math.PI * 2;
    const orbits = shown.map((it, i) => (W ? orbit(it.btn, angle(i), rad, W, ui) : null));
    tiles = [];
    shown.forEach((it, i) => {
      const a = angle(i), m = orbits[(n - i) % n];   // its mirror image across the vertical: same orbit, so the ring stays symmetric
      let r = orbits[i]?.r ?? rad;
      if (m && m.r < r) r = m.r;
      if (W) { const o = orbit(it.btn, a, r, W, ui); if (o) tiles.push(o.badge, o.name); }
      it.btn.style.left = `${50 + r * Math.sin(a)}%`;
      it.btn.style.top = `${50 - r * Math.cos(a)}%`;
    });
    fitCenter();
  }

  // A tile's orbit (% of the screen): pulled in just enough that its badge and name stay inside the round screen
  // (big tiles near the bottom — e.g. Home → PlayStation at XL — would otherwise lose the end of their name).
  // Layout sizes (offset*) ignore the pop-in animation; `ui` is the tiles' own scale. Also returns where the
  // badge (circle) and name (rect) end up, in px, for fitCenter().
  let tiles = [];
  function orbit(btn, a, rad, W, ui) {
    const R = W / 2, lim = R * 0.975;
    const bw = btn.offsetWidth, bh = btn.offsetHeight;
    const badgeEl = btn.querySelector('.badge'), nameEl = btn.querySelector('.svc-name');
    if (!bw || !badgeEl || !nameEl) return null;
    const loc = (x, y) => [(x - bw / 2) * ui, (y - bh / 2) * ui];
    const [bx, by] = loc(badgeEl.offsetLeft + badgeEl.offsetWidth / 2, badgeEl.offsetTop + badgeEl.offsetHeight / 2);
    const br = (badgeEl.offsetWidth / 2) * ui;
    const nx0 = nameEl.offsetLeft, ny0 = nameEl.offsetTop, nx1 = nx0 + nameEl.offsetWidth, ny1 = ny0 + nameEl.offsetHeight;
    const corners = [[nx0, ny0], [nx1, ny0], [nx0, ny1], [nx1, ny1]].map(([x, y]) => loc(x, y));
    let r = rad;
    for (let k = 0; k < 24; k++) {
      const cx = R + (r / 100) * W * Math.sin(a), cy = R - (r / 100) * W * Math.cos(a);
      const far = Math.max(Math.hypot(cx + bx - R, cy + by - R) + br, ...corners.map(([x, y]) => Math.hypot(cx + x - R, cy + y - R)));
      if (far <= lim) break;
      r -= 0.25;
    }
    const cx = R + (r / 100) * W * Math.sin(a), cy = R - (r / 100) * W * Math.cos(a);
    const xs = corners.map(([x]) => cx + x), ys = corners.map(([, y]) => cy + y);
    return { r, badge: { x: cx + bx, y: cy + by, r: br }, name: { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) } };
  }

  // Keep the clock, date, menu and now-playing pill clear of the ring: measured at full size, then the centre
  // shrinks (--fit, down to 80%) just enough to clear every tile — fonts differ per theme, so this is measured.
  function fitCenter() {
    if (!tiles.length || !el.isConnected) return;
    const deg = frameDeg();
    if (deg % 90) return;   // the screen is turned at an odd angle (js/core/orientation.js): keep the last fit
    const lr = (q) => localRect(q, deg);
    center.style.setProperty('--fit', '1');
    const box = lr(ring), cb = lr(center);
    if (!box.width) return;
    const k = ring.clientWidth / box.width;   // measured rects → layout px (the screen may be mid-transition)
    const ox = (cb.left + cb.right) / 2, oy = (cb.top + cb.bottom) / 2;
    const textRect = (n) => { const rg = document.createRange(); rg.selectNodeContents(n); return lr(rg.getBoundingClientRect()); };
    const parts = [...center.querySelectorAll(':scope > .brand, :scope > .clock, :scope > .date, :scope > .home-hint')].map(textRect)
      .concat([...center.querySelectorAll('.hm-row'), ...(now.hidden ? [] : [now])].map((n) => lr(n)))
      .filter((q) => q.width && q.height);
    const M = 3;   // px of air
    const hits = (f) => parts.some((q) => {
      const l = (ox + (q.left - ox) * f - box.left) * k - M, rr = (ox + (q.right - ox) * f - box.left) * k + M;
      const t = (oy + (q.top - oy) * f - box.top) * k - M, b = (oy + (q.bottom - oy) * f - box.top) * k + M;
      return tiles.some((s) => (s.l !== undefined
        ? s.l < rr && s.r > l && s.t < b && s.b > t
        : Math.hypot(Math.max(l - s.x, 0, s.x - rr), Math.max(t - s.y, 0, s.y - b)) < s.r));
    });
    let f = 1;
    while (f > 0.8 && hits(f)) f -= 0.02;
    center.style.setProperty('--fit', f.toFixed(2));
  }

  const clock = h('div.clock');
  const date = h('div.date');
  // Now playing: open the player that belongs to what's playing — Movies & TV for a film or show
  // (e.g. Plex video), the music player otherwise.
  const openNowPlaying = () => {
    const p = player.provider;
    if (p?.section === 'media') openService(p.id);
    else go('player');
  };
  const now = h('button.now-mini', { type: 'button', onclick: openNowPlaying });
  // The main menu, three rows: Music · Media · Rhythm / Home · Apps · Games / Settings. Music, Media and Home
  // switch the ring of services (Media = movies & TV, Home = smart home); the others open their screens.
  const setMode = (m) => { if (mode() !== m) { store.set('homeMode', m); ring.classList.remove('swap'); void ring.offsetWidth; ring.classList.add('swap'); } };
  const MENU = [
    [['music', 'note', 'Music'], ['media', 'film', 'Media'], ['rhythm', 'rhythm', 'Rhythm']],
    [['home', 'house', 'Home'], ['apps', 'apps', 'Apps'], ['games', 'gamepad', 'Games']],
    [['settings', 'settings', 'Settings']],
  ];
  const menuRows = MENU.map((row) => row.map(([m, ic, label]) => h('button.hm-btn', {
    type: 'button', dataset: { mode: m }, 'aria-label': label, html: `${icon(ic)}<span>${label}</span>`,
    onclick: (e) => { e.stopPropagation(); if (['settings', 'games', 'rhythm', 'apps'].includes(m)) go(m); else setMode(m); },
  })));
  const modeBtns = menuRows.flat();
  // each row is its own pill (themes style .home-mode), narrowing to Settings alone at the bottom
  const modeSwitch = h('div.home-menu', { role: 'menu' }, menuRows.map((btns, r) => h(`div.home-mode.hm-row.hm-row-${r + 1}`, btns)));

  // Keys / rotary knob on Home: ←/→ step through the menu (along a row, then on to the next one), ↑/↓ change rows.
  let lastCol = 1;   // Settings sits under Apps
  const onKey = (e) => {
    if (!el.isConnected || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || topPanel() || e.target.matches?.('input, textarea')) return;
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return;
    e.preventDefault();
    const cur = modeBtns.indexOf(document.activeElement);
    if (cur < 0) { (modeBtns.find((b) => b.classList.contains('on')) || modeBtns[0]).focus(); return; }
    const r = menuRows.findIndex((row) => row.includes(document.activeElement));
    const c = menuRows[r].indexOf(document.activeElement);
    let next;
    if (k === 'ArrowLeft' || k === 'ArrowRight') next = modeBtns[(cur + (k === 'ArrowRight' ? 1 : modeBtns.length - 1)) % modeBtns.length];
    else {
      const nr = Math.max(0, Math.min(menuRows.length - 1, r + (k === 'ArrowDown' ? 1 : -1)));
      if (nr === r) return;
      if (menuRows[r].length > 1) lastCol = c;
      const row = menuRows[nr];
      next = row.length > 1 ? row[Math.min(lastCol, row.length - 1)] : row[0];
    }
    const nc = menuRows.findIndex((row) => row.includes(next));
    if (menuRows[nc].length > 1) lastCol = menuRows[nc].indexOf(next);
    next.focus();
  };
  window.addEventListener('keydown', onKey);
  const center = h('div.home-center', h('div.brand', 'ROUND REMOTE'), clock, date, modeSwitch, now, hint);
  const el = h('div.home', h('div.home-glow'), ring, center);
  // the Home background chosen for the theme (Settings → Theme → Home background)
  const backdrop = mountBackdrop(el, backdropSpec());
  el.classList.add('has-backdrop');
  const offTheme = themeEvents.on('change', () => { backdrop.set(backdropSpec()); setTimeout(layout, 60); });   // theme fonts change the sizes
  document.fonts?.ready.then(() => layout());
  const offLite = ((a, b) => () => { a(); b(); })(store.on('change:liteMode', () => backdrop.set(backdropSpec())), store.on('change:batterySaver', () => backdrop.set(backdropSpec())));
  const offUi = store.on('change:uiSize', () => setTimeout(layout, 0));

  let lastClock = '';
  function tickClock() {
    const d = new Date();
    const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(d);
    const main = parts.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim();
    const period = parts.find((x) => x.type === 'dayPeriod')?.value;
    clock.textContent = main;
    if (period) clock.append(h('small', period));
    date.textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
    if (main !== lastClock) { lastClock = main; fitCenter(); }   // "12:59" is wider than "1:00"
  }
  tickClock();
  const clockT = setInterval(tickClock, 5000);

  function renderNow() {
    const t = player.state.track;
    now.innerHTML = '';
    now.hidden = !t;
    el.classList.toggle('np', !!t);   // something playing: a more compact clock makes room for the pill (css)
    if (!t) { fitCenter(); return; }
    now.classList.toggle('video', player.provider?.section === 'media');   // a poster doesn't spin like a record
    now.append(h('span.now-art', { style: { backgroundImage: t.art ? `url("${t.art}")` : '' } }),
      h('span.now-text', h('b', t.title), h('small', t.artist)));
    fitCenter();
  }
  renderNow();
  const offNow = player.on('track', renderNow);

  // Status dots (green = signed in / reachable) and the "only signed-in" filter.
  (async () => {
    for (const it of items) {
      const p = provider(it.svc.id);
      if (it.svc.kind !== 'bridge') { it.ready = !p.setupHint() && p.isAuthed(); it.btn.classList.toggle('ready', it.ready); }
    }
    layout();
    const info = await bridgeInfo({ passive: true });
    for (const it of items) {
      if (it.svc.kind !== 'bridge') continue;
      const ad = info?.adapters || {};
      const ok = it.svc.id === 'tidal' || it.svc.id === 'qobuz'
        ? Object.values(ad).some((a) => a.enabled && a.id !== 'mock')
        : adaptersOf(it.svc).some((k) => ad[k]?.enabled);
      const direct = it.svc.id === 'androidtv' && (directTvs().length > 0 || haReady());   // Google TV through the TV Remote app
      it.ready = !!ok || direct;
      it.btn.classList.toggle('ready', it.ready);
      if (info && !it.ready) it.btn.classList.add('off');
      if (!info && !direct) it.btn.classList.add('needs-bridge');
    }
    layout();
  })();
  const offFilter = store.on('change:onlySignedIn', layout);
  const offDemo = store.on('change:showDemo', layout);
  const offMode = store.on('change:homeMode', layout);
  // swipe sideways on the home screen to switch between Music and Movies & TV
  let sx = null;
  el.addEventListener('pointerdown', (e) => { const [x, y] = toLocal(e.clientX, e.clientY); sx = { x, y, t: performance.now() }; });
  el.addEventListener('pointerup', (e) => {
    if (!sx) return;
    const [x, y] = toLocal(e.clientX, e.clientY);   // sideways for the app, even when the screen is turned
    const dx = x - sx.x, dy = y - sx.y, dt = performance.now() - sx.t; sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 700) setMode(MODES[(MODES.indexOf(mode()) + (dx < 0 ? 1 : MODES.length - 1)) % MODES.length]);
  });

  return { el, destroy() { clearInterval(clockT); offNow(); offFilter(); offDemo(); offMode(); offTheme(); offLite(); offUi(); backdrop.destroy(); window.removeEventListener('keydown', onKey); } };
}
