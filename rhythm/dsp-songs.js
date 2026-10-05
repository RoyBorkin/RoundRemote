// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Demo songs as music: a deterministic arrangement (score) per Demo track (js/providers/demo.js d1…d7).
// Pure data (no Web Audio): rhythm/synth.js turns these events into sound. Sections follow the Demo lyric
// timings (verse / chorus starts), tempo is fitted so the sections land on bar lines.
//
// getSong(id) → { id, title, bpm, beatSec, t0, durMs, key, minor, style, sections, events, beats, downbeats }
//   events: { t (s), i: instrument, m: midi | midi[], d: dur (s), v: velocity 0..1 } sorted by t.

const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

// Section starts in seconds, from the Demo lyrics (first line of each verse / chorus …).
const SONGS = {
  d1: { title: 'Neon Orbit', dur: 192000, bpm: [110, 120], key: 'F#', minor: true, style: 'synthwave', seed: 11,
    prog: { verse: [0, 5, 2, 6], chorus: [5, 2, 6, 0], bridge: [3, 5, 0, 6], intro: [0, 5, 2, 6], inter: [5, 2, 6, 0], outro: [0, 5, 2, 6] },
    secs: [['intro', 0], ['verse', 9], ['chorus', 34], ['inter', 57], ['verse', 64], ['chorus', 89], ['inter', 112], ['bridge', 118], ['chorus', 146], ['outro', 170]] },
  d2: { title: 'Paper Lanterns', dur: 178000, bpm: [92, 100], key: 'D', minor: false, style: 'folk', seed: 23,
    prog: { verse: [0, 4, 5, 3], chorus: [3, 0, 4, 5], bridge: [5, 3, 0, 4], intro: [0, 3, 0, 4], inter: [3, 0, 4, 0], outro: [0, 4, 5, 3] },
    secs: [['intro', 0], ['verse', 7], ['chorus', 32], ['inter', 54], ['verse', 60], ['chorus', 85], ['inter', 107], ['bridge', 114], ['chorus', 140], ['outro', 163]] },
  d3: { title: 'Circuit Heart', dur: 210000, bpm: [124, 132], key: 'E', minor: true, style: 'electro', seed: 37,
    prog: { verse: [0, 0, 5, 6], pre: [3, 3, 4, 4], chorus: [0, 5, 2, 6], bridge: [5, 6, 0, 0], intro: [0, 0, 5, 6], inter: [0, 5, 2, 6], break: [5, 6, 0, 0], build: [3, 4, 3, 4], outro: [0, 5, 2, 6] },
    secs: [['intro', 0], ['verse', 12], ['pre', 29], ['chorus', 38], ['inter', 54], ['verse', 62], ['pre', 79], ['chorus', 88], ['break', 104], ['bridge', 120], ['build', 142], ['chorus', 150], ['outro', 168]] },
  d4: { title: 'Slow Motion Summer', dur: 185000, bpm: [84, 90], key: 'G', minor: false, style: 'summer', seed: 41,
    prog: { verse: [0, 2, 3, 0], chorus: [3, 4, 2, 5], bridge: [5, 4, 3, 4], intro: [0, 3, 0, 4], inter: [3, 4, 0, 0], outro: [0, 2, 3, 0] },
    secs: [['intro', 0], ['verse', 8], ['chorus', 33], ['inter', 57], ['verse', 63], ['chorus', 88], ['inter', 112], ['bridge', 120], ['chorus', 146], ['outro', 170]] },
  d5: { title: 'Northbound', dur: 224000, bpm: [140, 148], key: 'A', minor: false, style: 'drive', seed: 53, instrumental: true,
    prog: { verse: [0, 4, 5, 3], chorus: [5, 3, 0, 4], bridge: [3, 4, 5, 5], intro: [0, 4, 5, 3], inter: [0, 4, 5, 3], break: [5, 3, 5, 4], outro: [0, 4, 5, 3] },
    secs: [['intro', 0], ['verse', 14], ['chorus', 41], ['verse', 68], ['chorus', 95], ['break', 122], ['bridge', 135], ['chorus', 162], ['inter', 189], ['outro', 202]] },
  d6: { title: 'Glass Garden', dur: 199000, bpm: [100, 106], key: 'Eb', minor: false, style: 'dream', seed: 67,
    prog: { verse: [0, 5, 3, 4], chorus: [3, 0, 4, 5], bridge: [1, 4, 0, 5], intro: [0, 3, 0, 3], inter: [3, 0, 4, 0], break: [1, 4, 0, 5], outro: [0, 5, 3, 4] },
    secs: [['intro', 0], ['verse', 10], ['chorus', 39], ['inter', 63], ['verse', 70], ['chorus', 99], ['break', 123], ['chorus', 135], ['outro', 159]] },
  d7: { title: 'אור על המים', dur: 188000, bpm: [102, 110], key: 'B', minor: true, style: 'pop', seed: 79,
    prog: { verse: [0, 6, 5, 6], chorus: [2, 6, 0, 5], bridge: [3, 0, 6, 2], intro: [0, 6, 5, 6], inter: [2, 6, 0, 5], outro: [0, 6, 5, 6] },
    secs: [['intro', 0], ['verse', 8], ['chorus', 33], ['inter', 56], ['verse', 62], ['chorus', 87], ['inter', 110], ['bridge', 116], ['chorus', 142], ['outro', 159]] },
};

// 16 steps per bar; digit = velocity (1–9), '.' = rest.
const GROOVES = {
  none: {},
  introHat: { h: '..5...5...5...5.' },
  introKick: { k: '9...............', h: '..4...4...4...4.' },
  pop: { k: '9.....6.9.......', s: '....8.......8...', h: '5.3.5.3.5.3.5.3.' },
  pop2: { k: '9.....7.9..6....', s: '....8.......8...', h: '5.3.5.3.5.3.5.3.', o: '..............5.' },
  four: { k: '9...9...9...9...', s: '....8.......8...', h: '4...4...4...4...', o: '..6...6...6...6.' },
  half: { k: '9.........6.....', s: '........8.......', h: '5.3.5.3.5.3.5.3.' },
  folk: { k: '7.......6.......', r: '....6.......6...', x: '4242424242424242' },
  folk2: { k: '8.....5.7.......', s: '....7.......7...', x: '5353535353535353' },
  folkHalf: { k: '7...............', x: '3.3.3.3.3.3.3.3.' },
  electro: { k: '9...9...9...9...', c: '....9.......9...', h: '5353535353535353', o: '..7...7...7...7.' },
  electroV: { k: '9...9...9...9...', c: '....7.......7...', h: '4.4.4.4.4.4.4.4.' },
  electroB: { k: '9...............', h: '..4...4...4...4.' },
  build: { k: '9...9...9...9...', s: '7.7.7.7.7.7.7.7.' },
  drive: { k: '9.....7.9.7.....', s: '....8.......8...', h: '6.4.6.4.6.4.6.4.' },
  driveC: { k: '9...9...9...9.7.', s: '....9.......9...', h: '6.5.6.5.6.5.6.5.', o: '..............6.' },
  driveB: { k: '9.......9.......', h: '5.3.5.3.5.3.5.3.' },
  dream: { k: '7.......7.......', r: '....5.......5...', h: '3.2.3.2.3.2.3.2.', x: '..2...2...2...2.' },
  dreamC: { k: '8.....5.8.......', s: '....7.......7...', h: '4.3.4.3.4.3.4.3.' },
  summer: { k: '8......6..7.....', s: '....7.......7...', h: '4.3.4.3.4.3.4.3.' },
  summerC: { k: '8.....6.8..6....', s: '....8.......8...', h: '5.3.5.3.5.3.5.3.', o: '..............5.' },
};
// R root, 3 third, 5 fifth, 8 octave; '-' = held, '.' = rest
const BASS = {
  long: 'R---------------', half: 'R-------5-------', eighths: 'R.R.R.R.R.R.R.R.', oct8: 'R.8.R.8.R.8.R.8.',
  pop: 'R-.R..R-R-.R..5.', folk: 'R---5---R---5---', electro: 'R.R...R...R...R.', drive: 'R.R.R.R.R.R.R.R.',
  dream: 'R-------R---5---', summer: 'R---.R--5---.3--',
};
const STYLES = {
  synthwave: {
    groove: { intro: 'introHat', verse: 'pop', chorus: 'four', inter: 'four', bridge: 'half', outro: 'pop' },
    bass: { intro: 'long', verse: 'oct8', chorus: 'oct8', inter: 'oct8', bridge: 'half', outro: 'long' },
    arp: { intro: 8, chorus: 16, inter: 16 }, keys: {}, lead: 'saw', bassWave: 'sawtooth', pad: 'saw', delay: 0.75,
  },
  folk: {
    groove: { intro: 'none', verse: 'folk', chorus: 'folk2', inter: 'folk', bridge: 'folkHalf', outro: 'folk' },
    bass: { intro: 'long', verse: 'folk', chorus: 'folk', inter: 'folk', bridge: 'half', outro: 'long' },
    arp: { intro: 8, bridge: 8 }, keys: { verse: 1, chorus: 1, inter: 1, outro: 1 }, lead: 'flute', bassWave: 'triangle', pad: 'tri', delay: 0,
  },
  electro: {
    groove: { intro: 'electroB', verse: 'electroV', pre: 'electroV', chorus: 'electro', inter: 'electro', break: 'electroB', bridge: 'electroB', build: 'build', outro: 'electroV' },
    bass: { intro: 'long', verse: 'electro', pre: 'eighths', chorus: 'electro', inter: 'electro', break: 'long', bridge: 'half', build: 'eighths', outro: 'long' },
    arp: { intro: 16, chorus: 16, inter: 16, break: 16, build: 16 }, keys: {}, lead: 'square', bassWave: 'square', pad: 'saw', delay: 0.5, riser: { pre: 1, build: 1 },
  },
  summer: {
    groove: { intro: 'none', verse: 'summer', chorus: 'summerC', inter: 'summer', bridge: 'half', outro: 'summer' },
    bass: { intro: 'long', verse: 'summer', chorus: 'summer', inter: 'summer', bridge: 'half', outro: 'long' },
    arp: { intro: 8 }, keys: { intro: 1, verse: 1, chorus: 1, inter: 1, bridge: 1, outro: 1 }, lead: 'tri', bassWave: 'triangle', pad: 'tri', delay: 0,
  },
  drive: {
    groove: { intro: 'driveB', verse: 'drive', chorus: 'driveC', inter: 'drive', break: 'none', bridge: 'driveB', outro: 'drive' },
    bass: { intro: 'eighths', verse: 'drive', chorus: 'drive', inter: 'drive', break: 'long', bridge: 'half', outro: 'long' },
    arp: { intro: 8, break: 8, inter: 8 }, keys: {}, lead: 'saw', bassWave: 'sawtooth', pad: 'saw', delay: 0.75, leadAll: true,
  },
  dream: {
    groove: { intro: 'none', verse: 'dream', chorus: 'dreamC', inter: 'dream', break: 'none', bridge: 'dream', outro: 'dream' },
    bass: { intro: 'long', verse: 'dream', chorus: 'dream', inter: 'dream', break: 'long', bridge: 'dream', outro: 'long' },
    arp: { intro: 8, verse: 8, chorus: 16, inter: 16, break: 8, outro: 8 }, keys: {}, lead: 'sine', bassWave: 'sine', pad: 'saw', delay: 0.75,
  },
  pop: {
    groove: { intro: 'introKick', verse: 'pop', chorus: 'pop2', inter: 'pop', bridge: 'half', outro: 'pop' },
    bass: { intro: 'long', verse: 'pop', chorus: 'pop', inter: 'pop', bridge: 'half', outro: 'long' },
    arp: { chorus: 8, inter: 8 }, keys: { intro: 1, verse: 1, bridge: 1 }, lead: 'square', bassWave: 'sawtooth', pad: 'tri', delay: 0.5,
  },
};
// melody rhythms over 2 bars (32 sixteenths): x = note start, '-' = held, '.' = rest
const MEL = {
  verse: ['..x.x.x.x---x.....x.x.x.x-x-x---', 'x-x-x-x-x---x---x-x-x-x-x-------', 'x.x.x---x.x.x---x.x.x.x.x-------', '..x.x.x-x.x-x-....x.x.x-x-------'],
  chorus: ['x---x---x-x-x---x---x---x-------', 'x-x-x---x-x-x---x-x-x-x-x-------', 'x-----x-x---x---x-----x-x-------', 'x.x.x---x---x-x-x---x---x-------'],
  bridge: ['x-------x---x---x-------x-------', 'x---x---x-------x---x-x-x-------'],
  pre: ['x-x-x-x-x-x-x-x-x-x-x-x-x-------'],
};

function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Pick the BPM (within the mood range) and section start bars: close to the lyric times, with section
 *  lengths that are multiples of 4 bars where possible (2 otherwise). Small DP over candidate bars. */
function fitTempo(spec, t0) {
  let best = null;
  for (let bpm = spec.bpm[0]; bpm <= spec.bpm[1]; bpm++) {
    const bar = 240 / bpm;
    const cands = spec.secs.map(([, s], i) => {
      if (i === 0) return [0];
      const c = Math.round((s - t0) / bar), out = [];
      for (let k = c - 2; k <= c + 2; k++) if (k > 0) out.push(k);
      return out;
    });
    // dp over sections
    let prev = cands[0].map((b) => ({ b, cost: 0, path: [b] }));
    for (let i = 1; i < cands.length; i++) {
      const s = spec.secs[i][1];
      prev = cands[i].map((b) => {
        const tc = ((t0 + b * bar - s) / bar) ** 2 * 0.6;
        let bestP = null;
        for (const p of prev) {
          const len = b - p.b;
          if (len < 2) continue;
          const lc = len % 4 === 0 ? 0 : len % 2 === 0 ? 0.35 : 1.4;
          const c = p.cost + tc + lc;
          if (!bestP || c < bestP.cost) bestP = { b, cost: c, path: p.path.concat(b) };
        }
        return bestP || { b, cost: 1e9, path: [] };
      });
    }
    const totalBars = Math.floor((spec.dur / 1000 - t0 - 1.5) / bar);
    for (const p of prev) {
      const last = totalBars - p.b;
      const c = p.cost + (last % 4 === 0 ? 0 : last % 2 === 0 ? 0.2 : 0.6) + (last < 4 ? 5 : 0);
      if (!best || c < best.cost) best = { bpm, cost: c, bars: p.path };
    }
  }
  return best;
}

const cache = new Map();
export const DEMO_IDS = Object.keys(SONGS);

export function getSong(id) {
  id = String(id || '').replace(/^demo:/, '');
  if (!SONGS[id]) return null;
  if (cache.has(id)) return cache.get(id);
  const song = build(id, SONGS[id]);
  cache.set(id, song);
  return song;
}

/** Light summary (no events) — what DEMO_SONGS exports. */
export function songInfo(id) {
  const spec = SONGS[id];
  const t0 = 0.2;
  const fit = fitTempo(spec, t0);
  const bar = 240 / fit.bpm;
  return {
    id, title: spec.title, bpm: fit.bpm, key: spec.key + (spec.minor ? 'm' : ''), style: spec.style,
    firstBeatMs: t0 * 1000, durMs: spec.dur,
    sections: spec.secs.map(([type], i) => ({ type, t: Math.round((t0 + fit.bars[i] * bar) * 1000), bar: fit.bars[i] })),
  };
}

function build(id, spec) {
  const rnd = prng(spec.seed * 7919);
  const t0 = 0.2;
  const { bpm, bars: secBars } = fitTempo(spec, t0);
  const beat = 60 / bpm, bar = beat * 4, step = beat / 4;
  const dur = spec.dur / 1000;
  const totalBars = Math.floor((dur - t0 - 1.5) / bar);
  const style = STYLES[spec.style];
  const pc = NOTE[spec.key];
  const scale = SCALE[spec.minor ? 'minor' : 'major'];
  const ev = [];
  const push = (t, i, m, d, v) => { if (t < dur - 0.05) ev.push({ t, i, m, d: Math.min(d, dur - t), v }); };
  const sections = spec.secs.map(([type], i) => {
    const b0 = secBars[i];
    const b1 = i + 1 < spec.secs.length ? secBars[i + 1] : totalBars;
    return { type, bar: b0, bars: Math.max(1, b1 - b0), t: t0 + b0 * bar };
  });
  const chordPcs = (deg) => [0, 2, 4].map((k) => (pc + scale[(deg + k) % 7]) % 12);
  const place = (p, lo) => { let m = lo + ((p - lo) % 12 + 12) % 12; return m; };
  let tonicLead = place(pc, 60); if (tonicLead > 66) tonicLead -= 12;
  const leadCenter = tonicLead + 4;                         // melody centre B3..A#4 (+ lift in choruses)
  const scaleMidis = [];
  for (let m = leadCenter - 12; m <= leadCenter + 16; m++) if (scale.includes(((m - pc) % 12 + 12) % 12)) scaleMidis.push(m);
  const motifs = {};                                         // per section type → { rhythm, contour }
  const motifFor = (type) => {
    const kind = type === 'chorus' || type === 'inter' ? 'chorus' : type === 'bridge' || type === 'break' ? 'bridge' : type === 'pre' || type === 'build' ? 'pre' : 'verse';
    if (!motifs[kind]) {
      const lib = MEL[kind];
      motifs[kind] = {
        rhythm: lib[Math.floor(rnd() * lib.length)],
        contour: Array.from({ length: 16 }, () => (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.3 ? 2 : 1)),
        lift: kind === 'chorus' ? 4 : kind === 'bridge' ? 2 : kind === 'pre' ? 3 : 0,
        start: Math.floor(rnd() * 3),
      };
    }
    return motifs[kind];
  };

  let prevVoicing = null;
  for (const sec of sections) {
    const type = sec.type;
    const prog = spec.prog[type] || spec.prog.verse;
    const groove = GROOVES[style.groove[type] || style.groove.verse || 'pop'];
    const bassPat = BASS[style.bass[type] || 'long'];
    const leadOn = (spec.instrumental || style.leadAll) ? !['intro', 'outro', 'break'].includes(type) : ['verse', 'chorus', 'bridge', 'pre'].includes(type);
    const motif = motifFor(type);
    let lastLead = leadCenter + motif.lift;
    const outroFade = type === 'outro';
    for (let b = 0; b < sec.bars; b++) {
      const absBar = sec.bar + b;
      if (absBar >= totalBars) break;
      const bt = t0 + absBar * bar;
      const deg = prog[b % prog.length];
      const chord = chordPcs(deg);
      const fade = outroFade ? Math.max(0.25, 1 - b / Math.max(4, sec.bars)) : 1;
      const lastBarOfSec = b === sec.bars - 1;
      const endingBars = outroFade && b >= sec.bars - 2;
      // --- drums
      if (!endingBars) {
        for (const [inst, pat] of Object.entries(groove)) {
          for (let q = 0; q < 16; q++) {
            let c = pat[q];
            if (inst === 's' && lastBarOfSec && sec.bars >= 4 && type !== 'outro' && type !== 'intro' && q >= 12) c = '7';
            if (type === 'build' && inst === 's' && b >= sec.bars - 1) c = q % 1 === 0 ? String(4 + Math.floor(q / 4)) : c;
            if (c === '.' || c === undefined) continue;
            const v = (+c / 9) * fade;
            const name = { k: 'kick', s: 'snare', h: 'hat', o: 'ohat', x: 'shaker', c: 'clap', r: 'rim' }[inst];
            push(bt + q * step, name, 0, inst === 'o' ? 0.25 : 0.1, v);
          }
        }
        // a fill on the last bar of the section where the groove has no snare
        if (lastBarOfSec && sec.bars >= 4 && !groove.s && type !== 'outro' && type !== 'intro' && type !== 'break' && Object.keys(groove).length) {
          for (let q = 12; q < 16; q++) push(bt + q * step, 'snare', 0, 0.1, 0.55 + 0.05 * (q - 12));
        }
      }
      if (b === 0 && ['chorus', 'inter', 'outro', 'bridge'].includes(type) && sec.bar > 0) push(bt, 'crash', 0, 2, 0.8);
      if (b === 0 && type === 'chorus') push(bt, 'kick', 0, 0.1, 1);
      if (style.riser && style.riser[type] && lastBarOfSec) push(bt, 'riser', 0, bar, 0.6);
      // --- bass
      const root = place(chord[0], 36);
      if (!endingBars || b === sec.bars - 2) {
        for (let q = 0; q < 16; q++) {
          const c = bassPat[q];
          if (c === '.' || c === '-') continue;
          let len = 1; while (q + len < 16 && bassPat[q + len] === '-') len++;
          const m = c === 'R' ? root : c === '8' ? root + 12 : c === '5' ? place(chord[2], root) : place(chord[1], root);
          push(bt + q * step, 'bass', m, len * step * 0.92, (q % 4 === 0 ? 0.9 : 0.7) * fade);
        }
      }
      // --- pad (one chord per bar, voice-led into G3..F#4)
      const voicing = chord.map((p) => place(p, 55)).sort((a, z) => a - z);
      if (prevVoicing && Math.abs(voicing[0] - prevVoicing[0]) > 7) { /* keep it simple: close voicing */ }
      prevVoicing = voicing;
      const padLen = endingBars && b === sec.bars - 1 ? Math.max(bar, dur - bt - 0.1) : bar + 0.05;
      push(bt, 'pad', voicing, padLen, (type === 'chorus' ? 0.9 : type === 'intro' ? 0.7 : 0.75) * (outroFade ? Math.max(0.5, fade) : 1));
      if (endingBars && b === sec.bars - 1) { push(bt, 'kick', 0, 0.1, 0.8); push(bt, 'crash', 0, 2.5, 0.6); push(bt, 'bass', root, Math.min(bar * 2, dur - bt - 0.1), 0.7); }
      // --- keys (piano-ish comping)
      if (style.keys[type] && !endingBars) {
        const pat = type === 'chorus' ? 'x..x..x.x..x..x.' : 'x...x.x...x.x...';
        for (let q = 0; q < 16; q++) if (pat[q] === 'x') push(bt + q * step, 'keys', voicing.map((m) => m + 12), step * 2.5, (q % 4 === 0 ? 0.8 : 0.55) * fade);
      }
      // --- arpeggio
      const arpRate = style.arp[type];
      if (arpRate && !endingBars) {
        const tones = chord.map((p) => place(p, 72)).sort((a, z) => a - z);
        tones.push(tones[0] + 12);
        const order = [0, 1, 2, 3, 2, 1, 2, 3];
        const every = arpRate === 16 ? 1 : 2;
        for (let q = 0, k = 0; q < 16; q += every, k++) push(bt + q * step, 'arp', tones[order[k % order.length]], step * every * 0.9, (q % 4 === 0 ? 0.75 : 0.5) * fade);
      }
      // --- lead melody: 2-bar motif re-realised over the chords; 4-bar phrases end on a chord tone
      if (leadOn && !endingBars) {
        const half = b % 2;
        const phraseEnd = b % 4 === 3 || lastBarOfSec;
        const rh = motif.rhythm;
        let ci = half * 8;
        for (let q = 0; q < 16; q++) {
          const pos = half * 16 + q;
          if (rh[pos] !== 'x') continue;
          let len = 1; while (pos + len < 32 && rh[pos + len] === '-') len++;
          const strong = q % 8 === 0 || len >= 4;
          const isLast = (() => { for (let r = pos + 1; r < 32; r++) if (rh[r] === 'x') return false; return true; })();
          const dir = motif.contour[ci++ % 16];
          let m;
          const center = leadCenter + motif.lift;
          if ((isLast && phraseEnd) || strong) {
            // chord tone near the target
            const target = isLast && phraseEnd ? (b % 8 === 7 || lastBarOfSec ? place(chord[0], center - 5) : place(chord[1], center - 5)) : lastLead + dir * 2;
            let bestM = target, bd = 99;
            for (let mm = center - 9; mm <= center + 12; mm++) {
              if (!chord.includes(mm % 12)) continue;
              const d = Math.abs(mm - target) + (isLast && phraseEnd ? 0 : 0.3 * Math.abs(mm - center));
              if (d < bd) { bd = d; bestM = mm; }
            }
            m = bestM;
          } else {
            let idx = scaleMidis.findIndex((x) => x >= lastLead);
            if (idx < 0) idx = scaleMidis.length - 1;
            idx = Math.max(0, Math.min(scaleMidis.length - 1, idx + dir));
            m = scaleMidis[idx];
            if (m > center + 12) m = scaleMidis[Math.max(0, idx - 2)];
            if (m < center - 9) m = scaleMidis[Math.min(scaleMidis.length - 1, idx + 2)];
          }
          lastLead = m;
          push(bt + q * step, 'lead', m, len * step * 0.9, (strong ? 0.9 : 0.72) * (type === 'chorus' ? 1 : 0.9));
        }
      }
    }
  }
  ev.sort((a, b) => a.t - b.t || (a.i < b.i ? -1 : 1));
  const beats = [], downbeats = [];
  for (let k = 0; t0 + k * beat < dur; k++) { beats.push(Math.round((t0 + k * beat) * 1000 * 10) / 10); if (k % 4 === 0) downbeats.push(k); }
  return {
    id, title: spec.title, bpm, beatSec: beat, t0, durMs: spec.dur, key: spec.key + (spec.minor ? 'm' : ''), minor: spec.minor, style: spec.style,
    styleDef: style, sections: sections.map((s) => ({ ...s, tMs: Math.round(s.t * 1000) })), events: ev, beats, downbeats, totalBars,
  };
}
