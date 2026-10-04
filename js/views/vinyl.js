// View 2: the whole round screen becomes a record. Spin it with a finger to scrub
// backward/forward (with fling inertia); the tone arm tracks song progress.
import { h } from '../ui/dom.js';
import { store } from '../core/store.js';
import { angleFromCenter, angleDelta, distFromCenter, clamp, throttle } from '../core/util.js';
import { VINYL_DESIGNS, ARM_DESIGNS, DEFAULT_VINYL_COLOR, vinylDesign, vinylColor, armDesign, luminance, armMarkup, swirlTexture } from './vinyl-styles.js';

// One setting drives both the spin and the scratch: the record turns once per
// `vinylSecondsPerTurn` seconds of music (1.8 s = a real 33⅓ rpm record), so dragging it
// one full turn moves exactly that much through the song.
// Tone-arm geometry in a 0..100 viewBox (see README for the derivation).
const PIVOT = { x: 86, y: 13 }, ARM_LEN = 42;
const D = Math.hypot(50 - PIVOT.x, 50 - PIVOT.y);
const BASE_DEG = (Math.atan2(-(50 - PIVOT.x), 50 - PIVOT.y) * 180) / Math.PI;
function armDegForRadius(r) {
  const c = clamp((D * D + ARM_LEN * ARM_LEN - r * r) / (2 * D * ARM_LEN), -1, 1);
  return BASE_DEG - (Math.acos(c) * 180) / Math.PI;
}
const ARM_OUTER = armDegForRadius(43.5), ARM_REST = ARM_OUTER - 8;

export function createVinylView({ player, onPreview }) {
  const label = h('div.vinyl-label');
  const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  labelText.setAttribute('viewBox', '0 0 100 100');
  labelText.classList.add('vinyl-label-text');
  labelText.innerHTML = `<defs><path id="lblArc" d="M 50,50 m -40,0 a 40,40 0 1,1 80,0 a 40,40 0 1,1 -80,0"/></defs>
    <text><textPath href="#lblArc" startOffset="0"></textPath></text>`;
  const swirl = h('div.vinyl-swirl');
  const disc = h('div.vinyl-disc', h('div.vinyl-grooves'), swirl, h('div.vinyl-bands'), label, labelText, h('div.vinyl-hole'));
  const under = h('div.vinyl-under'); // static layer seen through the Clear record
  const sheen = h('div.vinyl-sheen');
  const arm = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arm.setAttribute('viewBox', '0 0 100 100');
  arm.classList.add('tonearm');
  let armRot = null;
  const el = h('div.view.view-vinyl', under, disc, sheen, arm);

  // Looks (css/vinyl.css): record design + colour as classes / variables, the arm redrawn as SVG.
  let curArm = null;
  function applyLook() {
    const design = vinylDesign(store.get('vinylDesign'));
    const color = vinylColor(store.get('vinylColor'));
    for (const d of VINYL_DESIGNS) el.classList.toggle(`vd-${d.id}`, d.id === design);
    el.classList.toggle('vc-custom', color !== DEFAULT_VINYL_COLOR);
    el.style.setProperty('--vc', color);
    const lum = luminance(color);
    el.style.setProperty('--vc-ink', lum > 0.36 ? '#000' : '#fff');
    el.classList.toggle('vc-light', lum > 0.36);
    el.classList.toggle('vc-pale', lum > 0.7);
    swirl.style.backgroundImage = design === 'clear' && swirlTexture() ? `url("${swirlTexture()}")` : '';
    const ad = armDesign(store.get('armDesign'));
    if (ad !== curArm) {
      const prev = armRot?.style.transform || '';
      arm.innerHTML = armMarkup(ad, PIVOT, ARM_LEN);
      armRot = arm.querySelector('.arm-rot');
      armRot.style.transform = prev;
      for (const a of ARM_DESIGNS) arm.classList.toggle(`arm-${a.id}`, a.id === ad);
      curArm = ad;
    }
  }
  applyLook();
  const offLook = ['vinylDesign', 'vinylColor', 'armDesign'].map((k) => store.on(`change:${k}`, () => applyLook()));
  const onAny = (k) => { if (k === '*') { applyLook(); applyLabel(); } };
  store.on('change', onAny);

  // Centre artwork size: 0 = no artwork … 100 = artwork fills the whole record.
  let armInner = armDegForRadius(25.5);
  function applyLabel(v = store.get('vinylLabelSize')) {
    v = clamp(+v || 0, 0, 100);
    el.style.setProperty('--lbl', v);
    el.classList.toggle('no-label', v < 1);
    el.classList.toggle('big-label', v > 86);
    el.classList.toggle('small-label', v < 22);
    armInner = armDegForRadius(clamp(v / 2 + 2.5, 12, 40));
  }
  applyLabel();
  const offLabel = store.on('change:vinylLabelSize', applyLabel);

  let rot = 0, speed = 0, lastT = performance.now();
  let dragging = false, lastAngle = 0, lastMoveT = 0, angVel = 0; // deg/ms
  let scrubMs = null, inertia = false, pointerId = null;
  let armDeg = ARM_REST;

  const perTurnMs = () => (store.get('vinylSecondsPerTurn') || 1.8) * 1000;
  const liveSeek = throttle((ms) => player.seek(ms), 300);

  function beginScrub() { if (scrubMs == null) scrubMs = player.position(); }
  function applyDelta(deg) {
    rot += deg;
    if (!player.caps.seek || !player.state.track) return;
    beginScrub();
    scrubMs = clamp(scrubMs + (deg / 360) * perTurnMs(), 0, player.duration());
    onPreview?.(scrubMs);
    if (player.provider?.local) liveSeek(scrubMs);
  }
  function commit() {
    if (scrubMs != null && player.caps.seek) player.seek(scrubMs);
    scrubMs = null; onPreview?.(null);
  }

  el.addEventListener('pointerdown', (e) => {
    if (distFromCenter(el, e.clientX, e.clientY) > 0.9) return; // outer band = progress ring
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
    const t = performance.now();
    if (Math.abs(d) > 0.2) {
      const dt = Math.max(1, t - lastMoveT);
      angVel = angVel * 0.5 + (d / dt) * 0.5;
      lastMoveT = t; lastAngle = a;
      applyDelta(d);
    }
  });
  const end = (e) => {
    if (!dragging || (e && e.pointerId !== pointerId)) return;
    dragging = false; el.classList.remove('grab');
    if (performance.now() - lastMoveT < 80 && Math.abs(angVel) > 0.15) inertia = true;
    else if (scrubMs != null) commit();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  return {
    el,
    isInteractive: true,
    update(s) {
      const t = s.track;
      label.style.backgroundImage = t?.art ? `url("${t.art}")` : '';
      label.classList.toggle('noart', !t?.art);
      labelText.querySelector('textPath').textContent = t ? `${t.title}  •  ${t.artist}  •  ${t.album}  •  ` : 'ROUND REMOTE  •  33⅓  •  ';
      el.classList.toggle('playing', !!s.isPlaying);
    },
    tick(pos, s) {
      const now = performance.now();
      const dt = Math.min(64, now - lastT); lastT = now;
      // Motor: spin up quickly, coast down slowly.
      const target = s.isPlaying && !dragging ? 1 : 0;
      speed += (target - speed) * (target > speed ? 0.06 : 0.025) * (dt / 16.7);
      if (!dragging && !inertia) rot += speed * dt * (360 / perTurnMs());
      if (inertia) {
        const d = angVel * dt;
        applyDelta(d);
        angVel *= Math.pow(0.94, dt / 16.7);
        if (Math.abs(angVel) < 0.02) { inertia = false; commit(); }
      }
      rot %= 360000;
      disc.style.transform = `rotate(${rot.toFixed(2)}deg)`;
      // Tone arm follows the (possibly scrubbed) position.
      const dur = s.track?.durationMs || 0;
      const p = scrubMs ?? pos;
      const want = dur ? ARM_OUTER + (armInner - ARM_OUTER) * clamp(p / dur, 0, 1) : ARM_REST;
      armDeg += (want - armDeg) * (scrubMs != null ? 0.35 : 0.08);
      armRot.style.transform = `rotate(${armDeg.toFixed(2)}deg)`;
      arm.classList.toggle('lifted', !s.isPlaying || dragging);
    },
    destroy() { onPreview?.(null); offLabel(); offLook.forEach((f) => f()); store.off('change', onAny); },
  };
}
