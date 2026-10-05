// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Settings extension point: modules add their own settings pages/rows without editing settings.js.
//   registerSettings({ group: 'general'|'music'|'media'|'home'|'games'|'apps'|'device'|'accounts'|…, id, title, icon?, order?, build(el, ctx) })
// settings.js lists every registered entry inside its category's sub-menu (Android-style), and calls build() when opened.
const entries = [];
export function registerSettings(entry) {
  if (!entry?.id || typeof entry.build !== 'function') return;
  const i = entries.findIndex((e) => e.id === entry.id);
  if (i >= 0) entries[i] = entry; else entries.push(entry);
}
export const settingsEntries = (group) => entries.filter((e) => !group || e.group === group).sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
