// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Settings → Home screen: which services the Home ring shows (per mode, with their order) and the battery level.
import { h, badge } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toggle } from './panels.js';
import { store } from '../core/store.js';
import { provider } from '../providers/registry.js';
import { HOME_MODES, homeServices, isHomeHidden, setHomeHidden, moveHomeService } from './home-services.js';

/** Home screen → Services: a switch per service, per Home mode, with ↑ ↓ to change the order. */
export function homeServicesPage() {
  const out = [
    toggle('Show only signed-in services', () => store.get('onlySignedIn'), (v) => store.set('onlySignedIn', v)),
    toggle('Show the Demo service', () => store.get('showDemo'), (v) => store.set('showDemo', v)),
    h('div.opt-hint', 'Turn a service off to take it off the Home ring (its sign-in stays). ↑ ↓ change the order. On Home you can also hold a tile → Hide from Home.'),
  ];
  for (const m of HOME_MODES) {
    const head = h('div.section.hs-head', m.name);
    let rows = [];
    const paint = () => {
      const list = homeServices(m.id);
      const fresh = list.map((s, i) => row(s, i, list.length));
      if (rows.length && rows[0].parentNode) {
        const parent = rows[0].parentNode, after = rows[rows.length - 1].nextSibling;
        rows.forEach((r) => r.remove());
        fresh.forEach((r) => parent.insertBefore(r, after));
      }
      rows = fresh;
      return fresh;
    };
    const row = (s, i, n) => {
      const sw = h('button.switch', { type: 'button', role: 'switch', 'aria-label': s.name });
      const paintSw = () => { const on = !isHomeHidden(s.id); sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on)); el.classList.toggle('off', !on); };
      sw.onclick = (e) => { e.stopPropagation(); setHomeHidden(s.id, !isHomeHidden(s.id)); paintSw(); };
      const mv = (d, label, cls) => {
        const b = h(`button.hs-mv.${cls}`, { type: 'button', 'aria-label': `${label}: ${s.name}`, html: icon('chevron'), disabled: (d < 0 ? i === 0 : i === n - 1) || undefined });
        b.onclick = (e) => {
          e.stopPropagation();
          if (!moveHomeService(s.id, d, m.id)) return;
          const fresh = paint();
          fresh.find((r) => r.dataset.svc === s.id)?.querySelector(`.hs-mv.${cls}:not([disabled])`)?.focus({ preventScroll: true });
        };
        return b;
      };
      let signed = false;
      try { const p = provider(s.id); signed = s.kind === 'local' || (!p.setupHint?.() && p.isAuthed?.()); } catch {}
      const el = h('div.opt.row-opt.hs-row', { dataset: { svc: s.id } },
        badge(s, 'sm'),
        h('div.hs-text', h('div.hs-name', s.short || s.name), h('div.hs-sub', s.kind === 'bridge' ? 'Through the bridge' : signed ? 'Signed in' : s.kind === 'local' ? 'No sign-in' : 'Not signed in')),
        h('div.hs-mvs', mv(-1, 'Earlier', 'up'), mv(1, 'Later', 'down')),
        sw);
      paintSw();
      return el;
    };
    out.push(head, ...paint());
  }
  const offDemo = store.on('change:showDemo', () => {
    const on = store.get('showDemo') !== false;
    for (const b of [out[1].querySelector('.switch'), ...(out[0].parentNode?.querySelectorAll('.hs-row[data-svc="demo"] .switch') || [])]) {
      if (!b) continue;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.closest('.hs-row')?.classList.toggle('off', !on);
    }
    if (!out[0].isConnected) offDemo();
  });
  return out;
}

/** Home screen → Battery level. */
export function homeBatteryOpts() {
  return [
    toggle('Battery level on Home', () => store.get('homeBattery') !== false, (v) => store.set('homeBattery', v)),
    h('div.opt-hint', 'Next to the date, when this device has a battery (the Pi’s battery through the bridge, or the phone, tablet or laptop’s own). Amber at 20 %, red at 10 %.'),
  ];
}
