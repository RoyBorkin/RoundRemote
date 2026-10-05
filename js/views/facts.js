// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// View 6: Fun Facts — facts about the song, the album and the artist, one at a time over the
// blurred artwork. Facts come from Wikipedia and MusicBrainz (see core/songinfo.js); the Demo has
// its own. A new fact appears every N seconds (Settings → Fun Facts, or the button on the right);
// tap the fact to skip to the next one.
import { h } from '../ui/dom.js';
import { store } from '../core/store.js';
import { funFacts } from '../core/songinfo.js';
import { dirOf } from '../lyrics/bidi.js';

export function createFactsView({ player }) {
  const label = h('div.ff-label', h('span.ff-bulb'), h('span.ff-label-text', 'Did you know?'));
  const text = h('div.ff-text');
  const src = h('div.ff-src');
  const dots = h('div.ff-dots');
  const bar = h('i.ff-bar');
  const card = h('div.ff-card', label, text, src);
  const el = h('div.view.view-facts', card, h('div.ff-timer', bar), dots);
  let facts = [], i = 0, key = null, elapsed = 0, lastT = 0, loading = false;

  const secs = () => Math.max(4, +store.get('factSeconds') || 12);
  function paint(msg) {
    card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
    if (msg) {
      text.textContent = msg; text.dir = dirOf(msg); src.textContent = ''; text.className = 'ff-text quiet'; text.style.fontSize = '';
      dots.replaceChildren(); return;
    }
    const f = facts[i % facts.length];
    text.textContent = f.text;
    text.dir = f.dir || dirOf(f.text);
    text.className = `ff-text${f.text.length > 170 ? ' long' : f.text.length < 70 ? ' short' : ''}`;
    src.textContent = [f.about, f.source].filter(Boolean).join(' · ');
    src.dir = dirOf(src.textContent);
    label.lastChild.textContent = f.dir === 'rtl' ? 'הידעת?' : 'Did you know?';
    label.dir = f.dir || 'ltr';
    fitText();
    const n = Math.min(facts.length, 12);
    dots.replaceChildren(...Array.from({ length: n }, (_, k) => h(`i${k === i % n ? '.on' : ''}`)));
    elapsed = 0;
  }
  // shrink long facts until the card fits between the top buttons and the play controls
  function fitText() {
    text.style.fontSize = '';
    const max = el.clientHeight * 0.4;
    let size = parseFloat(getComputedStyle(text).fontSize) || 30;
    for (let k = 0; k < 10 && card.offsetHeight > max && size > 12; k++) { size *= 0.9; text.style.fontSize = `${size.toFixed(1)}px`; }
  }
  function next(step = 1) {
    if (!facts.length) return;
    i = (i + step + facts.length) % facts.length;
    paint();
  }
  async function load(t) {
    const k = t ? `${t.id}|${t.title}` : null;
    if (k === key) return;
    key = k; facts = []; i = 0;
    if (!t) { paint('Play a song to see fun facts about it'); return; }
    loading = true;
    paint(t && /[֐-׿]/.test(`${t.title}${t.artist}`) ? 'מחפש עובדות מעניינות…' : 'Looking up fun facts…');
    try {
      const list = await funFacts(t, player.provider);
      if (key !== k) return;
      facts = list;
    } catch { if (key !== k) return; }
    loading = false;
    if (facts.length) paint();
    else paint('No fun facts found for this song yet');
  }
  // tap the fact for the next one (the player still shows the controls)
  card.addEventListener('click', () => next(1));
  const off = store.on('change:factSeconds', () => { elapsed = 0; });

  return {
    el,
    update(s) { load(s.track); },
    tick(pos, s) {
      const now = performance.now();
      const dt = lastT ? Math.min(250, now - lastT) : 0;
      lastT = now;
      if (!facts.length || loading) { bar.style.transform = 'scaleX(0)'; return; }
      if (s?.isPlaying) elapsed += dt; // the timer rests while the music is paused
      const p = elapsed / (secs() * 1000);
      if (p >= 1) next(1);
      bar.style.transform = `scaleX(${Math.min(1, p).toFixed(4)})`;
    },
    destroy() { off(); },
  };
}
