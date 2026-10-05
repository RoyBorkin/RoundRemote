// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// StreamUnlimited StreamSDK ("NSDK") streamers — Fosi Audio S3 and the other network streamers built on
// StreamUnlimited's Stream810/Stream800 modules. Their web UI (http://<ip>/webclient) talks to a small JSON
// API on port 80, and so do we:
//   GET  /api/getData?path=&roles=           one value (roles: value | @all)
//   GET  /api/getRows?path=&roles=&from=&to= a list (the ui: tree of sources, settings…)
//   POST /api/setData {path, role, value}    set a value (role "value") or trigger an action (role "activate")
//   POST /api/event/modifyQueue {queueId, subscribe:[{path,type:'itemWithValue'}], unsubscribe:[]} → "queue id"
//   GET  /api/event/pollQueue?queueId=&timeout=  long-poll → [change events]
//
// The app talks to the streamer through these bridge routes (wired in server.js), because a page served over
// https (GitHub Pages) can't call a plain-http device on the LAN, and the device sends no CORS headers:
//   GET  /api/streamsdk/getData?host=&path=&roles=
//   GET  /api/streamsdk/getRows?host=&path=&roles=&from=&to=
//   POST /api/streamsdk/setData {host, path, role, value}
//   GET  /api/streamsdk/events?host=&paths=a,b,c   Server-Sent Events: ready · change {paths} · stall · nopush
//   GET  /api/streamsdk/art?host=&url=             album art / icons from the device (LAN only)
//   GET  /api/streamsdk/info?host=                 name, product and firmware (the setup page's "Test")
// `host` is the streamer's address (192.168.1.50 or 192.168.1.50:80); it must be on the local network.
// Without it the bridge uses config.json → "streamsdk": { "host": "…" } or the last address the app used
// (kept in bridge/streamsdk.json), which it also pings every minute for the green dot on the Home tile.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPrivateHost, log } from '../lib/util.js';
import { dataPath } from '../lib/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT = 6000;

let state = null;            // { host, cfg, stateFile, setStatus, ping() }
function init(cfg = {}) {
  if (state) return state;
  const c = { host: '', stateFile: 'streamsdk.json', pingSec: 60, ...(cfg.streamsdk || {}) };
  c.stateFile = dataPath(c.stateFile);   // relative names live in the data folder (RR_DATA_DIR)
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(c.stateFile, 'utf8')); } catch {}
  state = { cfg: c, host: normHost(c.host) || normHost(saved.host) || '', setStatus: () => {}, last: null };
  return state;
}

/** "http://192.168.1.5/webclient/#/main" | "192.168.1.5:80" → "192.168.1.5" / "192.168.1.5:8080" (null when unusable). */
export function normHost(v) {
  let s = String(v || '').trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.port && u.port !== '80' ? u.host : u.hostname;
  } catch { return null; }
}
const hostnameOf = (host) => host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
const fail = (code, msg, extra = {}) => Object.assign(new Error(msg), { code, ...extra });

/** Pick + validate the device address for a request. */
function pickHost(h) {
  const st = init();
  const host = h ? normHost(h) : st.host || normHost(st.cfg.host);
  if (!host) throw fail(400, h ? 'That doesn’t look like a device address' : 'No streamer address set — enter it on the setup page');
  if (!isPrivateHost(hostnameOf(host))) throw fail(403, 'Only streamers on your local network are allowed');
  return host;
}
/** The device answered: remember its address (for the Home tile's status ping after a restart). */
function remember(host) {
  const st = init();
  if (!st.last?.ok || st.last.host !== host) { st.last = { ok: true, at: Date.now(), host, name: st.last?.name || '' }; st.setStatus(`running · streamer at ${host}`, true); }
  if (host === st.host) return;
  st.host = host;
  try { fs.writeFileSync(st.cfg.stateFile, JSON.stringify({ host }, null, 2)); } catch (e) { log('streamsdk', `could not save ${st.cfg.stateFile}: ${e.message}`); }
}

/** Call the device's API. Throws {code: 401|502|504, message}. */
async function device(host, pathAndQuery, { method = 'GET', body, timeout = TIMEOUT } = {}) {
  let r;
  try {
    r = await fetch(`http://${host}${pathAndQuery}`, {
      method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    const code = e.name === 'TimeoutError' || e.name === 'AbortError' ? 504 : 502;
    throw fail(code, code === 504 ? `The streamer at ${host} didn’t answer` : `Can’t reach the streamer at ${host} (${e.cause?.code || e.message})`, { unreachable: true });
  }
  const text = await r.text();
  if (r.status === 401 || r.status === 403) throw fail(401, 'The streamer’s web interface is password-protected — that isn’t supported yet. Turn off the web-interface password in the streamer’s settings.', { auth: true });
  if (!r.ok) throw fail(r.status >= 500 ? 502 : r.status, `The streamer answered HTTP ${r.status}${text ? `: ${text.slice(0, 160)}` : ''}`, { deviceStatus: r.status });
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}
const unwrap = (v) => {
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === 'object' && 'value' in v && v.type === 'value') v = v.value;
  if (v && typeof v === 'object' && typeof v.type === 'string' && v.type in v) return v[v.type];
  return v;
};
const getData = (host, p, roles = 'value') => device(host, `/api/getData?path=${encodeURIComponent(p)}&roles=${encodeURIComponent(roles)}`);

/** Device name, product and firmware version (also used for the status ping). */
async function info(host) {
  const [name, product, version] = await Promise.all([
    getData(host, 'settings:/deviceName'),
    getData(host, 'settings:/system/productName').catch(() => null),
    getData(host, 'settings:/version').catch(() => null),
  ]);
  return { host, name: unwrap(name) || '', product: unwrap(product) || '', version: unwrap(version) || '' };
}

// ---------------------------------------------------------------- live events (one device queue per host)
const watches = new Map();   // key → { host, paths, clients:Set<res>, qid, ctrl, stopped }
function sse(res, event, data) { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} }
function eventPaths(list, fallback) {
  const out = new Set();
  for (const e of [].concat(list || [])) {
    const p = e?.path || e?.item?.path || e?.itemPath || e?.itemValue?.path || e?.value?.path;
    if (typeof p === 'string') out.add(p);
  }
  return out.size ? [...out] : fallback;
}
async function runWatch(w) {
  let fails = 0;
  while (!w.stopped) {
    try {
      if (!w.qid) {
        const id = await device(w.host, '/api/event/modifyQueue', { method: 'POST', body: { queueId: '', subscribe: w.paths.map((p) => ({ path: p, type: 'itemWithValue' })), unsubscribe: [] } });
        w.qid = typeof id === 'string' ? id : id?.queueId || id?.id || '';
        if (!w.qid) throw fail(502, 'no queue id');
        for (const c of w.clients) sse(c, 'ready', { queue: true });
      }
      const ev = await device(w.host, `/api/event/pollQueue?queueId=${encodeURIComponent(w.qid)}&timeout=20000`, { timeout: 30000 });
      fails = 0;
      if (Array.isArray(ev) && ev.length) for (const c of w.clients) sse(c, 'change', { paths: eventPaths(ev, w.paths) });
    } catch (e) {
      if (w.stopped) return;
      w.qid = '';
      fails++;
      for (const c of w.clients) sse(c, fails >= 2 ? 'nopush' : 'stall', { error: e.message, auth: !!e.auth, unreachable: !!e.unreachable });
      await new Promise((r) => setTimeout(r, Math.min(15000, 1500 * fails)));
    }
  }
}
function watch(host, paths, res) {
  const key = `${host}|${paths.join(',')}`;
  let w = watches.get(key);
  if (!w) { w = { host, paths, clients: new Set(), qid: '', stopped: false }; watches.set(key, w); runWatch(w); }
  w.clients.add(res);
  if (w.qid) sse(res, 'ready', { queue: true });
  return () => {
    w.clients.delete(res);
    if (!w.clients.size) {
      w.stopped = true; watches.delete(key);
      if (w.qid) device(host, '/api/event/modifyQueue', { method: 'POST', body: { queueId: w.qid, subscribe: [], unsubscribe: w.paths.map((p) => ({ path: p, type: 'itemWithValue' })) } }).catch(() => {});
    }
  };
}

// ---------------------------------------------------------------- HTTP routes (/api/streamsdk/*)
const IMG_TYPES = /^image\//i;
async function readJsonBody(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 1e5) throw fail(413, 'body too large'); chunks.push(c); }
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

export async function route(req, res, url, { json, cfg }) {
  init(cfg);
  const action = url.pathname.slice('/api/streamsdk/'.length);
  const q = url.searchParams;
  try {
    if (action === 'getData') {
      const host = pickHost(q.get('host'));
      if (!q.get('path')) throw fail(400, 'path missing');
      const out = await getData(host, q.get('path'), q.get('roles') || 'value');
      remember(host);
      return json(res, 200, out);
    }
    if (action === 'getRows') {
      const host = pickHost(q.get('host'));
      if (!q.get('path')) throw fail(400, 'path missing');
      const from = Math.max(0, parseInt(q.get('from') || '0', 10) || 0), to = Math.min(from + 500, parseInt(q.get('to') || '60', 10) || 60);
      const extra = q.get('type') ? `&type=${encodeURIComponent(q.get('type'))}` : '';
      return json(res, 200, await device(host, `/api/getRows?path=${encodeURIComponent(q.get('path'))}&roles=${encodeURIComponent(q.get('roles') || '@all')}&from=${from}&to=${to}${extra}`));
    }
    if (action === 'setData') {
      if (req.method !== 'POST') throw fail(405, 'POST only');
      const b = await readJsonBody(req);
      const host = pickHost(b.host);
      if (!b.path || !b.role) throw fail(400, 'path and role are needed');
      const body = { path: String(b.path), role: String(b.role), value: b.value ?? {} };
      if (b.platform) body.platform = b.platform;
      const out = await device(host, '/api/setData', { method: 'POST', body });
      remember(host);
      return json(res, 200, out ?? { ok: true });
    }
    if (action === 'info') {
      const host = pickHost(q.get('host'));
      const r = await info(host);
      init().last = { ok: true, at: Date.now(), host, name: r.name };
      remember(host);
      init().setStatus(`running · ${r.name || 'streamer'} at ${host}`, true);
      return json(res, 200, r);
    }
    if (action === 'events') {
      const host = pickHost(q.get('host'));
      const paths = String(q.get('paths') || 'player:player/data,player:volume,settings:/mediaPlayer/mute').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 4000\n\n');
      const off = watch(host, paths, res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
      req.on('close', () => { clearInterval(ping); off(); });
      return;
    }
    if (action === 'art') {
      const host = pickHost(q.get('host'));
      const raw = q.get('url') || '';
      let target;
      try { target = new URL(raw, `http://${host}/`); } catch { throw fail(400, 'bad url'); }
      if (!/^https?:$/.test(target.protocol) || !isPrivateHost(target.hostname)) throw fail(403, 'only images on the local network');
      let r;
      try { r = await fetch(target, { signal: AbortSignal.timeout(8000) }); } catch (e) { throw fail(502, e.cause?.code || e.message); }
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || (ct && !IMG_TYPES.test(ct) && !/octet-stream/.test(ct))) { res.writeHead(r.ok ? 415 : r.status); return res.end(); }
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, { 'Content-Type': ct || 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400' });
      return res.end(buf);
    }
    if (action === 'status') {
      const st = init();
      return json(res, 200, { host: st.host || normHost(st.cfg.host) || '', last: st.last });
    }
    return json(res, 404, { error: 'unknown streamsdk action' });
  } catch (e) {
    const code = typeof e.code === 'number' ? e.code : 500;
    if (!res.headersSent) return json(res, code, { error: e.message, auth: !!e.auth, unreachable: !!e.unreachable });
    try { res.end(); } catch {}
  }
}

// ---------------------------------------------------------------- adapter (status for the Home tile)
export function create({ cfg = {}, setStatus }) {
  const st = init(cfg);
  st.setStatus = setStatus;
  let timer = null;
  async function ping() {
    const host = st.host || normHost(st.cfg.host);
    if (!host) { setStatus('running · no streamer address yet (set it in the app)', false); return; }
    try {
      const r = await info(host);
      st.last = { ok: true, at: Date.now(), host, name: r.name };
      setStatus(`running · ${r.name || 'streamer'} at ${host}`, true);
    } catch (e) {
      st.last = { ok: false, at: Date.now(), host, error: e.message };
      setStatus(e.auth ? `running · ${host} is password-protected` : `running · streamer at ${host} not reachable`, false);
    }
  }
  return {
    id: 'streamsdk',
    async start() { await ping(); timer = setInterval(ping, Math.max(15, st.cfg.pingSec) * 1000); },
    stop() { clearInterval(timer); for (const w of watches.values()) w.stopped = true; },
    actions: { status: async () => ({ host: st.host || '', last: st.last }), ping: async () => { await ping(); return st.last; } },
  };
}
