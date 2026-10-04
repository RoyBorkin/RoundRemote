// Board Games → Clue / Cluedo detective notepad: suspects, weapons and rooms (classic names, editable, US or UK
// edition), a column per player with has ✓ / doesn't ✗ / maybe ?, solved rows highlighted, and a privacy cover.
import { h, clear } from '../js/ui/dom.js';
import { openPanel } from '../js/ui/overlay.js';
import { seg, confirm, svgIcon, IC } from './bg-ui.js';

export const EDITIONS = {
  us: { name: 'Clue (US)', suspects: ['Miss Scarlet', 'Colonel Mustard', 'Mrs. White', 'Mr. Green', 'Mrs. Peacock', 'Professor Plum'],
    weapons: ['Candlestick', 'Knife', 'Lead Pipe', 'Revolver', 'Rope', 'Wrench'] },
  uk: { name: 'Cluedo (UK)', suspects: ['Miss Scarlett', 'Colonel Mustard', 'Mrs White', 'Reverend Green', 'Mrs Peacock', 'Professor Plum'],
    weapons: ['Candlestick', 'Dagger', 'Lead Piping', 'Revolver', 'Rope', 'Spanner'] },
};
const ROOMS = ['Kitchen', 'Ballroom', 'Conservatory', 'Dining Room', 'Billiard Room', 'Library', 'Lounge', 'Hall', 'Study'];
const SUSPECT_COL = ['#dc2626', '#ca8a04', '#e5e7eb', '#16a34a', '#2563eb', '#7c3aed'];
const CYCLE = ['', 'y', 'n', '?'];
const MARK = { '': '', y: '✓', n: '✗', '?': '?' };

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-clue');
  const fresh = (ed = 'us') => ({ ed, sections: { suspects: [...EDITIONS[ed].suspects], weapons: [...EDITIONS[ed].weapons], rooms: [...ROOMS] }, cols: ['Me', 'P2', 'P3', 'P4'], marks: {}, hidden: false });
  const S = Object.assign(fresh(), app.data('clue', {}));
  const save = () => app.save('clue', S);

  const grid = h('div.bg-clue-grid');
  const cover = h('button.bg-clue-cover', { type: 'button', onclick: () => { S.hidden = false; save(); render(); } }, h('i', { html: svgIcon(IC.eyeOff) }), h('b', 'Notes hidden'), h('small', 'tap to show'));
  const hideBtn = h('button.ibtn.bg-ibtn.bg-abs.bg-clue-hide', { type: 'button', 'aria-label': 'Hide notes', html: svgIcon(IC.eyeOff), onclick: () => { S.hidden = true; save(); render(); app.sfx('pop'); } });
  const setBtn = h('button.ibtn.bg-ibtn.bg-abs.bg-clue-set', { type: 'button', 'aria-label': 'Notepad settings', html: svgIcon(IC.tune), onclick: () => settings() });
  const legend = h('div.bg-clue-legend', h('span', '✓ has'), h('span', '✗ doesn’t'), h('span', '? maybe'));
  el.append(grid, cover, hideBtn, setBtn, legend);

  const key = (sec, i) => `${sec}:${i}`;
  function rowState(sec, i) {
    const m = S.marks[key(sec, i)] || {};
    const vals = S.cols.map((_, c) => m[c] || '');
    if (vals.includes('y')) return 'out';
    if (vals.length && vals.every((v) => v === 'n')) return 'solved';
    return '';
  }
  function render() {
    cover.hidden = !S.hidden; grid.hidden = S.hidden; legend.hidden = S.hidden;
    const st = grid.scrollTop;
    clear(grid);
    const cols = `minmax(0, 1fr) repeat(${S.cols.length}, 6.4cqmin)`;
    grid.append(h('div.bg-clue-row.head', { style: { gridTemplateColumns: cols } }, h('span'), S.cols.map((c, ci) => h('button.bg-clue-ch', { type: 'button', onclick: () => renameCol(ci) }, c.slice(0, 3)))));
    for (const [sec, label] of [['suspects', 'Suspects · Who?'], ['weapons', 'Weapons · How?'], ['rooms', 'Rooms · Where?']]) {
      const solved = S.sections[sec].map((_, i) => rowState(sec, i)).filter((x) => x === 'solved').length;
      grid.append(h('div.bg-clue-sec', label, solved === 1 ? h('b', ' — solved!') : null));
      S.sections[sec].forEach((name, i) => {
        const m = S.marks[key(sec, i)] || {};
        const state = rowState(sec, i);
        grid.append(h(`div.bg-clue-row.${state || 'open'}`, { style: { gridTemplateColumns: cols } },
          h('button.bg-clue-name', { type: 'button', onclick: () => renameCard(sec, i) },
            sec === 'suspects' ? h('i', { style: { background: SUSPECT_COL[i] || 'var(--dim)' } }) : null, h('span', name)),
          S.cols.map((_, c) => h(`button.bg-clue-cell.m${m[c] === '?' ? 'q' : m[c] || '0'}`, { type: 'button', 'aria-label': `${name}, ${S.cols[c]}`, onclick: () => {
            const k = key(sec, i); S.marks[k] ||= {};
            const nv = CYCLE[(CYCLE.indexOf(m[c] || '') + 1) % CYCLE.length];
            if (nv) S.marks[k][c] = nv; else delete S.marks[k][c];
            if (nv === 'y') { for (let o = 0; o < S.cols.length; o++) if (o !== c && !S.marks[k][o]) S.marks[k][o] = 'n'; }
            save(); render(); app.sfx('tick');
          } }, MARK[m[c] || '']))));
      });
    }
    grid.scrollTop = st;
  }
  async function renameCard(sec, i) {
    const v = await app.editText({ title: 'Card name', value: S.sections[sec][i] });
    if (v) { S.sections[sec][i] = v.slice(0, 22); save(); render(); }
  }
  async function renameCol(ci) {
    const v = await app.editText({ title: `Column ${ci + 1}`, value: S.cols[ci] });
    if (v) { S.cols[ci] = v.slice(0, 10); save(); render(); }
  }
  function settings() {
    openPanel({
      title: 'Detective notepad', className: 'bg-sc-set',
      build(body, panel) {
        const n = seg([2, 3, 4, 5, 6].map((k) => ({ v: k, label: String(k) })), S.cols.length, (k) => {
          while (S.cols.length < k) S.cols.push(`P${S.cols.length + 1}`);
          S.cols.length = k; save(); render();
        });
        const ed = seg([{ v: 'us', label: 'Clue (US)' }, { v: 'uk', label: 'Cluedo (UK)' }], S.ed, (v) => { S.ed = v; S.sections.suspects = [...EDITIONS[v].suspects]; S.sections.weapons = [...EDITIONS[v].weapons]; save(); render(); });
        body.append(h('div.bg-sect', 'Players (columns, incl. you)'), n, h('div.bg-sect', 'Card names'), ed,
          h('div.bg-note', 'Tap a card or a column name to rename it — editions and themed versions use different names.'),
          h('div.bg-note', 'Tip: when someone shows a card, tick ✓ in their column — everyone else is crossed out for you.'),
          h('button.pill.small.danger', { type: 'button', onclick: async () => { panel.close(); if (await confirm('New case', 'Clear all marks?', 'Clear')) { S.marks = {}; save(); render(); } } }, 'New case'));
      },
    });
  }
  render();
  return {
    key(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { grid.scrollBy({ top: grid.clientHeight * 0.4, behavior: 'smooth' }); return true; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { grid.scrollBy({ top: -grid.clientHeight * 0.4, behavior: 'smooth' }); return true; }
      if (e.key === 'h') { S.hidden = !S.hidden; save(); render(); return true; }
      return false;
    },
    destroy() { S.hidden = true; save(); },   // the notes are private: they start hidden next time
  };
}
