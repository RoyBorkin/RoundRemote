// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The Tasks content manager's shared list: truths, dares & tasks (Truth or Dare), Never Have I Ever / Most Likely To
// prompts, Party Cards, Kings Cup rules (Drinking Games), trivia questions (Trivia Night) and the user's named lists —
// players add their own from their phones.
//   GET  /tasks?s=<session>[&type=<type>]  a small mobile page (players scan the QR code on the round display); type
//                                     preselects what they add: truth | dare | task | never | likely | party | kings | trivia
//   GET  /api/tasks/info             { ips, port, publicUrl, rev, count, types } — the display builds the QR link from this
//   GET  /api/tasks?since=<rev>      items changed after <rev> (tombstones included): { rev, items, types, overrides }
//        &session=<id>               …only that session's live items + every list (the phone page); `topics` = custom trivia topics
//   POST /api/tasks                  add one item { type, text, author, tags, session, lang, lists, … } or sync many { items: [...] }
//   PUT  /api/tasks/<id>             edit { text, type, tags, … }  (tag '18+' = adults only: hidden until 18+ mode is on)
//   DELETE /api/tasks/<id>           delete (kept as a tombstone so every display learns about it)
//   GET  /api/tasks/export?types=a,b the added entries of those types as a JSON file (lists by name)
//   POST /api/tasks/import           { items: [...] } from such a file — added as new entries (lists matched by name)
// Type fields: trivia { answer, wrong: [3], cat, d: 1-3 } · party { kind: e|p|d|g|v|r, end, turns } · kings { rank, title }
// · every type { lang: en|he, lists: [list ids] }. A list is an item { type: 'list', text: <name> }.
// Displays also sync their edits of the built-in entries (e.g. one marked 18+) as overrides under the entry's own
// b:<lang>:… id (GET answers `overrides: true` so a display knows this bridge keeps them); phones never see those.
// Everything is kept forever in <data dir>/tasks.json (config: "tasks": { "file": "tasks.json", "publicUrl": "" }).
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { log } from './util.js';
import { dataPath } from './paths.js';

const CONTENT = ['truth', 'dare', 'task', 'never', 'likely', 'party', 'kings', 'trivia'];
const TYPES = new Set([...CONTENT, 'list']);
const KINDS = ['e', 'p', 'd', 'g', 'v', 'r'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const MAX_TEXT = 300, MAX_ITEMS = 50000;
let db = null, file = null;

function load(cfg) {
  if (db) return;
  file = dataPath(cfg.tasks?.file || 'tasks.json');   // RR_DATA_DIR (the bridge folder, or /data in Docker)
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
const newId = (p = 't_') => p + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const isHe = (s) => /[֐-׿]/.test(s || '');

/** The type-specific fields of an item (validated), merged over the stored ones. */
function fields(type, input, old = {}) {
  const v = (k) => (input[k] !== undefined ? input[k] : old[k]);
  const out = {};
  const lang = v('lang');
  if (lang === 'en' || lang === 'he') out.lang = lang;
  const lists = v('lists');
  if (Array.isArray(lists)) { const l = [...new Set(lists.map((x) => str(x, 48)).filter((x) => /^l_[\w-]{4,44}$/.test(x)))].slice(0, 20); if (l.length) out.lists = l; }
  if (type === 'trivia') {
    out.answer = str(v('answer'), 120);
    if (!out.answer) throw new Error('Write the answer too');
    out.wrong = (Array.isArray(v('wrong')) ? v('wrong') : []).map((w) => str(w, 120)).filter(Boolean).slice(0, 3);
    out.cat = str(v('cat'), 40) || 'general';
    out.d = [1, 2, 3].includes(+v('d')) ? +v('d') : 2;
  } else if (type === 'party') {
    out.kind = KINDS.includes(v('kind')) ? v('kind') : 'e';
    const end = str(v('end'), 200); if (end && out.kind === 'r') out.end = end;
    const turns = Math.round(+v('turns') || 0); if (turns > 0 && out.kind === 'r') out.turns = Math.min(20, turns);
  } else if (type === 'kings') {
    out.rank = RANKS.includes(String(v('rank'))) ? String(v('rank')) : 'J';
    const title = str(v('title'), 40); if (title) out.title = title;
  }
  return out;
}

/** Validate and store one item; returns the stored item, or null when the stored copy is newer. */
function upsert(input, { fromDisplay = false } = {}) {
  const raw = String(input.id || '');
  // built-in overrides (b:<lang>:x?<letter>:<key>) come only from a display's sync
  const id = /^[\w:.-]{4,48}$/.test(raw) && (!raw.startsWith('b:') || (fromDisplay && /^b:[a-z]{2}:x?[a-z]{1,2}:[\w.]{1,30}$/.test(raw)) || db.items[raw]) ? raw : null;
  const old = id ? db.items[id] : null;
  const now = Date.now();
  const updated = fromDisplay && +input.updated > 0 ? Math.min(+input.updated, now + 60000) : now;
  if (old && (old.updated || 0) > updated) return null;  // we already have a newer edit
  if (input.deleted) {
    if (!old) { if (!id) return null; }
    const item = { ...(old || { id, type: TYPES.has(input.type) ? input.type : 'truth', text: '', author: '', tags: [], session: '', created: now }), deleted: true, updated, rev: ++db.rev };
    db.items[id] = item;
    return item;
  }
  const type = String(input.type || '').toLowerCase();
  if (!TYPES.has(type)) throw new Error(`type must be one of ${[...TYPES].join(', ')}`);
  const text = str(input.text, type === 'list' ? 40 : MAX_TEXT);
  if (!text) throw new Error('Write something first');
  if (!old && Object.keys(db.items).length >= MAX_ITEMS) throw new Error('The list is full');
  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : []).map((t) => str(t, 20).toLowerCase()).filter(Boolean))].slice(0, 8);
  const item = {
    id: id || newId(type === 'list' ? 'l_' : 't_'), type, text, tags,
    ...fields(type, input, old?.type === type ? old : {}),
    author: str(input.author ?? old?.author, 40),
    session: str(input.session ?? old?.session, 24).replace(/[^\w-]/g, ''),
    created: old?.created || (fromDisplay && +input.created > 0 ? Math.min(+input.created, now) : now),
    updated, rev: ++db.rev,
  };
  if (!item.lang && type !== 'list') item.lang = isHe(text) ? 'he' : 'en';
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

// custom trivia topics (for the phone page's topic picker), recomputed when the list changes
let topicsMemo = { rev: -1, list: [] };
function topics() {
  if (topicsMemo.rev === db.rev) return topicsMemo.list;
  const set = new Set();
  for (const i of Object.values(db.items)) if (i.type === 'trivia' && !i.deleted && i.cat && !i.id.startsWith('b:')) set.add(i.cat);
  topicsMemo = { rev: db.rev, list: [...set].sort().slice(0, 200) };
  return topicsMemo.list;
}
const liveLists = () => Object.values(db.items).filter((i) => i.type === 'list' && !i.deleted);

/** Add the items of an exported file (new ids; lists matched or created by name). */
function importItems(items, { session = '', device = '', author = '' } = {}) {
  const byName = new Map(liveLists().map((l) => [l.text.toLowerCase(), l.id]));
  const have = new Set(Object.values(db.items).filter((i) => !i.deleted).map((i) => `${i.type}|${String(i.text).trim().toLowerCase()}`));
  let added = 0, skipped = 0;
  for (const raw of items.slice(0, 5000)) {
    try {
      const type = String(raw?.type || '').toLowerCase();
      const text = raw?.text ?? raw?.q;
      if (!CONTENT.includes(type) || have.has(`${type}|${String(text || '').trim().toLowerCase()}`)) { skipped++; continue; }
      const lists = (Array.isArray(raw.lists) ? raw.lists : []).map((n) => {
        const name = str(n, 40); if (!name) return null;
        let lid = byName.get(name.toLowerCase());
        if (!lid) { lid = upsert({ type: 'list', text: name, author, session: '', device }).id; byName.set(name.toLowerCase(), lid); }
        return lid;
      }).filter(Boolean);
      upsert({ ...raw, id: undefined, type, text, answer: raw.answer ?? raw.a, wrong: raw.wrong ?? raw.w, lists, author: raw.author || author, session, device });
      have.add(`${type}|${String(text).trim().toLowerCase()}`);
      added++;
    } catch { skipped++; }
  }
  return { added, skipped };
}

export async function route(req, res, url, { cfg, cors, json, readJson, originAllowed }) {
  load(cfg);
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
      const live = Object.values(db.items).filter((i) => !i.deleted && !i.id.startsWith('b:') && i.type !== 'list').length;
      return json(res, 200, { app: 'roundremote-tasks', ips: lanIps(), port: req.socket.localPort, publicUrl: cfg.tasks?.publicUrl || '', rev: db.rev, count: live, types: [...TYPES] });
    }
    if (p === '/api/tasks/export') {
      const want = new Set(String(url.searchParams.get('types') || CONTENT.join(',')).split(',').filter((t) => CONTENT.includes(t)));
      const names = new Map(liveLists().map((l) => [l.id, l.text]));
      const items = Object.values(db.items).filter((i) => !i.deleted && !i.id.startsWith('b:') && want.has(i.type)).sort((a, b) => a.created - b.created)
        .map(({ id: _i, rev: _r, device: _d, session: _s, updated: _u, lists, ...i }) => ({ ...i, ...(lists?.length ? { lists: lists.map((l) => names.get(l)).filter(Boolean) } : {}) }));
      const body = JSON.stringify({ app: 'roundremote-tasks', version: 2, types: [...want], exported: new Date().toISOString(), items }, null, 1);
      const name = want.size === 1 ? [...want][0] : want.size === CONTENT.length ? 'all' : [...want].join('-');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="round-remote-${name}.json"`, 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    if (p === '/api/tasks/import') {
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      if (limited(req)) return json(res, 429, { error: 'Slow down a little' });
      const body = await readJson(req);
      const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : null;
      if (!items) return json(res, 400, { error: 'Not a Round Remote export (no items)' });
      const r = importItems(items, { session: str(body.session, 24).replace(/[^\w-]/g, ''), device: str(body.device, 40), author: str(body.author, 40) });
      if (r.added) { save(); log('tasks', `imported ${r.added} items`); }
      return json(res, 200, { ok: true, rev: db.rev, ...r });
    }
    if (p === '/api/tasks') {
      if (req.method === 'GET') {
        const since = +url.searchParams.get('since') || 0;
        const session = url.searchParams.get('session');
        let items = Object.values(db.items).filter((i) => (i.rev || 0) > since);
        if (session !== null) items = items.filter((i) => i.type === 'list' || (!i.deleted && i.session === session && !i.id.startsWith('b:')));
        items.sort((a, b) => a.rev - b.rev);
        return json(res, 200, { rev: db.rev, items, overrides: true, types: [...TYPES], topics: topics() });
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
<title>Round Remote — add yours</title>
<style>
:root{--bg:#16121f;--card:#221c30;--card2:#2c2540;--fg:#f6f3fb;--muted:#b3abc6;--dim:#7d7493;--line:#3a3150;--ok:#34d399;--err:#ff6b7d;--c:#60a5fa}
@media (prefers-color-scheme:light){:root{--bg:#f6f3fb;--card:#fff;--card2:#efeaf7;--fg:#1d1729;--muted:#5d5470;--dim:#8f86a3;--line:#e2dcec}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 Inter,Rubik,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
body{padding:max(16px,env(safe-area-inset-top)) 16px 40px;max-width:560px;margin:0 auto}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none}
header{display:flex;align-items:center;gap:10px;margin:4px 2px 16px}
.logo{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--c);color:#fff;font-weight:800;font-size:15px;flex:none;transition:background .3s}
h1{font-size:19px;margin:0;line-height:1.15}
.sub{color:var(--muted);font-size:13px}
.code{font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:700;letter-spacing:.08em;color:var(--fg)}
.lang{margin-inline-start:auto;padding:6px 12px;border-radius:99px;background:var(--card2);font-weight:700;font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:16px;margin-bottom:14px}
label.l{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:14px 0 7px}
label.l:first-child{margin-top:0}
.in{width:100%;padding:13px 15px;border-radius:14px;border:1px solid var(--line);background:var(--card2);outline:none;font-size:17px;unicode-bidi:plaintext}
.in:focus{border-color:var(--c)}
select.in{appearance:none;-webkit-appearance:none}
textarea.in{min-height:100px;resize:vertical}
.in+.in{margin-top:8px}
.pre{font-weight:800;color:var(--c);margin:0 2px 8px;font-size:15px}
.big{width:100%;padding:15px;border-radius:99px;background:var(--c);color:#fff;font-weight:800;font-size:17px;margin-top:14px;transition:transform .15s,opacity .2s}
.big:active{transform:scale(.97)} .big:disabled{opacity:.45}
.hi{display:flex;align-items:center;gap:8px;margin:0 2px 12px;color:var(--muted);font-size:15px}
.hi b{color:var(--fg)} .hi button{color:var(--c);font-weight:700;font-size:14px;padding:4px 6px}
.groups{display:flex;gap:6px;overflow-x:auto;margin:0 0 10px;scrollbar-width:none}
.groups button{flex:none;padding:8px 12px;border-radius:99px;background:var(--card2);font-weight:700;font-size:13.5px;color:var(--muted)}
.groups button.on{background:var(--fg);color:var(--bg)}
.seg{display:flex;gap:6px;background:var(--card2);padding:5px;border-radius:99px;margin-bottom:14px}
.seg button{flex:1;padding:10px 4px;border-radius:99px;font-weight:800;color:var(--muted);transition:background .2s,color .2s;font-size:14px;white-space:nowrap}
.seg button.on{background:var(--k);color:#fff}
.seg.sm{margin:0;padding:4px} .seg.sm button{padding:8px 4px;font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:7px 13px;border-radius:99px;border:1px solid var(--line);background:var(--card2);font-size:14px;font-weight:600;color:var(--muted)}
.chip.on{background:color-mix(in srgb,var(--c) 22%,transparent);border-color:var(--c);color:var(--fg)}
.chip.add{border-style:dashed}
.ranks{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.ranks .chip{padding:9px 0;text-align:center;font-weight:800}
.ins{display:flex;gap:8px;align-items:center;margin-top:8px;font-size:13px;color:var(--dim)}
.ins button{padding:5px 11px;border-radius:9px;background:var(--card2);font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:700;color:var(--fg)}
.count{text-align:end;font-size:12px;color:var(--dim);margin-top:4px}
.tabs{display:flex;gap:8px;margin:20px 2px 10px;align-items:center}
.tabs h2{font-size:16px;margin:0}
.tabs .chip{padding:5px 11px;font-size:13px}
.item{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:16px;margin-bottom:8px}
.item.new{animation:pop .35s ease}
@keyframes pop{from{transform:scale(.96);opacity:0}}
.badge{flex:none;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:4px 8px;border-radius:99px;color:#fff;background:var(--k);margin-top:2px;max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item .t{flex:1;min-width:0;unicode-bidi:plaintext;word-wrap:break-word}
.item .a{color:var(--ok);font-weight:700;font-size:14px;margin-top:2px}
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
.foot{text-align:center;margin-top:18px;font-size:13px;color:var(--dim)}
.foot button{color:var(--c);font-weight:700;padding:6px 8px;font-size:13px}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);opacity:0;background:var(--fg);color:var(--bg);padding:11px 20px;border-radius:22px;width:max-content;font-weight:700;transition:.25s;pointer-events:none;z-index:9;max-width:90%;text-align:center}
.toast.show{opacity:1;transform:translate(-50%,0)} .toast.err{background:var(--err);color:#fff}
[hidden]{display:none!important}
</style></head>
<body>
<header><div class="logo" id="logo">+</div><div><h1 id="title"></h1><div class="sub"><span data-t="session"></span> <span class="code" id="code"></span></div></div><button class="lang" id="lang"></button></header>

<section class="card" id="nameCard" hidden>
  <label class="l" for="name" data-t="yourName"></label>
  <input class="in" id="name" maxlength="40" autocomplete="nickname" dir="auto">
  <button class="big" id="nameGo" data-t="continue"></button>
</section>

<main id="main" hidden>
  <div class="hi"><span data-t="hi"></span> <b id="who" dir="auto"></b><button id="rename" data-t="change"></button></div>
  <div class="groups" id="groups"></div>
  <section class="card">
    <div class="seg" id="types"></div>
    <div class="pre" id="pre" dir="auto" hidden></div>
    <div id="kingsF" hidden><label class="l" data-t="rank"></label><div class="ranks" id="ranks"></div><label class="l" data-t="ruleName"></label><input class="in" id="title" maxlength="40" dir="auto"><label class="l" data-t="ruleDo"></label></div>
    <div id="partyF" hidden><div class="chips" id="kinds" style="margin-bottom:12px"></div></div>
    <textarea class="in" id="text" maxlength="${MAX_TEXT}" dir="auto"></textarea>
    <div class="count" id="cnt"></div>
    <div id="partyF2" hidden>
      <div class="ins"><span data-t="names"></span><button data-ins="{A}">{A}</button><button data-ins="{B}">{B}</button></div>
      <div id="ruleF" hidden><label class="l" data-t="ruleEnd"></label><input class="in" id="end" maxlength="200" dir="auto"><label class="l" data-t="ruleTurns"></label><div class="seg sm" id="turns"></div></div>
    </div>
    <div id="triviaF" hidden>
      <label class="l" data-t="answer"></label><input class="in" id="answer" maxlength="120" dir="auto">
      <label class="l" data-t="wrongs"></label><input class="in w" maxlength="120" dir="auto"><input class="in w" maxlength="120" dir="auto"><input class="in w" maxlength="120" dir="auto">
      <label class="l" data-t="topic"></label><select class="in" id="topic"></select><input class="in" id="newTopic" maxlength="40" dir="auto" hidden>
      <label class="l" data-t="diff"></label><div class="seg sm" id="diff"></div>
    </div>
    <div id="tagsF"><label class="l" data-t="tags"></label><div class="chips" id="tags"></div></div>
    <label class="l" data-t="language"></label><div class="seg sm" id="langSeg"></div>
    <label class="l" data-t="lists"></label><div class="chips" id="lists"></div>
    <label class="adult" id="adultRow"><input type="checkbox" id="adultChk"><span><b>18+</b> <span data-t="adultOnly"></span><span class="h" data-t="adultHint"></span></span></label>
    <button class="big" id="add" disabled></button>
  </section>
  <div class="tabs"><h2 data-t="list"></h2><span style="flex:1"></span><button class="chip on" data-f="all"></button><button class="chip" data-f="mine"></button></div>
  <div id="list"></div>
  <div class="foot"><button id="imp" data-t="import"></button><input type="file" id="file" accept=".json,application/json" hidden></div>
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
const GROUPS = { tod: ['truth', 'dare', 'task'], drinks: ['never', 'likely', 'party', 'kings'], trivia: ['trivia'] };
const COL = { truth: '#3b82f6', dare: '#db2777', task: '#7c3aed', never: '#db2777', likely: '#7c3aed', party: '#dc2626', kings: '#ca8a04', trivia: '#2563eb' };
const CATS = [['general', 'General knowledge', 'ידע כללי'], ['science', 'Science & nature', 'מדע וטבע'], ['geo', 'Geography', 'גאוגרפיה'], ['history', 'History', 'היסטוריה'], ['music', 'Music', 'מוזיקה'],
  ['screen', 'Movies & TV', 'קולנוע וטלוויזיה'], ['sports', 'Sports', 'ספורט'], ['food', 'Food & drink', 'אוכל ושתייה'], ['tech', 'Tech', 'טכנולוגיה'], ['israel', 'Israel', 'ישראל']];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const T = {
  en: { session: 'Session', yourName: 'What’s your name?', continue: 'Let’s go', hi: 'Hi,', change: 'change',
    g_tod: 'Truth or Dare', g_drinks: 'Drinking games', g_trivia: 'Trivia',
    t_tod: 'Truth or Dare', t_drinks: 'Drinking games', t_trivia: 'Trivia Night',
    truth: 'Truth', dare: 'Dare', task: 'Task', never: 'Never', likely: 'Likely', party: 'Party', kings: 'Kings', trivia: 'Question',
    add_truth: 'Add truth', add_dare: 'Add dare', add_task: 'Add task', add_never: 'Add prompt', add_likely: 'Add prompt', add_party: 'Add card', add_kings: 'Add rule', add_trivia: 'Add question',
    ph_truth: 'Ask a question everyone has to answer honestly…', ph_dare: 'Dare someone to do something fun…', ph_task: 'A challenge for the whole group…',
    ph_never: '…been on a blind date', ph_likely: '…forget their own birthday', ph_party: 'Everyone wearing black takes a sip.', ph_kings: 'What happens when this card is drawn…', ph_trivia: 'Your question…',
    pre_never: 'Never have I ever…', pre_likely: 'Who’s most likely to…',
    k_e: 'Everyone', k_p: 'One player', k_d: 'Two players', k_g: 'Mini-game', k_v: 'Vote', k_r: 'Rule',
    names: 'Player names:', ruleEnd: 'When the rule ends (optional)', ruleTurns: 'Lasts', auto: 'Auto', cards: 'cards',
    rank: 'Card', ruleName: 'Rule name', ruleDo: 'What to do',
    answer: 'Correct answer', wrongs: 'Wrong answers (optional — 3 for multiple choice)', topic: 'Topic', newTopic: '+ New topic…', newTopicPh: 'Topic name', diff: 'Difficulty', easy: 'Easy', med: 'Medium', hard: 'Hard',
    tags: 'Tags', family: 'Family', party_t: 'Party', funny: 'Funny', active: 'Active', language: 'Language', lists: 'Lists (optional)', newList: '+ New list', newListQ: 'Name of the new list (e.g. Family night)',
    adultOnly: 'adults only', adultHint: adult ? 'Only used while the display’s 18+ mode is on' : 'Hidden on the display until its 18+ mode is turned on',
    mark18: 'Mark as 18+ (adults only)', hidden18: 'Marked 18+ — hidden until the display’s 18+ mode is on',
    list: 'Added this game', listAll: 'Recently added', all: 'Everyone', mine: 'Mine', added: 'Added! It’s on the display now ✓', none: 'Nothing yet — be the first!',
    noName: 'Type your name first', noAnswer: 'Write the answer too', offline: 'Can’t reach the display’s bridge', del: 'Delete this?',
    import: 'Import a JSON file…', imported: 'Imported {n} ✓', badFile: 'That isn’t a Round Remote export',
    ago: (m) => m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago' },
  he: { session: 'משחק', yourName: 'איך קוראים לך?', continue: 'יאללה', hi: 'היי,', change: 'שינוי',
    g_tod: 'אמת או חובה', g_drinks: 'משחקי שתייה', g_trivia: 'טריוויה',
    t_tod: 'אמת או חובה', t_drinks: 'משחקי שתייה', t_trivia: 'ערב טריוויה',
    truth: 'אמת', dare: 'חובה', task: 'משימה', never: 'אף פעם', likely: 'מי הכי', party: 'מסיבה', kings: 'מלכים', trivia: 'שאלה',
    add_truth: 'הוסף אמת', add_dare: 'הוסף חובה', add_task: 'הוסף משימה', add_never: 'הוספה', add_likely: 'הוספה', add_party: 'הוספת קלף', add_kings: 'הוספת חוק', add_trivia: 'הוספת שאלה',
    ph_truth: 'שאלה שכולם צריכים לענות עליה בכנות…', ph_dare: 'אתגר מישהו לעשות משהו כיף…', ph_task: 'משימה לכל הקבוצה…',
    ph_never: '…יצאתי לדייט עיוור', ph_likely: '…ישכח את יום ההולדת של עצמו', ph_party: 'כל מי שלובש שחור — לגימה.', ph_kings: 'מה קורה כששולפים את הקלף הזה…', ph_trivia: 'השאלה שלך…',
    pre_never: 'אף פעם לא…', pre_likely: 'מי הכי סביר ש…',
    k_e: 'כולם', k_p: 'שחקן אחד', k_d: 'שני שחקנים', k_g: 'משחקון', k_v: 'הצבעה', k_r: 'חוק',
    names: 'שמות שחקנים:', ruleEnd: 'כשהחוק נגמר (רשות)', ruleTurns: 'למשך', auto: 'אוטומטי', cards: 'קלפים',
    rank: 'קלף', ruleName: 'שם החוק', ruleDo: 'מה עושים',
    answer: 'התשובה הנכונה', wrongs: 'תשובות שגויות (רשות — 3 לשאלה אמריקאית)', topic: 'נושא', newTopic: '+ נושא חדש…', newTopicPh: 'שם הנושא', diff: 'רמת קושי', easy: 'קל', med: 'בינוני', hard: 'קשה',
    tags: 'תגיות', family: 'משפחה', party_t: 'מסיבה', funny: 'מצחיק', active: 'תנועה', language: 'שפה', lists: 'רשימות (רשות)', newList: '+ רשימה חדשה', newListQ: 'שם הרשימה החדשה (למשל ערב משפחה)',
    adultOnly: 'למבוגרים בלבד', adultHint: adult ? 'בשימוש רק כשמצב 18+ פועל במסך' : 'מוסתר במסך עד שמפעילים בו מצב 18+',
    mark18: 'סימון כ-18+ (למבוגרים בלבד)', hidden18: 'סומן 18+ — מוסתר עד שמצב 18+ פועל במסך',
    list: 'נוספו במשחק הזה', listAll: 'נוספו לאחרונה', all: 'כולם', mine: 'שלי', added: 'נוסף! זה כבר על המסך ✓', none: 'עוד אין כלום — תהיו הראשונים!',
    noName: 'קודם כתבו את השם', noAnswer: 'כתבו גם את התשובה', offline: 'אין חיבור לגשר של המסך', del: 'למחוק?',
    import: 'ייבוא קובץ JSON…', imported: 'יובאו {n} ✓', badFile: 'זה לא קובץ ייצוא של Round Remote',
    ago: (m) => m < 1 ? 'עכשיו' : m < 60 ? 'לפני ' + m + ' דק׳' : 'לפני ' + Math.round(m / 60) + ' שע׳' },
};
let lang = ls.get('lang') || (/^(he|iw)/i.test(navigator.language || '') ? 'he' : 'en');
const t = (k, o) => { let s = T[lang][k] ?? T.en[k] ?? k; if (o) for (const x in o) s = s.replace('{' + x + '}', o[x]); return s; };
const qType = String(q.get('type') || '').toLowerCase();
let type = Object.values(GROUPS).flat().includes(qType) ? qType : (ls.get('type') || 'truth');
const groupOf = (k) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(k)) || 'tod';
let tags = new Set(), filter = 'all', rev = 0, items = new Map(), busy = false, kind = 'e', rank = 'J', turns = 0, diff = 2, itemLang = '', langTouched = false, pickLists = new Set(), topicsX = [];
const seen = new Set();  // ids already on screen: only rows that are new get the pop-in animation (no flicker on refresh)
const TAGS = ['family', 'party', 'funny', 'active'];
const ADULT = /^(18\\+?|adults?|nsfw)$/i;
const HEB = /[\\u0590-\\u05FF]/;
const isAdult = (i) => (i.tags || []).some((x) => ADULT.test(x));
const adultTags = (list, on) => { const rest = list.filter((x) => !ADULT.test(x)); return on ? rest.filter((x) => x !== 'family').concat('18+') : (rest.length ? rest : ['family']); };
const mk = (tag, cls, text, on) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (on) e.onclick = on; return e; };

function toast(msg, err) { const el = $('#toast'); el.textContent = msg; el.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => el.className = 'toast', 2200); }
function seg(box, opts, cur, fn, col) { box.textContent = ''; for (const [v, l] of opts) { const b = mk('button', v === cur ? 'on' : '', l, () => fn(v)); b.style.setProperty('--k', col || 'var(--c)'); box.append(b); } }
function render() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((el) => el.textContent = t(el.dataset.t));
  const g = groupOf(type);
  $('#title').textContent = t('t_' + g); document.title = t('t_' + g);
  $('#lang').textContent = lang === 'he' ? 'EN' : 'עב';
  $('#code').textContent = session || '—';
  document.querySelector('[data-t="list"]').textContent = session ? t('list') : t('listAll');
  document.querySelectorAll('[data-f]').forEach((b) => { b.textContent = t(b.dataset.f); b.classList.toggle('on', b.dataset.f === filter); });
  const name = ls.get('name') || '';
  $('#nameCard').hidden = !!name; $('#main').hidden = !name;
  $('#who').textContent = name;
  document.body.style.setProperty('--c', COL[type]);
  const gb = $('#groups'); gb.textContent = '';
  for (const k of Object.keys(GROUPS)) gb.append(mk('button', k === g ? 'on' : '', t('g_' + k), () => { if (k !== g) { setType(GROUPS[k][0]); } }));
  $('#types').hidden = GROUPS[g].length < 2;
  seg($('#types'), GROUPS[g].map((k) => [k, t(k)]), type, setType, COL[type]);
  $('#pre').hidden = !(type === 'never' || type === 'likely'); $('#pre').textContent = t('pre_' + type);
  $('#kingsF').hidden = type !== 'kings'; $('#partyF').hidden = $('#partyF2').hidden = type !== 'party'; $('#triviaF').hidden = type !== 'trivia'; $('#tagsF').hidden = g !== 'tod';
  $('#ruleF').hidden = kind !== 'r';
  $('#text').placeholder = t('ph_' + type);
  $('#add').textContent = t('add_' + type);
  const rk = $('#ranks'); rk.textContent = ''; for (const r of RANKS) rk.append(mk('button', 'chip' + (r === rank ? ' on' : ''), r, () => { rank = r; render(); }));
  const kd = $('#kinds'); kd.textContent = ''; for (const k of ['e', 'p', 'd', 'g', 'v', 'r']) kd.append(mk('button', 'chip' + (k === kind ? ' on' : ''), t('k_' + k), () => { kind = k; render(); }));
  seg($('#turns'), [[0, t('auto')], [3, '3'], [5, '5'], [8, '8'], [12, '12']], turns, (v) => { turns = v; render(); });
  seg($('#diff'), [[1, t('easy')], [2, t('med')], [3, t('hard')]], diff, (v) => { diff = v; render(); });
  seg($('#langSeg'), [['en', 'English'], ['he', 'עברית']], curLang(), (v) => { itemLang = v; langTouched = true; render(); });
  fillTopics();
  const tg = $('#tags'); tg.textContent = '';
  for (const k of TAGS) tg.append(mk('button', 'chip' + (tags.has(k) ? ' on' : ''), t(k === 'party' ? 'party_t' : k), () => { tags.has(k) ? tags.delete(k) : tags.add(k); render(); }));
  drawLists();
  $('#adultRow').classList.toggle('on', $('#adultChk').checked);
  count(); list();
}
function curLang() { return langTouched ? itemLang : (HEB.test($('#text').value) ? 'he' : $('#text').value.trim() ? 'en' : lang); }
function setType(k) { type = k; ls.set('type', k); render(); }
function fillTopics() {
  const sel = $('#topic'), cur = sel.value || ls.get('topic') || 'general';
  sel.textContent = '';
  for (const [id, en, he] of CATS) { const o = mk('option', '', lang === 'he' ? he : en); o.value = id; sel.append(o); }
  for (const x of topicsX) { const o = mk('option', '', x); o.value = x; sel.append(o); }
  const n = mk('option', '', t('newTopic')); n.value = '__new'; sel.append(n);
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'general';
  $('#newTopic').hidden = sel.value !== '__new'; $('#newTopic').placeholder = t('newTopicPh');
}
function drawLists() {
  const box = $('#lists'); box.textContent = '';
  const ls2 = [...items.values()].filter((i) => i.type === 'list' && !i.deleted).sort((a, b) => a.text.localeCompare(b.text));
  for (const l of ls2) { const b = mk('button', 'chip' + (pickLists.has(l.id) ? ' on' : ''), l.text, () => { pickLists.has(l.id) ? pickLists.delete(l.id) : pickLists.add(l.id); drawLists(); }); b.dir = 'auto'; box.append(b); }
  box.append(mk('button', 'chip add', t('newList'), async () => {
    const name = (prompt(t('newListQ')) || '').trim(); if (!name) return;
    try { const d = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ type: 'list', text: name, author: ls.get('name') || '', device }) }); if (d.item) { items.set(d.item.id, d.item); pickLists.add(d.item.id); } drawLists(); } catch (e) { toast(e.message, true); }
  }));
}
function count() { const n = $('#text').value.length; $('#cnt').textContent = n + ' / ${MAX_TEXT}'; $('#add').disabled = busy || !$('#text').value.trim(); }
function list() {
  const el = $('#list'); el.textContent = '';
  const g = GROUPS[groupOf(type)];
  const arr = [...items.values()].filter((i) => !i.deleted && i.type !== 'list' && g.includes(i.type) && !String(i.id).startsWith('b:') && (filter === 'all' || i.device === device)
    && (adult || i.device === device || !isAdult(i)))  // others' 18+ items only while the display is in 18+ mode
    .sort((a, b) => b.created - a.created).slice(0, 200);
  if (!arr.length) { el.append(mk('div', 'empty', t('none'))); return; }
  for (const i of arr) {
    const row = mk('div', 'item' + (seen.has(i.id) ? '' : ' new')); seen.add(i.id); row.style.setProperty('--k', COL[i.type] || COL.task);
    const tx = mk('div', 't');
    const p = mk('div', '', (i.type === 'kings' ? i.rank + ' · ' + (i.title ? i.title + ' — ' : '') : '') + i.text); p.dir = 'auto';
    tx.append(p);
    if (i.type === 'trivia') { const a = mk('div', 'a', '✓ ' + i.answer); a.dir = 'auto'; tx.append(a); }
    const m = mk('div', 'm', [i.author, t('ago')(Math.floor((Date.now() - i.created) / 60000)), ...(i.tags || []).filter((x) => x !== 'family' && !ADULT.test(x)).map((x) => '#' + x)].filter(Boolean).join(' · ')); m.dir = 'auto';
    tx.append(m); row.append(mk('span', 'badge', t(i.type)), tx);
    if (i.device === device) {  // your own items: tap 18+ to mark / unmark them
      const on = isAdult(i), a = mk('button', 'a18' + (on ? ' on' : ''), '18+');
      a.title = t('mark18'); a.setAttribute('aria-label', t('mark18')); a.setAttribute('aria-pressed', String(on));
      a.onclick = async () => {
        try {
          const nt = groupOf(i.type) === 'tod' ? adultTags(i.tags || [], !on) : adultTags(i.tags || [], !on).filter((x) => x !== 'family');
          const d = await api('/api/tasks/' + encodeURIComponent(i.id), { method: 'PUT', body: JSON.stringify({ tags: nt }) });
          if (d.item) items.set(d.item.id, d.item); list();
          if (!on && !adult) toast(t('hidden18'));
        } catch (e) { toast(e.message, true); }
      };
      row.append(a);
      const x = mk('button', 'x', '✕'); x.setAttribute('aria-label', 'delete');
      x.onclick = async () => { if (!confirm(t('del'))) return; try { await api('/api/tasks/' + encodeURIComponent(i.id), { method: 'DELETE' }); items.delete(i.id); list(); } catch (e) { toast(e.message, true); } };
      row.append(x);
    } else if (isAdult(i)) row.append(mk('span', 'a18', '18+'));
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
    if (!session && items.size > 400) { const keep = [...items.values()].filter((i) => i.type !== 'list').sort((a, b) => b.created - a.created).slice(0, 200).concat([...items.values()].filter((i) => i.type === 'list')); items = new Map(keep.map((i) => [i.id, i])); }
    const before = topicsX.join('|'); topicsX = d.topics || topicsX;
    rev = d.rev; list();
    if (d.items.some((i) => i.type === 'list')) drawLists();
    if (before !== topicsX.join('|')) fillTopics();
  } catch {}
}
$('#lang').onclick = () => { lang = lang === 'he' ? 'en' : 'he'; ls.set('lang', lang); render(); };
$('#name').value = ls.get('name') || '';
$('#nameGo').onclick = () => { const v = $('#name').value.trim(); if (!v) return toast(t('noName'), true); ls.set('name', v.slice(0, 40)); render(); $('#text').focus(); };
$('#name').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#nameGo').click(); } };   // (no stray newline in the box that gets the focus)
$('#rename').onclick = () => { ls.set('name', ''); render(); $('#name').focus(); };
$('#text').oninput = () => { count(); if (!langTouched) seg($('#langSeg'), [['en', 'English'], ['he', 'עברית']], curLang(), (v) => { itemLang = v; langTouched = true; render(); }); };
$('#topic').onchange = () => { if ($('#topic').value !== '__new') ls.set('topic', $('#topic').value); $('#newTopic').hidden = $('#topic').value !== '__new'; if (!$('#newTopic').hidden) $('#newTopic').focus(); };
$('#adultChk').onchange = () => $('#adultRow').classList.toggle('on', $('#adultChk').checked);
document.querySelectorAll('[data-ins]').forEach((b) => b.onclick = () => { const ta = $('#text'), s = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, s) + b.dataset.ins + ta.value.slice(ta.selectionEnd ?? s); ta.focus(); ta.selectionStart = ta.selectionEnd = s + b.dataset.ins.length; count(); });
document.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; render(); });
$('#add').onclick = async () => {
  const text = $('#text').value.trim(); if (!text || busy) return;
  const body = { type, text, author: ls.get('name') || '', session, device, lang: curLang(), lists: [...pickLists] };
  const x18 = $('#adultChk').checked;
  if (groupOf(type) === 'tod') { const base = tags.size ? [...tags] : ['family']; body.tags = x18 ? adultTags(base, true) : base; } else body.tags = x18 ? ['18+'] : [];
  if (type === 'trivia') {
    body.answer = $('#answer').value.trim(); if (!body.answer) { toast(t('noAnswer'), true); $('#answer').focus(); return; }
    body.wrong = [...document.querySelectorAll('.in.w')].map((w) => w.value.trim()).filter(Boolean);
    body.cat = $('#topic').value === '__new' ? ($('#newTopic').value.trim() || 'general') : $('#topic').value; body.d = diff;
  }
  if (type === 'party') { body.kind = kind; if (kind === 'r') { body.end = $('#end').value.trim(); body.turns = turns; } }
  if (type === 'kings') { body.rank = rank; body.title = $('#title').value.trim(); }
  busy = true; count();
  try {
    const d = await api('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
    if (d.item) items.set(d.item.id, d.item);
    $('#text').value = ''; $('#answer').value = ''; document.querySelectorAll('.in.w').forEach((w) => w.value = ''); $('#end').value = ''; $('#title').value = '';
    if (body.cat && $('#topic').value === '__new') { if (!topicsX.includes(body.cat)) topicsX.push(body.cat); ls.set('topic', body.cat); $('#newTopic').value = ''; fillTopics(); }
    langTouched = false;
    toast(x18 && !adult ? t('hidden18') : t('added')); render();
    if (navigator.vibrate) navigator.vibrate(20);
  } catch (e) { toast(/fetch|network/i.test(e.message) ? t('offline') : e.message, true); }
  busy = false; count();
};
$('#imp').onclick = () => $('#file').click();
$('#file').onchange = async () => {
  const f = $('#file').files[0]; $('#file').value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data) && !Array.isArray(data.items)) throw new Error(t('badFile'));
    const d = await api('/api/tasks/import', { method: 'POST', body: JSON.stringify({ items: Array.isArray(data) ? data : data.items, session, device, author: ls.get('name') || '' }) });
    toast(t('imported', { n: d.added })); rev = 0; poll();
  } catch (e) { toast(e instanceof SyntaxError ? t('badFile') : e.message, true); }
};
render(); poll(); setInterval(poll, 4000);
})();
</script>
</body></html>`;
