// Rhythm: the song clock. The music plays on the remote end, so "where are we in the song" comes from the
// player's position — interpolated between polls, with a jump whenever a poll lands. Games need a steady
// clock instead: songTime() follows player.position() smoothly (small backwards jitter is swallowed, bigger
// corrections are eased in, seeks and new songs snap) and applies the latency offset from Settings → Rhythm.
//
//   songTime()        song time in ms for gameplay (calibrated: what the player hears right now)
//   rawTime()         the same without the latency offset
//   uncertaintyMs()   how precise the position is: ≈10 for audio in this browser, 60–120 for remote players
//   resetClock()      forget the smoothing (after a seek / new round)
//   startSong()       seek(0) + play on the remote (the Demo plays in this browser through DemoPlayer)
//   pauseSong() / resumeSong(atMs)
//   demoTick()        keep the Demo's audible playback (rhythm/synth.js DemoPlayer) in step — call every frame
//                     while a rhythm game or the Rhythm screen is showing a Demo song
import { player } from '../js/core/player.js';
import { store } from '../js/core/store.js';

const now = () => performance.now();
const trackKeyOf = (t) => (t ? t.id || `${t.title}|${t.artist}` : null);

/** Audio plays in this browser (Demo, MusicKit on this display…): the position is exact. */
export function isLocal(p = player.provider) { return !!(p && p.local && !p.remote); }
export const isDemo = (p = player.provider) => p?.id === 'demo';
export const offsetMs = () => Number(store.get('rhythmOffsetMs')) || 0;

// ---------------------------------------------------------------- smoothing
let sm = null;   // { out, wall, track, playing }
export function resetClock() { sm = null; }

export function rawTime() {
  const raw = player.position();
  const t = now();
  const track = trackKeyOf(player.state.track);
  const playing = !!player.state.isPlaying;
  if (!sm || sm.track !== track) { sm = { out: raw, wall: t, track, playing }; return raw; }
  const dt = Math.max(0, t - sm.wall);
  const pred = sm.out + (sm.playing ? dt : 0);
  const err = raw - pred;
  let out;
  if (Math.abs(err) > 1000 || (!playing && !sm.playing)) out = raw;            // seek / jump / paused: snap
  else {
    out = pred + err * (1 - Math.exp(-dt / 220));                               // ease toward the reported position
    if (out < sm.out && err > -150) out = sm.out;                                // never step back for poll jitter
  }
  sm.out = out; sm.wall = t; sm.playing = playing;
  return out;
}
export function songTime() { return rawTime() - offsetMs(); }

// ---------------------------------------------------------------- precision of the position
let jitter = 40, prevSnap = null;
player.on('state', (s) => {
  const t = now();
  if (!s.track || !s.isPlaying || isLocal()) { prevSnap = null; return; }
  const pos = (s.progressMs || 0) + (t - (s.updatedAt || t));
  if (prevSnap && prevSnap.track === trackKeyOf(s.track)) {
    const expected = prevSnap.pos + (t - prevSnap.t);
    const d = Math.abs(pos - expected);
    if (d > 2 && d < 1500) jitter += (d - jitter) * 0.2;   // ignore seeks; 0-error repeats are just re-emits
  }
  prevSnap = { pos, t, track: trackKeyOf(s.track) };
});
player.on('provider', () => { prevSnap = null; jitter = 40; });
export function uncertaintyMs() {
  if (!player.provider) return 60;
  if (isLocal()) return 10;
  const poll = Math.max(1000, Number(store.get('pollMs')) || 2000);
  return Math.round(Math.min(120, Math.max(60, 40 + jitter * 0.6 + poll / 200)));
}

// ---------------------------------------------------------------- transport
/** Start the current song from the very beginning on the remote (seek 0 + play). */
export async function startSong() {
  resetClock();
  if (!player.provider) return;
  if (player.caps.seek) player.seek(0);
  else if (player.position() > 3000) player.prev();   // services without seek restart the song on "previous"
  player.play();
  resetClock();
}
export function pauseSong() { if (player.state.isPlaying) player.pause(); }
/** Continue from a song time (ms) — used after pausing a game (it seeks back a little for a count-in). */
export function resumeSong(atMs = null) {
  resetClock();
  if (atMs != null && player.caps.seek) player.seek(Math.max(0, atMs));
  player.play();
  resetClock();
}

// ---------------------------------------------------------------- Demo audio (rhythm/synth.js)
let demo = null, demoP = null, lastSync = 0, watch = 0;
function loadDemo() {
  if (!demoP) {
    demoP = import('./synth.js').then((m) => { demo = new m.DemoPlayer(); return demo; })
      .catch((e) => { console.info('[rhythm] demo audio unavailable', e?.message || e); demoP = null; return null; });
  }
  return demoP;
}
/** Keep the Demo song audible in this browser, in step with the Demo player's position. Call every frame. */
export function demoTick() {
  if (!isDemo() || !player.state.track) { demoStop(); return; }
  lastSync = now();
  if (!demo) { loadDemo(); return; }
  try {
    demo.setVolume?.(player.state.volume == null ? 0.8 : Math.max(0, Math.min(1, player.state.volume / 100)));
    demo.sync(player.state.track.id, player.position(), !!player.state.isPlaying);
  } catch (e) { console.warn('[rhythm] demo sync', e); }
  // nobody calling demoTick any more (left the screen, paused game) → go quiet
  if (!watch) watch = setInterval(() => { if (now() - lastSync > 400) demoStop(); }, 250);
}
export function demoStop() {
  clearInterval(watch); watch = 0;
  try { demo?.stop(); } catch {}
}
