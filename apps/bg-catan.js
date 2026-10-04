// Board Games → Catan: 2d6 roller (red + yellow dice on a small tray) with a live distribution chart against the
// expected curve, robber reminder on 7, turn order, optional "event deck" (36 cards = every 2d6 outcome, no
// replacement) and a victory-point tracker (settlements, cities, longest road, largest army, VP cards).
import { h, clear } from '../js/ui/dom.js';
import { openPanel } from '../js/ui/overlay.js';
import { createTray, randFace, rnd } from './bg-dice-engine.js';
import { seg, editPlayers, celebrate, confirm, svgIcon, IC, roster } from './bg-ui.js';

const P36 = (s) => (6 - Math.abs(s - 7)) / 36;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const DECK = () => shuffle(Array.from({ length: 36 }, (_, i) => [Math.floor(i / 6) + 1, (i % 6) + 1]));

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-catan');
  const S = Object.assign({ tab: 'dice', players: roster(app, 4).map((p, i) => ({ ...p, color: ['#dc2626', '#2563eb', '#f8fafc', '#f97316'][i] })), counts: Array(13).fill(0), rolls: 0, turn: 0,
    deck: false, cards: [], vp: {}, target: 10, sel: 0, last: null }, app.data('catan', {}));
  const save = () => app.save('catan', S);
  const vp = (p) => (S.vp[p.id] ||= { s: 2, c: 0, road: false, army: false, cards: 0 });
  const points = (p) => { const v = vp(p); return v.s + v.c * 2 + (v.road ? 2 : 0) + (v.army ? 2 : 0) + v.cards; };

  const tabs = seg([{ v: 'dice', label: 'Dice' }, { v: 'points', label: 'Points' }], S.tab, (v) => { S.tab = v; save(); show(); }, 'bg-cat-tabs');
  el.append(tabs);

  // ---------------------------------------------------------------- dice tab
  const dice = h('div.bg-cat-dice');
  const trayEl = h('div.bg-tray.bg-cat-tray');
  dice.append(trayEl);
  const turnEl = h('button.bg-cat-turn', { type: 'button', onclick: () => pickTurn() });
  const sumEl = h('div.bg-cat-sum');
  const robber = h('div.bg-cat-robber', { onclick: () => robber.classList.remove('on') }, h('b', 'ROBBER!'), h('span', 'Anyone holding 8+ cards discards half (round down). Move the robber and steal one card.'));
  const chart = h('div.bg-cat-chart');
  const info = h('div.bg-cat-info');
  const rollBtn = h('button.pill.primary.bg-roll.bg-cat-roll', { type: 'button', onclick: () => roll() }, 'Roll');
  const optBtn = h('button.ibtn.bg-ibtn.bg-abs.bg-cat-opt', { type: 'button', 'aria-label': 'Dice options', html: svgIcon(IC.tune), onclick: () => diceOptions() });
  dice.append(turnEl, sumEl, chart, info, robber, rollBtn, optBtn);
  el.append(dice);
  let lastHit = 0, pending = null, robT = 0;
  const tray = createTray(dice, {
    tray: { cx: 0.5, cy: 0.405, r: 0.135 },
    onHit: (k) => { const now = performance.now(); if (now - lastHit > 50 && k > 0.1) { lastHit = now; app.sfx('click', { pitch: 0.7 + rnd() * 0.6, volume: 0.4 + k }); } },
    onSettle: () => settled(),
  });
  const offRaf = app.raf((dt) => tray.frame(dt));
  function setupDice() {
    const l = S.last || [6, 6];
    tray.setBodies([{ id: 'r', type: 'd6', face: l[0], color: '#dc2626', ink: '#ffffff' }, { id: 'y', type: 'd6', face: l[1], color: '#facc15', ink: '#1c1917' }], tray.geo.R * 0.5);
    tray.layoutGrid(true);
  }
  const roller = () => S.players[S.turn % S.players.length];
  function roll() {
    if (tray.rolling) return;
    let a, b;
    if (S.deck) {
      if (S.cards.length <= 5) { S.cards = DECK(); app.toast('Event deck reshuffled'); }
      [a, b] = S.cards.pop();
    } else { a = randFace('d6'); b = randFace('d6'); }
    pending = [a, b];
    robber.classList.remove('on');
    sumEl.textContent = '…'; sumEl.className = 'bg-cat-sum rolling';
    app.sfx('whoosh');
    tray.roll([a, b]);
  }
  function settled() {
    const [a, b] = pending; const s = a + b;
    S.last = [a, b]; S.counts[s]++; S.rolls++;
    const who = roller();
    sumEl.textContent = String(s);
    sumEl.className = `bg-cat-sum${s === 7 ? ' seven' : s === 6 || s === 8 ? ' hot' : ''}`;
    if (s === 7) { robber.classList.add('on'); clearTimeout(robT); robT = setTimeout(() => robber.classList.remove('on'), 7000); app.sfx('boom'); app.vibrate?.(60); } else app.sfx('score');
    S.lastBy = who.name;
    S.turn = (S.turn + 1) % S.players.length;
    save(); drawChart(); drawTurn();
  }
  function drawTurn() {
    const p = roller();
    turnEl.style.setProperty('--c', p.color);
    turnEl.replaceChildren(h('i'), h('span', S.rolls ? `${S.lastBy || ''} rolled · next: ` : 'First roll: '), h('b', p.name));
  }
  function drawChart() {
    clear(chart);
    const n = S.rolls, max = Math.max(1, ...S.counts.slice(2), n * P36(7));
    for (let s = 2; s <= 12; s++) {
      const exp = n * P36(s), c = S.counts[s];
      chart.append(h(`div.bg-cat-bar${s === 7 ? '.seven' : ''}${S.last && S.last[0] + S.last[1] === s ? '.last' : ''}`,
        h('div.bg-cat-col', h('i.fill', { style: { height: `${(c / max) * 100}%` } }), h('i.exp', { style: { bottom: `${(exp / max) * 100}%` } }), c ? h('em', String(c)) : null),
        h('span', String(s))));
    }
    const sevens = S.counts[7];
    info.textContent = n ? `${n} roll${n > 1 ? 's' : ''} · 7s: ${sevens} (expected ${(n / 6).toFixed(1)})${S.deck ? ` · deck ${S.cards.length} left` : ''}` : (S.deck ? 'Event deck: 36 cards, every result exactly once' : 'Bars: your rolls · ticks: expected');
  }
  function pickTurn() {
    openPanel({
      title: 'Whose turn?', className: 'bg-choose',
      build(body, panel) {
        const list = h('div.list');
        S.players.forEach((p, i) => list.append(h(`button.row${i === S.turn % S.players.length ? '.active' : ''}`, { type: 'button', onclick: () => { S.turn = i; save(); drawTurn(); panel.close(); } }, h('span.bg-dot', { style: { background: p.color } }), h('div.row-text', h('div.row-title', p.name)))));
        body.append(list, h('button.pill.small', { type: 'button', onclick: () => { panel.close(); editPlayers(app, { players: S.players, min: 2, max: 6, onChange: () => { save(); drawTurn(); drawPoints(); } }); } }, 'Edit players'));
      },
    });
  }
  function diceOptions() {
    openPanel({
      title: 'Catan dice', className: 'bg-sc-set',
      build(body, panel) {
        const sw = h('span.switch'); sw.classList.toggle('on', S.deck);
        body.append(
          h('button.bg-row-opt', { type: 'button', onclick: () => { S.deck = !S.deck; S.cards = S.deck ? DECK() : []; sw.classList.toggle('on', S.deck); save(); drawChart(); } }, h('span', 'Event deck (balanced dice)'), sw),
          h('div.bg-note', 'The deck holds all 36 two-dice results once each and is reshuffled when 5 cards are left — rolls follow the odds closely, with no long droughts.'),
          h('button.bg-row-opt', { type: 'button', onclick: () => { panel.close(); pickTurn(); } }, h('span', 'Players & turn order'), h('b', `${S.players.length} ›`)),
          h('button.pill.small.danger', { type: 'button', onclick: async () => { panel.close(); if (await confirm('Reset stats', 'Clear the roll chart?', 'Clear')) { S.counts = Array(13).fill(0); S.rolls = 0; S.cards = S.deck ? DECK() : []; save(); drawChart(); } } }, 'Reset chart'));
      },
    });
  }

  // ---------------------------------------------------------------- points tab
  const pts = h('div.bg-cat-points');
  el.append(pts);
  let stopCel = null;
  function drawPoints() {
    clear(pts);
    S.sel = Math.min(S.sel, S.players.length - 1);
    const p = S.players[S.sel], v = vp(p), tot = points(p);
    const chips = h('div.bg-cat-chips', S.players.map((q, i) => h(`button.bg-ttr-chip${i === S.sel ? '.on' : ''}`, { type: 'button', '--c': q.color, onclick: () => { S.sel = i; save(); drawPoints(); } }, h('b', q.name.slice(0, 1).toUpperCase()), h('small', String(points(q))))));
    const pct = Math.min(1, tot / S.target);
    const ring = h('div.bg-cat-vp', { '--c': p.color, style: { '--p': pct } }, h('small.n', p.name), h('b', String(tot)), h('small', `of ${S.target} VP`));
    const row = (label, sub, val, onMinus, onPlus) => h('div.bg-cat-row', h('div.bg-cat-l', h('b', label), h('small', sub)),
      h('button.bg-step-b', { type: 'button', 'aria-label': `Less ${label}`, onclick: onMinus }, '−'), h('span.bg-step-v', String(val)), h('button.bg-step-b', { type: 'button', 'aria-label': `More ${label}`, onclick: onPlus }, '+'));
    const tog = (label, key) => h(`button.bg-cat-tog${v[key] ? '.on' : ''}`, { type: 'button', onclick: () => {
      const on = !v[key];
      for (const q of S.players) vp(q)[key] = false;
      v[key] = on; change();
    } }, h('b', label), h('small', '+2 VP'));
    pts.append(chips, ring,
      h('div.bg-cat-rows',
        row('Settlements', '1 VP · max 5', v.s, () => { v.s = Math.max(0, v.s - 1); change(); }, () => { if (v.s < 5) { v.s++; change(); } }),
        row('Cities', '2 VP · replaces a settlement', v.c, () => { if (v.c > 0) { v.c--; v.s = Math.min(5, v.s + 1); change(); } }, () => { if (v.c < 4) { v.c++; if (v.s > 0) v.s--; change(); } }),
        row('VP cards', '1 VP each', v.cards, () => { v.cards = Math.max(0, v.cards - 1); change(); }, () => { if (v.cards < 5) { v.cards++; change(); } }),
        h('div.bg-cat-togs', tog('Longest road', 'road'), tog('Largest army', 'army'))),
      h('button.bg-cat-target', { type: 'button', onclick: () => { S.target = S.target >= 13 ? 8 : S.target + 1; save(); drawPoints(); } }, `Play to ${S.target} ›`));
  }
  function change() {
    save(); drawPoints(); app.sfx('tick');
    const w = S.players.find((q) => points(q) >= S.target);
    if (w && S.won !== w.id) { S.won = w.id; save(); app.sfx('win'); stopCel = celebrate(el, `${w.name} wins!`, w.color, `${points(w)} victory points`); }
    if (!w) S.won = null;
  }

  function show() {
    dice.hidden = S.tab !== 'dice'; pts.hidden = S.tab !== 'points';
    if (S.tab === 'points') drawPoints(); else { tray.redraw(); }
  }
  setupDice(); drawChart(); drawTurn(); show();
  return {
    key(e) {
      if (S.tab === 'dice' && (e.key === 'Enter' || e.key === ' ')) { roll(); return true; }
      if (e.key === 'Tab' || (S.tab === 'dice' && e.key === 'ArrowRight') || (S.tab === 'points' && e.key === 'ArrowLeft' && S.sel === 0)) { S.tab = S.tab === 'dice' ? 'points' : 'dice'; tabs.set(S.tab); save(); show(); return true; }
      if (S.tab === 'points' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { S.sel = (S.sel + (e.key === 'ArrowRight' ? 1 : -1) + S.players.length) % S.players.length; drawPoints(); return true; }
      return false;
    },
    destroy() { offRaf(); tray.destroy(); stopCel?.(); clearTimeout(robT); },
  };
}
