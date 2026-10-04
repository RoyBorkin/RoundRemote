// Board Games → Games: a ring of companions for favourite games (each its own page/module).
import { ringMenu, IC } from './bg-ui.js';

export const COMPANIONS = [
  { id: 'ttr', name: 'Ticket to Ride', color: '#0ea5e9', icon: IC.train, file: './bg-ttr.js', blurb: 'Route points, trains left, tickets, longest route and final totals.' },
  { id: 'catan', name: 'Catan', color: '#ea580c', icon: IC.hex, file: './bg-catan.js', blurb: '2d6 with a live chart, robber alerts, turn order and victory points.' },
  { id: 'monopoly', name: 'Monopoly', color: '#059669', icon: IC.money, file: './bg-monopoly.js', blurb: 'The banker: balances, payments, rent, passing GO and a log with undo.' },
  { id: 'taki', name: 'Taki', color: '#e11d48', icon: IC.cards, file: './bg-taki.js', blurb: 'Whose turn, direction, colour, +2 stack and the special cards (טאקי).' },
  { id: 'twister', name: 'Twister', color: '#3b82f6', icon: IC.spinner, file: './bg-twister.js', blurb: 'The spinner — big calls, auto-spin and a spoken call in English or Hebrew.' },
  { id: 'clue', name: 'Clue', color: '#ca8a04', icon: IC.search, file: './bg-clue.js', blurb: 'Detective notepad: suspects, weapons and rooms per player, with a hide button.' },
  { id: 'jungle', name: 'Jungle Speed', color: '#65a30d', icon: IC.totem, file: './bg-jungle.js', blurb: 'Cards left per player, a flip pace timer and a two-player reflex duel.' },
  { id: 'yahtzee', name: 'Yahtzee', color: '#dc2626', icon: IC.cup, file: './bg-sheets.js', opts: { kind: 'yahtzee' }, blurb: 'Full score sheet with the upper bonus and Yahtzee bonuses — reads your dice.' },
  { id: 'uno', name: 'Uno', color: '#eab308', icon: IC.unocard, file: './bg-sheets.js', opts: { kind: 'uno' }, blurb: 'Round scoring by card values — first to 500 wins.' },
  { id: 'rummikub', name: 'Rummikub', color: '#8b5cf6', icon: IC.tile, file: './bg-sheets.js', opts: { kind: 'rummikub' }, blurb: 'Round scoring: losers subtract their tiles, the winner collects.' },
];

export function mount(el, ctx) {
  const { app } = ctx;
  const sel = Math.max(0, COMPANIONS.findIndex((c) => c.id === app.data('lastGame')));
  const menu = ringMenu({
    items: COMPANIONS, sel, radius: 39, size: 12.2, spread: 32,
    onOpen: (c) => { app.save('lastGame', c.id); app.sfx('tap'); ctx.push({ file: c.file, title: c.name, color: c.color, opts: c.opts }); },
  });
  el.append(menu.el);
  return { key: (e) => menu.key(e) };
}
