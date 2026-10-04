// Rhythm: the song being played, what the app has learned about it (analyses + versions), and learning itself.
//
// A song is identified by a key (service id + track id, e.g. 'demo:d1', 'spotify:4uLU6hMC…'). Learning a song
// produces one Analysis (format in RHYTHM_GUIDE.md) and a first Version (= that analysis + chart seed 1).
// "New version" = the same analysis with a new seed (a different but equally good chart); learning again =
// a new analysis + version. Both are kept in IndexedDB (rhythm/store.js); the chosen version per song is a setting.
//
// Learning sources (learn() picks one for method 'auto'):
//   synth   the Demo service: its songs are rendered offline (rhythm/synth.js) — far faster than real time
//   file    Plex / Jellyfin (provider.analysisUrl): download the file, decode, analyse in a worker (10–40×)
//   bridge  the bridge records the computer's sound (rhythm/bridge-audio.js): one real-time listen
//   mic     a microphone on this display hears the speakers: one real-time listen
//   tempo   no audio at all: tempo (looked up by the bridge, or tapped) + tap-along to find the beat
// The DSP / bridge modules are imported lazily so the Rhythm screen works even before they are loaded.
import { player } from '../js/core/player.js';
import { store } from '../js/core/store.js';
import { normalizeText, lanOpts } from '../js/core/util.js';
import { rstore } from './store.js';
import { songTime, startSong, resetClock } from './clock.js';

export const SAMPLE_RATE = 22050;
export const SOURCES = [
  { id: 'auto', name: 'Auto' }, { id: 'file', name: 'File' }, { id: 'mic', name: 'Microphone' },
  { id: 'bridge', name: 'Bridge' }, { id: 'tempo', name: 'Tempo' },
];
/** How each source is described on the learning screen. */
export const SOURCE_TEXT = {
  synth: 'Demo song · rendered offline', file: 'Reading the music file', mic: 'Listening with the microphone',
  bridge: 'Listening on the computer (bridge)', tempo: 'Tempo & tap-along',
};
export const SOURCE_SHORT = { synth: 'Demo', file: 'File', mic: 'Microphone', bridge: 'Bridge', tempo: 'Tempo' };

const uidPart = () => Math.random().toString(36).slice(2, 8);
const dsp = () => import('./analyzer.js');
const bridgeAudio = () => import('./bridge-audio.js');

// ---------------------------------------------------------------- songs
/** Song key: service id + track id/uri; without one, the normalised “artist – title”. */
export function songKey(provider, track) {
  if (!track) return null;
  const svc = provider?.id || 'song';
  const id = track.id || track.uri;
  if (id != null && id !== '') return `${svc}:${String(id)}`;
  return `song:${normalizeText(track.artist || '')}–${normalizeText(track.title || '')}`;
}
/** The song playing now on the chosen service: { key, track, provider, title, artist } or null. */
export function currentSong() {
  const p = player.provider, t = player.state.track;
  if (!p || !t || p.section === 'media' || p.section === 'home') return null;
  return { key: songKey(p, t), track: t, provider: p, title: t.title || '', artist: t.artist || '' };
}
// the song a game round is being played with (it stays put when the remote moves on to the next track)
let active = null;
export function setActiveSong(song) { active = song || null; }
export function activeSong() { return active; }

// ---------------------------------------------------------------- versions
const cache = new Map();   // analysis id → analysis
const relearn = new Set(); // song keys to learn again before the next game

/** Every version of a song, oldest first: [{ id, key, analysisId, seed, source, created, name }]. */
export async function versions(key) { return key ? rstore.listBySong(key, 'versions') : []; }
export function selectedVersionId(key) { return (store.get('rhythmSel') || {})[key] || null; }
/** The version chosen for a song (the newest one if none was chosen) or null. */
export async function selectedVersion(key) {
  const list = await versions(key);
  if (!list.length) return null;
  const id = selectedVersionId(key);
  return list.find((v) => v.id === id) || list[list.length - 1];
}
export function selectVersion(key, id) { store.set('rhythmSel', { ...(store.get('rhythmSel') || {}), [key]: id }); }
function nextName(list) {
  const n = list.reduce((m, v) => Math.max(m, +(/(\d+)$/.exec(v.name || '')?.[1] || 0)), 0);
  return `Version ${n + 1}`;
}
/** Another chart for the same learning: same analysis, a new seed. Returns the new version (selected). */
export async function newVersion(key) {
  const list = await versions(key);
  const base = await selectedVersion(key);
  if (!base) return null;
  const seed = list.reduce((m, v) => Math.max(m, v.seed || 1), 1) + 1;
  const v = { ...base, id: `v-${Date.now()}-${uidPart()}`, seed, created: Date.now(), name: nextName(list) };
  await rstore.put('versions', v);
  selectVersion(key, v.id);
  return v;
}
/** The Analysis behind a version (or null if it was lost). */
export async function analysisFor(version) {
  if (!version?.analysisId) return null;
  if (cache.has(version.analysisId)) return cache.get(version.analysisId);
  const a = await rstore.get('analyses', version.analysisId);
  if (a) cache.set(a.id, a);
  return a;
}
/** Delete one version (and its analysis when no other version uses it). */
export async function deleteVersion(version) {
  await rstore.delete('versions', version.id);
  const rest = await versions(version.key);
  if (!rest.some((v) => v.analysisId === version.analysisId)) { await rstore.delete('analyses', version.analysisId); cache.delete(version.analysisId); }
}
/** Forget everything learned about a song. */
export async function forget(key) {
  for (const v of await versions(key)) await rstore.delete('versions', v.id);
  for (const a of await rstore.listBySong(key, 'analyses')) { await rstore.delete('analyses', a.id); cache.delete(a.id); }
  const sel = { ...(store.get('rhythmSel') || {}) }; delete sel[key]; store.set('rhythmSel', sel);
  relearn.delete(key);
}
/** Forget every learned song. */
export async function forgetAll() { await rstore.clear(); cache.clear(); relearn.clear(); store.set('rhythmSel', {}); }
/** Learn this song again the next time a game starts with it (keeps the old versions). */
export function markRelearn(key, on = true) { if (on) relearn.add(key); else relearn.delete(key); }
export function needsRelearn(key) { return relearn.has(key); }
/** Number of learned songs (for Settings). */
export async function learnedSongCount() { return new Set((await rstore.all('versions')).map((v) => v.key)).size; }

/** Save a fresh analysis with its first version (seed 1); the new version becomes the selected one. */
export async function saveAnalysis(analysis, { title = '', artist = '' } = {}) {
  const key = analysis.key;
  analysis.id ||= `a-${Date.now()}-${uidPart()}`;
  analysis.created ||= Date.now();
  await rstore.put('analyses', analysis);
  cache.set(analysis.id, analysis);
  const list = await versions(key);
  const v = { id: `v-${Date.now()}-${uidPart()}`, key, analysisId: analysis.id, seed: 1, source: analysis.source, created: Date.now(), name: nextName(list), title, artist };
  await rstore.put('versions', v);
  selectVersion(key, v.id);
  relearn.delete(key);
  return v;
}

// ---------------------------------------------------------------- choosing a source
async function micGranted() {
  try { return (await navigator.permissions.query({ name: 'microphone' })).state === 'granted'; } catch { return false; }
}
async function bridgeCapturing() {
  try {
    const m = await bridgeAudio();
    const st = await Promise.race([m.bridgeAudioStatus(), new Promise((r) => setTimeout(() => r(null), 1800))]);
    return !!(st?.ok && st.capturing);
  } catch { return false; }
}
/** Which source learn() will use for this track: 'synth' | 'file' | 'bridge' | 'mic' | 'tempo'. */
export async function chooseSource(track, method = store.get('rhythmSource') || 'auto', provider = player.provider) {
  const demo = provider?.id === 'demo';
  const hasFile = typeof provider?.analysisUrl === 'function';
  if (method === 'file') return demo ? 'synth' : hasFile ? 'file' : chooseSource(track, 'auto', provider);
  if (method === 'synth') return demo ? 'synth' : chooseSource(track, 'auto', provider);
  if (['mic', 'bridge', 'tempo'].includes(method)) return method;
  if (demo) return 'synth';
  if (hasFile) return 'file';
  if (await bridgeCapturing()) return 'bridge';
  if (await micGranted()) return 'mic';
  return 'tempo';
}

// ---------------------------------------------------------------- learning
/**
 * Start learning a track. Returns a job the learning screen draws from:
 *   { source, phase, progress 0..1, text, speed (× real time), coverage, live (LiveLearner: .features), bpm, taps,
 *     canFinish, error, promise → { analysis, version }, done() (finish a live listen early / finish tapping),
 *     cancel(), tap(songTimeMs) }
 * phases: 'prepare' 'download' 'decode' 'render' 'analyse' 'listen' 'lookup' 'taps' 'save' 'done' 'error' 'cancelled'
 * opts: { method ('auto'|source id), onProgress(p), onStatus(job), signal (AbortSignal → cancel), provider }
 * With method 'auto' a failing file / bridge / microphone falls back to 'tempo'.
 */
export function learnJob(track, { method = store.get('rhythmSource') || 'auto', onProgress, onStatus, signal, provider = player.provider } = {}) {
  const key = songKey(provider, track);
  const ctl = new AbortController();
  let finishNow = null;
  const job = {
    key, source: null, phase: 'prepare', progress: 0, text: 'Getting ready…', speed: 0, coverage: 0, live: null,
    bpm: null, taps: [], canFinish: false, error: '', fallback: false,
    done() { finishNow?.(); },
    cancel() { if (!ctl.signal.aborted) { ctl.abort(); set({ phase: 'cancelled', text: 'Cancelled' }); } },
    tap(ms) { if (job.phase === 'taps') { job.taps.push(ms); tapUpdate(); } },
  };
  if (signal) { if (signal.aborted) job.cancel(); else signal.addEventListener('abort', () => job.cancel(), { once: true }); }
  const set = (patch) => {
    Object.assign(job, patch);
    if ('progress' in patch) { try { onProgress?.(job.progress); } catch {} }
    try { onStatus?.(job); } catch {}
  };
  const check = () => { if (ctl.signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' }); };
  const durMs = track?.durationMs || 0;

  // ------------------------------------------------ offline sources
  async function analyse(samples, sampleRate, source, t0, base = 0) {
    check();
    const A = await dsp();
    const audioMs = (samples.length / sampleRate) * 1000;
    set({ phase: 'analyse', text: 'Analysing the beat…' });
    const a = await A.analyzeInWorker(samples, sampleRate, {
      key, source,
      onProgress: (p) => {
        if (ctl.signal.aborted) return;
        const el = performance.now() - t0;
        set({ progress: base + (1 - base) * p, speed: el > 200 ? (audioMs * Math.max(0.05, p)) / el : job.speed });
      },
    });
    check();
    set({ speed: audioMs / Math.max(1, performance.now() - t0) });
    return a;
  }
  async function viaSynth() {
    set({ source: 'synth', phase: 'render', text: 'Rendering the Demo song…' });
    const { renderDemo } = await import('./synth.js');
    const t0 = performance.now();
    const samples = await renderDemo(track.id, { sampleRate: SAMPLE_RATE, onProgress: (p) => !ctl.signal.aborted && set({ progress: 0.45 * p }) });
    return analyse(samples, SAMPLE_RATE, 'synth', t0, 0.45);
  }
  async function download(url) {
    const res = await fetch(url, { ...lanOpts(url), signal: ctl.signal });
    if (!res.ok) throw Object.assign(new Error(`The server answered ${res.status}`), { status: res.status });
    const total = +res.headers.get('content-length') || 0;
    if (!res.body || !total) return res.arrayBuffer();
    const reader = res.body.getReader();
    const buf = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > buf.length) { // longer than announced: fall back to growing
        const big = new Uint8Array(Math.max(buf.length * 2, got + value.length)); big.set(buf.subarray(0, got)); return finishGrow(reader, big, got, value);
      }
      buf.set(value, got); got += value.length;
      set({ progress: 0.3 * (got / total), text: `Downloading · ${(got / 1048576).toFixed(1)} MB` });
    }
    return buf.buffer.slice(0, got);
  }
  async function finishGrow(reader, big, got, value) {
    for (;;) {
      if (got + value.length > big.length) { const b2 = new Uint8Array((got + value.length) * 2); b2.set(big.subarray(0, got)); big = b2; }
      big.set(value, got); got += value.length;
      const r = await reader.read();
      if (r.done) break;
      value = r.value;
    }
    return big.buffer.slice(0, got);
  }
  async function viaFile() {
    set({ source: 'file', phase: 'download', text: 'Fetching the music file…' });
    const url = await provider.analysisUrl(track);
    if (!url) throw new Error('This song has no file to read');
    let ab;
    try { ab = await download(url); }
    catch (e) {
      check();
      if (e.status) throw e;
      // CORS / mixed content: let the bridge fetch it
      set({ text: 'Fetching the file through the bridge…' });
      const B = await bridgeAudio();
      ab = await B.bridgeFetchAudio(url);
    }
    check();
    const t0 = performance.now();
    set({ phase: 'decode', progress: 0.3, text: 'Decoding…' });
    const A = await dsp();
    const { samples, sampleRate } = await A.decodeToMono(ab, SAMPLE_RATE);
    set({ progress: 0.4 });
    return analyse(samples, sampleRate, 'file', t0, 0.4);
  }

  // ------------------------------------------------ live sources (one real-time listen)
  function untilSongEnds(onTick) {
    return new Promise((resolve) => {
      const startTrack = player.state.track?.id ?? player.state.track?.title;
      let started = performance.now();
      const iv = setInterval(() => {
        const t = player.state.track;
        const pos = player.position();
        const changed = (t?.id ?? t?.title) !== startTrack;
        const atEnd = durMs > 0 && pos >= durMs - 400;
        const stopped = performance.now() - started > 4000 && !player.state.isPlaying && durMs > 0 && pos >= durMs - 2500;
        onTick?.(pos);
        if (ctl.signal.aborted || changed || atEnd || stopped) finish();
      }, 200);
      const finish = () => { clearInterval(iv); finishNow = null; resolve(); };
      finishNow = finish;
    });
  }
  async function liveListen(source, open) {
    const A = await dsp();
    set({ source, phase: 'prepare', text: source === 'mic' ? 'Asking for the microphone…' : 'Connecting to the bridge…' });
    const io = await open();                    // { sampleRate, start(push), close() }
    try {
      check();
      const live = new A.LiveLearner({ sampleRate: io.sampleRate, key, source });
      live.durMs = durMs;
      set({ live, phase: 'listen', canFinish: true, text: 'Playing the song from the start…' });
      await startSong();
      const t0 = performance.now();
      io.start((chunk, latencyMs = 0) => {
        if (ctl.signal.aborted || !player.state.isPlaying || performance.now() - t0 < 250) return;
        live.push(chunk, songTime() - (chunk.length / io.sampleRate) * 1000 - latencyMs);
      });
      await untilSongEnds((pos) => {
        const cov = durMs ? (live.coverage ?? pos / durMs) : 0;
        set({ coverage: cov, progress: durMs ? Math.min(1, pos / durMs) : 0, text: 'Listening — let the song play' });
      });
      check();
      set({ phase: 'analyse', canFinish: false, text: 'Putting it together…' });
      const a = live.finish();
      return a;
    } finally { try { io.close(); } catch {} }
  }
  const openMic = async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use a microphone here');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
    catch (e) { throw new Error(e?.name === 'NotAllowedError' ? 'Microphone access was blocked' : e?.name === 'NotFoundError' ? 'No microphone found' : e?.message || 'Microphone unavailable'); }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);
    let node = null, port = null;
    const latency = () => ((ctx.baseLatency || 0) * 1000);
    return {
      sampleRate: ctx.sampleRate,
      async start(push) {
        try {
          // an AudioWorklet from a Blob (no extra file); batches 2048 samples per message
          const code = `class P extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0}
            process(i){const c=i[0]&&i[0][0];if(c){for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===2048){this.port.postMessage(this.b.slice(0));this.n=0}}}return true}}
            registerProcessor('rr-rhythm-tap',P);`;
          const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
          await ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          node = new AudioWorkletNode(ctx, 'rr-rhythm-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
          port = node.port;
          port.onmessage = (e) => push(e.data, latency());
        } catch {
          node = ctx.createScriptProcessor(2048, 1, 1);
          node.onaudioprocess = (e) => push(new Float32Array(e.inputBuffer.getChannelData(0)), latency());
        }
        src.connect(node); node.connect(mute);
      },
      close() {
        try { if (port) port.onmessage = null; node?.disconnect(); src.disconnect(); } catch {}
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
        try { ctx.close(); } catch {}
      },
    };
  };
  const openBridge = async () => {
    const B = await bridgeAudio();
    let pushFn = null, failed = null, conn = null;
    return {
      sampleRate: SAMPLE_RATE,
      start(push) {
        pushFn = push;
        conn = B.openBridgeAudio({ sampleRate: SAMPLE_RATE, onChunk: (c) => pushFn?.(c, 0), onError: (e) => { failed = e; set({ text: `Bridge audio: ${e?.message || e}` }); } });
      },
      close() { pushFn = null; try { conn?.close(); } catch {} if (failed) console.warn('[rhythm] bridge audio', failed); },
    };
  };

  // ------------------------------------------------ tempo + tap-along
  let tapResolve = null;
  function tapUpdate() {
    const fit = fitTaps(job.taps, job.bpm);
    set({ fit, canFinish: job.taps.length >= (job.bpm ? 4 : 8), progress: Math.min(1, job.taps.length / 16),
      text: fit ? `${Math.round(fit.bpm)} BPM · ${job.taps.length} taps` : `${job.taps.length} taps` });
    if (job.taps.length >= 16 && fit) tapResolve?.();
  }
  async function viaTempo() {
    set({ source: 'tempo', phase: 'lookup', text: 'Looking up the tempo…' });
    try {
      const B = await bridgeAudio();
      const r = await Promise.race([
        B.bridgeTempo({ title: track.title, artist: track.artist, spotifyId: provider?.id === 'spotify' ? track.id : undefined }),
        new Promise((res) => setTimeout(() => res(null), 5000)),
      ]);
      if (r?.bpm > 30 && r.bpm < 300) set({ bpm: r.bpm });
    } catch {}
    check();
    await startSong();
    set({ phase: 'taps', taps: [], progress: 0, text: job.bpm ? `${Math.round(job.bpm)} BPM — tap along to the beat` : 'Tap along to the beat' });
    await new Promise((resolve) => {
      tapResolve = resolve;
      finishNow = resolve;
      ctl.signal.addEventListener('abort', resolve, { once: true });
    });
    tapResolve = finishNow = null;
    check();
    const fit = fitTaps(job.taps, job.bpm);
    if (!fit) throw new Error('Tap along to the beat a few more times');
    const A = await dsp();
    return A.tempoAnalysis({ key, bpm: fit.bpm, firstBeatMs: fit.firstBeatMs, durMs: durMs || 240000, seed: 1 });
  }

  // ------------------------------------------------ run
  job.promise = (async () => {
    if (!key) throw new Error('Nothing is playing');
    const chosen = await chooseSource(track, method, provider);
    const run = { synth: viaSynth, file: viaFile, mic: () => liveListen('mic', openMic), bridge: () => liveListen('bridge', openBridge), tempo: viaTempo }[chosen] || viaTempo;
    let analysis;
    try { analysis = await run(); }
    catch (e) {
      if (ctl.signal.aborted || chosen === 'tempo' || (method !== 'auto' && method)) throw e;
      console.warn('[rhythm] learning failed, using tempo', e);
      set({ fallback: true, error: e?.message || String(e), live: null, canFinish: false, speed: 0 });
      analysis = await viaTempo();
    }
    check();
    set({ phase: 'save', progress: 1, text: 'Saving…' });
    analysis.key = key;
    analysis.source ||= job.source;
    const version = await saveAnalysis(analysis, { title: track.title, artist: track.artist });
    set({ phase: 'done', text: 'Learned!' });
    resetClock();
    return { analysis, version };
  })();
  job.promise.catch((e) => {
    if (ctl.signal.aborted) set({ phase: 'cancelled' });
    else set({ phase: 'error', error: e?.message || String(e), text: e?.message || 'Learning failed' });
  });
  return job;
}
/** learn(track, opts) → Promise<{ analysis, version }> (see learnJob). */
export function learn(track, opts = {}) { return learnJob(track, opts).promise; }

/**
 * Beat grid from tap times (song ms). With a known tempo only the phase is fitted; otherwise the tempo comes
 * from the tap intervals (median, then a least-squares fit). → { bpm, firstBeatMs, period } or null.
 */
export function fitTaps(taps, bpmHint = null) {
  const t = [...taps].sort((a, b) => a - b);
  if (t.length < (bpmHint ? 2 : 4)) return null;
  let P;
  if (bpmHint) P = 60000 / bpmHint;
  else {
    const iv = [];
    for (let i = 1; i < t.length; i++) { const d = t[i] - t[i - 1]; if (d > 230 && d < 1600) iv.push(d); }
    if (iv.length < 3) return null;
    iv.sort((a, b) => a - b);
    P = iv[iv.length >> 1];
  }
  const n = t.map((x) => Math.round((x - t[0]) / P));
  if (!bpmHint && t.length >= 4) {
    const mn = n.reduce((s, x) => s + x, 0) / n.length, mt = t.reduce((s, x) => s + x, 0) / t.length;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < t.length; i++) { sxy += (n[i] - mn) * (t[i] - mt); sxx += (n[i] - mn) ** 2; }
    if (sxx > 0) { const b = sxy / sxx; if (b > 230 && b < 1600) P = b; }
  }
  // phase: circular mean of every tap against the grid
  let sx = 0, sy = 0;
  for (const x of t) { const a = ((x % P) / P) * Math.PI * 2; sx += Math.cos(a); sy += Math.sin(a); }
  let ph = (Math.atan2(sy, sx) / (Math.PI * 2)) * P;
  if (ph < 0) ph += P;
  return { bpm: 60000 / P, firstBeatMs: ph, period: P };
}
