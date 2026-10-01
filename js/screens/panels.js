// Round overlay panels opened from the player: playlists, search, devices, volume, options.
import { h, iconBtn, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openPanel, curve, listRow, spinner, emptyNote, toast } from '../ui/overlay.js';
import { createKeyboard, wantsKeyboard } from '../ui/keyboard.js';
import { player } from '../core/player.js';
import { store } from '../core/store.js';
import { angleFromCenter, clamp, debounce, throttle } from '../core/util.js';
import { LYRIC_STYLES, TYPO_VARIANTS } from '../views/lyrics.js';
import { TONE_VARIANTS } from '../views/tone-visuals.js';
import { sound } from '../core/sound.js';
import { VIDEO_KINDS } from '../core/youtube.js';
import { videoKinds } from '../views/video.js';

const errMsg = (e) => e?.userMessage || e?.message || 'Something went wrong';

// ---------------------------------------------------------------- playlists
export function openLibrary() {
  if (!player.caps.playlists) return toast('Playlists are not available here');
  const tv = player.caps.remote;
  openPanel({
    title: tv ? 'Apps' : 'Playlists', className: 'list-panel',
    build(body, panel) {
      const list = h('div.list');
      body.append(list);
      curve(list);
      list.append(spinner());
      player.provider.getPlaylists().then((items) => {
        clear(list);
        if (!items.length) { list.append(emptyNote('No playlists found')); return; }
        for (const p of items) {
          list.append(listRow({
            title: p.name, subtitle: p.subtitle, art: p.art, mono: p.mono, onClick: async () => {
              toast(`${p.kind === 'app' ? 'Opening' : 'Playing'} ${p.name}`);
              panel.close();
              try { await player.provider.playPlaylist(p); setTimeout(() => player.provider.refresh().catch(() => {}), 700); }
              catch (e) { toast(errMsg(e), { kind: 'error' }); }
            },
          }));
        }
      }).catch((e) => { clear(list); list.append(emptyNote(errMsg(e))); });
    },
  });
}

// ---------------------------------------------------------------- search
export function openSearch() {
  if (!player.caps.search) return toast('Search is not available here');
  openPanel({
    title: 'Search', className: 'search-panel',
    build(body, panel) {
      const input = h('input.search-input', { type: 'search', placeholder: 'Songs, albums, playlists', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
      const list = h('div.list');
      const useKbd = wantsKeyboard();
      let kbd = null;
      const setKbd = (on) => { panel.el.classList.toggle('kbd-open', on); };
      const kbdToggle = iconBtn('keyboard', 'Keyboard', () => setKbd(!panel.el.classList.contains('kbd-open')), 'kbd-toggle');
      body.append(h('div.search-bar', input, useKbd ? kbdToggle : null), list);
      curve(list);
      let seq = 0;
      const run = async (q) => {
        const my = ++seq;
        q = q.trim();
        if (q.length < 2) { clear(list); return; }
        clear(list); list.append(spinner('Searching…'));
        try {
          const res = await player.provider.search(q);
          if (my !== seq) return;
          clear(list);
          if (!res.length) { list.append(emptyNote('No results')); return; }
          for (const r of res) {
            list.append(listRow({
              title: r.title, subtitle: r.subtitle, art: r.art, right: h('span.kind', r.kind),
              onClick: async () => {
                panel.close(); toast(`Playing ${r.title}`);
                try { await player.provider.playItem(r); setTimeout(() => player.provider.refresh().catch(() => {}), 700); }
                catch (e) { toast(errMsg(e), { kind: 'error' }); }
              },
            }));
          }
        } catch (e) { if (my === seq) { clear(list); list.append(emptyNote(errMsg(e))); } }
      };
      const debounced = debounce(run, 450);
      input.addEventListener('input', () => debounced(input.value));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { run(input.value); setKbd(false); } });
      list.addEventListener('pointerdown', () => setKbd(false));
      if (useKbd) {
        input.readOnly = true; // keep the OS keyboard from popping up on touch
        input.addEventListener('pointerdown', () => setKbd(true));
        kbd = createKeyboard(input, { onEnter: (v) => { run(v); setKbd(false); } });
        panel.el.appendChild(kbd);
        setKbd(true);
      } else setTimeout(() => input.focus(), 250);
    },
  });
}

// ---------------------------------------------------------------- devices
export function openDevices() {
  if (!player.caps.devices) return toast('No device choice for this service');
  openPanel({
    title: 'Devices', className: 'list-panel',
    build(body, panel) {
      const list = h('div.list');
      body.append(list);
      curve(list);
      const load = () => {
        clear(list); list.append(spinner('Looking for devices…'));
        player.provider.getDevices().then((devs) => {
          clear(list);
          if (!devs.length) { list.append(emptyNote('No devices found. Open the music app on a device and try again.', { label: 'Refresh', onClick: load })); return; }
          for (const d of devs) {
            list.append(listRow({
              title: d.name, subtitle: d.type || '', mono: d.active ? '●' : '○', active: d.active,
              right: d.active ? h('span.check', { html: icon('check') }) : null,
              onClick: async () => {
                try { await player.provider.selectDevice(d); toast(`Now controlling ${d.name}`); panel.close(); setTimeout(() => player.provider.refresh().catch(() => {}), 600); }
                catch (e) { toast(errMsg(e), { kind: 'error' }); }
              },
            }));
          }
        }).catch((e) => { clear(list); list.append(emptyNote(errMsg(e), { label: 'Retry', onClick: load })); });
      };
      load();
    },
  });
}

// ---------------------------------------------------------------- volume dial
export function openVolume() {
  if (!player.caps.volume) return toast('Volume is not controllable on this device');
  const SWEEP = 270, R = 38, CIRC = 2 * Math.PI * R, ARC = CIRC * (SWEEP / 360);
  openPanel({
    title: 'Volume', className: 'volume-panel',
    build(body, panel) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.classList.add('vol-dial');
      svg.innerHTML = `
        <circle class="vol-track" cx="50" cy="50" r="${R}" stroke-dasharray="${ARC} ${CIRC}" transform="rotate(135 50 50)"/>
        <circle class="vol-fill" cx="50" cy="50" r="${R}" stroke-dasharray="0 ${CIRC}" transform="rotate(135 50 50)"/>
        <circle class="vol-knob" cx="50" cy="12" r="3.4"/>`;
      const fill = svg.querySelector('.vol-fill'), knob = svg.querySelector('.vol-knob');
      const num = h('div.vol-num');
      const muteBtn = h('button.vol-mute', { type: 'button', 'aria-label': 'Mute' });
      const minus = iconBtn('minus', 'Volume down', () => set(val - 5), 'vol-minus');
      const plus = iconBtn('plus', 'Volume up', () => set(val + 5), 'vol-plus');
      body.append(svg, h('div.vol-center', num, muteBtn), minus, plus);
      let val = player.state.volume ?? 50, beforeMute = val || 40;
      const send = throttle((v) => player.setVolume(v), 180);
      function draw() {
        const f = val / 100;
        fill.setAttribute('stroke-dasharray', `${(ARC * f).toFixed(2)} ${CIRC}`);
        const a = ((-135 + SWEEP * f) * Math.PI) / 180;
        knob.setAttribute('cx', (50 + R * Math.sin(a)).toFixed(2));
        knob.setAttribute('cy', (50 - R * Math.cos(a)).toFixed(2));
        num.textContent = Math.round(val);
        muteBtn.innerHTML = icon(val === 0 ? 'mute' : 'volume');
      }
      let idleT;
      const bump = () => { clearTimeout(idleT); idleT = setTimeout(() => panel.close(), 6000); };
      function set(v) { val = clamp(Math.round(v), 0, 100); draw(); send(val); bump(); }
      muteBtn.onclick = (e) => { e.stopPropagation(); if (val > 0) { beforeMute = val; set(0); } else set(beforeMute || 40); };
      let drag = false, lastA = null;
      const fromEvent = (e) => {
        let a = (angleFromCenter(svg, e.clientX, e.clientY) * 180) / Math.PI; // -180..180, 0 = top
        if (lastA != null && Math.abs(a - lastA) > 200) return; // ignore wrap through the gap
        lastA = a;
        a = clamp(a, -135, 135);
        set(((a + 135) / SWEEP) * 100);
      };
      svg.addEventListener('pointerdown', (e) => { drag = true; lastA = null; svg.setPointerCapture(e.pointerId); fromEvent(e); });
      svg.addEventListener('pointermove', (e) => drag && fromEvent(e));
      svg.addEventListener('pointerup', () => { drag = false; });
      panel.el.addEventListener('wheel', (e) => { e.preventDefault(); set(val + (e.deltaY < 0 ? 3 : -3)); }, { passive: false });
      const off = player.on('state', (s) => { if (!drag && s.volume != null && Math.abs(s.volume - val) > 1) { val = s.volume; draw(); } });
      panel.onDestroy = () => { off(); clearTimeout(idleT); };
      draw(); bump();
    },
  });
}

// ---------------------------------------------------------------- options
export function chips(options, current, onPick) {
  const row = h('div.chips');
  const render = (cur) => {
    clear(row);
    for (const o of options) {
      row.append(h(`button.chip${o.id === cur ? '.on' : ''}`, { type: 'button', onclick: (e) => { e.stopPropagation(); onPick(o.id); render(o.id); } }, o.name));
    }
  };
  render(current);
  return row;
}

/** Multi-select chips: tap to include / leave out. Keeps at least one selected. */
export function multiChips(options, getOn, setOn, { min = 1 } = {}) {
  const row = h('div.chips.multi');
  const render = () => {
    clear(row);
    const on = getOn();
    for (const o of options) {
      const sel = on.includes(o.id);
      row.append(h(`button.chip${sel ? '.on' : ''}`, {
        type: 'button', role: 'checkbox', 'aria-checked': String(sel),
        onclick: (e) => {
          e.stopPropagation();
          const cur = getOn();
          if (sel && cur.length <= min) { toast('Keep at least one'); return; }
          setOn(sel ? cur.filter((x) => x !== o.id) : [...cur, o.id]);
          render();
        },
      }, o.name));
    }
  };
  render();
  return row;
}

export function stepper(label, get, set, { step, fmt }) {
  const val = h('span.step-val', fmt(get()));
  const upd = (d) => { set(get() + d); val.textContent = fmt(get()); };
  return h('div.opt', h('div.opt-label', label), h('div.stepper',
    iconBtn('minus', `${label} down`, () => upd(-step), 'small'), val, iconBtn('plus', `${label} up`, () => upd(step), 'small')));
}

export function openLyricStyles() {
  openPanel({
    title: 'Lyrics', className: 'opts-panel',
    build(body) {
      const variants = h('div.opt', h('div.opt-label', 'Kinetic type variant'), chips(TYPO_VARIANTS, store.get('typoVariant'), (id) => store.set('typoVariant', id)));
      variants.hidden = store.get('lyricsStyle') !== 'typo';
      body.append(
        h('div.opt', h('div.opt-label', 'Style'), chips(LYRIC_STYLES, store.get('lyricsStyle'), (id) => { store.set('lyricsStyle', id); variants.hidden = id !== 'typo'; })),
        variants,
        stepper('Timing offset', () => store.get('lyricsOffsetMs'), (v) => store.set('lyricsOffsetMs', clamp(v, -5000, 5000)),
          { step: 250, fmt: (v) => `${v > 0 ? '+' : ''}${(v / 1000).toFixed(2)}s` }),
        h('div.opt-hint', 'Lyrics from LRCLIB (or your server).'),
      );
    },
  });
}

export const TONE_SOURCES = [{ id: 'sim', name: 'Simulated' }, { id: 'mic', name: 'Microphone (live)' }];
export const TONE_SOURCE_HINT = 'This is a remote, so the music plays on another device and the app can’t hear it directly. '
  + 'Simulated follows the song’s playback (beat, pauses, seeking). Microphone listens to the room for real live visuals — e.g. a USB mic on the Pi.';
export function openToneStyles() {
  openPanel({
    title: 'Tone Visual', className: 'opts-panel',
    build(body) {
      body.append(
        h('div.opt', h('div.opt-label', 'Style'), chips(TONE_VARIANTS, store.get('toneVariant'), (id) => store.set('toneVariant', id))),
        h('div.opt', h('div.opt-label', 'Sound'), chips(TONE_SOURCES, store.get('toneSource'), (id) => sound().useMic(id === 'mic'))),
        h('div.opt-hint', TONE_SOURCE_HINT),
      );
    },
  });
}

// seconds of music per turn → shown as rpm (1.8 s = a real 33⅓ rpm record)
export const VINYL_SPEEDS = [
  { id: 1.333, name: '45 rpm' }, { id: 1.8, name: '33⅓ rpm' }, { id: 3.75, name: '16 rpm' }, { id: 7.5, name: '8 rpm' }, { id: 15, name: '4 rpm' },
];
export const vinylArtFmt = (v) => (v <= 0 ? 'No artwork' : v >= 100 ? 'Full screen' : `${Math.round(v)}%`);
export const vinylArtSlider = () => slider('Centre artwork', () => store.get('vinylLabelSize'), (v) => store.set('vinylLabelSize', v),
  { min: 0, max: 100, step: 1, fmt: vinylArtFmt, ends: ['None', 'Full'] });
export const armToggle = () => toggle('Hide the arm with the controls', () => store.get('vinylArmHide') !== false, (v) => store.set('vinylArmHide', v));
export const INFO_HIDDEN = [
  { id: 'clear', name: 'Artwork · clear' }, { id: 'milky', name: 'Artwork · milky blur' },
  { id: 'card-black', name: 'Song info · black' }, { id: 'card-blur', name: 'Song info · blurred art' },
];
export const infoArtChips = () => h('div.opt', h('div.opt-label', 'When the controls hide, show'),
  chips(INFO_HIDDEN, store.get('infoFullArt'), (v) => store.set('infoFullArt', v)));
const flag = (key, label) => toggle(label, () => store.get(key) !== false, (v) => store.set(key, v));
export const infoAutoHideToggle = () => flag('infoAutoHide', 'Hide the controls by themselves');
export const infoArtToggle = () => flag('infoShowArt', 'Show the artwork in the middle');
export const vinylTitleToggle = () => flag('vinylShowTitle', 'Show the title around the label');
export const videoArtToggle = () => flag('videoShowArt', 'Show the artwork');
export const devicePillToggle = () => flag('showDevicePill', 'Show the service & device line');
export const VIDEO_MODES = [{ id: 'video', name: 'Music video' }, { id: 'slides', name: 'Photo slideshow' }];
export const videoOpts = () => [
  h('div.opt', h('div.opt-label', 'Background'), chips(VIDEO_MODES, store.get('videoMode'), (v) => store.set('videoMode', v))),
  h('div.opt', h('div.opt-label', 'Video types (pick one or more)'), multiChips(VIDEO_KINDS, videoKinds, (v) => store.set('videoKinds', v))),
  flag('videoPreferClip', 'Prefer the official clip when there is one'),
  toggle('Show song info when the controls hide', () => !!store.get('videoHud'), (v) => store.set('videoHud', v)),
  videoArtToggle(),
];
export const FACT_SECONDS = [6, 8, 12, 20, 30, 60].map((n) => ({ id: n, name: `${n} s` }));
export const factChips = () => h('div.opt', h('div.opt-label', 'Next fact every'), chips(FACT_SECONDS, +store.get('factSeconds') || 12, (v) => store.set('factSeconds', v)));
export function openFactsOptions() {
  openPanel({
    title: 'Fun Facts', className: 'opts-panel',
    build(body) {
      body.append(factChips(), h('div.opt-hint', 'Facts about the song, album and artist from Wikipedia and MusicBrainz. Tap a fact to skip to the next one.'));
    },
  });
}

export function openMore(view = 'info') {
  openPanel({
    title: view === 'vinyl' ? 'Vinyl' : view === 'info' ? 'Classic' : view === 'video' ? 'Video' : 'Playback', className: 'opts-panel',
    build(body) {
      const c = player.caps, s = player.state;
      if (view === 'vinyl') body.append(vinylArtSlider(), armToggle(), vinylTitleToggle());
      if (view === 'info') body.append(infoArtChips(), infoArtToggle(), infoAutoHideToggle());
      if (view === 'video') body.append(...videoOpts());
      const toggles = h('div.toggles');
      if (c.shuffle) {
        const b = h(`button.tog${s.shuffle ? '.on' : ''}`, { type: 'button', html: `${icon('shuffle')}<span>Shuffle</span>` });
        b.onclick = (e) => { e.stopPropagation(); const on = !player.state.shuffle; player.setShuffle(on); b.classList.toggle('on', on); };
        toggles.append(b);
      }
      if (c.repeat) {
        const b = h(`button.tog${s.repeat && s.repeat !== 'off' ? '.on' : ''}`, { type: 'button' });
        const paint = () => { const r = player.state.repeat || 'off'; b.innerHTML = `${icon(r === 'one' ? 'repeatOne' : 'repeat')}<span>Repeat ${r === 'off' ? 'off' : r}</span>`; b.classList.toggle('on', r !== 'off'); };
        b.onclick = (e) => { e.stopPropagation(); player.cycleRepeat(); paint(); };
        paint(); toggles.append(b);
      }
      if (toggles.children.length) body.append(toggles);
      if (c.seek) {
        body.append(h('div.opt', h('div.opt-label', 'Skip'), h('div.chips',
          h('button.chip', { type: 'button', onclick: (e) => { e.stopPropagation(); player.seekBy(-15000); } }, '−15s'),
          h('button.chip', { type: 'button', onclick: (e) => { e.stopPropagation(); player.seekBy(15000); } }, '+15s'))));
      }
      body.append(h('div.chips', h('button.chip', { type: 'button', onclick: (e) => { e.stopPropagation(); openCustomizeControls('player'); } }, 'Customize controls')));
      if (view === 'vinyl') {
        body.append(h('div.opt', h('div.opt-label', 'Record speed (spin + scratch)'), chips(VINYL_SPEEDS, store.get('vinylSecondsPerTurn'), (v) => store.set('vinylSecondsPerTurn', v))));
      }
    },
  });
}

export function slider(label, get, set, { min = 0, max = 100, step = 1, fmt = (v) => v, ends = null } = {}) {
  const val = h('span.slider-val', fmt(get()));
  const input = h('input.slider', { type: 'range', min, max, step, value: get(), 'aria-label': label });
  const paint = () => input.style.setProperty('--fill', `${((+input.value - min) / (max - min)) * 100}%`);
  input.addEventListener('input', () => { set(+input.value); val.textContent = fmt(+input.value); paint(); });
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  paint();
  return h('div.opt', h('div.opt-label', label),
    h('div.slider-row', ends ? h('span.slider-end', ends[0]) : null, input, ends ? h('span.slider-end', ends[1]) : null), val);
}

export function toggle(label, get, set) {
  const b = h(`button.switch${get() ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(!!get()), 'aria-label': label });
  b.onclick = (e) => { e.stopPropagation(); set(!get()); b.classList.toggle('on', !!get()); b.setAttribute('aria-checked', String(!!get())); };
  return h('div.opt.row-opt', h('div.opt-label', label), b);
}

// ---------------------------------------------------------------- TV remote (Google TV, Apple TV)
/** Build the round D-pad remote into `body` (a panel body or a screen). Returns a cleanup function. */
export function buildTvRemote(body, { showApps = true } = {}) {
  const send = (key) => {
    if (!player.provider?.remoteKey || !player.provider.zone) { toast('No TV selected'); return; }
    player.provider.remoteKey(key).catch((e) => toast(e?.body?.error || errMsg(e), { kind: 'error' }));
  };
  // press = one key; holding repeats (D-pad and volume)
  const hold = (el, key, repeat = true) => {
    let t1 = 0, t2 = 0;
    const stop = () => { clearTimeout(t1); clearInterval(t2); el.classList.remove('down'); };
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      el.classList.add('down'); send(key); navigator.vibrate?.(8);
      if (repeat) t1 = setTimeout(() => { t2 = setInterval(() => send(key), 140); }, 450);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, stop));
    el.addEventListener('click', (e) => e.stopPropagation());
    return el;
  };
  const key = (name, label, k, cls, repeat = false) => hold(h(`button.ibtn.tvk.${cls}`, { type: 'button', 'aria-label': label, title: label, html: icon(name) }), k, repeat);
  // D-pad ring: four wedges around an OK button
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.classList.add('tv-dpad');
  const R = 49, r = 21, gap = 3;
  const pt = (rad, deg) => { const a = (deg * Math.PI) / 180; return `${(50 + rad * Math.cos(a)).toFixed(2)} ${(50 + rad * Math.sin(a)).toFixed(2)}`; };
  for (const [k, mid] of [['up', -90], ['right', 0], ['down', 90], ['left', 180]]) {
    const a0 = mid - 45 + gap, a1 = mid + 45 - gap;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('tv-wedge'); g.setAttribute('role', 'button'); g.setAttribute('aria-label', k);
    g.innerHTML = `<path d="M${pt(R, a0)} A${R} ${R} 0 0 1 ${pt(R, a1)} L${pt(r + 3, a1)} A${r + 3} ${r + 3} 0 0 0 ${pt(r + 3, a0)} Z"/>`
      + `<path class="tv-chev" transform="translate(${pt(35, mid).replace(' ', ',')}) rotate(${mid + 90})" d="M-3.4 1.8 L0 -1.8 L3.4 1.8"/>`;
    svg.append(hold(g, k, true));
  }
  const ok = hold(h('button.tv-ok', { type: 'button', 'aria-label': 'OK' }, 'OK'), 'ok', false);
  const now = h('div.tv-now');
  body.append(
    svg, ok,
    key('power', 'Power', 'power', 'tv-power'),
    key('mute', 'Mute', 'mute', 'tv-mute'),
    showApps ? iconBtn('apps', 'Apps', () => openLibrary(), 'tvk tv-apps') : null,
    key('back', 'Back', 'back', 'tv-back'),
    key('home', 'Home', 'home', 'tv-home'),
    key('minus', 'Volume down', 'voldown', 'tv-vdown', true),
    key('play', 'Play / pause', 'playpause', 'tv-pp'),
    key('plus', 'Volume up', 'volup', 'tv-vup', true),
    now,
  );
  const paint = (st) => {
    const t = st.track;
    now.textContent = t ? `${t.media?.show || t.title}${st.volume != null ? ` · vol ${st.volume}` : ''}` : (st.device ? 'TV off' : 'No TV');
    body.querySelector('.tv-mute')?.classList.toggle('on', !!st.muted);
  };
  paint(player.state);
  return player.on('state', paint);
}

export function openTvRemote() {
  if (!player.caps.remote) return toast('No TV selected');
  openPanel({
    title: 'TV remote', className: 'tv-panel',
    build(body, panel) { panel.onDestroy = buildTvRemote(body); },
  });
}

// ---------------------------------------------------------------- show / hide parts of the controls
export const PLAYER_PARTS = [
  ['ring', 'Progress ring'], ['home', 'Services button'], ['playlists', 'Playlists button'], ['search', 'Search button'],
  ['devices', 'Devices button'], ['volume', 'Volume button'], ['more', 'Options button (⋯)'], ['prev', 'Previous'], ['play', 'Play / pause'],
  ['next', 'Next'], ['times', 'Time passed & length'], ['views', 'View buttons'],
];
export const MEDIA_PARTS = [
  ['ring', 'Progress ring'], ['tabs', 'Now playing / Library tabs'], ['home', 'Home button'], ['devices', 'Devices button'],
  ['pill', 'Service & device line'], ['volume', 'Volume button'], ['options', 'Options button (⋯)'], ['kicker', 'Season · episode / year line'],
  ['title', 'Title'], ['subtitle', 'Episode title / tagline'], ['elapsed', 'Time passed'], ['remaining', 'Time left'], ['play', 'Play / pause'],
];
/** Toggles for a hide-list setting (key = 'playerHide' | 'mediaHide'). */
export function partToggles(key, parts) {
  const hidden = () => store.get(key) || [];
  return parts.map(([id, label]) => toggle(label, () => !hidden().includes(id), (on) => store.set(key, on ? hidden().filter((x) => x !== id) : [...hidden(), id])));
}
export function openCustomizeControls(kind = 'player') {
  openPanel({
    title: 'Customize controls', className: 'opts-panel.customize-panel',
    build(body) {
      const list = h('div.list.customize-list');
      body.append(list);
      if (kind === 'media') {
        list.append(h('div.opt-hint', 'Show on the Now playing screen'), ...partToggles('mediaHide', MEDIA_PARTS),
          ...[['mediaEndsAt', '“Ends at” time'], ['mediaSkip', 'Skip back / forward'], ['mediaPrevNext', 'Previous / next episode'], ['mediaEpisodes', 'Seasons & episodes'], ['mediaInfo', 'Info'],
            ['mediaCast', 'Cast'], ['mediaFacts', 'Fun facts'], ['mediaSuggest', 'More like this'], ['mediaCollection', 'Collection'], ['mediaTracks', 'Audio & subtitles'], ['mediaStop', 'Stop']]
            .map(([k, label]) => toggle(label, () => store.get(k), (v) => store.set(k, v))),
          h('div.opt-hint', 'Hid the ⋯ button? Hold anywhere on an empty part of the screen to get back here.'));
      } else {
        list.append(h('div.opt-hint', 'Show on the player'), ...partToggles('playerHide', PLAYER_PARTS),
          toggle('Service & device line', () => store.get('showDevicePill') !== false, (v) => store.set('showDevicePill', v)),
          h('div.opt-hint', 'Hid the ⋯ button? Hold anywhere on the middle of the screen to get back here.'));
      }
    },
  });
}
