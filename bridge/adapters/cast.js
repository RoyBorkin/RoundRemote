// Google Cast adapter: mDNS discovery + castv2 media namespace. Shows whatever app is
// casting (Spotify, YouTube Music, TIDAL, Qobuz, …) and controls it.
import { createRequire } from 'node:module';
import { log } from '../lib/util.js';

const require = createRequire(import.meta.url);
const MEDIA_NS = 'urn:x-cast:com.google.cast.media';
const BACKDROP = ['E8C28D3C', '00000000-0000-0000-0000-000000000000'];

export function create({ hub, setStatus }) {
  const { Client, DefaultMediaReceiver } = require('castv2-client');
  const mdnsFactory = require('multicast-dns');
  const devices = new Map(); // id -> { id, name, host, port, client, player, sessionId, media, volume, muted, app }
  let mdns = null, queryT = null, syncT = null;

  function publish(d) {
    const s = d.status || {};
    const md = d.media?.metadata || {};
    const cmds = s.supportedMediaCommands ?? 0;
    const hasMedia = !!(d.player && d.media && s.playerState && s.playerState !== 'IDLE');
    hub.upsert('cast', d.id, {
      name: d.name,
      sourceApp: d.app?.displayName || '',
      state: {
        track: hasMedia ? {
          id: d.media.contentId || md.title || '',
          title: md.title || d.app?.statusText || 'Casting', artist: md.artist || md.albumArtist || md.subtitle || '',
          album: md.albumName || '', durationMs: (d.media.duration || 0) * 1000, art: md.images?.[0]?.url || '',
        } : null,
        isPlaying: s.playerState === 'PLAYING' || s.playerState === 'BUFFERING',
        progressMs: (s.currentTime || 0) * 1000,
        volume: d.volume != null ? Math.round(d.volume * 100) : null, muted: !!d.muted,
      },
      caps: {
        seek: !!(cmds & 2), volume: d.volume != null, next: !!(cmds & 64) || !!(cmds & 16) || cmds === 0,
        prev: !!(cmds & 128) || !!(cmds & 32) || cmds === 0,
      },
      sampledAt: Date.now(),
    });
  }

  function join(d, app) {
    if (d.sessionId === app.sessionId && d.player) return;
    d.sessionId = app.sessionId;
    d.player = null; d.media = null; d.status = null;
    d.client.join(app, DefaultMediaReceiver, (err, player) => {
      if (err) { log('cast', `${d.name}: join failed ${err.message}`); return; }
      d.player = player;
      player.on('status', (st) => { if (st) { d.status = st; if (st.media) d.media = st.media; publish(d); } });
      player.getStatus((e, st) => { if (!e && st) { d.status = st; if (st.media) d.media = st.media; } publish(d); });
    });
  }

  function onReceiver(d, status) {
    if (!status) return;
    if (status.volume) { d.volume = status.volume.level; d.muted = status.volume.muted; }
    const app = (status.applications || []).find((a) => !BACKDROP.includes(a.appId) && (a.namespaces || []).some((n) => n.name === MEDIA_NS));
    d.app = app || null;
    if (app) join(d, app);
    else { d.player = null; d.sessionId = null; d.media = null; d.status = null; }
    publish(d);
  }

  function connect(d) {
    const client = new Client();
    d.client = client;
    client.on('error', (e) => {
      log('cast', `${d.name}: ${e.message}`);
      try { client.close(); } catch {}
      d.client = null; d.player = null; d.sessionId = null;
      setTimeout(() => { if (devices.has(d.id)) connect(d); }, 10000);
    });
    client.connect({ host: d.host, port: d.port }, () => {
      log('cast', `connected to ${d.name}`);
      client.on('status', (st) => onReceiver(d, st));
      client.getStatus((e, st) => onReceiver(d, st));
    });
  }

  function onMdns(res) {
    const recs = [...(res.answers || []), ...(res.additionals || [])];
    for (const ptr of recs.filter((r) => r.type === 'PTR' && r.name === '_googlecast._tcp.local')) {
      const inst = ptr.data;
      const srv = recs.find((r) => r.type === 'SRV' && r.name === inst);
      const txt = recs.find((r) => r.type === 'TXT' && r.name === inst);
      if (!srv) continue;
      const a = recs.find((r) => r.type === 'A' && r.name === srv.data.target);
      const kv = Object.fromEntries((txt?.data || []).map((b) => String(b).split(/=(.*)/s).slice(0, 2)));
      const id = kv.id || inst;
      const host = a?.data || srv.data.target;
      if (devices.has(id)) { const d = devices.get(id); if (d.host !== host) { d.host = host; } continue; }
      const d = { id, name: kv.fn || inst.split('._')[0], host, port: srv.data.port };
      devices.set(id, d);
      setStatus(`${devices.size} device${devices.size === 1 ? '' : 's'}`);
      connect(d);
    }
  }

  const find = (id) => { const d = devices.get(id); if (!d?.client) throw new Error('Cast device offline'); return d; };
  const cb2p = (fn) => new Promise((res, rej) => fn((e, r) => (e ? rej(e) : res(r))));

  return {
    id: 'cast',
    async start() {
      mdns = mdnsFactory();
      mdns.on('response', onMdns);
      const q = () => mdns.query({ questions: [{ name: '_googlecast._tcp.local', type: 'PTR' }] });
      q(); setTimeout(q, 2000);
      queryT = setInterval(q, 60000);
      // Periodic resync of playback position for drift.
      syncT = setInterval(() => {
        for (const d of devices.values()) {
          if (d.player && d.status?.playerState === 'PLAYING') d.player.getStatus((e, st) => { if (!e && st) { d.status = st; if (st.media) d.media = st.media; publish(d); } });
        }
      }, 8000);
      setStatus('searching…');
    },
    stop() { clearInterval(queryT); clearInterval(syncT); mdns?.destroy(); for (const d of devices.values()) try { d.client?.close(); } catch {} },
    async command(id, cmd, value) {
      const d = find(id);
      if (cmd === 'volume') return cb2p((cb) => d.client.setVolume({ level: Math.max(0, Math.min(1, value / 100)) }, cb));
      if (!d.player) throw new Error('Nothing is casting to this device');
      const p = d.player;
      if (cmd === 'play') return cb2p((cb) => p.play(cb));
      if (cmd === 'pause') return cb2p((cb) => p.pause(cb));
      if (cmd === 'seek') return cb2p((cb) => p.seek(value / 1000, cb));
      if (cmd === 'next' || cmd === 'prev') {
        return cb2p((cb) => p.media.sessionRequest({ type: 'QUEUE_UPDATE', jump: cmd === 'next' ? 1 : -1 }, cb));
      }
    },
  };
}
