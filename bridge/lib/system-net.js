// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Wi-Fi through NetworkManager (nmcli) and the setup hotspot "RoundRemote-Setup" — part of the Pi system API.
// nmcli runs as the bridge user (pi/install.sh adds a polkit rule for NetworkManager); if it answers "Not
// authorized" it is retried once with `sudo -n` (the sudoers file allows nmcli). The hotspot itself (and the
// captive-portal redirect for phones) is switched by the root helper /usr/local/sbin/roundremote-helper, which
// pi/netcheck.sh also uses at boot when no network comes up.
import fs from 'node:fs';
import path from 'node:path';
import { run, parseTerse, parseTerseKV, validSsid, validPsk, parseEnvFile, memo } from './system-exec.js';
import { log } from './util.js';

const WIFI_TYPES = new Set(['802-11-wireless', 'wifi']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createWifi({ cfg, helper, useSudo }) {
  const sys = cfg.system || {};
  const hs = { ssid: 'RoundRemote-Setup', name: 'RoundRemote-Setup', envFile: '/etc/roundremote/hotspot.env', address: '10.42.0.1', ...(sys.hotspot || {}) };
  const cache = memo();
  let lastAttempt = null;   // { ssid, ok, error, code, at } — phones on the hotspot read it after reconnecting
  let busy = null;

  async function nmcli(args, opts = {}) {
    let r = await run('nmcli', args, { timeout: 15000, ...opts });
    if (r.code && useSudo && /not authori[sz]ed|insufficient privileges|permission denied/i.test(r.stderr)) {
      r = await run('nmcli', args, { timeout: 15000, ...opts, sudo: true });
    }
    return r;
  }

  /** The Wi-Fi interface: { dev, state, connection } or null. */
  async function device() {
    return cache('dev', 5000, async () => {
      const r = await nmcli(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device']);
      if (r.code) return null;
      const d = parseTerse(r.stdout, ['dev', 'type', 'state', 'connection']).find((x) => x.type === 'wifi');
      return d ? { dev: d.dev, state: d.state, connection: d.connection } : null;
    });
  }

  /** Saved Wi-Fi profiles: [{ id (uuid), name, ssid, mode }] — the hotspot profile is mode 'ap'. */
  async function savedProfiles() {
    const r = await nmcli(['-t', '-f', 'NAME,UUID,TYPE', 'connection', 'show']);
    if (r.code) return [];
    const list = parseTerse(r.stdout, ['name', 'uuid', 'type']).filter((c) => WIFI_TYPES.has(c.type));
    const out = [];
    for (const c of list.slice(0, 40)) {
      const d = await nmcli(['-t', '-f', '802-11-wireless.ssid,802-11-wireless.mode', 'connection', 'show', 'uuid', c.uuid]);
      const kv = parseTerseKV(d.stdout);
      out.push({ id: c.uuid, name: c.name, ssid: kv['802-11-wireless.ssid'] || c.name, mode: kv['802-11-wireless.mode'] || 'infrastructure' });
    }
    return out;
  }

  async function hotspotActive() {
    const r = await nmcli(['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active']);
    return parseTerse(r.stdout, ['name', 'type', 'device']).some((c) => c.name === hs.name);
  }
  function hotspotSecrets() {
    const env = parseEnvFile((() => { try { return fs.readFileSync(hs.envFile, 'utf8'); } catch { return ''; } })());
    return { ssid: env.SSID || hs.ssid, password: env.PASSWORD || hs.password || '', name: env.CON || hs.name };
  }
  /** { on, ssid, password?, url, address } — the password only for the display itself (loopback) or allowRemote. */
  async function hotspotStatus({ withPassword = false, port = 8765 } = {}) {
    const on = await hotspotActive();
    const s = hotspotSecrets();
    return { on, ssid: s.ssid, ...(withPassword ? { password: s.password } : {}), address: hs.address, url: `http://${hs.address}:${port}/system/wifi` };
  }
  async function setHotspot(on, { manual = true } = {}) {
    cache.clear();
    const args = [on ? 'hotspot-on' : 'hotspot-off', ...(on && manual ? ['manual'] : [])];
    if (helper()) {
      const r = await run(helper(), args, { sudo: useSudo, timeout: 45000 });
      if (r.code) return { ok: false, error: lastLine(r.stderr || r.stdout) || 'The hotspot could not be switched' };
      log('system', `hotspot ${on ? 'on' : 'off'}`);
      return { ok: true };
    }
    // no helper installed (a dev machine): switch it with nmcli directly
    const s = hotspotSecrets();
    const dev = await device();
    if (!dev) return { ok: false, error: 'No Wi-Fi adapter' };
    const r = on
      ? await nmcli(['device', 'wifi', 'hotspot', 'ifname', dev.dev, 'con-name', s.name, 'ssid', s.ssid, ...(s.password ? ['password', s.password] : [])], { timeout: 30000 })
      : await nmcli(['connection', 'down', 'id', s.name], { timeout: 20000 });
    if (r.code && !(!on && /not an active|unknown connection/i.test(r.stderr))) return { ok: false, error: lastLine(r.stderr) || 'The hotspot could not be switched' };
    return { ok: true };
  }

  async function radioOn() {
    const r = await nmcli(['radio', 'wifi']);
    return r.code ? null : /enabled/i.test(r.stdout);
  }

  async function ipOf(dev) {
    const r = await nmcli(['-t', '-f', 'IP4.ADDRESS', 'device', 'show', dev]);
    const m = r.stdout.match(/IP4\.ADDRESS\[\d+\]:([0-9.]+)/);
    return m ? m[1] : '';
  }

  const SCAN_FIELDS = ['inUse', 'ssid', 'signal', 'security', 'bssid'];
  function parseScan(text, saved) {
    const best = new Map();
    for (const n of parseTerse(text, SCAN_FIELDS)) {
      if (!n.ssid) continue;   // hidden networks
      const net = { ssid: n.ssid, signal: Math.max(0, Math.min(100, parseInt(n.signal, 10) || 0)), security: normSec(n.security), inUse: n.inUse.trim() === '*', saved: saved.has(n.ssid) };
      const o = best.get(net.ssid);
      if (!o || net.inUse || (!o.inUse && net.signal > o.signal)) best.set(net.ssid, { ...net, inUse: net.inUse || !!o?.inUse });
    }
    return [...best.values()].sort((a, b) => (b.inUse - a.inUse) || (b.saved - a.saved) || (b.signal - a.signal));
  }
  const normSec = (s) => String(s || '').trim().replace(/^--$/, '');

  async function status({ withPassword = false, port } = {}) {
    const [enabled, dev] = await Promise.all([radioOn(), device()]);
    const out = { enabled: enabled !== false, device: dev?.dev || null, current: null, saved: [], hotspot: null, lastAttempt };
    if (!dev) return out;
    const [saved, list, hot] = await Promise.all([
      savedProfiles(),
      nmcli(['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY,BSSID', 'device', 'wifi', 'list', '--rescan', 'no']),
      hotspotStatus({ withPassword, port }),
    ]);
    out.hotspot = hot;
    out.saved = saved.filter((s) => s.mode !== 'ap').map((s) => ({ ssid: s.ssid, id: s.id }));
    if (!hot.on && dev.state === 'connected') {
      const cur = parseScan(list.stdout, new Set()).find((n) => n.inUse);
      const ssid = cur?.ssid || saved.find((s) => s.name === dev.connection)?.ssid || dev.connection;
      out.current = { ssid, signal: cur?.signal ?? null, security: cur?.security ?? '', ip: await ipOf(dev.dev) };
    }
    return out;
  }

  async function scan() {
    const dev = await device();
    if (!dev) return { networks: [], error: 'No Wi-Fi adapter' };
    const saved = new Set((await savedProfiles()).filter((s) => s.mode !== 'ap').map((s) => s.ssid));
    const fields = ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY,BSSID', 'device', 'wifi', 'list'];
    const hot = await hotspotActive();
    let r = await nmcli([...fields, '--rescan', hot ? 'no' : 'yes'], { timeout: 30000 });
    if (r.code && !hot) r = await nmcli([...fields, '--rescan', 'no']);
    let networks = parseScan(r.stdout, saved).filter((n) => !(hot && n.ssid === hotspotSecrets().ssid));
    if (hot && !networks.length) {
      // the radio can't scan while it is the access point: use the list the helper saved before starting it
      try { networks = parseScan(fs.readFileSync(sys.scanCache || path.join(process.env.RR_RUN_DIR || '/run/roundremote', 'wifi-scan.txt'), 'utf8'), saved).filter((n) => n.ssid !== hotspotSecrets().ssid); } catch {}
    }
    return { networks, cached: hot };
  }

  function mapError(r) {
    const msg = lastLine(r.stderr || r.stdout);
    if (/secrets were required|no secrets|802-1x|psk|wrong password|invalid passphrase|key-mgmt|\(7\)/i.test(msg)) return { code: 'wrong-password', error: 'Wrong password' };
    if (/no network with ssid|not found|could not be found/i.test(msg)) return { code: 'not-found', error: 'Network not found — is it in range?' };
    if (r.code === 3 || r.timedOut || /timeout|timed out/i.test(msg)) return { code: 'timeout', error: 'The network didn’t answer in time' };
    if (/not authori[sz]ed|insufficient privileges/i.test(msg)) return { code: 'denied', error: 'Not allowed to change Wi-Fi (run pi/install.sh again)' };
    return { code: 'failed', error: msg.replace(/^Error:\s*/i, '') || 'Couldn’t connect' };
  }

  async function connect({ ssid, password, hidden } = {}) {
    if (!validSsid(ssid)) return { ok: false, status: 400, error: 'Invalid network name' };
    if (password != null && typeof password !== 'string') return { ok: false, status: 400, error: 'Invalid password' };
    if (!validPsk(password || '')) return { ok: false, status: 400, code: 'bad-password', error: 'Wi-Fi passwords have 8–63 characters' };
    if (busy) return { ok: false, status: 409, error: 'Already connecting' };
    busy = ssid;
    try {
      const dev = await device();
      if (!dev) return { ok: false, error: 'No Wi-Fi adapter' };
      const wasHotspot = await hotspotActive();
      if (wasHotspot) {
        // the radio couldn't scan while it was the access point: look around again before joining
        await setHotspot(false); await sleep(1000);
        await nmcli(['device', 'wifi', 'rescan', 'ifname', dev.dev]); await sleep(4000);
      }
      if ((await radioOn()) === false) await nmcli(['radio', 'wifi', 'on']);
      const before = (await savedProfiles()).filter((s) => s.mode !== 'ap');
      const mine = before.filter((s) => s.ssid === ssid);
      let r;
      if (mine.length && !password) {
        r = await nmcli(['--wait', '40', 'connection', 'up', 'uuid', mine[0].id, 'ifname', dev.dev], { timeout: 50000 });
      } else {
        // a new password replaces the saved profile(s) for that network
        for (const s of mine) await nmcli(['connection', 'delete', 'uuid', s.id]);
        const args = ['--wait', '40', 'device', 'wifi', 'connect', ssid];
        if (password) args.push('password', password);
        args.push('ifname', dev.dev);
        if (hidden) args.push('hidden', 'yes');
        r = await nmcli(args, { timeout: 50000 });
      }
      cache.clear();
      if (!r.code) {
        lastAttempt = { ssid, ok: true, at: Date.now() };
        log('system', `wifi: connected to "${ssid}"`);
        return { ok: true, ssid, ip: await ipOf(dev.dev) };
      }
      const err = mapError(r);
      // nmcli may leave the new (wrong) profile behind: remove anything for this SSID that wasn't saved before
      const keep = new Set(before.map((s) => s.id));
      for (const s of (await savedProfiles()).filter((x) => x.ssid === ssid && !keep.has(x.id) && x.mode !== 'ap')) await nmcli(['connection', 'delete', 'uuid', s.id]);
      lastAttempt = { ssid, ok: false, ...err, at: Date.now() };
      log('system', `wifi: "${ssid}" failed: ${err.code} (${lastLine(r.stderr)})`);
      if (wasHotspot) setHotspot(true, { manual: false }).catch(() => {});   // back on, so the phone can try again
      return { ok: false, ...err };
    } finally { busy = null; }
  }

  async function forget({ ssid } = {}) {
    if (!validSsid(ssid)) return { ok: false, status: 400, error: 'Invalid network name' };
    const list = (await savedProfiles()).filter((s) => s.ssid === ssid && s.mode !== 'ap');
    for (const s of list) {
      const r = await nmcli(['connection', 'delete', 'uuid', s.id]);
      if (r.code) return { ok: false, error: lastLine(r.stderr) || 'Couldn’t forget it' };
    }
    cache.clear();
    return { ok: true, removed: list.length };
  }

  async function radio({ on } = {}) {
    if (on && helper()) await run(helper(), ['rfkill-unblock', 'wifi'], { sudo: useSudo });
    const r = await nmcli(['radio', 'wifi', on ? 'on' : 'off']);
    cache.clear();
    return r.code ? { ok: false, error: lastLine(r.stderr) || 'Failed' } : { ok: true, enabled: !!on };
  }

  /** Wi-Fi power saving on the active Wi-Fi profile (saved in the profile) and right now (helper → iw). */
  async function powerSave(on) {
    const dev = await device();
    if (!dev) return { ok: false, error: 'No Wi-Fi adapter' };
    if (dev.connection && !(await hotspotActive())) {
      await nmcli(['connection', 'modify', 'id', dev.connection, '802-11-wireless.powersave', on ? '3' : '2']);
    }
    if (helper()) await run(helper(), ['wifi-powersave', on ? 'on' : 'off', dev.dev], { sudo: useSudo });
    return { ok: true };
  }
  async function powerSaveState() {
    const dev = await device();
    if (!dev?.connection) return null;
    const r = await nmcli(['-t', '-f', '802-11-wireless.powersave', 'connection', 'show', 'id', dev.connection]);
    const v = parseTerseKV(r.stdout)['802-11-wireless.powersave'] || '';
    return /3|enable/.test(v) ? true : /2|disable/.test(v) ? false : null;
  }

  return { device, status, scan, connect, forget, radio, hotspotStatus, hotspotActive, setHotspot, powerSave, powerSaveState, get lastAttempt() { return lastAttempt; }, mapError, parseScan };
}

function lastLine(s) { return String(s || '').trim().split('\n').filter(Boolean).pop() || ''; }
