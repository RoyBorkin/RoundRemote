// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Shared by the Clock (alarms) and Timer apps: the full-screen "ringing" overlay, the built-in alarm sounds
// (Web Audio, no files), starting the user's music (a playlist from a service, or the song that was playing),
// and the "What plays" editor used in both apps' settings.
//
// The overlay is mounted on #app (above every screen and panel), so an alarm or timer can ring wherever you are
// in Round Remote — as long as the page is open and the app's module has been loaded once.
import { h } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { openPanel, curve, listRow, emptyNote, spinner, toast } from '../js/ui/overlay.js';
import { player } from '../js/core/player.js';
import { provider as providerById, getService } from '../js/providers/registry.js';
import { notify, stopAlert } from '../js/core/alerts.js';

// ------------------------------------------------------------------ styles (injected once; both apps need them)
const CSS = `
.rk-ring { position: absolute; inset: 0; z-index: 90; border-radius: 50%; overflow: hidden; container-type: size;
  background: color-mix(in srgb, var(--bg) 90%, transparent); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
  opacity: 0; transform: scale(1.08); transition: opacity .3s, transform .4s cubic-bezier(.2,.8,.2,1); --rc: #60a5fa; }
.rk-ring.in { opacity: 1; transform: none; }
.rk-flash { position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--rc) 55%, transparent), transparent 70%);
  animation: rk-flash 1.1s ease-in-out infinite; pointer-events: none; }
@keyframes rk-flash { 0%, 100% { opacity: .15; } 50% { opacity: .75; } }
.rk-wave { position: absolute; left: 50%; top: 36%; width: 30cqmin; height: 30cqmin; margin: -15cqmin 0 0 -15cqmin; border-radius: 50%;
  border: .6cqmin solid var(--rc); opacity: 0; animation: rk-wave 2.4s cubic-bezier(.2,.6,.3,1) infinite; pointer-events: none; }
.rk-wave:nth-child(3) { animation-delay: .8s; } .rk-wave:nth-child(4) { animation-delay: 1.6s; }
@keyframes rk-wave { 0% { transform: scale(.5); opacity: .9; } 100% { transform: scale(3.2); opacity: 0; } }
.rk-bell { position: absolute; left: 50%; top: 22%; transform: translate(-50%, -50%); font-size: 9cqmin; color: var(--rc); }
.rk-bell .ic { animation: rk-bell .9s ease-in-out infinite; transform-origin: 50% 10%; }
@keyframes rk-bell { 0%, 50%, 100% { rotate: 0deg; } 10% { rotate: 16deg; } 20% { rotate: -14deg; } 30% { rotate: 10deg; } 40% { rotate: -6deg; } }
.rk-time { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); font-family: var(--display); font-weight: 700;
  font-size: 17cqmin; letter-spacing: -.03em; font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1; }
.rk-title { position: absolute; left: 14%; right: 14%; top: 51%; text-align: center; font-size: 4.4cqmin; font-weight: 800;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; unicode-bidi: plaintext; }
.rk-sub { position: absolute; left: 18%; right: 18%; top: 58.5%; text-align: center; font-size: 2.7cqmin; color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; justify-content: center; align-items: center; gap: 1cqmin; }
.rk-sub .ic { flex: none; font-size: 3cqmin; color: var(--rc); }
.rk-sub span { overflow: hidden; text-overflow: ellipsis; unicode-bidi: plaintext; }
.rk-btn { position: absolute; top: 76%; transform: translate(-50%, -50%); width: 23cqmin; height: 23cqmin; border-radius: 50%;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .6cqmin; font-weight: 800; font-size: 3.2cqmin;
  transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
.rk-btn .ic { font-size: 6.4cqmin; }
.rk-btn:active { transform: translate(-50%, -50%) scale(.92); }
.rk-stop { left: 50%; background: var(--rc); color: #0a0a0b; box-shadow: 0 1.4cqmin 6cqmin color-mix(in srgb, var(--rc) 45%, transparent); }
.rk-ring.two .rk-stop { left: 64%; }
.rk-snooze { left: 36%; background: var(--glass-2); border: 1px solid var(--line); }
.rk-keep { position: absolute; left: 50%; top: 91%; transform: translate(-50%, -50%); font-size: 2.4cqmin; font-weight: 700; color: var(--muted);
  padding: 1.4cqmin 3cqmin; border-radius: 99px; }
.rk-keep:active { background: var(--glass); }

.rk-what { display: flex; flex-direction: column; align-items: center; gap: 1.6cqmin; width: 100%; }
.rk-what .rk-pick { display: flex; align-items: center; gap: 1.6cqmin; max-width: 100%; padding: 1.4cqmin 3cqmin 1.4cqmin 1.4cqmin; border-radius: 99px;
  background: var(--glass); border: 1px solid var(--line); font-weight: 700; font-size: 2.7cqmin; }
.rk-what .rk-pick .rk-art { width: 6.4cqmin; height: 6.4cqmin; border-radius: 50%; flex: none; background: var(--glass-2) center/cover; display: grid; place-items: center; font-size: 3.2cqmin; }
.rk-what .rk-pick span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; unicode-bidi: plaintext; }
.rk-what .rk-hint { font-size: 2.3cqmin; color: var(--dim); text-align: center; max-width: 90%; }
.rk-pl-panel .panel-body { top: 16%; bottom: 15%; }
.rk-pl-panel .list { padding: 6% 0 14%; }
`;
function ensureStyle() {
  if (document.getElementById('rk-style')) return;
  document.head.append(h('style#rk-style', CSS));
}

// ------------------------------------------------------------------ built-in sounds
export const SOUNDS = [
  { id: 'chime', name: 'Chime' },
  { id: 'marimba', name: 'Marimba' },
  { id: 'birds', name: 'Birds' },
  { id: 'beeps', name: 'Beeps' },
];

let actx = null;
function audioCtx() {
  try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}

/** One note into `dest`: sine/triangle with a bell-ish envelope. */
function note(a, dest, t, f, { d = 1.2, type = 'sine', v = 0.3, attack = 0.006, partials = null, sweep = null } = {}) {
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  g.connect(dest);
  for (const [mul, amp] of partials || [[1, 1]]) {
    const o = a.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f * mul, t);
    if (sweep) o.frequency.exponentialRampToValueAtTime(f * mul * sweep, t + d * 0.8);
    const pg = a.createGain(); pg.gain.value = amp;
    o.connect(pg); pg.connect(g);
    o.start(t); o.stop(t + d + 0.05);
  }
}
const N = (semi) => 440 * 2 ** ((semi - 9) / 12);   // semitones from C4… (0 = C4, 12 = C5)
const PATTERNS = {
  // one cycle of each sound: (audio, out, t0) → cycle length in seconds
  chime(a, out, t) {
    const bell = [[1, 1], [2.76, 0.32], [5.4, 0.12]];
    [12, 16, 19, 24, 19, 16].forEach((s, i) => note(a, out, t + i * 0.22, N(s), { d: 1.6, partials: bell, v: 0.22 }));
    return 2.6;
  },
  marimba(a, out, t) {
    const seq = [[0, 19], [0.18, 24], [0.36, 21], [0.54, 16], [0.9, 19], [1.08, 14], [1.26, 17], [1.44, 12], [1.8, 16], [1.98, 19], [2.16, 24], [2.34, 28]];
    for (const [dt, s] of seq) note(a, out, t + dt, N(s), { d: 0.5, type: 'sine', partials: [[1, 1], [4, 0.25], [10, 0.05]], v: 0.3 });
    return 3.0;
  },
  birds(a, out, t) {
    let dt = 0;
    for (let i = 0; i < 7; i++) {
      const f = 2400 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) { note(a, out, t + dt, f * (1 + k * 0.04), { d: 0.09, sweep: 1.35 + Math.random() * 0.4, v: 0.12, attack: 0.004 }); dt += 0.11; }
      dt += 0.18 + Math.random() * 0.35;
    }
    return dt + 0.6;
  },
  beeps(a, out, t) {
    for (let i = 0; i < 4; i++) note(a, out, t + i * 0.16, 1046, { d: 0.11, type: 'square', v: 0.08, attack: 0.003 });
    return 1.1;
  },
};

/** Loop a built-in sound; it starts quiet and gets louder over ~30 s. Returns stop(). */
export function playSound(id = 'chime', { ramp = true, maxSeconds = 0 } = {}) {
  const a = audioCtx();
  if (!a) return () => {};
  const pat = PATTERNS[id] || PATTERNS.chime;
  const out = a.createGain();
  const t0 = a.currentTime + 0.05;
  out.gain.setValueAtTime(ramp ? 0.35 : 1, t0);
  if (ramp) out.gain.linearRampToValueAtTime(1, t0 + 30);
  out.connect(a.destination);
  let next = t0, stopped = false, timer = 0;
  const pump = () => {
    if (stopped) return;
    while (next < a.currentTime + 1.2) {
      if (maxSeconds && next - t0 > maxSeconds) { setTimeout(stop, (next - a.currentTime) * 1000 + 300); return; }
      next += pat(a, out, next);
    }
    timer = setTimeout(pump, 300);
  };
  function stop() {
    if (stopped) return;
    stopped = true; clearTimeout(timer);
    try { out.gain.cancelScheduledValues(a.currentTime); out.gain.setValueAtTime(out.gain.value, a.currentTime); out.gain.linearRampToValueAtTime(0, a.currentTime + 0.15); } catch {}
    setTimeout(() => { try { out.disconnect(); } catch {} }, 400);
  }
  pump();
  return stop;
}
let previewStop = null;
/** A short preview of a sound (stops the previous preview). */
export function previewSound(id) { previewStop?.(); previewStop = playSound(id, { ramp: false, maxSeconds: 2.2 }); }

// ------------------------------------------------------------------ music
/** A config: { what: 'playlist' | 'song' | 'sound', svc, playlist: {id, name, …}, sound, volume: null | 0–100 } */
export const DEFAULT_WHAT = Object.freeze({ what: 'sound', svc: null, playlist: null, sound: 'chime', volume: null });

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** Make the saved service the active one (without leaving the current screen). */
async function ensureProvider(svcId) {
  if (!svcId) return player.provider;
  if (player.provider?.id === svcId) return player.provider;
  const p = providerById(svcId);
  if (!p || p.setupHint?.() || !p.isAuthed?.()) return player.provider?.id === svcId ? player.provider : null;
  await withTimeout(player.use(p), 9000);
  const svc = getService(svcId);
  if (svc) { const appEl = document.getElementById('app'); appEl?.style.setProperty('--accent', svc.color); appEl?.style.setProperty('--brand', svc.color); }
  return p;
}

/**
 * Start what the user chose. Resolves to { kind: 'music' | 'sound', label, stop(pauseMusic) }.
 * Falls back to the built-in sound when there's no service, nothing to resume, or the service fails.
 */
export async function startWhat(cfg = DEFAULT_WHAT) {
  cfg = { ...DEFAULT_WHAT, ...(cfg || {}) };
  const soundFallback = (why) => {
    if (why) console.info('[ring] built-in sound:', why);
    const stop = playSound(cfg.sound);
    return { kind: 'sound', label: (SOUNDS.find((s) => s.id === cfg.sound) || SOUNDS[0]).name, stop: () => stop() };
  };
  const setVol = () => { if (cfg.volume && player.caps.volume) player.setVolume(cfg.volume); };
  try {
    if (cfg.what === 'playlist' && cfg.playlist) {
      const p = await ensureProvider(cfg.svc);
      if (!p) return soundFallback('service not connected');
      setVol();
      await withTimeout(p.playPlaylist(cfg.playlist), 9000);
      setTimeout(() => p.refresh?.().catch(() => {}), 600);
      return { kind: 'music', label: cfg.playlist.name || 'Playlist', stop: (pause) => { if (pause) player.pause(); } };
    }
    if (cfg.what === 'song') {
      const p = player.provider;
      if (!p || !player.state.track) return soundFallback('nothing to resume');
      setVol();
      if (!player.state.isPlaying) await withTimeout(player.play(), 6000);
      const tr = player.state.track;
      return { kind: 'music', label: [tr.title, tr.artist].filter(Boolean).join(' · ') || 'Your music', stop: (pause) => { if (pause) player.pause(); } };
    }
  } catch (e) {
    console.warn('[ring] music failed', e);
    toast('Couldn’t start the music — playing the alarm sound');
  }
  return soundFallback(cfg.what === 'sound' ? '' : 'no music');
}

// ------------------------------------------------------------------ keep the screen awake
/** Stops Round Remote's idle dimming while `on` (it listens for input; a synthetic wheel event counts). */
export function nudgeAwake() {
  try { window.dispatchEvent(new WheelEvent('wheel', { deltaY: 0 })); } catch {}
  document.getElementById('app')?.classList.remove('dim');
  import('../js/core/device.js').then((d) => d.wake('alarm')).catch(() => {});   // Pi: the screen back on if it went off
}

// ------------------------------------------------------------------ the ringing overlay
let current = null;
export const isRinging = () => !!current;

/**
 * Show the ringing screen and start the sound/music.
 * opts: { time: '07:30' (big text), title, color, what: cfg, snooze: 'Snooze' | '+1 min' | null, onSnooze, onStop, icon,
 *         source: 'clock' | 'timer' | 'hourglass' (smart-home alerts, Settings → Alerts), message }
 * Returns a handle { close() }.
 */
export function ring(opts) {
  ensureStyle();
  if (current) current.close({ silent: true, pause: false });   // a new ring replaces the old one
  const root = document.getElementById('app');
  const sub = h('div.rk-sub', h('span', 'Starting…'));
  const timeEl = h('div.rk-time', opts.time || '');
  const el = h('div.rk-ring', { role: 'alertdialog', 'aria-label': opts.title || 'Alarm', '--rc': opts.color || '#60a5fa' },
    h('div.rk-flash'),
    h('div.rk-wave'), h('div.rk-wave'), h('div.rk-wave'),
    h('div.rk-bell', { html: icon(opts.icon || 'clock') }),
    timeEl,
    h('div.rk-title', { dir: 'auto' }, opts.title || ''),
    sub);
  let sound = null, closed = false, alertP = null;
  const handle = {
    el,
    setTime(t) { timeEl.textContent = t; },
    close({ pause = true, silent = false } = {}) {
      if (closed) return;
      closed = true;
      sound?.stop(pause);
      alertP?.then((a) => stopAlert(a)).catch(() => {});   // lights back, speaker quiet
      if (current === handle) current = null;
      window.removeEventListener('keydown', onKey, true);
      clearInterval(awake);
      el.classList.remove('in');
      setTimeout(() => el.remove(), 350);
      if (!silent) opts.onClose?.();
    },
  };
  const stopBtn = h('button.rk-btn.rk-stop', { type: 'button', onclick: (e) => { e.stopPropagation(); handle.close({ pause: true }); opts.onStop?.(); } },
    h('i', { html: icon('stop') }), 'Stop');
  el.append(stopBtn);
  if (opts.snooze) {
    el.classList.add('two');
    el.append(h('button.rk-btn.rk-snooze', { type: 'button', onclick: (e) => { e.stopPropagation(); handle.close({ pause: true }); opts.onSnooze?.(); } },
      h('i', { html: icon(opts.snoozeIcon || 'moon') }), opts.snooze));
  }
  const keep = h('button.rk-keep', { type: 'button', hidden: true, onclick: (e) => { e.stopPropagation(); handle.close({ pause: false }); opts.onStop?.(); } }, 'Stop, keep the music playing');
  el.append(keep);
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  const onKey = (e) => {
    e.stopImmediatePropagation(); e.preventDefault();
    if (['Enter', ' ', 'Escape', 'Backspace'].includes(e.key)) stopBtn.click();
    else if (opts.snooze && ['ArrowLeft', 'ArrowRight', 's'].includes(e.key)) el.querySelector('.rk-snooze')?.click();
  };
  window.addEventListener('keydown', onKey, true);
  nudgeAwake();
  const awake = setInterval(nudgeAwake, 4000);
  root.append(el);
  current = handle;
  // the smart home too (lights, speaker, phone…), as set up in Settings → Alerts
  try {
    alertP = notify({ title: opts.title || 'Alarm', message: opts.message || (opts.source === 'clock' || !opts.source ? `It’s ${opts.time}` : 'Time is up'), level: opts.level || 'alarm', source: opts.source || 'clock' }).catch(() => null);
  } catch { alertP = null; }
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  startWhat(opts.what).then((s) => {
    if (closed) { s.stop(true); return; }
    sound = s;
    sub.replaceChildren(h('i', { html: icon(s.kind === 'music' ? 'note' : 'tone') }), h('span', { dir: 'auto' }, s.label));
    keep.hidden = s.kind !== 'music';
  });
  return handle;
}

// ------------------------------------------------------------------ "What plays" editor (for settings panels)
const strip = (pl) => { const { art, ...rest } = pl || {}; return { ...rest, art: typeof art === 'string' && art.length < 600 ? art : '' }; };

/**
 * A small form: chips (Playlist / The song / Sound) + the detail for the chosen one.
 * `get()` returns the current config, `set(cfg)` saves it. `songLabel` names the "song" option.
 */
export function whatEditor({ get, set, songLabel = 'Current song', songHint = 'Plays the song that is on in your music service.' }) {
  ensureStyle();
  const el = h('div.rk-what');
  const render = () => {
    const cfg = { ...DEFAULT_WHAT, ...(get() || {}) };
    const kinds = [{ id: 'playlist', name: 'Playlist' }, { id: 'song', name: songLabel }, { id: 'sound', name: 'Alarm sound' }];
    const chips = h('div.chips', kinds.map((k) => h(`button.chip${cfg.what === k.id ? '.on' : ''}`, {
      type: 'button', onclick: () => { set({ ...cfg, what: k.id }); render(); if (k.id === 'playlist' && !cfg.playlist) pickPlaylist(); },
    }, k.name)));
    el.replaceChildren(chips);
    if (cfg.what === 'playlist') {
      const pl = cfg.playlist;
      const svc = cfg.svc ? getService(cfg.svc) : null;
      el.append(h('button.rk-pick', { type: 'button', onclick: pickPlaylist },
        h('div.rk-art', { style: pl?.art ? { backgroundImage: `url("${pl.art}")` } : {}, html: pl?.art ? '' : icon('playlist') }),
        h('span', { dir: 'auto' }, pl ? pl.name : 'Choose a playlist…')),
      h('div.rk-hint', pl ? `From ${svc?.name || 'your music service'} · plays on the device you were using` : 'Pick one of your playlists from the music service you’re using.'));
    } else if (cfg.what === 'song') {
      el.append(h('div.rk-hint', songHint + ' If nothing is on, the alarm sound plays.'));
    }
    if (cfg.what === 'sound' || true) {
      el.append(h('div.chips', SOUNDS.map((s) => h(`button.chip${cfg.sound === s.id ? '.on' : ''}`, {
        type: 'button', onclick: () => { set({ ...cfg, sound: s.id }); previewSound(s.id); render(); },
      }, s.name))));
      if (cfg.what !== 'sound') el.lastChild.before(h('div.rk-hint', 'Backup sound (when the music can’t start):'));
    }
    if (cfg.what !== 'sound') {
      el.append(h('div.rk-hint', 'Volume'),
        h('div.chips', [null, 30, 50, 70, 100].map((v) => h(`button.chip${(cfg.volume ?? null) === v ? '.on' : ''}`, {
          type: 'button', onclick: () => { set({ ...cfg, volume: v }); render(); },
        }, v === null ? 'As it is' : `${v}%`))));
    }
  };
  function pickPlaylist() {
    const p = player.provider;
    openPanel({
      title: 'Playlists', className: 'rk-pl-panel',
      build(body, panel) {
        if (!p) { body.append(emptyNote('Open a music service first (from Home) — then its playlists show here.')); return; }
        if (!p.caps?.playlists) { body.append(emptyNote(`${p.name || 'This service'} has no playlists to choose from.`)); return; }
        const list = h('div.list');
        body.append(list); curve(list);
        list.append(spinner());
        p.getPlaylists().then((pls) => {
          list.replaceChildren();
          if (!pls?.length) { list.append(emptyNote('No playlists found.')); return; }
          const cur = get()?.playlist?.id;
          for (const pl of pls) {
            list.append(listRow({ title: pl.name, subtitle: pl.subtitle || '', art: pl.art || '', mono: '♪', color: 'var(--ac, var(--accent))', active: pl.id === cur,
              onClick: () => { set({ ...DEFAULT_WHAT, ...(get() || {}), what: 'playlist', svc: p.id, playlist: strip(pl) }); panel.close(); render(); } }));
          }
        }).catch((e) => { list.replaceChildren(emptyNote(`Couldn’t load playlists: ${e?.message || e}`)); });
      },
    });
  }
  render();
  return el;
}
