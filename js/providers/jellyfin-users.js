// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Jellyfin users: several people on one server, each signed in once with their own access token; switching
// is instant. Both Jellyfin tiles (music + Movies & TV) use the active user (rr.auth.jellyfin, as before), so
// resume points, Next up, playlists, favourites and played state are that user's.
//
// Jellyfin endpoints:
//   GET  /Users/Public                         → users shown on the login screen [{ Id, Name, PrimaryImageTag, HasPassword, … }] (no auth)
//   GET  /Users                                → every user (administrators only)
//   POST /Users/AuthenticateByName {Username, Pw} → { User, AccessToken }
//   GET  /QuickConnect/Enabled · POST /QuickConnect/Initiate → { Code, Secret } · GET /QuickConnect/Connect?secret=
//   POST /QuickConnect/Authorize?code=&userId= (10.9+: an administrator approves the code for that user, no password)
//   POST /Users/AuthenticateWithQuickConnect {Secret} → { User, AccessToken }
//
// Saved users: rr.auth.jellyfin.users = [{ userId, name, token, server, imageTag, admin }] (tokens stay in
// localStorage like the main token; never logged).
import { store } from '../core/store.js';
import { qs, sleep, isMixed, lanImage } from '../core/util.js';
import { provider } from './registry.js';

const VAULT = 'jellyfin.users', PUBLIC = 'jellyfin.public';
const jf = () => provider('jellyfin');
const server = () => jf().server;
const clean = (msg, extra = {}) => Object.assign(new Error(msg), { userMessage: msg, ...extra });

/** Users saved on this display for the current server. */
export function savedJellyfinUsers() { return (store.auth(VAULT) || []).filter((u) => u.server === server()); }
export function activeJellyfinUser() {
  const a = store.auth('jellyfin');
  if (!a?.token || a.server !== server()) return null;
  const saved = savedJellyfinUsers().find((u) => u.userId === a.userId) || {};
  return { userId: a.userId, name: a.user || saved.name || 'Jellyfin user', imageTag: a.imageTag || saved.imageTag || '', admin: !!(a.admin ?? saved.admin), active: true };
}

/** Avatar URL (usable from this page — LAN http images on an https page go through lanImage). */
export async function jellyfinAvatar(u, size = 160) {
  if (!u?.userId && !u?.Id) return '';
  const id = u.userId || u.Id, tag = u.imageTag ?? u.PrimaryImageTag;
  if (!tag) return '';
  const full = `${server()}/Users/${id}/Images/Primary?${qs({ tag, maxWidth: size, quality: 90 })}`;
  return isMixed(full) ? lanImage(full) : full;
}

/** Everyone you could switch to: saved users + the server's public users (+ all users when you're an admin). */
export async function jellyfinUsers() {
  const p = jf();
  let pub = [];
  try { pub = await p.api('/Users/Public', { token: null }) || []; } catch {}
  const me = activeJellyfinUser();
  if (me?.admin) { try { const all = await p.api('/Users'); if (Array.isArray(all)) pub = [...pub, ...all.filter((x) => !pub.some((y) => y.Id === x.Id) && !x.Policy?.IsDisabled)]; } catch {} }
  const saved = savedJellyfinUsers();
  const out = new Map();
  for (const x of pub) out.set(x.Id, { userId: x.Id, name: x.Name, imageTag: x.PrimaryImageTag || '', hasPassword: x.HasPassword !== false && x.HasConfiguredPassword !== false, admin: !!x.Policy?.IsAdministrator, saved: false });
  for (const s of saved) out.set(s.userId, { ...(out.get(s.userId) || { hasPassword: true }), userId: s.userId, name: s.name || out.get(s.userId)?.name, imageTag: s.imageTag || out.get(s.userId)?.imageTag || '', admin: s.admin, saved: true });
  const list = [...out.values()].map((u) => ({ ...u, active: u.userId === me?.userId }));
  list.sort((a, b) => (b.active - a.active) || (b.saved - a.saved) || a.name.localeCompare(b.name));
  store.setAuth(PUBLIC, { server: server(), count: list.length });
  return list;
}
export function jellyfinUserCount() {
  const c = store.auth(PUBLIC);
  return Math.max(savedJellyfinUsers().length, c?.server === server() ? c.count : 0);
}

/** Switch to a saved user (checks the token still works; a revoked one is forgotten → sign in again). */
export async function switchJellyfinUser(u) {
  const s = savedJellyfinUsers().find((x) => x.userId === u.userId);
  if (!s) throw clean('Sign in as this user first', { code: 'signin' });
  try { await jf().api('/Users/Me', { token: s.token }); }
  catch (e) {
    if (e?.status === 401) { forgetJellyfinUser(s, { keepActive: true }); throw clean(`${s.name} needs to sign in again`, { code: 'signin' }); }
    // offline / old server without /Users/Me: switch anyway
  }
  store.setAuth('jellyfin', { token: s.token, userId: s.userId, user: s.name, server: s.server, imageTag: s.imageTag, admin: s.admin });
  return activeJellyfinUser();
}

/** Sign in as a user with their password (an empty password for users without one). */
export async function signInJellyfinUser(u, password = '') {
  try { await jf().login(u.name, password); }
  catch (e) { throw clean(e?.status === 401 ? 'Wrong password' : (e?.userMessage || 'Couldn’t sign in'), { code: e?.status === 401 ? 'password' : 'other' }); }
  return activeJellyfinUser();
}

/** Is Quick Connect switched on on the server? */
export async function quickConnectEnabled() {
  try { return (await jf().api('/QuickConnect/Enabled', { token: null })) !== false; } catch { return false; }
}
/**
 * Quick Connect for a user. When the active user is an administrator the code is approved for that user right
 * here (no password needed); otherwise returns { code, wait(signal) } — approve the code in a Jellyfin app
 * signed in as that user (Settings → Quick Connect).
 */
export async function quickConnectJellyfinUser(u) {
  const p = jf();
  const { code, secret } = await p.quickConnectStart();
  const me = activeJellyfinUser(), meTok = store.auth('jellyfin')?.token;
  if (me?.admin && meTok) {
    try {
      await p.api(`/QuickConnect/Authorize?${qs({ code, userId: u.userId })}`, { method: 'POST', token: meTok });
      for (let i = 0; i < 6; i++) {
        const st = await p.api(`/QuickConnect/Connect?${qs({ secret })}`, { token: null }).catch(() => null);
        if (st?.Authenticated) break;
        await sleep(500);
      }
      const a = await p.api('/Users/AuthenticateWithQuickConnect', { method: 'POST', json: { Secret: secret }, token: null });
      if (a?.User?.Id !== u.userId) throw clean('The server approved a different user');
      p._save(a);
      return { done: true, user: activeJellyfinUser() };
    } catch (e) { if (e?.code) throw e; /* older server: approve it on another device */ }
  }
  return { done: false, code, wait: (signal) => p.quickConnectWait(secret, signal).then((ok) => (ok ? activeJellyfinUser() : null)) };
}

/** Forget a saved user (its token is dropped). Forgetting the active user switches to another saved one, or signs out. */
export async function forgetJellyfinUser(u, { keepActive = false } = {}) {
  const s = savedJellyfinUsers().find((x) => x.userId === u.userId);
  if (s && !keepActive) jf().api('/Sessions/Logout', { method: 'POST', token: s.token }).catch(() => {});
  const list = (store.auth(VAULT) || []).filter((x) => !(x.userId === u.userId && x.server === server()));
  store.setAuth(VAULT, list);
  if (keepActive || activeJellyfinUser()?.userId !== u.userId) return;
  const next = savedJellyfinUsers()[0];
  if (next) store.setAuth('jellyfin', { token: next.token, userId: next.userId, user: next.name, server: next.server, imageTag: next.imageTag, admin: next.admin });
  else store.setAuth('jellyfin', null);
}
