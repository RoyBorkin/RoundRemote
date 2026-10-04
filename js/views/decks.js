// The other "players" of the Vinyl view (js/views/vinyl.js picks one): a cassette and a CD
// (data side or label side). Each behaves like the record: the motor eases up and down with
// play/pause, dragging scrubs through the song (with fling momentum), seeking animates, and the
// song's title/artist is printed on it. Looks: js/views/deck-styles.js + css/decks.css.
//
// Performance (Raspberry Pi): the drawings are SVG/CSS painted once per song or style; per frame
// only transforms change (2 hubs + 2 tape packs for the cassette, the disc + its text for a CD,
// the read-laser dot), so everything moving is a cheap composited layer.
import { h } from '../ui/dom.js';
import { store } from '../core/store.js';
import { angleFromCenter, angleDelta, distFromCenter, clamp, throttle, fmtTime } from '../core/util.js';
import { TAPE, tapeStyle, cdBackStyle, cdTopStyle, TAPE_STYLES, CD_BACK_STYLES, CD_TOP_STYLES,
  tapeBackMarkup, tapeFrontMarkup, hubMarkup, tapePath, tapeGuidesMarkup } from './deck-styles.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (cls, viewBox) => {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', viewBox); s.setAttribute('aria-hidden', 'true');
  s.classList.add(...cls.split(' '));
  return s;
};
const trackKey = (t) => (t ? `${t.id || ''}|${t.title}|${t.artist}` : '');

/** Shared scrub state: preview while dragging, live-seek on local players, seek on release. */
function scrubber(player, onPreview) {
  let ms = null;
  const liveSeek = throttle((v) => player.seek(v), 300);
  return {
    get ms() { return ms; },
    move(dMs) {
      if (!player.caps.seek || !player.state.track) return;
      if (ms == null) ms = player.position();
      ms = clamp(ms + dMs, 0, player.duration());
      onPreview?.(ms);
      if (player.provider?.local) liveSeek(ms);
    },
    commit() { if (ms != null && player.caps.seek) player.seek(ms); ms = null; onPreview?.(null); },
  };
}

/** Fit an SVG <text> into maxW user units: squeeze a little, then shorten with an ellipsis. */
function fitText(t, text, maxW) {
  t.removeAttribute('textLength'); t.removeAttribute('lengthAdjust');
  t.textContent = text;
  if (!text) return;
  let w = 0;
  try { w = t.getComputedTextLength(); } catch { return; }
  if (!w || w <= maxW) return;
  if (w <= maxW * 1.3) { t.setAttribute('textLength', maxW); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); return; }
  let s = text;
  while (s.length > 3 && t.getComputedTextLength() > maxW * 1.25) { s = s.slice(0, -1); t.textContent = `${s.trimEnd()}…`; }
  t.setAttribute('textLength', maxW); t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
}

// ================================================================ cassette
const MS_PER_UNIT = 24;       // drag 1 unit of tape (0.1 mm) = 24 ms of music → the whole cassette width ≈ 24 s
const V_PLAY = 0.476;         // tape speed while playing: 4.76 cm/s = 0.476 units/ms (real reel speeds)
const RAD = 180 / Math.PI;

export function createTapeView({ player, onPreview }) {
  const { W, H, R0, RMAX } = TAPE;
  const back = svg('tp-layer tp-back', `0 0 ${W} ${H}`);
  const tape = svg('tp-layer tp-tape', `0 0 ${W} ${H}`);
  const front = svg('tp-layer tp-front', `0 0 ${W} ${H}`);
  const mkReel = (side) => {
    const pack = h('div.tp-pack'), hub = h('div.tp-hub');
    return { el: h(`div.tp-reel.${side}`, pack, hub), pack, hub, rot: side === 'l' ? 0 : 23, r: -1 };
  };
  const reelL = mkReel('l'), reelR = mkReel('r');
  const cass = h('div.tp-cass', back, reelL.el, reelR.el, tape, front, h('div.tp-glare'));
  const el = h('div.view.view-tape', h('div.tp-floor'), cass);

  let style = null, tapeLine = null, drawnL = -1, drawnR = -1;
  function applyStyle() {
    const st = tapeStyle(store.get('tapeStyle'));
    if (st === style) return;
    style = st;
    for (const s of TAPE_STYLES) el.classList.toggle(`ts-${s.id}`, s.id === st);
    back.innerHTML = tapeBackMarkup(st);
    tape.innerHTML = `<path class="tp-run" fill="none"/>${tapeGuidesMarkup(st)}`;
    tapeLine = tape.querySelector('.tp-run');
    front.innerHTML = tapeFrontMarkup(st);
    reelL.hub.innerHTML = reelR.hub.innerHTML = hubMarkup(st);
    reelL.r = reelR.r = -1; drawnL = drawnR = -1;
    paintLabel(true);
  }

  // ---- label text / artwork (only when the song or style changes) ----
  let lastTrack = null, labelKey = '';
  function paintLabel(force = false) {
    const t = lastTrack;
    const key = `${trackKey(t)}|${t?.art || ''}|${t?.durationMs || 0}`;
    if (!force && key === labelKey) return;
    labelKey = key;
    const title = t?.title || 'Round Remote', artist = t ? [t.artist, t.album].filter(Boolean).join(' · ') : 'Side A · press play';
    const maxT = style === 'classic' ? 724 : style === 'metal' ? 690 : 720;
    const maxA = style === 'classic' ? 800 : style === 'metal' ? 690 : 720;
    const tt = front.querySelector('.tp-title'), ta = front.querySelector('.tp-artist');
    if (tt) fitText(tt, style === 'metal' ? title.toUpperCase() : title, maxT);
    if (ta) fitText(ta, style === 'metal' ? artist.toUpperCase() : artist, maxA);
    for (const i of front.querySelectorAll('.tp-art')) {
      if (t?.art) { i.setAttribute('href', t.art); i.style.display = ''; } else { i.removeAttribute('href'); i.style.display = 'none'; }
    }
    const len = front.querySelector('.tp-len');
    if (len) len.textContent = t?.durationMs ? (style === 'clear' ? `SIDE A · ${fmtTime(t.durationMs)}` : `${style === 'metal' ? '' : 'C·'}${fmtTime(t.durationMs)}`) : '';
  }
  // the handwriting / condensed fonts may arrive after the first measure
  document.fonts?.ready?.then(() => paintLabel(true)).catch(() => {});

  applyStyle();
  const offStyle = store.on('change:tapeStyle', applyStyle);
  const onAny = (k) => { if (k === '*') { style = null; applyStyle(); } };
  store.on('change', onAny);

  // ---- motion ----
  let motor = 0, lastT = performance.now(), pDisp = 0, lastKey = null, pendingL = 0;
  let drag = null, inertia = false, vel = 0, lastMoveT = 0;
  const scrub = scrubber(player, onPreview);
  const packR = (p) => Math.sqrt(R0 * R0 + (RMAX * RMAX - R0 * R0) * clamp(p, 0, 1));

  function jog(dL) { pendingL += dL; scrub.move(dL * MS_PER_UNIT); }

  el.addEventListener('pointerdown', (e) => {
    if (distFromCenter(el, e.clientX, e.clientY) > 0.9) return; // outer band = progress ring
    const box = cass.getBoundingClientRect();
    const unit = box.width / W;
    // on a reel: turn it like a pencil in the hub; anywhere else: pull the tape sideways
    let mode = { kind: 'slide', x: e.clientX, unit };
    for (const reel of [reelL, reelR]) {
      const rb = reel.el.getBoundingClientRect();
      const cx = rb.left + rb.width / 2, cy = rb.top + rb.height / 2;
      if (Math.hypot(e.clientX - cx, e.clientY - cy) < Math.max(reel.r, R0 + 10) * unit) {
        mode = { kind: 'reel', reel, cx, cy, a: Math.atan2(e.clientY - cy, e.clientX - cx) };
      }
    }
    drag = { id: e.pointerId, ...mode };
    inertia = false; vel = 0; lastMoveT = performance.now();
    el.setPointerCapture(e.pointerId);
    el.classList.add('grab');
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    let dL = 0;
    if (drag.kind === 'slide') { dL = (e.clientX - drag.x) / drag.unit; drag.x = e.clientX; }
    else {
      const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
      dL = -angleDelta(drag.a, a) * drag.reel.r; drag.a = a;   // anticlockwise = forward
    }
    if (Math.abs(dL) < 0.3) return;
    const t = performance.now(), dt = Math.max(1, t - lastMoveT);
    vel = vel * 0.5 + (dL / dt) * 0.5; lastMoveT = t;
    jog(dL);
  });
  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null; el.classList.remove('grab');
    if (performance.now() - lastMoveT < 80 && Math.abs(vel) > 0.25) inertia = true;
    else scrub.commit();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  const setReel = (reel, r, other) => {
    const s = (r / RMAX).toFixed(4);
    reel.pack.style.transform = `rotate(${reel.rot.toFixed(2)}deg) scale(${s})`;
    reel.hub.style.transform = `rotate(${reel.rot.toFixed(2)}deg)`;
    reel.r = r;
  };

  return {
    el,
    isInteractive: true,
    update(s) {
      lastTrack = s.track || null;
      paintLabel();
      el.classList.toggle('playing', !!s.isPlaying);
    },
    tick(pos, s) {
      const now = performance.now();
      const dt = Math.min(64, now - lastT); lastT = now;
      const target = s.isPlaying && !drag ? 1 : 0;
      motor += (target - motor) * (target > motor ? 0.08 : 0.05) * (dt / 16.7);
      if (motor < 0.002) motor = 0;
      let dL = 0;
      if (!drag && !inertia) dL += V_PLAY * dt * motor;
      if (inertia) {
        jog(vel * dt);
        vel *= Math.pow(0.96, dt / 16.7);
        if (Math.abs(vel) < 0.03) { inertia = false; scrub.commit(); }
      }
      dL += pendingL; pendingL = 0;
      // tape packs follow the (scrubbed) position; a jump (seek, ring, knob) winds there fast
      const dur = player.duration();
      const want = dur ? clamp((scrub.ms ?? pos) / dur, 0, 1) : 0;
      const key = trackKey(s.track);
      if (key !== lastKey || drag || inertia || scrub.ms != null) { pDisp = want; lastKey = key; }
      else {
        const diff = want - pDisp;
        if (Math.abs(diff) < 0.003) pDisp = want;
        else {
          const step = diff * (1 - Math.pow(0.86, dt / 16.7));
          pDisp += step; dL += (step * dur) / MS_PER_UNIT;
        }
      }
      const rS = packR(1 - pDisp), rT = packR(pDisp);
      // both reels turn anticlockwise when the tape runs left → right; the smaller pack turns faster
      reelL.rot = (reelL.rot - (dL / rS) * RAD) % 3600;
      reelR.rot = (reelR.rot - (dL / rT) * RAD) % 3600;
      setReel(reelL, rS); setReel(reelR, rT);
      if (Math.abs(rS - drawnL) > 0.6 || Math.abs(rT - drawnR) > 0.6) {
        drawnL = rS; drawnR = rT;
        tapeLine?.setAttribute('d', tapePath(rS, rT));
      }
    },
    destroy() { onPreview?.(null); offStyle(); store.off('change', onAny); },
  };
}

// ================================================================ CD (data side / label side)
// Radii as a fraction of the disc radius (a 120 mm disc fills the round screen).
const CD_DATA_IN = 0.385, CD_DATA_OUT = 0.955;

export function createCdView({ player, onPreview, side = 'back' }) {
  const top = side === 'top';
  const disc = h('div.cd-disc');
  const print = svg('cd-print', '0 0 200 200');   // text printed / engraved on the disc: turns with it
  const el = h(`div.view.view-cd.cd-${side}`);
  const laser = h('div.cd-laser', h('i'));
  const burn = h('div.cd-burn');
  if (top) {
    el.append(disc, h('div.ct-gloss'), h('div.cd-hub'), h('div.cd-hole'));
    disc.append(h('div.ct-face'), h('div.ct-art'), h('div.ct-sticker', h('i')), print);
  } else {
    disc.append(h('div.cd-data'), h('div.cd-scratch'));
    el.append(disc, burn, h('div.cd-art'), h('div.cd-sheen'), h('div.cd-sheen2'), h('div.cd-hub'), print, h('div.cd-hole'), laser);
  }
  const sheens = [...el.querySelectorAll('.cd-sheen, .cd-sheen2, .ct-gloss')];

  let style = null;
  const STYLES = top ? CD_TOP_STYLES : CD_BACK_STYLES;
  const storeKey = top ? 'cdTopStyle' : 'cdBackStyle';
  function applyStyle() {
    const st = (top ? cdTopStyle : cdBackStyle)(store.get(storeKey));
    if (st === style) return;
    style = st;
    for (const s of STYLES) el.classList.toggle(`${top ? 'ct' : 'cb'}-${s.id}`, s.id === st);
    el.classList.toggle('bright', top ? st !== 'print' : st !== 'black');   // light discs: darker backing for the controls
    paint(true);
  }

  // ---- printed / engraved text + artwork (only when the song or style changes) ----
  let lastTrack = null, paintedKey = '';
  function arc(id, r, startDeg = -90) {
    // a full circle path starting at startDeg (clockwise), for <textPath>
    const a = (startDeg * Math.PI) / 180, x = 100 + r * Math.cos(a), y = 100 + r * Math.sin(a);
    return `<path id="${id}" d="M${x.toFixed(2)} ${y.toFixed(2)} A${r} ${r} 0 1 1 ${(200 - x).toFixed(2)} ${(200 - y).toFixed(2)} A${r} ${r} 0 1 1 ${x.toFixed(2)} ${y.toFixed(2)}"/>`;
  }
  // repeat a ring text so it runs most of the way round (cap = characters that fit)
  const ring = (text, cap) => text.repeat(Math.max(1, Math.floor(cap / Math.max(1, text.length))));
  function paint(force = false) {
    const t = lastTrack;
    const key = `${style}|${trackKey(t)}|${t?.album || ''}|${t?.art || ''}`;
    if (!force && key === paintedKey) return;
    paintedKey = key;
    const art = t?.art ? `url("${t.art}")` : '';
    for (const a of el.querySelectorAll('.cd-art, .ct-art, .ct-sticker i')) a.style.backgroundImage = art;
    el.classList.toggle('noart', !t?.art);
    const title = t?.title || 'Round Remote', artist = t?.artist || '', album = t?.album || '';
    const T = (sel) => print.querySelector(sel);
    if (!top) {
      // matrix code engraved in the mirror band around the hub
      const code = `RR-${(Math.abs([...title + artist].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7)) % 99991).toString().padStart(5, '0')}`;
      print.innerHTML = `<defs>${arc('cdMx', 33.6, -90)}</defs><text class="cd-matrix deck-title"><textPath href="#cdMx"></textPath></text>`;
      T('textPath').textContent = ring(`${title.toUpperCase()}  ·  ${artist.toUpperCase()}   ◦   ${code} 1A1   ◦   ${album ? album.toUpperCase() + '   ◦   ' : ''}`, 96);
      return;
    }
    if (style === 'print') {
      print.innerHTML = `<defs>${arc('ctIn', 31.4, -90)}</defs>
        <circle cx="100" cy="100" r="31.4" class="ct-band"/>
        <text class="ct-ring-text deck-title"><textPath href="#ctIn"></textPath></text>`;
      T('textPath').textContent = ring(`${title}  •  ${artist}  •  ${album ? album + '  •  ' : ''}`.toUpperCase(), 64);
    } else if (style === 'ring') {
      print.innerHTML = `<defs>${arc('ctT', 42.5, -90)}${arc('ctA', 89, -90)}</defs>
        <circle cx="100" cy="100" r="53" class="ct-line"/><circle cx="100" cy="100" r="81" class="ct-line"/>
        <text class="ct-ring-title deck-title"><textPath href="#ctT"></textPath></text>
        <text class="ct-ring-artist deck-title"><textPath href="#ctA"></textPath></text>`;
      T('.ct-ring-title textPath').textContent = ring(`${title}  ◆  `, 64);
      T('.ct-ring-artist textPath').textContent = ring(`${[artist, album].filter(Boolean).join('   ·   ').toUpperCase()}   ·   `, 150);
    } else {
      // CD-R: written by hand with a marker; the duration scribbled on the side
      print.innerHTML = `
        <text class="ct-hand ct-hand-title deck-title" x="100" y="61" text-anchor="middle" transform="rotate(-5 100 61)"></text>
        <path class="ct-swoosh deck-title" d="M66 67 Q100 62 136 65" transform="rotate(-5 100 61)"/>
        <text class="ct-hand ct-hand-artist deck-title" x="100" y="146" text-anchor="middle" transform="rotate(3 100 146)"></text>
        <text class="ct-hand ct-hand-album deck-title" x="100" y="159" text-anchor="middle" transform="rotate(3 100 159)"></text>
        <text class="ct-hand ct-hand-time" x="42" y="104" text-anchor="middle" transform="rotate(-12 42 104)"></text>`;
      fitText(T('.ct-hand-title'), title, 100);
      fitText(T('.ct-hand-artist'), artist, 92);
      fitText(T('.ct-hand-album'), album, 76);
      T('.ct-hand-time').textContent = t?.durationMs ? fmtTime(t.durationMs) : '';
    }
  }
  document.fonts?.ready?.then(() => paint(true)).catch(() => {});

  applyStyle();
  const offStyle = store.on(`change:${storeKey}`, applyStyle);
  const onAny = (k) => { if (k === '*') { style = null; applyStyle(); } };
  store.on('change', onAny);

  // ---- motion: spin like the record (constant linear velocity: faster near the hub), scratch to scrub ----
  let rot = 0, speed = 0, lastT = performance.now();
  let dragging = false, lastAngle = 0, lastMoveT = 0, angVel = 0, inertia = false, pointerId = null;
  let laserR = CD_DATA_IN, lastLaser = -1, lastSheen = 1e9;
  const perTurnMs = () => (store.get('vinylSecondsPerTurn') || 1.8) * 1000;
  const scrub = scrubber(player, onPreview);
  const applyDelta = (deg) => { rot += deg; scrub.move((deg / 360) * perTurnMs()); };

  el.addEventListener('pointerdown', (e) => {
    if (distFromCenter(el, e.clientX, e.clientY) > 0.9) return;
    dragging = true; inertia = false; pointerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    lastAngle = angleFromCenter(el, e.clientX, e.clientY);
    lastMoveT = performance.now(); angVel = 0;
    el.classList.add('grab');
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const a = angleFromCenter(el, e.clientX, e.clientY);
    const d = (angleDelta(lastAngle, a) * 180) / Math.PI;
    if (Math.abs(d) > 0.2) {
      const t = performance.now(), dt = Math.max(1, t - lastMoveT);
      angVel = angVel * 0.5 + (d / dt) * 0.5;
      lastMoveT = t; lastAngle = a;
      applyDelta(d);
    }
  });
  const end = (e) => {
    if (!dragging || (e && e.pointerId !== pointerId)) return;
    dragging = false; el.classList.remove('grab');
    if (performance.now() - lastMoveT < 80 && Math.abs(angVel) > 0.15) inertia = true;
    else scrub.commit();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  return {
    el,
    isInteractive: true,
    update(s) {
      lastTrack = s.track || null;
      paint();
      el.classList.toggle('playing', !!s.isPlaying);
    },
    tick(pos, s) {
      const now = performance.now();
      const dt = Math.min(64, now - lastT); lastT = now;
      const target = s.isPlaying && !dragging ? 1 : 0;
      speed += (target - speed) * (target > speed ? 0.05 : 0.022) * (dt / 16.7);
      // where the laser reads (follows the scrub / seeks smoothly)
      const dur = player.duration();
      const p = dur ? clamp((scrub.ms ?? pos) / dur, 0, 1) : 0;
      const wantR = CD_DATA_IN + (CD_DATA_OUT - CD_DATA_IN) * p;
      laserR += (wantR - laserR) * (scrub.ms != null ? 0.4 : 0.1) * (dt / 16.7);
      // CLV: a CD turns faster while reading near the hub (≈ 2.5× faster at the start than at the end)
      const turnMs = perTurnMs() * 0.62 * (laserR / 0.5);
      if (!dragging && !inertia) rot += speed * dt * (360 / turnMs);
      if (inertia) {
        applyDelta(angVel * dt);
        angVel *= Math.pow(0.94, dt / 16.7);
        if (Math.abs(angVel) < 0.02) { inertia = false; scrub.commit(); }
      }
      rot %= 360000;
      const tr = `rotate(${rot.toFixed(2)}deg)`;
      disc.style.transform = tr;
      if (!top) print.style.transform = tr;   // the label side's print is inside the disc already
      // the reflections stay with the light, but the disc's slight wobble makes them shimmer
      const wob = Math.sin((rot * Math.PI) / 180) * 2.2 * Math.min(1, speed * 1.5 + (dragging || inertia ? 1 : 0));
      if (Math.abs(wob - lastSheen) > 0.05) { lastSheen = wob; for (const sh of sheens) sh.style.transform = `rotate(${wob.toFixed(2)}deg)`; }
      if (Math.abs(laserR - lastLaser) > 0.0004) {
        lastLaser = laserR;
        if (!top) {
          laser.style.transform = `translateX(${(laserR * 50).toFixed(2)}cqmin)`;
          burn.style.transform = `scale(${laserR.toFixed(4)})`;
        }
      }
      el.classList.toggle('reading', speed > 0.3 || dragging || inertia);
    },
    destroy() { onPreview?.(null); offStyle(); store.off('change', onAny); },
  };
}
