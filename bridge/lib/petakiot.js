// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Notes Game (פתקיות — games/petakiot.js): phones join a team, write their notes (names for the bowl) and, on their
// turn, show the explainer the note to get across with big ✓ Got it / ⤼ Skip buttons. The display runs the game and
// publishes its state; only the explainer's phone ever sees the current note (personalize), each phone sees only its
// own notes. Routes: see lib/party.js (GET /petakiot?r=<room>, /api/petakiot/…).
import { partyApp, phonePage, HttpErr, str } from './party.js';

const TYPES = new Set(['join', 'team', 'note', 'unnote', 'pack', 'start', 'got', 'skip']);

function onState(room, s) {
  // a new note in the explainer's hand: forget which one was answered last
  const nid = s?.secret?.note?.id || '';
  if (room.data.nid !== nid) { room.data.nid = nid; room.data.acted = ''; }
}

function accept(room, act) {
  if (!TYPES.has(act.type)) throw new HttpErr(400, 'unknown action');
  const s = room.state;
  if (act.type === 'join' || act.type === 'team') {
    act.team = str(act.team, 12);
    if (act.team && act.team !== 'auto' && !(s?.teams || []).some((t) => t.id === act.team)) act.team = '';
    return {};
  }
  if (!s) throw new HttpErr(409, 'The game isn’t open on the display');
  if (act.type === 'pack') { act.lang = act.lang === 'he' ? 'he' : 'en'; return {}; }
  if (act.type === 'note') {
    act.text = str(act.text, 48);
    if (!act.text) throw new HttpErr(400, 'Write a name first');
    if (s.phase !== 'lobby') throw new HttpErr(409, 'The game has started — no more notes');
    if ((s.notesBy?.[act.device] || []).length >= (s.per || 5)) throw new HttpErr(409, 'full');
    return {};
  }
  if (act.type === 'unnote') {
    act.id = str(act.id, 24);
    if (s.phase !== 'lobby') throw new HttpErr(409, 'The game has started');
    return {};
  }
  if (act.type === 'start') {
    if (s.phase !== 'ready' || s.turn?.device !== act.device) throw new HttpErr(409, 'Not your turn');
    return {};
  }
  // got / skip: only the explainer, only for the note in their hand, once
  act.nid = str(act.nid, 24);
  if (s.phase !== 'turn' || s.paused || s.turn?.device !== act.device || s.secret?.note?.id !== act.nid) throw new HttpErr(409, 'stale');
  if (room.data.acted === act.nid) { act.drop = true; return { again: true }; }
  if (act.type === 'skip' && s.turn.skipLimit && s.turn.skips >= s.turn.skipLimit) throw new HttpErr(409, 'No skips left');
  room.data.acted = act.nid;
  return {};
}

function personalize(s, device) {
  if (!s) return null;
  const { players = {}, notesBy = {}, secret, ...rest } = s;
  const teams = (s.teams || []).map((t) => ({ ...t, players: Object.values(players).filter((p) => p.team === t.id).map((p) => p.name) }));
  return { ...rest, teams, me: players[device] || null, mine: notesBy[device] || [], note: secret && secret.device === device ? secret.note : null,
    explainer: !!(s.turn && s.turn.device === device) };
}

const I18N = {
  en: { title: 'Notes Game', team: 'Your team', auto: 'Any team', pick: 'Pick a team (or let the game balance them)', notes: 'Your notes', notesSub: 'Names everyone knows — people, characters, things. Nobody else sees them.',
    add: 'Add', ph: 'e.g. Cleopatra', count: '{n} of {m}', full: 'All your notes are in the bowl 🎉', ideas: 'Need ideas?', more: 'More ideas', dup: 'Someone already put that one in',
    wait: 'Waiting for the display…', lobbyWait: 'When everyone’s notes are in, the host starts the game.', bowl: '{n} notes in the bowl', round: 'Round {i} of {n}',
    yourTurn: 'Your turn!', yourTurnSub: 'Your team guesses. Tap start when they’re ready.', start: 'Start', guessWait: 'Get ready to guess!', explains: '{name} explains', otherTurn: '{team} is up',
    got: 'Got it', skip: 'Skip', skipsLeft: '{n} skips left', noSkips: 'No skips left', guess: 'Guess!', listen: 'Listen in… no shouting the answer!', left: '{n} notes left',
    paused: 'Paused', timeUp: 'Time’s up!', gotN: '{name} got {n}', next: 'Next: {name} ({team})', roundDone: 'Round {i} done!', nextRound: 'Next round: {r}', carry: '{name} carries on with {s} s',
    scores: 'Scores', winner: '{team} win!', tie: 'It’s a tie!', mvp: 'Best explainer: {name} ({n})', thanks: 'Thanks for playing!', onDisplay: 'This turn is played on the display.',
    r1: 'Describe', r2: 'One word', r3: 'Charades', r4: 'Sounds only', r5: 'One gesture',
    h1: 'Say anything except the name itself (and no “sounds like”).', h2: 'Just ONE word — choose it well.', h3: 'Act it out — no sounds, no words.', h4: 'Only sounds and noises — no words.', h5: 'One single move, hidden under a sheet / blanket.' },
  he: { title: 'פתקיות', team: 'הקבוצה שלך', auto: 'כל קבוצה', pick: 'בחרו קבוצה (או שהמשחק יאזן)', notes: 'הפתקים שלך', notesSub: 'שמות שכולם מכירים — אנשים, דמויות, דברים. אף אחד אחר לא רואה אותם.',
    add: 'הוספה', ph: 'למשל: קליאופטרה', count: '{n} מתוך {m}', full: 'כל הפתקים שלך בקערה 🎉', ideas: 'צריכים רעיונות?', more: 'עוד רעיונות', dup: 'מישהו כבר שם את זה',
    wait: 'מחכים למסך…', lobbyWait: 'כשכל הפתקים בפנים — המארח מתחיל את המשחק.', bowl: '{n} פתקים בקערה', round: 'סבב {i} מתוך {n}',
    yourTurn: 'התור שלך!', yourTurnSub: 'הקבוצה שלך מנחשת. לחצו "התחלה" כשהם מוכנים.', start: 'התחלה', guessWait: 'היכונו לנחש!', explains: '{name} מסביר/ה', otherTurn: 'התור של {team}',
    got: 'ניחשו!', skip: 'דלג', skipsLeft: 'נשארו {n} דילוגים', noSkips: 'אין יותר דילוגים', guess: 'נחשו!', listen: 'מקשיבים… בלי לצעוק את התשובה!', left: 'נשארו {n} פתקים',
    paused: 'הפסקה', timeUp: 'נגמר הזמן!', gotN: '{name} הצליח/ה {n}', next: 'הבא/ה: {name} ({team})', roundDone: 'סבב {i} הסתיים!', nextRound: 'הסבב הבא: {r}', carry: '{name} ממשיך/ה עם {s} שנ׳',
    scores: 'ניקוד', winner: '{team} ניצחו!', tie: 'תיקו!', mvp: 'המסביר/ה הכי טוב/ה: {name} ({n})', thanks: 'תודה ששיחקתם!', onDisplay: 'התור הזה משוחק על המסך.',
    r1: 'תיאור', r2: 'מילה אחת', r3: 'פנטומימה', r4: 'רק קולות', r5: 'תנועה אחת',
    h1: 'אומרים הכול חוץ מהשם עצמו (ובלי "מתחרז עם").', h2: 'רק מילה אחת — תבחרו טוב.', h3: 'מציגים בלי קול ובלי מילים.', h4: 'רק קולות ורעשים — בלי מילים.', h5: 'תנועה אחת בלבד, מתחת לסדין / שמיכה.' },
};

const CSS = `
.teams{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tbtn{display:flex;align-items:center;gap:10px;padding:14px;border-radius:16px;background:var(--card);border:2px solid color-mix(in srgb,var(--t) 55%,transparent);text-align:start;min-height:58px}
.tbtn .sw{width:22px;height:22px;border-radius:50%;background:var(--t);flex:none}.tbtn b{display:block;font-size:16px}.tbtn span{font-size:12px;color:var(--muted)}
.tbtn.on{background:color-mix(in srgb,var(--t) 24%,var(--card));border-color:var(--t)}
.tbtn.auto{--t:var(--dim);grid-column:1/-1;justify-content:center}
.teambar{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:16px;background:color-mix(in srgb,var(--t) 18%,var(--card));border:1px solid color-mix(in srgb,var(--t) 50%,transparent);margin-bottom:12px}
.teambar .sw{width:14px;height:14px;border-radius:50%;background:var(--t)}.teambar b{flex:1}.teambar .sc{font-weight:900;font-variant-numeric:tabular-nums}
.addrow{display:flex;gap:8px}.addrow .in{flex:1}.addrow .big{width:auto;margin:0;padding:0 20px}
.cnt{display:flex;justify-content:space-between;align-items:center;margin:12px 2px 8px;font-weight:800}.cnt span{color:var(--muted);font-weight:700;font-size:14px}
.dots{display:flex;gap:5px}.dots i{width:12px;height:12px;border-radius:4px;background:var(--card2);transform:rotate(-6deg)}.dots i.on{background:var(--c)}
.notes{display:flex;flex-direction:column;gap:8px}
.nt{display:flex;align-items:center;gap:10px;padding:11px 12px 11px 14px;border-radius:14px;background:color-mix(in srgb,var(--c) 14%,var(--card2));font-weight:700;animation:pop .25s}
.nt span{flex:1;unicode-bidi:plaintext}.nt button{width:32px;height:32px;border-radius:50%;background:var(--card);color:var(--muted);font-size:15px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.chip{padding:9px 13px;border-radius:99px;background:var(--card2);border:1px solid var(--line);font-weight:700;font-size:14px;unicode-bidi:plaintext}
.chip:active{transform:scale(.95)}
.center{text-align:center}.center h2{margin:6px 0;font-size:24px}.center p{color:var(--muted);margin:6px 0}
.big-e{font-size:54px;line-height:1;margin:10px 0 4px}
.rchip{display:inline-block;padding:6px 14px;border-radius:99px;background:color-mix(in srgb,var(--c) 22%,var(--card2));font-weight:800;font-size:14px;margin-bottom:6px}
.timer{font-size:64px;font-weight:900;font-variant-numeric:tabular-nums;text-align:center;line-height:1;margin:6px 0 4px;letter-spacing:-.02em}
.timer.low{color:var(--err)}
.tbar{height:10px;border-radius:9px;background:var(--card2);overflow:hidden;margin:8px 2px 14px}.tbar i{display:block;height:100%;background:var(--t,var(--c));transition:width .25s linear}
.note{min-height:150px;display:grid;place-items:center;text-align:center;padding:22px 16px;border-radius:24px;background:#fffbea;color:#2b2414;font-size:34px;font-weight:900;line-height:1.15;
  box-shadow:0 10px 30px rgba(0,0,0,.25);transform:rotate(-1.2deg);margin:4px 4px 18px;unicode-bidi:plaintext;word-break:break-word;animation:pop .22s}
.acts{display:grid;grid-template-columns:1fr 1.6fr;gap:12px}
.acts button{min-height:120px;border-radius:24px;font-size:22px;font-weight:900;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:transform .08s}
.acts button:active{transform:scale(.96)}.acts button small{font-size:12px;font-weight:700;opacity:.8}
.acts .ok{background:var(--ok);color:#06240f;box-shadow:0 6px 0 color-mix(in srgb,var(--ok) 55%,#000)}
.acts .sk{background:var(--card2);color:var(--fg);box-shadow:0 6px 0 var(--line)}
.acts .ic{font-size:40px;line-height:1}
.guess{font-size:56px;font-weight:900;text-align:center;margin:18px 0 6px;color:var(--t,var(--c));animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{transform:scale(1.06)}}
.board{display:grid;gap:8px;margin-top:10px}
.brow{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.brow .sw{width:14px;height:14px;border-radius:50%;background:var(--t)}.brow b{flex:1}.brow .sc{font-weight:900;font-size:20px;font-variant-numeric:tabular-nums}
.brow.me{border:2px solid var(--t)}
.gotlist{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:10px}.gotlist span{padding:6px 11px;border-radius:10px;background:#fffbea;color:#2b2414;font-weight:800;font-size:14px;unicode-bidi:plaintext}
`;

const BODY = `
<div class="hi"><span data-t="hi"></span> <b id="who" dir="auto"></b><button id="rename" data-t="change"></button></div>
<div id="view"></div>
`;

function script() {
  const { $, t, el, ls } = P;
  let myTeam = ls.get('pk.team.' + P.room) || '', ideas = [], gotAt = Date.now(), sending = false, lastNid = '';
  const teamOf = (id) => ((P.view && P.view.teams) || []).find((x) => x.id === id);
  const tn = (tm) => (tm ? (P.lang === 'he' ? tm.he : tm.en) || tm.name : '');
  const rname = (id) => t('r' + id), rhint = (id) => t('h' + id);
  const iso = (x) => '\u2068' + (x || '') + '\u2069';   // a name inside a sentence keeps its place (Hebrew in English and back)
  async function act(type, data) {
    try { return await P.act(type, data); } catch (e) { if (e.message !== 'stale') P.toast(e.message === 'full' ? t('full') : e.message, true); return null; }
  }
  async function setTeam(id) { myTeam = id; ls.set('pk.team.' + P.room, id); await act('team', { team: id }); P.vibrate(15); draw(); }
  function scoreBoard(v) {
    const box = el('div', { class: 'board' });
    (v.teams || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0)).forEach((tm) => box.append(el('div', { class: 'brow' + (v.me && v.me.team === tm.id ? ' me' : ''), '--t': tm.color },
      el('span', { class: 'sw' }), el('b', { dir: 'auto', text: tn(tm) }), el('span', { class: 'sc', text: String(tm.score || 0) }))));
    return box;
  }
  function teamBar(v) {
    const tm = v.me && teamOf(v.me.team);
    if (!tm) return null;
    document.body.style.setProperty('--t', tm.color);
    return el('div', { class: 'teambar', '--t': tm.color }, el('span', { class: 'sw' }), el('b', { dir: 'auto', text: tn(tm) }),
      v.phase === 'lobby' ? el('button', { class: 'ghost', text: t('change'), onclick: () => { myTeam = ''; ls.set('pk.team.' + P.room, ''); drawPick(v); } }) : el('span', { class: 'sc', text: String(tm.score || 0) }));
  }
  function drawPick(v) {
    const box = $('#view'); box.textContent = '';
    box.append(el('div', { style: 'font-weight:800;margin:4px 4px 10px', text: t('pick') }));
    const g = el('div', { class: 'teams' });
    for (const tm of v.teams || []) g.append(el('button', { class: 'tbtn' + (myTeam === tm.id ? ' on' : ''), '--t': tm.color, onclick: () => setTeam(tm.id) }, el('span', { class: 'sw' }),
      el('div', {}, el('b', { dir: 'auto', text: tn(tm) }), el('span', { dir: 'auto', text: (tm.players || []).join(', ') || '—' }))));
    g.append(el('button', { class: 'tbtn auto', onclick: () => setTeam('auto') }, el('b', { text: '🎲 ' + t('auto') })));
    box.append(g);
  }
  // the note box survives re-renders (so the phone keyboard stays open while notes go in)
  const inp = el('input', { class: 'in', dir: 'auto', maxlength: '48', enterkeyhint: 'done', autocomplete: 'off', autocorrect: 'off', id: 'noteIn' });
  async function addNote(text) {
    text = (text || '').trim(); if (!text || sending) return;
    sending = true;
    const r = await act('note', { text });
    sending = false;
    if (r) { if (inp.value.trim() === text) inp.value = ''; P.vibrate(15); P.beep(880, 0.06); }
  }
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addNote(inp.value); } };
  const addRow = el('div', { class: 'addrow' }, inp, el('button', { class: 'big', 'data-t': 'add', onclick: () => { addNote(inp.value); inp.focus(); } }));
  function lobby(v, box) {
    const mine = v.mine || [], per = v.per || 5, full = mine.length >= per;
    inp.placeholder = t('ph'); addRow.querySelector('button').textContent = t('add');
    const card = el('section', { class: 'card' });
    card.append(el('label', { class: 'l', text: t('notes') }), el('p', { class: 'sub', style: 'margin:-4px 0 12px', text: t('notesSub') }));
    if (!full) card.append(addRow);
    const dots = el('div', { class: 'dots' }); for (let i = 0; i < per; i++) dots.append(el('i', { class: i < mine.length ? 'on' : '' }));
    card.append(el('div', { class: 'cnt' }, el('span', { text: full ? t('full') : t('count', { n: mine.length, m: per }) }), dots));
    const list = el('div', { class: 'notes' });
    for (const n of mine) list.append(el('div', { class: 'nt' }, el('span', { dir: 'auto', text: n.text }), el('button', { 'aria-label': '✕', text: '✕', onclick: () => act('unnote', { id: n.id }) })));
    card.append(list);
    box.append(card);
    if (v.pack && !full) {
      const ic = el('section', { class: 'card' });
      ic.append(el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, el('b', { text: t('ideas') }),
        el('button', { class: 'ghost', text: '🎲 ' + t('more'), onclick: () => act('pack', { lang: P.lang }) })));
      const chips = el('div', { class: 'chips' });
      for (const s of ideas) chips.append(el('button', { class: 'chip', dir: 'auto', text: s, onclick: () => { ideas = ideas.filter((x) => x !== s); addNote(s); draw(); } }));
      ic.append(chips);
      box.append(ic);
      if (!ideas.length && !lobby.asked) { lobby.asked = true; act('pack', { lang: P.lang }); }
    }
    box.append(el('p', { class: 'center sub', style: 'justify-content:center;text-align:center;display:block', text: t('bowl', { n: v.total || 0 }) + ' · ' + t('lobbyWait') }));
  }
  function timer(v, box) {
    const tm = teamOf(v.turn && v.turn.team);
    box.append(el('div', { class: 'timer', id: 'tm' }), el('div', { class: 'tbar', '--t': tm ? tm.color : '' }, el('i', { id: 'tb' })));
    tick();
  }
  function draw() {
    const v = P.view, box = $('#view');
    const keepFocus = document.activeElement === inp;
    box.textContent = '';
    document.body.style.removeProperty('--t');
    if (!v) { box.append(el('div', { class: 'card center' }, el('div', { class: 'big-e', text: '📝' }), el('p', { text: t('wait') }))); return; }
    if (v.phase === 'lobby' && !myTeam) return drawPick(v);
    const tb = teamBar(v); if (tb) box.append(tb);
    const tt = v.turn && teamOf(v.turn.team);
    const head = v.round ? el('div', { class: 'center' }, el('span', { class: 'rchip', text: t('round', { i: v.round.i, n: v.round.n }) + ' · ' + rname(v.round.id) })) : null;
    if (v.phase === 'lobby') { lobby(v, box); if (keepFocus && inp.isConnected) inp.focus({ preventScroll: true }); return; }
    if (v.phase === 'ready') {
      box.append(head);
      if (v.explainer) {
        box.append(el('div', { class: 'card center' }, el('div', { class: 'big-e', text: '🎤' }), el('h2', { text: t('yourTurn') }), el('p', { text: rhint(v.round.id) }),
          el('p', { text: t('yourTurnSub') }), el('button', { class: 'big', style: 'min-height:72px;font-size:22px', text: '▶ ' + t('start'), onclick: () => { P.vibrate(30); act('start'); } })));
      } else {
        const mineT = v.me && tt && v.me.team === tt.id;
        box.append(el('div', { class: 'card center', style: tt ? '--t:' + tt.color + ';border-color:var(--t)' : '' }, el('div', { class: 'big-e', text: mineT ? '🙌' : '⏳' }),
          el('h2', { dir: 'auto', text: mineT ? t('guessWait') : t('otherTurn', { team: tn(tt) }) }), el('p', { dir: 'auto', text: t('explains', { name: iso(v.turn.name) }) }), el('p', { text: rhint(v.round.id) })));
      }
      box.append(scoreBoard(v)); return;
    }
    if (v.phase === 'turn') {
      box.append(head);
      if (v.paused) box.append(el('div', { class: 'banner', text: '⏸ ' + t('paused') }));
      timer(v, box);
      if (v.explainer && v.note) {
        if (v.note.id !== lastNid) { lastNid = v.note.id; P.vibrate(20); }
        box.append(el('div', { class: 'note', dir: 'auto', text: v.note.text }));
        const lim = v.turn.skipLimit, skipsLeft = lim ? Math.max(0, lim - (v.turn.skips || 0)) : null;
        const ok = el('button', { class: 'ok', onclick: async () => { if (ok.disabled) return; ok.disabled = sk.disabled = true; P.beep(1046, 0.09, 'triangle'); P.vibrate(25); await act('got', { nid: v.note.id }); } },
          el('span', { class: 'ic', text: '✓' }), el('span', { text: t('got') }));
        const sk = el('button', { class: 'sk', disabled: skipsLeft === 0 || v.paused, onclick: async () => { if (sk.disabled) return; ok.disabled = sk.disabled = true; P.vibrate(10); await act('skip', { nid: v.note.id }); } },
          el('span', { class: 'ic', text: '⤼' }), el('span', { text: t('skip') }), skipsLeft != null ? el('small', { text: skipsLeft ? t('skipsLeft', { n: skipsLeft }) : t('noSkips') }) : null);
        if (v.paused) ok.disabled = true;
        box.append(el('div', { class: 'acts' }, sk, ok));
      } else if (v.explainer) {
        box.append(el('div', { class: 'card center', text: t('onDisplay') }));
      } else {
        const mineT = v.me && tt && v.me.team === tt.id;
        box.append(mineT ? el('div', { class: 'guess', '--t': tt.color, text: t('guess') }) : el('div', { class: 'card center' }, el('p', { text: t('listen') })),
          el('p', { class: 'center sub', style: 'justify-content:center', dir: 'auto', text: t('explains', { name: iso(v.turn.name) }) + ' · ' + t('left', { n: v.turn.bowl }) }));
      }
      box.append(scoreBoard(v)); return;
    }
    if (v.phase === 'turnEnd' || v.phase === 'roundEnd') {
      const L = v.last || {};
      box.append(head, el('div', { class: 'card center' }, el('div', { class: 'big-e', text: v.phase === 'roundEnd' ? '🎉' : '⏰' }),
        el('h2', { text: v.phase === 'roundEnd' ? t('roundDone', { i: v.round.i }) : t('timeUp') }), el('p', { dir: 'auto', text: t('gotN', { name: iso(L.name), n: (L.got || []).length }) }),
        el('div', { class: 'gotlist' }, ...(L.got || []).map((x) => el('span', { dir: 'auto', text: x }))),
        v.nextUp ? el('p', { dir: 'auto', text: v.nextUp.carry ? t('carry', { name: iso(v.nextUp.name), s: v.nextUp.carry }) : t('next', { name: iso(v.nextUp.name), team: tn(teamOf(v.nextUp.team)) }) }) : null,
        v.phase === 'roundEnd' && v.nextRound ? el('p', { text: t('nextRound', { r: rname(v.nextRound) }) }) : null));
      box.append(scoreBoard(v)); return;
    }
    if (v.phase === 'final') {
      const F = v.final || {};
      const w = teamOf(F.winner);
      box.append(el('div', { class: 'card center', style: w ? '--t:' + w.color + ';border-color:var(--t)' : '' }, el('div', { class: 'big-e', text: '🏆' }),
        el('h2', { dir: 'auto', text: w ? t('winner', { team: tn(w) }) : t('tie') }), F.mvp ? el('p', { dir: 'auto', text: t('mvp', { name: iso(F.mvp.name), n: F.mvp.n }) }) : null, el('p', { text: t('thanks') })));
      box.append(scoreBoard(v));
    }
  }
  function tick() {
    const v = P.view, tmEl = document.getElementById('tm'), b = document.getElementById('tb');
    if (!v || !v.turn || !tmEl) return;
    const left = Math.max(0, v.paused ? v.turn.left : v.turn.left - (Date.now() - gotAt));
    const s = Math.ceil(left / 1000);
    tmEl.textContent = s; tmEl.className = 'timer' + (s <= 10 ? ' low' : '');
    if (b) b.style.width = (left / Math.max(1, v.turn.total) * 100).toFixed(1) + '%';
    if (v.explainer && s <= 5 && s > 0 && tick.last !== s && !v.paused) { tick.last = s; P.vibrate(15); }
  }
  setInterval(() => { if (P.view && P.view.phase === 'turn') tick(); }, 200);
  P.on('state', (v) => {
    gotAt = Date.now();
    if (v && v.me && v.me.team && myTeam && myTeam !== 'auto' && v.me.team !== myTeam && v.phase === 'lobby') { myTeam = v.me.team; ls.set('pk.team.' + P.room, myTeam); }
    if (v && myTeam && !v.me && P.name && Date.now() - (draw.sent || 0) > 4000) { draw.sent = Date.now(); act('team', { team: myTeam }); }
    if (v && v.me && v.me.team && myTeam === 'auto') { myTeam = v.me.team; ls.set('pk.team.' + P.room, myTeam); }
    draw();
  });
  P.on('reply', (d) => {
    if (!d) return;
    if (d.type === 'pack') { ideas = d.items || []; draw(); }
    if (d.type === 'err') P.toast(d.msg === 'dup' ? t('dup') : d.msg, true);
  });
  P.on('render', draw);
  if (myTeam) setTimeout(() => act('team', { team: myTeam }), 400);
}

const PAGE = phonePage({ app: 'petakiot', title: 'Notes Game · פתקיות', color: '#f59e0b', glyph: '✎', css: CSS, body: BODY, i18n: I18N, script });
export const route = partyApp({ name: 'petakiot', page: PAGE, personalize, accept, onState });
