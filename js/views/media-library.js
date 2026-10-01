// Movies & shows library browser (Plex / Jellyfin): libraries → items → details, collections,
// search, and "play on the TV". Lives in the media screen's Library tab.
import { h, iconBtn, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openPanel, curve, spinner, emptyNote, toast } from '../ui/overlay.js';
import { createKeyboard, wantsKeyboard } from '../ui/keyboard.js';
import { store } from '../core/store.js';
import { fmtTime, debounce } from '../core/util.js';
import { createItemsView, LIB_VIEWS } from './media-views.js';

const errMsg = (e) => e?.userMessage || e?.message || 'Something went wrong';
const TYPE_ICON = { movie: 'film', show: 'tv', season: 'tv', episode: 'play', collection: 'stack', folder: 'library' };
const KIND = { movie: 'Movie', show: 'Show', season: 'Season', episode: 'Episode', collection: 'Collection' };

/** One library row: poster (or episode still), title, subtitle, progress bar, watched tick. */
export function mediaRow(e, onClick) {
  const spoiler = e.type === 'episode' && !e.watched && store.get('mediaNoSpoilers');
  const art = h(`div.mrow-art${e.wide ? '.wide' : ''}${e.type === 'folder' ? '.folder' : ''}${spoiler ? '.spoiler' : ''}`,
    e.poster ? { style: { backgroundImage: `url("${e.poster}")` } } : null,
    e.poster ? null : h('span', { html: icon(e.icon || TYPE_ICON[e.type] || 'film') }),
    e.progress > 0.02 && !e.watched ? h('i.mrow-prog', h('b', { style: { width: `${Math.round(e.progress * 100)}%` } })) : null);
  const right = e.watched ? h('span.mrow-seen', { html: icon('check'), 'aria-label': 'Watched' })
    : ['folder', 'show', 'season', 'collection'].includes(e.type) ? h('span.mrow-go', { html: icon('chevron') }) : null;
  return h('button.row.mrow', { type: 'button', onclick: (ev) => { ev.stopPropagation(); onClick?.(e); } },
    art, h('div.row-text', h('div.row-title', e.title || ''), e.subtitle ? h('div.row-sub', e.subtitle) : null), right);
}

/** Search panel with the on-screen keyboard; resolves picks through onPick(entry). */
export function openMediaSearch(provider, onPick) {
  openPanel({
    title: 'Search', className: 'search-panel',
    build(body, panel) {
      const input = h('input.search-input', { type: 'search', placeholder: 'Movies, shows, episodes', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
      const list = h('div.list');
      const useKbd = wantsKeyboard();
      const setKbd = (on) => panel.el.classList.toggle('kbd-open', on);
      body.append(h('div.search-bar', input, useKbd ? iconBtn('keyboard', 'Keyboard', () => setKbd(!panel.el.classList.contains('kbd-open')), 'kbd-toggle') : null), list);
      curve(list);
      let seq = 0;
      const run = async (q) => {
        const my = ++seq;
        q = q.trim();
        if (q.length < 2) { clear(list); return; }
        clear(list); list.append(spinner('Searching…'));
        try {
          const res = await provider.searchMedia(q);
          if (my !== seq) return;
          clear(list);
          if (!res.length) { list.append(emptyNote('Nothing found')); return; }
          for (const r of res) {
            const row = mediaRow(r, () => { panel.close(); onPick(r); });
            row.append(h('span.kind', KIND[r.type] || ''));
            list.append(row);
          }
        } catch (e) { if (my === seq) { clear(list); list.append(emptyNote(errMsg(e))); } }
      };
      const debounced = debounce(run, 450);
      input.addEventListener('input', () => debounced(input.value));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { run(input.value); setKbd(false); } });
      list.addEventListener('pointerdown', () => setKbd(false));
      if (useKbd) {
        input.readOnly = true;
        input.addEventListener('pointerdown', () => setKbd(true));
        panel.el.appendChild(createKeyboard(input, { onEnter: (v) => { run(v); setKbd(false); } }));
        setKbd(true);
      } else setTimeout(() => input.focus(), 250);
    },
  });
}

/**
 * @param {{ provider, onPlayed?:Function, onNeedDevice?:Function }} opts
 */
export function createMediaLibrary({ provider, onPlayed, onNeedDevice, onContext }) {
  const titleEl = h('div.mlib-title');
  const backBtn = iconBtn('back', 'Back', () => pop(), 'mlib-back small');
  const searchBtn = iconBtn('search', 'Search', () => openMediaSearch(provider, (e) => openDetail(e)), 'mlib-search small');
  const viewBtn = iconBtn('apps', 'Library view', () => pickView(), 'mlib-view small');
  const pages = h('div.mlib-pages');
  const el = h('div.mlib', h('div.mlib-head', backBtn, titleEl, viewBtn, searchBtn), pages);
  const stack = [];

  function show() {
    const top = stack[stack.length - 1];
    [...pages.children].forEach((c) => { c.hidden = c !== top.el; });
    titleEl.textContent = top.title || '';
    el.dataset.view = top.view || 'detail';
    onContext?.(top.ctx || null);   // what this page is about (for the content-aware backgrounds)
    backBtn.style.visibility = stack.length > 1 ? 'visible' : 'hidden';
  }
  function push(page) { stack.push(page); pages.append(page.el); show(); }
  function pop() {
    if (stack.length <= 1) return;
    const p = stack.pop(); p.el.remove(); p.destroy?.(); show();
  }

  // ---------- list pages (drawn in the chosen library view) ----------
  function openNode(node, title = '') {
    const view = node.kind === 'root' ? 'list' : (store.get('mediaLibView') || 'list');
    let start = 0, busy = false, done = false;
    const v = createItemsView(view, { onPick: pick, onNeedMore: () => load(), row: mediaRow });
    const page = { el: v.el, title, view, node, destroy: () => v.destroy() };
    push(page);
    async function load() {
      if (busy || done) return;
      busy = true;
      if (!start) v.loading(true);
      try {
        const res = await provider.browse(node, { start });
        v.loading(false);
        if (!start && res.title && !title) { page.title = res.title; if (stack[stack.length - 1] === page) show(); }
        if (!start && !res.items.length) { v.empty(res.emptyText || (store.get('mediaHideWatched') ? 'Nothing unwatched here' : 'Nothing here')); done = true; return; }
        v.add(res.items);
        start += res.items.length;
        done = !res.more;
        v.setMore(!!res.more);
        if (!page.ctx) {
          page.ctx = res.items.find((x) => x.type !== 'folder' && (x.backdrop || x.poster)) || null;
          if (stack[stack.length - 1] === page) onContext?.(page.ctx);
        }
        // the honeycomb is one shape, so it loads everything (up to 400)
        if (view === 'watch' && res.more && start < 400) setTimeout(() => load(), 0);
      } catch (e) { v.loading(false); v.error(errMsg(e), () => { busy = false; load(); }); }
      finally { busy = false; }
    }
    load();
  }
  function pickView() {
    openPanel({
      title: 'Library view', className: 'opts-panel.libview-panel',
      build(body, panel) {
        const grid = h('div.libview-grid');
        for (const v of LIB_VIEWS) {
          grid.append(h(`button.libview-opt${(store.get('mediaLibView') || 'list') === v.id ? '.on' : ''}`, { type: 'button', onclick: (e) => {
            e.stopPropagation(); store.set('mediaLibView', v.id); panel.close();
            // redraw the page you're on in the new view
            const top = stack[stack.length - 1];
            if (top?.node && top.node.kind !== 'root') { stack.pop(); top.el.remove(); top.destroy?.(); openNode(top.node, top.title); }
          } }, h(`span.lv-ic.lv-${v.id}`), h('span', v.name)));
        }
        body.append(grid);
      },
    });
  }
  function pick(e) {
    if (e.type === 'folder') return openNode(e.node, e.title);
    openDetail(e);
  }

  // ---------- details ----------
  function openDetail(entry) {
    const box = h('div.list.mdet');
    const page = { el: box, title: KIND[entry.type] || '', view: 'detail', ctx: entry };
    push(page);
    box.append(spinner());
    provider.details(entry).then((d) => {
      renderDetail(box, d);
      page.ctx = d;
      if (stack[stack.length - 1] === page) onContext?.(d);
    }).catch((e) => { clear(box); box.append(emptyNote(errMsg(e))); });
  }
  async function play(d, fromStart) {
    try {
      await provider.playMedia(d, { fromStart });
      toast(`Playing ${d.type === 'episode' && d.show ? `${d.show} · S${d.season}E${d.episode}` : d.title}`);
      setTimeout(() => provider.refresh().catch(() => {}), 900);
      onPlayed?.();
    } catch (e) {
      toast(errMsg(e), { kind: 'error' });
      if (/Devices/.test(errMsg(e))) onNeedDevice?.();
    }
  }
  function renderDetail(box, d) {
    clear(box);
    const spoiler = d.type === 'episode' && !d.watched && store.get('mediaNoSpoilers');
    const meta = [d.year, d.durationMs ? runtimeOf(d.durationMs) : '', d.contentRating, d.rating ? `★ ${d.rating}` : ''].filter(Boolean).join('  ·  ');
    const resumable = d.viewOffset > 30000 && !d.watched && ['movie', 'episode'].includes(d.type);
    const pref = store.get('mediaResume');
    const actions = h('div.mdet-actions');
    if (resumable) {
      const res = h(`button.pill${pref !== 'start' ? '.primary' : ''}`, { type: 'button', onclick: (e) => { e.stopPropagation(); play(d, false); } }, `▶ Resume ${fmtTime(d.viewOffset)}`);
      const beg = h(`button.pill${pref === 'start' ? '.primary' : ''}`, { type: 'button', onclick: (e) => { e.stopPropagation(); play(d, true); } }, 'From start');
      actions.append(...(pref === 'start' ? [beg, res] : [res, beg]));
    } else {
      const label = d.type === 'show' ? '▶ Play next episode' : d.type === 'season' ? '▶ Play season' : d.type === 'collection' ? '▶ Play all' : '▶ Play';
      actions.append(h('button.pill.primary', { type: 'button', onclick: (e) => { e.stopPropagation(); play(d, d.type === 'movie' || d.type === 'episode'); } }, label));
    }
    if (provider.markWatched && d.type !== 'collection') {
      const w = h(`button.pill${d.watched ? '.on' : ''}`, { type: 'button' }, d.watched ? '✓ Watched' : 'Mark watched');
      w.onclick = async (e) => {
        e.stopPropagation();
        try { await provider.markWatched(d, !d.watched); d.watched = !d.watched; w.textContent = d.watched ? '✓ Watched' : 'Mark watched'; toast(d.watched ? 'Marked as watched' : 'Marked as unwatched'); }
        catch (err) { toast(errMsg(err), { kind: 'error' }); }
      };
      actions.append(w);
    }
    if (provider.searchSubtitles && ['movie', 'episode'].includes(d.type)) {
      actions.append(h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); import('../screens/media-panels.js').then((m) => m.openSubtitleSearch(d)); } }, 'Subtitles'));
    }
    const summary = h(`div.mdet-summary${spoiler ? '.spoiler' : ''}`, d.summary || '');
    if (spoiler) summary.onclick = (e) => { e.stopPropagation(); summary.classList.remove('spoiler'); };
    const credits = [
      d.directors?.length ? `Directed by ${d.directors.slice(0, 2).join(', ')}` : '',
      d.writers?.length ? `Written by ${d.writers.slice(0, 2).join(', ')}` : '',
      d.studio || '', d.originallyAvailableAt ? `Released ${d.originallyAvailableAt}` : '',
    ].filter(Boolean);
    box.append(...[
      h(`div.mdet-hero${d.wide ? '.wide' : ''}${spoiler ? '.spoiler' : ''}`, d.poster ? { style: { backgroundImage: `url("${d.poster}")` } } : h('span', { html: icon(TYPE_ICON[d.type] || 'film') })),
      d.show && d.type !== 'show' ? h('div.mdet-show', `${d.show}${d.season != null ? ` · Season ${d.season}` : ''}${d.episode != null ? ` · Episode ${d.episode}` : ''}`) : null,
      h('div.mdet-title', d.title),
      meta ? h('div.mdet-meta', meta) : null,
      d.genres?.length ? h('div.mdet-genres', d.genres.slice(0, 4).map((g) => h('span', g))) : null,
      actions,
      d.tagline ? h('div.mdet-tagline', d.tagline) : null,
      d.summary ? summary : null,
      credits.length ? h('div.mdet-credits', credits.join('  ·  ')) : null,
    ].filter(Boolean));
    // seasons / episodes / collection items
    if (d.children?.length) {
      box.append(h('div.mdet-sec', d.type === 'show' ? 'Seasons' : d.type === 'season' ? 'Episodes' : 'In this collection'));
      for (const c of d.children) box.append(mediaRow(c, pick));
    }
    if (d.cast?.length) box.append(h('div.mdet-sec', 'Cast'), castStrip(d.cast));
    // collection + suggestions load after the main page
    const later = h('div.mdet-later');
    box.append(later);
    (async () => {
      if (provider.collectionsFor && d.type !== 'collection') {
        const cols = await provider.collectionsFor(d).catch(() => []);
        for (const c of cols) {
          later.append(h('div.mdet-sec', `Collection · ${c.title}`));
          c.items.filter((x) => ![String(d.id), String(d.showId)].includes(String(x.id))).forEach((x) => later.append(mediaRow(x, pick)));
        }
      }
      if (provider.related && ['movie', 'show', 'episode', 'season'].includes(d.type)) {
        const rel = await provider.related(d).catch(() => []);
        if (rel.length) { later.append(h('div.mdet-sec', 'More like this')); rel.slice(0, 12).forEach((x) => later.append(mediaRow(x, pick))); }
      }
    })();
  }

  openNode({ kind: 'root' });
  return {
    el,
    openDetail,
    home() { while (stack.length > 1) pop(); },
    destroy() {},
  };
}

export function runtimeOf(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** Horizontal strip of cast photos (swipe sideways). */
export function castStrip(cast) {
  return h('div.cast-strip', cast.slice(0, 24).map((c) => h('div.cast-card',
    h('div.cast-photo', c.photo ? { style: { backgroundImage: `url("${c.photo}")` } } : null, c.photo ? null : initials(c.name)),
    h('div.cast-name', c.name), c.role ? h('div.cast-role', c.role) : null)));
}
const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
