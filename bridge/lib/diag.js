// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Diagnostics: one JSON report about this bridge — for every role (standalone Pi/PC, server in Docker, companion).
//   GET /api/diag[?fresh=1][&probe=<name>|<url>…]   the report (≤ ~12 s; every section has its own time limit)
//   GET /diag                                       the same as a readable page with a "Copy" button
// Never contains secrets: services are reported as configured yes/no, URLs as scheme://host:port only, and the
// log excerpt (last 50 lines) is masked. Extra reachability checks (?probe=) are limited to local-network addresses
// (and *.plex.direct), like /api/proxy.
import os from 'node:os';
import fs from 'node:fs';
import dgram from 'node:dgram';
import { log, recentLog, isPrivateHost, maskSecrets } from './util.js';
import { DATA_DIR, CONFIG_FILE, CODE_DIR, APP_ROOT, ROLE, IN_CONTAINER, SEPARATE_DATA, PUBLIC_URL, appVersion, bridgeVersion, diskSpace } from './paths.js';
import { DIAG_PAGE } from './diag-page.js';

const SECTION_MS = { system: 9000, mdns: 6500, ssdp: 4000, reach: 4500, update: 9000, adapters: 3000, default: 3000 };
let last = null;   // { at, report } — a few seconds of cache so a page + its copy button don't scan twice

/** Run one section with a time limit; a failure or timeout becomes { error }. */
function section(name, fn) {
  const ms = SECTION_MS[name] || SECTION_MS.default;
  const t0 = Date.now();
  let timer;
  return Promise.race([
    Promise.resolve().then(fn).then((v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v, ms: Date.now() - t0 } : { value: v, ms: Date.now() - t0 })),
    new Promise((r) => { timer = setTimeout(() => r({ error: `timed out after ${ms} ms`, ms }), ms); }),
  ]).catch((e) => ({ error: maskSecrets(e?.message || String(e)), ms: Date.now() - t0 })).finally(() => clearTimeout(timer));
}

const origin = (u) => { try { const x = new URL(u); return `${x.protocol}//${x.host}`; } catch { return ''; } };
const has = (v) => !!(v && String(v).trim());

// ---------------------------------------------------------------- sections
function basics({ version }) {
  const d = diskSpace(DATA_DIR);
  let writable = false; try { fs.accessSync(DATA_DIR, fs.constants.W_OK); writable = true; } catch {}
  const osRel = (() => { try { return (fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]*)"?/m) || [])[1] || ''; } catch { return ''; } })();
  return {
    bridge: version || bridgeVersion(), app: appVersion(), role: ROLE, node: process.version,
    platform: process.platform, arch: process.arch, os: osRel || `${os.type()} ${os.release()}`, kernel: os.release(),
    hostname: os.hostname(), container: IN_CONTAINER, user: typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid()}` : '',
    uptime: { systemSec: Math.round(os.uptime()), bridgeSec: Math.round(process.uptime()) },
    memory: { totalMb: Math.round(os.totalmem() / 1048576), freeMb: Math.round(os.freemem() / 1048576), bridgeRssMb: Math.round(process.memoryUsage().rss / 1048576) },
    load: os.loadavg().map((n) => Math.round(n * 100) / 100), cpus: os.cpus().length,
    paths: { code: CODE_DIR, app: APP_ROOT, data: DATA_DIR, separateData: SEPARATE_DATA, config: CONFIG_FILE, configExists: fs.existsSync(CONFIG_FILE), dataWritable: writable },
    disk: d ? { freeMb: Math.round(d.freeBytes / 1048576), totalMb: Math.round(d.totalBytes / 1048576) } : null,
    tz: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  };
}

function config(cfg) {
  const app = cfg.app || {};
  const col = cfg.collection || {};
  const dataFiles = ['psn.json', 'steam.json', 'googlehome.json', 'youtube-tv.json', 'androidtv.json', 'appletv.json', 'streamsdk.json', 'roon-state.json',
    'tasks.json', 'collection.json', 'blanks.json', 'system-state.json'].filter((f) => fs.existsSync(`${DATA_DIR}/${f}`));
  let profiles = 0; try { profiles = fs.readdirSync(`${DATA_DIR}/profiles`).filter((f) => f.endsWith('.json')).length; } catch {}
  return {
    port: cfg.port, host: cfg.host, allowedOrigins: (cfg.allowedOrigins || []).length, lanOrigins: cfg.lanOrigins !== false,
    publicUrl: PUBLIC_URL || cfg.setup?.publicUrl || cfg.tasks?.publicUrl || cfg.party?.publicUrl || '',
    adaptersEnabled: Object.fromEntries(Object.entries(cfg.adapters || {}).map(([k, v]) => [k, !!v])),
    services: {
      spotifyClientId: has(app.spotifyClientId), jellyfinServer: has(app.jellyfinServer), appleDeveloperToken: has(app.appleDeveloperToken),
      appleKey: has(cfg.apple?.teamId) && has(cfg.apple?.keyId) && has(cfg.apple?.privateKeyPath), youtubeApiKey: has(app.youtubeApiKey), googleClientId: has(app.googleClientId),
      psnNpsso: has(cfg.psn?.npsso), steamApiKey: has(cfg.steam?.apiKey), steamId: has(cfg.steam?.steamId), streamer: has(cfg.streamsdk?.host),
      ciderToken: has(cfg.cider?.token), bgg: has(col.bgg?.username), pricecharting: has(col.pricecharting?.token), rawg: has(col.rawg?.key), discogs: has(col.discogs?.token), tmdb: has(col.tmdb?.key),
    },
    system: { allowRemote: cfg.system?.allowRemote === true, battery: cfg.system?.battery || 'auto' },
    stateFiles: dataFiles, profiles,
  };
}

async function adapters({ adapterState, hub }) {
  const zones = {};
  for (const z of hub?.list?.() || []) zones[z.adapter] = (zones[z.adapter] || 0) + 1;
  const out = {};
  for (const [id, s] of Object.entries(adapterState || {})) {
    const st = String(s.status || '');
    out[id] = { enabled: !!s.enabled, loaded: !!hub?.adapters?.get(id), status: maskSecrets(st).slice(0, 200), error: /error|not installed|fail|missing/i.test(st) ? maskSecrets(st).slice(0, 200) : '', zones: zones[id] || 0 };
  }
  // signed-in yes/no of the account adapters (booleans only)
  await Promise.all(['psn', 'steam', 'googlehome', 'youtubetv', 'androidtv', 'appletv'].map(async (id) => {
    const fn = hub?.adapters?.get(id)?.actions?.status || hub?.adapters?.get(id)?.actions?.list;
    if (!fn || !out[id]) return;
    try {
      const r = await Promise.race([fn({}, {}), new Promise((ok) => setTimeout(() => ok(null), 2000))]);
      if (Array.isArray(r)) out[id].paired = r.length;
      else if (r && typeof r === 'object') {
        for (const k of ['signedIn', 'hasKey', 'hasClient', 'connected', 'paired']) if (typeof r[k] === 'boolean') out[id][k] = r[k];
        for (const k of ['tvs', 'screens', 'devices']) if (Array.isArray(r[k])) out[id][k] = r[k].length;
      }
    } catch {}
  }));
  return { list: out, zonesTotal: hub?.zones?.size || 0 };
}

async function network() {
  const { listInterfaces } = await import('../adapters/androidtv-discover.js');
  const { lanIps } = await import('./party.js');
  const ifs = listInterfaces();
  return { interfaces: ifs.map((i) => ({ name: i.name, address: i.address, cidr: i.cidr, virtual: i.virtual, private: i.private, linkLocal: i.linkLocal })),
    phoneAddress: lanIps()[0] || null, lanIps: lanIps(), publicUrl: PUBLIC_URL || '' };
}

/** mDNS self-test = the Google TV scan without the subnet sweep: multicast bound? heard? replies? */
async function mdns() {
  const { scan } = await import('../adapters/androidtv-discover.js');
  const r = await scan({ timeout: 3500, sweep: false });
  const m = r.diag.methods;
  return {
    multicast: { bound: m.multicast.bound, heard: m.multicast.heard, replies: m.multicast.replies, error: m.multicast.error || '' },
    unicast: { replies: m.unicast.replies, errors: (m.unicast.errors || []).length },
    avahi: m.avahi, castDevices: m.cast.found, googleTvs: r.tvs.length,
    tvs: r.tvs.map((t) => ({ name: t.name || '', host: t.host, via: t.via, verified: !!t.verified })).slice(0, 20),
    interfacesSearched: r.diag.interfaces.filter((i) => i.searched).map((i) => i.name),
    hints: (r.diag.hints || []).map((h) => h.text).slice(0, 6),
  };
}

/** SSDP / UPnP: one M-SEARCH, count who answers (media renderers, servers, routers …). */
function ssdp({ ms = 2500 } = {}) {
  return new Promise((resolve) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const hosts = new Map(); let error = '';
    const done = () => { try { s.close(); } catch {} resolve({ responders: hosts.size, renderers: [...hosts.values()].filter((v) => v.renderer).length, servers: [...hosts.values()].filter((v) => v.server).length, sample: [...hosts.entries()].slice(0, 12).map(([ip, v]) => ({ ip, server: v.serverHeader })), error }); };
    s.on('error', (e) => { error = e.code || e.message; done(); });
    s.on('message', (buf, rinfo) => {
      const t = buf.toString('utf8');
      const h = hosts.get(rinfo.address) || { renderer: false, server: false, serverHeader: '' };
      if (/MediaRenderer|AVTransport|RenderingControl/i.test(t)) h.renderer = true;
      if (/MediaServer|ContentDirectory/i.test(t)) h.server = true;
      h.serverHeader = h.serverHeader || ((t.match(/^server:\s*(.*)$/im) || [])[1] || '').trim().slice(0, 80);
      hosts.set(rinfo.address, h);
    });
    s.bind(0, () => {
      const msg = (st) => Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
      for (const st of ['ssdp:all', 'urn:schemas-upnp-org:device:MediaRenderer:1']) s.send(msg(st), 1900, '239.255.255.250', (e) => { if (e) error = e.code || e.message; });
      setTimeout(done, ms);
    });
  });
}

/** HEAD (or GET) a server with a 3 s limit — only its scheme://host:port is reported. */
async function reach(name, url) {
  const target = origin(url);
  if (!target) return { name, target: '', ok: false, error: 'not a URL' };
  const host = new URL(url).hostname;
  if (!isPrivateHost(host) && !/\.plex\.direct$/i.test(host)) return { name, target, ok: null, error: 'skipped (not a local-network address)' };
  const t0 = Date.now();
  const go = (method) => fetch(target + (new URL(url).pathname || '/'), { method, redirect: 'manual', signal: AbortSignal.timeout(3000) });
  try {
    let r = await go('HEAD');
    if (r.status === 405 || r.status === 501) r = await go('GET');
    try { await r.body?.cancel(); } catch {}
    return { name, target, ok: r.status < 500, status: r.status, ms: Date.now() - t0 };
  } catch (e) { return { name, target, ok: false, error: e.cause?.code || (e.name === 'TimeoutError' ? 'timeout (3 s)' : e.message), ms: Date.now() - t0 }; }
}
async function reachAll(cfg, probes) {
  const list = [];
  if (has(cfg.app?.jellyfinServer)) list.push(['jellyfin (bridge config)', cfg.app.jellyfinServer]);
  if (cfg.adapters?.cider && cfg.cider?.host && !(ROLE === 'server' && /^(127\.|localhost)/.test(cfg.cider.host))) list.push(['cider', `http://${cfg.cider.host}:${cfg.cider.port || 10767}/`]);
  for (const p of probes.slice(0, 8)) { const i = p.indexOf('|'); if (i > 0) list.push([p.slice(0, i).slice(0, 40), p.slice(i + 1)]); }
  const seen = new Set();
  const uniq = list.filter(([n, u]) => { const k = n + origin(u); if (!origin(u) || seen.has(k)) return false; seen.add(k); return true; });
  return { checks: await Promise.all(uniq.map(([n, u]) => reach(n, u))) };
}

async function roon({ adapterState, hub }) {
  const s = adapterState?.roon;
  return { enabled: !!s?.enabled, status: s?.status || 'unknown', zones: (hub?.list?.() || []).filter((z) => z.adapter === 'roon').length };
}

async function system(cfg) {
  const { systemDiag } = await import('./system.js');
  return systemDiag(cfg);
}
async function update(cfg) {
  if (ROLE === 'server' || IN_CONTAINER) { const { dockerUpdate } = await import('./server-role.js'); return dockerUpdate(cfg, { fetch: true }); }
  return { mode: 'git', note: 'see system.git (Raspberry Pi: Settings → Device → Updates)' };
}

// ---------------------------------------------------------------- the report
export async function report(ctx, { probes = [], fresh = false } = {}) {
  if (!fresh && !probes.length && last && Date.now() - last.at < 8000) return last.report;
  const t0 = Date.now();
  const { cfg } = ctx;
  const [b, c, a, n, md, sd, rc, rn, sy, up] = await Promise.all([
    section('basics', () => basics(ctx)), section('config', () => config(cfg)), section('adapters', () => adapters(ctx)),
    section('network', () => network()), section('mdns', () => mdns()), section('ssdp', () => ssdp()),
    section('reach', () => reachAll(cfg, probes)), section('roon', () => roon(ctx)), section('system', () => system(cfg)), section('update', () => update(cfg)),
  ]);
  const zones = ctx.hub?.list?.() || [];
  const out = {
    app: 'roundremote-diag', generatedAt: new Date().toISOString(), tookMs: 0,
    basics: b, config: c, adapters: a, network: n, mdns: md, ssdp: sd,
    cast: { zones: zones.filter((z) => z.adapter === 'cast').length, foundByMdns: md.castDevices ?? null, adapter: ctx.adapterState?.cast?.status || '' },
    roon: rn, reachability: rc, system: sy, update: up,
    log: recentLog(),
  };
  out.tookMs = Date.now() - t0;
  last = { at: Date.now(), report: out };
  return out;
}

export async function route(req, res, url, ctx) {
  const { cors, json, originAllowed } = ctx;
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (p === '/diag') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    return res.end(DIAG_PAGE);
  }
  if (p !== '/api/diag') { res.writeHead(404); return res.end('Not found'); }
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!originAllowed(req)) return json(res, 403, { error: `origin ${req.headers.origin} not allowed` });
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
  try {
    const out = await report(ctx, { probes: url.searchParams.getAll('probe').map(String), fresh: url.searchParams.get('fresh') === '1' });
    return json(res, 200, out);
  } catch (e) { log('diag', e.message); return json(res, 500, { error: maskSecrets(e.message) }); }
}
