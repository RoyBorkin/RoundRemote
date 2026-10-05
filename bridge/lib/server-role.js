// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The bridge as a server in Docker (RR_ROLE=server, e.g. on a NAS): "is there a newer version?"
// A container is never updated in place (no git pull in an image) — a new image is pulled instead
// (Portainer → Stack → Pull and redeploy; TOS Container/Docker Manager → pull the image again and rebuild the project;
// or Watchtower). This compares the app's sw.js VERSION with the one on GitHub (main branch) — no sign-in, cached.
//   GET /api/system/update (server) → { mode:'docker', available:false, current, version, latest?, behind?, updateAvailable,
//                                         checkedAt?, error?, image?, howTo }
//   config.json → "update": { "url": "<raw sw.js URL>", "checkHours": 6 }   (env RR_UPDATE_URL overrides the url)
import { appVersion, bridgeVersion } from './paths.js';
import { log } from './util.js';

export const UPDATE_URL = 'https://raw.githubusercontent.com/RoyBorkin/RoundSpotify/main/sw.js';
export const HOW_TO = 'A new version is available — update the container: Portainer → Stacks → roundremote → Pull and redeploy (Re-pull image), or TOS Container/Docker Manager → pull ghcr.io/royborkin/roundremote:latest again and rebuild the project. Your data in /data stays.';
const HOW_TO_CURRENT = 'Updates come as a new container image (Portainer → Pull and redeploy, or TOS Container/Docker Manager → pull the image again).';

let cache = null;   // { at, latest, error }

/** "rr-5.10.2" → [5,10,2] */
const parts = (v) => (String(v || '').match(/\d+/g) || []).map(Number);
export function newer(a, b) {   // is a newer than b?
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}

async function fetchLatest(url) {
  const ctrl = AbortSignal.timeout(8000);
  const r = await fetch(url, { signal: ctrl, headers: { 'User-Agent': 'RoundRemote-bridge', Accept: 'text/plain' } });
  if (!r.ok) throw new Error(`GitHub answered HTTP ${r.status}`);
  const text = await r.text();
  const v = (text.match(/const VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  if (!v) throw new Error('no VERSION in the file on GitHub');
  return v;
}

/** The update state of this container. fetch:false never goes online (answers from the cache only). */
export async function dockerUpdate(cfg = {}, { fetch: online = true } = {}) {
  const current = appVersion();
  const url = process.env.RR_UPDATE_URL || cfg.update?.url || UPDATE_URL;
  const ttl = Math.max(0.05, +(cfg.update?.checkHours ?? 6)) * 3600e3;
  const fresh = cache && cache.url === url && Date.now() - cache.at < (cache.error ? Math.min(ttl, 10 * 60e3) : ttl);
  if (online && cfg.update?.check !== false && !fresh) {
    try { cache = { url, at: Date.now(), latest: await fetchLatest(url) }; }
    catch (e) { cache = { url, at: Date.now(), error: e.cause?.code || e.message }; log('update', `check failed: ${cache.error}`); }
  }
  const out = { mode: 'docker', available: false, current, version: bridgeVersion(), app: current,
    image: process.env.RR_IMAGE || 'ghcr.io/royborkin/roundremote:latest', updateAvailable: false, howTo: HOW_TO_CURRENT };
  if (cache?.url === url) {
    out.checkedAt = cache.at;
    if (cache.error) out.error = cache.error;
    if (cache.latest) {
      out.latest = cache.latest;
      out.updateAvailable = newer(cache.latest, current);
      out.behind = out.updateAvailable ? 1 : 0;
      if (out.updateAvailable) out.howTo = HOW_TO;
    }
  }
  return out;
}
/** For tests. */
export function _resetUpdateCache() { cache = null; }
