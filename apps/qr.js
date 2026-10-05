// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// A small, dependency-free QR code encoder (ISO/IEC 18004): byte mode, versions 1–10, error correction M,
// automatic mask selection. Enough for a URL of up to 213 bytes.
//   qrEncode(text) → { size, version, mask, dark(x, y) → bool, modules: Uint8Array(size*size) }
//   qrSvg(text, { margin = 4, dark = '#000', light = '#fff' }) → '<svg …>' (crisp at any size)
//   qrCanvas(canvas, text, { margin, dark, light, px }) → draws it on a canvas

// error-correction codewords per block and number of blocks, level M, versions 1..10
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const FORMAT_BITS_M = 0;  // L=1 M=0 Q=3 H=2
const MAX_VERSION = 10;

const getBit = (x, i) => ((x >>> i) & 1) !== 0;

function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const na = Math.floor(ver / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = (ver) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

// ---------------------------------------------------------------- Reed–Solomon over GF(256), poly 0x11D
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0); r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = gfMul(root, 2);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift(); r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

// ---------------------------------------------------------------- encoder
export function qrEncode(text, { mask: forceMask = -1, minVersion = 1 } = {}) {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : Uint8Array.from(text);
  let ver = Math.max(1, minVersion);
  for (; ver <= MAX_VERSION; ver++) {
    const ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > MAX_VERSION) throw new Error(`Text too long for a QR code (${bytes.length} bytes, max ${dataCodewords(MAX_VERSION) - 2})`);

  // bit stream: mode 0100 (byte), count, data, terminator, pad
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }

  // split into blocks, add error correction, interleave
  const nb = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((blk, j) => { if (i !== shortLen - eccLen || j >= numShort) codewords.push(blk[i]); });
  }

  // matrix
  const size = ver * 4 + 17;
  const mod = new Uint8Array(size * size), fn = new Uint8Array(size * size);
  const set = (x, y, d) => { mod[y * size + x] = d ? 1 : 0; fn[y * size + x] = 1; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  if (ver >= 2) {
    const na = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const drawFormat = (m) => {
    const d = (FORMAT_BITS_M << 3) | m;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, getBit(b, i));
    set(8, 7, getBit(b, 6)); set(8, 8, getBit(b, 7)); set(7, 8, getBit(b, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(b, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(b, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(b, i));
    set(8, size - 8, true);
  };
  drawFormat(0);  // reserve the area
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const c = getBit(b, i), a = size - 11 + (i % 3), q = Math.floor(i / 3); set(a, q, c); set(q, a, c); }
  }
  // data in the zig-zag order
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
      if (!fn[y * size + x] && bi < codewords.length * 8) { mod[y * size + x] = getBit(codewords[bi >>> 3], 7 - (bi & 7)) ? 1 : 0; bi++; }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m) => {
    const f = MASKS[m];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y * size + x] && f(x, y)) mod[y * size + x] ^= 1;
  };
  let mask = forceMask;
  if (mask < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty(mod, size);
      if (p < best) { best = p; mask = m; }
      applyMask(m);  // undo (XOR)
    }
  }
  applyMask(mask); drawFormat(mask);
  return { size, version: ver, mask, modules: mod, dark: (x, y) => x >= 0 && y >= 0 && x < size && y < size && mod[y * size + x] === 1 };
}

// penalty score (rules N1–N4) used to choose the mask
function penalty(mod, size) {
  let p = 0;
  const at = (x, y) => mod[y * size + x];
  const line = (get) => {
    let run = 1, prev = get(0);
    for (let i = 1; i < size; i++) {
      const c = get(i);
      if (c === prev) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; } else { run = 1; prev = c; }
    }
    // finder-like 1011101 with 4 light modules on a side (outside the symbol counts as light)
    for (let i = -4; i < size; i++) {
      const g = (k) => (i + k >= 0 && i + k < size ? get(i + k) : 0);
      if (g(4) && !g(5) && g(6) && g(7) && g(8) && !g(9) && g(10)) {
        if ((!g(0) && !g(1) && !g(2) && !g(3)) || (!g(11) && !g(12) && !g(13) && !g(14))) p += 40;
      }
    }
  };
  for (let y = 0; y < size; y++) line((x) => at(x, y));
  for (let x = 0; x < size; x++) line((y) => at(x, y));
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = at(x, y);
    if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) p += 3;
  }
  let dark = 0;
  for (let i = 0; i < mod.length; i++) dark += mod[i];
  const total = size * size;
  p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return p;
}

/** The QR code as an SVG string (one path; shape-rendering crispEdges). */
export function qrSvg(text, { margin = 4, dark = '#000', light = '#fff' } = {}) {
  const q = qrEncode(text);
  const n = q.size + margin * 2;
  let d = '';
  for (let y = 0; y < q.size; y++) {
    for (let x = 0; x < q.size; x++) {
      if (!q.dark(x, y)) continue;
      let w = 1; while (q.dark(x + w, y)) w++;
      d += `M${x + margin} ${y + margin}h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code">`
    + (light ? `<rect width="${n}" height="${n}" fill="${light}"/>` : '') + `<path d="${d}" fill="${dark}"/></svg>`;
}

/** Draw the code on a canvas (whole pixels per module so it stays sharp). */
export function qrCanvas(canvas, text, { margin = 4, dark = '#000', light = '#fff', px = 8 } = {}) {
  const q = qrEncode(text);
  const n = q.size + margin * 2;
  canvas.width = canvas.height = n * px;
  const g = canvas.getContext('2d');
  g.fillStyle = light; g.fillRect(0, 0, n * px, n * px);
  g.fillStyle = dark;
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.dark(x, y)) g.fillRect((x + margin) * px, (y + margin) * px, px, px);
  return q;
}
