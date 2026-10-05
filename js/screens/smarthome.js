// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Home category: smart-home screens.
//   • Home Assistant — Favourites / Rooms / Scenes with round tiles and round control panels
//   • Google Home   — Google Assistant commands (tiles you choose, ask anything, broadcast) and your speakers
import { h, iconBtn, onCircle, clear, onLongPress } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openPanel, toast, spinner, emptyNote } from '../ui/overlay.js';
import { editText, field } from '../ui/keyboard.js';
import { store } from '../core/store.js';
import { go } from '../core/router.js';
import { getService, provider } from '../providers/registry.js';
import { bridgeFetch, bridgeZones } from '../providers/bridge.js';
import { domainOf, CONTROLLABLE, ACTIONS } from '../providers/homeassistant.js';
import { entityTile, openEntity, isOn } from '../views/ha-controls.js';

const errMsg = (e) => e?.userMessage || e?.body?.error || e?.message || 'Something went wrong';

export function SmartHomeScreen({ id }) {
  const svc = getService(id);
  const p = provider(id);
  return id === 'googlehome' ? GoogleHomeScreen(svc, p) : HassScreen(svc, p);
}

function frame(svc, tabsDef, rightBtn) {
  const tabs = h('div.m-tabs.sh-tabs', tabsDef.map(([k, label]) => h('button.m-tab', { type: 'button', dataset: { k } }, label)));
  const home = onCircle(iconBtn('home', 'Home menu', () => go('home')), -42, 38.5);
  const status = h('div.sh-status');
  const body = h('div.sh-body');
  const el = h('div.sh', { '--c': svc.color }, h('div.sh-glow'), tabs, home, rightBtn, status, body);
  return { el, tabs, status, body };
}

// ================================================================ Home Assistant
function HassScreen(svc, hass) {
  const editBtn = onCircle(iconBtn('edit', 'Choose favourites', () => { editing = !editing; editBtn.innerHTML = icon(editing ? 'check' : 'edit'); if (editing) setTab('fav'); else render(); }), 42, 38.5);
  const { el, tabs, status, body } = frame(svc, [['fav', 'Favourites'], ['rooms', 'Rooms'], ['scenes', 'Scenes']], editBtn);
  let tab = store.get('haTab') || 'fav', room = null, editing = false, tiles = [], lastView = '';
  const favs = () => store.get('haFavorites') || [];
  const toggleFav = (id) => { const f = favs(); store.set('haFavorites', f.includes(id) ? f.filter((x) => x !== id) : [...f, id]); render(); };
  const open = (id) => openEntity(hass, id);

  const grid = (ids, opts = {}) => {
    const g = h('div.sh-grid');
    for (const id of ids) {
      const t = entityTile(hass, id, { onOpen: open, editing, isFav: favs().includes(id), onFav: toggleFav, ...opts });
      tiles.push(t); g.append(t.el);
    }
    return g;
  };
  const sortIds = (list) => list.sort((a, b) => {
    const order = [...CONTROLLABLE, ...ACTIONS, 'camera', 'binary_sensor', 'sensor', 'person', 'weather'];
    return order.indexOf(domainOf(a.entity_id)) - order.indexOf(domainOf(b.entity_id)) || hass.entityName(a).localeCompare(hass.entityName(b));
  }).map((s) => s.entity_id);

  function setTab(t) { tab = t; room = null; store.set('haTab', t); render(); }
  tabs.querySelectorAll('.m-tab').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); if (editing && b.dataset.k !== 'fav') { editing = false; editBtn.innerHTML = icon('edit'); } setTab(b.dataset.k); }; });

  function render() {
    tabs.querySelectorAll('.m-tab').forEach((b) => b.classList.toggle('on', b.dataset.k === tab));
    const view = `${tab}|${room}|${editing}`;
    const top = view === lastView ? body.scrollTop : 0;
    lastView = view;
    clear(body); tiles = [];
    if (hass.status !== 'ready') {
      body.append(hass.status === 'error'
        ? emptyNote(hass.statusMsg || 'Couldn’t connect to Home Assistant', { label: 'Setup', onClick: () => go('connect', { id: svc.id }) })
        : spinner('Connecting to Home Assistant…'));
      return;
    }
    el.classList.toggle('editing', editing);
    if (tab === 'fav') {
      if (editing) {
        body.append(h('div.sh-hint', 'Tap to add or remove favourites'));
        const groups = [...hass.areas.map((a) => [a.name, hass.inArea(a.id)]), ['Other', hass.visible((s) => !hass.areaOf.has(s.entity_id))]];
        for (const [name, list] of groups) {
          const ids = sortIds(list.filter((s) => domainOf(s.entity_id) !== 'sensor' || s.attributes?.device_class));
          if (!ids.length) continue;
          body.append(h('div.sh-sec', name), grid(ids));
        }
      } else {
        let ids = favs().filter((x) => hass.entity(x));
        if (!ids.length) { ids = hass.suggested(); body.append(h('div.sh-hint', 'Suggestions — tap ✎ to choose your favourites')); }
        body.append(grid(ids));
        if (!ids.length) body.append(emptyNote('No devices found in Home Assistant'));
      }
    } else if (tab === 'rooms') {
      if (room) {
        const a = hass.areas.find((x) => x.id === room);
        const list = room === '_other' ? hass.visible((s) => !hass.areaOf.has(s.entity_id)) : hass.inArea(room);
        const lightsOn = list.filter((s) => ['light', 'switch'].includes(domainOf(s.entity_id)) && s.state === 'on');
        body.append(h('div.sh-roomhead',
          h('button.chip', { type: 'button', onclick: (e) => { e.stopPropagation(); room = null; render(); } }, '‹ Rooms'),
          h('div.sh-roomname', a?.name || 'Other'),
          lightsOn.length ? h('button.chip', { type: 'button', onclick: async (e) => { e.stopPropagation(); for (const s of lightsOn) hass.call(domainOf(s.entity_id), 'turn_off', s.entity_id).catch(() => {}); toast('All off'); } }, 'All off') : h('span')));
        body.append(grid(sortIds(list)));
      } else {
        const rooms = [...hass.areas, { id: '_other', name: 'Other' }];
        for (const a of rooms) {
          const list = a.id === '_other' ? hass.visible((s) => !hass.areaOf.has(s.entity_id) && CONTROLLABLE.includes(domainOf(s.entity_id))) : hass.inArea(a.id);
          if (!list.length) continue;
          const on = list.filter((s) => ['light', 'switch', 'fan', 'media_player'].includes(domainOf(s.entity_id)) && isOn(s)).length;
          const temp = list.find((s) => s.attributes?.device_class === 'temperature' && domainOf(s.entity_id) === 'sensor')
            || list.find((s) => domainOf(s.entity_id) === 'climate');
          const t = temp ? (domainOf(temp.entity_id) === 'climate' ? temp.attributes.current_temperature : temp.state) : null;
          const sub = [on ? `${on} on` : 'All off', t != null && t !== '' && !Number.isNaN(+t) ? `${Math.round(+t * 10) / 10}°` : '', `${list.length} devices`].filter(Boolean).join(' · ');
          body.append(h('button.row.sh-room', { type: 'button', onclick: (e) => { e.stopPropagation(); room = a.id; render(); body.scrollTop = 0; } },
            h('div.row-art.placeholder.sh-roomicon', { html: icon('house') }), h('div.row-text', h('div.row-title', a.name), h('div.row-sub', sub)), h('span.mrow-go', { html: icon('chevron') })));
        }
      }
    } else {
      const ids = sortIds(hass.visible((s) => ACTIONS.includes(domainOf(s.entity_id))));
      body.append(ids.length ? grid(ids) : emptyNote('No scenes or scripts yet'));
    }
    body.scrollTop = top;
  }
  function paintStatus() {
    if (hass.status !== 'ready') { status.textContent = hass.status === 'connecting' ? 'Connecting…' : hass.statusMsg || ''; return; }
    const lights = hass.visible((s) => domainOf(s.entity_id) === 'light' && s.state === 'on').length;
    const w = hass.visible((s) => domainOf(s.entity_id) === 'weather')[0];
    status.textContent = [hass.config.location_name || 'Home', `${lights} light${lights === 1 ? '' : 's'} on`, w?.attributes?.temperature != null ? `${Math.round(w.attributes.temperature)}° ${w.state.replace(/-/g, ' ')}` : ''].filter(Boolean).join('  ·  ');
  }
  let full = 0;
  const offs = [
    hass.on('change', (eid) => {
      paintStatus();
      if (eid) { tiles.filter((t) => t.id === eid).forEach((t) => t.paint()); return; }
      if (Date.now() - full > 1500) { full = Date.now(); render(); } else tiles.forEach((t) => t.paint());
    }),
    hass.on('status', () => { paintStatus(); render(); }),
  ];
  hass.connect().catch(() => {});
  render(); paintStatus();
  return { el, showChrome() {}, destroy() { offs.forEach((f) => f()); hass.release(); } };
}

// ================================================================ Google Home
export const DEFAULT_GH_COMMANDS = [
  { label: 'Lights on', cmd: 'Turn on all the lights', icon: 'bulb' },
  { label: 'Lights off', cmd: 'Turn off all the lights', icon: 'bulb' },
  { label: 'Good morning', cmd: 'Good morning', icon: 'sun' },
  { label: 'Good night', cmd: 'Good night', icon: 'moon' },
  { label: 'Weather', cmd: 'What’s the weather today?', icon: 'cloud' },
  { label: 'Thermostat 22°', cmd: 'Set the thermostat to 22 degrees', icon: 'thermostat' },
];
const GH_ICONS = ['bulb', 'sun', 'moon', 'cloud', 'thermostat', 'fan', 'blinds', 'lock', 'tv', 'speaker', 'bolt', 'house', 'sparkle', 'play'];

function GoogleHomeScreen(svc, gh) {
  const addBtn = onCircle(iconBtn('plus', 'Add a command', () => editCommand(null)), 42, 38.5);
  const { el, tabs, status, body } = frame(svc, [['cmds', 'Commands'], ['speakers', 'Speakers']], addBtn);
  const reply = h('div.gh-reply');
  el.append(reply);
  let tab = 'cmds', speakerT = null, info = null;
  const cmds = () => store.get('ghCommands') || DEFAULT_GH_COMMANDS;
  let replyT = 0, audio = null;
  const showReply = (text, cls = '') => {
    reply.className = `gh-reply show ${cls}`; reply.textContent = text;
    clearTimeout(replyT); replyT = setTimeout(() => reply.classList.remove('show'), Math.min(12000, 3500 + text.length * 60));
  };
  reply.onclick = (e) => { e.stopPropagation(); reply.classList.remove('show'); };

  async function send(text, orb) {
    if (!text) return;
    orb?.classList.add('busy');
    showReply(`“${text}”`, 'asking');
    try {
      const r = await gh.ask(text);
      showReply(r.text || 'Done ✓');
      if (r.audio && store.get('ghSpeak') !== false) { try { audio?.pause(); audio = new Audio(`data:audio/mp3;base64,${r.audio}`); audio.play().catch(() => {}); } catch {} }
    } catch (e) { showReply(errMsg(e), 'error'); }
    orb?.classList.remove('busy');
  }
  async function ask(broadcast = false) {
    const v = await editText({ title: broadcast ? 'Broadcast to your speakers' : 'Ask Google', placeholder: broadcast ? 'Dinner is ready!' : 'Turn on the kitchen lights' });
    if (v) send(broadcast ? `broadcast ${v}` : v);
  }
  function editCommand(i) {
    const list = [...cmds()];
    const c = i == null ? { label: '', cmd: '', icon: 'bulb' } : { ...list[i] };
    openPanel({
      title: i == null ? 'New command' : 'Edit command', className: 'opts-panel.gh-edit',
      build(pb, panel) {
        pb.append(
          field({ label: 'Name on the tile', value: c.label, placeholder: 'Movie time', onChange: (v) => { c.label = v; } }),
          field({ label: 'What to tell Google', value: c.cmd, placeholder: 'Dim the living room lights to 20%', onChange: (v) => { c.cmd = v; } }),
          h('div.opt', h('div.opt-label', 'Icon'), h('div.chips.gh-icons', GH_ICONS.map((ic) => {
            const b = h(`button.chip.icon-chip${c.icon === ic ? '.on' : ''}`, { type: 'button', html: icon(ic), 'aria-label': ic });
            b.onclick = (e) => { e.stopPropagation(); c.icon = ic; b.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); };
            return b;
          }))),
          h('div.chips',
            h('button.pill.primary', { type: 'button', onclick: (e) => {
              e.stopPropagation();
              pb.querySelectorAll('input').forEach((inp, k) => { if (k === 0) c.label = inp.value.trim() || c.label; if (k === 1) c.cmd = inp.value.trim() || c.cmd; });
              if (!c.cmd) { toast('Type what to tell Google', { kind: 'error' }); return; }
              if (!c.label) c.label = c.cmd.slice(0, 18);
              if (i == null) list.push(c); else list[i] = c;
              store.set('ghCommands', list); panel.close(); render();
            } }, 'Save'),
            i != null ? h('button.pill.danger', { type: 'button', onclick: (e) => { e.stopPropagation(); list.splice(i, 1); store.set('ghCommands', list); panel.close(); render(); } }, 'Delete') : null),
        );
      },
    });
  }

  function tile(ic, label, onTap, onHold, cls = '') {
    const orb = h(`button.sh-orb${cls ? '.' + cls : ''}`, { type: 'button', 'aria-label': label, html: icon(ic) });
    let held = false;
    orb.onclick = (e) => { e.stopPropagation(); if (held) { held = false; return; } onTap(orb); };
    if (onHold) onLongPress(orb, () => { held = true; onHold(); });
    return h('div.sh-tile', orb, h('div.sh-label', h('div.sh-name', label)));
  }
  async function renderSpeakers() {
    const zones = await bridgeZones((z) => z.adapter === 'cast');
    if (tab !== 'speakers') return;
    clear(body);
    if (!zones.length) { body.append(emptyNote(info ? 'No Google speakers or displays found on the network yet' : 'Start the bridge to see your speakers')); return; }
    for (const z of zones) {
      const t = z.state?.track;
      const vol = z.state?.volume ?? 0;
      const input = h('input.slider', { type: 'range', min: 0, max: 100, value: vol, 'aria-label': `${z.name} volume` });
      input.style.setProperty('--fill', `${vol}%`);
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
      input.addEventListener('change', () => bridgeFetch(`/api/zones/${encodeURIComponent(z.id)}/command`, { method: 'POST', json: { cmd: 'volume', value: +input.value } }).catch((e) => toast(errMsg(e), { kind: 'error' })));
      input.addEventListener('input', () => input.style.setProperty('--fill', `${input.value}%`));
      body.append(h('div.gh-speaker',
        h('div.gh-sp-head', h('span.gh-sp-ic', { html: icon(/hub|display|tv|chromecast/i.test(z.name + (z.model || '')) ? 'tv' : 'speaker') }),
          h('div.row-text', h('div.row-title', z.name), h('div.row-sub', t ? `${t.title}${t.artist ? ` · ${t.artist}` : ''}` : z.sourceApp || 'Idle')),
          t ? h('button.ibtn.small', { type: 'button', 'aria-label': z.state?.isPlaying ? 'Pause' : 'Play', html: icon(z.state?.isPlaying ? 'pause' : 'play'),
            onclick: (e) => { e.stopPropagation(); bridgeFetch(`/api/zones/${encodeURIComponent(z.id)}/command`, { method: 'POST', json: { cmd: z.state?.isPlaying ? 'pause' : 'play' } }).then(() => setTimeout(renderSpeakers, 600)).catch((er) => toast(errMsg(er), { kind: 'error' })); } }) : null,
          t ? h('button.ibtn.small', { type: 'button', 'aria-label': 'Stop', html: icon('stop'),
            onclick: (e) => { e.stopPropagation(); bridgeFetch(`/api/zones/${encodeURIComponent(z.id)}/command`, { method: 'POST', json: { cmd: 'stop' } }).then(() => setTimeout(renderSpeakers, 600)).catch((er) => toast(errMsg(er), { kind: 'error' })); } }) : null),
        h('div.slider-row', h('span.slider-end', { html: icon('volumeLow') }), input, h('span.slider-end', { html: icon('volume') }))));
    }
  }
  function render() {
    tabs.querySelectorAll('.m-tab').forEach((b) => b.classList.toggle('on', b.dataset.k === tab));
    addBtn.hidden = tab !== 'cmds';
    clearInterval(speakerT);
    clear(body);
    if (tab === 'speakers') { body.append(spinner()); renderSpeakers(); speakerT = setInterval(renderSpeakers, 4000); return; }
    if (info && !info.signedIn) {
      body.append(emptyNote(info.error || 'Sign in to Google once on the bridge to send commands to Google Assistant.', { label: 'Set up', onClick: () => go('connect', { id: svc.id }) }));
    }
    const g = h('div.sh-grid');
    g.append(tile('mic', 'Ask Google', () => ask(false), null, 'gh-ask'));
    g.append(tile('megaphone', 'Broadcast', () => ask(true), null, 'gh-ask'));
    cmds().forEach((c, i) => g.append(tile(c.icon || 'sparkle', c.label, (orb) => send(c.cmd, orb), () => editCommand(i))));
    body.append(g, h('div.sh-hint', 'Hold a tile to edit it · + adds a command'));
  }
  tabs.querySelectorAll('.m-tab').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); tab = b.dataset.k; render(); }; });
  const paintStatus = () => { status.textContent = !info ? 'Looking for the bridge…' : info.signedIn ? `Google Assistant${info.account ? ` · ${info.account}` : ''}` : 'Google Assistant · not signed in'; };
  gh.status().then((s) => { info = s; }).catch((e) => { info = { signedIn: false, error: errMsg(e) }; }).finally(() => { paintStatus(); if (tab === 'cmds') render(); });
  render(); paintStatus();
  return { el, showChrome() {}, destroy() { clearInterval(speakerT); clearTimeout(replyT); audio?.pause(); } };
}
