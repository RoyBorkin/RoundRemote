// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Trivia Night: a quiz on the round display. Teams join on their phones (scan the QR code) and use them as buzzers
// or answer pads — or play without phones by passing the remote. Three modes:
//   • Buzzers — the first team to buzz answers out loud and the host marks ✓ / ✗ (a wrong answer locks that team
//     out and re-opens the buzzers). The bridge stamps every buzz the moment it arrives, so the fastest phone wins.
//   • Multiple choice — everyone answers A–D on their phone before the timer runs out; faster correct answers score
//     more (team score = the average of its players).
//   • Pass the remote — no phones: teams take turns answering A–D on the display (tap or knob).
// Questions: the built-in bank (English and Hebrew, 10 categories, three difficulties), Open Trivia DB (online), and
// your own (typed here, or from a phone in host mode). Rounds, a timer ring, a scoreboard and a final podium with
// confetti — and, optionally, Home Assistant lights flashing in the winning team's colour.
import { clear } from '../js/ui/dom.js';
import { curve, listRow, spinner } from '../js/ui/overlay.js';
import { CATS, EN } from './trivia-bank.js';
import { HE } from './trivia-bank-he.js';
import { partyLink, qrBox, linkProblem, confetti, haReady, haEntities, haCall } from './party-link.js';

const TEAMS = [
  { id: 'red', name: 'Red', he: 'האדומים', color: '#ef4444' }, { id: 'blue', name: 'Blue', he: 'הכחולים', color: '#3b82f6' },
  { id: 'green', name: 'Green', he: 'הירוקים', color: '#22c55e' }, { id: 'yellow', name: 'Yellow', he: 'הצהובים', color: '#eab308' },
  { id: 'purple', name: 'Purple', he: 'הסגולים', color: '#a855f7' }, { id: 'orange', name: 'Orange', he: 'הכתומים', color: '#f97316' },
];
const OPT = ['#ef4444', '#3b82f6', '#eab308', '#22c55e'];
const MODES = [['buzzer', 'Buzzers', '🔔'], ['mc', 'Multiple choice', '🅰'], ['remote', 'Pass the remote', '📺']];
const OTDB = 'https://opentdb.com';
const DIFF = ['', 'Easy', 'Medium', 'Hard'];
const hasHe = (s) => /[֐-׿]/.test(s || '');
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hash = (s) => { let x = 7; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0; return (x >>> 0).toString(36); };
const catOf = (id) => CATS.find((c) => c.id === id);

function parseBank(src, lang) {
  const out = [];
  for (const [cat, txt] of Object.entries(src)) {
    txt.trim().split('\n').forEach((line, i) => {
      const [d, q, a, ...w] = line.split('|');
      out.push({ id: `${lang}:${cat}:${i}`, cat, d: +d, q, a, w, lang, src: 'builtin' });
    });
  }
  return out;
}
let BANK = null;
const bank = () => (BANK ||= [...parseBank(EN, 'en'), ...parseBank(HE, 'he')]);

const DEF_SETUP = { mode: 'mc', teams: ['red', 'blue'], names: {}, lang: 'en', cats: [], diff: 0, rounds: 3, per: 5, timer: 20, buzzWin: 30, answerSecs: 10,
  src: { builtin: true, mine: true, otdb: false }, otdbCats: [], catPerRound: false, flash: { on: false, ids: [] }, sounds: true };

export default {
  css: './trivia.css',
  create(el, app) {
    const { h, icon } = app;
    el.classList.add('tv');
    const setup = () => { const s = { ...DEF_SETUP, ...app.data('setup', {}) }; s.src = { ...DEF_SETUP.src, ...(s.src || {}) }; s.flash = { ...DEF_SETUP.flash, ...(s.flash || {}) }; return s; };
    const putSetup = (p) => { app.save('setup', { ...app.data('setup', {}), ...p }); };
    const mine = () => app.data('mine', []);
    let players = app.data('players', {});      // device → { name, team }
    let G = app.data('game', null);             // the running game (kept so a reload can resume)
    let page = null, sel = 0, tickT = 0, offs = [], leaveAsk = 0;
    const saveG = () => app.save('game', G);
    const sfx = (n, o) => { if (setup().sounds) app.sfx(n, o); };
    const teamList = () => setup().teams.map((id) => { const t = TEAMS.find((x) => x.id === id); const s = setup(); return { ...t, name: s.names[id] || (s.lang === 'he' ? t.he : t.name) }; });
    const teamById = (id) => teamList().find((t) => t.id === id);

    // ------------------------------------------------------------------ phones
    const link = partyLink('trivia', app, { onAct });
    offs.push(link.events.on('status', () => { if (page === 'setup') drawSetupBar(); if (page === 'lobby') drawLobby(); }));
    function onAct(a) {
      if (a.type === 'join' || a.type === 'team') {
        const p = players[a.device] || {};
        players[a.device] = { name: a.name || p.name || 'Player', team: a.team || p.team || '' };
        app.save('players', players);
        if (page === 'lobby') drawLobby();
        if (page === 'setup') drawSetup();
        publish(); return;
      }
      if (a.type === 'addq') {
        const list = mine();
        list.push({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), q: a.q, a: a.a, w: a.wrong || [], cat: CATS.some((c) => c.id === a.cat) ? a.cat : 'general', lang: a.lang, d: a.d || 2 });
        app.save('mine', list); app.toast(`Question added from ${a.name || 'a phone'}`); sfx('coin'); return;
      }
      if (!G) return;
      if (a.type === 'buzz' && G.phase === 'question' && G.mode === 'buzzer' && G.buzz?.open && a.bid === G.buzz.id && a.rank === 1 && !(G.buzz.locked || []).includes(a.team)) {
        const p = players[a.device] || { name: a.name };
        G.buzz.open = false;
        G.buzz.first = { team: a.team, name: p.name || a.name || 'Someone', ms: a.ms || 0 };
        G.phase = 'buzzed'; G.ansStart = Date.now();
        saveG(); sfx('laser'); app.vibrate(40);
        drawQuestion(); publish();
        return;
      }
      if (a.type === 'answer' && G.phase === 'question' && G.mode === 'mc' && a.qid === G.q.id && !(a.device in G.answers)) {
        G.answers[a.device] = { choice: a.choice, ms: a.ms || 0 };
        saveG(); sfx('tick');
        const n = Object.keys(G.answers).length, total = activePlayers().length;
        drawAnswered();
        if (total && n >= total) setTimeout(() => { if (G?.phase === 'question' && G.q.id === a.qid) revealMc(); }, 500);
        publish();
      }
    }
    const activePlayers = () => Object.entries(players).filter(([, p]) => p.team && setup().teams.includes(p.team));

    function publish() {
      const s = setup();
      const st = { v: 1, mode: G?.mode || s.mode, phase: G ? G.phase : 'lobby', teams: teamList().map((t) => ({ id: t.id, name: t.name, color: t.color, score: G?.scores?.[t.id] || 0 })),
        players: Object.fromEntries(activePlayers()), cats: CATS.map((c) => ({ id: c.id, name: c.name, he: c.he })) };
      if (G && G.q && ['question', 'buzzed', 'reveal'].includes(G.phase)) {
        const q = G.q;
        st.round = G.round + 1; st.rounds = G.rounds; st.qn = G.qi % G.per + 1; st.per = G.per;
        st.q = { id: q.id, text: q.q, cat: q.cat, catName: q.catName, d: q.d, rtl: hasHe(q.q), opts: G.mode === 'mc' || G.phase === 'reveal' ? q.opts : null,
          limit: G.mode === 'mc' ? G.limit : null, left: G.mode === 'mc' && G.phase === 'question' ? Math.max(0, G.limit * 1000 - (Date.now() - G.qStart)) : null };
        if (G.mode === 'buzzer') st.buzz = { id: G.buzz.id, open: !!G.buzz.open, locked: G.buzz.locked || [], first: G.buzz.first || null };
        if (G.mode === 'mc') { st.answers = Object.fromEntries(Object.entries(G.answers).map(([d, x]) => [d, x.choice])); st.answered = Object.keys(G.answers).length; }
        if (G.phase === 'reveal') { st.reveal = { ans: q.ans, text: q.a, pts: G.lastPts || {} }; st.pts = G.devPts || {}; }
      } else if (G && (G.phase === 'scores' || G.phase === 'final')) { st.round = G.round + 1; st.rounds = G.rounds; }
      link.publish(st);
    }

    // ------------------------------------------------------------------ pages
    const pages = {};
    for (const p of ['setup', 'lobby', 'question', 'scores', 'final']) { pages[p] = h(`div.tv-page.tv-${p}`); el.append(pages[p]); }
    const rim = h('div.tv-rim', { html: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="tv-rim-bg" cx="50" cy="50" r="48.6"/><circle class="tv-rim-fg" cx="50" cy="50" r="48.6" pathLength="100"/></svg>' });
    const fx = h('div.tv-fx');
    el.append(rim, fx);
    function show(p) {
      page = p; el.dataset.page = p;
      for (const [k, v] of Object.entries(pages)) v.classList.toggle('on', k === p);
      app.hideTitle(p === 'question' || p === 'final');
      app.setTitle({ lobby: 'Join the quiz', scores: 'Scoreboard' }[p] || null);
      rim.classList.toggle('on', p === 'question');
      ({ setup: drawSetup, lobby: drawLobby, question: drawQuestion, scores: drawScores, final: drawFinal })[p]?.();
    }

    // ---------------- setup
    function drawSetup() {
      if (page !== 'setup') return;
      const pg = pages.setup; clear(pg);
      const s = setup();
      const modes = h('div.tv-modes', ...MODES.map(([id, label, ic]) => h(`button.tv-mode${s.mode === id ? '.on' : ''}`, { type: 'button', onclick: () => { putSetup({ mode: id }); sfx('tap'); drawSetup(); publish(); } }, h('span.tv-mode-i', ic), h('span', label))));
      const counts = {};
      for (const [, p] of activePlayers()) counts[p.team] = (counts[p.team] || 0) + 1;
      const teams = h('div.tv-teams', ...teamList().map((t) => h('button.tv-team', { type: 'button', '--t': t.color, onclick: () => teamMenu(t) },
        h('span.tv-team-sw'), h('span.tv-team-n', { dir: 'auto' }, t.name), counts[t.id] ? h('span.tv-team-c', String(counts[t.id])) : null)),
      s.teams.length < TEAMS.length ? h('button.tv-team.tv-team-add', { type: 'button', 'aria-label': 'Add a team', onclick: () => { const next = TEAMS.find((x) => !s.teams.includes(x.id)); putSetup({ teams: [...s.teams, next.id] }); sfx('pop'); drawSetup(); publish(); }, html: icon('plus') }) : null);
      const srcN = [s.src.builtin && 'Built-in', s.src.otdb && 'Open Trivia DB', s.src.mine && `Mine (${mine().length})`].filter(Boolean);
      const tile = (k, v, fn) => h('button.tv-tile', { type: 'button', onclick: fn }, h('span.tv-tile-k', k), h('span.tv-tile-v', { dir: 'auto' }, v));
      const nCats = s.cats.length;
      const tiles = h('div.tv-tiles',
        tile('Questions', srcN.join(' + ') || 'None', () => openSources()),
        tile('Language', { en: 'English', he: 'עברית', both: 'Both' }[s.lang], () => { const order = ['en', 'he', 'both']; putSetup({ lang: order[(order.indexOf(s.lang) + 1) % 3] }); sfx('tap'); drawSetup(); publish(); }),
        tile('Categories', !nCats ? 'All 10' : nCats === 1 ? catOf(s.cats[0])?.name : `${nCats} picked${s.catPerRound ? ' · 1 per round' : ''}`, () => openCats()),
        tile('Rounds', `${s.rounds} × ${s.per} questions`, () => openRounds()),
        tile('Timer', s.mode === 'buzzer' ? `${s.buzzWin} s to buzz` : `${s.timer} s`, () => openRounds()),
        tile('Difficulty', s.diff ? DIFF[s.diff] : 'Any', () => { putSetup({ diff: (s.diff + 1) % 4 }); sfx('tap'); drawSetup(); }));
      pg.append(modes, teams, tiles, h('div.tv-bar.tv-setup-bar'));
      drawSetupBar();
    }
    function drawSetupBar() {
      const bar = pages.setup.querySelector('.tv-setup-bar');
      if (!bar) return;
      clear(bar);
      const s = setup();
      bar.append(
        h('button.tv-btn', { type: 'button', 'aria-label': 'My questions', onclick: () => openMine() }, h('i', { html: icon('edit') }), h('span', 'My questions')),
        h('button.pill.primary.tv-go', { type: 'button', onclick: () => startGame() }, h('i', { html: icon('play') }), s.mode === 'remote' ? 'Start' : 'Next: join'),
        h('button.tv-btn', { type: 'button', 'aria-label': 'Options', onclick: () => openOptions() }, h('i', { html: icon('settings') }), h('span', 'Options')));
    }

    function teamMenu(t) {
      app.openPanel({
        title: 'Team', className: 'tvq-panel',
        build(body, panel) {
          const s = setup();
          const box = h('div.list'); body.append(box);
          box.append(h('div.tv-teamhead', { '--t': t.color }, h('span.tv-team-sw.big'), h('b', { dir: 'auto' }, t.name)),
            listRow({ title: 'Rename', mono: '✎', onClick: async () => { panel.close(); const v = await app.editText({ title: 'Team name', value: t.name, okLabel: 'Save' }); if (v) { putSetup({ names: { ...setup().names, [t.id]: v.slice(0, 24) } }); drawSetup(); publish(); } } }),
            ...(s.teams.length > 2 ? [listRow({ title: 'Remove this team', mono: '✕', onClick: () => { panel.close(); putSetup({ teams: s.teams.filter((x) => x !== t.id) }); drawSetup(); publish(); } })] : []));
          const ps = activePlayers().filter(([, p]) => p.team === t.id);
          if (ps.length) { box.append(h('div.tv-sh', 'Players')); for (const [, p] of ps) box.append(listRow({ title: p.name, mono: '●', color: t.color })); }
        },
      });
    }
    function openSources() {
      app.openPanel({
        title: 'Questions from', className: 'tvq-panel',
        build(body) {
          const box = h('div.tv-set'); body.append(box);
          const draw = () => {
            clear(box);
            const s = setup();
            const sw = (on, fn) => h(`button.switch${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(on), onclick: fn });
            const row = (l, sub, r) => { if (r?.classList?.contains('switch') && !r.hasAttribute('aria-label')) r.setAttribute('aria-label', l); return h('div.tv-set-row', h('div', h('div', l), h('div.tv-set-sub', sub)), r); };
            const nb = bank().filter((q) => s.lang === 'both' || q.lang === s.lang).length;
            box.append(
              row('Built-in questions', `${nb} in ${s.lang === 'he' ? 'Hebrew' : s.lang === 'en' ? 'English' : 'English and Hebrew'}`, sw(s.src.builtin, () => { putSetup({ src: { ...s.src, builtin: !s.src.builtin } }); draw(); drawSetup(); })),
              row('Open Trivia DB', 'Online, English · opentdb.com', sw(s.src.otdb, () => { putSetup({ src: { ...s.src, otdb: !s.src.otdb } }); draw(); drawSetup(); })),
              row('My questions', `${mine().length} saved`, sw(s.src.mine, () => { putSetup({ src: { ...s.src, mine: !s.src.mine } }); draw(); drawSetup(); })),
              ...(s.src.otdb ? [h('button.pill.small', { type: 'button', onclick: () => openOtdbCats() }, s.otdbCats.length ? `Open Trivia DB categories: ${s.otdbCats.length}` : 'Open Trivia DB categories: any')] : []));
          };
          draw();
        },
      });
    }
    function openCats() {
      app.openPanel({
        title: 'Categories', className: 'tvq-panel',
        build(body) {
          const grid = h('div.tv-catgrid'); body.append(grid);
          const draw = () => {
            clear(grid);
            const s = setup(), set = new Set(s.cats);
            grid.append(h(`button.tv-cat${!set.size ? '.on' : ''}`, { type: 'button', '--k': '#94a3b8', onclick: () => { putSetup({ cats: [] }); draw(); drawSetup(); } }, h('span', '✦'), h('b', 'All')));
            for (const c of CATS) grid.append(h(`button.tv-cat${set.has(c.id) ? '.on' : ''}`, { type: 'button', '--k': c.color, onclick: () => { set.has(c.id) ? set.delete(c.id) : set.add(c.id); putSetup({ cats: CATS.map((x) => x.id).filter((x) => set.has(x)) }); sfx('tick'); draw(); drawSetup(); } },
              h('span', c.icon), h('b', s.lang === 'he' ? c.he : c.name)));
            grid.append(h('div.tv-set-row.tv-wide', h('div', h('div', 'One category per round'), h('div.tv-set-sub', 'Round 1 = first category, round 2 = the next…')),
              h(`button.switch${s.catPerRound ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(s.catPerRound), 'aria-label': 'One category per round', onclick: () => { putSetup({ catPerRound: !s.catPerRound }); draw(); drawSetup(); } })));
          };
          draw();
        },
      });
    }
    let otdbCatCache = null;
    function openOtdbCats() {
      app.openPanel({
        title: 'Open Trivia DB', className: 'tvq-panel',
        build(body) {
          const box = h('div.list'); body.append(box); curve(box);
          box.append(spinner('Loading categories…'));
          (otdbCatCache ? Promise.resolve(otdbCatCache) : fetch(`${OTDB}/api_category.php`).then((r) => r.json()).then((d) => (otdbCatCache = d.trivia_categories || [])))
            .then((cats) => {
              const draw = () => {
                clear(box);
                const s = setup(), set = new Set(s.otdbCats);
                box.append(listRow({ title: 'Any category', mono: '✦', active: !set.size, onClick: () => { putSetup({ otdbCats: [] }); draw(); } }));
                for (const c of cats) box.append(listRow({ title: c.name.replace(/^Entertainment: |^Science: /, ''), subtitle: c.name.includes(':') ? c.name.split(':')[0] : '', mono: set.has(c.id) ? '✓' : '○', active: set.has(c.id),
                  onClick: () => { set.has(c.id) ? set.delete(c.id) : set.add(c.id); putSetup({ otdbCats: [...set] }); draw(); } }));
              };
              draw();
            }).catch(() => { clear(box); box.append(h('div.empty', 'Couldn’t reach Open Trivia DB — check the internet connection.')); });
        },
      });
    }
    function openRounds() {
      app.openPanel({
        title: 'Rounds & timer', className: 'tvq-panel',
        build(body) {
          const box = h('div.tv-set'); body.append(box);
          const draw = () => {
            clear(box);
            const s = setup();
            const step = (label, sub, val, fmt, key, lo, hi, by = 1) => h('div.tv-set-row', h('div', h('div', label), sub ? h('div.tv-set-sub', sub) : null),
              h('div.tv-step', h('button.ibtn.small', { type: 'button', 'aria-label': 'Less', onclick: () => { putSetup({ [key]: Math.max(lo, val - by) }); draw(); drawSetup(); }, html: icon('minus') }),
                h('b', fmt(val)), h('button.ibtn.small', { type: 'button', 'aria-label': 'More', onclick: () => { putSetup({ [key]: Math.min(hi, val + by) }); draw(); drawSetup(); }, html: icon('plus') })));
            box.append(step('Rounds', null, s.rounds, String, 'rounds', 1, 10), step('Questions per round', null, s.per, String, 'per', 1, 20),
              step('Answer time', 'Multiple choice & pass the remote', s.timer, (v) => `${v} s`, 'timer', 5, 60, 5),
              step('Buzz window', 'Buzzers: time to buzz in', s.buzzWin, (v) => `${v} s`, 'buzzWin', 10, 90, 5),
              step('Answer after a buzz', 'Buzzers: time to answer out loud', s.answerSecs, (v) => `${v} s`, 'answerSecs', 3, 30, 1));
          };
          draw();
        },
      });
    }
    function openOptions() {
      app.openPanel({
        title: 'Options', className: 'tvq-panel',
        build(body) {
          const box = h('div.tv-set'); body.append(box);
          const draw = () => {
            clear(box);
            const s = setup();
            const sw = (on, a, b) => { const [fn, label] = typeof a === 'function' ? [a, b] : [b, a]; return h(`button.switch${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label || null, onclick: fn }); };
            box.append(
              h('div.tv-set-row', h('div', h('div', 'Sounds'), h('div.tv-set-sub', 'Ticks, buzzes and fanfares')), sw(s.sounds, () => { putSetup({ sounds: !s.sounds }); draw(); }, 'Sounds')),
              h('div.tv-set-row', h('div', h('div', 'Flash the lights'), h('div.tv-set-sub', !haReady() ? 'Needs Home Assistant (Home → Home Assistant)' : s.flash.ids.length ? `${s.flash.ids.length} light${s.flash.ids.length === 1 ? '' : 's'} in the winner’s colour` : 'Pick lights for the winner’s colour')),
                sw(s.flash.on && haReady(), 'Flash the lights', () => { if (!haReady()) { app.toast('Set up Home Assistant first'); return; } putSetup({ flash: { ...s.flash, on: !s.flash.on } }); draw(); if (!s.flash.on && !s.flash.ids.length) pickLights(draw); })),
              ...(s.flash.on && haReady() ? [h('button.pill.small', { type: 'button', onclick: () => pickLights(draw) }, 'Choose lights')] : []),
              h('div.tv-set-row', h('div', h('div', 'Players'), h('div.tv-set-sub', `${activePlayers().length} phone${activePlayers().length === 1 ? '' : 's'} joined`)),
                h('button.pill.small', { type: 'button', onclick: () => { players = {}; app.save('players', players); link.newRoom(); draw(); drawSetup(); publish(); app.toast('New room — players scan again'); } }, 'New room')),
              h('div.tv-set-sub.tv-note', link.status === 'ok' ? `Room ${link.code} — phones connect through the bridge.` : linkProblem(link.reason)));
          };
          draw();
        },
      });
    }
    function pickLights(after) {
      app.openPanel({
        title: 'Lights to flash', className: 'tvq-panel',
        build(body, panel) {
          const box = h('div.list'); body.append(box); curve(box);
          box.append(spinner('Asking Home Assistant…'));
          haEntities('light').then((lights) => {
            clear(box);
            const sel = new Set(setup().flash.ids);
            if (!lights.length) box.append(h('div.empty', 'No lights found.'));
            for (const l of lights) {
              const r = listRow({ title: l.name, subtitle: l.color ? 'Colour light' : 'White only', mono: '💡', active: sel.has(l.id), onClick: () => { sel.has(l.id) ? sel.delete(l.id) : sel.add(l.id); r.classList.toggle('active', sel.has(l.id)); putSetup({ flash: { ...setup().flash, ids: [...sel], on: true } }); } });
              box.append(r);
            }
            box.append(h('button.pill.primary', { type: 'button', onclick: () => { panel.close(); after?.(); } }, 'Done'));
          }).catch((e) => { clear(box); box.append(h('div.empty', e?.message || 'Couldn’t reach Home Assistant')); });
        },
      });
    }

    // ---------------- your own questions
    function openMine() {
      app.openPanel({
        title: 'My questions', className: 'tvq-panel',
        build(body, panel) {
          const top = h('div.tv-mine-top'); const box = h('div.list'); body.append(top, box); curve(box);
          const draw = () => {
            clear(top); clear(box);
            top.append(h('button.pill.small.primary', { type: 'button', onclick: () => addMine(draw) }, '+ Add'), h('button.pill.small', { type: 'button', onclick: () => { panel.close(); hostQr(); } }, 'Add from a phone'));
            const list = mine();
            if (!list.length) box.append(h('div.empty', 'Add your own questions — with three wrong answers they work in every mode; without, in Buzzers mode.'));
            for (const q of list.slice().reverse()) {
              box.append(listRow({ title: q.q, subtitle: `${q.a}${q.w.length >= 3 ? ' · A–D' : ' · buzzers only'} · ${catOf(q.cat)?.name || ''}`, mono: q.lang === 'he' ? 'ע' : 'Q', color: catOf(q.cat)?.color,
                onClick: () => app.openPanel({ title: 'Your question', className: 'tvq-panel tv-qpanel', build(b2, p2) {
                  b2.append(h('div.tv-qp-q', { dir: 'auto' }, q.q), h('div.tv-qp-a', { dir: 'auto' }, `✓ ${q.a}`), ...q.w.map((w) => h('div.tv-qp-w', { dir: 'auto' }, `✗ ${w}`)),
                    h('button.pill.danger', { type: 'button', onclick: () => { app.save('mine', mine().filter((x) => x.id !== q.id)); p2.close(); draw(); drawSetup(); } }, 'Delete'));
                } }) }));
            }
          };
          draw();
        },
      });
    }
    async function addMine(after) {
      const q = await app.editText({ title: 'Question', placeholder: 'Your question', okLabel: 'Next' });
      if (!q) return;
      const a = await app.editText({ title: 'Correct answer', placeholder: 'The answer', okLabel: 'Next' });
      if (!a) return;
      const w = [];
      for (let i = 1; i <= 3; i++) {
        const x = await app.editText({ title: `Wrong answer ${i} of 3 (optional)`, placeholder: i === 1 ? 'Leave empty for buzzer-only' : 'Another wrong answer', okLabel: i < 3 ? 'Next' : 'Save' });
        if (!x) break;
        w.push(x);
      }
      const s = setup();
      const list = mine();
      list.push({ id: 'm' + Date.now().toString(36), q, a, w: w.length === 3 ? w : [], cat: s.cats.length === 1 ? s.cats[0] : 'general', lang: hasHe(q) ? 'he' : 'en', d: 2 });
      app.save('mine', list); sfx('coin'); app.toast('Question saved');
      after?.(); drawSetup();
    }
    async function hostQr() {
      const r = await link.phoneUrl();
      app.openPanel({
        title: 'Add from a phone', className: 'tvq-panel tv-hostqr',
        build(body) {
          if (!r.url) { body.append(h('div.empty', linkProblem(r.reason))); return; }
          body.append(qrBox(`${r.url}&host=${encodeURIComponent(link.key)}`, 'tv-hostqr-code'), h('div.tv-set-sub', 'Host only — this link can add questions. Don’t share it with players.'));
        },
      });
    }

    // ---------------- building a game
    async function buildQuestions(s) {
      const total = s.rounds * s.per;
      const langOk = (q) => s.lang === 'both' || q.lang === s.lang;
      const catOk = (q) => !s.cats.length || s.cats.includes(q.cat);
      const diffOk = (q) => !s.diff || !q.d || q.d === s.diff;
      const needOpts = s.mode !== 'buzzer';
      const seen = new Set(app.data('seen', []));
      let pool = [];
      if (s.src.builtin) pool.push(...bank().filter((q) => langOk(q) && catOk(q) && diffOk(q)));
      if (s.src.mine) pool.push(...mine().filter((q) => langOk(q) && catOk(q) && (!needOpts || q.w.length >= 3)).map((q) => ({ ...q, src: 'mine' })));
      let online = [];
      if (s.src.otdb && s.lang !== 'he') {
        try { online = await fetchOtdb(s, Math.min(50, total)); } catch (e) { app.toast(`Open Trivia DB: ${e.message}`, { kind: 'error' }); }
      }
      // fresh questions first, then ones asked before
      const fresh = shuffle(pool.filter((q) => !seen.has(q.id))), old = shuffle(pool.filter((q) => seen.has(q.id)));
      pool = [...shuffle([...online, ...fresh]), ...old];
      let picked = [];
      if (s.catPerRound && s.cats.length > 1) {
        for (let r = 0; r < s.rounds; r++) {
          const cat = s.cats[r % s.cats.length];
          const mineR = pool.filter((q) => q.cat === cat && !picked.includes(q)).slice(0, s.per);
          picked.push(...mineR);
          if (mineR.length < s.per) picked.push(...pool.filter((q) => !picked.includes(q)).slice(0, s.per - mineR.length));
        }
      } else picked = pool.slice(0, total);
      return picked.map((q) => {
        const opts = q.w.length >= 3 ? shuffle([q.a, ...q.w.slice(0, 3)]) : [q.a];
        const c = catOf(q.cat);
        return { id: `${q.id}#${Math.random().toString(36).slice(2, 6)}`, key: q.id, q: q.q, a: q.a, opts, ans: opts.indexOf(q.a), cat: q.cat, catName: q.catName || (q.lang === 'he' ? c?.he : c?.name) || 'Trivia', d: q.d || 2, lang: q.lang, color: q.color || c?.color || '#60a5fa', icon: c?.icon || '❓' };
      });
    }
    async function fetchOtdb(s, amount) {
      const dif = ['', 'easy', 'medium', 'hard'][s.diff] || '';
      const cats = s.otdbCats.length ? s.otdbCats : [null];
      const per = Math.max(1, Math.ceil(amount / cats.length));
      const out = [];
      for (const c of cats) {
        const url = `${OTDB}/api.php?amount=${per}&type=multiple&encode=url3986${c ? `&category=${c}` : ''}${dif ? `&difficulty=${dif}` : ''}`;
        const r = await fetch(url);
        const d = await r.json();
        if (d.response_code !== 0 && !d.results?.length) continue;
        for (const x of d.results || []) {
          const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
          const q = dec(x.question), cn = dec(x.category);
          out.push({ id: `otdb:${hash(q)}`, cat: 'otdb', catName: cn.replace(/^Entertainment: |^Science: /, ''), d: { easy: 1, medium: 2, hard: 3 }[x.difficulty] || 2, q, a: dec(x.correct_answer), w: x.incorrect_answers.map(dec), lang: 'en', src: 'otdb', color: '#14b8a6' });
        }
      }
      if (!out.length) throw new Error('no questions came back');
      return out;
    }

    async function startGame() {
      const s = setup();
      if (!s.src.builtin && !s.src.otdb && !s.src.mine) { app.toast('Turn on a question source'); return openSources(); }
      if (s.mode !== 'remote' && link.status !== 'ok') {
        app.toast('Phones need the bridge — playing “pass the remote”', { ms: 3200 });
        putSetup({ mode: 'remote' });
      }
      const st = setup();
      if (st.mode === 'remote') return beginQuiz();
      show('lobby');
    }
    let building = false;
    async function beginQuiz() {
      if (building) return;
      building = true;
      const s = setup();
      try {
        const qs = await buildQuestions(s);
        if (!qs.length) { app.toast('No questions match — try more categories, another language or difficulty', { kind: 'error', ms: 3600 }); return; }
        const rounds = Math.max(1, Math.ceil(qs.length / s.per));
        G = { mode: s.mode, qs, qi: -1, per: s.per, rounds: Math.min(s.rounds, rounds), round: 0, scores: Object.fromEntries(s.teams.map((t) => [t, 0])), phase: 'lobby', limit: s.timer,
          turn: 0, answers: {}, buzz: {}, lastPts: {}, devPts: {}, started: Date.now() };
        if (qs.length < s.rounds * s.per) app.toast(`${qs.length} questions found — playing ${G.rounds} round${G.rounds === 1 ? '' : 's'}`);
        nextQuestion();
      } finally { building = false; }
    }

    // ---------------- lobby
    let lobbyQr = null;
    function drawLobby() {
      if (page !== 'lobby') return;
      const pg = pages.lobby; clear(pg);
      const qr = h('div.tv-lqr');
      if (link.status === 'ok') {
        if (lobbyQr?.code === link.code) qr.append(qrBox(lobbyQr.url));
        else link.phoneUrl().then((r) => { if (r.url) { lobbyQr = { code: link.code, url: r.url }; if (page === 'lobby') qr.append(qrBox(r.url)); } });
      } else qr.append(h('div.tv-lqr-off', link.status === 'connecting' ? 'Connecting to the bridge…' : 'No bridge'));
      const cols = h('div.tv-lteams');
      for (const t of teamList()) {
        const ps = activePlayers().filter(([, p]) => p.team === t.id).map(([, p]) => p.name);
        cols.append(h('div.tv-lteam', { '--t': t.color }, h('div.tv-lteam-h', h('span.tv-team-sw'), h('b', { dir: 'auto' }, t.name), h('span.tv-lteam-n', String(ps.length))),
          h('div.tv-lteam-p', { dir: 'auto' }, ps.length ? ps.join(' · ') : '—')));
      }
      const n = activePlayers().length;
      pg.append(qr, h('div.tv-lroom', link.status === 'ok' ? h('span', 'Room ', h('b.tv-code', link.code), ` · ${n} player${n === 1 ? '' : 's'}`) : linkProblem(link.reason)), cols,
        h('div.tv-bar',
          h('button.tv-btn', { type: 'button', 'aria-label': 'Back to setup', onclick: () => show('setup') }, h('i', { html: icon('back') }), h('span', 'Setup')),
          h('button.pill.primary.tv-go', { type: 'button', onclick: () => beginQuiz() }, h('i', { html: icon('play') }), 'Start quiz'),
          h('button.tv-btn', { type: 'button', 'aria-label': 'Play without phones', onclick: () => { putSetup({ mode: 'remote' }); beginQuiz(); } }, h('i', { html: icon('remote') }), h('span', 'No phones'))));
    }

    // ---------------- questions
    function nextQuestion({ fromScores = false } = {}) {
      if (!G) return;
      G.qi++;
      if (G.qi >= Math.min(G.qs.length, G.rounds * G.per)) return finish();
      if (!fromScores && G.qi > 0 && G.qi % G.per === 0) { G.qi--; G.phase = 'scores'; G.peekScores = false; saveG(); show('scores'); publish(); return; }
      G.round = Math.floor(G.qi / G.per);
      G.q = G.qs[G.qi];
      G.answers = {}; G.lastPts = {}; G.devPts = {}; G.peek = false;
      G.qStart = Date.now();
      G.phase = 'question';
      if (G.mode === 'buzzer') { G.buzz = { id: `${G.q.id}:1`, open: true, locked: [], first: null, attempt: 1 }; G.limit = setup().buzzWin; }
      else G.limit = setup().timer;
      if (G.mode === 'remote') { G.turnTeam = setup().teams[G.turn % setup().teams.length]; sel = 0; }
      const seen = app.data('seen', []); seen.push(G.q.key); app.save('seen', seen.slice(-500));
      saveG(); sfx('whoosh');
      show('question'); publish();
    }

    function drawQuestion() {
      if (page !== 'question' || !G?.q) return;
      const pg = pages.question; clear(pg);
      const q = G.q, he = hasHe(q.q);
      rim.style.setProperty('--k', q.color);
      const dots = h('span.tv-dots', ...[1, 2, 3].map((i) => h(`i${i <= q.d ? '.on' : ''}`)));
      pg.append(h('div.tv-meta', h('span.tv-chip', `Round ${G.round + 1}/${G.rounds} · ${G.qi % G.per + 1}/${G.per}`), h('span.tv-chip.cat', { '--k': q.color, dir: 'auto' }, `${q.icon} ${q.catName}`), dots));
      const len = q.q.length;
      pg.append(h(`div.tv-q${he ? '.rtl' : ''}`, { dir: he ? 'rtl' : 'auto', style: { fontSize: `${len < 50 ? 5 : len < 90 ? 4.3 : len < 140 ? 3.7 : 3.2}cqmin` } }, q.q));
      const zone = h('div.tv-zone');
      pg.append(zone);
      if (G.mode === 'buzzer') drawBuzzZone(zone); else drawOptions(zone);
      pg.append(scoreRow(), controls());
      drawAnswered();
    }
    function drawOptions(zone) {
      const q = G.q, rev = G.phase === 'reveal';
      const grid = h(`div.tv-opts${q.opts.some((o) => o.length > 26) ? '.long' : ''}`, { dir: hasHe(q.q) ? 'rtl' : 'ltr' });
      q.opts.forEach((o, i) => {
        const cls = rev ? (i === q.ans ? '.right' : '.dim') : G.mode === 'remote' && i === sel ? '.sel' : '';
        const picked = rev && G.mode === 'remote' && G.remotePick === i && i !== q.ans ? '.wrong' : '';
        grid.append(h(`button.tv-opt${cls}${picked}`, { type: 'button', '--k': OPT[i], disabled: G.mode !== 'remote' || rev ? true : null, onclick: () => remoteAnswer(i) },
          h('span.tv-opt-l', 'ABCD'[i]), h('span.tv-opt-t', { dir: 'auto' }, o)));
      });
      zone.append(grid);
      if (G.mode === 'remote' && !rev) { const t = teamById(G.turnTeam); zone.append(h('div.tv-turn', { '--t': t?.color }, h('span.tv-team-sw'), setup().lang === 'he' ? h('b', { dir: 'rtl' }, `תור ${t?.name || ''}`) : h('b', h('bdi', t?.name || ''), '’s turn'))); }
    }
    function drawBuzzZone(zone) {
      const q = G.q;
      if (G.phase === 'reveal') { zone.append(h('div.tv-answer', h('span.tv-answer-k', 'Answer'), h('span.tv-answer-t', { dir: 'auto' }, q.a))); return; }
      if (G.phase === 'buzzed' && G.buzz.first) {
        const t = teamById(G.buzz.first.team);
        zone.append(h('div.tv-buzzed', { '--t': t?.color || '#888' },
          h('div.tv-buzzed-team', { dir: 'auto' }, t?.name || ''),
          h('div.tv-buzzed-who', h('bdi', G.buzz.first.name), ` · ${(G.buzz.first.ms / 1000).toFixed(2)} s`),
          h('div.tv-judge',
            h('button.tv-no', { type: 'button', 'aria-label': 'Wrong', onclick: () => judge(false), html: icon('close') }),
            h('button.tv-yes', { type: 'button', 'aria-label': 'Correct', onclick: () => judge(true), html: icon('check') }))));
        return;
      }
      const locked = G.buzz.locked || [];
      const n = activePlayers().filter(([, p]) => !locked.includes(p.team)).length;
      zone.append(h('div.tv-buzzwait', h('div.tv-pulse'), h('div.tv-buzzwait-t', 'Buzzers open!'), h('div.tv-buzzwait-s', locked.length ? `${locked.map((id) => teamById(id)?.name).join(', ')} out · ${n} phone${n === 1 ? '' : 's'} can buzz` : `${n} phone${n === 1 ? '' : 's'} ready`)));
      if (G.peek) zone.append(h('div.tv-peek', { dir: 'auto' }, `Answer: ${q.a}`));
    }
    function scoreRow() {
      return h('div.tv-scores', ...teamList().map((t) => {
        const p = G.phase === 'reveal' ? G.lastPts?.[t.id] : null;
        return h(`div.tv-score${G.mode === 'remote' && G.turnTeam === t.id && G.phase !== 'reveal' ? '.turn' : ''}`, { '--t': t.color, dataset: { team: t.id } }, h('span.tv-team-sw'), h('b', String(G.scores[t.id] || 0)),
          p ? h(`span.tv-plus${p < 0 ? '.neg' : ''}`, `${p > 0 ? '+' : ''}${p}`) : null);
      }));
    }
    function controls() {
      const bar = h('div.tv-ctl');
      const btn = (label, ic, fn, cls = '') => h(`button.tv-cbtn${cls}`, { type: 'button', 'aria-label': label, title: label, onclick: fn, html: icon(ic) });
      if (G.phase === 'reveal') bar.append(btn('Scores', 'list', () => { G.phase = 'scores'; G.peekScores = true; saveG(); show('scores'); publish(); }), h('button.pill.primary.tv-next', { type: 'button', onclick: () => nextQuestion() }, 'Next', h('i', { html: icon('next') })), btn('End the quiz', 'stop', () => endEarly()));
      else if (G.mode === 'buzzer') bar.append(btn(G.peek ? 'Hide the answer' : 'Peek at the answer', 'eye', () => { G.peek = !G.peek; drawQuestion(); }, G.peek ? '.on' : ''), h('button.pill.tv-next', { type: 'button', onclick: () => revealBuzz() }, 'Reveal'), btn('Skip question', 'skip', () => revealBuzz()));
      else if (G.mode === 'mc') bar.append(h('span.tv-answered'), h('button.pill.tv-next', { type: 'button', onclick: () => revealMc() }, 'Reveal now'));
      else bar.append(h('button.pill.tv-next', { type: 'button', onclick: () => remoteAnswer(-1) }, 'Pass'));
      return bar;
    }
    function drawAnswered() {
      const el2 = pages.question.querySelector('.tv-answered');
      if (!el2 || !G) return;
      const total = activePlayers().length, n = Object.keys(G.answers || {}).length;
      el2.textContent = total ? `${n}/${total} answered` : 'No phones joined';
    }

    // ---------------- judging & scoring
    function judge(ok) {
      if (!G || G.phase !== 'buzzed') return;
      const t = G.buzz.first.team, d = G.q.d || 2;
      if (ok) {
        G.scores[t] = (G.scores[t] || 0) + 100 * d;
        G.lastPts = { ...(G.wrongPts || {}), [t]: 100 * d }; G.wrongPts = null;
        sfx('perfect'); app.vibrate(30);
        G.phase = 'reveal'; saveG(); drawQuestion(); publish(); return;
      }
      const pen = Math.min(G.scores[t] || 0, 50 * d);
      G.scores[t] = (G.scores[t] || 0) - pen;
      sfx('over');
      const locked = [...(G.buzz.locked || []), t];
      const left = setup().teams.filter((x) => !locked.includes(x));
      G.wrongPts = { ...(G.wrongPts || {}), [t]: -pen };
      if (!left.length) { G.lastPts = G.wrongPts; G.wrongPts = null; G.phase = 'reveal'; saveG(); drawQuestion(); publish(); return; }
      G.buzz = { id: `${G.q.id}:${(G.buzz.attempt || 1) + 1}`, attempt: (G.buzz.attempt || 1) + 1, open: true, locked, first: null };
      G.phase = 'question'; G.qStart = Date.now();
      saveG(); drawQuestion(); publish();
    }
    function revealBuzz() {
      if (!G || (G.phase !== 'question' && G.phase !== 'buzzed')) return;
      G.lastPts = G.wrongPts || {}; G.wrongPts = null;
      G.buzz.open = false; G.phase = 'reveal'; sfx('drop');
      saveG(); drawQuestion(); publish();
    }
    function revealMc() {
      if (!G || G.phase !== 'question' || G.mode !== 'mc') return;
      const limit = G.limit * 1000, q = G.q;
      const devPts = {}, sums = {}, counts = {};
      for (const [dev, p] of activePlayers()) {
        counts[p.team] = (counts[p.team] || 0) + 1;
        const a = G.answers[dev];
        const pts = a && a.choice === q.ans ? Math.round((500 + 500 * Math.max(0, 1 - a.ms / limit)) / 10) * 10 : 0;
        devPts[dev] = pts; sums[p.team] = (sums[p.team] || 0) + pts;
      }
      const lastPts = {};
      for (const t of setup().teams) { const v = counts[t] ? Math.round(sums[t] / counts[t] / 10) * 10 : 0; lastPts[t] = v; G.scores[t] = (G.scores[t] || 0) + v; }
      G.lastPts = lastPts; G.devPts = devPts;
      G.phase = 'reveal';
      sfx(Object.values(lastPts).some((v) => v > 0) ? 'score' : 'drop');
      saveG(); drawQuestion(); publish();
    }
    function remoteAnswer(i) {
      if (!G || G.phase !== 'question' || G.mode !== 'remote') return;
      const t = G.turnTeam, q = G.q, ok = i === q.ans;
      G.remotePick = i;
      const left = Math.max(0, G.limit * 1000 - (Date.now() - G.qStart));
      const pts = ok ? Math.round((100 * q.d + 50 * q.d * left / (G.limit * 1000)) / 10) * 10 : 0;
      if (ok) G.scores[t] = (G.scores[t] || 0) + pts;
      G.lastPts = { [t]: pts };
      G.turn++;
      G.phase = 'reveal';
      sfx(ok ? 'perfect' : 'over');
      saveG(); drawQuestion(); publish();
    }
    // timers: the rim ring, ticks in the last seconds, time up
    let lastSec = -1;
    app.every(100, () => {
      const fg = rim.querySelector('.tv-rim-fg');
      if (!G || page !== 'question') return;
      let frac = 0, left = 0;
      if (G.phase === 'question') { const lim = G.limit * 1000; left = Math.max(0, lim - (Date.now() - G.qStart)); frac = left / lim; }
      else if (G.phase === 'buzzed') { const lim = setup().answerSecs * 1000; left = Math.max(0, lim - (Date.now() - G.ansStart)); frac = left / lim; }
      fg.style.strokeDasharray = `${(frac * 100).toFixed(2)} 100`;
      rim.classList.toggle('low', (G.phase === 'question' || G.phase === 'buzzed') && left < 5000);
      rim.classList.toggle('buzz', G.phase === 'buzzed');
      if (G.phase === 'buzzed') rim.style.setProperty('--k', teamById(G.buzz.first?.team)?.color || G.q.color); else rim.style.setProperty('--k', G.q?.color || '#60a5fa');
      const sec = Math.ceil(left / 1000);
      if ((G.phase === 'question' || G.phase === 'buzzed') && sec !== lastSec) { lastSec = sec; if (sec > 0 && sec <= 5) sfx('tick', { pitch: sec <= 3 ? 1.3 : 1 }); }
      if (G.phase === 'question' && left <= 0) {
        if (G.mode === 'mc') revealMc();
        else if (G.mode === 'buzzer') revealBuzz();
        else remoteAnswer(-1);
      } else if (G.phase === 'buzzed' && left <= 0 && !G.timeUpBuzz) { G.timeUpBuzz = G.buzz.id; sfx('over', { volume: 0.6 }); }
    });

    // ---------------- scores, final
    function drawScores() {
      if (page !== 'scores' || !G) return;
      const pg = pages.scores; clear(pg);
      const ts = teamList().slice().sort((a, b) => (G.scores[b.id] || 0) - (G.scores[a.id] || 0));
      const max = Math.max(1, ...ts.map((t) => G.scores[t.id] || 0));
      const done = G.qi + 1 >= Math.min(G.qs.length, G.rounds * G.per);
      const endOfRound = (G.qi + 1) % G.per === 0;
      pg.append(h('div.tv-sh-h', G.peekScores ? `Round ${G.round + 1} · question ${G.qi % G.per + 1}` : `End of round ${G.round + 1} of ${G.rounds}`),
        h('div.tv-bars', ...ts.map((t, i) => h('div.tv-barrow', { '--t': t.color, style: { animationDelay: `${i * 90}ms` } },
          h('span.tv-bar-pl', String(i + 1)), h('div.tv-bar-track', h('div.tv-bar-fill', { style: { width: `${Math.max(3, (G.scores[t.id] || 0) / max * 100)}%` } }), h('span.tv-bar-n', { dir: 'auto' }, t.name)),
          h('b.tv-bar-s', String(G.scores[t.id] || 0))))),
        h('div.tv-bar',
          h('button.tv-btn', { type: 'button', 'aria-label': 'End the quiz', onclick: () => endEarly() }, h('i', { html: icon('stop') }), h('span', 'End')),
          h('button.pill.primary.tv-go', { type: 'button', onclick: () => { G.peekScores = false; if (done) finish(); else nextQuestion({ fromScores: true }); } }, done ? 'Final results' : endOfRound ? `Round ${G.round + 2}` : 'Next question', h('i', { html: icon('next') })),
          h('span.tv-btn.tv-spacer')));
      if (!G.peekScores) sfx('score');
    }
    function endEarly() { if (!G) return; finish(); }
    function finish() {
      if (!G) return;
      G.phase = 'final'; saveG();
      show('final'); publish();
      const ts = teamList().slice().sort((a, b) => (G.scores[b.id] || 0) - (G.scores[a.id] || 0));
      const w = ts[0];
      sfx('win'); app.vibrate(60);
      setTimeout(() => confetti(fx, [w.color, '#ffd166', '#fff', w.color, '#06d6a0']), 400);
      setTimeout(() => confetti(fx, [w.color, '#fff', '#ffd166']), 1500);
      const hist = app.data('history', []);
      hist.unshift({ at: Date.now(), mode: G.mode, teams: ts.map((t) => ({ name: t.name, color: t.color, score: G.scores[t.id] || 0 })), questions: G.qi + 1 });
      app.save('history', hist.slice(0, 30));
      flashLights(w.color);
    }
    async function flashLights(color) {
      const f = setup().flash;
      if (!f.on || !f.ids.length || !haReady()) return;
      const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
      try {
        await haCall('scene', 'create', null, { scene_id: 'roundremote_trivia_before', snapshot_entities: f.ids }).catch(() => {});
        await haCall('light', 'turn_on', f.ids, { rgb_color: rgb, brightness: 255, flash: 'long' });
        setTimeout(() => haCall('light', 'turn_on', f.ids, { rgb_color: rgb, brightness: 255 }).catch(() => {}), 3000);
        setTimeout(() => haCall('scene', 'turn_on', 'scene.roundremote_trivia_before').catch(() => {}), 12000);
      } catch (e) { console.warn('[trivia] lights', e); }
    }
    function drawFinal() {
      if (page !== 'final' || !G) return;
      const pg = pages.final; clear(pg);
      const ts = teamList().slice().sort((a, b) => (G.scores[b.id] || 0) - (G.scores[a.id] || 0));
      const order = [ts[1], ts[0], ts[2]];
      const pod = h('div.tv-podium', ...order.map((t, i) => {
        if (!t) return h('div.tv-pod.empty');
        const place = [2, 1, 3][i];
        return h(`div.tv-pod.p${place}`, { '--t': t.color, style: { animationDelay: `${[500, 1100, 0][i]}ms` } },
          h('div.tv-pod-name', { dir: 'auto' }, t.name), h('div.tv-pod-score', String(G.scores[t.id] || 0)),
          h('div.tv-pod-block', h('span', place === 1 ? '🏆' : String(place))));
      }));
      const rest = ts.slice(3);
      pg.append(...[h('div.tv-final-h', h('span', 'Winner'), h('b', { dir: 'auto', style: { color: ts[0].color } }, ts[0].name)), pod,
        rest.length ? h('div.tv-rest', ...rest.map((t, i) => h('span.tv-score', { '--t': t.color }, h('span.tv-team-sw'), `${i + 4}. ${t.name} · ${G.scores[t.id] || 0}`))) : null,
        h('div.tv-bar',
          h('button.tv-btn', { type: 'button', 'aria-label': 'Setup', onclick: () => { G = null; saveG(); show('setup'); publish(); } }, h('i', { html: icon('settings') }), h('span', 'Setup')),
          h('button.pill.primary.tv-go', { type: 'button', onclick: () => { G = null; saveG(); setup().mode === 'remote' ? beginQuiz() : (show('lobby'), publish()); } }, h('i', { html: icon('replay') }), 'Play again'),
          h('span.tv-btn.tv-spacer'))].filter(Boolean));
    }

    // ------------------------------------------------------------------ knob / keys
    app.onKey((e) => {
      if (document.querySelector('.panel')) return;
      const k = e.key;
      if (page === 'setup' && (k === 'Enter' || k === ' ')) { e.preventDefault(); startGame(); }
      else if (page === 'lobby' && (k === 'Enter' || k === ' ')) { e.preventDefault(); beginQuiz(); }
      else if (page === 'scores' && (k === 'Enter' || k === ' ')) { e.preventDefault(); pages.scores.querySelector('.tv-go')?.click(); }
      else if (page === 'final' && (k === 'Enter' || k === ' ')) { e.preventDefault(); pages.final.querySelector('.tv-go')?.click(); }
      else if (page === 'question' && G) {
        if (G.phase === 'reveal' && (k === 'Enter' || k === ' ' || k === 'ArrowRight')) { e.preventDefault(); nextQuestion(); }
        else if (G.phase === 'buzzed') { if (k === 'Enter' || k === 'y') { e.preventDefault(); judge(true); } else if (k === 'x' || k === 'n') { e.preventDefault(); judge(false); } }
        else if (G.phase === 'question' && G.mode === 'remote') {
          if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % G.q.opts.length; sfx('tick'); drawQuestion(); }
          else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); sel = (sel + G.q.opts.length - 1) % G.q.opts.length; sfx('tick'); drawQuestion(); }
          else if (k === 'Enter' || k === ' ') { e.preventDefault(); remoteAnswer(sel); }
          else if (/^[a-d1-4]$/i.test(k)) { const i = /\d/.test(k) ? +k - 1 : 'abcd'.indexOf(k.toLowerCase()); if (i < G.q.opts.length) remoteAnswer(i); }
        } else if (G.phase === 'question' && G.mode === 'mc' && (k === 'Enter')) revealMc();
      }
    });

    // resume
    if (G && G.phase && G.phase !== 'lobby') {
      if (G.phase === 'final') show('final');
      else if (G.phase === 'scores') show('scores');
      else { if (G.phase === 'question' || G.phase === 'buzzed') { G.qStart = Date.now(); G.ansStart = Date.now(); if (G.mode === 'buzzer' && G.phase === 'question') G.buzz.open = true; } show('question'); }
    } else { G = null; show('setup'); }
    link.start(); publish();
    return {
      destroy() { link.stop(); for (const off of offs) off(); clearTimeout(tickT); },
      back() {
        if (page === 'lobby') { show('setup'); return true; }
        if (page === 'question' || page === 'scores') {
          if (Date.now() - (leaveAsk || 0) < 2600) { leaveAsk = 0; show('setup'); publish(); app.toast('Quiz paused — Start resumes a new game'); return true; }
          leaveAsk = Date.now(); app.toast('Press Back again to leave the quiz'); return true;
        }
        if (page === 'final') { G = null; saveG(); show('setup'); publish(); return true; }
        return false;
      },
    };
  },
};
