// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// "Set up from your phone or computer" on the round display: a QR code + a 6-digit code to pair a phone (or a
// computer's browser) with this display, who's connected, and a disconnect button. Used as a panel (from the service
// setup screens and Home's first-run hint) and as a Settings page (General → Set up from phone or computer).
// The work happens in js/core/remote-setup.js; the phone's page is bridge/lib/setup.js → /setup.
import { h, clear } from '../ui/dom.js';
import { openPanel, toast } from '../ui/overlay.js';
import { store } from '../core/store.js';
import { go } from '../core/router.js';
import { qrSvg } from '../../apps/qr.js';
import { remoteSetup } from '../core/remote-setup.js';
import { bridgeBase } from '../providers/bridge.js';
import { SERVICES, provider } from '../providers/registry.js';
import { registerSettings } from './settings-registry.js';

const PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 18.6h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const COMPUTER = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 20h7M12 16v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const QR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 3h7v7H3zm2 2v3h3V5zm9-2h7v7h-7zm2 2v3h3V5zM3 14h7v7H3zm2 2v3h3v-3zm8-2h2v2h-2zm2 2h2v2h-2zm2-2h2v2h-2zm2 2h2v2h-2zm-6 2h2v2h-2zm4 0h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2z"/></svg>';

/** Which phone-page card belongs to a service tile. */
const CARD = { spotify: 'spotify', apple: 'apple', ytmusic: 'youtube', youtube: 'youtube', plex: 'plex', plexvideo: 'plex', jellyfin: 'jellyfin', jellyfinvideo: 'jellyfin',
  androidtv: 'tvs', appletv: 'tvs', ytvideo: 'tvs', homeassistant: 'homeassistant', googlehome: 'googlehome', playstation: 'playstation', steam: 'steam', streamer: 'streamer' };
export const phoneCardFor = (serviceId) => CARD[serviceId] || '';

let cssDone = false;
function ensureCss() {
  if (cssDone || document.getElementById('setup-remote-css')) { cssDone = true; return; }
  const l = document.createElement('link');
  l.id = 'setup-remote-css'; l.rel = 'stylesheet'; l.href = new URL('../../css/setup-remote.css', import.meta.url).href;
  document.head.append(l); cssDone = true;
}
const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const shortText = (u) => String(u || '').replace(/^https?:\/\//, '');

/**
 * The pairing view. `service` opens that service's card on the phone; `panel` = the round panel layout
 * (QR beside the code) instead of the settings column.
 */
export function pairView({ service = '', panel = false, onLeave, lazy = false } = {}) {
  ensureCss();
  const card = phoneCardFor(service) || service;
  const el = h(`div.rs-view${panel ? '.rs-panel-view' : '.rs-page-view'}`);
  let detach = null;   // while shown, the display keeps a fresh code ready (js/core/remote-setup.js)
  let lastUrl = '', qrEl = null, ringFg = null, timeEl = null, destroyed = false;
  const C = 2 * Math.PI * 47;

  const pill = (label, onClick, cls = '') => h(`button.pill.small${cls ? '.' + cls : ''}`, { type: 'button', onclick: (e) => { e.stopPropagation(); onClick(e.currentTarget); } }, label);

  function paintBody() {
    if (destroyed) return;
    const s = remoteSetup.state;
    clear(el);
    lastUrl = ''; qrEl = null; ringFg = null; timeEl = null;
    if (s.status === 'connecting' || (s.status === 'off' && !s.pair)) {
      el.append(h('div.rs-wait', h('div.spin'), h('div', 'Finding the bridge…')));
      return;
    }
    if (s.status === 'nobridge' || s.status === 'old') {
      el.append(h('div.rs-off',
        h('div.rs-off-ic', { html: PHONE }),
        h('div.rs-off-t', s.status === 'old' ? 'Update the bridge first' : 'Phone setup needs the bridge'),
        h('div.rs-off-m', s.status === 'old'
          ? 'This bridge is older than phone setup. Update it (Settings → Device → Update on the Pi, or git pull on the computer) and restart it.'
          : 'The phone page is served by the bridge on your network. On the Pi it’s already running; on a computer start start-bridge.bat (or ./start-bridge.sh) and set Settings → Connection → Bridge if it isn’t found.'),
        h('div.rs-off-b',
          pill('Try again', async () => { await bridgeBase({ force: true }); start(); }, 'primary'),
          pill('Set up here instead', () => { onLeave?.(); go('connect', { id: service || 'spotify' }); }))));
      return;
    }
    if (!s.url) {
      el.append(h('div.rs-off', h('div.rs-off-t', 'Phones can’t reach this bridge'),
        h('div.rs-off-m', 'The bridge has no network address a phone can open. Set "setup": { "publicUrl": "http://192.168.1.50:8765" } in bridge/config.json.')));
      return;
    }
    // QR with a ring that runs down with the code's time left
    const ring = h('div.rs-ring', { html: `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="rs-ring-bg" cx="50" cy="50" r="47"/><circle class="rs-ring-fg" cx="50" cy="50" r="47" transform="rotate(-90 50 50)" stroke-dasharray="${C.toFixed(1)}"/></svg>` });
    ringFg = ring.querySelector('.rs-ring-fg');
    qrEl = h('div.rs-qr', { role: 'img', 'aria-label': 'QR code for phone setup' });
    ring.append(qrEl);
    const code = s.pair?.code || '';
    timeEl = h('div.rs-time');
    const info = h('div.rs-info',
      h('div.rs-step', 'Scan with your phone camera'),
      h('div.rs-or', 'or open'),
      h('div.rs-url', shortText(s.shortUrl)),
      h('div.rs-or', 'and type'),
      h('div.rs-code', { 'aria-label': `code ${code.split('').join(' ')}` }, code ? `${code.slice(0, 3)} ${code.slice(3)}` : '— — —'),
      timeEl);
    const phones = h('div.rs-phones');
    for (const p of s.phones) {
      phones.append(h('div.rs-phone', { dataset: { phone: p.id } },
        h('span.rs-phone-ic', { html: p.kind === 'computer' ? COMPUTER : PHONE }),
        h('span.rs-phone-t', h('b', `${p.kind === 'computer' ? 'Computer' : p.kind === 'tablet' ? 'Tablet' : 'Phone'} connected`), h('span', ` — ${p.name}`)),
        h('button.rs-phone-x', { type: 'button', 'aria-label': `Disconnect ${p.name}`, title: 'Disconnect', onclick: async (e) => {
          e.stopPropagation(); await remoteSetup.kick(p.id).catch(() => {}); toast(`${p.name} disconnected`);
        } }, '✕')));
    }
    if (!s.phones.length) phones.append(h('div.rs-waiting', h('span.rs-pulse'), 'Waiting for a phone or computer…'));
    const acts = h('div.rs-acts');
    if (s.phones.length) acts.append(pill('End setup', async () => { await remoteSetup.stop(); toast('Setup ended — phones disconnected'); onLeave?.(); }, 'danger'));
    else if (!panel) acts.append(pill('New code', () => remoteSetup.newCode().catch(() => {})));
    el.append(h('div.rs-main', ring, info), phones, acts);
    if (!panel) el.append(h('div.rs-hint', 'Type keys, tokens and passwords on your phone or computer instead of the round screen. Every service has a guide there; what you enter goes straight to this display and the bridge on your network. The code works for 15 minutes; a connected phone stays signed in for 15 idle minutes.'));
    paintQr(); tick();
  }
  function paintQr() {
    const url = remoteSetup.state.url;
    if (!qrEl || url === lastUrl) return;
    lastUrl = url;
    try { qrEl.innerHTML = qrSvg(url, { margin: 2, dark: '#111', light: '#fff' }); qrEl.dataset.url = url; } catch { qrEl.textContent = ''; }
  }
  function tick() {
    const p = remoteSetup.state.pair;
    if (!ringFg || !timeEl) return;
    const left = p ? Math.max(0, p.exp - Date.now()) : 0;
    ringFg.setAttribute('stroke-dashoffset', (C * (1 - left / (15 * 60e3))).toFixed(1));
    timeEl.textContent = p ? (left > 0 ? `code works ${fmt(left)} more` : 'new code…') : '';
  }
  let sig = '';
  const onState = () => {
    const s = remoteSetup.state;
    const next = JSON.stringify([s.status, s.pair?.code, s.phones.map((p) => p.id + p.name), !!s.url]);
    if (next !== sig) { sig = next; paintBody(); } else paintQr();
  };
  const off1 = remoteSetup.events.on('state', onState);
  // A settings page can be built long before it's shown (or never, e.g. by a search): pair only while it's on screen.
  const visible = () => el.isConnected && (!lazy || !!el.closest('.set-page.shown'));
  const timer = setInterval(() => {
    if (!el.isConnected && el.dataset.mounted) { destroy(); return; }
    if (el.isConnected) el.dataset.mounted = '1';
    const vis = visible();
    if (vis && !detach) { detach = remoteSetup.attach(); start(); }
    else if (!vis && detach) { detach(); detach = null; }
    tick();
  }, 1000);
  function start() { remoteSetup.start({ service: card }).catch(() => {}); }
  function destroy() { if (destroyed) return; destroyed = true; clearInterval(timer); off1(); detach?.(); detach = null; }
  onState();
  if (!lazy) { detach = remoteSetup.attach(); start(); }
  return { el, destroy };
}

/** Open the pairing panel (from a service's setup screen or Home's first-run hint). */
export function openRemoteSetup({ service = '' } = {}) {
  ensureCss();
  return openPanel({
    title: 'Set up from your phone', className: 'rs-panel',
    build(body, panel) {
      const v = pairView({ service, panel: true, onLeave: () => panel.close() });
      body.append(v.el);
      panel.onDestroy = v.destroy;
    },
  });
}

/** The "Set up on your phone" button for a service's setup screen. */
export function setupButton(serviceId) {
  ensureCss();
  return h('button.pill.rs-btn', { type: 'button', onclick: (e) => { e.stopPropagation(); openRemoteSetup({ service: serviceId }); } },
    h('span.rs-btn-qr', { html: QR }), h('span', 'Set up on your phone'));
}

/** True while nothing that needs a sign-in is signed in (Home then offers phone setup). */
export function nothingSignedIn() {
  return !SERVICES.some((s) => {
    const p = provider(s.id);
    if (s.kind === 'youtube') return !!(store.get('youtubeApiKey') || '').trim();
    if (['oauth', 'hass'].includes(s.kind) || ['playstation', 'steam', 'streamer'].includes(s.id)) { try { return p.isAuthed() && !p.setupHint(); } catch { return false; } }
    return false;
  });
}
/** Home's first-run hint: "Set up with your phone" (with a ✕ to hide it for good). */
export function homeSetupHint() {
  if (store.get('setupHintOff')) return null;
  ensureCss();
  return h('span.rs-home',
    h('button.rs-home-go', { type: 'button', onclick: (e) => { e.stopPropagation(); openRemoteSetup(); } }, h('span.rs-btn-qr', { html: PHONE }), 'Set up with your phone'),
    h('button.rs-home-x', { type: 'button', 'aria-label': 'Hide', onclick: (e) => { e.stopPropagation(); store.set('setupHintOff', true); e.currentTarget.parentElement.remove(); } }, '✕'));
}

// Settings → General → "Set up from phone or computer"
registerSettings({
  group: 'general', id: 'remote-setup', title: 'Set up from phone or computer', icon: 'link', order: 1,
  summary: 'Type keys and passwords on your phone', keywords: 'phone computer qr code pair sign in keys tokens password setup',
  sub: () => { const p = remoteSetup.state.phones; return p.length ? `${p[0].kind === 'computer' ? 'Computer' : 'Phone'} connected — ${p[0].name}` : 'Type keys and passwords on your phone'; },
  build(el, ctx) {
    const v = pairView({ lazy: true });
    el.append(v.el);
    ctx?.onClose?.(v.destroy);
  },
});
