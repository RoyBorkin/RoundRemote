// View 3: synced lyrics with five selectable styles (Kinetic Type has six variants).
//   basic    – classic centred list that glides to the active line
//   animated – (Kinetic Type variant) karaoke: words fill in as they're sung, lines rise & blur between
//   typing   – typewriter / terminal, each line typed out in time
//   roll     – 3D drum that rolls line by line
//   moving   – (Kinetic Type variant) modern moving words: each word flies in, drifts, and scatters
//   fluid    – Lyricify / Apple-Music-like flowing lyrics (see lyrics-extra.js)
//   typo     – kinetic typography, 3 variants: stack / camera / slam (see lyrics-extra.js)
import { h, clear } from '../ui/dom.js';
import { store } from '../core/store.js';
import { getLyrics, lineAt } from '../lyrics/lrc.js';
import { clamp } from '../core/util.js';
import { fluidStyle, typoStyle } from './lyrics-extra.js';

export const LYRIC_STYLES = [
  { id: 'basic', name: 'Basic' },
  { id: 'typing', name: 'Typing' },
  { id: 'roll', name: 'Roll' },
  { id: 'fluid', name: 'Fluid' },
  { id: 'typo', name: 'Kinetic Type' },
];

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lineEnd = (L, i) => (L[i + 1] ? L[i + 1].t : L[i].t + 6000);
const wordEnd = (ln, j, L, i) => (ln.words[j + 1] ? ln.words[j + 1].t : Math.min(lineEnd(L, i), ln.words[j].t + 1400));
const isGap = (L, i, ms) => i >= 0 && !L[i].text.trim() || (i >= 0 && L[i + 1] && L[i + 1].t - L[i].t > 12000 && ms > L[i].t + 7000);

// ---------------------------------------------------------------- basic
function basicStyle(box, lyr, api) {
  const L = lyr.lines;
  const list = h('div.lyb-list');
  const lead = h('div.lyb-line.lead', h('span.dots', h('i'), h('i'), h('i')));
  const rows = L.map((ln) => h('div.lyb-line', ln.text.trim() || '♪'));
  list.append(lead, ...rows);
  box.appendChild(list);
  let cur = -99;
  return {
    tick(ms) {
      const i = lineAt(L, ms);
      if (i === cur) return;
      cur = i;
      const all = [lead, ...rows];
      all.forEach((r, k) => { const d = Math.abs(k - 1 - i); r.dataset.d = Math.min(d, 4); r.classList.toggle('on', d === 0); });
      const target = i < 0 ? lead : rows[i];
      const y = target.offsetTop + target.offsetHeight / 2 - box.clientHeight / 2;
      list.style.transform = `translateY(${-y}px)`;
    },
    destroy() {},
  };
}

// ---------------------------------------------------------------- animated (karaoke)
function animatedStyle(box, lyr, api) {
  const L = lyr.lines;
  const wrap = h('div.lya');
  box.appendChild(wrap);
  let cur = -99, curEl = null, words = [];
  const nextEl = h('div.lya-next');
  wrap.appendChild(nextEl);
  function build(i) {
    const ln = L[i];
    const el = h('div.lya-line.enter');
    words = (ln.words || []).map((w) => { const s = h('span.lya-w', w.text); el.append(s, ' '); return s; });
    if (!words.length) el.append(h('span.dots', h('i'), h('i'), h('i')));
    return el;
  }
  return {
    tick(ms) {
      let i = lineAt(L, ms);
      if (isGap(L, i, ms)) i = -1 - Math.max(0, i); // interlude marker
      if (i !== cur) {
        cur = i;
        if (curEl) { const old = curEl; old.classList.remove('enter', 'cur'); old.classList.add('exit'); setTimeout(() => old.remove(), 700); }
        if (i >= 0) curEl = build(i);
        else { curEl = h('div.lya-line.enter.gap', h('span.dots', h('i'), h('i'), h('i'))); words = []; }
        wrap.insertBefore(curEl, nextEl);
        requestAnimationFrame(() => curEl && curEl.classList.add('cur'));
        nextEl.textContent = L[lineAt(L, ms) + 1]?.text || '';
      }
      if (i >= 0 && words.length) {
        const ln = L[i];
        words.forEach((s, j) => {
          const w = ln.words[j];
          const p = clamp((ms - w.t) / Math.max(120, wordEnd(ln, j, L, i) - w.t), 0, 1);
          s.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
          s.classList.toggle('lit', p > 0);
          s.classList.toggle('now', p > 0 && p < 1);
        });
      }
    },
    destroy() {},
  };
}

// ---------------------------------------------------------------- typing
function typingStyle(box, lyr, api) {
  const L = lyr.lines;
  const log = h('div.lyt-log');
  const text = h('span.lyt-text');
  const cur = h('div.lyt-cur', h('span.lyt-prompt', '›'), text, h('span.lyt-caret'));
  box.appendChild(h('div.lyt', log, cur));
  let idx = -99;
  return {
    tick(ms) {
      const i = lineAt(L, ms);
      if (i !== idx) {
        if (idx >= 0 && L[idx].text.trim()) {
          const done = h('div.lyt-old', L[idx].text);
          log.appendChild(done);
          while (log.children.length > 4) log.firstChild.remove();
          [...log.children].forEach((c, k, a) => (c.style.opacity = String(0.14 + (0.5 * (k + 1)) / a.length)));
        }
        idx = i;
      }
      if (i < 0) { text.textContent = ''; cur.classList.add('idle'); return; }
      const ln = L[i];
      const full = ln.text.trim() || '♪';
      const dur = Math.min((lineEnd(L, i) - ln.t) * 0.75, full.length * 60 + 250);
      const n = Math.round(clamp((ms - ln.t) / Math.max(1, dur), 0, 1) * full.length);
      if (text.textContent.length !== n || !text.textContent || text.dataset.i !== String(i)) {
        text.textContent = full.slice(0, n);
        text.dataset.i = i;
      }
      cur.classList.toggle('idle', n >= full.length);
    },
    destroy() {},
  };
}

// ---------------------------------------------------------------- roll (3D drum)
function rollStyle(box, lyr, api) {
  const L = lyr.lines;
  const drum = h('div.lyr-drum');
  const STEP = 22; // degrees between lines
  const rows = L.map((ln) => h('div.lyr-line', ln.text.trim() || '♪'));
  drum.append(...rows);
  box.appendChild(h('div.lyr', drum));
  let last = null;
  return {
    tick(ms) {
      const i = lineAt(L, ms);
      // Roll into the new line over ~550ms, then hold still.
      const f = i < 0 ? -1 : i - 1 + ease(clamp((ms - L[i].t) / 550, 0, 1));
      const key = f.toFixed(3);
      if (key === last) return;
      last = key;
      const R = box.clientHeight * 0.62;
      drum.style.setProperty('--negR', `${(-R).toFixed(1)}px`);
      rows.forEach((r, k) => {
        const a = (k - f) * STEP;
        if (Math.abs(a) > 80) { if (r.style.display !== 'none') r.style.display = 'none'; return; }
        r.style.display = '';
        r.style.transform = `translate(-50%,-50%) rotateX(${-a}deg) translateZ(${R.toFixed(1)}px)`;
        r.style.opacity = Math.max(0, Math.cos((a * Math.PI) / 180) ** 2.2).toFixed(3);
        r.classList.toggle('on', k === i);
      });
    },
    destroy() {},
  };
}

// ---------------------------------------------------------------- kinetic (modern moving words)
function kineticStyle(box, lyr, api) {
  const L = lyr.lines;
  const bg = h('div.lyk-bg');
  const layer = h('div.lyk-layer');
  box.appendChild(h('div.lyk', bg, layer));
  let cur = -99, group = null, spans = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  function build(i) {
    const ln = L[i];
    const g = h('div.lyk-group');
    const ws = ln.words || [];
    const longest = ws.reduce((a, w) => (w.text.length > a.length ? w.text : a), '');
    spans = ws.map((w, j) => {
      const clean = w.text.replace(/[^\p{L}\p{N}']/gu, '');
      const big = clean.length >= 6 || j === ws.length - 1 || clean === longest.replace(/[^\p{L}\p{N}']/gu, '');
      const s = h(`span.lyk-w.e${1 + Math.floor(Math.random() * 4)}${big ? '.big' : ''}${j % 3 === 1 ? '.alt' : ''}`, w.text);
      s.style.setProperty('--dx', `${rnd(-1.6, 1.6).toFixed(2)}cqmin`);
      s.style.setProperty('--dy', `${rnd(-1.4, 1.4).toFixed(2)}cqmin`);
      s.style.setProperty('--r', `${rnd(-4, 4).toFixed(1)}deg`);
      s.style.setProperty('--fd', `${rnd(3.2, 5.5).toFixed(2)}s`);
      s.style.setProperty('--sz', (big ? rnd(1.25, 1.55) : rnd(0.8, 1.05)).toFixed(2));
      g.appendChild(s);
      return s;
    });
    bg.textContent = longest.replace(/[^\p{L}\p{N}']/gu, '').toUpperCase();
    bg.classList.remove('swap'); void bg.offsetWidth; bg.classList.add('swap');
    return g;
  }
  function scatter(g) {
    const br = box.getBoundingClientRect();
    const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
    for (const s of g.children) {
      const r = s.getBoundingClientRect();
      const vx = r.left + r.width / 2 - cx, vy = r.top + r.height / 2 - cy;
      const m = Math.hypot(vx, vy) || 1;
      s.style.setProperty('--ox', `${((vx / m) * 26).toFixed(1)}cqmin`);
      s.style.setProperty('--oy', `${((vy / m) * 26).toFixed(1)}cqmin`);
    }
    g.classList.add('out');
    setTimeout(() => g.remove(), 900);
  }
  return {
    tick(ms) {
      let i = lineAt(L, ms);
      if (isGap(L, i, ms)) i = -1 - Math.max(0, i);
      if (i !== cur) {
        cur = i;
        if (group) scatter(group);
        if (i >= 0) group = build(i);
        else { group = h('div.lyk-group.gap', h('span.dots', h('i'), h('i'), h('i'))); spans = []; bg.textContent = ''; }
        layer.appendChild(group);
      }
      if (i >= 0) {
        const ln = L[i];
        spans.forEach((s, j) => { if (!s.classList.contains('in') && ms >= ln.words[j].t - 60) s.classList.add('in'); });
      }
    },
    destroy() {},
  };
}

// Kinetic Type variants (Animated and Moving Words live here too).
export const TYPO_VARIANTS = [
  { id: 'stack', name: 'Stack' },
  { id: 'camera', name: 'Camera' },
  { id: 'slam', name: 'Slam' },
  { id: 'animated', name: 'Animated' },
  { id: 'moving', name: 'Moving Words' },
  { id: 'random', name: 'Random' },
];
const VARIANT_FNS = {
  stack: (b, l, a) => typoStyle(b, l, a, 'stack'),
  camera: (b, l, a) => typoStyle(b, l, a, 'camera'),
  slam: (b, l, a) => typoStyle(b, l, a, 'slam'),
  animated: animatedStyle,
  moving: kineticStyle,
};

/** Random: every new line gets a different Kinetic Type variant, cross-fading between them. */
function randomStyle(box, lyr, api) {
  const L = lyr.lines;
  const pool = Object.keys(VARIANT_FNS);
  let cur = -99, active = null, last = null;
  function make(v) {
    const sub = h('div.kt-sub');
    box.appendChild(sub);
    return { sub, r: VARIANT_FNS[v](sub, lyr, api) };
  }
  return {
    tick(ms) {
      const i = lineAt(L, ms);
      if (i !== cur) {
        cur = i;
        const choices = pool.filter((v) => v !== last);
        const v = choices[Math.floor(Math.random() * choices.length)];
        if (active) {
          const old = active;
          old.sub.classList.add('fade-out');
          setTimeout(() => { old.r.destroy(); old.sub.remove(); }, 700);
        }
        active = make(v); last = v;
      }
      active?.r.tick(ms);
    },
    destroy() { active?.r.destroy(); },
  };
}

const STYLES = {
  basic: basicStyle, typing: typingStyle, roll: rollStyle, fluid: fluidStyle,
  typo: (b, l, a) => {
    const v = store.get('typoVariant');
    return v === 'random' ? randomStyle(b, l, a) : (VARIANT_FNS[v] || VARIANT_FNS.stack)(b, l, a);
  },
};

export function createLyricsView({ player }) {
  const stage = h('div.ly-stage');
  const status = h('div.ly-status');
  const src = h('div.ly-src');
  const bg = h('div.ly-bg');
  const el = h('div.view.view-lyrics', bg, stage, status, src);
  let lyr = null, renderer = null, loadingKey = null, style = store.get('lyricsStyle'), curTrack = null;

  const api = {
    bg,
    get track() { return curTrack; },
    seek: () => {}, // tapping lyrics no longer skips (it only shows/hides the controls)
  };

  function mount() {
    renderer?.destroy(); renderer = null;
    clear(stage); clear(bg);
    stage.className = `ly-stage style-${style}`;
    el.dataset.style = style;
    if (!lyr || !lyr.lines.length) return;
    renderer = (STYLES[style] || basicStyle)(stage, lyr, api);
  }
  function setStatus(msg, kind = '') {
    status.className = `ly-status ${kind}`;
    status.innerHTML = '';
    if (msg) status.append(...(Array.isArray(msg) ? msg : [msg]));
  }
  async function load(track) {
    const key = track ? `${track.id}|${track.title}` : null;
    if (key === loadingKey) return;
    loadingKey = key; lyr = null; curTrack = track || null; mount(); src.textContent = '';
    if (!track) { setStatus('Nothing playing'); return; }
    setStatus([h('div.spin'), h('div', 'Finding lyrics…')], 'loading');
    const res = await getLyrics(track, player.provider).catch(() => null);
    if (loadingKey !== key) return; // track changed meanwhile
    if (!res) {
      setStatus([h('div.big-note', '♪'), h('div', 'No lyrics found for this song'),
        h('button.pill', { type: 'button', onclick: (e) => { e.stopPropagation(); loadingKey = null; load(track); } }, 'Try again')], 'none');
      return;
    }
    if (res.instrumental || !res.lines.length) { setStatus([h('div.big-note', '♪'), h('div', 'Instrumental')], 'none'); return; }
    lyr = res; setStatus('');
    src.textContent = `${res.synced ? '' : 'Unsynced · '}${res.source || ''}`;
    mount();
  }
  const offStyle = store.on('change:lyricsStyle', (v) => { style = v; mount(); });
  const offVariant = store.on('change:typoVariant', () => { if (style === 'typo') mount(); });

  return {
    el,
    update(s) { load(s.track); },
    tick(pos) { renderer?.tick(pos + (store.get('lyricsOffsetMs') || 0)); },
    destroy() { offStyle(); offVariant(); renderer?.destroy(); },
  };
}
