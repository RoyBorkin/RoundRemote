// © 2026 Roy Borkin. All rights reserved. See LICENSE.
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

// ---------- videos (the YouTube service in Movies & TV) ----------
const isoMs = (d = '') => { const m = String(d).match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) * 1000 : 0; };
const bestThumb = (sn) => sn?.thumbnails?.maxres?.url || sn?.thumbnails?.standard?.url || sn?.thumbnails?.high?.url || thumb(sn);
const videoEntry = (id, sn) => ({
  id, type: 'video', title: decode(sn?.title || ''), subtitle: [decode(sn?.channelTitle || sn?.videoOwnerChannelTitle || ''), (sn?.publishedAt || '').slice(0, 4)].filter(Boolean).join(' · '),
  poster: thumb(sn), backdrop: bestThumb(sn), wide: true, year: parseInt((sn?.publishedAt || '').slice(0, 4), 10) || null,
});
export async function videoSearch(q, max = 25) {
  const d = await data('search', { part: 'snippet', type: 'video', q, maxResults: max });
  return (d?.items || []).map((it) => videoEntry(it.id.videoId, it.snippet));
}
export async function playlistVideos(pl) {
  if (pl.liked) {
    const d = await data('videos', { part: 'snippet', myRating: 'like', maxResults: 50 }, { auth: true });
    return (d?.items || []).map((v) => videoEntry(v.id, v.snippet));
  }
  const d = await data('playlistItems', { part: 'snippet,contentDetails', playlistId: pl.id, maxResults: 50 }, { auth: googleSignedIn() });
  return (d?.items || []).filter((v) => v.snippet?.title !== 'Private video').map((v) => videoEntry(v.contentDetails.videoId, v.snippet));
}
export async function videoDetails(id) {
  const d = await data('videos', { part: 'snippet,contentDetails,statistics', id });
  const v = d?.items?.[0];
  if (!v) throw Object.assign(new Error('not found'), { userMessage: 'Video not found' });
  const e = videoEntry(v.id, v.snippet);
  const views = +v.statistics?.viewCount || 0;
  return {
    ...e, summary: decode(v.snippet.description || '').slice(0, 900), durationMs: isoMs(v.contentDetails?.duration), studio: decode(v.snippet.channelTitle || ''),
    originallyAvailableAt: (v.snippet.publishedAt || '').slice(0, 10), genres: (v.snippet.tags || []).slice(0, 4),
    tagline: views ? `${views.toLocaleString()} views${v.statistics?.likeCount ? ` · ${(+v.statistics.likeCount).toLocaleString()} likes` : ''}` : '',
    backdrops: [e.backdrop], cast: [], directors: [], writers: [],
  };
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
const MV_KEY = 'rr.mv2.cache'; // v2: smarter picks (the v1 cache could hold static "audio" uploads)
function mvCache() { try { return JSON.parse(localStorage.getItem(MV_KEY) || '{}'); } catch { return {}; } }
function mvSave(c) {
  const keys = Object.keys(c);
  if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((k) => delete c[k]);
  try { localStorage.setItem(MV_KEY, JSON.stringify(c)); } catch {}
}
const pending = new Map();
const isoDur = (d = '') => { const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) : 0; };
// Kinds of video the user can ask for (Settings → Video → Video types). Each YouTube result is
// sorted into one kind from its title and channel; only the kinds the user picked are used.
export const VIDEO_KINDS = [
  { id: 'clip', name: 'Official clip', query: 'official music video' },
  { id: 'abstract', name: 'Abstract', query: 'official visualizer' },
  { id: 'live', name: 'Live', query: 'live performance' },
  { id: 'fan', name: 'Fan made', query: 'fan made music video' },
  { id: 'cover', name: 'Album cover', query: 'official audio' },
  { id: 'lyric', name: 'Lyric video', query: 'official lyric video' },
];
const K = {
  cover: /official audio|\(audio\)|\[audio\]|\baudio\b|album stream|provided to youtube|art track|full album/i,
  lyric: /lyric|lyrics|letra|paroles/i,
  abstract: /visuali[sz]er|abstract|animated video|official animation|\banimated\b|loop video|canvas/i,
  live: /\blive\b|concert|performance|session|tiny desk|unplugged|mtv|jimmy|fallon|kimmel|snl|glastonbury|coachella|festival|acoustic version/i,
  fan: /fan ?made|fan video|fanmade|\bamv\b|\bfmv\b|unofficial( music)? video|tribute|\bedit\b/i,
  clip: /official (music )?video|official mv|\bm\/?v\b|music video|official film|official clip|video oficial|clip officiel/i,
};
// never wanted, whatever the kind: other people's versions and gimmick uploads
const JUNK = /\bcover\b|karaoke|instrumental|\b8d\b|slowed|sped up|reverb|nightcore|bass boosted|1 hour|10 hours|\bhour loop|reaction|tutorial|how to play|lesson|mashup|remix|shorts?\b|#shorts|ringtone/i;
function kindOf(title, channel, artistNorm) {
  if (/ - topic$/i.test(channel)) return 'cover';                       // auto-generated: the album cover
  if (K.lyric.test(title)) return 'lyric';
  if (K.cover.test(title)) return 'cover';
  if (K.abstract.test(title)) return 'abstract';
  if (K.fan.test(title)) return 'fan';
  if (K.live.test(title)) return 'live';
  if (K.clip.test(title)) return 'clip';
  const own = /vevo/i.test(channel) || normalizeText(channel).replace(/\s/g, '').includes(artistNorm.replace(/\s/g, ''));
  return own ? 'clip' : 'fan';
}
const seeded = (arr, seed) => {
  const a = arr.slice(); let x = 0;
  for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = a.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) >>> 0; const j = x % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * Finds a video for the track of one of the kinds the user picked (see VIDEO_KINDS).
 * With several kinds picked, each song tries them in its own (repeatable) order, so a playlist
 * mixes official clips, live shows, visualizers… Covers by other artists, karaoke, remixes, loops,
 * shorts and anything far longer or shorter than the song are always skipped.
 */
export async function findMusicVideo(track, { kinds = ['clip', 'live'], preferClip = false } = {}) {
  if (!track?.title || track.notSong) return null;
  const want = normalizeText(track.title);
  const artist = (track.artist || '').split(/,|&| feat\.? | ft\.? /i)[0].trim();
  const artistNorm = normalizeText(artist);
  const picked = VIDEO_KINDS.map((k) => k.id).filter((id) => kinds.includes(id));
  if (!picked.length) picked.push('clip');
  const key = `${preferClip ? 'pc|' : ''}${picked.join(',')}|${artistNorm}|${want}`;
  const cache = mvCache();
  if (key in cache) return cache[key];
  if (!canSearch()) return null;
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    const wantsRemix = /remix|mix\b/i.test(track.title);
    const songSec = (track.durationMs || 0) / 1000;
    const tried = new Map(); // videoId → { it, kind, score }
    // "Prefer official clip": try the official clip first, then the picked types in this song's order
    let order = seeded(picked, `${artistNorm}|${want}`);
    if (preferClip) order = ['clip', ...order.filter((k) => k !== 'clip')];
    for (const kindId of order) {
      const kind = VIDEO_KINDS.find((k) => k.id === kindId);
      const d = await data('search', { part: 'snippet', type: 'video', maxResults: 12, videoEmbeddable: 'true', videoSyndicated: 'true', q: `${artist} ${track.title} ${kind.query}` });
      const items = (d?.items || []).filter((it) => it.id?.videoId && !tried.has(it.id.videoId));
      if (items.length) {
        let details = {};
        try {
          const v = await data('videos', { part: 'contentDetails,statistics', id: items.map((it) => it.id.videoId).join(',') });
          for (const it of v?.items || []) details[it.id] = { sec: isoDur(it.contentDetails?.duration), views: +it.statistics?.viewCount || 0 };
        } catch {}
        for (const it of items) {
          const title = decode(it.snippet.title), ch = decode(it.snippet.channelTitle || '');
          const det = details[it.id.videoId] || {};
          const k = kindOf(title, ch, artistNorm);
          let sc = 0;
          if (normalizeText(title).includes(want) || (k === 'cover' && / - topic$/i.test(ch))) sc += 5; else sc -= 6;
          if (JUNK.test(title) && !(wantsRemix && /remix/i.test(title))) sc -= 20;
          if (/vevo/i.test(ch)) sc += 3;
          if (normalizeText(ch).includes(artistNorm)) sc += 2;
          if (det.sec) {
            if (det.sec < 60 || det.sec > 15 * 60) sc -= 12;
            else if (songSec && Math.abs(det.sec - songSec) < Math.max(40, songSec * (k === 'live' ? 0.6 : 0.35))) sc += 2;
          }
          if (det.views) sc += Math.min(3, Math.max(0, Math.log10(det.views) - 4));
          tried.set(it.id.videoId, { it, kind: k, score: sc });
        }
      }
      // best video of the kind we're on; accept it if it's a good match
      const best = [...tried.values()].filter((c) => c.kind === kindId).sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 5) {
        const c = mvCache(); c[key] = best.it.id.videoId; mvSave(c);
        return best.it.id.videoId;
      }
    }
    // nothing great for the first choices: take the best of any picked kind we saw
    const any = [...tried.values()].filter((c) => order.includes(c.kind)).sort((a, b) => b.score - a.score)[0];
    const id = any && any.score >= 4 ? any.it.id.videoId : null;
    const c = mvCache(); c[key] = id; mvSave(c);
    return id;
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
