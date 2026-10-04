// Bubble Shooter — a cluster of bubbles sits around a glowing core in the middle of the screen and
// slowly turns. Your shooter rides the rim: touch / drag to aim (it always fires at the centre), let go
// to shoot. Three or more of a colour pop; anything no longer hanging on the core flies away for a bonus.
// Shots that pop nothing count down to a new ring of bubbles; let the cluster cross the red ring and it's over.
import { TAU, clamp, rand, ease, polar, THEME } from './kit.js';

const B = 0.048;                 // bubble radius, × R
const DANGER = 0.78;             // the red ring, × R
const GUN = 0.872;               // where the shooter sits, × R
const SPEED = 2.7;               // shot speed, R per second
const HIT = 2 * B * 0.86;        // contact distance (a little forgiving)
const SQ3 = Math.sqrt(3);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
const key = (q, r) => (q + 512) * 1024 + (r + 512);
const hexXY = (q, r) => [2 * B * (q + r / 2), SQ3 * B * r];

function spec(L) {
  return {
    radius: Math.min(0.3 + 0.04 * (L - 1), 0.46),
    colours: L <= 2 ? 4 : L <= 4 ? 5 : 6,
    shots: L <= 2 ? 6 : L <= 4 ? 5 : 4,
    spin: (0.11 + 0.025 * Math.min(L, 8)) * (L % 2 ? 1 : -1),
  };
}

export default {
  howTo: 'Touch around the rim to aim, let go to shoot into the cluster. Match 3 to pop; cut bubbles loose from the core for a bonus. Tap your bubble to swap.',
  scoring: 'high',
  create(g) {
    const P = g.theme.pieces;
    const PALETTE = [P[0], P[1], P[2], P[3], P[4], P[5]];
    const cells = new Map();
    const core = { q: 0, r: 0, x: 0, y: 0, core: true, born: 0 };
    let level = 1, sp = spec(1), palette = PALETTE.slice(0, sp.colours);
    let rot = 0, aim = Math.PI * 1.25, cur = null, next = null, shot = null;
    let misses = 0, phase = 'play', now = 0, wait = 0, overT = 0, swapT = -9, fireT = -9;
    let pointer = null, keyDir = 0, keyHeld = 0, lastPop = -1, dangerHot = 0, grewT = -9;
    const popping = [], falling = [];
    const sprites = new Map();
    let spriteFor = '';

    // ---------- the grid ----------
    const nbrs = (b) => { const out = []; for (const [dq, dr] of DIRS) { const n = cells.get(key(b.q + dq, b.r + dr)); if (n) out.push(n); } return out; };
    function put(q, r, col, born = now) {
      const [x, y] = hexXY(q, r);
      const b = { q, r, x, y, col, born, core: false };
      cells.set(key(q, r), b);
      return b;
    }
    function present() { const s = new Set(); for (const b of cells.values()) if (!b.core) s.add(b.col); return [...s]; }
    function randCol() { const p = present(); return (p.length ? p : palette)[Math.floor(Math.random() * (p.length || palette.length))]; }
    function clumpCol(q, r) {
      const around = [];
      for (const [dq, dr] of DIRS) { const n = cells.get(key(q + dq, r + dr)); if (n && !n.core) around.push(n.col); }
      return around.length && Math.random() < 0.5 ? around[Math.floor(Math.random() * around.length)] : palette[Math.floor(Math.random() * palette.length)];
    }
    function fillLevel() {
      cells.clear(); cells.set(key(0, 0), core);
      sp = spec(level); palette = PALETTE.slice(0, sp.colours);
      const list = [];
      for (let q = -14; q <= 14; q++) for (let r = -14; r <= 14; r++) {
        if (!q && !r) continue;
        const [x, y] = hexXY(q, r), d = Math.hypot(x, y);
        if (d <= sp.radius) list.push([q, r, d]);
      }
      list.sort((a, b) => a[2] - b[2]);
      for (const [q, r, d] of list) put(q, r, clumpCol(q, r), now + 0.1 + d * 1.6);
      misses = 0; cur = randCol(); next = randCol();
      updateSub();
    }
    function updateSub() { g.sub(`Level ${level}  ·  ${'●'.repeat(Math.max(0, sp.shots - misses))}${'○'.repeat(Math.min(sp.shots, misses))}`); }

    // the cluster's frame (it turns by `rot`) ↔ the screen, both in R units around the centre
    const toCluster = (wx, wy) => { const c = Math.cos(rot), s = Math.sin(rot); return [wx * c + wy * s, -wx * s + wy * c]; };
    const toWorld = (x, y) => { const c = Math.cos(rot), s = Math.sin(rot); return [x * c - y * s, x * s + y * c]; };

    function touching(x, y) {
      let best = null, bd = HIT;
      for (const b of cells.values()) { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
      return best;
    }
    /** The free cell the shot (at x, y in the cluster frame) settles in. */
    function snapCell(x, y) {
      let best = null, bd = Infinity;
      for (const b of cells.values()) {
        if (Math.hypot(b.x - x, b.y - y) > HIT * 1.45) continue;
        for (const [dq, dr] of DIRS) {
          const q = b.q + dq, r = b.r + dr;
          if (cells.has(key(q, r))) continue;
          const [cx, cy] = hexXY(q, r), d = Math.hypot(cx - x, cy - y);
          if (d < bd) { bd = d; best = [q, r]; }
        }
      }
      return best;
    }
    /** March along the line of fire: where would a shot touch the cluster right now? */
    function predict(a) {
      const step = B * 0.35;
      for (let d = Math.min(GUN, extent() + HIT); d > 0; d -= step) {
        const [x, y] = toCluster(Math.sin(a) * d, -Math.cos(a) * d);
        if (touching(x, y)) return { d, cell: snapCell(x, y) };
      }
      return { d: 0, cell: null };
    }

    // ---------- shooting ----------
    function fire() {
      if (shot || phase !== 'play' || !cur) return;
      shot = { a: aim, d: GUN - B * 0.2, col: cur };
      cur = next; next = randCol(); fireT = now;
      g.sfx('jump', { pitch: 1.3, volume: 0.7 });
    }
    function swap() {
      if (phase !== 'play' || !next) return;
      [cur, next] = [next, cur]; swapT = now; g.sfx('click');
    }
    function land(x, y) {
      const cell = snapCell(x, y);
      const col = shot.col; shot = null;
      if (!cell) return;
      const b = put(cell[0], cell[1], col, now - 1);
      b.snap = now;
      g.sfx('place', { volume: 0.8 });
      // matches
      const grp = [b], seen = new Set([key(b.q, b.r)]);
      for (let i = 0; i < grp.length; i++) for (const n of nbrs(grp[i])) {
        const k = key(n.q, n.r);
        if (!n.core && n.col === col && !seen.has(k)) { seen.add(k); grp.push(n); }
      }
      if (grp.length >= 3) {
        grp.forEach((p, i) => { cells.delete(key(p.q, p.r)); popping.push({ ...p, delay: now + i * 0.045, done: false }); });
        // whatever no longer hangs on the core falls away
        const held = new Set([key(0, 0)]), q = [core];
        for (let i = 0; i < q.length; i++) for (const n of nbrs(q[i])) { const k = key(n.q, n.r); if (!held.has(k)) { held.add(k); q.push(n); } }
        const loose = [...cells.values()].filter((c) => !held.has(key(c.q, c.r)));
        for (const c of loose) {
          cells.delete(key(c.q, c.r));
          const [wx, wy] = toWorld(c.x, c.y), d = Math.hypot(wx, wy) || 1;
          const out = rand(0.5, 0.9), tang = sp.spin * d;
          falling.push({ x: wx, y: wy, vx: (wx / d) * out - (wy / d) * tang + rand(-0.1, 0.1), vy: (wy / d) * out + (wx / d) * tang + rand(-0.1, 0.1), col: c.col, t: 0 });
        }
        const pts = grp.length * 10 + loose.length * 25 * (loose.length >= 6 ? 2 : 1);
        g.add(pts);
        const [fx, fy] = toWorld(b.x, b.y);
        g.draw.float(`+${pts}`, g.cx + fx * g.R, g.cy + fy * g.R - g.R * 0.05, THEME.fg, g.R * (pts >= 100 ? 0.085 : 0.065));
        if (loose.length) { g.sfx('coin'); if (loose.length >= 6) g.toast(loose.length >= 12 ? 'Avalanche!' : 'Nice drop!', 900); }
        g.vibrate(grp.length + loose.length > 6 ? 25 : 10);
        if (cur && !present().includes(cur)) cur = randCol();
        if (next && !present().includes(next)) next = randCol();
        if (![...cells.values()].some((c) => !c.core)) { clearLevel(); return; }
      } else {
        misses++;
        if (misses >= sp.shots) { grow(); misses = 0; }
      }
      updateSub();
      checkDanger();
    }
    function grow() {
      const add = new Map();
      for (const b of cells.values()) for (const [dq, dr] of DIRS) {
        const q = b.q + dq, r = b.r + dr, k = key(q, r);
        if (!cells.has(k) && !add.has(k)) add.set(k, [q, r]);
      }
      for (const [q, r] of add.values()) { const [x, y] = hexXY(q, r); put(q, r, clumpCol(q, r), now + Math.hypot(x, y) * 0.5); }
      grewT = now;
      g.sfx('whoosh'); g.vibrate(20);
      g.toast('New ring!', 800);
    }
    function extent() { let m = 0; for (const b of cells.values()) m = Math.max(m, Math.hypot(b.x, b.y)); return m + B; }
    function checkDanger() {
      if (phase === 'play' && extent() > DANGER) {
        phase = 'over'; overT = now;
        g.vibrate(60); g.sfx('hit');
        g.over(g.scoreValue, { note: `You reached level ${level}.`, label: `Level ${level}`, delay: 1700 });
      }
    }
    function clearLevel() {
      const bonus = 250 * level;
      g.add(bonus); g.sfx('perfect'); g.vibrate(40);
      g.draw.float(`+${bonus}`, g.cx, g.cy - g.R * 0.14, g.color, g.R * 0.1);
      g.toast(`Level ${level + 1}`, 1200);
      g.draw.burst(g.cx, g.cy, THEME.fg, 40, g.R * 0.9, g.R * 0.012);
      phase = 'clear'; wait = 1.4;
    }

    // ---------- input ----------
    const gunXY = () => polar(g.cx, g.cy, aim, GUN * g.R);
    g.on('down', (p) => {
      const [gx, gy] = gunXY();
      pointer = { x: p.x, y: p.y, swap: Math.hypot(p.x - gx, p.y - gy) < g.R * B * 2.2 };
      if (!pointer.swap && p.r > 0.1) aim = p.a;
    });
    g.on('move', (p) => {
      if (!pointer) return;
      if (Math.hypot(p.x - pointer.x, p.y - pointer.y) > g.R * 0.05) pointer.swap = false;
      if (!pointer.swap && p.r > 0.1) aim = p.a;
    });
    g.on('up', () => {
      if (!pointer) return;
      const s = pointer.swap; pointer = null;
      if (s) swap(); else fire();
    });
    g.on('key', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { keyDir = e.key === 'ArrowLeft' ? -1 : 1; keyHeld = 0; aim += keyDir * 0.05; }
      else if (e.key === ' ' || e.key === 'Enter') fire();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') swap();
    });
    g.on('keyup', (e) => { if ((e.key === 'ArrowLeft' && keyDir < 0) || (e.key === 'ArrowRight' && keyDir > 0)) keyDir = 0; });
    g.on('wheel', (e) => { aim += e.delta * 0.07; });

    fillLevel();
    g.toast('Drag to aim · let go to shoot', 1800);

    // ---------- drawing ----------
    function sprite(col) {
      const id = `${col}|${g.R}|${g.dpr}`;
      let s = sprites.get(id);
      if (s) return s;
      const r = B * g.R, pad = 2, size = Math.ceil((r + pad) * 2 * g.dpr);
      const c = document.createElement('canvas'); c.width = c.height = size;
      const x = c.getContext('2d'); x.scale(g.dpr, g.dpr);
      const m = r + pad;
      // flat bubble: one solid colour and a thin darker rim so neighbours stay apart
      x.fillStyle = col; x.beginPath(); x.arc(m, m, r, 0, TAU); x.fill();
      const lw = Math.max(1, r * 0.1);
      x.strokeStyle = g.draw.shade(col, -0.35); x.lineWidth = lw; x.beginPath(); x.arc(m, m, r - lw / 2, 0, TAU); x.stroke();
      s = { c, m }; sprites.set(id, s);
      return s;
    }
    function bubble(x, y, col, scale = 1, alpha = 1) {
      if (scale <= 0.01 || alpha <= 0.01) return;
      const s = sprite(col), w = (s.m * 2) * scale;
      g.ctx.globalAlpha = alpha;
      g.ctx.drawImage(s.c, x - w / 2, y - w / 2, w, w);
      g.ctx.globalAlpha = 1;
    }

    g.loop((dt, t) => {
      now += dt;
      const { ctx, cx, cy, R } = g;
      if (spriteFor !== `${R}|${g.dpr}`) { sprites.clear(); spriteFor = `${R}|${g.dpr}`; }

      // ---- update ----
      if (phase === 'play' || phase === 'clear') rot += sp.spin * dt;
      if (keyDir) { keyHeld += dt; if (keyHeld > 0.16) aim += keyDir * 2.0 * dt; }
      aim = ((aim % TAU) + TAU) % TAU;
      if (shot) {
        const steps = Math.max(1, Math.ceil((SPEED * dt) / (B * 0.4)));
        for (let i = 0; i < steps && shot; i++) {
          shot.d -= (SPEED * dt) / steps;
          const [x, y] = toCluster(Math.sin(shot.a) * shot.d, -Math.cos(shot.a) * shot.d);
          if (touching(x, y) || shot.d <= 0) land(x, y);
        }
      }
      if (phase === 'clear' && (wait -= dt) <= 0) { level++; fillLevel(); phase = 'play'; }
      const ext = extent();
      dangerHot += ((ext > DANGER - SQ3 * B * 1.05 ? 1 : 0) - dangerHot) * Math.min(1, dt * 4);

      // ---- draw ----
      g.draw.bg({ glow: 0.13 + 0.05 * Math.sin(t * 1.3) ** 2 });
      // danger ring
      ctx.save();
      ctx.setLineDash([R * 0.022, R * 0.026]); ctx.lineDashOffset = -t * R * 0.03;
      ctx.beginPath(); ctx.arc(cx, cy, DANGER * R, 0, TAU);
      const flash = phase === 'over' ? 0.5 + 0.5 * Math.sin((now - overT) * 18) : dangerHot * (0.6 + 0.4 * Math.sin(t * 6));
      ctx.strokeStyle = g.draw.alpha('#ff5a6a', 0.38 + 0.6 * flash);
      ctx.lineWidth = R * (0.007 + 0.004 * flash); ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();

      // aim line + landing ghost
      if (phase === 'play' && cur) {
        const pr = predict(aim);
        const [gx, gy] = gunXY();
        ctx.fillStyle = g.draw.alpha(cur, 0.85);
        const from = GUN - B * 1.6, gap = 0.04;
        for (let d = from, i = 0; d > pr.d + B * 0.6; d -= gap, i++) {
          const [px, py] = polar(cx, cy, aim, d * R);
          ctx.globalAlpha = 0.25 + 0.55 * clamp((d - pr.d) / 0.3, 0, 1);
          ctx.beginPath(); ctx.arc(px, py, R * 0.007, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (pr.cell && !shot) {
          const [hx, hy] = hexXY(pr.cell[0], pr.cell[1]), [wx, wy] = toWorld(hx, hy);
          ctx.beginPath(); ctx.arc(cx + wx * R, cy + wy * R, B * R * 0.92, 0, TAU);
          ctx.strokeStyle = g.draw.alpha(cur, 0.55); ctx.lineWidth = Math.max(1.5, R * 0.005);
          ctx.setLineDash([R * 0.012, R * 0.01]); ctx.stroke(); ctx.setLineDash([]);
        }
        void gx; void gy;
      }

      // the cluster
      const c0 = Math.cos(rot), s0 = Math.sin(rot);
      const gameOverFade = phase === 'over' ? clamp((now - overT - 0.2) / 0.8, 0, 1) : 0;
      for (const b of cells.values()) {
        if (b.core) continue;
        const k = clamp((now - b.born) / 0.3, 0, 1);
        if (k <= 0) continue;
        let sc = ease.back(k);
        if (b.snap) { const u = clamp((now - b.snap) / 0.25, 0, 1); sc *= 1 + 0.18 * Math.sin(u * Math.PI) * (1 - u); }
        const x = cx + (b.x * c0 - b.y * s0) * R, y = cy + (b.x * s0 + b.y * c0) * R;
        const out = phase === 'over' && Math.hypot(b.x, b.y) + B > DANGER;
        bubble(x, y, b.col, sc, 1 - gameOverFade * 0.6);
        if (out) g.draw.circle(x, y, B * R * 1.05, null, { stroke: `rgba(255,90,106,${0.5 + 0.5 * flash})`, lw: R * 0.008 });
      }
      // the core
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
      // flat core: a soft solid ring that breathes, a solid disc, white arcs spinning on it
      g.draw.circle(cx, cy, B * R * (1.02 + 0.18 * pulse), g.draw.alpha(g.color, 0.18));
      g.draw.ball(cx, cy, B * R * 1.02, g.color);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(1.2, R * 0.004);
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, B * R * 0.62, i * TAU / 3, i * TAU / 3 + 1.2); ctx.stroke(); }
      ctx.restore();

      // pops
      for (let i = popping.length - 1; i >= 0; i--) {
        const p = popping[i];
        if (now < p.delay) {
          const [wx, wy] = toWorld(p.x, p.y);
          bubble(cx + wx * R, cy + wy * R, p.col, 1, 1);
          continue;
        }
        const [wx, wy] = toWorld(p.x, p.y), x = cx + wx * R, y = cy + wy * R;
        if (!p.done) {
          p.done = true;
          g.draw.burst(x, y, p.col, 9, R * 0.45, R * 0.011);
          if (now - lastPop > 0.03) { g.sfx('pop', { pitch: 0.9 + i * 0.04, volume: 0.7 }); lastPop = now; }
        }
        const k = (now - p.delay) / 0.18;
        if (k >= 1) { popping.splice(i, 1); continue; }
        bubble(x, y, p.col, 1 + 0.45 * k, 1 - k);
      }
      // falling (flying away)
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i]; f.t += dt;
        const d = Math.hypot(f.x, f.y) || 1;
        f.vx += (f.x / d) * 1.6 * dt; f.vy += (f.y / d) * 1.6 * dt;
        f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.t > 1.1) { falling.splice(i, 1); continue; }
        bubble(cx + f.x * R, cy + f.y * R, f.col, 1 - f.t * 0.35, 1 - f.t / 1.1);
      }
      // the shot in flight
      if (shot) {
        const [x, y] = polar(cx, cy, shot.a, shot.d * R);
        const [tx, ty] = polar(cx, cy, shot.a, (shot.d + B * 2.4) * R);
        let tr;
        if (THEME.flat) tr = g.draw.alpha(shot.col, 0.28);
        else { tr = ctx.createLinearGradient(tx, ty, x, y); tr.addColorStop(0, g.draw.alpha(shot.col, 0)); tr.addColorStop(1, g.draw.alpha(shot.col, 0.5)); }
        ctx.strokeStyle = tr; ctx.lineWidth = B * R * 1.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
        bubble(x, y, shot.col);
      }

      // the shooter on the rim
      if (phase !== 'over' || gameOverFade < 1) {
        const [gx, gy] = gunXY();
        g.draw.arc(cx, cy, GUN * R + B * R * 1.45, aim - 0.13, aim + 0.13, g.draw.alpha(g.color, 0.9), R * 0.012);
        g.draw.arc(cx, cy, GUN * R + B * R * 1.45, aim + 0.19, aim + 0.32, THEME.ink(0.18), R * 0.008);
        const ks = clamp((now - swapT) / 0.2, 0, 1), kf = clamp((now - fireT) / 0.18, 0, 1);
        if (cur) bubble(gx, gy, cur, ease.back(Math.min(ks, kf)) * 1.0);
        if (next) {
          const [nx, ny] = polar(cx, cy, aim + 0.255, (GUN + 0.012) * R);
          bubble(nx, ny, next, 0.62 * ease.out(ks));
        }
      }

      g.draw.particles(dt);
      g.draw.floaters(dt);
    });
    return {};
  },
};
