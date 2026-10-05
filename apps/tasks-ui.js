// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Shared pieces of the Tasks content manager, used by the Tasks app and the games that draw from it (Truth or Dare,
// Drinking Games, Trivia Night): the add / edit sheet for every content type (on-screen keyboard on the round display),
// the "Add from phones" QR panel (opens the bridge's /tasks page with the type preselected — or, without a bridge,
// explains why and offers adding on the display), and the list chips.
import { h, clear } from '../js/ui/dom.js';
import { createKeyboard, wantsKeyboard } from '../js/ui/keyboard.js';
import { qrSvg } from './qr.js';
import * as T from './tasks-store.js';

const { TYPE_META, TOD, RANKS, PARTY_KINDS, PARTY_KIND_NAMES, DIFF_NAMES } = T;

let cssDone = false;
export function ensureCss() {
  if (cssDone || document.querySelector('link[data-tasks-ui]')) { cssDone = true; return; }
  cssDone = true;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('./tasks-ui.css', import.meta.url).href, dataset: { tasksUi: '1' } }));
}

export const qrGlyph = () => h('i', { html: '<svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M3 3h8v8H3zm2 2v4h4V5zM13 3h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zM13 13h3v3h-3zm5 0h3v3h-3zm-5 5h3v3h-3zm5 0h3v3h-3zM6 6h2v2H6zm10 0h2v2h-2zM6 16h2v2H6z"/></svg>' });

const PH = {
  truth: 'A question to answer honestly…', dare: 'Dare someone to…', task: 'A challenge for everyone…',
  never: '…been on a blind date', likely: '…forget their own birthday', party: 'Everyone wearing black takes a sip.',
  kings: 'What happens when this card is drawn', trivia: 'Your question',
};
const SIMPLE = new Set([...TOD, 'never', 'likely']);

/** Quick add for one-line types (truths, dares, tasks, Never / Likely prompts): the text + an 18+ toggle. */
function quickSheet(app, type) {
  ensureCss();
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    app.openPanel({
      title: `New ${TYPE_META[type].name.toLowerCase()}`, className: 'edit-panel kbd-open tk-add-panel',
      onClose: () => finish(null),
      build(body, panel) {
        let x18 = false;
        const input = h('input.edit-input', { type: 'text', placeholder: PH[type], autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', dir: 'auto' });
        const submit = (v = input.value) => { v = String(v).trim(); finish(v ? { text: v, x18 } : null); panel.close(); };
        const tog = h('button.tk-x18.lg', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': '18+ (adults only)',
          onclick: () => { x18 = !x18; tog.classList.toggle('on', x18); tog.setAttribute('aria-checked', String(x18)); app.sfx('tap'); } }, '18+');
        body.append(input, h('div.tk-add-row', tog, h('button.pill.primary', { type: 'button', onclick: () => submit() }, 'Add')));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        if (wantsKeyboard()) {
          input.readOnly = true;
          const kb = createKeyboard(input, { onEnter: (v) => submit(v) });
          kb.setEnterIcon('check');
          panel.el.appendChild(kb);
        } else {
          panel.el.classList.remove('kbd-open');
          setTimeout(() => input.focus(), 200);
        }
      },
    });
  });
}

/** The full sheet for any type: text, the type's own fields (trivia answer / wrong answers / topic / difficulty, party
 *  card kind / rule end / length, Kings Cup rank / name), language, 18+ and lists. Resolves the fields, or null.
 *  `item` = an entry to edit; `defaults` = starting values for a new one. */
export function itemForm(app, { type, item = null, defaults = {} }) {
  ensureCss();
  const v = { text: '', lang: '', lists: [], tags: TOD.includes(type) ? ['family'] : [], answer: '', wrong: [], cat: 'general', d: 2, kind: 'e', end: '', turns: 0, rank: 'J', title: '', ...defaults, ...(item || {}) };
  v.wrong = [...(v.wrong || [])];
  v.lists = [...(v.lists || [])];
  let x18 = T.isAdult(v);
  return new Promise((resolve) => {
    let result = null;
    app.openPanel({
      title: item ? `Edit ${TYPE_META[type].name.toLowerCase()}` : `New ${TYPE_META[type].name.toLowerCase()}`, className: 'tkf-panel',
      onClose: () => resolve(result),
      build(body, panel) {
        panel.el.style.setProperty('--k', TYPE_META[type].color);
        const box = h('div.tkf');
        body.append(box);
        const field = (label, val, ph, onEdit, cls = '') => h(`button.tkf-field${cls}${val ? '' : '.empty'}`, { type: 'button', dir: 'auto', onclick: onEdit },
          h('span.tkf-k', label), h('span.tkf-v', { dir: 'auto' }, val || ph));
        const ask = async (title, key, placeholder, idx = null) => {
          const cur = idx === null ? v[key] : v[key][idx] || '';
          const r = await app.editText({ title, value: cur, placeholder, okLabel: 'OK' });
          if (r === null) return;
          if (idx === null) v[key] = r; else { v[key][idx] = r; v[key] = v[key].filter((x, i) => x || i < 3); }
          draw();
        };
        const chips = (opts, cur, fn, cls = '') => h(`div.tkf-chips${cls}`, opts.map(([val, label]) => h(`button.chip${val === cur ? '.on' : ''}`, { type: 'button', onclick: () => { fn(val); app.sfx('tick'); draw(); } }, label)));
        const draw = () => {
          clear(box);
          const textLabel = type === 'trivia' ? 'Question' : type === 'kings' ? 'What to do' : type === 'never' ? 'Never have I ever…' : type === 'likely' ? 'Who’s most likely to…' : 'Text';
          if (type === 'kings') {
            box.append(h('div.tkf-h', 'Card'), chips(RANKS.map((r) => [r, r]), v.rank, (r) => { v.rank = r; }, '.ranks'));
            box.append(field('Rule name', v.title, 'e.g. Waterfall', () => ask('Rule name', 'title', 'e.g. Waterfall')));
          }
          if (type === 'party') box.append(h('div.tkf-h', 'Kind of card'), chips(PARTY_KINDS.map((k) => [k, PARTY_KIND_NAMES[k]]), v.kind, (k) => { v.kind = k; }));
          box.append(field(textLabel, v.text, PH[type], () => ask(textLabel, 'text', PH[type]), '.main'));
          if (type === 'party') {
            box.append(h('div.tkf-ins', h('span', 'Random players:'), ...['{A}', '{B}'].map((x) => h('button.chip', { type: 'button', onclick: () => { v.text = `${v.text}${v.text && !/\s$/.test(v.text) ? ' ' : ''}${x}`; draw(); } }, `+ ${x}`))));
            if (v.kind === 'r') {
              box.append(field('When it ends (optional)', v.end, 'e.g. {A} can talk normally again', () => ask('When the rule ends', 'end', 'e.g. {A} can talk normally again')));
              box.append(h('div.tkf-h', 'Lasts'), chips([[0, 'Auto'], [3, '3 cards'], [5, '5'], [8, '8'], [12, '12']], v.turns || 0, (n) => { v.turns = n; }));
            }
          }
          if (type === 'trivia') {
            box.append(field('Correct answer', v.answer, 'The answer', () => ask('Correct answer', 'answer', 'The answer'), '.ok'));
            for (let i = 0; i < 3; i++) box.append(field(`Wrong answer ${i + 1}`, v.wrong[i], i ? 'Optional' : 'Optional — 3 for multiple choice', () => ask(`Wrong answer ${i + 1}`, 'wrong', 'A wrong answer', i), '.bad'));
            if (v.wrong.filter(Boolean).length < 3) box.append(h('div.tkf-note', 'Without three wrong answers it’s asked in Buzzers mode only.'));
            const tps = T.topics();
            if (v.cat && !tps.some((c) => c.id === v.cat)) tps.push(T.topicOf(v.cat));
            box.append(h('div.tkf-h', 'Topic'), h('div.tkf-chips.wrap', ...tps.map((c) => h(`button.chip${c.id === v.cat ? '.on' : ''}`, { type: 'button', dir: 'auto', onclick: () => { v.cat = c.id; app.sfx('tick'); draw(); } }, `${c.icon} ${c.name}`)),
              h('button.chip.tkf-new', { type: 'button', onclick: async () => { const n = await app.editText({ title: 'New topic', placeholder: 'e.g. Our family', okLabel: 'Add' }); if (n) { v.cat = n.slice(0, 40); draw(); } } }, '+ New topic')));
            box.append(h('div.tkf-h', 'Difficulty'), chips([[1, DIFF_NAMES[1]], [2, DIFF_NAMES[2]], [3, DIFF_NAMES[3]]], v.d, (d) => { v.d = d; }));
          }
          const autoLang = v.lang || (T.hasHebrew(v.text) ? 'he' : 'en');
          box.append(h('div.tkf-h', 'Language'), chips([['en', 'English'], ['he', 'עברית']], autoLang, (l) => { v.lang = l; }));
          box.append(h(`button.tkf-x18${x18 ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(x18), onclick: () => { x18 = !x18; app.sfx('tap'); draw(); } },
            h('span.tk-x18.static', '18+'), h('span', x18 ? 'Adults only — used while 18+ mode is on' : 'For everyone'), h(`span.switch${x18 ? '.on' : ''}`)));
          box.append(h('div.tkf-h', 'Lists'), listChips(app, v.lists, (ids) => { v.lists = ids; draw(); }));
          const ok = h('button.pill.primary.tkf-save', { type: 'button', onclick: () => {
            if (!v.text.trim()) { app.toast('Write the text first'); return ask(textLabel, 'text', PH[type]); }
            if (type === 'trivia' && !v.answer.trim()) { app.toast('Add the correct answer'); return ask('Correct answer', 'answer', 'The answer'); }
            const tags = TOD.includes(type) ? T.adultTags(v.tags || [], x18) : T.adultTags(v.tags || [], x18).filter((t) => t !== 'family');
            result = { text: v.text, lang: autoLang, lists: v.lists, tags };
            if (type === 'trivia') Object.assign(result, { answer: v.answer, wrong: v.wrong.filter(Boolean), cat: v.cat, d: v.d });
            if (type === 'party') Object.assign(result, { kind: v.kind, end: v.kind === 'r' ? v.end : '', turns: v.kind === 'r' ? v.turns : 0 });
            if (type === 'kings') Object.assign(result, { rank: v.rank, title: v.title });
            panel.close();
          } }, item ? 'Save' : 'Add');
          box.append(h('div.tkf-acts', ok));
        };
        draw();
        if (!item && !v.text) setTimeout(() => box.querySelector('.tkf-field.main')?.click(), 260);
      },
    });
  });
}

/** Add an entry on the display: the quick sheet for one-line types, the full sheet for the rest. `lists` = lists to put
 *  it on (e.g. the list the manager is showing). Resolves the new item, or null. */
export async function addFlow(app, type, { lists = [], defaults = {} } = {}) {
  let it = null;
  if (SIMPLE.has(type) && !lists.length) {
    const r = await quickSheet(app, type);
    if (!r) return null;
    it = T.addItem({ type, text: r.text, tags: TOD.includes(type) ? (r.x18 ? T.adultTags(['family'], true) : ['family']) : r.x18 ? ['18+'] : [] });
  } else {
    const r = await itemForm(app, { type, defaults: { lists, ...defaults } });
    if (!r) return null;
    it = T.addItem({ type, ...r });
  }
  if (it) {
    app.sfx('pop'); app.vibrate?.(15);
    const hidden = T.isAdult(it) && !T.settings().adult;
    app.toast(hidden ? `${TYPE_META[type].name} added · Hidden — 18+ mode is off` : `${TYPE_META[type].name} added`);
  }
  return it;
}

/** Chips for picking lists (multi), with "+ New list". */
export function listChips(app, ids, onChange) {
  const sel = new Set(ids);
  const row = h('div.tkf-chips.wrap.multi');
  for (const l of T.lists()) row.append(h(`button.chip${sel.has(l.id) ? '.on' : ''}`, { type: 'button', dir: 'auto', onclick: () => { sel.has(l.id) ? sel.delete(l.id) : sel.add(l.id); app.sfx('tick'); onChange([...sel]); } }, l.text));
  row.append(h('button.chip.tkf-new', { type: 'button', onclick: async () => {
    const n = await app.editText({ title: 'New list', placeholder: 'e.g. Family night', okLabel: 'Create' });
    const l = n && T.createList(n);
    if (l) { sel.add(l.id); onChange([...sel]); }
  } }, '+ New list'));
  return row;
}

/** "Add from phones": the QR code for the bridge's /tasks page with this type preselected. Without a bridge (e.g. the
 *  GitHub Pages web app on its own) it explains that phones need the bridge and offers adding on the display. */
/** "truths" · "to Kings Cup" — for "Add …" / "Scan to add …". */
export const what = (type) => (TYPE_META[type]?.game ? `to ${TYPE_META[type].game}` : (TYPE_META[type]?.plural || 'entries').toLowerCase());
export function phonesPanel(app, { type, title = `Add ${what(type)}`, onAdded = null } = {}) {
  ensureCss();
  const meta = TYPE_META[type] || TYPE_META.truth;
  let stop = null;
  app.openPanel({
    title, className: 'tkq-panel',
    onClose: () => stop?.(),
    build(body, panel) {
      panel.el.style.setProperty('--k', meta.color);
      const box = h('div.tkq');
      body.append(box);
      const addHere = () => { panel.close(); addFlow(app, type).then((it) => it && onAdded?.(it)); };
      const load = async () => {
        clear(box);
        box.append(h('div.tkq-wait', h('div.spin'), h('div', 'Finding the bridge…')));
        const r = await T.phoneUrl({ type }).catch(() => ({ url: null, reason: 'nobridge' }));
        if (panel.closed) return;
        clear(box);
        if (!r.url) {
          box.append(h('div.tkq-off',
            h('div.tkq-off-ic', qrGlyph()),
            h('div.tkq-off-t', 'Phones need the bridge'),
            h('div.tkq-off-m', r.reason === 'noip' ? 'The bridge has no network address phones can reach. Set "tasks.publicUrl" in bridge/config.json (or RR_PUBLIC_URL).'
              : r.reason === 'old' ? 'This bridge is too old for this page — update it (bridge/server.js, the Pi or the Docker image).'
                : 'Phones add through the bridge — the Raspberry Pi, the NAS server or bridge/server.js on a computer on this network. Until then, add them here with the on-screen keyboard.'),
            h('div.tkq-off-b', h('button.pill', { type: 'button', onclick: load }, 'Try again'), h('button.pill.primary', { type: 'button', onclick: addHere }, 'Add here'))));
          return;
        }
        const n0 = T.pool({ type, filter: 'all', adult: true, tags: [], packs: false, source: 'custom' }).length;
        const cnt = h('div.tkq-count');
        const upd = () => { const n = T.pool({ type, filter: 'all', adult: true, tags: [], packs: false, source: 'custom' }).length - n0; cnt.textContent = n > 0 ? `+${n} added just now` : `Scan to add ${what(type)}`; };
        box.append(h('div.tkq-code', { html: qrSvg(r.url, { margin: 3, dark: '#111', light: '#fff' }), dataset: { url: r.url } }), cnt,
          h('div.tkq-url', r.url.replace(/^https?:\/\//, '')), h('button.pill.small.tkq-here', { type: 'button', onclick: addHere }, 'Add here instead'));
        upd();
        const off = T.events.on('change', upd);
        const stopSync = T.startSync({ every: 3000, passive: true });
        stop = () => { off(); stopSync(); };
      };
      load();
    },
  });
}
