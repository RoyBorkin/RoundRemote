// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Timer: Stopwatch (laps, a ring that sweeps once a minute), Timer (set it by turning the ring like a kitchen-timer
// dial, or with presets; several can run at once) and Hourglass (falling sand you flip to restart / reverse).
// When time is up your music plays (a playlist, or the song that was on) — or a built-in alarm sound — with a big Stop.
// Timers keep running when you leave the app (they ring on any screen while Round Remote is open).
import { h } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { topPanel } from '../js/ui/overlay.js';
import { store } from '../js/core/store.js';
import { THEME } from '../games/kit.js';
import { ring as ringAlarm, whatEditor, DEFAULT_WHAT, nudgeAwake } from './clock-ring.js';

const COLOR = '#34d399';
const TAU = Math.PI * 2;
const PRESETS = [1, 3, 5, 10, 15, 30, 60];
const HG_PRESETS = [1, 3, 5, 10, 15, 30];
const pad = (n) => String(n).padStart(2, '0');
function fmtClock(ms, { cs = false, ceil = false } = {}) {
  ms = Math.max(0, ms);
  const totalS = ceil ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
  const hr = Math.floor(totalS / 3600), m = Math.floor((totalS % 3600) / 60), s = totalS % 60;
  const base = hr ? `${hr}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return cs ? [base, `.${pad(Math.floor((ms % 1000) / 10))}`] : base;
}
const durName = (ms) => {
  const s = Math.round(ms / 1000), m = Math.floor(s / 60), r = s % 60, hr = Math.floor(m / 60);
  if (hr) return `${hr} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return m && r ? `${m} min ${r} s` : m ? `${m} min` : `${r} s`;
};
const timeOfDay = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// ================================================================== engine (module level: survives leaving the app)
const E = {
  sw: { running: false, startAt: 0, acc: 0, laps: [] },
  timers: [],                       // { id, total, endAt, remain, state: 'run' | 'pause', label }
  hg: { total: 180000, endAt: 0, remain: 180000, state: 'idle' },   // idle | run | done
  what: { ...DEFAULT_WHAT },
};
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());
function load() {
  const d = (store.get('appData') || {}).timer || {};
  if (d.sw) E.sw = { ...E.sw, ...d.sw };
  if (Array.isArray(d.timers)) E.timers = d.timers;
  if (d.hg) E.hg = { ...E.hg, ...d.hg };
  if (d.what) E.what = { ...DEFAULT_WHAT, ...d.what };
  // timers that ran out while the page was closed don't ring (much) later
  const now = Date.now();
  E.timers = E.timers.filter((t) => t.state !== 'run' || t.endAt > now - 60000);
  if (E.hg.state === 'run' && E.hg.endAt < now - 60000) E.hg = { ...E.hg, state: 'done', remain: 0 };
}
function persist() {
  const all = store.get('appData') || {};
  store.set('appData', { ...all, timer: { ...(all.timer || {}), sw: E.sw, timers: E.timers, hg: E.hg, what: E.what } });
}
const swElapsed = () => E.sw.acc + (E.sw.running ? Date.now() - E.sw.startAt : 0);
const tRemain = (t) => (t.state === 'run' ? Math.max(0, t.endAt - Date.now()) : t.remain);
const hgRemain = () => (E.hg.state === 'run' ? Math.max(0, E.hg.endAt - Date.now()) : E.hg.state === 'done' ? 0 : E.hg.remain);

let engineOn = false;
function startEngine() {
  if (engineOn) return;
  engineOn = true;
  load();
  setInterval(() => {
    const now = Date.now();
    for (const t of [...E.timers]) if (t.state === 'run' && t.endAt <= now) timerDone(t);
    if (E.hg.state === 'run' && E.hg.endAt <= now) hourglassDone();
  }, 250);
}
function timerDone(t) {
  E.timers = E.timers.filter((x) => x.id !== t.id);
  persist(); emit();
  ringAlarm({
    time: '00:00', title: t.label || `${durName(t.total)} timer`, color: COLOR, icon: 'clock', what: E.what, source: 'timer', message: `Your ${durName(t.total)} timer is up`,
    snooze: '+1 min', snoozeIcon: 'plus',
    onSnooze: () => { addTimer(60000, t.label || `${durName(t.total)} timer`); },
  });
}
function hourglassDone() {
  E.hg = { ...E.hg, state: 'done', remain: 0 };
  persist(); emit();
  ringAlarm({
    time: '00:00', title: `Hourglass · ${durName(E.hg.total)}`, color: '#f2b45a', icon: 'clock', what: E.what, source: 'hourglass', message: 'The sand has run out',
    snooze: 'Flip', snoozeIcon: 'replay',
    onSnooze: () => { hgFlip(); },
  });
}
function addTimer(ms, label = '') {
  const t = { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, total: ms, endAt: Date.now() + ms, remain: ms, state: 'run', label };
  E.timers.push(t);
  persist(); emit();
  return t;
}
function hgStart(ms = E.hg.total) { E.hg = { total: ms, endAt: Date.now() + ms, remain: ms, state: 'run' }; persist(); emit(); }
function hgFlip() {
  const rem = hgRemain();
  const next = E.hg.state === 'run' ? E.hg.total - rem : E.hg.total;   // turning it over mid-way: the sand that fell runs back
  E.hg = { ...E.hg, endAt: Date.now() + next, remain: next, state: next > 0 ? 'run' : 'idle' };
  persist(); emit();
}

// ================================================================== the app
export default {
  css: './timer.css',
  create(el, app) {
    startEngine();
    app.hideTitle();
    const openPanel = (o) => { const p = app.openPanel(o); p.el.style.setProperty('--ac', COLOR); return p; };
    let mode = app.data('mode', 'timer');
    let tView = E.timers.length ? 'run' : 'set';     // timer page: set | run
    let selId = E.timers[0]?.id || null;
    let setMs = app.data('lastSet', 5 * 60000);
    let unit = 'm';

    // ---------------------------------------------------------------- the ring (SVG)
    let ticks = '';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU, r1 = 81, r2 = i % 5 ? 77.5 : 74;
      ticks += `<line x1="${(100 + r1 * Math.sin(a)).toFixed(2)}" y1="${(100 - r1 * Math.cos(a)).toFixed(2)}" x2="${(100 + r2 * Math.sin(a)).toFixed(2)}" y2="${(100 - r2 * Math.cos(a)).toFixed(2)}" class="${i % 5 ? 'tk' : 'tk five'}"/>`;
    }
    const svg = h('div.tm-ring', { html: `<svg viewBox="0 0 200 200">
      <g class="tm-ticks">${ticks}</g>
      <circle cx="100" cy="100" r="90" class="tm-track"/>
      <circle cx="100" cy="100" r="90" class="tm-arc" pathLength="1000" transform="rotate(-90 100 100)"/>
      <circle cx="100" cy="10" r="5.5" class="tm-head"/>
    </svg>` });
    const arcEl = svg.querySelector('.tm-arc'), headEl = svg.querySelector('.tm-head'), ticksEl = svg.querySelector('.tm-ticks');
    function setArc(frac, { head = true } = {}) {
      frac = Math.max(0, Math.min(1, frac));
      arcEl.style.strokeDasharray = `${(frac * 1000).toFixed(1)} 1000`;
      const a = frac * TAU;
      headEl.setAttribute('cx', (100 + 90 * Math.sin(a)).toFixed(2));
      headEl.setAttribute('cy', (100 - 90 * Math.cos(a)).toFixed(2));
      headEl.style.opacity = head ? 1 : 0;
    }

    // ---------------------------------------------------------------- rim buttons
    const MODES = [{ id: 'sw', name: 'Stopwatch' }, { id: 'timer', name: 'Timer' }, { id: 'hg', name: 'Hourglass' }];
    const ICONS = {
      sw: 'M9 1h6v2H9zM12 4a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm-1 2h2v5h-2zM18.5 4.1l1.4 1.4-1.6 1.6-1.4-1.4z',
      timer: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 2a6 6 0 1 1-5.2 9L12 12z',
    };
    const HG_ICON = 'M6 2h12v2h-1v3.2a5 5 0 0 1-2.3 4.2L13.4 12l1.3.6A5 5 0 0 1 17 16.8V20h1v2H6v-2h1v-3.2a5 5 0 0 1 2.3-4.2l1.3-.6-1.3-.6A5 5 0 0 1 7 7.2V4H6zm3 2v3.2c0 1.2.7 2.3 1.8 2.8L13 11l-.2.1h-1.6l2-1A3 3 0 0 0 15 7.2V4zm3 9.6-1.8.9A3 3 0 0 0 9 16.8V20h6v-3.2a3 3 0 0 0-1.2-2.3z';
    const rimBtn = (m, ang) => {
      const a = (ang * Math.PI) / 180;
      const b = h('button.tm-rim', { type: 'button', 'aria-label': m.name, title: m.name, style: { left: `${50 + 44 * Math.sin(a)}%`, top: `${50 - 44 * Math.cos(a)}%` },
        onclick: (e) => { e.stopPropagation(); m.onClick ? m.onClick() : setMode(m.id); } });
      const d = m.id === 'hg' ? HG_ICON : ICONS[m.id];
      b.innerHTML = d ? `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>` : icon(m.icon);
      return b;
    };
    const rims = [rimBtn(MODES[0], 220), rimBtn(MODES[1], 194), rimBtn(MODES[2], 166), rimBtn({ id: 'set', name: 'When time is up', icon: 'settings', onClick: () => openSettings() }, 140)];
    rims[3].classList.add('gear');

    // ---------------------------------------------------------------- pages
    const modeName = h('div.tm-mode');
    const swPage = buildStopwatch(), tPage = buildTimer(), hgPage = buildHourglass();
    const pages = { sw: swPage, timer: tPage, hg: hgPage };
    const root = h('div.tm', hgPage.canvas, svg, modeName, swPage.el, tPage.el, hgPage.el, ...rims);
    el.append(root);

    function setMode(m) {
      if (!pages[m]) m = 'timer';
      mode = m; app.save('mode', m);
      root.dataset.mode = m;
      rims.slice(0, 3).forEach((b, i) => b.classList.toggle('on', MODES[i].id === m));
      for (const [k, p] of Object.entries(pages)) p.el.hidden = k !== m;
      hgPage.canvas.hidden = m !== 'hg';
      modeName.textContent = MODES.find((x) => x.id === m).name;
      pages[m].show?.();
      app.sfx('tick');
    }

    // ================================================================ Stopwatch
    function buildStopwatch() {
      const main = h('span.sw-main'), cs = h('span.sw-cs');
      const time = h('div.tm-big.sw-time', main, cs);
      const laps = h('div.sw-laps');
      const left = h('button.tm-btn.tm-left', { type: 'button', onclick: () => (E.sw.running ? lap() : reset()) });
      const right = h('button.tm-btn.tm-right.primary', { type: 'button', onclick: () => toggle() });
      const pg = h('div.tm-page.sw', time, laps, left, right);
      const toggle = () => {
        if (E.sw.running) { E.sw.acc = swElapsed(); E.sw.running = false; app.sfx('drop'); }
        else { E.sw.startAt = Date.now(); E.sw.running = true; app.sfx('pop'); }
        persist(); draw();
      };
      const lap = () => { E.sw.laps.push(swElapsed()); persist(); app.sfx('tick'); drawLaps(); };
      const reset = () => { if (!swElapsed()) return; E.sw = { running: false, startAt: 0, acc: 0, laps: [] }; persist(); app.sfx('tap'); draw(); };
      const drawLaps = () => {
        const L = E.sw.laps, splits = L.map((t, i) => t - (L[i - 1] || 0));
        const best = splits.length > 1 ? Math.min(...splits) : -1, worst = splits.length > 1 ? Math.max(...splits) : -1;
        laps.replaceChildren(...splits.map((s, i) => h(`div.sw-lap${s === best ? '.best' : s === worst ? '.worst' : ''}`,
          h('span.sw-n', `Lap ${i + 1}`), h('span.sw-s', fmtClock(s, { cs: true }).join('')), h('span.sw-t', fmtClock(L[i])))).reverse());
      };
      const draw = () => {
        left.replaceChildren(h('i', { html: icon(E.sw.running ? 'plus' : 'replay') }), h('span', E.sw.running ? 'Lap' : 'Reset'));
        left.disabled = !E.sw.running && !swElapsed();
        right.replaceChildren(h('i', { html: icon(E.sw.running ? 'pause' : 'play') }), h('span', E.sw.running ? 'Stop' : swElapsed() ? 'Resume' : 'Start'));
        right.classList.toggle('stop', E.sw.running);
        drawLaps();
      };
      draw();
      return {
        el: pg, show: draw,
        frame() {
          const e = swElapsed();
          const [a, b] = fmtClock(e, { cs: true });
          if (main.textContent !== a) main.textContent = a;
          cs.textContent = b;
          setArc((e % 60000) / 60000, { head: e > 0 });
        },
        key(e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
          else if (e.key === 'l' || e.key === 'ArrowRight') { e.preventDefault(); if (E.sw.running) lap(); }
          else if (e.key === 'r' || e.key === 'ArrowLeft') { e.preventDefault(); if (!E.sw.running) reset(); }
        },
        running: () => E.sw.running,
      };
    }

    // ================================================================ Timer
    function buildTimer() {
      // ---- set view
      const mEl = h('button.tm-unit', { type: 'button', onclick: () => { unit = 'm'; drawSet(); } });
      const sEl = h('button.tm-unit', { type: 'button', onclick: () => { unit = 's'; drawSet(); } });
      const setTime = h('div.tm-big.tm-settime', mEl, h('span.tm-colon', ':'), sEl);
      const hint = h('div.tm-hint', 'Turn the ring to set');
      const presets = h('div.tm-presets', PRESETS.map((p) => h('button.tm-chip', { type: 'button', onclick: () => { setMs = p * 60000; unit = 'm'; app.sfx('tick'); drawSet(); } }, p === 60 ? '1h' : `${p}′`)));
      const startBtn = h('button.tm-btn.tm-mid.primary', { type: 'button', onclick: () => start() }, h('i', { html: icon('play') }), h('span', 'Start'));
      const cancelSet = h('button.tm-small.tm-cancelset', { type: 'button', 'aria-label': 'Back to running timers', onclick: () => { tView = 'run'; show(); } }, h('i', { html: icon('back') }));
      const setV = h('div.tm-view.tm-set', setTime, hint, presets, startBtn, cancelSet);
      // ---- run view
      const label = h('div.tm-label', { dir: 'auto' }), big = h('div.tm-big.tm-remain'), ends = h('div.tm-ends');
      const cancel = h('button.tm-small.tm-cancel', { type: 'button', 'aria-label': 'Cancel timer', onclick: () => cancelT() }, h('i', { html: icon('close') }));
      const pause = h('button.tm-btn.tm-mid.primary', { type: 'button', onclick: () => pauseT() });
      const plus = h('button.tm-small.tm-plus', { type: 'button', 'aria-label': 'Add one minute', onclick: () => plusT() }, '+1′');
      const chips = h('div.tm-tchips');
      const runV = h('div.tm-view.tm-run', label, big, ends, chips, cancel, pause, plus);
      const pg = h('div.tm-page.tmr', setV, runV);

      const sel = () => E.timers.find((t) => t.id === selId) || E.timers[0] || null;
      function drawSet() {
        const tot = Math.round(setMs / 1000), m = Math.floor(tot / 60), s = tot % 60;
        mEl.textContent = pad(m); sEl.textContent = pad(s);
        mEl.classList.toggle('sel', unit === 'm'); sEl.classList.toggle('sel', unit === 's');
        startBtn.disabled = setMs <= 0;
        presets.querySelectorAll('.tm-chip').forEach((c, i) => c.classList.toggle('on', setMs === PRESETS[i] * 60000));
        cancelSet.hidden = !E.timers.length;
        hint.textContent = unit === 'm' ? 'Turn the ring to set minutes' : 'Turn the ring to set seconds';
        const v = unit === 'm' ? (m % 60) + s / 60 : s;
        setArc(m >= 60 && unit === 'm' && m % 60 === 0 ? 1 : v / 60, { head: true });
        app.save('lastSet', setMs);
      }
      function start() {
        if (setMs <= 0) return;
        const t = addTimer(setMs, `${durName(setMs)} timer`);
        selId = t.id; tView = 'run';
        app.sfx('pop'); show();
      }
      function cancelT() {
        const t = sel(); if (!t) return;
        E.timers = E.timers.filter((x) => x.id !== t.id); persist();
        selId = E.timers[0]?.id || null;
        if (!E.timers.length) tView = 'set';
        app.sfx('drop'); show();
      }
      function pauseT() {
        const t = sel(); if (!t) return;
        if (t.state === 'run') { t.remain = tRemain(t); t.state = 'pause'; app.sfx('drop'); }
        else { t.endAt = Date.now() + t.remain; t.state = 'run'; app.sfx('pop'); }
        persist(); drawRun();
      }
      function plusT() {
        const t = sel(); if (!t) return;
        if (t.state === 'run') t.endAt += 60000; else t.remain += 60000;
        t.total += 60000; persist(); app.sfx('tick'); drawRun();
      }
      function drawRun() {
        const t = sel();
        if (!t) { tView = 'set'; show(); return; }
        selId = t.id;
        label.textContent = t.label || 'Timer';
        pause.replaceChildren(h('i', { html: icon(t.state === 'run' ? 'pause' : 'play') }), h('span', t.state === 'run' ? 'Pause' : 'Resume'));
        chips.replaceChildren(...E.timers.map((x) => h(`button.tm-tchip${x.id === t.id ? '.on' : ''}${x.state === 'pause' ? '.paused' : ''}`, { type: 'button', 'data-id': x.id,
          onclick: () => { selId = x.id; app.sfx('tick'); drawRun(); } }, fmtClock(tRemain(x), { ceil: true }))),
        h('button.tm-tchip.add', { type: 'button', 'aria-label': 'New timer', onclick: () => { tView = 'set'; app.sfx('tap'); show(); } }, h('i', { html: icon('plus') })));
        chips.classList.toggle('single', E.timers.length === 1);
      }
      function show() {
        if (tView === 'run' && !E.timers.length) tView = 'set';
        setV.hidden = tView !== 'set'; runV.hidden = tView !== 'run';
        if (tView === 'set') drawSet(); else drawRun();
      }
      // ---- the dial: drag around the ring
      let dial = null;
      svg.addEventListener('pointerdown', (e) => {
        if (mode !== 'timer' || tView !== 'set') return;
        const r = svg.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const d = Math.hypot(e.clientX - cx, e.clientY - cy) / (r.width / 2);
        if (d < 0.62) return;
        dial = { cx, cy, a: Math.atan2(e.clientX - cx, cy - e.clientY), acc: 0 };
        svg.setPointerCapture(e.pointerId);
        svg.classList.add('turning');
      });
      svg.addEventListener('pointermove', (e) => {
        if (!dial) return;
        const a = Math.atan2(e.clientX - dial.cx, dial.cy - e.clientY);
        let da = a - dial.a; if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU;
        dial.a = a; dial.acc += da;
        const step = TAU / 60;
        while (Math.abs(dial.acc) >= step) { const s = Math.sign(dial.acc); dial.acc -= s * step; bump(s); }
      });
      const endDial = () => { if (dial) { dial = null; svg.classList.remove('turning'); } };
      svg.addEventListener('pointerup', endDial); svg.addEventListener('pointercancel', endDial);
      svg.addEventListener('wheel', (e) => { if (mode === 'timer' && tView === 'set') { e.preventDefault(); bump(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
      function bump(s) {
        const before = setMs;
        if (unit === 'm') setMs = Math.max(0, Math.min(180 * 60000, setMs + s * 60000));
        else {
          const tot = Math.round(setMs / 1000), m = Math.floor(tot / 60), sec = (tot % 60 + s + 60) % 60;
          setMs = (m * 60 + sec) * 1000;
        }
        if (setMs !== before) { app.sfx('tick', { volume: 0.6 }); drawSet(); }
      }
      return {
        el: pg, show,
        frame() {
          if (tView === 'set') return;
          const t = sel(); if (!t) return;
          const rem = tRemain(t);
          const txt = fmtClock(rem, { ceil: true });
          if (big.textContent !== txt) {
            big.textContent = txt;
            ends.textContent = t.state === 'run' ? `Ends ${timeOfDay(t.endAt)}` : 'Paused';
            chips.querySelectorAll('.tm-tchip[data-id]').forEach((c) => { const x = E.timers.find((y) => y.id === c.dataset.id); if (x) c.textContent = fmtClock(tRemain(x), { ceil: true }); });
          }
          setArc(t.total ? rem / t.total : 0);
          root.classList.toggle('urgent', t.state === 'run' && rem < 10000);
        },
        key(e) {
          if (tView === 'set') {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); bump(1); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); bump(-1); }
            else if (e.key === 'Tab') { e.preventDefault(); unit = unit === 'm' ? 's' : 'm'; drawSet(); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); }
          } else {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pauseT(); }
            else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              const i = E.timers.findIndex((x) => x.id === selId), n = E.timers.length;
              if (n > 1) { selId = E.timers[(i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n].id; app.sfx('tick'); drawRun(); }
            }
          }
        },
        back() { if (tView === 'set' && E.timers.length) { tView = 'run'; show(); return true; } return false; },
        refresh() { if (tView === 'run') drawRun(); else drawSet(); },
        running: () => E.timers.some((t) => t.state === 'run'),
      };
    }

    // ================================================================ Hourglass
    function buildHourglass() {
      const canvas = h('canvas.hg-canvas');
      const ctx = canvas.getContext('2d');
      const left = h('div.hg-left');
      const chips = h('div.hg-presets', HG_PRESETS.map((p, i) => h('button.tm-chip', { type: 'button', style: { left: i < 3 ? '21%' : '79%', top: `${38 + (i % 3) * 12}%` }, onclick: () => {
        // a new duration: the sand settles at the bottom, then the glass is turned over
        E.hg = { total: p * 60000, endAt: 0, remain: p * 60000, state: 'idle' };
        flip();
      } }, `${p}′`)));
      const tip = h('div.hg-tip');
      const tap = h('button.hg-tap', { type: 'button', 'aria-label': 'Flip the hourglass', onclick: () => flip() });
      const pg = h('div.tm-page.hg', tap, left, tip, chips);
      let S = 0, dpr = 1;
      let flipT = -1;            // flip animation progress (0…1), -1 = none
      let flipFrom = 0;
      let grains = [];
      let pattern = null;
      const sandCol = () => (THEME.light ? '#d49a45' : '#f2c27a');
      const sandDark = () => (THEME.light ? '#b97f2e' : '#d9a35c');
      // glass profile: half-width (0…1) along the bulb, t = 0 at the neck … 1 at the cap
      const prof = (t) => {
        const neck = 0.06;
        if (t < 0.5) { const k = Math.sin((t / 0.5) * Math.PI / 2); return neck + (1 - neck) * k ** 1.4; }
        if (t < 0.88) return 1;
        const k = (t - 0.88) / 0.12; return 1 - 0.18 * k * k;
      };
      // cumulative volume along the bulb (solid of revolution) → sand levels that look right
      const N = 120, vol = [0];
      for (let i = 1; i <= N; i++) { const t = (i - 0.5) / N; vol.push(vol[i - 1] + prof(t) ** 2 / N); }
      const VMAX = vol[N], SAND = 0.62;    // sand fills 62 % of one bulb
      const levelFor = (v) => { for (let i = 1; i <= N; i++) if (vol[i] >= v) return (i - 1 + (v - vol[i - 1]) / (vol[i] - vol[i - 1])) / N; return 1; };
      function resize() {
        const r = canvas.getBoundingClientRect();
        dpr = Math.min(2, window.devicePixelRatio || 1);
        S = r.width;
        canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
        pattern = null;
      }
      const ro = new ResizeObserver(resize); ro.observe(canvas);
      function makePattern() {
        const c = document.createElement('canvas'); c.width = c.height = 48;
        const g = c.getContext('2d');
        g.fillStyle = sandCol(); g.fillRect(0, 0, 48, 48);
        for (let i = 0; i < 260; i++) {
          g.fillStyle = Math.random() < 0.5 ? 'rgba(120,70,20,.22)' : 'rgba(255,240,200,.35)';
          g.fillRect(Math.random() * 48, Math.random() * 48, 1.2, 1.2);
        }
        return ctx.createPattern(c, 'repeat');
      }
      let lastTheme = '';
      function render(dt) {
        if (!S) resize();
        if (!S) return;
        const themeKey = THEME.id + THEME.mode;
        if (!pattern || themeKey !== lastTheme) { pattern = makePattern(); lastTheme = themeKey; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, S, S);
        const cx = S / 2, cy = S * 0.485, H = S * 0.215, W = S * 0.12;   // H = height of one bulb
        const running = E.hg.state === 'run' && flipT < 0;
        let f = E.hg.total ? hgRemain() / E.hg.total : 0;
        if (E.hg.state === 'idle') f = 0;
        let rot = 0;
        if (flipT >= 0) {
          flipT = Math.min(1, flipT + dt / 0.75);
          const e = flipT < 0.5 ? 4 * flipT ** 3 : 1 - (-2 * flipT + 2) ** 3 / 2;
          rot = e * Math.PI;
          f = flipFrom;
          if (flipT >= 1) flipT = -1;
        }
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(rot);
        // the glass outline path (both bulbs)
        const path = new Path2D();
        const pts = [];
        for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([W * prof(t), -t * H]); }
        path.moveTo(pts[0][0], 0);
        for (const [x, y] of pts) path.lineTo(x, y);
        for (let i = pts.length - 1; i >= 0; i--) path.lineTo(-pts[i][0], pts[i][1]);
        for (const [x, y] of pts) path.lineTo(-x, -y);
        for (let i = pts.length - 1; i >= 0; i--) path.lineTo(pts[i][0], -pts[i][1]);
        path.closePath();
        ctx.fillStyle = THEME.ink(0.05); ctx.fill(path);
        // sand
        ctx.save(); ctx.clip(path);
        ctx.fillStyle = pattern;
        const topLevel = levelFor(f * SAND * VMAX) * H;                          // from the neck up
        const botFill = (1 - f) * SAND * VMAX;
        const botLevel = (1 - levelFor(VMAX - botFill)) * H;                     // from the bottom cap up
        if (f > 0.002) {
          const dip = running ? Math.min(topLevel * 0.35, H * 0.06) : 0;
          ctx.beginPath();
          ctx.moveTo(-W * 1.2, 0); ctx.lineTo(-W * 1.2, -topLevel);
          ctx.quadraticCurveTo(0, -topLevel + dip * 2, W * 1.2, -topLevel);
          ctx.lineTo(W * 1.2, 0); ctx.closePath(); ctx.fill();
        }
        if (botLevel > 0.5) {
          const mound = running || flipT >= 0 ? Math.min(H * 0.1, botLevel * 0.6 + H * 0.02) : Math.min(H * 0.05, botLevel * 0.4);
          ctx.beginPath();
          ctx.moveTo(-W * 1.2, H); ctx.lineTo(-W * 1.2, H - botLevel + mound * 0.5);
          ctx.quadraticCurveTo(0, H - botLevel - mound * 1.2, W * 1.2, H - botLevel + mound * 0.5);
          ctx.lineTo(W * 1.2, H); ctx.closePath(); ctx.fill();
        }
        // falling stream + grains
        if (running && f > 0.002) {
          const pileTop = H - botLevel - Math.min(H * 0.1, botLevel * 0.6 + H * 0.02) * 0.4;
          ctx.fillStyle = sandDark();
          ctx.fillRect(-S * 0.0025, 0, S * 0.005, pileTop);
          if (grains.length < 26 && Math.random() < 0.9) grains.push({ x: (Math.random() - 0.5) * S * 0.008, y: 0, v: S * 0.2 + Math.random() * S * 0.15 });
          ctx.fillStyle = sandCol();
          for (let i = grains.length - 1; i >= 0; i--) {
            const g = grains[i]; g.v += S * 1.6 * dt; g.y += g.v * dt; g.x *= 1.02;
            if (g.y > pileTop) { grains.splice(i, 1); continue; }
            ctx.fillRect(g.x - 1, g.y, 2, 2);
          }
        } else grains = [];
        ctx.restore();
        // glass edge + shine
        ctx.lineWidth = Math.max(1.5, S * 0.004); ctx.strokeStyle = THEME.ink(0.42); ctx.stroke(path);
        ctx.strokeStyle = THEME.light ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.18)'; ctx.lineWidth = S * 0.006; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-W * 0.72, -H * 0.82); ctx.quadraticCurveTo(-W * 0.86, -H * 0.6, -W * 0.7, -H * 0.42); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-W * 0.72, H * 0.42); ctx.quadraticCurveTo(-W * 0.86, H * 0.6, -W * 0.72, H * 0.8); ctx.stroke();
        // frame: caps and posts
        const capW = W * 1.5, capH = S * 0.022;
        ctx.fillStyle = THEME.ink(0.78);
        ctx.beginPath(); ctx.roundRect(-capW, -H - capH, capW * 2, capH, capH / 2); ctx.fill();
        ctx.beginPath(); ctx.roundRect(-capW, H, capW * 2, capH, capH / 2); ctx.fill();
        ctx.fillStyle = THEME.ink(0.32);
        for (const sx of [-1, 1]) ctx.fillRect(sx * capW * 0.86 - S * 0.004, -H, S * 0.008, 2 * H);
        ctx.restore();
      }
      function flip() {
        if (E.hg.state !== 'run') { hgStart(E.hg.total); flipFrom = 0; flipT = 0; app.sfx('whoosh'); draw(); return; }
        flipFrom = hgRemain() / E.hg.total;
        hgFlip();
        flipT = 0;
        app.sfx('whoosh');
        draw();
      }
      const draw = () => {
        chips.querySelectorAll('.tm-chip').forEach((c, i) => c.classList.toggle('on', E.hg.total === HG_PRESETS[i] * 60000));
        tip.textContent = E.hg.state === 'run' ? 'Tap the glass to flip it' : E.hg.state === 'done' ? 'Time’s up — tap to start again' : 'Tap the glass to start';
      };
      draw();
      return {
        el: pg, canvas, show: draw,
        frame(dt) {
          render(dt);
          const rem = E.hg.state === 'idle' ? E.hg.total : hgRemain();
          const txt = fmtClock(rem, { ceil: true });
          if (left.textContent !== txt) { left.textContent = txt; draw(); }
          setArc(E.hg.total ? rem / E.hg.total : 0, { head: E.hg.state === 'run' });
        },
        key(e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
          else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const i = HG_PRESETS.indexOf(E.hg.total / 60000);
            const n = HG_PRESETS[Math.max(0, Math.min(HG_PRESETS.length - 1, (i < 0 ? 2 : i) + (e.key === 'ArrowRight' ? 1 : -1)))];
            E.hg = { total: n * 60000, endAt: 0, remain: n * 60000, state: 'idle' }; persist(); app.sfx('tick'); draw();
          }
        },
        destroy() { ro.disconnect(); },
        running: () => E.hg.state === 'run',
      };
    }

    // ---------------------------------------------------------------- settings
    function openSettings() {
      openPanel({
        title: 'When time is up', className: 'tm-panel',
        build(body) {
          const sc = h('div.tm-form');
          sc.append(h('div.tm-note', 'What plays when a timer or the hourglass runs out:'),
            whatEditor({ get: () => E.what, set: (c) => { E.what = c; persist(); }, songLabel: 'The song that was on', songHint: 'Resumes the song you paused (or keeps it playing).' }),
            h('div.tm-note', 'Timers keep running when you leave this app, and ring on any screen while Round Remote is open.'));
          body.append(sc);
        },
      });
    }

    // ---------------------------------------------------------------- loop, keys, updates from the engine
    const onEngine = () => { pages.timer.refresh?.(); if (mode === 'sw') pages.sw.show(); if (mode === 'hg') pages.hg.show(); };
    listeners.add(onEngine);
    app.raf((dt) => {
      pages[mode].frame(dt);
      if (mode !== 'timer') root.classList.remove('urgent');
    });
    app.every(20000, () => { if (Object.values(pages).some((p) => p.running?.())) nudgeAwake(); });
    app.onKey((e) => {
      if (topPanel() || document.querySelector('.rk-ring')) return;
      if (e.key === '1' || e.key === '2' || e.key === '3') { setMode(MODES[+e.key - 1].id); return; }
      pages[mode].key?.(e);
    });
    tPage.show();
    setMode(mode);

    return {
      destroy() { listeners.delete(onEngine); hgPage.destroy(); },
      back() { return mode === 'timer' ? tPage.back() : false; },
    };
  },
};
export { startEngine as startTimers };   // main.js starts it at boot when a timer is running, so it rings on any screen
