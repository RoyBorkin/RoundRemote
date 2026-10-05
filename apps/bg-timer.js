// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games — a shared round "sand timer" for the party companions (Codenames, Alias, Petakiot).
// A ring that drains (conic gradient), big seconds in the middle, tap = start / pause. Ticks in the last 5 s and
// a buzzer at 0. Updates a few times a second (once a second with Reduce effects / Battery saver) — no rAF loop.
//   const t = sandTimer(app, { seconds: 60, onEnd, onTick, onTap (return false to skip the start/pause), label })
//   t.el · t.start() · t.pause() · t.toggle() · t.reset(seconds?) · t.left (seconds, float) · t.running · t.destroy()
import { h } from '../js/ui/dom.js';
import { isLite } from '../js/core/store.js';

export function sandTimer(app, { seconds = 60, onEnd, onTick, onTap, label = 'tap to start', cls = '' } = {}) {
  let total = seconds, left = seconds, running = false, endAt = 0, iv = 0, lastWhole = Math.ceil(seconds);
  const num = h('b.bg-tm-n');
  const sub = h('small.bg-tm-s');
  const el = h(`button.bg-tm${cls ? '.' + cls : ''}`, { type: 'button', 'aria-label': 'Timer', onclick: (e) => { e.stopPropagation(); if (onTap?.() === false) return; toggle(); } }, h('i.bg-tm-ring'), num, sub);
  const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s); };
  function draw() {
    const p = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
    el.style.setProperty('--p', p.toFixed(4));
    num.textContent = total > 0 ? fmt(left) : '∞';
    sub.textContent = running ? 'tap to pause' : left <= 0 && total > 0 ? 'time’s up' : left < total ? 'paused · tap' : label;
    el.classList.toggle('run', running);
    el.classList.toggle('low', running && left <= 5 && total > 0);
    el.classList.toggle('done', left <= 0 && total > 0);
  }
  function tick() {
    if (!running) return;
    left = Math.max(0, (endAt - performance.now()) / 1000);
    const whole = Math.ceil(left);
    if (whole !== lastWhole) { lastWhole = whole; if (whole <= 5 && whole > 0) app.sfx('tick'); onTick?.(left); }
    if (left <= 0) { stopIv(); running = false; draw(); app.sfx('over'); app.vibrate?.(120); onEnd?.(); return; }
    draw();
  }
  const stopIv = () => { clearInterval(iv); iv = 0; };
  function start() {
    if (running || total <= 0) return;
    if (left <= 0) left = total;
    running = true; endAt = performance.now() + left * 1000; lastWhole = Math.ceil(left);
    stopIv(); iv = setInterval(tick, isLite() ? 1000 : 200);
    app.sfx('pop'); draw();
  }
  function pause() { if (!running) return; tick(); running = false; stopIv(); draw(); }
  function toggle() { running ? pause() : start(); }
  function reset(s = total) { stopIv(); running = false; total = s; left = s; lastWhole = Math.ceil(s); draw(); }
  draw();
  return {
    el, start, pause, toggle, reset, draw,
    get left() { return left; }, set left(v) { left = Math.max(0, Math.min(total, v)); if (running) endAt = performance.now() + left * 1000; draw(); },
    get total() { return total; },
    get running() { return running; },
    destroy() { stopIv(); running = false; },
  };
}
