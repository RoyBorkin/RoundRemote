// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Fill the Blank — a party card game for 3–20 players, played from phones (or by passing the round display around).
// Every round one prompt card (dark) shows big in the middle; everyone except the judge plays the funniest answer card
// (light) from the hand of 7 on their phone; the judge reveals the answers one by one and picks a winner → a point.
// First to N points (or N rounds) wins. House rules: Fresh hand (swap cards for a point), Robo (a house bot that plays a
// random card), write-your-own blank cards, a timer that plays a random card for the slow ones, and "Everyone votes"
// instead of a judge. Packs: our own Family and Party (18+) packs in English and Hebrew, the bridge's house pack (cards
// added from phones), and imported JSON packs. The display keeps the game; the bridge (bridge/lib/blanks.js) relays it and
// sends each phone only its own hand. Without the bridge: pass-the-device mode, with a cover screen between players.
import { h, clear } from '../js/ui/dom.js';
import { editText } from '../js/ui/keyboard.js';
import { store } from '../js/core/store.js';
import { themeEvents } from '../js/core/theme.js';
import { partyLink, qrBox, linkProblem, confetti } from '../apps/party-link.js';
import { bridgeBase } from '../js/providers/bridge.js';
import { BUILTIN, builtinById, loadBuiltin, bridgePacks, bridgePack, removeBridgePack, removeHouseCard, importUrl, fillParts } from './blanks-packs.js';

const ID = 'blanks';
const HAND = 7, MAX_PLAYERS = 20;
const COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f43f5e'];
const BOT = { name: 'Robo', color: '#94a3b8' };
// source: which cards to play — 'builtin' (our packs, the ones ticked in `packs`), 'custom' (the bridge's house pack of cards
// added from phones + imported packs, minus those in `off`) or 'all' (both). custom18: also deal house cards marked 18+.
const DEF = { packs: ['family-en'], win: 7, rounds: 0, timer: 0, judge: 'rotate', bot: false, wild: 1, swap: false, source: 'builtin', off: [], custom18: false };
const SOURCES = [['builtin', 'Built-in'], ['custom', 'Custom'], ['all', 'All']];
let openOnStart = null;   // the start card's "Add cards" opens the Custom cards page right away (see menuActions)
const ICON = {
  crown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 7.5l5 4.2L12 4l4.5 7.7 5-4.2-2 11.5h-15z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 16.6L4.6 12l-1.6 1.6 6.2 6.2L21 8l-1.6-1.6z"/></svg>',
  bot: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 2h2v3h4a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h4zM8.5 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM8 15.5v1.6h8v-1.6z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v13h10V5zm4 14.2v1.3h2v-1.3z"/></svg>',
  pass: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h11V3l5 4.5-5 4.5V9H4zm16 12H9v3l-5-4.5L9 12v3h11z"/></svg>',
};

// ---------------------------------------------------------------- saved state (gameProgress.blanks)
const prog = () => store.get('gameProgress')?.[ID] || {};
const putProg = (patch) => { const all = store.get('gameProgress') || {}; store.set('gameProgress', { ...all, [ID]: { ...(all[ID] || {}), ...patch } }); };
const SHIM = { data: (k, d) => prog()[k] ?? d, save: (k, v) => putProg({ [k]: v }) };   // what partyLink wants from an app
const isLite = () => !!store.get('liteMode') || !!store.get('batterySaver');
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const range = (n) => Array.from({ length: n }, (_, i) => i);
const rk = () => Math.random().toString(36).slice(2, 8);
const initial = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const errMsg = (e) => e?.body?.error || e?.userMessage || e?.message || String(e);

function ensureCss() {
  if (document.getElementById('fb-css')) return;
  const l = document.createElement('link');
  l.id = 'fb-css'; l.rel = 'stylesheet'; l.href = new URL('./blanks.css', import.meta.url).href;
  document.head.append(l);
}

export default {
  howTo: 'A party card game for 3–20 players. Join from your phone with the QR code, play your funniest card into the blank, and the judge picks the winner of each round.',
  modes: [{ id: 'phones', name: 'Phones' }, { id: 'pass', name: 'Pass the device' }],
  party: true,   // no chart (the winner changes every game): games/shell.js hides the best score, Top 5 and the pause card's score
  scoring: 'high',
  unit: 'pts',
  hud: false,
  // an extra button on the start card (games/shell.js): straight to Custom cards, with the QR phones scan to add cards
  menuActions: () => [{ label: 'Add cards', run: ({ play }) => { openOnStart = 'cards'; play(); } }],
  create(g, { mode: modeId }) {
    ensureCss();
    const host = g.canvas.parentElement;
    const rim = h('div.fb-rim', { html: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="fb-rim-bg" cx="50" cy="50" r="48.8"/><circle class="fb-rim-fg" cx="50" cy="50" r="48.8" pathLength="100"/></svg>' });
    const ring = h('div.fb-ring'), page = h('div.fb-page'), modal = h('div.fb-modal');
    const root = h('div.fb', rim, ring, page, modal);
    host.insertBefore(root, g.canvas.nextSibling);
    const rimFg = rim.querySelector('.fb-rim-fg');

    let lite = isLite();
    root.classList.toggle('lite', lite);
    const settings = () => {
      const sv = prog().settings || {};
      const out = { ...DEF, ...sv };
      // older saves ticked custom packs in `packs`: keep playing them
      if (!sv.source && (sv.packs || []).some((id) => !builtinById(id))) out.source = 'all';
      out.packs = (out.packs || []).filter((id) => builtinById(id));
      return out;
    };
    let S = settings();
    const setS = (patch) => { S = { ...S, ...patch }; putProg({ settings: S }); };
    let mode = modeId === 'pass' ? 'pass' : 'phones';
    let roster = { ...(prog().roster || {}) };   // phones: device → { name, color, pid }
    let locals = (prog().locals || []).slice();   // pass the device: [{ key, name, color }]
    let nextPid = prog().nextPid || 1;
    const kicked = new Set(prog().kicked || []);   // phones removed in the lobby (refused by the bridge until a new room)
    let G = null, pool = null, view = 'lobby', browse = 0, kIdx = -1, kbd = false, modalOn = null;
    let packInfo = null, packInfoAt = 0, qr = null, qrCode = '', busy = false, addQr = null, cardsBack = 'lobby', bcount = {}, packLoading = false, autoT = 0, botT = 0, revealT = 0, voteT = 0, saveT = 0;
    let animKey = '', rimKey = '', lastSec = -1, bgDirty = true, pausedAt = 0, offs = [];
    let hand = { sel: [], idx: 0, wild: '' };  // pass the device: the player's picks on the display
    const saved = prog().game && prog().game.phase !== 'final' && Date.now() - (prog().game.savedAt || 0) < 12 * 3600e3 ? prog().game : null;
    let resumeAvail = !!saved;

    // ------------------------------------------------------------ phones (bridge link)
    const link = partyLink(ID, SHIM, { onAct });
    offs.push(link.events.on('status', () => { if (view === 'lobby' || view === 'cards') render(); }));
    offs.push(link.events.on('room', () => { qr = null; qrCode = ''; render(); }));

    function onAct(a) {
      const dev = a.device;
      if (a.type === 'join') return onJoin(a);
      if (a.type === 'added') { g.toast(`${a.name || 'A phone'} added ${a.kind === 'pack' ? 'a card pack' : 'a card'}`, 1800); g.sfx('coin'); packInfo = null; if (view === 'packs') loadPackInfo(true); return; }
      if (a.type === 'leave') { removePlayer(dev); return; }
      if (mode !== 'phones' || !G) return;
      if (a.round && a.round !== G.round) return;
      if (a.type === 'play') onPlay(dev, a.cards, a.wild);
      else if (a.type === 'swap') onSwap(dev, a.cards);
      else if (a.type === 'next' && isJudge(dev)) revealNext();
      else if (a.type === 'pick' && isJudge(dev) && G.phase === 'reveal' && revealDone()) award([a.k]);
      else if (a.type === 'vote') onVote(dev, a.k);
      else if (a.type === 'go' && G.phase === 'win' && (isJudge(dev) || S.judge === 'vote')) advance();
    }
    function onJoin(a) {
      if (mode !== 'phones' || kicked.has(a.device)) return;
      const dev = a.device, old = roster[dev];
      if (!old && Object.keys(roster).length >= MAX_PLAYERS) return;
      const color = a.color || old?.color || freeColor();
      roster[dev] = { name: (a.name || old?.name || 'Player').slice(0, 24), color, pid: old?.pid || `p${nextPid++}` };
      putProg({ roster, nextPid });
      if (G) {
        if (!G.players[dev]) addPlayer(dev, roster[dev]);
        else Object.assign(G.players[dev], { name: roster[dev].name, color });
      }
      if (!old) { g.sfx('pop'); g.toast(`${roster[dev].name} joined`, 1400); }
      publish(); render(); saveG();
    }
    const freeColor = () => {
      const used = new Set([...Object.values(roster), ...locals].map((p) => p.color));
      return COLORS.find((c) => !used.has(c)) || COLORS[Math.floor(Math.random() * COLORS.length)];
    };

    // ------------------------------------------------------------ packs
    const adultIds = () => new Set([...BUILTIN.filter((p) => p.adult).map((p) => p.id), ...(packInfo?.packs || []).filter((p) => p.adult).map((p) => p.id), ...(prog().local || []).filter((p) => p.adult).map((p) => p.id)]);
    const adultOk = () => !!prog().adultOk;
    // ---- where the cards come from (S.source)
    const builtinSel = () => { const b = S.packs.filter((id) => builtinById(id)); return b.length ? b : ['family-en']; };
    /** Every custom pack there is: the house pack (if it has cards), the bridge's imported packs, packs imported on this screen. */
    const customAll = () => [...(packInfo && packInfo.house.prompts + packInfo.house.answers ? ['house'] : []), ...(packInfo?.packs || []).map((p) => p.id), ...(prog().local || []).map((p) => p.id)];
    const customSel = () => customAll().filter((id) => !(S.off || []).includes(id));
    const usesCustom = () => S.source === 'custom' || S.source === 'all';
    const effPacks = () => [...(S.source === 'custom' ? [] : builtinSel()), ...(usesCustom() ? customSel() : [])];
    const houseAdult = () => usesCustom() && !(S.off || []).includes('house') && (S.custom18 || builtinSel().some((id) => S.source === 'all' && builtinById(id).adult));
    const adultOn = () => effPacks().some((id) => adultIds().has(id)) || (houseAdult() && !!(packInfo?.house.adultPrompts || packInfo?.house.adultAnswers));
    /** Cards in the custom packs that would be dealt now → { p, a } (null while the bridge's packs aren't known). */
    function customCounts(all = false) {
      const ids = all ? customAll() : customSel();
      let p = 0, a = 0;
      const ok18 = adultOk();
      if (packInfo && ids.includes('house')) {
        const H = packInfo.house, with18 = all || (ok18 && houseAdult());
        p += H.prompts - (with18 ? 0 : H.adultPrompts || 0); a += H.answers - (with18 ? 0 : H.adultAnswers || 0);
      }
      for (const pk of packInfo?.packs || []) if (ids.includes(pk.id) && (all || !pk.adult || ok18)) { p += pk.prompts; a += pk.answers; }
      for (const pk of prog().local || []) if (ids.includes(pk.id) && (all || !pk.adult || ok18)) { p += pk.prompts.length; a += pk.answers.length; }
      return { p, a, known: !!packInfo || mode === 'pass' || link.status === 'down' };
    }
    function builtinCounts() {
      let p = 0, a = 0, known = true;
      for (const id of builtinSel()) { const c = bcount[id]; if (c) { p += c[0]; a += c[1]; } else { known = false; loadBuiltin(id).then((pk) => { bcount[id] = [pk.prompts.length, pk.answers.length]; if (['lobby', 'settings', 'packs', 'cards'].includes(view)) render(); }).catch(() => {}); } }
      return { p, a, known };
    }
    async function loadPackInfo(force = false) {
      if (!force && packInfo && Date.now() - packInfoAt < 20000) return packInfo;
      packInfo = await bridgePacks();
      packInfoAt = Date.now();
      if (view === 'packs') render();
      return packInfo;
    }
    async function buildPool(ids) {
      const P = [], A = [], sp = new Set(), sa = new Set(), errs = [];
      const allowAdult = adultOk();
      const add = (pk) => {
        if (!pk) return;
        for (const p of pk.prompts || []) if (!sp.has(p.t)) { sp.add(p.t); P.push({ t: p.t, pick: Math.max(1, Math.min(3, p.pick || 1)) }); }
        for (const a of pk.answers || []) if (!sa.has(a)) { sa.add(a); A.push(a); }
      };
      for (const id of ids) {
        try {
          if (builtinById(id)) { if (builtinById(id).adult && !allowAdult) continue; add(await loadBuiltin(id)); }
          else if (id === 'house') add(await bridgePack('house', allowAdult && houseAdult()));
          else if (id.startsWith('l')) { const pk = (prog().local || []).find((x) => x.id === id); if (pk && (!pk.adult || allowAdult)) add(pk); }
          else { const pk = await bridgePack(id); if (!pk.adult || allowAdult) add(pk); }
        } catch (e) { errs.push(errMsg(e)); }
      }
      return { prompts: P, answers: A, sig: `${P.length}:${A.length}:${ids.join(',')}`, errs };
    }

    // ------------------------------------------------------------ the game
    const humans = () => (G ? G.order.filter((k) => G.players[k]) : []);
    const seats = () => (G ? [...humans(), ...(G.players.bot ? ['bot'] : [])] : []);
    const judgeKey = () => (G && S.judge === 'rotate' ? G.judge : null);
    const isJudge = (k) => !!G && S.judge === 'rotate' && G.judge === k;
    const playing = () => seats().filter((k) => !isJudge(k) && (G.players[k].hand.length || G.subs[k]));
    const allIn = () => { const p = playing(); return p.length > 0 && p.every((k) => G.subs[k]); };
    const revealDone = () => !!G?.reveal && G.reveal.idx >= G.reveal.list.length;
    const pidOf = (k) => (k === 'bot' ? 'bot' : G?.players[k]?.pid || roster[k]?.pid || k);

    function addPlayer(key, info) {
      G.players[key] = { key, pid: info.pid || key, name: info.name, color: info.color, score: 0, hand: [], wild: S.wild, bot: key === 'bot' };
      if (key !== 'bot' && !G.order.includes(key)) G.order.push(key);
      refill(G.players[key]);
    }
    function drawAnswer() {
      if (!G.deck.a.length) {
        const held = new Set(Object.values(G.players).flatMap((p) => p.hand.map((c) => c.id)));
        G.deck.a = shuffle(range(pool.answers.length).filter((i) => !held.has(`c${i}`)));
        if (!G.deck.a.length) return null;
      }
      const i = G.deck.a.pop();
      return { id: `c${i}`, t: pool.answers[i] };
    }
    function refill(p) { while (p.hand.length < HAND) { const c = drawAnswer(); if (!c) break; p.hand.push(c); } }
    function drawPrompt() {
      if (!G.deck.p.length) G.deck.p = shuffle(range(pool.prompts.length));
      const i = G.deck.p.pop();
      return { ...pool.prompts[i] };
    }

    async function startGame() {
      if (busy) return;
      const ppl = mode === 'phones' ? Object.entries(roster).filter(([d]) => !kicked.has(d)) : locals.map((p) => [p.key, p]);
      const total = ppl.length + (S.bot ? 1 : 0);
      if (total < 3) { g.toast(mode === 'phones' ? 'Need 3 players — scan to join (or add Robo)' : 'Add at least 3 players (or Robo)', 2200); g.sfx('hit'); return; }
      if (usesCustom() && !packInfo && mode === 'phones' && link.status !== 'down') { busy = true; render(); await loadPackInfo(true).catch(() => null); busy = false; }
      const packs = effPacks();
      if (adultOn() && !adultOk()) { if (!(await ageGate())) return; }
      busy = true; render();
      pool = await buildPool(packs);
      busy = false;
      if (pool.errs.length) g.toast(pool.errs[0], 2200);
      const need = HAND * total + 4;
      if (!pool.prompts.length || pool.answers.length < need) { notEnough(pool, total, need); render(); return; }
      if (S.source === 'custom' && pool.prompts.length < 6) g.toast(`Only ${plural(pool.prompts.length, 'prompt')} — they’ll come round again`, 2400);
      G = { v: 1, mode, round: 0, ji: -1, judge: null, phase: 'play', players: {}, order: [], deck: { p: shuffle(range(pool.prompts.length)), a: shuffle(range(pool.answers.length)) },
        packs: packs.slice(), poolSig: pool.sig, subs: {}, reveal: null, win: null, votes: {}, prompt: null, deadline: 0, total: 0, startedAt: Date.now() };
      for (const [key, info] of shuffle(ppl)) addPlayer(key, { ...info, pid: info.pid || key });
      if (S.bot) addPlayer('bot', { ...BOT, pid: 'bot' });
      resumeAvail = false;
      nextRound();
    }
    async function resumeGame() {
      const sv = prog().game;
      if (!sv) return;
      busy = true; render();
      pool = await buildPool(sv.packs || effPacks());
      busy = false;
      if (!pool.prompts.length || !pool.answers.length) { g.toast('Those card packs aren’t available any more', 2200); resumeAvail = false; render(); return; }
      G = sv; mode = G.mode || mode;
      if (G.poolSig !== pool.sig) { G.deck = { p: shuffle(range(pool.prompts.length)), a: shuffle(range(pool.answers.length)) }; G.poolSig = pool.sig; }
      if (G.deadline) G.deadline = Date.now() + Math.min(G.total || 30000, 30000);
      resumeAvail = false; view = G.phase;
      if (G.phase === 'play') scheduleBot();
      publish(); render();
    }
    function nextRound() {
      clearTimeout(autoT); clearTimeout(revealT); clearTimeout(voteT);
      G.round++; G.phase = 'play'; G.subs = {}; G.reveal = null; G.win = null; G.votes = {};
      if (S.judge === 'rotate' && G.order.length) { G.ji = (G.ji + 1) % G.order.length; G.judge = G.order[G.ji]; } else G.judge = null;
      for (const p of Object.values(G.players)) refill(p);
      G.prompt = drawPrompt();
      G.deadline = mode === 'phones' && S.timer ? Date.now() + S.timer * 1000 : 0; G.total = S.timer * 1000;
      if (mode === 'pass') {
        const order = humans(), j = order.indexOf(G.judge);
        G.pass = { queue: [...order.slice(j + 1), ...order.slice(0, Math.max(0, j))].filter((k) => k !== G.judge), i: 0, stage: 'cover' };
        hand = { sel: [], idx: 0, wild: '' };
      }
      browse = 0; view = 'play';
      scheduleBot();
      g.sfx('whoosh');
      saveG(); publish(); render();
    }
    function newPrompt() {
      if (!G || G.phase !== 'play' || Object.keys(G.subs).some((k) => k !== 'bot')) return;
      delete G.subs.bot;
      G.prompt = drawPrompt();
      scheduleBot(); g.sfx('whoosh');
      saveG(); publish(); render();
    }
    function scheduleBot() {
      clearTimeout(botT);
      if (!G?.players.bot || G.phase !== 'play' || G.subs.bot) return;
      botT = setTimeout(() => {
        const b = G?.players.bot;
        if (!b || G.phase !== 'play' || G.subs.bot) return;
        onPlay('bot', shuffle(b.hand).slice(0, G.prompt.pick).map((c) => c.id), '');
      }, mode === 'pass' ? 300 : 1200 + Math.random() * 3200);
    }
    function onPlay(key, ids, wild, auto = false) {
      if (!G || G.phase !== 'play') return false;
      const p = G.players[key];
      if (!p || G.subs[key] || isJudge(key)) return false;
      const pick = G.prompt.pick;
      ids = (Array.isArray(ids) ? ids : []).slice(0, pick);
      if (ids.length !== pick || new Set(ids).size !== ids.length) return false;
      const cards = [];
      for (const id of ids) {
        if (id === '*') { const w = String(wild || '').trim().slice(0, 90); if (!(p.wild > 0) || !w) return false; cards.push({ id: '*', t: w }); }
        else { const c = p.hand.find((x) => x.id === id); if (!c) return false; cards.push(c); }
      }
      p.hand = p.hand.filter((c) => !ids.includes(c.id));
      if (ids.includes('*')) p.wild--;
      G.subs[key] = { k: rk(), cards: cards.map((c) => c.t), ids: cards.map((c) => c.id), auto, at: Date.now() };
      g.sfx(key === 'bot' ? 'tick' : 'place');
      if (mode === 'pass' && G.pass && G.pass.queue[G.pass.i] === key) { G.pass.i++; G.pass.stage = 'cover'; hand = { sel: [], idx: 0, wild: '' }; }
      if (allIn()) { const r = G.round; clearTimeout(revealT); revealT = setTimeout(() => { if (G?.round === r && G.phase === 'play') startReveal(); }, mode === 'pass' ? 50 : 700); }
      saveG(); publish(); render();
      return true;
    }
    function onSwap(key, ids) {
      const p = G?.players[key];
      if (!p || !S.swap || G.phase !== 'play' || G.subs[key] || p.score < 1) return;
      const out = new Set((ids || []).filter((id) => p.hand.some((c) => c.id === id)));
      if (!out.size) return;
      p.hand = p.hand.filter((c) => !out.has(c.id));
      p.score--;
      refill(p);
      g.sfx('coin'); g.toast(`${p.name} traded a point for a fresh hand`, 1600);
      saveG(); publish(); render();
    }
    function autoPlayMissing() {
      for (const k of playing()) {
        if (G.subs[k]) continue;
        const p = G.players[k];
        if (p.hand.length >= G.prompt.pick) onPlay(k, shuffle(p.hand).slice(0, G.prompt.pick).map((c) => c.id), '', true);
      }
    }
    function startReveal() {
      if (!G || G.phase !== 'play') return;
      clearTimeout(botT);
      const subs = Object.entries(G.subs);
      if (!subs.length) { g.toast('Nobody played — new card', 1500); G.prompt = drawPrompt(); G.deadline = G.total ? Date.now() + G.total : 0; scheduleBot(); publish(); render(); return; }
      G.reveal = { list: shuffle(subs.map(([key, s]) => ({ k: s.k, key, cards: s.cards }))), idx: mode === 'pass' ? 0 : 1 };
      G.phase = 'reveal'; G.deadline = 0; browse = 0; view = 'reveal';
      if (mode === 'pass' && G.pass) G.pass.stage = 'judge';
      g.sfx('whoosh');
      if (S.judge === 'vote') autoReveal();
      if (revealDone()) onRevealDone();
      saveG(); publish(); render();
    }
    function autoReveal() {
      clearTimeout(voteT);
      if (!G || G.phase !== 'reveal' || S.judge !== 'vote' || revealDone()) return;
      voteT = setTimeout(() => { revealNext(); autoReveal(); }, 4200);
    }
    function revealNext() {
      if (!G || G.phase !== 'reveal' || revealDone()) return;
      G.reveal.idx++; browse = G.reveal.idx - 1;
      g.sfx('pop');
      if (revealDone()) onRevealDone();
      saveG(); publish(); render();
    }
    function onRevealDone() {
      if (S.judge === 'vote' && mode === 'phones' && S.timer) { G.deadline = Date.now() + S.timer * 1000; G.total = S.timer * 1000; }
    }
    function onVote(key, k) {
      if (!G || G.phase !== 'reveal' || S.judge !== 'vote' || !revealDone() || !G.players[key] || key === 'bot') return;
      const own = G.subs[key]?.k;
      if (!G.reveal.list.some((x) => x.k === k) || own === k) return;
      G.votes[key] = k;
      g.sfx('tick');
      const voters = humans().filter((x) => G.reveal.list.some((s) => s.k !== G.subs[x]?.k));
      if (voters.every((x) => G.votes[x])) tally();
      else { saveG(); publish(); render(); }
    }
    function tally() {
      const n = {};
      for (const k of Object.values(G.votes)) n[k] = (n[k] || 0) + 1;
      const max = Math.max(0, ...Object.values(n));
      award(max ? Object.keys(n).filter((k) => n[k] === max) : [], n);
    }
    function award(ks, votes = null) {
      if (!G || G.phase !== 'reveal') return;
      clearTimeout(voteT);
      const wins = G.reveal.list.filter((x) => ks.includes(x.k));
      if (ks.length && !wins.length) return;
      for (const w of wins) if (G.players[w.key]) G.players[w.key].score++;
      G.win = { ks: wins.map((w) => w.k), keys: wins.map((w) => w.key), votes };
      G.phase = 'win'; G.deadline = 0; view = 'win';
      G.over = Object.values(G.players).some((p) => p.score >= S.win) || (S.rounds > 0 && G.round >= S.rounds);
      g.sfx(wins.length ? 'win' : 'over');
      if (wins.length && !lite) setTimeout(() => confetti(root, wins.map((w) => G?.players[w.key]?.color).filter(Boolean).concat(['#f5b82e', '#fffdf7', '#3ddc84', '#ff5fa2']), 40), 120);
      clearTimeout(autoT);
      if (mode === 'phones') { const r = G.round; autoT = setTimeout(() => { if (G?.round === r && G.phase === 'win') advance(); }, 25000); }
      saveG(); publish(); render();
    }
    function advance() {
      if (!G || G.phase !== 'win') return;
      clearTimeout(autoT);
      if (G.over) { G.phase = 'final'; view = 'final'; g.sfx('perfect'); if (!lite) setTimeout(() => confetti(root), 200); saveG(); publish(); render(); }
      else nextRound();
    }
    function voidRound() {
      for (const [k, s] of Object.entries(G.subs)) {
        const p = G.players[k];
        if (!p) continue;
        s.ids.forEach((id, i) => { if (id === '*') p.wild++; else p.hand.push({ id, t: s.cards[i] }); });
      }
      G.subs = {};
      nextRound();
    }
    function removePlayer(key) {
      if (roster[key]) { delete roster[key]; putProg({ roster }); }
      const li = locals.findIndex((p) => p.key === key);
      if (li >= 0) { locals.splice(li, 1); putProg({ locals }); }
      if (G && G.players[key]) {
        const wasJudge = isJudge(key) && (G.phase === 'play' || G.phase === 'reveal');
        delete G.players[key];
        const idx = G.order.indexOf(key);
        if (idx >= 0) { G.order.splice(idx, 1); if (idx <= G.ji) G.ji--; }
        if (G.pass) { const qi = G.pass.queue.indexOf(key); if (qi >= 0) { G.pass.queue.splice(qi, 1); if (qi < G.pass.i) G.pass.i--; } }
        if (wasJudge) { voidRound(); return; }
        if (G.phase === 'play') { delete G.subs[key]; if (allIn()) startReveal(); }
        if (G.phase === 'reveal' && S.judge === 'vote' && revealDone() && humans().every((x) => G.votes[x])) tally();
      }
      saveG(); publish(); render();
    }
    function finishGame() {
      const list = Object.values(G.players).sort((a, b) => b.score - a.score);
      const top = list[0];
      putProg({ game: null });
      g.over(top.score, { title: `${top.name} wins!`, name: top.bot ? 'Robo' : top.name, win: true, label: `${list.length} players`, delay: 200,
        note: list.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} ${p.score}`).join(' · ') });
    }
    function rematch() {
      putProg({ game: null });
      G = null; view = 'lobby';
      startGame();
    }
    function toLobby() { clearTimeout(botT); clearTimeout(autoT); clearTimeout(voteT); G = null; view = 'lobby'; publish(); render(); }

    // ------------------------------------------------------------ publish (what the phones see) and save
    function publish() {
      if (mode !== 'phones') { link.publish({ v: 1, phase: 'pass', players: [] }); return; }
      const ppl = G ? seats().map((k) => G.players[k]) : [...Object.entries(roster).map(([d, r]) => ({ key: d, ...r, score: 0 })), ...(S.bot ? [{ key: 'bot', pid: 'bot', ...BOT, score: 0, bot: true }] : [])];
      const st = {
        v: 1, phase: G ? G.phase : 'lobby', round: G?.round || 0, judgeMode: S.judge, win: S.win, rounds: S.rounds, adult: adultOn(),
        players: ppl.map((p) => ({ pid: p.pid || pidOf(p.key), name: p.name, color: p.color, score: p.score || 0, bot: !!p.bot, judge: !!G && isJudge(p.key), done: !!G?.subs?.[p.key] })),
        judge: G && judgeKey() ? pidOf(judgeKey()) : null, dev: {},
      };
      if (G) {
        st.prompt = G.prompt ? { t: G.prompt.t, pick: G.prompt.pick } : null;
        st.nPlaying = playing().length; st.nDone = Object.keys(G.subs).length;
        if (G.deadline) st.deadline = { left: Math.max(0, G.deadline - Date.now()), total: G.total || 1 };
        if (G.reveal) st.reveal = { n: G.reveal.list.length, idx: G.reveal.idx, done: revealDone(), list: G.reveal.list.slice(0, G.phase === 'reveal' ? G.reveal.idx : G.reveal.list.length).map((x) => ({ k: x.k, cards: x.cards })), votes: Object.keys(G.votes).length };
        if (G.win) st.win = { pids: G.win.keys.map(pidOf), cards: G.reveal.list.filter((x) => G.win.ks.includes(x.k)).map((x) => x.cards), all: G.reveal.list.map((x) => ({ pid: pidOf(x.key), name: G.players[x.key]?.name || '', cards: x.cards })) };
      }
      for (const [d, r] of Object.entries(roster)) {
        const p = G?.players[d];
        st.dev[d] = { pid: r.pid, color: r.color, hand: p ? p.hand : [], wild: p ? p.wild : 0, sub: G?.subs?.[d] ? { k: G.subs[d].k, cards: G.subs[d].cards, auto: G.subs[d].auto } : null,
          vote: G?.votes?.[d] || null, canSwap: !!(p && S.swap && G.phase === 'play' && !G.subs[d] && p.score >= 1 && !isJudge(d)) };
      }
      link.publish(st, [...kicked]);
    }
    function saveG() {
      clearTimeout(saveT);
      saveT = setTimeout(() => { if (G) putProg({ game: { ...G, savedAt: Date.now() } }); }, 800);
    }

    // ------------------------------------------------------------ the 18+ notice
    function ageGate() {
      return new Promise((resolve) => {
        openModal((box, close) => {
          box.append(h('div.fb-gate-badge', '18+'), h('div.fb-m-t', 'Everyone playing is 18 or older?'),
            h('div.fb-m-s', 'The Party packs are cheeky grown-up humour about dating, work and family life — suggestive, never explicit.'),
            h('div.fb-m-acts', btn('Cancel', () => { close(); resolve(false); }), btn('Yes, we’re all 18+', () => { putProg({ adultOk: true }); g.sfx('pop'); close(); resolve(true); }, 'primary')));
        }, () => resolve(false));
      });
    }
    function confirmBox(title, sub, okLabel) {
      return new Promise((resolve) => openModal((box, close) => {
        box.append(h('div.fb-m-t', title), sub ? h('div.fb-m-s', sub) : null,
          h('div.fb-m-acts', btn('Cancel', () => { close(); resolve(false); }), btn(okLabel, () => { close(); resolve(true); }, 'primary')));
      }, () => resolve(false)));
    }
    /** Start pressed but the chosen cards can't deal a game: say how many there are and offer a way out. */
    function notEnough(pl, total, need) {
      const custom = S.source === 'custom';
      const allC = customCounts(), bc = builtinCounts();
      openModal((box, close) => {
        box.append(h('div.fb-m-t', custom ? 'Not enough custom cards' : 'Not enough cards'),
          h('div.fb-m-s', `${plural(pl.prompts.length, 'prompt')} · ${plural(pl.answers.length, 'answer')}. ${total} players need at least 1 prompt and ${need} answers.`),
          h('div.fb-m-acts',
            btn('Add cards', () => { close(); openCards(); }, custom ? '' : 'primary'),
            custom && (bc.known ? bc.p + allC.p > 0 && bc.a + allC.a >= need : true) ? btn('Play with All cards', () => { close(); setS({ source: 'all' }); publish(); startGame(); }, 'primary') : null,
            !custom && S.source === 'all' ? null : btn('Cancel', () => close())));
      });
    }
    function openModal(build, onCancel) {
      closeModal();
      const box = h('div.fb-m-box');
      const close = () => { modal.classList.remove('on'); clear(modal); modalOn = null; kIdx = -1; render(); };
      modalOn = { cancel: () => { close(); onCancel?.(); } };
      build(box, close);
      clear(modal); modal.append(h('div.fb-m-scrim', { onclick: () => modalOn?.cancel() }), box);
      modal.classList.add('on');
      kIdx = -1; focusDefault();
    }
    function closeModal() { if (modalOn) { modal.classList.remove('on'); clear(modal); modalOn = null; } }

    // ------------------------------------------------------------ rendering helpers
    function btn(label, onclick, cls = '', extra = {}) {
      return h(`button.pill${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button', 'data-k': '', onclick: (e) => { e.stopPropagation(); g.sfx('click'); onclick(e); }, ...extra }, label);
    }
    function sizeCls(len) { return len < 46 ? 'xl' : len < 80 ? 'l' : len < 125 ? 'm' : len < 180 ? 's' : 'xs'; }
    /** A prompt card (dark) with its blanks filled by `cards` (if any). */
    function promptCard(pr, cards = [], { cls = '', tag = true } = {}) {
      const parts = fillParts(pr.t, cards);
      const len = parts.reduce((n, x) => n + (x.s || x.a || '____').length, 0);
      const txt = h('div.fb-ct', { dir: 'auto' }, parts.map((x) => (x.gap ? h('span.fb-gap') : x.a != null ? h(`span.fb-ans${x.after ? '.after' : ''}`, { dir: 'auto' }, x.a) : x.s)));
      return h(`div.fb-card.fb-prompt.${sizeCls(len)}${cls ? '.' + cls.split(' ').join('.') : ''}`, txt,
        tag ? h('div.fb-brand', 'Fill the Blank') : null, pr.pick > 1 ? h('div.fb-pick', `Pick ${pr.pick}`) : null);
    }
    function avatar(p, cls = '') {
      return h(`span.fb-av${cls ? '.' + cls : ''}`, { style: { background: p.color } }, p.bot ? h('span.fb-ic', { html: ICON.bot }) : initial(p.name));
    }
    function head(text, sub = '') { return h('div.fb-head', h('div.fb-head-t', text), sub ? h('div.fb-head-s', sub) : null); }
    const nm = (name) => h('bdi', name || '');

    // players around the rim
    function drawRing() {
      clear(ring);
      let list = [];
      if (G) list = seats().map((k) => G.players[k]);
      else if (mode === 'phones') list = [...Object.entries(roster).map(([d, r]) => ({ key: d, ...r, score: 0 })), ...(S.bot ? [{ key: 'bot', ...BOT, bot: true, score: 0 }] : [])];
      else list = [...locals.map((p) => ({ ...p, score: 0 })), ...(S.bot ? [{ key: 'bot', ...BOT, bot: true, score: 0 }] : [])];
      const hide = ['settings', 'packs', 'house', 'cards'].includes(view) || view === 'final' || (G?.pass && ((G.phase === 'play' && G.pass.stage !== 'done') || (G.phase === 'reveal' && G.pass.stage === 'judge')));
      ring.hidden = hide || !list.length;
      if (ring.hidden) return;
      const n = list.length;
      const step = n > 1 ? Math.min(46, 272 / (n - 1)) : 0;
      const spacing = (2 * Math.PI * 40 * step) / 360;   // cqmin between neighbours
      const small = n > 10;
      ring.classList.toggle('small', small);
      ring.style.setProperty('--nw', `${Math.max(7, Math.min(14, spacing - 1)).toFixed(1)}cqmin`);
      list.forEach((p, i) => {
        const a = (180 + (i - (n - 1) / 2) * step) * Math.PI / 180;
        const x = 50 + Math.sin(a) * 40, y = 50 - Math.cos(a) * 40;
        const done = !!G && G.phase === 'play' && !!G.subs[p.key];
        const judge = !!G && isJudge(p.key);
        const won = !!G && G.phase === 'win' && G.win?.keys.includes(p.key);
        const el = h(`div.fb-p${done ? '.done' : ''}${judge ? '.judge' : ''}${won ? '.won' : ''}`, { style: { left: `${x}%`, top: `${y}%` }, title: p.name },
          h('div.fb-pa', avatar(p), judge ? h('span.fb-crown', { html: ICON.crown }) : null, done ? h('span.fb-tick', { html: ICON.check }) : null,
            G ? h('span.fb-sc', String(p.score)) : null), h('span.fb-pn', { dir: 'auto' }, p.name));
        if (!G && view === 'lobby') {
          el.classList.add('tap');
          el.addEventListener('click', async () => {
            if (p.key === 'bot') { setS({ bot: false }); publish(); render(); return; }
            if (await confirmBox(`Remove ${p.name}?`, mode === 'phones' ? 'Their phone can’t rejoin until you make a new room (Rules → New room).' : '', 'Remove')) {
              if (mode === 'phones') { kicked.add(p.key); putProg({ kicked: [...kicked].slice(-50) }); }
              removePlayer(p.key);
            }
          });
        }
        ring.append(el);
      });
    }

    // ------------------------------------------------------------ pages
    function render() {
      if (!root.isConnected) return;
      root.dataset.view = view;
      root.dataset.mode = mode;
      clear(page);
      if (['lobby', 'settings', 'packs'].includes(view) && (usesCustom() || view === 'packs') && Date.now() - packInfoAt > (view === 'lobby' ? 8000 : 1500) && !packLoading && (mode === 'phones' || link.status === 'ok')) {
        packLoading = true;
        const before = JSON.stringify(packInfo);
        loadPackInfo(true).then(() => { if (JSON.stringify(packInfo) !== before && ['lobby', 'settings'].includes(view)) { packInfoAt = Date.now(); render(); } }).catch(() => {}).finally(() => { packLoading = false; });
      }
      const fn = { lobby: pgLobby, settings: pgSettings, packs: pgPacks, house: pgHouse, cards: pgCards, play: pgPlay, reveal: pgReveal, win: pgWin, final: pgFinal }[view] || pgLobby;
      fn();
      drawRing();
      drawRim();
      const key = `${view}:${G?.round}:${G?.reveal?.idx}:${G?.pass?.stage}:${G?.pass?.i}:${browse}`;
      if (key !== animKey) { animKey = key; page.classList.remove('enter'); void page.offsetWidth; page.classList.add('enter'); kIdx = -1; }
      focusDefault();
    }
    function pgLobby() {
      const phones = mode === 'phones';
      const n = phones ? Object.keys(roster).length : locals.length;
      page.append(head('Fill the Blank', `${n + (S.bot ? 1 : 0)} player${n + (S.bot ? 1 : 0) === 1 ? '' : 's'} · first to ${S.win}${adultOn() ? ' · 18+' : ''}`));
      const mid = h('div.fb-lobby');
      if (phones) {
        if (link.status === 'ok') {
          if (qr && qrCode === link.code) mid.append(qr);
          else {
            const ph = h('div.fb-qr-wait', h('div.fb-spin'));
            mid.append(ph);
            link.phoneUrl().then((r) => {
              if (!r.url) { ph.replaceWith(h('div.fb-nolink', linkProblem(r.reason, 'bridge/server.js'))); return; }
              qr = h('div.fb-qrwrap', qrBox(r.url, 'fb-qr'), h('div.fb-url', r.url.replace(/^https?:\/\//, '')));
              qrCode = link.code;
              if (view === 'lobby' && ph.isConnected) ph.replaceWith(qr);
            });
          }
          mid.append(h('div.fb-room', 'Scan to join · room ', h('b', link.code)));
          mid.append(sourceChips());
        } else if (link.status === 'connecting' || link.status === 'off') {
          mid.append(h('div.fb-qr-wait', h('div.fb-spin')), h('div.fb-room', 'Looking for the bridge…'));
        } else {
          mid.append(h('div.fb-nolink', h('span.fb-ic.big', { html: ICON.phone }), h('div', 'Phones join through the bridge (bridge/server.js on this network).'),
            h('div.fb-dim', 'No bridge here? Play by passing this screen around.')),
          btn('Pass the device', () => { mode = 'pass'; publish(); render(); }, 'primary sm'));
        }
      } else {
        mid.append(h('div.fb-passbox', h('span.fb-ic.big', { html: ICON.pass }), h('div', 'Pass the device: everyone picks their card on this screen in turn, with a cover screen in between.'),
          btn('+ Add player', addLocal, 'sm')), sourceChips());
      }
      page.append(mid);
      const acts = h('div.fb-acts.lobby');
      const canResume = resumeAvail && saved && (saved.mode || 'phones') === mode;
      acts.append(btn('Rules', () => { view = 'settings'; render(); }, 'sm'), btn('Cards', () => openCards('lobby'), 'sm'));
      if (!phones || link.status === 'ok') acts.append(btn(busy ? 'Dealing…' : 'Start', startGame, 'primary'));
      page.append(acts);
      const alt = h('div.fb-alt');
      if (canResume) alt.append(btn(`Resume round ${saved.round}`, resumeGame, 'sm'));
      else if (phones && link.status === 'ok') alt.append(h('button.fb-link', { type: 'button', 'data-k': '', onclick: () => { mode = 'pass'; publish(); render(); } }, 'No phones? Pass the device'));
      else if (!phones) alt.append(h('button.fb-link', { type: 'button', 'data-k': '', onclick: () => { mode = 'phones'; publish(); render(); } }, 'Play with phones instead'));
      page.append(alt);
    }
    async function addLocal() {
      if (locals.length >= MAX_PLAYERS) return g.toast('20 players at most');
      const v = await editText({ title: 'Player name', placeholder: 'Name', okLabel: 'Add' });
      if (!v) return;
      locals.push({ key: `L${Date.now().toString(36)}${rk().slice(0, 2)}`, name: v.slice(0, 20), color: freeColor() });
      putProg({ locals }); g.sfx('pop'); render();
    }

    /** Built-in · Custom · All — which cards to deal (S.source), with how many custom cards there are. */
    function sourceChips(cls = '') {
      const cc = customCounts();
      const n = cc.p + cc.a;
      return h(`div.fb-src${cls ? '.' + cls : ''}`, h('span.fb-src-l', 'Cards'), SOURCES.map(([id, label]) => h(`button.chip.sm${S.source === id ? '.on' : ''}`, {
        type: 'button', 'data-k': '', title: id === 'custom' ? 'Cards added from phones and imported packs' : '',
        onclick: async () => { g.sfx('click'); setS({ source: id }); if (id !== 'builtin' && !packInfo) await loadPackInfo(true).catch(() => null); publish(); render(); },
      }, label, id === 'custom' && cc.known ? h('span.fb-src-n', String(n)) : null)));
    }
    function countLine() {
      const b = builtinCounts(), c = customCounts();
      const part = (x, label) => (x.known ? `${label} ${x.p} prompts · ${x.a} answers` : `${label} …`);
      return S.source === 'builtin' ? part(b, 'Built-in:') : S.source === 'custom' ? part(c, 'Custom:') : part({ p: b.p + c.p, a: b.a + c.a, known: b.known && c.known }, 'All:');
    }
    function openCards(back = view) {
      cardsBack = ['lobby', 'settings', 'packs'].includes(back) ? back : 'lobby';
      view = 'cards'; addQr = null;
      loadPackInfo(true).catch(() => null);
      render();
    }
    let cardsPoll = 0;
    // Custom cards: the QR for the "Add cards" phone page (no game needed), counts, browse / export / import
    function pgCards() {
      clearInterval(cardsPoll);
      cardsPoll = setInterval(() => { if (view !== 'cards' || !root.isConnected) { clearInterval(cardsPoll); return; } const before = JSON.stringify(packInfo); loadPackInfo(true).then(() => { if (view === 'cards' && JSON.stringify(packInfo) !== before) render(); }).catch(() => {}); }, 5000);
      const H = packInfo?.house;
      const nImp = (packInfo?.packs?.length || 0) + (prog().local?.length || 0);
      page.append(head('Custom cards', H ? `House pack · ${plural(H.prompts, 'prompt')} · ${plural(H.answers, 'answer')}` : ''));
      const mid = h('div.fb-lobby.fb-cards');
      if (link.status === 'ok') {
        if (addQr) mid.append(addQr);
        else {
          const ph = h('div.fb-qr-wait', h('div.fb-spin'));
          mid.append(ph);
          link.phoneUrl().then((r) => {
            if (!r.url) { ph.replaceWith(h('div.fb-nolink', linkProblem(r.reason, 'bridge/server.js'))); return; }
            const u = new URL(r.url); u.pathname = '/blanks/add'; u.search = '';
            addQr = h('div.fb-qrwrap', qrBox(u.href, 'fb-qr'), h('div.fb-url', u.href.replace(/^https?:\/\//, '')));
            if (view === 'cards' && ph.isConnected) ph.replaceWith(addQr);
          });
        }
        mid.append(h('div.fb-room', 'Scan to add cards — ', h('b.fb-plain', 'no game needed')));
      } else if (link.status === 'connecting' || link.status === 'off') mid.append(h('div.fb-qr-wait', h('div.fb-spin')), h('div.fb-room', 'Looking for the bridge…'));
      else mid.append(h('div.fb-nolink', h('span.fb-ic.big', { html: ICON.phone }), h('div', 'Custom cards live on the bridge (bridge/server.js on this network): phones add them by scanning a QR code here.'),
        h('div.fb-dim', 'Without it you can still import a pack by link.')));
      const imp = nImp ? h('div.fb-dim', `${plural(nImp, 'imported pack')} · Cards: ${SOURCES.find((x) => x[0] === S.source)[1]}`) : h('div.fb-dim', `Playing with: ${SOURCES.find((x) => x[0] === S.source)[1]} cards`);
      mid.append(imp);
      page.append(mid);
      const acts = h('div.fb-acts.cards');
      if (H && H.prompts + H.answers) acts.append(btn('Browse', () => { view = 'house'; houseCards = null; render(); }, 'sm'));
      if (packInfo && (H?.prompts + H?.answers || packInfo.packs.length)) acts.append(btn('Export', exportCards, 'sm'));
      acts.append(btn('Import', importLink, 'sm'));
      page.append(acts, h('div.fb-acts.low.cards', btn('Done', () => { clearInterval(cardsPoll); view = cardsBack; render(); }, 'primary')));
    }
    async function exportCards() {
      const r = await link.phoneUrl();
      const base = r.url ? new URL(r.url).origin : null;
      const local = await bridgeBase().catch(() => null);
      const url = (base || local || '') + '/api/blanks/export?id=all';
      openModal((box, close) => {
        box.append(h('div.fb-m-t', 'Export custom cards'),
          h('div.fb-m-s', 'One JSON file with the house pack and the imported packs — import it again on any display or bridge. Scan to save it on a phone:'),
          base ? qrBox(url, 'fb-qr.sm') : null,
          h('div.fb-m-acts', btn('Download here', async () => {
            try {
              const res = await fetch((local || base) + '/api/blanks/export?id=all');
              const blob = await res.blob();
              const a = h('a', { href: URL.createObjectURL(blob), download: 'fill-the-blank-custom-cards.json' });
              document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
              g.toast('Saved', 1400);
            } catch (e) { g.toast(errMsg(e), 2000); }
          }, 'sm'), btn('Close', () => close(), 'primary')));
      });
    }

    function pgSettings() {
      page.append(head('House rules'));
      const box = h('div.fb-scroll');
      const row = (label, sub, chips) => box.append(h('div.fb-row', h('div.fb-row-l', label, sub ? h('small', sub) : null), h('div.fb-chips', chips)));
      const chip = (on, label, fn) => h(`button.chip${on ? '.on' : ''}`, { type: 'button', 'data-k': '', onclick: () => { g.sfx('click'); fn(); publish(); render(); } }, label);
      const nameOf = (id) => builtinById(id)?.name || (id === 'house' ? 'House' : (packInfo?.packs || []).find((p) => p.id === id)?.name || (prog().local || []).find((p) => p.id === id)?.name || 'Pack');
      const packNames = effPacks().map(nameOf);
      row('Cards from', countLine(), SOURCES.map(([id, l]) => chip(S.source === id, l, () => { setS({ source: id }); if (id !== 'builtin') loadPackInfo(true).then(() => view === 'settings' && render()).catch(() => {}); })));
      box.append(h('button.fb-packbtn', { type: 'button', 'data-k': '', onclick: () => { view = 'packs'; loadPackInfo(); render(); } },
        h('div.fb-row-l', 'Card packs', h('small', { dir: 'auto' }, packNames.join(' · ') || 'None picked')), h('span.fb-chev', '›')));
      box.append(h('button.fb-packbtn', { type: 'button', 'data-k': '', onclick: () => openCards('settings') },
        h('div.fb-row-l', 'Custom cards', h('small', 'Add from phones (QR) · browse · export')), h('span.fb-chev', '›')));
      row('Points to win', '', [5, 7, 10, 15].map((n) => chip(S.win === n, String(n), () => setS({ win: n }))));
      row('Round limit', 'End early after this many rounds', [[0, 'None'], [10, '10'], [15, '15'], [20, '20']].map(([n, l]) => chip(S.rounds === n, l, () => setS({ rounds: n }))));
      row('Timer', 'Time’s up → a random card is played', [[0, 'Off'], [45, '45 s'], [60, '60 s'], [90, '90 s']].map(([n, l]) => chip(S.timer === n, l, () => setS({ timer: n }))));
      row('Who picks', mode === 'pass' ? 'Pass the device always has a judge' : 'Rotating judge, or everyone votes from their phone', [chip(S.judge === 'rotate', 'Judge', () => setS({ judge: 'rotate' })), chip(S.judge === 'vote', 'Everyone votes', () => setS({ judge: 'vote' }))]);
      row('Robo', 'A house bot that plays a random card', [chip(!S.bot, 'Off', () => setS({ bot: false })), chip(S.bot, 'On', () => setS({ bot: true }))]);
      row('Write your own', 'Blank cards per player, per game', [[0, 'Off'], [1, '1'], [2, '2'], [3, '3']].map(([n, l]) => chip(S.wild === n, l, () => setS({ wild: n }))));
      row('Fresh hand', 'Trade a point to swap any of your cards', [chip(!S.swap, 'Off', () => setS({ swap: false })), chip(S.swap, 'On', () => setS({ swap: true }))]);
      if (mode === 'phones' && !G) box.append(h('div.fb-row', h('div.fb-row-l', 'Room', h('small', `Room ${link.code}. A new room needs a new scan, and lets removed phones back in.`)),
        h('div.fb-chips', h('button.chip', { type: 'button', 'data-k': '', onclick: () => { roster = {}; kicked.clear(); putProg({ roster, kicked: [] }); link.newRoom(); g.toast('New room — scan again', 1600); view = 'lobby'; render(); } }, 'New room'))));
      page.append(box, h('div.fb-acts.low', btn('Done', () => { view = 'lobby'; render(); }, 'primary')));
    }

    function pgPacks() {
      page.append(head('Card packs', `Cards from: ${SOURCES.find((x) => x[0] === S.source)[1]}${adultOk() ? '' : ' · 18+ packs ask first'}`));
      const box = h('div.fb-scroll');
      const toggle = async (id, adult, custom) => {
        const on = custom ? !(S.off || []).includes(id) : S.packs.includes(id);
        if (!on && adult && !adultOk() && !(await ageGate())) return;
        if (custom) setS({ off: on ? [...(S.off || []), id] : (S.off || []).filter((x) => x !== id) });
        else setS({ packs: on ? S.packs.filter((x) => x !== id) : [...S.packs, id] });
        g.sfx('click'); publish(); render();
      };
      const prow = (id, name, sub, adult, extra = null, custom = false) => {
        const on = custom ? !(S.off || []).includes(id) : S.packs.includes(id) || (!S.packs.length && id === 'family-en');
        box.append(h(`div.fb-pack${on ? '.on' : ''}`,
          h('button.fb-pack-main', { type: 'button', 'data-k': '', onclick: () => toggle(id, adult, custom) },
            h('span.fb-box', { html: on ? ICON.check : '' }), h('span.fb-pack-t', h('b', { dir: 'auto' }, name), h('small', { dir: 'auto' }, sub)), adult ? h('span.fb-x18', '18+') : null),
          extra));
      };
      const sect = (title, used, sub) => box.append(h(`div.fb-sect${used ? '' : '.off'}`, h('b', title), h('small', used ? sub : `Not used — Cards from: ${SOURCES.find((x) => x[0] === S.source)[1]}`)));
      sect('Built-in packs', S.source !== 'custom', 'Our own cards, English and Hebrew');
      for (const p of BUILTIN) { const c = bcount[p.id]; prow(p.id, p.name, `${c ? `${c[0] + c[1]} cards · ` : ''}${p.lang === 'he' ? 'עברית' : 'English'} · ${p.note}`, p.adult); }
      for (const p of BUILTIN) if (!bcount[p.id]) loadBuiltin(p.id).then((pk) => { bcount[p.id] = [pk.prompts.length, pk.answers.length]; if (view === 'packs') render(); }).catch(() => {});
      sect('Custom cards', usesCustom(), 'Added from phones and imported — untick to leave one out');
      if (packInfo) {
        const H = packInfo.house, hc = H.prompts + H.answers;
        prow('house', 'House pack', hc ? `${plural(H.prompts, 'prompt')} · ${plural(H.answers, 'answer')} — added from phones` : 'Empty — Custom cards → scan to add some', false,
          h('button.fb-mini', { type: 'button', 'data-k': '', onclick: () => openCards('packs') }, hc ? 'Manage' : 'Add'), true);
        if (H.adultPrompts + H.adultAnswers) {
          box.append(h('div.fb-row.fb-row-in', h('div.fb-row-l', '18+ house cards', h('small', `${plural(H.adultPrompts + H.adultAnswers, 'card')} marked 18+ by whoever added them`)),
            h('div.fb-chips', [false, true].map((v) => h(`button.chip${!!S.custom18 === v ? '.on' : ''}`, { type: 'button', 'data-k': '', onclick: async () => {
              if (v && !adultOk() && !(await ageGate())) return;
              g.sfx('click'); setS({ custom18: v }); publish(); render();
            } }, v ? 'Include' : 'Leave out')))));
        }
        for (const p of packInfo.packs) prow(p.id, p.name, `${plural(p.prompts, 'prompt')} · ${plural(p.answers, 'answer')}${p.by ? ` · from ${p.by}` : ''}`, p.adult,
          h('button.fb-mini', { type: 'button', 'data-k': '', onclick: async () => {
            if (!(await confirmBox(`Remove “${p.name}”?`, 'It’s removed from the bridge for every display.', 'Remove'))) return;
            try { await removeBridgePack(p.id, link.key); setS({ off: (S.off || []).filter((x) => x !== p.id) }); await loadPackInfo(true); } catch (e) { g.toast(errMsg(e), 2000); }
            render();
          } }, '✕'), true);
      } else if (mode === 'phones' && link.status !== 'down') box.append(h('div.fb-note', h('span.fb-spin.sm'), ' Loading the bridge’s packs…'));
      else box.append(h('div.fb-note', 'The house pack lives on the bridge — start bridge/server.js on this network to add cards from phones.'));
      for (const p of prog().local || []) prow(p.id, p.name, `${plural(p.prompts.length, 'prompt')} · ${plural(p.answers.length, 'answer')} · on this screen`, p.adult,
        h('button.fb-mini', { type: 'button', 'data-k': '', onclick: () => { putProg({ local: (prog().local || []).filter((x) => x.id !== p.id) }); setS({ off: (S.off || []).filter((x) => x !== p.id) }); render(); } }, '✕'), true);
      box.append(h('div.fb-note', 'Import your own JSON pack: from a phone (Custom cards → scan → Import a card pack) or by link here. Imported packs are your responsibility — only load cards you may use (e.g. Creative Commons).'));
      page.append(box, h('div.fb-acts.low', btn('Import link', importLink, 'sm'), btn('Done', () => { view = 'settings'; render(); }, 'primary')));
    }
    async function importLink() {
      const url = await editText({ title: 'Pack link (JSON)', placeholder: 'https://…', okLabel: 'Import' });
      if (!url) return;
      g.toast('Loading…', 1200);
      try {
        const r = await importUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`);
        if (r.bridge) { setS({ off: (S.off || []).filter((x) => x !== r.bridge.id), ...(S.source === 'builtin' ? { source: 'all' } : {}) }); await loadPackInfo(true); g.toast(`Imported “${r.bridge.name}”${S.source === 'all' ? ' · playing All cards' : ''}`, 2000); }
        else {
          const pk = { id: `l${Date.now().toString(36)}`, ...r.local };
          if (JSON.stringify(pk).length > 400000) throw new Error('That pack is too big to keep on this screen — import it from a phone instead');
          putProg({ local: [...(prog().local || []).slice(-2), pk] });
          if (S.source === 'builtin') setS({ source: 'all' });
          g.toast(`Imported “${pk.name}”`, 1800);
        }
        g.sfx('coin');
      } catch (e) { g.toast(errMsg(e), 2600); }
      render();
    }
    let houseCards = null;
    function pgHouse() {
      page.append(head('House pack', 'Added from phones · ✕ removes a card'));
      const box = h('div.fb-scroll');
      if (!houseCards) {
        box.append(h('div.fb-note', h('span.fb-spin.sm')));
        bridgePack('house', true).then((d) => { houseCards = [...(d.rawPrompts || []).map((c) => ({ ...c, kind: 'prompt' })), ...(d.cards || []).map((c) => ({ ...c, kind: 'answer' }))]; if (view === 'house') render(); })
          .catch((e) => { g.toast(errMsg(e)); houseCards = []; if (view === 'house') render(); });
      } else if (!houseCards.length) box.append(h('div.fb-note', 'Empty.'));
      else for (const c of houseCards) {
        box.append(h(`div.fb-hc.${c.kind}`, h('span.fb-hc-t', { dir: 'auto' }, c.text), c.adult ? h('span.fb-x18', '18+') : null, h('small', c.by || ''),
          h('button.fb-mini', { type: 'button', 'data-k': '', onclick: async () => {
            try { await removeHouseCard(c.id, link.key); houseCards = houseCards.filter((x) => x.id !== c.id); packInfo = null; loadPackInfo(true); } catch (e) { g.toast(errMsg(e)); }
            render();
          } }, '✕')));
      }
      page.append(box, h('div.fb-acts.low', btn('Back', () => { view = 'cards'; render(); }, 'primary')));
    }

    function judgeName() { const j = judgeKey(); return j ? G.players[j]?.name || '' : ''; }
    function pgPlay() {
      if (mode === 'pass' && G.pass) return pgPass();
      const n = playing().length, d = Object.keys(G.subs).length;
      page.append(head(`Round ${G.round}`, S.judge === 'vote' ? 'Everyone plays — then everyone votes' : [nm(judgeName()), ' is the judge']));
      const st = h('div.fb-stack', promptCard(G.prompt, [], { cls: 'main' }));
      page.append(st);
      const acts = h('div.fb-acts.mid', h('div.fb-count', h('b', `${d}`), ` of ${n} played`, G.deadline ? h('span.fb-clock', '') : null));
      const row = h('div.fb-acts');
      if (!Object.keys(G.subs).some((k) => k !== 'bot')) row.append(btn('New card', newPrompt, 'sm'));
      if (d >= 2) row.append(btn('Reveal now', startReveal, 'sm primary'));
      st.append(acts, row);
    }
    // pass the device: cover → this player's hand → next cover → … → the judge
    function pgPass() {
      const P = G.pass;
      const cur = P.queue[P.i];
      if (P.stage === 'cover' && cur) {
        const p = G.players[cur];
        page.append(head(`Round ${G.round}`, [nm(judgeName()), ` is the judge · ${P.i} of ${P.queue.length} played`]));
        page.append(h('div.fb-cover', { '--pc': p.color }, avatar(p, 'xl'), h('div.fb-cover-t', 'Pass to ', h('b', nm(p.name))), h('div.fb-cover-s', 'Everyone else — no peeking!')));
        page.append(h('div.fb-acts', btn(`I’m ${p.name} — show my cards`, () => { P.stage = 'hand'; hand = { sel: [], idx: 0, wild: '' }; render(); }, 'primary')));
        return;
      }
      if (P.stage === 'hand' && cur) return pgHand(G.players[cur]);
      page.append(h('div.fb-cover', h('div.fb-spin')));
    }
    function handItems(p) { return [...p.hand.map((c) => ({ id: c.id, t: c.t })), ...(p.wild > 0 ? [{ id: '*', t: hand.wild, wild: true }] : [])]; }
    function pgHand(p) {
      const items = handItems(p), pick = G.prompt.pick;
      const ready = hand.sel.length === pick;
      const playIdx = items.length;   // the Play button is the last stop of the knob
      hand.idx = Math.max(0, Math.min(hand.idx, playIdx));
      page.append(promptCard(G.prompt, hand.sel.map((id) => (id === '*' ? hand.wild || '…' : p.hand.find((c) => c.id === id)?.t)), { cls: 'top', tag: false }));
      const car = h('div.fb-car');
      items.forEach((c, i) => {
        const off = i - Math.min(hand.idx, items.length - 1);
        if (Math.abs(off) > 2) return;
        const si = hand.sel.indexOf(c.id);
        const el = h(`button.fb-card.fb-answer${c.wild ? '.wild' : ''}${si >= 0 ? '.sel' : ''}${off === 0 && hand.idx < playIdx ? '.cur' : ''}`, {
          type: 'button', dir: 'auto', style: { transform: `translateX(${off * 27}cqmin) scale(${1 - Math.abs(off) * 0.16})`, opacity: off === 0 ? 1 : Math.abs(off) === 1 ? 0.6 : 0.25, zIndex: 10 - Math.abs(off) }, onclick: () => { if (off !== 0) { hand.idx = i; g.sfx('tick'); render(); } else toggleHand(p, c); },
        }, c.wild ? (c.t ? h('span', { dir: 'auto' }, c.t) : h('span.fb-wild-t', '✎ Write your own')) : c.t, c.wild ? h('small', `${p.wild} left`) : null,
        si >= 0 && pick > 1 ? h('span.fb-ord', String(si + 1)) : si >= 0 ? h('span.fb-ord', { html: ICON.check }) : null);
        car.append(el);
      });
      page.append(car);
      const playBtn = btn(ready ? (pick > 1 ? `Play these ${pick}` : 'Play it') : pick > 1 ? `Pick ${pick} in order` : 'Tap a card to pick it', () => { if (ready) passPlay(p); }, `primary${hand.idx === playIdx ? ' kfix' : ''}`, { disabled: !ready });
      const nav = h('div.fb-acts.hand', h('button.fb-nav', { type: 'button', onclick: () => { hand.idx = Math.max(0, hand.idx - 1); render(); } }, '‹'),
        h('span.fb-count', `${Math.min(hand.idx, items.length - 1) + 1} / ${items.length}`), h('button.fb-nav', { type: 'button', onclick: () => { hand.idx = Math.min(playIdx, hand.idx + 1); render(); } }, '›'));
      page.append(nav, h('div.fb-acts.low', S.swap && p.score >= 1 && !hand.sel.length ? btn('New hand −1', () => { onSwap(p.key, p.hand.map((c) => c.id)); }, 'sm') : null, playBtn));
    }
    async function toggleHand(p, c) {
      const pick = G.prompt.pick;
      if (hand.sel.includes(c.id)) { hand.sel = hand.sel.filter((x) => x !== c.id); g.sfx('tick'); render(); return; }
      if (c.wild) {
        const v = await editText({ title: 'Write your own answer', value: hand.wild, placeholder: 'Your answer', okLabel: 'Use it' });
        if (!v) return;
        hand.wild = v.slice(0, 90);
      }
      hand.sel = pick === 1 ? [c.id] : hand.sel.length < pick ? [...hand.sel, c.id] : [...hand.sel.slice(1), c.id];
      g.sfx('pop');
      if (hand.sel.length === pick) hand.idx = handItems(p).length;   // jump to Play
      render();
    }
    function passPlay(p) { if (onPlay(p.key, hand.sel, hand.wild)) g.vibrate(20); }

    function curItem() { return G.reveal.list[Math.max(0, Math.min(browse, G.reveal.idx - 1))]; }
    function pgReveal() {
      const R = G.reveal, n = R.list.length;
      if (mode === 'pass' && G.pass?.stage === 'judge') {
        const p = G.players[G.judge];
        page.append(head(`Round ${G.round}`, 'Everyone has played'));
        page.append(h('div.fb-cover', { '--pc': p?.color || 'var(--accent)' }, p ? avatar(p, 'xl') : null, h('div.fb-cover-t', 'Pass to the judge ', h('b', nm(p?.name))),
          h('div.fb-cover-s', 'Read every answer out loud, then pick the funniest.')));
        page.append(h('div.fb-acts', btn('Reveal the answers', () => { G.pass.stage = 'reveal'; R.idx = Math.max(1, R.idx); browse = 0; g.sfx('pop'); render(); }, 'primary')));
        return;
      }
      const done = revealDone(), vote = S.judge === 'vote';
      const shown = Math.max(1, R.idx);
      browse = Math.max(0, Math.min(browse, shown - 1));
      const it = curItem();
      page.append(head(vote ? (done ? 'Vote on your phones' : 'The answers') : [nm(judgeName()), ' reads them out'], done ? (vote ? `${Object.keys(G.votes).length} of ${humans().length} voted` : 'Pick the winner') : `${shown} of ${n}`));
      const st = h('div.fb-stack', promptCard(G.prompt, it ? it.cards : [], { cls: 'main reveal' }));
      page.append(st);
      const dots = h('div.fb-dots', R.list.map((x, i) => h(`i${i === browse ? '.on' : ''}${i < shown ? '.seen' : ''}`)));
      st.append(h('div.fb-acts.mid', h('button.fb-nav', { type: 'button', 'data-k': '', disabled: browse <= 0, onclick: () => { browse--; g.sfx('tick'); render(); } }, '‹'), dots,
        h('button.fb-nav', { type: 'button', 'data-k': '', disabled: done && browse >= n - 1, onclick: () => stepReveal(1) }, '›')));
      const row = h('div.fb-acts');
      if (!done) row.append(btn('Next answer', () => stepReveal(1), 'primary sm'));
      else if (!vote) row.append(btn('This one wins', () => award([curItem().k]), 'primary'));
      else row.append(btn('Count the votes', tally, 'primary sm'));
      st.append(row);
    }
    function stepReveal(d) {
      const R = G.reveal;
      if (d > 0 && browse >= R.idx - 1 && !revealDone()) { revealNext(); return; }
      browse = Math.max(0, Math.min(R.idx - 1, browse + d));
      g.sfx('tick'); render();
    }
    function pgWin() {
      const W = G.win;
      const winners = W.keys.map((k) => G.players[k]).filter(Boolean);
      const cards = G.reveal.list.filter((x) => W.ks.includes(x.k));
      page.append(head(winners.length ? (winners.length > 1 ? 'A tie!' : [nm(winners[0].name), ' wins the round']) : 'No votes this round',
        W.votes ? `${Object.values(W.votes).reduce((a, b) => a + b, 0)} votes` : ['Picked by ', nm(judgeName())]));
      const st = h('div.fb-stack', promptCard(G.prompt, cards.length ? cards[0].cards : [], { cls: cards.length ? 'main win' : 'main' }));
      page.append(st);
      const wrow = h('div.fb-winners', winners.map((p) => h('span.fb-wchip', { '--pc': p.color }, avatar(p), h('b', { dir: 'auto' }, p.name), h('span', '+1'))));
      st.append(wrow, h('div.fb-acts', btn(G.over ? 'Final results' : 'Next round', advance, 'primary')));
    }
    function pgFinal() {
      const list = Object.values(G.players).sort((a, b) => b.score - a.score);
      page.append(head('Game over', plural(G.round, 'round')));
      const pod = h('div.fb-podium');
      [1, 0, 2].forEach((i) => {
        const p = list[i];
        if (!p) return;
        pod.append(h(`div.fb-step.s${i + 1}`, { '--pc': p.color }, i === 0 ? h('span.fb-crown.big', { html: ICON.crown }) : null, avatar(p, i === 0 ? 'xl' : 'lg'),
          h('b', { dir: 'auto' }, p.name), h('div.fb-block', h('span', String(i + 1)), h('small', `${p.score} pt${p.score === 1 ? '' : 's'}`))));
      });
      page.append(pod);
      if (list.length > 3) page.append(h('div.fb-rest', list.slice(3, 9).map((p, i) => h('span', `${i + 4}. `, h('bdi', p.name), ` · ${p.score}`))));
      page.append(h('div.fb-acts.low', btn('Lobby', toLobby, 'sm'), btn('Rematch', rematch, 'sm'), btn('Done', finishGame, 'primary')));
    }

    // ------------------------------------------------------------ the timer rim
    function drawRim() {
      const on = !!G?.deadline && (G.phase === 'play' || G.phase === 'reveal');
      rim.classList.toggle('on', on);
      if (!on) { rimKey = ''; return; }
      const key = `${G.round}:${G.phase}:${G.deadline}`;
      if (key === rimKey) return;
      rimKey = key;
      const left = Math.max(0, G.deadline - Date.now()), frac = left / (G.total || 1);
      rimFg.style.transition = 'none';
      rimFg.style.strokeDashoffset = String(100 - frac * 100);
      if (!lite) { void rimFg.getBoundingClientRect(); rimFg.style.transition = `stroke-dashoffset ${left}ms linear, stroke .4s`; rimFg.style.strokeDashoffset = '100'; }
    }
    function tickClock() {
      if (!G?.deadline) return;
      const left = Math.max(0, G.deadline - Date.now());
      const s = Math.ceil(left / 1000);
      if (s !== lastSec) {
        lastSec = s;
        const c = page.querySelector('.fb-clock');
        if (c) c.textContent = ` · ${s}s`;
        rim.classList.toggle('low', s <= 10);
        if (lite) rimFg.style.strokeDashoffset = String(100 - (left / (G.total || 1)) * 100);
        if (s <= 5 && s > 0) g.sfx('tick');
      }
      if (left <= 0) {
        G.deadline = 0;
        if (G.phase === 'play') { autoPlayMissing(); startReveal(); }
        else if (G.phase === 'reveal' && S.judge === 'vote' && revealDone()) tally();
        render();
      }
    }

    // ------------------------------------------------------------ knob / keyboard
    function focusables() { return [...(modalOn ? modal : page).querySelectorAll('[data-k]:not([disabled])')]; }
    function focusDefault() {
      const f = focusables();
      if (!kbd || kIdx < 0 || kIdx >= f.length) {
        const fix = f.findIndex((e) => e.classList.contains('kfix'));
        const prim = f.findIndex((e) => e.classList.contains('primary'));
        kIdx = fix >= 0 ? fix : prim >= 0 ? prim : 0;
      }
      f.forEach((e, i) => e.classList.toggle('kf', kbd && i === kIdx));
    }
    function moveFocus(d) {
      const f = focusables();
      if (!f.length) return;
      kIdx = (Math.max(0, kIdx) + d + f.length) % f.length;
      f.forEach((e, i) => e.classList.toggle('kf', i === kIdx));
      f[kIdx].scrollIntoView?.({ block: 'nearest' });
      g.sfx('tick');
    }
    function press() {
      const f = focusables();
      const el = f[kIdx] || f.find((e) => e.classList.contains('primary'));
      el?.click();
    }
    const onKeyFn = ({ key }) => {
      kbd = true;
      const left = key === 'ArrowLeft' || key === 'ArrowUp', right = key === 'ArrowRight' || key === 'ArrowDown';
      const enter = key === 'Enter' || key === ' ';
      if (!modalOn && view === 'play' && G?.pass?.stage === 'hand') {
        const p = G.players[G.pass.queue[G.pass.i]], items = handItems(p);
        if (left || right) { hand.idx = Math.max(0, Math.min(items.length, hand.idx + (right ? 1 : -1))); g.sfx('tick'); render(); return; }
        if (enter) { if (hand.idx >= items.length) { if (hand.sel.length === G.prompt.pick) passPlay(p); } else toggleHand(p, items[hand.idx]); return; }
      }
      if (!modalOn && view === 'reveal' && G?.reveal && !(mode === 'pass' && G.pass?.stage === 'judge') && (key === 'ArrowLeft' || key === 'ArrowRight')) { stepReveal(key === 'ArrowRight' ? 1 : -1); return; }
      if (left) moveFocus(-1);
      else if (right) moveFocus(1);
      else if (enter) press();
    };
    g.on('key', onKeyFn);
    g.on('wheel', ({ delta }) => onKeyFn({ key: delta > 0 ? 'ArrowRight' : 'ArrowLeft' }));
    const onPtr = () => { if (kbd) { kbd = false; page.querySelectorAll('.kf').forEach((e) => e.classList.remove('kf')); } };
    root.addEventListener('pointerdown', onPtr, true);

    // ------------------------------------------------------------ loop: background + clock (nothing else per frame)
    offs.push(themeEvents.on('change', () => { bgDirty = true; }));
    offs.push(store.on('change', () => { const l = isLite(); if (l !== lite) { lite = l; root.classList.toggle('lite', lite); } }));
    g.on('resize', () => { bgDirty = true; });
    let acc = 0;
    g.loop((dt) => {
      if (bgDirty) { bgDirty = false; g.draw.bg({ glow: lite ? 0 : 0.14, color: '#f5b82e', ring: false }); }
      acc += dt;
      if (acc >= 0.25) { acc = 0; tickClock(); }
    });

    if (mode === 'pass' && S.judge === 'vote') setS({ judge: 'rotate' });
    link.start();
    publish(); render();
    if (mode === 'phones' || usesCustom()) loadPackInfo().then(() => { if (['lobby', 'settings', 'cards'].includes(view)) render(); }).catch(() => {});
    if (openOnStart) { openOnStart = null; openCards('lobby'); }

    return {
      pause() { pausedAt = Date.now(); clearTimeout(voteT); },
      resume() {
        if (pausedAt && G?.deadline) { G.deadline += Date.now() - pausedAt; rimKey = ''; drawRim(); publish(); saveG(); }
        pausedAt = 0;
        if (G?.phase === 'reveal' && S.judge === 'vote') autoReveal();
      },
      destroy() {
        clearTimeout(botT); clearTimeout(autoT); clearTimeout(revealT); clearTimeout(voteT); clearInterval(cardsPoll);
        if (saveT) { clearTimeout(saveT); if (G && G.phase !== 'final') putProg({ game: { ...G, savedAt: Date.now() } }); }
        link.stop();
        for (const off of offs) { try { off(); } catch {} }
        root.removeEventListener('pointerdown', onPtr, true);
        root.remove();
      },
    };
  },
};
