// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Sleep Sounds — white / pink / brown noise, rain, a thunderstorm, ocean waves, a stream, a fan, wind, a fireplace,
// a heartbeat and a soft drone, all generated live with the Web Audio API (noise-engine.js). Mix up to three with
// round volume knobs, presets (and your own), a sleep timer (15 / 30 / 60 / 90 min or until morning) that fades out
// gently, then can pause the music; optionally dims Home Assistant lights over 10 minutes. A calm, low-CPU backdrop
// and a screen-dim overlay (tap to wake). The sound keeps playing on other screens until you stop it.
import { h } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { topPanel } from '../js/ui/overlay.js';
import * as N from './noise-engine.js';
import { lic, ico, panel, form, lbl, note, chipRow, timeStepper, pickEntities, ensureStyle, fmtTime } from './plants-ui.js';
import { haReady, entityName } from './plants-ha.js';

const c = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const SI = {
  white: 'M2 12h2l2-6 2 12 2-9 2 6 2-8 2 10 2-5h4',
  pink: 'M2 12c1.7-4 3.3-4 5 0s3.3 4 5 0 3.3-4 5 0 3.3 4 5 0',
  brown: 'M2 13c2.5-6 5.5-6 8 0s5.5 6 8 0c1-2 2.5-3 4-3',
  rain: 'M7 14a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1.5A3.3 3.3 0 0 1 17 14zM8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3',
  storm: 'M7 13a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1.5A3.3 3.3 0 0 1 17 13M12.8 10.5 10 15.5h4l-2.6 5',
  ocean: 'M2 8c2.5 2 5 2 7.5 0s5-2 7.5 0 3.5 1.5 5 1M2 13c2.5 2 5 2 7.5 0s5-2 7.5 0 3.5 1.5 5 1M2 18c2.5 2 5 2 7.5 0s5-2 7.5 0 3.5 1.5 5 1',
  stream: 'M3 6c3 0 3 3 6 3s3-3 6-3 3 3 6 3M3 12.5c3 0 3 3 6 3s3-3 6-3 3 3 6 3M6 19.5h.01M12 19h.01M17.5 20h.01',
  fan: `${c(12, 12, 1.6)}M12 10.4C11 6 12.5 3 15 3c2 0 2.5 2.5.5 4.5zM13.4 12.8c4.4 1.4 6.4 4.1 5.2 6.3-1 1.7-3.5 1.1-4.7-1.5zM10.6 12.7c-3.4 3.1-6.8 3.5-8.1 1.3-1-1.7 1-3.4 3.9-3.2z`,
  wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8',
  fire: 'M12 21.5c-3.9 0-6.5-2.7-6.5-6.2 0-4.6 4.3-6.6 4.3-11.3 2.6 1.4 4.3 4.2 4.3 6.6.9-.5 1.6-1.6 1.7-2.8 1.7 1.6 2.7 4.3 2.7 6.9 0 3.9-2.7 6.8-6.5 6.8zM12 21.5c-1.6 0-2.7-1.1-2.7-2.6 0-1.9 2.7-3.2 2.7-4.9 1.6 1 2.7 2.8 2.7 4.9 0 1.5-1.1 2.6-2.7 2.6z',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20zM6.5 12.5h3l1.3-2 2 4 1.4-2h3.3',
  drone: `${c(12, 12, 2)}M7.6 7.6a6.2 6.2 0 0 0 0 8.8M16.4 7.6a6.2 6.2 0 0 1 0 8.8M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8`,
};
const HUE = { white: '#94a3b8', pink: '#f9a8d4', brown: '#a16207', rain: '#3b82f6', storm: '#6366f1', ocean: '#14b8a6', stream: '#22d3ee', fan: '#64748b', wind: '#a5b4fc', fire: '#f97316', heart: '#f43f5e', drone: '#a855f7' };
const MOON = 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z';
const sname = (id) => N.SOUNDS.find((s) => s.id === id)?.name || id;
const sic = (id) => lic(SI[id] || SI.pink);
const KR = 40, KA = 135;   // knob arc radius (svg units) and half-sweep in degrees
function arcPath(f, r = KR) {
  const a0 = (-KA * Math.PI) / 180, a1 = ((-KA + 2 * KA * Math.max(0.0001, Math.min(1, f))) * Math.PI) / 180;
  const p = (a) => `${(50 + Math.sin(a) * r).toFixed(2)} ${(50 - Math.cos(a) * r).toFixed(2)}`;
  return `M${p(a0)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
}

export default {
  css: './noise.css',
  create(el, app) {
    ensureStyle();
    const P = (o) => panel(o, N.COLOR);
    let sel = 0;   // keyboard: 0 = master, 1…3 = knobs

    // ================================================================ backdrop (CSS only: compositor-friendly)
    const bg = h('div.ns-bg', h('i.b1'), h('i.b2'), h('i.b3'),
      h('div.ns-parts', Array.from({ length: 16 }, (_, i) => h('i', { style: { left: `${8 + ((i * 53) % 84)}%`, animationDelay: `${-(i * 2.7) % 22}s`, animationDuration: `${16 + ((i * 7) % 12)}s`, '--s': `${0.5 + ((i * 37) % 10) / 10}` } }))));

    // ================================================================ main controls
    const status = h('div.ns-status');
    const timerBtn = h('button.ns-timer', { type: 'button', onclick: () => timerPanel() });
    const master = h('div.ns-master', { html: `<svg viewBox="0 0 100 100"><path class="ns-mtrack" d="${arcPath(1, 46)}"/><path class="ns-marc" d=""/><circle class="ns-mknob" r="3.2" cx="50" cy="4"/></svg>` });
    const mArc = master.querySelector('.ns-marc'), mKnob = master.querySelector('.ns-mknob');
    const playBtn = h('button.ns-play', { type: 'button', 'aria-label': 'Play', onclick: () => toggle() });
    const mVal = h('div.ns-mval');
    const presetBtn = h('button.ns-side.l', { type: 'button', 'aria-label': 'Presets', title: 'Presets', onclick: () => presetsPanel(), html: lic('M4 6h16M4 12h16M4 18h10M18 16v6M15 19h6') });
    const dimBtn = h('button.ns-side.r', { type: 'button', 'aria-label': 'Dim the screen', title: 'Dim the screen', onclick: () => dimScreen(), html: lic(MOON) });
    const setBtn = h('button.ns-gear', { type: 'button', 'aria-label': 'Sleep timer & lights', title: 'Sleep timer & lights', onclick: () => timerPanel(), html: ico('gear') });
    const knobs = h('div.ns-knobs');
    const root = h('div.ns.pk-scope', bg, status, timerBtn, master, playBtn, mVal, presetBtn, dimBtn, knobs, setBtn);
    app.hideTitle();
    el.append(root);

    function toggle() {
      if (N.isPlaying()) { N.stop({ fade: 1.5 }); app.sfx('tap'); return; }
      N.play(N.mix());
      const t = N.nData().timer;
      if (t && !N.state().timer) N.setTimer(t);
      if (N.nData().dim?.on && haReady()) N.dimLights();
      if (N.nData().autoDim) armAutoDim();
    }

    // ---------------------------------------------------------------- drawing
    function draw() {
      const st = N.state();
      const playing = st.playing;
      root.classList.toggle('playing', playing);
      const mix = st.mix;
      const cols = mix.map((m) => HUE[m.id] || N.COLOR);
      root.style.setProperty('--b1', cols[0] || N.COLOR);
      root.style.setProperty('--b2', cols[1] || cols[0] || '#312e81');
      root.style.setProperty('--b3', cols[2] || cols[1] || cols[0] || '#1e1b4b');
      status.replaceChildren(h('b', playing ? (st.owner === 'focus' ? 'Playing for Focus' : 'Playing') : 'Sleep Sounds'), h('span', mix.map((m) => sname(m.id)).join(' · ')));
      playBtn.innerHTML = playing ? icon('stop') : icon('play');
      playBtn.setAttribute('aria-label', playing ? 'Stop' : 'Play');
      drawMaster();
      drawTimer();
      drawKnobs();
    }
    function drawMaster() {
      const v = N.state().master;
      mArc.setAttribute('d', arcPath(v, 46));
      const a = ((-KA + 2 * KA * v) * Math.PI) / 180;
      mKnob.setAttribute('cx', (50 + Math.sin(a) * 46).toFixed(2)); mKnob.setAttribute('cy', (50 - Math.cos(a) * 46).toFixed(2));
      mVal.textContent = `${Math.round(v * 100)}%`;
      master.classList.toggle('sel', sel === 0);
    }
    function drawTimer() {
      const st = N.state();
      const pref = N.nData().timer;
      const t = st.timer;
      let txt;
      if (t && st.playing) {
        const left = t.left, m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
        txt = t.kind === 'morning' && left > 3600000 ? `Until ${fmtTime(t.endAt)}` : `${m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')} left`;
        if (st.level < 0.999) txt += ' · fading';
      } else txt = pref ? (pref === 'morning' ? `Timer · until ${N.nData().morning || '07:00'}` : `Timer · ${pref} min`) : 'Sleep timer · off';
      timerBtn.replaceChildren(h('i', { html: lic('M12 13.5V9.5M9.5 2.5h5M12 21a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z') }), h('span', txt));
      timerBtn.classList.toggle('on', !!(t && st.playing));
      const dm = N.dimming();
      timerBtn.classList.toggle('dimming', !!dm);
      timerBtn.title = dm ? `Dimming ${dm.lights.length} light(s)` : '';
    }
    let knobEls = [];
    function drawKnobs() {
      const mix = N.state().mix;
      const want = Math.min(3, mix.length + 1);
      if (knobEls.length !== want || knobEls.some((k, i) => k.dataset.id !== (mix[i]?.id || ''))) {
        knobEls = Array.from({ length: want }, (_, i) => makeKnob(i, mix[i]));
        knobs.replaceChildren(...knobEls);
        knobs.dataset.n = String(want);
      }
      knobEls.forEach((k, i) => {
        const m = mix[i];
        k.classList.toggle('sel', sel === i + 1);
        if (!m) return;
        k.querySelector('.ns-karc').setAttribute('d', arcPath(m.vol));
        k.querySelector('.ns-kv').textContent = `${Math.round(m.vol * 100)}`;
      });
    }
    function makeKnob(i, m) {
      const k = h(`div.ns-knob${m ? '' : '.add'}`, { dataset: { id: m?.id || '' }, '--kc': m ? HUE[m.id] : 'var(--dim)' });
      if (!m) {
        k.append(h('button.ns-kbtn', { type: 'button', 'aria-label': 'Add a sound', onclick: () => soundPanel(i), html: icon('plus') }), h('div.ns-kname', 'Add a sound'));
        return k;
      }
      const face = h('button.ns-kbtn', { type: 'button', 'aria-label': `${sname(m.id)} volume — drag, or tap to change`, html: `<svg viewBox="0 0 100 100"><path class="ns-ktrack" d="${arcPath(1)}"/><path class="ns-karc" d=""/></svg>${sic(m.id)}` });
      k.append(face, h('div.ns-kname', sname(m.id), h('span.ns-kv')));
      // drag up / down (or around) to set the volume; a tap opens the sound picker
      let y0 = 0, v0 = 0, moved = false, id = null;
      face.addEventListener('pointerdown', (e) => { id = e.pointerId; y0 = e.clientY; v0 = N.state().mix[i]?.vol ?? 0.7; moved = false; face.setPointerCapture(id); });
      face.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        const dy = y0 - e.clientY;
        if (!moved && Math.abs(dy) < 6) return;
        moved = true;
        const r = face.getBoundingClientRect().height;
        N.setVolume(m.id, v0 + dy / (r * 1.6));
      });
      const up = (e) => { if (e.pointerId !== id) return; id = null; if (!moved) soundPanel(i); else app.sfx('tick'); };
      face.addEventListener('pointerup', up);
      face.addEventListener('pointercancel', () => { id = null; });
      face.addEventListener('click', (e) => e.preventDefault());
      face.addEventListener('wheel', (e) => { e.preventDefault(); const cur = N.state().mix[i]; if (cur) N.setVolume(cur.id, cur.vol + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
      return k;
    }
    // master: drag around the ring
    {
      let on = false;
      const setFrom = (e) => {
        const r = master.getBoundingClientRect();
        let a = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
        a = Math.max(-KA, Math.min(KA, a));
        N.setMaster((a + KA) / (2 * KA));
      };
      master.addEventListener('pointerdown', (e) => { on = true; master.setPointerCapture(e.pointerId); setFrom(e); sel = 0; });
      master.addEventListener('pointermove', (e) => { if (on) setFrom(e); });
      master.addEventListener('pointerup', () => { on = false; });
      master.addEventListener('pointercancel', () => { on = false; });
      root.addEventListener('wheel', (e) => { if (e.target.closest('.ns-knob')) return; e.preventDefault(); N.setMaster(N.state().master + (e.deltaY < 0 ? 0.04 : -0.04)); }, { passive: false });
    }

    // ================================================================ panels
    function soundPanel(i) {
      const mix = N.state().mix;
      const cur = mix[i];
      P({
        title: cur ? `Sound ${i + 1}` : 'Add a sound',
        build(body, p) {
          body.append(form(
            h('div.ns-grid', N.SOUNDS.map((s) => {
              const inMix = mix.some((m) => m.id === s.id);
              return h(`button.ns-tile${cur?.id === s.id ? '.on' : inMix ? '.used' : ''}`, { type: 'button', '--kc': HUE[s.id], disabled: inMix && cur?.id !== s.id, onclick: () => {
                const l = N.state().mix.map((m) => ({ ...m }));
                if (cur) l[i] = { id: s.id, vol: cur.vol }; else l.push({ id: s.id, vol: 0.6 });
                N.setMix(l); app.sfx('pop'); p.close();
              } }, h('i', { html: sic(s.id) }), h('span', s.name));
            })),
            cur && mix.length > 1 ? h('div.pk-btns', h('button.pill.small.danger', { type: 'button', onclick: () => { N.setMix(N.state().mix.filter((m) => m.id !== cur.id)); p.close(); } }, `Remove ${sname(cur.id)}`)) : null));
        },
      });
    }
    function presetsPanel() {
      P({
        title: 'Presets',
        build(body, p) {
          const sc = form();
          const render = () => {
            const mine = N.nData().presets || [];
            const tile = (pr, own) => h('button.ns-preset', { type: 'button', onclick: () => { N.play(pr.mix); app.sfx('pop'); p.close(); if (N.nData().timer && !N.state().timer) N.setTimer(N.nData().timer); } },
              h('div.ns-pic', pr.mix.map((m) => h('i', { '--kc': HUE[m.id], html: sic(m.id) }))),
              h('b', { dir: 'auto' }, pr.name), h('small', pr.mix.map((m) => sname(m.id)).join(' · ')),
              own ? h('span.ns-pdel', { role: 'button', 'aria-label': 'Delete', onclick: (e) => { e.stopPropagation(); N.saveN({ presets: (N.nData().presets || []).filter((x) => x.id !== pr.id) }); render(); }, html: icon('close') }) : null);
            sc.replaceChildren(...[
              h('div.ns-presets', N.PRESETS.map((pr) => tile(pr, false))),
              mine.length ? lbl('Yours') : null,
              mine.length ? h('div.ns-presets', mine.map((pr) => tile(pr, true))) : null,
              h('div.pk-btns', h('button.pill.small', { type: 'button', onclick: async () => {
                const name = await app.editText({ title: 'Name this mix', placeholder: 'e.g. My rainy night', okLabel: 'Save' });
                if (!name) return;
                N.saveN({ presets: [...(N.nData().presets || []), { id: `u${Date.now().toString(36)}`, name, mix: N.state().mix }] }); app.sfx('pop'); render();
              } }, 'Save this mix')),
            ].filter(Boolean));
          };
          render();
          body.append(sc);
        },
      });
    }
    function timerPanel() {
      P({
        title: 'Sleep timer',
        build(body, p) {
          const sc = form();
          const render = () => {
            const d = N.nData();
            const t = d.timer || 0, dim = d.dim || {};
            const sw = (on, label, sub, fn) => h('div.pk-row', h('span', label, sub ? h('small', sub) : null),
              h(`button.switch${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: () => { fn(!on); render(); } }));
            sc.replaceChildren(...[
              chipRow(N.TIMERS.map((x) => ({ id: x, name: x === 0 ? 'Off' : x === 'morning' ? 'Until morning' : `${x} min` })), t, (x) => { N.setTimer(N.isPlaying() ? x : 0); N.saveN({ timer: x }); app.sfx('tick'); render(); }),
              t === 'morning' ? h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.6cqmin' } }, note('Morning is at'), timeStepper(() => N.nData().morning || '07:00', (v) => { N.saveN({ morning: v }); if (N.isPlaying()) N.setTimer('morning'); }, { step: 15 })) : null,
              note(t ? 'The sound fades out gently at the end.' : 'Plays until you stop it.'),
              sw(d.pauseMusic, 'Pause the music too', 'when the timer ends', (v) => N.saveN({ pauseMusic: v })),
              sw(d.autoDim, 'Dim the screen', 'while playing, after 30 s', (v) => { N.saveN({ autoDim: v }); if (v && N.isPlaying()) armAutoDim(); }),
              lbl('Lights'),
              sw(dim.on, 'Dim the lights slowly', haReady() ? 'Home Assistant · when you press play' : 'needs Home Assistant', (v) => N.saveN({ dim: { minutes: 10, ids: [], ...dim, on: v } })),
              ...(dim.on ? [
                h('button.pill.small', { type: 'button', onclick: async () => {
                  const ids = await pickEntities({ title: 'Lights to dim', domains: ['light'], multi: true, selected: dim.ids || [], color: N.COLOR });
                  if (ids) { N.saveN({ dim: { ...N.nData().dim, ids } }); render(); }
                } }, dim.ids?.length ? dim.ids.map(entityName).join(', ') : 'Choose lights…'),
                chipRow([5, 10, 20, 30].map((m) => ({ id: m, name: `${m} min` })), dim.minutes || 10, (m) => { N.saveN({ dim: { ...N.nData().dim, minutes: m } }); render(); }, { cls: 'pk-mini' }),
                h('div.pk-btns', N.dimming() ? h('button.pill.small', { type: 'button', onclick: () => { N.cancelDim(); render(); } }, 'Stop dimming')
                  : h('button.pill.small', { type: 'button', disabled: !dim.ids?.length, onclick: () => { N.dimLights(); app.toast('Dimming the lights'); render(); } }, 'Dim now')),
              ] : []),
            ].filter(Boolean));
          };
          render();
          body.append(sc);
        },
      });
    }

    // ================================================================ screen dim (above everything; tap to wake)
    let dimEl = null, autoT = 0;
    function dimScreen() {
      if (dimEl) return;
      const clock = h('div.ns-dclock');
      const tick = () => { clock.textContent = fmtTime(Date.now()); };
      tick();
      const iv = setInterval(tick, 15000);
      dimEl = h('div.ns-dim', { role: 'button', 'aria-label': 'Wake the screen' }, clock, h('div.ns-dhint', 'Tap to wake'));
      const wake = (e) => { e?.stopPropagation?.(); e?.preventDefault?.(); clearInterval(iv); dimEl?.classList.remove('in'); const d = dimEl; dimEl = null; setTimeout(() => d.remove(), 600); window.removeEventListener('keydown', onK, true); };
      const onK = (e) => { e.stopImmediatePropagation(); e.preventDefault(); wake(); };
      dimEl.addEventListener('pointerdown', wake);
      dimEl.wake = wake;
      window.addEventListener('keydown', onK, true);
      (document.getElementById('app') || document.body).append(dimEl);
      requestAnimationFrame(() => requestAnimationFrame(() => dimEl?.classList.add('in')));
    }
    function armAutoDim() {
      clearTimeout(autoT);
      if (!N.nData().autoDim) return;
      autoT = setTimeout(() => { if (N.isPlaying() && !topPanel() && !dimEl) dimScreen(); }, 30000);
    }
    const poke = () => { if (N.isPlaying() && N.nData().autoDim) armAutoDim(); };
    root.addEventListener('pointerdown', poke);

    // ================================================================ keys & updates
    const offs = [N.events.on('change', draw)];
    app.every(1000, drawTimer);
    app.onKey((e) => {
      if (topPanel() || dimEl) return;
      poke();
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      else if (/^[0-3]$/.test(e.key)) { sel = Math.min(+e.key, N.state().mix.length); app.sfx('tick'); draw(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : -0.05;
        const m = N.state().mix[sel - 1];
        if (sel > 0 && m) N.setVolume(m.id, m.vol + d); else N.setMaster(N.state().master + d);
      } else if (e.key === 'd') dimScreen();
      else if (e.key === 't') timerPanel();
      else if (e.key === 'p') presetsPanel();
    });
    draw();
    return {
      destroy() { offs.forEach((f) => f()); clearTimeout(autoT); dimEl?.wake?.(); },
    };
  },
};
