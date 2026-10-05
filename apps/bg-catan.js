// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Catan: 2d6 roller (red + yellow dice on a small tray) with a live distribution chart against the
// expected curve, robber reminder on 7, turn order, optional "event deck" (36 cards = every 2d6 outcome, no
// replacement), a victory-point tracker (settlements, cities, longest road, largest army, VP cards) and a cheat
// sheet: building costs, trade rates (bank, harbours, players) and what's in the development deck.
// Expansions (Setup tab): Seafarers (scenario goals, ships), Cities & Knights (event die with the barbarian ship
// and the three city-gate colours, progress-card draws on the red die, barbarian track + attack with knights vs
// cities, metropolis / defender / progress VPs, knights, walls, improvements), Traders & Barbarians and
// Explorers & Pirates (scenario goals and key costs), and the 5–6 player extension (paired players or the
// classic special building phase). C&K details follow the widely used 5th-edition rulebook.
import { h, clear } from '../js/ui/dom.js';
import { openPanel } from '../js/ui/overlay.js';
import { createTray, randFace, rnd } from './bg-dice-engine.js';
import { seg, editPlayers, celebrate, confirm, svgIcon, IC, roster } from './bg-ui.js';
const put = (el, ...kids) => el.append(...kids.filter((k) => k != null && k !== false));   // like append(), skipping null / false

// resources: colour + a small 24×24 glyph (commodities for Cities & Knights too)
const RES = {
  brick: { name: 'Brick', he: 'לבנים', color: '#b45309', d: 'M2 5h9v6H2zM13 5h9v6h-9zM2 13h3v6H2zM7 13h10v6H7zM19 13h3v6h-3z' },
  lumber: { name: 'Lumber', he: 'עצים', color: '#166534', d: 'M12 1.5l6.5 8.5h-3.3l4.3 6.5H13v6h-2v-6H4.5l4.3-6.5H5.5z' },
  wool: { name: 'Wool', he: 'צמר', color: '#65a30d', d: 'M7 9.5a3.2 3.2 0 0 1 5-2.6 3.3 3.3 0 0 1 5.6 1.6A3 3 0 0 1 18 14.6V16H6v-1.2A3 3 0 0 1 7 9.5zM8 17h2.2v4H8zM13.8 17H16v4h-2.2z' },
  grain: { name: 'Grain', he: 'חיטה', color: '#ca8a04', d: 'M11 9h2v13h-2zM12 1.5c2.2 2.2 2.2 4.4 0 6.6-2.2-2.2-2.2-4.4 0-6.6zM6.5 6c3 .4 4.4 2 4.6 5.2-3-.4-4.4-2-4.6-5.2zM17.5 6c-.2 3.2-1.6 4.8-4.6 5.2.2-3.2 1.6-4.8 4.6-5.2zM6.5 11.5c3 .4 4.4 2 4.6 5.2-3-.4-4.4-2-4.6-5.2zM17.5 11.5c-.2 3.2-1.6 4.8-4.6 5.2.2-3.2 1.6-4.8 4.6-5.2z' },
  ore: { name: 'Ore', he: 'עפרות', color: '#475569', d: 'M1.5 20.5l7.2-12.8 4.1 6.2 3-4.4 6.7 11z' },
  paper: { name: 'Paper', he: 'נייר', color: '#15803d', d: 'M5 3h11l3 3v15H5zM8 8h8v1.6H8zM8 11.5h8v1.6H8zM8 15h5.5v1.6H8z' },
  cloth: { name: 'Cloth', he: 'בד', color: '#b45309', d: 'M3 6c3-2 6-2 9 0s6 2 9 0v12c-3 2-6 2-9 0s-6-2-9 0z' },
  coin: { name: 'Coin', he: 'מטבע', color: '#1d4ed8', d: 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zM12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM11 8h2v8h-2z' },
};
// the building-costs cards: base game and the expansions
const COSTS = {
  base: [
    { name: 'Road', he: 'דרך', vp: 'Longest road (5+) = 2 VP', res: ['brick', 'lumber'] },
    { name: 'Settlement', he: 'יישוב', vp: '1 VP', res: ['brick', 'lumber', 'wool', 'grain'] },
    { name: 'City', he: 'עיר', vp: '2 VP · upgrades a settlement', res: ['grain', 'grain', 'ore', 'ore', 'ore'] },
    { name: 'Development card', he: 'קלף פיתוח', vp: 'knight · progress · 1 VP', res: ['ore', 'wool', 'grain'] },
  ],
  sea: [
    { name: 'Ship', he: 'ספינה', vp: 'like a road, on the sea · counts for Longest trade route', res: ['lumber', 'wool'] },
  ],
  ck: [
    { name: 'Knight', he: 'אביר', vp: 'basic knight, strength 1 · placed inactive', res: ['wool', 'ore'] },
    { name: 'Promote', he: 'קידום', vp: 'basic → strong → mighty (mighty needs the Fortress)', res: ['wool', 'ore'] },
    { name: 'Activate', he: 'הפעלה', vp: 'only active knights defend and act', res: ['grain'] },
    { name: 'City wall', he: 'חומה', vp: '+2 cards you may keep on a 7 · max 3', res: ['brick', 'brick'] },
    { name: 'City improvement', he: 'שיפור עיר', vp: 'level n costs n: cloth trade · coin politics · paper science', res: ['cloth', 'coin', 'paper'] },
  ],
  tb: [
    { name: 'Bridge (Rivers)', he: 'גשר', vp: 'crosses a river · earns gold', res: ['brick', 'brick', 'lumber'] },
  ],
  ep: [
    { name: 'Ship', he: 'ספינה', vp: 'carries settlers and crews', res: ['lumber', 'wool'] },
    { name: 'Settler', he: 'מתיישב', vp: 'founds a settlement where the ship lands', res: ['brick', 'lumber', 'wool', 'grain'] },
    { name: 'Crew', he: 'צוות', vp: 'for missions: lairs, fish, spices', res: ['wool', 'ore'] },
    { name: 'Harbour settlement', he: 'יישוב נמל', vp: '2 VP · upgrades a settlement', res: ['grain', 'grain', 'ore', 'ore'] },
  ],
};
const COST_NOTES = {
  base: [['Trading: ', 'only on your turn after rolling — any deal with other players (the active player must be in it), no gifts or promises. Harbours need a settlement or city on them.'],
    ['Development deck (25): ', '14 knights · 5 victory points · 2 road building · 2 year of plenty · 2 monopoly. Play at most one per turn, not on the turn you bought it (VP cards excepted).']],
  sea: [['Ships: ', 'build from your coast; move one open-ended ship per turn (not one built this turn). The pirate (instead of the robber) blocks a sea hex and robs ships next to it.'],
    ['Gold field: ', 'pick any resource — 1 per settlement, 2 per city.']],
  ck: [['Commodities: ', 'a city on forest, pasture or mountains takes 1 resource + 1 commodity (paper, cloth, coin). No development cards — progress cards instead (hand limit 4).'],
    ['Level 3: ', 'Trading House (trade commodities 2:1) · Fortress (mighty knights) · Aqueduct (a free resource when a roll gives you nothing). First to level 4 takes that metropolis (+2 VP).']],
  tb: [['Fishermen: ', 'fish tokens — 2 drive the robber off, 3 steal, 4 a resource, 5 a road or ship, 7 a development card.'],
    ['Caravans · Barbarian Attack · Traders & Barbarians: ', 'camels (vote with grain or wool), knights that capture barbarians, wagons carrying glass, marble and sand. Variants: Catan for two, Harbourmaster, Friendly robber, event cards.']],
  ep: [['Explorers & Pirates: ', 'no development cards, no cities, no robber, no Longest Road / Largest Army. Ships explore fog hexes; missions score VPs.'],
    ['Gold: ', 'a roll that gives you nothing gives you gold instead.']],
};
const resChip = (k) => h('span.bg-cat-res', { title: RES[k].name, '--rc': RES[k].color, html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${RES[k].d}"/></svg>` });

// expansions & scenarios (goals for 3–4 players)
export const SEA_SCEN = [
  { id: 'shores', name: 'Heading for New Shores', vp: 14, note: '+2 VP for your first settlement on each small island.' },
  { id: 'four', name: 'The Four Islands', vp: 13, note: '+2 VP for your first settlement on each other island.' },
  { id: 'fog', name: 'The Fog Islands', vp: 12, note: 'Discovering land pays a resource.' },
  { id: 'desert', name: 'Through the Desert', vp: 14, note: '+2 VP for the first settlement in each other area.' },
  { id: 'tribe', name: 'The Forgotten Tribe', vp: 13, note: 'Catan chits on the coast: 1 VP each.' },
  { id: 'cloth', name: 'Cloth for Catan', vp: 14, note: '2 cloth = 1 VP.' },
  { id: 'pirate', name: 'The Pirate Islands', vp: 10, note: 'Capture your pirate fortress AND reach 10 VP.' },
  { id: 'wonders', name: 'The Wonders of Catan', vp: 10, note: 'Finish your wonder — or 10 VP with the most-built wonder.' },
  { id: 'new', name: 'New World', vp: 12, note: 'Random map; +1 VP for a first settlement abroad.' },
];
export const TB_SCEN = [
  { id: 'fish', name: 'Fishermen of Catan', vp: 10, note: 'Fish tokens to spend; the old boot adds 1 to the goal of whoever holds it.' },
  { id: 'rivers', name: 'Rivers of Catan', vp: 10, note: 'Bridges and gold; the wealthiest settler +1 VP, the poorest −2.' },
  { id: 'caravans', name: 'The Caravans', vp: 12, note: 'Camel caravans; buildings along them +1 VP.' },
  { id: 'attack', name: 'Barbarian Attack', vp: 12, note: 'Knights capture barbarians: 1 VP per 2 prisoners.' },
  { id: 'tb', name: 'Traders & Barbarians', vp: 13, note: 'Wagons deliver glass, marble and sand to the castle.' },
];
export const EP_SCEN = [
  { id: 'land', name: '1 · Land Ho!', vp: 10, note: 'Harbour settlements and ships.' },
  { id: 'lairs', name: '2 · Pirate Lairs', vp: 12, note: 'Crews capture pirate lairs.' },
  { id: 'fish', name: '3 · Fish for Catan', vp: 15, note: 'Catch fish and deliver it.' },
  { id: 'spice', name: '4 · Spices for Catan', vp: 15, note: 'Find spices and deliver them.' },
  { id: 'all', name: '5 · Explorers & Pirates', vp: 17, note: 'Everything together.' },
];
const OTHER = [
  ['Legend of the Sea Robbers', 'Scenario pack for Seafarers'], ['Helpers of Catan', 'Character cards that give each player a helper'],
  ['Catan: Starfarers', 'Space-age standalone'], ['Catan Junior', 'For kids, with pirates'], ['Catan Dice Game', 'Roll-and-write'],
  ['Rivals for Catan', '2-player card game'], ['Dawn of Humankind', '2022 standalone'], ['Catan Histories / scenarios', 'Many more standalones and scenario packs'],
];

/** Classic C&K: improvement level L shows red-die values 1 … L+1 (level 5 = every value). */
export const drawsProgress = (level, red) => level >= 1 && red <= level + 1;
/** Barbarian attack: { barb, knights, saved, defender (id|null), tied ids, losers ids }. */
export function barbarianAttack(players, vpOf, ckOf) {
  const barb = players.reduce((s, p) => s + vpOf(p).c, 0);
  const str = (p) => ckOf(p).knights;
  const knights = players.reduce((s, p) => s + str(p), 0);
  if (knights >= barb) {
    const top = Math.max(...players.map(str));
    const best = players.filter((p) => str(p) === top);
    return { barb, knights, saved: true, defender: best.length === 1 ? best[0].id : null, tied: best.length > 1 ? best.map((p) => p.id) : [], losers: [] };
  }
  const elig = players.filter((p) => vpOf(p).c - (vpOf(p).metro || 0) > 0);
  const low = elig.length ? Math.min(...elig.map(str)) : 0;
  return { barb, knights, saved: false, defender: null, tied: [], losers: elig.filter((p) => str(p) === low).map((p) => p.id) };
}

const P36 = (s) => (6 - Math.abs(s - 7)) / 36;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const DECK = () => shuffle(Array.from({ length: 36 }, (_, i) => [Math.floor(i / 6) + 1, (i % 6) + 1]));
// the event die: three ship faces and three city gates (yellow = trade, blue = politics, green = science)
const EVENT = ['ship', 'ship', 'ship', 'trade', 'politics', 'science'];
const GATE = { trade: { name: 'Trade', he: 'מסחר', color: '#eab308', ink: '#1c1917' }, politics: { name: 'Politics', he: 'פוליטיקה', color: '#2563eb', ink: '#fff' }, science: { name: 'Science', he: 'מדע', color: '#16a34a', ink: '#fff' } };
const SHIP_D = 'M3 15h18l-3 5H6zM11 3h1.6v11H11zM12.6 4.5 19 12h-6.4zM10.4 6 5 12h5.4z';
const GATE_D = 'M4 21V8l8-5 8 5v13h-5v-6a3 3 0 0 0-6 0v6z';

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-catan');
  const S = Object.assign({ tab: 'dice', players: roster(app, 4).map((p, i) => ({ ...p, color: ['#dc2626', '#2563eb', '#f8fafc', '#f97316'][i] })), counts: Array(13).fill(0), rolls: 0, turn: 0,
    deck: false, cards: [], vp: {}, target: 10, sel: 0, last: null }, app.data('catan', {}));
  S.x = Object.assign({ sea: false, ck: false, tb: false, ep: false, ext: false, seaS: 'shores', tbS: 'fish', epS: 'land', pair: 'paired' }, S.x || {});
  S.ck = S.ck || {};
  S.bar = Object.assign({ pos: 0, len: 7, attacks: 0 }, S.bar || {});
  const X = S.x;
  const save = () => app.save('catan', S);
  const V = (p) => { const v = (S.vp[p.id] ||= { s: 2, c: 0, road: false, army: false, cards: 0 }); v.metro ||= 0; v.defender ||= 0; v.bonus ||= 0; v.merchant ||= false; return v; };
  const ckOf = (p) => (S.ck[p.id] ||= { knights: 0, trade: 0, politics: 0, science: 0 });
  const points = (p) => {
    const v = V(p);
    if (X.ep) return v.s + v.c * 2 + v.cards + v.bonus;
    return v.s + v.c * 2 + (v.road ? 2 : 0) + (!X.ck && v.army ? 2 : 0) + v.cards + (X.ck ? v.metro * 2 + v.defender + (v.merchant ? 1 : 0) : 0) + (X.sea || X.tb ? v.bonus : 0);
  };

  // ---------------------------------------------------------------- tabs
  const tabList = () => ['dice', 'points', ...(X.ck ? ['knights'] : []), 'costs', 'setup'];
  const TAB_LABEL = { dice: 'Dice', points: 'Points', knights: 'Knights', costs: 'Costs', setup: 'Setup' };
  let tabs = null;
  function buildTabs() {
    tabs?.remove();
    if (!tabList().includes(S.tab)) S.tab = 'dice';
    tabs = seg(tabList().map((v) => ({ v, label: TAB_LABEL[v] })), S.tab, (v) => { S.tab = v; save(); show(); }, 'bg-cat-tabs');
    el.prepend(tabs);
  }

  // ---------------------------------------------------------------- dice tab
  const dice = h('div.bg-cat-dice');
  const trayEl = h('div.bg-tray.bg-cat-tray');
  dice.append(trayEl);
  const turnEl = h('button.bg-cat-turn', { type: 'button', onclick: () => pickTurn() });
  const sumEl = h('div.bg-cat-sum');
  const robber = h('div.bg-cat-robber', { onclick: () => robber.classList.remove('on') }, h('b', 'ROBBER!'), h('span', 'Anyone holding 8+ cards discards half (round down). Move the robber and steal one card.'));
  const evBanner = h('div.bg-cat-evb', { onclick: () => evBanner.classList.remove('on') });
  const evDie = h('button.bg-cat-ev', { type: 'button', 'aria-label': 'Event die', onclick: () => { S.tab = 'knights'; tabs.set('knights'); save(); show(); } });
  const chart = h('div.bg-cat-chart');
  const info = h('div.bg-cat-info');
  const rollBtn = h('button.pill.primary.bg-roll.bg-cat-roll', { type: 'button', onclick: () => roll() }, 'Roll');
  const optBtn = h('button.ibtn.bg-ibtn.bg-abs.bg-cat-opt', { type: 'button', 'aria-label': 'Dice options', html: svgIcon(IC.tune), onclick: () => diceOptions() });
  dice.append(turnEl, sumEl, chart, info, robber, evBanner, evDie, rollBtn, optBtn);
  el.append(dice);
  let lastHit = 0, pending = null, robT = 0, evT = 0, evSpin = 0;
  const tray = createTray(dice, {
    tray: { cx: 0.5, cy: 0.405, r: 0.135 },
    onHit: (k) => { const now = performance.now(); if (now - lastHit > 50 && k > 0.1) { lastHit = now; app.sfx('click', { pitch: 0.7 + rnd() * 0.6, volume: 0.4 + k }); } },
    onSettle: () => settled(),
  });
  const offRaf = app.raf((dt) => tray.frame(dt));
  function setupDice() {
    const l = S.last || [6, 6];
    tray.setBodies([{ id: 'r', type: 'd6', face: l[0], color: '#dc2626', ink: '#ffffff' }, { id: 'y', type: 'd6', face: l[1], color: '#facc15', ink: '#1c1917' }], tray.geo.R * 0.5);
    tray.layoutGrid(true);
  }
  function drawEvent(face) {
    evDie.hidden = !X.ck;
    if (!X.ck) return;
    const g = GATE[face];
    evDie.dataset.face = face || '';
    evDie.style.setProperty('--ec', g ? g.color : '#0f172a');
    evDie.style.setProperty('--ei', g ? g.ink : '#fff');
    evDie.innerHTML = face ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${face === 'ship' ? SHIP_D : GATE_D}"/></svg>` : '<small>event</small>';
  }
  const roller = () => S.players[S.turn % S.players.length];
  let pendingEv = null;
  function roll() {
    if (tray.rolling) return;
    let a, b;
    if (S.deck) {
      if (S.cards.length <= 5) { S.cards = DECK(); app.toast('Event deck reshuffled'); }
      [a, b] = S.cards.pop();
    } else { a = randFace('d6'); b = randFace('d6'); }
    pending = [a, b];
    pendingEv = X.ck ? EVENT[Math.floor(rnd() * 6)] : null;
    robber.classList.remove('on'); evBanner.classList.remove('on');
    sumEl.textContent = '…'; sumEl.className = 'bg-cat-sum rolling';
    if (X.ck) { evDie.classList.add('rolling'); clearInterval(evSpin); evSpin = setInterval(() => drawEvent(EVENT[Math.floor(Math.random() * 6)]), 90); }
    app.sfx('whoosh');
    tray.roll([a, b]);
  }
  function settled() {
    if (!pending) return;
    const [a, b] = pending; const s = a + b;
    pending = null;
    S.last = [a, b]; S.counts[s]++; S.rolls++;
    const who = roller();
    sumEl.textContent = String(s);
    sumEl.className = `bg-cat-sum${s === 7 ? ' seven' : s === 6 || s === 8 ? ' hot' : ''}`;
    if (s === 7) {
      const early = X.ck && !S.bar.attacks;
      robber.replaceChildren(h('b', early ? 'SEVEN' : X.sea ? 'ROBBER / PIRATE!' : 'ROBBER!'),
        h('span', early ? 'Discard if you hold too many (7, +2 per city wall) — the robber stays put until the first barbarian attack.' : `Anyone holding ${X.ck ? 'more than 7 (+2 per wall)' : '8+ cards'} discards half (round down). Move the ${X.sea ? 'robber or the pirate' : 'robber'} and steal one card.`));
      robber.classList.add('on'); clearTimeout(robT); robT = setTimeout(() => robber.classList.remove('on'), 7000); app.sfx('boom'); app.vibrate?.(60);
    } else app.sfx('score');
    S.lastBy = who.name;
    S.turn = (S.turn + 1) % S.players.length;
    if (X.ck && pendingEv) { clearInterval(evSpin); evDie.classList.remove('rolling'); S.lastEv = pendingEv; drawEvent(pendingEv); eventResult(pendingEv, a, s === 7); pendingEv = null; }
    save(); drawChart(); drawTurn();
  }
  function eventResult(face, red, seven) {
    let msg;
    if (face === 'ship') {
      S.bar.pos = Math.min(S.bar.len, S.bar.pos + 1);
      if (S.bar.pos >= S.bar.len) { save(); setTimeout(() => attack(), seven ? 1400 : 500); msg = [h('b', 'BARBARIANS LAND!'), h('span', 'Knights vs cities — resolve the attack.')]; }
      else msg = [h('b', `Barbarians ${S.bar.pos} / ${S.bar.len}`), h('span', `${S.bar.len - S.bar.pos} more ship${S.bar.len - S.bar.pos > 1 ? 's' : ''} until they attack. Activate your knights!`)];
      app.sfx(S.bar.pos >= S.bar.len ? 'boom' : 'drop');
    } else {
      const g = GATE[face];
      const lvl = Math.max(1, red - 1);
      const who = S.players.filter((p) => drawsProgress(ckOf(p)[face], red)).map((p) => p.name);
      msg = [h('b', `${g.name} gate · red ${red}`), h('span', `${g.name} level ${lvl}+ draws a ${face === 'trade' ? 'yellow' : face === 'politics' ? 'blue' : 'green'} progress card${who.length ? `: ${who.join(', ')}` : ' — nobody yet'}.`)];
    }
    evBanner.replaceChildren(...msg);
    evBanner.style.setProperty('--ec', face === 'ship' ? '#0f172a' : GATE[face].color);
    evBanner.dataset.face = face;
    evBanner.classList.toggle('low', seven);
    evBanner.classList.add('on'); clearTimeout(evT); evT = setTimeout(() => evBanner.classList.remove('on'), 8000);
  }
  function drawTurn() {
    const p = roller(), n = S.players.length;
    turnEl.style.setProperty('--c', p.color);
    if (X.ext && n >= 5 && X.pair === 'paired') {
      const q = S.players[(S.turn + 3) % n];
      turnEl.replaceChildren(h('i'), h('span', 'Pair: '), h('b', p.name), h('span', ' + '), h('b', q.name), h('span', ' builds'));
    } else turnEl.replaceChildren(h('i'), h('span', S.rolls ? `${S.lastBy || ''} rolled · next: ` : 'First roll: '), h('b', p.name));
  }
  function drawChart() {
    clear(chart);
    const n = S.rolls, max = Math.max(1, ...S.counts.slice(2), n * P36(7));
    for (let s = 2; s <= 12; s++) {
      const exp = n * P36(s), c = S.counts[s];
      chart.append(h(`div.bg-cat-bar${s === 7 ? '.seven' : ''}${S.last && S.last[0] + S.last[1] === s ? '.last' : ''}`,
        h('div.bg-cat-col', h('i.fill', { style: { height: `${(c / max) * 100}%` } }), h('i.exp', { style: { bottom: `${(exp / max) * 100}%` } }), c ? h('em', String(c)) : null),
        h('span', String(s))));
    }
    const sevens = S.counts[7];
    const extra = [X.ck ? `⛵ ${S.bar.pos}/${S.bar.len}` : '', X.ext && S.players.length >= 5 && X.pair === 'sbp' ? 'then everyone may build (no trading)' : ''].filter(Boolean).join(' · ');
    info.textContent = (n ? `${n} roll${n > 1 ? 's' : ''} · 7s: ${sevens} (expected ${(n / 6).toFixed(1)})${S.deck ? ` · deck ${S.cards.length} left` : ''}` : (S.deck ? 'Event deck: 36 cards, every result exactly once' : 'Bars: your rolls · ticks: expected')) + (extra ? ` · ${extra}` : '');
  }
  function pickTurn() {
    openPanel({
      title: 'Whose turn?', className: 'bg-choose',
      build(body, panel) {
        const list = h('div.list');
        S.players.forEach((p, i) => list.append(h(`button.row${i === S.turn % S.players.length ? '.active' : ''}`, { type: 'button', onclick: () => { S.turn = i; save(); drawTurn(); panel.close(); } }, h('span.bg-dot', { style: { background: p.color } }), h('div.row-text', h('div.row-title', p.name)))));
        body.append(list, h('button.pill.small', { type: 'button', onclick: () => { panel.close(); editPlayers(app, { players: S.players, min: 2, max: 6, onChange: () => { save(); drawTurn(); drawPoints(); } }); } }, 'Edit players'));
      },
    });
  }
  function diceOptions() {
    openPanel({
      title: 'Catan dice', className: 'bg-sc-set',
      build(body, panel) {
        const sw = h('span.switch'); sw.classList.toggle('on', S.deck);
        body.append(
          h('button.bg-row-opt', { type: 'button', onclick: () => { S.deck = !S.deck; S.cards = S.deck ? DECK() : []; sw.classList.toggle('on', S.deck); save(); drawChart(); } }, h('span', 'Event deck (balanced dice)'), sw),
          h('div.bg-note', 'The deck holds all 36 two-dice results once each and is reshuffled when 5 cards are left — rolls follow the odds closely, with no long droughts.'),
          h('button.bg-row-opt', { type: 'button', onclick: () => { panel.close(); pickTurn(); } }, h('span', 'Players & turn order'), h('b', `${S.players.length} ›`)),
          h('button.bg-row-opt', { type: 'button', onclick: () => { panel.close(); S.tab = 'setup'; tabs.set('setup'); save(); show(); } }, h('span', 'Expansions'), h('b', `${activeNames() || 'Base game'} ›`)),
          h('button.pill.small.danger', { type: 'button', onclick: async () => { panel.close(); if (await confirm('Reset stats', 'Clear the roll chart?', 'Clear')) { S.counts = Array(13).fill(0); S.rolls = 0; S.cards = S.deck ? DECK() : []; save(); drawChart(); } } }, 'Reset chart'));
      },
    });
  }

  // ---------------------------------------------------------------- points tab
  const pts = h('div.bg-cat-points');
  el.append(pts);
  let stopCel = null;
  function drawPoints() {
    clear(pts);
    S.sel = Math.min(S.sel, S.players.length - 1);
    const p = S.players[S.sel], v = V(p), tot = points(p);
    const chips = h('div.bg-cat-chips', S.players.map((q, i) => h(`button.bg-ttr-chip${i === S.sel ? '.on' : ''}`, { type: 'button', '--c': q.color, onclick: () => { S.sel = i; save(); drawPoints(); } }, h('b', q.name.slice(0, 1).toUpperCase()), h('small', String(points(q))))));
    const pct = Math.min(1, tot / S.target);
    const ring = h('div.bg-cat-vp', { '--c': p.color, style: { '--p': pct } }, h('small.n', p.name), h('b', String(tot)), h('small', `of ${S.target} VP`));
    const row = (label, sub, val, onMinus, onPlus) => h('div.bg-cat-row', h('div.bg-cat-l', h('b', label), h('small', sub)),
      h('button.bg-step-b', { type: 'button', 'aria-label': `Less ${label}`, onclick: onMinus }, '−'), h('span.bg-step-v', String(val)), h('button.bg-step-b', { type: 'button', 'aria-label': `More ${label}`, onclick: onPlus }, '+'));
    const tog = (label, key, sub = '+2 VP') => h(`button.bg-cat-tog${v[key] ? '.on' : ''}`, { type: 'button', onclick: () => {
      const on = !v[key];
      for (const q of S.players) V(q)[key] = false;
      v[key] = on; change();
    } }, h('b', label), h('small', sub));
    const step = (key, max) => [() => { v[key] = Math.max(0, v[key] - 1); change(); }, () => { if (v[key] < max) { v[key]++; change(); } }];
    const rows = h('div.bg-cat-rows');
    rows.append(row('Settlements', '1 VP · max 5', v.s, () => { v.s = Math.max(0, v.s - 1); change(); }, () => { if (v.s < 5) { v.s++; change(); } }));
    rows.append(row(X.ep ? 'Harbour settlements' : 'Cities', X.ep ? '2 VP · replaces a settlement' : '2 VP · replaces a settlement', v.c, () => { if (v.c > 0) { v.c--; v.s = Math.min(5, v.s + 1); v.metro = Math.min(v.metro, v.c); change(); } }, () => { if (v.c < 4) { v.c++; if (v.s > 0) v.s--; change(); } }));
    if (X.ck) {
      rows.append(row('Metropolis', '+2 VP on a city · first to level 4', v.metro, () => { v.metro = Math.max(0, v.metro - 1); change(); }, () => { if (v.metro < Math.min(3, v.c)) { v.metro++; change(); } }));
      rows.append(row('Defender of Catan', '1 VP each · from barbarian attacks', v.defender, ...step('defender', 9)));
      rows.append(row('Progress VPs', 'Printer, Constitution (1 VP)', v.cards, ...step('cards', 4)));
    } else if (!X.ep) rows.append(row('VP cards', '1 VP each', v.cards, ...step('cards', 5)));
    if (X.ep) rows.append(row('Mission VPs', 'lairs, fish, spices, islands', v.bonus, ...step('bonus', 20)));
    else if (X.sea || X.tb) rows.append(row(X.tb ? 'Scenario VPs' : 'Island & scenario VPs', X.tb ? 'per the scenario (± allowed)' : '+2 per new island, chits, cloth…', v.bonus, () => { v.bonus = Math.max(X.tb ? -4 : 0, v.bonus - 1); change(); }, () => { if (v.bonus < 20) { v.bonus++; change(); } }));
    if (!X.ep) rows.append(h('div.bg-cat-togs', tog(X.sea ? 'Longest route' : 'Longest road', 'road'), X.ck ? tog('Merchant', 'merchant', '+1 VP') : tog('Largest army', 'army')));
    rows.classList.toggle('many', rows.children.length > 4);
    pts.append(chips, ring, rows,
      h('button.bg-cat-target', { type: 'button', onclick: () => { S.target = S.target >= 20 ? 5 : S.target + 1; save(); drawPoints(); } }, `Play to ${S.target} ›`));
  }
  function change() {
    save(); drawPoints(); app.sfx('tick');
    const w = S.players.find((q) => points(q) >= S.target);
    if (w && S.won !== w.id) { S.won = w.id; save(); app.sfx('win'); stopCel = celebrate(el, `${w.name} wins!`, w.color, `${points(w)} victory points`); }
    if (!w) S.won = null;
  }

  // ---------------------------------------------------------------- knights tab (Cities & Knights)
  const kn = h('div.bg-cat-kn');
  el.append(kn);
  function drawKnights() {
    clear(kn);
    const B = S.bar;
    const track = h('div.bg-cat-bt');
    for (let i = 0; i <= B.len; i++) track.append(h(`i${i === B.pos ? '.on' : ''}${i === B.len ? '.land' : ''}`, i === B.pos ? h('span', { html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SHIP_D}"/></svg>` }) : i === B.len ? '⚓' : ''));
    const barb = S.players.reduce((s, p) => s + V(p).c, 0), kt = S.players.reduce((s, p) => s + ckOf(p).knights, 0);
    const lvl = (p, k) => { const c = ckOf(p); return h(`button.bg-cat-lv.${k}`, { type: 'button', '--gc': GATE[k].color, 'aria-label': `${GATE[k].name} level`, onclick: () => { c[k] = (c[k] + 1) % 6; save(); drawKnights(); app.sfx('tick'); } }, String(c[k])); };
    kn.append(
      h('div.bg-cat-bthead', h('button.bg-step-b', { type: 'button', 'aria-label': 'Ship back', onclick: () => { B.pos = Math.max(0, B.pos - 1); save(); drawKnights(); } }, '−'), track,
        h('button.bg-step-b', { type: 'button', 'aria-label': 'Ship forward', onclick: () => { B.pos = Math.min(B.len, B.pos + 1); save(); drawKnights(); if (B.pos >= B.len) attack(); } }, '+')),
      h('div.bg-cat-vs', h('span.barb', `Barbarians ${barb}`), h('small', ' cities  vs  active knights '), h('span.kn', `${kt} Knights`)),
      h('div.bg-cat-ktab',
        h('div.bg-cat-kh', h('span', ''), h('span', 'Cities'), h('span', 'Active knights'), h('span.t', 'T'), h('span.p', 'P'), h('span.s', 'S')),
        ...S.players.map((p) => {
          const c = ckOf(p);
          return h('div.bg-cat-kr', { '--c': p.color },
            h('b', h('i'), p.name),
            h('span.cities', String(V(p).c)),
            h('span.kst', h('button.bg-step-b', { type: 'button', 'aria-label': `Fewer knights ${p.name}`, onclick: () => { c.knights = Math.max(0, c.knights - 1); save(); drawKnights(); } }, '−'), h('em', String(c.knights)),
              h('button.bg-step-b', { type: 'button', 'aria-label': `More knights ${p.name}`, onclick: () => { c.knights = Math.min(18, c.knights + 1); save(); drawKnights(); } }, '+')),
            lvl(p, 'trade'), lvl(p, 'politics'), lvl(p, 'science'));
        })),
      h('div.bg-cat-knote', 'Knights: basic 1 · strong 2 · mighty 3 (active only). T/P/S = city improvement levels — tap to change.'),
      h('button.pill.small.bg-cat-attack', { type: 'button', onclick: () => attack() }, 'Barbarians attack now'));
  }
  function attack() {
    const r = barbarianAttack(S.players, V, ckOf);
    const name = (id) => S.players.find((p) => p.id === id)?.name;
    openPanel({
      title: 'The barbarians attack!', className: 'bg-cat-atk',
      build(body, panel) {
        const verdict = r.saved
          ? (r.defender ? `Catan is saved! ${name(r.defender)} is the Defender of Catan (+1 VP).` : `Catan is saved! A tie for the most knights — ${r.tied.map(name).join(', ')} each draw a progress card.`)
          : (r.losers.length ? `The barbarians win. ${r.losers.map(name).join(', ')} lose${r.losers.length > 1 ? '' : 's'} a city (it becomes a settlement; metropolises are safe).` : 'The barbarians win — but nobody has a city they can take.');
        body.append(
          h('div.bg-cat-atkvs', h('div.barb', h('b', String(r.barb)), h('small', 'barbarians (cities)')), h('div.kn', h('b', String(r.knights)), h('small', 'active knights'))),
          h('div.bg-confirm-m', verdict),
          h('button.pill.primary', { type: 'button', onclick: () => {
            if (r.saved && r.defender) V(S.players.find((p) => p.id === r.defender)).defender++;
            for (const id of r.losers) { const v = V(S.players.find((p) => p.id === id)); if (v.c > 0) { v.c--; v.s = Math.min(5, v.s + 1); v.metro = Math.min(v.metro, v.c); } }
            for (const p of S.players) ckOf(p).knights = 0;     // every knight is deactivated after an attack
            S.bar.pos = 0; S.bar.attacks++;
            save(); panel.close(); app.sfx(r.saved ? 'perfect' : 'over'); show(); change();
          } }, 'Apply — ship back to the start'),
          h('div.bg-note', 'Afterwards all knights are deactivated and the ship sails back to the start. From now on the robber can move.'));
      },
    });
  }

  // ---------------------------------------------------------------- costs & trade cheat sheet
  const costs = h('div.bg-cat-costs');
  el.append(costs);
  let costSet = 'base';
  function drawCosts() {
    clear(costs);
    const sets = ['base', ...['sea', 'ck', 'tb', 'ep'].filter((k) => X[k])];
    if (!sets.includes(costSet)) costSet = 'base';
    if (sets.length > 1) costs.append(seg(sets.map((v) => ({ v, label: { base: 'Base', sea: 'Seafarers', ck: 'C & K', tb: 'T & B', ep: 'E & P' }[v] })), costSet, (v) => { costSet = v; drawCosts(); }, 'bg-cat-csets'));
    const list = costSet === 'ep' ? COSTS.ep : costSet === 'base' ? (X.ep ? COSTS.base.slice(0, 2) : X.ck ? COSTS.base.slice(0, 3) : COSTS.base) : COSTS[costSet];
    costs.classList.toggle('sub', sets.length > 1);
    costs.append(
      h('div.bg-cat-cost-list', list.map((c) => h('div.bg-cat-cost',
        h('div.bg-cat-cost-l', h('b', c.name, h('span', { dir: 'rtl' }, c.he)), h('small', c.vp)),
        h('div.bg-cat-cost-r', c.res.map(resChip))))));
    if (costSet === 'base') costs.append(
      h('div.bg-cat-trade',
        h('div.bg-cat-tr', h('b', '4 : 1'), h('small', 'Bank'), h('em', '4 alike → 1')),
        h('div.bg-cat-tr', h('b', '3 : 1'), h('small', 'Any harbour'), h('em', '3 alike → 1')),
        h('div.bg-cat-tr', h('b', '2 : 1'), h('small', 'Resource harbour'), h('em', '2 of its kind → 1'))),
      h('div.bg-cat-legend', ['brick', 'lumber', 'wool', 'grain', 'ore'].map((k) => h('span.bg-cat-lg', resChip(k), h('small', RES[k].name)))));
    else if (costSet === 'ck') costs.append(h('div.bg-cat-legend', ['paper', 'cloth', 'coin'].map((k) => h('span.bg-cat-lg', resChip(k), h('small', `${RES[k].name} · ${{ paper: 'forest', cloth: 'pasture', coin: 'mountains' }[k]}`)))));
    costs.append(h(`div.bg-cat-notes.n-${costSet}`, (COST_NOTES[costSet] || []).map(([b, t]) => h('p', h('b', b), t))));
  }

  // ---------------------------------------------------------------- setup: expansions & scenarios
  const setup = h('div.bg-cat-setup');
  el.append(setup);
  let note = '';
  const scenOf = (k) => (k === 'sea' ? SEA_SCEN.find((s) => s.id === X.seaS) : k === 'tb' ? TB_SCEN.find((s) => s.id === X.tbS) : EP_SCEN.find((s) => s.id === X.epS));
  function goal() {
    if (X.ep) return scenOf('ep').vp;
    if (X.tb) return scenOf('tb').vp;
    if (X.sea) return Math.max(scenOf('sea').vp, X.ck ? 13 : 0);
    return X.ck ? 13 : 10;
  }
  const activeNames = () => [X.sea && 'Seafarers', X.ck && 'Cities & Knights', X.tb && 'Traders & Barbarians', X.ep && 'Explorers & Pirates', X.ext && '5–6'].filter(Boolean).join(' + ');
  function setX(k, on) {
    X[k] = on;
    if (on) for (const o of ({ ep: ['ck', 'tb', 'sea'], ck: ['tb', 'ep'], tb: ['ck', 'ep'], sea: ['ep'] })[k] || []) X[o] = false;   // which ones can't be combined
    S.target = goal(); save(); buildTabs(); drawEvent(S.lastEv); drawTurn(); drawChart(); drawSetup();
  }
  function drawSetup() {
    clear(setup);
    const chip = (k, label, n) => h(`button.chip${X[k] ? '.on' : ''}`, { type: 'button', onclick: () => { note = n; setX(k, !X[k]); } }, label);
    const scen = (k, list, key) => h('div.bg-mk-chips.bg-cat-scen', list.map((s) => h(`button.chip${X[key] === s.id ? '.on' : ''}`, { type: 'button', onclick: () => { X[key] = s.id; note = `${s.name}: ${s.vp} VP. ${s.note}`; S.target = goal(); save(); drawSetup(); } }, `${s.name} · ${s.vp}`)));
    const sc = h('div.bg-mk-scroll');
    put(sc,
      h('div.bg-sect', 'Expansions'),
      h('div.bg-mk-chips',
        chip('sea', 'Seafarers', 'Seafarers: ships (lumber + wool), islands, the pirate and gold fields. Pick a scenario — each has its own goal.'),
        chip('ck', 'Cities & Knights', 'Cities & Knights: play to 13. Event die and barbarians, knights, city walls, improvements with paper / cloth / coin, progress cards instead of development cards.'),
        chip('tb', 'Traders & Barbarians', 'Traders & Barbarians: five scenarios plus variants (2 players, Harbourmaster, Friendly robber, event cards).'),
        chip('ep', 'Explorers & Pirates', 'Explorers & Pirates: five scenarios built up step by step; settler ships, crews, harbour settlements, missions.'),
        chip('ext', '5–6 players', '5–6 player extension (one for the base game and for each expansion): bigger island, more pieces.')),
      X.sea ? h('div.bg-sect', 'Seafarers scenario') : null, X.sea ? scen('sea', SEA_SCEN, 'seaS') : null,
      X.tb ? h('div.bg-sect', 'Traders & Barbarians scenario') : null, X.tb ? scen('tb', TB_SCEN, 'tbS') : null,
      X.ep ? h('div.bg-sect', 'Explorers & Pirates scenario') : null, X.ep ? scen('ep', EP_SCEN, 'epS') : null,
      X.ext ? h('div.bg-sect', '5–6 players: between turns') : null,
      X.ext ? h('div.bg-mk-chips',
        h(`button.chip${X.pair === 'paired' ? '.on' : ''}`, { type: 'button', onclick: () => { X.pair = 'paired'; note = 'Paired players (the current official rule): two players take turns together — the second one (3 seats to the left) may build and trade with the bank, but doesn’t roll or trade with players. The pair then moves one seat on.'; save(); drawSetup(); drawTurn(); } }, 'Paired players'),
        h(`button.chip${X.pair === 'sbp' ? '.on' : ''}`, { type: 'button', onclick: () => { X.pair = 'sbp'; note = 'Special building phase (older rule): after each turn, every other player in turn may build — no trading, not even with the bank.'; save(); drawSetup(); drawChart(); } }, 'Special building phase')) : null,
      h('div.bg-sect', 'More Catan'),
      h('div.bg-mk-chips', OTHER.map(([n, s]) => h('button.chip.ghost', { type: 'button', onclick: () => { note = `${n}: ${s}.`; drawSetup(); } }, n))));
    setup.append(sc, h('div.bg-mk-note', note || `${activeNames() || 'Base game'} · goal ${goal()} VP${X.sea && X.ck ? ' — combining them, agree on the goal (tap “Play to” on Points)' : ''}`));
  }

  function show() {
    dice.hidden = S.tab !== 'dice'; pts.hidden = S.tab !== 'points'; costs.hidden = S.tab !== 'costs'; kn.hidden = S.tab !== 'knights'; setup.hidden = S.tab !== 'setup';
    if (S.tab === 'points') drawPoints(); else if (S.tab === 'knights') drawKnights(); else if (S.tab === 'costs') drawCosts(); else if (S.tab === 'setup') drawSetup(); else tray.redraw();
  }
  buildTabs(); setupDice(); drawEvent(S.lastEv); drawChart(); drawTurn(); show();
  return {
    key(e) {
      if (S.tab === 'dice' && (e.key === 'Enter' || e.key === ' ')) { roll(); return true; }
      const T = tabList();
      if (e.key === 'Tab' || (S.tab !== 'points' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) || (S.tab === 'points' && e.key === 'ArrowLeft' && S.sel === 0)) {
        const d = e.key === 'ArrowLeft' ? -1 : 1;
        S.tab = T[(T.indexOf(S.tab) + d + T.length) % T.length]; tabs.set(S.tab); save(); show(); return true;
      }
      if (S.tab === 'points' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { S.sel = (S.sel + (e.key === 'ArrowRight' ? 1 : -1) + S.players.length) % S.players.length; drawPoints(); return true; }
      return false;
    },
    destroy() { offRaf(); tray.destroy(); stopCel?.(); clearTimeout(robT); clearTimeout(evT); clearInterval(evSpin); },
  };
}
