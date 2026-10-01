// Jellyfin for movies & shows: remote-controls any Jellyfin video client (Jellyfin on a TV, Android TV,
// Jellyfin Media Player, the web app, Kodi with the Jellyfin add-on…) and browses your libraries.
// Shares the Jellyfin sign-in with the music Jellyfin tile. Same media interface as plex-media.js.
import { JellyfinProvider } from './jellyfin.js';
import { store } from '../core/store.js';
import { qs, isMixed, lanImage } from '../core/util.js';
import { positionOf } from './base.js';

const T = 10000; // ticks per ms
const PAGE = 60;
const TYPE = { Movie: 'movie', Series: 'show', Season: 'season', Episode: 'episode', BoxSet: 'collection', Video: 'movie', MusicVideo: 'movie' };
const LIBS = ['movies', 'tvshows', 'boxsets', 'homevideos', 'mixed', undefined, null];
const FIELDS = 'ChildCount,RecursiveItemCount,ProductionYear,PremiereDate';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const runtime = (ticks) => { const m = Math.round((ticks || 0) / T / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : m ? `${m}m` : ''; };
const err = (msg) => Object.assign(new Error(msg), { userMessage: msg });

export class JellyfinMediaProvider extends JellyfinProvider {
  constructor(meta) {
    super(meta);
    Object.assign(this.caps, { playlists: false, search: false, shuffle: false, repeat: false, library: true, skip: true, stop: true, tracks: true, details: true, adjacent: true });
    this.cache = new Map();
  }
  get uid() { return this.auth?.userId; }
  async _cached(key, fn, ms = 5 * 60000) {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < ms) return c.v;
    const v = await fn();
    this.cache.set(key, { v, at: Date.now() });
    return v;
  }
  async _pic(id, type = 'Primary', { tag, w = 400, h = 600, index } = {}) {
    if (!id) return '';
    const full = `${this.server}/Items/${id}/Images/${type}${index != null ? `/${index}` : ''}?${qs({ fillWidth: w, fillHeight: h, tag, quality: 88 })}`;
    if (!isMixed(full)) return full;
    if (this.route === 'proxy') return this._proxyUrl(full).catch(() => '');
    return lanImage(full);
  }
  _backdropOf(x) {
    if (x.BackdropImageTags?.length) return this._pic(x.Id, 'Backdrop', { tag: x.BackdropImageTags[0], w: 1280, h: 720 });
    if (x.ParentBackdropItemId && x.ParentBackdropImageTags?.length) return this._pic(x.ParentBackdropItemId, 'Backdrop', { tag: x.ParentBackdropImageTags[0], w: 1280, h: 720 });
    return Promise.resolve('');
  }
  _posterOf(x) {
    if (x.Type === 'Episode') return x.SeriesId ? this._pic(x.SeriesId, 'Primary', { tag: x.SeriesPrimaryImageTag }) : this._pic(x.Id);
    if (x.ImageTags?.Primary) return this._pic(x.Id, 'Primary', { tag: x.ImageTags.Primary });
    if (x.Type === 'Season' && x.SeriesId) return this._pic(x.SeriesId, 'Primary', { tag: x.SeriesPrimaryImageTag });
    return Promise.resolve('');
  }

  // ---------- now playing ----------
  _pick() {
    const want = store.getZone(this.id);
    const ss = this.sessions;
    const video = (s) => s.NowPlayingItem && s.NowPlayingItem.MediaType === 'Video';
    return ss.find((s) => s.Id === want)
      || ss.find((s) => video(s) && !s.PlayState?.IsPaused) || ss.find(video)
      || ss.find((s) => (s.PlayableMediaTypes || []).includes('Video')) || ss[0] || null;
  }
  async refresh() {
    await this._sessions();
    const s = this.session = this._pick();
    if (!s) { this.publish({ track: null, isPlaying: false, device: null, status: 'nodevice', message: 'Open Jellyfin on your TV (or another app) to control it' }); return; }
    const it = s.NowPlayingItem, ps = s.PlayState || {};
    const cmds = s.SupportedCommands || [];
    this.caps.volume = cmds.includes('SetVolume') || cmds.length === 0;
    this.caps.tracks = cmds.length === 0 || cmds.includes('SetAudioStreamIndex') || cmds.includes('SetSubtitleStreamIndex');
    const device = { id: s.Id, name: `${s.DeviceName}`, type: s.Client };
    if (!it || it.MediaType !== 'Video') { this.publish({ track: null, isPlaying: false, device, volume: ps.VolumeLevel ?? null, status: 'nodevice', message: `${s.DeviceName} is idle — pick something in Library` }); return; }
    const ep = it.Type === 'Episode';
    const [poster, backdrop, still] = await Promise.all([
      this._posterOf(it), this._backdropOf(it), ep ? this._pic(it.Id, 'Primary', { tag: it.ImageTags?.Primary, w: 640, h: 360 }) : '',
    ]);
    const media = {
      type: TYPE[it.Type] || 'movie', itemId: it.Id, title: it.Name, show: ep ? it.SeriesName : '',
      season: ep ? it.ParentIndexNumber : null, episode: ep ? it.IndexNumber : null, year: it.ProductionYear || null,
      summary: it.Overview || '', contentRating: it.OfficialRating || '', rating: it.CommunityRating || null,
      poster, backdrop, still, seriesId: ep ? it.SeriesId : null, seasonId: ep ? it.SeasonId : null,
    };
    this.audioIndex = ps.AudioStreamIndex; this.subIndex = ps.SubtitleStreamIndex;
    this.publish({
      track: {
        id: it.Id, title: ep ? it.SeriesName : it.Name,
        artist: ep ? `S${it.ParentIndexNumber ?? '?'} · E${it.IndexNumber ?? '?'} · ${it.Name}` : [it.ProductionYear, it.OfficialRating].filter(Boolean).join(' · '),
        album: '', durationMs: (it.RunTimeTicks || 0) / T, art: poster, year: media.year, notSong: true, media,
      },
      isPlaying: !ps.IsPaused, progressMs: (ps.PositionTicks || 0) / T,
      volume: ps.VolumeLevel ?? null, muted: !!ps.IsMuted,
      device, status: 'ok', message: '',
    });
  }
  async getDevices() {
    const list = await super.getDevices();
    const video = new Set(this.sessions.filter((s) => !s.PlayableMediaTypes || s.PlayableMediaTypes.includes('Video')).map((s) => s.Id));
    return list.filter((d) => video.has(d.id));
  }

  // ---------- transport extras ----------
  next() { return this.adjacent(1); }
  prev() { return this.adjacent(-1); }
  async adjacent(dir) {
    const cur = this.state.track?.media;
    if (cur?.type !== 'episode' || !cur.seriesId) return this._playing(dir > 0 ? 'NextTrack' : 'PreviousTrack');
    const eps = await this._episodes(cur.seriesId);
    const i = eps.findIndex((e) => e.id === cur.itemId);
    const target = eps[i + dir];
    if (!target) throw err(dir > 0 ? 'This is the last episode' : 'This is the first episode');
    return this.playMedia(target, { fromStart: true });
  }
  async _episodes(seriesId, seasonId) {
    return this._cached(`eps|${seriesId}|${seasonId || ''}`, async () => {
      const r = await this.api(`/Shows/${seriesId}/Episodes?${qs({ userId: this.uid, seasonId, Fields: 'Overview' })}`);
      return Promise.all((r?.Items || []).map((x) => this._entry(x)));
    }, 60000);
  }
  stopPlayback() { return this._playing('Stop'); }
  /**
   * Intro / credits / recap / preview / ad segments: Jellyfin 10.10+ media segments (what the Jellyfin TV
   * apps use for "Skip intro"), or the Intro Skipper plugin on older servers.
   */
  async markers(id) {
    if (!id) return [];
    return this._cached(`markers|${id}`, async () => {
      const KIND = { intro: 'intro', introduction: 'intro', outro: 'credits', credits: 'credits', recap: 'recap', preview: 'preview', commercial: 'ad' };
      const tidy = (list) => list.filter((x) => x.kind && x.endMs > x.startMs).sort((a, b) => a.startMs - b.startMs);
      try {
        const r = await this.api(`/MediaSegments/${id}`);
        const list = tidy((r?.Items || []).map((x) => ({ kind: KIND[String(x.Type).toLowerCase()], startMs: (x.StartTicks || 0) / T, endMs: (x.EndTicks || 0) / T })));
        if (list.length) return list;
      } catch {}
      try {   // Intro Skipper plugin
        const r = await this.api(`/Episode/${id}/IntroSkipperSegments`);
        const list = tidy(Object.entries(r || {}).filter(([, v]) => v?.Valid !== false && v?.IntroEnd > 0)
          .map(([k, v]) => ({ kind: KIND[k.toLowerCase()], startMs: (v.IntroStart || 0) * 1000, endMs: v.IntroEnd * 1000 })));
        if (list.length) return list;
      } catch {}
      try {
        const v = await this.api(`/Episode/${id}/IntroTimestamps/v1`);
        if (v?.Valid && v.IntroEnd > 0) return [{ kind: 'intro', startMs: (v.IntroStart || 0) * 1000, endMs: v.IntroEnd * 1000 }];
      } catch {}
      return [];
    }, 10 * 60000);
  }

  // ---------- library ----------
  async _entry(x) {
    const t = TYPE[x.Type] || (x.IsFolder ? 'folder' : 'movie');
    const kids = x.ChildCount ?? x.RecursiveItemCount;
    const sub = t === 'movie' ? [x.ProductionYear, runtime(x.RunTimeTicks)].filter(Boolean).join(' · ')
      : t === 'show' ? [x.ProductionYear, kids ? plural(kids, 'season') : ''].filter(Boolean).join(' · ')
      : t === 'season' ? (kids ? plural(kids, 'episode') : x.SeriesName || '')
      : t === 'episode' ? `${x.SeriesName ? x.SeriesName + ' · ' : ''}S${x.ParentIndexNumber ?? '?'} · E${x.IndexNumber ?? '?'}`
      : t === 'collection' ? (kids != null ? plural(kids, 'item') : 'Collection') : '';
    const [poster, backdrop] = await Promise.all([
      t === 'episode' ? this._pic(x.Id, 'Primary', { tag: x.ImageTags?.Primary, w: 480, h: 270 }) : this._posterOf(x),
      this._backdropOf(x),
    ]);
    const ud = x.UserData || {};
    return {
      id: x.Id, type: t, title: x.Name, subtitle: sub, poster, wide: t === 'episode', backdrop,
      year: x.ProductionYear || null, watched: !!ud.Played, progress: (ud.PlayedPercentage || 0) / 100,
      viewOffset: (ud.PlaybackPositionTicks || 0) / T, index: x.IndexNumber, parentIndex: x.ParentIndexNumber,
      showId: x.SeriesId || null, seasonId: x.SeasonId || null,
    };
  }
  _entries(list) { return Promise.all((list || []).map((x) => this._entry(x))); }

  async libraryRoot() {
    const r = await this.api(`/Users/${this.uid}/Views`);
    const views = (r?.Items || []).filter((v) => LIBS.includes(v.CollectionType));
    return {
      title: 'Jellyfin',
      items: [
        { id: 'continue', type: 'folder', title: 'Continue watching', subtitle: 'Pick up where you left off', icon: 'play', node: { kind: 'continue' } },
        { id: 'nextup', type: 'folder', title: 'Next up', subtitle: 'The next episode of your shows', icon: 'next', node: { kind: 'nextup' } },
        ...views.filter((v) => v.CollectionType !== 'boxsets').map((v) => ({ id: `lib-${v.Id}`, type: 'folder', title: v.Name, subtitle: v.CollectionType === 'tvshows' ? 'TV shows' : v.CollectionType === 'movies' ? 'Movies' : 'Videos', icon: v.CollectionType === 'tvshows' ? 'tv' : 'film', node: { kind: 'library', id: v.Id, libType: v.CollectionType, title: v.Name } })),
        { id: 'cols', type: 'folder', title: 'Collections', subtitle: 'Box sets and collections', icon: 'stack', node: { kind: 'collections' } },
      ],
    };
  }
  async browse(node, { start = 0 } = {}) {
    const hide = store.get('mediaHideWatched') ? { IsPlayed: false } : {};
    const paged = { StartIndex: start, Limit: PAGE, Fields: FIELDS };
    const out = async (title, r, extra = []) => ({ title, items: [...extra, ...(await this._entries(r?.Items || r))], more: (r?.TotalRecordCount || 0) > start + PAGE });
    if (node.kind === 'root') return this.libraryRoot();
    if (node.kind === 'continue') return out('Continue watching', await this.api(`/Users/${this.uid}/Items/Resume?${qs({ MediaTypes: 'Video', Limit: 40, Fields: FIELDS })}`));
    if (node.kind === 'nextup') return out('Next up', await this.api(`/Shows/NextUp?${qs({ userId: this.uid, Limit: 40, Fields: FIELDS })}`));
    if (node.kind === 'library') {
      const types = node.libType === 'tvshows' ? 'Series' : node.libType === 'movies' ? 'Movie' : 'Movie,Series,Video';
      const r = await this._items({ ParentId: node.id, IncludeItemTypes: types, SortBy: 'SortName', SortOrder: 'Ascending', ...paged, ...hide });
      const extra = start ? [] : [{ id: `rec-${node.id}`, type: 'folder', title: 'Recently added', icon: 'clock', node: { kind: 'recent', id: node.id } }];
      return out(node.title || 'Library', r, extra);
    }
    if (node.kind === 'recent') return out('Recently added', await this.api(`/Users/${this.uid}/Items/Latest?${qs({ ParentId: node.id, Limit: 40, Fields: FIELDS, GroupItems: true })}`));
    if (node.kind === 'collections') return out('Collections', await this._items({ IncludeItemTypes: 'BoxSet', SortBy: 'SortName', ...paged }));
    if (node.kind === 'children') {
      if (node.type === 'show') return out(node.title || 'Seasons', await this.api(`/Shows/${node.id}/Seasons?${qs({ userId: this.uid, Fields: FIELDS })}`));
      if (node.type === 'season') return { title: node.title || 'Episodes', items: await this._episodes(node.showId, node.id) };
      return out(node.title || '', await this._items({ ParentId: node.id, Recursive: false, SortBy: 'ProductionYear,SortName', ...paged }));
    }
    return { title: '', items: [] };
  }
  async searchMedia(q) {
    const r = await this._items({ searchTerm: q, IncludeItemTypes: 'Movie,Series,Episode,BoxSet', Limit: 40, Fields: FIELDS });
    const rank = { movie: 0, show: 0, collection: 1, episode: 2 };
    return (await this._entries(r?.Items)).sort((a, b) => (rank[a.type] ?? 3) - (rank[b.type] ?? 3));
  }

  async details(entry) {
    const id = entry.itemId || entry.id;
    return this._cached(`det|${id}`, async () => {
      const x = await this.api(`/Users/${this.uid}/Items/${id}`);
      const e = await this._entry(x);
      const people = x.People || [];
      const cast = await Promise.all(people.filter((p) => p.Type === 'Actor' || p.Type === 'GuestStar').slice(0, 30)
        .map(async (p) => ({ name: p.Name, role: p.Role || '', photo: p.PrimaryImageTag ? await this._pic(p.Id, 'Primary', { tag: p.PrimaryImageTag, w: 200, h: 200 }) : '' })));
      const st = x.MediaSources?.[0]?.MediaStreams || x.MediaStreams || [];
      const label = (s) => s.DisplayTitle || s.Language || `Track ${s.Index}`;
      const det = {
        ...e, summary: x.Overview || '', tagline: x.Taglines?.[0] || '', contentRating: x.OfficialRating || '',
        rating: x.CommunityRating ? Math.round(x.CommunityRating * 10) / 10 : null, ratingSource: x.CommunityRating ? 'Community' : '',
        criticRating: x.CriticRating ?? null,
        durationMs: (x.RunTimeTicks || 0) / T, originallyAvailableAt: (x.PremiereDate || '').slice(0, 10), studio: (x.Studios || []).map((s) => s.Name).join(', '),
        genres: x.Genres || [], directors: people.filter((p) => p.Type === 'Director').map((p) => p.Name), writers: people.filter((p) => p.Type === 'Writer').map((p) => p.Name),
        countries: x.ProductionLocations || [], cast, show: x.SeriesName || '',
        season: x.Type === 'Episode' ? x.ParentIndexNumber : x.Type === 'Season' ? x.IndexNumber : null, episode: x.Type === 'Episode' ? x.IndexNumber : null,
        showId: x.SeriesId || null, seasonId: x.SeasonId || null,
        backdrops: await Promise.all((x.BackdropImageTags || []).slice(0, 8).map((t, i) => this._pic(x.Id, 'Backdrop', { tag: t, index: i, w: 1280, h: 720 }))),
        streams: {
          audio: st.filter((s) => s.Type === 'Audio').map((s) => ({ id: String(s.Index), name: label(s), selected: !!s.IsDefault })),
          subs: st.filter((s) => s.Type === 'Subtitle').map((s) => ({ id: String(s.Index), name: label(s), selected: !!s.IsDefault, lang: s.Language || '', external: !!s.IsExternal })),
        },
      };
      if (e.type === 'show' || e.type === 'season' || e.type === 'collection') det.children = (await this.browse({ kind: 'children', id, type: e.type, showId: x.SeriesId })).items;
      return det;
    });
  }
  async related(entry) {
    const id = entry.type === 'episode' || entry.type === 'season' ? entry.showId || entry.seriesId : entry.itemId || entry.id;
    return this._cached(`rel|${id}`, async () => {
      const r = await this.api(`/Items/${id}/Similar?${qs({ userId: this.uid, Limit: 20, Fields: FIELDS })}`);
      return this._entries(r?.Items);
    });
  }
  /** Jellyfin doesn't list an item's collections, so look through the (cached) box sets. */
  async collectionsFor(det) {
    const id = (det.type === 'episode' || det.type === 'season') && det.showId ? det.showId : det.id;
    const sets = await this._cached('boxsets', async () => (await this._items({ IncludeItemTypes: 'BoxSet', Limit: 120 }))?.Items || [], 30 * 60000);
    const members = async (b) => this._cached(`box|${b.Id}`, async () => (await this._items({ ParentId: b.Id, Recursive: false, Fields: FIELDS }))?.Items || [], 30 * 60000);
    const hits = [];
    for (let i = 0; i < sets.length && hits.length < 4; i += 6) {
      const batch = sets.slice(i, i + 6);
      const lists = await Promise.all(batch.map((b) => members(b).catch(() => [])));
      batch.forEach((b, j) => { if (lists[j].some((x) => x.Id === id)) hits.push({ b, items: lists[j] }); });
    }
    return Promise.all(hits.map(async ({ b, items }) => ({ id: b.Id, title: b.Name, items: await this._entries(items) })));
  }
  async slideImages(det) {
    const out = [];
    const add = (u) => { if (u && !out.includes(u)) out.push(u); };
    (det.backdrops || []).forEach(add); add(det.backdrop);
    if (det.showId) { const sd = await this.details({ id: det.showId }).catch(() => null); (sd?.backdrops || []).forEach(add); }
    for (const c of await this.collectionsFor(det).catch(() => [])) c.items.slice(0, 8).forEach((x) => add(x.backdrop));
    (await this.related(det).catch(() => [])).slice(0, 12).forEach((x) => add(x.backdrop));
    return out;
  }

  // ---------- play / stop / watched / tracks ----------
  async playMedia(entry, { fromStart = false } = {}) {
    if (!this.session) throw err('Pick a TV or Jellyfin player in Devices first');
    let target = entry;
    if (entry.type === 'collection') {
      const r = await this._items({ ParentId: entry.id, Recursive: false, SortBy: 'ProductionYear,SortName' });
      const ids = (r?.Items || []).filter((x) => x.Type === 'Movie' || x.Type === 'Video' || x.Type === 'Episode').map((x) => x.Id);
      if (!ids.length) throw err('Nothing playable in this collection');
      return this._playNow(ids.slice(0, 100));
    }
    if (entry.type === 'show' || entry.type === 'season') {
      const showId = entry.type === 'show' ? entry.id : entry.showId;
      const up = await this.api(`/Shows/NextUp?${qs({ userId: this.uid, seriesId: showId, Limit: 1 })}`).catch(() => null);
      const eps = await this._episodes(showId, entry.type === 'season' ? entry.id : undefined);
      target = (entry.type === 'show' && up?.Items?.[0] ? { id: up.Items[0].Id, viewOffset: 0 } : null) || eps.find((e) => !e.watched) || eps[0];
      if (!target) throw err('No episodes found');
    }
    const start = fromStart ? 0 : target.viewOffset || 0;
    return this.api(`/Sessions/${this._s()}/Playing?${qs({ playCommand: 'PlayNow', itemIds: target.id, startPositionTicks: start ? Math.round(start * T) : undefined })}`, { method: 'POST' });
  }
  async streams() {
    const cur = this.state.track?.media;
    if (!cur) return { audio: [], subs: [] };
    await this.refresh().catch(() => {});
    const det = await this.details({ id: cur.itemId });
    const mark = (list, sel) => (sel == null ? list : list.map((s) => ({ ...s, selected: s.id === String(sel) })));
    return { audio: mark(det.streams.audio, this.audioIndex), subs: mark(det.streams.subs, this.subIndex === -1 ? 'off' : this.subIndex) };
  }
  setStream(kind, id) {
    return kind === 'audio' ? this._general('SetAudioStreamIndex', { Index: String(id) }) : this._general('SetSubtitleStreamIndex', { Index: String(id ?? -1) });
  }
  // ---------- subtitles from the internet (Jellyfin's subtitle providers, e.g. the OpenSubtitles plugin) ----------
  async searchSubtitles(entry, lang) {
    const id = entry.itemId || entry.id;
    let list;
    try { list = await this.api(`/Items/${id}/RemoteSearch/Subtitles/${lang.iso3}`); }
    catch (e) { throw Object.assign(e, { userMessage: e.status === 403 ? 'Your Jellyfin user isn’t allowed to manage subtitles' : 'Subtitle search failed — is a subtitle plugin (e.g. OpenSubtitles) installed in Jellyfin?' }); }
    return (list || []).map((s) => ({
      id: s.Id, name: s.Name || 'Subtitles', provider: s.ProviderName || '', format: (s.Format || '').toUpperCase(),
      score: s.CommunityRating != null ? Math.round(s.CommunityRating * 10) / 10 : null, downloads: s.DownloadCount ?? null,
      hi: !!s.HearingImpaired, forced: !!s.Forced, perfect: !!s.IsHashMatch,
    }));
  }
  async downloadSubtitle(entry, result) {
    const id = entry.itemId || entry.id;
    await this.api(`/Items/${id}/RemoteSearch/Subtitles/${encodeURIComponent(result.id)}`, { method: 'POST' });
    this.cache.delete(`det|${id}`);
  }
  async subtitleTracks(entry) {
    const id = entry.itemId || entry.id;
    this.cache.delete(`det|${id}`);
    return (await this.details({ id })).streams.subs;
  }
  /**
   * Turn a just-downloaded subtitle on in the TV app. The app only knows the tracks that existed when it
   * started playing, so "switch subtitles" can't reach the new file: restart at the same spot with it instead.
   */
  async applySubtitle(entry, track) {
    const id = String(entry.itemId || entry.id);
    if (String(this.state.track?.media?.itemId) !== id) return { applied: false, saved: false };
    const ps = this.session?.PlayState || {};
    const pos = Math.max(0, positionOf(this.state) - 3000);
    await this.api(`/Sessions/${this._s()}/Playing?${qs({
      playCommand: 'PlayNow', itemIds: id, startPositionTicks: Math.round(pos * T),
      subtitleStreamIndex: track.id, mediaSourceId: ps.MediaSourceId || undefined,
    })}`, { method: 'POST' });
    this.subIndex = +track.id;
    return { applied: true, reloaded: true, saved: false };
  }
  async markWatched(entry, on = true) {
    await this.api(`/Users/${this.uid}/PlayedItems/${entry.id}`, { method: on ? 'POST' : 'DELETE' });
    this.cache.clear();
  }
}
