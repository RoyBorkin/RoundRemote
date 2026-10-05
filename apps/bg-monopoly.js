// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Monopoly banker: balances (start 1500), pay / collect from the bank, pay another player, pass GO,
// a transaction log with undo, and per-player property notes.
import { h, clear } from '../js/ui/dom.js';
import { openPanel, curve } from '../js/ui/overlay.js';
import { numPad, editPlayers, confirm, svgIcon, IC, roster } from './bg-ui.js';

const money = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US')}`;

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-mono');
  const S = Object.assign({ start: 1500, go: 200, players: null, log: [], sel: 0 }, app.data('monopoly', {}));
  if (!S.players) S.players = roster(app, 4).map((p) => ({ ...p, bal: S.start, notes: '' }));
  const save = () => app.save('monopoly', { ...S, log: S.log.slice(-200) });
  let amount = 0, payMode = false;

  const ring = h('div.bg-mono-ring');
  const center = h('div.bg-mono-center');
  const setBtn = h('button.ibtn.bg-ibtn.bg-abs.bg-mono-set', { type: 'button', 'aria-label': 'Bank settings', html: svgIcon(IC.tune), onclick: () => settings() });
  el.append(ring, center, setBtn);

  const byId = (id) => S.players.find((p) => p.id === id);
  const name = (id) => (id === 'bank' ? 'Bank' : byId(id)?.name || '?');
  function tx(from, to, amt, note = '') {
    if (!amt) { app.toast('Enter an amount first'); return false; }
    if (from !== 'bank') byId(from).bal -= amt;
    if (to !== 'bank') byId(to).bal += amt;
    S.log.push({ t: Date.now(), from, to, amt, note });
    save(); app.sfx(to === 'bank' ? 'drop' : 'coin');
    const tgt = to !== 'bank' ? to : from;
    render();
    const tok = ring.querySelector(`[data-id="${tgt}"]`); tok?.classList.add('flash'); setTimeout(() => tok?.classList.remove('flash'), 500);
    if (from !== 'bank' && byId(from).bal < 0) app.toast(`${byId(from).name} is below zero — mortgage, sell or go bankrupt`, { ms: 3200 });
    return true;
  }
  function undo() {
    const t = S.log.pop(); if (!t) return;
    if (t.from !== 'bank' && byId(t.from)) byId(t.from).bal += t.amt;
    if (t.to !== 'bank' && byId(t.to)) byId(t.to).bal -= t.amt;
    save(); render(); app.sfx('drop'); app.toast(`Undone: ${name(t.from)} → ${name(t.to)} ${money(t.amt)}`);
  }

  function render() {
    S.sel = Math.min(S.sel, S.players.length - 1);
    const n = S.players.length, a0 = 42, span = 360 - 2 * a0;
    clear(ring);
    S.players.forEach((p, i) => {
      const ang = ((a0 + (n > 1 ? (span / (n - 1)) * i : 180)) * Math.PI) / 180;
      ring.append(h(`button.bg-mono-tok${i === S.sel ? '.on' : ''}${payMode && i !== S.sel ? '.target' : ''}${p.bal < 0 ? '.neg' : ''}`, {
        type: 'button', '--c': p.color, dataset: { id: p.id },
        style: { left: `${50 + 38.5 * Math.sin(ang)}%`, top: `${50 - 38.5 * Math.cos(ang)}%` },
        onclick: () => tapPlayer(i),
      }, h('span', p.name), h('b', money(p.bal))));
    });
    const p = S.players[S.sel];
    clear(center);
    center.style.setProperty('--c', p.color);
    center.append(
      h('div.bg-mono-who', p.name),
      h(`div.bg-mono-bal${p.bal < 0 ? '.neg' : ''}`, money(p.bal)),
      h('button.bg-mono-amt', { type: 'button', onclick: async () => { const v = await numPad({ title: 'Amount', value: amount, allowNeg: false }); if (v !== null) { amount = v; render(); } } },
        h('small', 'amount'), h('b', amount ? money(amount) : '$ —')),
      h('div.bg-mono-quick', [10, 50, 100, 500].map((v) => h('button.chip', { type: 'button', onclick: () => { amount += v; render(); app.sfx('tick'); } }, `+${v}`)),
        h('button.chip', { type: 'button', 'aria-label': 'Clear amount', onclick: () => { amount = 0; payMode = false; render(); } }, 'C')),
      h('div.bg-mono-acts',
        h('button.pill.small', { type: 'button', onclick: () => { if (tx(p.id, 'bank', amount)) { amount = 0; render(); } } }, 'Pay bank'),
        h('button.pill.small', { type: 'button', onclick: () => { if (tx('bank', p.id, amount)) { amount = 0; render(); } } }, 'Collect'),
        h(`button.pill.small${payMode ? '.primary' : ''}`, { type: 'button', onclick: () => { if (!amount) { app.toast('Enter an amount first'); return; } payMode = !payMode; render(); if (payMode) app.toast(`Tap who ${p.name} pays ${money(amount)}`); } }, payMode ? 'Pay who?' : 'Pay player')),
      h('div.bg-mono-acts2',
        h('button.pill.small.primary', { type: 'button', onclick: () => { tx('bank', p.id, S.go, 'GO'); } }, `GO +${S.go}`),
        h('button.ibtn.small', { type: 'button', 'aria-label': 'Undo', html: svgIcon(IC.undo), disabled: !S.log.length, onclick: () => undo() }),
        h('button.ibtn.small', { type: 'button', 'aria-label': 'Log', html: svgIcon(IC.history), onclick: () => showLog() })));
  }
  function tapPlayer(i) {
    if (payMode && i !== S.sel) {
      const from = S.players[S.sel], to = S.players[i];
      if (tx(from.id, to.id, amount)) { amount = 0; payMode = false; render(); }
      return;
    }
    if (i === S.sel) { playerPanel(S.players[i]); return; }
    S.sel = i; payMode = false; render(); app.sfx('tick');
  }
  function playerPanel(p) {
    openPanel({
      title: p.name, className: 'bg-sc-set',
      build(body, panel) {
        const notes = h('button.bg-mono-notes', { type: 'button', onclick: async () => { const v = await app.editText({ title: `${p.name} owns…`, value: p.notes || '', placeholder: 'Boardwalk, 2 houses on Park Place…' }); if (v !== null) { p.notes = v; save(); notes.lastChild.textContent = v || 'Tap to note properties'; } } },
          h('small', 'Properties & notes'), h('span', p.notes || 'Tap to note properties'));
        body.append(h('div.bg-mono-pbal', money(p.bal)), notes,
          h('button.bg-row-opt', { type: 'button', onclick: async () => { const v = await numPad({ title: `Set ${p.name}’s balance`, value: p.bal }); if (v !== null) { const d = v - p.bal; if (d) tx(d > 0 ? 'bank' : p.id, d > 0 ? p.id : 'bank', Math.abs(d), 'correction'); panel.close(); } } }, h('span', 'Correct balance'), h('b', '›')),
          h('button.pill.small.danger', { type: 'button', onclick: async () => { panel.close(); if (S.players.length > 1 && await confirm('Bankrupt', `Remove ${p.name} from the game?`, 'Remove')) { S.players = S.players.filter((x) => x !== p); save(); render(); } } }, 'Bankrupt / remove'));
      },
    });
  }
  function showLog() {
    openPanel({
      title: 'Transactions', className: 'bg-hist',
      build(body) {
        const list = h('div.list');
        if (!S.log.length) list.append(h('div.empty', 'Nothing yet'));
        [...S.log].reverse().slice(0, 120).forEach((t) => list.append(h('div.bg-hist-row', h('b.bg-hist-total.sm', money(t.amt)),
          h('div.bg-hist-t', h('div', `${name(t.from)} → ${name(t.to)}`), h('small', `${t.note ? t.note + ' · ' : ''}${new Date(t.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)))));
        body.append(list); curve(list);
      },
    });
  }
  function settings() {
    openPanel({
      title: 'Bank', className: 'bg-sc-set',
      build(body, panel) {
        const startB = h('button.bg-row-opt', { type: 'button', onclick: async () => { const v = await numPad({ title: 'Starting money', value: S.start, allowNeg: false }); if (v) { S.start = v; save(); startB.lastChild.textContent = money(v); } } }, h('span', 'Starting money'), h('b', money(S.start)));
        const goB = h('button.bg-row-opt', { type: 'button', onclick: async () => { const v = await numPad({ title: 'Passing GO pays', value: S.go, allowNeg: false }); if (v) { S.go = v; save(); goB.lastChild.textContent = money(v); render(); } } }, h('span', 'Passing GO'), h('b', money(S.go)));
        body.append(startB, goB,
          h('button.bg-row-opt', { type: 'button', onclick: () => { panel.close(); editPlayers(app, { players: S.players, min: 2, max: 8, onChange: () => { for (const p of S.players) { if (p.bal == null) p.bal = S.start; } save(); render(); } }); } }, h('span', 'Players'), h('b', `${S.players.length} ›`)),
          h('button.pill.small.danger', { type: 'button', onclick: async () => { panel.close(); if (await confirm('New game', `Everyone back to ${money(S.start)}?`, 'Start over')) { S.players.forEach((p) => { p.bal = S.start; p.notes = ''; }); S.log = []; save(); render(); } } }, 'New game'));
      },
    });
  }
  render();
  return {
    key(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { S.sel = (S.sel + (e.key === 'ArrowRight' ? 1 : -1) + S.players.length) % S.players.length; payMode = false; render(); return true; }
      if (e.key === 'g') { tx('bank', S.players[S.sel].id, S.go, 'GO'); return true; }
      return false;
    },
    back() { if (payMode) { payMode = false; render(); return true; } return false; },
  };
}
