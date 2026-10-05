// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Scores: players with colours, +/− by tapping (step 1/5/10) or typing, rounds with a history table,
// totals and leader, undo, target score with a winner celebration, "lowest wins", several saved games.
import { h, clear } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { openPanel, curve } from '../js/ui/overlay.js';
import { seg, numPad, editPlayers, celebrate, confirm, svgIcon, IC, roster, uid } from './bg-ui.js';

const polar = (deg, r) => { const a = (deg * Math.PI) / 180; return { left: `${50 + r * Math.sin(a)}%`, top: `${50 - r * Math.cos(a)}%` }; };

export function newGame(app, name, players) {
  return { id: uid(), name, players: players || roster(app, 3), rounds: [], cur: {}, target: 0, low: false, step: 1, created: Date.now(), updated: Date.now(), won: null };
}
export const totalOf = (g, pid) => g.rounds.reduce((a, r) => a + (r[pid] || 0), 0) + (g.cur[pid] || 0);

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-scores');
  const D = app.data('scores', null) || { games: [], cur: null };
  let game = D.games.find((g) => g.id === D.cur) || D.games[0];
  if (!game) { game = newGame(app, 'Game 1'); D.games.unshift(game); D.cur = game.id; }
  let undo = [], sel = 0, saveT = 0, stopCel = null;
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => app.save('scores', D), 250); };
  const snap = () => { undo.push(JSON.stringify(game)); if (undo.length > 80) undo.shift(); };

  const stepSeg = seg([{ v: 1, label: '±1' }, { v: 5, label: '±5' }, { v: 10, label: '±10' }], game.step, (v) => { game.step = v; persist(); }, 'bg-sc-step');
  const info = h('div.bg-sc-info');
  const list = h('div.bg-sc-list');
  const nextBtn = h('button.pill.primary.bg-sc-next', { type: 'button', onclick: () => nextRound() }, 'Next round');
  const ib = (ang, name, label, fn, html) => h('button.ibtn.bg-ibtn.bg-sc-ib', { type: 'button', 'aria-label': label, title: label, style: polar(ang, 40), html: html || icon(name), onclick: (e) => { e.stopPropagation(); fn(); } });
  const undoBtn = ib(220, '', 'Undo', () => doUndo(), svgIcon(IC.undo));
  el.append(stepSeg, info, list, nextBtn, undoBtn,
    ib(244, '', 'Saved games', () => showGames(), svgIcon(IC.list)),
    ib(140, '', 'Rounds', () => showRounds(), svgIcon(IC.table)),
    ib(116, '', 'Game settings', () => showSettings(), svgIcon(IC.tune)));

  function leaderIds() {
    const t = game.players.map((p) => totalOf(game, p.id));
    if (!t.some((x) => x !== 0)) return [];
    const best = game.low ? Math.min(...t) : Math.max(...t);
    return game.players.filter((p, i) => t[i] === best).map((p) => p.id);
  }
  function render() {
    ctx.setTitle(game.name);
    stepSeg.set(game.step);
    const r = game.rounds.length + 1;
    info.textContent = `Round ${r}${game.target ? ` · ${game.low ? 'game ends at' : 'first to'} ${game.target}` : ''}${game.low ? ' · lowest wins' : ''}`;
    const leaders = leaderIds();
    clear(list);
    sel = Math.min(sel, game.players.length - 1);
    game.players.forEach((p, i) => {
      const tot = totalOf(game, p.id), now = game.cur[p.id] || 0;
      const lead = leaders.includes(p.id) && leaders.length < game.players.length;
      const row = h(`div.bg-sc-row${lead ? '.lead' : ''}${i === sel ? '.sel' : ''}`, { '--c': p.color, dataset: { pid: p.id } },
        h('button.bg-sc-pm', { type: 'button', 'aria-label': `Minus ${game.step}`, onclick: () => add(p, -game.step) }, '−'),
        h('button.bg-sc-mid', { type: 'button', onclick: () => typeFor(p) },
          h('span.bg-sc-name', lead ? h('i', { html: svgIcon(IC.crown) }) : h('i.dot'), h('span', p.name)),
          h('span.bg-sc-now', now ? `${now > 0 ? '+' : '−'}${Math.abs(now)} this round` : game.target && !game.low ? `${Math.max(0, game.target - tot)} to go` : ' ')),
        h('span.bg-sc-tot', String(tot)),
        h('button.bg-sc-pm', { type: 'button', 'aria-label': `Plus ${game.step}`, onclick: () => add(p, game.step) }, '+'));
      list.append(row);
    });
    undoBtn.disabled = !undo.length;
  }
  function changed() { game.updated = Date.now(); persist(); render(); checkWin(false); }
  function add(p, d) {
    snap();
    game.cur[p.id] = (game.cur[p.id] || 0) + d;
    sel = game.players.indexOf(p);
    app.sfx(d > 0 ? 'tick' : 'click', { pitch: d > 0 ? 1.2 : 0.8 });
    changed();
    const row = list.querySelector(`[data-pid="${p.id}"] .bg-sc-tot`);
    row?.classList.add('bump'); setTimeout(() => row?.classList.remove('bump'), 220);
  }
  async function typeFor(p) {
    sel = game.players.indexOf(p); render();
    const v = await numPad({ title: p.name, value: 0, sign: 1, hint: `Points to add this round (total ${totalOf(game, p.id)})` });
    if (v === null || v === 0) return;
    snap(); game.cur[p.id] = (game.cur[p.id] || 0) + v; app.sfx('tap'); changed();
  }
  function nextRound() {
    snap();
    const r = {}; for (const p of game.players) r[p.id] = game.cur[p.id] || 0;
    game.rounds.push(r); game.cur = {};
    app.sfx('score');
    changed();
    checkWin(true);
    list.classList.remove('flash'); void list.offsetWidth; list.classList.add('flash');
  }
  function doUndo() {
    const s = undo.pop(); if (!s) return;
    const g = JSON.parse(s); Object.assign(game, g);
    app.sfx('drop'); persist(); render();
  }
  function checkWin(roundEnd) {
    if (!game.target) return;
    const t = game.players.map((p) => ({ p, t: totalOf(game, p.id) }));
    const reached = t.some((x) => x.t >= game.target);
    if (!reached) { game.won = null; return; }
    if (game.won) return;
    if (game.low && !roundEnd) return;
    const w = t.reduce((a, b) => ((game.low ? b.t < a.t : b.t > a.t) ? b : a));
    game.won = w.p.id; persist();
    app.sfx('win');
    stopCel = celebrate(el, `${w.p.name} wins!`, w.p.color, `${w.t} points · ${game.rounds.length + (game.low ? 0 : 1)} rounds`);
  }

  function showRounds() {
    openPanel({
      title: 'Rounds', className: 'bg-rounds',
      build(body, panel) {
        const P = game.players;
        const cols = `5.4cqmin repeat(${P.length}, 1fr)`;
        const head = h('div.bg-rt-row.head', { style: { gridTemplateColumns: cols } }, h('span', '#'), P.map((p) => h('span.bg-rt-h', { '--c': p.color }, p.name.replace(/^player\s*/i, 'P').slice(0, 7))));
        const scroller = h('div.bg-rt-body');
        const cell = (ri, p, v, isCur) => h(`button.bg-rt-c${v < 0 ? '.neg' : ''}`, { type: 'button', onclick: async () => {
          const nv = await numPad({ title: `${p.name} · ${isCur ? 'this round' : `round ${ri + 1}`}`, value: v, hint: 'Set this round’s points' });
          if (nv === null) return;
          snap();
          if (isCur) game.cur[p.id] = nv; else game.rounds[ri][p.id] = nv;
          changed(); panel.close(); showRounds();
        } }, String(v));
        game.rounds.forEach((r, ri) => scroller.append(h('div.bg-rt-row', { style: { gridTemplateColumns: cols } }, h('span.bg-rt-n', String(ri + 1)), P.map((p) => cell(ri, p, r[p.id] || 0, false)))));
        scroller.append(h('div.bg-rt-row.cur', { style: { gridTemplateColumns: cols } }, h('span.bg-rt-n', '▸'), P.map((p) => cell(-1, p, game.cur[p.id] || 0, true))));
        const tot = h('div.bg-rt-row.tot', { style: { gridTemplateColumns: cols } }, h('span', 'Σ'), P.map((p) => h('span', String(totalOf(game, p.id)))));
        body.append(head, scroller, tot, h('div.bg-note', 'Tap a number to correct it'));
        requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
      },
    });
  }
  function showSettings() {
    openPanel({
      title: 'Game settings', className: 'bg-sc-set',
      build(body, panel) {
        const nameBtn = h('button.bg-row-opt', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Game name', value: game.name }); if (v) { game.name = v.slice(0, 24); changed(); nameBtn.lastChild.textContent = game.name; } } }, h('span', 'Name'), h('b', game.name));
        const tgtBtn = h('button.bg-row-opt', { type: 'button', onclick: async () => { const v = await numPad({ title: 'Target score', value: game.target, allowNeg: false, hint: '0 = no target' }); if (v !== null) { game.target = v; game.won = null; changed(); tgtBtn.lastChild.textContent = v || 'none'; } } }, h('span', 'Target score'), h('b', game.target || 'none'));
        const lowSw = h('span.switch'); lowSw.classList.toggle('on', game.low);
        const lowBtn = h('button.bg-row-opt', { type: 'button', onclick: () => { game.low = !game.low; game.won = null; lowSw.classList.toggle('on', game.low); changed(); } }, h('span', 'Lowest score wins'), lowSw);
        const plBtn = h('button.bg-row-opt', { type: 'button', onclick: () => { panel.close(); editPlayers(app, { players: game.players, min: 1, max: 10, onChange: () => changed() }); } }, h('span', 'Players'), h('b', `${game.players.length} ›`));
        const restart = h('button.pill.small', { type: 'button', onclick: async () => { panel.close(); if (await confirm('Restart', 'Clear all scores and keep the players?', 'Restart')) { snap(); game.rounds = []; game.cur = {}; game.won = null; changed(); } } }, 'Restart');
        const del = h('button.pill.small.danger', { type: 'button', onclick: async () => {
          panel.close();
          if (!(await confirm('Delete game', `Delete “${game.name}” and its scores?`, 'Delete'))) return;
          D.games = D.games.filter((g) => g !== game);
          if (!D.games.length) D.games.push(newGame(app, 'Game 1'));
          game = D.games[0]; D.cur = game.id; undo = []; persist(); render();
        } }, 'Delete');
        body.append(nameBtn, tgtBtn, lowBtn, plBtn,
          h('div.bg-note', 'Hearts, golf & Yaniv: lowest wins — the game ends when someone reaches the target.'),
          h('div.bg-sc-btns', restart, del));
      },
    });
  }
  function showGames() {
    openPanel({
      title: 'Saved games', className: 'bg-sc-games',
      build(body, panel) {
        const lst = h('div.list');
        for (const g of D.games) {
          const t = g.players.map((p) => totalOf(g, p.id));
          const best = g.players.length ? (g.low ? Math.min(...t) : Math.max(...t)) : 0;
          const lead = g.players[t.indexOf(best)];
          const d = new Date(g.updated || g.created);
          lst.append(h(`button.row${g === game ? '.active' : ''}`, { type: 'button', onclick: () => { game = g; D.cur = g.id; undo = []; persist(); render(); panel.close(); } },
            h('div.row-art.placeholder', { '--c': lead?.color || 'var(--accent)' }, String(g.rounds.length)),
            h('div.row-text', h('div.row-title', g.name), h('div.row-sub', `${g.players.map((p) => p.name).join(', ')} · ${d.toLocaleDateString()}${lead && best ? ` · ${lead.name} ${best}` : ''}`))));
        }
        const add = h('button.pill.small.primary', { type: 'button', onclick: () => {
          const prev = game;
          const g = newGame(app, `Game ${D.games.length + 1}`, prev.players.map((p) => ({ ...p, id: uid() })));
          g.target = prev.target; g.low = prev.low; g.step = prev.step;
          D.games.unshift(g); game = g; D.cur = g.id; undo = []; persist(); render(); panel.close();
          app.toast('New game — same players. Edit them in settings.');
        } }, '+ New game');
        body.append(lst, add);
        curve(lst);
      },
    });
  }

  render();
  return {
    key(e) {
      const p = game.players[sel];
      if (e.key === 'ArrowDown') { sel = (sel + 1) % game.players.length; render(); return true; }
      if (e.key === 'ArrowUp') { sel = (sel - 1 + game.players.length) % game.players.length; render(); return true; }
      if (e.key === 'ArrowRight' && p) { add(p, game.step); return true; }
      if (e.key === 'ArrowLeft' && p) { add(p, -game.step); return true; }
      if (e.key === 'Enter' && p) { typeFor(p); return true; }
      if (e.key === 'n') { nextRound(); return true; }
      if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'u') { doUndo(); return true; }
      return false;
    },
    destroy() { clearTimeout(saveT); app.save('scores', D); stopCel?.(); },
  };
}
