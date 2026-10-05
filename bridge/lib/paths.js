// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Where the bridge keeps its state, and which role it plays. One place for every path the bridge writes:
//   RR_DATA_DIR   the folder for config.json, sign-ins (psn.json, steam.json, androidtv.json …), lists (tasks.json,
//                 collection.json, blanks.json), profiles/, cache/ and uploaded keys (AuthKey_*.p8).
//                 Default: the bridge folder itself — so the Raspberry Pi and PC installs keep working unchanged.
//                 The Docker image sets RR_DATA_DIR=/data (a volume).
//   RR_CONFIG     the config file (default: <data dir>/config.json)
//   RR_ROLE       'standalone' (default: Pi appliance or a PC) · 'server' (the Docker container on a NAS) ·
//                 'companion' (a Pi that shows the app and forwards to a server — see companion.js)
//   RR_PUBLIC_URL the address phones should open (QR codes), e.g. http://192.168.50.108:8765
// On the first start in a fresh RR_DATA_DIR, config.json is created from config.example.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CODE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // bridge/
export const APP_ROOT = path.resolve(CODE_DIR, '..');                                          // the app (index.html, sw.js …)
const envDir = String(process.env.RR_DATA_DIR || '').trim();
export const DATA_DIR = envDir ? path.resolve(envDir) : CODE_DIR;
/** true when state lives somewhere else than the code (Docker /data, or a hand-picked RR_DATA_DIR) */
export const SEPARATE_DATA = DATA_DIR !== CODE_DIR;
export const CONFIG_FILE = process.env.RR_CONFIG ? path.resolve(process.env.RR_CONFIG) : path.join(DATA_DIR, 'config.json');

const ROLES = new Set(['standalone', 'server', 'companion']);
const roleEnv = String(process.env.RR_ROLE || '').trim().toLowerCase();
export const ROLE = ROLES.has(roleEnv) ? roleEnv : 'standalone';
export const PUBLIC_URL = String(process.env.RR_PUBLIC_URL || '').trim().replace(/\/+$/, '');

/** Running inside a container (Docker / Podman / containerd)? */
export const IN_CONTAINER = (() => {
  if (process.env.RR_CONTAINER === '1') return true;
  try { if (fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')) return true; } catch {}
  try { return /docker|containerd|kubepods|libpod/.test(fs.readFileSync('/proc/1/cgroup', 'utf8')); } catch { return false; }
})();

/** A path inside the data folder. Absolute paths stay as they are (config can point anywhere). */
export const dataPath = (...p) => path.resolve(DATA_DIR, ...p);

/** The app version (sw.js VERSION, e.g. "rr-5.2.0") of the app files this bridge serves. */
export function appVersion(root = APP_ROOT) {
  try { return (fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || ''; } catch { return ''; }
}
/** The bridge's own version (bridge/package.json). */
export function bridgeVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(CODE_DIR, 'package.json'), 'utf8')).version || ''; } catch { return ''; }
}

/**
 * Make sure the data folder exists and is writable; in a fresh, separate data folder create config.json from
 * config.example.json (adapters that can't work in a Linux container — Windows media, MPRIS, AirPlay — off).
 * → { dir, writable, created, error? }. Never throws.
 */
export function ensureDataDir({ log = () => {} } = {}) {
  const out = { dir: DATA_DIR, writable: false, created: false };
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { out.error = e.code || e.message; }
  try { fs.accessSync(DATA_DIR, fs.constants.W_OK); out.writable = true; }
  catch (e) {
    out.error = out.error || e.code || e.message;
    const uid = typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid()}` : '';
    log('bridge', `data folder ${DATA_DIR} is NOT writable${uid ? ` for uid:gid ${uid}` : ''} — sign-ins and lists won't be saved (fix the folder's owner, or set PUID/PGID)`);
  }
  if (SEPARATE_DATA && out.writable && !fs.existsSync(CONFIG_FILE)) {
    try {
      const ex = JSON.parse(fs.readFileSync(path.join(CODE_DIR, 'config.example.json'), 'utf8'));
      if (process.platform !== 'win32') ex.adapters = { ...(ex.adapters || {}), winmedia: false };
      if (ROLE === 'server' || IN_CONTAINER) ex.adapters = { ...(ex.adapters || {}), mpris: false, airplay: false };
      if (ex.apple && /X{6,}/.test(ex.apple.privateKeyPath || '')) ex.apple.privateKeyPath = '';
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(ex, null, 2) + '\n', { mode: 0o600 });
      out.created = true;
      log('bridge', `created ${CONFIG_FILE} from config.example.json (first start)`);
    } catch (e) { log('bridge', `couldn't create ${CONFIG_FILE}: ${e.message}`); }
  }
  return out;
}

/** Free / total bytes of the file system that holds `dir` (null when unknown). */
export function diskSpace(dir = DATA_DIR) {
  try {
    const s = fs.statfsSync(dir);
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch { return null; }
}
