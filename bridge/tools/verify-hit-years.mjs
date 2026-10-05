// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Check every song's year in rhythm/hits-songs.js (Hitster's deck: SONGS and the Israeli IL_SONGS) against MusicBrainz
// (first-release-date of matching recordings). Songs with two spellings (Hebrew t / a and Latin ta / aa) are searched both ways.
// Run on a computer that can reach musicbrainz.org (from the RoundRemote folder):  node bridge/tools/verify-hit-years.mjs > report.txt
// 1 request per second, as MusicBrainz asks. Prints OK / DIFF / NONE per song and a summary.
//
//   node bridge/tools/verify-hit-years.mjs --wikidata [bucket]
// instead runs Hitster's "Update song lists" queries (rhythm/hits-update.js) against the real Wikidata query service and
// prints, per query, how long it took, how many rows came back and the songs they become (year, language, genres, solo / band)
// — to check the SPARQL from a computer that can reach query.wikidata.org. bucket = e.g. d1980, he, il (default: all).
if (process.argv[2] === '--wikidata') {
  const U = await import(new URL('../../rhythm/hits-update.js', import.meta.url).href);
  const UA = 'RoundRemote-Hitster/1.0 (song list check; https://github.com/royborkin)';
  const only = process.argv[3];
  for (const b of U.BUCKETS.filter((x) => !only || x.id === only)) {
    const t0 = Date.now();
    let d;
    try {
      const r = await fetch(`${U.ENDPOINT}?format=json&query=${encodeURIComponent(U.bucketQuery(b, 0))}`, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
      if (!r.ok) { console.log(`${b.id}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`); continue; }
      d = await r.json();
    } catch (e) { console.log(`${b.id}: ${e.message}`); continue; }
    const rows = d.results?.bindings || [];
    const songs = rows.map((r) => U.rowToSong(r, b)).filter(Boolean);
    console.log(`\n== ${b.id}: ${rows.length} rows → ${songs.length} songs in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const s of songs) console.log(`  ${s.y}  ${s.l}  ${s.b === 1 ? 'band' : s.b === 0 ? 'solo' : '    '}  ${String(s.p).padStart(3)}  ${s.t} — ${s.a}  [${s.g.join(', ')}]`);
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  process.exit(0);
}
const { SONGS, IL_SONGS = [] } = await import(process.argv[2] ? new URL(process.argv[2], `file://${process.cwd()}/`).href : new URL('../../rhythm/hits-songs.js', import.meta.url).href);
const UA = 'RoundRemote-Hitster/1.0 (song year check; https://musicbrainz.org/doc/MusicBrainz_API)';
const norm = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[’'`"“”]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const base = (s) => norm(String(s).replace(/\s*[([][^)\]]*[)\]]/g, ' ')) || norm(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/(["\\])/g, '\\$1');
const first = (a) => a.split(/\s+(?:feat\.?|ft\.?)\s+|\s+&\s+|,\s*/i)[0];
let ok = 0, diff = 0, none = 0;
const ALL = [...SONGS, ...IL_SONGS];
for (const s of ALL) {
  const years = [];
  for (const [t, a] of [[s.t, s.a], s.ta ? [s.ta, s.aa || s.a] : null].filter(Boolean)) {
    const q = `recording:"${esc(t)}" AND artist:"${esc(first(a))}"`;
    await sleep(1100);
    let d = null;
    try { const r = await fetch(`https://musicbrainz.org/ws/2/recording?fmt=json&limit=50&query=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA } }); d = await r.json(); } catch (e) { console.log('ERR', s.t, e.message); continue; }
    for (const r of d.recordings || []) {
      if (base(r.title) !== base(t) && !norm(r.title).startsWith(base(t))) continue;
      if (/live|demo|remix|karaoke|instrumental|rehearsal|acoustic/i.test(r.disambiguation || '')) continue;
      const y = parseInt((r['first-release-date'] || '').slice(0, 4), 10);
      if (y) years.push(y);
    }
  }
  if (!years.length) { none++; console.log(`NONE  ${s.y}  ${s.t} — ${s.a}`); continue; }
  const min = Math.min(...years);
  const cnt = years.filter((y) => y === s.y).length;
  if (min === s.y) { ok++; console.log(`OK    ${s.y}  ${s.t} — ${s.a}`); }
  else { diff++; console.log(`DIFF  list ${s.y} · MB earliest ${min} (${cnt}/${years.length} recordings say ${s.y})  ${s.t} — ${s.a}`); }
}
console.log(`\n${ok} OK · ${diff} differ · ${none} not found (of ${ALL.length})`);
