// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Spotify sign-in started on a phone that is setting up a round display (bridge/lib/setup.js → /setup).
// Spotify only redirects to https addresses (or http://127.0.0.1), so the phone's sign-in comes back to this app's own
// registered address (e.g. https://royborkin.github.io/RoundSpotify/) with state "rrsetup.<…>". This tiny classic
// script runs before the app and passes the code straight on to the phone's setup page on the home network, which
// hands it to the display. It only ever forwards to a local-network address.
(function () {
  try {
    var q = new URLSearchParams(location.search);
    var st = q.get('state') || '';
    if (st.indexOf('rrsetup.') !== 0) return;
    var b = st.slice(8).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var o = new URL(JSON.parse(atob(b)).o);
    var h = o.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    var local = h === 'localhost' || /\.(local|lan|home\.arpa)$/.test(h) || h.indexOf('.') < 0 && h.indexOf(':') < 0
      || /^(127|10)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)
      || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) || h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
    if (!/^https?:$/.test(o.protocol) || !local) return;
    var t = new URL('/setup', o.origin);
    ['code', 'error', 'state'].forEach(function (k) { if (q.get(k)) t.searchParams.set('sp_' + k, q.get(k)); });
    window.__rrHandoff = true;
    document.documentElement.style.visibility = 'hidden';
    location.replace(t.href);
  } catch (e) { /* not ours */ }
})();
