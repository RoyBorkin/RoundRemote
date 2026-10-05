// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Truths, dares & tasks for the Tasks / Truth or Dare apps — players add their own from their phones.
//   GET  /tasks?s=<session>          a small mobile page (players scan the QR code on the round display)
//   GET  /api/tasks/info             { ips, port, publicUrl, rev, count } — the display builds the QR link from this
//   GET  /api/tasks?since=<rev>      items changed after <rev> (tombstones included): { rev, items }
//        &session=<id>               …only that session's live items (the phone page's list)
//   POST /api/tasks                  add one item { type, text, author, tags, session } or sync many { items: [...] }
//   PUT  /api/tasks/<id>             edit { text, type, tags }  (tag '18+' = adults only: hidden until 18+ mode is on)
//   DELETE /api/tasks/<id>           delete (kept as a tombstone so every display learns about it)
// Displays also sync their edits of the built-in starter items (e.g. one marked 18+) as overrides under the item's
// own b:<lang>:… id (GET answers `overrides: true` so a display knows this bridge keeps them); phones never see those.
// Everything is kept forever in bridge/tasks.json (config: "tasks": { "file": "tasks.json", "publicUrl": "" }).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { log } from './util.js';

const TYPES = new Set(['truth', 'dare', 'task']);
const MAX_TEXT = 300, MAX_ITEMS = 50000;
let db = null, file = null;

function load(cfg, dir) {
  if (db) return;
  file = path.resolve(dir, cfg.tasks?.file || 'tasks.json');
  db = { version: 1, rev: 0, items: {} };
  try {
    if (fs.existsSync(file)) {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (d && typeof d.items === 'object') db = { version: 1, rev: +d.rev || 0, items: d.items };
      log('tasks', `${Object.keys(db.items).length} items from ${file}`);
    }
  } catch (e) { log('tasks', `could not read ${file}: ${e.message} — starting a new list (the old file is kept as .bad)`); try { fs.copyFileSync(file, file + '.bad'); } catch {} }
}
function save() {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, file);
}

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
const newId = () => 't_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');

/** Validate and store one item; returns the stored item, or null when the stored copy is newer. */
function upsert(input, { fromDisplay = false } = {}) {
  const raw = String(input.id || '');
  // built-in overrides (b:<lang>:x?<t|d|k>:<n>) come only from a display's sync
  const id = /^[\w:.-]{4,48}$/.test(raw) && (!raw.startsWith('b:') || (fromDisplay && /^b:[a-z]{2}:x?[tdk]:\d{1,4}$/.test(raw)) || db.items[raw]) ? raw : null;
  const old = id ? db.items[id] : null;
  const now = Date.now();
  const updated = fromDisplay && +input.updated > 0 ? Math.min(+input.updated, now + 60000) : now;
  if (old && (old.updated || 0) > updated) return null;  // we already have a newer edit
  if (input.deleted) {
    if (!old) { if (!id) return null; }
    const item = { ...(old || { id, type: 'truth', text: '', author: '', tags: [], session: '', created: now }), deleted: true, updated, rev: ++db.rev };
    db.items[id] = item;
    return item;
  }
  const text = str(input.text, MAX_TEXT);
  const type = String(input.type || '').toLowerCase();
  if (!text) throw new Error('Write something first');
  if (!TYPES.has(type)) throw new Error('type must be truth, dare or task');
  if (!old && Object.keys(db.items).length >= MAX_ITEMS) throw new Error('The list is full');
  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : []).map((t) => str(t, 20).toLowerCase()).filter(Boolean))].slice(0, 8);
  const item = {
    id: id || newId(), type, text, tags,
    author: str(input.author ?? old?.author, 40),
    session: str(input.session ?? old?.session, 24).replace(/[^\w-]/g, ''),
    created: old?.created || (fromDisplay && +input.created > 0 ? Math.min(+input.created, now) : now),
    updated, rev: ++db.rev,
  };
  if (input.device || old?.device) item.device = str(old?.device || input.device, 40);  // the device that first added it (its phone may edit it)
  db.items[item.id] = item;
  return item;
}

// a little flood protection: 60 writes a minute per address
const hits = new Map();
function limited(req) {
  const ip = req.socket.remoteAddress || '';
  const now = Date.now();
  const h = (hits.get(ip) || []).filter((t) => now - t < 60000);
  h.push(now); hits.set(ip, h);
  return h.length > 60;
}

function lanIps() {
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

export async function route(req, res, url, { cfg, cors, json, readJson, originAllowed, dir }) {
  load(cfg, dir);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (p === '/tasks') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(PAGE);
  }
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!originAllowed(req)) return json(res, 403, { error: `origin ${req.headers.origin} not allowed` });
  try {
    if (p === '/api/tasks/info') {
      const live = Object.values(db.items).filter((i) => !i.deleted && !i.id.startsWith('b:')).length;
      return json(res, 200, { app: 'roundremote-tasks', ips: lanIps(), port: req.socket.localPort, publicUrl: cfg.tasks?.publicUrl || '', rev: db.rev, count: live });
    }
    if (p === '/api/tasks') {
      if (req.method === 'GET') {
        const since = +url.searchParams.get('since') || 0;
        const session = url.searchParams.get('session');
        let items = Object.values(db.items).filter((i) => (i.rev || 0) > since);
        if (session !== null) items = items.filter((i) => !i.deleted && i.session === session);
        items.sort((a, b) => a.rev - b.rev);
        return json(res, 200, { rev: db.rev, items, overrides: true });
      }
      if (req.method === 'POST') {
        if (limited(req)) return json(res, 429, { error: 'Slow down a little' });
        const body = await readJson(req);
        if (Array.isArray(body.items)) {  // a display syncing its own list
          const out = [];
          for (const it of body.items.slice(0, 500)) { try { const s = upsert(it, { fromDisplay: true }); if (s) out.push(s); } catch {} }
          if (out.length) save();
          return json(res, 200, { ok: true, rev: db.rev, items: out });
        }
        const item = upsert(body, { fromDisplay: !!body.fromDisplay });
        save();
        if (item) log('tasks', `+ ${item.type} by ${item.author || 'someone'}${item.session ? ` (session ${item.session})` : ''}`);
        return json(res, 200, { ok: true, rev: db.rev, item });
      }
      return json(res, 405, { error: 'method not allowed' });
    }
    const m = p.match(/^\/api\/tasks\/([\w:.-]+)$/);
    if (m) {
      const old = db.items[m[1]];
      if (!old) return json(res, 404, { error: 'no such item' });
      if (limited(req)) return json(res, 429, { error: 'Slow down a little' });
      if (req.method === 'DELETE') { const item = upsert({ id: old.id, deleted: true }); save(); return json(res, 200, { ok: true, rev: db.rev, item }); }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const b = await readJson(req);
        const item = upsert({ ...old, ...b, id: old.id, deleted: false, author: old.author, session: old.session });
        save();
        return json(res, 200, { ok: true, rev: db.rev, item });
      }
      if (req.method === 'GET') return json(res, 200, old);
      return json(res, 405, { error: 'method not allowed' });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
}

// ---------------------------------------------------------------- the phone page (self-contained)
const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#16121f">
<title>Truth or Dare — add yours</title>
<style>
:root{--bg:#16121f;--card:#221c30;--card2:#2c2540;--fg:#f6f3fb;--muted:#b3abc6;--dim:#7d7493;--line:#3a3150;
--truth:#60a5fa;--dare:#f472b6;--task:#a78bfa;--ok:#34d399;--err:#ff6b7d;--c:var(--truth)}
@media (prefers-color-scheme:light){:root{--bg:#f6f3fb;--card:#fff;--card2:#efeaf7;--fg:#1d1729;--muted:#5d5470;--dim:#8f86a3;--line:#e2dcec;--truth:#2563eb;--dare:#db2777;--task:#7c3aed}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 Inter,Rubik,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
body{padding:max(16px,env(safe-area-inset-top)) 16px 40px;max-width:560px;margin:0 auto}
button,input,textarea{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none}
header{display:flex;align-items:center;gap:10px;margin:4px 2px 16px}
.logo{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,var(--truth),var(--dare));color:#fff;font-weight:800;font-size:15px;flex:none}
h1{font-size:19px;margin:0;line-height:1.15}
.sub{color:var(--muted);font-size:13px}
.code{font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:700;letter-spacing:.08em;color:var(--fg)}
.lang{margin-inline-start:auto;padding:6px 12px;border-radius:99px;background:var(--card2);font-weight:700;font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:16px;margin-bottom:14px}
label.l{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:0 0 8px}
.in{width:100%;padding:14px 16px;border-radius:14px;border:1px solid var(--line);background:var(--card2);outline:none;font-size:17px}
.in:focus{border-color:var(--c)}
textarea.in{min-height:110px;resize:vertical;unicode-bidi:plaintext}
.big{width:100%;padding:15px;border-radius:99px;background:var(--c);color:#fff;font-weight:800;font-size:17px;margin-top:12px;transition:transform .15s,opacity .2s}
.big:active{transform:scale(.97)} .big:disabled{opacity:.45}
.hi{display:flex;align-items:center;gap:8px;margin:0 2px 12px;color:var(--muted);font-size:15px}
.hi b{color:var(--fg)} .hi button{color:var(--c);font-weight:700;font-size:14px;padding:4px 6px}
.seg{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;background:var(--card2);padding:5px;border-radius:99px;margin-bottom:14px}
.seg button{padding:11px 4px;border-radius:99px;font-weight:800;color:var(--muted);transition:background .2s,color .2s}
.seg button.on{background:var(--k);color:#fff}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.chip{padding:7px 13px;border-radius:99px;border:1px solid var(--line);background:var(--card2);font-size:14px;font-weight:600;color:var(--muted)}
.chip.on{background:color-mix(in srgb,var(--c) 22%,transparent);border-color:var(--c);color:var(--fg)}
.count{float:inline-end;font-size:12px;color:var(--dim);margin-top:6px}
.tabs{display:flex;gap:8px;margin:20px 2px 10px;align-items:center}
.tabs h2{font-size:16px;margin:0}
.tabs .chip{padding:5px 11px;font-size:13px}
.item{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:16px;margin-bottom:8px}
.item.new{animation:pop .35s ease}
@keyframes pop{from{transform:scale(.96);opacity:0}}
.badge{flex:none;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:4px 8px;border-radius:99px;color:#fff;background:var(--k);margin-top:2px}
.item .t{flex:1;min-width:0;unicode-bidi:plaintext;word-wrap:break-word}
.item .m{font-size:12px;color:var(--dim);margin-top:3px}
.item .x{flex:none;width:30px;height:30px;border-radius:50%;color:var(--dim);font-size:18px;line-height:30px}
.adult{display:flex;align-items:center;gap:12px;margin-top:14px;padding:12px 14px;border-radius:14px;background:var(--card2);border:1px solid var(--line);cursor:pointer;user-select:none}
.adult input{appearance:none;-webkit-appearance:none;flex:none;width:24px;height:24px;margin:0;border-radius:7px;border:2px solid var(--dim);display:grid;place-items:center;transition:.15s}
.adult input:checked{background:var(--err);border-color:var(--err)}
.adult input:checked::after{content:'';width:6px;height:11px;border:solid #fff;border-width:0 3px 3px 0;transform:translateY(-1px) rotate(45deg)}
.adult b{color:var(--err);font-weight:800}
.adult .h{display:block;font-size:12px;color:var(--dim);margin-top:1px}
.adult.on{border-color:color-mix(in srgb,var(--err) 60%,transparent)}
.a18{flex:none;align-self:center;font-size:12px;font-weight:800;padding:5px 9px;border-radius:99px;border:1.5px dashed var(--dim);color:var(--dim)}
.a18.on{border-style:solid;border-color:var(--err);background:var(--err);color:#fff}
span.a18{border-style:solid;border-color:var(--err);color:var(--err);padding:2px 7px;font-size:11px}
.empty{color:var(--dim);text-align:center;padding:20px}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);opacity:0;background:var(--fg);color:var(--bg);padding:11px 20px;border-radius:22px;width:max-content;font-weight:700;transition:.25s;pointer-events:none;z-index:9;max-width:90%;text-align:center}
.toast.show{opacity:1;transform:translate(-50%,0)} .toast.err{background:var(--err);color:#fff}
[hidden]{display:none!important}
</style></head>
<body>
<header><div class="logo">T|D</div><div><h1 data-t="title"></h1><div class="sub"><span data-t="session"></span> <span class="code" id="code"></span></div></div><button class="lang" id="lang"></button></header>

<section class="card" id="nameCard" hidden>
  <label class="l" for="name" data-t="yourName"></label>
  <input class="in" id="name" maxlength="40" autocomplete="nickname" dir="auto">
  <button class="big" id="nameGo" data-t="continue"></button>
</section>

<main id="main" hidden>
  <div class="hi"><span data-t="hi"></span> <b id="who" dir="auto"></b><button id="rename" data-t="change"></button></div>
  <section class="card">
    <div class="seg" id="types"></div>
    <textarea class="in" id="text" maxlength="${MAX_TEXT}" dir="auto"></textarea>
    <div class="count" id="cnt"></div>
    <div class="chips" id="tags"></div>
    <label class="adult" id="adultRow"><input type="checkbox" id="adultChk"><span><b>18+</b> <span data-t="adultOnly"></span><span class="h" data-t="adultHint"></span></span></label>
    <button class="big" id="add" disabled></button>
  </section>
  <div class="tabs"><h2 data-t="list"></h2><span style="flex:1"></span><button class="chip on" data-f="all"></button><button class="chip" data-f="mine"></button></div>
  <div id="list"></div>
</main>
<div class="toast" id="toast"></div>
<script>
(() => {
const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const session = (q.get('s') || '').replace(/[^\\w-]/g, '').slice(0, 24);
const adult = q.get('x') === '1';
const ls = { get: (k) => { try { return localStorage.getItem('rrtasks.' + k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('rrtasks.' + k, v); } catch {} } };
let device = ls.get('device'); if (!device) { device = 'd' + Math.random().toString(36).slice(2, 12); ls.set('device', device); }
const T = {
  en: { title: 'Truth or Dare', session: 'Session', yourName: 'What’s your name?', continue: 'Let’s go', hi: 'Hi,', change: 'change',
    truth: 'Truth', dare: 'Dare', task: 'Task', addT: 'Add truth', addD: 'Add dare', addK: 'Add task',
    phT: 'Ask a question everyone has to answer honestly…', phD: 'Dare someone to do something fun…', phK: 'A challenge for the whole group…',
    family: 'Family', party: 'Party', funny: 'Funny', active: 'Active', '18+': '18+',
    adultOnly: 'adults only', adultHint: adult ? 'Only drawn while the display’s 18+ mode is on' : 'Hidden on the display until its 18+ mode is turned on',
    mark18: 'Mark as 18+ (adults only)', hidden18: 'Marked 18+ — hidden until the display’s 18+ mode is on',
    list: 'Added this game', listAll: 'Recently added', all: 'Everyone', mine: 'Mine', added: 'Added! It’s on the display now ✓', none: 'Nothing yet — be the first!',
    noName: 'Type your name first', offline: 'Can’t reach the display’s bridge', del: 'Delete this?', ago: (m) => m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago' },
  he: { title: 'אמת או חובה', session: 'משחק', yourName: 'איך קוראים לך?', continue: 'יאללה', hi: 'היי,', change: 'שינוי',
    truth: 'אמת', dare: 'חובה', task: 'משימה', addT: 'הוסף אמת', addD: 'הוסף חובה', addK: 'הוסף משימה',
    phT: 'שאלה שכולם צריכים לענות עליה בכנות…', phD: 'אתגר מישהו לעשות משהו כיף…', phK: 'משימה לכל הקבוצה…',
    family: 'משפחה', party: 'מסיבה', funny: 'מצחיק', active: 'תנועה', '18+': '18+',
    adultOnly: 'למבוגרים בלבד', adultHint: adult ? 'יוגרל רק כשמצב 18+ פועל במסך' : 'מוסתר במסך עד שמפעילים בו מצב 18+',
    mark18: 'סימון כ-18+ (למבוגרים בלבד)', hidden18: 'סומן 18+ — מוסתר עד שמצב 18+ פועל במסך',
    list: 'נוספו במשחק הזה', listAll: 'נוספו לאחרונה', all: 'כולם', mine: 'שלי', added: 'נוסף! זה כבר על המסך ✓', none: 'עוד אין כלום — תהיו הראשונים!',
    noName: 'קודם כתבו את השם', offline: 'אין חיבור לגשר של המסך', del: 'למחוק?', ago: (m) => m < 1 ? 'עכשיו' : m < 60 ? 'לפני ' + m + ' דק׳' : 'לפני ' + Math.round(m / 60) + ' שע׳' },
};
let lang = ls.get('lang') || (/^(he|iw)/i.test(navigator.language || '') ? 'he' : 'en');
const t = (k) => T[lang][k] ?? T.en[k] ?? k;
const COL = { truth: 'var(--truth)', dare: 'var(--dare)', task: 'var(--task)' };
let type = ls.get('type') || 'truth', tags = new Set(), filter = 'all', rev = 0, items = new Map(), busy = false;
const seen = new Set();  // ids already on screen: only rows that are new get the pop-in animation (no flicker on refresh)
const TAGS = ['family', 'party', 'funny', 'active'];
const ADULT = /^(18\\+?|adults?|nsfw)$/i;
const isAdult = (i) => (i.tags || []).some((x) => ADULT.test(x));
const adultTags = (list, on) => { const rest = list.filter((x) => !ADULT.test(x)); return on ? rest.filter((x) => x !== 'family').concat('18+') : (rest.length ? rest : ['family']); };

function toast(msg, err) { const el = $('#toast'); el.textContent = msg; el.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => el.className = 'toast', 2200); }
function render() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((el) => el.textContent = t(el.dataset.t));
  $('#lang').textContent = lang === 'he' ? 'EN' : 'עב';
  $('#code').textContent = session || '—';
  document.querySelector('[data-t="list"]').textContent = session ? t('list') : t('listAll');
  document.querySelectorAll('[data-f]').forEach((b) => { b.textContent = t(b.dataset.f); b.classList.toggle('on', b.dataset.f === filter); });
  const name = ls.get('name') || '';
  $('#nameCard').hidden = !!name; $('#main').hidden = !name;
  $('#who').textContent = name;
  document.body.style.setProperty('--c', COL[type]);
  const seg = $('#types'); seg.textContent = '';
  for (const k of ['truth', 'dare', 'task']) {
    const b = document.createElement('button'); b.textContent = t(k); b.style.setProperty('--k', COL[k]); b.className = k === type ? 'on' : '';
    b.onclick = () => { type = k; ls.set('type', k); render(); }; seg.append(b);
  }
  $('#text').placeholder = t({ truth: 'phT', dare: 'phD', task: 'phK' }[type]);
  $('#add').textContent = t({ truth: 'addT', dare: 'addD', task: 'addK' }[type]);
  const tg = $('#tags'); tg.textContent = '';
  for (const k of TAGS) { const b = document.createElement('button'); b.className = 'chip' + (tags.has(k) ? ' on' : ''); b.textContent = t(k); b.onclick = () => { tags.has(k) ? tags.delete(k) : tags.add(k); render(); }; tg.append(b); }
  $('#adultRow').classList.toggle('on', $('#adultChk').checked);
  count(); list();
}
function count() { const n = $('#text').value.length; $('#cnt').textContent = n + ' / ${MAX_TEXT}'; $('#add').disabled = busy || !$('#text').value.trim(); }
function list() {
  const el = $('#list'); el.textContent = '';
  const arr = [...items.values()].filter((i) => !i.deleted && !String(i.id).startsWith('b:') && (filter === 'all' || i.device === device)
    && (adult || i.device === device || !isAdult(i)))  // others' 18+ items only while the display is in 18+ mode
    .sort((a, b) => b.created - a.created).slice(0, 200);
  if (!arr.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = t('none'); el.append(e); return; }
  for (const i of arr) {
    const row = document.createElement('div'); row.className = 'item' + (seen.has(i.id) ? '' : ' new'); seen.add(i.id); row.style.setProperty('--k', COL[i.type] || COL.task);
    const b = document.createElement('span'); b.className = 'badge'; b.textContent = t(i.type);
    const tx = document.createElement('div'); tx.className = 't';
    const p = document.createElement('div'); p.dir = 'auto'; p.textContent = i.text;
    const m = document.createElement('div'); m.className = 'm'; m.dir = 'auto';
    m.textContent = [i.author, t('ago')(Math.floor((Date.now() - i.created) / 60000)), ...(i.tags || []).filter((x) => x !== 'family' && !ADULT.test(x)).map((x) => '#' + x)].filter(Boolean).join(' · ');
    tx.append(p, m); row.append(b, tx);
    if (i.device === device) {  // your own items: tap 18+ to mark / unmark them
      const on = isAdult(i), a = document.createElement('button');
      a.className = 'a18' + (on ? ' on' : ''); a.textContent = '18+'; a.title = t('mark18'); a.setAttribute('aria-label', t('mark18')); a.setAttribute('aria-pressed', String(on));
      a.onclick = async () => {
        try {
          const d = await api('/api/tasks/' + encodeURIComponent(i.id), { method: 'PUT', body: JSON.stringify({ tags: adultTags(i.tags || [], !on) }) });
          if (d.item) items.set(d.item.id, d.item); list();
          if (!on && !adult) toast(t('hidden18'));
        } catch (e) { toast(e.message, true); }
      };
      row.append(a);
    } else if (isAdult(i)) { const a = document.createElement('span'); a.className = 'a18'; a.textContent = '18+'; row.append(a); }
    if (i.device === device) {
      const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', 'delete');
      x.onclick = async () => { if (!confirm(t('del'))) return; try { await api('/api/tasks/' + encodeURIComponent(i.id), { method: 'DELETE' }); items.delete(i.id); list(); } catch (e) { toast(e.message, true); } };
      row.append(x);
    }
    el.append(row);
  }
}
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}
async function poll() {
  try {
    const d = await api('/api/tasks?since=' + rev + (session ? '&session=' + encodeURIComponent(session) : ''));
    for (const i of d.items) items.set(i.id, i);
    if (!session && items.size > 200) { const keep = [...items.values()].sort((a, b) => b.created - a.created).slice(0, 200); items = new Map(keep.map((i) => [i.id, i])); }
    rev = d.rev; list();
  } catch {}
}
$('#lang').onclick = () => { lang = lang === 'he' ? 'en' : 'he'; ls.set('lang', lang); render(); };
$('#name').value = ls.get('name') || '';
$('#nameGo').onclick = () => { const v = $('#name').value.trim(); if (!v) return toast(t('noName'), true); ls.set('name', v.slice(0, 40)); render(); $('#text').focus(); };
$('#name').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#nameGo').click(); } };   // (no stray newline in the box that gets the focus)
$('#rename').onclick = () => { ls.set('name', ''); render(); $('#name').focus(); };
$('#text').oninput = count;
$('#adultChk').onchange = () => $('#adultRow').classList.toggle('on', $('#adultChk').checked);
document.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; render(); });
$('#add').onclick = async () => {
  const text = $('#text').value.trim(); if (!text || busy) return;
  busy = true; count();
  try {
    const x18 = $('#adultChk').checked, base = tags.size ? [...tags] : ['family'];
    const d = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ type, text, tags: x18 ? adultTags(base, true) : base, author: ls.get('name') || '', session, device }) });
    if (d.item) items.set(d.item.id, d.item);
    $('#text').value = ''; toast(x18 && !adult ? t('hidden18') : t('added')); list();
    if (navigator.vibrate) navigator.vibrate(20);
  } catch (e) { toast(/fetch|network/i.test(e.message) ? t('offline') : e.message, true); }
  busy = false; count();
};
render(); poll(); setInterval(poll, 4000);
})();
</script>
</body></html>`;
