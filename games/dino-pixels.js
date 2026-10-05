// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Dino Run — the flat 8-bit art. Every sprite is a little grid of letters (one letter = one pixel, '.' = empty)
// mapped through a palette; the game pre-renders them once to tiny canvases and draws them scaled up with
// smoothing off, snapped to the pixel grid. All characters are our own designs.

// ---- palette (characters keep their colours; the sky and ground change with the time of day) ----
export const INK = {
  G: '#3fbf6f', S: '#26875a', B: '#f4e2ad', P: '#ff8a3d', Q: '#d9602a', W: '#ffffff', E: '#1b1d2e', K: '#ff7aa8', D: '#1b1d2e',
  // cactus
  C: '#2fae64', c: '#1d7a49', F: '#ff6fae', f: '#ffd23f',
  // glider
  V: '#8a6cff', v: '#5a44c8', Y: '#ffc23d', R: '#ff5f7e',
  // clouds, sun and moon
  O: '#ffffff', o: '#d6e4ff', U: '#ffd23f', u: '#ffb020', M: '#f1f0e6', m: '#c9c7b8',
};

// ---- the dino: a round-headed little runner with orange back plates (facing right) ----
// 19 × 15, origin (feet / x = 0) at column 11, bottom row = ground.
const HEAD = [
  '............GGGGG..',
  '...........GGGGGGG.',
  '...........GGWEGGGG',
  '.....P.....GGWEGGGG',
  '...P.PP.P..GKGGGGGG',
  '...PPPQPPP.GGGGDDDD',
  '..PGGGGGGGGGGGGGGG.',
  'GGGGGGGGGGGGGGS....',
  '.SSGGGGGGBBBGGGS...',
  '....GGGGGBBBGG.S...',
  '....GGGGGBBBGG.....',
  '.....GGGGGGGGG.....',
];
const DEAD_HEAD = HEAD.map((r, i) => (i === 2 ? '...........GGDGDGGG' : i === 3 ? '.....P.....GGGDGGGG' : i === 4 ? '...P.PP.P..GKDGDGGG' : r));
const LEGS = {
  stand: ['.....GG...GG.......', '.....GG...GG.......', '.....SSS..SSS......'],
  runA: ['.....GG...GG.......', '....GG.....GG......', '....SS.....SSS.....'],
  runB: ['......GG.GG........', '......GG.GG........', '.....SSS.SSS.......'],
  jump: ['.....GG...GG.......', '......GS...GS......', '...................'],
};
export const DINO = {
  stand: [...HEAD, ...LEGS.stand],
  runA: [...HEAD, ...LEGS.runA],
  runB: [...HEAD, ...LEGS.runB],
  jump: [...HEAD, ...LEGS.jump],
  dead: [...DEAD_HEAD, ...LEGS.stand],
  ox: 11,
};
// ducking: long and low, 22 × 9, origin at column 10
const DUCK_TOP = [
  '....P.P.P.............',
  '...PPPQPPP...GGGGGG...',
  '..GGGGGGGGGGGGGWEGGGG.',
  'GGGGGGGGGGGGGGGWEGGGGG',
  '.SSGGGGGBBBBBGGKGGDDDD',
  '....GGGGBBBBBGGGGGGGG.',
  '.....GGGGGGGGGSS......',
];
export const DUCK = {
  a: [...DUCK_TOP, '.....GG....GG.........', '.....SSS...SSS........'],
  b: [...DUCK_TOP, '......GG..GG..........', '......SSS.SSS.........'],
  ox: 10,
};

// ---- cacti: small 5 × 9, big 7 × 13 (two looks each); a little flower on some ----
export const CACTI = {
  small: [
    ['..F..', '.CCc.', '.CCc.', 'CCCcC', 'C.CcC', 'CCCcC', '..Cc.', '..Cc.', '..Cc.'],
    ['.....', '.CCc.', '.CCc.', '.CCcC', 'C.CcC', 'CCCc.', '..Cc.', '..Cc.', '..Cc.'],
  ],
  big: [
    ['...f...', '..CCc..', '..CCc..', '..CCc.C', 'C.CCc.C', 'C.CCc.C', 'CCCCcCC', '.CCCc..', '..CCc..', '..CCc..', '..CCc..', '..CCc..', '..CCc..'],
    ['.......', '..CCc..', '..CCc..', 'C.CCc..', 'C.CCc.F', 'CCCCc.C', '..CCcCC', '..CCc.C', '..CCc..', '..CCc..', '..CCc..', '..CCc..', '..CCc..'],
  ],
};

// ---- the glider (facing left), 12 × 8, two wing frames ----
export const BIRD = {
  up: [
    '.....vv.....', '....vVv.....', '..R.vVv.....', '.RVVVVVVV...', 'YYVEVVVVVVVv', '..VVVVVVVv..', '....VVVv....', '............',
  ],
  down: [
    '............', '..R.........', '.RVVVVVVV...', 'YYVEVVVVVVVv', '..VVVVVVVv..', '....vVv.....', '....vVv.....', '.....vv.....',
  ],
};

// ---- sky things ----
export const CLOUD = ['....OOO.....', '..OOOOOOO...', '.OOOOOOOOOO.', 'OOOOOOOOOOOO', '.oooooooooo.'];
export const SUN = ['..UUUU..', '.UUUUUU.', 'UUUUUUUU', 'UUUUUUuU', 'UUUUUuuU', 'UUUUuuuU', '.UUuuuU.', '..UUUU..'];
export const MOON = ['..MMM..', '.MMm...', 'MMm....', 'MMm....', 'MMm....', '.MMm...', '..MMM..'];

// ---- skies: flat bands from the top down to the horizon, the far mesas and the ground ----
// dark themes run from dusk to night, light themes from day to dusk
export const SKIES = {
  day: { bands: ['#7cc8ff', '#94d3ff', '#ade0ff', '#c8ebff'], mesa: '#e9b07a', mesa2: '#d4935e', ground: '#f0c987', edge: '#ffe2a8', pebble: '#c9955a', text: '#1b1d2e', dim: '#3c4a68', cloud: 1 },
  dusk: { bands: ['#2c2a6b', '#45347e', '#6b3f8a', '#a34f86'], mesa: '#5b3a78', mesa2: '#432c62', ground: '#3a2b55', edge: '#6a4f8f', pebble: '#2a1f40', text: '#fff4e0', dim: '#c9b8e6', cloud: 0.5 },
  night: { bands: ['#0b0d24', '#11163a', '#18204d', '#202b5e'], mesa: '#1c2350', mesa2: '#151b40', ground: '#1a1d3a', edge: '#2e3466', pebble: '#10132a', text: '#e8ecff', dim: '#8d96c8', cloud: 0.22 },
  black: { bands: ['#000000', '#000000', '#04050d', '#0a0c1c'], mesa: '#10132c', mesa2: '#0b0d20', ground: '#0d0f1f', edge: '#262a52', pebble: '#05060e', text: '#e8ecff', dim: '#7b84b8', cloud: 0.18 },
};

// ---- a tiny 3 × 5 pixel font for the counter and the start prompt ----
export const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  H: '101101111101101', I: '111010010010111', T: '111010010010010', A: '010101111101101', P: '110101110100100',
  O: '111101101101111', R: '110101110101101', U: '101101101101111', N: '110101101101101', ' ': '000000000000000',
};

/** Pre-render a grid to a 1-pixel-per-cell canvas. */
export function bake(rows, pal = INK) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  rows.forEach((r, y) => { for (let i = 0; i < r.length; i++) { const col = pal[r[i]]; if (col) { x.fillStyle = col; x.fillRect(i, y, 1, 1); } } });
  return c;
}

/** Draw text in the pixel font, centred on (x, y); p = pixel size. */
export function pixelText(ctx, str, x, y, p, color) {
  const s = String(str).toUpperCase(), w = s.length * 4 - 1;
  let px = x - (w * p) / 2; const py = y - (5 * p) / 2;
  ctx.fillStyle = color;
  for (const ch of s) {
    const g = FONT[ch];
    // whole-pixel edges so neighbouring cells meet without hairline seams
    if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') {
      const x0 = Math.round(px + (i % 3) * p), y0 = Math.round(py + Math.floor(i / 3) * p);
      ctx.fillRect(x0, y0, Math.round(px + (i % 3 + 1) * p) - x0, Math.round(py + (Math.floor(i / 3) + 1) * p) - y0);
    }
    px += 4 * p;
  }
}
