// Check every song's year in rhythm/hits-songs.js against MusicBrainz (first-release-date of matching recordings).
// Run on a computer that can reach musicbrainz.org (from the RoundRemote folder):  node bridge/tools/verify-hit-years.mjs > report.txt
// 1 request per second, as MusicBrainz asks. Prints OK / DIFF / NONE per song and a summary.
const { SONGS } = await import(process.argv[2] ? new URL(process.argv[2], `file://${process.cwd()}/`).href : new URL('../../rhythm/hits-songs.js', import.meta.url).href);
const UA = 'RoundRemote-HitTimeline/1.0 (song year check; https://musicbrainz.org/doc/MusicBrainz_API)';
const norm = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[’'`"“”]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const base = (s) => norm(String(s).replace(/\s*[([][^)\]]*[)\]]/g, ' ')) || norm(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/(["\\])/g, '\\$1');
const first = (a) => a.split(/\s+(?:feat\.?|ft\.?)\s+|\s+&\s+|,\s*/i)[0];
let ok = 0, diff = 0, none = 0;
for (const s of SONGS) {
  const years = [];
  for (const [t, a] of [[s.t, s.a], s.ta ? [s.ta, s.aa] : null].filter(Boolean)) {
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
console.log(`\n${ok} OK · ${diff} differ · ${none} not found (of ${SONGS.length})`);
