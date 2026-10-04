// "Player" choices for the Vinyl view (Settings → Music → Vinyl · Tape · CD, and ⋯ in the view):
// the record (js/views/vinyl.js), a cassette, or a CD seen from the data side or the label side —
// each with three styles. This file holds the lists and the cassette drawings (SVG, drawn once per
// song / style; only the reels move — js/views/decks.js). The CD looks are CSS (css/decks.css).

export const DECKS = [
  { id: 'vinyl', name: 'Vinyl' },
  { id: 'tape', name: 'Cassette' },
  { id: 'cdback', name: 'CD · back' },
  { id: 'cdtop', name: 'CD · top' },
];
export const TAPE_STYLES = [
  { id: 'classic', name: 'Classic' },
  { id: 'clear', name: 'Clear' },
  { id: 'metal', name: 'Chrome / Metal' },
];
export const CD_BACK_STYLES = [
  { id: 'silver', name: 'Silver' },
  { id: 'gold', name: 'Gold CD-R' },
  { id: 'black', name: 'Black' },
];
export const CD_TOP_STYLES = [
  { id: 'print', name: 'Full print' },
  { id: 'marker', name: 'CD-R marker' },
  { id: 'ring', name: 'Ring' },
];

const pick = (list) => (v) => (list.some((o) => o.id === v) ? v : list[0].id);
export const deckId = pick(DECKS);
export const tapeStyle = pick(TAPE_STYLES);
export const cdBackStyle = pick(CD_BACK_STYLES);
export const cdTopStyle = pick(CD_TOP_STYLES);

// ---------------------------------------------------------------- cassette geometry
// One viewBox for every cassette layer: 1000 × 636 (a real cassette is 100.4 × 63.8 mm, so 1 unit ≈ 0.1 mm).
export const TAPE = {
  W: 1000, H: 636,
  HUB_Y: 272, HUB_L: 288, HUB_R: 712,   // reel centres (42.5 mm apart, as in the real thing)
  R0: 104, RMAX: 232,                    // tape pack radius: bare hub … full reel
  WIN: { x: 196, y: 196, w: 608, h: 152, r: 18 },
  ROLL_L: { x: 84, y: 568, r: 17 }, ROLL_R: { x: 916, y: 568, r: 17 },
  TAPE_Y: 585,                           // the tape run along the open edge
};
const T = TAPE;

/** Rounded rectangle path (for even-odd cut-outs). */
const rr = (x, y, w, h, r) => `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const SHELL = rr(0, 0, T.W, T.H, 30);
const WINDOW = rr(T.WIN.x, T.WIN.y, T.WIN.w, T.WIN.h, T.WIN.r);
// the raised part along the open edge, with the head / pinch-roller / capstan openings
const TRAP = `M168 ${T.H}L222 512H778L832 ${T.H}Z`;
// a slot open to the bottom edge (rounded at the top)
const notch = (x, y, w, r) => `M${x} ${T.H}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${T.H}Z`;
const TRAP_HOLES = [
  notch(440, 548, 120, 8),                         // head opening
  notch(326, 566, 56, 6), notch(618, 566, 56, 6),  // pinch rollers
  circ(278, 596, 14), circ(722, 596, 14),          // capstans
  notch(236, 590, 20, 4), notch(744, 590, 20, 4),  // guide pins
].join('');
const SCREWS = [[40, 40], [960, 40], [40, 596], [960, 596], [500, 490]];

function screws(fill, slot) {
  return SCREWS.map(([x, y]) => `<g transform="translate(${x} ${y})"><circle r="15" fill="rgb(0 0 0 / .45)"/><circle r="13" fill="${fill}"/>
    <path d="M-7 0H7M0 -7V7" stroke="${slot}" stroke-width="3.2" stroke-linecap="round" transform="rotate(${(x * 7 + y * 3) % 90})"/></g>`).join('');
}
/** Tick marks along the bottom of the window (the tape-remaining scale on real cassettes). */
function windowScale(color) {
  let s = '';
  const y = T.WIN.y + T.WIN.h;
  for (let i = 0; i <= 10; i++) {
    const x = 400 + i * 20;
    s += `<line x1="${x}" y1="${y - (i % 5 ? 10 : 18)}" x2="${x}" y2="${y - 2}" stroke="${color}" stroke-width="2.4"/>`;
  }
  return s;
}

/**
 * The shell's back half, seen through the window (and through the whole Clear shell).
 * Drawn under the reels.
 */
export function tapeBackMarkup(style) {
  if (style === 'clear') {
    return `
    <path d="${SHELL}" fill="rgb(200 214 228 / .07)"/>
    <path d="${SHELL}${rr(20, 20, T.W - 40, T.H - 40, 20)}" fill="rgb(255 255 255 / .07)" fill-rule="evenodd"/>
    <g fill="none" stroke="rgb(255 255 255 / .13)" stroke-width="3">
      <path d="M${T.HUB_L - 246} 330 A246 246 0 0 1 ${T.HUB_L - 120} 60 M${T.HUB_R + 246} 330 A246 246 0 0 0 ${T.HUB_R + 120} 60"/>
      <path d="M150 512 H222 M778 512 H850 M196 470 V512 M804 470 V512"/>
      <path d="M455 520 V548 M545 520 V548"/>
    </g>
    <g fill="rgb(255 255 255 / .14)" stroke="rgb(255 255 255 / .32)" stroke-width="2">
      ${SCREWS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="24"/>`).join('')}
      <circle cx="500" cy="150" r="13"/><circle cx="160" cy="470" r="10"/><circle cx="840" cy="470" r="10"/>
    </g>
    <rect x="452" y="${T.TAPE_Y - 52}" width="96" height="14" rx="3" fill="rgb(200 205 214 / .5)" stroke="rgb(255 255 255 / .4)" stroke-width="1.5"/>`;
  }
  const c = style === 'metal' ? ['#0b0b0d', '#18191c'] : ['#121316', '#1d1f23'];
  return `
    <defs><linearGradient id="tpBackG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[0]}"/></linearGradient></defs>
    <path d="${SHELL}${TRAP_HOLES}" fill="url(#tpBackG)" fill-rule="evenodd"/>
    <path d="${rr(T.WIN.x + 40, T.WIN.y + 18, T.WIN.w - 80, T.WIN.h - 36, 10)}" fill="rgb(255 255 255 / .03)"/>`;
}

/** Hub (the toothed spool in the middle of each reel), drawn in a −110…110 box; it turns. */
export function hubMarkup(style) {
  const k = style === 'metal'
    ? { ring: '#1a1b1f', edge: '#c9ccd2', tooth: '#d7d9de', clamp: '#8d9097', hole: '#060607' }
    : style === 'clear'
      ? { ring: 'rgb(250 250 252 / .88)', edge: 'rgb(255 255 255 / .95)', tooth: 'rgb(250 250 252 / .9)', clamp: 'var(--accent)', hole: '#0a0a0c' }
      : { ring: '#efe9da', edge: '#fffaf0', tooth: '#e6dfcc', clamp: '#c8bfa8', hole: '#0b0b0c' };
  let teeth = '';
  for (let i = 0; i < 6; i++) teeth += `<rect x="-8" y="-71" width="16" height="22" rx="4" fill="${k.tooth}" transform="rotate(${i * 60})"/>`;
  return `<svg viewBox="-110 -110 220 220" aria-hidden="true">
    <circle r="104" fill="${k.ring}"/>
    <circle r="101" fill="none" stroke="${k.edge}" stroke-width="3" stroke-opacity=".7"/>
    <circle r="86" fill="none" stroke="rgb(0 0 0 / .14)" stroke-width="2"/>
    <rect x="-17" y="-104" width="34" height="20" rx="3" style="fill:${k.clamp}"/>
    <circle r="68" fill="${k.hole}"/>
    <circle r="68" fill="none" stroke="rgb(0 0 0 / .5)" stroke-width="4"/>
    ${teeth}
  </svg>`;
}

/**
 * The cassette's front: shell with the window cut out, label, screws. Text and artwork are filled in by
 * the view (elements with the tp-* classes) so song text never goes through innerHTML.
 */
export function tapeFrontMarkup(style) {
  const LBL = rr(66, 20, 868, 456, 20), LBL_WIN = rr(180, 182, 640, 180, 28);
  if (style === 'clear') {
    return `
    <defs>
      <clipPath id="tpLblClip"><path d="${rr(66, 20, 868, 132, 18)}"/></clipPath>
      <linearGradient id="tpClearShade" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".7" stop-color="#000" stop-opacity=".15"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
      <filter id="tpBlur" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
    </defs>
    <path d="${SHELL}${WINDOW}${TRAP_HOLES}" fill="rgb(215 228 242 / .06)" fill-rule="evenodd"/>
    <path d="${rr(3, 3, T.W - 6, T.H - 6, 28)}" fill="none" stroke="rgb(255 255 255 / .42)" stroke-width="4"/>
    <path d="${rr(16, 16, T.W - 32, T.H - 32, 22)}" fill="none" stroke="rgb(255 255 255 / .1)" stroke-width="2"/>
    <path d="${WINDOW}" fill="none" stroke="rgb(255 255 255 / .34)" stroke-width="3"/>
    <path d="${rr(T.WIN.x - 12, T.WIN.y - 12, T.WIN.w + 24, T.WIN.h + 24, 26)}" fill="none" stroke="rgb(255 255 255 / .1)" stroke-width="2"/>
    <path d="${TRAP}${TRAP_HOLES}" fill="rgb(220 232 245 / .1)" fill-rule="evenodd" stroke="rgb(255 255 255 / .35)" stroke-width="2.5"/>
    <g clip-path="url(#tpLblClip)">
      <rect x="66" y="20" width="868" height="132" style="fill:var(--accent)"/>
      <image class="tp-art" x="40" y="-200" width="920" height="560" preserveAspectRatio="xMidYMid slice" filter="url(#tpBlur)" opacity=".85"/>
      <rect x="66" y="20" width="868" height="132" style="fill:var(--accent)" opacity=".32"/>
      <rect x="66" y="20" width="868" height="132" fill="url(#tpClearShade)"/>
    </g>
    <path d="${rr(66, 20, 868, 132, 18)}" fill="none" stroke="rgb(255 255 255 / .28)" stroke-width="2"/>
    <text class="tp-title deck-title" x="100" y="84" font-size="46" fill="#fff"></text>
    <text class="tp-artist deck-title" x="100" y="128" font-size="29" fill="rgb(255 255 255 / .82)"></text>
    <circle cx="880" cy="86" r="30" fill="rgb(255 255 255 / .16)" stroke="rgb(255 255 255 / .7)" stroke-width="3"/>
    <text x="880" y="100" font-size="40" font-weight="800" fill="#fff" text-anchor="middle" class="tp-sans">A</text>
    <text class="tp-len tp-sans" x="500" y="440" font-size="20" fill="rgb(255 255 255 / .45)" text-anchor="middle" letter-spacing="6"></text>
    <g opacity=".85">${screws('rgb(235 240 246 / .75)', 'rgb(40 44 52 / .55)')}</g>`;
  }
  if (style === 'metal') {
    return `
    <defs>
      <linearGradient id="tpMetShell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2b30"/><stop offset=".08" stop-color="#121316"/><stop offset="1" stop-color="#050506"/></linearGradient>
      <linearGradient id="tpBrushed" x1="0" y1="0" x2="1" y2=".25">
        <stop offset="0" stop-color="#8e939b"/><stop offset=".18" stop-color="#e9ecf0"/><stop offset=".34" stop-color="#a7acb4"/>
        <stop offset=".52" stop-color="#f4f6f8"/><stop offset=".7" stop-color="#9ba0a8"/><stop offset=".86" stop-color="#dfe2e7"/><stop offset="1" stop-color="#868b93"/>
      </linearGradient>
      <pattern id="tpLines" width="6" height="3" patternUnits="userSpaceOnUse"><rect width="6" height="1" fill="rgb(255 255 255 / .22)"/><rect y="2" width="6" height="1" fill="rgb(0 0 0 / .08)"/></pattern>
      <linearGradient id="tpChrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f7f9"/><stop offset=".45" stop-color="#9da2aa"/><stop offset=".55" stop-color="#6c7178"/><stop offset="1" stop-color="#e3e6ea"/></linearGradient>
      <radialGradient id="tpScrewM" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#a9adb4"/><stop offset="1" stop-color="#555a61"/></radialGradient>
      <clipPath id="tpArtClip"><rect x="92" y="84" width="92" height="92" rx="8"/></clipPath>
      <clipPath id="tpLblClip"><path d="${LBL}"/></clipPath>
    </defs>
    <path d="${SHELL}${WINDOW}${TRAP_HOLES}" fill="url(#tpMetShell)" fill-rule="evenodd"/>
    <path d="${rr(2, 2, T.W - 4, T.H - 4, 29)}" fill="none" stroke="rgb(255 255 255 / .2)" stroke-width="3"/>
    <path d="${TRAP}${TRAP_HOLES}" fill="url(#tpChrome)" fill-rule="evenodd" stroke="#2c2f34" stroke-width="2"/>
    <path d="${LBL}${LBL_WIN}" fill="rgb(0 0 0 / .5)" fill-rule="evenodd" transform="translate(0 4)"/>
    <g clip-path="url(#tpLblClip)">
      <path d="${LBL}${LBL_WIN}" fill="url(#tpBrushed)" fill-rule="evenodd"/>
      <path d="${LBL}${LBL_WIN}" fill="url(#tpLines)" fill-rule="evenodd"/>
      <rect x="66" y="20" width="868" height="52" fill="#0c0c0e"/>
      <rect x="66" y="72" width="868" height="4" style="fill:var(--accent)"/>
      <rect x="66" y="384" width="868" height="92" fill="#0c0c0e"/>
      <rect x="66" y="380" width="868" height="4" style="fill:var(--accent)"/>
    </g>
    <rect x="92" y="30" width="58" height="34" rx="5" fill="none" stroke="#e8eaee" stroke-width="3"/>
    <text x="121" y="57" font-size="27" font-weight="800" fill="#e8eaee" text-anchor="middle" class="tp-sans">IV</text>
    <text x="166" y="56" font-size="21" font-weight="700" fill="#e8eaee" letter-spacing="5" class="tp-sans">METAL BIAS · 70μs EQ</text>
    <text class="tp-len tp-sans" x="908" y="56" font-size="21" font-weight="700" fill="#e8eaee" text-anchor="end" letter-spacing="4"></text>
    <rect x="88" y="80" width="100" height="100" rx="11" fill="#0c0c0e"/>
    <g clip-path="url(#tpArtClip)"><rect x="92" y="84" width="92" height="92" style="fill:var(--accent)"/><image class="tp-art" x="92" y="84" width="92" height="92" preserveAspectRatio="xMidYMid slice"/></g>
    <rect x="92" y="84" width="92" height="92" rx="8" fill="none" stroke="rgb(255 255 255 / .35)" stroke-width="2"/>
    <text class="tp-title deck-title tp-cond" x="208" y="128" font-size="46" fill="#111214"></text>
    <text class="tp-artist deck-title tp-cond" x="208" y="166" font-size="28" fill="#3b3e44" letter-spacing="2"></text>
    <text x="92" y="458" font-size="70" fill="#f1f2f4" class="tp-heavy" letter-spacing="10">METAL</text>
    <text x="908" y="426" font-size="19" font-weight="700" fill="#c9ccd2" text-anchor="end" letter-spacing="4" class="tp-sans">HIGH OUTPUT</text>
    <text x="908" y="456" font-size="19" font-weight="700" fill="#c9ccd2" text-anchor="end" letter-spacing="4" class="tp-sans">POSITION IV · SIDE A</text>
    <path d="${WINDOW}" fill="none" stroke="url(#tpChrome)" stroke-width="9"/>
    <path d="${WINDOW}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="2"/>
    ${windowScale('rgb(255 255 255 / .55)')}
    ${screws('url(#tpScrewM)', '#3c4047')}`;
  }
  // classic: dark smoke shell, white paper label with coloured stripes
  return `
    <defs>
      <linearGradient id="tpSmoke" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3e45" stop-opacity=".93"/><stop offset=".55" stop-color="#24262b" stop-opacity=".9"/><stop offset="1" stop-color="#16171a" stop-opacity=".94"/></linearGradient>
      <linearGradient id="tpPaper" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="#fbf8f0"/><stop offset="1" stop-color="#e9e3d3"/></linearGradient>
      <radialGradient id="tpScrewC" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#e9eaec"/><stop offset=".6" stop-color="#8b8f96"/><stop offset="1" stop-color="#3b3e44"/></radialGradient>
      <clipPath id="tpArtClip"><rect x="814" y="374" width="90" height="90" rx="4"/></clipPath>
      <clipPath id="tpLblClip"><path d="${LBL}"/></clipPath>
    </defs>
    <path d="${SHELL}${WINDOW}${TRAP_HOLES}" fill="url(#tpSmoke)" fill-rule="evenodd"/>
    <path d="${rr(2, 2, T.W - 4, T.H - 4, 29)}" fill="none" stroke="rgb(255 255 255 / .22)" stroke-width="3"/>
    <path d="${TRAP}${TRAP_HOLES}" fill="#2c2e33" fill-rule="evenodd" stroke="rgb(255 255 255 / .16)" stroke-width="2.5"/>
    <path d="${LBL}${LBL_WIN}" fill="rgb(0 0 0 / .45)" fill-rule="evenodd" transform="translate(0 4)"/>
    <path d="${LBL}${LBL_WIN}" fill="url(#tpPaper)" fill-rule="evenodd"/>
    <g clip-path="url(#tpLblClip)">
      <rect x="66" y="384" width="868" height="15" style="fill:color-mix(in srgb, var(--accent) 80%, #ffb000)"/>
      <rect x="66" y="402" width="868" height="15" style="fill:var(--accent)"/>
      <rect x="66" y="420" width="868" height="15" style="fill:color-mix(in srgb, var(--accent) 62%, #000)"/>
    </g>
    <rect x="806" y="366" width="106" height="106" rx="6" fill="#fff" stroke="rgb(0 0 0 / .14)" stroke-width="2"/>
    <g clip-path="url(#tpArtClip)"><rect x="814" y="374" width="90" height="90" style="fill:var(--accent)"/><image class="tp-art" x="814" y="374" width="90" height="90" preserveAspectRatio="xMidYMid slice"/></g>
    <rect x="92" y="42" width="56" height="58" rx="6" fill="none" stroke="#2b2f3a" stroke-width="3.5"/>
    <text x="120" y="88" font-size="44" font-weight="800" fill="#2b2f3a" text-anchor="middle" class="tp-sans">A</text>
    <g stroke="#9fb3cf" stroke-width="2"><line x1="168" y1="106" x2="908" y2="106"/><line x1="92" y1="160" x2="908" y2="160"/></g>
    <text class="tp-title deck-title tp-hand" x="176" y="98" font-size="62" fill="#1d2a6b"></text>
    <text class="tp-artist deck-title tp-hand" x="98" y="152" font-size="46" fill="#1d2a6b"></text>
    <text x="92" y="461" font-size="17" font-weight="700" fill="#3a3d45" letter-spacing="4" class="tp-sans">TYPE I · NORMAL POSITION · 120μs EQ</text>
    <text class="tp-len tp-sans" x="790" y="461" font-size="17" font-weight="700" fill="#3a3d45" text-anchor="end" letter-spacing="3"></text>
    <path d="${WINDOW}" fill="none" stroke="#0c0d0f" stroke-width="7"/>
    <path d="${WINDOW}" fill="none" stroke="rgb(255 255 255 / .2)" stroke-width="2" transform="translate(0 3)"/>
    ${windowScale('rgb(255 255 255 / .5)')}
    ${screws('url(#tpScrewC)', '#2a2c31')}`;
}

/**
 * The tape between the reels and the guide rollers, plus the run along the open edge.
 * rL / rR are the current pack radii; the tape leaves each pack on its outer side.
 */
export function tapePath(rL, rR) {
  const tan = (cx, cy, r1, rx, ry, r2, left) => {
    // outer tangent of the pack circle and the roller circle on one side
    const dx = rx - cx, dy = ry - cy, L = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const t = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / L)));
    const n = left ? a + t : a - t;
    const ux = Math.cos(n), uy = Math.sin(n);
    return [cx + r1 * ux, cy + r1 * uy, rx + r2 * ux, ry + r2 * uy];
  };
  const l = tan(T.HUB_L, T.HUB_Y, rL, T.ROLL_L.x, T.ROLL_L.y, T.ROLL_L.r, true);
  const r = tan(T.HUB_R, T.HUB_Y, rR, T.ROLL_R.x, T.ROLL_R.y, T.ROLL_R.r, false);
  const f = (n) => n.toFixed(1);
  return `M${f(l[0])} ${f(l[1])}L${f(l[2])} ${f(l[3])}A${T.ROLL_L.r} ${T.ROLL_L.r} 0 0 0 ${T.ROLL_L.x} ${T.TAPE_Y}`
    + `H${T.ROLL_R.x}A${T.ROLL_R.r} ${T.ROLL_R.r} 0 0 0 ${f(r[2])} ${f(r[3])}L${f(r[0])} ${f(r[1])}`;
}

/** Static parts of the tape layer: guide rollers, pressure pad. */
export function tapeGuidesMarkup(style) {
  const roll = style === 'clear' ? 'var(--accent)' : style === 'metal' ? '#c9ccd2' : '#e9e4d6';
  const pad = style === 'clear' ? 'color-mix(in srgb, var(--accent) 45%, #fff)' : '#d9d2c2';
  const g = (o) => `<g transform="translate(${o.x} ${o.y})"><circle r="${o.r + 3}" fill="rgb(0 0 0 / .4)"/><circle r="${o.r}" style="fill:${roll}"/><circle r="5" fill="rgb(0 0 0 / .45)"/></g>`;
  return `${g(T.ROLL_L)}${g(T.ROLL_R)}
    <rect x="468" y="${T.TAPE_Y - 34}" width="64" height="8" rx="2" fill="#b9bec6"/>
    <rect x="478" y="${T.TAPE_Y - 27}" width="44" height="22" rx="3" style="fill:${pad}"/>
    <rect x="236" y="${T.TAPE_Y - 6}" width="20" height="12" rx="3" fill="#9ca1a9"/><rect x="744" y="${T.TAPE_Y - 6}" width="20" height="12" rx="3" fill="#9ca1a9"/>`;
}
