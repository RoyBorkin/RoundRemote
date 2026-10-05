// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Randomizer: a ring of little random tools — number, colour, letter (Latin / Hebrew), who goes first (a spinning
// wheel of names), teams, yes / no / maybe, pick from your own lists, and shuffle an order.
// Names and list items can be Hebrew: everything that shows them uses dir="auto".
import { h } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { curve, topPanel } from '../js/ui/overlay.js';
import { THEME } from '../games/kit.js';
import { nearestName, LATIN, HEBREW, DEFAULT_LISTS } from './random-data.js';

const TAU = Math.PI * 2;
const rnd = (n) => Math.floor(Math.random() * n);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hasRtl = (s) => /[֐-׿؀-ۿ]/.test(s);
const TEAM_COLORS = ['#ff5a6a', '#4d9bff', '#3ddc84', '#ffc857', '#b57bff', '#ff9f43'];
const TEAM_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange'];

const TOOLS = [
  { id: 'number', name: 'Number', blurb: 'Random numbers between a min and a max', color: '#22d3ee', glyph: '#' },
  { id: 'colour', name: 'Colour', blurb: 'A random colour with its hex, RGB and name', color: '#f472b6', glyph: '' },
  { id: 'letter', name: 'Letter', blurb: 'A random letter — English or Hebrew', color: '#a78bfa', glyph: 'Aא' },
  { id: 'picker', name: 'Who goes first?', blurb: 'Spin a wheel of your players’ names', color: '#fb7185', glyph: '' },
  { id: 'teams', name: 'Teams', blurb: 'Split your players into random teams', color: '#34d399', glyph: '' },
  { id: 'yesno', name: 'Yes or no', blurb: 'Ask a question, shake the ball', color: '#fbbf24', glyph: '?' },
  { id: 'list', name: 'Pick from a list', blurb: 'Your own lists — dinner, movies, chores…', color: '#60a5fa', glyph: '' },
  { id: 'shuffle', name: 'Shuffle', blurb: 'A random order for players or a list', color: '#fb923c', glyph: '' },
];
const WHEEL_ICON = 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm1 2.06V11h6.94A8 8 0 0 0 13 4.06zM11 4.06A8 8 0 0 0 4.06 11H11zM4.06 13A8 8 0 0 0 11 19.94V13zM13 19.94A8 8 0 0 0 19.94 13H13z';

export default {
  css: './random.css',
  create(el, app) {
    const openPanel = (o) => { const p = app.openPanel(o); p.el.style.setProperty('--ac', app.meta.color); return p; };
    let sel = Math.max(0, TOOLS.findIndex((t) => t.id === app.data('tool', 'number')));
    let open = null;       // the open tool { id, el, key?, frame?, destroy? }
    const players = () => app.data('players', []);
    const setPlayers = (p) => app.save('players', p);
    const lists = () => app.data('lists', DEFAULT_LISTS);
    const setLists = (l) => app.save('lists', l);

    // ================================================================ the ring of tools
    const ring = h('div.rn-ring');
    const items = TOOLS.map((t, i) => {
      const a = ((i + 0.5) / TOOLS.length) * TAU;   // half a step round, so nothing sits under Back
      const b = h('button.rn-item', { type: 'button', 'aria-label': t.name, '--c': t.color, dataset: { id: t.id },
        style: { left: `${50 + 38 * Math.sin(a)}%`, top: `${50 - 38 * Math.cos(a)}%` },
        onclick: (e) => { e.stopPropagation(); if (sel === i) openTool(t.id); else select(i); } });
      b.innerHTML = glyph(t);
      ring.append(b);
      return b;
    });
    function glyph(t) {
      if (t.id === 'colour') return '<span class="rn-g-colour"></span>';
      if (t.id === 'picker') return `<svg class="ic" viewBox="0 0 24 24"><path d="${WHEEL_ICON}"/></svg>`;
      if (t.id === 'teams') return icon('people');
      if (t.id === 'list') return icon('list');
      if (t.id === 'shuffle') return icon('shuffle');
      return `<span class="rn-g">${t.glyph}</span>`;
    }
    const cName = h('div.rn-cname'), cBlurb = h('div.rn-cblurb');
    const cBadge = h('div.rn-cbadge');
    const openBtn = h('button.pill.primary.rn-open', { type: 'button', onclick: () => openTool(TOOLS[sel].id) }, 'Open');
    const center = h('div.rn-center', cBadge, cName, cBlurb, openBtn);
    const hub = h('div.rn-hub', ring, center);
    const page = h('div.rn-page');
    const root = h('div.rn', hub, page);
    el.append(root);

    function select(i, quiet = false) {
      sel = (i + TOOLS.length) % TOOLS.length;
      const t = TOOLS[sel];
      items.forEach((b, j) => b.classList.toggle('on', j === sel));
      root.style.setProperty('--tc', t.color);
      cBadge.innerHTML = glyph(t);
      cName.textContent = t.name; cBlurb.textContent = t.blurb;
      center.classList.remove('swap'); void center.offsetWidth; center.classList.add('swap');
      app.save('tool', t.id);
      if (!quiet) app.sfx('tick');
    }
    hub.addEventListener('wheel', (e) => { e.preventDefault(); select(sel + Math.sign(e.deltaY || e.deltaX)); }, { passive: false });

    function openTool(id) {
      const t = TOOLS.find((x) => x.id === id);
      closeTool(true);
      page.replaceChildren();
      root.style.setProperty('--tc', t.color);
      const builder = { number: toolNumber, colour: toolColour, letter: toolLetter, picker: toolPicker, teams: toolTeams, yesno: toolYesNo, list: toolList, shuffle: toolShuffle }[id];
      open = { id, ...builder(page) };
      root.classList.add('tool-open');
      app.setTitle(t.name); app.hideTitle(false);
      app.sfx('tap');
    }
    function closeTool(quiet = false) {
      if (!open) return;
      try { open.destroy?.(); } catch {}
      open = null;
      root.classList.remove('tool-open');
      root.style.setProperty('--tc', TOOLS[sel].color);
      app.setTitle(); app.hideTitle(true);
      if (!quiet) setTimeout(() => { if (!open) page.replaceChildren(); }, 300);
    }

    // ---------------------------------------------------------------- shared bits
    const btn = (label, onClick, cls = '') => h(`button.rn-go${cls ? '.' + cls : ''}`, { type: 'button', onclick: onClick }, label);
    function rollText(elm, pickFn, done, { ms = 700, step = 45 } = {}) {
      // slot-machine style: show random values, slowing down, then the result
      const t0 = performance.now();
      let next = 0, stopped = false;
      const tick = (now) => {
        if (stopped) return;
        const p = (now - t0) / ms;
        if (p >= 1) { done(); return; }
        if (now >= next) { pickFn(); next = now + step + p * p * 160; app.sfx('tick', { volume: 0.5 }); }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return () => { stopped = true; };
    }
    const bump = (elm) => { elm.classList.remove('bump'); void elm.offsetWidth; elm.classList.add('bump'); };

    function editItems({ title, get, set, addLabel = 'Add', placeholder = '', max = 40 }) {
      openPanel({
        title, className: 'rn-panel',
        build(body) {
          const list = h('div.list.rn-elist');
          const add = h('button.pill.primary.rn-add', { type: 'button', onclick: async () => {
            const v = await app.editText({ title: addLabel, placeholder, okLabel: 'Add' });
            if (!v) return;
            const cur = get();
            if (cur.length >= max) { app.toast(`Up to ${max}`); return; }
            const parts = v.split(/\s*,\s*/).filter(Boolean);      // "Dana, Noa, Avi" adds three
            set([...cur, ...parts].slice(0, max)); draw(); app.sfx('pop');
          } }, h('i', { html: icon('plus') }), addLabel);
          const draw = () => {
            const cur = get();
            list.replaceChildren(...cur.map((name, i) => h('div.rn-erow',
              h('button.rn-ename', { type: 'button', dir: 'auto', onclick: async () => {
                const v = await app.editText({ title: 'Edit', value: name, okLabel: 'Save' });
                if (v === null) return;
                const c = get(); if (v) c[i] = v; else c.splice(i, 1); set([...c]); draw();
              } }, name),
              h('button.rn-edel', { type: 'button', 'aria-label': `Remove ${name}`, onclick: () => { const c = get(); c.splice(i, 1); set([...c]); draw(); app.sfx('tap'); } }, h('i', { html: icon('close') })))));
            if (!cur.length) list.append(h('div.empty', 'Nothing here yet — tap Add.'));
          };
          body.append(add, list); curve(list); draw();
        },
        onClose: () => open?.refresh?.(),
      });
    }
    const editPlayers = () => editItems({ title: 'Players', get: players, set: setPlayers, addLabel: 'Add player', placeholder: 'Name (or several: Dana, Noa, Avi)', max: 24 });
    function needPlayers(container, min, what) {
      if (players().length >= min) return false;
      container.append(h('div.rn-need', h('i', { html: icon('people') }),
        h('div.rn-need-t', `Add at least ${min} players`), h('div.rn-need-s', what),
        h('button.pill.primary', { type: 'button', onclick: editPlayers }, 'Add players')));
      return true;
    }

    // ================================================================ Number
    function toolNumber(pg) {
      const st = app.data('number', { min: 1, max: 100, count: 1, unique: true });
      const out = h('button.rn-num', { type: 'button', 'aria-label': 'Roll', onclick: () => roll() });
      const minB = h('button.rn-val', { type: 'button', onclick: () => edit('min') });
      const maxB = h('button.rn-val', { type: 'button', onclick: () => edit('max') });
      const presets = h('div.chips.rn-chips', [[1, 6], [1, 10], [1, 100], [0, 9]].map(([a, b]) => h('button.chip', { type: 'button', onclick: () => { st.min = a; st.max = b; save(); } }, `${a}–${b}`)));
      const cnt = h('div.rn-cnt');
      const minus = h('button.ibtn.small', { type: 'button', 'aria-label': 'Fewer', html: icon('minus'), onclick: () => { st.count = Math.max(1, st.count - 1); save(); } });
      const plus = h('button.ibtn.small', { type: 'button', 'aria-label': 'More', html: icon('plus'), onclick: () => { st.count = Math.min(12, st.count + 1); save(); } });
      const uniq = h('button.chip', { type: 'button', onclick: () => { st.unique = !st.unique; save(); } }, 'No repeats');
      const go = btn('Roll', () => roll());
      pg.append(h('div.rn-tool.rn-number', out,
        h('div.rn-range', h('span.rn-lbl', 'from'), minB, h('span.rn-lbl', 'to'), maxB), presets,
        h('div.rn-line', minus, cnt, plus, uniq), go));
      let result = app.data('numberLast', null);
      async function edit(k) {
        const v = await app.editText({ title: k === 'min' ? 'Smallest number' : 'Largest number', value: String(st[k]), okLabel: 'Set' });
        if (v === null) return;
        const n = parseInt(v.replace(/[^\d-]/g, ''), 10);
        if (!Number.isFinite(n)) { app.toast('That’s not a number'); return; }
        st[k] = Math.max(-1e9, Math.min(1e9, n));
        save();
      }
      function save() {
        if (st.min > st.max) [st.min, st.max] = [st.max, st.min];
        app.save('number', st); draw();
      }
      const pick = () => {
        const n = st.max - st.min + 1;
        const c = st.unique ? Math.min(st.count, n) : st.count;
        if (st.unique && n <= 2000) return shuffle(Array.from({ length: n }, (_, i) => st.min + i)).slice(0, c);
        const set = new Set(), res = [];
        while (res.length < c) { const v = st.min + rnd(n); if (st.unique && set.has(v)) continue; set.add(v); res.push(v); }
        return res;
      };
      const show = (vals, final = false) => {
        out.classList.toggle('many', vals.length > 1); out.classList.toggle('lots', vals.length > 4);
        out.replaceChildren(...vals.map((v) => h('span', v.toLocaleString('en-US'))));
        if (final) bump(out);
      };
      let stop = null;
      function roll() {
        stop?.();
        if (st.unique && st.count > st.max - st.min + 1) app.toast(`Only ${st.max - st.min + 1} different numbers in that range`);
        stop = rollText(out, () => show(pick()), () => { result = pick(); show(result, true); app.save('numberLast', result); app.sfx('score'); });
      }
      function draw() {
        minB.textContent = st.min.toLocaleString('en-US'); maxB.textContent = st.max.toLocaleString('en-US');
        cnt.replaceChildren(h('b', String(st.count)), st.count === 1 ? ' number' : ' numbers');
        uniq.classList.toggle('on', st.unique); uniq.hidden = st.count === 1;
        presets.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', [[1, 6], [1, 10], [1, 100], [0, 9]][i][0] === st.min && [[1, 6], [1, 10], [1, 100], [0, 9]][i][1] === st.max));
      }
      draw();
      show(result || ['?']);
      return { key: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); roll(); } }, destroy: () => stop?.() };
    }

    // ================================================================ Colour
    function toolColour(pg) {
      let cur = app.data('colourLast', null);
      let past = app.data('colours', []);
      const sw = h('button.rn-swatch', { type: 'button', 'aria-label': 'New colour', onclick: () => roll() });
      const hexEl = h('div.rn-hex'), rgbEl = h('div.rn-rgb'), nameEl = h('div.rn-cname2');
      sw.append(hexEl, rgbEl, nameEl);
      const pastRow = h('div.rn-past');
      const copy = h('button.ibtn.rn-copy', { type: 'button', 'aria-label': 'Copy the hex code', html: icon('stack'), onclick: () => doCopy() });
      const go = btn('New colour', () => roll());
      pg.append(h('div.rn-tool.rn-colour', sw, pastRow, copy, go));
      const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      const randomColour = () => {
        // pleasant random colours: random hue, varied but not muddy saturation / lightness
        const hh = Math.random() * 360, s = 0.45 + Math.random() * 0.5, l = 0.3 + Math.random() * 0.45;
        const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l);
        const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
        return Math.random() < 0.25 ? [rnd(256), rnd(256), rnd(256)] : [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
      };
      const paint = (c, final) => {
        sw.style.setProperty('--sw', hex(c));
        const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
        sw.classList.toggle('dark-ink', lum > 0.58);
        hexEl.textContent = hex(c);
        rgbEl.textContent = `rgb(${c.join(', ')})`;
        if (final) { const nm = nearestName(c); nameEl.textContent = nm.exact ? nm.name : `≈ ${nm.name}`; } else nameEl.textContent = '';
      };
      const drawPast = () => pastRow.replaceChildren(...past.map((c) => h('button.rn-dot', { type: 'button', 'aria-label': hex(c), style: { background: hex(c) },
        onclick: () => { cur = c; paint(c, true); app.save('colourLast', c); app.sfx('tap'); } })));
      let stop = null;
      function roll() {
        stop?.();
        stop = rollText(sw, () => paint(randomColour(), false), () => {
          cur = randomColour(); paint(cur, true); bump(sw);
          past = [cur, ...past.filter((x) => hex(x) !== hex(cur))].slice(0, 7);
          app.save('colourLast', cur); app.save('colours', past); drawPast(); app.sfx('pop');
        }, { ms: 600, step: 50 });
      }
      async function doCopy() {
        if (!cur) return;
        const text = hex(cur);
        try { await navigator.clipboard.writeText(text); }
        catch {
          const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
          document.body.append(ta); ta.select();
          try { document.execCommand('copy'); } catch {}
          ta.remove();
        }
        app.toast(`Copied ${text}`); app.sfx('coin');
      }
      if (cur) paint(cur, true); else paint([128, 128, 128], false), hexEl.textContent = 'Tap me';
      drawPast();
      return { key: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); roll(); } else if (e.key === 'c') doCopy(); }, destroy: () => stop?.() };
    }

    // ================================================================ Letter
    function toolLetter(pg) {
      const st = app.data('letter', { abc: 'latin', last: [] });
      const card = h('button.rn-letter', { type: 'button', 'aria-label': 'New letter', onclick: () => roll() });
      const lastRow = h('div.rn-lastletters');
      const chips = h('div.chips.rn-chips');
      const go = btn('New letter', () => roll());
      pg.append(h('div.rn-tool.rn-lettertool', card, lastRow, chips, go));
      const abc = () => (st.abc === 'hebrew' ? HEBREW : LATIN);
      const drawChips = () => chips.replaceChildren(...[['latin', 'A – Z'], ['hebrew', 'א – ת']].map(([id, n]) => h(`button.chip${st.abc === id ? '.on' : ''}`, { type: 'button',
        onclick: () => { st.abc = id; st.last = []; app.save('letter', st); drawChips(); card.textContent = '?'; drawLast(); app.sfx('tick'); } }, n)));
      const drawLast = () => lastRow.replaceChildren(...st.last.map((l) => h('span', { dir: 'auto' }, l)));
      let stop = null;
      function roll() {
        stop?.();
        card.classList.add('spin');
        stop = rollText(card, () => { card.textContent = abc()[rnd(abc().length)]; }, () => {
          card.classList.remove('spin');
          // avoid repeating the last few letters
          const pool = abc().filter((l) => !st.last.slice(0, Math.min(6, abc().length - 1)).includes(l));
          const l = pool[rnd(pool.length)];
          card.textContent = l; bump(card);
          st.last = [l, ...st.last].slice(0, 8); app.save('letter', st); drawLast(); app.sfx('pop');
        }, { ms: 650, step: 40 });
      }
      card.textContent = st.last[0] || '?';
      drawChips(); drawLast();
      return { key: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); roll(); } }, destroy: () => stop?.() };
    }

    // ================================================================ Who goes first (spinning wheel)
    function toolPicker(pg) {
      const wrap = h('div.rn-tool.rn-picker');
      pg.append(wrap);
      let angle = 0, vel = 0, spinning = false, lastIdx = -1, names = [], canvas, ctx, wheel, result, pointer;
      const build = () => {
        wrap.replaceChildren();
        names = players();
        if (needPlayers(wrap, 2, 'Add the names of everyone playing, then spin the wheel to see who goes first.')) return;
        canvas = h('canvas.rn-wheelcv');
        wheel = h('div.rn-wheel', canvas);
        pointer = h('div.rn-pointer');
        const hubB = h('button.rn-spin', { type: 'button', onclick: () => spin() }, 'SPIN');
        result = h('div.rn-result', { dir: 'auto' });
        wrap.append(wheel, pointer, hubB, result, h('button.pill.small.rn-edit', { type: 'button', onclick: editPlayers }, h('i', { html: icon('people') }), 'Players'));
        requestAnimationFrame(drawWheel);
      };
      function drawWheel() {
        if (!canvas) return;
        // its layout size (also right when the app is turned: js/core/orientation.js)
        const dpr = Math.min(2, window.devicePixelRatio || 1), S = canvas.clientWidth;
        if (!S) return;
        canvas.width = canvas.height = Math.round(S * dpr);
        ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const n = names.length, R = S / 2, seg = TAU / n;
        for (let i = 0; i < n; i++) {
          const a0 = -Math.PI / 2 + i * seg;
          ctx.beginPath(); ctx.moveTo(R, R); ctx.arc(R, R, R - 2, a0, a0 + seg); ctx.closePath();
          ctx.fillStyle = THEME.pieces[i % THEME.pieces.length];
          if (n % THEME.pieces.length === 1 && i === n - 1) ctx.fillStyle = THEME.pieces[3];
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5; ctx.stroke();
          // name, along the radius
          ctx.save();
          ctx.translate(R, R); ctx.rotate(a0 + seg / 2);
          const name = names[i];
          const fs = Math.max(10, Math.min(R * 0.13, (R * 0.7) / Math.max(4, name.length) * 1.5, R * seg * 0.42));
          ctx.font = `800 ${fs}px ${THEME.display}`;
          ctx.fillStyle = '#121212'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
          ctx.direction = hasRtl(name) ? 'rtl' : 'ltr';
          let txt = name;
          while (ctx.measureText(txt).width > R * 0.68 && txt.length > 2) txt = txt.slice(0, -2) + '…';
          ctx.fillText(txt, R * 0.9, 0);
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(R, R, R - 2, 0, TAU); ctx.lineWidth = 3; ctx.strokeStyle = THEME.ink(0.25); ctx.stroke();
        canvas.style.transform = `rotate(${angle}rad)`;
      }
      const idxAt = () => { const n = names.length, seg = TAU / n; const a = ((-angle % TAU) + TAU) % TAU; return Math.floor(a / seg) % n; };
      function spin() {
        if (spinning || names.length < 2) return;
        spinning = true; vel = 13 + Math.random() * 9;
        result.classList.remove('show');
        app.sfx('whoosh');
      }
      const frame = (dt) => {
        if (!spinning || !wheel) return;
        vel *= Math.exp(-0.75 * dt); vel -= 1.4 * dt;
        if (vel <= 0) {
          vel = 0; spinning = false;
          const w = names[idxAt()];
          result.replaceChildren(h('small', 'goes first'), h('b', { dir: 'auto' }, w));
          result.classList.add('show');
          app.sfx('win'); app.vibrate(30);
          return;
        }
        angle += vel * dt;
        canvas.style.transform = `rotate(${angle}rad)`;
        const i = idxAt();
        if (i !== lastIdx) { lastIdx = i; app.sfx('tick', { volume: 0.7 }); pointer.classList.remove('kick'); void pointer.offsetWidth; pointer.classList.add('kick'); }
      };
      build();
      const ro = new ResizeObserver(() => drawWheel()); ro.observe(wrap);
      return {
        frame, refresh: build,
        key: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); spin(); } },
        destroy: () => ro.disconnect(),
      };
    }

    // ================================================================ Teams
    function toolTeams(pg) {
      const st = app.data('teams', { n: 2, last: null });
      const wrap = h('div.rn-tool.rn-teams');
      pg.append(wrap);
      const build = () => {
        wrap.replaceChildren();
        if (needPlayers(wrap, 2, 'Add everyone who’s playing, then split them into teams.')) return;
        const nEl = h('div.rn-tn');
        const minus = h('button.ibtn.small', { type: 'button', 'aria-label': 'Fewer teams', html: icon('minus'), onclick: () => setN(st.n - 1) });
        const plus = h('button.ibtn.small', { type: 'button', 'aria-label': 'More teams', html: icon('plus'), onclick: () => setN(st.n + 1) });
        const grid = h('div.rn-tgrid');
        wrap.append(h('div.rn-line.rn-tline', minus, nEl, plus), grid,
          btn('Make teams', () => make()), h('button.ibtn.small.rn-pedit', { type: 'button', 'aria-label': 'Players', html: icon('people'), onclick: editPlayers }));
        const setN = (n) => { st.n = Math.max(2, Math.min(6, Math.min(n, players().length))); app.save('teams', st); nEl.replaceChildren(h('b', String(st.n)), ' teams'); app.sfx('tick'); };
        const show = (teams, anim) => {
          grid.dataset.n = teams.length;
          grid.replaceChildren(...teams.map((t, i) => h('div.rn-team', { '--c': TEAM_COLORS[i], style: anim ? { animationDelay: `${i * 90}ms` } : {} },
            h('div.rn-tname', TEAM_NAMES[i]),
            h('div.rn-tmembers', t.map((p) => h('span', { dir: 'auto' }, p))))));
          if (anim) grid.classList.add('anim'); else grid.classList.remove('anim');
        };
        const make = () => {
          const ps = shuffle(players()), teams = Array.from({ length: st.n }, () => []);
          ps.forEach((p, i) => teams[i % st.n].push(p));
          st.last = teams; app.save('teams', st);
          grid.classList.remove('anim'); void grid.offsetWidth;
          show(teams, true); app.sfx('win');
        };
        setN(st.n);
        const valid = st.last && st.last.flat().length === players().length && st.last.flat().every((p) => players().includes(p)) && st.last.length === st.n;
        if (valid) show(st.last, false); else grid.replaceChildren(h('div.rn-thint', `${players().length} players — tap “Make teams”`));
        wrap.make = make;
      };
      build();
      return { refresh: build, key: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wrap.make?.(); } } };
    }

    // ================================================================ Yes / no / maybe
    function toolYesNo(pg) {
      const st = app.data('yesno', { maybe: true });
      const ans = h('div.rn-ans', { dir: 'auto' });
      const ball = h('button.rn-ball', { type: 'button', 'aria-label': 'Shake', onclick: () => ask() }, h('div.rn-window', ans));
      const chip = h('button.chip', { type: 'button', onclick: () => { st.maybe = !st.maybe; app.save('yesno', st); chip.classList.toggle('on', st.maybe); } }, 'Include “Maybe”');
      chip.classList.toggle('on', st.maybe);
      pg.append(h('div.rn-tool.rn-yesno', h('div.rn-q', 'Ask a question… then shake the ball'), ball, chip));
      ans.textContent = '?';
      let busy = false;
      function ask() {
        if (busy) return;
        busy = true;
        ans.classList.remove('show'); ball.classList.remove('shake'); void ball.offsetWidth; ball.classList.add('shake');
        app.sfx('whoosh');
        setTimeout(() => {
          const opts = st.maybe ? ['yes', 'no', 'maybe'] : ['yes', 'no'];
          const a = opts[rnd(opts.length)];
          ans.textContent = { yes: 'YES', no: 'NO', maybe: 'MAYBE' }[a];
          ans.dataset.a = a;
          ans.classList.add('show'); ball.classList.remove('shake');
          app.sfx(a === 'yes' ? 'win' : a === 'no' ? 'over' : 'pop');
          busy = false;
        }, 900);
      }
      return { key: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ask(); } } };
    }

    // ================================================================ Pick from a list
    function toolList(pg) {
      const st = app.data('listTool', { id: lists()[0]?.id, unique: false, used: {} });
      const wrap = h('div.rn-tool.rn-listtool');
      pg.append(wrap);
      const cur = () => lists().find((l) => l.id === st.id) || lists()[0] || null;
      const save = () => app.save('listTool', st);
      let stop = null;
      const build = () => {
        wrap.replaceChildren();
        const L = cur();
        const pickBtn = h('button.rn-listpick', { type: 'button', onclick: () => chooseList() }, h('span', { dir: 'auto' }, L ? L.name : 'Make a list'), h('i', { html: icon('chevron') }));
        wrap.append(pickBtn);
        if (!L) { wrap.append(h('div.rn-need', h('div.rn-need-s', 'Make a list of things to choose from.'), h('button.pill.primary', { type: 'button', onclick: () => newList() }, 'New list'))); return; }
        st.id = L.id;
        const used = st.used[L.id] || [];
        const pool = () => (st.unique ? L.items.filter((x) => !(st.used[L.id] || []).includes(x)) : L.items);
        const reel = h('button.rn-reel', { type: 'button', dir: 'auto', 'aria-label': 'Pick', onclick: () => pick() }, h('span', { dir: 'auto' }, st.lastPick?.[L.id] || '?'));
        const info = h('div.rn-linfo');
        const uniq = h('button.chip', { type: 'button', onclick: () => { st.unique = !st.unique; st.used[L.id] = []; save(); drawInfo(); } }, 'No repeats');
        const edit = h('button.pill.small.rn-ledit', { type: 'button', onclick: () => editItems({ title: L.name, get: () => cur().items, set: (items) => { setLists(lists().map((x) => (x.id === L.id ? { ...x, items } : x))); }, addLabel: 'Add item', placeholder: 'Item (or several: a, b, c)', max: 60 }) }, h('i', { html: icon('edit') }), 'Edit items');
        const drawInfo = () => {
          const left = pool().length;
          info.textContent = st.unique ? `${left} of ${L.items.length} left` : `${L.items.length} items`;
          uniq.classList.toggle('on', st.unique);
        };
        wrap.append(reel, h('div.rn-line', info, uniq), edit, btn('Pick', () => pick()));
        drawInfo();
        function pick() {
          stop?.();
          if (!L.items.length) { app.toast('This list is empty — add some items'); return; }
          let p = pool();
          if (!p.length) { st.used[L.id] = []; p = L.items; app.toast('All picked — starting over'); }
          const span = reel.firstChild;
          reel.classList.add('rolling');
          stop = rollText(reel, () => { span.textContent = L.items[rnd(L.items.length)]; }, () => {
            reel.classList.remove('rolling');
            const v = p[rnd(p.length)];
            span.textContent = v; bump(reel);
            if (st.unique) st.used[L.id] = [...(st.used[L.id] || []), v];
            st.lastPick = { ...(st.lastPick || {}), [L.id]: v };
            save(); drawInfo(); app.sfx('win');
          }, { ms: 900, step: 55 });
        }
        wrap.pick = pick;
        void used;
      };
      function newList() {
        app.editText({ title: 'New list', placeholder: 'List name', okLabel: 'Create' }).then((name) => {
          if (!name) return;
          const l = { id: `l${Date.now().toString(36)}`, name, items: [] };
          setLists([...lists(), l]); st.id = l.id; save(); build();
          editItems({ title: name, get: () => lists().find((x) => x.id === l.id).items, set: (items) => setLists(lists().map((x) => (x.id === l.id ? { ...x, items } : x))), addLabel: 'Add item', placeholder: 'Item (or several: a, b, c)', max: 60 });
        });
      }
      function chooseList() {
        openPanel({
          title: 'Lists', className: 'rn-panel',
          build(body, panel) {
            const list = h('div.list.rn-elist');
            const draw = () => list.replaceChildren(...lists().map((l) => h(`div.rn-erow${l.id === st.id ? '.on' : ''}`,
              h('button.rn-ename', { type: 'button', dir: 'auto', onclick: () => { st.id = l.id; save(); panel.close(); build(); app.sfx('tick'); } },
                h('span', { dir: 'auto' }, l.name), h('small', `${l.items.length} items`)),
              h('button.rn-edel', { type: 'button', 'aria-label': `Rename ${l.name}`, html: icon('edit'), onclick: async () => {
                const v = await app.editText({ title: 'Rename list', value: l.name, okLabel: 'Save' });
                if (v) { setLists(lists().map((x) => (x.id === l.id ? { ...x, name: v } : x))); draw(); build(); }
              } }),
              h('button.rn-edel', { type: 'button', 'aria-label': `Delete ${l.name}`, html: icon('close'), onclick: () => {
                setLists(lists().filter((x) => x.id !== l.id)); draw(); build(); app.sfx('drop');
              } }))));
            body.append(h('button.pill.primary.rn-add', { type: 'button', onclick: () => { panel.close(); newList(); } }, h('i', { html: icon('plus') }), 'New list'), list);
            curve(list); draw();
          },
        });
      }
      build();
      return { refresh: build, key: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wrap.pick?.(); } }, destroy: () => stop?.() };
    }

    // ================================================================ Shuffle
    function toolShuffle(pg) {
      const st = app.data('shuffleTool', { src: 'players' });
      const wrap = h('div.rn-tool.rn-shuffle');
      pg.append(wrap);
      const srcItems = () => (st.src === 'players' ? players() : lists().find((l) => l.id === st.src)?.items || []);
      const build = () => {
        wrap.replaceChildren();
        const srcs = [{ id: 'players', name: 'Players' }, ...lists().map((l) => ({ id: l.id, name: l.name }))];
        if (!srcs.find((s) => s.id === st.src)) st.src = 'players';
        const chips = h('div.rn-srcs', srcs.map((s) => h(`button.chip${s.id === st.src ? '.on' : ''}`, { type: 'button', dir: 'auto', onclick: () => { st.src = s.id; st.last = null; app.save('shuffleTool', st); build(); } }, s.name)));
        const out = h('div.rn-order');
        wrap.append(chips, out);
        const items = srcItems();
        if (items.length < 2) {
          out.append(h('div.rn-thint', st.src === 'players' ? 'Add at least 2 players' : 'This list needs at least 2 items'),
            h('button.pill.small', { type: 'button', onclick: st.src === 'players' ? editPlayers : () => openTool('list') }, st.src === 'players' ? 'Add players' : 'Edit the list'));
          return;
        }
        const show = (order, anim) => {
          out.classList.toggle('anim', anim); out.classList.toggle('cols', order.length > 7);
          out.replaceChildren(...order.map((x, i) => h('div.rn-oitem', { style: anim ? { animationDelay: `${i * 70}ms` } : {} }, h('b', String(i + 1)), h('span', { dir: 'auto' }, x))));
        };
        const go = () => { const o = shuffle(items); st.last = o; app.save('shuffleTool', st); out.classList.remove('anim'); void out.offsetWidth; show(o, true); app.sfx('whoosh'); setTimeout(() => app.sfx('pop'), 300); };
        wrap.append(btn('Shuffle', go));
        if (st.last && st.last.length === items.length && st.last.every((x) => items.includes(x))) show(st.last, false); else show(items, false);
        wrap.go = go;
      };
      build();
      return { refresh: build, key: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wrap.go?.(); } } };
    }

    // ================================================================ keys, loop
    app.onKey((e) => {
      if (topPanel()) return;
      if (open) { open.key?.(e); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTool(TOOLS[sel].id); }
    });
    app.raf((dt) => open?.frame?.(dt));
    select(sel, true);
    app.hideTitle(true);

    return {
      destroy() { closeTool(true); },
      back() { if (open) { closeTool(); app.sfx('tap'); return true; } return false; },
    };
  },
};
