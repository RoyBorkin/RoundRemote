// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Home Assistant: live state of your home over its WebSocket API (a long-lived access token from your
// HA profile page), with areas (rooms), and service calls to control everything.
// When the app runs on https (GitHub Pages) and Home Assistant is plain http on your network, the browser
// can't open ws:// — then it talks REST through the bridge's LAN proxy and refreshes every 2 seconds.
import { Emitter, http, isMixed, qs, HttpError } from '../core/util.js';
import { store, pollMs } from '../core/store.js';
import { bridgeBase } from './bridge.js';

// What the round screen can show and control
export const DOMAINS = ['light', 'switch', 'input_boolean', 'fan', 'climate', 'cover', 'lock', 'media_player', 'scene', 'script', 'automation',
  'button', 'input_button', 'vacuum', 'camera', 'sensor', 'binary_sensor', 'alarm_control_panel', 'humidifier', 'water_heater', 'person', 'weather', 'valve', 'siren'];
export const CONTROLLABLE = ['light', 'switch', 'input_boolean', 'fan', 'climate', 'cover', 'lock', 'media_player', 'vacuum', 'humidifier', 'valve', 'siren', 'water_heater'];
export const ACTIONS = ['scene', 'script', 'automation', 'button', 'input_button'];
export const domainOf = (id) => String(id).split('.')[0];

export class HomeAssistantService extends Emitter {
  constructor(meta) {
    super();
    Object.assign(this, meta);
    this.states = new Map();       // entity_id → state object
    this.areas = [];               // [{ id, name }]
    this.areaOf = new Map();       // entity_id → area id
    this.hidden = new Set();       // hidden / config / diagnostic entities
    this.platformOf = new Map();   // entity_id → integration (e.g. androidtv_remote)
    this.deviceOf = new Map();     // entity_id → device id
    this.config = {};
    this.mode = null;              // 'ws' | 'rest'
    this.status = 'idle';
    this.ws = null; this.msgId = 1; this.pending = new Map(); this.pollT = null; this.retryT = null; this.users = 0;
  }
  get url() { return (store.get('haUrl') || '').trim().replace(/\/$/, ''); }
  get token() { return store.auth('homeassistant')?.token || ''; }
  setupHint() { return this.url ? '' : 'Enter your Home Assistant address'; }
  isAuthed() { return !!this.token && store.auth('homeassistant')?.url === this.url; }
  signOut() { store.setAuth('homeassistant', null); this.disconnect(); }
  saveToken(token) { store.setAuth('homeassistant', { token: token.trim(), url: this.url }); }

  _setStatus(s, msg = '') { this.status = s; this.statusMsg = msg; this.emit('status', s, msg); }

  // ---------- connection ----------
  /** Start (or join) the live connection. Returns when the first full state has arrived. */
  async connect() {
    this.users++;
    if (this.status === 'ready' || this.connecting) return this.connecting || true;
    this.connecting = this._open().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  release() { this.users = Math.max(0, this.users - 1); }
  disconnect() {
    clearTimeout(this.retryT); clearInterval(this.pollT);
    try { this.ws?.close(); } catch {}
    this.ws = null; this.mode = null; this._setStatus('idle');
  }
  async _open() {
    if (!this.url || !this.token) { this._setStatus('error', 'Set up Home Assistant first'); throw new Error('not set up'); }
    this._setStatus('connecting');
    const wsOk = !(location.protocol === 'https:' && this.url.startsWith('http:'));
    if (wsOk) {
      try { await this._openWs(); return true; } catch (e) {
        if (e.auth) { this._setStatus('error', e.message); throw e; }
      }
    }
    try { await this._openRest(); return true; } catch (e) {
      this._setStatus('error', e.userMessage || e.message);
      this.retryT = setTimeout(() => this._open().catch(() => {}), 15000);
      throw e;
    }
  }

  // ---------- WebSocket ----------
  _openWs() {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(`${this.url.replace(/^http/, 'ws')}/api/websocket`); } catch (e) { reject(e); return; }
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('Home Assistant didn’t answer')); }, 8000);
      let authed = false;
      ws.onmessage = async (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
        else if (m.type === 'auth_invalid') { clearTimeout(timer); reject(Object.assign(new Error('Home Assistant refused the token — make a new long-lived access token'), { auth: true })); ws.close(); }
        else if (m.type === 'auth_ok') {
          authed = true; this.ws = ws; this.mode = 'ws'; this.config.version = m.ha_version;
          try { await this._loadWs(); clearTimeout(timer); this._setStatus('ready'); resolve(); } catch (e) { clearTimeout(timer); reject(e); }
        } else if (m.type === 'result') {
          const p = this.pending.get(m.id); if (!p) return;
          this.pending.delete(m.id);
          if (m.success) p.resolve(m.result); else p.reject(new Error(m.error?.message || 'Home Assistant error'));
        } else if (m.type === 'event' && m.event?.event_type === 'state_changed') this._ingest(m.event.data);
      };
      ws.onerror = () => { if (!authed) { clearTimeout(timer); reject(new Error('Couldn’t open a WebSocket to Home Assistant')); } };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null; this.mode = null;
        for (const p of this.pending.values()) p.reject(new Error('connection closed'));
        this.pending.clear();
        this._setStatus('connecting', 'Reconnecting…');
        this.retryT = setTimeout(() => this._open().catch(() => {}), 3000);
      };
    });
  }
  _send(msg) {
    return new Promise((resolve, reject) => {
      if (!this.ws) { reject(new Error('Not connected')); return; }
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, ...msg }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('Home Assistant took too long')); } }, 15000);
    });
  }
  async _loadWs() {
    const [states, config, areas, ents, devs] = await Promise.all([
      this._send({ type: 'get_states' }), this._send({ type: 'get_config' }).catch(() => ({})),
      this._send({ type: 'config/area_registry/list' }).catch(() => []),
      this._send({ type: 'config/entity_registry/list' }).catch(() => []),
      this._send({ type: 'config/device_registry/list' }).catch(() => []),
    ]);
    this.config = { ...this.config, ...config };
    this.areas = (areas || []).map((a) => ({ id: a.area_id, name: a.name, icon: a.icon })).sort((a, b) => a.name.localeCompare(b.name));
    const devArea = new Map((devs || []).map((d) => [d.id, d.area_id]));
    this.areaOf.clear(); this.hidden.clear(); this.platformOf.clear(); this.deviceOf.clear();
    for (const e of ents || []) {
      if (e.platform) this.platformOf.set(e.entity_id, e.platform);
      if (e.device_id) this.deviceOf.set(e.entity_id, e.device_id);
      const area = e.area_id || devArea.get(e.device_id);
      if (area) this.areaOf.set(e.entity_id, area);
      if (e.hidden_by || e.disabled_by || e.entity_category) this.hidden.add(e.entity_id);
    }
    this.states = new Map((states || []).map((s) => [s.entity_id, s]));
    await this._send({ type: 'subscribe_events', event_type: 'state_changed' });
    this.emit('change', null);
  }
  _ingest({ entity_id, new_state }) {
    if (new_state) this.states.set(entity_id, new_state); else this.states.delete(entity_id);
    this.emit('change', entity_id);
  }

  // ---------- REST (through the bridge's LAN proxy when needed) ----------
  async _rest(path, { method = 'GET', json } = {}) {
    const full = this.url + path;
    let target = full;
    const opts = { method, json, headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } };
    // An https page can still call http:// Home Assistant on your network directly (Chrome's local network
    // access) when HA allows this page's address (http: cors_allowed_origins). Otherwise: the bridge.
    if (isMixed(full) && this.restRoute !== 'proxy') {
      try { const r = await http(full, opts); this.restRoute = 'direct'; return r; }
      catch (e) { if (e instanceof HttpError || this.restRoute === 'direct') throw e; }
    }
    if (isMixed(full)) {
      const b = this.proxy || (this.proxy = await bridgeBase());
      if (!b) throw Object.assign(new Error('mixed'), { userMessage: `This https page can’t reach http:// Home Assistant yet. Add ${location.origin} to cors_allowed_origins in Home Assistant (see README), use an https:// address (e.g. Nabu Casa), or run the bridge.` });
      target = `${b}/api/proxy?${qs({ url: full })}`;
      this.restRoute = 'proxy';
    }
    return http(target, opts);
  }
  async _openRest() {
    const cfg = await this._rest('/api/config').catch((e) => { throw Object.assign(e, { userMessage: e.status === 401 ? 'Home Assistant refused the token' : e.userMessage || 'Couldn’t reach Home Assistant' }); });
    this.config = cfg || {};
    this.mode = 'rest';
    await this._pollRest();
    try {
      const tpl = "{% set ns = namespace(out=[]) %}{% for a in areas() %}{% set ns.out = ns.out + [{'id': a, 'name': area_name(a), 'entities': area_entities(a)}] %}{% endfor %}{{ ns.out | tojson }}";
      const raw = await this._rest('/api/template', { method: 'POST', json: { template: tpl } });
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
      this.areas = list.map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name));
      this.areaOf.clear();
      for (const a of list) for (const e of a.entities || []) this.areaOf.set(e, a.id);
    } catch {}
    try {   // integrations the app uses directly (Google TV through Android TV Remote)
      const tpl = "{% set ns = namespace(out=[]) %}{% for e in integration_entities('androidtv_remote') %}{% set ns.out = ns.out + [[e, device_id(e)]] %}{% endfor %}{{ ns.out | tojson }}";
      const raw = await this._rest('/api/template', { method: 'POST', json: { template: tpl } });
      for (const [e, dev] of (typeof raw === 'string' ? JSON.parse(raw) : raw) || []) { this.platformOf.set(e, 'androidtv_remote'); if (dev) this.deviceOf.set(e, dev); }
    } catch {}
    this._setStatus('ready');
    this.emit('change', null);
    clearInterval(this.pollT);
    this.pollT = setInterval(() => this._pollRest().catch(() => {}), Math.max(1500, pollMs()));
  }
  async _pollRest() {
    const list = await this._rest('/api/states');
    const changed = [];
    for (const s of list || []) {
      const old = this.states.get(s.entity_id);
      if (!old || old.last_updated !== s.last_updated) { this.states.set(s.entity_id, s); changed.push(s.entity_id); }
    }
    if (changed.length) this.emit('change', changed.length === 1 ? changed[0] : null);
  }

  // ---------- control ----------
  async call(domain, service, entityId, data = {}) {
    if (this.mode === 'ws') return this._send({ type: 'call_service', domain, service, service_data: data, target: entityId ? { entity_id: entityId } : undefined });
    const r = await this._rest(`/api/services/${domain}/${service}`, { method: 'POST', json: { ...(entityId ? { entity_id: entityId } : {}), ...data } });
    setTimeout(() => this._pollRest().catch(() => {}), 400);
    return r;
  }
  /** Image URL for an entity picture (camera snapshot, album art, person photo). */
  picture(state, bust = false) {
    const p = state?.attributes?.entity_picture;
    if (!p) return '';
    const full = /^https?:/.test(p) ? p : this.url + p;
    const url = bust ? `${full}${full.includes('?') ? '&' : '?'}_=${Date.now()}` : full;
    if (isMixed(url) && this.proxy) return `${this.proxy}/api/proxy?${qs({ url })}`;
    return url;
  }

  // ---------- model helpers ----------
  entity(id) { return this.states.get(id) || null; }
  /** Entity ids from one integration, e.g. 'androidtv_remote'. */
  entitiesOf(platform) { return [...this.platformOf].filter(([, p]) => p === platform).map(([e]) => e); }
  visible(filter = () => true) {
    return [...this.states.values()].filter((s) => DOMAINS.includes(domainOf(s.entity_id)) && !this.hidden.has(s.entity_id)
      && !s.attributes?.hidden && filter(s));
  }
  inArea(areaId) { return this.visible((s) => this.areaOf.get(s.entity_id) === areaId); }
  entityName(s) {
    let n = s?.attributes?.friendly_name || s?.entity_id || '';
    // "Living Room Lamp" inside "Living Room" → "Lamp"
    const area = this.areas.find((a) => a.id === this.areaOf.get(s?.entity_id));
    if (area && n.toLowerCase().startsWith(area.name.toLowerCase() + ' ') && n.length > area.name.length + 2) n = n.slice(area.name.length + 1);
    return n;
  }
  /** Sensible default favourites: controllable things first, a few per room. */
  suggested(max = 12) {
    const order = ['light', 'climate', 'cover', 'fan', 'switch', 'lock', 'media_player', 'vacuum'];
    return this.visible((s) => order.includes(domainOf(s.entity_id)) && s.state !== 'unavailable')
      .sort((a, b) => order.indexOf(domainOf(a.entity_id)) - order.indexOf(domainOf(b.entity_id)))
      .slice(0, max).map((s) => s.entity_id);
  }
  async test() {
    this.disconnect();
    await this._open();
    return { name: this.config.location_name || 'Home', version: this.config.version, mode: this.mode, count: this.states.size };
  }
}

