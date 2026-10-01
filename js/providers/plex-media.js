// Plex for movies & shows: remote-controls Plex video players (Plex on a TV, Plex HTPC, Plex for
// Android/Google TV, Apple TV, Roku…) through your Plex Media Server, and browses your libraries.
// Shares the Plex sign-in with the music Plex tile.
//
// Media providers add to the normal Provider interface (see README → "Movies & shows"):
//   libraryRoot() / browse(node) / searchMedia(q)  → { title, items:[entry], more }
//   details(entry)  → full info (summary, cast, seasons/episodes, collections, streams…)
//   related(entry)  → "more like this" from the library
//   collectionsFor(details) → [{ id, title, items:[entry] }]
//   playMedia(entry, { fromStart })  · adjacent(±1) → previous / next episode
//   stopPlayback() · streams() / setStream(kind, id) · markWatched(entry, on) · slideImages(details)
// An entry is { id, type: movie|show|season|episode|collection|folder, title, subtitle, poster, backdrop,
//   year, watched, progress (0…1), node (for folders) }.
import { PlexProvider } from './plex.js';
import { store } from '../core/store.js';
import { qs } from '../core/util.js';
import { positionOf } from './base.js';

const VIDEO = ['movie', 'episode', 'clip'];
const LIB_TYPES = ['movie', 'show'];
const PAGE = 60;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const runtime = (ms) => { const m = Math.round((ms || 0) / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : m ? `${m}m` : ''; };

export class PlexMediaProvider extends PlexProvider {
  constructor(meta) {
    super(meta);
    this.ctype = 'video';
    Object.assign(this.caps, { playlists: false, search: false, shuffle: false, repeat: false, library: true, skip: true, stop: true, tracks: true, details: true, adjacent: true });
    this.cache = new Map();
  }

  // ---------- images ----------
  _img(path, w, hgt) {
    if (!path || !this.server) return '';
    if (/^https?:/.test(path) && !path.includes(this.server.uri)) return path; // people photos from metadata.plex.tv
    return this._urlSync(`${this.server.uri}/photo/:/transcode?${qs({ width: w, height: hgt, minSize: 1, upscale: 1, url: path, 'X-Plex-Token': this.server.token })}`);
  }
  _poster(p) { return this._img(p, 400, 600); }
  _backdrop(p) { return this._img(p, 1280, 720); }
  async _cached(key, fn, ms = 5 * 60000) {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < ms) return c.v;
    const v = await fn();
    this.cache.set(key, { v, at: Date.now() });
    return v;
  }

  // ---------- now playing ----------
  async _sessions() {
    const d = await this.pms('/status/sessions');
    return (d?.MediaContainer?.Metadata || []).filter((m) => VIDEO.includes(m.type));
  }
  async refresh() {
    if (!this.server) await this._connectServer();
    const sessions = await this._sessions();
    this.sessionsCache = sessions;
    const m = this._pick(sessions);
    const wantId = store.getZone(this.id);
    this.playerId = m?.Player?.machineIdentifier || wantId || null;
    if (this.playerId && this.tick++ % 2 === 0) this._pollTimeline().catch(() => {});
    if (this.tick % 15 === 1) this.pms('/clients').then((d) => { this.clientsCache = d?.MediaContainer?.Server || []; }).catch(() => {});
    if (!m) {
      this.publish({ track: null, isPlaying: false, status: 'nodevice', device: this.playerId ? { id: this.playerId, name: this._playerName(this.playerId) } : null,
        message: this.playerId ? 'Nothing playing — pick something in Library' : 'Start a Plex app on your TV (or pick a player in Devices)' });
      return;
    }
    const ep = m.type === 'episode';
    const media = {
      type: m.type, itemId: m.ratingKey, title: m.title, show: ep ? m.grandparentTitle : '',
      season: ep ? m.parentIndex : null, episode: ep ? m.index : null, year: m.year || m.parentYear || null,
      summary: m.summary || '', contentRating: m.contentRating || '', rating: m.audienceRating || m.rating || null,
      poster: this._poster(ep ? m.grandparentThumb || m.parentThumb : m.thumb),
      still: ep ? this._backdrop(m.thumb) : '',
      backdrop: this._backdrop(m.art || m.grandparentArt || m.thumb),
      seriesId: ep ? m.grandparentRatingKey : null, seasonId: ep ? m.parentRatingKey : null,
      sectionId: m.librarySectionID,
    };
    const tl = this.timeline;
    this.publish({
      track: {
        id: m.ratingKey, title: ep ? m.grandparentTitle : m.title,
        artist: ep ? `S${m.parentIndex ?? '?'} · E${m.index ?? '?'} · ${m.title}` : [m.year, m.contentRating].filter(Boolean).join(' · '),
        album: '', durationMs: m.duration || 0, art: media.poster, year: media.year, notSong: true, media,
      },
      isPlaying: m.Player?.state === 'playing' || m.Player?.state === 'buffering',
      progressMs: m.viewOffset || 0,
      volume: tl.volume ?? null,
      device: { id: m.Player?.machineIdentifier, name: m.Player?.title || 'Plex player', type: m.Player?.product },
      status: 'ok', message: '',
    });
  }
  async getDevices() {
    const list = await super.getDevices();
    return list.filter((d) => !/plexamp/i.test(d.type || ''));
  }

  // ---------- transport extras ----------
  async next() { return this.adjacent(1); }
  async prev() { return this.adjacent(-1); }
  async adjacent(dir) {
    const cur = this.state.track?.media;
    if (cur?.type !== 'episode' || !cur.seriesId) return this._player(dir > 0 ? 'playback/skipNext' : 'playback/skipPrevious');
    const eps = await this._leaves(cur.seriesId);
    const i = eps.findIndex((e) => String(e.id) === String(cur.itemId));
    const target = eps[i + dir];
    if (!target) throw Object.assign(new Error('none'), { userMessage: dir > 0 ? 'This is the last episode' : 'This is the first episode' });
    return this.playMedia(target, { fromStart: true });
  }
  async _leaves(showId) {
    return this._cached(`leaves|${showId}`, async () => {
      const d = await this.pms(`/library/metadata/${showId}/allLeaves`);
      return (d?.MediaContainer?.Metadata || []).map((x) => this._entry(x));
    }, 60000);
  }
  stopPlayback() { return this._player('playback/stop'); }
  /** Intro / credits / ad markers Plex found for this item (the same ones the TV's "Skip intro" uses). */
  async markers(id) {
    if (!id) return [];
    return this._cached(`markers|${id}`, async () => {
      const d = await this.pms(`/library/metadata/${id}?${qs({ includeMarkers: 1 })}`);
      const m = d?.MediaContainer?.Metadata?.[0];
      const kind = { intro: 'intro', credits: 'credits', commercial: 'ad' };
      return (m?.Marker || []).filter((x) => kind[x.type]).map((x) => ({
        kind: kind[x.type], startMs: +x.startTimeOffset || 0, endMs: +x.endTimeOffset || 0, final: x.final === true || x.final === 1 || x.final === '1',
      })).filter((x) => x.endMs > x.startMs);
    }, 10 * 60000);
  }

  // ---------- library ----------
  _entry(x) {
    const t = x.type;
    const sub = t === 'movie' ? [x.year, runtime(x.duration)].filter(Boolean).join(' · ')
      : t === 'show' ? [x.year, x.childCount ? plural(x.childCount, 'season') : ''].filter(Boolean).join(' · ')
      : t === 'season' ? (x.leafCount ? plural(x.leafCount, 'episode') : x.parentTitle || '')
      : t === 'episode' ? `${x.grandparentTitle ? x.grandparentTitle + ' · ' : ''}S${x.parentIndex ?? '?'} · E${x.index ?? '?'}`
      : t === 'collection' ? plural(+x.childCount || 0, 'item')
      : x.year || '';
    const watched = t === 'show' || t === 'season' ? x.leafCount > 0 && x.viewedLeafCount === x.leafCount : (x.viewCount || 0) > 0;
    return {
      id: x.ratingKey, type: t, title: t === 'season' && x.parentTitle && !x.title ? `Season ${x.index}` : x.title, subtitle: sub,
      poster: this._poster(t === 'episode' ? x.thumb || x.parentThumb || x.grandparentThumb : x.thumb || x.parentThumb || x.grandparentThumb),
      wide: t === 'episode', backdrop: this._backdrop(x.art || x.grandparentArt),
      year: x.year || null, watched, progress: x.viewOffset && x.duration ? x.viewOffset / x.duration : 0,
      viewOffset: x.viewOffset || 0, index: x.index, parentIndex: x.parentIndex, showId: x.grandparentRatingKey || (t === 'season' ? x.parentRatingKey : null),
      sectionId: x.librarySectionID,
    };
  }
  async libraryRoot() {
    const d = await this.pms('/library/sections');
    const libs = (d?.MediaContainer?.Directory || []).filter((x) => LIB_TYPES.includes(x.type));
    return {
      title: this.server?.name || 'Plex',
      items: [
        { id: 'continue', type: 'folder', title: 'Continue watching', subtitle: 'Pick up where you left off', icon: 'play', node: { kind: 'continue' } },
        ...libs.map((l) => ({ id: `lib-${l.key}`, type: 'folder', title: l.title, subtitle: l.type === 'movie' ? 'Movies' : 'TV shows', icon: l.type === 'movie' ? 'film' : 'tv', node: { kind: 'library', id: l.key, libType: l.type, title: l.title } })),
      ],
    };
  }
  async browse(node, { start = 0 } = {}) {
    const mc = (d) => d?.MediaContainer || {};
    const page = `X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE}`;
    const hideWatched = !!store.get('mediaHideWatched');
    if (node.kind === 'root') return this.libraryRoot();
    if (node.kind === 'continue') {
      let d = await this.pms('/hubs/continueWatching/items').catch(() => null);
      if (!mc(d).Metadata) d = await this.pms('/library/onDeck');
      return { title: 'Continue watching', items: (mc(d).Metadata || []).map((x) => this._entry(x)) };
    }
    if (node.kind === 'library') {
      const unw = hideWatched ? (node.libType === 'movie' ? '&unwatched=1' : '&unwatchedLeaves=1') : '';
      const d = await this.pms(`/library/sections/${node.id}/all?sort=titleSort&${page}${unw}`);
      const items = (mc(d).Metadata || []).map((x) => this._entry(x));
      const total = +mc(d).totalSize || 0;
      const extra = start ? [] : [
        { id: `rec-${node.id}`, type: 'folder', title: 'Recently added', icon: 'clock', node: { kind: 'recent', id: node.id } },
        { id: `col-${node.id}`, type: 'folder', title: 'Collections', icon: 'stack', node: { kind: 'collections', id: node.id } },
      ];
      return { title: node.title || 'Library', items: [...extra, ...items], more: total > start + PAGE };
    }
    if (node.kind === 'recent') {
      const d = await this.pms(`/library/sections/${node.id}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=40`);
      return { title: 'Recently added', items: (mc(d).Metadata || []).map((x) => this._entry(x)) };
    }
    if (node.kind === 'collections') {
      const d = await this.pms(`/library/sections/${node.id}/collections?${page}`);
      return { title: 'Collections', items: (mc(d).Metadata || []).map((x) => this._entry({ ...x, type: 'collection' })), more: (+mc(d).totalSize || 0) > start + PAGE };
    }
    if (node.kind === 'children') {
      const path = node.type === 'collection' ? `/library/collections/${node.id}/children` : `/library/metadata/${node.id}/children`;
      const d = await this.pms(`${path}?${page}`);
      return { title: node.title || '', items: (mc(d).Metadata || []).map((x) => this._entry(x)), more: (+mc(d).totalSize || 0) > start + PAGE };
    }
    return { title: '', items: [] };
  }
  async searchMedia(q) {
    const d = await this.pms(`/hubs/search?${qs({ query: q, limit: 12 })}`);
    const out = [];
    for (const hub of d?.MediaContainer?.Hub || []) {
      if (!['movie', 'show', 'episode', 'collection'].includes(hub.type)) continue;
      for (const x of hub.Metadata || []) out.push(this._entry({ ...x, type: hub.type === 'collection' ? 'collection' : x.type }));
    }
    const rank = { movie: 0, show: 0, collection: 1, episode: 2 };
    return out.sort((a, b) => (rank[a.type] ?? 3) - (rank[b.type] ?? 3));
  }

  async details(entry) {
    const id = entry.itemId || entry.id;
    return this._cached(`det|${id}`, async () => {
      const d = await this.pms(`/library/metadata/${id}`);
      const x = d?.MediaContainer?.Metadata?.[0];
      if (!x) throw new Error('Not found');
      const e = this._entry(x);
      const tags = (arr) => (arr || []).map((t) => t.tag).filter(Boolean);
      const det = {
        ...e, summary: x.summary || '', tagline: x.tagline || '', contentRating: x.contentRating || '',
        rating: x.audienceRating || x.rating || null, ratingSource: x.audienceRating ? 'Audience' : x.rating ? 'Critics' : '',
        durationMs: x.duration || 0, originallyAvailableAt: x.originallyAvailableAt || '', studio: x.studio || '',
        genres: tags(x.Genre), directors: tags(x.Director), writers: tags(x.Writer), countries: tags(x.Country),
        cast: (x.Role || []).map((r) => ({ name: r.tag, role: r.role || '', photo: this._img(r.thumb, 200, 200) })),
        collections: tags(x.Collection), show: x.grandparentTitle || (x.type === 'season' ? x.parentTitle : ''),
        season: x.type === 'episode' ? x.parentIndex : x.type === 'season' ? x.index : null, episode: x.type === 'episode' ? x.index : null,
        showId: x.grandparentRatingKey || (x.type === 'season' ? x.parentRatingKey : null), seasonId: x.parentRatingKey,
        posterShow: this._poster(x.grandparentThumb || x.parentThumb), backdrop: this._backdrop(x.art || x.grandparentArt || x.thumb),
        streams: this._streamsOf(x), partId: x.Media?.[0]?.Part?.[0]?.id || null,
      };
      if (x.type === 'show' || x.type === 'season') det.children = (await this.browse({ kind: 'children', id, type: x.type })).items;
      if (x.type === 'collection') det.children = (await this.browse({ kind: 'children', id, type: 'collection' })).items;
      return det;
    });
  }
  _streamsOf(x) {
    const st = x.Media?.[0]?.Part?.[0]?.Stream || [];
    const label = (s) => s.displayTitle || s.extendedDisplayTitle || s.language || `Track ${s.index}`;
    return {
      audio: st.filter((s) => s.streamType === 2).map((s) => ({ id: String(s.id), name: label(s), selected: !!s.selected })),
      subs: st.filter((s) => s.streamType === 3).map((s) => ({ id: String(s.id), name: label(s), selected: !!s.selected, lang: s.languageTag || s.languageCode || '', external: !!s.key })),
    };
  }
  async related(entry) {
    const id = entry.type === 'episode' || entry.type === 'season' ? entry.showId || entry.seriesId : entry.itemId || entry.id;
    return this._cached(`rel|${id}`, async () => {
      let d = await this.pms(`/library/metadata/${id}/related`).catch(() => null);
      let list = (d?.MediaContainer?.Hub || []).flatMap((hb) => hb.Metadata || []);
      if (!list.length) { d = await this.pms(`/library/metadata/${id}/similar`).catch(() => null); list = d?.MediaContainer?.Metadata || []; }
      const seen = new Set();
      return list.filter((x) => ['movie', 'show'].includes(x.type) && String(x.ratingKey) !== String(id) && !seen.has(x.ratingKey) && seen.add(x.ratingKey)).slice(0, 24).map((x) => this._entry(x));
    });
  }
  async collectionsFor(det) {
    // episodes and seasons belong to collections through their show
    let base = det;
    if ((det.type === 'episode' || det.type === 'season') && det.showId) base = await this.details({ id: det.showId });
    if (!base.collections?.length || !base.sectionId) return [];
    const all = await this._cached(`cols|${base.sectionId}`, async () => (await this.pms(`/library/sections/${base.sectionId}/collections`))?.MediaContainer?.Metadata || []);
    const out = [];
    for (const name of base.collections.slice(0, 4)) {
      const c = all.find((x) => x.title === name);
      if (!c) continue;
      const items = (await this.browse({ kind: 'children', id: c.ratingKey, type: 'collection' })).items;
      out.push({ id: c.ratingKey, title: c.title, items });
    }
    return out;
  }
  async slideImages(det) {
    const out = [];
    const add = (u) => { if (u && !out.includes(u)) out.push(u); };
    add(det.backdrop);
    if (det.showId) add((await this.details({ id: det.showId }).catch(() => null))?.backdrop);
    for (const c of await this.collectionsFor(det).catch(() => [])) c.items.slice(0, 8).forEach((x) => add(x.backdrop));
    (await this.related(det).catch(() => [])).slice(0, 12).forEach((x) => add(x.backdrop));
    return out;
  }

  // ---------- play / stop / watched / tracks ----------
  async playMedia(entry, { fromStart = false } = {}) {
    if (!this.playerId) throw Object.assign(new Error('No player'), { userMessage: 'Pick a TV or Plex player in Devices first' });
    let target = entry;
    if (entry.type === 'show' || entry.type === 'season') {
      const showId = entry.type === 'show' ? entry.id : entry.showId;
      const eps = await this._leaves(showId);
      const inSeason = entry.type === 'season' ? eps.filter((e) => e.parentIndex === entry.index) : eps;
      target = inSeason.find((e) => !e.watched) || inSeason[0];
      if (!target) throw Object.assign(new Error('empty'), { userMessage: 'No episodes found' });
    }
    if (entry.type === 'collection') return this._playQueue({ uri: `server://${this.server.id}/com.plexapp.plugins.library/library/collections/${entry.id}/children` });
    return this._playQueue({ uri: `server://${this.server.id}/com.plexapp.plugins.library/library/metadata/${target.id}` }, fromStart ? 0 : target.viewOffset || 0);
  }
  async streams() {
    const cur = this.state.track?.media;
    if (!cur) return { audio: [], subs: [] };
    this.cache.delete(`det|${cur.itemId}`);
    const det = await this.details({ id: cur.itemId });
    await this._pollTimeline().catch(() => {});
    const { audioStreamID, subtitleStreamID } = this.timeline;
    const mark = (list, sel) => (sel === undefined ? list : list.map((s) => ({ ...s, selected: s.id === String(sel) })));
    return { audio: mark(det.streams.audio, audioStreamID), subs: mark(det.streams.subs, subtitleStreamID) };
  }
  setStream(kind, id) {
    return this._player('playback/setStreams', kind === 'audio' ? { audioStreamID: id } : { subtitleStreamID: id ?? 0 });
  }
  // ---------- subtitles from the internet (Plex's own subtitle search, OpenSubtitles) ----------
  async searchSubtitles(entry, lang) {
    const id = entry.itemId || entry.id;
    const d = await this.pms(`/library/metadata/${id}/subtitles?${qs({ language: lang.id, hearingImpaired: 0, forced: 0 })}`);
    const list = d?.MediaContainer?.Stream || d?.MediaContainer?.Metadata || [];
    return list.map((s) => ({
      id: s.key || s.sourceKey || String(s.id), name: s.displayTitle || s.title || s.extendedDisplayTitle || s.language || 'Subtitles',
      provider: s.providerTitle || s.provider || 'OpenSubtitles', format: (s.codec || s.format || '').toUpperCase(),
      score: s.score != null ? Math.round(+s.score) : null, hi: !!s.hearingImpaired, forced: !!s.forced, perfect: !!s.perfectMatch,
    }));
  }
  async downloadSubtitle(entry, result) {
    const id = entry.itemId || entry.id;
    await this.pms(`/library/metadata/${id}/subtitles?${qs({ key: result.id })}`, { method: 'PUT' });
    this.cache.delete(`det|${id}`);
  }
  /** Subtitle tracks of an item (fresh from the server). */
  async subtitleTracks(entry) {
    const id = entry.itemId || entry.id;
    this.cache.delete(`det|${id}`);
    return (await this.details({ id })).streams.subs;
  }
  /**
   * Turn a (just downloaded) subtitle track on. It's saved as the chosen subtitles for that video on the
   * server, then switched on in the Plex app; an app that started playing before the file existed doesn't
   * know it yet, so if it doesn't switch, playback restarts at the same spot with the new subtitles.
   */
  async applySubtitle(entry, track) {
    const id = String(entry.itemId || entry.id);
    const det = await this.details({ id }).catch(() => null);
    let saved = false;
    if (det?.partId) {
      try { await this.pms(`/library/parts/${det.partId}?${qs({ subtitleStreamID: track.id, allParts: 1 })}`, { method: 'PUT' }); saved = true; } catch {}
    }
    if (String(this.state.track?.media?.itemId) !== id) return { applied: false, saved };
    try {
      await this.setStream('subs', track.id);
      await new Promise((r) => setTimeout(r, 2500));
      await this._pollTimeline();
      if (String(this.timeline.subtitleStreamID ?? '') === String(track.id)) return { applied: true, saved };
    } catch {}
    const pos = positionOf(this.state);
    try {
      await this._playQueue({ uri: `server://${this.server.id}/com.plexapp.plugins.library/library/metadata/${id}` }, Math.max(0, pos - 3000));
      return { applied: true, reloaded: true, saved };
    } catch { return { applied: false, saved }; }
  }
  async markWatched(entry, on = true) {
    await this.pms(`/:/${on ? 'scrobble' : 'unscrobble'}?${qs({ key: entry.id, identifier: 'com.plexapp.plugins.library' })}`);
    this.cache.clear();
  }
}
