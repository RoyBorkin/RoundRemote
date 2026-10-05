// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The built-in content of the other games, registered into the Tasks content manager as packs: Never Have I Ever,
// Most Likely To and Party Cards prompts and the Kings Cup rules (apps/drinks-data.js), and the Trivia Night question
// banks (apps/trivia-bank.js, apps/trivia-bank-he.js). The games' own data files stay the source; this only turns them
// into items with stable ids, so each one can be edited, hidden or marked 18+ like any built-in truth or dare:
//   b:<lang>:<x?><n|l|p>:<hash of the text>   prompts (x = the spicy / 18+ deck)
//   b:en:r:<rank>                              Kings Cup rule for a rank (A, 2 … 10, J, Q, K)
//   b:<lang>:q:<hash of the question>          trivia questions
import { NEVER, LIKELY, PARTY, KINGS_RULES } from './drinks-data.js';
import { CATS, EN as TRIVIA_EN } from './trivia-bank.js';
import { HE as TRIVIA_HE } from './trivia-bank-he.js';

export { CATS as TRIVIA_CATS };
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const PARTY_KINDS = ['e', 'p', 'd', 'g', 'v', 'r'];

/** A short stable hash (FNV-1a, base 36) — ids that survive reordering of the data files. */
export function hid(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return (x >>> 0).toString(36);
}

const base = (lang) => ({ author: '', session: '', created: 0, updated: 0, builtin: lang, lang });

function prompts(src, type, letter) {
  const out = [];
  for (const [lang, decks] of Object.entries(src)) {
    for (const [deck, list] of Object.entries(decks)) {
      const adult = deck === 'spicy';
      const used = new Set();
      for (const line of list) {
        let id = `b:${lang}:${adult ? 'x' : ''}${letter}:${hid(line)}`;
        for (let n = 2; used.has(id); n++) id = `b:${lang}:${adult ? 'x' : ''}${letter}:${hid(line)}${n}`;
        used.add(id);
        const it = { id, type, text: line, tags: adult ? ['18+'] : [], ...base(lang) };
        if (type === 'party') {
          const [kind, text, end] = line.split('|');
          Object.assign(it, { kind: PARTY_KINDS.includes(kind) ? kind : 'e', text: text || '', ...(end ? { end } : {}) });
        }
        out.push(it);
      }
    }
  }
  return out;
}

function kings() {
  return RANKS.map((r) => ({ id: `b:en:r:${r}`, type: 'kings', rank: r, title: KINGS_RULES[r].t, text: KINGS_RULES[r].d, tags: [], ...base('en') }));
}

function trivia() {
  const out = [];
  for (const [lang, bank] of [['en', TRIVIA_EN], ['he', TRIVIA_HE]]) {
    const used = new Set();
    for (const [cat, txt] of Object.entries(bank)) {
      for (const line of txt.trim().split('\n')) {
        const [d, q, a, ...w] = line.split('|');
        if (!q || !a) continue;
        let id = `b:${lang}:q:${hid(q)}`;
        for (let n = 2; used.has(id); n++) id = `b:${lang}:q:${hid(q)}${n}`;
        used.add(id);
        out.push({ id, type: 'trivia', text: q, answer: a, wrong: w.slice(0, 3), cat, d: +d || 2, tags: [], ...base(lang) });
      }
    }
  }
  return out;
}

let ALL = null;
/** Every built-in item of the drinking games and Trivia (built once, on first use). */
export function builtinItems() {
  return (ALL ||= [...prompts(NEVER, 'never', 'n'), ...prompts(LIKELY, 'likely', 'l'), ...prompts(PARTY, 'party', 'p'), ...kings(), ...trivia()]);
}
