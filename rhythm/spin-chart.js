// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Spin Beat: turns a rhythm/chart.js chart into Spin Beat notes (types, colours, spins) — pure, no DOM, so it
// can be tested in node. Used by rhythm/spin.js.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PHRASE = [8, 4, 0, 0, 0];                   // colour decided per phrase of N beats (0 = per note)
const MAX_SAME = [3, 3, 3, 99, 99];               // force a colour change after this many phrases in one colour
const SW_GAP = [650, 420, 360, 240, 200];         // a colour change needs this much room after the previous note (ms)
const SW_RUN = [2400, 1200, 1300, 400, 0];          // … and this long since the last change (ms)
const MAX_RUN = [1e9, 1e9, 6000, 3000, 1600];     // … but change at least this often where there is room (ms)
const TAP_SHARE = [0, 0.25, 0.3, 0.34, 0.4];
const BEAT_SHARE = [0, 0, 0.1, 0.12, 0.15];
const SPIN_EVERY = [0, 0, 0, 32, 16];             // beats between spin notes

/**
 * Chart (rhythm/chart.js, 4 lanes following the pitch) → Spin Beat notes, in place: each note gets a type
 * (match / tap / hold / beat / spin) and a colour c (0 / 1, −1 = none); spins get a direction and a length.
 */
export function buildNotes(chart, D, downbeats, stats = {}) {
  Object.assign(stats, { match: 0, tap: 0, hold: 0, beat: 0, spin: 0, switches: 0, cut: 0 });
  const N = chart.notes;
  const beats = chart.beats || [];
  const per = (b) => { const i = clamp(Math.floor(b), 0, Math.max(0, beats.length - 2)); return (beats[i + 1] - beats[i]) || 500; };
  const down = new Set(downbeats || []);
  const onBeat = (b) => Math.abs(b - Math.round(b)) < 0.02;
  const isDown = (b) => onBeat(b) && (down.size ? down.has(Math.round(b)) : Math.round(b) % 4 === 0);
  for (const n of N) { n.type = n.dur > 0 && D >= 2 ? 'hold' : 'match'; if (n.type !== 'hold') n.dur = 0; n.c = 0; }
  const holdsL = N.filter((n) => n.type === 'hold');
  const inHold = (t0, t1, self) => holdsL.some((h) => h !== self && !h.cut && h.t < t1 && h.t + h.dur > t0);
  // spins (Expert+): on strong downbeats, with room around them
  if (SPIN_EVERY[D]) {
    let last = -1e9, dir = 1;
    const first = N.length ? N[0].beat : 0;
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      if (n.cut || n.type !== 'match' || !isDown(n.beat) || n.s < 0.3) continue;
      if (n.beat - first < 8 || n.beat - last < SPIN_EVERY[D]) continue;
      const dur = Math.round(clamp(per(n.beat) * 1.5, 650, 950));
      const clearEnd = n.t + dur + 380;
      if (inHold(n.t - 300, clearEnd, null)) continue;
      n.type = 'spin'; n.dur = dur; n.dir = dir; n.c = -1; dir = -dir; last = n.beat;
      for (let j = i + 1; j < N.length && N[j].t < clearEnd; j++) N[j].cut = true;
      for (let j = i - 1; j >= 0 && N[j].t > n.t - 280; j--) N[j].cut = true;
    }
  }
  const live = () => N.filter((n) => !n.cut);
  // drum bars (Hard+): strong low-band hits
  if (BEAT_SHARE[D]) {
    const cand = live().filter((n) => n.type === 'match' && n.b === 0 && n.s >= 0.4 && (onBeat(n.beat) || (D >= 3 && Math.abs(n.beat * 2 - Math.round(n.beat * 2)) < 0.04)));
    cand.sort((a, b) => b.s - a.s);
    const want = Math.round(BEAT_SHARE[D] * live().length), sp = D === 2 ? 1 : 0.5;
    const got = [];
    for (const n of cand) {
      if (got.length >= want) break;
      if (got.some((m) => Math.abs(m.beat - n.beat) < sp - 0.01)) continue;
      n.type = 'beat'; n.c = -1; got.push(n);
    }
  }
  // taps (Medium+): the strongest notes (Medium: on the beat only)
  if (TAP_SHARE[D]) {
    const L = live();
    const cand = L.filter((n) => n.type === 'match' && (D >= 2 || onBeat(n.beat)) && !inHold(n.t - 1, n.t + 1, n));
    cand.sort((a, b) => b.s - a.s);
    const want = Math.round(TAP_SHARE[D] * L.length);
    for (let i = 0; i < Math.min(want, cand.length); i++) cand[i].type = 'tap';
  }
  // colours: follow the melody (the chart's lanes follow the pitch), changing only where there is room
  const L = live();
  const want = (n) => (n.lane >= 2 ? 1 : 0);
  const P = PHRASE[D];
  const b0 = (() => { for (const b of down) return b % (P || 1); return 0; })();
  const phraseOf = (n) => Math.floor((n.beat - b0 + 0.01) / P);
  const phraseC = new Map();
  if (P) {
    const sum = new Map();
    for (const n of L) if (n.c !== -1) { const k = phraseOf(n); sum.set(k, (sum.get(k) || 0) + (want(n) ? 1 : -1) * (0.3 + n.s)); }
    let pc = 0, same = 0;
    for (const k of [...sum.keys()].sort((a, b) => a - b)) {
      const v = sum.get(k);
      let c = v > 0.05 ? 1 : v < -0.05 ? 0 : pc;
      if (c === pc) { if (++same >= MAX_SAME[D]) { c = 1 - pc; same = 0; } } else same = 0;
      phraseC.set(k, c); pc = c;
    }
  }
  let pend = null, cur = 0, lastSw = -1e9, prevEnd = -1e9, lockUntil = -1e9, lockC = 0;
  for (const n of L) {
    if (n.type === 'beat') continue;
    if (n.type === 'spin') { prevEnd = n.t + n.dur; continue; }
    // under a hold the wheel is busy: everything there is a match note in the hold's colour
    if (n.t <= lockUntil + 1) { n.c = lockC; n.type = 'match'; n.dur = 0; prevEnd = Math.max(prevEnd, n.t); continue; }
    let w = P ? phraseC.get(phraseOf(n)) ?? cur : want(n);
    if (!P && w === cur && pend != null) w = pend;   // a change the melody asked for earlier, where there was no room
    if (w === cur && n.t - lastSw > MAX_RUN[D] && n.t - prevEnd >= SW_GAP[D] * 1.3) w = 1 - cur;
    if (w !== cur) {
      if (n.t - prevEnd < SW_GAP[D] || n.t - lastSw < SW_RUN[D]) pend = w;
      else { cur = w; lastSw = n.t; stats.switches++; pend = null; }
    }
    n.c = cur;
    prevEnd = n.t + (n.type === 'hold' ? n.dur : 0);
    if (n.type === 'hold') { lockUntil = n.t + n.dur; lockC = cur; }
  }
  // drop the cut notes (in place: the kit holds this array), renumber
  stats.cut = N.length - L.length;
  N.length = 0; N.push(...L);
  N.forEach((n, i) => { n.id = i; stats[n.type]++; });
}

