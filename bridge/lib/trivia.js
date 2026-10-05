// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Trivia Night (apps/trivia.js): phones are buzzers and answer pads. The display runs the quiz and publishes the
// question; the bridge stamps every buzz / answer with its own monotonic clock the moment it arrives, so the first
// buzz to reach the bridge wins — no matter how slow the display is — and multiple-choice speed points are measured
// from when the bridge published the question. Routes: see lib/party.js (GET /trivia?r=<room>, /api/trivia/…).
//   ?host=<room key> on the phone page opens "host mode" — add your own questions from a phone.
import { partyApp, phonePage, HttpErr, str, nowHr } from './party.js';

const TYPES = new Set(['join', 'team', 'buzz', 'answer', 'addq']);

function onState(room, s) {
  if (!s) return;
  if (s.buzz?.id && s.buzz.open && room.data.buzz?.id !== s.buzz.id) room.data.buzz = { id: s.buzz.id, openHr: nowHr(), order: [], byDevice: new Map(), teams: new Map() };
  if (s.phase === 'question' && s.q?.id && room.data.q?.id !== s.q.id) room.data.q = { id: s.q.id, openHr: nowHr(), answers: new Map() };
}

function accept(room, act, ctx) {
  if (!TYPES.has(act.type)) throw new HttpErr(400, 'unknown action');
  const s = room.state;
  const teamOk = (t) => (s?.teams || []).some((x) => x.id === t);
  if (act.type === 'addq') {
    if (!ctx.key || ctx.key !== room.key) throw new HttpErr(403, 'Only the host can add questions');
    act.q = str(act.q, 300); act.a = str(act.a, 120);
    act.wrong = (Array.isArray(act.wrong) ? act.wrong : []).map((w) => str(w, 120)).filter(Boolean).slice(0, 3);
    act.cat = str(act.cat, 20); act.lang = act.lang === 'he' ? 'he' : 'en'; act.d = [1, 2, 3].includes(+act.d) ? +act.d : 2;
    if (!act.q || !act.a) throw new HttpErr(400, 'Write the question and its answer');
    return {};
  }
  if (act.type === 'join' || act.type === 'team') {
    act.team = str(act.team, 12);
    if (act.team && !teamOk(act.team)) act.team = '';
    return {};
  }
  if (!s) throw new HttpErr(409, 'The quiz hasn’t started');
  if (act.type === 'buzz') {
    const B = room.data.buzz;
    act.bid = str(act.bid, 40); act.team = str(act.team, 12);
    if (s.phase !== 'question' || !s.buzz?.open || !B || B.id !== act.bid || s.buzz.id !== act.bid) throw new HttpErr(409, 'Buzzers are closed');
    if (!teamOk(act.team)) throw new HttpErr(400, 'Pick a team first');
    if ((s.buzz.locked || []).includes(act.team)) throw new HttpErr(409, 'Your team is out on this question');
    const mine = B.byDevice.get(act.device);
    if (mine) { act.drop = true; return { rank: mine.rank, ms: mine.ms, again: true }; }
    const ms = Math.max(0, act.hr - B.openHr);
    const teamRank = B.teams.get(act.team);
    const rank = teamRank || B.teams.size + 1;
    const e = { device: act.device, team: act.team, ms, rank };
    B.byDevice.set(act.device, e); B.order.push(e);
    if (!teamRank) B.teams.set(act.team, rank); else { act.drop = true; return { rank, ms, teammate: true }; }
    act.rank = rank; act.ms = Math.round(ms);
    const first = B.order[0];
    return { rank, ms: Math.round(ms), behind: rank > 1 ? Math.round(ms - first.ms) : 0 };
  }
  if (act.type === 'answer') {
    const Q = room.data.q;
    act.qid = str(act.qid, 40); act.choice = Math.round(+act.choice);
    if (s.phase !== 'question' || s.mode !== 'mc' || !Q || Q.id !== act.qid || s.q?.id !== act.qid) throw new HttpErr(409, 'Too late — the question is closed');
    if (!(act.choice >= 0 && act.choice < (s.q.opts || []).length)) throw new HttpErr(400, 'Pick an answer');
    if (Q.answers.has(act.device)) throw new HttpErr(409, 'You already answered');
    const ms = Math.max(0, act.hr - Q.openHr);
    if (s.q.limit && ms > s.q.limit * 1000 + 900) throw new HttpErr(409, 'Too late — time is up');
    Q.answers.set(act.device, { choice: act.choice, ms });
    act.ms = Math.round(ms);
    return { ms: act.ms };
  }
  return {};
}

function personalize(s, device) {
  if (!s) return null;
  const { players = {}, answers, pts, ...rest } = s;
  const teams = (s.teams || []).map((t) => ({ ...t, players: Object.values(players).filter((p) => p.team === t.id).map((p) => p.name) }));
  return { ...rest, teams, me: players[device] || null, myAnswer: answers?.[device] ?? null, myPts: pts?.[device] ?? null, nPlayers: Object.keys(players).length };
}

const I18N = {
  en: { title: 'Trivia Night', pickTeam: 'Pick your team', change: 'change', team: 'Team', lobby: 'You’re in! 🎉', lobbySub: 'Waiting for the host to start the quiz…',
    buzz: 'BUZZ', first: 'You’re first! 🎉', firstSub: 'Answer out loud', rank: 'You were #{n}', behind: '{ms} s after the first buzz', teammate: 'Your teammate buzzed first',
    out: 'Your team is out on this one', wait: 'Get ready…', buzzedBy: '{t} buzzed first', answering: '{n} is answering', yourTeam: 'Your team is answering!',
    locked: 'Locked in ✓', pick: 'Tap your answer', timeUp: 'Time’s up', correct: 'Correct!', wrong: 'Not this time', answer: 'The answer: {a}', pts: '+{n} points', noAns: 'No answer',
    scores: 'Scores', round: 'Round {r} of {n}', final: 'Final standings', place1: 'Your team won!', placeN: 'Your team came #{n}', remote: 'This round is played on the big screen — pass the remote!',
    q: 'Question {i} of {n}', host: 'Add questions', hostSub: 'They go into the host’s own question list.', question: 'Question', right: 'Correct answer', wrongs: 'Wrong answers (optional — 3 for multiple choice)',
    cat: 'Category', lang: 'Language', add: 'Add question', added: 'Added ✓ ({n} so far)', diff: 'Difficulty', easy: 'Easy', med: 'Medium', hard: 'Hard', players: '{n} players' },
  he: { title: 'ערב טריוויה', pickTeam: 'בחרו קבוצה', change: 'שינוי', team: 'קבוצה', lobby: 'אתם בפנים! 🎉', lobbySub: 'מחכים שהמנחה יתחיל את החידון…',
    buzz: 'באזז', first: 'הייתם ראשונים! 🎉', firstSub: 'ענו בקול', rank: 'הייתם במקום {n}', behind: '{ms} שנ׳ אחרי הראשון', teammate: 'חבר קבוצה לחץ ראשון',
    out: 'הקבוצה שלכם בחוץ בשאלה הזאת', wait: 'היכונו…', buzzedBy: '{t} לחצו ראשונים', answering: '{n} עונה', yourTeam: 'הקבוצה שלכם עונה!',
    locked: 'נקלט ✓', pick: 'בחרו תשובה', timeUp: 'נגמר הזמן', correct: 'נכון!', wrong: 'לא הפעם', answer: 'התשובה: {a}', pts: '+{n} נקודות', noAns: 'לא עניתם',
    scores: 'ניקוד', round: 'סבב {r} מתוך {n}', final: 'הדירוג הסופי', place1: 'הקבוצה שלכם ניצחה!', placeN: 'הקבוצה שלכם במקום {n}', remote: 'הסבב הזה משוחק על המסך הגדול — מעבירים את השלט!',
    q: 'שאלה {i} מתוך {n}', host: 'הוספת שאלות', hostSub: 'השאלות נכנסות לרשימה של המנחה.', question: 'שאלה', right: 'התשובה הנכונה', wrongs: 'תשובות שגויות (רשות — 3 לשאלה אמריקאית)',
    cat: 'קטגוריה', lang: 'שפה', add: 'הוספת שאלה', added: 'נוספה ✓ ({n} עד עכשיו)', diff: 'רמת קושי', easy: 'קל', med: 'בינוני', hard: 'קשה', players: '{n} שחקנים' },
};

const CSS = `
.teambar{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:16px;background:color-mix(in srgb,var(--t,var(--c)) 20%,var(--card));border:1px solid color-mix(in srgb,var(--t,var(--c)) 50%,transparent);margin-bottom:14px}
.teambar .sw{width:16px;height:16px;border-radius:50%;background:var(--t)}.teambar b{flex:1}.teambar .sc{font-weight:900;font-variant-numeric:tabular-nums}
.teams{display:grid;gap:10px}
.tbtn{display:flex;align-items:center;gap:12px;padding:16px;border-radius:18px;background:var(--card);border:2px solid color-mix(in srgb,var(--t) 60%,transparent);text-align:start}
.tbtn .sw{width:26px;height:26px;border-radius:50%;background:var(--t);flex:none}.tbtn b{font-size:18px;display:block}.tbtn span{font-size:13px;color:var(--muted)}
.tbtn.on{background:color-mix(in srgb,var(--t) 22%,var(--card))}
.qhead{display:flex;justify-content:space-between;color:var(--muted);font-size:13px;font-weight:700;margin:2px 4px 8px}
.qtext{font-size:21px;font-weight:800;line-height:1.3;margin:0 2px 14px;unicode-bidi:plaintext}
.buzz{display:block;width:min(78vw,330px);aspect-ratio:1;margin:18px auto 10px;border-radius:50%;background:radial-gradient(circle at 35% 30%,color-mix(in srgb,var(--t) 70%,#fff),var(--t) 55%,color-mix(in srgb,var(--t) 60%,#000));
  color:#fff;font-size:44px;font-weight:900;letter-spacing:.06em;box-shadow:0 14px 0 color-mix(in srgb,var(--t) 55%,#000),0 22px 40px rgba(0,0,0,.4);transition:transform .06s,box-shadow .06s;text-shadow:0 2px 8px rgba(0,0,0,.35);-webkit-user-select:none;user-select:none}
.buzz:active,.buzz.hit{transform:translateY(10px);box-shadow:0 4px 0 color-mix(in srgb,var(--t) 55%,#000),0 8px 20px rgba(0,0,0,.4)}
.buzz:disabled{filter:grayscale(.85) brightness(.7)}
.res{text-align:center;font-weight:800;font-size:20px;margin:8px 0}.res small{display:block;color:var(--muted);font-weight:600;font-size:14px;margin-top:4px}
.opts{display:grid;gap:10px}
.opt{display:flex;align-items:center;gap:12px;padding:16px 14px;border-radius:16px;background:var(--k);color:#fff;font-weight:800;font-size:17px;text-align:start;min-height:64px;box-shadow:0 5px 0 color-mix(in srgb,var(--k) 60%,#000);transition:transform .08s,opacity .2s}
.opt:active{transform:translateY(3px);box-shadow:0 2px 0 color-mix(in srgb,var(--k) 60%,#000)}
.opt i{font-style:normal;width:34px;height:34px;border-radius:10px;background:rgba(0,0,0,.22);display:grid;place-items:center;flex:none}
.opt span{unicode-bidi:plaintext;flex:1}
.opt.dim{opacity:.35}.opt.mine{outline:4px solid var(--fg);outline-offset:2px}.opt.right{opacity:1;outline:4px solid var(--ok);outline-offset:2px}
.tbar{height:8px;border-radius:9px;background:var(--card2);overflow:hidden;margin:0 2px 14px}.tbar i{display:block;height:100%;background:var(--c);transition:width .25s linear}
.board{display:grid;gap:8px}
.brow{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:var(--card);border:1px solid var(--line);position:relative;overflow:hidden}
.brow .fill{position:absolute;inset:0 auto 0 0;background:color-mix(in srgb,var(--t) 25%,transparent);z-index:0}
[dir=rtl] .brow .fill{inset:0 0 0 auto}
.brow>*:not(.fill){position:relative;z-index:1}.brow .pl{font-weight:900;width:24px}.brow .sw{width:14px;height:14px;border-radius:50%;background:var(--t)}.brow b{flex:1}.brow .sc{font-weight:900;font-variant-numeric:tabular-nums}
.brow.me{border-color:var(--t);border-width:2px}
.big-e{font-size:56px;text-align:center;line-height:1;margin:14px 0 8px}
.center{text-align:center}.center h2{margin:4px 0}.center p{color:var(--muted);margin:4px 0}
.form label{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:12px 0 6px}
.form textarea.in{min-height:84px;resize:vertical}
.form .row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.form select.in{appearance:none}
.seg{display:flex;gap:6px}.seg button{flex:1;padding:10px;border-radius:12px;background:var(--card2);font-weight:700}.seg button.on{background:var(--c);color:var(--on-c)}
`;

const BODY = `
<div class="hi"><span data-t="hi"></span> <b id="who" dir="auto"></b><button id="rename" data-t="change"></button></div>
<div id="view"></div>
`;

function script() {
  const { $, t, el, ls } = P;
  const q = new URLSearchParams(location.search);
  const hostKey = q.get('host') || '';
  const OPT = ['#ef4444', '#3b82f6', '#eab308', '#22c55e'];
  let myTeam = ls.get('trivia.team.' + P.room) || '', buzzRes = null, lastBid = null, lastQid = null, gotAt = Date.now(), added = 0, sending = false;
  const teamOf = (id) => (P.view && P.view.teams || []).find((x) => x.id === id);
  const fmtS = (ms) => (ms / 1000).toFixed(2);

  async function setTeam(id) {
    myTeam = id; ls.set('trivia.team.' + P.room, id);
    try { await P.act('team', { team: id }); P.vibrate(15); } catch (e) { P.toast(e.message, true); }
    draw();
  }
  function teamBar(v) {
    const tm = teamOf(myTeam);
    if (!tm) return null;
    return el('div', { class: 'teambar', '--t': tm.color }, el('span', { class: 'sw' }), el('b', { dir: 'auto', text: tm.name }),
      el('span', { class: 'sc', text: String(tm.score || 0) }), el('button', { class: 'ghost', text: t('change'), onclick: () => { myTeam = ''; draw(); } }));
  }
  function board(v, final) {
    const box = el('div', { class: 'board' });
    const teams = (v.teams || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const max = Math.max(1, ...teams.map((x) => x.score || 0));
    teams.forEach((tm, i) => box.append(el('div', { class: 'brow' + (tm.id === myTeam ? ' me' : ''), '--t': tm.color },
      el('span', { class: 'fill', style: 'width:' + Math.max(4, (tm.score || 0) / max * 100) + '%' }),
      el('span', { class: 'pl', text: final ? ['🥇', '🥈', '🥉'][i] || String(i + 1) : String(i + 1) }), el('span', { class: 'sw' }), el('b', { dir: 'auto', text: tm.name }), el('span', { class: 'sc', text: String(tm.score || 0) }))));
    return box;
  }
  function hostView(box) {
    const cats = (P.view && P.view.cats) || [];
    let lang = ls.get('trivia.hlang') || P.lang, d = 2;
    const f = el('div', { class: 'card form' });
    const qi = el('textarea', { class: 'in', dir: 'auto', maxlength: '300' });
    const ai = el('input', { class: 'in', dir: 'auto', maxlength: '120' });
    const wi = [0, 1, 2].map(() => el('input', { class: 'in', dir: 'auto', maxlength: '120' }));
    const cs = el('select', { class: 'in' }, ...cats.map((c) => el('option', { value: c.id, text: lang === 'he' ? c.he || c.name : c.name })));
    const langSeg = el('div', { class: 'seg' }), dSeg = el('div', { class: 'seg' });
    const drawSegs = () => {
      langSeg.textContent = ''; dSeg.textContent = '';
      for (const [k, l] of [['en', 'English'], ['he', 'עברית']]) langSeg.append(el('button', { class: lang === k ? 'on' : '', text: l, onclick: () => { lang = k; ls.set('trivia.hlang', k); drawSegs(); } }));
      for (const [k, l] of [[1, t('easy')], [2, t('med')], [3, t('hard')]]) dSeg.append(el('button', { class: d === k ? 'on' : '', text: l, onclick: () => { d = k; drawSegs(); } }));
    };
    drawSegs();
    const btn = el('button', { class: 'big', text: t('add'), onclick: async () => {
      if (sending) return; sending = true;
      try {
        await P.act('addq', { key: hostKey, q: qi.value, a: ai.value, wrong: wi.map((w) => w.value), cat: cs.value, lang, d });
        added++; qi.value = ''; ai.value = ''; wi.forEach((w) => w.value = ''); P.toast(t('added', { n: added })); P.vibrate(20); qi.focus();
      } catch (e) { P.toast(e.message, true); }
      sending = false;
    } });
    f.append(el('h2', { style: 'margin:0 0 4px', text: t('host') }), el('p', { class: 'sub', text: t('hostSub') }),
      el('label', { text: t('question') }), qi, el('label', { text: t('right') }), ai, el('label', { text: t('wrongs') }), ...wi,
      el('label', { text: t('cat') }), cs, el('label', { text: t('lang') }), langSeg, el('label', { text: t('diff') }), dSeg, btn);
    box.append(f);
  }

  function draw() {
    const v = P.view, box = $('#view'); box.textContent = '';
    if (hostKey) { hostView(box); return; }
    if (!v) { box.append(el('div', { class: 'card center' }, el('div', { class: 'big-e', text: '🧠' }), el('p', { text: t('lobbySub') }))); return; }
    if (v.mode === 'remote') { box.append(el('div', { class: 'card center' }, el('div', { class: 'big-e', text: '📺' }), el('p', { text: t('remote') }))); if (v.teams && v.phase !== 'lobby') box.append(board(v, v.phase === 'final')); return; }
    if (v.me && v.me.team && !myTeam) { myTeam = v.me.team; ls.set('trivia.team.' + P.room, myTeam); }
    if (!teamOf(myTeam)) {
      box.append(el('div', { class: 'lead', style: 'font-weight:800;margin:4px 4px 10px', text: t('pickTeam') }));
      const g = el('div', { class: 'teams' });
      for (const tm of v.teams || []) g.append(el('button', { class: 'tbtn', '--t': tm.color, onclick: () => setTeam(tm.id) }, el('span', { class: 'sw' }),
        el('div', {}, el('b', { dir: 'auto', text: tm.name }), el('span', { dir: 'auto', text: (tm.players || []).join(', ') || '—' }))));
      box.append(g); return;
    }
    const tm = teamOf(myTeam);
    document.body.style.setProperty('--t', tm.color);
    box.append(teamBar(v));
    const head = v.q ? el('div', { class: 'qhead' }, el('span', { text: t('round', { r: v.round, n: v.rounds }) }), el('span', { text: t('q', { i: v.qn, n: v.per }) })) : null;
    if (v.phase === 'lobby') {
      box.append(el('div', { class: 'card center' }, el('div', { class: 'big-e', text: '🎉' }), el('h2', { text: t('lobby') }), el('p', { text: t('lobbySub') })));
      box.append(board(v)); return;
    }
    if (v.phase === 'scores' || v.phase === 'final') {
      const final = v.phase === 'final';
      const place = (v.teams || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0)).findIndex((x) => x.id === myTeam) + 1;
      box.append(el('div', { class: 'card center' }, el('div', { class: 'big-e', text: final ? (place === 1 ? '🏆' : '👏') : '📊' }),
        el('h2', { text: final ? (place === 1 ? t('place1') : t('placeN', { n: place })) : t('scores') }), el('p', { text: final ? t('final') : t('round', { r: v.round, n: v.rounds }) })));
      box.append(board(v, final)); return;
    }
    if (!v.q) return;
    if (v.q.id !== lastQid) { lastQid = v.q.id; buzzRes = null; }
    box.append(head, el('div', { class: 'qtext', dir: 'auto', text: v.q.text }));
    if (v.mode === 'buzzer') {
      const bz = v.buzz || {};
      if (bz.id !== lastBid) { lastBid = bz.id; buzzRes = null; }
      const out = (bz.locked || []).includes(myTeam);
      if (v.phase === 'question') {
        const b = el('button', { class: 'buzz', '--t': tm.color, disabled: !bz.open || out || !!buzzRes, text: t('buzz') });
        b.addEventListener('pointerdown', async (e) => {
          e.preventDefault(); if (b.disabled) return;
          b.classList.add('hit'); P.vibrate(40); P.beep(660, 0.12, 'square', 0.12);
          try { const r = await P.act('buzz', { bid: bz.id, team: myTeam }); buzzRes = r; if (r.rank === 1 && !r.teammate) { P.beep(988, 0.2, 'triangle'); P.vibrate([60, 40, 60]); } }
          catch (x) { P.toast(x.message, true); }
          draw();
        });
        box.append(b);
        if (out) box.append(el('div', { class: 'res', text: t('out') }));
        else if (buzzRes) box.append(el('div', { class: 'res' }, buzzRes.teammate ? t('teammate') : buzzRes.rank === 1 ? t('first') : t('rank', { n: buzzRes.rank }),
          el('small', { text: buzzRes.rank === 1 && !buzzRes.teammate ? t('firstSub') : buzzRes.behind ? t('behind', { ms: fmtS(buzzRes.behind) }) : '' })));
        else if (!bz.open) box.append(el('div', { class: 'res', text: t('wait') }));
      } else if (v.phase === 'buzzed' && bz.first) {
        const ft = teamOf(bz.first.team);
        const mine = bz.first.team === myTeam;
        box.append(el('div', { class: 'card center', style: '--t:' + (ft ? ft.color : 'var(--c)') + ';border-color:var(--t)' }, el('div', { class: 'big-e', text: mine ? '🎤' : '⏳' }),
          el('h2', { dir: 'auto', text: mine ? t('yourTeam') : t('buzzedBy', { t: ft ? ft.name : '' }) }), el('p', {}, el('bdi', { text: bz.first.name }), ' ' + t('answering', { n: '' }).trim() + ' · ' + fmtS(bz.first.ms) + ' s')));
      } else if (v.phase === 'reveal') reveal(v, box);
      return;
    }
    // multiple choice
    const r = v.phase === 'reveal' ? v.reveal : null;
    if (v.phase === 'question' && v.q.limit) {
      const bar = el('div', { class: 'tbar' }, el('i', { id: 'tb' })); box.append(bar); tick();
    }
    const opts = el('div', { class: 'opts' });
    (v.q.opts || []).forEach((o, i) => {
      const mine = v.myAnswer === i, cls = 'opt' + (r ? (i === r.ans ? ' right' : ' dim') : v.myAnswer != null && !mine ? ' dim' : '') + (mine ? ' mine' : '');
      opts.append(el('button', { class: cls, '--k': OPT[i], disabled: v.phase !== 'question' || v.myAnswer != null, onclick: async () => {
        try { await P.act('answer', { qid: v.q.id, choice: i }); P.vibrate(25); P.beep(784, 0.08); P.view.myAnswer = i; draw(); } catch (e) { P.toast(e.message, true); }
      } }, el('i', { text: 'ABCD'[i] }), el('span', { dir: 'auto', text: o })));
    });
    box.append(opts);
    if (v.phase === 'question') box.append(el('div', { class: 'res', text: v.myAnswer != null ? t('locked') : t('pick') }));
    if (r) reveal(v, box);
  }
  function reveal(v, box) {
    const r = v.reveal || {};
    const myPts = v.myPts, teamPts = (r.pts || {})[myTeam] || 0;
    const ok = v.mode === 'mc' ? v.myAnswer === r.ans : teamPts > 0;
    box.append(el('div', { class: 'res' }, v.mode === 'mc' && v.myAnswer == null ? t('noAns') : ok ? t('correct') + ' 🎉' : t('wrong'),
      el('small', { dir: 'auto', text: t('answer', { a: r.text || '' }) }),
      (v.mode === 'mc' ? myPts > 0 : teamPts > 0) ? el('small', { text: t('pts', { n: v.mode === 'mc' ? myPts : teamPts }) }) : null));
    if (ok && !reveal.done) { reveal.done = v.q.id; P.vibrate([30, 30, 30]); }
  }
  function tick() {
    const v = P.view, b = document.getElementById('tb');
    if (!b || !v || !v.q || !v.q.limit) return;
    const left = Math.max(0, (v.q.left != null ? v.q.left : v.q.limit * 1000) - (Date.now() - gotAt));
    b.style.width = (left / (v.q.limit * 1000) * 100).toFixed(1) + '%';
  }
  setInterval(tick, 250);
  P.on('state', (v) => { gotAt = Date.now(); if (!hostKey && myTeam && v && v.me && !v.me.team) P.act('team', { team: myTeam }).catch(() => {}); draw(); });
  P.on('render', draw);
  // after a reconnect, tell the display which team we're on
  if (myTeam && !hostKey) setTimeout(() => P.act('team', { team: myTeam }).catch(() => {}), 400);
}

const PAGE = phonePage({ app: 'trivia', title: 'Trivia Night', color: '#3b82f6', glyph: '?', css: CSS, body: BODY, i18n: I18N, script });
export const route = partyApp({ name: 'trivia', page: PAGE, personalize, accept, onState });
