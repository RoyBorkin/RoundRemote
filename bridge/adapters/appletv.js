// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Apple TV (and whatever is AirPlayed to it) through pyatv (https://pyatv.dev) — the library Home
// Assistant uses. Needs Python + pyatv on the bridge computer:  pip install pyatv   (pi/setup.sh does it).
//
// Gives now playing from any app (title, series, season, episode, app, position), play/pause,
// next/previous, seek, skip, volume, power, a D-pad remote (up/down/left/right/select/menu/home)
// and launching apps. Pair once: the TV shows a code (twice on tvOS 15+: Companion, then AirPlay).
// Credentials are kept by pyatv in ~/.pyatv.conf; the list of your TVs in bridge/appletv.json.
//
// Zones: appletv:<ip>. Actions (like the Google TV adapter):
//   GET  /api/adapters/appletv/discover   · GET /list   · POST /pair {host,name}   · POST /code {host,code}
//   POST /api/adapters/appletv/unpair {host} · POST /key {id,key} · POST /app {id,bundle}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { log } from '../lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(__dirname, '..', 'appletv.json');
// Round Remote key → pyatv remote-control command
const KEYS = { up: 'up', down: 'down', left: 'left', right: 'right', ok: 'select', back: 'menu', home: 'home', menu: 'menu',
  playpause: 'play_pause', play: 'play', pause: 'pause', next: 'next', prev: 'previous', volup: 'volume_up', voldown: 'volume_down',
  forward: 'skip_forward', rewind: 'skip_backward', stop: 'stop', guide: 'top_menu' };

function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { tvs: [] }; } }
function saveState(s) { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); } catch (e) { log('appletv', `could not save ${STATE}: ${e.message}`); } }

export function create({ hub, cfg = {}, setStatus }) {
  const c = { atvscript: 'atvscript', atvremote: 'atvremote', ...(cfg.appletv || {}) };
  // How to start pyatv's tools: the atvscript/atvremote commands, or "python -m pyatv.scripts.…" when
  // pip put them somewhere not on PATH (common on Windows). Picked in start().
  let SCRIPT = [c.atvscript], REMOTE = [c.atvremote];
  const state = loadState();
  const tvs = new Map();     // host → { host, name, proc, st:{}, sampledAt, art, artHash, prevVol }
  const pairing = new Map(); // host → { proc, out, protocol, name }
  let stopped = false, missing = false;

  const run = (cmd, args, ms = 15000) => new Promise((resolve, reject) => {
    const [bin, ...pre] = [].concat(cmd);
    execFile(bin, [...pre, ...args], { timeout: ms, maxBuffer: 4 << 20 }, (err, out, errOut) => {
      if (err && err.code === 'ENOENT') return reject(Object.assign(new Error('pyatv is not installed on the bridge computer (pip install pyatv)'), { missing: true }));
      if (err && !out) return reject(new Error(String(errOut || err.message).trim().split('\n').pop()));
      resolve(String(out || ''));
    });
  });
  const script = async (host, ...cmds) => {
    const out = await run(SCRIPT, ['-s', host, ...cmds]);
    const j = JSON.parse(out.trim().split('\n').pop() || '{}');
    if (j.result === 'failure') throw new Error(j.exception || j.error || 'Apple TV command failed');
    return j;
  };
  const remote = (host, ...cmds) => run(REMOTE, ['-s', host, ...cmds]);
  const status = () => setStatus(missing ? 'not installed: pip install pyatv' : state.tvs.length ? `running · ${state.tvs.length} Apple TV${state.tvs.length > 1 ? 's' : ''}` : 'running · no Apple TV paired yet', !missing);

  function publish(tv) {
    const s = tv.st;
    const on = s.power_state !== 'off';
    const has = on && !!s.title && !['idle', 'stopped'].includes(s.device_state);
    const video = s.media_type === 'video' || !!s.series_name;
    const media = has && video ? {
      type: s.series_name ? 'episode' : 'movie', title: s.title, show: s.series_name || '',
      season: s.season_number ?? null, episode: s.episode_number ?? null, app: s.app || '',
      poster: tv.art ? `/api/image/appletv/${encodeURIComponent(tv.host)}?v=${encodeURIComponent(s.hash || s.title)}` : '',
    } : null;
    if (media) media.backdrop = media.poster;
    hub.upsert('appletv', tv.host, {
      name: tv.name, sourceApp: s.app || 'Apple TV',
      state: {
        track: has ? {
          id: s.hash || `${s.title}|${s.series_name || ''}|${s.episode_number || ''}`,
          title: media?.show || s.title, artist: media?.show ? `S${s.season_number ?? '?'} · E${s.episode_number ?? '?'} · ${s.title}` : s.artist || s.app || '',
          album: s.album || '', durationMs: (s.total_time || 0) * 1000, art: media?.poster || (tv.art ? `/api/image/appletv/${encodeURIComponent(tv.host)}?v=${encodeURIComponent(s.hash || s.title)}` : ''),
          ...(media ? { media, notSong: true } : {}),
        } : null,
        isPlaying: s.device_state === 'playing',
        progressMs: (s.position || 0) * 1000,
        volume: Number.isFinite(s.volume) ? Math.round(s.volume) : null,
        muted: s.volume === 0,
      },
      caps: { seek: (s.total_time || 0) > 0, volume: true, next: true, prev: true, playlists: true, search: false, shuffle: false, repeat: false, remote: true, stop: true },
      sampledAt: tv.sampledAt || Date.now(),
    });
  }

  async function fetchArt(tv, hash) {
    if (tv.artHash === hash) return;
    tv.artHash = hash;
    const dir = path.join(os.tmpdir(), `rr-appletv-${tv.host.replace(/[^\w.-]/g, '_')}`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      await new Promise((resolve) => execFile(REMOTE[0], [...REMOTE.slice(1), '-s', tv.host, 'artwork_save'], { cwd: dir, timeout: 15000 }, () => resolve()));
      const f = path.join(dir, 'artwork.png');
      if (fs.existsSync(f)) { tv.art = { body: fs.readFileSync(f), type: 'image/png' }; fs.unlinkSync(f); publish(tv); }
    } catch {}
  }

  function follow(entry) {
    const tv = tvs.get(entry.host) || { host: entry.host, name: entry.name || `Apple TV ${entry.host}`, st: {} };
    tvs.set(entry.host, tv);
    if (stopped || missing) return;
    const p = spawn(SCRIPT[0], [...SCRIPT.slice(1), '-s', entry.host, 'push_updates']);
    tv.proc = p;
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.result === 'failure') { log('appletv', `${tv.name}: ${j.exception || j.error}`); continue; }
        if (j.connection) { log('appletv', `${tv.name}: connection ${j.connection}`); continue; }
        const before = tv.st.hash;
        Object.assign(tv.st, j);
        if ('position' in j || 'device_state' in j) tv.sampledAt = Date.now();
        publish(tv);
        if (j.hash && j.hash !== before && j.title) fetchArt(tv, j.hash);
      }
    });
    p.stderr.on('data', (d) => log('appletv', String(d).trim().slice(0, 200)));
    p.on('error', (e) => { if (e.code === 'ENOENT') { missing = true; status(); log('appletv', 'atvscript not found — pip install pyatv'); } });
    p.on('exit', () => { if (tv.proc === p) tv.proc = null; if (!stopped && !missing && state.tvs.some((t) => t.host === entry.host)) setTimeout(() => follow(entry), 5000); });
    publish(tv);
  }
  const tvOf = (id) => { const tv = tvs.get(String(id).replace(/^appletv:/, '')); if (!tv) throw new Error('Apple TV not paired'); return tv; };

  // ---------- pairing (atvremote asks for the PIN on stdin) ----------
  function startPair(host, protocol) {
    return new Promise((resolve, reject) => {
      const proc = spawn(REMOTE[0], [...REMOTE.slice(1), '-s', host, '--protocol', protocol, 'pair']);
      const job = { proc, out: '', protocol };
      let answered = false;
      const done = (v, e) => { if (answered) return; answered = true; clearTimeout(t); e ? reject(e) : resolve(v); };
      const t = setTimeout(() => { try { proc.kill(); } catch {} done(null, new Error('The Apple TV didn’t answer — check the IP address and that it is on')); }, 20000);
      proc.stdout.on('data', (d) => { job.out += d; if (/PIN/i.test(job.out)) done({ job, needPin: true }); });
      proc.stderr.on('data', (d) => { job.out += d; });
      proc.on('error', (e) => done(null, e.code === 'ENOENT' ? new Error('pyatv is not installed on the bridge computer (pip install pyatv)') : e));
      proc.on('exit', () => done({ job, needPin: false, ok: /succeeded|already paired|not needed/i.test(job.out) }, /succeeded|not needed/i.test(job.out) ? null : new Error(lastLine(job.out) || `Pairing (${protocol}) failed`)));
      job.exited = new Promise((r) => proc.on('exit', r));
    });
  }
  const lastLine = (s) => String(s).trim().split('\n').filter(Boolean).pop() || '';

  const actions = {
    async discover() {
      const out = await run(SCRIPT, ['scan'], 20000);
      const j = JSON.parse(out.trim().split('\n').pop() || '{}');
      const paired = new Set(state.tvs.map((t) => t.host));
      return (j.devices || [])
        .filter((d) => /apple tv|appletv|tvos/i.test(`${d.device_info?.model_str || ''} ${d.device_info?.operating_system || ''}`) || (d.services || []).some((s) => ['mrp', 'companion'].includes(s.protocol)))
        .map((d) => ({ name: d.name, host: d.address, model: d.device_info?.model_str || '', paired: paired.has(d.address) }));
    },
    async list() { return state.tvs.map((t) => ({ id: `appletv:${t.host}`, host: t.host, name: t.name, connected: !!tvs.get(t.host)?.proc })); },
    async pair({ host, name }) {
      if (!host) throw new Error('Enter the Apple TV’s IP address');
      pairing.get(host)?.job?.proc?.kill();
      pairing.set(host, { name: name || `Apple TV ${host}`, step: 'companion' });
      const r = await startPair(host, 'companion');
      pairing.get(host).job = r.job;
      if (r.needPin) return { ok: true, message: 'Enter the code shown on the Apple TV' };
      return actions._airplay(host);
    },
    async _airplay(host) {
      const p = pairing.get(host);
      p.step = 'airplay';
      try {
        const r = await startPair(host, 'airplay');
        p.job = r.job;
        if (r.needPin) return { ok: true, next: true, message: 'One more: enter the new code shown on the Apple TV (AirPlay)' };
      } catch (e) { log('appletv', `AirPlay pairing skipped: ${e.message}`); }
      return finish(host);
    },
    async code({ host, code }) {
      const p = pairing.get(host);
      if (!p?.job) throw new Error('Start pairing first');
      p.job.proc.stdin.write(`${String(code || '').trim()}\n`);
      await Promise.race([p.job.exited, new Promise((r) => setTimeout(r, 15000))]);
      if (!/succeeded/i.test(p.job.out)) { throw new Error(/incorrect|wrong|invalid|failed/i.test(p.job.out) ? 'That code didn’t match — start again' : lastLine(p.job.out) || 'Pairing failed'); }
      if (p.step === 'companion') return actions._airplay(host);
      return finish(host);
    },
    async unpair({ host }) {
      state.tvs = state.tvs.filter((t) => t.host !== host);
      saveState(state);
      const tv = tvs.get(host);
      if (tv) { try { tv.proc?.stdin.write('\n'); tv.proc?.kill(); } catch {} tvs.delete(host); hub.remove('appletv', host); }
      status();
      return { ok: true };
    },
    async key({ id, key }) {
      const tv = tvOf(id);
      if (key === 'power') { await script(tv.host, tv.st.power_state === 'off' ? 'turn_on' : 'turn_off'); return { ok: true }; }
      if (key === 'mute') {
        const v = tv.st.volume;
        if (v > 0) { tv.prevVol = v; await remote(tv.host, 'set_volume=0'); } else await remote(tv.host, `set_volume=${Math.round(tv.prevVol || 30)}`);
        return { ok: true };
      }
      const cmd = KEYS[key];
      if (!cmd) throw new Error(`Unknown key ${key}`);
      await script(tv.host, cmd);
      return { ok: true };
    },
    async app({ id, bundle }) { await remote(tvOf(id).host, `launch_app=${bundle}`); return { ok: true }; },
  };
  function finish(host) {
    const p = pairing.get(host);
    pairing.delete(host);
    const entry = { host, name: p?.name || `Apple TV ${host}` };
    state.tvs = state.tvs.filter((t) => t.host !== host).concat(entry);
    saveState(state);
    follow(entry);
    status();
    return { id: `appletv:${host}`, name: entry.name };
  }

  return {
    id: 'appletv',
    actions,
    async start() {
      const tries = [[c.atvscript, c.atvremote], ...['python3', 'python', 'py'].map((py) => [[py, '-m', 'pyatv.scripts.atvscript'], [py, '-m', 'pyatv.scripts.atvremote']])];
      let found = false;
      for (const [s1, r1] of tries) {
        try { await run(s1, ['--help'], 8000); SCRIPT = [].concat(s1); REMOTE = [].concat(r1); found = true; break; } catch {}
      }
      if (!found) { missing = true; status(); log('appletv', 'pyatv not installed (pip install pyatv)'); return; }
      state.tvs.forEach(follow);
      status();
    },
    stop() { stopped = true; for (const tv of tvs.values()) try { tv.proc?.stdin.write('\n'); tv.proc?.kill(); } catch {} },
    async command(host, cmd, value) {
      const tv = tvs.get(host);
      if (!tv) throw new Error('Apple TV not paired');
      if (cmd === 'seek') { await remote(host, `set_position=${Math.max(0, Math.round(value / 1000))}`); tv.st.position = Math.round(value / 1000); tv.sampledAt = Date.now(); }
      else if (cmd === 'volume') { await remote(host, `set_volume=${Math.max(0, Math.min(100, Math.round(value)))}`); tv.st.volume = value; }
      else if (cmd === 'mute') await actions.key({ id: host, key: 'mute' });
      else if (KEYS[cmd]) await script(host, KEYS[cmd]);
      publish(tv);
    },
    // the Apps list doubles as the Playlists panel
    async playlists(host) {
      const out = await remote(host, 'app_list');
      return [...out.matchAll(/App:\s*(.+?)\s*\(([\w.-]+)\)/g)].map(([, name, bundle]) => ({ kind: 'app', id: bundle, name, subtitle: 'Open on the Apple TV', mono: name.slice(0, 2), bundle }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async play(host, item) { if (item.bundle || item.id) await remote(host, `launch_app=${item.bundle || item.id}`); },
    async image(key) {
      const tv = tvs.get(decodeURIComponent(String(key).split('?')[0]));
      return tv?.art ? { body: tv.art.body, contentType: tv.art.type } : null;
    },
  };
}
