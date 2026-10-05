// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Fill the Blank — card packs: the built-in ones (our own cards, loaded only when chosen), the bridge's house pack and
// imported packs (bridge/lib/blanks.js keeps those for every display), packs imported by link on this display, and the
// helpers that fill a prompt's blanks with answers.
import { bridgeBase, bridgeFetch } from '../js/providers/bridge.js';

export const BUILTIN = [
  { id: 'family-en', name: 'Family', lang: 'en', adult: false, file: './blanks-family-en.js', note: 'All ages' },
  { id: 'family-he', name: 'משפחתית', lang: 'he', adult: false, file: './blanks-family-he.js', note: 'כל הגילים' },
  { id: 'party-en', name: 'Party', lang: 'en', adult: true, file: './blanks-party-en.js', note: 'Cheeky grown-up humour' },
  { id: 'party-he', name: 'מסיבה', lang: 'he', adult: true, file: './blanks-party-he.js', note: 'הומור למבוגרים' },
];
export const builtinById = (id) => BUILTIN.find((p) => p.id === id) || null;

const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
export const blanksIn = (t) => (String(t).match(/_{2,}/g) || []).length;
const hasHe = (s) => /[֐-׿]/.test(s || '');

const cache = new Map();
/** A built-in pack → { prompts: [{ t, pick }], answers: [t] }. */
export async function loadBuiltin(id) {
  const meta = builtinById(id);
  if (!meta) return null;
  if (!cache.has(id)) {
    cache.set(id, import(meta.file).then((m) => ({
      id, name: meta.name, lang: meta.lang, adult: meta.adult,
      prompts: lines(m.PROMPTS).map((t) => ({ t, pick: Math.max(1, blanksIn(t)) })),
      answers: lines(m.ANSWERS),
    })).catch((e) => { cache.delete(id); throw e; }));
  }
  return cache.get(id);
}

/** Same rules as the bridge: our format ({ name, lang, prompts: [{ text, pick }], answers: [text] }) or close cousins. */
export function normalizePack(raw) {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { throw new Error('That isn’t JSON'); } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('That isn’t a card pack');
  const clean = (v, max = 240) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const P = [raw.prompts, raw.black, raw.blackCards, raw.calls, raw.questions].find(Array.isArray) || [];
  const A = [raw.answers, raw.white, raw.whiteCards, raw.responses].find(Array.isArray) || [];
  const prompts = [], answers = [], sp = new Set(), sa = new Set();
  for (const x of P.slice(0, 6000)) {
    const tx = typeof x === 'string' ? x : Array.isArray(x?.text) ? x.text.join('___') : x?.text ?? x?.t ?? '';
    const t = clean(tx).replace(/\{\s*blank\s*\}/gi, '___').replace(/_+/g, '___');
    if (!t || sp.has(t)) continue;
    sp.add(t); prompts.push({ t, pick: Math.max(1, Math.min(3, Math.round(+x?.pick || blanksIn(t) || 1))) });
    if (prompts.length >= 3000) break;
  }
  for (const x of A.slice(0, 20000)) {
    const t = clean(typeof x === 'string' ? x : x?.text ?? x?.t ?? '');
    if (!t || sa.has(t)) continue;
    sa.add(t); answers.push(t);
    if (answers.length >= 10000) break;
  }
  if (!prompts.length && !answers.length) throw new Error('No cards found — a pack needs "prompts" and/or "answers"');
  const sample = [...prompts.slice(0, 20).map((p) => p.t), ...answers.slice(0, 20)].join(' ');
  return { name: clean(raw.name || raw.title || 'Imported pack', 60) || 'Imported pack', lang: /^(he|iw)/i.test(raw.lang || '') || (!raw.lang && hasHe(sample)) ? 'he' : 'en',
    adult: !!(raw.adult || raw.nsfw), prompts, answers };
}

// ---------------------------------------------------------------- the bridge's packs
export async function hasBridge() { return !!(await bridgeBase().catch(() => null)); }
/** { house: { prompts, answers }, packs: [summary] } or null without a bridge. */
export async function bridgePacks() {
  if (!(await hasBridge())) return null;
  try { return await bridgeFetch('/api/blanks/packs', { timeout: 5000 }); } catch { return null; }
}
export async function bridgePack(id, adult = false) {
  const d = await bridgeFetch(`/api/blanks/pack?id=${encodeURIComponent(id)}${adult ? '&adult=1' : ''}`, { timeout: 8000 });
  return { id, name: d.name, lang: d.lang, adult: !!d.adult, prompts: (d.prompts || []).map((p) => ({ t: p.text, pick: p.pick || Math.max(1, blanksIn(p.text)) })), answers: d.answers || [], cards: d.cards, rawPrompts: d.prompts };
}
export async function removeBridgePack(id, key) { return bridgeFetch(`/api/blanks/packs?id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`, { method: 'DELETE', timeout: 5000 }); }
export async function removeHouseCard(id, key) { return bridgeFetch(`/api/blanks/house?id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`, { method: 'DELETE', timeout: 5000 }); }

/** Import a pack from a link: straight from this page when the site allows it, else through the bridge (which keeps it). */
export async function importUrl(url) {
  let direct = null, err = null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
    if (!r.ok) throw new Error(`The link answered ${r.status}`);
    const txt = await r.text();
    if (txt.length > 3e6) throw new Error('That pack is too big (3 MB at most)');
    direct = normalizePack(txt);
  } catch (e) { err = e; }
  if (direct) return { local: direct };
  if (await hasBridge()) {
    const d = await bridgeFetch('/api/blanks/packs', { method: 'POST', json: { url, by: 'display' }, timeout: 15000 });
    return { bridge: d.pack };
  }
  throw err || new Error('Couldn’t load that link');
}

// ---------------------------------------------------------------- filling the blanks
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** The prompt with its blanks filled: [{ s: text } | { a: answer } | { gap: true }] (extra answers go after the prompt). */
export function fillParts(text, cards = []) {
  const parts = String(text || '').split(/_{2,}/), out = [];
  let i = 0;
  parts.forEach((p, j) => {
    if (p) out.push({ s: p });
    if (j < parts.length - 1) {
      const c = cards[i++];
      if (c == null) { out.push({ gap: true }); return; }
      const before = parts.slice(0, j + 1).join('').trim();
      let s = String(c).trim().replace(/[.。]+$/, '');
      if (!before || /[.!?]$/.test(before)) s = cap(s);
      out.push({ a: s });
    }
  });
  while (i < cards.length) { const c = cards[i++]; if (c != null) out.push({ s: ' ' }, { a: cap(String(c).trim()), after: true }); }
  return out;
}
export const fillText = (text, cards) => fillParts(text, cards).map((x) => x.s ?? x.a ?? '____').join('');
export const capFirst = cap;
