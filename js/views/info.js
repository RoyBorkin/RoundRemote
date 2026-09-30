// View 1: clean "now playing" — round artwork, title, artist, album.
// When the controls hide, Classic view can show one of:
//   • the artwork full screen (clear or milky blur), or
//   • an info card — song, artist, album, year and the time left — on black or on the blurred artwork.
// (The same component also sits on top of Video view; the card and options only apply to Classic.)
import { h } from '../ui/dom.js';
import { fmtTime } from '../core/util.js';
import { songYear } from '../core/songinfo.js';
import { dirOf } from '../lyrics/bidi.js';

export function createInfoView() {
  const art = h('div.info-art');
  const glow = h('div.info-glow');
  const title = h('div.info-title', h('span'));
  const artist = h('div.info-artist');
  const album = h('div.info-album');
  // full-screen info card
  const cTitle = h('div.ic-title'), cArtist = h('div.ic-artist'), cAlbum = h('div.ic-album'), cYear = h('span.ic-year');
  const cLeft = h('span.ic-left'), cBar = h('i.ic-bar');
  const card = h('div.info-card', cTitle, cArtist, h('div.ic-row', cAlbum), h('div.ic-foot', cYear, h('span.ic-sep'), cLeft), h('div.ic-track', cBar));
  const el = h('div.view.view-info', glow, art, h('div.info-meta', title, artist, album), card);
  let lastArt = null, trackKey = null, lastLeft = '';

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
      // info card
      const key = t ? `${t.id}|${t.title}` : null;
      if (key !== trackKey) {
        trackKey = key;
        cTitle.textContent = t?.title || tt; cTitle.dir = dirOf(cTitle.textContent);
        cArtist.textContent = t?.artist || ''; cArtist.dir = dirOf(cArtist.textContent);
        cAlbum.textContent = t?.album || ''; cAlbum.dir = dirOf(cAlbum.textContent);
        cYear.textContent = t?.year ? String(t.year) : '';
        card.classList.toggle('has-year', !!t?.year);
        card.classList.toggle('long', (t?.title || '').length > 22);
        if (t && !t.year) songYear(t).then((y) => { if (trackKey === key && y) { cYear.textContent = String(y); card.classList.add('has-year'); } }).catch(() => {});
      }
    },
    tick(pos, s) {
      const d = s?.track?.durationMs || 0;
      const left = d ? `−${fmtTime(Math.max(0, d - pos))}` : '';
      if (left !== lastLeft) { lastLeft = left; cLeft.textContent = left; }
      if (d) cBar.style.transform = `scaleX(${Math.min(1, pos / d).toFixed(4)})`;
    },
    destroy() {},
  };
}
