// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Collection — the pure part shared by the display (apps/collection-*.js) and the bridge (bridge/lib/collection.js):
// platform names, title matching, the CSV / JSON import presets (GamEye, CLZ Games, Grouvee, BoardGameGeek CSV,
// BG Stats JSON, any other spreadsheet) and the merge rules used by every sync and import.
// No imports and no browser / Node APIs, so the bridge can load it too.
//
// An incoming entry (what a source or a file gives us):
//   { sid, kind: 'video'|'board', title, platform, year, art, edition, ownership, condition, digital, qty, players: [lo, hi],
//     mins: [lo, hi], age, rating, bggId, expansion, baseIds, plays, lastPlayed, hours, beaten, completion, notes, tags, lent,
//     value, paid }       (money in cents; times in ms)
// A stored item (apps/collection-store.js) is the same plus { id, sources: { <source>: sid }, own: { <field>: <source>|'user' }, added, updated }.
//
// Merge rules (mergeEntries):
//   • an entry matches an item by its source id, else by its BoardGameGeek id, else by normalised title + platform (+ kind);
//   • a source only fills empty fields or updates the ones it set itself — never a field you edited (own[field] === 'user');
//   • play counts and hours only ever go up (your +1s are kept);
//   • a mirror sync (BGG, PriceCharting, RAWG, Steam) unlinks items the source no longer lists: an item nobody else knows and you
//     never edited is removed, anything else is kept. File imports never remove anything.

export const KINDS = ['video', 'board'];

// ---------------------------------------------------------------- platforms
// [id, display name, short name, aliases…]
const P = [
  ['ps5', 'PlayStation 5', 'PS5', 'playstation 5', 'ps5', 'sony playstation 5', 'playstation5'],
  ['ps4', 'PlayStation 4', 'PS4', 'playstation 4', 'ps4', 'sony playstation 4', 'playstation4'],
  ['ps3', 'PlayStation 3', 'PS3', 'playstation 3', 'ps3', 'sony playstation 3'],
  ['ps2', 'PlayStation 2', 'PS2', 'playstation 2', 'ps2', 'sony playstation 2'],
  ['ps1', 'PlayStation', 'PS1', 'playstation', 'playstation 1', 'ps1', 'psx', 'psone', 'ps one', 'sony playstation'],
  ['psp', 'PSP', 'PSP', 'psp', 'playstation portable'],
  ['vita', 'PS Vita', 'Vita', 'ps vita', 'playstation vita', 'vita', 'psvita'],
  ['switch2', 'Nintendo Switch 2', 'Switch 2', 'nintendo switch 2', 'switch 2', 'ns2'],
  ['switch', 'Nintendo Switch', 'Switch', 'nintendo switch', 'switch', 'ns', 'nsw'],
  ['wiiu', 'Wii U', 'Wii U', 'wii u', 'wiiu', 'nintendo wii u'],
  ['wii', 'Wii', 'Wii', 'wii', 'nintendo wii'],
  ['gamecube', 'GameCube', 'GameCube', 'gamecube', 'nintendo gamecube', 'gcn', 'ngc'],
  ['n64', 'Nintendo 64', 'N64', 'nintendo 64', 'n64'],
  ['snes', 'Super Nintendo', 'SNES', 'super nintendo', 'snes', 'super nes', 'super famicom', 'super nintendo entertainment system'],
  ['nes', 'NES', 'NES', 'nes', 'nintendo entertainment system', 'famicom', 'nintendo nes'],
  ['3ds', 'Nintendo 3DS', '3DS', 'nintendo 3ds', '3ds', 'new nintendo 3ds', '2ds'],
  ['ds', 'Nintendo DS', 'DS', 'nintendo ds', 'ds', 'nds', 'nintendo dsi'],
  ['gba', 'Game Boy Advance', 'GBA', 'game boy advance', 'gba', 'gameboy advance'],
  ['gbc', 'Game Boy Color', 'GBC', 'game boy color', 'gbc', 'gameboy color'],
  ['gb', 'Game Boy', 'Game Boy', 'game boy', 'gameboy', 'gb'],
  ['xsx', 'Xbox Series X|S', 'Xbox Series', 'xbox series x', 'xbox series s', 'xbox series x s', 'xbox series', 'xsx', 'xbox series xs'],
  ['xone', 'Xbox One', 'Xbox One', 'xbox one', 'xone', 'xb1'],
  ['x360', 'Xbox 360', 'Xbox 360', 'xbox 360', 'x360', '360'],
  ['xbox', 'Xbox', 'Xbox', 'xbox', 'original xbox', 'microsoft xbox'],
  ['pc', 'PC', 'PC', 'pc', 'windows', 'pc windows', 'steam', 'pc steam', 'microsoft windows', 'pc dos', 'dos', 'steam deck'],
  ['mac', 'Mac', 'Mac', 'mac', 'macos', 'mac os', 'apple macintosh'],
  ['genesis', 'Sega Genesis', 'Genesis', 'sega genesis', 'genesis', 'mega drive', 'sega mega drive', 'megadrive'],
  ['dreamcast', 'Dreamcast', 'Dreamcast', 'dreamcast', 'sega dreamcast'],
  ['saturn', 'Sega Saturn', 'Saturn', 'sega saturn', 'saturn'],
  ['sms', 'Master System', 'SMS', 'sega master system', 'master system'],
  ['gamegear', 'Game Gear', 'Game Gear', 'game gear', 'sega game gear'],
  ['2600', 'Atari 2600', 'Atari 2600', 'atari 2600', 'atari vcs'],
  ['neogeo', 'Neo Geo', 'Neo Geo', 'neo geo', 'neogeo', 'neo geo aes'],
  ['tg16', 'TurboGrafx-16', 'TG-16', 'turbografx 16', 'turbografx', 'pc engine'],
  ['android', 'Android', 'Android', 'android'],
  ['ios', 'iOS', 'iOS', 'ios', 'iphone', 'ipad'],
];
const PLAT = new Map(P.map(([id, name, short]) => [id, { id, name, short }]));
const ALIAS = new Map();
for (const [id, , , ...al] of P) for (const a of al) ALIAS.set(a, id);
const plKey = (s) => String(s || '').toLowerCase().replace(/&/g, ' ').replace(/[™®©]/g, '').replace(/\|/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** "PlayStation 5" / "PS5" / "playstation5" → 'ps5'; an unknown name stays as it is (trimmed). */
export function canonPlatform(s) {
  const raw = String(s ?? '').trim();
  if (!raw) return '';
  if (PLAT.has(raw)) return raw;
  const k = plKey(raw);
  if (ALIAS.has(k)) return ALIAS.get(k);
  // "Nintendo Switch (Digital)", "PS4 - PAL", "PlayStation 4 [EU]" …
  const k2 = plKey(raw.replace(/[([].*?[)\]]/g, ' ').replace(/\s[-–]\s.*$/, ''));
  if (ALIAS.has(k2)) return ALIAS.get(k2);
  return raw.slice(0, 40);
}
export const platformName = (id) => PLAT.get(id)?.name || id || '';
export const platformShort = (id) => PLAT.get(id)?.short || id || '';
export const PLATFORM_CHOICES = ['ps5', 'ps4', 'switch', 'switch2', 'xsx', 'xone', 'pc', 'ps3', 'x360', 'wii', 'wiiu', '3ds', 'ds', 'ps2', 'gamecube', 'n64', 'snes', 'nes', 'gba', 'ps1', 'xbox', 'vita', 'psp', 'genesis', 'dreamcast'];
const DIGITAL_RE = /\b(digital|download|eshop|psn|e-?shop|steam|gog|epic|xbox live|ms store)\b/i;

// ---------------------------------------------------------------- titles
/** Lower-case, accent-free, punctuation-free ("The Witcher 3: Wild Hunt™" = "the witcher 3 wild hunt"). */
export function normTitle(s = '') {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[™®©]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export const itemKey = (kind, title, platform) => `${kind}|${normTitle(title)}|${kind === 'board' ? '' : canonPlatform(platform)}`;
const titleKey = (kind, title) => `${kind}|${normTitle(title)}`;

// ---------------------------------------------------------------- small parsers
const str = (v, max = 300) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
export const yearOf = (v) => { const m = /(1[89]\d\d|20\d\d)/.exec(String(v ?? '')); return m ? +m[1] : null; };
/** "$12.34" / "12,34 €" / "1,234.50" / 1234 (cents when cents=true) → cents */
export function money(v, { cents = false } = {}) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(cents ? v : v * 100) : null;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  if (/,\d{1,2}$/.test(s) && !/\.\d/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // 12,34 → 12.34
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(cents ? n : n * 100) : null;
}
const truthy = (v) => /^(1|y|yes|true|x|✓|beat|beaten|completed?|done|finished)$/i.test(String(v ?? '').trim());
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const int = (v) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? n : null; };
/** "2-4" / "2–4 players" / "1+" / "3" → [lo, hi] */
export function range(v, open = 99) {
  const nums = [...String(v ?? '').matchAll(/(\d+)(\+?)/g)];
  if (!nums.length) return null;
  const lo = +nums[0][1], last = nums[nums.length - 1];
  return [lo, last[2] ? open : Math.max(lo, +last[1])];
}
const pair = (lo, hi) => { lo = int(lo); hi = int(hi); if (!lo && !hi) return null; return [lo || hi, Math.max(lo || hi, hi || lo)]; };
function dateMs(v) {
  if (!v) return null;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const s = String(v).trim();
  if (/^\d{10,13}$/.test(s)) return +s > 1e12 ? +s : +s * 1000;
  const t = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}
const splitTags = (v) => [...new Set(String(v ?? '').split(/[;|,]/).map((t) => str(t, 30)).filter(Boolean))].slice(0, 12);
/** "Complete in Box" / "CIB" / "Loose" / "New" / "Sealed" / "Digital" → ownership code */
export function ownershipOf(v) {
  const s = String(v ?? '').toLowerCase();
  if (!s.trim()) return '';
  if (/digital|download/.test(s)) return 'digital';
  if (/graded/.test(s)) return 'graded';
  if (/sealed|\bnew\b|brand new|mint/.test(s)) return 'new';
  if (/cib|complete|box.*manual|game.*box/.test(s)) return 'cib';
  if (/loose|cart(ridge)? only|disc only|game only/.test(s)) return 'loose';
  if (/box only/.test(s)) return 'box';
  if (/manual only/.test(s)) return 'manual';
  return '';
}
export const OWNERSHIP = { cib: 'Complete (CIB)', loose: 'Loose', new: 'New / sealed', digital: 'Digital', graded: 'Graded', box: 'Box only', manual: 'Manual only' };

// ---------------------------------------------------------------- CSV
export function detectDelimiter(text) {
  const head = String(text).split(/\r?\n/).slice(0, 5).join('\n');
  const count = (c) => { let n = 0, q = false; for (const ch of head) { if (ch === '"') q = !q; else if (ch === c && !q) n++; } return n; };
  const best = [',', ';', '\t', '|'].map((c) => [c, count(c)]).sort((a, b) => b[1] - a[1])[0];
  return best[1] ? best[0] : ',';
}
/** RFC 4180 CSV: quoted fields with commas, "" escapes and line breaks; BOM; CRLF. → string[][] */
export function parseCsv(text, delim) {
  text = String(text ?? '').replace(/^﻿/, '');
  const d = delim || detectDelimiter(text);
  const rows = [];
  let row = [], f = '', q = false, i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === '') { q = true; i++; continue; }
    if (c === d) { row.push(f); f = ''; i++; continue; }
    if (c === '\r' || c === '\n') { row.push(f); f = ''; rows.push(row); row = []; i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; continue; }
    f += c; i++;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}
const hk = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** column finder: col(['Title','Name']) → index | -1 */
function finder(headers) {
  const keys = headers.map(hk);
  return (names) => { for (const n of [].concat(names)) { const i = keys.indexOf(hk(n)); if (i >= 0) return i; } return -1; };
}

// ---------------------------------------------------------------- presets
// detect(keys:Set of normalised headers) → score (0 = no). rows(rows, headers) → { items, wishes, skipped }
const GAMEYE = ['platform', 'category', 'userrecordtype', 'title', 'ownership', 'pricecib', 'beat'];
export const PRESETS = [
  { id: 'gameye', name: 'GamEye', kind: 'video', ext: 'csv', hint: 'GamEye → Settings → Export collection (CSV)',
    detect: (k) => GAMEYE.filter((x) => k.has(x)).length >= 5 ? 10 : 0, rows: gameyeRows },
  { id: 'clz', name: 'CLZ Games', kind: 'video', ext: 'csv', hint: 'CLZ Games → Export to CSV (Title + Platform columns)',
    detect: (k) => (k.has('title') && k.has('platform') && ['completeness', 'collectionstatus', 'index', 'loanedto', 'purchaseprice', 'barcode', 'edition', 'region'].filter((x) => k.has(x)).length >= 2 ? 8 : 0), rows: clzRows },
  { id: 'grouvee', name: 'Grouvee', kind: 'video', ext: 'csv', hint: 'Grouvee → Profile → Export your data (CSV)',
    detect: (k) => (k.has('name') && k.has('shelves') && (k.has('giantbombid') || k.has('platforms')) ? 9 : 0), rows: grouveeRows },
  { id: 'bggcsv', name: 'BoardGameGeek CSV', kind: 'board', ext: 'csv', hint: 'boardgamegeek.com → your collection → Export (CSV)',
    detect: (k) => (k.has('objectname') && k.has('objectid') ? 10 : 0), rows: bggCsvRows },
  { id: 'bgstats', name: 'BG Stats', kind: 'board', ext: 'json', hint: 'BG Stats → Settings → Export data (JSON)', detect: () => 0, rows: null },
  { id: 'generic', name: 'Other spreadsheet', kind: null, ext: 'csv', hint: 'Any CSV — pick the Title / Platform / Players columns', detect: () => 1, rows: genericRows },
];
export const presetById = (id) => PRESETS.find((p) => p.id === id) || null;

function gameyeRows(rows, headers) {
  const c = finder(headers);
  const I = { plat: c('Platform'), cat: c('Category'), type: c('UserRecordType'), title: c('Title'), country: c('Country'), rel: c('ReleaseType'), pub: c('Publisher'), dev: c('Developer'),
    created: c('CreatedAt'), own: c('Ownership'), loose: c('PriceLoose'), cib: c('PriceCIB'), nw: c('PriceNew'), yours: c('YourPrice'), paid: c('PricePaid'), cond: c('ItemCondition'),
    box: c('BoxCondition'), man: c('ManualCondition'), beat: c('Beat'), comp: c('PlayedCompletion'), notes: c('Notes'), tags: c('Tags') };
  const g = (r, i) => (i >= 0 ? str(r[i]) : '');
  const items = [], wishes = []; let skipped = 0;
  for (const r of rows) {
    const title = g(r, I.title);
    if (!title) { skipped++; continue; }
    const cat = g(r, I.cat).toLowerCase();
    if (cat && !/^games?$/.test(cat)) { skipped++; continue; }      // consoles, accessories, amiibo…
    const type = g(r, I.type).toLowerCase();
    const platform = canonPlatform(g(r, I.plat));
    if (/wish/.test(type)) { wishes.push({ kind: 'game', title, note: [platformName(platform), g(r, I.notes)].filter(Boolean).join(' · '), source: 'gameye' }); continue; }
    if (type && !/own|collect|for ?sale|sell/.test(type)) { skipped++; continue; }
    const own = ownershipOf(g(r, I.own));
    const price = { cib: money(g(r, I.cib)), loose: money(g(r, I.loose)), new: money(g(r, I.nw)) };
    const value = money(g(r, I.yours)) ?? (own === 'new' ? price.new : own === 'loose' ? price.loose : price.cib ?? price.loose) ?? null;
    const cond = [g(r, I.cond) && `Item: ${g(r, I.cond)}`, g(r, I.box) && `Box: ${g(r, I.box)}`, g(r, I.man) && `Manual: ${g(r, I.man)}`].filter(Boolean).join(' · ');
    const tags = splitTags(g(r, I.tags));
    if (/sale|sell/.test(type)) tags.push('for sale');
    items.push(entry({
      sid: `${platform}|${normTitle(title)}`, kind: 'video', title, platform, ownership: own || (DIGITAL_RE.test(g(r, I.rel)) ? 'digital' : ''), digital: /digital/i.test(g(r, I.own) + g(r, I.rel)),
      condition: cond, value, paid: money(g(r, I.paid)), beaten: truthy(g(r, I.beat)), completion: g(r, I.comp), notes: g(r, I.notes), tags,
      edition: [g(r, I.country), /^(standard|retail|normal)$/i.test(g(r, I.rel)) ? '' : g(r, I.rel)].filter(Boolean).join(' · '), by: g(r, I.dev) || g(r, I.pub),
      added: dateMs(g(r, I.created)),
    }));
  }
  return { items, wishes, skipped };
}
function clzRows(rows, headers) {
  const c = finder(headers);
  const I = { title: c(['Title', 'Name']), plat: c(['Platform', 'System']), ed: c('Edition'), reg: c('Region'), comp: c(['Completeness', 'Format']), cond: c('Condition'),
    paid: c(['Purchase Price', 'Price Paid']), val: c(['Current Value', 'Value', 'My Value', 'Market Value']), rel: c(['Release Date', 'Release Year', 'Year']), pub: c('Publisher'), dev: c('Developer'),
    notes: c(['Notes', 'Personal Notes']), tags: c('Tags'), status: c(['Collection Status', 'Status']), loan: c(['Loaned To', 'Loaned']), loanDate: c(['Loan Date', 'Loaned Date']),
    done: c(['Completed', 'Beaten', 'Finished']), barcode: c(['Barcode', 'UPC', 'EAN']), idx: c(['Index', 'ID']) };
  const g = (r, i) => (i >= 0 ? str(r[i]) : '');
  const items = [], wishes = []; let skipped = 0;
  for (const r of rows) {
    const title = g(r, I.title);
    if (!title) { skipped++; continue; }
    const status = g(r, I.status).toLowerCase();
    const platform = canonPlatform(g(r, I.plat));
    if (/wish/.test(status)) { wishes.push({ kind: 'game', title, note: platformName(platform), source: 'clz' }); continue; }
    if (status && !/collection|for ?sale|sold?$|^own/.test(status) || /^sold$/.test(status)) { skipped++; continue; }
    const loan = g(r, I.loan);
    items.push(entry({
      sid: g(r, I.idx) || `${platform}|${normTitle(title)}`, kind: 'video', title, platform, year: yearOf(g(r, I.rel)), edition: [g(r, I.ed), g(r, I.reg)].filter(Boolean).join(' · '),
      ownership: ownershipOf(g(r, I.comp)), digital: /digital/i.test(g(r, I.comp)), condition: g(r, I.cond), paid: money(g(r, I.paid)), value: money(g(r, I.val)),
      notes: g(r, I.notes), tags: splitTags(g(r, I.tags)), beaten: truthy(g(r, I.done)), by: g(r, I.dev) || g(r, I.pub), upc: g(r, I.barcode),
      lent: loan ? { name: loan, at: dateMs(g(r, I.loanDate)) || null } : null,
    }));
  }
  return { items, wishes, skipped };
}
/** Grouvee keeps shelves / platforms as JSON objects in a cell (or a plain list). */
function jsonKeys(v) {
  const s = String(v ?? '').trim();
  if (!s) return [];
  if (s.startsWith('{')) { try { return Object.keys(JSON.parse(s)); } catch {} }
  if (s.startsWith('[')) { try { return JSON.parse(s).map((x) => (typeof x === 'string' ? x : x?.name || x?.status || x?.title || '')).filter(Boolean); } catch {} }
  return s.split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
}
function grouveeRows(rows, headers) {
  const c = finder(headers);
  const I = { id: c('id'), name: c('name'), shelves: c('shelves'), plats: c('platforms'), rating: c('rating'), review: c('review'), statuses: c('statuses'), rel: c('release_date'), dev: c('developers'), gb: c('giantbomb_id') };
  const g = (r, i) => (i >= 0 ? String(r[i] ?? '') : '');
  const items = [], wishes = []; let skipped = 0;
  for (const r of rows) {
    const title = str(g(r, I.name));
    if (!title) { skipped++; continue; }
    const shelves = jsonKeys(g(r, I.shelves)).map((s) => s.toLowerCase());
    const plats = jsonKeys(g(r, I.plats));
    if (shelves.some((s) => /wish/.test(s)) && !shelves.some((s) => /own|played|playing|backlog|beat/.test(s))) { wishes.push({ kind: 'game', title, note: plats.slice(0, 2).join(', '), source: 'grouvee' }); continue; }
    const statuses = jsonKeys(g(r, I.statuses)).concat(shelves).join(' ').toLowerCase();
    const platform = plats.length === 1 ? canonPlatform(plats[0]) : plats.length ? canonPlatform(plats[0]) : '';
    items.push(entry({
      sid: g(r, I.id) || `${platform}|${normTitle(title)}`, kind: 'video', title, platform, year: yearOf(g(r, I.rel)), by: str(jsonKeys(g(r, I.dev))[0] || ''),
      rating: num(g(r, I.rating)) ? Math.min(10, num(g(r, I.rating)) * 2) : null, notes: str(g(r, I.review), 500), beaten: /beat|complet|finish/.test(statuses),
      tags: shelves.filter((s) => !/played|playing/.test(s)).slice(0, 4), platforms: plats.slice(0, 8).map(canonPlatform),
    }));
  }
  return { items, wishes, skipped };
}
function bggCsvRows(rows, headers) {
  const c = finder(headers);
  const I = { name: c('objectname'), id: c('objectid'), rating: c('rating'), plays: c('numplays'), own: c('own'), wish: c('wishlist'), want: c('wanttobuy'), prev: c('prevowned'),
    comment: c('comment'), cond: c('conditiontext'), avg: c('baverage'), type: c('itemtype'), sub: c('objecttype'), minp: c('minplayers'), maxp: c('maxplayers'), time: c('playingtime'),
    mint: c('minplaytime'), maxt: c('maxplaytime'), year: c('yearpublished'), paid: c('pricepaid'), cur: c('currvalue'), qty: c('quantity'), priv: c('privatecomment'), age: c('bggrecagerange'),
    bar: c('barcode') };
  const g = (r, i) => (i >= 0 ? str(r[i]) : '');
  const items = [], wishes = []; let skipped = 0;
  for (const r of rows) {
    const title = g(r, I.name);
    if (!title) { skipped++; continue; }
    const own = I.own < 0 || truthy(g(r, I.own));
    if (!own) {
      if (truthy(g(r, I.wish)) || truthy(g(r, I.want))) wishes.push({ kind: 'game', title, note: 'Board game', source: 'bgg', ref: g(r, I.id) ? `https://boardgamegeek.com/boardgame/${g(r, I.id)}` : '' });
      else skipped++;
      continue;
    }
    const exp = /expansion/i.test(g(r, I.type) + g(r, I.sub));
    items.push(entry({
      sid: g(r, I.id) || normTitle(title), bggId: g(r, I.id) || '', kind: 'board', title, year: yearOf(g(r, I.year)), players: pair(g(r, I.minp), g(r, I.maxp)),
      mins: pair(g(r, I.mint) || g(r, I.time), g(r, I.maxt) || g(r, I.time)), rating: num(g(r, I.rating)) || num(g(r, I.avg)), plays: int(g(r, I.plays)) || 0, expansion: exp,
      notes: [g(r, I.comment), g(r, I.priv)].filter(Boolean).join(' · '), condition: g(r, I.cond), paid: money(g(r, I.paid)), value: money(g(r, I.cur)), qty: int(g(r, I.qty)) || 1,
      age: int(g(r, I.age)) || null, upc: g(r, I.bar),
    }));
  }
  return { items, wishes, skipped };
}
/** map = { title, platform, players, time, kind: 'video'|'board', notes } (column indexes; -1 = none) */
export function guessMap(headers, kind = null) {
  const c = finder(headers);
  const title = c(['Title', 'Name', 'Game', 'Game Title', 'Game Name', 'objectname', 'שם', 'כותר']);
  const platform = c(['Platform', 'System', 'Console', 'Platforms', 'פלטפורמה']);
  const players = c(['Players', 'Number of players', 'Player Count', 'Min Players', 'minplayers', 'שחקנים']);
  const time = c(['Time', 'Play Time', 'Playing Time', 'Playtime', 'Duration', 'Minutes', 'זמן']);
  const notes = c(['Notes', 'Note', 'Comment', 'Comments', 'הערות']);
  return { title: title >= 0 ? title : 0, platform, players, time, notes, kind: kind || (players >= 0 && platform < 0 ? 'board' : 'video') };
}
function genericRows(rows, headers, map) {
  const m = { ...guessMap(headers), ...(map || {}) };
  const g = (r, i) => (i >= 0 && i != null ? str(r[i]) : '');
  const items = []; let skipped = 0;
  const board = m.kind === 'board';
  for (const r of rows) {
    const title = g(r, m.title);
    if (!title) { skipped++; continue; }
    const platform = board ? '' : canonPlatform(g(r, m.platform));
    items.push(entry({ sid: `${platform}|${normTitle(title)}`, kind: board ? 'board' : 'video', title, platform, players: board ? range(g(r, m.players)) : null, mins: board ? range(g(r, m.time), 0) : null, notes: g(r, m.notes) }));
  }
  return { items, wishes: [], skipped };
}
/** BG Stats export: { games: [...], plays: [...] } */
function bgStatsJson(j) {
  const plays = new Map(), last = new Map();
  for (const p of j.plays || []) {
    const id = p.gameRefId ?? p.gameId;
    if (id == null) continue;
    plays.set(id, (plays.get(id) || 0) + 1);
    const t = dateMs(p.playDate);
    if (t && t > (last.get(id) || 0)) last.set(id, t);
  }
  const items = []; let skipped = 0;
  const byId = new Map((j.games || []).map((g) => [g.id, g]));
  for (const g of j.games || []) {
    const title = str(g.name);
    if (!title) { skipped++; continue; }
    if (g.owned === 0 || g.owned === false) { skipped++; continue; }
    const exp = !!(g.isExpansion && +g.isExpansion);
    const base = exp && g.expansionOf != null ? byId.get(g.expansionOf) : null;
    items.push(entry({
      sid: String(g.uuid || g.id || normTitle(title)), bggId: g.bggId ? String(g.bggId) : '', kind: 'board', title, year: yearOf(g.bggYear || g.year), art: g.urlImage || g.urlThumb || '',
      players: pair(g.minPlayerCount, g.maxPlayerCount), mins: pair(g.minPlayTime, g.maxPlayTime), plays: plays.get(g.id) || 0, lastPlayed: last.get(g.id) || null, expansion: exp,
      baseIds: base?.bggId ? [String(base.bggId)] : [], rating: num(g.rating) || null,
    }));
  }
  return { items, wishes: [], skipped };
}

/** Normalise an entry: drop empty fields, clamp strings. */
export function entry(e) {
  const o = {};
  for (const [k, v] of Object.entries(e)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'number' && !Number.isFinite(v))) continue;
    if (v === false && k !== 'beaten') continue;
    o[k] = typeof v === 'string' ? str(v, k === 'notes' ? 600 : k === 'art' ? 600 : 200) : v;
  }
  if (o.kind !== 'board') o.kind = 'video';
  if (o.kind === 'video' && o.platform) o.platform = canonPlatform(o.platform);
  if (o.kind === 'board') delete o.platform;
  if (o.ownership === 'digital') o.digital = true;
  return o;
}

/**
 * Parse a file's text with a preset ('auto' detects it). JSON → BG Stats (or a plain list of { title, platform }).
 * → { preset, presetName, kind, items, wishes, skipped, total, headers, map, error }
 */
export function importText(text, { preset = 'auto', map = null } = {}) {
  text = String(text ?? '').replace(/^﻿/, '');
  const trimmed = text.trim();
  if (!trimmed) return { error: 'The file is empty', items: [], wishes: [] };
  if ((preset === 'auto' || preset === 'bgstats') && /^[[{]/.test(trimmed)) {
    let j;
    try { j = JSON.parse(trimmed); } catch (e) { return { error: `Not valid JSON (${e.message})`, items: [], wishes: [] }; }
    if (j && Array.isArray(j.games)) {
      const r = bgStatsJson(j);
      return { preset: 'bgstats', presetName: 'BG Stats', kind: 'board', ...r, total: (j.games || []).length, headers: [] };
    }
    const arr = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : null;
    if (arr) {
      const items = arr.map((x) => (x && (x.title || x.name) ? entry({ sid: '', kind: x.kind === 'board' ? 'board' : 'video', title: x.title || x.name, platform: x.platform, year: x.year, notes: x.notes }) : null)).filter(Boolean);
      return { preset: 'generic', presetName: 'JSON list', kind: null, items, wishes: [], skipped: arr.length - items.length, total: arr.length, headers: [] };
    }
    return { error: 'This JSON isn’t a BG Stats export', items: [], wishes: [] };
  }
  if (preset === 'bgstats') return { error: 'A BG Stats export is a .json file', items: [], wishes: [] };
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: 'No rows found — is this a CSV with a header row?', items: [], wishes: [] };
  const headers = rows[0].map((h) => String(h).trim());
  const keys = new Set(headers.map(hk));
  let p = preset !== 'auto' ? presetById(preset) : null;
  if (!p) p = PRESETS.filter((x) => x.rows).map((x) => [x, x.detect(keys)]).sort((a, b) => b[1] - a[1])[0][0];
  const body = rows.slice(1);
  const r = p.id === 'generic' ? genericRows(body, headers, map) : p.rows(body, headers);
  // the same game twice in one file = two copies
  const seen = new Map(), items = [];
  for (const it of r.items) {
    const k = it.sid || itemKey(it.kind, it.title, it.platform);
    const prev = seen.get(k);
    if (prev) { prev.qty = (prev.qty || 1) + (it.qty || 1); continue; }
    seen.set(k, it); items.push(it);
  }
  return { preset: p.id, presetName: p.name, kind: p.kind || (map?.kind ?? null), items, wishes: r.wishes, skipped: r.skipped, total: body.length, headers,
    map: p.id === 'generic' ? { ...guessMap(headers), ...(map || {}) } : null };
}

// ---------------------------------------------------------------- merging
// fields a source can set; the rest (id, sources, own, added…) is bookkeeping
export const FIELDS = ['title', 'platform', 'year', 'art', 'edition', 'ownership', 'condition', 'digital', 'qty', 'players', 'mins', 'age', 'rating', 'bggId', 'expansion', 'baseIds',
  'plays', 'lastPlayed', 'hours', 'beaten', 'completion', 'notes', 'tags', 'lent', 'value', 'paid', 'by', 'upc', 'platforms', 'appid', 'psnId', 'rawgId'];
const UP_ONLY = new Set(['plays', 'hours', 'lastPlayed']);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

/** Did you change anything on this item by hand (an edit, a +1, a loan, a note)? */
export const hasUserEdits = (it) => Object.values(it?.own || {}).includes('user');

/**
 * Merge entries from one source into the items map. Pure: returns a new map and counts.
 *   opts: { mirror (unlink / remove what the source no longer lists), now, newId(), keep (sids to leave alone) }
 */
export function mergeEntries(map, entries, src, { mirror = false, now = Date.now(), newId } = {}) {
  const items = { ...map };
  const mk = newId || (() => 'c_' + now.toString(36) + Math.random().toString(36).slice(2, 8));
  const bySid = new Map(), byBgg = new Map(), byKey = new Map(), byTitle = new Map();
  const index = (it) => {
    const sid = it.sources?.[src];
    if (sid != null && sid !== true) bySid.set(String(sid), it.id);
    if (it.bggId) byBgg.set(String(it.bggId), it.id);
    byKey.set(itemKey(it.kind, it.title, it.platform), it.id);
    const tk = titleKey(it.kind, it.title);
    byTitle.set(tk, [...(byTitle.get(tk) || []), it.id]);
  };
  Object.values(items).forEach(index);
  const touched = new Set();
  let added = 0, updated = 0, removed = 0, unlinked = 0, unchanged = 0;
  for (const raw of entries || []) {
    const e = raw?.title ? entry(raw) : null;
    if (!e) continue;
    const sid = e.sid != null && e.sid !== '' ? String(e.sid) : null;
    delete e.sid;
    let id = (sid && bySid.get(sid)) || (e.kind === 'board' && e.bggId && byBgg.get(String(e.bggId))) || byKey.get(itemKey(e.kind, e.title, e.platform)) || null;
    if (!id) {
      // no platform on one side: the only copy with that title
      const cands = (byTitle.get(titleKey(e.kind, e.title)) || []).filter((x) => items[x] && (!e.platform || !items[x].platform) && !touched.has(x));
      if (cands.length === 1) id = cands[0];
    }
    if (id && touched.has(id) && !(sid && items[id].sources?.[src] === sid)) {
      // a second copy in the same sync → one more copy of the item
      const it = items[id];
      if (it.own?.qty !== 'user') items[id] = { ...it, qty: (it.qty || 1) + (e.qty || 1), own: { ...(it.own || {}), qty: src } };
      continue;
    }
    if (id && items[id]) {
      const it = items[id];
      const own = { ...(it.own || {}) };
      const patch = {};
      for (const f of FIELDS) {
        if (!(f in e)) continue;
        const v = e[f], cur = it[f], who = own[f];
        if (who === 'user') continue;
        if (UP_ONLY.has(f)) { if ((+v || 0) > (+cur || 0)) { patch[f] = v; own[f] = src; } continue; }
        if (f === 'tags') { const t = [...new Set([...(cur || []), ...v])].slice(0, 16); if (!same(t, cur)) { patch.tags = t; } continue; }
        if (isEmpty(cur) || !who || who === src) { if (!same(v, cur)) { patch[f] = v; own[f] = src; } }
      }
      const sources = { ...(it.sources || {}), [src]: sid ?? true };
      const changed = Object.keys(patch).length || !same(sources, it.sources);
      if (changed) { items[id] = { ...it, ...patch, own, sources, updated: now }; updated += Object.keys(patch).length ? 1 : 0; if (!Object.keys(patch).length) unchanged++; }
      else unchanged++;
      touched.add(id);
      continue;
    }
    const nid = mk();
    const own = {};
    for (const f of FIELDS) if (f in e && !isEmpty(e[f])) own[f] = src;
    const added_ = e.added && e.added < now ? e.added : now;
    delete e.added;
    items[nid] = { ...e, id: nid, sources: { [src]: sid ?? true }, own, added: added_, updated: now };
    index(items[nid]);
    touched.add(nid);
    added++;
  }
  if (mirror) {
    for (const it of Object.values(items)) {
      if (!it.sources || !(src in it.sources) || touched.has(it.id)) continue;
      const others = Object.keys(it.sources).filter((s) => s !== src);
      if (!others.length && !hasUserEdits(it)) { delete items[it.id]; removed++; continue; }
      const sources = { ...it.sources }; delete sources[src];
      items[it.id] = { ...it, sources: Object.keys(sources).length ? sources : { manual: true }, updated: now };
      unlinked++;
    }
  }
  return { items, added, updated, removed, unlinked, unchanged, total: (entries || []).length };
}

/** Disconnect a source: keep its items (they become yours) or remove the ones only it knew (and you never edited). */
export function dropSource(map, src, { removeItems = false, now = Date.now() } = {}) {
  const items = { ...map };
  let removed = 0, kept = 0;
  for (const it of Object.values(items)) {
    if (!it.sources || !(src in it.sources)) continue;
    const others = Object.keys(it.sources).filter((s) => s !== src);
    if (removeItems && !others.length && !hasUserEdits(it)) { delete items[it.id]; removed++; continue; }
    const sources = { ...it.sources }; delete sources[src];
    items[it.id] = { ...it, sources: Object.keys(sources).length ? sources : { manual: true }, updated: now };
    kept++;
  }
  return { items, removed, kept };
}

// ---------------------------------------------------------------- source names (badges)
export const SOURCES = {
  bgg: { name: 'BoardGameGeek', short: 'BGG', color: '#ff5100' },
  pricecharting: { name: 'PriceCharting', short: 'PriceCharting', color: '#2f9e44' },
  rawg: { name: 'RAWG', short: 'RAWG', color: '#6366f1' },
  steam: { name: 'Steam', short: 'Steam', color: '#66c0f4' },
  psn: { name: 'PlayStation', short: 'PSN', color: '#3b8ef0' },
  gameye: { name: 'GamEye', short: 'GamEye', color: '#7c3aed' },
  clz: { name: 'CLZ Games', short: 'CLZ', color: '#e11d48' },
  grouvee: { name: 'Grouvee', short: 'Grouvee', color: '#0ea5e9' },
  bggcsv: { name: 'BGG export', short: 'BGG CSV', color: '#ff7a33' },
  bgstats: { name: 'BG Stats', short: 'BG Stats', color: '#14b8a6' },
  generic: { name: 'Spreadsheet', short: 'CSV', color: '#64748b' },
  file: { name: 'Watched file', short: 'File', color: '#64748b' },
  phone: { name: 'Added from phone', short: 'Phone', color: '#f59e0b' },
  wishlist: { name: 'From your wish list', short: 'Wish list', color: '#ec4899' },
  manual: { name: 'Added by hand', short: 'By hand', color: '#94a3b8' },
};
export const sourceName = (s) => SOURCES[s]?.name || (s ? String(s)[0].toUpperCase() + String(s).slice(1) : '');
