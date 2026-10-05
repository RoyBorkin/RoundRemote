// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Plants & Pets — care reminders for everyone you look after. Today is a round dial of what's due (late in red); tap
// one and Done (pick who did it), and it goes in the history. Profiles for each plant or pet with care tasks:
// daily at set times, weekly on chosen days, or every N days / weeks / months / years (medicine with its dose, vet,
// vaccinations…), with sensible presets per kind. The upcoming week, a streak, and reminders that ring on any screen
// (plants-store.js runs them; Snooze 1 hour). Optional Home Assistant soil-moisture sensor per plant.
import { h } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { topPanel, curve } from '../js/ui/overlay.js';
import * as S from './plants-store.js';
import { ico, lic, LI, panel, form, lbl, note, chipRow, confirm, timeStepper, dateStepper, numStepper, colorChips, pickEntities, ensureStyle,
  startOfDay, addDays, fmtDay, fmtTime, WD, dayKey, COLORS } from './plants-ui.js';
import { haReady, entityName, moistureFilter } from './plants-ha.js';

const KIND_ICON = { plant: 'plant', cat: 'cat', dog: 'dog', fish: 'fish', bird: 'bird', rabbit: 'rabbit', reptile: 'reptile', other: 'other' };
const kindName = (k) => S.KINDS.find((x) => x.id === k)?.name || 'Other';
const tIcon = (t) => ico(t?.type || 'task');

/** A pet / plant avatar: photo (when given and it loads) or its kind's icon on its colour. */
function avatar(p, cls = '') {
  const el = h(`div.pp-av${cls ? '.' + cls : ''}`, { '--pc': p?.color || S.COLOR, html: ico(KIND_ICON[p?.kind] || 'other') });
  if (p?.photo) {
    const img = h('img', { src: p.photo, alt: '', draggable: 'false', referrerpolicy: 'no-referrer' });
    img.addEventListener('load', () => el.classList.add('img'));
    img.addEventListener('error', () => img.remove());
    el.append(img);
  }
  return el;
}

export default {
  css: './plants.css',
  create(el, app) {
    ensureStyle();
    S.startPlants();
    const P = (o) => panel(o, S.COLOR);
    let page = 'today';
    let selKey = null;
    let items = [];

    // ================================================================ today (the dial)
    const ringSvg = h('div.pp-ring', { html: `<svg viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="93" class="pp-track"/>
      <circle cx="100" cy="100" r="93" class="pp-arc" pathLength="1000" transform="rotate(-90 100 100)"/></svg>` });
    const arc = ringSvg.querySelector('.pp-arc');
    const dots = h('div.pp-dots');
    const head = h('div.pp-head');
    const cAv = h('div.pp-cav');
    const cTask = h('div.pp-ctask', { dir: 'auto' });
    const cSub = h('div.pp-csub');
    const doneBtn = h('button.pp-done', { type: 'button', onclick: () => { const o = sel(); if (o) doDone(o); } });
    const navPets = h('button.pp-nav.l', { type: 'button', 'aria-label': 'Plants & pets', title: 'Plants & pets', onclick: () => showPage('pets'), html: ico('other') });
    const navWeek = h('button.pp-nav.m', { type: 'button', 'aria-label': 'This week', title: 'This week', onclick: () => showPage('week'), html: ico('week') });
    const navHist = h('button.pp-nav.r', { type: 'button', 'aria-label': 'History', title: 'History', onclick: () => showPage('history'), html: ico('history') });
    const centre = h('div.pp-centre', cAv, cTask, cSub, doneBtn);
    const empty = h('div.pp-empty');
    const todayPage = h('div.pp-page.pp-today', ringSvg, dots, head, centre, empty, navPets, navWeek, navHist);

    // ================================================================ list pages (week, pets, history)
    const lHead = h('div.pp-lhead');
    const list = h('div.pp-list');
    curve(list);
    const lLeft = h('button.pp-lbtn.l', { type: 'button' });
    const lRight = h('button.pp-lbtn.r', { type: 'button' });
    const listPage = h('div.pp-page.pp-lpage', { hidden: true }, lHead, list, lLeft, lRight);

    const root = h('div.pp.pk-scope', todayPage, listPage);
    app.hideTitle();
    el.append(root);

    const sel = () => items.find((o) => o.key === selKey) || null;
    function showPage(p) {
      page = p; root.dataset.page = p; app.sfx('tick');
      list.scrollTop = 0;
      draw();
    }

    function draw() {
      if (page === 'today') { todayPage.hidden = false; listPage.hidden = true; drawToday(); }
      else { todayPage.hidden = true; listPage.hidden = false; if (page === 'week') drawWeek(); else if (page === 'pets') drawPets(); else drawHistory(); }
    }

    // ---------------------------------------------------------------- today
    function drawToday() {
      const now = Date.now();
      items = S.today(now);
      const profs = S.profiles();
      const done = items.filter((o) => o.status === 'done').length;
      const f = items.length ? done / items.length : 0;
      arc.style.strokeDasharray = `${(f * 1000).toFixed(1)} 1000`;
      arc.style.opacity = f > 0.001 ? 1 : 0;
      const st = S.streak(now);
      const late = items.filter((o) => o.status === 'late').length;
      head.replaceChildren(...[
        h('b', items.length ? `${done} of ${items.length} done` : 'Today'),
        st.current ? h('span.pp-streak', { title: `${st.current}-day streak — everything done on time` }, h('i', { html: ico('flame') }), String(st.current)) : null,
        late ? h('span.pp-late', `${late} late`) : null].filter(Boolean));
      if (!profs.length) {
        dots.replaceChildren(); centre.hidden = true; empty.hidden = false; head.hidden = true;
        empty.replaceChildren(h('div.pp-eic', { html: ico('plant') }), h('div.pp-et', 'Who do you look after?'),
          h('div.pp-em', 'Add your plants and pets — watering, feeding, walks and medicine, with reminders.'),
          h('button.pill.primary', { type: 'button', onclick: () => editProfile(null) }, 'Add a plant or pet'));
        return;
      }
      head.hidden = false;
      if (!items.length) {
        dots.replaceChildren(); centre.hidden = true; empty.hidden = false;
        const nx = S.occurrences(addDays(startOfDay(now), 1), 7, now)[0];
        empty.replaceChildren(h('div.pp-eic.ok', { html: ico('check') }), h('div.pp-et', 'Nothing due today'),
          h('div.pp-em', { dir: 'auto' }, nx ? `Next: ${S.taskName(nx.task)} · ${nx.profile.name} — ${fmtDay(nx.at)} ${fmtTime(nx.at)}` : 'Add care tasks to your plants and pets.'),
          h('button.pill', { type: 'button', onclick: () => showPage('pets') }, 'Plants & pets'));
        return;
      }
      empty.hidden = true; centre.hidden = false;
      if (!sel()) selKey = (items.find((o) => o.status === 'late') || items.find((o) => o.status === 'due') || items.find((o) => o.status !== 'done') || items[0]).key;
      // dots around the rim, in time order (clockwise from the top right)
      const n = Math.min(items.length, 14);
      const step = n > 1 ? Math.min(40, 284 / (n - 1)) : 0;
      const start = 38;
      dots.replaceChildren(...items.slice(0, n).map((o, i) => {
        const a = ((start + step * i) * Math.PI) / 180;
        const b = h(`button.pp-dot.${o.status}${o.key === selKey ? '.sel' : ''}`, {
          type: 'button', '--pc': o.profile.color || S.COLOR, 'aria-label': `${S.taskName(o.task)} · ${o.profile.name} · ${o.status}`,
          style: { left: `${50 + Math.sin(a) * 39}%`, top: `${50 - Math.cos(a) * 39}%` },
          onclick: () => { if (selKey === o.key) doDone(o); else { selKey = o.key; app.sfx('tick'); drawToday(); } },
          html: tIcon(o.task) });
        if (o.status === 'done') b.append(h('i.pp-ck', { html: lic(LI.check) }));
        return b;
      }));
      const o = sel();
      cAv.replaceChildren(avatar(o.profile, 'mid'));
      cTask.textContent = `${S.taskName(o.task)}${o.task.dose ? ` · ${o.task.dose}` : ''}`;
      const when = o.status === 'done' ? `done ${fmtTime(o.done.at)}${o.done.who ? ` by ${o.done.who}` : ''}` : o.status === 'late' ? S.lateBy(o, now) : o.status === 'due' ? `now · ${fmtTime(o.at)}` : fmtTime(o.at);
      cSub.replaceChildren(h('span', o.profile.name), h('em', { class: `st-${o.status}` }, when));
      doneBtn.className = `pp-done ${o.status}`;
      doneBtn.replaceChildren(h('i', { html: o.status === 'done' ? icon('replay') : lic(LI.check) }), h('span', o.status === 'done' ? 'Undo' : 'Done'));
    }
    function doDone(o) {
      if (o.done) { S.undo(o.done.id); app.sfx('tap'); app.toast('Undone'); return; }
      const finish = (who) => {
        S.markDone(o.task.id, { who });
        app.sfx('coin');
        app.toast(`${S.TYPES[o.task.type]?.past || 'Done for'} ${o.profile.name}${who ? ` · ${who}` : ''}`);
        const next = S.today().find((x) => x.status !== 'done' && x.key !== o.key);
        if (next) selKey = next.key;
        draw();
      };
      const ms = S.members();
      if (ms.length < 2) { finish(ms[0] || ''); return; }
      P({
        title: 'Who did it?',
        build(body, p) {
          body.append(form(h('div.pp-whoic', avatar(o.profile, 'mid')), note(`${S.taskName(o.task)} · ${o.profile.name}`),
            h('div.chips.pp-who', ms.map((m) => h(`button.chip${m === S.lastWho() ? '.on' : ''}`, { type: 'button', dir: 'auto', onclick: () => { p.close(); finish(m); } }, m))),
            h('div.pk-btns', h('button.pill', { type: 'button', onclick: () => { p.close(); finish(''); } }, 'Just mark it done'))));
        },
      });
    }

    // ---------------------------------------------------------------- week
    function drawWeek() {
      lHead.replaceChildren(h('b', 'This week'));
      setLBtns({ icon: ico('task'), label: 'Today', fn: () => showPage('today') }, { icon: ico('other'), label: 'Plants & pets', fn: () => showPage('pets') });
      const now = Date.now();
      const occ = S.occurrences(startOfDay(now), 7, now);
      if (!occ.length) { list.replaceChildren(h('div.pp-none', 'Nothing planned for the next 7 days.')); return; }
      const out = [];
      let day = '';
      for (const o of occ) {
        const k = dayKey(Math.max(o.at, startOfDay(now)));
        if (k !== day) { day = k; const t = Math.max(o.at, startOfDay(now)); out.push(h('div.pp-day', startOfDay(t) === startOfDay(now) ? 'Today' : startOfDay(t) === addDays(startOfDay(now), 1) ? 'Tomorrow' : fmtDay(t))); }
        out.push(occRow(o, now));
      }
      list.replaceChildren(...out);
    }
    function occRow(o, now) {
      return h(`button.pp-row.${o.status}`, { type: 'button', onclick: () => { if (startOfDay(o.at) <= startOfDay(now) || o.status === 'late') { selKey = o.key; showPage('today'); } else taskPanel(o.task); } },
        h('div.pp-ri', { '--pc': o.profile.color, html: tIcon(o.task) }),
        h('div.pp-rt', h('b', { dir: 'auto' }, `${S.taskName(o.task)}${o.task.dose ? ` · ${o.task.dose}` : ''}`), h('small', { dir: 'auto' }, o.profile.name)),
        h('span.pp-rw', o.status === 'done' ? h('i', { html: lic(LI.check) }) : o.status === 'late' ? S.lateBy(o, now) : fmtTime(o.at)));
    }

    // ---------------------------------------------------------------- pets
    function drawPets() {
      lHead.replaceChildren(h('b', 'Plants & pets'));
      setLBtns({ icon: ico('gear'), label: 'Settings', fn: settingsPanel }, { icon: icon('plus'), label: 'Add a plant or pet', fn: () => editProfile(null), primary: true });
      const profs = S.profiles();
      if (!profs.length) { list.replaceChildren(h('div.pp-none', 'Add your first plant or pet with +.')); return; }
      const now = Date.now();
      const occ = S.today(now);
      list.replaceChildren(...profs.map((p) => {
        const mine = occ.filter((o) => o.profile.id === p.id);
        const left = mine.filter((o) => o.status !== 'done').length, late = mine.filter((o) => o.status === 'late').length;
        const s = S.soil(p);
        const bits = [kindName(p.kind), `${S.tasks().filter((t) => t.pid === p.id).length} tasks`];
        return h('button.pp-row.pp-prow', { type: 'button', onclick: () => profilePanel(p) },
          avatar(p, 'sm'),
          h('div.pp-rt', h('b', { dir: 'auto' }, p.name), h('small', bits.join(' · '))),
          s?.dry ? h('span.pp-badge.dry', { html: ico('water') }) : null,
          late ? h('span.pp-badge.late', String(late)) : left ? h('span.pp-badge', String(left)) : h('span.pp-badge.ok', { html: lic(LI.check) }));
      }));
    }

    // ---------------------------------------------------------------- history
    function drawHistory(pid = null) {
      lHead.replaceChildren(h('b', 'History'));
      setLBtns({ icon: ico('task'), label: 'Today', fn: () => showPage('today') }, { icon: ico('week'), label: 'This week', fn: () => showPage('week') });
      list.replaceChildren(...historyRows(pid));
    }
    function historyRows(pid = null) {
      const lg = S.log().filter((e) => !pid || e.pid === pid).slice(0, 150);
      if (!lg.length) return [h('div.pp-none', 'Nothing done yet — what you mark done shows here.')];
      const out = [];
      let day = '';
      for (const e of lg) {
        const t = S.taskById(e.tid), p = S.profileById(e.pid);
        const k = dayKey(e.at);
        if (k !== day) { day = k; out.push(h('div.pp-day', k === dayKey() ? 'Today' : k === dayKey(addDays(Date.now(), -1)) ? 'Yesterday' : fmtDay(e.at))); }
        out.push(h('button.pp-row', { type: 'button', onclick: () => confirm({ title: 'Remove?', msg: `Remove “${t ? S.taskName(t) : 'Task'} · ${p?.name || ''}” at ${fmtTime(e.at)} from the history?`, yes: 'Remove', onYes: () => { S.undo(e.id); draw(); }, color: S.COLOR }) },
          h('div.pp-ri', { '--pc': p?.color || S.COLOR, html: tIcon(t) }),
          h('div.pp-rt', h('b', { dir: 'auto' }, `${t ? S.TYPES[t.type]?.past || 'Done' : 'Done'} ${p?.name || ''}`.trim()), h('small', { dir: 'auto' }, [t?.label && t.label !== S.TYPES[t.type]?.name ? t.label : '', e.who].filter(Boolean).join(' · ') || ' ')),
          h('span.pp-rw', fmtTime(e.at))));
      }
      return out;
    }
    function setLBtns(l, r) {
      for (const [b, c] of [[lLeft, l], [lRight, r]]) {
        b.innerHTML = c.icon; b.setAttribute('aria-label', c.label); b.title = c.label; b.onclick = c.fn; b.classList.toggle('primary', !!c.primary);
      }
    }

    // ================================================================ profile
    function profilePanel(p0) {
      P({
        title: '',
        className: 'pp-ppanel',
        build(body, p) {
          const sc = form();
          const render = () => {
            const pr = S.profileById(p0.id);
            if (!pr) { p.close(); return; }
            const ts = S.tasks().filter((t) => t.pid === pr.id);
            const s = S.soil(pr);
            sc.replaceChildren(...[
              avatar(pr, 'big'),
              h('div.pp-pname', { dir: 'auto' }, pr.name),
              h('div.pp-pkind', kindName(pr.kind)),
              pr.sensor?.entity ? h(`div.pp-soil${s?.dry ? '.dry' : ''}`, h('i', { html: ico('sensor') }),
                s ? `Soil ${Math.round(s.value)}${s.unit}${s.dry ? ' — needs water' : ''}` : `Soil: ${entityName(pr.sensor.entity)} (no reading)`) : null,
              lbl('Care'),
              ...ts.map((t) => {
                const nd = S.nextDue(t);
                return h('button.pp-trow', { type: 'button', onclick: () => taskPanel(t, render) },
                  h('div.pp-ri', { '--pc': pr.color, html: tIcon(t) }),
                  h('div.pp-rt', h('b', { dir: 'auto' }, `${S.taskName(t)}${t.dose ? ` · ${t.dose}` : ''}`), h('small', [S.describe(t), nd ? `next ${fmtDay(nd, { wd: false })}` : ''].filter(Boolean).join(' · '))),
                  t.remind ? h('i.pp-bell', { html: ico('bell') }) : null);
              }),
              ts.length ? null : note('No care tasks yet.'),
              h('div.pk-btns',
                h('button.pill.primary', { type: 'button', onclick: () => taskPanel(S.newTask(pr.id, { type: S.KIND_TYPES[pr.kind][0] }), render, true) }, '+ Care task'),
                h('button.pill', { type: 'button', onclick: () => editProfile(pr, render) }, 'Edit')),
              h('div.pk-btns',
                h('button.pill.small', { type: 'button', onclick: () => historyPanel(pr) }, 'History'),
                h('button.pill.small.danger', { type: 'button', onclick: () => confirm({ title: `Delete ${pr.name}?`, msg: 'Its care tasks go too (the history stays).', onYes: () => { S.deleteProfile(pr.id); p.close(); }, color: S.COLOR }) }, 'Delete')),
            ].filter(Boolean));
          };
          render();
          body.append(sc);
          p.onDestroy = S.events.on('change', render);
        },
      });
    }
    function historyPanel(pr) {
      P({ title: `History · ${pr.name}`, build(body) { const l = h('div.pp-list.inpanel', ...historyRows(pr.id)); body.append(l); curve(l); } });
    }
    function editProfile(p0, after) {
      const isNew = !p0;
      const d = p0 ? JSON.parse(JSON.stringify(p0)) : S.newProfile({ color: COLORS[S.profiles().length % COLORS.length] });
      let picks = null;   // preset indexes (new profiles)
      P({
        title: isNew ? 'New plant or pet' : 'Edit',
        build(body, p) {
          const sc = form();
          const render = () => {
            if (isNew && !picks) picks = S.PRESETS[d.kind].map((x, i) => (x.on ? i : -1)).filter((i) => i >= 0);
            sc.replaceChildren(...[
              avatar(d, 'big'),
              h('button.pp-namebtn', { type: 'button', dir: 'auto', onclick: async () => { const v = await app.editText({ title: 'Name', value: d.name, placeholder: d.kind === 'plant' ? 'e.g. Monstera' : 'e.g. Luna' }); if (v) { d.name = v; render(); } } },
                d.name || 'Add a name', h('i', { html: ico('edit') })),
              lbl('Kind'),
              h('div.pk-icons.pp-kinds', S.KINDS.map((k) => h(`button.pk-icn${d.kind === k.id ? '.on' : ''}`, { type: 'button', 'aria-label': k.name, title: k.name, onclick: () => { if (d.kind !== k.id) { d.kind = k.id; picks = null; render(); } }, html: ico(KIND_ICON[k.id]) }))),
              h('div.pk-note', kindName(d.kind)),
              lbl('Colour'),
              colorChips(() => d.color, (c) => { d.color = c; render(); }),
              lbl('Photo'),
              h('div.pk-btns', h('button.pill.small', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Photo address (URL)', value: d.photo, placeholder: 'https://…' }); if (v !== null) { d.photo = v; render(); } } }, d.photo ? 'Change photo URL' : 'Add a photo URL'),
                d.photo ? h('button.pill.small', { type: 'button', onclick: () => { d.photo = ''; render(); } }, 'Remove') : null),
              d.kind === 'plant' ? lbl('Soil sensor') : null,
              d.kind === 'plant' ? sensorBlock(d, render) : null,
              isNew ? lbl('Care tasks') : null,
              isNew ? h('div.chips.multi', S.PRESETS[d.kind].map((x, i) => h(`button.chip.pk-mini${picks.includes(i) ? '.on' : ''}`, { type: 'button', onclick: () => { picks = picks.includes(i) ? picks.filter((j) => j !== i) : [...picks, i]; render(); } },
                `${x.label || S.TYPES[x.type].name} · ${S.describe({ sched: x.sched }).replace(/^Daily · /, '')}`))) : null,
              isNew ? note('Change times and add more (medicine, vet…) later.') : null,
              h('div.pk-btns', h('button.pill.primary', { type: 'button', onclick: async () => {
                if (!d.name) { const v = await app.editText({ title: 'Name', placeholder: d.kind === 'plant' ? 'e.g. Monstera' : 'e.g. Luna' }); if (!v) return; d.name = v; }
                S.putProfile(d);
                if (isNew) for (const i of picks) { const x = S.PRESETS[d.kind][i]; S.putTask(S.newTask(d.id, { type: x.type, label: x.label || '', sched: x.sched })); }
                app.sfx('pop'); p.close(); after?.();
                if (isNew) { app.toast(`Added ${d.name}`); draw(); }
              } }, isNew ? 'Add' : 'Save')),
            ].filter(Boolean));
          };
          render();
          body.append(sc);
        },
      });
    }
    function sensorBlock(d, render) {
      if (!haReady() && !d.sensor) return note('With Home Assistant set up, pick a soil-moisture sensor and get a “needs water” reminder.');
      const s = d.sensor;
      return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.4cqmin', width: '100%' } },
        h('button.pill.small', { type: 'button', onclick: async () => {
          const ids = await pickEntities({ title: 'Soil sensor', domains: ['sensor'], filter: moistureFilter, color: S.COLOR, hint: 'No moisture sensors found.' });
          if (ids?.length) { d.sensor = { entity: ids[0], below: d.sensor?.below ?? 30 }; render(); }
        } }, s ? entityName(s.entity) : 'Choose a sensor…'),
        s ? h('div.pk-row', h('span', 'Needs water below', h('small', 'soil moisture %')), numStepper(() => d.sensor.below, (v) => { d.sensor.below = v; }, { min: 5, max: 90, step: 5, fmt: (n) => `${n}%` })) : null,
        s ? h('button.pill.small', { type: 'button', onclick: () => { d.sensor = null; render(); } }, 'No sensor') : null);
    }

    // ================================================================ a care task
    function taskPanel(t0, after, isNew = false) {
      const d = JSON.parse(JSON.stringify(t0));
      const pr = S.profileById(d.pid);
      P({
        title: isNew ? 'New care task' : 'Care task',
        build(body, p) {
          const sc = form();
          const types = [...new Set([...(S.KIND_TYPES[pr?.kind] || []), ...Object.keys(S.TYPES)])];
          let more = !S.KIND_TYPES[pr?.kind]?.includes(d.type);
          const setKind = (k) => {
            if (k === d.sched.kind) return;
            const atT = d.sched.at || (d.sched.times || [])[0] || '09:00';
            if (k === 'daily') d.sched = { kind: 'daily', times: [atT] };
            else if (k === 'weekly') d.sched = { kind: 'weekly', days: [new Date().getDay()], at: atT };
            else d.sched = { kind: 'every', n: 7, unit: 'd', start: dayKey(), at: atT };
            render();
          };
          const render = () => {
            const shown = more ? types : types.filter((x) => (S.KIND_TYPES[pr?.kind] || []).includes(x));
            const s = d.sched;
            sc.replaceChildren(...[
              h('div.pk-icons', shown.map((x) => h(`button.pk-icn${d.type === x ? '.on' : ''}`, { type: 'button', 'aria-label': S.TYPES[x].name, title: S.TYPES[x].name,
                onclick: () => { d.type = x; if (x === 'vacc' || x === 'vet') { d.sched = { kind: 'every', n: 1, unit: 'y', start: d.sched.start || dayKey(), at: d.sched.at || '10:00' }; } else if (x === 'flea') d.sched = { kind: 'every', n: 1, unit: 'm', start: dayKey(), at: '09:00' }; render(); }, html: ico(x) })),
              more ? null : h('button.chip.pk-mini', { type: 'button', onclick: () => { more = true; render(); } }, 'More…')),
              h('button.pp-namebtn', { type: 'button', dir: 'auto', onclick: async () => { const v = await app.editText({ title: 'Name', value: S.taskName(d), placeholder: S.TYPES[d.type].name }); if (v !== null) { d.label = v === S.TYPES[d.type].name ? '' : v; render(); } } },
                S.taskName(d), h('i', { html: ico('edit') })),
              h('div.pk-note', pr ? pr.name : ''),
              d.type === 'med' ? h('button.pill.small', { type: 'button', dir: 'auto', onclick: async () => { const v = await app.editText({ title: 'Dose', value: d.dose, placeholder: 'e.g. ½ tablet, 2 ml' }); if (v !== null) { d.dose = v; render(); } } }, d.dose ? `Dose: ${d.dose}` : 'Add the dose') : null,
              lbl('When'),
              chipRow([{ id: 'daily', name: 'Daily' }, { id: 'weekly', name: 'Weekly' }, { id: 'every', name: 'Every…' }], s.kind, setKind),
              ...(s.kind === 'daily' ? [
                h('div.chips', [...s.times].sort().map((x) => h('button.chip.pp-time', { type: 'button', 'aria-label': `Change ${x}`, onclick: () => pickTime(x, (v) => { s.times = s.times.map((y) => (y === x ? v : y)); render(); }, s.times.length > 1 ? () => { s.times = s.times.filter((y) => y !== x); render(); } : null) }, x)),
                  s.times.length < 6 ? h('button.chip.pp-time.add', { type: 'button', onclick: () => pickTime('12:00', (v) => { if (!s.times.includes(v)) s.times.push(v); render(); }) }, '+ time') : null),
              ] : []),
              ...(s.kind === 'weekly' ? [
                chipRow(WD.map((n, i) => ({ id: i, name: n.slice(0, 2) })), s.days, (i) => { s.days = s.days.includes(i) ? s.days.filter((x) => x !== i) : [...s.days, i].sort(); if (!s.days.length) s.days = [i]; render(); }, { multi: true, cls: 'pk-mini' }),
                timeStepper(() => s.at, (v) => { s.at = v; }),
              ] : []),
              ...(s.kind === 'every' ? [
                h('div.pk-row', h('span', 'Every'), numStepper(() => s.n, (v) => { s.n = v; }, { min: 1, max: 365 })),
                chipRow(S.UNITS.map((u) => ({ id: u.id, name: u.name })), s.unit, (u) => { s.unit = u; render(); }),
                lbl(d.last ? 'Last done' : 'First due'),
                d.last ? h('div.pk-note', `${fmtDay(d.last, { year: true })} · next ${fmtDay(S.nextDue(d), { year: true })}`) : dateStepper(() => s.start, (v) => { s.start = v; }),
                lbl('At'),
                timeStepper(() => s.at, (v) => { s.at = v; }),
              ] : []),
              h('div.pk-row', h('span', 'Remind me', h('small', 'rings here + Settings → Alerts')),
                h(`button.switch${d.remind ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(!!d.remind), 'aria-label': 'Remind me', onclick: () => { d.remind = !d.remind; render(); } })),
              h('div.pk-btns',
                h('button.pill.primary', { type: 'button', onclick: () => { S.putTask(d); app.sfx('pop'); p.close(); after?.(); } }, isNew ? 'Add' : 'Save'),
                isNew ? null : h('button.pill', { type: 'button', onclick: () => { S.markDone(d.id, { who: S.members().length === 1 ? S.members()[0] : S.lastWho() }); app.sfx('coin'); app.toast('Marked done'); p.close(); after?.(); } }, 'Done now'),
                isNew ? null : h('button.pill.danger', { type: 'button', onclick: () => confirm({ title: 'Delete this task?', msg: `${S.taskName(d)} · ${pr?.name || ''}`, onYes: () => { S.deleteTask(d.id); p.close(); after?.(); }, color: S.COLOR }) }, 'Delete')),
            ].filter(Boolean));
          };
          render();
          body.append(sc);
        },
      });
    }
    function pickTime(v0, set, remove) {
      let v = v0;
      P({
        title: 'Time',
        build(body, p) {
          body.append(h('div.pk-form.center', timeStepper(() => v, (x) => { v = x; }), h('div.pk-btns',
            h('button.pill.primary', { type: 'button', onclick: () => { p.close(); set(v); } }, 'OK'),
            remove ? h('button.pill.danger', { type: 'button', onclick: () => { p.close(); remove(); } }, 'Remove') : null)));
        },
      });
    }

    // ================================================================ settings
    function settingsPanel() {
      P({
        title: 'Settings',
        build(body, p) {
          const sc = form();
          const render = () => {
            const ms = S.members();
            sc.replaceChildren(
              h('div.pk-row', h('span', 'Reminders', h('small', 'ring at each task’s time · Snooze 1 h')),
                h(`button.switch${S.remindOn() ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(S.remindOn()), 'aria-label': 'Reminders', onclick: () => { S.setRemindOn(!S.remindOn()); render(); } })),
              lbl('Household'),
              note(ms.length ? 'Tap a name to remove it. With two or more, Done asks who did it.' : 'Add the people who help — Done then asks who did it.'),
              h('div.chips', ms.map((m) => h('button.chip', { type: 'button', dir: 'auto', onclick: () => { S.setMembers(ms.filter((x) => x !== m)); render(); } }, m, ' ×')),
                h('button.chip', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Name', placeholder: 'e.g. Noa' }); if (v && !ms.includes(v)) { S.setMembers([...ms, v]); render(); } } }, '+ Person')),
              h('div.pk-btns', h('button.pill.small', { type: 'button', onclick: () => {
                const o = S.today().find((x) => x.status !== 'done') || S.occurrences(startOfDay(), 7)[0];
                if (o) S.fire([o]); else app.toast('Add a care task first');
              } }, 'Test a reminder')));
          };
          render();
          body.append(sc);
        },
      });
    }

    // ================================================================ updates & keys
    const offs = [S.events.on('change', draw)];
    app.every(20000, draw);
    app.onKey((e) => {
      if (topPanel() || document.querySelector('.rk-ring')) return;
      if (page !== 'today') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const order = ['today', 'week', 'pets', 'history']; showPage(order[(order.indexOf(page) + (e.key === 'ArrowRight' ? 1 : 3)) % 4]); }
        return;
      }
      if (!items.length) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!S.profiles().length) editProfile(null); else showPage('pets'); } return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const i = items.findIndex((o) => o.key === selKey);
        selKey = items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length].key;
        app.sfx('tick'); drawToday();
      } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = sel(); if (o) doDone(o); }
      else if (e.key === 'w') showPage('week');
      else if (e.key === 'p') showPage('pets');
      else if (e.key === 'h') showPage('history');
    });
    showPage('today');
    return {
      destroy() { offs.forEach((f) => f()); },
      back() { if (page !== 'today') { showPage('today'); return true; } return false; },
    };
  },
};
