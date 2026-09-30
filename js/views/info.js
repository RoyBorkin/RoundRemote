// View 1: clean "now playing" — round artwork, title, artist, album.
import { h } from '../ui/dom.js';

export function createInfoView() {
  const art = h('div.info-art');
  const glow = h('div.info-glow');
  const title = h('div.info-title', h('span'));
  const artist = h('div.info-artist');
  const album = h('div.info-album');
  const el = h('div.view.view-info', glow, art, h('div.info-meta', title, artist, album));
  let lastArt = null;

  function marquee(box) {
    const span = box.firstChild;
    box.classList.remove('scroll');
    span.style.removeProperty('--shift');
    requestAnimationFrame(() => {
      const over = span.scrollWidth - box.clientWidth;
      if (over > 4) { box.classList.add('scroll'); span.style.setProperty('--shift', `${-over - 12}px`); span.style.setProperty('--dur', `${Math.max(6, over / 18)}s`); }
    });
  }

  return {
    el,
    update(s) {
      const t = s.track;
      el.classList.toggle('playing', !!s.isPlaying);
      el.classList.toggle('empty', !t);
      const url = t?.art || '';
      if (url !== lastArt) {
        lastArt = url;
        art.style.backgroundImage = url ? `url("${url}")` : '';
        art.classList.toggle('noart', !url);
      }
      const tt = t ? t.title : (s.message || 'Nothing playing');
      if (title.firstChild.textContent !== tt) { title.firstChild.textContent = tt; marquee(title); }
      artist.textContent = t ? t.artist : (s.status === 'loading' ? 'Connecting…' : '');
      album.textContent = t ? t.album : '';
    },
    tick() {},
    destroy() {},
  };
}
