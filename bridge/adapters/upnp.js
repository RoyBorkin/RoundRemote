// UPnP AV / DLNA renderer adapter: SSDP discovery + AVTransport/RenderingControl SOAP.
// Works with WiiM, Bluesound, Denon/Marantz HEOS, Sonos (UPnP), BubbleUPnP, Volumio,
// moOde/upmpdcli, gmrender… Tidal/Qobuz streams on these renderers are detected from
// the track URI so the Tidal/Qobuz tiles can follow them.
import dgram from 'node:dgram';
import { tag, unescapeXml, escapeXml, hmsToMs, msToHms, fetchText, isPrivateHost, log } from '../lib/util.js';

const SSDP_ADDR = '239.255.255.250', SSDP_PORT = 1900;
const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';
const RC = 'urn:schemas-upnp-org:service:RenderingControl:1';

function sourceFrom(s = '') {
  if (/tidal/i.test(s)) return 'TIDAL';
  if (/qobuz/i.test(s)) return 'Qobuz';
  if (/spotify/i.test(s)) return 'Spotify';
  if (/deezer/i.test(s)) return 'Deezer';
  if (/amazon/i.test(s)) return 'Amazon Music';
  return '';
}

export function create({ hub, cfg, setStatus }) {
  const devices = new Map(); // udn -> device
  let sock = null, searchT = null, pollT = null;

  async function soap(dev, svc, action, args = {}) {
    const s = dev.services[svc];
    if (!s) throw new Error(`${svc} not supported`);
    const type = svc === 'avt' ? s.type || AVT : s.type || RC;
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>
<u:${action} xmlns:u="${type}">${Object.entries({ InstanceID: 0, ...args }).map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`).join('')}</u:${action}>
</s:Body></s:Envelope>`;
    return fetchText(s.control, {
      method: 'POST', body,
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${type}#${action}"` },
    }, 4000);
  }

  const pending = new Set();
  async function describe(location) {
    if (pending.has(location)) return;
    pending.add(location);
    let xml;
    try { xml = await fetchText(location, {}, 4000); } finally { setTimeout(() => pending.delete(location), 30000); }
    const udn = tag(xml, 'UDN');
    if (!udn || devices.has(udn)) return;
    const base = tag(xml, 'URLBase') || location;
    const services = {};
    for (const block of xml.match(/<service>[\s\S]*?<\/service>/gi) || []) {
      const type = tag(block, 'serviceType');
      const control = new URL(tag(block, 'controlURL'), base).href;
      if (/:AVTransport:/.test(type)) services.avt = { type, control };
      if (/:RenderingControl:/.test(type)) services.rc = { type, control };
    }
    if (!services.avt) return;
    const dev = { udn, name: tag(xml, 'friendlyName') || 'UPnP renderer', base: new URL(location).origin, services, fails: 0, playMode: null };
    devices.set(udn, dev);
    log('upnp', `found ${dev.name}`);
    setStatus(`${devices.size} renderer${devices.size === 1 ? '' : 's'}`);
    poll(dev);
  }

  function search() {
    const msg = (st) => Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
    for (const st of [AVT, 'urn:schemas-upnp-org:device:MediaRenderer:1']) sock.send(msg(st), SSDP_PORT, SSDP_ADDR, () => {});
  }

  async function poll(dev) {
    try {
      const [ti, pi] = await Promise.all([soap(dev, 'avt', 'GetTransportInfo'), soap(dev, 'avt', 'GetPositionInfo')]);
      const stateStr = tag(ti, 'CurrentTransportState');
      const meta = unescapeXml(tag(pi, 'TrackMetaData'));
      const uri = tag(pi, 'TrackURI');
      let volume = null, muted = false;
      if (dev.services.rc) {
        try { volume = +tag(await soap(dev, 'rc', 'GetVolume', { Channel: 'Master' }), 'CurrentVolume'); } catch {}
        try { muted = tag(await soap(dev, 'rc', 'GetMute', { Channel: 'Master' }), 'CurrentMute') === '1'; } catch {}
      }
      if (dev.playMode === null) {
        try { dev.playMode = tag(await soap(dev, 'avt', 'GetTransportSettings'), 'PlayMode') || false; } catch { dev.playMode = false; }
      }
      const title = tag(meta, 'title');
      let art = tag(meta, 'albumArtURI');
      if (art) art = `/api/image/upnp/${encodeURIComponent(new URL(art, dev.base).href)}`;
      const noMedia = /NO_MEDIA_PRESENT/.test(stateStr) || (!title && !uri);
      dev.fails = 0;
      hub.upsert('upnp', dev.udn, {
        name: dev.name,
        sourceApp: sourceFrom(uri + meta),
        state: {
          track: noMedia ? null : {
            id: `${title}|${uri}`.slice(0, 200), title: title || uri.split('/').pop() || 'Unknown',
            artist: tag(meta, 'artist') || tag(meta, 'creator') || '', album: tag(meta, 'album') || '',
            durationMs: hmsToMs(tag(pi, 'TrackDuration')), art,
          },
          isPlaying: /PLAYING|TRANSITIONING/.test(stateStr),
          progressMs: hmsToMs(tag(pi, 'RelTime')),
          volume: Number.isFinite(volume) ? volume : null, muted,
          shuffle: dev.playMode ? /SHUFFLE/.test(dev.playMode) : null,
          repeat: dev.playMode ? (/REPEAT_ONE/.test(dev.playMode) ? 'one' : /REPEAT_ALL/.test(dev.playMode) ? 'all' : 'off') : null,
        },
        caps: { seek: true, volume: !!dev.services.rc, next: true, prev: true, shuffle: !!dev.playMode, repeat: !!dev.playMode },
      });
    } catch (e) {
      if (++dev.fails >= 5) { devices.delete(dev.udn); hub.remove('upnp', dev.udn); log('upnp', `lost ${dev.name}`); setStatus(`${devices.size} renderers`); }
    }
  }

  return {
    id: 'upnp',
    async start() {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (buf) => {
        const loc = /^location:\s*(.+)$/im.exec(buf.toString())?.[1]?.trim();
        if (loc) describe(loc).catch(() => {});
      });
      sock.on('error', (e) => { setStatus(`error: ${e.message}`, false); });
      await new Promise((r) => sock.bind(0, r));
      search();
      setTimeout(search, 3000);
      searchT = setInterval(search, (cfg.upnp.searchEverySec || 60) * 1000);
      pollT = setInterval(() => devices.forEach((d) => poll(d)), cfg.upnp.pollMs || 2000);
      setStatus('searching…');
    },
    stop() { clearInterval(searchT); clearInterval(pollT); try { sock?.close(); } catch {} },
    async command(udn, cmd, value) {
      const dev = devices.get(udn);
      if (!dev) throw new Error('renderer offline');
      if (cmd === 'play') await soap(dev, 'avt', 'Play', { Speed: 1 });
      else if (cmd === 'pause') await soap(dev, 'avt', 'Pause');
      else if (cmd === 'next') await soap(dev, 'avt', 'Next');
      else if (cmd === 'prev') await soap(dev, 'avt', 'Previous');
      else if (cmd === 'seek') await soap(dev, 'avt', 'Seek', { Unit: 'REL_TIME', Target: msToHms(value) });
      else if (cmd === 'volume') await soap(dev, 'rc', 'SetVolume', { Channel: 'Master', DesiredVolume: Math.round(value) });
      else if (cmd === 'shuffle' || cmd === 'repeat') {
        const z = hub.get(`upnp:${udn}`)?.state || {};
        const shuffle = cmd === 'shuffle' ? value : z.shuffle;
        const repeat = cmd === 'repeat' ? value : z.repeat;
        const mode = shuffle ? (repeat === 'all' ? 'REPEAT_ALL_SHUFFLE' : 'SHUFFLE') : repeat === 'one' ? 'REPEAT_ONE' : repeat === 'all' ? 'REPEAT_ALL' : 'NORMAL';
        await soap(dev, 'avt', 'SetPlayMode', { NewPlayMode: mode });
        dev.playMode = mode;
      }
      setTimeout(() => poll(dev), 300);
    },
    async image(url) {
      const u = new URL(url);
      if (!isPrivateHost(u.hostname)) return null; // only proxy artwork from LAN devices
      const r = await fetch(u);
      if (!r.ok) return null;
      return { contentType: r.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await r.arrayBuffer()) };
    },
  };
}
