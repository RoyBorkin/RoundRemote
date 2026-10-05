// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Alerts: one place every app uses to get your attention — on the display (sound + flash, done by the app) AND,
// if you set it up in Settings → Alerts, through your smart home: flash / colour lights, play a chime and speak the
// message on a speaker, send a phone notification, run a script or scene (Home Assistant), or broadcast on Google
// Home speakers (Google Assistant through the bridge).
//
//   import { notify, stopAlert, alertsConfigured } from '../js/core/alerts.js';
//   const handle = await notify({ title: 'Timer done', message: 'Your 10 minute timer is up', level: 'alarm', source: 'timer' });
//   … later: stopAlert(handle)   // restores lights and speaker volume, stops repeating, clears the phone notification
//   level: 'info' (one gentle cue) | 'warn' (stronger) | 'alarm' (repeats every N s until stopped)
//   source: 'clock' | 'timer' | 'hourglass' | 'playtime' | 'books' | 'focus' | 'plants' | 'countdown' | 'drinks' | … (per-source on/off in Settings → Alerts)
//
// notify() never throws and resolves as soon as the alert has started (the smart-home calls carry on in the
// background); it resolves to null when nothing is set up, the source is off, it's quiet hours or rate-limited.
// The last results are kept for Settings → Alerts (alertLog(), alertEvents 'log').
import { Emitter } from './util.js';
import { store, DEFAULTS } from './store.js';
import { provider } from '../providers/registry.js';

export const LEVELS = [
  { id: 'info', name: 'Info', hint: 'a gentle cue' },
  { id: 'warn', name: 'Warning', hint: 'stronger' },
  { id: 'alarm', name: 'Alarm', hint: 'repeats until you stop it' },
];
/** What an alert can do; each level picks its own (Settings → Alerts). */
export const CHANNELS = [
  { id: 'lights', name: 'Lights' }, { id: 'sound', name: 'Speaker' }, { id: 'phone', name: 'Phone' },
  { id: 'script', name: 'Script' }, { id: 'gh', name: 'Google Home' },
];
/** Apps that alert (anything else is on unless switched off here). */
export const SOURCES = [
  { id: 'clock', name: 'Clock alarms' }, { id: 'timer', name: 'Timer' }, { id: 'hourglass', name: 'Hourglass' },
  { id: 'playtime', name: 'Play Time' }, { id: 'books', name: 'Bookmarks' }, { id: 'focus', name: 'Focus' },
  { id: 'plants', name: 'Plants & Pets' }, { id: 'countdown', name: 'Countdowns' }, { id: 'drinks', name: 'Drinking Games' },
];
export const CHIME_URL = new URL('../../sounds/alert-chime.wav', import.meta.url).href;

export const alertEvents = new Emitter();   // 'log' (entry) — a result was added / updated; 'change' — alerts started / stopped

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what = 'timed out') => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what)), ms))]);
const errText = (e) => String(e?.userMessage || e?.body?.message || e?.message || e || 'failed').slice(0, 140);
const hexRgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); const n = m ? parseInt(m[1], 16) : 0xef4444; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// ------------------------------------------------------------------ settings
/** The alert settings with every default filled in. */
export function alertConfig() {
  const d = DEFAULTS.alerts, s = store.get('alerts') || {};
  return {
    ...d, ...s,
    colors: { ...d.colors, ...(s.colors || {}) },
    levels: { ...d.levels, ...(s.levels || {}) },
    sources: { ...d.sources, ...(s.sources || {}) },
    lights: Array.isArray(s.lights) ? s.lights : d.lights,
  };
}
export function setAlertConfig(patch) { store.set('alerts', { ...(store.get('alerts') || {}), ...patch }); }

const hass = () => { try { return provider('homeassistant'); } catch { return null; } };
const haReady = () => { const ha = hass(); return !!(ha && ha.url && ha.isAuthed?.()); };

/** True when at least one smart-home action is set up (and alerts are on). */
export function alertsConfigured() {
  try {
    const c = alertConfig();
    if (!c.on) return false;
    if (c.gh) return true;
    return haReady() && !!(c.lights.length || c.speaker || c.notify || c.script);
  } catch { return false; }
}

/** Minutes since midnight → inside the quiet hours? */
export function inQuietHours(c = alertConfig(), now = new Date()) {
  if (!c.quiet) return false;
  const m = now.getHours() * 60 + now.getMinutes(), a = c.quietFrom, b = c.quietTo;
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

// ------------------------------------------------------------------ log (for Settings → Alerts)
const LOG = [];
export const alertLog = () => LOG.slice();
function logEntry(entry) {
  LOG.unshift(entry);
  LOG.length = Math.min(LOG.length, 20);
  alertEvents.emit('log', entry);
  return entry;
}
function logResult(entry, action, ok, detail = '') {
  if (!entry) return;
  const r = entry.results.find((x) => x.action === action);
  if (r) Object.assign(r, { ok, detail }); else entry.results.push({ action, ok, detail });
  alertEvents.emit('log', entry);
}

// ------------------------------------------------------------------ Home Assistant helpers (reuse the app's HA connection)
async function haConnected() {
  const ha = hass();
  if (!ha || !ha.url || !ha.isAuthed?.()) throw new Error('Home Assistant isn’t set up');
  if (ha.status !== 'ready' || !ha.mode) await withTimeout(ha.connect(), 12000, 'Home Assistant didn’t answer');
  return ha;
}
let svcCache = null;
/** { domain: { service: {…} } } — what this Home Assistant can do (cached 5 min). */
export async function haServices({ fresh = false } = {}) {
  if (!fresh && svcCache && Date.now() - svcCache.at < 300000) return svcCache.map;
  const ha = await haConnected();
  let map = {};
  if (ha.mode === 'ws') map = (await ha._send({ type: 'get_services' })) || {};
  else for (const d of (await ha._rest('/api/services')) || []) map[d.domain] = d.services || {};
  svcCache = { at: Date.now(), map };
  return map;
}
/** Entities and services the Alerts settings choose from. */
export async function haChoices() {
  const ha = await haConnected();
  const services = await haServices().catch(() => ({}));
  const all = [...ha.states.values()];
  const named = (s) => ({ id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, state: s.state });
  const of = (dom) => all.filter((s) => s.entity_id.startsWith(dom + '.')).map(named).sort((a, b) => a.name.localeCompare(b.name));
  return {
    lights: of('light'),
    speakers: of('media_player'),
    scripts: [...of('script'), ...of('scene')],
    tts: ttsEngines(ha, services),
    notify: Object.keys(services.notify || {}).filter((n) => n !== 'send_message').sort()
      .map((n) => ({ id: n, name: n.startsWith('mobile_app_') ? `${n.slice(11).replace(/_/g, ' ')} · phone app` : n.replace(/_/g, ' ') })),
  };
}
/** TTS engines: tts.* entities (tts.speak) first, then legacy tts.*_say services. */
function ttsEngines(ha, services) {
  const out = [];
  const tts = services.tts || {};
  if (tts.speak) for (const s of ha.states.values()) if (s.entity_id.startsWith('tts.')) out.push({ id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, kind: 'entity' });
  for (const n of Object.keys(tts)) if (n.endsWith('_say')) out.push({ id: `tts.${n}`, name: n.replace(/_say$/, '').replace(/_/g, ' '), kind: 'say' });
  return out;
}

// ------------------------------------------------------------------ lights: snapshot, pulse, restore
// Lights under an alert remember their state before the first alert touched them; they're restored when the
// last alert using them is done (so two overlapping alerts don't "restore" to the other alert's colour).
const owned = new Map();   // entity_id → { snap, users: Set<handle> }
const COLOUR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];
const hasColour = (s) => (s?.attributes?.supported_color_modes || []).some((m) => COLOUR_MODES.includes(m)) || !!s?.attributes?.rgb_color;

function restoreCall(st) {
  if (!st || st.state === 'unavailable' || st.state === 'unknown') return null;
  if (st.state !== 'on') return ['turn_off', {}];
  const a = st.attributes || {}, d = {};
  if (a.brightness != null) d.brightness = a.brightness;
  const m = a.color_mode;
  if (m === 'color_temp' || (!m && (a.color_temp_kelvin || a.color_temp) && !a.hs_color)) {
    if (a.color_temp_kelvin) d.color_temp_kelvin = a.color_temp_kelvin; else if (a.color_temp) d.color_temp = a.color_temp;
  } else if (m === 'xy' && a.xy_color) d.xy_color = a.xy_color;
  else if (m === 'rgbw' && a.rgbw_color) d.rgbw_color = a.rgbw_color;
  else if (m === 'rgbww' && a.rgbww_color) d.rgbww_color = a.rgbww_color;
  else if (m === 'rgb' && a.rgb_color) d.rgb_color = a.rgb_color;
  else if (a.hs_color) d.hs_color = a.hs_color;
  else if (a.rgb_color) d.rgb_color = a.rgb_color;
  return ['turn_on', d];
}
function claimLights(ha, ids, hnd) {
  for (const id of ids) {
    const o = owned.get(id);
    if (o) o.users.add(hnd);
    else owned.set(id, { snap: structuredClone(ha.entity(id)), users: new Set([hnd]) });
  }
}
async function releaseLights(hnd) {
  const ha = hass();
  const jobs = [];
  for (const [id, o] of owned) {
    if (!o.users.delete(hnd) || o.users.size) continue;
    owned.delete(id);
    const call = restoreCall(o.snap);
    if (call && ha) jobs.push(ha.call('light', call[0], id, call[1]));
  }
  const res = await Promise.allSettled(jobs);
  const bad = res.find((r) => r.status === 'rejected');
  if (bad) throw bad.reason;
  return jobs.length;
}
/** Turn the lights to the alert colour (colour lights) / full brightness (the rest). */
async function lightsOn(ha, ids, rgb) {
  const col = ids.filter((id) => hasColour(ha.entity(id))), plain = ids.filter((id) => !col.includes(id));
  await Promise.all([
    col.length && ha.call('light', 'turn_on', col, { rgb_color: rgb, brightness: 255, transition: 0 }),
    plain.length && ha.call('light', 'turn_on', plain, { brightness: 255, transition: 0 }),
  ].filter(Boolean));
}
/** One burst of the chosen light style. Resolves when it's over (or the alert was stopped). */
async function lightBurst(ha, hnd, c) {
  const ids = c.lights, rgb = hexRgb(c.colors[hnd.level]);
  if (c.lightStyle === 'flash') {
    const col = ids.filter((id) => hasColour(ha.entity(id))), plain = ids.filter((id) => !col.includes(id));
    const flash = hnd.level === 'info' ? 'short' : 'long';
    await Promise.all([
      col.length && ha.call('light', 'turn_on', col, { rgb_color: rgb, flash }),
      plain.length && ha.call('light', 'turn_on', plain, { flash }),
    ].filter(Boolean));
    await waitOrStop(hnd, flash === 'short' ? 2500 : 6000);
    return;
  }
  if (c.lightStyle === 'solid') { await lightsOn(ha, ids, rgb); await waitOrStop(hnd, hnd.level === 'info' ? 4000 : 8000); return; }
  // pulse: colour on / off a few times
  const n = { info: 2, warn: 3, alarm: 4 }[hnd.level] || 3;
  for (let i = 0; i < n && !hnd.stopped; i++) {
    await lightsOn(ha, ids, rgb);
    if (await waitOrStop(hnd, 700)) break;
    await ha.call('light', 'turn_off', ids, { transition: 0 });
    if (await waitOrStop(hnd, 450)) break;
  }
  if (hnd.level === 'alarm' && !hnd.stopped) await lightsOn(ha, ids, rgb);   // alarms stay lit in the colour between bursts
}
/** Sleep that ends early when the alert is stopped; resolves true when stopped. */
function waitOrStop(hnd, ms) {
  if (hnd.stopped) return Promise.resolve(true);
  return new Promise((res) => {
    const t = setTimeout(() => { hnd.wakers.delete(done); res(false); }, ms);
    const done = () => { clearTimeout(t); res(true); };
    hnd.wakers.add(done);
  });
}

// ------------------------------------------------------------------ speaker: volume, chime, speech, resume
const ANNOUNCE = 1048576, SEEK = 2, PLAY = 16384, SELECT_SOURCE = 2048;   // media_player supported_features bits
/** Our own sounds on the speaker (the chime, Home Assistant TTS) — never something to "resume". */
const isAlertMedia = (id, c = alertConfig()) => { id = String(id || ''); return !!id && (/alert-chime|media-source:\/\/tts|\/api\/tts_proxy\//.test(id) || (!!c.chimeUrl && id === c.chimeUrl)); };
// What a speaker was doing before the first alert used it (overlapping alerts share it, like the lights).
const spOwned = new Map();   // entity_id → { snap, users: Set<handle> }
function speakerSnap(st) {
  if (!st) return null;
  const a = st.attributes || {};
  let position = Number(a.media_position);
  if (Number.isFinite(position) && st.state === 'playing' && a.media_position_updated_at) {
    const at = Date.parse(a.media_position_updated_at);
    if (Number.isFinite(at)) position += Math.max(0, Math.min(6 * 3600, (Date.now() - at) / 1000));
  }
  return {
    state: st.state, contentId: a.media_content_id || '', contentType: a.media_content_type || '', app: a.app_name || a.app_id || '',
    source: a.source || '', volume: a.volume_level ?? null, position: Number.isFinite(position) ? position : null,
    duration: Number(a.media_duration) || 0, title: a.media_title || '', features: Number(a.supported_features) || 0,
  };
}
function claimSpeaker(ha, sp, hnd) {
  if (hnd.spClaimed) return;
  hnd.spClaimed = sp;
  const o = spOwned.get(sp);
  if (o) o.users.add(hnd); else spOwned.set(sp, { snap: speakerSnap(ha.entity(sp)), users: new Set([hnd]) });
}
const spWasPlaying = (sp) => { const s = spOwned.get(sp)?.snap; return !!s && s.state === 'playing' && !isAlertMedia(s.contentId); };
async function waitFor(cond, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (cond()) return true; await sleep(250); }
  return cond();
}
/**
 * The alert interrupted music on the speaker → try to get it back, most gentle first: the integration resumed it by
 * itself (announce) → media_play (Sonos, Spotify Connect, many others) → play_media with the saved content (+ seek)
 * → select_source (the app / input it was on). Resolves to what worked; throws when nothing did.
 */
async function resumeMedia(ha, sp, snap) {
  const cur = () => ha.entity(sp);
  const back = () => { const s = cur(); return s?.state === 'playing' && !isAlertMedia(s.attributes?.media_content_id); };
  const feat = Number(cur()?.attributes?.supported_features) || snap.features;
  const can = (bit) => !feat || (feat & bit) === bit;
  if (await waitFor(back, 1500)) return 'it carried on by itself';
  const tried = [];
  const attempt = async (what, fn, ms) => {
    try { await fn(); } catch (e) { tried.push(`${what}: ${errText(e)}`); return false; }
    if (await waitFor(back, ms)) return true;
    tried.push(`${what}: didn’t start`); return false;
  };
  // 1) plain "play" — only when the speaker still holds what it was playing (paused, or the same content loaded):
  //    otherwise it could just replay our chime / speech (a Cast speaker keeps the last thing it played)
  const curId = cur()?.attributes?.media_content_id;
  if (can(PLAY) && (cur()?.state === 'paused' || (!!curId && curId === snap.contentId))
    && await attempt('play', () => ha.call('media_player', 'media_play', sp), 4000)) return 'resumed (play)';
  // 2) the same content again, then back to where it was
  if (snap.contentId && await attempt('play_media', () => ha.call('media_player', 'play_media', sp, { media_content_id: snap.contentId, media_content_type: snap.contentType || 'music' }), 6000)) {
    if (snap.position > 5 && (!snap.duration || snap.position < snap.duration - 3) && can(SEEK)) {
      try { await ha.call('media_player', 'media_seek', sp, { seek_position: Math.round(snap.position) }); } catch {}
    }
    return `restarted ${snap.title ? `“${String(snap.title).slice(0, 40)}”` : 'what was playing'}`;
  }
  // 3) the app / input it was on
  if (snap.source && can(SELECT_SOURCE) && await attempt('source', async () => {
    await ha.call('media_player', 'select_source', sp, { source: snap.source });
    await sleep(1500);
    if (!back()) await ha.call('media_player', 'media_play', sp).catch(() => {});
  }, 6000)) return `back to ${snap.source}`;
  throw new Error(tried.length ? `couldn’t resume — ${tried.join('; ')}` : 'couldn’t resume (the speaker can’t say what it was playing)');
}
/** The last alert using this speaker is done → resume what it was playing (Settings → Alerts → Resume). Never throws. */
async function releaseSpeaker(hnd) {
  const sp = hnd.spClaimed, o = sp && spOwned.get(sp);
  if (!o || !o.users.delete(hnd) || o.users.size) return;
  spOwned.delete(sp);
  const ha = hass(), snap = o.snap;
  if (!ha || !alertConfig().resume || !snap || snap.state !== 'playing' || isAlertMedia(snap.contentId)) return;
  try { logResult(hnd.entry, 'Resume', true, await resumeMedia(ha, sp, snap)); }
  catch (e) { console.warn('[alerts] resume', e); logResult(hnd.entry, 'Resume', false, errText(e)); }
}

async function speak(ha, hnd, c, entry, first) {
  const sp = c.speaker;
  if (!sp) throw new Error('no speaker chosen');
  if (first) { claimSpeaker(ha, sp, hnd); hnd.usedSpeaker = sp; }
  if (first && c.volume != null) {
    const st = ha.entity(sp);
    if (hnd.prevVolume === undefined) hnd.prevVolume = st?.attributes?.volume_level ?? null;
    await ha.call('media_player', 'volume_set', sp, { volume_level: Math.max(0, Math.min(1, c.volume / 100)) });
  }
  hnd.usedSpeaker = sp;
  let est = 0;
  const did = [];
  if (c.chime) {
    // speakers that can "announce" play the chime over the music and carry on afterwards by themselves
    const announce = c.resume && spWasPlaying(sp) && (Number(ha.entity(sp)?.attributes?.supported_features) & ANNOUNCE) === ANNOUNCE;
    await ha.call('media_player', 'play_media', sp, { media_content_id: c.chimeUrl || CHIME_URL, media_content_type: 'music', ...(announce ? { announce: true } : {}) });
    did.push('chime'); est = 2600;
    if (c.speech && await waitOrStop(hnd, 2600)) return 'stopped';
  }
  if (c.speech && !hnd.stopped) {
    const text = [hnd.title, hnd.message].filter(Boolean).join('. ');
    const services = await haServices().catch(() => ({}));
    const engines = ttsEngines(ha, services);
    const eng = engines.find((e) => e.id === c.tts) || engines[0];
    if (!eng) { if (!did.length) throw new Error('no text-to-speech in Home Assistant'); }
    else {
      if (eng.kind === 'entity') await ha.call('tts', 'speak', eng.id, { media_player_entity_id: sp, message: text, cache: true });
      else await ha.call('tts', eng.id.slice(4), sp, { message: text });
      did.push(`speech (${eng.name})`); est = 1500 + text.length * 75;
    }
  }
  hnd.soundUntil = Date.now() + est;
  return did.join(' + ') || 'nothing to play';
}
/** Put the speaker volume back. */
async function restoreVolume(hnd) {
  if (hnd.prevVolume === undefined || hnd.volumeRestored) return;
  const ha = hass(), sp = hnd.usedSpeaker || alertConfig().speaker;
  if (!ha || !sp) return;
  hnd.volumeRestored = true;
  if (hnd.prevVolume != null) await ha.call('media_player', 'volume_set', sp, { volume_level: hnd.prevVolume });
}
/** After the chime / speech: wait until the speaker is done (estimated time, then until our sound stops; at most +10 s),
 *  put the volume back, then resume what it was playing. Never throws. */
async function afterSound(hnd, { now = false } = {}) {
  const ha = hass(), sp = hnd.usedSpeaker;
  if (!ha || !sp) return;
  if (!now) {
    await sleep(Math.max(0, (hnd.soundUntil || 0) - Date.now()) + 800);
    const until = Date.now() + 10000;
    const ours = () => { const s = ha.entity(sp), id = s?.attributes?.media_content_id; return s?.state === 'playing' && (!id || isAlertMedia(id)); };
    while (Date.now() < until && ours() && !hnd.volumeRestored) await sleep(500);
  }
  try { await restoreVolume(hnd); } catch (e) { console.warn('[alerts] volume', e); }
  await releaseSpeaker(hnd);
}

// ------------------------------------------------------------------ phone, script, Google Home
function phoneData(hnd) {
  const tag = `round-remote-${hnd.source}`;
  if (hnd.level === 'alarm') return { tag, group: 'round-remote', priority: 'high', ttl: 0, channel: 'alarm_stream', importance: 'high', push: { sound: { name: 'default', critical: 1, volume: 1.0 }, 'interruption-level': 'time-sensitive' } };
  if (hnd.level === 'warn') return { tag, group: 'round-remote', priority: 'high', ttl: 0, push: { 'interruption-level': 'time-sensitive' } };
  return { tag, group: 'round-remote' };
}
async function phone(ha, hnd, c) {
  if (!c.notify) throw new Error('no phone notification service chosen');
  await ha.call('notify', c.notify, null, { title: hnd.title, message: hnd.message || hnd.title, data: phoneData(hnd) });
  hnd.phoneSent = c.notify;
  return `notify.${c.notify}`;
}
async function runScript(ha, hnd, c) {
  if (!c.script) throw new Error('no script or scene chosen');
  if (c.script.startsWith('scene.')) await ha.call('scene', 'turn_on', c.script);
  else await ha.call('script', 'turn_on', c.script, { variables: { title: hnd.title, message: hnd.message, level: hnd.level, source: hnd.source } });
  return c.script;
}
async function googleBroadcast(hnd) {
  const gh = provider('googlehome');
  if (!gh?.ask) throw new Error('Google Home isn’t available');
  const text = [hnd.title, hnd.message].filter(Boolean).join(': ');
  const r = await withTimeout(gh.ask(`broadcast ${text}`), 30000, 'Google Assistant didn’t answer');
  return r?.text ? `“${String(r.text).slice(0, 60)}”` : 'broadcast sent';
}

// ------------------------------------------------------------------ notify / stop
const active = new Set();
const recent = new Map();   // dedupe key → { at, hnd }
let stamps = [];            // rate limit: times of recent alerts
let seq = 0;
export const activeAlerts = () => [...active];

/**
 * Get the user's attention through the smart home. Never throws.
 * opts: { title, message, level: 'info' | 'warn' | 'alarm', source: app id, test: true (ignores source & quiet hours) }
 * Resolves to a handle for stopAlert(), or null when nothing was done.
 */
export async function notify(opts = {}) {
  try {
    const level = LEVELS.some((l) => l.id === opts.level) ? opts.level : 'info';
    const source = String(opts.source || 'app');
    const title = String(opts.title || 'Round Remote').slice(0, 120);
    const message = String(opts.message || '').slice(0, 300);
    const c = alertConfig();
    const base = { at: Date.now(), title, message, level, source, results: [] };
    if (!c.on) return null;
    if (!opts.test && c.sources[source] === false) { logEntry({ ...base, skipped: `off for ${SOURCES.find((s) => s.id === source)?.name || source}` }); return null; }
    if (!opts.test && inQuietHours(c) && !(level === 'alarm' && c.quietAlarms)) { logEntry({ ...base, skipped: 'quiet hours' }); return null; }
    const chans = (c.levels[level] || []).filter((ch) => (ch === 'gh' ? c.gh : ch === 'lights' ? c.lights.length : ch === 'sound' ? c.speaker && (c.chime || c.speech) : ch === 'phone' ? c.notify : ch === 'script' ? c.script : false));
    const haChans = chans.filter((ch) => ch !== 'gh');
    if (!chans.length || (!haChans.length && !c.gh) || (haChans.length && !haReady() && !chans.includes('gh'))) return null;
    // rate limit: the same alert again within 5 s → the running one; at most 12 alerts a minute
    const key = `${source}|${level}|${title}`;
    const prev = recent.get(key);
    if (prev && Date.now() - prev.at < 5000) return prev.hnd && !prev.hnd.stopped ? prev.hnd : null;
    stamps = stamps.filter((t) => Date.now() - t < 60000);
    if (stamps.length >= 12) { logEntry({ ...base, skipped: 'too many alerts — slowing down' }); return null; }
    stamps.push(Date.now());

    const hnd = { id: ++seq, level, source, title, message, stopped: false, wakers: new Set(), timers: [], entry: null };
    for (const [k, v] of recent) if (Date.now() - v.at > 60000) recent.delete(k);
    recent.set(key, { at: Date.now(), hnd });
    hnd.entry = logEntry({ ...base, id: hnd.id, results: chans.map((ch) => ({ action: CHANNELS.find((x) => x.id === ch).name, ok: null, detail: '…' })) });
    active.add(hnd);
    alertEvents.emit('change');
    run(hnd, c, chans);
    return hnd;
  } catch (e) {
    console.warn('[alerts] notify failed', e);
    return null;
  }
}

/** Do one alert's actions (first time: everything; repeats: lights + speaker). */
async function run(hnd, c, chans, first = true) {
  const entry = hnd.entry;
  const step = async (ch, fn) => {
    const name = CHANNELS.find((x) => x.id === ch).name;
    try { const d = await fn(); if (first) logResult(entry, name, true, d || 'done'); }
    catch (e) { console.warn(`[alerts] ${ch}`, e); logResult(entry, name, false, errText(e)); }
  };
  let ha = null;
  const needHa = chans.some((ch) => ch !== 'gh');
  if (needHa) { try { ha = await haConnected(); } catch (e) { for (const ch of chans.filter((x) => x !== 'gh')) logResult(entry, CHANNELS.find((x) => x.id === ch).name, false, errText(e)); } }
  if (hnd.stopped) return;
  const jobs = [];
  if (ha && chans.includes('lights')) jobs.push(step('lights', async () => {
    if (first) claimLights(ha, c.lights, hnd);
    await lightBurst(ha, hnd, c);
    if (hnd.level !== 'alarm' || hnd.stopped) { const n = await releaseLights(hnd); return `${c.lightStyle} · ${c.lights.length} light${c.lights.length > 1 ? 's' : ''} · ${n ? `restored ${n}` : 'another alert restores them'}`; }
    return `${c.lightStyle} · ${c.lights.length} light${c.lights.length > 1 ? 's' : ''} · restored when stopped`;
  }));
  if (ha && chans.includes('sound')) jobs.push(step('sound', async () => {
    try { return await speak(ha, hnd, c, entry, first); }
    finally { if (hnd.level !== 'alarm') afterSound(hnd).catch((e) => console.warn('[alerts] after sound', e)); }
  }));
  if (first && ha && chans.includes('phone')) jobs.push(step('phone', () => phone(ha, hnd, c)));
  if (first && ha && chans.includes('script')) jobs.push(step('script', () => runScript(ha, hnd, c)));
  if (first && chans.includes('gh')) jobs.push(step('gh', () => googleBroadcast(hnd)));
  hnd.busy = Promise.allSettled(jobs);
  await hnd.busy;
  if (hnd.level !== 'alarm') { finish(hnd); return; }
  // alarms: again every N s until stopped (lights + speaker), and give up after 20 minutes
  if (first) hnd.timers.push(setTimeout(() => stopAlert(hnd), 20 * 60000));
  const again = (Number(c.repeatSec) || 0) * 1000;
  if (again && !hnd.stopped) {
    const rep = chans.filter((ch) => ch === 'lights' || ch === 'sound');
    if (rep.length) hnd.timers.push(setTimeout(() => { if (!hnd.stopped) { hnd.repeats = (hnd.repeats || 0) + 1; logResult(entry, 'Repeats', true, String(hnd.repeats)); run(hnd, c, rep, false); } }, again));
  }
}
function finish(hnd) {
  if (!active.delete(hnd)) return;
  hnd.done = true;
  alertEvents.emit('change');
}

/** Stop an alert: no more repeats, lights back as they were, speaker volume back, phone notification cleared. Never throws. */
export async function stopAlert(hnd) {
  if (!hnd || hnd.stopped) return;
  try {
    hnd.stopped = true;
    hnd.timers.forEach(clearTimeout); hnd.timers = [];
    hnd.wakers.forEach((w) => w()); hnd.wakers.clear();
    finish(hnd);
    await withTimeout(hnd.busy || Promise.resolve(), 3000).catch(() => {});   // let a light / speaker call in flight land first
    const ha = hass();
    const jobs = [];
    jobs.push(releaseLights(hnd).then((n) => { if (n) logResult(hnd.entry, 'Lights', true, `stopped · restored ${n}`); }));
    if (hnd.usedSpeaker && ha && hnd.level === 'alarm') {
      const st = ha.entity(hnd.usedSpeaker);
      const stop = st?.state === 'playing' && isAlertMedia(st?.attributes?.media_content_id) ? ha.call('media_player', 'media_stop', hnd.usedSpeaker) : Promise.resolve();
      // volume back + resume in the background (resuming can take a few seconds)
      stop.catch((e) => console.warn('[alerts] stop speaker', e)).then(() => afterSound(hnd, { now: true })).catch(() => {});
    }
    if (hnd.phoneSent?.startsWith('mobile_app_') && hnd.level === 'alarm' && ha) jobs.push(ha.call('notify', hnd.phoneSent, null, { message: 'clear_notification', data: { tag: `round-remote-${hnd.source}` } }));
    const res = await Promise.allSettled(jobs);
    for (const r of res) if (r.status === 'rejected') console.warn('[alerts] stop', r.reason);
    if (hnd.entry) { hnd.entry.stoppedAt = Date.now(); alertEvents.emit('log', hnd.entry); }
  } catch (e) { console.warn('[alerts] stopAlert failed', e); }
}
