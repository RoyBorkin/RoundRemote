// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Never Have I Ever and Most Likely To share this page: a prompt in the middle, the players round the table.
//  never:  tap everyone who has done it → Next counts their sips.
//  likely: Count down 3-2-1, everyone points, tap the most-pointed-at player(s) → they sip.
import { h, IC, rbtn, bag, tableRing } from './drinks-ui.js';
import { NEVER, LIKELY, WORDS } from './drinks-data.js';

export function mountPrompt(el, ctx, mode) {
  const { app, settings } = ctx;
  const likely = mode === 'likely';
  const src = likely ? LIKELY : NEVER;
  const lang = settings.lang === 'he' ? 'he' : 'en';
  const words = WORDS[lang];
  const deck = [...src[lang].mild.map((t) => ({ t })), ...(settings.spicy ? src[lang].spicy.map((t) => ({ t, spicy: true })) : [])];
  const cards = bag(deck);
  const tally = new Map();          // sips in this game, by player id
  const marked = new Set();         // tapped for the current prompt
  let cur = null, phase = 'ready', timer = 0, count = 0;

  const status = h('div.dk-pr-status');
  const pre = h('div.dk-pr-pre', { dir: 'auto' }, likely ? words.likely : words.never);
  const text = h('div.dk-pr-text', { dir: 'auto' });
  const tag = h('div.dk-pr-tag', 'Spicy');
  const big = h('div.dk-pr-count');
  const promptEl = h('div.dk-prompt', { lang }, tag, pre, text, big);
  const skipBtn = rbtn(IC.skip, 'Skip', () => { ctx.sfx('click'); next(); }, 'dk-pr-skip');
  const main = h('button.pill.primary.dk-pr-main', { type: 'button', onclick: () => mainAction() });
  const btns = h('div.dk-pr-btns', skipBtn, main);
  let table = makeTable();
  el.classList.add('dk-promptgame', likely ? 'dk-likely' : 'dk-never');
  el.append(table.el, status, promptEl, btns);
  const offP = ctx.onPlayers(() => { table.el.remove(); table = makeTable(); el.prepend(table.el); render(); });

  function makeTable() {
    return tableRing(ctx.players, {
      count: (p) => tally.get(p.id) || '',
      onTap: (p) => {
        if (likely && phase !== 'pick') { app.toast(phase === 'count' ? 'Wait for it…' : 'Count down first, then tap who got the most fingers'); return; }
        if (marked.has(p.id)) marked.delete(p.id); else marked.add(p.id);
        ctx.sfx('tap', { pitch: marked.has(p.id) ? 1.2 : 0.8 });
        render();
      },
    });
  }

  function next() {
    clearTimeout(timer);
    cur = cards.next();
    marked.clear();
    phase = 'ready';
    if (!cur) { text.textContent = 'No prompts here.'; return render(); }
    text.textContent = cur.t;
    promptEl.classList.toggle('spicy', !!cur.spicy);
    promptEl.classList.toggle('long', cur.t.length > 70);
    promptEl.classList.remove('deal'); void promptEl.offsetWidth; promptEl.classList.add('deal');
    big.textContent = ''; big.classList.remove('go');
    render();
  }

  function commit() {
    for (const id of marked) {
      const p = ctx.players.find((x) => x.id === id);
      if (!p) continue;
      tally.set(id, (tally.get(id) || 0) + 1);
      ctx.addSips(p, 1);
    }
    if (marked.size) ctx.sfx('score');
  }

  function mainAction() {
    if (!likely) { commit(); next(); return; }
    if (phase === 'ready') return countdown();
    if (phase === 'pick') {
      if (!marked.size) { app.toast('Tap the player with the most fingers pointing at them'); return; }
      const names = ctx.players.filter((p) => marked.has(p.id)).map((p) => p.name);
      commit();
      phase = 'done';
      big.textContent = ''; big.classList.remove('go');
      status.textContent = `${names.join(' & ')} ${names.length > 1 ? 'sip' : 'sips'}!`;
      render(true);
      return;
    }
    if (phase === 'done') next();
  }

  function countdown() {
    phase = 'count'; count = 3;
    const tick = () => {
      if (count > 0) {
        big.textContent = count; big.classList.remove('go', 'beat'); void big.offsetWidth; big.classList.add('beat');
        ctx.sfx('tick'); ctx.sfx('tap', { pitch: 0.7 });
        count--; timer = setTimeout(tick, 900);
      } else {
        big.textContent = 'Point!'; big.classList.remove('beat'); void big.offsetWidth; big.classList.add('beat', 'go');
        ctx.sfx('pop'); app.vibrate(25);
        phase = 'pick';
        render();
      }
    };
    render();
    tick();
  }

  function render(keepStatus) {
    table.update();
    table.mark('on', (p) => marked.has(p.id));
    table.mark('pick', () => likely && phase === 'pick' && !marked.size);
    if (!likely) {
      status.textContent = marked.size ? (marked.size === 1 ? '1 player sips' : `${marked.size} players sip`) : 'Tap everyone who has';
      main.textContent = marked.size ? 'Sip & next' : 'Next';
    } else {
      if (!keepStatus) status.textContent = { ready: 'Read it out, then count down', count: 'Get ready to point…', pick: 'Tap who got the most fingers', done: status.textContent }[phase];
      main.textContent = { ready: '3 · 2 · 1', count: '…', pick: marked.size ? 'Sip!' : 'Who?', done: 'Next' }[phase];
      main.disabled = phase === 'count';
    }
  }

  next();
  return {
    destroy() { clearTimeout(timer); offP(); },
    key(e) {
      if (e.key === 'Enter' || e.key === ' ') { mainAction(); return true; }
      if (e.key === 'ArrowRight') { next(); return true; }
      return false;
    },
  };
}

export function mount(el, ctx) { return mountPrompt(el, ctx, 'never'); }
