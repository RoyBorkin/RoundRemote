// AirPlay adapter — the Pi becomes an AirPlay 1/2 speaker via shairport-sync, and this
// adapter shows what the phone/Mac is streaming (metadata pipe) and remote-controls it
// back over D-Bus (play/pause/next/previous/volume). Seeking isn't possible over AirPlay.
//
// shairport-sync.conf needs:
//   metadata = { enabled = "yes"; include_cover_art = "yes"; pipe_name = "/tmp/shairport-sync-metadata"; };
//   and D-Bus enabled (dbus_service_bus = "system";)   — pi/setup.sh configures this.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { log } from '../lib/util.js';

const ITEM = /<item><type>([0-9a-f]{8})<\/type><code>([0-9a-f]{8})<\/code><length>(\d+)<\/length>(?:\s*<data encoding="base64">\s*([\s\S]*?)<\/data>)?<\/item>/g;
const hex4 = (h) => Buffer.from(h, 'hex').toString('latin1');

export function create({ hub, cfg, setStatus }) {
  const conf = cfg.airplay;
  const ID = 'shairport';
  const st = { title: '', artist: '', album: '', durationMs: 0, progressMs: 0, sampledAt: Date.now(), playing: false, active: false, volume: null, sender: '', artN: 0, art: null };
  let stream = null, buf = '', retryT = null;

  function snapshot() {
    const pos = st.playing ? st.progressMs + (Date.now() - st.sampledAt) : st.progressMs;
    return pos;
  }
  function publish() {
    hub.upsert('airplay', ID, {
      name: st.sender ? `${conf.name} ← ${st.sender}` : conf.name,
      state: {
        track: st.active && st.title ? {
          id: `${st.title}|${st.artist}|${st.album}`, title: st.title, artist: st.artist, album: st.album,
          durationMs: st.durationMs, art: st.art ? `/api/image/airplay/${st.artN}` : '',
        } : null,
        isPlaying: st.playing, progressMs: st.progressMs, volume: st.volume, muted: st.volume === 0,
      },
      caps: { seek: false, volume: true, next: true, prev: true },
      sampledAt: st.sampledAt,
    });
  }

  function handle(type, code, data) {
    const t = hex4(type), c = hex4(code);
    const text = () => (data ? data.toString('utf8') : '');
    if (t === 'core') {
      if (c === 'minm') st.title = text();
      else if (c === 'asar') st.artist = text();
      else if (c === 'asal') st.album = text();
      else if (c === 'astm' && data?.length >= 4) st.durationMs = data.readUInt32BE(0);
      return;
    }
    if (t !== 'ssnc') return;
    switch (c) {
      case 'pbeg': st.active = true; st.playing = true; st.sampledAt = Date.now(); break;
      case 'pend': st.active = false; st.playing = false; st.title = st.artist = st.album = ''; st.art = null; break;
      case 'pfls': st.progressMs = snapshot(); st.sampledAt = Date.now(); st.playing = false; break;
      case 'prsm': st.sampledAt = Date.now(); st.playing = true; st.active = true; break;
      case 'prgr': {
        const [start, cur, end] = text().split('/').map(Number);
        if ([start, cur, end].every(Number.isFinite)) {
          const wrap = (x) => (x < 0 ? x + 2 ** 32 : x);
          st.progressMs = wrap(cur - start) / 44.1;
          st.durationMs = wrap(end - start) / 44.1 || st.durationMs;
          st.sampledAt = Date.now(); st.playing = true; st.active = true;
        }
        break;
      }
      case 'pvol': {
        const av = parseFloat(text().split(',')[0]);
        if (Number.isFinite(av)) st.volume = av <= -144 ? 0 : Math.round(((av + 30) / 30) * 100);
        break;
      }
      case 'PICT': if (data?.length > 16) { st.art = data; st.artN++; } break;
      case 'snam': st.sender = text(); break;
      case 'mden': break;
      default: return;
    }
    publish();
  }

  function open() {
    clearTimeout(retryT);
    if (!fs.existsSync(conf.metadataPipe)) {
      setStatus(`waiting for shairport-sync (${conf.metadataPipe} not found)`, false);
      retryT = setTimeout(open, 10000);
      return;
    }
    setStatus('listening to shairport-sync');
    publish();
    stream = fs.createReadStream(conf.metadataPipe, { encoding: 'utf8' });
    stream.on('data', (chunk) => {
      buf += chunk;
      let m, last = 0;
      ITEM.lastIndex = 0;
      while ((m = ITEM.exec(buf))) {
        last = ITEM.lastIndex;
        try { handle(m[1], m[2], m[4] ? Buffer.from(m[4].replace(/\s+/g, ''), 'base64') : null); } catch (e) { log('airplay', e.message); }
      }
      buf = buf.slice(last);
      if (buf.length > 5e6) buf = '';
    });
    const reopen = () => { stream = null; retryT = setTimeout(open, 1000); };
    stream.on('end', reopen);
    stream.on('error', (e) => { setStatus(`pipe error: ${e.message}`); reopen(); });
  }

  function dbus(iface, method, ...args) {
    return new Promise((resolve, reject) => {
      execFile('dbus-send', [`--${conf.bus === 'session' ? 'session' : 'system'}`, '--print-reply', '--type=method_call',
        '--dest=org.gnome.ShairportSync', '/org/gnome/ShairportSync', `org.gnome.ShairportSync.${iface}.${method}`, ...args],
      { timeout: 4000 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
    });
  }

  return {
    id: 'airplay',
    async start() { open(); },
    stop() { clearTimeout(retryT); stream?.destroy(); },
    async command(_id, cmd, value) {
      if (cmd === 'play') { await dbus('RemoteControl', 'Play'); st.playing = true; st.sampledAt = Date.now(); }
      else if (cmd === 'pause') { await dbus('RemoteControl', 'Pause'); st.progressMs = snapshot(); st.sampledAt = Date.now(); st.playing = false; }
      else if (cmd === 'next') await dbus('RemoteControl', 'Next');
      else if (cmd === 'prev') await dbus('RemoteControl', 'Previous');
      else if (cmd === 'volume') {
        try { await dbus('AdvancedRemoteControl', 'SetVolume', `int32:${Math.round(value)}`); }
        catch { await dbus('RemoteControl', 'SetAirplayVolume', `double:${value <= 0 ? -144 : (-30 + (30 * value) / 100).toFixed(2)}`); }
        st.volume = Math.round(value);
      } else throw new Error(`${cmd} is not supported over AirPlay`);
      publish();
    },
    async image() { return st.art ? { contentType: st.art[0] === 0x89 ? 'image/png' : 'image/jpeg', body: st.art } : null; },
  };
}
