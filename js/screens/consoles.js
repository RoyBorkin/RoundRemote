// Home → PlayStation / Steam: a round "console" screen.
//   • Now     — the game being played, large in the middle over its blurred art, status ring + trophy /
//               achievement progress arc around the rim, console power (PS) or Big Picture / launch (Steam)
//   • Recent  — recently played games with play time (Steam: start one on the bridge computer)
//   • Trophies / Achievements — level, counts, the current game's progress, latest unlocks and what's next
//   • Friends — who's online and what they play
// Swipe sideways, use ← → (or the knob / wheel), or tap the dots at the bottom to change page.
import { h, iconBtn, onCircle, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast, curve, spinner, topPanel } from '../ui/overlay.js';
import { go } from '../core/router.js';
import { store } from '../core/store.js';
import { getService, provider } from '../providers/registry.js';
import { bridgeBase } from '../providers/bridge.js';

const TROPHY_D = 'M7 3h10v2h3.5v3.2A4.3 4.3 0 0 1 16.4 12.5a5.2 5.2 0 0 1-3.4 2.9V18h3v3H8v-3h3v-2.6a5.2 5.2 0 0 1-3.4-2.9A4.3 4.3 0 0 1 3.5 8.2V5H7V3zm0 4H5.5v1.2A2.3 2.3 0 0 0 7 10.4V7zm10 0v3.4a2.3 2.3 0 0 0 1.5-2.2V7H17z';
const trophyIc = (cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${TROPHY_D}"/></svg>`;
const TYPES = ['platinum', 'gold', 'silver', 'bronze'];
const errMsg = (e) => e?.body?.error || e?.userMessage || e?.message || 'Something went wrong';

// ---------------------------------------------------------------- formatting
export function ago(t) {
  if (!t) return '';
  const ms = Date.now() - new Date(t).getTime();
  if (!Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  const d = Math.round(hr / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', ...(d > 300 ? { year: 'numeric' } : {}) });
}
export const hoursText = (min) => (!min ? '' : min < 60 ? `${Math.round(min)} min` : `${Math.round(min / 60).toLocaleString()} h`);
const num = (n) => (n ?? 0).toLocaleString();

// ---------------------------------------------------------------- one view model for both services
const STEAM_STATE = { online: 'Online', busy: 'Busy', away: 'Away', snooze: 'Snooze', trade: 'Looking to trade', play: 'Looking to play', offline: 'Offline' };
function psnModel(d) {
  const p = d.profile || {}, pr = d.presence || {}, g = d.game;
  const now = d.now ? { key: d.now.titleId, name: d.now.name, art: d.now.art, shape: 'square', bg: d.now.hero || d.now.art,
    sub: [`Playing on ${d.now.platform || pr.platform || 'PlayStation'}`, hoursText(d.now.playtimeMin) && `${hoursText(d.now.playtimeMin)} played`].filter(Boolean).join(' · ') } : null;
  const last = d.recent?.[0];
  return {
    me: { name: p.onlineId || 'PlayStation', avatar: p.avatar, plus: p.isPlus,
      key: now ? 'ingame' : pr.online ? 'online' : 'offline',
      text: now ? `In game · ${pr.platform || ''}`.replace(/ · $/, '') : pr.online ? `Online${pr.platform ? ` · ${pr.platform}` : ''}` : `Offline${pr.lastOnline ? ` · ${ago(pr.lastOnline)}` : ''}` },
    now, idleBg: last?.hero || last?.art || '',
    progress: g ? { pct: g.progress, name: g.name, current: g.current } : null,
    awards: d.trophies || g ? { kind: 'trophies', level: d.trophies?.level, tierPct: d.trophies?.progress, tier: d.trophies?.tier, counts: d.trophies?.counts,
      game: g ? { name: g.name, icon: g.icon, pct: g.progress, current: g.current, earned: g.earned, defined: g.defined,
        recent: g.recent.map((t) => ({ name: t.name, desc: t.detail, icon: t.icon, type: t.type, at: t.earnedAt, rate: t.rate })),
        next: g.next.map((t) => ({ name: t.name, desc: t.detail, icon: t.icon, type: t.type, rate: t.rate })) } : null } : null,
    recent: (d.recent || []).map((r) => ({ key: r.titleId, name: r.name, art: r.art, shape: 'square', playing: now && (r.titleId === d.now.titleId || r.name === d.now.name),
      sub: [r.platform, hoursText(r.playtimeMin), ago(r.lastPlayed)].filter(Boolean).join(' · ') })),
    friends: d.friends ? { total: d.friends.total, online: d.friends.online.map((f) => ({ name: f.onlineId, avatar: f.avatar, key: f.game ? 'ingame' : 'online',
      sub: f.game ? f.game.name : `Online${f.platform ? ` · ${f.platform}` : ''}`, art: f.game?.icon || '', shape: 'square' })) } : null,
    errors: d.errors || {},
  };
}
function steamModel(d) {
  const p = d.profile || {}, a = d.achievements;
  const now = d.now ? { key: d.now.appid, appid: d.now.appid, name: d.now.name, art: d.now.header, shape: 'wide', bg: d.now.hero, bg2: d.now.header,
    sub: ['In game', d.now.hours && `${d.now.hours.toLocaleString()} h`, d.now.hours2w && `${d.now.hours2w} h past 2 weeks`].filter(Boolean).join(' · ') } : null;
  const last = d.recent?.[0];
  return {
    me: { name: p.name || 'Steam', avatar: p.avatar, level: p.level,
      key: now ? 'ingame' : ['away', 'snooze'].includes(p.state) ? 'away' : p.state === 'busy' ? 'busy' : p.state === 'offline' ? 'offline' : 'online',
      text: now ? 'In game' : `${STEAM_STATE[p.state] || 'Online'}${p.state === 'offline' && p.lastOnline ? ` · ${ago(p.lastOnline)}` : ''}`,
      private: p.public === false },
    now, idleBg: last?.hero || '', idleBg2: last?.header || '',
    progress: a ? { pct: a.percent, name: a.name, current: a.current } : null,
    awards: { kind: 'achievements', level: p.level,
      game: a ? { name: a.name, pct: a.percent, current: a.current, unlocked: a.unlocked, total: a.total,
        recent: a.recent.map((x) => ({ name: x.name, desc: x.desc, icon: x.icon, at: x.at, rate: x.rate })),
        next: a.next.map((x) => ({ name: x.name, desc: x.desc, icon: x.icon, rate: x.rate })) } : null },
    recent: (d.recent || []).map((r) => ({ key: r.appid, appid: r.appid, name: r.name, art: r.header, shape: 'wide', playing: now && r.appid === now.appid,
      sub: [`${r.hours.toLocaleString()} h`, r.hours2w ? `${r.hours2w} h past 2 weeks` : ''].filter(Boolean).join(' · ') })),
    friends: d.friends ? { total: d.friends.total, private: d.friends.private, online: d.friends.online.map((f) => ({ name: f.name, avatar: f.avatar,
      key: f.game ? 'ingame' : ['away', 'snooze'].includes(f.state) ? 'away' : f.state === 'busy' ? 'busy' : 'online',
      sub: f.game ? f.game.name : STEAM_STATE[f.state] || 'Online', art: f.game?.header || '', shape: 'wide' })) } : null,
    control: !!d.control,
    errors: d.errors || {},
  };
}

/** Background image that falls back to a second URL when the first doesn't load (Steam's library hero art). */
function setBg(el, url, fallback = '') {
  const want = url || fallback;
  if (el._want === want) return;
  el._want = want;
  if (!want) { el.style.backgroundImage = ''; el.classList.remove('in'); return; }
  const im = new Image();
  im.onload = () => { if (el._want !== want) return; el.style.backgroundImage = `url("${im.src}")`; el.classList.add('in'); };
  im.onerror = () => { if (el._want !== want) return; if (fallback && im.src !== fallback && url) { im.src = fallback; } else { el.style.backgroundImage = ''; el.classList.remove('in'); } };
  im.src = url || fallback;
}

// ---------------------------------------------------------------- the screen
export function ConsolesScreen({ id }) {
  const svc = getService(id);
  const p = provider(id);
  const steam = id === 'steam';
  const PAGES = [['now', 'gamepad', 'Now playing'], ['recent', 'clock', 'Recently played'], ['awards', 'trophy', steam ? 'Achievements' : 'Trophies'], ['friends', 'people', 'Friends']];
  let page = Math.max(0, PAGES.findIndex((x) => x[0] === store.get(`cs.${id}.page`)));

  const bg = h('div.cs-bg'), scrim = h('div.cs-scrim');
  // rim: presence ring (outer) + progress arc of the current game (inner)
  const rim = h('div.cs-rim', { html: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <circle class="cs-status" cx="50" cy="50" r="49.1"/>
    <circle class="cs-track" cx="50" cy="50" r="47" pathLength="100"/>
    <circle class="cs-arc" cx="50" cy="50" r="47" pathLength="100"/>
    <circle class="cs-knob" cx="50" cy="3" r="1.25"/></svg>` });
  const arcLabel = h('div.cs-arclabel');
  const homeBtn = onCircle(iconBtn('home', 'Home menu', () => go('home')), -42, 38.5);
  const setupBtn = onCircle(iconBtn('settings', `${svc.name} setup`, () => go('connect', { id })), 42, 38.5);
  const pagesEl = h('div.cs-pages');
  const pageEls = PAGES.map(([k]) => h(`div.cs-page.cs-${k}`, { dataset: { k } }));
  pagesEl.append(...pageEls);
  const nav = h('div.cs-nav', PAGES.map(([k, ic, label], i) => h('button.cs-dot', { type: 'button', 'aria-label': label, title: label, dataset: { k },
    html: ic === 'trophy' ? trophyIc() : icon(ic), onclick: (e) => { e.stopPropagation(); setPage(i); } })));
  const el = h('div.cs', { '--c': svc.color, dataset: { svc: id } }, bg, scrim, rim, arcLabel, pagesEl, homeBtn, setupBtn, nav);

  let model = null, lastKey = '';
  const lists = [];   // curved lists to refresh

  function setPage(i, { quiet = false } = {}) {
    page = (i + PAGES.length) % PAGES.length;
    store.set(`cs.${id}.page`, PAGES[page][0]);
    pageEls.forEach((pe, k) => { pe.classList.toggle('on', k === page); pe.classList.toggle('left', k < page); pe.classList.toggle('right', k > page); pe.setAttribute('aria-hidden', k === page ? 'false' : 'true'); });
    nav.querySelectorAll('.cs-dot').forEach((b, k) => b.classList.toggle('on', k === page));
    el.dataset.page = PAGES[page][0];
    if (!quiet) lists.forEach((f) => f());
  }

  // ---------- pieces
  const avatar = (url, name, cls = '') => h(`div.cs-ava${cls ? '.' + cls : ''}`, url ? { style: { backgroundImage: `url("${url}")` } } : null, url ? null : (name || '?').slice(0, 1).toUpperCase());
  const statusChip = (m) => h('div.cs-me', avatar(m.me.avatar, m.me.name, 'sm'),
    h('div.cs-me-text', h('b', m.me.name), h('span', h('i.cs-sdot', { dataset: { s: m.me.key } }), m.me.text)));
  const art = (url, shape, name, cls = '') => {
    const a = h(`div.cs-art.${shape}${cls ? '.' + cls : ''}`, h('span.cs-art-ph', (name || '').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2)));
    if (url) { const im = new Image(); im.onload = () => { a.style.backgroundImage = `url("${url}")`; a.classList.add('loaded'); }; im.src = url; }
    return a;
  };
  const row = ({ art: a, shape, title, sub, right, cls = '', round = false, onClick }) => h(`${onClick ? 'button' : 'div'}.cs-row${cls ? '.' + cls.trim().split(/\s+/).join('.') : ''}`, onClick ? { type: 'button', onclick: onClick } : null,
    round ? a : art(a, shape || 'square', title, 'thumb'), h('div.cs-row-text', h('div.cs-row-title', title), sub ? h('div.cs-row-sub', sub) : null), right);
  const list = (items) => { const l = h('div.cs-list', items); lists.push(curve(l)); return l; };
  const note = (msg, action) => h('div.cs-note', h('div', msg), action ? h('button.pill.small', { type: 'button', onclick: (e) => { e.stopPropagation(); action.onClick(); } }, action.label) : null);
  const head = (title, sub) => h('div.cs-head', h('div.cs-title', title), sub ? h('div.cs-sub', sub) : null);
  const typeDot = (t) => h('i.cs-tt', { dataset: { t }, html: trophyIc() });

  // ---------- Now
  function renderNow(m) {
    const pe = pageEls[0];
    clear(pe);
    pe.append(statusChip(m));
    if (m.now) {
      pe.append(h('div.cs-hero', art(m.now.art, m.now.shape, m.now.name, 'big')),
        h('div.cs-game', m.now.name), h('div.cs-gsub', m.now.sub));
    } else {
      pe.append(h('div.cs-hero.idle', avatar(m.me.avatar, m.me.name, 'xl'), h('i.cs-sring', { dataset: { s: m.me.key } })),
        h('div.cs-game', m.me.key === 'offline' ? 'Offline' : 'Not in a game'), h('div.cs-gsub', m.me.text));
    }
    // progress of this game (or the last one)
    const g = m.awards?.game;
    if (g) {
      const strip = h('div.cs-strip');
      if (m.awards.kind === 'trophies') {
        for (const t of TYPES) if (g.defined?.[t]) strip.append(h('span.cs-tcount', typeDot(t), `${g.earned?.[t] || 0}/${g.defined[t]}`));
      } else strip.append(h('span.cs-tcount', h('i.cs-tt', { html: trophyIc() }), `${g.unlocked}/${g.total}`));
      strip.append(h('span.cs-pct', `${Math.round(g.pct)}%`));
      if (!g.current) strip.prepend(h('span.cs-last', 'Last'));
      pe.append(strip);
    }
    pe.append(actions(m));
  }
  function actions(m) {
    const box = h('div.cs-actions');
    if (!steam) {
      const pw = p.power;
      if (pw) {
        const on = pw.state === 'awake';
        const b = h(`button.pill.small.cs-power${on ? '' : '.primary'}`, { type: 'button', html: `${icon('power')}<span>${on ? 'Standby' : pw.state === 'standby' ? 'Turn on' : 'Wake'}</span>`,
          title: pw.via === 'ha' ? `Through Home Assistant · ${pw.name}` : 'Through playactor on the bridge',
          onclick: async (e) => {
            e.stopPropagation(); b.disabled = true; b.classList.add('busy');
            try { await p.setPower(on ? 'standby' : 'wake'); toast(on ? 'Putting the console in rest mode…' : 'Waking the console…'); }
            catch (er) { toast(errMsg(er), { kind: 'error', ms: 4000 }); }
            b.disabled = false; b.classList.remove('busy');
          } });
        box.append(b, h('span.cs-pstate', { dataset: { s: pw.state } }, pw.state === 'awake' ? 'Console on' : pw.state === 'standby' ? 'Rest mode' : pw.state === 'unreachable' ? 'Not found' : ''));
      }
    } else if (m.control) {
      const launch = !m.now && m.recent[0];
      if (launch) box.append(h('button.pill.small.primary', { type: 'button', html: `${icon('play')}<span>${launch.name}</span>`, onclick: (e) => { e.stopPropagation(); start(launch); } }));
      box.append(h('button.pill.small', { type: 'button', html: `${icon('tv')}<span>Big Picture</span>`, onclick: async (e) => {
        e.stopPropagation();
        try { await p.bigPicture(); toast('Opening Big Picture on the bridge computer'); } catch (er) { toast(errMsg(er), { kind: 'error', ms: 4000 }); }
      } }));
    }
    return box;
  }
  async function start(g) {
    try { await p.launch(g.appid); toast(`Starting ${g.name} on the bridge computer`); } catch (er) { toast(errMsg(er), { kind: 'error', ms: 4000 }); }
  }

  // ---------- Recent
  function renderRecent(m) {
    const pe = pageEls[1];
    clear(pe);
    pe.append(head('Recently played', m.recent.length ? `${m.recent.length} games` : ''));
    if (!m.recent.length) { pe.append(note(m.errors.recent || (steam && m.me.private ? 'Your game details are private on Steam' : 'Nothing played recently'))); return; }
    pe.append(list(m.recent.map((r) => row({ art: r.art, shape: r.shape, title: r.name, sub: r.playing ? `Playing now · ${r.sub}` : r.sub, cls: r.playing ? 'playing' : '',
      right: steam && m.control ? h('button.ibtn.small.cs-go', { type: 'button', 'aria-label': `Start ${r.name}`, html: icon('play'), onclick: (e) => { e.stopPropagation(); start(r); } }) : null }))));
  }

  // ---------- Trophies / achievements
  function renderAwards(m) {
    const pe = pageEls[2];
    clear(pe);
    const a = m.awards, g = a?.game;
    const scroll = h('div.cs-list.cs-awardlist');
    pe.append(head(steam ? 'Achievements' : 'Trophies', g ? `${g.current ? 'Now' : 'Last'}: ${g.name}` : ''), scroll);
    if (a?.kind === 'trophies' && a.level != null) {
      scroll.append(h('div.cs-level', { '--p': `${a.tierPct || 0}` },
        h('div.cs-lvl-ring', h('div.cs-lvl-num', num(a.level)), h('div.cs-lvl-cap', `Level · ${a.tierPct || 0}%`))),
      h('div.cs-counts', TYPES.map((t) => h('div.cs-count', typeDot(t), h('b', num(a.counts?.[t])), h('span', t)))));
    } else if (a?.kind === 'achievements' && g) {
      scroll.append(h('div.cs-level', { '--p': `${g.pct}` },
        h('div.cs-lvl-ring', h('div.cs-lvl-num', `${Math.round(g.pct)}%`), h('div.cs-lvl-cap', `${g.unlocked} of ${g.total}`))),
      a.level != null ? h('div.cs-counts', h('div.cs-count.steam-lvl', h('i.cs-lvlbadge', String(a.level)), h('span', 'Steam level'))) : null);
    }
    if (!g) { scroll.append(note(m.errors.game || m.errors.achievements || (steam ? 'No achievements for this game' : 'No trophies yet'))); return; }
    if (a.kind === 'trophies') scroll.append(h('div.cs-gprog', h('span', g.name), h('div.cs-bar', { '--p': `${g.pct}%` }), h('b', `${g.pct}%`)));
    if (g.recent.length) {
      scroll.append(h('div.cs-sec', 'Latest'));
      for (const t of g.recent) scroll.append(row({ art: t.icon, title: t.name, sub: [t.desc, ago(t.at), t.rate != null ? `${t.rate}% of players` : ''].filter(Boolean).join(' · '),
        right: t.type ? typeDot(t.type) : null, cls: 'award' }));
    }
    if (g.next.length) {
      scroll.append(h('div.cs-sec', 'Up next'));
      for (const t of g.next) scroll.append(row({ art: t.icon, title: t.name, sub: [t.desc, t.rate != null ? `${t.rate}% have it` : ''].filter(Boolean).join(' · '),
        right: t.type ? typeDot(t.type) : null, cls: 'award locked' }));
    }
    lists.push(curve(scroll));
  }

  // ---------- Friends
  function renderFriends(m) {
    const pe = pageEls[3];
    clear(pe);
    const f = m.friends;
    pe.append(head('Friends online', f ? `${f.online.length}${f.total != null ? ` of ${f.total}` : ''}` : ''));
    if (!f) { pe.append(note(m.errors.friends || 'Friends aren’t available')); return; }
    if (f.private) { pe.append(note('Your friends list is private on Steam — make it public under Edit Profile → Privacy Settings to see who’s online.')); return; }
    if (!f.online.length) { pe.append(note('None of your friends are online right now')); return; }
    pe.append(list(f.online.map((x) => row({ round: true, art: h('div.cs-fava', avatar(x.avatar, x.name, 'md'), h('i.cs-sdot', { dataset: { s: x.key } })), title: x.name, sub: x.sub,
      right: x.art ? art(x.art, x.shape, x.sub, 'mini') : null, cls: x.key === 'ingame' ? 'playing' : '' }))));
  }

  // ---------- states
  function renderState() {
    const e = p.error;
    pageEls.forEach((pe) => clear(pe));
    lists.length = 0;
    const pe = pageEls[page];
    if (!e) { pe.append(h('div.cs-state', spinner(`Loading ${svc.name}…`))); return; }
    const cfg = {
      bridge: ['Bridge not found', 'PlayStation and Steam data come through the bridge on your computer or Pi. Start it (start-bridge.bat / start-bridge.sh) and this screen fills in by itself.', 'Look again'],
      signin: [steam ? 'Steam isn’t set up' : 'Sign in to PlayStation', e.message, 'Set up'],
      adapter: ['Update the bridge', e.message, 'Look again'],
      other: [`Couldn’t load ${svc.name}`, e.message, 'Try again'],
    }[e.kind] || ['Error', e.message, 'Try again'];
    pe.append(h('div.cs-state', h('div.cs-state-ic', { html: icon(e.kind === 'bridge' ? 'link' : e.kind === 'signin' ? 'person' : 'refresh') }),
      h('div.cs-state-title', cfg[0]), h('div.cs-state-msg', cfg[1]),
      h('div.cs-state-btns',
        h('button.pill.small.primary', { type: 'button', onclick: async (ev) => {
          ev.stopPropagation();
          if (e.kind === 'signin') { go('connect', { id }); return; }
          if (e.kind === 'bridge') await bridgeBase({ force: true });
          p.refresh();
        } }, cfg[2]),
        e.kind !== 'signin' ? h('button.pill.small', { type: 'button', onclick: (ev) => { ev.stopPropagation(); go('connect', { id }); } }, 'Setup') : null)));
  }

  function paintRim(m) {
    const live = m?.me?.key || 'none';
    el.dataset.status = live;
    const pr = m?.progress;
    const arc = rim.querySelector('.cs-arc'), knob = rim.querySelector('.cs-knob');
    const pct = pr ? Math.max(0, Math.min(100, pr.pct || 0)) : 0;
    el.classList.toggle('has-arc', !!pr);
    arc.style.strokeDasharray = `${pct} 100`;
    const a = (pct / 100) * Math.PI * 2;
    knob.setAttribute('cx', (50 + 47 * Math.sin(a)).toFixed(2)); knob.setAttribute('cy', (50 - 47 * Math.cos(a)).toFixed(2));
    // the % label rides on the end of the arc
    const r = 47;
    arcLabel.style.left = `${50 + r * Math.sin(a)}%`; arcLabel.style.top = `${50 - r * Math.cos(a)}%`;
    arcLabel.textContent = pr ? `${Math.round(pct)}%` : '';
    arcLabel.title = pr ? `${pr.name} · ${Math.round(pct)}%` : '';
  }

  function render() {
    const d = p.data;
    if (!d || (p.error && p.error.kind === 'signin')) {
      model = null; el.classList.remove('has-data'); paintRim(null); setBg(bg, ''); renderState(); setPage(page, { quiet: true }); return;
    }
    model = steam ? steamModel(d) : psnModel(d);
    el.classList.add('has-data');
    const key = JSON.stringify([d.at, p.power, p.error?.message]);
    if (key === lastKey) return;
    lastKey = key;
    // keep the scroll position of the lists across refreshes
    const tops = pageEls.map((pe) => pe.querySelector('.cs-list')?.scrollTop || 0);
    lists.length = 0;
    const m = model;
    el.classList.toggle('playing', !!m.now);
    setBg(bg, m.now ? m.now.bg : m.idleBg, m.now ? m.now.bg2 || m.now.art : m.idleBg2);
    paintRim(m);
    renderNow(m); renderRecent(m); renderAwards(m); renderFriends(m);
    if (p.error) pageEls[0].append(h('div.cs-stale', p.error.kind === 'bridge' ? `Bridge offline · showing ${ago(d.at)}` : p.error.message));
    pageEls.forEach((pe, i) => { const l = pe.querySelector('.cs-list'); if (l) l.scrollTop = tops[i]; });
    setPage(page);
  }

  // ---------- input: swipe, knob / wheel, keys
  let sx = null;
  el.addEventListener('pointerdown', (e) => { sx = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  el.addEventListener('pointerup', (e) => {
    if (!sx) return;
    const dx = e.clientX - sx.x, dy = e.clientY - sx.y, dt = performance.now() - sx.t; sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 800) setPage(page + (dx < 0 ? 1 : -1));
  });
  let wheelAcc = 0, wheelT = 0;
  el.addEventListener('wheel', (e) => {
    const l = e.target.closest?.('.cs-list');
    if (l && Math.abs(e.deltaY) > Math.abs(e.deltaX) && l.scrollHeight > l.clientHeight + 2) return;   // scroll the list
    e.preventDefault();
    wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(wheelAcc) > 60 && performance.now() - wheelT > 350) { setPage(page + (wheelAcc > 0 ? 1 : -1)); wheelAcc = 0; wheelT = performance.now(); }
  }, { passive: false });
  const onKey = (e) => {
    if (e.target.matches?.('input, textarea')) return;
    const k = e.key;
    if (k === 'Escape') { if (topPanel()) topPanel().close(); else go('home'); return; }
    if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); setPage(page + 1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); setPage(page - 1); }
    else if (k === 'ArrowDown' || k === 'ArrowUp') { const l = pageEls[page].querySelector('.cs-list'); if (l) { e.preventDefault(); l.scrollBy({ top: (k === 'ArrowDown' ? 1 : -1) * l.clientHeight * 0.3, behavior: 'smooth' }); } }
    else if (/^[1-4]$/.test(k)) setPage(+k - 1);
    else if (k === 'r') p.refresh();
  };
  window.addEventListener('keydown', onKey);

  const offs = [p.on('change', render), p.on('power', () => { lastKey = ''; render(); })];
  setPage(page, { quiet: true });
  render();
  p.start();
  return { el, showChrome() {}, destroy() { offs.forEach((f) => f()); window.removeEventListener('keydown', onKey); p.stop(); } };
}
