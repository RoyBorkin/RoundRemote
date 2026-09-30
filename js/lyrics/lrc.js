// Lyrics: LRC parsing (incl. enhanced word timestamps) + LRCLIB lookup with caching.
import { http, qs, normalizeText } from '../core/util.js';

const LRCLIB = 'https://lrclib.net/api';
const memCache = new Map();
const LS_KEY = 'rr.lyrics.cache';
const LS_MAX = 40;

function lsLoad() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } }
function lsSave(list) { try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(-LS_MAX))); } catch {} }

const TS = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TS = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const toMs = (m, s, f = '0') => (+m * 60 + +s) * 1000 + Math.round(+(`0.${f}`) * 1000);

/** Parse LRC text → { synced, lines:[{t,text,words}] } */
export function parseLrc(text) {
  if (!text) return null;
  let offset = 0;
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (off) { offset = +off[1]; continue; }
    const stamps = [...raw.matchAll(TS)];
    if (!stamps.length) continue;
    let body = raw.replace(TS, '').trim();
    // enhanced LRC: <mm:ss.xx>word
    let words = null;
    if (WORD_TS.test(body)) {
      WORD_TS.lastIndex = 0;
      words = [];
      const parts = body.split(/(<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>)/).filter(Boolean);
      let t = null;
      for (const p of parts) {
        const m = p.match(/^<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>$/);
        if (m) t = toMs(m[1], m[2], m[3]);
        else for (const w of p.split(/\s+/).filter(Boolean)) words.push({ t: t ?? 0, text: w });
      }
      body = words.map((w) => w.text).join(' ');
    }
    for (const s of stamps) lines.push({ t: toMs(s[1], s[2], s[3]) - offset, text: body, words });
  }
  lines.sort((a, b) => a.t - b.t);
  return lines.length ? { synced: true, lines } : null;
}

/** Plain (unsynced) lyrics → evenly spaced pseudo-lines so every style can still animate. */
export function fromPlain(text, durationMs) {
  const rows = (text || '').split(/\r?\n/).map((s) => s.trim());
  const lines = rows.filter((r, i) => r || (rows[i - 1] && rows[i + 1]));
  if (!lines.length) return null;
  const span = Math.max(30000, (durationMs || 180000) - 8000);
  return {
    synced: false,
    lines: lines.map((text, i) => ({ t: 4000 + (span * i) / lines.length, text, words: null })),
  };
}

/** Fill in estimated word timings (weighted by word length) for lines that lack them. */
export function withWordTimes(lyr) {
  if (!lyr) return lyr;
  const L = lyr.lines;
  L.forEach((ln, i) => {
    if (ln.words) return;
    const next = L[i + 1]?.t ?? ln.t + 5000;
    const dur = Math.max(400, Math.min(next - ln.t, 9000)) * 0.85;
    const ws = ln.text.split(/\s+/).filter(Boolean);
    const total = ws.reduce((a, w) => a + w.length + 1.5, 0) || 1;
    let acc = 0;
    ln.words = ws.map((w) => { const t = ln.t + (dur * acc) / total; acc += w.length + 1.5; return { t, text: w }; });
    ln.estimated = true;
  });
  return lyr;
}

/** Index of the active line for position ms (binary search). -1 before the first line. */
export function lineAt(lines, ms) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function keyOf(track) { return `${normalizeText(track.artist)}|${normalizeText(track.title)}`; }

/**
 * Get lyrics for a track. Tries provider-supplied lyrics first (Demo, Jellyfin), then LRCLIB.
 * @returns {Promise<{synced:boolean, lines:Array, instrumental?:boolean, source:string}|null>}
 */
export async function getLyrics(track, provider) {
  if (!track?.title || track.notSong) return null;
  const key = keyOf(track);
  if (memCache.has(key)) return memCache.get(key);

  let result = null;
  try {
    if (provider?.getLyrics) {
      const own = await provider.getLyrics(track);
      if (own) result = { ...own, source: own.source || provider.name };
    }
  } catch (e) { console.info('provider lyrics failed', e); }

  if (!result) {
    const cached = lsLoad().find((c) => c.key === key);
    if (cached) result = cached.data;
  }

  if (!result) result = await fetchLrclib(track);
  if (result) {
    withWordTimes(result);
    memCache.set(key, result);
  }
  return result;
}

async function fetchLrclib(track) {
  const artist = (track.artist || '').split(/,|&| feat\.? | ft\.? /i)[0].trim();
  const title = track.title.replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '').trim();
  const pick = (d) => {
    if (!d) return null;
    if (d.instrumental) return { synced: false, lines: [], instrumental: true, source: 'LRCLIB' };
    const s = parseLrc(d.syncedLyrics);
    if (s) return { ...s, source: 'LRCLIB' };
    const p = fromPlain(d.plainLyrics, track.durationMs);
    return p ? { ...p, source: 'LRCLIB' } : null;
  };
  let data = null;
  try {
    data = await http(`${LRCLIB}/get?${qs({
      track_name: title, artist_name: artist, album_name: track.album || undefined,
      duration: track.durationMs ? Math.round(track.durationMs / 1000) : undefined,
    })}`, { timeout: 9000 });
  } catch (e) { if (e.status !== 404) console.info('lrclib get', e.message); }
  let res = pick(data);
  if (!res || !res.synced) {
    try {
      const list = await http(`${LRCLIB}/search?${qs({ track_name: title, artist_name: artist })}`, { timeout: 9000 });
      if (Array.isArray(list) && list.length) {
        const d = track.durationMs / 1000;
        const scored = list
          .map((x) => ({ x, score: (x.syncedLyrics ? 0 : 1000) + (d ? Math.abs((x.duration || d) - d) : 0) }))
          .sort((a, b) => a.score - b.score);
        const better = pick(scored[0].x);
        if (better && (!res || better.synced)) res = better;
      }
    } catch (e) { console.info('lrclib search', e.message); }
  }
  if (res) {
    const list = lsLoad().filter((c) => c.key !== keyOf(track));
    list.push({ key: keyOf(track), data: res });
    lsSave(list);
  }
  return res;
}
