// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Power Hour: a new song every 60 s (or 30 s Turbo) for 30 / 60 / 100 rounds, a sip at every change.
// Uses the music player (js/core/player.js): next track each round, or a chosen playlist first.
// With no music service it still runs the timer and beeps. Test hook: window.__drinksRoundMs shortens a round.
import { player } from '../js/core/player.js';
import { notify } from '../js/core/alerts.js';
import { h, clear, IC, svgIcon, rbtn, seg, choose } from './drinks-ui.js';

export function mount(el, ctx) {
  const { app } = ctx;
  const cfg = { sec: 60, rounds: 60, playlist: null, ...app.data('power', {}) };
  cfg.playlist = null;                         // playlists are chosen each time (the service may differ)
  const saveCfg = () => app.save('power', { sec: cfg.sec, rounds: cfg.rounds });
  let view = 'setup', run = null, wake = null;
  el.classList.add('dk-power');

  // ---------------------------------------------------------------- setup
  const music = h('div.dk-ph-music');
  const listBtn = h('button.pill.small.dk-ph-list', { type: 'button', onclick: () => pickPlaylist() });
  const setup = h('div.dk-ph-setup',
    h('div.dk-ph-icon', { html: svgIcon(IC.power) }),
    music,
    h('div.dk-sect', 'New song every'),
    seg([{ v: 60, label: '60 s' }, { v: 30, label: '30 s Turbo' }], cfg.sec, (v) => { cfg.sec = v; saveCfg(); }),
    h('div.dk-sect', 'Rounds'),
    seg([30, 60, 100].map((v) => ({ v, label: String(v) })), cfg.rounds, (v) => { cfg.rounds = v; saveCfg(); }),
    listBtn,
    h('button.pill.primary.dk-ph-start', { type: 'button', onclick: () => start() }, 'Start'),
    h('div.dk-ph-note', 'One sip per song — keep it light, water counts.'));

  // ---------------------------------------------------------------- running
  const R = 46, CIRC = 2 * Math.PI * R;
  const ring = h('div.dk-ph-ring', { html: `<svg viewBox="0 0 100 100"><circle class="dk-ph-track" cx="50" cy="50" r="${R}"/><circle class="dk-ph-fill" cx="50" cy="50" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/></svg>` });
  const fill = ring.querySelector('.dk-ph-fill');
  const roundEl = h('div.dk-ph-round');
  const secEl = h('div.dk-ph-sec');
  const leftEl = h('div.dk-ph-left');
  const nowEl = h('div.dk-ph-now');
  const pauseBtn = rbtn(IC.pause, 'Pause', () => togglePause(), 'dk-ph-pause big');
  const runEl = h('div.dk-ph-run', ring, roundEl, secEl, leftEl, nowEl,
    h('div.dk-ph-ctl', rbtn(IC.stop, 'Stop', () => stop()), pauseBtn, rbtn(IC.skip, 'Next round now', () => { if (run && !run.paused) nextRound(); })));
  const flash = h('div.dk-ph-flash', h('span', 'Sip!'));
  el.append(setup, runEl, flash);

  const hasMusic = () => !!player.provider;
  function renderSetup() {
    clear(music);
    const p = player.provider;
    if (!p) {
      music.classList.add('warn');
      music.append(h('div.dk-ph-m-t', 'No music service'), h('div.dk-ph-m-s', 'Open one from Home and start a song — or play with beeps only.'));
      listBtn.hidden = true;
      return;
    }
    music.classList.remove('warn');
    const tr = player.state.track;
    music.append(h('div.dk-ph-m-t', p.name || 'Music'), h('bdi.dk-ph-m-s', tr ? [tr.title, tr.artist].filter(Boolean).join(' · ') : 'Ready — the next track plays each round'));
    listBtn.hidden = !p.caps?.playlists;
    listBtn.textContent = cfg.playlist ? `Playlist: ${cfg.playlist.name}` : 'Choose a playlist…';
  }
  async function pickPlaylist() {
    let lists = [];
    try { lists = await player.provider.getPlaylists(); } catch (e) { app.toast('Couldn’t load playlists'); return; }
    if (!lists?.length) { app.toast('No playlists found'); return; }
    const v = await choose({ title: 'Playlist', value: cfg.playlist?.id || '', options: [{ v: '', label: 'Keep current music', sub: 'Skip to the next track each round' }, ...lists.map((pl) => ({ v: pl.id, label: pl.name, sub: pl.owner || pl.subtitle || '' }))] });
    if (v === null) return;
    cfg.playlist = lists.find((pl) => pl.id === v) || null;
    renderSetup();
  }

  function show(v) {
    view = v;
    setup.hidden = v !== 'setup';
    runEl.hidden = v === 'setup';
    ctx.hideTitle(v !== 'setup');
    if (v === 'setup') renderSetup();
  }

  const offTrack = player.on?.('state', () => { if (view === 'setup') renderSetup(); else renderNow(); }) || (() => {});
  function renderNow() {
    const tr = player.state.track;
    nowEl.textContent = '';
    if (!hasMusic()) nowEl.append(h('span.dk-ph-warn', 'No music — beeps only'));
    else if (tr) nowEl.append(h('bdi.dk-ph-now-t', tr.title || ''), h('bdi.dk-ph-now-a', tr.artist || ''));
  }

  const roundMs = () => window.__drinksRoundMs || cfg.sec * 1000;

  async function start() {
    run = { round: 1, total: cfg.rounds, ms: roundMs(), deadline: performance.now() + roundMs(), paused: false, left: 0, done: false };
    show('run');
    try { wake = await navigator.wakeLock?.request('screen'); } catch {}
    if (hasMusic()) {
      try {
        if (cfg.playlist) await player.provider.playPlaylist(cfg.playlist);
        else if (!player.state.isPlaying) await player.play();
      } catch (e) { console.warn('[power hour]', e); }
    }
    doFlash('Go!');
    render();
  }

  function nextRound() {
    if (!run || run.done) return;
    run.round++;
    if (run.round > run.total) { finish(); return; }
    run.deadline = performance.now() + run.ms;
    if (hasMusic()) { try { player.next(); } catch (e) { console.warn(e); } }
    doFlash('Sip!');
    render();
  }

  function doFlash(text) {
    flash.firstChild.textContent = text;
    flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
    ctx.sfx('score'); setTimeout(() => ctx.sfx('perfect'), 160);
    if (!hasMusic()) ctx.sfx('coin');
    app.vibrate(40);
  }

  function togglePause() {
    if (!run || run.done) return;
    if (run.paused) {
      run.paused = false; run.deadline = performance.now() + run.left;
      if (hasMusic()) player.play();
    } else {
      run.paused = true; run.left = Math.max(0, run.deadline - performance.now());
      if (hasMusic() && player.state.isPlaying) player.pause();
    }
    ctx.sfx('tap');
    render();
  }

  async function finish() {
    run.done = true; run.round = run.total;
    ctx.sfx('win');
    clear(nowEl);
    nowEl.append(h('span.dk-ph-fin', 'Power Hour complete! 🎉'), h('span.dk-ph-fin-s', 'Time for a big glass of water.'));
    render();
    try { await notify({ title: 'Power Hour complete', message: 'Well played — time for some water.', level: 'info', source: 'drinks' }); } catch {}
  }

  function stop() {
    run = null;
    try { wake?.release?.(); } catch {}
    wake = null;
    show('setup');
  }

  function render() {
    if (!run) return;
    const left = run.paused ? run.left : Math.max(0, run.deadline - performance.now());
    roundEl.textContent = run.done ? 'Done' : `Round ${run.round} of ${run.total}`;
    leftEl.textContent = run.done ? `${run.total} rounds` : run.paused ? 'Paused' : `${run.total - run.round} to go`;
    pauseBtn.innerHTML = svgIcon(run.paused ? IC.play : IC.pause);
    pauseBtn.setAttribute('aria-label', run.paused ? 'Resume' : 'Pause');
    runEl.classList.toggle('paused', run.paused);
    runEl.classList.toggle('done', run.done);
    if (!run.done) renderNow();
    tick(left);
  }
  let lastSec = -1;
  function tick(left) {
    const frac = run.done ? 0 : left / run.ms;
    fill.setAttribute('stroke-dashoffset', String(CIRC * (1 - frac)));
    const s = run.done ? 0 : Math.ceil(left / 1000);
    if (s !== lastSec) {
      lastSec = s; secEl.textContent = run.done ? '✓' : s;
      if (!run.done && !run.paused && s <= 3 && s > 0) ctx.sfx('tick');
    }
    runEl.classList.toggle('soon', !run.done && !run.paused && left < 4000);
  }

  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!run || run.paused || run.done) return;
    const left = run.deadline - performance.now();
    if (left <= 0) nextRound(); else tick(left);
  };
  raf = requestAnimationFrame(loop);

  show('setup');
  return {
    destroy() { cancelAnimationFrame(raf); offTrack(); try { wake?.release?.(); } catch {} ctx.hideTitle(false); },
    back() {
      if (view !== 'run') return false;
      if (run && !run.paused && !run.done) { togglePause(); app.toast('Paused — press Back again to stop'); return true; }
      stop(); return true;
    },
    key(e) {
      if (view === 'run' && (e.key === ' ' || e.key === 'Enter')) { togglePause(); return true; }
      if (view === 'setup' && e.key === 'Enter') { start(); return true; }
      return false;
    },
  };
}
