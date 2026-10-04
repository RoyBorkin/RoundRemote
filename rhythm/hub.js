// The Rhythm screen. Step 1: choose where the music plays (a ring of the music services, like Home).
// Step 2: the six rhythm games on a ring around what's playing — the song (art, title, artist), a mini
// transport, "Choose song", what the app has learned about the song (versions), and the selected game.
// The choice of service is remembered (Settings: rhythmService), so next time it opens on step 2.
import { h, iconBtn, badge, clear } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { openPanel, listRow, curve, toast, topPanel, closeAllPanels } from '../js/ui/overlay.js';
import { openLibrary, openSearch } from '../js/screens/panels.js';
import { go } from '../js/core/router.js';
import { store } from '../js/core/store.js';
import { player } from '../js/core/player.js';
import { SERVICES, provider, getService, adaptersOf } from '../js/providers/registry.js';
import { bridgeInfo } from '../js/providers/bridge.js';
import { iconSvg } from '../games/index.js';
import { sfx } from '../games/kit.js';
import { RHYTHM } from './index.js';
import { currentSong, versions, selectedVersionId, selectVersion, newVersion, forget, markRelearn, needsRelearn, setActiveSong, SOURCE_SHORT } from './session.js';
import { demoTick } from './clock.js';

const MUSIC = SERVICES.filter((s) => (s.section || 'music') === 'music');
const fmtDate = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
const signedIn = (svc) => { const p = provider(svc.id); return !p.setupHint() && p.isAuthed(); };

/** Make a service the player's provider (like openService, without leaving the Rhythm screen). */
function useService(svc) {
  const p = provider(svc.id);
  store.set('rhythmService', svc.id);
  store.set('lastService', svc.id);
  const app = document.getElementById('app');
  app.style.setProperty('--accent', svc.color);
  app.style.setProperty('--brand', svc.color);
  if (player.provider !== p) player.use(p);
}

/** Best score for this game and song (any difficulty), from the shell's top-5 lists. */
function bestFor(gameId, key) {
  const all = store.get('gameScores') || {};
  let best = null;
  for (const [k, list] of Object.entries(all)) {
    if (!k.startsWith(`${gameId}:`) || (key && !k.endsWith(`:${key}`))) continue;
    if (list?.[0] && (!best || list[0].score > best.score)) best = list[0];
  }
  return best;
}

export function RhythmHubScreen() {
  setActiveSong(null);
  const el = h('div.rhythm-hub');
  const glow = h('div.gh-glow');
  el.append(glow);
  const saved = getService(store.get('rhythmService'));
  let step = saved && signedIn(saved) ? 'games' : 'service';
  if (step === 'games' && player.provider !== provider(saved.id)) useService(saved);
  const offs = [];

  // ================================================================ step 1: services
  const svcRing = h('div.rh-svc-ring');
  const svcItems = MUSIC.map((svc, i) => {
    const btn = h('button.svc', {
      type: 'button', 'aria-label': svc.name, '--c': svc.color, style: { animationDelay: `${i * 30}ms` },
      onclick: (e) => { e.stopPropagation(); pickService(svc); },
    }, badge(svc), h('span.svc-name', svc.short || svc.name), h('span.svc-dot'));
    svcRing.append(btn);
    return { svc, btn };
  });
  function layoutServices() {
    const shown = svcItems.filter((it) => it.svc.id !== 'demo' || store.get('showDemo') !== false || store.get('rhythmService') === 'demo');
    const ui = parseFloat(document.getElementById('app')?.style.getPropertyValue('--ui')) || 1;
    const rad = ui > 1 ? 37.5 + (ui - 1) * 9 : 37.5 - (ui - 1) * 10;
    svcItems.forEach((it) => { it.btn.hidden = !shown.includes(it); it.btn.classList.toggle('last', it.svc.id === store.get('rhythmService')); });
    shown.forEach((it, i) => {
      const a = (i / shown.length) * Math.PI * 2;
      it.btn.style.left = `${50 + rad * Math.sin(a)}%`;
      it.btn.style.top = `${50 - rad * Math.cos(a)}%`;
    });
  }
  (async () => {
    for (const it of svcItems) if (it.svc.kind !== 'bridge') it.btn.classList.toggle('ready', signedIn(it.svc));
    const info = await bridgeInfo({ passive: true }).catch(() => null);
    for (const it of svcItems) {
      if (it.svc.kind !== 'bridge') continue;
      const ad = info?.adapters || {};
      const ok = it.svc.id === 'tidal' || it.svc.id === 'qobuz' ? Object.values(ad).some((a) => a.enabled && a.id !== 'mock') : adaptersOf(it.svc).some((k) => ad[k]?.enabled);
      it.btn.classList.toggle('ready', !!ok);
      if (!info) it.btn.classList.add('needs-bridge');
    }
  })();
  function pickService(svc) {
    sfx('tap');
    if (!signedIn(svc)) { go('connect', { id: svc.id }); return; }
    useService(svc);
    show('games');
  }
  const svcBack = iconBtn('back', 'Back', () => (getService(store.get('rhythmService')) ? show('games') : go('home')), 'rh-back');
  const svcCenter = h('div.rh-pick',
    h('div.rh-kicker', 'RHYTHM'),
    h('div.rh-pick-title', 'Choose where the music plays'),
    h('div.rh-pick-sub', 'The song plays on your speakers as usual — the games play along here.'),
    h('div.rh-pick-btns', iconBtn('home', 'Home', () => go('home'), 'small'), svcBack));
  const stepService = h('div.rh-step.rh-step-service', svcRing, svcCenter);

  // ================================================================ step 2: games around the song
  const n = RHYTHM.length;
  let sel = Math.max(0, RHYTHM.findIndex((x) => x.id === store.get('rhythmGame')));
  const ring = h('div.rh-ring');
  const items = RHYTHM.map((gm, i) => {
    const a = (i / n) * Math.PI * 2;
    const b = h('button.gh-item.rh-item', {
      type: 'button', 'aria-label': gm.name, '--c': gm.color,
      style: { left: `${50 + 42 * Math.sin(a)}%`, top: `${50 - 42 * Math.cos(a)}%`, animationDelay: `${i * 40}ms` },
      onclick: (e) => { e.stopPropagation(); if (sel === i) play(); else select(i); },
      html: iconSvg(gm.icon),
    });
    ring.append(b);
    return b;
  });
  const pointer = h('div.rh-pointer');

  // service chip ("Change")
  const svcChip = h('button.rh-svc', { type: 'button', onclick: (e) => { e.stopPropagation(); sfx('click'); show('service'); } });
  // the song
  const art = h('div.rh-art');
  const title = h('div.rh-title'), artist = h('div.rh-artist');
  const learned = h('button.rh-learned', { type: 'button', onclick: (e) => { e.stopPropagation(); openVersions(); } });
  const songBox = h('div.rh-song', art, h('div.rh-song-text', title, artist, learned));
  const bPrev = iconBtn('prev', 'Previous', () => player.prev(), 'small rh-tbtn');
  const bPlay = iconBtn('play', 'Play / pause', () => player.toggle(), 'small rh-tbtn rh-tplay');
  const bNext = iconBtn('next', 'Next', () => player.next(), 'small rh-tbtn');
  const chooseBtn = h('button.rh-choose', { type: 'button', onclick: (e) => { e.stopPropagation(); chooseSong(); } }, h('span', { html: icon('search') }), 'Choose song');
  const transport = h('div.rh-transport', bPrev, bPlay, bNext, chooseBtn);
  // the selected game
  const gName = h('div.rh-gname'), gBlurb = h('div.rh-gblurb'), gBest = h('div.rh-gbest');
  const playBtn = h('button.gh-play.rh-play', { type: 'button', onclick: (e) => { e.stopPropagation(); play(); } }, 'Play');
  const gameBox = h('div.rh-game', gName, gBlurb, gBest, playBtn);
  const center = h('div.rh-center', svcChip, songBox, transport, h('div.rh-sep'), gameBox);
  const homeBtn = iconBtn('home', 'Home', () => go('home'), 'rh-home on-circle');
  const backBtn = iconBtn('back', 'Choose the service', () => show('service'), 'rh-back2 on-circle');
  const stepGames = h('div.rh-step.rh-step-games', ring, pointer, center, homeBtn, backBtn);
  el.append(stepService, stepGames);

  function select(i, quiet = false) {
    sel = (i + n) % n;
    const gm = RHYTHM[sel];
    items.forEach((b, j) => b.classList.toggle('on', j === sel));
    el.style.setProperty('--gc', gm.color);
    gName.textContent = gm.name;
    gBlurb.textContent = gm.blurb;
    pointer.style.transform = `rotate(${(sel / n) * 360}deg)`;
    gameBox.classList.remove('swap'); void gameBox.offsetWidth; gameBox.classList.add('swap');
    store.set('rhythmGame', gm.id);
    renderPlay();
    if (!quiet) sfx('tick');
  }
  function renderPlay() {
    const gm = RHYTHM[sel];
    const song = currentSong();
    const need = gm.needsSong && !song;
    playBtn.textContent = need ? 'Choose a song' : 'Play';
    const b = bestFor(gm.id, gm.needsSong ? song?.key : null);
    gBest.textContent = b ? `Best ${b.text || Math.round(b.score).toLocaleString()}${gm.needsSong ? ' · this song' : ''}` : gm.needsSong && song ? 'No score for this song yet' : '';
  }
  function play() {
    const gm = RHYTHM[sel];
    if (gm.needsSong && !currentSong()) { chooseSong(); return; }
    sfx('tap');
    go('game', { id: gm.id });
  }

  // ---------------------------------------------------------------- the song & what's learned
  let learnSeq = 0;
  function renderSvc() {
    const svc = player.provider ? getService(player.provider.id) : getService(store.get('rhythmService'));
    clear(svcChip);
    if (svc) svcChip.append(badge(svc, 'sm'), h('span.rh-svc-name', svc.short || svc.name), h('span.rh-svc-change', 'Change'));
  }
  function renderSong() {
    const s = player.state, t = s.track;
    art.style.backgroundImage = t?.art ? `url("${t.art}")` : '';
    art.classList.toggle('none', !t?.art);
    art.innerHTML = t?.art ? '' : icon('note');
    title.textContent = t ? t.title || '' : 'Nothing playing';
    artist.textContent = t ? t.artist || '' : (s.message || 'Choose a song to play along');
    bPlay.innerHTML = icon(s.isPlaying ? 'pause' : 'play');
    const c = player.caps;
    bPrev.disabled = !c.prev; bNext.disabled = !c.next;
    renderLearned();
    renderPlay();
  }
  async function renderLearned() {
    const song = currentSong();
    const my = ++learnSeq;
    learned.hidden = !song;
    if (!song) return;
    const list = await versions(song.key).catch(() => []);
    if (my !== learnSeq) return;
    learned.classList.toggle('yes', list.length > 0);
    learned.textContent = list.length
      ? `Learned · ${list.length} version${list.length > 1 ? 's' : ''}${needsRelearn(song.key) ? ' · will relearn' : ''}`
      : 'Not learned yet';
  }
  renderSvc(); renderSong();
  offs.push(player.on('state', () => { renderSong(); }));
  offs.push(player.on('provider', () => { renderSvc(); renderSong(); }));
  let lastTrack = null;
  offs.push(player.on('track', (t) => { if ((t?.id ?? null) !== lastTrack) { lastTrack = t?.id ?? null; renderLearned(); } }));

  function chooseSong() {
    if (!player.provider) { show('service'); return; }
    const c = player.caps;
    if (!c.search && !c.playlists) { toast('Pick a song in the service’s own app — the games follow what plays'); return; }
    if (c.search && !c.playlists) { openSearch(); return; }
    if (!c.search) { openLibrary(); return; }
    openPanel({
      title: 'Choose a song', className: 'list-panel rh-choose-panel',
      build(body, panel) {
        const list = h('div.list');
        body.append(list);
        curve(list);
        list.append(
          listRow({ title: 'Search', subtitle: 'Songs, albums and playlists', mono: '⌕', onClick: () => { panel.close(); openSearch(); } }),
          listRow({ title: 'Playlists', subtitle: 'Play one of your playlists', mono: '≡', onClick: () => { panel.close(); openLibrary(); } }),
        );
      },
    });
  }
  function openVersions() {
    const song = currentSong();
    if (!song) return;
    openPanel({
      title: 'Versions', className: 'list-panel rh-versions',
      build(body, panel) {
        const list = h('div.list');
        body.append(list);
        curve(list);
        const load = async () => {
          const vs = await versions(song.key);
          const selId = selectedVersionId(song.key) || vs[vs.length - 1]?.id;
          clear(list);
          if (!vs.length) list.append(h('div.empty', h('div', 'Not learned yet — start a game and the song is learned first.')));
          for (const v of vs) {
            list.append(listRow({
              title: v.name || 'Version', subtitle: `${SOURCE_SHORT[v.source] || v.source || ''} · ${fmtDate(v.created)}${v.seed > 1 ? ` · chart ${v.seed}` : ''}`,
              mono: v.id === selId ? '✓' : '♪', active: v.id === selId,
              onClick: () => { selectVersion(song.key, v.id); toast(`${v.name} selected`); load(); renderLearned(); },
            }));
          }
          if (vs.length) {
            list.append(listRow({ title: 'New version', subtitle: 'A different chart from the same learning', mono: '+', onClick: async () => { const v = await newVersion(song.key); if (v) toast(`${v.name} made`); load(); renderLearned(); } }));
          }
          list.append(listRow({
            title: needsRelearn(song.key) ? 'Don’t learn again' : 'Learn again', subtitle: needsRelearn(song.key) ? 'Keep the versions as they are' : 'Listen again before the next game (a new version)', mono: '↻',
            onClick: () => { markRelearn(song.key, !needsRelearn(song.key)); load(); renderLearned(); },
          }));
          if (vs.length) {
            list.append(listRow({ title: 'Forget this song', subtitle: 'Delete every version', mono: '×', onClick: async () => { await forget(song.key); toast('Forgotten'); panel.close(); renderLearned(); } }));
          }
        };
        load();
      },
    });
  }

  // ---------------------------------------------------------------- steps
  function show(s) {
    step = s;
    el.dataset.step = s;
    stepService.hidden = s !== 'service';
    stepGames.hidden = s !== 'games';
    if (s === 'service') { layoutServices(); svcBack.hidden = !getService(store.get('rhythmService')); }
    else { renderSvc(); renderSong(); }
    const st = s === 'service' ? stepService : stepGames;
    st.classList.remove('in'); void st.offsetWidth; st.classList.add('in');
  }
  offs.push(store.on('change:uiSize', () => setTimeout(layoutServices, 0)));

  // drag round the ring / scroll / arrows to move through the games
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (step !== 'games') return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.36) return;
    drag = { moved: false, r };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { r } = drag;
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    let a = Math.atan2(dx, -dy); if (a < 0) a += Math.PI * 2;
    const i = Math.round((a / (Math.PI * 2)) * n) % n;
    if (i !== sel) { drag.moved = true; select(i); }
  });
  const end = () => { if (drag?.moved) { const stop = (c) => { c.stopPropagation(); c.preventDefault(); }; window.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', stop, true), 50); } drag = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => { if (step !== 'games' || topPanel()) return; e.preventDefault(); select(sel + Math.sign(e.deltaY || e.deltaX)); }, { passive: false });
  const onKey = (e) => {
    if (e.target.matches?.('input, textarea')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (topPanel()) topPanel().close();
      else if (step === 'service' && getService(store.get('rhythmService'))) show('games');
      else go('home');
      return;
    }
    if (topPanel() || step !== 'games') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); play(); }
    else if (e.key === ' ' || e.key === 'k' || e.key === 'MediaPlayPause') { e.preventDefault(); player.toggle(); }
    else if (e.key === 'n' || e.key === 'MediaTrackNext') player.next();
    else if (e.key === 'p' || e.key === 'MediaTrackPrevious') player.prev();
    else if (e.key === '/' || e.key === 'b') chooseSong();
  };
  window.addEventListener('keydown', onKey);

  // the Demo's songs are audible here too (rhythm/synth.js), in step with the Demo player
  let raf = 0;
  const tick = () => { raf = requestAnimationFrame(tick); demoTick(); };
  raf = requestAnimationFrame(tick);

  select(sel, true);
  show(step);
  return {
    el,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      offs.forEach((f) => f());
      closeAllPanels();   // the Demo audio goes quiet by itself unless the game screen keeps it going (clock.js)
    },
  };
}

// ================================================================ latency calibration (Settings → Rhythm)
/**
 * Tap along to 16 metronome clicks played here; the median of (tap − click) is the audio + tap latency.
 * onSave(ms) is called with the result when the player keeps it (it's also stored as rhythmOffsetMs).
 */
export function openCalibration({ onSave } = {}) {
  const BPM = 100, BEAT = 60 / BPM, LEAD = 4, CLICKS = 16;
  let ctx = null, t0 = 0, raf = 0, diffs = [], running = false;
  const pad = h('button.rh-cal-pad', { type: 'button', 'aria-label': 'Tap on every click' }, h('span.rh-cal-num', 'Start'));
  const num = pad.firstChild;
  const msg = h('div.rh-cal-msg', 'Tap the circle on every click you hear. The first four clicks count you in.');
  const actions = h('div.rh-cal-actions');
  const stop = () => { running = false; cancelAnimationFrame(raf); try { ctx?.close(); } catch {} ctx = null; };
  function click(at, accent) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1568 : 1046;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.5, at + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    o.connect(g); g.connect(ctx.destination); o.start(at); o.stop(at + 0.08);
  }
  function start() {
    stop();
    const AC = window.AudioContext || window.webkitAudioContext;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { msg.textContent = 'This browser can’t play the clicks.'; return; }
    ctx.resume?.();
    diffs = []; running = true; clear(actions);
    t0 = ctx.currentTime + 0.4;
    for (let i = 0; i < LEAD + CLICKS; i++) click(t0 + i * BEAT, i % 4 === 0);
    msg.textContent = 'Tap on every click…';
    const lat = () => (ctx.outputLatency || ctx.baseLatency || 0);
    const frame = () => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const heard = ctx.currentTime - lat();
      const i = Math.floor((heard - t0) / BEAT), ph = (heard - t0) / BEAT - i;
      pad.style.setProperty('--pulse', i >= 0 && i < LEAD + CLICKS ? String(Math.max(0, 1 - ph * 3)) : '0');
      num.textContent = i < 0 ? '…' : i < LEAD ? String(LEAD - i) : i < LEAD + CLICKS ? String(i - LEAD + 1) : '✓';
      if (heard > t0 + (LEAD + CLICKS) * BEAT + 0.3) finish();
    };
    frame();
  }
  function tap(e) {
    e.preventDefault(); e.stopPropagation();
    if (!running) { start(); return; }
    const at = ctx.currentTime + ((e.timeStamp || performance.now()) - performance.now()) / 1000;
    const i = Math.round((at - t0) / BEAT);
    if (i < LEAD || i >= LEAD + CLICKS) return;
    const d = (at - (t0 + i * BEAT)) * 1000;
    if (Math.abs(d) < 300) diffs.push(d);
    pad.classList.remove('hit'); void pad.offsetWidth; pad.classList.add('hit');
  }
  function finish() {
    stop();
    pad.style.setProperty('--pulse', '0');
    if (diffs.length < 8) { num.textContent = 'Again'; msg.textContent = `Only ${diffs.length} taps landed near a click — try again.`; return; }
    const s = [...diffs].sort((a, b) => a - b);
    const med = Math.round(s[s.length >> 1] / 5) * 5;
    const spread = Math.round((s[Math.floor(s.length * 0.75)] - s[Math.floor(s.length * 0.25)]) / 2);
    num.textContent = `${med > 0 ? '+' : ''}${med}`;
    msg.textContent = `Your latency: ${med > 0 ? '+' : ''}${med} ms (± ${spread} ms). Keep it?`;
    clear(actions);
    actions.append(
      h('button.pill.small', { type: 'button', onclick: (ev) => { ev.stopPropagation(); start(); } }, 'Again'),
      h('button.pill.primary.small', { type: 'button', onclick: (ev) => { ev.stopPropagation(); store.set('rhythmOffsetMs', med); onSave?.(med); toast(`Latency set to ${med} ms`); panel.close(); } }, 'Use it'));
  }
  pad.addEventListener('pointerdown', tap);
  const onKey = (e) => { if (e.key === ' ' || e.key === 'Enter') { if (!e.repeat) tap(e); } };
  window.addEventListener('keydown', onKey, true);
  const panel = openPanel({
    title: 'Calibrate', className: 'opts-panel rh-cal',
    build(body) { body.append(pad, msg, actions); },
    onClose() { stop(); window.removeEventListener('keydown', onKey, true); },
  });
  return panel;
}
