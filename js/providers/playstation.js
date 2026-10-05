// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// PlayStation (Home → PlayStation): your PSN profile, presence, the game you're playing, recent games,
// trophies and friends online — all through the bridge (bridge/adapters/psn.js signs in with an NPSSO token
// and keeps the PSN tokens). Console wake / standby goes through Home Assistant (ps5-mqtt add-on or the
// PlayStation 4 integration) when it has your console, otherwise through `playactor` on the bridge.
//
// BridgeConsoleService is shared with Steam (js/providers/steam.js): polls the bridge's summary politely —
// every 20 s while a console screen is open, never in the background — and keeps the last answer cached.
import { Emitter } from '../core/util.js';
import { store } from '../core/store.js';
import { bridgeFetch } from './bridge.js';
import { provider } from './registry.js';
import { domainOf } from './homeassistant.js';

const POLL_MS = 20000;
const errText = (e) => e?.body?.error || e?.userMessage || e?.message || 'Something went wrong';

export class BridgeConsoleService extends Emitter {
  constructor(meta, adapter) {
    super();
    Object.assign(this, meta);
    this.adapter = adapter;
    this.data = null;          // last summary from the bridge
    this.error = null;         // { kind: 'bridge' | 'signin' | 'adapter' | 'other', message }
    this.loading = false;
    this.users = 0; this.timer = null;
    this._vis = () => { if (!document.hidden && this.users) this._loop(); };
  }
  setupHint() { return ''; }
  /** Signed in (as far as this display knows; the bridge is asked on the setup page and by every refresh). */
  isAuthed() { return !!store.auth(this.id)?.linked; }
  markLinked(name = '') { store.setAuth(this.id, { linked: true, name }); }
  api(action, opts) { return bridgeFetch(`/api/adapters/${this.adapter}/${action}`, opts); }
  status() { return this.api('status'); }
  async signOut() {
    store.setAuth(this.id, null); this.data = null;
    await this.api('signout', { method: 'POST', json: {} }).catch(() => {});
  }

  /** Fetch the summary now. */
  async refresh() {
    this.loading = true; this.emit('change');
    try {
      const d = await this.api('summary', { timeout: 30000 });
      if (!d?.signedIn) {
        this.error = { kind: 'signin', message: d?.error || 'Not signed in' };
        if (this.isAuthed()) store.setAuth(this.id, null);
      } else {
        this.data = d; this.error = null;
        if (!this.isAuthed()) this.markLinked(d.profile?.onlineId || d.profile?.name || '');
      }
    } catch (e) {
      const msg = errText(e);
      const offline = e instanceof TypeError || e?.name === 'AbortError' || /failed to fetch|networkerror|load failed/i.test(msg);
      this.error = offline || /bridge not (found|reachable)/i.test(msg) ? { kind: 'bridge', message: 'Bridge not reachable — is the bridge running?' }
        : /unknown adapter action/i.test(msg) || e.status === 404 ? { kind: 'adapter', message: `This bridge has no ${this.name} support yet — update the bridge (bridge/adapters/${this.adapter}.js) and restart it.` }
          : { kind: 'other', message: msg };
    }
    this.loading = false;
    this.emit('change');
    return this.data;
  }
  _loop() {
    clearTimeout(this.timer);
    if (!this.users || document.hidden) return;
    this.refresh().finally(() => { if (this.users) this.timer = setTimeout(() => this._loop(), POLL_MS); });
    this.extraPoll?.();
  }
  /** A screen is showing this service: poll while it's open. */
  start() {
    if (this.users++ === 0) { document.addEventListener('visibilitychange', this._vis); this._loop(); }
  }
  stop() {
    if (--this.users > 0) return;
    this.users = 0; clearTimeout(this.timer); document.removeEventListener('visibilitychange', this._vis);
    this.onStop?.();
  }
}

// ---------------------------------------------------------------- console power
const CONSOLE_RE = /\b(ps5|ps4|playstation)|ps5_|ps4_/i;
/** Home Assistant entities that can wake / rest a PlayStation: ps5-mqtt / PlayStation2MQTT power switches, the PS4 integration. */
export function haConsoles(hass) {
  if (!hass || hass.status !== 'ready') return [];
  const out = [];
  for (const s of hass.states.values()) {
    const d = domainOf(s.entity_id), plat = hass.platformOf.get(s.entity_id);
    const txt = `${s.entity_id} ${s.attributes?.friendly_name || ''}`;
    if (plat === 'playstation_network') continue;   // the PSN integration shows presence but can't power the console
    if (d === 'switch' && CONSOLE_RE.test(txt)) out.push({ s, score: /power/i.test(txt) ? 3 : 2 });
    else if (d === 'media_player' && (plat === 'ps4' || (CONSOLE_RE.test(txt) && ((s.attributes?.supported_features || 0) & 384)))) out.push({ s, score: 1 });
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.s);
}
const haPower = (s) => (!s || ['unavailable', 'unknown'].includes(s.state) ? 'unknown' : ['off', 'standby'].includes(s.state) ? 'standby' : 'awake');

export class PlayStationService extends BridgeConsoleService {
  constructor(meta) {
    super(meta, 'psn');
    this.power = null;      // { via: 'ha' | 'playactor', state: 'awake' | 'standby' | 'unknown' | 'unreachable', entity?, name? }
    this.hass = null; this.offHa = null;
  }
  async extraPoll() {
    // Home Assistant first (live), the bridge's playactor otherwise
    const hass = provider('homeassistant');
    if (hass?.isAuthed() && !hass.setupHint()) {
      if (!this.hass) {
        this.hass = hass;
        this.offHa = hass.on('change', () => this._haPower());
        await Promise.race([hass.connect().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
      }
      if (this._haPower()) return;
    }
    try {
      const c = await this.api('console');
      this.power = c?.available ? { via: 'playactor', state: c.state } : null;
    } catch { this.power = null; }
    this.emit('power');
  }
  _haPower() {
    const s = haConsoles(this.hass)[0];
    if (!s) { if (this.power?.via === 'ha') { this.power = null; this.emit('power'); } return false; }
    const next = { via: 'ha', entity: s.entity_id, name: s.attributes?.friendly_name || 'PlayStation', state: haPower(s) };
    if (JSON.stringify(next) !== JSON.stringify(this.power)) { this.power = next; this.emit('power'); }
    return true;
  }
  onStop() { this.offHa?.(); this.offHa = null; if (this.hass) { this.hass.release(); this.hass = null; } }
  /** wake | standby */
  async setPower(action) {
    const p = this.power;
    if (!p) throw new Error('No way to control the console');
    if (p.via === 'ha') {
      const d = domainOf(p.entity);
      await this.hass.call(d, action === 'wake' ? 'turn_on' : 'turn_off', p.entity);
    } else {
      await this.api('console', { method: 'POST', json: { action }, timeout: 50000 });
      setTimeout(() => this.extraPoll(), 4000);
    }
    this.power = { ...p, state: action === 'wake' ? 'awake' : 'standby' };
    this.emit('power');
  }
}
