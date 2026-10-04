// Hitster's canvas UI kit: text in the right font and direction (Hebrew → Rubik, right to left), buttons with keyboard
// focus, chips, tokens, year cards and the mystery record. One per round: makeUi(g, { he: () => bool, color: () => css }).
import { TAU, clamp, THEME } from '../games/kit.js';
import { firstStrongDir } from '../js/lyrics/bidi.js';

export const INK_DARK = '#0a0a0b';
export const PLAYER_COLORS = ['#ff5a6a', '#4d9bff', '#3ddc84', '#ffc857', '#b57bff', '#ff8ad8'];
const DECADE = { 1930: '#d6a77a', 1940: '#e0b07c', 1950: '#ff8ad8', 1960: '#ff9f43', 1970: '#ffc857', 1980: '#7be08a', 1990: '#2ee6d6', 2000: '#6aa8ff', 2010: '#b98cff', 2020: '#ff6f86' };
export const decCol = (y) => DECADE[clamp(Math.floor(y / 10) * 10, 1930, 2020)];
export const HEB = /[֐-׿]/;
const LATIN = /[A-Za-zÀ-ɏ]/;
/** A card's title / artist as shown: the Hebrew form in Hebrew, the Latin form (ta / aa) in English when the original isn't Latin. */
export function showTitle(s, he) {
  if (he) return HEB.test(s.t) || !s.ta || !HEB.test(s.ta) ? s.t : s.ta;
  return s.ta && !LATIN.test(s.t) && LATIN.test(s.ta) ? s.ta : s.t;
}
export function showArtist(s, he) {
  if (he) return s.ah || (HEB.test(s.a) || !s.aa || !HEB.test(s.aa) ? s.a : s.aa);
  return s.aa && !LATIN.test(s.a) && LATIN.test(s.aa) ? s.aa : s.a;
}

export function makeUi(g, { he, color }) {
  const { ctx } = g;
  const U = {
    list: [],          // buttons drawn this frame: { id, x, y, w, h, fn, round, disabled, primary, noFocus }
    pressed: null,     // { b, x, y } while a button is held
    focus: null,       // keyboard focus (a button id)
  };
  // Hebrew letters come from Rubik (put first, so a mixed Hebrew + Latin line is in one font)
  const famFor = (str, fam = THEME.display) => (HEB.test(str) ? `'Rubik', ${fam}` : fam);
  const font = (size, weight = 700, fam = THEME.display, str = '') => `${weight} ${Math.round(size)}px ${famFor(str, fam)}`;
  /** Base direction of a line: its first strong letter (a Latin song title stays left to right in Hebrew); none → the UI's. */
  const dirFor = (str) => firstStrongDir(str) || (he() ? 'rtl' : 'ltr');
  function fit(str, maxW, size, weight = 700, fam = THEME.display) {
    str = String(str ?? '');
    ctx.font = font(size, weight, fam, str);
    if (ctx.measureText(str).width <= maxW) return str;
    let s = str;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }
  function measure(str, size, weight = 700, fam = THEME.display) { ctx.font = font(size, weight, fam, String(str)); return ctx.measureText(String(str)).width; }
  function wrap(str, maxW, size, lines = 2, weight = 700, fam = THEME.display) {
    str = String(str ?? '');
    ctx.font = font(size, weight, fam, str);
    const words = str.split(/\s+/); const out = []; let line = '';
    for (let i = 0; i < words.length; i++) {
      const tryLine = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(tryLine).width <= maxW || !line) line = tryLine;
      else { out.push(line); line = words[i]; if (out.length === lines - 1) { line = words.slice(i).join(' '); break; } }
    }
    if (line) out.push(line);
    return out.slice(0, lines).map((l, i) => (i === lines - 1 ? fit(l, maxW, size, weight, fam) : l));
  }
  /** Text with the right font and direction for its language (Hebrew → Rubik, right to left). */
  function text(str, x, y, size, o = {}) {
    str = String(str ?? '');
    ctx.save(); ctx.direction = o.dir || dirFor(str);
    g.draw.text(str, x, y, size, { ...o, font: famFor(str, o.font || THEME.display) });
    ctx.restore();
  }
  /** Lines of wrapped text centred at (x, y0), one direction for the whole paragraph. */
  function para(str, x, y0, maxW, size, { lines = 3, lh = 1.4, color = THEME.fg, weight = 600, fam = THEME.font } = {}) {
    const ls = wrap(str, maxW, size, lines, weight, fam), d = dirFor(str);
    ls.forEach((l, i) => text(l, x, y0 + i * size * lh, size, { color, weight, font: fam, dir: d }));
    return ls.length;
  }
  function focusRing(x, y, W, H, round) {
    ctx.save();
    ctx.lineWidth = Math.max(2, g.R * 0.008); ctx.strokeStyle = THEME.fg;
    ctx.beginPath(); if (round) ctx.arc(x, y, W / 2 + g.R * 0.016, 0, TAU); else ctx.roundRect(x - W / 2 - g.R * 0.014, y - H / 2 - g.R * 0.014, W + g.R * 0.028, H + g.R * 0.028, H / 2 + g.R * 0.014); ctx.stroke();
    ctx.restore();
  }
  /** A pill (or round) button. label may be '' when the caller draws its own content. */
  function button(id, label, x, y, w, h, fn, { primary = false, disabled = false, col = color(), round = false, noFocus = false, small = false, fill = null, ink = null, stroke = null, glow = true, dir = undefined } = {}) {
    U.list.push({ id, x, y, w, h, fn, disabled, primary, round, noFocus });
    const isF = U.focus === id && !disabled;
    const down = U.pressed?.b?.id === id;
    const s = down ? 0.94 : 1;
    const W = w * s, H = h * s;
    ctx.save();
    ctx.globalAlpha = disabled ? 0.4 : 1;
    const f = fill || (primary ? col : THEME.glass2);
    const st = stroke ? { stroke, lw: Math.max(1.5, g.R * 0.006) } : {};
    const gl = glow && primary && !disabled;
    if (round) g.draw.circle(x, y, W / 2, f, { glow: gl ? g.R * 0.05 : 0, ...st });
    else g.draw.roundRect(x - W / 2, y - H / 2, W, H, H / 2, f, { glow: gl ? col : 0, ...st });
    ctx.restore();
    if (isF) focusRing(x, y, W, H, round);
    if (label) text(fit(label, W * 0.86, H * (small ? 0.4 : 0.44), 800), x, y + H * 0.02, H * (small ? 0.4 : 0.44), { color: ink || (primary ? INK_DARK : THEME.fg), weight: 800, alpha: disabled ? 0.45 : 1, dir });
    return { W, H };
  }
  /** Gold tokens in a row centred on x. */
  function coins(x, y, n, size) {
    const gap = size * 2.5;
    const x0 = x - ((n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) coin(x0 + i * gap, y, size);
  }
  function coin(x, y, size, col = '#ffc857') {
    g.draw.ball(x, y, size, col);
    g.draw.circle(x, y, size * 0.55, null, { stroke: 'rgba(120,80,0,.55)', lw: Math.max(1, size * 0.22) });
  }
  /** A year card: flat, in its decade's colour, with the year big. */
  function yearCard(x, y, w, h, s, { alpha = 1, rot = 0, details = true } = {}) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); if (rot) ctx.rotate(rot);
    const col = decCol(s.y);
    g.draw.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.16, col);
    const ys = Math.min(w * 0.31, h * 0.4);
    const showT = details && w > g.R * 0.15 && h > g.R * 0.2;
    text(String(s.y), 0, showT ? -h * 0.1 : h * 0.02, ys, { color: INK_DARK, weight: 800 });
    if (showT) {
      const ts = Math.max(9, w * 0.105);
      text(fit(showTitle(s, he()), w * 0.86, ts, 700, THEME.font), 0, h * 0.2, ts, { color: 'rgba(10,10,11,.78)', weight: 700, font: THEME.font });
      text(fit(showArtist(s, he()), w * 0.86, ts * 0.92, 500, THEME.font), 0, h * 0.33, ts * 0.92, { color: 'rgba(10,10,11,.55)', weight: 500, font: THEME.font });
    }
    ctx.restore();
  }
  /** The mystery record: a flat vinyl disc with a "?" label, spinning. */
  function record(x, y, r, col, rot) {
    const disc = THEME.light ? '#1b1b20' : '#18181c';
    g.draw.ball(x, y, r, disc);
    g.draw.circle(x, y, r, null, { stroke: g.draw.alpha(col, THEME.light ? 0.9 : 0.75), lw: Math.max(2, r * 0.035) });
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {           // grooves
      const rr = r * (0.52 + i * 0.11);
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = Math.max(1, r * 0.012);
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = Math.max(1.5, r * 0.025);   // two light arcs show the spin
    ctx.beginPath(); ctx.arc(0, 0, r * 0.78, -0.5, 0.35); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.66, Math.PI - 0.4, Math.PI + 0.3); ctx.stroke();
    g.draw.ball(0, 0, r * 0.38, col);
    text('?', 0, r * 0.02, r * 0.42, { color: INK_DARK, weight: 800 });
    ctx.restore();
    g.draw.ball(x, y, r * 0.045, disc);
  }
  /** The button under (x, y), topmost first. */
  const hit = (x, y) => [...U.list].reverse().find((b) => !b.disabled && (b.round ? Math.hypot(x - b.x, y - b.y) <= b.w / 2 : Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2));
  function cycleFocus(list, dir) {
    if (!list.length) return;
    const i = list.findIndex((b) => b.id === U.focus);
    U.focus = list[(i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length)].id;
    g.sfx('tick');
  }
  /** Keyboard focus can only sit on a button that exists now (call at the end of a frame). */
  function endFrame() { if (U.focus && !U.list.some((b) => b.id === U.focus && !b.disabled)) U.focus = null; }
  return Object.assign(U, { famFor, font, dirFor, fit, measure, wrap, text, para, button, coins, coin, yearCard, record, hit, cycleFocus, endFrame, focusRing });
}
