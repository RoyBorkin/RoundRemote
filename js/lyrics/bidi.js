// Right-to-left detection for lyrics (Hebrew, Arabic, Persian, Urdu, Syriac…).
// A line counts as RTL when it has more right-to-left letters than left-to-right ones,
// so a Hebrew line with an English word or two still reads right to left.
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/gu;
const LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ԯ]/gu;
// Scripts whose letters join up (Arabic family) must never be split into single letters.
const JOINING = /[؀-ࣿﭐ-﷿ﹰ-﻿]/u;

export function isRTL(text = '') {
  const r = (text.match(RTL) || []).length;
  if (!r) return false;
  return r >= (text.match(LTR) || []).length;
}
export const dirOf = (text) => (isRTL(text) ? 'rtl' : 'ltr');
/** Direction of the first strong letter (the Unicode bidi rule for a paragraph): 'rtl', 'ltr', or '' when there is none (digits, symbols). */
const STRONG = /[֐-ࣿיִ-﷿ﹰ-﻿]|[A-Za-zÀ-ɏͰ-ϿЀ-ԯ぀-鿿가-힯]/u;
export function firstStrongDir(text = '') {
  const m = STRONG.exec(String(text));
  if (!m) return '';
  return /[֐-ࣿיִ-﷿ﹰ-﻿]/u.test(m[0]) ? 'rtl' : 'ltr';
}
export const joinsLetters = (text = '') => JOINING.test(text);
/** Direction of a whole song: what most of its lines are. */
export function songDir(lines = []) {
  let r = 0, n = 0;
  for (const ln of lines) { if (!ln.text?.trim()) continue; n++; if (isRTL(ln.text)) r++; }
  return n && r / n >= 0.5 ? 'rtl' : 'ltr';
}
