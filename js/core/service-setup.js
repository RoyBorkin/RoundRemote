// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Small sign-in / save helpers shared by the service setup screens (js/screens/connect.js) and setup from a phone
// or computer (js/core/remote-setup.js), so both store things exactly the same way.
import { store } from './store.js';
import { http } from './util.js';
import { provider } from '../providers/registry.js';
import { normHost } from '../providers/streamer.js';

/** "192.168.1.20:8096/" → "http://192.168.1.20:8096" */
export function normUrl(v) {
  let s = String(v || '').trim().replace(/\/+$/, '');
  if (s && !/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s;
}

/** Jellyfin: remember the server address (normalised); throws when empty. */
export function setJellyfinServer(v) {
  const s = normUrl(v);
  store.set('jellyfinServer', s);
  if (!s) throw new Error('Enter your server address first');
  return s;
}

/** Home Assistant: save the address + token (a blank token keeps the saved one) and test the connection. */
export async function connectHass(urlIn, token = '') {
  const p = provider('homeassistant');
  const url = normUrl(urlIn);
  if (!url) throw new Error('Enter the address of Home Assistant');
  const oldAuth = store.auth('homeassistant');
  store.set('haUrl', url);
  token = String(token || '').trim();
  if (token) p.saveToken(token);
  else if (oldAuth?.token) p.saveToken(oldAuth.token);
  else throw new Error('Paste a long-lived access token');
  return p.test();
}
export const hassMessage = (r) => `Connected to ${r.name} · ${r.count} entities${r.mode === 'rest' ? ' (through the bridge)' : ''}`;

/** Music streamer (StreamSDK): test the address and remember it. */
export async function connectStreamer(addr) {
  const p = provider('streamer');
  const host = normHost(addr);
  if (!host) throw new Error('Enter the streamer’s address, e.g. 192.168.50.156');
  const r = await p.test(host);
  p.saveHost(host, r);
  return r;
}

/** YouTube: save the Data API key / OAuth client ID; with a key, check it with one cheap request (1 quota unit). */
export async function saveYouTube({ apiKey, clientId } = {}) {
  if (typeof apiKey === 'string' && apiKey.trim()) store.set('youtubeApiKey', apiKey.trim());
  if (typeof clientId === 'string') store.set('googleClientId', clientId.trim());
  const key = (store.get('youtubeApiKey') || '').trim();
  if (!key) return { key: false };
  try {
    await http(`https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(key)}`, { timeout: 10000 });
    return { key: true, ok: true };
  } catch (e) {
    const msg = e.body?.error?.message || e.message || 'the key was refused';
    throw Object.assign(new Error(`YouTube didn’t accept the key: ${msg}`), { saved: true });
  }
}
