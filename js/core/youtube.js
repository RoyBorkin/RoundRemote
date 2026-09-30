// Shared YouTube plumbing: IFrame player API loader, YouTube Data API v3 (search, your
// playlists), optional Google sign-in (for your playlists), and the music-video finder used
// by the Video view for every other service.
import { store } from './store.js';
import { http, qs, normalizeText } from './util.js';

const DATA = 'https://www.googleapis.com/youtube/v3/';
const GIS = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

// ---------------------------------------------------------------- script loaders
let iframeApi = null;
export function loadIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (iframeApi) return iframeApi;
  iframeApi = new Promise((resolve, reject) => {
    const t = setTimeout(() => { iframeApi = null; reject(new Error('YouTube player failed to load (offline?)')); }, 15000);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { clearTimeout(t); prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = () => { clearTimeout(t); iframeApi = null; reject(new Error('YouTube player failed to load')); };
    document.head.appendChild(s);
  });
  return iframeApi;
}
let gisP = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisP) return gisP;
  gisP = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisP = null; reject(new Error('Google sign-in failed to load')); };
    document.head.appendChild(s);
  });
  return gisP;
}

// ---------------------------------------------------------------- keys & sign-in
export const apiKey = () => (store.get('youtubeApiKey') || '').trim();
export const googleClientId = () => (store.get('googleClientId') || '').trim();
export function googleToken() {
  const a = store.auth('google');
  return a?.token && Date.now() < a.expiresAt - 60000 ? a.token : null;
}
export const googleSignedIn = () => !!store.auth('google')?.token;
export const canSearch = () => !!(apiKey() || googleToken());

/** Google sign-in (popup). Tokens last an hour; calling again later refreshes silently if possible. */
export async function googleSignIn({ silent = false } = {}) {
  const client_id = googleClientId();
  if (!client_id) throw Object.assign(new Error('no client id'), { userMessage: 'Add your Google OAuth Client ID in Settings first' });
  await loadGis();
  return new Promise((resolve, reject) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id, scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(Object.assign(new Error(r.error), { userMessage: `Google sign-in: ${r.error_description || r.error}` }));
        store.setAuth('google', { token: r.access_token, expiresAt: Date.now() + (r.expires_in || 3600) * 1000 });
        resolve(r.access_token);
      },
      error_callback: (e) => reject(Object.assign(new Error(e?.type || 'popup'), { userMessage: 'Google sign-in was closed or blocked' })),
    });
    tc.requestAccessToken({ prompt: silent ? '' : 'consent' });
  });
}
export function googleSignOut() {
  const t = store.auth('google')?.token;
  try { if (t) window.google?.accounts?.oauth2?.revoke(t, () => {}); } catch {}
  store.setAuth('google', null);
}

async function data(path, params = {}, { auth = false } = {}) {
  let token = googleToken();
  if (auth && !token) token = await googleSignIn({ silent: true });
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (apiKey()) params = { ...params, key: apiKey() };
  else throw Object.assign(new Error('no key'), { userMessage: 'Add a YouTube Data API key in Settings (or sign in with Google)' });
  try {
    return await http(`${DATA}${path}?${qs(params)}`, { headers });
  } catch (e) {
    const reason = e.body?.error?.errors?.[0]?.reason || e.body?.error?.status || '';
    if (/quota/i.test(reason)) throw Object.assign(e, { userMessage: 'YouTube API daily quota used up — try again tomorrow' });
    if (e.status === 401) { store.setAuth('google', null); throw Object.assign(e, { userMessage: 'Google sign-in expired — sign in again' }); }
    throw Object.assign(e, { userMessage: `YouTube: ${e.body?.error?.message || e.message}` });
  }
}

// ---------------------------------------------------------------- helpers
const thumb = (sn) => sn?.thumbnails?.high?.url || sn?.thumbnails?.medium?.url || sn?.thumbnails?.default?.url || '';
export const bigThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** "Artist - Title (Official Video)" → { artist, title } */
export function splitTitle(raw = '', channel = '') {
  const clean = decode(raw)
    .replace(/\s*[\(\[][^)\]]*(official|video|audio|lyrics?|visuali[sz]er|remaster(ed)?|hd|4k|mv|m\/v)[^)\]]*[\)\]]/gi, '')
    .replace(/\s*\|.*$/, '').trim();
  const ch = decode(channel).replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const m = clean.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: ch, title: clean };
}

export async function search(q, { music = false, max = 15 } = {}) {
  const [vids, lists] = await Promise.all([
    data('search', { part: 'snippet', type: 'video', q, maxResults: max, videoEmbeddable: 'true', videoSyndicated: 'true', ...(music ? { videoCategoryId: 10 } : {}) }),
    data('search', { part: 'snippet', type: 'playlist', q, maxResults: 4 }).catch(() => null),
  ]);
  const tracks = (vids?.items || []).map((it) => {
    const { artist, title } = splitTitle(it.snippet.title, it.snippet.channelTitle);
    return { kind: 'track', id: it.id.videoId, title, subtitle: artist || decode(it.snippet.channelTitle), art: thumb(it.snippet), artist };
  });
  const pls = (lists?.items || []).map((it) => ({ kind: 'playlist', id: it.id.playlistId, title: decode(it.snippet.title), subtitle: `Playlist · ${decode(it.snippet.channelTitle)}`, art: thumb(it.snippet) }));
  return [...tracks, ...pls];
}

export async function myPlaylists() {
  const d = await data('playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: 50 }, { auth: true });
  return [
    { id: 'liked', name: 'Liked videos', subtitle: 'Your likes', mono: '♥', liked: true },
    ...(d?.items || []).map((p) => ({ id: p.id, name: decode(p.snippet.title), subtitle: `${p.contentDetails?.itemCount ?? ''} videos`, art: thumb(p.snippet) })),
  ];
}
export async function playlistVideoIds(pl) {
  if (pl.liked) {
    const d = await data('videos', { part: 'id', myRating: 'like', maxResults: 50 }, { auth: true });
    return (d?.items || []).map((v) => v.id);
  }
  const d = await data('playlistItems', { part: 'contentDetails', playlistId: pl.id, maxResults: 50 }, { auth: googleSignedIn() });
  return (d?.items || []).map((v) => v.contentDetails.videoId);
}

// ---------------------------------------------------------------- music-video finder
const MV_KEY = 'rr.mv.cache';
function mvCache() { try { return JSON.parse(localStorage.getItem(MV_KEY) || '{}'); } catch { return {}; } }
function mvSave(c) {
  const keys = Object.keys(c);
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete c[k];
  try { localStorage.setItem(MV_KEY, JSON.stringify(c)); } catch {}
}
const pending = new Map();

/** Find the official music video for a track (cached). Returns a YouTube video id or null. */
export async function findMusicVideo(track) {
  if (!track?.title) return null;
  const key = `${normalizeText(track.artist)}|${normalizeText(track.title)}`;
  const cache = mvCache();
  if (key in cache) return cache[key];
  if (!canSearch()) return null;
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    const artist = (track.artist || '').split(/,|&| feat\.? | ft\.? /i)[0].trim();
    const d = await data('search', {
      part: 'snippet', type: 'video', maxResults: 6, videoEmbeddable: 'true', videoSyndicated: 'true', videoCategoryId: 10,
      q: `${artist} ${track.title} official music video`,
    });
    const want = normalizeText(track.title);
    const items = d?.items || [];
    const score = (it) => {
      const t = normalizeText(decode(it.snippet.title));
      let s = 0;
      if (t.includes(want)) s += 5;
      if (/official (music )?video|\bmv\b/i.test(it.snippet.title)) s += 3;
      if (/vevo/i.test(it.snippet.channelTitle)) s += 2;
      if (normalizeText(it.snippet.channelTitle).includes(normalizeText(artist))) s += 2;
      if (/lyric|audio|cover|live|reaction|karaoke|8d|slowed|sped/i.test(it.snippet.title)) s -= 4;
      return s;
    };
    const best = items.map((it) => ({ it, s: score(it) })).sort((a, b) => b.s - a.s)[0];
    const id = best && best.s >= 3 ? best.it.id.videoId : null;
    const c = mvCache(); c[key] = id; mvSave(c);
    return id;
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
