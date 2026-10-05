// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Vinyl view looks: record designs, record colours and tone-arm designs.
// The record design + colour are applied as classes / CSS variables on .view-vinyl (css/vinyl.css);
// the tone arm is drawn here as SVG. Every arm uses the same pivot, length and `.arm-rot`
// rotation as js/views/vinyl.js, so progress tracking and lifting work the same for all of them.

export const VINYL_DESIGNS = [
  { id: 'classic', name: 'Classic' },
  { id: 'clear', name: 'Clear' },
  { id: 'flat', name: 'Flat' },
];

export const ARM_DESIGNS = [
  { id: 'classic', name: 'Classic' },
  { id: 's-arm', name: 'S-arm' },
  { id: 'minimal', name: 'Minimal' },
];

export const DEFAULT_VINYL_COLOR = '#111111';

export const VINYL_COLORS = [
  { id: '#111111', name: 'Black' },
  { id: '#f1eee6', name: 'White' },
  { id: '#c8102e', name: 'Red' },
  { id: '#ff7a1a', name: 'Orange' },
  { id: '#f4c430', name: 'Yellow' },
  { id: '#c9a24a', name: 'Gold' },
  { id: '#1e9e5a', name: 'Green' },
  { id: '#1f5fd1', name: 'Blue' },
  { id: '#7b3fc4', name: 'Purple' },
  { id: '#f06aa6', name: 'Pink' },
  { id: '#6b717c', name: 'Smoke' },
];

const ids = (list) => list.map((o) => o.id);
export const vinylDesign = (v) => (ids(VINYL_DESIGNS).includes(v) ? v : 'classic');
export const armDesign = (v) => (ids(ARM_DESIGNS).includes(v) ? v : 'classic');
/** '#abc' / '#AABBCC' → '#aabbcc'; anything else → the default black. */
export function vinylColor(v) {
  let s = String(v || '').trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + [...s.slice(1)].map((c) => c + c).join('');
  return /^#[0-9a-f]{6}$/.test(s) ? s : DEFAULT_VINYL_COLOR;
}
/** Relative luminance 0..1 of a #rrggbb colour. */
export function luminance(hex) {
  const n = parseInt(vinylColor(hex).slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** The tone arm's inner SVG for a design. P = pivot {x, y}, L = arm length (0..100 viewBox). */
export function armMarkup(design, P, L) {
  const { x, y } = P;
  const rot = `class="arm-rot" style="transform-origin:${x}px ${y}px"`;
  if (design === 's-arm') {
    // An S-shaped tube: out from the pivot, curving one way then the other into an offset headshell.
    const tube = `M${x} ${y - 7} L${x} ${y + 5} C${x} ${y + 11.5} ${x + 2.7} ${y + 13} ${x + 2.7} ${y + 18.5} L${x + 2.7} ${y + 24} C${x + 2.7} ${y + 30.5} ${x - 0.5} ${y + 32.5} ${x + 0.2} ${y + L - 3.4}`;
    return `
    <defs>
      <radialGradient id="saBase" cx=".36" cy=".32" r=".8"><stop offset="0" stop-color="#f6eedc"/><stop offset=".5" stop-color="#b3a37f"/><stop offset="1" stop-color="#3b3427"/></radialGradient>
      <radialGradient id="saCap" cx=".34" cy=".3" r=".8"><stop offset="0" stop-color="#fffbf2"/><stop offset=".55" stop-color="#d2c194"/><stop offset="1" stop-color="#6a5c40"/></radialGradient>
      <radialGradient id="saWeight" cx=".36" cy=".32" r=".8"><stop offset="0" stop-color="#f4efe4"/><stop offset=".55" stop-color="#a59f92"/><stop offset="1" stop-color="#2f2d29"/></radialGradient>
      <linearGradient id="saMetal" x1="0" x2="1"><stop offset="0" stop-color="#7c6e4f"/><stop offset=".45" stop-color="#fbf3dd"/><stop offset="1" stop-color="#8d7d58"/></linearGradient>
    </defs>
    <circle cx="${x}" cy="${y}" r="6.6" fill="#17171a" stroke="#000" stroke-width=".5"/>
    <circle cx="${x}" cy="${y}" r="5.3" fill="url(#saBase)"/>
    <circle cx="${x}" cy="${y}" r="4.2" fill="none" stroke="#3b3427" stroke-opacity=".45" stroke-width=".3"/>
    <g ${rot}>
      <circle cx="${x}" cy="${y - 9.2}" r="3.5" fill="url(#saWeight)" stroke="#1b1a18" stroke-width=".35"/>
      <circle cx="${x}" cy="${y - 9.2}" r="3.05" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width=".35" stroke-dasharray=".25 .3"/>
      <circle cx="${x}" cy="${y - 9.2}" r="1.6" fill="none" stroke="#1b1a18" stroke-opacity=".35" stroke-width=".3"/>
      <path d="${tube}" fill="none" stroke="#4a412e" stroke-width="1.8" stroke-linecap="round"/>
      <path d="${tube}" fill="none" stroke="#cdbb8f" stroke-width="1.34" stroke-linecap="round"/>
      <path d="${tube}" fill="none" stroke="#9d8b62" stroke-width=".45" stroke-linecap="round" transform="translate(.4 .03)"/>
      <path d="${tube}" fill="none" stroke="#fffaf0" stroke-width=".36" stroke-linecap="round" stroke-opacity=".95" transform="translate(-.32 -.03)"/>
      <g transform="translate(${x + 0.2} ${y + L - 3.4}) rotate(-14)">
        <path d="M2 2.3 Q4.9 2.6 5.3 .3" fill="none" stroke="#4a412e" stroke-width=".95" stroke-linecap="round"/>
        <path d="M2 2.3 Q4.9 2.6 5.3 .3" fill="none" stroke="#e8dab4" stroke-width=".5" stroke-linecap="round"/>
        <rect x="-1.05" y="-.9" width="2.1" height="2.3" rx=".45" fill="url(#saMetal)" stroke="#4a412e" stroke-width=".22"/>
        <path d="M-1.35 1.2 L1.35 1.2 L2.25 6.1 Q2.3 6.9 1.6 6.9 L-1.6 6.9 Q-2.3 6.9 -2.25 6.1 Z" fill="url(#saMetal)" stroke="#4a412e" stroke-width=".25"/>
        <rect x="-1.55" y="2.5" width="3.1" height="3.9" rx=".45" fill="#151517" stroke="#000" stroke-width=".2"/>
        <rect x="-1.55" y="2.5" width="3.1" height=".55" rx=".25" fill="#c9b78a"/>
        <rect x="-.45" y="5.55" width=".9" height=".9" rx=".2" fill="var(--accent)"/>
      </g>
      <circle cx="${x}" cy="${y}" r="2.7" fill="url(#saCap)" stroke="#3b3427" stroke-width=".35"/>
      <circle cx="${x}" cy="${y}" r=".75" fill="#3b3427"/>
    </g>`;
  }
  if (design === 'minimal') {
    // One thin flat line, a small round pivot and a tiny cartridge; the accent marks pivot + stylus.
    // Colours come from CSS variables so the arm turns dark on light records (css/vinyl.css).
    return `
    <circle cx="${x}" cy="${y}" r="4.6" fill="var(--arm-base, #232327)"/>
    <g ${rot}>
      <line x1="${x}" y1="${y - 7.5}" x2="${x}" y2="${y + L - 2.4}" stroke="var(--arm-ink, #ececef)" stroke-width=".9" stroke-linecap="round"/>
      <rect x="${x - 1.7}" y="${y - 10.2}" width="3.4" height="3.2" rx="1" fill="var(--arm-mid, #9a9aa1)"/>
      <g transform="translate(${x} ${y + L - 2.6}) rotate(-16)">
        <rect x="-1.15" y="-.2" width="2.3" height="4.2" rx=".55" fill="var(--arm-ink, #ececef)"/>
        <rect x="-.5" y="3.5" width="1" height="1.1" rx=".3" fill="var(--accent)"/>
      </g>
      <circle cx="${x}" cy="${y}" r="2.3" fill="var(--arm-ink, #ececef)"/>
      <circle cx="${x}" cy="${y}" r=".85" fill="var(--accent)"/>
    </g>`;
  }
  // classic: the original straight silver arm + headshell
  return `
    <defs>
      <linearGradient id="armMetal" x1="0" x2="1"><stop offset="0" stop-color="#8d8f94"/><stop offset=".5" stop-color="#f4f5f7"/><stop offset="1" stop-color="#6c6e73"/></linearGradient>
      <radialGradient id="armBase" cx=".35" cy=".35"><stop offset="0" stop-color="#9a9ca1"/><stop offset="1" stop-color="#2b2c30"/></radialGradient>
    </defs>
    <circle cx="${x}" cy="${y}" r="6.2" fill="url(#armBase)" stroke="#111" stroke-width=".6"/>
    <g ${rot}>
      <rect x="${x - 2.2}" y="${y - 10}" width="4.4" height="6" rx="1" fill="#34363b"/>
      <rect x="${x - 0.75}" y="${y - 4}" width="1.5" height="${L - 3}" rx=".75" fill="url(#armMetal)"/>
      <g transform="translate(${x} ${y + L - 3}) rotate(-16)">
        <rect x="-1.9" y="-0.6" width="3.8" height="6.2" rx=".7" fill="#1d1e22" stroke="#555" stroke-width=".25"/>
        <rect x="-0.5" y="4.6" width="1" height="1.4" fill="var(--accent)"/>
      </g>
      <circle cx="${x}" cy="${y}" r="2.2" fill="#d9dade" stroke="#222" stroke-width=".4"/>
    </g>`;
}

// ---- marbling for the clear record: a colour-free light/dark swirl texture, made once ----
let swirlUrl = null;
/** A PNG data URL of soft spiral marbling (black/white with alpha), generated once and cached. */
export function swirlTexture(size = 200) {
  if (swirlUrl) return swirlUrl;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    // seeded value noise
    let seed = 20240917;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const perm = new Uint8Array(512), val = new Float32Array(256);
    for (let i = 0; i < 256; i++) { perm[i] = i; val[i] = rand(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const at = (xi, yi) => val[perm[(xi & 255) + perm[yi & 255]]];
    const noise = (px, py) => {
      const xi = Math.floor(px), yi = Math.floor(py), xf = px - xi, yf = py - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = at(xi, yi), b = at(xi + 1, yi), c2 = at(xi, yi + 1), e = at(xi + 1, yi + 1);
      return a + (b - a) * u + (c2 - a) * v + (a - b - c2 + e) * u * v;
    };
    const fbm = (px, py) => { let s = 0, amp = 0.5; for (let o = 0; o < 3; o++) { s += amp * noise(px, py); px = px * 2.03 + 17.1; py = py * 2.03 + 3.7; amp *= 0.5; } return s / 0.875; };
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const nx = (i + 0.5) / size * 2 - 1, ny = (j + 0.5) / size * 2 - 1;
        const r = Math.hypot(nx, ny);
        const k = (j * size + i) * 4;
        if (r > 1.02) { d[k + 3] = 0; continue; }
        // twist by radius → the spiral the pressing leaves in coloured vinyl
        const t = r * 4.2, cs = Math.cos(t), sn = Math.sin(t);
        const qx = (nx * cs - ny * sn) * 2.1, qy = (nx * sn + ny * cs) * 2.1;
        const w1 = fbm(qx + 1.7, qy + 9.2), w2 = fbm(qx + 8.3, qy + 2.8);
        const v = fbm(qx + 3.2 * w1, qy + 3.2 * w2);
        const m = 0.5 + 0.5 * Math.sin(v * 13 + r * 5);          // veins
        const base = (v - 0.5) * 1.6;                               // broad clouds
        const s = Math.max(-1, Math.min(1, base + (m - 0.5) * 0.55));
        const light = s > 0;
        d[k] = d[k + 1] = d[k + 2] = light ? 255 : 0;
        d[k + 3] = Math.round(Math.min(1, Math.abs(s)) * (light ? 90 : 170));
      }
    }
    ctx.putImageData(img, 0, 0);
    swirlUrl = c.toDataURL('image/png');
  } catch { swirlUrl = ''; }
  return swirlUrl;
}
