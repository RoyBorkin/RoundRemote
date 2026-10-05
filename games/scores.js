// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// High scores: the 5 best places for every game (and every mode / option of a game), with the player's name, kept with the rest of the
// settings (store key "gameScores"), so a settings profile copies them to another display too.
import { store } from '../js/core/store.js';

export const PLACES = 5;

const keyOf = (gameId, mode) => `${gameId}:${mode || 'default'}`;

/** The chart for one game + mode: [{ score, label, at }], best first. */
export function topScores(gameId, mode) {
  return [...((store.get('gameScores') || {})[keyOf(gameId, mode)] || [])];
}

/** Best entry (or null). */
export function bestScore(gameId, mode) { return topScores(gameId, mode)[0] || null; }

/**
 * Add a result. `scoring` is 'high' (bigger is better) or 'low' (smaller is better, e.g. a time).
 * Returns { rank } — 1…5 when it made the chart, 0 when it didn't — and the updated list.
 * Entries: { score, label, at, name?, text? }
 */
export function addScore(gameId, mode, score, { scoring = 'high', label = '' } = {}) {
  if (score == null || !Number.isFinite(+score)) return { rank: 0, list: topScores(gameId, mode) };
  const list = topScores(gameId, mode);
  const entry = { score: +score, label: String(label || '').slice(0, 24), at: Date.now() };
  list.push(entry);
  list.sort((a, b) => (scoring === 'low' ? a.score - b.score : b.score - a.score) || a.at - b.at);
  const top = list.slice(0, PLACES);
  const rank = top.indexOf(entry) + 1;
  const all = { ...(store.get('gameScores') || {}) };
  all[keyOf(gameId, mode)] = top;
  store.set('gameScores', all);
  return { rank, list: top, entry };
}

/** Change fields of a saved entry (its name, formatted text…). Returns the updated entry. */
export function updateEntry(gameId, mode, entry, fields) {
  if (!entry) return entry;
  const all = { ...(store.get('gameScores') || {}) };
  const k = keyOf(gameId, mode);
  let out = { ...entry, ...fields };
  all[k] = (all[k] || []).map((e) => (e.at === entry.at && e.score === entry.score ? (out = { ...e, ...fields }) : e));
  store.set('gameScores', all);
  return out;
}

/** Would this score make the chart? (for "new best!" previews) */
export function wouldPlace(gameId, mode, score, scoring = 'high') {
  const list = topScores(gameId, mode);
  if (list.length < PLACES) return true;
  const last = list[list.length - 1].score;
  return scoring === 'low' ? score < last : score > last;
}

export function clearScores(gameId) {
  const all = { ...(store.get('gameScores') || {}) };
  for (const k of Object.keys(all)) if (!gameId || k.startsWith(`${gameId}:`)) delete all[k];
  store.set('gameScores', all);
}
