// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Fill the Blank (games/blanks.js): a party card game played from phones. The round display deals the cards, runs
// the rounds and keeps the scores; each phone holds its own hand (the bridge sends every phone only its own hand —
// see personalize). Rooms, relay and the phone page shell come from lib/party.js (GET /blanks?r=<room>, /api/blanks/…).
// On top of those this file keeps the packs everyone shares, in bridge/blanks.json ("blanks": { "file": … }):
//   GET    /api/blanks/packs                   { house: { prompts, answers }, packs: [{ id, name, lang, prompts, answers, by, at }] }
//   GET    /api/blanks/pack?id=house|<id>[&adult=1]   one pack in full { name, lang, prompts: [{ text, pick }], answers: [text] }
//   POST   /api/blanks/packs  { pack } | { url }        import a JSON pack (a phone upload, or fetched from a public URL)
//   DELETE /api/blanks/packs?id=<id>&key=<room key>     remove an imported pack (the display only)
//   POST   /api/blanks/house  { kind: 'prompt'|'answer', text, lang, adult, by }   add a card to the house pack
//   DELETE /api/blanks/house?id=<id>&key=<room key>     remove a house card (the display only)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { partyApp, phonePage, HttpErr, str } from './party.js';
import { isPrivateHost, log } from './util.js';

const TYPES = new Set(['join', 'play', 'swap', 'next', 'pick', 'vote', 'go', 'leave', 'added']);
const MAX_PACKS = 40, MAX_PROMPTS = 3000, MAX_ANSWERS = 10000, MAX_HOUSE = 5000, MAX_TEXT = 240;
const MAX_PLAYERS = 20;

// ---------------------------------------------------------------- the packs file
let db = null, file = null;
function load(cfg, dir) {
  if (db) return;
  file = path.resolve(dir, cfg.blanks?.file || 'blanks.json');
  db = { version: 1, house: { prompts: [], answers: [] }, packs: [] };
  try {
    if (fs.existsSync(file)) {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (d && typeof d === 'object') db = { version: 1, house: { prompts: d.house?.prompts || [], answers: d.house?.answers || [] }, packs: Array.isArray(d.packs) ? d.packs : [] };
      log('blanks', `${db.packs.length} packs, ${db.house.prompts.length + db.house.answers.length} house cards from ${file}`);
    }
  } catch (e) { log('blanks', `could not read ${file}: ${e.message} — starting fresh (the old file is kept as .bad)`); try { fs.copyFileSync(file, file + '.bad'); } catch {} }
}
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, file); } catch (e) { log('blanks', 'save failed:', e.message); }
  }, 200);
}
const newId = (p) => p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const hasHe = (s) => /[֐-׿]/.test(s);
// "_" runs of any length (and the odd "{blank}") become our "___"
const blanks = (t) => (t.match(/_{3}/g) || []).length;
const normText = (t) => str(t, MAX_TEXT).replace(/\{\s*blank\s*\}/gi, '___').replace(/_+/g, '___').replace(/\s+/g, ' ');

/** Accept a JSON pack in our format ({ name, lang, prompts: [{ text, pick }], answers: [text] }) or close cousins of it. */
export function normalizePack(raw) {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { throw new HttpErr(400, 'That file isn’t JSON'); } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpErr(400, 'That isn’t a card pack');
  const P = [raw.prompts, raw.black, raw.blackCards, raw.calls, raw.questions].find(Array.isArray) || [];
  const A = [raw.answers, raw.white, raw.whiteCards, raw.responses].find(Array.isArray) || [];
  const seenP = new Set(), seenA = new Set();
  const prompts = [];
  for (const x of P.slice(0, MAX_PROMPTS * 2)) {
    const tx = typeof x === 'string' ? x : Array.isArray(x?.text) ? x.text.join('___') : x?.text ?? x?.t ?? '';
    const text = normText(tx);
    if (!text || seenP.has(text)) continue;
    seenP.add(text);
    const pick = Math.max(1, Math.min(3, Math.round(+x?.pick || blanks(text) || 1)));
    prompts.push({ text, pick });
    if (prompts.length >= MAX_PROMPTS) break;
  }
  const answers = [];
  for (const x of A.slice(0, MAX_ANSWERS * 2)) {
    const text = str(typeof x === 'string' ? x : x?.text ?? x?.t ?? '', MAX_TEXT).replace(/\s+/g, ' ');
    if (!text || seenA.has(text)) continue;
    seenA.add(text); answers.push(text);
    if (answers.length >= MAX_ANSWERS) break;
  }
  if (!prompts.length && !answers.length) throw new HttpErr(400, 'No cards found — a pack needs "prompts" and/or "answers"');
  const sample = [...prompts.slice(0, 20).map((p) => p.text), ...answers.slice(0, 20)].join(' ');
  const lang = /^(he|iw)/i.test(String(raw.lang || '')) || (!raw.lang && hasHe(sample)) ? 'he' : String(raw.lang || 'en').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 5) || 'en';
  return { name: str(raw.name || raw.title || 'Imported pack', 60) || 'Imported pack', lang, adult: !!(raw.adult || raw.nsfw), prompts, answers };
}

async function fetchPack(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { throw new HttpErr(400, 'That isn’t a web address'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpErr(400, 'Only http(s) links work');
  if (isPrivateHost(u.hostname)) throw new HttpErr(400, 'Use a public link (or upload the file instead)');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(u, { redirect: 'follow', signal: ctl.signal, headers: { Accept: 'application/json,text/plain,*/*' } });
    if (!r.ok) throw new HttpErr(400, `The link answered ${r.status}`);
    if (+r.headers.get('content-length') > 3e6) throw new HttpErr(413, 'That pack is too big (3 MB at most)');
    let n = 0; const chunks = [];
    for await (const c of r.body) { n += c.length; if (n > 3e6) throw new HttpErr(413, 'That pack is too big (3 MB at most)'); chunks.push(c); }
    return normalizePack(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    if (e instanceof HttpErr) throw e;
    throw new HttpErr(400, e.name === 'AbortError' ? 'The link took too long' : `Couldn’t load that link (${e.cause?.code || e.message})`);
  } finally { clearTimeout(t); }
}

function addPack(p, by, src) {
  if (db.packs.length >= MAX_PACKS) throw new HttpErr(409, `There are already ${MAX_PACKS} packs — remove one on the display first`);
  const same = db.packs.find((x) => x.name === p.name && x.prompts.length === p.prompts.length && x.answers.length === p.answers.length);
  if (same) return same;
  const pack = { id: newId('k'), ...p, by: str(by, 40), at: Date.now(), src: str(src, 300) };
  db.packs.push(pack); save();
  log('blanks', `pack "${pack.name}" added (${pack.prompts.length} prompts, ${pack.answers.length} answers)`);
  return pack;
}
const summary = (p) => ({ id: p.id, name: p.name, lang: p.lang, adult: !!p.adult, prompts: p.prompts.length, answers: p.answers.length, by: p.by || '', at: p.at });

// ---------------------------------------------------------------- room hooks
const hostKeys = new Set();   // keys of rooms whose display has published (they may delete packs / house cards)
function onState(room) { if (room.key) { hostKeys.add(room.key); if (hostKeys.size > 500) hostKeys.delete(hostKeys.values().next().value); } }

function accept(room, act) {
  if (!TYPES.has(act.type)) throw new HttpErr(400, 'unknown action');
  const s = room.state;
  const known = !!s?.dev?.[act.device];
  act.round = Math.max(0, Math.round(+act.round || 0));
  if (act.type === 'join') {
    act.color = /^#[0-9a-f]{6}$/i.test(String(act.color || '')) ? String(act.color).toLowerCase() : '';
    if (s && !known && (s.players || []).filter((p) => !p.bot).length >= MAX_PLAYERS) throw new HttpErr(409, 'The game is full (20 players)');
    return {};
  }
  if (act.type === 'added') { act.kind = act.kind === 'pack' ? 'pack' : 'card'; act.label = str(act.label, 60); return {}; }
  if (!s) throw new HttpErr(409, 'The game hasn’t started');
  if (act.type === 'leave') return {};
  if (!known) throw new HttpErr(409, 'Join the game first');
  if (act.round && s.round && act.round !== s.round) throw new HttpErr(409, 'That round is over');
  if (act.type === 'play' || act.type === 'swap') {
    act.cards = (Array.isArray(act.cards) ? act.cards : []).map((c) => str(c, 16).replace(/[^\w*-]/g, '')).filter(Boolean).slice(0, act.type === 'swap' ? 12 : 3);
    act.wild = str(act.wild, 90);
    if (!act.cards.length) throw new HttpErr(400, 'Pick a card');
    if (act.type === 'play' && s.phase !== 'play') throw new HttpErr(409, 'Too late — the answers are in');
    return {};
  }
  act.k = str(act.k, 12).replace(/[^\w-]/g, '');
  return {};
}

function personalize(s, device) {
  if (!s) return null;
  const { dev, ...rest } = s;
  return { ...rest, me: dev?.[device] || null };
}

// ---------------------------------------------------------------- the phone page
const I18N = {
  en: {
    title: 'Fill the Blank', pickColor: 'Pick your colour', join: 'Join the game', waitHost: 'Waiting for the display…', lobby: 'You’re in!',
    lobbySub: 'Waiting for everyone to join. The game starts on the round screen.', players: 'Players ({n})', you: 'you',
    judge: 'You’re the judge', judgeSub: 'Sit back — the answers are coming in. You’ll read them out and pick the funniest.',
    played: '{n} of {m} played', pick: 'Pick {n}', pickOne: 'Tap your funniest card', pickTwo: 'Tap 2 cards — in order', playIt: 'Play it', playThese: 'Play these {n}',
    choose: 'Choose {n} card(s)', sent: 'Played ✓', sentSub: 'Waiting for the others…', wild: '✎ Write your own', wildLeft: '{n} left', wildPh: 'Your own answer…',
    wildOk: 'Use it', wildEmpty: 'Write something first', swap: 'Fresh hand', swapSub: 'Tap the cards to throw away — costs 1 point', swapGo: 'Swap {n} for 1 point', cancel: 'Cancel',
    swapped: 'New cards ✓', reading: 'The judge is reading the answers…', readOut: 'Read it out loud!', nextAns: 'Next answer', allIn: 'Pick the winner', pickWin: 'This one wins',
    voteNow: 'Vote for the funniest', voteSub: 'You can’t vote for your own', vote: 'Vote', voted: 'Voted ✓', votedSub: 'Waiting for the others…', yours: 'yours',
    roundWin: '{name} wins the round!', youWin: 'You won the round! 🎉', nextRound: 'Next round', whoPlayed: 'Who played what', tie: 'A tie!',
    final: 'Game over', champ: '{name} wins the game! 🏆', youChamp: 'You win the game! 🏆', pts: '{n} pts', round: 'Round {n}', scores: 'Scores', close: 'Close',
    timeLeft: '{s}s', auto: 'Time’s up — a card was played for you', adult: '18+',
    more: 'More', addCards: 'Add cards to the house pack', addSub: 'Your cards go into this bridge’s house pack — the host can use it in any game.',
    kindP: 'Prompt (black card)', kindA: 'Answer (white card)', promptPh: 'Use ___ for a blank (two for Pick 2)', answerPh: 'A funny answer…', adultCard: '18+ card',
    add: 'Add card', added: 'Added ✓ ({n} so far)', importPack: 'Import a card pack', importSub: 'A JSON file or link: { "name", "lang", "prompts": [{ "text", "pick" }], "answers": [ … ] }.',
    importNote: 'Imported packs are your responsibility — only load cards you’re allowed to use (e.g. Creative Commons) and that suit your group.',
    file: 'Choose a file', url: 'or paste a link', load: 'Import', imported: 'Imported “{name}” — {p} prompts, {a} answers', back: 'Back', leave: 'Leave the game', leaveQ: 'Leave the game? Your cards go back in the deck.',
    full: 'The game is full', rename: 'Change your name', hostQ: 'The game runs on the round display — this phone is your hand of cards.', notIn: 'You’ll be dealt in on the next round.',
  },
  he: {
    title: 'השלמת משפטים', pickColor: 'בחרו צבע', join: 'הצטרפות למשחק', waitHost: 'מחכים למסך…', lobby: 'אתם בפנים!',
    lobbySub: 'מחכים שכולם יצטרפו. המשחק מתחיל במסך העגול.', players: 'שחקנים ({n})', you: 'את/ה',
    judge: 'את/ה השופט/ת', judgeSub: 'שבו בנחת — התשובות מגיעות. תקראו אותן בקול ותבחרו את המצחיקה ביותר.',
    played: '{n} מתוך {m} שיחקו', pick: 'בחרו {n}', pickOne: 'הקישו על הקלף הכי מצחיק', pickTwo: 'בחרו 2 קלפים — לפי הסדר', playIt: 'שחקו אותו', playThese: 'שחקו את ה־{n}',
    choose: 'בחרו {n} קלפים', sent: 'נשלח ✓', sentSub: 'מחכים לשאר…', wild: '✎ כתבו בעצמכם', wildLeft: 'נשארו {n}', wildPh: 'התשובה שלכם…',
    wildOk: 'אישור', wildEmpty: 'קודם כתבו משהו', swap: 'יד חדשה', swapSub: 'סמנו קלפים להחלפה — עולה נקודה אחת', swapGo: 'החלפת {n} בנקודה', cancel: 'ביטול',
    swapped: 'קלפים חדשים ✓', reading: 'השופט/ת קורא/ת את התשובות…', readOut: 'הקריאו בקול!', nextAns: 'התשובה הבאה', allIn: 'בחרו את המנצח', pickWin: 'זה המנצח',
    voteNow: 'הצביעו לתשובה הכי מצחיקה', voteSub: 'אי אפשר להצביע לעצמכם', vote: 'הצבעה', voted: 'הצבעתם ✓', votedSub: 'מחכים לשאר…', yours: 'שלכם',
    roundWin: '{name} ניצח/ה בסיבוב!', youWin: 'ניצחתם בסיבוב! 🎉', nextRound: 'לסיבוב הבא', whoPlayed: 'מי שיחק מה', tie: 'תיקו!',
    final: 'המשחק נגמר', champ: '{name} ניצח/ה במשחק! 🏆', youChamp: 'ניצחתם במשחק! 🏆', pts: '{n} נק׳', round: 'סיבוב {n}', scores: 'ניקוד', close: 'סגירה',
    timeLeft: '{s} שנ׳', auto: 'נגמר הזמן — קלף שוחק בשבילכם', adult: '18+',
    more: 'עוד', addCards: 'הוספת קלפים לחבילת הבית', addSub: 'הקלפים נשמרים בחבילת הבית של הגשר — המארח יכול להשתמש בה בכל משחק.',
    kindP: 'שאלה (קלף שחור)', kindA: 'תשובה (קלף לבן)', promptPh: 'השתמשו ב־___ לחסר (שניים = בחרו 2)', answerPh: 'תשובה מצחיקה…', adultCard: 'קלף 18+',
    add: 'הוספת קלף', added: 'נוסף ✓ ({n} עד עכשיו)', importPack: 'ייבוא חבילת קלפים', importSub: 'קובץ JSON או קישור: { "name", "lang", "prompts": [{ "text", "pick" }], "answers": [ … ] }.',
    importNote: 'האחריות על חבילות מיובאות היא שלכם — טענו רק קלפים שמותר לכם להשתמש בהם (למשל Creative Commons) ושמתאימים לקבוצה.',
    file: 'בחירת קובץ', url: 'או הדביקו קישור', load: 'ייבוא', imported: 'יובאה „{name}” — {p} שאלות, {a} תשובות', back: 'חזרה', leave: 'יציאה מהמשחק', leaveQ: 'לצאת מהמשחק? הקלפים שלכם יחזרו לחפיסה.',
    full: 'המשחק מלא', rename: 'שינוי השם', hostQ: 'המשחק רץ במסך העגול — הטלפון הוא היד שלכם.', notIn: 'תקבלו קלפים בסיבוב הבא.',
  },
};

const CSS = `
:root{--c:#f5b82e;--on-c:#1b1405;--pc:#16141c;--pfg:#fbfaf7;--ac:#fffdf7;--afg:#17151c;--pb:rgba(255,255,255,.08)}
@media (prefers-color-scheme:dark){:root{--pc:#241f31;--pb:rgba(255,255,255,.16)}}
.bar{display:flex;align-items:center;gap:8px;margin:0 2px 12px;font-size:14px;color:var(--muted)}
.bar .me{display:flex;align-items:center;gap:8px;font-weight:700;color:var(--fg);min-width:0}
.bar .me b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar .sp{flex:1}
.av{width:30px;height:30px;border-radius:50%;background:var(--pcol,var(--c));color:#fff;display:grid;place-items:center;font-weight:800;font-size:14px;flex:none;text-shadow:0 1px 2px rgba(0,0,0,.35)}
.av.big{width:84px;height:84px;font-size:38px;margin:4px auto 10px;box-shadow:0 8px 30px color-mix(in srgb,var(--pcol) 45%,transparent)}
.pill{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:99px;background:var(--card2);font-weight:700;font-size:13px;color:var(--fg)}
.pill.c{background:var(--c);color:var(--on-c)}
.colors{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:6px 0 4px}
.colors button{aspect-ratio:1;border-radius:50%;background:var(--k);border:3px solid transparent;transition:transform .12s}
.colors button.on{border-color:var(--fg);transform:scale(1.08)}
.prompt{background:var(--pc);color:var(--pfg);border-radius:18px;padding:18px 18px 34px;font-size:21px;font-weight:800;line-height:1.3;position:relative;margin-bottom:14px;box-shadow:0 8px 26px rgba(0,0,0,.25);border:1px solid var(--pb);unicode-bidi:plaintext;min-height:110px}
.prompt .pk{position:absolute;inset-inline-end:14px;bottom:10px;font-size:12px;font-weight:800;letter-spacing:.06em;background:var(--c);color:var(--on-c);padding:3px 9px;border-radius:99px}
.prompt .tg{position:absolute;inset-inline-start:16px;bottom:11px;font-size:11px;font-weight:700;opacity:.55;letter-spacing:.04em}
.prompt .ans,.combo .ans{background:var(--ac);color:var(--afg);border-radius:8px;padding:0 6px;box-decoration-break:clone;-webkit-box-decoration-break:clone;font-weight:800}
.prompt .gap{display:inline-block;min-width:68px;border-bottom:3px solid currentColor;opacity:.6;transform:translateY(-4px)}
.hand{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-bottom:110px}
.ac{position:relative;background:var(--ac);color:var(--afg);border-radius:16px;padding:14px 13px 26px;min-height:118px;font-size:16px;font-weight:700;line-height:1.28;text-align:start;box-shadow:0 3px 0 rgba(0,0,0,.08),0 6px 18px rgba(0,0,0,.14);border:2px solid transparent;transition:transform .12s,border-color .15s,box-shadow .15s;unicode-bidi:plaintext;overflow-wrap:anywhere;cursor:pointer}
@media (prefers-color-scheme:light){.ac{border-color:#e7e2d6}}
.ac:active{transform:scale(.97)}
.ac.sel{border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 45%,transparent),0 8px 22px rgba(0,0,0,.2);transform:translateY(-3px)}
.ac .n{position:absolute;inset-inline-end:8px;bottom:6px;width:24px;height:24px;border-radius:50%;background:var(--c);color:var(--on-c);display:grid;place-items:center;font-size:13px;font-weight:900}
.ac.swap{opacity:.55;border-color:var(--err);border-style:dashed}
.ac.wildc{background:color-mix(in srgb,var(--c) 18%,var(--card));color:var(--fg);border:2px dashed color-mix(in srgb,var(--c) 70%,transparent);display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:4px}
.ac.wildc small{font-size:12px;color:var(--muted);font-weight:600}
.ac.wildc.sel{background:var(--ac);color:var(--afg);border-style:solid}
.ac .ft{position:absolute;inset-inline-start:13px;bottom:7px;font-size:10px;font-weight:800;letter-spacing:.08em;opacity:.35}
.dock{position:fixed;left:0;right:0;bottom:0;padding:12px 16px max(14px,env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 28%);z-index:5}
.dock .in2{max-width:528px;margin:0 auto}
.dock .big{margin-top:6px}
.preview{font-size:14px;color:var(--muted);margin:0 4px 2px;unicode-bidi:plaintext;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.preview .ans{color:var(--fg);font-weight:800}
.tbar{height:7px;border-radius:9px;background:var(--card2);overflow:hidden;margin:-4px 2px 14px}.tbar i{display:block;height:100%;background:var(--c);transition:width .3s linear}
.tbar.low i{background:var(--err)}
.status{text-align:center;padding:18px 10px}.status h2{margin:4px 0 6px;font-size:22px}.status p{margin:0;color:var(--muted)}
.emoji{font-size:54px;line-height:1;margin:6px 0 8px}
.combo{background:var(--pc);color:var(--pfg);border-radius:18px;padding:18px;font-size:20px;font-weight:800;line-height:1.35;unicode-bidi:plaintext;margin-bottom:12px;border:1px solid var(--pb);transition:transform .15s,box-shadow .15s}
.combo.win{box-shadow:0 0 0 3px var(--c),0 10px 30px color-mix(in srgb,var(--c) 30%,transparent)}
.combo .who{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:14px;font-weight:700;opacity:.85}
.combo .who .av{width:24px;height:24px;font-size:12px}
.list{display:grid;gap:10px;padding-bottom:110px}
.list .combo{cursor:pointer;font-size:17px;margin:0;border:2px solid var(--pb)}
.list .combo.sel{border-color:var(--c);transform:scale(1.01)}
.list .combo.mine{opacity:.5;cursor:default}
.list .combo .tag{display:inline-block;margin-inline-start:8px;font-size:11px;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.14);vertical-align:middle}
.board{display:grid;gap:8px}
.brow{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.brow b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.brow .sc{font-weight:900;font-variant-numeric:tabular-nums}
.brow.me{border:2px solid var(--c)}.brow .md{width:24px;text-align:center;font-weight:900}
.chipz{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;justify-content:center}
.chipz span{display:inline-flex;align-items:center;gap:6px;padding:5px 10px 5px 5px;border-radius:99px;background:var(--card2);font-size:14px;font-weight:600}
.chipz .av{width:22px;height:22px;font-size:11px}
.sheet{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:30;display:flex;align-items:flex-end;justify-content:center;animation:fade .2s}
.sheet>div{background:var(--bg);width:100%;max-width:560px;max-height:86vh;overflow:auto;border-radius:22px 22px 0 0;padding:18px 16px max(22px,env(safe-area-inset-bottom));animation:up .25s}
.sheet h3{margin:0 0 12px;font-size:19px}
@keyframes fade{from{opacity:0}}@keyframes up{from{transform:translateY(40px)}}
.seg{display:flex;gap:6px;margin-bottom:10px}.seg button{flex:1;padding:10px;border-radius:12px;background:var(--card2);font-weight:700;font-size:14px}.seg button.on{background:var(--c);color:var(--on-c)}
textarea.in{min-height:92px;resize:vertical}
.row{display:flex;align-items:center;gap:8px;margin:10px 0}
.note{font-size:13px;color:var(--muted);margin:8px 2px}
.warn{font-size:13px;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--warn) 14%,var(--card));border:1px solid color-mix(in srgb,var(--warn) 35%,transparent);margin:10px 0}
.menu{display:grid;gap:8px;margin-top:6px}.menu button{display:flex;align-items:center;gap:10px;padding:14px;border-radius:14px;background:var(--card);border:1px solid var(--line);font-weight:700;text-align:start}
.lnk{color:var(--c);font-weight:700;font-size:14px;padding:6px}
.x18{display:inline-block;padding:2px 7px;border-radius:7px;background:#e11d48;color:#fff;font-size:11px;font-weight:900;letter-spacing:.04em}
.fade-in{animation:pop .25s}
`;

const BODY = `
<div class="bar"><span class="me"><span class="av" id="myAv"></span><b id="who" dir="auto"></b></span><span id="x18"></span><span class="sp"></span><button class="pill" id="scoreBtn"></button><button class="pill" id="moreBtn" data-t="more"></button></div>
<div id="view"></div>
<div id="dock" class="dock" hidden><div class="in2" id="dockIn"></div></div>
`;

function script() {
  const { $, t, el, ls } = P;
  const COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f43f5e'];
  let myColor = ls.get('blanks.color') || '', sel = [], swapMode = false, swapSel = [], wildText = '', lastRound = -1, lastPhase = '', pickK = null, sheet = null;
  let added = 0, joinedOnce = false, gotAt = Date.now(), lastSig = '', sending = false;
  const view = () => P.view;
  const fwd = () => (P.lang === 'he' ? ' ‹' : ' ›');
  const initial = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
  const av = (p, cls = '') => el('span', { class: 'av ' + cls, '--pcol': p && p.color || 'var(--c)', style: 'background:' + (p && p.color || 'var(--c)') }, initial(p && p.name));
  const byPid = (pid) => ((view() && view().players) || []).find((p) => p.pid === pid);

  // ---- the prompt with its blanks filled in ("___" → the answers, in order)
  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
  function fillNodes(text, cards, opts = {}) {
    const parts = String(text || '').split(/_{2,}/), out = [];
    let i = 0;
    parts.forEach((p, j) => {
      if (p) out.push(document.createTextNode(p));
      if (j < parts.length - 1) {
        const c = cards[i++];
        if (c == null) { out.push(el('span', { class: 'gap' })); return; }
        const before = parts.slice(0, j + 1).join('').trim();
        let s = String(c).trim().replace(/[.。]+$/, '');
        if (!before || /[.!?]$/.test(before)) s = cap(s);
        out.push(el('span', { class: 'ans', dir: 'auto' }, s));
      }
    });
    while (i < cards.length) { const c = cards[i++]; if (c == null) continue; out.push(document.createTextNode(' ')); out.push(el('span', { class: 'ans', dir: 'auto' }, cap(String(c).trim()))); }
    return out;
  }
  const promptCard = (pr, cards = [], extra = null) => el('div', { class: 'prompt', dir: 'auto' }, ...fillNodes(pr.t, cards), pr.pick > 1 ? el('span', { class: 'pk', text: t('pick', { n: pr.pick }) }) : null, extra);
  const combo = (pr, cards, cls = '', kids = []) => el('div', { class: 'combo ' + cls, dir: 'auto' }, ...fillNodes(pr.t, cards), ...kids);

  function bar() {
    const v = view(), me = v && v.me, pl = me && byPid(me.pid);
    const a = $('#myAv'); a.textContent = initial(P.name); a.style.background = myColor || 'var(--c)';
    $('#x18').innerHTML = v && v.adult ? '<span class="x18">18+</span>' : '';
    const sb = $('#scoreBtn');
    sb.hidden = !v || !v.players || v.phase === 'lobby';
    sb.textContent = pl ? t('pts', { n: pl.score }) : t('scores');
  }
  function board(final) {
    const v = view(), box = el('div', { class: 'board' });
    const list = (v.players || []).slice().sort((a, b) => b.score - a.score);
    list.forEach((p, i) => box.append(el('div', { class: 'brow' + (v.me && p.pid === v.me.pid ? ' me' : '') }, el('span', { class: 'md', text: final ? (['🥇', '🥈', '🥉'][i] || String(i + 1)) : String(i + 1) }), av(p),
      el('b', { dir: 'auto', text: p.name + (p.judge && !final ? ' 👑' : '') }), el('span', { class: 'sc', text: String(p.score) }))));
    return box;
  }
  function openSheet(title, build) {
    closeSheet();
    const inner = el('div', {}, el('h3', { text: title }));
    sheet = el('div', { class: 'sheet', onclick: (e) => { if (e.target === sheet) closeSheet(); } }, inner);
    build(inner); document.body.append(sheet);
  }
  function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }

  function dock(...kids) {
    const d = $('#dock'), i = $('#dockIn'); i.textContent = '';
    const k = kids.filter(Boolean);
    d.hidden = !k.length; i.append(...k);
  }
  async function send(type, data = {}) {
    if (sending) return null;
    sending = true;
    try { const r = await P.act(type, { round: (view() && view().round) || 0, ...data }); return r; }
    catch (e) { P.toast(e.message, true); return null; }
    finally { sending = false; }
  }

  // ---- views
  function colorPicker(box, first) {
    const c = el('div', { class: 'card' }, el('label', { class: 'l', text: t('pickColor') }));
    const g = el('div', { class: 'colors' });
    let pick = myColor || COLORS[Math.floor(Math.random() * COLORS.length)];
    const drawG = () => { g.textContent = ''; COLORS.forEach((k) => g.append(el('button', { class: k === pick ? 'on' : '', '--k': k, 'aria-label': k, onclick: () => { pick = k; drawG(); } }))); };
    drawG();
    c.append(g, el('button', { class: 'big', text: t('join'), onclick: async () => {
      myColor = pick; ls.set('blanks.color', pick); ls.set('blanks.picked', '1');
      const r = await send('join', { color: pick });
      if (r) { joinedOnce = true; P.vibrate(20); closeSheet(); draw(); }
    } }));
    box.append(c);
  }
  function lobby(box) {
    const v = view();
    box.append(el('div', { class: 'card status fade-in' }, av({ name: P.name, color: myColor }, 'big'), el('h2', { text: t('lobby') }), el('p', { text: t('lobbySub') })));
    const humans = (v.players || []);
    const ch = el('div', { class: 'chipz' }, ...humans.map((p) => el('span', {}, av(p), el('bdi', { text: p.name }))));
    box.append(el('div', { class: 'card' }, el('label', { class: 'l', text: t('players', { n: humans.length }) }), ch));
  }
  function playView(box) {
    const v = view(), me = v.me, pr = v.prompt;
    const amJudge = v.judgeMode !== 'vote' && v.judge === me.pid;
    if (amJudge) {
      box.append(el('div', { class: 'status' }, el('div', { class: 'emoji', text: '👑' }), el('h2', { text: t('judge') }), el('p', { text: t('judgeSub') })));
      box.append(promptCard(pr));
      box.append(el('div', { class: 'note', style: 'text-align:center', text: t('played', { n: v.nDone || 0, m: v.nPlaying || 0 }) }));
      dock(); return;
    }
    if (me.sub) {
      box.append(el('div', { class: 'status' }, el('div', { class: 'emoji', text: '✅' }), el('h2', { text: t('sent') }), el('p', { text: me.sub.auto ? t('auto') : t('sentSub') })));
      box.append(combo(pr, me.sub.cards));
      box.append(el('div', { class: 'note', style: 'text-align:center', text: t('played', { n: v.nDone || 0, m: v.nPlaying || 0 }) }));
      dock(); return;
    }
    if (!me.hand || !me.hand.length) { box.append(el('div', { class: 'card status' }, el('p', { text: t('notIn') }))); dock(); return; }
    if (v.deadline) box.append(el('div', { class: 'tbar', id: 'tb' }, el('i')));
    box.append(promptCard(pr, swapMode ? [] : sel.map((id) => id === '*' ? (wildText || '…') : (me.hand.find((c) => c.id === id) || {}).t)));
    const hand = el('div', { class: 'hand' });
    for (const c of me.hand) {
      const i = sel.indexOf(c.id), s = swapSel.includes(c.id);
      hand.append(el('button', { class: 'ac' + (!swapMode && i >= 0 ? ' sel' : '') + (swapMode && s ? ' swap' : ''), dir: 'auto', onclick: () => tapCard(c.id) },
        c.t, !swapMode && i >= 0 && pr.pick > 1 ? el('span', { class: 'n', text: String(i + 1) }) : null, el('span', { class: 'ft', text: 'FILL THE BLANK' })));
    }
    if (me.wild > 0 && !swapMode) {
      const i = sel.indexOf('*');
      hand.append(el('button', { class: 'ac wildc' + (i >= 0 ? ' sel' : ''), onclick: () => tapWild() }, i >= 0 && wildText ? el('span', { dir: 'auto', text: wildText }) : el('span', { text: t('wild') }),
        el('small', { text: t('wildLeft', { n: me.wild }) }), i >= 0 && pr.pick > 1 ? el('span', { class: 'n', text: String(i + 1) }) : null));
    }
    box.append(hand);
    if (swapMode) {
      dock(el('div', { class: 'preview', text: t('swapSub') }), el('div', { class: 'row' }, el('button', { class: 'big', style: 'flex:1;background:var(--card2);color:var(--fg)', text: t('cancel'), onclick: () => { swapMode = false; swapSel = []; draw(); } }),
        el('button', { class: 'big', style: 'flex:2', disabled: !swapSel.length, text: t('swapGo', { n: swapSel.length }), onclick: async () => {
          const r = await send('swap', { cards: swapSel }); if (r) { swapMode = false; swapSel = []; sel = []; P.toast(t('swapped')); } } })));
      return;
    }
    const ready = sel.length === pr.pick;
    dock(me.canSwap ? el('div', { style: 'text-align:end' }, el('button', { class: 'lnk', text: '↻ ' + t('swap'), onclick: () => { swapMode = true; swapSel = []; draw(); } })) : null,
      el('button', { class: 'big', disabled: !ready, text: ready ? (pr.pick > 1 ? t('playThese', { n: pr.pick }) : t('playIt')) : (pr.pick > 1 ? t('pickTwo') : t('pickOne')), onclick: submit }));
    tick();
  }
  function tapCard(id) {
    const v = view();
    if (swapMode) { swapSel = swapSel.includes(id) ? swapSel.filter((x) => x !== id) : [...swapSel, id]; P.vibrate(8); draw(); return; }
    const pk = v.prompt.pick;
    if (sel.includes(id)) sel = sel.filter((x) => x !== id);
    else if (pk === 1) sel = [id];
    else if (sel.length < pk) sel = [...sel, id];
    else sel = [...sel.slice(1), id];
    P.vibrate(8); draw();
  }
  function tapWild() {
    const v = view();
    if (sel.includes('*')) { sel = sel.filter((x) => x !== '*'); draw(); return; }
    openSheet(t('wild').replace('✎ ', ''), (inner) => {
      const ta = el('textarea', { class: 'in', dir: 'auto', maxlength: '90', placeholder: t('wildPh') });
      ta.value = wildText;
      inner.append(ta, el('button', { class: 'big', text: t('wildOk'), onclick: () => {
        const s = ta.value.trim(); if (!s) return P.toast(t('wildEmpty'), true);
        wildText = s; const pk = v.prompt.pick;
        if (pk === 1) sel = ['*']; else if (sel.length < pk) sel = [...sel, '*']; else sel = [...sel.slice(1), '*'];
        closeSheet(); draw();
      } }));
      setTimeout(() => ta.focus(), 60);
    });
  }
  async function submit() {
    const v = view();
    if (sel.length !== v.prompt.pick) return;
    const r = await send('play', { cards: sel, wild: sel.includes('*') ? wildText : '' });
    if (r) { P.vibrate(25); P.beep(784, 0.08); }
  }
  function revealView(box) {
    const v = view(), me = v.me, pr = v.prompt, R = v.reveal || { idx: 0, n: 0, list: [] };
    const vote = v.judgeMode === 'vote', amJudge = !vote && v.judge === me.pid;
    const choosing = R.done && (vote || amJudge);
    if (choosing) {
      if (vote && me.vote) {
        box.append(el('div', { class: 'status' }, el('div', { class: 'emoji', text: '🗳️' }), el('h2', { text: t('voted') }), el('p', { text: t('votedSub') })));
        const mine = R.list.find((x) => x.k === me.vote); if (mine) box.append(combo(pr, mine.cards, 'win'));
        dock(); return;
      }
      box.append(el('div', { class: 'status', style: 'padding:6px 4px 12px' }, el('h2', { text: vote ? t('voteNow') : t('allIn') }), vote ? el('p', { text: t('voteSub') }) : null));
      const list = el('div', { class: 'list' });
      for (const x of R.list) {
        const mine = me.sub && me.sub.k === x.k;
        list.append(combo(pr, x.cards, (pickK === x.k ? 'sel' : '') + (mine ? ' mine' : ''), mine ? [el('span', { class: 'tag', text: t('yours') })] : []));
        list.lastChild.onclick = () => { if (mine) return; pickK = x.k; P.vibrate(8); draw(); };
      }
      box.append(list);
      dock(el('button', { class: 'big', disabled: !pickK, text: vote ? t('vote') : t('pickWin'), onclick: async () => {
        const r = await send(vote ? 'vote' : 'pick', { k: pickK }); if (r) { P.vibrate([30, 30, 60]); }
      } }));
      return;
    }
    const cur = R.idx > 0 ? R.list[R.idx - 1] : null;
    box.append(el('div', { class: 'status', style: 'padding:6px 4px 12px' }, el('h2', { text: amJudge ? t('readOut') : t('reading') }), el('p', { text: R.idx + ' / ' + R.n })));
    box.append(cur ? combo(pr, cur.cards, 'fade-in') : promptCard(pr));
    dock(amJudge ? el('button', { class: 'big', text: R.idx < R.n ? t('nextAns') + fwd() : t('allIn'), onclick: () => send('next') }) : null);
  }
  function winView(box) {
    const v = view(), me = v.me, W = v.win || {}, pr = v.prompt;
    const mine = (W.pids || []).includes(me.pid);
    const names = (W.pids || []).map((p) => (byPid(p) || {}).name || '?').join(' & ');
    box.append(el('div', { class: 'status' }, el('div', { class: 'emoji', text: mine ? '🎉' : '🏆' }), el('h2', { dir: 'auto', text: mine ? t('youWin') : (W.pids || []).length > 1 ? t('tie') + ' ' + names : t('roundWin', { name: names }) })));
    for (const x of W.cards || []) box.append(combo(pr, x, 'win'));
    if ((W.all || []).length) {
      const c = el('div', { class: 'card' }, el('label', { class: 'l', text: t('whoPlayed') }));
      for (const x of W.all) {
        const p = byPid(x.pid) || { name: x.name, color: '#888' };
        c.append(el('div', { class: 'row', style: 'align-items:flex-start' }, av(p), el('div', { style: 'flex:1;font-size:14px' }, el('b', {}, el('bdi', { text: p.name })), ': ', el('bdi', { text: x.cards.join(' / ') }))));
      }
      box.append(c);
    }
    if (mine && v.round !== lastSig) { lastSig = v.round; P.vibrate([40, 40, 120]); P.beep(988, 0.25, 'triangle'); }
    const amJudge = v.judgeMode !== 'vote' && v.judge === me.pid;
    dock(amJudge || v.judgeMode === 'vote' ? el('button', { class: 'big', text: t('nextRound') + fwd(), onclick: () => send('go') }) : null);
  }
  function finalView(box) {
    const v = view(), me = v.me;
    const top = (v.players || []).slice().sort((a, b) => b.score - a.score)[0];
    const champ = top && top.pid === me.pid;
    box.append(el('div', { class: 'status' }, el('div', { class: 'emoji', text: champ ? '🏆' : '👏' }), el('h2', { dir: 'auto', text: champ ? t('youChamp') : t('champ', { name: top ? top.name : '' }) }), el('p', { text: t('final') })));
    box.append(board(true));
    dock();
  }

  function draw() {
    bar();
    const v = view(), box = $('#view'); box.textContent = '';
    if (!P.name) { dock(); return; }
    if (!v) { box.append(el('div', { class: 'card status' }, el('div', { class: 'emoji', text: '🃏' }), el('p', { text: t('waitHost') }))); dock(); return; }
    if (v.phase !== lastPhase || v.round !== lastRound) {
      if (v.round !== lastRound) { sel = []; wildText = ''; swapMode = false; swapSel = []; }
      pickK = null; lastPhase = v.phase; lastRound = v.round;
    }
    if (!v.me) {
      if (!myColor || !joinedOnce) { colorPicker(box); dock(); return; }
      box.append(el('div', { class: 'card status' }, el('div', { class: 'spin' }))); dock(); return;
    }
    if (v.me.color && v.me.color !== myColor) { myColor = v.me.color; ls.set('blanks.color', myColor); bar(); }
    if (v.phase === 'lobby' && ls.get('blanks.picked') !== '1') { colorPicker(box); lobby(box); dock(); return; }
    if (v.phase === 'lobby') { lobby(box); dock(); return; }
    if (v.phase === 'play') return playView(box);
    if (v.phase === 'reveal') return revealView(box);
    if (v.phase === 'win') return winView(box);
    if (v.phase === 'final') return finalView(box);
    dock();
  }
  function tick() {
    const v = view(), b = document.getElementById('tb');
    if (!b || !v || !v.deadline) return;
    const left = Math.max(0, v.deadline.left - (Date.now() - gotAt));
    b.firstChild.style.width = (left / (v.deadline.total || 1) * 100).toFixed(1) + '%';
    b.classList.toggle('low', left < 10000);
  }
  setInterval(tick, 300);

  // ---- the More menu: house pack cards, pack import, leave
  function more() {
    openSheet(t('more'), (inner) => {
      const m = el('div', { class: 'menu' },
        el('button', { onclick: addCardsSheet }, '✎ ', t('addCards')),
        el('button', { onclick: importSheet }, '⇪ ', t('importPack')),
        view() && view().me ? el('button', { onclick: () => { if (confirm(t('leaveQ'))) { send('leave'); joinedOnce = false; closeSheet(); } } }, '⎋ ', t('leave')) : null,
        el('button', { onclick: () => { ls.set('blanks.picked', ''); closeSheet(); draw(); window.scrollTo(0, 0); } }, '● ', t('pickColor')),
        el('button', { id: 'rename', onclick: () => closeSheet() }, '✎ ', t('rename')));
      inner.append(m, el('p', { class: 'note', text: t('hostQ') }));
    });
  }
  function addCardsSheet() {
    openSheet(t('addCards'), (inner) => {
      let kind = 'answer', adult = false;
      const ta = el('textarea', { class: 'in', dir: 'auto', maxlength: '200' });
      const seg = el('div', { class: 'seg' });
      const drawSeg = () => { seg.textContent = ''; for (const [k, l] of [['prompt', t('kindP')], ['answer', t('kindA')]]) seg.append(el('button', { class: kind === k ? 'on' : '', text: l, onclick: () => { kind = k; drawSeg(); } })); ta.placeholder = t(kind === 'prompt' ? 'promptPh' : 'answerPh'); };
      drawSeg();
      const cb = el('input', { type: 'checkbox', id: 'adultCb', onchange: (e) => { adult = e.target.checked; } });
      inner.append(el('p', { class: 'note', text: t('addSub') }), seg, ta, el('label', { class: 'row', for: 'adultCb' }, cb, el('span', { class: 'x18', text: '18+' }), el('span', { text: t('adultCard') })),
        el('button', { class: 'big', text: t('add'), onclick: async (e) => {
          const text = ta.value.trim(); if (!text) return P.toast(t('wildEmpty'), true);
          e.target.disabled = true;
          try {
            const r = await fetch('/api/blanks/house', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, text, adult, lang: /[\u0590-\u05ff]/.test(text) ? 'he' : 'en', by: P.name, device: P.device }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
            added++; ta.value = ''; P.toast(t('added', { n: added })); P.vibrate(20); P.act('added', { kind: 'card', label: kind }).catch(() => {});
          } catch (x) { P.toast(x.message, true); }
          e.target.disabled = false; ta.focus();
        } }));
    });
  }
  function importSheet() {
    openSheet(t('importPack'), (inner) => {
      const fi = el('input', { type: 'file', accept: '.json,application/json,text/plain', style: 'display:none' });
      const url = el('input', { class: 'in', type: 'url', placeholder: 'https://…', dir: 'ltr' });
      const go = async (body) => {
        try {
          const r = await fetch('/api/blanks/packs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, by: P.name }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
          P.toast(t('imported', { name: d.pack.name, p: d.pack.prompts, a: d.pack.answers })); P.vibrate(20);
          P.act('added', { kind: 'pack', label: d.pack.name }).catch(() => {});
          closeSheet();
        } catch (x) { P.toast(x.message, true); }
      };
      fi.onchange = () => { const f = fi.files && fi.files[0]; if (!f) return; if (f.size > 3e6) return P.toast('3 MB max', true); const rd = new FileReader(); rd.onload = () => go({ pack: String(rd.result) }); rd.readAsText(f); };
      inner.append(el('p', { class: 'note', text: t('importSub') }), el('div', { class: 'warn', text: t('importNote') }), fi,
        el('button', { class: 'big', text: t('file'), onclick: () => fi.click() }),
        el('label', { class: 'l', style: 'margin-top:16px', text: t('url') }), url,
        el('button', { class: 'big', style: 'background:var(--card2);color:var(--fg)', text: t('load'), onclick: () => { if (url.value.trim()) go({ url: url.value.trim() }); } }));
    });
  }
  $('#moreBtn').onclick = more;
  $('#scoreBtn').onclick = () => { if (view() && view().players) openSheet(t('scores'), (inner) => inner.append(board(view().phase === 'final'))); };

  P.on('state', (v) => {
    gotAt = Date.now();
    // the display forgot us (it restarted, or we were removed): join again with our colour
    if (v && !v.me && P.name && myColor && joinedOnce) P.act('join', { color: myColor }).catch(() => {});
    draw();
  });
  P.on('render', draw);
  if (myColor && P.name) { joinedOnce = true; setTimeout(() => P.act('join', { color: myColor }).catch(() => {}), 300); }
}

const PAGE = phonePage({ app: 'blanks', title: 'Fill the Blank', color: '#f5b82e', glyph: '✎', css: CSS, body: BODY, i18n: I18N, script });
const partyRoute = partyApp({ name: 'blanks', page: PAGE, personalize, accept, onState });

// ---------------------------------------------------------------- the packs API, then the party routes
const hits = new Map();
function limited(req, max = 40) {
  const ip = req.socket.remoteAddress || '', now = Date.now();
  const h = (hits.get(ip) || []).filter((x) => now - x < 60000);
  h.push(now); hits.set(ip, h);
  if (hits.size > 2000) hits.clear();
  return h.length > max;
}

export async function route(req, res, url, ctx) {
  const { cfg, cors, json, readJson, originAllowed, dir } = ctx;
  const p = url.pathname.replace(/\/+$/, '');
  if (p !== '/api/blanks/packs' && p !== '/api/blanks/pack' && p !== '/api/blanks/house') return partyRoute(req, res, url, ctx);
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!originAllowed(req)) return json(res, 403, { error: `origin ${req.headers.origin} not allowed` });
  load(cfg, dir);
  const q = url.searchParams;
  try {
    if (p === '/api/blanks/packs' && req.method === 'GET') {
      return json(res, 200, { house: { prompts: db.house.prompts.length, answers: db.house.answers.length }, packs: db.packs.map(summary) });
    }
    if (p === '/api/blanks/pack' && req.method === 'GET') {
      const id = q.get('id') || '';
      if (id === 'house') {
        const adult = q.get('adult') === '1';
        const ok = (c) => adult || !c.adult;
        return json(res, 200, { id: 'house', name: 'House pack', lang: 'mixed', prompts: db.house.prompts.filter(ok).map((c) => ({ id: c.id, text: c.text, pick: c.pick, lang: c.lang, adult: !!c.adult, by: c.by })),
          answers: db.house.answers.filter(ok).map((c) => c.text), cards: db.house.answers.filter(ok).map((c) => ({ id: c.id, text: c.text, lang: c.lang, adult: !!c.adult, by: c.by })) });
      }
      const pk = db.packs.find((x) => x.id === id);
      if (!pk) throw new HttpErr(404, 'No such pack');
      return json(res, 200, { id: pk.id, name: pk.name, lang: pk.lang, adult: !!pk.adult, prompts: pk.prompts, answers: pk.answers });
    }
    if (p === '/api/blanks/packs' && req.method === 'POST') {
      if (limited(req, 12)) throw new HttpErr(429, 'Slow down a little');
      const b = await readJson(req);
      const pk = b.url ? await fetchPack(b.url) : normalizePack(b.pack);
      const saved = addPack(pk, b.by, b.url || 'upload');
      return json(res, 200, { ok: true, pack: summary(saved) });
    }
    if (p === '/api/blanks/packs' && req.method === 'DELETE') {
      if (!hostKeys.has(q.get('key') || '')) throw new HttpErr(403, 'Only the display can remove packs');
      const n = db.packs.length;
      db.packs = db.packs.filter((x) => x.id !== q.get('id'));
      if (db.packs.length !== n) save();
      return json(res, 200, { ok: true, removed: n - db.packs.length });
    }
    if (p === '/api/blanks/house' && req.method === 'POST') {
      if (limited(req)) throw new HttpErr(429, 'Slow down a little');
      const b = await readJson(req);
      const kind = b.kind === 'prompt' ? 'prompt' : 'answer';
      const text = kind === 'prompt' ? normText(b.text) : str(b.text, MAX_TEXT).replace(/\s+/g, ' ');
      if (!text) throw new HttpErr(400, 'Write something first');
      if (db.house.prompts.length + db.house.answers.length >= MAX_HOUSE) throw new HttpErr(409, 'The house pack is full');
      const list = kind === 'prompt' ? db.house.prompts : db.house.answers;
      if (list.some((c) => c.text.toLowerCase() === text.toLowerCase())) throw new HttpErr(409, 'That card is already in the house pack');
      const card = { id: newId('h'), text, lang: b.lang === 'he' || hasHe(text) ? 'he' : 'en', adult: !!b.adult, by: str(b.by, 40), at: Date.now() };
      if (kind === 'prompt') card.pick = Math.max(1, Math.min(3, blanks(text) || 1));
      list.push(card); save();
      return json(res, 200, { ok: true, card, house: { prompts: db.house.prompts.length, answers: db.house.answers.length } });
    }
    if (p === '/api/blanks/house' && req.method === 'DELETE') {
      if (!hostKeys.has(q.get('key') || '')) throw new HttpErr(403, 'Only the display can remove cards');
      const id = q.get('id');
      const n = db.house.prompts.length + db.house.answers.length;
      if (id === 'all') db.house = { prompts: [], answers: [] };
      else { db.house.prompts = db.house.prompts.filter((c) => c.id !== id); db.house.answers = db.house.answers.filter((c) => c.id !== id); }
      const m = db.house.prompts.length + db.house.answers.length;
      if (m !== n) save();
      return json(res, 200, { ok: true, removed: n - m });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, e.code >= 400 && e.code < 600 ? e.code : 400, { error: e.message });
  }
}
