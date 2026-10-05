// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Kings Cup (Ring of Fire): draw from a virtual 52-card deck; each rank has a rule (editable). Tracks whose turn
// it is, the Question Master, the Thumb Master, mates, the rules in play and the four Kings.
import { openPanel, curve } from '../js/ui/overlay.js';
import { h, clear, IC, svgIcon, rbtn, cardEl, newDeck, tableRing, confirm } from './drinks-ui.js';
import { KINGS_RULES } from './drinks-data.js';

const ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function mount(el, ctx) {
  const { app } = ctx;
  let rules = { ...KINGS_RULES, ...app.data('kingsRules', {}) };
  let g = app.data('kingsGame', null);
  if (!g || !Array.isArray(g.deck) || g.deck.length !== 52) g = fresh();
  function fresh() { return { deck: newDeck(), pos: 0, turn: 0, kings: 0, mates: [], rules: [], qm: null, tm: null, last: null, lastBy: null, over: false }; }
  const save = () => app.save('kingsGame', g);
  let pendingMate = null;      // id of the player choosing a mate

  const players = () => ctx.players;
  const byId = (id) => players().find((p) => p.id === id);
  const nameOf = (id) => byId(id)?.name || '—';

  // ---- UI
  const turnEl = h('div.dk-k-turn');
  const card = cardEl(null, { big: true });
  const deckEl = h('button.dk-k-deck', { type: 'button', 'aria-label': 'Draw a card', onclick: () => draw() }, card.el);
  const leftEl = h('div.dk-k-left', h('span.dk-k-left-n'), h('span.dk-k-left-l', 'cards'));
  const crowns = h('div.dk-k-kings', ...Array.from({ length: 4 }, () => h('span.dk-k-crown', { html: svgIcon(IC.crown) })));
  const ruleT = h('div.dk-k-rule-t');
  const ruleD = h('div.dk-k-rule-d');
  const action = h('div.dk-k-action');
  const inPlayBtn = rbtn(IC.list, 'Rules in play', () => openInPlay(), 'dk-k-inplay');
  const inPlayN = h('span.dk-rb-badge');
  inPlayBtn.append(inPlayN);
  const btns = h('div.dk-k-btns',
    inPlayBtn,
    rbtn(IC.edit, 'Edit the card rules', () => editRules()),
    rbtn(IC.shuffle, 'New game', async () => { if (g.pos === 0 || g.over || await confirm('New game?', 'Shuffle a fresh deck and clear the rules in play.', 'New game')) newGame(); }));
  let table = makeTable();
  el.append(table.el, turnEl, leftEl, deckEl, crowns, ruleT, ruleD, action, btns);
  el.classList.add('dk-kings');
  const offP = ctx.onPlayers(() => { table.el.remove(); table = makeTable(); el.prepend(table.el); render(); });

  function makeTable() {
    return tableRing(players(), {
      count: (p) => [g.qm === p.id ? 'Q' : '', g.tm === p.id ? '6' : '', g.mates.some((m) => m.includes(p.id)) ? '8' : ''].filter(Boolean).join(' '),
      onTap: (p) => {
        if (pendingMate) {
          if (p.id === pendingMate) { app.toast('Pick someone else as the mate'); return; }
          if (!g.mates.some((m) => m.includes(pendingMate) && m.includes(p.id))) g.mates.push([pendingMate, p.id]);
          app.toast(`${nameOf(pendingMate)} & ${p.name} are mates`);
          ctx.sfx('pop');
          pendingMate = null; save(); render();
        } else {
          // jump the turn to this player (e.g. someone sat down late)
          g.turn = players().indexOf(p); save(); render(); ctx.sfx('tick');
        }
      },
    });
  }

  function render() {
    const n = players().length;
    const next = players()[g.turn % n];
    const left = 52 - g.pos;
    leftEl.firstChild.textContent = left;
    deckEl.style.setProperty('--thick', Math.ceil(left / 13));
    deckEl.classList.toggle('empty', g.over);
    [...crowns.children].forEach((c, i) => c.classList.toggle('on', i < g.kings));
    table.update();
    table.mark('turn', (p) => !g.over && p === next && !pendingMate);
    table.mark('drew', (p) => p.id === g.lastBy && !pendingMate);
    table.mark('pick', (p) => !!pendingMate && p.id !== pendingMate);
    clear(turnEl);
    if (pendingMate) turnEl.append(h('bdi', nameOf(pendingMate)), ': tap your mate');
    else if (g.over) turnEl.append('Game over');
    else turnEl.append(g.lastBy ? h('bdi.dk-dim', `${nameOf(g.lastBy)} drew · `) : '', h('bdi', next?.name || ''), '’s turn');
    clear(action);
    if (g.over) {
      ruleT.textContent = g.kings >= 4 ? 'The fourth King!' : 'Deck finished';
      ruleD.textContent = g.kings >= 4 ? `${nameOf(g.lastBy)} drinks the King’s Cup. Good game — have some water!` : 'Every card is drawn. Good game — have some water!';
      action.append(h('button.pill.primary.small', { type: 'button', onclick: () => newGame() }, 'New game'));
    } else if (!g.last) {
      ruleT.textContent = 'Tap the deck';
      ruleD.textContent = 'Each card has a rule. Drawing a King? Pour a splash into the King’s Cup.';
    } else {
      const r = rules[g.last.r];
      ruleT.textContent = r.t;
      ruleD.textContent = r.d;
      if (g.last.r === 'J') action.append(h('button.pill.small', { type: 'button', onclick: () => addRule() }, '+ Write the rule'));
      if (g.last.r === '8' && pendingMate) action.append(h('button.pill.small', { type: 'button', onclick: () => { pendingMate = null; render(); } }, 'Skip'));
    }
    const k = (g.qm ? 1 : 0) + (g.tm ? 1 : 0) + g.mates.length + g.rules.length;
    inPlayN.textContent = k || '';
    inPlayN.hidden = !k;
  }

  function draw() {
    if (g.over) { newGame(); return; }
    if (pendingMate) { pendingMate = null; }
    const n = players().length;
    const c = g.deck[g.pos++];
    const drawer = players()[g.turn % n];
    g.turn = (g.turn + 1) % n;
    g.last = c; g.lastBy = drawer.id;
    if (c.r === 'K') { g.kings++; if (g.kings >= 4) g.over = true; }
    if (c.r === 'Q') g.qm = drawer.id;
    if (c.r === '6') g.tm = drawer.id;
    if (c.r === '8' && n > 1) pendingMate = drawer.id;
    if (g.pos >= 52) g.over = true;
    card.setCard(c);
    ctx.sfx(c.r === 'K' ? (g.kings >= 4 ? 'win' : 'coin') : 'whoosh');
    app.vibrate(10);
    save(); render();
  }

  function newGame() {
    g = fresh(); pendingMate = null; save();
    card.setCard(null);
    ctx.sfx('whoosh');
    render();
  }

  async function addRule() {
    const v = await app.editText({ title: 'New rule', placeholder: 'e.g. no saying “yes”' });
    if (v) { g.rules.push(v.slice(0, 90)); save(); render(); app.toast('Rule added'); }
  }

  function openInPlay() {
    openPanel({
      title: 'In play', className: 'dk-inplay',
      build(body, panel) {
        const list = h('div.list.dk-ip-list');
        const row = (tag, text, onX) => h('div.dk-ip-row', h('span.dk-ip-tag', tag), h('bdi.dk-ip-text', text),
          onX ? h('button.dk-pl-x', { type: 'button', 'aria-label': 'Remove', onclick: () => { onX(); save(); render(); fill(); } }, '×') : null);
        const fill = () => {
          clear(list);
          if (g.qm) list.append(row('Q', `Question Master: ${nameOf(g.qm)}`, () => { g.qm = null; }));
          if (g.tm) list.append(row('6', `Thumb Master: ${nameOf(g.tm)}`, () => { g.tm = null; }));
          g.mates.forEach((m, i) => list.append(row('8', `Mates: ${nameOf(m[0])} & ${nameOf(m[1])}`, () => { g.mates.splice(i, 1); })));
          g.rules.forEach((r, i) => list.append(row('J', r, () => { g.rules.splice(i, 1); })));
          if (!list.children.length) list.append(h('div.dk-note', 'Nothing yet — Queens, 6s, 8s and Jacks add things here.'));
        };
        fill();
        body.append(list, h('button.pill.small.dk-ip-add', { type: 'button', onclick: async () => { await addRule(); fill(); } }, '+ Add a rule'));
      },
    });
  }

  function editRules() {
    openPanel({
      title: 'Card rules', className: 'dk-rules',
      build(body) {
        const list = h('div.list.dk-ru-list');
        const fill = () => {
          clear(list);
          for (const r of ORDER) {
            const custom = app.data('kingsRules', {})[r];
            list.append(h('button.row.dk-ru-row', { type: 'button', onclick: async () => {
              const t = await app.editText({ title: `${r} — name`, value: rules[r].t });
              if (t === null) return;
              const d = await app.editText({ title: `${r} — what to do`, value: rules[r].d });
              if (d === null) return;
              const saved = app.data('kingsRules', {});
              saved[r] = { t: (t || rules[r].t).slice(0, 30), d: (d || rules[r].d).slice(0, 180) };
              app.save('kingsRules', saved);
              rules = { ...KINGS_RULES, ...saved };
              fill(); render();
            } },
            h('span.dk-ru-rank', r),
            h('div.row-text', h('div.row-title', rules[r].t, custom ? h('span.dk-ru-mod', ' · edited') : ''), h('div.row-sub', rules[r].d))));
          }
        };
        fill();
        body.append(list, h('button.pill.small.dk-ru-reset', { type: 'button', onclick: () => { app.save('kingsRules', {}); rules = { ...KINGS_RULES }; fill(); render(); app.toast('Classic rules restored'); } }, 'Reset to classic'));
        curve(list);
      },
    });
  }

  if (g.last) card.setCard(g.last, false);
  render();

  return {
    destroy() { offP(); },
    back() { if (pendingMate) { pendingMate = null; render(); return true; } return false; },
    key(e) {
      if (e.key === 'Enter' || e.key === ' ') { draw(); return true; }
      return false;
    },
  };
}

