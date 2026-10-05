// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Bluetooth through BlueZ's bluetoothctl — part of the Pi system API. The bridge user needs to be in the
// `bluetooth` group (pi/install.sh adds it); no sudo is used.
// Simple queries run `bluetoothctl <command>`; scanning and pairing need discovery to stay on while they run,
// so they drive one interactive bluetoothctl session (stdin/stdout) and answer its agent prompts:
// "Confirm passkey … (yes/no)" → yes, "Request confirmation" → yes, "Enter PIN code" → 0000 (old devices).
import { spawn } from 'node:child_process';
import { run, which, toolEnv, stripAnsi, validMac } from './system-exec.js';
import { log } from './util.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parse `bluetoothctl info <mac>` → { mac, name, paired, connected, trusted, icon, battery? } */
export function parseInfo(text, mac) {
  const t = stripAnsi(text);
  const get = (k) => { const m = t.match(new RegExp(`^\\s*${k}:\\s*(.*)$`, 'mi')); return m ? m[1].trim() : ''; };
  const yes = (k) => /^yes$/i.test(get(k));
  const dev = { mac: (t.match(/Device\s+([0-9A-F:]{17})/i)?.[1] || mac || '').toUpperCase(), name: get('Alias') || get('Name'), paired: yes('Paired'), connected: yes('Connected'), trusted: yes('Trusted'), icon: get('Icon') };
  const b = t.match(/Battery Percentage:\s*0x[0-9a-f]+\s*\((\d+)\)/i);
  if (b) dev.battery = +b[1];
  if (!dev.name || dev.name.replace(/[-:]/g, '').toUpperCase() === dev.mac.replace(/:/g, '')) dev.name = dev.name || '';
  return dev;
}
/** `bluetoothctl devices` lines: "Device AA:BB:CC:DD:EE:FF Name" → [{ mac, name }] */
export function parseDevices(text) {
  const out = [];
  for (const line of stripAnsi(text).split('\n')) {
    const m = line.match(/(?:^|\s)Device\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})\s*(.*)$/i);
    if (m && !/^\[(DEL|CHG)\]/.test(line.trim())) out.push({ mac: m[1].toUpperCase(), name: m[2].trim() });
  }
  return out;
}

/** One interactive bluetoothctl session. */
class Session {
  constructor() {
    this.buf = ''; this.lines = []; this.waiters = []; this.closed = false;
    this.p = spawn(which('bluetoothctl'), [], { env: toolEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const onData = (d) => {
      this.buf += stripAnsi(d.toString('utf8'));
      // prompts ("[agent] Confirm passkey 123456 (yes/no): ") don't end with a newline: look at the tail too
      const parts = this.buf.split('\n');
      this.buf = parts.pop();
      for (const l of parts) this.push(l);
      if (/\(yes\/no\):\s*$|Enter PIN code:\s*$|Enter passkey.*:\s*$/i.test(this.buf)) { this.push(this.buf); this.buf = ''; }
    };
    this.p.stdout.on('data', onData);
    this.p.stderr.on('data', onData);
    this.p.on('error', () => { this.closed = true; });
    this.p.on('exit', () => { this.closed = true; this.waiters.splice(0).forEach((w) => w.resolve(null)); });
    this.p.stdin.on('error', () => {});
  }
  push(line) {
    line = line.replace(/^\s*\[[^\]]*\][#>]\s*/, '').trim();   // drop the "[bluetooth]# " prompt
    if (!line) return;
    this.lines.push(line);
    if (/\(yes\/no\)/i.test(line) && /confirm|authorize|request/i.test(line)) this.send('yes');
    else if (/Enter PIN code/i.test(line)) this.send('0000');
    for (const w of [...this.waiters]) if (w.re.test(line)) { this.waiters.splice(this.waiters.indexOf(w), 1); clearTimeout(w.t); w.resolve(line); }
  }
  send(cmd) { if (!this.closed) this.p.stdin.write(cmd + '\n'); }
  /** Wait for a line matching re (also one already seen since `from`). Resolves the line or null on timeout. */
  wait(re, ms, from = 0) {
    const seen = this.lines.slice(from).find((l) => re.test(l));
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve) => {
      const w = { re, resolve };
      w.t = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); resolve(null); }, ms);
      this.waiters.push(w);
    });
  }
  async close() {
    if (this.closed) return;
    this.send('scan off');
    this.send('quit');
    await Promise.race([new Promise((r) => this.p.once('exit', r)), sleep(1500)]);
    if (!this.closed) try { this.p.kill('SIGKILL'); } catch {}
  }
}

export function createBluetooth() {
  let lock = Promise.resolve();
  const exclusive = (fn) => { const next = lock.then(fn, fn); lock = next.catch(() => {}); return next; };
  const bt = (args, timeout = 10000) => run('bluetoothctl', args, { timeout });

  async function powered() {
    const r = await bt(['show']);
    if (r.code || /No default controller/i.test(r.stdout + r.stderr)) return null;
    return /Powered:\s*yes/i.test(stripAnsi(r.stdout));
  }
  async function info(mac) {
    const r = await bt(['info', mac]);
    if (r.code || /not available/i.test(r.stdout)) return null;
    return parseInfo(r.stdout, mac);
  }
  async function devices({ max = 40 } = {}) {
    const r = await bt(['devices']);
    const list = parseDevices(r.stdout).slice(0, max);
    const out = [];
    for (const d of list) {
      const i = await info(d.mac);
      out.push(i ? { ...i, name: i.name || d.name } : { mac: d.mac, name: d.name, paired: false, connected: false, trusted: false, icon: '' });
    }
    return out;
  }
  async function status() {
    const p = await powered();
    if (p === null) return { powered: false, available: false, devices: [] };
    return { powered: p, available: true, devices: p ? await devices() : [] };
  }
  async function power({ on } = {}) {
    const r = await bt(['power', on ? 'on' : 'off']);
    const ok = !r.code && /succeeded|changing power on|changing power off/i.test(stripAnsi(r.stdout + r.stderr));
    if (!ok && on) return { ok: false, error: /blocked|rfkill/i.test(r.stdout + r.stderr) ? 'Bluetooth is blocked (rfkill)' : lastLine(r.stderr || r.stdout) || 'Couldn’t turn Bluetooth on' };
    return { ok: true, powered: !!on };
  }

  /** Discover for `seconds`, then list everything BlueZ knows (named devices first). */
  function scan({ seconds = 10 } = {}) {
    seconds = Math.max(3, Math.min(30, Math.round(+seconds || 10)));
    if (!which('bluetoothctl')) return Promise.resolve({ ok: false, error: 'bluetoothctl is not installed' });
    return exclusive(async () => {
      if ((await powered()) !== true) return { ok: false, error: 'Bluetooth is off' };
      const s = new Session();
      try {
        s.send('scan on');
        await sleep(seconds * 1000);
        s.send('scan off');
        await s.wait(/Discovery stopped|Discovering:\s*no/i, 2000);
      } finally { await s.close(); }
      const list = await devices({ max: 60 });
      list.sort((a, b) => (b.connected - a.connected) || (b.paired - a.paired) || (!!b.name - !!a.name) || String(a.name).localeCompare(String(b.name)));
      return { ok: true, devices: list };
    });
  }

  /** Pair (discovering first if BlueZ doesn't know the device), trust, and connect. */
  function pair({ mac } = {}) {
    if (!validMac(mac)) return Promise.resolve({ ok: false, status: 400, error: 'Invalid Bluetooth address' });
    mac = mac.toUpperCase();
    if (!which('bluetoothctl')) return Promise.resolve({ ok: false, error: 'bluetoothctl is not installed' });
    return exclusive(async () => {
      const s = new Session();
      try {
        await s.wait(/Agent registered|\[bluetooth\]|Controller/i, 3000);
        s.send('agent on'); s.send('default-agent');
        const known = await info(mac);
        if (known?.paired) { await s.close(); await bt(['trust', mac]); return { ok: true, already: true, device: await info(mac) }; }
        s.send('scan on');
        if (!known) {
          const seen = await s.wait(new RegExp(`(NEW|CHG)\\]?\\s*Device ${mac}`, 'i'), 20000);
          if (!seen && !(await info(mac))) return { ok: false, error: 'Device not found — put it in pairing mode and scan again' };
        }
        const from = s.lines.length;
        s.send(`pair ${mac}`);
        const res = await s.wait(/Pairing successful|Failed to pair|AlreadyExists|org\.bluez\.Error|not available/i, 30000, from);
        if (!res) return { ok: false, error: 'Pairing timed out' };
        if (!/successful|AlreadyExists/i.test(res)) return { ok: false, error: btError(res) };
        s.send(`trust ${mac}`);
        await s.wait(/trust succeeded|Trusted:\s*yes/i, 4000, from);
        s.send('scan off');
        log('system', `bluetooth: paired ${mac}`);
        return { ok: true, device: await info(mac) };
      } finally { await s.close(); }
    });
  }

  function simple(cmd, okRe) {
    return ({ mac } = {}) => {
      if (!validMac(mac)) return Promise.resolve({ ok: false, status: 400, error: 'Invalid Bluetooth address' });
      mac = mac.toUpperCase();
      return exclusive(async () => {
        const r = await bt([cmd, mac], 30000);
        const out = stripAnsi(r.stdout + '\n' + r.stderr);
        if (okRe.test(out) && !/Failed to|not available|Error/i.test(out.replace(okRe, ''))) {
          log('system', `bluetooth: ${cmd} ${mac}`);
          return { ok: true, device: cmd === 'remove' ? null : await info(mac) };
        }
        return { ok: false, error: btError(out) };
      });
    };
  }

  return {
    status, power, scan, pair, devices,
    connect: simple('connect', /Connection successful/i),
    disconnect: simple('disconnect', /Successful disconnected|Disconnection successful/i),
    remove: simple('remove', /Device has been removed/i),
  };
}

function btError(s) {
  const t = String(s || '');
  if (/AuthenticationFailed|Authentication Failed/i.test(t)) return 'Pairing was refused — check the code on the device';
  if (/AuthenticationCanceled|Canceled/i.test(t)) return 'Pairing was cancelled';
  if (/ConnectionAttemptFailed|Page Timeout|br-connection-page-timeout/i.test(t)) return 'The device didn’t answer — is it on and nearby?';
  if (/not available/i.test(t)) return 'Device not found — scan again';
  if (/InProgress/i.test(t)) return 'Busy — try again in a moment';
  if (/profile-unavailable|NotAvailable/i.test(t)) return 'This device has nothing the Pi can connect to';
  return lastLine(t.replace(/^.*Failed to \w+:\s*/im, '')) || 'Failed';
}
function lastLine(s) { return String(s || '').trim().split('\n').filter(Boolean).pop() || ''; }
