// Settings: everything persists in this browser (localStorage). On the Pi you can also
// pre-fill keys via bridge/config.json so nothing has to be typed on the round screen.
import { h, iconBtn, onCircle, badge } from '../ui/dom.js';
import { field } from '../ui/keyboard.js';
import { curve, toast } from '../ui/overlay.js';
import { chips, stepper, toggle, vinylArtSlider, infoArtChips, armToggle, VINYL_SPEEDS } from './panels.js';
import { store } from '../core/store.js';
import { go } from '../core/router.js';
import { clamp } from '../core/util.js';
import { LYRIC_STYLES, TYPO_VARIANTS } from '../views/lyrics.js';
import { TONE_VARIANTS } from '../views/tone-visuals.js';
import { TONE_SOURCES, TONE_SOURCE_HINT, multiChips } from './panels.js';
import { sound } from '../core/sound.js';
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
    opt('Start in view', chips([{ id: 'info', name: 'Info' }, { id: 'vinyl', name: 'Vinyl' }, { id: 'lyrics', name: 'Lyrics' }, { id: 'video', name: 'Video' }, { id: 'tone', name: 'Tone Visual' }], store.get('view'), (v) => store.set('view', v))),
    toggle('Auto-hide controls', () => store.get('autoHideChrome'), (v) => store.set('autoHideChrome', v)),
    toggle('Colours from artwork', () => store.get('artAccent'), (v) => store.set('artAccent', v)),
    infoArtChips(),
    toggle('Reduce effects (faster on Pi 3)', () => store.get('liteMode'), (v) => store.set('liteMode', v)),
    toggle('Open last service on start', () => store.get('autoResume'), (v) => store.set('autoResume', v)),
    opt('Dim screen when idle', chips([{ id: 0, name: 'Never' }, { id: 2, name: '2 min' }, { id: 10, name: '10 min' }, { id: 30, name: '30 min' }], store.get('dimAfterMin'), (v) => store.set('dimAfterMin', v))),
    opt('On-screen keyboard', chips([{ id: 'auto', name: 'Auto' }, { id: 'on', name: 'On' }, { id: 'off', name: 'Off' }], store.get('keyboard'), (v) => store.set('keyboard', v))),
    opt('Keyboard language', chips([{ id: 'en', name: 'English' }, { id: 'he', name: 'עברית' }], store.get('kbdLang'), (v) => store.set('kbdLang', v))),

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

    section('Tone Visual'),
    opt('Style', chips(TONE_VARIANTS, store.get('toneVariant'), (v) => store.set('toneVariant', v))),
    opt('Sound', chips(TONE_SOURCES, store.get('toneSource'), (v) => sound().useMic(v === 'mic'))),
    h('div.opt-hint', TONE_SOURCE_HINT),

    section('Vinyl'),
    vinylArtSlider(),
    armToggle(),
    opt('Record speed (spin + scratch)', chips(VINYL_SPEEDS, store.get('vinylSecondsPerTurn'), (v) => store.set('vinylSecondsPerTurn', v))),

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
    ...SERVICES.filter((s) => s.kind === 'oauth').map((s) => {
      const p = provider(s.id);
      return h('button.row', { type: 'button', onclick: () => go('connect', { id: s.id }) },
        badge(s, 'sm'), h('div.row-text', h('div.row-title', s.name), h('div.row-sub', p.isAuthed() ? 'Signed in' : 'Not signed in')));
    }),

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
