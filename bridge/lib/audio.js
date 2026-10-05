// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Audio for the Rhythm category (no dependencies besides an `ffmpeg` binary):
//  • capture of THIS computer's sound output with ffmpeg → raw mono s16le PCM streamed over chunked HTTP
//    (one ffmpeg for all listeners, started with the first, stopped 5 s after the last one leaves)
//  • tempo lookup (ReccoBeats by Spotify ID / artist catalogue, Deezer search) — free, no keys
//  • audio file download proxy (Plex / Jellyfin servers without CORS)
//
// Routes (wired in server.js):  GET /api/audio/status · /api/audio/devices · /api/audio/stream?rate=
//                               GET /api/audio/fetch?url= · /api/audio/tempo?title=&artist=&spotifyId=
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { log } from './util.js';

const DEFAULTS = {
  enabled: true,
  ffmpeg: 'ffmpeg',      // path to the ffmpeg binary
  device: '',            // capture device name (Windows dshow / macOS avfoundation name or index / Linux pulse source or ALSA hw:…)
  input: null,           // full ffmpeg input args, overrides device detection, e.g. ["-f","pulse","-i","alsa_output.x.monitor"]
  sampleRate: 22050,     // default stream rate when the client doesn't ask
  graceMs: 5000,         // keep ffmpeg running this long after the last listener leaves
  maxFetchMB: 80,        // /api/audio/fetch size limit
  tempo: true,           // allow online tempo lookups
  reccobeatsApi: 'https://api.reccobeats.com/v1',
  deezerApi: 'https://api.deezer.com',
};

const OS = process.platform;
const LOOPBACK_RE = {
  win32: [/stereo ?mix/i, /what ?u ?hear/i, /cable output/i, /virtual-audio-capturer/i, /loopback/i, /wave ?out/i, /voicemeeter out/i, /mix(age)? st[ée]r[ée]o|stereomix/i],
  darwin: [/blackhole/i, /loopback/i, /soundflower/i],
  linux: [/\.monitor$/i],
};

const HINTS = {
  ffmpeg: {
    win32: 'Install ffmpeg: open PowerShell and run  winget install Gyan.FFmpeg  then restart the bridge (or set audio.ffmpeg in bridge/config.json to the full path of ffmpeg.exe).',
    darwin: 'Install ffmpeg:  brew install ffmpeg  (https://brew.sh), then restart the bridge.',
    linux: 'Install ffmpeg:  sudo apt install ffmpeg  then restart the bridge.',
  },
  device: {
    win32: 'No loopback recording device found. Either enable "Stereo Mix" (Sound settings → More sound settings → Recording → right-click → Show disabled devices → Stereo Mix → Enable), or install the free VB-Audio Virtual Cable (vb-audio.com/Cable), set "CABLE Input" as your playback device and let the bridge record "CABLE Output". You can also name a device in bridge/config.json → audio.device.',
    darwin: 'macOS cannot record its own sound output without a virtual device. Install the free BlackHole 2ch (brew install blackhole-2ch, or existential.audio/blackhole), then in Audio MIDI Setup create a Multi-Output Device with your speakers + BlackHole and select it as the sound output. The bridge records "BlackHole 2ch".',
    linux: 'No PulseAudio/PipeWire monitor source found. Install pulseaudio-utils (pactl) and make sure the bridge runs as the same user as the desktop/audio session (not as root or a system service), or load the ALSA loopback (sudo modprobe snd-aloop) and route playback to it. You can also set audio.device (e.g. "alsa_output.platform-xyz.monitor" or "hw:Loopback,1") or audio.input in bridge/config.json.',
  },
};
const hint = (kind) => HINTS[kind][OS] || HINTS[kind].linux;

// ---------------------------------------------------------------- process helpers
function run(cmd, args, { timeout = 8000, env } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    let p;
    const finish = (r) => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    try { p = spawn(cmd, args, { windowsHide: true, env: env ? { ...process.env, ...env } : process.env }); }
    catch (e) { return resolve({ code: -1, out: '', err: e.message, missing: e.code === 'ENOENT' }); }
    const t = setTimeout(() => { try { p.kill(); } catch {} finish({ code: -1, out, err: err + '\n(timeout)', timeout: true }); }, timeout);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => finish({ code: -1, out, err: e.message, missing: e.code === 'ENOENT' }));
    p.on('close', (code) => finish({ code, out, err }));
  });
}

// ---------------------------------------------------------------- device list parsers (exported for tests)
/** `ffmpeg -list_devices true -f dshow -i dummy` → audio devices [{ name, id }] (ffmpeg ≥ 5 "(audio)" tags and older sectioned output) */
export function parseDshowList(text) {
  const out = [];
  let section = '';
  for (const line of String(text).split(/\r?\n/)) {
    if (/DirectShow video devices/i.test(line)) { section = 'video'; continue; }
    if (/DirectShow audio devices/i.test(line)) { section = 'audio'; continue; }
    if (/Alternative name/i.test(line)) continue;
    const m = line.match(/"([^"]+)"\s*(?:\(([^)]*)\))?\s*$/);
    if (!m || !/audio/i.test(m[2] || section)) continue;
    if (!out.some((d) => d.name === m[1])) out.push({ name: m[1], id: m[1] });
  }
  return out;
}
/** `ffmpeg -f avfoundation -list_devices true -i ""` → audio devices [{ name, id: index }] */
export function parseAvfoundationList(text) {
  const out = [];
  let section = '';
  for (const line of String(text).split(/\r?\n/)) {
    if (/video devices/i.test(line)) { section = 'video'; continue; }
    if (/audio devices/i.test(line)) { section = 'audio'; continue; }
    const m = line.match(/\]\s*\[(\d+)\]\s*(.+?)\s*$/);
    if (m && section === 'audio') out.push({ name: m[2], id: m[1] });
  }
  return out;
}
/** First device whose name looks like a loopback of the sound output on this OS (or `os`). */
export function pickLoopback(devices, os = OS) {
  for (const re of LOOPBACK_RE[os] || LOOPBACK_RE.linux) { const d = devices.find((x) => re.test(x.name)); if (d) return d; }
  return null;
}

// ---------------------------------------------------------------- tempo helpers
const norm = (s = '') => String(s).toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+[-–]\s+.*(remaster|version|edit|mix|live|mono|stereo|single|radio|demo|feat).*$/i, '')
  .replace(/[([].*?[)\]]/g, '')
  .replace(/\bfeat\.?\b.*$|\bft\.?\b.*$/g, '')
  .replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const sameTitle = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b + ' ') || b.startsWith(a + ' ')))); };
const sameArtist = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
const goodBpm = (v) => { v = +v; return v >= 40 && v <= 260 ? Math.round(v * 10) / 10 : null; };
const firstArtist = (s = '') => String(s).split(/\s*(?:,|&| x | and | feat\.? | ft\.? | with )\s*/i)[0];

async function getJson(url, timeout = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'RoundRemote-bridge' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- the module
export function createAudio({ cfg }) {
  const A = { ...DEFAULTS, ...(cfg.audio || {}) };
  const ffmpegBin = A.ffmpeg || 'ffmpeg';

  // ---------- ffmpeg availability (cached)
  let ff = null;
  async function ffmpegInfo(force = false) {
    if (ff && !force && Date.now() - ff.at < 60000) return ff;
    const r = await run(ffmpegBin, ['-hide_banner', '-version'], { timeout: 6000 });
    const ok = r.code === 0 && /ffmpeg version/i.test(r.out);
    ff = { at: Date.now(), ok, version: ok ? (r.out.match(/ffmpeg version (\S+)/i) || [])[1] : null, pulse: /--enable-libpulse/.test(r.out), error: ok ? null : (r.missing ? `ffmpeg not found ("${ffmpegBin}")` : `ffmpeg failed: ${(r.err || r.out).trim().split('\n').pop()}`) };
    return ff;
  }

  // ---------- capture devices for this OS (cached ~15 s)
  let devCache = null;
  async function detectDevices(force = false) {
    if (devCache && !force && Date.now() - devCache.at < 15000) return devCache.data;
    const data = await detectDevicesNow();
    devCache = { at: Date.now(), data };
    return data;
  }
  async function detectDevicesNow() {
    const info = await ffmpegInfo();
    const out = { os: OS, kind: null, devices: [], chosen: null, hint: null, error: null };
    const mark = (d) => ({ ...d, loopback: (LOOPBACK_RE[OS] || LOOPBACK_RE.linux).some((re) => re.test(d.name)) });

    if (OS === 'win32') {
      out.kind = 'dshow';
      if (!info.ok) { out.error = info.error; out.hint = hint('ffmpeg'); return out; }
      const r = await run(ffmpegBin, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { timeout: 10000 });
      for (const d of parseDshowList(r.err + '\n' + r.out)) out.devices.push(mark({ ...d, input: ['-f', 'dshow', '-audio_buffer_size', '50', '-i', `audio=${d.name}`] }));
    } else if (OS === 'darwin') {
      out.kind = 'avfoundation';
      if (!info.ok) { out.error = info.error; out.hint = hint('ffmpeg'); return out; }
      const r = await run(ffmpegBin, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { timeout: 10000 });
      for (const d of parseAvfoundationList(r.err + '\n' + r.out)) out.devices.push(mark({ ...d, input: ['-f', 'avfoundation', '-i', `:${d.id}`] }));
    } else {
      // Linux / Raspberry Pi: PulseAudio or PipeWire (pipewire-pulse) monitor of the default output.
      if (!info.ok) { out.kind = 'pulse'; out.error = info.error; out.hint = hint('ffmpeg'); return out; }
      const pulseInput = (name) => info.pulse ? ['-f', 'pulse', '-fragment_size', '2048', '-i', name] : ['-f', 'alsa', '-i', 'pulse'];
      const pulseEnv = (name) => info.pulse ? null : { PULSE_SOURCE: name };  // no libpulse in ffmpeg: ALSA's pulse plugin
      const sources = await run('pactl', ['list', 'short', 'sources'], { timeout: 5000 });
      if (sources.code === 0) {
        out.kind = 'pulse';
        let def = (await run('pactl', ['get-default-sink'], { timeout: 4000 })).out.trim();
        if (!def) def = ((await run('pactl', ['info'], { timeout: 4000 })).out.match(/Default Sink:\s*(\S+)/) || [])[1] || '';
        for (const line of sources.out.split('\n')) {
          const name = line.split('\t')[1];
          if (name) out.devices.push(mark({ name, id: name, input: pulseInput(name), env: pulseEnv(name), default: name === `${def}.monitor` }));
        }
        out.chosen = out.devices.find((d) => d.default) || null;
      }
      // ALSA loopback (snd-aloop): whatever plays to hw:Loopback,0 can be recorded from hw:Loopback,1
      let cards = '';
      try { cards = fs.readFileSync('/proc/asound/cards', 'utf8'); } catch {}
      if (/Loopback/i.test(cards)) {
        out.kind = out.kind || 'alsa';
        out.devices.push({ name: 'hw:Loopback,1', id: 'hw:Loopback,1', loopback: true, input: ['-f', 'alsa', '-i', 'hw:Loopback,1'] });
      }
      if (!out.kind) out.kind = 'pulse';
    }
    if (!out.chosen) out.chosen = pickLoopback(out.devices);
    if (!out.chosen) out.hint = hint('device');
    return out;
  }

  // What ffmpeg should record: config input > config device > detected loopback device.
  async function resolveInput() {
    const info = await ffmpegInfo();
    if (!info.ok) throw Object.assign(new Error(info.error), { hint: hint('ffmpeg') });
    if (Array.isArray(A.input) && A.input.length) return { device: A.device || 'custom input (config audio.input)', input: A.input.map(String) };
    if (A.device) {
      const d = String(A.device);
      if (OS === 'win32') return { device: d, input: ['-f', 'dshow', '-audio_buffer_size', '50', '-i', `audio=${d}`] };
      if (OS === 'darwin') return { device: d, input: ['-f', 'avfoundation', '-i', `:${d}`] };
      if (/^(plug)?hw:|^default$|^sysdefault/.test(d)) return { device: d, input: ['-f', 'alsa', '-i', d] };
      return info.pulse ? { device: d, input: ['-f', 'pulse', '-fragment_size', '2048', '-i', d] } : { device: d, input: ['-f', 'alsa', '-i', 'pulse'], env: { PULSE_SOURCE: d } };
    }
    const det = await detectDevices();
    if (!det.chosen) throw Object.assign(new Error(det.error || 'no loopback capture device found'), { hint: det.hint || hint('device') });
    return { device: det.chosen.name, input: det.chosen.input, env: det.chosen.env || null };
  }

  // ---------- the shared capture
  const clients = new Set();     // { res, rate, pos, prev }
  const cap = { proc: null, rate: 0, device: null, input: null, error: null, hint: null, ready: null, stopT: null, startedAt: 0, bytes: 0, carry: null, gen: 0, startFail: null };

  function startCapture(rate) {
    if (cap.ready) return cap.ready;
    const gen = ++cap.gen;
    cap.ready = (async () => {
      const src = await resolveInput();
      if (gen !== cap.gen) throw new Error('capture was stopped');
      const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-fflags', 'nobuffer', ...src.input,
        '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-flush_packets', '1', 'pipe:1'];
      log('audio', `capture "${src.device}" @ ${rate} Hz: ffmpeg ${args.join(' ')}`);
      const proc = spawn(ffmpegBin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: src.env ? { ...process.env, ...src.env } : process.env });
      Object.assign(cap, { proc, rate, device: src.device, input: src.input, error: null, hint: null, startedAt: Date.now(), bytes: 0, carry: null });
      const mine = () => cap.gen === gen;
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
      return new Promise((resolve, reject) => {
        let gotData = false;
        const fail = (msg) => {
          if (mine()) cap.startFail = { device: src.device, error: msg };
          const e = Object.assign(new Error(msg), { hint: OS === 'win32' || OS === 'darwin' || /pulse|alsa|connection refused|no such/i.test(msg) ? hint('device') : null });
          reject(e);
        };
        const t = setTimeout(() => { if (!gotData) { fail(`ffmpeg produced no audio within 8 s${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`); try { proc.kill(); } catch {} } }, 8000);
        proc.stdout.on('data', (buf) => {
          if (!gotData) { gotData = true; clearTimeout(t); cap.startFail = null; resolve(cap); }
          if (mine()) broadcast(buf);
        });
        proc.on('error', (e) => {
          clearTimeout(t);
          const msg = e.code === 'ENOENT' ? `ffmpeg not found ("${ffmpegBin}")` : e.message;
          if (!mine()) return;
          cap.error = msg; cap.proc = null; cap.ready = null;
          fail(msg); endAll();
        });
        proc.on('close', (code) => {
          clearTimeout(t);
          const msg = stderr.trim().split('\n').filter(Boolean).slice(-2).join(' · ');
          if (!mine()) return;
          cap.proc = null; cap.ready = null;
          if (!proc.rrStopping) {
            cap.error = `ffmpeg stopped (code ${code})${msg ? `: ${msg}` : ''}`;
            cap.hint = hint('device');
            log('audio', cap.error);
          }
          if (!gotData) fail(cap.error || `ffmpeg exited (code ${code})${msg ? `: ${msg}` : ''}`);
          endAll();
        });
      });
    })().catch((e) => { if (gen === cap.gen) { cap.error = e.message; cap.hint = e.hint || null; cap.ready = null; } throw e; });
    return cap.ready;
  }
  function stopCapture() {
    clearTimeout(cap.stopT); cap.stopT = null;
    cap.gen++; cap.ready = null;
    if (!cap.proc) return;
    cap.proc.rrStopping = true;
    try { cap.proc.kill(); } catch {}
    log('audio', 'capture stopped');
    cap.proc = null; cap.ready = null;
  }
  function endAll() { for (const c of [...clients]) { try { c.res.end(); } catch {} clients.delete(c); } }

  // Raw s16le from ffmpeg → every listener (resampled linearly when a listener asked for another rate).
  function broadcast(buf) {
    if (cap.carry) { buf = Buffer.concat([cap.carry, buf]); cap.carry = null; }
    if (buf.length & 1) { cap.carry = buf.subarray(buf.length - 1); buf = buf.subarray(0, buf.length - 1); }
    if (!buf.length) return;
    cap.bytes += buf.length;
    for (const c of clients) {
      if (c.res.writableLength > 256 * 1024) { c.dropped = (c.dropped || 0) + buf.length; continue; }  // slow reader: drop, don't buffer forever
      try { c.res.write(c.rate === cap.rate ? buf : resample(c, buf)); }
      catch (e) { log('audio', `stream write: ${e.message}`); clients.delete(c); try { c.res.destroy(); } catch {} }
    }
  }
  function resample(c, buf) {
    const n = buf.length >> 1;
    const step = cap.rate / c.rate;
    // x[-1] = last sample of the previous buffer; interpolate at pos while pos <= n - 1 (pos stays > -1)
    const outN = c.pos > n - 1 ? 0 : Math.floor((n - 1 - c.pos) / step) + 1;
    const out = Buffer.alloc(outN * 2);
    let pos = c.pos;
    for (let i = 0; i < outN; i++, pos += step) {
      const i0 = Math.floor(pos), f = pos - i0;
      const a = i0 < 0 ? c.prev : buf.readInt16LE(i0 * 2);
      const b = i0 + 1 < n ? buf.readInt16LE((i0 + 1) * 2) : a;   // i0 + 1 <= n - 1 by construction
      out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(a + (b - a) * f))), i * 2);
    }
    c.pos = pos - n;
    c.prev = buf.readInt16LE((n - 1) * 2);
    return out;
  }

  async function stream(req, res, url, json) {
    if (!A.enabled) return json(res, 403, { error: 'audio capture is disabled in bridge/config.json (audio.enabled)' });
    const rate = Math.round(Math.max(8000, Math.min(48000, +url.searchParams.get('rate') || A.sampleRate || 22050)));
    clearTimeout(cap.stopT); cap.stopT = null;
    const client = { res, rate, pos: 0, prev: 0 };
    let closed = false;
    const idleStop = () => { if (!clients.size && cap.ready && !cap.stopT) cap.stopT = setTimeout(stopCapture, A.graceMs ?? 5000); };
    const onClose = () => { closed = true; clients.delete(client); idleStop(); };
    res.on('close', onClose);
    try { await startCapture(rate); }
    catch (e) {
      if (!clients.size && !cap.proc) stopCapture();
      if (!closed) json(res, 503, { error: e.message, hint: e.hint || null });
      return;
    }
    if (closed) return idleStop();
    req.socket.setNoDelay?.(true);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Audio-Format': 's16le; channels=1',
      'X-Sample-Rate': String(rate),
      'X-Audio-Device': encodeURIComponent(cap.device || ''),
      'Access-Control-Expose-Headers': 'X-Sample-Rate, X-Audio-Device, X-Audio-Format',
    });
    res.flushHeaders?.();
    clients.add(client);
  }

  async function status({ withDevices = false } = {}) {
    const info = await ffmpegInfo();
    const capturing = !!cap.proc;
    let device = capturing ? cap.device : null, input = capturing ? cap.input : null, error = null, hintText = null;
    if (!A.enabled) error = 'audio capture is disabled in bridge/config.json (audio.enabled)';
    else if (!info.ok) { error = info.error; hintText = hint('ffmpeg'); }
    else if (!capturing) {
      try { const src = await resolveInput(); device = src.device; input = src.input; }
      catch (e) { error = e.message; hintText = e.hint || null; }
      // the last attempt with this same device failed before any audio came: report that until it works
      if (!error && cap.startFail && cap.startFail.device === device) { error = cap.startFail.error; hintText = hint('device'); }
    }
    const devices = withDevices ? await detectDevices() : null;
    return {
      ok: !error && !!device,
      ffmpeg: info.ok, ffmpegVersion: info.version,
      capturing, clients: clients.size, rate: capturing ? cap.rate : null,
      device, input, error, hint: hintText,
      lastError: cap.error || null,   // why the last capture stopped / failed, if it did
      os: OS,
      ...(devices ? { devices } : {}),
    };
  }

  // ---------- proxied audio download
  async function fetchAudio(req, res, url, json) {
    let target;
    try { target = new URL(url.searchParams.get('url')); } catch { return json(res, 400, { error: 'bad url' }); }
    if (!/^https?:$/.test(target.protocol)) return json(res, 400, { error: 'only http(s) urls' });
    if (/^169\.254\.|^metadata\.|^0\./.test(target.hostname)) return json(res, 403, { error: 'host not allowed' });
    const limit = (A.maxFetchMB || 80) * 1024 * 1024;
    const headers = { 'User-Agent': 'RoundRemote-bridge' };
    for (const [k, v] of Object.entries(req.headers)) if (/^(authorization|x-emby-.*|x-plex-.*|x-mediabrowser-.*)$/i.test(k)) headers[k] = v;
    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort());
    let to = setTimeout(() => ctrl.abort(), 20000);
    let r;
    try { r = await fetch(target, { headers, redirect: 'follow', signal: ctrl.signal }); }
    catch (e) {
      clearTimeout(to);
      const why = e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.cause?.errors?.[0]?.code || e.cause?.message || e.message;
      log('audio', `fetch ${target.host}: ${why}`);
      return res.writableEnded || res.destroyed ? null : json(res, 502, { error: `could not download from ${target.host}: ${why}` });
    }
    clearTimeout(to);
    if (!r.ok) return json(res, r.status, { error: `HTTP ${r.status} from ${target.host}` });
    const type = (r.headers.get('content-type') || 'application/octet-stream').toLowerCase();
    if (/^(text\/|application\/(json|xml|javascript|xhtml))/.test(type)) { ctrl.abort(); return json(res, 415, { error: `not an audio file (${type})` }); }
    const len = +r.headers.get('content-length') || 0;
    if (len > limit) { ctrl.abort(); return json(res, 413, { error: `file is larger than ${A.maxFetchMB || 80} MB` }); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(len ? { 'Content-Length': len } : {}), 'Access-Control-Expose-Headers': 'Content-Length' });
    let n = 0;
    const idle = () => { clearTimeout(to); to = setTimeout(() => ctrl.abort(), 30000); };
    try {
      idle();
      for await (const chunk of r.body) {
        n += chunk.length;
        if (n > limit) { log('audio', `fetch ${target.host}: over ${A.maxFetchMB} MB, aborted`); ctrl.abort(); res.destroy(); return; }
        idle();
        if (!res.write(chunk)) {
          await new Promise((ok) => {
            const done = () => { res.off('drain', done); res.off('close', done); ok(); };
            res.on('drain', done); res.on('close', done);
          });
          if (res.destroyed) { ctrl.abort(); return; }
        }
      }
      res.end();
    } catch (e) { res.destroy(); }
    finally { clearTimeout(to); }
  }

  // ---------- tempo lookup
  const tempoCache = new Map();    // key → { at, v }
  const RB = String(A.reccobeatsApi).replace(/\/$/, ''), DZ = String(A.deezerApi).replace(/\/$/, '');
  async function rbFeatures(ids) {
    const d = await getJson(`${RB}/audio-features?ids=${encodeURIComponent(ids.join(','))}`);
    return d?.content || [];
  }
  async function viaReccoSpotify(spotifyId) {
    const list = await rbFeatures([spotifyId]);
    const f = list.find((x) => String(x.href || '').endsWith(spotifyId)) || list[0];
    const bpm = goodBpm(f?.tempo);
    if (bpm) return { bpm, source: 'reccobeats' };
    // no audio features: try Deezer through the track's ISRC
    const t = (await getJson(`${RB}/track?ids=${encodeURIComponent(spotifyId)}`))?.content?.[0];
    if (t?.isrc) { const dz = await getJson(`${DZ}/track/isrc:${encodeURIComponent(t.isrc)}`); const b = goodBpm(dz?.bpm); if (b) return { bpm: b, source: 'deezer' }; }
    return t ? { title: t.trackTitle, artist: t.artists?.[0]?.name } : null;
  }
  async function viaDeezer(title, artist) {
    const qs = [`artist:"${firstArtist(artist)}" track:"${title}"`, `${firstArtist(artist)} ${title}`];
    for (const q of qs) {
      const d = await getJson(`${DZ}/search?q=${encodeURIComponent(q)}&limit=8`);
      if (d?.error) throw new Error(`deezer: ${d.error.message || d.error.type}`);
      const hits = (d?.data || []).filter((x) => sameTitle(x.title_short || x.title, title) && sameArtist(x.artist?.name, artist)).slice(0, 3);
      for (const h of hits) {
        const t = await getJson(`${DZ}/track/${h.id}`);
        const bpm = goodBpm(t?.bpm);
        if (bpm) return { bpm, source: 'deezer' };
      }
      if (hits.length) break;
    }
    return null;
  }
  async function viaReccoCatalogue(title, artist) {
    const name = firstArtist(artist);
    const arts = (await getJson(`${RB}/artist/search?searchText=${encodeURIComponent(name)}&size=10`))?.content || [];
    const same = arts.filter((a) => norm(a.name) === norm(name)).slice(0, 2);
    for (const a of same) {
      for (let page = 0; page < 8; page += 4) {
        const pages = await Promise.all([0, 1, 2, 3].map((i) => getJson(`${RB}/artist/${a.id}/track?size=50&page=${page + i}`).catch(() => null)));
        const tracks = pages.flatMap((p) => p?.content || []);
        const hit = tracks.find((t) => norm(t.trackTitle) === norm(title)) || tracks.find((t) => sameTitle(t.trackTitle, title));
        if (hit) {
          const f = (await rbFeatures([hit.id]))[0];
          const bpm = goodBpm(f?.tempo);
          if (bpm) return { bpm, source: 'reccobeats' };
        }
        if (pages.some((p) => p && (p.page ?? 0) + 1 >= (p.totalPages ?? 0))) break;   // ran out of pages
      }
    }
    return null;
  }
  async function tempo({ title = '', artist = '', spotifyId = '' } = {}) {
    title = String(title).trim(); artist = String(artist).trim();
    spotifyId = String(spotifyId).trim().replace(/^spotify:track:/, '').replace(/^.*\/track\//, '').replace(/\?.*$/, '');
    if (!/^[A-Za-z0-9]{22}$/.test(spotifyId)) spotifyId = '';
    if (!spotifyId && !title) return { bpm: null, source: null, error: 'title or spotifyId required' };
    if (!A.tempo) return { bpm: null, source: null, error: 'tempo lookups are disabled (audio.tempo)' };
    const key = spotifyId ? `sp:${spotifyId}` : `t:${norm(artist)}|${norm(title)}`;
    const hit = tempoCache.get(key);
    if (hit && (hit.v.bpm || Date.now() - hit.at < 10 * 60e3)) return hit.v;
    const errors = [];
    const attempt = async (fn) => { try { return await fn(); } catch (e) { errors.push(e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.message); return null; } };
    let v = null;
    if (spotifyId) {
      const r = await attempt(() => viaReccoSpotify(spotifyId));
      if (r?.bpm) v = r;
      else if (r?.title && !title) { title = r.title; artist = artist || r.artist || ''; }
    }
    if (!v && title && artist) v = await attempt(() => viaDeezer(title, artist));
    if (!v && title && artist) v = await attempt(() => viaReccoCatalogue(title, artist));
    v = v || { bpm: null, source: null, ...(errors.length ? { error: errors.join('; ') } : {}) };
    if (tempoCache.size > 3000) tempoCache.delete(tempoCache.keys().next().value);
    tempoCache.set(key, { at: Date.now(), v });
    log('audio', `tempo ${spotifyId || `${artist} – ${title}`}: ${v.bpm ?? 'unknown'}${v.source ? ` (${v.source})` : ''}${v.error ? ` [${v.error}]` : ''}`);
    return v;
  }

  // ---------- routes
  async function route(req, res, url, { json }) {
    const p = url.pathname.slice('/api/audio/'.length);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    if (p === 'status') return json(res, 200, await status({ withDevices: /^(1|true)$/.test(url.searchParams.get('devices') || '') }));
    if (p === 'devices') return json(res, 200, await detectDevices(true));
    if (p === 'stream') return stream(req, res, url, json);
    if (p === 'fetch') return fetchAudio(req, res, url, json);
    if (p === 'tempo') return json(res, 200, await tempo(Object.fromEntries(url.searchParams)));
    return json(res, 404, { error: 'not found' });
  }

  return { route, status, detectDevices, tempo, stop: () => { endAll(); stopCapture(); } };
}
