// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Hitster Bingo, hot-seat on the round display. The real game: spin the disco ball for a category, the DJ plays a
// song, everyone writes an answer within 25 seconds, the card is flipped, and whoever was right crosses a box of that
// category's colour on their scorecard; the first to complete a line (row, column or diagonal) wins; a tie plays on
// between the tied players until one takes the lead. Categories — Beginners: solo artist or group · before 2000? ·
// year ± 4 · decade · year ± 2; Experts: song title · exact year · artist · decade · year ± 3.
// Here: the wheel is the disco ball; each player answers in turn on the screen (a tap passes it on), title / artist
// are said out loud and the table taps who was right; each player has a 4×4 card in the five category colours
// (every card arranged differently, no one-colour lines). Score = how many songs it took (fewer is better).
import { TAU, clamp, lerp, ease, polar, rand, THEME } from '../games/kit.js';
import { tr } from './hits-text.js';
import { INK_DARK } from './hits-ui.js';

const CAT_COLORS = ['#ff7a45', '#ffd23f', '#2ed39a', '#3fa7ff', '#c084fc'];
const CATS = {
  a: [
    { id: 'group', input: 'group', name: 'catGroup', short: 'shGroup', q: () => tr('qGroup') },
    { id: 'b2000', input: 'b2000', name: 'catB2000', short: 'shB2000', q: () => tr('qB2000') },
    { id: 'y4', input: 'year', tol: 4, name: 'catY4', short: 'shY4', q: () => tr('qY', 4) },
    { id: 'decade', input: 'decade', name: 'catDecade', short: 'shDecade', q: () => tr('qDecade') },
    { id: 'y2', input: 'year', tol: 2, name: 'catY2', short: 'shY2', q: () => tr('qY', 2) },
  ],
  b: [
    { id: 'title', input: 'say', name: 'catTitle', short: 'shTitle', q: () => tr('qTitle') },
    { id: 'exact', input: 'year', tol: 0, name: 'catExact', short: 'shYear', q: () => tr('qExact') },
    { id: 'artist', input: 'say', name: 'catArtist', short: 'shArtist', q: () => tr('qArtist') },
    { id: 'decade', input: 'decade', name: 'catDecade', short: 'shDecade', q: () => tr('qDecade') },
    { id: 'y3', input: 'year', tol: 3, name: 'catY3', short: 'shY3', q: () => tr('qY', 3) },
  ],
};
const LINES = [];
for (let i = 0; i < 4; i++) { LINES.push([0, 1, 2, 3].map((j) => i * 4 + j)); LINES.push([0, 1, 2, 3].map((j) => j * 4 + i)); }
LINES.push([0, 5, 10, 15], [3, 6, 9, 12]);
const LISTEN_S = 25;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** A 4×4 card: five colours (one of them 4 times), no line in a single colour. */
export function makeCard() {
  for (let t = 0; t < 80; t++) {
    const extra = Math.floor(Math.random() * 5), bag = [];
    for (let c = 0; c < 5; c++) for (let k = 0; k < (c === extra ? 4 : 3); k++) bag.push(c);
    shuffle(bag);
    if (LINES.every((l) => new Set(l.map((i) => bag[i])).size >= 2)) return bag.map((c) => ({ c, x: false, t: 0 }));
  }
  return Array.from({ length: 16 }, (_, i) => ({ c: i % 5, x: false, t: 0 }));
}
export const lineOf = (card) => LINES.find((l) => l.every((i) => card[i].x)) || null;

export function createBingo(C) {
  const { g, U, players, level } = C;
  const { ctx } = g;
  const { text, fit, button } = U;
  const cats = CATS[level].map((c, i) => ({ ...c, col: CAT_COLORS[i] }));
  const n = players.length;
  for (const p of players) { p.card = makeCard(); p.crosses = 0; p.ans = null; p.ok = false; }
  let phase = 'spin', phaseT = 0, round = 0;
  let wheel = { a: rand(TAU), v: 0, on: false, done: false };
  let cat = null, song = null, tok = 0, fails = 0, failMsg = '';
  let ai = 0, active = players.map((_, i) => i);   // who answers this round (everyone, or the tied players)
  let contenders = null, marks = [], mi = 0, markMsg = '', cursor = null, lastLine = null;
  let yearVal = 1990, decades = [];
  let destroyed = false, sounded = -1, forced = null;
  const he = () => C.he(), M = () => C.M();
  const setPhase = (ph) => { phase = ph; phaseT = 0; U.focus = null; U.pressed = null; };
  const P = (i) => players[i];

  // the deck's years (for the decade chips and the year picker's start)
  {
    const ys = C.deck.map((s) => s.y).filter(Boolean);
    const lo = Math.max(1930, Math.floor(Math.min(...ys) / 10) * 10), hi = Math.min(2020, Math.floor(Math.max(...ys) / 10) * 10);
    for (let d = lo; d <= hi; d += 10) decades.push(d);
    if (!decades.length) decades = [1980, 1990, 2000, 2010];
    const sorted = ys.slice().sort((a, b) => a - b);
    yearVal = sorted[Math.floor(sorted.length / 2)] || 1990;
  }
  const midYear = yearVal;

  // ---------------------------------------------------------------- flow
  function spinWheel() {
    if (phase !== 'spin' || wheel.on) return;
    wheel = { a: wheel.a, v: rand(9, 13), on: true, done: false };
    g.sfx('whoosh');
  }
  function wheelCat() {
    const seg = TAU / cats.length;
    const a = ((-wheel.a % TAU) + TAU) % TAU;
    return cats[Math.floor(a / seg) % cats.length];
  }
  const usable = (s, c) => !C.drawn.has(s) && (c.input !== 'group' || s.b === 0 || s.b === 1);
  function drawSong(c) {
    let s = C.deck.find((x) => usable(x, c));
    if (!s && c.input === 'group') return null;
    if (!s) { C.drawn.clear(); s = C.deck.find((x) => x !== song); }   // everything was heard: start over
    if (s) C.drawn.add(s);
    return s || null;
  }
  async function loadSong() {
    let s = drawSong(cat);
    if (!s && cat.input === 'group') { cat = cats.find((c) => c.input === 'decade'); s = drawSong(cat); }
    if (!s) { endByDeck(); return; }
    song = s; setPhase('load');
    const t = ++tok;
    try {
      const ok = await C.play(s, () => t === tok && !destroyed);
      if (ok === null) return;
      if (!ok) {
        if (++fails >= 5) { failMsg = tr('notFoundAll', C.svcName()); setPhase('fail'); return; }
        C.deck.splice(C.deck.indexOf(s), 1);
        loadSong(); return;
      }
      fails = 0;
      C.preloadArt(s);
      startListen();
    } catch (e) {
      if (t !== tok || destroyed) return;
      failMsg = e?.userMessage || e?.message || tr('playErr', C.svcName());
      setPhase('fail');
    }
  }
  function startListen() {
    for (const p of players) { p.ans = null; p.ok = false; }
    setPhase('listen'); g.sfx('whoosh');
  }
  function startAnswers() {
    if (cat.input === 'say') { setPhase('say'); return; }
    ai = 0; yearVal = midYear; setPhase('answer');
  }
  function answer(v) {
    if (phase !== 'answer') return;
    P(active[ai]).ans = v;
    g.sfx('drop');
    if (ai < active.length - 1) { ai++; yearVal = midYear; phaseT = 0; U.focus = null; return; }
    doReveal();
  }
  function doReveal() {
    const y = song.y;
    for (const i of active) {
      const p = P(i), a = p.ans;
      if (cat.input === 'group') p.ok = a === (song.b ? 'group' : 'solo');
      else if (cat.input === 'b2000') p.ok = a === (y < 2000 ? 'before' : 'after');
      else if (cat.input === 'decade') p.ok = a === Math.floor(y / 10) * 10;
      else if (cat.input === 'year') p.ok = a != null && Math.abs(a - y) <= cat.tol;
      else p.ok = false;   // said out loud: the table decides (judge)
    }
    setPhase('reveal'); g.sfx('flap');
  }
  function afterReveal() {
    if (phase === 'reveal' && phaseT < 1) return;
    if (phase === 'reveal' && cat.input === 'say') { setPhase('judge'); return; }
    const right = active.filter((i) => P(i).ok);
    if (contenders) {   // tie-break: the first round exactly one tied player gets right wins
      if (right.length === 1) { win(right[0]); return; }
      nextRound(); return;
    }
    marks = right.slice(); mi = 0; markMsg = '';
    if (!marks.length) { markMsg = tr('nobody'); setPhase('nomark'); return; }
    startMark();
  }
  function startMark() {
    cursor = null; lastLine = null;
    const p = P(marks[mi]);
    const free = p.card.some((c) => !c.x && cats[c.c] === cat);
    if (!free) { markMsg = tr('noFree', p.name); setPhase('nomark'); return; }
    setPhase('mark');
  }
  function cross(idx) {
    if (phase !== 'mark') return;
    const p = P(marks[mi]);
    const cell = p.card[idx];
    if (!cell || cell.x || cats[cell.c] !== cat) { g.sfx('tick'); return; }
    cell.x = true; cell.t = 0; p.crosses++;
    g.sfx('place'); g.vibrate(15);
    const line = lineOf(p.card);
    if (line && line.includes(idx)) { lastLine = line; g.sfx('perfect'); g.vibrate(50); }
    setPhase('marked');
  }
  function nextMark() {
    if (mi < marks.length - 1) { mi++; startMark(); return; }
    endRound();
  }
  function endRound() {
    const lined = players.map((_, i) => i).filter((i) => lineOf(P(i).card));
    if (lined.length === 1) { win(lined[0]); return; }
    if (lined.length > 1) { contenders = lined; active = lined.slice(); g.toast(tr('tieShort'), 1800); }
    nextRound();
  }
  function nextRound() { wheel.on = false; wheel.done = false; setPhase('spin'); }
  let winner = null;
  function win(i) {
    const p = P(i);
    winner = p;
    setPhase('won'); g.sfx('win'); g.vibrate(60); C.confetti();
    const multi = n > 1;
    C.over(round, { title: multi ? tr('bingoWin', p.name) : tr('bingoSolo'), name: multi ? p.name : undefined, win: true,
      note: tr('bingoNote', round), delay: 3200, sfx: false });
  }
  function endByDeck() {
    const best = Math.max(...players.map((p) => p.crosses));
    const top = players.filter((p) => p.crosses === best);
    setPhase('won');
    if (top.length === 1 && n > 1) { C.over(null, { title: tr('wins', top[0].name), note: tr('crosses', best), win: true, delay: 1200 }); return; }
    C.over(null, { title: tr('heardAll'), note: players.map((p) => `${p.name}: ${p.crosses}`).join(' · '), delay: 1200 });
  }

  // ---------------------------------------------------------------- geometry
  const wheelGeo = () => ({ x: g.cx, y: g.cy - g.R * 0.1, r: g.R * (n > 4 ? 0.27 : n > 2 ? 0.29 : 0.31) });
  function miniPos(i) {
    const k = n, step = k > 1 ? Math.min(44, 220 / (k - 1)) : 0;
    const a = (180 - M() * (i - (k - 1) / 2) * step) * Math.PI / 180;   // player 1 on the left (the right in Hebrew)
    const size = g.R * (k <= 2 ? 0.3 : k <= 4 ? 0.27 : 0.24);
    const [x, y] = polar(g.cx, g.cy, a, g.R * (k <= 2 ? 0.63 : 0.66));
    return { x, y, size };
  }
  const bigGeo = () => { const cell = g.R * 0.205, gap = g.R * 0.02; return { cell, gap, x0: g.cx - (cell * 4 + gap * 3) / 2, y0: g.cy - g.R * 0.41, w: cell * 4 + gap * 3 }; };
  /** Cell centre on the big card (columns mirror in Hebrew so a card reads the same way as its mini version). */
  function cellXY(idx) {
    const B = bigGeo(), r = Math.floor(idx / 4), c = idx % 4, cc = M() > 0 ? c : 3 - c;
    return { x: B.x0 + cc * (B.cell + B.gap) + B.cell / 2, y: B.y0 + r * (B.cell + B.gap) + B.cell / 2, s: B.cell };
  }
  function cellAt(x, y) {
    for (let i = 0; i < 16; i++) { const c = cellXY(i); if (Math.abs(x - c.x) <= c.s / 2 && Math.abs(y - c.y) <= c.s / 2) return i; }
    return null;
  }

  // ---------------------------------------------------------------- drawing
  function drawCross(x, y, s, t = 1, col = INK_DARK) {
    const k = ease.out(clamp(t, 0, 1)), d = s * 0.28 * k;
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, s * 0.12); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d); ctx.stroke(); ctx.restore();
  }
  function miniCard(p, x, y, size, { hi = false, dim = false } = {}) {
    const cell = size / 4.4, gap = size * 0.4 / 4.4 / 3;
    ctx.save(); if (dim) ctx.globalAlpha = 0.45;
    g.draw.roundRect(x - size / 2 - gap * 2, y - size / 2 - gap * 2, size + gap * 4, size + gap * 4, size * 0.1, THEME.glass, hi ? { stroke: p.color, lw: Math.max(2, g.R * 0.007) } : {});
    const line = lineOf(p.card);
    for (let i = 0; i < 16; i++) {
      const r = Math.floor(i / 4), c = i % 4, cc = M() > 0 ? c : 3 - c;
      const cx = x - size / 2 + cc * (cell + gap) + cell / 2, cy = y - size / 2 + r * (cell + gap) + cell / 2;
      const cl = p.card[i];
      g.draw.roundRect(cx - cell / 2, cy - cell / 2, cell, cell, cell * 0.22, cl.x ? cats[cl.c].col : g.draw.alpha(cats[cl.c].col, THEME.light ? 0.38 : 0.34));
      if (cl.x) drawCross(cx, cy, cell, 1);
      if (line?.includes(i)) g.draw.roundRect(cx - cell / 2, cy - cell / 2, cell, cell, cell * 0.22, null, { stroke: THEME.fg, lw: Math.max(1.5, cell * 0.08) });
    }
    ctx.restore();
    text(fit(p.name, size * 1.15, g.R * 0.03, 800), x, y - size / 2 - g.R * 0.045, g.R * 0.03, { color: p.color, weight: 800, alpha: dim ? 0.5 : 1 });
  }
  function drawWheel() {
    const W = wheelGeo(), seg = TAU / cats.length;
    ctx.save(); ctx.translate(W.x, W.y); ctx.rotate(wheel.a);
    cats.forEach((c, i) => {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, W.r, i * seg - Math.PI / 2, (i + 1) * seg - Math.PI / 2); ctx.closePath();
      ctx.fillStyle = c.col; ctx.fill();
      ctx.strokeStyle = THEME.bg; ctx.lineWidth = Math.max(2, g.R * 0.008); ctx.stroke();
      // the label, upright-ish: along the segment's middle
      const mid = (i + 0.5) * seg;
      ctx.save(); ctx.rotate(mid);
      const abs = (((mid + wheel.a) % TAU) + TAU) % TAU;
      const flip = abs > Math.PI / 2 && abs < Math.PI * 1.5;
      ctx.translate(0, -W.r * 0.64); if (flip) ctx.rotate(Math.PI);
      text(fit(tr(c.short), W.r * 0.8, W.r * 0.12, 800), 0, 0, W.r * 0.12, { color: INK_DARK, weight: 800, dir: /^[±<]/.test(tr(c.short)) ? 'ltr' : undefined });
      ctx.restore();
    });
    ctx.restore();
    g.draw.circle(W.x, W.y, W.r * 0.26, THEME.bg, { stroke: THEME.ink(0.2), lw: g.R * 0.006 });
    if (!wheel.on) text(tr('spinBtn'), W.x, W.y + W.r * 0.01, W.r * 0.13, { weight: 800 });
    else g.draw.circle(W.x, W.y, W.r * 0.07, wheel.done ? cat.col : THEME.ink(0.4));
    // the pointer at the top
    const py = W.y - W.r - g.R * 0.01;
    ctx.save(); ctx.fillStyle = THEME.fg; ctx.beginPath(); ctx.moveTo(W.x - g.R * 0.03, py - g.R * 0.035); ctx.lineTo(W.x + g.R * 0.03, py - g.R * 0.035); ctx.lineTo(W.x, py + g.R * 0.02); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function drawSpin(dt) {
    if (wheel.on && !wheel.done) {
      wheel.a += wheel.v * dt; wheel.v *= Math.exp(-dt * 1.15);
      if (Math.floor(wheel.a / (TAU / cats.length)) !== Math.floor((wheel.a - wheel.v * dt) / (TAU / cats.length))) g.sfx('tick');
      if (wheel.v < 0.3) { wheel.done = true; cat = forced || wheelCat(); forced = null; round++; phaseT = 0; g.sfx('score'); }
    }
    if (wheel.done && phaseT > 1.1) { loadSong(); return; }
    C.hud(tr('round', round + (wheel.done ? 0 : 1)), wheel.done ? tr(cat.name) : contenders ? tr('tieBreak') : tr('tapSpin'), wheel.done ? cat.col : THEME.fg);
    drawWheel();
    players.forEach((p, i) => { const m = miniPos(i); miniCard(p, m.x, m.y, m.size, { dim: !!contenders && !contenders.includes(i) }); });
  }
  function drawListen() {
    C.hud(tr(cat.name), cat.q(), cat.col);
    const x = g.cx, y = g.cy - g.R * 0.12, r = g.R * 0.17;
    C.record(x, y, r, cat.col, C.spin());
    const left = clamp(1 - phaseT / LISTEN_S, 0, 1);
    g.draw.circle(x, y, r + g.R * 0.05, null, { stroke: THEME.ink(0.1), lw: g.R * 0.016 });
    g.draw.arc(x, y, r + g.R * 0.05, 0, TAU * left, cat.col, g.R * 0.016);
    text(String(Math.ceil(LISTEN_S * left)), x, y + r + g.R * 0.13, g.R * 0.05, { color: THEME.muted, weight: 800 });
    text(tr('listen'), g.cx, g.cy + g.R * 0.26, g.R * 0.04, { color: THEME.muted, weight: 700 });
    button('banswer', tr('answerNow'), g.cx, g.cy + g.R * 0.42, g.R * 0.44, g.R * 0.13, startAnswers, { primary: true, col: cat.col });
    if (phaseT > LISTEN_S) startAnswers();
  }
  function drawAnswer() {
    const p = P(active[ai]);
    C.hud(tr('yourAnswer', p.name), cat.q(), p.color);
    // the queue: who's answered (a tick), who's next
    active.forEach((i, k) => {
      const x = g.cx + M() * (k - (active.length - 1) / 2) * g.R * 0.075, y = g.cy - g.R * 0.53;
      g.draw.circle(x, y, g.R * (k === ai ? 0.024 : 0.017), P(i).color, { stroke: k === ai ? THEME.fg : null, lw: g.R * 0.005 });
      if (k < ai) text('✓', x, y + g.R * 0.002, g.R * 0.024, { color: INK_DARK, weight: 800 });
    });
    const pop = ease.back(clamp(phaseT * 4, 0, 1));
    ctx.save(); ctx.globalAlpha = clamp(phaseT * 5, 0, 1);
    const bw = g.R * 0.6, bh = g.R * 0.17;
    if (cat.input === 'group' || cat.input === 'b2000') {
      const [a, b] = cat.input === 'group' ? [['solo', tr('solo1')], ['group', tr('group1')]] : [['before', tr('before')], ['after', tr('after')]];
      button('ans:a', a[1], g.cx - M() * (bw / 2 + g.R * 0.02), g.cy - g.R * 0.05, bw * pop, bh, () => answer(a[0]), { primary: true, col: cat.col, small: true, glow: false });
      button('ans:b', b[1], g.cx + M() * (bw / 2 + g.R * 0.02), g.cy - g.R * 0.05, bw * pop, bh, () => answer(b[0]), { primary: true, col: cat.col, small: true, glow: false });
    } else if (cat.input === 'decade') {
      const cols = Math.min(4, decades.length), rows = Math.ceil(decades.length / cols);
      const cw = g.R * 0.3, ch = g.R * 0.14, gap = g.R * 0.03;
      decades.forEach((d, i) => {
        const r = Math.floor(i / cols), c = i % cols, nRow = Math.min(cols, decades.length - r * cols);
        const x = g.cx + M() * (c - (nRow - 1) / 2) * (cw + gap), y = g.cy - g.R * 0.08 + (r - (rows - 1) / 2) * (ch + gap);
        button(`dec:${d}`, tr('decadeName', d), x, y, cw * pop, ch, () => answer(d), { primary: true, col: cat.col, glow: false });
      });
    } else if (cat.input === 'year') {
      text(String(yearVal), g.cx, g.cy - g.R * 0.14, g.R * 0.17, { weight: 800 });
      const bs = g.R * 0.11, yy = g.cy + g.R * 0.06;
      // minus on the left, plus on the right in both languages (a number line)
      for (const [d, dx] of [[-5, -0.39], [-1, -0.22], [1, 0.22], [5, 0.39]]) {
        button(`yr${d}`, d > 0 ? `+${d}` : `−${-d}`, g.cx + dx * g.R, yy, bs, bs, () => { yearVal = clamp(yearVal + d, 1900, new Date().getFullYear()); g.sfx('tick'); }, { round: true, small: true, dir: 'ltr' });
      }
      text(cat.tol ? `± ${cat.tol}` : '', g.cx, yy, g.R * 0.04, { color: THEME.muted, weight: 800, dir: 'ltr' });
      button('ylock', tr('lock'), g.cx, g.cy + g.R * 0.27, g.R * 0.42, g.R * 0.13, () => answer(yearVal), { primary: true, col: cat.col });
    }
    ctx.restore();
    text(tr('passHint'), g.cx, g.cy + g.R * 0.47, g.R * 0.032, { color: THEME.dim, weight: 700 });
  }
  function drawSay() {
    C.hud(tr(cat.name), cat.q(), cat.col);
    C.record(g.cx, g.cy - g.R * 0.12, g.R * 0.17, cat.col, C.spin());
    U.para(tr('sayIt'), g.cx, g.cy + g.R * 0.17, g.R * 1.1, g.R * 0.045, { lines: 2, weight: 700, fam: THEME.display });
    button('breveal', tr('reveal'), g.cx, g.cy + g.R * 0.4, g.R * 0.44, g.R * 0.13, doReveal, { primary: true, col: cat.col });
  }
  function answerText(p) {
    const a = p.ans;
    if (a == null) return '';
    if (cat.input === 'group') return a === 'solo' ? tr('soloS') : tr('groupS');
    if (cat.input === 'b2000') return a === 'before' ? tr('beforeS') : tr('afterS');
    if (cat.input === 'decade') return tr('decadeName', a);
    return String(a);
  }
  function drawResults(y0, judging) {
    const list = active, per = list.length > 3 ? Math.ceil(list.length / 2) : list.length;
    const cw = g.R * (per > 2 ? 0.42 : per === 2 ? 0.56 : 0.66), ch = g.R * 0.1, gap = g.R * 0.025;
    list.forEach((i, k) => {
      const p = P(i), r = Math.floor(k / per), c = k % per, nRow = Math.min(per, list.length - r * per);
      const x = g.cx + M() * (c - (nRow - 1) / 2) * (cw + gap), y = y0 + r * (ch + gap);
      const ok = p.ok;
      const fn = judging ? () => { p.ok = !p.ok; g.sfx('tick'); } : null;
      if (judging) button(`j${i}`, '', x, y, cw, ch, fn, { fill: ok ? THEME.ok : THEME.glass2, stroke: p.color });
      else g.draw.roundRect(x - cw / 2, y - ch / 2, cw, ch, ch / 2, ok ? g.draw.alpha(THEME.ok, 0.9) : THEME.glass2, { stroke: p.color, lw: Math.max(1.5, g.R * 0.005) });
      const ink = ok ? INK_DARK : THEME.fg;
      g.draw.circle(x - M() * cw * 0.38, y, ch * 0.18, p.color);
      const label = judging || cat.input === 'say' ? p.name : `${p.name} · ${answerText(p)}`;
      text(fit(label, cw * 0.66, ch * 0.32, 800), x - M() * cw * 0.02, y + ch * 0.02, ch * 0.32, { color: ink, weight: 800 });
      text(ok ? '✓' : '✕', x + M() * cw * 0.37, y + ch * 0.02, ch * 0.42, { color: ok ? INK_DARK : THEME.danger, weight: 800 });
    });
  }
  function drawReveal() {
    const t = phaseT, B = { x: g.cx, y: g.cy - g.R * 0.21, w: g.R * 0.48, h: g.R * 0.58 };
    const flip = phase === 'judge' ? 1 : clamp((t - 0.15) / 0.45, 0, 1);
    if (flip >= 0.5 && phase === 'reveal' && sounded !== round) {
      sounded = round;
      g.sfx(active.some((i) => P(i).ok) ? 'perfect' : 'hit');
    }
    C.hud(tr(cat.name), '', cat.col);
    C.bigCard(B.x, B.y, B.w, B.h, ease.inOut(flip), song);
    if (flip >= 1) {
      const judging = phase === 'judge';
      if (judging) text(tr('whoRight'), g.cx, g.cy + g.R * 0.15, g.R * 0.045, { weight: 800 });
      drawResults(g.cy + (judging ? 0.28 : 0.2) * g.R, judging);
      const rows = active.length > 3 ? 2 : 1;
      const by = g.cy + g.R * ((judging ? 0.28 : 0.2) + rows * 0.125 + 0.07);
      button('bnext', judging ? tr('done') : tr('continue'), g.cx, Math.min(by, g.cy + g.R * 0.62), g.R * 0.36, g.R * 0.1, afterReveal, { primary: true, col: cat.col, small: true });
    }
  }
  function drawMark() {
    const p = P(marks[mi]);
    C.hud(phase === 'nomark' && !marks.length ? tr(cat.name) : n > 1 ? tr('markBox', p.name) : tr('markSolo'), tr(cat.name), n > 1 ? p.color : cat.col);
    if (phase === 'nomark') {
      U.para(markMsg, g.cx, g.cy - g.R * 0.02, g.R * 1.1, g.R * 0.05, { lines: 2, weight: 800, fam: THEME.display, color: THEME.muted });
      button('bnext', tr('continue'), g.cx, g.cy + g.R * 0.25, g.R * 0.36, g.R * 0.1, () => { if (marks.length && mi < marks.length) nextMark(); else endRound(); }, { primary: true, col: cat.col, small: true });
      return;
    }
    bigBoard(p, phase === 'mark' ? cat : null, lastLine);
    if (phase === 'marked') {
      if (lastLine) {
        const s = ease.back(clamp(phaseT * 3, 0, 1));
        text(tr('line'), g.cx, g.cy + g.R * 0.62, g.R * 0.08 * s, { color: p.color, weight: 800, glow: g.R * 0.04 });
      }
      if (phaseT > (lastLine ? 1.3 : 0.55)) nextMark();
    } else text(tr('tapBox'), g.cx, g.cy + g.R * 0.6, g.R * 0.036, { color: THEME.muted, weight: 700 });
  }
  /** A player's card big in the middle; boxes of colour `can` (the round's category) glow; `line` is outlined. */
  function bigBoard(p, can, line) {
    const pulse = 0.5 + 0.5 * Math.sin(g.time * 6);
    const B = bigGeo();
    g.draw.roundRect(B.x0 - B.gap * 1.5, B.y0 - B.gap * 1.5, B.w + B.gap * 3, B.w + B.gap * 3, B.cell * 0.25, THEME.glass, { stroke: p.color, lw: Math.max(2, g.R * 0.006) });
    for (let i = 0; i < 16; i++) {
      const c = cellXY(i), cl = p.card[i], cc = cats[cl.c];
      const on = !!can && !cl.x && cc === can;
      cl.t = Math.min(1, cl.t + 1 / 60 * 3);
      const fill = cl.x ? cc.col : g.draw.alpha(cc.col, on ? 0.5 + 0.35 * pulse : can ? (THEME.light ? 0.2 : 0.16) : (THEME.light ? 0.4 : 0.32));
      g.draw.roundRect(c.x - c.s / 2, c.y - c.s / 2, c.s, c.s, c.s * 0.2, fill, on ? { stroke: cc.col, lw: Math.max(2, g.R * 0.008) } : {});
      if (cl.x) drawCross(c.x, c.y, c.s, cl.t);
      if (on && cursor === i) U.focusRing(c.x, c.y, c.s, c.s, false);
      if (line?.includes(i)) g.draw.roundRect(c.x - c.s / 2, c.y - c.s / 2, c.s, c.s, c.s * 0.2, null, { stroke: THEME.fg, lw: Math.max(2, g.R * 0.012) });
    }
  }
  function drawLoad() {
    C.hud(tr(cat.name), cat.q(), cat.col);
    C.record(g.cx, g.cy - g.R * 0.12, g.R * 0.17, cat.col, C.spin() * 0.35);
    text(tr('finding'), g.cx, g.cy + g.R * 0.18, g.R * 0.045, { color: THEME.muted, weight: 700 });
  }
  function drawFail() {
    C.hud(tr(cat.name), '', cat.col);
    const k = U.para(failMsg, g.cx, g.cy - g.R * 0.05, g.R * 1.1, g.R * 0.045, { lines: 3, lh: 1.45 });
    const y = g.cy - g.R * 0.05 + k * g.R * 0.065 + g.R * 0.08;
    button('bretry', tr('retry'), g.cx - M() * g.R * 0.215, y, g.R * 0.4, g.R * 0.11, () => { fails = 0; C.drawn.delete(song); loadSong(); }, { primary: true, col: cat.col });
    button('banother', tr('another'), g.cx + M() * g.R * 0.215, y, g.R * 0.4, g.R * 0.11, () => { fails = 0; loadSong(); }, {});
  }
  function drawWon() {
    const w = winner || players.find((p) => lineOf(p.card)) || players[0];
    C.hud(n > 1 ? tr('bingoWin', w.name) : tr('bingoSolo'), tr('bingoNote', round), w.color);
    bigBoard(w, null, lineOf(w.card));
    text(tr('line'), g.cx, g.cy + g.R * 0.62, g.R * 0.09 * ease.back(clamp(phaseT * 2, 0, 1)), { color: w.color, weight: 800, glow: g.R * 0.04 });
  }

  // ---------------------------------------------------------------- the controller hits.js drives
  return {
    draw(dt) {
      phaseT += dt;
      if (phase === 'spin') drawSpin(dt);
      else if (phase === 'load') drawLoad();
      else if (phase === 'fail') drawFail();
      else if (phase === 'listen') drawListen();
      else if (phase === 'answer') drawAnswer();
      else if (phase === 'say') drawSay();
      else if (phase === 'reveal' || phase === 'judge') drawReveal();
      else if (phase === 'mark' || phase === 'marked' || phase === 'nomark') drawMark();
      else if (phase === 'won') drawWon();
    },
    down() { return false; },
    move() {},
    up() {},
    tap(p) {
      if (!p) { if (phase === 'spin') spinWheel(); return; }
      if (phase === 'spin') { const W = wheelGeo(); if (Math.hypot(p.x - W.x, p.y - W.y) < W.r * 1.15) spinWheel(); }
      else if (phase === 'mark') { const i = cellAt(p.x, p.y); if (i != null) cross(i); }
    },
    /** Keys: Enter spins; the year picker takes ← → ↑ ↓; on the card the arrows move between the boxes you can cross. */
    key(k) {
      if (phase === 'spin' && (k === 'Enter' || k === ' ')) { spinWheel(); return true; }
      if (phase === 'answer' && cat.input === 'year' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
        const up = k === 'ArrowUp' || k === 'ArrowRight';
        yearVal = clamp(yearVal + (up ? 1 : -1), 1900, new Date().getFullYear()); g.sfx('tick'); return true;
      }
      if (phase === 'answer' && cat.input === 'year' && (k === 'Enter' || k === ' ') && !U.focus) { answer(yearVal); return true; }
      if (phase === 'mark') {
        const p = P(marks[mi]);
        const ok = p.card.map((c, i) => (!c.x && cats[c.c] === cat ? i : -1)).filter((i) => i >= 0);
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k) && ok.length) {
          const fwd = k === 'ArrowDown' || k === (he() ? 'ArrowLeft' : 'ArrowRight');
          const j = ok.indexOf(cursor);
          cursor = ok[(j < 0 ? (fwd ? 0 : ok.length - 1) : (j + (fwd ? 1 : -1) + ok.length) % ok.length)];
          g.sfx('tick'); return true;
        }
        if ((k === 'Enter' || k === ' ') && cursor != null) { cross(cursor); return true; }
      }
      return false;
    },
    mystery: () => ['load', 'fail', 'listen', 'answer', 'say'].includes(phase) || (phase === 'reveal' && phaseT < 0.4),
    destroy() { destroyed = true; tok++; },
    debug: () => ({
      phase, round, cat: cat?.id, input: cat?.input, ai, active, contenders, marks, mi, song: song && { t: song.t, a: song.a, y: song.y, b: song.b },
      decades, yearVal, players: players.map((p) => ({ name: p.name, ans: p.ans, ok: p.ok, crosses: p.crosses, card: p.card.map((c) => (c.x ? 'X' : '') + c.c) })),
      catIndex: cat ? cats.indexOf(cat) : -1, cats: cats.map((c) => c.id),
    }),
    /** For tests: the category the wheel lands on next. */
    _force(catId) { forced = cats.find((c) => c.id === catId) || null; },
  };
}
