// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Taki (טאקי): whose turn and which way, the active colour, the +2 stack, open TAKI runs, and the
// special cards with Hebrew + English names. Wins per player; a link to the full rules.
import { h, clear } from '../js/ui/dom.js';
import { openPanel } from '../js/ui/overlay.js';
import { editPlayers, celebrate, svgIcon, IC, roster } from './bg-ui.js';

const TCOL = { red: ['#e11d48', 'Red', 'אדום'], blue: ['#2563eb', 'Blue', 'כחול'], green: ['#16a34a', 'Green', 'ירוק'], yellow: ['#eab308', 'Yellow', 'צהוב'] };
export const TAKI_CARDS = [
  ['TAKI', 'טאקי', 'Open a run: play every card of this colour in one go, then close it.'],
  ['Super Taki', 'סופר טאקי', 'Wild TAKI — opens a run in the current colour.'],
  ['Stop', 'עצור', 'The next player loses their turn.'],
  ['Change Direction', 'שנה כיוון', 'Play reverses direction.'],
  ['Plus', 'פלוס', 'Put down another card now (draw one if you can’t).'],
  ['+2', 'פלוס 2', 'Next player draws 2 — unless they add a +2 of their own; the stack grows until someone draws it all.'],
  ['Change Colour', 'שנה צבע', 'Wild: choose the colour to follow.'],
  ['King', 'מלך', 'Newer editions: goes on anything, cancels a +2 stack, and you play again.'],
  ['+3', 'פלוס 3', 'Newer editions: every other player draws 3.'],
  ['+3 Breaker', 'שובר 3+', 'Newer editions: answer a +3 and it bounces back to whoever played it.'],
];

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-taki');
  const S = Object.assign({ players: roster(app, 4), cur: 0, dir: 1, color: null, plus2: 0, open: false, wins: {} }, app.data('taki', {}));
  const save = () => app.save('taki', S);
  let hist = [];
  const snap = () => { hist.push(JSON.stringify(S)); if (hist.length > 50) hist.shift(); };

  const ring = h('div.bg-taki-ring');
  const arrows = h('div.bg-taki-dir', { html: `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><marker id="tk-ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="currentColor"/></marker></defs>
    ${[0, 1, 2, 3].map((k) => { const a1 = (k * 90 + 20) * Math.PI / 180, a2 = (k * 90 + 70) * Math.PI / 180, r = 29; return `<path d="M${50 + r * Math.sin(a1)} ${50 - r * Math.cos(a1)}A${r} ${r} 0 0 1 ${50 + r * Math.sin(a2)} ${50 - r * Math.cos(a2)}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" marker-end="url(#tk-ah)"/>`; }).join('')}</svg>` });
  const center = h('div.bg-taki-center');
  el.append(arrows, ring, center);

  const P = () => S.players;
  const at = (k) => ((S.cur + k * S.dir) % P().length + P().length) % P().length;
  function advance(k = 1) { S.cur = at(k); }
  function act(fn, sound = 'tap') { snap(); fn(); save(); render(); app.sfx(sound); }

  function render() {
    S.cur = Math.min(S.cur, P().length - 1);
    const n = P().length;
    clear(ring);
    P().forEach((p, i) => {
      const a0 = n === 2 ? 90 : 180 / n, a = ((a0 + (i / n) * 360) * Math.PI) / 180;
      const next = i === at(1) && i !== S.cur;
      ring.append(h(`button.bg-taki-p${i === S.cur ? '.on' : ''}${next ? '.next' : ''}`, { type: 'button', '--c': p.color,
        style: { left: `${50 + 39 * Math.sin(a)}%`, top: `${50 - 39 * Math.cos(a)}%` },
        onclick: () => { act(() => { S.cur = i; }, 'tick'); } }, h('span', p.name), S.wins[p.id] ? h('b', `★${S.wins[p.id]}`) : null));
    });
    arrows.classList.toggle('ccw', S.dir < 0);
    const col = S.color ? TCOL[S.color] : null;
    el.style.setProperty('--tk', col ? col[0] : 'var(--pc)');
    el.classList.toggle('has-col', !!col);
    el.dataset.col = S.color || '';
    const p = P()[S.cur];
    clear(center);
    const btn = (label, he, fn, cls = '') => h(`button.bg-taki-b${cls}`, { type: 'button', onclick: fn }, h('b', label), he ? h('small', he) : null);
    center.append(
      h('div.bg-taki-status',
        col ? h('span.bg-taki-col', { style: { background: col[0] } }, `${col[1]} · ${col[2]}`) : null,
        S.open ? h('span.bg-taki-open', 'TAKI open') : null,
        S.plus2 ? h('span.bg-taki-p2', `+${S.plus2} stack`) : null),
      h('div.bg-taki-now', { '--c': p.color }, p.name),
      h('div.bg-taki-sub', S.plus2 ? `play a +2 or draw ${S.plus2}` : S.open ? 'play all cards of the colour, then close' : `next: ${P()[at(1)].name}`),
      h('div.bg-taki-grid',
        S.plus2 ? btn(`Draw ${S.plus2}`, `קח ${S.plus2}`, () => act(() => { S.plus2 = 0; advance(); }, 'drop'), '.primary') : btn('Next', 'הבא', () => act(() => advance(), 'tick'), '.primary'),
        btn('Stop', 'עצור', () => act(() => advance(2), 'hit')),
        btn('Reverse', 'שנה כיוון', () => act(() => { S.dir *= -1; advance(); }, 'whoosh')),
        btn('Plus', 'פלוס', () => { app.toast('Plus: put down another card (or draw one)'); app.sfx('pop'); }),
        btn('+2', 'פלוס 2', () => act(() => { S.plus2 += 2; advance(); }, 'laser')),
        btn('Colour', 'שנה צבע', () => pickColor()),
        btn(S.open ? 'Close' : 'TAKI', S.open ? 'סגור' : 'טאקי', () => act(() => { if (S.open) { S.open = false; advance(); } else S.open = true; }, 'pop'), S.open ? '.on' : ''),
        btn('More', 'עוד', () => more())));
  }
  function pickColor(thenAdvance = true) {
    openPanel({
      title: 'Change colour · שנה צבע', className: 'bg-taki-colors',
      build(body, panel) {
        body.append(h('div.bg-taki-cols', Object.entries(TCOL).map(([k, [c, en, he]]) => h('button.bg-taki-cbtn', { type: 'button', style: { background: c }, onclick: () => {
          panel.close(); act(() => { S.color = k; if (thenAdvance) advance(); }, 'perfect');
        } }, h('b', en), h('small', he)))),
          h('button.pill.small', { type: 'button', onclick: () => { panel.close(); act(() => { S.color = null; }); } }, 'Clear colour'));
      },
    });
  }
  function more() {
    openPanel({
      title: 'Special cards', className: 'bg-taki-more',
      build(body, panel) {
        const go = (fn, msg, sound) => { panel.close(); act(fn, sound); if (msg) app.toast(msg, { ms: 3000 }); };
        body.append(h('div.bg-taki-mgrid',
          h('button.bg-taki-b', { type: 'button', onclick: () => { panel.close(); pickColor(false); act(() => { S.open = true; }); app.toast('Super Taki: run open in the chosen colour'); } }, h('b', 'Super Taki'), h('small', 'סופר טאקי')),
          h('button.bg-taki-b', { type: 'button', onclick: () => go(() => { S.plus2 = 0; }, 'King: penalties cancelled — play any card', 'perfect') }, h('b', 'King'), h('small', 'מלך')),
          h('button.bg-taki-b', { type: 'button', onclick: () => go(() => advance(), 'Everyone else draws 3!', 'boom') }, h('b', '+3'), h('small', 'פלוס 3')),
          h('button.bg-taki-b', { type: 'button', onclick: () => go(() => {}, 'Breaker: the +3 goes back to whoever played it', 'laser') }, h('b', '+3 Breaker'), h('small', 'שובר 3+')),
          h('button.bg-taki-b.win', { type: 'button', onclick: () => { panel.close(); const p = P()[S.cur]; snap(); S.wins[p.id] = (S.wins[p.id] || 0) + 1; S.plus2 = 0; S.open = false; S.color = null; save(); render(); app.sfx('win'); celebrate(el, `${p.name} wins!`, p.color, `${S.wins[p.id]} win${S.wins[p.id] > 1 ? 's' : ''} so far`); } }, h('b', 'Winner!'), h('small', 'ניצחון')),
          h('button.bg-taki-b', { type: 'button', disabled: !hist.length, onclick: () => { panel.close(); const s = hist.pop(); if (s) { Object.assign(S, JSON.parse(s)); save(); render(); app.sfx('drop'); } } }, h('b', 'Undo'), h('small', 'בטל'))),
        h('div.bg-taki-links',
          h('button.pill.small', { type: 'button', onclick: () => { panel.close(); cards(); } }, 'Card guide'),
          h('button.pill.small', { type: 'button', onclick: () => { panel.close(); editPlayers(app, { players: S.players, min: 2, max: 8, onChange: () => { save(); render(); } }); } }, 'Players'),
          h('button.pill.small', { type: 'button', onclick: () => { panel.close(); ctx.push({ file: './bg-rulesview.js', title: 'Taki', opts: { id: 'taki' } }); } }, 'Rules')));
      },
    });
  }
  function cards() {
    openPanel({
      title: 'Taki cards · קלפי טאקי', className: 'bg-taki-guide',
      build(body) {
        body.append(h('div.bg-taki-glist', TAKI_CARDS.map(([en, he, txt]) => h('div.bg-taki-g', h('div.bg-taki-gh', h('b', en), h('span', { dir: 'rtl' }, he)), h('p', txt))),
          h('p.bg-note', 'Editions differ: King, +3 and the +3 Breaker came with newer decks, and many families add house rules (e.g. no finishing on an action card). Agree before you start!')));
      },
    });
  }
  render();
  return {
    key(e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { act(() => { if (S.plus2) S.plus2 = 0; advance(); }, 'tick'); return true; }
      if (e.key === 'ArrowLeft') { act(() => { S.dir *= -1; }, 'whoosh'); return true; }
      return false;
    },
  };
}
