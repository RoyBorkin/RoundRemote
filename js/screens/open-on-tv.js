// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// "Open on TV" buttons: in the player's options panels, Movies & TV options, item details and library rows.
// Shown only when a TV is set up (any path — js/core/open-on-tv.js) and the service can hand something over.
// The label says what will happen ("Play on Living room" / "Open Spotify on Living room"); with several TVs,
// the last one used is remembered and "Other TV" picks another.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openPanel, curve, spinner, emptyNote, toast, topPanel } from '../ui/overlay.js';
import { tvTargets, lastTv, rememberTv, planner, runPlan, supports, nowPlaying, forEntry } from '../core/open-on-tv.js';

const errMsg = (e) => e?.userMessage || e?.message || 'Something went wrong';

(function css() {
  if (typeof document === 'undefined' || document.querySelector('link[data-ontv]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../css/open-on-tv.css', import.meta.url).href, 'data-ontv': '' }));
})();

// what the plans need from the screen: a toast, and the "it's open now — play there?" offer
const ui = {
  note: (m) => toast(m),
  offer({ text, action, run }) {
    let t = 0;
    document.querySelector('.toast')?.classList.remove('show');   // “Opening …” is done
    const p = openPanel({
      title: 'Open on TV', className: 'opts-panel.ontv-offer',
      build(body, panel) {
        const go = h('button.pill.primary.ontv-go', { type: 'button', onclick: async (e) => {
          e.stopPropagation(); panel.close();
          try { toast(await run()); } catch (err) { toast(errMsg(err), { kind: 'error' }); }
        } }, h('span.ontv-ic', { html: icon('play') }), action);
        body.append(h('div.ontv-offer-ic', { html: icon('toTv') }), h('div.ontv-offer-txt', text), go,
          h('button.pill.ontv-later', { type: 'button', onclick: (e) => { e.stopPropagation(); panel.close(); } }, 'Not now'));
        panel.onDestroy = () => clearTimeout(t);
      },
    });
    t = setTimeout(() => p.close(), 45000);
    return p;
  },
};

async function go(plan, host = null) {
  if (!plan) return;
  host?.close();   // the options panel the button was in: done with it
  toast(plan.verb === 'play' ? `Sending to ${plan.tv.name}…` : `Opening on ${plan.tv.name}…`, { ms: 6000 });
  try { toast(await runPlan(plan, ui), { ms: 3200 }); } catch (e) { toast(errMsg(e), { kind: 'error', ms: 4200 }); }
}

/** Pick the TV: each TV with what would happen there. */
export function openTvPicker(ctx, plan = planner(ctx), tvs = null, host = null) {
  return openPanel({
    title: 'Open on TV', className: 'list-panel.ontv-picker',
    build(body, panel) {
      const list = h('div.list');
      body.append(list);
      curve(list);
      list.append(spinner('Looking for TVs…'));
      (async () => {
        const all = tvs || await tvTargets({ fresh: true });
        const last = lastTv(all);
        const plans = await Promise.all(all.map((g) => plan(g).catch(() => null)));
        list.replaceChildren();
        if (!all.length) { list.append(emptyNote('No TV set up yet — add one under Movies & TV → Google TV, Apple TV or YouTube')); return; }
        all.forEach((g, i) => {
          const p = plans[i];
          const row = h(`button.row.ontv-row${g === last ? '.active' : ''}${p ? '' : '.off'}`, { type: 'button', disabled: !p, dataset: { tv: g.key },
            onclick: (e) => { e.stopPropagation(); if (!p) return; rememberTv(g); panel.close(); go(p, host); } },
          h('div.row-art.placeholder.ontv-art', { html: icon('tv') }),
          h('div.row-text', h('div.row-title', { dir: 'auto' }, g.name),
            h('div.row-sub', p ? `${p.label}${p.how ? ` · ${p.how}` : ''}` : 'Can’t do this on this TV'),
            h('div.row-sub.ontv-paths', g.paths.join(' · '))),
          g === last ? h('span.check', { html: icon('check') }) : null);
          list.append(row);
        });
      })().catch((e) => { list.replaceChildren(emptyNote(errMsg(e))); });
    },
  });
}

/** Open on TV for a context: straight away on the remembered (or only) TV, else the picker first. */
export async function openOnTv(ctx) {
  if (!supports(ctx)) return toast('Nothing to open on the TV here');
  const tvs = await tvTargets();
  if (!tvs.length) return toast('No TV set up yet');
  const plan = planner(ctx);
  const g = lastTv(tvs);
  if (!g) return openTvPicker(ctx, plan, tvs);
  const p = await plan(g).catch(() => null);
  if (!p) return openTvPicker(ctx, plan, tvs);
  return go(p);
}

/**
 * The "Open on TV" button (+ "Other TV" when there are several): hidden until a TV and a way to hand over are found.
 * @param getCtx  () → context (js/core/open-on-tv.js nowPlaying() / forEntry())
 */
export function openOnTvButton(getCtx = nowPlaying, { className = '' } = {}) {
  const wrap = h(`div.ontv${className ? `.${className}` : ''}`, { hidden: true });
  const ctx = getCtx();
  if (!supports(ctx)) return wrap;
  const lbl = h('span.ontv-lbl', 'Open on TV');
  // a primary button in options panels; beside Play in an item's details it's a plain one (Play stays the main action)
  const btn = h(`button.pill${className.includes('ontv-inline') ? '' : '.primary'}.ontv-btn`, { type: 'button' }, h('span.ontv-ic', { html: icon('toTv') }), lbl);
  const other = h('button.chip.ontv-other', { type: 'button', hidden: true }, 'Other TV');
  wrap.append(btn, other);
  const plan = planner(ctx);
  let tvs = [], cur = null, ready = false;
  (async () => {
    tvs = await tvTargets();
    if (!tvs.length) return;
    const last = lastTv(tvs);
    for (const g of last ? [last, ...tvs.filter((x) => x !== last)] : tvs) {
      cur = await plan(g).catch(() => null);
      if (cur) break;
    }
    if (!cur) return;
    // several TVs and none chosen yet: ask which
    lbl.textContent = !last && tvs.length > 1 ? 'Open on TV…' : cur.label;
    btn.title = cur.how ? `${cur.label} · ${cur.how}` : cur.label;
    other.hidden = tvs.length < 2 || !last;   // no TV chosen yet: the button itself asks
    wrap.hidden = false;
    ready = true;
  })().catch(() => {});
  // the panel the button sits in (an options panel), closed once something happens
  const host = () => { const t = topPanel(); return t && wrap.closest('.panel') === t.el ? t : null; };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!ready) return;
    if (!lastTv(tvs) && tvs.length > 1) openTvPicker(ctx, plan, tvs, host());
    else go(cur, host());
  });
  other.addEventListener('click', (e) => { e.stopPropagation(); openTvPicker(ctx, plan, tvs, host()); });
  return wrap;
}

/** A small TV button for a Movies & TV library row (movies, episodes, videos). */
export function openOnTvRowButton(provider, entry) {
  const ctx = forEntry(provider, entry);
  const b = h('span.mrow-tv', { role: 'button', tabindex: '0', 'aria-label': `Open ${entry.title || ''} on TV`, title: 'Open on TV', hidden: true, html: icon('toTv') });
  if (!supports(ctx) || !['movie', 'episode', 'video'].includes(entry.type || 'video')) return b;
  tvTargets().then((tvs) => { if (tvs.length) b.hidden = false; }).catch(() => {});
  const act = (e) => { e.stopPropagation(); e.preventDefault(); openOnTv(ctx).catch((err) => toast(errMsg(err), { kind: 'error' })); };
  b.addEventListener('click', act);
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') act(e); });
  return b;
}
