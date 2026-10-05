// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Code Words — a word-association team game in the spirit of Codenames (our own name, look and word lists). A 5×5 grid of
// words fills the round display in a "barrel" (wider in the middle rows, so the words stay big inside the circle). Two
// teams, red and blue; the key says which words are red agents (9 for the starting team, 8 for the other), neutral
// bystanders (7) and the one assassin. Each team's spymaster sees the key and gives a one-word clue plus a number; their
// operatives guess up to number + 1 cards (0 or ∞ = as many as they like). A bystander or the other team's agent ends
// the turn, the assassin ends the game. First team to find all its agents wins.
// Modes (the start card):
//   • With phones — spymasters join by QR and see the KEY on their phone (only spymasters; the host can reassign), type
//     the clue on the phone; operatives tap the cards on the display, or vote on their phones ("Guessing: phones").
//     Needs the bridge (bridge/lib/codewords.js).
//   • One device — no bridge: spymasters hold 🔑 to peek at the key on the display, or scan the key QR: a static page
//     (games/phone/codewords-key.html) that rebuilds the key from the game's seed — works on GitHub Pages too.
// Options: English or Hebrew words (right to left), Standard / Kids word sets, categories, your own words (typed here
// or added from phones), an optional turn timer, starting team alternates every new game.
import { TAU, THEME } from './kit.js';
import { h, clear } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { editText } from '../js/ui/keyboard.js';
import { openPanel } from '../js/ui/overlay.js';
import { store } from '../js/core/store.js';
import { bridgeFetch } from '../js/providers/bridge.js';
import { partyLink, qrBox, confetti } from '../apps/party-link.js';
import { gameStore, partyLayer, loadCss, phoneLink, noPhones, orderModes, lite, uid, sameText, HEB } from './petakiot-party.js';
import { CATS, wordPool, counts } from './codewords-words.js';

const ID = 'codewords', COLOR = '#ef4444';
loadCss('codewords.css');
loadCss('petakiot.css');   // the shared party layer styles
const S = gameStore(ID);
const COL = { r: '#e5484d', b: '#3e7bfa', n: '#d9c9a3', a: '#18181b' };
const other = (t) => (t === 'r' ? 'b' : 'r');

// ---- the key: the same algorithm as games/phone/codewords-key.html (keep them in step)
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function makeKey(seed, start) {
  const cells = [...Array(9).fill(start), ...Array(8).fill(other(start)), ...Array(7).fill('n'), 'a'];
  const r = rng(seed);
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  return cells;
}
const gameCode = (seed) => (seed >>> 0).toString(36).toUpperCase();

const DEF = { lang: 'auto', set: 'std', cats: [], custom: 'off', timer: 0, guess: 'display' };
const setup = () => ({ ...DEF, ...S.data('setup', {}) });
const putSetup = (p) => S.save('setup', { ...S.data('setup', {}), ...p });
const lang = () => { const l = setup().lang; return l === 'en' || l === 'he' ? l : store.get('kbdLang') === 'he' ? 'he' : 'en'; };

const TX = {
  en: {
    howTo: 'Two teams, one grid of words. Spymasters give one-word clues; their team guesses which words are theirs — and avoids the assassin.',
    phones: 'With phones', device: 'One device', title: 'Code Words', room: 'Room', scan: 'Scan to join', joinHint: 'Phones: name, team, spymaster or operative',
    red: 'Red', blue: 'Blue', spy: 'Spymaster', ops: 'Operatives', noSpy: 'No spymaster yet', nobody: 'Nobody yet', start: 'Start', settings: 'Settings',
    words: 'Words', guessing: 'Guessing', timer: 'Timer', custom: 'My words', off: 'Off', display: 'On the display', phonesG: 'Phones vote', std: 'Standard', kids: 'Kids',
    localHow: 'One device: the spymasters hold 🔑 to peek at the key (the others look away) — or scan the key QR on their own phone.', starts: '{team} starts',
    turnOf: '{team}’s turn', giveClue: 'Spymaster, give a clue', waitClue: 'Waiting for the spymaster’s clue…', clueHere: 'Enter the clue here', guesses: '{n} guesses left', unlimited: 'Guess freely',
    endTurn: 'End turn', tapAgain: 'Tap again to reveal', hold: 'Hold to peek', keyQr: 'Key QR', keyQrSub: 'The spymasters scan this on their own phone — it shows the key for this game only.',
    win: '{team} win!', assassin: 'The assassin! {team} win.', allFound: 'All agents found!',
    newGame: 'New game', lobby: 'Lobby', left: '{n} left', number: 'How many cards?', clueWord: 'Clue word (optional)', onBoard: 'That word is on the board', taken: 'Each team has one spymaster — ask the host',
    makeSpy: 'Make spymaster', makeOp: 'Make operative', moveTo: 'Move to {team}', remove: 'Remove', game: 'Game {code}', any: '∞', timeUp: 'Time’s up!',
    s_lang: 'Words in', s_auto: 'Auto', s_set: 'Word set', s_cats: 'Categories (none = all)', s_custom: 'My words', s_cOff: 'Off', s_cMix: 'Mixed in', s_cOnly: 'Only mine',
    s_customN: '{n} words', s_addWords: 'Add words', s_clearWords: 'Clear my words', s_timer: 'Turn timer', s_guess: 'Operatives guess', s_room: 'New room', s_roomSub: 'Phones scan again', s_reset: 'Remove all players',
    addWordsT: 'Words (comma separated)', agents: 'agents', clue: 'Clue', resume: 'Continue', fewWords: 'Not enough words — filled up from the built-in list',
  },
  he: {
    howTo: 'שתי קבוצות, לוח אחד של מילים. ראשי הריגול נותנים רמז של מילה אחת, והקבוצה מנחשת אילו מילים שלה — ונזהרת מהמתנקש.',
    phones: 'עם טלפונים', device: 'מכשיר אחד', title: 'מילות קוד', room: 'חדר', scan: 'סרקו כדי להצטרף', joinHint: 'בטלפון: שם, קבוצה, ראש ריגול או סוכן',
    red: 'אדומים', blue: 'כחולים', spy: 'ראש ריגול', ops: 'סוכנים', noSpy: 'עוד אין ראש ריגול', nobody: 'עוד אין אף אחד', start: 'התחלה', settings: 'הגדרות',
    words: 'מילים', guessing: 'ניחושים', timer: 'טיימר', custom: 'המילים שלי', off: 'כבוי', display: 'על המסך', phonesG: 'הצבעה בטלפון', std: 'רגיל', kids: 'ילדים',
    localHow: 'מכשיר אחד: ראשי הריגול מחזיקים 🔑 כדי להציץ במפתח (כולם מסתכלים הצידה) — או סורקים את ה-QR של המפתח בטלפון שלהם.', starts: '{team} מתחילים',
    turnOf: 'התור של ה{team}', giveClue: 'ראש הריגול, תנו רמז', waitClue: 'מחכים לרמז של ראש הריגול…', clueHere: 'להזין את הרמז כאן', guesses: 'נשארו {n} ניחושים', unlimited: 'מנחשים חופשי',
    endTurn: 'סיום תור', tapAgain: 'לחצו שוב לחשיפה', hold: 'החזיקו להצצה', keyQr: 'QR למפתח', keyQrSub: 'ראשי הריגול סורקים בטלפון שלהם — רואים את המפתח של המשחק הזה בלבד.',
    win: 'ה{team} ניצחו!', assassin: 'המתנקש! ה{team} ניצחו.', allFound: 'כל הסוכנים נמצאו!',
    newGame: 'משחק חדש', lobby: 'לובי', left: 'עוד {n}', number: 'לכמה קלפים?', clueWord: 'מילת הרמז (רשות)', onBoard: 'המילה הזאת על הלוח', taken: 'לכל קבוצה ראש ריגול אחד — בקשו מהמארח',
    makeSpy: 'למנות לראש ריגול', makeOp: 'להפוך לסוכן', moveTo: 'להעביר ל{team}', remove: 'הסרה', game: 'משחק {code}', any: '∞', timeUp: 'נגמר הזמן!',
    s_lang: 'שפת המילים', s_auto: 'אוטומטי', s_set: 'סט מילים', s_cats: 'קטגוריות (בלי בחירה = הכול)', s_custom: 'המילים שלי', s_cOff: 'כבוי', s_cMix: 'מעורב', s_cOnly: 'רק שלי',
    s_customN: '{n} מילים', s_addWords: 'הוספת מילים', s_clearWords: 'מחיקת המילים שלי', s_timer: 'טיימר לתור', s_guess: 'הסוכנים מנחשים', s_room: 'חדר חדש', s_roomSub: 'הטלפונים סורקים שוב', s_reset: 'להסיר את כל השחקנים',
    addWordsT: 'מילים (מופרדות בפסיקים)', agents: 'סוכנים', clue: 'רמז', resume: 'להמשיך', fewWords: 'אין מספיק מילים — השלמנו מהרשימה המובנית',
  },
};
// names inside a sentence are bidi-isolated (a Hebrew name in an English line, or the other way round, stays in place)
const T = (k, vars) => { let v = TX[lang()][k] ?? TX.en[k] ?? k; if (vars) v = v.replace(/\{(\w+)\}/g, (_, x) => (typeof vars[x] === 'string' ? `\u2068${vars[x]}\u2069` : vars[x] ?? '')); return v; };
const tName = (t) => T(t === 'r' ? 'red' : 'blue');

// ---- the barrel grid: 5 rows, each as wide as the circle allows (in % of the round screen)
const ROW_TOP = 21.5, ROW_H = 10.4, GAP = 1.15;
const RECTS = (() => {
  const out = [];
  for (let r = 0; r < 5; r++) {
    const top = ROW_TOP + r * (ROW_H + GAP), bot = top + ROW_H;
    const d = Math.max(Math.abs(top - 50), Math.abs(bot - 50));
    const half = Math.min(45, Math.sqrt(2500 - d * d) - 2.2);
    const w = (2 * half - 4 * GAP) / 5;
    for (let c = 0; c < 5; c++) out.push({ left: 50 - half + c * (w + GAP), top, w, h: ROW_H });
  }
  return out;
})();
// word size: start big, then shrink each word that doesn't fit its card (measured in the DOM, so it works with any
// font that actually loaded — Oswald / Rubik, or a fallback on an offline Pi)
const BASE_EN = 3.8, BASE_HE = 3.6;
function fitWords(box) {
  const items = [...box.querySelectorAll('.cw-card')].map((c) => [c, c.querySelector('.cw-w')]);
  const sizes = items.map(([c, w]) => [c.clientWidth, w.offsetWidth]);   // read everything first (one layout)…
  items.forEach(([c, w], i) => {                                          // …then write
    const [cw, ww] = sizes[i], room = cw * 0.88;
    if (ww > room && ww > 0) w.style.fontSize = `${Math.max(1.5, parseFloat(w.style.fontSize) * (room / ww)).toFixed(2)}cqmin`;
  });
}
let fontsReady = false;

export default {
  party: true,   // no chart: games/shell.js hides the best score, Top 5 and the pause card's score
  get howTo() { return T('howTo'); },
  get modes() { return orderModes({ id: 'phones', name: T('phones') }, { id: 'device', name: T('device') }); },
  lang: () => lang(),
  hud: false,
  create(g, { mode }) {
    const phones = mode !== 'device';
    const L = partyLayer(g, 'cw-root');
    const root = L.root;
    const GKEY = phones ? 'game' : 'gameLocal';
    let players = S.data('players', []);          // [{ id, device, name, team, role }]
    let G = S.data(GKEY, null);
    let page = '', sel = -1, qrUrl = null, qrWhy = '', destroyed = false, paused = false, endsAt = 0, lastSec = -1, dirty = true, lastArc = -1;
    const offs = [];
    const save = () => { S.save('players', players); S.save(GKEY, G); };
    const custom = () => S.data('custom', []);

    if (!fontsReady && document.fonts?.load) {
      Promise.race([Promise.all([document.fonts.load("600 20px 'Oswald'"), document.fonts.load("700 20px 'Rubik'")]), new Promise((r) => setTimeout(r, 1500))])
        .then(() => { fontsReady = true; if (page === 'game' && !destroyed) render(); }).catch(() => {});
    }

    // ------------------------------------------------------------ phones
    const link = phones ? partyLink(ID, S, { onAct }) : null;
    if (link) {
      offs.push(link.events.on('status', () => { refreshQr(); if (page === 'lobby') render(); }));
      offs.push(link.events.on('room', () => { qrUrl = null; refreshQr(); }));
      link.start();
    }
    async function refreshQr() {
      if (!link) return;
      if (link.status === 'down') { qrUrl = null; qrWhy = link.reason || 'nobridge'; if (page === 'lobby') render(); return; }
      if (link.status !== 'ok') return;
      const r = await phoneLink(link);
      if (destroyed) return;
      const ch = r.url !== qrUrl;
      qrUrl = r.url; qrWhy = r.reason || '';
      if (ch && page === 'lobby') render();
    }
    const byDevice = (d) => players.find((p) => p.device === d);
    const teamOf = (t) => players.filter((p) => p.team === t);
    const spyOf = (t) => players.find((p) => p.team === t && p.role === 'spy');
    const smallest = () => (teamOf('r').length <= teamOf('b').length ? 'r' : 'b');
    function onAct(a) {
      if (a.type === 'join' || a.type === 'team') {
        let p = byDevice(a.device);
        if (!p) { p = { id: 'd' + uid(), device: a.device, name: a.name || 'Player', team: '', role: '' }; players.push(p); }
        if (a.name) p.name = a.name;
        if (a.team === 'r' || a.team === 'b') p.team = a.team;
        if (!p.team || a.team === 'auto' && !p.team) p.team = smallest();
        if (a.role === 'spy' || a.role === 'op') {
          const cur = spyOf(p.team);
          if (a.role === 'spy' && cur && cur !== p) { p.role = p.role === 'spy' ? 'op' : p.role || 'op'; link.reply(a.device, { type: 'err', msg: T('taken'), role: p.role }); }
          else p.role = a.role;
        }
        if (p.role === 'spy' && spyOf(p.team) !== p) p.role = 'op';
        save(); changed(); return;
      }
      if (a.type === 'word') { addWords(a.words || []); if (setup().custom === 'off') { putSetup({ custom: 'mix' }); changed(); } return; }
      if (!G) return;
      const p = byDevice(a.device);
      if (a.type === 'clue' && G.phase === 'clue' && p && p.role === 'spy' && p.team === G.turn) {
        if (onBoard(a.word)) { link.reply(a.device, { type: 'err', msg: T('onBoard') }); return; }
        giveClue(a.word, a.n); return;
      }
      if (a.type === 'vote' && G.phase === 'guess' && p && p.role !== 'spy' && p.team === G.turn) {
        if (a.idx >= 0 && G.rev[a.idx]) return;
        G.votes[a.device] = a.idx;
        const ops = players.filter((x) => x.team === G.turn && x.role !== 'spy' && x.device);
        const need = Math.max(1, Math.floor(ops.length / 2) + 1);
        const n = Object.values(G.votes).filter((v) => v === a.idx).length;
        g.sfx('tick');
        if (n >= need) { if (a.idx < 0) endTurn(); else reveal(a.idx); return; }
        save(); changed();
      }
    }
    function addWords(list) {
      const cur = custom().slice();
      let n = 0;
      for (const w of list) { const x = String(w).trim().slice(0, 24); if (x && !cur.some((c) => sameText(c, x))) { cur.push(x); n++; } }
      if (n) { S.save('custom', cur); g.sfx('coin'); g.toast(`+${n}`, 700); changed(); }
    }
    const onBoard = (w) => G.words.some((x, i) => !G.rev[i] && sameText(x, w));
    function publish() {
      if (!link) return;
      const s = setup();
      const st = { v: 1, phase: G ? G.phase : 'lobby', guess: s.guess, custom: true, lang: lang(),
        teams: ['r', 'b'].map((t) => ({ id: t, left: G ? agentsLeft(t) : null, spy: spyOf(t)?.name || '' })),
        players: Object.fromEntries(players.filter((p) => p.device).map((p) => [p.device, { name: p.name, team: p.team, role: p.role || '' }])) };
      if (G) {
        Object.assign(st, { turn: G.turn, start: G.start, clue: G.clue, guessesLeft: G.left, history: G.history, winner: G.winner, reason: G.reason,
          board: G.words.map((w, i) => ({ w, c: G.rev[i] ? G.key[i] : null })), secret: { key: G.key }, votesBy: G.votes,
          votes: Object.values(G.votes).reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {}),
          timer: s.timer && G.phase !== 'over' ? { left: Math.round(timeLeft()), total: s.timer * 1000 } : null });
      }
      link.publish(st);
    }
    const changed = () => { publish(); render(); };

    // ------------------------------------------------------------ the game
    const agentsLeft = (t) => (G ? G.key.filter((k, i) => k === t && !G.rev[i]).length : 0);
    function pickWords(seed) {
      const s = setup(), l = lang();
      let pool = s.custom === 'only' ? custom().slice() : wordPool(l, s.set, s.cats);
      if (s.custom === 'mix') pool = pool.concat(custom());
      pool = pool.filter((w, i) => pool.findIndex((x) => sameText(x, w)) === i);
      if (pool.length < 25) { g.toast(T('fewWords'), 1800); pool = pool.concat(wordPool(l).filter((w) => !pool.some((x) => sameText(x, w)))); }
      const r = rng(seed ^ 0x5bd1e995);
      const idx = pool.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      return idx.slice(0, 25).map((i) => pool[i]);
    }
    function newGame() {
      const start = nextStart();
      S.save('lastStart', start); nextS = '';
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      G = { seed, start, words: pickWords(seed), key: makeKey(seed, start), rev: Array(25).fill(0), turn: start, phase: 'clue', clue: null, left: null, history: [], votes: {}, winner: null, reason: '', tLeft: 0 };
      sel = -1;
      startTimer();
      g.sfx('whoosh');
      save(); show('game');
    }
    function startTimer() { const s = setup(); G.tLeft = s.timer * 1000; endsAt = performance.now() + G.tLeft; lastSec = -1; }
    const timeLeft = () => (!G || !setup().timer ? 0 : paused || G.phase === 'over' ? G.tLeft : Math.max(0, endsAt - performance.now()));
    function giveClue(word, n) {
      G.clue = { word: String(word || '').trim().slice(0, 30), n };
      G.left = n > 0 ? n + 1 : null;
      G.phase = 'guess'; G.votes = {}; sel = -1;
      G.history.push({ team: G.turn, word: G.clue.word, n });
      g.sfx('pop');
      save(); changed();
    }
    function endTurn(why) {
      if (!G || G.phase === 'over') return;
      G.turn = other(G.turn); G.phase = 'clue'; G.clue = null; G.left = null; G.votes = {}; sel = -1;
      if (why) g.toast(why, 1200);
      startTimer();
      g.sfx('whoosh');
      save(); changed();
    }
    function finish(winner, reason) {
      G.phase = 'over'; G.winner = winner; G.reason = reason; G.votes = {}; sel = -1;
      setTimeout(() => { if (!destroyed && G?.phase === 'over') { g.sfx('win'); if (!lite()) confetti(root, [COL[winner], '#ffffff', COL[winner], '#ffd166']); } }, reason === 'assassin' ? 900 : 350);
      save(); changed();
    }
    function reveal(i) {
      if (!G || G.phase !== 'guess' || G.rev[i]) return;
      G.rev[i] = 1; sel = -1; G.votes = {};
      const c = G.key[i], team = G.turn;
      flipAt = i;
      g.vibrate(c === 'a' ? 300 : 20);
      if (c === 'a') { g.sfx('boom'); shake(); finish(other(team), 'assassin'); return; }
      if (!agentsLeft('r')) { g.sfx(c === team ? 'score' : 'hit'); finish('r', 'agents'); return; }
      if (!agentsLeft('b')) { g.sfx(c === team ? 'score' : 'hit'); finish('b', 'agents'); return; }
      if (c === team) {
        g.sfx('score');
        if (G.left != null) { G.left--; if (G.left <= 0) { save(); changed(); setTimeout(() => endTurn(), 700); return; } }
        save(); changed(); return;
      }
      g.sfx(c === 'n' ? 'drop' : 'hit');
      save(); changed();
      setTimeout(() => { if (G && G.phase === 'guess') endTurn(); }, 750);
    }
    let flipAt = -1;
    function shake() { if (lite()) return; root.classList.remove('cw-shake'); void root.offsetWidth; root.classList.add('cw-shake'); }

    // ------------------------------------------------------------ screens
    const tag = (sel2, props, ...kids) => h(sel2, props, ...kids);
    const put = (...kids) => root.append(...kids.flat().filter(Boolean));
    const btn = (cls, label, fn, k) => tag(`button.${cls}`, { type: 'button', dataset: k ? { k } : undefined, onclick: (e) => { e.stopPropagation(); g.sfx('click'); fn(); } }, label);
    const ic = (name) => tag('span.pk-ic', { html: icon(name) });
    function show(p) { page = p; root.dataset.page = p; dirty = true; render(); publish(); }
    function render() {
      if (destroyed) return;
      const he = lang() === 'he';
      root.dir = he ? 'rtl' : 'ltr'; root.lang = he ? 'he' : 'en';
      clear(root);
      if (page === 'lobby') lobbyPage(); else if (page === 'game' && G) gamePage();
      L.refocus();
    }

    // who starts the next game: the other team than last time (the first time: random)
    let nextS = '';
    const nextStart = () => (nextS ||= S.data('lastStart', '') ? other(S.data('lastStart', '')) : Math.random() < 0.5 ? 'r' : 'b');
    function teamBox(t) {
      const list = teamOf(t), spy = spyOf(t);
      const ops = list.filter((p) => p !== spy);
      return tag(`div.cw-team.t-${t}`, { '--t': COL[t] },
        tag('div.cw-team-h', tag('i'), tag('span', tName(t)), phones ? tag('b', String(list.length)) : null),
        phones ? tag('div.cw-spy', tag('span.cw-spy-i', '🕵️'), spy ? btn('cw-pl.spy', tag('span', { dir: 'auto' }, spy.name), () => playerMenu(spy), 'p' + spy.id) : tag('span.cw-none', T('noSpy'))) : null,
        phones ? tag('div.cw-ops', ...(ops.length ? ops.slice(0, 7).map((p) => btn('cw-pl', tag('span', { dir: 'auto' }, p.name), () => playerMenu(p), 'p' + p.id)) : [tag('span.cw-none', T('nobody'))]),
          ops.length > 7 ? tag('span.cw-none', `+${ops.length - 7}`) : null) : null,
        !phones ? tag('div.cw-agents', tag('b', String(t === nextStart() ? 9 : 8)), tag('span', T('agents')), t === nextStart() ? tag('em', T('starts', { team: tName(t) })) : null) : null);
    }
    function lobbyPage() {
      const s = setup();
      const head = tag('div.pk-head', tag('div.pk-title', T('title')), link ? tag('div.pk-code', `${T('room')} `, tag('b', link.code)) : null);
      let left;
      if (phones) {
        if (qrUrl) left = tag('div.pk-qrbox.cw-qrbox', qrBox(qrUrl, 'pk-qr'), tag('div.pk-scan', T('scan')), tag('div.pk-hint', T('joinHint')));
        else if (link.status === 'down') left = tag('div.pk-qrbox.cw-qrbox.pk-noqr', tag('div.pk-noqr-i', '📵'), tag('div.pk-hint', noPhones(qrWhy, lang() === 'he')));
        else left = tag('div.pk-qrbox.cw-qrbox.pk-noqr', tag('div.pk-spin'));
      } else {
        const mini = tag('div.cw-mini', ...makeKey(1234567, 'r').map((k) => tag(`i.k-${k}`)));
        left = tag('div.pk-qrbox.cw-qrbox.cw-local', mini, tag('div.pk-hint', T('localHow')));
      }
      const l = lang();
      const setName = s.custom === 'only' ? T('custom') : `${l === 'he' ? 'עברית' : 'English'} · ${T(s.set)}${s.cats.length ? ` · ${s.cats.length}` : ''}`;
      const tile = (k, v, fn, key) => btn('cw-tile', [tag('span.cw-tile-k', k), tag('span.cw-tile-v', { dir: 'auto' }, v)], fn, key);
      const tiles = tag(`div.cw-tiles${phones ? '' : '.n3'}`,
        tile(T('words'), setName, openSettings, 'tw'),
        phones ? tile(T('guessing'), s.guess === 'phones' ? T('phonesG') : T('display'), () => { putSetup({ guess: s.guess === 'phones' ? 'display' : 'phones' }); changed(); }, 'tg') : null,
        tile(T('timer'), s.timer ? `${s.timer} s` : T('off'), () => { const o = [0, 60, 90, 120, 180]; putSetup({ timer: o[(o.indexOf(s.timer) + 1) % o.length] }); changed(); }, 'tt'),
        tile(T('custom'), s.custom === 'off' ? `${T('off')} · ${custom().length}` : `${s.custom === 'mix' ? T('s_cMix') : T('s_cOnly')} · ${custom().length}`, () => { const o = ['off', 'mix', 'only']; putSetup({ custom: o[(o.indexOf(s.custom) + 1) % 3] }); changed(); }, 'tc'));
      const bar = tag('div.pk-bar',
        btn('pk-ib', ic('settings'), openSettings, 'set'),
        G && G.phase !== 'over' ? btn('pk-go.cw-go.pk-default', `▶ ${T('resume')}`, () => show('game'), 'go') : btn('pk-go.cw-go.pk-default', `▶ ${T('start')}`, newGame, 'go'),
        btn('pk-ib', ic('plus'), addWordsPanel, 'words'));
      put(head, left, tag('div.cw-teams', teamBox('r'), teamBox('b')), tiles, bar);
    }

    function gamePage() {
      const s = setup(), turnC = COL[G.turn];
      root.style.setProperty('--t', turnC);
      root.classList.toggle('cw-over', G.phase === 'over');
      // top: agents left · the clue / whose turn · agents left
      let pill;
      if (G.phase === 'over') pill = tag('div.cw-pill.win', { '--t': COL[G.winner] }, G.reason === 'assassin' ? `💀 ${T('assassin', { team: tName(G.winner) })}` : `🏆 ${T('win', { team: tName(G.winner) })}`);
      else if (G.clue) pill = tag('div.cw-pill', tag('span.cw-cw', { dir: 'auto' }, G.clue.word || T('clue')), tag('span.cw-cn', G.clue.n < 0 ? '∞' : String(G.clue.n)));
      else pill = tag('div.cw-pill.wait', T('turnOf', { team: tName(G.turn) }));
      const sub = G.phase === 'guess' ? (G.left == null ? T('unlimited') : T('guesses', { n: G.left })) : G.phase === 'clue' ? (phones && spyOf(G.turn)?.device ? T('waitClue') : T('giveClue')) : '';
      put(tag('div.cw-top', tag('div.cw-cnt.t-r', { '--t': COL.r }, String(agentsLeft('r'))), pill, tag('div.cw-cnt.t-b', { '--t': COL.b }, String(agentsLeft('b')))),
        tag('div.cw-sub', tag('span', sub), s.timer && G.phase !== 'over' ? (secEl = tag('span.cw-sec', fmtSec(timeLeft()))) : null));
      // the grid
      const he = lang() === 'he';
      const grid = tag('div.cw-grid');
      G.words.forEach((w, i) => {
        const R = RECTS[i], rev = G.rev[i], k = G.key[i];
        const votes = Object.values(G.votes).filter((v) => v === i).length;
        const card = tag(`button.cw-card.k-${k}${rev ? `.rev.c-${k}` : ''}${sel === i ? '.sel' : ''}${flipAt === i ? '.flip' : ''}${HEB.test(w) ? '.he' : ''}`, {
          type: 'button', dataset: { k: 'c' + i }, style: { left: `${R.left}%`, top: `${R.top}%`, width: `${R.w}%`, height: `${R.h}%` },
          onclick: (e) => { e.stopPropagation(); tapCard(i); },
        }, tag('span.cw-w', { dir: 'auto', style: { fontSize: `${HEB.test(w) ? BASE_HE : BASE_EN}cqmin` } }, w), votes ? tag('span.cw-votes', '●'.repeat(Math.min(votes, 5))) : null,
          sel === i ? tag('span.cw-again', T('tapAgain')) : null);
        if (rev || G.phase === 'over') card.classList.add('done');
        grid.append(card);
      });
      flipAt = -1;
      put(grid);
      fitWords(grid);
      // bottom controls
      const bot = tag('div.cw-bot');
      if (G.phase === 'over') {
        bot.append(btn('pk-go.cw-go.pk-default', `↻ ${T('newGame')}`, newGame, 'new'), btn('pk-sm', T('lobby'), () => show('lobby'), 'lobby'));
      } else if (G.phase === 'clue' && (!phones || !spyOf(G.turn)?.device)) {
        bot.append(tag('div.cw-nums', ...[1, 2, 3, 4, 5, -1].map((n) => btn('cw-num', n < 0 ? '∞' : String(n), () => giveClue('', n), 'n' + n)),
          btn('cw-num.cw-wordbtn', ic('edit'), clueWithWord, 'nw')));
      } else if (G.phase === 'clue') {
        bot.append(btn('pk-sm', T('clueHere'), clueWithWord, 'clue'));
      } else {
        bot.append(btn('cw-end.pk-default', `⏭ ${T('endTurn')}`, () => endTurn(), 'end'));
      }
      put(bot);
      if (!phones && G.phase !== 'over') {
        const peek = tag('button.cw-key', { type: 'button', dataset: { k: 'peek' }, 'aria-label': T('hold') }, '🔑');
        const on = (e) => { e.preventDefault(); root.classList.add('cw-peek'); };
        const off = () => root.classList.remove('cw-peek');
        peek.addEventListener('pointerdown', on); peek.addEventListener('pointerup', off); peek.addEventListener('pointerleave', off); peek.addEventListener('pointercancel', off);
        peek.addEventListener('contextmenu', (e) => e.preventDefault());
        put(tag('div.cw-bot2', peek, tag('div.cw-code', gameCode(G.seed)), btn('cw-key', ic('link'), keyQr, 'qr')));
      }
    }
    let secEl = null;
    const fmtSec = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    function tapCard(i) {
      if (!G || G.phase !== 'guess' || G.rev[i]) { if (G?.phase === 'clue') g.toast(T('giveClue'), 900); return; }
      g.sfx('tap');
      if (sel === i) reveal(i); else { sel = i; render(); }
    }
    async function clueWithWord() {
      openPanel({
        title: T('number'), className: 'pk-panel cw-panel',
        build(body, panel) {
          body.dir = lang() === 'he' ? 'rtl' : 'ltr';
          let word = '';
          const wl = tag('button.pill', { type: 'button', onclick: async () => { const v = await editText({ title: T('clueWord'), value: word, okLabel: '✓' }); if (v != null) { if (v && onBoard(v)) { g.toast(T('onBoard')); return; } word = v; wl.textContent = `✎ ${word || T('clueWord')}`; } } }, `✎ ${T('clueWord')}`);
          body.append(wl, tag('div.cw-pnums', ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0, -1].map((n) => tag('button.cw-num', { type: 'button', onclick: () => { panel.close(); if (G?.phase === 'clue') giveClue(word, n); } }, n < 0 ? '∞' : String(n)))));
        },
      });
    }
    async function keyUrl() {
      const u = new URL(`./phone/codewords-key.html?k=${(G.seed >>> 0).toString(36)}${G.start}&l=${lang()}`, import.meta.url);
      if (!/^(localhost|127\.|\[?::1)/.test(u.hostname)) return { url: u.href };
      try {
        const info = await bridgeFetch('/api/codewords/info', { timeout: 4000 });
        if (info?.publicUrl) return { url: info.publicUrl.replace(/\/$/, '') + u.pathname + u.search };
        if (info?.ips?.[0]) return { url: `http://${info.ips[0]}:${info.port || 8765}${u.pathname}${u.search}` };
      } catch {}
      // no bridge to reach this display: the key page is static (the seed is in the link), so the GitHub Pages copy works
      return { url: `https://royborkin.github.io/RoundSpotify/games/phone/codewords-key.html${u.search}` };
    }
    function keyQr() {
      openPanel({
        title: T('keyQr'), className: 'pk-panel cw-panel cw-qrpanel',
        build(body) {
          body.dir = lang() === 'he' ? 'rtl' : 'ltr';
          body.append(tag('div.pk-spin'));
          keyUrl().then(({ url }) => {
            clear(body);
            body.append(qrBox(url, 'cw-keyqr'), tag('div.pk-psub', T('keyQrSub')), tag('div.cw-code.in', T('game', { code: gameCode(G.seed) })));
          });
        },
      });
    }
    async function addWordsPanel() {
      const v = await editText({ title: T('addWordsT'), okLabel: '+' });
      if (destroyed || !v) return;
      addWords(v.split(/[,،\n]+/));
      if (setup().custom === 'off') { putSetup({ custom: 'mix' }); changed(); }
    }
    function playerMenu(p) {
      openPanel({
        title: p.name, className: 'pk-panel',
        build(body, panel) {
          body.dir = lang() === 'he' ? 'rtl' : 'ltr';
          const act = (fn) => () => { fn(); save(); changed(); panel.close(); };
          body.append(...[
            p.role !== 'spy' ? tag('button.pill.primary', { type: 'button', '--c': COL[p.team], onclick: act(() => { const cur = spyOf(p.team); if (cur) cur.role = 'op'; p.role = 'spy'; }) }, `🕵️ ${T('makeSpy')}`) : null,
            p.role === 'spy' ? tag('button.pill', { type: 'button', onclick: act(() => { p.role = 'op'; }) }, `🔎 ${T('makeOp')}`) : null,
            tag('button.pill', { type: 'button', onclick: act(() => { p.team = other(p.team); if (p.role === 'spy' && spyOf(p.team) !== p) p.role = 'op'; }) }, T('moveTo', { team: tName(other(p.team)) })),
            tag('button.pill.danger', { type: 'button', onclick: act(() => { players = players.filter((x) => x !== p); }) }, T('remove'))].filter(Boolean));
        },
      });
    }
    function openSettings() {
      openPanel({
        title: T('settings'), className: 'pk-panel pk-setp cw-panel',
        build(body) {
          const box = tag('div.pk-set'); body.append(box);
          const draw = () => {
            clear(box);
            const s = setup(), l = lang();
            box.dir = l === 'he' ? 'rtl' : 'ltr';
            const chips = (key, list) => tag('div.pk-chips', ...list.map(([v, label]) => tag(`button.pk-chip${s[key] === v ? '.on' : ''}`, { type: 'button', onclick: () => { putSetup({ [key]: v }); S.flush(); g.sfx('tick'); draw(); changed(); } }, label)));
            const block = (label, el) => tag('div.pk-blk', tag('div.pk-blk-h', label), el);
            const set = new Set(s.cats);
            box.append(...[
              block(T('s_lang'), chips('lang', [['auto', T('s_auto')], ['en', 'English'], ['he', 'עברית']])),
              block(T('s_set'), chips('set', [['std', `${T('std')} · ${counts(l).std}`], ['kids', `${T('kids')} · ${counts(l).kids}`]])),
              s.set === 'std' ? block(T('s_cats'), tag('div.pk-chips', ...CATS.map((c) => tag(`button.pk-chip${set.has(c.id) ? '.on' : ''}`, { type: 'button', onclick: () => { set.has(c.id) ? set.delete(c.id) : set.add(c.id); putSetup({ cats: CATS.map((x) => x.id).filter((x) => set.has(x)) }); g.sfx('tick'); draw(); changed(); } }, `${c.icon} ${l === 'he' ? c.he : c.en}`)))) : null,
              block(`${T('s_custom')} · ${T('s_customN', { n: custom().length })}`, chips('custom', [['off', T('s_cOff')], ['mix', T('s_cMix')], ['only', T('s_cOnly')]])),
              tag('div.pk-chips', tag('button.pk-chip', { type: 'button', onclick: async () => { await addWordsPanel(); draw(); } }, `＋ ${T('s_addWords')}`),
                custom().length ? tag('button.pk-chip', { type: 'button', onclick: () => { S.save('custom', []); draw(); changed(); } }, T('s_clearWords')) : null),
              block(T('s_timer'), chips('timer', [[0, T('off')], [60, '60 s'], [90, '90 s'], [120, '2 min'], [180, '3 min']])),
              phones ? block(T('s_guess'), chips('guess', [['display', T('display')], ['phones', T('phonesG')]])) : null,
              link ? tag('div.pk-row', tag('div', tag('div', T('s_room')), tag('div.pk-rsub', `${T('room')} ${link.code} · ${T('s_roomSub')}`)), tag('button.pill.small', { type: 'button', onclick: () => { players = players.filter((p) => !p.device); link.newRoom(); save(); draw(); changed(); } }, '↻')) : null,
              players.length ? tag('button.pill.danger.small', { type: 'button', onclick: () => { players = []; save(); draw(); changed(); } }, T('s_reset')) : null].filter(Boolean));
          };
          draw();
        },
      });
    }

    // knob: hold k = peek (One device)
    g.on('key', ({ key }) => { if (!phones && (key === 'k' || key === 'K') && page === 'game') root.classList.add('cw-peek'); });
    g.on('keyup', ({ key }) => { if (key === 'k' || key === 'K') root.classList.remove('cw-peek'); });

    // ------------------------------------------------------------ canvas: background + the turn timer ring
    g.on('resize', () => { dirty = true; if (page === 'game') render(); });
    g.loop(() => {
      let need = dirty;
      const s = setup();
      if (G && page === 'game' && s.timer && G.phase !== 'over' && !paused) {
        const left = timeLeft(), sec = Math.ceil(left / 1000);
        if (sec !== lastSec) {
          if (lastSec !== -1 && sec <= 10 && sec > 0) g.sfx('tick', { volume: 4, pitch: sec <= 3 ? 1.4 : 1 });
          lastSec = sec;
          if (secEl) { secEl.textContent = fmtSec(left); secEl.classList.toggle('low', sec <= 10); }
        }
        const arc = Math.round((left / (s.timer * 1000)) * 720);
        if (arc !== lastArc) { lastArc = arc; need = true; }
        if (left <= 0) { g.sfx('over'); endTurn(T('timeUp')); return; }
      }
      if (!need) return;
      dirty = false;
      const { cx, cy, R } = g;
      g.draw.bg({ color: G && page === 'game' ? COL[G.phase === 'over' ? G.winner : G.turn] : COLOR, glow: 0.14 });
      if (G && page === 'game' && s.timer && G.phase !== 'over') {
        const frac = timeLeft() / (s.timer * 1000);
        g.draw.arc(cx, cy, R * 0.952, 0, TAU, THEME.glass2, R * 0.022, { cap: 'butt' });
        if (frac > 0) g.draw.arc(cx, cy, R * 0.952, 0, TAU * frac, COL[G.turn], R * 0.022);
      }
    });

    if (G) endsAt = performance.now() + (G.tLeft || setup().timer * 1000);
    show(G ? 'game' : 'lobby');
    if (phones) refreshQr();
    return {
      pause() { paused = true; if (G) G.tLeft = Math.max(0, endsAt - performance.now()); root.classList.remove('cw-peek'); save(); publish(); },
      resume() { paused = false; if (G) endsAt = performance.now() + G.tLeft; dirty = true; publish(); },
      destroy() {
        destroyed = true;
        if (G && setup().timer) G.tLeft = timeLeft();
        save(); S.flush();
        for (const off of offs) { try { off(); } catch {} }
        link?.stop();
        L.destroy();
      },
    };
  },
};
