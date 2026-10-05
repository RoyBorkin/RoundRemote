// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// A Raspberry Pi as a COMPANION of a Round Remote server (the Docker container on the NAS, or any other bridge).
// The round display keeps opening http://127.0.0.1:8765/; everything that isn't this device's own business is
// passed on to the server (lib/proxy.js). Two kinds:
//   light — bridge/companion.js (pi/install.sh --mode=companion): only this proxy + the Pi system API, for a Pi Zero 2 W
//   full  — the normal bridge (server.js) with Settings → Connection → Server → "Round Remote server" switched on;
//           "Use this Pi's own bridge" switches back at once (no restart)
// Never proxied: /api/system/* and /system/* (Wi-Fi, Bluetooth, sound… of THIS device), /api/companion/* and
// /companion/* (this file), /api/diag + /diag (this device's own diagnostics, with the server's summary nested as
// "server"), and the "Server offline" page served whenever the server can't be reached.
//
//   GET  /api/companion/status      { available, mode, enabled, server, online, state, latencyMs, lastOk, lastError, since,
//                                     nextCheckMs, serverVersion, serverRole, device, version, canUseLocal, writable }
//   GET  /api/companion/events      SSE: the same object whenever it changes
//   GET  /api/companion/discover    { servers:[{ name, url, address, port, role, version, self }] }   (mDNS, ~2.5 s)
//   POST /api/companion/test        { server } → { ok, url, latencyMs, version, role, error? }
//   POST /api/companion/connect     { server, force? } → status   (force: save it even while it doesn't answer)
//   POST /api/companion/disconnect  → status (full only: back to this Pi's own bridge)
//   POST /api/companion/retry       → status (check the server now)
//   GET  /companion/offline         the round "Server offline" page (?embed=1 inside the app's overlay)
// Changes (POST) only from the display itself (loopback), unless config.system.allowRemote is true.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProxy, normalizeServer, probeServer } from './proxy.js';
import { offlinePage } from './companion-page.js';
import { APP_ROOT, ROLE, dataPath } from './paths.js';

const LOCAL = /^\/(?:api\/)?(?:system|companion|diag)(?:\/|$)/;   // this device's own: system API, companion, diagnostics
const bare = (a) => String(a || '').replace(/^::ffff:/, '');
const isLoopback = (req) => { const a = bare(req.socket.remoteAddress); return a === '::1' || a.startsWith('127.'); };

export function createCompanion({ cfg, mode = 'full', version = '', log = () => {}, onSwitch = () => {} }) {
  const available = mode === 'light' || ROLE !== 'server';   // a server never proxies to another server
  const file = dataPath('companion.json');   // RR_DATA_DIR (default: the bridge folder; git-ignored)
  const appRoot = APP_ROOT;
  const device = (cfg.companion?.name || os.hostname() || 'round-remote').slice(0, 63);
  let conf = { server: '', enabled: false };
  try { conf = { ...conf, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  // the light companion's first start: the address given to pi/install.sh (--server=…) or RR_SERVER
  if (!conf.server && (process.env.RR_SERVER || cfg.companion?.server)) {
    try { conf.server = normalizeServer(process.env.RR_SERVER || cfg.companion.server); conf.enabled = true; } catch {}
  }
  if (mode === 'light') conf.enabled = !!conf.server;
  if (!available) conf.enabled = false;
  const save = () => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ server: conf.server, enabled: conf.enabled }, null, 2)); } catch (e) { log('companion', `can't save ${file}: ${e.message}`); } };

  const proxy = createProxy({ device, log, interval: +(cfg.companion?.checkEverySec || 5) * 1000, grace: process.uptime() < 60 ? 25000 : 0 });
  const clients = new Set();
  const proxying = () => available && conf.enabled && !!conf.server;
  let logo = '';
  try { logo = fs.readFileSync(path.join(appRoot, 'logo', 'logo-white.svg'), 'utf8'); } catch {}

  function status(req) {
    const s = proxy.status();
    return {
      available, mode, enabled: proxying(), ...s, server: conf.server || '', state: proxying() ? s.state : (mode === 'light' ? 'unset' : 'local'),
      online: proxying() ? s.online : false, version, canUseLocal: mode === 'full', device,
      ...(req ? { writable: isLoopback(req) || cfg.system?.allowRemote === true } : {}),
    };
  }
  const broadcast = () => { const d = `data: ${JSON.stringify(status())}\n\n`; for (const c of clients) c.write(d); };
  proxy.on('change', broadcast);
  if (proxying()) { proxy.setTarget(conf.server); log('companion', `${mode} companion of ${conf.server} (device "${device}")`); }
  else if (mode === 'light') log('companion', 'no server set yet — the round screen asks for its address');

  async function connect({ server, force = false } = {}) {
    if (!available) return { ok: false, status: 409, error: 'This is a Round Remote server — it doesn’t connect to another one' };
    let url;
    try { url = normalizeServer(server); } catch (e) { return { ok: false, status: 400, error: e.message }; }
    if (isSelf(url)) return { ok: false, status: 400, error: 'That’s this device itself' };
    const t = await probeServer(url, { timeout: 4000 });
    if (t.ok && t.info?.role === 'companion') return { ok: false, status: 400, error: 'That’s another companion, not a server' };
    if (!t.ok && !force) return { ok: false, status: 502, code: t.code, error: t.error || 'The server didn’t answer' };
    const was = proxying();
    conf = { server: url, enabled: true };
    save();
    proxy.setTarget(url);
    if (t.ok) await proxy.check();   // answer with a known state (online)
    log('companion', `connected to ${url}${t.ok ? '' : ' (not answering yet)'}`);
    if (!was) onSwitch(true);
    broadcast();
    return { ok: true, ...status() };
  }
  function disconnect() {
    if (mode !== 'full') return { ok: false, status: 400, error: 'This light companion has no bridge of its own — install the full version to use one' };
    const was = proxying();
    conf = { ...conf, enabled: false };
    save();
    proxy.setTarget('');
    log('companion', 'back to this Pi’s own bridge');
    if (was) onSwitch(false);
    broadcast();
    return { ok: true, ...status() };
  }
  function isSelf(url) {
    try {
      const u = new URL(url);
      const port = +(u.port || 80);
      if (port !== +cfg.port) return false;
      const h = u.hostname.replace(/^\[|\]$/g, '');
      if (/^(localhost|127\.|::1$|0\.0\.0\.0$)/.test(h) || h.toLowerCase() === os.hostname().toLowerCase() || h.toLowerCase() === `${os.hostname().toLowerCase()}.local`) return true;
      return Object.values(os.networkInterfaces()).flat().some((a) => a?.address === h);
    } catch { return false; }
  }

  let discovering = null;
  async function api(req, res, url, { json, readJson }) {
    const sub = url.pathname.replace(/\/+$/, '').slice('/api/companion'.length).replace(/^\//, '');
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    if (write && !(isLoopback(req) || cfg.system?.allowRemote === true)) return json(res, 403, { error: 'Only allowed on the display itself (set system.allowRemote in the bridge config to change this)' });
    const body = write ? await readJson(req).catch(() => ({})) : {};
    const send = (r) => { const { status: st, ...rest } = r; return json(res, st || (r.ok === false ? 400 : 200), rest); };
    switch (sub) {
      case '': case 'status': return json(res, 200, status(req));
      case 'events': {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`retry: 2000\n\ndata: ${JSON.stringify(status(req))}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      case 'discover': {
        discovering ||= import('./discovery.js').then((m) => m.discover({ timeout: Math.min(6000, +(url.searchParams.get('ms') || 2500)) })).finally(() => { setTimeout(() => { discovering = null; }, 3000); });
        const servers = (await discovering.catch(() => [])).map((x) => ({ ...x, self: x.self && x.port === +cfg.port }));   // this very bridge
        return json(res, 200, { servers });
      }
      case 'test': {
        if (!write) break;
        let u;
        try { u = normalizeServer(body.server); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
        if (isSelf(u)) return json(res, 200, { ok: false, url: u, error: 'That’s this device itself' });
        const t = await probeServer(u, { timeout: 4000 });
        if (t.ok && t.info?.role === 'companion') return json(res, 200, { ok: false, url: u, error: 'That’s another companion, not a server' });
        return json(res, 200, { ok: t.ok, url: u, latencyMs: t.latencyMs, version: t.info?.version || null, role: t.info?.role || null, error: t.ok ? undefined : t.error, code: t.code });
      }
      case 'connect': if (write) return send(await connect(body)); break;
      case 'disconnect': if (write) return send(disconnect()); break;
      case 'retry': if (write) { if (proxying()) await proxy.check(); return json(res, 200, { ok: true, ...status(req) }); } break;
      default: return json(res, 404, { error: 'unknown companion endpoint' });
    }
    return json(res, 405, { error: 'method not allowed' });
  }

  // ---------------------------------------------------------------- answers while the server can't be reached
  function localInfo() {
    return { app: 'roundremote-bridge', role: 'companion', version, companion: status(), adapters: {}, zones: 0, config: {} };
  }
  const isNavigation = (req) => req.headers['sec-fetch-mode'] === 'navigate' || ((req.method === 'GET' || req.method === 'HEAD') && /text\/html/.test(req.headers.accept || '') && !/^\/api\//.test(req.url));
  function offline(req, res) {
    const p = req.url.split('?')[0];
    const head = { 'Cache-Control': 'no-store', 'X-RR-Offline': '1', 'X-RR-Via': 'companion' };
    if (p === '/api/info') { res.writeHead(200, { 'Content-Type': 'application/json', ...head }); return res.end(JSON.stringify(localInfo())); }
    if (isNavigation(req)) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', ...head, 'Retry-After': '5' });
      return res.end(req.method === 'HEAD' ? undefined : page({ embed: false }));
    }
    res.writeHead(502, { 'Content-Type': 'application/json', ...head, 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Expose-Headers': 'X-RR-Offline' });
    res.end(JSON.stringify({ error: conf.server ? 'The Round Remote server is offline' : 'No Round Remote server set', offline: true, server: conf.server || '' }));
  }
  const page = ({ embed }) => offlinePage({ logo, embed, mode, status: status() });

  // the server's /api/info, plus who is in between (role: 'companion')
  function augmentInfo(pr, res, h) {
    if (pr.statusCode !== 200 || !/json/.test(String(h['content-type'] || ''))) return false;
    const chunks = [];
    let n = 0;
    pr.on('data', (c) => { n += c.length; if (n < 2e6) chunks.push(c); });
    pr.on('end', () => {
      let info = null;
      try { info = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
      const out = info && typeof info === 'object' ? JSON.stringify({ ...info, role: 'companion', server: { role: info.role || 'standalone', version: info.version || '' }, companion: status() }) : Buffer.concat(chunks);
      delete h['content-length'];
      res.writeHead(200, { ...h, 'Content-Length': Buffer.byteLength(out), 'Cache-Control': 'no-store' });
      res.end(out);
    });
    pr.on('error', () => res.destroy());
    return true;
  }

  // ---------------------------------------------------------------- diagnostics: this device's report + the server's summary
  async function serverDiag() {
    if (!conf.server) return null;
    try {
      const r = await fetch(new URL('/api/diag', conf.server), { signal: AbortSignal.timeout(9000), headers: { 'X-RR-Companion': device } });
      if (!r.ok) return { error: `HTTP ${r.status}` };
      const d = await r.json();
      const ad = d.adapters?.list || {};
      return { url: conf.server, generatedAt: d.generatedAt, basics: d.basics, update: d.update, zones: d.adapters?.zonesTotal ?? null,
        adapters: Object.fromEntries(Object.entries(ad).map(([k, v]) => [k, v.error ? `error: ${v.error}` : v.enabled ? 'running' : 'off'])) };
    } catch (e) { return { url: conf.server, error: e.name === 'TimeoutError' ? 'no answer in time' : e.message }; }
  }
  async function diag(req, res, url, helpers) {
    const m = await import('./diag.js');
    const own = (r, code, data) => helpers.json(r, code, data);
    const json = async (r, code, data) => {
      if (code !== 200 || !data || data.app !== 'roundremote-diag') return own(r, code, data);
      return own(r, code, { ...data, companion: status(), server: await serverDiag() });
    };
    return m.route(req, res, url, { cfg, ...helpers, json });
  }

  /** Handles the request when it belongs here (→ true); otherwise the caller goes on (→ false). */
  async function handle(req, res, url, helpers) {
    const p = url.pathname;
    if (p === '/api/companion' || p.startsWith('/api/companion/')) {
      helpers.cors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
      if (!helpers.originAllowed(req)) { helpers.json(res, 403, { error: `origin ${req.headers.origin} not allowed` }); return true; }
      try { await api(req, res, url, helpers); } catch (e) { if (!res.headersSent) helpers.json(res, 500, { error: e.message }); else res.end(); }
      return true;
    }
    if (p === '/companion' || p.startsWith('/companion/')) {
      if (p === '/companion' || p === '/companion/' || p === '/companion/offline') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(page({ embed: url.searchParams.get('embed') === '1' }));
      } else { res.writeHead(404); res.end('Not found'); }
      return true;
    }
    if ((p === '/api/diag' || p === '/diag') && (mode === 'light' || proxying())) { await diag(req, res, url, helpers); return true; }
    if (LOCAL.test(p)) return false;            // this device's own system API + Wi-Fi page (and, not proxying, diagnostics)
    if (mode === 'light' && !conf.server) { offline(req, res); return true; }
    if (!proxying()) return false;
    proxy.forward(req, res, { onOffline: offline, onResponse: p === '/api/info' ? augmentInfo : undefined });
    return true;
  }
  function upgrade(req, socket, head) {
    if (LOCAL.test(String(req.url).split('?')[0]) || !proxying()) return false;
    proxy.upgrade(req, socket, head);
    return true;
  }
  return { handle, upgrade, proxying, status, connect, disconnect, proxy, stop: () => proxy.stop() };
}
