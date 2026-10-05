// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Collection — the pure part shared by the display (apps/collection-*.js) and the bridge (bridge/lib/collection.js):
// the six shelves (video games, board games, books, vinyl, CDs, DVD / Blu-ray), platform names and families, genres,
// board-game types, formats and Goldmine grades, title matching, the CSV / JSON import presets (GamEye, CLZ Games /
// Books / Music / Movies, Grouvee, BoardGameGeek CSV, BG Stats JSON, Discogs CSV, Goodreads CSV, any other
// spreadsheet), the mappers for Discogs / Open Library / MusicBrainz / TMDB answers and the merge rules used by every
// sync and import. No imports and no browser / Node APIs, so the bridge can load it too.
//
// An incoming entry (what a source or a file gives us):
//   { sid, kind: 'video'|'board'|'book'|'vinyl'|'cd'|'movie', title, platform, year, art, edition, ownership, condition, digital,
//     qty, players: [lo, hi], mins: [lo, hi], age, rating, bggId, expansion, baseIds, plays, lastPlayed, hours, beaten, completion,
//     notes, tags, lent, value, paid,
//     by (developer · author · artist · director), genres: [compact genre], type + traits (board games), isbn, publisher, pages,
//     read ('want'|'reading'|'read'), format, variant, rpm, discs, label, catno, grade, sleeve, country, region, runtime, steelbook,
//     discogsId, olid, mbid, tmdbId, tmdbType, game (an app game id) }      (money in cents; times in ms)
// A stored item (apps/collection-store.js) is the same plus { id, sources: { <source>: sid }, own: { <field>: <source>|'user' }, added, updated }.
//
// Merge rules (mergeEntries):
//   • an entry matches an item by its source id, else by its BoardGameGeek id, else by normalised title + platform (+ kind);
//   • a source only fills empty fields or updates the ones it set itself — never a field you edited (own[field] === 'user');
//   • play counts and hours only ever go up (your +1s are kept);
//   • a mirror sync (BGG, PriceCharting, RAWG, Steam) unlinks items the source no longer lists: an item nobody else knows and you
//     never edited is removed, anything else is kept. File imports never remove anything.

export const KINDS = ['video', 'board', 'book', 'vinyl', 'cd', 'movie'];
/** shelves grouped by genre (video games group by platform, board games by type) */
export const MEDIA = ['book', 'vinyl', 'cd', 'movie'];
export const isMusic = (k) => k === 'vinyl' || k === 'cd';

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
// platform families, in shelf order (the table above is newest-first inside each family)
export const FAMILIES = [['playstation', 'PlayStation'], ['nintendo', 'Nintendo'], ['xbox', 'Xbox'], ['pc', 'PC & Mac'], ['sega', 'Sega'], ['retro', 'Retro'], ['mobile', 'Mobile'], ['other', 'Other']];
const FAM_OF = {};
for (const [fam, ids] of Object.entries({ playstation: 'ps5 ps4 ps3 ps2 ps1 psp vita', nintendo: 'switch2 switch wiiu wii gamecube n64 snes nes 3ds ds gba gbc gb', xbox: 'xsx xone x360 xbox',
  pc: 'pc mac', sega: 'genesis dreamcast saturn sms gamegear', retro: '2600 neogeo tg16', mobile: 'android ios' })) for (const id of ids.split(' ')) FAM_OF[id] = fam;
/** 'ps5' → 'playstation'; unknown names → a best guess from the name, else 'other' */
export function platformFamily(id) {
  if (!id) return 'other';
  if (FAM_OF[id]) return FAM_OF[id];
  const s = String(id).toLowerCase();
  return /playstation|\bps\d|psp|vita/.test(s) ? 'playstation' : /nintendo|switch|wii|game ?boy|famicom|virtual boy/.test(s) ? 'nintendo' : /xbox/.test(s) ? 'xbox'
    : /\bpc\b|windows|mac|linux|steam|dos/.test(s) ? 'pc' : /sega|mega|genesis|saturn|dreamcast|32x/.test(s) ? 'sega'
      : /atari|neo ?geo|turbo|pc engine|commodore|amiga|c64|msx|zx|3do|jaguar|intellivision|colecovision|vectrex|wonderswan|lynx/.test(s) ? 'retro' : /android|ios|iphone/.test(s) ? 'mobile' : 'other';
}
export const familyName = (f) => FAMILIES.find((x) => x[0] === f)?.[1] || 'Other';
const P_ORDER = new Map(P.map(([id], i) => [id, i]));
/** sort key: family, then the platform's place in the table (newest first), then its name */
export const platformRank = (id) => [FAMILIES.findIndex((x) => x[0] === platformFamily(id)), P_ORDER.has(id) ? P_ORDER.get(id) : 999];
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

/** the first name of a creator ("Pink Floyd, David Gilmour" → "pink floyd"), for matching */
export const byKey = (by) => normTitle(String(by ?? '').split(/\s*(?:[,;&/]|\band\b|\bfeat\.?)\s*/i)[0]);
/** what tells two copies with the same title apart: the platform (video), the author / artist (books, music) */
export function secondKey(kind, e = {}) {
  if (kind === 'video') return canonPlatform(e.platform);
  if (kind === 'book' || kind === 'vinyl' || kind === 'cd') return byKey(e.by);
  return '';
}
export const itemKey = (kind, title, platform, by) => `${kind}|${normTitle(title)}|${secondKey(kind, { platform, by })}`;
const keyOf = (e) => itemKey(e.kind, e.title, e.platform, e.by);
const titleKey = (kind, title) => `${kind}|${normTitle(title)}`;

// ---------------------------------------------------------------- genres (books, music, movies)
// A compact set per shelf; whatever a service calls it (Discogs genres / styles, Open Library subjects, MusicBrainz tags,
// TMDB genres, a spreadsheet column) is mapped onto it. The first match wins, so the specific ones come first.
const G = (list) => list.map(([name, re]) => [name, new RegExp(re, 'i')]);
const MUSIC_G = G([['Soundtrack', 'soundtrack|stage ?& ?screen|score|musical|film|video game music'], ['Hip hop', 'hip ?hop|rap\\b|trap\\b|grime'], ['Metal', 'metal|thrash|doom|grindcore'],
  ['Punk', 'punk|hardcore|emo\\b'], ['Electronic', 'electro|techno|house|trance|ambient|edm|drum ?n|dubstep|synth|idm|downtempo|disco|dance'], ['Jazz', 'jazz|swing|bebop|bossa'],
  ['Classical', 'classical|baroque|opera|orchestr|symphon|chamber|romantic|brass ?& ?military|choral'], ['Soul & funk', 'soul|funk|r ?& ?b|rhythm and blues|motown|gospel'],
  ['Blues', 'blues'], ['Reggae', 'reggae|dub\\b|ska|dancehall|rocksteady'], ['Latin', 'latin|salsa|samba|tango|reggaeton|cumbia|mpb'],
  ['Folk & country', 'folk|country|americana|bluegrass|singer.?songwriter'], ['World', 'world|afro|african|celtic|middle eastern|mizrahi|klezmer|k-?pop|j-?pop|indian'],
  ['Children', 'child|kids'], ['Spoken word', 'non-music|spoken|comedy|audiobook|poetry'], ['Pop', 'pop|chanson|schlager|eurovision'], ['Rock', 'rock|indie|grunge|shoegaze|new wave|psychedel|prog']]);
const BOOK_G = G([['Comics', 'comic|graphic novel|manga|cartoon'], ['Children', 'juvenile|child|picture book|board book|kids'], ['Young adult', 'young adult|teen'],
  ['Fantasy', 'fantasy|magic|dragons|wizard'], ['Science fiction', 'science fiction|sci-?fi|dystop|space opera|cyberpunk'], ['Horror', 'horror|ghost stor|vampire|zombie'],
  ['Mystery & thriller', 'myster|thriller|crime|detective|suspense|murder|espionage|spy'], ['Romance', 'romance|love stor'], ['Poetry', 'poetry|poems'],
  ['Biography', 'biograph|memoir|autobiograph|diaries'], ['History', 'history|historical|war\\b|world war|ancient'], ['Science & nature', 'science|physics|biology|nature|mathemat|astronom|evolution|ecology|medicine'],
  ['Business', 'business|economic|finance|management|marketing|leadership|entrepreneur'], ['Self-help', 'self-help|self help|personal development|psychology|happiness|success|habits|parenting'],
  ['Cooking', 'cook|recipe|food|baking|wine'], ['Travel', 'travel|guidebook'], ['Art & design', 'art\\b|arts|design|photograph|architecture|music\\b|film'],
  ['Religion & philosophy', 'religion|philosoph|spiritual|theology|bible|judaism|buddh|islam'], ['Classics', 'classic'], ['Fiction', 'fiction|novel|literature|short stor'], ['Non-fiction', 'non-?fiction|essays|politic|social|education|reference']]);
const MOVIE_G = G([['Animation', 'anim|cartoon|anime'], ['Documentary', 'documentar|reality|news'], ['Family', 'family|kids|child'], ['Science fiction', 'science fiction|sci-?fi'],
  ['Fantasy', 'fantasy'], ['Horror', 'horror'], ['Mystery & thriller', 'myster|thriller|suspense'], ['Crime', 'crime|gangster|heist'], ['Action', 'action|martial'], ['Adventure', 'adventure'],
  ['Comedy', 'comed|sitcom|humou?r|talk'], ['Romance', 'romance|romantic'], ['War & history', 'war\\b|history|historical|politics'], ['Western', 'western'], ['Music', 'music|concert|musical'],
  ['Drama', 'drama|soap']]);
const GENRE_SETS = { book: BOOK_G, vinyl: MUSIC_G, cd: MUSIC_G, movie: MOVIE_G };
export const GENRES = Object.fromEntries(Object.entries(GENRE_SETS).map(([k, l]) => [k, l.map(([n]) => n)]));
/** ['Folk, World, & Country', 'Rock'] → ['Folk & country', 'Rock']. keepUnknown keeps names we can't map (your own spreadsheet). */
export function genresOf(kind, raw, { keepUnknown = false, max = 3 } = {}) {
  const set = GENRE_SETS[kind];
  if (!set) return [];
  const out = [];
  for (const r of [].concat(raw || []).flatMap((x) => String(x ?? '').replace(/folk,\s*world,?\s*&\s*country/i, 'Folk & Country').split(/\s*[;|]\s*|\s*,\s*(?![^()]*\))/)).map((x) => x.trim()).filter(Boolean)) {
    const hit = set.find(([, re]) => re.test(r));
    const name = hit ? hit[0] : keepUnknown ? str(r, 24).replace(/^./, (c) => c.toUpperCase()) : '';
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------- board-game types
export const BOARD_TYPES = [['board', 'Board game'], ['card', 'Card game'], ['party', 'Party game'], ['noequip', 'No equipment needed']];
export const BOARD_TRAITS = [['coop', 'Cooperative'], ['strategy', 'Strategy'], ['dice', 'Dice game'], ['dexterity', 'Dexterity'], ['word', 'Word game'], ['trivia', 'Trivia'], ['deduction', 'Deduction'], ['kids', 'Kids']];
export const boardTypeName = (t) => BOARD_TYPES.find((x) => x[0] === t)?.[1] || 'Board game';
const CARD_TITLES = /^(uno|taki|skip-?bo|phase 10|exploding kittens|dobble|spot it|sushi go|love letter|the mind|coup|hanabi|yaniv|munchkin|the game|6 nimmt|no thanks|5 alive|sleeping queens|monopoly deal|bohnanza|race for the galaxy|dominion|star realms|lost cities|the crew)\b/i;
const PARTY_TITLES = /^(codenames|dixit|alias|taboo|pictionary|cards against humanity|apples to apples|just one|wavelength|telestrations|time'?s up|concept|decrypto|werewolf|one night|mysterium|jenga|twister|the resistance|avalon|secret hitler|scattergories|charades|heads up)\b/i;
/** BGG categories / mechanics (+ the title as a hint) → { type, traits } */
export function classifyBoard({ cats = [], mechs = [], title = '' } = {}) {
  const c = new Set([...cats, ...mechs].map((x) => String(x).toLowerCase()));
  const has = (re) => [...c].some((x) => re.test(x));
  const type = has(/^party game$/) ? 'party' : has(/^card game$/) ? 'card' : PARTY_TITLES.test(title) ? 'party' : CARD_TITLES.test(title) ? 'card' : c.size ? 'board' : '';
  const traits = [];
  if (has(/cooperative/)) traits.push('coop');
  if (has(/abstract strategy|wargame|economic|civilization|territory building|area majority|worker placement/)) traits.push('strategy');
  if (has(/^dice$|dice rolling/)) traits.push('dice');
  if (has(/dexterity|action \/ dexterity|flicking|stacking/)) traits.push('dexterity');
  if (has(/word game/)) traits.push('word');
  if (has(/trivia/)) traits.push('trivia');
  if (has(/deduction/)) traits.push('deduction');
  if (has(/children's game/)) traits.push('kids');
  return { type, traits: traits.slice(0, 4) };
}
/** Games you can play with nothing at all (one tap adds them to the board-game shelf as "No equipment needed"). */
export const NO_EQUIP = [
  { id: 'petakiot', title: 'Petakiot (פתקיות)', he: 'פתקיות', players: [4, 20], mins: [30, 60], game: 'petakiot', aka: 'the notes game · Fishbowl',
    blurb: 'Everyone writes names on little notes into a bowl. Teams race the clock: explain freely, then one word only, then act it out.' },
  { id: 'charades', title: 'Charades', he: 'פנטומימה', players: [4, 20], mins: [20, 60], blurb: 'Act out a movie, book or phrase without a sound while your team guesses.' },
  { id: '20q', title: '20 Questions', he: '20 שאלות', players: [2, 10], mins: [10, 30], blurb: 'Think of something; the others get twenty yes-or-no questions to find it.' },
  { id: '2t1l', title: 'Two Truths and a Lie', he: 'שתי אמיתות ושקר', players: [3, 15], mins: [15, 30], blurb: 'Say three things about yourself — the others spot the made-up one.' },
  { id: 'contact', title: 'Contact', he: 'קונטקט', players: [3, 10], mins: [15, 45], blurb: 'One player guards a word letter by letter; the others give clues and shout “contact!” when two of them think of the same word.' },
  { id: 'mafia', title: 'Mafia / Werewolf', he: 'מאפיה', players: [6, 20], mins: [20, 60], traits: ['deduction'], blurb: 'A secret few are the mafia. Night falls, someone is out; by day the town argues and votes. Cards optional — slips of paper work.' },
  { id: 'ghost', title: 'Ghost (word game)', he: 'גוסט', players: [2, 8], mins: [10, 30], traits: ['word'], blurb: 'Take turns adding a letter; whoever completes a real word — or can’t continue one — gets a letter of G-H-O-S-T.' },
  { id: 'ispy', title: 'I Spy', he: 'אני רואה משהו', players: [2, 10], mins: [5, 20], traits: ['kids'], blurb: '“I spy with my little eye something beginning with…” — the others look around and guess.' },
  { id: 'wyr', title: 'Would You Rather', he: 'מה היית מעדיף', players: [2, 20], mins: [10, 30], blurb: 'Pick between two impossible choices — and defend your answer.' },
  { id: 'telephone', title: 'Telephone', he: 'טלפון שבור', players: [5, 30], mins: [5, 15], traits: ['kids'], blurb: 'Whisper a sentence down the line; the last one says it out loud. It never survives.' },
  { id: 'whoami', title: 'Who Am I? (Celebrity Heads)', he: 'מי אני?', players: [3, 12], mins: [15, 30], blurb: 'A name is stuck on your forehead; ask yes-or-no questions until you know who you are.' },
];

// ---------------------------------------------------------------- formats and grades
export const FORMATS = {
  book: [['hardcover', 'Hardcover'], ['paperback', 'Paperback'], ['massmarket', 'Mass-market paperback'], ['boardbook', 'Board book'], ['comic', 'Comic / graphic novel'], ['ebook', 'Ebook'], ['audio', 'Audiobook']],
  vinyl: [['lp', 'LP'], ['2lp', '2LP'], ['3lp', '3LP+'], ['ep', 'EP'], ['7', '7″ single'], ['10', '10″'], ['12', '12″ single'], ['box', 'Box set']],
  cd: [['cd', 'CD'], ['2cd', '2CD+'], ['sacd', 'SACD'], ['single', 'CD single'], ['box', 'Box set'], ['cassette', 'Cassette']],
  movie: [['dvd', 'DVD'], ['bluray', 'Blu-ray'], ['uhd', '4K UHD Blu-ray'], ['bluray3d', 'Blu-ray 3D'], ['vhs', 'VHS'], ['laserdisc', 'LaserDisc']],
};
export const formatName = (kind, f) => (FORMATS[kind] || []).find((x) => x[0] === f)?.[1] || f || '';
/** Goldmine grades (records; also used for CDs) */
export const GRADES = [['M', 'Mint'], ['NM', 'Near Mint'], ['VG+', 'Very Good Plus'], ['VG', 'Very Good'], ['G+', 'Good Plus'], ['G', 'Good'], ['F', 'Fair'], ['P', 'Poor']];
export const SLEEVE_EXTRA = [['Generic', 'Generic sleeve'], ['No cover', 'No cover']];
/** "Near Mint (NM or M-)" / "VG+" / "very good plus" → 'NM' / 'VG+' */
export function gradeOf(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const p = /\(([^)]*)\)/.exec(s)?.[1] || s;
  const t = p.toUpperCase().replace(/\s+/g, ' ');
  for (const g of ['VG+', 'G+', 'NM', 'VG', 'M-', 'M', 'G', 'F', 'P']) if (t === g || t.startsWith(g + ' ')) return g === 'M-' ? 'NM' : g;
  const l = s.toLowerCase();
  if (/generic/.test(l)) return 'Generic';
  if (/no cover/.test(l)) return 'No cover';
  if (/near mint/.test(l)) return 'NM';
  if (/very good plus|very good \+/.test(l)) return 'VG+';
  if (/very good/.test(l)) return 'VG';
  if (/good plus/.test(l)) return 'G+';
  if (/mint/.test(l)) return 'M';
  if (/good/.test(l)) return 'G';
  if (/fair/.test(l)) return 'F';
  if (/poor/.test(l)) return 'P';
  return '';
}
/** Discogs-style format text ("2xLP, Album, RE, Red" / "CD, Album" / "7\", Single, 45 RPM") → { kind, format, discs, rpm, variant } */
export function musicFormat(text, { name = '', qty = 0, descriptions = [], extra = '' } = {}) {
  const all = [name, text, ...descriptions, extra].filter(Boolean).join(', ');
  const s = all.toLowerCase();
  const n = Math.max(+qty || 0, +(/(\d+)\s*x\s*(lp|cd|vinyl|12|7|10)/i.exec(all)?.[1] || 0), +(/(\d+)\s*(lp|cd)s?\b/i.exec(all)?.[1] || 0)) || 1;
  const vinyl = /vinyl|\blp\b|\d\s*x\s*lp|\b(7|10|12)("|″|''|\s*inch)|\b(33|45|78)\s*(⅓|1\/3)?\s*rpm|flexi|lathe|\bep\b/.test(s) && !/\bcd\b|cassette/.test(s.replace(/cd-?r?\s*\+/, ''));
  const rpm = /\b78\s*rpm/.test(s) ? 78 : /\b45\s*rpm/.test(s) ? 45 : /\b33/.test(s) ? 33 : null;
  let format;
  if (vinyl) format = /box set/.test(s) ? 'box' : /\b7("|″|''|\s*inch)/.test(s) ? '7' : /\b10("|″|''|\s*inch)/.test(s) ? '10' : /\b12("|″|''|\s*inch)/.test(s) && /single|maxi|\b45\b/.test(s) && !/\blp\b/.test(s) ? '12' : /\bep\b/.test(s) && !/\blp\b/.test(s) ? 'ep' : n >= 3 ? '3lp' : n === 2 ? '2lp' : 'lp';
  else format = /cassette/.test(s) ? 'cassette' : /box set/.test(s) ? 'box' : /sacd/.test(s) ? 'sacd' : /single|maxi/.test(s) && !/album/.test(s) ? 'single' : n >= 2 ? '2cd' : 'cd';
  // the colour / edition words ("Red Translucent", "180 Gram", "Limited Edition")
  const parts = [extra, ...descriptions, ...String(text || '').split(/\s*,\s*/)].map((x) => String(x || '').trim()).filter(Boolean);
  const variant = [...new Set(parts.filter((x) => /colou?r|\bred\b|blue|green|yellow|white|clear|splatter|marble|translucent|gold|silver|pink|purple|orange|gram|\b180\b|picture|limited|numbered|deluxe/i.test(x) && !/^(lp|album|reissue|re|remastered|stereo|mono)$/i.test(x)))].join(', ');
  return { kind: vinyl ? 'vinyl' : 'cd', format, discs: n > 1 ? n : null, rpm: vinyl ? rpm || (format === '7' ? 45 : 33) : null, variant: str(variant, 80) };
}
/** "Blu-ray" / "4K Ultra HD" / "DVD" / "Steelbook" → { format, steelbook } */
export function movieFormat(v) {
  const s = String(v ?? '').toLowerCase();
  return { format: /4k|uhd|ultra hd/.test(s) ? 'uhd' : /3d/.test(s) && /blu/.test(s) ? 'bluray3d' : /blu-?ray|\bbd\b/.test(s) ? 'bluray' : /vhs/.test(s) ? 'vhs' : /laser ?disc/.test(s) ? 'laserdisc' : /dvd/.test(s) ? 'dvd' : '',
    steelbook: /steel ?book/.test(s) };
}
export function bookFormat(v) {
  const s = String(v ?? '').toLowerCase();
  return /hard ?(cover|back)|hardbound|library binding/.test(s) ? 'hardcover' : /mass.?market/.test(s) ? 'massmarket' : /board ?book/.test(s) ? 'boardbook' : /paper ?back|soft ?cover|trade/.test(s) ? 'paperback'
    : /comic|graphic/.test(s) ? 'comic' : /kindle|ebook|e-book|epub|digital/.test(s) ? 'ebook' : /audio/.test(s) ? 'audio' : '';
}
/** ISBN-10 / ISBN-13 / an EAN starting 978·979 → the 13-digit ISBN ('' when it isn't one) */
export function isbnOf(v) {
  const s = String(v ?? '').replace(/^="?|"$/g, '').replace(/[^\dXx]/g, '').toUpperCase();
  if (/^97[89]\d{10}$/.test(s)) return s;
  if (/^\d{9}[\dX]$/.test(s)) {
    const b = '978' + s.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += +b[i] * (i % 2 ? 3 : 1);
    return b + ((10 - (sum % 10)) % 10);
  }
  return '';
}

// ---------------------------------------------------------------- service answers → entries
/** Discogs' own genres first (Rock, Jazz, Funk / Soul…); its styles only when the genres don't map */
const discogsGenres = (genres, styles) => { const g = genresOf('vinyl', genres || []); return g.length ? g : genresOf('vinyl', styles || []); };
const cleanArtist = (s) => String(s || '').replace(/\s*\(\d+\)$/, '').replace(/\*$/, '').trim();
/** Discogs collection release ({ id, instance_id, rating, date_added, basic_information, notes }) → a vinyl / CD entry */
export function discogsEntry(r) {
  const b = r?.basic_information || r || {};
  if (!b.title) return null;
  const fmts = b.formats || [];
  const main = fmts.find((f) => /vinyl|cd|sacd|cassette|box set|lathe|flexi/i.test(f.name)) || fmts[0] || {};
  const box = fmts.some((f) => /box set/i.test(f.name));
  const mf = musicFormat('', { name: main.name || '', qty: main.qty, descriptions: [...(main.descriptions || []), box ? 'Box Set' : ''].filter(Boolean), extra: main.text || '' });
  const notes = Array.isArray(r.notes) ? r.notes : [];
  const nf = (id) => str(notes.find((x) => +x.field_id === id)?.value || '');
  const artists = (b.artists || []).map((a, i, l) => cleanArtist(a.anv || a.name) + (i < l.length - 1 ? (a.join && a.join !== ',' ? ` ${a.join} ` : ', ') : '')).join('');
  return {
    sid: String(r.instance_id || r.id || b.id), discogsId: String(b.id || r.id || ''), kind: mf.kind, title: b.title, by: artists.replace(/\s+/g, ' ').trim(), year: +b.year || null,
    art: b.cover_image || b.thumb || '', label: cleanArtist(b.labels?.[0]?.name || ''), catno: str(b.labels?.[0]?.catno || '').replace(/^none$/i, ''),
    format: mf.format, discs: mf.discs, rpm: mf.rpm, variant: mf.variant, genres: discogsGenres(b.genres, b.styles), styles: (b.styles || []).slice(0, 4),
    rating: r.rating ? r.rating * 2 : null, grade: gradeOf(nf(1)), sleeve: gradeOf(nf(2)), notes: nf(3), added: dateMs(r.date_added),
  };
}
/** Discogs database search result ({ id, title: 'Artist - Title', year, format, label, catno, genre, style, cover_image, barcode }) → entry */
export function discogsSearchEntry(x) {
  if (!x?.title) return null;
  const [artist, ...rest] = String(x.title).split(' - ');
  const mf = musicFormat((x.format || []).join(', '));
  return { kind: mf.kind, title: rest.join(' - ') || artist, by: rest.length ? cleanArtist(artist) : '', year: +x.year || null, art: x.cover_image || x.thumb || '', label: (x.label || [])[0] || '',
    catno: x.catno || '', format: mf.format, discs: mf.discs, rpm: mf.rpm, genres: discogsGenres(x.genre, x.style), country: x.country || '', discogsId: String(x.id || ''), sid: String(x.id || '') };
}
export const olCover = (id, size = 'L') => (id ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : '');
/** Open Library edition JSON (/isbn/….json) [+ author names, + its work] → a book entry */
export function olEdition(ed, { authors = [], work = null } = {}) {
  if (!ed?.title) return null;
  const isbn = isbnOf((ed.isbn_13 || [])[0] || (ed.isbn_10 || [])[0] || '');
  const subjects = [...(ed.subjects || []), ...(work?.subjects || [])].map((s) => (typeof s === 'string' ? s : s?.name || ''));
  return { kind: 'book', title: ed.subtitle && ed.title.length < 40 ? `${ed.title}: ${ed.subtitle}` : ed.title, by: authors.slice(0, 3).join(', '), isbn, publisher: (ed.publishers || [])[0] || '',
    pages: +ed.number_of_pages || null, format: bookFormat(ed.physical_format), year: yearOf(ed.publish_date), art: olCover((ed.covers || []).find((c) => c > 0)) || (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : ''),
    genres: genresOf('book', subjects), olid: String(ed.key || '').replace(/^\/books\//, ''), sid: isbn || String(ed.key || '') };
}
/** Open Library search.json doc → a book entry */
export function olDoc(d) {
  if (!d?.title) return null;
  const isbn = isbnOf((d.isbn || []).find((x) => /^97[89]/.test(x)) || (d.isbn || [])[0] || '');
  return { kind: 'book', title: d.title, by: (d.author_name || []).slice(0, 2).join(', '), year: +d.first_publish_year || null, art: olCover(d.cover_i), pages: +d.number_of_pages_median || null,
    isbn, publisher: (d.publisher || [])[0] || '', genres: genresOf('book', (d.subject || []).slice(0, 30)), olid: String(d.key || '').replace(/^\/works\//, ''), sid: String(d.key || '') };
}
const mbCredit = (ac) => (ac || []).map((a) => (a.name || a.artist?.name || '') + (a.joinphrase || '')).join('').trim();
/** MusicBrainz release-group (search) → an album entry (kind: what you're adding — vinyl or cd) */
export function mbReleaseGroup(g, kind = 'vinyl') {
  if (!g?.title) return null;
  const tags = (g.tags || []).sort((a, b) => (b.count || 0) - (a.count || 0)).map((t) => t.name);
  return { kind: kind === 'cd' ? 'cd' : 'vinyl', title: g.title, by: mbCredit(g['artist-credit']), year: yearOf(g['first-release-date']), mbid: g.id, sid: g.id,
    art: `https://coverartarchive.org/release-group/${g.id}/front-250`, genres: genresOf('vinyl', [...(g.genres || []).map((x) => x.name), ...tags]), albumType: g['primary-type'] || '' };
}
/** MusicBrainz release (barcode search) → entry with its real format */
export function mbRelease(r) {
  if (!r?.title) return null;
  const media = (r.media || []).map((m) => m.format || '').join(', ');
  const mf = musicFormat(media, { qty: (r.media || []).length });
  const li = (r['label-info'] || [])[0] || {};
  return { kind: mf.kind, title: r.title, by: mbCredit(r['artist-credit']), year: yearOf(r.date), format: mf.format, discs: mf.discs, rpm: mf.rpm, label: li.label?.name || '', catno: li['catalog-number'] || '',
    country: r.country || '', mbid: r['release-group']?.id || r.id, sid: r.id, upc: r.barcode || '', art: r['release-group']?.id ? `https://coverartarchive.org/release-group/${r['release-group'].id}/front-250` : `https://coverartarchive.org/release/${r.id}/front-250` };
}
// TMDB's genre ids (movie + TV), used when /genre/…/list isn't reachable
export const TMDB_GENRES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror',
  10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids',
  10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics' };
/** TMDB search result (movie or tv) → a DVD / Blu-ray entry (format chosen when you add it) */
export function tmdbEntry(x, type = 'movie', names = TMDB_GENRES, img = 'https://image.tmdb.org/t/p/w500') {
  const title = x?.title || x?.name;
  if (!title) return null;
  return { kind: 'movie', title, year: yearOf(x.release_date || x.first_air_date), art: x.poster_path ? `${img}${x.poster_path}` : '', tmdbId: String(x.id), tmdbType: type === 'tv' ? 'tv' : 'movie',
    genres: genresOf('movie', (x.genre_ids || []).map((id) => names[id] || TMDB_GENRES[id]).filter(Boolean).concat((x.genres || []).map((g) => g.name))), sid: `${type}:${x.id}`,
    runtime: +x.runtime || (x.episode_run_time || [])[0] || null, notes: '' };
}

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
  { id: 'discogscsv', name: 'Discogs CSV', kind: 'vinyl', ext: 'csv', hint: 'discogs.com → Collection → Export (CSV) — vinyl and CDs',
    detect: (k) => (k.has('releaseid') && k.has('artist') && (k.has('catalog') || k.has('collectionmediacondition')) ? 10 : 0), rows: (r, h) => mediaRows(r, h, 'discogscsv') },
  { id: 'goodreads', name: 'Goodreads', kind: 'book', ext: 'csv', hint: 'goodreads.com → My Books → Import and export → Export library (CSV)',
    detect: (k) => (k.has('bookid') && k.has('exclusiveshelf') ? 10 : 0), rows: (r, h) => mediaRows(r, h, 'goodreads') },
  { id: 'clzbooks', name: 'CLZ Books', kind: 'book', ext: 'csv', hint: 'CLZ Books → Export to CSV (Title, Author, ISBN… columns)',
    detect: (k) => (k.has('title') && k.has('author') && ['isbn', 'publisher', 'noofpages', 'pages', 'readit', 'publicationdate', 'format'].filter((x) => k.has(x)).length >= 1 ? 8 : 0), rows: (r, h) => mediaRows(r, h, 'clzbooks') },
  { id: 'clzmusic', name: 'CLZ Music', kind: 'vinyl', ext: 'csv', hint: 'CLZ Music → Export to CSV (Artist, Title, Format… columns)',
    detect: (k) => (k.has('title') && k.has('artist') && ['catno', 'label', 'format', 'barcode', 'noofdiscs', 'mediacondition', 'vinylrpm', 'vinylcolor'].filter((x) => k.has(x)).length >= 1 ? 8 : 0), rows: (r, h) => mediaRows(r, h, 'clzmusic') },
  { id: 'clzmovies', name: 'CLZ Movies', kind: 'movie', ext: 'csv', hint: 'CLZ Movies → Export to CSV (Title, Format, Director… columns)',
    detect: (k) => (k.has('title') && !k.has('platform') && ['director', 'runtime', 'region', 'imdbnumber', 'imdburl', 'studio', 'distributor', 'audiencerating'].filter((x) => k.has(x)).length >= 1 ? 8 : 0), rows: (r, h) => mediaRows(r, h, 'clzmovies') },
  { id: 'generic', name: 'Other spreadsheet', kind: null, ext: 'csv', hint: 'Any CSV — pick the Title / Platform / Artist or author / Players columns', detect: () => 1, rows: genericRows },
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
      age: int(g(r, I.age)) || null, upc: g(r, I.bar), type: exp ? '' : classifyBoard({ title }).type,
    }));
  }
  return { items, wishes, skipped };
}
/** "1:56" / "116 min" / "1h 56m" / "116" → minutes */
export function runtimeOf(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = /^(\d+):(\d\d)(?::\d\d)?$/.exec(s);
  if (m) return +m[1] * 60 + +m[2];
  m = /(\d+)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m)?/i.exec(s);
  if (m) return +m[1] * 60 + (+m[2] || 0);
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 && n < 2000 ? n : null;
}
// column names per field (any of them; matched without case, spaces or punctuation)
const COLS = {
  title: ['Title', 'Name', 'Album', 'Album Title', 'Movie Title', 'Book Title'],
  artist: ['Artist', 'Artists', 'Album Artist', 'Performer'], author: ['Author', 'Authors', 'Author l-f', 'Writer'], director: ['Director', 'Directors'],
  year: ['Year Published', 'Original Publication Year', 'Released', 'Release Year', 'Release Date', 'Original Release Date', 'Movie Release Year', 'Publication Date', 'Year'],
  label: ['Label', 'Record Label', 'Labels'], catno: ['Catalog#', 'Cat. No.', 'Catalog Number', 'Cat No', 'Catno', 'Catalogue Number'],
  format: ['Format', 'Binding', 'Media', 'Media Type'], packaging: ['Packaging', 'Edition'], genre: ['Genre', 'Genres', 'Style', 'Styles', 'Subject', 'Subjects'],
  isbn: ['ISBN13', 'ISBN 13', 'ISBN-13', 'ISBN', 'EAN'], publisher: ['Publisher', 'Studio'], pages: ['Number of Pages', 'No. of Pages', 'Pages', 'Page Count'],
  grade: ['Collection Media Condition', 'Media Condition', 'Condition'], sleeve: ['Collection Sleeve Condition', 'Package / Sleeve Condition', 'Sleeve Condition', 'Package Condition'],
  notes: ['Collection Notes', 'Notes', 'Private Notes', 'Personal Notes', 'My Review'], rating: ['My Rating', 'Rating'], added: ['Date Added', 'Added Date', 'Added'],
  barcode: ['Barcode', 'UPC'], runtime: ['Runtime', 'Running Time', 'Length'], region: ['Region'], edition: ['Edition'], status: ['Collection Status', 'Status', 'Exclusive Shelf'],
  readIt: ['Read It', 'Read'], owned: ['Owned Copies'], qty: ['Quantity', 'Qty', 'Copies'], loan: ['Loaned To', 'Loaned'], paid: ['Purchase Price', 'Price Paid'],
  value: ['Current Value', 'Value', 'My Value'], rpm: ['Vinyl RPM', 'RPM'], vcolor: ['Vinyl Color', 'Vinyl Colour'], discs: ['No. of Discs', 'Discs'], country: ['Country'],
  id: ['release_id', 'Book Id', 'Index', 'ID'], tags: ['Tags', 'Bookshelves'],
};
/** Discogs CSV, Goodreads, CLZ Books / Music / Movies (and the generic media mapper) → entries */
function mediaRows(rows, headers, preset) {
  const c = finder(headers);
  const I = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, c(names)]));
  const g = (r, i) => (i >= 0 ? str(r[i]) : '');
  const kindOf = { goodreads: 'book', clzbooks: 'book', clzmovies: 'movie' }[preset] || null;
  const byCol = kindOf === 'book' ? I.author : kindOf === 'movie' ? I.director : I.artist;
  const owned = preset === 'goodreads' && I.owned >= 0 && rows.some((r) => +g(r, I.owned) > 0);
  const items = [], wishes = []; let skipped = 0;
  for (const r of rows) {
    const title = g(r, I.title);
    if (!title) { skipped++; continue; }
    const by = (preset === 'discogscsv' ? cleanArtist(g(r, byCol)) : g(r, byCol)).replace(/^(.+?),\s*(.+)$/, (m, a, b) => (I.author >= 0 && byCol === c('Author l-f') ? `${b} ${a}` : m));
    const status = g(r, I.status).toLowerCase();
    const fmtText = [g(r, I.format), g(r, I.packaging)].filter(Boolean).join(', ');
    let kind = kindOf;
    let extra = {};
    if (!kind) { const mf = musicFormat(fmtText, { extra: g(r, I.vcolor) }); kind = mf.kind; extra = { format: mf.format, discs: int(g(r, I.discs)) || mf.discs, rpm: int(g(r, I.rpm)) || mf.rpm, variant: [g(r, I.vcolor), mf.variant].filter(Boolean).filter((x, i, l) => l.indexOf(x) === i).join(', ') }; }
    else if (kind === 'book') extra = { format: bookFormat(fmtText), isbn: isbnOf(g(r, I.isbn)) || isbnOf(g(r, I.barcode)), pages: int(g(r, I.pages)), publisher: g(r, I.publisher) };
    else { const mf = movieFormat(fmtText); extra = { format: mf.format, steelbook: mf.steelbook || null, runtime: runtimeOf(g(r, I.runtime)), region: g(r, I.region), edition: g(r, I.edition) }; }
    // Goodreads: your shelves — "to-read" goes to Wish Lists (when you own nothing, everything else is your shelf)
    if (preset === 'goodreads') {
      const has = +g(r, I.owned) > 0;
      if (owned ? !has : status === 'to-read') { if (status === 'to-read' || !owned) wishes.push({ kind: 'book', title, by, note: 'From Goodreads', source: 'goodreads' }); else skipped++; continue; }
    } else if (/wish|on order/.test(status)) {
      if (kind === 'book' || kind === 'movie') wishes.push({ kind, title, by, note: preset === 'clzmovies' ? 'From CLZ Movies' : 'From CLZ', source: preset }); else skipped++;
      continue;
    } else if (status && /^(sold|not in collection)$/.test(status)) { skipped++; continue; }
    const rate = num(g(r, I.rating));
    const read = preset === 'goodreads' ? ({ read: 'read', 'currently-reading': 'reading', 'to-read': 'want' })[status] || '' : I.readIt >= 0 ? (truthy(g(r, I.readIt)) ? 'read' : '') : '';
    const loan = g(r, I.loan);
    items.push(entry({
      sid: g(r, I.id) || `${normTitle(title)}|${byKey(by)}|${extra.format || ''}`, kind, title, by, year: yearOf(g(r, I.year)), genres: genresOf(kind, g(r, I.genre), { keepUnknown: true }),
      label: kind === 'vinyl' || kind === 'cd' ? g(r, I.label) : '', catno: g(r, I.catno), grade: gradeOf(g(r, I.grade)), sleeve: gradeOf(g(r, I.sleeve)), country: g(r, I.country),
      notes: g(r, I.notes), rating: rate ? (rate <= 5 ? rate * 2 : Math.min(10, rate)) : null, added: dateMs(g(r, I.added)), upc: g(r, I.barcode).replace(/\D/g, ''), read,
      qty: int(g(r, I.qty)) || (preset === 'goodreads' ? int(g(r, I.owned)) : null) || 1, paid: money(g(r, I.paid)), value: money(g(r, I.value)),
      tags: preset === 'goodreads' ? splitTags(g(r, I.tags)).filter((t) => !/^(read|to-read|currently-reading)$/.test(t)) : splitTags(g(r, I.tags)),
      lent: loan ? { name: loan, at: null } : null, ...extra,
    }));
  }
  return { items, wishes, skipped };
}
/** map = { title, platform, players, time, by, genre, format, year, kind: one of KINDS, notes } (column indexes; -1 = none) */
export function guessMap(headers, kind = null) {
  const c = finder(headers);
  const title = c(['Title', 'Name', 'Game', 'Game Title', 'Game Name', 'objectname', 'Album', 'Movie', 'Book', 'שם', 'כותר']);
  const platform = c(['Platform', 'System', 'Console', 'Platforms', 'פלטפורמה']);
  const players = c(['Players', 'Number of players', 'Player Count', 'Min Players', 'minplayers', 'שחקנים']);
  const time = c(['Time', 'Play Time', 'Playing Time', 'Playtime', 'Duration', 'Minutes', 'זמן']);
  const notes = c(['Notes', 'Note', 'Comment', 'Comments', 'הערות']);
  const by = c(['Artist', 'Author', 'Director', 'Artists', 'Authors', 'Creator', 'By', 'אמן', 'סופר', 'מחבר']);
  const genre = c(['Genre', 'Genres', 'Category', 'Style', 'ז\'אנר']);
  const format = c(['Format', 'Media', 'Binding', 'פורמט']);
  const year = c(['Year', 'Released', 'Release Year', 'Release Date', 'שנה']);
  const isbn = c(['ISBN', 'ISBN13']);
  const guess = kind || (isbn >= 0 ? 'book' : players >= 0 && platform < 0 ? 'board' : by >= 0 && platform < 0 ? (/vinyl|lp|record/i.test(headers.join(' ')) ? 'vinyl' : 'cd') : 'video');
  return { title: title >= 0 ? title : 0, platform, players, time, notes, by, genre, format, year, kind: guess };
}
function genericRows(rows, headers, map) {
  const m = { ...guessMap(headers), ...(map || {}) };
  const g = (r, i) => (i >= 0 && i != null ? str(r[i]) : '');
  const items = []; let skipped = 0;
  const kind = KINDS.includes(m.kind) ? m.kind : 'video';
  for (const r of rows) {
    const title = g(r, m.title);
    if (!title) { skipped++; continue; }
    const platform = kind === 'video' ? canonPlatform(g(r, m.platform)) : '';
    const by = kind === 'video' || kind === 'board' ? '' : g(r, m.by);
    const f = g(r, m.format);
    const fmt = isMusic(kind) ? musicFormat(f) : kind === 'movie' ? movieFormat(f) : kind === 'book' ? { format: bookFormat(f) } : {};
    items.push(entry({ sid: `${platform}|${normTitle(title)}|${byKey(by)}`, kind: isMusic(kind) && f ? fmt.kind : kind, title, platform, by, players: kind === 'board' ? range(g(r, m.players)) : null,
      mins: kind === 'board' ? range(g(r, m.time), 0) : null, notes: g(r, m.notes), genres: genresOf(kind, g(r, m.genre), { keepUnknown: true }), year: yearOf(g(r, m.year)),
      format: fmt.format || '', rpm: fmt.rpm || null, discs: fmt.discs || null, steelbook: fmt.steelbook || null, isbn: kind === 'book' ? isbnOf(g(r, m.isbn)) : '' }));
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
      baseIds: base?.bggId ? [String(base.bggId)] : [], rating: num(g.rating) || null, type: exp ? '' : classifyBoard({ title }).type,
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
  if (!KINDS.includes(o.kind)) o.kind = 'video';
  if (o.kind === 'video' && o.platform) o.platform = canonPlatform(o.platform);
  if (o.kind !== 'video') delete o.platform;
  if (o.genres) o.genres = [...new Set([].concat(o.genres).map((g) => str(g, 24)).filter(Boolean))].slice(0, 4);
  if (o.kind !== 'board') { delete o.type; delete o.traits; }
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
      const items = arr.map((x) => (x && (x.title || x.name) ? entry({ sid: '', kind: KINDS.includes(x.kind) ? x.kind : 'video', title: x.title || x.name, platform: x.platform, by: x.by || x.artist || x.author || '', year: x.year, notes: x.notes }) : null)).filter(Boolean);
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
    const k = it.sid || keyOf(it);
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
  'plays', 'lastPlayed', 'hours', 'beaten', 'completion', 'notes', 'tags', 'lent', 'value', 'paid', 'by', 'upc', 'platforms', 'appid', 'psnId', 'rawgId',
  'genres', 'styles', 'type', 'traits', 'isbn', 'publisher', 'pages', 'read', 'format', 'variant', 'rpm', 'discs', 'label', 'catno', 'grade', 'sleeve', 'country', 'region', 'runtime',
  'steelbook', 'discogsId', 'olid', 'mbid', 'tmdbId', 'tmdbType', 'game'];
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
  const bySid = new Map(), byBgg = new Map(), byKeyMap = new Map(), byTitle = new Map(), byDisc = new Map();
  const index = (it) => {
    const sid = it.sources?.[src];
    if (sid != null && sid !== true) bySid.set(String(sid), it.id);
    if (it.bggId) byBgg.set(String(it.bggId), it.id);
    if (it.discogsId) byDisc.set(`${it.kind}|${it.discogsId}`, it.id);
    byKeyMap.set(keyOf(it), it.id);
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
    let id = (sid && bySid.get(sid)) || (e.kind === 'board' && e.bggId && byBgg.get(String(e.bggId))) || byKeyMap.get(keyOf(e)) || (e.discogsId && byDisc.get(`${e.kind}|${e.discogsId}`)) || null;
    if (!id) {
      // no platform (author, artist) on one side: the only copy with that title
      const sk = secondKey(e.kind, e);
      const cands = (byTitle.get(titleKey(e.kind, e.title)) || []).filter((x) => items[x] && (!sk || !secondKey(e.kind, items[x])) && !touched.has(x));
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
  discogs: { name: 'Discogs', short: 'Discogs', color: '#ff5a3c' },
  discogscsv: { name: 'Discogs export', short: 'Discogs CSV', color: '#ff7a5c' },
  goodreads: { name: 'Goodreads', short: 'Goodreads', color: '#b7905c' },
  clzbooks: { name: 'CLZ Books', short: 'CLZ', color: '#e11d48' },
  clzmusic: { name: 'CLZ Music', short: 'CLZ', color: '#e11d48' },
  clzmovies: { name: 'CLZ Movies', short: 'CLZ', color: '#e11d48' },
  openlibrary: { name: 'Open Library', short: 'Open Library', color: '#3b82f6' },
  musicbrainz: { name: 'MusicBrainz', short: 'MusicBrainz', color: '#ba478f' },
  tmdb: { name: 'TMDB', short: 'TMDB', color: '#01b4e4' },
  classics: { name: 'No-equipment classics', short: 'Classic', color: '#22c55e' },
  manual: { name: 'Added by hand', short: 'By hand', color: '#94a3b8' },
};
export const sourceName = (s) => SOURCES[s]?.name || (s ? String(s)[0].toUpperCase() + String(s).slice(1) : '');
