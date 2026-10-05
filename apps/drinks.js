// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Drinking Games: a ring of six party games — Kings Cup, Never Have I Ever, Most Likely To, Power Hour,
// Ride the Bus and Party Cards. One players list is shared by every game; an 18+ notice shows the first time;
// a gentle water-break reminder runs while the app is open. Each game is a page module (apps/drinks-*.js).
import { h, clear } from '../js/ui/dom.js';
import { openPanel } from '../js/ui/overlay.js';
import { store } from '../js/core/store.js';
import { notify, stopAlert } from '../js/core/alerts.js';
import { ringMenu, IC, svgIcon, COLORS, uid, seg, switchRow } from './drinks-ui.js';

export const GAMES = [
  { id: 'kings', name: 'Kings Cup', short: 'Kings', color: '#eab308', icon: IC.crown, file: './drinks-kings.js', blurb: 'Ring of Fire — draw a card, follow its rule. Beware the fourth King.' },
  { id: 'never', name: 'Never Have I Ever', short: 'Never', color: '#ec4899', icon: IC.never, file: './drinks-never.js', blurb: 'Hear a confession prompt — everyone who has done it takes a sip.' },
  { id: 'likely', name: 'Most Likely To', short: 'Likely', color: '#8b5cf6', icon: IC.likely, file: './drinks-likely.js', blurb: 'Count down, everyone points — the most-pointed-at player sips.' },
  { id: 'power', name: 'Power Hour', short: 'Power', color: '#10b981', icon: IC.power, file: './drinks-power.js', blurb: 'A new song every minute and a sip at every change, with your music.' },
  { id: 'bus', name: 'Ride the Bus', short: 'Bus', color: '#3b82f6', icon: IC.bus, file: './drinks-bus.js', blurb: 'Red or black, higher or lower, inside or outside, suit — guess right!' },
  { id: 'party', name: 'Party Cards', short: 'Party', color: '#ef4444', icon: IC.party, file: './drinks-party.js', blurb: 'A stream of challenges, mini-games, votes and silly rules naming your players.' },
];

const DEF_SETTINGS = { lang: 'en', spicy: false, waterMin: 20, sound: true };
const PACE = 15;          // every this many sips, a friendly “water?” nudge

export default {
  css: './drinks.css',
  create(root, app) {
    const host = h('div.dk-app');
    root.append(host);
    const stack = [];
    let menu = null, alive = true, loading = false, loadSeq = 0, gateEl = null;

    // ---------------- settings & players
    const settings = { ...DEF_SETTINGS, ...app.data('settings', {}) };
    const saveSettings = () => app.save('settings', settings);
    let players = app.data('players', null);
    if (!Array.isArray(players) || !players.length) {
      const roster = (store.get('appData') || {}).boardgames?.roster || [];
      players = Array.from({ length: Math.max(3, Math.min(6, roster.length || 4)) }, (_, i) => ({ id: uid(), name: roster[i] || `Player ${i + 1}`, color: COLORS[i % COLORS.length] }));
    }
    const savePlayers = () => app.save('players', players.map(({ id, name, color }) => ({ id, name, color })));
    savePlayers();
    const playerSubs = new Set();
    const playersChanged = () => { savePlayers(); for (const f of playerSubs) { try { f(players); } catch (e) { console.error(e); } } refreshHub(); };

    // sips this session (kept for 8 hours, so a reload mid-party doesn't lose them)
    let session = app.data('session', null);
    if (!session || Date.now() - (session.at || 0) > 8 * 3600e3) session = { at: Date.now(), sips: {} };
    const saveSession = () => app.save('session', session);

    const ctx = {
      app, host, settings, saveSettings,
      get players() { return players; },
      onPlayers(fn) { playerSubs.add(fn); return () => playerSubs.delete(fn); },
      editPlayers: () => editPlayers(),
      sips: (p) => session.sips[p.id] || 0,
      addSips(p, n = 1) {
        const before = session.sips[p.id] || 0;
        const now = Math.max(0, before + n);
        session.sips[p.id] = now; saveSession();
        if (n > 0 && Math.floor(now / PACE) > Math.floor(before / PACE)) app.toast(`${p.name}: ${now} sips so far — time for some water? 💧`, { ms: 4200 });
      },
      sfx: (name, o) => { if (settings.sound) app.sfx(name, o); },
      setTitle: (t) => { const top = stack[stack.length - 1]; if (top) top.title = t; app.setTitle(t); },
      hideTitle: (v = true) => { const top = stack[stack.length - 1]; if (top) top.hideTitle = v; app.hideTitle(v); },
      pop: () => pop(),
      words: null,
    };

    // ---------------- home: the ring
    const playersBtn = h('button.dk-hub-btn', { type: 'button', onclick: (e) => { e.stopPropagation(); editPlayers(); } });
    const setBtn = h('button.dk-hub-btn.icon', { type: 'button', 'aria-label': 'Settings', html: svgIcon(IC.tune), onclick: (e) => { e.stopPropagation(); openSettings(); } });
    const extra = h('div.dk-hub-extra', playersBtn, setBtn);
    function refreshHub() { playersBtn.innerHTML = `${svgIcon(IC.people)}<span>${players.length} players</span>`; }

    function showMenu() {
      const page = h('div.dk-page.dk-home');
      menu = ringMenu({ items: GAMES, sel: Math.max(0, GAMES.findIndex((g) => g.id === app.data('lastGame'))), onOpen: (g) => openGame(g), extra });
      page.append(menu.el);
      host.append(page);
      refreshHub();
      app.setTitle('Drinking Games');
    }

    async function openGame(g) {
      app.save('lastGame', g.id);
      ctx.sfx('tap');
      await push({ title: g.name, file: g.file, color: g.color });
    }

    async function push({ file, title, color, opts }) {
      if (loading) return;
      loading = true;
      const my = ++loadSeq;
      try {
        const fn = (await import(file)).mount;
        if (!alive || my !== loadSeq) return;   // Back was pressed while it loaded → don't open it
        const el = h('div.dk-page', color ? { '--pc': color } : null);
        const entry = { el, inst: null, title: title || '', hideTitle: false };
        stack.push(entry);
        for (const p of host.children) if (p.classList.contains('dk-page')) p.classList.add('dk-hidden');
        host.append(el);
        app.setTitle(entry.title); app.hideTitle(false);
        entry.inst = fn(el, ctx, opts) || {};
      } catch (err) {
        console.error('[drinks]', err);
        app.toast(`Couldn’t open: ${err.message || err}`);
      } finally { if (my === loadSeq) loading = false; }
    }

    function pop() {
      const top = stack.pop();
      if (!top) return false;
      try { top.inst?.destroy?.(); } catch (e) { console.error(e); }
      top.el.classList.add('dk-leave');
      setTimeout(() => top.el.remove(), 220);
      const prev = stack[stack.length - 1];
      (prev ? prev.el : host.querySelector('.dk-home'))?.classList.remove('dk-hidden');
      app.setTitle(prev ? prev.title : 'Drinking Games');
      app.hideTitle(prev ? prev.hideTitle : false);
      return true;
    }

    // ---------------- players editor
    function editPlayers() {
      openPanel({
        title: 'Players', className: 'dk-players',
        build(body) {
          const list = h('div.list.dk-pl-list');
          const addBtn = h('button.pill.small.dk-pl-add', { type: 'button', onclick: async () => {
            if (players.length >= 12) return;
            const name = await app.editText({ title: 'New player', value: '', placeholder: 'Name' });
            if (!name) return;
            const used = new Set(players.map((p) => p.color));
            players.push({ id: uid(), name: name.slice(0, 16), color: COLORS.find((x) => !used.has(x)) || COLORS[players.length % COLORS.length] });
            changed();
            list.lastElementChild?.scrollIntoView({ block: 'nearest' });
          } }, '+ Add player');
          const render = () => {
            clear(list);
            players.forEach((p, i) => {
              const dot = h('button.dk-pl-color', { type: 'button', 'aria-label': 'Colour', style: { background: p.color }, onclick: () => {
                p.color = COLORS[(COLORS.indexOf(p.color) + 1) % COLORS.length]; changed();
              } });
              const name = h('button.dk-pl-name', { type: 'button', onclick: async () => {
                const v = await app.editText({ title: 'Name', value: p.name });
                if (v) { p.name = v.slice(0, 16); changed(); }
              } }, h('bdi', p.name), h('span.dk-pl-sips', ctx.sips(p) ? `${ctx.sips(p)} sips` : ''));
              const del = h('button.dk-pl-x', { type: 'button', 'aria-label': `Remove ${p.name}`, disabled: players.length <= 2, onclick: () => { players.splice(i, 1); changed(); } }, '×');
              list.append(h('div.dk-pl-row', dot, name, del));
            });
            addBtn.disabled = players.length >= 12;
          };
          const changed = () => { render(); playersChanged(); };
          body.append(list, h('div.dk-pl-foot', addBtn, h('button.pill.small.dk-pl-reset', { type: 'button', onclick: async () => {
            session = { at: Date.now(), sips: {} }; saveSession(); render(); playersChanged(); app.toast('Sip counts reset');
          } }, 'Reset sips')));
          render();
        },
      });
    }

    // ---------------- settings
    function openSettings() {
      openPanel({
        title: 'Settings', className: 'dk-settings',
        build(body) {
          const sc = h('div.dk-set');
          sc.append(
            h('div.dk-sect', 'Prompts language'),
            seg([{ v: 'en', label: 'English' }, { v: 'he', label: 'עברית' }], settings.lang, (v) => { settings.lang = v; saveSettings(); }),
            switchRow('Spicy cards', settings.spicy, (v) => { settings.spicy = v; saveSettings(); }, 'Flirty and cheeky prompts, mixed in'),
            h('div.dk-sect', 'Water break reminder'),
            seg([{ v: 0, label: 'Off' }, { v: 15, label: '15m' }, { v: 20, label: '20m' }, { v: 30, label: '30m' }, { v: 45, label: '45m' }], settings.waterMin, (v) => { settings.waterMin = v; saveSettings(); lastBreak = Date.now(); }),
            switchRow('Sounds', settings.sound, (v) => { settings.sound = v; saveSettings(); }),
            h('div.dk-note', 'Sips, not shots. Water counts. Skip any card. Never drink and drive.'),
            h('button.pill.small.dk-set-gate', { type: 'button', onclick: () => { app.save('adultOk', false); app.toast('The 18+ notice will show next time'); } }, 'Show the 18+ notice again'),
          );
          body.append(sc);
        },
      });
    }

    // ---------------- 18+ notice (first time only)
    function showGate() {
      gateEl = h('div.dk-gate',
        h('div.dk-gate-badge', '18+'),
        h('div.dk-gate-t', 'Adults only'),
        h('div.dk-gate-m', 'Everyone playing is 18+ — any drink works, water counts; know your limits.'),
        h('div.dk-gate-s', 'Sips, not shots. Skip anything. Never drink and drive.'),
        h('button.pill.primary.dk-gate-ok', { type: 'button', onclick: () => { app.save('adultOk', true); ctx.sfx('pop'); gateEl.classList.add('out'); setTimeout(() => { gateEl?.remove(); gateEl = null; }, 300); } }, 'We’re all 18+'),
        h('button.pill.small.dk-gate-no', { type: 'button', onclick: () => app.go('apps') }, 'Not now'));
      host.append(gateEl);
    }

    // ---------------- water break
    let lastBreak = Date.now(), waterEl = null, waterAlert = null;
    const waterMs = () => (window.__drinksWaterMs || settings.waterMin * 60e3);
    app.every(1000, () => {
      if (!settings.waterMin && !window.__drinksWaterMs) return;
      if (waterEl || gateEl) return;
      if (Date.now() - lastBreak >= waterMs()) waterBreak();
    });
    async function waterBreak() {
      ctx.sfx('perfect');
      app.vibrate(30);
      waterEl = h('div.dk-water',
        h('div.dk-water-drop', { html: svgIcon(IC.drop) }),
        h('div.dk-water-t', 'Water break'),
        h('div.dk-water-m', 'Everyone have a glass of water — maybe grab a snack too. The game will wait.'),
        h('button.pill.primary', { type: 'button', onclick: () => endWater() }, 'Done 💧'));
      host.append(waterEl);
      try { waterAlert = await notify({ title: 'Water break', message: 'Time for everyone to have a glass of water.', level: 'info', source: 'drinks' }); } catch {}
    }
    function endWater() {
      try { stopAlert(waterAlert); } catch {}
      waterAlert = null;
      lastBreak = Date.now();
      waterEl?.classList.add('out');
      const w = waterEl; waterEl = null;
      setTimeout(() => w?.remove(), 300);
    }

    app.onKey((e) => {
      if (document.querySelector('.panel.in')) return;
      if (gateEl) { if (e.key === 'Enter') { gateEl.querySelector('.dk-gate-ok').click(); e.preventDefault(); } return; }
      if (waterEl) { if (e.key === 'Enter' || e.key === ' ') { endWater(); e.preventDefault(); } return; }
      const top = stack[stack.length - 1];
      const handled = top ? top.inst?.key?.(e) : menu?.key(e);
      if (handled) e.preventDefault();
    });

    showMenu();
    if (!app.data('adultOk', false)) showGate();
    // load the game pages in the background so opening one is instant (a slow first load used to swallow Back)
    const warm = setTimeout(() => { if (alive) for (const g of GAMES) import(g.file).catch(() => {}); }, 1500);

    return {
      back() {
        if (loading) { loadSeq++; loading = false; return true; }   // cancel the game that's still loading
        if (waterEl) { endWater(); return true; }
        const top = stack[stack.length - 1];
        if (!top) return false;
        if (top.inst?.back?.()) return true;
        pop();
        return true;
      },
      destroy() {
        alive = false;
        clearTimeout(warm);
        try { stopAlert(waterAlert); } catch {}
        while (stack.length) { const p = stack.pop(); try { p.inst?.destroy?.(); } catch {} }
        clear(host);
      },
    };
  },
};
