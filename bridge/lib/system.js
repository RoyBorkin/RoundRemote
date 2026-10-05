// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The Raspberry Pi appliance's system API (Settings → Device on the round display; js/core/device.js).
// Everything answers JSON under /api/system/ with the bridge's usual CORS + allowedOrigins check. Changes (POST)
// are accepted only from the Pi itself (loopback) unless config.system.allowRemote is true — with one exception:
// while the setup hotspot is on, phones that joined it (10.42.0.x) may scan and connect Wi-Fi from /system/wifi.
// On a machine that isn't a Raspberry Pi, info answers { pi:false, caps:{all false} } and the rest is 404.
//
//   GET  /api/system/info            { pi, model, os, hostname, ip[], uptime, temp, throttled, cpuGovernor, caps{…}, writable }
//                                    (writable: this caller may change things — the Pi itself, or system.allowRemote)
//   GET  /api/system/wifi            { enabled, current{ssid,signal,security,ip}, saved[{ssid,id}], hotspot{on,ssid,password?,url}, lastAttempt }
//   GET  /api/system/wifi/scan       { networks[{ssid,signal,security,inUse,saved}] }
//   POST /api/system/wifi/connect    { ssid, password?, hidden? } → { ok, error?, code? }  (phones on the hotspot: { ok, pending })
//   POST /api/system/wifi/forget     { ssid }        POST /api/system/wifi/radio { on }
//   GET|POST /api/system/hotspot     { on } → { ok, on, ssid, password?, url }
//   GET  /api/system/bluetooth       { powered, devices[{mac,name,paired,connected,trusted,icon,battery?}] }
//   POST /api/system/bluetooth/scan  { seconds? } → { devices }   POST …/bluetooth/{pair|connect|disconnect|remove} { mac }
//   POST /api/system/bluetooth/power { on }
//   GET  /api/system/audio           { sinks[{id,name,default,volume,muted}], sources[…] }
//   POST /api/system/audio/default   { id }          POST /api/system/audio/volume { id, volume 0–1.5, muted? }
//   GET  /api/system/battery         { present, percent, charging, plugged, minutesLeft?, source }
//   GET|POST /api/system/power       { saver, governor, governors[], screenOffMinutes, wifiPowerSave, bluetooth }
//   GET|POST /api/system/screen      { on, brightness? (0–1, DSI panels only) } → { ok, on }
//   POST /api/system/reboot · /api/system/shutdown
//   GET  /api/system/update          { current, latest?, behind?, version, commit, dirty } · POST → pull + npm install + restart
//   GET  /api/system/imu             SSE: data: {"roll","pitch","heading"?,"angle"?,"ts"} at ~20 Hz (404 without a sensor;
//                                    "event: sensor" carries {ready,chip} / {error})
//   GET  /system/wifi                the phone page for Wi-Fi setup (captive portal of the hotspot)
//
// IMU angles (pi/imu.py), degrees −180…180, clockwise as seen from the front = positive:
//   roll  = in-plane turn of a sensor mounted flat behind the screen (gravity in the sensor's x–y plane: atan2(−ax, ay))
//   pitch = the same for a sensor standing at a right angle to the screen (y–z plane: atan2(−az, ay))
//   angle = only when config.system.imu.plane is set ("xy" | "yz" | "xz"): the turn of the screen, after offset/invert.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { log } from './util.js';
import { run, which, readFile, exists, memo, toolEnv, clamp, validSsid, validPsk } from './system-exec.js';
import { createWifi } from './system-net.js';
import { createBluetooth } from './system-bt.js';
import { createAudio } from './system-audio.js';
import { createBattery } from './system-battery.js';
import { WIFI_PAGE, captiveRedirect } from './system-page.js';

const GOVERNORS = ['ondemand', 'powersave', 'performance', 'schedutil', 'conservative'];
const NO_CAPS = Object.freeze({ wifi: false, bluetooth: false, audio: false, battery: false, imu: false, power: false, update: false, display: false });
let S = null;

function init(cfg, dir) {
  if (S && S.cfg === cfg) return S;
  const sys = cfg.system || {};
  const appRoot = path.resolve(dir, '..');
  const root = process.env.RR_SYS_ROOT || sys.root || '';
  const useSudo = sys.sudo !== false;
  const helperPath = sys.helper || '/usr/local/sbin/roundremote-helper';
  const helper = () => (which(helperPath) ? helperPath : '');
  S = {
    cfg, sys, dir, appRoot, root, useSudo, helper,
    cache: memo(),
    stateFile: path.resolve(dir, sys.stateFile || 'system-state.json'),
    state: { saver: false, screenOffMinutes: 0 },
    screen: { on: true, output: '', at: 0, by: '', waiter: null },
    imu: { proc: null, clients: new Set(), stopT: 0, restarts: 0, last: null },
    captive: null,
    hits: new Map(),
  };
  try { Object.assign(S.state, JSON.parse(fs.readFileSync(S.stateFile, 'utf8'))); } catch {}
  process.once('exit', () => { for (const p of [S.imu.proc, S.screen.waiter]) if (p) try { p.kill(); } catch {} });
  S.wifi = createWifi({ cfg, helper, useSudo });
  S.bt = createBluetooth();
  S.audio = createAudio();
  S.battery = createBattery({ cfg });
  if (isPi()) {
    log('system', `Raspberry Pi system API on (${model() || 'forced'}; writes ${sys.allowRemote ? 'from anywhere' : 'from this Pi only'})`);
    syncCaptive().catch(() => {});
  }
  return S;
}
function saveState() { try { fs.writeFileSync(S.stateFile, JSON.stringify(S.state, null, 2)); } catch (e) { log('system', `state: ${e.message}`); } }

const model = () => readFile(S.root, '/proc/device-tree/model').replace(/\0/g, '').trim();
const isPi = () => S.sys.enabled !== false && (S.sys.force === true || /Raspberry Pi/i.test(model()));

// ---------------------------------------------------------------- who may change things
const bare = (a) => String(a || '').replace(/^::ffff:/, '');
const isLoopback = (req) => { const a = bare(req.socket.remoteAddress); return a === '::1' || a.startsWith('127.'); };
async function isHotspotClient(req) {
  const a = bare(req.socket.remoteAddress);
  const prefix = (S.sys.hotspot?.address || '10.42.0.1').split('.').slice(0, 3).join('.') + '.';
  if (!a.startsWith(prefix)) return false;
  return S.cache('hotspot-on', 5000, () => S.wifi.hotspotActive());
}
function limited(req, n = 20) {
  const ip = req.socket.remoteAddress || '';
  const now = Date.now();
  const h = (S.hits.get(ip) || []).filter((t) => now - t < 60000);
  h.push(now); S.hits.set(ip, h);
  return h.length > n;
}

// ---------------------------------------------------------------- info + caps
function lanIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (!a.internal && (a.family === 'IPv4' || a.family === 4)) out.push({ name, address: a.address });
  }
  return out.filter((a) => !/^(docker|veth|br-|virbr)/.test(a.name)).map((a) => a.address);
}
function osName() {
  const t = readFile(S.root, '/etc/os-release');
  const m = t.match(/^PRETTY_NAME="?([^"\n]*)"?/m);
  return m ? m[1] : `${os.type()} ${os.release()}`;
}
const governor = () => readFile(S.root, '/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor').trim() || null;
const governors = () => readFile(S.root, '/sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors').trim().split(/\s+/).filter((g) => GOVERNORS.includes(g));
function temp() {
  const t = readFile(S.root, '/sys/class/thermal/thermal_zone0/temp').trim();
  return t ? Math.round(+t / 100) / 10 : null;
}
async function throttled() {
  const r = await run('vcgencmd', ['get_throttled'], { timeout: 3000 });
  const m = r.stdout.match(/throttled=(0x[0-9a-f]+)/i);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  const b = (n) => !!(v & (1 << n));
  return { raw: m[1], underVoltage: b(0), freqCapped: b(1), throttled: b(2), softTempLimit: b(3),
    occurred: { underVoltage: b(16), freqCapped: b(17), throttled: b(18), softTempLimit: b(19) } };
}
function backlightDir() {
  const base = '/sys/class/backlight';
  try { const d = fs.readdirSync(path.join(S.root || '/', base)); return d.length ? path.join(base, d[0]) : ''; } catch { return ''; }
}
function waylandEnv() {
  const env = toolEnv();
  const rt = env.XDG_RUNTIME_DIR;
  let disp = S.sys.waylandDisplay || process.env.WAYLAND_DISPLAY || '';
  if (!disp) {
    try { disp = fs.readdirSync(rt).filter((f) => /^wayland-\d+$/.test(f)).sort()[0] || ''; } catch {}
  }
  return disp ? { XDG_RUNTIME_DIR: rt, WAYLAND_DISPLAY: disp } : null;
}

async function imuDetect() {
  if (S.sys.imu?.enabled === false) return null;
  const script = imuScript();
  if (!fs.existsSync(script) || !which('python3')) return null;
  const r = await run('python3', [script, '--detect', ...imuArgs()], { timeout: 8000 });
  try { const j = JSON.parse(r.stdout.trim().split('\n').pop()); return j.chip ? j : null; } catch { return null; }
}
const imuScript = () => S.sys.imu?.script || path.join(S.appRoot, 'pi', 'imu.py');
function imuArgs() {
  const c = S.sys.imu || {};
  const a = ['--bus', String(c.bus ?? 1)];
  if (c.address) a.push('--address', String(c.address));
  if (c.chip && c.chip !== 'auto') a.push('--chip', String(c.chip));
  return a;
}

async function caps() {
  return S.cache('caps', 30000, async () => {
    const [wifiDev, btOn, audio, battery, imu] = await Promise.all([
      which('nmcli') ? S.wifi.device().catch(() => null) : null,
      which('bluetoothctl') ? run('bluetoothctl', ['show'], { timeout: 5000 }) : null,
      which('wpctl') ? run('wpctl', ['status'], { timeout: 5000 }) : null,
      S.battery.present().catch(() => false),
      S.cache('imu-detect', 300000, imuDetect).catch(() => null),
    ]);
    return {
      wifi: !!wifiDev,
      bluetooth: !!(btOn && !btOn.code && /Controller/i.test(btOn.stdout) && !/No default controller/i.test(btOn.stdout)),
      audio: !!(audio && !audio.code),
      battery: !!battery,
      imu: !!imu,
      power: !!governor(),
      update: exists('', path.join(S.appRoot, '.git')) && !!which('git'),
      display: !!((which('wlr-randr') || which('wlopm')) && waylandEnv()) || !!backlightDir(),
      backlight: !!backlightDir(),
      hotspot: !!wifiDev,
      imuChip: imu?.chip || null,
    };
  });
}

async function info(req) {
  if (!isPi()) return { pi: false, caps: { ...NO_CAPS } };
  const [c, thr] = await Promise.all([caps(), throttled()]);
  return {
    pi: true, model: model() || 'Raspberry Pi', os: osName(), hostname: os.hostname(), ip: lanIps(),
    uptime: Math.round(os.uptime()), temp: temp(), throttled: thr, cpuGovernor: governor(),
    memory: { totalMb: Math.round(os.totalmem() / 1048576), freeMb: Math.round(os.freemem() / 1048576) },
    caps: c,
    writable: !!req && (isLoopback(req) || S.sys.allowRemote === true),
  };
}

// ---------------------------------------------------------------- power + screen
async function setGovernor(g) {
  if (!GOVERNORS.includes(g)) return { ok: false, status: 400, error: `governor must be one of ${GOVERNORS.join(', ')}` };
  const avail = governors();
  if (avail.length && !avail.includes(g)) return { ok: false, status: 400, error: `this CPU offers ${avail.join(', ')}` };
  if (S.helper()) {
    const r = await run(S.helper(), ['governor', g], { sudo: S.useSudo, timeout: 5000 });
    if (r.code) return { ok: false, error: r.stderr.trim() || 'Couldn’t change the CPU governor' };
  } else {
    try {
      const base = path.join(S.root || '/', '/sys/devices/system/cpu');
      for (const c of fs.readdirSync(base).filter((d) => /^cpu\d+$/.test(d))) {
        const f = path.join(base, c, 'cpufreq/scaling_governor');
        if (fs.existsSync(f)) fs.writeFileSync(f, g);
      }
    } catch (e) { return { ok: false, error: `Couldn’t change the CPU governor (${e.code || e.message}) — run pi/install.sh` }; }
  }
  log('system', `governor → ${g}`);
  return { ok: true };
}

async function powerStatus() {
  const [bt, ps] = await Promise.all([
    which('bluetoothctl') ? run('bluetoothctl', ['show'], { timeout: 5000 }) : null,
    which('nmcli') ? S.wifi.powerSaveState().catch(() => null) : null,
  ]);
  return {
    saver: !!S.state.saver, governor: governor(), governors: governors(), screenOffMinutes: S.state.screenOffMinutes || 0,
    wifiPowerSave: ps, bluetooth: bt && !bt.code ? /Powered:\s*yes/i.test(bt.stdout) : null, screenOn: S.screen.on,
  };
}
async function setPower(b = {}) {
  const errors = [];
  if (b.saver != null) { S.state.saver = !!b.saver; }
  if (b.screenOffMinutes != null && Number.isFinite(+b.screenOffMinutes)) S.state.screenOffMinutes = clamp(Math.round(+b.screenOffMinutes), 0, 240);
  if (b.governor != null) { const r = await setGovernor(String(b.governor)); if (!r.ok) errors.push(r.error); }
  if (b.wifiPowerSave != null && which('nmcli')) { const r = await S.wifi.powerSave(!!b.wifiPowerSave); if (!r.ok) errors.push(r.error); }
  if (b.bluetooth != null && which('bluetoothctl')) { const r = await S.bt.power({ on: !!b.bluetooth }); if (!r.ok) errors.push(r.error); }
  saveState();
  if (b.saver != null) log('system', `battery saver ${b.saver ? 'on' : 'off'}`);
  return errors.length ? { ok: false, error: errors.join('; '), ...(await powerStatus()) } : { ok: true, ...(await powerStatus()) };
}

async function outputName(env) {
  if (S.sys.output) return S.sys.output;
  if (S.screen.output) return S.screen.output;
  const r = await run('wlr-randr', [], { env, timeout: 4000 });
  const outs = [];
  let cur = null;
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(\S+)/);
    if (m) { cur = { name: m[1], enabled: true }; outs.push(cur); continue; }
    const e = line.match(/^\s+Enabled:\s*(yes|no)/i);
    if (e && cur) cur.enabled = /yes/i.test(e[1]);
  }
  const pick = outs.find((o) => /^HDMI-A-1$|^DSI-\d$/.test(o.name)) || outs.find((o) => o.enabled) || outs[0];
  if (pick) S.screen.output = pick.name;
  return pick?.name || '';
}
async function setScreen({ on, brightness } = {}) {
  const out = { ok: true };
  if (brightness != null) {
    const dir = backlightDir();
    if (!dir) return { ok: false, status: 404, error: 'This screen’s brightness is set with its own buttons' };
    const max = +readFile(S.root, path.join(dir, 'max_brightness')).trim() || 255;
    const v = Math.round(clamp(+brightness || 0, 0, 1) * max);
    const r = S.helper() ? await run(S.helper(), ['backlight', String(v)], { sudo: S.useSudo, timeout: 4000 }) : { code: 1, stderr: 'helper missing' };
    if (r.code) { try { fs.writeFileSync(path.join(S.root || '/', dir, 'brightness'), String(v)); } catch { return { ok: false, error: r.stderr.trim() || 'Couldn’t set the brightness' }; } }
    out.brightness = v / max;
  }
  if (on != null) {
    on = !!on;
    const env = waylandEnv();
    if (!env) return { ok: false, error: 'The kiosk’s Wayland session isn’t running' };
    const name = await outputName(env);
    if (!name) return { ok: false, error: 'No screen output found' };
    let r = { code: 127 };
    if (which('wlopm') && S.sys.screenTool !== 'wlr-randr') r = await run('wlopm', [on ? '--on' : '--off', name], { env, timeout: 5000 });
    if (r.code) r = await run('wlr-randr', ['--output', name, on ? '--on' : '--off'], { env, timeout: 5000 });
    if (r.code) return { ok: false, error: r.stderr.trim() || 'Couldn’t switch the screen' };
    const was = S.screen.on;
    S.screen.on = on; S.screen.at = Date.now(); S.screen.by = 'api';
    if (was !== on) log('system', `screen ${on ? 'on' : 'off'} (${name})`);
    if (!on) armWake(); else disarmWake();
    out.on = on;
  }
  return out;
}
// While the screen is off, the bridge watches the touch screen itself (pi/rr-tool.py wait-input) and turns the
// output back on at the first touch — some compositors stop delivering touches to Chromium with the output off.
function armWake() {
  if (S.sys.wakeOnInput === false || S.screen.waiter) return;
  const tool = path.join(S.appRoot, 'pi', 'rr-tool.py');
  if (!fs.existsSync(tool) || !which('python3')) return;
  const p = spawn(which('python3'), [tool, 'wait-input', '--root', S.root || '/'], { stdio: ['ignore', 'pipe', 'ignore'] });
  S.screen.waiter = p;
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('exit', (code) => {
    if (S.screen.waiter !== p) return;
    S.screen.waiter = null;
    if (code === 0 && !S.screen.on) {
      setScreen({ on: true }).then(() => { S.screen.by = 'input'; log('system', `screen woken by ${out.trim() || 'input'}`); });
    }
  });
}
function disarmWake() { const p = S.screen.waiter; S.screen.waiter = null; if (p) try { p.kill(); } catch {} }

// ---------------------------------------------------------------- reboot / update
async function sudoAllowed(cmd, args) {
  if (!S.useSudo) return true;
  const bin = which(cmd);
  if (!bin) return false;
  const r = await run('sudo', ['-n', '-l', bin, ...args], { timeout: 4000 });
  return r.code === 0;
}
async function powerAction(what) {
  const args = [what === 'reboot' ? 'reboot' : 'poweroff'];
  if (!which('systemctl')) return { ok: false, error: 'systemctl not found' };
  if (!(await sudoAllowed('systemctl', args))) return { ok: false, status: 403, error: 'Not allowed — run pi/install.sh (it adds the sudo rule)' };
  log('system', `${what} requested`);
  setTimeout(() => run('systemctl', args, { sudo: S.useSudo, timeout: 10000 }).then((r) => r.code && log('system', `${what} failed: ${r.stderr.trim()}`)), 500);
  return { ok: true };
}

async function git(args, timeout = 8000) { return run('git', ['-C', S.appRoot, ...args], { timeout }); }
async function updateStatus({ fetch = true } = {}) {
  if (!exists('', path.join(S.appRoot, '.git')) || !which('git')) return { available: false, current: version(), version: version() };
  const [head, branch, dirty] = await Promise.all([git(['rev-parse', '--short', 'HEAD']), git(['rev-parse', '--abbrev-ref', 'HEAD']), git(['status', '--porcelain', '--untracked-files=no'])]);
  const commit = head.stdout.trim();
  const out = { available: true, version: version(), commit, branch: branch.stdout.trim(), current: `${version()}+${commit}`, dirty: !!dirty.stdout.trim(), running: !!S.updating };
  const remote = await S.cache('git-remote', fetch ? 10 * 60000 : 24 * 3600000, async () => {
    if (!fetch) return null;
    const f = await git(['fetch', '--quiet'], 25000);
    if (f.code) return { error: f.stderr.trim().split('\n').pop() || 'git fetch failed' };
    const [up, cnt, pkg] = await Promise.all([git(['rev-parse', '--short', '@{u}']), git(['rev-list', '--count', 'HEAD..@{u}']), git(['show', '@{u}:bridge/package.json'])]);
    let v = ''; try { v = JSON.parse(pkg.stdout).version || ''; } catch {}
    return { latest: up.stdout.trim(), behind: +cnt.stdout.trim() || 0, latestVersion: v, at: Date.now() };
  }).catch(() => null);
  if (!fetch && remote == null) S.cache.clear('git-remote');   // a no-fetch look must not stand in for the next real check
  if (remote?.error) out.error = remote.error;
  else if (remote?.latest) Object.assign(out, { latest: `${remote.latestVersion || version()}+${remote.latest}`, behind: remote.behind, checkedAt: remote.at });
  return out;
}
function version() { try { return JSON.parse(fs.readFileSync(path.join(S.dir, 'package.json'), 'utf8')).version || ''; } catch { return ''; } }
async function doUpdate(b = {}) {
  if (S.updating) return { ok: false, status: 409, error: 'An update is already running' };
  const script = path.join(S.appRoot, 'pi', 'update.sh');
  if (!fs.existsSync(script)) return { ok: false, status: 404, error: 'pi/update.sh is missing' };
  S.updating = true;
  log('system', 'update: starting');
  try {
    const r = await run('bash', [script, '--no-restart', ...(b.force ? ['--force'] : [])], { timeout: 230000 });
    S.cache.clear('git-remote');
    const res = (r.stdout.match(/^RESULT (.*)$/m) || [])[1] || '';
    const kv = Object.fromEntries(res.split(/\s+/).filter(Boolean).map((p) => p.split('=')));
    if (r.code) { log('system', `update failed: ${r.stderr.trim().split('\n').pop()}`); return { ok: false, error: kv.error?.replace(/_/g, ' ') || r.stderr.trim().split('\n').pop() || 'Update failed' }; }
    const updated = kv.updated === '1';
    log('system', updated ? `update: ${kv.from} → ${kv.to}` : 'update: already up to date');
    let restarting = false;
    if (updated && S.sys.restartAfterUpdate !== false && process.env.INVOCATION_ID) {
      restarting = true;
      setTimeout(async () => {
        if (b.reloadKiosk) await run('systemctl', ['--no-block', 'restart', 'roundremote-kiosk.service'], { sudo: S.useSudo });
        const x = await run('systemctl', ['--no-block', 'restart', 'roundremote-bridge.service'], { sudo: S.useSudo });
        if (x.code) log('system', `restart failed: ${x.stderr.trim()}`);
      }, 800);
    }
    return { ok: true, updated, from: kv.from, to: kv.to, restarting, systemChanged: kv.system === '1' };
  } finally { S.updating = false; }
}

// ---------------------------------------------------------------- IMU stream
function imuBroadcast(text) { for (const c of S.imu.clients) c.write(text); }
function imuStart() {
  const I = S.imu;
  clearTimeout(I.stopT);
  if (I.proc) return;
  const c = S.sys.imu || {};
  const args = [imuScript(), ...imuArgs(), '--hz', String(c.hz || 20), '--alpha', String(c.alpha ?? 0.25)];
  if (c.plane) args.push('--plane', String(c.plane));
  if (c.offset) args.push('--offset', String(+c.offset || 0));
  if (c.invert) args.push('--invert');
  if (c.swapXY) args.push('--swap-xy');
  const p = spawn(which('python3') || 'python3', args, { stdio: ['ignore', 'pipe', 'pipe'], env: toolEnv() });
  I.proc = p;
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('{')) continue;
      // status lines go out as a named event ("sensor"), so a plain onmessage only ever sees samples
      if (line.includes('"error"') || line.includes('"ready"')) { imuBroadcast(`event: sensor\ndata: ${line}\n\n`); continue; }
      I.last = line; I.restarts = 0;
      imuBroadcast(`data: ${line}\n\n`);
    }
  });
  p.stderr.on('data', (d) => log('imu', String(d).trim().slice(0, 300)));
  p.on('error', () => {});
  p.on('exit', (code) => {
    if (I.proc !== p) return;
    I.proc = null;
    if (!I.clients.size) return;
    if (++I.restarts <= 3) { log('imu', `helper exited (${code}) — restarting`); setTimeout(() => I.clients.size && imuStart(), 1000 * I.restarts); return; }
    imuBroadcast('event: sensor\ndata: {"error":"motion sensor stopped"}\n\n');
    for (const c of I.clients) c.end();
    I.clients.clear();
    S.cache.clear('imu-detect'); S.cache.clear('caps');
  });
  log('imu', 'sensor stream started');
}
function imuStop() {
  const I = S.imu;
  clearTimeout(I.stopT);
  I.stopT = setTimeout(() => {
    if (I.clients.size || !I.proc) return;
    const p = I.proc; I.proc = null;
    try { p.kill('SIGTERM'); } catch {}
    log('imu', 'sensor stream stopped (no viewers)');
  }, 3000);
}
async function imuStream(req, res) {
  const c = await caps();
  if (!c.imu) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'No motion sensor found' })); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  if (S.imu.last) res.write(`data: ${S.imu.last}\n\n`);
  S.imu.clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  imuStart();
  req.on('close', () => { clearInterval(ping); S.imu.clients.delete(res); if (!S.imu.clients.size) imuStop(); });
}

// ---------------------------------------------------------------- captive portal (port 80 → here, only while the hotspot is on)
async function syncCaptive() {
  if (!isPi() || !which('nmcli')) return;
  const on = await S.wifi.hotspotActive().catch(() => false);
  S.cache.clear('hotspot-on');
  const port = +(S.sys.hotspot?.captivePort || 8766);
  if (on && !S.captive) {
    const url = `http://${S.sys.hotspot?.address || '10.42.0.1'}:${S.cfg.port || 8765}/system/wifi`;
    const srv = http.createServer((req, res) => {
      res.writeHead(302, { Location: url, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(captiveRedirect(url));
    });
    srv.on('error', (e) => { log('system', `captive portal: ${e.message}`); if (S.captive === srv) S.captive = null; });
    srv.listen(port, '0.0.0.0', () => log('system', `captive portal on :${port} → ${url}`));
    S.captive = srv;
    S.captiveT = setInterval(() => syncCaptive().catch(() => {}), 30000);
  } else if (!on && S.captive) {
    S.captive.close(); S.captive = null; clearInterval(S.captiveT);
    log('system', 'captive portal off');
  }
}

// ---------------------------------------------------------------- routing
const send = (json, res, out) => json(res, out?.status || 200, (() => { if (out && 'status' in out) { const { status, ...rest } = out; return rest; } return out; })());

export async function route(req, res, url, { cfg, cors, json, readJson, originAllowed, dir }) {
  init(cfg, dir);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (p === '/system' || p === '/system/wifi') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (p === '/system') { res.writeHead(302, { Location: '/system/wifi' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(WIFI_PAGE);
  }
  if (!p.startsWith('/api/system')) { res.writeHead(404); return res.end('Not found'); }
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!originAllowed(req)) return json(res, 403, { error: `origin ${req.headers.origin} not allowed` });
  const sub = p.slice('/api/system'.length).replace(/^\//, '');
  try {
    if (sub === 'info' || sub === '') return json(res, 200, await info(req));
    if (!isPi()) return json(res, 404, { error: 'Not a Raspberry Pi (set system.force in the bridge config to use this machine anyway)' });

    const local = isLoopback(req) || S.sys.allowRemote === true;
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    if (write && !local) {
      const phoneSetup = (sub === 'wifi/connect') && (await isHotspotClient(req));
      if (!phoneSetup) return json(res, 403, { error: 'Only allowed on the display itself (set system.allowRemote in the bridge config to change this)' });
      if (limited(req)) return json(res, 429, { error: 'Slow down a little' });
    }
    const body = write ? await readJson(req).catch(() => null) : {};
    if (write && (body === null || typeof body !== 'object' || Array.isArray(body))) return json(res, 400, { error: 'JSON body expected' });
    const GET = !write;

    switch (sub) {
      case 'wifi':
        if (GET) return json(res, 200, await S.wifi.status({ withPassword: local, port: cfg.port }));
        break;
      case 'wifi/scan':
        return json(res, 200, await S.wifi.scan());
      case 'wifi/connect': {
        if (GET) break;
        if (!local) {
          // a phone on the hotspot: answer before the hotspot goes down, then connect
          if (!validSsid(body.ssid)) return json(res, 400, { ok: false, error: 'Invalid network name' });
          if (!validPsk(body.password ?? '')) return json(res, 400, { ok: false, code: 'bad-password', error: 'Wi-Fi passwords have 8–63 characters' });
          setTimeout(() => S.wifi.connect(body).then(() => syncCaptive()).catch((e) => log('system', `wifi connect: ${e.message}`)), 1500);
          return json(res, 200, { ok: true, pending: true });
        }
        const r = await S.wifi.connect(body);
        syncCaptive().catch(() => {});
        S.cache.clear('caps');
        return send(json, res, r);
      }
      case 'wifi/forget': if (!GET) return send(json, res, await S.wifi.forget(body)); break;
      case 'wifi/radio': if (!GET) return send(json, res, await S.wifi.radio({ on: !!body.on })); break;
      case 'hotspot': {
        if (!GET) {
          const r = await S.wifi.setHotspot(!!body.on);
          await syncCaptive().catch(() => {});
          if (!r.ok) return send(json, res, r);
        } else await syncCaptive().catch(() => {});
        return json(res, 200, { ok: true, ...(await S.wifi.hotspotStatus({ withPassword: local, port: cfg.port })) });
      }
      case 'bluetooth': if (GET) return json(res, 200, await S.bt.status()); break;
      case 'bluetooth/scan': if (!GET) return send(json, res, await S.bt.scan(body)); break;
      case 'bluetooth/power': if (!GET) return send(json, res, await S.bt.power({ on: !!body.on })); break;
      case 'bluetooth/pair': case 'bluetooth/connect': case 'bluetooth/disconnect': case 'bluetooth/remove':
        if (!GET) return send(json, res, await S.bt[sub.split('/')[1]](body)); break;
      case 'audio': if (GET) return json(res, 200, await S.audio.status()); break;
      case 'audio/default': if (!GET) return send(json, res, await S.audio.setDefault(body)); break;
      case 'audio/volume': if (!GET) return send(json, res, await S.audio.setVolume(body)); break;
      case 'battery': return json(res, 200, await S.battery.status());
      case 'power': return send(json, res, GET ? await powerStatus() : await setPower(body));
      case 'screen':
        if (GET) {
          const bl = backlightDir();
          const b = bl ? { brightness: (+readFile(S.root, path.join(bl, 'brightness')) || 0) / (+readFile(S.root, path.join(bl, 'max_brightness')) || 255) } : {};
          return json(res, 200, { on: S.screen.on, at: S.screen.at, by: S.screen.by, output: S.screen.output || S.sys.output || '', ...b });
        }
        return send(json, res, await setScreen(body));
      case 'reboot': case 'shutdown': if (!GET) return send(json, res, await powerAction(sub)); break;
      case 'update': return send(json, res, GET ? await updateStatus({ fetch: url.searchParams.get('fetch') !== '0' }) : await doUpdate(body));
      case 'imu': if (GET) return imuStream(req, res); break;
      default: return json(res, 404, { error: 'unknown system endpoint' });
    }
    return json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    log('system', `${req.method} ${p}: ${e.message}`);
    if (!res.headersSent) return json(res, 500, { error: e.message });
    res.end();
  }
}
