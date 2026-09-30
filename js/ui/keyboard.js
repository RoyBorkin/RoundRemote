// Compact on-screen keyboard shaped to fit the lower half of a round display.
import { h } from './dom.js';
import { icon } from './icons.js';
import { store } from '../core/store.js';
import { coarsePointer } from '../core/util.js';

const LAYOUTS = {
  abc: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
    ['123', ' ', '↵'],
  ],
  num: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '&', '@', '\''],
    ['_', '.', ',', '?', '!', '"', '#', '=', '⌫'],
    ['ABC', ' ', '↵'],
  ],
};

export function wantsKeyboard() {
  const k = store.get('keyboard');
  return k === 'on' || (k === 'auto' && coarsePointer());
}

/**
 * @param {HTMLInputElement} input  the field to type into
 * @param {{onEnter?:Function}} opts
 */
export function createKeyboard(input, { onEnter } = {}) {
  let layout = 'abc', shift = false, enterIcon = 'search';
  const el = h('div.kbd', { role: 'group', 'aria-label': 'On-screen keyboard' });
  const fire = () => input.dispatchEvent(new Event('input', { bubbles: true }));

  const press = (k) => {
    if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
    if (k === '⌫') { input.value = input.value.slice(0, -1); fire(); return; }
    if (k === '↵') { onEnter?.(input.value); return; }
    if (k === '⇧') { shift = !shift; render(); return; }
    if (k === '123') { layout = 'num'; render(); return; }
    if (k === 'ABC') { layout = 'abc'; render(); return; }
    input.value += shift ? k.toUpperCase() : k;
    if (shift) { shift = false; render(); }
    fire();
  };

  // Hold backspace to repeat.
  let repeatT = null;
  const stopRepeat = () => { clearTimeout(repeatT); clearInterval(repeatT); repeatT = null; };

  function render() {
    el.innerHTML = '';
    LAYOUTS[layout].forEach((row, ri) => {
      const r = h(`div.kbd-row.r${ri}`);
      for (const k of row) {
        let label = k, cls = 'key';
        if (k === ' ') { label = 'space'; cls += ' space'; }
        if (k === '↵') cls += ' enter';
        if (['⇧', '123', 'ABC', '⌫'].includes(k)) cls += ' mod';
        if (k === '⇧' && shift) cls += ' on';
        const b = h('button', { type: 'button', class: cls, 'aria-label': k === ' ' ? 'space' : k });
        if (k === '⌫') b.innerHTML = icon('backspace');
        else if (k === '↵') b.innerHTML = icon(enterIcon);
        else b.textContent = shift && k.length === 1 ? k.toUpperCase() : label;
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation();
          b.classList.add('down');
          press(k);
          if (k === '⌫') repeatT = setTimeout(() => { repeatT = setInterval(() => press('⌫'), 70); }, 420);
        });
        const up = () => { b.classList.remove('down'); stopRepeat(); };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointerleave', up);
        b.addEventListener('pointercancel', up);
        r.appendChild(b);
      }
      el.appendChild(r);
    });
  }
  render();
  el.setEnterIcon = (name) => { enterIcon = name; render(); };
  return el;
}

/**
 * Edit a text value in a round panel (with the on-screen keyboard when wanted).
 * Resolves with the new string, or null if cancelled.
 */
export function editText({ title = 'Edit', value = '', placeholder = '', secret = false } = {}) {
  // Lazy import to avoid a module cycle (overlay ← keyboard).
  return import('./overlay.js').then(({ openPanel }) => new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openPanel({
      title, className: 'edit-panel kbd-open',
      onClose: () => finish(null),
      build(body, panel) {
        const input = h('input.edit-input', { type: secret ? 'password' : 'text', value, placeholder, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
        const ok = h('button.pill.primary', { type: 'button', onclick: () => { finish(input.value.trim()); panel.close(); } }, 'Save');
        body.append(input, ok);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { finish(input.value.trim()); panel.close(); } });
        if (wantsKeyboard()) {
          input.readOnly = true;
          const kb = createKeyboard(input, { onEnter: (v) => { finish(v.trim()); panel.close(); } });
          kb.setEnterIcon('check');
          panel.el.appendChild(kb);
        } else {
          panel.el.classList.remove('kbd-open');
          setTimeout(() => { input.focus(); input.select(); }, 200);
        }
      },
    });
  }));
}

/** A form field that uses editText() on touch screens and a normal input elsewhere. */
export function field({ label, value = '', placeholder = '', secret = false, onChange }) {
  const input = h('input.field-input', { type: secret ? 'password' : 'text', value, placeholder, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  if (wantsKeyboard()) {
    input.readOnly = true;
    input.addEventListener('click', async () => {
      const v = await editText({ title: label, value: input.value, placeholder, secret });
      if (v !== null) { input.value = v; onChange?.(v); }
    });
  } else {
    input.addEventListener('change', () => onChange?.(input.value.trim()));
  }
  return h('label.field', h('span.field-label', label), input);
}
