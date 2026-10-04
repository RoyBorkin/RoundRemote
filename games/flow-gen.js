// Pipe Link — boards, puzzle generator and a small solver.
// A board is a graph of cells (adjacency lists) plus the geometry to draw it, in units of the screen radius R
// (centre = 0,0). Two shapes: a polar board (rings × sectors around a hole) and a square grid.
// A puzzle = a covering of every cell by non-crossing paths; the paths' end cells become the dot pairs.
// The generator grows random self-avoiding paths, repairs short ones, and asks the solver whether the dots
// allow a second filling (rejecting those) — all within a time budget, keeping the best candidate as fallback.

const TAU = Math.PI * 2;

/** Seeded random numbers (mulberry32) — tests use it; the game uses Math.random. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ boards

/**
 * Polar board: rings around a hole. `sectors[i]` = cells in ring i (inner first). Ring radii grow
 * geometrically so every cell has the same proportions. Cells touch around their ring (wrapping) and across
 * rings where their angle spans overlap. Angles: 0 = 12 o'clock, clockwise (in turns 0…1 for spans).
 */
export function polarBoard(sectors, hole = 0.22, outer = 0.8) {
  const sum = sectors.reduce((s, S) => s + 1 / S, 0);
  const k = Math.log(outer / hole) / sum;           // r_{i+1} = r_i · e^{k / S_i}
  const rings = [];
  let r = hole, id = 0;
  for (const S of sectors) {
    const r1 = sectors.length === rings.length + 1 ? outer : r * Math.exp(k / S);
    rings.push({ r0: r, r1, S, first: id });
    id += S; r = r1;
  }
  const n = id;
  const ring = new Int16Array(n), sec = new Int16Array(n), x = new Float64Array(n), y = new Float64Array(n);
  const ang = new Float64Array(n), rad = new Float64Array(n);
  const adj = Array.from({ length: n }, () => []);
  rings.forEach((R, i) => {
    for (let j = 0; j < R.S; j++) {
      const c = R.first + j;
      ring[c] = i; sec[c] = j;
      const a = ((j + 0.5) / R.S) * TAU, rm = (R.r0 + R.r1) / 2;
      ang[c] = a; rad[c] = rm; x[c] = Math.sin(a) * rm; y[c] = -Math.cos(a) * rm;
      adj[c].push(R.first + (j + 1) % R.S, R.first + (j + R.S - 1) % R.S);
    }
    const O = rings[i + 1];
    if (!O) return;
    for (let j = 0; j < R.S; j++) for (let q = 0; q < O.S; q++) {
      const ov = Math.min((j + 1) / R.S, (q + 1) / O.S) - Math.max(j / R.S, q / O.S);
      if (ov > 1e-9) { adj[R.first + j].push(O.first + q); adj[O.first + q].push(R.first + j); }
    }
  });
  // smallest cell size (radial depth or arc), for pipe widths and dot sizes
  let minCell = Infinity;
  for (const R of rings) minCell = Math.min(minCell, R.r1 - R.r0, ((R.r0 + R.r1) / 2) * TAU / R.S);
  return {
    type: 'polar', n, adj, rings, ring, sec, x, y, ang, rad, minCell, hole, outer,
    /** Cell at (dx, dy) (R units), or −1. `m` = margin (× the smallest cell) to keep from inner cell edges. */
    cellAt(dx, dy, m = 0) {
      const r = Math.hypot(dx, dy), md = m * minCell;
      let a = Math.atan2(dx, -dy); if (a < 0) a += TAU;
      for (let i = 0; i < rings.length; i++) {
        const R = rings[i];
        if (r < R.r0 || r >= R.r1) continue;
        if (i > 0 && r - R.r0 < md) return -1;
        if (i < rings.length - 1 && R.r1 - r < md) return -1;
        const f = (a / TAU) * R.S, j = Math.floor(f) % R.S, v = f - Math.floor(f), arc = (r * TAU) / R.S;
        if (Math.min(v, 1 - v) * arc < md) return -1;
        return R.first + j;
      }
      return -1;
    },
  };
}

/** Square N×N grid inscribed in the round screen (half side `half`, centre shifted down by `oy`). */
export function squareBoard(N, half = 0.59, oy = 0.065) {
  const n = N * N, cs = (2 * half) / N, x0 = -half, y0 = -half + oy;
  const x = new Float64Array(n), y = new Float64Array(n), row = new Int16Array(n), col = new Int16Array(n);
  const adj = Array.from({ length: n }, () => []);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const i = r * N + c;
    row[i] = r; col[i] = c; x[i] = x0 + (c + 0.5) * cs; y[i] = y0 + (r + 0.5) * cs;
    if (r > 0) adj[i].push(i - N);
    if (c < N - 1) adj[i].push(i + 1);
    if (r < N - 1) adj[i].push(i + N);
    if (c > 0) adj[i].push(i - 1);
  }
  return {
    type: 'square', n, N, adj, x, y, row, col, cs, x0, y0, half, minCell: cs,
    cellAt(dx, dy, m = 0) {
      const fx = (dx - x0) / cs, fy = (dy - y0) / cs;
      if (fx < 0 || fy < 0 || fx >= N || fy >= N) return -1;
      const u = fx - Math.floor(fx), v = fy - Math.floor(fy);   // margin m × cell, inner edges only
      if ((u < m && fx >= 1) || (u > 1 - m && fx < N - 1) || (v < m && fy >= 1) || (v > 1 - m && fy < N - 1)) return -1;
      return Math.floor(fy) * N + Math.floor(fx);
    },
  };
}

/** The sizes offered in the game (each with its own top 5): board shape, cells and pairs. */
export const SIZES = {
  round: {
    // the sector count only ever doubles out of the innermost ring: then no cell has more than four
    // neighbours, so the four arrow keys can always reach them all
    small: { sectors: [6, 12, 12], hole: 0.24, minP: 4, maxP: 6, run: 120 },
    medium: { sectors: [7, 14, 14, 14], hole: 0.22, minP: 6, maxP: 8, run: 180 },
    large: { sectors: [8, 16, 16, 16, 16], hole: 0.21, minP: 8, maxP: 11, run: 240 },
    huge: { sectors: [9, 18, 18, 18, 18, 18], hole: 0.2, minP: 10, maxP: 13, run: 360 },
  },
  square: {
    small: { N: 5, minP: 4, maxP: 6, run: 120 },
    medium: { N: 6, minP: 5, maxP: 7, run: 180 },
    large: { N: 7, minP: 6, maxP: 9, run: 240 },
    huge: { N: 9, minP: 8, maxP: 12, run: 360 },
  },
};
export function makeBoard(shape, size) {
  const s = SIZES[shape]?.[size] || SIZES[shape]?.medium || SIZES.round.medium;
  const B = shape === 'square' ? squareBoard(s.N) : polarBoard(s.sectors, s.hole);
  return Object.assign(B, { spec: s });
}

// ------------------------------------------------------------------ path cover

/** True if the path never touches itself (only consecutive cells are neighbours). */
function selfAvoiding(path, adj, pos) {
  for (let i = 0; i < path.length; i++) pos[path[i]] = i;
  let ok = true;
  outer: for (let i = 0; i < path.length; i++) {
    for (const x of adj[path[i]]) {
      const p = pos[x];
      if (p >= 0 && p !== i - 1 && p !== i + 1) { ok = false; break outer; }
    }
  }
  for (const c of path) pos[c] = -1;
  return ok;
}

/** Cover every cell with random self-avoiding paths (Warnsdorff-like growth), then repair and balance. */
function coverAttempt(B, minP, maxP, rng, pos) {
  const { n, adj } = B;
  const own = new Int32Array(n).fill(-1);
  let paths = [];
  const want = minP + Math.floor(rng() * (maxP - minP + 1));
  const avg = n / want;
  const freeDeg = (c) => { let d = 0; for (const x of adj[c]) if (own[x] < 0) d++; return d; };
  let left = n;
  while (left > 0) {
    let s = -1, bd = 99, cnt = 0;
    for (let c = 0; c < n; c++) {
      if (own[c] >= 0) continue;
      const d = freeDeg(c);
      if (d < bd) { bd = d; s = c; cnt = 1; } else if (d === bd && rng() * ++cnt < 1) s = c;
    }
    const id = paths.length, p = [s];
    own[s] = id; left--;
    const maxLen = Math.max(3, Math.round(avg * (0.55 + rng() * 1.0)));
    let flipped = false;
    while (p.length < maxLen) {
      const end = p[p.length - 1];
      let pick = -1, best = Infinity;
      for (const nb of adj[end]) {
        if (own[nb] >= 0) continue;
        let ok = true;
        for (const x of adj[nb]) if (x !== end && own[x] === id) { ok = false; break; }
        if (!ok) continue;
        const sc = freeDeg(nb) + rng() * 1.6;
        if (sc < best) { best = sc; pick = nb; }
      }
      if (pick < 0) { if (!flipped) { p.reverse(); flipped = true; continue; } break; }
      p.push(pick); own[pick] = id; left--;
    }
    paths.push(p);
  }

  const reown = () => { own.fill(-1); paths.forEach((p, i) => { for (const c of p) own[c] = i; }); };
  const isEnd = (p, c) => p[0] === c || p[p.length - 1] === c;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // --- repair paths shorter than 3 cells: join them onto a neighbouring path's end, or steal part of one
  for (let guard = 0; guard < 4 * n; guard++) {
    const shorts = [];
    paths.forEach((p, i) => { if (p.length < 3) shorts.push(i); });
    if (!shorts.length) break;
    const si = shorts[Math.floor(rng() * shorts.length)], P = paths[si];
    let done = false;
    const ends = P.length === 1 ? [P[0]] : shuffle([P[0], P[P.length - 1]]);
    for (const e of ends) {
      const Pfrom = P[0] === e ? P : [...P].reverse();         // P starting at e
      for (const x of shuffle([...adj[e]])) {
        const qi = own[x];
        if (qi === si || qi < 0) continue;
        const Q = paths[qi];
        if (isEnd(Q, x)) {                                       // join end to end
          const Qto = Q[Q.length - 1] === x ? Q : [...Q].reverse();
          const m = Qto.concat(Pfrom);
          if (selfAvoiding(m, adj, pos)) { paths[qi] = m; paths.splice(si, 1); done = true; break; }
        }
        const i = Q.indexOf(x);                                  // steal: cut Q after x and hang P on
        for (const [keep, rest] of [[Q.slice(0, i + 1), Q.slice(i + 1)], [Q.slice(i).reverse(), Q.slice(0, i)]]) {
          if (rest.length < 3) continue;
          const m = keep.concat(Pfrom);
          if (selfAvoiding(m, adj, pos)) { paths[qi] = m; paths[si] = rest; done = true; break; }
        }
        if (done) break;
      }
      if (done) break;
    }
    if (!done) return null;
    reown();
  }
  if (paths.some((p) => p.length < 3)) return null;

  // --- balance the number of pairs
  for (let guard = 0; paths.length > want && guard < 50; guard++) {
    const opts = [];
    for (let i = 0; i < paths.length; i++) for (const e of [paths[i][0], paths[i][paths[i].length - 1]]) {
      for (const x of adj[e]) {
        const j = own[x];
        if (j <= i || !isEnd(paths[j], x)) continue;
        opts.push([i, e, j, x]);
      }
    }
    shuffle(opts);
    let merged = false;
    for (const [i, e, j, x] of opts) {
      const A = paths[i][paths[i].length - 1] === e ? paths[i] : [...paths[i]].reverse();
      const Bp = paths[j][0] === x ? paths[j] : [...paths[j]].reverse();
      const m = A.concat(Bp);
      if (selfAvoiding(m, adj, pos)) { paths[i] = m; paths.splice(j, 1); merged = true; break; }
    }
    if (!merged) { if (paths.length > maxP) return null; break; }
    reown();
  }
  for (let guard = 0; paths.length < minP && guard < 50; guard++) {
    const long = paths.map((p, i) => i).filter((i) => paths[i].length >= 6);
    if (!long.length) return null;
    const i = long[Math.floor(rng() * long.length)], p = paths[i];
    const cut = 3 + Math.floor(rng() * (p.length - 5));
    paths[i] = p.slice(0, cut); paths.push(p.slice(cut));
    reown();
  }
  return paths;
}

// ------------------------------------------------------------------ solver

/**
 * Count the fillings of a puzzle (up to `maxSol`), growing each colour from its first dot. Only "tidy"
 * fillings are searched (no pipe runs alongside itself), which is what a well-made puzzle's answer looks like.
 * Returns { count, nodes, aborted }.
 */
export function countSolutions(B, pairs, { limit = 20000, maxSol = 2, tidy = true, deadline = Infinity } = {}) {
  const { n, adj } = B, K = pairs.length;
  const col = new Int8Array(n).fill(-1);
  const head = new Int32Array(K), tgt = new Int32Array(K), fin = new Uint8Array(K);
  pairs.forEach(([a, b], k) => { col[a] = k; col[b] = k; head[k] = a; tgt[k] = b; });
  let empty = n - 2 * K, nodes = 0, count = 0, aborted = false;
  const comp = new Int32Array(n), stack = new Int32Array(n);
  const isTip = new Int8Array(n);        // 1 = head or target of an unfinished colour
  const fillable = new Uint8Array(n + 1);
  const hc = [];

  function feasible() {
    isTip.fill(0);
    for (let k = 0; k < K; k++) if (!fin[k]) { isTip[head[k]] = 1; isTip[tgt[k]] = 1; }
    // dead cells: an empty cell needs two possible pipe neighbours
    for (let c = 0; c < n; c++) {
      if (col[c] >= 0) continue;
      let d = 0;
      for (const x of adj[c]) if (col[x] < 0 || isTip[x]) d++;
      if (d < 2) return false;
    }
    // empty regions
    comp.fill(-1);
    let nc = 0;
    for (let c = 0; c < n; c++) {
      if (col[c] >= 0 || comp[c] >= 0) continue;
      let sp = 0; stack[sp++] = c; comp[c] = nc;
      while (sp) { const u = stack[--sp]; for (const x of adj[u]) if (col[x] < 0 && comp[x] < 0) { comp[x] = nc; stack[sp++] = x; } }
      nc++;
    }
    fillable.fill(0, 0, nc);
    for (let k = 0; k < K; k++) {
      if (fin[k]) continue;
      const h = head[k], t = tgt[k];
      let direct = false;
      hc.length = 0;
      for (const x of adj[h]) { if (x === t) direct = true; else if (col[x] < 0) hc.push(comp[x]); }
      let reach = direct;
      for (const x of adj[t]) if (col[x] < 0 && hc.includes(comp[x])) { reach = true; fillable[comp[x]] = 1; }
      if (!reach) return false;
    }
    for (let i = 0; i < nc; i++) if (!fillable[i]) return false;
    return true;
  }

  function movesOf(k, out) {
    out.length = 0;
    const h = head[k], t = tgt[k];
    for (const x of adj[h]) if (x === t) { out.push(t); if (tidy) return out; }   // next to its partner: must join
    for (const nb of adj[h]) {
      if (col[nb] >= 0) continue;
      let ok = true;
      if (tidy) for (const x of adj[nb]) if (x !== h && x !== t && col[x] === k) { ok = false; break; }
      if (ok) out.push(nb);
    }
    return out;
  }

  const moveBufs = Array.from({ length: n + 2 }, () => []);
  function search(depth) {
    if (++nodes > limit || ((nodes & 15) === 0 && performance.now() > deadline)) { aborted = true; return; }
    let bk = -1, bm = null;
    const buf = moveBufs[depth], tmp = moveBufs[depth + 1];
    for (let k = 0; k < K; k++) {
      if (fin[k]) continue;
      const m = movesOf(k, tmp);
      if (!m.length) return;
      if (bk < 0 || m.length < bm.length) {
        bk = k; buf.length = 0; for (const v of m) buf.push(v); bm = buf;
        if (m.length === 1) break;
      }
    }
    if (bk < 0) { if (empty === 0) count++; return; }
    const moves = bm.slice();
    const h0 = head[bk];
    for (const m of moves) {
      if (m === tgt[bk]) {
        fin[bk] = 1;
        if (feasible()) search(depth + 1);
        fin[bk] = 0;
      } else {
        col[m] = bk; head[bk] = m; empty--;
        if (feasible()) search(depth + 1);
        col[m] = -1; head[bk] = h0; empty++;
      }
      if (count >= maxSol || aborted) return;
    }
  }
  if (feasible()) search(0);
  return { count, nodes, aborted };
}

// ------------------------------------------------------------------ generator

/**
 * A new puzzle for board B: { pairs: [[a, b]…], paths: [[cells…]…], unique, ms, tries }.
 * minP…maxP pairs, every path ≥ 3 cells, no path touching itself, the dots allow only one tidy filling
 * (checked by the solver when it finishes in time). Returns within ~budget ms.
 */
export function generate(B, { minP, maxP, budget = 120, rng = Math.random, nodeLimit } = {}) {
  const t0 = performance.now();
  const pos = new Int32Array(B.n).fill(-1);
  const limit = nodeLimit ?? Math.max(4000, Math.round(400000 / B.n));
  let fallback = null, fbScore = -1, tries = 0;
  while (true) {
    tries++;
    const paths = coverAttempt(B, minP, maxP, rng, pos);
    if (paths) {
      const pairs = paths.map((p) => [p[0], p[p.length - 1]]);
      // 1) no second tidy filling (cheap), 2) no second filling at all (strict; may run out of time)
      const dl = t0 + budget;
      const r1 = countSolutions(B, pairs, { limit, maxSol: 2, deadline: dl });
      let sc = r1.count >= 2 ? 0 : r1.aborted ? 1 : 2;
      if (sc === 2) {
        const r2 = countSolutions(B, pairs, { limit, maxSol: 2, tidy: false, deadline: dl });
        if (r2.count === 1 && !r2.aborted) return { pairs, paths, unique: true, ms: performance.now() - t0, tries };
        sc = r2.aborted ? 3 : 2;
      }
      // fallback ranking: tidy-unique (strict check unfinished) > tidy-unique > unverified > ambiguous
      if (sc > fbScore || !fallback) { fbScore = sc; fallback = { pairs, paths, unique: false, tidyUnique: sc >= 2 }; }
    }
    if (performance.now() - t0 > budget && (fallback || tries > 2000)) break;
  }
  if (!fallback) fallback = snakeFallback(B, minP);
  return { ...fallback, ms: performance.now() - t0, tries };
}

/** Last resort (never seen in tests): cut a ring-by-ring / row-by-row snake into pieces. */
function snakeFallback(B, minP) {
  const order = [];
  if (B.type === 'square') {
    for (let r = 0; r < B.N; r++) for (let c = 0; c < B.N; c++) order.push(r * B.N + (r % 2 ? B.N - 1 - c : c));
  } else {
    // one path per ring (each ring is a loop: drop the wrap)
    const paths = B.rings.map((R) => Array.from({ length: R.S }, (_, j) => R.first + j));
    return { pairs: paths.map((p) => [p[0], p[p.length - 1]]), paths, unique: false };
  }
  const k = Math.max(1, minP), len = Math.floor(order.length / k), paths = [];
  for (let i = 0; i < k; i++) paths.push(order.slice(i * len, i === k - 1 ? order.length : (i + 1) * len));
  return { pairs: paths.map((p) => [p[0], p[p.length - 1]]), paths, unique: false };
}

// ------------------------------------------------------------------ worker
// Loaded as a module worker, this file makes puzzles off the main thread (so a long uniqueness check never
// stalls a frame): post { id, shape, size, budget } → get back { id, pz }.
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  const boards = {};
  self.onmessage = (e) => {
    const { id, shape, size, budget } = e.data;
    const B = boards[shape + size] || (boards[shape + size] = makeBoard(shape, size));
    const pz = generate(B, { minP: B.spec.minP, maxP: B.spec.maxP, budget });
    self.postMessage({ id, pz });
  };
}
