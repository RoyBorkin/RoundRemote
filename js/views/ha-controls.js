// Home Assistant on a round screen: entity tiles, quick actions, and a round control panel per device
// (brightness / temperature / position / speed / volume dials, colours, modes, cameras, sensors).
import { h, clear, onLongPress } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openPanel, toast } from '../ui/overlay.js';
import { store } from '../core/store.js';
import { angleFromCenter, clamp, throttle } from '../core/util.js';
import { domainOf } from '../providers/homeassistant.js';

const errMsg = (e) => e?.userMessage || e?.message || 'Something went wrong';
const ON_STATES = ['on', 'open', 'opening', 'closing', 'playing', 'paused', 'unlocked', 'unlocking', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only', 'cleaning', 'returning', 'home', 'triggered'];
const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// ---------------------------------------------------------------- presentation
export function entityIcon(s) {
  const d = domainOf(s.entity_id), dc = s.attributes?.device_class || '';
  const on = isOn(s);
  const byDomain = {
    light: 'bulb', switch: dc === 'outlet' ? 'bolt' : 'toggle', input_boolean: 'toggle', fan: 'fan', climate: 'thermostat', cover: dc === 'garage' || dc === 'door' || dc === 'gate' ? 'door' : dc === 'window' ? 'window' : 'blinds',
    lock: s.state === 'unlocked' ? 'lockOpen' : 'lock', media_player: dc === 'tv' ? 'tv' : 'speaker', scene: 'sparkle', script: 'play', automation: 'refresh', button: 'play', input_button: 'play',
    vacuum: 'robot', camera: 'camera', alarm_control_panel: 'shield', humidifier: 'drop', water_heater: 'thermostat', person: 'person', weather: /rain|pour/.test(s.state) ? 'drop' : /cloud|fog/.test(s.state) ? 'cloud' : s.state === 'clear-night' ? 'moon' : 'sun',
    valve: 'drop', siren: 'megaphone',
  };
  if (d === 'sensor' || d === 'binary_sensor') {
    return { temperature: 'thermostat', humidity: 'drop', moisture: 'drop', power: 'bolt', energy: 'bolt', battery: 'bolt', voltage: 'bolt', current: 'bolt', door: 'door', garage_door: 'door',
      window: 'window', opening: 'door', motion: 'walk', occupancy: 'walk', presence: 'person', illuminance: 'sun', lock: on ? 'lockOpen' : 'lock', smoke: 'shield', gas: 'shield', safety: 'shield' }[dc] || 'gauge';
  }
  return byDomain[d] || 'gauge';
}
export function isOn(s) {
  if (!s) return false;
  const d = domainOf(s.entity_id);
  if (d === 'sensor' || d === 'weather' || d === 'scene' || d === 'button' || d === 'input_button') return false;
  if (d === 'climate' || d === 'water_heater') return s.state !== 'off' && s.state !== 'unavailable';
  if (d === 'alarm_control_panel') return s.state.startsWith('armed') || s.state === 'triggered';
  return ON_STATES.includes(s.state);
}
export function tileColor(s) {
  const d = domainOf(s.entity_id), a = s.attributes || {};
  if (!isOn(s)) return '';
  if (d === 'light' && Array.isArray(a.rgb_color)) return `rgb(${a.rgb_color.join(',')})`;
  if (d === 'light') return '#ffc861';
  if (d === 'climate') return s.state === 'cool' || a.hvac_action === 'cooling' ? '#4db6ff' : s.state === 'heat' || a.hvac_action === 'heating' ? '#ff8a3d' : '#7ee0a6';
  if (d === 'lock') return '#ff6b6b';
  if (d === 'alarm_control_panel') return s.state === 'triggered' ? '#ff3b3b' : '#ffb13d';
  if (d === 'binary_sensor') return '#ffb13d';
  return 'var(--accent)';
}
const num = (v, digits = 1) => { const n = +v; return Number.isFinite(n) ? (Math.round(n * 10 ** digits) / 10 ** digits).toString() : v; };
export function stateText(s) {
  if (!s) return '';
  const d = domainOf(s.entity_id), a = s.attributes || {};
  if (s.state === 'unavailable') return 'Unavailable';
  if (d === 'light') return s.state === 'on' ? (a.brightness != null ? `${Math.round((a.brightness / 255) * 100)}%` : 'On') : 'Off';
  if (d === 'climate') return `${a.current_temperature != null ? `${num(a.current_temperature)}°` : ''}${a.temperature != null && s.state !== 'off' ? ` → ${num(a.temperature)}°` : s.state === 'off' ? ' · Off' : ''}`.trim();
  if (d === 'cover') return a.current_position != null && s.state !== 'closed' ? `${pretty(s.state)} · ${a.current_position}%` : pretty(s.state);
  if (d === 'fan') return s.state === 'on' && a.percentage != null ? `${a.percentage}%` : pretty(s.state);
  if (d === 'media_player') return a.media_title ? `${a.media_title}${a.media_artist ? ` · ${a.media_artist}` : ''}` : pretty(s.state);
  if (d === 'sensor') return `${num(s.state)}${a.unit_of_measurement ? ` ${a.unit_of_measurement}` : ''}`;
  if (d === 'binary_sensor') {
    const dc = a.device_class;
    const words = { door: ['Closed', 'Open'], window: ['Closed', 'Open'], opening: ['Closed', 'Open'], garage_door: ['Closed', 'Open'], motion: ['Clear', 'Motion'], occupancy: ['Clear', 'Detected'], presence: ['Away', 'Home'], moisture: ['Dry', 'Wet'], smoke: ['Clear', 'Smoke!'], lock: ['Locked', 'Unlocked'], battery: ['Normal', 'Low'], connectivity: ['Offline', 'Online'] }[dc];
    return words ? words[s.state === 'on' ? 1 : 0] : pretty(s.state);
  }
  if (d === 'weather') return `${pretty(s.state)}${a.temperature != null ? ` · ${num(a.temperature)}${a.temperature_unit || '°'}` : ''}`;
  if (d === 'vacuum') return `${pretty(s.state)}${a.battery_level != null ? ` · ${a.battery_level}%` : ''}`;
  if (d === 'person') return s.state === 'home' ? 'Home' : s.state === 'not_home' ? 'Away' : pretty(s.state);
  if (d === 'scene' || d === 'script' || d === 'button' || d === 'input_button') return d === 'script' && s.state === 'on' ? 'Running' : '';
  if (d === 'humidifier') return s.state === 'on' && a.humidity != null ? `${a.humidity}%` : pretty(s.state);
  return pretty(s.state);
}

// ---------------------------------------------------------------- quick action (tap on a tile)
export function quickAction(hass, s) {
  const d = domainOf(s.entity_id), id = s.entity_id;
  if (s.state === 'unavailable') return null;
  if (['light', 'switch', 'input_boolean', 'fan', 'humidifier', 'siren'].includes(d)) return hass.call(d, 'toggle', id);
  if (d === 'cover') return hass.call('cover', 'toggle', id);
  if (d === 'valve') return hass.call('valve', s.state === 'open' ? 'close_valve' : 'open_valve', id);
  if (d === 'scene') return hass.call('scene', 'turn_on', id);
  if (d === 'script') return hass.call('script', 'turn_on', id);
  if (d === 'button' || d === 'input_button') return hass.call(d, 'press', id);
  if (d === 'media_player') return hass.call('media_player', 'media_play_pause', id);
  if (d === 'lock') return hass.call('lock', s.state === 'locked' ? 'unlock' : 'lock', id);
  if (d === 'vacuum') return hass.call('vacuum', s.state === 'cleaning' ? 'return_to_base' : 'start', id);
  return null; // climate, sensors, cameras… → open the panel
}

// ---------------------------------------------------------------- tile
/** A round tile: tap the circle for the quick action, tap the name (or hold) for the full control. */
export function entityTile(hass, id, { onOpen, editing = false, isFav = false, onFav } = {}) {
  const orb = h('button.sh-orb', { type: 'button' });
  const name = h('div.sh-name'), st = h('div.sh-state');
  const star = editing ? h('span.sh-star', { html: icon(isFav ? 'star' : 'starOutline') }) : null;
  const el = h(`div.sh-tile${editing ? '.editing' : ''}`, orb, h('button.sh-label', { type: 'button' }, name, st), star);
  const paint = () => {
    const s = hass.entity(id);
    if (!s) { el.hidden = true; return; }
    el.hidden = false;
    const c = tileColor(s);
    orb.innerHTML = icon(entityIcon(s));
    orb.classList.toggle('on', isOn(s));
    orb.classList.toggle('na', s.state === 'unavailable');
    if (c) orb.style.setProperty('--tc', c); else orb.style.removeProperty('--tc');
    const pic = domainOf(id) === 'person' || domainOf(id) === 'camera' ? hass.picture(s) : '';
    orb.style.backgroundImage = pic ? `url("${pic}")` : '';
    orb.classList.toggle('pic', !!pic);
    name.textContent = hass.entityName(s);
    st.textContent = stateText(s);
  };
  paint();
  const open = () => onOpen?.(id);
  if (editing) {
    const flip = (e) => { e.stopPropagation(); onFav?.(id); };
    orb.onclick = flip; el.querySelector('.sh-label').onclick = flip;
  } else {
    let held = false;
    orb.onclick = async (e) => {
      e.stopPropagation();
      if (held) { held = false; return; }   // the long press already opened the panel
      const s = hass.entity(id);
      const p = s && quickAction(hass, s);
      if (!p) { open(); return; }
      orb.classList.add('busy');
      navigator.vibrate?.(8);
      try { await p; } catch (err) { toast(errMsg(err), { kind: 'error' }); }
      setTimeout(() => orb.classList.remove('busy'), 350);
    };
    el.querySelector('.sh-label').onclick = (e) => { e.stopPropagation(); open(); };
    onLongPress(orb, () => { held = true; open(); });
  }
  return { el, paint, id };
}

// ---------------------------------------------------------------- round dial
/** 270° dial. Returns { el, set(v) }. onInput fires while dragging (throttled), onCommit when released. */
export function dial({ min = 0, max = 100, step = 1, value = 0, color = 'var(--accent)', fmt = (v) => `${v}`, sub = '', onCommit, onInput }) {
  const SWEEP = 270, R = 40, CIRC = 2 * Math.PI * R, ARC = CIRC * (SWEEP / 360);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.classList.add('ha-dial');
  svg.style.setProperty('--dc', color);
  svg.innerHTML = `
    <circle class="hd-track" cx="50" cy="50" r="${R}" stroke-dasharray="${ARC} ${CIRC}" transform="rotate(135 50 50)"/>
    <circle class="hd-fill" cx="50" cy="50" r="${R}" stroke-dasharray="0 ${CIRC}" transform="rotate(135 50 50)"/>
    <circle class="hd-knob" cx="50" cy="10" r="3.6"/>`;
  const fill = svg.querySelector('.hd-fill'), knob = svg.querySelector('.hd-knob');
  const big = h('div.hd-val'), small = h('div.hd-sub', sub);
  const center = h('div.hd-center', big, small);
  const el = h('div.hd', svg, center);
  let val = value, drag = false, lastA = null;
  const snap = (v) => clamp(Math.round((v - min) / step) * step + min, min, max);
  const draw = () => {
    const f = max > min ? (val - min) / (max - min) : 0;
    fill.setAttribute('stroke-dasharray', `${(ARC * f).toFixed(2)} ${CIRC}`);
    const a = ((-135 + SWEEP * f) * Math.PI) / 180;
    knob.setAttribute('cx', (50 + R * Math.sin(a)).toFixed(2));
    knob.setAttribute('cy', (50 - R * Math.cos(a)).toFixed(2));
    big.textContent = fmt(val);
  };
  const input = throttle((v) => onInput?.(v), 250);
  const fromEvent = (e) => {
    let a = (angleFromCenter(svg, e.clientX, e.clientY) * 180) / Math.PI;
    if (lastA != null && Math.abs(a - lastA) > 200) return;
    lastA = a;
    a = clamp(a, -135, 135);
    const v = snap(min + ((a + 135) / SWEEP) * (max - min));
    if (v !== val) { val = v; draw(); input(val); }
  };
  svg.addEventListener('pointerdown', (e) => { e.stopPropagation(); drag = true; lastA = null; svg.setPointerCapture(e.pointerId); fromEvent(e); });
  svg.addEventListener('pointermove', (e) => drag && fromEvent(e));
  const end = () => { if (!drag) return; drag = false; onCommit?.(val); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => { e.preventDefault(); val = snap(val + (e.deltaY < 0 ? step : -step)); draw(); onCommit?.(val); }, { passive: false });
  draw();
  return {
    el, center, get value() { return val; },
    set(v, subText) { if (!drag && v != null && Number.isFinite(+v)) { val = snap(+v); draw(); } if (subText != null) small.textContent = subText; },
    setColor(c) { svg.style.setProperty('--dc', c); },
  };
}

// ---------------------------------------------------------------- the control panel
const KELVIN = [{ k: 2700, name: 'Warm', c: '#ffb46b' }, { k: 4000, name: 'Neutral', c: '#fff1dc' }, { k: 6000, name: 'Cool', c: '#dbe9ff' }];
const COLORS = [[255, 60, 60], [255, 150, 30], [255, 225, 60], [80, 220, 100], [60, 150, 255], [170, 90, 255], [255, 90, 190]];

export function openEntity(hass, id) {
  const s0 = hass.entity(id);
  if (!s0) return;
  const d = domainOf(id);
  openPanel({
    title: hass.entityName(s0), className: `ha-panel.ha-${d}`,
    build(body, panel) {
      const call = (svc, data = {}, domain = d) => hass.call(domain, svc, id, data).catch((e) => toast(errMsg(e), { kind: 'error' }));
      const favs = () => store.get('haFavorites') || [];
      const star = h('button.ibtn.small.ha-star', { type: 'button', 'aria-label': 'Favourite' });
      const paintStar = () => { star.innerHTML = icon(favs().includes(id) ? 'star' : 'starOutline'); star.classList.toggle('on', favs().includes(id)); };
      star.onclick = (e) => { e.stopPropagation(); const f = favs(); store.set('haFavorites', f.includes(id) ? f.filter((x) => x !== id) : [...f, id]); paintStar(); };
      paintStar();
      const stateLine = h('div.ha-stateline');
      body.append(star, stateLine);
      let update = () => {};
      const s = () => hass.entity(id) || s0;
      const bigToggle = (label = 'Turn on / off', svc = 'toggle') => {
        const b = h('button.ha-big', { type: 'button', 'aria-label': label });
        b.onclick = (e) => { e.stopPropagation(); call(svc); };
        body.append(b);
        return (st) => { b.innerHTML = icon(entityIcon(st)); b.classList.toggle('on', isOn(st)); const c = tileColor(st); if (c) b.style.setProperty('--tc', c); else b.style.removeProperty('--tc'); };
      };
      const row = (...kids) => { const r = h('div.ha-row', kids); body.append(r); return r; };
      const chip = (label, onClick, on = false) => h(`button.chip${on ? '.on' : ''}`, { type: 'button', onclick: (e) => { e.stopPropagation(); onClick(); } }, label);
      const a = () => s().attributes || {};

      if (d === 'light') {
        const modes = a().supported_color_modes || [];
        const dim = modes.some((m) => m !== 'onoff') || a().brightness != null;
        if (dim) {
          const dl = dial({ min: 1, max: 100, value: a().brightness ? Math.round((a().brightness / 255) * 100) : 0, fmt: (v) => (s().state === 'on' ? `${v}%` : 'Off'), sub: 'Brightness',
            onInput: (v) => call('turn_on', { brightness_pct: v }), onCommit: (v) => call('turn_on', { brightness_pct: v }) });
          const pw = h('button.ibtn.small.ha-power', { type: 'button', 'aria-label': 'On / off', html: icon('power') });
          pw.onclick = (e) => { e.stopPropagation(); call('toggle'); };
          dl.center.append(pw);
          body.append(dl.el);
          const sw = row();
          const kel = modes.includes('color_temp');
          const col = modes.some((m) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m));
          if (kel) KELVIN.forEach((k) => sw.append(h('button.ha-swatch', { type: 'button', 'aria-label': k.name, title: k.name, style: { background: k.c }, onclick: (e) => { e.stopPropagation(); call('turn_on', { color_temp_kelvin: clamp(k.k, a().min_color_temp_kelvin || 2000, a().max_color_temp_kelvin || 6500) }); } })));
          if (col) COLORS.forEach((c) => sw.append(h('button.ha-swatch', { type: 'button', 'aria-label': 'Colour', style: { background: `rgb(${c.join(',')})` }, onclick: (e) => { e.stopPropagation(); call('turn_on', { rgb_color: c }); } })));
          if (!kel && !col) sw.remove();
          update = (st) => { const at = st.attributes || {}; dl.set(at.brightness ? Math.round((at.brightness / 255) * 100) : 1); dl.setColor(tileColor(st) || 'rgba(255,255,255,.3)'); pw.classList.toggle('on', st.state === 'on'); };
        } else update = bigToggle();
      } else if (d === 'climate' || d === 'water_heater') {
        const at = a();
        const unit = at.temperature_unit || '°';
        const dl = dial({ min: at.min_temp ?? 7, max: at.max_temp ?? 35, step: at.target_temp_step || (unit.includes('F') ? 1 : 0.5), value: at.temperature ?? at.current_temperature ?? 20,
          fmt: (v) => `${num(v)}°`, sub: at.current_temperature != null ? `Now ${num(at.current_temperature)}°` : '',
          onCommit: (v) => call('set_temperature', { temperature: v }) });
        body.append(dl.el);
        const modes = at.hvac_modes || at.operation_list || [];
        const mr = row();
        const paintModes = (st) => { clear(mr); modes.slice(0, 6).forEach((m) => mr.append(chip(pretty(m), () => call(d === 'climate' ? 'set_hvac_mode' : 'set_operation_mode', d === 'climate' ? { hvac_mode: m } : { operation_mode: m }), st.state === m))); };
        update = (st) => {
          const t = st.attributes || {};
          dl.set(t.temperature, `${t.current_temperature != null ? `Now ${num(t.current_temperature)}°` : ''}${t.hvac_action ? ` · ${pretty(t.hvac_action)}` : ''}`);
          dl.setColor(tileColor(st) || 'rgba(255,255,255,.35)');
          paintModes(st);
        };
      } else if (d === 'cover' || d === 'valve') {
        if (a().current_position != null) {
          const dl = dial({ min: 0, max: 100, value: a().current_position, fmt: (v) => `${v}%`, sub: 'Open', onCommit: (v) => call(d === 'cover' ? 'set_cover_position' : 'set_valve_position', { position: v }) });
          body.append(dl.el);
          update = (st) => dl.set(st.attributes?.current_position);
        } else update = bigToggle();
        const svc = d === 'cover' ? ['open_cover', 'stop_cover', 'close_cover'] : ['open_valve', 'stop_valve', 'close_valve'];
        row(chip('Open', () => call(svc[0])), chip('Stop', () => call(svc[1])), chip('Close', () => call(svc[2])));
      } else if (d === 'fan' || d === 'humidifier') {
        const key = d === 'fan' ? 'percentage' : 'humidity';
        if (a()[key] != null || d === 'humidifier') {
          const dl = dial({ min: d === 'fan' ? 0 : (a().min_humidity ?? 0), max: d === 'fan' ? 100 : (a().max_humidity ?? 100), step: d === 'fan' ? (a().percentage_step || 1) : 1, value: a()[key] ?? 0,
            fmt: (v) => `${Math.round(v)}%`, sub: d === 'fan' ? 'Speed' : 'Target humidity',
            onCommit: (v) => call(d === 'fan' ? 'set_percentage' : 'set_humidity', d === 'fan' ? { percentage: v } : { humidity: v }) });
          const pw = h('button.ibtn.small.ha-power', { type: 'button', 'aria-label': 'On / off', html: icon('power') });
          pw.onclick = (e) => { e.stopPropagation(); call('toggle'); };
          dl.center.append(pw);
          body.append(dl.el);
          update = (st) => { dl.set(st.attributes?.[key]); pw.classList.toggle('on', st.state === 'on'); };
        } else update = bigToggle();
        if (d === 'fan' && a().oscillating != null) row(chip('Oscillate', () => call('oscillate', { oscillating: !a().oscillating }), a().oscillating));
      } else if (d === 'media_player') {
        const art = h('div.ha-art');
        const title = h('div.ha-media-title'), artist = h('div.ha-media-sub');
        const dl = dial({ min: 0, max: 100, value: Math.round((a().volume_level ?? 0) * 100), fmt: (v) => `${v}`, sub: 'Volume', onCommit: (v) => call('volume_set', { volume_level: v / 100 }), onInput: (v) => call('volume_set', { volume_level: v / 100 }) });
        body.append(art, dl.el, h('div.ha-media', title, artist));
        const pp = h('button.ibtn.ha-pp', { type: 'button', 'aria-label': 'Play / pause' });
        pp.onclick = (e) => { e.stopPropagation(); call('media_play_pause'); };
        row(h('button.ibtn.small', { type: 'button', 'aria-label': 'Previous', html: icon('prev'), onclick: (e) => { e.stopPropagation(); call('media_previous_track'); } }), pp,
          h('button.ibtn.small', { type: 'button', 'aria-label': 'Next', html: icon('next'), onclick: (e) => { e.stopPropagation(); call('media_next_track'); } }),
          h('button.ibtn.small', { type: 'button', 'aria-label': 'Power', html: icon('power'), onclick: (e) => { e.stopPropagation(); call(s().state === 'off' ? 'turn_on' : 'turn_off'); } }));
        update = (st) => {
          const t = st.attributes || {};
          const pic = hass.picture(st);
          art.style.backgroundImage = pic ? `url("${pic}")` : '';
          title.textContent = t.media_title || pretty(st.state); artist.textContent = [t.media_artist, t.app_name].filter(Boolean).join(' · ');
          pp.innerHTML = icon(st.state === 'playing' ? 'pause' : 'play');
          if (t.volume_level != null) dl.set(Math.round(t.volume_level * 100));
        };
      } else if (d === 'lock') {
        const b = h('button.ha-big', { type: 'button' });
        b.onclick = (e) => { e.stopPropagation(); call(s().state === 'locked' ? 'unlock' : 'lock'); };
        body.append(b);
        update = (st) => { b.innerHTML = icon(st.state === 'locked' ? 'lock' : 'lockOpen'); b.classList.toggle('on', st.state !== 'locked'); b.setAttribute('aria-label', st.state === 'locked' ? 'Unlock' : 'Lock'); };
      } else if (d === 'camera') {
        const img = h('div.ha-cam');
        body.append(img);
        const t = setInterval(() => { img.style.backgroundImage = `url("${hass.picture(s(), true)}")`; }, 2500);
        img.style.backgroundImage = `url("${hass.picture(s(), true)}")`;
        panel.onDestroy = () => clearInterval(t);
      } else if (d === 'vacuum') {
        update = bigToggle('Start / return', 'start');
        row(chip('Start', () => call('start')), chip('Pause', () => call('pause')), chip('Dock', () => call('return_to_base')), chip('Find', () => call('locate')));
      } else if (d === 'alarm_control_panel') {
        const b = h('div.ha-bigval');
        body.append(b);
        row(chip('Home', () => call('alarm_arm_home')), chip('Away', () => call('alarm_arm_away')), chip('Night', () => call('alarm_arm_night')), chip('Disarm', () => call('alarm_disarm')));
        update = (st) => { b.innerHTML = `${icon('shield')}<span>${pretty(st.state)}</span>`; b.classList.toggle('on', isOn(st)); };
      } else if (['scene', 'script', 'button', 'input_button'].includes(d)) {
        const b = h('button.ha-big.run', { type: 'button', 'aria-label': 'Run', html: icon(entityIcon(s0)) });
        b.onclick = (e) => { e.stopPropagation(); call(d === 'button' || d === 'input_button' ? 'press' : 'turn_on'); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 900); toast(`${hass.entityName(s())} ✓`); };
        body.append(b, h('div.ha-hint', 'Tap to run'));
      } else if (d === 'automation') {
        update = bigToggle('Enable / disable');
        row(chip('Run now', () => call('trigger')));
      } else if (['switch', 'input_boolean', 'siren'].includes(d)) {
        update = bigToggle();
      } else {
        // sensors, binary sensors, people, weather…: a big reading
        const b = h('div.ha-bigval');
        body.append(b);
        update = (st) => { b.innerHTML = `${icon(entityIcon(st))}<span>${stateText(st) || pretty(st.state)}</span>`; b.classList.toggle('on', isOn(st)); };
      }
      const paintLine = (st) => {
        const since = st.last_changed ? Math.round((Date.now() - new Date(st.last_changed)) / 60000) : null;
        const area = hass.areas.find((x) => x.id === hass.areaOf.get(id));
        stateLine.textContent = [area?.name, stateText(st) || pretty(st.state), since != null ? (since < 1 ? 'just now' : since < 60 ? `${since} min` : since < 1440 ? `${Math.round(since / 60)} h` : `${Math.round(since / 1440)} d`) : ''].filter(Boolean).join('  ·  ');
      };
      const all = () => { const st = s(); update(st); paintLine(st); };
      all();
      const off = hass.on('change', (eid) => { if (!eid || eid === id) all(); });
      const prev = panel.onDestroy;
      panel.onDestroy = () => { off(); prev?.(); };
    },
  });
}
