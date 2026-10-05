// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Rules: a searchable, curved list of games; each opens a scrolling reader with big type,
// section headers, text size buttons, a scroll-progress arc and knob/arrow scrolling.
import { h, clear } from '../js/ui/dom.js';
import { curve } from '../js/ui/overlay.js';
import { seg } from './bg-ui.js';
import { RULES, CATS, SECTIONS } from './bg-rules.js';

const CAT_COL = { board: '#3b82f6', classic: '#a16207', party: '#ec4899', cards: '#16a34a' };
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, '');

export function mount(el, ctx, opts = {}) {
  const { app } = ctx;
  if (opts.id) { const g = RULES.find((r) => r.id === opts.id); if (g) return reader(el, ctx, g); }
  el.classList.add('bg-rules');
  let q = '', cat = app.data('rulesCat', 'all'), sel = -1, shown = [];
  const searchBtn = h('button.bg-rl-search', { type: 'button', onclick: () => search() });
  const cats = seg([{ v: 'all', label: 'All' }, ...Object.entries(CATS).map(([v, label]) => ({ v, label }))], cat, (v) => { cat = v; app.save('rulesCat', v); sel = -1; draw(); }, 'bg-rl-cats');
  const list = h('div.list.bg-rl-list');
  el.append(searchBtn, cats, list);
  curve(list);

  function draw() {
    searchBtn.replaceChildren(h('span', { html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>' }),
      h('b', q || `Search ${RULES.length} games…`), ...(q ? [h('i', { onclick: (e) => { e.stopPropagation(); q = ''; draw(); } }, '×')] : []));
    searchBtn.classList.toggle('has', !!q);
    const nq = norm(q);
    shown = RULES.filter((r) => (cat === 'all' || r.cat === cat) && (!nq || norm(`${r.name} ${r.he || ''} ${r.id}`).includes(nq) || (nq.length > 3 && norm([r.goal, r.special].flat().join(' ')).includes(nq))));
    clear(list);
    shown.forEach((r, i) => list.append(h(`button.row.bg-rl-row${i === sel ? '.active' : ''}`, { type: 'button', onclick: () => open(r) },
      h('div.row-art.placeholder', { '--c': CAT_COL[r.cat] }, r.name.replace(/[^A-Za-z]/g, '').slice(0, 2)),
      h('div.row-text', h('div.row-title', r.name, r.he ? h('bdi', { dir: 'rtl' }, r.he) : null), h('div.row-sub', `${r.players.replace(/ \(.*\)/, '')} players · ${r.time}`)))));
    if (!shown.length) list.append(h('div.empty', 'No game found'));
  }
  async function search() {
    const v = await app.editText({ title: 'Search rules', value: q, placeholder: 'Game name (English or Hebrew)', okLabel: 'Search' });
    if (v !== null) { q = v; sel = -1; draw(); list.scrollTop = 0; }
  }
  function open(r) { app.sfx('tap'); ctx.push({ mount: (e2, c2) => reader(e2, c2, r), title: r.name, color: CAT_COL[r.cat] }); }
  draw();
  return {
    key(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { sel = Math.min(shown.length - 1, sel + 1); draw(); list.children[sel]?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return true; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { sel = Math.max(0, sel - 1); draw(); list.children[sel]?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return true; }
      if (e.key === 'Enter' && shown[sel]) { open(shown[sel]); return true; }
      if (e.key.length === 1 && /[\p{L}\p{N} ]/u.test(e.key) && !e.ctrlKey && !e.metaKey) { q += e.key; sel = 0; draw(); return true; }
      if (e.key === 'Delete' && q) { q = ''; draw(); return true; }
      return false;
    },
  };
}

/** The reader: one game's rules as a scrolling page. */
export function reader(el, ctx, r) {
  const { app } = ctx;
  el.classList.add('bg-reader');
  let size = app.data('rulesSize', 1);
  const body = h('div.bg-rd-body');
  const box = h('div.bg-rd', body);
  const arc = h('div.bg-rd-arc', { html: '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="tr" d="M88.97 27.5a45 45 0 0 1 0 45"/><path class="fl" d="M88.97 27.5a45 45 0 0 1 0 45" pathLength="100"/></svg>' });
  const fl = arc.querySelector('.fl');
  const smaller = h('button.ibtn.bg-ibtn.bg-abs.bg-rd-sz.a', { type: 'button', 'aria-label': 'Smaller text', onclick: () => setSize(size - 1) }, h('span', 'A'));
  const bigger = h('button.ibtn.bg-ibtn.bg-abs.bg-rd-sz.b', { type: 'button', 'aria-label': 'Bigger text', onclick: () => setSize(size + 1) }, h('span', 'A'));
  el.append(box, arc, smaller, bigger);

  body.append(
    h('div.bg-rd-head', h('div.bg-rd-name', r.name), r.he ? h('div.bg-rd-he', { dir: 'rtl' }, r.he) : null,
      h('div.bg-rd-meta', h('span', `${r.players} players`), h('span', r.time), h('span', CATS[r.cat]))));
  for (const [k, label] of SECTIONS) {
    const v = r[k];
    if (!v) continue;
    body.append(h('h3.bg-rd-h', label));
    if (Array.isArray(v)) body.append(h('ul.bg-rd-ul', v.map((x) => h('li', x))));
    else body.append(h('p.bg-rd-p', v));
  }
  body.append(h('p.bg-rd-foot', 'Summary in our own words — editions and house rules differ, so check your box when in doubt.'));

  function setSize(s) { size = Math.max(0, Math.min(3, s)); el.dataset.size = size; app.save('rulesSize', size); smaller.disabled = size === 0; bigger.disabled = size === 3; prog(); }
  function prog() { const m = box.scrollHeight - box.clientHeight; const p = m > 0 ? box.scrollTop / m : 1; fl.style.strokeDasharray = `${(p * 100).toFixed(1)} 100`; }
  box.addEventListener('scroll', prog, { passive: true });
  setSize(size);
  requestAnimationFrame(prog);
  return {
    key(e) {
      const d = box.clientHeight * 0.38;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { box.scrollBy({ top: d, behavior: 'smooth' }); return true; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') { box.scrollBy({ top: -d, behavior: 'smooth' }); return true; }
      if (e.key === '+' || e.key === '=') { setSize(size + 1); return true; }
      if (e.key === '-') { setSize(size - 1); return true; }
      return false;
    },
  };
}
