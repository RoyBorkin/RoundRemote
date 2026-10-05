// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Focus — a Pomodoro timer: 25 minutes of focus, a 5-minute break, a longer break every 4 (all editable; presets
// 25/5, 50/10, 90/20). A big round progress ring, what you're working on (with a recent list), session dots,
// auto-start, pause / skip / reset. Optional focus music (a playlist from your music service, the song that's on,
// or Sleep Sounds noise) and Home Assistant lights per phase (a scene, or a light colour). Phase changes chime, show
// here and notify (Settings → Alerts, source 'focus'). Daily focus minutes, a week chart and a streak.
// The timer keeps running when you leave the app (focus-engine.js).
import { h } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { topPanel, curve, listRow, emptyNote, spinner } from '../js/ui/overlay.js';
import { player } from '../js/core/player.js';
import * as F from './focus-engine.js';
import { ico, lic, panel, form, lbl, note, chipRow, numStepper, colorChips, pickEntities, ensureStyle } from './plants-ui.js';
import { haReady, entityName } from './plants-ha.js';

const pad = (n) => String(n).padStart(2, '0');
const mmss = (ms) => { const s = Math.ceil(ms / 1000); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`; };
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const IC = {
  skip: 'M6 5.5v13l9-6.5zM17.5 5.5v13',
  reset: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4 3.5v4h4',
  chart: 'M4 20h16M7 20v-6M12 20V8M17 20v-9',
  note: 'M9 18.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM9 18.5V5l11-2v13M20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM9 9l11-2',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z',
};

export default {
  css: './focus.css',
  create(el, app) {
    ensureStyle();
    F.startFocus();
    F.viewer(true);
    const P = (o) => panel(o, F.COLOR);

    const svg = h('div.fc-ring', { html: `<svg viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="92" class="fc-track"/>
      <g class="fc-ticks"></g>
      <circle cx="100" cy="100" r="92" class="fc-arc" pathLength="1000" transform="rotate(-90 100 100)"/>
      <g class="fc-headg"><circle cx="100" cy="8" r="5" class="fc-head"/></g></svg>` });
    const ticks = svg.querySelector('.fc-ticks');
    for (let i = 0; i < 60; i++) {
      if (i > 24 && i < 36) continue;   // room for the buttons at the bottom
      const a = (i / 60) * Math.PI * 2, r1 = i % 5 ? 84 : 81.5, r2 = 86.5;
      ticks.insertAdjacentHTML('beforeend', `<line x1="${100 + Math.sin(a) * r1}" y1="${100 - Math.cos(a) * r1}" x2="${100 + Math.sin(a) * r2}" y2="${100 - Math.cos(a) * r2}" class="${i % 5 ? '' : 'q'}"/>`);
    }
    const arc = svg.querySelector('.fc-arc'), headG = svg.querySelector('.fc-headg');
    const today = h('button.fc-today', { type: 'button', onclick: () => statsPanel() });
    const phase = h('div.fc-phase');
    const time = h('button.fc-time', { type: 'button', 'aria-label': 'Start or pause', onclick: () => { F.toggle(); app.sfx('tap'); } });
    const taskBtn = h('button.fc-task', { type: 'button', dir: 'auto', onclick: () => taskPanel() });
    const dotsEl = h('div.fc-dots');
    const playBtn = h('button.fc-play', { type: 'button', 'aria-label': 'Start', onclick: () => { F.toggle(); app.sfx('tap'); } });
    const resetBtn = h('button.fc-ctl.fc-reset', { type: 'button', 'aria-label': 'Reset', title: 'Reset (hold: new cycle)', html: lic(IC.reset) });
    const skipBtn = h('button.fc-ctl.fc-skip', { type: 'button', 'aria-label': 'Skip to the next phase', title: 'Skip', onclick: () => { F.skip(); app.sfx('whoosh'); }, html: lic(IC.skip) });
    const setBtn = h('button.fc-small.l', { type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => settingsPanel(), html: ico('gear') });
    const statBtn = h('button.fc-small.r', { type: 'button', 'aria-label': 'Stats', title: 'Stats', onclick: () => statsPanel(), html: lic(IC.chart) });
    const flash = h('div.fc-flash');
    const root = h('div.fc.pk-scope', flash, svg, today, phase, time, taskBtn, dotsEl, resetBtn, playBtn, skipBtn, setBtn, statBtn);
    app.hideTitle();
    el.append(root);

    // reset: tap = back to Ready, hold = also clear the session dots
    let holdT = 0, held = false;
    resetBtn.addEventListener('pointerdown', () => { held = false; holdT = setTimeout(() => { held = true; F.reset({ cycle: true }); app.sfx('drop'); app.toast('New cycle'); }, 650); });
    resetBtn.addEventListener('pointerup', () => clearTimeout(holdT));
    resetBtn.addEventListener('pointerleave', () => clearTimeout(holdT));
    resetBtn.addEventListener('click', () => { if (!held) { F.reset(); app.sfx('tap'); } });

    // ---------------------------------------------------------------- drawing
    let lastKey = '';
    function draw() {
      const r = F.run(), c = F.cfg();
      const ph = F.PHASES[r.phase];
      const col = r.phase === 'idle' ? F.COLOR : ph.color;
      root.style.setProperty('--pc', col);
      root.dataset.phase = r.phase;
      root.classList.toggle('running', r.running);
      const ready = r.phase !== 'idle' && !r.running && r.remain >= r.total;
      phase.textContent = msg && msg.until > Date.now() ? msg.text : r.phase === 'idle' ? `Focus · ${c.focus} min` : `${ph.name}${ready ? ' · ready' : !r.running ? ' · paused' : ''}`;
      const t = F.task();
      taskBtn.replaceChildren(t ? h('span', t) : h('span.ph', 'What are you working on?'), h('i', { html: ico('edit') }));
      const n = c.every, done = r.phase === 'idle' ? r.done % n : Math.min(n, r.done);
      dotsEl.replaceChildren(...Array.from({ length: n }, (_, i) => h(`i${i < done ? '.on' : ''}${i === done && r.phase === 'focus' ? '.cur' : ''}`)));
      dotsEl.title = `${done} of ${n} before a long break`;
      playBtn.innerHTML = icon(r.running ? 'pause' : 'play');
      playBtn.setAttribute('aria-label', r.running ? 'Pause' : 'Start');
      playBtn.classList.toggle('on', r.running);
      skipBtn.disabled = r.phase === 'idle';
      const st = F.todayStats(), sk = F.streak();
      today.replaceChildren(...[h('b', fmtMin(st.min)), h('span', 'today'), sk.current ? h('em', { html: ico('flame') }) : null, sk.current ? h('span.n', String(sk.current)) : null].filter(Boolean));
      today.title = `${st.n} focus session${st.n === 1 ? '' : 's'} today${sk.current ? ` · ${sk.current}-day streak` : ''}`;
      tickDraw();
    }
    function tickDraw() {
      const rem = F.remaining();
      const s = mmss(rem);
      if (time.textContent !== s) time.textContent = s;
      time.classList.toggle('long', s.length > 5);
      const f = F.progress();
      arc.style.strokeDasharray = `${(f * 1000).toFixed(1)} 1000`;
      headG.style.transform = `rotate(${(f * 360).toFixed(2)}deg)`;
      headG.style.opacity = f > 0.001 && f < 0.999 ? 1 : 0;
      const k = `${F.run().phase}|${F.run().running}`;
      if (k !== lastKey) { lastKey = k; }
    }

    // ---------------------------------------------------------------- phase end (on screen)
    const onEnd = ({ from, to, skipped }) => {
      if (skipped) return;
      root.classList.remove('flashing'); void root.offsetWidth; root.classList.add('flashing');
      setTimeout(() => root.classList.remove('flashing'), 2600);
      msg = { text: from === 'focus' ? (to === 'long' ? 'Done — long break!' : 'Done — take a break') : 'Break over', until: Date.now() + 5000 };
      draw();
      setTimeout(draw, 5100);
    };
    let msg = null;

    // ---------------------------------------------------------------- task
    function taskPanel() {
      P({
        title: 'Working on',
        build(body, p) {
          const sc = form();
          const render = () => {
            const rec = F.recent(), cur = F.task();
            sc.replaceChildren(...[
              h('button.pill.primary', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'What are you working on?', value: cur, placeholder: 'e.g. Write the report', okLabel: 'OK' }); if (v !== null) { F.setTask(v); p.close(); } } }, cur ? 'Edit…' : 'Type it…'),
              rec.length ? lbl('Recent') : null,
              ...rec.map((t) => h(`div.fc-rec${t === cur ? '.on' : ''}`,
                h('button.fc-rect', { type: 'button', dir: 'auto', onclick: () => { F.setTask(t); app.sfx('tick'); p.close(); } }, t),
                h('button.fc-recx', { type: 'button', 'aria-label': 'Forget', onclick: () => { F.forgetRecent(t); render(); }, html: icon('close') }))),
              cur ? h('button.pill.small', { type: 'button', onclick: () => { F.setTask(''); p.close(); } }, 'Clear') : null].filter(Boolean));
          };
          render();
          body.append(sc);
        },
      });
    }

    // ---------------------------------------------------------------- stats
    function statsPanel() {
      P({
        title: 'Focus stats',
        build(body) {
          const wk = F.week(), max = Math.max(30, ...wk.map((d) => d.min));
          const st = F.todayStats(), sk = F.streak();
          const tot = wk.reduce((a, d) => a + d.min, 0), sessions = wk.reduce((a, d) => a + d.n, 0);
          body.append(form(
            h('div.fc-stats',
              h('div.fc-stat', h('b', fmtMin(st.min)), h('span', `today · ${st.n} session${st.n === 1 ? '' : 's'}`)),
              h('div.fc-stat', h('b', String(sk.current)), h('span', sk.current === 1 ? 'day streak' : 'days streak'))),
            lbl('This week'),
            h('div.fc-bars', wk.map((d) => h(`div.fc-bar${d.today ? '.today' : ''}`, { title: `${d.key}: ${fmtMin(d.min)} · ${d.n} sessions` },
              h('small', d.min ? String(Math.round(d.min)) : ''), h('i', { style: { height: `${Math.max(d.min ? 4 : 1.5, (d.min / max) * 100)}%` } }), h('span', d.label)))),
            note(`${fmtMin(tot)} in ${sessions} session${sessions === 1 ? '' : 's'} over 7 days`)));
        },
      });
    }

    // ---------------------------------------------------------------- settings
    function settingsPanel() {
      P({
        title: 'Focus settings',
        build(body, p) {
          const sc = form();
          const render = () => {
            const c = F.cfg();
            const set = (patch) => { F.setCfg(patch); };
            const preset = F.PRESETS.find((x) => x.focus === c.focus && x.short === c.short && x.long === c.long)?.id || '';
            const m = c.music, L = c.lights;
            const sw = (on, label, sub, fn) => h('div.pk-row', h('span', label, sub ? h('small', sub) : null),
              h(`button.switch${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: () => { fn(!on); render(); } }));
            const phaseLight = (key, name) => {
              const x = L[key];
              return [lbl(name),
                chipRow([{ id: 'colour', name: 'Colour' }, { id: 'scene', name: 'Scene' }, { id: 'none', name: 'Leave' }], x.kind, (k) => { set({ lights: { ...L, [key]: { ...x, kind: k } } }); render(); }, { cls: 'pk-mini' }),
                x.kind === 'colour' ? colorChips(() => x.color, (col) => set({ lights: { ...F.cfg().lights, [key]: { ...F.cfg().lights[key], color: col } } }), ['#fff4e0', '#ffffff', '#fde68a', '#fb923c', '#f43f5e', '#7dd3fc', '#34d399', '#a78bfa']) : null,
                x.kind === 'colour' ? h('div.pk-row', h('span', 'Brightness'), numStepper(() => F.cfg().lights[key].pct, (v) => set({ lights: { ...F.cfg().lights, [key]: { ...F.cfg().lights[key], pct: v } } }), { min: 5, max: 100, step: 5, fmt: (v) => `${v}%` })) : null,
                x.kind === 'scene' ? h('button.pill.small', { type: 'button', onclick: async () => {
                  const ids = await pickEntities({ title: `${name} scene`, domains: ['scene', 'script'], color: F.COLOR });
                  if (ids?.length) { set({ lights: { ...F.cfg().lights, [key]: { ...F.cfg().lights[key], scene: ids[0] } } }); render(); }
                } }, x.scene ? entityName(x.scene) : 'Choose a scene…') : null];
            };
            sc.replaceChildren(...[
              lbl('Preset'),
              chipRow(F.PRESETS, preset, (id) => { const x = F.PRESETS.find((y) => y.id === id); set({ focus: x.focus, short: x.short, long: x.long }); render(); }),
              h('div.pk-row', h('span', 'Focus', h('small', 'minutes')), numStepper(() => F.cfg().focus, (v) => { set({ focus: v }); }, { min: 1, max: 180, step: 5, fmt: (v) => `${v}` })),
              h('div.pk-row', h('span', 'Short break'), numStepper(() => F.cfg().short, (v) => set({ short: v }), { min: 1, max: 60 })),
              h('div.pk-row', h('span', 'Long break'), numStepper(() => F.cfg().long, (v) => set({ long: v }), { min: 1, max: 90, step: 5 })),
              h('div.pk-row', h('span', 'Long break every', h('small', 'focus sessions')), numStepper(() => F.cfg().every, (v) => set({ every: v }), { min: 2, max: 8 })),
              sw(c.auto, 'Auto-start next', 'breaks and focus start by themselves', (v) => set({ auto: v })),
              sw(c.chime, 'Chime', 'when a phase ends', (v) => set({ chime: v })),
              note('Phase changes also notify through Settings → Alerts (source “Focus”).'),
              lbl('Focus music'),
              chipRow([{ id: 'none', name: 'None' }, { id: 'resume', name: 'My music' }, { id: 'playlist', name: 'Playlist' }, { id: 'noise', name: 'Sleep Sounds' }], m.kind, (k) => { set({ music: { ...m, kind: k } }); render(); if (k === 'playlist' && !m.playlist) pickPlaylist(render); }, { cls: 'pk-mini' }),
              m.kind === 'resume' ? note('Plays whatever is on in your music service when focus starts.') : null,
              m.kind === 'playlist' ? h('button.pill.small', { type: 'button', dir: 'auto', onclick: () => pickPlaylist(render) }, m.playlist ? m.playlist.name : 'Choose a playlist…') : null,
              m.kind === 'noise' ? noisePick(m, render) : null,
              m.kind !== 'none' ? sw(m.pauseOnBreak, 'Pause it on breaks', '', (v) => set({ music: { ...F.cfg().music, pauseOnBreak: v } })) : null,
              lbl('Lights'),
              sw(L.on, 'Change the lights', haReady() ? 'Home Assistant · per phase' : 'needs Home Assistant', (v) => set({ lights: { ...L, on: v } })),
              ...(L.on ? [
                h('button.pill.small', { type: 'button', onclick: async () => {
                  const ids = await pickEntities({ title: 'Lights', domains: ['light'], multi: true, selected: L.ids, color: F.COLOR });
                  if (ids) { set({ lights: { ...F.cfg().lights, ids } }); render(); }
                } }, L.ids.length ? `${L.ids.length} light${L.ids.length > 1 ? 's' : ''}: ${L.ids.map(entityName).join(', ')}` : 'Choose lights…'),
                ...phaseLight('focus', 'During focus'), ...phaseLight('brk', 'During breaks'),
                note('When you reset, the lights go back to how they were.'),
              ] : []),
            ].filter(Boolean));
          };
          render();
          body.append(sc);
          p.onDestroy = () => draw();
        },
      });
    }
    function noisePick(m, render) {
      const wrap = h('div.chips.multi');
      import('./noise-engine.js').then((N) => {
        wrap.replaceChildren(...N.SOUNDS.map((s) => h(`button.chip.pk-mini${(m.noise || []).includes(s.id) ? '.on' : ''}`, { type: 'button', onclick: () => {
          let l = [...(F.cfg().music.noise || [])];
          l = l.includes(s.id) ? l.filter((x) => x !== s.id) : [...l, s.id].slice(-3);
          F.setCfg({ music: { ...F.cfg().music, noise: l } }); render();
        } }, s.name)));
      });
      return wrap;
    }
    function pickPlaylist(render) {
      const pv = player.provider;
      P({
        title: 'Playlist',
        build(body, p) {
          const list = h('div.list.pk-list');
          body.append(list); curve(list);
          if (!pv) { list.append(emptyNote('Open a music service first (from Home) — then its playlists show here.')); return; }
          if (!pv.caps?.playlists) { list.append(emptyNote(`${pv.name || 'This service'} has no playlists.`)); return; }
          list.append(spinner());
          pv.getPlaylists().then((pls) => {
            list.replaceChildren(...(pls?.length ? pls.map((pl) => listRow({ title: pl.name, subtitle: pl.subtitle || '', art: typeof pl.art === 'string' && pl.art.length < 600 ? pl.art : '', mono: '♪', color: F.COLOR,
              onClick: () => { F.setCfg({ music: { ...F.cfg().music, kind: 'playlist', svc: pv.id, playlist: { id: pl.id, name: pl.name, uri: pl.uri, art: typeof pl.art === 'string' && pl.art.length < 600 ? pl.art : '' } } }); p.close(); render(); } })) : [emptyNote('No playlists found.')]));
          }).catch((e) => list.replaceChildren(emptyNote(`Couldn’t load playlists: ${e?.message || e}`)));
        },
      });
    }

    // ---------------------------------------------------------------- keys & updates
    const offs = [F.events.on('change', draw), F.events.on('end', onEnd)];
    app.raf(() => tickDraw());
    app.every(30000, draw);
    app.onKey((e) => {
      if (topPanel() || document.querySelector('.rk-ring')) return;
      const r = F.run();
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); F.toggle(); app.sfx('tap'); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (r.phase === 'idle') { const c = F.cfg(); F.setCfg({ focus: Math.max(5, Math.min(180, c.focus + (e.key === 'ArrowRight' ? 5 : -5))) }); app.sfx('tick'); }
        else if (e.key === 'ArrowRight') { F.skip(); app.sfx('whoosh'); }
      } else if (e.key === 's') { F.skip(); } else if (e.key === 'r') { F.reset(); } else if (e.key === 't') taskPanel();
    });
    draw();
    return {
      destroy() { offs.forEach((f) => f()); F.viewer(false); clearTimeout(holdT); },
    };
  },
};
