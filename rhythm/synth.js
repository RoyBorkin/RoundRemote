// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Demo songs, audible: procedural instruments (Web Audio) playing the arrangements from rhythm/dsp-songs.js.
//   DEMO_SONGS                      per Demo track id: { id, title, bpm, key, style, firstBeatMs, durMs, sections }
//   demoTruth(id)                   ground truth for tests: { bpm, beats (ms), downbeats, sections }
//   renderDemo(id, { sampleRate, onProgress }) → Float32Array mono (OfflineAudioContext, much faster than real time)
//   DemoPlayer                      live playback in this browser, kept in sync with the (simulated) Demo player:
//                                   sync(trackId, positionMs, playing) every frame, stop(), setVolume(0..1)
import { getSong, songInfo, DEMO_IDS } from './dsp-songs.js';

export const DEMO_SONGS = Object.fromEntries(DEMO_IDS.map((id) => [id, songInfo(id)]));

export function demoTruth(trackId) {
  const s = getSong(trackId);
  if (!s) return null;
  return { bpm: s.bpm, beats: s.beats.slice(), downbeats: s.downbeats.slice(), firstBeatMs: s.t0 * 1000, durMs: s.durMs,
    sections: s.sections.map((x) => ({ type: x.type, t: x.tMs, bars: x.bars })) };
}

const LEVEL = 0.62;                                          // master level (peaks ≈ −4 dBFS)
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// ------------------------------------------------------------------ graph
function impulse(ctx, sec, decay) {
  const n = Math.round(ctx.sampleRate * sec), ch = ctx.destination.channelCount >= 2 && ctx.sampleRate > 30000 ? 2 : 1;
  const buf = ctx.createBuffer(ch, n, ctx.sampleRate);
  let s = 12345;
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      const w = (s / 2147483647) * 2 - 1;
      lp += (w - lp) * 0.35;                               // a little darker
      d[i] = lp * Math.exp((-i / n) * decay) * (i < 40 ? i / 40 : 1);
    }
  }
  return buf;
}
function noiseBuffer(ctx) {
  const n = ctx.sampleRate, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let s = 987654;
  for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  return buf;
}

const CHANNELS = {
  // level, reverb send, delay send
  kick: [1, 0, 0], snare: [0.4, 0.18, 0], clap: [0.36, 0.2, 0], rim: [0.26, 0.12, 0], hat: [0.11, 0.04, 0],
  ohat: [0.085, 0.06, 0], shaker: [0.09, 0.06, 0], crash: [0.12, 0.2, 0], riser: [0.07, 0.3, 0],
  bass: [0.34, 0, 0], pad: [0.07, 0.45, 0], lead: [0.15, 0.25, 0.22], arp: [0.055, 0.3, 0.2], keys: [0.085, 0.22, 0],
};
// shared per-channel filters (one node per song instead of one per note)
const PRE = { hat: ['highpass', 7200, 0.7], ohat: ['highpass', 7200, 0.7], shaker: ['bandpass', 6200, 0.9], snareN: ['highpass', 1200, 0.7, 'snare'],
  clap: ['bandpass', 1150, 1.1], crash: ['highpass', 4500, 0.7] };

function makeGraph(ctx, dest) {
  const G = { ctx };
  G.master = ctx.createGain(); G.master.gain.value = 1;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
  G.bus = ctx.createGain(); G.bus.gain.value = 1;           // ducked on seeks
  G.bus.connect(comp); comp.connect(G.master); G.master.connect(dest);
  const rev = ctx.createConvolver(); rev.normalize = true; rev.buffer = impulse(ctx, 1.3, 5.5);
  G.revIn = ctx.createGain(); const revOut = ctx.createGain(); revOut.gain.value = 0.5;
  G.revIn.connect(rev); rev.connect(revOut); revOut.connect(G.bus);
  G.delay = ctx.createDelay(2); G.delay.delayTime.value = 0.375;
  const fb = ctx.createGain(); fb.gain.value = 0.32;
  const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2600;
  G.delIn = ctx.createGain();
  G.delIn.connect(G.delay); G.delay.connect(dl); dl.connect(fb); fb.connect(G.delay);
  const delOut = ctx.createGain(); delOut.gain.value = 0.6; dl.connect(delOut); delOut.connect(G.bus);
  G.ch = {}; G.in = {};
  for (const [name, [lv, rs, ds]] of Object.entries(CHANNELS)) {
    const g = ctx.createGain(); g.gain.value = lv; g.connect(G.bus);
    if (rs) { const s = ctx.createGain(); s.gain.value = rs; g.connect(s); s.connect(G.revIn); }
    if (ds) { const s = ctx.createGain(); s.gain.value = ds; g.connect(s); s.connect(G.delIn); G.ch[name + 'Del'] = s; }
    G.ch[name] = g; G.in[name] = g;
  }
  for (const [name, [type, f, q, target]] of Object.entries(PRE)) {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
    b.connect(G.ch[target || name]); G.in[name] = b;
  }
  G.noise = noiseBuffer(ctx);
  return G;
}

function setSong(G, song) {
  G.song = song; G.style = song.styleDef;
  const dl = (song.styleDef.delay || 0.75) * song.beatSec;
  G.delay.delayTime.value = Math.min(1.9, dl);
  for (const k of ['leadDel', 'arpDel']) if (G.ch[k]) G.ch[k].gain.value = song.styleDef.delay ? (k === 'leadDel' ? 0.22 : 0.2) : 0;
}

// ------------------------------------------------------------------ instruments
// Every note records its nodes (N.nodes), its sources (N.src) and when it is silent (N.end), so the renderer and
// the player can disconnect finished notes (an idle node still costs CPU in every render quantum).
function env(g, t, a, peak, d, sus, end, rel) {
  const p = g.gain;
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(sus, t + a, d);
  p.setValueAtTime(sus, Math.max(t + a + 0.001, end));
  p.setTargetAtTime(0.0001, Math.max(t + a + 0.002, end), rel);
}
function perc(g, t, v, len, atk = 0.002) {
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + atk); g.gain.exponentialRampToValueAtTime(0.001, t + len);
}
const mk = {
  osc(N, type, f, t, stop) { const o = N.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); o.stop(stop); N.src.push(o); N.nodes.push(o); N.end = Math.max(N.end, stop); return o; },
  noise(N, G, t, dur) { const s = N.ctx.createBufferSource(); s.buffer = G.noise; s.loop = true; s.start(t, (N.k * 0.137) % 0.9); s.stop(t + dur); N.src.push(s); N.nodes.push(s); N.end = Math.max(N.end, t + dur); return s; },
  gain(N, v = 1) { const g = N.ctx.createGain(); g.gain.value = v; N.nodes.push(g); return g; },
  bq(N, type, f, q = 0.7) { const b = N.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; N.nodes.push(b); return b; },
};

const INST = {
  kick(G, N, t, e) {
    const o = mk.osc(N, 'sine', 155, t, t + 0.45), g = mk.gain(N);
    o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    perc(g, t, e.v, 0.42);
    o.connect(g); g.connect(G.in.kick);
  },
  snare(G, N, t, e) {
    const n = mk.noise(N, G, t, 0.22), g = mk.gain(N);
    perc(g, t, e.v, 0.2);
    n.connect(g); g.connect(G.in.snareN);
    const o = mk.osc(N, 'triangle', 190, t, t + 0.1), g2 = mk.gain(N);
    o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    perc(g2, t, e.v * 0.8, 0.09);
    o.connect(g2); g2.connect(G.in.snare);
  },
  clap(G, N, t, e) {
    const n = mk.noise(N, G, t, 0.3), g = mk.gain(N), p = g.gain;
    p.setValueAtTime(0.0001, t);
    for (const k of [0, 0.011, 0.022]) { p.setValueAtTime(e.v, t + k); p.exponentialRampToValueAtTime(e.v * 0.25, t + k + 0.009); }
    p.setValueAtTime(e.v * 0.7, t + 0.032); p.exponentialRampToValueAtTime(0.001, t + 0.25);
    n.connect(g); g.connect(G.in.clap);
  },
  rim(G, N, t, e) {
    const o = mk.osc(N, 'triangle', 1650, t, t + 0.05), g = mk.gain(N);
    perc(g, t, e.v, 0.045, 0.001);
    o.connect(g); g.connect(G.in.rim);
  },
  hat(G, N, t, e) {
    const n = mk.noise(N, G, t, 0.08), g = mk.gain(N);
    perc(g, t, e.v, 0.06, 0.001); n.connect(g); g.connect(G.in.hat);
  },
  ohat(G, N, t, e) {
    const n = mk.noise(N, G, t, 0.32), g = mk.gain(N);
    perc(g, t, e.v, 0.3, 0.001); n.connect(g); g.connect(G.in.ohat);
  },
  shaker(G, N, t, e) {
    const n = mk.noise(N, G, t, 0.1), g = mk.gain(N);
    perc(g, t, e.v, 0.085, 0.008); n.connect(g); g.connect(G.in.shaker);
  },
  crash(G, N, t, e) {
    const len = Math.max(1.2, e.d), n = mk.noise(N, G, t, len + 0.05), g = mk.gain(N);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(e.v, t + 0.003); g.gain.setTargetAtTime(0.0001, t + 0.01, len / 4.5);
    n.connect(g); g.connect(G.in.crash);
  },
  riser(G, N, t, e) {
    const n = mk.noise(N, G, t, e.d), bp = mk.bq(N, 'bandpass', 400, 2.2), g = mk.gain(N);
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(Math.min(N.ctx.sampleRate * 0.4, 7000), t + e.d);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(e.v, t + e.d * 0.95); g.gain.linearRampToValueAtTime(0.0001, t + e.d);
    n.connect(bp); bp.connect(g); g.connect(G.in.riser);
  },
  bass(G, N, t, e, off) {
    const f = mtof(e.m), wave = G.style?.bassWave || 'sawtooth', d = Math.max(0.05, e.d - off), end = t + d + 0.25;
    const o = mk.osc(N, wave, f, t, end), sub = mk.osc(N, 'sine', f, t, end);
    const lp = mk.bq(N, 'lowpass', 300, 1.2);
    if (wave !== 'sine') { lp.frequency.setValueAtTime(1100, t); lp.frequency.setTargetAtTime(320, t + 0.01, 0.08); }
    else lp.frequency.value = 900;
    const g = mk.gain(N), gs = mk.gain(N, 0.6);
    env(g, t, 0.012, e.v, 0.18, e.v * 0.75, t + d, 0.04);
    o.connect(lp); lp.connect(g); sub.connect(gs); gs.connect(g); g.connect(G.in.bass);
  },
  pad(G, N, t, e, off) {
    const type = G.style?.pad === 'tri' ? 'triangle' : 'sawtooth';
    const lp = mk.bq(N, 'lowpass', type === 'sawtooth' ? 1500 : 2400, 0.5), g = mk.gain(N);
    const d = Math.max(0.1, e.d - off);
    env(g, t, off > 0 ? 0.05 : 0.35, e.v, 1, e.v * 0.85, t + d, 0.35);
    lp.connect(g); g.connect(G.in.pad);
    const end = t + d + 1.6;
    for (const m of e.m) {
      if (type === 'sawtooth') for (const det of [-7, 7]) { const o = mk.osc(N, type, mtof(m), t, end); o.detune.value = det; o.connect(lp); }
      else { const o = mk.osc(N, type, mtof(m), t, end); o.connect(lp); const o2 = mk.osc(N, 'sine', mtof(m) * 2, t, end), q = mk.gain(N, 0.25); o2.connect(q); q.connect(lp); }
    }
  },
  lead(G, N, t, e, off) {
    const kind = G.style?.lead || 'square', f = mtof(e.m);
    const type = { saw: 'sawtooth', square: 'square', tri: 'triangle', sine: 'sine', flute: 'sine' }[kind];
    const lp = mk.bq(N, 'lowpass', kind === 'saw' ? 2600 : kind === 'square' ? 2400 : 5000, 0.8), g = mk.gain(N);
    const d = Math.max(0.05, e.d - off), end = t + d + 0.4;
    const peak = e.v * (type === 'sine' ? 1.5 : type === 'triangle' ? 1.25 : 1);
    env(g, t, off ? 0.02 : kind === 'flute' ? 0.04 : 0.012, peak, 0.25, peak * 0.72, t + d, 0.07);
    lp.connect(g); g.connect(G.in.lead);
    const o = mk.osc(N, type, f, t, end); o.connect(lp);
    let o2;
    if (type === 'sawtooth' || type === 'square') { o2 = mk.osc(N, type, f, t, end); o2.detune.value = 9; o2.connect(lp); }
    else { o2 = mk.osc(N, 'sine', f * (kind === 'sine' ? 3 : 2), t, end); const q = mk.gain(N, kind === 'sine' ? 0.12 : 0.2); o2.connect(q); q.connect(lp); }
    if (e.d > 0.4) { // gentle vibrato on long notes
      const lfo = mk.osc(N, 'sine', 5.2, t, end), lg = mk.gain(N, 0);
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(12, t + Math.min(0.6, d));
      lfo.connect(lg); lg.connect(o.detune); lg.connect(o2.detune);
    }
  },
  arp(G, N, t, e) {
    const o = mk.osc(N, G.song && (G.song.style === 'folk' || G.song.style === 'dream') ? 'triangle' : 'square', mtof(e.m), t, t + 0.5);
    const lp = mk.bq(N, 'lowpass', 3200, 1), g = mk.gain(N);
    lp.frequency.setValueAtTime(4200, t); lp.frequency.setTargetAtTime(1200, t + 0.003, 0.08);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(e.v, t + 0.003); g.gain.setTargetAtTime(0.0001, t + 0.01, 0.07);
    o.connect(lp); lp.connect(g); g.connect(G.in.arp);
  },
  keys(G, N, t, e) {
    const g = mk.gain(N), lp = mk.bq(N, 'lowpass', 3000, 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(e.v, t + 0.004); g.gain.setTargetAtTime(e.v * 0.3, t + 0.006, 0.12);
    g.gain.setTargetAtTime(0.0001, t + e.d, 0.08);
    lp.connect(g); g.connect(G.in.keys);
    for (const m of e.m) {
      const o = mk.osc(N, 'triangle', mtof(m), t, t + e.d + 0.6); o.connect(lp);
      const o2 = mk.osc(N, 'sine', mtof(m) * 2, t, t + e.d + 0.6), q = mk.gain(N, 0.3); o2.connect(q); q.connect(lp);
    }
  },
};

let noteCounter = 0;
/** Schedules one event at context time `when` (`off` s into the note when resuming mid-note) → note record. */
function play(G, e, when, off = 0) {
  const f = INST[e.i];
  const N = { ctx: G.ctx, nodes: [], src: [], end: when, k: noteCounter++ };
  if (!f) return N;
  try { f(G, N, when, e, off); } catch { /* a bad parameter must not stop the song */ }
  return N;
}
function release(N) { for (const n of N.nodes) { try { n.disconnect(); } catch {} } N.nodes.length = 0; }

// ------------------------------------------------------------------ offline render
/** Renders a Demo song to mono PCM (Float32Array) with an OfflineAudioContext. */
export async function renderDemo(trackId, { sampleRate = 22050, onProgress } = {}) {
  const song = getSong(trackId);
  if (!song) throw new Error(`Unknown demo track ${trackId}`);
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) throw new Error('OfflineAudioContext not available');
  const dur = song.durMs / 1000;
  const len = Math.ceil(dur * sampleRate);
  const ctx = new OAC(1, len, sampleRate);
  const G = makeGraph(ctx, ctx.destination);
  setSong(G, song);
  G.master.gain.value = LEVEL;
  const ev = song.events;
  let idx = 0, live = [];
  // nodes exist only around their own time: created ≤ 0.75 s ahead, disconnected once silent
  const schedule = (until) => { while (idx < ev.length && ev[idx].t < until) { live.push(play(G, ev[idx], ev[idx].t)); idx++; } };
  const CH = 0.5, ahead = 0.75;
  schedule(ahead);
  for (let k = 1; k * CH < dur; k++) {
    const at = k * CH;
    ctx.suspend(at).then(() => {
      const now = ctx.currentTime;
      live = live.filter((N) => { if (N.end + 0.05 < now) { release(N); return false; } return true; });
      schedule(at + ahead);
      if (k % 4 === 0) onProgress?.(Math.min(0.99, at / dur));
      ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  onProgress?.(1);
  return buf.getChannelData(0);
}

// ------------------------------------------------------------------ live player
export class DemoPlayer {
  constructor() {
    this.ctx = null; this.G = null; this.vol = 0.8;
    this.trackId = null; this.playing = false; this.anchor = null;
    this.idx = 0; this.notes = [];
    this.timer = 0;
    if (typeof window !== 'undefined') {
      const h = () => {
        window.removeEventListener('pointerdown', h, true); window.removeEventListener('keydown', h, true);
        this._gesture = true;
        if (this.ctx && this.ctx.state === 'suspended' && this.playing) this.ctx.resume().catch(() => {});
      };
      window.addEventListener('pointerdown', h, true); window.addEventListener('keydown', h, true);
    }
  }
  _ensure() {
    if (this.ctx) return true;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    try { this.ctx = new AC(); } catch { return false; }
    this.G = makeGraph(this.ctx, this.ctx.destination);
    this.G.master.gain.value = this.vol * LEVEL;
    this.ctx.onstatechange = () => { this.anchor = null; };
    return true;
  }
  _heardNow() {
    const ctx = this.ctx;
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }
  /** Call every frame with the Demo provider's state. */
  sync(trackId, positionMs, playing) {
    const id = String(trackId || '').replace(/^demo:/, '');
    const song = getSong(id);
    if (!song || !playing) { if (this.playing) this._halt(); this.playing = false; this.trackId = id; return; }
    if (!this._ensure()) return;
    if (this.ctx.state === 'suspended') {
      this.playing = true; this.trackId = id; this.anchor = null;
      if (this._gesture || (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive)) this.ctx.resume().catch(() => {});
      return;
    }
    if (this.ctx.state !== 'running') return;
    if (this.ctx.currentTime < 0.08) { this.playing = true; this.trackId = id; this.anchor = null; return; } // output clock not settled yet
    const heard = this._heardNow();
    let restart = id !== this.trackId || !this.playing || !this.anchor;
    if (!restart) {
      const expected = this.anchor.song + (heard - this.anchor.ctx) * 1000;
      if (Math.abs(positionMs - expected) > 60) restart = true;
    }
    if (restart) this._start(song, positionMs, heard);
    this.playing = true; this.trackId = id;
    this._pump();
  }
  _start(song, posMs, heard) {
    const ctx = this.ctx, G = this.G;
    const now = ctx.currentTime;
    // duck, cut what was scheduled, come back
    G.bus.gain.cancelScheduledValues(now);
    G.bus.gain.setValueAtTime(G.bus.gain.value, now);
    G.bus.gain.linearRampToValueAtTime(0, now + 0.02);
    this._cut(now + 0.022);
    G.bus.gain.setValueAtTime(0, now + 0.025);
    G.bus.gain.linearRampToValueAtTime(1, now + 0.035);
    if (G.song !== song) setSong(G, song);
    this.song = song;
    this.anchor = { ctx: heard, song: posMs };
    // first event at/after the position; sustained notes already sounding are restarted with their remainder
    const ev = song.events, s = posMs / 1000;
    let lo = 0, hi = ev.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t < s) lo = m + 1; else hi = m; }
    this.idx = lo;
    const startAt = Math.max(now + 0.04, this._when(s));
    for (let k = lo - 1; k >= 0 && ev[k].t > s - 8; k--) {
      const e = ev[k];
      if ((e.i === 'pad' || e.i === 'lead' || e.i === 'bass') && e.t + e.d > s + 0.15) {
        const off = s - e.t;
        this._keep(play(this.G, e, startAt, off));
      }
    }
    if (!this.timer) this.timer = setInterval(() => this._pump(), 40);
  }
  _when(songSec) { return this.anchor.ctx + (songSec * 1000 - this.anchor.song) / 1000; }
  _keep(N) { this.notes.push(N); }
  _cut(at) {
    for (const N of this.notes) { for (const s of N.src) { try { s.stop(at); } catch {} } N.end = Math.min(N.end, at + 0.01); }
  }
  _clean() {
    const now = this.ctx.currentTime;
    if (this.notes.length && this.notes.some((N) => N.end + 0.1 < now)) this.notes = this.notes.filter((N) => { if (N.end + 0.1 < now) { release(N); return false; } return true; });
  }
  _pump() {
    if (this.ctx) this._clean();
    if (!this.playing || !this.anchor || !this.ctx || this.ctx.state !== 'running') return;
    const ev = this.song.events, now = this.ctx.currentTime;
    const ahead = typeof document !== 'undefined' && document.hidden ? 2.5 : 0.35;
    while (this.idx < ev.length) {
      const e = ev[this.idx], w = this._when(e.t);
      if (w > now + ahead) break;
      this.idx++;
      if (w < now + 0.005) continue;                      // too late for this one
      this._keep(play(this.G, e, w));
    }
  }
  _halt() {
    clearInterval(this.timer); this.timer = 0;
    if (!this.ctx) return;
    const now = this.ctx.currentTime, G = this.G;
    G.bus.gain.cancelScheduledValues(now);
    G.bus.gain.setValueAtTime(G.bus.gain.value, now);
    G.bus.gain.linearRampToValueAtTime(0, now + 0.03);
    this._cut(now + 0.035);
    G.bus.gain.setValueAtTime(1, now + 0.05);
    this.anchor = null;
    setTimeout(() => { if (this.ctx) this._clean(); }, 250);
  }
  stop() { this._halt(); this.playing = false; }
  setVolume(v) {
    this.vol = Math.max(0, Math.min(1, +v || 0));
    if (this.G) this.G.master.gain.setTargetAtTime(this.vol * LEVEL, this.ctx.currentTime, 0.03);
  }
  /** Releases the AudioContext (optional). */
  close() { this.stop(); try { this.ctx?.close(); } catch {} this.ctx = null; this.G = null; }
}
