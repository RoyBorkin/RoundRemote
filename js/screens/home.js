// Home: every service on a ring around a clock. Green dot = signed in / reachable.
import { h, badge, iconBtn } from '../ui/dom.js';
import { SERVICES, provider } from '../providers/registry.js';
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
  function layout() {
    const only = store.get('onlySignedIn');
    const demo = store.get('showDemo');
    const avail = items.filter((it) => demo || it.svc.id !== 'demo');
    let shown = avail.filter((it) => !only || (it.ready && it.svc.kind !== 'local'));
    hint.textContent = '';
    if (!shown.length) {
      // Nothing signed in yet: show the Demo, or (with the Demo hidden) every service so you can sign in.
      shown = demo ? avail.filter((it) => it.svc.kind === 'local') : avail;
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
  const settings = iconBtn('settings', 'Settings', () => go('settings'), 'home-settings');
  const center = h('div.home-center', h('div.brand', 'ROUND REMOTE'), clock, date, now, settings);
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
        : ad[it.svc.id]?.enabled;
      it.ready = !!ok;
      it.btn.classList.toggle('ready', it.ready);
      if (info && !ok) it.btn.classList.add('off');
      if (!info) it.btn.classList.add('needs-bridge');
    }
    layout();
  })();
  const offFilter = store.on('change:onlySignedIn', layout);
  const offDemo = store.on('change:showDemo', layout);

  return { el, destroy() { clearInterval(clockT); offNow(); offFilter(); offDemo(); } };
}
