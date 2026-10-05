// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Plex Home users ("who's watching"): list the Home of the signed-in Plex account and switch to one of its
// users (PIN-protected users need their PIN). Both Plex tiles (Plexamp music and Movies & TV) then act as
// that user: plex.js uses the user's plex.tv token, so /api/v2/resources hands out that user's own server
// access token — On Deck, watched state, ratings, playlists, history and the libraries a managed user may see
// all follow, and what you play on the TV reports progress as that user.
//
// plex.tv endpoints (the ones Plex's own apps use; python-plexapi MyPlexAccount.switchHomeUser is the reference):
//   GET  https://plex.tv/api/v2/home/users                       → { users:[{ id, uuid, title, username, thumb, protected, admin, restricted, guest, … }] }
//   POST https://plex.tv/api/v2/home/users/{uuid}/switch?pin=…   → { …user, authToken }
//   (fallback: GET /api/home/users + POST /api/home/users/{id}/switch → XML with authenticationToken)
//   GET  https://plex.tv/api/v2/user                             → the signed-in account (its uuid = the default user)
//
// Stored (localStorage, like the main token; never logged): rr.auth.plex.user = the active user incl. its token
// (none = the signed-in account), rr.auth.plex.home = the cached list (no tokens), rr.auth.plex.tokens = tokens
// of users without a PIN (switch back without waiting for plex.tv). A PIN-protected user's token is kept only
// while that user is active, so switching back to them asks for the PIN again — as in the Plex apps.
import { store } from '../core/store.js';
import { http, qs } from '../core/util.js';
import { plexHeaders } from './plex.js';

const TV = 'https://plex.tv';
const ACTIVE = 'plex.user', HOME = 'plex.home', TOKENS = 'plex.tokens';
const STALE_MS = 6 * 3600e3;

const accountToken = () => store.auth('plex')?.token || null;
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';
const clean = (msg, extra = {}) => Object.assign(new Error(msg), { userMessage: msg, ...extra });   // never pass on an HttpError (its url may carry the PIN)

function norm(u) {
  return {
    id: u.id != null ? String(u.id) : '', uuid: u.uuid || '', title: u.title || u.friendlyName || u.username || 'Plex user',
    thumb: u.thumb || '', protected: bool(u.protected), admin: bool(u.admin), restricted: bool(u.restricted), guest: bool(u.guest),
    profile: u.restrictionProfile || '',
  };
}
function parseXmlUsers(xml) {
  const doc = new DOMParser().parseFromString(String(xml || ''), 'text/xml');
  return [...doc.querySelectorAll('User')].map((n) => norm(Object.fromEntries([...n.attributes].map((a) => [a.name, a.value]))));
}

/** The Home as last fetched: { users, self (uuid of the signed-in account), at } — synchronous, no network. */
export function cachedHome() { return store.auth(HOME) || { users: [], self: '', at: 0 }; }
/** The active Plex user (the signed-in account when none was picked). */
export function activePlexUser() {
  const a = store.auth(ACTIVE);
  if (a?.uuid) { const { token, ...u } = a; return { ...u, active: true }; }   // the token stays in storage
  const home = cachedHome();
  const self = home.users.find((u) => u.uuid === home.self);
  return self ? { ...self, active: true } : null;
}
export const isDefaultUser = () => !store.auth(ACTIVE)?.uuid;

/** Fetch the Home users (cached for a few hours unless fresh). Accounts without Plex Home just list themselves. */
export async function plexHomeUsers({ fresh = false } = {}) {
  const tok = accountToken();
  if (!tok) throw clean('Sign in to Plex first');
  const old = cachedHome();
  if (!fresh && old.users.length && Date.now() - old.at < STALE_MS) return old.users;
  let users = null, self = old.self;
  try {
    const me = await http(`${TV}/api/v2/user`, { headers: plexHeaders(tok), timeout: 8000 });
    if (me?.uuid) self = me.uuid;
    const d = await http(`${TV}/api/v2/home/users`, { headers: plexHeaders(tok), timeout: 8000 }).catch(() => null);
    if (Array.isArray(d?.users)) users = d.users.map(norm);
    else {
      const xml = await http(`${TV}/api/home/users`, { headers: { ...plexHeaders(tok), Accept: 'application/xml' }, timeout: 8000 }).catch(() => null);
      if (typeof xml === 'string' && xml.includes('<User')) users = parseXmlUsers(xml);
    }
    if (!users?.length && me) users = [norm({ ...me, admin: true })];   // not a Plex Home: just you
  } catch (e) {
    if (old.users.length) return old.users;   // offline: the last list
    throw clean(e?.status === 401 ? 'Plex sign-in expired — sign in again' : 'Couldn’t reach plex.tv');
  }
  // the signed-in account first, then the others in Plex's order
  users.sort((a, b) => (b.uuid === self) - (a.uuid === self));
  store.setAuth(HOME, { users, self, at: Date.now() });
  return users;
}

/** Number of users to choose from (from the cache) — the user chip shows when there is more than one. */
export function plexUserCount() { return cachedHome().users.length; }

/**
 * Switch both Plex tiles to `user`. PIN-protected users need `pin` (4 digits); a wrong PIN throws { code: 'pin' }.
 * Switching to the signed-in account itself checks its PIN (if it has one) and then simply uses the account token.
 */
export async function switchPlexUser(user, pin = '') {
  const tok = accountToken();
  if (!tok) throw clean('Sign in to Plex first');
  const home = cachedHome();
  const isSelf = user.uuid && user.uuid === home.self;
  if (user.protected && !pin) throw clean('This user has a PIN', { code: 'needpin' });
  const kept = store.auth(TOKENS) || {};
  let token = null;
  try {
    const d = await http(`${TV}/api/v2/home/users/${encodeURIComponent(user.uuid)}/switch?${qs({ pin: pin || undefined })}`, { method: 'POST', headers: plexHeaders(tok), timeout: 10000 });
    token = d?.authToken || d?.authenticationToken || null;
  } catch (e) {
    if (user.protected && [401, 403, 422].includes(e?.status)) throw clean('Wrong PIN', { code: 'pin' });
    if (e?.status === 404 && user.id) {   // older plex.tv: the v1 endpoint with the numeric id
      try {
        const xml = await http(`${TV}/api/home/users/${encodeURIComponent(user.id)}/switch?${qs({ pin: pin || undefined })}`, { method: 'POST', headers: { ...plexHeaders(tok), Accept: 'application/xml' }, timeout: 10000 });
        token = /authenticationToken="([^"]+)"/.exec(String(xml || ''))?.[1] || null;
      } catch (e2) { if (user.protected && [401, 403, 422].includes(e2?.status)) throw clean('Wrong PIN', { code: 'pin' }); }
    }
    if (!token && !user.protected && kept[user.uuid] && !e?.status) token = kept[user.uuid];   // offline: a token we already had
    if (!token && (!isSelf || user.protected)) throw clean(e?.status === 401 ? 'Plex sign-in expired — sign in again' : 'Couldn’t switch user — is plex.tv reachable?');
  }
  if (isSelf) { store.setAuth(ACTIVE, null); return activePlexUser(); }
  if (!token) throw clean('Plex didn’t hand out a token for this user');
  if (!user.protected) store.setAuth(TOKENS, { ...kept, [user.uuid]: token });
  else if (kept[user.uuid]) { const { [user.uuid]: _, ...rest } = kept; store.setAuth(TOKENS, rest); }
  const { active, ...u } = user;
  store.setAuth(ACTIVE, { ...u, token, at: Date.now() });   // plex.js hears this and reconnects as the user
  return activePlexUser();
}

/** Back to the signed-in account (its PIN is needed when it has one, unless it's active already). */
export function plexDefaultUser() { return cachedHome().users.find((u) => u.uuid === cachedHome().self) || null; }

/** Forget everything about Home users (sign-out, or a different account signed in). */
export function forgetPlexUsers() { store.setAuth(ACTIVE, null); store.setAuth(HOME, null); store.setAuth(TOKENS, null); }
