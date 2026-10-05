// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Home → music streamer (Fosi S3 and other StreamUnlimited StreamSDK streamers): one round screen.
//   • a big VOLUME RING around the rim — drag it anywhere like a knob (relative, so a stray tap never jumps the
//     volume), or turn the rotary knob / mouse wheel / ← → ↑ ↓; the number flashes over the artwork
//   • the artwork (or the input's own picture for Line In, Optical, HDMI, Bluetooth…) in the middle with the
//     track progress around it, title / artist / album, the service and the audio format (FLAC · 24-bit / 96 kHz)
//   • prev · play/pause (stop for inputs) · next, mute (the volume pill at the bottom)
//   • Sources (bottom left, or tap the name at the top): the streamer's own list — switch inputs, or how to
//     start Spotify / TIDAL / AirPlay… on it · Settings (bottom right): output RCA/XLR ↔ optical, shuffle /
//     repeat, standby, device info · Power (top right) when the streamer supports standby.
// Styles: css/streamer.css. Data + commands: js/providers/streamer.js.
import { h, iconBtn, onCircle, clear, badge } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast, spinner, topPanel, openPanel } from '../ui/overlay.js';
import { go } from '../core/router.js';
import { fmtTime, angleFromCenter, distFromCenter, angleDelta, lanImage } from '../core/util.js';
import { accentFromImage } from '../core/color.js';
import { getService, provider } from '../providers/registry.js';
import { bridgeBase } from '../providers/bridge.js';

// local glyphs (24×24) for inputs the shared icon set doesn't have
const G = {
  input: 'M11 7 9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z',
  bluetooth: 'M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z',
  linein: 'M5 2c0-.55-.45-1-1-1s-1 .45-1 1v4H1v6h6V6H5V2zm4 14c0 1.3.84 2.4 2 2.82V23h2v-4.18c1.16-.41 2-1.51 2-2.82v-2H9v2zm-8 0c0 1.3.84 2.4 2 2.82V23h2v-4.18C6.16 18.4 7 17.3 7 16v-2H1v2zM21 6V2c0-.55-.45-1-1-1s-1 .45-1 1v4h-2v6h6V6h-2zm-8-4c0-.55-.45-1-1-1s-1 .45-1 1v4H9v6h6V6h-2V2zm4 14c0 1.3.84 2.4 2 2.82V23h2v-4.18c1.16-.41 2-1.51 2-2.82v-2h-6v2z',
  hdmi: 'M18 7V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v3H5v6l3 6v3h8v-3l3-6V7h-1zM8 4h8v3h-2V5h-1v2h-2V5h-1v2H8V4z',
  optical: 'M7 3h10l3 3.5V16a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V6.5L7 3zm5 5.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  coax: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  usb: 'M15 7v4h1v2h-3V5h2l-3-4-3 4h2v8H8v-2.07c.7-.37 1.2-1.08 1.2-1.93 0-1.21-.99-2.2-2.2-2.2S4.8 7.79 4.8 9c0 .85.5 1.56 1.2 1.93V13c0 1.11.89 2 2 2h3v3.05c-.71.37-1.2 1.1-1.2 1.95a2.2 2.2 0 0 0 4.4 0c0-.85-.49-1.58-1.2-1.95V15h3c1.11 0 2-.89 2-2v-2h1V7h-4z',
  radio: 'M3.24 6.15C2.51 6.43 2 7.17 2 8v12a2 2 0 0 0 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34L15.88 1 3.24 6.15zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-8h-2v-2h-2v2H4V8h16v4z',
};
const svgIc = (d, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill-rule="evenodd"><path d="${d}"/></svg>`;
const glyphHtml = (k) => (G[k] ? svgIc(G[k]) : icon(k || 'speaker'));
const INPUT_SUB = { linein: 'Analog input', optical: 'Optical digital input', coax: 'Coaxial digital input', hdmi: 'HDMI ARC — the TV’s sound', bluetooth: 'Bluetooth', usb: 'USB input' };
const errMsg = (e) => e?.userMessage || e?.body?.error || e?.message || 'Something went wrong';

/** Round badge for a source: its logo (Simple Icons) or our own glyph for inputs. */
export function sourceBadge(src, size = '') {
  const k = src?.known, color = src?.color || k?.color || '#94a3b8';
  if (k?.icon) return badge({ color, mono: k.mono || k.name.slice(0, 2), icon: k.icon }, size);
  const glyph = k?.glyph;
  return h(`div.badge${glyph ? '.has-icon' : ''}${size ? '.' + size : ''}`, { '--c': color, 'aria-hidden': 'true' },
    h('span.badge-mono', k?.mono || src?.mono || '?'), glyph ? h('i.badge-glyph', { html: glyphHtml(glyph) }) : null);
}

/** Background image with a fade (keeps the last one until the next has loaded). */
function setBg(el, url) {
  if (el._want === url) return;
  el._want = url;
  if (!url) { el.classList.remove('in'); return; }
  lanImage(url).then((u) => {
    if (el._want !== url) return;
    const im = new Image();
    im.onload = () => { if (el._want !== url) return; el.style.backgroundImage = `url("${u}")`; el.classList.add('in'); };
    im.onerror = () => { if (el._want === url) el.classList.remove('in'); };
    im.src = u;
  });
}

export function StreamerScreen({ id }) {
  const svc = getService(id);
  const p = provider(id);
  const app = document.getElementById('app');

  // ---------- rim: volume ring (270°, gap at the bottom) + ticks
  const R = 46.4, SWEEP = 270, CIRC = 2 * Math.PI * R, ARC = CIRC * (SWEEP / 360);
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = ((-135 + 27 * i) * Math.PI) / 180, r1 = 48.9, r2 = i % 5 ? 49.5 : 49.9;
    return `<line x1="${(50 + r1 * Math.sin(a)).toFixed(2)}" y1="${(50 - r1 * Math.cos(a)).toFixed(2)}" x2="${(50 + r2 * Math.sin(a)).toFixed(2)}" y2="${(50 - r2 * Math.cos(a)).toFixed(2)}"/>`;
  }).join('');
  const rim = h('div.st-rim', { html: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <g class="st-ticks">${ticks}</g>
    <circle class="st-vtrack" cx="50" cy="50" r="${R}" stroke-dasharray="${ARC.toFixed(2)} ${CIRC.toFixed(2)}" transform="rotate(135 50 50)"/>
    <circle class="st-vfill" cx="50" cy="50" r="${R}" stroke-dasharray="0 ${CIRC.toFixed(2)}" transform="rotate(135 50 50)"/>
    <circle class="st-vknob" cx="50" cy="${50 - R}" r="1.9"/></svg>` });
  const vFill = rim.querySelector('.st-vfill'), vKnob = rim.querySelector('.st-vknob');

  // ---------- background
  const bg = h('div.st-bg'), scrim = h('div.st-scrim');

  // ---------- header + corner buttons
  const headName = h('span.st-hname'), headSrc = h('span.st-hsrc');
  const head = h('button.st-head', { type: 'button', 'aria-label': 'Sources', onclick: (e) => { e.stopPropagation(); openSources(); } },
    h('i.st-hdot'), headName, headSrc);
  const homeBtn = onCircle(iconBtn('home', 'Home menu', () => go('home'), 'st-corner'), -45, 37.2);
  const powerBtn = onCircle(iconBtn('power', 'Standby', () => togglePower(), 'st-corner st-pw'), 45, 37.2);
  // Sources and Settings sit in the ring's gap at the bottom, either side of the volume pill
  const srcBtn = onCircle(h('button.ibtn.st-corner.st-low.st-srcbtn', { type: 'button', 'aria-label': 'Sources', title: 'Sources', html: svgIc(G.input), onclick: (e) => { e.stopPropagation(); openSources(); } }), -158.5, 42.2);
  const setBtn = onCircle(iconBtn('settings', 'Streamer settings', () => openSettings(), 'st-corner st-low st-setbtn'), 158.5, 42.2);

  // ---------- centre: artwork / input visual, progress ring, volume flash
  const art = h('div.st-art');
  const visual = h('div.st-visual', h('i.st-rings', h('i'), h('i'), h('i')), h('div.st-vglyph'));
  const prog = h('div.st-prog', { html: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="st-ptrack" cx="50" cy="50" r="48.6" pathLength="1000"/><circle class="st-pfill" cx="50" cy="50" r="48.6" pathLength="1000" transform="rotate(-90 50 50)"/><circle class="st-pknob" cx="50" cy="1.4" r="1.6"/></svg>' });
  const pFill = prog.querySelector('.st-pfill'), pKnob = prog.querySelector('.st-pknob');
  const flashNum = h('b'), flash = h('div.st-flash', flashNum, h('span', 'Volume'));
  const disc = h('button.st-disc', { type: 'button', 'aria-label': 'Play / pause', onclick: (e) => { e.stopPropagation(); if (stateKind() === 'idle') openSources(); else act(() => p.toggle()); } }, visual, art, flash);
  const title = h('div.st-title'), sub = h('div.st-sub'), fmt = h('div.st-fmt');
  const meta = h('div.st-meta', title, sub, fmt);

  // ---------- transport + volume pill
  const btnPrev = iconBtn('prev', 'Previous', () => act(() => p.prev()), 'ctl st-prev');
  const btnPlay = iconBtn('play', 'Play', () => act(() => p.toggle()), 'ctl play st-play');
  const btnNext = iconBtn('next', 'Next', () => act(() => p.next()), 'ctl st-next');
  const tCur = h('span.st-t.cur'), tDur = h('span.st-t.dur');
  const controls = h('div.st-ctl', tCur, btnPrev, btnPlay, btnNext, tDur);
  const volIc = h('i.st-volic'), volNum = h('b.st-volnum');
  const volPill = h('button.st-vol', { type: 'button', 'aria-label': 'Mute', onclick: (e) => { e.stopPropagation(); act(() => p.setMute(!p.muted)); } }, volIc, volNum);

  const stateBox = h('div.st-state');
  const main = h('div.st-main', head, prog, disc, meta, controls, volPill);
  const el = h('div.st', { '--c': svc.color, dataset: { svc: id } }, bg, scrim, rim, main, stateBox, homeBtn, powerBtn, srcBtn, setBtn);

  async function act(fn) {
    try { await fn(); } catch (e) { toast(errMsg(e), { kind: 'error', ms: 3500 }); }
  }

  // ---------- painting
  let shownVol = null;
  function paintVolume(v = p.volume) {
    if (v == null) { el.classList.add('no-vol'); return; }
    el.classList.remove('no-vol');
    const f = Math.max(0, Math.min(1, v / (p.volMax || 100)));
    vFill.setAttribute('stroke-dasharray', `${(ARC * f).toFixed(2)} ${CIRC.toFixed(2)}`);
    const a = ((-135 + SWEEP * f) * Math.PI) / 180;
    vKnob.setAttribute('cx', (50 + R * Math.sin(a)).toFixed(2)); vKnob.setAttribute('cy', (50 - R * Math.cos(a)).toFixed(2));
    volNum.textContent = Math.round(v);
    volIc.innerHTML = icon(p.muted || v === 0 ? 'mute' : 'volume');
    el.classList.toggle('muted', !!p.muted);
    volPill.setAttribute('aria-label', p.muted ? 'Unmute' : 'Mute');
    if (shownVol != null && Math.round(v) !== Math.round(shownVol)) showFlash(v);
    shownVol = v;
  }
  let flashT = null;
  function showFlash(v) {
    flashNum.textContent = Math.round(v);
    flash.classList.add('on');
    clearTimeout(flashT);
    flashT = setTimeout(() => flash.classList.remove('on'), drag ? 4000 : 1100);
  }

  function stateKind() {
    if (!p.loaded) return 'loading';
    if (p.power?.state === 'standby') return 'standby';
    const n = p.now;
    if (!n || (n.state === 'stopped' && (n.idle || !n.title))) return 'idle';
    return 'track';
  }

  let lastArt = null, accentFor = null;
  function render() {
    const n = p.now, src = p.activeSource(), kind = stateKind();
    el.dataset.state = kind;
    // errors / standby / loading take the middle
    clear(stateBox);
    const err = p.error && (!p.loaded || ['bridge', 'unreachable', 'auth', 'adapter'].includes(p.error.kind));
    el.classList.toggle('has-state', !!err || kind === 'loading' || kind === 'standby');
    el.classList.toggle('has-error', !!err);
    if (err) renderError(p.error);
    else if (kind === 'loading') stateBox.append(h('div.st-msg', spinner(`Connecting to ${p.deviceName}…`)));
    else if (kind === 'standby') {
      stateBox.append(h('div.st-msg', h('div.st-msg-ic.pw', { html: icon('power') }), h('div.st-msg-title', p.deviceName), h('div.st-msg-text', 'In standby'),
        p.power?.modifiable ? h('div.st-msg-btns', h('button.pill.small.primary', { type: 'button', onclick: (e) => { e.stopPropagation(); act(() => p.setPower(true)); } }, 'Turn on')) : null));
    }

    headName.textContent = p.deviceName;
    clear(headSrc);
    if (src) headSrc.append(h('i.st-hsrc-ic', { '--c': src.color, html: src.known?.glyph ? glyphHtml(src.known.glyph) : '' }, src.known?.glyph ? null : (src.known?.mono || src.title || '').slice(0, 1)), h('span', src.title));
    else headSrc.append(h('span', 'Sources'));
    headSrc.append(h('i.st-chev', { html: icon('chevron') }));

    // accent: artwork colour (when the theme follows the music), else the source's colour, else the tile's
    const artUrl = n && !n.bare ? p.artUrl(n.art) : '';
    const follow = app.dataset.accent !== 'theme';
    const base = follow ? (src?.color || svc.color) : 'var(--c1)';
    if (accentFor !== artUrl) {
      accentFor = artUrl;
      el.style.setProperty('--c', base);
      if (artUrl && follow) accentFromImage(artUrl).then((c) => { if (c && accentFor === artUrl) el.style.setProperty('--c', c); });
    } else if (!artUrl) el.style.setProperty('--c', base);

    // artwork or the source's picture
    const hasArt = !!artUrl;
    el.classList.toggle('has-art', hasArt);
    if (artUrl !== lastArt) {
      lastArt = artUrl;
      art.classList.remove('in');
      if (artUrl) lanImage(artUrl).then((u) => { if (lastArt !== artUrl) return; const im = new Image(); im.onload = () => { if (lastArt === artUrl) { art.style.backgroundImage = `url("${u}")`; art.classList.add('in'); } }; im.onerror = () => { if (lastArt === artUrl) { el.classList.remove('has-art'); } }; im.src = u; });
    }
    setBg(bg, artUrl);
    const glyphKey = src?.known?.glyph || n?.known?.glyph || (kind === 'idle' ? 'speaker' : null);
    const vg = visual.querySelector('.st-vglyph');
    vg.style.setProperty('--sc', src?.color || n?.known?.color || 'var(--c)');
    const vKey = glyphKey || src?.key || 'speaker';
    if (vg.dataset.k !== vKey) {
      vg.dataset.k = vKey;
      clear(vg);
      if (glyphKey) vg.innerHTML = glyphHtml(glyphKey);
      else if (src) vg.append(sourceBadge(src, 'lg'));
      else vg.innerHTML = icon('speaker');
    }

    // text
    const playing = n?.state === 'playing';
    el.classList.toggle('playing', playing);
    if (kind === 'idle') {
      title.textContent = n?.state === 'stopped' && src ? src.title : 'Nothing playing';
      sub.textContent = src && n?.state === 'stopped' ? 'Stopped' : 'Play from an app, or pick a source';
      fmt.textContent = '';
    } else if (kind === 'track') {
      const inputName = src?.title || n.serviceName || n.known?.name || 'Input';
      title.textContent = n.title || (n.bare ? inputName : n.station || inputName);
      sub.textContent = n.bare ? (INPUT_SUB[src?.known?.glyph || n.known?.glyph] || 'Input') + ' · no track info' : [n.artist, n.album || n.station].filter(Boolean).join(' · ');
      clear(fmt);
      const parts = [];
      if (n.format?.text) parts.push(h(`span.st-q${n.format.hires ? '.hires' : ''}`, n.format.hires ? h('b', 'Hi-Res') : null, n.format.text));
      if (n.state === 'paused') parts.push(h('span.st-paused', 'Paused'));
      fmt.append(...parts);
    } else { title.textContent = ''; sub.textContent = ''; clear(fmt); }

    // transport
    const caps = p.caps();
    btnPrev.hidden = !caps.prev || kind === 'idle'; btnNext.hidden = !caps.next || kind === 'idle';
    const usesStop = playing && !caps.pause;
    btnPlay.innerHTML = icon(playing ? (usesStop ? 'stop' : 'pause') : 'play');
    btnPlay.classList.toggle('is-playing', playing);
    btnPlay.setAttribute('aria-label', playing ? (usesStop ? 'Stop' : 'Pause') : 'Play');
    el.classList.toggle('no-skip', btnPrev.hidden && btnNext.hidden);

    // power button
    powerBtn.hidden = !p.power?.modifiable;
    powerBtn.classList.toggle('off', p.power?.state === 'standby');
    powerBtn.setAttribute('aria-label', p.power?.state === 'standby' ? 'Turn on' : 'Standby');
    paintVolume();
    paintProgress();
  }

  function paintProgress() {
    const n = p.now, dur = n?.durationMs || 0;
    const has = !!dur && stateKind() === 'track';
    el.classList.toggle('has-prog', has);
    const pos = p.position();
    if (!has) { tCur.textContent = ''; tDur.textContent = ''; return; }
    const f = Math.max(0, Math.min(1, pos / dur));
    pFill.style.strokeDasharray = `${(f * 1000).toFixed(1)} 1000`;
    const a = f * Math.PI * 2;
    pKnob.setAttribute('cx', (50 + 48.6 * Math.sin(a)).toFixed(2)); pKnob.setAttribute('cy', (50 - 48.6 * Math.cos(a)).toFixed(2));
    tCur.textContent = fmtTime(pos); tDur.textContent = `-${fmtTime(Math.max(0, dur - pos))}`;
  }

  function renderError(e) {
    const host = p.host;
    const cfg = {
      bridge: ['Bridge not found', 'The streamer is reached through the bridge on your computer or Pi (this page can’t talk to a device on your network by itself). Start it — start-bridge.bat / start-bridge.sh — and this screen connects by itself.', 'link'],
      unreachable: [`Can’t reach ${p.deviceName}`, `Is it switched on and on the same network? Address: ${host}. ${e.message && !/^Can’t reach/.test(e.message) ? e.message : ''}`.trim(), 'speaker'],
      auth: ['Password-protected', e.message, 'lock'],
      adapter: ['Update the bridge', e.message, 'refresh'],
      setup: ['Set up the streamer', e.message, 'settings'],
      other: [`Couldn’t load ${p.deviceName}`, e.message, 'refresh'],
    }[e.kind] || ['Error', e.message, 'refresh'];
    stateBox.append(h('div.st-msg', h('div.st-msg-ic', { html: icon(cfg[2]) }), h('div.st-msg-title', cfg[0]), h('div.st-msg-text', cfg[1]),
      h('div.st-msg-btns',
        h('button.pill.small.primary', { type: 'button', onclick: async (ev) => { ev.stopPropagation(); if (e.kind === 'bridge') await bridgeBase({ force: true }); p.mode = null; p.error = null; p.loaded = false; render(); p.stop(true); p.start(); } }, 'Try again'),
        h('button.pill.small', { type: 'button', onclick: (ev) => { ev.stopPropagation(); go('connect', { id }); } }, 'Setup'))));
  }

  // ---------- volume ring: drag (relative), wheel, keys
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, .panel') || el.classList.contains('has-state') || p.volume == null) return;
    if (distFromCenter(el, e.clientX, e.clientY) < 0.8) return;
    drag = { a: angleFromCenter(el, e.clientX, e.clientY), v: p.volume, id: e.pointerId, moved: 0 };
    el.setPointerCapture(e.pointerId);
    el.classList.add('vdrag');
    showFlash(p.volume);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const a = angleFromCenter(el, e.clientX, e.clientY);
    const d = (angleDelta(drag.a, a) * 180) / Math.PI;    // degrees turned since the last move
    drag.a = a; drag.moved += Math.abs(d);
    drag.v = Math.max(0, Math.min(p.volMax, drag.v + (d / SWEEP) * p.volMax));
    p.setVolume(drag.v);
  });
  const endDrag = () => { if (!drag) return; drag = null; el.classList.remove('vdrag'); clearTimeout(flashT); flashT = setTimeout(() => flash.classList.remove('on'), 900); };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  let wheelAcc = 0;
  el.addEventListener('wheel', (e) => {
    if (topPanel()) return;
    e.preventDefault();
    if (p.volume == null) return;
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (Math.abs(wheelAcc) >= 50) { p.setVolume(p.volume + (wheelAcc < 0 ? 2 : -2) * p.volStep); wheelAcc = 0; }
  }, { passive: false });
  const onKey = (e) => {
    if (e.target.matches?.('input, textarea')) return;
    const k = e.key;
    if (k === 'Escape') { if (topPanel()) topPanel().close(); else go('home'); return; }
    if (topPanel()) return;
    const vol = (d) => { if (p.volume != null) { e.preventDefault(); p.setVolume(p.volume + d * p.volStep); } };
    if (k === 'ArrowUp' || k === 'ArrowRight' || k === 'AudioVolumeUp') vol(2);
    else if (k === 'ArrowDown' || k === 'ArrowLeft' || k === 'AudioVolumeDown') vol(-2);
    else if (k === ' ' || k === 'k' || k === 'Enter' || k === 'MediaPlayPause') { e.preventDefault(); act(() => p.toggle()); }
    else if (k === 'n' || k === 'MediaTrackNext') { if (p.caps().next) act(() => p.next()); }
    else if (k === 'p' || k === 'MediaTrackPrevious') { if (p.caps().prev) act(() => p.prev()); }
    else if (k === 'm' || k === 'AudioVolumeMute') act(() => p.setMute(!p.muted));
    else if (k === 's') openSources();
    else if (k === 'o') openSettings();
  };
  window.addEventListener('keydown', onKey);

  // ---------- power
  async function togglePower() {
    const on = p.power?.state !== 'standby';
    try { await p.setPower(!on); toast(on ? `${p.deviceName} going to standby` : `Turning ${p.deviceName} on…`); }
    catch (e) { toast(errMsg(e), { kind: 'error', ms: 3500 }); }
  }

  // ---------- Sources: the streamer's own list on a ring
  function openSources() {
    if (!p.sources.length) { toast(p.loaded ? 'This streamer lists no sources' : 'Not connected yet', { kind: 'error' }); return; }
    openPanel({
      title: '', className: 'st-src-panel',
      build(body, panel) {
        const center = h('div.st-sc');
        const list = p.sources;
        const n = list.length;
        // spread over 300°, leaving the bottom free for the close button
        const span = n <= 6 ? 240 : 300, rad = n > 12 ? 36.5 : 35;
        const items = list.map((s, i) => {
          const a = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
          const b = onCircle(h('button.st-si', { type: 'button', '--sc': s.color, dataset: { key: s.key, type: s.type }, 'aria-label': s.title, onclick: (e) => { e.stopPropagation(); pick(s, b); } },
            sourceBadge(s), h('span.st-si-name', s.title.length > 12 && s.known ? s.known.name : s.title), s.input ? null : h('i.st-si-tag', s.type === 'app' ? 'app' : 'cast')), a, rad);
          return b;
        });
        body.append(...items, center);
        const paintActive = () => {
          const k = p.activeKey();
          items.forEach((b) => b.classList.toggle('on', b.dataset.key === k));
          const cur = p.activeSource();
          clear(center);
          center.append(h('div.st-sc-cap', 'Sources'),
            cur ? h('div.st-sc-now', sourceBadge(cur, 'sm'), h('span', cur.title)) : h('div.st-sc-now.none', 'Nothing playing'),
            h('div.st-sc-hint', 'Tap an input to switch to it — or see how to play from an app'));
        };
        const showHint = (s, text) => {
          clear(center);
          center.append(sourceBadge(s, 'lg'), h('div.st-sc-title', s.title), h('div.st-sc-text', text),
            h('button.pill.small', { type: 'button', onclick: (e) => { e.stopPropagation(); paintActive(); } }, 'OK'));
        };
        async function pick(s, b) {
          if (s.type !== 'action') {
            items.forEach((x) => x.classList.toggle('sel', x === b));
            const r = await p.pickSource(s);
            showHint(s, r.hint);
            return;
          }
          b.classList.add('busy');
          try {
            await p.pickSource(s);
            toast(`Switched to ${s.title}`);
            paintActive();
            setTimeout(() => panel.close(), 650);
          } catch (e) { toast(errMsg(e), { kind: 'error', ms: 3500 }); }
          b.classList.remove('busy');
        }
        paintActive();
        const off = p.on('change', () => { if (!center.querySelector('.st-sc-text')) paintActive(); });
        panel.onDestroy = off;
      },
    });
  }

  // ---------- Settings: output, play mode, switches, power, device
  function openSettings() {
    openPanel({
      title: p.deviceName, className: 'opts-panel st-set-panel',
      build(body, panel) {
        const draw = () => {
          clear(body);
          const d = p.device || {};
          body.append(h('div.st-dev', h('div.st-dev-ic', { html: icon('speaker') }),
            h('div.st-dev-text', h('b', [d.product, d.version && `firmware ${d.version}`].filter(Boolean).join(' · ') || p.deviceName),
              h('span', `${p.host}${p.mode ? ` · ${p.mode === 'direct' ? 'direct' : 'through the bridge'}` : ''}`))));
          if (p.outputs.length) {
            body.append(h('div.opt', h('div.opt-label', 'Output'), h('div.toggles', p.outputs.map((o) => h(`button.tog${o.active ? '.on' : ''}`, {
              type: 'button', html: `${svgIc(o.optical ? G.optical : G.linein)}<span>${o.label}</span>`,
              onclick: async (e) => { e.stopPropagation(); if (o.active) return; try { await p.setOutput(o); toast(`Output: ${o.label}`); } catch (er) { toast(errMsg(er), { kind: 'error', ms: 3500 }); } },
            })))));
          }
          if (p.playMode) {
            const pm = p.playMode;
            body.append(h('div.opt', h('div.opt-label', 'Play mode'), h('div.toggles',
              h(`button.tog${pm.shuffle ? '.on' : ''}`, { type: 'button', html: `${icon('shuffle')}<span>Shuffle</span>`, onclick: (e) => { e.stopPropagation(); act(() => p.setPlayMode({ shuffle: !pm.shuffle })); } }),
              h(`button.tog${pm.repeat !== 'off' ? '.on' : ''}`, { type: 'button', html: `${icon('repeat')}<span>${pm.repeat === 'one' ? 'Repeat one' : pm.repeat === 'all' ? 'Repeat all' : 'Repeat'}</span>`,
                onclick: (e) => { e.stopPropagation(); act(() => p.setPlayMode({ repeat: pm.repeat === 'off' ? 'all' : pm.repeat === 'all' ? 'one' : 'off' })); } }))));
          }
          for (const sw of p.switches.filter((s) => s.modifiable)) {
            const t = h(`button.switch${sw.on ? '.on' : ''}`, { type: 'button', 'aria-label': sw.title, onclick: (e) => { e.stopPropagation(); act(() => p.setSwitch(sw, !sw.on)); } });
            body.append(h('div.opt.row-opt', h('div.opt-label', sw.title), t));
          }
          const acts = h('div.actions');
          if (p.power?.modifiable) {
            const on = p.power.state !== 'standby';
            acts.append(h(`button.pill.small${on ? '.danger' : '.primary'}`, { type: 'button', html: `${icon('power')}<span>${on ? 'Standby' : 'Turn on'}</span>`, onclick: (e) => { e.stopPropagation(); togglePower(); } }));
          }
          acts.append(h('button.pill.small', { type: 'button', onclick: (e) => { e.stopPropagation(); panel.close(); go('connect', { id }); } }, 'Device setup'));
          body.append(acts);
        };
        draw();
        const off = p.on('change', draw);
        panel.onDestroy = off;
      },
    });
  }

  // ---------- go
  const raf = { id: 0, last: 0 };
  const loop = (t) => { raf.id = requestAnimationFrame(loop); if (t - raf.last > 250) { raf.last = t; paintProgress(); } };
  raf.id = requestAnimationFrame(loop);
  const offs = [p.on('change', render), p.on('volume', (v) => paintVolume(v))];
  render();
  p.start();
  return { el, showChrome() {}, destroy() { offs.forEach((f) => f()); cancelAnimationFrame(raf.id); clearTimeout(flashT); window.removeEventListener('keydown', onKey); p.stop(); } };
}
