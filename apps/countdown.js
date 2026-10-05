// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Countdowns — days until birthdays, holidays, trips and anything you're looking forward to. The featured one sits
// on a round dial (days · hours · minutes · seconds, live) with confetti on the day; the list is sorted by soonest
// with big “days left” numbers. Yearly events show the age (“turns 31”, “5 years together”). Quick-add Jewish
// holidays (dates computed with the Hebrew calendar, no API) and common ones. Reminders N days before ring on any
// screen (countdown-store.js; Settings → Alerts, source 'countdown').
import { h } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { topPanel, curve } from '../js/ui/overlay.js';
import * as S from './countdown-store.js';
import { lic, ico, panel, form, lbl, note, chipRow, confirm, timeStepper, dateStepper, colorChips, ensureStyle, fmtDay, fmtTime, startOfDay, dayKey, COLORS } from './plants-ui.js';

const c = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
export const CI = {
  cake: 'M4 21h16M5 21v-7.5h14V21M5 17c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0M8 13.5V10M12 13.5V10M16 13.5V10M8 7.4c.7 0 1.1-.5 1.1-1.1S8 4.5 8 4.5 6.9 5.7 6.9 6.3s.4 1.1 1.1 1.1zM12 7.4c.7 0 1.1-.5 1.1-1.1S12 4.5 12 4.5s-1.1 1.2-1.1 1.8.4 1.1 1.1 1.1zM16 7.4c.7 0 1.1-.5 1.1-1.1S16 4.5 16 4.5s-1.1 1.2-1.1 1.8.4 1.1 1.1 1.1z',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  plane: 'M10.5 13.5 3 11l1.5-1.5 8 .5 4.5-4.5c.8-.8 2.2-.8 3 0s.8 2.2 0 3L15.5 13l.5 8-1.5 1.5-2.5-7.5-3.5 3.5.5 2.5-1 1-1.5-3-3-1.5 1-1 2.5.5z',
  gift: 'M4 11h16v10H4zM3 7.5h18V11H3zM12 7.5V21M12 7.5C10.5 4 7 3.5 7 5.6 7 7.4 10 7.5 12 7.5zM12 7.5c1.5-3.5 5-4 5-1.9 0 1.8-3 1.9-5 1.9z',
  party: 'M4 20.5 8.7 8.3l7 7zM8.2 9.5c1.3 2.4 3.6 5 6.3 6.3M14 3.5v2M19.5 9h2M17.7 5l-1.4 1.4M18.5 13.5l1.6.4M10.5 4.2l.6 1.6',
  calendar: 'M4 5.5h16V20H4zM4 10h16M8.5 3v4.5M15.5 3v4.5M8 14h2M8 17h2M12 14h2',
  grad: 'M2.5 9.5 12 5l9.5 4.5L12 14zM6.5 11.5v4.5c3 2.6 8 2.6 11 0v-4.5M21.5 9.5v5',
  baby: `${c(12, 13, 7.5)}M9.5 12.5h.01M14.5 12.5h.01M10 16c1.2.9 2.8.9 4 0M12 5.5c-.6-1.6.6-2.8 2-2.2`,
  ring: `${c(12, 14.5, 6)}M9 3.5h6l-1.5 3h-3zM10.5 6.5l-1 2.4M13.5 6.5l1 2.4`,
  menorah: 'M12 5v15M4.5 9v3.5a7.5 7.5 0 0 0 15 0V9M8.2 9v3.5a3.8 3.8 0 0 0 7.6 0V9M8 20.5h8M12 2.6v.01M4.5 6.6v.01M19.5 6.6v.01M8.2 6.6v.01M15.8 6.6v.01',
  tree: 'M12 2.8l5.2 6.2H14l4.2 5H15l4.5 5.5h-15L9 14H5.8L10 9H6.8zM12 19.5V22',
  pumpkin: 'M12 7.2c-4.6 0-8 3-8 6.8s3.4 6.6 8 6.6 8-2.8 8-6.6-3.4-6.8-8-6.8zM12 7.2c-1.7 1.6-2.4 4-2.4 6.8s.7 5 2.4 6.6c1.7-1.6 2.4-3.8 2.4-6.6s-.7-5.2-2.4-6.8zM12 7.2c0-2 1-3.4 2.6-4',
  apple: 'M12 7.6c-.6-2.2-2.4-3.2-2.4-3.2M12 8.4c-3.6-2.2-8-.4-8 4.4 0 4.8 3.3 8.5 5.8 8.5 1 0 1.4-.5 2.2-.5s1.2.5 2.2.5c2.5 0 5.8-3.7 5.8-8.5 0-4.8-4.4-6.6-8-4.4zM12.6 6.5c.6-1.6 2-2.4 3.6-2.2-.4 1.5-1.8 2.4-3.6 2.2z',
  david: 'M12 3l7.8 13.5H4.2zM12 21 4.2 7.5h15.6z',
  leaf: 'M5 19c0-8 5-13.5 14-14 0 9-5.5 14-14 14zM5 19l7-7',
  flag: 'M5 21V4M5 4.5c4-2 6 2 10 0s4-1 4-1v9s-1-1-4 1-6-2-10 0',
  flame: 'M12 21.5c-3.9 0-6.5-2.7-6.5-6.2 0-4.6 4.3-6.6 4.3-11.3 2.6 1.4 4.3 4.2 4.3 6.6.9-.5 1.6-1.6 1.7-2.8 1.7 1.6 2.7 4.3 2.7 6.9 0 3.9-2.7 6.8-6.5 6.8z',
  wheat: 'M12 21V8M12 8c-2-1-3-3-3-5 2 1 3 3 3 5zM12 8c2-1 3-3 3-5-2 1-3 3-3 5zM12 12.5c-2-1-3.5-2.6-3.5-4.6 2 .8 3.5 2.6 3.5 4.6zM12 12.5c2-1 3.5-2.6 3.5-4.6-2 .8-3.5 2.6-3.5 4.6zM12 17c-2-1-3.5-2.6-3.5-4.6 2 .8 3.5 2.6 3.5 4.6zM12 17c2-1 3.5-2.6 3.5-4.6-2 .8-3.5 2.6-3.5 4.6z',
  sun: `${c(12, 12, 4)}M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8`,
  music: 'M9 18.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM9 18.5V5l11-2v13M20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  ball: `${c(12, 12, 9)}M12 7.5l4.3 3.1-1.6 5h-5.4l-1.6-5zM12 3v4.5M16.3 10.6l4.3-1.4M14.7 15.6l2.6 3.6M9.3 15.6l-2.6 3.6M7.7 10.6 3.4 9.2`,
};
const ICONS = ['cake', 'heart', 'ring', 'baby', 'party', 'gift', 'plane', 'sun', 'grad', 'star', 'calendar', 'music', 'ball', 'tree', 'menorah', 'david', 'apple', 'pumpkin'];
const ci = (name, cls = '') => lic(CI[name] || CI.calendar, cls);

export default {
  css: './countdown.css',
  create(el, app) {
    ensureStyle();
    S.startCountdowns();
    const P = (o) => panel(o, S.COLOR);
    let page = 'dial';

    // ================================================================ the dial
    const svg = h('div.cd-ring', { html: `<svg viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="92" class="cd-track"/>
      <circle cx="100" cy="100" r="92" class="cd-arc" pathLength="1000" transform="rotate(-90 100 100)"/>
      <g class="cd-headg"><circle cx="100" cy="8" r="5.2" class="cd-head"/></g></svg>` });
    const arc = svg.querySelector('.cd-arc'), headG = svg.querySelector('.cd-headg');
    const photo = h('div.cd-photo');
    const icn = h('div.cd-icon');
    const name = h('button.cd-name', { type: 'button', dir: 'auto', onclick: () => { const ev = S.featured(); if (ev) eventPanel(ev); } });
    const big = h('div.cd-big');
    const cells = h('div.cd-cells');
    const dateEl = h('div.cd-date', { dir: 'auto' });
    const prev = h('button.cd-nav.prev', { type: 'button', 'aria-label': 'Previous', onclick: () => cycle(-1), html: icon('chevron') });
    const next = h('button.cd-nav', { type: 'button', 'aria-label': 'Next', onclick: () => cycle(1), html: icon('chevron') });
    const bList = h('button.cd-btn.l', { type: 'button', 'aria-label': 'All countdowns', title: 'All countdowns', onclick: () => showPage('list'), html: icon('list') });
    const bAdd = h('button.cd-btn.m', { type: 'button', 'aria-label': 'Add a countdown', title: 'Add', onclick: () => addPanel(), html: icon('plus') });
    const bHol = h('button.cd-btn.r', { type: 'button', 'aria-label': 'Holidays', title: 'Holidays', onclick: () => holidaysPanel(), html: ci('david') });
    const canvas = h('canvas.cd-confetti');
    const empty = h('div.cd-empty', h('div.cd-eic', { html: ci('calendar') }), h('div.cd-et', 'Something to look forward to?'),
      h('div.cd-em', 'Birthdays, trips, holidays — see the days count down.'),
      h('div.pk-btns', h('button.pill.primary', { type: 'button', onclick: () => addPanel() }, 'Add a countdown'), h('button.pill', { type: 'button', onclick: () => holidaysPanel() }, 'Holidays')));
    const dial = h('div.cd-page.cd-dial', photo, svg, canvas, icn, name, big, cells, dateEl, prev, next, empty, bList, bAdd, bHol);

    // ================================================================ the list
    const lHead = h('div.cd-lhead', 'Countdowns');
    const list = h('div.cd-list');
    curve(list);
    const lBack = h('button.cd-btn.l2', { type: 'button', 'aria-label': 'Dial', title: 'Dial', onclick: () => showPage('dial'), html: ci('calendar') });
    const lAdd = h('button.cd-btn.r2.primary', { type: 'button', 'aria-label': 'Add', title: 'Add', onclick: () => addPanel(), html: icon('plus') });
    const listPage = h('div.cd-page.cd-lp', { hidden: true }, lHead, list, lBack, lAdd);
    const root = h('div.cd.pk-scope', dial, listPage);
    app.hideTitle();
    el.append(root);

    function showPage(p) { page = p; root.dataset.page = p; app.sfx('tick'); draw(); }
    function cycle(d) {
      const s = S.sorted().map((x) => x.e);
      if (s.length < 2) return;
      const cur = S.featured();
      const i = s.findIndex((e) => e.id === cur?.id);
      S.setFeatured(s[(i + d + s.length) % s.length].id);
      app.sfx('tick');
    }

    // ---------------------------------------------------------------- drawing
    let shownId = null, wasToday = false;
    function draw() {
      if (page === 'list') { dial.hidden = true; listPage.hidden = false; drawList(); return; }
      dial.hidden = false; listPage.hidden = true;
      const ev = S.featured();
      const any = !!ev;
      for (const x of [svg, icn, name, big, cells, dateEl, bList, bHol, bAdd]) x.hidden = !any;
      empty.hidden = any;
      prev.hidden = next.hidden = S.list().length < 2;
      if (!ev) { photo.style.backgroundImage = ''; photo.classList.remove('on'); root.style.removeProperty('--ec'); return; }
      root.style.setProperty('--ec', ev.color || S.COLOR);
      icn.innerHTML = ci(ev.icon);
      name.textContent = ev.name;
      const at = S.nextAt(ev);
      const bits = [fmtDay(at, { year: new Date(at).getFullYear() !== new Date().getFullYear() || !ev.yearly })];
      if (ev.time) bits.push(fmtTime(at));
      const age = S.ageText(ev), eve = S.eveText(ev);
      if (age && S.daysLeft(ev) !== 0) bits.push(age);
      dateEl.replaceChildren(...[h('span', bits.join(' · ')), eve ? h('small', eve) : null].filter(Boolean));
      if (shownId !== ev.id) {
        shownId = ev.id;
        photo.classList.remove('on');
        photo.style.backgroundImage = '';
        if (ev.photo) { const img = new Image(); img.onload = () => { photo.style.backgroundImage = `url("${ev.photo}")`; photo.classList.add('on'); }; img.src = ev.photo; }
      }
      tickDraw();
    }
    function tickDraw() {
      if (page !== 'dial') return;
      const ev = S.featured();
      if (!ev) return;
      const now = Date.now();
      const at = S.nextAt(ev, now), d = S.daysLeft(ev, now);
      const today = d === 0 && (!ev.time || now >= at);
      const ms = Math.max(0, at - now);
      const past = d < 0;
      root.classList.toggle('today', today);
      root.classList.toggle('past', past);
      if (today) {
        big.replaceChildren(h('b.cd-tod', 'Today!'));
        const age = S.ageText(ev, now);
        cells.replaceChildren(h('span.cd-cele', age ? age[0].toUpperCase() + age.slice(1) : 'Celebrate!'));
        if (!wasToday) burst(1.4);
      } else if (past) {
        big.replaceChildren(h('b', String(-d)), h('span', -d === 1 ? 'day ago' : 'days ago'));
        cells.replaceChildren();
      } else {
        const D = Math.floor(ms / 864e5), Hh = Math.floor((ms % 864e5) / 36e5), M = Math.floor((ms % 36e5) / 6e4), Sx = Math.floor((ms % 6e4) / 1000);
        const showD = d;   // calendar days ("in 3 days")
        big.replaceChildren(h('b', String(showD)), h('span', showD === 1 ? 'day' : 'days'));
        const cell = (v, l) => h('div.cd-cell', h('b', String(v).padStart(2, '0')), h('span', l));
        cells.replaceChildren(cell(D, 'days'), cell(Hh, 'hours'), cell(M, 'min'), cell(Sx, 'sec'));
      }
      wasToday = today;
      const p0 = S.prevAt(ev, now);
      const f = past || today ? 1 : Math.max(0, Math.min(1, (now - p0) / (at - p0)));
      arc.style.strokeDasharray = `${(f * 1000).toFixed(1)} 1000`;
      headG.style.transform = `rotate(${(f * 360).toFixed(2)}deg)`;
      headG.style.opacity = f > 0.002 && f < 0.998 ? 1 : 0;
    }
    function drawList() {
      const now = Date.now();
      const s = S.sorted(now);
      if (!s.length) { list.replaceChildren(h('div.cd-none', 'No countdowns yet — add one with +.')); return; }
      const fid = S.featured()?.id;
      list.replaceChildren(...s.map(({ e, at, d }) => h(`button.cd-row${d < 0 ? '.past' : ''}${d === 0 ? '.now' : ''}${e.id === fid ? '.feat' : ''}`, { type: 'button', '--ec': e.color || S.COLOR, onclick: () => eventPanel(e) },
        h('div.cd-num', h('b', d === 0 ? '!' : String(Math.abs(d))), h('span', d === 0 ? 'today' : d < 0 ? 'ago' : d === 1 ? 'day' : 'days')),
        h('div.cd-rt', h('b', { dir: 'auto' }, e.name), h('small', { dir: 'auto' }, [fmtDay(at, { year: new Date(at).getFullYear() !== new Date(now).getFullYear() }), S.ageText(e, now)].filter(Boolean).join(' · '))),
        h('i.cd-ri', { html: ci(e.icon) }))));
    }

    // ---------------------------------------------------------------- confetti (only while it's falling)
    const cx = canvas.getContext('2d');
    let parts = [], confOn = false, offRaf = null;
    function burst(power = 1) {
      // its layout size (also right when the app is turned: js/core/orientation.js)
      const r = { width: canvas.clientWidth, height: canvas.clientHeight };
      const W = (canvas.width = Math.round(r.width)), H = (canvas.height = Math.round(r.height));
      if (!W) return;
      const cols = ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#facc15', '#14b8a6'];
      for (let i = 0; i < 110 * power; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
        const v = (0.55 + Math.random() * 0.75) * H * 1.15;
        parts.push({ x: W / 2 + (Math.random() - 0.5) * W * 0.25, y: H * 0.62, vx: Math.cos(a) * v * 0.6, vy: Math.sin(a) * v, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 12,
          w: H * (0.008 + Math.random() * 0.012), h: H * (0.016 + Math.random() * 0.016), c: cols[i % cols.length], life: 0 });
      }
      if (!confOn) { confOn = true; offRaf = app.raf(step); }
      app.sfx('perfect');
    }
    function step(dt) {
      const W = canvas.width, H = canvas.height;
      cx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += H * 1.25 * dt; p.vx *= 1 - 0.9 * dt; p.vy *= 1 - 0.5 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.life += dt;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.scale(1, Math.abs(Math.cos(p.r * 1.7)) + 0.15);
        cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.restore();
      }
      parts = parts.filter((p) => p.y < H + 30 && p.life < 6);
      if (!parts.length) { confOn = false; offRaf?.(); cx.clearRect(0, 0, W, H); }
    }
    big.addEventListener('click', () => { if (root.classList.contains('today')) burst(1); });

    // ================================================================ panels
    function eventPanel(e0) {
      P({
        title: '',
        className: 'cd-epanel',
        build(body, p) {
          const sc = form();
          const render = () => {
            const ev = S.byId(e0.id);
            if (!ev) { p.close(); return; }
            const now = Date.now(), at = S.nextAt(ev, now), d = S.daysLeft(ev, now);
            sc.replaceChildren(...[
              h('div.cd-pic', { '--ec': ev.color, html: ci(ev.icon) }),
              h('div.cd-pname', { dir: 'auto' }, ev.name),
              h('div.cd-pdays', d === 0 ? 'Today!' : d > 0 ? `${d} day${d === 1 ? '' : 's'} to go` : `${-d} day${d === -1 ? '' : 's'} ago`),
              note([fmtDay(at, { year: true }), ev.time ? fmtTime(at) : '', S.ageText(ev, now), S.eveText(ev, now)].filter(Boolean).join(' · ')),
              ev.remind?.length ? note(`Reminders: ${ev.remind.slice().sort((a, b) => b - a).map((n) => S.REMINDS.find((r) => r.id === n)?.name || `${n} days`).join(', ')} · ${S.remindAt()}`) : null,
              h('div.pk-btns',
                S.featured()?.id !== ev.id ? h('button.pill.primary', { type: 'button', onclick: () => { S.setFeatured(ev.id); p.close(); showPage('dial'); } }, 'Show on the dial') : null,
                h('button.pill', { type: 'button', onclick: () => editPanel(ev) }, 'Edit')),
              h('div.pk-btns', h('button.pill.small.danger', { type: 'button', onclick: () => confirm({ title: `Delete “${ev.name}”?`, msg: 'This countdown and its reminders go.', onYes: () => { S.remove(ev.id); p.close(); }, color: S.COLOR }) }, 'Delete')),
            ].filter(Boolean));
          };
          render();
          body.append(sc);
          p.onDestroy = S.events.on('change', render);
        },
      });
    }
    function addPanel() {
      P({
        title: 'New countdown',
        build(body, p) {
          body.append(form(
            lbl('What is it?'),
            h('div.cd-kinds', S.KINDS.map((k) => h('button.cd-kind', { type: 'button', onclick: () => { p.close(); editPanel(S.newEvent({ kind: k.id, icon: k.icon, yearly: !!k.yearly && k.id !== 'holiday', color: COLORS[S.list().length % COLORS.length] }), true); } },
              h('i', { html: ci(k.icon) }), h('span', k.name)))),
            h('div.pk-btns', h('button.pill', { type: 'button', onclick: () => { p.close(); holidaysPanel(); } }, h('span.pk-chipi', h('i', { html: ci('david') }), 'Holidays…')))));
        },
      });
    }
    function holidaysPanel() {
      P({
        title: 'Holidays',
        className: 'cd-hpanel',
        build(body, p) {
          const l = h('div.cd-list.inpanel');
          const render = () => {
            const now = Date.now();
            const have = new Set(S.list().map((e) => e.hol).filter(Boolean));
            const rows = S.HOLIDAYS.map((hd) => ({ hd, at: S.holidayNext(hd.id, now) })).filter((x) => x.at != null).sort((a, b) => a.at - b.at);
            l.replaceChildren(...rows.map(({ hd, at }) => {
              const d = Math.round((startOfDay(at) - startOfDay(now)) / 864e5);
              return h(`button.cd-row${have.has(hd.id) ? '.added' : ''}`, { type: 'button', '--ec': hd.color, onclick: () => {
                if (have.has(hd.id)) { const ev = S.list().find((e) => e.hol === hd.id); if (ev) eventPanel(ev); return; }
                const ev = S.put(S.fromHoliday(hd.id)); app.sfx('pop'); app.toast(`Added ${hd.name}`); render();
                if (!S.cData().featured) S.setFeatured(ev.id);
              } },
                h('div.cd-num', h('b', d === 0 ? '!' : String(d)), h('span', d === 0 ? 'today' : d === 1 ? 'day' : 'days')),
                h('div.cd-rt', h('b', hd.name, hd.he ? h('em', { dir: 'rtl', lang: 'he' }, hd.he) : null), h('small', [fmtDay(at, { year: true }), hd.eve ? `eve ${fmtDay(at - 864e5, { wd: true })}` : ''].filter(Boolean).join(' · '))),
                h('i.cd-ri', { html: have.has(hd.id) ? lic('M5 12.5l4.5 4.5L19 7.5') : icon('plus') }));
            }));
          };
          render();
          body.append(note('Jewish holidays begin at sunset the evening before.'), l);
          curve(l);
          p.onDestroy = S.events.on('change', render);
        },
      });
    }
    function editPanel(e0, isNew = false) {
      const d = JSON.parse(JSON.stringify(e0));
      P({
        title: isNew ? `New ${S.KINDS.find((k) => k.id === d.kind)?.name.toLowerCase() || 'countdown'}` : 'Edit countdown',
        build(body, p) {
          const sc = form();
          const render = () => {
            const isHol = !!d.hol;
            sc.replaceChildren(...[
              h('div.cd-pic', { '--ec': d.color, html: ci(d.icon) }),
              h('button.cd-namebtn', { type: 'button', dir: 'auto', onclick: async () => {
                const v = await app.editText({ title: 'Name', value: d.name, placeholder: d.kind === 'birthday' ? 'e.g. Mom’s birthday' : d.kind === 'trip' ? 'e.g. Trip to Rome' : 'e.g. Concert' }); if (v) { d.name = v; render(); }
              } }, d.name || 'Add a name', h('i', { html: ico('edit') })),
              isHol ? note(`${S.holidayById(d.hol)?.name} — its date is worked out every year.`) : null,
              isHol ? null : lbl(d.kind === 'birthday' ? 'Birthday' : d.kind === 'anniversary' ? 'The day' : 'Date'),
              isHol ? null : dateStepper(() => d.date, (v) => { d.date = v; }, { minYear: 1900, maxYear: 2100 }),
              isHol ? null : h('div.pk-row', h('span', 'Every year', h('small', d.kind === 'birthday' ? 'shows the age (“turns 31”)' : 'birthdays, anniversaries')),
                h(`button.switch${d.yearly ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(!!d.yearly), 'aria-label': 'Every year', onclick: () => { d.yearly = !d.yearly; render(); } })),
              !isHol && d.yearly && d.kind === 'birthday' ? h('div.pk-row', h('span', 'I don’t know the year'),
                h(`button.switch${d.noYear ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(!!d.noYear), 'aria-label': 'Year unknown', onclick: () => { d.noYear = !d.noYear; render(); } })) : null,
              h('div.pk-row', h('span', 'At a time', h('small', d.time ? '' : 'all day')),
                h(`button.switch${d.time ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(!!d.time), 'aria-label': 'At a time', onclick: () => { d.time = d.time ? '' : '18:00'; render(); } })),
              d.time ? timeStepper(() => d.time, (v) => { d.time = v; }) : null,
              lbl('Remind me'),
              chipRow(S.REMINDS, d.remind || [], (n) => { d.remind = (d.remind || []).includes(n) ? d.remind.filter((x) => x !== n) : [...(d.remind || []), n]; render(); }, { multi: true, cls: 'pk-mini' }),
              note(`At ${S.remindAt()} · rings here + Settings → Alerts`),
              lbl('Icon'),
              h('div.pk-icons', ICONS.map((n) => h(`button.pk-icn${d.icon === n ? '.on' : ''}`, { type: 'button', 'aria-label': n, onclick: () => { d.icon = n; render(); }, html: ci(n) }))),
              lbl('Colour'),
              colorChips(() => d.color, (col) => { d.color = col; render(); }),
              lbl('Photo'),
              h('div.pk-btns', h('button.pill.small', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Photo address (URL)', value: d.photo, placeholder: 'https://…' }); if (v !== null) { d.photo = v; render(); } } }, d.photo ? 'Change photo URL' : 'Add a photo URL'),
                d.photo ? h('button.pill.small', { type: 'button', onclick: () => { d.photo = ''; render(); } }, 'Remove') : null),
              h('div.pk-btns',
                h('button.pill.primary', { type: 'button', onclick: async () => {
                  if (!d.name) { const v = await app.editText({ title: 'Name', placeholder: 'Name' }); if (!v) return; d.name = v; }
                  S.put(d);
                  if (isNew) S.setFeatured(d.id);
                  app.sfx('pop'); p.close();
                  if (isNew) { app.toast(`Added “${d.name}”`); showPage('dial'); }
                } }, isNew ? 'Add' : 'Save'),
                isNew ? null : h('button.pill', { type: 'button', onclick: () => p.close() }, 'Cancel')),
              lbl('Reminder time (all countdowns)'),
              timeStepper(() => S.remindAt(), (v) => S.setRemindAt(v), { step: 15 }),
            ].filter(Boolean));
          };
          render();
          body.append(sc);
        },
      });
    }

    // ================================================================ updates & keys
    const offs = [S.events.on('change', draw)];
    app.every(1000, tickDraw);
    app.every(60000, draw);
    app.onKey((e) => {
      if (topPanel() || document.querySelector('.rk-ring')) return;
      if (page === 'list') { if (e.key === '+' || e.key === 'a') addPanel(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); cycle(e.key === 'ArrowRight' ? 1 : -1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const ev = S.featured(); if (!ev) addPanel(); else if (root.classList.contains('today')) burst(1); else eventPanel(ev); }
      else if (e.key === 'l') showPage('list');
      else if (e.key === 'h') holidaysPanel();
    });
    showPage('dial');
    return {
      destroy() { offs.forEach((f) => f()); },
      back() { if (page !== 'dial') { showPage('dial'); return true; } return false; },
    };
  },
};
