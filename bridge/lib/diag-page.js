// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// GET /diag — the diagnostics report (/api/diag) as a readable page with a Copy button. Self-contained (no CDNs).
export const DIAG_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Round Remote · Diagnostics</title>
<style>
:root{--bg:#0e1013;--card:#171a1f;--line:#262b33;--fg:#e9edf2;--muted:#9aa4b2;--ok:#34d399;--warn:#fbbf24;--bad:#f87171;--accent:#60a5fa;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f4f6f9;--card:#fff;--line:#e3e7ee;--fg:#141820;--muted:#5d6878;--ok:#059669;--warn:#b45309;--bad:#dc2626;--accent:#2563eb;color-scheme:light}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px 16px 48px}
main{max-width:980px;margin:0 auto}
h1{font-size:22px;margin:4px 0 2px}
.sub{color:var(--muted);font-size:13px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:999px;padding:8px 16px;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button:disabled{opacity:.6}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}
.chip{border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:13px;background:var(--card)}
.chip.ok{border-color:color-mix(in srgb,var(--ok) 50%,transparent);color:var(--ok)}
.chip.warn{border-color:color-mix(in srgb,var(--warn) 50%,transparent);color:var(--warn)}
.chip.bad{border-color:color-mix(in srgb,var(--bad) 50%,transparent);color:var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;min-width:0}
section h2{font-size:15px;margin:0 0 8px;display:flex;justify-content:space-between;gap:8px}
section h2 small{color:var(--muted);font-weight:400}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{padding:4px 6px;border-top:1px solid var(--line);vertical-align:top;text-align:left;overflow-wrap:anywhere}
th{color:var(--muted);font-weight:500;width:38%}
tr:first-child td,tr:first-child th{border-top:0}
.t{color:var(--ok)}.f{color:var(--muted)}.e{color:var(--bad)}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:0;max-height:420px;overflow:auto}
details>summary{cursor:pointer;color:var(--muted);font-size:13px}
.wide{grid-column:1/-1}
.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:s 0.8s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes s{to{transform:rotate(360deg)}}
#toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--fg);color:var(--bg);padding:8px 14px;border-radius:999px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none}
#toast.on{opacity:1}
</style></head><body><main>
<h1>Round Remote · Diagnostics</h1>
<div class="sub" id="sub">Collecting… (takes up to 15 seconds)</div>
<div class="bar"><button class="primary" id="copy" disabled>Copy report</button><button id="again">Run again</button><a class="sub" href="/api/diag" id="raw">raw JSON</a></div>
<div class="chips" id="chips"></div>
<div class="grid" id="out"><section class="wide"><span class="spin"></span>Checking the bridge, the network and the services…</section></div>
<div id="toast"></div>
</main>
<script>
const $ = (s) => document.querySelector(s);
let data = null;
function el(tag, attrs, ...kids) { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') e.className = v; else e.setAttribute(k, v); } for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k)); return e; }
function val(v) {
  if (v === true) return el('span', { class: 't' }, 'yes');
  if (v === false) return el('span', { class: 'f' }, 'no');
  if (v == null || v === '') return el('span', { class: 'f' }, '—');
  if (Array.isArray(v)) {
    if (!v.length) return el('span', { class: 'f' }, 'none');
    if (v.every((x) => x == null || typeof x !== 'object')) return v.join(', ');
    return table(Object.fromEntries(v.map((x, i) => [x.name || x.ip || x.target || String(i + 1), x])));
  }
  if (typeof v === 'object') return table(v);
  return String(v);
}
function table(o) {
  const t = el('table');
  for (const [k, v] of Object.entries(o || {})) {
    if (k === 'ms') continue;
    if (/At$/.test(k) && typeof v === 'number') v = new Date(v).toLocaleString();
    const cell = el('td', {}, val(v));
    if (k === 'error' && v) cell.className = 'e';
    t.append(el('tr', {}, el('th', {}, k), cell));
  }
  return t;
}
const mb = (n) => n == null ? '—' : n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : n + ' MB';
const dur = (s) => { s = +s || 0; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm'; };
function card(title, body, { wide = false, ms } = {}) { return el('section', { class: wide ? 'wide' : '' }, el('h2', {}, title, ms != null ? el('small', {}, ms + ' ms') : ''), body); }
function chip(text, kind) { return el('span', { class: 'chip ' + (kind || '') }, text); }
function render(d) {
  data = d;
  const b = d.basics || {}, out = $('#out'), chips = $('#chips');
  out.textContent = ''; chips.textContent = '';
  $('#sub').textContent = (b.hostname || '') + ' · ' + (b.role || '') + ' · bridge ' + (b.bridge || '?') + ' · app ' + (b.app || '?') + ' · ' + new Date(d.generatedAt).toLocaleString() + ' · took ' + d.tookMs + ' ms';
  chips.append(chip('Role: ' + (b.role || '?'), 'ok'), chip(b.container ? 'Container' : (d.system?.pi ? 'Raspberry Pi' : (b.platform || ''))));
  chips.append(chip('Data ' + (b.paths?.dataWritable ? 'writable' : 'NOT writable'), b.paths?.dataWritable ? 'ok' : 'bad'));
  if (b.disk) chips.append(chip('Free ' + mb(b.disk.freeMb), b.disk.freeMb < 500 ? 'warn' : 'ok'));
  const md = d.mdns || {};
  chips.append(chip('mDNS ' + (md.error ? 'error' : md.multicast?.bound ? 'bound · heard ' + (md.multicast.heard || 0) : 'not bound'), md.error || !md.multicast?.bound ? 'bad' : md.multicast.heard ? 'ok' : 'warn'));
  chips.append(chip('SSDP ' + (d.ssdp?.error ? 'error' : (d.ssdp?.responders ?? 0) + ' devices'), d.ssdp?.error ? 'bad' : d.ssdp?.responders ? 'ok' : 'warn'));
  const errs = Object.entries(d.adapters?.list || {}).filter(([, a]) => a.error);
  chips.append(chip(errs.length ? errs.length + ' adapter problem' + (errs.length > 1 ? 's' : '') : 'Adapters OK', errs.length ? 'warn' : 'ok'));
  if (d.update?.updateAvailable) chips.append(chip('Update available: ' + d.update.latest, 'warn'));
  const ad = el('table', {}, el('tr', {}, el('th', {}, 'adapter'), el('th', {}, 'status'), el('th', {}, 'zones')));
  for (const [id, a] of Object.entries(d.adapters?.list || {})) ad.append(el('tr', {}, el('td', {}, id), el('td', { class: a.error ? 'e' : a.enabled ? '' : 'f' }, a.status + (a.signedIn != null ? ' · signed in: ' + (a.signedIn ? 'yes' : 'no') : '') + (a.paired != null ? ' · paired: ' + a.paired : '')), el('td', {}, String(a.zones || 0))));
  const nt = el('table', {}, el('tr', {}, el('th', {}, 'interface'), el('th', {}, 'address'), el('th', {}, 'kind')));
  for (const i of d.network?.interfaces || []) nt.append(el('tr', {}, el('td', {}, i.name), el('td', {}, i.cidr || i.address), el('td', { class: i.virtual ? 'f' : '' }, i.virtual ? 'virtual' : i.linkLocal ? 'link-local' : i.private ? 'LAN' : 'public')));
  out.append(
    card('This bridge', table({ role: b.role, bridge: b.bridge, app: b.app, node: b.node, os: b.os, arch: b.arch, hostname: b.hostname, container: b.container, user: b.user, uptime: dur(b.uptime?.systemSec) + ' (bridge ' + dur(b.uptime?.bridgeSec) + ')', memory: mb(b.memory?.freeMb) + ' free of ' + mb(b.memory?.totalMb) + ' · bridge ' + mb(b.memory?.bridgeRssMb), data: b.paths?.data, 'data free': b.disk ? mb(b.disk.freeMb) + ' of ' + mb(b.disk.totalMb) : '—', config: b.paths?.config + (b.paths?.configExists ? '' : ' (missing — defaults)'), timezone: b.tz }), { ms: b.ms }),
    card('Configured', val({ ...(d.config?.services || {}), publicUrl: d.config?.publicUrl, 'LAN origins allowed': d.config?.lanOrigins, 'state files': d.config?.stateFiles, profiles: d.config?.profiles }), { ms: d.config?.ms }),
    card('Adapters', ad, { wide: true, ms: d.adapters?.ms }),
    card('Network', el('div', {}, nt, table({ 'address for phones': d.network?.phoneAddress, publicUrl: d.network?.publicUrl, error: d.network?.error })), { ms: d.network?.ms }),
    card('mDNS (Google TV / Cast search)', val(d.mdns), { ms: d.mdns?.ms }),
    card('SSDP / UPnP', val(d.ssdp), { ms: d.ssdp?.ms }),
    card('Cast · Roon', val({ cast: d.cast, roon: d.roon }), {}),
    card('Reachability', d.reachability?.checks?.length ? val(d.reachability.checks) : val(d.reachability?.error ? { error: d.reachability.error } : 'No servers to check (the Settings page adds Plex, Jellyfin and Home Assistant)'), { ms: d.reachability?.ms }),
    card(d.system?.pi ? 'Raspberry Pi' : 'System', val(d.system), { wide: !!d.system?.pi, ms: d.system?.ms }),
    card('Updates', val(d.update), { ms: d.update?.ms }),
    card('Recent log (secrets masked)', el('pre', {}, (d.log || []).join('\\n') || '—'), { wide: true }),
  );
  $('#copy').disabled = false;
}
async function load(fresh) {
  $('#copy').disabled = true; $('#again').disabled = true;
  if (data) $('#sub').textContent = 'Collecting again…';
  try {
    const q = location.search.slice(1);
    const r = await fetch('/api/diag?' + (fresh ? 'fresh=1&' : '') + q, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    render(d);
  } catch (e) { $('#out').textContent = ''; $('#out').append(card('Couldn’t collect the report', String(e.message || e), { wide: true })); }
  $('#again').disabled = false;
}
function toast(t) { const x = $('#toast'); x.textContent = t; x.classList.add('on'); setTimeout(() => x.classList.remove('on'), 1800); }
$('#copy').onclick = async () => {
  const text = JSON.stringify(data, null, 2);
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { const ta = el('textarea'); ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand('copy'); toast('Copied'); } catch { toast('Select and copy the raw JSON'); } ta.remove(); }
};
$('#again').onclick = () => load(true);
load(false);
</script></body></html>`;
