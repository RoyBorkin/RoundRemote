// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Battery boards for the Pi system API:
//  • PiSugar 2/3 — through pisugar-server's text protocol on TCP 127.0.0.1:8423 ("get battery" → "battery: 81.3",
//    "get battery_charging" → "battery_charging: true", "get battery_power_plugged" → "battery_power_plugged: true").
//  • Waveshare UPS HAT (B) / (C) — an INA219 power monitor on I2C (0x42 for (B): 2 × 18650 in series, 6.0–8.4 V;
//    0x43 for (C): one Li-Po cell, 3.0–4.2 V), read with i2ctransfer (i2c-tools). Bus voltage = reg 0x02 >> 3 × 4 mV;
//    current = reg 0x04 (signed) × current LSB after writing the calibration register 0x05 (Waveshare's values:
//    4096 / 0.1 mA for (B), 26868 / 0.1524 mA for (C)). Positive current = charging, negative = running on battery.
//  • none.
// Percent from voltage uses a resting Li-ion curve per cell (Waveshare's demo is linear: (V − 3)/1.2 per cell —
// "curve": "linear" in config.system.upsHat picks that). Minutes left come from the measured current (UPS HAT)
// or from how fast the percentage has been falling (PiSugar).
import net from 'node:net';
import { run, clamp } from './system-exec.js';
import { log } from './util.js';

const CURVE = [[3.0, 0], [3.3, 5], [3.5, 12], [3.6, 25], [3.7, 45], [3.75, 55], [3.8, 63], [3.85, 70], [3.9, 77], [4.0, 87], [4.1, 95], [4.2, 100]];
export function cellPercent(v, curve = 'liion') {
  if (curve === 'linear') return clamp(((v - 3) / 1.2) * 100, 0, 100);
  if (v <= CURVE[0][0]) return 0;
  for (let i = 1; i < CURVE.length; i++) {
    const [v1, p1] = CURVE[i - 1], [v2, p2] = CURVE[i];
    if (v <= v2) return p1 + ((v - v1) / (v2 - v1)) * (p2 - p1);
  }
  return 100;
}

/** Ask pisugar-server: resolves { battery, battery_charging, battery_power_plugged, model } or throws. */
export function pisugarQuery({ host = '127.0.0.1', port = 8423, timeout = 1500 } = {}, keys = ['battery', 'battery_charging', 'battery_power_plugged', 'model']) {
  return new Promise((resolve, reject) => {
    const out = {}; let buf = '';
    const sock = net.connect({ host, port });
    const done = (err) => { clearTimeout(t); sock.destroy(); err ? reject(err) : resolve(out); };
    const t = setTimeout(() => (Object.keys(out).length ? done() : done(new Error('pisugar-server timeout'))), timeout);
    sock.setEncoding('utf8');
    sock.on('connect', () => { for (const k of keys) sock.write(`get ${k}\n`); });
    sock.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        const m = line.trim().match(/^([a-z_]+):\s*(.*)$/i);
        if (m && keys.includes(m[1])) out[m[1]] = m[2].trim();
      }
      if (keys.every((k) => k in out)) done();
    });
    sock.on('error', done);
  });
}

const HATS = {
  0x42: { name: 'UPS HAT (B)', cells: 2, cal: 4096, lsb: 0.1, capacityMah: 2600 },
  0x43: { name: 'UPS HAT (C)', cells: 1, cal: 26868, lsb: 0.1524, capacityMah: 1000 },
};
const hex = (n) => '0x' + n.toString(16).padStart(2, '0');

export function createBattery({ cfg }) {
  const sys = cfg.system || {};
  const want = String(sys.battery || 'auto').toLowerCase();
  const pis = { host: '127.0.0.1', port: 8423, ...(sys.pisugar || {}) };
  const ups = { bus: 1, address: null, cells: null, capacityMah: null, curve: 'liion', ...(sys.upsHat || {}) };
  let found = null, foundAt = 0;     // { source, address? }
  const calibrated = new Set();
  const history = [];                // [{ t, p }] for the PiSugar time estimate

  async function i2cRead16(bus, addr, reg) {
    const r = await run('i2ctransfer', ['-y', String(bus), `w1@${hex(addr)}`, hex(reg), 'r2'], { timeout: 3000 });
    const m = r.stdout.trim().match(/^0x([0-9a-f]{2})\s+0x([0-9a-f]{2})$/i);
    if (r.code || !m) throw new Error(r.stderr.trim() || 'i2c read failed');
    return (parseInt(m[1], 16) << 8) | parseInt(m[2], 16);
  }
  async function i2cWrite16(bus, addr, reg, val) {
    const r = await run('i2ctransfer', ['-y', String(bus), `w3@${hex(addr)}`, hex(reg), hex((val >> 8) & 0xff), hex(val & 0xff)], { timeout: 3000 });
    if (r.code) throw new Error(r.stderr.trim() || 'i2c write failed');
  }
  async function readUps(addr) {
    const hat = HATS[addr] || HATS[0x42];
    const bus = ups.bus;
    if (!calibrated.has(addr)) { await i2cWrite16(bus, addr, 0x05, hat.cal); calibrated.add(addr); }
    const volts = ((await i2cRead16(bus, addr, 0x02)) >> 3) * 0.004;
    let raw = await i2cRead16(bus, addr, 0x04);
    if (raw & 0x8000) raw -= 0x10000;
    const mA = raw * hat.lsb;
    const cells = ups.cells || (volts > 5 ? 2 : 1);
    return { volts, mA, cells, hat };
  }
  async function probeUps() {
    const addrs = ups.address ? [Number(ups.address)] : [0x42, 0x43];
    for (const a of addrs) {
      try {
        const v = ((await i2cRead16(ups.bus, a, 0x02)) >> 3) * 0.004;
        if (v > 2.5 && v < 9.5) return a;
      } catch {}
    }
    return null;
  }

  async function detect() {
    if (found && Date.now() - foundAt < (found.source === 'none' ? 300000 : 3600000)) return found;
    let f = { source: 'none' };
    if (want === 'none') f = { source: 'none' };
    else {
      if (want === 'auto' || want === 'pisugar') {
        try { const r = await pisugarQuery({ ...pis, timeout: 1200 }, ['battery']); if (r.battery != null) f = { source: 'pisugar' }; } catch {}
      }
      if (f.source === 'none' && (want === 'auto' || want === 'ups-hat')) {
        const a = await probeUps();
        if (a != null) f = { source: 'ups-hat', address: a };
      }
    }
    if (f.source !== found?.source) log('system', `battery: ${f.source}${f.address ? ` at ${hex(f.address)}` : ''}`);
    found = f; foundAt = Date.now();
    return f;
  }

  function estimate(p, charging) {
    const now = Date.now();
    history.push({ t: now, p });
    while (history.length && now - history[0].t > 30 * 60000) history.shift();
    if (charging) { history.length = 0; history.push({ t: now, p }); return undefined; }
    const first = history[0];
    const mins = (now - first.t) / 60000;
    const drop = first.p - p;
    if (mins < 5 || drop < 1) return undefined;
    return Math.round(p / (drop / mins));
  }

  async function status() {
    const f = await detect();
    try {
      if (f.source === 'pisugar') {
        const r = await pisugarQuery(pis);
        const percent = clamp(Number(r.battery) || 0, 0, 100);
        const charging = /true/i.test(r.battery_charging || '');
        const plugged = /true/i.test(r.battery_power_plugged || '') || charging;
        const minutesLeft = plugged ? undefined : estimate(percent, false);
        if (plugged) estimate(percent, true);
        return { present: true, percent: Math.round(percent), charging, plugged, ...(minutesLeft ? { minutesLeft } : {}), source: 'pisugar', model: r.model || 'PiSugar' };
      }
      if (f.source === 'ups-hat') {
        const { volts, mA, cells, hat } = await readUps(f.address);
        const percent = cellPercent(volts / cells, ups.curve);
        const charging = mA > 20;
        const plugged = mA > -50;
        const capacity = Number(ups.capacityMah) || hat.capacityMah;
        const minutesLeft = !plugged && mA < -1 ? Math.min(24 * 60, Math.round(((capacity * percent) / 100 / -mA) * 60)) : undefined;
        return { present: true, percent: Math.round(percent), charging, plugged, ...(minutesLeft ? { minutesLeft } : {}), source: 'ups-hat', model: hat.name, volts: +volts.toFixed(3), currentMa: Math.round(mA) };
      }
    } catch (e) {
      found = null;   // it went away: detect again next time
      return { present: false, percent: null, charging: false, plugged: true, source: 'none', error: e.message };
    }
    return { present: false, percent: null, charging: false, plugged: true, source: 'none' };
  }

  return { status, detect, present: async () => (await detect()).source !== 'none' };
}
