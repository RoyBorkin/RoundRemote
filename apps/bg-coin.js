// Board Games → Coin: a gold coin that tosses and spins in 3D (CSS transforms), with stats, streaks and best-of-N.
import { h } from '../js/ui/dom.js';
import { seg, celebrate } from './bg-ui.js';
import { rnd } from './bg-dice-engine.js';

const ridge = (r, n) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return `M${50 + Math.cos(a) * (r - 3.2)} ${50 + Math.sin(a) * (r - 3.2)}L${50 + Math.cos(a) * r} ${50 + Math.sin(a) * r}`; }).join('');
const crown = 'M30 58 34 38 42 47 50 33 58 47 66 38 70 58zM31 61h38v5H31z';
const star = (cx, cy, R, r) => Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5; const rad = i % 2 ? r : R; return `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rad).toFixed(2)} ${(cy + Math.sin(a) * rad).toFixed(2)}`; }).join('') + 'z';

function faceSvg(side) {
  const id = `bgc-${side}`;
  const g1 = side === 'h' ? ['#fff3b0', '#f2c230', '#a8740c'] : ['#fdf0c4', '#e5b53a', '#97650a'];
  const word = side === 'h' ? 'HEADS' : 'TAILS';
  const emblem = side === 'h'
    ? `<path d="${crown}" fill="url(#${id}-e)" stroke="#8a5a06" stroke-width="1.2" stroke-linejoin="round"/>
       <circle cx="34" cy="37" r="2.6" fill="#fff6c8"/><circle cx="50" cy="32" r="2.8" fill="#fff6c8"/><circle cx="66" cy="37" r="2.6" fill="#fff6c8"/>`
    : `<path d="${star(50, 49, 17, 7.2)}" fill="url(#${id}-e)" stroke="#8a5a06" stroke-width="1.2" stroke-linejoin="round"/>
       ${Array.from({ length: 14 }, (_, i) => { const k = i % 7, a0 = Math.PI * (0.64 + k * 0.085), a = i < 7 ? a0 : Math.PI - a0; const x = 50 + Math.cos(a) * 25, y = 50 + Math.sin(a) * 25; return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.6" ry="1.3" transform="rotate(${(a * 180 / Math.PI + 90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="#9a6a0c" opacity=".75"/>`; }).join('')}`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <radialGradient id="${id}-g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="${g1[0]}"/><stop offset=".45" stop-color="${g1[1]}"/><stop offset="1" stop-color="${g1[2]}"/></radialGradient>
      <linearGradient id="${id}-e" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2a8"/><stop offset="1" stop-color="#c88f12"/></linearGradient>
      <path id="${id}-arc" d="M17 50a33 33 0 0 1 66 0"/>
      <path id="${id}-arc2" d="M22 56a28 28 0 0 0 56 0"/>
    </defs>
    <circle cx="50" cy="50" r="49" fill="#8a5a06"/>
    <circle cx="50" cy="50" r="47.5" fill="url(#${id}-g)"/>
    <path d="${ridge(47.5, 90)}" stroke="#a0700f" stroke-width="1" opacity=".55"/>
    <circle cx="50" cy="50" r="40.5" fill="none" stroke="#9a6a0c" stroke-width="1.4" opacity=".8"/>
    <circle cx="50" cy="50" r="39" fill="none" stroke="#fff3b8" stroke-width=".8" opacity=".6"/>
    ${emblem}
    <text font-family="Space Grotesk, Inter, sans-serif" font-weight="800" font-size="9.5" letter-spacing="3" fill="#7a4e05"><textPath href="#${id}-arc" startOffset="50%" text-anchor="middle">${word}</textPath></text>
    ${side === 'h' ? `<text x="50" y="80" text-anchor="middle" font-family="Space Grotesk, Inter, sans-serif" font-weight="700" font-size="7" fill="#7a4e05" letter-spacing="1.5">★ ★ ★</text>` : `<text x="50" y="82" text-anchor="middle" font-family="Space Grotesk, Inter, sans-serif" font-weight="800" font-size="8" fill="#7a4e05" letter-spacing="1">ONE</text>`}
    <ellipse cx="36" cy="28" rx="20" ry="9" fill="#fff" opacity=".18" transform="rotate(-28 36 28)"/>
  </svg>`;
}

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-coinp');
  const st = Object.assign({ h: 0, t: 0, recent: '', best: { side: '', n: 0 }, bestOf: 1 }, app.data('coin', {}));
  const save = () => app.save('coin', st);
  let series = { h: 0, t: 0, done: false };
  let side = st.recent.slice(-1) === 't' ? 't' : 'h';
  let angle = side === 'h' ? 0 : 180, flipping = false, stopCel = null;

  const coin = h('div.bg-coin', h('div.bg-coin-face.h', { html: faceSvg('h') }), h('div.bg-coin-edge'), h('div.bg-coin-face.t', { html: faceSvg('t') }));
  const coinWrap = h('button.bg-coin-wrap', { type: 'button', 'aria-label': 'Flip the coin', onclick: () => flip() }, coin);
  const shadow = h('div.bg-coin-shadow');
  const result = h('div.bg-coin-res');
  const line = h('div.bg-coin-line');
  const dots = h('div.bg-coin-dots');
  const sideH = h('div.bg-coin-side.h', h('b'), h('small', 'HEADS'), h('div.bg-coin-pips'));
  const sideT = h('div.bg-coin-side.t', h('b'), h('small', 'TAILS'), h('div.bg-coin-pips'));
  const modes = seg([{ v: 1, label: 'Single' }, { v: 3, label: 'Best of 3' }, { v: 5, label: 'of 5' }, { v: 7, label: 'of 7' }], st.bestOf, (v) => { st.bestOf = v; series = { h: 0, t: 0, done: false }; save(); render(); }, 'bg-coin-modes');
  const flipBtn = h('button.pill.primary.bg-roll.bg-coin-flip', { type: 'button', onclick: () => flip() }, 'Flip');
  const resetBtn = h('button.bg-coin-reset', { type: 'button', onclick: () => { st.h = st.t = 0; st.recent = ''; st.best = { side: '', n: 0 }; series = { h: 0, t: 0, done: false }; save(); render(); app.toast('Stats cleared'); } }, 'Reset');
  el.append(modes, shadow, coinWrap, sideH, sideT, result, line, dots, flipBtn, resetBtn);

  const apply = (y = 0, s = 1) => { coin.style.transform = `translateY(${y}cqmin) scale(${s}) rotateX(${angle}deg)`; shadow.style.transform = `translate(-50%, -50%) scale(${1 - Math.min(0.55, -y / 40)})`; shadow.style.opacity = String(0.55 - Math.min(0.35, -y / 60)); };
  apply();

  function streak() {
    const r = st.recent; if (!r) return { side: '', n: 0 };
    const s = r[r.length - 1]; let n = 0;
    for (let i = r.length - 1; i >= 0 && r[i] === s; i--) n++;
    return { side: s, n };
  }
  const W = (s) => (s === 'h' ? 'Heads' : 'Tails');
  function render(fresh) {
    const total = st.h + st.t;
    const need = Math.ceil(st.bestOf / 2);
    const pips = (box, n) => { box.replaceChildren(...Array.from({ length: need }, (_, i) => h(`i${i < n ? '.on' : ''}`))); };
    if (st.bestOf > 1) {
      sideH.querySelector('b').textContent = series.h; sideT.querySelector('b').textContent = series.t;
      pips(sideH.querySelector('.bg-coin-pips'), series.h); pips(sideT.querySelector('.bg-coin-pips'), series.t);
    } else {
      sideH.querySelector('b').textContent = st.h; sideT.querySelector('b').textContent = st.t;
      sideH.querySelector('.bg-coin-pips').replaceChildren(h('span', total ? `${Math.round((st.h / total) * 100)}%` : ''));
      sideT.querySelector('.bg-coin-pips').replaceChildren(h('span', total ? `${Math.round((st.t / total) * 100)}%` : ''));
    }
    sideH.classList.toggle('lead', !!fresh && side === 'h'); sideT.classList.toggle('lead', !!fresh && side === 't');
    const sk = streak();
    if (!total) { result.textContent = 'Tap to flip'; result.className = 'bg-coin-res idle'; line.textContent = 'Heads or tails?'; }
    else {
      result.textContent = W(side); result.className = `bg-coin-res ${side}${fresh ? ' pop' : ''}`;
      const parts = [];
      if (st.bestOf > 1) parts.push(series.done ? `${W(series.h > series.t ? 'h' : 't')} wins ${Math.max(series.h, series.t)}–${Math.min(series.h, series.t)}` : `First to ${need}`);
      if (sk.n > 1) parts.push(`${sk.n} ${W(sk.side).toLowerCase()} in a row`);
      if (st.best.n > 1) parts.push(`best streak ${st.best.n}`);
      parts.push(`${total} flip${total > 1 ? 's' : ''}`);
      line.textContent = parts.join(' · ');
    }
    dots.replaceChildren(...st.recent.slice(-16).split('').map((c) => h(`i.${c}`, c.toUpperCase())));
    flipBtn.textContent = series.done ? 'New series' : 'Flip';
  }

  function flip() {
    if (flipping) return;
    stopCel?.(); stopCel = null;
    if (series.done) { series = { h: 0, t: 0, done: false }; render(); }
    flipping = true;
    const next = rnd() < 0.5 ? 'h' : 't';
    const turns = 5 + Math.floor(rnd() * 3);
    const from = angle;
    const base = Math.ceil(from / 360) * 360 + turns * 360;
    const to = base + (next === 'h' ? 0 : 180);
    const dur = 1500 + rnd() * 300, H = 19;
    const t0 = performance.now();
    app.sfx('whoosh');
    result.className = 'bg-coin-res idle'; result.textContent = '';
    coinWrap.classList.add('up');
    const stepFn = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - t) ** 3;
      angle = from + (to - from) * e;
      let y;
      if (t < 0.86) { const u = t / 0.86; y = -H * 4 * u * (1 - u); }
      else { const u = (t - 0.86) / 0.14; y = -2.4 * Math.sin(Math.PI * u); }
      apply(y, 1 + 0.32 * Math.sin(Math.PI * Math.min(1, t / 0.86)));
      if (t < 1) requestAnimationFrame(stepFn); else land(next, to);
    };
    requestAnimationFrame(stepFn);
  }
  function land(next, to) {
    angle = to % 360; apply();
    coinWrap.classList.remove('up');
    flipping = false;
    side = next;
    st[next]++;
    st.recent = (st.recent + next).slice(-40);
    const sk = streak();
    if (sk.n > st.best.n) st.best = { side: sk.side, n: sk.n };
    app.sfx('coin'); app.vibrate?.(20);
    if (st.bestOf > 1) {
      series[next]++;
      const need = Math.ceil(st.bestOf / 2);
      if (series[next] >= need) {
        series.done = true;
        app.sfx('win');
        setTimeout(() => { stopCel = celebrate(el, `${W(next)} wins!`, '#f59e0b', `Best of ${st.bestOf} · ${series.h}–${series.t}`); }, 350);
      }
    }
    save(); render(true);
  }
  render();

  return {
    key(e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') { flip(); return true; } return false; },
    destroy() { stopCel?.(); },
  };
}
