// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Cards Against Humanity (18+): seats around the screen with Awesome Points, the Card Czar crown
// that moves on every round, the official house rules as switches (Rando Cardrissian joins as a seat, God Is Dead
// drops the Czar, Serious Business awards 3-2-1, Rebooting the Universe trades a point, Happy Ending ends the
// game) and a list of the official boxes and packs. Scoring helper only — no card text, ever.
import { h, clear } from '../js/ui/dom.js';
import { openPanel } from '../js/ui/overlay.js';
import { editPlayers, roster, celebrate, choose, svgIcon, IC } from './bg-ui.js';
const put = (el, ...kids) => el.append(...kids.filter((k) => k != null && k !== false));   // like append(), skipping null / false

export const CAH_HOUSE = [
  { id: 'happy', name: 'Happy Ending', note: 'When you want to stop, play the “Make a Haiku” black card as the final round.' },
  { id: 'reboot', name: 'Rebooting the Universe', note: 'Any time, trade in one Awesome Point to throw away as many white cards as you like and draw back to ten.' },
  { id: 'heat', name: 'Packing Heat', note: 'On “Pick 2” rounds everyone draws one extra card first, for more options.' },
  { id: 'rando', name: 'Rando Cardrissian', note: 'Every round a random white card from the deck is played for an imaginary player. If Rando wins, everyone goes home in shame.' },
  { id: 'god', name: 'God Is Dead', note: 'No Card Czar: everyone picks their favourite answer and the most popular one wins.' },
  { id: 'survival', name: 'Survival of the Fittest', note: 'After the answers are read, players take turns removing one until a single answer is left — it wins.' },
  { id: 'serious', name: 'Serious Business', note: 'The Czar ranks the top three answers: 3, 2 and 1 Awesome Points.' },
  { id: 'never', name: 'Never Have I Ever', note: 'You may throw away a card you don’t understand — but you have to confess it to the group.' },
  { id: 'gamble', name: 'Gambling', note: 'Bet one Awesome Point to play a second answer. If either wins you keep your point; if not, it goes to the round winner.' },
];
export const CAH_PACKS = [
  ['Main game', 'The base set (2011), revised as v2.0 (2017) and refreshed since'],
  ['Red Box · Blue Box · Green Box', 'The three big 300-card expansions (Red and Blue collect the early numbered expansions)'],
  ['Absurd Box · Everything Box', 'More 300-card boxes'],
  ['Family Edition', '2020, for all ages — with its own Glow in the Dark Box and Written by Kids Pack'],
  ['Themed packs', 'Dozens of 30-card packs on one theme each (science, fantasy, food, sci-fi, holidays…), plus limited one-off packs'],
];
const RANDO = { id: 'rando', name: 'Rando', color: '#71717a', rando: true };

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-ca');
  const S = Object.assign({ players: roster(app, 5), pts: {}, czar: 0, round: 1, house: [], target: 7, log: [] }, app.data('cah', {}));
  const save = () => app.save('cah', S);
  const on = (id) => S.house.includes(id);
  const seats = () => (on('rando') ? [...S.players, RANDO] : S.players);
  let serious = 0;   // Serious Business: 0 → next tap is 3 points, then 2, then 1
  let stopCel = null;

  const ring = h('div.bg-taki-ring.bg-ca-ring');
  const center = h('div.bg-ca-center');
  el.append(ring, center);

  // ---------------- 18+ gate (the first time)
  let gateEl = null;
  if (!app.data('cahAdult', false)) {
    gateEl = h('div.bg-gate',
      h('div.bg-gate-badge', '18+'),
      h('div.bg-gate-t', 'Adults only'),
      h('div.bg-gate-m', 'An adults-only party game full of crude, offensive humour. Everyone playing should be 18 or older.'),
      h('div.bg-gate-s', 'This page only keeps the score — no cards are shown.'),
      h('button.pill.primary.bg-gate-ok', { type: 'button', onclick: () => { app.save('cahAdult', true); app.sfx('pop'); gateEl.classList.add('out'); setTimeout(() => { gateEl?.remove(); gateEl = null; }, 300); } }, 'We’re all 18+'),
      h('button.pill.small.bg-gate-no', { type: 'button', onclick: () => ctx.pop() }, 'Not now'));
    el.append(gateEl);
  }

  const czar = () => S.players[S.czar % S.players.length];
  function render() {
    S.czar = S.czar % S.players.length;
    const list = seats(), n = list.length, cz = czar(), god = on('god');
    clear(ring);
    list.forEach((p, i) => {
      const a0 = n === 2 ? 90 : 42, a = ((a0 + (n > 1 ? i * (360 - 2 * a0) / (n - 1) : 180)) * Math.PI) / 180;   // keep the top clear for Back and the title
      const isCzar = !god && p.id === cz.id;
      ring.append(h(`button.bg-taki-p.bg-ca-seat${isCzar ? '.czar' : ''}${p.rando ? '.rando' : ''}`, { type: 'button', '--c': p.color, dataset: { id: p.id },
        style: { left: `${50 + 39 * Math.sin(a)}%`, top: `${50 - 39 * Math.cos(a)}%` },
        onclick: () => award(p) },
        isCzar ? h('i.bg-ca-crown', { html: svgIcon(IC.crown) }) : null, h('span', p.name), h('b', String(S.pts[p.id] || 0))));
    });
    const lead = [...list].sort((a, b) => (S.pts[b.id] || 0) - (S.pts[a.id] || 0))[0];
    clear(center);
    put(center, 
      h('div.bg-ca-card', h('small', `Round ${S.round}`), god ? h('b', 'God Is Dead') : h('b', { style: { '--c': cz.color } }, cz.name), h('span', god ? 'everyone votes' : 'is the Card Czar')),
      h('div.bg-ca-hint', on('serious') ? `Tap the ${['best', 'second', 'third'][serious]} answer’s seat · ${3 - serious} pt${serious === 2 ? '' : 's'}` : 'Tap the winner’s seat for an Awesome Point'),
      h('div.bg-ca-btns',
        h('button.pill.small', { type: 'button', onclick: () => nextRound(true) }, 'Skip round'),
        h('button.pill.small', { type: 'button', disabled: !S.log.length, onclick: () => undo() }, 'Undo'),
        h('button.pill.small.primary', { type: 'button', onclick: () => more() }, 'More')),
      h('div.bg-ca-sub', S.target ? `First to ${S.target} · leader ${lead.name} ${S.pts[lead.id] || 0}` : `No target · leader ${lead.name} ${S.pts[lead.id] || 0}`),
      S.house.length ? h('div.bg-ca-house', S.house.map((id) => CAH_HOUSE.find((x) => x.id === id)?.name).join(' · ')) : null);
  }
  function award(p) {
    if (gateEl) return;
    if (!on('god') && p.id === czar().id) { app.toast('The Czar doesn’t play this round'); return; }
    const v = on('serious') ? 3 - serious : 1;
    S.pts[p.id] = (S.pts[p.id] || 0) + v;
    S.log.push({ id: p.id, v, czar: S.czar, round: S.round, serious });
    app.sfx(v > 1 || !on('serious') ? 'score' : 'tick');
    const flash = ring.querySelector(`[data-id="${p.id}"]`); flash?.classList.add('won');
    if (p.rando) app.toast('Rando Cardrissian wins — everyone goes home in shame', { ms: 3000 });
    if (S.target && (S.pts[p.id] || 0) >= S.target) { save(); render(); app.sfx('win'); stopCel = celebrate(el, `${p.name} wins!`, p.color, `${S.pts[p.id]} Awesome Points`); return; }
    if (on('serious') && serious < 2 && seats().length - (on('god') ? 0 : 1) > serious + 1) { serious++; save(); setTimeout(render, 220); return; }
    setTimeout(() => nextRound(), 260);
  }
  function nextRound(skip = false) {
    serious = 0; S.round++; S.czar = (S.czar + 1) % S.players.length;
    if (skip) app.sfx('whoosh');
    save(); render();
  }
  function undo() {
    const l = S.log.pop(); if (!l) return;
    S.pts[l.id] = Math.max(0, (S.pts[l.id] || 0) - l.v); S.czar = l.czar; S.round = l.round; serious = l.serious;
    save(); render(); app.sfx('drop');
  }
  function more() {
    openPanel({
      title: 'Cards Against Humanity', className: 'bg-ed-panel',
      build(body, panel) {
        const notes = h('div.bg-note.bg-ca-note', 'House rules from the official rules — switch on the ones you play.');
        const hs = h('div.bg-mk-chips', CAH_HOUSE.map((x) => h(`button.chip${on(x.id) ? '.on' : ''}`, { type: 'button', onclick: (e) => {
          S.house = on(x.id) ? S.house.filter((y) => y !== x.id) : [...S.house, x.id];
          e.currentTarget.classList.toggle('on', on(x.id)); notes.textContent = x.note; serious = 0; save(); render();
        } }, x.name)));
        body.append(
          h('div.bg-sect', 'House rules'), hs, notes,
          h('div.bg-sect', 'Game'),
          h('div.bg-mk-chips',
            ...[5, 7, 10, 0].map((t) => h(`button.chip${S.target === t ? '.on' : ''}`, { type: 'button', onclick: () => { S.target = t; save(); render(); panel.close(); } }, t ? `First to ${t}` : 'No target')),
            h('button.chip', { type: 'button', onclick: () => { panel.close(); editPlayers(app, { players: S.players, min: 3, max: 12, onChange: () => { save(); render(); } }); } }, 'Players'),
            h('button.chip', { type: 'button', onclick: () => { panel.close(); pickCzar(); } }, 'Choose Czar'),
            on('reboot') ? h('button.chip', { type: 'button', onclick: () => { panel.close(); reboot(); } }, 'Trade a point') : null,
            on('happy') ? h('button.chip', { type: 'button', onclick: () => { panel.close(); happyEnding(); } }, 'Make a Haiku — end') : null,
            h('button.chip', { type: 'button', onclick: () => { S.pts = {}; S.round = 1; S.log = []; serious = 0; save(); render(); panel.close(); } }, 'New game'),
            h('button.chip', { type: 'button', onclick: () => { panel.close(); ctx.push({ file: './bg-rulesview.js', title: 'Cards Against Humanity', opts: { id: 'cards-against-humanity' } }); } }, 'Rules')),
          h('div.bg-sect', 'Official boxes & packs'),
          h('div.bg-ed-list', CAH_PACKS.map(([n, s]) => h('div.bg-ed-row', h('b', n), h('small', s)))),
          h('div.bg-note', 'The rules suggest the first Czar is whoever most recently pooped. We don’t judge.'));
      },
    });
  }
  async function pickCzar() {
    const v = await choose({ title: 'Card Czar', value: czar().id, options: S.players.map((p) => ({ v: p.id, label: p.name, color: p.color })) });
    if (v) { S.czar = S.players.findIndex((p) => p.id === v); serious = 0; save(); render(); }
  }
  async function reboot() {
    const v = await choose({ title: 'Who trades a point?', options: S.players.filter((p) => (S.pts[p.id] || 0) > 0).map((p) => ({ v: p.id, label: `${p.name} · ${S.pts[p.id]}`, color: p.color })) });
    if (v) { S.pts[v]--; save(); render(); app.sfx('whoosh'); app.toast('Discard any white cards and draw back to ten'); }
  }
  function happyEnding() {
    const list = seats(), top = Math.max(...list.map((p) => S.pts[p.id] || 0));
    const winners = list.filter((p) => (S.pts[p.id] || 0) === top);
    app.sfx('win');
    stopCel = celebrate(el, winners.length > 1 ? 'A tie!' : `${winners[0].name} wins!`, winners[0].color, `${winners.map((p) => p.name).join(' & ')} · ${top} Awesome Points`);
  }

  render();
  return {
    key(e) {
      if (gateEl) return false;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const btns = [...ring.querySelectorAll('.bg-ca-seat')];
        const i = btns.findIndex((b) => b.classList.contains('kb'));
        const j = i < 0 ? (e.key === 'ArrowRight' ? 0 : btns.length - 1) : (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
        btns.forEach((b, k) => b.classList.toggle('kb', k === j)); return true;
      }
      if (e.key === 'Enter' || e.key === ' ') { const kb = ring.querySelector('.bg-ca-seat.kb'); if (kb) { const id = kb.dataset.id; award(seats().find((p) => p.id === id)); } return true; }
      return false;
    },
    destroy() { stopCel?.(); },
  };
}
