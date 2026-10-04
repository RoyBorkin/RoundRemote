// Settings: everything persists in this browser (localStorage). On the Pi you can also
// pre-fill keys via bridge/config.json so nothing has to be typed on the round screen.
import { h, iconBtn, onCircle, badge, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { field } from '../ui/keyboard.js';
import { curve, toast } from '../ui/overlay.js';
import { chips, stepper, toggle, infoArtChips, deckOptions } from './panels.js';
import { store } from '../core/store.js';
import { go } from '../core/router.js';
import { clamp } from '../core/util.js';
import { LYRIC_STYLES, TYPO_VARIANTS } from '../views/lyrics.js';
import { TONE_VARIANTS } from '../views/tone-visuals.js';
import { TONE_SOURCES, TONE_SOURCE_HINT, multiChips, infoArtToggle, infoAutoHideToggle, videoOpts, devicePillToggle, factChips } from './panels.js';
import { sound } from '../core/sound.js';
import { MEDIA_BGS } from './media-panels.js';
import { LIB_VIEWS } from '../views/media-views.js';
import { partToggles, PLAYER_PARTS, MEDIA_PARTS } from './panels.js';
import { SUB_LANGS, preferredSubLangs } from '../core/languages.js';
import { buildProfile, applyProfile, isProfile, downloadProfile, pickProfileFile, listBridgeProfiles, loadBridgeProfile, saveBridgeProfile, deleteBridgeProfile } from '../core/profiles.js';
import { SERVICES, provider } from '../providers/registry.js';
import { bridgeBase } from '../providers/bridge.js';
import { THEMES, MODES, SWATCHES, themeConfig, setThemeConfig, resetThemeConfig, themeById, backdropSpec } from '../core/theme.js';
import { BACKDROPS, drawBackdropPreview } from '../ui/backdrops.js';
import { SOURCES, forgetAll, learnedSongCount } from '../../rhythm/session.js';
import { openCalibration } from '../../rhythm/hub.js';

export const VERSION = '2.0.0';

export function SettingsScreen() {
  const list = h('div.settings-list');
  const back = onCircle(iconBtn('back', 'Back', () => go('home')), 0, 42);
  const el = h('div.settings', h('div.settings-title', 'Settings'), back, list);

  const opt = (label, control) => h('div.opt', h('div.opt-label', label), control);
  const section = (t) => h('div.section', t);
  // the big headers (Theme, General, Music…), with a row of chips at the top to jump to them
  const GROUPS = [['theme', 'Theme', 'image'], ['general', 'General', 'settings'], ['music', 'Music', 'note'], ['media', 'Movies & TV', 'film'],
    ['home', 'Home', 'house'], ['games', 'Games', 'gamepad'], ['rhythm', 'Rhythm', 'rhythm'], ['connect', 'Connection', 'link'], ['profiles', 'Profiles & about', 'about']];
  const groupEls = {};
  const group = (id) => {
    const [, title, ic] = GROUPS.find((g) => g[0] === id);
    return (groupEls[id] = h('div.set-group', { dataset: { group: id } }, h('span.set-group-ic', { html: icon(ic) }), h('span', title)));
  };
  const jump = h('div.set-jump', GROUPS.map(([id, title]) => h('button.chip.sm', {
    type: 'button', onclick: (e) => { e.stopPropagation(); groupEls[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  }, title)));

  list.append(
    jump,

    group('theme'),
    ...themeSection(),

    group('general'),
    section('Display'),
    toggle('Show only signed-in services', () => store.get('onlySignedIn'), (v) => store.set('onlySignedIn', v)),
    toggle('Show the Demo service', () => store.get('showDemo'), (v) => store.set('showDemo', v)),
    opt('Control size (Home, players, games)', chips(['XS', 'S', 'M', 'L', 'XL'].map((id) => ({ id, name: id })), store.get('uiSize'), (v) => store.set('uiSize', v))),
    toggle('Reduce effects (faster on Pi 3)', () => store.get('liteMode'), (v) => store.set('liteMode', v)),
    toggle('Open last service on start', () => store.get('autoResume'), (v) => store.set('autoResume', v)),
    opt('Dim screen when idle', chips([{ id: 0, name: 'Never' }, { id: 2, name: '2 min' }, { id: 10, name: '10 min' }, { id: 30, name: '30 min' }], store.get('dimAfterMin'), (v) => store.set('dimAfterMin', v))),
    section('Keyboard'),
    opt('On-screen keyboard', chips([{ id: 'auto', name: 'Auto' }, { id: 'on', name: 'On' }, { id: 'off', name: 'Off' }], store.get('keyboard'), (v) => store.set('keyboard', v))),
    opt('Keyboard language', chips([{ id: 'en', name: 'English' }, { id: 'he', name: 'עברית' }], store.get('kbdLang'), (v) => store.set('kbdLang', v))),

    group('music'),
    section('Player'),
    opt('Start in view', chips([{ id: 'info', name: 'Info' }, { id: 'vinyl', name: 'Vinyl' }, { id: 'lyrics', name: 'Lyrics' }, { id: 'video', name: 'Video' }, { id: 'tone', name: 'Tone Visual' }, { id: 'facts', name: 'Fun Facts' }], store.get('view'), (v) => store.set('view', v))),
    toggle('Auto-hide controls', () => store.get('autoHideChrome'), (v) => store.set('autoHideChrome', v)),
    devicePillToggle(),
    h('div.opt-hint', 'Show these controls (or hold the middle of the player)'),
    ...partToggles('playerHide', PLAYER_PARTS),

    section('Classic'),
    infoArtChips(),
    infoArtToggle(),
    infoAutoHideToggle(),

    section('Vinyl · Tape · CD'),
    ...deckOptions(),

    section('Lyrics'),
    opt('Style', chips(LYRIC_STYLES, store.get('lyricsStyle'), (v) => store.set('lyricsStyle', v))),
    opt('Kinetic type variant', chips(TYPO_VARIANTS, store.get('typoVariant'), (v) => store.set('typoVariant', v))),
    (() => {
      // Which variants Random may pick (stored as the ones left out, so new variants are in by default)
      const opts = TYPO_VARIANTS.filter((x) => x.id !== 'random');
      const ids = opts.map((x) => x.id);
      const getOn = () => { const off = store.get('typoRandomOff') || []; return ids.filter((id) => !off.includes(id)); };
      const setOn = (on) => store.set('typoRandomOff', ids.filter((id) => !on.includes(id)));
      let row = multiChips(opts, getOn, setOn);
      const all = h('button.pill.small', { type: 'button' }, 'Include all');
      const box = h('div.opt', h('div.opt-label', 'Random includes'), row, h('div.center', all));
      all.onclick = (e) => { e.stopPropagation(); store.set('typoRandomOff', []); const r = multiChips(opts, getOn, setOn); row.replaceWith(r); row = r; };
      return box;
    })(),
    stepper('Timing offset', () => store.get('lyricsOffsetMs'), (v) => store.set('lyricsOffsetMs', clamp(v, -5000, 5000)), { step: 250, fmt: (v) => `${v > 0 ? '+' : ''}${(v / 1000).toFixed(2)}s` }),

    section('Video'),
    ...videoOpts(),

    section('Tone Visual'),
    opt('Style', chips(TONE_VARIANTS, store.get('toneVariant'), (v) => store.set('toneVariant', v))),
    opt('Sound', chips(TONE_SOURCES, store.get('toneSource'), (v) => sound().useMic(v === 'mic'))),
    h('div.opt-hint', TONE_SOURCE_HINT),

    section('Fun Facts'),
    factChips(),

    group('media'),
    section('Movies & TV'),
    opt('Background', chips(MEDIA_BGS, store.get('mediaBg'), (v) => store.set('mediaBg', v))),
    stepper('Slideshow: seconds per picture', () => store.get('mediaSlideSec'), (v) => store.set('mediaSlideSec', clamp(v, 4, 60)), { step: 2, fmt: (v) => `${v}s` }),
    opt('Skip back', chips([5, 10, 15, 30].map((id) => ({ id, name: `${id}s` })), store.get('mediaSkipBack'), (v) => store.set('mediaSkipBack', v))),
    opt('Skip forward', chips([10, 15, 30, 60].map((id) => ({ id, name: `${id}s` })), store.get('mediaSkipFwd'), (v) => store.set('mediaSkipFwd', v))),
    h('div.opt-hint', 'Buttons on the Now playing screen'),
    ...[
      ['mediaPrevNext', 'Previous / next episode'], ['mediaEpisodes', 'Seasons & episodes list'], ['mediaSkip', 'Skip back / forward'], ['mediaInfo', 'Movie / show / episode info'],
      ['mediaCast', 'Cast'], ['mediaFacts', 'Fun facts'], ['mediaSuggest', 'Suggestions from your library'],
      ['mediaCollection', 'More from the collection'], ['mediaTracks', 'Audio & subtitles'], ['mediaStop', 'Stop'],
    ].map(([k, label]) => toggle(label, () => store.get(k), (v) => store.set(k, v))),
    h('div.opt-hint', 'Now playing — show these parts (or hold an empty part of the screen)'),
    ...partToggles('mediaHide', MEDIA_PARTS),
    h('div.opt-hint', 'Subtitles from the internet'),
    opt('Subtitle languages (first = default)', multiChips(SUB_LANGS.map((l) => ({ id: l.id, name: l.name })), () => preferredSubLangs(store.get('mediaSubLangs')), (on) => store.set('mediaSubLangs', on))),
    toggle('Switch to downloaded subtitles', () => store.get('mediaSubAuto') !== false, (v) => store.set('mediaSubAuto', v)),
    h('div.opt-hint', 'While watching'),
    toggle('Auto-hide controls', () => store.get('mediaAutoHide'), (v) => store.set('mediaAutoHide', v)),
    toggle('“Ends at” time', () => store.get('mediaEndsAt'), (v) => store.set('mediaEndsAt', v)),
    toggle('“Skip intro” / “Skip credits” button', () => store.get('mediaSkipPop') !== false, (v) => store.set('mediaSkipPop', v)),
    toggle('Skip intros & recaps automatically', () => !!store.get('mediaAutoSkip'), (v) => store.set('mediaAutoSkip', v)),
    toggle('Title & time left when hidden', () => store.get('mediaHud'), (v) => store.set('mediaHud', v)),
    toggle('Clock when hidden', () => store.get('mediaClock'), (v) => store.set('mediaClock', v)),
    toggle('Fun facts when hidden', () => store.get('mediaIdleFacts'), (v) => store.set('mediaIdleFacts', v)),
    h('div.opt-hint', 'Library'),
    opt('Library view', chips(LIB_VIEWS, store.get('mediaLibView') || 'list', (v) => store.set('mediaLibView', v))),
    opt('Play button', chips([{ id: 'resume', name: 'Resume' }, { id: 'start', name: 'From start' }], store.get('mediaResume'), (v) => store.set('mediaResume', v))),
    toggle('Hide what I’ve watched', () => store.get('mediaHideWatched'), (v) => store.set('mediaHideWatched', v)),
    toggle('No spoilers (blur unwatched episodes)', () => store.get('mediaNoSpoilers'), (v) => store.set('mediaNoSpoilers', v)),

    group('home'),
    section('Smart home'),
    ...['homeassistant', 'googlehome'].map((id) => SERVICES.find((x) => x.id === id)).filter(Boolean).map((s) => h('button.row', { type: 'button', onclick: () => go('connect', { id: s.id }) },
      badge(s, 'sm'), h('div.row-text', h('div.row-title', s.name), h('div.row-sub', provider(s.id).isAuthed?.() ? 'Set up — tap to change' : 'Tap to set up')))),

    group('games'),
    section('Games'),
    toggle('Game sound', () => store.get('gameSound') !== false, (v) => store.set('gameSound', v)),
    field({ label: 'Your name for the top 5', value: store.get('gamePlayer') || '', placeholder: 'asked after a new high score', onChange: (v) => store.set('gamePlayer', v.trim().slice(0, 16)) }),
    (() => {
      let armed = false;
      const b = h('button.pill.small.danger', { type: 'button' }, 'Clear all game scores');
      b.onclick = (e) => {
        e.stopPropagation();
        if (!armed) { armed = true; b.textContent = 'Tap again to clear'; setTimeout(() => { armed = false; b.textContent = 'Clear all game scores'; }, 3000); return; }
        store.set('gameScores', {}); toast('Game scores cleared'); b.textContent = 'Clear all game scores'; armed = false;
      };
      return h('div.center', b);
    })(),

    group('rhythm'),
    ...rhythmSection(),

    group('connect'),
    section('Connection'),
    field({ label: 'Bridge address', value: store.get('bridgeUrl'), placeholder: 'auto', onChange: (v) => { store.set('bridgeUrl', v.replace(/\/$/, '')); bridgeBase({ force: true }); } }),
    opt('Refresh rate', chips([{ id: 1000, name: '1s' }, { id: 2000, name: '2s' }, { id: 4000, name: '4s' }], store.get('pollMs'), (v) => store.set('pollMs', v))),

    section('Service keys'),
    field({ label: 'Spotify Client ID', value: store.get('spotifyClientId'), onChange: (v) => store.set('spotifyClientId', v) }),
    toggle('Play Spotify on this display', () => store.get('spotifyWebPlayer'), (v) => store.set('spotifyWebPlayer', v)),
    field({ label: 'YouTube Data API key', value: store.get('youtubeApiKey'), secret: true, placeholder: 'for YouTube + music videos', onChange: (v) => store.set('youtubeApiKey', v) }),
    field({ label: 'Google OAuth Client ID', value: store.get('googleClientId'), placeholder: 'optional: your YouTube playlists', onChange: (v) => store.set('googleClientId', v) }),
    field({ label: 'Apple developer token', value: store.get('appleDeveloperToken'), secret: true, onChange: (v) => store.set('appleDeveloperToken', v) }),
    field({ label: 'Jellyfin server', value: store.get('jellyfinServer'), placeholder: 'http://192.168.1.20:8096', onChange: (v) => store.set('jellyfinServer', v.replace(/\/$/, '')) }),

    section('Accounts'),
    ...SERVICES.filter((s) => s.kind === 'oauth' && !s.signIn).map((s) => {
      const p = provider(s.id);
      return h('button.row', { type: 'button', onclick: () => go('connect', { id: s.id }) },
        badge(s, 'sm'), h('div.row-text', h('div.row-title', s.name), h('div.row-sub', p.isAuthed() ? 'Signed in' : 'Not signed in')));
    }),

    group('profiles'),
    section('Profiles'),
    ...profilesSection(),

    section('About'),
    h('div.about', `Round Remote ${VERSION}`, h('br'), 'Lyrics by LRCLIB · made for 720×720 round displays'),
    (() => {
      let armed = false;
      const b = h('button.pill.danger', { type: 'button' }, 'Reset everything');
      b.onclick = () => {
        if (!armed) { armed = true; b.textContent = 'Tap again to confirm'; setTimeout(() => { armed = false; b.textContent = 'Reset everything'; }, 3000); return; }
        try { Object.keys(localStorage).filter((k) => k.startsWith('rr.')).forEach((k) => localStorage.removeItem(k)); } catch {}
        toast('Reset — reloading'); setTimeout(() => location.reload(), 600);
      };
      return h('div.center', b);
    })(),
    h('div.credit', 'Made by Roy Borkin'),
    h('div.spacer'),
  );
  curve(list);
  return { el };
}

// ---------------------------------------------------------------- Rhythm
function rhythmSection() {
  const opt = (label, control) => h('div.opt', h('div.opt-label', label), control);
  const section = (t) => h('div.section', t);
  const fmt = (v) => `${v > 0 ? '+' : ''}${v} ms`;
  let st = null;
  const makeStepper = () => stepper('Audio latency', () => Number(store.get('rhythmOffsetMs')) || 0, (v) => store.set('rhythmOffsetMs', clamp(v, -500, 1000)), { step: 5, fmt });
  st = makeStepper();
  const calib = h('button.pill.small', { type: 'button', onclick: (e) => { e.stopPropagation(); openCalibration({ onSave: () => { const n = makeStepper(); st.replaceWith(n); st = n; } }); } }, 'Calibrate — tap along');
  const forgetBtn = h('button.pill.small.danger', { type: 'button' }, 'Forget learned songs');
  const label = (n) => (n ? `Forget learned songs (${n})` : 'Forget learned songs');
  learnedSongCount().then((n) => { forgetBtn.textContent = label(n); }).catch(() => {});
  let armed = false;
  forgetBtn.onclick = async (e) => {
    e.stopPropagation();
    if (!armed) { armed = true; forgetBtn.textContent = 'Tap again to forget'; setTimeout(() => { if (armed) { armed = false; learnedSongCount().then((n) => { forgetBtn.textContent = label(n); }); } }, 3000); return; }
    armed = false;
    await forgetAll();
    forgetBtn.textContent = label(0);
    toast('Learned songs forgotten');
  };
  return [
    section('Rhythm games'),
    st,
    h('div.center', calib),
    h('div.opt-hint', 'How late the music reaches you and your taps register. Calibrate with the clicks here; for music on other speakers, nudge it by ear (hits feel late → raise it).'),
    opt('Learn songs from', chips(SOURCES, store.get('rhythmSource') || 'auto', (v) => store.set('rhythmSource', v))),
    h('div.opt-hint', 'Auto picks the best: Demo songs and Plex / Jellyfin files in seconds; for streaming songs a matching fan-made chart from the chart library (through the bridge — only the notes are downloaded); otherwise the bridge or a microphone listens once; Tempo needs a few taps.'),
    h('div.center', forgetBtn),
    section('Hitster'),
    opt('Hitster language', chips([{ id: 'auto', name: 'Auto' }, { id: 'en', name: 'English' }, { id: 'he', name: 'עברית' }], store.get('hitsterLang') || 'auto', (v) => store.set('hitsterLang', v))),
    h('div.opt-hint', 'Auto follows the keyboard language. In Hebrew the whole game reads right to left. Which songs play (English, Hebrew, both, other languages) and which genres are blocked is chosen on Hitster’s setup screen.'),
    ...hitsterSongs(),
  ];
}

/** Settings → Rhythm → Hitster: "Update song lists" — more well-known songs from Wikidata, kept on this display. */
function hitsterSongs() {
  const info = h('div.opt-hint', '…');
  const btn = h('button.pill.small', { type: 'button' }, 'Update song lists');
  let mods = null;
  const load = async () => (mods ||= Promise.all([import('../../rhythm/hits-update.js'), import('../../rhythm/hits-deck.js')]));
  const paint = async () => {
    const [U, D] = await load();
    await U.loadExtra();
    const { lastUpdated } = U.extraInfo();
    info.textContent = `${D.builtinCount()} built-in songs · ${D.extraCount()} downloaded · ${lastUpdated ? `updated ${new Date(lastUpdated).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : 'not updated yet'}. New songs come from Wikidata and are never removed.`;
  };
  paint().catch(() => { info.textContent = ''; });
  btn.onclick = async (e) => {
    e.stopPropagation();
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const [U] = await load();
      const r = await U.updateSongs({ onProgress: ({ i, n }) => { btn.textContent = `Updating… ${Math.min(i + 1, n)} / ${n}`; } });
      toast(r.added ? `Hitster: +${r.added} new songs` : 'Hitster: no new songs this time');
    } catch (err) {
      toast('Couldn’t reach Wikidata — check the internet connection');
    } finally {
      btn.disabled = false; btn.textContent = 'Update song lists';
      paint().catch(() => {});
    }
  };
  return [h('div.center', btn), info];
}

// ---------------------------------------------------------------- settings profiles
function profilesSection() {
  const err = (e) => e?.userMessage || e?.body?.error || e?.message || String(e);
  let name = store.get('profileName') || 'My round remote';
  let withSignIns = false;
  const pill = (label, onClick, cls = '') => h(`button.pill.small${cls ? '.' + cls : ''}`, { type: 'button', onclick: (e) => { e.stopPropagation(); onClick(e.currentTarget); } }, label);
  const onBridge = h('div.prof-list');
  // loading replaces every setting, so ask for a second tap
  const confirmTap = (b, label, run) => {
    if (b.dataset.armed) { run(); return; }
    b.dataset.armed = '1'; const old = b.textContent; b.textContent = label;
    setTimeout(() => { delete b.dataset.armed; b.textContent = old; }, 3000);
  };
  const apply = (p, from) => {
    try { applyProfile(p); toast(`Loaded “${p.name || from}” — restarting`); setTimeout(() => location.reload(), 900); }
    catch (e) { toast(err(e), { kind: 'error' }); }
  };
  const refresh = async () => {
    clear(onBridge);
    try {
      const list = await listBridgeProfiles();
      if (!list.length) { onBridge.append(h('div.opt-hint', 'No profiles on the bridge yet.')); return; }
      for (const p of list) {
        const when = p.savedAt ? new Date(p.savedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';
        onBridge.append(h('div.prof-row',
          h('div.prof-text', h('div.prof-name', p.name), h('div.prof-sub', [when, p.signIns ? 'with sign-ins' : ''].filter(Boolean).join(' · '))),
          pill('Load', (b) => confirmTap(b, 'Tap to replace', async () => { try { apply(await loadBridgeProfile(p.name), p.name); } catch (e) { toast(err(e), { kind: 'error' }); } }), 'primary'),
          pill('✕', (b) => confirmTap(b, 'Delete?', async () => { await deleteBridgeProfile(p.name).catch(() => {}); refresh(); }))));
      }
    } catch { onBridge.append(h('div.opt-hint', 'Start the bridge to keep profiles on it (or use files).')); }
  };
  refresh();
  return [
    h('div.opt-hint', 'Copy every setting to another round display: save a profile here, then load it there. A new display can also start with it: open the app with ?profile=NAME at the end of its address.'),
    field({ label: 'Profile name', value: name, onChange: (v) => { name = v || name; store.set('profileName', name); } }),
    toggle('Include sign-ins (service accounts)', () => withSignIns, (v) => { withSignIns = v; }),
    h('div.opt-hint', 'Sign-ins carry your account tokens — keep such a file private. Anyone on your network can read profiles kept on the bridge.'),
    h('div.chips',
      pill('Save to bridge', async () => {
        try { await saveBridgeProfile(name, buildProfile({ name, includeSignIns: withSignIns })); toast(`Saved “${name}” on the bridge`); refresh(); }
        catch (e) { toast(err(e), { kind: 'error' }); }
      }, 'primary'),
      pill('Save as file', () => { downloadProfile(buildProfile({ name, includeSignIns: withSignIns })); toast('Profile file saved'); }),
      pill('Load from file', async () => {
        try { const p = await pickProfileFile(); if (!p) return; if (!isProfile(p)) throw new Error('That file isn’t a settings profile'); apply(p, 'file'); }
        catch (e) { toast(err(e), { kind: 'error' }); }
      })),
    h('div.opt-label.prof-head', 'On the bridge'),
    onBridge,
  ];
}

// ---------------------------------------------------------------- Theme: pick a theme, its mode and colours
/** Theme → Home background: a round preview of every background, animated or still, and its colours. */
function homeBackground(id, cfg, set, swatches, opt) {
  const bg = cfg.bg;
  const setBg = (patch) => set({ bg: { ...bg, ...patch } });
  const grid = h('div.bd-grid');
  const canvases = [];
  for (const b of BACKDROPS) {
    const cv = h('canvas.bd-prev', { width: 120, height: 120 });
    canvases.push([cv, { ...backdropSpec(id), kind: b.id, animated: false }]);
    grid.append(h(`button.bd-card${bg.kind === b.id ? '.on' : ''}`, { type: 'button', 'aria-label': b.name, onclick: (e) => { e.stopPropagation(); setBg({ kind: b.id }); } },
      cv, h('span.bd-name', b.id === 'theme' ? `${themeById(id).name} theme` : b.name)));
  }
  // previews draw once the canvases are on the page (they size themselves from it)
  const draw = (tries = 0) => {
    if (!grid.isConnected) { if (tries < 40) requestAnimationFrame(() => draw(tries + 1)); return; }
    for (const [cv, spec] of canvases) { try { drawBackdropPreview(cv, spec); } catch {} }
  };
  requestAnimationFrame(() => draw());
  const out = [
    h('div.section.sub', 'Home background'),
    grid,
    toggle('Animated', () => !!themeConfig(id).bg.animated, (v) => setBg({ animated: v })),
  ];
  if (bg.kind === 'solid') out.push(opt('Background colour', swatches(bg.color, (v) => setBg({ color: v }))));
  if (bg.kind === 'gradient') out.push(opt('From', swatches(bg.color, (v) => setBg({ color: v }))), opt('To', swatches(bg.color2, (v) => setBg({ color2: v }))));
  if (['ps3', 'psp-wave', 'psp-classic'].includes(bg.kind)) out.push(toggle('Colour of the month (like the console menus)', () => themeConfig(id).bg.monthColour !== false, (v) => setBg({ monthColour: v })));
  if (['theme', 'splashes', 'ps4', 'ps2', 'ps5'].includes(bg.kind)) out.push(h('div.opt-hint', 'Uses the theme’s main and secondary colours.'));
  return out;
}

// (separate items rather than one box, so the settings list can curve and fade each of them)
function themeSection() {
  let nodes = [];
  const render = () => {
    const out = [];
    const box = { append: (...items) => out.push(...items.filter(Boolean)) };
    const id = store.get('theme') || 'classic';
    const t = themeById(id);
    const cfg = themeConfig(id);
    const set = (patch) => { setThemeConfig(id, patch); render(); };
    // the themes, each shown as a little round preview in its own colours
    const cards = h('div.th-cards', THEMES.map((x) => {
      const c = themeConfig(x.id);
      return h(`button.th-card${x.id === id ? '.on' : ''}`, {
        type: 'button', 'aria-label': x.name, dataset: { theme: x.id },
        onclick: (e) => { e.stopPropagation(); store.set('theme', x.id); render(); },
      }, h('span.th-prev', { dataset: { theme: x.id, mode: c.mode }, '--p1': c.c1, '--p2': c.c2 }, h('i'), h('b')), h('span.th-name', x.name));
    }));
    const swatches = (cur, onPick) => {
      const row = h('div.th-swatches');
      for (const col of SWATCHES) row.append(h(`button.th-sw${col.toLowerCase() === String(cur).toLowerCase() ? '.on' : ''}`, { type: 'button', 'aria-label': col, '--sw': col, onclick: (e) => { e.stopPropagation(); onPick(col); } }));
      // any colour: the browser's colour picker
      const pick = h('input.th-pick', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#888888', 'aria-label': 'Pick any colour' });
      pick.addEventListener('change', () => onPick(pick.value));
      const custom = !SWATCHES.some((c) => c.toLowerCase() === String(cur).toLowerCase());
      row.append(h(`label.th-sw.th-any${custom ? '.on' : ''}`, { '--sw': cur, title: 'Any colour' }, pick, h('span', '+')));
      return row;
    };
    const opt = (label, control) => h('div.opt', h('div.opt-label', label), control);
    box.append(
      cards,
      h('div.opt-hint', t.blurb),
      opt('Mode', chips(MODES, cfg.mode, (v) => set({ mode: v }))),
      opt('Main colour', swatches(cfg.c1, (v) => set({ c1: v }))),
      opt('Secondary colour', swatches(cfg.c2, (v) => set({ c2: v }))),
      toggle('Colours follow the music (service & artwork)', () => themeConfig(id).follow, (v) => set({ follow: v })),
      toggle('Colours from artwork (when following the music)', () => store.get('artAccent'), (v) => store.set('artAccent', v)),
      ...homeBackground(id, cfg, set, swatches, opt),
      h('div.center', h('button.pill.small', { type: 'button', onclick: (e) => { e.stopPropagation(); resetThemeConfig(id); render(); toast(`${t.name} reset`); } }, `Reset ${t.name}`)),
    );
    const first = nodes[0];
    if (first?.parentNode) { for (const n of out) first.parentNode.insertBefore(n, first); nodes.forEach((n) => n.remove()); }
    nodes = out;
    return out;
  };
  return render();
}
