// Calculator: the digits sit around the edge like the numbers on a clock (1 at one o'clock … 0 and the decimal
// point at ten and eleven), the display and the operators in the middle. Correct precedence (× ÷ before + −),
// %, ±, backspace, memory (the M key flips the function row to MC MR M+ M−), a history page and a tip / split helper.
// Keys: digits . + - * / % Enter (=) Backspace (delete) Delete/C (clear) · Escape = Back.
import { h } from '../js/ui/dom.js';
import { icon } from '../js/ui/icons.js';
import { curve, topPanel } from '../js/ui/overlay.js';

const OPS = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const MAX_DIGITS = 15;
const isOp = (k) => Object.hasOwn(OPS, k);

// ------------------------------------------------------------------ maths
/** tokens: { t:'num', s:'12.5', pct?:true } | { t:'op', v:'+'|'-'|'*'|'/' } → number (NaN on error) */
export function evaluate(tokens) {
  const tk = [...tokens];
  while (tk.length && tk[tk.length - 1].t === 'op') tk.pop();
  if (!tk.length) return 0;
  // resolve percentages: "a + b%" = a + a·b/100, otherwise b% = b/100
  const vals = [], ops = [];
  for (let i = 0; i < tk.length; i++) {
    const x = tk[i];
    if (x.t === 'op') { ops.push(x.v); continue; }
    let v = parseFloat(x.s);
    if (!Number.isFinite(v)) v = 0;
    if (x.pct) {
      const op = i > 0 ? tk[i - 1] : null;
      if (op && (op.v === '+' || op.v === '-')) v = evaluate(tk.slice(0, i - 1)) * v / 100;
      else v /= 100;
    }
    vals.push(v);
  }
  // × ÷ first
  const v2 = [vals[0]], o2 = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i], b = vals[i + 1];
    if (op === '*') v2[v2.length - 1] *= b;
    else if (op === '/') { if (b === 0) return NaN; v2[v2.length - 1] /= b; }
    else { o2.push(op); v2.push(b); }
  }
  let r = v2[0];
  for (let i = 0; i < o2.length; i++) r = o2[i] === '+' ? r + v2[i + 1] : r - v2[i + 1];
  return r;
}

export function fmt(n) {
  if (!Number.isFinite(n)) return 'Error';
  if (n === 0) return '0';
  const r = parseFloat(n.toPrecision(12));
  const a = Math.abs(r);
  const out = a >= 1e15 || a < 1e-9 ? r.toExponential(6).replace(/\.?0+e/, 'e').replace('e+', 'e') : r.toLocaleString('en-US', { maximumFractionDigits: 10 });
  return out.replace(/^-/, '−').replace('e-', 'e−');
}
/** A number as typed ("1234.50") with thousands separators, keeping trailing zeros / point. */
function fmtEntry(s) {
  const neg = s.startsWith('-'); if (neg) s = s.slice(1);
  const [i, d] = s.split('.');
  const int = (i || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '−' : '') + int + (d !== undefined ? '.' + d : '');
}
const exprText = (tokens) => tokens.map((x) => (x.t === 'op' ? ` ${OPS[x.v]} ` : fmtEntry(x.s) + (x.pct ? '%' : ''))).join('');
const money = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');

export default {
  css: './calc.css',
  create(el, app) {
    let tokens = [];
    let done = false;            // the display shows a result (typing a digit starts over)
    let lastExpr = '';
    let memory = app.data('memory', 0);
    let history = app.data('history', []);
    let memMode = false;
    let page = null;             // null | 'history' | 'tip'

    // ---------------------------------------------------------------- UI
    const exprEl = h('div.ca-expr');
    const valEl = h('div.ca-val');
    const memEl = h('div.ca-mem');
    const display = h('div.ca-display', exprEl, valEl, memEl);
    const ring = h('div.ca-ring');
    // digits on the clock positions: 1…9 at 1–9 o'clock, 0 at 10, the point at 11
    const ringKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '.'];
    ringKeys.forEach((k, i) => {
      const a = ((i + 1) * 30 * Math.PI) / 180;
      ring.append(key(k === '.' ? '·' : k, () => press(k), 'ca-digit', { left: `${50 + 40 * Math.sin(a)}%`, top: `${50 - 40 * Math.cos(a)}%` }, k === '.' ? 'Decimal point' : k));
    });
    const fnRow = h('div.ca-row.ca-fn');
    const opRow = h('div.ca-row.ca-ops', ['/', '*', '-', '+'].map((o) => key(OPS[o], () => press(o), 'ca-op', null, { '/': 'Divide', '*': 'Multiply', '-': 'Minus', '+': 'Plus' }[o])));
    const mKey = key('M', () => { memMode = !memMode; renderFn(); app.sfx('tick'); }, 'ca-small ca-mkey', null, 'Memory keys');
    const eqKey = key('=', () => press('='), 'ca-eq', null, 'Equals');
    const histKey = key('', () => openPage('history'), 'ca-small', null, 'History'); histKey.innerHTML = icon('list');
    const tipKey = key('', () => openPage('tip'), 'ca-small ca-tipkey', null, 'Tip and split'); tipKey.innerHTML = icon('people');
    const bottomRow = h('div.ca-row.ca-bottom', mKey, histKey, eqKey, tipKey);
    const main = h('div.ca-main', ring, display, fnRow, opRow, bottomRow);
    const sub = h('div.ca-sub');
    const root = h('div.ca', main, sub);
    el.append(root);

    function key(label, fn, cls = '', style = null, aria = '') {
      const b = h(`button.ca-key${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button', 'aria-label': aria || label, style: style || undefined }, label);
      b.addEventListener('pointerdown', () => { b.classList.add('down'); app.sfx('tap', { volume: 0.5 }); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => b.classList.remove('down')));
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    }
    function flash(k) {
      const sel = /^[0-9]$/.test(k) ? `.ca-digit[aria-label="${k}"]` : k === '.' ? '.ca-digit[aria-label="Decimal point"]' : null;
      const b = sel ? ring.querySelector(sel) : null;
      if (b) { b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 110); }
    }
    function renderFn() {
      const keys = memMode
        ? [['MC', () => { memory = 0; save(); render(); }, 'Memory clear'], ['MR', () => recall(), 'Memory recall'],
          ['M+', () => memAdd(1), 'Memory add'], ['M−', () => memAdd(-1), 'Memory subtract']]
        : [['AC', () => press('AC'), 'Clear'], ['⌫', () => press('Backspace'), 'Delete'], ['%', () => press('%'), 'Percent'], ['±', () => press('±'), 'Plus or minus']];
      fnRow.replaceChildren(...keys.map(([l, f, a]) => key(l, f, `ca-fnk${memMode ? '.ca-memk' : ''}`, null, a)));
      mKey.classList.toggle('on', memMode);
    }

    // ---------------------------------------------------------------- input
    const last = () => tokens[tokens.length - 1];
    const current = () => (tokens.length ? evaluate(tokens) : 0);
    function press(k) {
      if (k >= '0' && k <= '9') {
        if (done) { tokens = []; done = false; }
        const t = last();
        if (t?.t === 'num' && t.fresh) { t.s = k; delete t.fresh; }
        else if (t?.t === 'num' && !t.pct) {
          const digits = t.s.replace(/[-.]/g, '').length;
          if (digits >= MAX_DIGITS) return;
          if (t.s === '0') t.s = k; else if (t.s === '-0') t.s = '-' + k; else t.s += k;
        } else if (t?.t === 'num' && t.pct) return;
        else tokens.push({ t: 'num', s: k });
      } else if (k === '.') {
        if (done) { tokens = []; done = false; }
        const t = last();
        if (t?.t === 'num' && t.fresh) { t.s = '0.'; delete t.fresh; }
        else if (t?.t === 'num') { if (!t.s.includes('.') && !t.pct) t.s += '.'; }
        else tokens.push({ t: 'num', s: '0.' });
      } else if (isOp(k)) {
        if (done) { const v = current(); tokens = Number.isFinite(v) ? [{ t: 'num', s: String(parseFloat(v.toPrecision(12))) }] : []; done = false; }
        if (!tokens.length) tokens.push({ t: 'num', s: '0' });
        const t = last();
        if (t.t === 'op') t.v = k;
        else { if (t.s.endsWith('.')) t.s = t.s.slice(0, -1); tokens.push({ t: 'op', v: k }); }
      } else if (k === '%') {
        const t = last();
        if (t?.t === 'num') { t.pct = !t.pct; done = false; }
      } else if (k === '±') {
        if (done) done = false;
        const t = last();
        if (t?.t === 'num') t.s = t.s.startsWith('-') ? t.s.slice(1) : '-' + t.s;
        else tokens.push({ t: 'num', s: '-0' });
      } else if (k === 'Backspace') {
        if (done) { tokens = []; done = false; lastExpr = ''; }
        const t = last();
        if (!t) return render();
        if (t.t === 'op') tokens.pop();
        else if (t.pct) t.pct = false;
        else { t.s = t.s.slice(0, -1); if (t.s === '' || t.s === '-') tokens.pop(); }
      } else if (k === 'AC') {
        tokens = []; done = false; lastExpr = '';
      } else if (k === '=') {
        if (!tokens.length || (done && tokens.length === 1)) return;
        const v = current();
        const expr = exprText(tokens.filter((x, i, a) => !(i === a.length - 1 && x.t === 'op')));
        lastExpr = `${expr} =`;
        history = [{ expr, result: fmt(v), value: Number.isFinite(v) ? v : null, at: Date.now() }, ...history].slice(0, 60);
        app.save('history', history);
        tokens = Number.isFinite(v) ? [{ t: 'num', s: String(parseFloat(v.toPrecision(12))) }] : [];
        done = true;
        if (!Number.isFinite(v)) { valEl.textContent = 'Error'; exprEl.textContent = lastExpr; app.sfx('hit'); valEl.classList.add('err'); return; }
      }
      render();
    }
    function recall() {
      if (done) { tokens = []; done = false; }
      const s = String(parseFloat(memory.toPrecision(12)));
      const t = last();
      if (t?.t === 'num') { t.s = s; t.fresh = true; } else tokens.push({ t: 'num', s, fresh: true });
      render();
    }
    function memAdd(sign) {
      const v = current();
      if (!Number.isFinite(v)) return;
      memory = parseFloat((memory + sign * v).toPrecision(14));
      save(); done = true; render();
      app.toast(`Memory: ${fmt(memory)}`);
    }
    const save = () => app.save('memory', memory);

    function render() {
      valEl.classList.remove('err');
      memEl.classList.toggle('on', memory !== 0);
      memEl.textContent = `M  ${fmt(memory)}`;
      let big, small;
      if (done) { big = tokens.length ? fmt(parseFloat(tokens[0].s)) : '0'; small = lastExpr; }
      else if (!tokens.length) { big = '0'; small = lastExpr ? '' : ''; }
      else {
        big = exprText(tokens);
        const hasOp = tokens.some((x) => x.t === 'op') || tokens.some((x) => x.pct);
        const v = current();
        small = hasOp ? (Number.isFinite(v) ? `= ${fmt(v)}` : '= Error') : '';
      }
      valEl.textContent = big;
      exprEl.textContent = small;
      // shrink long numbers to fit
      const len = big.length;
      valEl.style.fontSize = `${len <= 8 ? 11 : len <= 11 ? 9 : len <= 14 ? 7.4 : len <= 18 ? 6 : 5}cqmin`;
      valEl.classList.toggle('long', len > 18);
    }

    // ---------------------------------------------------------------- sub-pages
    function openPage(which) {
      page = which;
      sub.replaceChildren();
      root.classList.add('sub-open');
      app.hideTitle(false);
      if (which === 'history') buildHistory(); else buildTip();
      app.sfx('tap');
    }
    function closePage() {
      page = null; root.classList.remove('sub-open'); app.setTitle(); app.hideTitle(true);
      setTimeout(() => { if (!page) sub.replaceChildren(); }, 300);
    }

    function buildHistory() {
      app.setTitle('History');
      const list = h('div.ca-hlist');
      const draw = () => {
        list.replaceChildren(...history.map((it) => h('button.ca-hrow', { type: 'button', disabled: it.value === null, onclick: () => {
          if (it.value === null) return;
          tokens = [{ t: 'num', s: String(parseFloat(it.value.toPrecision(12))) }]; done = true; lastExpr = `${it.expr} =`;
          closePage(); render(); app.sfx('pop');
        } }, h('div.ca-hexpr', it.expr), h('div.ca-hres', `= ${it.result}`))));
        if (!history.length) list.append(h('div.ca-hempty', h('i', { html: icon('list') }), 'No calculations yet'));
      };
      draw();
      curve(list);
      const clearBtn = h('button.pill.small.ca-hclear', { type: 'button', onclick: () => { history = []; app.save('history', history); draw(); app.sfx('drop'); } }, 'Clear history');
      sub.append(list, history.length ? clearBtn : null, h('div.ca-hhint', 'Tap one to use its result'));
    }

    function buildTip() {
      app.setTitle('Tip & split');
      const st = app.data('tip', { pct: 15, people: 2, round: false });
      let bill = current();
      if (!Number.isFinite(bill) || bill < 0) bill = 0;
      const billEl = h('div.tp-bill');
      const pctEl = h('div.tp-num'), pplEl = h('div.tp-num');
      const per = h('div.tp-per'), perLbl = h('div.tp-perlbl'), totals = h('div.tp-totals');
      const step = (fn) => { const b = h('button.ibtn.small.tp-step', { type: 'button' }); fn(b); return b; };
      const minusP = step((b) => { b.innerHTML = icon('minus'); b.setAttribute('aria-label', 'Less tip'); b.onclick = () => setPct(st.pct - 1); });
      const plusP = step((b) => { b.innerHTML = icon('plus'); b.setAttribute('aria-label', 'More tip'); b.onclick = () => setPct(st.pct + 1); });
      const minusN = step((b) => { b.innerHTML = icon('minus'); b.setAttribute('aria-label', 'Fewer people'); b.onclick = () => setPeople(st.people - 1); });
      const plusN = step((b) => { b.innerHTML = icon('plus'); b.setAttribute('aria-label', 'More people'); b.onclick = () => setPeople(st.people + 1); });
      const chips = h('div.chips.tp-chips');
      const roundChip = h('button.chip.tp-round', { type: 'button', onclick: () => { st.round = !st.round; draw(); } }, 'Round up');
      const setPct = (v) => { st.pct = Math.max(0, Math.min(100, v)); draw(); app.sfx('tick'); };
      const setPeople = (v) => { st.people = Math.max(1, Math.min(99, v)); draw(); app.sfx('tick'); };
      const draw = () => {
        app.save('tip', st);
        billEl.replaceChildren(h('span.tp-billlbl', 'Bill'), h('span.tp-billval', money(bill)));
        pctEl.replaceChildren(String(st.pct), h('small', '% tip'));
        pplEl.replaceChildren(String(st.people), h('small', st.people === 1 ? 'person' : 'people'));
        chips.replaceChildren(...[0, 10, 12, 15, 18, 20].map((p) => h(`button.chip${p === st.pct ? '.on' : ''}`, { type: 'button', onclick: () => setPct(p) }, `${p}%`)));
        const tip = bill * st.pct / 100, total = bill + tip;
        let each = total / st.people;
        if (st.round) each = Math.ceil(each - 1e-9);
        per.textContent = money(each);
        perLbl.textContent = st.people === 1 ? 'You pay' : 'Each person pays';
        totals.replaceChildren(h('span', 'Tip ', h('b', money(tip))), h('span', 'Total ', h('b', money(st.round ? each * st.people : total))));
        roundChip.classList.toggle('on', st.round);
      };
      const editBill = h('button.tp-edit', { type: 'button', onclick: () => closePage() }, billEl, h('span.tp-editlbl', bill ? 'change on the calculator' : 'type the bill on the calculator first'));
      sub.append(h('div.tp', editBill,
        h('div.tp-line', minusP, pctEl, plusP), chips,
        h('div.tp-line.tp-ppl', minusN, pplEl, plusN),
        perLbl, per, totals, roundChip));
      tipKeys = { left: () => setPct(st.pct - 1), right: () => setPct(st.pct + 1), up: () => setPeople(st.people + 1), down: () => setPeople(st.people - 1) };
      draw();
    }
    let tipKeys = null;

    // ---------------------------------------------------------------- keyboard (capture phase, so Backspace deletes instead of leaving)
    const onKey = (e) => {
      if (e.target.matches?.('input, textarea') || topPanel() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (page) {
        if (page === 'tip' && tipKeys) {
          const f = { ArrowLeft: tipKeys.left, ArrowRight: tipKeys.right, ArrowUp: tipKeys.up, ArrowDown: tipKeys.down }[e.key];
          if (f) { e.preventDefault(); f(); }
        }
        return;   // Escape / Backspace → the shell's Back closes the page
      }
      let k = e.key;
      if (k === 'x' || k === 'X') k = '*';
      if (k === ',') k = '.';
      if (k === 'Enter' || k === '=') k = '=';
      if (k === 'Delete' || k === 'c' || k === 'C') k = 'AC';
      if (k === 'm' || k === 'M') { e.preventDefault(); mKey.click(); return; }
      if (k === 'h' || k === 'H') { e.preventDefault(); openPage('history'); return; }
      if (k === 't' || k === 'T') { e.preventDefault(); openPage('tip'); return; }
      if (/^[0-9.]$/.test(k) || isOp(k) || k === '%' || k === '=' || k === 'AC' || k === 'Backspace') {
        e.preventDefault(); e.stopImmediatePropagation();
        flash(k);
        app.sfx('tap', { volume: 0.4 });
        press(k);
      }
    };
    window.addEventListener('keydown', onKey, true);

    app.hideTitle(true);
    renderFn();
    render();
    return {
      destroy() { window.removeEventListener('keydown', onKey, true); },
      back() { if (page) { closePage(); return true; } return false; },
    };
  },
};
