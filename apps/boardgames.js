// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games Companion: a ring of tools — Dice, Coin, Scores, Games (companions for favourite games) and Rules.
// Every tool is a sub-page (its own module, loaded when opened); Back returns to the ring.
import { h, clear } from '../js/ui/dom.js';
import { ringMenu, IC } from './bg-ui.js';

export const TOOLS = [
  { id: 'dice', name: 'Dice', color: '#ef4444', icon: IC.dice, blurb: 'Roll up to 12 dice — d4 to d20 and d100, hold and re-roll, battles and duels.', file: './bg-dice.js' },
  { id: 'coin', name: 'Coin', color: '#f59e0b', icon: IC.coin, blurb: 'Flip a coin. Streaks, stats and best-of-N series.', file: './bg-coin.js' },
  { id: 'scores', name: 'Scores', color: '#22c55e', icon: IC.scores, blurb: 'Score keeper with rounds, undo, targets and saved games.', file: './bg-scores.js' },
  { id: 'games', name: 'Games', color: '#3b82f6', icon: IC.meeple, blurb: 'Helpers for Ticket to Ride, Catan, Monopoly, Taki, Twister, Clue and more.', file: './bg-games.js' },
  { id: 'rules', name: 'Rules', color: '#a855f7', icon: IC.book, blurb: 'Quick rules for 40 board and card games, in plain words.', file: './bg-rulesview.js' },
];

export default {
  css: './boardgames.css',
  create(root, app) {
    const host = h('div.bg-app');
    root.append(host);
    const stack = [];          // open pages: { el, inst, title, hideTitle }
    let menu = null, alive = true, loading = false, loadSeq = 0;

    function showMenu() {
      const page = h('div.bg-page.bg-home');
      menu = ringMenu({ items: TOOLS, sel: Math.max(0, TOOLS.findIndex((t) => t.id === app.data('lastTool'))), labels: true, radius: 34, size: 17.5, spread: 36,
        onOpen: (t) => openTool(t) });
      page.append(menu.el);
      host.append(page);
      app.setTitle('Board Games');
    }

    // A "page" module exports mount(el, ctx) → { destroy?, back?() → handled, key?(e) → handled }
    const ctx = {
      app, root: host,
      data: app.data, save: app.save,
      push: (opts) => push(opts),
      pop: () => pop(),
      setTitle: (t) => { const top = stack[stack.length - 1]; if (top) top.title = t; app.setTitle(t); },
      hideTitle: (v = true) => { const top = stack[stack.length - 1]; if (top) top.hideTitle = v; app.hideTitle(v); },
      openTool: (id, opts) => { const t = TOOLS.find((x) => x.id === id); if (t) openTool(t, opts); },
    };

    async function openTool(t, opts) {
      app.save('lastTool', t.id);
      app.sfx('tap');
      await push({ title: t.name, file: t.file, color: t.color, opts });
    }

    /** Open a page from a module: { file, title, color, opts } or { mount, title }. */
    async function push({ file, mount, title, color, opts }) {
      if (loading) return;
      loading = true;
      const my = ++loadSeq;
      try {
        const fn = mount || (await import(file)).mount;
        if (!alive || my !== loadSeq) return;   // Back was pressed while it loaded → don't open it
        const el = h('div.bg-page', color ? { '--pc': color } : null);
        const entry = { el, inst: null, title: title || '', hideTitle: false };
        stack.push(entry);
        for (const p of host.children) p.classList.add('bg-hidden');
        host.append(el);
        app.setTitle(entry.title); app.hideTitle(false);
        entry.inst = fn(el, ctx, opts) || {};
      } catch (err) {
        console.error('[boardgames]', err);
        app.toast(`Couldn’t open: ${err.message || err}`);
      } finally { if (my === loadSeq) loading = false; }
    }

    function pop() {
      const top = stack.pop();
      if (!top) return false;
      try { top.inst?.destroy?.(); } catch (e) { console.error(e); }
      top.el.classList.add('bg-leave');
      setTimeout(() => top.el.remove(), 220);
      const prev = stack[stack.length - 1];
      const prevEl = prev ? prev.el : host.querySelector('.bg-home');
      prevEl?.classList.remove('bg-hidden');
      app.setTitle(prev ? prev.title : 'Board Games');
      app.hideTitle(prev ? prev.hideTitle : false);
      try { prev?.inst?.resume?.(); } catch {}
      return true;
    }

    app.onKey((e) => {
      const top = stack[stack.length - 1];
      if (document.querySelector('.panel.in')) return;      // a panel is open: leave keys to it
      const handled = top ? top.inst?.key?.(e) : menu?.key(e);
      if (handled) e.preventDefault();
    });

    showMenu();
    return {
      back() {
        if (loading) { loadSeq++; loading = false; return true; }   // a page is still opening: cancel it
        const top = stack[stack.length - 1];
        if (!top) return false;
        if (top.inst?.back?.()) return true;
        pop();
        return true;
      },
      destroy() {
        alive = false;
        while (stack.length) { const p = stack.pop(); try { p.inst?.destroy?.(); } catch {} }
        clear(host);
      },
    };
  },
};
