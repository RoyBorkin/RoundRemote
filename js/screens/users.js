// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// "Who's watching / listening": pick the user (or account) a service acts as.
//   Plex (music + Movies & TV): Plex Home users, PIN pad for protected users   → js/providers/plex-users.js
//   Jellyfin (music + Movies & TV): server users, password or Quick Connect    → js/providers/jellyfin-users.js
//   Spotify: several saved accounts (Spotify has no sub-users)                 → js/providers/spotify-accounts.js
// UI: userChip() (avatar + name in the service headers), openUserPicker() (the round picker / "Who's watching?"
// screen), tileUserBadge() (tiny avatar on Home's tiles), askWhoIsWatching() (Movies & TV opened), and the
// Settings pages "Plex users", "Jellyfin users", "Spotify accounts" (settings-registry.js).
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openPanel, toast, spinner, emptyNote } from '../ui/overlay.js';
import { editText } from '../ui/keyboard.js';
import { store } from '../core/store.js';
import { provider, getService } from '../providers/registry.js';
import { registerSettings } from './settings-registry.js';
import { toggle } from './panels.js';
import { cachedHome, activePlexUser, plexHomeUsers, plexUserCount, switchPlexUser } from '../providers/plex-users.js';
import {
  activeJellyfinUser, jellyfinAvatar, jellyfinUsers, jellyfinUserCount, switchJellyfinUser, signInJellyfinUser,
  quickConnectEnabled, quickConnectJellyfinUser, forgetJellyfinUser,
} from '../providers/jellyfin-users.js';
import { spotifyAccounts, activeSpotifyAccount, spotifyAccountCount, switchSpotifyAccount, addSpotifyAccount, forgetSpotifyAccount } from '../providers/spotify-accounts.js';

const errMsg = (e) => e?.userMessage || e?.message || 'Something went wrong';
function loadCss() {
  if (document.getElementById('users-css')) return;
  const l = document.createElement('link');
  l.id = 'users-css'; l.rel = 'stylesheet'; l.href = new URL('../../css/users.css', import.meta.url).href;
  document.head.appendChild(l);
}

// ---------------------------------------------------------------- one adapter per kind of service
// user: { key, name, avatar (url | Promise<url> | ''), locked, tags:[], active, saved? , raw }
const KINDS = {
  plex: {
    ids: ['plex', 'plexvideo'], label: 'Plex', ask: 'plexAskWho', signIn: 'plex',
    authed: () => provider('plex').isAuthed(),
    count: () => plexUserCount(),
    stale: () => !cachedHome().at || Date.now() - cachedHome().at > 6 * 3600e3,
    warm: () => plexHomeUsers().catch(() => []),
    active: () => { const u = activePlexUser(); return u ? plexView(u, u.uuid) : null; },
    async list({ fresh } = {}) { const act = activePlexUser()?.uuid; return (await plexHomeUsers({ fresh })).map((u) => plexView(u, act)); },
    async pick(u, ui) {
      if (u.active) return true;
      let pin = '';
      if (u.raw.protected) { pin = await ui.pin(u, (p) => switchPlexUser(u.raw, p)); return pin !== null; }
      ui.busy(u);
      await switchPlexUser(u.raw);
      return true;
    },
  },
  jellyfin: {
    ids: ['jellyfin', 'jellyfinvideo'], label: 'Jellyfin', ask: 'jellyfinAskWho', signIn: 'jellyfin',
    authed: () => provider('jellyfin').isAuthed(),
    count: () => jellyfinUserCount(),
    stale: () => !store.auth('jellyfin.public'),
    warm: () => jellyfinUsers().catch(() => []),
    active: () => { const u = activeJellyfinUser(); return u ? jfView({ ...u, saved: true }) : null; },
    async list() { return (await jellyfinUsers()).map(jfView); },
    async pick(u, ui) {
      if (u.active) return true;
      if (u.saved) {
        try { ui.busy(u); await switchJellyfinUser(u.raw); return true; }
        catch (e) { if (e.code !== 'signin') throw e; toast(errMsg(e)); }
      }
      return ui.jellyfinSignIn(u);
    },
    forget: (u) => forgetJellyfinUser(u.raw),
    addLabel: 'Another user…',
  },
  spotify: {
    ids: ['spotify'], label: 'Spotify', signIn: 'spotify',
    authed: () => provider('spotify').isAuthed(),
    count: () => spotifyAccountCount(),
    stale: () => false, warm: async () => [],
    active: () => { const a = activeSpotifyAccount(); return a ? spView(a) : null; },
    async list() { return spotifyAccounts().map(spView); },
    async pick(u, ui) { if (u.active) return true; ui.busy(u); await switchSpotifyAccount(u.raw); return true; },
    forget: (u) => forgetSpotifyAccount(u.raw),
    add: () => addSpotifyAccount(),
    addLabel: 'Add an account',
  },
};
function plexView(u, activeUuid) {
  const tags = [];
  if (u.admin) tags.push('Admin');
  if (u.restricted) tags.push(u.profile === 'little_kid' ? 'Little kid' : u.profile === 'older_kid' ? 'Older kid' : u.profile === 'teen' ? 'Teen' : 'Managed');
  return { key: u.uuid, name: u.title, avatar: u.thumb || '', locked: !!u.protected, tags, active: u.uuid === activeUuid, raw: u };
}
function jfView(u) {
  return { key: u.userId, name: u.name, avatar: jellyfinAvatar(u), locked: !u.saved && u.hasPassword !== false, saved: !!u.saved, tags: u.admin ? ['Admin'] : [], active: !!u.active, raw: u };
}
function spView(a) { return { key: a.id, name: a.name, avatar: a.image || '', locked: false, tags: a.product && a.product !== 'premium' ? ['Free'] : [], active: !!a.active, saved: true, raw: a }; }

/** The kind of users a service has (null = none). */
export function userKind(serviceId) {
  for (const [k, v] of Object.entries(KINDS)) if (v.ids.includes(serviceId)) return k;
  return null;
}
const isVideo = (serviceId) => getService(serviceId)?.section === 'media';

// ---------------------------------------------------------------- avatar
const hue = (s = '') => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (n = '') => n.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
/** Round avatar: the picture, or the initials on a colour of their own. */
export function avatarEl(u, cls = '') {
  const el = h(`span.uav${cls ? '.' + cls : ''}`, { '--h': hue(u?.name || '') }, h('span.uav-i', initials(u?.name || '')));
  const set = (url) => {
    if (!url) return;
    const img = new Image();
    img.onload = () => { el.style.backgroundImage = `url("${url}")`; el.classList.add('has-img'); };
    img.src = url;
  };
  if (u?.avatar && typeof u.avatar.then === 'function') u.avatar.then(set).catch(() => {}); else set(u?.avatar);
  return el;
}

// ---------------------------------------------------------------- the chip in the service headers
/**
 * Avatar (+ name) button for a service's header; opens the picker. Hidden while the service isn't signed in
 * or there's nobody else to switch to. Returns the element; it cleans up after itself when removed.
 */
export function userChip(serviceId, { compact = false, short = false, className = '' } = {}) {
  loadCss();
  const kind = userKind(serviceId);
  const el = h(`button.uchip${compact ? '.compact' : ''}${className ? '.' + className : ''}`, { type: 'button', hidden: true, onclick: (e) => { e.stopPropagation(); openUserPicker(serviceId); } });
  if (!kind) return el;
  const k = KINDS[kind];
  let last = '';
  const paint = () => {
    const u = k.authed() ? k.active() : null;
    const show = !!u && k.count() > 1;
    el.hidden = !show;
    if (!show) { last = ''; return; }
    const sig = `${u.key}|${u.name}|${typeof u.avatar === 'string' ? u.avatar : 'p'}`;
    if (sig === last) return;
    last = sig;
    clear(el).append(...[avatarEl(u), compact ? null : h('span.uchip-name', short ? u.name.split(/\s+/)[0] : u.name)].filter(Boolean));
    el.setAttribute('aria-label', `${isVideo(serviceId) ? 'Watching' : 'Listening'} as ${u.name} — switch user`);
    el.title = `${u.name} — switch user`;
  };
  paint();
  if (k.authed() && k.stale()) k.warm().then(paint);
  setTimeout(() => { if (el.isConnected) el.dataset.mounted = '1'; }, 0);
  const off = store.on('auth', (key) => {
    if (!String(key).startsWith(kind)) return;
    if (!el.isConnected && el.dataset.mounted) { off(); return; }   // the screen has gone
    paint();
  });
  el.destroy = off;
  return el;
}

/** Tiny avatar on a Home tile when the service has more than one user. */
export function tileUserBadge(btn, serviceId) {
  const kind = userKind(serviceId);
  if (!kind) return;
  loadCss();
  const k = KINDS[kind];
  const paint = () => {
    const u = k.authed() ? k.active() : null;
    if (!u || k.count() < 2) return;
    const a = avatarEl(u, 'svc-user');
    a.title = u.name;
    btn.querySelector('.badge')?.append(a);
  };
  paint();
}

// ---------------------------------------------------------------- flows shared by the picker and Settings
/** PIN pad (4 digits, keys or the on-screen pad). check(pin) throws { code: 'pin' } for a wrong PIN. */
function pinPad(u, check, { onBack, onDone, onError }) {
  let pin = '';
  const dots = h('div.pin-dots', [0, 1, 2, 3].map(() => h('i')));
  const msg = h('div.pin-msg', 'Enter PIN');
  const pad = h('div.pin-pad');
  const paintDots = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const off = () => window.removeEventListener('keydown', onKey, true);
  const press = async (d) => {
    if (pad.classList.contains('wait')) return;
    if (d === 'del') { pin = pin.slice(0, -1); paintDots(); return; }
    if (d === 'back') { off(); onBack(); return; }
    if (pin.length >= 4) return;
    if (!pin) { dots.classList.remove('shake'); msg.textContent = 'Enter PIN'; }
    pin += d; paintDots(); navigator.vibrate?.(8);
    if (pin.length < 4) return;
    pad.classList.add('wait'); msg.textContent = 'Checking…';
    try { await check(pin); off(); onDone(); }
    catch (e) {
      pad.classList.remove('wait'); pin = ''; paintDots();
      if (e.code !== 'pin') { off(); onError(e); return; }
      msg.textContent = 'Wrong PIN — try again';
      dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
      navigator.vibrate?.([30, 40, 30]);
    }
  };
  const onKey = (e) => {
    if (!el.isConnected) { off(); return; }
    if (/^\d$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); press('del'); }
  };
  window.addEventListener('keydown', onKey, true);
  pad.append(...['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'del'].map((d) => h(`button.pin-key${/\d/.test(d) ? '' : '.fn'}`, {
    type: 'button', 'aria-label': d === 'del' ? 'Delete' : d === 'back' ? 'Back' : d, onclick: (e) => { e.stopPropagation(); press(d); },
  }, d === 'del' ? h('span', { html: icon('backspace') }) : d === 'back' ? h('span', { html: icon('back') }) : d)));
  const el = h('div.ups-pin', h('div.pin-head', avatarEl(u, 'sm'), msg), dots, pad);
  el.off = off;
  return el;
}

/** The steps a pick may need (busy, PIN, Jellyfin sign-in), drawn into a panel. pick() resolves true once switched. */
function flowUi(panel, body, { back }) {
  let abort = null;
  const ui = {
    busy(u) { clear(body).append(h('div.ups-busy', avatarEl(u, 'xl'), h('div.ups-name', u.name), spinner('Switching…'))); },
    pin(u, check) {
      return new Promise((res) => {
        panel.setTitle(u.name);
        const pad = pinPad(u, check, { onBack: () => { res(null); back(); }, onDone: () => res(true), onError: (e) => { toast(errMsg(e), { kind: 'error' }); res(null); back(); } });
        panel.onDestroy = () => { pad.off(); abort?.abort(); };
        clear(body).append(pad);
      });
    },
    // Jellyfin: a user who isn't signed in here yet → no password / password / Quick Connect
    async jellyfinSignIn(u) {
      if (u.raw.hasPassword === false) { ui.busy(u); await signInJellyfinUser(u.raw, ''); return true; }
      const qc = await quickConnectEnabled();
      return new Promise((res) => {
        const usePass = async () => {
          const pw = await editText({ title: `Password for ${u.name}`, secret: true, okLabel: 'Sign in' });
          if (pw === null) return;
          try { ui.busy(u); await signInJellyfinUser(u.raw, pw); res(true); }
          catch (e) { toast(errMsg(e), { kind: 'error' }); choose(); }
        };
        const useQc = async () => {
          ui.busy(u);
          try {
            const r = await quickConnectJellyfinUser(u.raw);
            if (r.done) { res(true); return; }
            abort = new AbortController();
            clear(body).append(h('div.ups-qc', avatarEl(u, 'sm'), h('div.ups-code', r.code),
              h('div.ups-note', `In a Jellyfin app signed in as ${u.name}: Settings → Quick Connect, and enter this code`), h('div.spin'),
              h('button.pill.small', { type: 'button', onclick: (e) => { e.stopPropagation(); abort?.abort(); choose(); } }, 'Cancel')));
            if (await r.wait(abort.signal)) res(true);
          } catch (e) { toast(errMsg(e), { kind: 'error' }); choose(); }
        };
        const choose = () => {
          panel.setTitle(u.name);
          clear(body).append(h('div.ups-busy', avatarEl(u, 'xl'),
            h('div.ups-note', 'Sign in once — after that, switching is instant'),
            h('div.ups-actions',
              h('button.pill.primary', { type: 'button', onclick: (e) => { e.stopPropagation(); usePass(); } }, 'Password'),
              qc ? h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); useQc(); } }, 'Quick Connect') : null),
            h('button.pill.small', { type: 'button', onclick: (e) => { e.stopPropagation(); abort?.abort(); res(false); back(); } }, 'Back')));
        };
        choose();
      });
    },
  };
  panel.onDestroy = () => abort?.abort();
  return ui;
}

// ---------------------------------------------------------------- the picker
/**
 * The round user picker. whos: the "Who's watching?" screen shown when Movies & TV opens (bigger avatars).
 * only: go straight to one user (Settings rows). Resolves true when a user was picked, false when closed.
 */
export function openUserPicker(serviceId, { whos = false, only = null } = {}) {
  loadCss();
  const kind = userKind(serviceId);
  if (!kind) return Promise.resolve(false);
  const k = KINDS[kind];
  const verb = isVideo(serviceId) ? 'watching' : 'listening';
  const title = only ? only.name : kind === 'spotify' ? 'Spotify account' : `Who’s ${verb}?`;
  return new Promise((resolve) => {
    let result = false;
    openPanel({
      title, className: `users-panel${whos ? ' whos' : ''}`, onClose: () => resolve(result),
      build(body, panel) {
        const back = () => (only ? panel.close() : showList());
        const ui = flowUi(panel, body, { back });
        async function tap(u) {
          try {
            if (!(await k.pick(u, ui))) return;
            result = true;
            const now = k.active();
            toast(kind === 'spotify' ? `Spotify: ${now?.name || u.name}` : `${verb[0].toUpperCase() + verb.slice(1)} as ${now?.name || u.name}`);
            panel.close();
          } catch (e) { toast(errMsg(e), { kind: 'error' }); back(); }
        }
        function tile(u) {
          return h(`button.ups-user${u.active ? '.on' : ''}`, { type: 'button', 'aria-label': `${u.name}${u.locked ? ' (PIN)' : ''}${u.active ? ' (current)' : ''}`, onclick: (e) => { e.stopPropagation(); tap(u); } },
            h('span.ups-av', avatarEl(u, 'lg'), u.locked ? h('i.ups-lock', { html: icon('lock') }) : null, u.active ? h('i.ups-on', { html: icon('check') }) : null),
            h('span.ups-name', u.name),
            u.tags.length ? h('span.ups-tag', u.tags[0]) : null);
        }
        async function showList(fresh = false) {
          panel.setTitle(title);
          clear(body).append(spinner('Loading users…'));
          let list;
          try { list = await k.list({ fresh }); }
          catch (e) { clear(body).append(emptyNote(errMsg(e), { label: 'Retry', onClick: () => showList(true) })); return; }
          if (panel.closed) return;
          const n = list.length + (k.add ? 1 : 0);
          const grid = h(`div.ups-grid.n${Math.min(n, 7)}`, list.map(tile));
          if (k.add) grid.append(h('button.ups-user.add', { type: 'button', onclick: (e) => { e.stopPropagation(); k.add().catch((er) => toast(errMsg(er), { kind: 'error' })); } },
            h('span.ups-av', h('span.uav.lg.add', { html: icon('plus') })), h('span.ups-name', k.addLabel)));
          clear(body).append(grid);
          if (!list.length) body.append(emptyNote('No users found'));
          else if (list.length === 1 && kind === 'plex') body.append(h('div.ups-note', 'Add people to your Plex Home at plex.tv → Settings → Plex Home'));
        }
        if (only) tap(only); else showList();
      },
    });
  });
}

/** Movies & TV just opened: ask who's watching, if that's switched on and there is a choice. */
export async function askWhoIsWatching(serviceId) {
  const kind = userKind(serviceId), k = KINDS[kind];
  if (!k?.ask || !store.get(k.ask) || !k.authed()) return;
  if (k.count() < 2) await k.warm();
  if (k.count() < 2) return;
  await openUserPicker(serviceId, { whos: true });
}

// ---------------------------------------------------------------- Settings pages
function settingsPage(kind) {
  const k = KINDS[kind];
  return (el) => {
    loadCss();
    const box = h('div.ups-settings');
    el.append(box);
    const svcId = k.ids[k.ids.length - 1];
    const render = async (fresh = false) => {
      clear(box);
      if (!k.authed()) {
        box.append(h('div.opt-hint', `Sign in to ${k.label} first.`),
          h('div.center', h('button.pill.primary', { type: 'button', onclick: (e) => { e.stopPropagation(); import('../core/router.js').then((m) => m.go('connect', { id: k.signIn })); } }, `Sign in to ${k.label}`)));
        return;
      }
      box.append(h('div.opt-hint', kind === 'plex' ? 'Pick who uses Plex on this display: Continue watching, watched state, ratings, playlists and history are theirs, and managed users only see their own libraries. PIN-protected users ask for their PIN.'
        : kind === 'jellyfin' ? 'Everyone who signs in here keeps their sign-in, so switching is instant — resume points, Next up, playlists, favourites and played state are theirs.'
          : 'Spotify has no family profiles, so save each person’s Spotify account and switch between them. Each account must be allowed in your Spotify app (developer dashboard → User Management).'));
      const list = h('div.ups-rows');
      box.append(list);
      list.append(spinner());
      let users = [];
      try { users = await k.list({ fresh }); } catch (e) { clear(list).append(emptyNote(errMsg(e))); return; }
      clear(list);
      for (const u of users) {
        const right = h('span.ups-row-right', u.active ? h('span.check', { html: icon('check') }) : null,
          k.forget && u.saved ? h('button.chip.sm', { type: 'button', onclick: async (e) => { e.stopPropagation(); await k.forget(u); toast(`Forgot ${u.name}`); render(); } }, 'Forget') : null);
        list.append(h(`button.row.ups-row${u.active ? '.active' : ''}`, { type: 'button', onclick: async (e) => { e.stopPropagation(); if (!u.active && await openUserPicker(svcId, { only: u })) render(); } },
          avatarEl(u, 'rw'),
          h('div.row-text', h('div.row-title', u.name, u.locked ? h('i.ups-lock-in', { html: icon('lock') }) : null),
            h('div.row-sub', [u.active ? 'Active' : '', ...u.tags, kind === 'jellyfin' && !u.saved ? 'Not signed in here yet' : ''].filter(Boolean).join(' · ') || ' ')),
          right));
      }
      if (!users.length) list.append(emptyNote(kind === 'spotify' ? 'No saved accounts yet' : 'No users found'));
      const acts = h('div.center.ups-acts');
      if (k.add) acts.append(h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); k.add().catch((er) => toast(errMsg(er), { kind: 'error' })); } }, k.addLabel));
      if (kind !== 'spotify') acts.append(h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); render(true); } }, 'Refresh'));
      box.append(acts);
      if (k.ask) box.append(toggle('Ask who’s watching when opening Movies & TV', () => !!store.get(k.ask), (v) => store.set(k.ask, v)));
    };
    render();
  };
}

registerSettings({ group: 'accounts', id: 'plex-users', title: 'Plex users', icon: 'people', order: 30, summary: 'Who’s watching: Plex Home users and PINs', keywords: 'profile home user pin managed kids switch who', build: settingsPage('plex') });
registerSettings({ group: 'accounts', id: 'jellyfin-users', title: 'Jellyfin users', icon: 'people', order: 31, summary: 'Switch between people on your server', keywords: 'profile user password quick connect switch who', build: settingsPage('jellyfin') });
registerSettings({ group: 'accounts', id: 'spotify-accounts', title: 'Spotify accounts', icon: 'person', order: 32, summary: 'Save several accounts and switch', keywords: 'account switch family profile', build: settingsPage('spotify') });
