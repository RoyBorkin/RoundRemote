// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Munchkin: a sheet per player (level 1–10, or 1–20 for Epic, gear bonus, combat strength, and
// free-text tags for gender / race / class / curses / steeds…), a combat calculator (fighter + one helper +
// one-shot bonuses against one or more monsters, Warriors win ties, Elves level up for helping), the run-away
// die (5–6 escapes) and a picker for the core sets and expansions that says what each one adds.
// Rules notes are in our own words; no card text.
import { h, clear } from '../js/ui/dom.js';
import { editText } from '../js/ui/keyboard.js';
import { openPanel } from '../js/ui/overlay.js';
import { seg, editPlayers, roster, celebrate, confirm, choose } from './bg-ui.js';
const put = (el, ...kids) => el.append(...kids.filter((k) => k != null && k !== false));   // like append(), skipping null / false

export const MK_GAMES = [
  { id: 'munchkin', name: 'Munchkin', note: 'The original fantasy set: Elves, Dwarves, Halflings · Warriors, Wizards, Clerics, Thieves.' },
  { id: 'deluxe', name: 'Munchkin Deluxe', note: 'The same cards plus a board and standees to track everyone’s level.' },
  { id: 'second', name: 'Second Edition', note: '2026 relaunch with a board and gold coins you take from monsters and spend on levels. Old cards can be mixed in.' },
  { id: 'fu', name: 'Munchkin Fu', note: 'Martial-arts movies. Standalone; mixes with the others.' },
  { id: 'impossible', name: 'Munchkin Impossible', note: 'Spy thrillers. Standalone.' },
  { id: 'cthulhu', name: 'Munchkin Cthulhu', note: 'Lovecraftian horror, with Cultists. Standalone.' },
  { id: 'zombies', name: 'Munchkin Zombies', note: 'You play the zombies. Standalone.' },
  { id: 'apocalypse', name: 'Munchkin Apocalypse', note: 'The end of the world, with Seals that change the game. Standalone.' },
  { id: 'legends', name: 'Munchkin Legends', note: 'Myths and legends. Standalone.' },
  { id: 'star', name: 'Star Munchkin', note: 'Science fiction. Standalone.' },
  { id: 'pathfinder', name: 'Munchkin Pathfinder', note: 'The Pathfinder RPG world. Standalone.' },
  { id: 'wh40k', name: 'Warhammer 40,000', note: 'Grimdark future. Standalone; has its own expansions.' },
  { id: 'aos', name: 'Warhammer Age of Sigmar', note: 'Standalone, with its own expansions.' },
  { id: 'other', name: 'Other themed sets', note: 'Marvel, Harry Potter, Rick and Morty, Adventure Time, Shadowrun, Steampunk, Booty (pirates), The Good, the Bad and the Munchkin, Critical Role… — the same core rules; check the box for extras.' },
];
export const MK_EXPS = [
  { id: 'm2', name: '2 · Unnatural Axe', note: 'Adds the Orc race.' },
  { id: 'm3', name: '3 · Clerical Errors', note: 'Adds the Gnome race and the Bard class.' },
  { id: 'm4', name: '4 · The Need for Steed', note: 'Adds Steeds — mounts you ride into battle (they add to your strength). Tag them on your sheet.', tag: 'steed' },
  { id: 'm5', name: '5 · De-Ranged', note: 'Adds the Ranger class.' },
  { id: 'm6', name: '6 · Demented Dungeons', note: '20 big Dungeon cards that change the rules for everyone, and 16 Portals to move between them. Shows a “Dungeon” line on the sheet.', dungeon: true },
  { id: 'm65', name: '6.5 · Terrible Tombs', note: 'More Dungeons (and Portals) for Munchkin 6.', dungeon: true },
  { id: 'm7', name: '7 · More Good Cards / Cheat With Both Hands', note: 'The same expansion under two names: overpowered stuff and a way to blend Munchkin sets.' },
  { id: 'm8', name: '8 · Half Horse, Will Travel', note: 'Adds Centaurs and Lizard Guys, plus the Elite, Legendary and Elder enhancers.' },
  { id: 'm9', name: '9 · Jurassic Snark', note: 'Dinosaur Steeds, primeval armour and dino hirelings.', tag: 'steed' },
  { id: 'm10', name: '10 · Time Warp', note: 'Historical monsters and loot from every era.' },
  { id: 'larva', name: 'The Floor Is Larva', note: '2024 mini-expansion of bugs.' },
  { id: 'kom', name: 'Kill-O-Meter', note: 'A dial accessory for both sides’ combat strength — the Combat tab does the same job.' },
];
const TAG_KINDS = [
  { v: 'gender', label: 'Gender', c: '#ec4899' }, { v: 'race', label: 'Race', c: '#22c55e' }, { v: 'class', label: 'Class', c: '#3b82f6' },
  { v: 'curse', label: 'Curse', c: '#ef4444' }, { v: 'steed', label: 'Steed', c: '#a16207' }, { v: 'hireling', label: 'Hireling', c: '#14b8a6' },
  { v: 'item', label: 'Big item', c: '#a855f7' }, { v: 'other', label: 'Other', c: '#64748b' },
];
const kindOf = (v) => TAG_KINDS.find((k) => k.v === v) || TAG_KINDS[7];

/** Pure combat maths (exported for tests). */
export function combat({ fighter, helper, bonus = 0, monsters = [], warrior = false }) {
  const str = (x) => (x ? x.level + x.gear : 0);
  const players = str(fighter) + str(helper) + bonus;
  const mons = monsters.reduce((s, m) => s + m.lvl + (m.mod || 0), 0);
  const win = players > mons || (warrior && players === mons);
  return { players, mons, win, need: win ? 0 : mons - players + (warrior ? 0 : 1) };
}
/** Run away: a d6 escapes on 5–6 (bonus lowers the target, e.g. Elves +1 → 4–6). */
export const escapes = (roll, bonus = 0) => roll + bonus >= 5;

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-mk');
  const S = Object.assign({ tab: 'hero', players: roster(app, 4), heroes: {}, sel: 0, game: 'munchkin', exps: [], epic: false, dungeon: '',
    fight: { helper: null, bonus: 0, mons: [{ lvl: 4, mod: 0 }], warrior: false, esc: 0, reward: 1 }, wins: {} }, app.data('munchkin', {}));
  const save = () => app.save('munchkin', S);
  const H = (p) => (S.heroes[p.id] ||= { level: 1, gear: 0, tags: [] });
  const cur = () => S.players[Math.min(S.sel, S.players.length - 1)];
  const maxL = () => (S.epic ? 20 : 10);
  const F = S.fight;
  const dungeonsOn = () => S.exps.some((id) => MK_EXPS.find((x) => x.id === id)?.dungeon);

  const TABS = ['hero', 'combat', 'sets'];
  const tabs = seg([{ v: 'hero', label: 'Players' }, { v: 'combat', label: 'Combat' }, { v: 'sets', label: 'Sets & rules' }], S.tab, (v) => { S.tab = v; save(); show(); }, 'bg-cat-tabs');
  const chipsEl = h('div.bg-tal-chips');
  const heroEl = h('div.bg-tal-page.bg-mk-hero');
  const fightEl = h('div.bg-tal-page.bg-mk-fight');
  const setsEl = h('div.bg-tal-page.bg-mk-sets');
  el.append(tabs, heroEl, fightEl, setsEl, chipsEl);

  function drawChips() {
    clear(chipsEl);
    S.players.forEach((q, i) => chipsEl.append(h(`button.bg-ttr-chip${i === S.sel ? '.on' : ''}`, { type: 'button', '--c': q.color, onclick: () => { S.sel = i; save(); show(); } },
      h('b', q.name.slice(0, 1).toUpperCase()), h('small', `L${H(q).level}`))));
    chipsEl.append(h('button.bg-step-b.bg-tal-plus', { type: 'button', 'aria-label': 'Players', onclick: () => editPlayers(app, { players: S.players, min: 2, max: 8, onChange: () => { save(); show(); } }) }, '⋯'));
  }

  // ---------------------------------------------------------------- player sheet
  let stopCel = null;
  function setLevel(p, v, { kill = false } = {}) {
    const x = H(p), top = maxL();
    v = Math.max(1, Math.min(top, v));
    if (v >= top && x.level < top && !kill) {
      confirm('The winning level', `Level ${top} must come from killing a monster (unless a card says otherwise). Did ${p.name} just kill one?`, 'Yes — win!').then((ok) => {
        if (ok) setLevel(p, top, { kill: true }); else app.toast(`Stays at level ${top - 1}`);
      });
      return;
    }
    x.level = v; save(); show();
    if (v >= top) { S.wins[p.id] = (S.wins[p.id] || 0) + 1; save(); app.sfx('win'); stopCel = celebrate(el, `${p.name} wins!`, p.color, `Level ${top}${S.epic ? ' · Epic' : ''}`); }
  }
  function drawHero() {
    clear(heroEl);
    const p = cur(), x = H(p), top = maxL();
    const block = (label, val, sub, minus, plus, cls = '') => h(`div.bg-mk-blk${cls}`, h('small', label),
      h('div.bg-mk-bv', h('button.bg-step-b', { type: 'button', 'aria-label': `Less ${label}`, onclick: minus }, '−'), h('b', val), h('button.bg-step-b', { type: 'button', 'aria-label': `More ${label}`, onclick: plus }, '+')), h('span', sub));
    const tags = h('div.bg-mk-tags', x.tags.map((t, i) => h(`button.bg-mk-tag.k-${t.k}`, { type: 'button', '--k': kindOf(t.k).c, onclick: () => editTag(p, i) }, h('i', kindOf(t.k).label), h('span', { dir: 'auto' }, t.t))),
      h('button.bg-mk-tag.add', { type: 'button', onclick: () => editTag(p, -1) }, '+ tag'));
    put(heroEl, 
      h('div.bg-mk-name', { '--c': p.color }, h('b', p.name), h('small', `${S.wins[p.id] ? `★${S.wins[p.id]} · ` : ''}to level ${top}`)),
      h('div.bg-mk-blks',
        block('Level', String(x.level), `of ${top}`, () => setLevel(p, x.level - 1), () => setLevel(p, x.level + 1), '.lvl'),
        h('div.bg-mk-str', { '--c': p.color }, h('small', 'Strength'), h('b', String(x.level + x.gear)), h('span', 'level + gear')),
        block('Gear', `${x.gear >= 0 ? '+' : ''}${x.gear}`, 'bonus', () => { x.gear--; save(); show(); }, () => { x.gear++; save(); show(); }, '.gear')),
      tags,
      dungeonsOn() ? h('button.bg-mk-dungeon', { type: 'button', onclick: async () => { const v = await editText({ title: 'Current dungeon', value: S.dungeon, placeholder: 'Dungeon name and its rule…' }); if (v !== null) { S.dungeon = v.slice(0, 60); save(); show(); } } },
        h('i', 'Dungeon'), h('span', { dir: 'auto' }, S.dungeon || 'tap to set')) : null,
      h('div.bg-tal-acts.bg-mk-acts',
        h('button.pill.small.primary', { type: 'button', onclick: () => { S.tab = 'combat'; tabs.set('combat'); save(); show(); } }, 'Fight!'),
        h('button.pill.small', { type: 'button', onclick: () => ctx.push({ file: './bg-rulesview.js', title: 'Munchkin', opts: { id: 'munchkin' } }) }, 'Rules')));
  }
  async function editTag(p, i) {
    const x = H(p);
    if (i >= 0) {
      const t = x.tags[i];
      const act = await choose({ title: `${kindOf(t.k).label}: ${t.t}`, options: [{ v: 'edit', label: 'Rename' }, { v: 'del', label: t.k === 'curse' ? 'Curse removed' : 'Remove' }] });
      if (act === 'del') { x.tags.splice(i, 1); app.sfx('drop'); save(); show(); }
      if (act === 'edit') { const v = await editText({ title: kindOf(t.k).label, value: t.t }); if (v) { t.t = v.trim().slice(0, 24); save(); show(); } }
      return;
    }
    const k = await choose({ title: 'Add a tag', options: TAG_KINDS.map((o) => ({ v: o.v, label: o.label, color: o.c })) });
    if (!k) return;
    const ph = { gender: 'e.g. Male / Female', race: 'e.g. Elf, Dwarf, Halfling', class: 'e.g. Warrior, Wizard, Cleric, Thief', curse: 'e.g. Chicken on your head', steed: 'e.g. Horse', item: 'e.g. Big item name' }[k] || '';
    const v = await editText({ title: kindOf(k).label, value: '', placeholder: ph });
    if (v && v.trim()) { x.tags.push({ k, t: v.trim().slice(0, 24) }); app.sfx(k === 'curse' ? 'hit' : 'pop'); save(); show(); }
  }

  // ---------------------------------------------------------------- combat calculator
  let dice = null;   // run-away results [{ who, roll, ok }]
  function drawFight() {
    clear(fightEl);
    const p = cur(), x = H(p);
    const helper = F.helper ? S.players.find((q) => q.id === F.helper && q.id !== p.id) : null;
    if (F.helper && !helper) F.helper = null;
    const r = combat({ fighter: x, helper: helper ? H(helper) : null, bonus: F.bonus, monsters: F.mons, warrior: F.warrior });
    const mini = (label, val, minus, plus) => h('div.bg-mk-mini', h('span', label), h('button.bg-step-b', { type: 'button', 'aria-label': `Less ${label}`, onclick: minus }, '−'), h('b', val), h('button.bg-step-b', { type: 'button', 'aria-label': `More ${label}`, onclick: plus }, '+'));
    const meter = h('div.bg-mk-meter', { style: { '--a': Math.max(-1, Math.min(1, (r.players - r.mons) / 10)) } }, h('i.needle'), h('span.l', 'monsters'), h('span.r', 'munchkins'));
    const res = h(`div.bg-mk-res${r.win ? '.win' : '.lose'}`, r.win ? (r.players === r.mons ? 'Warrior wins the tie!' : `Munchkins win by ${r.players - r.mons}`) : r.players === r.mons ? 'Tie — the monster wins' : `Monster wins · need +${r.need}`);
    const elfHelper = helper && H(helper).tags.some((t) => t.k === 'race' && /elf|אלף|אלפ/i.test(t.t));
    put(fightEl, 
      h('div.bg-mk-duel',
        h('div.bg-mk-side.me', { '--c': p.color },
          h('small', 'Munchkins'), h('b.big', String(r.players)),
          h('div.bg-mk-who', `${p.name} · ${x.level + x.gear}`),
          h('button.chip.bg-mk-help', { type: 'button', onclick: () => pickHelper(p) }, helper ? `+ ${helper.name} · ${H(helper).level + H(helper).gear}` : '+ helper'),
          mini('one-shot', `${F.bonus >= 0 ? '+' : ''}${F.bonus}`, () => { F.bonus--; changed(); }, () => { F.bonus++; changed(); })),
        h('div.bg-mk-vs', 'VS'),
        h('div.bg-mk-side.foe',
          h('small', F.mons.length > 1 ? `${F.mons.length} monsters` : 'Monster'), h('b.big', String(r.mons)),
          ...F.mons.map((m, i) => mini(F.mons.length > 1 ? `#${i + 1} lv` : 'level', String(m.lvl), () => { if (m.lvl > 1) m.lvl--; else if (F.mons.length > 1) F.mons.splice(i, 1); changed(); }, () => { m.lvl++; changed(); })),
          mini('mods', `${F.mons.reduce((s, m) => s + (m.mod || 0), 0) >= 0 ? '+' : ''}${F.mons.reduce((s, m) => s + (m.mod || 0), 0)}`, () => { F.mons[0].mod = (F.mons[0].mod || 0) - 1; changed(); }, () => { F.mons[0].mod = (F.mons[0].mod || 0) + 1; changed(); }),
          F.mons.length < 4 ? h('button.chip.bg-mk-help', { type: 'button', onclick: () => { F.mons.push({ lvl: 1, mod: 0 }); changed(); } }, '+ monster') : null)),
      meter, res,
      h('div.bg-mk-fopts',
        h(`button.chip${F.warrior ? '.on' : ''}`, { type: 'button', onclick: () => { F.warrior = !F.warrior; changed(); } }, 'Warrior: wins ties'),
        mini('escape', `+${F.esc}`, () => { F.esc = Math.max(0, F.esc - 1); changed(); }, () => { F.esc = Math.min(4, F.esc + 1); changed(); }),
        h('button.chip', { type: 'button', onclick: () => { F.bonus = 0; F.mons = [{ lvl: 1, mod: 0 }]; F.helper = null; dice = null; changed(); } }, 'Clear')),
      dice ? h('div.bg-mk-dice', dice.map((d) => h(`div.bg-mk-die${d.ok ? '.ok' : '.no'}`, h('b', String(d.roll)), h('small', `${d.who} ${d.ok ? 'escapes' : 'caught!'}`)))) : null,
      h('div.bg-mk-facts',
        r.win ? h('button.pill.primary', { type: 'button', onclick: () => {
          const lv = F.mons.length;
          if (elfHelper) H(helper).level = Math.min(maxL() - 1, H(helper).level + lv);
          app.sfx('score');
          app.toast(`${p.name}: +${lv} level${lv > 1 ? 's' : ''} · draw the treasures${elfHelper ? ` · ${helper.name} (Elf) +${lv}` : ''}`, { ms: 3000 });
          F.bonus = 0; F.mons.forEach((m) => { m.mod = 0; }); dice = null;
          setLevel(p, x.level + lv, { kill: true });
        } }, `Kill! +${F.mons.length} level${F.mons.length > 1 ? 's' : ''}`) : null,
        h(`button.pill${r.win ? '' : '.primary'}`, { type: 'button', onclick: () => runAway(p, helper) }, F.esc ? `Run away (${5 - F.esc}+)` : 'Run away')));
  }
  function changed() { save(); drawFight(); app.sfx('tick'); }
  async function pickHelper(p) {
    const v = await choose({ title: 'Who helps?', value: F.helper, options: [{ v: '', label: 'Nobody' }, ...S.players.filter((q) => q.id !== p.id).map((q) => ({ v: q.id, label: `${q.name} · strength ${H(q).level + H(q).gear}`, color: q.color }))] });
    if (v !== null) { F.helper = v || null; changed(); }
  }
  function runAway(p, helper) {
    const who = [p, helper].filter(Boolean);
    dice = who.map((q) => { const roll = 1 + Math.floor(Math.random() * 6); return { who: q.name, roll, ok: escapes(roll, F.esc) }; });
    app.sfx(dice.every((d) => d.ok) ? 'jump' : 'hit');
    drawFight();
  }

  // ---------------------------------------------------------------- sets & rules
  let note = '';
  function drawSets() {
    clear(setsEl);
    const sc = h('div.bg-mk-scroll');
    const g = MK_GAMES.find((x) => x.id === S.game) || MK_GAMES[0];
    sc.append(
      h('div.bg-sect', 'Game'),
      h('div.bg-mk-chips', MK_GAMES.map((x) => h(`button.chip${x.id === S.game ? '.on' : ''}`, { type: 'button', onclick: () => { S.game = x.id; note = x.note; save(); drawSets(); } }, x.name))),
      h('div.bg-sect', 'Expansions'),
      h('div.bg-mk-chips', MK_EXPS.map((x) => h(`button.chip${S.exps.includes(x.id) ? '.on' : ''}`, { type: 'button', onclick: () => {
        S.exps = S.exps.includes(x.id) ? S.exps.filter((y) => y !== x.id) : [...S.exps, x.id]; note = x.note; save(); drawSets();
      } }, x.name))),
      h('div.bg-sect', 'Rules'),
      h('div.bg-mk-chips',
        h(`button.chip${!S.epic ? '.on' : ''}`, { type: 'button', onclick: () => { S.epic = false; note = 'Standard game: the first munchkin to reach level 10 wins — and that level must come from killing a monster.'; save(); drawSets(); } }, 'Win at 10'),
        h(`button.chip${S.epic ? '.on' : ''}`, { type: 'button', onclick: () => { S.epic = true; note = 'Epic Munchkin: play on to level 20, with extra Epic powers for levels above 10 (free official rules sheet).'; save(); drawSets(); } }, 'Epic · to 20')));
    const active = [g, ...MK_EXPS.filter((x) => S.exps.includes(x.id))];
    setsEl.append(sc, h('div.bg-mk-note', note || active.map((x) => x.name.replace(/^\d+(\.\d)? · /, '')).join(' + ')));
  }

  function show() {
    S.sel = Math.min(S.sel, S.players.length - 1);
    heroEl.hidden = S.tab !== 'hero'; fightEl.hidden = S.tab !== 'combat'; setsEl.hidden = S.tab !== 'sets';
    chipsEl.hidden = S.tab === 'sets';
    drawChips();
    if (S.tab === 'hero') drawHero(); else if (S.tab === 'combat') drawFight(); else drawSets();
  }
  show();
  return {
    key(e) {
      if (e.key === 'Tab') { S.tab = TABS[(TABS.indexOf(S.tab) + 1) % 3]; tabs.set(S.tab); save(); show(); return true; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (S.tab === 'sets') { S.tab = e.key === 'ArrowLeft' ? 'combat' : 'hero'; tabs.set(S.tab); save(); show(); return true; }
        S.sel = (S.sel + (e.key === 'ArrowRight' ? 1 : -1) + S.players.length) % S.players.length; save(); show(); return true;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { if (S.tab === 'hero') { setLevel(cur(), H(cur()).level + (e.key === 'ArrowUp' ? 1 : -1)); return true; } }
      if ((e.key === 'Enter' || e.key === ' ') && S.tab === 'combat') { runAway(cur(), F.helper ? S.players.find((q) => q.id === F.helper) : null); return true; }
      return false;
    },
    destroy() { stopCel?.(); },
  };
}
