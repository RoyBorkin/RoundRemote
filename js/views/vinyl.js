// View 2: the whole round screen becomes a record. Spin it with a finger to scrub
// backward/forward (with fling inertia); the tone arm tracks song progress.
import { h } from '../ui/dom.js';
import { store } from '../core/store.js';
import { angleFromCenter, angleDelta, distFromCenter, clamp, throttle } from '../core/util.js';

const RPM_DEG_PER_MS = (100 / 3) * 360 / 60000; // 33⅓ rpm
const SLOW_DEG_PER_MS = 60 / 1000;
// Tone-arm geometry in a 0..100 viewBox (see README for the derivation).
const PIVOT = { x: 86, y: 13 }, ARM_LEN = 42;
const D = Math.hypot(50 - PIVOT.x, 50 - PIVOT.y);
const BASE_DEG = (Math.atan2(-(50 - PIVOT.x), 50 - PIVOT.y) * 180) / Math.PI;
function armDegForRadius(r) {
  const c = clamp((D * D + ARM_LEN * ARM_LEN - r * r) / (2 * D * ARM_LEN), -1, 1);
  return BASE_DEG - (Math.acos(c) * 180) / Math.PI;
}
const ARM_OUTER = armDegForRadius(43.5), ARM_INNER = armDegForRadius(19.5), ARM_REST = ARM_OUTER - 8;

export function createVinylView({ player, onPreview }) {
  const label = h('div.vinyl-label');
  const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  labelText.setAttribute('viewBox', '0 0 100 100');
  labelText.classList.add('vinyl-label-text');
  labelText.innerHTML = `<defs><path id="lblArc" d="M 50,50 m -40,0 a 40,40 0 1,1 80,0 a 40,40 0 1,1 -80,0"/></defs>
    <text><textPath href="#lblArc" startOffset="0"></textPath></text>`;
  const disc = h('div.vinyl-disc', h('div.vinyl-grooves'), h('div.vinyl-bands'), label, labelText, h('div.vinyl-hole'));
  const sheen = h('div.vinyl-sheen');
  const arm = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arm.setAttribute('viewBox', '0 0 100 100');
  arm.classList.add('tonearm');
  arm.innerHTML = `
    <defs>
      <linearGradient id="armMetal" x1="0" x2="1"><stop offset="0" stop-color="#8d8f94"/><stop offset=".5" stop-color="#f4f5f7"/><stop offset="1" stop-color="#6c6e73"/></linearGradient>
      <radialGradient id="armBase" cx=".35" cy=".35"><stop offset="0" stop-color="#9a9ca1"/><stop offset="1" stop-color="#2b2c30"/></radialGradient>
    </defs>
    <circle cx="${PIVOT.x}" cy="${PIVOT.y}" r="6.2" fill="url(#armBase)" stroke="#111" stroke-width=".6"/>
    <g class="arm-rot" style="transform-origin:${PIVOT.x}px ${PIVOT.y}px">
      <rect x="${PIVOT.x - 2.2}" y="${PIVOT.y - 10}" width="4.4" height="6" rx="1" fill="#34363b"/>
      <rect x="${PIVOT.x - 0.75}" y="${PIVOT.y - 4}" width="1.5" height="${ARM_LEN - 3}" rx=".75" fill="url(#armMetal)"/>
      <g transform="translate(${PIVOT.x} ${PIVOT.y + ARM_LEN - 3}) rotate(-16)">
        <rect x="-1.9" y="-0.6" width="3.8" height="6.2" rx=".7" fill="#1d1e22" stroke="#555" stroke-width=".25"/>
        <rect x="-0.5" y="4.6" width="1" height="1.4" fill="var(--accent)"/>
      </g>
      <circle cx="${PIVOT.x}" cy="${PIVOT.y}" r="2.2" fill="#d9dade" stroke="#222" stroke-width=".4"/>
    </g>`;
  const armRot = arm.querySelector('.arm-rot');
  const el = h('div.view.view-vinyl', disc, sheen, arm);

  let rot = 0, speed = 0, lastT = performance.now();
  let dragging = false, lastAngle = 0, lastMoveT = 0, angVel = 0; // deg/ms
  let scrubMs = null, inertia = false, pointerId = null;
  let armDeg = ARM_REST;

  const perTurnMs = () => (store.get('vinylSecondsPerTurn') || 12) * 1000;
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
      if (!dragging && !inertia) rot += speed * dt * (store.get('vinylRealSpeed') ? RPM_DEG_PER_MS : SLOW_DEG_PER_MS);
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
      const want = dur ? ARM_OUTER + (ARM_INNER - ARM_OUTER) * clamp(p / dur, 0, 1) : ARM_REST;
      armDeg += (want - armDeg) * (scrubMs != null ? 0.35 : 0.08);
      armRot.style.transform = `rotate(${armDeg.toFixed(2)}deg)`;
      arm.classList.toggle('lifted', !s.isPlaying || dragging);
    },
    destroy() { onPreview?.(null); },
  };
}
