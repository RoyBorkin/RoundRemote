// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Sleep Sounds engine: procedurally generated sounds with the Web Audio API (no audio files) — white, pink and brown
// noise, rain, a thunderstorm, ocean waves, a stream, a fan, wind, a fireplace, a heartbeat and a soft drone. Up to
// three play at once, each with its own volume, into a master gain (volume × sleep-timer fade). Module level, so the
// sound keeps playing when you leave the app, until you stop it or the sleep timer ends (gentle fade-out; then it
// can pause the music player). It can also dim Home Assistant lights slowly. Focus (focus-engine.js) uses it for focus noise.
//
// Saved in settings.appData.noise: { mix: [{ id, vol }], master, timer (minutes or 'morning'), morning: 'HH:MM',
//   presets: [{ id, name, mix }], dim: { on, ids, minutes }, pauseMusic, autoDim }
import { store } from '../js/core/store.js';
import { Emitter } from '../js/core/util.js';
import { player } from '../js/core/player.js';
import { rampLights } from './plants-ha.js';

export const COLOR = '#6366f1';
export const SOUNDS = [
  { id: 'white', name: 'White noise' }, { id: 'pink', name: 'Pink noise' }, { id: 'brown', name: 'Brown noise' },
  { id: 'rain', name: 'Rain' }, { id: 'storm', name: 'Thunderstorm' }, { id: 'ocean', name: 'Ocean waves' },
  { id: 'stream', name: 'Stream' }, { id: 'fan', name: 'Fan' }, { id: 'wind', name: 'Wind' },
  { id: 'fire', name: 'Fireplace' }, { id: 'heart', name: 'Heartbeat' }, { id: 'drone', name: 'Soft drone' },
];
export const PRESETS = [
  { id: 'rainy', name: 'Rainy night', mix: [{ id: 'rain', vol: 0.8 }, { id: 'brown', vol: 0.35 }] },
  { id: 'storm', name: 'Storm', mix: [{ id: 'storm', vol: 0.85 }, { id: 'wind', vol: 0.3 }] },
  { id: 'sea', name: 'By the sea', mix: [{ id: 'ocean', vol: 0.85 }, { id: 'wind', vol: 0.2 }] },
  { id: 'cabin', name: 'Cabin', mix: [{ id: 'fire', vol: 0.75 }, { id: 'rain', vol: 0.4 }, { id: 'wind', vol: 0.25 }] },
  { id: 'forest', name: 'Forest stream', mix: [{ id: 'stream', vol: 0.8 }, { id: 'wind', vol: 0.25 }] },
  { id: 'deep', name: 'Deep sleep', mix: [{ id: 'brown', vol: 0.75 }, { id: 'fan', vol: 0.35 }] },
  { id: 'womb', name: 'Baby / womb', mix: [{ id: 'heart', vol: 0.8 }, { id: 'pink', vol: 0.4 }] },
  { id: 'calm', name: 'Calm drone', mix: [{ id: 'drone', vol: 0.6 }, { id: 'pink', vol: 0.25 }] },
];
export const TIMERS = [0, 15, 30, 60, 90, 'morning'];
export const events = new Emitter();   // 'change'
const MAX = 3;

// ------------------------------------------------------------------ saved settings
export const nData = () => (store.get('appData') || {}).noise || {};
export function saveN(patch) { const all = store.get('appData') || {}; store.set('appData', { ...all, noise: { ...(all.noise || {}), ...patch } }); }
export const savedMix = () => (nData().mix?.length ? nData().mix : PRESETS[0].mix).slice(0, MAX);

// ------------------------------------------------------------------ buffers (generated once per context)
const cache = new WeakMap();
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
/** A stereo loop of `secs` from fill(channelData, n, sr, ch); the ends are cross-faded so it loops without a click. */
function makeLoop(ctx, secs, fill) {
  const sr = ctx.sampleRate, n = Math.floor(secs * sr), xf = Math.floor(0.25 * sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const tmp = new Float32Array(n + xf);
    fill(tmp, n + xf, sr, ch);
    const out = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) out[i] = tmp[i];
    for (let i = 0; i < xf; i++) { const a = i / xf; out[i] = tmp[i] * Math.sqrt(a) + tmp[n + i] * Math.sqrt(1 - a); }
  }
  return buf;
}
const fills = {
  white(d, n) { for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1; },
  pink(d, n) {   // Paul Kellet's refined filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  },
  brown(d, n) { let last = 0; for (let i = 0; i < n; i++) { last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02; d[i] = last * 3.5; } },
};
/** Short random events (rain drops, crackles, bubbles) mixed into a loop. */
function events_(d, n, sr, { rate, make }) {
  const count = Math.floor((n / sr) * rate);
  for (let k = 0; k < count; k++) make(d, Math.floor(rnd() * n), sr, n);
}
function buffers(ctx) {
  let b = cache.get(ctx);
  if (b) return b;
  b = {};
  const lazy = (name, fn) => Object.defineProperty(b, name, { get() { const v = fn(); Object.defineProperty(b, name, { value: v }); return v; }, configurable: true });
  lazy('white', () => makeLoop(ctx, 4, fills.white));
  lazy('pink', () => makeLoop(ctx, 6, fills.pink));
  lazy('brown', () => makeLoop(ctx, 6, fills.brown));
  // rain drops: tiny decaying noise ticks with a bright "plip" (random level, stereo position)
  const drops = (rate, bright) => (d, n, sr, ch) => events_(d, n, sr, { rate, make: (dd, at) => {
    const len = Math.floor(sr * (0.004 + rnd() * 0.02)), amp = rnd() ** 2.2 * 0.9, pan = ch ? rnd() : rnd();
    const f = 2200 + rnd() * 4200 * bright;
    for (let i = 0; i < len && at + i < n; i++) { const e = Math.exp(-i / (len * 0.25)); dd[at + i] += amp * pan * e * ((rnd() * 2 - 1) * 0.6 + Math.sin((2 * Math.PI * f * i) / sr) * 0.4); }
  } });
  lazy('rain', () => makeLoop(ctx, 7, drops(420, 1)));
  lazy('heavy', () => makeLoop(ctx, 7, drops(1100, 0.7)));
  // bubbles for the stream: little rising sine blips
  lazy('bubbles', () => makeLoop(ctx, 8, (d, n, sr) => events_(d, n, sr, { rate: 34, make: (dd, at) => {
    const len = Math.floor(sr * (0.015 + rnd() * 0.05)), f0 = 380 + rnd() * 1200, amp = 0.08 + rnd() ** 2 * 0.3;
    let ph = 0;
    for (let i = 0; i < len && at + i < n; i++) { const t = i / len; ph += (2 * Math.PI * f0 * (1 + 0.9 * t)) / sr; dd[at + i] += amp * Math.sin(ph) * Math.sin(Math.PI * t) ** 2; }
  } })));
  // fire crackles: sharp clicks, sometimes a pop
  lazy('crackle', () => makeLoop(ctx, 8, (d, n, sr) => events_(d, n, sr, { rate: 26, make: (dd, at) => {
    const pop = rnd() < 0.12, len = Math.floor(sr * (pop ? 0.012 + rnd() * 0.02 : 0.0015 + rnd() * 0.004)), amp = (pop ? 0.6 : 0.25) * rnd() ** 1.6 + 0.03;
    for (let i = 0; i < len && at + i < n; i++) dd[at + i] += amp * Math.exp(-i / (len * 0.3)) * (rnd() * 2 - 1);
  } })));
  // one heartbeat (62 bpm): lub-dub, low and soft
  lazy('beat', () => {
    const sr = ctx.sampleRate, n = Math.floor(sr * (60 / 62));
    const buf = ctx.createBuffer(2, n, sr);
    const thump = (d, at, f, amp, dur) => { let ph = 0; const len = Math.floor(sr * dur); for (let i = 0; i < len && at + i < n; i++) { const t = i / sr; ph += (2 * Math.PI * f * (1 - 0.35 * (i / len))) / sr; d[at + i] += amp * Math.sin(ph) * (1 - Math.exp(-t * 90)) * Math.exp(-t * 16); } };
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); thump(d, Math.floor(sr * 0.02), 58, 0.95, 0.28); thump(d, Math.floor(sr * 0.33), 50, 0.6, 0.24); }
    return buf;
  });
  lazy('thunder', () => { const sr = ctx.sampleRate, n = Math.floor(sr * 9); const buf = ctx.createBuffer(2, n, sr); for (let ch = 0; ch < 2; ch++) fills.brown(buf.getChannelData(ch), n); return buf; });
  cache.set(ctx, b);
  return b;
}

// ------------------------------------------------------------------ the sounds: build(ctx, out) → { stop() }
function src(ctx, buffer, { rate = 1, offset = 0 } = {}) { const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true; s.playbackRate.value = rate; s.start(ctx.currentTime, offset % buffer.duration); return s; }
const gain = (ctx, v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
function filt(ctx, type, f, q = 0.7) { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; }
function lfo(ctx, hz, depth, target, type = 'sine') { const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz; const g = gain(ctx, depth); o.connect(g); g.connect(target); o.start(); return o; }
const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };
const stopAll = (list) => () => { for (const n of list) { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} } };

const BUILD = {
  white(ctx, out) { const B = buffers(ctx), s = src(ctx, B.white); chain(s, filt(ctx, 'lowpass', 9000), gain(ctx, 0.22), out); return { stop: stopAll([s]) }; },
  pink(ctx, out) { const B = buffers(ctx), s = src(ctx, B.pink); chain(s, gain(ctx, 0.75), out); return { stop: stopAll([s]) }; },
  brown(ctx, out) { const B = buffers(ctx), s = src(ctx, B.brown); chain(s, filt(ctx, 'lowpass', 1400), gain(ctx, 0.9), out); return { stop: stopAll([s]) }; },
  rain(ctx, out) {
    const B = buffers(ctx);
    const bed = src(ctx, B.pink, { offset: 1.3 }), dr = src(ctx, B.rain);
    chain(bed, filt(ctx, 'highpass', 450), filt(ctx, 'lowpass', 7000), gain(ctx, 0.42), out);
    chain(dr, filt(ctx, 'highpass', 900), gain(ctx, 0.75), out);
    return { stop: stopAll([bed, dr]) };
  },
  storm(ctx, out) {
    const B = buffers(ctx);
    const body = src(ctx, B.brown, { offset: 2 }), hiss = src(ctx, B.pink, { offset: 3.1 }), dr = src(ctx, B.heavy);
    chain(body, filt(ctx, 'lowpass', 1100), gain(ctx, 0.5), out);
    chain(hiss, filt(ctx, 'highpass', 350), gain(ctx, 0.38), out);
    chain(dr, filt(ctx, 'highpass', 700), gain(ctx, 0.55), out);
    // thunder: low rumbles at random, scheduled on the audio clock a little ahead
    const live = [body, hiss, dr];
    let stopped = false, timer = 0, nextAt = ctx.currentTime + 1.5 + rnd() * 4;
    const rumble = (t) => {
      const s = ctx.createBufferSource(); s.buffer = B.thunder;
      const lp = filt(ctx, 'lowpass', 140 + rnd() * 120, 0.9), crack = filt(ctx, 'lowpass', 900, 0.5);
      const g = ctx.createGain(), gc = ctx.createGain();
      const peak = 2.4 + rnd() * 1.8, dur = 4 + rnd() * 5, rise = 0.15 + rnd() * 0.6;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + rise); g.gain.exponentialRampToValueAtTime(0.0001, t + rise + dur);
      gc.gain.setValueAtTime(0.0001, t); gc.gain.exponentialRampToValueAtTime(0.2 + 0.4 * rnd(), t + 0.05); gc.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      s.connect(lp); lp.connect(g); g.connect(out); s.connect(crack); crack.connect(gc); gc.connect(out);
      s.start(t, rnd() * 2); s.stop(t + rise + dur + 0.2);
      s.onended = () => { try { s.disconnect(); g.disconnect(); gc.disconnect(); } catch {} };
    };
    const plan = () => {
      if (stopped) return;
      while (nextAt < ctx.currentTime + 20) { rumble(nextAt); nextAt += 9 + rnd() * 22; }
      if (typeof ctx.startRendering !== 'function') timer = setTimeout(plan, 5000);
    };
    plan();
    return { stop: () => { stopped = true; clearTimeout(timer); stopAll(live)(); } };
  },
  ocean(ctx, out) {
    const B = buffers(ctx);
    const a = src(ctx, B.brown), b = src(ctx, B.pink, { offset: 2.2 });
    const lp = filt(ctx, 'lowpass', 650, 0.5), amp = gain(ctx, 0.42);
    a.connect(lp); chain(b, gain(ctx, 0.5), lp); chain(lp, amp, out);
    // the swell: two slow LFOs (≈ 12 s and 19 s) on the brightness and the level
    const l1 = lfo(ctx, 0.083, 520, lp.frequency), l2 = lfo(ctx, 0.052, 260, lp.frequency);
    const l3 = lfo(ctx, 0.083, 0.3, amp.gain), l4 = lfo(ctx, 0.052, 0.12, amp.gain);
    return { stop: stopAll([a, b, l1, l2, l3, l4]) };
  },
  stream(ctx, out) {
    const B = buffers(ctx);
    const w = src(ctx, B.white, { offset: 1 }), bub = src(ctx, B.bubbles), p = src(ctx, B.pink, { offset: 4 });
    const bp = filt(ctx, 'bandpass', 1700, 0.55);
    chain(w, bp, gain(ctx, 0.2), out);
    chain(p, filt(ctx, 'bandpass', 600, 0.8), gain(ctx, 0.35), out);
    chain(bub, filt(ctx, 'lowpass', 3200), gain(ctx, 0.9), out);
    const l = lfo(ctx, 0.31, 450, bp.frequency, 'triangle');
    return { stop: stopAll([w, bub, p, l]) };
  },
  fan(ctx, out) {
    const B = buffers(ctx);
    const a = src(ctx, B.brown, { offset: 3 }), b = src(ctx, B.pink, { offset: 1.7 });
    const body = gain(ctx, 0.75);
    chain(a, filt(ctx, 'lowpass', 750), body, out);
    chain(b, filt(ctx, 'bandpass', 280, 1.1), gain(ctx, 0.22), body);
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 50; hum.start();
    chain(hum, filt(ctx, 'lowpass', 150), gain(ctx, 0.035), out);
    const blade = lfo(ctx, 8.5, 0.05, body.gain);
    return { stop: stopAll([a, b, hum, blade]) };
  },
  wind(ctx, out) {
    const B = buffers(ctx);
    const a = src(ctx, B.pink, { offset: 0.6 }), w = src(ctx, B.white, { offset: 2.5 });
    const bp = filt(ctx, 'bandpass', 520, 0.9), amp = gain(ctx, 0.62);
    chain(a, bp, amp, out);
    const whistle = filt(ctx, 'bandpass', 1900, 7), wg = gain(ctx, 0.05);
    chain(w, whistle, wg, out);
    const l1 = lfo(ctx, 0.061, 300, bp.frequency), l2 = lfo(ctx, 0.137, 140, bp.frequency);
    const l3 = lfo(ctx, 0.047, 0.32, amp.gain), l4 = lfo(ctx, 0.111, 0.12, amp.gain), l5 = lfo(ctx, 0.07, 500, whistle.frequency), l6 = lfo(ctx, 0.047, 0.04, wg.gain);
    return { stop: stopAll([a, w, l1, l2, l3, l4, l5, l6]) };
  },
  fire(ctx, out) {
    const B = buffers(ctx);
    const roar = src(ctx, B.brown, { offset: 4.4 }), cr = src(ctx, B.crackle);
    const rg = gain(ctx, 0.55);
    chain(roar, filt(ctx, 'lowpass', 380), rg, out);
    chain(cr, filt(ctx, 'highpass', 1300), gain(ctx, 0.85), out);
    const l = lfo(ctx, 0.23, 0.18, rg.gain);
    return { stop: stopAll([roar, cr, l]) };
  },
  heart(ctx, out) {
    const B = buffers(ctx);
    const beat = src(ctx, B.beat), womb = src(ctx, B.brown, { offset: 5 });
    chain(beat, filt(ctx, 'lowpass', 220), gain(ctx, 1.25), out);
    const wg = gain(ctx, 0.32);
    chain(womb, filt(ctx, 'lowpass', 300), wg, out);
    const l = lfo(ctx, 62 / 60, 0.1, wg.gain);
    return { stop: stopAll([beat, womb, l]) };
  },
  drone(ctx, out) {
    const lp = filt(ctx, 'lowpass', 850, 0.6), g = gain(ctx, 0.9);
    chain(lp, g, out);
    const oscs = [[110, 'sine', 0, 0.16], [164.81, 'sine', 3, 0.11], [220, 'triangle', -4, 0.08], [329.63, 'sine', 2, 0.05], [55, 'sine', 0, 0.12]].map(([f, type, det, v]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; o.start();
      chain(o, gain(ctx, v), lp); return o;
    });
    const l1 = lfo(ctx, 0.05, 320, lp.frequency), l2 = lfo(ctx, 0.031, 0.15, g.gain);
    return { stop: stopAll([...oscs, l1, l2]) };
  },
};
/** Build one sound into `out` on any (Offline)AudioContext — used by the engine and by tests. */
export function buildSound(ctx, id, out) { return (BUILD[id] || BUILD.pink)(ctx, out); }

// ------------------------------------------------------------------ the engine
let ctx = null, master = null, limiter = null;
const slots = new Map();   // id → { vol, g, node }
const S = { playing: false, owner: 'noise', master: 0.8, level: 1, timer: null, mix: [], inited: false };
/** Your saved mix and volume, the first time they're needed. */
function init() {
  if (S.inited) return;
  S.inited = true;
  S.mix = norm(savedMix());
  if (nData().master != null) S.master = nData().master;
}
let tickT = 0, ramp = null, stopT = 0;

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 6; limiter.attack.value = 0.01; limiter.release.value = 0.3;
    master = ctx.createGain(); master.gain.value = 0;
    master.connect(limiter); limiter.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
const targetGain = () => S.master * S.level;
function setMasterGain(v, tc = 0.35) { if (!master) return; const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(Math.max(0, v), t, tc); }
const norm = (mix) => (mix || []).map((m) => (typeof m === 'string' ? { id: m, vol: 0.7 } : { id: m.id, vol: m.vol ?? 0.7 })).filter((m) => BUILD[m.id]).slice(0, MAX);
const volCurve = (v) => Math.max(0, Math.min(1, v)) ** 1.6;   // knob position → gain (feels even)

function syncSlots() {
  for (const [id, s] of slots) {
    if (S.mix.some((m) => m.id === id)) continue;
    const g = s.g, node = s.node;
    g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    setTimeout(() => { node.stop(); try { g.disconnect(); } catch {} }, 900);
    slots.delete(id);
  }
  for (const m of S.mix) {
    let s = slots.get(m.id);
    if (!s) {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(master);
      s = { g, node: buildSound(ctx, m.id, g) };
      slots.set(m.id, s);
    }
    s.g.gain.setTargetAtTime(volCurve(m.vol), ctx.currentTime, 0.15);
  }
}
const persistMix = () => { if (S.owner === 'noise') saveN({ mix: S.mix, master: S.master }); };
const emit = () => events.emit('change', state());

/** Play a mix: ['rain', 'fire'] or [{ id, vol }]. `source` 'focus' doesn't touch your saved mix. */
export function play(mix = savedMix(), { source = 'noise', master: mv } = {}) {
  init();
  ensureCtx();
  clearTimeout(stopT);
  S.owner = source;
  S.mix = norm(mix);
  if (mv != null) S.master = mv; else if (source === 'noise' && nData().master != null) S.master = nData().master;
  S.level = 1;
  syncSlots();
  setMasterGain(targetGain(), 0.6);
  if (!S.playing) { S.playing = true; clearInterval(tickT); tickT = setInterval(tick, 500); }
  persistMix(); emit();
}
/** Stop with a fade (seconds). */
export function stop({ fade = 1.2 } = {}) {
  if (!S.playing) return;
  S.playing = false;
  clearInterval(tickT);
  if (S.owner !== 'noise') { S.owner = 'noise'; S.mix = norm(savedMix()); S.master = nData().master ?? S.master; }
  S.timer = null;
  ramp?.cancel?.(); ramp = null;
  setMasterGain(0, Math.max(0.05, fade / 4));
  const ids = [...slots.keys()];
  clearTimeout(stopT);
  stopT = setTimeout(() => { for (const id of ids) { const s = slots.get(id); if (s && !S.playing) { s.node.stop(); try { s.g.disconnect(); } catch {} slots.delete(id); } } if (!S.playing) ctx?.suspend?.().catch(() => {}); }, fade * 1000 + 300);
  emit();
}
export const isPlaying = () => S.playing;
export const owner = () => (S.playing ? S.owner : null);
export function setMix(mix) { init(); S.mix = norm(mix); if (S.playing) syncSlots(); persistMix(); emit(); }
export function setVolume(id, vol) {
  init();
  const m = S.mix.find((x) => x.id === id);
  if (m) m.vol = Math.max(0, Math.min(1, vol));
  if (S.playing) { const s = slots.get(id); s?.g.gain.setTargetAtTime(volCurve(m?.vol ?? 0), ctx.currentTime, 0.08); }
  persistMix(); emit();
}
export function setMaster(v) { init(); S.master = Math.max(0, Math.min(1, v)); if (S.playing) setMasterGain(targetGain(), 0.08); persistMix(); emit(); }
export const mix = () => { init(); return S.mix.length ? S.mix : norm(savedMix()); };

// ------------------------------------------------------------------ sleep timer
/** When "until morning" ends (ms). */
export function morningAt(now = Date.now()) {
  const [h, m] = String(nData().morning || '07:00').split(':').map(Number);
  const d = new Date(now); d.setHours(h || 0, m || 0, 0, 0);
  if (d.getTime() <= now + 60000) d.setDate(d.getDate() + 1);
  return d.getTime();
}
const fadeFor = (ms) => Math.min(5 * 60000, Math.max(30000, ms / 8));
/** minutes (15…), 'morning' or 0 (off). */
export function setTimer(t) {
  saveN({ timer: t });
  if (!t) { S.timer = null; S.level = 1; if (S.playing) setMasterGain(targetGain()); emit(); return; }
  const now = Date.now();
  const endAt = t === 'morning' ? morningAt(now) : now + t * 60000;
  S.timer = { kind: t, endAt, fade: fadeFor(endAt - now), start: now };
  emit();
}
export function timerLeft(now = Date.now()) { return S.timer ? Math.max(0, S.timer.endAt - now) : null; }
function tick() {
  if (!S.playing) return;
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  if (!S.timer) return;
  const left = S.timer.endAt - Date.now();
  if (left <= 0) { timerDone(); return; }
  const lv = left < S.timer.fade ? Math.max(0, left / S.timer.fade) ** 1.3 : 1;
  if (Math.abs(lv - S.level) > 0.002) { S.level = lv; setMasterGain(targetGain(), 0.4); events.emit('change', state()); }
}
function timerDone() {
  S.level = 0;
  stop({ fade: 2 });
  if (nData().pauseMusic) { try { if (player.state?.isPlaying) player.pause(); } catch {} }
  events.emit('done');
}
/** Dim the chosen Home Assistant lights to off over `minutes`. */
export function dimLights() {
  const d = nData().dim || {};
  if (!d.ids?.length) return null;
  ramp?.cancel?.();
  ramp = rampLights(d.ids, { minutes: d.minutes || 10 });
  emit();
  return ramp;
}
export const dimming = () => (ramp && !ramp.state.cancelled && ramp.state.step < ramp.state.steps ? ramp : null);
export function cancelDim() { ramp?.cancel?.(); ramp = null; emit(); }

/** A snapshot for the UI and for tests. */
export function state() {
  init();
  return {
    playing: S.playing, owner: S.owner, master: S.master, level: S.level, mix: mix().map((m) => ({ ...m })),
    timer: S.timer ? { ...S.timer, left: timerLeft() } : null, gain: master ? master.gain.value : 0, ctx: ctx?.state || 'none',
    nodes: [...slots.keys()],
  };
}

/** Render a mix offline (tests): resolves to the RMS level per second. */
export async function renderOffline(ids, secs = 3, sr = 22050) {
  const oc = new OfflineAudioContext(2, Math.floor(secs * sr), sr);
  const g = oc.createGain(); g.connect(oc.destination);
  for (const id of ids) buildSound(oc, id, g);
  const buf = await oc.startRendering();
  const d = buf.getChannelData(0), out = [];
  for (let s = 0; s < secs; s++) { let sum = 0, n = 0; for (let i = s * sr; i < Math.min(d.length, (s + 1) * sr); i++) { sum += d[i] * d[i]; n++; } out.push(Math.sqrt(sum / Math.max(1, n))); }
  return out;
}
