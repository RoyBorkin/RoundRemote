// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Lyric style "CRT TV": the lyrics on an old tube television.
//  • phosphor-green glass with scanlines, an RGB shadow mask, a slow rolling hum bar, vignette and
//    a faint flicker; live static noise underneath (stronger between lines, like a lost signal)
//  • the current line in a chunky VCR font with red/cyan colour fringing and a phosphor glow;
//    words light up as they're sung, the previous and next lines dim above and below
//  • every new line "changes channel": the picture collapses to a bright line and springs back
//  • now and then a tracking tear slides a slice of the picture sideways
//  • a VHS on-screen display — channel, ▶ PLAY, tape counter, SP — while the controls are hidden
// Hebrew lines read right to left (the on-screen display stays left to right, like a real VCR).
import { h } from '../ui/dom.js';
import { lineAt } from '../lyrics/lrc.js';
import { isGap } from './lyrics-extra.js';
import { dirOf } from '../lyrics/bidi.js';

const pad = (n) => String(n).padStart(2, '0');
const counter = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };

export function crtStyle(box, lyr, api) {
  const L = lyr.lines;
  // glass: static noise + scanlines + shadow mask + hum bar + vignette (full circle)
  const noise = h('canvas.crt-noise', { width: 160, height: 120 });
  const field = h('div.crt-field', noise, h('div.crt-mask'), h('div.crt-scan'), h('div.crt-roll'), h('div.crt-vig'));
  api.bg.appendChild(field);
  const g = noise.getContext('2d');
  const img = g.createImageData(160, 120);
  const lite = document.getElementById('app')?.classList.contains('lite');
  let lastNoise = 0;
  function drawNoise(t) {
    if (t - lastNoise < (lite ? 140 : 60)) return;
    lastNoise = t;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }

  const prev = h('div.crt-line.prev'), cur = h('div.crt-line.cur'), next = h('div.crt-line.next');
  const tear = h('div.crt-tear');
  const screen = h('div.crt-screen', prev, cur, next, tear);
  const clock = h('span.crt-counter', '0:00:00');
  const ch = h('div.crt-osd.tl', `CH ${pad(3 + ((api.track?.title || '').length % 60))}`);
  const root = h('div.crt', screen, ch, h('div.crt-osd.tr', h('span.crt-play', '▶'), ' PLAY'), h('div.crt-osd.bl', clock), h('div.crt-osd.br', 'SP'));
  box.appendChild(root);

  let idx = -99, spans = [], tearT = 0;
  const setLine = (el, text) => { el.textContent = text || ''; el.dir = dirOf(text || ''); };
  function build(i, gap) {
    spans = [];
    cur.replaceChildren();
    if (i < 0 || gap) {
      cur.dir = 'ltr';
      cur.append(h('span.crt-nosig', i < 0 && idx === -99 ? '— STANDBY —' : '♪  ♪  ♪'));
    } else {
      const ln = L[i];
      cur.dir = dirOf(ln.text);
      const words = ln.words?.length ? ln.words : [{ t: ln.t, text: ln.text }];
      words.forEach((w, j) => { const s = h('span.crt-w', w.text); spans.push(s); cur.append(s); if (j < words.length - 1) cur.append(' '); });
    }
    setLine(prev, i > 0 ? L[i - 1].text : '');
    const nx = L[Math.max(0, i + 1)];
    setLine(next, nx && i + 1 < L.length ? nx.text : '');
    // channel change: collapse to a line and spring back, with a burst of static
    root.classList.remove('chan'); field.classList.remove('static');
    void root.offsetWidth;
    root.classList.add('chan'); field.classList.add('static');
    setTimeout(() => field.classList.remove('static'), 380);
  }

  return {
    tick(ms) {
      const t = performance.now();
      drawNoise(t);
      clock.textContent = counter(ms);
      let i = lineAt(L, ms);
      const gap = isGap(L, i, ms);
      const k = gap ? -1 - Math.max(0, i) : i;
      if (k !== idx) { build(i, gap); idx = k; }
      field.classList.toggle('nosignal', i < 0 || gap);
      if (i >= 0 && !gap) {
        const ws = L[i].words;
        if (ws?.length) spans.forEach((s, j) => s.classList.toggle('on', ms >= ws[j].t - 40));
        else spans.forEach((s) => s.classList.add('on'));
      }
      // an occasional tracking tear
      if (t > tearT) {
        tearT = t + 2500 + Math.random() * 6000;
        tear.replaceChildren(prev.cloneNode(true), cur.cloneNode(true), next.cloneNode(true));
        tear.style.setProperty('--y', `${(20 + Math.random() * 55).toFixed(0)}%`);
        tear.style.setProperty('--dx', `${(Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 5).toFixed(1)}%`);
        tear.classList.remove('go'); void tear.offsetWidth; tear.classList.add('go');
      }
    },
    destroy() { field.classList.add('gone'); setTimeout(() => field.remove(), 600); },
  };
}
