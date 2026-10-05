// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Party Cards (drink-roulette style): a stream of mixed cards naming random players — group calls, dares for one,
// pairs, mini-games, votes and rules that last a few cards. Mild / spicy decks, English and Hebrew.
import { h, clear, IC, svgIcon, rbtn, bag, fillNames, shuffle } from './drinks-ui.js';
import { WORDS } from './drinks-data.js';
import { isAdult } from './tasks-store.js';

const TYPE_IC = { e: IC.people, p: IC.likely, d: IC.link, g: IC.party, v: IC.never, r: IC.virus, x: IC.virus };

export function mount(el, ctx) {
  const { app, settings } = ctx;
  const lang = settings.lang === 'he' ? 'he' : 'en';
  const W = WORDS[lang];
  // the deck: built-in + added cards from the shared store (language, spicy and lists from the hub's Settings)
  const build = () => ctx.content('party').map((it) => ({ type: it.kind || 'e', text: it.text, end: it.end || '', turns: it.turns || 0, spicy: isAdult(it) }));
  let deck = build();
  const cards = bag(deck);
  const offC = ctx.onContent(() => { const d = build(); if (d.length !== deck.length) { deck = d; cards.reset(deck); } });
  const named = new Map();        // how often each player was named as {A} — keeps it fair
  let active = [];                // rules in play: { text, end, map, left }
  let n = 0, busy = false;

  const status = h('div.dk-pa-status');
  const badge = h('div.dk-pa-badge');
  const text = h('div.dk-pa-text', { dir: 'auto' });
  const foot = h('div.dk-pa-foot');
  const cardBox = h('button.dk-pa-card', { type: 'button', lang, onclick: () => next() }, badge, text, foot);
  const rulesEl = h('div.dk-pa-rules');
  const nextBtn = h('button.pill.primary.dk-pa-next', { type: 'button', onclick: () => next() }, 'Next card');
  const btns = h('div.dk-pa-btns', rbtn(IC.list, 'Rules in play', () => showRules()), nextBtn);
  el.classList.add('dk-party');
  el.append(status, cardBox, rulesEl, btns);

  function cast(card) {
    const ps = ctx.players;
    const need = [...new Set((card.text + (card.end || '')).match(/\{([A-Z])\}/g) || [])].map((x) => x[1]).sort();
    const order = shuffle(ps).sort((a, b) => (named.get(a.id) || 0) - (named.get(b.id) || 0));
    const map = {};
    need.forEach((k, i) => { map[k] = order[i % order.length]; });
    if (map.A) named.set(map.A.id, (named.get(map.A.id) || 0) + 1);
    return map;
  }

  function show(type, body, map, spicy, sub) {
    cardBox.className = `dk-pa-card t-${type}${spicy ? ' spicy' : ''}`;
    cardBox.lang = lang;
    clear(badge); clear(text); clear(foot);
    badge.append(h('span.dk-pa-ic', { html: svgIcon(TYPE_IC[type] || IC.party) }), h('span', W.types[type] || ''));
    if (spicy) badge.append(h('span.dk-pa-spicy', '🌶'));
    text.append(fillNames(body, map));
    text.classList.toggle('long', body.length > 95);
    if (sub) foot.append(sub);
    cardBox.classList.remove('deal'); void cardBox.offsetWidth; cardBox.classList.add('deal');
  }

  function next() {
    if (busy) return;
    busy = true; setTimeout(() => { busy = false; }, 260);
    n++;
    // a rule running out takes this turn
    active.forEach((r) => { r.left--; });
    const over = active.find((r) => r.left <= 0);
    if (over) {
      active = active.filter((r) => r !== over);
      show('x', over.end || 'That rule is over.', over.map, false);
      ctx.sfx('drop');
      render();
      return;
    }
    const card = cards.next();
    if (!card) { show('e', 'No cards here — add some from phones (QR) or in the Task manager, or pick other lists.', {}, false); return; }
    const map = cast(card);
    if (card.type === 'r') {
      const left = card.turns || 4 + Math.floor(Math.random() * 4);
      active.push({ text: card.text, end: card.end, map, left: left + 1 });
      show('r', card.text, map, card.spicy, h('span.dk-pa-left', lang === 'he' ? `ל-${left} הקלפים הבאים` : `for the next ${left} cards`));
      ctx.sfx('pop');
    } else {
      show(card.type, card.text, map, card.spicy);
      ctx.sfx('whoosh');
    }
    render();
  }

  function render() {
    status.textContent = `Card ${n}`;
    clear(rulesEl);
    for (const r of active.slice(-3)) {
      rulesEl.append(h('button.dk-pa-rule', { type: 'button', dir: 'auto', onclick: (e) => { e.stopPropagation(); showRules(); } },
        h('span.dk-pa-rule-ic', { html: svgIcon(IC.virus) }), h('span.dk-pa-rule-t', fillNames(r.text, r.map)), h('span.dk-pa-rule-n', String(Math.max(0, r.left - 1)))));
    }
  }

  function showRules() {
    app.openPanel({
      title: 'Rules in play', className: 'dk-inplay',
      build(body) {
        const list = h('div.list.dk-ip-list');
        if (!active.length) list.append(h('div.dk-note', 'No rules right now — rule cards stay for a few turns.'));
        active.forEach((r) => list.append(h('div.dk-ip-row', h('span.dk-ip-tag', String(Math.max(0, r.left - 1))), h('span.dk-ip-text', { dir: 'auto' }, fillNames(r.text, r.map)),
          h('button.dk-pl-x', { type: 'button', 'aria-label': 'End this rule', onclick: (e) => { active = active.filter((x) => x !== r); e.currentTarget.parentElement.remove(); render(); } }, '×'))));
        body.append(list);
      },
    });
  }

  // first card: how to play
  status.textContent = 'Card 0';
  cardBox.className = 'dk-pa-card t-intro';
  badge.append(h('span.dk-pa-ic', { html: svgIcon(IC.party) }), h('span', 'Party Cards'));
  text.append(`${deck.length} cards for ${ctx.players.length} players. Read each one out loud — skipping is always fine.`);
  foot.append(h('span.dk-pa-left', 'Tap to start'));

  return {
    destroy() { offC(); },
    key(e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { next(); return true; } return false; },
  };
}
