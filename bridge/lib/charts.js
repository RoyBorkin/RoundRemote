// Chart library for the Rhythm games: the Clone Hero / Rock Band / Guitar Hero community charts indexed by
// Chorus Encore (enchor.us). The bridge does the network part (no CORS limits here):
//   • search   POST https://api.enchor.us/search  { search, page, instrument, difficulty, drumType, drumsReviewed, source }
//              → { found, out_of, page, search_time_ms, data: [ChartData…] }  — normalised to a small list
//   • notes    https://files.enchor.us/<md5>.sng — read with HTTP Range requests: the header + file index first,
//              then ONLY the bytes of notes.mid / notes.chart (+ song.ini when present). The audio, video and
//              images inside the package are never downloaded.
//
// Routes (wired in server.js):  GET /api/charts/status
//                               GET /api/charts/search?artist=&title=&q=
//                               GET /api/charts/notes?md5=     → { format: 'chart'|'mid', data: base64, ini, file, bytesRead, size }
// Config (bridge/config.json → "charts"): { enabled, api, files, cacheDir, maxNotesMB, timeoutMs }
// Env overrides (tests / mirrors): RR_CHARTS_API, RR_CHARTS_FILES
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './util.js';
import { extractSngNotes } from '../../rhythm/charts-sng.js';
import { normalizeChart, cleanTitle } from '../../rhythm/charts-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS = {
  enabled: true,
  api: 'https://api.enchor.us',
  files: 'https://files.enchor.us',
  cacheDir: path.join(__dirname, '..', 'cache', 'charts'),
  maxNotesMB: 8,
  timeoutMs: 15000,
};
const MD5 = /^[0-9a-f]{32}(?:_novideo)?$/i;
const queryArtist = (s = '') => String(s).split(/\s*(?:,| feat\.? | ft\.? | with )\s*/i)[0].trim();

async function withTimeout(ms, fn) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); } finally { clearTimeout(t); }
}

export function createCharts({ cfg }) {
  const C = { ...DEFAULTS, ...(cfg.charts || {}) };
  if (process.env.RR_CHARTS_API) C.api = process.env.RR_CHARTS_API;
  if (process.env.RR_CHARTS_FILES) C.files = process.env.RR_CHARTS_FILES;
  C.api = C.api.replace(/\/$/, ''); C.files = C.files.replace(/\/$/, '');
  const searchCache = new Map();   // query → { at, list }
  const notesCache = new Map();    // md5 → result (also on disk)

  // ---------------------------------------------------------------- search
  async function encore(search) {
    const body = { search, page: 1, instrument: null, difficulty: null, drumType: null, drumsReviewed: false, source: 'website' };
    return withTimeout(C.timeoutMs, async (signal) => {
      const r = await fetch(`${C.api}/search`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'RoundRemote-bridge' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`Chorus Encore answered ${r.status}`);
      const d = await r.json();
      return Array.isArray(d?.data) ? d.data : [];
    });
  }
  async function search({ artist = '', title = '', q = '' } = {}) {
    const queries = [];
    if (q) queries.push(String(q).trim());
    else {
      const t = cleanTitle(title), a = queryArtist(artist);
      if (t && a) queries.push(`${a} ${t}`);
      if (t) queries.push(t);
    }
    if (!queries.length) return { results: [], query: '' };
    const key = queries.join('|').toLowerCase();
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.at < 15 * 60000) return { results: hit.list, query: queries[0], cached: true };
    const seen = new Set(), list = [];
    let lastErr = null;
    for (const qq of queries) {
      try {
        for (const c of await encore(qq)) {
          const n = normalizeChart(c);
          if (n && !seen.has(n.md5)) { seen.add(n.md5); list.push(n); }
        }
      } catch (e) { lastErr = e; }
      if (list.length >= 5) break;          // the artist + title search was enough
    }
    if (!list.length && lastErr) throw lastErr;
    if (searchCache.size > 500) searchCache.delete(searchCache.keys().next().value);
    searchCache.set(key, { at: Date.now(), list });
    log('charts', `search "${queries[0]}": ${list.length} chart${list.length === 1 ? '' : 's'}`);
    return { results: list, query: queries[0] };
  }

  // ---------------------------------------------------------------- notes (range reads)
  async function readRange(url, start, end, stats) {
    return withTimeout(C.timeoutMs, async (signal) => {
      const r = await fetch(url, { signal, headers: { Range: `bytes=${start}-${end - 1}`, 'User-Agent': 'RoundRemote-bridge' } });
      if (r.status === 416) return new Uint8Array(0);
      if (r.status !== 206) {
        // a server that ignores Range would send the whole package (audio included): stop right away
        try { await r.body?.cancel(); } catch {}
        throw new Error(r.ok ? 'The chart server ignores range requests — not downloading the whole song package'
          : r.status === 404 ? 'That chart is no longer in the library' : `The chart server answered ${r.status}`);
      }
      const cr = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(r.headers.get('content-range') || '');
      if (cr && +cr[1] !== start) { try { await r.body?.cancel(); } catch {} throw new Error('Chart server sent the wrong byte range'); }
      if (cr && cr[3] !== '*') stats.size = +cr[3];
      // read at most what we asked for
      const want = end - start, out = new Uint8Array(want);
      let n = 0;
      const reader = r.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const take = Math.min(value.length, want - n);
        out.set(value.subarray(0, take), n); n += take;
        if (n >= want) { try { await reader.cancel(); } catch {} break; }
      }
      stats.bytes += n; stats.ranges.push(`${start}-${start + n - 1}`);
      return n === want ? out : out.slice(0, n);
    });
  }
  const diskFile = (md5) => path.join(C.cacheDir, `${md5.toLowerCase()}.json`);
  async function notes(md5) {
    if (!MD5.test(md5 || '')) throw Object.assign(new Error('bad md5'), { code: 400 });
    md5 = md5.toLowerCase();
    if (notesCache.has(md5)) return { ...notesCache.get(md5), cached: 'memory' };
    try {
      const d = JSON.parse(fs.readFileSync(diskFile(md5), 'utf8'));
      if (d?.data) { notesCache.set(md5, d); return { ...d, cached: 'disk' }; }
    } catch {}
    const url = `${C.files}/${md5}.sng`;
    const stats = { bytes: 0, ranges: [], size: 0 };
    const r = await extractSngNotes((s, e) => readRange(url, s, e, stats), { maxNotesBytes: C.maxNotesMB * 1048576 });
    const out = {
      md5, format: r.format, file: r.file, data: Buffer.from(r.bytes).toString('base64'), ini: r.ini,
      files: r.files.map((f) => f.name), bytesRead: stats.bytes, size: stats.size, ranges: stats.ranges,
    };
    log('charts', `notes ${md5}: ${r.file} (${r.bytes.length} B) — read ${stats.bytes} of ${stats.size || '?'} bytes [${stats.ranges.join(', ')}]`);
    if (notesCache.size > 60) notesCache.delete(notesCache.keys().next().value);
    notesCache.set(md5, out);
    try { fs.mkdirSync(C.cacheDir, { recursive: true }); fs.writeFileSync(diskFile(md5), JSON.stringify(out)); } catch (e) { log('charts', `cache: ${e.message}`); }
    return out;
  }

  // ---------------------------------------------------------------- routes
  async function route(req, res, url, { json }) {
    const p = url.pathname.slice('/api/charts/'.length);
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    if (!C.enabled) return json(res, 503, { error: 'the chart library is disabled in bridge/config.json (charts.enabled)' });
    const sp = url.searchParams;
    try {
      if (p === 'status') return json(res, 200, { ok: true, api: C.api, files: C.files });
      if (p === 'search') return json(res, 200, await search({ artist: sp.get('artist') || '', title: sp.get('title') || '', q: sp.get('q') || '' }));
      if (p === 'notes') return json(res, 200, await notes(sp.get('md5') || ''));
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'The chart library took too long to answer' : e.cause?.code ? `Chart library unreachable (${e.cause.code}) — does the bridge computer have internet?` : e.message;
      log('charts', `${p}: ${msg}`);
      return json(res, e.code === 400 ? 400 : 502, { error: msg });
    }
    return json(res, 404, { error: 'not found' });
  }
  return { route, search, notes };
}

// one shared instance per config (server.js calls route() through a lazy import)
let inst = null;
export function route(req, res, url, { json, cfg = {} }) {
  inst ||= createCharts({ cfg });
  return inst.route(req, res, url, { json });
}
