// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Movie Night (apps/movienight.js): the display shows a shortlist of 3–5 movies or shows; guests scan the QR code
// and vote on their phones (one vote each, or rank their top three). The display keeps the tally and reveals the
// winner. Routes: see lib/party.js (GET /movienight?r=<room>, /api/movienight/…).
import { partyApp, phonePage, HttpErr, str } from './party.js';

function accept(room, act) {
  if (act.type === 'join') return {};
  if (act.type !== 'vote') throw new HttpErr(400, 'unknown action');
  const st = room.state;
  if (!st || st.phase !== 'vote') throw new HttpErr(409, st?.phase === 'setup' ? 'Voting hasn’t started yet' : 'Voting is closed');
  const ids = new Set((st.cands || []).map((c) => c.id));
  const max = st.mode === 'rank' ? Math.min(3, ids.size) : 1;
  const pick = [...new Set((Array.isArray(act.pick) ? act.pick : []).map((x) => str(x, 40)))].filter((x) => ids.has(x)).slice(0, max);
  act.pick = pick;
  return {};
}

function personalize(s, device) {
  if (!s) return null;
  const { votes, ...rest } = s;
  return { ...rest, my: votes?.[device] || [] };
}

const I18N = {
  en: { title: 'Movie Night', setup: 'The host is picking tonight’s movies…', setupSub: 'Keep this page open — voting starts soon.',
    voteOne: 'Tap the one you want to watch', voteRank: 'Tap your favourites in order — 1st, 2nd, 3rd', sent: 'Your vote is in ✓', sentSub: 'You can change it until the host reveals the winner.',
    reset: 'Start over', count: '{n} voted so far', reveal: 'Drumroll… 🥁', revealSub: 'Look at the big screen!', winner: 'Tonight we’re watching', enjoy: 'Enjoy the movie! 🍿',
    started: 'The movie is starting — phones on silent 🤫', closed: 'Voting is closed', points: '{n} pts', rank1: '1st', rank2: '2nd', rank3: '3rd', tie: 'It was a tie — the wheel decided' },
  he: { title: 'ערב סרט', setup: 'המארח בוחר את הסרטים להערב…', setupSub: 'השאירו את הדף פתוח — ההצבעה תתחיל בקרוב.',
    voteOne: 'געו בסרט שאתם רוצים לראות', voteRank: 'געו במועדפים לפי הסדר — 1, 2, 3', sent: 'ההצבעה נקלטה ✓', sentSub: 'אפשר לשנות עד שהמארח יחשוף את הזוכה.',
    reset: 'מההתחלה', count: '{n} הצביעו עד עכשיו', reveal: 'תופים… 🥁', revealSub: 'הסתכלו על המסך הגדול!', winner: 'הערב אנחנו רואים', enjoy: 'צפייה מהנה! 🍿',
    started: 'הסרט מתחיל — טלפונים על שקט 🤫', closed: 'ההצבעה נסגרה', points: '{n} נק׳', rank1: '1', rank2: '2', rank3: '3', tie: 'היה תיקו — הגלגל הכריע' },
};

const CSS = `
:root{--on-c:#1a1405}
.msg{text-align:center;padding:26px 12px}.msg .big-e{font-size:54px;line-height:1;margin-bottom:10px}.msg h2{margin:0 0 6px;font-size:21px}.msg p{margin:0;color:var(--muted)}
.lead{font-weight:800;font-size:17px;margin:4px 4px 12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.mv{position:relative;border-radius:18px;overflow:hidden;background:var(--card);border:2px solid var(--line);text-align:start;padding:0;transition:transform .15s,border-color .2s}
.mv:active{transform:scale(.97)}
.mv .po{aspect-ratio:2/3;background:var(--card2) center/cover;display:flex;align-items:flex-end;padding:10px;font-weight:800;font-size:17px;line-height:1.15;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.6)}
.mv .po.noart{background:linear-gradient(160deg,var(--k),color-mix(in srgb,var(--k) 35%,#000))}
.mv .cap{padding:8px 10px 10px}.mv .cap b{display:block;font-size:15px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mv .cap span{font-size:12px;color:var(--muted)}
.mv.on{border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 35%,transparent)}
.mv .badge{position:absolute;top:8px;inset-inline-end:8px;min-width:38px;height:38px;border-radius:99px;background:var(--c);color:#1a1405;font-weight:900;font-size:16px;display:grid;place-items:center;padding:0 8px;box-shadow:0 3px 12px rgba(0,0,0,.35)}
.mv .pts{position:absolute;top:8px;inset-inline-start:8px;padding:4px 9px;border-radius:99px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;font-weight:800}
.status{display:flex;align-items:center;gap:10px;justify-content:space-between;margin:14px 2px 0;color:var(--muted);font-size:14px}
.status b{color:var(--ok)}
.win{text-align:center;padding:10px 0}.win .po{width:62%;margin:12px auto;aspect-ratio:2/3;border-radius:20px;background:var(--card2) center/cover;box-shadow:0 12px 40px rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;padding:14px;font-weight:900;font-size:22px;color:#fff;animation:zoom .6s cubic-bezier(.34,1.56,.64,1)}
.win .po.noart{background:linear-gradient(160deg,var(--c),#3b2a05)}
.win h2{font-size:26px;margin:6px 0 2px}.win .k{color:var(--c);font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:13px}.win p{color:var(--muted);margin:6px 0}
@keyframes zoom{from{transform:scale(.6);opacity:0}}
.drum{font-size:70px;text-align:center;animation:drum .25s ease-in-out infinite alternate;margin:30px 0 10px}@keyframes drum{to{transform:rotate(-8deg) scale(1.08)}}
`;

const BODY = `
<div class="hi"><span data-t="hi"></span> <b id="who" dir="auto"></b><button id="rename" data-t="change"></button></div>
<div id="view"></div>
`;

function script() {
  const { $, t, el } = P;
  let pick = [], dirty = false, sendT = 0;
  const poster = (c, cls) => { const d = el('div', { class: 'po' + (c.art ? '' : ' noart') + (cls ? ' ' + cls : ''), '--k': c.color || '#eab308' }); if (c.art) d.style.backgroundImage = 'url("' + c.art.replace(/"/g, '%22') + '")'; else d.textContent = c.title; return d; };
  function draw() {
    const v = P.view, box = $('#view'); box.textContent = '';
    if (!v || v.phase === 'setup' || !v.cands) { box.append(el('div', { class: 'card msg' }, el('div', { class: 'big-e', text: '🎬' }), el('h2', { text: t('setup') }), el('p', { text: t('setupSub') }))); return; }
    if (!dirty) pick = (v.my || []).slice();
    if (v.phase === 'reveal') { box.append(el('div', { class: 'drum', text: '🥁' }), el('div', { class: 'msg' }, el('h2', { text: t('reveal') }), el('p', { text: t('revealSub') }))); return; }
    if (v.phase === 'winner' || v.phase === 'started') {
      const w = v.cands.find((c) => c.id === v.winner) || v.cands[0];
      box.append(el('div', { class: 'card win' }, el('div', { class: 'k', text: t('winner') }), poster(w), el('h2', { dir: 'auto', text: w.title }),
        el('p', { text: [w.year, w.sub].filter(Boolean).join(' · ') }), v.tie ? el('p', { text: t('tie') }) : null, el('p', { text: v.phase === 'started' ? t('started') : t('enjoy') })));
      if (v.tally) {
        const g = el('div', { class: 'grid' });
        for (const c of v.cands.slice().sort((a, b) => (v.tally[b.id] || 0) - (v.tally[a.id] || 0))) {
          const b = el('div', { class: 'mv' + (c.id === v.winner ? ' on' : '') }, poster(c), el('span', { class: 'pts', text: t('points', { n: v.tally[c.id] || 0 }) }), el('div', { class: 'cap' }, el('b', { dir: 'auto', text: c.title })));
          g.append(b);
        }
        box.append(g);
      }
      return;
    }
    const rank = v.mode === 'rank';
    box.append(el('div', { class: 'lead', text: rank ? t('voteRank') : t('voteOne') }));
    const g = el('div', { class: 'grid' });
    for (const c of v.cands) {
      const i = pick.indexOf(c.id);
      const b = el('button', { class: 'mv' + (i >= 0 ? ' on' : ''), onclick: () => tap(c.id) }, poster(c),
        el('div', { class: 'cap' }, el('b', { dir: 'auto', text: c.title }), el('span', { text: [c.year, c.sub].filter(Boolean).join(' · ') })),
        i >= 0 ? el('span', { class: 'badge', text: rank ? t('rank' + (i + 1)) : '✓' }) : null,
        v.tally ? el('span', { class: 'pts', text: t('points', { n: v.tally[c.id] || 0 }) }) : null);
      g.append(b);
    }
    box.append(g);
    const mine = (v.my || []).length > 0 && !dirty;
    box.append(el('div', { class: 'status' }, el('span', {}, mine ? el('b', { text: t('sent') }) : '', ' ', t('count', { n: v.voted || 0 })),
      rank && pick.length ? el('button', { class: 'ghost', text: t('reset'), onclick: () => { pick = []; dirty = true; draw(); send(); } }) : null));
    if (mine) box.append(el('p', { class: 'sub', style: 'margin:6px 4px', text: t('sentSub') }));
  }
  function tap(id) {
    const v = P.view; const rank = v.mode === 'rank';
    const max = rank ? Math.min(3, v.cands.length) : 1;
    const i = pick.indexOf(id);
    if (i >= 0) pick.splice(i, 1); else if (rank) { if (pick.length < max) pick.push(id); } else pick = [id];
    dirty = true; P.vibrate(12); draw(); send();
  }
  function send() {
    clearTimeout(sendT);
    sendT = setTimeout(async () => {
      try { await P.act('vote', { pick }); dirty = false; P.beep(784, 0.07); } catch (e) { P.toast(e.message, true); dirty = false; }
      draw();
    }, 250);
  }
  P.on('state', draw);
  P.on('render', draw);
}

const PAGE = phonePage({ app: 'movienight', title: 'Movie Night', color: '#eab308', glyph: '🎬', css: CSS, body: BODY, i18n: I18N, script });
export const route = partyApp({ name: 'movienight', page: PAGE, personalize, accept });
