// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Home Assistant helpers shared by Plants & Pets (soil-moisture sensors), Focus (a scene or light colour per phase)
// and Sleep Sounds (dim the lights slowly). They reuse the app's own Home Assistant connection
// (js/providers/homeassistant.js) and never throw at the caller unless noted.
import { provider } from '../js/providers/registry.js';

export const ha = () => { try { return provider('homeassistant'); } catch { return null; } };
export const haReady = () => { const x = ha(); return !!(x && x.url && x.isAuthed?.()); };
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Home Assistant didn’t answer')), ms))]);

/** The connected service (throws when it isn't set up / doesn't answer). */
export async function haConn() {
  const x = ha();
  if (!haReady()) throw new Error('Home Assistant isn’t set up');
  if (x.status !== 'ready' || !x.mode) await withTimeout(x.connect(), 12000);
  return x;
}
/** [{ id, name, state, unit }] for these domains (sorted by name). */
export async function entities(domains = ['light'], filter = null) {
  const x = await haConn();
  return [...x.states.values()]
    .filter((s) => domains.includes(s.entity_id.split('.')[0]) && (!filter || filter(s)))
    .map((s) => ({ id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, state: s.state, unit: s.attributes?.unit_of_measurement || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export const entityName = (id) => { const s = ha()?.entity?.(id); return s?.attributes?.friendly_name || String(id || '').split('.').pop()?.replace(/_/g, ' ') || ''; };
/** A sensor's number (or null when unknown). */
export function sensorValue(id) {
  const s = ha()?.entity?.(id);
  const v = parseFloat(s?.state);
  return Number.isFinite(v) ? v : null;
}
/** Soil-moisture-ish sensors first (device_class moisture / humidity, or % unit). */
export const moistureFilter = (s) => {
  const a = s.attributes || {};
  return a.device_class === 'moisture' || a.device_class === 'humidity' || a.unit_of_measurement === '%' || /moist|soil/i.test(s.entity_id + (a.friendly_name || ''));
};
export async function haCall(domain, service, ids, data = {}) {
  try { const x = await haConn(); await x.call(domain, service, ids, data); return true; } catch (e) { console.warn('[ha]', domain, service, e); return false; }
}
export const sceneOn = (id) => (id ? haCall(id.split('.')[0] === 'script' ? 'script' : 'scene', 'turn_on', id) : Promise.resolve(false));
export const hexRgb = (hex) => { const n = parseInt(String(hex || '#ffffff').slice(1), 16) || 0xffffff; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** Lights to a colour and brightness (%). Lights without colour just get the brightness. */
export async function lightsColour(ids, hex, pct = 60) {
  if (!ids?.length) return false;
  try {
    const x = await haConn();
    const col = ids.filter((id) => (x.entity(id)?.attributes?.supported_color_modes || []).some((m) => ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(m)));
    const plain = ids.filter((id) => !col.includes(id));
    await Promise.all([
      col.length && x.call('light', 'turn_on', col, { rgb_color: hexRgb(hex), brightness_pct: pct, transition: 2 }),
      plain.length && x.call('light', 'turn_on', plain, { brightness_pct: pct, transition: 2 }),
    ].filter(Boolean));
    return true;
  } catch (e) { console.warn('[ha] lights', e); return false; }
}
/** Remember lights as they are, to put them back later. */
export function snapLights(ids) {
  const x = ha();
  return (ids || []).map((id) => { const s = x?.entity?.(id); return s ? { id, state: s.state, a: { ...(s.attributes || {}) } } : null; }).filter(Boolean);
}
export async function restoreLights(snap) {
  const x = ha();
  if (!x || !snap?.length) return;
  await Promise.allSettled(snap.map(({ id, state, a }) => {
    if (state !== 'on') return x.call('light', 'turn_off', id, {});
    const d = {};
    if (a.brightness != null) d.brightness = a.brightness;
    if (a.color_mode === 'color_temp' && a.color_temp_kelvin) d.color_temp_kelvin = a.color_temp_kelvin;
    else if (a.rgb_color) d.rgb_color = a.rgb_color;
    return x.call('light', 'turn_on', id, d);
  }));
}

/**
 * Dim lights slowly to off: `minutes` long, a step every `stepSec` (each step a short HA transition so it's smooth).
 * Returns { cancel(), steps, done: Promise }. Lights that are off stay off.
 */
export function rampLights(ids, { minutes = 10, stepSec = 30, off = true } = {}) {
  const x = ha();
  const state = { cancelled: false, step: 0, steps: Math.max(1, Math.round((minutes * 60) / stepSec)), calls: 0 };
  const start = {};
  for (const id of ids || []) { const s = x?.entity?.(id); if (s?.state === 'on') start[id] = s.attributes?.brightness ?? 255; }
  const live = Object.keys(start);
  let timer = 0, resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const tick = async () => {
    if (state.cancelled) return;
    state.step++;
    const f = 1 - state.step / state.steps;
    if (f <= 0) {
      if (off && live.length) { state.calls++; await haCall('light', 'turn_off', live, { transition: Math.min(stepSec, 10) }); }
      resolveDone(true);
      return;
    }
    await Promise.allSettled(live.map((id) => { state.calls++; return haCall('light', 'turn_on', id, { brightness: Math.max(1, Math.round(start[id] * f)), transition: Math.min(stepSec, 30) }); }));
    timer = setTimeout(tick, stepSec * 1000);
  };
  if (!live.length) resolveDone(false); else timer = setTimeout(tick, 50);
  return { state, done, cancel() { state.cancelled = true; clearTimeout(timer); resolveDone(false); }, get lights() { return live; } };
}
