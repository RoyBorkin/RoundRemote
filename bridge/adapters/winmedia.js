// Windows media sessions (the players in the Windows volume/media flyout) through a small PowerShell
// helper (bridge/tools/winmedia.ps1). One zone per app that's playing or paused:
//   • the Apple Music app for Windows, iTunes, Cider, Sidra
//   • Chrome / Edge / Firefox playing YouTube, YouTube Music, SoundCloud, Apple Music web…
//   • Spotify desktop, TIDAL desktop, Amazon Music, Deezer, VLC, foobar2000 (with its plugin)…
// Gives now-playing + artwork, play/pause, next/prev, seek, shuffle and repeat — whatever each app allows.
// (Windows doesn't expose per-app volume here, so the volume slider isn't offered for these.)
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { log } from '../lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'tools', 'winmedia.ps1');
const REPEAT = { None: 'off', Track: 'one', List: 'all' };

/** Friendly name from an AppUserModelID like "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App" or "Chrome". */
export function prettyApp(id = '') {
  const s = String(id);
  const rules = [
    [/applemusic/i, 'Apple Music'], [/itunes/i, 'iTunes'], [/cider/i, 'Cider · Apple Music'], [/sidra/i, 'Sidra · Apple Music'],
    [/spotify/i, 'Spotify'], [/tidal/i, 'TIDAL'], [/amazon.*music/i, 'Amazon Music'], [/deezer/i, 'Deezer'], [/qobuz/i, 'Qobuz'],
    [/msedge|microsoftedge/i, 'Edge'], [/chrome/i, 'Chrome'], [/firefox/i, 'Firefox'], [/brave/i, 'Brave'], [/opera/i, 'Opera'],
    [/vlc/i, 'VLC'], [/foobar/i, 'foobar2000'], [/zunemusic|microsoft\.media|mediaplayer/i, 'Media Player'], [/plexamp/i, 'Plexamp'],
  ];
  for (const [re, name] of rules) if (re.test(s)) return name;
  return s.replace(/\.exe$/i, '').split(/[!_.]/).filter(Boolean).pop() || 'App';
}
const localIdOf = (id) => Buffer.from(String(id)).toString('base64url').slice(0, 60);

export function create({ hub, cfg, setStatus }) {
  const c = { powershell: 'powershell.exe', ...(cfg.winmedia || {}) };
  const sessions = new Map(); // localId → { id (AUMID), art: {mime, body, trackKey} }
  let ps = null, stopped = false, buf = '';

  function onLine(line) {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'error') { setStatus(`error: ${m.message}`); return; }
    if (m.type === 'art') {
      const lid = localIdOf(m.id);
      const s = sessions.get(lid) || { id: m.id };
      s.art = { mime: m.mime || 'image/jpeg', body: Buffer.from(m.data, 'base64'), trackKey: m.trackKey };
      sessions.set(lid, s);
      return;
    }
    if (m.type !== 'state') return;
    const list = [].concat(m.sessions || []);
    const seen = new Set();
    for (const x of list) {
      const lid = localIdOf(x.id);
      seen.add(lid);
      const s = sessions.get(lid) || { id: x.id };
      sessions.set(lid, s);
      const app = prettyApp(x.id);
      const hasArt = s.art && s.art.trackKey === x.trackKey;
      hub.upsert('winmedia', lid, {
        name: `${app} · ${os.hostname()}`,
        sourceApp: app,
        state: {
          track: x.title ? {
            id: x.trackKey, title: x.title, artist: x.artist || x.albumArtist || '', album: x.album || '',
            art: hasArt ? `/api/image/winmedia/${lid}?v=${encodeURIComponent(x.trackKey).slice(0, 80)}` : '',
            durationMs: x.durationMs || 0,
          } : null,
          isPlaying: x.status === 'Playing',
          progressMs: Math.max(0, Math.min(x.positionMs || 0, x.durationMs || Infinity)),
          volume: null, shuffle: x.canShuffle ? !!x.shuffle : null, repeat: x.canRepeat ? REPEAT[x.repeat] || 'off' : null,
        },
        caps: { seek: !!x.canSeek && x.durationMs > 0, volume: false, next: !!x.canNext, prev: !!x.canPrev, playlists: false, search: false, shuffle: !!x.canShuffle, repeat: !!x.canRepeat },
      });
    }
    for (const lid of [...sessions.keys()]) if (!seen.has(lid)) { sessions.delete(lid); hub.remove('winmedia', lid); }
    setStatus(list.length ? `running · ${list.length} app${list.length > 1 ? 's' : ''}` : 'running · nothing playing');
  }

  function launch() {
    if (stopped) return;
    ps = spawn(c.powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { windowsHide: true });
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(line); } });
    ps.stderr.on('data', (d) => log('winmedia', String(d).trim().slice(0, 200)));
    ps.on('error', (e) => { setStatus(`error: ${e.message}`, false); log('winmedia', e.message); });
    ps.on('exit', (code) => { ps = null; if (!stopped) { log('winmedia', `helper exited (${code}) — restarting`); setTimeout(launch, 3000); } });
  }

  return {
    id: 'winmedia',
    async start() {
      if (process.platform !== 'win32' && !c.force) { setStatus('Windows only (on Linux/Pi the "mpris" adapter does this)', false); return; }
      launch();
    },
    stop() { stopped = true; try { ps?.stdin.end(); ps?.kill(); } catch {} },
    async command(lid, cmd, value) {
      const s = sessions.get(lid);
      if (!s || !ps) return;
      if (!['play', 'pause', 'next', 'prev', 'seek', 'shuffle', 'repeat'].includes(cmd)) return;
      ps.stdin.write(`${JSON.stringify({ id: s.id, cmd, value })}\n`);
    },
    async image(key) {
      const s = sessions.get(String(key).split('?')[0]);
      return s?.art ? { body: s.art.body, contentType: s.art.mime } : null;
    },
  };
}
