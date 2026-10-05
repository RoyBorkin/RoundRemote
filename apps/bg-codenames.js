// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Codenames (שם קוד): random key cards for the spymasters — shown on THEIR phones through a QR
// link to a static page (apps/phone/codekey.html, the seed is in the link, so no bridge or server is needed),
// and on the display only while "Hold to peek" is held. Agents left per team, whose turn, a sand timer, wins.
// Pictures (5×4 key) and Duet (cooperative, two-sided key, 9 turns) too.
import { h, clear } from '../js/ui/dom.js';
import { openPanel } from '../js/ui/overlay.js';
import { bridgeFetch } from '../js/providers/bridge.js';
import { qrSvg } from './qr.js';
import { genKey, newKey, count } from './bg-codekey.js';
import { seg, celebrate, confirm } from './bg-ui.js';
import { sandTimer } from './bg-timer.js';
const put = (el, ...kids) => el.append(...kids.filter((k) => k != null && k !== false));   // like append(), skipping null / false

const PAGES_URL = 'https://royborkin.github.io/RoundSpotify/apps/phone/codekey.html';
const TEAM = { r: { name: 'Red', he: 'אדום', color: '#dc2626' }, b: { name: 'Blue', he: 'כחול', color: '#2563eb' } };
const TIMES = [0, 30, 60, 90, 120, 180];
const LOCAL = /^(localhost|127\.|\[?::1|0\.0\.0\.0)/;

/** Where phones can open the key page: this site itself, the bridge's LAN address (Pi / local dev), or GitHub Pages. */
export async function keyPageBase() {
  const here = new URL('./phone/codekey.html', import.meta.url);
  if (/^https?:$/.test(here.protocol) && !LOCAL.test(here.hostname)) return here.href;
  try {
    const info = await bridgeFetch('/api/tasks/info', { timeout: 3000 });
    if (info?.publicUrl) return `${String(info.publicUrl).replace(/\/$/, '')}/apps/phone/codekey.html`;
    const ip = info?.ips?.[0];
    if (ip) return `http://${ip}:${info.port || 8765}/apps/phone/codekey.html`;
  } catch {}
  return PAGES_URL;
}

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-cn');
  const S = Object.assign({ mode: 'c', key: '', left: { r: 9, b: 8 }, turn: 'r', secs: 60, wins: { r: 0, b: 0 }, found: 0, turns: 9, duetWins: 0 }, app.data('codenames', {}));
  const save = () => app.save('codenames', S);
  let K = null;
  function fresh(mode = S.mode) {
    S.mode = mode; S.key = newKey(mode); K = genKey(S.key);
    if (mode === 'd') { S.found = 0; S.turns = 9; }
    else { S.left = { r: count(K.cells, 'r'), b: count(K.cells, 'b') }; S.turn = K.start; }
    S.over = null; save();
  }
  if (!S.key || S.key[0] !== S.mode) fresh(); else K = genKey(S.key);

  const tabs = seg([{ v: 'c', label: 'Classic' }, { v: 'p', label: 'Pictures' }, { v: 'd', label: 'Duet' }], S.mode, (v) => { fresh(v); timer.reset(S.secs); render(); app.sfx('tap'); }, 'bg-cat-tabs');
  const timer = sandTimer(app, { seconds: S.secs, label: 'sand timer', cls: 'bg-cn-timer', onEnd: () => app.toast('Time’s up — the turn is over', { ms: 2600 }) });
  const stage = h('div.bg-cn-stage');
  const peek = h('div.bg-cn-peek', { 'aria-hidden': 'true' });
  el.append(tabs, stage, timer.el, peek);

  const disc = (cls, c, big, label, sub, on, extra) => h(`button.bg-cn-team${cls}`, { type: 'button', '--c': c, onclick: on }, h('small', label), h('b', String(big)), h('span', sub), extra);
  function render() {
    clear(stage);
    const duet = S.mode === 'd';
    el.classList.toggle('duet', duet);
    if (duet) {
      put(stage, 
        disc('.left', '#16a34a', `${S.found}`, 'Agents found', 'of 15 · tap +1', () => { if (S.found < 15) { S.found++; app.sfx('score'); save(); render(); if (S.found === 15) win('d'); } },
          h('i.bg-cn-mini', { onclick: (e) => { e.stopPropagation(); S.found = Math.max(0, S.found - 1); save(); render(); } }, '−')),
        disc(`.right${S.turns <= 0 ? '.sudden' : ''}`, '#a16207', S.turns > 0 ? `${S.turns}` : '!', S.turns > 0 ? 'Turns left' : 'Sudden death', S.turns > 0 ? 'tap = clue given' : 'guess without clues', () => { if (S.turns > 0) { S.turns--; app.sfx(S.turns ? 'tick' : 'boom'); save(); timer.reset(S.secs); render(); if (!S.turns) app.toast('Out of time tokens — sudden death: no more clues, any wrong guess loses', { ms: 4000 }); } },
          h('i.bg-cn-mini', { onclick: (e) => { e.stopPropagation(); S.turns = Math.min(11, S.turns + 1); save(); render(); } }, '+')),
        h('div.bg-cn-turn', h('b', 'Cooperative'), h('span', ' · 9 turns, 15 agents · wins: ', h('b', String(S.duetWins || 0)))));
    } else {
      const t = TEAM[S.turn];
      put(stage, 
        disc(`.left${S.turn === 'r' ? '.on' : ''}`, TEAM.r.color, S.left.r, 'Red · אדום', K.start === 'r' ? 'starts · tap = found' : 'agents left', () => found('r'),
          h('i.bg-cn-mini', { onclick: (e) => { e.stopPropagation(); S.left.r = Math.min(count(K.cells, 'r'), S.left.r + 1); save(); render(); } }, '+')),
        disc(`.right${S.turn === 'b' ? '.on' : ''}`, TEAM.b.color, S.left.b, 'Blue · כחול', K.start === 'b' ? 'starts · tap = found' : 'agents left', () => found('b'),
          h('i.bg-cn-mini', { onclick: (e) => { e.stopPropagation(); S.left.b = Math.min(count(K.cells, 'b'), S.left.b + 1); save(); render(); } }, '+')),
        h('button.bg-cn-turn', { type: 'button', '--c': t.color, onclick: () => endTurn() }, h('i'), h('b', `${t.name}’s turn`), h('span', ' · end turn ›')),
        h('div.bg-cn-wins', h('small', 'wins '), h('span', { style: { color: TEAM.r.color } }, `${S.wins.r}`), ' : ', h('span', { style: { color: TEAM.b.color } }, `${S.wins.b}`)));
    }
    const peekBtn = h('button.pill.bg-cn-peekbtn', { type: 'button' }, 'Hold to peek');
    const show = (e) => { e.preventDefault(); showPeek(true); };
    const hide = () => showPeek(false);
    peekBtn.addEventListener('pointerdown', show);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => peekBtn.addEventListener(ev, hide));
    peekBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    put(stage, 
      h('div.bg-cn-acts',
        h('button.pill.primary.bg-cn-qr', { type: 'button', onclick: () => qrPanel() }, duet ? 'Keys → phones' : 'Key → phones'),
        peekBtn,
        h('button.pill', { type: 'button', onclick: async () => { if (await confirm('New game', 'Deal a new random key card and reset the counters?', 'New key')) { fresh(); timer.reset(S.secs); render(); app.sfx('whoosh'); } } }, 'New key')),
      h('div.bg-cn-acts2',
        h('button.chip', { type: 'button', onclick: () => { S.secs = TIMES[(TIMES.indexOf(S.secs) + 1) % TIMES.length]; save(); timer.reset(S.secs); render(); } }, S.secs ? `Timer ${S.secs}s` : 'Timer off'),
        duet ? null : h('button.chip', { type: 'button', onclick: () => assassin() }, 'Assassin!'),
        h('button.chip', { type: 'button', onclick: () => ctx.push({ file: './bg-rulesview.js', title: 'Codenames', opts: { id: 'codenames' } }) }, 'Rules'),
        h('button.chip', { type: 'button', onclick: () => editions() }, 'Editions')),
      h('div.bg-cn-code', `key ${S.key.toUpperCase()}`));
  }
  function found(team) {
    if (S.left[team] <= 0) return;
    S.left[team]--; app.sfx('score'); save(); render();
    if (!S.left[team]) win(team);
  }
  function endTurn() { S.turn = S.turn === 'r' ? 'b' : 'r'; timer.reset(S.secs); app.sfx('whoosh'); save(); render(); }
  async function assassin() {
    const loser = TEAM[S.turn], winner = S.turn === 'r' ? 'b' : 'r';
    if (await confirm('The assassin!', `${loser.name} touched the assassin — ${TEAM[winner].name} wins.`, `${TEAM[winner].name} wins`)) win(winner);
  }
  let stopCel = null;
  function win(team) {
    timer.pause();
    if (team === 'd') { S.duetWins = (S.duetWins || 0) + 1; save(); app.sfx('win'); stopCel = celebrate(el, 'Mission complete!', '#16a34a', 'All 15 agents found'); return; }
    S.wins[team]++; save(); render(); app.sfx('win');
    stopCel = celebrate(el, `${TEAM[team].name} wins!`, TEAM[team].color, 'Tap “New key” for the next game');
  }

  // ---------------- the key on the display (only while held)
  function grid(cells, cols, side, cls = '') {
    return h(`div.bg-cn-grid${cls}`, { style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } }, cells.map((c) => h(`i.k-${side == null ? c : c[side]}`)));
  }
  function showPeek(on) {
    if (on) {
      clear(peek);
      if (K.mode === 'duet') peek.append(h('div.bg-cn-sides', h('div', h('small', 'Side A'), grid(K.cells, 5, 0)), h('div', h('small', 'Side B'), grid(K.cells, 5, 1))));
      else peek.append(h('div.bg-cn-frame', { '--c': TEAM[K.start].color }, grid(K.cells, K.cols, null, K.mode === 'pictures' ? '.pics' : '')), h('small', `${TEAM[K.start].name} starts`));
      app.sfx('tick');
    }
    peek.classList.toggle('on', on);
  }

  // ---------------- QR for the spymasters' phones
  async function qrPanel() {
    const base = await keyPageBase();
    const duet = S.mode === 'd';
    openPanel({
      title: duet ? 'Duet keys · one side each' : 'Key for the spymasters', className: 'bg-cn-qrp',
      build(body) {
        let side = 'a';
        const box = h('div.bg-cn-qrbox');
        const link = h('div.bg-cn-link');
        const draw = () => {
          const url = `${base}?k=${S.key}${duet ? `&s=${side}` : ''}`;
          box.innerHTML = qrSvg(url, { margin: 2, dark: '#111', light: '#fff' });
          link.textContent = url.replace(/^https?:\/\//, '');
        };
        put(body,
          duet ? seg([{ v: 'a', label: 'Side A' }, { v: 'b', label: 'Side B' }], side, (v) => { side = v; draw(); }) : null,
          box, link,
          h('div.bg-note', duet ? 'Each player scans their own side and keeps the phone hidden from the other.' : 'Both spymasters scan this. The key opens on the phone; nothing is shown on this screen.'),
          base === PAGES_URL && LOCAL.test(location.hostname) ? h('div.bg-note.warn', 'No bridge found — the link uses the web version (phones need internet).') : null);
        draw();
      },
    });
  }
  function editions() {
    openPanel({
      title: 'Codenames editions', className: 'bg-ed-panel',
      build(body) {
        const list = [
          ['Codenames', '2015 · 5×5 words · 9 / 8 / 7 / 1 key · 2 teams, 4–8+ players'],
          ['Pictures', '2016 · 5×4 picture cards · 8 / 7 / 4 / 1 key (pick “Pictures” above)'],
          ['Deep Undercover', '2016 · adults-only words, same rules (2.0 edition later)'],
          ['Duet', '2017 · 2+ players, cooperative: two-sided key, find 15 agents in 9 turns'],
          ['Disney Family', '2017 · Disney words & pictures; an easy 4×4 grid without the assassin'],
          ['Marvel', '2017 · Marvel heroes on the cards, the usual rules'],
          ['Harry Potter', '2018 · cooperative, Duet-style'],
          ['XXL editions', '2018–19 · big cards: Codenames, Pictures and Duet XXL'],
          ['The Simpsons', '2019 · Family edition with Simpsons cards'],
          ['Online / app', 'Free official web version and the 2024 Codenames app'],
        ];
        body.append(h('div.bg-ed-list', list.map(([n, s]) => h('div.bg-ed-row', h('b', n), h('small', s)))),
          h('div.bg-note', 'All editions mix: any 5×5 grid uses the Classic key; Pictures needs the 5×4 key.'));
      },
    });
  }

  render();
  return {
    key(e) {
      if (e.key === 'Enter' || e.key === ' ') { timer.toggle(); return true; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (S.mode === 'd') { if (e.key === 'ArrowRight' && S.turns > 0) { S.turns--; save(); timer.reset(S.secs); render(); app.sfx('tick'); } }
        else endTurn();
        return true;
      }
      if (e.key === 'Tab') { const m = ['c', 'p', 'd']; const v = m[(m.indexOf(S.mode) + 1) % 3]; tabs.set(v); fresh(v); timer.reset(S.secs); render(); return true; }
      if (e.key === 'k' && !e.repeat) { showPeek(true); window.addEventListener('keyup', function up(ev) { if (ev.key === 'k') { showPeek(false); window.removeEventListener('keyup', up); } }); return true; }
      return false;
    },
    destroy() { timer.destroy(); stopCel?.(); },
  };
}
