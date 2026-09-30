// Round panels for the Movies & shows screen: info, cast, fun facts, suggestions, collection,
// audio & subtitles, and the screen's options (background etc.).
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openPanel, curve, listRow, spinner, emptyNote, toast } from '../ui/overlay.js';
import { player } from '../core/player.js';
import { store } from '../core/store.js';
import { mediaFacts } from '../core/mediainfo.js';
import { mediaRow, castStrip, runtimeOf } from '../views/media-library.js';
import { chips, toggle, stepper } from './panels.js';

const errMsg = (e) => e?.userMessage || e?.message || 'Something went wrong';
export const MEDIA_BGS = [
  { id: 'poster', name: 'Poster' }, { id: 'backdrop', name: 'Photo' }, { id: 'blur', name: 'Blurred' },
  { id: 'black', name: 'Black' }, { id: 'slides', name: 'Slideshow' },
];

/** Details of what's playing: the provider's full details when it has them, else the now-playing fields. */
export async function currentDetails() {
  const m = player.state.track?.media;
  if (!m) return null;
  const p = player.provider;
  if (p?.details && m.itemId) { try { return { ...m, ...(await p.details({ id: m.itemId, itemId: m.itemId, type: m.type })) }; } catch {} }
  return { ...m, durationMs: player.duration() };
}

function listPanel(title, fill, className = '') {
  openPanel({
    title, className: `list-panel.media-panel${className ? '.' + className : ''}`,
    build(body, panel) {
      const list = h('div.list');
      body.append(list);
      curve(list);
      list.append(spinner());
      Promise.resolve(fill(list, panel)).catch((e) => { clear(list); list.append(emptyNote(errMsg(e))); });
    },
  });
}

export function openMediaInfo() {
  listPanel('About', async (list) => {
    const d = await currentDetails();
    clear(list);
    if (!d) { list.append(emptyNote('Nothing playing')); return; }
    const meta = [d.year, d.durationMs ? runtimeOf(d.durationMs) : '', d.contentRating, d.rating ? `★ ${d.rating}` : '', d.criticRating ? `🍅 ${d.criticRating}%` : ''].filter(Boolean).join('  ·  ');
    const credits = [
      d.directors?.length ? `Directed by ${d.directors.slice(0, 3).join(', ')}` : '',
      d.writers?.length ? `Written by ${d.writers.slice(0, 3).join(', ')}` : '',
      d.studio ? `Studio: ${d.studio}` : '', d.originallyAvailableAt ? `Released ${d.originallyAvailableAt}` : '',
      d.countries?.length ? d.countries.slice(0, 3).join(', ') : '',
    ].filter(Boolean);
    list.append(...[
      h(`div.mdet-hero${d.type === 'episode' && d.still ? '.wide' : ''}`, { style: { backgroundImage: `url("${d.type === 'episode' && d.still ? d.still : d.poster || ''}")` } }),
      d.show ? h('div.mdet-show', `${d.show}${d.season != null ? ` · Season ${d.season}` : ''}${d.episode != null ? ` · Episode ${d.episode}` : ''}`) : null,
      h('div.mdet-title', d.title),
      meta ? h('div.mdet-meta', meta) : null,
      d.genres?.length ? h('div.mdet-genres', d.genres.slice(0, 5).map((g) => h('span', g))) : null,
      d.tagline ? h('div.mdet-tagline', d.tagline) : null,
      d.summary ? h('div.mdet-summary', d.summary) : h('div.mdet-summary.dim', 'No description.'),
      credits.length ? h('div.mdet-credits', credits.join('  ·  ')) : null,
      h('div.spacer'),
    ].filter(Boolean));
  }, 'media-info');
}

export function openMediaCast() {
  listPanel('Cast', async (list) => {
    const d = await currentDetails();
    clear(list);
    if (!d?.cast?.length) { list.append(emptyNote('No cast information')); return; }
    list.append(castStrip(d.cast.slice(0, 12)));
    for (const c of d.cast) list.append(listRow({ title: c.name, subtitle: c.role, art: c.photo, mono: c.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('') }));
  }, 'media-cast');
}

export function openMediaFacts() {
  openPanel({
    title: 'Fun facts', className: 'media-facts-panel',
    build(body, panel) {
      const card = h('div.mf-card', spinner('Looking for facts…'));
      const dots = h('div.mf-dots');
      const prevB = h('button.ibtn.small.mf-prev', { type: 'button', 'aria-label': 'Previous fact', html: icon('prev') });
      const nextB = h('button.ibtn.small.mf-next', { type: 'button', 'aria-label': 'Next fact', html: icon('next') });
      body.append(card, dots, prevB, nextB);
      let facts = [], i = 0, timer = 0;
      const showFact = () => {
        if (!facts.length) return;
        i = (i + facts.length) % facts.length;
        const f = facts[i];
        clear(card).append(h('div.mf-text', { dir: f.dir }, f.text), h('div.mf-src', `${f.source}${f.about ? ` · ${f.about}` : ''}`));
        card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
        clear(dots).append(h('span', `${i + 1} / ${facts.length}`));
        clearTimeout(timer);
        timer = setTimeout(() => { i++; showFact(); }, (store.get('factSeconds') || 12) * 1000);
      };
      prevB.onclick = (e) => { e.stopPropagation(); i--; showFact(); };
      nextB.onclick = (e) => { e.stopPropagation(); i++; showFact(); };
      card.onclick = (e) => { e.stopPropagation(); i++; showFact(); };
      currentDetails().then((d) => (d ? mediaFacts(d) : [])).then((f) => {
        facts = f;
        if (!facts.length) { clear(card).append(emptyNote('No facts found for this one')); return; }
        showFact();
      }).catch(() => { clear(card).append(emptyNote('Couldn’t load facts')); });
      panel.onDestroy = () => clearTimeout(timer);
    },
  });
}

export function openMediaSuggestions(onPick) {
  listPanel('More like this', async (list, panel) => {
    const d = await currentDetails();
    const rel = d && player.provider?.related ? await player.provider.related(d) : [];
    clear(list);
    if (!rel.length) { list.append(emptyNote('No suggestions from your library')); return; }
    rel.forEach((x) => list.append(mediaRow(x, (e) => { panel.close(); onPick(e); })));
  });
}

export function openMediaCollection(onPick) {
  listPanel('Collection', async (list, panel) => {
    const d = await currentDetails();
    const cols = d && player.provider?.collectionsFor ? await player.provider.collectionsFor(d) : [];
    clear(list);
    if (!cols.length) { list.append(emptyNote('This isn’t part of a collection')); return; }
    for (const c of cols) {
      list.append(h('div.mdet-sec', c.title));
      c.items.forEach((x) => { const r = mediaRow(x, (e) => { panel.close(); onPick(e); }); if (String(x.id) === String(d.itemId || d.id)) r.classList.add('active'); list.append(r); });
    }
  });
}

export function openMediaTracks() {
  openPanel({
    title: 'Audio & subtitles', className: 'opts-panel.media-tracks',
    build(body) {
      body.append(spinner());
      player.provider.streams().then(({ audio, subs }) => {
        clear(body);
        const set = (kind, id) => player.provider.setStream(kind, id).then(() => toast(kind === 'audio' ? 'Audio changed' : id == null ? 'Subtitles off' : 'Subtitles changed')).catch((e) => toast(errMsg(e), { kind: 'error' }));
        const curA = audio.find((s) => s.selected)?.id;
        const curS = subs.find((s) => s.selected)?.id ?? 'off';
        if (audio.length) body.append(h('div.opt', h('div.opt-label', 'Audio'), chips(audio.map((s) => ({ id: s.id, name: s.name })), curA, (id) => set('audio', id))));
        body.append(h('div.opt', h('div.opt-label', 'Subtitles'), chips([{ id: 'off', name: 'Off' }, ...subs.map((s) => ({ id: s.id, name: s.name }))], curS, (id) => set('subs', id === 'off' ? null : id))));
        if (!audio.length && !subs.length) body.append(emptyNote('No other audio or subtitle tracks'));
      }).catch((e) => { clear(body); body.append(emptyNote(errMsg(e))); });
    },
  });
}

/** Options for the media screen (the ⋯ button). */
export function openMediaOptions({ onRemote } = {}) {
  openPanel({
    title: 'Options', className: 'opts-panel.media-opts',
    build(body, panel) {
      const c = player.caps;
      body.append(
        h('div.opt', h('div.opt-label', 'Background'), chips(MEDIA_BGS, store.get('mediaBg'), (v) => store.set('mediaBg', v))),
        stepper('Slideshow speed', () => store.get('mediaSlideSec'), (v) => store.set('mediaSlideSec', Math.max(4, Math.min(60, v))), { step: 2, fmt: (v) => `${v}s` }),
        toggle('Title & time left when hidden', () => store.get('mediaHud'), (v) => store.set('mediaHud', v)),
      );
      const row = h('div.chips');
      if (c.remote && onRemote) row.append(h('button.chip', { type: 'button', onclick: (e) => { e.stopPropagation(); panel.close(); onRemote(); } }, 'TV remote'));
      if (c.stop) row.append(h('button.chip', { type: 'button', onclick: async (e) => { e.stopPropagation(); panel.close(); try { await player.provider.stopPlayback(); toast('Stopped'); } catch (err) { toast(errMsg(err), { kind: 'error' }); } } }, 'Stop playback'));
      const m = player.state.track?.media;
      if (m?.itemId && player.provider?.markWatched) row.append(h('button.chip', { type: 'button', onclick: async (e) => { e.stopPropagation(); try { await player.provider.markWatched({ id: m.itemId }, true); toast('Marked as watched'); } catch (err) { toast(errMsg(err), { kind: 'error' }); } } }, 'Mark watched'));
      if (row.children.length) body.append(row);
    },
  });
}
