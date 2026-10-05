#!/usr/bin/env node
// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Round Remote LIGHT COMPANION — for a Raspberry Pi Zero 2 W (or any Pi) whose round display uses a Round Remote
// SERVER elsewhere (the Docker container on the NAS). Installed by `pi/install.sh --mode=companion --server=URL`
// as roundremote-companion.service, instead of the full bridge. On http://127.0.0.1:8765/ (and the LAN, for the
// setup hotspot's Wi-Fi page) it serves:
//   • /api/system/*, /system/*   this Pi's own Wi-Fi, Bluetooth, sound, battery, screen, updates (lib/system.js)
//   • /api/companion/*, /companion/*   the server connection and the round "Server offline" page (lib/companion.js)
//   • everything else            passed on to the server, streamed (lib/proxy.js) — the app, its APIs, phone pages, SSE
// No media adapters, no npm packages: it starts in well under a second and stays small (see README → Pi Zero 2 W).
//   RR_SERVER=http://192.168.50.108:8765 node companion.js     (later the address lives in companion.json)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPrivateHost, log } from './lib/util.js';
import { createCompanion } from './lib/companion.js';
import { CONFIG_FILE, DATA_DIR, bridgeVersion } from './lib/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = bridgeVersion();

// the same config.json as the bridge (port, host, allowedOrigins, system: {…}); everything else is the server's
function loadConfig() {
  const file = CONFIG_FILE;
  let user = {};
  try { if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { log('companion', `config.json is not valid JSON: ${e.message}`); }
  const cfg = { port: 8765, host: '0.0.0.0', allowedOrigins: ['https://royborkin.github.io'], ...user, system: { ...(user.system || {}) }, companion: { ...(user.companion || {}) } };
  if (process.env.PORT) cfg.port = +process.env.PORT;
  return cfg;
}
const cfg = loadConfig();
const arg = process.argv.find((a) => a.startsWith('--server='));
if (arg) process.env.RR_SERVER = arg.slice('--server='.length);

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return true;
  try {
    const u = new URL(origin);
    if (u.host === req.headers.host || isPrivateHost(u.hostname)) return true;
    return (cfg.allowedOrigins || []).some((o) => o === '*' || o.replace(/\/$/, '') === origin);
  } catch { return false; }
}
function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
function readJson(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { const b = Buffer.concat(chunks); try { resolve(b.length ? JSON.parse(b.toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const helpers = { cfg, cors, json, readJson, originAllowed, dir: DATA_DIR, version: VERSION, adapterState: {} };   // diagnostics: no adapters here

const companion = createCompanion({ cfg, mode: 'light', version: VERSION, log });
let system = null;   // lib/system.js, loaded at the first /api/system request (or right away on a Pi: the captive portal)
const loadSystem = () => (system ||= import('./lib/system.js'));

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { res.writeHead(400); return res.end(); }
  try {
    if (await companion.handle(req, res, url, helpers)) return;
    if (/^\/(?:api\/)?system(?:\/|$)/.test(url.pathname)) return (await loadSystem()).route(req, res, url, helpers);
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    log('companion', `${req.method} ${url.pathname}: ${e.message}`);
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.end();
  }
});
server.on('upgrade', (req, socket, head) => { if (!companion.upgrade(req, socket, head)) socket.destroy(); });
server.keepAliveTimeout = 65000;
server.listen(cfg.port, cfg.host, () => {
  log('companion', `Round Remote light companion ${VERSION} on http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${cfg.port}/ (rss ${Math.round(process.memoryUsage().rss / 1048576)} MB)`);
  // on a Pi the system API starts the setup hotspot's captive portal when needed — load it now, not at the first request
  if (fs.existsSync('/proc/device-tree/model') || process.env.RR_SYS_ROOT) {
    const fakeReq = { method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' }, on() {} };
    const sink = { setHeader() {}, writeHead() {}, end() {}, write() {}, headersSent: false };
    loadSystem().then((m) => m.route(fakeReq, sink, new URL('http://127.0.0.1/api/system/info'), helpers)).catch(() => {});
  }
});
const bye = () => { companion.stop(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
process.on('unhandledRejection', (e) => log('companion', 'unhandled', e?.message || e));
