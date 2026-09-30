// Home: every service on a ring around a clock. Green dot = signed in / reachable.
import { h, badge, iconBtn } from '../ui/dom.js';
import { SERVICES, provider, inSection, adapterOf } from '../providers/registry.js';
import { icon } from '../ui/icons.js';
import { bridgeInfo } from '../providers/bridge.js';
import { openService } from '../core/nav.js';
import { player } from '../core/player.js';
import { go } from '../core/router.js';
import { store } from '../core/store.js';

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
    shown.forEach((it, i) => {
      const a = (i / shown.length) * Math.PI * 2;
      it.btn.style.left = `${50 + 37.5 * Math.sin(a)}%`;
      it.btn.style.top = `${50 - 37.5 * Math.cos(a)}%`;
    });
  }

  const clock = h('div.clock');
  const date = h('div.date');
  const now = h('button.now-mini', { type: 'button', onclick: () => go('player') });
  // The four main categories: Music · Media (movies & TV) · Home (smart home) · Settings
  const setMode = (m) => { if (mode() !== m) { store.set('homeMode', m); ring.classList.remove('swap'); void ring.offsetWidth; ring.classList.add('swap'); } };
  const modeBtns = [['music', 'note', 'Music'], ['media', 'film', 'Media'], ['home', 'house', 'Home'], ['settings', 'settings', 'Settings']].map(([m, ic, label]) => h('button.hm-btn', {
    type: 'button', dataset: { mode: m }, 'aria-label': label, html: `${icon(ic)}<span>${label}</span>`,
    onclick: (e) => { e.stopPropagation(); if (m === 'settings') go('settings'); else setMode(m); },
  }));
  const modeSwitch = h('div.home-mode', modeBtns);
  const center = h('div.home-center', h('div.brand', 'ROUND REMOTE'), clock, date, modeSwitch, now);
  const el = h('div.home', h('div.home-glow'), ring, center, hint);

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
        : it.svc.id === 'computer' ? ['cider', 'winmedia', 'mpris'].some((k) => ad[k]?.enabled)
        : ad[adapterOf(it.svc)]?.enabled;
      it.ready = !!ok;
      it.btn.classList.toggle('ready', it.ready);
      if (info && !ok) it.btn.classList.add('off');
      if (!info) it.btn.classList.add('needs-bridge');
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

  return { el, destroy() { clearInterval(clockT); offNow(); offFilter(); offDemo(); offMode(); } };
}
