// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Shared by the party apps (Party DJ, Movie Night, Trivia Night): the display's side of a party "room" on the
// bridge (bridge/lib/party.js). The display claims a room code with a secret key, publishes its public state
// (the bridge sends every phone its own view of it) and receives the phones' actions — over an EventSource, or
// by polling when the page can't open one (an https page talking to an http bridge). Without the bridge the
// apps run in "pass the remote" mode and this link just reports status 'down'.
//
//   const link = partyLink('dj', app, { onAct(act) {…} });
//   link.start(); link.publish(state, blockedDevices); link.reply(device, data); await link.phoneUrl() → { url, reason }
//   link.status: 'off' | 'connecting' | 'ok' | 'down' · link.events.on('status', fn) · link.code · link.newRoom() · link.stop()
// Also: qrBox(url), phoneThumb(url) (a small image a phone may see), confetti(el), ha* helpers (Home Assistant).
import { h } from '../js/ui/dom.js';
import { Emitter, isMixed } from '../js/core/util.js';
import { bridgeBase, bridgeFetch } from '../js/providers/bridge.js';
import { provider } from '../js/providers/registry.js';
import { qrSvg } from './qr.js';

const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n, abc = CODE) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => abc[b % abc.length]).join('');
const makeRoom = () => ({ code: rnd(4), key: rnd(20, CODE + 'abcdefghijkmnopqrstuvwxyz'), seq: 0, boot: '' });

export function partyLink(name, app, { onAct = () => {} } = {}) {
  const events = new Emitter();
  let room = app.data('room', null);
  if (!room?.code || !room?.key) { room = makeRoom(); app.save('room', room); }
  let status = 'off', reason = '', stopped = true, es = null, pollT = 0, retryT = 0, pubT = 0, saveT = 0, polling = false;
  let pending = null, lastPub = null, pubBusy = false, startTok = 0;

  const setStatus = (s, why = '') => { if (s === status && why === reason) return; status = s; reason = why; events.emit('status', s, why); };
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => app.save('room', room), 400); };
  const qs = () => `room=${room.code}&key=${encodeURIComponent(room.key)}&since=${room.seq || 0}&boot=${room.boot || ''}`;

  function handle(act) {
    if (!act || !(act.seq > (room.seq || 0))) return;
    room.seq = act.seq; persist();
    try { onAct(act); } catch (e) { console.error(`[${name}] act`, e); }
    events.emit('act', act);
  }
  function hello(d) {
    if (d?.boot && d.boot !== room.boot) { room.boot = d.boot; room.seq = 0; persist(); }
  }

  async function start() {
    stopped = false;
    const tok = ++startTok;
    clearTimeout(retryT);
    setStatus('connecting');
    const base = await bridgeBase().catch(() => null);
    if (stopped || tok !== startTok) return;
    if (!base) { setStatus('down', 'nobridge'); retry(9000); return; }
    try {
      const r = await bridgeFetch(`/api/${name}/room`, { method: 'POST', json: { room: room.code, key: room.key } });
      if (stopped || tok !== startTok) return;
      hello(r);
    } catch (e) {
      if (stopped || tok !== startTok) return;
      if (e.status === 409) { room = makeRoom(); app.save('room', room); events.emit('room', room.code); return start(); }
      setStatus('down', e.status === 404 ? 'old' : 'nobridge'); retry(9000); return;
    }
    open(base, tok);
    if (lastPub) { pending = lastPub; flush(); }
  }
  function retry(ms) { clearTimeout(retryT); if (!stopped) retryT = setTimeout(start, ms); }
  function closeStream() { try { es?.close(); } catch {} es = null; clearTimeout(pollT); polling = false; }

  function open(base, tok) {
    closeStream();
    if (typeof EventSource === 'undefined' || isMixed(base)) { polling = true; poll(tok); return; }
    let opened = false;
    const src = new EventSource(`${base}/api/${name}/host?${qs()}`);
    es = src;
    src.addEventListener('hello', (e) => { opened = true; hello(JSON.parse(e.data)); setStatus('ok'); });
    src.addEventListener('act', (e) => { try { handle(JSON.parse(e.data)); } catch (x) { console.error(x); } });
    src.onerror = () => {
      if (es !== src || stopped) return;
      if (src.readyState === 2) {        // closed for good (room gone after a bridge restart, or no SSE): claim again / poll
        es = null;
        if (!opened) { polling = true; poll(tok); } else { setStatus('connecting'); retry(1500); }
      } else setStatus('connecting');
    };
  }
  async function poll(tok) {
    if (stopped || tok !== startTok) return;
    try {
      const d = await bridgeFetch(`/api/${name}/inbox?${qs()}`, { timeout: 6000 });
      if (stopped || tok !== startTok) return;
      hello(d); setStatus('ok');
      for (const a of d.acts || []) handle(a);
    } catch (e) {
      if (stopped || tok !== startTok) return;
      setStatus('down', 'nobridge');
      if (e.status === 404 || e.status === 403) { retry(1500); return; }   // the room vanished: claim it again
    }
    pollT = setTimeout(() => poll(tok), 450);
  }

  /** Publish the public state (debounced); `blocked` = phone ids whose actions the bridge refuses. */
  function publish(state, blocked = []) {
    lastPub = { state, blocked };
    pending = lastPub;
    clearTimeout(pubT);
    pubT = setTimeout(flush, 40);
  }
  async function flush() {
    if (!pending || stopped || status === 'down' || pubBusy) return;
    const body = { room: room.code, key: room.key, ...pending };
    pending = null; pubBusy = true;
    try { await bridgeFetch(`/api/${name}/state`, { method: 'PUT', json: body, timeout: 6000 }); }
    catch (e) { if (e.status === 404 || e.status === 403) retry(500); else pending = pending || lastPub; }
    finally { pubBusy = false; if (pending) flush(); }
  }
  async function reply(device, data) {
    try { await bridgeFetch(`/api/${name}/reply`, { method: 'POST', json: { room: room.code, key: room.key, device, data }, timeout: 6000 }); return true; }
    catch { return false; }
  }
  /** The link the QR code shows: http://<bridge LAN address>:<port>/<name>?r=<room>. */
  async function phoneUrl() {
    const base = await bridgeBase().catch(() => null);
    if (!base) return { url: null, reason: 'nobridge' };
    let info;
    try { info = await bridgeFetch(`/api/${name}/info`, { timeout: 5000 }); } catch (e) { return { url: null, reason: e.status === 404 ? 'old' : 'nobridge' }; }
    const q = `/${name}?r=${room.code}`;
    if (info?.publicUrl) return { url: info.publicUrl.replace(/\/$/, '') + q, info };
    const u = new URL(base);
    if (!/^(localhost|127\.|\[?::1)/.test(u.hostname)) return { url: u.origin + q, info };
    const ip = info?.ips?.[0];
    if (!ip) return { url: null, reason: 'noip', info };
    return { url: `http://${ip}:${info.port || u.port || 8765}${q}`, info };
  }
  function stop() { stopped = true; startTok++; closeStream(); clearTimeout(retryT); clearTimeout(pubT); clearTimeout(saveT); app.save('room', room); setStatus('off'); }
  function newRoom() { room = makeRoom(); app.save('room', room); events.emit('room', room.code); if (!stopped) start(); }

  return {
    events, start, stop, publish, reply, phoneUrl, newRoom,
    get status() { return status; }, get reason() { return reason; }, get code() { return room.code; }, get key() { return room.key; },
    get polling() { return polling; },
  };
}

/** Why phones can't connect, in words. */
export function linkProblem(reason, file = 'bridge/server.js') {
  if (reason === 'noip') return 'The bridge has no network address phones can reach. Set "party": { "publicUrl": "http://<address>:8765" } in bridge/config.json.';
  if (reason === 'old') return 'This bridge is too old for party apps — update the bridge.';
  return `Phones need the bridge (${file}) running on this network. Until then, pass the remote around.`;
}

/** A QR code in a white rounded box. */
export function qrBox(url, cls = '') {
  return h(`div.pl-qr${cls ? '.' + cls : ''}`, { html: qrSvg(url, { margin: 2, dark: '#111', light: '#fff' }), dataset: { url } });
}

// ---------------------------------------------------------------- images phones may see
// Server artwork (Plex / Jellyfin) carries an access token in its URL — never hand that to guests' phones.
// Instead draw it small onto a canvas (works when the server allows CORS); data: URLs are shrunk the same way.
const thumbCache = new Map();
const secretUrl = (u) => /token|api_key|apikey|x-plex|x-emby|x-mediabrowser|access/i.test(u);
export function phoneThumb(url, size = 120) {
  if (!url) return Promise.resolve('');
  if (/^https:\/\//.test(url) && !secretUrl(url)) return Promise.resolve(url);
  if (thumbCache.has(url)) return thumbCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) img.crossOrigin = 'anonymous';
    const done = (v) => { clearTimeout(t); resolve(v); };
    const t = setTimeout(() => done(''), 4000);
    img.onload = () => {
      try {
        const r = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * r)); c.height = Math.max(1, Math.round(img.naturalHeight * r));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        done(c.toDataURL('image/jpeg', 0.72));
      } catch { done(''); }
    };
    img.onerror = () => done('');
    img.src = url;
  });
  thumbCache.set(url, p);
  if (thumbCache.size > 200) thumbCache.delete(thumbCache.keys().next().value);
  return p;
}

// ---------------------------------------------------------------- confetti (CSS in each app's stylesheet: .pl-confetti)
export function confetti(host, colors = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#f78c6b', '#a78bfa'], n = 46) {
  const box = h('div.pl-confetti');
  for (let i = 0; i < n; i++) {
    const x = Math.random() * 100, dx = (Math.random() - 0.5) * 30, rot = Math.random() * 900 - 450, d = 1.6 + Math.random() * 1.4;
    box.append(h('i', { '--dx': `${dx}cqmin`, '--r': `${rot}deg`, style: { left: `${x}%`, background: colors[i % colors.length], animationDuration: `${d}s`, animationDelay: `${Math.random() * 0.5}s`,
      width: `${1 + Math.random() * 1.2}cqmin`, height: `${1.6 + Math.random() * 1.6}cqmin` } }));
  }
  host.append(box);
  setTimeout(() => box.remove(), 3600);
}

// ---------------------------------------------------------------- Home Assistant (guarded — never throws to the caller unless asked)
const hass = () => { try { return provider('homeassistant'); } catch { return null; } };
export const haReady = () => { const ha = hass(); return !!(ha && ha.url && ha.isAuthed?.()); };
export async function haConnect(ms = 10000) {
  const ha = hass();
  if (!ha || !ha.url || !ha.isAuthed?.()) throw new Error('Home Assistant isn’t set up');
  if (ha.status !== 'ready' || !ha.mode) await Promise.race([ha.connect(), new Promise((_, rej) => setTimeout(() => rej(new Error('Home Assistant didn’t answer')), ms))]);
  return ha;
}
/** [{ id, name, on, color? }] for lights or scenes. */
export async function haEntities(domain) {
  const ha = await haConnect();
  return [...ha.states.values()].filter((s) => s.entity_id.startsWith(domain + '.') && s.state !== 'unavailable' && !ha.hidden?.has?.(s.entity_id))
    .map((s) => ({ id: s.entity_id, name: ha.entityName?.(s) || s.attributes?.friendly_name || s.entity_id, on: s.state === 'on', color: !!(s.attributes?.supported_color_modes || []).some((m) => /rgb|hs|xy/.test(m)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function haCall(domain, service, entityId, data = {}) {
  const ha = await haConnect();
  return ha.call(domain, service, entityId, data);
}

// ---------------------------------------------------------------- shared styles (QR box, confetti)
(function css() {
  if (typeof document === 'undefined' || document.getElementById('pl-css')) return;
  const st = document.createElement('style');
  st.id = 'pl-css';
  st.textContent = `
.pl-qr { background: #fff; border-radius: 2.6cqmin; padding: 1.2cqmin; line-height: 0; box-shadow: 0 1.4cqmin 5cqmin rgb(var(--shade) / .35); }
.pl-qr svg { display: block; width: 100%; height: auto; }
.pl-confetti { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 60; border-radius: 50%; }
.pl-confetti i { position: absolute; top: -4%; border-radius: .3cqmin; animation: pl-fall linear forwards; }
@keyframes pl-fall { 0% { transform: translate(0, 0) rotate(0); opacity: 1; } 85% { opacity: 1; } 100% { transform: translate(var(--dx), 112cqmin) rotate(var(--r)); opacity: 0; } }`;
  document.head.append(st);
})();
