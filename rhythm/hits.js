// Hit Timeline — a music party game. The app plays a mystery song on the music service you chose; the player
// whose turn it is places it in their timeline of years (before, between or after the cards they already have).
// The reveal flips the card: right spot → the card stays, wrong → it's gone. First to the goal wins.
// Solo: how long a timeline can you build before your third mistake?
//
// The song is never shown before the reveal: a spinning mystery record stands in for it, and the pause card's
// now-playing box hides the song (hideTrack) while it is still a mystery. When the game ends or you quit, the music keeps playing.
import { TAU, clamp, lerp, ease, polar, angDiff, rand, THEME } from '../games/kit.js';
import { player } from '../js/core/player.js';
import { store } from '../js/core/store.js';
import { editText } from '../js/ui/keyboard.js';
import { SONGS, DEMO_SONGS, ERAS } from './hits-songs.js';

const DEG = Math.PI / 180;
const INK_DARK = '#0a0a0b';
const PLAYER_COLORS = ['#ff5a6a', '#4d9bff', '#3ddc84', '#ffc857', '#b57bff', '#ff8ad8'];
const DECADE = { 1930: '#d6a77a', 1940: '#e0b07c', 1950: '#ff8ad8', 1960: '#ff9f43', 1970: '#ffc857', 1980: '#7be08a', 1990: '#2ee6d6', 2000: '#6aa8ff', 2010: '#b98cff', 2020: '#ff6f86' };
const decCol = (y) => DECADE[clamp(Math.floor(y / 10) * 10, 1930, 2020)];
const MAX_TOKENS = 5, START_TOKENS = 1, SOLO_LIVES = 3;
const SERVICE_NAME = { spotify: 'Spotify', apple: 'Apple Music', ytmusic: 'YouTube Music', youtube: 'YouTube', plex: 'Plex', jellyfin: 'Jellyfin', demo: 'Demo' };

// ------------------------------------------------------------------ song matching (per service)
const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[’'`´"“”]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Title without "(Remastered 2011)", "[Live]", " - Single Version" … */
const baseTitle = (s) => norm(String(s || '').replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(/\s+[-–—]\s+.*$/, '')) || norm(s);
const BAD = /\b(live|karaoke|instrumental|cover|tribute|remix|re-?recorded|rerecorded|made famous|in the style of|originally performed|8-?bit|lullaby|sped up|slowed|nightcore|demo version|medley|reprise)\b/i;
const artistParts = (a) => String(a || '').split(/\s*(?:,|&|\+|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\band\b|\bx\b)\s*/i).map(norm).filter((p) => p.length >= 2);
const mainArtist = (a) => String(a || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim();
const firstArtist = (a) => mainArtist(a).split(/\s+&\s+|,\s*/)[0].trim();
const unquote = (s) => String(s).replace(/["“”]/g, '');

function itemArtist(it) { return it.artist || String(it.subtitle || '').split(' · ')[0] || ''; }
function itemAlbum(it) { return String(it.subtitle || '').split(' · ').slice(1).join(' · '); }

/** How well a search result fits the card; null = not this song. */
function scoreItem(it, card, i) {
  if (it.kind && it.kind !== 'track') return null;
  const titles = [card.t, card.ta].filter(Boolean);
  const bt = baseTitle(it.title), ft = norm(it.title);
  let ts = 0;
  for (const t of titles) {
    const want = baseTitle(t), wantFull = norm(t);
    if (!want) continue;
    if (bt === want || ft === wantFull) ts = Math.max(ts, 50);
    else if (bt.startsWith(want) || want.startsWith(bt) || ft.startsWith(wantFull)) ts = Math.max(ts, 32);
    else if (ft.includes(want)) ts = Math.max(ts, 18);
  }
  if (!ts) return null;
  const ra = norm(itemArtist(it));
  const parts = [...artistParts(card.a), ...artistParts(card.aa)];
  const artistOk = !!ra && parts.some((p) => ra.includes(p) || (ra.length >= 3 && p.includes(ra)));
  const wantsBad = BAD.test(card.t);
  const bad = !wantsBad && (BAD.test(it.title || '') || BAD.test(itemAlbum(it)));
  return { it, ts, artistOk, bad, s: ts + (artistOk ? 40 : 0) - (bad ? 45 : 0) - i * 1.5 };
}

function pickBest(items, card) {
  const scored = (items || []).map((it, i) => scoreItem(it, card, i)).filter(Boolean);
  // a clean studio version of the right song by the right artist …
  const good = scored.filter((x) => x.artistOk && !x.bad && x.ts >= 32).sort((a, b) => b.s - a.s);
  if (good.length) return good[0].it;
  // … else a live / remix / remaster-compilation one rather than nothing
  const ok = scored.filter((x) => x.artistOk).sort((a, b) => b.s - a.s);
  return ok[0]?.it || null;
}

/** Search queries to try, in order, for this service. */
function queriesFor(pid, card) {
  const q = [];
  const forms = [[card.t, card.a], card.ta ? [card.ta, card.aa || card.a] : null].filter(Boolean);
  for (const [t, a] of forms) {
    const tt = unquote(t), main = unquote(mainArtist(a)), first = unquote(firstArtist(a));
    if (pid === 'spotify') {
      q.push(`track:"${tt}" artist:"${main}"`);
      if (first !== main) q.push(`track:"${tt}" artist:"${first}"`);
      q.push(`${tt} ${first}`);
    } else if (pid === 'plex' || pid === 'jellyfin' || pid === 'demo') {
      q.push(tt, `${tt} ${first}`);                 // library servers search titles
    } else if (pid === 'youtube' || pid === 'ytmusic') {
      q.push(`${first} ${tt}`);
    } else {
      q.push(`${tt} ${first}`);
    }
  }
  return [...new Set(q)];
}

async function findItem(prov, card) {
  for (const q of queriesFor(prov.id, card)) {
    let res = [];
    try { res = await prov.search(q); } catch (e) { if (e?.userMessage || e?.status === 429) throw e; continue; }
    const hit = pickBest(res, card);
    if (hit) return hit;
  }
  return null;
}

// ------------------------------------------------------------------ "Your library": songs + years from a playlist
async function libraryTracks(prov, pl) {
  const out = [];
  const add = (t, a, y, item, art = '') => { y = parseInt(y, 10); if (t && y > 1900 && y < 2100) out.push({ t, a: a || '', y, item, art }); };
  if (prov.id === 'spotify' && prov.api) {
    let url = pl.liked ? 'me/tracks?limit=50' : `playlists/${pl.id}/items?limit=50`;
    for (let p = 0; url && p < 8; p++) {
      const d = await prov.api(url);
      for (const x of d?.items || []) {
        const t = x?.item || x?.track;
        if (!t || t.type === 'episode' || !t.uri || t.is_local) continue;
        add(t.name, (t.artists || []).map((a) => a.name).join(', '), (t.album?.release_date || '').slice(0, 4),
          { kind: 'track', id: t.id, uri: t.uri, albumUri: t.album?.uri, title: t.name }, t.album?.images?.[0]?.url || '');
      }
      url = d?.next ? d.next.replace(/^https:\/\/api\.spotify\.com\/v1\//, '') : null;
    }
  } else if (prov.id === 'plex' && prov.pms) {
    const d = await prov.pms(`/playlists/${pl.id}/items`);
    for (const m of d?.MediaContainer?.Metadata || []) {
      if (m.type && m.type !== 'track') continue;
      add(m.title, m.originalTitle || m.grandparentTitle, m.parentYear || m.year, { kind: 'track', id: m.ratingKey, title: m.title },
        prov._thumb ? prov._thumb(m.parentThumb || m.thumb) : '');
    }
  } else if (prov.id === 'jellyfin' && prov.api) {
    const qs = new URLSearchParams({ userId: prov.auth?.userId || '', Fields: 'ProductionYear', Limit: '500' });
    const r = await prov.api(`/Playlists/${pl.id}/Items?${qs}`);
    for (const x of r?.Items || []) {
      if (x.Type && x.Type !== 'Audio') continue;
      add(x.Name, (x.Artists || []).join(', ') || x.AlbumArtist, x.ProductionYear, { kind: 'track', id: x.Id, title: x.Name });
    }
  } else if (prov.id === 'apple' && prov.music && !prov.remote) {
    const r = await prov.music.api.music(`/v1/me/library/playlists/${pl.id}/tracks`, { limit: 100, include: 'catalog' });
    for (const s of r?.data?.data || []) {
      const at = s.attributes || {}, cat = s.relationships?.catalog?.data?.[0]?.attributes || {};
      add(at.name, at.artistName, (at.releaseDate || cat.releaseDate || '').slice(0, 4), { kind: 'track', id: s.id, title: at.name });
    }
  } else if (prov.id === 'demo') {
    // the Demo can't list a playlist's songs: start the playlist and read its queue
    const all = await prov.search('');
    await prov.playPlaylist(pl);
    for (const id of prov.queue || []) {
      const it = all.find((x) => x.id === id && x.kind === 'track');
      const d = it && DEMO_SONGS.find((s) => s.t === it.title);
      if (d) out.push({ ...d, item: it });
    }
  } else return null;
  return out;
}
/** For tests and other games: the matcher. */
export { pickBest, queriesFor, scoreItem };

const libraryKind = (prov) => (['spotify', 'plex', 'jellyfin', 'demo'].includes(prov?.id) || (prov?.id === 'apple' && !prov.remote)) && prov.caps?.playlists;

// ------------------------------------------------------------------ the game
const SONGS_OPT = { id: 'deck', name: 'Songs', default: 'all', choices: [{ id: 'all', name: 'All' }, { id: 'old', name: '60s–80s' }, { id: 'new', name: '90s–now' }, { id: 'lib', name: 'Your library' }] };

export default {
  howTo: 'A mystery song plays — place it in your timeline by year: before, between or after your cards. Right spot = you keep the card.',
  hud: false,
  unit: 'cards',
  keyRepeat: true,
  modes: [
    { id: 'party', name: 'Party', options: [{ id: 'goal', name: 'Win at', default: '10', choices: [{ id: '5', name: '5 cards' }, { id: '10', name: '10' }, { id: '15', name: '15' }] }, SONGS_OPT] },
    { id: 'solo', name: 'Solo', options: [SONGS_OPT] },
  ],

  create(g, { mode, opts }) {
    const { ctx } = g;
    const solo = mode === 'solo';
    const goal = solo ? Infinity : parseInt(opts.goal || '10', 10);
    const prov = player.provider;
    const pid = prov?.id || '';
    const svc = prov?.name || SERVICE_NAME[pid] || 'your music service';
    const saved = { names: [], skipIntro: true, count: 3, ...(store.get('gameProgress')?.hits || {}) };
    const save = (patch) => { Object.assign(saved, patch); const all = store.get('gameProgress') || {}; store.set('gameProgress', { ...all, hits: { ...(all.hits || {}), ...patch } }); };

    // ---------- can this service play the game?
    if (!prov) return bail('No music service', 'Choose a music service first (Rhythm → pick a service), then start Hit Timeline.');
    if (!prov.caps?.search || typeof prov.search !== 'function') {
      return bail(`${svc} can’t search`, `Hit Timeline finds each song by searching ${svc}, which this service can’t do here. Use Spotify, Apple Music, YouTube Music, Plex, Jellyfin — or Demo to try the game.`);
    }
    function bail(title, note) { setTimeout(() => g.over(null, { title, note, sfx: false, delay: 150 }), 30); g.loop(() => g.draw.bg({ glow: 0.12 })); return {}; }

    // ---------- state
    let phase = 'setup';            // setup → pick → (handoff) → load → guess → reveal → settle … → won
    let phaseT = 0;
    let players = [], cur = 0, deck = [], drawn = new Set(), lastSong = null;
    let names = solo ? ['You'] : Array.from({ length: clamp(saved.count, 2, 6) }, (_, i) => saved.names[i] || `Player ${i + 1}`);
    let song = null;                // the mystery card { t, a, y, item?, art? }
    let ghost = null;               // slot index where the mystery card would go (0…n)
    let claimed = false;            // "I knew it!" pressed for this song
    let rv = null;                  // reveal info
    let loadMsg = '', failMsg = '', failCount = 0, loadToken = 0, guessT = 0;
    let artImg = null, artFor = null;
    let playlists = null, plSel = 0, plScroll = 0, plMsg = '';
    let drag = null, pressed = null, focus = null;
    let spin = 0, confetti = [], hint = '', hintT = 0;
    let destroyed = false;
    const view = { cards: [], ghost: { a: Math.PI, w: 0, h: 0, k: 0 } }; // animated timeline of the current player
    const P = () => players[cur];
    const color = () => (solo ? g.color : P()?.color || g.color);

    // ---------- deck
    function buildDeck(src) {
      deck = src.slice();
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      drawn = new Set();
    }
    const inTimeline = (p, s) => p.cards.some((c) => c.s === s);
    /** Next card for player p: a song not heard yet; when all were heard, any song not already in p's timeline. */
    function draw(p) {
      let s = deck.find((x) => !drawn.has(x) && !inTimeline(p, x));
      if (!s) s = deck.find((x) => !inTimeline(p, x) && x !== lastSong && x !== song);
      if (!s) s = deck.find((x) => !inTimeline(p, x));
      if (s) drawn.add(s);
      return s || null;
    }

    // ---------- layout of a timeline: k items on an arc around the bottom, earliest at the upper left
    const ARC = () => g.R * 0.715;
    function layout(k) {
      const step = Math.min(34, 240 / Math.max(1, k - 1)) * DEG;
      const px = ARC() * step;
      const w = Math.min(g.R * 0.25, px * 0.86), h = Math.min(w * 1.24, px * 0.9);
      const angs = []; for (let i = 0; i < k; i++) angs.push(Math.PI + ((k - 1) / 2 - i) * step);
      return { angs, w, h, step };
    }
    function syncView(snap = false) {
      const p = P(); if (!p) return;
      const k = p.cards.length + (ghost != null ? 1 : 0);
      const L = layout(Math.max(1, k));
      let j = 0;
      for (let i = 0; i < p.cards.length; i++) {
        if (ghost != null && j === ghost) j++;
        const c = p.cards[i];
        c.ta = L.angs[j]; c.tw = L.w; c.th = L.h; j++;
        if (snap || c.a == null) { c.a = snap === 'fan' ? Math.PI : c.ta; c.w = c.tw; c.h = c.th; }
      }
      if (ghost != null) { view.ghost.ta = L.angs[ghost]; view.ghost.tw = L.w; view.ghost.th = L.h; }
    }
    function slotAt(a) {
      const p = P(); const k = p.cards.length + 1;
      const L = layout(k);
      let best = 0, bd = Infinity;
      L.angs.forEach((x, i) => { const d = Math.abs(angDiff(a, x)); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    const correctSlot = (p, y, slot) => (slot === 0 || p.cards[slot - 1].s.y <= y) && (slot === p.cards.length || p.cards[slot].s.y >= y);

    // ---------- flow
    function setPhase(ph) { phase = ph; phaseT = 0; focus = null; pressed = null; drag = null; }
    function startGame() {
      players = names.map((name, i) => ({ name: name || `Player ${i + 1}`, color: solo ? g.color : PLAYER_COLORS[i % PLAYER_COLORS.length], cards: [], tokens: START_TOKENS, misses: 0, right: 0 }));
      cur = 0;
      for (const p of players) { const s = draw(p); if (s) p.cards.push({ s, born: 0 }); }
      ghost = null; syncView('fan');
      updateScore();
      if (solo) loadNext(); else setPhase('handoff');
    }
    async function openLibrary() {
      setPhase('pick'); playlists = null; plMsg = 'Loading your playlists…';
      try {
        const list = await prov.getPlaylists();
        if (destroyed) return;
        playlists = (list || []).filter((x) => x && x.name);
        plSel = 0; plScroll = 0;
        plMsg = playlists.length ? '' : `No playlists found on ${svc}.`;
      } catch (e) { plMsg = e?.userMessage || e?.message || 'Couldn’t load your playlists.'; playlists = []; }
    }
    async function pickPlaylist(pl) {
      plMsg = `Reading “${pl.name}”…`; const tok = ++loadToken;
      try {
        const songs = await libraryTracks(prov, pl);
        if (destroyed || tok !== loadToken) return;
        const uniq = []; const seen = new Set();
        for (const s of songs || []) { const k = `${norm(s.t)}|${norm(s.a)}`; if (!seen.has(k)) { seen.add(k); uniq.push(s); } }
        if (uniq.length < 4) { plMsg = `“${pl.name}” has too few songs with a release year — pick another.`; return; }
        buildDeck(uniq); startGame();
      } catch (e) { plMsg = e?.userMessage || e?.message || 'Couldn’t read that playlist.'; }
    }
    function begin() {
      save({ names: solo ? saved.names : names, count: solo ? saved.count : names.length });
      if (pid === 'demo' && opts.deck !== 'lib') { buildDeck(DEMO_SONGS); startGame(); return; }
      if (opts.deck === 'lib') {
        if (!libraryKind(prov)) g.toast(`${svc} has no song years — using the song list`, 2600);
        else { openLibrary(); return; }
      }
      const era = ERAS[opts.deck] || ERAS.all;
      buildDeck(SONGS.filter((s) => s.y >= era.from && s.y <= era.to));
      startGame();
    }

    async function loadNext(again = false) {
      const p = P();
      if (!again) { lastSong = song; song = draw(p); }
      ghost = null; claimed = false; rv = null; artImg = null; artFor = null; guessT = 0;
      syncView();
      if (!song) { deckOut(); return; }
      setPhase('load'); loadMsg = 'Finding a song…';
      const tok = ++loadToken;
      const card = song;
      try {
        let item = card.item || await findItem(prov, card);
        if (destroyed || tok !== loadToken) return;
        if (!item) return notFound();
        loadMsg = 'Starting the music…';
        if (pid === 'spotify' && item.albumUri) item = { ...item, albumUri: undefined };   // just this song, not its album
        const before = player.state.track?.id || null;
        await prov.playItem(item);
        if (destroyed || tok !== loadToken) return;
        setTimeout(() => prov.refresh?.().catch(() => {}), 700);
        // wait until the service reports the new song (or give up waiting after a few seconds)
        const t0 = performance.now();
        while (performance.now() - t0 < 7000) {
          const t = player.state.track;
          if (t && (isThisSong(t, card) || (t.id && t.id !== before && t.id === item.id))) break;
          await new Promise((r) => setTimeout(r, 250));
          if (destroyed || tok !== loadToken) return;
        }
        if (saved.skipIntro && player.caps.seek) {
          const dur = player.state.track?.durationMs || 0;
          if (dur > 75000 && isThisSong(player.state.track, card)) { try { await player.seek(30000); } catch {} }
        }
        if (destroyed || tok !== loadToken) return;
        failCount = 0;
        preloadArt();
        setPhase('guess');
        g.sfx('whoosh');
      } catch (e) {
        if (destroyed || tok !== loadToken) return;
        failMsg = e?.userMessage || e?.message || `${svc} couldn’t play the song.`;
        setPhase('fail');
      }
    }
    function isThisSong(t, card) {
      if (!t) return false;
      const bt = baseTitle(t.title);
      return [card.t, card.ta].filter(Boolean).some((x) => baseTitle(x) === bt || bt.startsWith(baseTitle(x)));
    }
    function notFound() {
      failCount++;
      drawn.add(song);
      if (failCount >= 5) { failMsg = `Couldn’t find these songs on ${svc}.`; setPhase('fail'); return; }
      loadMsg = `Not on ${svc} — drawing another…`;
      setTimeout(() => { if (!destroyed && phase === 'load') { deck = deck.filter((x) => x !== song); song = null; loadNext(); } }, 900);
    }
    function preloadArt() {
      const t = player.state.track;
      const url = song?.art || (t && isThisSong(t, song) ? t.art : '') || '';
      if (!url) return;
      const img = new Image(); img.decoding = 'async';
      img.onload = () => { if (artFor === url) artImg = img; };
      artFor = url; img.src = url;
    }
    function lockIn() {
      if (phase !== 'guess' || ghost == null) return;
      const p = P();
      const ok = correctSlot(p, song.y, ghost);
      if (!artImg) preloadArt();
      rv = { ok, slot: ghost, claimed, t: 0 };
      // where it really belongs (for the "it goes here" marker)
      let c = 0; while (c < p.cards.length && p.cards[c].s.y < song.y) c++;
      rv.correct = c;
      setPhase('reveal');
      g.sfx('flap');
    }
    function finishReveal() {
      if (phase !== 'reveal' || phaseT < 0.9) return;
      const p = P();
      if (rv.claimed) p.tokens = Math.min(MAX_TOKENS, p.tokens + 1);
      if (rv.ok) { p.right++; g.sfx('place'); } else { p.misses++; }
      setPhase('settle');
    }
    function afterSettle() {
      const p = P();
      if (rv.ok) { p.cards.splice(rv.slot, 0, { s: song, born: 1, a: view.ghost.a, w: view.ghost.w, h: view.ghost.h }); }
      ghost = null; syncView(); updateScore();
      if (!solo && p.cards.length >= goal) return win(p);
      if (solo && p.misses >= SOLO_LIVES) return soloOver();
      if (solo) { loadNext(); return; }
      cur = (cur + 1) % players.length;
      syncView('fan');
      setPhase('handoff');
    }
    function skipSong(free) {
      if (phase !== 'guess' && phase !== 'fail') return;
      const p = P();
      if (!free) { if (p.tokens <= 0) return; p.tokens--; g.sfx('coin'); }
      else g.sfx('whoosh');
      if (free) deck = deck.filter((x) => x !== song);
      loadNext();
    }
    function updateScore() { const p = P(); if (p) g.score(solo ? p.right : p.cards.length); }
    function win(p) {
      setPhase('won'); g.sfx('win'); g.vibrate(60);
      for (let i = 0; i < 170; i++) {
        confetti.push({ x: g.cx + rand(-1, 1) * g.R * 0.9, y: g.cy - g.R * rand(0.95, 1.6), vx: rand(-0.25, 0.25) * g.R, vy: rand(0.1, 0.5) * g.R,
          r: rand(TAU), vr: rand(-8, 8), w: g.R * rand(0.018, 0.034), h: g.R * rand(0.01, 0.018), c: THEME.pieces[i % THEME.pieces.length] });
      }
      const board = players.map((x) => `${x.name}: ${x.cards.length}`).join(' · ');
      g.over(p.cards.length, { title: `${p.name} wins!`, label: p.name, name: p.name, win: true, note: `Cards — ${board}`, delay: 3200, sfx: false });
    }
    function soloOver() {
      const p = P();
      setPhase('won');
      g.over(p.right, { title: 'Three strikes!', note: `You placed ${p.right} song${p.right === 1 ? '' : 's'} — a ${p.cards.length}-card timeline.`, delay: 1400 });
    }
    function deckOut() {
      setPhase('won');
      if (solo) { const p = P(); g.over(p.right, { title: 'You heard every song!', note: `A ${p.cards.length}-card timeline — the deck ran out.`, win: true, delay: 1600 }); return; }
      const best = Math.max(...players.map((x) => x.cards.length));
      const top = players.filter((x) => x.cards.length === best);
      const board = players.map((x) => `${x.name}: ${x.cards.length}`).join(' · ');
      if (top.length === 1) { win(top[0]); return; }
      g.over(null, { title: 'Out of songs — a tie!', note: board, delay: 1200 });
    }

    // ---------- pause: the shell's pause card shows what's playing — mask it while the song is a mystery
    const mystery = () => ['load', 'guess', 'fail'].includes(phase) || (phase === 'reveal' && phaseT < 0.5);

    // ---------- names (party setup)
    async function rename(i) {
      const v = await editText({ title: `Player ${i + 1}`, value: names[i], placeholder: `Player ${i + 1}` });
      if (v === null || destroyed) return;
      names[i] = v.trim().slice(0, 14) || `Player ${i + 1}`;
    }

    // ------------------------------------------------------------------ input
    let ui = [];                 // buttons drawn this frame: { id, x, y, w, h, fn, round, disabled }
    const hitUi = (x, y) => [...ui].reverse().find((b) => !b.disabled && (b.round ? Math.hypot(x - b.x, y - b.y) <= b.w / 2 : Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2));
    const recPos = () => ({ x: g.cx, y: g.cy - g.R * 0.165, r: g.R * 0.18 });

    g.on('down', (p) => {
      const b = hitUi(p.x, p.y);
      if (b) { pressed = { b, x: p.x, y: p.y }; return; }
      if (phase === 'guess') {
        const rp = recPos();
        if (Math.hypot(p.x - rp.x, p.y - rp.y) < rp.r * 1.15) { drag = { kind: 'rec', x: p.x, y: p.y, x0: p.x, y0: p.y }; return; }
        if (p.r > 0.47) { drag = { kind: 'ring' }; setGhost(slotAt(p.a)); return; }
      }
      if (phase === 'pick' && playlists?.length) { drag = { kind: 'list', y0: p.y, s0: plScroll, moved: false }; return; }
      pressed = { b: null, x: p.x, y: p.y };
    });
    g.on('move', (p) => {
      if (!drag) return;
      if (drag.kind === 'rec') { drag.x = p.x; drag.y = p.y; if (p.r > 0.42) setGhost(slotAt(p.a)); }
      else if (drag.kind === 'ring' && p.r > 0.3) setGhost(slotAt(p.a));
      else if (drag.kind === 'list') { const rowH = g.R * 0.15; const d = (p.y - drag.y0) / rowH; if (Math.abs(d) > 0.15) drag.moved = true; plScroll = clamp(drag.s0 - d, 0, Math.max(0, playlists.length - 5)); }
    });
    g.on('up', (p) => {
      const d = drag; drag = null;
      if (d?.kind === 'rec') {
        const moved = Math.hypot(p.x - d.x0, p.y - d.y0) > g.R * 0.05;
        if (moved && ghost != null) g.sfx('drop');
        if (!moved) { hint = ghost == null ? 'Drag the record to a gap — or tap a gap' : 'Tap Lock in when you’re sure'; hintT = 2; }
        return;
      }
      if (d?.kind === 'ring') return;
      if (d?.kind === 'list') {
        if (!d.moved) { const row = listRowAt(p.y); if (row != null) { plSel = row; pickPlaylist(playlists[row]); g.sfx('click'); } }
        return;
      }
      const pr = pressed; pressed = null;
      if (!pr) return;
      if (pr.b) { const b = hitUi(p.x, p.y); if (b && b.id === pr.b.id) { g.sfx('click'); b.fn(); } return; }
      if (Math.hypot(p.x - pr.x, p.y - pr.y) < g.R * 0.08) tapScreen();
    });
    g.on('wheel', (e) => key(e.delta > 0 ? 'ArrowRight' : 'ArrowLeft'));
    g.on('key', (e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) return; key(e.key); });   // arrows may auto-repeat, Enter may not
    function tapScreen() {
      if (phase === 'handoff' && phaseT > 0.35) loadNext();
      else if (phase === 'reveal') finishReveal();
    }
    function setGhost(i) {
      if (phase !== 'guess') return;
      if (i !== ghost) { ghost = i; syncView(); g.sfx('tick'); }
    }
    function key(k) {
      const btns = ui.filter((b) => !b.disabled && !b.noFocus);
      if (phase === 'guess') {
        if (k === 'ArrowLeft' || k === 'ArrowRight') {
          focus = null;
          const n = P().cards.length;
          if (ghost == null) setGhost(k === 'ArrowLeft' ? Math.floor(n / 2) : Math.ceil(n / 2));
          else setGhost(clamp(ghost + (k === 'ArrowRight' ? 1 : -1), 0, n));
          return;
        }
        if (k === 'ArrowUp' || k === 'ArrowDown') { cycleFocus(btns.filter((b) => b.id !== 'lock'), k === 'ArrowDown' ? 1 : -1); return; }
        if (k === 'Enter' || k === ' ') { const f = btns.find((b) => b.id === focus); if (f) { g.sfx('click'); f.fn(); } else lockIn(); }
        return;
      }
      if (phase === 'pick' && playlists?.length) {
        if (k === 'ArrowDown' || k === 'ArrowRight') plSel = Math.min(playlists.length - 1, plSel + 1);
        else if (k === 'ArrowUp' || k === 'ArrowLeft') plSel = Math.max(0, plSel - 1);
        else if (k === 'Enter' || k === ' ') pickPlaylist(playlists[plSel]);
        plScroll = clamp(plScroll, plSel - 4, plSel);
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) { cycleFocus(btns, k === 'ArrowRight' || k === 'ArrowDown' ? 1 : -1); return; }
      if (k === 'Enter' || k === ' ') {
        const f = btns.find((b) => b.id === focus) || btns.find((b) => b.primary);
        if (f) { g.sfx('click'); f.fn(); } else tapScreen();
      }
    }
    function cycleFocus(list, dir) {
      if (!list.length) return;
      const i = list.findIndex((b) => b.id === focus);
      focus = list[(i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length)].id;
      g.sfx('tick');
    }

    // ------------------------------------------------------------------ drawing helpers
    const font = (size, weight = 700, fam = THEME.display) => `${weight} ${Math.round(size)}px ${fam}`;
    function fit(str, maxW, size, weight = 700, fam = THEME.display) {
      ctx.font = font(size, weight, fam);
      if (ctx.measureText(str).width <= maxW) return str;
      let s = str;
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      return s.trimEnd() + '…';
    }
    function wrap(str, maxW, size, lines = 2, weight = 700, fam = THEME.display) {
      ctx.font = font(size, weight, fam);
      const words = String(str).split(/\s+/); const out = []; let line = '';
      for (let i = 0; i < words.length; i++) {
        const tryLine = line ? `${line} ${words[i]}` : words[i];
        if (ctx.measureText(tryLine).width <= maxW || !line) line = tryLine;
        else { out.push(line); line = words[i]; if (out.length === lines - 1) { line = words.slice(i).join(' '); break; } }
      }
      if (line) out.push(line);
      return out.slice(0, lines).map((l, i) => (i === lines - 1 ? fit(l, maxW, size, weight, fam) : l));
    }
    function text(str, x, y, size, o = {}) { g.draw.text(str, x, y, size, o); }
    function button(id, label, x, y, w, h, fn, { primary = false, disabled = false, col = color(), round = false, noFocus = false, small = false } = {}) {
      ui.push({ id, x, y, w, h, fn, disabled, primary, round, noFocus });
      const isF = focus === id && !disabled;
      const down = pressed?.b?.id === id;
      const s = down ? 0.94 : 1;
      const W = w * s, H = h * s;
      ctx.save();
      ctx.globalAlpha = disabled ? 0.4 : 1;
      const fill = primary ? col : THEME.glass2;
      if (round) g.draw.circle(x, y, W / 2, fill, { glow: primary && !disabled ? g.R * 0.05 : 0 });
      else g.draw.roundRect(x - W / 2, y - H / 2, W, H, H / 2, fill, { glow: primary && !disabled ? col : 0 });
      if (isF) {
        ctx.lineWidth = Math.max(2, g.R * 0.008); ctx.strokeStyle = THEME.fg;
        ctx.beginPath(); if (round) ctx.arc(x, y, W / 2 + g.R * 0.016, 0, TAU); else ctx.roundRect(x - W / 2 - g.R * 0.014, y - H / 2 - g.R * 0.014, W + g.R * 0.028, H + g.R * 0.028, H / 2 + g.R * 0.014); ctx.stroke();
      }
      ctx.restore();
      if (label) text(fit(label, W * 0.86, H * (small ? 0.4 : 0.44), 800), x, y + H * 0.02, H * (small ? 0.4 : 0.44), { color: primary ? INK_DARK : THEME.fg, weight: 800, alpha: disabled ? 0.45 : 1 });
    }
    function coins(x, y, n, size, align = 'center') {
      const gap = size * 2.5, w = (Math.max(1, MAX_TOKENS) - 1) * gap;
      const x0 = align === 'center' ? x - ((n - 1) * gap) / 2 : x;
      for (let i = 0; i < n; i++) {
        g.draw.ball(x0 + i * gap, y, size, '#ffc857');
        g.draw.circle(x0 + i * gap, y, size * 0.55, null, { stroke: 'rgba(120,80,0,.55)', lw: Math.max(1, size * 0.22) });
      }
      return w;
    }
    /** A year card: flat, in its decade's colour, with the year big. */
    function yearCard(x, y, w, h, s, { alpha = 1, rot = 0, details = true } = {}) {
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); if (rot) ctx.rotate(rot);
      const col = decCol(s.y);
      g.draw.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.16, col);
      const ys = Math.min(w * 0.31, h * 0.4);
      const showT = details && w > g.R * 0.15 && h > g.R * 0.2;
      g.draw.text(String(s.y), 0, showT ? -h * 0.1 : h * 0.02, ys, { color: INK_DARK, weight: 800 });
      if (showT) {
        const ts = Math.max(9, w * 0.105);
        g.draw.text(fit(s.t, w * 0.86, ts, 700, THEME.font), 0, h * 0.2, ts, { color: 'rgba(10,10,11,.78)', weight: 700, font: THEME.font });
        g.draw.text(fit(s.a, w * 0.86, ts * 0.92, 500, THEME.font), 0, h * 0.33, ts * 0.92, { color: 'rgba(10,10,11,.55)', weight: 500, font: THEME.font });
      }
      ctx.restore();
    }
    /** The mystery record: a flat vinyl disc with a "?" label, spinning. */
    function record(x, y, r, col, rot) {
      const disc = THEME.light ? '#1b1b20' : '#18181c';
      g.draw.ball(x, y, r, disc);
      g.draw.circle(x, y, r, null, { stroke: g.draw.alpha(col, THEME.light ? 0.9 : 0.75), lw: Math.max(2, r * 0.035) });
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {           // grooves
        const rr = r * (0.52 + i * 0.11);
        ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = Math.max(1, r * 0.012);
        ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = Math.max(1.5, r * 0.025);   // two light arcs show the spin
      ctx.beginPath(); ctx.arc(0, 0, r * 0.78, -0.5, 0.35); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.66, Math.PI - 0.4, Math.PI + 0.3); ctx.stroke();
      g.draw.ball(0, 0, r * 0.38, col);
      g.draw.text('?', 0, r * 0.02, r * 0.42, { color: INK_DARK, weight: 800 });
      ctx.restore();
      g.draw.ball(x, y, r * 0.045, disc);
    }
    function drawTimeline(dt, { dim = 0 } = {}) {
      const p = P(); if (!p) return;
      const k = 1 - Math.exp(-dt * 11);
      for (const c of p.cards) {
        c.a += angDiff(c.a, c.ta) * k; c.w = lerp(c.w, c.tw, k); c.h = lerp(c.h, c.th, k);
        c.born = Math.min(1, (c.born || 0) + dt * 3);
      }
      const gh = view.ghost;
      if (ghost != null) {
        if (!gh.k) { gh.a = gh.ta; gh.w = gh.tw; gh.h = gh.th; }
        gh.k = Math.min(1, gh.k + dt * 5);
        gh.a += angDiff(gh.a, gh.ta) * k; gh.w = lerp(gh.w, gh.tw, k); gh.h = lerp(gh.h, gh.th, k);
      } else gh.k = 0;
      // the track the cards sit on
      const a0 = (300 * DEG), span = 240 * DEG;
      ctx.save(); ctx.setLineDash([g.R * 0.006, g.R * 0.022]); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(g.cx, g.cy, ARC(), a0 - span - Math.PI / 2, a0 - Math.PI / 2); ctx.strokeStyle = THEME.ink(0.16); ctx.lineWidth = g.R * 0.008; ctx.stroke();
      ctx.restore();
      // era hints at both ends
      const L = layout(Math.max(1, p.cards.length + (ghost != null ? 1 : 0)));
      if (phase === 'guess' || phase === 'handoff') {
        const [ex, ey] = polar(g.cx, g.cy, 302 * DEG, ARC() + g.R * 0.0);
        const [lx, ly] = polar(g.cx, g.cy, 58 * DEG, ARC());
        text('older', ex + g.R * 0.02, ey - L.h * 0.5 - g.R * 0.05, g.R * 0.034, { color: THEME.dim, weight: 700 });
        text('newer', lx - g.R * 0.02, ly - L.h * 0.5 - g.R * 0.05, g.R * 0.034, { color: THEME.dim, weight: 700 });
      }
      ctx.save(); if (dim) ctx.globalAlpha = 1 - dim;
      for (const c of p.cards) {
        const [x, y] = polar(g.cx, g.cy, c.a, ARC());
        const pop = ease.back(Math.min(1, c.born));
        yearCard(x, y, c.w * pop, c.h * pop, c.s);
      }
      ctx.restore();
      if (ghost != null && (phase === 'guess' || phase === 'reveal')) {
        const [x, y] = polar(g.cx, g.cy, gh.a, ARC());
        const s = ease.out(gh.k), w = gh.w * s, h = gh.h * s;
        if (phase === 'guess') {
          const pulse = 0.5 + 0.5 * Math.sin(g.time * 5);
          ctx.save();
          ctx.setLineDash([g.R * 0.02, g.R * 0.014]); ctx.lineDashOffset = -g.time * 30;
          g.draw.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.16, g.draw.alpha(color(), 0.16 + 0.1 * pulse), { stroke: color(), lw: Math.max(2, g.R * 0.009) });
          ctx.restore();
          text('?', x, y, Math.min(w, h) * 0.45, { color: color(), weight: 800 });
        } else {
          g.draw.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.16, null, { stroke: rv?.ok ? THEME.ok : THEME.danger, lw: Math.max(2, g.R * 0.009) });
        }
      }
    }
    /** The marker where a wrongly placed song really belongs. */
    function drawCorrectMarker(alpha) {
      const p = P(); if (!rv || rv.ok) return;
      const cards = p.cards;
      const ang = (i) => (cards[i] ? cards[i].a : null);
      let a;
      const c = rv.correct;
      const left = ang(c - 1), right = ang(c);
      const half = layout(cards.length + 1).step * 0.5;
      if (left != null && right != null) a = left + angDiff(left, right) / 2;
      else if (left != null) a = left - half * 1.15; else if (right != null) a = right + half * 1.15; else return;
      const [x, y] = polar(g.cx, g.cy, a, ARC());
      const [x2, y2] = polar(g.cx, g.cy, a, ARC() - g.R * 0.2);
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = THEME.ok; ctx.lineWidth = g.R * 0.014; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x, y); ctx.stroke();
      g.draw.circle(x2, y2, g.R * 0.038, THEME.ok);
      text('✓', x2, y2 + g.R * 0.002, g.R * 0.045, { color: INK_DARK, weight: 800 });
      ctx.restore();
    }
    function hud(line1, line2, col = THEME.fg) {
      text(fit(line1, g.R * 1.2, g.R * 0.072, 800), g.cx, g.cy - g.R * 0.705, g.R * 0.072, { color: col, weight: 800 });
      if (line2) text(fit(line2, g.R * 1.3, g.R * 0.04, 700), g.cx, g.cy - g.R * 0.605, g.R * 0.04, { color: THEME.muted, weight: 700 });
    }
    function playerHud(extra) {
      const p = P();
      const name = solo ? 'Solo streak' : p.name;
      const sub = solo ? `${p.right} placed  ·  ${'♥'.repeat(Math.max(0, SOLO_LIVES - p.misses))}${'♡'.repeat(Math.min(SOLO_LIVES, p.misses))}` : `${p.cards.length} / ${goal} cards`;
      hud(name, extra ?? sub, solo ? THEME.fg : p.color);
      // tokens under the name
      if (p.tokens > 0) coins(g.cx, g.cy - g.R * 0.535, p.tokens, g.R * 0.021);
    }

    // ------------------------------------------------------------------ screens
    function drawSetup() {
      text(solo ? 'Solo streak' : 'Who’s playing?', g.cx, g.cy - g.R * 0.62, g.R * 0.085, { weight: 800 });
      const era = pid === 'demo' && opts.deck !== 'lib' ? 'Demo songs' : opts.deck === 'lib' ? 'Your library' : `${(ERAS[opts.deck] || ERAS.all).name === 'All' ? 'All decades' : (ERAS[opts.deck] || ERAS.all).name}`;
      text(solo ? `${era} · 3 mistakes and you’re out` : `${era} · first to ${goal} cards`, g.cx, g.cy - g.R * 0.5, g.R * 0.04, { color: THEME.muted, weight: 700 });
      if (solo) {
        const lines = wrap('Each song you place in the right spot grows your timeline. How long can you go?', g.R * 1.15, g.R * 0.05, 3, 600, THEME.font);
        lines.forEach((l, i) => text(l, g.cx, g.cy - g.R * 0.22 + i * g.R * 0.075, g.R * 0.05, { color: THEME.fg, weight: 600, font: THEME.font }));
        record(g.cx, g.cy - g.R * 0.0 + g.R * 0.1, g.R * 0.1, g.color, spin);
      } else {
        const colW = g.R * 0.62, rowH = g.R * 0.15, top = g.cy - g.R * 0.3;
        const n = names.length;
        const slots = n < 6 ? n + 1 : n;
        for (let i = 0; i < slots; i++) {
          const col = i % 2, row = Math.floor(i / 2);
          const x = g.cx + (col ? 1 : -1) * colW * 0.54, y = top + row * rowH;
          if (i < n) {
            const c = PLAYER_COLORS[i];
            button(`p${i}`, '', x, y, colW, rowH * 0.78, () => rename(i), { col: c });
            g.draw.ball(x - colW * 0.38, y, rowH * 0.17, c);
            text(fit(names[i], colW * 0.52, rowH * 0.3, 700), x - colW * 0.06, y + rowH * 0.01, rowH * 0.3, { align: 'center', weight: 700 });
            if (n > 2) {
              button(`x${i}`, '', x + colW * 0.38, y, rowH * 0.5, rowH * 0.5, () => { names.splice(i, 1); focus = null; }, { round: true, noFocus: false });
              text('×', x + colW * 0.38, y - rowH * 0.02, rowH * 0.36, { color: THEME.muted, weight: 700 });
            }
          } else {
            button('add', '+ Add player', x, y, colW, rowH * 0.78, () => { names.push(saved.names[names.length] || `Player ${names.length + 1}`); }, {});
          }
        }
      }
      const iy = g.cy + g.R * 0.3;
      button('intro', saved.skipIntro ? '✓ Skip the intro (start at 0:30)' : '○ Play songs from the start', g.cx, iy, g.R * 1.0, g.R * 0.1, () => save({ skipIntro: !saved.skipIntro }), { small: true });
      button('start', 'Start', g.cx, g.cy + g.R * 0.5, g.R * 0.5, g.R * 0.145, begin, { primary: true, col: g.color });
      if (hintT > 0) text(hint, g.cx, g.cy + g.R * 0.68, g.R * 0.036, { color: THEME.muted });
    }
    function listRowAt(y) {
      if (!playlists?.length) return null;
      const rowH = g.R * 0.15, top = g.cy - g.R * 0.3;
      const i = Math.round((y - top) / rowH + plScroll);
      const first = Math.floor(plScroll);
      return i >= first && i < Math.min(playlists.length, first + 5) ? i : null;
    }
    function drawPick() {
      text('Pick a playlist', g.cx, g.cy - g.R * 0.62, g.R * 0.08, { weight: 800 });
      text(`Songs and years from ${svc}`, g.cx, g.cy - g.R * 0.51, g.R * 0.04, { color: THEME.muted, weight: 700 });
      if (playlists?.length) {
        const rowH = g.R * 0.15, top = g.cy - g.R * 0.3, w = g.R * 1.3;
        ctx.save(); ctx.beginPath(); ctx.rect(0, top - rowH * 0.5, g.S, rowH * 5); ctx.clip();
        for (let i = Math.floor(plScroll); i < Math.min(playlists.length, Math.floor(plScroll) + 6); i++) {
          const y = top + (i - plScroll) * rowH;
          const on = i === plSel;
          g.draw.roundRect(g.cx - w / 2, y - rowH * 0.42, w, rowH * 0.84, rowH * 0.42, on ? g.draw.alpha(g.color, 0.9) : THEME.glass2);
          text(fit(playlists[i].name, w * 0.8, rowH * 0.3, 700), g.cx, y - rowH * (playlists[i].subtitle ? 0.08 : 0), rowH * 0.3, { color: on ? INK_DARK : THEME.fg });
          if (playlists[i].subtitle) text(fit(playlists[i].subtitle, w * 0.8, rowH * 0.2, 600, THEME.font), g.cx, y + rowH * 0.2, rowH * 0.2, { color: on ? 'rgba(10,10,11,.6)' : THEME.muted, weight: 600, font: THEME.font });
        }
        ctx.restore();
      }
      button('list', 'Use the song list instead', g.cx, g.cy + g.R * 0.66, g.R * 0.7, g.R * 0.085, () => { loadToken++; buildDeck(pid === 'demo' ? DEMO_SONGS : SONGS); startGame(); }, { small: true });
      if (plMsg) {
        const lines = wrap(plMsg, g.R * 1.2, g.R * 0.045, 3, 600, THEME.font);
        lines.forEach((l, i) => text(l, g.cx, g.cy + (playlists?.length ? g.R * 0.5 : 0) + i * g.R * 0.065, g.R * 0.045, { color: THEME.muted, weight: 600, font: THEME.font }));
      }
    }
    function drawHandoff() {
      const p = P();
      const t = ease.back(Math.min(1, phaseT * 2.2));
      const r = g.R * 0.27 * t;
      const y = g.cy - g.R * 0.12;
      g.draw.circle(g.cx, y, r, p.color, { glow: g.R * 0.08 });
      text('Next up', g.cx, y - r * 0.42, r * 0.17, { color: 'rgba(10,10,11,.65)', weight: 800 });
      text(fit(p.name, r * 1.6, r * 0.34, 800), g.cx, y + r * 0.04, r * 0.34, { color: INK_DARK, weight: 800 });
      text(`${p.cards.length} / ${goal}`, g.cx, y + r * 0.45, r * 0.16, { color: 'rgba(10,10,11,.65)', weight: 800 });
      // scoreboard
      const n = players.length, gap = g.R * 0.24, y2 = g.cy + g.R * 0.27;
      players.forEach((q, i) => {
        const x = g.cx + (i - (n - 1) / 2) * gap;
        const me = i === cur;
        g.draw.circle(x, y2, g.R * (me ? 0.06 : 0.05), q.color, { stroke: me ? THEME.fg : null, lw: g.R * 0.008 });
        text(String(q.cards.length), x, y2 + g.R * 0.003, g.R * 0.05, { color: INK_DARK, weight: 800 });
        text(fit(q.name, gap * 0.92, g.R * 0.03, 700), x, y2 + g.R * 0.095, g.R * 0.03, { color: me ? THEME.fg : THEME.muted, weight: 700 });
      });
      const blink = 0.55 + 0.45 * Math.sin(g.time * 3.5);
      text('Tap to play the song', g.cx, g.cy + g.R * 0.44, g.R * 0.042, { color: THEME.muted, alpha: blink, weight: 700 });
    }
    function drawLoad() {
      const rp = recPos();
      record(rp.x, rp.y, rp.r, color(), spin * 0.35);
      text(loadMsg, g.cx, g.cy + g.R * 0.18, g.R * 0.045, { color: THEME.muted, weight: 700 });
    }
    function drawFail() {
      const rp = recPos();
      ctx.save(); ctx.globalAlpha = 0.45; record(rp.x, rp.y, rp.r, color(), 0); ctx.restore();
      const lines = wrap(failMsg, g.R * 1.1, g.R * 0.045, 3, 600, THEME.font);
      lines.forEach((l, i) => text(l, g.cx, g.cy + g.R * 0.13 + i * g.R * 0.065, g.R * 0.045, { color: THEME.fg, weight: 600, font: THEME.font }));
      const y = g.cy + g.R * 0.13 + lines.length * g.R * 0.065 + g.R * 0.07;
      button('retry', 'Try again', g.cx - g.R * 0.2, y, g.R * 0.36, g.R * 0.11, () => { failCount = 0; loadNext(true); }, { primary: true });
      button('another', 'Another song', g.cx + g.R * 0.2, y, g.R * 0.36, g.R * 0.11, () => { failCount = 0; skipSong(true); }, {});
    }
    function drawGuess(dt) {
      const p = P();
      guessT += dt;
      const rp = recPos();
      const dragging = drag?.kind === 'rec';
      if (dragging) {
        g.draw.circle(rp.x, rp.y, rp.r, null, { stroke: THEME.ink(0.15), lw: g.R * 0.006 });
        const L = layout(p.cards.length + 1);
        const w = L.w * 0.95, h = L.h * 0.95;
        g.draw.roundRect(drag.x - w / 2, drag.y - h / 2, w, h, Math.min(w, h) * 0.16, color(), { glow: color() });
        text('?', drag.x, drag.y, Math.min(w, h) * 0.5, { color: INK_DARK, weight: 800 });
      } else {
        record(rp.x, rp.y, rp.r, color(), spin);
        // a little equaliser under the record says "it's playing"
        const playing = player.state.isPlaying;
        for (let i = 0; i < 5; i++) {
          const hh = g.R * (playing ? 0.008 + 0.018 * Math.abs(Math.sin(g.time * (5 + i * 1.7) + i)) : 0.006);
          g.draw.roundRect(g.cx + (i - 2) * g.R * 0.028 - g.R * 0.008, rp.y + rp.r + g.R * 0.05 - hh, g.R * 0.016, hh * 2, g.R * 0.008, g.draw.alpha(color(), 0.85));
        }
      }
      const by = g.cy + g.R * 0.205;
      button('lock', ghost == null ? 'Pick a spot' : 'Lock in', g.cx, by, g.R * 0.44, g.R * 0.13, lockIn, { primary: true, disabled: ghost == null });
      const y2 = g.cy + g.R * 0.375;
      button('knew', claimed ? '✓ I knew it!' : 'I knew it!', g.cx - g.R * 0.2, y2, g.R * 0.36, g.R * 0.095, () => { claimed = !claimed; if (claimed) g.sfx('coin'); }, { small: true, col: '#ffc857', primary: claimed });
      button('skip', 'Skip  ', g.cx + g.R * 0.2, y2, g.R * 0.36, g.R * 0.095, () => skipSong(false), { small: true, disabled: p.tokens <= 0 });
      ctx.save(); ctx.globalAlpha = p.tokens > 0 ? 1 : 0.45;
      ctx.font = font(g.R * 0.038, 800); const sw = ctx.measureText('Skip').width;
      coins(g.cx + g.R * 0.2 + sw / 2 + g.R * 0.012, y2, 1, g.R * 0.017); ctx.restore();
      // the service may not be playing it: offer a free redraw
      const t = player.state.track;
      const trouble = guessT > 9 && (!player.state.isPlaying || (t && !isThisSong(t, song) && !song.item));
      if (trouble) button('np', 'Not playing? Draw another', g.cx, g.cy + g.R * 0.475, g.R * 0.62, g.R * 0.07, () => skipSong(true), { small: true });
      else if (hintT > 0) text(hint, g.cx, g.cy + g.R * 0.49, g.R * 0.034, { color: THEME.muted, weight: 700 });
      else if (guessT < 6 && ghost == null) text('Drag the record into your timeline', g.cx, g.cy + g.R * 0.49, g.R * 0.034, { color: THEME.dim, weight: 700 });
    }
    function bigCardGeom() { return { x: g.cx, y: g.cy - g.R * 0.075, w: g.R * 0.66, h: g.R * 0.8 }; }
    function drawBigCard(cx, cy, w, h, flip, s) {
      // flip: 0 = back (mystery), 1 = front; scaleX = |cos|
      const sx = Math.abs(Math.cos(flip * Math.PI));
      const front = flip >= 0.5;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(Math.max(0.001, sx), 1);
      if (!front) {
        g.draw.roundRect(-w / 2, -h / 2, w, h, w * 0.09, color());
        ctx.save(); ctx.globalAlpha = 0.9; record(0, 0, w * 0.32, color(), spin); ctx.restore();
      } else {
        const col = decCol(s.y);
        g.draw.roundRect(-w / 2, -h / 2, w, h, w * 0.09, col);
        const art = w * 0.5, ay = -h / 2 + w * 0.08;
        if (artImg) {
          ctx.save(); ctx.beginPath(); ctx.roundRect(-art / 2, ay, art, art, art * 0.08); ctx.clip();
          ctx.drawImage(artImg, -art / 2, ay, art, art); ctx.restore();
        } else {
          g.draw.roundRect(-art / 2, ay, art, art, art * 0.08, 'rgba(10,10,11,.14)');
          g.draw.text('♪', 0, ay + art / 2, art * 0.4, { color: 'rgba(10,10,11,.4)' });
        }
        const yy = ay + art + h * 0.13;
        g.draw.text(String(s.y), 0, yy, h * 0.19, { color: INK_DARK, weight: 800 });
        const tl = wrap(s.t, w * 0.86, h * 0.06, 2, 800);
        tl.forEach((l, i) => g.draw.text(l, 0, yy + h * 0.13 + i * h * 0.068, h * 0.06, { color: INK_DARK, weight: 800 }));
        g.draw.text(fit(s.a, w * 0.86, h * 0.045, 600, THEME.font), 0, yy + h * 0.13 + tl.length * h * 0.068 + h * 0.012, h * 0.045, { color: 'rgba(10,10,11,.66)', weight: 600, font: THEME.font });
      }
      ctx.restore();
    }
    function drawReveal(dt) {
      const B = bigCardGeom();
      const rp = recPos();
      const t = phaseT;
      const grow = ease.out(clamp(t / 0.35, 0, 1));
      const x = lerp(rp.x, B.x, grow), y = lerp(rp.y, B.y, grow);
      const w = lerp(rp.r * 2, B.w, grow), h = lerp(rp.r * 2, B.h, grow);
      const flip = clamp((t - 0.3) / 0.45, 0, 1);
      if (flip >= 0.5 && !rv.sounded) {
        rv.sounded = true;
        if (rv.ok) { g.sfx('perfect'); g.draw.burst(B.x, B.y - B.h * 0.1, decCol(song.y), 26, g.R * 0.7, g.R * 0.014); g.draw.burst(B.x, B.y, THEME.ok, 16, g.R * 0.5); }
        else { g.sfx('hit'); g.vibrate(30); }
        if (rv.claimed) g.draw.float('+1 token', g.cx, g.cy - g.R * 0.5, '#ffc857', g.R * 0.05);
      }
      // a soft scrim keeps the card readable over the timeline
      ctx.save(); ctx.globalAlpha = 0.5 * grow; g.draw.circle(B.x, B.y, B.h * 0.62, THEME.paper(0.35)); ctx.restore();
      const shake = !rv.ok && flip >= 1 && t < 1.25 ? Math.sin(t * 60) * g.R * 0.012 * (1.25 - t) * 3 : 0;
      drawBigCard(x + shake, y, w, h, ease.inOut(flip), song);
      if (flip >= 1) {
        const bx = B.x + B.w * 0.43, byy = B.y - B.h * 0.45, s = ease.back(clamp((t - 0.75) / 0.3, 0, 1));
        g.draw.circle(bx, byy, g.R * 0.065 * s, rv.ok ? THEME.ok : THEME.danger, { stroke: THEME.bg, lw: g.R * 0.012 });
        text(rv.ok ? '✓' : '✕', bx, byy + g.R * 0.004, g.R * 0.07 * s, { color: INK_DARK, weight: 800 });
        drawCorrectMarker(clamp((t - 0.9) / 0.3, 0, 1));
        if (t > 0.9) {
          const a = clamp((t - 0.9) / 0.3, 0, 1);
          text(rv.ok ? 'Right spot — it’s yours!' : 'Not quite!', g.cx, g.cy + g.R * 0.42, g.R * 0.05, { color: rv.ok ? THEME.ok : THEME.danger, weight: 800, alpha: a });
          text('Tap to continue', g.cx, g.cy + g.R * 0.505, g.R * 0.034, { color: THEME.dim, weight: 700, alpha: a * (0.55 + 0.45 * Math.sin(g.time * 3.5)) });
        }
      }
    }
    function drawSettle() {
      const B = bigCardGeom();
      const t = clamp(phaseT / 0.5, 0, 1), e = ease.inOut(t);
      if (rv.ok) {
        const gh = view.ghost;
        const [tx, ty] = polar(g.cx, g.cy, gh.a, ARC());
        const x = lerp(B.x, tx, e), y = lerp(B.y, ty, e), w = lerp(B.w, gh.w, e), h = lerp(B.h, gh.h, e);
        yearCard(x, y, w, h, song, { details: t > 0.6 });
      } else {
        const x = B.x + e * g.R * 0.15, y = B.y + e * e * g.R * 1.3;
        yearCard(x, y, B.w * (1 - 0.4 * e), B.h * (1 - 0.4 * e), song, { alpha: 1 - e, rot: e * 0.6 });
      }
      if (t >= 1) afterSettle();
    }
    function drawConfetti(dt) {
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.vy += g.R * 0.9 * dt; c.vx *= 0.99; c.x += c.vx * dt + Math.sin(g.time * 3 + i) * g.R * 0.1 * dt; c.y += c.vy * dt; c.r += c.vr * dt;
        if (c.y > g.cy + g.R * 1.2) { confetti.splice(i, 1); continue; }
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.fillStyle = c.c; ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h); ctx.restore();
      }
    }

    // ------------------------------------------------------------------ frame
    g.loop((dt) => {
      phaseT += dt; spin += dt * 3.2; if (hintT > 0) hintT -= dt;
      ui = [];
      g.draw.bg({ glow: 0.13, color: phase === 'setup' || phase === 'pick' ? g.color : color() });
      if (phase === 'setup') drawSetup();
      else if (phase === 'pick') drawPick();
      else {
        if (players.length) drawTimeline(dt, { dim: phase === 'reveal' ? 0.25 * clamp(phaseT / 0.35, 0, 1) : 0 });
        if (phase === 'handoff') { drawHandoff(); hud(solo ? '' : 'Pass the display', 'Only the player whose turn it is looks!'); }
        else if (phase === 'load') { playerHud(); drawLoad(); }
        else if (phase === 'fail') { playerHud(); drawFail(); }
        else if (phase === 'guess') { playerHud(); drawGuess(dt); }
        else if (phase === 'reveal') { playerHud(); drawReveal(dt); }
        else if (phase === 'settle') { playerHud(); drawSettle(); }
        else if (phase === 'won') {
          const p = P();
          if (p) hud(solo ? `${p.right} placed` : `${p.name} wins!`, solo ? 'Three strikes' : `${p.cards.length} cards`, solo ? THEME.fg : p.color);
        }
      }
      // keyboard focus can only sit on a button that exists now
      if (focus && !ui.some((b) => b.id === focus && !b.disabled)) focus = null;
      g.draw.particles(dt);
      g.draw.floaters(dt);
      if (confetti.length) drawConfetti(dt);
    });

    return {
      hideTrack: () => mystery(),   // the shell's pause card hides the song while it's a mystery
      destroy() { destroyed = true; loadToken++; },
    };
  },
};
