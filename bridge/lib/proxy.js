// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The companion's proxy core: everything the round display asks of http://127.0.0.1:8765/ that isn't the device's
// own business goes on to a Round Remote SERVER (the Docker container on the NAS, or any other bridge), streamed
// both ways — the app's files, /api/*, phone pages, SSE streams, chunked downloads and WebSocket upgrades.
// Used by the light companion (bridge/companion.js) and by a full bridge switched to "Round Remote server"
// (lib/companion.js). The browser keeps talking to its own loopback origin (Spotify's redirect rule, localStorage).
//
//   const px = createProxy({ target: 'http://192.168.50.108:8765', device: 'roundremote-zero' })
//   px.forward(req, res, { onOffline })   px.upgrade(req, socket, head)   px.status()   px.on('change', fn)
//
// Health: GET <server>/api/info every 5 s (and right after a failed request) → online / offline + latency.
// Offline = two failed checks in a row (or the first one), or a refused / unreachable connection.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const DOWN_CODES = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'CONNECT_TIMEOUT']);

/** A server address the user typed → 'http://host:port' (default port 8765), or throws. */
export function normalizeServer(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter the server’s address');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try { u = new URL(s); } catch { throw new Error('That isn’t a valid address'); }
  if (!/^https?:$/.test(u.protocol) || !u.hostname) throw new Error('That isn’t a valid address');
  if (u.username || u.password) throw new Error('Addresses with a user name aren’t supported');
  if (!u.port && u.protocol === 'http:' && !/^\d+$/.test(String(input).trim().split(':').pop())) u.port = '8765';
  return `${u.protocol}//${u.host}`;
}

/** One GET <base>/api/info → { ok, latencyMs, info?, error?, code? } (never throws). */
export function probeServer(base, { timeout = 3000, agent, headers = {} } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL('/api/info', base); } catch { return resolve({ ok: false, error: 'bad address', code: 'EINVAL' }); }
    const t0 = Date.now();
    const mod = u.protocol === 'https:' ? https : http;
    let done = false;
    const fin = (r) => { if (!done) { done = true; clearTimeout(timer); resolve({ latencyMs: Date.now() - t0, ...r }); } };
    const rq = mod.request(u, { method: 'GET', agent, headers: { Accept: 'application/json', 'Cache-Control': 'no-store', ...headers } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 200000) body += c; });
      res.on('end', () => {
        let info = null;
        try { info = JSON.parse(body); } catch {}
        if (res.statusCode !== 200 || info?.app !== 'roundremote-bridge') return fin({ ok: false, status: res.statusCode, error: res.statusCode === 200 ? 'Not a Round Remote server' : `The server answered ${res.statusCode}`, code: 'NOT_RR' });
        fin({ ok: true, info });
      });
      res.on('error', (e) => fin({ ok: false, error: e.message, code: e.code }));
    });
    const timer = setTimeout(() => { rq.destroy(Object.assign(new Error('No answer in time'), { code: 'ETIMEDOUT' })); }, timeout);
    rq.on('error', (e) => fin({ ok: false, error: friendly(e), code: e.code || 'ERR' }));
    rq.end();
  });
}
function friendly(e) {
  return ({ ECONNREFUSED: 'Nothing answers on that port', EHOSTUNREACH: 'The server can’t be reached', ENETUNREACH: 'No network', ETIMEDOUT: 'No answer in time',
    ENOTFOUND: 'Unknown host name', EAI_AGAIN: 'Unknown host name', ECONNRESET: 'The connection was reset', EHOSTDOWN: 'The server is down' })[e.code] || e.message;
}

export function createProxy({ target = '', device = '', log = () => {}, interval = 5000, timeout = 3000, connectTimeout = 4000, grace = 0 } = {}) {
  // grace: right after start (the Pi just booted, Wi-Fi still joining) a server that doesn't answer is "checking", not "offline"
  const startedAt = Date.now();
  const ev = new EventEmitter();
  const S = {
    target: '', online: null, latencyMs: null, lastOk: 0, lastCheck: 0, lastError: '', since: Date.now(), fails: 0,
    serverInfo: null, nextAt: 0, checking: null, timer: null, stopped: false,
  };
  let agent = null;

  function setTarget(t) {
    const next = t ? normalizeServer(t) : '';
    if (next === S.target && agent) return;
    agent?.destroy();
    S.target = next;
    agent = next ? new (next.startsWith('https:') ? https : http).Agent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: 32, maxFreeSockets: 4, timeout: 60000 }) : null;
    Object.assign(S, { online: null, latencyMs: null, lastOk: 0, lastError: '', fails: 0, serverInfo: null, since: Date.now() });
    clearTimeout(S.timer);
    if (next && !S.stopped) check();
    emit();
  }
  function status() {
    return {
      server: S.target, online: S.online === true, state: S.online == null ? 'checking' : S.online ? 'online' : 'offline',
      latencyMs: S.latencyMs, lastOk: S.lastOk || null, lastCheck: S.lastCheck || null, lastError: S.lastError || '',
      since: S.since, nextCheckMs: S.nextAt ? Math.max(0, S.nextAt - Date.now()) : null, intervalMs: interval,
      serverVersion: S.serverInfo?.version || null, serverRole: S.serverInfo?.role || null, serverName: S.serverInfo?.name || S.serverInfo?.hostname || null,
      device,
    };
  }
  let emitT = 0;
  function emit() { clearTimeout(emitT); emitT = setTimeout(() => ev.emit('change', status()), 0); }

  function schedule(ms = interval) {
    clearTimeout(S.timer);
    if (S.stopped || !S.target) { S.nextAt = 0; return; }
    S.nextAt = Date.now() + ms;
    S.timer = setTimeout(check, ms);
    S.timer.unref?.();
  }
  /** Check the server now (shared while one is running). */
  function check() {
    if (!S.target) return Promise.resolve(status());
    if (S.checking) return S.checking;
    const target = S.target;
    S.checking = probeServer(target, { timeout, agent, headers: { 'X-RR-Companion': device } }).then((r) => {
      S.checking = null;
      if (target !== S.target) return status();
      S.lastCheck = Date.now();
      const was = S.online;
      if (r.ok) {
        S.fails = 0; S.online = true; S.latencyMs = r.latencyMs; S.lastOk = Date.now(); S.lastError = ''; S.serverInfo = r.info;
      } else {
        S.fails++; S.lastError = r.error || 'failed';
        if (S.online == null && !S.lastOk && Date.now() - startedAt < grace) { schedule(2000); emit(); return status(); }
        if (S.online !== false && (S.fails >= 2 || S.online == null || DOWN_CODES.has(r.code))) S.online = false;
      }
      if (was !== S.online) { S.since = Date.now(); log('companion', `server ${S.target} ${S.online ? `online (${S.latencyMs} ms)` : `offline: ${S.lastError}`}`); }
      schedule();
      emit();
      return status();
    });
    return S.checking;
  }
  // a failed request: the server may just have gone — check soon, but not in a storm
  let kickT = 0;
  function kick() { if (kickT) return; kickT = setTimeout(() => { kickT = 0; check(); }, 300); kickT.unref?.(); }

  function outHeaders(req, u) {
    const h = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) h[k] = v;
    const fromHost = req.headers.host || '';
    h.host = u.host;
    // a same-origin request to the companion is a same-origin request to the server (its originAllowed accepts it)
    if (h.origin && sameHostOrigin(h.origin, fromHost)) h.origin = `${u.protocol}//${u.host}`;
    if (h.referer && sameHostOrigin(h.referer, fromHost)) { try { const r = new URL(h.referer); h.referer = `${u.protocol}//${u.host}${r.pathname}${r.search}`; } catch {} }
    const ip = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    h['x-forwarded-for'] = h['x-forwarded-for'] ? `${h['x-forwarded-for']}, ${ip}` : ip;
    h['x-forwarded-proto'] = req.socket?.encrypted ? 'https' : 'http';
    h['x-forwarded-host'] = fromHost;
    h['x-rr-companion'] = device || 'companion';
    return h;
  }

  /**
   * Forward one HTTP request. onOffline(req, res, err) answers when the server can't be reached
   * (and nothing was sent yet). Returns nothing; the response is always finished.
   */
  function forward(req, res, { onOffline, onResponse } = {}) {
    if (!S.target) return onOffline(req, res, new Error('no server set'));
    if (S.online === false) { kick(); return onOffline(req, res, new Error(S.lastError || 'server offline')); }
    const bodyless = req.method === 'GET' || req.method === 'HEAD';
    const u = new URL(S.target);
    const mod = u.protocol === 'https:' ? https : http;
    const headers = outHeaders(req, u);
    const origOrigin = req.headers.origin;
    let current = null;
    // the browser went away (SSE closed, navigation): close the upstream request too
    res.on('close', () => { if (!res.writableFinished) current?.destroy(); });
    const attempt = (retry) => {
      let answered = false, connected = false, reused = false;
      const up = mod.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), method: req.method, path: req.url, headers, agent }, (pr) => {
        answered = true;
        clearTimeout(ct);
        const h = {};
        for (const [k, v] of Object.entries(pr.headers)) if (!HOP.has(k)) h[k] = v;
        // CORS: the server answered the (rewritten) origin — give the browser back its own
        if (origOrigin && h['access-control-allow-origin'] && h['access-control-allow-origin'] !== '*') h['access-control-allow-origin'] = origOrigin;
        if (h.location) h.location = stripOrigin(h.location, u);
        h['x-rr-via'] = 'companion';
        if (onResponse && onResponse(pr, res, h)) return;   // a caller that rewrites the body (/api/info)
        res.writeHead(pr.statusCode || 502, pr.statusMessage, h);
        if (/text\/event-stream/i.test(String(h['content-type'] || ''))) { res.flushHeaders?.(); req.socket?.setNoDelay?.(true); }   // SSE: nothing held back
        pr.pipe(res);
        pr.on('error', () => res.destroy());
      });
      current = up;
      // connecting: give up after a few seconds (the server is gone); once connected, long answers are fine
      const ct = setTimeout(() => { if (!connected) up.destroy(Object.assign(new Error('connect timeout'), { code: 'CONNECT_TIMEOUT' })); }, connectTimeout);
      up.on('socket', (s) => {
        reused = !s.connecting && !!up.reusedSocket;
        if (!s.connecting) { connected = true; clearTimeout(ct); return; }
        s.once('connect', () => { connected = true; clearTimeout(ct); });
      });
      up.on('error', (e) => {
        clearTimeout(ct);
        if (answered || res.headersSent) { res.destroy(); return; }
        if (res.destroyed) return;
        // a kept-alive socket the server had already closed: try once more on a fresh one
        if (reused && bodyless && !retry && (e.code === 'ECONNRESET' || e.code === 'EPIPE')) return attempt(true);
        if (DOWN_CODES.has(e.code)) kick();
        if (!connected) { S.lastError = friendly(e); return onOffline(req, res, e); }
        res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-RR-Via': 'companion' });
        res.end(JSON.stringify({ error: `server: ${friendly(e)}` }));
      });
      if (bodyless) up.end(); else { req.pipe(up); req.on('error', () => up.destroy()); }
    };
    attempt(false);
  }

  /** Forward a WebSocket (or any) upgrade: a raw TCP tunnel after the rewritten request head. */
  function upgrade(req, socket, head) {
    if (!S.target || S.online === false) { socket.end('HTTP/1.1 502 Bad Gateway\r\nX-RR-Offline: 1\r\nConnection: close\r\n\r\n'); return; }
    const u = new URL(S.target);
    const port = +(u.port || (u.protocol === 'https:' ? 443 : 80));
    const h = outHeaders(req, u);
    h.connection = 'Upgrade';
    h.upgrade = req.headers.upgrade;
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(h).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]))];
    const up = u.protocol === 'https:' ? tls.connect({ host: u.hostname, port, servername: u.hostname }) : net.connect({ host: u.hostname, port });
    const ct = setTimeout(() => up.destroy(), connectTimeout);
    up.once(u.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
      clearTimeout(ct);
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket); socket.pipe(up);
    });
    up.on('error', () => { clearTimeout(ct); kick(); socket.destroy(); });
    socket.on('error', () => up.destroy());
    up.on('close', () => socket.destroy());
    socket.on('close', () => up.destroy());
  }

  function stop() { S.stopped = true; clearTimeout(S.timer); clearTimeout(kickT); agent?.destroy(); S.nextAt = 0; }
  function start() { if (!S.stopped) return; S.stopped = false; if (S.target) check(); }

  if (target) setTarget(target);
  return {
    forward, upgrade, check, status, setTarget, stop, start,
    get target() { return S.target; }, get online() { return S.online; },
    on: (n, fn) => { ev.on(n, fn); return () => ev.off(n, fn); },
  };
}

function sameHostOrigin(origin, host) {
  try { return new URL(origin).host === host; } catch { return false; }
}
function stripOrigin(loc, u) {
  try { const l = new URL(loc, `${u.protocol}//${u.host}`); if (l.host === u.host) return `${l.pathname}${l.search}${l.hash}`; } catch {}
  return loc;
}
