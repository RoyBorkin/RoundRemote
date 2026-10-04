// Home: every service on a ring around a clock. Green dot = signed in / reachable.
import { h, badge, iconBtn } from '../ui/dom.js';
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
    const ui = parseFloat(document.getElementById('app')?.style.getPropertyValue('--ui')) || 1;
    const rad = ui > 1 ? 37.5 + (ui - 1) * 9 : 37.5 - (ui - 1) * 10;   // bigger tiles sit a little further out
    shown.forEach((it, i) => {
      const a = (i / shown.length) * Math.PI * 2;
      it.btn.style.left = `${50 + rad * Math.sin(a)}%`;
      it.btn.style.top = `${50 - rad * Math.cos(a)}%`;
    });
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
  // The main categories: Music · Media (movies & TV) · Home (smart home) · Games · Rhythm · Settings
  const setMode = (m) => { if (mode() !== m) { store.set('homeMode', m); ring.classList.remove('swap'); void ring.offsetWidth; ring.classList.add('swap'); } };
  const modeBtns = [['music', 'note', 'Music'], ['media', 'film', 'Media'], ['home', 'house', 'Home'], ['games', 'gamepad', 'Games'], ['rhythm', 'rhythm', 'Rhythm'], ['settings', 'settings', 'Settings']].map(([m, ic, label]) => h('button.hm-btn', {
    type: 'button', dataset: { mode: m }, 'aria-label': label, html: `${icon(ic)}<span>${label}</span>`,
    onclick: (e) => { e.stopPropagation(); if (['settings', 'games', 'rhythm'].includes(m)) go(m); else setMode(m); },
  }));
  const modeSwitch = h('div.home-mode', modeBtns);
  const center = h('div.home-center', h('div.brand', 'ROUND REMOTE'), clock, date, modeSwitch, now);
  const el = h('div.home', h('div.home-glow'), ring, center, hint);
  // the Home background chosen for the theme (Settings → Theme → Home background)
  const backdrop = mountBackdrop(el, backdropSpec());
  el.classList.add('has-backdrop');
  const offTheme = themeEvents.on('change', () => backdrop.set(backdropSpec()));
  const offLite = store.on('change:liteMode', () => backdrop.set(backdropSpec()));
  const offUi = store.on('change:uiSize', () => setTimeout(layout, 0));

  function tickClock() {
    const d = new Date();
    const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(d);
    const main = parts.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim();
    const period = parts.find((x) => x.type === 'dayPeriod')?.value;
    clock.textContent = main;
    if (period) clock.append(h('small', period));
    date.textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  }
  tickClock();
  const clockT = setInterval(tickClock, 5000);

  function renderNow() {
    const t = player.state.track;
    now.innerHTML = '';
    now.hidden = !t;
    if (!t) return;
    now.classList.toggle('video', player.provider?.section === 'media');   // a poster doesn't spin like a record
    now.append(h('span.now-art', { style: { backgroundImage: t.art ? `url("${t.art}")` : '' } }),
      h('span.now-text', h('b', t.title), h('small', t.artist)));
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
  el.addEventListener('pointerdown', (e) => { sx = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  el.addEventListener('pointerup', (e) => {
    if (!sx) return;
    const dx = e.clientX - sx.x, dy = e.clientY - sx.y, dt = performance.now() - sx.t; sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 700) setMode(MODES[(MODES.indexOf(mode()) + (dx < 0 ? 1 : MODES.length - 1)) % MODES.length]);
  });

  return { el, destroy() { clearInterval(clockT); offNow(); offFilter(); offDemo(); offMode(); offTheme(); offLite(); offUi(); backdrop.destroy(); } };
}
