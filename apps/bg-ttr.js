// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Ticket to Ride: tap route lengths per player (USA: 1→1, 2→2, 3→4, 4→7, 5→10, 6→15; Europe adds
// 8→21 and stations), trains left of 45, destination tickets (+ completed / − failed), the 10-point longest-route bonus
// and the final table.
import { h, clear } from '../js/ui/dom.js';
import { openPanel } from '../js/ui/overlay.js';
import { seg, editPlayers, celebrate, confirm, svgIcon, IC, uid } from './bg-ui.js';

const POINTS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15, 8: 21 };
const TRAIN_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#eab308', '#3f3f46'];
const TRAIN_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Black'];
const polar = (deg, r, cy = 50) => { const a = (deg * Math.PI) / 180; return { left: `${50 + r * Math.sin(a)}%`, top: `${cy - r * Math.cos(a)}%` }; };

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-ttr');
  const names = app.data('roster', []);
  const fresh = (n = 3) => Array.from({ length: n }, (_, i) => ({ id: uid(), name: names[i] || TRAIN_NAMES[i], color: TRAIN_COLORS[i], routes: [], tickets: [], stations: 3 }));
  const S = Object.assign({ ed: 'usa', players: fresh(), longest: null, sel: 0 }, app.data('ttr', {}));
  let undo = [];
  const save = () => app.save('ttr', S);
  const snap = () => { undo.push(JSON.stringify(S)); if (undo.length > 60) undo.shift(); };
  const lens = () => (S.ed === 'europe' ? [1, 2, 3, 4, 5, 6, 8] : [1, 2, 3, 4, 5, 6]);
  const routePts = (p) => p.routes.reduce((a, l) => a + (POINTS[l] || 0), 0);
  const trainsLeft = (p) => 45 - p.routes.reduce((a, l) => a + l, 0);
  const ticketPts = (p) => p.tickets.reduce((a, t) => a + t, 0);
  const total = (p) => routePts(p) + ticketPts(p) + (S.longest === p.id ? 10 : 0) + (S.ed === 'europe' ? (p.stations ?? 3) * 4 : 0);
  const cur = () => S.players[Math.min(S.sel, S.players.length - 1)];

  const chips = h('div.bg-ttr-chips');
  const center = h('div.bg-ttr-center');
  const routesEl = h('div.bg-ttr-routes');
  const bottom = h('div.bg-ttr-bottom',
    h('button.pill.small', { type: 'button', onclick: () => tickets() }, 'Tickets'),
    h('button.pill.small', { type: 'button', onclick: () => longest() }, S.ed === 'europe' ? 'Express' : 'Longest'),
    h('button.pill.small.primary', { type: 'button', onclick: () => finalTable() }, 'Totals'));
  const undoBtn = h('button.ibtn.bg-ibtn.bg-abs', { type: 'button', 'aria-label': 'Undo', style: { left: '21%', top: '34%' }, html: svgIcon(IC.undo), onclick: () => doUndo() });
  const setBtn = h('button.ibtn.bg-ibtn.bg-abs', { type: 'button', 'aria-label': 'Settings', style: { left: '79%', top: '34%' }, html: svgIcon(IC.tune), onclick: () => settings() });
  el.append(chips, routesEl, center, undoBtn, setBtn, bottom);

  function render() {
    const p = cur();
    el.style.setProperty('--tc', p.color);
    clear(chips);
    S.players.forEach((q, i) => chips.append(h(`button.bg-ttr-chip${i === S.sel ? '.on' : ''}`, { type: 'button', '--c': q.color, onclick: () => { S.sel = i; save(); render(); app.sfx('tick'); } },
      h('b', q.name.slice(0, 1).toUpperCase()), h('small', String(total(q))))));
    clear(routesEl);
    const L = lens(), n = L.length, span = n > 6 ? 156 : 140, a0 = 180 + span / 2;
    L.forEach((len, i) => {
      const ang = a0 - (span / (n - 1)) * i;
      const count = p.routes.filter((x) => x === len).length;
      routesEl.append(h('button.bg-ttr-route', { type: 'button', style: polar(ang, 31.5, 46), 'aria-label': `Route of ${len}`, disabled: trainsLeft(p) < len, onclick: () => addRoute(len) },
        h('span.bg-ttr-cars', Array.from({ length: Math.min(len, 8) }, () => h('i'))),
        h('b', String(len)), h('small', `+${POINTS[len]}`), count ? h('em', `×${count}`) : null));
    });
    clear(center);
    const t = trainsLeft(p);
    center.append(
      h('div.bg-ttr-name', p.name),
      h('div.bg-ttr-total', String(total(p))),
      h('div.bg-ttr-sub', `${t} train${t === 1 ? '' : 's'} left${t <= 2 ? ' — last round!' : ''}`),
      h('div.bg-ttr-list', p.routes.length ? `routes ${[...p.routes].sort((a, b) => b - a).join(' · ')}` : 'Tap a route length'),
      h('div.bg-ttr-tk', `${p.tickets.length ? `tickets ${ticketPts(p) >= 0 ? '+' : ''}${ticketPts(p)}` : ''}${S.longest === p.id ? (p.tickets.length ? ' · ' : '') + '+10 bonus' : ''}`));
    center.classList.toggle('low', t <= 2);
    undoBtn.disabled = !undo.length;
  }
  function addRoute(len) {
    const p = cur();
    if (trainsLeft(p) < len) return;
    snap(); p.routes.push(len); save(); render();
    app.sfx('score', { pitch: 0.8 + len * 0.06 });
    if (trainsLeft(p) <= 2) app.toast(`${p.name} has ${trainsLeft(p)} trains — everyone gets one last turn`);
  }
  function doUndo() { const s = undo.pop(); if (!s) return; Object.assign(S, JSON.parse(s)); save(); render(); app.sfx('drop'); }

  function tickets() {
    const p = cur();
    openPanel({
      title: `${p.name} · tickets`, className: 'bg-ttr-tickets',
      build(body) {
        let sign = 1;
        const list = h('div.bg-ttr-tlist');
        const sum = h('div.bg-ttr-tsum');
        const draw = () => {
          clear(list);
          p.tickets.forEach((v, i) => list.append(h(`button.bg-ttr-ticket${v < 0 ? '.neg' : ''}`, { type: 'button', 'aria-label': 'Remove ticket', onclick: () => { snap(); p.tickets.splice(i, 1); save(); draw(); render(); } }, `${v > 0 ? '+' : '−'}${Math.abs(v)}`)));
          if (!p.tickets.length) list.append(h('span.bg-muted', 'No tickets yet'));
          sum.textContent = `Tickets: ${ticketPts(p) >= 0 ? '+' : ''}${ticketPts(p)} · ${p.tickets.filter((x) => x > 0).length} done, ${p.tickets.filter((x) => x < 0).length} failed`;
        };
        const sw = seg([{ v: 1, label: 'Completed +' }, { v: -1, label: 'Failed −' }], 1, (v) => { sign = v; grid.classList.toggle('neg', v < 0); });
        const vals = [];
        for (let v = 4; v <= 22; v++) vals.push(v);
        const grid = h('div.bg-ttr-vals', vals.map((v) => h('button', { type: 'button', onclick: () => { snap(); p.tickets.push(v * sign); save(); draw(); render(); app.sfx(sign > 0 ? 'coin' : 'hit'); } }, String(v))));
        body.append(sw, grid, sum, list, h('div.bg-note', 'Tap a value to add a ticket · tap a ticket to remove it'));
        draw();
      },
    });
  }
  function longest() {
    openPanel({
      title: S.ed === 'europe' ? 'European Express (+10)' : 'Longest route (+10)', className: 'bg-choose',
      build(body, panel) {
        const list = h('div.list');
        const pick = (id) => { snap(); S.longest = id; save(); render(); panel.close(); app.sfx('perfect'); };
        S.players.forEach((q) => list.append(h(`button.row${S.longest === q.id ? '.active' : ''}`, { type: 'button', onclick: () => pick(q.id) }, h('span.bg-dot', { style: { background: q.color } }), h('div.row-text', h('div.row-title', q.name)), S.longest === q.id ? h('span.check', '✓') : null)));
        list.append(h(`button.row${!S.longest ? '.active' : ''}`, { type: 'button', onclick: () => pick(null) }, h('span.bg-dot'), h('div.row-text', h('div.row-title', 'Nobody yet'))));
        body.append(list, h('div.bg-note', 'Ties: every player with the longest continuous path gets the bonus — pick one here and add 10 to the others as a ticket.'));
      },
    });
  }
  function finalTable() {
    openPanel({
      title: 'Totals', className: 'bg-ttr-final',
      build(body, panel) {
        const rows = S.players.map((p) => ({ p, r: routePts(p), t: ticketPts(p), b: S.longest === p.id ? 10 : 0, s: S.ed === 'europe' ? (p.stations ?? 3) * 4 : 0, tot: total(p), done: p.tickets.filter((x) => x > 0).length }))
          .sort((a, b) => b.tot - a.tot || b.done - a.done || b.b - a.b);
        const eu = S.ed === 'europe';
        const cols = eu ? '1.6fr repeat(5, 1fr)' : '1.6fr repeat(4, 1fr)';
        const tbl = h('div.bg-ttr-tbl',
          h('div.bg-ttr-tr.head', { style: { gridTemplateColumns: cols } }, h('span', ''), h('span', 'Routes'), h('span', 'Tickets'), h('span', 'Bonus'), eu ? h('span', 'Stations') : null, h('span', 'Total')),
          rows.map((x, i) => h(`div.bg-ttr-tr${i === 0 ? '.win' : ''}`, { style: { gridTemplateColumns: cols }, '--c': x.p.color },
            h('span.n', i === 0 ? h('i', { html: svgIcon(IC.crown) }) : h('i.dot'), x.p.name), h('span', String(x.r)), h('span', (x.t > 0 ? '+' : '') + x.t), h('span', x.b ? String(x.b) : '–'), eu ? h('span', String(x.s)) : null, h('b', String(x.tot)))));
        body.append(tbl,
          h('div.bg-note', 'Tie? Most completed tickets wins, then the longest-route bonus.'),
          h('button.pill.primary.small', { type: 'button', onclick: () => { panel.close(); app.sfx('win'); celebrate(el, `${rows[0].p.name} wins!`, rows[0].p.color, `${rows[0].tot} points`); } }, 'Finish game'));
      },
    });
  }
  function settings() {
    openPanel({
      title: 'Ticket to Ride', className: 'bg-sc-set',
      build(body, panel) {
        const ed = seg([{ v: 'usa', label: 'USA (base)' }, { v: 'europe', label: 'Europe' }], S.ed, (v) => { S.ed = v; save(); render(); bottom.children[1].textContent = v === 'europe' ? 'Express' : 'Longest'; });
        const st = h('div.bg-ttr-st');
        const drawSt = () => {
          clear(st);
          if (S.ed !== 'europe') return;
          st.append(h('div.bg-sect', 'Stations left (4 pts each)'));
          S.players.forEach((p) => st.append(h('div.bg-row-opt', h('span', p.name), h('div.bg-seg', [0, 1, 2, 3].map((k) => h(`button.chip${(p.stations ?? 3) === k ? '.on' : ''}`, { type: 'button', onclick: () => { p.stations = k; save(); render(); drawSt(); } }, String(k)))))));
        };
        ed.addEventListener('click', () => setTimeout(drawSt));
        body.append(h('div.bg-sect', 'Edition'), ed, st,
          h('button.bg-row-opt', { type: 'button', onclick: () => { panel.close(); editPlayers(app, { players: S.players, min: 2, max: 5, onChange: () => { for (const p of S.players) { p.routes ||= []; p.tickets ||= []; p.stations ??= 3; } save(); render(); } }); } }, h('span', 'Players'), h('b', `${S.players.length} ›`)),
          h('button.pill.small.danger', { type: 'button', onclick: async () => { panel.close(); if (await confirm('New game', 'Clear all routes and tickets?', 'Clear')) { snap(); S.players.forEach((p) => { p.routes = []; p.tickets = []; p.stations = 3; }); S.longest = null; save(); render(); } } }, 'New game'));
        drawSt();
      },
    });
  }

  render();
  return {
    key(e) {
      if (e.key === 'ArrowRight') { S.sel = (S.sel + 1) % S.players.length; render(); return true; }
      if (e.key === 'ArrowLeft') { S.sel = (S.sel - 1 + S.players.length) % S.players.length; render(); return true; }
      if (/^[1-8]$/.test(e.key) && lens().includes(+e.key)) { addRoute(+e.key); return true; }
      if (e.key === 'Enter') { finalTable(); return true; }
      return false;
    },
  };
}
