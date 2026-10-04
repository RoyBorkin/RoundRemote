// Board Games → Jungle Speed: cards left per player (80 dealt evenly), finishing places, a flip-pace timer that
// walks around the table, a two-player "totem grab" reflex duel, and the rules.
import { h, clear } from '../js/ui/dom.js';
import { seg, numPad, editPlayers, celebrate, roster } from './bg-ui.js';
import { rnd } from './bg-dice-engine.js';

const SHAPES = [
  'M50 12a38 38 0 1 1 0 76 38 38 0 0 1 0-76zm0 18a20 20 0 1 0 0 40 20 20 0 0 0 0-40z',
  'M40 12h20v28h28v20H60v28H40V60H12V40h28z',
  'M50 8l11 27h29L66 52l9 29-25-17-25 17 9-29L10 35h29z',
  'M14 14h72v72H14zm18 18v36h36V32z',
  'M50 10l42 76H8z',
  'M50 6l40 44-40 44-40-44z',
  [[50, 27], [27, 50], [73, 50], [50, 73]].map(([x, y]) => `M${x - 15.5} ${y}a15.5 15.5 0 1 0 31 0a15.5 15.5 0 1 0 -31 0z`).join(''),
  'M58 6 22 54h22l-8 40 42-52H54z',
];
const SCOLS = ['#e11d48', '#16a34a', '#2563eb', '#eab308'];

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-jungle');
  const S = Object.assign({ tab: 'play', players: roster(app, 4), cards: {}, out: [], pace: 0 }, app.data('jungle', {}));
  const save = () => app.save('jungle', S);
  const tabs = seg([{ v: 'play', label: 'Table' }, { v: 'reflex', label: 'Reflex duel' }, { v: 'rules', label: 'Rules' }], S.tab, (v) => { if (v === 'rules') { tabs.set(S.tab); clearInterval(paceT); paceT = 0; R.on = false; clearTimeout(R.t); ctx.push({ file: './bg-rulesview.js', title: 'Jungle Speed', opts: { id: 'jungle-speed' } }); return; } S.tab = v; save(); show(); }, 'bg-jg-tabs');
  const play = h('div.bg-jg-play');
  const reflex = h('div.bg-jg-reflex');
  el.append(tabs, play, reflex);

  // ---------------------------------------------------------------- table: cards left + pace
  let paceT = 0, flipper = 0, stopCel = null;
  function deal() {
    const n = S.players.length, each = Math.floor(80 / n);
    S.cards = {}; S.out = [];
    for (const p of S.players) S.cards[p.id] = each;
    save(); drawPlay();
    app.toast(`${each} cards each${80 % n ? ` · ${80 % n} go under the totem` : ''}`);
    app.sfx('whoosh');
  }
  function drawPlay() {
    clear(play);
    const n = S.players.length;
    S.players.forEach((p, i) => {
      const a0 = n === 2 ? 90 : 180 / n, a = ((a0 + (i / n) * 360) * Math.PI) / 180;
      const c = S.cards[p.id];
      const place = S.out.indexOf(p.id);
      play.append(h(`button.bg-jg-p${i === flipper && paceT ? '.flip' : ''}${place >= 0 ? '.out' : ''}`, { type: 'button', '--c': p.color,
        style: { left: `${50 + 37 * Math.sin(a)}%`, top: `${53 - 35 * Math.cos(a)}%` },
        onclick: async () => {
          const v = await numPad({ title: `${p.name} · cards left`, value: c ?? 0, allowNeg: false, hint: 'Hidden pile + face-up pile' });
          if (v === null) return;
          S.cards[p.id] = v;
          if (v === 0 && !S.out.includes(p.id)) { S.out.push(p.id); app.sfx('win'); if (S.out.length === 1) stopCel = celebrate(el, `${p.name} wins!`, p.color, 'First to get rid of every card'); }
          if (v > 0) S.out = S.out.filter((x) => x !== p.id);
          save(); drawPlay();
        } }, h('span', p.name), h('b', place >= 0 ? `#${place + 1}` : c == null ? '–' : String(c))));
    });
    const total = S.players.reduce((a, p) => a + (S.cards[p.id] || 0), 0);
    play.append(h('div.bg-jg-mid',
      h('div.bg-jg-totem', { html: '<svg viewBox="0 0 40 100" aria-hidden="true"><path d="M20 2c5.5 0 9 3.5 9 9v5h3v6h-3v3h4v7h-4v62a3 3 0 0 1-3 3h-12a3 3 0 0 1-3-3V32H7v-7h4v-3H8v-6h3v-5c0-5.5 3.5-9 9-9z"/><circle cx="16.5" cy="10" r="2" fill="var(--bg)"/><circle cx="23.5" cy="10" r="2" fill="var(--bg)"/><path d="M15 50h10M15 62h10M15 74h10" stroke="var(--bg)" stroke-width="1.6" opacity=".5"/></svg>' }),
      h('div.bg-jg-info', total ? `${total} cards in hands · ${Math.max(0, 80 - total)} elsewhere` : 'Deal to start'),
      h('div.bg-jg-row', h('button.pill.small.primary', { type: 'button', onclick: () => deal() }, 'Deal'),
        h('button.pill.small', { type: 'button', onclick: () => editPlayers(app, { players: S.players, min: 2, max: 10, onChange: () => { save(); drawPlay(); } }) }, 'Players')),
      h('div.bg-jg-pace', h('small', 'flip pace'), seg([{ v: 0, label: 'Off' }, { v: 1.5, label: '1.5s' }, { v: 2.5, label: '2.5s' }, { v: 4, label: '4s' }], S.pace, (v) => { S.pace = v; save(); runPace(); }))));
  }
  function runPace() {
    clearInterval(paceT); paceT = 0;
    if (S.pace && S.tab === 'play') {
      paceT = setInterval(() => {
        const live = S.players.filter((p) => !S.out.includes(p.id));
        if (!live.length) return;
        do { flipper = (flipper + 1) % S.players.length; } while (S.out.includes(S.players[flipper].id));
        app.sfx('tick', { pitch: 0.8 });
        play.querySelectorAll('.bg-jg-p').forEach((b, i) => b.classList.toggle('flip', i === flipper));
      }, S.pace * 1000);
    }
    play.querySelectorAll('.bg-jg-p').forEach((b, i) => b.classList.toggle('flip', !!paceT && i === flipper));
  }

  // ---------------------------------------------------------------- reflex duel (2 players)
  const R = { on: false, score: [0, 0], armed: false, t: 0, cards: null, kind: '' };
  const cardA = h('div.bg-jg-card'), cardB = h('div.bg-jg-card');
  const msg = h('div.bg-jg-msg');
  const pad = (i) => h(`button.bg-jg-pad.p${i}`, { type: 'button', onpointerdown: (e) => { e.preventDefault(); grab(i); } }, h('b', '0'), h('small', S.players[i]?.name || `Player ${i + 1}`));
  const pads = [pad(0), pad(1)];
  const startBtn = h('button.pill.primary.small.bg-jg-start', { type: 'button', onclick: () => start() }, 'Start');
  reflex.append(h('div.bg-jg-cards', cardA, cardB), msg, pads[0], pads[1], startBtn);
  const cardSvg = (s, c) => `<svg viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="${SHAPES[s]}" fill="${c}"/></svg>`;
  const ARROWS = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M8 50l22-18v11h20v14H30v11zM92 50 70 32v11H50v14h20v11z" fill="currentColor"/><path d="M50 8 32 30h11v20h14V30h11zM50 92 68 70H57V50H43v20H32z" fill="currentColor" opacity=".45"/></svg>';
  function start() {
    R.on = true; R.score = [0, 0]; R.armed = false;
    startBtn.hidden = true; updPads();
    msg.textContent = 'Same shape? Grab! (colours don’t matter)';
    clearTimeout(R.t); R.t = setTimeout(flip, 900);
  }
  function flip() {
    if (!R.on) return;
    const r = rnd();
    let a = Math.floor(rnd() * SHAPES.length), b;
    if (r < 0.07) { R.kind = 'arrows'; cardA.innerHTML = ARROWS; cardB.innerHTML = ARROWS; R.armed = true; msg.textContent = 'Arrows in — everyone grabs!'; }
    else {
      if (r < 0.37) b = a; else { do { b = Math.floor(rnd() * SHAPES.length); } while (b === a); }
      let ca = Math.floor(rnd() * 4), cb = Math.floor(rnd() * 4);
      if (a === b && ca === cb) cb = (cb + 1 + Math.floor(rnd() * 3)) % 4;   // a real match always differs in colour
      cardA.innerHTML = cardSvg(a, SCOLS[ca]); cardB.innerHTML = cardSvg(b, SCOLS[cb]);
      R.kind = a === b ? 'match' : ''; R.armed = a === b;
      msg.textContent = '';
    }
    for (const c of [cardA, cardB]) { c.classList.remove('in'); void c.offsetWidth; c.classList.add('in'); }
    app.sfx('flap', { volume: 0.6 });
    R.t = setTimeout(flip, 1300 + rnd() * 1100);
  }
  function grab(i) {
    if (!R.on) return;
    if (R.armed) {
      R.armed = false; R.score[i]++; app.sfx('score'); pads[i].classList.add('good');
      msg.textContent = `${S.players[i]?.name || `Player ${i + 1}`} grabbed the totem!`;
      clearTimeout(R.t); R.t = setTimeout(flip, 1300);
    } else {
      R.score[i] = Math.max(0, R.score[i] - 1); app.sfx('over'); pads[i].classList.add('bad');
      msg.textContent = 'Wrong grab! −1';
    }
    setTimeout(() => pads[i].classList.remove('good', 'bad'), 350);
    updPads();
    if (R.score[i] >= 5) {
      R.on = false; clearTimeout(R.t); startBtn.hidden = false; startBtn.textContent = 'Play again';
      const p = S.players[i] || { name: `Player ${i + 1}`, color: '#65a30d' };
      app.sfx('win'); stopCel = celebrate(el, `${p.name} wins!`, p.color, `${R.score[0]}–${R.score[1]}`);
    }
  }
  function updPads() { pads.forEach((p, i) => { p.querySelector('b').textContent = String(R.score[i]); p.querySelector('small').textContent = S.players[i]?.name || `Player ${i + 1}`; p.style.setProperty('--c', S.players[i]?.color || '#65a30d'); }); }

  function show() {
    play.hidden = S.tab !== 'play'; reflex.hidden = S.tab !== 'reflex';
    if (S.tab === 'play') { drawPlay(); runPace(); } else { clearInterval(paceT); paceT = 0; }
    if (S.tab !== 'reflex') { R.on = false; clearTimeout(R.t); startBtn.hidden = false; startBtn.textContent = 'Start'; }
    if (S.tab === 'reflex') { updPads(); cardA.innerHTML = cardSvg(0, SCOLS[0]); cardB.innerHTML = cardSvg(2, SCOLS[2]); msg.textContent = 'First to 5 · tap your pad when the shapes match'; }
  }
  show();
  return {
    key(e) {
      if (S.tab === 'reflex') { if (e.key === 'a' || e.key === 'ArrowLeft') { grab(0); return true; } if (e.key === 'l' || e.key === 'ArrowRight') { grab(1); return true; } if (e.key === 'Enter' && !R.on) { start(); return true; } }
      return false;
    },
    destroy() { clearInterval(paceT); clearTimeout(R.t); R.on = false; stopCel?.(); },
    resume() { show(); },
  };
}
