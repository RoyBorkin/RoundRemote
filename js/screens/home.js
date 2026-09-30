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
  const n = SERVICES.length;
  const items = SERVICES.map((svc, i) => {
    const a = (i / n) * Math.PI * 2;
    const btn = h('button.svc', {
      type: 'button', 'aria-label': svc.name, '--c': svc.color,
      style: { left: `${50 + 37.5 * Math.sin(a)}%`, top: `${50 - 37.5 * Math.cos(a)}%`, animationDelay: `${i * 35}ms` },
      onclick: () => openService(svc.id),
    }, badge(svc), h('span.svc-name', svc.name.replace(' / Plexamp', '').replace(' / DLNA', '')), h('span.svc-dot'));
    if (svc.id === store.get('lastService')) btn.classList.add('last');
    ring.appendChild(btn);
    return { svc, btn };
  });

  const clock = h('div.clock');
  const date = h('div.date');
  const now = h('button.now-mini', { type: 'button', onclick: () => go('player') });
  const settings = iconBtn('settings', 'Settings', () => go('settings'), 'home-settings');
  const center = h('div.home-center', h('div.brand', 'ROUND REMOTE'), clock, date, now, settings);
  const el = h('div.home', h('div.home-glow'), ring, center);

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

  // Status dots
  (async () => {
    for (const { svc, btn } of items) {
      const p = provider(svc.id);
      if (svc.kind !== 'bridge') btn.classList.toggle('ready', !p.setupHint() && p.isAuthed());
    }
    const info = await bridgeInfo({ passive: true });
    for (const { svc, btn } of items) {
      if (svc.kind !== 'bridge') continue;
      const ad = info?.adapters || {};
      const ok = svc.id === 'tidal' || svc.id === 'qobuz'
        ? Object.values(ad).some((a) => a.enabled && a.id !== 'mock')
        : ad[svc.id]?.enabled;
      btn.classList.toggle('ready', !!ok);
      if (info && !ok) btn.classList.add('off');
    }
  })();

  return { el, destroy() { clearInterval(clockT); offNow(); } };
}
