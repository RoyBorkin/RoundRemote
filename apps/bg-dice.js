// Board Games → Dice: 1–12 dice (d4…d20, d100 as a pair of d10s) with hold & re-roll, modifier, advantage,
// history and shake-to-roll; Battle (Risk-style attacker vs defender) and Duel (high roll wins, 2–6 players).
import { h, clear } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { openPanel, curve } from '../js/ui/overlay.js';
import { createTray, TYPES, randFace, rnd } from './bg-dice-engine.js';
import { seg, numPad, svgIcon, IC, roster, rememberNames } from './bg-ui.js';

export const DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
const MAX_DICE = 12;
const TRAY = { cx: 0.5, cy: 0.545, r: 0.235 };
const SHAPE_SVG = {
  d4: 'M12 2.5 22 20H2z', d6: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', d8: 'M12 1 21 12 12 23 3 12z',
  d10: 'M12 1 22.5 10.5 12 23 1.5 10.5z', d12: 'M12 1.2 22.8 9 18.7 21.7H5.3L1.2 9z', d20: 'M12 1 21.5 6.5v11L12 23l-9.5-5.5v-11z', d100: 'M12 1 22.5 10.5 12 23 1.5 10.5z',
};
const typeColor = (t) => (t === 'd100' ? TYPES.d10t.color : TYPES[t].color);
const polar = (deg, r, cy = 50) => { const a = (deg * Math.PI) / 180; return { left: `${50 + r * Math.sin(a)}%`, top: `${cy - r * Math.cos(a)}%` }; };
const sizeFor = (n, R) => R * (n <= 1 ? 0.62 : n <= 2 ? 0.54 : n <= 4 ? 0.46 : n <= 6 ? 0.4 : n <= 9 ? 0.34 : n <= 12 ? 0.3 : 0.25);

/** Shared with other tools (Yahtzee sheet reads the last 5d6 roll). */
export const lastRoll = { values: [], types: [] };

export function mount(el, ctx, opts = {}) {
  const { app } = ctx;
  ctx.hideTitle(true);
  el.classList.add('bg-dice');
  const S = Object.assign({ set: ['d6', 'd6'], mod: 0, adv: 0, shake: false, history: [], mode: 'roll', last: 'd6',
    battle: { att: 3, def: 2, aArmies: 0, dArmies: 0 }, duel: { n: 2, type: 'd6', wins: [] } }, app.data('dice', {}));
  S.battle = Object.assign({ att: 3, def: 2, aArmies: 0, dArmies: 0 }, S.battle);
  S.duel = Object.assign({ n: 2, type: 'd6', wins: [] }, S.duel);
  if (opts.preset) { S.mode = 'roll'; S.set = opts.preset.slice(); }
  const save = () => app.save('dice', { set: S.set, mod: S.mod, adv: S.adv, shake: S.shake, history: S.history.slice(0, 40), mode: S.mode, last: S.last, battle: S.battle, duel: { n: S.duel.n, type: S.duel.type } });

  // ---------------------------------------------------------------- layout
  const trayEl = h('div.bg-tray', { style: { left: `${TRAY.cx * 100}%`, top: `${TRAY.cy * 100}%`, width: `${TRAY.r * 200}%`, height: `${TRAY.r * 200}%` } });
  const layer = h('div.bg-dice-ui');
  el.append(trayEl);
  let lastHit = 0;
  const tray = createTray(el, {
    tray: TRAY,
    onHit: (k) => { const now = performance.now(); if (now - lastHit > 45 && k > 0.08) { lastHit = now; app.sfx('click', { pitch: 0.6 + rnd() * 0.7, volume: 0.35 + k * 0.8 }); } },
    onTap: (b) => mode.tap?.(b),
    onSettle: () => mode.settled?.(),
  });
  el.append(layer);
  el._tray = tray;   // (for tests)
  const modeSeg = seg([{ v: 'roll', label: 'Dice' }, { v: 'battle', label: 'Battle' }, { v: 'duel', label: 'Duel' }], S.mode, (v) => setMode(v), 'bg-dice-modes');
  const totalEl = h('div.bg-total');
  const subEl = h('div.bg-total-sub');
  const rollBtn = h('button.pill.primary.bg-roll', { type: 'button', onclick: () => doRoll() }, 'Roll');
  const side = h('div.bg-dice-side');
  layer.append(modeSeg, totalEl, subEl, rollBtn, side);

  const setTotal = (big, sub = '', cls = '') => {
    totalEl.className = `bg-total ${cls}`;
    totalEl.textContent = big;
    subEl.textContent = sub;
    totalEl.classList.remove('pop'); void totalEl.offsetWidth; totalEl.classList.add('pop');
  };
  const pushHistory = (text, total) => { S.history.unshift({ t: Date.now(), text, total }); S.history.length = Math.min(S.history.length, 60); save(); };

  // ---------------------------------------------------------------- mode: plain dice
  const rollMode = (() => {
    let held = [], results = [], rolledOnce = false, rollNo = 0;
    const typeBtns = {};
    let modBtn, advBtn, minusBtn;
    function bodiesSpec() {
      const specs = [];
      S.set.forEach((t, i) => {
        const r = results[i];
        if (t === 'd100') {
          const v = r ? r.value : 100;
          specs.push({ id: `${i}t`, li: i, type: 'd10t', face: r ? Math.floor((v % 100) / 10) * 10 : 0 });
          specs.push({ id: `${i}u`, li: i, type: 'd10u', face: r ? v % 10 : 0 });
        } else specs.push({ id: `${i}`, li: i, type: t, face: r ? r.value : TYPES[t].sides });
      });
      return specs;
    }
    function rebuild(instant = true) {
      const specs = bodiesSpec();
      tray.setBodies(specs, sizeFor(specs.length, tray.geo.R));
      decorate();
      tray.layoutGrid(instant);
    }
    function decorate() {
      for (const b of tray.bodies) {
        const r = results[b.li];
        b.held = !!held[b.li];
        b.mark = b.held ? '#f59e0b' : null;
        b.badge = r?.alt != null ? String(r.alt) : null;
        b.badgeBg = '#64748b';
      }
      tray.redraw();
    }
    function changed() {
      held = []; results = []; rolledOnce = false; rollNo = 0;
      rebuild(true); updateSide(); save();
      setTotal(S.set.length ? notation() : 'No dice', S.set.length ? 'Tap Roll · tap a type to add a die' : 'Add dice from the left', 'idle');
    }
    function notation() {
      const cnt = {}; for (const t of S.set) cnt[t] = (cnt[t] || 0) + 1;
      const s = DIE_TYPES.filter((t) => cnt[t]).map((t) => `${cnt[t] > 1 ? cnt[t] : ''}${t}`).join(' + ');
      return s + (S.mod ? ` ${S.mod > 0 ? '+' : '−'} ${Math.abs(S.mod)}` : '');
    }
    function add(t) {
      if (tray.rolling) return;
      if (S.set.length >= MAX_DICE) { app.toast(`Up to ${MAX_DICE} dice`); return; }
      S.set.push(t); S.last = t; app.sfx('tap'); changed();
    }
    function removeOne(t) {
      if (tray.rolling || !S.set.length) return;
      let i = t ? S.set.lastIndexOf(t) : S.set.length - 1;
      if (i < 0) i = S.set.length - 1;
      S.set.splice(i, 1); app.sfx('tap', { pitch: 0.8 }); changed();
    }
    function hasD20() { return S.set.includes('d20'); }
    function updateSide() {
      for (const t of DIE_TYPES) {
        const n = S.set.filter((x) => x === t).length;
        typeBtns[t].querySelector('.bg-type-n').textContent = n ? String(n) : '';
        typeBtns[t].classList.toggle('has', n > 0);
      }
      modBtn.querySelector('b').textContent = S.mod ? (S.mod > 0 ? `+${S.mod}` : `−${-S.mod}`) : '±0';
      modBtn.classList.toggle('on', !!S.mod);
      advBtn.querySelector('b').textContent = S.adv > 0 ? 'ADV' : S.adv < 0 ? 'DIS' : 'ADV';
      advBtn.classList.toggle('on', S.adv !== 0 && hasD20());
      advBtn.disabled = !hasD20();
      minusBtn.disabled = !S.set.length;
      rollBtn.disabled = !S.set.length;
      rollBtn.textContent = held.some(Boolean) && rolledOnce ? 'Re-roll' : 'Roll';
    }
    function build() {
      clear(side);
      // die types along the left edge (tap = add one; long-press = remove one)
      DIE_TYPES.forEach((t, i) => {
        const ang = 232 + i * 12.7;
        const b = h('button.bg-type', { type: 'button', 'aria-label': `Add ${t}`, style: polar(ang, 40.5), '--tc': typeColor(t),
          html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SHAPE_SVG[t]}"/></svg><span class="bg-type-l">${t}</span><span class="bg-type-n"></span>` });
        let lp = null, longed = false;
        b.addEventListener('pointerdown', () => { longed = false; lp = setTimeout(() => { longed = true; removeOne(t); }, 520); });
        const cancel = () => clearTimeout(lp);
        b.addEventListener('pointerup', cancel); b.addEventListener('pointerleave', cancel); b.addEventListener('pointercancel', cancel);
        b.addEventListener('contextmenu', (e) => e.preventDefault());
        b.addEventListener('click', (e) => { e.stopPropagation(); if (!longed) add(t); });
        typeBtns[t] = b; side.append(b);
      });
      // options along the right edge
      const opt = (ang, label, ic, fn, cls = '') => {
        const b = h(`button.bg-opt${cls}`, { type: 'button', 'aria-label': label, style: polar(ang, 40.5), onclick: (e) => { e.stopPropagation(); fn(); } },
          ic ? h('i', { html: ic }) : null, h('b'));
        side.append(b); return b;
      };
      minusBtn = opt(52, 'Remove a die', icon('minus'), () => removeOne());
      modBtn = opt(72, 'Modifier', null, async () => {
        const v = await numPad({ title: 'Modifier', value: S.mod, sign: 1, hint: 'Added to the total (use ± for minus)' });
        if (v !== null) { S.mod = Math.max(-99, Math.min(99, v)); changed(); }
      }, '.txt');
      advBtn = opt(92, 'Advantage', null, () => {
        S.adv = S.adv === 0 ? 1 : S.adv === 1 ? -1 : 0; results = []; rolledOnce = false; rebuild(true); updateSide(); save();
        app.toast(S.adv > 0 ? 'Advantage: each d20 rolls twice, keeps the higher' : S.adv < 0 ? 'Disadvantage: each d20 rolls twice, keeps the lower' : 'Normal d20 rolls');
      }, '.txt');
      opt(112, 'History', svgIcon(IC.history), () => showHistory());
      opt(132, 'Dice sets & options', svgIcon(IC.tune), () => showOptions());
      updateSide();
    }
    function roll() {
      if (!S.set.length || tray.rolling) return;
      const anyHeld = rolledOnce && held.some(Boolean);
      if (!anyHeld) held = [];
      rollNo = anyHeld ? rollNo + 1 : 1;
      results = S.set.map((t, i) => {
        if (held[i] && results[i]) return results[i];
        if (t === 'd100') { const tens = randFace('d10t'), units = randFace('d10u'); return { type: t, value: tens + units || 100 }; }
        const v = randFace(t);
        if (t === 'd20' && S.adv) { const w = randFace(t); const keep = S.adv > 0 ? Math.max(v, w) : Math.min(v, w); return { type: t, value: keep, alt: keep === v ? w : v }; }
        return { type: t, value: v };
      });
      decorate();
      for (const b of tray.bodies) b.badge = null;
      const finals = tray.bodies.map((b) => {
        const r = results[b.li];
        if (b.type === 'd10t') return Math.floor((r.value % 100) / 10) * 10;
        if (b.type === 'd10u') return r.value % 10;
        return r.value;
      });
      tray.roll(finals);
      rolledOnce = true;
      setTotal('…', '', 'rolling');
      updateSide();
      app.vibrate?.(15);
    }
    function settled() {
      decorate();
      const vals = results.map((r) => r.value);
      const sum = vals.reduce((a, b) => a + b, 0) + S.mod;
      const parts = results.map((r) => (r.alt != null ? `${r.value}(${r.alt})` : String(r.value)));
      let sub = results.length > 1 || S.mod ? parts.join(' + ') + (S.mod ? `  ${S.mod > 0 ? '+' : '−'} ${Math.abs(S.mod)}` : '') : '';
      const combo = comboName(results);
      if (combo) sub = sub ? `${combo} · ${sub}` : combo;
      if (rollNo > 1) sub = `Roll ${rollNo} · ${sub}`;
      setTotal(String(sum), sub || TYPES[results[0].type === 'd100' ? 'd10t' : results[0].type].name, combo ? 'combo' : '');
      if (combo) app.sfx('score');
      lastRoll.values = vals; lastRoll.types = results.map((r) => r.type);
      pushHistory(`${notation()} → ${parts.join(', ')}`, sum);
      updateSide();
    }
    function tap(b) {
      if (tray.rolling || !rolledOnce) return;
      held[b.li] = !held[b.li];
      app.sfx('tick');
      decorate(); updateSide();
      if (held.some(Boolean)) subEl.textContent = `${held.filter(Boolean).length} held — Re-roll rolls the rest`;
    }
    return {
      enter() { build(); rebuild(true); changed(); },
      roll, settled, tap,
      key(e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { add(S.last || 'd6'); return true; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { removeOne(); return true; }
        return false;
      },
      setPreset(list) { S.set = list.slice(); S.last = list[0] || 'd6'; changed(); },
      releaseHolds() { held = []; decorate(); updateSide(); },
      notation,
    };
  })();

  // ---------------------------------------------------------------- mode: Risk battle
  const battleMode = (() => {
    let res = null, chips = {}, armA, armD, blitzBtn;
    const B = S.battle;
    const maxA = () => (B.aArmies ? Math.max(0, Math.min(3, B.aArmies - 1)) : 3);
    const maxD = () => (B.dArmies ? Math.max(0, Math.min(2, B.dArmies)) : 2);
    const nA = () => Math.min(B.att, maxA()), nD = () => Math.min(B.def, maxD());
    function rebuild() {
      const specs = [];
      const a = res ? res.a : Array(nA()).fill(6), d = res ? res.d : Array(nD()).fill(6);
      a.forEach((v, i) => specs.push({ id: `a${i}`, side: 'a', idx: i, type: 'd6', face: v, color: '#dc2626', ink: '#ffffff' }));
      d.forEach((v, i) => specs.push({ id: `d${i}`, side: 'd', idx: i, type: 'd6', face: v, color: '#f3eee2' }));
      tray.setBodies(specs, tray.geo.R * 0.36);
      place(true);
    }
    function place(instant) {
      const { cx, cy, R } = tray.geo;
      const pts = tray.bodies.map((b) => {
        const nRows = Math.max(res ? res.a.length : nA(), res ? res.d.length : nD(), 1);
        const y = cy + (b.idx - (nRows - 1) / 2) * R * 0.46;
        return [cx + (b.side === 'a' ? -1 : 1) * R * 0.3, y];
      });
      if (instant) { tray.bodies.forEach((b, i) => { b.x = pts[i][0]; b.y = pts[i][1]; b.a = 0; }); tray.redraw(); } else tray.arrange(pts);
      decorate();
    }
    function decorate() {
      for (const b of tray.bodies) {
        b.mark = null; b.dim = false; b.badge = null;
        if (!res) continue;
        const pair = b.idx < res.pairs;
        if (!pair) { b.dim = true; continue; }
        const aWins = res.a[b.idx] > res.d[b.idx];
        const won = b.side === 'a' ? aWins : !aWins;
        b.mark = won ? '#22c55e' : null; b.dim = !won;
      }
      tray.redraw();
    }
    function updateSide() {
      const ma = maxA(), md = maxD();
      for (let i = 1; i <= 3; i++) { chips[`a${i}`].classList.toggle('on', B.att === i); chips[`a${i}`].disabled = i > ma; }
      for (let i = 1; i <= 2; i++) { chips[`d${i}`].classList.toggle('on', B.def === i); chips[`d${i}`].disabled = i > md; }
      armA.querySelector('b').textContent = B.aArmies ? String(B.aArmies) : '—';
      armD.querySelector('b').textContent = B.dArmies ? String(B.dArmies) : '—';
      blitzBtn.hidden = !(B.aArmies && B.dArmies);
      rollBtn.disabled = !nA() || !nD();
      rollBtn.textContent = 'Attack';
    }
    function build() {
      clear(side);
      side.append(h('div.bg-cap.att', { style: polar(234, 37) }, 'ATTACK'), h('div.bg-cap.def', { style: polar(126, 37) }, 'DEFEND'));
      [1, 2, 3].forEach((n, i) => {
        const b = h('button.bg-cnt.att', { type: 'button', style: polar(252 + i * 18, 40.5), onclick: (e) => { e.stopPropagation(); B.att = n; res = null; rebuild(); updateSide(); save(); } }, String(n));
        chips[`a${n}`] = b; side.append(b);
      });
      [1, 2].forEach((n, i) => {
        const b = h('button.bg-cnt.def', { type: 'button', style: polar(108 - i * 18, 40.5), onclick: (e) => { e.stopPropagation(); B.def = n; res = null; rebuild(); updateSide(); save(); } }, String(n));
        chips[`d${n}`] = b; side.append(b);
      });
      const army = (sideK, ang) => h('button.bg-army', { type: 'button', style: polar(ang, 40.5), 'aria-label': 'Armies', onclick: async (e) => {
        e.stopPropagation();
        const v = await numPad({ title: sideK === 'a' ? 'Attacking armies' : 'Defending armies', value: B[sideK === 'a' ? 'aArmies' : 'dArmies'], allowNeg: false, hint: 'Armies in the territory (0 = don’t track)' });
        if (v !== null) { B[sideK === 'a' ? 'aArmies' : 'dArmies'] = Math.min(999, v); res = null; rebuild(); updateSide(); save(); setTotal('Risk battle', 'Attacker vs defender — ties go to the defender', 'idle'); }
      } }, h('b'), h('small', 'armies'));
      armA = army('a', 310); armD = army('d', 50);
      blitzBtn = h('button.pill.small.bg-blitz', { type: 'button', onclick: () => blitz() }, 'Blitz');
      side.append(armA, armD, blitzBtn);
      updateSide();
    }
    function compute(na, nd) {
      const a = Array.from({ length: na }, () => randFace('d6')).sort((x, y) => y - x);
      const d = Array.from({ length: nd }, () => randFace('d6')).sort((x, y) => y - x);
      const pairs = Math.min(na, nd);
      let la = 0, ld = 0;
      for (let i = 0; i < pairs; i++) if (a[i] > d[i]) ld++; else la++;
      return { a, d, pairs, la, ld };
    }
    function roll() {
      if (tray.rolling || !nA() || !nD()) return;
      res = compute(nA(), nD());
      rebuild();
      for (const b of tray.bodies) { b.mark = null; b.dim = false; }
      tray.roll(tray.bodies.map((b) => (b.side === 'a' ? res.a[b.idx] : res.d[b.idx])));
      setTotal('…', '', 'rolling');
    }
    function finish(r, prefix = '') {
      let msg = `Attacker −${r.la} · Defender −${r.ld}`;
      const trackA = !!B.aArmies, trackD = !!B.dArmies;
      if (trackA) B.aArmies = Math.max(1, B.aArmies - r.la);
      if (trackD) B.dArmies = Math.max(0, B.dArmies - r.ld);
      let big = r.ld > r.la ? 'Attacker wins' : r.la > r.ld ? 'Defender holds' : 'Split';
      if (trackD && B.dArmies === 0) { big = 'Conquered!'; msg = `Move at least ${r.a.length} armies in`; app.sfx('win'); }
      else if (trackA && B.aArmies === 1) { big = 'Attack over'; msg = 'Only one army left to attack with'; }
      setTotal(big, prefix + msg, r.ld > r.la ? 'att' : r.la > r.ld ? 'def' : '');
      pushHistory(`Battle ${r.a.length}v${r.d.length}: ${r.a.join(',')} vs ${r.d.join(',')} → A−${r.la} D−${r.ld}`, null);
      updateSide(); save();
    }
    function settled() { place(false); finish(res); app.sfx(res.ld > res.la ? 'score' : 'hit'); }
    function blitz() {
      if (tray.rolling || !(B.aArmies && B.dArmies)) return;
      let rounds = 0, tla = 0, tld = 0, last = null;
      while (B.aArmies > 1 && B.dArmies > 0 && rounds < 500) {
        const r = compute(Math.min(3, B.aArmies - 1, B.att), Math.min(2, B.dArmies, B.def));
        B.aArmies -= r.la; B.dArmies -= r.ld; tla += r.la; tld += r.ld; rounds++; last = r;
      }
      if (!last) return;
      // replay the final roll on the table (armies are already counted)
      res = last;
      const keepA = B.aArmies, keepD = B.dArmies;
      rebuild();
      tray.roll(tray.bodies.map((b) => (b.side === 'a' ? res.a[b.idx] : res.d[b.idx])));
      setTotal('…', '', 'rolling');
      mode.settled = () => {
        place(false);
        B.aArmies = keepA; B.dArmies = keepD;
        const won = B.dArmies === 0;
        setTotal(won ? 'Conquered!' : 'Blitz stopped', `${rounds} roll${rounds > 1 ? 's' : ''} · Attacker −${tla} · Defender −${tld}`, won ? 'att' : 'def');
        app.sfx(won ? 'win' : 'over');
        pushHistory(`Blitz: ${rounds} rolls → A−${tla} D−${tld}${won ? ' (conquered)' : ''}`, null);
        mode.settled = settled; updateSide(); save();
      };
    }
    return {
      enter() { res = null; build(); rebuild(); setTotal('Risk battle', 'Attacker vs defender — ties go to the defender', 'idle'); },
      roll, settled,
      key(e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { B.att = B.att % 3 + 1; res = null; rebuild(); updateSide(); return true; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { B.def = B.def % 2 + 1; res = null; rebuild(); updateSide(); return true; }
        return false;
      },
    };
  })();

  // ---------------------------------------------------------------- mode: duel (high roll wins)
  const duelMode = (() => {
    const D = S.duel;
    let players = roster(app, 6), res = null, tied = null, labels = [], chips = {}, typeChips = {};
    let wins = Array(6).fill(0);
    function slot(i) { const n = D.n; const a = (i / n) * Math.PI * 2 + (n === 2 ? Math.PI / 2 : 0); return a; }
    function rebuild() {
      const specs = [];
      for (let i = 0; i < D.n; i++) specs.push({ id: `p${i}`, pi: i, type: D.type, face: res ? res[i] : TYPES[D.type].sides, color: D.type === 'd6' ? players[i].color : players[i].color, ink: '#ffffff' });
      tray.setBodies(specs, tray.geo.R * (D.n <= 2 ? 0.42 : D.n <= 4 ? 0.36 : 0.3));
      place(true);
      renderLabels();
    }
    function place(instant) {
      const { cx, cy, R } = tray.geo;
      const pts = tray.bodies.map((b) => { const a = slot(b.pi); return [cx + Math.sin(a) * R * 0.42, cy - Math.cos(a) * R * 0.42]; });
      if (instant) { tray.bodies.forEach((b, i) => { b.x = pts[i][0]; b.y = pts[i][1]; b.a = 0; }); } else tray.arrange(pts);
      decorate();
    }
    function decorate() {
      const best = res ? Math.max(...res.filter((_, i) => !tied || tied.includes(i))) : null;
      for (const b of tray.bodies) {
        const inPlay = !tied || tied.includes(b.pi);
        b.held = !inPlay; b.dim = res ? !inPlay || res[b.pi] !== best : false;
        b.mark = res && inPlay && res[b.pi] === best ? '#f59e0b' : null;
      }
      tray.redraw();
    }
    function renderLabels() {
      labels.forEach((l) => l.remove());
      const { R } = tray.geo; const box = el.getBoundingClientRect().width || 1;
      const rr = (R / box) * 100 * 0.86;
      labels = Array.from({ length: D.n }, (_, i) => {
        const a = slot(i);
        const l = h('button.bg-duel-name', { type: 'button', '--c': players[i].color, style: { left: `${TRAY.cx * 100 + Math.sin(a) * rr}%`, top: `${TRAY.cy * 100 - Math.cos(a) * rr}%` },
          onclick: async (e) => {
            e.stopPropagation();
            const v = await app.editText({ title: `Player ${i + 1}`, value: players[i].name });
            if (v) { players[i].name = v.slice(0, 14); rememberNames(app, players); renderLabels(); }
          } }, h('span', players[i].name), wins[i] ? h('b', `${wins[i]}`) : null);
        layer.append(l);
        return l;
      });
    }
    function updateSide() {
      for (let n = 2; n <= 6; n++) chips[n].classList.toggle('on', D.n === n);
      for (const t of ['d6', 'd20']) typeChips[t].classList.toggle('on', D.type === t);
      rollBtn.disabled = false;
      rollBtn.textContent = tied ? 'Tie-break' : 'Roll';
    }
    function build() {
      clear(side);
      side.append(h('div.bg-cap', { style: polar(236, 37) }, 'PLAYERS'));
      for (let n = 2; n <= 6; n++) {
        const b = h('button.bg-cnt', { type: 'button', style: polar(248 + (n - 2) * 14, 40.5), onclick: (e) => { e.stopPropagation(); D.n = n; res = null; tied = null; rebuild(); updateSide(); save(); } }, String(n));
        chips[n] = b; side.append(b);
      }
      side.append(h('div.bg-cap', { style: polar(124, 37) }, 'DIE'));
      ['d6', 'd20'].forEach((t, i) => {
        const b = h('button.bg-cnt.txt', { type: 'button', style: polar(108 - i * 18, 40.5), onclick: (e) => { e.stopPropagation(); D.type = t; res = null; tied = null; rebuild(); updateSide(); save(); } }, t);
        typeChips[t] = b; side.append(b);
      });
      const reset = h('button.bg-opt', { type: 'button', 'aria-label': 'Reset wins', style: polar(60, 40.5), onclick: (e) => { e.stopPropagation(); wins = Array(6).fill(0); renderLabels(); app.toast('Wins reset'); } }, h('i', { html: svgIcon(IC.undo) }), h('b'));
      side.append(reset);
      updateSide();
    }
    function roll() {
      if (tray.rolling) return;
      const inPlay = tied || Array.from({ length: D.n }, (_, i) => i);
      res = Array.from({ length: D.n }, (_, i) => (inPlay.includes(i) ? randFace(D.type) : res ? res[i] : 0));
      for (const b of tray.bodies) { b.mark = null; b.dim = !inPlay.includes(b.pi); b.held = !inPlay.includes(b.pi); }
      tray.roll(tray.bodies.map((b) => res[b.pi]));
      setTotal('…', '', 'rolling');
    }
    function settled() {
      const inPlay = tied || Array.from({ length: D.n }, (_, i) => i);
      const best = Math.max(...inPlay.map((i) => res[i]));
      const top = inPlay.filter((i) => res[i] === best);
      place(false);
      if (top.length > 1) {
        tied = top;
        setTotal('Tie!', `${top.map((i) => players[i].name).join(' & ')} rolled ${best} — roll again`, 'idle');
        app.sfx('bounce');
      } else {
        const w = top[0]; tied = null; wins[w]++;
        setTotal(`${players[w].name} wins`, `rolled ${best}`, 'win');
        app.sfx('win');
        pushHistory(`Duel (${D.type}): ${players[w].name} wins with ${best}`, best);
        decorate();
      }
      renderLabels(); updateSide();
    }
    return {
      enter() { res = null; tied = null; build(); rebuild(); setTotal('Duel', 'Everyone rolls — highest wins', 'idle'); },
      leave() { labels.forEach((l) => l.remove()); labels = []; },
      roll, settled,
      key(e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { D.n = Math.min(6, D.n + 1); res = null; tied = null; rebuild(); updateSide(); return true; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { D.n = Math.max(2, D.n - 1); res = null; tied = null; rebuild(); updateSide(); return true; }
        return false;
      },
    };
  })();

  // ---------------------------------------------------------------- modes, roll, panels
  let mode = null;
  const MODES = { roll: rollMode, battle: battleMode, duel: duelMode };
  function setMode(m) {
    if (tray.rolling) { modeSeg.set(S.mode); return; }
    mode?.leave?.();
    S.mode = m; save();
    el.dataset.mode = m;
    mode = Object.assign({}, MODES[m]);   // a copy so a mode may swap its own settled() temporarily
    MODES[m].enter.call(mode);
    mode.settled = MODES[m].settled; mode.tap = MODES[m].tap;
    modeSeg.set(m);
  }
  function doRoll() { if (!tray.rolling) { app.sfx('whoosh'); mode.roll(); } }

  function showHistory() {
    openPanel({
      title: 'Roll history', className: 'bg-hist',
      build(body) {
        const list = h('div.list');
        if (!S.history.length) list.append(h('div.empty', 'No rolls yet'));
        for (const r of S.history) {
          const tm = new Date(r.t);
          list.append(h('div.bg-hist-row', r.total != null ? h('b.bg-hist-total', String(r.total)) : h('b.bg-hist-total.sm', '⚔'),
            h('div.bg-hist-t', h('div', r.text), h('small', `${tm.getHours()}:${String(tm.getMinutes()).padStart(2, '0')}`))));
        }
        body.append(...[list, S.history.length ? h('button.pill.small.bg-hist-clear', { type: 'button', onclick: () => { S.history = []; save(); clear(list); list.append(h('div.empty', 'No rolls yet')); } }, 'Clear history') : null].filter(Boolean));
        curve(list);
      },
    });
  }
  function showOptions() {
    openPanel({
      title: 'Dice', className: 'bg-opts',
      build(body, panel) {
        const presets = [
          ['2d6', ['d6', 'd6'], 'Catan, Monopoly, Backgammon'], ['5d6', ['d6', 'd6', 'd6', 'd6', 'd6'], 'Yahtzee'], ['1d6', ['d6'], 'Ludo, snakes & ladders'],
          ['3d6', ['d6', 'd6', 'd6'], ''], ['1d20', ['d20'], 'D&D check'], ['4d6', ['d6', 'd6', 'd6', 'd6'], 'stat roll'], ['d100', ['d100'], 'percentile'], ['RPG set', ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'], 'one of each'],
        ];
        const grid = h('div.bg-presets', presets.map(([name, list, sub]) => h('button.bg-preset', { type: 'button', onclick: () => { if (S.mode !== 'roll') setMode('roll'); rollMode.setPreset(list); panel.close(); } }, h('b', name), sub ? h('small', sub) : null)));
        const shakeRow = h('button.bg-row-opt', { type: 'button', onclick: () => toggleShake().then(() => { sw.classList.toggle('on', S.shake); }) }, h('span', 'Shake to roll'), h('span.switch'));
        const sw = shakeRow.querySelector('.switch'); sw.classList.toggle('on', S.shake);
        body.append(h('div.bg-sect', 'Quick sets'), grid, shakeRow,
          h('div.bg-note', 'Tap a die type to add it · long-press it to remove one · after a roll, tap dice to hold them'),
          h('button.pill.small.danger.bg-clear', { type: 'button', onclick: () => { if (S.mode !== 'roll') setMode('roll'); rollMode.setPreset([]); panel.close(); } }, 'Remove all dice'));
      },
    });
  }

  // shake to roll
  let lastAcc = null, lastShake = 0;
  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity || e.acceleration; if (!a) return;
    if (lastAcc) {
      const d = Math.abs(a.x - lastAcc.x) + Math.abs(a.y - lastAcc.y) + Math.abs(a.z - lastAcc.z);
      const now = performance.now();
      if (d > 26 && now - lastShake > 1400) { lastShake = now; doRoll(); }
    }
    lastAcc = { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
  };
  async function toggleShake() {
    if (!S.shake) {
      if (typeof DeviceMotionEvent === 'undefined') { app.toast('This device has no motion sensor'); return; }
      try { if (DeviceMotionEvent.requestPermission && (await DeviceMotionEvent.requestPermission()) !== 'granted') { app.toast('Motion access was not allowed'); return; } } catch {}
      S.shake = true; window.addEventListener('devicemotion', onMotion); app.toast('Shake the device to roll');
    } else { S.shake = false; window.removeEventListener('devicemotion', onMotion); }
    save();
  }
  if (S.shake && typeof DeviceMotionEvent !== 'undefined' && !DeviceMotionEvent.requestPermission) window.addEventListener('devicemotion', onMotion);

  const offRaf = app.raf((dt) => tray.frame(dt));
  setMode(S.mode in MODES ? S.mode : 'roll');

  return {
    key(e) {
      if (e.key === 'Enter' || e.key === ' ') { doRoll(); return true; }
      if (e.key === 'Tab') { const order = ['roll', 'battle', 'duel']; setMode(order[(order.indexOf(S.mode) + 1) % 3]); return true; }
      return mode?.key?.(e) || false;
    },
    destroy() { offRaf(); tray.destroy(); window.removeEventListener('devicemotion', onMotion); mode?.leave?.(); },
  };
}

function comboName(results) {
  if (!results.length || results.some((r) => r.type !== 'd6')) return '';
  const v = results.map((r) => r.value);
  const n = v.length;
  const cnt = {}; for (const x of v) cnt[x] = (cnt[x] || 0) + 1;
  const counts = Object.values(cnt).sort((a, b) => b - a);
  const has = (seq) => seq.every((x) => cnt[x]);
  if (n === 2) return v[0] === v[1] ? 'Doubles!' : '';
  if (n === 5) {
    if (counts[0] === 5) return 'YAHTZEE!';
    if (has([1, 2, 3, 4, 5]) || has([2, 3, 4, 5, 6])) return 'Large straight';
    if (has([1, 2, 3, 4]) || has([2, 3, 4, 5]) || has([3, 4, 5, 6])) return 'Small straight';
    if (counts[0] === 3 && counts[1] === 2) return 'Full house';
    if (counts[0] === 4) return 'Four of a kind';
    if (counts[0] === 3) return 'Three of a kind';
    return '';
  }
  if (n >= 3 && counts[0] === n) return `All ${v[0]}s!`;
  return '';
}
export { comboName };
