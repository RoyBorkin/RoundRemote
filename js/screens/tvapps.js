// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The TV remote's apps: a round, watch-style grid of app icons (they shrink toward the rim as you scroll), opened
// from the remote's Apps button — and "Manage apps" (show / hide, order, add your own by package name, reset),
// also in Settings → Movies & TV → TV apps. One list for every TV remote (js/core/tv-apps-prefs.js); the apps
// come from the shared catalog (js/core/tv-apps.js). Apple TV shows its own installed apps here, with the same icons.
//   Grid: tap = open on the TV · hold = hide / move · knob ←/→ = move, Enter = open · ✎ = Manage apps
import { h, clear, iconBtn, onLongPress, loadIconPath } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openPanel, toast, curve, spinner, emptyNote, topPanel } from '../ui/overlay.js';
import { editText, field, wantsKeyboard } from '../ui/keyboard.js';
import { player } from '../core/player.js';
import { TV_APP_CATEGORIES, monogram, catalogAppByName } from '../core/tv-apps.js';
import * as P from '../core/tv-apps-prefs.js';
import { registerSettings } from './settings-registry.js';

const errMsg = (e) => e?.userMessage || e?.body?.error || e?.message || 'Something went wrong';
const HEB = /[֐-׿]/;
const CAT = Object.fromEntries(TV_APP_CATEGORIES.map(([id, en]) => [id, en]));

// our stylesheet, once
(function css() {
  if (typeof document === 'undefined' || document.querySelector('link[data-tvapps]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../css/tvapps.css', import.meta.url).href, 'data-tvapps': '' }));
})();

// ---------------------------------------------------------------- an app's tile
const light = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.62;
};
/** The app's icon: its real icon (bridge / your own), else its logo (Simple Icons) on the brand colour, else initials. */
export function appIcon(app, cls = '') {
  const mono = monogram(app);
  const el = h(`div.tva-ic${cls ? `.${cls}` : ''}${light(app.color) ? '.lt' : ''}`, { '--c': app.color || 'var(--accent)', 'aria-hidden': 'true' },
    h(`span.tva-mono${HEB.test(mono) ? '.he' : ''}${mono.length > 2 ? '.long' : ''}`, { dir: 'auto' }, mono));
  if (app.glyph) { el.classList.add('has-glyph'); el.append(h('i.tva-glyph', { html: icon(app.glyph) })); }
  const logo = () => {
    if (!app.si || el.classList.contains('has-img')) return;
    loadIconPath(app.si).then((d) => {
      if (!d || el.classList.contains('has-img')) return;
      el.append(h('i.tva-si', { html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>` }));
      el.classList.add('has-si');
    }).catch(() => {});
  };
  logo();
  P.appIconUrl(app).then((url) => {
    if (!url) return;
    const img = new Image();
    img.decoding = 'async';
    img.alt = '';
    img.className = 'tva-img';
    img.onload = () => { el.append(img); el.classList.add('has-img'); el.querySelector('.tva-si')?.remove(); };
    img.src = url;
  }).catch(() => {});
  return el;
}
const label = (app) => app.short || app.name;

// ---------------------------------------------------------------- the round grid
/** Open the apps grid for the TV the player is controlling. */
export function openTvApps() {
  const prov = player.provider;
  const zone = prov?.zone;
  if (!zone) return toast('Pick a TV in Devices first');
  const apple = zone.adapter === 'appletv';
  let panel = null;
  panel = openPanel({
    title: 'Apps', className: `tva-panel${apple ? ' apple' : ''}`,
    build(body, p) {
      const scroll = h('div.tva-scroll');
      const grid = h('div.tva-grid');
      scroll.append(grid);
      body.append(scroll);
      const edit = apple ? null : iconBtn('edit', 'Manage apps', () => openManageApps({ onChange: () => draw() }), 'tva-edit');
      if (edit) p.el.append(edit);
      let tiles = [], items = [], sel = -1, raf = 0;

      const launch = async (app, tile) => {
        tile?.classList.add('go');
        toast(`Opening ${app.name}`);
        try {
          if (apple) await prov.playPlaylist(app.item);
          else await P.launchTvApp(prov.zone, app);
          setTimeout(() => prov.refresh?.().catch?.(() => {}), 900);
          setTimeout(() => panel.close(), 220);
        } catch (e) { tile?.classList.remove('go'); toast(errMsg(e), { kind: 'error' }); }
      };

      function layout() {
        const W = scroll.clientWidth || 720;
        const n = tiles.length;
        const sx = W * 0.2, sy = W * 0.19;
        // rows of 4 and 3, honeycomb style
        let i = 0, row = 0;
        const pos = [];
        while (i < n) {
          const cnt = Math.min(row % 2 ? 3 : 4, n - i);
          for (let c = 0; c < cnt; c++) pos.push([W / 2 + (c - (cnt - 1) / 2) * sx, row * sy]);
          i += cnt; row++;
        }
        const contentH = (row - 1) * sy;
        const pad = Math.max(W * 0.31, (W - contentH) / 2);
        grid.style.height = `${contentH + pad * 2}px`;
        tiles.forEach((t, k) => { t.style.left = `${pos[k][0]}px`; t.style.top = `${pos[k][1] + pad}px`; t._y = pos[k][1] + pad; t._x = pos[k][0]; });
        fish();
      }
      // watch-style: icons shrink and fade toward the edge of the circle
      function fish() {
        raf = 0;
        const W = scroll.clientWidth || 720, R = W / 2, st = scroll.scrollTop;
        for (const t of tiles) {
          const dx = t._x - R, dy = t._y - st - R;
          const r = Math.hypot(dx, dy) / R;
          const s = r < 0.45 ? 1 : Math.max(0.3, 1 - (r - 0.45) * 1.45);
          const pull = (1 - s) * 0.22;
          t.style.transform = `translate(-50%, -50%) translate(${(-dx * pull).toFixed(1)}px, ${(-dy * pull).toFixed(1)}px) scale(${s.toFixed(3)})`;
          t.style.opacity = r > 1.02 ? '0' : (1 - Math.max(0, r - 0.74) * 3).toFixed(3);
          t.classList.toggle('far', r > 0.8);
        }
      }
      const schedule = () => { if (!raf) raf = requestAnimationFrame(fish); };
      scroll.addEventListener('scroll', schedule, { passive: true });
      const ro = new ResizeObserver(layout); ro.observe(scroll);

      function center(k, smooth = true) {
        const t = tiles[k]; if (!t) return;
        const W = scroll.clientWidth || 720;
        scroll.scrollTo({ top: Math.max(0, t._y - W / 2), behavior: smooth ? 'smooth' : 'auto' });
      }
      function select(k) {
        if (!tiles.length) return;
        sel = (k + tiles.length) % tiles.length;
        tiles.forEach((t, j) => t.classList.toggle('sel', j === sel));
        center(sel);
      }

      function tileFor(app, k, st) {
        const t = h(`button.tva-tile${st.current?.id === app.id ? '.current' : ''}${st.installed?.has(app.id) ? '.inst' : ''}`, { type: 'button', 'aria-label': app.name, title: app.name, dataset: { id: app.id } },
          appIcon(app), h('span.tva-name', { dir: 'auto' }, label(app)));
        t.addEventListener('click', (e) => { e.stopPropagation(); if (t._held) { t._held = false; return; } launch(app, t); });
        if (!apple) onLongPress(t, () => { t._held = true; navigator.vibrate?.(12); tileMenu(app, k); });
        return t;
      }
      function tileMenu(app, k) {
        const shown = P.shownIds();
        const i = shown.indexOf(app.id);
        openPanel({
          title: app.name, className: 'opts-panel tva-menu',
          build(b, mp) {
            const act = (txt, ic, fn, dis = false) => h('button.pill.tva-act', { type: 'button', disabled: dis, onclick: (e) => { e.stopPropagation(); fn(); mp.close(); } }, h('span', { html: icon(ic) }), txt);
            b.append(h('div.tva-menu-ic', appIcon(app, 'big')),
              act('Open on the TV', 'play', () => launch(app, tiles[k])),
              h('div.tva-row2', act('Earlier', 'prev', () => { P.moveApp(app.id, -1); draw(k - 1); }, i <= 0), act('Later', 'next', () => { P.moveApp(app.id, 1); draw(k + 1); }, i < 0 || i >= shown.length - 1)),
              act('Hide', 'eye', () => { P.showApp(app.id, false); toast(`${app.name} hidden — Manage apps brings it back`); draw(Math.min(k, P.shownIds().length - 1)); }),
              act('Manage apps…', 'edit', () => openManageApps({ onChange: () => draw() })));
          },
        });
      }

      async function draw(keep = sel) {
        clear(grid);
        let list;
        if (apple) {
          grid.append(spinner('Asking the Apple TV…'));
          try {
            list = (await prov.getPlaylists()).filter((x) => x.kind === 'app').map((x) => {
              const c = catalogAppByName(x.name);
              return { ...(c || {}), id: x.id, name: x.name, short: '', mono: c?.mono || '', item: x, color: c?.color || '#4b5563' };
            });
          } catch (e) { clear(grid); grid.append(emptyNote(errMsg(e))); return; }
          clear(grid);
        } else list = P.shownApps();
        items = list;
        const st = apple ? { current: null, installed: null } : P.tvAppState(prov.zone);
        tiles = items.map((a, k) => tileFor(a, k, st));
        // the last tile: add an app that isn't listed (search Google Play, a package name, the app open on the TV now)
        if (!apple) {
          const add = h('button.tva-tile.tva-addtile', { type: 'button', 'aria-label': 'Add an app', title: 'Add an app that isn’t listed', dataset: { id: '__add' } },
            h('div.tva-ic.tva-plus', { 'aria-hidden': 'true', html: icon('plus') }), h('span.tva-name', 'Add app'));
          add.addEventListener('click', (e) => { e.stopPropagation(); addApp(); });
          tiles.push(add); items = [...items, { id: '__add', add: true }];
        }
        grid.append(...tiles);
        if (!list.length) grid.append(emptyNote(apple ? 'No apps found on the Apple TV' : 'No apps shown yet', apple ? null : { label: 'Choose apps', onClick: () => openManageApps({ onChange: () => draw() }) }));
        layout();
        if (keep >= 0 && tiles.length) { sel = Math.min(keep, tiles.length - 1); tiles[sel].classList.add('sel'); center(sel, false); }
      }
      const addApp = () => openAddApp({ zone: prov.zone, onAdded: () => draw(sel) });
      draw(-1);

      // knob / keys: ←/→ move, Enter opens, E = manage
      const onKey = (e) => {
        if (topPanel() !== p || e.target.matches?.('input, textarea')) return;
        const k = e.key;
        if (['ArrowRight', 'ArrowDown'].includes(k)) select(sel + 1);
        else if (['ArrowLeft', 'ArrowUp'].includes(k)) select(sel < 0 ? 0 : sel - 1);
        else if ((k === 'Enter' || k === ' ') && tiles[sel]) { if (items[sel]?.add) addApp(); else launch(items[sel], tiles[sel]); }
        else if ((k === 'e' || k === 'E') && !apple) openManageApps({ onChange: () => draw() });
        else return;
        e.preventDefault(); e.stopPropagation();
      };
      window.addEventListener('keydown', onKey, true);
      const offState = player.on('state', () => { if (!apple && tiles.length) { const st = P.tvAppState(prov.zone); tiles.forEach((t, j) => t.classList.toggle('current', st.current?.id === items[j]?.id)); } });
      p.onDestroy = () => { window.removeEventListener('keydown', onKey, true); ro.disconnect(); cancelAnimationFrame(raf); offState?.(); };
    },
  });
  return panel;
}

// ---------------------------------------------------------------- Manage apps
/** Fill `root` with the manage UI (search, category tabs, show / hide, order, add your own, reset). */
export function buildManage(root, { onChange, embedded = false } = {}) {
  let tab = 'shown', q = '', armed = false;
  const changed = () => { draw(); onChange?.(); };
  const search = h('input.tva-q', { type: 'search', placeholder: 'Search apps', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search apps', dir: 'auto' });
  if (wantsKeyboard()) {
    search.readOnly = true;
    search.addEventListener('click', async (e) => { e.stopPropagation(); const v = await editText({ title: 'Search apps', value: q, placeholder: 'Name or package' }); if (v !== null) { q = v; search.value = v; if (v) tab = 'all'; draw(); } });
  } else search.addEventListener('input', () => { q = search.value.trim(); if (q) tab = 'all'; draw(); });
  const tabs = h('div.tva-tabs');
  // in a panel the rows scroll in their own curved list; on the Settings page they're the page's own rows
  const list = embedded ? null : h('div.tva-mlist.list');
  let placed = [];
  const count = h('div.tva-count');
  const reset = h('button.pill.small.tva-reset', { type: 'button', onclick: (e) => {
    e.stopPropagation();
    if (!armed) { armed = true; reset.textContent = 'Tap again to reset'; setTimeout(() => { armed = false; reset.textContent = 'Reset to defaults'; }, 3000); return; }
    armed = false; reset.textContent = 'Reset to defaults';
    P.resetApps(); toast('Back to the default apps'); tab = 'shown'; changed();
  } }, 'Reset to defaults');
  const addNew = (query = '') => openAddApp({ query, onAdded: () => { tab = 'shown'; changed(); } });
  const add = h('button.pill.primary.tva-add', { type: 'button', onclick: (e) => { e.stopPropagation(); addNew(); } }, h('span', { html: icon('plus') }), 'Add an app that isn’t listed');
  const foot = h('div.tva-mfoot', count, h('div.tva-btns', reset));
  if (embedded) root.append(h('div.tva-mfoot.tva-set', h('div.tva-btns', add)), h('div.tva-mhead.tva-set', search, tabs), foot);   // Reset sits under the list
  else { root.append(h('div.tva-mhead', add, search, tabs), list, foot); curve(list); }

  const fold = (s) => String(s || '').toLowerCase();
  function rows() {
    const shown = P.shownIds();
    let apps;
    if (tab === 'shown' && !q) apps = shown.map(P.appById);
    else {
      apps = P.allApps().filter((a) => tab === 'all' || tab === 'shown' || a.cat === tab);
      if (q) { const f = fold(q); apps = apps.filter((a) => [a.name, a.he, a.pkg, a.short].some((x) => fold(x).includes(f))); }
      // on the remote first (in their order), then Israeli TV and TV apps before phone-only ones
      apps.sort((a, b) => (shown.includes(b.id) - shown.includes(a.id)) || (shown.indexOf(a.id) - shown.indexOf(b.id)) || ((a.tv === false) - (b.tv === false)) || ((b.region === 'il') - (a.region === 'il')));
    }
    return apps;
  }
  function row(app, i, shownTab) {
    const on = P.isShown(app.id);
    const sw = h(`button.switch${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': `Show ${app.name}`, onclick: (e) => { e.stopPropagation(); P.showApp(app.id, !on); changed(); } });
    const subTxt = [app.custom ? 'added by you' : CAT[app.cat] || '', app.tv === false ? 'phone app' : ''].filter(Boolean).join(' · ');
    const sub = h('div.row-sub', app.he && app.he !== app.name ? [h('bdi', { dir: 'rtl' }, app.he), ' · '] : null, subTxt);
    const right = [];
    if (shownTab) {
      right.push(h('button.ibtn.tva-mv', { type: 'button', 'aria-label': `Move ${app.name} up`, disabled: i === 0, onclick: (e) => { e.stopPropagation(); P.moveApp(app.id, -1); changed(); }, html: icon('chevron') }));
      right.push(h('button.ibtn.tva-mv.dn', { type: 'button', 'aria-label': `Move ${app.name} down`, disabled: i === P.shownIds().length - 1, onclick: (e) => { e.stopPropagation(); P.moveApp(app.id, 1); changed(); }, html: icon('chevron') }));
    }
    if (app.custom) right.push(h('button.ibtn.tva-ed', { type: 'button', 'aria-label': `Edit ${app.name}`, onclick: (e) => { e.stopPropagation(); openAppForm({ edit: app, onDone: () => changed() }); }, html: icon('edit') }));
    if (app.custom) right.push(h('button.ibtn.tva-del', { type: 'button', 'aria-label': `Remove ${app.name}`, onclick: (e) => { e.stopPropagation(); P.removeCustom(app.id); toast(`${app.name} removed`); changed(); }, html: icon('close') }));
    right.push(sw);
    return h(`div.row.tva-mrow${on ? '.on' : ''}`, { dataset: { id: app.id } }, appIcon(app, 'sm'),
      h('div.row-text', h('div.row-title', { dir: 'auto' }, app.name), sub), h('div.tva-mright', ...right));
  }
  function draw() {
    const cats = [['shown', 'On the remote'], ['all', 'All'], ...TV_APP_CATEGORIES.map(([id, en]) => [id, en]).filter(([id]) => P.allApps().some((a) => a.cat === id)), ...(P.customApps().length ? [['custom', 'Mine']] : [])];
    tabs.replaceChildren(...cats.map(([id, txt]) => h(`button.chip${tab === id ? '.on' : ''}`, { type: 'button', dataset: { tab: id }, onclick: (e) => { e.stopPropagation(); tab = id; draw(); tabs.querySelector('.on')?.scrollIntoView?.({ inline: 'center', block: 'nearest' }); } }, txt)));
    const apps = rows();
    const shownTab = tab === 'shown' && !q;
    const out = apps.map((a, i) => row(a, i, shownTab));
    if (!apps.length) out.push(q ? emptyNote(`No app matches “${q}”`, { label: `Find “${q}” on Google Play`, onClick: (e) => { e?.stopPropagation?.(); addNew(q); } }) : emptyNote(shownTab ? 'Nothing on the remote yet — pick apps under All' : 'Nothing here'));
    if (list) list.replaceChildren(...out);
    else { placed.forEach((n) => n.remove()); placed = out; foot.before(...out); }
    const n = P.shownIds().length;
    count.textContent = `${n} app${n === 1 ? '' : 's'} on the remote`;
  }
  draw();
  return { draw };
}

export function openManageApps({ onChange } = {}) {
  return openPanel({
    title: 'Manage apps', className: 'tva-manage-panel',
    build(body) { buildManage(body, { onChange }); },
  });
}

// ---------------------------------------------------------------- Add an app that isn't listed
// a name for an app known only by its package: its last part, capitalised (com.example.radio → Radio)
const pkgName = (pkg) => { const w = String(pkg).split('.').pop() || pkg; return w[0].toUpperCase() + w.slice(1); };
const PLAY_SEARCH = (q) => `https://play.google.com/store/search?q=${encodeURIComponent(q)}&c=apps`;
/** The add-app state of a package: 'shown' (on the remote), 'hidden' (known, not shown) or '' (new). */
function addState(pkg) {
  const a = P.allApps().find((x) => x.pkg && x.pkg.toLowerCase() === String(pkg).toLowerCase());
  return !a ? '' : P.isShown(a.id) ? 'shown' : 'hidden';
}
/** A small icon for a search result (Google Play's picture, else the brand colour + initials). */
function resultIcon(r) {
  const known = P.allApps().find((x) => x.pkg && x.pkg.toLowerCase() === r.pkg.toLowerCase());
  if (known) return appIcon(known, 'sm');
  const el = appIcon({ name: r.name, pkg: '', color: '#5f6b7a' }, 'sm');
  if (r.icon) {
    const img = new Image();
    img.decoding = 'async'; img.alt = ''; img.className = 'tva-img'; img.referrerPolicy = 'no-referrer';
    img.onload = () => { el.append(img); el.classList.add('has-img'); };
    img.src = r.icon;
  }
  return el;
}

/**
 * Add an app that isn't in the list: search Google Play by name (through the bridge), paste a Play Store link or a
 * package name, take the app that's open on the TV right now, or type it all in yourself (with an optional deep link).
 * Without a bridge (GitHub Pages): the package name + a link / QR code to find it on Google Play.
 */
export function openAddApp({ onAdded, query = '', zone = null } = {}) {
  return openPanel({
    title: 'Add an app', className: 'tva-add-panel',
    build(body, p) {
      let q = query, seq = 0, bridge = null;
      const input = h('input.tva-q.tva-addq', { type: 'search', placeholder: 'Name, Play link or package', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'App name, Play Store link or package', dir: 'auto', value: q, enterkeyhint: 'search' });
      const go = iconBtn('search', 'Search Google Play', () => run(input.value), 'tva-go');
      const list = h('div.list.tva-res');
      body.append(h('div.tva-addbar', input, go), list);
      curve(list);
      if (wantsKeyboard()) {
        input.readOnly = true;
        input.addEventListener('click', async (e) => { e.stopPropagation(); const v = await editText({ title: 'Find an app', value: input.value, placeholder: 'Name, Play Store link or package', okLabel: 'Search' }); if (v !== null) { input.value = v; run(v); } });
      } else {
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(input.value); } });
        input.addEventListener('input', () => { if (!input.value.trim()) home(); });
      }

      const added = (a, btn) => {
        if (btn) { btn.textContent = 'On the remote ✓'; btn.disabled = true; btn.classList.remove('primary'); }
        toast(`${a.name} added to the remote`);
        onAdded?.(a);
      };
      const addBtn = (r) => {
        const st = addState(r.pkg);
        const b = h(`button.pill.small${st === 'shown' ? '' : '.primary'}.tva-addbtn`, { type: 'button', disabled: st === 'shown' }, st === 'shown' ? 'On the remote ✓' : st === 'hidden' ? 'Show' : 'Add');
        b.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            let name = r.name;
            // an app the TV reports only by package: ask Google Play for its real name (bridge), best effort
            if (r.lookup && bridge) { b.textContent = '…'; name = (await Promise.race([P.searchPlay(r.pkg), new Promise((res) => setTimeout(() => res(null), 5000))]).catch(() => null))?.results?.[0]?.name || name; }
            added(P.addCustom({ name, pkg: r.pkg }), b);
          } catch (err) { b.textContent = 'Add'; toast(errMsg(err), { kind: 'error' }); }
        });
        return b;
      };
      const resultRow = (r, sub = '') => h('div.row.tva-rrow', { dataset: { pkg: r.pkg } }, resultIcon(r),
        h('div.row-text', h('div.row-title', { dir: 'auto' }, r.name), h('div.row-sub', { dir: 'auto' }, sub || [r.dev, r.pkg].filter(Boolean).join(' · '))), addBtn(r));
      const sec = (t) => h('div.tva-sec', t);
      const manualBtn = (prefill = {}) => h('button.pill.small.tva-manual', { type: 'button', onclick: (e) => { e.stopPropagation(); openAppForm({ prefill, onDone: (a) => { onAdded?.(a); p.close(); } }); } }, h('span', { html: icon('edit') }), 'Enter it yourself');

      // what to show before a search: the app open on the TV now, tips, the manual way
      async function home() {
        const my = ++seq;
        list.replaceChildren(spinner('Asking the TV…'));
        bridge = await P.searchBase().catch(() => null);
        const now = await P.appsOpenNow(zone || player.provider?.zone).catch(() => []);
        if (my !== seq) return;
        const out = [];
        if (now.length) {
          out.push(sec('Open on the TV now'));
          for (const a of now) out.push(resultRow({ pkg: a.pkg, name: a.name, lookup: !a.app }, `${a.tv} · ${a.pkg}`));
        }
        out.push(h('div.opt-hint.tva-tip', bridge
          ? 'Search Google Play by name — or paste the app’s Play Store link or its package name (com.example.app).'
          : 'Type the app’s package name (com.example.app) or paste its Play Store link. Searching Google Play by name needs the bridge.'));
        out.push(h('div.tva-btns', manualBtn()));
        list.replaceChildren(...out);
      }

      async function run(raw) {
        const text = String(raw || '').trim();
        q = text;
        if (!text) return home();
        const my = ++seq;
        const pkg = P.packageFrom(text);
        if (bridge === null) bridge = await P.searchBase().catch(() => null);
        if (!bridge) {   // no bridge: a package / link can still be added; a name gets the Play Store search link + QR
          if (pkg) { list.replaceChildren(sec('Add by package'), resultRow({ pkg, name: P.appById(`c:${pkg}`)?.name || pkgName(pkg) }, pkg), h('div.opt-hint', 'You can rename it afterwards in Manage apps (✎).'), h('div.tva-btns', manualBtn({ pkg }))); return; }
          return noBridge(text);
        }
        list.replaceChildren(spinner(pkg ? 'Looking it up on Google Play…' : 'Searching Google Play…'));
        try {
          const r = await P.searchPlay(text);
          if (my !== seq) return;
          const out = [];
          if (r.error) out.push(h('div.opt-hint.tva-tip', r.error));
          if (!r.results?.length && !r.error) out.push(emptyNote(`Nothing on Google Play for “${text}”`));
          for (const a of r.results || []) out.push(resultRow(a));
          if (r.results?.length && r.from === 'search') out.push(h('div.opt-hint.tva-tip', 'Some apps have a separate TV version — if one doesn’t open on the TV, look for “… for Android TV”.'));
          out.push(h('div.tva-btns', manualBtn(pkg ? { pkg } : { name: text })));
          list.replaceChildren(...out);
        } catch (e) {
          if (my !== seq) return;
          if (pkg) { list.replaceChildren(resultRow({ pkg, name: pkgName(pkg) }, pkg), h('div.opt-hint', errMsg(e))); return; }
          list.replaceChildren(emptyNote(errMsg(e)), h('div.tva-btns', manualBtn({ name: text })));
        }
      }
      function noBridge(text) {
        const url = PLAY_SEARCH(text);
        const qr = h('div.tva-qr', { 'aria-label': 'QR code for the Google Play search' });
        import('../../apps/qr.js').then((m) => { qr.innerHTML = m.qrSvg(url, { margin: 2 }); }).catch(() => {});
        const txt = h('div.tva-find-txt',
          h('div', 'Scan to search Google Play for ', h('b', { dir: 'auto' }, `“${text}”`), ' on your phone. The package is the end of the app’s address: …details?id=', h('b', 'com.example.app')),
          h('a.pill.small.tva-open', { href: url, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, 'Open Google Play'));
        list.replaceChildren(
          sec('Find the package name'),
          h('div.tva-find', qr, txt),
          h('div.tva-btns', manualBtn({ name: text })));
      }
      if (q) run(q); else home();
      if (!wantsKeyboard() && !q) setTimeout(() => input.focus(), 260);
    },
  });
}

/** The form: name, package (fixed when editing), link (optional, advanced), icon address (optional). */
export function openAppForm({ prefill = {}, edit = null, onDone } = {}) {
  const v = { name: edit?.name || prefill.name || '', pkg: edit?.pkg || prefill.pkg || '', link: edit?.link || '', icon: edit?.icon || '' };
  return openPanel({
    title: edit ? `Edit ${edit.name}` : 'Add an app', className: 'tva-add-panel.tva-form-panel',
    build(body, p) {
      const btn = h('button.pill.primary', { type: 'button', onclick: (e) => {
        e.stopPropagation();
        try {
          const a = edit ? P.updateCustom(edit.id, v) : P.addCustom(v);
          toast(edit ? `${a.name} saved` : `${a.name} added to the remote`); p.close(); onDone?.(a);
        } catch (err) { toast(errMsg(err), { kind: 'error' }); }
      } }, edit ? 'Save' : 'Add');
      const pkgField = edit ? h('div.field.tva-pkg', h('span.field-label', 'Package name'), h('div.tva-pkgv', edit.pkg)) : field({ label: 'Package name', value: v.pkg, placeholder: 'com.example.tvapp', onChange: (x) => { v.pkg = x; } });
      const box = h('div.tva-form',
        field({ label: 'Name', value: v.name, placeholder: 'e.g. Kan Box', onChange: (x) => { v.name = x; } }),
        pkgField,
        h('details.tva-adv', edit && (v.link || v.icon) ? { open: true } : null, h('summary', 'Advanced'),
          field({ label: 'Deep link (optional)', value: v.link, placeholder: 'https://… or app://…', onChange: (x) => { v.link = x; } }),
          field({ label: 'Icon address (optional)', value: v.icon, placeholder: 'https://…png', onChange: (x) => { v.icon = x; } })),
        h('div.tva-btns', btn, edit ? h('button.pill.danger.tva-remove', { type: 'button', onclick: (e) => { e.stopPropagation(); P.removeCustom(edit.id); toast(`${edit.name} removed`); p.close(); onDone?.(null); } }, 'Remove') : null),
        h('div.opt-hint', edit ? 'A deep link opens a page inside the app (Home Assistant and the bridge use it); without one the app just opens.'
          : 'The package name is in the app’s Google Play address: play.google.com/…details?id=com.example.tvapp. With the bridge, its icon comes from Google Play by itself.'));
      body.append(box);
      // keep typed values without waiting for "change" (desktop inputs)
      const keys = edit ? ['name', 'link', 'icon'] : ['name', 'pkg', 'link', 'icon'];
      box.querySelectorAll('input').forEach((inp, i) => inp.addEventListener('input', () => { v[keys[i]] = inp.value.trim(); }));
    },
  });
}

// Settings → Movies & TV → TV apps
registerSettings({
  group: 'media', id: 'tv-apps', title: 'TV apps', icon: 'apps', order: 40,
  summary: 'Apps on the TV remote: show, hide, order, add',
  keywords: 'google tv android tv apps launcher icons netflix youtube kan keshet 12 reshet 13 channel 14 sport hide order add package',
  sub: () => { const n = P.shownIds().length; return `${n} app${n === 1 ? '' : 's'} on the remote`; },
  build: (el) => { buildManage(el, { embedded: true }); },
});
