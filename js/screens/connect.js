// Per-service sign-in / setup screen. Each service signs in once; tokens are remembered.
import { h, badge, iconBtn, onCircle, clear } from '../ui/dom.js';
import { field } from '../ui/keyboard.js';
import { toast } from '../ui/overlay.js';
import { getService, provider } from '../providers/registry.js';
import { bridgeInfo, bridgeBase, bridgeFetch, bridgeZones, isAppleZone } from '../providers/bridge.js';
import { redirectUri } from '../providers/spotify.js';
import { googleSignIn, googleSignOut, googleSignedIn } from '../core/youtube.js';
import { openService } from '../core/nav.js';
import { player } from '../core/player.js';
import { store } from '../core/store.js';
import { go } from '../core/router.js';

const err = (e) => e?.userMessage || e?.message || String(e);
const btn = (label, onClick, cls = '') => h(`button.pill${cls ? '.' + cls : ''}`, { type: 'button', onclick: onClick }, label);

const BRIDGE_TIPS = {
  roon: 'In Roon: Settings → Extensions → enable “Round Remote”.',
  cast: 'Cast devices on the same network appear automatically.',
  airplay: 'Install shairport-sync on the Pi (pi/setup.sh does it). Then pick “Round Display” as the AirPlay speaker on your phone or Mac.',
  androidtv: 'Google TV / Android TV: pair once with the code the TV shows.',
  upnp: 'UPnP/DLNA renderers on the same network appear automatically.',
  tidal: 'Play TIDAL through Roon, cast it from the TIDAL app, or send it to a UPnP renderer / AirPlay — this tile follows it.',
  qobuz: 'Play Qobuz through Roon, cast it from the Qobuz app, or send it to a UPnP renderer / AirPlay — this tile follows it.',
};

export function ConnectScreen({ id }) {
  const svc = getService(id);
  const p = provider(id);
  const body = h('div.connect-body');
  const back = onCircle(iconBtn('back', 'Back', () => go('home')), 0, 42);
  const el = h('div.connect', { '--c': svc.color }, h('div.connect-glow'), back, body);
  let abort = null;

  const header = () => [badge(svc, 'lg'), h('h1', svc.name), h('p.blurb', svc.blurb)];
  const status = h('div.status-line');
  const setStatus = (msg, kind = '') => { status.className = `status-line ${kind}`; status.textContent = msg; };
  const done = () => { toast(`${svc.name} connected`); openService(id); };
  const signedIn = () => p.isAuthed() && !p.setupHint();

  function signedInActions() {
    return h('div.actions',
      btn('Open remote', () => openService(id), 'primary'),
      btn('Sign out', async () => { await p.signOut(); if (player.provider === p) player.release(); render(); toast('Signed out'); }));
  }

  function render() {
    abort?.abort(); abort = null;
    clear(body);
    body.append(...header());
    const kind = svc.kind;
    if (id === 'demo') { body.append(h('div.actions', btn('Start demo', () => openService(id), 'primary'))); return; }
    if (id === 'androidtv') return renderAndroidTv();
    if (kind === 'bridge') return renderBridge();
    if (kind === 'youtube') return renderYouTube();
    if (id === 'spotify') return renderSpotify();
    if (id === 'apple') return renderApple();
    if (id === 'plex') return renderPlex();
    if (id === 'jellyfin') return renderJellyfin();
  }

  function renderSpotify() {
    const f = field({ label: 'Client ID', value: store.get('spotifyClientId'), placeholder: 'from developer.spotify.com', onChange: (v) => store.set('spotifyClientId', v) });
    body.append(f,
      h('div.note', 'Add this Redirect URI to your Spotify app:'),
      h('code.uri', redirectUri()));
    if (signedIn()) {
      const scope = store.auth('spotify')?.scope || '';
      if (store.get('spotifyWebPlayer') && !/\bstreaming\b/.test(scope)) {
        body.append(h('div.note', 'Sign in once more to also use this display as a Spotify speaker.'),
          h('div.actions', btn('Sign in again', () => p.connect().catch((e) => setStatus(err(e), 'error')))));
      }
      body.append(signedInActions(), status);
      return;
    }
    body.append(h('div.note.dim', 'Remote control needs Spotify Premium. In the developer dashboard, add your account under User Management.'));
    body.append(h('div.actions', btn('Sign in with Spotify', async () => {
      store.set('spotifyClientId', f.querySelector('input').value.trim());
      try { await p.connect(); } catch (e) { setStatus(err(e), 'error'); }
    }, 'primary')), status);
  }

  function renderYouTube() {
    const key = field({ label: 'YouTube Data API key', value: store.get('youtubeApiKey'), secret: true, placeholder: 'AIza…', onChange: (v) => store.set('youtubeApiKey', v) });
    const cid = field({ label: 'Google OAuth Client ID (optional)', value: store.get('googleClientId'), placeholder: '…apps.googleusercontent.com', onChange: (v) => store.set('googleClientId', v) });
    const save = () => {
      store.set('youtubeApiKey', key.querySelector('input').value.trim());
      store.set('googleClientId', cid.querySelector('input').value.trim());
    };
    body.append(key, cid,
      h('div.note.dim', 'The API key is free (Google Cloud → YouTube Data API v3) — see the README. The Client ID only adds your own playlists.'));
    const actions = h('div.actions', btn('Open remote', () => { save(); if (p.setupHint()) setStatus(p.setupHint(), 'error'); else openService(id); }, 'primary'));
    if (googleSignedIn()) actions.append(btn('Sign out of Google', () => { googleSignOut(); render(); toast('Signed out'); }));
    else actions.append(btn('Sign in with Google', async () => {
      save();
      try { await googleSignIn(); toast('Signed in with Google'); render(); } catch (e) { setStatus(err(e), 'error'); }
    }));
    body.append(actions, status);

    // YouTube app on a TV (Google TV / Android TV / smart TV / console), via the bridge.
    const tvStatus = h('div.status-line');
    const tvList = h('div.stack');
    const tvCode = field({ label: 'TV code', placeholder: '123 456 789 012' });
    const bridgeErr = (e) => e?.body?.error || err(e);
    const loadTvs = async () => {
      clear(tvList);
      try {
        const tvs = await bridgeFetch('/api/adapters/youtubetv/list');
        for (const t of tvs || []) {
          tvList.append(h('div.actions', h('span.note', `📺 ${t.name}`),
            btn('Control', () => { store.setZone(id, t.id); openService(id); }, 'primary'),
            btn('Unlink', async () => { await bridgeFetch('/api/adapters/youtubetv/unpair', { method: 'POST', json: { id: t.id } }).catch(() => {}); if (store.getZone(id) === t.id) store.setZone(id, null); loadTvs(); })));
        }
      } catch (e) { tvStatus.className = 'status-line warn'; tvStatus.textContent = 'Start the bridge (start-bridge.bat) to link a TV.'; }
    };
    body.append(
      h('div.section', 'YouTube on your TV'),
      h('div.note', 'On the TV open YouTube → Settings → “Link with TV code”, then enter the code here. Needs the bridge running on a computer (start-bridge.bat) or the Pi.'),
      tvCode,
      h('div.actions', btn('Link TV', async () => {
        tvStatus.className = 'status-line'; tvStatus.textContent = 'Linking…';
        try {
          const r = await bridgeFetch('/api/adapters/youtubetv/pair', { method: 'POST', json: { code: tvCode.querySelector('input').value } });
          store.setZone(id, r.id);
          tvStatus.className = 'status-line ok'; tvStatus.textContent = `Linked ${r.name}`;
          toast(`Linked ${r.name}`); loadTvs();
        } catch (e) { tvStatus.className = 'status-line error'; tvStatus.textContent = bridgeErr(e); }
      })),
      tvStatus, tvList,
    );
    loadTvs();
  }

  function renderApple() {
    // Option 1: Apple Music on a computer (Cider, Sidra, the Windows app) through the bridge — no token needed
    const pcList = h('div.stack');
    const pcStatus = h('div.status-line');
    const loadPcs = async () => {
      clear(pcList);
      if (!(await bridgeInfo())) { pcStatus.className = 'status-line warn'; pcStatus.textContent = 'Start the bridge (start-bridge.bat) on the computer that plays Apple Music.'; return; }
      const zs = await bridgeZones(isAppleZone);
      pcStatus.className = 'status-line'; pcStatus.textContent = zs.length ? '' : 'Nothing found yet — open Cider, Sidra or the Apple Music app and play something.';
      for (const z of zs) {
        pcList.append(h('div.actions', h('span.note', `💻 ${z.name}${z.state?.track ? ` — ${z.state.track.title}` : ''}`),
          btn('Control', () => { store.setZone(id, z.id); openService(id); }, 'primary')));
      }
    };
    body.append(
      h('div.section', 'Apple Music on your computer'),
      h('div.note', 'No developer token needed: play Apple Music in Cider (Windows, Mac, Linux), Sidra (Linux / Pi) or the Apple Music app for Windows, with the bridge running on that computer.'),
      pcList, pcStatus, h('div.actions', btn('Look again', loadPcs)),
      h('div.section', 'Or play it on this display (MusicKit)'),
    );
    loadPcs();
    // Option 2: MusicKit in this browser (needs a developer token)
    const f = field({ label: 'Developer token (JWT)', value: store.get('appleDeveloperToken'), secret: true, placeholder: 'or let the bridge create it', onChange: (v) => store.set('appleDeveloperToken', v) });
    body.append(f);
    if (store.auth('apple')?.authorized) { body.append(signedInActions()); return; }
    body.append(h('div.actions', btn('Sign in with Apple Music', async () => {
      store.set('appleDeveloperToken', f.querySelector('input').value.trim());
      setStatus('Opening Apple sign-in…');
      try { await p.connect(); done(); } catch (e) { setStatus(err(e), 'error'); }
    }, 'primary')), status);
  }

  function showCode(code, line1, line2) {
    return h('div.code-box', h('div.code', code), h('div.note', line1), line2 ? h('div.note.dim', line2) : null, h('div.spin'));
  }

  function renderPlex() {
    if (signedIn()) { body.append(signedInActions()); return; }
    const area = h('div.stack');
    body.append(area, status);
    area.append(h('div.actions',
      btn('Link with a code', async () => {
        try {
          const { id: pinId, code } = await p.pinStart(false);
          clear(area).append(showCode(code, 'On your phone, open plex.tv/link', 'and enter this code'), btn('Cancel', render));
          abort = new AbortController();
          if (await p.pinWait(pinId, abort.signal)) done();
        } catch (e) { setStatus(err(e), 'error'); }
      }, 'primary'),
      btn('Sign in here', () => p.connect().catch((e) => setStatus(err(e), 'error')))));
  }

  function renderJellyfin() {
    const srv = field({ label: 'Server address', value: store.get('jellyfinServer'), placeholder: 'http://192.168.1.20:8096', onChange: (v) => store.set('jellyfinServer', v.replace(/\/$/, '')) });
    body.append(srv);
    if (signedIn()) { body.append(signedInActions()); return; }
    const area = h('div.stack');
    body.append(area, status);
    const saveServer = () => {
      let v = srv.querySelector('input').value.trim().replace(/\/$/, '');
      if (v && !/^https?:\/\//.test(v)) v = 'http://' + v;
      store.set('jellyfinServer', v);
      srv.querySelector('input').value = v;
      if (!v) throw new Error('Enter your server address first');
    };
    area.append(h('div.actions',
      btn('Quick Connect', async () => {
        try {
          saveServer();
          setStatus('');
          const { code, secret } = await p.quickConnectStart();
          clear(area).append(showCode(code, 'In Jellyfin: Profile → Quick Connect', 'enter this code to approve'), btn('Cancel', render));
          abort = new AbortController();
          if (await p.quickConnectWait(secret, abort.signal)) done();
        } catch (e) { setStatus(e.status === 401 ? 'Quick Connect is disabled on this server' : err(e), 'error'); }
      }, 'primary'),
      btn('Username & password', () => {
        try { saveServer(); } catch (e) { setStatus(err(e), 'error'); return; }
        let user = '', pass = '';
        clear(area).append(
          field({ label: 'Username', onChange: (v) => (user = v) }),
          field({ label: 'Password', secret: true, onChange: (v) => (pass = v) }),
          h('div.actions', btn('Sign in', async () => {
            user = area.querySelectorAll('input')[0].value.trim(); pass = area.querySelectorAll('input')[1].value;
            setStatus('Signing in…');
            try { await p.login(user, pass); done(); } catch (e) { setStatus(e.status === 401 ? 'Wrong username or password' : err(e), 'error'); }
          }, 'primary'), btn('Back', render)));
      })));
  }

  // Google TV / Android TV: pair once with the code the TV shows (Android TV Remote protocol, via the bridge)
  async function renderAndroidTv() {
    body.append(status);
    setStatus('Looking for the bridge…');
    const info = await bridgeInfo();
    if (!info) { clear(body); body.append(...header()); return renderBridge(); }
    const a = info.adapters?.androidtv;
    if (!a?.enabled) setStatus(a?.status?.startsWith('not installed') ? 'The Google TV add-on isn’t installed in the bridge yet: in the bridge folder run  npm run androidtv  (start-bridge.bat does it for you), then restart the bridge.' : `Google TV is ${a?.status || 'disabled'} in the bridge.`, 'warn');
    else setStatus(a.status || '', 'ok');
    const bridgeErr = (e) => e?.body?.error || err(e);
    const tvList = h('div.stack'), found = h('div.stack'), pairArea = h('div.stack');
    const pairStatus = h('div.status-line');
    const say = (text, kind = '') => { pairStatus.className = `status-line${kind ? ' ' + kind : ''}`; pairStatus.textContent = text; };

    const loadTvs = async () => {
      clear(tvList);
      try {
        const tvs = await bridgeFetch('/api/adapters/androidtv/list');
        if (tvs?.length) tvList.append(h('div.section', 'Your TVs'));
        for (const t of tvs || []) {
          tvList.append(h('div.actions', h('span.note', `${t.connected ? '●' : '○'} ${t.name}`),
            btn('Control', () => { store.setZone(id, t.id); openService(id); }, 'primary'),
            btn('Forget', async () => { await bridgeFetch('/api/adapters/androidtv/unpair', { method: 'POST', json: { host: t.host } }).catch(() => {}); if (store.getZone(id) === t.id) store.setZone(id, null); loadTvs(); })));
        }
      } catch {}
    };

    const startPair = async (host, name) => {
      host = String(host || '').trim();
      if (!host) { say('Enter the TV’s IP address', 'error'); return; }
      clear(pairArea);
      say(`Connecting to ${name || host}… (the TV has to be on)`);
      try {
        await bridgeFetch('/api/adapters/androidtv/pair', { method: 'POST', json: { host, name } });
      } catch (e) { say(bridgeErr(e), 'error'); return; }
      say('Enter the 6-character code shown on the TV', 'ok');
      const code = field({ label: 'Code on the TV', placeholder: 'A1B2C3' });
      pairArea.append(code, h('div.actions', btn('Pair', async () => {
        say('Pairing…');
        try {
          const r = await bridgeFetch('/api/adapters/androidtv/code', { method: 'POST', json: { host, code: code.querySelector('input').value } });
          store.setZone(id, r.id);
          clear(pairArea); say(`Paired ${r.name}`, 'ok'); toast(`Paired ${r.name}`); loadTvs();
        } catch (e) { say(bridgeErr(e), 'error'); }
      }, 'primary'), btn('Cancel', () => { clear(pairArea); say(''); })));
    };

    const search = async () => {
      clear(found); found.append(h('div.note.dim', 'Searching the network…'));
      try {
        const list = await bridgeFetch('/api/adapters/androidtv/discover');
        clear(found);
        if (!list?.length) { found.append(h('div.note.dim', 'No TV found — type its IP address below (TV Settings → Network → About).')); return; }
        for (const t of list) found.append(h('div.actions', h('span.note', `📺 ${t.name}`), t.paired ? h('span.note.dim', 'paired') : btn('Pair', () => startPair(t.host, t.name), 'primary')));
      } catch (e) { clear(found); found.append(h('div.note.dim', bridgeErr(e))); }
    };

    const ip = field({ label: 'TV IP address', placeholder: '192.168.1.50' });
    body.append(
      tvList,
      h('div.section', 'Add a TV'),
      h('div.actions', btn('Search the network', search)), found,
      ip, h('div.actions', btn('Pair by IP', () => startPair(ip.querySelector('input').value))),
      pairStatus, pairArea,
      h('div.note.dim', 'For the song or video playing in YouTube on the TV, also link it under YouTube → “YouTube on your TV”.'),
    );
    loadTvs();
    if (a?.enabled) search();
  }

  async function renderBridge() {
    const adapter = ['tidal', 'qobuz'].includes(id) ? null : id;
    body.append(h('div.note', BRIDGE_TIPS[id] || ''), status);
    setStatus('Looking for the bridge…');
    const bf = field({ label: 'Bridge address', value: store.get('bridgeUrl'), placeholder: 'auto (http://localhost:8765)', onChange: async (v) => { store.set('bridgeUrl', v.replace(/\/$/, '')); await bridgeBase({ force: true }); render(); } });
    const info = await bridgeInfo();
    if (!info) {
      setStatus('Bridge not found.', 'error');
      body.append(
        h('div.note', 'This service talks to devices on your home network, which a web page can’t reach on its own. Run the small bridge on this computer (or the Pi):'),
        h('code.uri', 'Windows: double-click start-bridge.bat\nMac/Linux: ./start-bridge.sh'),
        h('div.note.dim', 'Needs Node.js. Chrome will ask to allow access to your local network — choose Allow.'),
        h('div.actions', btn('Try again', async () => { await bridgeBase({ force: true }); render(); }), store.get('showDemo') ? btn('Try the Demo', () => openService('demo')) : null),
      );
    } else {
      const base = await bridgeBase();
      const a = adapter ? info.adapters?.[adapter] : null;
      if (adapter && !a?.enabled) setStatus(`Bridge found at ${base}, but ${svc.name} is ${a?.status || 'disabled'} there.`, 'warn');
      else setStatus(`Bridge ${info.version} at ${base}${a?.status ? ` · ${a.status}` : ''}`, 'ok');
    }
    body.append(bf, h('div.actions', btn('Open remote', () => openService(id), 'primary')));
  }

  render();
  return { el, destroy() { abort?.abort(); } };
}
