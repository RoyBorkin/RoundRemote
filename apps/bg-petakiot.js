// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → פתקיות (Petakiot, "notes" — the Israeli take on Fishbowl / Salad Bowl). Everyone writes names on
// notes into a bowl; two (or more) teams take timed turns guessing as many notes as they can. Round 1: describe
// freely (without the name), round 2: one word only, round 3: charades — and an optional round 4 (only sounds,
// or one frozen pose under a sheet). The same notes go back into the bowl every round. This page is the bowl
// counter, the turn timer, whose turn / who explains, and the scores per round.
import { h, clear } from '../js/ui/dom.js';
import { openPanel } from '../js/ui/overlay.js';
import { editText } from '../js/ui/keyboard.js';
import { seg, editPlayers, celebrate, confirm, uid } from './bg-ui.js';
import { sandTimer } from './bg-timer.js';

export const PK_ROUNDS = [
  { he: 'תיאור', en: 'Describe', rule: 'Say anything — except the name on the note or any part of it.', ruleHe: 'מתארים במילים, בלי להגיד את השם או חלק ממנו' },
  { he: 'מילה אחת', en: 'One word', rule: 'Exactly one word per note. You may repeat it — but no other words.', ruleHe: 'מילה אחת בלבד לכל פתק' },
  { he: 'פנטומימה', en: 'Charades', rule: 'No words, no sounds — act it out.', ruleHe: 'בלי מילים ובלי קולות — רק תנועות' },
  { he: 'צלילים / סדין', en: 'Sounds or a sheet', rule: 'Optional round: only sounds — or one frozen pose under a sheet.', ruleHe: 'רק צלילים, או תנוחה אחת מתחת לסדין' },
];
const TEAMS0 = () => [
  { id: uid(), name: 'קבוצה א׳', color: '#f59e0b', names: '' }, { id: uid(), name: 'קבוצה ב׳', color: '#8b5cf6', names: '' },
];

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-pk');
  const S = Object.assign({ teams: TEAMS0(), notes: 40, secs: 60, rounds: 3, pass: true, carry: true, round: 0, bowl: 40, cur: 0, scores: {}, turnNo: {}, carryLeft: 0, done: false, hist: [] }, app.data('petakiot', {}));
  const save = () => app.save('petakiot', S);
  let live = false, got = 0, stopCel = null;
  const team = () => S.teams[S.cur % S.teams.length];
  const iso = (t) => `\u2068${t}\u2069`;   // keep Hebrew names from flipping the English around them
  const total = (t) => (S.scores[t.id] || []).reduce((a, b) => a + (b || 0), 0);
  const explainer = (t) => { const n = (t.names || '').split(/[,،\n]+/).map((x) => x.trim()).filter(Boolean); return n.length ? n[(S.turnNo[t.id] || 0) % n.length] : ''; };

  const banner = h('div.bg-pk-banner');
  const scores = h('div.bg-pk-scores');
  const timer = sandTimer(app, { seconds: S.secs, label: 'tap to start', cls: 'bg-pk-timer', onEnd: () => turnOver(), onTap: () => { if (!live && !S.done) { startTurn(); return false; } return true; } });
  const below = h('div.bg-pk-below');
  el.append(banner, scores, timer.el, below);

  function draw() {
    const R = PK_ROUNDS[S.round] || PK_ROUNDS[0], t = team();
    clear(banner);
    banner.append(h('div.bg-pk-rnd', h('b', { dir: 'rtl' }, `סיבוב ${S.round + 1} · ${R.he}`), h('span', `Round ${S.round + 1} of ${S.rounds} · ${R.en}`)), h('div.bg-pk-rule', R.rule));
    clear(scores);
    S.teams.forEach((x, i) => scores.append(h(`button.bg-pk-team${i === S.cur % S.teams.length ? '.on' : ''}`, { type: 'button', '--c': x.color, onclick: () => teamPanel(x) },
      h('span', { dir: 'auto' }, x.name), h('b', String(total(x))))));
    clear(below);
    const ex = explainer(t);
    below.append(h('div.bg-pk-bowl', h('b', String(S.bowl)), h('span', ` / ${S.notes} notes in the bowl`)));
    if (S.done) {
      below.append(h('button.pill.primary.bg-pk-main', { type: 'button', onclick: () => newGame() }, 'New game'));
    } else if (live) {
      below.append(h('div.bg-pk-btns',
        S.pass ? h('button.bg-al-b.no', { type: 'button', onclick: () => pass() }, h('b', 'Pass'), h('small', 'back in the bowl')) : null,
        h('button.bg-al-b.ok', { type: 'button', onclick: () => guessed() }, h('b', 'Guessed'), h('small', `+1 · ${got} this turn`))));
    } else {
      below.append(h('button.pill.primary.bg-pk-main', { type: 'button', '--c': t.color, onclick: () => startTurn() }, h('bdi', `${t.name}${ex ? ` · ${ex}` : ''}`), h('b', S.carryLeft ? ` — go on (${Math.ceil(S.carryLeft)}s)` : ' — start')));
    }
    below.append(h('div.bg-al-small',
      h('button.chip', { type: 'button', disabled: live || !S.hist.length, onclick: () => undo() }, 'Undo'),
      h('button.chip', { type: 'button', disabled: live, onclick: () => settings() }, 'Settings'),
      h('button.chip', { type: 'button', onclick: () => ctx.push({ file: './bg-rulesview.js', title: 'פתקיות', opts: { id: 'petakiot' } }) }, 'Rules')));
  }
  function snap() { S.hist.push(JSON.stringify({ round: S.round, bowl: S.bowl, cur: S.cur, scores: S.scores, turnNo: S.turnNo, carryLeft: S.carryLeft, done: S.done })); if (S.hist.length > 30) S.hist.shift(); }
  function startTurn() {
    if (live || S.done) return;
    snap(); live = true; got = 0;
    timer.reset(S.secs);
    if (S.carryLeft > 0) { timer.left = S.carryLeft; S.carryLeft = 0; }
    timer.start(); save(); draw();
  }
  function guessed() {
    if (!live) return;
    const t = team();
    const arr = (S.scores[t.id] ||= []); arr[S.round] = (arr[S.round] || 0) + 1;
    got++; S.bowl = Math.max(0, S.bowl - 1); app.sfx('score');
    if (S.bowl === 0) return roundOver();
    save(); draw();
  }
  function pass() { if (live) { app.sfx('whoosh'); app.toast('Fold it and put it back in the bowl'); } }
  function endTurnState() { live = false; const t = team(); S.turnNo[t.id] = (S.turnNo[t.id] || 0) + 1; }
  function turnOver() {
    if (!live) return;
    endTurnState();
    app.toast(`Time! ${iso(team().name)}: ${got} this turn`, { ms: 2400 });
    S.cur = (S.cur + 1) % S.teams.length;
    timer.reset(S.secs); save(); draw();
  }
  function roundOver() {
    const left = timer.left;
    timer.pause();
    live = false;
    const t = team();
    app.sfx('perfect');
    if (S.round + 1 >= S.rounds) {
      endTurnState(); S.done = true; save(); draw();
      const best = Math.max(...S.teams.map(total)), w = S.teams.filter((x) => total(x) === best);
      app.sfx('win');
      stopCel = celebrate(el, w.length > 1 ? 'A tie!' : `${w[0].name} wins!`, w[0].color, S.teams.map((x) => `${x.name} ${total(x)}`).join(' · '));
      return;
    }
    S.round++; S.bowl = S.notes;
    if (S.carry && left >= 1) S.carryLeft = left;      // the same team carries on in the next round with the time it had left
    else { endTurnState(); S.cur = (S.cur + 1) % S.teams.length; S.carryLeft = 0; }
    timer.reset(S.secs); save(); draw();
    const R = PK_ROUNDS[S.round];
    app.toast(`The bowl is empty! Round ${S.round + 1}: ${R.en}${S.carryLeft ? ` — ${iso(t.name)} goes on` : ''}`, { ms: 3200 });
  }
  function undo() {
    const s = S.hist.pop(); if (!s) return;
    Object.assign(S, JSON.parse(s)); S.done = !!S.done; save(); timer.reset(S.secs); draw(); app.sfx('drop');
  }
  function newGame() { S.round = 0; S.bowl = S.notes; S.cur = 0; S.scores = {}; S.turnNo = {}; S.carryLeft = 0; S.done = false; S.hist = []; save(); timer.reset(S.secs); draw(); }
  function teamPanel(t) {
    openPanel({
      title: t.name, className: 'bg-ed-panel',
      build(body) {
        const sc = S.scores[t.id] || [];
        body.append(h('div.bg-ed-list', Array.from({ length: S.rounds }, (_, i) => h('div.bg-ed-row', h('b', `Round ${i + 1} · ${PK_ROUNDS[i].en}`), h('small', { dir: 'rtl' }, `${PK_ROUNDS[i].he} · ${sc[i] || 0} פתקים`)))),
          h('div.bg-pk-tot', `Total ${total(t)}`),
          h('button.pill.small', { type: 'button', onclick: async () => { const v = await editText({ title: `${t.name}: players (comma separated)`, value: t.names || '', placeholder: 'Dana, Avi, Noa' }); if (v !== null) { t.names = v.slice(0, 200); save(); draw(); } } }, t.names ? `Players: ${t.names}` : 'Add the players (who explains)'));
      },
    });
  }
  function settings() {
    openPanel({
      title: 'פתקיות · settings', className: 'bg-ed-panel',
      build(body, panel) {
        const redraw = () => { S.bowl = S.round === 0 && !Object.keys(S.scores).length ? S.notes : Math.min(S.bowl, S.notes); save(); timer.reset(S.secs); draw(); };
        body.append(
          h('div.bg-sect', 'Notes in the bowl'), seg([20, 30, 40, 50, 60, 80].map((v) => ({ v, label: String(v) })), S.notes, (v) => { S.notes = v; redraw(); }),
          h('div.bg-note', 'Usually 4–6 notes per player.'),
          h('div.bg-sect', 'Turn time'), seg([30, 45, 60, 90].map((v) => ({ v, label: `${v}s` })), S.secs, (v) => { S.secs = v; redraw(); }),
          h('div.bg-sect', 'Rounds'), seg([{ v: 3, label: '3 rounds' }, { v: 4, label: '+ sounds / sheet' }], S.rounds, (v) => { S.rounds = v; redraw(); }),
          h('div.bg-sect', 'Rules'),
          h('div.bg-mk-chips',
            h(`button.chip${S.pass ? '.on' : ''}`, { type: 'button', onclick: (e) => { S.pass = !S.pass; e.currentTarget.classList.toggle('on', S.pass); redraw(); } }, 'Passing allowed'),
            h(`button.chip${S.carry ? '.on' : ''}`, { type: 'button', onclick: (e) => { S.carry = !S.carry; e.currentTarget.classList.toggle('on', S.carry); redraw(); } }, 'Leftover time carries on')),
          h('div.bg-mk-chips',
            h('button.chip', { type: 'button', onclick: () => { panel.close(); editPlayers(app, { title: 'Teams', players: S.teams, min: 2, max: 4, onChange: () => { save(); draw(); } }); } }, `Teams (${S.teams.length})`),
            h('button.chip', { type: 'button', onclick: async () => { panel.close(); if (await confirm('New game', 'Clear the scores and fill the bowl again?', 'New game')) newGame(); } }, 'New game')));
      },
    });
  }

  draw();
  return {
    back() { if (live) { confirm('Stop this turn?', 'The notes guessed so far stay counted.', 'Stop turn').then((ok) => { if (ok) { timer.pause(); turnOver(); } }); return true; } return false; },
    key(e) {
      if (live) {
        if (e.key === 'ArrowRight') { guessed(); return true; }
        if (e.key === 'ArrowLeft') { pass(); return true; }
        if (e.key === 'Enter' || e.key === ' ') { timer.toggle(); return true; }
        return false;
      }
      if (e.key === 'Enter' || e.key === ' ') { if (S.done) newGame(); else startTurn(); return true; }
      return false;
    },
    destroy() { timer.destroy(); stopCel?.(); },
  };
}
