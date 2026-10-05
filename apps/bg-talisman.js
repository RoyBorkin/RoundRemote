// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Talisman: a hero sheet per player (Strength, Craft, Life, Fate, Gold, alignment, region,
// trophies that trade 7-for-1, toad turns, notes for objects / followers / spells), a battle helper (attack rolls
// in Strength or Craft against an enemy, fate re-rolls, lose a life / keep the trophy) and a movement die with
// the turn order. Written for the widely played 4th edition; newer editions change some details.
import { h, clear } from '../js/ui/dom.js';
import { editText } from '../js/ui/keyboard.js';
import { seg, editPlayers, roster } from './bg-ui.js';

const STATS = [
  { k: 'str', name: 'Strength', short: 'STR', min: 1, max: 30, color: '#ef4444' },
  { k: 'craft', name: 'Craft', short: 'CRA', min: 1, max: 30, color: '#3b82f6' },
  { k: 'life', name: 'Life', short: 'LIFE', min: 0, max: 30, color: '#22c55e' },
  { k: 'fate', name: 'Fate', short: 'FATE', min: 0, max: 30, color: '#a855f7' },
  { k: 'gold', name: 'Gold', short: 'GOLD', min: 0, max: 99, color: '#f59e0b' },
];
const ALIGN = [{ v: 'good', label: 'Good' }, { v: 'neutral', label: 'Neutral' }, { v: 'evil', label: 'Evil' }];
const REGION = [{ v: 'outer', label: 'Outer' }, { v: 'middle', label: 'Middle' }, { v: 'inner', label: 'Inner' }];
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const d6 = () => 1 + Math.floor(Math.random() * 6);

/** A flat d6 with pips (CSS), with a short tumble when it rolls. */
function die(cls = '') {
  const el = h(`div.bg-tal-die${cls}`, Array.from({ length: 9 }, () => h('i')));
  el.show = (n) => { [...el.children].forEach((p, i) => p.classList.toggle('on', (PIPS[n] || []).includes(i))); el.dataset.v = n; };
  el.roll = (n, then) => {
    el.classList.remove('rolling'); void el.offsetWidth; el.classList.add('rolling');
    let k = 0;
    const t = setInterval(() => { el.show(d6()); if (++k >= 7) { clearInterval(t); el.show(n); el.classList.remove('rolling'); then?.(); } }, 60);
  };
  return el;
}

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-tal');
  const fresh = (p) => ({ hero: '', str: 3, craft: 3, life: 4, fate: 3, gold: 1, align: 'neutral', region: 'outer', trStr: 0, trCraft: 0, toad: 0, notes: '', dead: false });
  const S = Object.assign({ tab: 'hero', players: roster(app, 3), heroes: {}, sel: 0, turn: 0, bat: { mode: 'str', mod: 0, enemy: 4 } }, app.data('talisman', {}));
  const save = () => app.save('talisman', S);
  const H = (p) => (S.heroes[p.id] ||= fresh(p));
  const cur = () => S.players[Math.min(S.sel, S.players.length - 1)];
  // a toad has Strength 1 and Craft 1 (and can't use objects or followers) until it changes back
  const eff = (hero, k) => (hero.toad && (k === 'str' || k === 'craft') ? 1 : hero[k]);

  const TABS = ['hero', 'battle', 'move'];
  const tabs = seg([{ v: 'hero', label: 'Hero' }, { v: 'battle', label: 'Battle' }, { v: 'move', label: 'Move' }], S.tab, (v) => { S.tab = v; save(); show(); }, 'bg-cat-tabs');
  const chipsEl = h('div.bg-tal-chips');
  const heroEl = h('div.bg-tal-page');
  const batEl = h('div.bg-tal-page');
  const moveEl = h('div.bg-tal-page');
  el.append(tabs, chipsEl, heroEl, batEl, moveEl);

  function drawChips() {
    clear(chipsEl);
    S.players.forEach((q, i) => {
      const x = H(q);
      chipsEl.append(h(`button.bg-ttr-chip${i === S.sel ? '.on' : ''}${x.dead ? '.dead' : ''}`, { type: 'button', '--c': q.color, onclick: () => { S.sel = i; save(); show(); } },
        h('b', q.name.slice(0, 1).toUpperCase()), h('small', `♥${x.life}`)));
    });
    chipsEl.append(h('button.bg-step-b.bg-tal-plus', { type: 'button', 'aria-label': 'Players', onclick: () => editPlayers(app, { players: S.players, min: 1, max: 6, onChange: () => { save(); show(); } }) }, '⋯'));
  }

  // ---------------------------------------------------------------- hero sheet
  function drawHero() {
    clear(heroEl);
    const p = cur(), x = H(p);
    const title = h('button.bg-tal-name', { type: 'button', '--c': p.color, onclick: async () => {
      const v = await editText({ title: 'Character', value: x.hero, placeholder: 'e.g. Warrior, Wizard…' });
      if (v !== null) { x.hero = v.trim().slice(0, 24); change(); }
    } }, h('b', x.hero || 'Choose character…'), h('small', `${p.name}${x.toad ? ' · 🐸 toad' : ''}${x.dead ? ' · fallen' : ''}`));
    const tile = (st) => {
      const v = x[st.k], shown = eff(x, st.k);
      return h(`div.bg-tal-stat${shown !== v ? '.toad' : ''}`, { '--sc': st.color },
        h('small', st.name),
        h('div.bg-tal-sv',
          h('button.bg-step-b', { type: 'button', 'aria-label': `Less ${st.name}`, onclick: () => { x[st.k] = Math.max(st.min, v - 1); if (st.k === 'life' && x.life === 0) dead(p); change(); } }, '−'),
          h('b', String(shown)),
          h('button.bg-step-b', { type: 'button', 'aria-label': `More ${st.name}`, onclick: () => { x[st.k] = Math.min(st.max, v + 1); if (st.k === 'life') x.dead = false; change(); } }, '+')));
    };
    const trophies = h('div.bg-tal-tro',
      h('small', 'Trophies'),
      h('div.bg-tal-trow',
        trophy('STR', 'trStr', 'str'),
        trophy('CRA', 'trCraft', 'craft')));
    function trophy(label, key, stat) {
      const v = x[key];
      return h('div.bg-tal-tr',
        h('span', label), h('b', String(v)),
        v >= 7 ? h('button.chip.on.bg-tal-conv', { type: 'button', onclick: () => { x[key] -= 7; x[stat]++; app.sfx('perfect'); app.toast(`7 trophy points → +1 ${stat === 'str' ? 'Strength' : 'Craft'}`); change(); } }, '+1') :
          h('button.chip.bg-tal-trb', { type: 'button', 'aria-label': `Add ${label} trophy`, onclick: async () => { x[key] = Math.max(0, v - 1); change(); } }, '−'));
    }
    heroEl.append(title,
      h('div.bg-tal-stats', STATS.map(tile), trophies),
      h('div.bg-tal-row2',
        seg(ALIGN, x.align, (v) => { x.align = v; change(); }, 'bg-tal-align'),
        seg(REGION, x.region, (v) => { x.region = v; change(); }, 'bg-tal-region')),
      h('div.bg-tal-acts',
        h(`button.pill.small${x.toad ? '.on' : ''}`, { type: 'button', onclick: () => { x.toad = x.toad ? 0 : 3; app.sfx(x.toad ? 'pop' : 'tick'); change(); } }, x.toad ? `Toad · ${x.toad} turn${x.toad > 1 ? 's' : ''}` : 'Toad'),
        h('button.pill.small', { type: 'button', onclick: () => notes(p, x) }, x.notes ? 'Items ✎' : 'Items & followers'),
        h('button.pill.small', { type: 'button', onclick: () => ctx.push({ file: './bg-rulesview.js', title: 'Talisman', opts: { id: 'talisman' } }) }, 'Rules')));
  }
  function notes(p, x) {
    editText({ title: `${x.hero || p.name}: objects, followers, spells`, value: x.notes, placeholder: 'Sword, Mule, 2 spells…' }).then((v) => { if (v !== null) { x.notes = v.slice(0, 300); change(); } });
  }
  function dead(p) {
    const x = H(p); x.dead = true; app.sfx('over');
    app.toast(`${x.hero || p.name} has fallen — draw a new character`, { ms: 3200 });
  }

  // ---------------------------------------------------------------- battle helper
  const B = S.bat;
  const myDie = die('.me'), foeDie = die('.foe');
  let result = null, rolled = null;
  function drawBattle() {
    clear(batEl);
    const p = cur(), x = H(p);
    const base = eff(x, B.mode);
    const mine = rolled ? base + B.mod + rolled[0] : null, theirs = rolled ? B.enemy + rolled[1] : null;
    const modeSeg = seg([{ v: 'str', label: 'Battle · Strength' }, { v: 'craft', label: 'Psychic · Craft' }], B.mode, (v) => { B.mode = v; rolled = null; result = null; save(); drawBattle(); }, 'bg-tal-mode');
    const side = (label, val, extra, d, total, cls) => h(`div.bg-tal-side${cls}`, h('small', label), h('b', String(val)), extra, d, h('div.bg-tal-total', total == null ? '' : `= ${total}`));
    const modStep = h('div.bg-tal-mod',
      h('button.bg-step-b', { type: 'button', 'aria-label': 'Less bonus', onclick: () => { B.mod--; rolled = null; result = null; save(); drawBattle(); } }, '−'),
      h('span', `${B.mod >= 0 ? '+' : ''}${B.mod} bonus`),
      h('button.bg-step-b', { type: 'button', 'aria-label': 'More bonus', onclick: () => { B.mod++; rolled = null; result = null; save(); drawBattle(); } }, '+'));
    const foeStep = h('div.bg-tal-mod',
      h('button.bg-step-b', { type: 'button', 'aria-label': 'Weaker enemy', onclick: () => { B.enemy = Math.max(1, B.enemy - 1); rolled = null; result = null; save(); drawBattle(); } }, '−'),
      h('span', 'enemy'),
      h('button.bg-step-b', { type: 'button', 'aria-label': 'Stronger enemy', onclick: () => { B.enemy = Math.min(30, B.enemy + 1); rolled = null; result = null; save(); drawBattle(); } }, '+'));
    const res = h('div.bg-tal-res', result === 'win' ? 'You win!' : result === 'lose' ? 'You lose a life' : result === 'tie' ? 'Stand-off — nothing happens' : `${x.hero || p.name} · ${B.mode === 'str' ? 'Strength' : 'Craft'} ${base}${x.toad ? ' (toad)' : ''}`);
    res.dataset.r = result || '';
    const acts = h('div.bg-tal-bacts');
    if (rolled && result !== 'win' && x.fate > 0) acts.append(h('button.pill.small', { type: 'button', onclick: () => { x.fate--; save(); app.sfx('whoosh'); const n = d6(); myDie.roll(n, () => { rolled[0] = n; judge(); }); } }, `Re-roll · Fate ${x.fate}`));
    if (result === 'lose') acts.append(h('button.pill.small.danger', { type: 'button', onclick: () => { x.life = Math.max(0, x.life - 1); if (!x.life) dead(p); result = 'done'; change(); drawBattle(); } }, '−1 Life'));
    if (result === 'win') acts.append(h('button.pill.small.primary', { type: 'button', onclick: () => { const k = B.mode === 'str' ? 'trStr' : 'trCraft'; x[k] += B.enemy; app.sfx('coin'); app.toast(`Trophy kept: +${B.enemy} ${B.mode === 'str' ? 'Strength' : 'Craft'} points`); result = 'done'; change(); drawBattle(); } }, `Keep trophy +${B.enemy}`));
    batEl.append(modeSeg,
      h('div.bg-tal-duel',
        side(x.hero || p.name, base, modStep, myDie, mine, '.me'),
        h('div.bg-tal-vs', 'VS'),
        side('Enemy', B.enemy, foeStep, foeDie, theirs, '.foe')),
      res, acts,
      h('button.pill.primary.bg-roll.bg-tal-roll', { type: 'button', onclick: () => fight() }, rolled && result !== 'done' ? 'Roll again' : 'Attack!'));
  }
  function fight() {
    const a = d6(), b = d6();
    result = null; app.sfx('whoosh');
    let n = 0;
    const both = () => { if (++n === 2) { rolled = [a, b]; judge(); } };
    myDie.roll(a, both); foeDie.roll(b, both);
  }
  function judge() {
    const x = H(cur());
    const mine = eff(x, B.mode) + B.mod + rolled[0], theirs = B.enemy + rolled[1];
    result = mine > theirs ? 'win' : mine < theirs ? 'lose' : 'tie';
    app.sfx(result === 'win' ? 'score' : result === 'lose' ? 'hit' : 'tick');
    save(); drawBattle();
  }

  // ---------------------------------------------------------------- movement & turns
  const moveDie = die('.big');
  let lastMove = null;
  function drawMove() {
    clear(moveEl);
    const t = S.players[S.turn % S.players.length], x = H(t);
    moveEl.append(
      h('div.bg-tal-turn', { '--c': t.color }, h('i'), h('span', 'Turn: '), h('b', x.hero ? `${t.name} · ${x.hero}` : t.name)),
      h('button.bg-tal-diebtn', { type: 'button', 'aria-label': 'Roll to move', onclick: () => move() }, moveDie),
      h('div.bg-tal-mv', lastMove ? `Move ${lastMove} space${lastMove > 1 ? 's' : ''} — clockwise or anticlockwise` : 'Roll one die and move that many spaces, either way round your region'),
      h('div.bg-tal-mvsub', `${REGION.find((r) => r.v === x.region)?.label} region${x.toad ? ' · toad' : ''}`),
      h('div.bg-tal-acts.bg-tal-macts',
        h('button.pill.small', { type: 'button', onclick: () => { S.turn = (S.turn - 1 + S.players.length) % S.players.length; lastMove = null; save(); drawMove(); } }, '‹ Back'),
        h('button.pill.small.primary', { type: 'button', onclick: () => nextTurn() }, 'Next player ›')),
      h('button.pill.primary.bg-roll.bg-tal-roll', { type: 'button', onclick: () => move() }, 'Roll'));
    if (!moveDie.dataset.v) moveDie.show(lastMove || 6);
  }
  function move() { const n = d6(); app.sfx('whoosh'); moveDie.roll(n, () => { lastMove = n; app.sfx('tick'); drawMove(); }); }
  function nextTurn() {
    S.turn = (S.turn + 1) % S.players.length; lastMove = null;
    const x = H(S.players[S.turn]);
    if (x.toad) { x.toad--; if (!x.toad) app.toast(`${x.hero || S.players[S.turn].name} turns back from a toad`); }
    S.sel = S.turn; app.sfx('tick'); save(); show();
  }

  function change() { save(); drawChips(); if (S.tab === 'hero') drawHero(); }
  function show() {
    S.sel = Math.min(S.sel, S.players.length - 1);
    heroEl.hidden = S.tab !== 'hero'; batEl.hidden = S.tab !== 'battle'; moveEl.hidden = S.tab !== 'move';
    chipsEl.hidden = S.tab === 'move';
    drawChips();
    if (S.tab === 'hero') drawHero(); else if (S.tab === 'battle') drawBattle(); else drawMove();
  }
  show();
  return {
    key(e) {
      if (e.key === 'Tab' || ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && S.tab !== 'hero')) {
        const d = e.key === 'ArrowLeft' ? -1 : 1; S.tab = TABS[(TABS.indexOf(S.tab) + d + 3) % 3]; tabs.set(S.tab); save(); show(); return true;
      }
      if (S.tab === 'hero' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { S.sel = (S.sel + (e.key === 'ArrowRight' ? 1 : -1) + S.players.length) % S.players.length; save(); show(); return true; }
      if (e.key === 'Enter' || e.key === ' ') { if (S.tab === 'battle') fight(); else if (S.tab === 'move') move(); else return false; return true; }
      return false;
    },
  };
}
