// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The phone page for Wi-Fi setup (GET /system/wifi): shown by the captive portal when a phone joins the
// "RoundRemote-Setup" hotspot, or opened from the QR code on the round display. Self-contained, English / Hebrew.
export const WIFI_PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#111827">
<title>Round Remote — Wi-Fi setup</title>
<style>
:root{--bg:#0f1220;--card:#1a1f33;--card2:#242a42;--fg:#f3f5fb;--muted:#a8afc6;--dim:#737a93;--line:#30364f;--acc:#6ea8ff;--ok:#34d399;--err:#ff6b7d}
@media (prefers-color-scheme:light){:root{--bg:#f4f6fb;--card:#fff;--card2:#eef1f8;--fg:#141826;--muted:#566079;--dim:#8a93ab;--line:#dde2ee;--acc:#2563eb}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Rubik,Arial,sans-serif}
body{padding:max(16px,env(safe-area-inset-top)) 16px 40px;max-width:520px;margin:0 auto}
button,input{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none}
header{display:flex;align-items:center;gap:12px;margin:6px 2px 18px}
.logo{width:42px;height:42px;border-radius:50%;flex:none;background:conic-gradient(from 210deg,var(--acc),#a78bfa,#f472b6,var(--acc));display:grid;place-items:center}
.logo:after{content:'';width:22px;height:22px;border-radius:50%;background:var(--bg)}
h1{font-size:19px;margin:0;line-height:1.2}
.sub{color:var(--muted);font-size:13px}
.lang{margin-inline-start:auto;padding:6px 12px;border-radius:99px;background:var(--card2);font-weight:700;font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:6px;margin-bottom:14px}
.net{display:flex;align-items:center;gap:12px;width:100%;padding:12px;border-radius:13px;text-align:start}
.net:active,.net.sel{background:var(--card2)}
.net .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;unicode-bidi:plaintext;font-weight:600}
.net .s{font-size:12px;color:var(--dim)}
.bars{width:22px;height:18px;display:flex;align-items:flex-end;gap:2px;flex:none}
.bars i{flex:1;background:var(--line);border-radius:2px}.bars i.on{background:var(--acc)}
.lock{font-size:13px;color:var(--dim)}
.form{padding:10px 8px 8px}
label{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:6px 2px 6px}
.in{width:100%;padding:13px 14px;border-radius:12px;border:1px solid var(--line);background:var(--card2);outline:none;font-size:17px}
.in:focus{border-color:var(--acc)}
.row{display:flex;gap:8px;align-items:center}
.show{padding:10px 12px;border-radius:10px;background:var(--card2);font-size:13px;font-weight:700;flex:none}
.big{width:100%;padding:14px;border-radius:99px;background:var(--acc);color:#fff;font-weight:800;font-size:17px;margin-top:14px}
.big:disabled{opacity:.45}
.link{color:var(--acc);font-weight:700;font-size:14px;padding:10px 4px}
.msg{padding:14px 16px;border-radius:14px;margin-bottom:14px;background:var(--card2);border:1px solid var(--line)}
.msg.ok{border-color:var(--ok)} .msg.err{border-color:var(--err)}
.msg b{display:block;margin-bottom:2px}
.empty{color:var(--dim);text-align:center;padding:18px}
.spin{width:18px;height:18px;border:2.5px solid var(--line);border-top-color:var(--acc);border-radius:50%;animation:s 0.8s linear infinite;display:inline-block;vertical-align:-4px;margin-inline-end:8px}
@keyframes s{to{transform:rotate(1turn)}}
[hidden]{display:none!important}
</style></head>
<body>
<header><div class="logo"></div><div><h1 data-t="title"></h1><div class="sub" data-t="sub"></div></div><button class="lang" id="lang"></button></header>
<div class="msg" id="msg" hidden></div>
<div class="row" style="justify-content:space-between;margin:0 4px 8px"><b data-t="pick"></b><button class="link" id="rescan" data-t="rescan"></button></div>
<div class="card" id="list"><div class="empty"><span class="spin"></span><span data-t="looking"></span></div></div>
<div class="card form" id="form" hidden>
  <div id="hiddenBox" hidden><label for="ssid" data-t="name"></label><input class="in" id="ssid" maxlength="32" autocomplete="off" autocapitalize="off" spellcheck="false" dir="auto"></div>
  <label for="pw" id="pwLabel"></label>
  <div class="row"><input class="in" id="pw" type="password" maxlength="64" autocomplete="off" autocapitalize="off" spellcheck="false" dir="ltr"><button class="show" id="show" data-t="show"></button></div>
  <button class="big" id="go" data-t="connect"></button>
</div>
<button class="link" id="hidden" data-t="hiddenNet"></button>
<script>
(() => {
const $ = (s) => document.querySelector(s);
const T = {
  en: { title: 'Round Remote Wi-Fi', sub: 'Connect the round display to your home Wi-Fi', pick: 'Choose your network', rescan: 'Scan again',
    looking: 'Looking for networks…', none: 'No networks found — tap Scan again', name: 'Network name', pwFor: (n) => 'Password for ' + n,
    pwOpen: 'Password (leave empty for an open network)', show: 'Show', hide: 'Hide', connect: 'Connect', hiddenNet: 'Hidden network…',
    open: 'Open', saved: 'Saved', connecting: 'Connecting…',
    goingOff: (n) => 'The display is joining “' + n + '”. This setup network turns off now — your phone goes back to its usual Wi-Fi.',
    after: 'If the round display shows the new network, you are done. If “RoundRemote-Setup” comes back, the password was wrong: join it again and retry.',
    ok: (n) => 'Connected to “' + n + '” ✓', bad: (n, e) => 'Couldn’t join “' + n + '”: ' + e, short: 'Wi-Fi passwords have at least 8 characters',
    offline: 'Can’t reach the display — are you still on RoundRemote-Setup?', wrong: 'Wrong password' },
  he: { title: 'Wi-Fi לשלט העגול', sub: 'חיבור המסך העגול לרשת הביתית', pick: 'בחרו רשת', rescan: 'סריקה מחדש',
    looking: 'מחפש רשתות…', none: 'לא נמצאו רשתות — הקישו סריקה מחדש', name: 'שם הרשת', pwFor: (n) => 'הסיסמה של ' + n,
    pwOpen: 'סיסמה (ריק לרשת פתוחה)', show: 'הצג', hide: 'הסתר', connect: 'התחברות', hiddenNet: 'רשת מוסתרת…',
    open: 'פתוחה', saved: 'שמורה', connecting: 'מתחבר…',
    goingOff: (n) => 'המסך מתחבר אל „' + n + '”. רשת ההגדרה נכבית עכשיו — הטלפון יחזור לרשת הרגילה שלו.',
    after: 'אם המסך העגול מציג את הרשת החדשה — סיימתם. אם „RoundRemote-Setup” חוזרת, הסיסמה הייתה שגויה: התחברו אליה שוב ונסו שוב.',
    ok: (n) => 'מחובר אל „' + n + '” ✓', bad: (n, e) => 'לא הצלחנו להתחבר אל „' + n + '”: ' + e, short: 'סיסמת Wi-Fi היא לפחות 8 תווים',
    offline: 'אין חיבור למסך — האם הטלפון עדיין מחובר ל-RoundRemote-Setup?', wrong: 'סיסמה שגויה' },
};
let lang = (() => { try { return localStorage.getItem('rrwifi.lang'); } catch { return null; } })() || (/^he\\b/i.test(navigator.language || '') ? 'he' : 'en');
let nets = [], sel = null, hiddenMode = false;
const t = (k, ...a) => { const v = T[lang][k]; return typeof v === 'function' ? v(...a) : v; };
function paintLang() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  $('#lang').textContent = lang === 'he' ? 'English' : 'עברית';
  paintList(); paintForm();
}
$('#lang').onclick = () => { lang = lang === 'he' ? 'en' : 'he'; try { localStorage.setItem('rrwifi.lang', lang); } catch {} paintLang(); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const secure = (n) => !!(n.security && !/^(open|none|--)$/i.test(n.security));
function bars(s) { const n = s >= 75 ? 4 : s >= 50 ? 3 : s >= 25 ? 2 : 1; return '<span class="bars">' + [1, 2, 3, 4].map((i) => '<i class="' + (i <= n ? 'on' : '') + '" style="height:' + (i * 25) + '%"></i>').join('') + '</span>'; }
function paintList() {
  const el = $('#list');
  if (!nets) return;
  if (!nets.length) { el.innerHTML = '<div class="empty">' + esc(t('none')) + '</div>'; return; }
  el.innerHTML = nets.map((n, i) => '<button class="net' + (sel === n && !hiddenMode ? ' sel' : '') + '" data-i="' + i + '">' + bars(n.signal || 0) +
    '<span class="n" dir="auto">' + esc(n.ssid) + '</span><span class="s">' + esc([n.saved ? t('saved') : '', secure(n) ? '' : t('open')].filter(Boolean).join(' · ')) + '</span>' +
    (secure(n) ? '<span class="lock">🔒</span>' : '') + '</button>').join('');
  el.querySelectorAll('.net').forEach((b) => { b.onclick = () => { sel = nets[+b.dataset.i]; hiddenMode = false; paintList(); paintForm(); $('#pw').focus(); }; });
}
function paintForm() {
  const show = hiddenMode || !!sel;
  $('#form').hidden = !show;
  $('#hiddenBox').hidden = !hiddenMode;
  $('#pwLabel').textContent = hiddenMode || (sel && !secure(sel)) ? t('pwOpen') : sel ? t('pwFor', sel.ssid) : '';
  $('#pw').parentElement.hidden = !hiddenMode && sel && !secure(sel);
}
function msg(kind, title, text) {
  const m = $('#msg'); m.hidden = !title; m.className = 'msg ' + (kind || '');
  m.innerHTML = '<b>' + esc(title || '') + '</b>' + (text ? '<span>' + esc(text) + '</span>' : '');
  if (title) m.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function api(path, body) {
  const r = await fetch('/api/system/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || ('HTTP ' + r.status)), { body: j });
  return j;
}
async function scan() {
  nets = null; $('#list').innerHTML = '<div class="empty"><span class="spin"></span>' + esc(t('looking')) + '</div>';
  try { nets = (await api('wifi/scan')).networks || []; } catch { nets = []; msg('err', t('offline')); }
  paintList();
}
$('#rescan').onclick = scan;
$('#hidden').onclick = () => { hiddenMode = true; sel = null; paintList(); paintForm(); $('#ssid').focus(); };
$('#show').onclick = () => { const p = $('#pw'); p.type = p.type === 'password' ? 'text' : 'password'; $('#show').textContent = t(p.type === 'password' ? 'show' : 'hide'); };
$('#go').onclick = async () => {
  const ssid = hiddenMode ? $('#ssid').value.trim() : sel?.ssid;
  const password = $('#pw').value;
  if (!ssid) return;
  if (password && password.length < 8) { msg('err', t('short')); return; }
  $('#go').disabled = true; $('#go').innerHTML = '<span class="spin"></span>' + esc(t('connecting'));
  try {
    const r = await api('wifi/connect', { ssid, ...(password ? { password } : {}), ...(hiddenMode ? { hidden: true } : {}) });
    if (r.pending) msg('ok', t('goingOff', ssid), t('after'));
    else if (r.ok) msg('ok', t('ok', ssid));
    else msg('err', t('bad', ssid, r.code === 'wrong-password' ? t('wrong') : r.error || ''));
  } catch (e) {
    if (e.body) msg('err', t('bad', ssid, e.body.code === 'wrong-password' ? t('wrong') : e.message));
    else msg('ok', t('goingOff', ssid), t('after'));   // the hotspot went down before the answer arrived
  }
  $('#go').disabled = false; $('#go').textContent = t('connect');
};
(async () => {
  paintLang();
  try {
    const w = await api('wifi');
    const a = w.lastAttempt;
    if (a && Date.now() - a.at < 10 * 60000 && !a.ok) msg('err', t('bad', a.ssid, a.code === 'wrong-password' ? t('wrong') : a.error || ''));
  } catch {}
  scan();
})();
})();
</script>
</body></html>`;

/** What the captive portal answers on port 80 (redirected there by the helper's nftables rule). */
export function captiveRedirect(url) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${url}"><title>Round Remote setup</title></head>
<body style="font:18px system-ui,sans-serif;padding:24px"><a href="${url}">Set up Round Remote Wi-Fi →</a></body></html>`;
}
