// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Truth or Dare: spin the bottle. Flick it (or tap it, press Enter, or turn the knob fast) and it spins with real
// momentum, slows down and points at someone around the rim. "Spin only" just picks a person; "Truth or Dare"
// then lets them choose Truth, Dare, Random or a Task and draws a card from the Tasks app's pool
// (apps/tasks-store.js — respects its All / This session filter, tags and the 18+ setting), with scores.
// Options: "Chicken = do a task" (chickening out flips the card to a penalty task — from the Tasks pool or a short
// built-in list; refusing that too is a double chicken) and 18+ mode (age check once; mixed or adult-only cards).
import { clear } from '../js/ui/dom.js';
import { toLocal, localRect } from '../js/core/util.js';
import { themeEvents } from '../js/core/theme.js';
import { THEME, TAU, clamp } from '../games/kit.js';
import * as T from './tasks-store.js';

const { TYPE_META } = T;
const MIN_SPIN = 12, MAX_SPIN = 30;        // rad/s right after a counted spin
const FRICTION_K = 1.6, FRICTION_V = 0.55;  // constant + speed-proportional slow-down
const DEFAULT_PLAYERS = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
const PENALTY_COLOR = '#fb923c';

// built-in penalties for chickening out (the "Penalty list" source, and the fallback when the Tasks pool is empty)
const PENALTIES = {
  en: ['Sing a song the group picks — at least the chorus.', 'Do 10 push-ups.', 'Speak in an accent of the group’s choice for 2 rounds.',
    'Do 20 jumping jacks.', 'Do the chicken dance for 15 seconds.', 'Let the group give you a silly nickname for the rest of the game.',
    'Talk like a robot until your next turn.', 'Tell the group an embarrassing story.', 'Hold a plank for 30 seconds.',
    'Compliment every player, one by one.', 'Cluck like a chicken every time you speak until your next turn.', 'Do your best opera singing for 15 seconds.',
    'Stand on one leg until your next turn.', 'Do an impression of the player on your right.'],
  he: ['שיר שיר שהקבוצה בוחרת — לפחות את הפזמון.', 'עשה 10 שכיבות סמיכה.', 'דבר במבטא שהקבוצה בוחרת במשך שני סיבובים.',
    'עשה 20 קפיצות פיסוק.', 'רקוד את ריקוד התרנגולת 15 שניות.', 'תן לקבוצה לבחור לך כינוי מצחיק לשאר המשחק.',
    'דבר כמו רובוט עד התור הבא שלך.', 'ספר לקבוצה סיפור מביך.', 'החזק פלאנק 30 שניות.', 'תן מחמאה לכל שחקן, אחד אחד.'],
};
const PENALTIES_18 = {
  en: ['Take a sip of your drink.', 'Take two sips.', 'Finish your drink — or a glass of water.', 'Let the group pick your next drink.',
    'Take a sip, then toast the player who dared you.', 'Take a sip without using your hands.'],
  he: ['קח שלוק מהמשקה שלך.', 'קח שני שלוקים.', 'סיים את המשקה שלך — או כוס מים.', 'תן לקבוצה לבחור לך את המשקה הבא.', 'קח שלוק והרם כוסית לכבוד מי שאתגר אותך.'],
};

export default {
  css: './bottle.css',
  create(el, app) {
    const { h, icon } = app;
    app.hideTitle();
    el.classList.add('bt');

    // ------------------------------------------------------------ state
    let players = app.data('players', DEFAULT_PLAYERS).slice(0, 12);
    if (players.length < 2) players = DEFAULT_PLAYERS.slice();
    let noNames = app.data('noNames', false);
    let mode = app.data('mode', 'tod');          // 'spin' | 'tod'
    let showScores = app.data('showScores', true);
    let scores = app.data('scores', {});         // name → { done, chicken, double, paid }
    let chickenTask = app.data('chickenTask', false);  // chickening out → a penalty task
    let penaltySrc = app.data('penaltySrc', 'tasks');  // 'tasks' (the Tasks pool) | 'list' (built-in penalties)
    let lastPenalty = '';
    const used = new Set();
    let theta = app.data('angle', 0.35);         // bottle angle: 0 = neck up, clockwise (radians)
    let omega = 0, spinning = false, counted = false, peak = 0;
    let drag = null, result = null, resultAt = 0, lastSlice = null, lastTick = 0;
    let overlay = null;                          // 'choose' | 'card' | null
    let dirty = true;

    // ------------------------------------------------------------ DOM
    const cv = h('canvas.bt-cv');
    const g = cv.getContext('2d');
    const ring = h('div.bt-ring');
    const modeSeg = h('div.bt-mode', { role: 'tablist' });
    const hint = h('div.bt-hint');
    const btnPlayers = h('button.bt-ib', { type: 'button', 'aria-label': 'Players', onclick: () => openPlayers() }, h('i', { html: icon('people') }));
    const btnScores = h('button.bt-ib', { type: 'button', 'aria-label': 'Scores', onclick: () => openScores() }, h('i', { html: icon('star') }));
    const btnSet = h('button.bt-ib', { type: 'button', 'aria-label': 'Settings', onclick: () => openSettings() }, h('i', { html: icon('settings') }));
    const tools = h('div.bt-tools', btnPlayers, btnScores, btnSet);
    const layer = h('div.bt-layer');
    el.append(cv, ring, modeSeg, hint, tools, layer);

    let S = 720, dpr = 1;
    const ro = new ResizeObserver(() => resize());
    ro.observe(el);
    function resize() {
      S = Math.max(100, Math.min(el.clientWidth, el.clientHeight));  // layout size (not affected by the screen's zoom-in transition)
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr);
      cv.style.width = cv.style.height = S + 'px';
      dirty = true;
    }
    resize();

    // ------------------------------------------------------------ players around the rim
    const n = () => (noNames ? 0 : players.length);
    const slice = (a) => { const k = n(); if (!k) return null; const d = ((a % TAU) + TAU) % TAU; return Math.floor(d / (TAU / k)) % k; };
    const playerAngle = (i) => (i + 0.5) * (TAU / n());
    const pColor = (i) => THEME.pieces[i % THEME.pieces.length];

    function renderRing() {
      clear(ring);
      const k = n();
      el.classList.toggle('no-names', !k);
      if (!k) return;
      const sz = k <= 4 ? 14 : k <= 6 ? 13 : k <= 8 ? 12 : 11;
      ring.style.setProperty('--sz', sz + 'cqmin');
      players.forEach((name, i) => {
        const a = playerAngle(i);
        const sc = scores[name];
        const b = h(`button.bt-p${result === i ? '.on' : ''}`, {
          type: 'button', '--pc': pColor(i), 'aria-label': `Player ${name}`, dataset: { i },
          style: { left: `${50 + 39 * Math.sin(a)}%`, top: `${50 - 39 * Math.cos(a)}%` },
          onclick: () => { if (!spinning && !overlay) renamePlayer(i); },
        }, h('span.bt-p-n', { dir: 'auto', '--fs': fontFor(name) }, name),
        mode === 'tod' && showScores && sc?.done ? h('span.bt-p-s', String(sc.done)) : null);
        ring.append(b);
      });
    }
    // shrink long names so the longest word fits on one line (two lines at most)
    const meas = document.createElement('canvas').getContext('2d');
    function fontFor(name) {
      meas.font = `700 100px ${getComputedStyle(el).fontFamily || THEME.font}`;
      const words = String(name).split(/\s+/);
      const wWord = Math.max(...words.map((w) => meas.measureText(w).width)) / 100;  // em
      const wAll = meas.measureText(String(name)).width / 100;
      const inner = 0.78;                                  // usable width, in bubble sizes
      return String(Math.max(0.14, Math.min(0.22, inner / Math.max(wWord, 0.1), (inner * 1.9) / Math.max(wAll, 0.1))).toFixed(3));
    }
    function renderMode() {
      clear(modeSeg);
      for (const [id, label] of [['spin', 'Spin'], ['tod', 'Truth or Dare']]) {
        modeSeg.append(h(`button${mode === id ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(mode === id),
          onclick: () => { if (mode !== id && !overlay) { mode = id; app.save('mode', id); app.sfx('tick'); render(); } } }, label));
      }
      if (T.settings().adult) modeSeg.append(h('span.bt-18', { title: T.settings().mix === 'only' ? '18+ cards only' : '18+ cards mixed in', 'aria-label': '18+ mode on' }, '18+'));
      btnScores.hidden = mode !== 'tod' || noNames || !showScores;
    }
    function setHint(text, strong = false) { hint.textContent = text; hint.classList.toggle('strong', strong); }
    function idleHint() { setHint(spinCount ? '' : 'Flick or tap the bottle to spin'); }
    let spinCount = 0;
    function render() { renderRing(); renderMode(); dirty = true; }

    // ------------------------------------------------------------ spin physics
    function startSpin(w) {
      if (overlay) return;
      const dir = Math.sign(w) || 1;
      omega = dir * clamp(Math.abs(w), MIN_SPIN, MAX_SPIN) * (0.94 + Math.random() * 0.12);
      spinning = true; counted = true; peak = Math.abs(omega);
      result = null; renderRing(); setHint('');
      app.sfx('whoosh'); app.vibrate(18);
    }
    function nudge(dir) {           // knob / arrow keys: each step adds speed; turn it fast to spin
      if (overlay || drag) return;
      omega += dir * 2.8;
      omega = clamp(omega, -MAX_SPIN, MAX_SPIN);
      if (!spinning) { spinning = true; counted = false; peak = 0; result = null; renderRing(); setHint(''); }
      peak = Math.max(peak, Math.abs(omega));
      if (peak >= 8) counted = true;
    }
    function tick(dt) {
      if (spinning) {
        const before = theta;
        const s = Math.sign(omega);
        const dec = (FRICTION_K + FRICTION_V * Math.abs(omega)) * dt;
        omega = Math.abs(omega) <= dec ? 0 : omega - s * dec;
        theta += omega * dt;
        tickSound(before, theta);
        if (!omega) stopSpin();
        dirty = true;
      }
      if (result !== null || (noNames && resultAt)) { if (performance.now() - resultAt < 4000) dirty = true; }
      if (dirty) { draw(); dirty = false; }
    }
    function tickSound(a0, a1) {
      const k = n() || 12;  // without names: a click every 30°
      const s0 = Math.floor(a0 / (TAU / k)), s1 = Math.floor(a1 / (TAU / k));
      if (s0 !== s1) {
        const now = performance.now();
        if (now - lastTick > 45) { app.sfx('tick', { volume: 0.7 }); lastTick = now; if (Math.abs(omega) < 6) app.vibrate(4); }
      }
    }
    function stopSpin() {
      spinning = false;
      theta = ((theta % TAU) + TAU) % TAU;
      app.save('angle', theta);
      if (!counted) { setHint(peak > 0 ? 'Turn it faster to spin!' : 'Flick it harder!'); dirty = true; return; }
      spinCount++;
      resultAt = performance.now();
      result = slice(theta);
      app.sfx('pop'); app.vibrate(30);
      renderRing();
      const who = result === null ? null : players[result];
      if (mode === 'spin') { setHint(who ? `${who}!` : 'This way!', true); return; }
      setTimeout(() => { if (!spinning && !overlay) openChooser(); }, 650);
      setHint(who ? `${who}!` : 'You!', true);
    }

    // ------------------------------------------------------------ drag / flick
    // points in the app's own frame (it may be turned: js/core/orientation.js)
    const center = () => { const r = localRect(cv); return [r.left + r.width / 2, r.top + r.height / 2, r.width]; };
    const angleAt = (x, y) => { const [cx, cy] = center(); return Math.atan2(x - cx, -(y - cy)); };
    cv.addEventListener('pointerdown', (e) => {
      if (overlay || e.button > 0) return;
      const [cx, cy, w] = center();
      const [x, y] = toLocal(e.clientX, e.clientY);
      if (Math.hypot(x - cx, y - cy) > w * 0.36) return;
      if (spinning && Math.abs(omega) > 4) return;  // let it spin
      spinning = false; omega = 0;
      const a = angleAt(x, y);
      drag = { id: e.pointerId, a0: a, last: a, unwrapped: 0, theta0: theta, x, y, moved: 0, samples: [[e.timeStamp, 0]] };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const [x, y] = toLocal(e.clientX, e.clientY);
      const a = angleAt(x, y);
      let d = a - drag.last; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
      drag.last = a; drag.unwrapped += d;
      drag.moved = Math.max(drag.moved, Math.hypot(x - drag.x, y - drag.y));
      const before = theta;
      theta = drag.theta0 + drag.unwrapped;
      tickSound(before, theta);
      const now = e.timeStamp;  // input time (not when we got round to handling it)
      drag.samples.push([now, drag.unwrapped]);
      while (drag.samples.length > 2 && now - drag.samples[0][0] > 130) drag.samples.shift();
      if (drag.moved > 6 && result !== null) { result = null; renderRing(); }
      dirty = true;
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      if (d.moved < 8) { startSpin((Math.random() < 0.5 ? -1 : 1) * (MIN_SPIN + Math.random() * 10)); return; }  // a tap spins too
      const now = e.timeStamp;
      const s = d.samples.filter(([t]) => now - t < 140);
      let w = 0;
      if (s.length >= 2) { const [t0, u0] = s[0], [t1, u1] = s[s.length - 1]; if (t1 > t0) w = ((u1 - u0) / (t1 - t0)) * 1000; }
      if (Math.abs(w) >= 3) startSpin(w * 1.15);
      else { setHint('Flick it harder!'); dirty = true; }
    };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);

    // ------------------------------------------------------------ drawing
    function draw() {
      const C = S / 2;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, S, S);
      const k = n();
      const rimR = S * 0.478, tableR = S * 0.3;
      // table
      g.beginPath(); g.arc(C, C, tableR, 0, TAU);
      g.fillStyle = THEME.ink(THEME.light ? 0.045 : 0.035); g.fill();
      g.lineWidth = Math.max(1, S * 0.002); g.strokeStyle = THEME.line; g.stroke();
      // rim track + slices
      g.beginPath(); g.arc(C, C, rimR, 0, TAU);
      g.lineWidth = S * 0.012; g.strokeStyle = THEME.ink(0.07); g.stroke();
      const ang = (a) => a - Math.PI / 2;  // our 0 = up → canvas angle
      if (k) {
        g.lineWidth = Math.max(1, S * 0.0022); g.strokeStyle = THEME.ink(0.09);
        for (let i = 0; i < k; i++) {
          const a = i * (TAU / k);
          g.beginPath(); g.moveTo(C + Math.sin(a) * tableR, C - Math.cos(a) * tableR); g.lineTo(C + Math.sin(a) * (rimR - S * 0.01), C - Math.cos(a) * (rimR - S * 0.01)); g.stroke();
        }
        for (let i = 0; i < k; i++) {  // a little colour mark per player on the rim
          const a0 = i * (TAU / k), a1 = (i + 1) * (TAU / k);
          g.beginPath(); g.arc(C, C, rimR, ang(a0) + 0.02, ang(a1) - 0.02);
          g.lineWidth = S * 0.012; g.strokeStyle = withAlpha(pColor(i), result === i ? 1 : 0.28); g.stroke();
        }
      } else {
        g.lineWidth = Math.max(1, S * 0.003); g.strokeStyle = THEME.ink(0.14);
        for (let i = 0; i < 48; i++) {
          const a = i * (TAU / 48), r0 = rimR - S * (i % 4 ? 0.012 : 0.024);
          g.beginPath(); g.moveTo(C + Math.sin(a) * r0, C - Math.cos(a) * r0); g.lineTo(C + Math.sin(a) * (rimR - S * 0.004), C - Math.cos(a) * (rimR - S * 0.004)); g.stroke();
        }
      }
      // the chosen edge
      const pulse = 0.5 + 0.5 * Math.sin((performance.now() - resultAt) / 180);
      const fresh = clamp(1 - (performance.now() - resultAt) / 4000, 0, 1);
      if (!spinning && !drag && resultAt && (result !== null || !k)) {
        let a0, a1, col;
        if (k && result !== null) { a0 = result * (TAU / k); a1 = (result + 1) * (TAU / k); col = pColor(result); }
        else if (!k) { a0 = theta - 0.26; a1 = theta + 0.26; col = THEME.c1; }
        if (col) {
          g.beginPath(); g.moveTo(C, C); g.arc(C, C, rimR - S * 0.006, ang(a0), ang(a1)); g.closePath();
          const grad = g.createRadialGradient(C, C, tableR * 0.6, C, C, rimR);
          grad.addColorStop(0, withAlpha(col, 0)); grad.addColorStop(1, withAlpha(col, 0.16 + 0.12 * pulse * fresh));
          g.fillStyle = grad; g.fill();
          g.beginPath(); g.arc(C, C, rimR, ang(a0) + 0.01, ang(a1) - 0.01);
          g.lineWidth = S * (0.016 + 0.006 * pulse * fresh); g.strokeStyle = col; g.lineCap = 'round'; g.stroke(); g.lineCap = 'butt';
        }
      }
      // where the neck points right now
      g.beginPath(); g.arc(C, C, rimR, ang(theta) - 0.045, ang(theta) + 0.045);
      g.lineWidth = S * 0.02; g.lineCap = 'round'; g.strokeStyle = THEME.ink(spinning || drag ? 0.75 : 0.55); g.stroke(); g.lineCap = 'butt';
      drawBottle(C, C, S * 0.36, theta);
    }

    function bottlePath(L) {
      const bw = 0.15 * L, nw = 0.055 * L, lw = 0.072 * L, rr = 0.06 * L;
      const yb = 0.5 * L, ys = -0.04 * L, yn = -0.25 * L, yl = -0.44 * L, yt = -0.5 * L;
      const p = new Path2D();
      p.moveTo(-bw + rr, yb); p.lineTo(bw - rr, yb); p.quadraticCurveTo(bw, yb, bw, yb - rr);
      p.lineTo(bw, ys); p.bezierCurveTo(bw, ys - 0.12 * L, nw, yn + 0.07 * L, nw, yn);
      p.lineTo(nw, yl); p.lineTo(lw, yl); p.quadraticCurveTo(lw + 0.008 * L, yl, lw + 0.008 * L, yl - 0.012 * L);
      p.lineTo(lw + 0.008 * L, yt + 0.012 * L); p.quadraticCurveTo(lw + 0.008 * L, yt, lw, yt);
      p.lineTo(-lw, yt); p.quadraticCurveTo(-lw - 0.008 * L, yt, -lw - 0.008 * L, yt + 0.012 * L);
      p.lineTo(-lw - 0.008 * L, yl - 0.012 * L); p.quadraticCurveTo(-lw - 0.008 * L, yl, -lw, yl);
      p.lineTo(-nw, yl); p.lineTo(-nw, yn); p.bezierCurveTo(-nw, yn + 0.07 * L, -bw, ys - 0.12 * L, -bw, ys);
      p.lineTo(-bw, yb - rr); p.quadraticCurveTo(-bw, yb, -bw + rr, yb); p.closePath();
      return { p, bw, nw, lw, yb, ys, yn, yl, yt };
    }
    let pathCache = null;
    function drawBottle(x, y, L, a) {
      if (!pathCache || pathCache.L !== L) pathCache = { L, ...bottlePath(L) };
      const { p, bw, nw, yb, ys, yn, yl, yt } = pathCache;
      const glass = THEME.c1, label = THEME.c2;
      // shadow (fixed light from the top-left)
      g.save(); g.translate(x + L * 0.025, y + L * 0.045); g.rotate(a);
      g.fillStyle = THEME.shade(THEME.light ? 0.16 : 0.45); g.fill(p); g.restore();
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = glass; g.fill(p);
      g.save(); g.clip(p);
      // flat two-tone shading, rotating with the bottle
      g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(bw * 0.28, yt, bw, yb - yt);
      // label band
      const ly0 = 0.05 * L, ly1 = 0.29 * L;
      g.fillStyle = label; g.fillRect(-bw, ly0, bw * 2, ly1 - ly0);
      g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(bw * 0.28, ly0, bw, ly1 - ly0);
      g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(-bw, ly0 + 0.012 * L, bw * 2, 0.008 * L); g.fillRect(-bw, ly1 - 0.02 * L, bw * 2, 0.008 * L);
      // a question mark on the label
      g.save(); g.translate(0, (ly0 + ly1) / 2);
      g.fillStyle = 'rgba(255,255,255,.92)'; g.font = `800 ${0.12 * L}px ${THEME.display}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('?', 0, 0.006 * L); g.restore();
      // the lip
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(-bw, yt, bw * 2, yl - yt);
      // highlights
      g.fillStyle = 'rgba(255,255,255,.38)';
      roundRect(g, -bw + 0.035 * L, ys - 0.01 * L, 0.032 * L, ly0 - ys - 0.03 * L, 0.016 * L); g.fill();
      roundRect(g, -bw + 0.035 * L, ly1 + 0.025 * L, 0.032 * L, yb - ly1 - 0.075 * L, 0.016 * L); g.fill();
      roundRect(g, -nw + 0.016 * L, yl + 0.02 * L, 0.022 * L, yn - yl - 0.01 * L, 0.011 * L); g.fill();
      g.restore();
      g.lineWidth = Math.max(1, L * (THEME.id === 'bauhaus' ? 0.012 : 0.006));
      g.strokeStyle = THEME.id === 'bauhaus' ? THEME.fg : THEME.shade(THEME.light ? 0.28 : 0.5); g.stroke(p);
      // pointer tip beyond the neck
      g.beginPath(); g.moveTo(0, yt - 0.11 * L); g.lineTo(0.035 * L, yt - 0.04 * L); g.lineTo(-0.035 * L, yt - 0.04 * L); g.closePath();
      g.fillStyle = THEME.fg; g.fill();
      g.restore();
    }

    // ------------------------------------------------------------ truth or dare: choose → card
    const playerName = () => (result !== null && !noNames ? players[result] : null);
    let focusables = [], focusIdx = 0;
    function setFocus(list, i = 0) { focusables = list; focusIdx = i; focusables.forEach((b, j) => b.classList.toggle('kf', j === i)); }
    function moveFocus(d) { if (!focusables.length) return; focusIdx = (focusIdx + d + focusables.length) % focusables.length; setFocus(focusables, focusIdx); app.sfx('tick'); }

    function openChooser() {
      overlay = 'choose';
      clear(layer);
      const who = playerName();
      const btn = (type, cls) => h(`button.bt-ch.${cls}`, { type: 'button', '--k': type === 'random' ? 'var(--ac)' : TYPE_META[type].color, onclick: () => draw4(type) },
        type === 'random' ? 'Random' : TYPE_META[type].name);
      const bT = btn('truth', 'big'), bD = btn('dare', 'big'), bR = btn('random', 'small'), bK = btn('task', 'small');
      const box = h('div.bt-choose', { '--pc': result !== null && !noNames ? pColor(result) : 'var(--ac)' },
        h('div.bt-choose-who', { dir: 'auto' }, who || 'You!'),
        h('div.bt-choose-q', 'Truth or dare?'),
        h('div.bt-choose-row', bT, bD), h('div.bt-choose-row', bR, bK),
        h('button.bt-cancel', { type: 'button', 'aria-label': 'Cancel', onclick: () => closeOverlay(), html: icon('close') }));
      layer.append(box);
      el.classList.add('has-overlay');
      setFocus([bT, bD, bR, bK], 0);
    }
    function draw4(type) {
      const got = T.pick(type, used);
      showCard(type, got);
    }
    function showCard(asked, got) {
      overlay = 'card';
      clear(layer);
      const who = playerName();
      const t = got?.type || (asked === 'random' ? 'truth' : asked);
      const meta = TYPE_META[t];
      if (got) used.add(got.item.id);
      const text = got?.item.text || '';
      const long = text.length > 140 ? 'xl' : text.length > 80 ? 'l' : '';
      const done = h('button.pill.primary.bt-done', { type: 'button', onclick: () => finish('done') }, 'Done');
      const chicken = h('button.pill.bt-chicken', { type: 'button', onclick: () => finish('chicken') }, 'Chicken');
      const again = h('button.bt-again', { type: 'button', 'aria-label': 'Another one', title: 'Another one', onclick: () => { app.sfx('tap'); showCard(asked, T.pick(asked === 'random' ? 'random' : t, used)); }, html: icon('refresh') });
      const card = h(`div.bt-card.${t}`, { '--k': meta.color },
        h('div.bt-card-h', h('span.bt-card-type', meta.name, got && T.isAdult(got.item) ? h('b.bt-card-18', '18+') : null), who ? h('span.bt-card-for', { dir: 'auto' }, `for ${who}`) : null),
        got ? h(`div.bt-card-t${long ? '.' + long : ''}`, { dir: 'auto' }, text)
          : h('div.bt-card-t.empty', `No ${meta.plural.toLowerCase()} to draw from`, h('small', T.settings().tags.length ? 'Try other tags, add some in the Tasks app, or switch the filter to All.' : 'Add some in the Tasks app, or switch the filter to All.')),
        got?.item.author ? h('div.bt-card-by', { dir: 'auto' }, `added by ${got.item.author}`) : null,
        got?.fellBack ? h('div.bt-card-note', 'Nothing in this session yet — from all') : null,
        got ? h('div.bt-card-acts', chicken, done, again)
          : h('div.bt-card-acts', h('button.pill', { type: 'button', onclick: () => app.go('app', { id: 'tasks' }) }, 'Open Tasks'), h('button.pill.primary', { type: 'button', onclick: () => closeOverlay() }, 'OK')));
      layer.append(card);
      el.classList.add('has-overlay');
      app.sfx('coin'); app.vibrate(12);
      if (got) setFocus([done, chicken, again], 0); else setFocus([...card.querySelectorAll('.pill')], 1);
    }
    function addScore(key) {
      const who = playerName();
      if (!who || mode !== 'tod') return;
      const s = { done: 0, chicken: 0, double: 0, paid: 0, ...(scores[who] || {}) };
      s[key] = (s[key] || 0) + 1;
      scores = { ...scores, [who]: s };
      app.save('scores', scores);
    }
    function finish(how) {
      const who = playerName();
      addScore(how === 'done' ? 'done' : 'chicken');
      if (how === 'done') { app.sfx('score'); app.vibrate(20); closeOverlay(); return; }
      app.sfx('over', { volume: 0.7 }); app.vibrate([20, 60, 20]);
      if (chickenTask) { showPenalty(); return; }
      app.toast(`${who || 'Someone'} chickened out!`);
      closeOverlay();
    }

    // ------------------------------------------------------------ chickened out → penalty task
    function penaltyList() {
      const { packs, adult } = T.settings();
      const langs = ['en', 'he'].filter((l) => packs[l]);
      if (!langs.length) langs.push('en');
      return langs.flatMap((l) => [...PENALTIES[l], ...(adult ? PENALTIES_18[l] : [])]);
    }
    function drawPenalty() {
      if (penaltySrc === 'tasks') {
        const got = T.pick('task', used);
        if (got) { used.add(got.item.id); return { text: got.item.text, item: got.item, fellBack: got.fellBack }; }
      }
      const list = penaltyList().filter((t) => t !== lastPenalty);
      return { text: list[Math.floor(Math.random() * list.length)], builtin: true, noPool: penaltySrc === 'tasks' };
    }
    function showPenalty(p = drawPenalty()) {
      overlay = 'card';
      clear(layer);
      lastPenalty = p.text;
      const who = playerName();
      const long = p.text.length > 140 ? 'xl' : p.text.length > 80 ? 'l' : '';
      const adult = p.item ? T.isAdult(p.item) : PENALTIES_18.en.includes(p.text) || PENALTIES_18.he.includes(p.text);
      const done = h('button.pill.primary.bt-done', { type: 'button', onclick: () => finishPenalty('paid') }, 'Done');
      const still = h('button.pill.bt-chicken', { type: 'button', onclick: () => finishPenalty('double') }, 'Still chicken');
      const again = h('button.bt-again', { type: 'button', 'aria-label': 'Another penalty', title: 'Another penalty', onclick: () => { app.sfx('tap'); showPenalty(); }, html: icon('refresh') });
      const card = h('div.bt-card.penalty', { '--k': PENALTY_COLOR },
        h('div.bt-card-h', h('span.bt-card-type', 'Penalty', adult ? h('b.bt-card-18', '18+') : null),
          h('span.bt-card-for', { dir: 'auto' }, who ? `${who} chickened out` : 'Chickened out')),
        h(`div.bt-card-t${long ? '.' + long : ''}`, { dir: 'auto' }, p.text),
        p.item?.author ? h('div.bt-card-by', { dir: 'auto' }, `added by ${p.item.author}`) : null,
        p.noPool ? h('div.bt-card-note', 'No tasks to draw from — a classic penalty') : p.fellBack ? h('div.bt-card-note', 'Nothing in this session yet — from all') : null,
        h('div.bt-card-acts', still, done, again));
      layer.append(card);
      el.classList.add('has-overlay');
      app.vibrate(12);
      setFocus([done, still, again], 0);
    }
    function finishPenalty(how) {
      const who = playerName();
      addScore(how);
      if (how === 'paid') { app.sfx('score'); app.vibrate(20); app.toast(`Penalty done — ${who || 'they'}’re off the hook`); }
      else { app.sfx('over', { volume: 0.8 }); app.vibrate([30, 60, 30, 60, 30]); app.toast(`${who || 'Someone'} is a double chicken!`); }
      closeOverlay();
    }
    function closeOverlay() {
      overlay = null; focusables = [];
      const kids = [...layer.children];
      kids.forEach((k) => k.classList.add('out'));
      setTimeout(() => kids.forEach((k) => k.remove()), 260);
      el.classList.remove('has-overlay');
      renderRing();
      setHint('Spin again!');
    }

    // ------------------------------------------------------------ panels
    function renamePlayer(i) {
      app.editText({ title: `Player ${i + 1}`, value: players[i], placeholder: 'Name', okLabel: 'Save' }).then((v) => {
        if (!v) return;
        const old = players[i];
        players = players.map((p, j) => (j === i ? v.slice(0, 24) : p));
        if (scores[old]) { const { [old]: s, ...rest } = scores; scores = { ...rest, [players[i]]: s }; app.save('scores', scores); }
        app.save('players', players); render();
      });
    }
    function openPlayers() {
      app.openPanel({
        title: 'Players', className: 'bt-panel',
        build(body, panel) {
          const box = h('div.bt-plist.list');
          body.append(box);
          const drawP = () => {
            clear(box);
            box.append(h('div.bt-row', h('div.bt-row-l', h('div', 'No names'), h('div.bt-row-sub', 'The bottle just points at someone in the room')),
              h(`button.switch${noNames ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(noNames), 'aria-label': 'No names', onclick: () => { noNames = !noNames; app.save('noNames', noNames); result = null; resultAt = 0; drawP(); render(); } })));
            if (!noNames) {
              players.forEach((name, i) => {
                box.append(h('div.bt-prow', { '--pc': pColor(i) },
                  h('span.bt-dot'),
                  h('button.bt-prow-n', { type: 'button', dir: 'auto', onclick: async () => { panel.close(); renamePlayer(i); } }, name),
                  h('button.bt-x', { type: 'button', 'aria-label': `Remove ${name}`, disabled: players.length <= 2, html: icon('close'),
                    onclick: () => { players = players.filter((_, j) => j !== i); app.save('players', players); result = null; drawP(); render(); } })));
              });
              box.append(h('button.pill.primary.bt-addp', { type: 'button', disabled: players.length >= 12, onclick: async () => {
                const v = await app.editText({ title: 'New player', placeholder: 'Name', okLabel: 'Add' });
                if (!v) return;
                players = [...players, v.slice(0, 24)]; app.save('players', players); result = null; drawP(); render();
              } }, players.length >= 12 ? '12 players max' : 'Add player'));
            }
          };
          drawP();
        },
      });
    }
    function openScores() {
      app.openPanel({
        title: 'Scores', className: 'bt-panel',
        build(body, panel) {
          const box = h('div.bt-plist.list');
          body.append(box);
          const drawS = () => {
            clear(box);
            const rows = players.map((name, i) => ({ name, i, done: 0, chicken: 0, double: 0, paid: 0, ...(scores[name] || {}) }))
              .sort((a, b) => b.done - a.done || (a.chicken + a.double) - (b.chicken + b.double) || b.paid - a.paid);
            const dbl = chickenTask || rows.some((r) => r.double || r.paid);
            box.classList.toggle('dbl', dbl);
            box.append(h('div.bt-shead', h('span'), h('span', 'Done'), h('span', 'Chicken'), dbl ? h('span', { title: 'Refused the penalty too' }, 'Double') : null));
            rows.forEach((r, rank) => box.append(h(`div.bt-srow${rank === 0 && r.done ? '.lead' : ''}`, { '--pc': pColor(r.i) },
              h('span.bt-srow-n', h('span.bt-dot'), h('span', { dir: 'auto' }, r.name)), h('b', String(r.done)),
              h('span.bt-ch-n', String(r.chicken), r.paid ? h('small', { title: 'Penalties done' }, ` ✓${r.paid}`) : null),
              dbl ? h(`span.bt-ch-n${r.double ? '.bt-dbl' : ''}`, String(r.double)) : null)));
            if (dbl) box.append(h('div.bt-row-sub.bt-center', '✓ penalties done · Double = refused the penalty too'));
            box.append(h('button.pill.danger.bt-addp', { type: 'button', onclick: () => { scores = {}; app.save('scores', scores); used.clear(); drawS(); render(); app.toast('Scores reset'); } }, 'Reset scores'));
          };
          drawS();
        },
      });
    }
    function openSettings() {
      app.openPanel({
        title: 'Truth or Dare', className: 'bt-panel',
        build(body, panel) {
          const box = h('div.bt-plist.list');
          body.append(box);
          const sw = (on, fn, label) => h(`button.switch${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: fn });
          const drawSet = () => {
            clear(box);
            const s = T.settings(), c = T.counts(T.gameOpts());
            const chip = (on, label, fn) => h(`button.chip${on ? '.on' : ''}`, { type: 'button', onclick: fn }, label);
            box.append(...[   // (filter: a bare null would show up as the text "null")
              h('div.bt-sh', 'Mode'),
              h('div.chips', chip(mode === 'spin', 'Spin only', () => { mode = 'spin'; app.save('mode', mode); render(); drawSet(); }), chip(mode === 'tod', 'Truth or Dare', () => { mode = 'tod'; app.save('mode', mode); render(); drawSet(); })),
              h('div.bt-sh', 'Cards from'),
              h('div.chips', chip(s.filter === 'all', 'All', () => { T.setSettings({ filter: 'all' }); drawSet(); }), chip(s.filter === 'session', `This session (${T.session().id})`, () => { T.setSettings({ filter: 'session' }); drawSet(); })),
              h('div.bt-row-sub.bt-center', `${c.truth} truths · ${c.dare} dares · ${c.task} tasks`),
              h('div.bt-sh', 'Tags'),
              h('div.chips.multi', ['family', 'party', 'funny', 'active'].map((t) => chip(s.tags.includes(t), T.TAG_NAMES[t], () => {
                const set = new Set(s.tags); set.has(t) ? set.delete(t) : set.add(t); set.delete('18+'); T.setSettings({ tags: [...set] }); drawSet();
              }))),
              h('div.bt-row-sub.bt-center', s.tags.length ? `Only cards with these tags${s.adult && s.tags.includes('family') ? ' (Family hides 18+)' : ''}` : 'None picked = any tag'),
              h('div.bt-sh', 'Grown-ups'),
              h(`div.bt-row${s.adult ? '.bt-x18' : ''}`, h('span.bt-18.lg', '18+'), h('div.bt-row-l', h('div', '18+ mode'), h('div.bt-row-sub', s.adult ? 'Flirty, party & drinking cards' : 'Off — family friendly')),
                sw(s.adult, async () => {
                  if (!s.adult && !(await T.confirmAdult(app))) return;
                  T.setSettings(s.adult ? { adult: false, tags: s.tags.filter((t) => t !== '18+') } : { adult: true, tags: s.tags.filter((t) => t !== '18+') });
                  app.sfx('tick'); drawSet();
                }, '18+ mode')),
              s.adult ? h('div.chips', chip(s.mix === 'mixed', 'Mixed in', () => { T.setSettings({ mix: 'mixed' }); drawSet(); }), chip(s.mix === 'only', '18+ only', () => { T.setSettings({ mix: 'only' }); drawSet(); })) : null,
              h('div.bt-sh', 'Chicken'),
              h('div.bt-row', h('div.bt-row-l', h('div', 'Chicken = do a task'), h('div.bt-row-sub', chickenTask ? 'Chickening out flips to a penalty' : 'Off — chickening out just counts')),
                sw(chickenTask, () => { chickenTask = !chickenTask; app.save('chickenTask', chickenTask); drawSet(); }, 'Chicken = do a task')),
              chickenTask ? h('div.bt-sh.sub', 'Penalty from') : null,
              chickenTask ? h('div.chips', chip(penaltySrc === 'tasks', 'Tasks pool', () => { penaltySrc = 'tasks'; app.save('penaltySrc', penaltySrc); drawSet(); }),
                chip(penaltySrc === 'list', 'Penalty list', () => { penaltySrc = 'list'; app.save('penaltySrc', penaltySrc); drawSet(); })) : null,
              chickenTask ? h('div.bt-row-sub.bt-center', penaltySrc === 'tasks' ? `A task from the pool (${c.task})` : `Sing a song, 10 push-ups, an accent…${s.adult ? ' or a sip' : ''}`) : null,
              h('div.bt-sh', 'Score'),
              h('div.bt-row', h('div.bt-row-l', h('div', 'Keep score'), h('div.bt-row-sub', 'Points for every truth or dare done')),
                sw(showScores, () => { showScores = !showScores; app.save('showScores', showScores); render(); drawSet(); }, 'Keep score')),
              h('button.pill.bt-addp', { type: 'button', onclick: () => app.go('app', { id: 'tasks' }) }, 'Manage truths & dares'),
            ].filter(Boolean));
          };
          drawSet();
          panel.onDestroy = T.events.on('change', () => { if (!panel.closed) drawSet(); });
        },
      });
    }

    // ------------------------------------------------------------ keys / knob
    app.onKey((e) => {
      if (document.querySelector('.panel')) return;
      const k = e.key;
      if (overlay) {
        if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
        else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
        else if (k === 'Enter' || k === ' ') { e.preventDefault(); focusables[focusIdx]?.click(); }
        return;
      }
      if (k === 'Enter' || k === ' ') { e.preventDefault(); if (!spinning) startSpin((Math.random() < 0.5 ? -1 : 1) * (MIN_SPIN + Math.random() * 12)); }
      else if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); nudge(1); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); nudge(-1); }
    });

    const offs = [
      themeEvents.on('change', () => { dirty = true; render(); }),
      T.events.on('change', () => renderMode()),
      T.events.on('fresh', (items) => { const it = items[items.length - 1]; app.toast(`${it.author || 'Someone'} added a ${TYPE_META[it.type]?.name.toLowerCase() || 'task'}`); }),
      T.startSync({ every: 4000, passive: true }),
    ];
    app.raf((dt) => tick(dt));
    render(); idleHint();

    // test hook (Playwright): spin with a given speed
    el._bt = { spin: (w) => startSpin(w), state: () => ({ theta, omega, spinning, result, overlay, players: players.slice(), scores, mode, noNames, chickenTask, penaltySrc }) };

    return {
      destroy() { ro.disconnect(); for (const off of offs) off(); app.save('angle', ((theta % TAU) + TAU) % TAU); },
      back() { if (overlay) { closeOverlay(); return true; } return false; },
    };
  },
};

function withAlpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (h < 0) { y += h; h = -h; }
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
