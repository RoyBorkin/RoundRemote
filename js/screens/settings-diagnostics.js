// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Settings → Profiles & about → Diagnostics: the bridge's report (GET /api/diag, bridge/lib/diag.js) in short — role,
// versions, data folder, adapters, network discovery, the servers this display uses — plus a QR code to the full page
// (/diag, with a Copy button) for a phone or computer, and the "new version" notice of a server in Docker.
// Works for every bridge role (standalone Pi/PC, server, companion); without a bridge it says so.
import { h, clear } from '../ui/dom.js';
import { toast } from '../ui/overlay.js';
import { store } from '../core/store.js';
import { qrSvg } from '../../apps/qr.js';
import { bridgeBase, bridgeFetch, mayProbe } from '../providers/bridge.js';
import { provider } from '../providers/registry.js';
import { registerSettings } from './settings-registry.js';

const CSS = `
.dg{display:flex;flex-direction:column;gap:2.2cqmin;padding-bottom:4cqmin}
.dg-card{background:var(--glass);border:1px solid var(--line);border-radius:3cqmin;padding:2.4cqmin 3cqmin}
.dg-line{display:flex;justify-content:space-between;gap:3cqmin;font-size:3.1cqmin;padding:.55cqmin 0;color:var(--fg)}
.dg-line>span{color:var(--muted);flex:none}
.dg-line>b{font-weight:500;text-align:end;overflow-wrap:anywhere;min-width:0}
.dg-ok{color:var(--accent)}
.dg-bad{color:#f87171}
.dg-warn{color:#f59e0b}
.dg-qr{display:flex;align-items:center;gap:3cqmin;justify-content:center}
.dg-qr-box{width:30cqmin;height:30cqmin;background:#fff;border-radius:2cqmin;padding:1cqmin;flex:none}
.dg-qr-box svg{width:100%;height:100%;display:block}
.dg-qr-t{font-size:3cqmin;color:var(--muted);max-width:34cqmin;overflow-wrap:anywhere}
.dg-qr-t b{color:var(--fg);display:block;font-size:3.3cqmin;margin-bottom:.8cqmin}
.dg-note{font-size:3.1cqmin;line-height:1.35;border-radius:3cqmin;padding:2.4cqmin 3cqmin;background:color-mix(in srgb,var(--accent) 16%,transparent);border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);color:var(--fg)}
.dg-wait{display:flex;align-items:center;gap:2cqmin;justify-content:center;color:var(--muted);font-size:3.2cqmin;padding:4cqmin 0}
.dg-acts{display:flex;gap:2cqmin;justify-content:center;flex-wrap:wrap}
`;
function ensureCss() {
  if (document.getElementById('diag-css')) return;
  document.head.append(h('style#diag-css', CSS));
}

/** The servers this display talks to (only scheme://host:port leaves the display — never tokens). */
function probes() {
  const out = [];
  const add = (name, url) => { try { const u = new URL(String(url || '').trim()); if (/^https?:$/.test(u.protocol)) out.push(`${name}|${u.protocol}//${u.host}/`); } catch {} };
  add('Jellyfin', store.get('jellyfinServer'));
  add('Home Assistant', store.get('haUrl'));
  try { add('Plex', provider('plex')?.server?.uri); } catch {}
  return out;
}

const mb = (n) => (n == null ? '—' : n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);
const dur = (s) => { s = +s || 0; const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return `${d ? `${d}d ` : ''}${hh ? `${hh}h ` : ''}${m}m`; };
const ROLE = { standalone: 'Standalone', server: 'Server (Docker)', companion: 'Companion (Pi → server)' };

/** The page: summary of the report + QR to /diag. */
export function buildDiagnostics(el, ctx) {
  ensureCss();
  const root = h('div.dg');
  el.append(root);
  let report = null, base = '', alive = true;
  ctx?.onClose?.(() => { alive = false; });

  const line = (k, v, cls = '') => h('div.dg-line', h('span', k), h(`b${cls ? '.' + cls : ''}`, v == null || v === '' ? '—' : String(v)));
  const card = (...kids) => h('div.dg-card', ...kids.filter(Boolean));

  async function load(fresh = false) {
    clear(root).append(h('div.dg-wait', h('div.spin'), 'Checking the bridge and the network… (up to 15 s)'));
    if (!mayProbe()) return paintNoBridge();
    base = await bridgeBase().catch(() => '');
    if (!base) return paintNoBridge();
    try {
      const q = new URLSearchParams();
      if (fresh) q.set('fresh', '1');
      for (const p of probes()) q.append('probe', p);
      report = await bridgeFetch(`/api/diag?${q}`, { timeout: 25000 });
    } catch (e) {
      report = null;
      if (!alive) return;
      clear(root).append(card(h('div.dg-line', h('span', 'Diagnostics'), h('b.dg-bad', e?.status === 404 ? 'This bridge is older — update it' : (e?.message || 'The bridge didn’t answer')))),
        h('div.dg-acts', h('button.pill.small', { type: 'button', onclick: (ev) => { ev.stopPropagation(); load(true); } }, 'Try again')));
      return;
    }
    if (alive) paint();
  }

  function paintNoBridge() {
    clear(root).append(card(line('Bridge', 'Not found', 'dg-bad')),
      h('div.opt-hint', 'Diagnostics come from the Round Remote bridge (on the Raspberry Pi, a computer, or the server in Docker). Set it under Settings → Connection → Bridge.'));
  }

  function qrUrl() {
    const n = report?.network || {};
    const pub = report?.config?.publicUrl || n.publicUrl;
    if (pub) return `${String(pub).replace(/\/$/, '')}/diag`;
    try {
      const u = new URL(base);
      if (!/^(localhost|127\.|\[::1\])/.test(u.hostname)) return `${u.origin}/diag`;
      if (n.phoneAddress) return `http://${n.phoneAddress}:${u.port || report?.config?.port || 8765}/diag`;
      return `${u.origin}/diag`;
    } catch { return ''; }
  }

  function paint() {
    const r = report, b = r.basics || {}, up = r.update || {};
    const ad = Object.entries(r.adapters?.list || {});
    const problems = ad.filter(([, a]) => a.enabled !== false && a.error && !/disabled/.test(a.status));
    const running = ad.filter(([, a]) => a.loaded);
    const md = r.mdns || {}, sd = r.ssdp || {};
    const url = qrUrl();
    const qr = h('div.dg-qr-box');
    try { qr.innerHTML = qrSvg(url, { margin: 1, dark: '#111', light: '#fff' }); } catch {}
    clear(root).append(...[
      up.updateAvailable ? h('div.dg-note', h('b', `A new version is available (${up.latest}). `), 'Update the container: Portainer → Stacks → roundremote → Pull and redeploy (Re-pull image), or TOS Container/Docker Manager → pull ghcr.io/royborkin/roundremote:latest again and rebuild the project. Your data stays.') : null,
      card(
        line('Role', ROLE[b.role] || b.role),
        line('Bridge', `${b.bridge || '?'} · app ${b.app || '?'}`),
        line('Host', `${b.hostname || '?'}${b.container ? ' (container)' : ''}`),
        line('System', `${b.os || ''} · ${b.arch || ''} · Node ${String(b.node || '').replace(/^v/, '')}`),
        line('Up', `${dur(b.uptime?.systemSec)} · bridge ${dur(b.uptime?.bridgeSec)}`),
        line('Memory', `${mb(b.memory?.freeMb)} free of ${mb(b.memory?.totalMb)}`),
        line('Data folder', `${b.paths?.data || '?'}${b.paths?.dataWritable === false ? ' — NOT writable' : ''}`, b.paths?.dataWritable === false ? 'dg-bad' : ''),
        line('Free space', b.disk ? `${mb(b.disk.freeMb)} of ${mb(b.disk.totalMb)}` : '—', b.disk && b.disk.freeMb < 500 ? 'dg-warn' : ''),
        up.mode === 'docker' ? line('Updates', up.updateAvailable ? `${up.latest} available` : up.latest ? 'Up to date' : (up.error ? `Couldn’t check (${up.error})` : 'Not checked'), up.updateAvailable ? 'dg-warn' : '') : null,
      ),
      card(
        line('Adapters', `${running.length} running${problems.length ? ` · ${problems.length} with problems` : ''}`, problems.length ? 'dg-warn' : 'dg-ok'),
        ...problems.slice(0, 6).map(([id, a]) => line(id, a.error, 'dg-warn')),
        line('Players found', String(r.adapters?.zonesTotal ?? 0)),
        line('mDNS', md.error ? md.error : md.multicast?.bound ? `listening · ${md.multicast.heard || 0} heard · ${md.googleTvs || 0} Google TV · ${md.castDevices || 0} Cast` : `not bound${md.multicast?.error ? ` (${md.multicast.error})` : ''}`, md.error || !md.multicast?.bound ? 'dg-bad' : md.multicast?.heard ? 'dg-ok' : 'dg-warn'),
        line('UPnP / SSDP', sd.error ? sd.error : `${sd.responders || 0} devices · ${sd.renderers || 0} players`, sd.error ? 'dg-bad' : ''),
        line('Roon', r.roon?.status || '—'),
        line('Address for phones', r.network?.publicUrl || r.network?.phoneAddress || '—'),
      ),
      (r.reachability?.checks || []).length ? card(...r.reachability.checks.map((c) => line(c.name, c.ok ? `reachable · ${c.ms} ms` : c.ok === null ? c.error : `${c.error || `HTTP ${c.status}`}`, c.ok ? 'dg-ok' : c.ok === null ? '' : 'dg-bad'))) : null,
      r.system?.pi ? card(
        line('Device', r.system.model),
        line('Wi-Fi', r.system.wifi?.ssid ? `${r.system.wifi.ssid} · ${r.system.wifi.signal ?? '?'}%` : r.system.wifi?.error || 'not connected'),
        line('Bluetooth', r.system.bluetooth?.powered ? `on · ${r.system.bluetooth.devices} devices` : r.system.bluetooth?.error || 'off'),
        line('Sound outputs', r.system.audio?.sinks ?? '—'),
        line('Kiosk', r.system.services?.['roundremote-kiosk'] || '—'),
        line('Local changes', r.system.git?.dirtyFiles?.length ? `${r.system.git.dirtyFiles.length} files` : 'none', r.system.git?.dirtyFiles?.length ? 'dg-warn' : ''),
        r.system.lastUpdate ? line('Last update', `${new Date(r.system.lastUpdate.at).toLocaleString()} · ${r.system.lastUpdate.ok ? (r.system.lastUpdate.updated ? 'updated' : 'up to date') : r.system.lastUpdate.error}`) : null,
      ) : null,
      url ? card(h('div.dg-qr', qr, h('div.dg-qr-t', h('b', 'Full report'), 'Scan for the whole report with a Copy button, or open', h('br'), url))) : null,
      h('div.dg-acts',
        h('button.pill.small', { type: 'button', onclick: (e) => { e.stopPropagation(); load(true); } }, 'Run again'),
        h('button.pill.small', { type: 'button', onclick: async (e) => {
          e.stopPropagation();
          try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); toast('Report copied'); }
          catch { toast('Copy isn’t available here — use the QR code', { kind: 'error' }); }
        } }, 'Copy report')),
      h('div.opt-hint', `Collected in ${(r.tookMs / 1000).toFixed(1)} s. The report never contains passwords or tokens — services show only whether they are set up.`),
    ].filter(Boolean));
  }
  load(false);
}

registerSettings({
  group: 'profiles', id: 'diagnostics', title: 'Diagnostics', icon: 'about', order: 90,
  summary: 'Check the bridge, network and services', keywords: 'diagnostics debug report problem troubleshoot network mdns docker server version log',
  build: buildDiagnostics,
});
