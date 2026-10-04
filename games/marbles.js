// Marble Chain — a chain of marbles rolls along a track toward the vortex. Aim the orb, shoot marbles into
// the chain; three or more of a colour touching pop. When the gap closes and the colours meeting there match,
// they pop too (a chain reaction). Clear the whole chain to move on to the next level.
//
// Modes: Random (default) — every level is a new layout from marbles-gen.js: the shooter somewhere sensible,
// a random smooth track from an entry at the rim to a vortex; Easy / Normal / Hard change the chain's speed,
// colours, length, the track length and how fast it ramps up; on Hard some levels have TWO tracks at once, each
// with its own chain and vortex (one reaching its vortex loses, both must be cleared). Classic — the six
// hand-made tracks of marbles-paths.js in turn (mode id 'default' keeps the old top 5).
//
// Each track holds its own chain: a list of marbles ordered tail (index 0) → head, each at a distance `s` along
// the track (normalised: R = 1). The tail segment is pushed forward; segments in front stand still until they
// are pushed, unless the colours on both sides of a gap match — then the front part rolls back to close it.
import { TAU, clamp, lerp, pick, randInt, ease, THEME } from './kit.js';
import { PATHS, buildTable } from './marbles-paths.js';
import { generateLevel, levelSeed, makeRng } from './marbles-gen.js';

const MR = 0.042, D = MR * 2;         // marble radius / diameter (× R)
const SHOOTER_R = 0.1;                // the orb (× R)
const SHOT_V = 2.6;                   // shot speed (R per second)
const RUSH_V = 0.95;                  // the chain rolls in fast at the start of a track
const PULL_ACC = 3.2, PULL_MAX = 1.2; // the front part rolling back to close a gap
const COLS = [0, 1, 2, 3, 4, 6].map((i) => THEME.pieces[i]); // red yellow green blue purple cyan
const ACCENT2 = '#5ec8ff';            // the second track of a two-track level

/** Per difficulty: speed (R/s) at level 1 and its growth per level, colours by level, how much of the track the
 *  chain fills at level 1 (+ per level, capped). Classic plays like Normal. */
const DIFF = {
  easy: { name: 'Easy', v0: 0.042, dv: 0.05, vmax: 0.11, cols: (l) => (l <= 5 ? 4 : 5), f0: 0.45, df: 0.035, fmax: 1.0 },
  normal: { name: 'Normal', v0: 0.05, dv: 0.075, vmax: 0.14, cols: (l) => (l <= 2 ? 4 : l <= 7 ? 5 : 6), f0: 0.52, df: 0.045, fmax: 1.2 },
  hard: { name: 'Hard', v0: 0.058, dv: 0.09, vmax: 0.16, cols: (l) => (l <= 2 ? 5 : 6), f0: 0.6, df: 0.05, fmax: 1.3 },
};

let TABLES = null;
const tables = () => (TABLES ||= PATHS.map((p) => buildTable(p.pts())));

/** Position + unit tangent at distance s along the table → out[0..3]. */
function posAt(T, s, out) {
  const f = clamp(s, 0, T.L) / T.step;
  const i = Math.min(T.n - 1, Math.floor(f)), k = f - i;
  const x0 = T.xs[i], y0 = T.ys[i], x1 = T.xs[i + 1], y1 = T.ys[i + 1];
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  out[0] = x0 + (x1 - x0) * k; out[1] = y0 + (y1 - y0) * k; out[2] = (x1 - x0) / l; out[3] = (y1 - y0) / l;
  return out;
}

export default {
  howTo: 'Drag to aim, let go to shoot, tap the orb to swap. Three of a colour pop — stop the chain before the vortex. Random: a new layout every level; on Hard sometimes two tracks at once.',
  scoring: 'high',
  keyRepeat: true,
  modes: [
    { id: 'random', name: 'Random', options: [{ id: 'diff', name: 'Difficulty', default: 'normal',
      choices: [{ id: 'easy', name: 'Easy' }, { id: 'normal', name: 'Normal' }, { id: 'hard', name: 'Hard' }] }] },
    { id: 'default', name: 'Classic' },   // the original six tracks — same top 5 as before modes existed
  ],
  create(g, { mode, opts } = {}) {
    const classic = mode === 'default';
    const diff = classic ? 'normal' : (DIFF[opts?.diff] ? opts.diff : 'normal'), P = DIFF[diff];
    const T6 = classic ? tables() : null;
    const seed0 = (Math.random() * 2 ** 32) >>> 0, roundRng = makeRng(seed0 ^ 0x5bd1e995);
    const tmp = [0, 0, 0, 0];
    let level = 1, pi = 0, sx = 0, sy = 0, prevFam = null, lastTwo = 0;
    let tracks = [], shots = [], pops = [];
    let ncol = 4, speed = 0.06, streak = 0;
    let cur = 0, nxt = 1, aim = -Math.PI / 2, reload = 0, loadT = 1, swapT = 1, recoil = 0;
    let phase = 'play', phaseT = 0, fade = 0, lostV = 0, tickT = 0;
    let aiming = false, downOnShooter = false;
    let layer = null, layerKey = '', sprites = [], spriteHalf = 0;

    const X = (x) => g.cx + x * g.R, Y = (y) => g.cy + y * g.R;
    const mk = (c, s) => ({ c, s, k: 1, ft: 1, fx: 0, fy: 0, settle: false, pull: 0, pulling: false, chain: 0, x: 0, y: 0 });
    const touching = (bs, i) => bs[i].s - bs[i - 1].s <= MR * (bs[i].k + bs[i - 1].k) + 0.004;
    const mkTrack = (T, accent) => ({ T, accent, balls: [], rushing: true, reverseT: 0, danger: 0, done: false, clearT: -1 });

    // ------------------------------------------------------------------ levels
    function fillChain(trk, count) {
      let prev = -1, run = 0;
      trk.balls = [];
      for (let i = 0; i < count; i++) {
        let c = prev;
        if (prev < 0 || run >= 2 || Math.random() > 0.4) { do c = randInt(0, ncol - 1); while (c === prev); }
        run = c === prev ? run + 1 : 1; prev = c;
        trk.balls.push(mk(c, -(count - 1 - i) * D));
      }
    }
    function setupLevel() {
      let two = false;
      if (classic) {
        pi = (level - 1) % PATHS.length;
        [sx, sy] = PATHS[pi].shooter;
        tracks = [mkTrack(T6[pi], g.color)];
      } else {
        // Hard: from level 2 on, often two tracks — and never more than two single-track levels in a row
        two = diff === 'hard' && level >= 2 && (level - lastTwo >= 3 || roundRng() < 0.42);
        if (two) lastTwo = level;
        const lay = generateLevel(levelSeed(seed0, level), diff, { two, avoid: prevFam });
        prevFam = lay.fam;
        [sx, sy] = lay.shooter;
        tracks = lay.tracks.map((p, i) => mkTrack(buildTable(p), i ? ACCENT2 : g.color));
      }
      ncol = P.cols(level);
      speed = Math.min(P.vmax, P.v0 * (1 + P.dv * (level - 1))) * (two ? 0.9 : 1);
      const frac = Math.min(P.fmax, P.f0 + P.df * (level - 1)) * (two ? 0.85 : 1);
      for (const trk of tracks) fillChain(trk, Math.round((trk.T.L / D) * frac));
      shots = []; pops = []; streak = 0;
      cur = pickCol(); nxt = pickCol();
      // face the track: edge shooters look at the middle, a centred one at the first track's early part
      let ax = -sx, ay = -sy;
      if (Math.hypot(ax, ay) < 0.1) { posAt(tracks[0].T, tracks[0].T.L * 0.35, tmp); ax = tmp[0] - sx; ay = tmp[1] - sy; }
      aim = Math.atan2(ay, ax);
      phase = 'play'; phaseT = 0; fade = 0;
      if (classic) { g.sub(`Path ${pi + 1} · Level ${level}`); g.toast(`Path ${pi + 1}`, 1300); }
      else { g.sub(`Level ${level} · ${P.name}`); g.toast(two ? 'Two tracks!' : `Level ${level}`, 1300); }
      buildLayer();
    }
    function present() { const m = new Set(); for (const trk of tracks) for (const b of trk.balls) m.add(b.c); return m; }
    function pickCol() { const p = [...present()]; return p.length ? pick(p) : randInt(0, ncol - 1); }
    function fixColours() {
      const p = present(); if (!p.size) return;
      if (!p.has(cur)) { cur = pick([...p]); loadT = 0; }
      if (!p.has(nxt)) nxt = pick([...p]);
    }

    // ------------------------------------------------------------------ cached art (track + marble sprites)
    function buildSprites() {
      const r = MR * g.R, pad = r * 0.1, o = r + pad, size = o * 2;
      spriteHalf = o;
      sprites = COLS.map((col) => {
        const c = document.createElement('canvas');
        c.width = c.height = Math.ceil(size * g.dpr);
        const x = c.getContext('2d'); x.scale(g.dpr, g.dpr);
        // flat marble: one solid colour with a thin darker rim so touching marbles stay apart
        x.beginPath(); x.arc(o, o, r, 0, TAU); x.fillStyle = col; x.fill();
        x.beginPath(); x.arc(o, o, r - r * 0.06, 0, TAU);
        x.strokeStyle = g.draw.shade(col, -0.38); x.lineWidth = r * 0.12; x.stroke();
        return c;
      });
    }
    function trackPath(T, from = 0, to = T.n) {
      const p = new Path2D();
      for (let i = from; i <= to; i++) (i === from ? p.moveTo : p.lineTo).call(p, X(T.xs[i]), Y(T.ys[i]));
      return p;
    }
    function buildLayer() {
      if (!g.S || !tracks.length) return;
      const c = layer || document.createElement('canvas');
      c.width = c.height = Math.round(g.S * g.dpr);
      const x = c.getContext('2d');
      x.setTransform(g.dpr, 0, 0, g.dpr, 0, 0); x.clearRect(0, 0, g.S, g.S);
      const w = D * g.R, classicDark = THEME.id === 'classic' && !THEME.light;
      x.lineCap = 'round'; x.lineJoin = 'round';
      const paths = tracks.map((trk) => trackPath(trk.T));
      // halo first for every track, then the grooves, so two tracks never paint over each other's groove
      paths.forEach((p, i) => { x.strokeStyle = g.draw.alpha(tracks[i].accent, 0.07); x.lineWidth = w * 2; x.stroke(p); });
      paths.forEach((p, i) => {
        // the groove: a rim in the theme's line colour around a channel a little off the background
        x.setLineDash([]);
        x.strokeStyle = THEME.ink(0.17); x.lineWidth = w * 1.26; x.stroke(p);
        x.strokeStyle = classicDark ? '#07070a' : THEME.bg; x.lineWidth = w * 1.14; x.stroke(p);
        x.strokeStyle = THEME.ink(THEME.light ? 0.06 : 0.04); x.lineWidth = w * 1.14; x.stroke(p);
        x.setLineDash([1, w * 0.55]); x.strokeStyle = g.draw.alpha(tracks[i].accent, THEME.light ? 0.6 : 0.4); x.lineWidth = Math.max(1.5, w * 0.08); x.stroke(p);
      });
      layer = c; layerKey = THEME.id + THEME.mode;
    }
    function onResize() { buildSprites(); buildLayer(); }
    g.on('resize', onResize);
    buildSprites();
    setupLevel();

    // ------------------------------------------------------------------ shooting
    function fire() {
      if (phase !== 'play' || reload > 0 || fade < 0.6) return;
      const dx = Math.cos(aim), dy = Math.sin(aim);
      shots.push({ x: sx + dx * SHOOTER_R * 0.3, y: sy + dy * SHOOTER_R * 0.3, vx: dx * SHOT_V, vy: dy * SHOT_V, c: cur });
      cur = nxt; nxt = pickCol();
      reload = 0.16; loadT = 0; recoil = 1;
      g.sfx('flap', { volume: 0.7 });
    }
    function swap() {
      if (phase !== 'play' || cur === nxt) { swapT = 0; return; }
      [cur, nxt] = [nxt, cur]; swapT = 0; g.sfx('click');
    }
    function insert(trk, sh, j) {
      const bs = trk.balls, b = bs[j];
      posAt(trk.T, b.s, tmp);
      const ahead = (sh.x - b.x) * tmp[2] + (sh.y - b.y) * tmp[3] > 0;
      const nb = mk(sh.c, ahead ? b.s + MR : b.s - MR);
      Object.assign(nb, { k: 0, ft: 0, fx: sh.x, fy: sh.y, x: sh.x, y: sh.y, settle: true });
      bs.splice(ahead ? j + 1 : j, 0, nb);
      g.sfx('place', { volume: 0.7 });
    }

    // ------------------------------------------------------------------ matching
    function group(bs, i) {
      const c = bs[i].c; let lo = i, hi = i;
      while (lo > 0 && bs[lo - 1].c === c && touching(bs, lo)) lo--;
      while (hi < bs.length - 1 && bs[hi + 1].c === c && touching(bs, hi + 1)) hi++;
      return hi - lo + 1 >= 3 ? [lo, hi] : null;
    }
    function pop(trk, [lo, hi], level_) {
      const bs = trk.balls, gone = bs.splice(lo, hi - lo + 1);
      let pts = gone.length * 10 * level_ + Math.max(0, gone.length - 3) * 10;
      if (level_ > 1) pts += 50 * (level_ - 1);
      if (level_ === 1 && streak >= 3) pts += 20 * streak;
      g.add(pts);
      let mx = 0, my = 0;
      for (const b of gone) {
        mx += b.x; my += b.y;
        if (b.s > 0) { pops.push({ x: b.x, y: b.y, c: b.c, t: 0 }); g.draw.burst(X(b.x), Y(b.y), COLS[b.c], 6, g.R * 0.45, g.R * 0.011); }
      }
      mx /= gone.length; my /= gone.length;
      g.draw.float(`+${pts}`, X(mx), Y(my) - MR * g.R * 1.6, level_ > 1 ? (THEME.light ? '#d99a00' : '#ffe28a') : THEME.fg, g.R * (0.06 + 0.012 * Math.min(4, level_)));
      g.sfx('pop', { pitch: 1 + 0.14 * (level_ - 1) });
      if (level_ > 1) {
        g.toast(`Chain ×${level_}!`, 1000); g.sfx('coin', { volume: 0.8 }); g.vibrate(20);
        trk.reverseT = Math.max(trk.reverseT, 0.25 + 0.2 * level_); // the chain backs off a little
      } else if (streak >= 3) g.toast(`Combo ×${streak}`, 900);
      // the gap: if the same colour meets across it, the front part rolls back (and remembers the chain level)
      if (lo > 0 && lo < bs.length) { const f = bs[lo]; f.chain = bs[lo - 1].c === f.c ? level_ : 0; f.pull = 0; }
      fixColours();
      if (!bs.length) trackCleared(trk);
    }
    function trackCleared(trk) {
      trk.done = true; trk.clearT = 0; trk.danger = 0;
      const n = trk.T.n;
      if (tracks.every((t) => t.done)) { clearLevel(); return; }
      // one of two tracks is empty: a little reward, the other one is still rolling
      g.add(200); g.sfx('score'); g.vibrate(20);
      g.toast('Track clear! +200', 1200);
      g.draw.burst(X(trk.T.xs[n]), Y(trk.T.ys[n]), trk.accent, 18, g.R * 0.55, g.R * 0.012);
    }
    function clearLevel() {
      phase = 'clear'; phaseT = 0; shots = [];
      const bonus = 500 + 250 * level + (tracks.length > 1 ? 300 : 0);
      g.add(bonus); g.sfx('win'); g.vibrate(30);
      g.toast(`${classic ? 'Path' : 'Level'} clear! +${bonus}`, 1800);
      for (const trk of tracks) {
        const n = trk.T.n;
        if (trk.clearT < 0 || trk.clearT > 1.5) trk.clearT = 0;
        g.draw.burst(X(trk.T.xs[n]), Y(trk.T.ys[n]), trk.accent, 26, g.R * 0.7, g.R * 0.014);
      }
    }
    function lose() {
      phase = 'lose'; phaseT = 0; lostV = 0.5; shots = [];
      g.sfx('boom'); g.vibrate(60);
      if (classic) g.over(g.scoreValue, { label: `Path ${pi + 1}`, note: `The chain reached the vortex · path ${pi + 1}, level ${level}.`, delay: 2200 });
      else g.over(g.scoreValue, { label: `Level ${level}`, note: `The chain reached the vortex on level ${level} (${P.name}).`, delay: 2200 });
    }

    // ------------------------------------------------------------------ input
    const local = (p) => [p.dx / g.R - sx, p.dy / g.R - sy];
    const onShooter = (p) => Math.hypot(...local(p)) < SHOOTER_R * 1.3;
    const aimAt = (p) => { const [x, y] = local(p); if (Math.hypot(x, y) > SHOOTER_R * 0.5) aim = Math.atan2(y, x); };
    g.on('down', (p) => { if (onShooter(p)) { downOnShooter = true; aiming = false; } else { aiming = true; aimAt(p); } });
    g.on('move', (p) => {
      if (downOnShooter) { if (!onShooter(p)) { downOnShooter = false; aiming = true; aimAt(p); } return; }
      if (aiming || !onShooter(p)) aimAt(p);
    });
    g.on('up', (p) => {
      if (downOnShooter) { downOnShooter = false; if (onShooter(p)) swap(); return; }
      if (aiming) { aiming = false; aimAt(p); fire(); }
    });
    g.on('key', (e) => {
      if (e.key === 'ArrowLeft') aim -= 0.065;
      else if (e.key === 'ArrowRight') aim += 0.065;
      else if (e.key === ' ' || e.key === 'Enter') fire();
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.repeat) swap();
    });
    g.on('wheel', (e) => { aim += e.delta * 0.065; });

    // ------------------------------------------------------------------ simulation (one track)
    function stepChain(trk, dt) {
      const bs = trk.balls, T = trk.T, n = bs.length;
      if (!n) return;
      // 1. push the tail segment
      let e = 0; while (e + 1 < n && touching(bs, e + 1)) e++;
      const front = bs[e].s;
      if (trk.rushing && front >= T.L * 0.25) trk.rushing = false;
      let v = speed * (bs[n - 1].s > T.L * 0.85 ? 0.7 : 1);
      if (trk.rushing) v = lerp(speed, RUSH_V, clamp((T.L * 0.25 - front) / (T.L * 0.09), 0, 1));
      if (front < D) v = Math.max(v, 0.5);            // nothing on the track yet: roll in
      if (trk.reverseT > 0) { trk.reverseT -= dt; v = -0.32; }
      for (let i = 0; i <= e; i++) bs[i].s += v * dt;
      // 2. same colour on both sides of a gap → the front part rolls back
      for (let i = 1; i < n; i++) {
        const b = bs[i];
        if (!touching(bs, i) && bs[i - 1].c === b.c) {
          b.pull = Math.min(PULL_MAX, b.pull + PULL_ACC * dt); b.pulling = true;
          let j = i + 1; while (j < n && touching(bs, j)) j++;
          for (let k = i; k < j; k++) bs[k].s -= b.pull * dt;
          i = j - 1;
        } else if (b.pulling) { b.pulling = false; b.pull = 0; }
      }
      // 3. keep the spacing (pushing forward), grow freshly inserted marbles, catch gaps that just closed
      const joins = [];
      for (let i = 0; i < n; i++) {
        const b = bs[i];
        if (b.k < 1) b.k = Math.min(1, b.k + dt / 0.14);
        if (b.ft < 1) b.ft = Math.min(1, b.ft + dt / 0.12);
        if (!i) continue;
        const a = bs[i - 1], sp = MR * (a.k + b.k);
        if (b.pulling && b.s <= a.s + sp + 0.004) { b.pulling = false; b.pull = 0; joins.push(b); }
        if (b.s < a.s + sp) b.s = a.s + sp;
      }
      // 4. a closed gap with matching colours can pop again: a chain reaction
      for (const b of joins) {
        const i = bs.indexOf(b); if (i < 0) continue;
        const grp = group(bs, i);
        if (grp) pop(trk, grp, b.chain + 1); else { b.chain = 0; g.sfx('hit', { volume: 0.4 }); }
        if (phase !== 'play' || trk.done) return;
      }
      // 5. a shot that has settled in its slot: does it make three?
      const settled = bs.filter((b) => b.settle && b.k >= 1 && b.ft >= 1);
      for (const b of settled) {
        b.settle = false;
        const i = bs.indexOf(b); if (i < 0) continue;
        const grp = group(bs, i);
        if (grp) { streak++; pop(trk, grp, 1); } else streak = 0;
        if (phase !== 'play' || trk.done) return;
      }
    }
    function placeBalls(trk) {
      for (const b of trk.balls) {
        posAt(trk.T, b.s, tmp);
        let x = tmp[0], y = tmp[1];
        if (b.ft < 1) { const k = ease.out(b.ft); x = lerp(b.fx, x, k); y = lerp(b.fy, y, k); }
        b.x = x; b.y = y;
      }
    }
    function stepShots(dt) {
      for (let k = shots.length - 1; k >= 0; k--) {
        const sh = shots[k];
        const sub = Math.max(1, Math.ceil((SHOT_V * dt) / (MR * 0.7)));
        let hit = -1, hitTrk = null;
        for (let q = 0; q < sub && hit < 0; q++) {
          sh.x += (sh.vx * dt) / sub; sh.y += (sh.vy * dt) / sub;
          let best = (D * 0.92) ** 2;
          for (const trk of tracks) {          // whichever chain's marble it touches first
            const bs = trk.balls, L = trk.T.L;
            for (let i = 0; i < bs.length; i++) {
              const b = bs[i];
              if (b.s < MR || b.s > L - MR) continue;
              const dx = b.x - sh.x, dy = b.y - sh.y, d2 = dx * dx + dy * dy;
              if (d2 < best) { best = d2; hit = i; hitTrk = trk; }
            }
          }
        }
        if (hit >= 0) { insert(hitTrk, sh, hit); shots.splice(k, 1); }
        else if (Math.hypot(sh.x, sh.y) > 1.05) { shots.splice(k, 1); streak = 0; }
      }
    }

    // ------------------------------------------------------------------ drawing
    function drawVortex(trk, t) {
      const { ctx } = g, T = trk.T, n = T.n;
      const hx = X(T.xs[n]), hy = Y(T.ys[n]), rv = g.R * 0.078, danger = trk.danger;
      const col = danger > 0 ? THEME.danger : trk.accent;
      const calm = trk.done ? 0.45 : 1;          // an empty track's vortex slows down and fades a little
      ctx.save();
      // flat: a solid tinted disc with a solid dark hole in it
      ctx.fillStyle = g.draw.alpha(col, (0.16 + 0.22 * danger) * calm); ctx.beginPath(); ctx.arc(hx, hy, rv * 1.45, 0, TAU); ctx.fill();
      ctx.fillStyle = THEME.shade(THEME.light ? 0.75 : 1); ctx.beginPath(); ctx.arc(hx, hy, rv * 1.12, 0, TAU); ctx.fill();
      ctx.lineCap = 'round';
      const spin = t * (2.2 + 4 * danger) * (trk.done ? 0.35 : 1);
      ctx.strokeStyle = g.draw.alpha(col, 0.75 * calm); ctx.lineWidth = g.R * 0.008;
      for (let k = 0; k < 4; k++) {           // swirling arms
        ctx.beginPath();
        for (let q = 0; q <= 14; q++) {
          const u = q / 14, a = spin + k * (TAU / 4) + u * 2.4, r = rv * (1.15 - 0.85 * u);
          q ? ctx.lineTo(hx + Math.cos(a) * r, hy + Math.sin(a) * r) : ctx.moveTo(hx + Math.cos(a) * r, hy + Math.sin(a) * r);
        }
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(hx, hy, rv * 1.12, 0, TAU);
      if (THEME.glow && !trk.done) { ctx.shadowColor = col; ctx.shadowBlur = g.R * (0.025 + 0.04 * danger); }
      ctx.strokeStyle = g.draw.alpha(col, (0.55 + 0.35 * danger) * calm); ctx.lineWidth = g.R * 0.009; ctx.stroke();
      ctx.restore();
      g.draw.circle(hx, hy, rv * 0.32, THEME.shade(1));
    }
    function drawEntry(trk, t) {            // where the chain comes in: a dashed oval across the track + a chevron
      const { ctx } = g;
      posAt(trk.T, 0, tmp);
      const x = X(tmp[0]), y = Y(tmp[1]), r = MR * g.R * 1.55, a = Math.atan2(tmp[3], tmp[2]);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.45, r, 0, 0, TAU);
      ctx.fillStyle = THEME.shade(THEME.light ? 0.25 : 0.6); ctx.fill();
      ctx.setLineDash([r * 0.35, r * 0.25]); ctx.lineDashOffset = -t * r * 2;
      ctx.strokeStyle = g.draw.alpha(trk.accent, 0.8); ctx.lineWidth = g.R * 0.008;
      ctx.stroke();
      if (!classic) {
        ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const o = -r * (1.05 + 0.12 * Math.sin(t * 4));
        ctx.beginPath(); ctx.moveTo(o - r * 0.32, -r * 0.42); ctx.lineTo(o, 0); ctx.lineTo(o - r * 0.32, r * 0.42);
        ctx.strokeStyle = g.draw.alpha(trk.accent, 0.7); ctx.stroke();
      }
      ctx.restore();
    }
    function drawDanger(trk, t) {
      if (trk.danger <= 0) return;
      const { ctx } = g, T = trk.T;
      const from = Math.max(0, Math.floor((T.L * 0.8) / T.step));
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = g.draw.alpha(THEME.danger, trk.danger * (0.18 + 0.12 * Math.sin(t * 9)));
      ctx.lineWidth = D * g.R * 1.3; ctx.stroke(trackPath(T, from));
      ctx.restore();
    }
    function drawSweep(trk) {          // a light running along the empty track after it's cleared
      const k = clamp(trk.clearT / 1.5, 0, 1);
      if (trk.clearT < 0 || k <= 0 || k >= 1) return;
      const { ctx } = g, T = trk.T, head = Math.floor((ease.inOut(k) * T.L) / T.step), from = Math.max(0, head - 40);
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha *= Math.sin(k * Math.PI);
      ctx.strokeStyle = g.draw.alpha(trk.accent, 0.55); ctx.lineWidth = D * g.R * 0.5;
      if (THEME.glow) { ctx.shadowColor = trk.accent; ctx.shadowBlur = g.R * 0.05; }
      ctx.stroke(trackPath(T, from, Math.max(from + 1, head)));
      ctx.restore();
    }
    function sprite(c, x, y, sc = 1, a = 1) {
      const { ctx } = g, h = spriteHalf * sc;
      if (a < 1) ctx.globalAlpha = a;
      ctx.drawImage(sprites[c], x - h, y - h, h * 2, h * 2);
      if (a < 1) ctx.globalAlpha = 1;
    }
    function rayHit(ox, oy, dx, dy) {     // distance along the aim to the first marble (or the rim)
      let best = Infinity;
      const rr = (D * 0.92) ** 2;
      for (const trk of tracks) {
        const L = trk.T.L;
        for (const b of trk.balls) {
          if (b.s < MR || b.s > L - MR) continue;
          const px = b.x - ox, py = b.y - oy, along = px * dx + py * dy;
          if (along <= 0) continue;
          const perp2 = px * px + py * py - along * along;
          if (perp2 < rr) best = Math.min(best, along - Math.sqrt(rr - perp2));
        }
      }
      if (best < Infinity) return [best, true];
      const b = ox * dx + oy * dy, c = ox * ox + oy * oy - 0.93 ** 2;
      return [-b + Math.sqrt(Math.max(0, b * b - c)), false];
    }
    function drawShooter(t) {
      const { ctx } = g;
      const x = X(sx), y = Y(sy), rs = SHOOTER_R * g.R, dx = Math.cos(aim), dy = Math.sin(aim);
      const col = COLS[cur];
      // aim guide
      if (phase === 'play') {
        const [len, onBall] = rayHit(sx + dx * SHOOTER_R * 1.4, sy + dy * SHOOTER_R * 1.4, dx, dy);
        const x0 = x + dx * rs * 1.4, y0 = y + dy * rs * 1.4, x1 = x0 + dx * len * g.R, y1 = y0 + dy * len * g.R;
        ctx.save();
        ctx.setLineDash([g.R * 0.008, g.R * 0.03]); ctx.lineDashOffset = -t * g.R * 0.12; ctx.lineCap = 'round';
        ctx.strokeStyle = g.draw.alpha(col, THEME.light ? 0.85 : 0.55); ctx.lineWidth = g.R * 0.009;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.restore();
        if (onBall) g.draw.circle(x1 + dx * MR * g.R, y1 + dy * MR * g.R, MR * g.R * 1.05, null, { stroke: g.draw.alpha(col, 0.7), lw: 2 });
      }
      // the orb
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, rs, 0, TAU);
      if (THEME.id === 'classic' && !THEME.light) { ctx.fillStyle = '#17171c'; ctx.fill(); }
      else { ctx.fillStyle = THEME.bg; ctx.fill(); ctx.fillStyle = THEME.ink(0.07); ctx.fill(); }
      ctx.strokeStyle = THEME.ink(0.2); ctx.lineWidth = 1.5; ctx.stroke();
      // flat ring segments in the loaded colour
      ctx.lineCap = 'round';
      ctx.strokeStyle = col; ctx.lineWidth = g.R * 0.011;
      for (let k = 0; k < 3; k++) {
        const a = t * 0.7 + (k * TAU) / 3;
        ctx.beginPath(); ctx.arc(x, y, rs * 1.13, a, a + 1.3); ctx.stroke();
      }
      // pointer
      ctx.translate(x, y); ctx.rotate(aim);
      ctx.beginPath(); ctx.moveTo(rs * 1.62, 0); ctx.lineTo(rs * 1.28, -rs * 0.24); ctx.lineTo(rs * 1.36, 0); ctx.lineTo(rs * 1.28, rs * 0.24); ctx.closePath();
      ctx.fillStyle = THEME.fg; ctx.fill();
      ctx.restore();
      // next marble behind, current one in the middle (slides in after a shot, little pop on swap)
      const nb = (1 - ease.out(Math.min(1, swapT))) * 0.25;
      sprite(nxt, x - dx * rs * 0.62, y - dy * rs * 0.62, 0.5 + nb);
      const k = ease.back(Math.min(1, loadT)), rc = recoil * rs * 0.25;
      sprite(cur, x - dx * rc, y - dy * rc, (0.35 + 0.65 * k) * (1 + nb));
    }

    // ------------------------------------------------------------------ frame
    g.loop((dt, t) => {
      const { ctx } = g;
      phaseT += dt;
      reload = Math.max(0, reload - dt); loadT = Math.min(1, loadT + dt / 0.2); swapT += dt / 0.25;
      recoil = Math.max(0, recoil - dt * 6);
      for (const trk of tracks) if (trk.clearT >= 0) trk.clearT += dt;
      if (phase === 'play') {
        fade = Math.min(1, fade + dt / 0.5);
        for (const trk of tracks) { stepChain(trk, dt); if (phase !== 'play') break; }
        if (phase === 'play') {
          for (const trk of tracks) placeBalls(trk);
          stepShots(dt);
          let danger = 0, lost = false;
          for (const trk of tracks) {
            placeBalls(trk);
            const bs = trk.balls, head = bs.length ? bs[bs.length - 1].s : 0;
            trk.danger = trk.done ? 0 : clamp((head / trk.T.L - 0.78) / 0.16, 0, 1);
            danger = Math.max(danger, trk.danger);
            if (bs.length && head >= trk.T.L - MR * 0.4) lost = true;
          }
          if (danger > 0.4 && (tickT -= dt) <= 0) { g.sfx('tick'); tickT = lerp(0.9, 0.35, danger); }
          if (lost) lose();
        }
      } else if (phase === 'clear') {
        for (const trk of tracks) trk.danger = 0;
        if (phaseT > 1.6) fade = Math.max(0, fade - dt / 0.45);
        if (phaseT > 2.2) { level++; setupLevel(); }
      } else if (phase === 'lose') {
        lostV = Math.min(4, lostV + dt * 3);
        for (const trk of tracks) {
          for (const b of trk.balls) b.s += lostV * dt;
          trk.balls = trk.balls.filter((b) => b.s < trk.T.L);
          placeBalls(trk);
          if (!trk.done) trk.danger = 1;
        }
      }

      // ---- draw ----
      g.draw.bg({ glow: 0.13 });
      ctx.save();
      ctx.globalAlpha = fade;
      if (layerKey !== THEME.id + THEME.mode) buildLayer();   // the theme changed
      if (layer) ctx.drawImage(layer, 0, 0, g.S, g.S);
      for (const trk of tracks) { drawDanger(trk, t); drawSweep(trk); }
      for (const trk of tracks) { drawEntry(trk, t); drawVortex(trk, t); }
      ctx.restore();
      for (const trk of tracks) {
        const L = trk.T.L;
        for (const b of trk.balls) {
          if (b.s <= 0) continue;
          const sc = Math.min(clamp(b.s / D, 0.2, 1), clamp((L - b.s) / (D * 1.6), 0.15, 1));
          sprite(b.c, X(b.x), Y(b.y), sc, fade);
        }
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i]; p.t += dt;
        if (p.t > 0.32) { pops.splice(i, 1); continue; }
        const k = p.t / 0.32;
        if (k < 0.5) sprite(p.c, X(p.x), Y(p.y), 1 + k * 0.8, 1 - k * 2);
        g.draw.circle(X(p.x), Y(p.y), MR * g.R * (1 + k * 1.6), null, { stroke: g.draw.alpha(COLS[p.c], 1 - k), lw: g.R * 0.008 * (1 - k) + 0.5 });
      }
      for (const sh of shots) {
        for (let q = 3; q >= 1; q--) sprite(sh.c, X(sh.x - sh.vx * q * 0.012), Y(sh.y - sh.vy * q * 0.012), 1 - q * 0.15, 0.25 / q);
        sprite(sh.c, X(sh.x), Y(sh.y));
      }
      if (phase !== 'lose') {
        ctx.save(); ctx.globalAlpha = phase === 'clear' ? fade : 1; drawShooter(t); ctx.restore();
      }
      g.draw.particles(dt);
      g.draw.floaters(dt);
    });
    return {};
  },
};
