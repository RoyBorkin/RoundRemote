// Board Games → score sheets: Yahtzee (full sheet, upper bonus, Yahtzee bonuses, reads the last 5d6 roll from Dice),
// Uno (round winner collects card values, first to 500) and Rummikub (losers subtract their tiles, winner collects).
import { h, clear } from '../js/ui/dom.js';
import { openPanel } from '../js/ui/overlay.js';
import { numPad, editPlayers, celebrate, confirm, svgIcon, IC, roster, stepper } from './bg-ui.js';
import { lastRoll } from './bg-dice.js';

export function mount(el, ctx, opts = {}) {
  return opts.kind === 'yahtzee' ? yahtzee(el, ctx) : roundSheet(el, ctx, opts.kind === 'uno' ? UNO : RUMMI);
}

// ================================================================ Yahtzee
const UP = [['1', 'Ones', 1], ['2', 'Twos', 2], ['3', 'Threes', 3], ['4', 'Fours', 4], ['5', 'Fives', 5], ['6', 'Sixes', 6]];
const LOW = [['3k', '3 of a kind', 'sum of dice'], ['4k', '4 of a kind', 'sum of dice'], ['fh', 'Full house', '25'], ['ss', 'Sm. straight', '30'], ['ls', 'Lg. straight', '40'], ['y', 'YAHTZEE', '50'], ['ch', 'Chance', 'sum of dice']];
const FIXED = { fh: 25, ss: 30, ls: 40, y: 50 };
export function yahtzeeScore(cat, v) {
  const cnt = {}; for (const x of v) cnt[x] = (cnt[x] || 0) + 1;
  const c = Object.values(cnt).sort((a, b) => b - a), sum = v.reduce((a, b) => a + b, 0), has = (s) => s.every((x) => cnt[x]);
  if (/^[1-6]$/.test(cat)) return (cnt[+cat] || 0) * +cat;
  if (cat === '3k') return c[0] >= 3 ? sum : 0;
  if (cat === '4k') return c[0] >= 4 ? sum : 0;
  if (cat === 'fh') return (c[0] === 3 && c[1] === 2) ? 25 : 0;
  if (cat === 'ss') return (has([1, 2, 3, 4]) || has([2, 3, 4, 5]) || has([3, 4, 5, 6])) ? 30 : 0;
  if (cat === 'ls') return (has([1, 2, 3, 4, 5]) || has([2, 3, 4, 5, 6])) ? 40 : 0;
  if (cat === 'y') return c[0] === 5 ? 50 : 0;
  if (cat === 'ch') return sum;
  return 0;
}
function yahtzee(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-yz');
  const S = Object.assign({ players: roster(app, 2), sc: {} }, app.data('yahtzee', {}));
  const save = () => app.save('yahtzee', S);
  let undo = [], stopCel = null;
  const snap = () => { undo.push(JSON.stringify(S.sc)); if (undo.length > 60) undo.shift(); };
  const sc = (p) => (S.sc[p.id] ||= {});
  const upper = (p) => UP.reduce((a, [k]) => a + (sc(p)[k] || 0), 0);
  const bonus = (p) => (upper(p) >= 63 ? 35 : 0);
  const lower = (p) => LOW.reduce((a, [k]) => a + (sc(p)[k] || 0), 0);
  const total = (p) => upper(p) + bonus(p) + lower(p) + (sc(p).yb || 0) * 100;
  const filled = (p) => [...UP, ...LOW].every(([k]) => sc(p)[k] != null);
  const dice5 = () => (lastRoll.values.length === 5 && lastRoll.types.every((t) => t === 'd6') ? lastRoll.values : null);

  const grid = h('div.bg-clue-grid.bg-yz-grid');
  const rollBtn = h('button.ibtn.bg-ibtn.bg-abs.bg-yz-roll', { type: 'button', 'aria-label': 'Roll 5 dice', html: svgIcon(IC.dice), onclick: () => ctx.openTool('dice', { preset: ['d6', 'd6', 'd6', 'd6', 'd6'] }) });
  const setBtn = h('button.ibtn.bg-ibtn.bg-abs.bg-yz-set', { type: 'button', 'aria-label': 'Sheet settings', html: svgIcon(IC.tune), onclick: () => settings() });
  const diceNote = h('div.bg-yz-dice');
  el.append(grid, rollBtn, setBtn, diceNote);

  function render() {
    const st = grid.scrollTop;
    clear(grid);
    const P = S.players, cols = `minmax(0, 1fr) repeat(${P.length}, ${P.length > 3 ? 8 : 10}cqmin)`;
    const row = (cls, label, sub, cells) => h(`div.bg-clue-row.bg-yz-row${cls}`, { style: { gridTemplateColumns: cols } }, h('div.bg-yz-l', h('b', label), sub ? h('small', sub) : null), cells);
    const cell = (p, k) => { const v = sc(p)[k]; return h(`button.bg-yz-c${v == null ? '.blank' : v === 0 ? '.zero' : ''}`, { type: 'button', onclick: () => choose(p, k) }, v == null ? '' : String(v)); };
    grid.append(h('div.bg-clue-row.head', { style: { gridTemplateColumns: cols } }, h('span'), P.map((p) => h('button.bg-clue-ch', { type: 'button', style: { color: p.color }, onclick: () => editPlayers(app, { players: S.players, min: 1, max: 6, onChange: () => { save(); render(); } }) }, p.name.replace(/^player\s*/i, 'P').slice(0, 6)))));
    grid.append(h('div.bg-clue-sec', 'Upper section'));
    for (const [k, label, n] of UP) grid.append(row('', label, `count × ${n}`, P.map((p) => cell(p, k))));
    grid.append(row('.calc', 'Upper total', '63+ earns the bonus', P.map((p) => h('span.bg-yz-v', String(upper(p))))));
    grid.append(row('.calc', 'Bonus', '+35', P.map((p) => h('span.bg-yz-v', bonus(p) ? '35' : h('small', `${Math.max(0, 63 - upper(p))} to go`)))));
    grid.append(h('div.bg-clue-sec', 'Lower section'));
    for (const [k, label, sub] of LOW) grid.append(row('', label, sub, P.map((p) => cell(p, k))));
    grid.append(row('', 'Yahtzee bonus', '+100 each', P.map((p) => h('button.bg-yz-c', { type: 'button', onclick: () => yBonus(p) }, sc(p).yb ? `${sc(p).yb}×` : ''))));
    grid.append(row('.calc.tot', 'Total', '', P.map((p) => h('span.bg-yz-v', String(total(p))))));
    grid.scrollTop = st;
    const d = dice5();
    diceNote.textContent = d ? `Last roll: ${d.join(' ')}` : 'Roll 5 dice with the dice button';
  }
  function setScore(p, k, v) {
    snap(); if (v == null) delete sc(p)[k]; else sc(p)[k] = v; save(); render(); app.sfx(v ? 'score' : 'tap');
    if (S.players.every(filled)) {
      const w = [...S.players].sort((a, b) => total(b) - total(a))[0];
      app.sfx('win'); stopCel = celebrate(el, `${w.name} wins!`, w.color, `${total(w)} points`);
    }
  }
  function choose(p, k) {
    const isUp = /^[1-6]$/.test(k), d = dice5();
    const label = [...UP, ...LOW].find((x) => x[0] === k)[1];
    openPanel({
      title: `${p.name} · ${label}`, className: 'bg-yz-pick',
      build(body, panel) {
        const pick = (v) => { panel.close(); setScore(p, k, v); };
        const btns = h('div.bg-yz-opts');
        if (d) { const v = yahtzeeScore(k, d); btns.append(h('button.bg-yz-o.dice', { type: 'button', onclick: () => pick(v) }, h('b', String(v)), h('small', `from dice ${d.join('')}`))); }
        if (isUp) for (let i = 0; i <= 5; i++) btns.append(h('button.bg-yz-o', { type: 'button', onclick: () => pick(i * +k) }, h('b', String(i * +k)), h('small', `${i} × ${k}`)));
        else if (FIXED[k]) { btns.append(h('button.bg-yz-o', { type: 'button', onclick: () => pick(FIXED[k]) }, h('b', String(FIXED[k])), h('small', 'scored'))); btns.append(h('button.bg-yz-o', { type: 'button', onclick: () => pick(0) }, h('b', '0'), h('small', 'scratch'))); }
        else {
          btns.append(h('button.bg-yz-o', { type: 'button', onclick: async () => { panel.close(); const v = await numPad({ title: label, value: 0, allowNeg: false, hint: 'Sum of all five dice' }); if (v !== null) setScore(p, k, Math.min(30, v)); } }, h('b', '123'), h('small', 'type it')));
          btns.append(h('button.bg-yz-o', { type: 'button', onclick: () => pick(0) }, h('b', '0'), h('small', 'scratch')));
        }
        body.append(...[btns, sc(p)[k] != null ? h('button.pill.small', { type: 'button', onclick: () => pick(null) }, 'Clear box') : null].filter(Boolean));
      },
    });
  }
  function yBonus(p) {
    openPanel({
      title: `${p.name} · Yahtzee bonus`, className: 'bg-sc-set',
      build(body) {
        body.append(h('div.bg-note', 'Each extra Yahtzee after scoring 50 in the YAHTZEE box earns +100 (then fill another box as a joker).'),
          stepper('Bonus Yahtzees', sc(p).yb || 0, { min: 0, max: 10, onChange: (v) => { snap(); sc(p).yb = v; save(); render(); } }));
      },
    });
  }
  function settings() {
    openPanel({
      title: 'Yahtzee', className: 'bg-sc-set',
      build(body, panel) {
        body.append(
          h('button.bg-row-opt', { type: 'button', onclick: () => { panel.close(); editPlayers(app, { players: S.players, min: 1, max: 6, onChange: () => { save(); render(); } }); } }, h('span', 'Players'), h('b', `${S.players.length} ›`)),
          h('button.bg-row-opt', { type: 'button', disabled: !undo.length, onclick: () => { const s = undo.pop(); if (s) { S.sc = JSON.parse(s); save(); render(); } panel.close(); } }, h('span', 'Undo last entry'), h('b', '↶')),
          h('button.pill.small.danger', { type: 'button', onclick: async () => { panel.close(); if (await confirm('New game', 'Clear the score sheet?', 'Clear')) { snap(); S.sc = {}; save(); render(); } } }, 'New game'));
      },
    });
  }
  render();
  return {
    resume() { render(); },
    key(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { grid.scrollBy({ top: grid.clientHeight * 0.4, behavior: 'smooth' }); return true; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { grid.scrollBy({ top: -grid.clientHeight * 0.4, behavior: 'smooth' }); return true; }
      return false;
    },
    destroy() { stopCel?.(); },
  };
}

// ================================================================ Uno / Rummikub round sheets
const UNO = {
  id: 'uno', title: 'Uno', target: 500, high: true,
  note: 'The player who goes out scores the cards left in everyone else’s hands: number cards at face value, Skip / Reverse / Draw Two 20, Wild & Wild Draw Four 50.',
};
const RUMMI = {
  id: 'rummikub', title: 'Rummikub', target: 0, high: true,
  note: 'When someone goes out, everyone else adds up their tiles (a joker counts 30) and loses that many; the winner gains the total.',
};
function roundSheet(el, ctx, K) {
  const { app } = ctx;
  el.classList.add('bg-rs');
  const S = Object.assign({ players: roster(app, 3), rounds: [], target: K.target }, app.data(K.id, {}));
  const save = () => app.save(K.id, S);
  let stopCel = null;
  const total = (p) => S.rounds.reduce((a, r) => a + (r[p.id] || 0), 0);
  const list = h('div.bg-sc-list.bg-rs-list');
  const info = h('div.bg-sc-info.bg-rs-info');
  const scoreBtn = h('button.pill.primary.bg-sc-next', { type: 'button', onclick: () => scoreRound() }, 'Score a round');
  const ib = (style, label, icn, fn) => h('button.ibtn.bg-ibtn.bg-abs', { type: 'button', 'aria-label': label, style, html: svgIcon(icn), onclick: fn });
  const undoBtn = ib({ left: '23%', top: '79.5%' }, 'Undo', IC.undo, () => { S.rounds.pop(); save(); render(); app.sfx('drop'); });
  el.append(info, list, scoreBtn, undoBtn, ib({ left: '77%', top: '79.5%' }, 'Settings', IC.tune, () => settings()));

  function render() {
    const tots = S.players.map(total), best = Math.max(...tots);
    info.textContent = `Round ${S.rounds.length + 1}${S.target ? ` · first to ${S.target}` : ''}`;
    clear(list);
    const last = S.rounds[S.rounds.length - 1] || {};
    S.players.forEach((p, i) => {
      const lead = S.rounds.length && tots[i] === best;
      const d = last[p.id];
      list.append(h(`div.bg-sc-row.bg-rs-row${lead ? '.lead' : ''}`, { '--c': p.color },
        h('span.bg-rs-dot', { html: lead ? svgIcon(IC.crown) : '' }),
        h('div.bg-sc-mid', h('span.bg-sc-name', h('span', p.name)), h('span.bg-sc-now', d ? `last round ${d > 0 ? '+' : '−'}${Math.abs(d)}` : ' ')),
        h('span.bg-sc-tot', String(tots[i]))));
    });
    undoBtn.disabled = !S.rounds.length;
  }
  function commit(r) {
    S.rounds.push(r); save(); render(); app.sfx('score');
    if (S.target) {
      const w = S.players.find((p) => total(p) >= S.target);
      if (w) { app.sfx('win'); stopCel = celebrate(el, `${w.name} wins!`, w.color, `${total(w)} points`); }
    }
  }
  function scoreRound() {
    openPanel({
      title: 'Who went out?', className: 'bg-choose',
      build(body, panel) {
        const l = h('div.list');
        S.players.forEach((p) => l.append(h('button.row', { type: 'button', onclick: () => { panel.close(); (K.id === 'uno' ? unoCount : rummiCount)(p); } }, h('span.bg-dot', { style: { background: p.color } }), h('div.row-text', h('div.row-title', p.name)))));
        body.append(l, h('div.bg-note', K.note));
      },
    });
  }
  function unoCount(w) {
    openPanel({
      title: `${w.name} went out`, className: 'bg-sc-set bg-uno',
      build(body, panel) {
        let nums = 0;
        const tot = h('div.bg-uno-tot');
        const a = stepper('Skip · Reverse · +2  (20)', 0, { min: 0, max: 60, onChange: upd });
        const wd = stepper('Wild · Wild +4  (50)', 0, { min: 0, max: 40, onChange: upd });
        const numBtn = h('button.bg-row-opt', { type: 'button', onclick: async () => { const v = await numPad({ title: 'Number cards', value: nums, allowNeg: false, hint: 'Add up the face values of all number cards left' }); if (v !== null) { nums = v; numBtn.lastChild.textContent = String(v); upd(); } } }, h('span', 'Number cards (face value)'), h('b', '0'));
        function upd() { tot.textContent = `+${nums + a.get() * 20 + wd.get() * 50}`; }
        upd();
        body.append(h('div.bg-note', 'Cards left in the other players’ hands:'), numBtn, a, wd, tot,
          h('button.pill.primary', { type: 'button', onclick: () => { const r = {}; r[w.id] = nums + a.get() * 20 + wd.get() * 50; panel.close(); commit(r); } }, `Add to ${w.name}`));
      },
    });
  }
  function rummiCount(w) {
    openPanel({
      title: `${w.name} went out`, className: 'bg-sc-set bg-rummi',
      build(body, panel) {
        const vals = {};
        const tot = h('div.bg-uno-tot');
        const rows = S.players.filter((p) => p !== w).map((p) => {
          const b = h('button.bg-row-opt', { type: 'button', onclick: async () => { const v = await numPad({ title: `${p.name}’s tiles`, value: vals[p.id] || 0, allowNeg: false, hint: 'Sum of tiles left (joker = 30)' }); if (v !== null) { vals[p.id] = v; b.lastChild.textContent = `−${v}`; upd(); } } }, h('span', p.name), h('b', '−0'));
          return b;
        });
        function upd() { tot.textContent = `${w.name} +${Object.values(vals).reduce((a, b) => a + b, 0)}`; }
        upd();
        body.append(h('div.bg-note', 'Tiles left on each rack:'), ...rows, tot,
          h('button.pill.primary', { type: 'button', onclick: () => {
            const r = {}; let sum = 0;
            for (const p of S.players) if (p !== w) { r[p.id] = -(vals[p.id] || 0); sum += vals[p.id] || 0; }
            r[w.id] = sum; panel.close(); commit(r);
          } }, 'Save round'));
      },
    });
  }
  function settings() {
    openPanel({
      title: K.title, className: 'bg-sc-set',
      build(body, panel) {
        const tg = h('button.bg-row-opt', { type: 'button', onclick: async () => { const v = await numPad({ title: 'Play to', value: S.target, allowNeg: false, hint: '0 = no target' }); if (v !== null) { S.target = v; save(); render(); tg.lastChild.textContent = v || 'none'; } } }, h('span', 'Target score'), h('b', S.target || 'none'));
        body.append(tg,
          h('button.bg-row-opt', { type: 'button', onclick: () => { panel.close(); editPlayers(app, { players: S.players, min: 2, max: 10, onChange: () => { save(); render(); } }); } }, h('span', 'Players'), h('b', `${S.players.length} ›`)),
          h('div.bg-note', K.note),
          h('button.pill.small.danger', { type: 'button', onclick: async () => { panel.close(); if (await confirm('New game', 'Clear all rounds?', 'Clear')) { S.rounds = []; save(); render(); } } }, 'New game'));
      },
    });
  }
  render();
  return { key(e) { if (e.key === 'Enter') { scoreRound(); return true; } return false; }, destroy() { stopCel?.(); } };
}
