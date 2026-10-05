// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Bookmarks — where you stopped in every book. The book you're reading sits in the middle with its progress ring;
// "Stopped at" opens a big number pad (page, or h:mm for audiobooks). Progress %, pages a day and the finish date
// come from your pace. Find books on Open Library (covers, page counts) or type them in; paper, ebook or audiobook.
// Notes & quotes per book, a Finished shelf, a Want-to-read shelf (that can go to Wish Lists), a reading streak and
// daily reading reminders that ring on any screen (books-store.js runs them in the background).
import { h } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { topPanel, curve, listRow, spinner, emptyNote } from '../js/ui/overlay.js';
import * as S from './books-store.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const FORMATS = [{ id: 'paper', name: 'Paper' }, { id: 'ebook', name: 'Ebook' }, { id: 'audio', name: 'Audiobook' }];
const SHELVES = [{ id: 'reading', name: 'Reading' }, { id: 'want', name: 'Want to read' }, { id: 'done', name: 'Finished' }];
const LABELS = ['Read 20 min', 'Read 10 pages', 'Read a chapter', 'Time to read'];
const svgIc = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const IC = {
  mark: 'M6 2h12a1 1 0 0 1 1 1v19l-7-4-7 4V3a1 1 0 0 1 1-1z',
  shelf: 'M3 20h18v2H3zM4 4h4v15H4zm5 2h4v13H9zm5.3-1.6 3.9-1 3.6 14.4-3.9 1z',
  note: 'M5 3h10l5 5v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm9 1.5V9h4.5zM7 12v1.8h10V12zm0 3.6v1.8h7v-1.8z',
  quote: 'M6.5 6C4 6 2.5 8 2.5 10.5S4 15 6.3 15c.4 0 .7 0 1-.1-.5 1.5-1.8 2.6-3.6 3l.5 1.6C8 18.8 10.5 16 10.5 12V10c0-2.4-1.6-4-4-4zm11 0C15 6 13.5 8 13.5 10.5S15 15 17.3 15c.4 0 .7 0 1-.1-.5 1.5-1.8 2.6-3.6 3l.5 1.6c3.8-.7 6.3-3.5 6.3-7.5V10c0-2.4-1.6-4-4-4z',
  bell: 'M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.8V3.5a1.5 1.5 0 0 0-3 0v.7A7 7 0 0 0 5 11v5l-2 2v1h18v-1z',
  flame: 'M13.5 1.5s.7 2.6.7 4.7c0 2-1.3 3.7-3.4 3.7S7.5 8.2 7.5 6.2l.1-.4A9.4 9.4 0 0 0 5 12.3 7 7 0 0 0 12 19.3a7 7 0 0 0 7-7c0-4.5-2.2-8.6-5.5-10.8zM11.7 16.3c-1.6 0-2.8-1.2-2.8-2.8 0-1.4.9-2.4 2.4-2.7 1.5-.3 3-1 3.9-2.2.3 1.1.5 2.3.5 3.5 0 2.3-1.8 4.2-4 4.2z',
  heart: 'M12 21l-1.4-1.3C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.6 11.6z',
};
const pct = (b) => `${Math.round(S.progress(b) * 100)}%`;
const fmtDate = (t, opts = { month: 'short', day: 'numeric' }) => { try { return new Date(t).toLocaleDateString(undefined, opts); } catch { return ''; } };
const unitName = (b, n) => (S.isAudio(b) ? 'min' : Math.round(n) === 1 ? 'page' : 'pages');
/** A cover: the image, or a coloured spine-like block with the title (when there's no image or it fails). */
function hue(str) { let x = 0; for (const c of String(str)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
function cover(b, cls = '') {
  const el = h(`div.bk-cv${cls ? '.' + cls : ''}`, { '--h': hue(b.title + b.author) },
    h('div.bk-cv-ph', h('b', { dir: 'auto' }, b.title || 'Untitled'), b.author ? h('small', { dir: 'auto' }, b.author) : null));
  if (b.cover) {
    const img = h('img', { src: b.cover, alt: '', loading: 'lazy', draggable: 'false' });
    img.addEventListener('load', () => { if (img.naturalWidth > 2) el.classList.add('img'); else img.remove(); });
    img.addEventListener('error', () => img.remove());
    el.append(img);
  }
  return el;
}

export default {
  css: './books.css',
  create(el, app) {
    S.startReminders();
    const openPanel = (o) => { const p = app.openPanel(o); p.el.style.setProperty('--ac', S.COLOR); p.el.classList.add('bk-panel'); return p; };
    let page = 'main';             // main | shelf
    let shelf = 'reading';
    let keyPanel = null;

    // ================================================================ main page
    const svg = h('div.bk-ring', { html: `<svg viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="90" class="bk-track"/>
      <circle cx="100" cy="100" r="90" class="bk-arc" pathLength="1000" transform="rotate(-90 100 100)"/>
      <g class="bk-headg"><circle cx="100" cy="10" r="5.5" class="bk-head"/></g>
    </svg>` });
    const arc = svg.querySelector('.bk-arc'), headG = svg.querySelector('.bk-headg');
    const coverBox = h('button.bk-coverbtn', { type: 'button', 'aria-label': 'Book details', onclick: () => { const b = cur(); if (b) bookPanel(b); } });
    const prev = h('button.bk-nav.prev', { type: 'button', 'aria-label': 'Previous book', onclick: () => cycle(-1), html: icon('chevron') });
    const next = h('button.bk-nav', { type: 'button', 'aria-label': 'Next book', onclick: () => cycle(1), html: icon('chevron') });
    const title = h('div.bk-title', { dir: 'auto' });
    const author = h('div.bk-author', { dir: 'auto' });
    const pos = h('div.bk-pos');
    const meta = h('div.bk-meta');
    const stopBtn = h('button.bk-go', { type: 'button', onclick: () => { const b = cur(); if (b) stoppedAt(b); } }, h('i', { html: svgIc(IC.mark) }), h('span', 'Stopped at'));
    const shelfBtn = h('button.bk-side.bk-left', { type: 'button', 'aria-label': 'Shelves', title: 'Shelves', onclick: () => showPage('shelf'), html: svgIc(IC.shelf) });
    const notesBtn = h('button.bk-side.bk-right', { type: 'button', 'aria-label': 'Notes & quotes', title: 'Notes & quotes', onclick: () => { const b = cur(); if (b) notesPanel(b); }, html: svgIc(IC.quote) });
    const bellBtn = h('button.bk-small.bk-bell', { type: 'button', 'aria-label': 'Reading reminders', title: 'Reading reminders', onclick: () => remindersPanel(), html: svgIc(IC.bell) });
    const streakEl = h('div.bk-streak');
    const main = h('div.bk-page.bk-main', coverBox, prev, next, title, author, pos, meta, shelfBtn, stopBtn, notesBtn);
    const empty = h('div.bk-empty',
      h('div.bk-empty-ic', { html: svgIc(IC.mark) }),
      h('div.bk-empty-t', 'What are you reading?'),
      h('div.bk-empty-m', 'Add a book and keep your place — page, progress, pace and when you’ll finish.'),
      h('div.bk-empty-btns',
        h('button.pill.primary', { type: 'button', '--c': S.COLOR, onclick: () => addBook() }, 'Add a book'),
        h('button.pill', { type: 'button', onclick: () => showPage('shelf') }, 'Shelves')));

    // ================================================================ shelves page
    const tabs = h('div.bk-tabs');
    const list = h('div.bk-list');
    const addBtn = h('button.bk-small.bk-add', { type: 'button', 'aria-label': 'Add a book', title: 'Add a book', onclick: () => addBook(), html: icon('plus') });
    const shelfPage = h('div.bk-page.bk-shelf', { hidden: true }, tabs, list, bellBtn, addBtn);
    curve(list);

    const root = h('div.bk', svg, streakEl, main, empty, shelfPage);
    app.hideTitle();
    el.append(root);

    const cur = () => S.bookById(S.curId());
    function showPage(p) {
      page = p;
      root.dataset.page = p;
      app.sfx('tick');
      draw();
    }
    function cycle(d) {
      const r = S.reading();
      if (r.length < 2) return;
      const i = r.findIndex((b) => b.id === S.curId());
      S.setCur(r[(i + d + r.length) % r.length].id);
      app.sfx('tick');
    }

    // ---------------------------------------------------------------- drawing
    let coverFor = '';
    function draw() {
      const b = cur();
      const st = S.streak();
      streakEl.replaceChildren(...(st.current ? [h('i', { html: svgIc(IC.flame) }), h('b', String(st.current)), h('span', st.current === 1 ? 'day' : 'days')] : [h('span', 'Bookmarks')]));
      streakEl.title = st.current ? `${st.current}-day reading streak${st.today ? '' : ' — read today to keep it'}` : '';
      streakEl.classList.toggle('on', !!st.current);
      streakEl.classList.toggle('pending', !!st.current && !st.today);
      if (page === 'shelf') {
        main.hidden = true; empty.hidden = true; shelfPage.hidden = false;
        setArc(0);
        drawShelf();
        return;
      }
      shelfPage.hidden = true;
      main.hidden = !b; empty.hidden = !!b;
      if (!b) { setArc(0); return; }
      setArc(S.progress(b));
      const key = `${b.id}|${b.cover}|${b.title}`;
      if (coverFor !== key) { coverBox.replaceChildren(cover(b, 'big')); coverFor = key; }
      const many = S.reading().length > 1;
      prev.hidden = next.hidden = !many;
      title.textContent = b.title;
      author.textContent = b.author || (S.isAudio(b) ? 'Audiobook' : '');
      pos.replaceChildren(h('b', S.posText(b)), h('span', ` / ${S.isAudio(b) ? S.fmtMins(b.total) : b.total}`), h('em', pct(b)));
      const p = S.pace(b), e = S.eta(b);
      const bits = [];
      if (p) bits.push(`${p >= 10 ? Math.round(p) : p.toFixed(1).replace(/\.0$/, '')} ${S.isAudio(b) ? 'min' : 'pages'}/day`);
      if (e) bits.push(`done ~${fmtDate(e)}`);
      if (!bits.length) bits.push(b.pos ? 'Keep going — your pace shows tomorrow' : 'Tap Stopped at when you read');
      meta.textContent = bits.join(' · ');
    }
    function setArc(f) {
      arc.style.strokeDasharray = `${(f * 1000).toFixed(1)} 1000`;
      arc.style.opacity = f > 0.002 ? 1 : 0;
      headG.style.transform = `rotate(${(f * 360).toFixed(2)}deg)`;
      headG.style.opacity = f > 0.002 && f < 0.999 ? 1 : 0;
    }

    function drawShelf() {
      const all = S.books();
      tabs.replaceChildren(...SHELVES.map((s) => {
        const n = all.filter((b) => b.status === s.id).length;
        return h(`button.chip${shelf === s.id ? '.on' : ''}`, { type: 'button', onclick: () => { shelf = s.id; app.sfx('tick'); drawShelf(); list.scrollTop = 0; } }, s.name, h('small', ` ${n}`));
      }));
      const items = all.filter((b) => b.status === shelf);
      if (shelf === 'done') items.sort((a, b) => (b.finished || 0) - (a.finished || 0));
      if (!items.length) {
        list.replaceChildren(h('div.bk-none', shelf === 'reading' ? 'Nothing on the go — add a book.' : shelf === 'want' ? 'Books you want to read go here.' : 'Finished books land here.'));
        return;
      }
      list.replaceChildren(...items.map((b) => h(`button.bk-row${b.id === S.curId() && shelf === 'reading' ? '.active' : ''}`, { type: 'button', onclick: () => bookPanel(b) },
        cover(b, 'thumb'),
        h('div.bk-rtext',
          h('b', { dir: 'auto' }, b.title),
          h('small', { dir: 'auto' }, [b.author, b.status === 'reading' ? `${S.posText(b)} · ${pct(b)}` : b.status === 'done' ? `Finished ${fmtDate(b.finished, { month: 'short', day: 'numeric', year: 'numeric' })}` : b.year ? String(b.year) : FORMATS.find((f) => f.id === b.format)?.name].filter(Boolean).join(' · ')),
          b.status === 'reading' ? h('div.bk-prog', h('i', { style: { width: pct(b) } })) : null))));
    }

    // ================================================================ the number pad ("Stopped at" and page counts)
    function numPad({ title: ttl, value, max = 99999, audio = false, hint, onOk, okLabel = 'OK' }) {
      let v = Math.round(value) || 0;
      let typed = '';
      openPanel({
        title: ttl, className: 'bk-padpanel',
        build(body, panel) {
          const ring = h('div.bk-padring', { html: `<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="95" class="bk-ptrack"/><circle cx="100" cy="100" r="95" class="bk-parc" pathLength="1000" transform="rotate(-90 100 100)"/></svg>` });
          panel.el.prepend(ring);
          const parc = ring.querySelector('.bk-parc');
          const num = h('div.bk-num');
          const hintEl = h('div.bk-padhint');
          const show = () => {
            num.textContent = audio ? S.fmtMins(v) : String(v);
            num.classList.toggle('typing', !!typed);
            hintEl.textContent = hint ? hint(v) : '';
            const f = max && max < 99999 ? Math.min(1, v / max) : 0;
            parc.style.strokeDasharray = `${(f * 1000).toFixed(1)} 1000`;
          };
          const set = (n) => { v = Math.max(0, Math.min(max, Math.round(n))); show(); };
          const press = (k) => {
            if (k === 'del') typed = typed.slice(0, -1);
            else if (k === 'ok') { done(); return; }
            else if (typed.length < 5) typed = (typed + k).replace(/^0+(?=\d)/, '');
            if (audio) { const n = +typed || 0; set(Math.floor(n / 100) * 60 + Math.min(59, n % 100)); } else set(+typed || 0);
            app.sfx('tick');
          };
          const done = () => { panel.close(); onOk(v); };
          const step = (d) => { typed = ''; set(v + d); app.sfx('tick'); };
          const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
          const grid = h('div.bk-keys', keys.map((k) => h(`button.bk-key${k === 'del' ? '.del' : k === 'ok' ? '.ok' : ''}`, {
            type: 'button', 'aria-label': k === 'del' ? 'Delete' : k === 'ok' ? okLabel : k, onclick: () => press(k),
            html: k === 'del' ? icon('backspace') : k === 'ok' ? icon('check') : k })));
          const minus = h('button.ibtn.small.bk-step', { type: 'button', 'aria-label': 'One less', onclick: () => step(-1), html: icon('minus') });
          const plus = h('button.ibtn.small.bk-step', { type: 'button', 'aria-label': 'One more', onclick: () => step(1), html: icon('plus') });
          body.append(h('div.bk-numrow', minus, num, plus), hintEl, grid);
          num.addEventListener('wheel', (e) => { e.preventDefault(); step(e.deltaY < 0 ? 1 : -1); }, { passive: false });
          show();
          panel.keys = (e) => {
            if (/^\d$/.test(e.key)) { press(e.key); return true; }
            if (e.key === 'Backspace') { press('del'); return true; }
            if (e.key === 'Enter') { done(); return true; }
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { step(1); return true; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { step(-1); return true; }
            return false;
          };
          keyPanel = panel;
        },
      });
    }
    // number-pad keys go first (Backspace deletes a digit instead of closing)
    const padKeys = (e) => {
      if (keyPanel?.keys && topPanel() === keyPanel && !e.target.matches?.('input, textarea') && keyPanel.keys(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', padKeys, true);

    function stoppedAt(b) {
      const audio = S.isAudio(b);
      const startToday = (() => { const today = S.dayKey(); const before = (b.hist || []).filter((x) => x.d < today).at(-1); return before ? before.pos : (b.started && S.dayKey(b.started) === today ? b.startPos : b.pos); })();
      numPad({
        title: audio ? 'Stopped at (h:mm)' : 'Stopped at page', value: b.pos, max: b.total || 99999, audio,
        hint: (v) => {
          const d = v - startToday;
          const pc = b.total ? `${Math.round(Math.min(1, v / b.total) * 100)}%` : '';
          return [audio ? `of ${S.fmtMins(b.total)}` : `of ${b.total}`, pc, d > 0 ? `+${audio ? S.fmtMins(d) : d} today` : ''].filter(Boolean).join(' · ');
        },
        onOk: (v) => {
          const d = S.setPos(b.id, v);
          const nb = S.bookById(b.id);
          app.sfx(d > 0 ? 'coin' : 'tap');
          if (nb.total && nb.pos >= nb.total && nb.status !== 'done') { finishedAsk(nb); return; }
          if (d > 0) app.toast(`+${audio ? S.fmtMins(d) : d} ${audio ? '' : unitName(nb, d)} · ${pct(nb)}`.replace(/\s+·/, ' ·'));
        },
      });
    }
    function finishedAsk(b) {
      openPanel({
        title: 'The end?',
        build(body, panel) {
          body.append(h('div.bk-form', cover(b, 'mid'), h('div.bk-note', `You reached the end of “${b.title}”. Put it on the Finished shelf?`),
            h('div.bk-btns',
              h('button.pill.primary', { type: 'button', '--c': S.COLOR, onclick: () => { S.finish(b.id); app.sfx('win'); panel.close(); app.toast('Finished! On to the next one'); } }, 'Finished'),
              h('button.pill', { type: 'button', onclick: () => panel.close() }, 'Not yet'))));
        },
      });
    }

    // ================================================================ a book
    function bookPanel(b0) {
      openPanel({
        title: '',
        className: 'bk-bookpanel',
        build(body, panel) {
          const sc = h('div.bk-form');
          const render = () => {
            const b = S.bookById(b0.id);
            if (!b) { panel.close(); return; }
            const p = S.pace(b), e = S.eta(b);
            const stats = [];
            if (b.status === 'reading' || b.pos) stats.push(h('div.bk-stat', h('b', pct(b)), h('span', `${S.posText(b)} of ${S.isAudio(b) ? S.fmtMins(b.total) : b.total}`)));
            if (p) stats.push(h('div.bk-stat', h('b', p >= 10 ? String(Math.round(p)) : p.toFixed(1).replace(/\.0$/, '')), h('span', `${S.isAudio(b) ? 'min' : 'pages'} a day`)));
            if (e && b.status === 'reading') stats.push(h('div.bk-stat', h('b', fmtDate(e)), h('span', 'finish (est.)')));
            if (b.status === 'done') stats.push(h('div.bk-stat', h('b', fmtDate(b.finished)), h('span', b.started ? `${Math.max(1, Math.round((b.finished - b.started) / 864e5))} days` : 'finished')));
            const act = (name, fn, cls = '') => h(`button.pill.small${cls}`, { type: 'button', onclick: fn }, name);
            sc.replaceChildren(...[
              h('div.bk-head', cover(b, 'mid'), h('div.bk-headt', h('b', { dir: 'auto' }, b.title), h('small', { dir: 'auto' }, [b.author, b.year || '', FORMATS.find((f) => f.id === b.format)?.name].filter(Boolean).join(' · ')),
                h('span.bk-badge', SHELVES.find((s) => s.id === b.status)?.name || ''))),
              stats.length ? h('div.bk-stats', stats) : null,
              h('div.bk-acts',
                b.status === 'reading' ? act('Stopped at…', () => { panel.close(); stoppedAt(b); }, '.primary') : null,
                b.status !== 'reading' ? act(b.status === 'done' ? 'Read again' : 'Start reading', () => {
                  const nb = { ...b, status: 'reading' };
                  if (b.status === 'done') Object.assign(nb, { pos: 0, started: 0, startPos: 0, finished: 0 });
                  S.putBook(nb); S.setCur(b.id); app.sfx('pop'); panel.close(); showPage('main');
                }, '.primary') : null,
                b.status === 'reading' && b.id !== S.curId() ? act('Show on main', () => { S.setCur(b.id); panel.close(); showPage('main'); }) : null,
                act(`Notes${b.notes?.length ? ` (${b.notes.length})` : ''}`, () => notesPanel(b)),
                act('Edit', () => editBook(b, render)),
                b.status === 'reading' ? act('Finished', () => { S.finish(b.id); app.sfx('win'); render(); }) : null,
                b.status === 'reading' ? act('Want to read', () => { S.putBook({ ...b, status: 'want' }); render(); }) : null,
                b.status === 'want' ? act('Add to Wish Lists', async () => { app.toast((await S.addToWishlist(b)) ? 'Added to Wish Lists' : 'Wish Lists isn’t available'); }) : null,
                act('Delete', () => confirm(`Delete “${b.title}”?`, 'Its notes go too.', () => { S.deleteBook(b.id); panel.close(); }), '.danger')),
            ].filter(Boolean));
          };
          render();
          body.append(sc);
          const off = S.events.on('change', render);
          panel.onDestroy = off;
        },
      });
    }
    function confirm(t, msg, yes) {
      openPanel({
        title: t,
        build(body, panel) {
          body.append(h('div.bk-form.center', h('div.bk-note', msg), h('div.bk-btns',
            h('button.pill.danger', { type: 'button', onclick: () => { panel.close(); yes(); } }, 'Delete'),
            h('button.pill', { type: 'button', onclick: () => panel.close() }, 'Keep'))));
        },
      });
    }

    // ---------------------------------------------------------------- notes & quotes
    function notesPanel(b0) {
      openPanel({
        title: 'Notes & quotes',
        build(body, panel) {
          const wrap = h('div.bk-notes');
          const render = () => {
            const b = S.bookById(b0.id);
            if (!b) return;
            const add = (kind) => async () => {
              const v = await app.editText({ title: kind === 'quote' ? 'A quote' : 'A note', placeholder: kind === 'quote' ? 'The words, as written…' : 'What you thought…', okLabel: 'Add' });
              if (v) { S.addNote(b.id, { kind, text: v, at: b.pos || null }); app.sfx('pop'); }
            };
            wrap.replaceChildren(...[
              h('div.bk-nadd', h('button.pill.small', { type: 'button', onclick: add('note') }, h('i', { html: svgIc(IC.note) }), 'Note'),
                h('button.pill.small', { type: 'button', onclick: add('quote') }, h('i', { html: svgIc(IC.quote) }), 'Quote')),
              (b.notes || []).length ? null : h('div.bk-none', `Nothing yet for “${b.title}”. Keep a thought or a line you loved.`),
              ...(b.notes || []).map((n) => h(`div.bk-n.${n.kind}`,
                h('div.bk-ntext', { dir: 'auto' }, n.text),
                h('div.bk-nmeta', [n.at ? S.posText(b, n.at) : '', fmtDate(n.t)].filter(Boolean).join(' · '),
                  h('button.bk-ndel', { type: 'button', 'aria-label': 'Delete', onclick: () => { S.deleteNote(b.id, n.id); app.sfx('tap'); }, html: icon('close') })))),
            ].filter(Boolean));
          };
          render();
          body.append(wrap);
          panel.onDestroy = S.events.on('change', render);
        },
      });
    }

    // ---------------------------------------------------------------- add / edit
    function addBook() {
      openPanel({
        title: 'Add a book',
        build(body, panel) {
          const wrap = h('div.bk-addwrap');
          const results = h('div.list.bk-results');
          const search = async (q0) => {
            const q = q0 ?? await app.editText({ title: 'Search Open Library', placeholder: 'Title, author or ISBN', okLabel: 'Search' });
            if (!q) return;
            qBtn.textContent = q;
            results.replaceChildren(spinner('Searching Open Library…'));
            try {
              const found = await S.searchBooks(q);
              if (panel.closed) return;
              results.replaceChildren(...(found.length ? found.map((r) => listRow({
                title: r.title, subtitle: [r.author, r.year || '', r.pages ? `${r.pages} p.` : ''].filter(Boolean).join(' · '), art: r.cover, mono: r.title.slice(0, 1), color: S.COLOR,
                onClick: () => editBook(S.newBook({ title: r.title, author: r.author, cover: r.cover, year: r.year, olKey: r.olKey, total: r.pages || 300 }), () => panel.close(), true),
              })) : [emptyNote(`Nothing found for “${q}”.`)]));
            } catch (e) {
              results.replaceChildren(emptyNote(`Couldn’t reach Open Library: ${e?.message || e}`, { label: 'Try again', onClick: () => search(q) }));
            }
          };
          const qBtn = h('button.pill.bk-q', { type: 'button', onclick: () => search() }, h('i', { html: icon('search') }), 'Search Open Library');
          const manual = h('button.pill.small', { type: 'button', onclick: async () => {
            const t = await app.editText({ title: 'Book title', placeholder: 'Title', okLabel: 'Next' });
            if (!t) return;
            editBook(S.newBook({ title: t }), () => panel.close(), true);
          } }, 'Type it in');
          wrap.append(h('div.bk-addbar', qBtn, manual), results);
          body.append(wrap);
          curve(results);
          panel.search = search;
        },
      });
    }
    function editBook(b0, after, isNew = false) {
      const d = JSON.parse(JSON.stringify(b0));
      let wish = isNew;
      openPanel({
        title: isNew ? 'Add this book' : 'Edit book',
        build(body, panel) {
          const sc = h('div.bk-form');
          const render = () => {
            const totalLbl = S.isAudio(d) ? `${S.fmtMins(d.total)} long` : `${d.total} pages`;
            sc.replaceChildren(...[
              h('div.bk-head', cover(d, 'mid'), h('div.bk-headt',
                h('button.bk-editt', { type: 'button', dir: 'auto', onclick: async () => { const v = await app.editText({ title: 'Title', value: d.title }); if (v) { d.title = v; render(); } } }, d.title || 'Title', h('i', { html: icon('edit') })),
                h('button.bk-edita', { type: 'button', dir: 'auto', onclick: async () => { const v = await app.editText({ title: 'Author', value: d.author, placeholder: 'Author' }); if (v !== null) { d.author = v; render(); } } }, d.author || 'Add the author', h('i', { html: icon('edit') })))),
              h('div.bk-lbl', 'Format'),
              chipRow(FORMATS, d.format, (v) => {
                if ((v === 'audio') !== S.isAudio(d)) { d.total = v === 'audio' ? 480 : 300; d.pos = 0; }
                d.format = v; render();
              }),
              h('div.bk-lbl', S.isAudio(d) ? 'Length' : 'Pages'),
              h('button.pill.bk-total', { type: 'button', onclick: () => numPad({ title: S.isAudio(d) ? 'Length (h:mm)' : 'Number of pages', value: d.total, audio: S.isAudio(d), max: 99999,
                hint: () => (S.isAudio(d) ? 'Type hours and minutes, e.g. 1 2 3 0 = 12:30' : ''), onOk: (v) => { d.total = Math.max(1, v); d.pos = Math.min(d.pos, d.total); render(); } }) }, totalLbl),
              h('div.bk-lbl', 'Shelf'),
              chipRow(SHELVES, d.status, (v) => { d.status = v; render(); }),
              isNew && d.status === 'want' ? h('div.chips.multi', h(`button.chip${wish ? '.on' : ''}`, { type: 'button', onclick: () => { wish = !wish; render(); } }, 'Also on my Wish List')) : null,
              h('div.bk-btns', h('button.pill.primary', { type: 'button', '--c': S.COLOR, onclick: save }, isNew ? 'Add' : 'Save'))].filter(Boolean));
          };
          const save = async () => {
            if (d.status === 'done' && !d.finished) { d.finished = Date.now(); d.pos = d.total; }
            S.putBook(d);
            if (d.status === 'reading' && (isNew || !S.curId())) S.setCur(d.id);
            app.sfx('pop'); panel.close(); after?.();
            if (isNew) {
              shelf = d.status;
              if (d.status === 'reading') showPage('main'); else if (page === 'shelf') draw();
              if (d.status === 'want' && wish) app.toast((await S.addToWishlist(d)) ? `“${d.title}” is on your Wish List too` : `Added to Want to read`);
              else app.toast(`Added “${d.title}”`);
            }
          };
          render();
          body.append(sc);
        },
      });
    }
    function chipRow(items, value, set) {
      return h('div.chips', items.map((it) => h(`button.chip${it.id === value ? '.on' : ''}`, { type: 'button', onclick: () => set(it.id) }, it.name)));
    }

    // ================================================================ reminders
    function remindersPanel() {
      openPanel({
        title: 'Reading reminders',
        build(body, panel) {
          const sc = h('div.bk-form');
          const render = () => {
            const rs = S.reminders();
            sc.replaceChildren(...[
              ...rs.map((r) => h(`div.bk-rem${r.on ? '' : '.off'}`,
                h('button.bk-remmain', { type: 'button', onclick: () => editReminder(r) },
                  h('b', `${S.pad(r.h)}:${S.pad(r.m)}`), h('span', h('em', { dir: 'auto' }, r.label || 'Time to read'), h('small', S.describeDays(r.days)))),
                h(`button.switch${r.on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(!!r.on), 'aria-label': 'On', onclick: () => {
                  S.saveReminders(S.reminders().map((x) => (x.id === r.id ? { ...x, on: !x.on, snoozeUntil: 0 } : x))); app.sfx('tick');
                } }))),
              rs.length ? null : h('div.bk-note', 'A daily nudge to read — it rings here (and on your smart home, Settings → Alerts) at the time you pick.'),
              h('button.pill', { type: 'button', onclick: () => editReminder(null) }, '+ Add a reminder')].filter(Boolean));
          };
          render();
          body.append(sc);
          panel.onDestroy = S.events.on('change', render);
        },
      });
    }
    function editReminder(existing) {
      const d = existing ? { ...existing, days: [...(existing.days || [])] } : { id: `r${Date.now().toString(36)}`, h: 21, m: 30, days: [], label: 'Read 20 min', on: true };
      openPanel({
        title: existing ? 'Edit reminder' : 'New reminder',
        build(body, panel) {
          const sc = h('div.bk-form');
          const tH = h('b'), tM = h('b');
          const drawT = () => { tH.textContent = S.pad(d.h); tM.textContent = S.pad(d.m); };
          const bump = (u, n) => { if (u === 'h') d.h = (d.h + n + 24) % 24; else d.m = (d.m + n + 60) % 60; app.sfx('tick'); drawT(); };
          const unit = (u, el) => h('div.bk-tunit',
            h('button.ibtn.small.bk-up', { type: 'button', 'aria-label': u === 'h' ? 'Hour up' : 'Minutes up', onclick: () => bump(u, u === 'h' ? 1 : 5), html: icon('chevron') }), el,
            h('button.ibtn.small.bk-down', { type: 'button', 'aria-label': u === 'h' ? 'Hour down' : 'Minutes down', onclick: () => bump(u, u === 'h' ? -1 : -5), html: icon('chevron') }));
          drawT();
          const days = h('div.bk-days');
          const drawDays = () => days.replaceChildren(...LETTERS.map((L, i) => h(`button.chip${d.days.includes(i) || !d.days.length ? '.on' : ''}`, { type: 'button', 'aria-label': DAYS[i], onclick: () => {
            const all = d.days.length ? d.days : [0, 1, 2, 3, 4, 5, 6];
            d.days = all.includes(i) ? all.filter((x) => x !== i) : [...all, i].sort();
            if (!d.days.length || d.days.length === 7) d.days = [];
            drawDays();
          } }, L)));
          drawDays();
          const labels = h('div.chips');
          const drawLabels = () => labels.replaceChildren(...[...new Set([...LABELS, d.label].filter(Boolean))].map((l) => h(`button.chip.bk-mini${d.label === l ? '.on' : ''}`, { type: 'button', onclick: () => { d.label = l; drawLabels(); } }, l)),
            h('button.chip.bk-mini', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Reminder text', value: d.label }); if (v) { d.label = v; drawLabels(); } } }, 'Other…'));
          drawLabels();
          sc.append(h('div.bk-tset', unit('h', tH), h('div.bk-colon', ':'), unit('m', tM)),
            h('div.bk-lbl', 'Repeat'), days,
            h('div.chips', [['Every day', []], ['Weekdays', [1, 2, 3, 4, 5]], ['Sun–Thu', [0, 1, 2, 3, 4]], ['Weekends', [5, 6]]].map(([n, ds]) => h('button.chip.bk-mini', { type: 'button', onclick: () => { d.days = [...ds]; drawDays(); } }, n))),
            h('div.bk-lbl', 'Say'), labels,
            h('div.bk-btns',
              h('button.pill.primary', { type: 'button', '--c': S.COLOR, onclick: () => {
                const list = S.reminders();
                const i = list.findIndex((x) => x.id === d.id);
                const r = { ...d, on: true, snoozeUntil: 0 };
                if (i >= 0) list[i] = r; else list.push(r);
                list.sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
                S.saveReminders(list); app.sfx('pop'); panel.close();
                const at = S.nextRing(r);
                if (at) { const mins = Math.ceil((at - Date.now()) / 60000); app.toast(`Reminder in ${Math.floor(mins / 60)} h ${mins % 60} min`); }
              } }, 'Save'),
              h('button.pill', { type: 'button', onclick: () => S.fire(d) }, 'Test'),
              existing ? h('button.pill.danger', { type: 'button', onclick: () => { S.saveReminders(S.reminders().filter((x) => x.id !== d.id)); panel.close(); } }, 'Delete') : null));
          body.append(sc);
        },
      });
    }

    // ================================================================ updates & keys
    const offs = [S.events.on('change', draw)];
    app.every(30000, draw);
    app.onKey((e) => {
      if (topPanel() || document.querySelector('.rk-ring')) return;
      if (page === 'shelf') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const i = SHELVES.findIndex((s) => s.id === shelf);
          shelf = SHELVES[(i + (e.key === 'ArrowRight' ? 1 : -1) + 3) % 3].id; app.sfx('tick'); drawShelf();
        } else if (e.key === '+' || e.key === 'a') addBook();
        return;
      }
      const b = cur();
      if (!b) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addBook(); } return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); cycle(e.key === 'ArrowRight' ? 1 : -1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stoppedAt(b); }
      else if (e.key === 's') showPage('shelf');
      else if (e.key === 'n') notesPanel(b);
    });
    showPage('main');
    return {
      destroy() { offs.forEach((f) => f()); window.removeEventListener('keydown', padKeys, true); },
      back() { if (page !== 'main') { showPage('main'); return true; } return false; },
    };
  },
};
