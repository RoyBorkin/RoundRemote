// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The round "Server offline" page of a companion Pi (lib/companion.js): served at http://127.0.0.1:8765/ while the
// Round Remote server can't be reached, and inside the app's overlay (/companion/offline?embed=1, js/core/companion.js).
// Self-contained (no fonts, scripts or files from the server — it's offline), 720×720 round, touch + knob/keys:
//   • the RB logo in a ring that counts down to the next automatic retry; "Server offline", the address, last contact
//   • Retry · Wi-Fi (a small Wi-Fi picker on /api/system/wifi*, with an on-screen keyboard) · Server (change the
//     address, Find servers over mDNS, Test, Connect) · on the full install: Use this Pi's own bridge
//   • back in the app by itself as soon as the server answers again
// Colours: the app leaves a snapshot of its theme in localStorage (rr.offlineTheme, js/core/companion.js); without one
// it uses the Classic dark look.
const esc = (s) => String(s).replace(/</g, '\\u003c');

export function offlinePage({ logo = '', embed = false, mode = 'light', status = {} } = {}) {
  const svg = String(logo).replace(/<\?xml[^>]*>/, '').replace(/fill="#fff(fff)?"/gi, 'fill="currentColor"').replace('<svg ', '<svg class="logo" aria-hidden="true" ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="color-scheme" content="dark light">
<title>Round Remote — server offline</title>
<style>
:root { --bg:#050506; --bg2:#151518; --surface:#121215; --ink:245 245 247; --c1:#1ed760; --on-c1:#0a0a0b; --font:system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; --warn:#ff9f43; --bad:#ff5a6a; }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; height: 100%; overflow: hidden; background: ${embed ? 'transparent' : 'var(--bg)'}; }
body { font: 500 3.3vmin/1.35 var(--font); color: rgb(var(--ink)); user-select: none; cursor: default; display: grid; place-items: center; }
.disc { position: relative; width: 100vmin; height: 100vmin; border-radius: 50%; overflow: hidden; background: radial-gradient(circle at 50% 50%, var(--bg2), var(--bg) 70%); }
.view { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; }
.view.on { display: flex; animation: in .28s ease both; }
.view > * { flex-shrink: 0; }
.view > .list { flex-shrink: 1; }
@keyframes in { from { opacity: 0; transform: scale(.985); } }
.muted { color: rgb(var(--ink) / .62); }
.dim { color: rgb(var(--ink) / .42); }
.mono { font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace; letter-spacing: -.01em; }
button { font: inherit; color: inherit; border: 0; background: none; padding: 0; cursor: pointer; }
.pill { min-height: 9.6vmin; padding: 0 5vmin; border-radius: 99px; background: rgb(var(--ink) / .09); border: .25vmin solid rgb(var(--ink) / .12); font-weight: 650; font-size: 3.6vmin; display: inline-flex; align-items: center; justify-content: center; gap: 1.6vmin; transition: transform .12s, background .2s; }
.pill:active { transform: scale(.96); }
.pill.primary { background: var(--c1); color: var(--on-c1); border-color: transparent; }
.pill.small { min-height: 8vmin; padding: 0 3.8vmin; font-size: 3.2vmin; }
.pill svg { width: 4.4vmin; height: 4.4vmin; fill: currentColor; flex: none; }
.pill[disabled] { opacity: .45; pointer-events: none; }
.link { font-size: 3vmin; font-weight: 600; color: rgb(var(--ink) / .7); padding: 1.6vmin 3vmin; border-radius: 99px; text-decoration: underline; text-underline-offset: .6vmin; text-decoration-color: rgb(var(--ink) / .3); }
:focus { outline: none; }
:focus-visible, .kb-focus { outline: .6vmin solid var(--c1); outline-offset: .5vmin; }
/* ---- main */
#v-main { justify-content: center; padding-bottom: 1vmin; }
.hero { position: relative; width: 30vmin; height: 30vmin; flex: none; }
.hero svg.ring { position: absolute; inset: 0; transform: rotate(-90deg); }
.ring circle { fill: none; stroke-width: 1.3; }
.ring .trk { stroke: rgb(var(--ink) / .12); }
.ring .bar { stroke: var(--c1); stroke-linecap: round; transition: stroke-dashoffset .25s linear; }
.state-online .ring .bar { stroke: var(--c1); }
.logo { position: absolute; left: 50%; top: 50%; width: 52%; height: 52%; transform: translate(-50%, -50%); color: rgb(var(--ink) / .92); }
.state-offline .logo, .state-unset .logo { color: rgb(var(--ink) / .5); }
.badge { position: absolute; right: 6%; bottom: 6%; width: 7.6vmin; height: 7.6vmin; border-radius: 50%; display: grid; place-items: center; background: var(--warn); color: #111; box-shadow: 0 0 0 .9vmin var(--bg); }
.badge svg { width: 4.6vmin; height: 4.6vmin; fill: currentColor; }
.state-online .badge { background: var(--c1); color: var(--on-c1); }
h1 { margin: 2.6vmin 0 .4vmin; font-size: 6.6vmin; line-height: 1.05; font-weight: 800; letter-spacing: -.03em; text-align: center; }
.addr { font-size: 3.4vmin; max-width: 64vmin; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.when { margin-top: 1.2vmin; font-size: 3vmin; text-align: center; max-width: 64vmin; min-height: 8.2vmin; }
.acts { display: flex; align-items: center; gap: 1.8vmin; margin-top: 2.2vmin; }
.acts2 { display: flex; gap: 2vmin; margin-top: 2vmin; }
.foot { margin-top: 1.4vmin; display: flex; gap: 1vmin; min-height: 0; }
.foot:not(:has(.link:not(.hide))) { display: none; }
.net { display: inline-flex; align-items: center; gap: 1vmin; font-size: 2.8vmin; margin-top: .6vmin; }
.net svg { width: 3.4vmin; height: 3.4vmin; fill: currentColor; }
/* ---- sub views */
.head { margin-top: 7vmin; display: flex; flex-direction: column; align-items: center; gap: .6vmin; }
.back { width: 10vmin; height: 10vmin; border-radius: 50%; display: grid; place-items: center; background: rgb(var(--ink) / .08); }
.back svg { width: 5.4vmin; height: 5.4vmin; fill: currentColor; }
h2 { margin: .6vmin 0 0; font-size: 5vmin; font-weight: 800; letter-spacing: -.02em; }
.sub { font-size: 2.9vmin; text-align: center; max-width: 60vmin; min-height: 3.9vmin; }
.list { width: 68vmin; flex: 1 1 auto; margin: 1.6vmin 0 0; overflow-y: auto; scrollbar-width: none; padding: .6vmin 1vmin 2vmin; mask-image: linear-gradient(#000 88%, transparent); }
.list::-webkit-scrollbar { display: none; }
.row { width: 100%; min-height: 10vmin; display: flex; align-items: center; gap: 2.4vmin; padding: 1.4vmin 2.8vmin; border-radius: 4vmin; text-align: left; margin-bottom: 1.2vmin; background: rgb(var(--ink) / .06); }
.row.on { background: color-mix(in srgb, var(--c1) 22%, transparent); }
.row.err .rs { color: var(--bad); }
.row .rt { flex: 1; min-width: 0; }
.row .rn { font-weight: 650; font-size: 3.4vmin; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .rs { font-size: 2.7vmin; color: rgb(var(--ink) / .6); }
.row svg { width: 5vmin; height: 5vmin; flex: none; }
.bars path, .bars circle { fill: none; stroke: rgb(var(--ink) / .25); stroke-width: 2.2; stroke-linecap: round; }
.bars circle { fill: rgb(var(--ink) / .25); stroke: none; }
.bars .lit { stroke: rgb(var(--ink)); }
.bars circle.lit { fill: rgb(var(--ink)); }
.lock { fill: rgb(var(--ink) / .55); width: 3.6vmin !important; height: 3.6vmin !important; }
.empty { text-align: center; padding: 6vmin 2vmin; color: rgb(var(--ink) / .55); font-size: 3vmin; }
.spin { width: 4.6vmin; height: 4.6vmin; border-radius: 50%; border: .6vmin solid rgb(var(--ink) / .18); border-top-color: var(--c1); animation: rot .8s linear infinite; flex: none; }
@keyframes rot { to { transform: rotate(360deg); } }
.bar-acts { display: flex; gap: 1.8vmin; margin: 1.2vmin 0 9vmin; }
/* ---- text entry + keyboard */
.field { width: 66vmin; min-height: 9vmin; margin-top: 1.8vmin; border-radius: 3vmin; background: rgb(var(--ink) / .08); border: .3vmin solid rgb(var(--ink) / .16); display: flex; align-items: center; padding: 0 3vmin; font-size: 3.8vmin; overflow: hidden; white-space: nowrap; }
.field .t { overflow: hidden; text-overflow: clip; direction: rtl; text-align: left; unicode-bidi: plaintext; flex: 1; }
.field .ph { color: rgb(var(--ink) / .4); }
.field .cur { display: inline-block; width: .4vmin; height: 4.6vmin; background: var(--c1); margin-left: .3vmin; animation: blink 1s steps(1) infinite; vertical-align: middle; }
@keyframes blink { 50% { opacity: 0; } }
.eye { margin-left: 1.4vmin; font-size: 2.6vmin; font-weight: 700; color: rgb(var(--ink) / .7); padding: 1.2vmin 1.6vmin; border-radius: 99px; background: rgb(var(--ink) / .08); }
.kb { margin-top: 2vmin; display: flex; flex-direction: column; align-items: center; gap: .9vmin; }
.kr { display: flex; gap: .8vmin; }
.k { width: 7.3vmin; height: 7.4vmin; border-radius: 1.8vmin; background: rgb(var(--ink) / .1); font-size: 3.5vmin; font-weight: 600; display: grid; place-items: center; }
.k:active, .k.down { background: rgb(var(--ink) / .26); }
.k.w { width: 11vmin; font-size: 2.7vmin; }
.k.sp { width: 25vmin; }
.k.ok { width: 14vmin; background: var(--c1); color: var(--on-c1); font-size: 3vmin; }
.k.on { background: rgb(var(--ink) / .3); }
.msg { min-height: 4vmin; font-size: 2.9vmin; text-align: center; max-width: 62vmin; margin-top: 1vmin; }
.msg.bad { color: var(--bad); } .msg.good { color: var(--c1); }
.found { width: 64vmin; max-height: 27vmin; overflow-y: auto; margin-top: 1.2vmin; scrollbar-width: none; }
.found .row { min-height: 8.6vmin; padding: 1vmin 2.6vmin; }
.hide { display: none !important; }
</style>
</head>
<body>
<div class="disc" id="disc">
  <section class="view on" id="v-main">
    <div class="hero">
      <svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="trk" cx="50" cy="50" r="47"/><circle class="bar" id="bar" cx="50" cy="50" r="47" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>
      ${svg}
      <span class="badge" id="badge"><svg viewBox="0 0 24 24"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95A5.469 5.469 0 0 1 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11A2.98 2.98 0 0 1 22 15c0 1.65-1.35 3-3 3zM3 3 1.6 4.4l3.1 3.1"/><path d="M2.81 2.81 1.39 4.22l18.38 18.39 1.42-1.42z"/></svg></span>
    </div>
    <h1 id="title">Server offline</h1>
    <div class="addr mono muted" id="addr"></div>
    <div class="net muted hide" id="net"></div>
    <div class="when muted" id="when"></div>
    <div class="acts">
      <button class="pill small f" id="b-wifi" type="button"><svg viewBox="0 0 24 24"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8 3 3 3-3a4.24 4.24 0 0 0-6 0zm-4-4 2 2a7.07 7.07 0 0 1 10 0l2-2C15.14 9.14 8.87 9.14 5 13z"/></svg>Wi-Fi</button>
      <button class="pill primary f" id="b-retry" type="button"><svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg><span>Retry</span></button>
      <button class="pill small f" id="b-server" type="button"><svg viewBox="0 0 24 24"><path d="M4 1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm0 14h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zm3-9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm0 14a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg><span id="b-server-l">Server</span></button>
    </div>
    <div class="foot">
      <button class="link f ${mode === 'full' ? '' : 'hide'}" id="b-local" type="button">Use this Pi’s own bridge</button>
      <button class="link f ${embed ? '' : 'hide'}" id="b-close" type="button">Continue offline</button>
    </div>
  </section>

  <section class="view" id="v-wifi">
    <div class="head"><button class="back f" type="button" data-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg></button><h2>Wi-Fi</h2><div class="sub muted" id="w-now"></div></div>
    <div class="list" id="w-list"></div>
    <div class="bar-acts"><button class="pill small primary f" id="w-scan" type="button">Scan</button></div>
  </section>

  <section class="view" id="v-server">
    <div class="head"><button class="back f" type="button" data-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg></button><h2>Server</h2><div class="sub muted">The Round Remote server on your network</div></div>
    <button class="field f" id="s-field" type="button"><span class="t mono" id="s-text"></span></button>
    <div class="msg" id="s-msg"></div>
    <div class="acts2"><button class="pill small f" id="s-find" type="button">Find servers</button><button class="pill small f" id="s-test" type="button">Test</button><button class="pill small primary f" id="s-go" type="button">Connect</button></div>
    <div class="found" id="s-found"></div>
  </section>

  <section class="view" id="v-kb">
    <div class="head" style="margin-top:9vmin"><h2 id="k-title">Password</h2><div class="sub muted" id="k-sub"></div></div>
    <div class="field" id="k-field"><span class="t" id="k-text"></span><span class="cur"></span><button class="eye hide" id="k-eye" type="button">Show</button></div>
    <div class="kb" id="kb"></div>
  </section>
</div>
<script>
'use strict';
const EMBED = ${embed ? 'true' : 'false'}, MODE = ${JSON.stringify(mode)};
let S = ${esc(JSON.stringify(status))};
const $ = (id) => document.getElementById(id);
const api = async (p, body, ms = 15000) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(p, body === undefined ? { cache: 'no-store', signal: ctl.signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok || (j && j.ok === false)) throw Object.assign(new Error((j && j.error) || ('HTTP ' + r.status)), { body: j, status: r.status });
    return j;
  } finally { clearTimeout(t); }
};

// ---- the app's theme (a snapshot it leaves in localStorage)
try {
  const t = JSON.parse(localStorage.getItem('rr.offlineTheme') || 'null');
  if (t && t.bg) {
    const r = document.documentElement.style;
    for (const [k, v] of Object.entries({ '--bg': t.bg, '--bg2': t.bg2 || t.bg, '--surface': t.surface, '--ink': t.ink, '--c1': t.c1, '--on-c1': t.onC1 })) if (v) r.setProperty(k, v);
    if (t.font) r.setProperty('--font', t.font + ', system-ui, sans-serif');
    document.documentElement.style.colorScheme = t.mode === 'light' ? 'light' : 'dark';
    if (t.mode === 'oled') r.setProperty('--bg2', t.bg);
  }
} catch {}

// ---- views + knob / keys
let view = 'main';
const stack = [];
function show(v, push = true) {
  if (push && v !== view) stack.push(view);
  view = v;
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
  const first = document.querySelector('#v-' + v + ' .f:not([disabled]):not(.hide)');
  if (first && matchMedia('(hover: hover)').matches === false) first.blur();
}
function back() { if (kb.active) return kb.cancel(); const v = stack.pop(); show(v || 'main', false); }
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', back));
const focusables = () => [...document.querySelectorAll('#v-' + view + ' .f, #v-' + view + ' .k')].filter((e) => !e.disabled && !e.closest('.hide') && e.offsetParent);
window.addEventListener('keydown', (e) => {
  if (kb.active && kb.key(e)) { e.preventDefault(); return; }
  const list = focusables(); const i = list.indexOf(document.activeElement);
  if (['ArrowRight', 'ArrowDown', 'Tab'].includes(e.key) && !(e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); (list[(i + 1) % list.length] || list[0])?.focus(); }
  else if (['ArrowLeft', 'ArrowUp'].includes(e.key) || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); (list[(i - 1 + list.length) % list.length] || list[0])?.focus(); }
  else if (e.key === 'Escape' || (e.key === 'Backspace' && !kb.active)) { e.preventDefault(); back(); }
});

// ---- status (SSE from the companion) + the countdown ring
const ago = (ts) => { const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? s + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' d'; };
let nextAt = 0, period = 5000, gone = false, companionUp = true;
function paint() {
  const st = !companionUp ? 'starting' : S.state || (S.online ? 'online' : 'offline');
  const disc = $('disc');
  disc.className = 'disc state-' + st;
  const unset = st === 'unset' || !S.server;
  $('title').textContent = st === 'online' ? 'Server is back' : st === 'starting' ? 'Starting…' : unset ? 'Set up the server' : st === 'checking' ? 'Connecting…' : 'Server offline';
  $('addr').textContent = unset ? 'No server address yet' : S.server.replace(/^http:\\/\\//, '');
  $('b-server-l').textContent = unset ? 'Enter address' : 'Server';
  $('b-retry').classList.toggle('hide', unset);
  if (unset) $('b-server').classList.add('primary'); else $('b-server').classList.remove('primary');
  tick();
}
function tick() {
  if (gone) return;
  const unset = !S.server || S.state === 'unset';
  const left = Math.max(0, nextAt - Date.now());
  const frac = S.online ? 1 : unset ? 0 : 1 - Math.min(1, left / period);
  $('bar').style.strokeDashoffset = String(100 - frac * 100);
  const parts = [];
  if (!companionUp) parts.push('This Pi is starting its service…');
  else if (unset) parts.push('Type the address of your Round Remote server (the NAS), or find it on the network.');
  else if (S.online) parts.push('Opening Round Remote…');
  else {
    parts.push(S.lastOk ? 'Last contact ' + ago(S.lastOk) + ' ago' : 'Not reached since this Pi started');
    parts.push(left > 400 ? 'retrying in ' + Math.ceil(left / 1000) + ' s' : 'checking…');
  }
  const w = $('when'); w.textContent = parts.join(' · ');
  if (S.lastError && !S.online && !unset && companionUp) w.append(document.createElement('br'), Object.assign(document.createElement('span'), { className: 'dim', textContent: S.lastError }));
}
setInterval(tick, 250);
function apply(s) {
  const was = S.online;
  S = s; period = s.intervalMs || 5000;
  nextAt = s.nextCheckMs != null ? Date.now() + s.nextCheckMs : 0;
  paint();
  if (s.online && (was === false || !EMBED || was == null)) back2app();
  if (!s.enabled && MODE === 'full' && s.state === 'local') back2app();
}
function back2app() {
  if (gone) return;
  gone = true;
  if (EMBED) { parent.postMessage({ rr: 'companion', online: true }, location.origin); setTimeout(() => { gone = false; }, 1500); return; }
  setTimeout(() => { location.replace(/^\\/companion/.test(location.pathname) ? '/' : location.pathname + location.search); }, 700);
}
let es = null;
function listen() {
  es = new EventSource('/api/companion/events');
  es.onmessage = (ev) => { try { companionUp = true; apply(JSON.parse(ev.data)); } catch {} };
  es.onerror = () => { companionUp = false; paint(); };
}
listen();
paint();
$('b-retry').addEventListener('click', async (e) => {
  const b = e.currentTarget; b.disabled = true; $('when').textContent = 'Checking…';
  try { apply(await api('/api/companion/retry', {}, 8000)); } catch (err) { $('when').textContent = err.message; }
  b.disabled = false;
});
$('b-local').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again: this Pi’s own bridge'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Use this Pi’s own bridge'; }, 3500); return; }
  try { await api('/api/companion/disconnect', {}); gone = false; back2app(); } catch (err) { $('when').textContent = err.message; }
});
$('b-close').addEventListener('click', () => parent.postMessage({ rr: 'companion', dismiss: true }, location.origin));

// ---- on-screen keyboard
const kb = (() => {
  const LAYERS = {
    abc: ['1234567890', 'qwertyuiop', 'asdfghjkl', '⇧zxcvbnm⌫', ['?123', ' ', '.', '/', 'OK']],
    ABC: ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', '⇧ZXCVBNM⌫', ['?123', ' ', '.', '/', 'OK']],
    sym: ['1234567890', '!@#$%^&*()', '-_=+:;\\'"?', '⇧,<>[]{}⌫', ['abc', ' ', '.', '/', 'OK']],
  };
  const st = { active: false, layer: 'abc', text: '', secret: false, shown: false, done: null };
  const root = $('kb');
  function render() {
    root.textContent = '';
    for (const row of LAYERS[st.layer]) {
      const r = document.createElement('div'); r.className = 'kr';
      for (const ch of (Array.isArray(row) ? row : [...row])) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'k';
        b.textContent = ch === ' ' ? 'space' : ch;
        if (ch === ' ') b.classList.add('sp'); else if (ch === 'OK') b.classList.add('ok'); else if (ch.length > 1 || ch === '⇧' || ch === '⌫') b.classList.add('w');
        if (ch === '⇧' && st.layer === 'ABC') b.classList.add('on');
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); press(ch); b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 120); });
        b.addEventListener('click', (e) => { if (e.detail === 0) press(ch); });   // Enter / knob press
        r.append(b);
      }
      root.append(r);
    }
  }
  function paintText() {
    const t = $('k-text');
    t.textContent = st.text ? (st.secret && !st.shown ? '•'.repeat(st.text.length) : st.text) : '';
    if (!st.text) t.innerHTML = '<span class="ph">' + (st.ph || '') + '</span>';
    $('k-eye').textContent = st.shown ? 'Hide' : 'Show';
  }
  function press(ch) {
    if (ch === '⌫') st.text = st.text.slice(0, -1);
    else if (ch === '⇧') { st.layer = st.layer === 'abc' ? 'ABC' : st.layer === 'ABC' ? 'abc' : 'sym'; render(); }
    else if (ch === '?123') { st.layer = 'sym'; render(); }
    else if (ch === 'abc') { st.layer = 'abc'; render(); }
    else if (ch === 'OK') return finish(st.text);
    else { st.text += ch; if (st.layer === 'ABC') { st.layer = 'abc'; render(); } }
    paintText();
  }
  function finish(v) { const f = st.done; st.active = false; st.done = null; back(); f && f(v); }
  $('k-eye').addEventListener('click', () => { st.shown = !st.shown; paintText(); });
  return {
    get active() { return st.active; },
    open({ title, sub = '', value = '', secret = false, placeholder = '' }) {
      return new Promise((resolve) => {
        Object.assign(st, { active: true, text: value, secret, shown: false, layer: 'abc', ph: placeholder, done: resolve });
        $('k-title').textContent = title; $('k-sub').textContent = sub;
        $('k-eye').classList.toggle('hide', !secret);
        render(); paintText(); show('kb');
      });
    },
    cancel() { const f = st.done; st.active = false; st.done = null; stack.length && show(stack.pop(), false); f && f(null); },
    key(e) {   // a real keyboard types too
      if (e.key === 'Enter' && document.activeElement && document.activeElement.classList.contains('k')) return false;
      if (e.key === 'Enter') { finish(st.text); return true; }
      if (e.key === 'Escape') { this.cancel(); return true; }
      if (e.key === 'Backspace') { press('⌫'); return true; }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { st.text += e.key; paintText(); return true; }
      return false;
    },
  };
})();

// ---- Wi-Fi (this Pi's own, through /api/system)
const W = { nets: [], scanning: false, busy: '', err: {} };
const bars = (sig) => { const n = sig >= 75 ? 4 : sig >= 50 ? 3 : sig >= 25 ? 2 : sig > 0 ? 1 : 0; const a = [[5, 8.46, 15.46, 15.54], [9, 5.64, 12.64, 18.36], [13, 2.81, 9.81, 21.19]];
  return '<svg class="bars" viewBox="0 0 24 24"><circle cx="12" cy="19" r="1.9" class="' + (n >= 1 ? 'lit' : '') + '"/>' + a.map(([r, x1, y, x2], i) => '<path d="M' + x1 + ' ' + y + 'A' + r + ' ' + r + ' 0 0 1 ' + x2 + ' ' + y + '" class="' + (n >= i + 2 ? 'lit' : '') + '"/>').join('') + '</svg>'; };
const LOCK = '<svg class="lock" viewBox="0 0 24 24"><path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9V6z"/></svg>';
const CODES = { 'wrong-password': 'Wrong password — tap to try again', 'bad-password': 'Wi-Fi passwords have 8–63 characters', 'not-found': 'Not found — is it in range?', timeout: 'No answer — tap to try again' };
const secure = (n) => !!(n.security && n.security !== '--' && !/^(open|none)$/i.test(n.security));
async function wifiNow() {
  try {
    const w = await api('/api/system/wifi');
    const c = w && w.current && w.current.ssid ? w.current : null;
    $('w-now').textContent = c ? 'Connected to ' + c.ssid + (c.ip ? ' · ' + c.ip : '') : w && w.enabled === false ? 'Wi-Fi is off' : 'Not connected';
    const net = $('net'); net.classList.remove('hide');
    net.innerHTML = bars(c ? c.signal : 0) + '<span></span>'; net.lastChild.textContent = c ? c.ssid : (w && w.hotspot && w.hotspot.on ? 'Setup hotspot on' : 'No Wi-Fi');
    return w;
  } catch { $('w-now').textContent = ''; return null; }
}
function wifiList() {
  const L = $('w-list'); L.textContent = '';
  if (W.scanning && !W.nets.length) { L.innerHTML = '<div class="empty"><div class="spin" style="margin:0 auto 2vmin"></div>Looking for networks…</div>'; return; }
  if (!W.nets.length) { L.innerHTML = '<div class="empty">No networks yet — tap Scan</div>'; return; }
  for (const n of W.nets) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'row f' + (n.inUse ? ' on' : '') + (W.err[n.ssid] ? ' err' : '');
    const sub = W.busy === n.ssid ? 'Connecting…' : W.err[n.ssid] || [n.inUse ? 'Connected' : n.saved ? 'Saved' : '', secure(n) ? n.security : 'Open'].filter(Boolean).join(' · ');
    b.innerHTML = bars(n.signal) + '<div class="rt"><div class="rn" dir="auto"></div><div class="rs"></div></div>' + (W.busy === n.ssid ? '<div class="spin"></div>' : secure(n) ? LOCK : '');
    b.querySelector('.rn').textContent = n.ssid; b.querySelector('.rs').textContent = sub;
    b.disabled = !!W.busy && W.busy !== n.ssid;
    b.addEventListener('click', () => { if (!n.inUse && !W.busy) wifiConnect(n); });
    L.append(b);
  }
}
async function wifiScan() {
  if (W.scanning) return;
  W.scanning = true; $('w-scan').disabled = true; $('w-scan').textContent = 'Scanning…'; wifiList();
  try {
    const r = await api('/api/system/wifi/scan', undefined, 30000);
    const best = new Map();
    for (const n of (r && r.networks) || []) { if (!n.ssid) continue; const o = best.get(n.ssid); if (!o || n.inUse || (!o.inUse && (n.signal || 0) > (o.signal || 0))) best.set(n.ssid, n); }
    W.nets = [...best.values()].sort((a, b) => (b.inUse - a.inUse) || ((b.saved ? 1 : 0) - (a.saved ? 1 : 0)) || (b.signal || 0) - (a.signal || 0));
  } catch (e) { $('w-now').textContent = e.message; }
  W.scanning = false; $('w-scan').disabled = false; $('w-scan').textContent = 'Scan'; wifiList();
}
async function wifiConnect(n) {
  let password;
  if (secure(n) && (!n.saved || /wrong/i.test(W.err[n.ssid] || ''))) {
    password = await kb.open({ title: n.ssid, sub: 'Wi-Fi password', secret: true, placeholder: 'password' });
    if (password == null) return;
  }
  W.busy = n.ssid; delete W.err[n.ssid]; wifiList();
  try {
    await api('/api/system/wifi/connect', { ssid: n.ssid, ...(password ? { password } : {}) }, 60000);
    W.busy = ''; await wifiNow(); await wifiScan();
    api('/api/companion/retry', {}).then(apply).catch(() => {});
  } catch (e) { W.busy = ''; W.err[n.ssid] = CODES[(e.body && e.body.code) || ''] || e.message; wifiList(); }
}
$('w-scan').addEventListener('click', wifiScan);
$('b-wifi').addEventListener('click', () => { show('wifi'); wifiNow(); wifiScan(); });
// the Wi-Fi button only on a device that has Wi-Fi (the Pi's system API)
api('/api/system/info').then((i) => { if (!i || !i.pi || (i.caps && i.caps.wifi === false)) $('b-wifi').classList.add('hide'); else wifiNow(); }).catch(() => $('b-wifi').classList.add('hide'));

// ---- server address
let addr = '';
const sMsg = (t, cls = '') => { const m = $('s-msg'); m.textContent = t; m.className = 'msg ' + cls; };
function paintAddr() { const t = $('s-text'); t.textContent = addr || ''; if (!addr) t.innerHTML = '<span class="ph">e.g. 192.168.50.108:8765</span>'; }
$('b-server').addEventListener('click', () => { addr = (S.server || '').replace(/^http:\\/\\//, ''); paintAddr(); sMsg(''); show('server'); });
$('s-field').addEventListener('click', async () => {
  const v = await kb.open({ title: 'Server address', sub: 'IP or name, and the port (8765)', value: addr, placeholder: '192.168.50.108:8765' });
  if (v != null) { addr = v.trim(); paintAddr(); sMsg(''); }
});
$('s-test').addEventListener('click', async () => {
  if (!addr) return sMsg('Type the address first', 'bad');
  sMsg('Testing…');
  try { const r = await api('/api/companion/test', { server: addr }, 8000); sMsg(r.ok ? 'Found Round Remote ' + (r.version || '') + ' · ' + r.latencyMs + ' ms' : r.error, r.ok ? 'good' : 'bad'); }
  catch (e) { sMsg(e.message, 'bad'); }
});
let force = false;
$('s-go').addEventListener('click', async (e) => {
  if (!addr) return sMsg('Type the address first', 'bad');
  const b = e.currentTarget; b.disabled = true; sMsg('Connecting…');
  try {
    const r = await api('/api/companion/connect', { server: addr, force }, 10000);
    force = false; b.textContent = 'Connect';
    sMsg(r.online ? 'Connected' : 'Saved — waiting for the server', 'good');
    apply(r); show('main', false); stack.length = 0;
  } catch (err) {
    sMsg(err.message + (err.status === 502 ? ' — tap “Save anyway” to keep it' : ''), 'bad');
    if (err.status === 502) { force = true; b.textContent = 'Save anyway'; }
  }
  b.disabled = false;
});
$('s-find').addEventListener('click', async (e) => {
  const b = e.currentTarget, L = $('s-found');
  b.disabled = true; b.textContent = 'Looking…'; L.innerHTML = '<div class="empty" style="padding:2vmin"><div class="spin" style="margin:0 auto"></div></div>';
  try {
    const r = await api('/api/companion/discover', undefined, 12000);
    L.textContent = '';
    const list = ((r && r.servers) || []).filter((s) => !s.self);
    if (!list.length) L.innerHTML = '<div class="empty" style="padding:2vmin">None found — type the address (a Docker server needs host networking to be found)</div>';
    for (const s of list) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'row f';
      row.innerHTML = '<div class="rt"><div class="rn"></div><div class="rs mono"></div></div>';
      row.querySelector('.rn').textContent = s.name + (s.role === 'server' ? ' · server' : '');
      row.querySelector('.rs').textContent = s.address + ':' + s.port + (s.version ? ' · ' + s.version : '');
      row.addEventListener('click', () => { addr = s.address + ':' + s.port; paintAddr(); sMsg('Tap Connect to use ' + s.name, 'good'); });
      L.append(row);
    }
  } catch (err) { L.innerHTML = ''; sMsg(err.message, 'bad'); }
  b.disabled = false; b.textContent = 'Find servers';
});
</script>
</body>
</html>`;
}
