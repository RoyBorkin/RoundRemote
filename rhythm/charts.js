// Chart library client: finds the song that plays among the community charts indexed by Chorus Encore (enchor.us —
// the Clone Hero / Rock Band / Guitar Hero fan charts) and turns a chosen chart into an Analysis.
// The network part normally runs on the bridge (bridge/lib/charts.js — no CORS limits there); the browser tries
// Encore directly first and remembers for the session when that is blocked. Only the note chart is ever downloaded
// (HTTP Range reads of the .sng's index and its notes file — rhythm/charts-sng.js), never the song's audio.
//
//   chartsStatus()                         → { ok, via: 'bridge' | 'direct' | null, reason }
//   findCharts(track, { q })               → ranked results (best first, each with .match = { score, nameSim, durDiff, good })
//   chartNotes(md5)                        → { format, bytes: Uint8Array, ini, file }
//   learnFromChart(chart, { key, durMs })  → Analysis (source 'chart')
import { bridgeFetch } from '../js/providers/bridge.js';
import { extractSngNotes } from './charts-sng.js';
import { normalizeChart, rankCharts, parseNotes, songToAnalysis, cleanTitle } from './charts-data.js';

export const ENCORE_API = 'https://api.enchor.us';
export const ENCORE_FILES = 'https://files.enchor.us';
export { rankCharts, instrumentsText, scoreMatch } from './charts-data.js';

const direct = { search: null, files: null };    // null = not tried yet, true = works from this page, false = blocked
const results = new Map();                       // query → { at, list }

async function timed(ms, fn) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); } finally { clearTimeout(t); }
}
/** A bridge call whose error says what went wrong (the bridge answers { error }). */
async function viaBridge(path, timeout) {
  try { return await bridgeFetch(path, { timeout }); }
  catch (e) { throw Object.assign(new Error(e?.body?.error || e?.userMessage || (e?.name === 'AbortError' ? 'The chart library took too long' : e?.message) || 'Chart library unavailable'), { status: e?.status }); }
}

/** Can this page reach the chart library right now? */
export async function chartsStatus() {
  try {
    const r = await bridgeFetch('/api/charts/status', { timeout: 4000 });
    if (r?.ok) return { ok: true, via: 'bridge' };
    return { ok: false, via: null, reason: 'The bridge’s chart library is off' };
  } catch (e) {
    if (direct.search) return { ok: true, via: 'direct' };
    if (e?.status === 404) return { ok: false, via: null, reason: 'Update the bridge for the chart library' };
    if (e?.status === 503) return { ok: false, via: null, reason: 'Turned off in the bridge’s config' };
    return { ok: false, via: null, reason: 'Needs the bridge (with internet)' };
  }
}

// ---------------------------------------------------------------- search
async function searchDirect(q) {
  return timed(5000, async (signal) => {
    const r = await fetch(`${ENCORE_API}/search`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search: q, page: 1, instrument: null, difficulty: null, drumType: null, drumsReviewed: false, source: 'website' }),
    });
    if (!r.ok) throw Object.assign(new Error(`Chorus Encore answered ${r.status}`), { status: r.status });
    const d = await r.json();
    return (d?.data || []).map(normalizeChart).filter(Boolean);
  });
}
/**
 * Charts for a track, best match first.
 * @param {{ title?: string, artist?: string, durationMs?: number }} track
 * @param {{ q?: string, limit?: number }} [opts]  q: a typed search instead of artist + title
 */
export async function findCharts(track, { q = '', limit = 12 } = {}) {
  const artist = track?.artist || '', title = track?.title || '';
  const query = q || `${artist.split(/\s*(?:,| feat\.? | ft\.? )\s*/i)[0]} ${cleanTitle(title)}`.trim();
  if (!query) return [];
  const cached = results.get(query.toLowerCase());
  let list = cached && Date.now() - cached.at < 10 * 60000 ? cached.list : null;
  if (!list && direct.search !== false) {
    try {
      list = await searchDirect(query);
      if (!list.length && !q && title) list = await searchDirect(cleanTitle(title));
      direct.search = true;
    } catch (e) { if (!e.status) direct.search = false; list = null; }
  }
  if (!list) {
    const sp = new URLSearchParams(q ? { q } : { artist, title });
    const r = await viaBridge(`/api/charts/search?${sp}`, 25000);
    list = r?.results || [];
  }
  results.set(query.toLowerCase(), { at: Date.now(), list });
  return rankCharts(list, { artist: q ? '' : artist, title: q ? q : title, durMs: track?.durationMs || 0 }).slice(0, limit);
}

// ---------------------------------------------------------------- notes
async function notesDirect(md5) {
  const url = `${ENCORE_FILES}/${md5}.sng`;
  const range = (start, end) => timed(10000, async (signal) => {
    const r = await fetch(url, { signal, headers: { Range: `bytes=${start}-${end - 1}` }, cache: 'no-store' });
    if (r.status !== 206) { try { await r.body?.cancel(); } catch {} throw Object.assign(new Error('no range support'), { status: r.status }); }
    return new Uint8Array(await r.arrayBuffer());
  });
  return extractSngNotes(range);
}
const fromB64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
/** The note chart of one library chart: { format: 'chart' | 'mid', bytes, ini, file } — no audio. */
export async function chartNotes(md5) {
  if (!/^[0-9a-f]{32}$/i.test(md5 || '')) throw new Error('Not a chart id');
  if (direct.files !== false) {
    try { const r = await notesDirect(md5); direct.files = true; return r; }
    catch (e) { if (!e.status) direct.files = false; }
  }
  const r = await viaBridge(`/api/charts/notes?md5=${md5}`, 30000);
  if (!r?.data) throw new Error(r?.error || 'The chart could not be read');
  return { format: r.format, bytes: fromB64(r.data), ini: r.ini || {}, file: r.file };
}

/** Download (notes only) + parse a library chart → Analysis for the song `key`. */
export async function learnFromChart(chart, { key = '', durMs = 0, onStatus } = {}) {
  onStatus?.('download');
  const n = await chartNotes(chart.md5);
  onStatus?.('parse');
  const song = parseNotes(n.format, n.bytes, n.ini);
  const a = songToAnalysis(song, { key, ini: n.ini, chart, durMs });
  return a;
}
