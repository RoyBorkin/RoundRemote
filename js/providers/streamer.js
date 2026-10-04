// Music streamer (Home → Fosi S3): StreamUnlimited "StreamSDK" streamers — the Fosi Audio S3 and other network
// streamers built on StreamUnlimited modules, recognisable by their web page at http://<ip>/webclient.
// Their small JSON API (port 80) gives everything the round screen needs:
//   getData  player:player/data (state, track, artwork, audio format, allowed controls) · player:volume ·
//            settings:/mediaPlayer/mute · player:player/data/playTime · …/playMode · powermanager:target ·
//            settings:/deviceName · settings:/system/productName · settings:/version
//   getRows  ui:  → the device's own source list (music services, inputs), "Control" switches and the
//            "Audio Output Mode" choices — the screen is built from these, nothing about the model is hard-coded
//   setData  role "value" (volume, mute, play mode, power) · role "activate" (player:player/control {control},
//            ui:/aux, ui:/spdifin… to switch input, ui:/custom/audioOutputMode… for the output)
// The page talks to the device DIRECTLY when it's served over http and the device allows it (CORS), otherwise
// THROUGH THE BRIDGE (bridge/adapters/streamsdk.js: /api/streamsdk/*, with live change events over SSE).
import { Emitter, http, qs, throttle, isPrivateHost } from '../core/util.js';
import { store } from '../core/store.js';
import { bridgeBase, bridgeFetch } from './bridge.js';

export const P = {
  player: 'player:player/data', playTime: 'player:player/data/playTime', playMode: 'player:player/data/playMode',
  control: 'player:player/control', volume: 'player:volume', mute: 'settings:/mediaPlayer/mute', power: 'powermanager:target',
  name: 'settings:/deviceName', product: 'settings:/system/productName', version: 'settings:/version',
};

/** "http://192.168.1.5/webclient/#/main" | "192.168.1.5" → "192.168.1.5" (with :port when not 80); '' when unusable. */
export function normHost(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = `http://${s}`;
  // a half-typed IP ("192.168.") isn't an address
  const bare = s.replace(/^[a-z]+:\/\//i, '').replace(/[/:?#].*$/, '');
  if (/^[\d.]+$/.test(bare) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return '';
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) && u.hostname ? (u.port ? u.host : u.hostname) : ''; } catch { return ''; }
}
/** StreamSDK values are typed: {type:'i32_', i32_: 40}. getData answers an array with roles=value, an object with @all. */
export function unwrap(v) {
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === 'object' && 'value' in v && (v.type === 'value' || 'path' in v || 'modifiable' in v || 'title' in v)) v = v.value;
  if (v && typeof v === 'object' && typeof v.type === 'string' && v.type in v) return v[v.type];
  return v;
}
const typed = (type, v) => ({ type, [type]: v });

// ---------------------------------------------------------------- sources: the device's names → our look
// key · label · Simple Icons slug or local glyph · colour · what to do when it's tapped
export const KNOWN = [
  { key: 'spotify', re: /spotify/i, name: 'Spotify', mono: 'Sp', icon: 'spotify', color: '#1ed760', hint: (d) => `Open Spotify on your phone, tap the devices icon and pick “${d}”.` },
  { key: 'qobuz', re: /qobuz/i, name: 'Qobuz', mono: 'Qb', color: '#4d9dff', hint: (d) => `Open Qobuz, tap the Qobuz Connect icon and pick “${d}”.` },
  { key: 'tidal', re: /tidal/i, name: 'TIDAL', mono: 'Ti', icon: 'tidal', color: '#33ffee', hint: (d) => `Open the TIDAL app on your phone, tap the speaker icon and pick “${d}”.` },
  { key: 'roon', re: /roon/i, name: 'Roon', mono: 'Rn', icon: 'roon', color: '#a78bfa', hint: (d) => `Open Roon and pick “${d}” as the zone (Roon Ready).` },
  { key: 'deezer', re: /deezer/i, name: 'Deezer', mono: 'Dz', icon: 'deezer', color: '#a238ff', hint: (d) => `Open Deezer and pick “${d}” under Audio devices.` },
  { key: 'amazon', re: /amazon/i, name: 'Amazon Music', mono: 'Am', icon: 'amazonmusic', color: '#25d1da', hint: (d) => `Open Amazon Music and pick “${d}”.` },
  { key: 'tunein', re: /tunein|vtuner|radio|iheart/i, name: 'Radio', glyph: 'radio', color: '#f97316' },
  { key: 'cast', re: /cast|chromecast/i, name: 'Google Cast', mono: 'Gc', icon: 'googlecast', color: '#ff8a3d', hint: (d) => `Tap the Cast icon in any Cast-enabled app (YouTube Music, Spotify, Pandora…) and pick “${d}”.` },
  { key: 'airplay', re: /airplay|raop/i, name: 'AirPlay', mono: 'Ap', icon: 'airplayaudio', color: '#5ac8fa', hint: (d) => `Pick “${d}” as the AirPlay speaker on your iPhone, iPad or Mac.` },
  { key: 'upnp', re: /upnp|dlna|renderer/i, name: 'UPnP', mono: 'Up', icon: 'dlna', color: '#2dd4bf', hint: (d) => `Send music to “${d}” from a UPnP / DLNA app (BubbleUPnP, mconnect, JPLAY…).` },
  { key: 'bluetooth', re: /bluetooth|\bbt\b/i, name: 'Bluetooth', glyph: 'bluetooth', color: '#3b82f6', input: true },
  { key: 'hdmi', re: /hdmi|\barc\b/i, name: 'HDMI', glyph: 'hdmi', color: '#c084fc', input: true },
  { key: 'optical', re: /spdif|optical|toslink/i, name: 'Optical', glyph: 'optical', color: '#f43f5e', input: true },
  { key: 'coax', re: /coax/i, name: 'Coaxial', glyph: 'coax', color: '#fb7185', input: true },
  { key: 'usb', re: /\busb/i, name: 'USB', glyph: 'usb', color: '#94a3b8', input: true },
  { key: 'linein', re: /\baux|line[\s_-]?in|analog|phono/i, name: 'Line In', glyph: 'linein', color: '#f0b46b', input: true },
];
export const knownFor = (text) => KNOWN.find((k) => k.re.test(text || '')) || null;
const cleanTitle = (t = '') => t.replace(/\s+(in|out)$/i, (m) => (/hdmi/i.test(t) ? '' : m)).replace(/^Hdmi\b/, 'HDMI');

// ---------------------------------------------------------------- audio format
const CODEC = { mpeg: 'MP3', mp3: 'MP3', 'mp4': 'AAC', aac: 'AAC', 'x-m4a': 'AAC', m4a: 'AAC', flac: 'FLAC', 'x-flac': 'FLAC', ogg: 'OGG', vorbis: 'OGG', opus: 'Opus', wav: 'WAV', 'x-wav': 'WAV', wave: 'WAV',
  aiff: 'AIFF', 'x-aiff': 'AIFF', alac: 'ALAC', dsd: 'DSD', dsf: 'DSD', dff: 'DSD', sbc: 'SBC', ldac: 'LDAC', aptx: 'aptX', pcm: 'PCM', l16: 'PCM', mqa: 'MQA' };
export function audioFormat(r = {}) {
  const raw = String(r.codec || r.encoding || (r.mimeType || r.mime || '').split('/')[1] || '').toLowerCase().replace(/;.*/, '');
  const codec = CODEC[raw] || (raw ? raw.replace(/^x-/, '').toUpperCase() : '');
  let sf = +(r.sampleFrequency || r.sampleRate || 0);
  if (sf && sf < 1000) sf *= 1000;   // some firmwares give kHz
  const bits = +(r.bitsPerSample || r.bitDepth || 0);
  const kbps = r.bitRate ? Math.round(+r.bitRate / (+r.bitRate > 5000 ? 1000 : 1)) : 0;
  const khz = sf ? `${(sf / 1000).toFixed(sf % 1000 ? 1 : 0)} kHz` : '';
  const quality = bits && khz ? `${bits}-bit / ${khz}` : khz || (bits ? `${bits}-bit` : kbps ? `${kbps} kbps` : '');
  return { text: [codec, quality].filter(Boolean).join(' · '), hires: bits >= 24 || sf > 48000, codec, lossless: /FLAC|ALAC|WAV|AIFF|DSD|PCM/.test(codec) };
}

const errText = (e) => e?.body?.error || e?.userMessage || e?.message || 'Something went wrong';

export class StreamerService extends Emitter {
  constructor(meta) {
    super();
    Object.assign(this, meta);
    this.mode = null;          // 'direct' | 'bridge'
    this.modeHost = '';
    this.base = '';            // bridge base URL (bridge mode)
    this.error = null;         // { kind: 'bridge'|'unreachable'|'auth'|'adapter'|'other', message }
    this.loaded = false;
    this.device = null;        // { name, product, version }
    this.now = null;           // parsed player data (see _parsePlayer)
    this.volume = null; this.volMax = 100; this.volStep = 1; this.muted = false;
    this.posMs = 0; this.posAt = 0;
    this.sources = []; this.outputs = []; this.switches = [];
    this.mutePath = P.mute;
    this.power = null;         // { state: 'on'|'standby', raw, modifiable }
    this.playMode = null;      // { shuffle, repeat: 'off'|'one'|'all', raw }
    this.pending = null;       // { key, at } — an input we just switched to
    this.users = 0; this.timers = {}; this.es = null; this.pushOk = false;
    this.volUserAt = 0;
    this._sendVol = throttle((v) => this._set(P.volume, 'value', typed('i32_', v)).catch((e) => this._fail(e, true)), 200);
    this._vis = () => { if (document.hidden) this._pause(); else if (this.users) this._resume(); };
  }

  // ---------- setup
  get host() { return store.auth(this.id)?.host || ''; }
  get deviceName() { return this.device?.name || store.auth(this.id)?.name || this.name; }
  setupHint() { return ''; }
  isAuthed() { return !!this.host; }
  saveHost(host, info = {}) { store.setAuth(this.id, { host, name: info.name || '', product: info.product || '', version: info.version || '' }); if (this.modeHost !== host) this.mode = null; }
  async signOut() { this.stop(true); store.setAuth(this.id, null); this.mode = null; this.device = null; this.now = null; this.loaded = false; }

  // ---------- transport: direct or through the bridge
  async _pickMode(host) {
    if (this.mode && this.modeHost === host) return this.mode;
    this.modeHost = host;
    // Direct only from a plain-http page (served by the bridge or on the LAN) and only if the device sends CORS headers.
    if (location.protocol === 'http:' && isPrivateHost(host.replace(/:\d+$/, ''))) {
      try {
        await http(`http://${host}/api/getData?${qs({ path: P.name, roles: 'value' })}`, { timeout: 2500 });
        this.mode = 'direct';
        return this.mode;
      } catch {}
    }
    this.base = await bridgeBase();
    if (!this.base) throw Object.assign(new Error('Bridge not found'), { kind: 'bridge' });
    this.mode = 'bridge';
    return this.mode;
  }
  async _req(kind, args, host = this.host) {
    if (!host) throw Object.assign(new Error('No streamer address set'), { kind: 'setup' });
    const mode = await this._pickMode(host);
    if (mode === 'direct') {
      const b = `http://${host}/api`;
      if (kind === 'getData') return http(`${b}/getData?${qs({ path: args.path, roles: args.roles })}`, { timeout: 6000 });
      if (kind === 'getRows') return http(`${b}/getRows?${qs({ path: args.path, roles: '@all', from: args.from, to: args.to })}`, { timeout: 6000 });
      if (kind === 'setData') return http(`${b}/setData`, { method: 'POST', json: { path: args.path, role: args.role, value: args.value }, timeout: 6000 });
    }
    if (kind === 'getData') return bridgeFetch(`/api/streamsdk/getData?${qs({ host, path: args.path, roles: args.roles })}`, { timeout: 9000 });
    if (kind === 'getRows') return bridgeFetch(`/api/streamsdk/getRows?${qs({ host, path: args.path, roles: '@all', from: args.from, to: args.to })}`, { timeout: 9000 });
    if (kind === 'setData') return bridgeFetch('/api/streamsdk/setData', { method: 'POST', json: { host, ...args }, timeout: 9000 });
    throw new Error(`unknown request ${kind}`);
  }
  _get(path, roles = 'value', host) { return this._req('getData', { path, roles }, host); }
  _rows(path, from = 0, to = 60, host) { return this._req('getRows', { path, from, to }, host); }
  _set(path, role, value) { return this._req('setData', { path, role, value }); }

  /** Sort an error into what the screen should say. */
  describe(e) {
    const msg = errText(e), st = e?.status;
    if (e?.kind === 'bridge' || /bridge not (found|reachable)/i.test(msg)) return { kind: 'bridge', message: 'The streamer is reached through the bridge on your computer or Pi, and it isn’t running.' };
    if (e?.kind === 'setup') return { kind: 'setup', message: 'Enter the streamer’s address first.' };
    if (st === 401 || e?.body?.auth) return { kind: 'auth', message: 'The streamer’s web interface is password-protected — that isn’t supported yet. Turn off its web-interface password and try again.' };
    if (st === 404 && /unknown streamsdk|not found$/i.test(msg) && this.mode === 'bridge') return { kind: 'adapter', message: 'This bridge has no streamer support yet — update the bridge (bridge/adapters/streamsdk.js) and restart it.' };
    if (st === 404 && /disabled/i.test(msg)) return { kind: 'adapter', message: msg };
    if (e?.body?.unreachable || st === 502 || st === 504 || (this.mode === 'direct' && (e instanceof TypeError || e?.name === 'AbortError'))) return { kind: 'unreachable', message: e?.body?.error || `Can’t reach the streamer at ${this.host}.` };
    if (e instanceof TypeError || e?.name === 'AbortError' || /failed to fetch|networkerror|load failed/i.test(msg)) return { kind: 'bridge', message: 'The bridge stopped answering.' };
    if (st === 403) return { kind: 'other', message: msg };
    return { kind: 'other', message: msg };
  }
  _fail(e, quiet = false) {
    const d = this.describe(e);
    if (d.kind === 'bridge') { this.mode = null; }
    if (!quiet || !this.loaded) { this.error = d; this.emit('change'); }
    this.emit('error', d);
    return d;
  }

  /** Setup page: talk to a device once. → { name, product, version, via } */
  async test(hostInput) {
    const host = normHost(hostInput);
    if (!host) throw Object.assign(new Error('Enter the streamer’s address, e.g. 192.168.50.156'), { userMessage: 'Enter the streamer’s address, e.g. 192.168.50.156' });
    this.mode = null;
    try {
      const [name, product, version] = await Promise.all([this._get(P.name, 'value', host), this._get(P.product, 'value', host).catch(() => null), this._get(P.version, 'value', host).catch(() => null)]);
      return { host, name: unwrap(name) || '', product: unwrap(product) || '', version: unwrap(version) || '', via: this.mode };
    } catch (e) { const d = this.describe(e); throw Object.assign(new Error(d.message), { userMessage: d.message, kind: d.kind }); }
  }

  // ---------- reading state
  _parsePlayer(d) {
    d = unwrap(d) || {};
    const tr = d.trackRoles || {}, md = tr.mediaData?.metaData || {}, mr = d.mediaRoles || {}, mmd = mr.mediaData?.metaData || {};
    const res = tr.mediaData?.resources || [];
    const r = res[tr.mediaData?.activeResource ?? 0] || res[0] || {};
    const serviceId = md.serviceID || mmd.serviceID || '';
    const serviceName = md.serviceName || mmd.serviceName || '';
    const source = [serviceId, md.playbackSource, serviceName, mr.path, md.serviceIcon, mmd.serviceIcon].filter(Boolean).join(' ');
    let title = tr.title || '';
    const artist = md.artist || md.albumArtist || '', album = md.album || '';
    // inputs report their own name as the "title" and nothing else
    const bare = !artist && !album && (!title || title === serviceName || title === mr.title || knownFor(title)?.input);
    const dur = +(d.status?.duration || tr.mediaData?.duration || r.duration || 0);
    return {
      state: String(d.state || d.status?.state || 'stopped').toLowerCase(),
      title: bare ? '' : title, artist, album, station: md.radioStation || '',
      art: tr.icon || mr.icon || '', source, serviceId, serviceName,
      known: knownFor(source), bare, durationMs: dur > 0 ? dur : 0,
      format: r && Object.keys(r).length ? audioFormat(r) : null,
      controls: d.controls && typeof d.controls === 'object' ? d.controls : null,
      error: typeof d.error === 'string' ? d.error : d.error?.message || '',
      idle: !title && !serviceId && !serviceName,
      raw: d,
    };
  }
  _applyVolume(v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && v.edit) { this.volMax = +v.edit.max || 100; this.volStep = +v.edit.step || 1; }
    const n = +unwrap(v);
    if (Number.isFinite(n) && Date.now() - this.volUserAt > 1500) this.volume = n;
  }
  _applyPos(v) { const n = +unwrap(v); if (Number.isFinite(n)) { this.posMs = n; this.posAt = performance.now(); } }
  /** Position now (extrapolated while playing). */
  position() {
    if (!this.now) return 0;
    const run = this.now.state === 'playing' ? performance.now() - this.posAt : 0;
    const p = this.posMs + Math.max(0, run);
    return this.now.durationMs ? Math.min(p, this.now.durationMs) : p;
  }

  /** The bits that change while playing. */
  async refreshState() {
    const [pd, vol, mute, pt] = await Promise.all([
      this._get(P.player, 'value'),
      this._get(P.volume, '@all').catch(() => null),
      this._get(this.mutePath, 'value').catch(() => null),
      this._get(P.playTime, 'value').catch(() => null),
    ]);
    this._ingestPlayer(pd);
    if (vol != null) this._applyVolume(vol);
    if (mute != null && Date.now() - (this.muteUserAt || 0) > 1500) this.muted = !!unwrap(mute);
    if (pt != null) this._applyPos(pt);
    this.error = null; this.loaded = true;
    this.emit('change');
  }
  _ingestPlayer(pd) {
    const prevTitle = this.now?.title;
    this.now = this._parsePlayer(pd);
    if (this.pending && (Date.now() - this.pending.at > 12000 || this.now.known?.key === this.pending.key)) this.pending = null;
    if (prevTitle !== this.now.title) this.emit('track', this.now);
  }

  /** Everything else: name, sources, outputs, switches, power, play mode. */
  async refreshSetup() {
    const [name, product, version, ui, pw, pm] = await Promise.all([
      this._get(P.name), this._get(P.product).catch(() => null), this._get(P.version).catch(() => null),
      this._uiRows().catch(() => null), this._get(P.power, '@all').catch(() => null), this._get(P.playMode, '@all').catch(() => null),
    ]);
    this.device = { name: unwrap(name) || this.name, product: unwrap(product) || '', version: unwrap(version) || '' };
    const a = store.auth(this.id);
    if (a && a.name !== this.device.name) store.setAuth(this.id, { ...a, ...this.device });
    if (ui) this._ingestUi(ui);
    this.power = this._parsePower(pw);
    this.playMode = this._parsePlayMode(pm);
    this.emit('change');
  }
  async _uiRows() {
    const out = [];
    const r = await this._rows('ui:', 0, 80);
    const rows = r?.rows || [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      out.push(row);
      // a header that is a container of its own (not followed by its items): read its rows too
      if (String(row?.type) === 'header' && row.path && (!rows[i + 1] || rows[i + 1].type === 'header')) {
        const sub = await this._rows(row.path, 0, 40).catch(() => null);
        for (const s of sub?.rows || []) out.push(s);
      }
    }
    return out;
  }
  _ingestUi(rows) {
    let group = '';
    const sources = [], outputs = [], switches = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const type = String(row.type || '');
      const title = row.title || row.label || '';
      if (type === 'header') { group = title; continue; }
      if (!row.path) continue;
      if (/output/i.test(group)) { outputs.push({ path: row.path, title, label: title.replace(/\s*out(put)?$/i, '').replace(/\//g, ' / '), active: !!(row.preferred ?? row.selected ?? row.active), optical: /optical|spdif|toslink/i.test(title + row.path) }); continue; }
      if (type === 'value') {
        const v = row.value;
        if (v && typeof v === 'object' && v.type === 'bool_') {
          if (/mute/i.test(row.path) && !/mic/i.test(row.path + title)) { this.mutePath = row.path; continue; }
          switches.push({ path: row.path, title, on: !!v.bool_, modifiable: row.modifiable !== false });
        }
        continue;
      }
      if (!['container', 'app', 'action'].includes(type)) continue;
      const k = knownFor(`${row.path} ${title} ${row.icon || ''}`);
      sources.push({
        path: row.path, type, title: cleanTitle(title) || k?.name || row.path, group,
        key: k?.key || row.path.replace(/^.*\//, '').toLowerCase(), known: k,
        input: type === 'action', color: k?.color || '#94a3b8', mono: k?.mono || (title || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2),
      });
    }
    this.sources = sources;
    // keep a just-picked output while the device catches up
    if (this.outPending && Date.now() - this.outPending.at < 5000) outputs.forEach((o) => { o.active = o.path === this.outPending.path; });
    this.outputs = outputs;
    this.switches = switches;
  }
  _parsePower(pw) {
    if (!pw) return null;
    const v = unwrap(pw);
    const target = typeof v === 'string' ? v : v?.target || v?.state || v?.powerTarget?.target || '';
    if (!target) return null;
    const standby = /standby|off|sleep|idle/i.test(target);
    return { state: standby ? 'standby' : 'on', target, raw: pw.value || null, modifiable: pw.modifiable !== false && !Array.isArray(pw) };
  }
  _parsePlayMode(pm) {
    if (!pm || Array.isArray(pm) || pm.modifiable === false) return null;
    const v = unwrap(pm);
    if (typeof v === 'string') return { shuffle: /shuffle/i.test(v), repeat: /repeatone/i.test(v) ? 'one' : /repeatall/i.test(v) ? 'all' : 'off', type: pm.value?.type || 'playerPlayMode', form: 'string' };
    if (v && typeof v === 'object') return { shuffle: !!v.shuffle, repeat: v.repeat === true ? 'all' : String(v.repeat || 'off').toLowerCase().replace(/^repeat/, '') || 'off', type: pm.value?.type || 'playerPlayMode', form: 'object' };
    return null;
  }

  // ---------- which source is playing
  activeKey() {
    if (this.pending) return this.pending.key;
    const n = this.now;
    if (!n || n.state === 'stopped' && n.idle) return null;
    const bySrc = this.sources.find((s) => n.raw?.mediaRoles?.path && s.path === n.raw.mediaRoles.path);
    if (bySrc) return bySrc.key;
    if (n.known) return n.known.key;
    const txt = n.source.toLowerCase();
    return this.sources.find((s) => txt && (txt.includes(s.key) || txt.includes(s.title.toLowerCase())))?.key || null;
  }
  activeSource() {
    const k = this.activeKey();
    return this.sources.find((s) => s.key === k) || (this.now?.known && k === this.now.known.key ? { key: k, title: this.now.serviceName || this.now.known.name, known: this.now.known, color: this.now.known.color, input: !!this.now.known.input, mono: this.now.known.mono } : null);
  }
  /** Allowed transport buttons. */
  caps() {
    // inputs that send no track info (Line In, Optical, HDMI) can only be stopped; Bluetooth with AVRCP metadata skips too
    const c = this.now?.controls, src = this.activeSource(), input = !!(this.now?.bare && (src?.input || this.now?.known?.input));
    const pick = (...keys) => { for (const k of keys) if (c && k in c) return !!c[k]; return null; };
    const next = pick('next_', 'next', 'skipNext'), prev = pick('previous', 'prev', 'previous_', 'skipPrevious'), pause = pick('pause'), stop = pick('stop');
    return {
      next: next ?? !input, prev: prev ?? !input,
      pause: pause ?? !input, stop: stop ?? true,
    };
  }

  // ---------- live updates
  start() {
    if (this.users++ === 0) { document.addEventListener('visibilitychange', this._vis); this._resume(); }
  }
  stop(force = false) {
    if (!force && --this.users > 0) return;
    this.users = 0; this._pause(); document.removeEventListener('visibilitychange', this._vis);
  }
  _pause() { this.gen = (this.gen || 0) + 1; for (const t of Object.values(this.timers)) clearTimeout(t); this.timers = {}; this.es?.close(); this.es = null; this.pushOk = false; }
  async _resume() {
    this._pause();
    const gen = this.gen;
    if (!this.host) return;
    try { await Promise.all([this.refreshState(), this.refreshSetup()]); }
    catch (e) {
      if (gen !== this.gen) return;
      this._fail(e);
      this.timers.retry = setTimeout(() => this.users && !document.hidden && this._resume(), this.error?.kind === 'auth' ? 30000 : 5000);
      return;
    }
    if (gen !== this.gen || !this.users) return;   // stopped meanwhile
    if (this.mode === 'bridge') this._events();
    this._tick();
    const slow = () => { this.timers.slow = setTimeout(() => { this.refreshSetup().catch(() => {}).finally(() => gen === this.gen && slow()); }, 60000); };
    slow();
  }
  /** Poll: every 1.5 s without push events, every 5 s (position) / 20 s (everything) with them. */
  _tick() {
    clearTimeout(this.timers.tick);
    const gen = this.gen;
    const ms = this.pushOk ? (this.now?.state === 'playing' ? 5000 : 20000) : 1500;
    this.timers.tick = setTimeout(async () => {
      if (!this.users || gen !== this.gen) return;
      try {
        if (this.pushOk && this.now?.state === 'playing' && (this._fullAt || 0) > Date.now() - 20000) {
          this._applyPos(await this._get(P.playTime)); this.emit('change');
        } else { await this.refreshState(); this._fullAt = Date.now(); }
        if (this.error) { this.error = null; this.emit('change'); }
      } catch (e) { this._fail(e, true); if (this.loaded && this.describe(e).kind !== 'other') { this.error = this.describe(e); this.emit('change'); } }
      if (gen === this.gen) this._tick();
    }, ms);
  }
  _events() {
    if (!this.base || typeof EventSource === 'undefined') return;
    const paths = [P.player, P.volume, this.mutePath, P.power, this.playMode ? P.playMode : null].filter(Boolean);
    try {
      const es = new EventSource(`${this.base}/api/streamsdk/events?${qs({ host: this.host, paths: paths.join(',') })}`);
      this.es = es;
      const due = new Set(); let t = null;
      es.addEventListener('ready', () => { this.pushOk = true; this._tick(); });
      const noPush = () => { if (this.pushOk) { this.pushOk = false; this._tick(); } };
      es.addEventListener('nopush', noPush);
      es.addEventListener('stall', noPush);   // the device's event queue failed: poll until it's back
      es.addEventListener('change', (ev) => {
        let paths = [];
        try { paths = JSON.parse(ev.data).paths || []; } catch {}
        paths.forEach((p) => due.add(p));
        clearTimeout(t);
        t = setTimeout(() => { const list = [...due]; due.clear(); this._refetch(list); }, 120);
      });
      es.onerror = noPush;
    } catch { this.es = null; }
  }
  async _refetch(paths) {
    try {
      await Promise.all(paths.map(async (p) => {
        if (p === P.player) { this._ingestPlayer(await this._get(P.player)); this._applyPos(await this._get(P.playTime).catch(() => this.posMs)); }
        else if (p === P.volume) this._applyVolume(await this._get(P.volume, '@all'));
        else if (p === this.mutePath) { if (Date.now() - (this.muteUserAt || 0) > 1500) this.muted = !!unwrap(await this._get(p)); }
        else if (p === P.power) this.power = this._parsePower(await this._get(P.power, '@all'));
        else if (p === P.playMode) this.playMode = this._parsePlayMode(await this._get(P.playMode, '@all'));
      }));
      this.emit('change');
    } catch (e) { this._fail(e, true); }
  }

  // ---------- control
  async _do(fn, after = 350) {
    try { await fn(); } catch (e) { const d = this._fail(e, true); throw Object.assign(new Error(d.message), { userMessage: d.message }); }
    if (!this.pushOk) setTimeout(() => this.refreshState().catch(() => {}), after);
  }
  control(control) {
    // optimistic
    if (this.now) {
      if (control === 'pause') { this.posMs = this.position(); this.now.state = 'paused'; }
      if (control === 'play') { this.posAt = performance.now(); this.now.state = 'playing'; }
      if (control === 'stop') this.now.state = 'stopped';
      this.emit('change');
    }
    return this._do(() => this._set(P.control, 'activate', { control }));
  }
  toggle() {
    const playing = this.now?.state === 'playing';
    if (!playing) return this.control('play');
    return this.control(this.caps().pause ? 'pause' : 'stop');
  }
  next() { return this.control('next'); }
  prev() { return this.control('previous'); }
  setVolume(v) {
    v = Math.max(0, Math.min(this.volMax, Math.round(v / this.volStep) * this.volStep));
    if (v === this.volume) return;
    this.volume = v; this.volUserAt = Date.now();
    if (this.muted && v > 0) this.setMute(false);
    this.emit('volume', v);
    this._sendVol(v);
  }
  setMute(on) {
    this.muted = !!on; this.muteUserAt = Date.now(); this.emit('change');
    return this._do(() => this._set(this.mutePath, 'value', typed('bool_', !!on)));
  }
  setSwitch(sw, on) {
    sw.on = !!on; this.emit('change');
    return this._do(() => this._set(sw.path, 'value', typed('bool_', !!on)));
  }
  /** Switch to an input (action rows). Services / apps only answer with how to start them. */
  async pickSource(src) {
    if (src.type !== 'action') return { hint: src.known?.hint?.(this.deviceName) || `Open the ${src.title} app on your phone and pick “${this.deviceName}”.` };
    this.pending = { key: src.key, at: Date.now() };
    this.emit('change');
    await this._do(() => this._set(src.path, 'activate', {}), 600);
    return { switched: true };
  }
  async setOutput(o) {
    this.outputs.forEach((x) => { x.active = x === o; });
    this.outPending = { path: o.path, at: Date.now() };
    this.emit('change');
    await this._do(() => this._set(o.path, 'activate', {}));
    setTimeout(() => this.refreshSetup().catch(() => {}), 1200);
  }
  async setPower(on) {
    const pw = this.power;
    if (!pw) throw new Error('Power isn’t controllable on this streamer');
    const target = on ? 'online' : 'networkStandby';
    let value;
    const raw = pw.raw;
    if (raw && typeof raw === 'object' && raw.type) {
      const inner = raw[raw.type];
      value = typeof inner === 'string' ? typed(raw.type, target) : { type: raw.type, [raw.type]: { ...(inner || {}), target, reason: inner?.reason || 'userActivity' } };
    } else value = { type: 'powerTarget', powerTarget: { target, reason: 'userActivity' } };
    this.power = { ...pw, state: on ? 'on' : 'standby', target };
    this.emit('change');
    await this._do(() => this._set(P.power, 'value', value), 1500);
  }
  async setPlayMode({ shuffle = this.playMode?.shuffle, repeat = this.playMode?.repeat } = {}) {
    const pm = this.playMode;
    if (!pm) return;
    this.playMode = { ...pm, shuffle, repeat };
    this.emit('change');
    let v;
    if (pm.form === 'object') v = { type: pm.type, [pm.type]: { shuffle, repeat } };
    else {
      const r = repeat === 'one' ? 'RepeatOne' : repeat === 'all' ? 'RepeatAll' : '';
      const name = shuffle ? `shuffle${r}` : r ? r[0].toLowerCase() + r.slice(1) : 'normal';
      v = typed(pm.type, name);
    }
    await this._do(() => this._set(P.playMode, 'value', v));
  }

  /** An image URL the page can show: device-relative and LAN http art goes through the bridge. */
  artUrl(u) {
    if (!u || /^skin:/i.test(u)) return '';
    if (/^data:/i.test(u)) return u;
    let abs;
    try { abs = new URL(u, `http://${this.host}/`); } catch { return ''; }
    if (abs.protocol === 'https:') return abs.href;
    if (abs.protocol !== 'http:') return '';
    if (this.mode === 'direct' || !isPrivateHost(abs.hostname)) return abs.href;
    return this.base ? `${this.base}/api/streamsdk/art?${qs({ host: this.host, url: abs.href })}` : '';
  }
}
