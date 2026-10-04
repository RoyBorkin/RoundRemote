// Board Games → Twister: the spinner. Left/right × hand/foot × red/blue/yellow/green, a big call, optional auto-spin
// every N seconds and a spoken call (English or Hebrew) through speechSynthesis.
import { h } from '../js/ui/dom.js';
import { seg } from './bg-ui.js';
import { rnd } from './bg-dice-engine.js';

const COLS = [['red', '#e11d48', 'Red', 'אדום'], ['blue', '#2563eb', 'Blue', 'כחול'], ['yellow', '#facc15', 'Yellow', 'צהוב'], ['green', '#16a34a', 'Green', 'ירוק']];
// quadrants clockwise from the top-right
const LIMBS = [['rh', 'Right hand', 'יד ימין'], ['rf', 'Right foot', 'רגל ימין'], ['lf', 'Left foot', 'רגל שמאל'], ['lh', 'Left hand', 'יד שמאל']];
const HAND = 'M12.5 2c.8 0 1.5.7 1.5 1.5V10h.5V4.5a1.5 1.5 0 0 1 3 0V11h.5V7.5a1.5 1.5 0 0 1 3 0V15c0 4-3 7-7 7h-1.2c-2.2 0-4-1-5.3-2.8L2.6 13.3a1.5 1.5 0 0 1 2.4-1.8L7 14V5.5a1.5 1.5 0 0 1 3 0V10h1V3.5c0-.8.7-1.5 1.5-1.5z';
const FOOT = 'M8.5 22c-2.5 0-4.2-2-4-4.6.2-3 2-4.6 2.3-7.5.3-2.6 1.5-4.4 3.7-4.4s3.3 1.9 3 4.6c-.3 3-.6 5-.6 7.2 0 2.8-1.6 4.7-4.4 4.7zM16 6.2a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2zm2.9 1.8a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm1.6 2.9a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2zM13.2 4.3a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8z';

function boardSvg() {
  let s = '<svg viewBox="0 0 200 200" aria-hidden="true">';
  s += '<circle cx="100" cy="100" r="98" fill="var(--tw-board)" stroke="var(--tw-line)" stroke-width="1.5"/>';
  for (let q = 0; q < 4; q++) {
    for (let c = 0; c < 4; c++) {
      const a1 = ((q * 90 + c * 22.5) * Math.PI) / 180, a2 = ((q * 90 + (c + 1) * 22.5) * Math.PI) / 180;
      const r1 = 60, r2 = 94;
      const p = (a, r) => `${(100 + r * Math.sin(a)).toFixed(2)} ${(100 - r * Math.cos(a)).toFixed(2)}`;
      s += `<path d="M${p(a1, r1)}L${p(a1, r2)}A${r2} ${r2} 0 0 1 ${p(a2, r2)}L${p(a2, r1)}A${r1} ${r1} 0 0 0 ${p(a1, r1)}z" fill="${COLS[c][1]}" stroke="var(--tw-board)" stroke-width="1.6"/>`;
      const am = (a1 + a2) / 2;
      s += `<circle cx="${(100 + 77 * Math.sin(am)).toFixed(2)}" cy="${(100 - 77 * Math.cos(am)).toFixed(2)}" r="9" fill="rgb(255 255 255 / .28)"/>`;
    }
    const a = ((q * 90 + 45) * Math.PI) / 180, x = 100 + 33 * Math.sin(a), y = 100 - 33 * Math.cos(a) - 6;
    const isHand = LIMBS[q][0][1] === 'h', right = LIMBS[q][0][0] === 'r';
    s += `<g transform="translate(${x - 11} ${y - 11}) scale(.92)" fill="var(--tw-ink)"><path d="${isHand ? HAND : FOOT}" ${right ? '' : 'transform="translate(24 0) scale(-1 1)"'}/></g>`;
    const [w1, w2] = LIMBS[q][1].toUpperCase().split(' ');
    s += `<text x="${x}" y="${y + 18}" text-anchor="middle" font-size="6.6" font-weight="800" fill="var(--tw-ink)" font-family="Inter, sans-serif" letter-spacing=".4"><tspan x="${x}">${w1}</tspan><tspan x="${x}" dy="7">${w2}</tspan></text>`;
  }
  for (let q = 0; q < 4; q++) { const a = (q * 90 * Math.PI) / 180; s += `<line x1="100" y1="100" x2="${100 + 98 * Math.sin(a)}" y2="${100 - 98 * Math.cos(a)}" stroke="var(--tw-line)" stroke-width="1.2"/>`; }
  s += '</svg>';
  return s;
}

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-twister');
  const S = Object.assign({ auto: 0, voice: 'en', last: null }, app.data('twister', {}));
  const save = () => app.save('twister', S);
  let angle = 0, spinning = false, timer = 0, countdown = 0;

  const board = h('div.bg-tw-board', { html: boardSvg() });
  const needle = h('div.bg-tw-needle', { html: '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 8 56.5 50 50 58 43.5 50z" fill="var(--tw-ink)"/><circle cx="50" cy="50" r="8" fill="var(--tw-ink)"/><circle cx="50" cy="50" r="3" fill="var(--tw-board)"/></svg>' });
  const spinArea = h('button.bg-tw-spin', { type: 'button', 'aria-label': 'Spin', onclick: () => spin() }, board, needle);
  const call = h('div.bg-tw-call');
  const autoSeg = seg([{ v: 0, label: 'Manual' }, { v: 5, label: '5s' }, { v: 10, label: '10s' }, { v: 15, label: '15s' }, { v: 20, label: '20s' }], S.auto, (v) => { S.auto = v; save(); arm(); }, 'bg-tw-auto');
  const voiceSeg = seg([{ v: 'off', label: 'Silent' }, { v: 'en', label: 'EN' }, { v: 'he', label: 'עב' }], S.voice, (v) => { S.voice = v; save(); if (S.last) { showCall(S.last, false); if (v !== 'off') speak(S.last); } }, 'bg-tw-voice');
  const spinBtn = h('button.pill.primary.bg-roll.bg-tw-btn', { type: 'button', onclick: () => spin() }, 'Spin');
  el.append(autoSeg, spinArea, call, voiceSeg, spinBtn);
  needle.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;

  function showCall(res, fresh) {
    const [limb, col] = res;
    const L = LIMBS.find((x) => x[0] === limb), C = COLS.find((x) => x[0] === col);
    call.replaceChildren(
      h('div.bg-tw-limb', S.voice === 'he' ? h('span', { dir: 'rtl' }, L[2]) : L[1]),
      h('div.bg-tw-col', { style: { background: C[1], color: col === 'yellow' ? '#1c1917' : '#fff' } }, S.voice === 'he' ? h('span', { dir: 'rtl' }, C[3]) : C[2]));
    if (fresh) { call.classList.remove('pop'); void call.offsetWidth; call.classList.add('pop'); }
  }
  function speak(res) {
    if (S.voice === 'off' || !('speechSynthesis' in window)) return;
    const [limb, col] = res;
    const L = LIMBS.find((x) => x[0] === limb), C = COLS.find((x) => x[0] === col);
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(S.voice === 'he' ? `${L[2]}, ${C[3]}` : `${L[1]}, ${C[2]}`);
      u.lang = S.voice === 'he' ? 'he-IL' : 'en-US';
      const v = speechSynthesis.getVoices().find((x) => x.lang?.toLowerCase().startsWith(S.voice === 'he' ? 'he' : 'en'));
      if (v) u.voice = v;
      u.rate = 0.95;
      speechSynthesis.speak(u);
    } catch {}
  }
  function spin() {
    if (spinning) return;
    spinning = true; clearInterval(timer);
    const seg16 = Math.floor(rnd() * 16);
    const target = seg16 * 22.5 + 4 + rnd() * 14.5;
    const from = angle, to = Math.ceil(from / 360) * 360 + 360 * (3 + Math.floor(rnd() * 2)) + target;
    const dur = 2400 + rnd() * 600, t0 = performance.now();
    call.classList.add('dim');
    app.sfx('whoosh');
    let lastTick = Math.floor(from / 22.5);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - t) ** 4;
      angle = from + (to - from) * e;
      needle.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
      const tick = Math.floor(angle / 22.5);
      if (tick !== lastTick) { lastTick = tick; app.sfx('tick', { volume: 0.5 }); }
      if (t < 1) requestAnimationFrame(step); else done(seg16);
    };
    requestAnimationFrame(step);
  }
  function done(seg16) {
    spinning = false;
    angle %= 360;
    const res = [LIMBS[Math.floor(seg16 / 4)][0], COLS[seg16 % 4][0]];
    S.last = res; save();
    call.classList.remove('dim');
    showCall(res, true);
    app.sfx('perfect'); app.vibrate?.(30);
    speak(res);
    arm();
  }
  function arm() {
    clearInterval(timer);
    spinBtn.textContent = 'Spin';
    if (!S.auto) return;
    countdown = S.auto;
    spinBtn.textContent = `Spin · ${countdown}`;
    timer = setInterval(() => {
      countdown--;
      if (countdown <= 0) { clearInterval(timer); spin(); } else spinBtn.textContent = `Spin · ${countdown}`;
    }, 1000);
  }
  if (S.last) showCall(S.last, false); else call.replaceChildren(h('div.bg-tw-limb', 'Tap to spin'), h('div.bg-tw-col.none', 'Ready?'));
  arm();
  return {
    key(e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { spin(); return true; } return false; },
    destroy() { clearInterval(timer); try { speechSynthesis.cancel(); } catch {} spinning = false; },
    resume() { arm(); },
  };
}
