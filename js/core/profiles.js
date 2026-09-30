// Settings profiles: copy every setting of this round display to another one — as a file, or kept
// on the bridge (bridge/profiles/) so a new display on the same network can load it with one tap
// or straight from its start-up address (…/?profile=Living%20room).
import { store } from './store.js';
import { bridgeFetch } from '../providers/bridge.js';

const DEVICE_ONLY = ['bridgeKnown'];   // things that only make sense on this device

function signIns() {
  const out = {};
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('rr.auth.')) continue;
      try { out[k.slice(8)] = JSON.parse(localStorage.getItem(k)); } catch {}
    }
  } catch {}
  return out;
}

/** Everything needed to recreate this display's setup. */
export function buildProfile({ name = 'Round Remote', includeSignIns = false } = {}) {
  const settings = JSON.parse(JSON.stringify(store.s));
  DEVICE_ONLY.forEach((k) => delete settings[k]);
  const p = {
    app: 'round-remote', kind: 'settings-profile', version: 1, name,
    savedAt: new Date().toISOString(), device: `${navigator.platform || ''} ${screen.width}×${screen.height}`.trim(),
    settings,
  };
  if (includeSignIns) p.auth = signIns();
  return p;
}

export function isProfile(p) { return !!p && p.app === 'round-remote' && typeof p.settings === 'object'; }

/** Apply a profile to this display (keeps this display's bridge address when it has one). */
export function applyProfile(p, { keepBridge = true } = {}) {
  if (!isProfile(p)) throw new Error('This isn’t a Round Remote settings profile');
  const next = { ...p.settings };
  if (keepBridge && store.get('bridgeUrl')) next.bridgeUrl = store.get('bridgeUrl');
  store.replaceAll(next);
  if (p.auth) for (const [k, v] of Object.entries(p.auth)) store.setAuth(k, v);
  store.set('bridgeKnown', true);
}

// ---------- files ----------
export function downloadProfile(p) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `round-remote-${String(p.name || 'profile').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'profile'}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export function pickProfileFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try { resolve(JSON.parse(await f.text())); } catch { reject(new Error('That file isn’t a settings profile')); }
    };
    input.click();
  });
}

// ---------- on the bridge ----------
export const listBridgeProfiles = () => bridgeFetch('/api/profiles');
export const loadBridgeProfile = (name) => bridgeFetch(`/api/profiles/${encodeURIComponent(name)}`);
export const saveBridgeProfile = (name, p) => bridgeFetch(`/api/profiles/${encodeURIComponent(name)}`, { method: 'PUT', json: p });
export const deleteBridgeProfile = (name) => bridgeFetch(`/api/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' });
