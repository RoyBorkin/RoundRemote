// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Fill the Blank — the "Add cards" phone page (GET /blanks/add), served by lib/blanks.js. Works without a running game:
// the round display shows its QR code in the lobby, on the game's start card and in Custom cards. Players write prompt
// cards ("____" marks each blank: one → Pick 1, two → Pick 2, none → the answer goes after it) and answer cards, in
// English or Hebrew, each optionally 18+; they land in the bridge's house pack (POST /api/blanks/house). The page lists
// the house pack, with ✕ on the cards this phone added (DELETE /api/blanks/house?id&device), and imports JSON packs.
// Self-contained: inline CSS / JS, no external requests. The phone's id, name and language are shared with the game's
// phone page (localStorage rrparty.*), so cards added there count as "mine" here too.

const I18N = {
  en: {
    title: 'Fill the Blank', sub: 'Add cards', lang: 'עברית', name: 'Your name', namePh: 'So everyone knows who wrote it',
    kindP: 'Prompt', kindPs: 'black card', kindA: 'Answer', kindAs: 'white card',
    promptPh: 'Write a prompt. Use ____ for each blank.', answerPh: 'Write a funny answer…', blank: '+ Blank',
    pick: 'Pick {n}', after: 'No blank — the answer goes after it', twoMax: 'Up to 3 blanks', adult: '18+ card', adultSub: 'Only used when the host turns on 18+ cards',
    add: 'Add card', adding: 'Adding…', added: 'Added ✓', empty: 'Write something first', tooLong: 'Keep it under 200 characters',
    house: 'House pack', houseSub: 'Prompts: {p} · Answers: {a}', mine: 'Mine ({n})', all: 'All ({n})', none: 'No cards yet — add the first one!', noneMine: 'You haven’t added any cards yet.',
    del: 'Delete', delQ: 'Delete this card?', deleted: 'Deleted', by: 'by {name}', you: 'you',
    importT: 'Import a card pack', importSub: 'A JSON file or link: { "name", "lang", "prompts": [{ "text", "pick" }], "answers": [ … ] }.',
    importNote: 'Imported packs are your responsibility — only load cards you’re allowed to use (e.g. Creative Commons) and that suit your group.',
    file: 'Choose a file', url: 'or paste a link', load: 'Import', imported: 'Imported “{name}” — {p} prompts, {a} answers',
    offline: 'Can’t reach the bridge — are you on the same Wi-Fi as the display?', tip: 'Tip: short and specific is funniest. Answers work best as a noun phrase (“a suspiciously quiet toddler”).',
    sample: 'Preview',
  },
  he: {
    title: 'השלמת משפטים', sub: 'הוספת קלפים', lang: 'English', name: 'השם שלכם', namePh: 'כדי שכולם יידעו מי כתב',
    kindP: 'שאלה', kindPs: 'קלף שחור', kindA: 'תשובה', kindAs: 'קלף לבן',
    promptPh: 'כתבו שאלה. ____ מסמן כל חסר.', answerPh: 'כתבו תשובה מצחיקה…', blank: '+ חסר',
    pick: 'בחרו {n}', after: 'בלי חסר — התשובה באה אחריה', twoMax: 'עד 3 חסרים', adult: 'קלף 18+', adultSub: 'ישמש רק כשהמארח מפעיל קלפי 18+',
    add: 'הוספת קלף', adding: 'מוסיפים…', added: 'נוסף ✓', empty: 'קודם כתבו משהו', tooLong: 'עד 200 תווים',
    house: 'חבילת הבית', houseSub: 'שאלות: {p} · תשובות: {a}', mine: 'שלי ({n})', all: 'הכול ({n})', none: 'עוד אין קלפים — הוסיפו את הראשון!', noneMine: 'עוד לא הוספתם קלפים.',
    del: 'מחיקה', delQ: 'למחוק את הקלף?', deleted: 'נמחק', by: 'מאת {name}', you: 'אתם',
    importT: 'ייבוא חבילת קלפים', importSub: 'קובץ JSON או קישור: { "name", "lang", "prompts": [{ "text", "pick" }], "answers": [ … ] }.',
    importNote: 'האחריות על חבילות מיובאות היא שלכם — טענו רק קלפים שמותר לכם להשתמש בהם (למשל Creative Commons) ושמתאימים לקבוצה.',
    file: 'בחירת קובץ', url: 'או הדביקו קישור', load: 'ייבוא', imported: 'יובאה „{name}” — {p} שאלות, {a} תשובות',
    offline: 'אין חיבור לגשר — אתם על אותה רשת Wi-Fi כמו המסך?', tip: 'טיפ: קצר וספציפי זה הכי מצחיק. תשובות עובדות הכי טוב כצירוף שם עצם („פעוט שקט באופן חשוד”).',
    sample: 'תצוגה מקדימה',
  },
};

const CSS = `
:root{--bg:#14111c;--card:#1f1a2b;--card2:#2a2339;--fg:#f6f3fb;--muted:#b3abc6;--dim:#7d7493;--line:#382f4b;--c:#f5b82e;--on-c:#1b1405;--ok:#34d399;--err:#ff6b7d;
  --pc:#0f0d14;--pfg:#fbfaf7;--ac:#fffdf7;--afg:#17151c;--x18:#e11d48}
@media (prefers-color-scheme:light){:root{--bg:#f6f3fb;--card:#fff;--card2:#efeaf7;--fg:#1d1729;--muted:#5d5470;--dim:#8f86a3;--line:#e2dcec;--pc:#16141c}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 Inter,Rubik,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
body{padding:max(14px,env(safe-area-inset-top)) 16px max(40px,env(safe-area-inset-bottom));max-width:560px;margin:0 auto;min-height:100dvh}
button,input,textarea{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none;touch-action:manipulation}
header{display:flex;align-items:center;gap:10px;margin:2px 2px 14px}
.logo{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:var(--pc);color:var(--pfg);font-weight:800;font-size:20px;flex:none;border:1px solid var(--line);position:relative}
.logo::after{content:'';position:absolute;right:-5px;bottom:-5px;width:20px;height:26px;border-radius:5px;background:var(--ac);border:1px solid var(--line);transform:rotate(12deg)}
h1{font-size:19px;margin:0;line-height:1.15} h2{font-size:17px;margin:0}
.sub{color:var(--muted);font-size:13px}
.lang{margin-inline-start:auto;padding:7px 13px;border-radius:99px;background:var(--card2);font-weight:700;font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:16px;margin-bottom:14px}
label.l{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:0 0 8px}
.in{width:100%;padding:13px 15px;border-radius:14px;border:1px solid var(--line);background:var(--card2);outline:none;font-size:17px;unicode-bidi:plaintext}
.in:focus{border-color:var(--c)}
textarea.in{min-height:96px;resize:vertical;line-height:1.35}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.seg button{padding:11px 8px;border-radius:14px;background:var(--card2);font-weight:800;font-size:15px;border:2px solid transparent;display:flex;flex-direction:column;align-items:center;gap:1px}
.seg button small{font-weight:600;font-size:12px;color:var(--muted)}
.seg button.on{border-color:var(--c);background:color-mix(in srgb,var(--c) 14%,var(--card2))}
.tools{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}
.ghost{padding:9px 14px;border-radius:99px;background:var(--card2);font-weight:700;font-size:14px}
.pickpill{padding:5px 11px;border-radius:99px;background:var(--c);color:var(--on-c);font-weight:800;font-size:12px;letter-spacing:.04em;text-transform:uppercase}
.hint{color:var(--muted);font-size:13px}
.pv{margin-top:12px;border-radius:16px;padding:16px 16px 34px;min-height:96px;position:relative;font-weight:700;font-size:18px;line-height:1.3;unicode-bidi:plaintext;overflow-wrap:anywhere;border:1px solid var(--line)}
.pv.p{background:var(--pc);color:var(--pfg)} .pv.a{background:var(--ac);color:var(--afg)}
.pv .gap{display:inline-block;width:64px;border-bottom:3px solid currentColor;opacity:.55;margin:0 3px;height:1em;vertical-align:baseline}
.pv .ph{opacity:.4;font-weight:600}
.pv .brand{position:absolute;inset-inline-start:16px;bottom:10px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.45}
.pv .pk{position:absolute;inset-inline-end:12px;bottom:9px}
.row{display:flex;align-items:center;gap:10px;margin-top:12px;font-weight:600}
.row input{width:22px;height:22px;accent-color:var(--x18)}
.row small{display:block;color:var(--muted);font-weight:500;font-size:12px}
.x18{padding:2px 7px;border-radius:6px;background:var(--x18);color:#fff;font-weight:800;font-size:12px;flex:none}
.big{width:100%;padding:15px;border-radius:99px;background:var(--c);color:var(--on-c);font-weight:800;font-size:17px;margin-top:14px;transition:transform .15s,opacity .2s}
.big:active{transform:scale(.97)} .big:disabled{opacity:.45}
.big.alt{background:var(--card2);color:var(--fg)}
.tabs{display:flex;gap:8px;margin:12px 0 6px}
.tabs button{padding:8px 14px;border-radius:99px;background:var(--card2);font-weight:700;font-size:14px}
.tabs button.on{background:var(--fg);color:var(--bg)}
.list{display:flex;flex-direction:column}
.it{display:flex;align-items:flex-start;gap:10px;padding:11px 2px;border-bottom:1px solid var(--line)}
.it:last-child{border-bottom:0}
.kd{width:20px;height:26px;border-radius:5px;flex:none;margin-top:1px;border:1px solid var(--line)}
.kd.p{background:var(--pc)} .kd.a{background:var(--ac)}
.it .t{flex:1;min-width:0;unicode-bidi:plaintext;overflow-wrap:anywhere}
.it .t small{display:block;color:var(--dim);font-size:12px;margin-top:2px}
.it .t.p{font-weight:700}
.del{width:34px;height:34px;border-radius:50%;background:var(--card2);color:var(--muted);font-weight:800;flex:none;font-size:15px}
.empty{color:var(--dim);text-align:center;padding:18px 8px}
.note{color:var(--muted);font-size:13px;margin:0 0 10px}
.warn{background:color-mix(in srgb,var(--c) 14%,var(--card));border:1px solid color-mix(in srgb,var(--c) 40%,transparent);border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:10px}
.banner{display:none;padding:11px 14px;border-radius:14px;background:color-mix(in srgb,var(--err) 14%,var(--card));border:1px solid color-mix(in srgb,var(--err) 40%,transparent);margin-bottom:12px;font-size:14px;font-weight:600}
.banner.on{display:block}
.toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translate(-50%,20px);opacity:0;background:var(--fg);color:var(--bg);padding:11px 20px;border-radius:99px;font-weight:700;transition:.25s;pointer-events:none;z-index:20;max-width:90%;text-align:center}
.toast.show{opacity:1;transform:translate(-50%,0)} .toast.err{background:var(--err);color:#fff}
[dir=auto]{unicode-bidi:plaintext}
[hidden]{display:none!important}
.x18,.pickpill{direction:ltr;unicode-bidi:isolate}
`;

const BODY = `
<header><div class="logo" aria-hidden="true">✎</div><div><h1 data-t="title"></h1><div class="sub" data-t="sub"></div></div><button class="lang" id="lang" type="button"></button></header>
<div class="banner" id="banner" data-t="offline"></div>
<div class="card"><label class="l" for="name" data-t="name"></label><input class="in" id="name" dir="auto" maxlength="24" autocomplete="nickname"></div>
<div class="card">
  <div class="seg" id="seg"><button type="button" data-k="prompt"><span data-t="kindP"></span><small data-t="kindPs"></small></button><button type="button" data-k="answer"><span data-t="kindA"></span><small data-t="kindAs"></small></button></div>
  <textarea class="in" id="text" dir="auto" maxlength="200"></textarea>
  <div class="tools" id="tools"><button class="ghost" id="blank" type="button" data-t="blank"></button><span class="pickpill" id="pick"></span><span class="hint" id="pickHint"></span></div>
  <div class="pv" id="pv" aria-label="preview"></div>
  <label class="row" for="adult"><input type="checkbox" id="adult"><span class="x18">18+</span><span><span data-t="adult"></span><small data-t="adultSub"></small></span></label>
  <button class="big" id="add" type="button" data-t="add"></button>
  <p class="note" style="margin:12px 2px 0" data-t="tip"></p>
</div>
<div class="card">
  <h2 data-t="house"></h2><div class="sub" id="counts"></div>
  <div class="tabs"><button type="button" id="tMine"></button><button type="button" id="tAll"></button></div>
  <div class="list" id="list"></div>
</div>
<div class="card">
  <h2 data-t="importT" style="margin-bottom:8px"></h2>
  <p class="note" data-t="importSub"></p><div class="warn" data-t="importNote"></div>
  <input type="file" id="file" accept=".json,application/json,text/plain" hidden>
  <button class="big alt" id="fileBtn" type="button" data-t="file"></button>
  <label class="l" style="margin-top:16px" data-t="url" for="url"></label><input class="in" id="url" type="url" placeholder="https://…" dir="ltr">
  <button class="big alt" id="load" type="button" data-t="load"></button>
</div>
<div class="toast" id="toast"></div>
`;

function script() {
  const $ = (s) => document.querySelector(s);
  const ls = { get: (k) => { try { return localStorage.getItem('rrparty.' + k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('rrparty.' + k, v); } catch {} } };
  let device = ls.get('device'); if (!device) { device = 'p' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4); ls.set('device', device); }
  let lang = ls.get('lang') || (/^he|^iw/i.test(navigator.language || '') ? 'he' : 'en');
  let kind = ls.get('blanks.addKind') === 'prompt' ? 'prompt' : 'answer', tab = 'mine', cards = [], busy = false;
  const t = (k, v = {}) => String((I18N[lang] || I18N.en)[k] ?? I18N.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); } for (const c of kids) if (c != null) e.append(c); return e; };
  let toastT = 0;
  const toast = (m, err) => { const x = $('#toast'); x.textContent = m; x.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => { x.className = 'toast'; }, 2400); };
  const api = async (path, opts = {}) => {
    const r = await fetch(path, { ...opts, headers: opts.body ? { 'Content-Type': 'application/json' } : {} });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    $('#banner').classList.remove('on');
    return d;
  };
  const blanks = (s) => (String(s).match(/_{2,}/g) || []).length;
  const norm = (s) => String(s).replace(/_{2,}/g, '____');

  function paintTexts() {
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-t]').forEach((e) => { e.textContent = t(e.dataset.t); });
    $('#lang').textContent = t('lang');
    $('#name').placeholder = t('namePh');
    paintKind(); paintList();
  }
  function paintKind() {
    document.querySelectorAll('#seg button').forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
    $('#text').placeholder = t(kind === 'prompt' ? 'promptPh' : 'answerPh');
    $('#tools').hidden = kind !== 'prompt';
    preview();
  }
  function preview() {
    const v = $('#text').value.trim(), pv = $('#pv');
    pv.className = 'pv ' + (kind === 'prompt' ? 'p' : 'a'); pv.textContent = '';
    pv.setAttribute('dir', 'auto');
    const n = blanks(v);
    if (kind === 'prompt') {
      $('#pick').textContent = t('pick', { n: Math.max(1, Math.min(3, n || 1)) });
      $('#pickHint').textContent = n === 0 ? (v ? t('after') : '') : n > 3 ? t('twoMax') : '';
    }
    if (!v) { pv.append(el('span', { class: 'ph', text: t(kind === 'prompt' ? 'promptPh' : 'answerPh') })); }
    else if (kind === 'prompt') {
      const parts = norm(v).split('____');
      parts.forEach((p, i) => { if (p) pv.append(p); if (i < parts.length - 1) pv.append(el('span', { class: 'gap' })); });
    } else pv.append(v);
    pv.append(el('span', { class: 'brand', text: 'Fill the Blank' }));
    if (kind === 'prompt' && n > 1) pv.append(el('span', { class: 'pickpill pk', text: t('pick', { n: Math.min(3, n) }) }));
  }
  function paintList() {
    const mine = cards.filter((c) => c.mine);
    const P = cards.filter((c) => c.kind === 'prompt').length, A = cards.length - P;
    $('#counts').textContent = t('houseSub', { p: P, a: A });
    $('#tMine').textContent = t('mine', { n: mine.length }); $('#tAll').textContent = t('all', { n: cards.length });
    $('#tMine').classList.toggle('on', tab === 'mine'); $('#tAll').classList.toggle('on', tab === 'all');
    const list = $('#list'); list.textContent = '';
    const show = (tab === 'mine' ? mine : cards).slice().reverse();
    if (!show.length) { list.append(el('div', { class: 'empty', text: t(tab === 'mine' && cards.length ? 'noneMine' : 'none') })); return; }
    for (const c of show.slice(0, 300)) {
      const k = c.kind === 'prompt' ? 'p' : 'a';
      const meta = [c.kind === 'prompt' && c.pick > 1 ? t('pick', { n: c.pick }) : '', c.mine ? t('you') : c.by ? t('by', { name: c.by }) : ''].filter(Boolean).join(' · ');
      list.append(el('div', { class: 'it' }, el('span', { class: 'kd ' + k }),
        el('div', { class: 't ' + k, dir: 'auto' }, c.text, meta ? el('small', { text: meta }) : null),
        c.adult ? el('span', { class: 'x18', text: '18+' }) : null,
        c.mine ? el('button', { class: 'del', type: 'button', 'aria-label': t('del'), text: '✕', onclick: () => del(c) }) : null));
    }
  }
  async function load() {
    try {
      const d = await api('/api/blanks/pack?id=house&adult=1&device=' + encodeURIComponent(device));
      cards = [...(d.prompts || []).map((c) => ({ ...c, kind: 'prompt' })), ...(d.cards || []).map((c) => ({ ...c, kind: 'answer' }))].sort((a, b) => (a.at || 0) - (b.at || 0));
      paintList();
    } catch (e) { $('#banner').classList.add('on'); }
  }
  async function add() {
    if (busy) return;
    let text = $('#text').value.trim();
    if (!text) { toast(t('empty'), true); $('#text').focus(); return; }
    if (kind === 'prompt') text = norm(text);
    const name = $('#name').value.trim().slice(0, 24); if (name) ls.set('name', name);
    busy = true; const b = $('#add'); b.disabled = true; b.textContent = t('adding');
    try {
      await api('/api/blanks/house', { method: 'POST', body: JSON.stringify({ kind, text, adult: $('#adult').checked, lang: /[֐-׿]/.test(text) ? 'he' : 'en', by: name, device }) });
      $('#text').value = ''; preview(); toast(t('added')); try { navigator.vibrate?.(20); } catch {}
      tab = 'mine'; await load();
    } catch (e) { toast(e.message, true); }
    busy = false; b.disabled = false; b.textContent = t('add'); $('#text').focus();
  }
  async function del(c) {
    if (!confirm(t('delQ') + '\n\n' + c.text)) return;
    try { await api('/api/blanks/house?id=' + encodeURIComponent(c.id) + '&device=' + encodeURIComponent(device), { method: 'DELETE' }); toast(t('deleted')); await load(); }
    catch (e) { toast(e.message, true); }
  }
  async function importPack(body) {
    try {
      const d = await api('/api/blanks/packs', { method: 'POST', body: JSON.stringify({ ...body, by: $('#name').value.trim() || 'phone' }) });
      toast(t('imported', { name: d.pack.name, p: d.pack.prompts, a: d.pack.answers })); $('#url').value = '';
    } catch (e) { toast(e.message, true); }
  }

  $('#name').value = ls.get('name') || '';
  $('#name').onchange = () => ls.set('name', $('#name').value.trim().slice(0, 24));
  $('#lang').onclick = () => { lang = lang === 'he' ? 'en' : 'he'; ls.set('lang', lang); paintTexts(); };
  document.querySelectorAll('#seg button').forEach((b) => { b.onclick = () => { kind = b.dataset.k; ls.set('blanks.addKind', kind); paintKind(); $('#text').focus(); }; });
  $('#text').oninput = preview;
  $('#blank').onclick = () => {
    const ta = $('#text'), s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
    const before = ta.value.slice(0, s), sp = before && !/\s$/.test(before) ? ' ' : '';
    ta.value = before + sp + '____' + ta.value.slice(e); const p = (before + sp + '____').length;
    ta.focus(); try { ta.setSelectionRange(p, p); } catch {} preview();
  };
  $('#add').onclick = add;
  $('#tMine').onclick = () => { tab = 'mine'; paintList(); };
  $('#tAll').onclick = () => { tab = 'all'; paintList(); };
  $('#fileBtn').onclick = () => $('#file').click();
  $('#file').onchange = () => { const f = $('#file').files && $('#file').files[0]; if (!f) return; if (f.size > 3e6) return toast('3 MB max', true); const rd = new FileReader(); rd.onload = () => importPack({ pack: String(rd.result) }); rd.readAsText(f); $('#file').value = ''; };
  $('#load').onclick = () => { const u = $('#url').value.trim(); if (u) importPack({ url: u }); };
  paintTexts();
  load();
  setInterval(() => { if (!document.hidden) load(); }, 15000);
}

export const ADD_PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#14111c"><meta name="color-scheme" content="dark light">
<title>Fill the Blank · Add cards</title>
<style>${CSS}</style></head>
<body>${BODY}
<script>
const I18N = ${JSON.stringify(I18N)};
(${script.toString()})();
</script>
</body></html>`;
