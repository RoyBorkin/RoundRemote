// The main remote screen: progress ring around the edge (drag to seek), transport
// controls, and one of three visualisations in the middle (info / vinyl / lyrics).
import { h, iconBtn, onCircle } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { player } from '../core/player.js';
import { store } from '../core/store.js';
import { go } from '../core/router.js';
import { getService } from '../providers/registry.js';
import { fmtTime, angleFromCenter, distFromCenter, clamp } from '../core/util.js';
import { accentFromImage } from '../core/color.js';
import { toast, topPanel } from '../ui/overlay.js';
import { createInfoView } from '../views/info.js';
import { createVinylView } from '../views/vinyl.js';
import { createLyricsView, LYRIC_STYLES } from '../views/lyrics.js';
import { createVideoView } from '../views/video.js';
import { createToneView } from '../views/tone.js';
import { createFactsView } from '../views/facts.js';
import { openLibrary, openSearch, openDevices, openVolume, openMore, openLyricStyles, openToneStyles, openFactsOptions } from './panels.js';

const VIEWS = ['info', 'vinyl', 'lyrics', 'video', 'tone', 'facts'];
const VIEW_NAMES = { info: 'Classic', vinyl: 'Vinyl', lyrics: 'Lyrics', video: 'Video', tone: 'Tone Visual', facts: 'Fun Facts' };
const RING_R = 47.4, C = 2 * Math.PI * RING_R;

export function PlayerScreen() {
  const prov = player.provider;
  const svc = getService(prov?.id) || { name: '', color: '#fff' };
  const app = document.getElementById('app');

  // ---------- background ----------
  const bgA = h('div.bg-art'), bgB = h('div.bg-art');
  let bgFront = bgA, lastArt = null;

  // ---------- ring ----------
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.setAttribute('viewBox', '0 0 100 100');
  ring.classList.add('ring');
  ring.innerHTML = `
    <circle class="ring-track" cx="50" cy="50" r="${RING_R}"/>
    <circle class="ring-fill" cx="50" cy="50" r="${RING_R}" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 50 50)"/>
    <circle class="ring-knob" cx="50" cy="${50 - RING_R}" r="1.35"/>`;
  const ringFill = ring.querySelector('.ring-fill');
  const ringKnob = ring.querySelector('.ring-knob');

  // ---------- chrome ----------
  const btnHome = onCircle(iconBtn('home', 'Services', () => go('home')), -55, 38.5);
  const btnLib = onCircle(iconBtn('library', 'Playlists', () => openLibrary()), -20, 38.5);
  const btnSearch = onCircle(iconBtn('search', 'Search', () => openSearch()), 20, 38.5);
  const btnDev = onCircle(iconBtn('speaker', 'Devices', () => openDevices()), 55, 38.5);
  const pill = h('button.device-pill', { type: 'button', onclick: (e) => { e.stopPropagation(); openDevices(); } },
    h('span.dot', { '--c': svc.color }), h('span.pill-text', svc.name));
  const btnVol = onCircle(iconBtn('volume', 'Volume', () => openVolume()), -118, 38.5);
  const btnSide = onCircle(iconBtn('more', 'More', () => (view === 'lyrics' ? openLyricStyles() : view === 'tone' ? openToneStyles() : view === 'facts' ? openFactsOptions() : openMore(view))), 118, 38.5);
  const btnPrev = iconBtn('prev', 'Previous', () => player.prev(), 'ctl');
  const btnPlay = iconBtn('play', 'Play', () => player.toggle(), 'ctl play');
  const btnNext = iconBtn('next', 'Next', () => player.next(), 'ctl');
  const controls = h('div.controls', btnPrev, btnPlay, btnNext);
  const tCur = h('span.t-cur', '0:00'), tDur = h('span.t-dur', '0:00');
  const viewBtns = VIEWS.map((v) => {
    const b = iconBtn(v === 'facts' ? 'bulb' : v, `${VIEW_NAMES[v]} view`, () => setView(v), 'vbtn');
    b.dataset.v = v; return b;
  });
  const viewSwitch = h('div.view-switch', tCur, h('div.vbtns', viewBtns), tDur);
  const miniMeta = h('div.mini-meta');
  const cta = h('div.cta');
  const chrome = h('div.chrome', btnHome, btnLib, btnSearch, btnDev, pill, miniMeta, btnVol, btnSide, cta, controls, viewSwitch);

  const bubble = h('div.scrub-bubble', h('div.sb-time'), h('div.sb-rem'));
  const stage = h('div.stage');
  const el = h('div.player', bgA, bgB, h('div.bg-shade'), stage, chrome, ring, bubble);

  // ---------- views ----------
  let view = store.get('view');
  if (!VIEWS.includes(view)) view = 'info';
  let current = null, previewMs = null;
  const preview = (ms) => {
    previewMs = ms;
    if (ms == null) { bubble.classList.remove('show'); return; }
    bubble.classList.add('show');
    bubble.firstChild.textContent = fmtTime(ms);
    bubble.lastChild.textContent = `-${fmtTime(player.duration() - ms)}`;
    drawRing(ms);
  };
  function setView(v) {
    if (v === view && current) return;
    view = v; store.set('view', v);
    current?.destroy(); current?.el.remove();
    current = v === 'vinyl' ? createVinylView({ player, onPreview: preview })
      : v === 'lyrics' ? createLyricsView({ player })
      : v === 'video' ? createVideoView({ player })
      : v === 'tone' ? createToneView({ player })
      : v === 'facts' ? createFactsView({ player })
      : createInfoView();
    stage.appendChild(current.el);
    current.update(player.state);
    el.dataset.view = v;
    viewBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    btnSide.innerHTML = icon(v === 'lyrics' ? 'text' : v === 'tone' ? 'tone' : v === 'facts' ? 'bulb' : 'more');
    placeYt();
    btnSide.setAttribute('aria-label', v === 'lyrics' ? 'Lyrics style' : v === 'tone' ? 'Tone Visual style' : v === 'facts' ? 'Fun Facts options' : 'More');
    showChrome();
  }

  // ---------- YouTube player placement (YouTube/YouTube Music keep their video visible) ----------
  function placeYt() {
    const hidden = el.classList.contains('chrome-hidden');
    app.dataset.ytpos = view === 'video' ? 'bg' : view === 'info' && hidden ? 'full' : view;
    app.style.setProperty('--lbl', store.get('vinylLabelSize'));
  }
  const ytObserver = new MutationObserver(placeYt);
  ytObserver.observe(el, { attributes: true, attributeFilter: ['class'] });

  // ---------- chrome auto-hide ----------
  let hideT = null;
  function showChrome() {
    el.classList.remove('chrome-hidden');
    clearTimeout(hideT);
    const auto = store.get('autoHideChrome') && !(view === 'info' && store.get('infoAutoHide') === false);
    if (auto) hideT = setTimeout(() => { if (!topPanel()) el.classList.add('chrome-hidden'); }, 6000);
  }

  // ---------- ring seeking ----------
  let ringDrag = null, wasHidden = false;
  el.addEventListener('pointerdown', (e) => {
    wasHidden = el.classList.contains('chrome-hidden');
    showChrome();
    if (!player.caps.seek || !player.state.track) return;
    if (distFromCenter(el, e.clientX, e.clientY) < 0.9) return;
    e.stopPropagation();
    ringDrag = { id: e.pointerId };
    el.setPointerCapture(e.pointerId);
    ring.classList.add('drag');
    moveRing(e);
  }, true);
  function moveRing(e) {
    let a = angleFromCenter(el, e.clientX, e.clientY);
    if (a < 0) a += Math.PI * 2;
    const frac = a / (Math.PI * 2);
    // Don't wrap across 12 o'clock mid-drag.
    if (ringDrag.last != null && Math.abs(frac - ringDrag.last) > 0.5) return;
    ringDrag.last = frac;
    ringDrag.ms = frac * player.duration();
    preview(ringDrag.ms);
  }
  el.addEventListener('pointermove', (e) => { if (ringDrag && e.pointerId === ringDrag.id) moveRing(e); });
  const endRing = (e) => {
    if (!ringDrag || e.pointerId !== ringDrag.id) return;
    const ms = ringDrag.ms; ringDrag = null;
    ring.classList.remove('drag');
    preview(null);
    if (ms != null) player.seek(ms);
  };
  el.addEventListener('pointerup', endRing);
  el.addEventListener('pointercancel', endRing);

  // ---------- swipe between views / tap to toggle chrome ----------
  let sw = null;
  stage.addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY, t: performance.now(), hidden: wasHidden }; });
  stage.addEventListener('pointerup', (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y, dt = performance.now() - sw.t;
    const wasHidden = sw.hidden; sw = null;
    if (!current?.isInteractive && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) {
      const i = VIEWS.indexOf(view);
      setView(VIEWS[(i + (dx < 0 ? 1 : VIEWS.length - 1)) % VIEWS.length]);
      return;
    }
    if (Math.hypot(dx, dy) < 10 && !wasHidden && store.get('autoHideChrome')) {
      clearTimeout(hideT); el.classList.add('chrome-hidden');
    }
  });

  // ---------- state → UI ----------
  let lastDur = -1;
  function drawRing(pos) {
    const d = player.duration();
    const p = d ? clamp(pos / d, 0, 1) : 0;
    ringFill.setAttribute('stroke-dashoffset', (C * (1 - p)).toFixed(2));
    const a = p * Math.PI * 2;
    ringKnob.setAttribute('cx', (50 + RING_R * Math.sin(a)).toFixed(2));
    ringKnob.setAttribute('cy', (50 - RING_R * Math.cos(a)).toFixed(2));
  }
  async function applyArt(url) {
    if (url === lastArt) return;
    lastArt = url;
    const back = bgFront === bgA ? bgB : bgA;
    back.style.backgroundImage = url ? `url("${url}")` : '';
    back.classList.add('on'); bgFront.classList.remove('on');
    bgFront = back;
    let accent = null;
    if (store.get('artAccent') && url) accent = await accentFromImage(url);
    if (url === lastArt) app.style.setProperty('--accent', accent || svc.color);
  }
  function render(s) {
    const t = s.track;
    btnPlay.innerHTML = icon(s.isPlaying ? 'pause' : 'play');
    btnPlay.setAttribute('aria-label', s.isPlaying ? 'Pause' : 'Play');
    btnPlay.classList.toggle('is-playing', !!s.isPlaying);
    const c = player.caps;
    btnPrev.disabled = !c.prev; btnNext.disabled = !c.next;
    btnLib.disabled = !c.playlists; btnSearch.disabled = !c.search; btnDev.disabled = !c.devices;
    btnVol.disabled = !c.volume;
    btnVol.innerHTML = icon(s.muted || s.volume === 0 ? 'mute' : s.volume != null && s.volume < 45 ? 'volumeLow' : 'volume');
    pill.querySelector('.pill-text').textContent = s.device?.name ? `${svc.name} · ${s.device.name}` : svc.name;
    miniMeta.textContent = t ? `${t.title} — ${t.artist}` : '';
    el.classList.toggle('no-track', !t);
    el.classList.toggle('no-seek', !c.seek);
    if (t?.durationMs !== lastDur) { lastDur = t?.durationMs; tDur.textContent = fmtTime(t?.durationMs || 0); }
    // call-to-action when idle
    cta.innerHTML = '';
    if (!t && view !== 'info') cta.append(h('div.cta-msg', s.message || 'Nothing playing'));
    if (!t && s.status !== 'loading') {
      const row = h('div.cta-row');
      if (c.devices) row.append(h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); openDevices(); } }, 'Devices'));
      if (c.playlists) row.append(h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); openLibrary(); } }, 'Playlists'));
      if (s.status === 'error') row.append(h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); go('connect', { id: prov.id }); } }, 'Setup'));
      cta.append(row);
    }
    applyArt(t?.art || '');
    current?.update(s);
  }

  const applyArtMode = () => {
    const full = store.get('infoFullArt');
    el.classList.toggle('art-milky', full === 'milky');
    el.classList.toggle('info-card-mode', full === 'card-black' || full === 'card-blur');
    el.classList.toggle('card-blur', full === 'card-blur');
    el.classList.toggle('info-noart', store.get('infoShowArt') === false);
    el.classList.toggle('arm-autohide', store.get('vinylArmHide') !== false);
    el.classList.toggle('vinyl-notitle', store.get('vinylShowTitle') === false);
    el.classList.toggle('video-noart', store.get('videoShowArt') === false);
    el.classList.toggle('no-pill', store.get('showDevicePill') === false);
  };
  applyArtMode();
  const offs = [
    ...['infoFullArt', 'infoShowArt', 'vinylArmHide', 'vinylShowTitle', 'videoShowArt', 'showDevicePill'].map((k) => store.on(`change:${k}`, applyArtMode)),
    store.on('change:infoAutoHide', () => showChrome()),
    player.on('state', render),
    player.on('error', (m) => toast(m, { kind: 'error' })),
  ];

  // ---------- animation loop ----------
  let raf = 0, lastSec = -1;
  function frame() {
    raf = requestAnimationFrame(frame);
    const s = player.state;
    const pos = player.position();
    drawRing(previewMs ?? pos);
    const sec = Math.floor(pos / 1000);
    if (sec !== lastSec) { lastSec = sec; tCur.textContent = fmtTime(pos); }
    current?.tick(pos, s);
  }

  setView(view);
  render(player.state);
  frame();
  if (!player.state.track && prov?.state?.track) render(prov.state);

  return {
    el,
    destroy() { cancelAnimationFrame(raf); clearTimeout(hideT); ytObserver.disconnect(); app.dataset.ytpos = 'mini'; offs.forEach((f) => f()); current?.destroy(); },
    setView, showChrome,
    cycleLyricStyle() {
      const i = LYRIC_STYLES.findIndex((x) => x.id === store.get('lyricsStyle'));
      const n = LYRIC_STYLES[(i + 1) % LYRIC_STYLES.length];
      store.set('lyricsStyle', n.id); toast(`Lyrics: ${n.name}`);
    },
  };
}
