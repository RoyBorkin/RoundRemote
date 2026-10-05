// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Cider (https://cider.sh) — the Apple Music desktop app for Windows, macOS and Linux — through its
// local REST API (the same one the official CiderDeck Stream Deck plugin uses).
//
// This lets Round Remote control Apple Music without an Apple developer token: Cider plays the music
// on the computer (or on the Pi), and the round screen gets now-playing, artwork, play/pause, next/prev,
// seek, volume, shuffle, repeat, your library playlists and catalog search.
//
// Setup in Cider: Settings → Connectivity → enable the WebSocket/RPC API, then either create an app token
// under "Manage External Application Access" and put it in bridge/config.json → cider.token, or turn off
// "Require API tokens". Default address http://127.0.0.1:10767 (change cider.host / cider.port for Cider
// running on another computer).
import os from 'node:os';
import { log } from '../lib/util.js';

const REPEAT = ['off', 'one', 'all'];          // Cider/MusicKit repeatMode 0 / 1 / 2

export function create({ hub, cfg, setStatus }) {
  const c = { host: '127.0.0.1', port: 10767, token: '', pollMs: 1000, name: '', ...(cfg.cider || {}) };
  const base = `http://${c.host}:${c.port}`;
  const localId = 'cider';
  const zoneName = c.name || `Cider · ${c.host === '127.0.0.1' || c.host === 'localhost' ? os.hostname() : c.host}`;
  let timer = null, online = false, storefront = null, lastVol = null, volAt = 0, warned = false;

  async function api(method, path, body) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);
    try {
      const r = await fetch(`${base}${path}`, {
        method, signal: ac.signal,
        headers: { ...(c.token ? { apptoken: c.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Cider refused the app token'), { auth: true });
      if (!r.ok) throw new Error(`Cider HTTP ${r.status}`);
      const txt = await r.text();
      return txt ? JSON.parse(txt) : {};
    } finally { clearTimeout(t); }
  }
  const pb = (m, p, b) => api(m, `/api/v1/playback${p}`, b);
  // Apple Music API through Cider (uses Cider's own tokens) — response is the Apple Music JSON, sometimes wrapped
  async function amapi(path) {
    const r = await api('POST', '/api/v1/amapi/run-v3', { path });
    const d = r?.data && (r.data.data || r.data.results) ? r.data : r;
    return d;
  }
  const art = (a, size = 600) => (a?.url ? a.url.replace('{w}', size).replace('{h}', size).replace('{f}', 'jpg') : '');

  async function poll() {
    try {
      const np = await pb('GET', '/now-playing');
      const info = np?.info || np?.data?.info || null;
      const playing = await pb('GET', '/is-playing').then((r) => !!(r?.is_playing ?? r?.data?.is_playing)).catch(() => false);
      if (Date.now() - volAt > 3000) {
        volAt = Date.now();
        lastVol = await pb('GET', '/volume').then((r) => Math.round((r?.volume ?? r?.data?.volume ?? 0) * 100)).catch(() => lastVol);
      }
      if (!online) { online = true; warned = false; setStatus('running · connected to Cider'); log('cider', `connected to ${base}`); }
      hub.upsert('cider', localId, {
        name: zoneName, sourceApp: 'Apple Music',
        state: {
          track: info?.name ? {
            id: info.playParams?.id || info.url || info.name, title: info.name, artist: info.artistName || '', album: info.albumName || '',
            art: art(info.artwork), durationMs: info.durationInMillis || 0,
            year: parseInt(String(info.releaseDate || '').slice(0, 4), 10) || null,
          } : null,
          isPlaying: playing,
          progressMs: Math.round((info?.currentPlaybackTime || 0) * 1000),
          volume: lastVol,
          shuffle: info ? info.shuffleMode === 1 : null,
          repeat: info ? REPEAT[info.repeatMode] || 'off' : null,
        },
        caps: { seek: true, volume: true, next: true, prev: true, playlists: true, search: true, shuffle: true, repeat: true },
      });
    } catch (e) {
      if (online) { online = false; hub.remove('cider', localId); }
      const msg = e.auth ? 'Cider refused the token — check cider.token in config.json' : `waiting for Cider at ${base} (is it running with the API enabled?)`;
      setStatus(msg);
      if (!warned) { warned = true; log('cider', msg); }
    }
  }

  async function sf() {
    if (storefront) return storefront;
    try { const d = await amapi('/v1/me/storefront'); storefront = d?.data?.[0]?.id || 'us'; } catch { storefront = 'us'; }
    return storefront;
  }

  return {
    id: 'cider',
    async start() {
      let stopped = false;
      const loop = async () => { await poll(); if (!stopped) timer = setTimeout(loop, online ? c.pollMs : 5000); }; // slower while Cider is closed
      this.stop = () => { stopped = true; clearTimeout(timer); };
      await loop();
    },
    stop() { clearTimeout(timer); },
    async command(_id, cmd, value) {
      if (cmd === 'play') await pb('POST', '/play');
      else if (cmd === 'pause') await pb('POST', '/pause');
      else if (cmd === 'next') await pb('POST', '/next');
      else if (cmd === 'prev') await pb('POST', '/previous');
      else if (cmd === 'seek') await pb('POST', '/seek', { position: Math.max(0, value / 1000) });
      else if (cmd === 'volume') { lastVol = Math.round(value); await pb('POST', '/volume', { volume: Math.max(0, Math.min(1, value / 100)) }); }
      else if (cmd === 'shuffle') {
        const cur = await pb('GET', '/shuffle-mode').then((r) => (r?.value ?? r?.data?.value) === 1).catch(() => null);
        if (cur !== !!value) await pb('POST', '/toggle-shuffle');
      } else if (cmd === 'repeat') {
        // toggle-repeat cycles through the modes; step until we land on the wanted one
        for (let i = 0; i < 3; i++) {
          const cur = await pb('GET', '/repeat-mode').then((r) => REPEAT[r?.value ?? r?.data?.value] || 'off').catch(() => null);
          if (cur === null || cur === value) break;
          await pb('POST', '/toggle-repeat');
        }
      }
      setTimeout(poll, 250);
    },
    async playlists() {
      const d = await amapi('/v1/me/library/playlists?limit=100');
      return (d?.data || []).map((p) => ({
        kind: 'playlist', id: p.id, type: 'library-playlists', name: p.attributes?.name || 'Playlist',
        subtitle: p.attributes?.description?.standard ? p.attributes.description.standard.slice(0, 60) : 'Library playlist',
        art: art(p.attributes?.artwork, 300),
      }));
    },
    async search(_id, q) {
      const s = await sf();
      const d = await amapi(`/v1/catalog/${s}/search?term=${encodeURIComponent(q)}&types=songs,albums,playlists&limit=10`);
      const r = d?.results || {};
      const map = (arr, kind, type) => (arr?.data || []).map((x) => ({
        kind, id: x.id, type, title: x.attributes?.name, subtitle: x.attributes?.artistName || x.attributes?.curatorName || '', art: art(x.attributes?.artwork, 200),
      }));
      return [...map(r.songs, 'track', 'songs'), ...map(r.albums, 'album', 'albums'), ...map(r.playlists, 'playlist', 'playlists')];
    },
    async play(_id, item) {
      const type = item.type || (item.kind === 'track' ? 'songs' : item.kind === 'album' ? 'albums' : String(item.id).startsWith('p.') ? 'library-playlists' : 'playlists');
      await pb('POST', '/play-item', { item_type: type, id: String(item.id) });
      setTimeout(poll, 400);
    },
  };
}
