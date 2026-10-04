// Rhythm kit: the runtime every rhythm game (Fret Fire, Rhythm Rush, Chrono Ring, Beat Circles, Spin Beat) gets.
// It learns the song if needed (and draws the learning screen), builds the chart for the chosen version and
// difficulty, counts in while the song is started from 0 on the remote, runs the clock, judges hits, keeps
// score / combo / multiplier / accuracy / health, draws judgement popups, the combo and a slim rim gauge, pauses
// the music with the game and ends the round with a results line for the shell's game-over card.
//
//   import { rhythmGame, DIFF_OPTION } from './kit.js';
//   export default {
//     howTo: '…', modes: [{ id: 'play', name: 'Play', options: [DIFF_OPTION] }], keyRepeat: false,
//     create(g, { opts }) {
//       const R = rhythmGame(g, { game: 'frets', lanes: 5, holds: true, chords: true, leadMs: 1800 });
//       R.onReady((chart) => { /* chart.notes (sorted by t, each with an id) — build geometry */ });
//       g.loop((dt) => {
//         if (!R.drawPre(dt)) return;      // learning / "choose a song" screens are drawn by the kit
//         const now = R.now();             // song time in ms (calibrated)
//         …draw notes near `now`…          // R.window(now - 200, now + 2000) → the notes in that span
//       });
//       g.on('down', (e) => { const n = …note under the finger…; if (n) R.hit(n); });
//       return R.handle;
//     },
//   };
//
// R (what a game uses)
//   R.onReady(fn(chart))        chart = makeChart(...) (+ note.id); called once the song is learned & charted
//   R.drawPre(dt) → bool        call first in your loop; false = the kit drew a full screen this frame
//   R.now()                     song time ms (negative during the count-in)
//   R.hit(note, t?) → label     'perfect' | 'great' | 'good' | 'miss', or null if the note is still too far ahead
//                               (nothing happens then). Scores, combo, health and a popup (at note.x/note.y if
//                               the game set them, else R.popupAt(note) or a default spot).
//   R.release(note, t?)         end of a hold: 'perfect' when held to the end (bonus), 'miss' when let go early
//   R.missed(note)              a note passed (the kit also auto-misses notes once they are past the window)
//   R.judgeAt(diffMs) → label   the label for a timing difference (hit time − note time)
//   R.timeAt(ts) → ms           song time at an input event's timestamp (e.ts) — hit/release use the current
//                               event's time automatically when called from inside a g.on handler
//   R.bonus(points, x?, y?)     extra points (overdrive, spinners…), shown as +N when x/y are given
//   R.onHoldEnd(fn(note, ok))   a hold finished: ok = held to the end, false = let go early
//   note.quiet = true           no judgement popup for that note (the game shows its own feedback)
//   R.inWindow(note, t?)        true when hitting the note now would count (not too early)
//   R.window(t0, t1) → notes    notes with t0 ≤ t ≤ t1 (and holds still sounding in that span)
//   R.popup(label, x, y, col?)  a judgement-style popup anywhere
//   R.combo R.maxCombo R.multiplier (1–4×, +1 every 10) R.accuracy (0..1) R.health (0..1) R.score R.counts
//   R.state                     'init' | 'nosong' | 'learn' | 'error' | 'count' | 'play' | 'done'
//   R.chart R.notes R.song R.version R.analysis R.difficulty (0–4) R.diffId R.diffName R.windows R.progress R.lanes
//   R.handle                    { destroy, pause, resume } → return it from create()
// Input: handlers a game registers with g.on(...) AFTER rhythmGame() only fire during 'count' and 'play'.
// cfg: { game, lanes = 4, holds = true, chords = true, leadMs = 1800, rim = true, comboHud = true, hud = true,
//        countMs = 3000, popupAt(note) → [x, y], chart: {…extra makeChart options},
//        authored (use a chart-library song's own notes; default: only for Fret Fire) }
import { THEME, TAU, clamp, ease } from '../games/kit.js';
import { go } from '../js/core/router.js';
import { player } from '../js/core/player.js';
import { store } from '../js/core/store.js';
import { currentSong, selectedVersion, analysisFor, learnJob, needsRelearn, setActiveSong, SOURCE_TEXT, SOURCE_SHORT } from './session.js';
import * as clock from './clock.js';

/** The five difficulties (same ids as rhythm/chart.js). */
export const DIFFICULTIES = [{ id: 'easy', name: 'Easy' }, { id: 'medium', name: 'Medium' }, { id: 'hard', name: 'Hard' }, { id: 'expert', name: 'Expert' }, { id: 'master', name: 'Master' }];
/** Mode option for the shell's start card: Difficulty Easy…Master (each has its own top 5, per song). */
export const DIFF_OPTION = { id: 'level', name: 'Difficulty', choices: DIFFICULTIES, default: 'medium' };
/** Not used: the version is chosen on the Rhythm screen. Kept (null — the shell skips it) so games written to the guide still load. */
export const VERSION_OPTION = null;
/** Judgement windows (± ms around the note) before widening. */
export const JUDGE = { perfect: 45, great: 90, good: 135 };
export const POINTS = { perfect: 300, great: 200, good: 100, miss: 0 };
const WIDEN = [1.25, 1.1, 1, 1, 1];
const MISS_HP = [0.04, 0.05, 0.07, 0.09, 0.11];
const GAIN_HP = { perfect: 0.02, great: 0.012, good: 0.004 };
const ACC_W = { perfect: 1, great: 0.67, good: 0.33, miss: 0 };
/** Grade for an accuracy 0..1. */
export const grade = (acc) => (acc >= 0.95 ? 'S' : acc >= 0.9 ? 'A' : acc >= 0.8 ? 'B' : acc >= 0.7 ? 'C' : 'D');

/** Colour for a judgement label (readable on the theme's background). */
export function judgeColor(label) {
  const L = THEME.light;
  return {
    perfect: L ? '#c48a00' : '#ffd23f', great: L ? '#15934a' : '#3ddc84', good: L ? '#2563eb' : '#5aa9ff',
    miss: THEME.danger, hold: L ? '#c48a00' : '#ffd23f',
  }[label] || THEME.fg;
}
const LABEL_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };

export function rhythmGame(g, cfg = {}) {
  const C = { lanes: 4, holds: true, chords: true, leadMs: 1800, rim: true, comboHud: true, hud: true, countMs: 3000, ...cfg };
  const diffId = DIFFICULTIES.some((d) => d.id === g.opts?.level) ? g.opts.level : DIFF_OPTION.default;
  const D = DIFFICULTIES.findIndex((d) => d.id === diffId);
  const readyFns = [];
  const popups = [];
  let btns = [];
  let job = null, alive = true, countT = 0, countBase = 0, countFrom = 0, firstStart = true;
  let missIdx = 0, holding = new Set(), endAt = Infinity, lastSub = '', pausedAt = null, multFlash = 0, failAt = 0;
  let errMsg = '', tPhase = 0, tapFlash = 0, lastTapT = -1e9, curTs = null, judgedN = 0;
  const holdEndFns = [];
  const accSum = { w: 0, n: 0 };

  const R = {
    state: 'init', chart: null, notes: [], song: null, version: null, analysis: null,
    difficulty: D, diffId, diffName: DIFFICULTIES[D].name, lanes: C.lanes, cfg: C,
    combo: 0, maxCombo: 0, multiplier: 1, accuracy: 1, health: 1, score: 0, progress: 0,
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    windows: { ...JUDGE }, popupAt: C.popupAt || null,

    onReady(fn) { if (R.chart) fn(R.chart); else readyFns.push(fn); },
    now() {
      if (R.state === 'count') return countBase - Math.max(0, countT) - clock.offsetMs();
      if (R.state === 'play' || R.state === 'done') return clock.songTime();
      return 0;
    },
    judgeAt(d) {
      const W = R.windows, a = Math.abs(d);
      return a <= W.perfect ? 'perfect' : a <= W.great ? 'great' : a <= W.good ? 'good' : 'miss';
    },
    timeAt(ts) { return ts == null ? R.now() : R.now() - clamp(performance.now() - ts, 0, 250); },
    bonus(n, x, y) { n = Math.round(n || 0); if (!n) return; addScore(n); if (x != null && y != null) R.popup(`+${n}`, x, y, g.color); },
    onHoldEnd(fn) { holdEndFns.push(fn); },
    inWindow(note, t = R.now()) { return !!note && !note.done && t - note.t >= -R.windows.good; },
    hit(note, t = curTs != null ? R.timeAt(curTs) : R.now()) {
      if (!note || note.done || (R.state !== 'play' && R.state !== 'count')) return null;
      const d = t - note.t;
      if (d < -R.windows.good) return null;
      const label = R.judgeAt(d);
      judge(note, label, d);
      if (label !== 'miss' && note.dur > 0 && C.holds !== false) { note.holding = true; holding.add(note); }
      return label;
    },
    release(note, t = curTs != null ? R.timeAt(curTs) : R.now()) {
      if (!note?.holding) return null;
      note.holding = false; holding.delete(note);
      const end = note.t + note.dur;
      if (t >= end - R.windows.good) {
        const bonus = Math.round((note.dur / 1000) * 100) * R.multiplier;
        addScore(bonus);
        note.held = true;
        holdEnd(note, true);
        return 'perfect';
      }
      note.dropped = true;
      R.combo = 0; R.multiplier = 1; updateSub();
      holdEnd(note, false);
      return 'miss';
    },
    missed(note) { if (note && !note.done) judge(note, 'miss', Infinity); },
    window(t0, t1) {
      const N = R.notes, out = [];
      let lo = 0, hi = N.length;
      const from = t0 - 20000;             // holds can start well before t0
      while (lo < hi) { const m = (lo + hi) >> 1; if (N[m].t < from) lo = m + 1; else hi = m; }
      for (let i = lo; i < N.length && N[i].t <= t1; i++) { const n = N[i]; if (n.t >= t0 || (n.dur > 0 && n.t + n.dur >= t0)) out.push(n); }
      return out;
    },
    popup(label, x, y, col) {
      popups.push({ text: LABEL_TEXT[label] || String(label), x, y, col: col || judgeColor(label), t: 0, big: label === 'perfect' });
      if (popups.length > 12) popups.shift();
    },
    drawPre(dt) {
      clock.demoTick();
      tPhase += dt;
      switch (R.state) {
        case 'init': screen(() => drawCenterNote('Loading…')); return false;
        case 'nosong': screen(drawNoSong); return false;
        case 'learn': screen(drawLearn); return false;
        case 'error': screen(drawError); return false;
        case 'count':
          countT -= dt * 1000;
          if (countT <= 0) beginPlay();
          update();
          return true;
        case 'play': update(); return true;
        default: return true;
      }
    },
  };

  if (globalThis.__RR_TEST__) globalThis.__RR_TEST__.R = R;   // tests only: the running round

  // ---------------------------------------------------------------- the game's loop & input are wrapped
  const origLoop = g.loop.bind(g), origOn = g.on.bind(g);
  g.loop = (fn) => origLoop((dt, t) => { fn(dt, t); if (['count', 'play', 'done'].includes(R.state)) post(dt); });
  // input handlers run only while counting in / playing; hit() and release() inside them use the event's own time
  g.on = (evt, fn) => origOn(evt, evt === 'resize' ? fn : (e) => {
    if (R.state !== 'play' && R.state !== 'count') return;
    curTs = e?.ts ?? null;
    try { fn(e); } finally { curTs = null; }
  });

  // kit's own input (buttons on its screens, tapping the beat)
  origOn('tap', (e) => { if (!['play', 'count', 'done'].includes(R.state)) for (const b of btns) if (Math.abs(e.x - b.x) <= b.w / 2 && Math.abs(e.y - b.y) <= b.h / 2) { g.sfx('click'); b.fn(); return; } });
  origOn('down', (e) => {
    if (R.state !== 'learn' || job?.phase !== 'taps') return;
    if (btns.some((b) => Math.abs(e.x - b.x) <= b.w / 2 && Math.abs(e.y - b.y) <= b.h / 2)) return;
    tapBeat();
  });
  origOn('key', (e) => {
    if (['play', 'count', 'done'].includes(R.state)) return;
    if (R.state === 'learn' && job?.phase === 'taps' && (e.key === ' ' || e.key === 'Enter') && !e.repeat) { tapBeat(); return; }
    if (e.key === 'Enter' || e.key === ' ') btns.find((b) => b.primary)?.fn();
  });
  function tapBeat() { job.tap(clock.songTime()); tapFlash = 1; lastTapT = tPhase; g.sfx('tick'); }

  // ---------------------------------------------------------------- scoring
  function addScore(n) { if (n) { R.score += n; g.score(R.score); } }
  function holdEnd(note, ok) { for (const fn of holdEndFns) { try { fn(note, ok); } catch (e) { console.error('[rhythm] onHoldEnd', e); } } }
  function judge(note, label, d) {
    note.done = true; note.judged = label; note.diff = d; judgedN++;
    R.counts[label]++;
    accSum.w += ACC_W[label]; accSum.n++;
    R.accuracy = accSum.n ? accSum.w / accSum.n : 1;
    if (label === 'miss') {
      R.combo = 0; R.multiplier = 1;
      // a little grace while the player settles in: the first 16 judged notes cost half
      R.health = Math.max(0, R.health - MISS_HP[D] * (judgedN < 16 ? 0.5 : 1));
      if (R.health <= 0 && D >= 2 && !failAt) failAt = performance.now();
    } else {
      R.combo++; R.maxCombo = Math.max(R.maxCombo, R.combo);
      const m = Math.min(4, 1 + Math.floor(R.combo / 10));
      if (m > R.multiplier) multFlash = 1;
      R.multiplier = m;
      R.health = Math.min(1, R.health + GAIN_HP[label]);
      addScore(POINTS[label] * R.multiplier);
    }
    if (!note.quiet) {
      const [x, y] = (note.x != null && note.y != null) ? [note.x, note.y - g.R * 0.08] : (R.popupAt?.(note) || [g.cx, g.cy + g.R * 0.3]);
      R.popup(label, x, y);
    }
    updateSub();
  }
  function updateSub() {
    if (!C.comboHud) return;
    const s = R.combo >= 5 ? `${R.combo} combo · ×${R.multiplier}` : `${R.diffName}${R.multiplier > 1 ? ` · ×${R.multiplier}` : ''}`;
    if (s !== lastSub) { lastSub = s; g.sub(s); }
  }
  function widen() {
    const extra = Math.max(0, clock.uncertaintyMs() - 10) * 0.5;
    const m = WIDEN[D];
    R.windows = { perfect: JUDGE.perfect * m + extra * 0.4, great: JUDGE.great * m + extra * 0.7, good: JUDGE.good * m + extra };
  }

  // ---------------------------------------------------------------- per-frame bookkeeping while playing
  let windowT = 0;
  function update() {
    if ((windowT -= 1) <= 0) { widen(); windowT = 30; }
    const now = R.now();
    const N = R.notes, good = R.windows.good;
    while (missIdx < N.length && (N[missIdx].done || now - N[missIdx].t > good)) {
      if (!N[missIdx].done) R.missed(N[missIdx]);
      missIdx++;
    }
    for (const n of holding) if (now >= n.t + n.dur) R.release(n, n.t + n.dur);
    if (R.state !== 'play') return;
    const dur = R.chart?.durMs || R.song?.track?.durationMs || 0;
    R.progress = dur ? clamp(now / dur, 0, 1) : 0;
    if (failAt) { if (performance.now() - failAt > 250) finish('fail'); return; }
    const t = player.state.track;
    if (R.song && t && (t.id ?? t.title) !== (R.song.track.id ?? R.song.track.title) && now > 1500) { finish('changed'); return; }
    if (now >= endAt) finish('end');
  }

  function finish(why) {
    if (R.state !== 'play') return;
    R.state = 'done';
    for (const n of holding) R.release(n);
    if (why === 'fail') clock.pauseSong();
    const c = R.counts;
    const acc = R.accuracy, gr = why === 'fail' ? 'F' : grade(acc);
    const title = why === 'fail' ? 'Song failed' : why === 'changed' ? 'The song changed' : c.miss === 0 && c.perfect + c.great + c.good > 0 ? 'Full combo!' : 'Song complete';
    g.score(R.score);
    g.over(R.score, {
      title, win: why !== 'fail', label: `${R.diffName} · ${gr}`,
      note: `${(acc * 100).toFixed(1)}% · ${gr}  —  perfect ${c.perfect} · great ${c.great} · good ${c.good} · miss ${c.miss} · max combo ${R.maxCombo}`,
      delay: 1400,
    });
  }

  // ---------------------------------------------------------------- start: song → version → chart → count-in
  async function start(method) {
    errMsg = '';
    g.hud(false);
    const song = R.song || currentSong();
    if (!song) { R.state = 'nosong'; return; }
    R.song = song;
    setActiveSong(song);
    let ver = method || needsRelearn(song.key) ? null : await selectedVersion(song.key);
    let analysis = ver ? await analysisFor(ver) : null;
    if (!alive) return;
    if (!analysis) {
      R.state = 'learn';
      job = learnJob(song.track, { provider: song.provider, method: method || store.get('rhythmSource') || 'auto' });
      const r = await job.promise;
      if (!alive) return;
      ver = r.version; analysis = r.analysis;
    }
    const { makeChart } = await import('./chart.js');
    if (!alive) return;
    // a chart-library song: Fret Fire plays the charter's own notes (cfg.authored overrides); the others generate
    const chart = makeChart(analysis, { lanes: C.lanes, difficulty: D, seed: ver.seed || 1, holds: C.holds, chords: C.chords, leadMs: C.leadMs, authored: C.authored ?? C.game === 'frets', ...(C.chart || {}) });
    // the version's sync nudge (Rhythm screen → Versions): + = the notes come later
    const off = Math.round(+ver.offsetMs || 0);
    if (off) { for (const n of chart.notes) n.t += off; chart.beats = chart.beats.map((b) => b + off); }
    chart.offsetMs = off;
    chart.notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
    chart.notes.forEach((n, i) => { n.id = i; });
    Object.assign(R, { chart, notes: chart.notes, version: ver, analysis });
    const last = chart.notes.reduce((m, n) => Math.max(m, n.t + (n.dur || 0)), 0);
    const dur = chart.durMs || song.track.durationMs || analysis.durMs || 0;
    endAt = dur ? Math.min(dur - 300, last + 3000) : last + 3000;
    if (!(endAt > 0)) endAt = last + 3000;
    for (const fn of readyFns.splice(0)) { try { fn(chart); } catch (e) { console.error('[rhythm] onReady', e); } }
    count(0, C.countMs);
  }
  function count(base, ms) {
    countBase = base; countT = ms; countFrom = ms;
    R.state = 'count';
    clock.pauseSong();
    g.hud(C.hud !== false);
    updateSub();
  }
  function beginPlay() {
    R.state = 'play';
    if (firstStart) { firstStart = false; clock.startSong(); } else clock.resumeSong(countBase);
    windowT = 0;
  }
  const run = (method) => start(method).catch((e) => {
    if (!alive) return;
    console.warn('[rhythm]', e);
    if (job && job.phase === 'cancelled') return;
    errMsg = e?.message || String(e);
    R.state = 'error';
  });
  run();

  // ---------------------------------------------------------------- drawing (kit screens)
  const fitText = (s, size, maxW, weight = 700, font = THEME.display) => {
    const { ctx } = g;
    ctx.font = `${weight} ${size}px ${font}`;
    s = String(s || '');
    if (ctx.measureText(s).width <= maxW) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  };
  function screen(fn) {
    btns = [];
    g.draw.bg({ glow: 0.2 });
    fn();
    for (const b of btns) drawBtn(b);
  }
  function button(label, x, y, fn, { primary = false, w = null } = {}) {
    const h = g.R * 0.12;
    const { ctx } = g;
    ctx.font = `800 ${g.R * 0.05}px ${THEME.font}`;
    btns.push({ label, x, y, w: w || Math.max(g.R * 0.32, ctx.measureText(label).width + g.R * 0.14), h, fn, primary });
  }
  function drawBtn(b) {
    g.draw.roundRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, b.h / 2, b.primary ? g.color : THEME.glass2, { glow: b.primary ? g.R * 0.05 : 0 });
    g.draw.text(b.label, b.x, b.y + 1, g.R * 0.05, { color: b.primary ? '#0a0a0b' : THEME.fg, weight: 800, font: THEME.font });
  }
  function songHeader(y) {
    const s = R.song;
    if (!s) return;
    g.draw.text(fitText(s.title, g.R * 0.075, g.R * 1.2), g.cx, y, g.R * 0.075);
    g.draw.text(fitText(s.artist, g.R * 0.048, g.R * 1.1, 500, THEME.font), g.cx, y + g.R * 0.085, g.R * 0.048, { color: THEME.muted, weight: 500, font: THEME.font });
  }
  function caption(text, y, col = THEME.dim) { g.draw.text(text, g.cx, y, g.R * 0.04, { color: col, weight: 800, font: THEME.font }); }
  function drawCenterNote(text) { g.draw.text(text, g.cx, g.cy, g.R * 0.06, { color: THEME.muted, font: THEME.font, weight: 600 }); }

  function drawNoSong() {
    const { cx, cy, R: r } = g;
    g.draw.circle(cx, cy - r * 0.22, r * 0.14, THEME.glass, { stroke: THEME.line, lw: 2 });
    g.draw.text('♪', cx, cy - r * 0.215, r * 0.13, { color: g.color, glow: r * 0.06 });
    g.draw.text('Choose a song first', cx, cy + r * 0.04, r * 0.085);
    g.draw.text('Play something on the Rhythm screen, then come back.', cx, cy + r * 0.15, r * 0.042, { color: THEME.muted, weight: 500, font: THEME.font });
    button('Rhythm screen', cx, cy + r * 0.36, () => go('rhythm'), { primary: true });
  }
  function drawError() {
    const { cx, cy, R: r } = g;
    g.draw.text('Couldn’t learn this song', cx, cy - r * 0.3, r * 0.075);
    const msg = fitText(errMsg, r * 0.042, r * 1.3, 500, THEME.font);
    g.draw.text(msg, cx, cy - r * 0.17, r * 0.042, { color: THEME.muted, weight: 500, font: THEME.font });
    button('Try again', cx, cy + r * 0.05, () => { R.state = 'init'; run(); }, { primary: true });
    button('Tap the tempo instead', cx, cy + r * 0.21, () => { R.state = 'init'; run('tempo'); });
    button('Back', cx, cy + r * 0.37, () => go('rhythm'));
  }
  function ringProgress(p, y, rad, col = g.color) {
    const w = g.R * 0.035;
    g.draw.arc(g.cx, y, rad, 0, TAU, THEME.ink(0.1), w);
    if (p > 0.002) g.draw.arc(g.cx, y, rad, 0, TAU * clamp(p, 0, 1), col, w, { glow: g.R * 0.04 });
  }
  function spectrum(feat, y, rad) {
    const bands = feat?.bands;
    if (!bands?.length) return;
    const { ctx } = g;
    const n = bands.length;
    ctx.save();
    ctx.strokeStyle = g.draw.alpha(g.color, 0.75);
    ctx.lineWidth = Math.max(2, g.R * 0.018);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < n; i++) {
        const a = (side ? -1 : 1) * ((i + 0.5) / n) * Math.PI;
        const v = clamp(bands[i] || 0, 0, 1);
        const r0 = rad + g.R * 0.05, r1 = r0 + g.R * (0.015 + 0.13 * v);
        ctx.moveTo(g.cx + Math.sin(a) * r0, y - Math.cos(a) * r0);
        ctx.lineTo(g.cx + Math.sin(a) * r1, y - Math.cos(a) * r1);
      }
    }
    ctx.stroke();
    ctx.restore();
    if (feat.beat) tapFlash = Math.max(tapFlash, 0.6);
  }
  function drawLearn() {
    const { cx, cy, R: r } = g;
    const j = job;
    if (!j) { drawCenterNote('Getting ready…'); return; }
    caption(j.phase === 'taps' ? 'FIND THE BEAT' : 'LEARNING THE SONG', cy - r * 0.66);
    songHeader(cy - r * 0.54);
    const ry = cy + r * 0.04, rad = r * 0.27;
    tapFlash = Math.max(0, tapFlash - 0.06);
    if (j.phase === 'taps') {
      // big tap target; it pulses with the tempo found so far
      const fit = j.fit;
      let beat = 0;
      if (fit) { const t = clock.songTime(); const ph = (((t - fit.firstBeatMs) % fit.period) + fit.period) % fit.period / fit.period; beat = Math.max(0, 1 - ph * 4); }
      g.draw.circle(cx, ry, rad * (1 + 0.04 * beat + 0.06 * tapFlash), g.draw.alpha(g.color, 0.14 + 0.25 * tapFlash), { stroke: g.draw.alpha(g.color, 0.6 + 0.4 * beat), lw: r * 0.012 });
      g.draw.text(fit ? `${Math.round(fit.bpm)}` : 'TAP', cx, ry - r * 0.02, r * 0.14, { color: THEME.fg, glow: r * 0.04 });
      g.draw.text(fit ? 'BPM' : 'to the beat', cx, ry + r * 0.1, r * 0.042, { color: THEME.muted, weight: 700, font: THEME.font });
      const need = j.bpm ? 4 : 8;
      caption(j.canFinish ? `${j.taps.length} taps — tap Done when it feels right` : `Tap anywhere on every beat · ${Math.max(0, need - j.taps.length)} more`, cy + r * 0.4, THEME.muted);
      if (j.fallback && j.error) caption(fitText(`(${j.error})`, r * 0.04, r * 1.2), cy + r * 0.47);
      button('Cancel', cx - r * 0.22, cy + r * 0.62, cancel);
      if (j.canFinish) button('Done', cx + r * 0.22, cy + r * 0.62, () => j.done(), { primary: true });
      return;
    }
    const live = j.phase === 'listen' && j.live;
    if (live) spectrum(j.live.features, ry, rad);
    ringProgress(j.progress, ry, rad);
    const pct = Math.round((j.progress || 0) * 100);
    if (j.phase === 'lookup' || j.phase === 'prepare') {
      const a = tPhase * 4;
      g.draw.arc(cx, ry, rad * 0.55, a, a + 1.6, g.draw.alpha(g.color, 0.8), r * 0.025);
    } else g.draw.text(`${pct}%`, cx, ry, r * 0.13, { glow: r * 0.04 });
    const src = SOURCE_TEXT[j.source] || 'Getting ready';
    caption(src.toUpperCase(), cy + r * 0.4, THEME.muted);
    let line = j.text || '';
    if (j.speed > 1.5 && ['analyse', 'render', 'decode', 'save', 'done'].includes(j.phase)) line = `Learning at ${Math.round(j.speed)}× speed`;
    if (live && j.coverage) line = `Heard ${Math.round(j.coverage * 100)}% of the song · tap Done to stop early`;
    g.draw.text(fitText(line, r * 0.045, r * 1.25, 600, THEME.font), cx, cy + r * 0.48, r * 0.045, { color: THEME.fg, weight: 600, font: THEME.font });
    if (j.canFinish) {
      button('Cancel', cx - r * 0.22, cy + r * 0.64, cancel);
      button('Done', cx + r * 0.22, cy + r * 0.64, () => j.done(), { primary: true });
    } else button('Cancel', cx, cy + r * 0.64, cancel);
  }
  function cancel() { job?.cancel(); go('rhythm'); }

  // ---------------------------------------------------------------- overlay over the game's frame
  // text at one fixed font size (0.052 R), scaled with a transform: changing ctx.font every frame makes the canvas
  // re-rasterise the glyphs, which stalls a Raspberry Pi
  function scaledText(text, x, y, scale, col, alpha = 1) {
    const { ctx } = g, size = Math.round(g.R * 0.052);
    ctx.save();
    ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.font = `800 ${size}px ${THEME.display}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (THEME.glow && !THEME.light) { ctx.shadowColor = col; ctx.shadowBlur = g.R * 0.03 / scale; }
    ctx.fillStyle = col;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  function post(dt) {
    const { cx, cy, R: r } = g;
    multFlash = Math.max(0, multFlash - dt * 1.6);
    // judgement popups
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i]; p.t += dt;
      if (p.t > 0.7) { popups.splice(i, 1); continue; }
      const k = p.t / 0.7, s = (p.t < 0.12 ? ease.back(p.t / 0.12) : 1) * (p.big ? 1.19 : 1);
      scaledText(p.text, p.x, p.y - k * r * 0.06, s, p.col, 1 - k * k);
    }
    // multiplier pop
    if (multFlash > 0 && R.multiplier > 1) {
      const s = 1 + 0.25 * ease.out(1 - multFlash);
      g.draw.text(`×${R.multiplier}`, cx, cy - r * 0.42, r * 0.1 * s, { color: g.color, alpha: Math.min(1, multFlash * 2), glow: r * 0.06 });
    }
    // rim gauge: health on the left, accuracy on the right, song progress at the bottom
    if (C.rim !== false) {
      const rr = r * 0.975, w = Math.max(2, r * 0.009), deg = Math.PI / 180;
      const hp = R.health, hcol = hp > 0.5 ? THEME.ok : hp > 0.25 ? THEME.warn : THEME.danger;
      g.draw.arc(cx, cy, rr, 205 * deg, 335 * deg, THEME.ink(0.1), w);
      if (hp > 0.005) g.draw.arc(cx, cy, rr, 205 * deg, (205 + 130 * hp) * deg, hcol, w);
      g.draw.arc(cx, cy, rr, 25 * deg, 155 * deg, THEME.ink(0.1), w);
      if (R.accuracy > 0.005) g.draw.arc(cx, cy, rr, (155 - 130 * R.accuracy) * deg, 155 * deg, g.draw.alpha(g.color, 0.75), w);
      g.draw.arc(cx, cy, rr, 165 * deg, 195 * deg, THEME.ink(0.1), w);
      if (R.progress > 0.005) g.draw.arc(cx, cy, rr, 165 * deg, (165 + 30 * R.progress) * deg, THEME.ink(0.55), w);
    }
    // count-in
    if (R.state === 'count') {
      const left = Math.max(0, countT) / 1000;
      const n = Math.ceil(left);
      const frac = left - Math.floor(left);
      const label = n > 0 ? String(n) : '';
      if (label) {
        const s = 0.8 + 0.4 * ease.out(frac);
        g.draw.circle(cx, cy, r * 0.2, THEME.paper(0.45));
        scaledText(label, cx, cy + r * 0.01, s * 3.85, THEME.fg, 0.4 + 0.6 * frac);
      }
      if (firstStart && R.song) caption(fitText(`${R.song.title} · ${R.diffName}`.toUpperCase(), r * 0.04, r * 1.1, 800, THEME.font), cy + r * 0.3, THEME.muted);
    }
  }

  // ---------------------------------------------------------------- shell hooks
  R.handle = {
    destroy() { alive = false; job?.cancel(); },
    pause() {
      if (R.state === 'play') { pausedAt = R.now(); clock.pauseSong(); }
      else if (R.state === 'count') pausedAt = countBase - Math.max(0, countT);
    },
    resume() {
      if (pausedAt == null) return;
      if (R.state === 'play') count(Math.max(0, pausedAt - 2000), 1500);
      else if (R.state === 'count') countT = countFrom;
      pausedAt = null;
    },
  };
  return R;
}
