// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Set up the round display from a phone or computer: the display shows a QR code + a 6-digit code, the phone opens
// http://<bridge>:8765/setup, pairs, and fills in every service's keys, tokens and sign-ins in a comfortable browser.
// Submissions travel phone → bridge → display (the display keeps most sign-ins in its own settings and signs in with
// its own provider code); what the bridge keeps itself (Apple .p8 key, Steam, PlayStation, Google Home client,
// Collection tokens, config.json "app" defaults) is handled here and the display is told to refresh.
//
// Security: only LAN / loopback clients; a pairing code lives 15 minutes, the QR's one-time token is used once;
// a phone's session is bound to that one display and ends after 15 idle minutes (or when the display ends it);
// secrets are never logged and are forgotten as soon as the display has picked them up.
//
//   GET  /setup                                the phone / computer page (bridge/lib/setup-page.js)
//   GET  /api/setup/info                       { ips, port, publicUrl, shortUrl, hostname, boot, relay } — the display builds the QR from this
//   ---- the display (id + its secret key) ----
//   POST /api/setup/claim  {display,key,name}  register this display
//   POST /api/setup/pair   {display,key}       open pairing → { code, token, exp }
//   POST /api/setup/unpair {display,key}       close pairing (the code stops working)
//   POST /api/setup/kick   {display,key,phone?}   end one phone's session (or all)
//   PUT  /api/setup/status {display,key,status}   the live checklist → every paired phone
//   GET  /api/setup/host?display&key           SSE: hello · act · phones · pair
//   GET  /api/setup/inbox?display&key&since    the same, polled (an https page can't open an EventSource to http)
//   POST /api/setup/reply  {display,key,seq,stage,ok,message,data}   the outcome of an act → its phone
//   ---- the phone (session id) ----
//   POST /api/setup/join   {code | token+display, name}   → { sid, exp, display }
//   GET  /api/setup/events?sid&since           SSE: session · status · reply · bye
//   GET  /api/setup/state?sid&since            the same, polled
//   POST /api/setup/act    {sid, type, ref, svc, data}    → the display
//   POST /api/setup/bridge {sid, kind, data}   handled here: status · apple-key · steam · psn · googlehome · collection · app · profile-put · tv
//   POST /api/setup/leave  {sid}
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { log } from './util.js';
import { lanIps, BOOT, HttpErr, str } from './party.js';
import { PAGE } from './setup-page.js';

// (RR_SETUP_PAIR_MS / RR_SETUP_SESSION_MS shorten the 15 minutes — for tests)
const PAIR_MS = +process.env.RR_SETUP_PAIR_MS || 15 * 60e3, SESSION_MS = +process.env.RR_SETUP_SESSION_MS || 15 * 60e3, MAX_SESSIONS = 4, MAX_DISPLAYS = 40, MAX_ACT = 64 * 1024;
const DEFAULT_RELAY = 'https://royborkin.github.io/RoundSpotify/';
const ACTS = new Set(['hello', 'spotify-client', 'spotify-code', 'plex-start', 'plex-cancel', 'jellyfin-login', 'jellyfin-qc', 'jellyfin-cancel', 'ha',
  'youtube', 'apple-token', 'apple-check', 'streamer', 'wifi-scan', 'wifi-connect', 'profile-save', 'profile-load', 'alert-test', 'refresh']);

const displays = new Map();   // id → display
const sessions = new Map();   // sid → session

// ---------------------------------------------------------------- helpers
const rnd = (n) => crypto.randomBytes(n).toString('hex');
const sixDigits = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');
const cleanId = (v) => String(v || '').replace(/[^\w-]/g, '').slice(0, 40);
const now = () => Date.now();
/** Only phones and computers on the home network (or this machine) may use the setup API. */
export function lanClient(req) {
  const a = String(req.socket.remoteAddress || '').replace(/^::ffff:/i, '').toLowerCase();
  if (!a) return false;
  return a === '::1' || /^127\./.test(a) || /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^169\.254\./.test(a)
    || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a) /* CGNAT / Tailscale */ || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe80:/.test(a);
}
function sseHead(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
}
const sse = (res, event, data, id) => { try { res.write(`${id != null ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };

const hits = new Map();
function limited(key, max, win) {
  const t = now();
  const h = (hits.get(key) || []).filter((x) => t - x < win);
  h.push(t); hits.set(key, h);
  if (hits.size > 5000) hits.clear();
  return h.length > max;
}

// ---------------------------------------------------------------- displays & sessions
function getDisplay(b, { create = false } = {}) {
  const id = cleanId(b.display);
  const key = String(b.key || '');
  if (id.length < 6 || key.length < 16) throw new HttpErr(400, 'display id / key missing');
  let d = displays.get(id);
  if (!d) {
    if (!create) throw new HttpErr(404, 'This display isn’t registered — open “Set up from phone” on it again');
    if (displays.size >= MAX_DISPLAYS) gc(true);
    d = { id, key, name: 'Round display', touched: now(), code: '', codeExp: 0, token: '', hosts: new Set(), hostSeen: 0, inbox: [], seq: 0, owners: new Map(), status: null, wrong: 0 };
    displays.set(id, d);
  } else if (d.key !== key) throw new HttpErr(403, 'Wrong display key');
  d.touched = now();
  return d;
}
const hostOnline = (d) => d.hosts.size > 0 || now() - d.hostSeen < 8000;
const pairInfo = (d) => (d.code && d.codeExp > now() ? { code: d.code, token: d.token, exp: d.codeExp } : null);
const phonesOf = (d) => [...sessions.values()].filter((s) => s.display === d.id)
  .map((s) => ({ id: s.pub, name: s.name, kind: s.kind, since: s.created, exp: s.exp, online: s.conns.size > 0 || now() - s.seen < 8000 }));
function pushHosts(d, event, data) { for (const c of d.hosts) sse(c, event, data); }
function pushPhones(d) { pushHosts(d, 'phones', phonesOf(d)); }
function sessionView(s) {
  const d = displays.get(s.display);
  return { exp: s.exp, name: s.name, display: d?.name || '', displayOnline: d ? hostOnline(d) : false };
}
function pushSession(s, event, data) { for (const c of s.conns) sse(c, event, data); }
function endSession(s, reason) {
  sessions.delete(s.sid);
  pushSession(s, 'bye', { reason });
  for (const c of s.conns) { try { c.end(); } catch {} }
  const d = displays.get(s.display);
  if (d) {
    pushPhones(d);
    for (const [seq, sid] of d.owners) if (sid === s.sid) d.owners.delete(seq);
  }
  log('setup', `${s.name || 'a phone'} ${reason === 'expired' ? 'timed out' : 'disconnected'}`);
}
function gc(force = false) {
  const t = now();
  for (const s of sessions.values()) if (s.exp < t) endSession(s, 'expired');
  for (const [id, d] of displays) {
    d.inbox = d.inbox.filter((a) => t - a.at < 120e3);   // anything the display didn't pick up in 2 minutes is dropped (secrets don't linger)
    const idle = t - d.touched > (force ? 3600e3 : 24 * 3600e3);
    if (idle && !d.hosts.size && !phonesOf(d).length) displays.delete(id);
  }
}
setInterval(gc, 30e3).unref?.();
setInterval(() => {   // keep-alives + display-online changes for the phones
  for (const d of displays.values()) {
    for (const c of d.hosts) { try { c.write(': ping\n\n'); } catch {} }
    const on = hostOnline(d);
    if (d.lastOn !== on) { d.lastOn = on; for (const s of sessions.values()) if (s.display === d.id) pushSession(s, 'session', sessionView(s)); }
  }
  for (const s of sessions.values()) for (const c of s.conns) { try { c.write(': ping\n\n'); } catch {} }
}, 15e3).unref?.();

function newPairing(d) {
  let code;
  do code = sixDigits(); while ([...displays.values()].some((x) => x !== d && x.code === code && x.codeExp > now()));
  d.code = code; d.codeExp = now() + PAIR_MS; d.token = rnd(12); d.wrong = 0;
  pushHosts(d, 'pair', pairInfo(d));
}
function pushAct(d, act) {
  act.seq = ++d.seq; act.at = now();
  d.inbox.push(act);
  if (d.inbox.length > 200) d.inbox.splice(0, d.inbox.length - 200);
  for (const c of d.hosts) sse(c, 'act', act, act.seq);
  if (d.hosts.size) d.inbox = d.inbox.filter((a) => a !== act);   // delivered over the stream: don't keep it
  return act;
}
function reply(s, r) {
  r.rid = ++s.rid; r.at = now();
  s.replies.push(r);
  if (s.replies.length > 30) s.replies.splice(0, s.replies.length - 30);
  pushSession(s, 'reply', r);
}
function sessionFrom(id) {
  const s = sessions.get(String(id || ''));
  if (!s || s.exp < now()) { if (s) endSession(s, 'expired'); throw new HttpErr(401, 'Your setup session ended — enter the code from the display again'); }
  s.seen = now();
  return s;
}
const touch = (s) => { s.exp = Math.max(s.exp, now() + SESSION_MS); pushSession(s, 'session', sessionView(s)); };

// ---------------------------------------------------------------- the bridge's own config
const cfgFile = (dir) => process.env.RR_CONFIG || path.join(dir, 'config.json');
function persistConfig(dir, patch) {
  const f = cfgFile(dir);
  let cur = {}, mode = 0o600;
  if (fs.existsSync(f)) {
    try { cur = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; mode = fs.statSync(f).mode & 0o777; }
    catch { throw new HttpErr(500, `${path.basename(f)} isn’t valid JSON — fix it on the bridge computer first`); }
  }
  for (const [k, v] of Object.entries(patch)) cur[k] = { ...(cur[k] || {}), ...v };
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n', { mode });
  fs.renameSync(tmp, f);
  try { fs.chmodSync(f, mode); } catch {}
}
/** Call one of this bridge's own endpoints (adapter actions, Collection config) over loopback. */
async function local(req, p, body, method) {
  let host = String(req.socket.localAddress || '127.0.0.1').replace(/^::ffff:/i, '');
  if (host.includes(':')) host = `[${host}]`;
  let r;
  try {
    r = await fetch(`http://${host}:${req.socket.localPort}${p}`, {
      method: method || (body ? 'POST' : 'GET'), headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000),
    });
  } catch (e) { throw new HttpErr(502, `The bridge couldn’t reach itself (${e.cause?.code || e.message})`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error === 'unknown adapter action' ? 'That part of the bridge is turned off (bridge/config.json → adapters) or not installed' : (j.error || `HTTP ${r.status}`);
    throw new HttpErr(r.status === 404 ? 404 : 400, msg);
  }
  return j;
}
const APP_KEYS = { spotifyClientId: 200, jellyfinServer: 300, appleDeveloperToken: 2000, youtubeApiKey: 200, googleClientId: 300 };
const SECRET_APP = new Set(['appleDeveloperToken', 'youtubeApiKey']);
const TV = { androidtv: ['list', 'discover', 'pair', 'code', 'unpair'], appletv: ['list', 'discover', 'pair', 'code', 'unpair'], youtubetv: ['list', 'pair', 'unpair'] };

async function bridgeKind(req, s, d, kind, b, { cfg, dir }) {
  const done = (extra = {}) => { pushAct(d, { type: 'bridge-done', kind, phone: s.pub, name: s.name, ...extra }); };
  switch (kind) {
    case 'status': {
      const q = (p) => local(req, p).catch(() => null);
      const info = await q('/api/info');
      const [steam, psn, gh, coll, profiles] = await Promise.all([q('/api/adapters/steam/status'), q('/api/adapters/psn/status'), q('/api/adapters/googlehome/status'), q('/api/collection/info'), q('/api/profiles')]);
      const a = cfg.apple || {};
      const keyFile = a.privateKeyPath ? path.resolve(dir, a.privateKeyPath) : '';
      const app = {};
      for (const k of Object.keys(APP_KEYS)) app[k] = SECRET_APP.has(k) ? !!cfg.app?.[k] : (cfg.app?.[k] || '');
      return {
        adapters: Object.fromEntries(Object.entries(info?.adapters || {}).map(([k, v]) => [k, { enabled: !!v.enabled, status: v.status || '' }])),
        version: info?.version || '', platform: process.platform, hostname: os.hostname(),
        apple: { teamId: a.teamId || '', keyId: a.keyId || '', ready: !!(a.teamId && a.keyId && keyFile && fs.existsSync(keyFile)) },
        steam: steam && { signedIn: !!steam.signedIn, name: steam.name || '', steamId: steam.steamId || '', hasKey: !!steam.hasKey },
        psn: psn && { signedIn: !!psn.signedIn, onlineId: psn.onlineId || '' },
        googlehome: gh && { signedIn: !!gh.signedIn, hasClient: !!gh.hasClient, clientId: gh.clientId || '', account: gh.account || '' },
        collection: coll?.conns || null,
        app, profiles: Array.isArray(profiles) ? profiles : [],
        configFile: path.basename(cfgFile(dir)),
      };
    }
    case 'apple-key': {
      const teamId = str(b.teamId, 20).toUpperCase(), keyId = str(b.keyId, 20).toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new HttpErr(400, 'The Team ID is 10 letters and digits (developer.apple.com → Membership)');
      if (!/^[A-Z0-9]{10}$/.test(keyId)) throw new HttpErr(400, 'The Key ID is 10 letters and digits (it’s in the file name: AuthKey_KEYID.p8)');
      const pem = String(b.p8 || '').trim();
      if (pem.length > 8000 || !/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(pem)) throw new HttpErr(400, 'That isn’t a .p8 key file (it starts with -----BEGIN PRIVATE KEY-----)');
      let key;
      try { key = crypto.createPrivateKey(pem); } catch { throw new HttpErr(400, 'The .p8 file couldn’t be read — download it again from developer.apple.com'); }
      if (key.asymmetricKeyType !== 'ec' || (key.asymmetricKeyDetails?.namedCurve && key.asymmetricKeyDetails.namedCurve !== 'prime256v1')) throw new HttpErr(400, 'That key isn’t an Apple MusicKit key (ES256)');
      try { crypto.sign('sha256', Buffer.from('test'), { key, dsaEncoding: 'ieee-p1363' }); } catch { throw new HttpErr(400, 'That key can’t sign tokens'); }
      const file = `AuthKey_${keyId}.p8`;
      fs.writeFileSync(path.join(dir, file), pem + '\n', { mode: 0o600 });
      try { fs.chmodSync(path.join(dir, file), 0o600); } catch {}
      cfg.apple = Object.assign(cfg.apple || {}, { teamId, keyId, privateKeyPath: file });   // the same object server.js signs from
      persistConfig(dir, { apple: { teamId, keyId, privateKeyPath: file } });
      log('setup', `Apple Music key ${file} saved (from ${s.name || 'a phone'})`);
      done({ keyId });
      return { ok: true, file };
    }
    case 'steam': {
      const r = await local(req, '/api/adapters/steam/setup', { apiKey: str(b.apiKey, 64), user: str(b.user, 200) });
      done({ name: r.name });
      return r;
    }
    case 'psn': {
      const r = await local(req, '/api/adapters/psn/signin', { npsso: str(b.npsso, 400) });
      done({ name: r.onlineId });
      return r;
    }
    case 'googlehome': {
      const r = await local(req, '/api/adapters/googlehome/setup', { clientId: str(b.clientId, 300), clientSecret: str(b.clientSecret, 200) });
      done();
      return r;
    }
    case 'collection': {
      const body = {};
      for (const [svc, fields] of Object.entries({ bgg: ['username', 'token'], pricecharting: ['token'], rawg: ['username', 'key'], discogs: ['username', 'token'], tmdb: ['key'] })) {
        if (!b[svc] || typeof b[svc] !== 'object') continue;
        body[svc] = {};
        for (const f of fields) if (typeof b[svc][f] === 'string') body[svc][f] = b[svc][f];
      }
      const r = await local(req, '/api/collection/config', body);
      done();
      return r;
    }
    case 'app': {
      const vals = {};
      for (const [k, max] of Object.entries(APP_KEYS)) {
        if (typeof b.values?.[k] !== 'string') continue;
        let v = str(b.values[k], max);
        if (k === 'jellyfinServer' && v) { v = v.replace(/\/+$/, ''); if (!/^https?:\/\//i.test(v)) v = `http://${v}`; }
        vals[k] = v;
      }
      if (!Object.keys(vals).length) throw new HttpErr(400, 'Nothing to save');
      cfg.app = Object.assign(cfg.app || {}, vals);
      for (const [k, v] of Object.entries(vals)) if (!v) delete cfg.app[k];
      persistConfig(dir, { app: vals });
      log('setup', `config "app" updated: ${Object.keys(vals).join(', ')}`);
      pushAct(d, { type: 'app-config', phone: s.pub, name: s.name, values: vals });   // this display takes them at once
      return { ok: true, saved: Object.keys(vals) };
    }
    case 'profile-put': {
      const p = b.profile;
      if (p?.app !== 'round-remote' || typeof p.settings !== 'object') throw new HttpErr(400, 'That file isn’t a Round Remote settings profile');
      const name = str(b.name || p.name || 'Imported', 60);
      await local(req, `/api/profiles/${encodeURIComponent(name)}`, p, 'PUT');
      return { ok: true, name };
    }
    case 'tv': {
      const ad = String(b.adapter || ''), action = String(b.action || '');
      if (!TV[ad]?.includes(action)) throw new HttpErr(400, 'unknown TV action');
      const body = action === 'list' || action === 'discover' ? null : { host: str(b.host, 100), code: str(b.code, 40), name: str(b.name, 80), id: str(b.id, 120) };
      const r = await local(req, `/api/adapters/${ad}/${action}`, body);
      if ((action === 'pair' || action === 'code') && r?.id) done({ adapter: ad, id: r.id, tv: r.name || '' });
      if (action === 'unpair') done({ adapter: ad, removed: b.id || b.host });
      return r ?? {};
    }
    default: throw new HttpErr(400, 'unknown setup kind');
  }
}

// ---------------------------------------------------------------- route
export async function route(req, res, url, { cfg, cors, json, readJson, originAllowed, dir }) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (p === '/setup') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (!lanClient(req)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Setup is only available on your home network.'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    return res.end(PAGE);
  }
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!originAllowed(req)) return json(res, 403, { error: `origin ${req.headers.origin} not allowed` });
  if (!lanClient(req)) return json(res, 403, { error: 'Setup is only available on your home network' });
  const q = url.searchParams;
  const sub = p.slice('/api/setup'.length);
  const ip = String(req.socket.remoteAddress || '');
  try {
    if (sub === '/info') {
      const port = req.socket.localPort;
      const pub = (cfg.setup?.publicUrl || '').replace(/\/$/, '');
      const hn = os.hostname().replace(/\.local$/i, '');
      const mdns = /^[a-z0-9-]+$/i.test(hn) && process.platform !== 'win32';
      return json(res, 200, {
        app: 'roundremote-setup', boot: BOOT, ips: lanIps(), port, publicUrl: pub, hostname: hn,
        shortUrl: pub ? `${pub}/setup` : mdns ? `http://${hn.toLowerCase()}.local:${port}/setup` : '',
        relay: cfg.setup?.spotifyRelay || DEFAULT_RELAY,
      });
    }
    // ------------------------------------------------ the display
    if (sub === '/claim' && req.method === 'POST') {
      const b = await readJson(req);
      const d = getDisplay(b, { create: true });
      d.name = str(b.name, 40) || d.name; d.hostSeen = now();
      return json(res, 200, { ok: true, boot: BOOT, seq: d.seq, pair: pairInfo(d), phones: phonesOf(d) });
    }
    if (sub === '/pair' && req.method === 'POST') {
      const d = getDisplay(await readJson(req));
      newPairing(d);
      log('setup', `pairing open on ${d.name} (15 min)`);
      return json(res, 200, { ok: true, ...pairInfo(d) });
    }
    if (sub === '/unpair' && req.method === 'POST') {
      const d = getDisplay(await readJson(req));
      d.code = ''; d.token = ''; d.codeExp = 0;
      pushHosts(d, 'pair', null);
      return json(res, 200, { ok: true });
    }
    if (sub === '/kick' && req.method === 'POST') {
      const b = await readJson(req);
      const d = getDisplay(b);
      for (const s of [...sessions.values()]) if (s.display === d.id && (!b.phone || s.pub === b.phone)) endSession(s, 'kicked');
      return json(res, 200, { ok: true, phones: phonesOf(d) });
    }
    if (sub === '/status' && (req.method === 'PUT' || req.method === 'POST')) {
      const b = await readJson(req);
      const d = getDisplay(b);
      if (JSON.stringify(b.status || null).length > 64e3) throw new HttpErr(413, 'status too big');
      d.status = b.status || null; d.hostSeen = now();
      for (const s of sessions.values()) if (s.display === d.id) pushSession(s, 'status', d.status);
      return json(res, 200, { ok: true });
    }
    if (sub === '/host' || sub === '/inbox') {
      const d = getDisplay({ display: q.get('display'), key: q.get('key') });
      d.hostSeen = now();
      const since = Math.max(+q.get('since') || 0, +req.headers['last-event-id'] || 0);
      d.inbox = d.inbox.filter((a) => a.seq > since);   // acknowledged → forgotten
      if (sub === '/inbox') return json(res, 200, { boot: BOOT, seq: d.seq, acts: d.inbox, phones: phonesOf(d), pair: pairInfo(d) });
      sseHead(res);
      sse(res, 'hello', { boot: BOOT, seq: d.seq, phones: phonesOf(d), pair: pairInfo(d) });
      for (const a of d.inbox) sse(res, 'act', a, a.seq);
      d.inbox = [];
      d.hosts.add(res);
      req.on('close', () => { d.hosts.delete(res); d.hostSeen = now(); });
      return;
    }
    if (sub === '/reply' && req.method === 'POST') {
      const b = await readJson(req);
      const d = getDisplay(b);
      d.hostSeen = now();
      const sid = d.owners.get(+b.seq);
      const s = sid && sessions.get(sid);
      if (!s) return json(res, 200, { ok: true, delivered: false });
      const stage = b.stage === 'progress' ? 'progress' : 'done';
      if (stage === 'done') d.owners.delete(+b.seq);
      if (JSON.stringify(b.data ?? null).length > 32e3) throw new HttpErr(413, 'reply too big');
      reply(s, { seq: +b.seq, ref: str(b.ref, 40), svc: str(b.svc, 40), stage, ok: b.ok !== false, message: str(b.message, 400), data: b.data ?? null });
      return json(res, 200, { ok: true, delivered: s.conns.size > 0 });
    }
    // ------------------------------------------------ the phone
    if (sub === '/join' && req.method === 'POST') {
      if (limited(`join@${ip}`, 12, 5 * 60e3)) throw new HttpErr(429, 'Too many tries — wait a few minutes');
      const b = await readJson(req);
      const t = now();
      let d = null;
      if (b.token) {
        const cand = displays.get(cleanId(b.display));
        const hash = (v) => crypto.createHash('sha256').update(String(v)).digest();
        if (cand && cand.token && cand.codeExp > t && crypto.timingSafeEqual(hash(b.token), hash(cand.token))) d = cand;
        if (!d && !b.code) throw new HttpErr(403, 'That QR code was already used or has expired — type the 6-digit code shown on the display');
      }
      if (!d && b.code) {
        const code = String(b.code).replace(/\D/g, '');
        d = [...displays.values()].find((x) => x.code && x.codeExp > t && x.code === code) || null;
        if (!d) {
          // a few wrong guesses against an open pairing: give it a new code
          for (const x of displays.values()) if (x.code && x.codeExp > t && ++x.wrong >= 25) newPairing(x);
          throw new HttpErr(403, 'Wrong code — check the 6 digits on the round display');
        }
      }
      if (!d) throw new HttpErr(400, 'Type the 6-digit code shown on the display');
      const mine = [...sessions.values()].filter((s) => s.display === d.id);
      if (mine.length >= MAX_SESSIONS) endSession(mine.sort((a, c) => a.seen - c.seen)[0], 'replaced');
      if (b.token && d.token) { d.token = rnd(12); pushHosts(d, 'pair', pairInfo(d)); }   // the QR's token works once
      const s = { sid: rnd(24), pub: 'p' + rnd(4), display: d.id, name: str(b.name, 40) || 'Phone', kind: /^(phone|computer|tablet)$/.test(b.kind) ? b.kind : 'phone',
        created: t, exp: t + SESSION_MS, seen: t, conns: new Set(), replies: [], rid: 0, ip };
      sessions.set(s.sid, s);
      pushPhones(d);
      pushAct(d, { type: 'joined', phone: s.pub, name: s.name });
      log('setup', `${s.name} paired with ${d.name}`);
      return json(res, 200, { ok: true, sid: s.sid, ...sessionView(s), status: d.status });
    }
    if (sub === '/events' || sub === '/state') {
      const s = sessionFrom(q.get('sid'));
      const d = displays.get(s.display);
      const since = Math.max(+q.get('since') || 0, +req.headers['last-event-id'] || 0);
      const backlog = s.replies.filter((r) => r.rid > since);
      if (sub === '/state') return json(res, 200, { session: sessionView(s), status: d?.status || null, replies: backlog });
      sseHead(res);
      sse(res, 'session', sessionView(s));
      sse(res, 'status', d?.status || null);
      for (const r of backlog) sse(res, 'reply', r, r.rid);
      s.conns.add(res);
      if (d) pushPhones(d);
      req.on('close', () => { s.conns.delete(res); s.seen = now(); if (d) setTimeout(() => pushPhones(d), 9000); });
      return;
    }
    if (sub === '/act' && req.method === 'POST') {
      const b = await readJson(req);
      const s = sessionFrom(b.sid);
      if (limited(`act:${s.sid}`, 40, 60e3)) throw new HttpErr(429, 'Slow down a little');
      if (JSON.stringify(b).length > MAX_ACT) throw new HttpErr(413, 'Too long');
      const type = String(b.type || '');
      if (!ACTS.has(type)) throw new HttpErr(400, 'unknown action');
      const d = displays.get(s.display);
      if (!d) throw new HttpErr(410, 'The display is gone — pair again');
      touch(s);
      const act = pushAct(d, { type, ref: str(b.ref, 40), svc: str(b.svc, 40), phone: s.pub, name: s.name, data: b.data && typeof b.data === 'object' ? b.data : {} });
      d.owners.set(act.seq, s.sid);
      if (d.owners.size > 500) d.owners.delete(d.owners.keys().next().value);
      return json(res, 200, { ok: true, seq: act.seq, displayOnline: hostOnline(d) });
    }
    if (sub === '/bridge' && req.method === 'POST') {
      const b = await readJson(req);
      const s = sessionFrom(b.sid);
      if (limited(`bridge:${s.sid}`, 40, 60e3)) throw new HttpErr(429, 'Slow down a little');
      if (JSON.stringify(b).length > 512e3) throw new HttpErr(413, 'Too big');
      const d = displays.get(s.display);
      if (!d) throw new HttpErr(410, 'The display is gone — pair again');
      const kind = String(b.kind || '');
      if (kind !== 'status') touch(s);
      return json(res, 200, await bridgeKind(req, s, d, kind, b.data || {}, { cfg, dir }));
    }
    if (sub === '/leave' && req.method === 'POST') {
      const b = await readJson(req);
      const s = sessions.get(String(b.sid || ''));
      if (s) endSession(s, 'left');
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) return json(res, e.code >= 400 && e.code < 600 ? e.code : 400, { error: e.message });
    try { res.end(); } catch {}
  }
}
export const _test = { displays, sessions };
