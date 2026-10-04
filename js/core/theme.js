// Themes: the look of the whole app (Music, Movies & TV, Home, Games, Settings).
//
// Six themes, each with a main colour, a secondary colour and a mode — Dark, OLED (true black) or Light.
// The theme sets CSS variables on #app (colours as "r g b" triplets so CSS can add alpha:
// rgb(var(--ink) / .5)), plus data-theme / data-mode attributes that css/themes.css uses for each
// theme's own shapes and effects. Canvas code (the games) reads the same values from currentTheme().
//
//   classic  — the original look: dark glass, soft neon glow
//   glass    — Liquid Glass: frosted panels with light edges over soft colour blobs
//   soft     — Soft UI (neumorphism): moulded, tactile surfaces like a hardware device
//   slate    — Slate: calm minimal dashboard, thin rings, light typography
//   vivid    — Vivid: modern minimal cards with bold gradient accents
//   bauhaus  — Bauhaus: Swiss-style flat colour, bold grotesk type, no effects
import { store } from './store.js';
import { Emitter } from './util.js';

export const THEMES = [
  { id: 'classic', name: 'Classic', blurb: 'The original look: dark glass and a soft neon glow.', c1: '#1ed760', c2: '#7c5cff', mode: 'dark', follow: true,
    font: "'Inter', 'Rubik', system-ui, sans-serif", display: "'Space Grotesk', 'Rubik', 'Inter', system-ui, sans-serif" },
  { id: 'glass', name: 'Liquid Glass', blurb: 'Frosted glass panels with bright edges, floating over soft colour light.', c1: '#ff7a45', c2: '#7b5cff', mode: 'dark', follow: false,
    font: "'Inter', 'Rubik', system-ui, sans-serif", display: "'Inter', 'Rubik', system-ui, sans-serif" },
  { id: 'soft', name: 'Soft', blurb: 'Soft UI: moulded, tactile surfaces like a well-made hardware device.', c1: '#ff6a1a', c2: '#5b7cfa', mode: 'light', follow: false,
    font: "'Manrope', 'Rubik', system-ui, sans-serif", display: "'Space Grotesk', 'Rubik', 'Manrope', system-ui, sans-serif" },
  { id: 'slate', name: 'Slate', blurb: 'Calm and minimal: slate tones, thin rings and light type.', c1: '#9b8cff', c2: '#f0b46b', mode: 'dark', follow: false,
    font: "'Outfit', 'Rubik', system-ui, sans-serif", display: "'Outfit', 'Rubik', system-ui, sans-serif" },
  { id: 'vivid', name: 'Vivid', blurb: 'Modern minimal cards with bold gradient accents.', c1: '#4f6bff', c2: '#ff4fa3', mode: 'dark', follow: false,
    font: "'Plus Jakarta Sans', 'Rubik', system-ui, sans-serif", display: "'Plus Jakarta Sans', 'Rubik', system-ui, sans-serif" },
  { id: 'bauhaus', name: 'Bauhaus', blurb: 'Swiss style: flat bold colour, big grotesk type, no effects.', c1: '#ff4b2b', c2: '#ffc400', mode: 'light', follow: false,
    font: "'Archivo', 'Rubik', system-ui, sans-serif", display: "'Archivo', 'Rubik', system-ui, sans-serif" },
  // inspired by well-known music & console interfaces (our own take — no logos)
  { id: 'xmb', name: 'XMB', blurb: 'Inspired by the PSP menu: a flowing colour wave, light white type and glowing icons.', c1: '#2f6fe0', c2: '#9ad0ff', mode: 'dark', follow: false,
    font: "'Inter', 'Rubik', system-ui, sans-serif", display: "'Inter', 'Rubik', system-ui, sans-serif" },
  { id: 'ps5', name: 'Console 5', blurb: 'Inspired by the PS5 home screen: deep navy, crisp cards and white focus rings.', c1: '#3d7bff', c2: '#00d4ff', mode: 'dark', follow: false,
    font: "'Inter', 'Rubik', system-ui, sans-serif", display: "'Inter', 'Rubik', system-ui, sans-serif" },
  { id: 'amusic', name: 'Music Red', blurb: 'Inspired by Apple Music: big bold titles, soft blur and a red accent.', c1: '#fa2d48', c2: '#ff9f0a', mode: 'light', follow: false,
    font: "'Inter', 'Rubik', system-ui, sans-serif", display: "'Inter', 'Rubik', system-ui, sans-serif" },
  { id: 'spot', name: 'Music Green', blurb: 'Inspired by Spotify: near-black, bold type and a round green play button.', c1: '#1ed760', c2: '#509bf5', mode: 'dark', follow: false,
    font: "'Figtree', 'Rubik', system-ui, sans-serif", display: "'Figtree', 'Rubik', system-ui, sans-serif" },
  { id: 'ipod', name: 'Click Wheel', blurb: 'Inspired by the iPod classic: brushed metal, click-wheel buttons and blue highlights.', c1: '#2f7cf6', c2: '#9aa4b2', mode: 'light', follow: false,
    font: "'Inter', 'Rubik', system-ui, sans-serif", display: "'Inter', 'Rubik', system-ui, sans-serif" },
];
export const MODES = [{ id: 'dark', name: 'Dark' }, { id: 'oled', name: 'OLED' }, { id: 'light', name: 'Light' }];
/** Colour presets offered in Settings (any colour can be picked too). */
export const SWATCHES = ['#1ed760', '#3ddc84', '#2ee6d6', '#22d3ee', '#4d9bff', '#4f6bff', '#7b5cff', '#9b8cff', '#b57bff', '#ff4fa3',
  '#ff5a6a', '#ff4b2b', '#ff6a1a', '#ff7a45', '#ff9f43', '#ffc400', '#f0b46b', '#e9e4d8', '#8a8f98', '#111111'];

// Surfaces per theme and mode. ink = text/lines, paper = the opposite (scrims, text on ink),
// shade = shadow colour, bg/bg2 = background (centre → edge), surface = cards / panels.
const SURFACES = {
  classic: {
    dark: { bg: '#050506', bg2: '#151518', surface: '#121215', ink: '245 245 247', paper: '0 0 0', shade: '0 0 0' },
    oled: { bg: '#000000', bg2: '#08080a', surface: '#0b0b0d', ink: '245 245 247', paper: '0 0 0', shade: '0 0 0' },
    light: { bg: '#e9ebef', bg2: '#ffffff', surface: '#ffffff', ink: '18 20 26', paper: '255 255 255', shade: '40 44 60' },
  },
  glass: {
    dark: { bg: '#0b0a18', bg2: '#1b1530', surface: '#1c1830', ink: '255 255 255', paper: '8 6 20', shade: '6 4 20' },
    oled: { bg: '#000000', bg2: '#050409', surface: '#0d0b16', ink: '255 255 255', paper: '0 0 0', shade: '0 0 0' },
    light: { bg: '#eef0f8', bg2: '#ffffff', surface: '#ffffff', ink: '24 22 44', paper: '255 255 255', shade: '60 50 120' },
  },
  soft: {
    dark: { bg: '#2a2d32', bg2: '#30343a', surface: '#2a2d32', ink: '232 235 240', paper: '42 45 50', shade: '0 0 0', hi: '#363a41', lo: '#1c1e22' },
    oled: { bg: '#000000', bg2: '#0a0a0b', surface: '#0c0c0d', ink: '232 235 240', paper: '0 0 0', shade: '0 0 0', hi: '#1d1d20', lo: '#000000' },
    light: { bg: '#e0e5ec', bg2: '#e9edf2', surface: '#e0e5ec', ink: '44 52 66', paper: '224 229 236', shade: '120 132 155', hi: '#ffffff', lo: '#a3b1c6' },
  },
  slate: {
    dark: { bg: '#20242b', bg2: '#2b3038', surface: '#2c3139', ink: '236 238 242', paper: '22 25 30', shade: '8 10 14' },
    oled: { bg: '#000000', bg2: '#0b0c0f', surface: '#121419', ink: '230 232 238', paper: '0 0 0', shade: '0 0 0' },
    light: { bg: '#eef0f3', bg2: '#f8f9fa', surface: '#ffffff', ink: '32 36 44', paper: '255 255 255', shade: '60 70 90' },
  },
  vivid: {
    dark: { bg: '#0c0d12', bg2: '#171922', surface: '#1a1c26', ink: '244 245 250', paper: '10 11 16', shade: '0 0 0' },
    oled: { bg: '#000000', bg2: '#07070a', surface: '#101117', ink: '244 245 250', paper: '0 0 0', shade: '0 0 0' },
    light: { bg: '#f1f2f7', bg2: '#ffffff', surface: '#ffffff', ink: '18 20 32', paper: '255 255 255', shade: '40 50 110' },
  },
  bauhaus: {
    dark: { bg: '#161514', bg2: '#1d1c1a', surface: '#22201d', ink: '242 237 228', paper: '22 21 20', shade: '0 0 0' },
    oled: { bg: '#000000', bg2: '#000000', surface: '#0d0d0d', ink: '242 237 228', paper: '0 0 0', shade: '0 0 0' },
    light: { bg: '#ebe5d9', bg2: '#f3eee4', surface: '#f6f2ea', ink: '17 17 17', paper: '235 229 217', shade: '17 17 17' },
  },
  xmb: {
    dark: { bg: '#0b1834', bg2: '#1d3b78', surface: '#152a55', ink: '255 255 255', paper: '6 14 34', shade: '0 0 0' },
    oled: { bg: '#000000', bg2: '#04091a', surface: '#0a1428', ink: '255 255 255', paper: '0 0 0', shade: '0 0 0' },
    light: { bg: '#dce7f6', bg2: '#f3f7fd', surface: '#ffffff', ink: '18 32 60', paper: '255 255 255', shade: '30 50 90' },
  },
  ps5: {
    dark: { bg: '#05081a', bg2: '#0d1838', surface: '#111a35', ink: '255 255 255', paper: '4 6 16', shade: '0 0 0' },
    oled: { bg: '#000000', bg2: '#03050d', surface: '#0b1022', ink: '255 255 255', paper: '0 0 0', shade: '0 0 0' },
    light: { bg: '#edf0f7', bg2: '#ffffff', surface: '#ffffff', ink: '14 20 40', paper: '255 255 255', shade: '30 40 80' },
  },
  amusic: {
    dark: { bg: '#121214', bg2: '#1c1c1e', surface: '#1c1c1e', ink: '245 245 247', paper: '18 18 20', shade: '0 0 0' },
    oled: { bg: '#000000', bg2: '#0a0a0b', surface: '#111113', ink: '245 245 247', paper: '0 0 0', shade: '0 0 0' },
    light: { bg: '#ffffff', bg2: '#f5f5f7', surface: '#f2f2f7', ink: '28 28 30', paper: '255 255 255', shade: '0 0 0' },
  },
  spot: {
    dark: { bg: '#121212', bg2: '#1f1f1f', surface: '#181818', ink: '255 255 255', paper: '0 0 0', shade: '0 0 0' },
    oled: { bg: '#000000', bg2: '#0a0a0a', surface: '#0f0f0f', ink: '255 255 255', paper: '0 0 0', shade: '0 0 0' },
    light: { bg: '#f6f6f6', bg2: '#ffffff', surface: '#ffffff', ink: '18 18 18', paper: '255 255 255', shade: '0 0 0' },
  },
  ipod: {
    dark: { bg: '#1b1c1f', bg2: '#2a2c30', surface: '#26272b', ink: '236 237 240', paper: '20 21 24', shade: '0 0 0' },
    oled: { bg: '#000000', bg2: '#0c0c0e', surface: '#141416', ink: '236 237 240', paper: '0 0 0', shade: '0 0 0' },
    light: { bg: '#e6e7eb', bg2: '#f7f7f9', surface: '#ffffff', ink: '22 24 28', paper: '255 255 255', shade: '60 64 80' },
  },
};

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

/** The saved settings of one theme (its colours, mode and colour source), with the theme's defaults filled in. */
export function themeConfig(id = store.get('theme')) {
  const t = themeById(id);
  const saved = (store.get('themeCfg') || {})[t.id] || {};
  return {
    mode: MODES.some((m) => m.id === saved.mode) ? saved.mode : t.mode, c1: saved.c1 || t.c1, c2: saved.c2 || t.c2, follow: saved.follow ?? t.follow,
    // the Home screen background (see js/ui/backdrops.js): kind + animated + colours for solid / gradient
    bg: { kind: 'theme', animated: false, color: '#203a8f', color2: '#c43a7a', monthColour: true, ...(saved.bg || {}) },
  };
}
export function setThemeConfig(id, patch) {
  const all = { ...(store.get('themeCfg') || {}) };
  all[id] = { ...themeConfig(id), ...patch };
  store.set('themeCfg', all);
}
export function resetThemeConfig(id) {
  const all = { ...(store.get('themeCfg') || {}) };
  delete all[id];
  store.set('themeCfg', all);
}

const hexRgb = (hex) => {
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luminance = (hex) => {
  const [r, g, b] = hexRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Text colour that reads on top of a colour. */
export const onColor = (hex) => (luminance(hex) > 0.36 ? '#0a0a0b' : '#ffffff');

export const themeEvents = new Emitter();
let current = null;
/** Everything about the active theme (for canvas drawing): ids, colours as css strings and rgb arrays. */
export function currentTheme() { return current || computeTheme(); }

function computeTheme() {
  const t = themeById(store.get('theme'));
  const cfg = themeConfig(t.id);
  const s = SURFACES[t.id][cfg.mode] || SURFACES[t.id].dark;
  const rgb = (tri) => tri.split(' ').map(Number);
  return {
    id: t.id, name: t.name, mode: cfg.mode, light: cfg.mode === 'light', follow: cfg.follow,
    c1: cfg.c1, c2: cfg.c2, onC1: onColor(cfg.c1), onC2: onColor(cfg.c2),
    bg: s.bg, bg2: s.bg2, surface: s.surface, inkRgb: rgb(s.ink), paperRgb: rgb(s.paper), shadeRgb: rgb(s.shade),
    hi: s.hi || null, lo: s.lo || null, font: t.font, display: t.display,
    // effects a canvas game should use: glow (neon shadows), flat (no gradients)
    glow: ['classic', 'glass', 'vivid', 'xmb', 'ps5'].includes(t.id),
    flat: t.id === 'bauhaus' || t.id === 'soft',
  };
}

/** What the Home screen background should draw (spec for js/ui/backdrops.js). */
export function backdropSpec(id = store.get('theme')) {
  const t = themeById(id), cfg = themeConfig(t.id);
  return { ...cfg.bg, theme: t.id, mode: cfg.mode, c1: cfg.c1, c2: cfg.c2, lite: !!store.get('liteMode') };
}

/** Apply the saved theme to the app (call at start and after any change). */
export function applyTheme(app = document.getElementById('app')) {
  current = computeTheme();
  const T = current;
  if (!app) return T;
  const s = SURFACES[T.id][T.mode] || SURFACES[T.id].dark;
  const vars = {
    '--bg': T.bg, '--bg2': T.bg2, '--surface': T.surface, '--ink': s.ink, '--paper': s.paper, '--shade': s.shade,
    '--c1': T.c1, '--c2': T.c2, '--accent-2': T.c2, '--on-c1': T.onC1, '--on-c2': T.onC2,
    '--on-accent': T.follow ? '#0a0a0b' : T.onC1,
    '--neu-hi': s.hi || 'transparent', '--neu-lo': s.lo || 'transparent',
    '--font': T.font, '--display': T.display,
  };
  for (const [k, v] of Object.entries(vars)) app.style.setProperty(k, v);
  app.style.setProperty('--theme-bg', (s.bg2 && T.mode !== 'oled') ? `radial-gradient(circle at 50% 50%, ${s.bg2}, ${s.bg} 70%)` : s.bg);
  // the main colour is the starting accent; services / album art may change it when "follow" is on
  app.style.setProperty('--accent', T.c1);
  app.style.setProperty('--brand', T.c1);
  app.dataset.theme = T.id;
  app.dataset.mode = T.mode;
  app.dataset.accent = T.follow ? 'follow' : 'theme';
  document.documentElement.style.colorScheme = T.light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', T.bg);
  themeEvents.emit('change', T);
  return T;
}

/** Re-apply whenever a theme setting changes. */
export function initTheme(app) {
  applyTheme(app);
  store.on('change:theme', () => applyTheme(app));
  store.on('change:themeCfg', () => applyTheme(app));
  store.on('change', (k) => { if (k === '*') applyTheme(app); });   // a settings profile was loaded
}
