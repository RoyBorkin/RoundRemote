// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Finding Google TV / Android TV devices on the network, robustly (used by adapters/androidtv.js).
//
// Google TVs advertise the Android TV Remote service (protocol v2) over mDNS as `_androidtvremote2._tcp`
// (the type Home Assistant's Android TV Remote integration listens for); the remote itself is TLS on port 6466 and
// pairing on port 6467 (androidtvremote2 / androidtv-remote defaults). Most of them also advertise Google Cast
// (`_googlecast._tcp`, TXT fn = friendly name, md = model).
//
// A single multicast-dns socket on port 5353 often finds nothing: on Windows the firewall drops inbound UDP 5353 for
// node.exe (or the network is "Public"), and Hyper-V / WSL / VPN adapters steal the default multicast route; on a Pi the
// query can leave on the wrong interface (wlan0 vs eth0, docker0). So several methods run side by side:
//   1. one-shot "legacy unicast" queries (RFC 6762 §5.1/§6.7) from an ephemeral port on EVERY IPv4 interface — the TV
//      answers straight back by unicast, which passes the Windows firewall (unicast replies to our own multicast are
//      allowed for 3 s) and never fights avahi / Bonjour / Windows for port 5353;
//   2. a classic mDNS listener on 0.0.0.0:5353 (shared, reuseAddr) joined on every interface;
//   3. `avahi-browse -rpt` on Linux when avahi-utils is installed;
//   4. Cast devices (`_googlecast._tcp`) whose pairing port 6467 is open are Google TVs too;
//   5. when all of that finds nothing: a quick TCP sweep of the local /24 (or up to /22) for port 6467.
// Plus the TVs the user added by IP (remembered by the adapter). Every scan returns diagnostics for the UI.
// The DNS packet code below is our own small encoder / parser (no dependencies), exported for tests.
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';

export const ATV_SERVICE = '_androidtvremote2._tcp.local';
export const CAST_SERVICE = '_googlecast._tcp.local';
export const REMOTE_PORT = 6466, PAIRING_PORT = 6467;
const MDNS_IP = '224.0.0.251', MDNS_PORT = 5353;
const T = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33, ANY: 255 };

// ---------------------------------------------------------------- DNS packets
function encodeName(name) {
  const parts = String(name).replace(/\.$/, '').split('.').filter(Boolean);
  const bufs = parts.map((p) => { const b = Buffer.from(p, 'utf8'); return Buffer.concat([Buffer.from([Math.min(63, b.length)]), b.subarray(0, 63)]); });
  return Buffer.concat([...bufs, Buffer.from([0])]);
}
/** One query packet. `qu` asks for a unicast reply (QU bit); `id` is echoed back by legacy-unicast responders. */
export function encodeQuery(questions, { id = 0, qu = false } = {}) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id & 0xffff, 0); head.writeUInt16BE(questions.length, 4);
  const qs = questions.map((q) => { const t = Buffer.alloc(4); t.writeUInt16BE(q.type || T.PTR, 0); t.writeUInt16BE(1 | (qu ? 0x8000 : 0), 2); return Buffer.concat([encodeName(q.name), t]); });
  return Buffer.concat([head, ...qs]);
}
/** A response packet (for tests and fake devices): answers / additionals as { name, type, ttl, data }. */
export function encodeResponse({ id = 0, answers = [], additionals = [], questions = [] }) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id & 0xffff, 0); head.writeUInt16BE(0x8400, 2);
  head.writeUInt16BE(questions.length, 4); head.writeUInt16BE(answers.length, 6); head.writeUInt16BE(additionals.length, 10);
  const rr = (r) => {
    let data;
    if (r.type === T.A) data = Buffer.from(r.data.split('.').map(Number));
    else if (r.type === T.PTR) data = encodeName(r.data);
    else if (r.type === T.SRV) { const b = Buffer.alloc(6); b.writeUInt16BE(r.data.priority || 0, 0); b.writeUInt16BE(r.data.weight || 0, 2); b.writeUInt16BE(r.data.port, 4); data = Buffer.concat([b, encodeName(r.data.target)]); }
    else if (r.type === T.TXT) data = Buffer.concat((r.data.length ? r.data : ['']).map((s) => { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length]), b]); }));
    else if (r.type === T.AAAA) { data = Buffer.alloc(16); r.data.split(':').forEach((g, i) => { if (i < 8) data.writeUInt16BE(parseInt(g || '0', 16), i * 2); }); }
    else data = Buffer.alloc(0);
    const t = Buffer.alloc(10);
    t.writeUInt16BE(r.type, 0); t.writeUInt16BE(1 | (r.flush ? 0x8000 : 0), 2); t.writeUInt32BE(r.ttl ?? 120, 4); t.writeUInt16BE(data.length, 8);
    return Buffer.concat([encodeName(r.name), t, data]);
  };
  const qs = questions.map((q) => { const t = Buffer.alloc(4); t.writeUInt16BE(q.type || T.PTR, 0); t.writeUInt16BE(1, 2); return Buffer.concat([encodeName(q.name), t]); });
  return Buffer.concat([head, ...qs, ...answers.map(rr), ...additionals.map(rr)]);
}
/** Parse a DNS packet → { id, response, questions, records } (records = answers + authorities + additionals). Never throws. */
export function parsePacket(buf) {
  const out = { id: 0, response: false, questions: [], records: [] };
  try {
    out.id = buf.readUInt16BE(0); out.response = !!(buf.readUInt16BE(2) & 0x8000);
    const qd = buf.readUInt16BE(4), n = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
    let off = 12;
    const readName = (o) => {
      const labels = []; let jumped = false, end = o, guard = 0;
      while (guard++ < 128) {
        const len = buf[o];
        if (len === undefined) throw new Error('short');
        if (len === 0) { if (!jumped) end = o + 1; break; }
        if ((len & 0xc0) === 0xc0) { if (!jumped) end = o + 2; o = ((len & 0x3f) << 8) | buf[o + 1]; jumped = true; continue; }
        labels.push(buf.toString('utf8', o + 1, o + 1 + len)); o += 1 + len;
      }
      return { labels, name: labels.join('.'), end };
    };
    for (let i = 0; i < qd; i++) { const nm = readName(off); off = nm.end; out.questions.push({ name: nm.name, type: buf.readUInt16BE(off), qu: !!(buf.readUInt16BE(off + 2) & 0x8000) }); off += 4; }
    for (let i = 0; i < n && off < buf.length; i++) {
      const nm = readName(off); off = nm.end;
      const type = buf.readUInt16BE(off), ttl = buf.readUInt32BE(off + 4), len = buf.readUInt16BE(off + 8);
      off += 10;
      const rd = off; off += len;
      const r = { name: nm.name, labels: nm.labels, type, ttl };
      if (type === T.A && len === 4) r.data = [...buf.subarray(rd, rd + 4)].join('.');
      else if (type === T.AAAA && len === 16) r.data = Array.from({ length: 8 }, (_, k) => buf.readUInt16BE(rd + k * 2).toString(16)).join(':');
      else if (type === T.PTR) { const p = readName(rd); r.data = p.name; r.dataLabels = p.labels; }
      else if (type === T.SRV) r.data = { priority: buf.readUInt16BE(rd), weight: buf.readUInt16BE(rd + 2), port: buf.readUInt16BE(rd + 4), target: readName(rd + 6).name };
      else if (type === T.TXT) { const kv = {}; let o = rd; while (o < rd + len) { const l = buf[o]; const s = buf.toString('utf8', o + 1, o + 1 + l); o += 1 + l; const eq = s.indexOf('='); if (s) kv[(eq < 0 ? s : s.slice(0, eq)).toLowerCase()] = eq < 0 ? true : s.slice(eq + 1); } r.data = kv; }
      else continue;
      out.records.push(r);
    }
  } catch { /* a truncated or odd packet: keep what we have */ }
  return out;
}

// ---------------------------------------------------------------- interfaces
const VIRTUAL = /vEthernet|WSL|Hyper-?V|VirtualBox|VMware|vmnet|vboxnet|docker|^br-|^veth|virbr|tailscale|zerotier|^zt|utun|^tun|^tap|^wg|wireguard|loopback|npcap|bluetooth|hamachi|vpn|cisco|fortinet|nordlynx|^lxc|^lxd|^cni|flannel|^podman/i;
const ip2n = (ip) => ip.split('.').reduce((n, x) => ((n << 8) | (+x & 255)) >>> 0, 0);
const n2ip = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const prefixOf = (mask) => ip2n(mask).toString(2).replace(/0+$/, '').length;
export const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);
/** IPv4 interfaces, each { name, address, netmask, prefix, cidr, virtual, linkLocal, private }. */
export function listInterfaces(ifs = os.networkInterfaces()) {
  const out = [];
  for (const [name, addrs] of Object.entries(ifs || {})) {
    for (const a of addrs || []) {
      if (!(a.family === 'IPv4' || a.family === 4) || a.internal) continue;
      const prefix = prefixOf(a.netmask || '255.255.255.0');
      const docker = /^172\.17\./.test(a.address) && /docker|br-/i.test(name);
      out.push({ name, address: a.address, netmask: a.netmask, prefix, cidr: `${n2ip(ip2n(a.address) & ip2n(a.netmask))}/${prefix}`,
        virtual: VIRTUAL.test(name) || docker, linkLocal: /^169\.254\./.test(a.address), private: isPrivate(a.address) });
    }
  }
  // the likely LAN first: real adapters with a private address
  return out.sort((a, b) => (a.virtual - b.virtual) || (a.linkLocal - b.linkLocal) || (b.private - a.private));
}
export const sameSubnet = (ip, itf) => { try { return ((ip2n(ip) ^ ip2n(itf.address)) & ip2n(itf.netmask)) === 0; } catch { return false; } };
export const isIPv4 = (s) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(String(s)) && String(s).split('.').every((x) => +x <= 255);

// ---------------------------------------------------------------- helpers
/** Is a TCP port open? → true / false (refused, unreachable or no answer in `ms`). */
export function probePort(host, port, ms = 900) {
  return new Promise((resolve) => {
    let done = false;
    const s = net.connect({ host, port });
    const end = (v) => { if (done) return; done = true; try { s.destroy(); } catch {} resolve(v); };
    s.setTimeout(ms, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
}
const unescapeAvahi = (s) => String(s || '').replace(/\\(\d{3})/g, (_, d) => String.fromCharCode(+d)).replace(/\\(.)/g, '$1');
/** Parse `avahi-browse -rpt` output → [{ service, name, host, address, port, txt }] (resolved IPv4 entries only). */
export function parseAvahi(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.startsWith('=;')) continue;
    const f = line.split(';');
    if (f.length < 9 || f[2] !== 'IPv4') continue;
    const txt = {};
    for (const m of (f.slice(9).join(';').match(/"([^"]*)"/g) || [])) { const s = m.slice(1, -1); const eq = s.indexOf('='); if (eq > 0) txt[s.slice(0, eq).toLowerCase()] = s.slice(eq + 1); }
    out.push({ iface: f[1], name: unescapeAvahi(f[3]), service: f[4], host: f[6], address: f[7], port: +f[8] || 0, txt });
  }
  return out;
}
function which(cmd) {
  return new Promise((resolve) => execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeout: 3000 }, (e, so) => resolve(e ? null : String(so).split('\n')[0].trim() || null)));
}
function run(cmd, args, ms) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let p;
    try { p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ out: '', err: e.message, code: -1 }); return; }
    const t = setTimeout(() => { try { p.kill(); } catch {} }, ms);
    p.stdout.on('data', (d) => { out += d; if (out.length > 2e6) try { p.kill(); } catch {} });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ out, err: e.message, code: -1 }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ out, err, code }); });
  });
}

// ---------------------------------------------------------------- the scan
/**
 * Look for Google TVs. Options (all optional, mostly for tests):
 *   timeout   ms to listen for mDNS (default 4000)      sweep  'auto' (only if nothing found) | true | false
 *   known     [{ host, name }] TVs added by hand — checked too
 *   interfaces  override listInterfaces()                mdnsPort / mdnsIp  override 5353 / 224.0.0.251 (tests)
 *   ports     { remote, pairing } override 6466 / 6467   avahi  false to skip avahi-browse
 * → { tvs: [{ host, name, model, port, via: [...], saved, verified }], diag }
 */
export async function scan(opts = {}) {
  const started = Date.now();
  const timeout = opts.timeout ?? 4000;
  const MPORT = opts.mdnsPort || MDNS_PORT, MIP = opts.mdnsIp || MDNS_IP;
  const RP = opts.ports?.remote || REMOTE_PORT, PP = opts.ports?.pairing || PAIRING_PORT;
  const all = opts.interfaces || listInterfaces();
  const ifaces = all.filter((i) => !i.linkLocal || all.every((x) => x.linkLocal));
  const diag = {
    platform: process.platform, startedAt: started, ms: 0,
    interfaces: all.map((i) => ({ name: i.name, address: i.address, cidr: i.cidr, virtual: i.virtual, linkLocal: i.linkLocal, private: i.private, searched: ifaces.includes(i), replies: 0, error: '' })),
    methods: { unicast: { replies: 0, errors: [] }, multicast: { bound: false, heard: 0, replies: 0, error: '' }, avahi: { available: null, found: 0, error: '' }, cast: { found: 0, verified: 0 }, sweep: { ran: false, hosts: 0, found: 0, cidrs: [] }, known: { checked: 0, online: 0 } },
    hints: [],
  };
  const dIf = (name) => diag.interfaces.find((x) => x.name === name);

  // what we've heard: instance → { service, label, target, port, txt, src:Set<ip>, via:Set }
  const inst = new Map(), aRec = new Map(), ptr = new Map();
  const lc = (s) => String(s || '').toLowerCase();
  const sockets = [];
  const followed = new Set();

  function absorb(pkt, rinfo, via, sock) {
    if (!pkt.response) return 0;
    let hits = 0;
    for (const r of pkt.records) {
      const n = lc(r.name);
      if (r.type === T.PTR && (n === ATV_SERVICE || n === CAST_SERVICE)) {
        const key = lc(r.data);
        const e = inst.get(key) || { service: n, label: r.dataLabels?.[0] || r.data.split('.')[0], src: new Set(), via: new Set() };
        e.src.add(rinfo.address); e.via.add(via); inst.set(key, e); ptr.set(key, n); hits++;
      } else if (r.type === T.SRV && (n.endsWith('.' + ATV_SERVICE) || n.endsWith('.' + CAST_SERVICE))) {
        const e = inst.get(n) || { service: n.endsWith(ATV_SERVICE) ? ATV_SERVICE : CAST_SERVICE, label: r.labels[0], src: new Set(), via: new Set() };
        e.target = lc(r.data.target); e.port = r.data.port; e.src.add(rinfo.address); e.via.add(via); inst.set(n, e); hits++;
      } else if (r.type === T.TXT && (n.endsWith('.' + ATV_SERVICE) || n.endsWith('.' + CAST_SERVICE))) {
        const e = inst.get(n) || { service: n.endsWith(ATV_SERVICE) ? ATV_SERVICE : CAST_SERVICE, label: r.labels[0], src: new Set(), via: new Set() };
        e.txt = r.data; e.src.add(rinfo.address); e.via.add(via); inst.set(n, e);
      } else if (r.type === T.A) aRec.set(lc(r.name), r.data);
    }
    // ask for what's missing (SRV/TXT of an instance, the address of its host) — straight to the device that answered
    if (hits && sock) {
      for (const [key, e] of inst) {
        if (e.target && aRec.has(e.target)) continue;
        const stage = `${key}|${e.target || ''}`;   // ask again once the host name is known (then for its address)
        if (followed.has(stage)) continue;
        followed.add(stage);
        const qs = e.target ? [{ name: e.target, type: T.A }] : [{ name: key, type: T.SRV }, { name: key, type: T.TXT }];
        const q = encodeQuery(qs, { id: (Math.random() * 65535) | 0 });
        try { sock.send(q, MPORT, rinfo.address); } catch {}
        try { sock.send(q, MPORT, MIP); } catch {}
      }
    }
    return hits;
  }

  const QUESTIONS = [{ name: ATV_SERVICE, type: T.PTR }, { name: CAST_SERVICE, type: T.PTR }];
  const timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));

  // 1 · legacy unicast on every interface
  for (const itf of ifaces) {
    const s = dgram.createSocket({ type: 'udp4' });
    sockets.push(s);
    s.on('error', (e) => { const d = dIf(itf.name); if (d && !d.error) d.error = e.code || e.message; diag.methods.unicast.errors.push(`${itf.name}: ${e.code || e.message}`); });
    s.on('message', (m, ri) => { const pkt = parsePacket(m); const h = absorb(pkt, ri, `unicast:${itf.name}`, s); if (h) { diag.methods.unicast.replies++; const d = dIf(itf.name); if (d) d.replies++; } });
    s.bind(0, itf.address, () => {
      try { s.setMulticastInterface(itf.address); s.setMulticastTTL(255); } catch {}
      const send = () => { try { s.send(encodeQuery(QUESTIONS, { id: (Math.random() * 65535) | 0 }), MPORT, MIP); } catch (e) { const d = dIf(itf.name); if (d) d.error = e.code || e.message; } };
      send(); later(900, send); later(Math.min(2200, timeout * 0.55), send);
    });
  }

  // 2 · classic mDNS on port 5353 (answers come by multicast)
  if (opts.multicast !== false) {
    const m = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sockets.push(m);
    m.on('error', (e) => { diag.methods.multicast.error = e.code || e.message; });
    m.on('message', (msg, ri) => {
      if (ifaces.some((i) => i.address === ri.address) && !parsePacket(msg).response) return;   // our own questions
      diag.methods.multicast.heard++;
      const h = absorb(parsePacket(msg), ri, 'multicast', m);
      if (h) diag.methods.multicast.replies++;
    });
    m.bind(MPORT, () => {
      diag.methods.multicast.bound = true;
      for (const itf of ifaces) { try { m.addMembership(MIP, itf.address); } catch (e) { const d = dIf(itf.name); if (d && !d.error) d.error = `join: ${e.code || e.message}`; } }
      try { m.setMulticastTTL(255); m.setMulticastLoopback(true); } catch {}
      const send = () => { for (const itf of ifaces) { try { m.setMulticastInterface(itf.address); m.send(encodeQuery(QUESTIONS), MPORT, MIP); } catch {} } };
      send(); later(1300, send);
    });
  }

  // 3 · avahi-browse (Linux, when avahi-utils is installed)
  const avahiP = (async () => {
    if (opts.avahi === false || process.platform !== 'linux') { diag.methods.avahi.available = process.platform === 'linux' ? null : false; return []; }
    const bin = await which('avahi-browse');
    diag.methods.avahi.available = !!bin;
    if (!bin) return [];
    const ms = Math.max(2500, timeout + 500);
    const [a, c] = await Promise.all([run(bin, ['-rpt', '_androidtvremote2._tcp'], ms), run(bin, ['-rpt', '_googlecast._tcp'], ms)]);
    if (/daemon not running|Failed to create client/i.test(a.err + c.err)) diag.methods.avahi.error = 'avahi-daemon isn’t running';
    const list = [...parseAvahi(a.out), ...parseAvahi(c.out)];
    diag.methods.avahi.found = list.length;
    return list;
  })();

  // known TVs (added by IP): are they on?
  const knownP = Promise.all((opts.known || []).filter((k) => isIPv4(k.host)).map(async (k) => {
    diag.methods.known.checked++;
    const on = await probePort(k.host, PP, 1200) || await probePort(k.host, RP, 800);
    if (on) diag.methods.known.online++;
    return { ...k, online: on };
  }));

  await new Promise((r) => setTimeout(r, timeout));
  const avahi = await avahiP;
  timers.forEach(clearTimeout);
  for (const s of sockets) { try { s.close(); } catch {} }

  // ---- assemble
  const tvs = new Map();   // host → tv
  const add = (host, patch, via) => {
    if (!host || !isIPv4(host)) return null;
    const t = tvs.get(host) || { host, name: '', model: '', port: RP, via: [], verified: false };
    for (const [k, v] of Object.entries(patch)) if (v && !t[k]) t[k] = v;
    if (patch.verified) t.verified = true;
    for (const v of [].concat(via)) if (v && !t.via.includes(v)) t.via.push(v);
    tvs.set(host, t);
    return t;
  };
  const hostOf = (e) => (e.target && aRec.get(e.target)) || [...e.src].find((ip) => isIPv4(ip)) || null;
  const castCands = [];
  for (const e of inst.values()) {
    const host = hostOf(e);
    const name = e.txt?.fn || e.label;
    if (e.service === ATV_SERVICE) add(host, { name, model: e.txt?.md || '', port: e.port || RP, verified: true }, [...e.via]);
    else castCands.push({ host, name, model: e.txt?.md || '', via: [...e.via] });
  }
  for (const a of avahi) {
    if (a.service === '_androidtvremote2._tcp') add(a.address, { name: a.name, port: a.port || RP, verified: true }, 'avahi');
    else castCands.push({ host: a.address, name: a.txt.fn || a.name, model: a.txt.md || '', via: ['avahi'] });
  }
  // 4 · Cast devices: a Google TV if its pairing port answers (a speaker or a plain Chromecast doesn't)
  diag.methods.cast.found = new Set(castCands.map((c) => c.host).filter(Boolean)).size;
  await Promise.all(castCands.map(async (c) => {
    if (!c.host) return;
    const t = tvs.get(c.host);
    if (t) { if (!t.model && c.model) t.model = c.model; if (c.name && (!t.name || t.name === t.host)) t.name = c.name; for (const v of c.via.map((x) => `cast/${x}`)) if (!t.via.includes(v)) t.via.push(v); return; }
    if (await probePort(c.host, PP, 1200)) { diag.methods.cast.verified++; add(c.host, { name: c.name, model: c.model, verified: true }, c.via.map((v) => `cast/${v}`)); }
  }));
  // 5 · nothing at all? sweep the LAN for the pairing port
  const sweep = opts.sweep === true || (opts.sweep !== false && opts.sweep !== 'never' && !tvs.size);
  if (sweep) {
    const nets = ifaces.filter((i) => !i.virtual && !i.linkLocal && (i.private || opts.sweepAny) && i.prefix >= 22);
    diag.methods.sweep.ran = true;
    diag.methods.sweep.cidrs = nets.map((i) => i.cidr);
    const hosts = [];
    for (const i of nets) {
      const base = ip2n(i.address) & ip2n(i.netmask), size = 2 ** (32 - i.prefix);
      for (let k = 1; k < size - 1; k++) { const ip = n2ip((base + k) >>> 0); if (ip !== i.address && !tvs.has(ip)) hosts.push(ip); }
    }
    diag.methods.sweep.hosts = hosts.length;
    const found = [];
    let idx = 0;
    const worker = async () => { while (idx < hosts.length) { const ip = hosts[idx++]; if (await probePort(ip, PP, opts.sweepMs || 650)) found.push(ip); } };
    await Promise.all(Array.from({ length: Math.min(96, hosts.length) }, worker));
    for (const ip of found) {
      // the pairing port alone could be something else: the remote port has to be there too
      if (!(await probePort(ip, RP, 900))) continue;
      diag.methods.sweep.found++;
      const nm = await nameOf(ip, { mdnsPort: MPORT }).catch(() => '');
      add(ip, { name: nm || `Google TV (${ip})`, verified: true }, 'port scan');
    }
  }
  const known = await knownP;
  for (const k of known) { const t = tvs.get(k.host); if (t) { t.saved = true; if (k.name && !t.name) t.name = k.name; } }
  const list = [...tvs.values()].map((t) => ({ ...t, name: t.name || `Google TV (${t.host})`, saved: !!t.saved }));
  for (const k of known) if (!tvs.has(k.host)) list.push({ host: k.host, name: k.name || `TV ${k.host}`, model: '', port: RP, via: ['remembered'], verified: k.online, saved: true, offline: !k.online });
  diag.ms = Date.now() - started;
  diag.hints = await hintsFor(diag, list, all);
  return { tvs: list, diag };
}

/** The TV's own name, asked by a unicast mDNS query to <ip>:5353 (RFC 6762 §5.5) — '' if it doesn't say. */
export function nameOf(ip, { mdnsPort = MDNS_PORT, ms = 1200 } = {}) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    const end = (v) => { clearTimeout(t); try { s.close(); } catch {} resolve(v); };
    const t = setTimeout(() => end(''), ms);
    s.on('error', () => end(''));
    s.on('message', (m) => {
      const p = parsePacket(m);
      const r = p.records.find((x) => x.type === T.PTR && lcEq(x.name, ATV_SERVICE)) || p.records.find((x) => x.type === T.PTR && lcEq(x.name, CAST_SERVICE));
      const txt = p.records.find((x) => x.type === T.TXT && x.data?.fn);
      if (r || txt) end(txt?.data?.fn || r.dataLabels?.[0] || '');
    });
    s.bind(0, () => { try { s.send(encodeQuery([{ name: ATV_SERVICE, type: T.PTR }, { name: CAST_SERVICE, type: T.PTR }], { id: 7 }), mdnsPort, ip); } catch { end(''); } });
  });
}
const lcEq = (a, b) => String(a).toLowerCase() === b;

/** Check one address before pairing: ports, subnet, name. */
export async function checkHost(host, { interfaces, ports } = {}) {
  const ifs = interfaces || listInterfaces();
  const RP = ports?.remote || REMOTE_PORT, PP = ports?.pairing || PAIRING_PORT;
  const [pairing, remote] = await Promise.all([probePort(host, PP, 2500), probePort(host, RP, 2500)]);
  const local = ifs.find((i) => sameSubnet(host, i)) || null;
  const name = pairing || remote ? await nameOf(host).catch(() => '') : '';
  let message = '';
  if (pairing && remote) message = `Found ${name || 'a Google TV'} at ${host}.`;
  else if (remote && !pairing) message = `${host} answers on the remote port but not the pairing port (${PP}). Turn the TV fully on and try again.`;
  else if (!local) message = `Nothing answers at ${host}, and it isn’t on the same network as the bridge (${ifs.filter((i) => !i.virtual).map((i) => i.cidr).join(', ') || 'no network'}). Check the address (TV Settings → Network → About) and that the TV and this computer use the same Wi-Fi / router.`;
  else message = `Nothing answers on ports ${RP}/${PP} at ${host}. Check the address and that the TV is on (not in deep standby). If it still doesn’t answer, restart the TV, and check that the system app “Android TV Remote Service” is enabled (TV Settings → Apps → See all apps → Show system apps).`;
  return { host, ok: pairing && remote, ports: { [RP]: remote, [PP]: pairing }, sameSubnet: !!local, iface: local ? { name: local.name, cidr: local.cidr } : null, name, message };
}

// ---------------------------------------------------------------- hints for the UI
async function hintsFor(diag, list, ifs) {
  const hints = [];
  const m = diag.methods;
  const real = ifs.filter((i) => !i.virtual && !i.linkLocal);
  if (!ifs.length) hints.push({ level: 'error', text: 'This computer has no IPv4 network connection the bridge can search.' });
  if (real.length > 1) hints.push({ level: 'info', text: `This computer is on several networks (${real.map((i) => `${i.name} ${i.cidr}`).join(', ')}). All of them were searched; the TV must be on one of them.` });
  if (ifs.some((i) => i.virtual)) hints.push({ level: 'info', text: `Virtual adapters (${ifs.filter((i) => i.virtual).map((i) => i.name).join(', ')}) were skipped for the network scan — they’re VPN / WSL / Hyper-V / Docker networks, not your home Wi-Fi.` });
  if (list.length) return hints;
  if (process.platform === 'win32') {
    const node = process.execPath;
    hints.push({ level: 'warn', text: 'Windows may be blocking the search. When Windows asks about Node.js, allow it on Private networks — or run these two lines once in PowerShell (as administrator):',
      code: `New-NetFirewallRule -DisplayName "Round Remote bridge (mDNS)" -Direction Inbound -Protocol UDP -LocalPort 5353 -Action Allow -Profile Private\nNew-NetFirewallRule -DisplayName "Round Remote bridge (Node.js)" -Direction Inbound -Program "${node}" -Action Allow -Profile Private` });
    const prof = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-NetConnectionProfile | Select-Object InterfaceAlias,NetworkCategory | ConvertTo-Json -Compress'], 5000).catch(() => null);
    try {
      const arr = [].concat(JSON.parse(prof?.out || 'null') || []);
      const pub = arr.filter((p) => p && (p.NetworkCategory === 0 || p.NetworkCategory === 'Public'));
      if (pub.length) hints.push({ level: 'warn', text: `“${pub.map((p) => p.InterfaceAlias).join('”, “')}” is set as a Public network, where Windows hides devices. Make it Private (Settings → Network → your Wi-Fi → Private), or in PowerShell (as administrator):`, code: pub.map((p) => `Set-NetConnectionProfile -InterfaceAlias "${p.InterfaceAlias}" -NetworkCategory Private`).join('\n') });
    } catch {}
  }
  if (process.platform === 'linux') {
    if (m.avahi.available === false) hints.push({ level: 'info', text: 'avahi-browse isn’t installed (an extra way to search). On a Raspberry Pi:', code: 'sudo apt install -y avahi-utils' });
    if (m.avahi.error) hints.push({ level: 'warn', text: 'avahi-daemon isn’t running:', code: 'sudo systemctl enable --now avahi-daemon' });
  }
  if (m.multicast.bound && !m.multicast.heard && !m.unicast.replies) hints.push({ level: 'warn', text: 'No mDNS traffic at all reached the bridge. A firewall may block UDP port 5353, or the router blocks multicast between Wi-Fi and wired devices (“AP / client isolation”, “IGMP snooping”, a guest network). Put the TV and this computer on the same network.' });
  if (m.multicast.error) hints.push({ level: 'info', text: `Port 5353 is busy (${m.multicast.error}) — the one-shot search still ran on every network.` });
  hints.push({ level: 'info', text: 'You can always add the TV by its IP address: on the TV open Settings → Network & Internet → your network (or System → About → Status) and type the IP address below.' });
  return hints;
}
