// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Settings → Connection → Server: where this Raspberry Pi gets Round Remote from.
//   • This Pi's own bridge (the default: adapters, phone pages and data on this Pi)
//   • A Round Remote server (the Docker container on the NAS, or another bridge): this Pi becomes a companion —
//     it keeps its own Wi-Fi, Bluetooth, sound and screen settings, everything else comes from the server.
// Address (on-screen keyboard), Find servers (mDNS), Test, Connect; "Use this Pi's own bridge" switches back at once.
// A light companion (pi/install.sh --mode=companion) has no bridge of its own: only the server part shows.
// Shown only on the device's own screen, when its bridge offers it (bridge/lib/companion.js; js/core/companion.js).
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/overlay.js';
import { editText } from '../ui/keyboard.js';
import { registerSettings } from './settings-registry.js';
import { companionStatus, fetchStatus, companionPost, findServers, companionEvents } from '../core/companion.js';
import { ensureCss } from '../core/device.js';

const short = (u) => String(u || '').replace(/^https?:\/\//, '');
const ago = (ts) => { const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
const stop = (e) => e?.stopPropagation?.();
function pill(label, onClick, cls = '') {
  const b = h(`button.pill.small${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button' }, label);
  b.onclick = (e) => { stop(e); onClick(b, e); };
  return b;
}

export function buildServerSettings(el) {
  ensureCss();
  let st = companionStatus();
  let addr = short(st?.server || '');
  let choice = st?.enabled || st?.mode === 'light' ? 'server' : 'local';
  let force = false;

  const card = h('div.dv-card.dv-now');
  const chipsRow = h('div.chips');
  const addrBtn = h('button.row.dv-row', { type: 'button' });
  const msg = h('div.dv-status-line');
  const found = h('div.dv-list');
  const findBtn = pill('Find servers', () => find());
  const testBtn = pill('Test', () => test());
  const goBtn = pill('Connect', () => connect(), 'primary');
  const localBtn = pill('Use this Pi’s own bridge', (b) => useLocal(b));
  const serverBox = h('div.dv-list', { style: { alignItems: 'center', width: '100%' } });
  const ro = h('div.dv-remote', 'You’re looking at this Pi from another device — change the server on the round display itself.');
  const hint = h('div.opt-hint');

  const say = (t, kind = '') => { msg.textContent = t; msg.style.color = kind === 'bad' ? 'var(--danger, #ff5a6a)' : kind === 'good' ? 'var(--accent)' : ''; };
  function paintCard() {
    clear(card);
    const s = st;
    const icn = (name, off) => h(`span.dv-now-ic${off ? '.off' : ''}`, { html: icon(name) });
    if (!s) { card.append(icn('link', true), h('div.row-text', h('div.row-title', 'Checking…'))); return; }
    if (!s.enabled && s.mode !== 'light') {
      card.append(icn('home'), h('div.row-text', h('div.row-title', 'This Pi’s own bridge'), h('div.row-sub', 'Adapters, phone pages and lists live on this Pi')));
      return;
    }
    if (!s.server) { card.append(icn('link', true), h('div.row-text', h('div.row-title', 'No server yet'), h('div.row-sub', 'Enter its address below'))); return; }
    const sub = s.online
      ? [`Online · ${s.latencyMs ?? '?'} ms`, s.serverVersion ? `server ${s.serverVersion}${s.serverRole && s.serverRole !== 'server' ? ` (${s.serverRole})` : ''}` : ''].filter(Boolean).join(' · ')
      : s.state === 'checking' ? 'Connecting…' : `Offline${s.lastOk ? ` · last contact ${ago(s.lastOk)} ago` : ''}${s.lastError ? ` · ${s.lastError}` : ''}`;
    card.append(icn('link', !s.online), h('div.row-text', h('div.row-title.dv-mono', short(s.server)), h('div.row-sub', sub)));
  }
  function paintChoice() {
    clear(chipsRow);
    const opts = st?.mode === 'light' ? [{ id: 'server', name: 'Round Remote server' }] : [{ id: 'local', name: 'This Pi’s own bridge' }, { id: 'server', name: 'Round Remote server' }];
    for (const o of opts) {
      chipsRow.append(h(`button.chip${o.id === choice ? '.on' : ''}`, { type: 'button', onclick: (e) => { stop(e); pick(o.id); } }, o.name));
    }
    serverBox.hidden = choice !== 'server';
    const connected = st?.enabled && short(st.server) === addr;
    goBtn.textContent = force ? 'Save anyway' : connected ? 'Reconnect' : 'Connect';
    localBtn.hidden = !(st?.enabled && st?.canUseLocal && choice === 'local');   // switching back: pick the chip, then confirm
    hint.textContent = st?.mode === 'light'
      ? 'This is a light companion (pi/install.sh --mode=companion): the app, music services, phone pages and lists all come from the server. This Pi keeps its own Wi-Fi, Bluetooth, sound and screen settings. While the server is offline, the round screen shows “Server offline” with Wi-Fi and server settings.'
      : 'With a Round Remote server (e.g. the Docker container on your NAS), this Pi only shows the app: music services, adapters, phone pages and lists come from the server, and this Pi keeps its own Wi-Fi, Bluetooth, sound and screen settings. Switching is instant — no restart. While the server is offline, the round screen shows “Server offline” with a button back to this Pi’s own bridge.';
  }
  function paintAddr() {
    clear(addrBtn);
    addrBtn.append(h('span.dv-row-ic', { html: icon('edit') }), h('div.row-text', h(addr ? 'div.row-title.dv-mono' : 'div.row-title', addr || 'Server address'), h('div.row-sub', addr ? 'Tap to change' : 'e.g. 192.168.50.108:8765')));
  }
  function pick(id) {
    if (id === choice) return;
    choice = id;
    say('');
    paintChoice();
  }
  addrBtn.onclick = async (e) => {
    stop(e);
    const v = await editText({ title: 'Server address', value: addr, placeholder: '192.168.50.108:8765', okLabel: 'OK' });
    if (v == null) return;
    addr = short(v.trim()); force = false; say(''); paintAddr(); paintChoice();
  };
  async function test() {
    if (!addr) return say('Enter the address first', 'bad');
    testBtn.disabled = true; say('Testing…');
    try {
      const r = await companionPost('test', { server: addr }, 9000);
      say(r.ok ? `Found Round Remote ${r.version || ''}${r.role ? ` (${r.role})` : ''} · ${r.latencyMs} ms` : r.error, r.ok ? 'good' : 'bad');
    } catch (err) { say(err.message, 'bad'); }
    testBtn.disabled = false;
  }
  async function connect() {
    if (!addr) return say('Enter the address first', 'bad');
    goBtn.disabled = true; say('Connecting…');
    try {
      const r = await companionPost('connect', { server: addr, force }, 12000);
      force = false; st = r;
      say(r.online ? 'Connected — loading Round Remote from the server…' : 'Saved — waiting for the server to answer', 'good');
      paintCard(); paintChoice();
      // the app itself now comes from the server: start it again from there
      if (r.online) setTimeout(() => location.reload(), 1200);
    } catch (err) {
      if (err.status === 502) { force = true; say(`${err.message} — “Save anyway” keeps the address and waits for it`, 'bad'); }
      else say(err.message, 'bad');
      paintChoice();
    }
    goBtn.disabled = false;
  }
  async function useLocal(b) {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to switch'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Use this Pi’s own bridge'; }, 3000); return; }
    delete b.dataset.armed;
    b.disabled = true;
    try { st = await companionPost('disconnect', {}); toast('This Pi’s own bridge'); setTimeout(() => location.reload(), 600); }
    catch (err) { say(err.message, 'bad'); b.disabled = false; b.textContent = 'Use this Pi’s own bridge'; }
  }
  async function find() {
    findBtn.disabled = true; findBtn.textContent = 'Looking…';
    clear(found); found.append(h('div.dv-empty', h('div.spin'), 'Looking on the network…'));
    try {
      const list = await findServers();
      clear(found);
      if (!list.length) found.append(h('div.dv-empty', 'None found — type the address. (A Docker server is found only with host networking.)'));
      for (const s of list) {
        found.append(h('button.row.dv-row', { type: 'button', onclick: (e) => { stop(e); addr = `${s.address}:${s.port}`; force = false; paintAddr(); paintChoice(); say(`Tap Connect to use ${s.name}`, 'good'); } },
          h('span.dv-row-ic', { html: icon(s.role === 'server' ? 'stack' : 'hub') }),
          h('div.row-text', h('div.row-title', `${s.name}${s.role === 'server' ? ' · server' : ''}`), h('div.row-sub.dv-mono', `${s.address}:${s.port}${s.version ? ` · ${s.version}` : ''}`))));
      }
    } catch (err) { clear(found); say(err.message, 'bad'); }
    findBtn.disabled = false; findBtn.textContent = 'Find servers';
  }

  serverBox.append(addrBtn, h('div.center.dv-gap', findBtn, testBtn, goBtn), msg, found);
  const localRow = h('div.center.dv-gap', localBtn);
  el.append(card, h('div.opt', h('div.opt-label', 'Round Remote comes from'), chipsRow), localRow, serverBox, ro, hint);
  ro.hidden = true;
  const repaint = () => { paintCard(); paintChoice(); };
  paintAddr(); repaint();
  const off = companionEvents.on('status', (s) => { if (!el.isConnected && el.dataset.seen) { off(); return; } if (el.isConnected) el.dataset.seen = '1'; st = s; if (!addr && s.server) { addr = short(s.server); paintAddr(); } repaint(); });
  fetchStatus().then((s) => {
    if (!s) return;
    st = s;
    if (!addr) { addr = short(s.server); paintAddr(); }
    if (choice === 'local' && (s.enabled || s.mode === 'light')) choice = 'server';
    ro.hidden = s.writable !== false;
    [chipsRow, serverBox, localBtn].forEach((n) => { if (s.writable === false) n.querySelectorAll?.('button').forEach((b) => { b.disabled = true; }); });
    repaint();
  });
}

registerSettings({
  group: 'connect', id: 'server', title: 'Server', icon: 'stack', order: 5,
  summary: 'This Pi’s own bridge or a Round Remote server', keywords: 'server nas docker companion proxy remote pi zero offline address',
  // only on the Pi's own screen, and only when its bridge can be a companion (not on a server, not on GitHub Pages)
  hidden: () => { const s = companionStatus(); return !s?.available || s.writable === false; },
  sub: () => { const s = companionStatus(); if (!s) return ''; if (!s.enabled && s.mode !== 'light') return 'This Pi’s own bridge'; return `${short(s.server) || 'not set'} · ${s.online ? 'online' : 'offline'}`; },
  build: buildServerSettings,
});
