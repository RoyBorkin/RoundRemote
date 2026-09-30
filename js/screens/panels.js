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

const errMsg = (e) => e?.userMessage || e?.message || 'Something went wrong';

// ---------------------------------------------------------------- playlists
export function openLibrary() {
  if (!player.caps.playlists) return toast('Playlists are not available here');
  openPanel({
    title: 'Playlists', className: 'list-panel',
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
              toast(`Playing ${p.name}`);
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
export const infoArtChips = () => h('div.opt', h('div.opt-label', 'Full-screen art when controls hide'),
  chips([{ id: 'clear', name: 'Original clear' }, { id: 'milky', name: 'Milky blur' }], store.get('infoFullArt'), (v) => store.set('infoFullArt', v)));

export function openMore(view = 'info') {
  openPanel({
    title: view === 'vinyl' ? 'Vinyl' : 'Playback', className: 'opts-panel',
    build(body) {
      const c = player.caps, s = player.state;
      if (view === 'vinyl') body.append(vinylArtSlider(), armToggle());
      if (view === 'info') body.append(infoArtChips());
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
