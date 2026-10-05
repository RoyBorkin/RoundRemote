// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Alias (אליאס): the team race around the board. A turn = the sand timer; the explaining team
// counts words guessed (+1 each) and skipped (−1 each, can be switched off); when time runs out the last word is
// open to everyone and whichever team shouts it first moves 1. The board is a ring of spaces; first team to the
// finish wins. Optional practice words (our own English / Hebrew lists) for playing without the cards.
import { h, clear } from '../js/ui/dom.js';
import { seg, editPlayers, celebrate, confirm, choose, uid } from './bg-ui.js';
import { openPanel } from '../js/ui/overlay.js';
import { sandTimer } from './bg-timer.js';
import { WORDS_EN, WORDS_HE } from './bg-alias-words.js';

const TEAMS0 = () => [
  { id: uid(), name: 'Red team', color: '#ef4444' }, { id: uid(), name: 'Blue team', color: '#3b82f6' }, { id: uid(), name: 'Green team', color: '#22c55e' },
];
/** Net move for a turn (exported for tests): guessed − skipped (if skips cost), + 1 if the team itself got the last word. */
export const aliasMove = ({ ok, skip, skipCost = true, lastOwn = false }) => ok - (skipCost ? skip : 0) + (lastOwn ? 1 : 0);

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-al');
  const S = Object.assign({ teams: TEAMS0(), pos: {}, cur: 0, len: 40, secs: 60, skipCost: true, words: 'en', hist: [] }, app.data('alias', {}));
  const save = () => app.save('alias', S);
  let T = null;    // the turn in progress: { ok, skip, word }
  let stopCel = null;

  const board = h('div.bg-al-board');
  const center = h('div.bg-al-center');
  const timer = sandTimer(app, { seconds: S.secs, label: 'tap to start', cls: 'bg-al-timer', onEnd: () => timeUp(), onTap: () => { if (!T) { startTurn(); return false; } return true; } });
  el.append(board, center, timer.el);

  // ---------------- the board: spaces around the ring
  const angle = (n) => 48 + (n / S.len) * 264;      // start top-right, clockwise, finish top-left (Back stays clear)
  const at = (n, r) => { const a = angle(n) * Math.PI / 180; return { left: `${50 + r * Math.sin(a)}%`, top: `${50 - r * Math.cos(a)}%` }; };
  function drawBoard() {
    clear(board);
    for (let n = 0; n <= S.len; n++) board.append(h(`i.bg-al-sp${n === 0 ? '.start' : n === S.len ? '.goal' : n % 5 === 0 ? '.five' : ''}`, { style: at(n, 44.5) }, n === 0 ? 'S' : n === S.len ? '★' : n % 5 === 0 ? String(n) : ''));
    const stack = {};
    S.teams.forEach((t, i) => {
      const p = Math.min(S.len, S.pos[t.id] || 0), k = (stack[p] = (stack[p] || 0) + 1) - 1;
      const a = (angle(p) + (k % 2 ? 1 : -1) * (k ? 7.5 : 0)) * Math.PI / 180, r = 38.8 - (k >> 1) * 5;
      board.append(h(`span.bg-al-pawn${i === S.cur % S.teams.length ? '.on' : ''}`, { '--c': t.color, style: { left: `${50 + r * Math.sin(a)}%`, top: `${50 - r * Math.cos(a)}%` } }, t.name.slice(0, 1).toUpperCase()));
    });
  }
  const team = () => S.teams[S.cur % S.teams.length];
  const list = () => (S.words === 'he' ? WORDS_HE : WORDS_EN);
  const pickWord = () => { const l = list(); let w; do { w = l[Math.floor(Math.random() * l.length)]; } while (T && w === T.word && l.length > 1); return w; };

  function drawCenter() {
    clear(center);
    const t = team();
    const running = !!T;
    center.append(h('div.bg-al-team', { '--c': t.color }, h('i'), h('b', t.name), h('span', ` · space ${S.pos[t.id] || 0} / ${S.len}`)));
    if (running && S.words !== 'off') center.append(h('div.bg-al-word', { dir: 'auto', onclick: () => { T.word = pickWord(); drawCenter(); } }, T.word));
    else if (!running) center.append(h('div.bg-al-tip', 'Explain without saying the word, a part of it, a rhyme or a translation.'));
    if (running) {
      center.append(
        h('div.bg-al-count', h('span.ok', `✓ ${T.ok}`), h('b', `${aliasMove({ ok: T.ok, skip: T.skip, skipCost: S.skipCost }) >= 0 ? '+' : ''}${aliasMove({ ok: T.ok, skip: T.skip, skipCost: S.skipCost })}`), h('span.no', `✗ ${T.skip}`)),
        h('div.bg-al-btns',
          h('button.bg-al-b.no', { type: 'button', onclick: () => mark(false) }, h('b', 'Skip'), h('small', S.skipCost ? '−1' : 'free')),
          h('button.bg-al-b.ok', { type: 'button', onclick: () => mark(true) }, h('b', 'Got it'), h('small', '+1'))));
    } else {
      center.append(h('button.pill.primary.bg-al-start', { type: 'button', '--c': t.color, onclick: () => startTurn() }, `Start ${t.name}`));
    }
    center.append(h('div.bg-al-small',
      h('button.chip', { type: 'button', disabled: running || !S.hist.length, onclick: () => undo() }, 'Undo'),
      h('button.chip', { type: 'button', disabled: running, onclick: () => settings() }, 'Settings'),
      h('button.chip', { type: 'button', onclick: () => ctx.push({ file: './bg-rulesview.js', title: 'Alias', opts: { id: 'alias' } }) }, 'Rules')));
  }
  function startTurn() { T = { ok: 0, skip: 0, word: '' }; T.word = pickWord(); timer.reset(S.secs); timer.start(); drawCenter(); }
  function mark(ok) {
    if (!T) return;
    if (ok) { T.ok++; app.sfx('score'); } else { T.skip++; app.sfx('hit'); }
    T.word = pickWord(); drawCenter();
  }
  async function timeUp() {
    if (!T) return;
    const t = team();
    const v = await choose({ title: 'Last word — open to all!', options: [...S.teams.map((x) => ({ v: x.id, label: x.id === t.id ? `${x.name} (explaining team)` : x.name, color: x.color })), { v: 'none', label: 'Nobody got it' }] });
    finish(v && v !== 'none' ? v : null);
  }
  function finish(lastBy) {
    const t = team();
    const move = aliasMove({ ok: T.ok, skip: T.skip, skipCost: S.skipCost, lastOwn: lastBy === t.id });
    const before = { ...S.pos };
    S.pos[t.id] = Math.max(0, Math.min(S.len, (S.pos[t.id] || 0) + move));
    if (lastBy && lastBy !== t.id) S.pos[lastBy] = Math.min(S.len, (S.pos[lastBy] || 0) + 1);
    S.hist.push({ pos: before, cur: S.cur }); if (S.hist.length > 40) S.hist.shift();
    app.toast(`\u2068${t.name}\u2069 ${move >= 0 ? 'moves' : 'goes back'} ${Math.abs(move)}${lastBy && lastBy !== t.id ? ` · \u2068${S.teams.find((x) => x.id === lastBy).name}\u2069 +1 for the last word` : ''}`, { ms: 2800 });
    T = null;
    const w = S.teams.find((x) => (S.pos[x.id] || 0) >= S.len);
    S.cur = (S.cur + 1) % S.teams.length;
    save(); drawBoard(); drawCenter(); timer.reset(S.secs);
    if (w) { app.sfx('win'); stopCel = celebrate(el, `${w.name} wins!`, w.color, 'First to the finish'); }
  }
  function undo() { const l = S.hist.pop(); if (!l) return; S.pos = l.pos; S.cur = l.cur; save(); drawBoard(); drawCenter(); app.sfx('drop'); }
  function settings() {
    openPanel({
      title: 'Alias settings', className: 'bg-ed-panel',
      build(body, panel) {
        const redraw = () => { save(); drawBoard(); drawCenter(); timer.reset(S.secs); };
        body.append(
          h('div.bg-sect', 'Turn time'), seg([30, 45, 60, 90, 120].map((v) => ({ v, label: `${v}s` })), S.secs, (v) => { S.secs = v; redraw(); }),
          h('div.bg-sect', 'Board length'), seg([30, 40, 50, 60].map((v) => ({ v, label: String(v) })), S.len, (v) => { S.len = v; redraw(); }),
          h('div.bg-sect', 'Skipping'), seg([{ v: true, label: 'Costs a point' }, { v: false, label: 'Free' }], S.skipCost, (v) => { S.skipCost = v; redraw(); }),
          h('div.bg-sect', 'Practice words'), seg([{ v: 'en', label: 'English' }, { v: 'he', label: 'עברית' }, { v: 'off', label: 'Off (use the cards)' }], S.words, (v) => { S.words = v; redraw(); }),
          h('div.bg-mk-chips',
            h('button.chip', { type: 'button', onclick: () => { panel.close(); editPlayers(app, { title: 'Teams', players: S.teams, min: 2, max: 6, onChange: () => redraw() }); } }, `Teams (${S.teams.length})`),
            h('button.chip', { type: 'button', onclick: async () => { panel.close(); if (await confirm('New game', 'Move every team back to the start?', 'New game')) { S.pos = {}; S.cur = 0; S.hist = []; redraw(); } } }, 'New game')));
      },
    });
  }

  drawBoard(); drawCenter();
  return {
    back() { if (T) { confirm('Stop this turn?', 'The words counted so far will be lost.', 'Stop turn').then((ok) => { if (ok) { T = null; timer.reset(S.secs); drawCenter(); } }); return true; } return false; },
    key(e) {
      if (T) {
        if (e.key === 'ArrowRight') { mark(true); return true; }
        if (e.key === 'ArrowLeft') { mark(false); return true; }
        if (e.key === 'Enter' || e.key === ' ') { timer.toggle(); return true; }
        return false;
      }
      if (e.key === 'Enter' || e.key === ' ') { startTurn(); return true; }
      return false;
    },
    destroy() { timer.destroy(); stopCel?.(); },
  };
}
