// YouTube on your TV — controls the YouTube app on a Google TV / Android TV / smart TV /
// console, the same way the YouTube phone app does after "Link with TV code".
//
// Uses YouTube's (unofficial, undocumented) "Lounge" remote protocol — the one the YouTube
// phone app and projects like pyytlounge / iSponsorBlockTV use. It goes through
// youtube.com, so the TV doesn't even need to be on the same network as the bridge.
// Because it's unofficial, YouTube can change it at any time.
//
// Pair: on the TV open YouTube → Settings → "Link with TV code", then enter the code in
// Round Remote → YouTube tile → "YouTube on your TV".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { log, sleep } from '../lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'youtube-tv.json');
const BASE = 'https://www.youtube.com/api/lounge';
const DEVICE_NAME = 'Round Remote';
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)).toString();

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

// Title/channel for a video id without an API key (YouTube oEmbed), cached.
const meta = new Map();
async function videoMeta(id) {
  if (meta.has(id)) return meta.get(id);
  let m = { title: '', author: '' };
  try {
    const r = await fetch(`https://www.youtube.com/oembed?${qs({ url: `https://www.youtube.com/watch?v=${id}`, format: 'json' })}`);
    if (r.ok) { const j = await r.json(); m = { title: j.title || '', author: j.author_name || '' }; }
  } catch {}
  meta.set(id, m);
  return m;
}
function splitTitle(raw = '', channel = '') {
  const clean = raw.replace(/\s*[\(\[][^)\]]*(official|video|audio|lyrics?|visuali[sz]er|remaster(ed)?|hd|4k|mv)[^)\]]*[\)\]]/gi, '').trim();
  const ch = channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const m = clean.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: ch, title: clean };
}

/** Pull complete top-level JSON arrays out of a streamed "length\n[[...]]" body. */
function* takeArrays(state) {
  const s = state.buf;
  let depth = 0, start = -1, inStr = false, esc = false, consumed = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { if (depth > 0) inStr = true; continue; }
    if (c === '[') { if (depth === 0) start = i; depth++; }
    else if (c === ']') {
      depth--;
      if (depth === 0 && start >= 0) {
        const chunk = s.slice(start, i + 1);
        consumed = i + 1; start = -1;
        try { yield JSON.parse(chunk); } catch {}
      }
    }
  }
  state.buf = depth === 0 ? '' : s.slice(Math.max(consumed, start));
}

class Lounge {
  constructor(screen, deviceId, { onState, onToken }) {
    this.screen = screen; this.deviceId = deviceId;
    this.onState = onState; this.onToken = onToken;
    this.st = { videoId: null, currentTime: 0, duration: 0, state: '-1', volume: null, muted: false, hasNext: true, hasPrevious: true, sampledAt: Date.now() };
    this.stopped = false;
  }
  params(extra = {}) { return { VER: 8, CVER: 1, ...extra }; }

  async refreshToken() {
    const r = await fetch(`${BASE}/pairing/get_lounge_token_batch`, { method: 'POST', headers: FORM, body: qs({ screen_ids: this.screen.screenId }) });
    if (!r.ok) throw new Error(`token refresh HTTP ${r.status}`);
    const j = await r.json();
    const s = j.screens?.[0];
    if (!s?.loungeToken) throw new Error('no lounge token');
    this.screen.loungeToken = s.loungeToken;
    this.screen.expiration = s.expiration;
    this.onToken(this.screen);
  }

  async connect(retry = true) {
    this.rid = 1; this.ofs = 0; this.aid = 0; this.sid = null; this.gs = null;
    const body = qs({
      app: 'web', 'mdx-version': 3, name: DEVICE_NAME, id: this.deviceId, device: 'REMOTE_CONTROL',
      capabilities: 'que,dsdtr,atp', method: 'setPlaylist', magnaKey: 'cloudPairedDevice', ui: 'false',
      deviceContext: 'user_agent=dunno&window_width_points=&window_height_points=&os_name=android&ms=',
      theme: 'cl', loungeIdToken: this.screen.loungeToken,
    });
    const r = await fetch(`${BASE}/bc/bind?${qs(this.params({ RID: this.rid++, auth_failure_option: 'send_error' }))}`, { method: 'POST', headers: FORM, body });
    if ((r.status === 401 || r.status === 400) && retry) { await this.refreshToken(); return this.connect(false); }
    if (!r.ok) throw new Error(`connect HTTP ${r.status}`);
    const st = { buf: await r.text() };
    for (const events of takeArrays(st)) this.handle(events);
    if (!this.sid || !this.gs) throw new Error('TV did not accept the connection');
    this.poll();
    this.command('getNowPlaying').catch(() => {});
    this.command('getVolume').catch(() => {});
  }

  async poll() {
    while (!this.stopped) {
      try {
        const r = await fetch(`${BASE}/bc/bind?${qs(this.params({ RID: 'rpc', SID: this.sid, gsessionid: this.gs, CI: 0, TYPE: 'xmlhttp', AID: this.aid }))}`);
        if (r.status === 400 || r.status === 404 || r.status === 410 || r.status === 401) { await sleep(1000); await this.connect(); return; }
        if (!r.ok) { await sleep(5000); continue; }
        const st = { buf: '' };
        const dec = new TextDecoder();
        for await (const chunk of r.body) {
          if (this.stopped) return;
          st.buf += dec.decode(chunk, { stream: true });
          for (const events of takeArrays(st)) this.handle(events);
        }
      } catch (e) {
        if (this.stopped) return;
        log('youtubetv', `${this.screen.name}: ${e.message}`);
        await sleep(5000);
        try { await this.connect(); return; } catch {}
      }
    }
  }

  handle(events) {
    if (!Array.isArray(events)) return;
    let changed = false;
    for (const ev of events) {
      if (!Array.isArray(ev) || !Array.isArray(ev[1])) continue;
      const [id, [type, data]] = ev;
      if (typeof id === 'number') this.aid = Math.max(this.aid, id);
      const d = data || {};
      switch (type) {
        case 'c': this.sid = data; break;
        case 'S': this.gs = data; break;
        case 'nowPlaying':
          if (d.videoId) {
            this.st.videoId = d.videoId;
            this.st.currentTime = parseFloat(d.currentTime) || 0;
            this.st.duration = parseFloat(d.duration) || this.st.duration;
            if (d.state != null) this.st.state = String(d.state);
          } else { this.st.videoId = null; this.st.state = '-1'; }
          this.st.sampledAt = Date.now(); changed = true; break;
        case 'onStateChange':
          if (d.currentTime != null) this.st.currentTime = parseFloat(d.currentTime) || 0;
          if (d.duration != null) this.st.duration = parseFloat(d.duration) || this.st.duration;
          if (d.state != null) this.st.state = String(d.state);
          this.st.sampledAt = Date.now(); changed = true; break;
        case 'onVolumeChanged':
          this.st.volume = parseInt(d.volume, 10); this.st.muted = d.muted === 'true' || d.muted === true; changed = true; break;
        case 'onHasPreviousNextChanged':
          this.st.hasNext = d.hasNext !== 'false'; this.st.hasPrevious = d.hasPrevious !== 'false'; changed = true; break;
        case 'loungeScreenDisconnected': case 'remoteDisconnected':
          this.st.videoId = null; changed = true; break;
        default: break;
      }
    }
    if (changed) this.onState(this.st);
  }

  async command(sc, params = {}) {
    if (!this.sid) throw new Error('TV not connected');
    const body = { count: 1, ofs: this.ofs++, req0__sc: sc };
    for (const [k, v] of Object.entries(params)) body[`req0_${k}`] = v;
    const r = await fetch(`${BASE}/bc/bind?${qs(this.params({ SID: this.sid, gsessionid: this.gs, RID: this.rid++, AID: this.aid }))}`, { method: 'POST', headers: FORM, body: qs(body) });
    if (r.status === 400 || r.status === 404 || r.status === 410) { await this.connect(); return this.command(sc, params); }
    if (!r.ok) throw new Error(`command ${sc}: HTTP ${r.status}`);
  }
  stop() { this.stopped = true; }
}

export function create({ hub, setStatus }) {
  const state = loadState();
  state.deviceId ||= crypto.randomUUID();
  state.screens ||= [];
  saveState(state);
  const lounges = new Map(); // screenId -> Lounge

  async function publish(screen, st) {
    const id = st.videoId;
    const m = id ? await videoMeta(id) : null;
    const { artist, title } = m ? splitTitle(m.title, m.author) : {};
    hub.upsert('youtubetv', screen.screenId, {
      name: screen.name || 'YouTube on TV',
      sourceApp: 'YouTube',
      state: {
        track: id ? { id, title: title || m?.title || 'YouTube', artist: artist || m?.author || '', album: 'YouTube', art: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, durationMs: (st.duration || 0) * 1000 } : null,
        isPlaying: st.state === '1' || st.state === '3',
        progressMs: (st.currentTime || 0) * 1000,
        volume: Number.isFinite(st.volume) ? st.volume : null, muted: !!st.muted,
      },
      caps: { seek: true, volume: true, next: st.hasNext !== false, prev: st.hasPrevious !== false },
      sampledAt: st.sampledAt,
    });
  }
  function status() {
    setStatus(state.screens.length ? `${state.screens.length} TV${state.screens.length === 1 ? '' : 's'} linked` : 'no TV linked yet (YouTube tile → YouTube on your TV)', true);
  }
  async function attach(screen) {
    lounges.get(screen.screenId)?.stop();
    const l = new Lounge(screen, state.deviceId, {
      onState: (st) => publish(screen, st),
      onToken: () => saveState(state),
    });
    lounges.set(screen.screenId, l);
    publish(screen, l.st);
    try { await l.connect(); log('youtubetv', `connected to ${screen.name}`); }
    catch (e) { log('youtubetv', `${screen.name}: ${e.message}`); setTimeout(() => lounges.get(screen.screenId) === l && attach(screen), 30000); }
  }
  const lounge = (id) => { const l = lounges.get(id); if (!l) throw new Error('TV not linked'); return l; };

  return {
    id: 'youtubetv',
    async start() { status(); for (const s of state.screens) attach(s); },
    stop() { for (const l of lounges.values()) l.stop(); },
    async command(id, cmd, value) {
      const l = lounge(id);
      if (cmd === 'play') await l.command('play');
      else if (cmd === 'pause') await l.command('pause');
      else if (cmd === 'next') await l.command('next');
      else if (cmd === 'prev') await l.command('previous');
      else if (cmd === 'seek') await l.command('seekTo', { newTime: Math.round(value / 1000) });
      else if (cmd === 'volume') await l.command('setVolume', { volume: Math.round(value) });
      else throw new Error(`${cmd} is not supported on YouTube TV`);
    },
    async play(id, item) {
      const l = lounge(id);
      if (item.kind === 'playlist') await l.command('setPlaylist', { listId: item.id, videoId: item.firstVideoId || '', currentIndex: 0, currentTime: 0 });
      else await l.command('setPlaylist', { videoId: item.id, currentTime: 0, currentIndex: -1, audioOnly: 'false' });
    },
    actions: {
      async pair({ code }) {
        const pairing_code = String(code || '').replace(/\D/g, '');
        if (pairing_code.length < 8) throw new Error('Enter the code shown on the TV (YouTube → Settings → Link with TV code)');
        const r = await fetch(`${BASE}/pairing/get_screen`, { method: 'POST', headers: FORM, body: qs({ pairing_code }) });
        if (!r.ok) throw new Error(r.status === 404 ? 'That code wasn’t accepted — check it and try again' : `Pairing failed (HTTP ${r.status})`);
        const j = await r.json();
        const s = j.screen;
        if (!s?.screenId) throw new Error('Pairing failed');
        const screen = { screenId: s.screenId, name: s.name || 'YouTube on TV', loungeToken: s.loungeToken, expiration: s.expiration };
        state.screens = state.screens.filter((x) => x.screenId !== screen.screenId).concat(screen);
        saveState(state); status();
        attach(screen);
        return { name: screen.name, id: `youtubetv:${screen.screenId}` };
      },
      async list() { return state.screens.map((s) => ({ id: `youtubetv:${s.screenId}`, name: s.name })); },
      async unpair({ id }) {
        const sid = String(id || '').replace(/^youtubetv:/, '');
        lounges.get(sid)?.stop(); lounges.delete(sid);
        state.screens = state.screens.filter((x) => x.screenId !== sid);
        saveState(state); hub.remove('youtubetv', sid); status();
        return { ok: true };
      },
    },
  };
}
