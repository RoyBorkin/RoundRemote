// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Settings → Alerts: how apps (Clock alarms, Timer, Hourglass, Play Time, Bookmarks…) get your attention through the
// smart home — lights, a speaker, a phone notification, a script / scene (Home Assistant), Google Home broadcasts —
// per alert level, per app, quiet hours, and a test row with the last results. The work is done by js/core/alerts.js.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { field } from '../ui/keyboard.js';
import { openPanel, curve, listRow, spinner, emptyNote, toast } from '../ui/overlay.js';
import { chips, multiChips, stepper, toggle } from './panels.js';
import { go } from '../core/router.js';
import {
  alertConfig, setAlertConfig, alertsConfigured, haChoices, notify, stopAlert, alertLog, alertEvents,
  LEVELS, CHANNELS, SOURCES,
} from '../core/alerts.js';
import { provider } from '../providers/registry.js';

const CSS = `
.al-status { display: flex; align-items: center; gap: 1.6cqmin; width: 86%; padding: 1.6cqmin 2.4cqmin; border-radius: 3cqmin; background: var(--glass); border: 1px solid var(--line); text-align: left; }
.al-status .al-dot { width: 2cqmin; height: 2cqmin; border-radius: 50%; flex: none; background: var(--dim); }
.al-status.ok .al-dot { background: #22c55e; box-shadow: 0 0 1.4cqmin #22c55e; }
.al-status.warn .al-dot { background: #f59e0b; }
.al-status .row-text { flex: 1; }
.al-row .row-art.placeholder .ic { width: 4.4cqmin; height: 4.4cqmin; }
.al-row .al-chev { color: var(--dim); font-size: 3cqmin; flex: none; }
.al-row .al-chev .ic { width: 3cqmin; height: 3cqmin; }
.al-colors { display: flex; flex-direction: column; gap: 2cqmin; align-items: center; width: 100%; }
.al-colors .al-cl { display: flex; align-items: center; gap: 1.6cqmin; justify-content: center; flex-wrap: wrap; max-width: 96%; }
.al-colors .al-cl > b { min-width: 13cqmin; text-align: right; font-size: 2.6cqmin; font-weight: 700; color: var(--muted); }
.al-colors .th-swatches { max-width: none; flex-wrap: nowrap; gap: 1cqmin; }
.al-colors .th-sw { width: 4.6cqmin; height: 4.6cqmin; }
.al-level { width: 100%; }
.al-level .opt-label b { color: var(--fg); }
.al-level .opt-label i { font-style: normal; text-transform: none; letter-spacing: 0; color: var(--dim); font-weight: 500; }
.al-tests { display: flex; gap: 1.4cqmin; justify-content: center; flex-wrap: wrap; }
.al-tests .pill { margin: 0; display: inline-flex; align-items: center; gap: 1cqmin; }
.al-tests .pill i { width: 1.8cqmin; height: 1.8cqmin; border-radius: 50%; background: var(--lc); flex: none; }
#app .al-tests .pill.al-stop { background: var(--danger, #ef4444); color: #fff; border-color: transparent; }
.al-log { display: flex; flex-direction: column; gap: 1.4cqmin; width: 86%; }
.al-entry { padding: 1.6cqmin 2.4cqmin; border-radius: 3cqmin; background: var(--glass); border: 1px solid var(--line); }
.al-entry-h { display: flex; align-items: center; gap: 1.2cqmin; font-size: 2.6cqmin; font-weight: 700; }
.al-entry-h i { width: 1.8cqmin; height: 1.8cqmin; border-radius: 50%; background: var(--lc); flex: none; }
.al-entry-h span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; unicode-bidi: plaintext; }
.al-entry-h small { font-size: 2.1cqmin; color: var(--dim); font-weight: 600; flex: none; }
.al-res { display: flex; gap: 1cqmin; font-size: 2.2cqmin; color: var(--muted); margin-top: .6cqmin; line-height: 1.35; }
.al-res b { flex: none; width: 2.6cqmin; text-align: center; }
.al-res.ok b { color: #22c55e; } .al-res.bad b { color: var(--danger); } .al-res.wait b { color: var(--dim); }
.al-res span { min-width: 0; overflow-wrap: anywhere; }
.al-res em { font-style: normal; font-weight: 700; color: var(--fg); }
.al-skip { font-size: 2.2cqmin; color: var(--dim); margin-top: .6cqmin; }
`;
function ensureStyle() { if (!document.getElementById('al-style')) document.head.append(h('style#al-style', CSS)); }

const COLOURS = ['#ef4444', '#f97316', '#f59e0b', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const wrapDay = (m) => ((m % 1440) + 1440) % 1440;
const short = (id) => String(id || '').replace(/^[a-z_]+\./, '').replace(/_/g, ' ');
const LEVEL_COL = (lv) => alertConfig().colors[lv];

export function alertsSection() {
  ensureStyle();
  const opt = (label, control) => h('div.opt', h('div.opt-label', label), control);
  const section = (t) => h('div.section', t);
  const cfg = () => alertConfig();
  const set = (patch) => { setAlertConfig(patch); refreshStatus(); };
  let names = new Map();   // entity id → friendly name (once Home Assistant answered)
  const nameOf = (id) => names.get(id) || short(id);

  // ---------------------------------------------------------------- status
  const statusEl = h('button.al-status', { type: 'button' });
  function refreshStatus() {
    const ha = provider('homeassistant');
    const setUp = !!(ha?.url && ha.isAuthed?.());
    const c = cfg();
    let cls = '', title, sub;
    if (!c.on) { title = 'Smart-home alerts are off'; sub = 'Apps still ring and flash on this display'; }
    else if (!setUp && !c.gh) { cls = 'warn'; title = 'Home Assistant isn’t set up'; sub = 'Tap to connect it — then choose lights, a speaker…'; }
    else if (!alertsConfigured()) { cls = 'warn'; title = 'Nothing chosen yet'; sub = 'Pick lights, a speaker, your phone… below'; }
    else {
      cls = 'ok'; title = 'Alerts reach your home';
      sub = [c.lights.length && `${c.lights.length} light${c.lights.length > 1 ? 's' : ''}`, c.speaker && 'speaker', c.notify && 'phone', c.script && 'script', c.gh && 'Google Home'].filter(Boolean).join(' · ');
    }
    statusEl.className = `al-status ${cls}`;
    statusEl.replaceChildren(h('i.al-dot'), h('div.row-text', h('div.row-title', title), h('div.row-sub', sub)));
    statusEl.onclick = (e) => { e.stopPropagation(); if (!setUp) go('connect', { id: 'homeassistant' }); };
    for (const r of rows) r.update();
  }

  // ---------------------------------------------------------------- pickers (Home Assistant entities / services)
  let choicesP = null;
  const choices = (fresh = false) => {
    if (fresh || !choicesP) choicesP = haChoices().then((ch) => {
      for (const k of ['lights', 'speakers', 'scripts', 'tts']) for (const x of ch[k] || []) names.set(x.id, x.name);
      return ch;
    }).catch((e) => { choicesP = null; throw e; });
    return choicesP;
  };
  function picker({ title, kind, multi = false, none = 'None', get, put }) {
    openPanel({
      title, className: 'al-pick',
      build(body, panel) {
        const list = h('div.list');
        body.append(list); curve(list);
        list.append(spinner('Asking Home Assistant…'));
        choices(true).then((ch) => {
          const items = ch[kind] || [];
          const draw = () => {
            list.replaceChildren();
            const cur = get();
            if (!multi) list.append(listRow({ title: none, mono: '–', color: 'var(--dim)', active: !cur, onClick: () => { put(''); panel.close(); }, right: !cur ? h('span.check', { html: icon('check') }) : null }));
            if (!items.length) { list.append(emptyNote(kind === 'tts' ? 'No text-to-speech in Home Assistant yet — add “Google Translate text-to-speech” (Settings → Devices & services).' : 'Nothing of this kind in your Home Assistant.')); return; }
            for (const it of items) {
              const on = multi ? cur.includes(it.id) : cur === it.id;
              list.append(listRow({
                title: it.name, subtitle: it.state ? `${it.id} · ${it.state}` : it.id, mono: it.name.slice(0, 1).toUpperCase(), color: 'var(--accent)', active: on,
                right: on ? h('span.check', { html: icon('check') }) : null,
                onClick: () => {
                  if (!multi) { put(it.id); panel.close(); return; }
                  const now = get();
                  put(on ? now.filter((x) => x !== it.id) : [...now, it.id]);
                  const top = list.scrollTop; draw(); list.scrollTop = top;
                },
              }));
            }
          };
          draw();
        }).catch((e) => { list.replaceChildren(emptyNote(`Couldn’t reach Home Assistant: ${e?.message || e}`, { label: 'Set it up', onClick: () => { panel.close(); go('connect', { id: 'homeassistant' }); } })); });
      },
    });
  }
  const rows = [];
  function pickRow(ic, title, subOf, open) {
    const sub = h('div.row-sub');
    const el = h('button.row.al-row', { type: 'button', onclick: (e) => { e.stopPropagation(); open(); } },
      h('div.row-art.placeholder', { '--c': 'var(--accent)', html: icon(ic) }),
      h('div.row-text', h('div.row-title', title), sub),
      h('span.al-chev', { html: icon('chevron') }));
    el.update = () => { sub.textContent = subOf(cfg()); };
    el.update();
    rows.push(el);
    return el;
  }
  const lightsRow = pickRow('bulb', 'Lights to flash', (c) => (c.lights.length ? c.lights.map(nameOf).join(', ') : 'None — tap to choose'),
    () => picker({ title: 'Lights to flash', kind: 'lights', multi: true, get: () => cfg().lights, put: (v) => { set({ lights: v }); lightsRow.update(); } }));
  const speakerRow = pickRow('speaker', 'Speaker', (c) => (c.speaker ? nameOf(c.speaker) : 'None — tap to choose'),
    () => picker({ title: 'Speaker', kind: 'speakers', get: () => cfg().speaker, put: (v) => { set({ speaker: v }); speakerRow.update(); } }));
  const ttsRow = pickRow('mic', 'Voice (text-to-speech)', (c) => (c.tts ? nameOf(c.tts) : 'Automatic — the first one found'),
    () => picker({ title: 'Voice', kind: 'tts', none: 'Automatic', get: () => cfg().tts, put: (v) => { set({ tts: v }); ttsRow.update(); } }));
  const phoneRow = pickRow('megaphone', 'Phone notification', (c) => (c.notify ? `notify.${c.notify}` : 'None — tap to choose'),
    () => picker({ title: 'Notify', kind: 'notify', get: () => cfg().notify, put: (v) => { set({ notify: v }); phoneRow.update(); } }));
  const scriptRow = pickRow('sparkle', 'Script or scene', (c) => (c.script ? nameOf(c.script) : 'None — tap to choose'),
    () => picker({ title: 'Script or scene', kind: 'scripts', get: () => cfg().script, put: (v) => { set({ script: v }); scriptRow.update(); } }));
  // friendly names for the rows, without opening anything
  if (provider('homeassistant')?.isAuthed?.()) choices().then(() => rows.forEach((r) => r.update())).catch(() => {});

  // ---------------------------------------------------------------- colours per level
  function colourRow(lv, name) {
    const row = h('div.th-swatches');
    const paint = () => {
      const cur = cfg().colors[lv];
      row.replaceChildren();
      for (const col of COLOURS) row.append(h(`button.th-sw${col === cur ? '.on' : ''}`, { type: 'button', 'aria-label': `${name} ${col}`, '--sw': col, onclick: (e) => { e.stopPropagation(); pick(col); } }));
      const any = h('input.th-pick', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#888888', 'aria-label': `${name}: any colour` });
      any.addEventListener('change', () => pick(any.value));
      row.append(h(`label.th-sw.th-any${COLOURS.includes(cur) ? '' : '.on'}`, { '--sw': cur, title: 'Any colour' }, any, h('span', '+')));
    };
    const pick = (col) => { set({ colors: { ...cfg().colors, [lv]: col } }); paint(); paintTests(); };
    paint();
    return h('div.al-cl', h('b', name), row);
  }

  // ---------------------------------------------------------------- test + last results
  const tests = h('div.al-tests');
  let testing = null;
  function paintTests() {
    tests.replaceChildren(...LEVELS.map((l) => {
      const running = testing?.level === l.id;
      return h(`button.pill.small${running ? '.al-stop' : ''}`, {
        type: 'button', '--lc': LEVEL_COL(l.id),
        onclick: async (e) => {
          e.stopPropagation();
          if (running) { const t = testing; testing = null; paintTests(); await stopAlert(t); return; }
          if (testing) { await stopAlert(testing); testing = null; }
          const hnd = await notify({ title: `Test ${l.name.toLowerCase()}`, message: `This is how a ${l.name.toLowerCase()} from Round Remote looks and sounds.`, level: l.id, source: 'test', test: true });
          if (!hnd) { toast(cfg().on ? 'Nothing to do — choose lights, a speaker… for this level' : 'Smart-home alerts are off', { kind: 'error' }); return; }
          if (l.id === 'alarm') { testing = hnd; paintTests(); }
        },
      }, running ? null : h('i'), running ? 'Stop alarm' : `Test ${l.name.toLowerCase()}`);
    }));
  }
  paintTests();
  const log = h('div.al-log');
  const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function paintLog() {
    const list = alertLog().slice(0, 4);
    if (!list.length) { log.replaceChildren(h('div.opt-hint', 'Results of the last alerts show here.')); return; }
    log.replaceChildren(...list.map((en) => h('div.al-entry', { '--lc': LEVEL_COL(en.level) },
      h('div.al-entry-h', h('i'), h('span', { dir: 'auto' }, en.title), h('small', `${en.source} · ${time(en.at)}`)),
      en.skipped ? h('div.al-skip', `Skipped: ${en.skipped}`) : null,
      ...en.results.map((r) => h(`div.al-res.${r.ok === null ? 'wait' : r.ok ? 'ok' : 'bad'}`, h('b', r.ok === null ? '…' : r.ok ? '✓' : '✕'), h('span', h('em', r.action), ` ${r.detail || ''}`))),
      en.stoppedAt ? h('div.al-skip', `Stopped ${time(en.stoppedAt)}`) : null)));
  }
  paintLog();
  const offLog = alertEvents.on('log', () => { if (!log.isConnected) { offLog(); offChange(); return; } paintLog(); });
  const offChange = alertEvents.on('change', () => { if (!tests.isConnected) return; if (testing && (testing.stopped || testing.done)) { testing = null; paintTests(); } });

  // ---------------------------------------------------------------- the list
  const levelRows = LEVELS.map((l) => h('div.opt.al-level', h('div.opt-label', h('b', l.name), ' ', h('i', `— ${l.hint}`)),
    multiChips(CHANNELS, () => cfg().levels[l.id] || [], (on) => set({ levels: { ...cfg().levels, [l.id]: CHANNELS.map((x) => x.id).filter((id) => on.includes(id)) } }), { min: 0 })));
  const localHost = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  refreshStatus();
  return [
    section('Smart-home alerts'),
    h('div.opt-hint', 'When an alarm or timer rings, or an app wants your attention, your home can tell you too: flash the lights in a colour, chime and speak on a speaker, notify your phone, run a script — through Home Assistant — or broadcast on Google Home.'),
    statusEl,
    toggle('Smart-home alerts', () => cfg().on, (v) => set({ on: v })),

    section('Lights'),
    lightsRow,
    opt('Style', chips([{ id: 'pulse', name: 'Pulse' }, { id: 'flash', name: 'Light’s own flash' }, { id: 'solid', name: 'Solid colour' }], cfg().lightStyle, (v) => set({ lightStyle: v }))),
    opt('Colours', h('div.al-colors', ...LEVELS.map((l) => colourRow(l.id, l.name)))),
    h('div.opt-hint', 'Afterwards the lights go back exactly as they were (on, off, brightness, colour). Alarms keep the colour until you stop them.'),

    section('Speaker'),
    speakerRow,
    toggle('Chime first', () => cfg().chime, (v) => set({ chime: v })),
    field({ label: 'Chime sound (URL)', value: cfg().chimeUrl, placeholder: 'built-in chime', onChange: (v) => set({ chimeUrl: v.trim() }) }),
    localHost ? h('div.opt-hint', `Speakers can’t reach this display’s “${location.hostname}” address — for a chime, use a sound in Home Assistant (e.g. http://homeassistant.local:8123/local/chime.mp3) or open the app by its network address.`) : null,
    toggle('Speak the message', () => cfg().speech, (v) => set({ speech: v })),
    ttsRow,
    opt('Volume for alerts', chips([null, 30, 50, 70, 100].map((v) => ({ id: v, name: v === null ? 'As it is' : `${v}%` })), cfg().volume ?? null, (v) => set({ volume: v }))),
    h('div.opt-hint', 'The speaker’s volume is put back afterwards.'),
    toggle('Resume what was playing', () => cfg().resume !== false, (v) => set({ resume: v })),
    h('div.opt-hint', 'If the speaker was playing music, it carries on after the alert (or starts that song again, where the speaker can’t simply continue).'),

    section('Phone · script · Google'),
    phoneRow,
    scriptRow,
    h('div.opt-hint', 'A script gets the variables title, message, level and source.'),
    toggle('Broadcast on Google Home speakers', () => cfg().gh, (v) => set({ gh: v })),
    h('div.opt-hint', 'Uses Google Assistant through the bridge (Home → Google Home, signed in).'),

    section('What each level does'),
    ...levelRows,
    opt('Alarms repeat every', chips([{ id: 0, name: 'Once' }, { id: 15, name: '15 s' }, { id: 30, name: '30 s' }, { id: 60, name: '1 min' }, { id: 120, name: '2 min' }], Number(cfg().repeatSec) || 0, (v) => set({ repeatSec: v }))),

    section('Apps'),
    ...SOURCES.map((s) => toggle(s.name, () => cfg().sources[s.id] !== false, (v) => set({ sources: { ...cfg().sources, [s.id]: v } }))),

    section('Quiet hours'),
    toggle('Quiet hours', () => cfg().quiet, (v) => set({ quiet: v })),
    stepper('From', () => cfg().quietFrom, (v) => set({ quietFrom: wrapDay(v) }), { step: 30, fmt: fmtMin }),
    stepper('Until', () => cfg().quietTo, (v) => set({ quietTo: wrapDay(v) }), { step: 30, fmt: fmtMin }),
    toggle('Alarms still go through', () => cfg().quietAlarms, (v) => set({ quietAlarms: v })),

    section('Test'),
    tests,
    log,
  ].filter(Boolean);
}
