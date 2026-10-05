// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Code Words (games/codewords.js): phones join the red or blue team as a spymaster or an operative. Only spymasters'
// phones ever get the key (personalize); a spymaster types the clue word + number on their phone; operatives can vote
// for a card on their phones ("phones guess" mode) or just watch the grid while the cards are tapped on the display.
// Routes: see lib/party.js (GET /codewords?r=<room>, /api/codewords/…).
import { partyApp, phonePage, HttpErr, str } from './party.js';

const TYPES = new Set(['join', 'team', 'clue', 'vote', 'word']);

function accept(room, act) {
  if (!TYPES.has(act.type)) throw new HttpErr(400, 'unknown action');
  const s = room.state;
  if (act.type === 'join' || act.type === 'team') {
    act.team = ['r', 'b', 'auto'].includes(act.team) ? act.team : '';
    act.role = ['spy', 'op'].includes(act.role) ? act.role : '';
    return {};
  }
  if (!s) throw new HttpErr(409, 'The game isn’t open on the display');
  const me = s.players?.[act.device];
  if (act.type === 'word') {
    if (s.phase !== 'lobby' || !s.custom) throw new HttpErr(409, 'Adding words is closed');
    act.words = String(act.text || '').split(/[,\n،]+/).map((w) => str(w, 24)).filter(Boolean).slice(0, 12);
    if (!act.words.length) throw new HttpErr(400, 'Type a word');
    delete act.text;
    return {};
  }
  if (!me) throw new HttpErr(409, 'Join a team first');
  if (act.type === 'clue') {
    if (s.phase !== 'clue' || me.role !== 'spy' || me.team !== s.turn) throw new HttpErr(409, 'Not your turn to give a clue');
    act.word = str(act.word, 30);
    act.n = Math.round(+act.n);
    if (!act.word) throw new HttpErr(400, 'Type the clue word');
    if (!(act.n >= -1 && act.n <= 9)) throw new HttpErr(400, 'Pick a number');
    return {};
  }
  // vote
  act.idx = Math.round(+act.idx);
  if (s.phase !== 'guess' || s.guess !== 'phones' || me.role === 'spy' || me.team !== s.turn) throw new HttpErr(409, 'Not your turn');
  if (!(act.idx >= -1 && act.idx < 25) || (act.idx >= 0 && s.board?.[act.idx]?.c)) throw new HttpErr(400, 'Pick a card');
  return {};
}

function personalize(s, device) {
  if (!s) return null;
  const { players = {}, secret, votesBy, ...rest } = s;
  const me = players[device] || null;
  const teams = (s.teams || []).map((t) => ({ ...t, players: Object.values(players).filter((p) => p.team === t.id).map((p) => ({ name: p.name, role: p.role })) }));
  const showKey = s.phase === 'over' || (me && me.role === 'spy' && s.phase !== 'lobby');
  return { ...rest, teams, me, key: showKey && secret ? secret.key : null, myVote: votesBy?.[device] ?? null };
}

const I18N = {
  en: { title: 'Code Words', pick: 'Pick your team', auto: 'Any team', role: 'Your role', spy: 'Spymaster', spySub: 'Sees the key, gives one-word clues', op: 'Operative', opSub: 'Guesses the cards',
    taken: 'taken by {name}', lobby: 'You’re in! Waiting for the host to start…', words: 'Add words to the game', wordsSub: 'Separate with commas — they join the host’s custom list.', wordPh: 'e.g. pancake, rocket',
    add: 'Add', added: 'Added ✓', redT: 'Red', blueT: 'Blue', turnOf: '{team}’s turn', thinking: 'The spymaster is thinking…', yourClue: 'Your clue', clueWord: 'One word', send: 'Send clue',
    number: 'How many cards?', any: '∞', sent: 'Clue sent', guessesLeft: '{n} guesses left', unlimited: 'Guess as many as you like', tapVote: 'Tap a card to vote', endTurn: 'End turn',
    voted: 'Your vote is in', watch: 'Tap the cards on the big screen', keyNote: 'Only you see the key — don’t show your screen!', win: '{team} win!', assassin: 'The assassin was found…',
    left: '{n} to go', wait: 'Waiting for the display…', you: 'You', change: 'change', theirClue: 'Clue for {team}', over: 'Game over', newSoon: 'The host can start a new game.' },
  he: { title: 'מילות קוד', pick: 'בחרו קבוצה', auto: 'כל קבוצה', role: 'התפקיד שלך', spy: 'ראש/ת ריגול', spySub: 'רואה את המפתח, נותן/ת רמזים של מילה אחת', op: 'סוכן/ת', opSub: 'מנחשים את הקלפים',
    taken: 'תפוס — {name}', lobby: 'אתם בפנים! מחכים שהמארח יתחיל…', words: 'הוספת מילים למשחק', wordsSub: 'מפרידים בפסיקים — הן נכנסות לרשימה האישית של המארח.', wordPh: 'למשל: פנקייק, טיל',
    add: 'הוספה', added: 'נוסף ✓', redT: 'אדומים', blueT: 'כחולים', turnOf: 'התור של {team}', thinking: 'ראש הריגול חושב/ת…', yourClue: 'הרמז שלך', clueWord: 'מילה אחת', send: 'שליחת רמז',
    number: 'לכמה קלפים?', any: '∞', sent: 'הרמז נשלח', guessesLeft: 'נשארו {n} ניחושים', unlimited: 'מנחשים כמה שרוצים', tapVote: 'לחצו על קלף כדי להצביע', endTurn: 'סיום תור',
    voted: 'ההצבעה נקלטה', watch: 'לוחצים על הקלפים במסך הגדול', keyNote: 'רק את/ה רואה את המפתח — לא להראות את המסך!', win: 'ה{team} ניצחו!', assassin: 'המתנקש נחשף…',
    left: 'עוד {n}', wait: 'מחכים למסך…', you: 'את/ה', change: 'שינוי', theirClue: 'רמז ל{team}', over: 'המשחק נגמר', newSoon: 'המארח יכול להתחיל משחק חדש.' },
};

const CSS = `
:root{--red:#e5484d;--blue:#3e7bfa;--neu:#d9c9a3;--ass:#18181b}
.teams{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tbtn{display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 10px;border-radius:18px;background:color-mix(in srgb,var(--t) 16%,var(--card));border:2px solid color-mix(in srgb,var(--t) 55%,transparent);font-weight:800;font-size:18px}
.tbtn .sw{width:30px;height:30px;border-radius:50%;background:var(--t)}.tbtn span{font-size:12px;color:var(--muted);font-weight:600}
.tbtn.auto{grid-column:1/-1;flex-direction:row;justify-content:center;--t:var(--dim);padding:12px}
.roles{display:grid;gap:10px}
.rbtn{display:flex;align-items:center;gap:14px;padding:16px;border-radius:18px;background:var(--card);border:2px solid var(--line);text-align:start}
.rbtn.on{border-color:var(--t);background:color-mix(in srgb,var(--t) 16%,var(--card))}.rbtn:disabled{opacity:.5}
.rbtn i{font-style:normal;font-size:30px}.rbtn b{display:block;font-size:17px}.rbtn span{font-size:13px;color:var(--muted)}
.teambar{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:16px;background:color-mix(in srgb,var(--t) 18%,var(--card));border:1px solid color-mix(in srgb,var(--t) 50%,transparent);margin-bottom:12px}
.teambar .sw{width:14px;height:14px;border-radius:50%;background:var(--t)}.teambar b{flex:1}.teambar small{color:var(--muted);font-weight:700}
.clue{display:flex;align-items:center;justify-content:center;gap:10px;padding:12px 14px;border-radius:16px;background:var(--t);color:#fff;font-weight:900;font-size:20px;margin-bottom:10px;text-align:center;unicode-bidi:plaintext}
.clue.wait{background:var(--card2);color:var(--muted);font-size:15px;font-weight:700}
.clue .n{min-width:34px;height:34px;border-radius:10px;background:rgba(0,0,0,.25);display:grid;place-items:center}
.meta{display:flex;justify-content:space-between;color:var(--muted);font-size:13px;font-weight:700;margin:0 4px 8px}
.meta b{color:var(--fg)}
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-bottom:12px}
.cell{position:relative;aspect-ratio:1.25;border-radius:9px;background:var(--card2);border:1px solid var(--line);display:grid;place-items:center;padding:2px;font-weight:800;font-size:12px;line-height:1.05;text-align:center;overflow:hidden;overflow-wrap:anywhere;unicode-bidi:plaintext;color:var(--fg)}
.cell.k-r{background:color-mix(in srgb,var(--red) 30%,var(--card2));border-color:var(--red)}.cell.k-b{background:color-mix(in srgb,var(--blue) 30%,var(--card2));border-color:var(--blue)}
.cell.k-n{background:color-mix(in srgb,var(--neu) 28%,var(--card2));border-color:color-mix(in srgb,var(--neu) 70%,transparent)}.cell.k-a{background:var(--ass);color:#fff;border-color:#f43f5e;border-width:2px}
.cell.rev{color:#fff;border-color:transparent}.cell.rev.c-r{background:var(--red)}.cell.rev.c-b{background:var(--blue)}.cell.rev.c-n{background:var(--neu);color:#3b3222}.cell.rev.c-a{background:var(--ass)}
.cell.rev.k-r,.cell.rev.k-b,.cell.rev.k-n,.cell.rev.k-a{opacity:.42;text-decoration:line-through}
.cell.vote{outline:3px solid var(--t);outline-offset:1px}
.cell .vc{position:absolute;top:2px;inset-inline-end:3px;font-size:10px;background:var(--t);color:#fff;border-radius:6px;padding:0 4px}
.cell:disabled{opacity:1}
.form{display:grid;gap:10px}
.nums{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}
.nums button{padding:12px 0;border-radius:12px;background:var(--card2);font-weight:900;font-size:18px}.nums button.on{background:var(--t);color:#fff}
.note{font-size:13px;color:var(--muted);text-align:center;margin:8px 0}
.center{text-align:center}.center h2{margin:6px 0}.center p{color:var(--muted);margin:6px 0}
.big-e{font-size:52px;line-height:1;margin:10px 0 4px}
.hist{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}.hist span{padding:4px 10px;border-radius:99px;background:color-mix(in srgb,var(--t) 22%,var(--card2));font-weight:700;font-size:13px;unicode-bidi:plaintext}
.ghost.wide{width:100%;padding:13px;font-size:16px}
`;

const BODY = `
<div class="hi"><span data-t="hi"></span> <b id="who" dir="auto"></b><button id="rename" data-t="change"></button></div>
<div id="view"></div>
`;

function script() {
  const { $, t, el, ls } = P;
  let myTeam = ls.get('cw.team.' + P.room) || '', myRole = ls.get('cw.role.' + P.room) || '', num = null, clueTxt = '', gotAt = Date.now(), lastSend = 0;
  const COL = { r: 'var(--red)', b: 'var(--blue)' };
  const teamOf = (id) => ((P.view && P.view.teams) || []).find((x) => x.id === id);
  const tn = (id) => t(id === 'r' ? 'redT' : 'blueT');
  async function act(type, data) { try { return await P.act(type, data); } catch (e) { P.toast(e.message, true); return null; } }
  async function join() { await act('team', { team: myTeam, role: myRole }); }
  function setTeam(id) { myTeam = id; ls.set('cw.team.' + P.room, id); join(); draw(); }
  function setRole(r) { myRole = r; ls.set('cw.role.' + P.room, r); join(); P.vibrate(15); draw(); }
  const wordInp = el('input', { class: 'in', dir: 'auto', maxlength: '120', autocomplete: 'off' });
  const clueInp = el('input', { class: 'in', dir: 'auto', maxlength: '30', autocomplete: 'off', enterkeyhint: 'send' });
  clueInp.oninput = () => { clueTxt = clueInp.value; };
  function grid(v, opts) {
    const g = el('div', { class: 'grid', dir: 'ltr' });   // the same places as on the display, in every language
    const key = v.key, votes = v.votes || {};
    (v.board || []).forEach((c, i) => {
      let cls = 'cell';
      if (c.c) cls += ' rev c-' + c.c;
      if (key) cls += ' k-' + key[i];
      if (v.myVote === i) cls += ' vote';
      const fs = c.w.length <= 6 ? 13 : c.w.length <= 8 ? 12 : c.w.length <= 10 ? 10.5 : 9.5;
      const b = el('button', { class: cls, dir: 'auto', style: 'font-size:' + fs + 'px', disabled: !opts.vote || !!c.c, onclick: () => { if (opts.vote) { P.vibrate(15); act('vote', { idx: i }); } } }, c.w,
        votes[i] ? el('span', { class: 'vc', text: String(votes[i]) }) : null);
      g.append(b);
    });
    return g;
  }
  function draw() {
    const v = P.view, box = $('#view');
    const focusOn = document.activeElement;
    box.textContent = '';
    if (!v) { box.append(el('div', { class: 'card center' }, el('div', { class: 'big-e', text: '🕵️' }), el('p', { text: t('wait') }))); return; }
    const me = v.me;
    if (me && me.team && myTeam !== me.team && myTeam !== '') { myTeam = me.team; ls.set('cw.team.' + P.room, myTeam); }
    if (me && me.role && myRole !== me.role) { myRole = me.role; ls.set('cw.role.' + P.room, myRole); }
    if (!myTeam || (myTeam === 'auto' && !me)) {
      box.append(el('div', { style: 'font-weight:800;margin:4px 4px 10px', text: t('pick') }));
      const g = el('div', { class: 'teams' });
      for (const tm of v.teams || []) g.append(el('button', { class: 'tbtn', '--t': COL[tm.id], onclick: () => setTeam(tm.id) }, el('span', { class: 'sw' }), tn(tm.id),
        el('span', { dir: 'auto', text: (tm.players || []).map((p) => (p.role === 'spy' ? '★ ' : '') + p.name).join(', ') || '—' })));
      g.append(el('button', { class: 'tbtn auto', onclick: () => setTeam('auto') }, '🎲 ' + t('auto')));
      box.append(g); return;
    }
    const team = (me && me.team) || (myTeam !== 'auto' ? myTeam : '');
    document.body.style.setProperty('--t', COL[team] || 'var(--c)');
    const tm = teamOf(team);
    if (v.phase === 'lobby' && (!myRole || !me || !me.role)) {
      const spyTaken = tm && (tm.players || []).find((p) => p.role === 'spy' && !(me && me.role === 'spy'));
      box.append(el('div', { class: 'teambar', '--t': COL[team] }, el('span', { class: 'sw' }), el('b', { text: tn(team) }), el('button', { class: 'ghost', text: t('change'), onclick: () => { myTeam = ''; draw(); } })),
        el('div', { style: 'font-weight:800;margin:4px 4px 10px', text: t('role') }),
        el('div', { class: 'roles' },
          el('button', { class: 'rbtn' + (myRole === 'spy' ? ' on' : ''), onclick: () => setRole('spy') }, el('i', { text: '🕵️' }), el('div', {}, el('b', { text: t('spy') }), el('span', { dir: 'auto', text: spyTaken ? t('taken', { name: spyTaken.name }) : t('spySub') }))),
          el('button', { class: 'rbtn' + (myRole === 'op' ? ' on' : ''), onclick: () => setRole('op') }, el('i', { text: '🔎' }), el('div', {}, el('b', { text: t('op') }), el('span', { text: t('opSub') })))));
      return;
    }
    box.append(el('div', { class: 'teambar', '--t': COL[team] }, el('span', { class: 'sw' }), el('b', { text: tn(team) }), el('small', { text: me && me.role === 'spy' ? '🕵️ ' + t('spy') : '🔎 ' + t('op') }),
      v.phase === 'lobby' ? el('button', { class: 'ghost', text: t('change'), onclick: () => { myRole = ''; ls.set('cw.role.' + P.room, ''); myTeam = ''; draw(); } }) : null));
    if (v.phase === 'lobby') {
      box.append(el('div', { class: 'card center' }, el('div', { class: 'big-e', text: '🎉' }), el('p', { text: t('lobby') })));
      if (v.custom) {
        const btn = el('button', { class: 'big', text: t('add'), onclick: async () => { if (!wordInp.value.trim()) return; const r = await act('word', { text: wordInp.value }); if (r) { wordInp.value = ''; P.toast(t('added')); } wordInp.focus(); } });
        wordInp.placeholder = t('wordPh');
        box.append(el('section', { class: 'card' }, el('label', { class: 'l', text: t('words') }), el('p', { class: 'sub', style: 'margin:-4px 0 10px', text: t('wordsSub') }), wordInp, btn));
        if (focusOn === wordInp) wordInp.focus({ preventScroll: true });
      }
      return;
    }
    const isSpy = me && me.role === 'spy', myTurn = v.turn === team;
    const turnCol = COL[v.turn];
    // the clue banner
    if (v.phase === 'over') {
      box.append(el('div', { class: 'card center', style: '--t:' + COL[v.winner] + ';border-color:var(--t)' }, el('div', { class: 'big-e', text: v.winner === team ? '🏆' : v.reason === 'assassin' ? '💀' : '👏' }),
        el('h2', { text: t('win', { team: tn(v.winner) }) }), v.reason === 'assassin' ? el('p', { text: t('assassin') }) : null, el('p', { text: t('newSoon') })));
    } else if (v.clue) {
      box.append(el('div', { class: 'clue', style: '--t:' + turnCol }, el('span', { dir: 'auto', text: v.clue.word || '?' }), el('span', { class: 'n', text: v.clue.n < 0 ? '∞' : String(v.clue.n) })));
    } else {
      box.append(el('div', { class: 'clue wait' }, t('turnOf', { team: tn(v.turn) }) + ' · ' + t('thinking')));
    }
    if (v.phase !== 'over') {
      const tl = v.timer ? el('span', { id: 'tm' }) : null;
      const r = teamOf('r'), b = teamOf('b');
      box.append(el('div', { class: 'meta' }, el('span', {}, '🟥 ', el('b', { text: String(r ? r.left : '') })), v.phase === 'guess' ? el('span', { text: v.guessesLeft == null ? t('unlimited') : t('guessesLeft', { n: v.guessesLeft }) }) : tl || el('span'),
        el('span', {}, el('b', { text: String(b ? b.left : '') }), ' 🟦')));
      if (v.phase === 'guess' && tl) box.append(el('div', { class: 'meta', style: 'justify-content:center' }, tl));
    }
    const canVote = v.phase === 'guess' && v.guess === 'phones' && !isSpy && myTurn;
    box.append(grid(v, { vote: canVote }));
    if (isSpy && v.phase !== 'over') box.append(el('p', { class: 'note', text: '🔒 ' + t('keyNote') }));
    if (isSpy && myTurn && v.phase === 'clue') {
      const nums = el('div', { class: 'nums' });
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, -1]) nums.append(el('button', { class: num === n ? 'on' : '', text: n < 0 ? '∞' : String(n), onclick: () => { num = n; draw(); } }));
      clueInp.placeholder = t('clueWord'); clueInp.value = clueTxt;
      const send = el('button', { class: 'big', text: t('send'), disabled: num == null, onclick: async () => {
        if (!clueInp.value.trim() || num == null) return;
        const r = await act('clue', { word: clueInp.value.trim(), n: num });
        if (r) { clueTxt = ''; clueInp.value = ''; num = null; P.vibrate(30); P.toast(t('sent')); }
      } });
      box.append(el('section', { class: 'card form' }, el('label', { class: 'l', text: t('yourClue') }), clueInp, el('label', { class: 'l', text: t('number') }), nums, send));
      if (focusOn === clueInp) clueInp.focus({ preventScroll: true });
    } else if (canVote) {
      box.append(el('p', { class: 'note', text: v.myVote != null ? t('voted') : t('tapVote') }), el('button', { class: 'ghost wide' + (v.myVote === -1 ? ' on' : ''), text: '⏭ ' + t('endTurn') + ((v.votes || {})[-1] ? ' · ' + v.votes[-1] : ''), onclick: () => act('vote', { idx: -1 }) }));
    } else if (!isSpy && v.phase === 'guess' && myTurn) {
      box.append(el('p', { class: 'note', text: '👆 ' + t('watch') }));
    }
    if ((v.history || []).length) box.append(el('div', { class: 'hist' }, ...(v.history || []).slice(-8).map((x) => el('span', { dir: 'auto', style: '--t:' + COL[x.team], text: x.word + ' ' + (x.n < 0 ? '∞' : x.n) }))));
    tick();
  }
  function tick() {
    const v = P.view, e = document.getElementById('tm');
    if (!e || !v || !v.timer) return;
    const left = Math.max(0, v.timer.left - (Date.now() - gotAt));
    const s = Math.ceil(left / 1000);
    e.textContent = '⏱ ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  setInterval(tick, 500);
  P.on('state', (v) => {
    gotAt = Date.now();
    if (v && P.name && myTeam && (!v.me || (myRole && v.me.role !== myRole && v.phase === 'lobby' && !draw.err)) && Date.now() - lastSend > 4000) { lastSend = Date.now(); join(); }
    // don't wipe the clue box while typing
    const typing = document.activeElement === clueInp || document.activeElement === wordInp;
    if (typing && draw.sig === sig(v)) return;
    draw.sig = sig(v);
    draw();
  });
  const sig = (v) => v ? [v.phase, v.turn, v.me && v.me.team, v.me && v.me.role, JSON.stringify(v.board), v.custom, v.myVote, JSON.stringify(v.votes), v.clue && v.clue.word].join('|') : '';
  P.on('reply', (d) => { if (d && d.type === 'err') { P.toast(d.msg, true); if (d.role) { myRole = d.role; ls.set('cw.role.' + P.room, myRole); draw(); } } });
  P.on('render', draw);
  if (myTeam) setTimeout(join, 400);
}

const PAGE = phonePage({ app: 'codewords', title: 'Code Words', color: '#ef4444', glyph: '⌗', css: CSS, body: BODY, i18n: I18N, script });
export const route = partyApp({ name: 'codewords', page: PAGE, personalize, accept });
