// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Ride the Bus (with a Higher or Lower mode). Aces are high.
//  Ride the Bus: every player answers four guesses — red or black, higher or lower, inside or outside, suit;
//  a wrong guess costs sips. Then whoever got the most wrong rides the bus: four right in a row to get off
//  (a wrong guess = 1 sip and start over; the driver lets you off after 5 rides).
//  Higher or Lower: guess the next card; 3 right in a row lets you pass; a wrong guess = 1 sip, next player.
import { h, clear, seg, cardEl, newDeck, tableRing, suitSvg, SUITS, SUIT_NAME, isRed, pick } from './drinks-ui.js';

const val = (c) => (c.r === 'A' ? 14 : ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(c.r) + 2);
const SIPS = [1, 1, 2, 2];
const QS = [
  { t: 'Red or black?', lab: 'Colour' },
  { t: 'Higher or lower?', lab: 'Hi / Lo' },
  { t: 'Inside or outside?', lab: 'In / Out' },
  { t: 'Which suit?', lab: 'Suit' },
];
const MAX_RIDES = 5;

export function mount(el, ctx) {
  const { app } = ctx;
  let mode = app.data('busMode', 'bus');
  let deck = newDeck();
  const tally = new Map();
  let lock = false, timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  el.classList.add('dk-bus');

  // ---- shared bits
  const status = h('div.dk-bus-status');
  const board = h('div.dk-bus-board');
  const qEl = h('div.dk-bus-q');
  const fb = h('div.dk-bus-fb');
  const opts = h('div.dk-bus-opts');
  const modeSeg = seg([{ v: 'bus', label: 'Ride the Bus' }, { v: 'hilo', label: 'Higher or Lower' }], mode, (v) => { mode = v; app.save('busMode', v); reset(); }, 'dk-bus-mode');
  let table = makeTable();
  el.append(table.el, status, board, qEl, fb, opts, modeSeg);
  const offP = ctx.onPlayers(() => { table.el.remove(); table = makeTable(); el.prepend(table.el); reset(); });

  function makeTable() {
    return tableRing(ctx.players, { count: (p) => tally.get(p.id) || '', onTap: () => {} });
  }
  const players = () => ctx.players;
  function draw() {
    if (deck.length < 6) { deck = newDeck(); app.toast('Fresh deck shuffled'); }
    return deck.pop();
  }
  function sip(p, n) {
    tally.set(p.id, (tally.get(p.id) || 0) + n);
    ctx.addSips(p, n);
    table.update();
  }
  function feedback(ok, text) {
    fb.textContent = text;
    fb.className = `dk-bus-fb ${ok ? 'ok' : 'bad'}`;
    void fb.offsetWidth; fb.classList.add('show');
    ctx.sfx(ok ? 'score' : 'over');
    if (!ok) app.vibrate(30);
  }
  const clearFb = () => { fb.className = 'dk-bus-fb'; fb.textContent = ''; };
  const pillBtn = (label, cls, fn) => h(`button.pill.dk-bus-opt${cls ? '.' + cls : ''}`, { type: 'button', onclick: () => { if (!lock) fn(); } }, label);

  // ================================================================ Ride the Bus
  let st = null;     // { stage: 'warm'|'bus'|'done', pi, q, cards[], wrong: Map, rider, rides }
  let slots = [];
  function busReset() {
    st = { stage: 'warm', pi: 0, q: 0, cards: [], wrong: new Map(), rider: null, rides: 0 };
    clear(board);
    board.className = 'dk-bus-board four';
    slots = QS.map((q) => { const c = cardEl(null); board.append(h('div.dk-bus-slot', c.el, h('span.dk-bus-lab', q.lab))); return c; });
    busRender();
  }
  const busPlayer = () => (st.stage === 'warm' ? players()[st.pi] : players().find((p) => p.id === st.rider)) || players()[0];
  function busRender() {
    const p = busPlayer();
    clear(status); clear(opts);
    table.mark('turn', (x) => st.stage !== 'done' && x === p);
    slots.forEach((s, i) => s.el.parentElement.classList.toggle('cur', st.stage !== 'done' && i === st.q));
    if (st.stage === 'done') {
      status.append(h('bdi', p.name), ' got off the bus!');
      qEl.textContent = st.rides >= MAX_RIDES ? 'The driver took pity 🚌' : 'Ride complete 🎉';
      opts.append(pillBtn('Play again', 'primary', () => { ctx.sfx('whoosh'); busReset(); }));
      return;
    }
    status.append(h('bdi', p.name), st.stage === 'warm' ? ` · warm-up ${st.pi + 1}/${players().length}` : ` rides the bus${st.rides ? ` · ride ${st.rides + 1}` : ''}`);
    const q = QS[st.q];
    qEl.textContent = q.t;
    const n = st.stage === 'bus' ? 1 : SIPS[st.q];
    qEl.dataset.sub = `wrong = ${n} sip${n > 1 ? 's' : ''}`;
    if (st.q === 0) opts.append(pillBtn('Red', 'red', () => busGuess((c) => isRed(c.s))), pillBtn('Black', 'black', () => busGuess((c) => !isRed(c.s))));
    if (st.q === 1) opts.append(pillBtn('▲ Higher', '', () => busGuess((c) => val(c) > val(st.cards[0]))), pillBtn('▼ Lower', '', () => busGuess((c) => val(c) < val(st.cards[0]))));
    if (st.q === 2) {
      const lo = Math.min(val(st.cards[0]), val(st.cards[1])), hi = Math.max(val(st.cards[0]), val(st.cards[1]));
      opts.append(pillBtn('Inside', '', () => busGuess((c) => val(c) > lo && val(c) < hi)), pillBtn('Outside', '', () => busGuess((c) => val(c) < lo || val(c) > hi)));
    }
    if (st.q === 3) for (const s of SUITS) opts.append(h(`button.dk-bus-suit${isRed(s) ? '.red' : ''}`, { type: 'button', 'aria-label': SUIT_NAME[s], html: suitSvg(s), onclick: () => { if (!lock) busGuess((c) => c.s === s); } }));
  }
  function busGuess(test) {
    lock = true;
    const p = busPlayer();
    const c = draw();
    st.cards[st.q] = c;
    slots[st.q].setCard(c);
    ctx.sfx('whoosh');
    const ok = test(c);
    later(450, () => {
      if (ok) feedback(true, 'Correct!');
      else {
        const n = st.stage === 'bus' ? 1 : SIPS[st.q];
        feedback(false, `Wrong — ${n} sip${n > 1 ? 's' : ''}`);
        sip(p, n);
        if (st.stage === 'warm') st.wrong.set(p.id, (st.wrong.get(p.id) || 0) + 1);
      }
      later(1300, () => {
        clearFb();
        if (st.stage === 'bus' && !ok) {
          st.rides++;
          if (st.rides >= MAX_RIDES) { st.stage = 'done'; lock = false; busRender(); return; }
          st.q = 0; st.cards = [];
          slots.forEach((s) => s.setCard(null));
          later(380, () => { lock = false; busRender(); });
          return;
        }
        st.q++;
        if (st.q < 4) { lock = false; busRender(); return; }
        // four done
        if (st.stage === 'bus') { st.stage = 'done'; ctx.sfx('win'); lock = false; busRender(); return; }
        st.pi++; st.q = 0; st.cards = [];
        later(500, () => {
          slots.forEach((s) => s.setCard(null));
          if (st.pi >= players().length) {
            const worst = Math.max(0, ...players().map((x) => st.wrong.get(x.id) || 0));
            const cands = players().filter((x) => (st.wrong.get(x.id) || 0) === worst);
            st.rider = pick(cands).id; st.stage = 'bus'; st.rides = 0;
            app.toast(`${players().find((x) => x.id === st.rider).name} rides the bus! 🚌`, { ms: 3200 });
            ctx.sfx('boom', { volume: 0.5 });
          }
          later(380, () => { lock = false; busRender(); });
        });
      });
    });
  }

  // ================================================================ Higher or Lower
  let hl = null;    // { pi, cur, prev, streak }
  let hlCur = null, hlPrev = null;
  function hiloReset() {
    hl = { pi: 0, cur: draw(), prev: null, streak: 0 };
    clear(board);
    board.className = 'dk-bus-board hilo';
    hlPrev = cardEl(null); hlCur = cardEl(null, { big: true });
    board.append(h('div.dk-bus-prev', hlPrev.el), h('div.dk-bus-cur', hlCur.el));
    hlCur.setCard(hl.cur);
    hiloRender();
  }
  function hiloRender() {
    const p = players()[hl.pi % players().length];
    table.mark('turn', (x) => x === p);
    clear(status); clear(opts);
    status.append(h('bdi', p.name), hl.streak ? ` · streak ${hl.streak}` : '’s guess');
    qEl.textContent = 'Higher or lower?';
    qEl.dataset.sub = hl.streak >= 3 ? 'you may pass now' : 'wrong = 1 sip · same = safe';
    opts.append(pillBtn('▲ Higher', '', () => hiloGuess(1)), pillBtn('▼ Lower', '', () => hiloGuess(-1)));
    if (hl.streak >= 3) opts.append(pillBtn('Pass', 'primary', () => { ctx.sfx('pop'); hl.pi++; hl.streak = 0; hiloRender(); }));
  }
  function hiloGuess(dir) {
    lock = true;
    const p = players()[hl.pi % players().length];
    const c = draw();
    const d = Math.sign(val(c) - val(hl.cur));
    hl.prev = hl.cur; hl.cur = c;
    hlPrev.setCard(hl.prev, false);
    hlCur.setCard(c);
    ctx.sfx('whoosh');
    const ok = d === 0 || d === dir;
    later(420, () => {
      if (ok) { hl.streak++; feedback(true, d === 0 ? 'Same — you’re safe' : 'Correct!'); }
      else { feedback(false, 'Wrong — 1 sip'); sip(p, 1); hl.streak = 0; hl.pi++; }
      later(1100, () => { clearFb(); lock = false; hiloRender(); });
    });
  }

  function reset() {
    timers.forEach(clearTimeout); timers = []; lock = false; clearFb();
    modeSeg.set(mode);
    el.classList.toggle('hilo', mode === 'hilo');
    if (mode === 'bus') busReset(); else hiloReset();
  }
  reset();

  return {
    destroy() { timers.forEach(clearTimeout); offP(); },
    key(e) {
      if (lock) return false;
      const bs = [...opts.querySelectorAll('button')];
      const i = bs.indexOf(document.activeElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length; bs[i < 0 ? 0 : j]?.focus(); return true; }
      if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { bs[i].click(); return true; }
      return false;
    },
  };
}

