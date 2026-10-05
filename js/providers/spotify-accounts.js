// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Spotify has no sub-users, so "who's listening" = several saved Spotify accounts, each with its own tokens
// (rr.auth.spotify.accounts; the active one is rr.auth.spotify as before). Adding an account signs in with
// Spotify's account chooser (show_dialog=true); switching swaps the tokens and restarts the Spotify tile.
// Note: a Spotify app in development mode only lets in the accounts listed under User Management in the
// Spotify developer dashboard — add every family member there.
import { store } from '../core/store.js';
import { provider } from './registry.js';

const VAULT = 'spotify.accounts';
const sp = () => provider('spotify');
const clean = (msg) => Object.assign(new Error(msg), { userMessage: msg });

export function spotifyAccounts() {
  const act = store.auth('spotify')?.id;
  return (store.auth(VAULT) || []).filter((a) => a.id).map((a) => ({ id: a.id, name: a.name || a.id, image: a.image || '', product: a.product || '', active: a.id === act }));
}
export function activeSpotifyAccount() {
  const a = store.auth('spotify');
  return a?.refresh ? { id: a.id || '', name: a.name || 'Spotify', image: a.image || '', active: true } : null;
}
export const spotifyAccountCount = () => spotifyAccounts().length;

export async function switchSpotifyAccount(acc) {
  const saved = (store.auth(VAULT) || []).find((a) => a.id === acc.id);
  if (!saved?.refresh) throw clean('Sign in to this account again');
  const cur = store.auth('spotify');
  if (cur?.id === saved.id) return activeSpotifyAccount();
  if (cur?.id) sp()._vault(cur);   // keep the current account's latest tokens
  store.setAuth('spotify', { ...saved });
  sp()._accountChanged();
  return activeSpotifyAccount();
}
/** Sign in to one more account (Spotify shows its account chooser; the page comes back signed in as that one). */
export function addSpotifyAccount() {
  const cur = store.auth('spotify');
  if (cur?.id) sp()._vault(cur);
  return sp().connect({ addAccount: true });
}
export function forgetSpotifyAccount(acc) {
  store.setAuth(VAULT, (store.auth(VAULT) || []).filter((a) => a.id !== acc.id));
  if (store.auth('spotify')?.id !== acc.id) return;
  const next = (store.auth(VAULT) || [])[0];
  if (next) { store.setAuth('spotify', { ...next }); sp()._accountChanged(); }
  else sp().signOut();
}
