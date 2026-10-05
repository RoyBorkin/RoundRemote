// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Settings → Device: the Raspberry Pi appliance's own settings, shown only when the bridge says it runs on a Pi
// (GET /api/system/info → pi:true; ?device=1 shows them anyway for testing): Wi-Fi, Bluetooth, Sound, Battery &
// power, Screen, Orientation, Updates, Restart / Shut down. The calls are in js/core/device.js, the rotation in
// js/core/orientation.js, Battery saver and screen-off in js/core/power.js.
// Without a Pi (the GitHub Pages web app on a phone or tablet) the Device group stays hidden and
// displayExtras() offers Screen rotation and Battery saver under General → Display instead.
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { editText } from '../ui/keyboard.js';
import { openPanel, toast } from '../ui/overlay.js';
import { store, DEFAULTS } from '../core/store.js';
import { clamp, throttle } from '../core/util.js';
import { bridgeFetch } from '../providers/bridge.js';
import { systemInfo, cachedInfo, forcedDevice, sysGet, sysPost, errText, errCode, CODE_TEXT, REMOTE_TEXT, canWrite, appVersion, ensureCss } from '../core/device.js';
import { orientation, orientState, rotateBy, calibrate, requestMotionPermission, ORIENT_MODES, ORIENT_SOURCES } from '../core/orientation.js';
import { power, batteryState, batterySource, saverActions, refreshBattery, lastPowerError, screenOff } from '../core/power.js';

// ---------------------------------------------------------------- little helpers
const svg = (d, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONS = {   // Material Icons paths (Apache-2.0), like js/ui/icons.js
  bluetooth: 'M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z',
  headphones: 'M12 1a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h3v-8H5v-2a7 7 0 0 1 14 0v2h-4v8h3a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z',
  keyboard: 'M20 5H4a2 2 0 0 0-1.99 2L2 17a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z',
  phone: 'M17 1.01 7 1a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-1.99zM17 19H7V5h10v14z',
  mouse: 'M13 1.07V9h7a8 8 0 0 0-7-7.93zM4 15a8 8 0 0 0 16 0v-4H4v4zm7-13.93A8 8 0 0 0 4 9h7V1.07z',
  watch: 'M20 12a8 8 0 0 0-3.03-6.27L16 0H8l-.96 5.73A7.98 7.98 0 0 0 4 12c0 2.54 1.19 4.81 3.04 6.27L8 24h8l.97-5.73A7.98 7.98 0 0 0 20 12zM6 12a6 6 0 1 1 12 0 6 6 0 0 1-12 0z',
  rotL: 'M7.11 8.53 5.7 7.11A7.9 7.9 0 0 0 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07a7.9 7.9 0 0 0 1.62 3.89l1.41-1.42A5.9 5.9 0 0 1 6.09 13zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9a5.9 5.9 0 0 1-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09A6 6 0 0 1 18 12a6 6 0 0 1-5 5.91v2.02A8 8 0 0 0 20 12a8 8 0 0 0-7-7.93z',
  rotR: 'M15.55 5.55 11 1v3.07A8 8 0 0 0 4 12a8 8 0 0 0 7 7.93v-2.02A6 6 0 0 1 6 12a6 6 0 0 1 5-5.91V10l4.55-4.45zM19.93 11a7.9 7.9 0 0 0-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02a7.9 7.9 0 0 0 3.9-1.61l-1.44-1.44A5.9 5.9 0 0 1 13 17.9zm3.89-2.42 1.42 1.41A7.9 7.9 0 0 0 19.93 13h-2.02a5.9 5.9 0 0 1-1.02 2.48z',
  upload: 'M5 20h14v-2H5v2zm0-10h4v6h6v-6h4l-7-7-7 7z',
  restart: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  hotspot: 'M12 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 2a6 6 0 0 0-12 0c0 2.22 1.21 4.15 3 5.19l1-1.74A4 4 0 0 1 8 13a4 4 0 0 1 8 0c0 1.48-.81 2.75-2 3.45l1 1.74c1.79-1.04 3-2.97 3-5.19zM12 3A10 10 0 0 0 2 13c0 3.7 2.01 6.92 4.99 8.65l1-1.73A8 8 0 0 1 4 13a8 8 0 0 1 16 0 8 8 0 0 1-4 6.92l1 1.73A10 10 0 0 0 22 13 10 10 0 0 0 12 3z',
};
const ic = (name) => (ICONS[name] ? svg(ICONS[name]) : icon(name));
/** Wi-Fi signal: 4 arcs, lit by strength (0–100). */
function wifiBars(signal = 0, cls = '') {
  const n = signal >= 75 ? 4 : signal >= 50 ? 3 : signal >= 25 ? 2 : signal > 0 ? 1 : 0;
  const arcs = [[5, 8.46, 15.46, 15.54], [9, 5.64, 12.64, 18.36], [13, 2.81, 9.81, 21.19]];
  return `<svg class="ic dv-bars${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="19" r="1.9" class="${n >= 1 ? 'on' : ''}"/>${
    arcs.map(([r, x1, y, x2], i) => `<path d="M${x1} ${y}A${r} ${r} 0 0 1 ${x2} ${y}" class="${n >= i + 2 ? 'on' : ''}"/>`).join('')}</svg>`;
}
const BT_ICON = (d) => {
  const k = String(d.icon || d.type || '').toLowerCase(), n = String(d.name || '').toLowerCase();
  if (/headset|headphone|earbud|airpods|buds/.test(k + ' ' + n)) return 'headphones';
  if (/audio|speaker|sound|soundbar/.test(k + ' ' + n)) return 'speaker';
  if (/keyboard/.test(k + ' ' + n)) return 'keyboard';
  if (/mouse|trackpad|pointing/.test(k + ' ' + n)) return 'mouse';
  if (/gaming|gamepad|joystick|controller|dualsense|dualshock|xbox|joy-con/.test(k + ' ' + n)) return 'gamepad';
  if (/phone|iphone|pixel|galaxy/.test(k + ' ' + n)) return 'phone';
  if (/watch/.test(k + ' ' + n)) return 'watch';
  if (/computer|laptop|macbook/.test(k + ' ' + n)) return 'desktop';
  return 'bluetooth';
};
const opt = (label, control) => h('div.opt', h('div.opt-label', label), control);
const section = (t, id) => h('div.section', { dataset: id ? { dv: id } : undefined }, t);
const hint = (t) => h('div.opt-hint', t);
const stop = (e) => e?.stopPropagation?.();
function pill(label, onClick, cls = '') {
  const b = h(`button.pill.small${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button' }, label);
  b.onclick = (e) => { stop(e); onClick(b, e); };
  return b;
}
/** A switch whose value can be refreshed later (data that arrives from the bridge). */
function sw(label, get, set, sub = '') {
  const b = h('button.switch', { type: 'button', role: 'switch', 'aria-label': label });
  const subEl = h('div.dv-sw-sub', sub);
  const paint = () => { const v = !!get(); b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v)); };
  b.onclick = async (e) => {
    stop(e); if (b.disabled) return;
    const v = !get();
    b.classList.toggle('on', v);
    b.disabled = true;
    try { await set(v); } finally { b.disabled = false; paint(); }
  };
  paint();
  const el = h('div.opt.row-opt.dv-sw', h('div.dv-sw-text', h('div.opt-label', label), subEl), b);
  return Object.assign(el, { paint, setSub: (t) => { subEl.textContent = t; } });
}
/** Chips that can be repainted. */
function chipRow(options, get, onPick) {
  const row = h('div.chips');
  const paint = () => {
    clear(row);
    for (const o of options()) {
      row.append(h(`button.chip${o.id === get() ? '.on' : ''}${o.disabled ? '.dv-dis' : ''}`, { type: 'button', title: o.title || '', onclick: async (e) => { stop(e); await onPick(o.id, e); paint(); } }, o.name));
    }
  };
  paint();
  return Object.assign(row, { paint });
}
function slider(label, get, set, { min = 0, max = 100, step = 1, fmt = (v) => `${v}`, live = true } = {}) {
  const val = h('span.slider-val', fmt(get()));
  const input = h('input.slider', { type: 'range', min, max, step, value: get(), 'aria-label': label });
  const paint = () => input.style.setProperty('--fill', `${((+input.value - min) / (max - min)) * 100}%`);
  input.addEventListener('input', () => { val.textContent = fmt(+input.value); paint(); if (live) set(+input.value); });
  input.addEventListener('change', () => set(+input.value, true));
  input.addEventListener('pointerdown', stop);
  paint();
  const el = h('div.opt.dv-slider', label ? h('div.opt-label', label) : null, h('div.slider-row', input), val);
  return Object.assign(el, { setValue(v) { input.value = v; val.textContent = fmt(v); paint(); }, input });
}
/** Second tap confirms (like the other danger buttons in Settings). */
function armed(b, label, run) {
  if (b.dataset.armed) { delete b.dataset.armed; run(); return; }
  b.dataset.armed = '1'; const old = b.textContent; b.textContent = label;
  setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = old; } }, 3000);
}
/** A round confirm dialog. Resolves true / false. */
function confirmDialog({ title, text, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    openPanel({
      title, className: 'dv-confirm', onClose: () => fin(false),
      build(body, panel) {
        body.append(h('div.dv-confirm-text', text), h('div.dv-actions',
          pill('Cancel', () => { fin(false); panel.close(); }),
          pill(ok, () => { fin(true); panel.close(); }, danger ? 'danger' : 'primary')));
      },
    });
  });
}
const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`);
const fmtClock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Runs `off` functions once the settings screen is gone. */
function lifetime(anchor) {
  const offs = [];
  let seen = false;
  const t = setInterval(() => {
    if (anchor.isConnected) { seen = true; return; }
    if (!seen) return;
    clearInterval(t); offs.splice(0).forEach((f) => { try { f(); } catch {} });
  }, 1500);
  return (f) => { offs.push(f); return f; };
}

// ================================================================= Wi-Fi
function wifiSection(ctx) {
  const st = { enabled: true, current: null, saved: [], networks: [], scanning: false, busy: '', err: {}, hotspot: { on: false }, lastAttempt: null };
  const status = h('div.dv-card.dv-now');
  const radio = sw('Wi-Fi', () => st.enabled, async (v) => {
    try { await sysPost('wifi/radio', { on: v }); st.enabled = v; toast(v ? 'Wi-Fi on' : 'Wi-Fi off'); await load(); }
    catch (e) { toast(errText(e), { kind: 'error' }); }
  });
  const list = h('div.dv-list.dv-nets');
  const scanBtn = pill('Scan', () => scan(), 'primary');
  const savedList = h('div.dv-list.dv-saved');
  const hidden = pill('Join a hidden network', () => joinHidden());
  const hsBox = h('div.dv-card.dv-hotspot.dv-hide');
  const hs = sw('Setup hotspot', () => st.hotspot.on, async (v) => {
    try {
      const r = await sysPost('hotspot', { on: v });
      st.hotspot = { ...st.hotspot, ...(r || {}), on: r?.on ?? v };
      toast(v ? 'Setup hotspot on' : 'Setup hotspot off');
      paintHotspot(); paintStatus();
      if (!v) load();
    } catch (e) { toast(errText(e), { kind: 'error' }); }
  }, 'Phones join it to set up Wi-Fi from their browser');
  hs.classList.add('dv-hide');   // shown when the bridge says the Pi can make one (caps.hotspot)

  function paintStatus() {
    clear(status);
    const c = st.current;
    // a phone's last try from the setup page (GET /api/system/wifi → lastAttempt { ssid, ok, code, error, at })
    const la = st.lastAttempt;
    const laLine = la && !la.ok && Date.now() - (la.at || 0) < 15 * 60000 ? h('div.row-sub.dv-warn', { dir: 'auto' }, `Last try: ${la.ssid} — ${CODE_TEXT[la.code] || la.error || 'failed'}`) : null;
    if (st.hotspot.on) status.append(h('span.dv-now-ic', { html: ic('hotspot') }), h('div.row-text', h('div.row-title', 'Setup hotspot is on'), h('div.row-sub', { dir: 'auto' }, `Phones join “${st.hotspot.ssid || 'RoundRemote-Setup'}”`), laLine));
    else if (!st.enabled) status.append(h('span.dv-now-ic.off', { html: wifiBars(0) }), h('div.row-text', h('div.row-title', 'Wi-Fi is off'), h('div.row-sub', 'Turn it on to connect')));
    else if (c?.ssid) {
      status.append(h('span.dv-now-ic', { html: wifiBars(c.signal) }), h('div.row-text',
        h('div.row-title', { dir: 'auto' }, c.ssid),
        h('div.row-sub', ['Connected', c.signal != null ? `${c.signal}%` : '', c.ip || ''].filter(Boolean).join(' · '))));
    } else status.append(h('span.dv-now-ic.off', { html: wifiBars(0) }), h('div.row-text', h('div.row-title', 'Not connected'), h('div.row-sub', 'Pick a network below'), laLine));
  }
  function paintList() {
    clear(list);
    if (st.scanning && !st.networks.length) { list.append(h('div.dv-empty', h('div.spin'), 'Looking for networks…')); return; }
    if (!st.networks.length) { list.append(h('div.dv-empty', st.enabled ? 'No networks found yet — tap Scan' : 'Wi-Fi is off')); return; }
    for (const n of st.networks) {
      const busy = st.busy === n.ssid, err = st.err[n.ssid];
      const sub = busy ? 'Connecting…' : err || [n.inUse ? 'Connected' : n.saved ? 'Saved' : '', n.security && n.security !== '--' ? n.security : 'Open'].filter(Boolean).join(' · ');
      list.append(h(`button.row.dv-row${n.inUse ? '.on' : ''}${err ? '.err' : ''}`, { type: 'button', disabled: !!st.busy && !busy, onclick: (e) => { stop(e); if (!n.inUse) connect(n); } },
        h('span.dv-row-ic', { html: wifiBars(n.signal) }),
        h('div.row-text', h('div.row-title', { dir: 'auto' }, n.ssid), h('div.row-sub', sub)),
        busy ? h('span.spin.dv-spin') : n.inUse ? h('span.dv-tag', { html: icon('check') }) : isSecure(n) ? h('span.dv-lock', { html: icon('lock') }) : null));
    }
  }
  function paintSaved() {
    clear(savedList);
    if (!st.saved.length) { savedList.append(h('div.dv-empty', 'No saved networks')); return; }
    for (const s of st.saved) {
      savedList.append(h('div.row.dv-row', h('span.dv-row-ic', { html: wifiBars(st.current?.ssid === s.ssid ? st.current.signal : 0) }),
        h('div.row-text', h('div.row-title', { dir: 'auto' }, s.ssid), h('div.row-sub', st.current?.ssid === s.ssid ? 'Connected' : 'Saved')),
        pill('Forget', (b) => armed(b, 'Forget?', () => forget(s.ssid)), 'danger')));
    }
  }
  async function paintHotspot() {
    hsBox.classList.toggle('dv-hide', !st.hotspot.on);
    hs.paint();
    if (!st.hotspot.on) return;
    const ssid = st.hotspot.ssid || 'RoundRemote-Setup', pass = st.hotspot.password || '';
    // the bridge sends the password only to the display itself (or with system.allowRemote)
    const known = 'password' in st.hotspot;
    const url = st.hotspot.url || `http://${st.hotspot.address || '10.42.0.1'}:8765/system/wifi`;
    const esc = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');
    const join = `WIFI:T:${pass ? 'WPA' : 'nopass'};S:${esc(ssid)};${pass ? `P:${esc(pass)};` : ''};`;
    let which = known ? 'join' : 'page';
    const qr = h('div.dv-qr');
    const urlEl = h('div.dv-hs-url', which === 'join' ? 'Scan with a phone camera, then the setup page opens' : url);
    const { qrSvg } = await import('../../apps/qr.js');
    const draw = () => { qr.innerHTML = qrSvg(which === 'join' ? join : url, { margin: 2, dark: '#111', light: '#fff' }); };
    draw();
    clear(hsBox);
    hsBox.append(
      h('div.dv-hs-line', h('span', 'Network'), h('b', { dir: 'auto' }, ssid)),
      h('div.dv-hs-line', h('span', 'Password'), !known ? h('b', 'shown on the display') : pass ? h('b.dv-mono', pass) : h('b', 'none (open)')),
      known ? chipRow(() => [{ id: 'join', name: 'Join the hotspot' }, { id: 'page', name: 'Open setup page' }], () => which, (v) => { which = v; draw(); urlEl.textContent = which === 'join' ? 'Scan with a phone camera, then the setup page opens' : url; }) :'',
      qr, urlEl);
  }
  const isSecure = (n) => !!(n.security && n.security !== '--' && !/^(open|none)$/i.test(n.security));

  async function load() {
    try {
      const r = await sysGet('wifi');
      st.enabled = r?.enabled !== false; st.current = r?.current?.ssid ? r.current : null; st.saved = r?.saved || [];
      if (r?.hotspot) st.hotspot = { ...r.hotspot };
      st.lastAttempt = r?.lastAttempt || null;
    } catch (e) { st.current = null; status.replaceChildren(h('div.dv-err', errText(e))); radio.paint(); return; }
    radio.paint(); paintStatus(); paintSaved(); paintHotspot();
  }
  async function scan() {
    if (st.scanning) return;
    st.scanning = true; scanBtn.disabled = true; scanBtn.textContent = 'Scanning…'; paintList();
    try {
      const r = await sysGet('wifi/scan', { timeout: 30000 });
      const best = new Map();
      for (const n of r?.networks || []) {
        if (!n.ssid) continue;
        const o = best.get(n.ssid);
        if (!o || n.inUse || (!o.inUse && (n.signal || 0) > (o.signal || 0))) best.set(n.ssid, { ...n, saved: n.saved || o?.saved });
      }
      st.networks = [...best.values()].sort((a, b) => (b.inUse - a.inUse) || ((b.saved ? 1 : 0) - (a.saved ? 1 : 0)) || (b.signal || 0) - (a.signal || 0));
    } catch (e) { toast(errText(e), { kind: 'error' }); }
    st.scanning = false; scanBtn.disabled = false; scanBtn.textContent = 'Scan'; paintList();
  }
  async function connect(n, { hidden: isHidden = false, password } = {}) {
    if (password === undefined && isSecure(n) && (!n.saved || /wrong/i.test(st.err[n.ssid] || ''))) {
      password = await editText({ title: `Password for ${n.ssid}`, secret: true, okLabel: 'Connect', placeholder: 'Wi-Fi password' });
      if (password === null) return;
      if (/wpa|wpa2|wpa3|sae|psk/i.test(n.security || 'wpa') && password.length < 8) { st.err[n.ssid] = 'Passwords have at least 8 characters'; paintList(); return; }
    }
    st.busy = n.ssid; delete st.err[n.ssid]; paintList();
    try {
      await sysPost('wifi/connect', { ssid: n.ssid, ...(password ? { password } : {}), ...(isHidden ? { hidden: true } : {}) }, { timeout: 60000 });
      toast(`Connected to ${n.ssid}`);
      st.busy = '';
      await load(); await scan();
    } catch (e) {
      const m = errText(e);
      // the bridge's precise code (bridge/lib/system-net.js): wrong-password · bad-password · not-found · timeout · denied · failed
      const code = errCode(e);
      st.err[n.ssid] = code === 'wrong-password' ? 'Wrong password — tap to try again'
        : code === 'not-found' ? 'Not found — is it in range?'
          : code === 'timeout' ? 'No answer — tap to try again'
            : !code && /secret|password|psk|802-1x|authenticat/i.test(m) ? 'Wrong password? Tap to try again'   // an older bridge: no code
              : m;
      st.busy = '';
      paintList();
      if (isHidden) toast(st.err[n.ssid], { kind: 'error' });
    }
  }
  async function joinHidden() {
    const ssid = await editText({ title: 'Hidden network name', okLabel: 'Next', placeholder: 'Network name (SSID)' });
    if (!ssid) return;
    const pw = await editText({ title: `Password for ${ssid}`, secret: true, okLabel: 'Connect', placeholder: 'empty for an open network' });
    if (pw === null) return;
    if (!st.networks.some((n) => n.ssid === ssid)) { st.networks.unshift({ ssid, signal: 0, security: pw ? 'WPA2' : '' }); paintList(); }
    connect({ ssid, security: pw ? 'WPA2' : '' }, { hidden: true, password: pw });
  }
  async function forget(ssid) {
    try { await sysPost('wifi/forget', { ssid }); toast(`Forgot ${ssid}`); await load(); st.networks = st.networks.map((n) => (n.ssid === ssid ? { ...n, saved: false, inUse: false } : n)); paintList(); }
    catch (e) { toast(errText(e), { kind: 'error' }); }
  }
  paintStatus(); paintList(); paintSaved();
  return {
    cap: 'wifi',
    nodes: [section('Wi-Fi', 'wifi'), radio, status, h('div.center.dv-gap', scanBtn, hidden), list, h('div.opt-label.dv-sub-head', 'Saved networks'), savedList, hs, hsBox],
    load: async (info) => { hs.classList.toggle('dv-hide', info?.caps?.hotspot === false); await load(); scan(); },
  };
}

// ================================================================= Bluetooth
function bluetoothSection() {
  const st = { powered: false, devices: [], scanning: false, busy: {}, err: {} };
  const SCAN_S = 12;
  const power_ = sw('Bluetooth', () => st.powered, async (v) => {
    try { await sysPost('bluetooth/power', { on: v }); st.powered = v; paint(); }
    catch (e) { toast(errText(e), { kind: 'error' }); }
  });
  const ring = h('span.dv-scan-ring', { html: '<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"/><circle class="p" cx="18" cy="18" r="15" pathLength="100"/></svg>' });
  const scanBtn = h('button.pill.small.primary.dv-scan', { type: 'button' }, ring, h('span', 'Scan for devices'));
  scanBtn.onclick = (e) => { stop(e); scan(); };
  const list = h('div.dv-list.dv-bt');
  function paint() {
    power_.paint();
    scanBtn.disabled = !st.powered || st.scanning;
    clear(list);
    if (!st.powered) { list.append(h('div.dv-empty', 'Bluetooth is off')); return; }
    const devs = [...st.devices].sort((a, b) => (b.connected - a.connected) || (b.paired - a.paired) || String(a.name || '').localeCompare(String(b.name || '')));
    if (!devs.length) { list.append(h('div.dv-empty', st.scanning ? 'Looking for devices…' : 'No devices yet — tap Scan, and put the device in pairing mode')); return; }
    for (const d of devs) {
      const busy = st.busy[d.mac], err = st.err[d.mac];
      const sub = busy || err || [d.connected ? 'Connected' : d.paired ? 'Paired' : 'Available', Number.isFinite(d.battery) ? `🔋 ${d.battery}%` : ''].filter(Boolean).join(' · ');
      const acts = h('div.dv-row-acts');
      if (busy) acts.append(h('span.spin.dv-spin'));
      else {
        if (!d.paired) acts.append(pill('Pair', () => act(d, 'pair'), 'primary'));
        else if (!d.connected) acts.append(pill('Connect', () => act(d, 'connect'), 'primary'));
        else acts.append(pill('Disconnect', () => act(d, 'disconnect')));
        if (d.paired) acts.append(pill('✕', (b) => armed(b, 'Remove?', () => act(d, 'remove')), 'danger dv-x'));
      }
      list.append(h(`div.row.dv-row${d.connected ? '.on' : ''}${err ? '.err' : ''}`,
        h('span.dv-row-ic.bt', { html: ic(BT_ICON(d)) }),
        h('div.row-text', h('div.row-title', { dir: 'auto' }, d.name || d.mac), h('div.row-sub', sub)),
        acts));
    }
  }
  const LABEL = { pair: 'Pairing…', connect: 'Connecting…', disconnect: 'Disconnecting…', remove: 'Removing…' };
  async function act(d, what) {
    st.busy[d.mac] = LABEL[what]; delete st.err[d.mac]; paint();
    try {
      const r = await sysPost(`bluetooth/${what}`, { mac: d.mac }, { timeout: 45000 });
      if (what === 'pair') { st.busy[d.mac] = LABEL.connect; paint(); await sysPost('bluetooth/connect', { mac: d.mac }, { timeout: 45000 }).catch(() => {}); }
      if (what === 'remove') st.devices = st.devices.filter((x) => x.mac !== d.mac);
      if (r?.devices) st.devices = r.devices;
      toast({ pair: `Paired with ${d.name || d.mac}`, connect: `Connected to ${d.name || d.mac}`, disconnect: 'Disconnected', remove: `Removed ${d.name || d.mac}` }[what]);
    } catch (e) { st.err[d.mac] = errText(e); }
    delete st.busy[d.mac];
    await load(false);
  }
  async function load(full = true) {
    try {
      const r = await sysGet('bluetooth');
      st.powered = !!r?.powered;
      const known = new Map(st.devices.map((d) => [d.mac, d]));
      for (const d of r?.devices || []) known.set(d.mac, { ...known.get(d.mac), ...d });
      st.devices = full ? (r?.devices || []) : [...known.values()];
    } catch (e) { clear(list); list.append(h('div.dv-err', errText(e))); return; }
    paint();
  }
  async function scan() {
    if (st.scanning) return;
    st.scanning = true; scanBtn.classList.add('run'); scanBtn.style.setProperty('--dur', `${SCAN_S}s`); scanBtn.lastChild.textContent = 'Scanning…'; paint();
    try {
      const r = await sysPost('bluetooth/scan', { seconds: SCAN_S }, { timeout: (SCAN_S + 20) * 1000 });
      const known = new Map(st.devices.map((d) => [d.mac, d]));
      for (const d of r?.devices || []) known.set(d.mac, { ...known.get(d.mac), ...d });
      st.devices = [...known.values()];
    } catch (e) { toast(errText(e), { kind: 'error' }); }
    st.scanning = false; scanBtn.classList.remove('run'); scanBtn.lastChild.textContent = 'Scan for devices'; paint();
  }
  paint();
  return { cap: 'bluetooth', nodes: [section('Bluetooth', 'bluetooth'), power_, h('div.center', scanBtn), list], load: () => load() };
}

// ================================================================= Sound
function soundSection(sub) {
  const st = { sinks: [], sources: [] };
  const outList = h('div.dv-list'), inList = h('div.dv-list');
  const outVol = h('div.dv-vol'), inVol = h('div.dv-vol');
  const meter = h('div.dv-meter', h('i'));
  const meterNote = h('div.opt-hint.dv-hide');
  let mic = null;
  const sendVol = throttle((id, volume, muted) => sysPost('audio/volume', { id, volume, ...(muted !== undefined ? { muted } : {}) }).catch((e) => toast(errText(e), { kind: 'error' })), 150);
  function devList(el, items, kind) {
    clear(el);
    if (!items.length) { el.append(h('div.dv-empty', kind === 'out' ? 'No speakers or outputs found' : 'No microphone found')); return; }
    for (const d of items) {
      el.append(h(`button.row.dv-row${d.default ? '.on' : ''}`, { type: 'button', onclick: async (e) => {
        stop(e); if (d.default) return;
        try { await sysPost('audio/default', { id: d.id }); items.forEach((x) => { x.default = x === d; }); paint(); toast(`${kind === 'out' ? 'Sound plays on' : 'Microphone:'} ${d.name}`); }
        catch (err) { toast(errText(err), { kind: 'error' }); }
      } },
      h('span.dv-row-ic', { html: icon(kind === 'out' ? (/head/i.test(d.name) ? 'speaker' : 'volume') : 'mic') }),
      h('div.row-text', h('div.row-title', { dir: 'auto' }, d.name || d.id), h('div.row-sub', [d.default ? 'Default' : 'Tap to use', d.muted ? 'muted' : `${Math.round((d.volume ?? 1) * 100)}%`].join(' · '))),
      d.default ? h('span.dv-tag', { html: icon('check') }) : null));
    }
  }
  function volRow(el, d, label) {
    clear(el);
    if (!d) return;
    const muteBtn = h(`button.ibtn.small.dv-mute${d.muted ? '.on' : ''}`, { type: 'button', 'aria-label': d.muted ? 'Unmute' : 'Mute', html: icon(d.muted ? 'mute' : (label === 'Microphone level' ? 'mic' : 'volume')) });
    const s = slider(label, () => Math.round((d.volume ?? 1) * 100), (v) => { d.volume = v / 100; sendVol(d.id, d.volume); }, { min: 0, max: 150, step: 1, fmt: (v) => `${v}%${v > 100 ? ' (boost)' : ''}` });
    muteBtn.onclick = (e) => { stop(e); d.muted = !d.muted; sendVol(d.id, d.volume ?? 1, d.muted); muteBtn.classList.toggle('on', d.muted); muteBtn.innerHTML = icon(d.muted ? 'mute' : 'volume'); };
    el.append(s, h('div.center', muteBtn));
  }
  function paint() {
    devList(outList, st.sinks, 'out'); devList(inList, st.sources, 'in');
    volRow(outVol, st.sinks.find((x) => x.default) || st.sinks[0], 'Volume');
    volRow(inVol, st.sources.find((x) => x.default) || st.sources[0], 'Microphone level');
  }
  async function load() {
    try { const r = await sysGet('audio'); st.sinks = r?.sinks || []; st.sources = (r?.sources || []).filter((s) => !/monitor/i.test(s.name || '')); paint(); }
    catch (e) { clear(outList); outList.append(h('div.dv-err', errText(e))); }
  }
  const testBtn = pill('Test sound', () => {
    try { const a = new Audio(new URL('../../sounds/alert-chime.wav', import.meta.url).href); a.volume = 1; a.play().catch(() => toast('Couldn’t play the test sound')); }
    catch { toast('Couldn’t play the test sound'); }
  });
  const micBtn = pill('Test microphone', () => (mic ? stopMic() : startMic()));
  async function startMic() {
    meterNote.classList.add('dv-hide');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('nomedia');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume?.().catch(() => {});
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      mic = { stream, ctx, raf: 0, until: Date.now() + 20000 };
      micBtn.textContent = 'Stop'; meter.classList.add('on');
      const loop = () => {
        if (!mic) return;
        if (!meter.isConnected || Date.now() > mic.until) { stopMic(); return; }
        an.getFloatTimeDomainData(buf);
        let s = 0; for (const v of buf) s += v * v;
        const db = 20 * Math.log10(Math.sqrt(s / buf.length) || 1e-6);   // -60 … 0 dB
        mic.lv = Math.max(clamp((db + 60) / 60, 0, 1), (mic.lv || 0) * 0.9);   // falls back smoothly
        meter.style.setProperty('--lv', `${(mic.lv * 100).toFixed(1)}%`);
        mic.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      meterNote.textContent = e?.message === 'nomedia' || location.protocol === 'http:' && !/^(localhost|127\.)/.test(location.hostname)
        ? 'This browser can’t use the microphone here (it needs https or the display itself).'
        : 'The microphone isn’t allowed in this browser. On the Pi, the kiosk starts Chromium with microphone access (pi/kiosk.sh).';
      meterNote.classList.remove('dv-hide');
    }
  }
  function stopMic() {
    if (!mic) return;
    cancelAnimationFrame(mic.raf);
    mic.stream.getTracks().forEach((t) => t.stop());
    mic.ctx.close().catch(() => {});
    mic = null; micBtn.textContent = 'Test microphone'; meter.classList.remove('on'); meter.style.setProperty('--lv', '0%');
  }
  sub(stopMic);
  return {
    cap: 'audio',
    nodes: [section('Sound', 'sound'), h('div.opt-label.dv-sub-head', 'Output'), outList, outVol, h('div.center', testBtn),
      h('div.opt-label.dv-sub-head', 'Microphone'), inList, inVol, meter, h('div.center', micBtn), meterNote],
    load: () => load(),
  };
}

// ================================================================= Battery & power
function batteryRing(b) {
  const p = clamp(Math.round(b.percent || 0), 0, 100);
  const col = b.charging ? 'var(--ok)' : p <= 15 ? 'var(--danger)' : p <= 30 ? 'var(--warn)' : 'var(--accent)';
  return h('div.dv-batt', { '--p': p, '--bc': col },
    h('span.dv-batt-ring', { html: `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42"/><circle class="p" cx="50" cy="50" r="42" pathLength="100"/></svg>` }),
    h('div.dv-batt-mid', h('b', `${p}%`), b.charging ? h('span.dv-bolt', { html: icon('bolt') }) : null));
}
function saverSection(ctx, sub) {
  const isPi = ctx.pi;
  const battBox = h('div.dv-batt-box');
  const statusEl = h('div.dv-status-line');
  const act = (k) => saverActions()[k];
  const setAct = (k, v) => store.set('saverActions', { ...saverActions(), [k]: v });
  const modeChips = chipRow(() => [{ id: 'off', name: 'Off' }, { id: 'on', name: 'On' }, { id: 'auto', name: `Auto at ${store.get('saverAt')}%` }], () => store.get('saverMode'), (v) => store.set('saverMode', v));
  const atRow = h('div.opt.dv-auto', h('div.opt-label', 'Turn on at'), h('div.stepper',
    h('button.ibtn.small', { type: 'button', 'aria-label': 'Lower', html: icon('minus'), onclick: (e) => { stop(e); store.set('saverAt', clamp((store.get('saverAt') || 20) - 5, 5, 50)); } }),
    h('span.step-val.dv-at'),
    h('button.ibtn.small', { type: 'button', 'aria-label': 'Higher', html: icon('plus'), onclick: (e) => { stop(e); store.set('saverAt', clamp((store.get('saverAt') || 20) + 5, 5, 50)); } })));
  const charging = sw('Turn off while charging', () => store.get('saverOffCharging') !== false, (v) => store.set('saverOffCharging', v));
  const acts = [
    sw('Reduce effects', () => act('lite'), (v) => setAct('lite', v), 'No blur or moving backgrounds, slower refresh'),
    sw('Dim the screen', () => act('dim'), (v) => setAct('dim', v), 'A dark layer — the panel’s brightness is set by its buttons'),
  ];
  const dim = slider('Dimming', () => Math.round((store.get('saverDim') ?? 0.4) * 100), (v) => store.set('saverDim', v / 100), { min: 10, max: 80, step: 5, fmt: (v) => `${v}%` });
  if (isPi) {
    acts.push(
      sw('CPU power saving', () => act('governor'), (v) => setAct('governor', v), 'The “powersave” CPU governor'),
      sw('Wi-Fi power saving', () => act('wifi'), (v) => setAct('wifi', v)),
      sw('Bluetooth off', () => act('bluetooth'), (v) => setAct('bluetooth', v), 'Back on when Battery saver ends'),
      sw('Screen off sooner', () => act('screen'), (v) => setAct('screen', v), 'After 2 minutes without a touch'));
  }
  const errEl = h('div.dv-err.dv-hide');
  function paint() {
    modeChips.paint();
    atRow.querySelector('.dv-at').textContent = `${store.get('saverAt')}%`;
    const auto = store.get('saverMode') === 'auto';
    atRow.classList.toggle('dv-hide', !auto); charging.classList.toggle('dv-hide', !auto); charging.paint();
    acts.forEach((a) => a.paint());
    dim.classList.toggle('dv-hide', !act('dim'));
    const b = batteryState();
    clear(battBox);
    if (b?.present) {
      const what = b.charging ? (b.percent >= 100 ? 'Charged' : 'Charging') : b.plugged ? 'Plugged in' : 'On battery';
      battBox.append(batteryRing(b), h('div.dv-batt-text', h('b', what), h('span', [Number.isFinite(b.minutesLeft) && !b.charging && b.minutesLeft > 0 ? `about ${fmtMins(b.minutesLeft)} left` : '', b.source && b.source !== 'browser' ? { pisugar: 'PiSugar', 'ups-hat': 'UPS HAT' }[b.source] || b.source : ''].filter(Boolean).join(' · '))));
    } else if (b && !b.present) battBox.append(h('div.dv-batt-text', h('b', 'No battery'), h('span', isPi ? 'Running from the power supply' : 'This device reports no battery')));
    else battBox.append(h('div.dv-batt-text', h('b', 'Battery'), h('span', batterySource() ? 'Reading…' : isPi ? 'No battery board found' : 'This browser doesn’t report the battery')));
    const on = !!store.get('batterySaver');
    statusEl.textContent = on ? (store.get('saverMode') === 'auto' ? 'Battery saver is on (battery low)' : 'Battery saver is on') : store.get('saverMode') === 'auto' ? `Off — turns on at ${store.get('saverAt')}%` : 'Battery saver is off';
    statusEl.classList.toggle('on', on);
    const er = lastPowerError(); errEl.textContent = er; errEl.classList.toggle('dv-hide', !er);
  }
  ['saverMode', 'saverAt', 'saverOffCharging', 'saverActions', 'batterySaver', 'saverDim'].forEach((k) => sub(store.on(`change:${k}`, paint)));
  sub(power.on('battery', paint)); sub(power.on('error', paint));
  paint();
  return {
    local: true,
    nodes: [section(isPi ? 'Battery & power' : 'Battery saver', 'battery'), battBox, opt('Battery saver', modeChips), statusEl, atRow, charging,
      h('div.opt-label.dv-sub-head', 'Battery saver does'), ...acts, dim, errEl],
    load: () => refreshBattery().then(paint),
  };
}

// ================================================================= Screen (Pi)
function screenSection(sub) {
  const mins = chipRow(() => [0, 1, 2, 5, 10, 30].map((m) => ({ id: m, name: m ? `${m} min` : 'Never' })), () => Number(store.get('screenOffMin')) || 0, (v) => store.set('screenOffMin', v));
  const night = () => ({ ...DEFAULTS.nightDim, ...(store.get('nightDim') || {}) });
  const setNight = (p) => store.set('nightDim', { ...night(), ...p });
  const nightSw = sw('Dim at night', () => night().on, (v) => setNight({ on: v }));
  const timeStep = (label, key) => {
    const val = h('span.step-val');
    const paint = () => { val.textContent = fmtClock(night()[key]); };
    const step = (d) => { setNight({ [key]: (((night()[key] + d) % 1440) + 1440) % 1440 }); paint(); };
    paint();
    return h('div.opt', h('div.opt-label', label), h('div.stepper',
      h('button.ibtn.small', { type: 'button', 'aria-label': `${label} earlier`, html: icon('minus'), onclick: (e) => { stop(e); step(-30); } }), val,
      h('button.ibtn.small', { type: 'button', 'aria-label': `${label} later`, html: icon('plus'), onclick: (e) => { stop(e); step(30); } })));
  };
  const from = timeStep('From', 'from'), to = timeStep('Until', 'to');
  const level = slider('Night dimming', () => Math.round(night().level * 100), (v) => setNight({ level: v / 100 }), { min: 10, max: 80, step: 5, fmt: (v) => `${v}%` });
  const paint = () => { mins.paint(); nightSw.paint(); [from, to, level].forEach((n) => n.classList.toggle('dv-hide', !night().on)); };
  sub(store.on('change:nightDim', paint)); sub(store.on('change:screenOffMin', paint));
  paint();
  // a DSI panel with a software backlight (caps.backlight): a real brightness slider; the round HDMI panel has buttons
  let bright = 1;
  const sendBright = throttle((v) => sysPost('screen', { brightness: v }).catch((e) => toast(errText(e), { kind: 'error' })), 200);
  const brightness = slider('Brightness', () => Math.round(bright * 100), (v) => { bright = v / 100; sendBright(bright); }, { min: 5, max: 100, step: 5, fmt: (v) => `${v}%` });
  brightness.classList.add('dv-hide');
  const panelHint = hint('This screen’s brightness is set with the buttons on the panel; “Dim at night” and Battery saver add a dark layer.');
  return {
    local: true, cap: 'display',
    nodes: [section('Screen', 'screen'), brightness, panelHint, opt('Screen off after', mins),
      hint('With no touch, key or knob turn for that long, the screen goes dark (music keeps playing). Touch it to wake it — that touch only wakes it. Alarms and timers wake it too. Battery saver can make it 2 minutes.'),
      h('div.center', pill('Turn off now', () => screenOff())), nightSw, from, to, level],
    load: async (info) => {
      if (!info?.caps?.backlight) return;
      try { const r = await sysGet('screen'); if (Number.isFinite(r?.brightness)) { bright = r.brightness; brightness.setValue(Math.round(bright * 100)); } } catch {}
      brightness.classList.remove('dv-hide'); panelHint.classList.add('dv-hide');
    },
  };
}

// ================================================================= Orientation
function orientationSection(ctx, sub) {
  const sources = () => ORIENT_SOURCES.filter((s) => s.id !== 'pi' || ctx.pi).map((s) => ({ ...s, name: s.id === 'motion' && ctx.pi ? 'Browser sensor' : s.name }));
  const modeChips = chipRow(() => ORIENT_MODES, () => store.get('orientMode'), (v) => store.set('orientMode', v));
  const srcChips = chipRow(sources, () => store.get('orientSource'), async (v) => {
    if (v === 'motion' && !(await requestMotionPermission())) { toast('Motion access wasn’t allowed', { kind: 'error' }); return; }
    store.set('orientSource', v);
  });
  // the dial: the arrow is the app's “up”, the notch on the rim is the display's own top edge
  const dial = h('div.dv-dial', h('b.dv-dial-frame', h('i.dv-dial-notch')), h('i.dv-dial-arrow'), h('span.dv-dial-deg'));
  const status = h('div.dv-status-line');
  const rot = (d, name, label) => h('button.ibtn.small.dv-rot', { type: 'button', 'aria-label': label, title: label, html: ic(name), onclick: (e) => { stop(e); rotateBy(d); } }, h('small', `${Math.abs(d)}°`));
  const btns = h('div.dv-rots', rot(-90, 'rotL', 'Turn left 90°'), rot(-45, 'rotL', 'Turn left 45°'), rot(45, 'rotR', 'Turn right 45°'), rot(90, 'rotR', 'Turn right 90°'));
  const upright = pill('Set current as upright', () => { const manual = store.get('orientSource') === 'manual'; if (calibrate()) toast(manual ? 'Upright again' : 'This way up is upright now'); else toast('No sensor reading yet'); });
  const axis = chipRow(() => [{ id: 'roll', name: 'Roll' }, { id: 'pitch', name: 'Pitch' }, { id: 'heading', name: 'Heading' }], () => store.get('orientAxis'), (v) => store.set('orientAxis', v));
  const axisOpt = opt('Sensor angle', axis);
  const reverse = sw('Reverse direction', () => !!store.get('orientReverse'), (v) => store.set('orientReverse', v));
  function paint(s = orientState()) {
    modeChips.paint(); srcChips.paint();
    const off = s.mode === 'off';
    dial.style.setProperty('--a', `${s.deg}deg`);
    dial.lastChild.textContent = `${Math.round(s.deg)}°`;
    dial.classList.toggle('off', off);
    const srcName = (sources().find((x) => x.id === s.source) || {}).name || s.source;
    status.textContent = off ? 'The screen doesn’t turn' : s.error ? s.error
      : s.source === 'manual' ? `Turned ${Math.round(s.deg)}° by hand`
        : s.live ? `${srcName}${chipName(s)}: ${s.sensor != null ? `${Math.round(s.sensor)}°` : '…'}${s.paused ? ' · waits for your finger' : ''}` : `${srcName}${chipName(s)}: waiting for the sensor…`;
    status.classList.toggle('warn', !!s.error && !off);
    axisOpt.classList.toggle('dv-hide', s.source !== 'pi');
    reverse.classList.toggle('dv-hide', s.source === 'manual'); reverse.paint();
    upright.textContent = s.source === 'manual' ? 'Back to upright' : 'Set current as upright';
  }
  const CHIPS = { mpu6050: 'MPU-6050', mpu6500: 'MPU-6500', mpu9250: 'MPU-9250', icm20948: 'ICM-20948', bno055: 'BNO055', lsm6ds3: 'LSM6DS3', lsm6dsl: 'LSM6DSL', lsm6dsox: 'LSM6DSOX' };
  function chipName(s) { const c = s.source === 'pi' && (s.chip || cachedInfo()?.caps?.imuChip); return c ? ` (${CHIPS[c] || c})` : ''; }
  let last = 0, t = 0;
  sub(orientation.on('change', (s) => { const n = performance.now(); clearTimeout(t); if (n - last > 120) { last = n; paint(s); } else t = setTimeout(() => paint(), 140); }));
  ['orientMode', 'orientSource', 'orientAxis', 'orientReverse'].forEach((k) => sub(store.on(`change:${k}`, () => paint())));
  paint();
  return {
    local: true,
    nodes: [section(ctx.pi ? 'Orientation' : 'Screen rotation', 'orientation'), opt('Turn the screen', modeChips), opt('Using', srcChips), h('div.dv-orient', dial, status), btns, h('div.center', upright), axisOpt, reverse,
      hint(ctx.pi ? 'With a motion sensor on the Pi (MPU-6050, ICM-20948, BNO055, LSM6DS3) the screen turns with the display. A turn waits until your finger is off the screen.'
        : 'On a phone or tablet the app can turn with the device (lock the phone’s own rotation first), or use the buttons. A turn waits until your finger is off the screen.')],
    load: () => {},
  };
}

// ================================================================= Updates
// GET /api/system/update → { available, version, commit, branch, current, dirty, running, latest?, behind?, error? }
// POST → { ok, updated, from, to, restarting, systemChanged } (or { ok:false, error })
function updatesSection() {
  const info = h('div.dv-card.dv-ver');
  const statusEl = h('div.dv-status-line');
  const bar = h('div.dv-progress.dv-hide', h('i'));
  const checkBtn = pill('Check for updates', () => check(), 'primary');
  const installBtn = pill('Install update', () => install(), 'primary dv-hide');
  const line = (k, v, cls = 'b') => h('div.dv-hs-line', h('span', k), h(cls, v));
  let upd = null, force = false;
  function noGit(u) {
    if (u?.available !== false) return false;
    checkBtn.classList.add('dv-hide');
    statusEl.textContent = 'Updates need the git install (pi/install.sh clones Round Remote from GitHub)';
    return true;
  }
  async function load() {
    const [v, sys] = await Promise.all([appVersion(), cachedInfo() || systemInfo()]);
    try { upd = await sysGet('update?fetch=0', { timeout: 8000 }); } catch { upd = null; }
    const thr = sys?.throttled && typeof sys.throttled === 'object' ? sys.throttled : null;
    clear(info);
    info.append(line('App', v || '—', 'b.dv-mono'),
      line('Bridge', String(upd?.version || upd?.current || '—').slice(0, 24), 'b.dv-mono'),
      upd?.commit ? line('Commit', `${upd.commit}${upd.branch && upd.branch !== 'main' ? ` (${upd.branch})` : ''}${upd.dirty ? ' · local changes' : ''}`, 'b.dv-mono') : '',
      sys?.model ? line('Device', sys.model) : '',
      sys?.os ? line('System', sys.os) : '',
      sys?.temp != null ? line('Temperature', `${Math.round(sys.temp)} °C`) : '',
      thr?.underVoltage || thr?.occurred?.underVoltage ? h('div.dv-hs-line.dv-warn', h('span', 'Power'), h('b', thr.underVoltage ? 'Too weak — use a 5 V 3 A supply' : 'Was too weak since start-up')) : '');
    noGit(upd);
  }
  async function check() {
    checkBtn.disabled = true; statusEl.textContent = 'Checking…'; installBtn.classList.add('dv-hide');
    try {
      const u = upd = await sysGet('update', { timeout: 40000 });
      const behind = Number(u?.behind) || 0;
      if (noGit(u)) { /* explained */ }
      else if (u?.error) statusEl.textContent = `Couldn’t check: ${u.error}`;
      else if (behind > 0 || (u?.latest && u.latest !== u.current)) {
        statusEl.textContent = (behind ? `${behind} update${behind > 1 ? 's' : ''} available` : `Version ${u.latest} available`) + (u.dirty ? ' · this Pi has local changes' : '');
        installBtn.classList.remove('dv-hide');
      } else statusEl.textContent = 'Up to date';
    } catch (e) { statusEl.textContent = errText(e); }
    checkBtn.disabled = false;
  }
  async function install() {
    installBtn.disabled = true; checkBtn.disabled = true; bar.classList.remove('dv-hide'); bar.classList.add('busy');
    statusEl.textContent = 'Downloading and installing…';
    const done = (msg) => { statusEl.textContent = msg; bar.classList.add('dv-hide'); bar.classList.remove('busy'); installBtn.disabled = false; checkBtn.disabled = false; };
    let r = null;
    try { r = await sysPost('update', force ? { force: true } : {}, { timeout: 240000 }); }
    catch (e) {
      // the bridge may restart before it answers — that's fine; a real error has a body
      if (e.body || e.status) {
        const msg = errText(e);
        // local edits on the Pi: offer to put them aside (git stash) and update anyway
        if (/local changes/i.test(msg) && !force) { force = true; installBtn.textContent = 'Install anyway'; done('This Pi has local changes — “Install anyway” keeps them aside (git stash)'); return; }
        done(msg); return;
      }
    }
    if (r && r.updated === false) { done('Already up to date'); installBtn.classList.add('dv-hide'); return; }
    const note = r?.systemChanged ? ' — system files changed: run “bash pi/install.sh” once' : '';
    if (!r || r.restarting) {
      statusEl.textContent = 'Waiting for the bridge to restart…' + note;
      const t0 = Date.now();
      await new Promise((ok) => setTimeout(ok, 3000));
      while (Date.now() - t0 < 180000) {
        try { await bridgeFetch('/api/info', { timeout: 3000 }); break; } catch { await new Promise((ok) => setTimeout(ok, 2000)); }
      }
    }
    statusEl.textContent = `Updated${r?.to ? ` to ${r.to}` : ''} — reloading${note}`;
    bar.classList.remove('busy'); bar.style.setProperty('--w', '100%');
    setTimeout(() => location.reload(), note ? 4000 : 800);
  }
  return { nodes: [section('Updates', 'updates'), info, h('div.center.dv-gap', checkBtn, installBtn), bar, statusEl], load };
}

// ================================================================= Restart / Shut down
function powerSection() {
  const bye = (msg) => {
    const el = h('div.dv-bye', h('div.spin'), h('div', msg));
    document.getElementById('app')?.append(el);
  };
  const run = async (what) => {
    const reboot = what === 'reboot';
    const ok = await confirmDialog({
      title: reboot ? 'Restart?' : 'Shut down?',
      text: reboot ? 'The display restarts and is back in about a minute.' : 'Wait for the green light on the Pi to stop before unplugging it. Plug it back in to start it again.',
      ok: reboot ? 'Restart' : 'Shut down', danger: !reboot,
    });
    if (!ok) return;
    try { await sysPost(what, {}); bye(reboot ? 'Restarting…' : 'Shutting down…'); }
    catch (e) { toast(errText(e), { kind: 'error', ms: 4000 }); }
  };
  return {
    nodes: [section('Restart / Shut down', 'restart'), h('div.center.dv-gap', pill('Restart', () => run('reboot')), pill('Shut down', () => run('shutdown'), 'danger'))],
    load: () => {},
  };
}

// ================================================================= the group
/**
 * Settings → Device. `header` is the group's header element, `jump` the row of jump chips.
 * Returns the list items; they stay hidden until the bridge says it runs on a Pi (or ?device=1).
 */
export function deviceGroup({ header, jump } = {}) {
  ensureCss();
  const anchor = h('div.dv-anchor');
  const sub = lifetime(anchor);
  const ctx = { pi: true };
  const forced = forcedDevice();
  const parts = [wifiSection(ctx), bluetoothSection(), soundSection(sub), saverSection(ctx, sub), screenSection(sub), orientationSection(ctx, sub), updatesSection(), powerSection()];
  const note = hint('Showing the device settings without a Pi (?device=1) — actions need the Round Remote bridge on a Raspberry Pi.');
  // another phone / computer that reaches the Pi's bridge: it may look, but only the round display changes things
  const remote = h('div.dv-remote', REMOTE_TEXT.replace(/^Changes/, 'You’re looking at the Pi from another device. Changes'));
  const nodes = [anchor, ...(forced ? [note] : []), remote, ...parts.flatMap((p) => p.nodes)];
  const chip = jump?.querySelector('[data-group="device"]');
  const show = (on) => {
    for (const n of [header, chip, ...nodes]) if (n) n.hidden = !on;
  };
  show(false);
  let loaded = false;
  systemInfo().then((info) => {
    const on = !!info.pi || forced;
    const local = forced || canWrite(info);
    show(on);
    remote.hidden = !on || local;
    // a part the Pi can't do (caps.<name> false) stays hidden; Battery saver, Screen and Orientation belong to this
    // screen — on another device they stay under General → Display (that device's own) instead
    for (const p of parts) {
      const keep = on && (!p.local || local) && (forced || !p.cap || info.caps?.[p.cap] !== false);
      if (!keep) p.nodes.forEach((n) => { n.hidden = true; });
    }
    document.querySelectorAll('.dv-display').forEach((n) => { n.hidden = on && local; });
    if (on && !loaded) { loaded = true; parts.forEach((p) => { if (!p.nodes[0].hidden) Promise.resolve(p.load?.(info)).catch(() => {}); }); }
  });
  return nodes;
}

/**
 * General → Display on phones, tablets and computers (no Pi): Screen rotation and Battery saver.
 * Hidden when the Device group is shown (the same settings live there on the Pi).
 */
export function displayExtras() {
  ensureCss();
  const anchor = h('div.dv-anchor');
  const sub = lifetime(anchor);
  const ctx = { pi: false };
  const parts = [orientationSection(ctx, sub), saverSection(ctx, sub)];
  const nodes = [anchor, ...parts.flatMap((p) => p.nodes)];
  nodes.forEach((n) => n.classList.add('dv-display'));
  const pi = (cachedInfo()?.pi && canWrite(cachedInfo())) || forcedDevice();
  nodes.forEach((n) => { n.hidden = !!pi; });
  parts.forEach((p) => Promise.resolve(p.load?.()).catch(() => {}));
  return nodes;
}
