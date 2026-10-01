// Movies & shows screen: "Now playing" (title, season/episode, progress ring, time passed / left,
// skip, previous / next episode, info, cast, fun facts, suggestions, collection, audio & subtitles)
// and "Library" (Plex / Jellyfin). Google TV gets a full-screen D-pad remote instead.
import { h, iconBtn, onCircle, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { player } from '../core/player.js';
import { store } from '../core/store.js';
import { go } from '../core/router.js';
import { getService } from '../providers/registry.js';
import { fmtTime, angleFromCenter, distFromCenter, clamp } from '../core/util.js';
import { accentFromImage, paletteFromImage } from '../core/color.js';
import { toast, topPanel } from '../ui/overlay.js';
import { openDevices, openVolume, openTvRemote, buildTvRemote, openCustomizeControls } from './panels.js';
import { createMediaLibrary, runtimeOf } from '../views/media-library.js';
import { mediaFacts } from '../core/mediainfo.js';
import {
  currentDetails, openMediaEpisodes, openMediaInfo, openMediaCast, openMediaFacts, openMediaSuggestions, openMediaCollection, openMediaTracks, openMediaOptions,
} from './media-panels.js';

const RING_R = 47.4, C = 2 * Math.PI * RING_R;
// Content-aware mood from the genres (first match wins)
const MOODS = [
  ['horror', /horror|slasher|zombie/i], ['scifi', /sci-?fi|science fiction|space|cyberpunk/i], ['thriller', /thriller|crime|mystery|suspense|noir|detective/i],
  ['action', /action|war|western|martial/i], ['fantasy', /fantasy|adventure|magic/i], ['comedy', /comedy|family|animation|kids|children|anime|sitcom/i],
  ['music', /music|musical|concert/i], ['doc', /documentary|history|biograph|news|nature/i], ['romance', /romance|drama/i],
];
export function moodOf(m) {
  const g = (m?.genres || []).join(' ');
  if (!g) return 'default';
  return (MOODS.find(([, re]) => re.test(g)) || ['default'])[0];
}
const MOOD_COLOURS = {
  horror: ['#5a0610', '#1d0205', '#8a1020', '#2a0a2a'], scifi: ['#0a3b7a', '#12c2e9', '#3a0ca3', '#0b1e3f'], thriller: ['#0f3d3e', '#1b262c', '#2a6f7a', '#3b1d4a'],
  action: ['#ff6a00', '#0f4c75', '#ee0979', '#f7b733'], fantasy: ['#6a3093', '#f4c430', '#2c7744', '#a044ff'], comedy: ['#ffb347', '#ff6f91', '#ffd86b', '#7afcff'],
  music: ['#8e2de2', '#ff0080', '#4a00e0', '#00d2ff'], doc: ['#8d6e63', '#5d4037', '#a1887f', '#37474f'], romance: ['#ff9a9e', '#a18cd1', '#fbc2eb', '#f6416c'],
  default: ['#3a4a8a', '#8a3a6a', '#2a7a7a', '#6a5a2a'],
};
const timeOfDay = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function MediaScreen() {
  const prov = player.provider;
  const svc = getService(prov?.id) || { name: '', color: '#fff' };
  if (svc.remote) return RemoteScreen(svc);
  const app = document.getElementById('app');
  const caps = () => player.caps;

  // ---------- background ----------
  // poster · backdrop · blur · black · slides · aware (follows what you're looking at, graded by genre)
  // · aurora (soft moving colours taken from the content)
  const bgA = h('div.mbg-img'), bgB = h('div.mbg-img');
  const blobs = [0, 1, 2, 3].map((i) => h(`div.mbg-blob.b${i}`));
  const aurora = h('div.mbg-aurora', blobs);
  const mood = h('div.mbg-mood');
  const bg = h('div.mbg', bgA, bgB, aurora, mood, h('div.mbg-shade'));
  let bgFront = bgA, bgUrl = null, slides = [], slideI = 0, slideT = 0, libCtx = null;
  function setBg(url) {
    if (url === bgUrl) return;
    bgUrl = url;
    const back = bgFront === bgA ? bgB : bgA;
    back.style.backgroundImage = url ? `url("${url}")` : '';
    back.classList.remove('kb'); void back.offsetWidth; back.classList.add('kb');
    back.classList.add('on'); bgFront.classList.remove('on');
    bgFront = back;
  }
  /** What the background is about right now: the Library page you're on, or what's playing. */
  function bgSource() {
    const mode = store.get('mediaBg');
    if (tab === 'lib' && libCtx && (mode === 'aware' || mode === 'aurora')) return libCtx;
    const m = player.state.track?.media;
    return m ? { ...m, genres: details?.genres || m.genres || [], type: m.type } : null;
  }
  function refreshBg() {
    const m = bgSource();
    const mode = store.get('mediaBg');
    el.dataset.bg = mode;
    el.dataset.mood = mode === 'aware' || mode === 'aurora' ? moodOf(m) : '';
    clearInterval(slideT);
    if (mode === 'aurora') { setBg(''); paintAurora(m); return; }
    if (!m || mode === 'black') { setBg(''); return; }
    if (mode === 'poster') return setBg(m.poster || m.backdrop || '');
    if (mode === 'backdrop' || mode === 'blur' || mode === 'aware') return setBg(m.backdrop || m.poster || '');
    // slideshow: the item's own pictures first, then collection / related / show pictures once details are in
    slides = [m.backdrop, m.still, ...(details?.backdrops || [])].filter(Boolean).filter((u, i, a) => a.indexOf(u) === i);
    if (!slides.length && m.poster) slides = [m.poster];
    slideI = 0;
    setBg(slides[0] || '');
    slideT = setInterval(() => { if (slides.length > 1) setBg(slides[++slideI % slides.length]); }, Math.max(4, store.get('mediaSlideSec') || 10) * 1000);
    const key = m.itemId;
    if (details && prov.slideImages) prov.slideImages(details).then((list) => { if (key === player.state.track?.media?.itemId && list.length) slides = [...new Set([...slides, ...list])]; }).catch(() => {});
  }
  async function paintAurora(m) {
    const moodCols = MOOD_COLOURS[moodOf(m)] || MOOD_COLOURS.default;
    const set = (cols) => blobs.forEach((b, i) => { const c = cols[i % cols.length]; b.style.color = Array.isArray(c) ? `rgb(${c.join(',')})` : c; });
    set(moodCols);
    const url = m?.poster || m?.backdrop;
    if (!url) return;
    const pal = await paletteFromImage(url).catch(() => null);
    if (pal?.length && (bgSource()?.poster || bgSource()?.backdrop) === url) set(pal.length >= 3 ? pal : [...pal, ...moodCols]);
  }
  // ---------- ring ----------
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.setAttribute('viewBox', '0 0 100 100');
  ring.classList.add('ring');
  ring.innerHTML = `
    <circle class="ring-track" cx="50" cy="50" r="${RING_R}"/>
    <circle class="ring-fill" cx="50" cy="50" r="${RING_R}" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 50 50)"/>
    <circle class="ring-knob" cx="50" cy="${50 - RING_R}" r="1.35"/>`;
  const ringFill = ring.querySelector('.ring-fill'), ringKnob = ring.querySelector('.ring-knob');

  // ---------- chrome ----------
  const tabNow = h('button.m-tab.on', { type: 'button', onclick: (e) => { e.stopPropagation(); setTab('now'); } }, 'Now playing');
  const tabLib = h('button.m-tab', { type: 'button', onclick: (e) => { e.stopPropagation(); setTab('lib'); } }, 'Library');
  const tabs = h('div.m-tabs', tabNow, tabLib);
  const btnHome = onCircle(iconBtn('home', 'Services', () => go('home'), 'mp-home'), -42, 38.5);
  const btnDev = onCircle(iconBtn('devices', 'Devices', () => openDevices(), 'mp-devices'), 42, 38.5);
  const pill = h('button.device-pill.m-pill', { type: 'button', onclick: (e) => { e.stopPropagation(); openDevices(); } },
    h('span.dot', { '--c': svc.color }), h('span.pill-text', svc.name));
  const btnVol = onCircle(iconBtn('volume', 'Volume', () => openVolume(), 'mp-volume'), -110, 38.5);
  const btnMore = onCircle(iconBtn('more', 'Options', () => openMediaOptions({ onRemote: openTvRemote }), 'mp-options'), 110, 38.5);

  const kicker = h('div.m-kicker'), title = h('div.m-title', { dir: 'auto' }), sub = h('div.m-sub', { dir: 'auto' });
  const meta = h('div.m-meta', kicker, title, sub);
  const tCur = h('span.m-cur', '0:00'), tRem = h('span.m-rem', ''), tEnds = h('span.m-ends', '');
  const times = h('div.m-times', tCur, tEnds, tRem);

  const skipBtn = (dir) => {
    const b = iconBtn(dir < 0 ? 'replay' : 'forward', dir < 0 ? 'Skip back' : 'Skip forward', () => player.seekBy(dir * (store.get(dir < 0 ? 'mediaSkipBack' : 'mediaSkipFwd') || 10) * 1000), 'ctl m-skip');
    b.append(h('span.sk-n'));
    return b;
  };
  const btnPrevEp = iconBtn('prev', 'Previous episode', () => player.prev(), 'ctl m-ep');
  const btnBack = skipBtn(-1), btnFwd = skipBtn(1);
  const btnPlay = iconBtn('play', 'Play', () => player.toggle(), 'ctl play');
  const btnNextEp = iconBtn('next', 'Next episode', () => player.next(), 'ctl m-ep');
  const controls = h('div.m-controls', btnPrevEp, btnBack, btnPlay, btnFwd, btnNextEp);

  const openDetailInLibrary = (entry) => { setTab('lib'); lib()?.openDetail(entry); };
  const FUNCS = [
    { key: 'mediaEpisodes', icon: 'list', label: 'Seasons & episodes', ok: () => player.state.track?.media?.type === 'episode' && !!player.state.track?.media?.seriesId && !!prov.browse, run: openMediaEpisodes },
    { key: null, icon: 'apps', label: `Open ${svc.name}`, ok: () => !!caps().launch && !!prov.launch, run: () => prov.launch().then(() => toast(`Opening ${svc.name}…`)).catch((e) => toast(e?.userMessage || e?.message, { kind: 'error' })) },
    { key: 'mediaInfo', icon: 'about', label: 'Info', ok: () => !!player.state.track?.media, run: openMediaInfo },
    { key: 'mediaCast', icon: 'people', label: 'Cast', ok: () => !!prov.details && !!player.state.track?.media?.itemId && (!details || details.cast?.length > 0), run: openMediaCast },
    { key: 'mediaFacts', icon: 'bulb', label: 'Fun facts', ok: () => !!player.state.track?.media, run: openMediaFacts },
    { key: 'mediaSuggest', icon: 'sparkle', label: 'More like this', ok: () => !!prov.related, run: () => openMediaSuggestions(openDetailInLibrary) },
    { key: 'mediaCollection', icon: 'stack', label: 'Collection', ok: () => !!prov.collectionsFor && hasCollection !== false, run: () => openMediaCollection(openDetailInLibrary) },
    { key: 'mediaTracks', icon: 'subtitles', label: 'Audio & subtitles', ok: () => !!caps().tracks && !!prov.streams, run: openMediaTracks },
    { key: null, icon: 'remote', label: 'TV remote', ok: () => !!caps().remote, run: openTvRemote },
    { key: 'mediaStop', icon: 'stop', label: 'Stop', ok: () => !!caps().stop, run: async () => { try { await (prov.stopPlayback?.() ?? prov.pause()); toast('Stopped'); } catch (e) { toast(e?.userMessage || e?.message, { kind: 'error' }); } } },
  ].map((f) => ({ ...f, btn: iconBtn(f.icon, f.label, () => f.run(), 'm-fn') }));
  const funcs = h('div.m-funcs', FUNCS.map((f) => f.btn));

  const cta = h('div.m-cta');
  const hud = h('div.m-hud', h('div.m-hud-title'), h('div.m-hud-time'));
  const clock = h('div.m-clock');
  const idleFact = h('div.m-idlefact');
  const libBox = h('div.m-lib');
  const chrome = h('div.chrome.m-chrome', tabs, btnHome, btnDev, pill, btnVol, btnMore, meta, times, controls, funcs, cta);
  const bubble = h('div.scrub-bubble', h('div.sb-time'), h('div.sb-rem'));
  // "Skip intro" / "Skip credits": pops up here while the TV shows its own button (Plex markers, Jellyfin media segments)
  const skipPop = h('button.m-skippop', { type: 'button', 'aria-live': 'polite', onclick: (e) => { e.stopPropagation(); doSkip(); } },
    h('span.msp-fill'), h('span.msp-icon'), h('span.msp-label'));
  const el = h('div.media', bg, hud, clock, idleFact, libBox, chrome, ring, bubble, skipPop);
  el.classList.toggle('has-lib', !!caps().library);

  // ---------- tabs ----------
  let tab = 'now', library = null;
  const lib = () => {
    if (!library && prov.browse) {
      library = createMediaLibrary({ provider: prov, onPlayed: () => setTimeout(() => setTab('now'), 1200), onNeedDevice: openDevices, onContext: (c) => { libCtx = c; refreshBgIfChanged(); } });
      libBox.append(library.el);
    }
    return library;
  };
  function setTab(t) {
    if (t === 'lib' && !caps().library) return;
    if (t === tab && !(t === 'lib' && library)) { if (t === 'lib') library?.home(); }
    tab = t;
    el.dataset.tab = t;
    lastSec = -1;   // re-check the skip button now
    tabNow.classList.toggle('on', t === 'now'); tabLib.classList.toggle('on', t === 'lib');
    if (t === 'lib') lib();
    refreshBgIfChanged();
    showChrome();
  }
  el.dataset.tab = 'now';

  // ---------- chrome auto-hide ----------
  let hideT = null;
  function showChrome() {
    el.classList.remove('chrome-hidden');
    clearTimeout(hideT); hideT = null;
    if (tab === 'now' && store.get('mediaAutoHide') && player.state.isPlaying && player.state.track) {
      hideT = setTimeout(() => { if (!topPanel() && tab === 'now') el.classList.add('chrome-hidden'); }, 7000);
    }
  }

  // ---------- ring seeking ----------
  let ringDrag = null, previewMs = null, wasHidden = false;
  const preview = (ms) => {
    previewMs = ms;
    if (ms == null) { bubble.classList.remove('show'); return; }
    bubble.classList.add('show');
    bubble.firstChild.textContent = fmtTime(ms);
    bubble.lastChild.textContent = `-${fmtTime(player.duration() - ms)}`;
    drawRing(ms);
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.m-skippop')) return;   // skipping shouldn't bring the controls back
    wasHidden = el.classList.contains('chrome-hidden');
    showChrome();
    if (tab !== 'now' || !caps().seek || !player.state.track || !player.duration()) return;
    if (distFromCenter(el, e.clientX, e.clientY) < 0.92 || e.target.closest?.('button')) return;
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
  // tap on empty space: hide the controls (tap again shows them)
  el.addEventListener('click', (e) => {
    if (tab !== 'now' || e.target.closest('button, .m-lib, .panel')) return;
    if (!wasHidden && player.state.track && store.get('mediaAutoHide')) { clearTimeout(hideT); el.classList.add('chrome-hidden'); }
  });

  // hold an empty part of the screen: show/hide parts of the controls
  let holdT = 0, holdXY = null;
  el.addEventListener('pointerdown', (e) => {
    if (tab !== 'now' || e.target.closest('button, .m-lib, .panel, input')) return;
    holdXY = [e.clientX, e.clientY]; clearTimeout(holdT);
    holdT = setTimeout(() => { holdXY = null; openCustomizeControls('media'); }, 900);
  });
  el.addEventListener('pointermove', (e) => { if (holdXY && Math.hypot(e.clientX - holdXY[0], e.clientY - holdXY[1]) > 12) clearTimeout(holdT); });
  ['pointerup', 'pointercancel'].forEach((ev) => el.addEventListener(ev, () => clearTimeout(holdT)));

  // ---------- details of what's playing ----------
  let details = null, detailsKey = null, hasCollection = null, facts = [], factI = 0;
  async function loadDetails() {
    const m = player.state.track?.media;
    const key = m ? `${m.itemId || m.title}|${m.episode || ''}` : null;
    if (key === detailsKey) return;
    detailsKey = key; details = null; hasCollection = null; facts = [];
    if (!m) return;
    const d = await currentDetails();
    if (key !== detailsKey) return;
    details = d;
    renderMeta(player.state);
    if (['slides', 'aware', 'aurora'].includes(store.get('mediaBg'))) { bgKey = null; refreshBgIfChanged(); }
    if (prov.collectionsFor && store.get('mediaCollection')) {
      prov.collectionsFor(d).then((c) => { if (key === detailsKey) { hasCollection = c.length > 0; renderFuncs(); } }).catch(() => { hasCollection = false; renderFuncs(); });
    }
    if (store.get('mediaIdleFacts')) mediaFacts(d).then((f) => { if (key === detailsKey) { facts = f; factI = 0; } }).catch(() => {});
    renderFuncs();
  }

  // ---------- skip intro / credits ----------
  let markers = [], markersKey, curMarker = null;
  const skipped = new Set(), autoSkipped = new Set();
  const SKIP_LABEL = { intro: 'Skip intro', recap: 'Skip recap', credits: 'Skip credits', preview: 'Skip preview', ad: 'Skip ad' };
  const mkey = (mk) => `${markersKey}|${mk.kind}|${mk.startMs}`;
  async function loadMarkers() {
    const id = player.state.track?.media?.itemId || null;
    if (id === markersKey) return;
    markersKey = id; markers = []; paintSkip(null);
    if (!id || !prov.markers) return;
    try { const list = await prov.markers(id); if (markersKey === id) { markers = list || []; lastSec = -1; } } catch {}
  }
  /** What the button does: credits at the very end of an episode → next episode (like the TV), otherwise jump past. */
  function skipAction(mk) {
    const dur = player.duration();
    const atEnd = mk.final || (dur && mk.endMs >= dur - 20000);
    const nextEp = mk.kind === 'credits' && atEnd && player.state.track?.media?.type === 'episode' && caps().next && caps().adjacent;
    return nextEp ? { next: true, label: 'Next episode', icon: 'next' } : { next: false, label: SKIP_LABEL[mk.kind] || 'Skip', icon: 'skip' };
  }
  function paintSkip(mk) {
    if (mk === curMarker && mk) return;
    curMarker = mk;
    el.classList.toggle('skip-on', !!mk);
    if (!mk) { skipPop.classList.remove('on'); return; }
    const a = skipAction(mk);
    skipPop.querySelector('.msp-label').textContent = a.label;
    skipPop.querySelector('.msp-icon').innerHTML = icon(a.icon);
    skipPop.setAttribute('aria-label', a.label);
    skipPop.classList.remove('on'); void skipPop.offsetWidth; skipPop.classList.add('on');
    navigator.vibrate?.(12);
  }
  async function doSkip(auto = false) {
    const mk = curMarker;
    if (!mk) return;
    const k = mkey(mk), a = skipAction(mk);
    skipped.add(k); paintSkip(null);
    try {
      if (a.next) await player.next();
      else await player.seek(Math.min(mk.endMs + 250, Math.max(0, (player.duration() || Infinity) - 1000)));
      if (auto) toast(a.label.replace(/^Skip /, 'Skipped '));
    } catch (e) { skipped.delete(k); toast(e?.userMessage || e?.message || 'Couldn’t skip', { kind: 'error' }); }
  }
  /** Called every second with the position: show / hide the button, auto-skip intros and recaps if asked. */
  function tickSkip(pos) {
    const mk = markers.length && player.state.track && caps().seek && !ringDrag
      ? markers.find((m) => pos >= m.startMs - 300 && pos < m.endMs - 1500) || null : null;
    for (const k of [...skipped]) if (!mk || mkey(mk) !== k) skipped.delete(k);   // left the part: the button can come back
    if (mk && store.get('mediaAutoSkip') && ['intro', 'recap'].includes(mk.kind) && player.state.isPlaying && !autoSkipped.has(mkey(mk))) {
      autoSkipped.add(mkey(mk)); curMarker = mk; doSkip(true); return;
    }
    const show = mk && tab === 'now' && store.get('mediaSkipPop') !== false && !skipped.has(mkey(mk)) ? mk : null;
    paintSkip(show);
    if (show) skipPop.style.setProperty('--p', clamp((pos - mk.startMs) / Math.max(1, mk.endMs - mk.startMs), 0, 1).toFixed(3));
  }

  // ---------- state → UI ----------
  function drawRing(pos) {
    const d = player.duration();
    const p = d ? clamp(pos / d, 0, 1) : 0;
    ringFill.setAttribute('stroke-dashoffset', (C * (1 - p)).toFixed(2));
    const a = p * Math.PI * 2;
    ringKnob.setAttribute('cx', (50 + RING_R * Math.sin(a)).toFixed(2));
    ringKnob.setAttribute('cy', (50 - RING_R * Math.cos(a)).toFixed(2));
  }
  function renderMeta(s) {
    const t = s.track, m = t?.media;
    const d = details || m || {};
    if (!t) { clear(kicker); title.textContent = ''; sub.textContent = ''; return; }
    const ep = (m?.type || d.type) === 'episode';
    const dur = t.durationMs || d.durationMs;
    kicker.textContent = ep
      ? [m?.season != null ? `Season ${m.season}` : '', m?.episode != null ? `Episode ${m.episode}` : '', d.contentRating].filter(Boolean).join('  ·  ')
      : [m?.year || d.year, dur ? runtimeOf(dur) : '', d.contentRating, d.rating ? `★ ${d.rating}` : ''].filter(Boolean).join('  ·  ');
    title.textContent = ep ? (m?.show || t.title) : (m?.title || t.title);
    title.classList.toggle('long', title.textContent.length > 26);
    sub.textContent = ep ? (m?.title || '') : (details?.tagline || (details?.genres || []).slice(0, 3).join(' · ') || t.artist || '');
    hud.firstChild.textContent = ep ? `${m?.show || t.title} · S${m?.season ?? '?'}E${m?.episode ?? '?'}` : title.textContent;
  }
  function renderFuncs() {
    let n = 0;
    for (const f of FUNCS) { const on = !!player.state.track && (!f.key || store.get(f.key)) && f.ok(); f.btn.hidden = !on; if (on) n++; }
    funcs.hidden = !n;
  }
  function render(s) {
    const t = s.track, m = t?.media, c = caps();
    btnPlay.innerHTML = icon(s.isPlaying ? 'pause' : 'play');
    btnPlay.setAttribute('aria-label', s.isPlaying ? 'Pause' : 'Play');
    btnPlay.classList.toggle('is-playing', !!s.isPlaying);
    const epNav = c.adjacent ? m?.type === 'episode' : true;
    btnPrevEp.hidden = !store.get('mediaPrevNext') || !epNav || !c.prev;
    btnNextEp.hidden = !store.get('mediaPrevNext') || !epNav || !c.next;
    btnPrevEp.setAttribute('aria-label', m?.type === 'episode' ? 'Previous episode' : 'Previous');
    btnNextEp.setAttribute('aria-label', m?.type === 'episode' ? 'Next episode' : 'Next');
    const skip = store.get('mediaSkip') && c.seek;
    btnBack.hidden = !skip; btnFwd.hidden = !skip;
    btnBack.querySelector('.sk-n').textContent = store.get('mediaSkipBack');
    btnFwd.querySelector('.sk-n').textContent = store.get('mediaSkipFwd');
    btnVol.disabled = !c.volume;
    btnVol.innerHTML = icon(s.muted || s.volume === 0 ? 'mute' : s.volume != null && s.volume < 45 ? 'volumeLow' : 'volume');
    btnDev.disabled = !c.devices;
    pill.querySelector('.pill-text').textContent = s.device?.name ? `${svc.short || svc.name} · ${s.device.name}` : svc.name;
    el.classList.toggle('no-track', !t);
    el.classList.toggle('no-seek', !c.seek);
    el.classList.toggle('no-dur', !player.duration());
    el.classList.toggle('playing', !!s.isPlaying);
    el.classList.toggle('has-lib', !!c.library);
    renderMeta(s);
    renderFuncs();
    clear(cta);
    if (!t && s.status !== 'loading') {
      cta.append(h('div.cta-msg', s.message || 'Nothing playing'));
      const row = h('div.cta-row');
      if (c.devices) row.append(h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); openDevices(); } }, 'Devices'));
      if (c.library) row.append(h('button.pill.primary', { type: 'button', onclick: (e) => { e.stopPropagation(); setTab('lib'); } }, 'Library'));
      if (c.launch && prov.launch) row.append(h('button.pill.primary', { type: 'button', onclick: (e) => { e.stopPropagation(); prov.launch().then(() => toast(`Opening ${svc.name}…`)).catch((er) => toast(er?.userMessage || er?.message, { kind: 'error' })); } }, `Open ${svc.name}`));
      if (c.remote) row.append(h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); openTvRemote(); } }, 'Remote'));
      if (s.status === 'error') row.append(h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); go('connect', { id: prov.id }); } }, 'Setup'));
      cta.append(row);
    } else if (!t) cta.append(h('div.cta-msg', 'Connecting…'));
    if (m?.poster && store.get('artAccent')) accentFromImage(m.poster).then((a) => { if (a && player.state.track?.media?.poster === m.poster) app.style.setProperty('--accent', a); }).catch(() => {});
    else if (!t) app.style.setProperty('--accent', svc.color);
    refreshBgIfChanged();
    loadDetails();
    loadMarkers();
    if (!s.isPlaying) { clearTimeout(hideT); hideT = null; el.classList.remove('chrome-hidden'); }
    else if (!hideT && !el.classList.contains('chrome-hidden')) showChrome();
  }
  let bgKey = null;
  function refreshBgIfChanged() {
    const m = bgSource();
    const k = `${store.get('mediaBg')}|${tab}|${m?.itemId || m?.id || m?.title || ''}|${m?.poster || ''}|${m?.backdrop || ''}|${(m?.genres || []).join(',')}`;
    if (k !== bgKey) { bgKey = k; refreshBg(); }
  }

  const applyOpts = () => {
    el.classList.toggle('hud-on', !!store.get('mediaHud'));
    el.classList.toggle('clock-on', !!store.get('mediaClock'));
    el.classList.toggle('facts-on', !!store.get('mediaIdleFacts'));
    el.classList.toggle('no-pill', store.get('showDevicePill') === false);
    el.classList.toggle('lite-bg', !!store.get('liteMode'));
    el.dataset.hide = (store.get('mediaHide') || []).join(' ');
    render(player.state);
  };
  const offs = [
    ...['mediaHide', 'mediaEpisodes', 'mediaHud', 'mediaClock', 'mediaIdleFacts', 'showDevicePill', 'mediaPrevNext', 'mediaSkip', 'mediaSkipBack', 'mediaSkipFwd',
      'mediaInfo', 'mediaCast', 'mediaFacts', 'mediaSuggest', 'mediaCollection', 'mediaTracks', 'mediaStop', 'mediaEndsAt'].map((k) => store.on(`change:${k}`, applyOpts)),
    store.on('change:mediaBg', () => { bgKey = null; refreshBgIfChanged(); }),
    store.on('change:mediaSkipPop', () => { lastSec = -1; }),
    store.on('change:mediaSlideSec', () => { bgKey = null; refreshBgIfChanged(); }),
    store.on('change:mediaIdleFacts', () => { detailsKey = null; loadDetails(); }),
    store.on('change:mediaHideWatched', () => { if (library) { library.el.remove(); library = null; if (tab === 'lib') lib(); } }),
    player.on('state', render),
    player.on('error', (msg) => toast(msg, { kind: 'error' })),
  ];

  // ---------- animation loop ----------
  let raf = 0, lastSec = -1, factAt = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const pos = player.position(), dur = player.duration();
    drawRing(previewMs ?? pos);
    const sec = Math.floor(pos / 1000);
    if (sec === lastSec) return;
    lastSec = sec;
    tickSkip(pos);
    tCur.textContent = fmtTime(pos);
    tRem.textContent = dur ? `-${fmtTime(Math.max(0, dur - pos))}` : '';
    const ends = dur && store.get('mediaEndsAt') ? `Ends ${timeOfDay(new Date(Date.now() + Math.max(0, dur - pos)))}` : '';
    tEnds.textContent = ends;
    hud.lastChild.textContent = dur ? `${fmtTime(Math.max(0, dur - pos))} left${ends ? ` · ${ends.toLowerCase()}` : ''}` : '';
    clock.textContent = timeOfDay(new Date());
    if (facts.length && Date.now() - factAt > (store.get('factSeconds') || 12) * 1000) {
      factAt = Date.now();
      const f = facts[factI++ % facts.length];
      idleFact.classList.remove('in'); void idleFact.offsetWidth;
      idleFact.textContent = f.text; idleFact.dir = f.dir; idleFact.classList.add('in');
    }
  }

  applyOpts();
  frame();
  if (!player.state.track && prov?.state?.track) render(prov.state);

  return {
    el,
    showChrome,
    setTab,
    destroy() { cancelAnimationFrame(raf); clearTimeout(hideT); clearInterval(slideT); offs.forEach((f) => f()); library?.destroy(); },
  };
}

// ---------------------------------------------------------------- Google TV: the screen is the remote
function RemoteScreen(svc) {
  const body = h('div.tvs-body');
  const pill = h('button.device-pill.tvs-pill', { type: 'button', onclick: (e) => { e.stopPropagation(); openDevices(); } },
    h('span.dot', { '--c': svc.color }), h('span.pill-text', svc.name));
  const home = iconBtn('home', 'Services', () => go('home'), 'tvs-home');
  const el = h('div.media.tv-screen', h('div.tvs-glow'), body, pill, home);
  const off = buildTvRemote(body);
  const paint = (s) => { pill.querySelector('.pill-text').textContent = s.device?.name || (s.message ? s.message : svc.name); };
  paint(player.state);
  const off2 = player.on('state', paint);
  return { el, showChrome() {}, destroy() { off(); off2(); } };
}
