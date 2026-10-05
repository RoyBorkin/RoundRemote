// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Hitster — a music party game. The app plays a mystery song on the music service you chose; the player
// whose turn it is places it in their timeline of years (before, between or after the cards they already have).
// The reveal flips the card: right spot → the card stays, wrong → it's gone. Four modes (the start card):
//  • Original (mode id 'party' — its top 5 is the old Party one): 2–6 players, the real Hitster rules with tokens —
//    each player starts with 1 card and 2 tokens (max 5). Name the title + artist ("I knew it!") → +1 token, even if
//    the card is misplaced. A token skips a song. After the active player locks in, the others may shout HITSTER!:
//    each puts a token on a different gap of the active player's timeline (first to shout goes first); if the active
//    player is wrong and a challenger is right, the challenger wins the card (it goes into their own timeline);
//    either way the tokens are spent. 3 tokens buy a card (placed for you) at the start of your turn. First to the
//    goal wins. Rules: Pro = start with 5 tokens, you must also name title + artist to keep the card, no tokens
//    earned; Expert = Pro + the exact year.
//  • Classic: the same race to the goal, no tokens at all.
//  • Bingo (hits-bingo.js): Hitster Bingo — spin the wheel for a category, listen, everyone answers, the right ones
//    cross a box of that colour on their 4×4 card; first to complete a line wins.
//  • Co-op / Solo (mode id 'solo' — Solo keeps its old top 5): Solo = how long a timeline before the third mistake;
//    Team = 2–6 players build ONE timeline together, taking turns, with shared tokens; 10 cards wins, 3 mistakes lose.
//
// Before a game (the setup screen): the players, the song languages (English / Hebrew / both / other languages) and
// the genres to block (hits-deck.js; remembered), and "Update songs" — more songs from Wikidata, kept for good
// (hits-update.js). The time period is the start card's Songs option, as before.
//
// English or Hebrew (Settings → Rhythm → Hitster language, or the EN | עב switch on the setup screen; Auto follows
// the keyboard language). In Hebrew everything reads right to left — the timeline too (older on the right) — the
// shell's cards follow (def.lang()). The song language is separate from that.
//
// The song is never shown before the reveal: a spinning mystery record stands in for it, and the pause card's
// now-playing box hides the song (hideTrack) while it is still a mystery. When the game ends or you quit, the music keeps playing.
import { TAU, clamp, lerp, ease, polar, angDiff, rand, THEME } from '../games/kit.js';
import { player } from '../js/core/player.js';
import { store } from '../js/core/store.js';
import { editText } from '../js/ui/keyboard.js';
import { tr, hitsterLang, GENRES, SONG_LANGS, nameOf } from './hits-text.js';
import { norm, baseTitle, mainArtist, firstArtist, buildPool, poolSize, deckPrefs, saveDeckPrefs, genreCounts, DEMO_SONGS, builtinCount, extraCount } from './hits-deck.js';
import { loadExtra, updateSongs, extraInfo, updating } from './hits-update.js';
import { makeUi, PLAYER_COLORS, INK_DARK, decCol, showTitle, showArtist } from './hits-ui.js';
import { createBingo } from './hits-bingo.js';

export { hitsterLang };
const DEG = Math.PI / 180;
const MAX_TOKENS = 5, SOLO_LIVES = 3, TEAM_GOAL = 10, BUY_COST = 3, MIN_SONGS = 4;
const SERVICE_NAME = { spotify: 'Spotify', apple: 'Apple Music', ytmusic: 'YouTube Music', youtube: 'YouTube', plex: 'Plex', jellyfin: 'Jellyfin', demo: 'Demo' };
loadExtra();   // the downloaded songs join the deck as soon as they're read

/** A default player name ("Player 2" / "שחקן 2") in the current language; other names stay as they are. */
const DEFAULT_NAME = /^(?:Player|שחקן) (\d+)$/;
const localName = (n) => { const m = DEFAULT_NAME.exec(n || ''); return m ? tr('player', +m[1]) : n; };

// ------------------------------------------------------------------ song matching (per service)
const BAD = /\b(live|karaoke|instrumental|cover|tribute|remix|re-?recorded|rerecorded|made famous|in the style of|originally performed|8-?bit|lullaby|sped up|slowed|nightcore|demo version|medley|reprise)\b/i;
const artistParts = (a) => String(a || '').split(/\s*(?:,|&|\+|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\band\b|\bx\b)\s*/i).map(norm).filter((p) => p.length >= 2);
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
// the start card's texts follow the language: the shell reads howTo / modes / unit each time it renders a card
const songsOpt = () => ({ id: 'deck', name: tr('songs'), default: 'all', choices: [{ id: 'all', name: tr('deckAll') }, { id: 'il', name: tr('deckIl') },
  { id: 'old', name: tr('deckOld') }, { id: 'new', name: tr('deckNew') }, { id: 'lib', name: tr('deckLib') }] });
const goalOpt = () => ({ id: 'goal', name: tr('goal'), default: '10', choices: [{ id: '5', name: tr('cards5') }, { id: '10', name: '10' }, { id: '15', name: '15' }] });
const shownMode = () => (store.get('gameModes') || {}).hits;

export default {
  get howTo() { return tr(shownMode() === 'bingo' ? 'howToBingo' : 'howTo'); },
  hud: false,
  get unit() { return tr('unit'); },
  keyRepeat: true,
  get modes() {
    return [
      // 'party' and 'solo' keep their ids (and with key '' on the new choices, their old top-5 lists)
      { id: 'party', name: tr('original'), options: [goalOpt(), { id: 'rules', name: tr('rules'), default: 'std',
        choices: [{ id: 'std', name: tr('rulesStd'), key: '' }, { id: 'pro', name: tr('rulesPro') }, { id: 'expert', name: tr('rulesExpert') }] }, songsOpt()] },
      { id: 'classic', name: tr('classic'), options: [goalOpt(), songsOpt()] },
      { id: 'bingo', name: tr('bingo'), scoring: 'low', unit: tr('unitRounds'), options: [{ id: 'level', name: tr('level'), default: 'a',
        choices: [{ id: 'a', name: tr('lvlBeginner') }, { id: 'b', name: tr('lvlExpert') }] }, songsOpt()] },
      { id: 'solo', name: tr('coop'), options: [{ id: 'players', name: tr('players'), default: 'solo',
        choices: [{ id: 'solo', name: tr('solo'), key: '' }, { id: 'team', name: tr('team') }] }, songsOpt()] },
    ];
  },
  /** The shell's cards (start, pause, game over) use this language too — and read right to left in Hebrew. */
  lang: () => hitsterLang(),

  create(g, { mode, opts }) {
    const { ctx } = g;
    // ---------- the mode
    const kind = mode === 'classic' ? 'classic' : mode === 'bingo' ? 'bingo' : mode === 'solo' ? 'coop' : 'party';
    const team = kind === 'coop' && opts.players === 'team';
    const solo = kind === 'coop' && !team;
    const coop = kind === 'coop';                        // one shared timeline
    const rules = kind === 'party' ? (opts.rules || 'std') : 'std';
    const useTokens = kind !== 'classic' && kind !== 'bingo';
    const canChallenge = kind === 'party';
    const goal = solo ? Infinity : team ? TEAM_GOAL : parseInt(opts.goal || '10', 10);
    const startTokens = kind === 'party' ? (rules === 'std' ? 2 : 5) : team ? 2 : 1;
    const earnTokens = rules === 'std';                  // Pro / Expert: naming the song is required, no tokens for it
    const prov = player.provider;
    const pid = prov?.id || '';
    const svcName = () => prov?.name || SERVICE_NAME[pid] || tr('yourService');
    // language: he = Hebrew, right to left; M mirrors left / right (1 = English, −1 = Hebrew)
    let he = hitsterLang() === 'he', M = he ? -1 : 1;
    if (document.fonts?.load) for (const w of [500, 700, 800]) document.fonts.load(`${w} 20px Rubik`, 'אב').catch(() => {});
    const saved = { names: [], skipIntro: true, count: 3, ...(store.get('gameProgress')?.hits || {}) };
    const save = (patch) => { Object.assign(saved, patch); const all = store.get('gameProgress') || {}; store.set('gameProgress', { ...all, hits: { ...(all.hits || {}), ...patch } }); };

    // ---------- can this service play the game?
    if (!prov) return bail(tr('noSvc'), tr('noSvcNote'));
    if (!prov.caps?.search || typeof prov.search !== 'function') return bail(tr('cantSearch', svcName()), tr('cantSearchNote', svcName()));
    function bail(title, note) { setTimeout(() => g.over(null, { title, note, sfx: false, delay: 150 }), 30); g.loop(() => g.draw.bg({ glow: 0.12 })); return {}; }

    // ---------- state
    let phase = 'setup';            // setup (genres, update) → pick → (handoff) → load → guess → (challenge ⇄ cpick) → reveal → settle … → won | bingo
    let phaseT = 0;
    let players = [], cur = 0, deck = [], drawn = new Set(), lastSong = null;
    let crew = [], turn = 0;        // Team: who's playing (the timeline is players[0]) and whose turn it is
    const minPlayers = kind === 'bingo' ? 1 : 2;
    let names = solo ? [tr('you')] : Array.from({ length: clamp(saved.count, minPlayers, 6) }, (_, i) => localName(saved.names[i]) || tr('player', i + 1));
    let song = null;                // the mystery card { t, a, y, item?, art? }
    let ghost = null;               // slot index where the mystery card would go (0…n)
    let claimed = false;            // "I knew it!" pressed for this song
    let yearGuess = null, yearTouched = false;   // Expert: the exact year
    let challenges = [], challenger = null, cGap = null;   // Original: HITSTER! challenges { p, slot } and the one being placed
    let rv = null;                  // reveal info
    let loadMsg = '', failMsg = '', failCount = 0, loadToken = 0, guessT = 0;
    let artImg = null, artFor = null;
    let playlists = null, plSel = 0, plScroll = 0, plMsg = '';
    let drag = null;
    let spin = 0, confetti = [], hint = '', hintT = 0;
    let destroyed = false;
    let bingo = null;
    let prefs = deckPrefs();
    let upd = { state: updating() ? 'run' : 'idle', i: 0, n: 1, label: '', added: 0, msg: '', ctrl: null };
    const view = { cards: [], ghost: { a: Math.PI, w: 0, h: 0, k: 0 } }; // animated timeline of the current player
    const P = () => players[cur];
    const turnName = () => (team ? crew[turn]?.name : P()?.name) || '';
    const color = () => (solo || kind === 'bingo' ? g.color : team ? crew[turn]?.color || g.color : P()?.color || g.color);
    const U = makeUi(g, { he: () => he, color });
    const { text, fit, wrap, button, coins, coin, yearCard, record } = U;

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
    const deckSource = () => ({ deck: opts.deck || 'all', demo: pid === 'demo' && opts.deck !== 'lib' });
    const songCount = () => (opts.deck === 'lib' ? Infinity : poolSize({ ...deckSource(), prefs }));

    /** The language changed (setup switch, Settings, keyboard): default names follow, the timeline mirrors. */
    function syncLang() {
      const now = hitsterLang() === 'he';
      if (now === he) return;
      he = now; M = he ? -1 : 1;
      names = names.map(localName);
      for (const p of players) p.name = localName(p.name);
      for (const p of crew) p.name = localName(p.name);
      if (solo && /^(?:You|אני)$/.test(names[0])) names[0] = tr('you');
      if (team && players[0]) players[0].name = tr('team');
      syncView();
    }

    // ---------- layout of a timeline: k items on an arc around the bottom, earliest at the upper left (upper right in Hebrew)
    const ARC = () => g.R * 0.715;
    function layout(k) {
      const step = Math.min(34, 240 / Math.max(1, k - 1)) * DEG;
      const px = ARC() * step;
      const w = Math.min(g.R * 0.25, px * 0.86), h = Math.min(w * 1.24, px * 0.9);
      const angs = []; for (let i = 0; i < k; i++) angs.push(Math.PI + M * ((k - 1) / 2 - i) * step);
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
    const sortedSlot = (p, y) => { let c = 0; while (c < p.cards.length && p.cards[c].s.y < y) c++; return c; };
    /** Where gap s (0…n, between the cards before the ghost went in) sits on the ring right now. */
    function gapAngle(s) {
      const p = P(), cards = p.cards, n = cards.length;
      if (ghost != null && s === ghost) return view.ghost.a;
      const half = layout(n + 1).step * 0.5;
      const left = cards[s - 1]?.a, right = cards[s]?.a;
      if (left != null && right != null) return left + angDiff(left, right) / 2;
      if (left != null) return left - M * half * 1.05;
      if (right != null) return right + M * half * 1.05;
      return Math.PI;
    }
    /** The gap nearest to angle a that a challenger may still take. */
    function freeGapAt(a) {
      const n = P().cards.length;
      let best = null, bd = Infinity;
      for (let s = 0; s <= n; s++) {
        if (!gapFree(s)) continue;
        const d = Math.abs(angDiff(a, gapAngle(s)));
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    }
    const gapFree = (s) => s !== ghost && !challenges.some((c) => c.slot === s);

    // ---------- flow
    function setPhase(ph) { phase = ph; phaseT = 0; U.focus = null; U.pressed = null; drag = null; }
    const newPlayer = (name, i) => ({ name: name || tr('player', i + 1), color: PLAYER_COLORS[i % PLAYER_COLORS.length], cards: [], tokens: startTokens, misses: 0, right: 0 });
    function startGame() {
      if (kind === 'bingo') { startBingo(); return; }
      if (coop) {
        crew = names.map((name, i) => ({ name: name || tr('player', i + 1), color: PLAYER_COLORS[i % PLAYER_COLORS.length] }));
        players = [{ name: solo ? tr('you') : tr('team'), color: g.color, cards: [], tokens: startTokens, misses: 0, right: 0 }];
        turn = 0;
      } else players = names.map(newPlayer);
      cur = 0;
      for (const p of players) { const s = draw(p); if (s) p.cards.push({ s, born: 0 }); }
      ghost = null; syncView('fan');
      updateScore();
      if (solo) loadNext(); else setPhase('handoff');
    }
    function startBingo() {
      players = names.map(newPlayer);
      setPhase('bingo');
      bingo = createBingo({
        g, U, players, deck, drawn, level: opts.level === 'b' ? 'b' : 'a', he: () => he, M: () => M, color,
        play: playCard, preloadArt: (s) => preloadArt(s), art: () => artImg, bigCard: drawBigCard, record, spin: () => spin,
        hud, svcName, over: (score, info) => { setPhase('won'); g.over(score, info); },
        confetti: () => startConfetti(),
      });
    }
    async function openLibrary() {
      setPhase('pick'); playlists = null; plMsg = tr('loadingPl');
      try {
        const list = await prov.getPlaylists();
        if (destroyed) return;
        playlists = (list || []).filter((x) => x && x.name);
        plSel = 0; plScroll = 0;
        plMsg = playlists.length ? '' : tr('noPl', svcName());
      } catch (e) { plMsg = e?.userMessage || e?.message || tr('plErr'); playlists = []; }
    }
    async function pickPlaylist(pl) {
      plMsg = tr('reading', pl.name); const tok = ++loadToken;
      try {
        const songs = await libraryTracks(prov, pl);
        if (destroyed || tok !== loadToken) return;
        const uniq = []; const seen = new Set();
        for (const s of songs || []) { const k = `${norm(s.t)}|${norm(s.a)}`; if (!seen.has(k)) { seen.add(k); uniq.push(s); } }
        if (uniq.length < 4) { plMsg = tr('fewSongs', pl.name); return; }
        buildDeck(uniq); startGame();
      } catch (e) { plMsg = e?.userMessage || e?.message || tr('readErr'); }
    }
    async function begin() {
      save({ names: solo ? saved.names : names, count: solo ? saved.count : names.length });
      await loadExtra();
      if (destroyed || phase !== 'setup') return;
      if (opts.deck === 'lib') {
        if (!libraryKind(prov)) g.toast(tr('noYears', svcName()), 2600);
        else { openLibrary(); return; }
      }
      const pool = buildPool(opts.deck === 'lib' ? { deck: 'all', prefs } : { ...deckSource(), prefs });
      if (pool.length < MIN_SONGS) { g.toast(tr('tooFew'), 2200); return; }
      buildDeck(pool);
      startGame();
    }

    // ---------- playing a song on the service (the timeline modes and Bingo)
    /** Find the card on the service and start it. → true, or false when the service doesn't have it; throws on errors. */
    async function playCard(card, isLive = () => true) {
      let item = card.item || await findItem(prov, card);
      if (destroyed || !isLive()) return null;
      if (!item) return false;
      if (pid === 'spotify' && item.albumUri) item = { ...item, albumUri: undefined };   // just this song, not its album
      const before = player.state.track?.id || null;
      await prov.playItem(item);
      if (destroyed || !isLive()) return null;
      setTimeout(() => prov.refresh?.().catch(() => {}), 700);
      // wait until the service reports the new song (or give up waiting after a few seconds)
      const t0 = performance.now();
      while (performance.now() - t0 < 7000) {
        const t = player.state.track;
        if (t && (isThisSong(t, card) || (t.id && t.id !== before && t.id === item.id))) break;
        await new Promise((r) => setTimeout(r, 250));
        if (destroyed || !isLive()) return null;
      }
      if (saved.skipIntro && player.caps.seek) {
        const dur = player.state.track?.durationMs || 0;
        if (dur > 75000 && isThisSong(player.state.track, card)) { try { await player.seek(30000); } catch {} }
      }
      return destroyed || !isLive() ? null : true;
    }
    async function loadNext(again = false) {
      const p = P();
      if (!again) { lastSong = song; song = draw(p); }
      ghost = null; claimed = false; rv = null; artImg = null; artFor = null; guessT = 0; challenges = []; challenger = null; cGap = null;
      yearGuess = null; yearTouched = false;
      syncView();
      if (!song) { deckOut(); return; }
      setPhase('load'); loadMsg = 'finding';
      const tok = ++loadToken;
      const card = song;
      try {
        setTimeout(() => { if (tok === loadToken && phase === 'load' && loadMsg === 'finding') loadMsg = 'starting'; }, 900);
        const ok = await playCard(card, () => tok === loadToken);
        if (ok === null) return;
        if (!ok) return notFound();
        failCount = 0;
        preloadArt(song);
        setPhase('guess');
        g.sfx('whoosh');
      } catch (e) {
        if (destroyed || tok !== loadToken) return;
        failMsg = e?.userMessage || e?.message || tr('playErr', svcName());
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
      if (failCount >= 5) { failMsg = tr('notFoundAll', svcName()); setPhase('fail'); return; }
      loadMsg = 'notOn';
      setTimeout(() => { if (!destroyed && phase === 'load') { deck = deck.filter((x) => x !== song); song = null; loadNext(); } }, 900);
    }
    function preloadArt(card = song) {
      const t = player.state.track;
      const url = card?.art || (t && isThisSong(t, card) ? t.art : '') || '';
      if (!url) { artImg = null; artFor = null; return; }
      if (artFor === url) return;
      const img = new Image(); img.decoding = 'async';
      img.onload = () => { if (artFor === url) artImg = img; };
      artFor = url; artImg = null; img.src = url;
    }
    function lockIn() {
      if (phase !== 'guess' || ghost == null) return;
      if (!artImg) preloadArt();
      // others with a token may challenge first (Original)
      if (canChallenge && players.some(canStillChallenge)) { setPhase('challenge'); g.sfx('drop'); return; }
      reveal();
    }
    function reveal() {
      const p = P();
      const place = correctSlot(p, song.y, ghost);
      rv = { place, slot: ghost, claimed, yearOk: rules !== 'expert' || yearGuess === song.y, t: 0, correct: sortedSlot(p, song.y) };
      evalReveal();
      setPhase('reveal');
      g.sfx('flap');
    }
    /** Whether the active player keeps the card, and which challenger (if any) wins it. */
    function evalReveal() {
      const p = P();
      rv.ok = rv.place && (rules === 'std' || rv.claimed) && rv.yearOk;
      rv.thief = !rv.place ? challenges.find((c) => correctSlot(p, song.y, c.slot))?.p || null : null;
    }
    function finishReveal() {
      if (phase !== 'reveal' || phaseT < 0.9) return;
      const p = P();
      if (rv.claimed && useTokens && earnTokens) p.tokens = Math.min(MAX_TOKENS, p.tokens + 1);
      if (rv.ok) { p.right++; g.sfx('place'); } else { p.misses++; }
      if (rv.thief) g.sfx('coin');
      setPhase('settle');
    }
    function afterSettle() {
      const p = P();
      if (rv.ok) { p.cards.splice(rv.slot, 0, { s: song, born: 1, a: view.ghost.a, w: view.ghost.w, h: view.ghost.h }); }
      if (rv.thief) { const q = rv.thief; q.cards.splice(sortedSlot(q, song.y), 0, { s: song, born: 0 }); q.right++; }
      ghost = null; syncView(); updateScore();
      if (!coop && p.cards.length >= goal) return win(p);
      if (rv.thief && rv.thief.cards.length >= goal) return win(rv.thief);
      if (team && p.cards.length >= goal) return teamWin();
      if (coop && p.misses >= SOLO_LIVES) return solo ? soloOver() : teamLose();
      if (solo) { loadNext(); return; }
      nextTurn();
    }
    function nextTurn() {
      if (team) turn = (turn + 1) % crew.length;
      else cur = (cur + 1) % players.length;
      syncView('fan');
      setPhase('handoff');
    }
    function skipSong(free) {
      if (phase !== 'guess' && phase !== 'fail') return;
      const p = P();
      if (!free) { if (!useTokens || p.tokens <= 0) return; p.tokens--; g.sfx('coin'); }
      else g.sfx('whoosh');
      if (free) deck = deck.filter((x) => x !== song);
      loadNext();
    }
    /** 3 tokens → a card placed for you (start of your turn). */
    function buyCard() {
      const p = P();
      if (phase !== 'handoff' || !useTokens || p.tokens < BUY_COST) return;
      const s = draw(p);
      if (!s) return;
      p.tokens -= BUY_COST;
      p.cards.splice(sortedSlot(p, s.y), 0, { s, born: 0 });
      syncView(); updateScore();
      g.sfx('coin'); g.toast(tr('bought'), 1300);
      if (p.cards.length >= goal) { if (team) teamWin(); else win(p); }
    }
    function updateScore() { const p = P(); if (p) g.score(solo ? p.right : p.cards.length); }
    function startConfetti() {
      for (let i = 0; i < 170; i++) {
        confetti.push({ x: g.cx + rand(-1, 1) * g.R * 0.9, y: g.cy - g.R * rand(0.95, 1.6), vx: rand(-0.25, 0.25) * g.R, vy: rand(0.1, 0.5) * g.R,
          r: rand(TAU), vr: rand(-8, 8), w: g.R * rand(0.018, 0.034), h: g.R * rand(0.01, 0.018), c: THEME.pieces[i % THEME.pieces.length] });
      }
    }
    function win(p) {
      setPhase('won'); g.sfx('win'); g.vibrate(60);
      cur = players.indexOf(p); syncView();
      startConfetti();
      const board = players.map((x) => `${x.name}: ${x.cards.length}`).join(' · ');
      g.over(p.cards.length, { title: tr('wins', p.name), name: p.name, win: true, note: tr('board', board), delay: 3200, sfx: false });
    }
    /** The team's name on the top 5: "Dana, Roy" — or "Dana +3" when that's too long. */
    const crewName = () => { const all = crew.map((c) => c.name).join(', '); return all.length <= 16 ? all : `${crew[0].name.slice(0, 12)} +${crew.length - 1}`; };
    // Team score = the cards on the shared timeline
    function teamWin() {
      const p = P();
      setPhase('won'); g.sfx('win'); g.vibrate(60); startConfetti();
      g.over(p.cards.length, { title: tr('teamWin'), note: tr('teamWinNote', p.cards.length, p.tokens), win: true, delay: 3000, sfx: false, name: crewName() });
    }
    function teamLose() {
      const p = P();
      setPhase('won');
      g.over(p.cards.length, { title: tr('strikesT'), note: tr('teamNote', p.cards.length), delay: 1400, name: crewName() });
    }
    function soloOver() {
      const p = P();
      setPhase('won');
      g.over(p.right, { title: tr('strikesT'), note: tr('soloNote', p.right, p.cards.length), delay: 1400 });
    }
    function deckOut() {
      setPhase('won');
      if (coop) { const p = P(); g.over(solo ? p.right : p.cards.length, { title: tr('heardAll'), note: tr(solo ? 'heardAllNote' : 'teamNote', p.cards.length), win: true, delay: 1600, ...(team ? { name: crewName() } : {}) }); return; }
      const best = Math.max(...players.map((x) => x.cards.length));
      const top = players.filter((x) => x.cards.length === best);
      const board = players.map((x) => `${x.name}: ${x.cards.length}`).join(' · ');
      if (top.length === 1) { win(top[0]); return; }
      g.over(null, { title: tr('tie'), note: board, delay: 1200 });
    }

    // ---------- challenges (Original)
    // a challenger needs a token and a free gap (not the active player's, not one another challenger took)
    const canStillChallenge = (q) => q !== P() && q.tokens > 0 && !challenges.some((c) => c.p === q) && P().cards.length - challenges.length > 0;
    function startChallenge(q) { challenger = q; cGap = null; setPhase('cpick'); g.sfx('coin'); }
    function lockChallenge() {
      if (phase !== 'cpick' || cGap == null) return;
      challenger.tokens--;
      challenges.push({ p: challenger, slot: cGap });
      challenger = null; cGap = null;
      g.sfx('drop');
      if (players.some(canStillChallenge)) setPhase('challenge'); else reveal();
    }

    // ---------- pause: the shell's pause card shows what's playing — mask it while the song is a mystery
    const mystery = () => (phase === 'bingo' ? !!bingo?.mystery() : ['load', 'guess', 'fail', 'challenge', 'cpick'].includes(phase) || (phase === 'reveal' && phaseT < 0.5));

    // ---------- names (setup)
    async function rename(i) {
      const v = await editText({ title: tr('player', i + 1), value: names[i], placeholder: tr('player', i + 1), okLabel: he ? 'שמירה' : 'Save' });
      if (v === null || destroyed) return;
      names[i] = v.trim().slice(0, 14) || tr('player', i + 1);
    }
    function toggleLang(id) {
      const on = prefs.langs.includes(id);
      if (on && prefs.langs.length === 1) { g.sfx('tick'); return; }   // at least one language
      const langs = on ? prefs.langs.filter((x) => x !== id) : [...prefs.langs, id];
      prefs = { ...prefs, langs: SONG_LANGS.map((l) => l.id).filter((x) => langs.includes(x)) };
      saveDeckPrefs({ langs: prefs.langs });
    }
    function toggleGenre(id) {
      const blocked = prefs.blocked.includes(id) ? prefs.blocked.filter((x) => x !== id) : [...prefs.blocked, id];
      prefs = { ...prefs, blocked };
      saveDeckPrefs({ blocked });
    }
    function runUpdate() {
      if (upd.state === 'run' && upd.ctrl) return;
      const ctrl = new AbortController();
      upd = { state: 'run', i: 0, n: 1, label: '', added: 0, msg: '', ctrl };
      updateSongs({
        signal: ctrl.signal,
        onProgress: ({ i, n, bucket, added }) => {
          if (upd.ctrl !== ctrl) return;
          upd.i = i; upd.n = n; upd.added = added;
          upd.label = !bucket ? '' : bucket.kind === 'he' ? tr('updHe') : bucket.kind === 'il' ? tr('updIl') : tr('updDecade', bucket.label);
        },
      }).then((r) => {
        if (upd.ctrl !== ctrl) return;
        upd = { state: 'done', i: 1, n: 1, label: '', added: r.added, msg: '', ctrl: null };
        g.sfx(r.added ? 'score' : 'tick');
      }).catch((e) => {
        if (upd.ctrl !== ctrl) return;
        upd = ctrl.signal.aborted ? { state: 'idle', i: 0, n: 1, label: '', added: 0, msg: '', ctrl: null }
          : { state: 'err', i: 0, n: 1, label: '', added: 0, msg: tr('updErr'), ctrl: null };
      });
    }

    // ------------------------------------------------------------------ input
    // the mystery record (smaller and higher in Expert, which needs room for the year picker)
    const recPos = () => (rules === 'expert' ? { x: g.cx, y: g.cy - g.R * 0.26, r: g.R * 0.13 } : { x: g.cx, y: g.cy - g.R * 0.165, r: g.R * 0.18 });

    g.on('down', (p) => {
      const b = U.hit(p.x, p.y);
      if (b) { U.pressed = { b, x: p.x, y: p.y }; return; }
      if (phase === 'guess') {
        const rp = recPos();
        if (Math.hypot(p.x - rp.x, p.y - rp.y) < rp.r * 1.15) { drag = { kind: 'rec', x: p.x, y: p.y, x0: p.x, y0: p.y }; return; }
        if (p.r > 0.47) { drag = { kind: 'ring' }; setGhost(slotAt(p.a)); return; }
      }
      if (phase === 'cpick' && p.r > 0.42) { drag = { kind: 'cring' }; setCGap(freeGapAt(p.a)); return; }
      if (phase === 'pick' && playlists?.length) { drag = { kind: 'list', y0: p.y, s0: plScroll, moved: false }; return; }
      if (phase === 'bingo' && bingo?.down(p)) { drag = { kind: 'bingo' }; return; }
      U.pressed = { b: null, x: p.x, y: p.y };
    });
    g.on('move', (p) => {
      if (!drag) return;
      if (drag.kind === 'rec') { drag.x = p.x; drag.y = p.y; if (p.r > 0.42) setGhost(slotAt(p.a)); }
      else if (drag.kind === 'ring' && p.r > 0.3) setGhost(slotAt(p.a));
      else if (drag.kind === 'cring' && p.r > 0.3) setCGap(freeGapAt(p.a));
      else if (drag.kind === 'bingo') bingo?.move(p);
      else if (drag.kind === 'list') { const rowH = g.R * 0.15; const d = (p.y - drag.y0) / rowH; if (Math.abs(d) > 0.15) drag.moved = true; plScroll = clamp(drag.s0 - d, 0, Math.max(0, playlists.length - 5)); }
    });
    g.on('up', (p) => {
      const d = drag; drag = null;
      if (d?.kind === 'rec') {
        const moved = Math.hypot(p.x - d.x0, p.y - d.y0) > g.R * 0.05;
        if (moved && ghost != null) g.sfx('drop');
        if (!moved) { hint = ghost == null ? 'hintDrag' : 'hintLock'; hintT = 2; }
        return;
      }
      if (d?.kind === 'ring' || d?.kind === 'cring') return;
      if (d?.kind === 'bingo') { bingo?.up(p); return; }
      if (d?.kind === 'list') {
        if (!d.moved) { const row = listRowAt(p.y); if (row != null) { plSel = row; pickPlaylist(playlists[row]); g.sfx('click'); } }
        return;
      }
      const pr = U.pressed; U.pressed = null;
      if (!pr) return;
      if (pr.b) { const b = U.hit(p.x, p.y); if (b && b.id === pr.b.id) { g.sfx('click'); b.fn(); } return; }
      if (Math.hypot(p.x - pr.x, p.y - pr.y) < g.R * 0.08) tapScreen(p);
    });
    g.on('wheel', (e) => key(e.delta > 0 ? 'ArrowRight' : 'ArrowLeft'));
    g.on('key', (e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) return; key(e.key); });   // arrows may auto-repeat, Enter may not
    function tapScreen(p) {
      if (phase === 'handoff' && phaseT > 0.35) loadNext();
      else if (phase === 'reveal') finishReveal();
      else if (phase === 'bingo') bingo?.tap(p);
    }
    function setGhost(i) {
      if (phase !== 'guess') return;
      if (i !== ghost) { ghost = i; syncView(); g.sfx('tick'); if (rules === 'expert' && !yearTouched) yearGuess = defaultYear(); }
    }
    function setCGap(s) { if (s != null && s !== cGap) { cGap = s; g.sfx('tick'); } }
    /** Expert: the year picker starts between the neighbours of the chosen gap. */
    function defaultYear() {
      const c = P().cards, lo = c[ghost - 1]?.s.y, hi = c[ghost]?.s.y;
      if (lo != null && hi != null) return Math.round((lo + hi) / 2);
      if (lo != null) return Math.min(new Date().getFullYear(), lo + 5);
      if (hi != null) return hi - 5;
      return 1990;
    }
    function nudgeYear(d) { yearGuess = clamp((yearGuess ?? defaultYear()) + d, 1900, new Date().getFullYear()); yearTouched = true; g.sfx('tick'); }
    function key(k) {
      const btns = U.list.filter((b) => !b.disabled && !b.noFocus);
      const later = k === (he ? 'ArrowLeft' : 'ArrowRight');   // newer songs sit to the left in Hebrew
      if (phase === 'bingo') { if (bingo?.key(k, btns)) return; }
      if (phase === 'guess') {
        if (k === 'ArrowLeft' || k === 'ArrowRight') {
          U.focus = null;
          const n = P().cards.length;
          if (ghost == null) setGhost(later ? Math.ceil(n / 2) : Math.floor(n / 2));
          else setGhost(clamp(ghost + (later ? 1 : -1), 0, n));
          return;
        }
        if ((k === 'ArrowUp' || k === 'ArrowDown') && rules === 'expert' && ghost != null) { nudgeYear(k === 'ArrowUp' ? 1 : -1); return; }
        if (k === 'ArrowUp' || k === 'ArrowDown') { U.cycleFocus(btns.filter((b) => b.id !== 'lock'), k === 'ArrowDown' ? 1 : -1); return; }
        if (k === 'Enter' || k === ' ') { const f = btns.find((b) => b.id === U.focus); if (f) { g.sfx('click'); f.fn(); } else lockIn(); }
        return;
      }
      if (phase === 'cpick' && (k === 'ArrowLeft' || k === 'ArrowRight')) {
        const n = P().cards.length, dir = later ? 1 : -1;
        let s = cGap == null ? (dir > 0 ? -1 : n + 1) : cGap;
        for (let i = 0; i <= n + 1; i++) { s += dir; if (s >= 0 && s <= n && gapFree(s)) { setCGap(s); break; } }
        return;
      }
      if (phase === 'cpick' && (k === 'Enter' || k === ' ') && !U.focus && cGap != null) { lockChallenge(); return; }
      if (phase === 'pick' && playlists?.length) {
        if (k === 'ArrowDown' || k === 'ArrowRight') plSel = Math.min(playlists.length - 1, plSel + 1);
        else if (k === 'ArrowUp' || k === 'ArrowLeft') plSel = Math.max(0, plSel - 1);
        else if (k === 'Enter' || k === ' ') pickPlaylist(playlists[plSel]);
        plScroll = clamp(plScroll, plSel - 4, plSel);
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) { U.cycleFocus(btns, later || k === 'ArrowDown' ? 1 : -1); return; }
      if (k === 'Enter' || k === ' ') {
        const f = btns.find((b) => b.id === U.focus) || btns.find((b) => b.primary);
        if (f) { g.sfx('click'); f.fn(); } else tapScreen(null);
      }
    }

    // ------------------------------------------------------------------ drawing
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
      if (phase === 'guess' || phase === 'handoff' || phase === 'cpick') {
        // older at the upper left end, newer at the upper right (mirrored in Hebrew)
        const [ex, ey] = polar(g.cx, g.cy, (M > 0 ? 302 : 58) * DEG, ARC());
        const [lx, ly] = polar(g.cx, g.cy, (M > 0 ? 58 : 302) * DEG, ARC());
        text(tr('older'), ex + M * g.R * 0.02, ey - L.h * 0.5 - g.R * 0.05, g.R * 0.034, { color: THEME.dim, weight: 700 });
        text(tr('newer'), lx - M * g.R * 0.02, ly - L.h * 0.5 - g.R * 0.05, g.R * 0.034, { color: THEME.dim, weight: 700 });
      }
      ctx.save(); if (dim) ctx.globalAlpha = 1 - dim;
      for (const c of p.cards) {
        const [x, y] = polar(g.cx, g.cy, c.a, ARC());
        const pop = ease.back(Math.min(1, c.born));
        yearCard(x, y, c.w * pop, c.h * pop, c.s);
      }
      ctx.restore();
      const pc = team ? crew[turn]?.color || color() : P().color && !solo ? P().color : color();
      if (ghost != null && ['guess', 'reveal', 'challenge', 'cpick'].includes(phase)) {
        const [x, y] = polar(g.cx, g.cy, gh.a, ARC());
        const s = ease.out(gh.k), w = gh.w * s, h = gh.h * s;
        if (phase === 'guess') {
          const pulse = 0.5 + 0.5 * Math.sin(g.time * 5);
          ctx.save();
          ctx.setLineDash([g.R * 0.02, g.R * 0.014]); ctx.lineDashOffset = -g.time * 30;
          g.draw.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.16, g.draw.alpha(color(), 0.16 + 0.1 * pulse), { stroke: color(), lw: Math.max(2, g.R * 0.009) });
          ctx.restore();
          text('?', x, y, Math.min(w, h) * 0.45, { color: color(), weight: 800 });
        } else if (phase === 'challenge' || phase === 'cpick') {
          g.draw.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.16, g.draw.alpha(pc, 0.85));
          text('?', x, y, Math.min(w, h) * 0.45, { color: INK_DARK, weight: 800 });
        } else {
          g.draw.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.16, null, { stroke: rv?.place ? THEME.ok : THEME.danger, lw: Math.max(2, g.R * 0.009) });
        }
      }
      // challengers' tokens on the gaps they chose
      if (challenges.length || (phase === 'cpick' && cGap != null)) {
        const list = [...challenges.map((c) => ({ ...c, set: true })), ...(phase === 'cpick' && cGap != null ? [{ p: challenger, slot: cGap, set: false }] : [])];
        for (const c of list) {
          const a = gapAngle(c.slot);
          const [x, y] = polar(g.cx, g.cy, a, ARC() - L.h * 0.5 - g.R * 0.045);
          const r = g.R * 0.032 * (c.set ? 1 : 1 + 0.12 * Math.sin(g.time * 6));
          ctx.save();
          const [x2, y2] = polar(g.cx, g.cy, a, ARC() - L.h * 0.5 + g.R * 0.015);
          ctx.strokeStyle = c.p.color; ctx.lineWidth = g.R * 0.008; ctx.lineCap = 'round'; ctx.globalAlpha = 0.8;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
          g.draw.circle(x, y, r * 1.25, c.p.color);
          coin(x, y, r * 0.8);
          if (phase === 'reveal' && phaseT > 0.9) {
            const ok = correctSlot(P(), song.y, c.slot);
            g.draw.circle(x + r, y - r, r * 0.6, ok ? THEME.ok : THEME.danger);
            text(ok ? '✓' : '✕', x + r, y - r + r * 0.03, r * 0.7, { color: INK_DARK, weight: 800 });
          }
        }
      }
    }
    /** The marker where a wrongly placed song really belongs. */
    function drawCorrectMarker(alpha) {
      const p = P(); if (!rv || rv.place) return;
      const cards = p.cards;
      const ang = (i) => (cards[i] ? cards[i].a : null);
      let a;
      const c = rv.correct;
      const left = ang(c - 1), right = ang(c);
      const half = layout(cards.length + 1).step * 0.5;
      if (left != null && right != null) a = left + angDiff(left, right) / 2;
      else if (left != null) a = left - M * half * 1.15; else if (right != null) a = right + M * half * 1.15; else return;
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
      if (line1) text(fit(line1, g.R * 1.2, g.R * 0.072, 800), g.cx, g.cy - g.R * 0.705, g.R * 0.072, { color: col, weight: 800 });
      if (line2) text(fit(line2, g.R * 1.3, g.R * 0.04, 700), g.cx, g.cy - g.R * 0.605, g.R * 0.04, { color: THEME.muted, weight: 700 });
    }
    const hearts = (p) => `${'♥'.repeat(Math.max(0, SOLO_LIVES - p.misses))}${'♡'.repeat(Math.min(SOLO_LIVES, p.misses))}`;
    function playerHud(extra) {
      const p = P();
      const name = solo ? tr('soloStreak') : team ? turnName() : p.name;
      const sub = solo ? tr('placedHearts', p.right, hearts(p)) : team ? tr('teamOf', p.cards.length, goal, hearts(p)) : tr('cardsOf', p.cards.length, goal);
      hud(name, extra ?? sub, solo ? THEME.fg : color());
      // tokens under the name
      if (useTokens && p.tokens > 0) coins(g.cx, g.cy - g.R * 0.535, p.tokens, g.R * 0.021);
    }

    // ------------------------------------------------------------------ screens
    const eraName = () => {
      const deckKey = { all: 'eraAll', il: 'eraIl', old: 'eraOld', new: 'eraNew', lib: 'eraLib' }[opts.deck] || 'eraAll';
      return tr(pid === 'demo' && opts.deck !== 'lib' ? 'eraDemo' : deckKey);
    };
    function drawSetup() {
      const title = solo ? tr('soloStreak') : team ? tr('whosTeam') : tr('whosPlaying');
      text(fit(title, g.R * 1.2, g.R * 0.075, 800), g.cx, g.cy - g.R * 0.7, g.R * 0.075, { weight: 800 });
      const era = eraName();
      const sub = solo ? tr('soloSub', era) : team ? tr('teamSub', era, goal) : kind === 'bingo' ? tr('bingoSub', era) : tr('partySub', era, goal);
      text(fit(sub, g.R * 1.25, g.R * 0.038, 700), g.cx, g.cy - g.R * 0.6, g.R * 0.038, { color: THEME.muted, weight: 700 });
      if (solo) {
        U.para(tr('soloPara'), g.cx, g.cy - g.R * 0.44, g.R * 1.15, g.R * 0.048, { lines: 3 });
        record(g.cx, g.cy - g.R * 0.13, g.R * 0.085, g.color, spin);
      } else {
        const n = names.length;
        const slots = n < 6 ? n + 1 : n;
        // the rows sit in the middle of the space for four rows
        const colW = g.R * 0.62, rowH = g.R * 0.12, top = g.cy - g.R * 0.47 + (4 - Math.ceil(slots / 2)) * rowH * 0.5;
        for (let i = 0; i < slots; i++) {
          const col = i % 2, row = Math.floor(i / 2);
          // player 1 in the left column (the right one in Hebrew); the colour dot leads, the × trails
          const x = g.cx + M * (col ? 1 : -1) * colW * 0.54, y = top + row * rowH;
          if (i < n) {
            const c = PLAYER_COLORS[i];
            button(`p${i}`, '', x, y, colW, rowH * 0.8, () => rename(i), { col: c });
            g.draw.ball(x - M * colW * 0.38, y, rowH * 0.18, c);
            text(fit(names[i], colW * 0.52, rowH * 0.32, 700), x - M * colW * 0.06, y + rowH * 0.01, rowH * 0.32, { align: 'center', weight: 700 });
            if (n > minPlayers) {
              button(`x${i}`, '', x + M * colW * 0.38, y, rowH * 0.52, rowH * 0.52, () => { names.splice(i, 1); U.focus = null; }, { round: true });
              text('×', x + M * colW * 0.38, y - rowH * 0.02, rowH * 0.38, { color: THEME.muted, weight: 700 });
            }
          } else {
            button('add', tr('addPlayer'), x, y, colW, rowH * 0.8, () => { names.push(localName(saved.names[names.length]) || tr('player', names.length + 1)); }, {});
          }
        }
      }
      // song filters: languages, genres + update
      const lib = opts.deck === 'lib';
      const counts = genreCounts(deckSource());
      if (!lib) {
        const langs = SONG_LANGS.filter((l) => l.id !== 'other' || counts.l.other > 0);
        const lw = g.R * (langs.length > 2 ? 0.3 : 0.4), lh = g.R * 0.085, ly = g.cy + g.R * 0.035, gap = g.R * 0.025;
        const label = tr('songLangs');
        const labW = U.measure(label, g.R * 0.034, 700) + g.R * 0.04;
        const total = labW + langs.length * lw + (langs.length - 1) * gap;
        let x = g.cx - M * total / 2;
        text(label, x + M * labW / 2, ly, g.R * 0.034, { color: THEME.muted, weight: 700 });
        x += M * labW;
        langs.forEach((l) => {
          const on = prefs.langs.includes(l.id);
          button(`lang:${l.id}`, `${on ? '✓ ' : ''}${nameOf(l)}`, x + M * lw / 2, ly, lw, lh, () => toggleLang(l.id), { small: true, primary: on, col: g.color, glow: false });
          x += M * (lw + gap);
        });
        const gy = g.cy + g.R * 0.155, gw = g.R * 0.62, uw = g.R * 0.5;
        const nb = prefs.blocked.length;
        button('genres', `♪ ${tr('genres')}: ${nb ? tr('genresOff', nb) : tr('genresAll')}`, g.cx - M * (uw + g.R * 0.03) / 2, gy, gw, lh, () => setPhase('genres'), { small: true });
        button('update', `⟳ ${tr('update')}`, g.cx + M * (gw + g.R * 0.03) / 2, gy, uw, lh, () => { setPhase('update'); }, { small: true });
      } else {
        text(fit(tr('plFrom', svcName()), g.R * 1.2, g.R * 0.04, 700), g.cx, g.cy + g.R * 0.09, g.R * 0.04, { color: THEME.muted, weight: 700 });
      }
      const iy = g.cy + g.R * 0.27;
      button('intro', saved.skipIntro ? tr('skipIntro') : tr('fromStart'), g.cx, iy, g.R * 0.9, g.R * 0.075, () => save({ skipIntro: !saved.skipIntro }), { small: true });
      const nSongs = songCount();
      const few = nSongs < MIN_SONGS;
      if (!lib) text(few ? tr('tooFew') : tr('nSongs', nSongs), g.cx, g.cy + g.R * 0.36, g.R * 0.034, { color: few ? THEME.danger : THEME.dim, weight: 700 });
      button('start', tr('start'), g.cx, g.cy + g.R * 0.48, g.R * 0.46, g.R * 0.13, begin, { primary: true, col: g.color, disabled: few });
      // language switch: EN | עב (the same setting as Settings → Rhythm → Hitster language)
      const lw = g.R * 0.15, lh = g.R * 0.072, ly = g.cy + g.R * 0.67;
      g.draw.roundRect(g.cx - lw - g.R * 0.012, ly - lh / 2 - g.R * 0.012, lw * 2 + g.R * 0.024, lh + g.R * 0.024, lh / 2 + g.R * 0.012, THEME.glass);
      button('ui-en', 'EN', g.cx - lw / 2, ly, lw, lh, () => store.set('hitsterLang', 'en'), { small: true, primary: !he, col: g.color });
      button('ui-he', 'עב', g.cx + lw / 2, ly, lw, lh, () => store.set('hitsterLang', 'he'), { small: true, primary: he, col: g.color });
    }
    /** Genres sheet: chips to block genres (with how many songs each has in this deck). */
    const GENRE_ROWS = [2, 3, 3, 3, 3, 2];
    function drawGenres() {
      text(tr('genres'), g.cx, g.cy - g.R * 0.7, g.R * 0.075, { weight: 800 });
      text(fit(tr('genresHint'), g.R * 1.25, g.R * 0.034, 700), g.cx, g.cy - g.R * 0.605, g.R * 0.034, { color: THEME.muted, weight: 700 });
      const counts = genreCounts(deckSource()).g;
      const cw = g.R * 0.5, ch = g.R * 0.098, gap = g.R * 0.022, rowH = g.R * 0.126, top = g.cy - g.R * 0.48;
      let gi = 0;
      GENRE_ROWS.forEach((n, row) => {
        const y = top + row * rowH;
        for (let j = 0; j < n && gi < GENRES.length; j++, gi++) {
          const gen = GENRES[gi];
          const x = g.cx + M * (j - (n - 1) / 2) * (cw + gap);
          const off = prefs.blocked.includes(gen.id);
          const cnt = counts[gen.id] || 0;
          button(`g:${gen.id}`, '', x, y, cw, ch, () => toggleGenre(gen.id), off ? { fill: THEME.paper(0.12), stroke: THEME.ink(0.18) } : { primary: true, col: g.color, glow: false });
          const label = nameOf(gen);
          const ink = off ? THEME.dim : INK_DARK;
          const ts = ch * 0.34;
          const lab = fit(label, cw * 0.7, ts, 800);
          text(lab, x - M * cw * 0.05, y + ch * 0.02, ts, { color: ink, weight: 800 });
          if (off) {   // struck through
            const w = U.measure(lab, ts, 800);
            ctx.save(); ctx.strokeStyle = THEME.danger; ctx.lineWidth = Math.max(1.5, g.R * 0.005);
            ctx.beginPath(); ctx.moveTo(x - M * cw * 0.05 - w / 2, y); ctx.lineTo(x - M * cw * 0.05 + w / 2, y); ctx.stroke(); ctx.restore();
          }
          text(off ? '⊘' : String(cnt), x + M * cw * 0.385, y + ch * 0.02, ch * (off ? 0.4 : 0.28), { color: off ? THEME.danger : 'rgba(10,10,11,.55)', weight: 800 });
        }
      });
      const nSongs = songCount(), few = nSongs < MIN_SONGS;
      text(few ? tr('tooFew') : tr('nSongs', nSongs), g.cx, g.cy + g.R * 0.31, g.R * 0.036, { color: few ? THEME.danger : THEME.muted, weight: 700 });
      button('done', tr('done'), g.cx, g.cy + g.R * 0.44, g.R * 0.42, g.R * 0.12, () => setPhase('setup'), { primary: true, col: g.color });
      button('allow', tr('allowAll'), g.cx, g.cy + g.R * 0.6, g.R * 0.4, g.R * 0.075, () => { prefs = { ...prefs, blocked: [] }; saveDeckPrefs({ blocked: [] }); }, { small: true, disabled: !prefs.blocked.length });
    }
    /** Update sheet: fetch more songs from Wikidata (kept for good), with progress and the result. */
    function drawUpdate() {
      text(fit(tr('updTitle'), g.R * 1.2, g.R * 0.068, 800), g.cx, g.cy - g.R * 0.66, g.R * 0.068, { weight: 800 });
      U.para(tr('updHint'), g.cx, g.cy - g.R * 0.53, g.R * 1.2, g.R * 0.04, { lines: 3, color: THEME.muted, weight: 600 });
      // the ring: songs in the deck, filling while an update runs
      const cy = g.cy - g.R * 0.08, r = g.R * 0.2;
      const frac = upd.state === 'run' ? clamp((upd.i + 0.5 * (0.5 + 0.5 * Math.sin(g.time * 3))) / Math.max(1, upd.n), 0, 1) : upd.state === 'done' ? 1 : 0;
      g.draw.circle(g.cx, cy, r, null, { stroke: THEME.ink(0.12), lw: g.R * 0.03 });
      if (frac > 0) g.draw.arc(g.cx, cy, r, 0, TAU * frac, g.color, g.R * 0.03);
      const total = builtinCount() + extraCount();
      text(String(total), g.cx, cy - g.R * 0.02, g.R * 0.1, { weight: 800 });
      text(tr('songs'), g.cx, cy + g.R * 0.075, g.R * 0.034, { color: THEME.muted, weight: 700 });
      if (upd.state === 'run') {
        if (upd.ctrl) g.draw.arc(g.cx, cy, r + g.R * 0.045, g.time * 4, g.time * 4 + 0.9, g.draw.alpha(g.color, 0.6), g.R * 0.01);
        text(fit(tr('updBusy', upd.label || '…'), g.R * 1.1, g.R * 0.04, 700), g.cx, g.cy + g.R * 0.2, g.R * 0.04, { color: THEME.fg, weight: 700 });
        if (upd.added) text(tr('updDone', upd.added), g.cx, g.cy + g.R * 0.27, g.R * 0.036, { color: THEME.ok, weight: 800 });
      } else if (upd.state === 'done') {
        text(tr('updDone', upd.added), g.cx, g.cy + g.R * 0.21, g.R * 0.06, { color: upd.added ? THEME.ok : THEME.fg, weight: 800 });
      } else if (upd.state === 'err') {
        U.para(upd.msg, g.cx, g.cy + g.R * 0.19, g.R * 1.1, g.R * 0.036, { lines: 2, color: THEME.danger, weight: 700 });
      } else {
        const info = extraInfo();
        text(tr('updCount', builtinCount(), extraCount()), g.cx, g.cy + g.R * 0.19, g.R * 0.038, { color: THEME.fg, weight: 700 });
        text(info.lastUpdated ? tr('updLast', new Date(info.lastUpdated).toLocaleDateString(he ? 'he' : [], { day: 'numeric', month: 'short', year: 'numeric' })) : tr('updNever'),
          g.cx, g.cy + g.R * 0.26, g.R * 0.034, { color: THEME.dim, weight: 700 });
      }
      const running = upd.state === 'run';
      if (running) button('ucancel', tr('cancel'), g.cx, g.cy + g.R * 0.42, g.R * 0.4, g.R * 0.11, () => { upd.ctrl?.abort(); }, { disabled: !upd.ctrl });
      else button('urun', upd.state === 'done' ? tr('updAgain') : tr('updRun'), g.cx, g.cy + g.R * 0.42, g.R * 0.52, g.R * 0.12, runUpdate, { primary: true, col: g.color, small: true });
      button('uback', tr('back'), g.cx, g.cy + g.R * 0.59, g.R * 0.36, g.R * 0.08, () => { if (upd.state !== 'run') upd.state = 'idle'; setPhase('setup'); }, { small: true });
    }
    function listRowAt(y) {
      if (!playlists?.length) return null;
      const rowH = g.R * 0.15, top = g.cy - g.R * 0.3;
      const i = Math.round((y - top) / rowH + plScroll);
      const first = Math.floor(plScroll);
      return i >= first && i < Math.min(playlists.length, first + 5) ? i : null;
    }
    function drawPick() {
      text(tr('pickPl'), g.cx, g.cy - g.R * 0.62, g.R * 0.08, { weight: 800 });
      text(tr('plFrom', svcName()), g.cx, g.cy - g.R * 0.51, g.R * 0.04, { color: THEME.muted, weight: 700 });
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
      button('list', tr('useList'), g.cx, g.cy + g.R * 0.66, g.R * 0.7, g.R * 0.085, () => {
        loadToken++;
        const pool = pid === 'demo' ? buildPool({ demo: true, prefs }) : buildPool({ deck: 'all', prefs });
        buildDeck(pool.length >= MIN_SONGS ? pool : pid === 'demo' ? DEMO_SONGS : buildPool({ deck: 'all', prefs: { langs: ['en', 'he', 'other'], blocked: [] } }));
        startGame();
      }, { small: true });
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
      const col = color();
      g.draw.circle(g.cx, y, r, col, { glow: g.R * 0.08 });
      text(tr('nextUp'), g.cx, y - r * 0.42, r * 0.17, { color: 'rgba(10,10,11,.65)', weight: 800 });
      text(fit(turnName(), r * 1.6, r * 0.34, 800), g.cx, y + r * 0.04, r * 0.34, { color: INK_DARK, weight: 800 });
      text(team ? tr('teamOf', p.cards.length, goal, hearts(p)) : tr('ofGoal', p.cards.length, goal), g.cx, y + r * 0.45, r * (team ? 0.13 : 0.16), { color: 'rgba(10,10,11,.65)', weight: 800 });
      // scoreboard (Team: the team's tokens)
      const y2 = g.cy + g.R * 0.27;
      if (team) {
        if (p.tokens > 0) coins(g.cx, y2 - g.R * 0.065, p.tokens, g.R * 0.026);
        const n = crew.length, gap = g.R * 0.2;
        crew.forEach((q, i) => {
          const x = g.cx + M * (i - (n - 1) / 2) * gap, me = i === turn;
          g.draw.circle(x, y2, g.R * (me ? 0.022 : 0.016), q.color, { stroke: me ? THEME.fg : null, lw: g.R * 0.006 });
          text(fit(q.name, gap * 0.92, g.R * 0.028, 700), x, y2 + g.R * 0.05, g.R * 0.028, { color: me ? THEME.fg : THEME.muted, weight: 700 });
        });
      } else {
        const n = players.length, gap = g.R * 0.24;
        players.forEach((q, i) => {
          const x = g.cx + M * (i - (n - 1) / 2) * gap;
          const me = i === cur;
          g.draw.circle(x, y2, g.R * (me ? 0.06 : 0.05), q.color, { stroke: me ? THEME.fg : null, lw: g.R * 0.008 });
          text(String(q.cards.length), x, y2 + g.R * 0.003, g.R * 0.05, { color: INK_DARK, weight: 800 });
          text(fit(q.name, gap * 0.92, g.R * 0.03, 700), x, y2 + g.R * 0.095, g.R * 0.03, { color: me ? THEME.fg : THEME.muted, weight: 700 });
          if (useTokens && q.tokens > 0) {   // tokens: a coin and the count
            coin(x - g.R * 0.022, y2 - g.R * 0.078, g.R * 0.014);
            text(`×${q.tokens}`, x + g.R * 0.014, y2 - g.R * 0.077, g.R * 0.026, { color: THEME.muted, weight: 800, dir: 'ltr' });
          }
        });
      }
      const blink = 0.55 + 0.45 * Math.sin(g.time * 3.5);
      // buy a card with 3 tokens (Original and Team)
      if (useTokens && !solo && p.tokens >= BUY_COST) {
        const bw = g.R * 0.52, bh = g.R * 0.085, by = g.cy - g.R * 0.485;
        button('buy', '', g.cx, by, bw, bh, buyCard, { small: true, col: '#ffc857' });
        const lab = `${tr('buy')} · ${BUY_COST}`, ts = bh * 0.4;
        const lw = U.measure(lab, ts, 800);
        text(lab, g.cx - M * g.R * 0.02, by + bh * 0.02, ts, { weight: 800 });
        coin(g.cx - M * g.R * 0.02 + M * (lw / 2 + g.R * 0.03), by, g.R * 0.016);
      }
      text(tr('tapPlay'), g.cx, g.cy + g.R * 0.44, g.R * 0.042, { color: THEME.muted, alpha: blink, weight: 700 });
    }
    function drawLoad() {
      const rp = recPos();
      record(rp.x, rp.y, rp.r, color(), spin * 0.35);
      text(tr(loadMsg, svcName()), g.cx, g.cy + g.R * 0.18, g.R * 0.045, { color: THEME.muted, weight: 700 });
    }
    function drawFail() {
      const rp = recPos();
      ctx.save(); ctx.globalAlpha = 0.45; record(rp.x, rp.y, rp.r, color(), 0); ctx.restore();
      const n = U.para(failMsg, g.cx, g.cy + g.R * 0.13, g.R * 1.1, g.R * 0.045, { lines: 3, lh: 1.45 });
      const y = g.cy + g.R * 0.13 + n * g.R * 0.065 + g.R * 0.07;
      button('retry', tr('retry'), g.cx - M * g.R * 0.215, y, g.R * 0.4, g.R * 0.11, () => { failCount = 0; loadNext(true); }, { primary: true });
      button('another', tr('another'), g.cx + M * g.R * 0.215, y, g.R * 0.4, g.R * 0.11, () => { failCount = 0; skipSong(true); }, {});
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
      button('lock', ghost == null ? tr('pickSpot') : tr('lockIn'), g.cx, by, g.R * 0.44, g.R * 0.13, lockIn, { primary: true, disabled: ghost == null || (rules === 'expert' && yearGuess == null) });
      const y2 = g.cy + g.R * 0.375;
      if (useTokens) {
        const knewLabel = earnTokens ? tr('knew') : tr('named');
        button('knew', claimed ? `✓ ${knewLabel}` : knewLabel, g.cx - M * g.R * 0.215, y2, g.R * 0.4, g.R * 0.095, () => { claimed = !claimed; if (claimed) g.sfx('coin'); }, { small: true, col: '#ffc857', primary: claimed });
        // Skip costs a token: the label with a coin after it (before it, on the left, in Hebrew)
        const sx = g.cx + M * g.R * 0.215;
        button('skip', '', sx, y2, g.R * 0.4, g.R * 0.095, () => skipSong(false), { small: true, disabled: p.tokens <= 0 });
        const sl = tr('skip'), ss = g.R * 0.095 * 0.4;
        const sw = U.measure(sl, ss, 800), cw = g.R * 0.017 * 2 + g.R * 0.012;
        text(sl, sx - M * cw / 2, y2 + g.R * 0.002, ss, { color: THEME.fg, weight: 800, alpha: p.tokens > 0 ? 1 : 0.45 });
        ctx.save(); ctx.globalAlpha = p.tokens > 0 ? 1 : 0.45;
        coin(sx - M * cw / 2 + M * (sw / 2 + g.R * 0.012 + g.R * 0.017), y2, g.R * 0.017); ctx.restore();
      }
      // Expert: the exact year
      if (rules === 'expert' && ghost != null) {
        const yy = g.cy + g.R * 0.065, bs = g.R * 0.075;
        if (yearGuess == null) yearGuess = defaultYear();
        text(tr('yearQ'), g.cx, yy - g.R * 0.065, g.R * 0.03, { color: THEME.muted, weight: 700 });
        text(String(yearGuess), g.cx, yy, g.R * 0.056, { weight: 800, color: yearTouched ? THEME.fg : THEME.muted });
        // minus on the left, plus on the right in both languages (a number line)
        for (const [d, dx] of [[-5, -0.31], [-1, -0.2], [1, 0.2], [5, 0.31]]) button(`yr${d}`, d > 0 ? `+${d}` : `−${-d}`, g.cx + dx * g.R, yy, bs, bs, () => nudgeYear(d), { round: true, small: true, dir: 'ltr' });
      }
      // the service may not be playing it: offer a free redraw
      const t = player.state.track;
      const trouble = guessT > 9 && (!player.state.isPlaying || (t && !isThisSong(t, song) && !song.item));
      const lowY = g.cy + g.R * (useTokens ? 0.475 : 0.36);
      if (trouble) button('np', tr('notPlaying'), g.cx, lowY, g.R * 0.62, g.R * 0.07, () => skipSong(true), { small: true });
      else if (hintT > 0) text(tr(hint), g.cx, lowY + g.R * 0.015, g.R * 0.034, { color: THEME.muted, weight: 700 });
      else if (guessT < 6 && ghost == null) text(tr('dragRec'), g.cx, lowY + g.R * 0.015, g.R * 0.034, { color: THEME.dim, weight: 700 });
    }
    /** HITSTER! — the others may challenge the placement with a token. */
    function drawChallenge() {
      hud(tr('hitster'), tr('challengeQ'), THEME.light ? '#c98a00' : '#ffc857');
      const list = players.filter(canStillChallenge);
      const cw = g.R * 0.4, ch = g.R * 0.11, gap = g.R * 0.03;
      const perRow = list.length > 3 ? Math.ceil(list.length / 2) : list.length;
      const y0 = g.cy - g.R * (list.length > 3 ? 0.39 : 0.3);
      list.forEach((q, i) => {
        const row = Math.floor(i / Math.max(1, perRow)), col = i % Math.max(1, perRow);
        const n = Math.min(perRow, list.length - row * perRow);
        const x = g.cx + M * (col - (n - 1) / 2) * (cw + gap), y = y0 + row * (ch + gap);
        button(`ch${players.indexOf(q)}`, '', x, y, cw, ch, () => startChallenge(q), { col: q.color, fill: g.draw.alpha(q.color, 0.9) });
        text(fit(q.name, cw * 0.6, ch * 0.36, 800), x - M * cw * 0.1, y, ch * 0.36, { color: INK_DARK, weight: 800 });
        coin(x + M * cw * 0.3, y, ch * 0.2);
        text(String(q.tokens), x + M * cw * 0.3, y + ch * 0.01, ch * 0.22, { color: 'rgba(120,80,0,.9)', weight: 800 });
      });
      if (!list.length) text(tr('tokenNone'), g.cx, g.cy - g.R * 0.3, g.R * 0.04, { color: THEME.dim, weight: 700 });
      // who already challenged
      challenges.forEach((c, i) => {
        const x = g.cx + M * (i - (challenges.length - 1) / 2) * g.R * 0.24, y = g.cy - g.R * 0.1;
        g.draw.circle(x - M * g.R * 0.06, y, g.R * 0.02, c.p.color);
        text(fit(c.p.name, g.R * 0.16, g.R * 0.03, 700), x + M * g.R * 0.02, y, g.R * 0.03, { color: THEME.muted, weight: 700 });
      });
      U.para(tr('challengeHint'), g.cx, g.cy + g.R * 0.02, g.R * 1.0, g.R * 0.034, { lines: 2, color: THEME.dim, weight: 700, fam: THEME.display });
      button('reveal', tr('reveal'), g.cx, g.cy + g.R * 0.24, g.R * 0.44, g.R * 0.13, reveal, { primary: true, col: color() });
    }
    function drawCPick() {
      hud(challenger.name, tr('pickGap', challenger.name).replace(`${challenger.name}: `, ''), challenger.color);
      coin(g.cx, g.cy - g.R * 0.53, g.R * 0.022);
      button('clock', tr('lockIn'), g.cx, g.cy + g.R * 0.205, g.R * 0.44, g.R * 0.13, lockChallenge, { primary: true, col: challenger.color, disabled: cGap == null });
      button('ccancel', tr('cancelChallenge'), g.cx, g.cy + g.R * 0.37, g.R * 0.34, g.R * 0.085, () => { challenger = null; cGap = null; setPhase('challenge'); }, { small: true });
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
          text('♪', 0, ay + art / 2, art * 0.4, { color: 'rgba(10,10,11,.4)' });
        }
        const yy = ay + art + h * 0.13;
        text(String(s.y), 0, yy, h * 0.19, { color: INK_DARK, weight: 800 });
        const title = showTitle(s, he);
        const tl = wrap(title, w * 0.86, h * 0.06, 2, 800);
        const td = U.dirFor(title);   // a wrapped title keeps one direction on both lines
        tl.forEach((l, i) => text(l, 0, yy + h * 0.13 + i * h * 0.068, h * 0.06, { color: INK_DARK, weight: 800, dir: td }));
        text(fit(showArtist(s, he), w * 0.86, h * 0.045, 600, THEME.font), 0, yy + h * 0.13 + tl.length * h * 0.068 + h * 0.012, h * 0.045, { color: 'rgba(10,10,11,.66)', weight: 600, font: THEME.font });
      }
      ctx.restore();
    }
    function drawReveal() {
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
        if (rv.claimed && useTokens && earnTokens) g.draw.float(tr('token'), g.cx, g.cy - g.R * 0.5, '#ffc857', g.R * 0.05);
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
          let msg = rv.ok ? tr('right') : tr('wrong'), mcol = rv.ok ? THEME.ok : THEME.danger;
          if (rv.thief) { msg = tr('stole', rv.thief.name); mcol = rv.thief.color; }
          else if (rv.place && !rv.ok) msg = !rv.yearOk ? tr('yearMiss') : tr('nameMiss');
          const mt = fit(msg, g.R * 1.2, g.R * 0.05, 800), mw = U.measure(mt, g.R * 0.05, 800) + g.R * 0.08;
          ctx.save(); ctx.globalAlpha = a; g.draw.roundRect(g.cx - mw / 2, g.cy + g.R * 0.38, mw, g.R * 0.08, g.R * 0.04, THEME.paper(THEME.light ? 0.75 : 0.6)); ctx.restore();
          text(mt, g.cx, g.cy + g.R * 0.42, g.R * 0.05, { color: mcol, weight: 800, alpha: a });
          // the table can overrule a wrong "I knew it!" / "Title + artist" (tapping anywhere else continues)
          if (rv.claimed && useTokens) {
            button('wrongname', tr('wrongName'), g.cx, g.cy + g.R * 0.505, g.R * 0.46, g.R * 0.075, () => { rv.claimed = false; evalReveal(); g.sfx('tick'); }, { small: true });
          } else {
            let sub = tr('tapCont');
            if (challenges.length && rv.place) sub = tr('challengeLost');
            text(sub, g.cx, g.cy + g.R * 0.505, g.R * 0.034, { color: THEME.dim, weight: 700, alpha: a * (sub === tr('tapCont') ? 0.55 + 0.45 * Math.sin(g.time * 3.5) : 1) });
          }
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
      } else if (rv.thief) {   // the card goes to the challenger who got it right
        const x = B.x, y = lerp(B.y, g.cy - g.R * 0.95, e);
        yearCard(x, y, B.w * (1 - 0.6 * e), B.h * (1 - 0.6 * e), song, { alpha: 1 - e * 0.8 });
        text(rv.thief.name, g.cx, g.cy + g.R * 0.42, g.R * 0.05, { color: rv.thief.color, weight: 800, alpha: 1 - e });
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
      syncLang();
      U.list = [];
      const sheet = ['setup', 'pick', 'genres', 'update'].includes(phase);
      g.draw.bg({ glow: 0.13, color: sheet || phase === 'bingo' ? g.color : color() });
      if (phase === 'setup') drawSetup();
      else if (phase === 'genres') drawGenres();
      else if (phase === 'update') drawUpdate();
      else if (phase === 'pick') drawPick();
      else if (phase === 'bingo') bingo?.draw(dt);
      else if (phase === 'won' && kind === 'bingo') bingo?.draw(dt);
      else {
        if (players.length) drawTimeline(dt, { dim: phase === 'reveal' ? 0.25 * clamp(phaseT / 0.35, 0, 1) : 0 });
        if (phase === 'handoff') {
          drawHandoff();
          if (team) hud(tr('teamHud'), tr('everyone'));
          else hud(tr('passDisplay'), tr('onlyPlayer'));
        } else if (phase === 'load') { playerHud(); drawLoad(); }
        else if (phase === 'fail') { playerHud(); drawFail(); }
        else if (phase === 'guess') { playerHud(); drawGuess(dt); }
        else if (phase === 'challenge') drawChallenge();
        else if (phase === 'cpick') drawCPick();
        else if (phase === 'reveal') { playerHud(); drawReveal(); }
        else if (phase === 'settle') { playerHud(); drawSettle(); }
        else if (phase === 'won') {
          const p = P();
          if (p) {
            if (solo) hud(tr('placed', p.right), tr('strikes'));
            else if (team) hud(p.cards.length >= goal ? tr('teamWin') : tr('strikesT'), tr('nCards', p.cards.length), p.cards.length >= goal ? g.color : THEME.fg);
            else hud(tr('wins', p.name), tr('nCards', p.cards.length), p.color);
          }
        }
      }
      U.endFrame();
      g.draw.particles(dt);
      g.draw.floaters(dt);
      if (confetti.length) drawConfetti(dt);
    });

    // test hook (only when a test asks for it): the state, for scripted play
    if (window.__hitsTest) {
      window.__hitsDebug = () => ({
        phase, he, kind, team, solo, rules, cur, turn, ghost, cGap, deckSize: deck.length, prefs,
        song: song && { t: song.t, a: song.a, y: song.y, b: song.b, l: song.l, g: song.g }, names,
        deckTags: deck.map((x) => [x.l || '', (x.g || []).join('/')]),
        players: players.map((p) => ({ name: p.name, tokens: p.tokens, misses: p.misses, right: p.right, years: p.cards.map((c) => c.s.y) })),
        challenges: challenges.map((c) => ({ p: players.indexOf(c.p), slot: c.slot })), rv: rv && { ok: rv.ok, place: rv.place, thief: rv.thief && players.indexOf(rv.thief) },
        upd: { state: upd.state, added: upd.added, i: upd.i, n: upd.n }, buttons: U.list.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, disabled: b.disabled })),
        bingo: bingo?.debug(),
      });
      window.__hitsBingo = () => bingo;
      window.__hitsPlayers = () => players;
    }

    return {
      hideTrack: () => mystery(),   // the shell's pause card hides the song while it's a mystery
      destroy() { destroyed = true; loadToken++; bingo?.destroy?.(); },
    };
  },
};
