// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// View 5: Tone Visual — abstract shapes and colours that move with the music, in eight
// styles (see tone-visuals.js). Sound comes from core/sound.js: simulated from playback by
// default, or live from a microphone.
import { h } from '../ui/dom.js';
import { store } from '../core/store.js';
import { sound } from '../core/sound.js';
import { paletteFromImage } from '../core/color.js';
import { TONE_RENDERERS } from './tone-visuals.js';

function parseColor(css) {
  if (!css) return null;
  const probe = document.createElement('i');
  probe.style.color = css;
  document.body.appendChild(probe);
  const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g);
  probe.remove();
  return m ? m.slice(0, 3).map(Number) : null;
}

export function createToneView({ player }) {
  const host = h('div.tv-host');
  const src = h('div.tv-src');
  const el = h('div.view.view-tone', host, src);
  const snd = sound();
  let r = null, variant = store.get('toneVariant'), track = null, t0 = performance.now(), size = [0, 0];
  const env = { accent: null, palette: null, art: null, lite: !!store.get('liteMode') };

  function readAccent() { env.accent = parseColor(getComputedStyle(document.getElementById('app')).getPropertyValue('--accent').trim()) || [120, 170, 255]; }
  function mount() {
    r?.destroy(); r = null;
    host.dataset.v = variant;
    env.lite = !!store.get('liteMode');
    readAccent();
    const make = TONE_RENDERERS[variant] || TONE_RENDERERS.ferro;
    r = make(host, env);
    if (size[0]) r.resize(size[0], size[1]);
  }
  const ro = new ResizeObserver(([e]) => {
    const w = e.contentRect.width, hh = e.contentRect.height;
    if (!w || !hh || (w === size[0] && hh === size[1])) return;
    size = [w, hh];
    r?.resize(w, hh);
  });
  ro.observe(host);

  function labelSource() {
    if (snd.source === 'mic') {
      src.textContent = snd.micState === 'on' ? '● Live · microphone'
        : snd.micState === 'error' ? `${snd.micError} — showing simulated sound` : 'Starting microphone…';
      src.classList.toggle('warn', snd.micState === 'error');
    } else { src.textContent = 'Simulated from playback'; src.classList.remove('warn'); }
  }
  // Browsers only start audio after a tap; resume the mic's audio context on any touch.
  el.addEventListener('pointerdown', () => { try { snd.mic.ctx?.resume(); } catch {} });

  const offs = [
    store.on('change:toneVariant', (v) => { variant = v; mount(); }),
    store.on('change:toneSource', () => { if (snd.source === 'sim') snd.release(); labelSource(); }),
    store.on('change:liteMode', mount),
  ];
  mount();
  labelSource();
  let lastLabel = 0;

  return {
    el,
    update(s) {
      const tr = s.track;
      const key = tr ? `${tr.id}|${tr.title}` : null;
      if (key === track) return;
      track = key;
      env.art = tr?.art || null;
      setTimeout(() => { readAccent(); r?.colors(env); }, 400); // --accent updates once the art is analysed
      paletteFromImage(env.art).then((p) => { if (track === key) { env.palette = p; readAccent(); r?.colors(env); } });
    },
    tick(pos, s) {
      const F = snd.frame(pos, !!s?.isPlaying, s?.track?.durationMs || 0, track || 'none');
      r?.frame(F, (performance.now() - t0) / 1000);
      const now = performance.now();
      if (now - lastLabel > 1000) { lastLabel = now; labelSource(); }
    },
    destroy() { offs.forEach((f) => f()); ro.disconnect(); r?.destroy(); snd.release(); },
  };
}
