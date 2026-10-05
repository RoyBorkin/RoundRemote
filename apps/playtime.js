// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Play Time — the "I played too much" timer. Players get a daily gaming budget (per weekday), an optional session
// limit and a bedtime. A big dial shows the time used vs the budget and turns amber, then red. Sessions start/stop by
// hand — or by themselves when the PlayStation / Steam service says the player is in a game. Warnings at 15 / 5 / 0
// minutes left and at bedtime ring on any screen (and through the smart home, Settings → Alerts); when time is up the
// PS5 can go to rest mode and the music can pause. History: a week of bars, streaks within budget, bonus minutes.
// Budgets, players and bonuses can be locked with a 4-digit PIN. The engine (playtime-engine.js) keeps running in the
// background when you leave the app.
import { h } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { topPanel, curve, listRow, emptyNote } from '../js/ui/overlay.js';
import { provider } from '../js/providers/registry.js';
import * as E from './playtime-engine.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const LVL_COLOR = { ok: '#34d399', amber: '#f59e0b', red: '#ef4444', over: '#ef4444' };
const svgIc = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const IC = {
  pad: 'M7 6h10a5 5 0 0 1 4.9 6l-.9 4.4a2.6 2.6 0 0 1-4.6 1.1L14.6 15H9.4l-1.8 2.5A2.6 2.6 0 0 1 3 16.4L2.1 12A5 5 0 0 1 7 6zm0 3v1.5H5.5v2H7V14h2v-1.5h1.5v-2H9V9z',
  bars: 'M4 20h16v2H4zM5 11h3v8H5zm5.5-6h3v14h-3zM16 8h3v11h-3z',
  gift: 'M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8h1a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1zM15 5a1 1 0 1 1 0 2h-2a2 2 0 0 1 2-2zM9 5a2 2 0 0 1 2 2H9a1 1 0 1 1 0-2zM5 9h6v1H5zm2 3h4v7H7zm6 7v-7h4v7zm0-9V9h6v1z',
  flame: 'M13.5 1.5s.7 2.6.7 4.7c0 2-1.3 3.7-3.4 3.7S7.5 8.2 7.5 6.2l.1-.4A9.4 9.4 0 0 0 5 12.3 7 7 0 0 0 12 19.3a7 7 0 0 0 7-7c0-4.5-2.2-8.6-5.5-10.8zM11.7 16.3c-1.6 0-2.8-1.2-2.8-2.8 0-1.4.9-2.4 2.4-2.7 1.5-.3 3-1 3.9-2.2.3 1.1.5 2.3.5 3.5 0 2.3-1.8 4.2-4 4.2z',
};
const fmtDur = (ms, M = E.MIN()) => {
  const m = Math.max(0, Math.round(ms / M));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`;
};
const compact = (m) => { m = Math.round(m); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${E.pad(m % 60)}`; };
const fmtMin = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`);
const fmtHM = (hm) => `${E.pad(hm.h)}:${E.pad(hm.m)}`;
/** The big number: "1h 12m" when there's an hour or more, "12:34" (min:sec) under an hour. */
function bigLeft(ms, M = E.MIN()) {
  const neg = ms < 0, a = Math.abs(ms);
  const totalS = neg ? Math.floor(a / (M / 60)) : Math.ceil(a / (M / 60));
  const m = Math.floor(totalS / 60), s = totalS % 60;
  if (m >= 60) return `${neg ? '+' : ''}${Math.floor(m / 60)}h ${E.pad(m % 60)}m`;
  return `${neg ? '+' : ''}${m}:${E.pad(s)}`;
}

export default {
  css: './playtime.css',
  create(el, app) {
    E.startPlaytime();
    app.hideTitle();
    const openPanel = (o) => { const p = app.openPanel(o); p.el.style.setProperty('--ac', E.COLOR); p.el.classList.add('pt-panel'); return p; };
    let page = 'main';         // main | hist
    let weekOff = 0;
    let unlockedAt = 0;

    // ================================================================ the dial
    const svg = h('div.pt-dial', { html: `<svg viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="90" class="pt-track"/>
      <circle cx="100" cy="100" r="90" class="pt-zone amber" pathLength="1000" transform="rotate(-90 100 100)"/>
      <circle cx="100" cy="100" r="90" class="pt-zone red" pathLength="1000" transform="rotate(-90 100 100)"/>
      <circle cx="100" cy="100" r="90" class="pt-arc" pathLength="1000" transform="rotate(-90 100 100)"/>
      <circle cx="100" cy="100" r="80.5" class="pt-strack"/>
      <circle cx="100" cy="100" r="80.5" class="pt-sarc" pathLength="1000" transform="rotate(-90 100 100)"/>
      <g class="pt-headg"><circle cx="100" cy="10" r="6" class="pt-head"/></g>
    </svg>` });
    const q = (s) => svg.querySelector(s);
    const arc = q('.pt-arc'), head = q('.pt-head'), headG = q('.pt-headg'), zA = q('.pt-zone.amber'), zR = q('.pt-zone.red'), sTrack = q('.pt-strack'), sArc = q('.pt-sarc');
    const dash = (elm, from, to) => { // a segment of the ring from → to (fractions of a turn)
      from = Math.max(0, Math.min(1, from)); to = Math.max(from, Math.min(1, to));
      elm.style.strokeDasharray = `0 ${(from * 1000).toFixed(1)} ${((to - from) * 1000).toFixed(1)} 1000`;
    };

    // ================================================================ main page
    const who = h('button.pt-who', { type: 'button', onclick: () => choosePlayer() });
    const game = h('div.pt-game');
    const big = h('div.pt-big');
    const lbl = h('div.pt-lbl');
    const sub = h('div.pt-sub');
    const go = h('button.pt-go', { type: 'button', onclick: () => toggle() });
    const histBtn = h('button.pt-side.pt-left', { type: 'button', 'aria-label': 'History', title: 'History', onclick: () => showPage('hist'), html: svgIc(IC.bars) });
    const bonusBtn = h('button.pt-side.pt-right', { type: 'button', 'aria-label': 'Bonus minutes', title: 'Bonus minutes', onclick: () => locked(openBonus), html: svgIc(IC.gift) });
    const gear = h('button.pt-gear', { type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => locked(openSettings), html: icon('settings') });
    const empty = h('div.pt-empty',
      h('div.pt-empty-ic', { html: svgIc(IC.pad) }),
      h('div.pt-empty-t', 'Who’s playing?'),
      h('div.pt-empty-m', 'Add a player with a daily gaming budget. Play Time warns at 15, 5 and 0 minutes left.'),
      h('button.pill.primary', { type: 'button', '--c': E.COLOR, onclick: () => locked(() => editProfile(null)) }, 'Add a player'));
    const main = h('div.pt-page.pt-mainpage', who, game, big, lbl, sub, histBtn, go, bonusBtn, gear);

    // ================================================================ history page
    const hTitle = h('div.pt-htitle');
    const hPrev = h('button.pt-harr', { type: 'button', 'aria-label': 'Previous week', onclick: () => { weekOff++; drawHist(); }, html: icon('chevron') });
    const hNext = h('button.pt-harr.next', { type: 'button', 'aria-label': 'Next week', onclick: () => { weekOff = Math.max(0, weekOff - 1); drawHist(); }, html: icon('chevron') });
    const chart = h('div.pt-chart');
    const stats = h('div.pt-stats');
    const hist = h('div.pt-page.pt-histpage', { hidden: true }, h('div.pt-hhead', hPrev, hTitle, hNext), chart, stats);

    const root = h('div.pt', svg, main, hist, empty);
    el.append(root);

    const cur = () => E.profileById(E.curId());

    function showPage(p) {
      page = p;
      main.hidden = p !== 'main';
      hist.hidden = p !== 'hist';
      root.dataset.page = p;
      if (p === 'hist') { weekOff = 0; drawHist(); }
      app.sfx('tick');
      draw();
    }

    // ---------------------------------------------------------------- drawing
    let lastLvl = '';
    function draw() {
      const p = cur();
      root.classList.toggle('none', !p);
      empty.hidden = !!p;
      if (!p) { main.hidden = true; hist.hidden = true; setArc(0); dash(zA, 0, 0); dash(zR, 0, 0); sTrack.style.opacity = 0; sArc.style.opacity = 0; return; }
      if (page === 'main') main.hidden = false;
      const st = E.status(p);
      const M = E.MIN();
      const lvl = E.levelOf(st.left);
      if (lvl !== lastLvl) { root.dataset.lvl = lvl; root.style.setProperty('--lv', LVL_COLOR[lvl]); lastLvl = lvl; }
      root.classList.toggle('running', st.running);
      root.style.setProperty('--pc', p.color);
      // the ring: time used of the day's budget; the last 15 / 5 minutes of the budget are tinted
      const B = Math.max(st.budget, 1);
      if (page === 'hist') {
        setArc(0); dash(zA, 0, 0); dash(zR, 0, 0); sTrack.style.opacity = 0; sArc.style.opacity = 0;
      } else {
        setArc(st.used / B);
        dash(zA, (st.budget - 15 * M) / B, (st.budget - 5 * M) / B);
        dash(zR, (st.budget - 5 * M) / B, 1);
        const sl = p.session ? p.session * M : 0;
        sTrack.style.opacity = sl ? 1 : 0; sArc.style.opacity = sl ? 1 : 0;
        if (sl) sArc.style.strokeDasharray = `${(Math.min(1, st.session / sl) * 1000).toFixed(1)} 1000`;
      }
      if (page !== 'main') return;
      // texts
      const multi = E.profiles().length > 1;
      who.replaceChildren(...[h('span.pt-dot'), h('span.pt-name', { dir: 'auto' }, p.name), multi && h('i.pt-chev', { html: icon('chevron') })].filter(Boolean));
      const r = st.run;
      if (r) {
        const svc = r.auto && E.SVCS.find((s) => s.id === r.auto);
        game.replaceChildren(...[h('i', { html: svgIc(IC.pad) }), h('span', { dir: 'auto' }, r.game ? `Playing ${r.game}` : 'Playing'),
          svc && h('b.pt-auto', svc.id === 'playstation' ? 'PS' : 'Steam')].filter(Boolean));
        game.title = svc ? `Detected on ${svc.name}` : '';
      } else if (st.quiet) {
        game.replaceChildren(h('i', { html: icon('moon') }), h('span', `Quiet hours until ${fmtHM(p.wake || { h: 7, m: 0 })}`));
      } else {
        const links = (p.links || []).map((id) => E.SVCS.find((s) => s.id === id)?.name).filter(Boolean);
        game.replaceChildren(h('span', links.length ? `Watching ${links.join(' & ')}` : 'Not playing'));
      }
      big.textContent = st.left < 0 ? bigLeft(st.left, M) : st.running || st.left < 60 * M ? bigLeft(st.left, M) : fmtDur(st.left, M).replace(' h', 'h').replace(/h (\d+)$/, 'h $1m');
      lbl.textContent = st.left <= 0 && st.why === 'bed' ? 'bedtime' : st.left < 0 ? 'over the limit'
        : st.why === 'bed' ? 'left until bedtime' : st.why === 'session' ? 'left this session' : 'left today';
      const bonus = st.bonus ? ` + ${fmtMin(st.bonus)} bonus` : '';
      sub.textContent = `${fmtDur(st.used, M)} played · ${fmtMin(E.baseBudget(p))}${bonus}`;
      go.replaceChildren(h('i', { html: icon(st.running ? 'stop' : 'play') }), h('span', st.running ? 'Stop' : 'Start'));
      go.classList.toggle('stop', st.running);
      go.setAttribute('aria-label', st.running ? 'Stop playing' : 'Start playing');
    }
    function setArc(f) {
      f = Math.max(0, f);
      const over = f > 1;
      const g = Math.min(1, f);
      arc.style.strokeDasharray = `${(g * 1000).toFixed(1)} 1000`;
      arc.style.opacity = g > 0.002 ? 1 : 0;
      headG.style.transform = `rotate(${(g * 360).toFixed(2)}deg)`;
      head.style.opacity = f > 0.004 && !over ? 1 : 0;
      root.classList.toggle('over', over);
    }

    function toggle() {
      const p = cur();
      if (!p) return;
      if (E.isRunning(p.id)) { E.stopSession(p.id); app.sfx('drop'); }
      else { E.startSession(p.id); app.sfx('pop'); }
      draw();
    }
    function cycle(d) {
      const list = E.profiles();
      if (list.length < 2) return;
      const i = list.findIndex((x) => x.id === E.curId());
      E.setCur(list[(i + d + list.length) % list.length].id);
      app.sfx('tick'); lastLvl = '';
      if (page === 'hist') drawHist();
      draw();
    }

    // ---------------------------------------------------------------- history
    function drawHist() {
      const p = cur();
      if (!p) return;
      const M = E.MIN();
      const end = E.daysAgo(weekOff * 7);
      const days = Array.from({ length: 7 }, (_, i) => E.dayInfo(p, E.daysAgo(6 - i, end)));
      hTitle.replaceChildren(h('span.pt-dot'), h('span', { dir: 'auto' }, p.name), h('small', weekOff === 0 ? 'Last 7 days' : weekOff === 1 ? 'The week before' : `${weekOff} weeks ago`));
      hNext.disabled = weekOff === 0;
      const max = Math.max(...days.map((d) => Math.max(d.used, d.budget)), 30 * M) * 1.1;
      const today = E.dayKey();
      chart.replaceChildren(...days.map((d) => {
        const wd = new Date(d.t).getDay();
        const usedPct = (d.used / max) * 100, budPct = (d.budget / max) * 100;
        return h(`div.pt-col${d.before ? '.none' : d.ok ? '' : '.over'}${d.key === today ? '.today' : ''}`, { title: `${DAYS[wd]}: ${fmtDur(d.used, M)} of ${fmtDur(d.budget, M)}` },
          h('div.pt-val', d.used ? compact(d.used / M) : '–'),
          h('div.pt-barbox',
            h('div.pt-budget', { style: { bottom: `${budPct}%` } }),
            h('div.pt-bar', { style: { height: `${Math.max(d.used ? 2 : 0, usedPct)}%` } })),
          h('div.pt-day', LETTERS[wd]));
      }));
      const s = E.streaks(p);
      const real = days.filter((d) => !d.before);
      const total = real.reduce((a, d) => a + d.used, 0);
      const within = real.filter((d) => d.ok).length;
      stats.replaceChildren(
        h('div.pt-stat.streak', h('i', { html: svgIc(IC.flame) }), h('b', String(s.current)), h('span', s.current === 1 ? 'day in a row' : 'days in a row'), h('small', `best ${s.best}`)),
        h('div.pt-stat', h('b', fmtDur(total, M)), h('span', 'played'), h('small', `${fmtDur(total / Math.max(1, real.length), M)} a day`)),
        h('div.pt-stat', h('b', `${within}/${real.length}`), h('span', 'within budget'), h('small', days.some((d) => d.bonus) ? `${fmtMin(days.reduce((a, d) => a + d.bonus, 0))} bonus` : 'no bonus')));
    }

    // ================================================================ PIN
    function locked(fn) {
      const pin = E.getPin();
      if (!pin || Date.now() - unlockedAt < 180000) { fn(); return; }
      pinPad({ title: 'Parent PIN', hint: 'Enter the 4-digit PIN', check: (v) => v === pin, done: () => { unlockedAt = Date.now(); fn(); } });
    }
    function pinPad({ title, hint, check, done }) {
      let v = '';
      openPanel({
        title, className: 'pt-pinpanel',
        build(body, panel) {
          const dots = h('div.pt-dots');
          const msg = h('div.pt-pinhint', hint);
          const drawDots = () => dots.replaceChildren(...[0, 1, 2, 3].map((i) => h(`span${i < v.length ? '.on' : ''}`)));
          const press = (k) => {
            if (k === 'del') v = v.slice(0, -1);
            else if (v.length < 4) v += k;
            app.sfx('tick'); drawDots();
            if (v.length === 4) {
              if (check(v)) { const val = v; setTimeout(() => { panel.close(); done(val); }, 120); }
              else { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); msg.textContent = 'Wrong PIN — try again'; v = ''; setTimeout(drawDots, 260); app.vibrate(60); }
            }
          };
          const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
          const grid = h('div.pt-keys', keys.map((k) => (k ? h(`button.pt-key${k === 'del' ? '.del' : ''}`, { type: 'button', onclick: () => press(k), html: k === 'del' ? icon('backspace') : k, 'aria-label': k === 'del' ? 'Delete' : k }) : h('span'))));
          body.append(dots, msg, grid);
          drawDots();
          panel.pin = (e) => {
            if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); return true; }
            if (e.key === 'Backspace' && v) { e.preventDefault(); press('del'); return true; }
            return false;
          };
          keyPanel = panel;
        },
      });
    }
    let keyPanel = null;
    // the PIN pad takes digits and Backspace before the app's Back handling does
    const panelKeys = (e) => {
      if (keyPanel?.pin && topPanel() === keyPanel && keyPanel.pin(e)) e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', panelKeys, true);

    // ================================================================ choose a player
    function choosePlayer() {
      const list = E.profiles();
      if (list.length < 2) { locked(() => editProfile(cur())); return; }
      openPanel({
        title: 'Who’s playing?',
        build(body, panel) {
          const l = h('div.list');
          body.append(l); curve(l);
          for (const p of list) {
            const st = E.status(p);
            l.append(listRow({ title: p.name, subtitle: `${st.running ? 'Playing · ' : ''}${st.left < 0 ? `${fmtDur(-st.left)} over` : `${fmtDur(st.left)} left`}`,
              mono: p.name.slice(0, 1).toUpperCase(), color: p.color, active: p.id === E.curId(),
              onClick: () => { E.setCur(p.id); lastLvl = ''; panel.close(); draw(); if (page === 'hist') drawHist(); } }));
          }
        },
      });
    }

    // ================================================================ bonus minutes
    function openBonus() {
      const p = cur();
      if (!p) return;
      openPanel({
        title: 'Bonus minutes',
        build(body, panel) {
          const sc = h('div.pt-form');
          const now = h('div.pt-bonusnow');
          const drawNow = () => { const st = E.status(p); now.replaceChildren(h('b', st.bonus ? `+${fmtMin(st.bonus)}` : 'None yet'), h('span', `for ${p.name} today`)); };
          sc.append(h('div.pt-note', `Extra play time for today only — on top of ${fmtMin(E.baseBudget(p))}.`), now,
            h('div.chips', [10, 15, 30, 60].map((m) => h('button.chip', { type: 'button', onclick: () => { E.grantBonus(p.id, m); app.sfx('coin'); app.toast(`+${fmtMin(m)} for ${p.name} today`); drawNow(); draw(); } }, `+${m} min`))),
            h('button.pill.small', { type: 'button', onclick: () => { E.clearBonus(p.id); app.sfx('tap'); drawNow(); draw(); } }, 'Remove today’s bonus'),
            h('button.pill.primary', { type: 'button', '--c': E.COLOR, onclick: () => panel.close() }, 'Done'));
          drawNow();
          body.append(sc);
        },
      });
    }

    // ================================================================ settings
    function openSettings() {
      openPanel({
        title: 'Play Time',
        build(body, panel) {
          const sc = h('div.pt-form');
          const render = () => {
            sc.replaceChildren(h('div.pt-lblx', 'Players'));
            for (const p of E.profiles()) {
              const links = (p.links || []).map((id) => (id === 'playstation' ? 'PS' : 'Steam'));
              sc.append(h('button.pt-prow', { type: 'button', '--pc': p.color, onclick: () => editProfile(p, render) },
                h('span.pt-av', p.name.slice(0, 1).toUpperCase()),
                h('span.pt-ptext', h('b', { dir: 'auto' }, p.name), h('small', [`${fmtMin(E.baseBudget(p))} today`, p.session && `${p.session} min sessions`, p.bed && `bed ${fmtHM(p.bed)}`, links.length && `auto: ${links.join(', ')}`].filter(Boolean).join(' · '))),
                h('i', { html: icon('edit') })));
            }
            sc.append(h('button.pill', { type: 'button', onclick: () => editProfile(null, render) }, '+ Add a player'));
            const pin = E.getPin();
            sc.append(h('div.pt-lblx', 'Parent PIN'),
              h('div.pt-note', pin ? 'Players, budgets and bonus minutes are locked with a PIN.' : 'Lock players, budgets and bonus minutes with a 4-digit PIN.'),
              h('div.chips',
                h('button.chip', { type: 'button', onclick: () => newPin(render) }, pin ? 'Change PIN' : 'Set a PIN'),
                pin ? h('button.chip', { type: 'button', onclick: () => { E.setPin(''); app.toast('PIN removed'); render(); } }, 'Remove PIN') : null),
              h('div.pt-note', 'Play Time keeps counting when you leave this app, and warns on any screen while Round Remote is open. Smart-home alerts: Settings → Alerts.'));
          };
          render();
          body.append(sc);
          panel.onDestroy = () => draw();
        },
      });
    }
    function newPin(after) {
      pinPad({ title: 'New PIN', hint: 'Choose 4 digits', check: () => true, done: (a) => {
        pinPad({ title: 'New PIN', hint: 'Once more to confirm', check: (b) => b === a, done: () => { E.setPin(a); unlockedAt = Date.now(); app.toast('PIN set'); after?.(); } });
      } });
    }

    // ---------------------------------------------------------------- edit a player
    function editProfile(existing, after) {
      const draft = existing ? JSON.parse(JSON.stringify(existing)) : E.newProfile();
      draft.wake ||= { h: 7, m: 0 };
      let sel = [0, 1, 2, 3, 4, 5, 6];
      openPanel({
        title: existing ? 'Edit player' : 'New player',
        build(body, panel) {
          const sc = h('div.pt-form');
          // name + colour
          const nameBtn = h('button.pill.pt-namebtn', { type: 'button', dir: 'auto', onclick: async () => {
            const v = await app.editText({ title: 'Player name', value: draft.name, placeholder: 'Name' });
            if (v) { draft.name = v; nameBtn.textContent = v; }
          } }, draft.name);
          const colors = h('div.pt-colors');
          const drawColors = () => colors.replaceChildren(...E.PCOLORS.map((c) => h(`button.pt-col-sw${draft.color === c ? '.on' : ''}`, { type: 'button', 'aria-label': `Colour ${c}`, style: { background: c }, onclick: () => { draft.color = c; drawColors(); } })));
          drawColors();
          sc.append(h('div.pt-lblx', 'Name'), nameBtn, colors);

          // budget per weekday
          const dayRow = h('div.pt-days');
          const val = h('div.pt-bval');
          const drawBudget = () => {
            dayRow.replaceChildren(...LETTERS.map((L, i) => h(`button.pt-dchip${sel.includes(i) ? '.on' : ''}`, { type: 'button', 'aria-label': DAYS[i],
              onclick: () => { sel = sel.includes(i) && sel.length > 1 ? sel.filter((x) => x !== i) : sel.includes(i) ? sel : [...sel, i].sort(); drawBudget(); } },
            h('b', L), h('small', draft.budget[i] ? fmtMin(draft.budget[i]).replace(' min', 'm').replace(' h', 'h').replace(/h (\d+)$/, 'h$1') : 'off'))));
            const vals = [...new Set(sel.map((i) => draft.budget[i]))];
            val.textContent = vals.length === 1 ? (vals[0] ? fmtMin(vals[0]) : 'No gaming') : 'Mixed';
          };
          const bump = (d) => {
            // mixed values: + starts from the highest, − from the lowest, and the selected days end up equal
            const vals = sel.map((i) => draft.budget[i] || 0);
            const base = vals.every((v) => v === vals[0]) ? vals[0] : d > 0 ? Math.max(...vals) - d : Math.min(...vals) - d;
            for (const i of sel) draft.budget[i] = Math.max(0, Math.min(720, base + d));
            app.sfx('tick'); drawBudget();
          };
          const stepper = h('div.pt-stepper',
            h('button.ibtn.small', { type: 'button', 'aria-label': 'Less', onclick: () => bump(-15), html: icon('minus') }), val,
            h('button.ibtn.small', { type: 'button', 'aria-label': 'More', onclick: () => bump(15), html: icon('plus') }));
          const groups = h('div.chips', [['Every day', [0, 1, 2, 3, 4, 5, 6]], ['Sun–Thu', [0, 1, 2, 3, 4]], ['Mon–Fri', [1, 2, 3, 4, 5]], ['Weekend', [5, 6]]].map(([n, d]) =>
            h('button.chip.pt-mini', { type: 'button', onclick: () => { sel = d; drawBudget(); } }, n)));
          drawBudget();
          sc.append(h('div.pt-lblx', 'Daily budget'), dayRow, stepper, groups);

          // session limit
          sc.append(h('div.pt-lblx', 'Session limit'), chipRow([0, 30, 45, 60, 90, 120].map((m) => ({ id: m, name: m ? fmtMin(m) : 'Off' })), draft.session || 0, (v) => { draft.session = v; }),
            h('div.pt-note', 'Warns when one session gets this long — time for a break.'));

          // bedtime
          const bedBox = h('div.pt-bed');
          const drawBed = () => {
            bedBox.replaceChildren(chipRow([{ id: 'off', name: 'Off' }, { id: 'on', name: 'Bedtime' }], draft.bed ? 'on' : 'off', (v) => { draft.bed = v === 'on' ? (draft.bed || { h: 21, m: 0 }) : null; drawBed(); }));
            if (draft.bed) {
              bedBox.append(h('div.pt-times', timeStep('Stop at', draft.bed, drawBed), timeStep('Until', draft.wake, drawBed)),
                h('div.pt-note', `No gaming from ${fmtHM(draft.bed)} to ${fmtHM(draft.wake)} — a warning 15 and 5 minutes before.`));
            }
          };
          drawBed();
          sc.append(h('div.pt-lblx', 'Bedtime'), bedBox);

          // auto-detect
          const autoBox = h('div.pt-auto-box');
          const drawAuto = () => {
            const chips = E.SVCS.map((s) => {
              const svc = provider(s.id);
              const authed = !!svc?.isAuthed?.();
              const other = E.linkedProfile(s.id);
              const on = draft.links.includes(s.id);
              const acct = authed ? (svc.data?.profile?.onlineId || svc.data?.profile?.name || store_name(s.id)) : '';
              return h(`button.chip.pt-svc${on ? '.on' : ''}`, { type: 'button', onclick: () => {
                draft.links = on ? draft.links.filter((x) => x !== s.id) : [...draft.links, s.id];
                drawAuto();
              } }, s.name, acct ? h('small', ` · ${acct}`) : null, !on && other && other.id !== draft.id ? h('small', ` · now ${other.name}`) : null);
            });
            const notes = E.SVCS.filter((s) => draft.links.includes(s.id) && !provider(s.id)?.isAuthed?.()).map((s) => `${s.name} isn’t signed in yet — open Home → ${s.name} to sign in (needs the bridge).`);
            autoBox.replaceChildren(h('div.chips', chips), h('div.pt-note', notes.length ? notes.join(' ') : 'Counts by itself while this player is in a game on the linked account. Each account belongs to one player.'));
          };
          drawAuto();
          sc.append(h('div.pt-lblx', 'Auto-detect'), autoBox);

          // when time is up
          const ps = provider('playstation');
          sc.append(h('div.pt-lblx', 'When time is up'),
            h('div.chips.multi',
              toggleChip('Rest the PS5', () => draft.restPs, (v) => { draft.restPs = v; }),
              toggleChip('Pause the music', () => draft.pauseMusic, (v) => { draft.pauseMusic = v; })),
            h('div.pt-note', `Rest mode asks first: a 60 second countdown with “Saving? +5 min” and “Rest now”. ${ps?.power ? `Console: ${ps.power.name || 'PlayStation'} (${ps.power.via === 'ha' ? 'Home Assistant' : 'playactor'}).` : 'Needs the PS5 in Home Assistant (ps5-mqtt) or playactor on the bridge.'}`));

          // buttons
          const save = () => {
            let list = E.profiles();
            // an account belongs to one player
            list = list.map((p) => (p.id === draft.id ? p : { ...p, links: (p.links || []).filter((l) => !draft.links.includes(l)) }));
            const i = list.findIndex((p) => p.id === draft.id);
            if (i >= 0) list[i] = draft; else list.push(draft);
            E.saveProfiles(list);
            if (!existing) E.setCur(draft.id);
            app.sfx('pop'); panel.close(); lastLvl = ''; draw(); after?.();
          };
          sc.append(h('div.pt-btns',
            h('button.pill.primary', { type: 'button', '--c': E.COLOR, onclick: save }, 'Save'),
            existing ? h('button.pill.danger', { type: 'button', onclick: () => confirmDelete(existing, () => { panel.close(); after?.(); draw(); }) }, 'Delete') : null));
          body.append(sc);
          panel.onKey = (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); bump(15); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); bump(-15); }
          };
          keyPanel = panel;
        },
      });
    }
    const store_name = (id) => { try { return app.store.auth(id)?.name || ''; } catch { return ''; } };
    function confirmDelete(p, done) {
      openPanel({
        title: 'Delete player?',
        build(body, panel) {
          body.append(h('div.pt-form', h('div.pt-note', `${p.name} and their history will be removed.`),
            h('div.pt-btns', h('button.pill.danger', { type: 'button', onclick: () => { E.deleteProfile(p.id); panel.close(); done(); } }, 'Delete'),
              h('button.pill', { type: 'button', onclick: () => panel.close() }, 'Keep'))));
        },
      });
    }
    function chipRow(items, value, set) {
      const row = h('div.chips');
      const drawRow = () => row.replaceChildren(...items.map((it) => h(`button.chip${it.id === value ? '.on' : ''}`, { type: 'button', onclick: () => { value = it.id; set(it.id); drawRow(); } }, it.name)));
      drawRow();
      return row;
    }
    function toggleChip(name, get, set) {
      const b = h(`button.chip${get() ? '.on' : ''}`, { type: 'button', onclick: () => { set(!get()); b.classList.toggle('on', get()); } }, name);
      return b;
    }
    function timeStep(label, hm, onChange) {
      const t = h('b', fmtHM(hm));
      const bump = (d) => { const m = (hm.h * 60 + hm.m + d + 1440) % 1440; hm.h = Math.floor(m / 60); hm.m = m % 60; t.textContent = fmtHM(hm); app.sfx('tick'); onChange?.(); };
      const box = h('div.pt-tstep', h('small', label),
        h('div.pt-trow', h('button.ibtn.small', { type: 'button', 'aria-label': `${label} earlier`, onclick: () => bump(-15), html: icon('minus') }), t,
          h('button.ibtn.small', { type: 'button', 'aria-label': `${label} later`, onclick: () => bump(15), html: icon('plus') })));
      return box;
    }

    // ================================================================ loop, keys, engine updates
    const offs = [E.events.on('change', () => { draw(); if (page === 'hist') drawHist(); })];
    app.every(250, draw);
    app.every(5000, () => { if (page === 'hist') drawHist(); });
    app.onKey((e) => {
      if (document.querySelector('.rk-ring')) return;
      const tp = topPanel();
      if (tp) { if (tp === keyPanel && tp.onKey) tp.onKey(e); return; }
      if (!cur()) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); locked(() => editProfile(null)); } return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (page === 'hist' && e.shiftKey) { weekOff = Math.max(0, weekOff + (e.key === 'ArrowLeft' ? 1 : -1)); drawHist(); }
        else cycle(e.key === 'ArrowRight' ? 1 : -1);
      } else if ((e.key === 'Enter' || e.key === ' ') && page === 'main') { e.preventDefault(); toggle(); }
      else if (e.key === 'h' || e.key === 'H') showPage(page === 'hist' ? 'main' : 'hist');
    });
    showPage('main');
    return {
      destroy() { offs.forEach((f) => f()); window.removeEventListener('keydown', panelKeys, true); },
      back() { if (page !== 'main') { showPage('main'); return true; } return false; },
    };
  },
};
