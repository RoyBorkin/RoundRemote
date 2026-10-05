// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Games: a ring of companions for favourite games (each its own page/module).
import { ringMenu, IC } from './bg-ui.js';

export const COMPANIONS = [
  { id: 'ttr', name: 'Ticket to Ride', color: '#0ea5e9', icon: IC.train, file: './bg-ttr.js', blurb: 'Route points, trains left, tickets, longest route and final totals.' },
  { id: 'catan', name: 'Catan', color: '#ea580c', icon: IC.hex, file: './bg-catan.js', blurb: 'Dice chart, robber, points and costs — plus Seafarers, Cities & Knights (barbarians, event die) and more.' },
  { id: 'monopoly', name: 'Monopoly', color: '#059669', icon: IC.money, file: './bg-monopoly.js', blurb: 'The banker: balances, payments, rent, passing GO and a log with undo.' },
  { id: 'munchkin', name: 'Munchkin', color: '#b45309', icon: IC.helmet, file: './bg-munchkin.js', blurb: 'Levels, gear and tags per player, a combat calculator, run-away die and every expansion.' },
  { id: 'talisman', name: 'Talisman', color: '#7c3aed', icon: IC.crown, file: './bg-talisman.js', blurb: 'Hero sheets (Strength, Craft, Life, Fate, Gold, trophies, toad), a battle helper and the movement die.' },
  { id: 'clue', name: 'Clue', color: '#ca8a04', icon: IC.search, file: './bg-clue.js', blurb: 'Detective notepad: suspects, weapons and rooms per player, with a hide button.' },
  { id: 'taki', name: 'Taki', color: '#e11d48', icon: IC.cards, file: './bg-taki.js', blurb: 'Whose turn, direction, colour, +2 stack and the special cards (טאקי).' },
  { id: 'uno', name: 'Uno', color: '#eab308', icon: IC.unocard, file: './bg-sheets.js', opts: { kind: 'uno' }, blurb: 'Round scoring by card values — first to 500 wins.' },
  { id: 'rummikub', name: 'Rummikub', color: '#8b5cf6', icon: IC.tile, file: './bg-sheets.js', opts: { kind: 'rummikub' }, blurb: 'Round scoring: losers subtract their tiles, the winner collects.' },
  { id: 'yahtzee', name: 'Yahtzee', color: '#dc2626', icon: IC.cup, file: './bg-sheets.js', opts: { kind: 'yahtzee' }, blurb: 'Full score sheet with the upper bonus and Yahtzee bonuses — reads your dice.' },
  { id: 'twister', name: 'Twister', color: '#3b82f6', icon: IC.spinner, file: './bg-twister.js', blurb: 'The spinner — big calls, auto-spin and a spoken call in English or Hebrew.' },
  { id: 'jungle', name: 'Jungle Speed', color: '#65a30d', icon: IC.totem, file: './bg-jungle.js', blurb: 'Cards left per player, a flip pace timer and a two-player reflex duel.' },
  { id: 'codenames', name: 'Codenames', color: '#6366f1', icon: IC.keycard, file: './bg-codenames.js', blurb: 'שם קוד — random key cards for the spymasters’ phones (QR), sand timer, agents left. Pictures & Duet too.' },
  { id: 'dixit', name: 'Dixit', color: '#d946ef', icon: IC.rabbit, file: './bg-dixit.js', blurb: 'דיקסיט — the rabbit track to 30 and a round wizard that works out everyone’s points.' },
  { id: 'alias', name: 'Alias', color: '#14b8a6', icon: IC.bubble, file: './bg-alias.js', blurb: 'אליאס — team board track, turn timer, skips cost a point, last word open to all, practice words.' },
  { id: 'petakiot', name: 'פתקיות', color: '#f59e0b', icon: IC.bowl, file: './bg-petakiot.js', blurb: 'Petakiot (the notes game): describe, one word, charades — a bowl counter, turn timer and team scores.' },
  { id: 'cah', name: 'Cards Against Humanity', color: '#a1a1aa', icon: IC.blackcard, file: './bg-cah.js', adult: true, blurb: '18+ · Awesome Points, Card Czar rotation and the house rules (no card text).' },
];

export function mount(el, ctx) {
  const { app } = ctx;
  const sel = Math.max(0, COMPANIONS.findIndex((c) => c.id === app.data('lastGame')));
  const menu = ringMenu({
    items: COMPANIONS, sel, radius: 40.6, size: 9.8, spread: 21,
    onOpen: (c) => { app.save('lastGame', c.id); app.sfx('tap'); ctx.push({ file: c.file, title: c.name, color: c.color, opts: c.opts }); },
  });
  el.append(menu.el);
  return { key: (e) => menu.key(e) };
}
