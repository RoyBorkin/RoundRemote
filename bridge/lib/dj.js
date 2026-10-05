// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Party DJ (apps/djqueue.js): guests scan the QR code on the round display, search songs, request them and vote.
// The display is in charge: searches run on the display's music service (the bridge relays "search" from a phone
// to the display and the results back to that phone only), the queue / votes / skip votes live on the display and
// it publishes the queue here. Routes: see lib/party.js (GET /dj?r=<room>, /api/dj/…).
import { partyApp, phonePage, HttpErr, str } from './party.js';

const TYPES = new Set(['join', 'search', 'request', 'vote', 'skip', 'cancel']);

function accept(room, act) {
  if (!TYPES.has(act.type)) throw new HttpErr(400, 'unknown action');
  if (act.type === 'search') { act.q = str(act.q, 80); act.sid = str(act.sid, 20); if (!act.q) throw new HttpErr(400, 'Type something to search'); }
  if (act.type === 'request') {
    const it = act.item && typeof act.item === 'object' ? act.item : null;
    act.item = it ? { kind: str(it.kind, 12) || 'track', id: str(it.id, 200), uri: str(it.uri, 300), title: str(it.title, 140), subtitle: str(it.subtitle, 160),
      art: /^(https:|data:image\/)/.test(String(it.art || '')) ? String(it.art).slice(0, 12000) : '', explicit: !!it.explicit, albumUri: str(it.albumUri, 300) } : null;
    act.text = str(act.text, 120);
    if (!act.item?.title && !act.text) throw new HttpErr(400, 'Pick a song first');
    const st = room.state;
    if (st?.settings?.closed) throw new HttpErr(403, 'Requests are closed right now');
  }
  if (act.type === 'vote') { act.rid = str(act.rid, 40); act.v = Math.max(-1, Math.min(1, Math.round(+act.v || 0))); }
  if (act.type === 'cancel') act.rid = str(act.rid, 40);
  if (act.type === 'skip') act.tid = str(act.tid, 120);
  return {};
}

/** What one phone sees: its own votes and requests, never other phones' ids. */
function personalize(s, device) {
  if (!s) return null;
  const view = (r) => {
    const { votes, byDevice, ...rest } = r;
    return { ...rest, mine: byDevice === device, my: votes?.[device] || 0 };
  };
  const now = s.now ? (({ skipVoters, byDevice, ...n }) => ({ ...n, mySkip: (skipVoters || []).includes(device), mine: byDevice === device }))(s.now) : null;
  const queue = (s.queue || []).map(view);
  return { ...s, now, queue, myCount: queue.filter((r) => r.mine && !r.played).length, guests: undefined };
}

const I18N = {
  en: { title: 'Party DJ', nowPlaying: 'Now playing', nothing: 'Nothing playing yet', reqBy: 'requested by {n}', skip: 'Vote to skip', skipped: 'You voted to skip',
    skipN: '{n} of {m}', search: 'Search for a song', go: 'Search', searching: 'Searching…', noResults: 'No songs found — request it as typed below',
    asTyped: 'Request “{q}”', asTypedSub: 'The DJ finds it when it’s its turn', request: 'Request', requested: 'In the queue', explicit: 'Explicit songs are off tonight',
    queue: 'Up next', empty: 'The queue is empty — request the first song!', left: '{n} of {m} requests left', none: 'You’ve used all your requests — wait for one to play',
    pending: 'waiting for the host', sent: 'Requested! ✓', sentPending: 'Sent — the host approves requests', you: 'you', cancel: 'Remove my request?',
    noSearch: 'This music service can’t search — type “artist – song”', closed: 'Requests are closed right now', hostOff: 'The display is offline — your request will wait',
    votes: '{n} votes', playingYours: 'Your song is playing! 🎉' },
  he: { title: 'די־ג׳יי מסיבה', nowPlaying: 'מתנגן עכשיו', nothing: 'עוד לא מתנגן כלום', reqBy: 'ביקש/ה: {n}', skip: 'הצבעה לדלג', skipped: 'הצבעת לדלג',
    skipN: '{n} מתוך {m}', search: 'חיפוש שיר', go: 'חיפוש', searching: 'מחפש…', noResults: 'לא נמצאו שירים — אפשר לבקש כפי שנכתב',
    asTyped: 'לבקש ״{q}״', asTypedSub: 'הדי־ג׳יי ימצא אותו כשיגיע תורו', request: 'בקשה', requested: 'בתור', explicit: 'שירים בוטים כבויים הערב',
    queue: 'הבאים בתור', empty: 'התור ריק — בקשו את השיר הראשון!', left: 'נשארו {n} מתוך {m} בקשות', none: 'ניצלת את כל הבקשות — חכו שאחת תתנגן',
    pending: 'ממתין לאישור', sent: 'נשלח! ✓', sentPending: 'נשלח — המארח מאשר בקשות', you: 'את/ה', cancel: 'להסיר את הבקשה?',
    noSearch: 'שירות המוזיקה לא תומך בחיפוש — כתבו ״אמן – שיר״', closed: 'הבקשות סגורות כרגע', hostOff: 'המסך לא מחובר — הבקשה תחכה',
    votes: '{n} קולות', playingYours: 'השיר שלך מתנגן! 🎉' },
};

const CSS = `
.np{display:flex;gap:14px;align-items:center;position:relative;overflow:hidden}
.np .art{width:76px;height:76px;border-radius:14px;background:var(--card2) center/cover;flex:none;display:grid;place-items:center;font-size:30px;color:var(--dim)}
.np .tx{min-width:0;flex:1}
.np .k{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c)}
.np .t{font-size:18px;font-weight:800;line-height:1.2;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np .a{color:var(--muted);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np .by{color:var(--dim);font-size:12px;margin-top:2px}
.bar{height:5px;border-radius:9px;background:var(--card2);margin-top:12px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--c);border-radius:9px;transition:width .5s linear}
.skip{display:flex;align-items:center;gap:10px;margin-top:12px}
.skip button{flex:1;padding:11px;border-radius:99px;background:var(--card2);font-weight:800;font-size:15px}
.skip button.on{background:color-mix(in srgb,var(--err) 22%,var(--card2));color:var(--err)}
.skip .n{font-size:13px;color:var(--muted);font-weight:700;white-space:nowrap}
.srch{display:flex;gap:8px}.srch .in{flex:1}.srch button{flex:none;padding:0 18px;border-radius:14px;background:var(--c);color:var(--on-c);font-weight:800}
.left{font-size:13px;color:var(--muted);margin-top:10px;font-weight:600}
.res{margin-top:10px}
.it{display:flex;gap:12px;align-items:center;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:16px;margin-bottom:8px}
.it .art{width:48px;height:48px;border-radius:10px;background:var(--card2) center/cover;flex:none;display:grid;place-items:center;color:var(--dim);font-weight:800}
.it .tx{flex:1;min-width:0}.it .t{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.it .s{font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.it .add{flex:none;padding:9px 14px;border-radius:99px;background:var(--c);color:var(--on-c);font-weight:800;font-size:14px}
.it .add:disabled{background:var(--card2);color:var(--muted)}
.e{display:inline-block;font-size:10px;font-weight:900;padding:1px 5px;border-radius:4px;background:var(--dim);color:var(--bg);margin-inline-end:5px;vertical-align:1px}
.typed{border-style:dashed}.typed .t,.typed .s{white-space:normal}
h2{font-size:16px;margin:22px 4px 10px;display:flex;align-items:center;gap:8px}h2 .cnt{color:var(--dim);font-weight:700;font-size:14px}
.q .rank{flex:none;width:22px;text-align:center;font-weight:800;color:var(--dim);font-size:15px}
.q.mine{border-color:color-mix(in srgb,var(--c) 55%,transparent);background:color-mix(in srgb,var(--c) 8%,var(--card))}
.vote{display:flex;flex-direction:column;align-items:center;flex:none;gap:0}
.vote button{width:40px;height:30px;border-radius:10px;color:var(--muted);font-size:17px;line-height:1}
.vote button.on.up{color:var(--ok);background:color-mix(in srgb,var(--ok) 16%,transparent)}.vote button.on.dn{color:var(--err);background:color-mix(in srgb,var(--err) 16%,transparent)}
.vote b{font-size:14px;min-width:24px;text-align:center}
.chip{display:inline-block;font-size:11px;font-weight:800;padding:2px 7px;border-radius:99px;background:color-mix(in srgb,var(--warn) 22%,transparent);color:var(--warn);margin-inline-start:6px}
.x{flex:none;width:30px;height:30px;border-radius:50%;color:var(--dim);font-size:16px}
.yours{margin-top:10px;padding:9px 12px;border-radius:12px;background:color-mix(in srgb,var(--c) 18%,transparent);font-weight:800;text-align:center}
`;

const BODY = `
<div class="hi"><span data-t="hi"></span> <b id="who" dir="auto"></b><button id="rename" data-t="change"></button></div>
<section class="card" id="npCard"></section>
<section class="card">
  <div class="srch"><input class="in" id="q" dir="auto" maxlength="80" data-tp="search" enterkeyhint="search" autocomplete="off"><button id="go" data-t="go"></button></div>
  <div class="left" id="left"></div>
  <div class="res" id="res"></div>
</section>
<h2><span data-t="queue"></span> <span class="cnt" id="qn"></span></h2>
<div id="queue"></div>
`;

function script() {
  const { $, t, el } = P;
  let results = null, searching = null, sid = 0, lastQ = '', sentKeys = new Set();
  const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const art = (url, fallback) => { const a = el('div', { class: 'art' }); if (url) a.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")'; else a.textContent = fallback || '♪'; return a; };
  const keyOf = (it) => (it.id || '') + '|' + (it.title || '').toLowerCase();
  let gotAt = Date.now();

  function drawNow() {
    const v = P.view, card = $('#npCard'); card.textContent = '';
    const n = v && v.now;
    if (!n || !n.title) { card.append(el('div', { class: 'np' }, art('', '♪'), el('div', { class: 'tx' }, el('div', { class: 'k', text: t('nowPlaying') }), el('div', { class: 'a', text: t('nothing') })))); return; }
    card.append(el('div', { class: 'np' }, art(n.art), el('div', { class: 'tx' },
      el('div', { class: 'k', text: t('nowPlaying') }), el('div', { class: 't', dir: 'auto', text: n.title }), el('div', { class: 'a', dir: 'auto', text: n.artist || '' }),
      n.by ? el('div', { class: 'by', dir: 'auto', text: t('reqBy', { n: n.mine ? t('you') : n.by }) }) : null)));
    if (n.dur) { const b = el('div', { class: 'bar' }, el('i', { id: 'pbar' })); card.append(b); tick(); }
    if (n.mine) card.append(el('div', { class: 'yours', text: t('playingYours') }));
    if (v.settings && v.settings.skipNeed > 0) {
      const btn = el('button', { class: n.mySkip ? 'on' : '', text: n.mySkip ? t('skipped') : t('skip'), onclick: async () => {
        try { await P.act('skip', { tid: n.key || n.title, v: n.mySkip ? 0 : 1 }); P.vibrate(15); } catch (e) { P.toast(e.message, true); }
      } });
      card.append(el('div', { class: 'skip' }, btn, el('span', { class: 'n', text: '⏭ ' + t('skipN', { n: n.skips || 0, m: v.settings.skipNeed }) })));
    }
  }
  function tick() {
    const n = P.view && P.view.now, b = document.getElementById('pbar');
    if (!n || !b || !n.dur) return;
    const pos = (n.pos || 0) + (n.playing ? Date.now() - gotAt : 0);
    b.style.width = Math.min(100, pos / n.dur * 100).toFixed(1) + '%';
  }
  setInterval(tick, 500);

  function drawLeft() {
    const v = P.view, s = v && v.settings;
    if (!s) { $('#left').textContent = ''; return; }
    const m = s.maxPer || 0;
    $('#left').textContent = s.closed ? t('closed') : m ? (m - (v.myCount || 0) > 0 ? t('left', { n: m - (v.myCount || 0), m }) : t('none')) : '';
  }
  function canRequest() { const v = P.view, s = v && v.settings; return !s || (!s.closed && (!s.maxPer || (v.myCount || 0) < s.maxPer)); }
  function inQueue(it) { const v = P.view; return sentKeys.has(keyOf(it)) || !!(v && (v.queue || []).some((r) => r.key === keyOf(it))); }

  function drawResults() {
    const box = $('#res'); box.textContent = '';
    if (searching) { box.append(el('div', { class: 'empty' }, el('span', { class: 'spin' }), ' ', t('searching'))); return; }
    if (!results) return;
    const ex = P.view && P.view.settings && P.view.settings.noExplicit;
    if (results.nosearch) box.append(el('div', { class: 'empty', text: t('noSearch') }));
    else if (!results.items.length) box.append(el('div', { class: 'empty', text: t('noResults') }));
    for (const it of results.items) {
      const blocked = ex && it.explicit;
      const done = inQueue(it);
      box.append(el('div', { class: 'it' }, art(it.art), el('div', { class: 'tx' }, el('div', { class: 't', dir: 'auto' }, it.explicit ? el('span', { class: 'e', text: 'E' }) : null, it.title), el('div', { class: 's', dir: 'auto', text: blocked ? t('explicit') : (it.subtitle || '') })),
        el('button', { class: 'add', disabled: blocked || done || !canRequest(), text: done ? t('requested') : t('request'), onclick: () => send({ item: it }) })));
    }
    if (results.q) box.append(el('div', { class: 'it typed' }, art('', '✎'), el('div', { class: 'tx' }, el('div', { class: 't', dir: 'auto', text: t('asTyped', { q: results.q }) }), el('div', { class: 's', text: t('asTypedSub') })),
      el('button', { class: 'add', disabled: !canRequest() || sentKeys.has('|' + results.q.toLowerCase()), text: t('request'), onclick: () => send({ text: results.q }) })));
  }
  async function send(data) {
    try {
      const d = await P.act('request', data);
      sentKeys.add(data.item ? keyOf(data.item) : '|' + data.text.toLowerCase());
      P.toast(!d.hostOnline ? t('hostOff') : P.view && P.view.settings && P.view.settings.approve ? t('sentPending') : t('sent'));
      P.vibrate(20); P.beep(988, 0.08); drawResults();
    } catch (e) { P.toast(e.message, true); }
  }
  async function search() {
    const q = $('#q').value.trim(); if (!q) return;
    $('#q').blur();
    lastQ = q; const my = String(++sid);
    searching = my; results = null; drawResults();
    try {
      const d = await P.act('search', { q, sid: my });
      if (!d.hostOnline || (P.view && P.view.settings && P.view.settings.canSearch === false)) { if (searching === my) { searching = null; results = { q, items: [], nosearch: P.view && P.view.settings && P.view.settings.canSearch === false }; drawResults(); } return; }
    } catch (e) { searching = null; P.toast(e.message, true); drawResults(); return; }
    setTimeout(() => { if (searching === my) { searching = null; results = { q, items: [] }; drawResults(); } }, 9000);
  }
  P.on('reply', (d) => {
    if (!d || d.type !== 'search' || d.sid !== String(sid)) return;
    searching = null; results = { q: lastQ, items: d.results || [], nosearch: !!d.nosearch }; drawResults();
  });

  function drawQueue() {
    const v = P.view, box = $('#queue'); box.textContent = '';
    const list = (v && v.queue || []).filter((r) => !r.played);
    $('#qn').textContent = list.length ? String(list.length) : '';
    if (!list.length) { box.append(el('div', { class: 'empty', text: t('empty') })); return; }
    list.forEach((r, i) => {
      const vote = (val) => async () => { try { await P.act('vote', { rid: r.id, v: r.my === val ? 0 : val }); P.vibrate(10); } catch (e) { P.toast(e.message, true); } };
      box.append(el('div', { class: 'it q' + (r.mine ? ' mine' : '') },
        el('span', { class: 'rank', text: String(i + 1) }), art(r.art, r.text ? '✎' : '♪'),
        el('div', { class: 'tx' }, el('div', { class: 't', dir: 'auto' }, r.explicit ? el('span', { class: 'e', text: 'E' }) : null, r.title),
          el('div', { class: 's', dir: 'auto' }, (r.sub ? r.sub + ' · ' : '') + (r.mine ? t('you') : r.by || ''), r.pending ? el('span', { class: 'chip', text: t('pending') }) : null)),
        r.mine ? el('button', { class: 'x', 'aria-label': 'remove', text: '✕', onclick: async () => { if (!confirm(t('cancel'))) return; try { await P.act('cancel', { rid: r.id }); } catch (e) { P.toast(e.message, true); } } }) : null,
        el('div', { class: 'vote' }, el('button', { class: 'up' + (r.my > 0 ? ' on' : ''), 'aria-label': 'up', text: '▲', onclick: vote(1) }), el('b', { text: String(r.score || 0) }),
          el('button', { class: 'dn' + (r.my < 0 ? ' on' : ''), 'aria-label': 'down', text: '▼', onclick: vote(-1) }))));
    });
  }
  P.on('reply', (d) => { if (d && d.type === 'toast' && d.msg) P.toast(d.msg, true); });
  P.on('state', () => { gotAt = Date.now(); drawNow(); drawLeft(); drawQueue(); if (results) drawResults(); });
  P.on('render', () => { drawNow(); drawLeft(); drawQueue(); drawResults(); });
  $('#go').onclick = search;
  $('#q').onkeydown = (e) => { if (e.key === 'Enter') search(); };
}

const PAGE = phonePage({ app: 'dj', title: 'Party DJ', color: '#a855f7', glyph: '♫', css: CSS, body: BODY, i18n: I18N, script });
export const route = partyApp({ name: 'dj', page: PAGE, personalize, accept });
