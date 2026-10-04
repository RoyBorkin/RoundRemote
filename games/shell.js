// The game screen: one round canvas plus the chrome every game shares — start card (how to play,
// modes, best score), score at the top, pause, game over with the top-5 chart. Games only draw and play.
//
// A game file (games/<name>.js) default-exports:
//   {
//     howTo: 'One or two lines on how to play',
//     modes: [{ id, name, scoring?, unit?, format?,     // optional; each mode has its own top 5
//               options?: [{ id, name, choices: [{ id, name }], default? }] }],  // sub-choices of a mode
//                                                     // (e.g. difficulty) — every combination has its own top 5
//     scoring: 'high' | 'low',                           // bigger or smaller is better (default 'high')
//     unit: 'pts',                                       // shown after the score (optional)
//     format: (score) => string,                         // optional score formatting
//     hud: true,                                         // show the score at the top while playing
//     create(g, { mode, opts }) { …; return { destroy() {} } } // start a new round (opts = chosen options)
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
//   g.pauseAt(x, y)          move the pause button (−1…1) if it would cover something important
//   g.sub(text)              small line under the score (lives, level…)   g.hud(show)
//   g.toast(text, ms)        short message in the middle
//   g.over(score, { title, label, note, win, delay, record })  end the round (score null = no chart entry)
//   g.sfx(name)  g.vibrate(ms)  g.draw.*  (see kit.js)   g.mode  g.opts  g.time (seconds this round)
// A new top-5 score asks for the player's name (kept for next time). Pause also has music / media controls.
import { h, iconBtn, clear } from '../js/ui/dom.js';
import { editText } from '../js/ui/keyboard.js';
import { player } from '../js/core/player.js';
import { icon } from '../js/ui/icons.js';
import { go } from '../js/core/router.js';
import { store } from '../js/core/store.js';
import { loadGame, iconSvg, gameById } from './index.js';
import { topScores, addScore, updateEntry, PLACES } from './scores.js';
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
        h('span.g-meta', [e.name, e.label, fmtDate(e.at)].filter(Boolean).join(' · '))),
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
  let mode = null, opts = {};
  const modeDef = () => (def?.modes || []).find((m) => m.id === mode) || null;
  const optDefs = () => (modeDef()?.options || []).filter(Boolean);   // (null entries are skipped)
  const optVal = (o) => (o.choices.some((c) => c.id === opts[o.id]) ? opts[o.id] : o.default ?? o.choices[0]?.id);
  const chosenOpts = () => Object.fromEntries(optDefs().map((o) => [o.id, optVal(o)]));
  /** Which top 5 this round belongs to: the mode plus every option chosen for it. */
  // a game can add parts to the key (keyExtra(), e.g. the song a rhythm game was played with) and name them (keyLabel())
  const extraKey = () => { try { return (def?.keyExtra?.() || []).filter((x) => x != null && x !== ''); } catch { return []; } };
  const keyLabel = () => { try { return def?.keyLabel?.() || ''; } catch { return ''; } };
  const scoreKey = () => [mode || 'default', ...optDefs().map(optVal), ...extraKey()].join(':');
  const keyName = () => [modeDef()?.name, ...optDefs().map((o) => o.choices.find((c) => c.id === optVal(o))?.name), keyLabel()].filter(Boolean).join(' · ');
  // where quit / back go: the Games ring, or the game's own home (rhythm games → the Rhythm screen)
  const homeRoute = meta.home || 'games';
  const homeName = homeRoute === 'rhythm' ? 'Rhythm' : 'Games';
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
    /** Move the pause button (x, y from −1…1 across the round screen; default 0, −0.876 = top centre). */
    pauseAt(x = 0, y = -0.876) { btnPause.style.left = `${50 + x * 50}%`; btnPause.style.top = `${50 + y * 50}%`; },
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
    // ts = when the input actually happened (event time, same clock as performance.now()) — rhythm games judge by it
    return { x, y, dx, dy, r: Math.hypot(dx, dy) / (g.R || 1), a, id: e.pointerId, t: performance.now(), ts: e.timeStamp || performance.now() };
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
    if (e.key === 'Escape') { e.preventDefault(); if (state === 'play') pause(); else if (state === 'pause') resume(); else if (state !== 'ending') go(homeRoute); return; }
    if (state === 'play') {
      if (e.key === 'p' && !def?.usesP) { pause(); return; }
      if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) e.preventDefault();
      if (!e.repeat || def?.keyRepeat) emit('key', { key: e.key, repeat: e.repeat, ts: e.timeStamp || performance.now() });
    } else if ((e.key === 'Enter' || e.key === ' ') && (state === 'menu' || state === 'over')) {
      e.preventDefault();
      // ignore a key still held from playing (auto-repeat) and presses right as the card appears
      if (!e.repeat && performance.now() - shownAt > 600) startRound();
    }
  };
  const onKeyUp = (e) => { if (state === 'play') emit('keyup', { key: e.key, ts: e.timeStamp || performance.now() }); };
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
    inst = null; frameFn = null; handlers = {}; g.time = 0; g.mode = mode; g.opts = chosenOpts(); g.scoreValue = 0;
    g.draw.clearFx();
    scoreEl.textContent = def.hud === false ? '' : format(0); subEl.textContent = '';
    hudEl.hidden = def.hud === false;
    g.pauseAt();
    el.classList.add('playing');
    hideOv();
    state = 'play';
    try { inst = def.create(g, { mode, modeDef: modeDef(), opts: g.opts }) || {}; } catch (err) { console.error(`[game ${id}]`, err); }
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
      const r = addScore(id, scoreKey(), info.score, { scoring: scoring(), label: info.label });
      rank = r.rank; entry = r.entry;
      if (rank) {
        // the formatted score (the Games ring shows it without loading the game) and the last name used
        // a game that already knows who scored (e.g. the winner of a party game) passes info.name
        entry = updateEntry(id, scoreKey(), entry, { text: `${format(info.score)}${unit() ? ` ${unit()}` : ''}`, name: info.name || store.get('gamePlayer') || '' });
      }
    }
    if (rank === 1) sfx('perfect');
    showOv('over', { info, rank, entry });
    // a new place on the chart: ask who it was (the first time; later the last name is filled in and can be changed)
    if (rank && !info.name && !store.get('gamePlayer')) setTimeout(() => { if (state === 'over') askName({ info, rank, entry }); }, 650);
  }
  async function askName(data) {
    const v = await editText({ title: 'Your name for the top 5', value: data.entry?.name || store.get('gamePlayer') || '', placeholder: 'Name' });
    if (v === null) return;
    const name = v.trim().slice(0, 16);
    if (name) store.set('gamePlayer', name);
    data.entry = updateEntry(id, scoreKey(), data.entry, { name });
    if (state === 'over') showOv('over', data);
  }

  // ---------- overlays ----------
  const pill = (label, onclick, cls = '') => h(`button.g-btn${cls ? '.' + cls : ''}`, { type: 'button', onclick: (e) => { e.stopPropagation(); sfx('click'); onclick(); } }, label);
  let offMedia = null;
  function hideOv() { ov.classList.remove('on'); el.classList.remove('ov-on'); offMedia?.(); offMedia = null; }
  /** Pause card: the music / movie that's playing, with previous · play/pause · next and volume. */
  function mediaBox() {
    if (!player.provider) return null;
    const art = h('div.g-np-art'), title = h('div.g-np-title'), artist = h('div.g-np-sub');
    const btn = (ic, label, fn) => iconBtn(ic, label, () => { sfx('click'); Promise.resolve(fn()).catch(() => {}); }, 'g-np-btn');
    const bPrev = btn('prev', 'Previous', () => player.prev()), bPlay = btn('play', 'Play / pause', () => player.toggle()), bNext = btn('next', 'Next', () => player.next());
    const vol = h('span.g-np-vol');
    const vStep = (d) => player.setVolume(Math.max(0, Math.min(100, (player.state.volume ?? 50) + d)));
    const bDown = btn('minus', 'Volume down', () => vStep(-6)), bUp = btn('plus', 'Volume up', () => vStep(6));
    const box = h('div.g-np', h('div.g-np-head', art, h('div.g-np-text', title, artist)), h('div.g-np-ctl', bPrev, bPlay, bNext, h('span.g-np-gap'), bDown, vol, bUp));
    const paint = () => {
      const s = player.state, c = player.caps;
      // a game can keep the song a secret (Hit Timeline): its instance returns true from hideTrack()
      const secret = !!inst?.hideTrack?.();
      const t = secret ? (s.track ? { title: 'Mystery song', artist: 'No peeking!' } : null) : s.track;
      box.hidden = !t && !s.device;
      art.style.backgroundImage = t?.art ? `url("${t.art}")` : '';
      art.classList.toggle('none', !t?.art);
      title.textContent = t ? (t.media?.show || t.title || '') : (s.device?.name || 'Nothing playing');
      artist.textContent = t ? (t.media ? [t.media.season != null ? `S${t.media.season} E${t.media.episode}` : '', t.media.title !== t.title ? t.media.title : ''].filter(Boolean).join(' · ') || t.artist || '' : t.artist || '') : (s.message || '');
      bPlay.innerHTML = icon(s.isPlaying ? 'pause' : 'play');
      bPrev.disabled = !c.prev; bNext.disabled = !c.next;
      bDown.disabled = bUp.disabled = !c.volume;
      vol.textContent = c.volume && s.volume != null ? String(Math.round(s.volume)) : '';
    };
    paint();
    offMedia?.(); offMedia = player.on('state', paint);
    return box;
  }
  let shownAt = 0;
  function showOv(kind, data = {}) {
    shownAt = performance.now();
    offMedia?.(); offMedia = null;
    clear(ov);
    el.classList.add('ov-on');
    const card = h(`div.g-card.${kind}`);
    const put = (...items) => card.append(...items.filter(Boolean));
    const list = () => topScores(id, scoreKey());
    const chart = (highlight = null) => scoreChart(list(), { color: meta.color, format, unit: unit(), scoring: scoring(), highlight });
    const modeChips = () => {
      const rows = [];
      if (def.modes?.length > 1) rows.push(h('div.g-modes', def.modes.map((m) => h(`button.g-chip${m.id === mode ? '.on' : ''}`, {
        type: 'button', onclick: (e) => { e.stopPropagation(); mode = m.id; saveMode(); sfx('click'); showOv(kind, data); },
      }, m.name))));
      for (const o of optDefs()) {
        rows.push(h('div.g-opt', h('span.g-opt-label', o.name), ...o.choices.map((c) => h(`button.g-chip.sm${optVal(o) === c.id ? '.on' : ''}`, {
          type: 'button', onclick: (e) => { e.stopPropagation(); opts = { ...opts, [o.id]: c.id }; saveMode(); sfx('click'); showOv(kind, data); },
        }, c.name))));
      }
      return rows.length ? h('div.g-choices', rows) : null;
    };
    const best = () => { const b = list()[0]; return b ? `Best  ${b.text || format(b.score)}` : 'No best score yet'; };
    if (kind === 'menu') {
      put(
        h('div.g-badge', { html: iconSvg(meta.icon) }),
        h('div.g-title', meta.name),
        keyLabel() ? h('div.g-keyname', keyLabel()) : null,
        h('div.g-how', def.howTo || meta.blurb || ''),
        modeChips(),
        h('div.g-best', best()),
        h('div.g-actions', pill('Play', startRound, 'primary')),
        h('div.g-actions.small', pill('Top 5', () => showOv('scores', { back: 'menu' })), pill(homeName, () => go(homeRoute))),
      );
    } else if (kind === 'scores') {
      put(h('div.g-title.sm', `${meta.name} · Top 5`), keyLabel() ? h('div.g-keyname', keyLabel()) : null, modeChips(), chart(), h('div.g-actions', pill('Back', () => showOv(data.back || 'menu'), 'primary')));
    } else if (kind === 'pause') {
      const snd = () => (store.get('gameSound') === false ? 'Sound off' : 'Sound on');
      const sndBtn = pill(snd(), () => { store.set('gameSound', store.get('gameSound') === false); sndBtn.textContent = snd(); });
      put(h('div.g-title', 'Paused'), h('div.g-best', `Score  ${scoreEl.textContent || '0'}`),
        h('div.g-actions', pill('Resume', resume, 'primary')),
        h('div.g-actions.small', pill('Restart', startRound), pill('Quit', () => showOv('menu')), sndBtn),
        mediaBox());
    } else if (kind === 'over') {
      const { info, rank } = data;
      const hasScore = info.score != null;
      put(
        h('div.g-title.sm', info.title || (info.win ? 'You win!' : 'Game over')),
        hasScore ? h('div.g-big', `${format(info.score)}${unit() ? ` ${unit()}` : ''}`) : null,
        rank ? h(`div.g-rankpill${rank === 1 ? '.gold' : ''}`, rank === 1 ? 'New best!' : `#${rank} on the chart`) : null,
        rank ? h('button.g-name', { type: 'button', onclick: (e) => { e.stopPropagation(); askName(data); } },
          h('span', { html: icon('edit') }), data.entry?.name ? `${data.entry.name}` : 'Add your name') : null,
        info.note ? h('div.g-how', info.note) : null,
        keyName() ? h('div.g-keyname', keyName()) : null,
        chart(data.entry),
        h('div.g-actions', pill('Play again', startRound, 'primary')),
        h('div.g-actions.small', pill('Menu', () => showOv('menu')), pill(homeName, () => go(homeRoute))),
      );
    }
    ov.append(card);
    ov.classList.add('on');
  }
  function saveMode() {
    store.set('gameModes', { ...(store.get('gameModes') || {}), [id]: mode });
    store.set('gameOpts', { ...(store.get('gameOpts') || {}), [id]: opts });
    store.set('gameKeys', { ...(store.get('gameKeys') || {}), [id]: scoreKey() });   // for the best score on the Games ring
  }

  // ---------- load ----------
  ov.append(h('div.g-card', h('div.g-how', 'Loading…')));
  ov.classList.add('on');
  loadGame(id).then((d) => {
    def = d;
    const saved = (store.get('gameModes') || {})[id];
    mode = def.modes?.some((m) => m.id === saved) ? saved : def.modes?.[0]?.id || null;
    opts = { ...((store.get('gameOpts') || {})[id] || {}) };
    state = 'menu';
    resize();
    showOv('menu');
  }).catch((err) => { console.error(err); clear(ov); ov.append(h('div.g-card', h('div.g-title.sm', 'This game didn’t load'), h('div.g-how', String(err.message || err)), h('div.g-actions', pill(homeName, () => go(homeRoute), 'primary')))); });
  raf = requestAnimationFrame(frame);

  return {
    el,
    destroy() {
      state = 'gone';   // e.g. the "your name" prompt scheduled for a new top-5 score must not open on the next screen
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVis);
      try { inst?.destroy?.(); } catch {}
      offMedia?.();
      for (const d of downs.values()) clearTimeout(d.ht);
      clearTimeout(g._toastT);
    },
  };
}
