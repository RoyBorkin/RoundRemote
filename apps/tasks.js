// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Tasks Manager: the truths, dares and tasks that Truth or Dare draws from. Built-in starter packs plus
// everything players add — on the display, or from their phones by scanning the QR code (the bridge serves
// the page; see bridge/lib/tasks.js). Sessions: "New game session" starts a fresh one, and the All / This
// session filter (shared with Truth or Dare) picks between everything ever made and what this game added.
// Any entry — built-in, added here or from a phone — can be marked 18+ (the chip on its row, the switch in its
// sheet, or when adding); 18+ entries only show and get drawn while 18+ mode is on.
import { clear } from '../js/ui/dom.js';
import { curve } from '../js/ui/overlay.js';
import { createKeyboard, wantsKeyboard } from '../js/ui/keyboard.js';
import { qrSvg } from './qr.js';
import * as T from './tasks-store.js';
import { PACKS } from './tasks-packs.js';

const { TYPES, TYPE_META, TAG_NAMES } = T;

function ago(ms) {
  if (!ms) return '';
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: m > 60 * 24 * 300 ? 'numeric' : undefined });
}

export default {
  css: './tasks.css',
  create(el, app) {
    const { h, icon } = app;
    let type = app.data('tab', 'truth');
    let page = 'list';               // 'list' | 'qr'
    let highlight = null;            // id of an item to flash
    const offs = [];

    // ------------------------------------------------------------ list page
    const tabs = h('div.tk-tabs', { role: 'tablist' });
    const filterRow = h('div.tk-filter');
    const list = h('div.tk-list.list');
    const reCurve = curve(list);
    const btnQr = h('button.tk-btn', { type: 'button', 'aria-label': 'Add from phones (QR code)', onclick: () => openQr() }, qrGlyph(), h('span', 'Phones'));
    const btnAdd = h('button.tk-add', { type: 'button', 'aria-label': 'Add', onclick: () => add() }, h('i', { html: icon('plus') }));
    const btnSet = h('button.tk-btn', { type: 'button', 'aria-label': 'Settings', onclick: () => openSettings() }, h('i', { html: icon('settings') }), h('span', 'Options'));
    const listPage = h('div.tk-page.tk-listpage', tabs, filterRow, list, h('div.tk-bar', btnQr, btnAdd, btnSet));

    // ------------------------------------------------------------ QR page
    const qrPage = h('div.tk-page.tk-qrpage');
    const pop = h('div.tk-pop', { 'aria-live': 'polite' });
    el.append(listPage, qrPage, pop);
    el.classList.add('tk');

    function renderTabs() {
      clear(tabs);
      const c = T.counts();
      for (const k of TYPES) {
        tabs.append(h(`button.tk-tab${k === type ? '.on' : ''}`, { type: 'button', role: 'tab', '--k': TYPE_META[k].color, 'aria-selected': String(k === type),
          onclick: () => { if (type !== k) { type = k; app.save('tab', k); app.sfx('tick'); render(); list.scrollTop = 0; } } },
          h('span.tk-tab-n', TYPE_META[k].plural), h('span.tk-tab-c', String(c[k]))));
      }
    }
    function renderFilter() {
      clear(filterRow);
      const s = T.settings(), ses = T.session();
      const chip = (val, label) => h(`button.chip${s.filter === val ? '.on' : ''}`, { type: 'button', onclick: () => { T.setSettings({ filter: val }); app.sfx('tap'); list.scrollTop = 0; } }, label);
      filterRow.append(chip('all', 'All'), chip('session', h('span', 'This session ', h('b.tk-code', ses.id))));
      const st = T.bridge.status;
      filterRow.append(h(`span.tk-live.${st}`, { title: st === 'ok' ? 'Phones can add items' : 'Bridge not connected' }));
    }
    function renderList() {
      clear(list);
      const items = T.pool({ type }).slice().sort((a, b) => (b.created || 0) - (a.created || 0));
      if (!items.length) {
        const s = T.settings();
        list.append(h('div.tk-empty',
          h('div.tk-empty-t', s.filter === 'session' ? `No ${TYPE_META[type].plural.toLowerCase()} in this session yet` : `No ${TYPE_META[type].plural.toLowerCase()} yet`),
          h('div.tk-empty-m', 'Tap + to write one, or let players scan the QR code and add theirs.'),
          h('button.pill', { type: 'button', onclick: () => openQr() }, 'Show QR code')));
        reCurve();
        return;
      }
      for (const it of items) {
        const x = T.isAdult(it);
        const meta = [it.author && `by ${it.author}`, it.builtin ? (it.builtin === 'he' ? 'Starter pack · עברית' : 'Starter pack') : ago(it.created),
          ...(it.tags || []).filter((t) => t !== 'family' && !T.isAdult({ tags: [t] })).map((t) => `#${TAG_NAMES[t] || t}`)].filter(Boolean).join(' · ');
        const row = h(`div.tk-row${it.id === highlight ? '.new' : ''}${x ? '.x' : ''}`, { '--k': TYPE_META[it.type].color, dataset: { id: it.id } },
          h('button.tk-row-b', { type: 'button', onclick: () => openItem(it.id) },
            h('div.tk-row-t', { dir: 'auto' }, it.text),
            h('div.tk-row-m', { dir: 'auto' }, meta)),
          h(`button.tk-x18${x ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(x), 'aria-label': '18+ (adults only)', title: x ? '18+ — tap to unmark' : 'Mark as 18+',
            onclick: () => mark18(it.id, !x) }, '18+'));
        list.append(row);
      }
      reCurve();
      if (highlight) {
        const r = list.querySelector(`[data-id="${CSS.escape(highlight)}"]`);
        r?.scrollIntoView({ block: 'center' });
        setTimeout(() => { highlight = null; }, 50);
      }
    }
    function render() { renderTabs(); renderFilter(); if (page === 'list') renderList(); else renderQrCount(); }

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

    // ------------------------------------------------------------ add / edit
    async function add(t = type) {
      const r = await addSheet(t);
      if (!r) return;
      const it = T.addItem({ type: t, text: r.text, tags: r.x18 ? T.adultTags(['family'], true) : ['family'] });
      if (!it) return;
      app.sfx('pop'); app.vibrate(15);
      if (type !== t) { type = t; app.save('tab', t); }
      const hidden = r.x18 && !T.settings().adult;
      highlight = hidden ? null : it.id;
      if (page !== 'list') showPage('list');
      render();
      app.toast(hidden ? `${TYPE_META[t].name} added · ${HIDDEN18}` : `${TYPE_META[t].name} added${r.x18 ? ' (18+)' : ''}`);
    }
    /** The add sheet: the text (on-screen keyboard on touch screens, like editText) plus an 18+ toggle. */
    function addSheet(t) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        app.openPanel({
          title: `New ${TYPE_META[t].name.toLowerCase()}`, className: 'edit-panel kbd-open tk-add-panel',
          onClose: () => finish(null),
          build(body, panel) {
            let x18 = false;
            const input = h('input.edit-input', { type: 'text', placeholder: t === 'truth' ? 'A question to answer honestly…' : t === 'dare' ? 'Dare someone to…' : 'A challenge for everyone…',
              autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', dir: 'auto' });
            const submit = (v = input.value) => { v = String(v).trim(); finish(v ? { text: v, x18 } : null); panel.close(); };
            const tog = h('button.tk-x18.lg', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': '18+ (adults only)',
              onclick: () => { x18 = !x18; tog.classList.toggle('on', x18); tog.setAttribute('aria-checked', String(x18)); app.sfx('tap'); } }, '18+');
            body.append(input, h('div.tk-add-row', tog, h('button.pill.primary', { type: 'button', onclick: () => submit() }, 'Add')));
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
            if (wantsKeyboard()) {
              input.readOnly = true;
              const kb = createKeyboard(input, { onEnter: (v) => submit(v) });
              kb.setEnterIcon('check');
              panel.el.appendChild(kb);
            } else {
              panel.el.classList.remove('kbd-open');
              setTimeout(() => input.focus(), 200);
            }
          },
        });
      });
    }

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
            const s = T.settings();
            const typeChips = h('div.chips', TYPES.map((k) => h(`button.chip${k === it.type ? '.on' : ''}`, { type: 'button', '--k': TYPE_META[k].color,
              onclick: () => { T.updateItem(id, { type: k }); type = k; app.save('tab', k); draw(); } }, TYPE_META[k].name)));
            const tagList = T.TAGS.filter((t) => t !== '18+');  // 18+ has its own switch below
            const x = T.isAdult(it);
            const tagChips = h('div.chips.multi', tagList.map((t) => h(`button.chip${(it.tags || []).includes(t) ? '.on' : ''}`, { type: 'button',
              onclick: () => { const set = new Set(it.tags || []); set.has(t) ? set.delete(t) : set.add(t); T.updateItem(id, { tags: [...set] }); draw(); } }, TAG_NAMES[t])));
            const meta = [it.author && `by ${it.author}`, it.builtin ? 'Starter pack' : it.created && new Date(it.created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
              it.session && `session ${it.session}`].filter(Boolean).join(' · ');
            body.append(
              h('button.tk-item-text', { type: 'button', dir: 'auto', onclick: edit }, it.text),
              h('div.tk-item-meta', { dir: 'auto' }, meta),
              typeChips, tagChips,
              h(`div.tk-item-x18${x ? '.on' : ''}`, h('span.tk-x18.static', '18+'),
                h('div.tk-item-x18-l', h('div', 'Adults only'), h('div.tk-set-sub', x ? (s.adult ? 'Shown — 18+ mode is on' : 'Hidden while 18+ mode is off') : 'Shown to everyone')),
                h(`button.switch${x ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(x), 'aria-label': '18+ (adults only)',
                  onclick: () => { if (mark18(id, !x)) panel.close(); else draw(); } })),
              h('div.tk-item-acts',
                h('button.pill', { type: 'button', onclick: edit }, 'Edit'),
                h('button.pill.danger', { type: 'button', onclick: () => { T.removeItem(id); app.sfx('drop'); app.toast('Deleted'); panel.close(); } }, 'Delete')));
          };
          async function edit() {
            const it = T.getItem(id);
            const v = await app.editText({ title: `Edit ${TYPE_META[it.type].name.toLowerCase()}`, value: it.text });
            if (v) { T.updateItem(id, { text: v }); draw(); }
          }
          draw();
        },
      });
    }

    // ------------------------------------------------------------ settings
    function openSettings() {
      app.openPanel({
        title: 'Options', className: 'tk-set-panel',
        build(body, panel) {
          const box = h('div.tk-set.list');
          body.append(box);
          const sw = (on, fn) => h(`button.switch${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(on), onclick: fn });
          const row = (label, sub, right) => { if (right?.classList?.contains('switch') && !right.hasAttribute('aria-label')) right.setAttribute('aria-label', label); return h('div.tk-set-row', h('div.tk-set-l', h('div', label), sub ? h('div.tk-set-sub', sub) : null), right); };
          const draw = () => {
            clear(box);
            const s = T.settings(), ses = T.session();
            const n = T.pool({ filter: 'session', type: null }).length;
            const nAll = (lang) => (s.packs[lang] ? T.allItems() : PACKS[lang].items).filter((i) => i.builtin === lang && (s.adult || !T.isAdult(i))).length;
            box.append(
              h('div.tk-set-h', 'Game session'),
              h('div.tk-set-ses', h('div.tk-set-code', ses.id), h('div.tk-set-sub', `Started ${ago(ses.started)} · ${n} item${n === 1 ? '' : 's'} added`)),
              h('button.pill.primary', { type: 'button', onclick: () => { T.newSession(); app.sfx('score'); app.toast(`New session ${T.session().id}`); draw(); } }, 'New game session'),
              h('div.tk-set-h', 'Players'),
              row('Your name', s.name || 'Shown on items added here', h('button.pill', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Your name', value: s.name, placeholder: 'e.g. Mom' }); if (v !== null) { T.setSettings({ name: v }); draw(); } } }, 'Edit')),
              row('18+ mode', s.adult ? 'Adult items shown in lists and games' : 'Hidden — family friendly', sw(s.adult, async () => {
                if (!s.adult && !(await T.confirmAdult(app))) return;
                T.setSettings(s.adult ? { adult: false, tags: s.tags.filter((t) => t !== '18+') } : { adult: true }); draw();
              })),
              h('div.tk-set-h', 'Starter packs'),
              row('English', `${nAll('en')} truths, dares & tasks`, sw(s.packs.en, () => { T.setSettings({ packs: { ...s.packs, en: !s.packs.en } }); draw(); })),
              row('עברית', `${nAll('he')} אמת, חובה ומשימות`, sw(s.packs.he, () => { T.setSettings({ packs: { ...s.packs, he: !s.packs.he } }); draw(); })),
              h('button.pill', { type: 'button', onclick: () => { T.resetPacks(); app.toast('Starter packs restored'); draw(); } }, 'Restore starter packs'),
              h('div.tk-set-h', 'Phones'),
              h('div.tk-set-sub.tk-set-note', T.bridge.status === 'ok' ? 'Connected to the bridge — players can add items by scanning the QR code. Everything is kept forever.' : 'The bridge isn’t reachable, so phones can’t add items right now. Start bridge/server.js on this network. You can still add items here.'),
            );
          };
          draw();
          panel.onDestroy = T.events.on('change', () => { if (!panel.closed) draw(); });
        },
      });
    }

    // ------------------------------------------------------------ QR page
    let qrCount = null, qrToken = 0;
    function renderQrCount() {
      if (!qrCount) return;
      const n = T.pool({ filter: 'session', type: null, adult: true, tags: [] }).length;
      qrCount.textContent = `${n} added this session`;
    }
    async function openQr() {
      showPage('qr');
      const my = ++qrToken;
      clear(qrPage);
      qrPage.append(h('div.tk-qr-wait', h('div.spin'), h('div', 'Finding the bridge…')));
      const r = await T.phoneUrl().catch(() => ({ url: null, reason: 'nobridge' }));
      if (my !== qrToken || page !== 'qr') return;
      clear(qrPage);
      const ses = T.session();
      qrCount = h('span.tk-qr-count');
      if (!r.url) {
        qrPage.append(h('div.tk-qr-off',
          h('div.tk-qr-off-ic', qrGlyph()),
          h('div.tk-qr-off-t', 'Phones can’t connect yet'),
          h('div.tk-qr-off-m', r.reason === 'noip' ? 'The bridge has no network address phones can reach. Set "tasks.publicUrl" in bridge/config.json.'
            : r.reason === 'old' ? 'This bridge is too old for the Tasks page — update bridge/server.js.'
              : 'Start the bridge (bridge/server.js) on this network to let players add truths and dares from their phones. Until then, add them here.'),
          h('div.tk-qr-off-b',
            h('button.pill', { type: 'button', onclick: () => openQr() }, 'Try again'),
            h('button.pill.primary', { type: 'button', onclick: () => add() }, 'Add here'))));
        return;
      }
      const code = h('div.tk-qr-code', { html: qrSvg(r.url, { margin: 3, dark: '#111', light: '#fff' }), dataset: { url: r.url } });
      qrPage.append(
        h('div.tk-qr-h', 'Scan to add yours'),
        code,
        h('div.tk-qr-ses', 'Session ', h('b.tk-code', ses.id), ' · ', qrCount),
        h('div.tk-qr-url', r.url.replace(/^https?:\/\//, '')),
        h('button.pill.tk-qr-new', { type: 'button', onclick: () => { T.newSession(); app.sfx('score'); openQr(); } }, 'New session'));
      renderQrCount();
    }
    function showPage(p) {
      page = p;
      el.dataset.page = p;
      app.setTitle(p === 'qr' ? 'Add from phones' : null);
      if (p === 'list') { qrCount = null; render(); }
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
      pop.append(h('div.tk-pop-h', h('b', { dir: 'auto' }, it.author || 'Someone'), ` added a ${TYPE_META[it.type]?.name.toLowerCase() || 'task'}`),
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
    offs.push(T.events.on('change', () => render()));
    offs.push(T.events.on('status', () => renderFilter()));
    offs.push(T.startSync({ every: 3000, passive: true }));  // the QR page looks for the bridge actively

    // ------------------------------------------------------------ knob / keys
    app.onKey((e) => {
      if (document.querySelector('.panel')) return;
      if (page === 'list') {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); list.scrollBy({ top: list.clientHeight * 0.3, behavior: 'smooth' }); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); list.scrollBy({ top: -list.clientHeight * 0.3, behavior: 'smooth' }); }
        else if (e.key === 'Enter' || e.key === '+') { e.preventDefault(); add(); }
        else if (e.key === 'q') openQr();
      }
    });

    showPage('list');
    return {
      destroy() { for (const off of offs) off(); },
      back() { if (page !== 'list') { qrToken++; showPage('list'); return true; } return false; },
    };

    function qrGlyph() {
      return h('i', { html: '<svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M3 3h8v8H3zm2 2v4h4V5zM13 3h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zM13 13h3v3h-3zm5 0h3v3h-3zm-5 5h3v3h-3zm5 0h3v3h-3zM6 6h2v2H6zm10 0h2v2h-2zM6 16h2v2H6z"/></svg>' });
    }
  },
};
