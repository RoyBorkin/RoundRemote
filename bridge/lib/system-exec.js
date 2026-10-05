// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Helpers for the Pi system API (lib/system.js): running tools safely, parsing their output, validating input.
// Every command runs through execFile with an argument array (never a shell), a timeout and a C.UTF-8 locale
// (English messages, UTF-8 names), so user strings (SSIDs, passwords, MACs) can never be interpreted by a shell.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** The environment for tools: English messages, UTF-8, and the kiosk user's runtime dir (PipeWire, Wayland). */
export function toolEnv(extra = {}) {
  const env = { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8', ...extra };
  if (!env.XDG_RUNTIME_DIR && typeof process.getuid === 'function') env.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;
  return env;
}

const whichCache = new Map();
/** Absolute path of a command on PATH (cached 30 s), or '' when missing. */
export function which(cmd) {
  if (cmd.includes('/')) return isExec(cmd) ? cmd : '';
  const hit = whichCache.get(cmd);
  if (hit && Date.now() - hit.at < 30000) return hit.path;
  let found = '';
  for (const dir of String(process.env.PATH || '').split(':').concat(['/usr/sbin', '/sbin'])) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    if (isExec(p)) { found = p; break; }
  }
  whichCache.set(cmd, { path: found, at: Date.now() });
  return found;
}
function isExec(p) { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } }
export function clearWhich() { whichCache.clear(); }

/**
 * Run a command. Resolves { code, stdout, stderr, ms } — never rejects: a missing command gives code 127,
 * a timeout code 124 (timedOut: true). opts: timeout (ms), input (stdin text), env, sudo (prefix `sudo -n`).
 */
export function run(cmd, args = [], opts = {}) {
  const { timeout = 10000, input, env, sudo = false, maxBuffer = 4 * 1024 * 1024 } = opts;
  const bin = which(cmd);
  const t0 = Date.now();
  if (!bin) return Promise.resolve({ code: 127, stdout: '', stderr: `${cmd}: not found`, ms: 0, missing: true });
  let file = bin, argv = args.map(String);
  if (sudo) {
    const s = which('sudo');
    if (!s) return Promise.resolve({ code: 127, stdout: '', stderr: 'sudo: not found', ms: 0, missing: true });
    file = s; argv = ['-n', bin, ...argv];
  }
  return new Promise((resolve) => {
    const child = execFile(file, argv, { timeout, env: toolEnv(env), maxBuffer, windowsHide: true, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      const timedOut = !!(err && err.killed && Date.now() - t0 >= timeout - 50);
      const code = err ? (timedOut ? 124 : typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || '') || (err && !stdout && !stderr && code ? String(err.message || '') : ''), ms: Date.now() - t0, timedOut });
    });
    if (input != null) { child.stdin.on('error', () => {}); child.stdin.end(String(input)); }
  });
}

/** Strip terminal colours / readline markers / CRs from interactive tool output. */
export const stripAnsi = (s) => String(s || '')
  .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b[()][0-9A-Za-z]/g, '').replace(/[\x01\x02]/g, '').replace(/\r/g, '');

// ---------------------------------------------------------------- nmcli terse output
/** Split one line of `nmcli -t` output: fields are ':'-separated; '\:' and '\\' are escaped values. */
export function splitTerse(line) {
  const out = []; let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
    if (c === ':') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
/** Lines of `nmcli -t -f a,b,c …` → [{a, b, c}] (the last field takes any surplus, so a stray ':' never shifts). */
export function parseTerse(text, fields) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = splitTerse(line);
    if (parts.length > fields.length) parts.splice(fields.length - 1, parts.length, parts.slice(fields.length - 1).join(':'));
    const row = {};
    fields.forEach((f, i) => { row[f] = parts[i] ?? ''; });
    rows.push(row);
  }
  return rows;
}
/** `nmcli -t -f X,Y connection show <id>` (one "key:value" per line) → { key: value } (values unescaped). */
export function parseTerseKV(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    const parts = splitTerse(line);
    const key = parts.shift();
    if (key) out[key] = parts.join(':');
  }
  return out;
}

// ---------------------------------------------------------------- validation
const CTRL = /[\u0000-\u001f\u007f]/;
/** Wi-Fi SSID: 1–32 bytes of UTF-8, no control characters. */
export function validSsid(s) {
  return typeof s === 'string' && s.length > 0 && !CTRL.test(s) && Buffer.byteLength(s, 'utf8') <= 32;
}
/** WPA passphrase (8–63 printable ASCII) or raw 64-hex PSK; '' means an open network. WEP keys are not offered. */
export function validPsk(s) {
  if (s === '' || s == null) return true;
  return typeof s === 'string' && ((/^[\x20-\x7e]{8,63}$/.test(s)) || /^[0-9a-fA-F]{64}$/.test(s));
}
export const MAC_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;
export const validMac = (s) => typeof s === 'string' && MAC_RE.test(s);
export const validId = (n) => Number.isInteger(+n) && +n >= 0 && +n < 1e6 && String(n).trim() !== '';

/** Read a small file (or '' on any error). `root` prefixes absolute paths (tests use a fake /proc /sys tree). */
export function readFile(root, p) {
  try { return fs.readFileSync(path.join(root || '/', p), 'utf8'); } catch { return ''; }
}
export function exists(root, p) { try { fs.accessSync(path.join(root || '/', p)); return true; } catch { return false; } }

/** KEY=VALUE env file (quotes optional) → object. */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** A tiny async cache: memo(key, ms, fn) returns the cached value while fresh; concurrent calls share one job. */
export function memo() {
  const store = new Map();
  const fn = async (key, ms, job) => {
    const hit = store.get(key);
    if (hit && (hit.pending || Date.now() - hit.at < ms)) return hit.pending || hit.value;
    const pending = Promise.resolve().then(job).then((value) => { store.set(key, { value, at: Date.now() }); return value; },
      (e) => { store.delete(key); throw e; });
    store.set(key, { pending, at: Date.now(), value: hit?.value });
    return pending;
  };
  fn.clear = (key) => (key ? store.delete(key) : store.clear());
  return fn;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
