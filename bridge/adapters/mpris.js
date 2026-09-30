// MPRIS — the standard remote-control interface of Linux media players — through `playerctl`
// (sudo apt install playerctl). One zone per running player, for example:
//   • Sidra (Apple Music for Linux: https://github.com/wimpysworld/sidra)
//   • Cider on Linux
//   • Chromium / Chrome / Firefox playing YouTube, YouTube Music, SoundCloud… (browsers expose MPRIS)
//   • Spotify desktop, VLC, Rhythmbox, Strawberry, mpv (with mpv-mpris)…
// Gives now-playing + artwork, play/pause, next/prev, seek, volume, shuffle and repeat (whatever the
// player supports). On the Pi this lets the round screen control players running on the Pi itself.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { log } from '../lib/util.js';

const SEP = '␞'; // record separator that never shows up in titles
const FIELDS = ['playerName', 'status', 'position', 'mpris:length', 'xesam:title', 'xesam:artist', 'xesam:album', 'mpris:artUrl', 'volume', 'shuffle', 'loop', 'mpris:trackid', 'xesam:url'];
const FORMAT = FIELDS.map((f) => `{{${f}}}`).join(SEP);
const LOOP = { None: 'off', Track: 'one', Playlist: 'all' };
const LOOP_BACK = { off: 'None', one: 'Track', all: 'Playlist' };
const PRETTY = { chromium: 'Chromium', chrome: 'Chrome', firefox: 'Firefox', brave: 'Brave', vivaldi: 'Vivaldi', spotify: 'Spotify', sidra: 'Sidra · Apple Music', cider: 'Cider · Apple Music', vlc: 'VLC', mpv: 'mpv', rhythmbox: 'Rhythmbox', strawberry: 'Strawberry', plexamp: 'Plexamp', kodi: 'Kodi' };
const pretty = (name) => { const base = String(name).split('.')[0].toLowerCase(); return PRETTY[base] || base.charAt(0).toUpperCase() + base.slice(1); };
const localIdOf = (name) => String(name).replace(/[^\w.-]/g, '_');

export function create({ hub, cfg, setStatus }) {
  const c = { playerctl: 'playerctl', pollMs: 4000, ignore: ['kdeconnect', 'plasma-browser-integration'], ...(cfg.mpris || {}) };
  const players = new Map(); // localId → { name, art }
  let follow = null, poller = null, stopped = false;

  const run = (args) => new Promise((resolve, reject) => {
    execFile(c.playerctl, args, { timeout: 4000 }, (err, out) => (err && !out ? reject(err) : resolve(String(out || ''))));
  });

  function ingest(line) {
    const v = line.split(SEP);
    if (v.length < FIELDS.length) return;
    const f = Object.fromEntries(FIELDS.map((k, i) => [k, v[i]]));
    const name = f.playerName;
    if (!name || c.ignore.some((x) => name.startsWith(x))) return;
    const localId = localIdOf(name);
    const p = players.get(localId) || { name };
    players.set(localId, p);
    let art = f['mpris:artUrl'] || '';
    if (art.startsWith('file://')) { p.art = decodeURIComponent(art.slice(7)); art = `/api/image/mpris/${encodeURIComponent(localId)}?v=${encodeURIComponent(f['mpris:trackid'] || f['xesam:title'])}`; }
    const vol = parseFloat(f.volume);
    hub.upsert('mpris', localId, {
      name: `${pretty(name)} · ${os.hostname()}`,
      sourceApp: pretty(name),
      state: {
        track: f['xesam:title'] ? {
          id: (f['xesam:url'] || '').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/)?.[1] || f['mpris:trackid'] || f['xesam:url'] || f['xesam:title'],
          title: f['xesam:title'], artist: f['xesam:artist'] || '', album: f['xesam:album'] || '',
          art, durationMs: Math.round((+f['mpris:length'] || 0) / 1000),
        } : null,
        isPlaying: f.status === 'Playing',
        progressMs: Math.round((+f.position || 0) / 1000),
        volume: Number.isFinite(vol) ? Math.round(vol * 100) : null,
        shuffle: f.shuffle === 'true' ? true : f.shuffle === 'false' ? false : null,
        repeat: LOOP[f.loop] || null,
      },
      caps: { seek: !!f['mpris:length'], volume: Number.isFinite(vol), next: true, prev: true, playlists: false, search: false, shuffle: f.shuffle === 'true' || f.shuffle === 'false', repeat: !!LOOP[f.loop] },
    });
  }

  async function snapshot() {
    try {
      const listed = (await run(['-l']).catch(() => '')).split('\n').map((s) => s.trim()).filter(Boolean);
      const out = await run(['-a', 'metadata', '--format', FORMAT]).catch(() => '');
      out.split('\n').filter(Boolean).forEach(ingest);
      // players that went away
      const alive = new Set(listed.map(localIdOf));
      for (const id of [...players.keys()]) if (!alive.has(id)) { players.delete(id); hub.remove('mpris', id); }
      setStatus(players.size ? `running · ${players.size} player${players.size > 1 ? 's' : ''}` : 'running · no media players open');
    } catch (e) { setStatus(`error: ${e.message}`); }
  }

  function startFollow() {
    if (stopped) return;
    follow = spawn(c.playerctl, ['-a', 'metadata', '--format', FORMAT, '--follow']);
    let buf = '';
    follow.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line) ingest(line); } });
    follow.on('error', (e) => {
      if (e.code === 'ENOENT') { setStatus('not installed: sudo apt install playerctl', false); log('mpris', 'playerctl not found (sudo apt install playerctl)'); stopped = true; clearInterval(poller); }
    });
    follow.on('exit', () => { follow = null; if (!stopped) setTimeout(startFollow, 3000); });
  }

  const target = (id) => players.get(id)?.name || id;
  return {
    id: 'mpris',
    async start() {
      if (process.platform !== 'linux' && !c.force) { setStatus('Linux only (on Windows the "winmedia" adapter does this)', false); return; }
      startFollow();
      await snapshot();
      poller = setInterval(snapshot, c.pollMs); // positions + players appearing/disappearing
    },
    stop() { stopped = true; clearInterval(poller); follow?.kill(); },
    async command(id, cmd, value) {
      const p = ['-p', target(id)];
      if (cmd === 'play') await run([...p, 'play']);
      else if (cmd === 'pause') await run([...p, 'pause']);
      else if (cmd === 'next') await run([...p, 'next']);
      else if (cmd === 'prev') await run([...p, 'previous']);
      else if (cmd === 'seek') await run([...p, 'position', String(Math.max(0, value / 1000))]);
      else if (cmd === 'volume') await run([...p, 'volume', String(Math.max(0, Math.min(1, value / 100)))]);
      else if (cmd === 'shuffle') await run([...p, 'shuffle', value ? 'On' : 'Off']);
      else if (cmd === 'repeat') await run([...p, 'loop', LOOP_BACK[value] || 'None']);
      setTimeout(snapshot, 250);
    },
    // artwork that the player saved as a local file (Chromium, Firefox…)
    async image(key) {
      const p = players.get(String(key).split('?')[0]);
      if (!p?.art) return null;
      try {
        const body = await fs.readFile(p.art);
        const ext = p.art.split('.').pop().toLowerCase();
        return { body, contentType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
      } catch { return null; }
    },
  };
}
