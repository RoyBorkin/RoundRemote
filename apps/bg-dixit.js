// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Board Games → Dixit (דיקסיט): the rabbit score track to 30 around the screen, and a round wizard — pick the
// storyteller, record who voted for whose card, and it works out everyone's points:
//   • everyone or no one finds the storyteller's card → storyteller 0, everyone else 2
//   • otherwise → storyteller 3, and each player who found it 3
//   • every player except the storyteller also gets 1 per vote on their own card
// Odyssey / big-group rules (7–12 players): two votes each, +1 for finding it with a single vote, at most 3 bonus.
import { h, clear } from '../js/ui/dom.js';
import { openPanel } from '../js/ui/overlay.js';
import { seg, editPlayers, roster, celebrate, confirm } from './bg-ui.js';

/** votes: { voterId: [ownerId, …] } (owner = whose card they voted for). Returns { pid: points }. Exported for tests. */
export function dixitScore(players, story, votes, { odyssey = false } = {}) {
  const pts = Object.fromEntries(players.map((p) => [p.id, 0]));
  const voters = players.filter((p) => p.id !== story);
  const found = voters.filter((p) => (votes[p.id] || []).includes(story));
  const allOrNone = found.length === 0 || found.length === voters.length;
  if (allOrNone) voters.forEach((p) => { pts[p.id] += 2; });
  else {
    pts[story] += 3;
    found.forEach((p) => { pts[p.id] += 3 + (odyssey && (votes[p.id] || []).length === 1 ? 1 : 0); });
  }
  for (const p of voters) {
    let got = 0;
    for (const v of voters) if (v.id !== p.id) got += (votes[v.id] || []).filter((o) => o === p.id).length;
    pts[p.id] += odyssey ? Math.min(3, got) : got;
  }
  return { pts, found: found.length, voters: voters.length, allOrNone };
}

export const DIXIT_SETS = [
  { id: 'base', name: 'Dixit', note: '2008 · 84 cards, 3–6 players (up to 8 in later printings).' },
  { id: 'quest', name: 'Quest', note: 'Expansion 1 (2010) · 84 new cards.' },
  { id: 'journey', name: 'Journey', note: '2012 · a standalone game (84 cards) that mixes with the rest.' },
  { id: 'odyssey', name: 'Odyssey', note: '2011 · standalone for 3–12 players: two votes from 7 players up, and a team (partner) variant.' },
  { id: 'origins', name: 'Origins', note: '84 new cards.' },
  { id: 'daydreams', name: 'Daydreams', note: '84 new cards.' },
  { id: 'memories', name: 'Memories', note: '84 new cards.' },
  { id: 'revelations', name: 'Revelations', note: '84 new cards.' },
  { id: 'harmonies', name: 'Harmonies', note: '84 new cards.' },
  { id: 'anniversary', name: 'Anniversary', note: '10th anniversary set: 84 cards by the earlier artists.' },
  { id: 'mirrors', name: 'Mirrors', note: '84 new cards.' },
  { id: 'disney', name: 'Disney edition', note: 'Standalone with Disney and Pixar art.' },
];

export function mount(el, ctx) {
  const { app } = ctx;
  el.classList.add('bg-dx');
  const S = Object.assign({ tab: 'track', players: roster(app, 5), scores: {}, story: 0, rounds: [], target: 30, odyssey: false, sets: ['base'] }, app.data('dixit', {}));
  const save = () => app.save('dixit', S);
  const sc = (p) => S.scores[p.id] || 0;
  const initial = (n) => (/^player (\d+)$/i.exec(n.trim())?.[1] || n.trim().slice(0, 1).toUpperCase());
  const TABS = ['track', 'round', 'sets'];
  const tabs = seg([{ v: 'track', label: 'Track' }, { v: 'round', label: 'Score a round' }, { v: 'sets', label: 'Sets' }], S.tab, (v) => { S.tab = v; if (v === 'round') startRound(); save(); show(); }, 'bg-cat-tabs');
  const trackEl = h('div.bg-tal-page.bg-dx-track');
  const roundEl = h('div.bg-tal-page.bg-dx-round');
  const setsEl = h('div.bg-tal-page.bg-dx-sets');
  el.append(tabs, trackEl, roundEl, setsEl);

  // ---------------------------------------------------------------- the track (0 at the bottom, clockwise to 30)
  // 0 just right of the tabs, clockwise round the bottom to 30 on the left — the top stays clear for Back and the tabs
  const N = 31, R = 42;
  const pos = (n, r = R, da = 0) => { const a = (52 + (n / (N - 1)) * 256 + da) * Math.PI / 180; return { left: `${50 + r * Math.sin(a)}%`, top: `${50 - r * Math.cos(a)}%` }; };
  let stopCel = null;
  function drawTrack() {
    clear(trackEl);
    for (let n = 0; n < N; n++) trackEl.append(h(`i.bg-dx-sp${n % 5 === 0 ? '.five' : ''}${n === S.target ? '.goal' : ''}`, { style: pos(n) }, n % 5 === 0 ? String(n) : ''));
    const at = {};
    S.players.forEach((p) => {
      const s = Math.min(N - 1, sc(p)), k = (at[s] = (at[s] || 0) + 1) - 1;
      trackEl.append(h('span.bg-dx-rabbit', { '--c': p.color, style: pos(s, R - 5.6 - (k >> 1) * 4.6, (k % 2 ? 1 : -1) * (k ? 7.5 : 0)), title: p.name }, initial(p.name)));
    });
    const rank = [...S.players].sort((a, b) => sc(b) - sc(a));
    const st = S.players[S.story % S.players.length];
    trackEl.append(h('div.bg-dx-center',
      h('small', `Round ${S.rounds.length + 1} · storyteller`),
      h('div.bg-dx-st', { '--c': st.color }, st.name),
      h('div.bg-dx-board', rank.slice(0, 6).map((p, i) => h('div.bg-dx-line', { '--c': p.color }, h('i'), h('span', p.name), h('b', String(sc(p))), i === 0 && sc(p) ? h('em', '★') : null))),
      h('button.pill.primary.bg-dx-go', { type: 'button', onclick: () => { S.tab = 'round'; tabs.set('round'); startRound(); save(); show(); } }, 'Score a round'),
      h('div.bg-dx-small',
        h('button.chip', { type: 'button', disabled: !S.rounds.length, onclick: () => undo() }, 'Undo'),
        h('button.chip', { type: 'button', onclick: () => editPlayers(app, { players: S.players, min: 3, max: 12, onChange: () => { save(); show(); } }) }, 'Players'),
        h('button.chip', { type: 'button', onclick: async () => { if (await confirm('New game', 'Put every rabbit back on 0?', 'New game')) { S.scores = {}; S.rounds = []; S.story = 0; save(); show(); } } }, 'New'))));
  }
  function undo() {
    const r = S.rounds.pop(); if (!r) return;
    for (const [id, v] of Object.entries(r.pts)) S.scores[id] = (S.scores[id] || 0) - v;
    S.story = r.storyIdx; save(); show(); app.sfx('drop');
  }

  // ---------------------------------------------------------------- round wizard
  let W = null;    // { step: 'story'|'vote'|'sum', story, votes, i }
  function startRound() { W = { step: 'story', story: S.players[S.story % S.players.length].id, votes: {}, i: 0 }; }
  const voters = () => S.players.filter((p) => p.id !== W.story);
  function drawRound() {
    clear(roundEl);
    if (!W) startRound();
    const two = S.odyssey && S.players.length >= 7;
    if (W.step === 'story') {
      roundEl.append(h('div.bg-dx-q', 'Who is the storyteller?'),
        h('div.bg-dx-pick', S.players.map((p) => h(`button.bg-dx-p${p.id === W.story ? '.on' : ''}`, { type: 'button', '--c': p.color, onclick: () => { W.story = p.id; app.sfx('tick'); drawRound(); } }, p.name))),
        h('button.pill.primary.bg-dx-next', { type: 'button', onclick: () => { W.step = 'vote'; W.i = 0; drawRound(); } }, 'Next: the votes ›'));
      return;
    }
    if (W.step === 'vote') {
      const v = voters()[W.i], mine = (W.votes[v.id] ||= []);
      const story = S.players.find((p) => p.id === W.story);
      const opts = S.players.filter((p) => p.id !== v.id);
      roundEl.append(
        h('div.bg-dx-prog', `${W.i + 1} / ${voters().length}`),
        h('div.bg-dx-q', { '--c': v.color }, h('b', v.name), two ? ' voted for (up to 2)…' : ' voted for…'),
        h('div.bg-dx-pick', opts.map((p) => h(`button.bg-dx-p${mine.includes(p.id) ? '.on' : ''}${p.id === story.id ? '.story' : ''}`, { type: 'button', '--c': p.color, onclick: () => {
          const k = mine.indexOf(p.id);
          if (k >= 0) mine.splice(k, 1); else { if (!two) mine.length = 0; if (mine.length < 2) mine.push(p.id); }
          app.sfx('tick');
          if (!two && mine.length) next(); else drawRound();
        } }, p.id === story.id ? `${p.name} ★` : `${p.name}’s card`))),
        h('div.bg-dx-nav',
          h('button.pill.small', { type: 'button', onclick: () => { if (W.i) W.i--; else W.step = 'story'; drawRound(); } }, '‹ Back'),
          h('button.pill.small.primary', { type: 'button', disabled: !mine.length, onclick: () => next() }, 'Next ›')));
      return;
    }
    const r = dixitScore(S.players, W.story, W.votes, { odyssey: two });
    const story = S.players.find((p) => p.id === W.story);
    roundEl.append(
      h('div.bg-dx-q', r.allOrNone ? (r.found ? 'Everyone found it — too easy!' : 'Nobody found it — too hard!') : `${r.found} of ${r.voters} found ${story.name}’s card`),
      h('div.bg-dx-sum', S.players.map((p) => h('div.bg-dx-line', { '--c': p.color }, h('i'), h('span', p.id === story.id ? `${p.name} ★` : p.name), h('b', `+${r.pts[p.id]}`), h('small', `→ ${sc(p) + r.pts[p.id]}`)))),
      h('div.bg-dx-nav',
        h('button.pill.small', { type: 'button', onclick: () => { W.step = 'vote'; W.i = voters().length - 1; drawRound(); } }, '‹ Back'),
        h('button.pill.primary', { type: 'button', onclick: () => apply(r) }, 'Add points')));
  }
  function next() { if (W.i < voters().length - 1) W.i++; else W.step = 'sum'; drawRound(); }
  function apply(r) {
    for (const [id, v] of Object.entries(r.pts)) S.scores[id] = (S.scores[id] || 0) + v;
    const storyIdx = S.story;
    S.rounds.push({ pts: r.pts, storyIdx });
    const si = S.players.findIndex((p) => p.id === W.story);
    S.story = (si + 1) % S.players.length;
    W = null; S.tab = 'track'; tabs.set('track'); save(); show(); app.sfx('score');
    const lead = [...S.players].sort((a, b) => sc(b) - sc(a))[0];
    if (S.target && sc(lead) >= S.target) { app.sfx('win'); stopCel = celebrate(el, `${lead.name} wins!`, lead.color, `${sc(lead)} points`); }
  }

  // ---------------------------------------------------------------- sets & variants
  let note = '';
  function drawSets() {
    clear(setsEl);
    setsEl.append(h('div.bg-mk-scroll',
      h('div.bg-sect', 'Your cards'),
      h('div.bg-mk-chips', DIXIT_SETS.map((x) => h(`button.chip${S.sets.includes(x.id) ? '.on' : ''}`, { type: 'button', onclick: () => {
        S.sets = S.sets.includes(x.id) ? S.sets.filter((y) => y !== x.id) : [...S.sets, x.id]; note = x.note; save(); drawSets();
      } }, x.name))),
      h('div.bg-sect', 'Rules'),
      h('div.bg-mk-chips',
        h(`button.chip${S.odyssey ? '.on' : ''}`, { type: 'button', onclick: () => { S.odyssey = !S.odyssey; note = 'Odyssey / big group (7–12 players): everyone may vote for two cards; finding it with a single vote is worth +1; a card earns at most 3 bonus points. Applies when 7+ play.'; save(); drawSets(); } }, 'Two votes (7+ players)'),
        h(`button.chip${S.target === 30 ? '.on' : ''}`, { type: 'button', onclick: () => { S.target = 30; note = 'Classic end: the first rabbit to reach 30 wins.'; save(); drawSets(); } }, 'End at 30'),
        h(`button.chip${!S.target ? '.on' : ''}`, { type: 'button', onclick: () => { S.target = 0; note = '2021 rules: play until the draw pile runs out; the highest score wins.'; save(); drawSets(); } }, 'Until the deck runs out'),
        h('button.chip', { type: 'button', onclick: () => { note = 'Team Dixit (Odyssey, 6–12 players in pairs): partners sit apart, hold 4 cards each and together give the storyteller one card; neither the storyteller nor the partner who gave a card votes. Ends when everyone has told once.'; drawSets(); } }, 'Team variant ⓘ'),
        h('button.chip', { type: 'button', onclick: () => ctx.push({ file: './bg-rulesview.js', title: 'Dixit', opts: { id: 'dixit' } }) }, 'Rules'))),
    h('div.bg-mk-note', note || `${S.sets.length} set${S.sets.length === 1 ? '' : 's'} · ${S.sets.length * 84} cards`));
  }

  function show() {
    trackEl.hidden = S.tab !== 'track'; roundEl.hidden = S.tab !== 'round'; setsEl.hidden = S.tab !== 'sets';
    if (S.tab === 'track') drawTrack(); else if (S.tab === 'round') drawRound(); else drawSets();
  }
  show();
  return {
    back() { if (S.tab === 'round' && W && (W.step !== 'story')) { if (W.step === 'sum') { W.step = 'vote'; W.i = voters().length - 1; } else if (W.i) W.i--; else W.step = 'story'; drawRound(); return true; } return false; },
    key(e) {
      if (e.key === 'Tab') { S.tab = TABS[(TABS.indexOf(S.tab) + 1) % 3]; tabs.set(S.tab); if (S.tab === 'round') startRound(); save(); show(); return true; }
      if (S.tab === 'round' && W) {
        const btns = [...roundEl.querySelectorAll('.bg-dx-p')];
        if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && btns.length) {
          const i = btns.findIndex((b) => b.classList.contains('kb'));
          const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length + (i < 0 && e.key === 'ArrowLeft' ? 1 : 0)) % btns.length;
          btns.forEach((b, k) => b.classList.toggle('kb', k === j)); return true;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          const kb = roundEl.querySelector('.bg-dx-p.kb');
          if (kb) kb.click(); else roundEl.querySelector('.pill.primary:not([disabled])')?.click();
          return true;
        }
      }
      if (S.tab === 'track' && (e.key === 'Enter' || e.key === ' ')) { S.tab = 'round'; tabs.set('round'); startRound(); save(); show(); return true; }
      return false;
    },
    destroy() { stopCel?.(); },
  };
}
