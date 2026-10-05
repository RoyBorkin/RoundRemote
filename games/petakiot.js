// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Notes Game (פתקיות) — the Israeli party game in the spirit of Fishbowl / Salad Bowl. Everyone writes names on notes
// (from their phone, or typed on the display), the notes go into the bowl, and two to four teams take turns against
// the clock: the explainer gets their team to guess as many notes as they can. The same notes come back every round,
// with a new way of explaining them: 1 Describe (anything but the name), 2 One word, 3 Charades — optional 4 Sounds
// only and 5 One gesture under a sheet. The host picks the rounds and their order, the turn time (30/45/60/90 s), the
// notes per player, skip penalty / skip limit and whether the time left when the bowl empties carries into the next
// round (the classic rule). Modes (the start card):
//   • With phones — a QR code on the display; phones join (name + team, auto-balanced), write their notes or pick from
//     the starter pack, and on their turn the explainer's phone shows the note with big ✓ Got it / ⤼ Skip. Everyone
//     else's phone shows the timer and whose turn it is (teammates: "Guess!"). Needs the bridge (bridge/lib/petakiot.js).
//   • One device — no bridge (e.g. on GitHub Pages): notes are typed on the display (on-screen keyboard) or drawn from
//     the starter pack, and the explainer holds the display (✓ / ⤼ on the screen, knob: ← → and press).
// The display shows the round and its rule, whose turn (team colour), a big timer ring (beeps in the last 10 s), the
// score per team and the notes left; at the end the scores, the best explainer, and a replay with the same notes or new.
import { TAU, THEME } from './kit.js';
import { h, clear } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { editText } from '../js/ui/keyboard.js';
import { openPanel } from '../js/ui/overlay.js';
import { store } from '../js/core/store.js';
import { go } from '../js/core/router.js';
import { partyLink, qrBox, confetti } from '../apps/party-link.js';
import { gameStore, partyLayer, loadCss, phoneLink, noPhones, orderModes, lite, shuffle, uid, sameText } from './petakiot-party.js';
import { PACK } from './petakiot-pack.js';

const ID = 'petakiot', COLOR = '#f59e0b';
loadCss('petakiot.css');
const S = gameStore(ID);

const TEAMS = [
  { id: 'red', en: 'Red', he: 'האדומים', color: '#ef4444' }, { id: 'blue', en: 'Blue', he: 'הכחולים', color: '#3b82f6' },
  { id: 'green', en: 'Green', he: 'הירוקים', color: '#22c55e' }, { id: 'purple', en: 'Purple', he: 'הסגולים', color: '#a855f7' },
];
const ROUND_ICON = { 1: '💬', 2: '☝️', 3: '🎭', 4: '🔊', 5: '🛏️' };
const DEF = { lang: 'auto', per: 5, pack: true, rounds: [1, 2, 3], turn: 60, skipPenalty: false, skipLimit: 0, carry: true, teams: 2 };
const setup = () => ({ ...DEF, ...S.data('setup', {}) });
const putSetup = (p) => S.save('setup', { ...S.data('setup', {}), ...p });
const lang = () => { const l = setup().lang; return l === 'en' || l === 'he' ? l : store.get('kbdLang') === 'he' ? 'he' : 'en'; };

const TX = {
  en: {
    howTo: 'Everyone writes names on notes. Teams take turns against the clock: describe them, then one word, then act them out — the same notes every round.',
    phones: 'With phones', device: 'One device', title: 'Notes Game', room: 'Room', scan: 'Scan to join', joinHint: 'Phones: name, team, then your notes',
    notes: 'notes', noteOne: 'note', ofN: 'of {n}', inBowl: 'in the bowl', start: 'Start', settings: 'Settings', addNotes: 'Notes', addPlayer: 'Player', resume: 'Continue the game',
    nobody: 'Nobody yet', typeNotes: 'Type notes', packAdd: '+10 famous names', clearNotes: 'Empty the bowl', notesPanel: 'Notes in the bowl',
    notesSub: 'Pass the display around — each player types their notes (nobody peeks!).', added: 'In the bowl ✓ ({n})', dup: 'Already in the bowl', noteTitle: 'A name for the bowl',
    notePh: 'e.g. Cleopatra', needNotes: 'Add some notes first', round: 'Round {i} of {n}', explains: 'explains for {team}', pass: 'Pass the display to {name} — no peeking!',
    onPhone: '{name}: tap Start on your phone (or here)', ready: 'Ready?', got: 'Got it', skip: 'Skip', left: '{n} left', skipsLeft: '{n} skips left', noSkips: 'No skips left',
    showHere: 'Show the note here', hideHere: 'Hide the note', timeUp: 'Time’s up!', gotN: '{name} got {n}', next: 'Next turn', nextIs: 'Next: {name} · {team}',
    carry: '{name} carries on with {s} s', roundDone: 'Round {i} done!', nextRound: 'Next round: {r}', startRound: 'Start round {i}', bowlEmpty: 'The bowl is empty!',
    winner: '{team} win!', tie: 'It’s a tie!', mvp: 'Best explainer: {name} · {n}', again: 'Same notes again', newNotes: 'New notes', exit: 'Exit', final: 'Final scores',
    paused: 'Paused', player: 'Player name', rename: 'Rename', remove: 'Remove', moveTo: 'Move to {team}', you: 'notes {n}/{m}',
    s_lang: 'Language', s_auto: 'Auto', s_rounds: 'Rounds (tap in the order you want)', s_turn: 'Turn time', s_per: 'Notes per player', s_teams: 'Teams', s_pack: 'Starter-pack ideas on phones',
    s_packSub: 'Players can pick famous names instead of thinking of their own', s_pen: 'Skip costs a point', s_lim: 'Skips per turn', s_carry: 'Carry the time over',
    s_carrySub: 'When the bowl empties mid-turn, the explainer starts the next round with the time left', s_room: 'New room', s_roomSub: 'Phones scan again', s_reset: 'Remove all players',
    any: '∞', r1: 'Describe', r2: 'One word', r3: 'Charades', r4: 'Sounds only', r5: 'One gesture',
    h1: 'Say anything except the name itself.', h2: 'Just one word — choose it well.', h3: 'Act it out — no sounds, no words.', h4: 'Only sounds and noises — no words.', h5: 'One single move, under a sheet.',
  },
  he: {
    howTo: 'כל אחד כותב שמות על פתקים. הקבוצות משחקות נגד השעון: מתארים, אחר כך מילה אחת, ואז פנטומימה — אותם פתקים בכל סבב.',
    phones: 'עם טלפונים', device: 'מכשיר אחד', title: 'פתקיות', room: 'חדר', scan: 'סרקו כדי להצטרף', joinHint: 'בטלפון: שם, קבוצה ואז הפתקים',
    notes: 'פתקים', noteOne: 'פתק', ofN: 'מתוך {n}', inBowl: 'בקערה', start: 'התחלה', settings: 'הגדרות', addNotes: 'פתקים', addPlayer: 'שחקן', resume: 'להמשיך את המשחק',
    nobody: 'עוד אין אף אחד', typeNotes: 'הקלדת פתקים', packAdd: 'עוד 10 שמות מוכרים', clearNotes: 'לרוקן את הקערה', notesPanel: 'פתקים בקערה',
    notesSub: 'מעבירים את המסך — כל שחקן מקליד את הפתקים שלו (בלי להציץ!).', added: 'בקערה ✓ ({n})', dup: 'כבר בקערה', noteTitle: 'שם לקערה',
    notePh: 'למשל: קליאופטרה', needNotes: 'קודם מוסיפים פתקים', round: 'סבב {i} מתוך {n}', explains: 'מסביר/ה ל{team}', pass: 'מעבירים את המסך ל{name} — בלי להציץ!',
    onPhone: '{name}: לחצו "התחלה" בטלפון (או כאן)', ready: 'מוכנים?', got: 'ניחשו!', skip: 'דלג', left: 'נשארו {n}', skipsLeft: 'נשארו {n} דילוגים', noSkips: 'אין דילוגים',
    showHere: 'להציג את הפתק כאן', hideHere: 'להסתיר את הפתק', timeUp: 'נגמר הזמן!', gotN: '{name}: {n}', next: 'התור הבא', nextIs: 'הבא/ה: {name} · {team}',
    carry: '{name} ממשיך/ה עם {s} שנ׳', roundDone: 'סבב {i} הסתיים!', nextRound: 'הסבב הבא: {r}', startRound: 'לסבב {i}', bowlEmpty: 'הקערה ריקה!',
    winner: '{team} ניצחו!', tie: 'תיקו!', mvp: 'המסביר/ה הכי טוב/ה: {name} · {n}', again: 'שוב, אותם פתקים', newNotes: 'פתקים חדשים', exit: 'יציאה', final: 'התוצאה הסופית',
    paused: 'הפסקה', player: 'שם השחקן', rename: 'שינוי שם', remove: 'הסרה', moveTo: 'להעביר ל{team}', you: 'פתקים {n}/{m}',
    s_lang: 'שפה', s_auto: 'אוטומטי', s_rounds: 'סבבים (לחצו לפי הסדר הרצוי)', s_turn: 'זמן לתור', s_per: 'פתקים לשחקן', s_teams: 'קבוצות', s_pack: 'רעיונות מחבילת הפתיחה בטלפון',
    s_packSub: 'שחקנים יכולים לבחור שמות מוכרים במקום להמציא', s_pen: 'דילוג עולה נקודה', s_lim: 'דילוגים לתור', s_carry: 'הזמן עובר לסבב הבא',
    s_carrySub: 'כשהקערה מתרוקנת באמצע תור — המסביר/ה פותח/ת את הסבב הבא עם הזמן שנשאר', s_room: 'חדר חדש', s_roomSub: 'הטלפונים סורקים שוב', s_reset: 'להסיר את כל השחקנים',
    any: '∞', r1: 'תיאור', r2: 'מילה אחת', r3: 'פנטומימה', r4: 'רק קולות', r5: 'תנועה אחת',
    h1: 'אומרים הכול חוץ מהשם עצמו.', h2: 'רק מילה אחת — תבחרו טוב.', h3: 'מציגים בלי קול ובלי מילים.', h4: 'רק קולות ורעשים — בלי מילים.', h5: 'תנועה אחת בלבד, מתחת לסדין.',
  },
};
// names inside a sentence are bidi-isolated (a Hebrew name in an English line, or the other way round, stays in place)
const T = (k, vars) => { let v = TX[lang()][k] ?? TX.en[k] ?? k; if (vars) v = v.replace(/\{(\w+)\}/g, (_, x) => (typeof vars[x] === 'string' ? `\u2068${vars[x]}\u2069` : vars[x] ?? '')); return v; };
const teamDefs = () => TEAMS.slice(0, Math.max(2, Math.min(4, setup().teams)));
const teamName = (t) => (lang() === 'he' ? t.he : t.en);
const teamById = (id) => TEAMS.find((t) => t.id === id) || TEAMS[0];

export default {
  party: true,   // no chart: games/shell.js hides the best score, Top 5 and the pause card's score
  get howTo() { return T('howTo'); },
  get modes() { return orderModes({ id: 'phones', name: T('phones') }, { id: 'device', name: T('device') }); },
  lang: () => lang(),
  hud: false,
  create(g, { mode }) {
    const phones = mode !== 'device';
    const L = partyLayer(g, 'pk-notes');
    const root = L.root;
    let players = S.data('players', []);         // [{ id, name, team, device? }]
    let notes = S.data('notes', []);             // [{ id, text, by }]
    const GKEY = phones ? 'game' : 'gameLocal';   // a game in each mode (players and notes are shared)
    let G = S.data(GKEY, null);                  // the running game
    let page = '', showHere = false, qrUrl = null, qrWhy = '', destroyed = false, paused = false;
    const offs = [];
    const save = () => { S.save('players', players); S.save('notes', notes); S.save(GKEY, G); };

    // a game left mid-turn (quit / reload): its note goes back, the same explainer starts again
    if (G && G.phase === 'turn') { G.phase = 'ready'; G.turn.note = null; }
    if (G && G.phase === 'final') G = null;

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
      const changed = r.url !== qrUrl;
      qrUrl = r.url; qrWhy = r.reason || '';
      if (changed && page === 'lobby') render();
    }
    const playerOf = (device) => players.find((p) => p.device === device);
    const counts = () => { const c = {}; for (const t of teamDefs()) c[t.id] = 0; for (const p of players) if (c[p.team] != null) c[p.team]++; return c; };
    const smallestTeam = () => { const c = counts(); return teamDefs().map((t) => t.id).sort((a, b) => c[a] - c[b])[0]; };
    const notesOf = (pid) => notes.filter((n) => n.by === pid);
    function onAct(a) {
      if (a.type === 'join' || a.type === 'team') {
        let p = playerOf(a.device);
        const valid = teamDefs().some((t) => t.id === a.team);
        if (!p) { p = { id: 'd' + uid(), device: a.device, name: a.name || 'Player', team: '' }; players.push(p); }
        if (a.name) p.name = a.name;
        if (valid && (!G || !p.team)) p.team = a.team;
        if (!teamDefs().some((t) => t.id === p.team)) p.team = smallestTeam();
        save(); changed(); return;
      }
      if (a.type === 'pack') {
        const pool = shuffle(PACK[a.lang] || PACK.en).filter((x) => !notes.some((n) => sameText(n.text, x))).slice(0, 12);
        link.reply(a.device, { type: 'pack', items: pool }); return;
      }
      if (a.type === 'note') {
        if (G) return;
        let p = playerOf(a.device);
        if (!p) { p = { id: 'd' + uid(), device: a.device, name: a.name || 'Player', team: smallestTeam() }; players.push(p); }
        if (notesOf(p.id).length >= setup().per) { link.reply(a.device, { type: 'err', msg: 'full' }); return; }
        if (!addNote(a.text, p.id)) link.reply(a.device, { type: 'err', msg: 'dup' });
        return;
      }
      if (a.type === 'unnote') {
        const p = playerOf(a.device);
        if (G || !p) return;
        notes = notes.filter((n) => !(n.id === a.id && n.by === p.id));
        save(); changed(); return;
      }
      if (!G) return;
      if (a.type === 'start' && G.phase === 'ready' && G.turn?.device === a.device) { beginTurn(); return; }
      if ((a.type === 'got' || a.type === 'skip') && G.phase === 'turn' && !paused && G.turn.device === a.device && G.turn.note === a.nid) (a.type === 'got' ? gotIt : skipIt)();
    }
    function addNote(text, by) {
      text = String(text || '').trim().slice(0, 48);
      if (!text || notes.some((n) => sameText(n.text, text))) return false;
      notes.push({ id: uid(), text, by });
      bowlDrop();
      g.sfx('drop');
      save(); changed();
      return true;
    }
    function publish() {
      if (!link) return;
      const s = setup(), tm = G?.turn;
      const st = {
        v: 1, phase: G ? G.phase : 'lobby', paused, per: s.per, pack: s.pack, total: notes.length,
        teams: teamDefs().map((t) => ({ id: t.id, name: teamName(t), en: t.en, he: t.he, color: t.color, score: G?.scores?.[t.id] || 0 })),
        players: Object.fromEntries(players.filter((p) => p.device).map((p) => [p.device, { name: p.name, team: p.team }])),
        notesBy: G ? {} : Object.fromEntries(players.filter((p) => p.device).map((p) => [p.device, notesOf(p.id).map((n) => ({ id: n.id, text: n.text }))])),
      };
      if (G) {
        st.round = { i: G.ri + 1, n: G.rounds.length, id: G.rounds[G.ri] };
        if (tm) st.turn = { team: tm.team, name: tm.name, device: tm.device || '', left: Math.round(turnLeft()), total: tm.total, skips: tm.skips, skipLimit: s.skipLimit, bowl: G.bowl.length };
        if (G.phase === 'turn' && tm?.device && tm.note) st.secret = { device: tm.device, note: { id: tm.note, text: noteText(tm.note) } };
        if (G.last) st.last = G.last;
        if (G.phase === 'turnEnd' || G.phase === 'roundEnd') {
          st.nextUp = G.turn ? { name: G.turn.name, team: G.turn.team, carry: G.turn.carry ? Math.ceil(G.turn.left / 1000) : 0 } : null;
          if (G.phase === 'roundEnd') st.nextRound = G.rounds[G.ri + 1] || null;
        }
        if (G.phase === 'final') st.final = finalInfo();
      }
      link.publish(st);
    }
    const changed = () => { publish(); render(); };

    // ------------------------------------------------------------ the game
    const noteText = (id) => notes.find((n) => n.id === id)?.text || '';
    const teamPlayers = (team) => players.filter((p) => p.team === team);
    function makeTurn(ti, ms, carry = false) {
      const team = G.teams[ti];
      const list = teamPlayers(team);
      let p = null;
      if (list.length) { p = list[(G.pp[team] || 0) % list.length]; G.pp[team] = (G.pp[team] || 0) + 1; }
      return { ti, team, pid: p?.id || '', name: p?.name || teamName(teamById(team)), device: p?.device || '', total: ms, left: ms, got: [], skips: 0, note: null, carry };
    }
    function startGame(sameNotes = true) {
      const s = setup();
      if (!sameNotes) { notes = []; G = null; save(); changed(); return; }
      if (!notes.length) { g.toast(T('needNotes')); g.sfx('hit'); return; }
      const teams = teamDefs().map((t) => t.id);
      const first = Math.floor(Math.random() * teams.length);
      G = { rounds: s.rounds.length ? s.rounds.slice() : [1, 2, 3], ri: 0, teams: teams.slice(first).concat(teams.slice(0, first)), pp: {}, scores: Object.fromEntries(teams.map((t) => [t, 0])),
        stats: {}, bowl: shuffle(notes.map((n) => n.id)), phase: 'ready', turn: null, last: null };
      for (const t of teams) G.pp[t] = Math.floor(Math.random() * Math.max(1, teamPlayers(t).length));
      G.turn = makeTurn(0, s.turn * 1000);
      g.sfx('whoosh');
      save(); show('ready');
    }
    let endsAt = 0, lastSec = -1;
    const turnLeft = () => (!G?.turn ? 0 : G.phase === 'turn' && !paused ? Math.max(0, endsAt - performance.now()) : G.turn.left);
    function beginTurn() {
      if (!G || G.phase !== 'ready') return;
      G.phase = 'turn'; endsAt = performance.now() + G.turn.left; lastSec = -1; showHere = false;
      nextNote();
      g.sfx('pop'); g.vibrate(30);
      save(); show('turn');
    }
    function nextNote(avoid = null) {
      const pool = G.bowl.filter((id) => id !== avoid);
      G.turn.note = (pool.length ? pool : G.bowl)[Math.floor(Math.random() * (pool.length || G.bowl.length))] || null;
    }
    function gotIt() {
      const t = G.turn;
      if (!t.note) return;
      G.bowl = G.bowl.filter((id) => id !== t.note);
      G.scores[t.team] = (G.scores[t.team] || 0) + 1;
      const key = t.pid || t.team;
      G.stats[key] = { name: t.name, team: t.team, n: (G.stats[key]?.n || 0) + 1 };
      t.got.push(noteText(t.note));
      g.sfx('coin'); g.vibrate(15);
      flash('ok');
      if (!G.bowl.length) { t.left = turnLeft(); t.note = null; endRound(); return; }
      nextNote();
      save(); changed();
    }
    function skipIt() {
      const t = G.turn, s = setup();
      if (!t.note || (s.skipLimit && t.skips >= s.skipLimit)) return;
      t.skips++;
      if (s.skipPenalty) G.scores[t.team] = (G.scores[t.team] || 0) - 1;
      g.sfx('whoosh');
      flash('skip');
      nextNote(t.note);
      save(); changed();
    }
    function timeUp() {
      const t = G.turn;
      G.last = { name: t.name, team: t.team, got: t.got.slice() };
      t.left = 0; t.note = null;
      G.phase = 'turnEnd';
      g.sfx('over'); g.vibrate(200);
      const ti = (t.ti + 1) % G.teams.length;
      G.turn = makeTurn(ti, setup().turn * 1000);
      save(); show('between');
    }
    function endRound() {
      const t = G.turn, s = setup();
      G.last = { name: t.name, team: t.team, got: t.got.slice(), empty: true };
      const more = G.ri + 1 < G.rounds.length;
      if (!more) { G.phase = 'final'; save(); show('final'); return; }
      G.phase = 'roundEnd';
      g.sfx('score');
      if (s.carry && t.left >= 3000) {
        G.turn = { ...t, got: [], skips: 0, note: null, total: t.left, carry: true };
      } else {
        G.turn = makeTurn((t.ti + 1) % G.teams.length, s.turn * 1000);
      }
      save(); show('between');
    }
    function nextFromBetween() {
      if (!G) return;
      if (G.phase === 'roundEnd') { G.ri++; G.bowl = shuffle(notes.map((n) => n.id)); }
      G.phase = 'ready';
      save(); show('ready');
    }
    function finalInfo() {
      const sc = G.scores, ids = Object.keys(sc);
      const best = Math.max(...ids.map((k) => sc[k]));
      const top = ids.filter((k) => sc[k] === best);
      const mvp = Object.values(G.stats).sort((a, b) => b.n - a.n)[0] || null;
      return { winner: top.length === 1 ? top[0] : null, mvp: mvp ? { name: mvp.name, n: mvp.n, team: mvp.team } : null };
    }

    // ------------------------------------------------------------ screens
    function show(p) { page = p; root.dataset.page = p; dirty = true; render(); publish(); if (p === 'final') { g.sfx('win'); if (!lite()) confetti(root, [COLOR, '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#fff7d6']); } }
    const tag = (sel, props, ...kids) => h(sel, props, ...kids);
    const put = (...kids) => root.append(...kids.flat().filter(Boolean));
    const ic = (name) => tag('span.pk-ic', { html: icon(name) });
    const btn = (cls, label, fn, k) => tag(`button.${cls}`, { type: 'button', dataset: k ? { k } : undefined, onclick: (e) => { e.stopPropagation(); g.sfx('click'); fn(); } }, label);
    function scoresRow() {
      return tag('div.pk-scores', ...teamDefs().map((t) => tag('div.pk-score', { '--t': t.color }, tag('i'), tag('span', { dir: 'auto' }, teamName(t)), tag('b', String(G?.scores?.[t.id] || 0)))));
    }
    function roundChip() {
      const id = G.rounds[G.ri];
      return tag('div.pk-round', tag('span.pk-round-i', ROUND_ICON[id]), tag('span', T('round', { i: G.ri + 1, n: G.rounds.length }) + ' · ' + T('r' + id)));
    }
    function render() {
      if (destroyed) return;
      const he = lang() === 'he';
      root.dir = he ? 'rtl' : 'ltr'; root.lang = he ? 'he' : 'en';
      clear(root);
      ({ lobby: lobbyPage, ready: readyPage, turn: turnPage, between: betweenPage, final: finalPage })[page]?.();
      L.refocus();
    }

    function lobbyPage() {
      const s = setup(), c = counts();
      const head = tag('div.pk-head', tag('div.pk-title', T('title')), link ? tag('div.pk-code', `${T('room')} `, tag('b', link.code)) : null);
      let left;
      if (phones) {
        if (qrUrl) left = tag('div.pk-qrbox', qrBox(qrUrl, 'pk-qr'), tag('div.pk-scan', T('scan')), tag('div.pk-hint', T('joinHint')));
        else if (link.status === 'down') left = tag('div.pk-qrbox.pk-noqr', tag('div.pk-noqr-i', '📵'), tag('div.pk-hint', noPhones(qrWhy, lang() === 'he')));
        else left = tag('div.pk-qrbox.pk-noqr', tag('div.pk-spin'));
      } else {
        left = tag('div.pk-qrbox.pk-local', btn('pk-tile', [tag('span.pk-tile-i', '✎'), tag('span', T('typeNotes'))], typeNotes, 'type'),
          btn('pk-tile', [tag('span.pk-tile-i', '🎲'), tag('span', T('packAdd'))], () => addPack(10), 'pack'));
      }
      const want = players.length * s.per;
      const bowl = tag('div.pk-bowlinfo', tag('b', String(notes.length)), tag('span', notes.length === 1 ? T('noteOne') : T('notes'),
        phones && want ? tag('small', ` · ${T('ofN', { n: want })}`) : null));
      const teams = tag(`div.pk-teams.n${teamDefs().length}`, ...teamDefs().map((t) => {
        const list = teamPlayers(t.id);
        return tag('div.pk-team', { '--t': t.color },
          tag('div.pk-team-h', tag('i'), tag('span', { dir: 'auto' }, teamName(t)), tag('b', String(c[t.id] || 0))),
          tag('div.pk-team-p', ...(list.length ? list.slice(0, 8).map((p) => {
            const n = notesOf(p.id).length, done = n >= s.per;
            return tag(`button.pk-pl${done || !p.device ? '.done' : ''}`, { type: 'button', dataset: { k: 'p' + p.id }, onclick: () => playerMenu(p) }, tag('span', { dir: 'auto' }, p.name), p.device ? tag('small', done ? '✓' : `${n}/${s.per}`) : null);
          }) : [tag('span.pk-none', T('nobody'))]), list.length > 8 ? tag('span.pk-none', `+${list.length - 8}`) : null));
      }));
      const bar = tag('div.pk-bar',
        btn('pk-ib', ic('settings'), openSettings, 'set'),
        phones ? btn('pk-ib', ic('edit'), notesPanel, 'notes') : btn('pk-ib', ic('plus'), () => addPlayer(), 'addp'),
        G ? btn('pk-go.pk-default', `▶ ${T('resume')}`, () => show(G.phase === 'final' ? 'final' : G.phase === 'turnEnd' || G.phase === 'roundEnd' ? 'between' : 'ready'), 'go')
          : btn('pk-go.pk-default', `▶ ${T('start')}`, () => startGame(true), 'go'),
        phones ? btn('pk-ib', ic('plus'), () => addPlayer(), 'addp') : btn('pk-ib', ic('edit'), notesPanel, 'notes'));
      put(head, left, bowl, teams, bar);
      dirty = true;
    }
    function readyPage() {
      const t = G.turn, tm = teamById(t.team), id = G.rounds[G.ri];
      const hasPhone = phones && t.device;
      root.style.setProperty('--t', tm.color);
      put(roundChip(), tag('div.pk-rule', T('h' + id)),
        tag('div.pk-who', { '--t': tm.color }, tag('div.pk-who-n', { dir: 'auto' }, t.name), tag('div.pk-who-t', { dir: 'auto' }, T('explains', { team: teamName(tm) })),
          t.carry ? tag('div.pk-who-c', `⏱ ${Math.ceil(t.left / 1000)} s`) : null),
        tag('div.pk-say', { dir: 'auto' }, hasPhone ? T('onPhone', { name: t.name }) : T('pass', { name: t.name })),
        btn('pk-go.pk-default.pk-start', `▶ ${T('start')}`, beginTurn, 'go'),
        tag('div.pk-foot', scoresRow(), tag('div.pk-left', `📝 ${T('left', { n: G.bowl.length })}`)));
    }
    let secEl = null, noteEl = null;
    function turnPage() {
      const t = G.turn, tm = teamById(t.team), s = setup();
      root.style.setProperty('--t', tm.color);
      const onDisplay = !phones || !t.device || showHere;
      secEl = tag('div.pk-sec', String(Math.ceil(turnLeft() / 1000)));
      root.classList.toggle('pk-show', onDisplay);
      const kids = [roundChip(), tag('div.pk-rule', T('h' + G.rounds[G.ri]))];
      if (onDisplay) {
        const text = noteText(t.note);
        const len = text.length;
        noteEl = tag('div.pk-note', { dir: 'auto', style: { fontSize: `${len <= 10 ? 7.6 : len <= 16 ? 6.4 : len <= 26 ? 5.2 : 4.4}cqmin` } }, text);
        const lim = s.skipLimit, sl = lim ? Math.max(0, lim - t.skips) : null;
        const sk = btn('pk-act.pk-skip', [tag('span.pk-act-i', '⤼'), tag('span', T('skip')), sl != null ? tag('small', sl ? T('skipsLeft', { n: sl }) : T('noSkips')) : null], skipIt, 'skip');
        if (sl === 0) sk.disabled = true;
        kids.push(tag('div.pk-small', secEl, tag('span', { dir: 'auto' }, `${t.name} · ${teamName(tm)}`)), noteEl,
          tag('div.pk-acts', sk, btn('pk-act.pk-ok.pk-default', [tag('span.pk-act-i', '✓'), tag('span', T('got'))], gotIt, 'got')));
      } else {
        kids.push(tag('div.pk-big', secEl), tag('div.pk-who-line', { dir: 'auto' }, tag('i'), `${t.name} · ${T('explains', { team: teamName(tm) })}`));
      }
      kids.push(tag('div.pk-foot', scoresRow(), tag('div.pk-left', `📝 ${T('left', { n: G.bowl.length })}`)));
      if (phones && t.device) kids.push(btn('pk-peek', showHere ? T('hideHere') : T('showHere'), () => { showHere = !showHere; render(); }, 'peek'));
      put(...kids);
    }
    function betweenPage() {
      const L2 = G.last || {}, nt = G.turn, ntm = nt && teamById(nt.team), round = G.phase === 'roundEnd';
      root.style.setProperty('--t', teamById(L2.team || 'red').color);
      put(
        tag('div.pk-btitle', round ? (L2.empty ? T('bowlEmpty') : T('roundDone', { i: G.ri + 1 })) : T('timeUp')),
        round ? tag('div.pk-bsub', T('roundDone', { i: G.ri + 1 })) : null,
        tag('div.pk-gotn', { dir: 'auto' }, T('gotN', { name: L2.name || '', n: (L2.got || []).length })),
        tag('div.pk-gotlist', ...(L2.got || []).slice(-14).map((x) => tag('span', { dir: 'auto' }, x))),
        round ? tag('div.pk-next', T('nextRound', { r: `${ROUND_ICON[G.rounds[G.ri + 1]]} ${T('r' + G.rounds[G.ri + 1])}` })) : null,
        nt ? tag('div.pk-next', { dir: 'auto', '--t': ntm.color }, tag('i'), nt.carry ? T('carry', { name: nt.name, s: Math.ceil(nt.left / 1000) }) : T('nextIs', { name: nt.name, team: teamName(ntm) })) : null,
        btn('pk-go.pk-default', round ? `▶ ${T('startRound', { i: G.ri + 2 })}` : `▶ ${T('next')}`, nextFromBetween, 'go'),
        tag('div.pk-foot', scoresRow()));
    }
    function finalPage() {
      const F = finalInfo(), w = F.winner && teamById(F.winner);
      root.style.setProperty('--t', w ? w.color : COLOR);
      const max = Math.max(1, ...Object.values(G.scores));
      put(tag('div.pk-trophy', '🏆'), tag('div.pk-btitle.pk-win', { dir: 'auto' }, w ? T('winner', { team: teamName(w) }) : T('tie')),
        tag('div.pk-bars', ...teamDefs().slice().sort((a, b) => (G.scores[b.id] || 0) - (G.scores[a.id] || 0)).map((t) => tag('div.pk-barrow', { '--t': t.color },
          tag('span', { dir: 'auto' }, teamName(t)), tag('div.pk-barbox', tag('i', { style: { width: `${Math.max(4, ((G.scores[t.id] || 0) / max) * 100)}%` } })), tag('b', String(G.scores[t.id] || 0))))),
        F.mvp ? tag('div.pk-mvp', { dir: 'auto' }, `⭐ ${T('mvp', { name: F.mvp.name, n: F.mvp.n })}`) : null,
        tag('div.pk-endbtns', btn('pk-go.pk-default', `↻ ${T('again')}`, () => { G = null; startGame(true); }, 'again'),
          btn('pk-sm', T('newNotes'), () => { G = null; notes = []; save(); show('lobby'); }, 'new'), btn('pk-sm', T('exit'), () => { G = null; save(); go('games'); }, 'exit')));
    }

    // ------------------------------------------------------------ host tools
    async function typeNotes() {
      for (;;) {
        const v = await editText({ title: T('noteTitle'), placeholder: T('notePh'), okLabel: '+' });
        if (destroyed || !v) return;
        if (addNote(v, 'host')) g.toast(T('added', { n: notes.length }), 900); else g.toast(T('dup'), 900);
      }
    }
    function addPack(n) {
      const l = lang();
      const pool = shuffle(PACK[l]).filter((x) => !notes.some((m) => sameText(m.text, x))).slice(0, n);
      for (const x of pool) notes.push({ id: uid(), text: x, by: 'pack' });
      bowlDrop(Math.min(pool.length, 6));
      g.sfx('drop'); g.toast(T('added', { n: notes.length }), 900);
      save(); changed();
    }
    function notesPanel() {
      openPanel({
        title: T('notesPanel'), className: 'pk-panel',
        build(body, panel) {
          const he = lang() === 'he';
          body.dir = he ? 'rtl' : 'ltr';
          const draw = () => {
            clear(body);
            body.append(...[tag('div.pk-pn', tag('b', String(notes.length)), tag('span', T('notes'))), tag('div.pk-psub', T('notesSub')),
              tag('button.pill.primary', { type: 'button', onclick: () => { panel.close(); typeNotes(); } }, `✎ ${T('typeNotes')}`),
              tag('button.pill', { type: 'button', onclick: () => { addPack(10); draw(); } }, `🎲 ${T('packAdd')}`),
              notes.length ? tag('button.pill.danger', { type: 'button', onclick: () => { notes = []; if (G) G = null; save(); changed(); draw(); } }, T('clearNotes')) : null].filter(Boolean));
          };
          draw();
        },
      });
    }
    async function addPlayer() {
      const v = await editText({ title: T('player'), okLabel: '+' });
      if (destroyed || !v) return;
      players.push({ id: 'h' + uid(), name: v.slice(0, 24), team: smallestTeam() });
      save(); changed();
    }
    function playerMenu(p) {
      openPanel({
        title: p.name, className: 'pk-panel',
        build(body, panel) {
          body.dir = lang() === 'he' ? 'rtl' : 'ltr';
          body.append(tag('div.pk-psub', T('you', { n: notesOf(p.id).length, m: setup().per })),
            ...teamDefs().filter((t) => t.id !== p.team).map((t) => tag('button.pill', { type: 'button', '--c': t.color, onclick: () => { p.team = t.id; save(); changed(); panel.close(); } }, tag('span.pk-dot', { style: { background: t.color } }), T('moveTo', { team: teamName(t) }))),
            tag('button.pill', { type: 'button', onclick: async () => { panel.close(); const v = await editText({ title: T('rename'), value: p.name, okLabel: '✓' }); if (v) { p.name = v.slice(0, 24); save(); changed(); } } }, T('rename')),
            tag('button.pill.danger', { type: 'button', onclick: () => { players = players.filter((x) => x !== p); notes = notes.filter((n) => n.by !== p.id); save(); changed(); panel.close(); } }, T('remove')));
        },
      });
    }
    function openSettings() {
      openPanel({
        title: T('settings'), className: 'pk-panel pk-setp',
        build(body) {
          const box = tag('div.pk-set'); body.append(box);
          const draw = () => {
            clear(box);
            const s = setup();
            box.dir = lang() === 'he' ? 'rtl' : 'ltr';
            const chips = (key, list, fmt = String) => tag('div.pk-chips', ...list.map((v) => tag(`button.pk-chip${s[key] === v ? '.on' : ''}`, { type: 'button', onclick: () => { putSetup({ [key]: v }); g.sfx('tick'); draw(); changed(); } }, fmt(v))));
            const sw = (key) => tag(`button.switch${s[key] ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(!!s[key]), onclick: () => { putSetup({ [key]: !s[key] }); g.sfx('tick'); draw(); changed(); } });
            const row = (label, sub, right) => tag('div.pk-row', tag('div', tag('div', label), sub ? tag('div.pk-rsub', sub) : null), right);
            const block = (label, el) => tag('div.pk-blk', tag('div.pk-blk-h', label), el);
            const order = s.rounds;
            box.append(...[
              block(T('s_rounds'), tag('div.pk-chips', ...[1, 2, 3, 4, 5].map((id) => {
                const i = order.indexOf(id);
                return tag(`button.pk-chip.pk-rc${i >= 0 ? '.on' : ''}`, { type: 'button', onclick: () => { const next = i >= 0 ? order.filter((x) => x !== id) : [...order, id]; if (!next.length) return; putSetup({ rounds: next }); g.sfx('tick'); draw(); } },
                  i >= 0 ? tag('b', String(i + 1)) : null, `${ROUND_ICON[id]} ${T('r' + id)}`);
              }))),
              block(T('s_turn'), chips('turn', [30, 45, 60, 90], (v) => `${v} s`)),
              block(T('s_per'), chips('per', [3, 4, 5, 6, 8, 10])),
              block(T('s_teams'), chips('teams', [2, 3, 4])),
              block(T('s_lim'), chips('skipLimit', [0, 1, 2, 3, 5], (v) => (v ? String(v) : T('any')))),
              row(T('s_pen'), null, sw('skipPenalty')),
              row(T('s_carry'), T('s_carrySub'), sw('carry')),
              phones ? row(T('s_pack'), T('s_packSub'), sw('pack')) : null,
              block(T('s_lang'), tag('div.pk-chips', ...[['auto', T('s_auto')], ['en', 'English'], ['he', 'עברית']].map(([v, l]) => tag(`button.pk-chip${s.lang === v ? '.on' : ''}`, { type: 'button', onclick: () => { putSetup({ lang: v }); S.flush(); draw(); changed(); } }, l)))),
              link ? row(T('s_room'), `${T('room')} ${link.code} · ${T('s_roomSub')}`, tag('button.pill.small', { type: 'button', onclick: () => { players = players.filter((p) => !p.device); link.newRoom(); save(); draw(); changed(); } }, '↻')) : null,
              players.length ? tag('button.pill.danger.small', { type: 'button', onclick: () => { const ids = new Set(players.map((p) => p.id)); players = []; notes = notes.filter((n) => !ids.has(n.by)); save(); draw(); changed(); } }, T('s_reset')) : null].filter(Boolean));
            // teams shrank: players of a removed team move to the others
            for (const p of players) if (!teamDefs().some((t) => t.id === p.team)) p.team = smallestTeam();
          };
          draw();
        },
      });
    }

    // ------------------------------------------------------------ the canvas: background, bowl, timer ring
    let dirty = true, drops = [], flashT = 0, flashKind = '', lastArc = -1;
    const SLIP = ['#fff3c4', '#ffd6e0', '#d4f1ff', '#dcfce7', '#fde2c8', '#e9d5ff'];
    const hash = (s) => { let x = 2166136261; for (const c of String(s)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995); x ^= x >>> 15; return (x >>> 0) / 4294967296; };
    function bowlDrop(n = 1) { if (page !== 'lobby' || lite()) { dirty = true; return; } for (let i = 0; i < n; i++) drops.push({ t: -i * 0.12, idx: notes.length - 1 - i }); dirty = true; }
    function flash(kind) { flashKind = kind; flashT = lite() ? 0 : 0.5; dirty = true; }
    g.on('resize', () => { dirty = true; });
    // the pile: the first notes sit low in the bowl, later ones heap up above the rim (a mound, narrower on top)
    function slipPos(i, n, R, bx, by, br) {
      const lvl = Math.min(1, i / Math.max(16, n));
      const y = by - br * 0.02 - lvl * br * 0.7 + (hash(i + 'y') - 0.5) * br * 0.1;
      const halfW = br * 0.8 * (1 - 0.62 * lvl);
      const x = bx + (hash(i + 'x') * 2 - 1) * halfW;
      return [x, y, (hash(i + 'r') - 0.5) * 1.4];
    }
    function drawSlip(ctx, x, y, a, w, col) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-w / 2, -w * 0.28, w, w * 0.56, w * 0.08); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = Math.max(1, w * 0.03);
      ctx.beginPath(); ctx.moveTo(-w * 0.32, -w * 0.06); ctx.lineTo(w * 0.3, -w * 0.06); ctx.moveTo(-w * 0.32, w * 0.1); ctx.lineTo(w * 0.12, w * 0.1); ctx.stroke();
      ctx.restore();
    }
    function drawBowl(dt) {
      const { ctx, cx, cy, R } = g;
      const bx = cx + R * 0.36, by = cy - R * 0.12, br = R * 0.27;
      const n = notes.length, show = Math.min(n, 70), w = R * 0.115;
      // back rim (the bowl's opening)
      ctx.fillStyle = THEME.light ? 'rgba(0,0,0,.10)' : 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.ellipse(bx, by, br, br * 0.24, 0, 0, TAU); ctx.fill();
      const falling = new Set(drops.map((d) => d.idx));
      for (let i = 0; i < show; i++) {
        const idx = n - show + i;
        if (falling.has(idx)) continue;
        const [x, y, a] = slipPos(idx, n, R, bx, by, br);
        drawSlip(ctx, x, y, a, w, SLIP[idx % SLIP.length]);
      }
      // the bowl's body (in front of the slips)
      ctx.fillStyle = COLOR;
      ctx.beginPath(); ctx.moveTo(bx - br * 1.04, by); ctx.ellipse(bx, by, br * 1.04, br * 0.92, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.beginPath(); ctx.ellipse(bx, by + br * 0.36, br * 0.62, br * 0.12, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = g.draw.shade(COLOR, -0.25); ctx.lineWidth = R * 0.012;
      ctx.beginPath(); ctx.ellipse(bx, by, br * 1.04, br * 0.25, 0, 0, Math.PI); ctx.stroke();
      // notes falling in
      for (const d of drops) {
        d.t += dt;
        const p = Math.max(0, Math.min(1, d.t / 0.55));
        const [x, y, a] = slipPos(d.idx, n, R, bx, by, br);
        const e = p * p;
        drawSlip(ctx, x + (1 - p) * R * 0.1, by - R * 0.75 + (y - by + R * 0.75) * e, a + (1 - p) * 3, w, SLIP[d.idx % SLIP.length]);
      }
      const had = drops.length;
      drops = drops.filter((d) => d.t < 0.55);
      if (had && !drops.length) dirty = true;   // one more frame: the last note lands behind the bowl's front
    }
    function drawRing() {
      const { cx, cy, R } = g;
      const t = G.turn, frac = t.total ? turnLeft() / t.total : 0, col = teamById(t.team).color;
      g.draw.arc(cx, cy, R * 0.935, 0, TAU, THEME.glass2, R * 0.035, { cap: 'butt' });
      if (frac > 0) g.draw.arc(cx, cy, R * 0.935, 0, TAU * frac, frac < 10000 / t.total && Math.floor(turnLeft() / 500) % 2 ? '#ff5a6a' : col, R * 0.035, { glow: THEME.glow && !lite() ? R * 0.04 : 0 });
    }
    g.loop((dt) => {
      if (!G && page !== 'lobby') return;
      let need = dirty || drops.length || flashT > 0;
      if (G && page === 'turn' && G.phase === 'turn' && !paused) {
        const left = turnLeft(), sec = Math.ceil(left / 1000);
        if (sec !== lastSec) {
          if (lastSec !== -1 && sec <= 10 && sec > 0) g.sfx('tick', { volume: 5, pitch: sec <= 3 ? 1.4 : 1 });
          lastSec = sec;
          if (secEl) { secEl.textContent = String(sec); secEl.classList.toggle('low', sec <= 10); }
        }
        const arc = Math.round(left / G.turn.total * 720);
        if (arc !== lastArc) { lastArc = arc; need = true; }
        if (left <= 0) { timeUp(); return; }
      }
      if (!need) return;
      dirty = false;
      const tcol = G?.turn ? teamById(G.turn.team).color : COLOR;
      g.draw.bg({ color: page === 'lobby' ? COLOR : tcol, glow: page === 'turn' ? 0.22 : 0.16 });
      if (page === 'lobby') drawBowl(Math.min(dt, 0.05));
      if (G && page === 'turn') drawRing();
      if (flashT > 0) {
        flashT -= dt;
        const { ctx, cx, cy, R } = g;
        ctx.save(); ctx.globalAlpha = Math.max(0, flashT / 0.5) * 0.35;
        ctx.fillStyle = flashKind === 'ok' ? '#3ddc84' : THEME.ink(0.5);
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill(); ctx.restore();
      }
    });

    show(G ? (G.phase === 'turnEnd' || G.phase === 'roundEnd' ? 'between' : 'ready') : 'lobby');
    if (phones) refreshQr();

    return {
      pause() {
        paused = true;
        if (G?.phase === 'turn') { G.turn.left = Math.max(0, endsAt - performance.now()); save(); }
        publish();
      },
      resume() {
        paused = false;
        if (G?.phase === 'turn') endsAt = performance.now() + G.turn.left;
        dirty = true; publish();
      },
      destroy() {
        destroyed = true;
        if (G?.phase === 'turn') { G.turn.left = turnLeft(); }
        save(); S.flush();
        for (const off of offs) { try { off(); } catch {} }
        link?.stop();
        L.destroy();
      },
    };
  },
};
