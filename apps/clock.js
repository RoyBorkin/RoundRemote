// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Clock: four faces you swipe between — Analog (classic / minimal / neon / roman), Digital (with a seconds ring),
// World (cities on a 24-hour ring, day and night) and Alarms (they play your music, or a built-in sound).
// Inspired by abel-otegbola/clock-app (world clocks, alarm, stopwatch); the stopwatch and timer live in the Timer app.
import { h } from '../js/ui/dom.js';
import { toLocal, localRect } from '../js/core/util.js';
import { icon } from '../js/ui/icons.js';
import { curve, listRow, topPanel } from '../js/ui/overlay.js';
import { wantsKeyboard } from '../js/ui/keyboard.js';
import { CITIES, cityById, sunAltitude, zoneTime } from './clock-cities.js';
import {
  startAlarms, alarms, saveAlarms, events, clockData, saveClock, fmtHM, ampm, nextRing, upcoming, describeDays,
  defaultH24, testAlarm, pad, snoozedUntil,
} from './clock-alarms.js';
import { whatEditor, DEFAULT_WHAT, nudgeAwake } from './clock-ring.js';

const FACES = ['analog', 'digital', 'world', 'alarms'];
const FACE_NAMES = { analog: 'Analog', digital: 'Digital', world: 'World clock', alarms: 'Alarms' };
const ANALOG_STYLES = [{ id: 'classic', name: 'Classic' }, { id: 'minimal', name: 'Minimal' }, { id: 'neon', name: 'Neon' }, { id: 'roman', name: 'Roman' }];
const DIGITAL_FONTS = [{ id: 'modern', name: 'Modern' }, { id: 'tall', name: 'Tall' }, { id: 'lcd', name: 'LCD' }, { id: 'mono', name: 'Mono' }];
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

const pol = (deg, r, c = 100) => { const a = (deg * Math.PI) / 180; return [+(c + r * Math.sin(a)).toFixed(2), +(c - r * Math.cos(a)).toFixed(2)]; };
const line = (a, r1, r2, cls) => { const [x1, y1] = pol(a, r1), [x2, y2] = pol(a, r2); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`; };
const short = (name) => name.replace(/[^\p{L}\s]/gu, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || name.slice(0, 2);

// ------------------------------------------------------------------ analog faces (SVG; hands are rotated every frame)
function analogSVG(style) {
  let s = '';
  const hands = (hh, mh, sh, shadow = true) =>
    (shadow ? `<g transform="translate(1.4 2.4)" class="an-shadow"><g data-hand="h">${hh}</g><g data-hand="m">${mh}</g></g>` : '') +
    `<g data-hand="h">${hh}</g><g data-hand="m">${mh}</g><g data-hand="s">${sh}</g>`;
  if (style === 'classic') {
    s += '<circle cx="100" cy="100" r="97" class="an-dial"/>';
    for (let i = 0; i < 60; i++) s += line(i * 6, 93, i % 5 ? 89 : 83, i % 5 ? 'an-tk' : 'an-tk an-tk-h');
    for (let k = 1; k <= 12; k++) { const [x, y] = pol(k * 30, 71); s += `<text x="${x}" y="${y}" class="an-num">${k}</text>`; }
    s += '<text x="100" y="138" class="an-date" data-date></text>';
    s += hands('<path d="M95.6 112 L97.8 53 L100 47 L102.2 53 L104.4 112 Z" class="an-hand"/>',
      '<path d="M97 115 L98.8 25 L100 19 L101.2 25 L103 115 Z" class="an-hand"/>',
      '<line x1="100" y1="124" x2="100" y2="15" class="an-sec"/><circle cx="100" cy="100" r="4.4" class="an-secdot"/><circle cx="100" cy="119" r="2.6" class="an-secdot"/>');
    s += '<circle cx="100" cy="100" r="1.7" class="an-pin"/>';
  } else if (style === 'minimal') {
    s += '<circle cx="100" cy="100" r="97" class="an-dial an-dial-min"/>';
    for (let k = 0; k < 12; k++) s += line(k * 30, 92, k % 3 ? 86 : 80, k ? 'min-bar' : 'min-bar min-top');
    s += hands('<line x1="100" y1="100" x2="100" y2="52" class="min-h"/>', '<line x1="100" y1="100" x2="100" y2="22" class="min-m"/>',
      '<line x1="100" y1="114" x2="100" y2="14" class="min-s"/><circle cx="100" cy="100" r="4.6" class="min-sring"/>', false);
  } else if (style === 'neon') {
    s += '<circle cx="100" cy="100" r="97" class="neon-bg"/><circle cx="100" cy="100" r="93" class="neon-glow"/><circle cx="100" cy="100" r="93" class="neon-ring"/>';
    for (let k = 0; k < 60; k++) { const [x, y] = pol(k * 6, 85); s += `<circle cx="${x}" cy="${y}" r="${k % 15 ? (k % 5 ? 0.7 : 1.7) : 2.8}" class="${k % 5 ? 'neon-dot dim' : 'neon-dot'}"/>`; }
    for (const k of [12, 3, 6, 9]) { const [x, y] = pol(k * 30, 69); s += `<text x="${x}" y="${y}" class="neon-num">${k}</text>`; }
    s += '<text x="100" y="136" class="neon-date" data-date></text>';
    const glow = (x2, cls) => `<line x1="100" y1="100" x2="100" y2="${x2}" class="${cls} glow"/><line x1="100" y1="100" x2="100" y2="${x2}" class="${cls}"/>`;
    s += hands(glow(54, 'neon-h'), glow(26, 'neon-m'), `${glow(16, 'neon-s')}<circle cx="100" cy="100" r="3.6" class="neon-cap"/>`, false);
  } else {   // roman
    s += '<circle cx="100" cy="100" r="97" class="an-dial an-dial-rom"/><circle cx="100" cy="100" r="92" class="rom-ring"/><circle cx="100" cy="100" r="85" class="rom-ring"/>';
    for (let i = 0; i < 60; i++) s += line(i * 6, 92, 85, i % 5 ? 'rom-tk' : 'rom-tk rom-tk-h');
    for (let k = 0; k < 12; k++) {
      const [x, y] = pol(k * 30, 71);
      s += `<text x="${x}" y="${y}" class="rom-num" transform="rotate(${k * 30} ${x} ${y})">${ROMAN[k]}</text>`;
    }
    s += '<circle cx="100" cy="134" r="13" class="rom-sub"/><text x="100" y="134" class="rom-date" data-date></text>';
    s += hands('<line x1="100" y1="112" x2="100" y2="64" class="rom-h"/><circle cx="100" cy="58.5" r="5.5" class="rom-moon"/><path d="M98.8 53 L100 43 L101.2 53 Z" class="rom-fill"/>',
      '<line x1="100" y1="114" x2="100" y2="38" class="rom-m"/><circle cx="100" cy="33.5" r="4.5" class="rom-moon"/><path d="M99.1 29 L100 16 L100.9 29 Z" class="rom-fill"/>',
      '<line x1="100" y1="120" x2="100" y2="17" class="rom-s"/><circle cx="100" cy="100" r="2.6" class="rom-scap"/>', true);
    s += '<circle cx="100" cy="100" r="3.6" class="rom-cap"/>';
  }
  return `<svg viewBox="0 0 200 200" class="ck-an ck-an-${style}" aria-hidden="true">${s}</svg>`;
}

export default {
  css: './clock.css',
  create(el, app) {
    startAlarms();
    app.hideTitle();
    // panels live outside the app box, so give them the app colour too
    const openPanel = (o) => { const p = app.openPanel(o); p.el.style.setProperty('--ac', app.meta.color); return p; };
    const D = () => clockData();
    const h24 = () => D().h24 ?? defaultH24();
    let face = Math.max(0, FACES.indexOf(D().face || 'analog'));

    const track = h('div.ck-track');
    const dots = h('div.ck-dots', FACES.map((f, i) => h('button.ck-dot', { type: 'button', 'aria-label': FACE_NAMES[f], onclick: (e) => { e.stopPropagation(); show(i); } })));
    const faceName = h('div.ck-facename');
    const btnSettings = app.iconBtn('settings', 'Clock settings', () => openSettings(), 'ck-corner ck-left');
    const btnAction = h('button.ibtn.ck-corner.ck-right', { type: 'button', onclick: (e) => { e.stopPropagation(); pages[face].action?.fn(); } });
    const root = h('div.ck', track, faceName, dots, btnSettings, btnAction);
    el.append(root);

    // ================================================================ Analog
    const analog = (() => {
      const box = h('div.ck-page.ck-analog');
      let hands = [], dateEls = [];
      let style = 'classic';
      const build = () => {
        style = D().analogStyle || 'classic';
        box.innerHTML = analogSVG(style);
        hands = [...box.querySelectorAll('[data-hand]')].map((g) => [g, g.dataset.hand]);
        dateEls = [...box.querySelectorAll('[data-date]')];
        lastDate = '';
      };
      let lastDate = '';
      build();
      const cycleStyle = (d) => {
        const i = ANALOG_STYLES.findIndex((s) => s.id === (D().analogStyle || 'classic'));
        const next = ANALOG_STYLES[(i + d + ANALOG_STYLES.length) % ANALOG_STYLES.length];
        saveClock({ analogStyle: next.id }); build(); frameAnalog(); app.sfx('tick'); app.toast(`${next.name} face`);
      };
      const frameAnalog = () => {
        const n = new Date();
        const ms = n.getMilliseconds(), s = n.getSeconds() + ms / 1000, m = n.getMinutes() + s / 60, hr = (n.getHours() % 12) + m / 60;
        const ang = { h: hr * 30, m: m * 6, s: s * 6 };
        for (const [g, k] of hands) g.setAttribute('transform', `rotate(${ang[k].toFixed(2)} 100 100)`);
        const ds = style === 'roman' ? String(n.getDate()) : `${WEEKDAYS[n.getDay()].slice(0, 3).toUpperCase()} ${n.getDate()}`;
        if (ds !== lastDate) { lastDate = ds; for (const d of dateEls) d.textContent = ds; }
      };
      const setStyle = (id) => { saveClock({ analogStyle: id }); build(); frameAnalog(); };
      return { el: box, frame: frameAnalog, setStyle, action: { icon: 'sparkle', label: 'Face style', fn: () => cycleStyle(1) }, key: () => cycleStyle(1) };
    })();

    // ================================================================ Digital
    const digital = (() => {
      let ticks = '';
      for (let i = 0; i < 60; i++) { const [x1, y1] = pol(i * 6, 95), [x2, y2] = pol(i * 6, i % 5 ? 90 : 87.5); ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dg-tk${i % 5 ? '' : ' five'}" data-i="${i}"/>`; }
      const ring = h('div.dg-ring', { html: `<svg viewBox="0 0 200 200" aria-hidden="true">${ticks}</svg>` });
      const tickEls = [...ring.querySelectorAll('line')];
      const hh = h('span.dg-hh'), mm = h('span.dg-mm'), col = h('span.dg-col', ':'), ap = h('span.dg-ap');
      const timeEl = h('div.dg-time', hh, col, mm, ap);
      const secs = h('div.dg-secs');
      const day = h('div.dg-day'), date = h('div.dg-date');
      const next = h('div.dg-next');
      const box = h('div.ck-page.ck-digital', ring, day, h('div.dg-mid', timeEl), secs, date, next);
      let last = -1;
      const applyFont = () => { box.dataset.font = D().digitalFont || 'modern'; };
      applyFont();
      const frameDigital = () => {
        const n = new Date(), s = n.getSeconds();
        if (s === last) return;
        last = s;
        const H = n.getHours(), twelve = !h24();
        hh.textContent = twelve ? String(((H + 11) % 12) + 1) : pad(H);
        mm.textContent = pad(n.getMinutes());
        ap.textContent = twelve ? ampm(H) : '';
        col.classList.toggle('off', s % 2 === 1);
        secs.textContent = D().showSec === false ? '' : pad(s);
        tickEls.forEach((t, i) => { t.classList.toggle('on', i <= s); t.classList.toggle('now', i === s); });
        day.textContent = WEEKDAYS[n.getDay()];
        date.textContent = `${n.getDate()} ${MONTHS[n.getMonth()]} ${n.getFullYear()}`;
        const up = upcoming();
        next.replaceChildren(...(up ? [h('i', { html: icon('clock') }), h('span', fmtHM(new Date(up.at).getHours(), new Date(up.at).getMinutes()) + (h24() ? '' : ` ${ampm(new Date(up.at).getHours())}`))] : []));
      };
      const cycleFont = () => {
        const i = DIGITAL_FONTS.findIndex((f) => f.id === (D().digitalFont || 'modern'));
        const nx = DIGITAL_FONTS[(i + 1) % DIGITAL_FONTS.length];
        saveClock({ digitalFont: nx.id }); applyFont(); app.sfx('tick'); app.toast(`${nx.name} digits`);
      };
      return { el: box, frame: frameDigital, refresh: () => { last = -1; applyFont(); frameDigital(); }, action: { icon: 'text', label: 'Digit style', fn: cycleFont }, key: cycleFont };
    })();

    // ================================================================ World
    const world = (() => {
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const localCity = CITIES.find((c) => c.tz === localTz);
      const defaults = () => [localCity?.id, 'London|Europe/London', 'New York|America/New_York', 'Tokyo|Asia/Tokyo', 'Sydney|Australia/Sydney']
        .filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 4);
      const cities = () => (D().cities || defaults()).map(cityById).filter(Boolean);
      let sel = D().citySel || 0;

      let base = '<circle cx="100" cy="100" r="86" class="wd-track"/>';
      base += '<path d="M14 100 A86 86 0 0 1 186 100" class="wd-day"/><path d="M186 100 A86 86 0 0 1 14 100" class="wd-night"/>';
      for (let i = 0; i < 24; i++) base += line(i * 15 + 180, 80, i % 6 ? 77.5 : 75, i % 6 ? 'wd-tk' : 'wd-tk six');
      for (const [hr, lbl] of [[6, '6'], [18, '18']]) { const [x, y] = pol(hr * 15 + 180, 68); base += `<text x="${x}" y="${y}" class="wd-lbl">${lbl}</text>`; }
      const svg = h('div.wd-ring', { html: `<svg viewBox="0 0 200 200">${base}<g class="wd-sun"></g><g class="wd-dots"></g></svg>` });
      const sunG = svg.querySelector('.wd-sun'), dotsG = svg.querySelector('.wd-dots');
      sunG.innerHTML = (() => { const [sx, sy] = pol(0, 66), [mx, my] = pol(180, 66); return `<g transform="translate(${sx - 6} ${sy - 6}) scale(.5)">${icon('sun').replace(/<\/?svg[^>]*>/g, '')}</g><g transform="translate(${mx - 6} ${my - 6}) scale(.5)">${icon('moon').replace(/<\/?svg[^>]*>/g, '')}</g>`; })();
      const name = h('div.wd-name', { dir: 'auto' }), country = h('div.wd-country'), time = h('div.wd-time'), rel = h('div.wd-rel'), sun = h('div.wd-sunstate');
      const center = h('button.wd-center', { type: 'button', 'aria-label': 'Next city', onclick: () => { if (!dragMoved) step(1); } }, name, country, time, rel, sun);
      const box = h('div.ck-page.ck-world', svg, center);
      dotsG.addEventListener('click', (e) => { const d = e.target.closest('[data-i]'); if (d && !dragMoved) { e.stopPropagation(); sel = +d.dataset.i; saveClock({ citySel: sel }); app.sfx('tick'); lastSec = -1; frameWorld(); } });
      const step = (d) => { const n = cities().length; if (!n) return; sel = (sel + d + n) % n; saveClock({ citySel: sel }); app.sfx('tick'); lastSec = -1; frameWorld(); };
      let lastSec = -1;
      const frameWorld = () => {
        const now = new Date();
        if (now.getSeconds() === lastSec) return;
        lastSec = now.getSeconds();
        const list = cities();
        if (sel >= list.length) sel = 0;
        const loc = zoneTime(localTz, now);
        const locDay = Date.UTC(loc.y, loc.mo - 1, loc.d);
        let g = '';
        // "you are here" marker (local time) outside the ring
        { const a = (loc.h + loc.m / 60) * 15 + 180, [x, y] = pol(a, 94.5); g += `<path d="M0 -3.6 L3.2 2.4 L-3.2 2.4 Z" class="wd-you" transform="translate(${x} ${y}) rotate(${a + 180})"/>`; }
        const placed = list.map((c, i) => { const z = zoneTime(c.tz, now); return { c, i, z, a: (z.h + z.m / 60) * 15 + 180 }; });
        // the selected one is drawn last (on top)
        placed.sort((p, q) => (p.i === sel) - (q.i === sel));
        for (const p of placed) {
          const alt = sunAltitude(p.c.lat, p.c.lon, now);
          const st = alt > -0.83 ? 'day' : alt > -6 ? 'dusk' : 'night';
          const [x, y] = pol(p.a, 86);
          const on = p.i === sel;
          g += `<g data-i="${p.i}" class="wd-city ${st}${on ? ' on' : ''}" transform="translate(${x} ${y})"><circle r="${on ? 9 : 7}"/><text>${short(p.c.name)}</text></g>`;
        }
        dotsG.innerHTML = g;
        const c = list[sel];
        if (!c) { name.textContent = 'No cities'; country.textContent = ''; time.textContent = ''; rel.textContent = 'Tap + to add one'; sun.replaceChildren(); return; }
        const z = zoneTime(c.tz, now);
        name.textContent = c.name;
        country.textContent = c.country;
        const twelve = !h24();
        time.replaceChildren(twelve ? `${((z.h + 11) % 12) + 1}:${pad(z.m)}` : `${pad(z.h)}:${pad(z.m)}`, twelve ? h('small', ampm(z.h)) : '');
        const dd = Math.round((Date.UTC(z.y, z.mo - 1, z.d) - locDay) / 86400000);
        const diff = z.offsetMin - loc.offsetMin;
        const dh = diff === 0 ? 'Same time as here' : `${diff > 0 ? '+' : '−'}${Math.floor(Math.abs(diff) / 60)}${Math.abs(diff) % 60 ? `:${pad(Math.abs(diff) % 60)}` : ''} h`;
        rel.textContent = `${dd === 0 ? 'Today' : dd > 0 ? 'Tomorrow' : 'Yesterday'} · ${dh}`;
        const alt = sunAltitude(c.lat, c.lon, now);
        sun.replaceChildren(h('i', { html: icon(alt > -0.83 ? 'sun' : 'moon') }), alt > -0.83 ? 'Daytime' : alt > -6 ? 'Twilight' : 'Night');
        sun.dataset.st = alt > -0.83 ? 'day' : 'night';
      };
      return { el: box, frame: frameWorld, refresh: () => { sel = D().citySel || 0; lastSec = -1; frameWorld(); }, action: { icon: 'plus', label: 'Cities', fn: () => openCities() }, key: () => step(1), cities, defaults };
    })();

    // ================================================================ Alarms
    const alarmPage = (() => {
      const head = h('div.al-head'), list = h('div.al-list'), empty = h('div.al-empty');
      const box = h('div.ck-page.ck-alarms', head, list, empty);
      curve(list);
      let lastSig = '', lastMin = -1;
      const render = () => {
        const all = alarms();
        lastSig = JSON.stringify(all) + h24();
        list.replaceChildren(...all.map((a) => {
          const sw = h(`button.switch${a.on ? '.on' : ''}`, { type: 'button', 'aria-label': a.on ? 'Turn off' : 'Turn on', onclick: (e) => {
            e.stopPropagation();
            saveAlarms(alarms().map((x) => (x.id === a.id ? { ...x, on: !x.on, snoozeUntil: 0 } : x)));
            app.sfx('tick');
          } });
          const snz = snoozedUntil(a);
          return h(`div.al-row${a.on ? '' : '.off'}`, { role: 'button', tabindex: 0, onclick: () => { if (!dragMoved) editAlarm(a); } },
            h('div.al-t', fmtHM(a.h, a.m), h24() ? '' : h('small', ampm(a.h))),
            h('div.al-meta', h('div.al-label', { dir: 'auto' }, a.label || 'Alarm'),
              h('div.al-days', snz ? `Snoozed until ${fmtHM(new Date(snz).getHours(), new Date(snz).getMinutes())}` : `${describeDays(a.days)} · ${whatName(a.what)}`)),
            sw);
        }));
        empty.replaceChildren(...(all.length ? [] : [h('i', { html: icon('clock') }), h('div.al-e1', 'No alarms yet'), h('div.al-e2', 'Tap + to set one. It can wake you with a playlist from your music service.')]));
        empty.hidden = !!all.length;
        heading();
      };
      const heading = () => {
        const up = upcoming();
        if (!up) { head.replaceChildren(h('div.al-h1', alarms().length ? 'All alarms are off' : 'Alarms'), h('div.al-h2', 'They ring while Round Remote is open')); return; }
        const mins = Math.max(0, Math.ceil((up.at - Date.now()) / 60000));
        const hrs = Math.floor(mins / 60), mm = mins % 60;
        const inTxt = mins < 1 ? 'in less than a minute' : `in ${hrs ? `${hrs} h ` : ''}${mm || !hrs ? `${mm} min` : ''}`.trim();
        head.replaceChildren(h('div.al-h1', 'Next alarm'), h('div.al-h2', `${inTxt} · ${WEEKDAYS[new Date(up.at).getDay()]} ${fmtHM(new Date(up.at).getHours(), new Date(up.at).getMinutes())}${h24() ? '' : ' ' + ampm(new Date(up.at).getHours())}`));
      };
      render();
      const off = events.on('change', render);
      const frameAlarms = () => {
        const m = new Date().getMinutes();
        if (m !== lastMin) { lastMin = m; heading(); }
        if (JSON.stringify(alarms()) + h24() !== lastSig) render();
      };
      return { el: box, frame: frameAlarms, refresh: render, action: { icon: 'plus', label: 'New alarm', fn: () => editAlarm(null) }, key: () => editAlarm(null), off };
    })();

    const pages = [analog, digital, world, alarmPage];
    pages.forEach((p, i) => { p.el.style.left = `${i * 100}%`; track.append(p.el); });

    // ================================================================ paging (swipe / dots / ← →)
    let dragX = 0;
    function layout(animate = true) {
      track.classList.toggle('anim', animate);
      track.style.transform = `translateX(calc(${-face * 100}% + ${dragX}px))`;
      dots.querySelectorAll('.ck-dot').forEach((d, i) => d.classList.toggle('on', i === face));
      const p = pages[face];
      btnAction.innerHTML = icon(p.action.icon);
      btnAction.setAttribute('aria-label', p.action.label); btnAction.title = p.action.label;
      root.dataset.face = FACES[face];
    }
    function show(i, quiet = false) {
      const n = (i + FACES.length) % FACES.length;
      const changed = n !== face;
      face = n; dragX = 0;
      saveClock({ face: FACES[face] });
      layout(true);
      pages[face].refresh?.();
      pages[face].frame();
      if (changed && !quiet) {
        app.sfx('tick');
        faceName.textContent = FACE_NAMES[FACES[face]];
        faceName.classList.remove('show'); void faceName.offsetWidth; faceName.classList.add('show');
      }
    }
    let drag = null, dragMoved = false;
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.ck-corner, .ck-dots, .switch')) return;
      const [x, y] = toLocal(e.clientX, e.clientY);   // the app may be turned (js/core/orientation.js): swipe along its own axes
      drag = { x, y, id: e.pointerId, horiz: null, w: localRect(root).width };
      dragMoved = false;
    });
    root.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const [px, py] = toLocal(e.clientX, e.clientY);
      const dx = px - drag.x, dy = py - drag.y;
      if (drag.horiz === null && Math.hypot(dx, dy) > 10) {
        drag.horiz = Math.abs(dx) > Math.abs(dy) * 1.1;
        if (drag.horiz) { try { root.setPointerCapture(e.pointerId); } catch {} }
      }
      if (drag.horiz) {
        dragMoved = true;
        dragX = dx * ((face === 0 && dx > 0) || (face === FACES.length - 1 && dx < 0) ? 0.35 : 1);
        layout(false);
      } else if (drag.horiz === false) dragMoved = true;
    });
    const endDrag = (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.horiz) {
        const th = d.w * 0.16;
        if (dragX < -th && face < FACES.length - 1) show(face + 1);
        else if (dragX > th && face > 0) show(face - 1);
        else { dragX = 0; layout(true); }
      }
      if (dragMoved) setTimeout(() => { dragMoved = false; }, 60);
    };
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    root.addEventListener('wheel', (e) => {
      if (e.target.closest('.al-list') && !e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (wheelLock) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(d) < 4) return;
      wheelLock = true; setTimeout(() => { wheelLock = false; }, 350);
      show(face + Math.sign(d));
    }, { passive: false });
    let wheelLock = false;

    app.onKey((e) => {
      if (topPanel()) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); show(face + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); show(face - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pages[face].key?.(); }
    });

    app.raf(() => pages[face].frame());
    // the corner buttons, dots and Back fade away on the analog and digital faces; any touch or key brings them back
    let idleT = 0;
    const wake = () => {
      root.classList.remove('idle');
      clearTimeout(idleT);
      idleT = setTimeout(() => { if (face <= 1 && !topPanel() && !drag) root.classList.add('idle'); else wake(); }, 6000);
    };
    root.addEventListener('pointerdown', wake, true);
    app.onKey(wake);
    wake();
    const awake = () => { if (D().awake !== false) nudgeAwake(); };
    app.every(20000, awake);
    layout(false);
    pages.forEach((p) => p.frame());

    // ================================================================ panels
    function optRow(label, on, onToggle) {
      const sw = h(`span.switch${on ? '.on' : ''}`);
      return h('button.ck-opt', { type: 'button', onclick: () => { const v = !sw.classList.contains('on'); sw.classList.toggle('on', v); onToggle(v); } }, h('span', label), sw);
    }
    function chipRow(items, cur, onPick) {
      const row = h('div.chips');
      const draw = (c) => row.replaceChildren(...items.map((it) => h(`button.chip${it.id === c ? '.on' : ''}`, { type: 'button', onclick: () => { onPick(it.id); draw(it.id); } }, it.name)));
      draw(cur);
      return row;
    }
    function openSettings() {
      openPanel({
        title: 'Clock settings', className: 'ck-panel',
        build(body) {
          const sc = h('div.ck-form');
          sc.append(
            optRow('24-hour clock', h24(), (v) => { saveClock({ h24: v }); pages.forEach((p) => p.refresh?.()); }),
            optRow('Seconds on the digital clock', D().showSec !== false, (v) => { saveClock({ showSec: v }); digital.refresh(); }),
            optRow('Keep the screen awake', D().awake !== false, (v) => { saveClock({ awake: v }); if (v) nudgeAwake(); }),
            h('div.ck-lbl', 'Analog face'),
            chipRow(ANALOG_STYLES, D().analogStyle || 'classic', (id) => analog.setStyle(id)),
            h('div.ck-lbl', 'Digital numbers'),
            chipRow(DIGITAL_FONTS, D().digitalFont || 'modern', (id) => { saveClock({ digitalFont: id }); digital.refresh(); }),
            h('div.ck-note', 'Alarms ring on any screen while Round Remote is open (after the Clock has been opened once). They can’t ring when the display or browser is off.'),
          );
          body.append(sc);
        },
      });
    }
    function openCities() {
      openPanel({
        title: 'World clock', className: 'ck-panel ck-cities',
        build(body) {
          const input = h('input.ck-q', { type: 'text', placeholder: 'Search cities', autocomplete: 'off', spellcheck: 'false', dir: 'auto' });
          const bar = h('div.ck-search', h('i', { html: icon('search') }), input);
          const list = h('div.list.ck-clist');
          body.append(bar, list); curve(list);
          const ids = () => world.cities().map((c) => c.id);
          const render = () => {
            const q = input.value.trim().toLowerCase();
            const mine = ids();
            const now = new Date();
            const row = (c) => {
              const z = zoneTime(c.tz, now), on = mine.includes(c.id);
              return listRow({
                title: c.name, subtitle: `${c.country} · ${fmtHM(z.h, z.m)}${h24() ? '' : ' ' + ampm(z.h)}`, mono: short(c.name), color: '#60a5fa', active: on,
                right: h('i.ck-cright', { html: icon(on ? 'check' : 'plus') }),
                onClick: () => {
                  let next = on ? mine.filter((x) => x !== c.id) : [...mine, c.id];
                  if (next.length > 12) { app.toast('Up to 12 cities'); return; }
                  saveClock({ cities: next, citySel: on ? 0 : next.length - 1 });
                  app.sfx(on ? 'tap' : 'pop');
                  world.refresh(); render();
                },
              });
            };
            const match = (c) => !q || `${c.name} ${c.country} ${c.tz}`.toLowerCase().includes(q);
            const sel = mine.map(cityById).filter((c) => c && match(c));
            const rest = CITIES.filter((c) => !mine.includes(c.id) && match(c)).sort((a, b) => a.name.localeCompare(b.name));
            list.replaceChildren(...sel.map(row), ...(sel.length && rest.length ? [h('div.ck-sep', 'Add a city')] : []), ...rest.map(row));
            if (!sel.length && !rest.length) list.append(h('div.empty', 'No city found'));
          };
          if (wantsKeyboard()) {
            input.readOnly = true;
            bar.addEventListener('click', async () => { const v = await app.editText({ title: 'Search cities', value: input.value, okLabel: 'Search' }); if (v !== null) { input.value = v; render(); } });
          } else {
            input.addEventListener('input', render);
          }
          render();
        },
      });
    }

    function editAlarm(existing) {
      const now = new Date();
      const draft = existing ? JSON.parse(JSON.stringify(existing)) : {
        id: `a${Date.now().toString(36)}`, h: (now.getHours() + 1) % 24, m: 0, days: [], label: '', on: true, snoozeMin: 9,
        what: { ...DEFAULT_WHAT, ...(alarms().at(-1)?.what || {}) },
      };
      let unit = 'h';
      openPanel({
        title: existing ? 'Edit alarm' : 'New alarm', className: 'ck-panel ck-edit',
        build(body, panel) {
          const sc = h('div.ck-form');
          // ---- time
          const hEl = h('div.ck-num'), mEl = h('div.ck-num'), apEl = h('button.chip.ck-apchip', { type: 'button', onclick: () => { draft.h = (draft.h + 12) % 24; draw(); } });
          const draw = () => {
            hEl.textContent = h24() ? pad(draft.h) : String(((draft.h + 11) % 12) + 1);
            mEl.textContent = pad(draft.m);
            apEl.textContent = ampm(draft.h); apEl.hidden = h24();
            hUnit.classList.toggle('sel', unit === 'h'); mUnit.classList.toggle('sel', unit === 'm');
            when.textContent = whenText();
          };
          const bump = (u, d) => { if (u === 'h') draft.h = (draft.h + d + 24) % 24; else draft.m = (draft.m + d + 60) % 60; unit = u; app.sfx('tick'); draw(); };
          const holdBtn = (ic, label, fn) => {
            const b = h('button.ibtn.small.ck-arrow', { type: 'button', 'aria-label': label, html: icon(ic) });
            let t = null;
            const stop = () => { clearTimeout(t); clearInterval(t); t = null; };
            b.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); t = setTimeout(() => { t = setInterval(fn, 90); }, 380); });
            ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
            return b;
          };
          const unitBox = (u) => {
            const box = h('div.ck-unit', holdBtn('chevron', 'Up', () => bump(u, 1)), u === 'h' ? hEl : mEl, holdBtn('chevron', 'Down', () => bump(u, -1)));
            box.lastChild.classList.add('down');
            (u === 'h' ? hEl : mEl).addEventListener('click', () => { unit = u; draw(); });
            box.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); bump(u, e.deltaY < 0 ? 1 : -1); }, { passive: false });
            return box;
          };
          const hUnit = unitBox('h'), mUnit = unitBox('m');
          const when = h('div.ck-when');
          const whenText = () => {
            const at = nextRing({ ...draft, on: true });
            if (!at) return '';
            const mins = Math.ceil((at - Date.now()) / 60000), hr = Math.floor(mins / 60);
            return `Rings in ${hr ? `${hr} h ` : ''}${mins % 60} min`;
          };
          sc.append(h('div.ck-tset', hUnit, h('div.ck-colon', ':'), mUnit, apEl), when);
          // ---- repeat
          const days = h('div.chips.multi.ck-days');
          const drawDays = () => days.replaceChildren(...DAY_LETTERS.map((L, i) => h(`button.chip${draft.days.includes(i) ? '.on' : ''}`, {
            type: 'button', 'aria-label': WEEKDAYS[i], onclick: () => { draft.days = draft.days.includes(i) ? draft.days.filter((x) => x !== i) : [...draft.days, i].sort(); drawDays(); draw(); },
          }, L)));
          drawDays();
          const repTxt = h('div.ck-note');
          const presets = h('div.chips', [['Once', []], ['Weekdays', [1, 2, 3, 4, 5]], ['Sun–Thu', [0, 1, 2, 3, 4]], ['Every day', [0, 1, 2, 3, 4, 5, 6]]].map(([n, d]) =>
            h('button.chip.ck-mini', { type: 'button', onclick: () => { draft.days = [...d]; drawDays(); draw(); } }, n)));
          sc.append(h('div.ck-lbl', 'Repeat'), days, presets, repTxt);
          // ---- label
          const labelBtn = h('button.pill.ck-labelbtn', { type: 'button', dir: 'auto', onclick: async () => {
            const v = await app.editText({ title: 'Alarm label', value: draft.label, placeholder: 'Wake up' });
            if (v !== null) { draft.label = v; labelBtn.textContent = v || 'Add a label'; }
          } }, draft.label || 'Add a label');
          sc.append(h('div.ck-lbl', 'Label'), labelBtn);
          // ---- what plays
          sc.append(h('div.ck-lbl', 'What plays'), whatEditor({ get: () => draft.what, set: (c) => { draft.what = c; }, songLabel: 'Current song', songHint: 'Plays (resumes) the song that is on in your music service.' }));
          // ---- snooze
          sc.append(h('div.ck-lbl', 'Snooze'), chipRow([5, 9, 10, 15, 20].map((n) => ({ id: n, name: `${n} min` })), draft.snoozeMin || 9, (v) => { draft.snoozeMin = v; }));
          // ---- buttons
          const save = () => {
            const list = alarms();
            draft.on = true; draft.snoozeUntil = 0;
            const i = list.findIndex((x) => x.id === draft.id);
            if (i >= 0) list[i] = draft; else list.push(draft);
            list.sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
            saveAlarms(list);
            app.sfx('pop');
            panel.close();
            if (face !== 3) show(3);
            const at = nextRing(draft);
            if (at) { const mins = Math.ceil((at - Date.now()) / 60000); app.toast(`Alarm set for ${Math.floor(mins / 60)} h ${mins % 60} min from now`); }
          };
          sc.append(h('div.ck-btns',
            h('button.pill.primary', { type: 'button', onclick: save, '--c': '#60a5fa' }, 'Save'),
            h('button.pill', { type: 'button', onclick: () => testAlarm(draft) }, 'Test'),
            existing ? h('button.pill.danger', { type: 'button', onclick: () => { saveAlarms(alarms().filter((x) => x.id !== draft.id)); app.sfx('drop'); panel.close(); } }, 'Delete') : null));
          body.append(sc);
          draw();
          panel.onKey = (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); bump(unit, 1); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); bump(unit, -1); }
            else if (e.key === 'Tab') { e.preventDefault(); unit = unit === 'h' ? 'm' : 'h'; draw(); }
            else if (e.key === 'Enter' && e.target === document.body) { e.preventDefault(); save(); }
          };
          editKeys = panel;
        },
        onClose: () => { editKeys = null; },
      });
    }
    let editKeys = null;
    app.onKey((e) => { if (editKeys && topPanel() === editKeys) editKeys.onKey(e); });

    function whatName(w) {
      if (!w || w.what === 'sound') return 'Alarm sound';
      if (w.what === 'song') return 'Current song';
      return w.playlist?.name || 'Playlist';
    }

    show(face, true);
    return {
      destroy() { alarmPage.off?.(); clearTimeout(idleT); },
      back() { return false; },
    };
  },
};
