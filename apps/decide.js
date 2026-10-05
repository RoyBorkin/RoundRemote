// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Decide: can't choose? A ring of six deciders — what to watch, what to do, what to play, where to go, which
// video game, what to eat. Each one spins a slot-machine reel (lights, ticks, a clunk and confetti) and lands
// on one pick that respects your quick filters, never repeats the last few picks, and comes with actions:
// play it on the TV, open the game, launch it on the PC, open the place in Maps (QR for your phone)…
// Favourites, history and your own options are kept per decider. Knob: turn = spin, press = spin.
import { h, clear } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { curve, topPanel, listRow, spinner } from '../js/ui/overlay.js';
import { store } from '../js/core/store.js';
import { provider } from '../js/providers/registry.js';
import { qrSvg } from './qr.js';
import { GLYPH } from './decide-data.js';
import { DECIDERS, CUISINE_LIST } from './decide-sources.js';
import { onItems as onCollection } from './collection-store.js';

const TAU = Math.PI * 2;
const rnd = (n) => Math.floor(Math.random() * n);
const svg = (d, cls = 'dc-ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>`;
const gl = (name) => svg(GLYPH[name] || GLYPH.sparkle);
const hasRtl = (s) => /[֐-׿]/.test(s || '');
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const LIGHTS = 36;

export default {
  css: './decide.css',
  create(el, app) {
    const openPanel = (o) => { const p = app.openPanel(o); p.el.style.setProperty('--ac', cur?.color || app.meta.color); p.el.classList.add('dc-pnl'); return p; };
    const N = DECIDERS.length;
    let sel = Math.max(0, DECIDERS.findIndex((d) => d.id === app.data('sel', 'watch')));
    let cur = null;                       // the open decider
    let result = null, spinning = false, alive = true, raf = 0, wish = null;
    const filters = app.data('filters', {});
    const lib = {};                        // decider id → { items, names, errors, loading, promise }
    const ideasCache = {};
    let eatCz = app.data('eatCz', null);

    // the wish-list module is built by another app; hide its button when it's missing
    import('./wishlist-store.js').then((m) => { if (typeof m?.addWish === 'function') wish = m; if (cur && result) drawActions(); }).catch(() => { wish = null; });

    // ================================================================ hub: the ring of deciders
    const ring = h('div.dc-ring');
    const ringItems = DECIDERS.map((d, i) => {
      const a = ((i + 0.5) / N) * TAU;
      const b = h('button.dc-item', { type: 'button', 'aria-label': d.name, '--c': d.color, style: { left: `${50 + 37.5 * Math.sin(a)}%`, top: `${50 - 37.5 * Math.cos(a)}%`, animationDelay: `${i * 40}ms` },
        onclick: (e) => { e.stopPropagation(); if (sel === i) openDecider(i); else select(i); }, html: gl(d.glyph) });
      ring.append(b);
      return b;
    });
    const hBadge = h('div.dc-hbadge'), hName = h('div.dc-hname'), hBlurb = h('div.dc-hblurb');
    const hOpen = h('button.dc-hgo', { type: 'button', onclick: () => openDecider(sel) }, h('span', { html: gl('again') }), 'Let’s decide');
    const hCenter = h('div.dc-hcenter', hBadge, hName, hBlurb, hOpen);
    const hub = h('div.dc-hub', h('div.dc-hglow'), ring, hCenter);

    // ================================================================ a decider page
    const lights = h('div.dc-lights', Array.from({ length: LIGHTS }, (_, i) => {
      const a = (i / LIGHTS) * TAU;
      return h('i', { style: { left: `${50 + 47.6 * Math.sin(a)}%`, top: `${50 - 47.6 * Math.cos(a)}%`, '--i': i } });
    }));
    const chips = h('div.dc-chips');
    const countEl = h('div.dc-count');
    const strip = h('div.dc-strip');
    const reel = h('div.dc-reel', strip);
    const pay = h('div.dc-pay', h('i.l'), h('i.r'));
    const card = h('div.dc-card');
    const stage = h('div.dc-stage', reel, pay, card);
    stage.addEventListener('click', () => { if (!stage.classList.contains('show-card') && !spinning) spin(); });
    const acts = h('div.dc-acts');
    const tuneBtn = h('button.ibtn.dc-tune', { type: 'button', 'aria-label': 'Filters', onclick: () => openFilters(), html: gl('tune') }, h('b.dc-dot'));
    const listBtn = h('button.ibtn.dc-list', { type: 'button', 'aria-label': 'Favourites, history and your own options', onclick: () => openLists(), html: gl('hist') });
    const goBtn = h('button.dc-go', { type: 'button', onclick: () => spin() });
    const bottom = h('div.dc-bottom', tuneBtn, goBtn, listBtn);
    const fx = h('div.dc-fx');
    const page = h('div.dc-page', lights, chips, countEl, stage, acts, bottom, fx);
    const subs = h('div.dc-subs');
    const root = h('div.dc', hub, page, subs);
    el.append(root);

    // ---------------------------------------------------------------- hub selection
    function select(i, quiet = false) {
      sel = (i + N) % N;
      const d = DECIDERS[sel];
      ringItems.forEach((b, j) => b.classList.toggle('on', j === sel));
      root.style.setProperty('--tc', d.color);
      hBadge.innerHTML = gl(d.glyph); hName.textContent = d.name; hBlurb.textContent = d.blurb;
      hCenter.classList.remove('swap'); void hCenter.offsetWidth; hCenter.classList.add('swap');
      app.save('sel', d.id);
      if (!quiet) app.sfx('tick');
    }
    hub.addEventListener('wheel', (e) => { e.preventDefault(); select(sel + Math.sign(e.deltaY || e.deltaX)); }, { passive: false });
    page.addEventListener('wheel', (e) => { e.preventDefault(); if (!spinning && Math.abs(e.deltaY || e.deltaX) > 4) spin(); }, { passive: false });

    // ---------------------------------------------------------------- filters state
    const fOf = (d) => (filters[d.id] ||= {});
    const fval = (d, g) => fOf(d)[g.id] ?? g.def ?? 'any';
    const setF = (d, gid, v) => { fOf(d)[gid] = v; app.save('filters', filters); };
    const isDefault = (d, g) => fval(d, g) === (g.def ?? 'any');

    // ---------------------------------------------------------------- items
    const mineOf = (d) => app.data('mine', {})[d.id] || [];
    const favsOf = (d) => app.data('favs', {})[d.id] || [];
    const hist = () => app.data('hist', []);
    function ideas(d) { return (ideasCache[d.id] ||= d.ideas()); }
    function mineItems(d) {
      return mineOf(d).map((u) => {
        const t = d.mine ? d.mine(u) : { title: u.title };
        return { key: `u:${d.id}:${u.id}`, title: t.title, year: t.year, sub: u.note || (t.year ? `${t.year} · added by you` : 'Added by you'), info: u.note ? '' : '', glyph: d.glyph, color: d.color, src: 'mine', tags: {},
          ref: d.id === 'go' ? { maps: u.title } : d.id === 'watch' ? { kind: 'movie', year: t.year } : d.id === 'vgame' ? { kind: 'game' } : {} };
      });
    }
    const normT = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
    const collOf = (d) => (d.coll ? d.coll() : []);   // your Collection app's games (decide-sources.js)
    function allItems(d) {
      const CL = collOf(d);
      const cT = new Set(CL.map((x) => normT(x.title)));
      // a game in your collection and your Steam / PlayStation library shows up once — as the collection item
      const L = (lib[d.id]?.items || []).filter((x) => !cT.has(normT(x.title)));
      if (!L.length && !CL.length) return [...mineItems(d), ...ideas(d)];
      // an idea that's already in your library shows up once — as the library item
      const keys = new Set([...CL, ...L].map((x) => x.key)), titles = new Set([...cT, ...L.map((x) => normT(x.title))]);
      return [...CL, ...L, ...mineItems(d), ...ideas(d).filter((x) => !keys.has(x.key) && !titles.has(normT(x.title)))];
    }
    const ctxFor = (d) => { const favKeys = new Set(favsOf(d).map((f) => f.key)); return { d, libCount: lib[d.id]?.items?.length || 0, collCount: collOf(d).length, isFav: (k) => favKeys.has(k) }; };
    function passes(d, it, ctx, skip = '') {
      for (const g of d.groups) {
        if (g.id === skip) continue;
        const v = fval(d, g);
        if (v === (g.def ?? 'any') && g.id !== 'src') continue;
        if (g.needsLib && !lib[d.id]?.items?.length) continue;
        if (it.src === 'mine' && g.id !== 'src' && !g.strict) continue;     // your own options have no tags: they pass the tag filters
        if (!g.test(it, v, ctx)) return false;
      }
      return true;
    }
    function pool(d = cur) {
      const ctx = ctxFor(d);
      const items = allItems(d);
      if (d.id === 'eat') {
        const flow = fval(d, d.groups.find((g) => g.id === 'flow'));
        if (flow === 'cz' && !eatCz) {
          const dishes = items.filter((it) => passes(d, it, ctx, 'cz'));
          return CUISINE_LIST.map((c) => ({ c, n: dishes.filter((x) => x.tags.cz === c.id).length })).filter((x) => x.n)
            .map(({ c, n }) => ({ key: `cz:${c.id}`, title: c.name, he: c.he, sub: `${n} dish${n === 1 ? '' : 'es'} to choose from`, glyph: 'fork', color: c.color, src: 'idea', tags: {}, ref: { pickCz: c.id }, cuisine: true }));
        }
        if (flow === 'cz' && eatCz) return items.filter((it) => (it.tags.cz ? it.tags.cz === eatCz : true) && passes(d, it, ctx, 'cz'));
      }
      return items.filter((it) => passes(d, it, ctx));
    }

    // ---------------------------------------------------------------- open / close a decider
    function openDecider(i) {
      select(i, true);
      cur = DECIDERS[sel];
      result = null;
      root.classList.add('open');
      root.style.setProperty('--tc', cur.color);
      app.setTitle(cur.name); app.hideTitle(false);
      stage.classList.remove('show-card');
      drawChips(); idleReel(); drawActions(); drawGo();
      app.sfx('tap');
      if (cur.load && !lib[cur.id]) loadLib(cur);
    }
    function closeDecider() {
      stopReel();
      cur = null; result = null;
      root.classList.remove('open', 'spinning', 'win');
      stage.classList.remove('show-card'); acts.classList.add('hide');
      app.hideTitle(true); app.setTitle();
      select(sel, true);
    }
    function loadLib(d, force = false) {
      const st = (lib[d.id] = { items: lib[d.id]?.items || [], loading: true, names: [], errors: [] });
      if (cur === d) { drawCount(); if (!result) idleReel(); }
      st.promise = d.load({ force }).then((r) => {
        Object.assign(st, { items: r.items || [], names: r.names || [], errors: r.errors || [], loading: false });
      }).catch((e) => { Object.assign(st, { loading: false, errors: [String(e?.message || e)] }); })
        .finally(() => {
          if (!alive || cur !== d) return;
          drawChips();
          if (!spinning && !result) idleReel();
          if (st.errors.length && !st.items.length) app.toast(st.errors[0], { ms: 3600 });
        });
      return st.promise;
    }

    // ---------------------------------------------------------------- chips + count
    function drawChips() {
      const d = cur; if (!d) return;
      const out = [];
      if (d.id === 'eat' && eatCz) {
        const c = CUISINE_LIST.find((x) => x.id === eatCz);
        out.push(h('button.chip.on.dc-czchip', { type: 'button', onclick: () => { eatCz = null; app.save('eatCz', null); drawChips(); idleReel(); app.sfx('tap'); } }, c?.name || eatCz, h('span', { html: icon('close') })));
      }
      for (const [gid, v, label, need] of d.quick) {
        if (need === 'lib' && !lib[d.id]?.items?.length) continue;
        if (need === 'coll' && !collOf(d).length) continue;
        const g = d.groups.find((x) => x.id === gid);
        const on = fval(d, g) === v;
        out.push(h(`button.chip${on ? '.on' : ''}`, { type: 'button', onclick: () => { setF(d, gid, on ? (g.def ?? 'any') : v); app.sfx('tick'); drawChips(); if (!spinning && !result) idleReel(); } }, label));
      }
      chips.replaceChildren(...out);
      const n = d.groups.filter((g) => !isDefault(d, g) && !d.quick.some(([gid]) => gid === g.id)).length;
      tuneBtn.querySelector('.dc-dot').textContent = n ? String(n) : '';
      tuneBtn.classList.toggle('has', !!n);
      drawCount();
    }
    function drawCount() {
      const d = cur; if (!d) return;
      const st = lib[d.id];
      const n = pool().length;
      countEl.classList.toggle('none', !n && !st?.loading);
      if (st?.loading) countEl.replaceChildren(h('span.dc-spin'), d.id === 'watch' ? 'Reading your library…' : 'Looking at your games…');
      else if (!n) countEl.textContent = 'Nothing matches — loosen the filters';
      else {
        const libN = st?.items?.length || 0;
        const sv = fOf(d).src || 'smart', any = sv === 'smart' || sv === 'all';
        const names = [...(collOf(d).length && (any || sv === 'coll') ? ['your collection'] : []), ...(libN && st.names.length && (any || sv === 'lib') ? st.names : [])];
        const from = names.length ? ` · ${names.join(' + ')}` : '';
        countEl.textContent = `${n} option${n === 1 ? '' : 's'}${from}`;
      }
    }
    function drawGo() {
      goBtn.innerHTML = `${gl('again')}<span>${result ? 'Again' : 'Spin'}</span>`;
    }

    // ---------------------------------------------------------------- the reel
    function thumb(it, big = false) {
      const c = it.color || cur?.color;
      const g = h(`div.dc-th${it.shape === 'wide' ? '.wide' : it.shape === 'poster' ? '.poster' : ''}${big ? '.big' : ''}`, { '--c': c, html: it.icon ? svg(it.icon) : gl(it.glyph) });
      if (it.art) {
        const im = h('i.dc-img', { style: { backgroundImage: `url("${it.art}")` } });
        const probe = new Image();
        probe.onload = () => im.classList.add('ok');
        probe.src = it.art;
        g.append(im);
      }
      if (it.src === 'coll') g.append(h('i.dc-mine', { title: 'In your collection', html: svg('M3 4h4v16H3zm5 2h4v14H8zm5-3h3v17h-3zm4.2 2.3l2.9-.8 3.6 13.6-2.9.8z', 'dc-mine-ic') }));
      return g;
    }
    function rowEl(it) {
      if (!it) return h('div.dc-row.ph', h('div.dc-th.q', '?'), h('div.dc-rt', h('b', 'Spin to decide'), h('small', 'Tap Spin — or turn the knob')));
      return h(`div.dc-row${it.src === 'coll' ? '.mine' : ''}`, thumb(it), h('div.dc-rt', h('b', { dir: 'auto' }, it.title), h('small', { dir: 'auto' }, it.sub || it.he || '')));
    }
    const rowH = () => reel.clientHeight / 3;
    function place(p) { strip.style.transform = `translateY(${(rowH() * (1 - p)).toFixed(2)}px)`; }
    function idleReel() {
      if (!cur) return;
      stopReel();
      const st = lib[cur.id];
      const pl = pool();
      if (st?.loading && !pl.length) {
        strip.replaceChildren(h('div.dc-row.ph'), h('div.dc-row.ph', h('div.dc-th.q', h('span.dc-spin.big')), h('div.dc-rt', h('b', 'One moment…'), h('small', 'Reading your library'))), h('div.dc-row.ph'));
      } else {
        const a = pl[rnd(pl.length)], b = pl[rnd(pl.length)];
        strip.replaceChildren(a ? rowEl(a) : h('div.dc-row.ph'), rowEl(null), b ? rowEl(b) : h('div.dc-row.ph'));
        strip.children[0].classList.add('dim'); strip.children[2].classList.add('dim');
      }
      reel.classList.toggle('empty', !pl.length && !st?.loading);
      place(1);
      drawCount();
    }
    function stopReel() { cancelAnimationFrame(raf); raf = 0; spinning = false; root.classList.remove('spinning'); }

    function spin() {
      if (!cur || spinning) return;
      const d = cur;
      const st = lib[d.id];
      let pl = pool();
      if (st?.loading && (d.id === 'watch' || !pl.length)) {
        // wait for the library (it's what you most likely want to pick from)
        countEl.classList.add('bump-s'); setTimeout(() => countEl.classList.remove('bump-s'), 400);
        st.promise?.then(() => { if (cur === d && alive) spin(); });
        app.sfx('tap');
        return;
      }
      if (!pl.length) {
        result = null; stage.classList.remove('show-card'); drawActions(); drawGo();
        idleReel(); app.sfx('over');
        countEl.classList.remove('shake'); void countEl.offsetWidth; countEl.classList.add('shake');
        return;
      }
      // no immediate repeats: skip the last few picks (and the current one) when there is anything else
      const recent = new Set(hist().filter((x) => x.d === d.id).slice(0, Math.min(8, pl.length - 1)).map((x) => x.k));
      let choices = pl.filter((it) => !recent.has(it.key) && it.key !== result?.key);
      if (!choices.length) choices = pl.filter((it) => it.key !== result?.key);
      if (!choices.length) choices = pl;
      const pick = choices[rnd(choices.length)];
      runReel(pl, pick);
    }
    function runReel(pl, pick) {
      const d = cur;
      spinning = true;
      stage.classList.remove('show-card');
      acts.classList.add('hide');
      root.classList.remove('win'); root.classList.add('spinning');
      const fill = pl.length >= 5 ? pl : allItems(d).filter((x) => !x.cuisine).concat(pl);
      const rows = [result || null];
      const n = 24 + rnd(8);
      for (let i = 0; i < n; i++) {
        let x = fill[rnd(fill.length)];
        if (fill.length > 2 && x === rows[rows.length - 1]) x = fill[rnd(fill.length)];
        rows.push(x);
      }
      rows.push(pick, fill[rnd(fill.length)], fill[rnd(fill.length)]);
      strip.replaceChildren(...rows.map((x) => rowEl(x)));
      reel.classList.remove('empty');
      const T = rows.length - 3, over = 0.34, D = 2300 + rnd(600), SETTLE = 260;
      const t0 = performance.now();
      let last = 0, lastTick = 0;
      place(0);
      app.sfx('whoosh'); app.vibrate(15);
      const frame = (now) => {
        if (!alive || cur !== d) return;
        const e = now - t0;
        let p, done = false;
        if (e < D) p = (T + over) * (1 - Math.pow(1 - e / D, 3.2));
        else if (e < D + SETTLE) { const u = (e - D) / SETTLE; p = T + over * (1 - u) * (1 - u); }
        else { p = T; done = true; }
        place(p);
        const idx = Math.round(p);
        if (idx !== last) {
          last = idx;
          if (now - lastTick > 34) { lastTick = now; app.sfx('tick', { volume: 0.8, pitch: 0.85 + Math.random() * 0.3 }); }
          pay.classList.remove('kick'); void pay.offsetWidth; pay.classList.add('kick');
        }
        if (done) { raf = 0; land(pick, strip.children[T]); return; }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }
    function land(it, rowNode) {
      spinning = false;
      root.classList.remove('spinning'); root.classList.add('win');
      setTimeout(() => root.classList.remove('win'), 1500);
      rowNode?.classList.add('hit');
      app.sfx('place'); setTimeout(() => app.sfx('win'), 90); app.vibrate(35);
      confetti();
      result = it;
      record(it);
      drawGo();
      setTimeout(() => { if (result === it && !spinning && cur) showCard(it); }, 650);
    }
    function confetti() {
      const cols = [cur.color, '#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#f78c6b'];
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * TAU, r = 22 + Math.random() * 20;
        fx.append(h('i', { style: { '--dx': `${(Math.sin(a) * r).toFixed(1)}cqmin`, '--dy': `${(-Math.cos(a) * r).toFixed(1)}cqmin`, '--r': `${rnd(720) - 360}deg`, background: cols[i % cols.length], animationDelay: `${rnd(90)}ms` } }));
      }
      setTimeout(() => clear(fx), 1300);
    }

    // ---------------------------------------------------------------- the result card
    function showCard(it, { fromList = false } = {}) {
      result = it;
      const d = cur;
      const wide = it.shape === 'wide';
      const kick = it.cuisine ? 'Cuisine' : it.src === 'coll' ? `From your collection${it.ref?.platform ? ` · ${it.ref.platform}` : ''}` : it.src === 'lib' ? `From your ${it.srcName || 'library'}` : it.src === 'mine' ? 'Added by you' : fromList ? 'From your list' : d.id === 'eat' && it.ref?.cz ? CUISINE_LIST.find((c) => c.id === it.ref.cz)?.name || 'Idea' : 'Idea';
      const title = h('div.dc-ctitle', { dir: 'auto' }, it.title);
      if (it.title.length > 34) title.classList.add('long');
      const he = it.he && !hasRtl(it.title) ? h('div.dc-che', { dir: 'rtl' }, it.he) : null;
      const info = h('div.dc-cinfo', { dir: 'auto' }, it.info || '');
      const art = it.art ? thumb(it, true) : null;
      card.className = `dc-card${art ? ' has-art' : ''}${wide ? ' wide' : ''}${it.cuisine ? ' cz' : ''}`;
      card.replaceChildren(...(art && !wide ? [art] : []), h('div.dc-ctext', ...(wide && art ? [art] : []), h('div.dc-kick', kick), title, he, h('div.dc-cmeta', { dir: 'auto' }, it.sub || ''), info));
      if (!art) card.prepend(h('div.dc-cbadge', { '--c': it.color || d.color, html: it.icon ? svg(it.icon) : gl(it.glyph) }));
      stage.classList.add('show-card');
      drawActions(); drawGo();
      // library items: fetch the summary if we don't have it
      if (it.src === 'lib' && !it.info && it.ref?.pid && it.ref.entry) {
        provider(it.ref.pid)?.details?.(it.ref.entry).then((det) => {
          if (result !== it) return;
          it.info = det?.summary || '';
          if (!it.tags.genres && det?.genres) it.tags.genres = det.genres;
          info.textContent = it.info;
        }).catch(() => {});
      }
    }

    // ---------------------------------------------------------------- actions
    const pill = (label, ic, fn, cls = '') => h(`button.pill.dc-act${cls}`, { type: 'button', onclick: (e) => { e.stopPropagation(); fn(); } }, h('span', { html: ic.startsWith('M') ? svg(ic) : gl(ic) }), label);
    const roundBtn = (label, ic, fn, cls = '') => h(`button.ibtn.dc-rb${cls}`, { type: 'button', 'aria-label': label, title: label, onclick: (e) => { e.stopPropagation(); fn(); }, html: gl(ic) });
    function drawActions() {
      const d = cur, it = result;
      acts.classList.toggle('hide', !it || !stage.classList.contains('show-card'));
      if (!d || !it) { acts.replaceChildren(); return; }
      const fav = isFav(d, it);
      const heart = roundBtn(fav ? 'Remove from favourites' : 'Save to favourites', fav ? 'heart' : 'heartO', () => toggleFav(it), fav ? '.fav.on' : '.fav');
      const out = [heart];
      const primary = primaryAction(d, it);
      out.push(primary ? pill(primary.label, primary.icon, primary.run, '.primary') : pill('I’m in!', 'check', () => imIn(it), '.primary'));
      for (const s of secondaryActions(d, it)) out.push(roundBtn(s.label, s.icon, s.run, s.on ? '.on' : ''));
      acts.replaceChildren(...out);
    }
    function primaryAction(d, it) {
      const r = it.ref || {};
      if (it.cuisine) return { label: 'Pick a dish', icon: 'fork', run: () => { eatCz = r.pickCz; app.save('eatCz', eatCz); drawChips(); result = null; spin(); } };
      if (d.id === 'watch') {
        if (r.pid) return { label: 'Play on TV', icon: 'play', run: () => playOnTv(it) };
        return { label: 'Where to watch', icon: 'qr', run: () => openLink(`Find “${it.title}”`, `https://www.google.com/search?q=${encodeURIComponent(`where to watch ${it.title}${it.year ? ` ${it.year}` : ''}`)}`, 'Scan to see where it’s streaming') };
      }
      if (d.id === 'play') {
        if (r.go) return { label: r.go[0] === 'game' ? 'Play' : 'Open', icon: 'play', run: () => { app.sfx('tap'); app.go(...r.go); } };
        if (r.rules) return { label: 'Rules', icon: 'book', run: () => openRules(r.rules) };
      }
      if (d.id === 'go' && r.maps) return { label: 'Find nearby', icon: 'pin', run: () => openMaps(r.maps, it.title) };
      if (d.id === 'vgame' && r.appid && (it.src === 'lib' || (it.src === 'coll' && r.steam))) return { label: 'Launch on PC', icon: 'play', run: () => launchSteam(it) };
      if (d.id === 'vgame' && r.appid) return { label: 'Steam page', icon: 'qr', run: () => openLink(it.title, `https://store.steampowered.com/app/${r.appid}`, 'Scan to see it on Steam') };
      if (d.id === 'eat' && !it.cuisine) {
        const ways = it.tags.ways || ['c'];
        const want = fval(d, d.groups.find((g) => g.id === 'way'));
        const w = ways.includes(want) ? want : ways[0];
        const q = it.title;
        if (w === 'c') return { label: 'Recipe', icon: 'book', run: () => openLink(`${q} — recipe`, `https://www.google.com/search?q=${encodeURIComponent(`${q} recipe`)}`, 'Scan for recipes on your phone') };
        if (w === 'o') return { label: 'Order', icon: 'bag', run: () => openLink(`Order ${q}`, `https://www.google.com/search?q=${encodeURIComponent(`${q} delivery near me`)}`, 'Scan to find delivery near you') };
        return { label: 'Find a place', icon: 'pin', run: () => openMaps(`${q} restaurant`, q) };
      }
      return null;
    }
    function secondaryActions(d, it) {
      const r = it.ref || {}, out = [];
      if (d.id === 'play' && r.rules && r.companion) out.push({ label: 'Game helper', icon: 'meeple', run: () => openCompanion(r.companion) });
      if (d.id === 'play' && r.go) out.push({ label: 'I’m in!', icon: 'check', run: () => imIn(it) });
      if ((d.id === 'watch' || d.id === 'vgame') && wish && it.src !== 'coll') {
        let on = false;
        try { on = !!wish.hasWish?.({ kind: it.ref?.kind || (d.id === 'vgame' ? 'game' : 'movie'), title: it.title, year: it.year || it.ref?.year }); } catch {}
        out.push({ label: on ? 'On your wish list' : 'Add to wish list', icon: 'gift', on, run: () => addWish(it) });
      }
      if (d.id === 'eat' && eatCz && !it.cuisine) out.push({ label: 'Another cuisine', icon: 'again', run: () => { eatCz = null; app.save('eatCz', null); drawChips(); result = null; spin(); } });
      return out.slice(0, 2);
    }
    function imIn(it) {
      const hs = hist(); const e = hs.find((x) => x.d === cur.id && x.k === it.key);
      if (e) { e.ok = 1; app.save('hist', hs); }
      confetti(); app.sfx('perfect'); app.toast(['Have fun!', 'Great choice!', 'Enjoy!', 'Decided!'][rnd(4)]);
    }

    async function playOnTv(it) {
      const p = provider(it.ref.pid);
      if (!p) return;
      const target = () => p.playerId || p.session;
      try {
        if (!target()) await p.refresh().catch(() => {});
        if (!target()) { pickDevice(p, it); return; }
        await p.playMedia(it.ref.entry, {});
        app.sfx('win'); app.toast(`Playing ${it.title} on the TV`);
        setTimeout(() => p.refresh?.().catch(() => {}), 900);
      } catch (e) {
        const msg = e?.userMessage || e?.message || 'Couldn’t start it';
        if (/device|player|session/i.test(msg)) pickDevice(p, it); else app.toast(msg, { kind: 'error' });
      }
    }
    function pickDevice(p, it) {
      openPanel({
        title: 'Play on…',
        build(body, panel) {
          const list = h('div.list');
          body.append(list); curve(list);
          list.append(spinner('Looking for TVs and players…'));
          p.getDevices().then((devs) => {
            clear(list);
            if (!devs.length) { list.append(h('div.empty', `No ${p.name} players found. Open ${p.name} on your TV and try again.`)); return; }
            for (const dv of devs) list.append(listRow({ title: dv.name, subtitle: dv.type || '', mono: dv.active ? '●' : '○', active: dv.active,
              onClick: async () => {
                try { await p.selectDevice(dv); panel.close(); await p.playMedia(it.ref.entry, {}); app.sfx('win'); app.toast(`Playing ${it.title} on ${dv.name}`); }
                catch (e) { app.toast(e?.userMessage || e?.message || 'Couldn’t start it', { kind: 'error' }); }
              } }));
          }).catch((e) => { clear(list); list.append(h('div.empty', e?.userMessage || e?.message || 'Couldn’t list the players')); });
        },
      });
    }
    async function launchSteam(it) {
      const p = provider('steam');
      try { await p.launch(it.ref.appid); app.sfx('win'); app.toast(`Starting ${it.title} on the bridge computer`); }
      catch (e) { app.toast(e?.body?.error || e?.userMessage || e?.message || 'Couldn’t reach the bridge', { kind: 'error', ms: 4000 }); }
    }
    async function addWish(it) {
      try {
        const r = it.ref || {};
        const source = r.pid === 'plexvideo' ? 'plex' : r.pid === 'jellyfinvideo' ? 'jellyfin' : it.src === 'lib' && r.platform === 'Steam' ? 'steam' : it.src === 'lib' && r.platform ? 'psn' : 'decide';
        const res = await wish.addWish({ kind: r.kind || (cur.id === 'vgame' ? 'game' : 'movie'), title: it.title, year: it.year || r.year || null, art: /^data:/.test(it.art || '') ? '' : it.art || '',
          source, ref: r.appid ? String(r.appid) : r.entry?.id ? String(r.entry.id) : '', inLibrary: it.src === 'lib' && cur.id === 'watch' });
        if (!res) throw new Error('not saved');
        app.sfx('coin'); app.toast(res.duplicate ? 'Already on your wish list' : 'Added to your wish list'); drawActions();
      } catch (e) { app.toast(`Couldn’t add it: ${e?.message || e}`, { kind: 'error' }); }
    }
    function openMaps(q, title) {
      openLink(title, `https://www.google.com/maps/search/${encodeURIComponent(q).replace(/%20/g, '+')}+near+me`, 'Scan to open it in Maps on your phone');
    }
    function openLink(title, url, hint) {
      openPanel({
        title,
        build(body) {
          const qr = h('div.dc-qr', { html: qrSvg(url, { margin: 2, dark: '#111', light: '#fff' }) });
          body.append(h('div.dc-qrwrap', qr, h('div.dc-qrhint', hint), h('div.dc-qrurl', url.replace(/^https:\/\/(www\.)?/, '')),
            h('button.pill.small.dc-qropen', { type: 'button', onclick: () => { try { window.open(url, '_blank', 'noopener'); } catch {} } }, 'Open on this screen')));
        },
      });
      app.sfx('pop');
    }

    // ---------------------------------------------------------------- favourites, history, your own options
    const snap = (it) => ({ key: it.key, title: it.title, he: it.he, sub: it.sub, info: it.info, art: it.art, shape: it.shape, glyph: it.glyph, icon: it.icon, color: it.color, src: it.src, srcName: it.srcName, year: it.year, tags: it.tags, ref: it.ref, cuisine: it.cuisine });
    const isFav = (d, it) => favsOf(d).some((f) => f.key === it.key);
    function toggleFav(it) {
      const all = app.data('favs', {});
      const list = all[cur.id] || [];
      const on = list.some((f) => f.key === it.key);
      all[cur.id] = on ? list.filter((f) => f.key !== it.key) : [snap(it), ...list].slice(0, 100);
      app.save('favs', all);
      app.sfx(on ? 'drop' : 'coin');
      if (!on) app.toast('Saved to favourites');
      drawActions(); drawCount();
    }
    function record(it) {
      const hs = hist();
      hs.unshift({ d: cur.id, k: it.key, t: it.title, s: it.sub || '', at: Date.now(), it: snap({ ...it, info: '' }) });
      app.save('hist', hs.slice(0, 80));
    }
    function liveItem(key, fallback) { return allItems(cur).find((x) => x.key === key) || pool().find((x) => x.key === key) || fallback; }

    function openLists() {
      const d = cur;
      let tab = app.data('listTab', 'fav');
      openPanel({
        title: d.name,
        build(body, panel) {
          const tabs = h('div.dc-tabs');
          const top = h('div.dc-ltop');
          const list = h('div.list.dc-llist');
          body.append(tabs, top, list); curve(list);
          const showIt = (it) => { panel.close(); stopReel(); showCard(it, { fromList: true }); app.sfx('tap'); };
          const draw = () => {
            tabs.replaceChildren(...[['fav', 'Favourites'], ['hist', 'History'], ['mine', 'My options']].map(([id, label]) =>
              h(`button.chip${tab === id ? '.on' : ''}`, { type: 'button', onclick: () => { tab = id; app.save('listTab', id); draw(); } }, label)));
            clear(top); clear(list);
            if (tab === 'fav') {
              const favs = favsOf(d);
              if (!favs.length) list.append(h('div.empty', 'No favourites yet — tap ♥ on a pick to keep it here.'));
              favs.forEach((f) => list.append(row(f, () => showIt(liveItem(f.key, f)), () => { const all = app.data('favs', {}); all[d.id] = favsOf(d).filter((x) => x.key !== f.key); app.save('favs', all); draw(); app.sfx('drop'); })));
              if (favs.length > 1) top.append(h('button.pill.small', { type: 'button', onclick: () => { setF(d, 'src', 'fav'); panel.close(); drawChips(); spin(); } }, 'Spin my favourites'));
            } else if (tab === 'hist') {
              const hs = hist().filter((x) => x.d === d.id);
              if (!hs.length) list.append(h('div.empty', 'Nothing picked yet.'));
              hs.forEach((x) => list.append(row({ ...(x.it || {}), title: x.t, sub: `${x.ok ? '✓ chosen · ' : ''}${ago(x.at)}${x.s ? ` · ${x.s}` : ''}` }, () => showIt(liveItem(x.k, x.it || { key: x.k, title: x.t, sub: x.s, tags: {}, glyph: d.glyph })))));
              if (hs.length) top.append(h('button.pill.small', { type: 'button', onclick: () => { app.save('hist', hist().filter((x) => x.d !== d.id)); draw(); app.sfx('drop'); } }, 'Clear history'));
            } else {
              const mine = mineOf(d);
              top.append(h('button.pill.small.primary.dc-addbtn', { type: 'button', onclick: () => addMine(d, draw) }, h('span', { html: icon('plus') }), d.add.title));
              if (!mine.length) list.append(h('div.empty', 'Add your own options — they join the spin.'));
              mine.forEach((u) => list.append(row({ title: u.title, sub: u.note || 'Added by you', glyph: d.glyph, color: d.color }, async () => {
                const v = await app.editText({ title: 'Edit', value: u.title, okLabel: 'Save' });
                if (v === null) return;
                setMine(d, v ? mineOf(d).map((x) => (x.id === u.id ? { ...x, title: v } : x)) : mineOf(d).filter((x) => x.id !== u.id)); draw();
              }, () => { setMine(d, mineOf(d).filter((x) => x.id !== u.id)); draw(); app.sfx('drop'); })));
            }
          };
          const row = (it, onOpen, onDel) => h('div.dc-lrow',
            h('button.dc-lmain', { type: 'button', onclick: onOpen }, thumb(it), h('span.dc-ltext', h('b', { dir: 'auto' }, it.title), h('small', { dir: 'auto' }, it.sub || ''))),
            onDel ? h('button.dc-ldel', { type: 'button', 'aria-label': `Remove ${it.title}`, html: icon('close'), onclick: onDel }) : null);
          draw();
        },
        onClose: () => { if (cur) { drawChips(); if (!result && !spinning) idleReel(); } },
      });
    }
    const setMine = (d, list) => { const all = app.data('mine', {}); all[d.id] = list; app.save('mine', all); };
    async function addMine(d, after) {
      const v = await app.editText({ title: d.add.title, placeholder: d.add.placeholder, okLabel: 'Add' });
      if (!v) return;
      let note = '';
      if (d.add.note) note = (await app.editText({ title: 'Note', placeholder: d.add.note, okLabel: 'Save' })) || '';
      const parts = d.add.note ? [v] : v.split(/\s*,\s*/).filter(Boolean);
      setMine(d, [...mineOf(d), ...parts.map((t, i) => ({ id: `${Date.now().toString(36)}${i}`, title: t.trim(), note }))].slice(-200));
      app.sfx('pop'); after?.();
    }

    // ---------------------------------------------------------------- the filter panel
    function openFilters() {
      const d = cur;
      openPanel({
        title: 'Filters',
        build(body) {
          const box = h('div.dc-filters');
          body.append(box);
          const draw = () => {
            clear(box);
            for (const g of d.groups) {
              if (g.needsLib && !lib[d.id]?.items?.length) continue;
              const v = fval(d, g);
              const opts = typeof g.opts === 'function' ? g.opts(d, ctxFor(d)) : g.opts;
              box.append(h('div.dc-fg', h('div.dc-fl', g.label),
                h('div.dc-fopts', opts.map(([val, label]) => h(`button.chip${v === val ? '.on' : ''}`, { type: 'button', dir: 'auto', onclick: () => { setF(d, g.id, val); if (g.id === 'flow') { eatCz = null; app.save('eatCz', null); } app.sfx('tick'); draw(); } }, label)))));
            }
            const n = pool().length;
            box.append(h('div.dc-fsum', `${n} option${n === 1 ? '' : 's'} match`),
              h('button.pill.small.dc-freset', { type: 'button', onclick: () => { filters[d.id] = {}; app.save('filters', filters); eatCz = null; app.save('eatCz', null); app.sfx('drop'); draw(); } }, 'Reset filters'));
            if (d.load) box.append(h('button.pill.small.dc-freset', { type: 'button', onclick: () => { loadLib(d, true); app.toast('Reloading your library…'); } }, d.id === 'watch' ? 'Reload library' : 'Reload my games'));
          };
          draw(); curve(box);
        },
        onClose: () => { if (cur) { drawChips(); if (!result && !spinning) idleReel(); } },
      });
    }

    // ---------------------------------------------------------------- rules reader & board game helpers (Board Games' own pages)
    const subStack = [];
    const bgData = (k, init) => { const v = ((store.get('appData') || {}).boardgames || {})[k]; return v === undefined ? init : v; };
    const bgSave = (k, v) => { const all = store.get('appData') || {}; store.set('appData', { ...all, boardgames: { ...(all.boardgames || {}), [k]: v } }); };
    function bgCss() {
      if (document.querySelector('link[data-app-css="boardgames"]')) return;
      document.head.append(h('link', { rel: 'stylesheet', href: new URL('./boardgames.css', import.meta.url).href, dataset: { appCss: 'boardgames' } }));
    }
    const bgCtx = {
      app: { ...app, data: bgData, save: bgSave, setTitle: (t) => app.setTitle(t), hideTitle: (v) => app.hideTitle(v) },
      data: bgData, save: bgSave, root: subs,
      push: (o) => pushSub(o), pop: () => popSub(),
      setTitle: (t) => { const top = subStack[subStack.length - 1]; if (top) top.title = t; app.setTitle(t); },
      hideTitle: (v = true) => { const top = subStack[subStack.length - 1]; if (top) top.hideTitle = v; app.hideTitle(v); },
      openTool: () => app.go('app', { id: 'boardgames' }),
    };
    let subSeq = 0, subLoading = false;
    async function pushSub({ file, mount, title, color, opts }) {
      bgCss();
      const my = ++subSeq;
      subLoading = true;
      try {
        const fn = mount || (await import(file)).mount;
        if (!alive || my !== subSeq) return;   // Back was pressed while it loaded
        const pg = h('div.bg-page.dc-sub', color ? { '--pc': color } : null);
        const entry = { el: pg, inst: null, title: title || '', hideTitle: false };
        subStack.push(entry);
        subs.append(pg); root.classList.add('sub-open');
        app.setTitle(entry.title); app.hideTitle(false);
        entry.inst = fn(pg, bgCtx, opts) || {};
        app.sfx('tap');
      } catch (e) { console.error('[decide]', e); app.toast(`Couldn’t open it: ${e.message || e}`); }
      finally { if (my === subSeq) subLoading = false; }
    }
    function popSub() {
      const top = subStack.pop();
      if (!top) return false;
      try { top.inst?.destroy?.(); } catch {}
      top.el.remove();
      const prev = subStack[subStack.length - 1];
      if (prev) { app.setTitle(prev.title); app.hideTitle(prev.hideTitle); }
      else { root.classList.remove('sub-open'); app.setTitle(cur?.name); app.hideTitle(!cur); }
      return true;
    }
    async function openRules(id) {
      const { reader } = await import('./bg-rulesview.js');
      const { RULES } = await import('./bg-rules.js');
      const r = RULES.find((x) => x.id === id);
      if (r) pushSub({ mount: (e2, c2) => reader(e2, c2, r), title: r.name, color: '#a855f7' });
    }
    async function openCompanion(id) {
      const { COMPANIONS } = await import('./bg-games.js');
      const c = COMPANIONS.find((x) => x.id === id);
      if (c) pushSub({ file: c.file, title: c.name, color: c.color, opts: c.opts });
    }

    // ================================================================ keys
    app.onKey((e) => {
      if (topPanel()) return;
      if (subStack.length) { const top = subStack[subStack.length - 1]; if (top.inst?.key?.(e)) e.preventDefault(); return; }
      const k = e.key;
      if (cur) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(k)) { e.preventDefault(); spin(); }
        else if (k === 'f' && result) toggleFav(result);
        return;
      }
      if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); openDecider(sel); }
    });
    // keep the reel aligned when the screen size changes
    const ro = new ResizeObserver(() => { if (cur && !spinning) place(1 + (strip.children.length > 3 ? strip.children.length - 4 : 0)); });
    ro.observe(reel);

    select(sel, true);
    app.hideTitle(true);
    // the Collection app's "Pick something to play" opens a decider straight away (its filters are already saved)
    const jump = app.data('jump', null);
    if (jump) {
      app.save('jump', null);
      const i = DECIDERS.findIndex((d) => d.id === jump.d);
      if (i >= 0 && Date.now() - (jump.at || 0) < 60000) openDecider(i);
    }
    // your collection changed (another screen, a sync): recount
    const offColl = onCollection(() => { if (cur && alive && !spinning) { drawChips(); if (!result) idleReel(); } });
    return {
      destroy() { alive = false; stopReel(); ro.disconnect(); offColl(); while (subStack.length) popSub(); },
      back() {
        if (subLoading) { subSeq++; subLoading = false; return true; }   // cancel a page that's still loading
        if (subStack.length) { const top = subStack[subStack.length - 1]; if (top.inst?.back?.()) return true; popSub(); return true; }
        if (cur) { closeDecider(); app.sfx('tap'); return true; }
        return false;
      },
    };
  },
};
