// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// "Find servers": Round Remote bridges / servers announce themselves on the LAN over mDNS as `_roundremote._tcp`
// (TXT: role, version), and a companion (Settings → Connection → Server, or the "Server offline" screen) looks for
// them. The DNS packets are the bridge's own small encoder / parser (adapters/androidtv-discover.js, no npm deps).
//
//   advertise({ name, port, txt })   → { stop() }    answers queries for _roundremote._tcp.local on every LAN interface
//   discover({ timeout })            → [{ name, url, host, address, port, role, version }]  (each one checked over HTTP)
//
// Docker: multicast only reaches a container with `network_mode: host`; with a bridged network "Find servers" finds
// nothing and the address is typed in instead (e.g. http://192.168.50.108:8765).
import dgram from 'node:dgram';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { encodeQuery, encodeResponse, parsePacket, listInterfaces, sameSubnet, parseAvahi } from '../adapters/androidtv-discover.js';
import { probeServer } from './proxy.js';

export const SERVICE = '_roundremote._tcp.local';
const MDNS_IP = '224.0.0.251', MDNS_PORT = 5353;
const T = { A: 1, PTR: 12, TXT: 16, SRV: 33, ANY: 255 };
const lanIfs = () => listInterfaces().filter((i) => !i.virtual && !i.linkLocal);
const label = (s) => String(s || 'Round Remote').replace(/[.\u0000-\u001f]/g, ' ').trim().slice(0, 60) || 'Round Remote';

/** Answer mDNS queries for this bridge. Never throws; a busy / forbidden port 5353 just means no announcements. */
export function advertise({ name = os.hostname(), port = 8765, txt = {}, log = () => {} } = {}) {
  const inst = `${label(name)}.${SERVICE}`;
  const host = `${String(os.hostname()).replace(/\.local$/i, '').replace(/[^a-z0-9-]/gi, '-') || 'roundremote'}.local`;
  const txtList = Object.entries({ path: '/', ...txt }).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${String(v).slice(0, 200)}`);
  let sock = null, stopped = false;
  const records = (addr) => ({
    answers: [{ name: SERVICE, type: T.PTR, ttl: 120, data: inst }],
    additionals: [
      { name: inst, type: T.SRV, ttl: 120, flush: true, data: { priority: 0, weight: 0, port, target: host } },
      { name: inst, type: T.TXT, ttl: 120, flush: true, data: txtList },
      ...(addr ? [{ name: host, type: T.A, ttl: 120, flush: true, data: addr }] : []),
    ],
  });
  const addrFor = (ip) => { const ifs = lanIfs(); return (ifs.find((i) => ip && sameSubnet(ip, i)) || ifs[0])?.address || ''; };
  const announce = () => {
    if (!sock || stopped) return;
    for (const i of lanIfs()) {
      try { sock.setMulticastInterface(i.address); sock.send(encodeResponse(records(i.address)), MDNS_PORT, MDNS_IP); } catch {}
    }
  };
  try {
    sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', (e) => { log('mdns', `not announcing (${e.code || e.message})`); try { sock.close(); } catch {} sock = null; });
    sock.on('message', (buf, rinfo) => {
      const p = parsePacket(buf);
      if (p.response) return;
      const wanted = p.questions.filter((q) => {
        const n = q.name.toLowerCase();
        return (n === SERVICE && [T.PTR, T.ANY].includes(q.type)) || (n === inst.toLowerCase() && [T.SRV, T.TXT, T.ANY].includes(q.type))
          || (n === '_services._dns-sd._udp.local' && [T.PTR, T.ANY].includes(q.type));
      });
      if (!wanted.length) return;
      const rec = records(addrFor(rinfo.address));
      if (wanted.some((q) => q.name.toLowerCase() === '_services._dns-sd._udp.local')) rec.answers.push({ name: '_services._dns-sd._udp.local', type: T.PTR, ttl: 120, data: SERVICE });
      try {
        if (rinfo.port !== MDNS_PORT) sock.send(encodeResponse({ id: p.id, questions: wanted, ...rec }), rinfo.port, rinfo.address);   // legacy unicast: straight back
        else sock.send(encodeResponse(rec), MDNS_PORT, MDNS_IP);
      } catch {}
    });
    sock.bind({ port: +(process.env.RR_MDNS_PORT || MDNS_PORT), exclusive: false }, () => {
      for (const i of lanIfs()) { try { sock.addMembership(MDNS_IP, i.address); } catch {} }
      try { sock.setMulticastTTL(255); } catch {}
      log('mdns', `announcing ${inst} on port ${port}`);
      announce(); setTimeout(announce, 1500).unref?.();
    });
    sock.unref?.();
  } catch (e) { log('mdns', `not announcing (${e.message})`); sock = null; }
  return { stop() { stopped = true; try { sock?.close(); } catch {} sock = null; } };
}

/** Look for Round Remote servers for `timeout` ms; every candidate is confirmed with GET /api/info. */
export async function discover({ timeout = 2500, also = [] } = {}) {
  const found = new Map();   // address:port → { name, host, address, port, txt }
  const collect = (buf) => {
    const p = parsePacket(buf);
    if (!p.response) return;
    const recs = p.records;
    for (const ptr of recs.filter((r) => r.type === T.PTR && r.name.toLowerCase() === SERVICE)) {
      const inst = ptr.data;
      const srv = recs.find((r) => r.type === T.SRV && r.name === inst);
      const txt = recs.find((r) => r.type === T.TXT && r.name === inst)?.data || {};
      const a = srv && recs.find((r) => r.type === T.A && r.name.toLowerCase() === String(srv.data.target).toLowerCase());
      if (!srv || !a) continue;
      found.set(`${a.data}:${srv.data.port}`, { name: inst.slice(0, -(SERVICE.length + 1)), host: srv.data.target, address: a.data, port: srv.data.port, txt });
    }
  };
  const socks = [];
  const query = encodeQuery([{ name: SERVICE, type: T.PTR }], { id: Math.floor(Math.random() * 65535) });
  const targets = [...lanIfs().map((i) => ({ bind: i.address, to: MDNS_IP })),
    ...String(process.env.RR_MDNS_TARGETS || '').split(',').filter(Boolean).map((t) => ({ bind: undefined, to: t })), ...also.map((t) => ({ bind: undefined, to: t }))];
  await Promise.all(targets.map((t) => new Promise((resolve) => {
    try {
      const s = dgram.createSocket('udp4');
      socks.push(s);
      s.on('error', () => resolve());
      s.on('message', collect);
      s.bind({ port: 0, address: t.bind }, () => {
        try { if (t.to === MDNS_IP) s.setMulticastInterface(t.bind); } catch {}
        const port = t.to === MDNS_IP ? MDNS_PORT : +(process.env.RR_MDNS_PORT || MDNS_PORT);
        s.send(query, port, t.to, () => resolve());
        setTimeout(() => { try { s.send(query, port, t.to); } catch {} }, 600).unref?.();
      });
    } catch { resolve(); }
  })));
  const avahi = process.platform === 'linux' ? new Promise((resolve) => execFile('avahi-browse', ['-rpt', '_roundremote._tcp'], { timeout }, (e, so) => {
    for (const r of parseAvahi(so || '')) found.set(`${r.address}:${r.port}`, { name: r.name, host: r.host, address: r.address, port: r.port, txt: r.txt });
    resolve();
  })) : Promise.resolve();
  await Promise.all([new Promise((r) => setTimeout(r, timeout)), avahi]);
  socks.forEach((s) => { try { s.close(); } catch {} });
  const mine = new Set(listInterfaces().map((i) => i.address));
  const list = await Promise.all([...found.values()].map(async (c) => {
    const url = `http://${c.address}:${c.port}`;
    const r = await probeServer(url, { timeout: 2500 });
    if (!r.ok) return null;
    return { name: c.name, host: c.host.replace(/\.$/, ''), address: c.address, port: c.port, url, role: r.info?.role || c.txt.role || 'standalone',
      version: r.info?.version || c.txt.version || '', self: mine.has(c.address), latencyMs: r.latencyMs };
  }));
  return list.filter(Boolean).sort((a, b) => (a.self - b.self) || ((b.role === 'server') - (a.role === 'server')) || a.name.localeCompare(b.name));
}
