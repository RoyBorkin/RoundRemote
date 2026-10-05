// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Which TV apps the remote shows, in which order, plus the apps you add yourself — one list shared by every
// TV remote (Google TV through the bridge, Home Assistant, the TV Remote app; settings key 'tvApps').
// Also: opening an app on the selected TV (each path's own way) and the app icons (the bridge's Google Play copy).
//   tvApps = { shown: [id…] (in order), custom: [{ id: 'c:<package>', name, pkg, link?, icon?, color }] }
import { store } from './store.js';
import { lanImage, isMixed } from './util.js';
import { TV_APP_CATALOG, TV_APPS_DEFAULT, catalogApp, appFromActivity, catalogAppByName, isPackage, colorFor } from './tv-apps.js';
import { directLaunch, directZones } from './tvapp.js';
import { bridgeBase, bridgeFetch, bridgeZones, mayProbe } from '../providers/bridge.js';

const KEY = 'tvApps';
const prefs = () => store.get(KEY) || {};
const save = (p) => store.set(KEY, { ...prefs(), ...p });

/** Apps you added yourself (by package name). */
export const customApps = () => (prefs().custom || []).filter((a) => a?.id && a.name).map((a) => ({ cat: 'custom', region: 'custom', color: colorFor(a.pkg || a.name), ...a, custom: true }));
/** Every app you can pick: the catalog + your own. */
export const allApps = () => [...TV_APP_CATALOG, ...customApps()];
export function appById(id) { return customApps().find((a) => a.id === id) || catalogApp(id); }
/** The ids shown on the remote, in order. */
export function shownIds() {
  const ids = Array.isArray(prefs().shown) ? prefs().shown : TV_APPS_DEFAULT;
  return ids.filter((id, i) => ids.indexOf(id) === i && appById(id));
}
export const shownApps = () => shownIds().map(appById);
export const isShown = (id) => shownIds().includes(id);
export const isCustomised = () => Array.isArray(prefs().shown) || !!prefs().custom?.length;

export function setShown(ids) { save({ shown: [...new Set(ids)].filter((id) => appById(id)) }); }
export function showApp(id, on = true) {
  const ids = shownIds().filter((x) => x !== id);
  setShown(on ? [...ids, id] : ids);
}
/** Move a shown app by `delta` places (−1 = earlier). */
export function moveApp(id, delta) {
  const ids = shownIds();
  const i = ids.indexOf(id);
  const j = Math.max(0, Math.min(ids.length - 1, i + delta));
  if (i < 0 || i === j) return false;
  ids.splice(j, 0, ids.splice(i, 1)[0]);
  setShown(ids);
  return true;
}
/** Add (or update) an app by package name; it's shown at the end. Returns the app, or throws with userMessage. */
export function addCustom({ name, pkg, link = '', icon = '' }) {
  pkg = String(pkg || '').trim(); name = String(name || '').trim(); link = String(link || '').trim(); icon = String(icon || '').trim();
  const err = (m) => Object.assign(new Error(m), { userMessage: m });
  if (!isPackage(pkg)) throw err('The package name looks like com.example.app — find it in the app’s Google Play address (…details?id=…)');
  if (link && !/^[a-z][\w+.-]*:\/?\/?\S+$/i.test(link)) throw err('The link should look like https://… or app://…');
  if (icon && !/^(https?:)?\/\//i.test(icon) && !/^data:image\//.test(icon)) throw err('The icon should be an image address (https://…)');
  const known = catalogApp(pkg);
  if (known && !link && !icon) { showApp(known.id); return known; }   // it's in the list already: just show it
  const app = { id: `c:${pkg}`, name: name || known?.name || pkg.split('.').pop(), pkg, ...(link ? { link } : {}), ...(icon ? { icon } : {}), color: known?.color || colorFor(pkg) };
  const custom = (prefs().custom || []).filter((a) => a.id !== app.id);
  save({ custom: [...custom, app], shown: [...shownIds().filter((x) => x !== app.id), app.id] });
  return app;
}
/** Change an app you added (name, link, icon address) — it keeps its place on the remote. */
export function updateCustom(id, { name, link, icon } = {}) {
  const cur = (prefs().custom || []).find((a) => a.id === id);
  if (!cur) throw Object.assign(new Error('gone'), { userMessage: 'That app isn’t in your list any more' });
  const next = { ...cur };
  if (name != null) next.name = String(name).trim() || cur.name;
  for (const [k, v] of [['link', link], ['icon', icon]]) {
    if (v == null) continue;
    const t = String(v).trim();
    if (k === 'link' && t && !/^[a-z][\w+.-]*:\/?\/?\S+$/i.test(t)) throw Object.assign(new Error('bad link'), { userMessage: 'The link should look like https://… or app://…' });
    if (k === 'icon' && t && !/^(https?:)?\/\//i.test(t) && !/^data:image\//.test(t)) throw Object.assign(new Error('bad icon'), { userMessage: 'The icon should be an image address (https://…)' });
    if (t) next[k] = t; else delete next[k];
  }
  save({ custom: (prefs().custom || []).map((a) => (a.id === id ? next : a)) });
  return next;
}
export function removeCustom(id) {
  save({ custom: (prefs().custom || []).filter((a) => a.id !== id), shown: shownIds().filter((x) => x !== id) });
}
/** Back to the built-in selection (your own apps are kept, hidden). */
export function resetApps() { const p = prefs(); store.set(KEY, { custom: p.custom || [] }); }

// ---------------------------------------------------------------- what the TV says
/** { current: the open app (catalog / custom app) or null, installed: Set of app ids the TV path knows about, or null } */
export function tvAppState(zone) {
  if (!zone) return { current: null, installed: null };
  const byPkg = (p) => (p ? allApps().find((a) => a.pkg && a.pkg.toLowerCase() === String(p).split('/')[0].toLowerCase()) || appFromActivity(p) : null);
  const curPkg = zone.appId || (zone.adapter === 'androidtv' && !zone.direct ? zone.state?.track?.id : '') || '';
  const current = byPkg(curPkg) || (zone.sourceApp ? catalogAppByName(zone.sourceApp) : null);
  let installed = null;
  if (Array.isArray(zone.activities) && zone.activities.length) {   // Home Assistant: the apps set up in its options
    installed = new Set(zone.activities.map((x) => (byPkg(x) || catalogAppByName(x))?.id).filter(Boolean));
  }
  return { current, installed };
}

// ---------------------------------------------------------------- open an app
const fail = (m) => Object.assign(new Error(m), { userMessage: m });
/** Open `app` (catalog or custom) on the TV behind `zone`. */
export async function launchTvApp(zone, app) {
  if (!zone) throw fail('Pick a TV in Devices first');
  if (!app) throw fail('Unknown app');
  if (zone.direct) return directLaunch(zone, app);   // Home Assistant / the TV Remote app (js/core/tvapp.js)
  if (zone.adapter === 'androidtv') {
    if (app.key) return bridgeFetch('/api/adapters/androidtv/key', { method: 'POST', json: { id: zone.id, key: app.key } });
    return bridgeFetch('/api/adapters/androidtv/app', { method: 'POST', json: { id: zone.id, link: app.link || '', pkg: app.pkg || '' } });
  }
  throw fail(`${zone.name || 'This device'} can’t open Android apps`);
}

// ---------------------------------------------------------------- icons
// The bridge fetches each app's real icon from Google Play once a week (bridge/lib/tvapps.js). Without a bridge
// (the GitHub Pages app on a phone) the tile shows the Simple Icons logo, else the brand colour and initials.
let baseP = null;
function iconBase() {
  if (!baseP) baseP = (mayProbe() ? bridgeBase().catch(() => null) : Promise.resolve(null)).then((b) => { if (!b) setTimeout(() => { baseP = null; }, 60000); return b; });
  return baseP;
}
const urls = new Map();   // package → Promise<url | null>
/** A displayable URL for the app's real icon (a custom icon, else the bridge's copy), or null. */
export function appIconUrl(app) {
  if (app?.icon) return Promise.resolve(app.icon);
  const pkg = app?.pkg;
  if (!pkg || app.system) return Promise.resolve(null);
  if (!urls.has(pkg)) {
    urls.set(pkg, (async () => {
      const base = await iconBase();
      if (!base) { urls.delete(pkg); return null; }
      const u = `${base}/api/tvapps/icon/${encodeURIComponent(pkg)}`;
      return isMixed(u) ? (await lanImage(u)) || null : u;   // https page + http bridge: fetched with Local Network Access
    })());
  }
  return urls.get(pkg);
}

// ---------------------------------------------------------------- finding apps to add
/** Is there a bridge to search Google Play with? (its address, or null — the GitHub Pages app without one) */
export const searchBase = () => iconBase();
/**
 * Search Google Play through the bridge (bridge/lib/tvapps.js): a name, a Play Store link or a package name.
 * → { results: [{ pkg, name, dev, icon }], from: 'search' | 'details' }. Throws with userMessage.
 */
export async function searchPlay(q) {
  const base = await iconBase();
  if (!base) throw Object.assign(new Error('no bridge'), { userMessage: 'Searching Google Play needs the bridge', noBridge: true });
  try { return await bridgeFetch(`/api/tvapps/search?q=${encodeURIComponent(q)}`, { timeout: 20000 }); }
  catch (e) { throw Object.assign(e, { userMessage: e.body?.error || 'Couldn’t search Google Play — try again, or enter the package name' }); }
}
/** A package name from what was typed: the package itself, or a Play Store link (…details?id=<package>). */
export function packageFrom(q) {
  const s = String(q || '').trim();
  const m = s.match(/[?&]id=([A-Za-z][\w.]*)/);
  if (m && isPackage(m[1])) return m[1];
  return isPackage(s) && !/^(www\.|https?:)/i.test(s) && !/\.(com|net|org|io|co\.il)$/i.test(s) ? s : null;
}
/** The apps open on your TVs right now (that the TV reports by package): [{ pkg, name, tv, app (if known) }] */
export async function appsOpenNow(zone = null) {
  const zones = [...(zone ? [zone] : []), ...directZones()];
  if (await iconBase()) zones.push(...await Promise.race([bridgeZones((z) => z.adapter === 'androidtv'), new Promise((r) => setTimeout(() => r([]), 4000))]));
  const out = [];
  for (const z of zones) {
    if (z.adapter !== 'androidtv') continue;
    const pkg = String(z.appId || (!z.direct ? z.state?.track?.id : '') || '').split('/')[0];
    if (!isPackage(pkg) || out.some((x) => x.pkg === pkg)) continue;
    const known = allApps().find((a) => a.pkg && a.pkg.toLowerCase() === pkg.toLowerCase()) || null;
    out.push({ pkg, name: known?.name || z.sourceApp || pkg.split('.').pop(), tv: z.name, app: known });
  }
  return out;
}
