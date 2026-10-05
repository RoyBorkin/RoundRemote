// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Movie Night: build a shortlist of 3–5 movies or shows (from your Plex / Jellyfin library, your Wish Lists, Decide
// favourites or typed in), everyone votes on their phone (scan the QR code — one vote each, or rank the top three;
// no phones? count raised hands on the display), a drumroll reveals the winner, then "Start movie night": tick the
// checklist, dim the lights (a Home Assistant scene, or lights + brightness), pause the music and play the winner on
// the TV through Plex / Jellyfin — the same path as Decide's "Play on TV". Past nights are kept with who came.
import { clear } from '../js/ui/dom.js';
import { curve, listRow, spinner } from '../js/ui/overlay.js';
import { provider } from '../js/providers/registry.js';
import { partyLink, qrBox, phoneThumb, linkProblem, confetti, haReady, haEntities, haCall } from './party-link.js';

const COLORS = ['#f43f5e', '#8b5cf6', '#0ea5e9', '#10b981', '#f97316', '#eab308', '#ec4899'];
const CHECK = ['Snacks & popcorn', 'Drinks', 'Blankets & pillows', 'Phones on silent'];
const MAX = 5;
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const TAU = Math.PI * 2;

export default {
  css: './movienight.css',
  create(el, app) {
    const { h, icon, player } = app;
    el.classList.add('mn');
    let cands = app.data('cands', []);
    let phase = app.data('phase', 'setup');            // setup | vote | reveal | winner | start | started
    let votes = app.data('votes', {});                 // device → [cand ids] (from phones)
    let hands = app.data('hands', {});                 // cand id → raised hands counted on the display
    let guests = app.data('guests', {});               // device → { name }
    let winner = app.data('winner', null), tie = app.data('tie', false);
    const opts = () => ({ mode: 'one', counts: false, pauseMusic: true, lights: { kind: 'none', scene: '', ids: [], brightness: 10 }, check: CHECK.map((text) => ({ text, done: false })), extra: [], ...app.data('opts', {}) });
    const putOpts = (p) => app.save('opts', { ...app.data('opts', {}), ...p });
    const offs = [];
    const savePhase = () => { app.save('phase', phase); app.save('winner', winner); app.save('tie', tie); };

    const link = partyLink('movienight', app, { onAct });
    offs.push(link.events.on('status', () => { if (phase === 'vote') drawVote(); }));

    function onAct(a) {
      guests[a.device] = { name: a.name || 'Guest', last: Date.now() }; app.save('guests', guests);
      if (a.type === 'vote' && phase === 'vote') {
        if (a.pick?.length) votes[a.device] = a.pick; else delete votes[a.device];
        app.save('votes', votes); app.sfx('tick'); drawVote();
      }
      publish();
    }

    // ------------------------------------------------------------------ tally
    function tally() {
      const t = Object.fromEntries(cands.map((c) => [c.id, 0]));
      const rank = opts().mode === 'rank', top = Math.min(3, cands.length);
      for (const pick of Object.values(votes)) pick.forEach((id, i) => { if (id in t) t[id] += rank ? top - i : 1; });
      for (const [id, n] of Object.entries(hands)) if (id in t) t[id] += n * (rank ? top : 1);
      return t;
    }
    const voters = () => Object.keys(votes).length;

    // ------------------------------------------------------------------ public state
    const thumbs = new Map();
    function publish() {
      const o = opts();
      const showTally = phase === 'winner' || phase === 'started' || (phase === 'vote' && o.counts);
      const pub = cands.map((c) => {
        if (!thumbs.has(c.id)) { thumbs.set(c.id, ''); phoneThumb(c.art, 200).then((u) => { thumbs.set(c.id, u); if (u) publish(); }); }
        return { id: c.id, title: c.title, year: c.year || null, sub: c.kindLabel || '', art: thumbs.get(c.id) || '', color: c.color };
      });
      link.publish({ v: 1, phase: phase === 'start' ? 'winner' : phase, mode: o.mode, cands: pub, votes, voted: voters(), tally: showTally ? tally() : null, winner, tie });
    }

    // ------------------------------------------------------------------ pages
    const pages = {};
    for (const p of ['setup', 'vote', 'reveal', 'start', 'started', 'history']) { pages[p] = h(`div.mn-page.mn-${p}`); el.append(pages[p]); }
    const fx = h('div.mn-fx'); el.append(fx);
    let page = null;
    function show(p) {
      page = p; el.dataset.page = p;
      for (const [k, v] of Object.entries(pages)) v.classList.toggle('on', k === p);
      app.setTitle({ vote: 'Vote now', reveal: 'And the winner is…', start: 'Start movie night', started: 'Movie night', history: 'Past movie nights' }[p] || null);
      ({ setup: drawSetup, vote: drawVote, reveal: drawWinner, start: drawStart, started: drawStarted, history: drawHistory })[p]?.();
    }

    function posterEl(c, cls = '', caption = false) {
      return h(`div.mn-poster${cls}${c.art ? '' : '.noart'}`, { '--k': c.color || '#eab308', style: c.art ? { backgroundImage: `url("${c.art}")` } : null },
        c.art ? (caption ? h('span.mn-cap', { dir: 'auto' }, c.title) : null) : h('span.mn-poster-t', { dir: 'auto' }, c.title));
    }

    // ---------------- setup: the shortlist
    function drawSetup() {
      const pg = pages.setup; clear(pg);
      const n = cands.length;
      const fan = h('div.mn-fan');
      const slots = [...cands, ...(n < MAX ? [null] : [])];
      const k = slots.length;
      slots.forEach((c, i) => {
        const off = i - (k - 1) / 2;
        const pos = { '--x': `${off * (k > 4 ? 16.2 : 18.6)}cqmin`, '--r': `${off * 4.5}deg`, '--y': `${Math.abs(off) * Math.abs(off) * 1.3}cqmin`, style: { zIndex: String(10 - Math.abs(Math.round(off))), animationDelay: `${i * 60}ms` } };
        if (!c) { fan.append(h('button.mn-slot.mn-add', { type: 'button', ...pos, 'aria-label': 'Add a movie', onclick: () => addMenu() }, h('i', { html: icon('plus') }), h('span', n ? 'Add' : 'Add a movie'))); return; }
        fan.append(h('button.mn-slot', { type: 'button', ...pos, onclick: () => candMenu(c), 'aria-label': c.title }, posterEl(c, '', true)));
      });
      pg.append(
        h('div.mn-h', 'Tonight’s shortlist'),
        h('div.mn-sub', n < 2 ? 'Pick 3 to 5 movies or shows' : `${n} picked${n < 3 ? ' · add one more?' : ''} · ${opts().mode === 'rank' ? 'rank top 3' : 'one vote each'}`),
        fan,
        h('div.mn-bar',
          h('button.mn-btn', { type: 'button', 'aria-label': 'Past movie nights', onclick: () => show('history') }, h('i', { html: icon('clock') }), h('span', 'History')),
          h('button.pill.primary.mn-go', { type: 'button', disabled: n < 2 ? true : null, onclick: () => startVoting() }, h('i', { html: icon('people') }), 'Start voting'),
          h('button.mn-btn', { type: 'button', 'aria-label': 'Options', onclick: () => openOptions() }, h('i', { html: icon('settings') }), h('span', 'Options'))));
    }

    function addCand(c) {
      if (cands.length >= MAX) { app.toast(`Up to ${MAX} — remove one first`); return false; }
      if (cands.some((x) => norm(x.title) === norm(c.title) && (!x.year || !c.year || x.year === c.year))) { app.toast('Already on the shortlist'); return false; }
      cands.push({ id: uid(), color: COLORS[cands.length % COLORS.length], ...c });
      app.save('cands', cands); app.sfx('pop');
      if (page === 'setup') drawSetup();
      publish();
      return true;
    }
    function candMenu(c) {
      app.openPanel({
        title: c.kindLabel || 'Movie', className: 'mn-panel mn-cand',
        build(body, panel) {
          body.append(...[posterEl(c, '.big'), h('div.mn-cand-t', { dir: 'auto' }, c.title), h('div.mn-cand-s', [c.year, c.srcLabel].filter(Boolean).join(' · ')),
            c.info ? h('div.mn-cand-i', { dir: 'auto' }, c.info) : null,
            h('div.mn-cand-acts', h('button.pill.danger', { type: 'button', onclick: () => { cands = cands.filter((x) => x.id !== c.id); app.save('cands', cands); delete hands[c.id]; app.save('hands', hands); panel.close(); drawSetup(); publish(); app.sfx('drop'); } }, 'Remove'))].filter(Boolean));
        },
      });
    }

    function addMenu() {
      if (cands.length >= MAX) { app.toast(`Up to ${MAX} — remove one first`); return; }
      app.openPanel({
        title: 'Add from…', className: 'mn-panel',
        build(body, panel) {
          const box = h('div.list'); body.append(box);
          const fav = decideFavs();
          box.append(
            listRow({ title: 'My library', subtitle: 'Plex / Jellyfin movies & shows', mono: '▣', color: '#e5a00d', onClick: () => { panel.close(); pickLibrary(); } }),
            listRow({ title: 'Surprise me', subtitle: 'Random unwatched movies from the library', mono: '✦', color: '#a78bfa', onClick: () => { panel.close(); surprise(); } }),
            listRow({ title: 'Wish Lists', subtitle: 'Movies & shows you want to watch', mono: '♥', color: '#ec4899', onClick: () => { panel.close(); pickWish(); } }),
            listRow({ title: 'Decide favourites', subtitle: fav.length ? `${fav.length} saved in Decide → What to watch` : 'None saved in Decide yet', mono: '★', color: '#14b8a6', onClick: () => { panel.close(); pickList('Decide favourites', fav.map(fromFav)); } }),
            listRow({ title: 'Type a title', subtitle: 'Anything — we’ll look for it when it’s time', mono: '✎', color: '#94a3b8', onClick: async () => {
              panel.close();
              const v = await app.editText({ title: 'Movie or show', placeholder: 'Title (and year)', okLabel: 'Add' });
              if (!v) return;
              const m = /^(.*?)\s*\(?((?:19|20)\d{2})\)?\s*$/.exec(v.trim());
              addCand({ title: m ? m[1] : v.trim(), year: m ? +m[2] : null, src: 'typed', srcLabel: 'Typed in', kindLabel: 'Movie' });
            } }));
        },
      });
    }
    const decideFavs = () => ((app.store.get('appData') || {}).decide?.favs?.watch || []);
    const fromFav = (f) => ({ title: f.title, year: f.year || f.ref?.year || null, art: f.art || '', info: f.info || '', src: 'fav', srcLabel: 'Decide favourite', kindLabel: f.ref?.kind === 'show' ? 'Show' : 'Movie', ref: f.ref?.pid ? { pid: f.ref.pid, entry: f.ref.entry } : null });
    const fromLib = (it) => ({ title: it.title, year: it.year || null, art: it.art || '', info: it.info || '', src: 'lib', srcLabel: it.srcName || 'Library', kindLabel: it.tags?.type === 's' ? 'Show' : 'Movie', ref: { pid: it.ref.pid, entry: it.ref.entry }, watched: !!it.tags?.watched });

    let libCache = null;
    async function library() {
      if (libCache) return libCache;
      const { loadWatchLibrary } = await import('./decide-sources.js');
      const r = await loadWatchLibrary();
      libCache = r;
      setTimeout(() => { libCache = null; }, 5 * 60000);
      return r;
    }
    function pickList(title, items, { search = false, empty = 'Nothing here yet.' } = {}) {
      app.openPanel({
        title, className: 'mn-panel',
        build(body, panel) {
          let q = '';
          const top = h('div.mn-ptop'); const box = h('div.list'); body.append(top, box); curve(box);
          const draw = () => {
            clear(top); clear(box);
            if (search) top.append(h('button.pill.small', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Search', value: q, placeholder: 'Title', okLabel: 'Find' }); if (v !== null) { q = v; draw(); } } }, h('i', { html: icon('search') }), q ? ` “${q}”` : ' Search'));
            const list = items.filter((x) => !q || norm(x.title).includes(norm(q)));
            if (!list.length) box.append(h('div.empty', q ? 'No matches.' : empty));
            for (const it of list.slice(0, 150)) {
              const on = cands.some((c) => norm(c.title) === norm(it.title));
              box.append(listRow({ title: it.title, subtitle: [it.year, it.kindLabel, it.srcLabel].filter(Boolean).join(' · '), art: it.art, mono: '🎬', active: on,
                onClick: () => { if (on) return; if (addCand(it)) { if (cands.length >= MAX) panel.close(); else draw(); } } }));
            }
          };
          draw();
        },
      });
    }
    async function pickLibrary() {
      app.openPanel({
        title: 'My library', className: 'mn-panel',
        build(body, panel) {
          body.append(spinner('Reading your libraries…'));
          library().then((r) => {
            panel.close();
            if (!r.items.length) { app.toast(r.errors[0] || 'No Plex or Jellyfin library is set up', { kind: 'error', ms: 3500 }); return; }
            pickList(`My library (${r.items.length})`, r.items.map(fromLib).sort((a, b) => a.title.localeCompare(b.title)), { search: true });
          }).catch((e) => { panel.close(); app.toast(e?.message || 'Couldn’t read the library', { kind: 'error' }); });
        },
      });
    }
    async function surprise() {
      try {
        const r = await library();
        const pool = r.items.map(fromLib).filter((x) => x.kindLabel === 'Movie' && !x.watched && !cands.some((c) => norm(c.title) === norm(x.title)));
        if (!pool.length) { app.toast('No unwatched movies found in your library'); return; }
        let n = 0;
        while (cands.length < Math.min(MAX, Math.max(3, cands.length + 1)) && pool.length) { const i = Math.floor(Math.random() * pool.length); addCand(pool.splice(i, 1)[0]); n++; }
        if (n) app.toast(`${n} surprise${n === 1 ? '' : 's'} added`);
      } catch (e) { app.toast(e?.message || 'Couldn’t read the library', { kind: 'error' }); }
    }
    async function pickWish() {
      let list = [];
      try {
        const W = await import('./wishlist-store.js');
        list = [...W.wishes('movie'), ...W.wishes('show')].filter((w) => w.status !== 'done')
          .map((w) => ({ title: w.title, year: w.year || null, art: w.art || '', info: w.note || '', src: 'wish', srcLabel: 'Wish list', kindLabel: w.kind === 'show' ? 'Show' : 'Movie', wish: w.id }));
      } catch (e) { console.warn('[movienight] wish list', e); }
      pickList('Wish Lists', list, { empty: 'No movies or shows on your wish lists yet.' });
    }

    function openOptions() {
      app.openPanel({
        title: 'Voting', className: 'mn-panel',
        build(body) {
          const box = h('div.mn-set'); body.append(box);
          const draw = () => {
            clear(box);
            const o = opts();
            const seg = (val, label, sub) => h(`button.mn-seg${o.mode === val ? '.on' : ''}`, { type: 'button', onclick: () => { putOpts({ mode: val }); votes = {}; app.save('votes', votes); draw(); publish(); if (page === 'setup') drawSetup(); } }, h('b', label), h('span', sub));
            box.append(h('div.mn-segs', seg('one', 'One vote each', 'Most votes wins'), seg('rank', 'Rank top 3', '3 · 2 · 1 points')),
              h('div.mn-set-row', h('div', h('div', 'Show live counts'), h('div.mn-set-sub', 'Everyone sees the score while voting')), h(`button.switch${o.counts ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(o.counts), 'aria-label': 'Show live counts', onclick: () => { putOpts({ counts: !o.counts }); draw(); publish(); } })),
              h('div.mn-set-sub.mn-note', link.status === 'ok' ? `Phones join room ${link.code} through the bridge.` : linkProblem(link.reason)));
          };
          draw();
        },
      });
    }

    // ---------------- vote
    function startVoting() {
      if (cands.length < 2) return;
      votes = {}; hands = {}; winner = null; tie = false;
      app.save('votes', votes); app.save('hands', hands);
      phase = 'vote'; savePhase(); app.sfx('score');
      show('vote'); publish();
    }
    let qrUrl = null, qrTok = 0;
    function drawVote() {
      if (page !== 'vote') return;
      const pg = pages.vote; clear(pg);
      const o = opts(), t = tally(), n = voters(), handN = Object.values(hands).reduce((a, b) => a + b, 0);
      const qr = h('div.mn-qrslot');
      if (link.status === 'ok') {
        if (qrUrl?.code === link.code) qr.append(qrBox(qrUrl.url));
        else { const my = ++qrTok; link.phoneUrl().then((r) => { if (my === qrTok && r.url) { qrUrl = { code: link.code, url: r.url }; qr.append(qrBox(r.url)); } }); }
      } else qr.append(h('div.mn-qroff', h('i', { html: icon('people') }), h('span', link.status === 'connecting' ? 'Connecting…' : 'No bridge — count hands')));
      const row = h('div.mn-row');
      cands.forEach((c) => {
        const tot = t[c.id] || 0;
        row.append(h('div.mn-vc',
          h('button.mn-vposter', { type: 'button', onclick: () => candMenu(c) }, posterEl(c), o.counts ? h('span.mn-count', String(tot)) : null),
          h('div.mn-vt', { dir: 'auto' }, c.title),
          h('div.mn-hand', h('button', { type: 'button', 'aria-label': `One hand less for ${c.title}`, onclick: () => { hands[c.id] = Math.max(0, (hands[c.id] || 0) - 1); app.save('hands', hands); drawVote(); publish(); } }, '−'),
            h('b', { title: 'Hands counted here' }, `✋${hands[c.id] || 0}`),
            h('button', { type: 'button', 'aria-label': `One more hand for ${c.title}`, onclick: () => { hands[c.id] = (hands[c.id] || 0) + 1; app.save('hands', hands); app.sfx('tick'); drawVote(); publish(); } }, '+'))));
      });
      pg.append(qr,
        h('div.mn-vinfo', link.status === 'ok' ? h('span', 'Room ', h('b.mn-code', link.code), ' · ') : null, `${n} phone vote${n === 1 ? '' : 's'}${handN ? ` · ${handN} hand${handN === 1 ? '' : 's'}` : ''}`),
        row,
        h('div.mn-bar',
          h('button.mn-btn', { type: 'button', 'aria-label': 'Back to the shortlist', onclick: () => { phase = 'setup'; savePhase(); show('setup'); publish(); } }, h('i', { html: icon('back') }), h('span', 'Shortlist')),
          h('button.pill.primary.mn-go', { type: 'button', disabled: (n + handN) === 0 ? true : null, onclick: () => reveal() }, '🥁 Reveal'),
          h('button.mn-btn', { type: 'button', 'aria-label': o.counts ? 'Hide the counts' : 'Show the counts', onclick: () => { putOpts({ counts: !o.counts }); drawVote(); publish(); } }, h('i', { html: icon('eye') }), h('span', o.counts ? 'Hide' : 'Counts'))));
    }

    // ---------------- reveal (drumroll)
    let revealing = false;
    function reveal() {
      if (revealing) return;
      const t = tally();
      const best = Math.max(...cands.map((c) => t[c.id] || 0));
      const top = cands.filter((c) => (t[c.id] || 0) === best);
      const w = top[Math.floor(Math.random() * top.length)];
      winner = w.id; tie = top.length > 1;
      phase = 'reveal'; savePhase(); publish();
      revealing = true;
      show('reveal');
      const pg = pages.reveal; clear(pg);
      const row = h('div.mn-rrow');
      const els = cands.map((c) => { const e = h('div.mn-rc', posterEl(c, '', true)); row.append(e); return e; });
      const label = h('div.mn-drum', '🥁');
      pg.append(h('div.mn-rh', tie ? 'It’s a tie… the wheel decides' : 'And the winner is…'), row, label);
      // spotlight hops between posters, slowing down, and stops on the winner
      const wi = cands.indexOf(w), k = cands.length;
      const hops = k * 4 + ((wi - (k * 4) % k) + k) % k;
      let i = 0, delay = 70;
      const hop = () => {
        els.forEach((e, j) => e.classList.toggle('lit', j === i % k));
        app.sfx('tick', { pitch: 1 + (i % 3) * 0.08 });
        if (i >= hops) { setTimeout(done, 500); return; }
        i++; delay *= i > hops - 6 ? 1.32 : 1.06;
        setTimeout(hop, delay);
      };
      setTimeout(hop, 600);
      function done() {
        revealing = false;
        if (page !== 'reveal') return;
        phase = 'winner'; savePhase(); publish();
        app.sfx('win'); app.vibrate(30);
        confetti(fx, [w.color, '#ffd166', '#fff', '#f43f5e', '#06d6a0']);
        drawWinner();
      }
    }
    function drawWinner() {
      const pg = pages.reveal;
      if (phase !== 'winner' && phase !== 'start') return;
      clear(pg);
      const w = cands.find((c) => c.id === winner);
      if (!w) { phase = 'setup'; savePhase(); show('setup'); return; }
      const t = tally();
      pg.append(h('div.mn-win', posterEl(w, '.win'),
        h('div.mn-win-k', tie ? 'Tie-break winner' : 'Tonight we’re watching'),
        h('div.mn-win-t', { dir: 'auto' }, w.title),
        h('div.mn-win-s', [w.year, `${t[w.id] || 0} point${t[w.id] === 1 ? '' : 's'}`].filter(Boolean).join(' · '))),
      h('div.mn-bar',
        h('button.mn-btn', { type: 'button', 'aria-label': 'Vote again', onclick: () => startVoting() }, h('i', { html: icon('replay') }), h('span', 'Re-vote')),
        h('button.pill.primary.mn-go', { type: 'button', onclick: () => { phase = 'start'; savePhase(); show('start'); } }, h('i', { html: icon('play') }), 'Let’s watch'),
        h('button.mn-btn', { type: 'button', 'aria-label': 'Back to the shortlist', onclick: () => { phase = 'setup'; savePhase(); show('setup'); publish(); } }, h('i', { html: icon('list') }), h('span', 'Shortlist'))));
    }

    // ---------------- start: checklist, lights, music, TV
    let tvPick = null;   // { pid, item } resolved library entry for the winner
    function drawStart() {
      const pg = pages.start; clear(pg);
      const w = cands.find((c) => c.id === winner);
      if (!w) { show('setup'); return; }
      const o = opts();
      const box = h('div.mn-slist.list');
      const sec = (t) => h('div.mn-sh', t);
      const row = (label, sub, right, onclick, cls = '') => h(`div.mn-srow${cls}`, { onclick, role: onclick ? 'button' : null }, h('div.mn-sl', h('div', { dir: 'auto' }, label), sub ? h('div.mn-ssub', { dir: 'auto' }, sub) : null), right);
      // checklist
      box.append(sec('Checklist'));
      o.check.forEach((c, i) => box.append(row(c.text, null, h(`span.mn-tick${c.done ? '.on' : ''}`, { html: icon('check') }), () => { const ck = opts().check; ck[i] = { ...ck[i], done: !ck[i].done }; putOpts({ check: ck }); app.sfx('tick'); drawStart(); }, c.done ? '.done' : '')));
      box.append(h('div.mn-srow.mn-small', h('button.pill.small', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Checklist item', placeholder: 'e.g. Pizza ordered', okLabel: 'Add' }); if (v) { putOpts({ check: [...opts().check, { text: v, done: false }] }); drawStart(); } } }, '+ Item'),
        h('button.pill.small', { type: 'button', onclick: () => { putOpts({ check: opts().check.map((c) => ({ ...c, done: false })) }); drawStart(); } }, 'Untick all')));
      // lights
      const L = o.lights;
      box.append(sec('Lights'), row(L.kind === 'scene' ? 'Scene' : L.kind === 'lights' ? `${L.ids.length} light${L.ids.length === 1 ? '' : 's'} → ${L.brightness}%` : 'Leave the lights', L.kind === 'scene' ? L.sceneName || L.scene : L.kind === 'lights' ? (L.names || []).join(', ') : haReady() ? 'Tap to dim the lights or pick a scene' : 'Set up Home Assistant to dim the lights',
        h('i.mn-chev', { html: icon('chevron') }), () => pickLights()));
      // music
      const playing = !!player.state.isPlaying;
      box.append(sec('Music'), row('Pause the music', playing ? `${player.state.track?.title || 'Music'} is playing` : 'Nothing playing right now',
        h(`button.switch${o.pauseMusic ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(o.pauseMusic), 'aria-label': 'Pause the music', onclick: (e) => { e.stopPropagation(); putOpts({ pauseMusic: !o.pauseMusic }); drawStart(); } })));
      // TV
      const tvRow = row('Finding it in your library…', w.title, h('i.mn-chev', { html: icon('tv') }), null);
      box.append(sec('On the TV'), tvRow);
      resolveTv(w).then((r) => {
        if (page !== 'start') return;
        tvPick = r;
        const p = r && provider(r.pid);
        const nr = r ? row(`Play on ${p?.name || 'the TV'}`, `${r.title}${r.year ? ` (${r.year})` : ''}${p?.state?.device?.name ? ` · ${p.state.device.name}` : ''}`, h('i.mn-chev', { html: icon('tv') }), () => pickDevice(p, null))
          : row('Not in your library', 'We’ll show a QR code to find where it’s streaming', h('i.mn-chev', { html: icon('tv') }), null);
        tvRow.replaceWith(nr);
      });
      // who's here
      const names = whoCame();
      box.append(sec(`Who’s here (${names.length})`), h('div.mn-who', ...names.map((n) => h('span.chip', { dir: 'auto' }, n)),
        h('button.chip.mn-addwho', { type: 'button', onclick: async () => { const v = await app.editText({ title: 'Who came?', placeholder: 'Name', okLabel: 'Add' }); if (v) { putOpts({ extra: [...opts().extra, v.trim()] }); drawStart(); } } }, '+ Name')));
      pg.append(h('div.mn-start-h', posterEl(w, '.mini'), h('div', h('div.mn-start-k', 'Tonight'), h('div.mn-start-t', { dir: 'auto' }, w.title))), box,
        h('button.pill.primary.mn-action', { type: 'button', onclick: () => go(w) }, h('i', { html: icon('play') }), 'Lights, camera, action!'));
      curve(box);
    }
    const whoCame = () => {
      const recent = Object.values(guests).filter((g) => Date.now() - (g.last || 0) < 12 * 3600e3).map((g) => g.name);
      return [...new Set([...recent, ...opts().extra].filter(Boolean))];
    };

    async function resolveTv(w) {
      if (w.ref?.pid) return { pid: w.ref.pid, entry: w.ref.entry, title: w.title, year: w.year };
      try {
        const r = await library();
        const t = norm(w.title);
        const m = r.items.find((x) => norm(x.title) === t && (!w.year || !x.year || x.year === w.year)) || r.items.find((x) => norm(x.title) === t);
        return m ? { pid: m.ref.pid, entry: m.ref.entry, title: m.title, year: m.year } : null;
      } catch { return null; }
    }

    function pickLights() {
      app.openPanel({
        title: 'Lights', className: 'mn-panel',
        build(body, panel) {
          const box = h('div.list'); body.append(box); curve(box);
          if (!haReady()) { box.append(h('div.empty', 'Connect Home Assistant (Home → Home Assistant) to dim the lights for the movie.')); return; }
          box.append(spinner('Asking Home Assistant…'));
          Promise.all([haEntities('scene').catch(() => []), haEntities('light').catch(() => [])]).then(([scenes, lights]) => {
            clear(box);
            const L = opts().lights;
            box.append(listRow({ title: 'Leave the lights', mono: '○', active: L.kind === 'none', onClick: () => { putOpts({ lights: { ...L, kind: 'none' } }); panel.close(); drawStart(); } }));
            if (scenes.length) box.append(h('div.mn-sh', 'Scenes'));
            for (const s of scenes) box.append(listRow({ title: s.name, subtitle: s.id, mono: '✦', active: L.kind === 'scene' && L.scene === s.id, onClick: () => { putOpts({ lights: { ...L, kind: 'scene', scene: s.id, sceneName: s.name } }); panel.close(); drawStart(); } }));
            if (lights.length) {
              box.append(h('div.mn-sh', 'Or dim these lights'));
              const sel = new Set(L.kind === 'lights' ? L.ids : []);
              const bri = h('div.mn-bri');
              let b = L.brightness ?? 10;
              const drawBri = () => { clear(bri); bri.append(h('button.ibtn.small', { type: 'button', 'aria-label': 'Darker', onclick: () => { b = Math.max(0, b - 10); drawBri(); }, html: icon('minus') }), h('b', b ? `${b}%` : 'Off'), h('button.ibtn.small', { type: 'button', 'aria-label': 'Brighter', onclick: () => { b = Math.min(100, b + 10); drawBri(); }, html: icon('plus') })); };
              drawBri();
              for (const l of lights) {
                const r = listRow({ title: l.name, subtitle: l.on ? 'On' : 'Off', mono: '💡', active: sel.has(l.id), onClick: () => { sel.has(l.id) ? sel.delete(l.id) : sel.add(l.id); r.classList.toggle('active', sel.has(l.id)); } });
                box.append(r);
              }
              box.append(h('div.mn-sh', 'Brightness'), bri, h('button.pill.primary', { type: 'button', onclick: () => {
                const ids = [...sel];
                putOpts({ lights: { ...opts().lights, kind: ids.length ? 'lights' : 'none', ids, names: lights.filter((l) => sel.has(l.id)).map((l) => l.name), brightness: b } });
                panel.close(); drawStart();
              } }, 'Use these lights'));
            }
            if (!scenes.length && !lights.length) box.append(h('div.empty', 'No scenes or lights found.'));
          });
        },
      });
    }

    function pickDevice(p, then) {
      if (!p) return;
      app.openPanel({
        title: 'Play on…', className: 'mn-panel',
        build(body, panel) {
          const list = h('div.list'); body.append(list); curve(list);
          list.append(spinner('Looking for TVs and players…'));
          p.getDevices().then((devs) => {
            clear(list);
            if (!devs.length) { list.append(h('div.empty', `No ${p.name} players found. Open ${p.name} on your TV and try again.`)); return; }
            for (const dv of devs) list.append(listRow({ title: dv.name, subtitle: dv.type || '', mono: dv.active ? '●' : '○', active: dv.active,
              onClick: async () => { try { await p.selectDevice(dv); panel.close(); if (then) await then(); else drawStart(); } catch (e) { app.toast(e?.userMessage || e?.message || 'Couldn’t pick it', { kind: 'error' }); } } }));
          }).catch((e) => { clear(list); list.append(h('div.empty', e?.userMessage || e?.message || 'Couldn’t list the players')); });
        },
      });
    }

    // ---------------- action!
    async function go(w) {
      const o = opts();
      const log = [];
      // lights
      try {
        const L = o.lights;
        if (L.kind === 'scene' && L.scene) { await haCall('scene', 'turn_on', L.scene); log.push('Lights set'); }
        else if (L.kind === 'lights' && L.ids.length) { if (L.brightness > 0) await haCall('light', 'turn_on', L.ids, { brightness_pct: L.brightness, transition: 4 }); else await haCall('light', 'turn_off', L.ids, { transition: 4 }); log.push('Lights dimmed'); }
      } catch (e) { app.toast(`Lights: ${e?.message || e}`, { kind: 'error' }); }
      // music
      try { if (o.pauseMusic && player.state.isPlaying) { await player.pause(); log.push('Music paused'); } } catch {}
      // TV
      const r = tvPick || await resolveTv(w);
      const playIt = async () => {
        const p = provider(r.pid);
        await p.playMedia(r.entry, {});
        app.toast(`Playing ${w.title} on the TV`);
        setTimeout(() => p.refresh?.().catch(() => {}), 900);
      };
      if (r) {
        const p = provider(r.pid);
        try {
          if (!(p.playerId || p.session)) await p.refresh?.().catch(() => {});
          if (!(p.playerId || p.session)) pickDevice(p, async () => { try { await playIt(); } catch (e) { app.toast(e?.userMessage || e?.message || 'Couldn’t start it', { kind: 'error' }); } });
          else await playIt();
        } catch (e) {
          const msg = e?.userMessage || e?.message || 'Couldn’t start it';
          if (/device|player|session/i.test(msg)) pickDevice(p, playIt); else app.toast(msg, { kind: 'error' });
        }
      }
      // remember the night
      const t = tally();
      const night = { at: Date.now(), winner: { title: w.title, year: w.year || null, art: /^data:/.test(w.art || '') ? '' : w.art || '', color: w.color }, tie,
        cands: cands.map((c) => ({ title: c.title, pts: t[c.id] || 0 })), guests: whoCame(), mode: o.mode };
      app.save('history', [night, ...app.data('history', [])].slice(0, 60));
      if (w.wish) import('./wishlist-store.js').then((W) => W.updateWish?.(w.wish, { status: 'done', doneAt: Date.now() })).catch(() => {});
      phase = 'started'; savePhase(); publish();
      app.sfx('perfect');
      show('started');
      if (!r) openWhere(w);
    }
    function openWhere(w) {
      const url = `https://www.google.com/search?q=${encodeURIComponent(`where to watch ${w.title}${w.year ? ` ${w.year}` : ''}`)}`;
      app.openPanel({ title: `Find “${w.title}”`, className: 'mn-panel mn-where', build(body) { body.append(qrBox(url, 'mn-where-qr'), h('div.mn-ssub', 'Scan to see where it’s streaming')); } });
    }

    function drawStarted() {
      const pg = pages.started; clear(pg);
      const w = cands.find((c) => c.id === winner);
      const names = whoCame();
      pg.append(h('div.mn-enjoy', w ? posterEl(w, '.mid') : null, h('div.mn-win-k', 'Enjoy the movie'), h('div.mn-win-t', { dir: 'auto' }, w?.title || ''),
        names.length ? h('div.mn-who.c', ...names.slice(0, 10).map((n) => h('span.chip', { dir: 'auto' }, n))) : null),
      h('div.mn-bar',
        h('button.mn-btn', { type: 'button', 'aria-label': 'Past movie nights', onclick: () => show('history') }, h('i', { html: icon('clock') }), h('span', 'History')),
        h('button.pill.primary.mn-go', { type: 'button', onclick: () => newNight() }, 'New movie night'),
        h('button.mn-btn', { type: 'button', 'aria-label': 'Start options', onclick: () => { phase = 'start'; savePhase(); show('start'); } }, h('i', { html: icon('settings') }), h('span', 'Again'))));
    }
    function newNight() {
      cands = []; votes = {}; hands = {}; winner = null; tie = false; guests = {};
      app.save('cands', cands); app.save('votes', votes); app.save('hands', hands); app.save('guests', guests);
      putOpts({ extra: [], check: opts().check.map((c) => ({ ...c, done: false })) });
      phase = 'setup'; savePhase(); thumbs.clear(); show('setup'); publish();
    }

    // ---------------- history
    function drawHistory() {
      const pg = pages.history; clear(pg);
      const hist = app.data('history', []);
      const box = h('div.mn-hlist.list');
      if (!hist.length) box.append(h('div.empty', 'Your movie nights will appear here — the winner and who came.'));
      for (const n of hist) {
        const d = new Date(n.at);
        box.append(h('div.mn-hrow',
          h(`div.mn-hart${n.winner.art ? '' : '.noart'}`, { '--k': n.winner.color || '#eab308', style: n.winner.art ? { backgroundImage: `url("${n.winner.art}")` } : null }, n.winner.art ? null : '🎬'),
          h('div.mn-htx', h('div.mn-ht', { dir: 'auto' }, n.winner.title, n.winner.year ? h('span', ` (${n.winner.year})`) : null),
            h('div.mn-hs', d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }), ` · beat ${n.cands.filter((c) => c.title !== n.winner.title).map((c) => c.title).join(', ') || '—'}`),
            n.guests?.length ? h('div.mn-hg', { dir: 'auto' }, `👥 ${n.guests.join(', ')}`) : null)));
      }
      pg.append(box);
      curve(box);
    }

    // ------------------------------------------------------------------ knob / keys
    app.onKey((e) => {
      if (document.querySelector('.panel')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (page === 'setup') { if (cands.length >= 2) startVoting(); else addMenu(); }
        else if (page === 'vote' && !revealing) reveal();
        else if (page === 'reveal' && phase === 'winner') { phase = 'start'; savePhase(); show('start'); }
      } else if (page === 'vote' && /^[1-5]$/.test(e.key)) {
        const c = cands[+e.key - 1]; if (c) { hands[c.id] = (hands[c.id] || 0) + 1; app.save('hands', hands); app.sfx('tick'); drawVote(); publish(); }
      } else if (page === 'setup' && (e.key === '+' || e.key === 'a')) addMenu();
    });

    // resume where we were
    const resume = { setup: 'setup', vote: 'vote', reveal: 'vote', winner: 'reveal', start: 'start', started: 'started' }[phase] || 'setup';
    if (phase === 'reveal') { phase = 'vote'; savePhase(); }
    show(resume);
    link.start(); publish();
    return {
      destroy() { link.stop(); for (const off of offs) off(); },
      back() {
        if (page === 'history') { show(phase === 'started' ? 'started' : 'setup'); return true; }
        if (page === 'start') { phase = 'winner'; savePhase(); show('reveal'); return true; }
        if (page === 'reveal' && !revealing) { phase = 'vote'; savePhase(); show('vote'); publish(); return true; }
        if (page === 'vote') { phase = 'setup'; savePhase(); show('setup'); publish(); return true; }
        return false;
      },
    };
  },
};
