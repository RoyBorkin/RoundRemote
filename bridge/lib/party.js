// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Shared plumbing for the party apps (Party DJ, Movie Night, Trivia Night): a "room" per display, phones that
// join it by scanning a QR code, and a relay between them. The round display is in charge — it keeps the queue /
// votes / scores and publishes a public state; phones send actions ("acts") that the bridge stamps with its own
// receive time and relays to the display. Each app adds a small hook file (lib/dj.js, lib/movienight.js,
// lib/trivia.js) with its phone page, validation and a per-phone view of the state.
//
//   GET  /<app>?r=<room>                      the phone page
//   GET  /api/<app>/info                      { ips, port, publicUrl, boot } — the display builds the QR link from this
//   POST /api/<app>/room   {room, key}        the display claims its room (key = the display's secret)
//   PUT  /api/<app>/state  {room, key, state, blocked}   the display publishes its state → sent to every phone
//   GET  /api/<app>/host?room&key&since       SSE for the display: 'hello', 'act' (one per phone action)
//   GET  /api/<app>/inbox?room&key&since      the same, polled (when EventSource can't be used)
//   POST /api/<app>/reply  {room, key, device, data}   a private answer to one phone (e.g. search results)
//   GET  /api/<app>/events?room&device        SSE for a phone: 'state' (its own view), 'reply', 'host'
//   GET  /api/<app>/state?room&device         the same, polled
//   POST /api/<app>/act    {room, device, name, type, …}   a phone action → { ok, seq, … }
// Rooms live in memory (a party lasts an evening); the display keeps its own copy and re-claims after a restart.
import os from 'node:os';
import crypto from 'node:crypto';
import { log } from './util.js';

export const BOOT = crypto.randomBytes(5).toString('hex');   // changes when the bridge restarts (the display resets its cursor)
const MAX_ROOMS = 200, MAX_INBOX = 1000, MAX_ACT = 16000, IDLE_MS = 24 * 3600e3;
export const nowHr = () => Number(process.hrtime.bigint()) / 1e6;   // monotonic ms (fractional) — used to rank buzzes fairly

export function lanIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue;
      out.push({ name, address: a.address });
    }
  }
  const rank = (a) => (/^(docker|br-|veth|virbr|vmnet|vboxnet|tailscale|zt|utun)/i.test(a.name) ? 10 : 0)
    + (a.address.startsWith('192.168.') ? 0 : a.address.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b)).map((a) => a.address);
}

export const str = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
const cleanRoom = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const cleanDevice = (v) => String(v || '').replace(/[^\w-]/g, '').slice(0, 40);
export class HttpErr extends Error { constructor(code, msg) { super(msg); this.code = code; } }

function sseHead(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
}
const sse = (res, event, data, id) => { try { res.write(`${id != null ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };

/**
 * Build the route handler for one party app.
 * @param {object} o
 * @param {string} o.name            'dj' | 'movienight' | 'trivia'
 * @param {string} o.page            the phone page's HTML
 * @param {(state, device, room) => any} [o.personalize]   the state one phone sees (never leak other phones' ids)
 * @param {(room, act, ctx) => object|void} [o.accept]     validate / stamp an act; throw HttpErr to refuse; return extra reply fields
 * @param {(room, state, prev) => void} [o.onState]        the display published a new state
 */
export function partyApp({ name, page, personalize = (s) => s, accept = () => ({}), onState = () => {} }) {
  const rooms = new Map();
  const tag = name;

  function gc() {
    const now = Date.now();
    for (const [code, r] of rooms) if (now - r.touched > IDLE_MS && !r.hosts.size && !r.phones.size) rooms.delete(code);
  }
  setInterval(gc, 3600e3).unref?.();
  // keep-alive for every open stream (proxies and phones drop idle connections)
  setInterval(() => {
    for (const r of rooms.values()) {
      for (const c of r.hosts) { try { c.res.write(': ping\n\n'); } catch {} }
      for (const c of r.phones) { try { c.res.write(': ping\n\n'); } catch {} }
    }
  }, 15000).unref?.();

  function room(code, { create = true } = {}) {
    code = cleanRoom(code);
    if (code.length < 3) throw new HttpErr(400, 'Missing room code — scan the QR code on the display again');
    let r = rooms.get(code);
    if (!r && create) {
      if (rooms.size >= MAX_ROOMS) { gc(); if (rooms.size >= MAX_ROOMS) throw new HttpErr(503, 'Too many rooms on this bridge'); }
      r = { code, key: null, created: Date.now(), touched: Date.now(), rev: 0, seq: 0, state: null, blocked: new Set(), inbox: [], hosts: new Set(), phones: new Set(),
        guests: new Map(), hostSeen: 0, data: {} };
      rooms.set(code, r);
    }
    if (r) r.touched = Date.now();
    return r;
  }
  const hostOnline = (r) => r.hosts.size > 0 || Date.now() - r.hostSeen < 6000;
  function checkKey(r, key) { if (!r.key || r.key !== String(key || '')) throw new HttpErr(403, 'Wrong room key'); }

  function phoneView(r, device) {
    let st = null;
    try { st = r.state == null ? null : personalize(r.state, device, r); } catch (e) { log(tag, 'personalize failed:', e.message); st = null; }
    const g = r.guests.get(device);
    return { rev: r.rev, state: st, hostOnline: hostOnline(r), blocked: r.blocked.has(device), name: g?.name || '' };
  }
  function pushPhones(r, only = null) {
    for (const c of r.phones) if (!only || c.device === only) sse(c.res, 'state', phoneView(r, c.device));
  }
  function pushHostStatus(r) {
    const on = hostOnline(r);
    if (r.lastHostOn === on) return;
    r.lastHostOn = on;
    for (const c of r.phones) sse(c.res, 'host', { hostOnline: on });
  }
  setInterval(() => { for (const r of rooms.values()) if (r.phones.size) pushHostStatus(r); }, 3000).unref?.();

  // a little flood protection per phone (and per address)
  const hits = new Map();
  function limited(key, max, win) {
    const now = Date.now();
    const h = (hits.get(key) || []).filter((t) => now - t < win);
    h.push(now); hits.set(key, h);
    if (hits.size > 5000) hits.clear();
    return h.length > max;
  }

  return async function route(req, res, url, { cfg, cors, json, readJson, originAllowed }) {
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (p === `/${name}`) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(page);
    }
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!originAllowed(req)) return json(res, 403, { error: `origin ${req.headers.origin} not allowed` });
    const q = url.searchParams;
    const sub = p.slice(`/api/${name}`.length);
    try {
      if (sub === '/info') {
        const pub = cfg[name]?.publicUrl || cfg.party?.publicUrl || cfg.tasks?.publicUrl || '';
        return json(res, 200, { app: `roundremote-${name}`, ips: lanIps(), port: req.socket.localPort, publicUrl: pub, boot: BOOT, rooms: rooms.size });
      }
      // ------------------------------------------------ display side
      if (sub === '/room' && req.method === 'POST') {
        const b = await readJson(req);
        const key = str(b.key, 64);
        if (key.length < 8) throw new HttpErr(400, 'key too short');
        const r = room(b.room);
        if (r.key && r.key !== key) throw new HttpErr(409, 'That room code is taken');
        if (!r.key) log(tag, `room ${r.code} opened`);
        r.key = key; r.hostSeen = Date.now();
        return json(res, 200, { ok: true, room: r.code, boot: BOOT, seq: r.seq });
      }
      if (sub === '/state' && req.method === 'PUT') {
        const b = await readJson(req);
        const r = room(b.room, { create: false });
        if (!r) throw new HttpErr(404, 'No such room');
        checkKey(r, b.key);
        const prev = r.state;
        r.state = b.state ?? null;
        r.blocked = new Set((Array.isArray(b.blocked) ? b.blocked : []).map(cleanDevice));
        r.rev++; r.hostSeen = Date.now();
        try { onState(r, r.state, prev); } catch (e) { log(tag, 'onState failed:', e.message); }
        pushPhones(r);
        pushHostStatus(r);
        return json(res, 200, { ok: true, rev: r.rev });
      }
      if (sub === '/reply' && req.method === 'POST') {
        const b = await readJson(req);
        const r = room(b.room, { create: false });
        if (!r) throw new HttpErr(404, 'No such room');
        checkKey(r, b.key);
        const dev = cleanDevice(b.device);
        let n = 0;
        for (const c of r.phones) if (c.device === dev) { sse(c.res, 'reply', b.data ?? null); n++; }
        // phones that poll pick it up from here
        r.data.replies ||= new Map();
        r.data.replies.set(dev, [...(r.data.replies.get(dev) || []).slice(-9), { at: Date.now(), data: b.data ?? null }]);
        return json(res, 200, { ok: true, delivered: n });
      }
      if (sub === '/host' || sub === '/inbox') {
        const r = room(q.get('room'), { create: false });
        if (!r) throw new HttpErr(404, 'No such room');
        checkKey(r, q.get('key'));
        r.hostSeen = Date.now();
        let since = Math.max(+q.get('since') || 0, +req.headers['last-event-id'] || 0);
        if (q.get('boot') && q.get('boot') !== BOOT && !req.headers['last-event-id']) since = 0;
        const backlog = r.inbox.filter((a) => a.seq > since);
        if (sub === '/inbox') {
          pushHostStatus(r);
          return json(res, 200, { boot: BOOT, seq: r.seq, acts: backlog, phones: r.phones.size });
        }
        sseHead(res);
        sse(res, 'hello', { boot: BOOT, seq: r.seq, phones: r.phones.size });
        for (const a of backlog) sse(res, 'act', a, a.seq);
        const c = { res };
        r.hosts.add(c);
        pushHostStatus(r);
        req.on('close', () => { r.hosts.delete(c); r.hostSeen = Date.now(); setTimeout(() => pushHostStatus(r), 6500); });
        return;
      }
      // ------------------------------------------------ phone side
      if (sub === '/events' || (sub === '/state' && req.method === 'GET')) {
        const r = room(q.get('room'));
        const device = cleanDevice(q.get('device'));
        if (!device) throw new HttpErr(400, 'missing device');
        if (sub === '/state') {
          const out = phoneView(r, device);
          const reps = r.data.replies?.get(device);
          const since = +q.get('replies') || 0;
          if (reps) out.replies = reps.filter((x) => x.at > since);
          return json(res, 200, out);
        }
        sseHead(res);
        sse(res, 'state', phoneView(r, device));
        const c = { res, device };
        r.phones.add(c);
        req.on('close', () => r.phones.delete(c));
        return;
      }
      if (sub === '/act' && req.method === 'POST') {
        const raw = await readJson(req);
        if (JSON.stringify(raw).length > MAX_ACT) throw new HttpErr(413, 'Too long');
        const r = room(raw.room);
        const device = cleanDevice(raw.device);
        if (!device) throw new HttpErr(400, 'missing device');
        const ip = req.socket.remoteAddress || '';
        if (limited(`${name}:${device}`, 25, 10000) || limited(`${name}@${ip}`, 240, 60000)) throw new HttpErr(429, 'Slow down a little');
        if (r.blocked.has(device)) throw new HttpErr(403, 'blocked');
        const type = str(raw.type, 24).replace(/[^\w-]/g, '');
        if (!type) throw new HttpErr(400, 'missing type');
        const nm = str(raw.name, 40);
        const g = r.guests.get(device) || { device, first: Date.now() };
        if (nm) g.name = nm;
        g.last = Date.now(); r.guests.set(device, g);
        const { room: _r, device: _d, name: _n, type: _t, key: _k, ...payload } = raw;
        const act = { ...payload, type, device, name: g.name || '', at: Date.now(), hr: nowHr() };
        const extra = (await accept(r, act, { key: raw.key, hostOnline: hostOnline(r) })) || {};
        if (act.drop) return json(res, 200, { ok: true, ...extra });   // handled by the bridge alone
        act.seq = ++r.seq;
        r.inbox.push(act);
        if (r.inbox.length > MAX_INBOX) r.inbox.splice(0, r.inbox.length - MAX_INBOX);
        for (const c of r.hosts) sse(c.res, 'act', act, act.seq);
        return json(res, 200, { ok: true, seq: act.seq, hostOnline: hostOnline(r), ...extra });
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      if (!res.headersSent) return json(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 400, { error: e.message });
      try { res.end(); } catch {}
    }
  };
}

// ---------------------------------------------------------------- the phone pages' shared shell
// Every party page is one self-contained HTML document: shared styles + the app's own, a header with the room code,
// the EN / עב switch and a connection dot, a "what's your name" card, and a tiny client (P) that keeps an
// EventSource open (re-opening it after the phone sleeps, falling back to polling) and posts actions.
const esc = (s) => String(s).replace(/</g, '\\u003c');
export function phonePage({ app, title, he, color, glyph, css = '', body = '', i18n = {}, script = '', needsName = true }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<meta name="theme-color" content="#14111c"><meta name="color-scheme" content="dark light">
<title>${title}</title>
<style>
:root{--bg:#14111c;--card:#1f1a2b;--card2:#2a2339;--fg:#f6f3fb;--muted:#b3abc6;--dim:#7d7493;--line:#382f4b;--c:${color};--on-c:#fff;--ok:#34d399;--err:#ff6b7d;--warn:#fbbf24}
@media (prefers-color-scheme:light){:root{--bg:#f6f3fb;--card:#fff;--card2:#efeaf7;--fg:#1d1729;--muted:#5d5470;--dim:#8f86a3;--line:#e2dcec}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 Inter,Rubik,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
body{padding:max(14px,env(safe-area-inset-top)) 16px max(40px,env(safe-area-inset-bottom));max-width:560px;margin:0 auto;min-height:100vh;min-height:100dvh}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none;touch-action:manipulation}
header{display:flex;align-items:center;gap:10px;margin:2px 2px 14px}
.logo{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:var(--c);color:var(--on-c);font-weight:800;font-size:20px;flex:none;box-shadow:0 4px 18px color-mix(in srgb,var(--c) 40%,transparent)}
h1{font-size:19px;margin:0;line-height:1.15}
.sub{color:var(--muted);font-size:13px;display:flex;align-items:center;gap:6px}
.code{font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:700;letter-spacing:.08em;color:var(--fg)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--dim);display:inline-block}
.dot.ok{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 25%,transparent)} .dot.warn{background:var(--warn)} .dot.err{background:var(--err)}
.lang{margin-inline-start:auto;padding:7px 13px;border-radius:99px;background:var(--card2);font-weight:700;font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:16px;margin-bottom:14px}
label.l{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:0 0 8px}
.in{width:100%;padding:14px 16px;border-radius:14px;border:1px solid var(--line);background:var(--card2);outline:none;font-size:17px;unicode-bidi:plaintext}
.in:focus{border-color:var(--c)}
.big{width:100%;padding:15px;border-radius:99px;background:var(--c);color:var(--on-c);font-weight:800;font-size:17px;margin-top:12px;transition:transform .15s,opacity .2s}
.big:active{transform:scale(.97)} .big:disabled{opacity:.45}
.ghost{padding:9px 14px;border-radius:99px;background:var(--card2);font-weight:700;font-size:14px;color:var(--fg)}
.hi{display:flex;align-items:center;gap:8px;margin:0 2px 12px;color:var(--muted);font-size:15px}
.hi b{color:var(--fg)} .hi button{color:var(--c);font-weight:700;font-size:14px;padding:4px 6px}
.banner{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:14px;background:color-mix(in srgb,var(--warn) 16%,var(--card));border:1px solid color-mix(in srgb,var(--warn) 40%,transparent);margin-bottom:12px;font-size:14px;font-weight:600}
.banner.err{background:color-mix(in srgb,var(--err) 14%,var(--card));border-color:color-mix(in srgb,var(--err) 40%,transparent)}
.empty{color:var(--dim);text-align:center;padding:22px 10px}
.toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translate(-50%,20px);opacity:0;background:var(--fg);color:var(--bg);padding:11px 20px;border-radius:99px;font-weight:700;transition:.25s;pointer-events:none;z-index:20;max-width:90%;text-align:center}
.toast.show{opacity:1;transform:translate(-50%,0)} .toast.err{background:var(--err);color:#fff}
.spin{width:22px;height:22px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--c);animation:spin .8s linear infinite;display:inline-block;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pop{from{transform:scale(.94);opacity:0}}
[hidden]{display:none!important}
[dir=auto]{unicode-bidi:plaintext}
${css}
</style></head>
<body>
<header><div class="logo">${glyph}</div><div><h1 data-t="title"></h1><div class="sub"><span class="dot" id="dot"></span><span data-t="room"></span> <span class="code" id="code"></span></div></div><button class="lang" id="lang"></button></header>
<div class="banner" id="banner" hidden></div>
<section class="card" id="nameCard" hidden>
  <label class="l" for="name" data-t="yourName"></label>
  <input class="in" id="name" maxlength="40" autocomplete="nickname" dir="auto" enterkeyhint="go">
  <button class="big" id="nameGo" data-t="continue"></button>
</section>
<main id="main" hidden>
${body}
</main>
<div class="toast" id="toast"></div>
<script>
(() => {
const APP = ${JSON.stringify(app)}, NEEDS_NAME = ${needsName ? 'true' : 'false'};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const q = new URLSearchParams(location.search);
const room = (q.get('r') || q.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const ls = { get: (k) => { try { return localStorage.getItem('rrparty.' + k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('rrparty.' + k, v); } catch {} } };
let device = ls.get('device'); if (!device) { device = 'p' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4); ls.set('device', device); }
const COMMON = {
  en: { room: 'Room', yourName: 'What’s your name?', continue: 'Let’s go', hi: 'Hi,', change: 'change', noName: 'Type your name first',
    offline: 'Can’t reach the bridge — check you’re on the same Wi-Fi', reconnecting: 'Reconnecting…', noHost: 'The display isn’t connected right now — open the app on the round screen.',
    blocked: 'The host has paused your requests.', noRoom: 'Scan the QR code on the display to join.', slow: 'Slow down a little' },
  he: { room: 'חדר', yourName: 'איך קוראים לך?', continue: 'יאללה', hi: 'היי,', change: 'שינוי', noName: 'קודם כתבו את השם',
    offline: 'אין חיבור לגשר — בדקו שאתם על אותה רשת Wi-Fi', reconnecting: 'מתחבר מחדש…', noHost: 'המסך לא מחובר כרגע — פתחו את האפליקציה במסך העגול.',
    blocked: 'המארח השהה את הבקשות שלך.', noRoom: 'סרקו את קוד ה-QR שעל המסך כדי להצטרף.', slow: 'לאט לאט…' },
};
const I18N = ${esc(JSON.stringify(i18n))};
let lang = ls.get('lang') || (/^(he|iw)/i.test(navigator.language || '') ? 'he' : 'en');
const t = (k, vars) => { let v = (I18N[lang] || {})[k] ?? (COMMON[lang] || {})[k] ?? (I18N.en || {})[k] ?? COMMON.en[k] ?? k; if (vars) v = String(v).replace(/\\{(\\w+)\\}/g, (_, x) => vars[x] ?? ''); return v; };
const listeners = { state: [], reply: [], render: [] };
const P = {
  room, device, get lang() { return lang; }, get name() { return ls.get('name') || ''; }, t, $, $$, ls,
  view: null, hostOnline: false, blocked: false, conn: 'connecting',
  on(ev, fn) { listeners[ev].push(fn); },
  toast(msg, err) { const el = $('#toast'); el.textContent = msg; el.className = 'toast show' + (err ? ' err' : ''); clearTimeout(P._tt); P._tt = setTimeout(() => el.className = 'toast', 2300); },
  el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k.startsWith('--')) e.style.setProperty(k, v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  },
  async act(type, data = {}) {
    const r = await fetch('/api/' + APP + '/act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, type, room, device, name: P.name }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error === 'blocked' ? t('blocked') : r.status === 429 ? t('slow') : (d.error || 'HTTP ' + r.status)); e.status = r.status; throw e; }
    return d;
  },
  vibrate(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} },
  beep(f = 880, d = 0.12, type = 'sine', v = 0.15) {
    try { const A = P._ac || (P._ac = new (window.AudioContext || window.webkitAudioContext)()); const o = A.createOscillator(), g = A.createGain(); o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(v, A.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, A.currentTime + d); o.connect(g); g.connect(A.destination); o.start(); o.stop(A.currentTime + d + 0.02); } catch {}
  },
  render() { render(); },
};
window.P = P;
function setConn(c) { P.conn = c; banner(); }
function banner() {
  const b = $('#banner'), dot = $('#dot');
  let msg = '', err = false;
  if (!room) { msg = t('noRoom'); err = true; }
  else if (P.conn === 'down') { msg = t('offline'); err = true; }
  else if (P.conn === 'retry') msg = t('reconnecting');
  else if (P.blocked) { msg = t('blocked'); err = true; }
  else if (P.view && !P.hostOnline) msg = t('noHost');
  b.hidden = !msg; b.textContent = msg; b.className = 'banner' + (err ? ' err' : '');
  dot.className = 'dot ' + (P.conn === 'ok' && P.hostOnline ? 'ok' : P.conn === 'down' ? 'err' : 'warn');
}
function ingest(d) {
  if (!d) return;
  if ('hostOnline' in d) P.hostOnline = !!d.hostOnline;
  if ('blocked' in d) P.blocked = !!d.blocked;
  if ('state' in d) { P.view = d.state; for (const f of listeners.state) try { f(d.state); } catch (e) { console.error(e); } }
  banner();
}
function render() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  $$('[data-t]').forEach((el) => el.textContent = t(el.dataset.t));
  $$('[data-tp]').forEach((el) => el.placeholder = t(el.dataset.tp));
  $('#lang').textContent = lang === 'he' ? 'EN' : 'עב';
  $('#code').textContent = room || '—';
  const named = !NEEDS_NAME || !!P.name;
  $('#nameCard').hidden = named || !room; $('#main').hidden = !named || !room;
  const who = $('#who'); if (who) who.textContent = P.name;
  banner();
  for (const f of listeners.render) try { f(); } catch (e) { console.error(e); }
}
// ---- connection: EventSource first, polling as a fallback, re-opened when the phone wakes up
let es = null, pollT = 0, errs = 0, lastReply = 0, alive = 0;
function connect() {
  if (!room) return;
  try { es && es.close(); } catch {}
  es = null; clearTimeout(pollT);
  if (!window.EventSource || errs > 4) return poll();
  es = new EventSource('/api/' + APP + '/events?room=' + room + '&device=' + device);
  es.addEventListener('state', (e) => { errs = 0; alive = Date.now(); setConn('ok'); ingest(JSON.parse(e.data)); });
  es.addEventListener('host', (e) => { alive = Date.now(); ingest(JSON.parse(e.data)); });
  es.addEventListener('reply', (e) => { alive = Date.now(); const d = JSON.parse(e.data); for (const f of listeners.reply) try { f(d); } catch (x) { console.error(x); } });
  es.onopen = () => { errs = 0; alive = Date.now(); setConn('ok'); };
  es.onerror = () => { errs++; setConn(errs > 2 ? 'down' : 'retry'); if (es && es.readyState === 2) { es = null; setTimeout(connect, 1500 + errs * 500); } };
}
async function poll() {
  clearTimeout(pollT);
  try {
    const r = await fetch('/api/' + APP + '/state?room=' + room + '&device=' + device + '&replies=' + lastReply, { cache: 'no-store' });
    const d = await r.json();
    setConn('ok'); ingest(d);
    for (const x of d.replies || []) { lastReply = Math.max(lastReply, x.at); for (const f of listeners.reply) try { f(x.data); } catch {} }
    errs = Math.min(errs, 5);
  } catch { setConn('down'); }
  pollT = setTimeout(() => { if (errs > 4 && window.EventSource && Math.random() < 0.15) { errs = 0; connect(); } else poll(); }, 1500);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (!es || es.readyState !== 1)) { errs = 0; connect(); } });
setInterval(() => { if (es && es.readyState === 1 && Date.now() - alive > 40000) connect(); }, 10000);
P.reconnect = connect;
// ---- name
$('#lang').onclick = () => { lang = lang === 'he' ? 'en' : 'he'; ls.set('lang', lang); render(); };
$('#name').value = P.name;
$('#nameGo').onclick = () => { const v = $('#name').value.trim(); if (!v) return P.toast(t('noName'), true); ls.set('name', v.slice(0, 40)); render(); P.act('join').catch(() => {}); };
$('#name').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#nameGo').click(); } };   // (no stray newline in the box that gets the focus)
document.addEventListener('click', (e) => { if (e.target.closest('#rename')) { ls.set('name', ''); $('#name').value = ''; render(); $('#name').focus(); } });
(${typeof script === 'function' ? script.toString() : 'function(){' + script + '}'})();
render(); connect();
if (P.name && room) P.act('join').catch(() => {});
})();
</script>
</body></html>`;
}
