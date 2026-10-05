// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Client for the bridge's audio features (bridge/lib/audio.js):
//  • the sound of the computer running the bridge, captured by ffmpeg and streamed as raw mono s16le PCM
//  • tempo lookup by Spotify ID / title + artist
//  • proxied download of an audio file (Plex / Jellyfin servers without CORS)
// Works from GitHub Pages too: the bridge base URL and Chrome's local-network-access opt-in come from the
// app's bridge provider.
import { bridgeBase, bridgeFetch } from '../js/providers/bridge.js';
import { lanOpts } from '../js/core/util.js';

const NO_BRIDGE = 'Bridge not reachable — is bridge/server.js running?';

async function base() {
  const b = await bridgeBase();
  if (!b) throw Object.assign(new Error(NO_BRIDGE), { userMessage: NO_BRIDGE });
  return b;
}
async function errorFrom(res) {
  let msg = `HTTP ${res.status}`, hint = null;
  try { const d = await res.json(); msg = d.error || msg; hint = d.hint || null; } catch {}
  return Object.assign(new Error(msg), { status: res.status, hint, userMessage: msg });
}

/**
 * → { ok, capturing, device, error, ffmpeg: bool, hint, input, clients, rate, os, bridge: bool }
 * Never throws: an unreachable bridge gives { ok: false, bridge: false, error }.
 * @param {{ devices?: boolean }} [opts]  devices: also list the capture devices the bridge sees
 */
export async function bridgeAudioStatus({ devices = false } = {}) {
  try {
    const s = await bridgeFetch(`/api/audio/status${devices ? '?devices=1' : ''}`, { timeout: 15000 });
    if (!s || typeof s !== 'object') throw new Error('old bridge');
    return { bridge: true, ...s };
  } catch (e) {
    const old = e.status === 404 || e.message === 'old bridge';
    return {
      ok: false, bridge: !!e.status || old, capturing: false, device: null, ffmpeg: false,
      error: old ? 'This bridge is too old for audio capture — update the bridge folder and restart it.' : (e.userMessage || e.message || NO_BRIDGE),
    };
  }
}

/**
 * Stream the bridge computer's sound.
 * @param {{ sampleRate?: number, onChunk: (samples: Float32Array) => void, onError?: (e: Error) => void,
 *           onOpen?: (info: { device: string, sampleRate: number }) => void, chunkSize?: number, stallMs?: number }} o
 * @returns {{ close(): void, readonly open: boolean, sampleRate: number }}
 *   onChunk gets mono Float32 (-1..1) chunks of `chunkSize` (4096) samples at `sampleRate`.
 *   onError fires once if the stream can't start, ends, or stalls (no data for `stallMs`); the stream is then closed.
 */
export function openBridgeAudio({ sampleRate = 22050, onChunk, onError, onOpen, chunkSize = 4096, stallMs = 6000 } = {}) {
  const ctrl = new AbortController();
  let closed = false, open = false, stallT = 0;
  const buf = new Float32Array(chunkSize);
  let fill = 0, odd = -1;     // odd: a dangling low byte from the previous network chunk

  const close = () => {
    if (closed) return;
    closed = true; open = false;
    clearTimeout(stallT);
    try { ctrl.abort(); } catch {}
  };
  const fail = (e) => {
    if (closed) return;
    close();
    try { onError?.(e instanceof Error ? e : new Error(String(e))); } catch (err) { console.error(err); }
  };
  const armStall = () => { clearTimeout(stallT); stallT = setTimeout(() => fail(new Error('No audio from the bridge (stream stalled)')), stallMs); };

  const push = (bytes) => {
    let i = 0;
    const n = bytes.length;
    if (odd >= 0 && n) { emit(((bytes[0] << 24) >> 16) | odd); odd = -1; i = 1; }
    for (; i + 1 < n; i += 2) emit(((bytes[i + 1] << 24) >> 16) | bytes[i]);
    if (i < n) odd = bytes[i];
  };
  function emit(v) {
    buf[fill++] = v / 32768;
    if (fill === chunkSize) {
      fill = 0;
      if (!closed) { try { onChunk?.(buf.slice()); } catch (e) { console.error(e); } }
    }
  }

  (async () => {
    const b = await base();
    const url = `${b}/api/audio/stream?rate=${Math.round(sampleRate)}`;
    armStall();
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', ...lanOpts(url) });
    if (!res.ok) throw await errorFrom(res);
    if (!res.body?.getReader) throw new Error('This browser cannot read streamed responses');
    open = true;
    try { onOpen?.({ device: decodeURIComponent(res.headers.get('X-Audio-Device') || ''), sampleRate: +res.headers.get('X-Sample-Rate') || sampleRate }); } catch (e) { console.error(e); }
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (closed) return;
      armStall();
      push(value);
    }
    if (!closed) fail(new Error('The bridge stopped the audio stream'));
  })().catch((e) => {
    if (closed) return;
    fail(e.name === 'AbortError' ? new Error('Audio stream aborted') : e.status ? e : Object.assign(new Error(e.userMessage || e.message || NO_BRIDGE), { cause: e }));
  });

  return { close, get open() { return open; }, sampleRate };
}

/** Tempo of a song from free online sources, via the bridge. → { bpm, source } | null */
export async function bridgeTempo({ title = '', artist = '', spotifyId = '' } = {}) {
  try {
    const q = new URLSearchParams();
    if (title) q.set('title', title);
    if (artist) q.set('artist', artist);
    if (spotifyId) q.set('spotifyId', String(spotifyId).replace(/^spotify:track:/, ''));
    const r = await bridgeFetch(`/api/audio/tempo?${q}`, { timeout: 30000 });
    return r && r.bpm ? { bpm: r.bpm, source: r.source } : null;
  } catch { return null; }
}

/**
 * Download an audio file through the bridge (for servers that don't send CORS headers). → ArrayBuffer
 * @param {string} url  http(s) URL of the file (include the server's token in the URL or pass `headers`)
 * @param {{ signal?: AbortSignal, onProgress?: (fraction: number, bytes: number) => void, headers?: object }} [opts]
 */
export async function bridgeFetchAudio(url, { signal, onProgress, headers } = {}) {
  const b = await base();
  const target = `${b}/api/audio/fetch?url=${encodeURIComponent(new URL(url, location.href).href)}`;
  const res = await fetch(target, { signal, headers, cache: 'no-store', ...lanOpts(target) });
  if (!res.ok) throw await errorFrom(res);
  const total = +res.headers.get('Content-Length') || 0;
  if (!onProgress || !res.body?.getReader) return res.arrayBuffer();
  const reader = res.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value); n += value.length;
    try { onProgress(total ? Math.min(1, n / total) : 0, n); } catch {}
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  try { onProgress(1, n); } catch {}
  return out.buffer;
}
