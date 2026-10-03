// The game screen: one round canvas plus the chrome every game shares — start card (how to play,
// modes, best score), score at the top, pause, game over with the top-5 chart. Games only draw and play.
//
// A game file (games/<name>.js) default-exports:
//   {
//     howTo: 'One or two lines on how to play',
//     modes: [{ id, name, scoring?, unit?, format? }],   // optional; each mode has its own top 5
//     scoring: 'high' | 'low',                           // bigger or smaller is better (default 'high')
//     unit: 'pts',                                       // shown after the score (optional)
//     format: (score) => string,                         // optional score formatting
//     hud: true,                                         // show the score at the top while playing
//     create(g, { mode }) { …; return { destroy() {} } } // start a new round
//   }
// The `g` object a game gets:
//   g.canvas g.ctx           canvas + 2D context (already scaled — work in CSS pixels)
//   g.S g.R g.cx g.cy        canvas size, radius of the round screen, centre
//   g.color                  the game's colour       g.theme  app colours (kit.THEME)
//   g.loop(fn(dt, t))        your frame function (dt in seconds, capped); only runs while playing
//   g.on(evt, fn)            input: 'down' 'move' 'up' 'tap' 'swipe' 'hold' 'key' 'keyup' 'wheel' 'resize'
//                            pointer events give { x, y, dx, dy, r, a, id } — dx/dy from the centre in px,
//                            r = distance from the centre / R, a = angle (0 = 12 o'clock, clockwise, 0…2π)
//                            'swipe' adds { dir: 'left'|'right'|'up'|'down' }; 'key' gives { key }
//   g.score(n)  g.add(n)     set / add to the score shown at the top        g.scoreValue
//   g.sub(text)              small line under the score (lives, level…)   g.hud(show)
//   g.toast(text, ms)        short message in the middle
//   g.over(score, { title, label, note, win, delay, record })  end the round (score null = no chart entry)
//   g.sfx(name)  g.vibrate(ms)  g.draw.*  (see kit.js)   g.mode  g.time (seconds this round)
import { h, iconBtn, clear } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { go } from '../js/core/router.js';
import { store } from '../js/core/store.js';
import { loadGame, iconSvg, gameById } from './index.js';
import { topScores, addScore, PLACES } from './scores.js';
import { THEME, makeDraw, sfx, vibrate, TAU } from './kit.js';

const fmtDate = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });

/** The top-5 chart: one bar per place, longest = best. */
export function scoreChart(list, { color, format, unit = '', scoring = 'high', highlight = null } = {}) {
  const box = h('div.g-chart', { '--gc': color });
  if (!list.length) { box.append(h('div.g-chart-empty', 'No scores yet — be the first!')); return box; }
  const best = list[0].score;
  for (let i = 0; i < PLACES; i++) {
    const e = list[i];
    if (!e) { box.append(h('div.g-row.g-blank', h('span.g-rank', String(i + 1)), h('span.g-bar-wrap'), h('span.g-val', '—'))); continue; }
    const frac = scoring === 'low' ? (e.score > 0 ? best / e.score : 1) : (best > 0 ? e.score / best : 1);
    box.append(h(`div.g-row${e === highlight || (highlight && e.at === highlight.at && e.score === highlight.score) ? '.me' : ''}`,
      h('span.g-rank', String(i + 1)),
      h('span.g-bar-wrap', h('span.g-bar', { style: { width: `${Math.max(6, Math.round(frac * 100))}%` } }),
        h('span.g-meta', [e.label, fmtDate(e.at)].filter(Boolean).join(' · '))),
      h('span.g-val', `${e.text || format(e.score)}${unit && !e.text ? ` ${unit}` : ''}`)));
  }
  return box;
}

export function GameScreen({ id }) {
  const meta = gameById(id) || { name: 'Game', color: '#fff', icon: '' };
  const canvas = h('canvas.g-canvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = h('div.g-score'), subEl = h('div.g-sub');
  const hudEl = h('div.g-hud', scoreEl, subEl);
  const toastEl = h('div.g-toast');
  const ov = h('div.g-ov');
  const btnPause = iconBtn('pause', 'Pause', () => pause(), 'g-pause');
  const el = h('div.game-screen', { '--gc': meta.color }, canvas, hudEl, toastEl, btnPause, ov);

  let def = null, inst = null, state = 'loading', frameFn = null, handlers = {}, raf = 0, last = 0, endT = 0, overInfo = null;
  let mode = null;
  const modeDef = () => (def?.modes || []).find((m) => m.id === mode) || null;
  const scoring = () => modeDef()?.scoring || def?.scoring || 'high';
  const unit = () => modeDef()?.unit ?? def?.unit ?? '';
  const format = (s) => (modeDef()?.format || def?.format || ((n) => Math.round(n).toLocaleString()))(s);

  // ---------- the g object ----------
  const g = {
    canvas, ctx, S: 0, R: 0, cx: 0, cy: 0, dpr: 1, color: meta.color, theme: THEME, mode: null, time: 0, scoreValue: 0,
    loop(fn) { frameFn = fn; },
    on(evt, fn) { (handlers[evt] ||= []).push(fn); return () => { handlers[evt] = (handlers[evt] || []).filter((f) => f !== fn); }; },
    score(n) { g.scoreValue = n; scoreEl.textContent = format(n); },
    add(n) { g.score((g.scoreValue || 0) + n); scoreEl.classList.remove('bump'); void scoreEl.offsetWidth; scoreEl.classList.add('bump'); },
    sub(text) { subEl.textContent = text || ''; },
    hud(show) { hudEl.hidden = !show; },
    toast(text, ms = 1200) {
      toastEl.textContent = text; toastEl.classList.remove('on'); void toastEl.offsetWidth; toastEl.classList.add('on');
      clearTimeout(g._toastT); g._toastT = setTimeout(() => toastEl.classList.remove('on'), ms);
    },
    over(score, info = {}) {
      if (state !== 'play') return;
      state = 'ending'; overInfo = { score, ...info };
      endT = info.delay ?? 900;
      if (info.sfx !== false) sfx(info.win ? 'win' : 'over');
    },
    sfx, vibrate,
  };
  g.draw = makeDraw(g);
  const emit = (evt, e) => { for (const fn of handlers[evt] || []) { try { fn(e); } catch (err) { console.error(`[game ${id}] ${evt}`, err); } } };

  // ---------- canvas size ----------
  function resize() {
    // clientWidth/Height ignore transforms (the screen opens with a short scale animation)
    const S = Math.max(1, Math.round(Math.min(el.clientWidth, el.clientHeight)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(S * dpr); canvas.height = Math.round(S * dpr);
    canvas.style.width = canvas.style.height = `${S}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Object.assign(g, { S, R: S / 2, cx: S / 2, cy: S / 2, dpr });
    emit('resize', g);
    if (state !== 'play') paintIdle();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  function paintIdle() {
    if (inst) return; // keep the last frame of the game behind the overlay
    g.draw.bg({ glow: 0.22 });
  }

  // ---------- input ----------
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (g.S / (r.width || 1)), y = (e.clientY - r.top) * (g.S / (r.height || 1));
    const dx = x - g.cx, dy = y - g.cy;
    let a = Math.atan2(dx, -dy); if (a < 0) a += TAU;
    return { x, y, dx, dy, r: Math.hypot(dx, dy) / (g.R || 1), a, id: e.pointerId, t: performance.now() };
  };
  const downs = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const p = pt(e);
    downs.set(e.pointerId, { ...p, held: false, ht: setTimeout(() => { const d = downs.get(e.pointerId); if (d) { d.held = true; emit('hold', d); } }, 450) });
    emit('down', p);
  });
  canvas.addEventListener('pointermove', (e) => { if (state === 'play') emit('move', pt(e)); });
  const up = (e) => {
    const d = downs.get(e.pointerId);
    downs.delete(e.pointerId);
    if (d) clearTimeout(d.ht);
    if (state !== 'play') return;
    const p = pt(e);
    emit('up', p);
    if (!d || e.type === 'pointercancel') return;
    const mx = p.x - d.x, my = p.y - d.y, dt = p.t - d.t, m = Math.hypot(mx, my);
    if (m > g.R * 0.1 && dt < 600) emit('swipe', { ...p, dir: Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up'), mx, my });
    else if (m < g.R * 0.06 && dt < 350 && !d.held) emit('tap', p);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { if (state === 'play') { e.preventDefault(); emit('wheel', { delta: Math.sign(e.deltaY || e.deltaX) }); } }, { passive: false });
  const onKey = (e) => {
    if (e.target.matches?.('input, textarea')) return;
    if (e.key === 'Escape') { e.preventDefault(); if (state === 'play') pause(); else if (state === 'pause') resume(); else if (state !== 'ending') go('games'); return; }
    if (state === 'play') {
      if (e.key === 'p' && !def?.usesP) { pause(); return; }
      if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) e.preventDefault();
      if (!e.repeat || def?.keyRepeat) emit('key', { key: e.key, repeat: e.repeat });
    } else if ((e.key === 'Enter' || e.key === ' ') && (state === 'menu' || state === 'over')) {
      e.preventDefault();
      // ignore a key still held from playing (auto-repeat) and presses right as the card appears
      if (!e.repeat && performance.now() - shownAt > 600) startRound();
    }
  };
  const onKeyUp = (e) => { if (state === 'play') emit('keyup', { key: e.key }); };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  const onVis = () => { if (document.hidden && state === 'play') pause(); };
  document.addEventListener('visibilitychange', onVis);

  // ---------- loop ----------
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    if (state === 'play' || state === 'ending') {
      g.time += dt;
      if (frameFn) { try { frameFn(dt, g.time); } catch (err) { console.error(`[game ${id}]`, err); } }
      if (state === 'ending') { endT -= dt * 1000; if (endT <= 0) showOver(); }
    }
  }

  // ---------- rounds ----------
  function startRound() {
    if (!def) return;
    try { inst?.destroy?.(); } catch {}
    inst = null; frameFn = null; handlers = {}; g.time = 0; g.mode = mode; g.scoreValue = 0;
    g.draw.clearFx();
    scoreEl.textContent = def.hud === false ? '' : format(0); subEl.textContent = '';
    hudEl.hidden = def.hud === false;
    el.classList.add('playing');
    hideOv();
    state = 'play';
    try { inst = def.create(g, { mode, modeDef: modeDef() }) || {}; } catch (err) { console.error(`[game ${id}]`, err); }
    sfx('tap');
  }
  function pause() {
    if (state !== 'play') return;
    state = 'pause'; inst?.pause?.();
    showOv('pause');
  }
  function resume() {
    if (state !== 'pause') return;
    hideOv(); last = 0; state = 'play'; inst?.resume?.();
  }
  function showOver() {
    state = 'over';
    el.classList.remove('playing');
    const info = overInfo || {};
    let rank = 0, entry = null;
    // a zero in a bigger-is-better game isn't worth a place on the chart
    if (info.score != null && info.record !== false && !(scoring() === 'high' && info.score <= 0)) {
      const r = addScore(id, mode || 'default', info.score, { scoring: scoring(), label: info.label, text: null });
      rank = r.rank; entry = r.entry;
      if (entry) { entry.text = `${format(info.score)}${unit() ? ` ${unit()}` : ''}`; persistText(entry); }
    }
    if (rank === 1) sfx('perfect');
    showOv('over', { info, rank, entry });
  }
  // store the formatted score text alongside the number (the Games ring shows it without loading the game)
  function persistText(entry) {
    const all = { ...(store.get('gameScores') || {}) };
    const k = `${id}:${mode || 'default'}`;
    all[k] = (all[k] || []).map((e) => (e.at === entry.at && e.score === entry.score ? { ...e, text: entry.text } : e));
    store.set('gameScores', all);
  }

  // ---------- overlays ----------
  const pill = (label, onclick, cls = '') => h(`button.g-btn${cls ? '.' + cls : ''}`, { type: 'button', onclick: (e) => { e.stopPropagation(); sfx('click'); onclick(); } }, label);
  function hideOv() { ov.classList.remove('on'); el.classList.remove('ov-on'); }
  let shownAt = 0;
  function showOv(kind, data = {}) {
    shownAt = performance.now();
    clear(ov);
    el.classList.add('ov-on');
    const card = h(`div.g-card.${kind}`);
    const put = (...items) => card.append(...items.filter(Boolean));
    const list = () => topScores(id, mode || 'default');
    const chart = (highlight = null) => scoreChart(list(), { color: meta.color, format, unit: unit(), scoring: scoring(), highlight });
    const modeChips = () => (def.modes?.length > 1 ? h('div.g-modes', def.modes.map((m) => h(`button.g-chip${m.id === mode ? '.on' : ''}`, {
      type: 'button', onclick: (e) => { e.stopPropagation(); mode = m.id; saveMode(); sfx('click'); showOv(kind, data); },
    }, m.name))) : null);
    const best = () => { const b = list()[0]; return b ? `Best  ${b.text || format(b.score)}` : 'No best score yet'; };
    if (kind === 'menu') {
      put(
        h('div.g-badge', { html: iconSvg(meta.icon) }),
        h('div.g-title', meta.name),
        h('div.g-how', def.howTo || meta.blurb || ''),
        modeChips(),
        h('div.g-best', best()),
        h('div.g-actions', pill('Play', startRound, 'primary')),
        h('div.g-actions.small', pill('Top 5', () => showOv('scores', { back: 'menu' })), pill('Games', () => go('games'))),
      );
    } else if (kind === 'scores') {
      put(h('div.g-title.sm', `${meta.name} · Top 5`), modeChips(), chart(), h('div.g-actions', pill('Back', () => showOv(data.back || 'menu'), 'primary')));
    } else if (kind === 'pause') {
      const snd = () => (store.get('gameSound') === false ? 'Sound off' : 'Sound on');
      const sndBtn = pill(snd(), () => { store.set('gameSound', store.get('gameSound') === false); sndBtn.textContent = snd(); });
      put(h('div.g-title', 'Paused'), h('div.g-best', `Score  ${scoreEl.textContent || '0'}`),
        h('div.g-actions', pill('Resume', resume, 'primary')),
        h('div.g-actions.small', pill('Restart', startRound), pill('Quit', () => showOv('menu')), sndBtn));
    } else if (kind === 'over') {
      const { info, rank } = data;
      const hasScore = info.score != null;
      put(
        h('div.g-title.sm', info.title || (info.win ? 'You win!' : 'Game over')),
        hasScore ? h('div.g-big', `${format(info.score)}${unit() ? ` ${unit()}` : ''}`) : null,
        rank ? h(`div.g-rankpill${rank === 1 ? '.gold' : ''}`, rank === 1 ? 'New best!' : `#${rank} on the chart`) : null,
        info.note ? h('div.g-how', info.note) : null,
        chart(data.entry),
        h('div.g-actions', pill('Play again', startRound, 'primary')),
        h('div.g-actions.small', pill('Menu', () => showOv('menu')), pill('Games', () => go('games'))),
      );
    }
    ov.append(card);
    ov.classList.add('on');
  }
  function saveMode() { store.set('gameModes', { ...(store.get('gameModes') || {}), [id]: mode }); }

  // ---------- load ----------
  ov.append(h('div.g-card', h('div.g-how', 'Loading…')));
  ov.classList.add('on');
  loadGame(id).then((d) => {
    def = d;
    const saved = (store.get('gameModes') || {})[id];
    mode = def.modes?.some((m) => m.id === saved) ? saved : def.modes?.[0]?.id || null;
    state = 'menu';
    resize();
    showOv('menu');
  }).catch((err) => { console.error(err); clear(ov); ov.append(h('div.g-card', h('div.g-title.sm', 'This game didn’t load'), h('div.g-how', String(err.message || err)), h('div.g-actions', pill('Games', () => go('games'), 'primary')))); });
  raf = requestAnimationFrame(frame);

  return {
    el,
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVis);
      try { inst?.destroy?.(); } catch {}
      for (const d of downs.values()) clearTimeout(d.ht);
      clearTimeout(g._toastT);
    },
  };
}
