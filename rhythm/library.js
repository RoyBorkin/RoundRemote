// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The Rhythm Library: every song the app has learned (from any service) with its versions, times played and best
// scores — opened from the Rhythm screen. Hitster isn't part of it (it plays no learned songs).
//   openSongLibrary()   the round list: sort (last played · most played · A–Z · service), search (on-screen keyboard)
//   a song              header, Play, its versions (source, date, sync, plays, best per game) and the best score +
//                       grade per game and difficulty (tap one to play it)
//   Play                version · game · difficulty → the version is selected, the song starts on its own service
//                       (switching the Rhythm service if it belongs to another signed-in one; by id, else by search)
//                       and the game opens with it
// Everything is reachable with a rotary knob / arrow keys (move), Enter (press) and Escape (back).
import { h, badge, clear } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { openPanel, curve, toast, topPanel, closeAllPanels, spinner, emptyNote } from '../js/ui/overlay.js';
import { createKeyboard, wantsKeyboard, editText } from '../js/ui/keyboard.js';
import { go } from '../js/core/router.js';
import { store } from '../js/core/store.js';
import { player } from '../js/core/player.js';
import { normalizeText } from '../js/core/util.js';
import { provider, getService } from '../js/providers/registry.js';
import { iconSvg } from '../games/index.js';
import { sfx } from '../games/kit.js';
import { RHYTHM } from './index.js';
import { songLibrary, songKey, aliasSong, selectVersion, deleteVersion, forget, renameVersion, SOURCE_SHORT, DIFF_IDS, topOf } from './session.js';

/** The rhythm games that play a learned song (all but Hitster). */
const GAMES = RHYTHM.filter((g) => g.needsSong);
const DIFFS = [
  { id: 'easy', name: 'Easy', short: 'Easy' }, { id: 'medium', name: 'Medium', short: 'Med' }, { id: 'hard', name: 'Hard', short: 'Hard' },
  { id: 'expert', name: 'Expert', short: 'Exp' }, { id: 'master', name: 'Master', short: 'Mstr' },
];
const SORTS = [
  { id: 'recent', name: 'Last played' }, { id: 'plays', name: 'Most played' }, { id: 'az', name: 'A–Z' }, { id: 'service', name: 'Service' },
];
const SOURCE_ICON = { file: 'note', synth: 'note', mic: 'mic', bridge: 'desktop', tempo: 'clock', chart: 'list' };

const gameOf = (id) => GAMES.find((g) => g.id === id) || null;
const diffOf = (id) => DIFFS.find((d) => d.id === id) || DIFFS[1];
const fmtScore = (n) => (n == null ? '' : Math.round(n).toLocaleString());
const fmtOff = (ms) => `${ms > 0 ? '+' : '−'}${Math.abs(ms)} ms`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fmtDate(t) {
  if (!t) return '';
  const d = new Date(t), now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

/** Signed in (or set up) and usable now. */
export const signedIn = (svc) => { const p = provider(svc.id); return !p.setupHint() && p.isAuthed(); };
/** Make a service the player's (and the Rhythm screen's) service, without leaving the screen. */
export function useService(svc) {
  const p = provider(svc.id);
  store.set('rhythmService', svc.id);
  store.set('lastService', svc.id);
  const app = document.getElementById('app');
  app?.style.setProperty('--accent', svc.color);
  app?.style.setProperty('--brand', svc.color);
  return player.provider !== p ? player.use(p) : Promise.resolve();
}

// ---------------------------------------------------------------- small pieces
const gradeEl = (g, cls = '') => h(`span.rh-grade${cls ? '.' + cls : ''}`, { dataset: { g: g || '-' } }, g || '–');
const gameIc = (gm) => h('i.rh-gic', { html: iconSvg(gm.icon) });
function artEl(s, cls = 'rh-lib-art') {
  const a = h(`div.${cls}`);
  if (s.art) a.style.backgroundImage = `url("${s.art}")`;
  else { a.classList.add('none'); a.innerHTML = icon('note'); }
  return a;
}
/** Best per game for one version's stats → small chips (game icon + grade). */
function miniBests(stats) {
  const out = [];
  for (const gm of GAMES) {
    const top = topOf({ [gm.id]: stats?.[gm.id] });
    if (top) out.push(h('span.rh-mini', { '--c': gm.color, title: `${gm.name}: ${fmtScore(top.score)} (${diffOf(top.diff).name})` }, gameIc(gm), top.grade || '·'));
  }
  return out.length ? h('div.rh-minis', out) : null;
}

/** Arrow keys / a rotary knob move between the panel's buttons (Enter presses, Escape closes — as everywhere). */
function knob(panel) {
  const onKey = (e) => {
    if (topPanel() !== panel || e.target.matches?.('input, textarea')) return;
    const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight', back = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    if (!fwd && !back) return;
    e.preventDefault(); e.stopPropagation();
    const items = [...panel.el.querySelectorAll('.panel-body button, .panel-close')].filter((b) => !b.disabled && b.offsetParent && !b.closest('.kbd'));
    if (!items.length) return;
    let i = items.indexOf(document.activeElement);
    i = i < 0 ? (fwd ? 0 : items.length - 1) : (i + (fwd ? 1 : -1) + items.length) % items.length;
    items[i].focus({ preventScroll: true });
    items[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
    sfx('tick');
  };
  window.addEventListener('keydown', onKey, true);
  const prev = panel.onDestroy;
  panel.onDestroy = () => { window.removeEventListener('keydown', onKey, true); prev?.(); };
}

function confirmPanel({ title, text, ok = 'Delete' }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v, panel) => { if (!answered) { answered = true; resolve(v); } panel?.close(); };
    openPanel({
      title, className: 'opts-panel rh-confirm', onClose: () => done(false),
      build(body, panel) {
        knob(panel);
        const yes = h('button.pill.danger', { type: 'button', onclick: (e) => { e.stopPropagation(); sfx('drop'); done(true, panel); } }, ok);
        body.append(
          h('div.rh-confirm-ic', { html: icon('close') }),
          h('div.rh-confirm-t', text),
          h('div.rh-confirm-btns', h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); done(false, panel); } }, 'Cancel'), yes));
        setTimeout(() => yes.focus({ preventScroll: true }), 50);
      },
    });
  });
}

// ---------------------------------------------------------------- the list
/** Open the Library. onChange() is called when something was renamed or deleted (the Rhythm screen re-reads its song). */
export function openSongLibrary({ onChange } = {}) {
  let songs = null, q = '';
  let sort = SORTS.some((s) => s.id === store.get('rhythmLibSort')) ? store.get('rhythmLibSort') : 'recent';
  return openPanel({
    title: 'Library', className: 'search-panel rh-lib',
    build(body, panel) {
      knob(panel);
      const input = h('input.search-input.rh-lib-q', { type: 'search', placeholder: 'Search your songs', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': 'Search your songs' });
      const sortName = h('span.rh-lib-sort-v');
      const sortBtn = h('button.rh-lib-sort', { type: 'button', 'aria-label': 'Sort', onclick: (e) => { e.stopPropagation(); cycleSort(); } },
        h('span.rh-lib-sort-ic', { html: icon('list') }), sortName);
      const count = h('div.rh-lib-count');
      const list = h('div.list.rh-lib-list');
      body.append(h('div.search-bar.rh-lib-bar', input, sortBtn), count, list);
      curve(list);
      list.append(spinner('Opening your library…'));

      // the on-screen keyboard (closed until the search box is tapped)
      const setKbd = (on) => panel.el.classList.toggle('kbd-open', on);
      input.addEventListener('input', () => { q = input.value; render(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setKbd(false); input.blur(); } });
      list.addEventListener('pointerdown', () => setKbd(false));
      if (wantsKeyboard()) {
        input.readOnly = true;
        input.addEventListener('pointerdown', () => setKbd(true));
        panel.el.appendChild(createKeyboard(input, { onEnter: () => setKbd(false) }));
      }

      function cycleSort() {
        const i = SORTS.findIndex((s) => s.id === sort);
        sort = SORTS[(i + 1) % SORTS.length].id;
        store.set('rhythmLibSort', sort);
        sfx('tick');
        render();
        list.scrollTop = 0;
      }
      const recent = (s) => s.lastPlayed || s.created || 0;
      const svcName = (s) => getService(s.service)?.name || 'Other';
      const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }) || (a.artist || '').localeCompare(b.artist || '');
      function render() {
        sortName.textContent = SORTS.find((s) => s.id === sort).name;
        if (!songs) return;
        clear(list);
        const words = normalizeText(q).split(' ').filter(Boolean);
        let shown = songs.filter((s) => {
          if (!words.length) return true;
          const hay = normalizeText(`${s.title} ${s.artist} ${s.track.album || ''} ${svcName(s)}`);
          return words.every((w) => hay.includes(w));
        });
        const cmp = {
          recent: (a, b) => recent(b) - recent(a) || byTitle(a, b),
          plays: (a, b) => b.plays - a.plays || recent(b) - recent(a),
          az: byTitle,
          service: (a, b) => svcName(a).localeCompare(svcName(b)) || byTitle(a, b),
        }[sort];
        shown = [...shown].sort(cmp);
        count.textContent = q ? `${plural(shown.length, 'song')} of ${songs.length}` : `${plural(songs.length, 'song')} · ${plural(songs.reduce((n, s) => n + s.versions.length, 0), 'version')}`;
        if (!songs.length) {
          list.append(emptyNote('No songs yet — start a rhythm game with a song playing: it’s learned and kept here.'));
          return;
        }
        if (!shown.length) { list.append(emptyNote(`Nothing matches “${q.trim()}”`)); return; }
        let group = null;
        for (const s of shown) {
          if (sort === 'service' && svcName(s) !== group) {
            group = svcName(s);
            const svc = getService(s.service);
            list.append(h('div.rh-lib-head', svc ? badge(svc, 'sm') : null, h('span', group), h('span.rh-lib-head-n', `· ${shown.filter((x) => svcName(x) === group).length}`)));
          }
          list.append(songRow(s));
        }
      }
      function songRow(s) {
        const svc = getService(s.service);
        const meta = [plural(s.versions.length, 'version'), s.plays ? plural(s.plays, 'play') : 'not played yet'];
        if (sort === 'recent' && s.lastPlayed) meta.push(fmtDate(s.lastPlayed));
        return h('button.row.rh-lib-row', { type: 'button', onclick: () => { sfx('tap'); openSong(s.key, { onChange: changed }); } },
          h('div.rh-lib-artw', artEl(s), svc ? badge(svc, 'sm') : null),
          h('div.row-text',
            h('div.row-title', s.title || 'Unknown song'),
            h('div.row-sub', s.artist || svc?.name || ''),
            h('div.rh-lib-meta', meta.join(' · '))),
          s.top ? h('div.rh-lib-best', gradeEl(s.top.grade, 'big'), h('span.rh-lib-score', fmtScore(s.top.score))) : h('div.rh-lib-best.none', gradeEl('', 'big')));
      }
      async function load() {
        try { songs = await songLibrary(); } catch (e) { songs = []; console.warn('[rhythm library]', e); }
        if (!panel.closed) render();
      }
      function changed() { onChange?.(); load(); }
      render();
      load();
    },
  });
}

// ---------------------------------------------------------------- a song
export function openSong(key, { onChange } = {}) {
  return openPanel({
    title: '', className: 'list-panel rh-song-p',
    build(body, panel) {
      knob(panel);
      const list = h('div.list.rh-sd');
      body.append(list);
      curve(list);
      list.append(spinner());
      // the song's name in the panel title only once its header has scrolled away
      const syncTitle = () => { const hd = list.querySelector('.rh-sd-head'); panel.el.classList.toggle('rh-sd-scrolled', !!hd && hd.offsetTop + hd.offsetHeight * 0.6 < list.scrollTop); };
      list.addEventListener('scroll', syncTitle, { passive: true });
      const changed = () => { onChange?.(); load(); };
      async function load() {
        const s = (await songLibrary().catch(() => [])).find((x) => x.key === key);
        if (panel.closed) return;
        if (!s) { panel.close(); return; }
        panel.setTitle(s.title);
        render(s);
      }
      function render(s) {
        const top = list.scrollTop;
        clear(list);
        const svc = getService(s.service);
        const can = !svc || signedIn(svc);
        // header
        list.append(h('div.rh-sd-head',
          artEl(s, 'rh-sd-art'),
          h('div.rh-sd-text',
            h('div.rh-sd-title', s.title || 'Unknown song'),
            h('div.rh-sd-artist', [s.artist, s.track.album].filter(Boolean).join(' · ')),
            h('div.rh-sd-meta', svc ? badge(svc, 'sm') : null, h('span', [svc?.short || svc?.name, plural(s.versions.length, 'version'), s.plays ? plural(s.plays, 'play') : 'not played yet'].filter(Boolean).join(' · '))))));
        // play
        const playBtn = h('button.pill.primary.rh-sd-play', { type: 'button', onclick: (e) => { e.stopPropagation(); sfx('tap'); openPlay(s, { onChange: changed }); } },
          h('span.rh-pp-ic', { html: icon('play') }), 'Play');
        list.append(h('div.rh-sd-actions', playBtn));
        if (!can) list.append(h('div.rh-sd-warn', `${svc.name} isn’t signed in on this display`));
        // versions
        list.append(h('div.rh-sec', 'Versions'));
        s.versions.forEach((v, i) => {
          const sel = v.id === s.selectedId;
          const off = Math.round(+v.offsetMs || 0);
          const bits = [SOURCE_SHORT[v.source] || v.source || '', v.charter ? `by ${v.charter}` : '', fmtDate(v.created), off ? fmtOff(off) : '', v.plays ? plural(v.plays, 'play') : ''].filter(Boolean);
          list.append(h(`button.rh-vrow${sel ? '.on' : ''}`, { type: 'button', 'aria-label': `${v.name}${sel ? ' (selected)' : ''}`, onclick: (e) => { e.stopPropagation(); sfx('tap'); openVersion(s, v, { onChange: changed }); } },
            h('span.rh-vnum', sel ? { html: icon('check') } : {}, sel ? null : String(i + 1)),
            h('div.rh-vtext',
              h('div.rh-vname', h('span.rh-vsrc', { html: icon(SOURCE_ICON[v.source] || 'note') }), h('span.rh-vname-t', v.name || `Version ${i + 1}`), sel ? h('span.rh-vtag', 'Selected') : null),
              h('div.rh-vsub', bits.join(' · ')),
              miniBests(v.stats)),
            h('span.rh-vmore', { html: icon('chevron') })));
        });
        // best per game & difficulty — tap a cell to play it
        list.append(h('div.rh-sec', 'Best scores'));
        const grid = h('div.rh-bgrid', h('div.rh-bg-row.rh-bg-h', h('span'), DIFFS.map((d) => h('span', d.short))));
        for (const gm of GAMES) {
          const cells = DIFF_IDS.map((diff) => {
            const c = s.best?.[gm.id]?.[diff];
            return h(`button.rh-bg-cell${c?.best != null ? '.has' : ''}`, {
              type: 'button', 'aria-label': `${gm.name} ${diffOf(diff).name}${c?.best != null ? `: ${fmtScore(c.best)} ${c.grade || ''}` : ''}`,
              onclick: (e) => { e.stopPropagation(); sfx('tap'); openPlay(s, { game: gm.id, diff, onChange: changed }); },
            }, c?.best != null ? [gradeEl(c.grade), h('span.rh-bg-sc', compact(c.best)), c.fc ? h('span.rh-fc', 'FC') : null] : h('span.rh-bg-none', '·'));
          });
          grid.append(h('div.rh-bg-row', { '--c': gm.color }, h('div.rh-bg-game', gameIc(gm), h('span', gm.name)), cells));
        }
        list.append(grid);
        list.append(h('button.rh-del', { type: 'button', onclick: async (e) => {
          e.stopPropagation();
          if (!(await confirmPanel({ title: 'Delete song', text: `Delete “${s.title}” and its ${plural(s.versions.length, 'version')}? Its plays and stats go too; the top-5 charts stay.` }))) return;
          await forget(s.key);
          toast(`“${s.title}” deleted`);
          onChange?.();
          panel.close();
        } }, h('span', { html: icon('close') }), 'Delete song'));
        list.scrollTop = top;
        syncTitle();
      }
      load();
    },
  });
}
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

// ---------------------------------------------------------------- a version
function openVersion(s, v, { onChange } = {}) {
  openPanel({
    title: v.name, className: 'opts-panel rh-ver-p',
    build(body, panel) {
      knob(panel);
      const sel = v.id === s.selectedId;
      const off = Math.round(+v.offsetMs || 0);
      const info = [
        `${SOURCE_SHORT[v.source] || v.source || 'Learned'}${v.charter ? ` · chart by ${v.charter}` : ''} · learned ${fmtDate(v.created)}`,
        [v.seed > 1 ? `chart ${v.seed}` : '', off ? `sync ${fmtOff(off)}` : '', v.plays ? `${plural(v.plays, 'play')} · last ${fmtDate(v.lastPlayed)}` : 'not played yet'].filter(Boolean).join(' · '),
      ];
      const lines = [];
      for (const gm of GAMES) {
        const st = v.stats?.[gm.id];
        if (!st) continue;
        const top = topOf({ [gm.id]: st });
        const plays = Object.values(st).reduce((n, c) => n + (c.plays || 0), 0);
        lines.push(h('div.rh-vb', { '--c': gm.color }, gameIc(gm), h('span.rh-vb-n', gm.name), h('span.rh-vb-d', `${diffOf(top.diff).short} · ${plural(plays, 'play')}`), gradeEl(top.grade), h('span.rh-vb-s', fmtScore(top.score))));
      }
      const act = (label, fn, cls = '') => h(`button.pill.small${cls}`, { type: 'button', onclick: (e) => { e.stopPropagation(); fn(); } }, label);
      body.append(...[
        h('div.rh-ver-info', info.map((t) => h('div', t))),
        lines.length ? h('div.rh-vbs', lines) : null,
        h('div.rh-ver-acts',
          act('Play this version', () => { sfx('tap'); panel.close(); openPlay(s, { versionId: v.id, onChange }); }, '.primary'),
          sel ? null : act('Use this version', () => { selectVersion(s.key, v.id); sfx('tick'); toast(`${v.name} selected`); panel.close(); onChange?.(); })),
        h('div.rh-ver-acts',
          act('Rename', async () => {
            const name = await editText({ title: 'Rename version', value: v.name || '', placeholder: 'Version name', okLabel: 'Save' });
            if (!name) return;
            await renameVersion(s.key, v.id, name);
            toast('Renamed'); panel.close(); onChange?.();
          }),
          act('Delete', async () => {
            const lastOne = s.versions.length === 1;
            if (!(await confirmPanel({ title: 'Delete version', text: lastOne ? `“${v.name}” is the only version of “${s.title}” — deleting it removes the song from the library.` : `Delete “${v.name}” of “${s.title}” and its stats?` }))) return;
            if (lastOne) await forget(s.key); else await deleteVersion(v);
            toast(`${v.name} deleted`); panel.close(); onChange?.();
          }, '.danger')),
      ].filter(Boolean));
    },
  });
}

// ---------------------------------------------------------------- play: version · game · difficulty
export function openPlay(s, { versionId, game, diff, onChange } = {}) {
  const lastV = [...s.versions].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0];
  let vid = s.versions.some((v) => v.id === versionId) ? versionId : s.selectedId;
  const ver = () => s.versions.find((v) => v.id === vid) || s.versions[s.versions.length - 1];
  let gid = gameOf(game)?.id || gameOf(ver()?.lastGame)?.id || gameOf(lastV?.lastGame)?.id || gameOf(store.get('rhythmGame'))?.id || GAMES[0].id;
  let did = DIFF_IDS.includes(diff) ? diff : DIFF_IDS.includes(ver()?.lastDiff) && !game ? ver().lastDiff : (store.get('gameOpts') || {})[gid]?.level || 'medium';
  if (!DIFF_IDS.includes(did)) did = 'medium';
  let busy = false;
  return openPanel({
    title: 'Play', className: 'opts-panel rh-play-p',
    build(body, panel) {
      knob(panel);
      const svc = getService(s.service);
      const head = h('div.rh-pp-head', artEl(s, 'rh-pp-art'), h('div.rh-pp-text', h('div.rh-pp-title', s.title || 'Unknown song'), h('div.rh-pp-sub', s.artist || '')));
      const vChips = h('div.chips.rh-pp-vers');
      const gBtns = h('div.rh-pp-games');
      const gName = h('div.rh-pp-gname');
      const dChips = h('div.chips.rh-pp-diffs');
      const status = h('div.rh-pp-status');
      const go1 = h('button.pill.primary.rh-pp-go', { type: 'button', onclick: (e) => { e.stopPropagation(); start(); } }, h('span.rh-pp-ic', { html: icon('play') }), h('span.rh-pp-go-t', 'Play'));
      body.append(...[head,
        s.versions.length > 1 ? h('div.opt', h('div.opt-label', 'Version'), vChips) : null,
        h('div.opt', h('div.opt-label', 'Game'), gBtns, gName),
        h('div.opt', h('div.opt-label', 'Difficulty'), dChips),
        h('div.rh-pp-foot', go1, status)].filter(Boolean));
      function paint() {
        const gm = gameOf(gid);
        panel.el.style.setProperty('--gc', gm.color);
        clear(vChips);
        s.versions.forEach((v, i) => vChips.append(h(`button.chip${v.id === vid ? '.on' : ''}`, { type: 'button', onclick: (e) => { e.stopPropagation(); vid = v.id; sfx('tick'); paint(); } }, v.name || `Version ${i + 1}`)));
        clear(gBtns);
        for (const g of GAMES) {
          gBtns.append(h(`button.rh-pp-g${g.id === gid ? '.on' : ''}`, { type: 'button', 'aria-label': g.name, '--c': g.color, onclick: (e) => { e.stopPropagation(); gid = g.id; sfx('tick'); paint(); }, html: iconSvg(g.icon) }));
        }
        gName.textContent = gm.name;
        clear(dChips);
        const st = ver()?.stats?.[gid] || {};
        for (const d of DIFFS) {
          const c = st[d.id] || s.best?.[gid]?.[d.id];
          dChips.append(h(`button.chip${d.id === did ? '.on' : ''}`, { type: 'button', onclick: (e) => { e.stopPropagation(); did = d.id; sfx('tick'); paint(); } },
            d.name, c?.grade ? h('span.rh-chip-g', { dataset: { g: c.grade } }, c.grade) : null));
        }
        const can = !svc || signedIn(svc);
        status.textContent = busy ? status.textContent : !can ? `Sign in to ${svc.name} to play this song` : player.provider?.id !== s.service && svc ? `Plays on ${svc.name}` : '';
        go1.querySelector('.rh-pp-go-t').textContent = can ? 'Play' : `Sign in to ${svc.short || svc.name}`;
      }
      async function start() {
        if (busy) return;
        if (svc && !signedIn(svc)) { closeAllPanels(); go('connect', { id: svc.id }); return; }
        busy = true;
        go1.disabled = true;
        panel.el.classList.add('rh-busy-p');
        sfx('tap');
        try {
          await startSongOn(s, (t) => { status.textContent = t; });
        } catch (e) {
          busy = false; go1.disabled = false; panel.el.classList.remove('rh-busy-p');
          status.textContent = e?.message || 'Couldn’t start the song';
          toast(status.textContent, { kind: 'error' });
          return;
        }
        if (panel.closed) return;
        selectVersion(s.key, vid);
        store.set('rhythmGame', gid);
        store.set('gameModes', { ...(store.get('gameModes') || {}), [gid]: 'play' });
        const opts = store.get('gameOpts') || {};
        store.set('gameOpts', { ...opts, [gid]: { ...(opts[gid] || {}), level: did } });
        onChange?.();
        closeAllPanels();
        go('game', { id: gid });
      }
      paint();
      setTimeout(() => { if (!panel.closed) go1.focus({ preventScroll: true }); }, 60);
    },
  });
}

// ---------------------------------------------------------------- starting a saved song on its service
const loose = (s) => normalizeText(String(s || '')).replace(/[^\p{L}\p{N} ]+/gu, '').trim();
function sameSong(t, m) {
  if (!t || !m?.title || loose(t.title) !== loose(m.title)) return false;
  const a = loose(t.artist), b = loose(m.artist);
  return !a || !b || a.includes(b.split(' ')[0]) || b.includes(a.split(' ')[0]);
}
/** Wait until the service plays this song (by key, or the same title + artist under another id). */
async function waitForSong(s, ms) {
  const end = performance.now() + ms;
  let n = 0;
  while (performance.now() < end) {
    const p = player.provider, t = player.state.track;
    if (p && t) {
      const raw = songKey(p, t);
      if (raw === s.key) return true;
      if (sameSong(t, s.track) && (!s.service || p.id === s.service)) { aliasSong(raw, s.key); return true; }
    }
    if (++n % 4 === 0) p?.refresh().catch(() => {});
    await sleep(250);
  }
  return false;
}
/**
 * Make the song play: switch to its service (if another one is in use), then play it by id/uri, and if that isn't
 * possible (or doesn't take) search the service for it by artist + title.
 */
export async function startSongOn(s, onStatus = () => {}) {
  const m = s.track || {};
  const svc = getService(s.service);
  if (s.service && !svc) throw new Error('That music service isn’t available any more');
  if (svc && !signedIn(svc)) throw new Error(`Sign in to ${svc.name} first`);
  if (svc && player.provider?.id !== svc.id) { onStatus(`Switching to ${svc.name}…`); await useService(svc); }
  const p = player.provider;
  if (!p) throw new Error('Choose a music service first');
  const t = player.state.track;
  if (t && (songKey(p, t) === s.key || (sameSong(t, m) && (!s.service || p.id === s.service)))) { aliasSong(songKey(p, t), s.key); return true; }
  const name = svc?.short || svc?.name || p.name || 'the service';
  const title = m.title || 'the song';
  const play = async (item) => { await p.playItem(item); setTimeout(() => p.refresh?.().catch(() => {}), 700); };
  // the service's own search result for it (its exact track when the id matches), if the service can search
  let res = [];
  if (p.caps.search && m.title) {
    onStatus(`Looking for “${title}” on ${name}…`);
    res = ((await p.search(`${m.artist || ''} ${m.title}`.trim()).catch(() => [])) || []).filter((r) => r.kind === 'track');
  }
  const exact = m.id != null && m.id !== '' ? res.find((r) => String(r.id) === String(m.id)) : null;
  // 1. the exact track: from the search, or straight by its id / uri
  if (exact || (s.service && m.id != null && m.id !== '')) {
    onStatus(`Starting “${title}” on ${name}…`);
    const uri = m.uri || (s.service === 'spotify' ? `spotify:track:${m.id}` : undefined);
    try {
      await play(exact || { kind: 'track', id: m.id, uri, albumUri: m.albumUri || undefined, title: m.title, artist: m.artist, subtitle: m.artist });
      if (await waitForSong(s, 7000)) return true;
    } catch (e) { console.warn('[rhythm library] play by id', e); }
  }
  // 2. the same title (and artist) found by the search
  const pick = res.find((r) => r !== exact && loose(r.title) === loose(m.title) && (!m.artist || loose(r.subtitle || r.artist).includes(loose(m.artist).split(' ')[0])))
    || res.find((r) => r !== exact && loose(r.title) === loose(m.title));
  if (pick) {
    onStatus(`Starting “${title}” on ${name}…`);
    await play(pick);
    if (await waitForSong(s, 9000)) return true;
  }
  throw new Error(p.caps.search || (s.service && m.id) ? `Couldn’t start “${m.title || 'the song'}” on ${name}` : `Play “${m.title || 'the song'}” in ${name}’s own app, then start the game`);
}
