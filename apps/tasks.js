// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Task manager: the content manager for every game with cards or questions. A game switcher at the top — Truth or Dare
// (truths, dares, tasks) · Drinking games (Never Have I Ever, Most Likely To, Party Cards, Kings Cup rules) · Trivia
// (questions by topic) · More (Fill the Blank, Code Words and the Notes Game keep their own managers — counts and a
// button to open them). Built-in packs (the games' own data) plus everything players add — on the display, or from
// their phones by scanning the QR code (the bridge serves the page; see bridge/lib/tasks.js). Search, filters (language,
// built-in / added, lists, tags, difficulty), user-defined lists ("Family night"…) any entry can belong to, per-entry
// 18+, edit / hide built-ins, import / export JSON per game. Sessions (Truth or Dare): "New game session" starts a fresh
// one, and the All / This session filter (shared with Truth or Dare) picks between everything and what this game added.
import { clear } from '../js/ui/dom.js';
import { curve } from '../js/ui/overlay.js';
import { store } from '../js/core/store.js';
import { bridgeBase } from '../js/providers/bridge.js';
import { qrSvg } from './qr.js';
import * as T from './tasks-store.js';
import { PACKS } from './tasks-packs.js';
import { ensureCss, qrGlyph, itemForm, addFlow, listChips, phonesPanel } from './tasks-ui.js';

const { TYPE_META, TAG_NAMES, GROUPS, TOD, PARTY_KIND_NAMES, DIFF_NAMES } = T;
const PAGE = 80;   // rows rendered at a time (the Pi stays smooth with ~1,500 built-in entries)

function ago(ms) {
  if (!ms) return '';
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: m > 60 * 24 * 300 ? 'numeric' : undefined });
}
const groupOf = (type) => GROUPS.find((g) => g.types.includes(type)) || GROUPS[0];

export default {
  css: './tasks.css',
  create(el, app) {
    const { h, icon } = app;
    ensureCss();
    app.setTitle('Task manager');
    let type = T.TYPES.includes(app.data('tab', 'truth')) ? app.data('tab', 'truth') : 'truth';
    let group = GROUPS.some((g) => g.id === app.data('group')) ? app.data('group') : groupOf(type).id;
    if (group !== 'more' && !GROUPS.find((g) => g.id === group).types.includes(type)) type = GROUPS.find((g) => g.id === group).types[0];
    const lastType = { ...app.data('lastType', {}) };
    let topic = '';                  // trivia: one topic or '' = all
    let query = '';
    let shown = PAGE;
    let highlight = null;            // id of an item to flash
    const filt = () => ({ lang: '', source: 'all', lists: [], tags: [], diff: 0, ...app.data('filt', {}) });
    const putFilt = (p) => { app.save('filt', { ...filt(), ...p }); shown = PAGE; render(); };
    const offs = [];

    // ------------------------------------------------------------ page
    const groups = h('div.tk-groups', { role: 'tablist' });
    const tabs = h('div.tk-tabs', { role: 'tablist' });
    const filterRow = h('div.tk-filter');
    const list = h('div.tk-list.list');
    const reCurve = curve(list);
    const btnQr = h('button.tk-btn', { type: 'button', 'aria-label': 'Add from phones (QR code)', onclick: () => phones() }, qrGlyph(), h('span', 'Phones'));
    const btnAdd = h('button.tk-add', { type: 'button', 'aria-label': 'Add', onclick: () => add() }, h('i', { html: icon('plus') }));
    const btnSet = h('button.tk-btn', { type: 'button', 'aria-label': 'Options', onclick: () => openSettings() }, h('i', { html: icon('settings') }), h('span', 'Options'));
    const bar = h('div.tk-bar', btnQr, btnAdd, btnSet);
    const pop = h('div.tk-pop', { 'aria-live': 'polite' });
    el.append(groups, tabs, filterRow, list, bar, pop);
    el.classList.add('tk');

    function setGroup(g) {
      if (group === g) return;
      lastType[group] = type;
      group = g; app.save('group', g); app.save('lastType', lastType);
      const G = GROUPS.find((x) => x.id === g);
      if (G.types.length) { type = G.types.includes(lastType[g]) ? lastType[g] : G.types[0]; app.save('tab', type); }
      topic = ''; query = ''; shown = PAGE;
      app.sfx('tick'); render(); list.scrollTop = 0;
    }
    const baseOpts = () => {
      const f = filt(), s = T.settings();
      return { filter: group === 'tod' ? s.filter : 'all', tags: group === 'tod' ? f.tags : [], lang: f.lang || null, source: f.source, lists: f.lists.filter((id) => T.listById(id)),
        diff: group === 'trivia' ? f.diff : 0, q: query, packs: group === 'tod' };
    };

    function renderGroups() {
      clear(groups);
      for (const g of GROUPS) groups.append(h(`button.tk-group${g.id === group ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(g.id === group), '--k': g.color, onclick: () => setGroup(g.id) }, g.short));
    }
    function renderTabs() {
      clear(tabs);
      tabs.className = 'tk-tabs';
      const G = GROUPS.find((x) => x.id === group);
      if (group === 'more') { tabs.hidden = true; return; }
      tabs.hidden = false;
      if (group === 'trivia') {
        tabs.classList.add('tk-topics');
        const pool = T.pool({ ...baseOpts(), type: 'trivia' });
        const c = {};
        for (const it of pool) c[it.cat] = (c[it.cat] || 0) + 1;
        const tp = T.topics().filter((x) => !x.custom || c[x.id]);
        const chip = (id, label, n, color) => h(`button.tk-topic${topic === id ? '.on' : ''}`, { type: 'button', '--k': color, dir: 'auto', onclick: () => { topic = id; shown = PAGE; app.sfx('tick'); render(); list.scrollTop = 0; } }, label, h('span.tk-tab-c', String(n)));
        tabs.append(chip('', 'All topics', pool.length, '#94a3b8'), ...tp.map((x) => chip(x.id, `${x.icon} ${x.name}`, c[x.id] || 0, x.color)));
        requestAnimationFrame(() => tabs.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
        return;
      }
      const c = T.counts(baseOpts());
      for (const k of G.types) {
        tabs.append(h(`button.tk-tab${k === type ? '.on' : ''}`, { type: 'button', role: 'tab', '--k': TYPE_META[k].color, 'aria-selected': String(k === type),
          onclick: () => { if (type !== k) { type = k; app.save('tab', k); app.sfx('tick'); shown = PAGE; render(); list.scrollTop = 0; } } },
          h('span.tk-tab-n', TYPE_META[k].short || TYPE_META[k].plural), h('span.tk-tab-c', String(c[k]))));
      }
    }
    function renderFilter() {
      clear(filterRow);
      if (group === 'more') return;
      const s = T.settings(), f = filt();
      const nf = (f.lang ? 1 : 0) + (f.source !== 'all' ? 1 : 0) + f.lists.filter((id) => T.listById(id)).length + (group === 'tod' ? f.tags.length : 0) + (group === 'trivia' && f.diff ? 1 : 0);
      filterRow.append(query
        ? h('button.chip.on.tk-q', { type: 'button', dir: 'auto', onclick: () => { query = ''; shown = PAGE; render(); } }, `“${query}” ✕`)
        : h('button.chip.tk-ic', { type: 'button', 'aria-label': 'Search', onclick: () => search(), html: icon('search') }));
      filterRow.append(h(`button.chip${nf ? '.on' : ''}`, { type: 'button', onclick: () => openFilter() }, nf ? `Filter · ${nf}` : 'Filter'));
      if (group === 'tod') {
        const chip = (val, label) => h(`button.chip${s.filter === val ? '.on' : ''}`, { type: 'button', onclick: () => { T.setSettings({ filter: val }); app.sfx('tap'); list.scrollTop = 0; } }, label);
        filterRow.append(chip('all', 'All'), chip('session', h('span', 'Session ', h('b.tk-code', T.session().id))));
      }
      const st = T.bridge.status;
      filterRow.append(h(`span.tk-live.${st}`, { title: st === 'ok' ? 'Phones can add items' : 'Bridge not connected' }));
    }
    function rowMeta(it) {
      const bits = [];
      if (it.type === 'trivia') { bits.push(`✓ ${it.answer}`, T.topicOf(it.cat).name); if (it.d) bits.push(DIFF_NAMES[it.d]); }
      if (it.type === 'party') bits.push(PARTY_KIND_NAMES[it.kind] || 'Everyone', ...(it.kind === 'r' && it.turns ? [`${it.turns} cards`] : []));
      if (it.author) bits.push(`by ${it.author}`);
      bits.push(it.builtin ? `Built-in${it.builtin === 'he' ? ' · עברית' : ''}${it.updated ? ' · edited' : ''}` : ago(it.created));
      const names = (it.lists || []).map((id) => T.listById(id)?.text).filter(Boolean);
      if (names.length) bits.push(`☰ ${names.join(', ')}`);
      bits.push(...(it.tags || []).filter((t) => t !== 'family' && !T.isAdult({ tags: [t] })).map((t) => `#${TAG_NAMES[t] || t}`));
      return bits.filter(Boolean).join(' · ');
    }
    function renderList() {
      clear(list);
      list.classList.toggle('tk-more', group === 'more');
      if (group === 'more') { renderMore(); reCurve(); return; }
      const items = T.pool({ ...baseOpts(), type, cats: group === 'trivia' && topic ? [topic] : null })
        .sort((a, b) => (b.created || 0) - (a.created || 0) || (type === 'kings' ? T.RANKS.indexOf(a.rank) - T.RANKS.indexOf(b.rank) : 0));
      if (!items.length) {
        const s = T.settings(), what = TYPE_META[type].plural.toLowerCase();
        list.append(h('div.tk-empty',
          h('div.tk-empty-t', query || baseOpts().lists.length || filt().lang || filt().source !== 'all' ? `No ${what} match` : group === 'tod' && s.filter === 'session' ? `No ${what} in this session yet` : `No ${what} yet`),
          h('div.tk-empty-m', 'Tap + to write one, or let players scan the QR code and add theirs.'),
          h('button.pill', { type: 'button', onclick: () => phones() }, 'Show QR code')));
        reCurve();
        return;
      }
      for (const it of items.slice(0, shown)) {
        const x = T.isAdult(it);
        const text = it.type === 'kings' ? `${it.rank} · ${it.title ? `${it.title} — ` : ''}${it.text}` : it.text;
        const row = h(`div.tk-row${it.id === highlight ? '.new' : ''}${x ? '.x' : ''}`, { '--k': TYPE_META[it.type].color, dataset: { id: it.id } },
          h('button.tk-row-b', { type: 'button', onclick: () => openItem(it.id) },
            h('div.tk-row-t', { dir: 'auto' }, text),
            h('div.tk-row-m', { dir: 'auto' }, rowMeta(it))),
          h(`button.tk-x18${x ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(x), 'aria-label': '18+ (adults only)', title: x ? '18+ — tap to unmark' : 'Mark as 18+',
            onclick: () => mark18(it.id, !x) }, '18+'));
        list.append(row);
      }
      if (items.length > shown) list.append(h('button.pill.tk-more-btn', { type: 'button', onclick: () => { shown += PAGE; renderList(); } }, `Show more · ${items.length - shown} left`));
      reCurve();
      if (highlight) {
        const r = list.querySelector(`[data-id="${CSS.escape(highlight)}"]`);
        r?.scrollIntoView({ block: 'center' });
        setTimeout(() => { highlight = null; }, 50);
      }
    }
    function render() {
      renderGroups(); renderTabs(); renderFilter(); renderList();
      el.dataset.group = group;
      bar.hidden = group === 'more';
    }

    // ------------------------------------------------------------ More games: their own managers
    let moreCounts = null;
    function renderMore() {
      const card = (id, name, color, sub, n, note) => h('div.tk-game', { '--k': color },
        h('div.tk-game-h', h('b', name), h('span.tk-game-n', n == null ? '…' : String(n))),
        h('div.tk-game-s', sub),
        note ? h('div.tk-game-note', note) : null,
        h('button.pill.small', { type: 'button', onclick: () => app.go('game', { id }) }, 'Open its manager'));
      const c = moreCounts || {};
      list.append(
        h('div.tk-more-h', 'These games keep their own cards — open them to add, import or browse.'),
        card('blanks', 'Fill the Blank', '#f97316', c.blanks || 'Prompt & answer cards · built-in packs + the house pack', c.blanksN, 'Phones add cards with the game’s own QR (Custom cards).'),
        card('codewords', 'Code Words', '#ef4444', c.codewords || 'Word lists in English and Hebrew + your own words', c.codewordsN),
        card('petakiot', 'Notes Game', '#a855f7', c.petakiot || 'Starter names + the notes in the bowl', c.petakiotN));
      if (!moreCounts) loadMore();
    }
    async function loadMore() {
      moreCounts = {};
      const gp = store.get('gameProgress') || {};
      try {
        const { counts } = await import('../games/codewords-words.js');
        const en = counts('en'), he = counts('he'), mine = (gp.codewords?.custom || []).length;
        Object.assign(moreCounts, { codewordsN: en.std + en.kids + he.std + he.kids + mine, codewords: `${en.std + en.kids} English · ${he.std + he.kids} Hebrew · ${mine} of your own` });
      } catch {}
      try {
        const { PACK } = await import('../games/petakiot-pack.js');
        const notes = (gp.petakiot?.notes || []).length;
        Object.assign(moreCounts, { petakiotN: PACK.en.length + PACK.he.length + notes, petakiot: `${PACK.en.length} English · ${PACK.he.length} Hebrew starter names · ${notes} notes in the bowl` });
      } catch {}
      try {
        const B = await import('../games/blanks-packs.js');
        let p = 0, a = 0;
        for (const meta of B.BUILTIN) { const pk = await B.loadBuiltin(meta.id); p += pk.prompts.length; a += pk.answers.length; }
        const br = await B.bridgePacks().catch(() => null);
        const hp = br?.house?.prompts || 0, ha = br?.house?.answers || 0;
        Object.assign(moreCounts, { blanksN: p + a + hp + ha, blanks: `${p} prompts · ${a} answers built in${br ? ` · house pack ${hp + ha}` : ' · house pack needs the bridge'}` });
      } catch {}
      if (group === 'more') renderList();
    }

    // ------------------------------------------------------------ 18+ per entry
    const HIDDEN18 = 'Hidden — 18+ mode is off';
    /** Mark / unmark one entry as 18+. While 18+ mode is off a newly marked entry leaves the list right away. */
    function mark18(id, on) {
      if (!T.setAdult(id, on)) return false;
      app.sfx(on ? 'pop' : 'tap'); app.vibrate(10);
      const hidden = on && !T.settings().adult;
      app.toast(hidden ? HIDDEN18 : on ? 'Marked 18+' : 'No longer 18+');
      return hidden;
    }

    // ------------------------------------------------------------ add / search / phones
    async function add(t = type) {
      if (group === 'more') return;
      const f = filt();
      const it = await addFlow(app, t, { lists: f.lists.filter((id) => T.listById(id)), defaults: t === 'trivia' && topic ? { cat: topic } : {} });
      if (!it) return;
      highlight = T.isAdult(it) && !T.settings().adult ? null : it.id;
      render();
    }
    async function search() {
      const v = await app.editText({ title: 'Search', value: query, placeholder: 'Words, answers, authors…', okLabel: 'Search' });
      if (v === null) return;
      query = v; shown = PAGE; render(); list.scrollTop = 0;
    }
    function phones() { if (group !== 'more') phonesPanel(app, { type }); }

    // ------------------------------------------------------------ one entry
    function openItem(id) {
      app.openPanel({
        title: '', className: 'tk-item-panel',
        build(body, panel) {
          const draw = () => {
            const it = T.getItem(id);
            if (!it) { panel.close(); return; }
            panel.setTitle(TYPE_META[it.type].name);
            panel.el.style.setProperty('--k', TYPE_META[it.type].color);
            clear(body);
            const s = T.settings(), x = T.isAdult(it);
            const meta = [it.author && `by ${it.author}`, it.builtin ? `Built-in${it.updated ? ' · edited' : ''}` : it.created && new Date(it.created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
              it.session && TOD.includes(it.type) && `session ${it.session}`, T.langOf(it) === 'he' ? 'עברית' : 'English'].filter(Boolean).join(' · ');
            const extra = [];
            if (it.type === 'trivia') extra.push(h('div.tk-item-ans', { dir: 'auto' }, `✓ ${it.answer}`), ...(it.wrong || []).map((w) => h('div.tk-item-wr', { dir: 'auto' }, `✗ ${w}`)),
              h('div.tk-item-meta', `${T.topicOf(it.cat).icon} ${T.topicOf(it.cat).name} · ${DIFF_NAMES[it.d || 2]}`));
            if (it.type === 'party') extra.push(h('div.tk-item-meta', { dir: 'auto' }, [PARTY_KIND_NAMES[it.kind] || 'Everyone', it.kind === 'r' && it.end && `ends: ${it.end}`, it.kind === 'r' && it.turns && `${it.turns} cards`].filter(Boolean).join(' · ')));
            const typeChips = TOD.includes(it.type) ? h('div.chips', TOD.map((k) => h(`button.chip${k === it.type ? '.on' : ''}`, { type: 'button', '--k': TYPE_META[k].color,
              onclick: () => { T.updateItem(id, { type: k }); type = k; app.save('tab', k); draw(); } }, TYPE_META[k].name))) : null;
            const tagChips = TOD.includes(it.type) ? h('div.chips.multi', T.TAGS.filter((t) => t !== '18+').map((t) => h(`button.chip${(it.tags || []).includes(t) ? '.on' : ''}`, { type: 'button',
              onclick: () => { const set = new Set(it.tags || []); set.has(t) ? set.delete(t) : set.add(t); T.updateItem(id, { tags: [...set] }); draw(); } }, TAG_NAMES[t]))) : null;
            body.append(...[
              h('button.tk-item-text', { type: 'button', dir: 'auto', onclick: edit }, it.type === 'kings' ? `${it.rank} · ${it.title || ''}` : it.text),
              it.type === 'kings' ? h('div.tk-item-meta', { dir: 'auto' }, it.text) : null,
              ...extra,
              h('div.tk-item-meta', { dir: 'auto' }, meta),
              typeChips, tagChips,
              h('div.tk-item-lists', listChips(app, it.lists || [], (ids) => { T.updateItem(id, { lists: ids }); draw(); })),
              h(`div.tk-item-x18${x ? '.on' : ''}`, h('span.tk-x18.static', '18+'),
                h('div.tk-item-x18-l', h('div', 'Adults only'), h('div.tk-set-sub', x ? (s.adult ? 'Shown — 18+ mode is on' : 'Hidden while 18+ mode is off') : 'Shown to everyone')),
                h(`button.switch${x ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(x), 'aria-label': '18+ (adults only)',
                  onclick: () => { if (mark18(id, !x)) panel.close(); else draw(); } })),
              h('div.tk-item-acts',
                h('button.pill', { type: 'button', onclick: edit }, 'Edit'),
                h('button.pill.danger', { type: 'button', onclick: () => { T.removeItem(id); app.sfx('drop'); app.toast(it.builtin ? 'Hidden — Options → Restore built-ins brings it back' : 'Deleted'); panel.close(); } }, it.builtin ? 'Hide' : 'Delete')),
            ].filter(Boolean));
          };
          async function edit() {
            const it = T.getItem(id);
            if (!it) return;
            const r = await itemForm(app, { type: it.type, item: it });
            if (r) { T.updateItem(id, r); app.toast('Saved'); }
            if (!panel.closed) draw();
          }
          draw();
          panel.onDestroy = T.events.on('change', () => { if (!panel.closed) draw(); });
        },
      });
    }

    // ------------------------------------------------------------ filter
    function openFilter() {
      app.openPanel({
        title: 'Filter', className: 'tk-set-panel',
        build(body, panel) {
          const box = h('div.tk-set.list');
          body.append(box);
          const draw = () => {
            clear(box);
            const f = filt();
            const chips = (opts, cur, fn) => h('div.chips', opts.map(([v, l]) => h(`button.chip${v === cur ? '.on' : ''}`, { type: 'button', onclick: () => { fn(v); app.sfx('tick'); draw(); } }, l)));
            box.append(
              h('div.tk-set-h', 'Language'), chips([['', 'Any'], ['en', 'English'], ['he', 'עברית']], f.lang, (v) => putFilt({ lang: v })),
              h('div.tk-set-h', 'Show'), chips([['all', 'All'], ['builtin', 'Built-in'], ['custom', 'Added']], f.source, (v) => putFilt({ source: v })),
              h('div.tk-set-h', 'Lists'), T.lists().length ? h('div.chips.multi', T.lists().map((l) => h(`button.chip${f.lists.includes(l.id) ? '.on' : ''}`, { type: 'button', dir: 'auto',
                onclick: () => { putFilt({ lists: f.lists.includes(l.id) ? f.lists.filter((x) => x !== l.id) : [...f.lists, l.id] }); draw(); } }, l.text)))
                : h('div.tk-set-sub.tk-set-note', 'No lists yet — make one in Options, or from an entry.'));
            if (group === 'tod') box.append(h('div.tk-set-h', 'Tags'), h('div.chips.multi', T.TAGS.filter((t) => t !== '18+').map((t) => h(`button.chip${f.tags.includes(t) ? '.on' : ''}`, { type: 'button',
              onclick: () => { putFilt({ tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] }); draw(); } }, TAG_NAMES[t]))));
            if (group === 'trivia') box.append(h('div.tk-set-h', 'Difficulty'), chips([[0, 'Any'], [1, 'Easy'], [2, 'Medium'], [3, 'Hard']], f.diff, (v) => putFilt({ diff: v })));
            box.append(h('button.pill', { type: 'button', onclick: () => { app.save('filt', {}); query = ''; render(); panel.close(); } }, 'Clear filters'));
          };
          draw();
        },
      });
    }

    // ------------------------------------------------------------ options
    function openSettings() {
      const G = GROUPS.find((x) => x.id === group);
      app.openPanel({
        title: `${G.name}`, className: 'tk-set-panel',
        build(body, panel) {
          const box = h('div.tk-set.list');
          body.append(box);
          const sw = (on, fn) => h(`button.switch${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(on), onclick: fn });
          const row = (label, sub, right) => { if (right?.classList?.contains('switch') && !right.hasAttribute('aria-label')) right.setAttribute('aria-label', label); return h('div.tk-set-row', h('div.tk-set-l', h('div', { dir: 'auto' }, label), sub ? h('div.tk-set-sub', sub) : null), right); };
          const draw = () => {
            clear(box);
            const s = T.settings(), ses = T.session();
            const edited = Object.keys((store.get('appData') || {}).tasks?.items || {}).filter((id) => T.isBuiltin(id) && G.types.includes(T.builtinById(id)?.type)).length;
            if (group === 'tod') {
              const n = T.pool({ filter: 'session', type: null, tags: [] }).length;
              const nAll = (lang) => (s.packs[lang] ? T.allItems() : PACKS[lang].items).filter((i) => i.builtin === lang && TOD.includes(i.type) && (s.adult || !T.isAdult(i))).length;
              box.append(
                h('div.tk-set-h', 'Game session'),
                h('div.tk-set-ses', h('div.tk-set-code', ses.id), h('div.tk-set-sub', `Started ${ago(ses.started)} · ${n} item${n === 1 ? '' : 's'} added`)),
                h('button.pill.primary', { type: 'button', onclick: () => { T.newSession(); app.sfx('score'); app.toast(`New session ${T.session().id}`); draw(); } }, 'New game session'),
                h('div.tk-set-h', 'Starter packs'),
                row('English', `${nAll('en')} truths, dares & tasks`, sw(s.packs.en, () => { T.setSettings({ packs: { ...s.packs, en: !s.packs.en } }); draw(); })),
                row('עברית', `${nAll('he')} אמת, חובה ומשימות`, sw(s.packs.he, () => { T.setSettings({ packs: { ...s.packs, he: !s.packs.he } }); draw(); })));
            }
            box.append(
              h('div.tk-set-h', 'Players'),
              row('Your name', s.name || 'Shown on entries added here', h('button.pill', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Your name', value: s.name, placeholder: 'e.g. Mom' }); if (v !== null) { T.setSettings({ name: v }); draw(); } } }, 'Edit')),
              row('18+ mode', s.adult ? 'Adult entries shown in lists and games' : 'Hidden — family friendly', sw(s.adult, async () => {
                if (!s.adult && !(await T.confirmAdult(app))) return;
                T.setSettings(s.adult ? { adult: false, tags: s.tags.filter((t) => t !== '18+') } : { adult: true }); draw();
              })));
            if (group !== 'more') {
              const lc = T.listCounts();
              box.append(h('div.tk-set-h', 'Lists'));
              for (const l of T.lists()) box.append(row(l.text, `${lc[l.id] || 0} entr${(lc[l.id] || 0) === 1 ? 'y' : 'ies'} in all games`, h('div.tk-set-btns',
                h('button.pill', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Rename list', value: l.text }); if (v) { T.renameList(l.id, v); draw(); } } }, 'Rename'),
                h('button.pill.danger', { type: 'button', onclick: () => { T.deleteList(l.id); app.toast(`List “${l.text}” deleted — its entries stay`); draw(); } }, '✕'))));
              box.append(h('button.pill', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'New list', placeholder: 'e.g. Family night', okLabel: 'Create' }); if (v && T.createList(v)) draw(); } }, '+ New list'),
                h('div.tk-set-sub.tk-set-note', 'Lists are your own collections (Family night, Work party…). Put entries on them from an entry’s sheet, and pick lists in the games.'),
                h('div.tk-set-h', `${G.name} — JSON`),
                h('div.tk-set-btns', h('button.pill', { type: 'button', onclick: () => exportJson(G) }, 'Export'), h('button.pill', { type: 'button', onclick: () => importJson(G, draw) }, 'Import')),
                h('div.tk-set-h', 'Built-in entries'),
                h('button.pill', { type: 'button', disabled: !edited || null, onclick: () => { T.resetPacks(G.types); app.toast('Built-in entries restored'); draw(); } }, edited ? `Restore built-ins (${edited} edited or hidden)` : 'Built-ins untouched'));
            }
            box.append(h('div.tk-set-h', 'Phones'),
              h('div.tk-set-sub.tk-set-note', T.bridge.status === 'ok' ? 'Connected to the bridge — players add entries by scanning the QR code (Phones). Everything is kept on the bridge too.' : 'The bridge isn’t reachable, so phones can’t add entries right now (they need the Raspberry Pi, the NAS server or bridge/server.js on this network). You can still add them here.'));
          };
          draw();
          panel.onDestroy = T.events.on('change', () => { if (!panel.closed) draw(); });
        },
      });
    }

    // ------------------------------------------------------------ import / export
    async function exportJson(G) {
      const data = T.exportData(G.types);
      const base = T.bridge.status === 'ok' ? await bridgeBase().catch(() => null) : null;
      const ph = base ? await T.phoneUrl().catch(() => null) : null;
      const url = ph?.url ? `${new URL(ph.url).origin}/api/tasks/export?types=${G.types.join(',')}` : null;
      app.openPanel({
        title: 'Export', className: 'tk-set-panel tk-exp-panel',
        build(body) {
          const save = () => {
            try {
              const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
              const a = h('a', { href: URL.createObjectURL(blob), download: `round-remote-${G.id}.json` });
              document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
              app.toast('Saved');
            } catch (e) { app.toast(e.message || 'Couldn’t save'); }
          };
          body.append(h('div.tk-set',
            h('div.tk-set-sub.tk-set-note', `${data.items.length} added ${G.name.toLowerCase()} entr${data.items.length === 1 ? 'y' : 'ies'} (built-ins aren’t included) — import the file on any display, or from the phone page.`),
            url ? h('div.tk-exp-qr', { html: qrSvg(url, { margin: 2, dark: '#111', light: '#fff' }) }) : null,
            url ? h('div.tk-set-sub', 'Scan to save it on a phone') : null,
            h('button.pill.primary', { type: 'button', disabled: !data.items.length || null, onclick: save }, 'Download here')));
        },
      });
    }
    function importJson(G, after) {
      const done = (data) => {
        try {
          const r = T.importData(data, { types: G.types });
          app.toast(r.added ? `Imported ${r.added}${r.skipped ? ` · ${r.skipped} skipped` : ''}` : 'Nothing new to import');
          after?.(); render();
        } catch (e) { app.toast(e.message || 'Not a Round Remote export'); }
      };
      app.openPanel({
        title: 'Import', className: 'tk-set-panel',
        build(body, panel) {
          const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
            const f = file.files[0]; if (!f) return;
            try { done(JSON.parse(await f.text())); panel.close(); } catch { app.toast('That isn’t a JSON file'); }
          } });
          body.append(h('div.tk-set',
            h('div.tk-set-sub.tk-set-note', `Add ${G.name.toLowerCase()} entries from a Round Remote export (or a list of { type, text … }). On the round display, the phone page’s “Import a JSON file…” is easiest.`),
            file,
            h('button.pill.primary', { type: 'button', onclick: () => file.click() }, 'Choose a file'),
            h('button.pill', { type: 'button', onclick: async () => {
              const u = await app.editText({ title: 'Import from a link', placeholder: 'https://…/file.json', okLabel: 'Import' });
              if (!u) return;
              try { const r = await fetch(u); done(await r.json()); panel.close(); } catch (e) { app.toast(`Couldn’t load it: ${e.message}`); }
            } }, 'From a link')));
        },
      });
    }

    // ------------------------------------------------------------ new items from phones
    const queue = [];
    let popping = false;
    function popNext() {
      if (popping || !queue.length) return;
      popping = true;
      const it = queue.shift();
      clear(pop);
      pop.style.setProperty('--k', TYPE_META[it.type]?.color || '#a78bfa');
      pop.append(h('div.tk-pop-h', h('b', { dir: 'auto' }, it.author || 'Someone'), ` added ${it.type === 'trivia' ? 'a question' : `a ${(TYPE_META[it.type]?.short || TYPE_META[it.type]?.name || 'task').toLowerCase()}`}`),
        h('div.tk-pop-t', { dir: 'auto' }, it.text));
      pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show');
      app.sfx('pop'); app.vibrate(10);
      setTimeout(() => { pop.classList.remove('show'); setTimeout(() => { popping = false; popNext(); }, 350); }, 2600);
    }
    offs.push(T.events.on('fresh', (items) => {
      for (const it of items) queue.push(it);
      highlight = items[items.length - 1]?.id || null;
      popNext();
    }));
    let rT = 0;
    offs.push(T.events.on('change', () => { clearTimeout(rT); rT = setTimeout(render, 30); }));
    offs.push(T.events.on('status', () => renderFilter()));
    offs.push(T.startSync({ every: 3000, passive: true }));

    // ------------------------------------------------------------ knob / keys
    app.onKey((e) => {
      if (document.querySelector('.panel')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); list.scrollBy({ top: list.clientHeight * 0.3, behavior: 'smooth' }); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); list.scrollBy({ top: -list.clientHeight * 0.3, behavior: 'smooth' }); }
      else if (e.key === 'Enter' || e.key === '+') { e.preventDefault(); add(); }
      else if (e.key === 'q') phones();
      else if (e.key === '/') { e.preventDefault(); search(); }
    });

    render();
    return {
      destroy() { clearTimeout(rT); for (const off of offs) off(); },
      back() { if (query) { query = ''; render(); return true; } return false; },
    };
  },
};
