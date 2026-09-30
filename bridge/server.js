#!/usr/bin/env node
// Round Remote bridge — runs on the Pi (or any always-on machine on your LAN).
//  • serves the app itself at http://<host>:8765/  (so the Pi needs no internet for the UI)
//  • exposes Roon / UPnP / AirPlay (shairport-sync) / Google Cast zones over HTTP + SSE
//  • LAN proxy so an https page (GitHub Pages) can reach http-only Plex/Jellyfin servers
//  • optional Apple Music developer-token signer
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Hub } from './lib/hub.js';
import { isPrivateHost, log } from './lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const VERSION = '2.0.0';

// ---------------------------------------------------------------- config
const DEFAULTS = {
  port: 8765,
  host: '0.0.0.0',
  allowedOrigins: ['https://royborkin.github.io'],
  // AirPlay needs shairport-sync (Linux/Pi); mpris = Linux media players (playerctl); winmedia = Windows media sessions
  adapters: { roon: true, upnp: true, cast: true, youtubetv: true, androidtv: true, appletv: true, googlehome: true, cider: true, mpris: process.platform === 'linux', winmedia: process.platform === 'win32', airplay: process.platform === 'linux', mock: false },
  airplay: { metadataPipe: '/tmp/shairport-sync-metadata', bus: 'system', name: 'Round Display' },
  upnp: { pollMs: 2000, searchEverySec: 60 },
  apple: { teamId: '', keyId: '', privateKeyPath: '' },
  cider: { host: '127.0.0.1', port: 10767, token: '' },
  mpris: { playerctl: 'playerctl' },
  winmedia: { powershell: 'powershell.exe' },
  app: {},  // defaults pushed into the app: spotifyClientId, jellyfinServer, appleDeveloperToken, ...
};
function loadConfig() {
  const file = process.env.RR_CONFIG || path.join(__dirname, 'config.json');
  let user = {};
  if (fs.existsSync(file)) {
    try { user = JSON.parse(fs.readFileSync(file, 'utf8')); log('bridge', `config: ${file}`); }
    catch (e) { log('bridge', `config.json is not valid JSON: ${e.message}`); }
  }
  const cfg = { ...DEFAULTS, ...user };
  for (const k of ['adapters', 'airplay', 'upnp', 'apple', 'cider', 'mpris', 'winmedia', 'androidtv', 'appletv', 'googlehome', 'app']) cfg[k] = { ...DEFAULTS[k], ...(user[k] || {}) };
  if (process.env.PORT) cfg.port = +process.env.PORT;
  if (process.env.RR_MOCK) cfg.adapters.mock = true;
  return cfg;
}
const cfg = loadConfig();

// ---------------------------------------------------------------- adapters
const hub = new Hub();
const ADAPTERS = {
  roon: () => import('./adapters/roon.js'),
  upnp: () => import('./adapters/upnp.js'),
  cast: () => import('./adapters/cast.js'),
  airplay: () => import('./adapters/airplay.js'),
  youtubetv: () => import('./adapters/youtubetv.js'),
  androidtv: () => import('./adapters/androidtv.js'),
  appletv: () => import('./adapters/appletv.js'),
  googlehome: () => import('./adapters/googlehome.js'),
  cider: () => import('./adapters/cider.js'),
  mpris: () => import('./adapters/mpris.js'),
  winmedia: () => import('./adapters/winmedia.js'),
  mock: () => import('./adapters/mock.js'),
};
const adapterState = {};
for (const [id, load] of Object.entries(ADAPTERS)) {
  adapterState[id] = { id, enabled: false, status: cfg.adapters[id] ? 'starting' : 'disabled in config' };
  if (!cfg.adapters[id]) continue;
  load().then(async (mod) => {
    const a = mod.create({ hub, cfg, setStatus: (s, enabled = true) => { adapterState[id] = { id, enabled, status: s }; } });
    hub.addAdapter(a);
    await a.start();
    if (adapterState[id].status === 'starting') adapterState[id] = { id, enabled: true, status: 'running' };
    log(id, adapterState[id].status);
  }).catch((e) => {
    adapterState[id] = { id, enabled: false, status: e.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find/.test(e.message) ? 'not installed (see README)' : `error: ${e.message}` };
    log(id, adapterState[id].status);
  });
}

// ---------------------------------------------------------------- apple token
let appleToken = null;
function appleDeveloperToken() {
  const { teamId, keyId, privateKeyPath } = cfg.apple;
  if (!teamId || !keyId || !privateKeyPath) return null;
  const now = Math.floor(Date.now() / 1000);
  if (appleToken && appleToken.exp - now > 86400) return appleToken.token;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = now + 60 * 60 * 24 * 150; // Apple allows up to ~6 months
  const unsigned = `${b64({ alg: 'ES256', kid: keyId })}.${b64({ iss: teamId, iat: now, exp })}`;
  const key = fs.readFileSync(path.resolve(__dirname, privateKeyPath), 'utf8');
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  appleToken = { token: `${unsigned}.${sig}`, exp };
  return appleToken.token;
}

// ---------------------------------------------------------------- http helpers
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8',
};

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return true;
  try {
    const u = new URL(origin);
    if (u.host === req.headers.host) return true;
    if (isPrivateHost(u.hostname)) return true;
    return cfg.allowedOrigins.some((o) => o === '*' || o.replace(/\/$/, '') === origin);
  } catch { return false; }
}
function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
}
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function readBody(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) { const b = await readBody(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; }

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(APP_ROOT, '.' + rel);
  const relToRoot = path.relative(APP_ROOT, file);
  // Never serve the bridge itself (config.json, keys) or dotfiles.
  if (relToRoot.startsWith('..') || relToRoot.split(path.sep).some((p) => p.startsWith('.')) || relToRoot.startsWith('bridge') || relToRoot.startsWith('pi')) {
    res.writeHead(404); return res.end('Not found');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------------------------------------------------------- SSE
const clients = new Set();
function sse(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
hub.on('zone', (z) => { for (const c of clients) sse(c, 'zone', z); });
hub.on('zones', (list) => { for (const c of clients) sse(c, 'zones', list); });
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20000);

// ---------------------------------------------------------------- routes
async function api(req, res, url) {
  const p = url.pathname;
  const m = p.match(/^\/api\/zones\/([^/]+)(?:\/(\w+))?$/);

  if (p === '/api/info') {
    return json(res, 200, { app: 'roundremote-bridge', version: VERSION, adapters: adapterState, zones: hub.zones.size, config: cfg.app });
  }
  if (p === '/api/zones') return json(res, 200, hub.list());
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    sse(res, 'zones', hub.list());
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (m) {
    const zoneId = decodeURIComponent(m[1]);
    const zone = hub.get(zoneId);
    const adapter = hub.adapterFor(zoneId);
    if (!zone || !adapter) return json(res, 404, { error: 'zone not found' });
    const action = m[2];
    if (action === 'command' && req.method === 'POST') {
      const { cmd, value } = await readJson(req);
      await adapter.command(zone.localId, cmd, value);
      return json(res, 200, { ok: true });
    }
    if (action === 'playlists') return json(res, 200, adapter.playlists ? await adapter.playlists(zone.localId) : []);
    if (action === 'search') return json(res, 200, adapter.search ? await adapter.search(zone.localId, url.searchParams.get('q') || '') : []);
    if (action === 'play' && req.method === 'POST') {
      const { item } = await readJson(req);
      if (!adapter.play) return json(res, 400, { error: 'not supported' });
      await adapter.play(zone.localId, item);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'unknown action' });
  }
  // Adapter-specific actions, e.g. POST /api/adapters/youtubetv/pair {code}
  const act = p.match(/^\/api\/adapters\/(\w+)\/(\w+)$/);
  if (act) {
    const a = hub.adapters.get(act[1]);
    const fn = a?.actions?.[act[2]];
    if (!fn) return json(res, 404, { error: 'unknown adapter action' });
    try {
      const out = await fn(req.method === 'POST' ? await readJson(req) : Object.fromEntries(url.searchParams), { req, base: `http://${req.headers.host}` });
      // actions can also answer with a redirect or a small page (OAuth sign-in in a browser tab)
      if (out?.__redirect) { res.writeHead(302, { Location: out.__redirect }); return res.end(); }
      if (out?.__html) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(out.__html); }
      return json(res, 200, out);
    } catch (e) {
      if (req.method === 'GET' && /text\/html/.test(req.headers.accept || '')) { res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(`<p style="font:16px sans-serif">${String(e.message).replace(/</g, '&lt;')}</p>`); }
      return json(res, 400, { error: e.message });
    }
  }
  const img = p.match(/^\/api\/image\/(\w+)\/(.+)$/);
  if (img) {
    const a = hub.adapters.get(img[1]);
    if (!a?.image) { res.writeHead(404); return res.end(); }
    const r = await a.image(decodeURIComponent(img[2]));
    if (!r) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': r.contentType || 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
    return res.end(r.body);
  }
  if (p === '/api/apple/token') {
    try {
      const token = cfg.app.appleDeveloperToken || appleDeveloperToken();
      return token ? json(res, 200, { token }) : json(res, 404, { error: 'apple key not configured' });
    } catch (e) { return json(res, 500, { error: e.message }); }
  }
  if (p === '/api/proxy') return proxy(req, res, url);
  if (p === '/api/profiles' || p.startsWith('/api/profiles/')) return profiles(req, res, decodeURIComponent(p.slice('/api/profiles/'.length)));
  return json(res, 404, { error: 'not found' });
}

// Settings profiles: save a device's settings here and load them on another round display.
// Stored as bridge/profiles/<name>.json. GET /api/profiles (list) · GET|PUT|DELETE /api/profiles/<name>
const PROFILES = path.join(__dirname, 'profiles');
const profileFile = (name) => path.join(PROFILES, `${String(name).trim().replace(/[^\p{L}\p{N} _.-]/gu, '_').slice(0, 60) || 'profile'}.json`);
async function profiles(req, res, name) {
  try {
    if (!name) {
      if (!fs.existsSync(PROFILES)) return json(res, 200, []);
      const list = fs.readdirSync(PROFILES).filter((f) => f.endsWith('.json')).map((f) => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(PROFILES, f), 'utf8'));
          return { name: d.name || f.slice(0, -5), savedAt: d.savedAt || null, from: d.device || '', signIns: !!d.auth };
        } catch { return null; }
      }).filter(Boolean).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
      return json(res, 200, list);
    }
    const file = profileFile(name);
    if (req.method === 'GET') return fs.existsSync(file) ? json(res, 200, JSON.parse(fs.readFileSync(file, 'utf8'))) : json(res, 404, { error: 'no such profile' });
    if (req.method === 'DELETE') { if (fs.existsSync(file)) fs.unlinkSync(file); return json(res, 200, { ok: true }); }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readJson(req);
      if (body?.app !== 'round-remote' || typeof body.settings !== 'object') return json(res, 400, { error: 'not a Round Remote profile' });
      fs.mkdirSync(PROFILES, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ ...body, name }, null, 2));
      log('bridge', `saved settings profile "${name}"`);
      return json(res, 200, { ok: true, name });
    }
    return json(res, 405, { error: 'method not allowed' });
  } catch (e) { return json(res, 500, { error: e.message }); }
}

// LAN-only reverse proxy (for Jellyfin/Plex over plain http when the app runs on https).
async function proxy(req, res, url) {
  let target;
  try { target = new URL(url.searchParams.get('url')); } catch { return json(res, 400, { error: 'bad url' }); }
  if (!/^https?:$/.test(target.protocol) || !isPrivateHost(target.hostname)) return json(res, 403, { error: 'only local-network targets are allowed' });
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (/^(authorization|accept|content-type|x-emby-.*|x-plex-.*|x-mediabrowser-.*|range)$/i.test(k)) headers[k] = v;
  }
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req, 20e6);
  try {
    const r = await fetch(target, { method: req.method, headers, body, redirect: 'follow' });
    const out = { 'Cache-Control': r.headers.get('cache-control') || 'no-store' };
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers.get(h)) out[h] = r.headers.get(h);
    res.writeHead(r.status, out);
    if (r.body) { for await (const chunk of r.body) res.write(chunk); }
    res.end();
  } catch (e) { json(res, 502, { error: e.message }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!originAllowed(req)) return json(res, 403, { error: `origin ${req.headers.origin} not allowed — add it to allowedOrigins in bridge/config.json` });
    try { await api(req, res, url); }
    catch (e) { log('api', p(url), e.message); if (!res.headersSent) json(res, 500, { error: e.message }); else res.end(); }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, url.pathname);
});
const p = (u) => u.pathname;

server.listen(cfg.port, cfg.host, () => {
  log('bridge', `Round Remote bridge ${VERSION} on http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}/`);
});

const shutdown = () => { for (const a of hub.adapters.values()) try { a.stop?.(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => log('bridge', 'unhandled', e?.message || e));
