// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Local "Who's watching?" profiles for services whose APIs give no access to their own profiles (Netflix, Disney+,
// Prime Video, Apple TV+, Max, YouTube in Movies & TV). They personalise Round Remote's side only:
//   • My list (favourites) and Recently opened in the streaming library (js/core/stream-library.js)
//   • Kids: the library only shows movies rated up to PG and family / kids shows
//   • TV profile: the name of this person's profile in the TV app — shown as a reminder (the TV app's own profile
//     picker can't be driven from here)
// The shared picker UI is js/screens/users.js (the same one Plex / Jellyfin / Spotify use).
//
// Stored on this display (localStorage rr.svcprofiles.v1, not with the settings, so the lists can grow):
//   { [serviceId]: { list: [{ id, name, hue, kids, tv }], active: id, ask: bool, data: { [profileId | '_']: { fav: [], recent: [] } } } }
// '_' holds My list / Recently opened while no profile has been made.
import { store } from './store.js';

const KEY = 'rr.svcprofiles.v1';
export const PROFILE_SERVICES = ['netflix', 'disney', 'prime', 'appletvplus', 'max', 'ytvideo'];
const MAX_FAV = 200, MAX_RECENT = 30;

let all = null;
function load() {
  if (all) return all;
  try { all = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { all = {}; }
  return all;
}
function save(svc, switched = false) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  store.emit('auth', `local:${svc}`);   // users.js repaints its chips and badges on 'auth' events
  if (switched) store.emit('profile', svc);   // who's watching (or their kids filter) changed: the library redraws
}
function svcData(svc) {
  const a = load();
  a[svc] ||= { list: [], active: '', ask: false, data: {} };
  a[svc].list ||= []; a[svc].data ||= {};
  return a[svc];
}
const newId = () => Math.random().toString(36).slice(2, 9);
const hueOf = (s = '') => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export const hasProfiles = (svc) => PROFILE_SERVICES.includes(svc);
/** The profiles of a service, in the order they were made. */
export const profilesOf = (svc) => svcData(svc).list.slice();
/** The profile in use (null when there are none). */
export function activeProfile(svc) {
  const d = svcData(svc);
  return d.list.find((p) => p.id === d.active) || d.list[0] || null;
}
export function setActiveProfile(svc, id) {
  const d = svcData(svc);
  if (!d.list.some((p) => p.id === id)) return;
  const was = d.active;
  d.active = id; save(svc, was !== id);
}
export function addProfile(svc, { name, hue = null, kids = false, tv = '' } = {}) {
  const d = svcData(svc);
  const n = String(name || '').trim().slice(0, 40);
  if (!n) return null;
  const p = { id: newId(), name: n, hue: Number.isFinite(hue) ? hue : (hueOf(n) + d.list.length * 47) % 360, kids: !!kids, tv: String(tv || '').slice(0, 40) };
  // the first profile takes over what was saved before there were profiles
  if (!d.list.length && d.data._) { d.data[p.id] = d.data._; delete d.data._; }
  d.list.push(p);
  const first = !d.active || d.list.length === 1;
  if (first) d.active = p.id;
  save(svc, first);
  return p;
}
export function updateProfile(svc, id, patch = {}) {
  const d = svcData(svc);
  const p = d.list.find((x) => x.id === id);
  if (!p) return null;
  if (patch.name != null) { const n = String(patch.name).trim().slice(0, 40); if (n) p.name = n; }
  if (patch.hue != null) p.hue = ((Math.round(+patch.hue) % 360) + 360) % 360;
  const kidsChanged = patch.kids != null && !!patch.kids !== !!p.kids;
  if (patch.kids != null) p.kids = !!patch.kids;
  if (patch.tv != null) p.tv = String(patch.tv).trim().slice(0, 40);
  save(svc, kidsChanged && activeProfile(svc)?.id === id);
  return p;
}
export function removeProfile(svc, id) {
  const d = svcData(svc);
  d.list = d.list.filter((p) => p.id !== id);
  delete d.data[id];
  const was = d.active === id;
  if (was) d.active = d.list[0]?.id || '';
  save(svc, was);
}
/** "Who's watching?" every time the service opens (with two or more profiles). */
export const askWho = (svc) => !!svcData(svc).ask;
export function setAskWho(svc, v) { svcData(svc).ask = !!v; save(svc); }
/** Kids filter in force for the service's active profile. */
export const kidsMode = (svc) => !!activeProfile(svc)?.kids;

// ---------------------------------------------------------------- My list · Recently opened (per profile)
function bucket(svc) {
  const d = svcData(svc);
  const k = activeProfile(svc)?.id || '_';
  d.data[k] ||= { fav: [], recent: [] };
  return d.data[k];
}
// only what a library row needs (no cast, no overview)
const lite = (e) => ({ id: e.id, type: e.type, title: e.title, year: e.year || '', poster: e.poster || '', backdrop: e.backdrop || '', tmdb: e.tmdb || null, itemId: e.itemId || e.id, at: Date.now() });
const same = (a, b) => String(a.id) === String(b.id);
export const favourites = (svc) => bucket(svc).fav.slice();
export const recents = (svc) => bucket(svc).recent.slice();
export const isFavourite = (svc, e) => bucket(svc).fav.some((x) => same(x, e));
export function toggleFavourite(svc, e) {
  const b = bucket(svc);
  const on = b.fav.some((x) => same(x, e));
  b.fav = on ? b.fav.filter((x) => !same(x, e)) : [lite(e), ...b.fav].slice(0, MAX_FAV);
  save(svc);
  return !on;
}
export function pushRecent(svc, e) {
  if (!e?.id) return;
  const b = bucket(svc);
  b.recent = [lite(e), ...b.recent.filter((x) => !same(x, e))].slice(0, MAX_RECENT);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}   // quiet: no repaint needed
}
export function clearRecents(svc) { bucket(svc).recent = []; save(svc); }
