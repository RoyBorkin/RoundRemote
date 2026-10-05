// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Community note charts (Clone Hero / Rock Band / Guitar Hero, as indexed by Chorus Encore) → the Rhythm Analysis.
// Pure functions — no DOM, no network — shared by the browser (rhythm/charts.js) and the bridge (bridge/lib/charts.js).
//
//   parseChartText(text)            .chart (Moonscraper / Feedback text format) → Song
//   parseMidi(bytes)                notes.mid (Rock Band / Clone Hero MIDI) → Song
//   parseNotes(format, bytes, ini)  either of the two, by format ('chart' | 'mid')
//   songToAnalysis(song, { key, ini, chart }) → Analysis (source 'chart', quality 0.95) + authored { easy, medium, hard, expert }
//   normalizeChart(encoreChartData) → { md5, name, artist, charter, lengthMs, instruments: { guitar: { diffs, rating } … } … }
//   scoreMatch(chart, { artist, title, durMs }) / rankCharts(list, track) → best matches first, with { score, nameSim, durDiff, good }
//
// Song = { resolution, offsetMs, tempos: [{ tick, bpm }], sigs: [{ tick, num, den }], sections: [{ tick, name }],
//          parts: { guitar|bass|rhythm|keys|guitarcoop: { easy|medium|hard|expert: [{ tick, lane 0–4 (5 = open), len }] },
//                   drums: { easy…expert: [{ tick, pad 0 kick|1 red|2 yellow|3 blue|4 green/orange|5 green (5-lane), cym }] } },
//          meta: { name, artist, charter, … }, endTick }
// A chart's tick 0 is the start of ITS audio; song.ini `delay` (ms, + = the chart starts later) shifts every note.

export const DIFFS = ['easy', 'medium', 'hard', 'expert'];
export const FRET_PARTS = ['guitar', 'bass', 'rhythm', 'keys', 'guitarcoop'];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ================================================================ .chart
const CHART_INSTR = { Single: 'guitar', DoubleGuitar: 'guitarcoop', DoubleBass: 'bass', DoubleRhythm: 'rhythm', Keyboard: 'keys', Drums: 'drums' };
const unq = (s) => String(s).trim().replace(/^"(.*)"$/, '$1');
function sectionName(text) {
  const t = unq(text).trim();
  const m = /^\[?\s*(?:section|prc)[ _]+(.+?)\s*\]?$/i.exec(t);
  return m ? m[1].replace(/_/g, ' ').trim() : null;
}

/** .chart text → Song */
export function parseChartText(text) {
  const song = { resolution: 192, offsetMs: 0, tempos: [], sigs: [], sections: [], parts: {}, meta: {}, endTick: 0, format: 'chart' };
  const raw = {};   // `${instr}:${diff}` → Map(tick → { frets:Set, len, flags:Set })
  let sec = null;
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const head = /^\[(.+)\]$/.exec(t);
    if (head) { sec = head[1].trim(); continue; }
    if (t === '{' || t === '}' || !sec) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim(), val = t.slice(eq + 1).trim();
    if (sec === 'Song') { song.meta[key.toLowerCase()] = unq(val); continue; }
    const tick = parseInt(key, 10);
    if (!Number.isFinite(tick)) continue;
    const parts = val.split(/\s+/), type = parts[0];
    if (sec === 'SyncTrack') {
      if (type === 'B') song.tempos.push({ tick, bpm: (+parts[1] || 120000) / 1000 });
      else if (type === 'TS') song.sigs.push({ tick, num: +parts[1] || 4, den: 2 ** (parts[2] != null ? +parts[2] : 2) });
      continue;
    }
    if (sec === 'Events') {
      if (type === 'E') { const n = sectionName(val.slice(1)); if (n) song.sections.push({ tick, name: n }); }
      continue;
    }
    const tm = /^(Easy|Medium|Hard|Expert)(Single|DoubleGuitar|DoubleBass|DoubleRhythm|Keyboard|Drums)$/.exec(sec);
    if (!tm || type !== 'N') continue;
    const instr = CHART_INSTR[tm[2]], diff = tm[1].toLowerCase();
    const k = `${instr}:${diff}`;
    const m = (raw[k] ||= new Map());
    const g = m.get(tick) || { frets: new Set(), len: 0, flags: new Set() };
    const fret = +parts[1], len = +parts[2] || 0;
    if (instr === 'drums') {
      if (fret <= 5 || fret === 32) { g.frets.add(fret === 32 ? 0 : fret); g.len = Math.max(g.len, len); }
      else g.flags.add(fret);
    } else if (fret <= 4 || fret === 7) { g.frets.add(fret === 7 ? 5 : fret); g.len = Math.max(g.len, len); }
    else g.flags.add(fret);
    m.set(tick, g);
    if (tick + len > song.endTick) song.endTick = tick + len;
  }
  song.resolution = +song.meta.resolution || 192;
  song.offsetMs = Math.round((+song.meta.offset || 0) * 1000);
  const fiveLane = Object.entries(raw).some(([k, m]) => k.startsWith('drums:') && [...m.values()].some((g) => g.frets.has(5)));
  for (const [k, m] of Object.entries(raw)) {
    const [instr, diff] = k.split(':');
    const list = [];
    for (const [tick, g] of [...m.entries()].sort((a, b) => a[0] - b[0])) {
      for (const f of [...g.frets].sort((a, b) => a - b)) {
        if (instr === 'drums') {
          const cym = fiveLane ? f === 2 || f === 4 : (f >= 2 && f <= 4 && g.flags.has(64 + f));
          list.push({ tick, pad: f, cym });
        } else list.push({ tick, lane: f, len: g.len });
      }
    }
    if (list.length) (song.parts[instr] ||= {})[diff] = list;
  }
  if (fiveLane) song.fiveLaneDrums = true;
  return song;
}

// ================================================================ MIDI
/** Standard MIDI file → { division, tracks: [{ name, notes: [{ tick, note, len, vel }], texts, tempos, sigs, end }] } */
export function readMidi(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const str = (o, n) => String.fromCharCode(...u.subarray(o, o + n));
  const r32 = (o) => ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3];
  const r16 = (o) => (u[o] << 8) | u[o + 1];
  if (str(0, 4) !== 'MThd') throw new Error('Not a MIDI file');
  const hl = r32(4), ntr = r16(10), division = r16(12);
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI is not supported');
  let o = 8 + hl;
  const tracks = [];
  const dec = new TextDecoder();
  for (let ti = 0; ti < ntr && o + 8 <= u.length; ti++) {
    while (o + 8 <= u.length && str(o, 4) !== 'MTrk') o += 8 + r32(o + 4);   // skip unknown chunks
    if (o + 8 > u.length) break;
    const end = Math.min(u.length, o + 8 + r32(o + 4));
    o += 8;
    const T = { name: '', notes: [], texts: [], tempos: [], sigs: [], end: 0 };
    const open = new Map();
    let tick = 0, run = 0;
    const vlq = () => { let v = 0, b; do { b = u[o++]; v = v * 128 + (b & 0x7f); } while (b & 0x80 && o < end); return v; };
    while (o < end) {
      tick += vlq();
      let st = u[o];
      if (st === 0xff) {
        const type = u[o + 1]; o += 2;
        const l = vlq(), d = u.subarray(o, o + l); o += l;
        if (type === 0x03 && !T.name) T.name = dec.decode(d).trim();
        else if (type === 0x51 && l >= 3) T.tempos.push({ tick, us: (d[0] << 16) | (d[1] << 8) | d[2] });
        else if (type === 0x58 && l >= 2) T.sigs.push({ tick, num: d[0], den: 2 ** d[1] });
        else if (type >= 0x01 && type <= 0x07) T.texts.push({ tick, text: dec.decode(d) });
        else if (type === 0x2f) break;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) { o++; const l = vlq(); o += l; continue; }
      if (st & 0x80) { run = st; o++; } else st = run;
      const type = st & 0xf0;
      if (type === 0x90 || type === 0x80) {
        const n = u[o], v = u[o + 1]; o += 2;
        if (type === 0x90 && v > 0) {
          if (open.has(n)) { const s = open.get(n); T.notes.push({ tick: s.tick, note: n, len: tick - s.tick, vel: s.vel }); }
          open.set(n, { tick, vel: v });
        } else if (open.has(n)) {
          const s = open.get(n); open.delete(n);
          T.notes.push({ tick: s.tick, note: n, len: tick - s.tick, vel: s.vel });
        }
      } else if (type === 0xc0 || type === 0xd0) o += 1;
      else o += 2;
    }
    for (const [n, s] of open) T.notes.push({ tick: s.tick, note: n, len: 0, vel: s.vel });
    T.notes.sort((a, b) => a.tick - b.tick || a.note - b.note);
    T.end = tick;
    tracks.push(T);
    o = end;
  }
  return { division, tracks };
}

const MIDI_PARTS = { 'PART GUITAR': 'guitar', 'T1 GEMS': 'guitar', 'PART BASS': 'bass', 'PART RHYTHM': 'rhythm', 'PART KEYS': 'keys', 'PART GUITAR COOP': 'guitarcoop', 'PART DRUMS': 'drums', 'PART DRUM': 'drums' };
const MIDI_BASE = { easy: 60, medium: 72, hard: 84, expert: 96 };

/** notes.mid → Song */
export function parseMidi(bytes, ini = {}) {
  const mid = readMidi(bytes);
  const res = mid.division || 480;
  const song = { resolution: res, offsetMs: 0, tempos: [], sigs: [], sections: [], parts: {}, meta: {}, endTick: 0, format: 'mid' };
  const t0 = mid.tracks[0] || { tempos: [], sigs: [] };
  const tempoSrc = t0.tempos.length ? [t0] : mid.tracks;
  for (const T of tempoSrc) for (const x of T.tempos) song.tempos.push({ tick: x.tick, bpm: 60e6 / x.us });
  for (const x of (t0.sigs.length ? t0.sigs : mid.tracks.flatMap((T) => T.sigs))) song.sigs.push({ tick: x.tick, num: x.num, den: x.den });
  const cutoff = +ini.sustain_cutoff_threshold > 0 ? +ini.sustain_cutoff_threshold : Math.round(res / 3);
  const fiveLane = /^(1|true)$/i.test(String(ini.five_lane_drums || ''));
  for (const T of mid.tracks) {
    const name = T.name.toUpperCase();
    for (const x of T.notes) song.endTick = Math.max(song.endTick, x.tick + x.len);
    if (name === 'EVENTS') {
      for (const x of T.texts) { const n = sectionName(x.text); if (n) song.sections.push({ tick: x.tick, name: n }); }
      continue;
    }
    const instr = MIDI_PARTS[name];
    if (!instr || song.parts[instr]) continue;
    const P = {};
    if (instr === 'drums') {
      const toms = { 2: [], 3: [], 4: [] };     // tom markers 110–112 (yellow / blue / green)
      for (const x of T.notes) if (x.note >= 110 && x.note <= 112) toms[x.note - 108].push([x.tick, x.tick + Math.max(1, x.len)]);
      const isTom = (pad, tick) => toms[pad]?.some(([a, b]) => tick >= a && tick < b);
      for (const d of DIFFS) {
        const b = MIDI_BASE[d], list = [];
        for (const x of T.notes) {
          let pad = x.note - b;
          if (d === 'expert' && x.note === 95) pad = 0;            // 2× kick
          if (pad < 0 || pad > 5 || (pad === 5 && !fiveLane)) continue;
          const cym = fiveLane ? pad === 2 || pad === 4 : pad >= 2 && pad <= 4 && !isTom(pad, x.tick);
          list.push({ tick: x.tick, pad, cym });
        }
        if (list.length) P[d] = list;
      }
    } else {
      const opens = T.texts.some((x) => /ENHANCED_OPENS/i.test(x.text));
      for (const d of DIFFS) {
        const b = MIDI_BASE[d], list = [];
        for (const x of T.notes) {
          let lane = x.note - b;
          if (opens && lane === -1) lane = 5;
          if (lane < 0 || lane > 5) continue;
          list.push({ tick: x.tick, lane, len: x.len >= cutoff ? x.len : 0 });
        }
        if (list.length) P[d] = list;
      }
    }
    if (Object.keys(P).length) song.parts[instr] = P;
  }
  return song;
}

/** Either format; `bytes` is a Uint8Array (or the .chart text). */
export function parseNotes(format, bytes, ini = {}) {
  if (format === 'mid') return parseMidi(bytes, ini);
  return parseChartText(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
}

// ================================================================ tempo map
/** tick ↔ ms over the song's tempo changes (ms from the chart's tick 0, before any delay). */
export function tempoMap(song) {
  const res = song.resolution || 192;
  const T = (song.tempos.length ? [...song.tempos] : [{ tick: 0, bpm: 120 }]).filter((x) => x.bpm > 0).sort((a, b) => a.tick - b.tick);
  if (!T.length) T.push({ tick: 0, bpm: 120 });
  if (T[0].tick > 0) T.unshift({ tick: 0, bpm: T[0].bpm });
  let ms = 0;
  for (let i = 0; i < T.length; i++) {
    T[i].ms = ms;
    if (i + 1 < T.length) ms += ((T[i + 1].tick - T[i].tick) / res) * (60000 / T[i].bpm);
  }
  const seg = (key, v) => { let lo = 0, hi = T.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m][key] <= v) lo = m; else hi = m - 1; } return T[lo]; };
  return {
    segs: T,
    toMs: (tick) => { const s = seg('tick', tick); return s.ms + ((tick - s.tick) / res) * (60000 / s.bpm); },
    toTick: (t) => { const s = seg('ms', t); return s.tick + ((t - s.ms) * s.bpm / 60000) * res; },
  };
}

// ================================================================ Song → Analysis
const PAD_P = [0.08, 0.35, 0.55, 0.65, 0.75, 0.82];
const sectionKey = (n) => String(n).toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\b(?:\d+|[a-d])\b/g, '').replace(/\s+/g, ' ').trim() || n;

/**
 * @param song   from parseChartText / parseMidi
 * @param opts   { key, ini (song.ini values), chart (the library record: md5, charter…), durMs (fallback length) }
 * @returns Analysis (+ authored: { easy, medium, hard, expert } of { t, lane 0–4, dur }, instrument, chart)
 */
export function songToAnalysis(song, { key = '', ini = {}, chart = null, durMs: durHint = 0 } = {}) {
  const res = song.resolution || 192;
  const TM = tempoMap(song);
  const delay = (Number.isFinite(+ini.delay) ? +ini.delay : 0) + (song.offsetMs || (Number.isFinite(+ini.chart_offset) ? Math.round(+ini.chart_offset * 1000) : 0));
  const T = (tick) => Math.round(TM.toMs(tick) + delay);
  const lenMs = (tick, len) => (len > 0 ? Math.max(0, Math.round(TM.toMs(tick + len) - TM.toMs(tick))) : 0);

  // which part plays the "song": guitar first, then bass / rhythm / keys; drums alone if that's all there is
  const instrument = FRET_PARTS.find((p) => song.parts[p] && DIFFS.some((d) => song.parts[p][d]?.length)) || (song.parts.drums ? 'drums' : null);
  if (!instrument) throw new Error('This chart has no guitar, bass, keys or drums notes');
  const part = song.parts[instrument];
  const topDiff = [...DIFFS].reverse().find((d) => part[d]?.length);
  const drums = song.parts.drums?.expert || song.parts.drums?.[[...DIFFS].reverse().find((d) => song.parts.drums?.[d]?.length)] || [];

  // ---- length
  const endTick = Math.max(song.endTick || 0, ...Object.values(song.parts).flatMap((P) => Object.values(P).map((l) => (l.length ? l[l.length - 1].tick + (l[l.length - 1].len || 0) : 0))));
  const lastMs = T(endTick);
  const iniLen = +ini.song_length || 0;
  const durMs = Math.round(Math.max(lastMs + 1500, iniLen > lastMs ? iniLen : 0, !iniLen && durHint > lastMs ? durHint : 0));

  // ---- beats (quarter notes) & downbeats (bar starts from the time signatures)
  const beatsAll = [];
  const lastBeatTick = TM.toTick(durMs - delay) + res;
  for (let k = 0; k * res <= lastBeatTick; k++) beatsAll.push(T(k * res));
  const sigs = (song.sigs.length ? [...song.sigs] : [{ tick: 0, num: 4, den: 4 }]).sort((a, b) => a.tick - b.tick);
  if (sigs[0].tick > 0) sigs.unshift({ tick: 0, num: 4, den: 4 });
  const downTicks = [];
  for (let i = 0; i < sigs.length; i++) {
    const barLen = Math.max(1, Math.round(sigs[i].num * res * 4 / (sigs[i].den || 4)));
    const stop = i + 1 < sigs.length ? sigs[i + 1].tick : lastBeatTick;
    for (let t = sigs[i].tick; t < stop; t += barLen) downTicks.push(t);
  }
  const first = beatsAll.findIndex((t) => t >= 0);
  const beats = first < 0 ? [] : beatsAll.slice(first);
  const downSet = new Set();
  for (const dt of downTicks) { const bi = Math.round(dt / res) - first; if (bi >= 0 && bi < beats.length) downSet.add(bi); }
  const downbeats = [...downSet].sort((a, b) => a - b);

  // ---- main tempo: the one the song spends the most time in
  const tempoTime = new Map();
  const segs = TM.segs;
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i].ms, b = i + 1 < segs.length ? segs[i + 1].ms : Math.max(a, durMs - delay);
    const k = Math.round(segs[i].bpm * 2) / 2;
    tempoTime.set(k, (tempoTime.get(k) || 0) + Math.max(0, b - a));
  }
  let bpm = 120, bestT = -1;
  for (const [k, v] of tempoTime) if (v > bestT) { bestT = v; bpm = k; }

  // ---- onsets: the expert part's notes (chord size, metre and sustains make them stronger) + the drums
  const onsets = [];
  const metre = (tick) => (tick % res === 0 ? 0.15 : tick % (res / 2) === 0 ? 0.06 : 0);
  const groups = new Map();
  for (const n of part[topDiff] || []) { const g = groups.get(n.tick) || []; g.push(n); groups.set(n.tick, g); }
  if (instrument !== 'drums') {
    for (const [tick, g] of groups) {
      const t = T(tick);
      if (t < 0) continue;
      const lanes = g.map((n) => (n.lane === 5 ? 2 : n.lane));
      const d = lenMs(tick, Math.max(...g.map((n) => n.len || 0)));
      const avg = lanes.reduce((s, x) => s + x, 0) / lanes.length;
      onsets.push({ t, s: Math.round(clamp(0.5 + 0.12 * (g.length - 1) + metre(tick) + (d > 0 ? 0.08 : 0), 0, 1) * 1000) / 1000, b: 1, p: Math.round((0.1 + 0.8 * avg / 4) * 1000) / 1000, d });
    }
  }
  for (const n of drums) {
    const t = T(n.tick);
    if (t < 0) continue;
    const b = n.pad === 0 ? 0 : n.cym ? 2 : 1;
    const s = n.pad === 0 ? 0.85 : n.pad === 1 ? 0.8 : n.cym ? (downSet.size && n.tick % res === 0 ? 0.62 : 0.55) : 0.6;
    onsets.push({ t, s, b, p: n.cym ? 0.9 : PAD_P[n.pad] ?? 0.5, d: 0 });
  }
  onsets.sort((a, b) => a.t - b.t || a.b - b.b);

  // ---- energy (note density, 250 ms bins over ±1 s) & sections
  const nb = Math.ceil(durMs / 250) + 1;
  const dens = new Float32Array(nb);
  for (const o of onsets) { const i = Math.floor(o.t / 250); for (let k = Math.max(0, i - 4); k <= Math.min(nb - 1, i + 4); k++) dens[k] += o.s; }
  const sorted = [...dens].filter((x) => x > 0).sort((a, b) => a - b);
  const ref = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] || sorted[sorted.length - 1] : 1;
  const energy = [...dens].map((x) => Math.round(clamp(x / ref, 0, 1) * 1000) / 1000);
  const meanE = (a, b) => { let s = 0, c = 0; for (let i = Math.max(0, Math.floor(a / 250)); i < Math.min(nb, Math.ceil(b / 250)); i++) { s += energy[i]; c++; } return c ? s / c : 0; };
  let sections = [];
  if (song.sections.length) {
    const ss = [...song.sections].sort((a, b) => a.tick - b.tick);
    const keys = new Map();
    ss.forEach((s, i) => {
      const t = Math.max(0, T(s.tick)), t1 = i + 1 < ss.length ? T(ss[i + 1].tick) : durMs;
      const sk = sectionKey(s.name);
      if (!keys.has(sk)) keys.set(sk, keys.size);
      sections.push({ t, e: Math.round(meanE(t, t1) * 1000) / 1000, k: keys.get(sk), name: s.name });
    });
    if (sections[0].t > 1500) sections.unshift({ t: 0, e: Math.round(meanE(0, sections[0].t) * 1000) / 1000, k: -1, name: 'Intro' });
    else sections[0].t = 0;
  } else {
    // every 8 bars, merging neighbours of about the same energy
    const step = downbeats.length > 8 ? 8 : 0;
    const starts = step ? downbeats.filter((_, i) => i % step === 0).map((bi) => beats[bi]) : [0];
    if (starts[0] > 0) starts.unshift(0);
    for (let i = 0; i < starts.length; i++) {
      const e = meanE(starts[i], starts[i + 1] ?? durMs);
      const prev = sections[sections.length - 1];
      if (prev && Math.abs(prev.e - e) < 0.1) continue;
      sections.push({ t: Math.round(starts[i]), e: Math.round(e * 1000) / 1000 });
    }
  }

  // ---- authored charts per difficulty (5 lanes; opens on the middle lane)
  const authored = {};
  for (const d of DIFFS) {
    const list = part[d];
    if (!list?.length) continue;
    const out = [];
    for (const n of list) {
      const t = T(n.tick);
      if (t < 0) continue;
      let lane;
      if (instrument === 'drums') {
        // pads red / yellow / blue / green on lanes 0–3 and the kick on lane 4 (5-lane drums: the pads as written, no kick)
        if (n.pad === 0) { if (song.fiveLaneDrums) continue; lane = 4; } else lane = n.pad - 1;
      } else lane = n.lane === 5 ? 2 : n.lane;
      lane = clamp(lane, 0, 4);
      const beatMs = 60000 / (segAtTick(segs, n.tick)?.bpm || bpm);
      const dur = instrument === 'drums' ? 0 : lenMs(n.tick, n.len || 0);
      out.push({ t, lane, dur: dur >= Math.max(180, beatMs * 0.4) ? dur : 0 });
    }
    // one note per lane and time
    out.sort((a, b) => a.t - b.t || a.lane - b.lane);
    authored[d] = out.filter((n, i) => i === 0 || n.t !== out[i - 1].t || n.lane !== out[i - 1].lane);
  }

  return {
    v: 1, key, source: 'chart', created: Date.now(), durMs, bpm: Math.round(bpm * 100) / 100,
    beats, downbeats, onsets, energy, sections, quality: 0.95,
    authored, instrument,
    chart: chart ? {
      md5: chart.md5, name: chart.name || song.meta.name || ini.name || '', artist: chart.artist || song.meta.artist || ini.artist || '',
      charter: chart.charter || ini.charter || ini.frets || song.meta.charter || '', format: song.format, delayMs: delay,
    } : { name: song.meta.name || ini.name || '', artist: song.meta.artist || ini.artist || '', charter: ini.charter || ini.frets || song.meta.charter || '', format: song.format, delayMs: delay },
  };
}
function segAtTick(segs, tick) { let s = segs[0]; for (const x of segs) { if (x.tick <= tick) s = x; else break; } return s; }

// ================================================================ the library's search results
const INSTR = ['guitar', 'bass', 'rhythm', 'keys', 'drums', 'guitarcoop', 'guitarghl', 'bassghl'];
/** One Chorus Encore ChartData → { md5, name, artist, album, year, charter, lengthMs, instruments: { guitar: { diffs: ['easy'…], rating, notes } }, … } */
export function normalizeChart(c) {
  if (!c || !c.md5) return null;
  const ins = {};
  const nd = c.notesData || {};
  for (const n of Array.isArray(nd.noteCounts) ? nd.noteCounts : []) {
    if (!n || !INSTR.includes(n.instrument) || !n.count) continue;
    const e = (ins[n.instrument] ||= { diffs: [], notes: 0 });
    if (DIFFS.includes(n.difficulty) && !e.diffs.includes(n.difficulty)) e.diffs.push(n.difficulty);
    if (n.difficulty === 'expert') e.notes = n.count;
  }
  for (const i of Array.isArray(nd.instruments) ? nd.instruments : []) if (INSTR.includes(i)) ins[i] ||= { diffs: [], notes: 0 };
  for (const i of INSTR) {
    const r = c[`diff_${i}`];
    if (r != null && r >= 0) { ins[i] ||= { diffs: [], notes: 0 }; ins[i].rating = r; }
  }
  for (const e of Object.values(ins)) e.diffs.sort((a, b) => DIFFS.indexOf(a) - DIFFS.indexOf(b));
  return {
    md5: String(c.md5), name: String(c.name || c.chartName || ''), artist: String(c.artist || ''), album: String(c.album || ''),
    year: String(c.year || ''), genre: String(c.genre || ''), charter: String(c.charter || '').replace(/<[^>]*>/g, ''),
    lengthMs: +c.song_length || 0, instruments: ins, hasVideo: !!c.hasVideoBackground,
    delay: +c.delay || 0, modified: c.modifiedTime || null, chartId: c.chartId ?? null, songId: c.songId ?? null,
  };
}

// ================================================================ matching a chart to the song that plays
/** "Song (Remastered 2011) - Live" → "Song" */
export function cleanTitle(s = '') {
  return String(s).replace(/\s*[([][^)\]]*(?:remaster|live|version|edit|mix|mono|stereo|deluxe|feat|ft\.|bonus|demo|explicit)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|live|single|radio|mono|stereo|edit|version|explicit).*$/i, '')
    .replace(/\s+(?:feat\.?|ft\.?)\s.*$/i, '').trim();
}
export const firstArtist = (s = '') => String(s).split(/\s*(?:,|&| x | feat\.? | ft\.? | with | and )\s*/i)[0].trim();
export function norm(s = '') {
  return String(s).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[([].*?[)\]]/g, ' ').replace(/&/g, ' and ').replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
/** 0..1 — bigram Dice similarity of the normalised strings (containment counts as close). */
export function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bg = (s) => { const m = new Map(); const x = s.replace(/ /g, ''); for (let i = 0; i < x.length - 1; i++) { const k = x.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b);
  let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  let d = na + nb ? (2 * inter) / (na + nb) : 0;
  if ((a.length > 3 && b.startsWith(a + ' ')) || (b.length > 3 && a.startsWith(b + ' '))) d = Math.max(d, 0.88);
  return d;
}
/** How well a library chart fits the song playing: { score 0..1, nameSim, titleSim, artistSim, durDiff (ms|null), good } */
export function scoreMatch(c, { artist = '', title = '', durMs = 0 } = {}) {
  let titleSim = Math.max(similarity(cleanTitle(title), cleanTitle(c.name)), similarity(title, c.name));
  // a live / acoustic / remix chart is another recording than the studio track (and the other way round)
  const kind = (s) => (/\b(live|acoustic|unplugged|remix|demo|instrumental)\b/i.exec(s) || [''])[0].toLowerCase();
  if (kind(title) !== kind(c.name)) titleSim *= 0.7;
  const artistSim = Math.max(similarity(artist, c.artist), similarity(firstArtist(artist), firstArtist(c.artist)));
  const nameSim = artist ? 0.6 * titleSim + 0.4 * artistSim : titleSim;
  const durDiff = durMs > 0 && c.lengthMs > 0 ? Math.abs(durMs - c.lengthMs) : null;
  const durScore = durDiff == null ? 0.5 : durDiff <= 2000 ? 1 : durDiff <= 4000 ? 0.85 : durDiff <= 10000 ? 0.5 : durDiff <= 30000 ? 0.2 : 0;
  const I = c.instruments || {};
  const playable = FRET_PARTS.some((p) => I[p]) || !!I.drums;
  const full = FRET_PARTS.some((p) => (I[p]?.diffs || []).length >= 4) ? 1 : FRET_PARTS.some((p) => I[p]) ? 0.6 : 0.3;
  const score = (0.68 * nameSim + 0.25 * durScore + 0.07 * full) * (playable || !Object.keys(I).length ? 1 : 0.5);
  const good = nameSim >= 0.85 && durDiff != null && durDiff <= 4000 && playable;
  return { score: Math.round(score * 1000) / 1000, nameSim: Math.round(nameSim * 1000) / 1000, titleSim, artistSim, durDiff, good };
}
/** Best first; each item gets .match = scoreMatch(…). */
export function rankCharts(list, track = {}) {
  return (list || []).map((c) => ({ ...c, match: scoreMatch(c, track) }))
    .sort((a, b) => b.match.score - a.match.score || (a.match.durDiff ?? 1e9) - (b.match.durDiff ?? 1e9));
}
/** "Guitar E M H X · Drums X" */
export function instrumentsText(c) {
  const N = { guitar: 'Guitar', bass: 'Bass', rhythm: 'Rhythm', keys: 'Keys', drums: 'Drums', guitarcoop: 'Co-op' };
  const L = { easy: 'E', medium: 'M', hard: 'H', expert: 'X' };
  return Object.entries(c.instruments || {}).filter(([k]) => N[k])
    .sort((a, b) => Object.keys(N).indexOf(a[0]) - Object.keys(N).indexOf(b[0]))
    .slice(0, 3).map(([k, v]) => `${N[k]}${v.diffs?.length ? ' ' + v.diffs.map((d) => L[d]).join('') : ''}`).join(' · ');
}
