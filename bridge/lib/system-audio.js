// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Sound outputs / microphones through PipeWire's WirePlumber CLI (wpctl) — part of the Pi system API.
// wpctl talks to the PipeWire of the user that runs the kiosk; the bridge runs as that same user, and
// XDG_RUNTIME_DIR defaults to /run/user/<uid> (pi/install.sh enables lingering so PipeWire runs at boot).
import { run, validId, clamp } from './system-exec.js';

/**
 * Parse `wpctl status` → { sinks:[{id,name,default,volume,muted}], sources:[…] } (the Audio section only).
 * Lines look like " │  *   51. Built-in Audio Stereo                [vol: 0.40 MUTED]".
 */
export function parseStatus(text) {
  const out = { sinks: [], sources: [] };
  let section = '', list = null;
  for (const raw of String(text || '').split('\n')) {
    if (/^\S/.test(raw)) { section = raw.trim().split(/\s+/)[0]; list = null; continue; }   // "Audio", "Video", "Settings", "PipeWire …"
    if (section !== 'Audio') continue;
    const head = raw.match(/^[\s│├└─]*([A-Z][\w ]*):\s*$/);
    if (head) { list = head[1] === 'Sinks' ? out.sinks : head[1] === 'Sources' ? out.sources : null; continue; }
    if (!list) continue;
    const m = raw.match(/^[\s│├└─]*(\*)?\s*(\d+)\.\s+(.+?)\s*(?:\[vol:\s*([\d.]+)\s*(MUTED)?\s*\])?\s*$/);
    if (!m) continue;
    list.push({ id: +m[2], name: m[3].trim(), default: !!m[1], volume: m[4] != null ? +m[4] : null, muted: !!m[5] });
  }
  return out;
}

export function createAudio() {
  async function status() {
    const r = await run('wpctl', ['status'], { timeout: 6000 });
    if (r.code) return { ok: false, error: /connect|runtime|pipewire/i.test(r.stderr) ? 'PipeWire isn’t running for this user' : (r.stderr.trim() || 'wpctl failed'), sinks: [], sources: [] };
    return parseStatus(r.stdout);
  }
  async function setDefault({ id } = {}) {
    if (!validId(id)) return { ok: false, status: 400, error: 'Invalid device id' };
    const r = await run('wpctl', ['set-default', String(+id)], { timeout: 6000 });
    return r.code ? { ok: false, error: r.stderr.trim() || 'Couldn’t switch' } : { ok: true };
  }
  async function setVolume({ id, volume, muted } = {}) {
    if (!validId(id)) return { ok: false, status: 400, error: 'Invalid device id' };
    if (volume != null) {
      const v = Number(volume);
      if (!Number.isFinite(v)) return { ok: false, status: 400, error: 'Invalid volume' };
      const r = await run('wpctl', ['set-volume', '-l', '1.5', String(+id), clamp(v, 0, 1.5).toFixed(3)], { timeout: 6000 });
      if (r.code) return { ok: false, error: r.stderr.trim() || 'Couldn’t set the volume' };
    }
    if (muted != null) {
      const r = await run('wpctl', ['set-mute', String(+id), muted ? '1' : '0'], { timeout: 6000 });
      if (r.code) return { ok: false, error: r.stderr.trim() || 'Couldn’t mute' };
    }
    return { ok: true };
  }
  return { status, setDefault, setVolume };
}
