// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Sound features for the Tone Visual view.
//
// Round Remote is a *remote*: the music plays on your speaker / TV / phone, so the
// browser never receives the audio stream. Two sources are offered:
//   • 'sim' (default) – a simulated analysis that follows playback: a steady beat
//     (tempo picked per song), kick / snare / hi-hat, a bass line, moving melody
//     peaks and louder / quieter sections. It's driven by the play position, so it
//     pauses, seeks and changes with the song, but it doesn't "hear" the music.
//   • 'mic' – the real thing: listens to the room through a microphone (e.g. a USB
//     mic on the Pi) and analyses it live with the Web Audio API.
// Both produce the same features every frame:
//   spectrum  Float32Array(64)  0..1, log-spaced 30 Hz → 16 kHz
//   wave      Float32Array(512) -1..1 waveform
//   level, bass, mid, treble    0..1 (smoothed)
//   beat      true on the frame a beat (kick) lands
//   pulse     0..1, jumps to 1 on a beat and decays
//   note      0..11 dominant pitch class
//   centroid  0..1 brightness of the sound
//   energy    0..1 slow loudness (verse ↔ chorus)
import { store } from './store.js';
import { clamp } from './util.js';

export const BANDS = 64;
export const WAVE = 512;

const fract = (x) => x - Math.floor(x);
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return fract(s); }
function vnoise(x, seed = 0) { // smooth 1D value noise, 0..1
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(i + seed * 57.3) * (1 - u) + hash(i + 1 + seed * 57.3) * u;
}
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

function makeFeatures() {
  return {
    spectrum: new Float32Array(BANDS), wave: new Float32Array(WAVE),
    level: 0, bass: 0, mid: 0, treble: 0, beat: false, pulse: 0, note: 0, centroid: 0.3, energy: 0,
    source: 'sim', live: false,
  };
}

// ------------------------------------------------------------------ simulated
class SimSource {
  constructor() { this.key = null; this.lastBeat = -1; this.gain = 0; }
  setTrack(key) {
    if (key === this.key) return;
    this.key = key;
    const s = strHash(key || 'none');
    this.seed = s * 1000;
    this.bpm = 84 + Math.round(s * 44);                // 84–128 bpm
    this.four = hash(this.seed + 3) > 0.35;              // four-on-the-floor or 1 & 3 kicks
    this.swing = hash(this.seed + 9) * 0.12;
    this.lastBeat = -1;
  }
  fill(F, posMs, playing, durMs, dt) {
    // fade in / out with play state so pausing brings everything to rest
    this.gain += ((playing ? 1 : 0) - this.gain) * Math.min(1, dt / (playing ? 250 : 450));
    const g = this.gain;
    const beatMs = 60000 / this.bpm;
    const b = Math.max(0, posMs) / beatMs;
    const beatI = Math.floor(b), ph = b - beatI;
    const bar = Math.floor(b / 4), inBar = beatI % 4;
    const section = Math.floor(b / 32);
    // slow energy: intro ramp, sections, outro fade
    let energy = 0.45 + 0.45 * vnoise(section * 0.9, this.seed) + 0.1 * Math.sin(b / 16);
    energy *= clamp(posMs / 8000, 0.25, 1);
    if (durMs > 0) energy *= clamp((durMs - posMs) / 9000, 0.1, 1);
    energy = clamp(energy, 0, 1);
    const kickOn = this.four || inBar === 0 || inBar === 2 || (inBar === 3 && ph > 0.5 && hash(bar + this.seed) > 0.6);
    const kPh = inBar === 3 && !this.four && ph > 0.5 ? ph - 0.5 : ph;
    const kick = kickOn ? Math.exp(-kPh * 7) : 0;
    const snare = inBar % 2 === 1 ? Math.exp(-ph * 9) : 0;
    const h8 = fract(b * 2 + this.swing);
    const hat = Math.exp(-h8 * 16) * (0.35 + 0.65 * vnoise(b * 0.5, this.seed + 4));
    const note = Math.floor(hash(bar * 1.7 + this.seed) * 12);
    const bassBand = 3 + (note % 7) * 0.6;
    const t = posMs / 1000;
    const S = F.spectrum;
    for (let i = 0; i < BANDS; i++) {
      const x = i / (BANDS - 1);
      let v = 0.55 * (1 - x) ** 1.3 * (0.6 + 0.4 * vnoise(t * 0.7 + i * 0.35, this.seed + 1)); // body / pads
      v += kick * 0.9 * Math.exp(-(((i - 2) / 3.2) ** 2));                                          // kick
      v += 0.45 * (0.6 + 0.4 * kick) * Math.exp(-(((i - bassBand) / 1.6) ** 2));                   // bass note
      v += snare * 0.5 * Math.exp(-(((i - 26) / 9) ** 2));                                          // snare
      v += hat * 0.42 * Math.exp(-(((i - 52) / 8) ** 2));                                           // hats
      for (let m = 0; m < 3; m++) {                                                                 // melody peaks
        const c = 16 + 22 * hash(beatI * 3.1 + m * 7.7 + this.seed);
        v += 0.28 * (1 - ph * 0.6) * Math.exp(-(((i - c) / 1.3) ** 2)) * (m === 0 ? 1 : 0.6);
      }
      v *= (0.45 + 0.75 * energy) * (0.93 + 0.14 * Math.random());
      S[i] = clamp(v * g, 0, 1);
    }
    // waveform: bass + melody partials + a little noise on the hats
    const W = F.wave;
    const fb = 2 + (note % 4), fm = 7 + (hash(beatI + this.seed) * 9) | 0, fm2 = fm * 1.5;
    const amp = (0.35 + 0.55 * energy) * g;
    const off = t * 0.9;
    for (let i = 0; i < WAVE; i++) {
      const p = (i / WAVE) * Math.PI * 2;
      W[i] = amp * ((0.55 + 0.4 * kick) * Math.sin(p * fb + off) + 0.25 * Math.sin(p * fm + off * 3) + 0.12 * Math.sin(p * fm2 + off * 2.2)
        + (Math.random() - 0.5) * 0.18 * hat);
    }
    const beat = playing && beatI !== this.lastBeat && kickOn && ph < 0.25;
    if (beatI !== this.lastBeat && ph < 0.25) this.lastBeat = beatI;
    return { beat: beat && g > 0.3, note, energy: energy * g };
  }
}

// ------------------------------------------------------------------ microphone
class MicSource {
  constructor() { this.state = 'idle'; this.error = ''; this.peak = 0.2; this.bassAvg = 0; this.lastBeatT = 0; }
  async start() {
    if (this.state === 'on' || this.state === 'starting') return;
    this.state = 'starting';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use a microphone here');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      this.an = this.ctx.createAnalyser();
      this.an.fftSize = 2048;
      this.an.smoothingTimeConstant = 0.55;
      this.ctx.createMediaStreamSource(this.stream).connect(this.an);
      this.freq = new Float32Array(this.an.frequencyBinCount);
      this.time = new Float32Array(this.an.fftSize);
      // map 64 log bands onto FFT bins
      const ny = this.ctx.sampleRate / 2, n = this.an.frequencyBinCount;
      this.edges = Array.from({ length: BANDS + 1 }, (_, i) => clamp(Math.round((30 * (16000 / 30) ** (i / BANDS)) / ny * n), 1, n - 1));
      this.state = 'on'; this.error = '';
    } catch (e) {
      this.state = 'error';
      this.error = e?.name === 'NotAllowedError' ? 'Microphone access was blocked' : e?.name === 'NotFoundError' ? 'No microphone found' : (e?.message || 'Microphone unavailable');
      this.stop(true);
    }
  }
  stop(keepState) {
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { this.ctx?.close(); } catch {}
    this.stream = null; this.ctx = null; this.an = null;
    if (!keepState) this.state = 'idle';
  }
  fill(F, dt) {
    if (this.state !== 'on') return null;
    this.an.getFloatFrequencyData(this.freq);
    this.an.getFloatTimeDomainData(this.time);
    const S = F.spectrum;
    let max = 0, bestBin = 0, bestV = -Infinity;
    for (let i = 0; i < BANDS; i++) {
      let s = 0; const a = this.edges[i], b = Math.max(a + 1, this.edges[i + 1]);
      for (let k = a; k < b; k++) s += this.freq[k];
      const db = s / (b - a);                      // ~ -100 … -20 dB
      const v = clamp((db + 95) / 65, 0, 1) * (0.8 + 0.5 * (i / BANDS)); // gentle treble lift
      S[i] = v; if (v > max) max = v;
    }
    // auto-gain so quiet rooms still move
    this.peak = Math.max(max, this.peak * (1 - dt / 6000), 0.15);
    for (let i = 0; i < BANDS; i++) S[i] = clamp(S[i] / this.peak, 0, 1) ** 1.4;
    // dominant pitch (80–1000 Hz)
    const ny = this.ctx.sampleRate / 2, n = this.freq.length;
    const lo = Math.round((80 / ny) * n), hi = Math.round((1000 / ny) * n);
    for (let k = lo; k < hi; k++) if (this.freq[k] > bestV) { bestV = this.freq[k]; bestBin = k; }
    const hz = (bestBin / n) * ny;
    const note = ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12 + 9) % 12;
    // waveform (resample to WAVE, normalised)
    let rms = 0;
    for (let i = 0; i < this.time.length; i++) rms += this.time[i] ** 2;
    rms = Math.sqrt(rms / this.time.length);
    const norm = 1 / Math.max(0.02, rms * 3.2);
    for (let i = 0; i < WAVE; i++) F.wave[i] = clamp(this.time[Math.floor((i / WAVE) * this.time.length)] * norm, -1, 1);
    // beat: bass flux against its running average
    let bass = 0; for (let i = 0; i < 8; i++) bass += S[i]; bass /= 8;
    const t = performance.now();
    const beat = bass > this.bassAvg * 1.35 + 0.06 && t - this.lastBeatT > 260;
    if (beat) this.lastBeatT = t;
    this.bassAvg += (bass - this.bassAvg) * Math.min(1, dt / 400);
    return { beat, note, energy: clamp(rms * 6, 0, 1) };
  }
}

// ------------------------------------------------------------------ engine
class Sound {
  constructor() { this.F = makeFeatures(); this.sim = new SimSource(); this.mic = new MicSource(); this.last = 0; this.energy = 0; }
  get source() { return store.get('toneSource') === 'mic' ? 'mic' : 'sim'; }
  get micState() { return this.mic.state; }
  get micError() { return this.mic.error; }
  async useMic(on) {
    store.set('toneSource', on ? 'mic' : 'sim');
    if (on) await this.mic.start(); else this.mic.stop();
  }
  ensure() { if (this.source === 'mic' && this.mic.state === 'idle') this.mic.start(); }
  release() { this.mic.stop(); }
  /** Call once per animation frame. */
  frame(posMs, playing, durMs, trackKey) {
    const now = performance.now();
    const dt = clamp(this.last ? now - this.last : 16, 1, 100);
    this.last = now;
    const F = this.F;
    let r = null;
    if (this.source === 'mic') { this.ensure(); r = this.mic.fill(F, dt); }
    F.live = !!r;
    if (!r) { this.sim.setTrack(trackKey); r = this.sim.fill(F, posMs, playing, durMs, dt); }
    F.source = F.live ? 'mic' : 'sim';
    const S = F.spectrum;
    let b = 0, m = 0, t = 0, wsum = 0, csum = 0;
    for (let i = 0; i < BANDS; i++) {
      const v = S[i];
      if (i < 8) b += v; else if (i < 36) m += v; else t += v;
      wsum += v; csum += v * (i / BANDS);
    }
    const k = Math.min(1, dt / 90);
    F.bass += (b / 8 - F.bass) * k;
    F.mid += (m / 28 - F.mid) * k;
    F.treble += (t / 28 - F.treble) * k;
    F.level += ((wsum / BANDS) * 1.6 - F.level) * k;
    F.centroid += ((wsum > 0.01 ? csum / wsum : F.centroid) - F.centroid) * Math.min(1, dt / 500);
    this.energy += ((r.energy ?? F.level) - this.energy) * Math.min(1, dt / 1500);
    F.energy = this.energy;
    F.beat = !!r.beat;
    F.pulse = F.beat ? 1 : F.pulse * Math.exp(-dt / 180);
    F.note = r.note ?? F.note;
    F.dt = dt;
    return F;
  }
}

let singleton = null;
export const sound = () => (singleton ||= new Sound());
