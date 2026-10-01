// Settings: everything persists in this browser (localStorage). On the Pi you can also
// pre-fill keys via bridge/config.json so nothing has to be typed on the round screen.
import { h, iconBtn, onCircle, badge, clear } from '../ui/dom.js';
import { field } from '../ui/keyboard.js';
import { curve, toast } from '../ui/overlay.js';
import { chips, stepper, toggle, vinylArtSlider, infoArtChips, armToggle, VINYL_SPEEDS } from './panels.js';
import { store } from '../core/store.js';
import { go } from '../core/router.js';
import { clamp } from '../core/util.js';
import { LYRIC_STYLES, TYPO_VARIANTS } from '../views/lyrics.js';
import { TONE_VARIANTS } from '../views/tone-visuals.js';
import { TONE_SOURCES, TONE_SOURCE_HINT, multiChips, infoArtToggle, infoAutoHideToggle, vinylTitleToggle, videoOpts, devicePillToggle, factChips } from './panels.js';
import { sound } from '../core/sound.js';
import { MEDIA_BGS } from './media-panels.js';
import { LIB_VIEWS } from '../views/media-views.js';
import { partToggles, PLAYER_PARTS, MEDIA_PARTS } from './panels.js';
import { SUB_LANGS, preferredSubLangs } from '../core/languages.js';
import { buildProfile, applyProfile, isProfile, downloadProfile, pickProfileFile, listBridgeProfiles, loadBridgeProfile, saveBridgeProfile, deleteBridgeProfile } from '../core/profiles.js';
import { SERVICES, provider } from '../providers/registry.js';
import { bridgeBase } from '../providers/bridge.js';

export const VERSION = '2.0.0';

export function SettingsScreen() {
  const list = h('div.settings-list');
  const back = onCircle(iconBtn('back', 'Back', () => go('home')), 0, 42);
  const el = h('div.settings', h('div.settings-title', 'Settings'), back, list);

  const opt = (label, control) => h('div.opt', h('div.opt-label', label), control);
  const section = (t) => h('div.section', t);

  list.append(
    section('Display'),
    toggle('Show only signed-in services', () => store.get('onlySignedIn'), (v) => store.set('onlySignedIn', v)),
    toggle('Show the Demo service', () => store.get('showDemo'), (v) => store.set('showDemo', v)),
    opt('Control size', chips(['XS', 'S', 'M', 'L', 'XL'].map((id) => ({ id, name: id })), store.get('uiSize'), (v) => store.set('uiSize', v))),
    opt('Start in view', chips([{ id: 'info', name: 'Info' }, { id: 'vinyl', name: 'Vinyl' }, { id: 'lyrics', name: 'Lyrics' }, { id: 'video', name: 'Video' }, { id: 'tone', name: 'Tone Visual' }, { id: 'facts', name: 'Fun Facts' }], store.get('view'), (v) => store.set('view', v))),
    toggle('Auto-hide controls', () => store.get('autoHideChrome'), (v) => store.set('autoHideChrome', v)),
    devicePillToggle(),
    toggle('Colours from artwork', () => store.get('artAccent'), (v) => store.set('artAccent', v)),
    toggle('Reduce effects (faster on Pi 3)', () => store.get('liteMode'), (v) => store.set('liteMode', v)),
    toggle('Open last service on start', () => store.get('autoResume'), (v) => store.set('autoResume', v)),
    opt('Dim screen when idle', chips([{ id: 0, name: 'Never' }, { id: 2, name: '2 min' }, { id: 10, name: '10 min' }, { id: 30, name: '30 min' }], store.get('dimAfterMin'), (v) => store.set('dimAfterMin', v))),
    opt('On-screen keyboard', chips([{ id: 'auto', name: 'Auto' }, { id: 'on', name: 'On' }, { id: 'off', name: 'Off' }], store.get('keyboard'), (v) => store.set('keyboard', v))),
    opt('Keyboard language', chips([{ id: 'en', name: 'English' }, { id: 'he', name: 'עברית' }], store.get('kbdLang'), (v) => store.set('kbdLang', v))),

    h('div.opt-hint', 'Music player — show these controls (or hold the middle of the player)'),
    ...partToggles('playerHide', PLAYER_PARTS),

    section('Classic'),
    infoArtChips(),
    infoArtToggle(),
    infoAutoHideToggle(),

    section('Vinyl'),
    vinylArtSlider(),
    armToggle(),
    vinylTitleToggle(),
    opt('Record speed (spin + scratch)', chips(VINYL_SPEEDS, store.get('vinylSecondsPerTurn'), (v) => store.set('vinylSecondsPerTurn', v))),

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
