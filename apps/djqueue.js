// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Party DJ: guests scan the QR code, search songs on their phones, request them and vote them up or down; the
// round display keeps the queue (most votes first, then oldest) and plays the top request on the music service
// that's playing when the current song ends. When the queue is empty the normal playlist just keeps going.
//
// How searching works: the DISPLAY searches. A phone sends "search <q>" to the bridge, the bridge relays it to the
// display, the display runs the current music service's search and sends the results back to that phone only.
// Phones can also request a song "as typed" (artist – title); the display finds it with the same search when it's
// that song's turn. This works with every service that can search, and keeps service logins on the display.
// Without the bridge: pass the remote — + searches on the display, ▲ / ▼ vote on the display.
import { clear } from '../js/ui/dom.js';
import { curve, listRow, spinner } from '../js/ui/overlay.js';
import { SERVICES, provider as providerById, inSection } from '../js/providers/registry.js';
import { partyLink, qrBox, phoneThumb, linkProblem } from './party-link.js';

const DEF = { approve: false, maxPer: 3, skipNeed: 3, noExplicit: false, auto: true, closed: false };
const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const trackKey = (t) => (t ? t.id || `${t.title}|${t.artist}` : null);
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const isExplicit = (it) => !!it?.explicit || /\(explicit\)|\[explicit\]/i.test(it?.title || '');
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('The music service took too long')), ms))]);

export default {
  css: './djqueue.css',
  create(el, app) {
    const { h, icon, player } = app;
    el.classList.add('dj');
    const set = () => ({ ...DEF, ...app.data('settings', {}) });
    let queue = app.data('queue', []);                  // requests: { id, key, item, text, title, sub, art, artD, by, byDevice, at, votes, hv, pending, explicit }
    let guests = app.data('guests', {});                // device → { name, first, last }
    let blocked = app.data('blocked', []);              // [device]
    let history = app.data('history', []);              // played requests (newest first)
    let nowReq = app.data('nowReq', null);              // the request that is playing (matched by track key)
    let expectUntil = 0, advancing = false, nearEndKey = null, skipVoters = new Set(), skipKey = null, sel = -1, page = 'main';
    const lastResults = new Map();                      // device → Map(key → full result) (keeps full-size art for the display)
    const offs = [];

    const saveQ = () => { app.save('queue', queue); publish(); render(); };
    const score = (r) => Object.values(r.votes || {}).reduce((a, b) => a + b, 0) + (r.hv || 0);
    const sorted = () => queue.slice().sort((a, b) => (!!a.pending - !!b.pending) || (score(b) - score(a)) || (a.at - b.at));
    const playable = () => sorted().filter((r) => !r.pending);
    const svc = () => player.provider;
    const canSearch = () => !!svc()?.caps?.search;

    // ------------------------------------------------------------------ the link to the phones
    const link = partyLink('dj', app, { onAct });
    offs.push(link.events.on('status', () => { drawBar(); if (page === 'qr') drawQr(); else drawList(); }));
    offs.push(link.events.on('room', () => { if (page === 'qr') drawQr(); }));

    function onAct(a) {
      const dev = a.device, name = a.name || 'Guest';
      if (blocked.includes(dev)) return;
      const g = guests[dev] || { name, first: Date.now() };
      g.name = name; g.last = Date.now(); guests[dev] = g; app.save('guests', guests);
      const s = set();
      if (a.type === 'join') { publish(); drawBar(); return; }
      if (a.type === 'search') return phoneSearch(dev, a.q, a.sid);
      if (a.type === 'request') {
        if (s.closed) return tell(dev, 'Requests are closed right now');
        const item = a.item ? { ...(lastResults.get(dev)?.get(keyOfItem(a.item)) || {}), ...a.item } : null;
        if (item) item.art = lastResults.get(dev)?.get(keyOfItem(a.item))?.art || a.item.art;
        const res = addRequest({ item, text: a.text, by: name, byDevice: dev, phoneArt: a.item?.art || '' });
        if (res?.error) tell(dev, res.error);
        return;
      }
      if (a.type === 'vote') {
        const r = queue.find((x) => x.id === a.rid);
        if (!r || r.byDevice === dev && a.v < 0) return;
        r.votes ||= {};
        if (a.v) r.votes[dev] = a.v; else delete r.votes[dev];
        saveQ(); return;
      }
      if (a.type === 'cancel') {
        const r = queue.find((x) => x.id === a.rid);
        if (r && r.byDevice === dev) { queue = queue.filter((x) => x !== r); saveQ(); }
        return;
      }
      if (a.type === 'skip') {
        const tk = trackKey(player.state.track);
        if (!tk || !s.skipNeed) return;
        if (skipKey !== tk) { skipKey = tk; skipVoters = new Set(); }
        if (a.v === 0) skipVoters.delete(dev); else skipVoters.add(dev);
        drawNow(); publish();
        if (skipVoters.size >= s.skipNeed) { app.toast(`Skipped — ${skipVoters.size} guests voted`); app.sfx('whoosh'); skipVoters = new Set(); advance({ reason: 'skip' }); }
      }
    }
    const tell = (dev, msg) => link.reply(dev, { type: 'toast', msg });
    const keyOfItem = (it) => `${it.id || ''}|${norm(it.title)}`;

    async function phoneSearch(dev, q, sid) {
      const p = svc();
      if (!p || !canSearch()) { link.reply(dev, { type: 'search', sid, results: [], nosearch: true }); return; }
      let items = [];
      try { items = (await withTimeout(p.search(q), 8000) || []).filter((x) => (x.kind || 'track') === 'track').slice(0, 12); } catch (e) { console.warn('[dj] search', e); }
      const s = set();
      const map = new Map();
      const out = await Promise.all(items.map(async (x) => {
        const it = { kind: 'track', id: String(x.id ?? ''), uri: x.uri || '', albumUri: x.albumUri || '', title: x.title || '', subtitle: x.subtitle || '', explicit: isExplicit(x) };
        map.set(keyOfItem(it), { ...x, explicit: it.explicit });
        return { ...it, art: await phoneThumb(x.art, 72) };
      }));
      lastResults.set(dev, map);
      if (lastResults.size > 60) lastResults.delete(lastResults.keys().next().value);
      link.reply(dev, { type: 'search', sid, results: s.noExplicit ? out.filter((x) => !x.explicit).concat(out.filter((x) => x.explicit)) : out });
    }

    /** Add a request (from a phone or the display). Returns { error } when it can't be added. */
    function addRequest({ item, text, by, byDevice, phoneArt = '' }) {
      const s = set();
      if (item && s.noExplicit && isExplicit(item)) return { error: 'Explicit songs are off tonight' };
      const key = item ? keyOfItem(item) : `|${norm(text)}`;
      const dup = queue.find((r) => r.key === key || (item && r.item && norm(r.title) === norm(item.title) && norm(r.sub) === norm(item.subtitle)));
      if (dup) {   // already asked for: count it as a vote instead
        if (byDevice !== 'display') { dup.votes ||= {}; dup.votes[byDevice] = 1; } else dup.hv = (dup.hv || 0) + 1;
        saveQ(); if (byDevice !== 'display') tell(byDevice, 'Already in the queue — we counted your vote');
        return null;
      }
      if (byDevice !== 'display' && s.maxPer && queue.filter((r) => r.byDevice === byDevice).length >= s.maxPer) return { error: `You have ${s.maxPer} songs waiting — let one play first` };
      const [artist, ...rest] = String(item?.subtitle || '').split(' · ');
      const r = {
        id: uid(), key, item: item ? { kind: item.kind || 'track', id: item.id, uri: item.uri || '', albumUri: item.albumUri || '', title: item.title, subtitle: item.subtitle || '' } : null,
        text: item ? '' : text, title: item ? item.title : text, sub: item ? artist || rest.join(' · ') : 'as typed',
        art: '', artD: item?.art && !/^data:/.test(item.art) ? item.art : '', by, byDevice, at: Date.now(), votes: {}, hv: 0,
        pending: byDevice !== 'display' && s.approve, explicit: isExplicit(item),
      };
      queue.push(r);
      app.sfx('pop'); app.vibrate(12);
      flash(r);
      saveQ();
      const art = item?.art || phoneArt;
      if (art) phoneThumb(art, 96).then((u) => { if (u) { r.art = u; app.save('queue', queue); publish(); render(); } });
      // nothing playing at all (or the playlist ended) → start right away
      if (!r.pending && s.auto && player.provider && !player.state.isPlaying && !player.state.track) setTimeout(() => advance({ reason: 'idle' }), 300);
      return null;
    }

    // ------------------------------------------------------------------ playing requests
    async function advance({ reason = 'next', first = null } = {}) {
      if (advancing) return;
      const p = svc();
      let list = playable();
      if (first) { const f = queue.find((x) => x.id === first); if (f) list = [f, ...list.filter((x) => x !== f)]; }
      if (!list.length) { if (reason === 'skip' || reason === 'manual') player.next(); return; }
      if (!p) { app.toast('Choose a music service first'); return; }
      advancing = true;
      try {
        for (const r of list) {
          let item = r.item;
          if (!item) {   // typed request: find it now
            try {
              const res = (await withTimeout(p.search(r.text), 8000) || []).filter((x) => (x.kind || 'track') === 'track');
              const s = set();
              item = res.find((x) => !(s.noExplicit && isExplicit(x))) || null;
            } catch { item = null; }
          }
          queue = queue.filter((x) => x.id !== r.id);
          if (!item) { app.toast(`Couldn’t find “${r.title}” — skipping it`, { kind: 'error' }); if (r.byDevice !== 'display') tell(r.byDevice, `The DJ couldn’t find “${r.title}”`); continue; }
          nowReq = { id: r.id, title: item.title || r.title, by: r.by, byDevice: r.byDevice, art: r.art, at: Date.now(), tk: null };
          expectUntil = performance.now() + 10000;
          app.save('nowReq', nowReq);
          history = [{ title: nowReq.title, sub: r.sub, by: r.by, at: Date.now() }, ...history].slice(0, 40); app.save('history', history);
          saveQ();
          try { await p.playItem({ kind: 'track', ...item }); }
          catch (e) { app.toast(e?.userMessage || e?.message || 'Couldn’t play it', { kind: 'error' }); }
          setTimeout(() => p.refresh?.().catch(() => {}), 600);
          app.sfx('score');
          break;
        }
      } finally { advancing = false; render(); publish(); }
    }

    function onTrack(t) {
      const tk = trackKey(t);
      if (skipKey !== tk) { skipVoters = new Set(); skipKey = tk; }
      nearEndKey = null;
      if (nowReq && performance.now() < expectUntil) { nowReq.tk = tk; expectUntil = 0; app.save('nowReq', nowReq); }
      else if (nowReq && nowReq.tk !== tk) { nowReq = null; app.save('nowReq', null); if (t && set().auto && playable().length) advance({ reason: 'track' }); }
      else if (!nowReq && t && set().auto && playable().length && performance.now() > expectUntil) advance({ reason: 'track' });
      drawNow(); publish();
    }
    offs.push(player.on('track', onTrack));
    let lastPlaying = null;
    offs.push(player.on('state', (s) => { if (s.isPlaying !== lastPlaying) { lastPlaying = s.isPlaying; drawNow(); publish(); } }));
    offs.push(player.on('provider', () => { drawNow(); publish(); }));
    // just before the current song ends, start the top request (no blip of the playlist's next song)
    app.every(400, () => {
      drawProgress();
      const s = player.state, d = s.track?.durationMs || 0;
      if (!set().auto || !s.isPlaying || !d || advancing || performance.now() < expectUntil) return;
      const tk = trackKey(s.track);
      if (d - player.position() < 1400 && nearEndKey !== tk && playable().length) { nearEndKey = tk; advance({ reason: 'end' }); }
    });
    app.every(12000, () => publish());

    // ------------------------------------------------------------------ public state for phones
    let nowArt = { src: null, url: '' };
    function publish() {
      const s = set(), t = player.state.track;
      if (t?.art && nowArt.src !== t.art) { nowArt = { src: t.art, url: '' }; const src = t.art; phoneThumb(src, 120).then((u) => { if (nowArt.src === src) { nowArt.url = u; publish(); } }); }
      const mine = nowReq && t && (nowReq.tk === trackKey(t) || performance.now() < expectUntil);
      const state = {
        v: 1, service: svc()?.name || '',
        settings: { approve: s.approve, maxPer: s.maxPer, skipNeed: s.skipNeed, noExplicit: s.noExplicit, closed: s.closed, canSearch: canSearch() },
        now: t ? { key: trackKey(t), title: t.title || '', artist: t.artist || '', art: nowArt.url, dur: t.durationMs || 0, pos: Math.round(player.position()), playing: !!player.state.isPlaying,
          by: mine ? nowReq.by : '', byDevice: mine ? nowReq.byDevice : '', skips: skipKey === trackKey(t) ? skipVoters.size : 0, skipVoters: skipKey === trackKey(t) ? [...skipVoters] : [] } : null,
        queue: sorted().map((r) => ({ id: r.id, key: r.key, title: r.title, sub: r.sub, art: r.art, by: r.by, byDevice: r.byDevice, votes: r.votes, score: score(r), pending: !!r.pending, explicit: !!r.explicit, text: !!r.text })),
      };
      link.publish(state, blocked);
    }

    // ------------------------------------------------------------------ UI
    const rim = h('div.dj-rim', { html: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="dj-rim-bg" cx="50" cy="50" r="48.6"/><circle class="dj-rim-fg" cx="50" cy="50" r="48.6" pathLength="100"/></svg>' });
    const now = h('div.dj-now');
    const listHead = h('div.dj-head');
    const list = h('div.dj-list.list');
    const reCurve = curve(list);
    const bar = h('div.dj-bar');
    const main = h('div.dj-page.dj-main', now, listHead, list, bar);
    const qrPage = h('div.dj-page.dj-qrpage');
    const fx = h('div.dj-fx');
    el.append(rim, main, qrPage, fx);

    function drawProgress() {
      const fg = rim.querySelector('.dj-rim-fg');
      const d = player.duration(), p = d ? Math.min(1, player.position() / d) : 0;
      fg.style.strokeDasharray = `${(p * 100).toFixed(2)} 100`;
      rim.classList.toggle('on', !!player.state.track);
    }

    function drawNow() {
      clear(now);
      const p = svc(), t = player.state.track, s = set();
      if (!p) {
        now.append(h('div.dj-pick', h('div.dj-pick-t', 'Choose the music'), h('div.dj-pick-m', 'Requests play on your music service.'),
          h('button.pill.primary', { type: 'button', onclick: () => pickService() }, 'Pick a service')));
        return;
      }
      const mine = nowReq && t && (nowReq.tk === trackKey(t) || performance.now() < expectUntil);
      const art = h(`div.dj-disc${player.state.isPlaying ? '.spinning' : ''}`, t?.art ? h('div.dj-disc-art', { style: { backgroundImage: `url("${t.art}")` } }) : h('div.dj-disc-art.ph', { html: icon('note') }));
      const need = s.skipNeed, votes = skipKey === trackKey(t) ? skipVoters.size : 0;
      now.append(art, h('div.dj-now-tx',
        h('div.dj-kick', mine ? h('span', 'Requested by ', h('b', { dir: 'auto' }, nowReq.by)) : t ? `Playing on ${p.name}` : p.name),
        h('div.dj-now-t', { dir: 'auto' }, t?.title || 'Nothing playing'),
        h('div.dj-now-a', { dir: 'auto' }, t ? t.artist || '' : 'Start your playlist — requests take over when a song ends'),
        t && need ? h('div.dj-skipv', { title: 'Skip votes' }, h('i', { html: icon('next') }), `${votes} / ${need}`) : null));
      now.onclick = () => openNowMenu();
    }

    function drawList() {
      clear(listHead); clear(list);
      const all = sorted();
      const waiting = all.filter((r) => r.pending).length;
      listHead.append(h('span.dj-head-t', 'Up next'), h('span.dj-head-n', all.length ? `${all.length} request${all.length === 1 ? '' : 's'}${waiting ? ` · ${waiting} to approve` : ''}` : ''));
      if (!all.length) {
        const st = link.status;
        list.append(h('div.dj-empty',
          st === 'ok' ? h('button.dj-empty-qr', { type: 'button', 'aria-label': 'Show the QR code', onclick: () => showPage('qr') }, qrSlot()) : h('div.dj-empty-ic', { html: icon('playlist') }),
          h('div.dj-empty-txt', h('div.dj-empty-t', st === 'ok' ? 'Scan to request a song' : 'No requests yet'),
            h('div.dj-empty-m', st === 'ok' ? h('span', 'Room ', h('b.dj-code', link.code), ' · the playlist keeps going until someone asks') : st === 'connecting' ? 'Looking for the bridge…' : 'Tap + to search on this screen and pass the remote around.'))));
        reCurve(); return;
      }
      all.forEach((r, i) => {
        const sc = score(r);
        const row = h(`div.dj-row${r.pending ? '.pending' : ''}${i === sel ? '.sel' : ''}`, { role: 'button', tabindex: '-1', dataset: { id: r.id }, onclick: () => openItem(r.id) },
          h('span.dj-rank', r.pending ? '?' : String(i + 1 - waiting)),
          h('div.dj-art', r.artD || r.art ? { style: { backgroundImage: `url("${r.artD || r.art}")` } } : { html: icon(r.text ? 'edit' : 'note') }),
          h('div.dj-row-tx', h('div.dj-row-t', { dir: 'auto' }, r.explicit ? h('span.dj-e', 'E') : null, r.title),
            h('div.dj-row-s', { dir: 'auto' }, [r.sub, r.by].filter(Boolean).join(' · '))),
          r.pending
            ? h('div.dj-appr', h('button.dj-ok', { type: 'button', 'aria-label': 'Approve', onclick: (e) => { e.stopPropagation(); approve(r.id, true); }, html: icon('check') }),
              h('button.dj-no', { type: 'button', 'aria-label': 'Decline', onclick: (e) => { e.stopPropagation(); approve(r.id, false); }, html: icon('close') }))
            : h('div.dj-votes',
              h('button.dj-up', { type: 'button', 'aria-label': 'Vote up', onclick: (e) => { e.stopPropagation(); r.hv = (r.hv || 0) + 1; app.sfx('tick'); saveQ(); } }, '▲'),
              h(`b${sc > 0 ? '.pos' : sc < 0 ? '.neg' : ''}`, String(sc)),
              h('button.dj-dn', { type: 'button', 'aria-label': 'Vote down', onclick: (e) => { e.stopPropagation(); r.hv = (r.hv || 0) - 1; app.sfx('tick'); saveQ(); } }, '▼')));
        list.append(row);
      });
      reCurve();
    }
    let qrCache = { code: null, url: null };
    function qrSlot() {
      const box = h('div.dj-qr-mini');
      if (qrCache.code === link.code && qrCache.url) box.append(qrBox(qrCache.url));
      else link.phoneUrl().then((r) => { if (r.url) { qrCache = { code: link.code, url: r.url }; box.append(qrBox(r.url)); } });
      return box;
    }

    function drawBar() {
      clear(bar);
      const n = Object.values(guests).filter((g) => Date.now() - g.last < 6 * 3600e3).length;
      const st = link.status;
      bar.append(
        h(`button.dj-btn.dj-phones.${st}`, { type: 'button', 'aria-label': 'Phones (QR code)', onclick: () => showPage('qr') }, h('i', { html: qrIcon() }), h('span', n ? `${n} guest${n === 1 ? '' : 's'}` : 'Phones')),
        h('button.dj-add', { type: 'button', 'aria-label': 'Add a song', onclick: () => addOnDisplay() }, h('i', { html: icon('plus') })),
        h('button.dj-btn', { type: 'button', 'aria-label': 'Play the next request now', onclick: () => { app.sfx('tap'); advance({ reason: 'manual' }); } }, h('i', { html: icon('next') }), h('span', 'Next')),
        h('button.dj-btn', { type: 'button', 'aria-label': 'Settings', onclick: () => openSettings() }, h('i', { html: icon('settings') }), h('span', 'Host')));
    }
    function render() { if (page === 'main') { drawList(); } drawBar(); }
    function flash(r) { requestAnimationFrame(() => list.querySelector(`[data-id="${r.id}"]`)?.classList.add('new')); }

    function approve(id, ok) {
      const r = queue.find((x) => x.id === id);
      if (!r) return;
      if (ok) { r.pending = false; app.sfx('coin'); } else { queue = queue.filter((x) => x !== r); app.sfx('drop'); if (r.byDevice !== 'display') tell(r.byDevice, `The host passed on “${r.title}”`); }
      saveQ();
      if (ok && set().auto && player.provider && !player.state.isPlaying && !player.state.track) advance({ reason: 'idle' });
    }

    // ------------------------------------------------------------------ QR page
    let qrTok = 0;
    async function drawQr() {
      const my = ++qrTok;
      clear(qrPage);
      qrPage.append(h('div.dj-qr-wait', h('div.spin'), h('div', 'Finding the bridge…')));
      const r = await link.phoneUrl();
      if (my !== qrTok || page !== 'qr') return;
      clear(qrPage);
      if (!r.url) {
        qrPage.append(h('div.dj-off', h('div.dj-off-ic', { html: qrIcon() }), h('div.dj-off-t', 'Phones can’t join yet'), h('div.dj-off-m', linkProblem(r.reason)),
          h('div.dj-off-b', h('button.pill', { type: 'button', onclick: () => { link.start(); drawQr(); } }, 'Try again'), h('button.pill.primary', { type: 'button', onclick: () => { showPage('main'); addOnDisplay(); } }, 'Add here'))));
        return;
      }
      qrCache = { code: link.code, url: r.url };
      const n = Object.values(guests).filter((g) => Date.now() - g.last < 6 * 3600e3).length;
      qrPage.append(h('div.dj-qr-h', 'Scan to request songs'), qrBox(r.url, 'dj-qr-big'),
        h('div.dj-qr-ses', 'Room ', h('b.dj-code', link.code), ` · ${n} guest${n === 1 ? '' : 's'}`),
        h('div.dj-qr-url', r.url.replace(/^https?:\/\//, '')));
    }
    function showPage(p) {
      page = p; el.dataset.page = p;
      app.setTitle(p === 'qr' ? 'Request from phones' : null);
      if (p === 'qr') drawQr(); else { qrTok++; drawList(); }
    }

    // ------------------------------------------------------------------ panels
    async function addOnDisplay() {
      const p = svc();
      if (!p) return pickService();
      const q = await app.editText({ title: canSearch() ? 'Search for a song' : 'Song to request', placeholder: 'Artist or song', okLabel: canSearch() ? 'Search' : 'Add' });
      if (!q) return;
      if (!canSearch()) { addRequest({ text: q, by: 'Host', byDevice: 'display' }); return; }
      app.openPanel({
        title: 'Request a song', className: 'dj-panel',
        build(body, panel) {
          const box = h('div.list'); body.append(box); curve(box);
          box.append(spinner('Searching…'));
          withTimeout(p.search(q), 9000).then((res) => {
            clear(box);
            const tracks = (res || []).filter((x) => (x.kind || 'track') === 'track').slice(0, 20);
            if (!tracks.length) box.append(h('div.empty', 'No songs found.'));
            for (const t of tracks) {
              box.append(listRow({ title: (isExplicit(t) ? '🅴 ' : '') + t.title, subtitle: t.subtitle, art: t.art, onClick: async () => {
                panel.close();
                const who = await app.editText({ title: 'Who’s asking? (optional)', placeholder: 'Name', okLabel: 'Request' });
                const err = addRequest({ item: { ...t, kind: 'track', id: String(t.id ?? '') }, by: (who || '').trim() || 'Host', byDevice: 'display' });
                if (err?.error) app.toast(err.error, { kind: 'error' }); else app.toast('Added to the queue');
              } }));
            }
            box.append(listRow({ title: `Request “${q}” as typed`, subtitle: 'Found when it’s its turn', mono: '✎', onClick: () => { panel.close(); addRequest({ text: q, by: 'Host', byDevice: 'display' }); } }));
          }).catch((e) => { clear(box); box.append(h('div.empty', e?.userMessage || e?.message || 'Search failed')); });
        },
      });
    }

    function openItem(id) {
      const r = queue.find((x) => x.id === id);
      if (!r) return;
      app.openPanel({
        title: r.pending ? 'Approve request?' : 'Request', className: 'dj-panel dj-item',
        build(body, panel) {
          const sc = score(r);
          const g = guests[r.byDevice];
          body.append(
            h('div.dj-item-art', r.artD || r.art ? { style: { backgroundImage: `url("${r.artD || r.art}")` } } : { html: icon('note') }),
            h('div.dj-item-t', { dir: 'auto' }, r.title),
            h('div.dj-item-s', { dir: 'auto' }, [r.sub, `by ${r.by}`, `${sc > 0 ? '+' : ''}${sc} vote${Math.abs(sc) === 1 ? '' : 's'}`].filter(Boolean).join(' · ')),
            h('div.dj-item-acts',
              r.pending ? h('button.pill.primary', { type: 'button', onclick: () => { panel.close(); approve(r.id, true); } }, 'Approve') : null,
              h('button.pill.primary', { type: 'button', onclick: () => { panel.close(); r.pending = false; advance({ reason: 'manual', first: r.id }); } }, 'Play now'),
              h('button.pill', { type: 'button', onclick: () => { const top = Math.max(0, ...queue.map(score)); r.hv = (r.hv || 0) + (top - sc) + 1; saveQ(); panel.close(); } }, 'Move to top'),
              h('button.pill.danger', { type: 'button', onclick: () => { queue = queue.filter((x) => x !== r); saveQ(); app.sfx('drop'); panel.close(); } }, 'Remove'),
              r.byDevice !== 'display' && g ? h('button.pill.danger', { type: 'button', onclick: () => { blockGuest(r.byDevice, true); panel.close(); } }, `Block ${r.by}`) : null));
        },
      });
    }

    function openNowMenu() {
      const p = svc();
      if (!p) return pickService();
      app.openPanel({
        title: 'Now playing', className: 'dj-panel',
        build(body, panel) {
          const box = h('div.list'); body.append(box);
          box.append(
            listRow({ title: player.state.isPlaying ? 'Pause' : 'Play', mono: player.state.isPlaying ? '❚❚' : '▶', onClick: () => { player.toggle(); panel.close(); } }),
            listRow({ title: 'Skip to the next request', subtitle: playable().length ? playable()[0].title : 'Queue is empty — next song in the playlist', mono: '⏭', onClick: () => { panel.close(); advance({ reason: 'manual' }); } }),
            listRow({ title: 'Played tonight', subtitle: history.length ? `${history.length} request${history.length === 1 ? '' : 's'}` : 'Nothing yet', mono: '☰', onClick: () => { panel.close(); openHistory(); } }),
            listRow({ title: 'Music service', subtitle: p.name, mono: '♫', onClick: () => { panel.close(); pickService(); } }));
        },
      });
    }
    function openHistory() {
      app.openPanel({
        title: 'Played tonight', className: 'dj-panel',
        build(body) {
          const box = h('div.list'); body.append(box); curve(box);
          if (!history.length) box.append(h('div.empty', 'No requests played yet.'));
          for (const x of history) box.append(listRow({ title: x.title, subtitle: [x.sub, `by ${x.by}`, new Date(x.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · '), mono: '♪' }));
          if (history.length) box.append(h('button.pill.small', { type: 'button', onclick: () => { history = []; app.save('history', history); openHistory(); } }, 'Clear'));
        },
      });
    }

    function pickService() {
      app.openPanel({
        title: 'Play requests on…', className: 'dj-panel',
        build(body, panel) {
          const box = h('div.list'); body.append(box); curve(box);
          const ok = SERVICES.filter((s) => inSection(s, 'music')).filter((s) => { const p = providerById(s.id); try { return p && !p.setupHint() && p.isAuthed(); } catch { return false; } });
          if (!ok.length) box.append(h('div.empty', 'No music service is set up yet.'));
          for (const s of ok) {
            const p = providerById(s.id);
            box.append(listRow({ title: s.name, subtitle: p.caps?.search ? (p === player.provider ? 'Playing now' : 'Search & play requests') : 'No search — typed requests only', mono: s.mono, color: s.color, active: p === player.provider,
              onClick: async () => { panel.close(); if (player.provider !== p) { app.store.set('lastService', s.id); await player.use(p); } drawNow(); publish(); } }));
          }
        },
      });
    }

    function blockGuest(dev, on) {
      blocked = on ? [...new Set([...blocked, dev])] : blocked.filter((d) => d !== dev);
      app.save('blocked', blocked);
      if (on) { queue = queue.filter((r) => r.byDevice !== dev); for (const r of queue) if (r.votes) delete r.votes[dev]; app.toast(`${guests[dev]?.name || 'Guest'} is blocked`); }
      saveQ();
    }

    function openSettings() {
      app.openPanel({
        title: 'Host controls', className: 'dj-panel dj-set-panel',
        build(body, panel) {
          const box = h('div.dj-set.list');
          body.append(box);
          const sw = (on, fn) => h(`button.switch${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(on), onclick: fn });
          const row = (label, sub, right) => { if (right?.classList?.contains('switch') && !right.hasAttribute('aria-label')) right.setAttribute('aria-label', label); return h('div.dj-set-row', h('div.dj-set-l', h('div', label), sub ? h('div.dj-set-sub', sub) : null), right); };
          const step = (val, fmt, fn, lo, hi) => h('div.dj-step', h('button.ibtn.small', { type: 'button', 'aria-label': 'Less', onclick: () => fn(Math.max(lo, val - 1)), html: icon('minus') }),
            h('b', fmt(val)), h('button.ibtn.small', { type: 'button', 'aria-label': 'More', onclick: () => fn(Math.min(hi, val + 1)), html: icon('plus') }));
          const put = (patch) => { app.save('settings', { ...app.data('settings', {}), ...patch }); draw(); publish(); render(); drawNow(); };
          const draw = () => {
            clear(box);
            const s = set();
            const gl = Object.entries(guests).sort((a, b) => b[1].last - a[1].last);
            box.append(
              row('Requests open', s.closed ? 'Phones can’t request right now' : 'Guests can request songs', sw(!s.closed, () => put({ closed: !s.closed }))),
              row('Approve requests', s.approve ? 'New requests wait for your ✓' : 'Requests go straight into the queue', sw(s.approve, () => put({ approve: !s.approve }))),
              row('Requests per guest', 'Waiting in the queue at once', step(s.maxPer || 0, (v) => (v ? String(v) : '∞'), (v) => put({ maxPer: v }), 0, 10)),
              row('Skip vote', s.skipNeed ? `${s.skipNeed} guests vote skip → skip` : 'Off', step(s.skipNeed || 0, (v) => (v ? String(v) : 'Off'), (v) => put({ skipNeed: v }), 0, 12)),
              row('No explicit songs', 'Where your service marks them', sw(s.noExplicit, () => put({ noExplicit: !s.noExplicit }))),
              row('Auto-play requests', s.auto ? 'The top request plays when a song ends' : 'Only when you tap Next', sw(s.auto, () => put({ auto: !s.auto }))),
              h('div.dj-set-h', `Guests (${gl.length})`),
              ...(gl.length ? gl.map(([dev, g]) => row(g.name || 'Guest', `${queue.filter((r) => r.byDevice === dev).length} in queue${blocked.includes(dev) ? ' · blocked' : ''}`,
                h(`button.pill.small${blocked.includes(dev) ? '' : '.danger'}`, { type: 'button', onclick: () => { blockGuest(dev, !blocked.includes(dev)); draw(); } }, blocked.includes(dev) ? 'Unblock' : 'Block')))
                : [h('div.dj-set-sub.dj-note', 'Guests appear here when they open the page on their phone.')]),
              h('div.dj-set-h', 'Party'),
              h('div.dj-set-btns',
                h('button.pill', { type: 'button', onclick: () => { queue = []; saveQ(); app.toast('Queue cleared'); draw(); } }, 'Clear queue'),
                h('button.pill', { type: 'button', onclick: () => { guests = {}; blocked = []; app.save('guests', guests); app.save('blocked', blocked); link.newRoom(); app.toast(`New room ${link.code}`); draw(); publish(); } }, 'New room')),
              h('div.dj-set-sub.dj-note', link.status === 'ok' ? `Room ${link.code} — phones connect through the bridge.` : linkProblem(link.reason)),
            );
          };
          draw();
        },
      });
    }

    // ------------------------------------------------------------------ knob / keys
    app.onKey((e) => {
      if (document.querySelector('.panel')) return;
      if (page !== 'main') return;
      const n = queue.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); if (n) { sel = Math.min(n - 1, sel + 1); drawList(); list.querySelector('.sel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); if (n) { sel = Math.max(0, sel - 1); drawList(); list.querySelector('.sel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const r = sorted()[sel]; if (r) openItem(r.id); else addOnDisplay(); }
      else if (e.key === '+' || e.key === 'a') addOnDisplay();
      else if (e.key === 'n') advance({ reason: 'manual' });
      else if (e.key === 'q') showPage('qr');
    });

    function qrIcon() { return '<svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M3 3h8v8H3zm2 2v4h4V5zM13 3h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zM13 13h3v3h-3zm5 0h3v3h-3zm-5 5h3v3h-3zm5 0h3v3h-3zM6 6h2v2H6zm10 0h2v2h-2zM6 16h2v2H6z"/></svg>'; }

    // start: use the last music service if nothing is playing yet
    if (!player.provider) {
      const last = app.store.get('lastService');
      const s = SERVICES.find((x) => x.id === last && inSection(x, 'music'));
      const p = s && providerById(s.id);
      try { if (p && !p.setupHint() && p.isAuthed()) player.use(p); } catch {}
    }
    if (nowReq && trackKey(player.state.track) !== nowReq.tk) { nowReq = null; app.save('nowReq', null); }
    showPage('main'); drawNow(); drawBar(); drawProgress();
    link.start(); publish();
    return {
      destroy() { link.stop(); for (const off of offs) off(); },
      back() { if (page !== 'main') { showPage('main'); return true; } return false; },
    };
  },
};
