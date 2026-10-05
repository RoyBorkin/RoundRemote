// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// Per-service sign-in / setup screen. Each service signs in once; tokens are remembered.
import { h, badge, iconBtn, onCircle, clear } from '../ui/dom.js';
import { field } from '../ui/keyboard.js';
import { toast } from '../ui/overlay.js';
import { getService, provider, adapterOf } from '../providers/registry.js';
import { bridgeInfo, bridgeBase, bridgeFetch, bridgeZones, isAppleZone } from '../providers/bridge.js';
import { redirectUri } from '../providers/spotify.js';
import { googleSignIn, googleSignOut, googleSignedIn } from '../core/youtube.js';
import { openService } from '../core/nav.js';
import { player } from '../core/player.js';
import { store } from '../core/store.js';
import { directTvs, directId, saveDirectTv, forgetDirectTv, pingDirect, directKey, haTvZones, TV_APP_PORT, TV_APP_APK } from '../core/tvapp.js';
import { go } from '../core/router.js';
import { haConsoles } from '../providers/playstation.js';
import { normHost } from '../providers/streamer.js';

const err = (e) => e?.userMessage || e?.message || String(e);
const btn = (label, onClick, cls = '') => h(`button.pill${cls ? '.' + cls : ''}`, { type: 'button', onclick: onClick }, label);

const BRIDGE_TIPS = {
  roon: 'In Roon: Settings → Extensions → enable “Round Remote”.',
  cast: 'Cast devices on the same network appear automatically.',
  airplay: 'Install shairport-sync on the Pi (pi/setup.sh does it). Then pick “Round Display” as the AirPlay speaker on your phone or Mac.',
  androidtv: 'Google TV / Android TV: pair once with the code the TV shows.',
  appletv: 'Apple TV: pair once with the code the TV shows.',
  netflix: 'Follows Netflix on a Google TV or Apple TV you’ve paired (Media → Google TV / Apple TV), or cast to a Chromecast. Pick the TV under Devices.',
  disney: 'Follows Disney+ on a Google TV or Apple TV you’ve paired (Media → Google TV / Apple TV), or cast to a Chromecast. Pick the TV under Devices.',
  ytvideo: 'Plays on YouTube on your TV (link it under YouTube → “YouTube on your TV”), a Google TV or an Apple TV. Search needs a YouTube Data API key (Settings → Service keys).',
  castvideo: 'Chromecasts and Google TVs on the same network appear automatically. Cast a movie or show from any app (Netflix, Disney+, Plex, YouTube…).',
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
    if (['androidtv', 'appletv'].includes(adapterOf(svc)) && svc.id !== 'cast') return renderTvPairing();
    if (kind === 'hass') return renderHass();
    if (id === 'googlehome') return renderGoogleHome();
    if (id === 'playstation') return renderPlayStation();
    if (id === 'steam') return renderSteam();
    if (id === 'streamer') return renderStreamer();
    if (kind === 'bridge') return renderBridge();
    if (kind === 'youtube') return renderYouTube();
    if (id === 'spotify') return renderSpotify();
    if (id === 'apple') return renderApple();
    if (id === 'plex' || svc.signIn === 'plex') return renderPlex();
    if (id === 'jellyfin' || svc.signIn === 'jellyfin') return renderJellyfin();
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
  // TVs paired once with a code the TV shows: Google TV (androidtv) and Apple TV (appletv, via pyatv)
  const TV_PAIRING = {
    androidtv: {
      missing: 'The Google TV add-on isn’t installed in the bridge yet: in the bridge folder run  npm run androidtv  (start-bridge.bat does it for you), then restart the bridge.',
      codeHint: 'Enter the 6-character code shown on the TV', codePh: 'A1B2C3', ipHint: 'TV Settings → Network → About',
      note: 'For the song or video playing in YouTube on the TV, also link it under YouTube → “YouTube on your TV”.',
    },
    appletv: {
      missing: 'Apple TV support needs pyatv on the bridge computer: install Python, then run  pip install pyatv  and restart the bridge (pi/setup.sh does it on the Pi).',
      codeHint: 'Enter the 4-digit code shown on the Apple TV', codePh: '1234', ipHint: 'Apple TV Settings → Network',
      note: 'The Apple TV must allow the connection: Settings → AirPlay and HomeKit → Allow Access → Anyone on the Same Network (or Everyone).',
    },
  };
  async function renderTvPairing() {
    const ad = adapterOf(svc), conf = TV_PAIRING[ad];
    const api = (a) => `/api/adapters/${ad}/${a}`;
    if (ad === 'androidtv') renderTvDirect();
    body.append(status);
    setStatus('Looking for the bridge…');
    const info = await bridgeInfo();
    if (!info && ad === 'androidtv') {
      setStatus('');
      body.append(h('div.section', 'With the bridge'),
        h('div.note.dim', 'The bridge pairs with the TV’s own remote protocol (no app on the TV) and also shows which app is open. Run start-bridge.bat / start-bridge.sh on a computer or the Pi, then come back here.'),
        h('div.actions', btn('Look again', async () => { await bridgeBase({ force: true }); render(); })));
      return;
    }
    if (!info) { clear(body); body.append(...header()); return renderBridge(); }
    if (ad === 'androidtv') body.append(h('div.section', 'With the bridge'));
    const a = info.adapters?.[ad];
    if (!a?.enabled) setStatus(a?.status?.startsWith('not installed') ? conf.missing : `${svc.name} is ${a?.status || 'disabled'} in the bridge.`, 'warn');
    else setStatus(a.status || '', 'ok');
    const bridgeErr = (e) => e?.body?.error || err(e);
    const tvList = h('div.stack'), found = h('div.stack'), pairArea = h('div.stack');
    const pairStatus = h('div.status-line');
    const say = (text, kind = '') => { pairStatus.className = `status-line${kind ? ' ' + kind : ''}`; pairStatus.textContent = text; };

    const loadTvs = async () => {
      clear(tvList);
      try {
        const tvs = await bridgeFetch(api('list'));
        if (tvs?.length) tvList.append(h('div.section', 'Your TVs'));
        for (const t of tvs || []) {
          tvList.append(h('div.actions', h('span.note', `${t.connected ? '●' : '○'} ${t.name}`),
            btn('Control', () => { store.setZone(id, t.id); openService(id); }, 'primary'),
            btn('Forget', async () => { await bridgeFetch(api('unpair'), { method: 'POST', json: { host: t.host } }).catch(() => {}); if (store.getZone(id) === t.id) store.setZone(id, null); loadTvs(); })));
        }
      } catch {}
    };

    const askCode = (host, message) => {
      clear(pairArea);
      say(message || conf.codeHint, 'ok');
      const code = field({ label: 'Code on the TV', placeholder: conf.codePh });
      pairArea.append(code, h('div.actions', btn('Pair', async () => {
        say('Pairing…');
        try {
          const r = await bridgeFetch(api('code'), { method: 'POST', json: { host, code: code.querySelector('input').value } });
          if (r.next) { askCode(host, r.message); return; }   // Apple TV: a second code (AirPlay)
          store.setZone(id, r.id);
          clear(pairArea); say(`Paired ${r.name}`, 'ok'); toast(`Paired ${r.name}`); loadTvs();
        } catch (e) { say(bridgeErr(e), 'error'); }
      }, 'primary'), btn('Cancel', () => { clear(pairArea); say(''); })));
    };
    const startPair = async (host, name) => {
      host = String(host || '').trim();
      if (!host) { say('Enter the TV’s IP address', 'error'); return; }
      clear(pairArea);
      say(`Connecting to ${name || host}… (the TV has to be on)`);
      try {
        const r = await bridgeFetch(api('pair'), { method: 'POST', json: { host, name } });
        if (r?.id) { store.setZone(id, r.id); say(`Paired ${r.name}`, 'ok'); loadTvs(); return; } // no code needed
        askCode(host, r?.message);
      } catch (e) { say(bridgeErr(e), 'error'); }
    };

    const search = async () => {
      clear(found); found.append(h('div.note.dim', 'Searching the network…'));
      try {
        const list = await bridgeFetch(api('discover'));
        clear(found);
        if (!list?.length) { found.append(h('div.note.dim', `No TV found — type its IP address below (${conf.ipHint}).`)); return; }
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
      h('div.note.dim', conf.note),
    );
    loadTvs();
    if (a?.enabled) search();
  }


  // Google TV with no bridge: the free "TV Remote" app (Legvan/tv-remote) runs a small web server on the TV
  // that this page can send key presses to (see core/tvapp.js).
  function renderTvDirect() {
    const list = h('div.stack'), st = h('div.status-line');
    const say = (text, kind = '') => { st.className = `status-line${kind ? ' ' + kind : ''}`; st.textContent = text; };
    const paint = () => {
      clear(list);
      for (const t of directTvs()) {
        const zid = directId(t);
        list.append(h('div.actions', h('span.note', `📺 ${t.name} · ${t.host}${t.port !== TV_APP_PORT ? `:${t.port}` : ''}`),
          btn('Control', () => { store.setZone(id, zid); p.selectDevice?.({ id: zid }); openService(id); }, 'primary'),
          btn('Test', async () => {
            say(`Checking ${t.name}…`);
            if (!(await pingDirect(t))) { say(`No answer from ${t.host}:${t.port}. Is the TV on, and the server started in the TV Remote app?`, 'error'); return; }
            try { await directKey({ tv: t }, 'home'); say(`${t.name} answered — the TV should now show its Home screen. If it doesn’t, check that the ADB light in the TV Remote app is green.`, 'ok'); }
            catch (e) { say(err(e), 'error'); }
          }),
          btn('Forget', () => { forgetDirectTv(zid); if (store.getZone(id) === zid) store.setZone(id, null); paint(); })));
      }
    };
    let ipV = '', portV = String(TV_APP_PORT), nameV = '';
    const ipF = field({ label: 'TV IP address', placeholder: '192.168.1.50', onChange: (v) => { ipV = v; } });
    const portF = field({ label: 'Port', value: portV, placeholder: String(TV_APP_PORT), onChange: (v) => { portV = v; } });
    const nameF = field({ label: 'Name (optional)', placeholder: 'Living room TV', onChange: (v) => { nameV = v; } });
    const val = (f, v) => (f.querySelector('input').value || v || '').trim();
    renderTvHa();
    body.append(
      h('div.section', 'Without the bridge: an app on the TV'),
      h('div.note', 'The free “TV Remote” app (Legvan/tv-remote) runs a tiny web server on the TV. If it isn’t in your TV’s Play Store, install it from its download link:'),
      h('div.note', `1. On the TV install “Downloader” (by AFTVnews) from the Play Store, open it and allow it to install apps (TV Settings → Apps → Security & restrictions → Unknown sources → Downloader).`),
      h('code.uri', TV_APP_APK),
      h('div.note', '2. Type that address into Downloader and install the app. (Or send the file from your phone with “Send files to TV”.)'),
      h('div.note', '3. TV Settings → System → About → press “Android TV OS build” 7 times; then Developer options → turn on Network debugging (ADB over network).'),
      h('div.note', '4. Open TV Remote on the TV, press Start Server and choose Allow (tick Always allow) when the TV asks about debugging.'),
      h('div.note', '5. Type the TV’s IP address here (TV Settings → Network → About).'),
      list,
      ipF, portF, nameF,
      h('div.actions', btn('Add TV', async () => {
        const host = val(ipF, ipV);
        if (!host) { say('Enter the TV’s IP address', 'error'); return; }
        const t = saveDirectTv({ host, port: val(portF, portV), name: val(nameF, nameV) });
        store.setZone(id, directId(t));
        paint();
        say(`Checking ${t.host}:${t.port}…`);
        if (await pingDirect(t)) { say(`Found the TV Remote app on ${t.name}. Tap Control.`, 'ok'); toast(`${t.name} added`); }
        else say(`Saved, but ${t.host}:${t.port} didn’t answer yet — make sure the TV is on and the server is started in the TV Remote app, then tap Test.`, 'warn');
      }, 'primary')),
      st,
      h('div.note.dim', 'Keys, apps, typing and Google Assistant work this way. What’s playing isn’t shown (the TV app doesn’t let web pages read it) — use the bridge for that. On the GitHub Pages address Chrome asks once to allow local network access: choose Allow.'),
    );
    paint();
  }

  // Google TV through Home Assistant's own "Android TV Remote" integration: nothing to install on the TV
  function renderTvHa() {
    const box = h('div.stack');
    body.append(h('div.section', 'Without the bridge: Home Assistant'), box);
    const ha = provider('homeassistant');
    const howTo = () => [
      h('div.note', 'In Home Assistant: Settings → Devices & services → Add integration → “Android TV Remote”. Enter the TV’s IP address and the code the TV shows. That’s the same pairing as the Google TV phone app — nothing to install on the TV.'),
      h('div.note.dim', 'For typing, open the integration’s Configure and turn on “Enable IME”. Then tap Look again.'),
    ];
    if (!ha?.isAuthed() || ha.setupHint()) {
      box.append(h('div.note', 'If you use Home Assistant, it can pair with the TV and Round Remote controls it through Home Assistant.'),
        h('div.actions', btn('Set up Home Assistant', () => openService('homeassistant', { forceSetup: true }))));
      return;
    }
    box.append(h('div.note.dim', 'Connecting to Home Assistant…'));
    const paint = () => {
      clear(box);
      if (ha.status !== 'ready') { box.append(h('div.note', ha.statusMsg || 'Home Assistant isn’t connected'), h('div.actions', btn('Look again', () => { ha.connect().then(paint, paint); }))); return; }
      const tvs = haTvZones();
      if (!tvs.length) { box.append(h('div.note', 'No Google TV in Home Assistant yet.'), ...howTo(), h('div.actions', btn('Look again', () => { ha.disconnect(); ha.connect().then(paint, paint); }))); return; }
      for (const z of tvs) {
        box.append(h('div.actions', h('span.note', `${z.unavailable ? '○' : '●'} ${z.name}${z.sourceApp ? ` · ${z.sourceApp}` : ''}`),
          btn('Control', () => { store.setZone(id, z.id); p.selectDevice?.({ id: z.id }); openService(id); }, 'primary')));
      }
      box.append(h('div.note.dim', 'Typing on the TV needs “Enable IME” in the integration’s options.'));
    };
    ha.connect().then(paint, paint);
  }

  // ---------- Home Assistant: address + long-lived access token ----------
  function renderHass() {
    let url = store.get('haUrl') || '', token = '';
    const u = field({ label: 'Home Assistant address', value: url, placeholder: 'http://homeassistant.local:8123', onChange: (v) => { url = v; } });
    const t = field({ label: 'Long-lived access token', value: '', secret: true, placeholder: p.isAuthed() ? '(saved — paste a new one to replace it)' : 'from your HA profile page', onChange: (v) => { token = v; } });
    body.append(
      h('div.note', 'In Home Assistant open your profile (bottom left) → Security → Long-lived access tokens → Create token, and paste it here.'),
      u, t, status,
      h('div.actions', btn(p.isAuthed() ? 'Save & test' : 'Connect', async () => {
        url = (u.querySelector('input').value || url).trim().replace(/\/$/, '');
        token = (t.querySelector('input').value || token).trim();
        if (url && !/^https?:\/\//.test(url)) url = `http://${url}`;
        if (!url) { setStatus('Enter the address of Home Assistant', 'error'); return; }
        const oldAuth = store.auth('homeassistant');
        store.set('haUrl', url);
        if (token) p.saveToken(token); else if (oldAuth?.token) p.saveToken(oldAuth.token);
        else { setStatus('Paste a long-lived access token', 'error'); return; }
        setStatus('Connecting…');
        try { const r = await p.test(); setStatus(`Connected to ${r.name} · ${r.count} entities${r.mode === 'rest' ? ' (through the bridge)' : ''}`, 'ok'); setTimeout(() => openService(id), 700); }
        catch (e) { setStatus(e.userMessage || e.message, 'error'); }
      }, 'primary'), p.isAuthed() ? btn('Open', () => openService(id)) : null,
      p.isAuthed() ? btn('Forget token', () => { p.signOut(); render(); toast('Home Assistant token removed'); }) : null),
      h('div.note.dim', 'Tip: on the GitHub Pages app, an http:// Home Assistant is reached through the bridge; an https:// address (for example Nabu Casa) connects directly.'),
    );
  }

  // ---------- Google Home: Google Assistant sign-in on the bridge ----------
  async function renderGoogleHome() {
    body.append(status);
    setStatus('Looking for the bridge…');
    const info = await bridgeInfo();
    if (!info) { clear(body); body.append(...header()); return renderBridge(); }
    const a = info.adapters?.googlehome;
    let st = null;
    try { st = await bridgeFetch('/api/adapters/googlehome/status'); } catch (e) { setStatus(`Google Home is ${a?.status || 'not available'} in the bridge.`, 'warn'); }
    const base = await bridgeBase();
    if (st?.signedIn) {
      setStatus(`Signed in to Google Assistant${st.account ? ` as ${st.account}` : ''}`, 'ok');
      body.append(h('div.actions', btn('Open', () => openService(id), 'primary'),
        btn('Test', async () => { setStatus('Asking…'); try { const r = await p.ask('what time is it'); setStatus(r.text || 'OK', 'ok'); } catch (e) { setStatus(err(e), 'error'); } }),
        btn('Sign out', async () => { await p.signOut().catch(() => {}); render(); })));
    } else if (st) {
      setStatus(st.hasClient ? 'One step left: sign in with Google.' : 'Google Home needs a (free) Google Cloud OAuth client — see the steps below.', 'warn');
      let cid = '', secret = '';
      body.append(...[
        h('div.note', '1. In console.cloud.google.com create a project, enable the “Google Assistant API”, set up the OAuth consent screen (add yourself as a test user) and create an OAuth client ID of type “Desktop app”.'),
        field({ label: 'Client ID', value: st.clientId || '', placeholder: '….apps.googleusercontent.com', onChange: (v) => { cid = v; } }),
        field({ label: 'Client secret', value: '', secret: true, placeholder: st.hasClient ? '(saved)' : 'GOCSPX-…', onChange: (v) => { secret = v; } }),
        h('div.actions', btn('Save client', async () => {
          cid = cid || body.querySelectorAll('input')[0]?.value || ''; secret = secret || body.querySelectorAll('input')[1]?.value || '';
          try { await bridgeFetch('/api/adapters/googlehome/setup', { method: 'POST', json: { clientId: cid.trim(), clientSecret: secret.trim() } }); toast('Saved'); render(); } catch (e) { setStatus(err(e), 'error'); }
        })),
        h('div.note', `2. On the computer running the bridge, open ${base.replace(/\/\/[^:/]+/, '//localhost')}/api/adapters/googlehome/signin in a browser and sign in with your Google account (the one your Google Home uses).`),
        st.hasClient ? h('div.actions', btn('Sign in with Google', () => window.open(`${base}/api/adapters/googlehome/signin`, '_blank'), 'primary'), btn('Check again', () => render())) : null,
        h('div.note.dim', 'Or copy a credentials.json made with google-oauthlib-tool into the bridge folder as googlehome.json. Your speakers and displays work without signing in (Speakers tab).'),
        h('div.actions', btn('Open anyway', () => openService(id)))].filter(Boolean)
      );
    }
  }

  // ---------- PlayStation: NPSSO token → PSN sign-in kept on the bridge ----------
  async function renderPlayStation() {
    body.append(status);
    setStatus('Looking for the bridge…');
    const info = await bridgeInfo();
    if (!info) { clear(body); body.append(...header()); return renderBridge(); }
    let st = null;
    try { st = await p.status(); } catch (e) { setStatus(e.status === 404 ? 'This bridge has no PlayStation support yet — update the bridge (bridge/adapters/psn.js) and restart it.' : err(e), 'warn'); return; }
    if (st.signedIn) {
      p.markLinked(st.onlineId);
      setStatus(`Signed in to PlayStation Network${st.onlineId ? ` as ${st.onlineId}` : ''}`, 'ok');
      body.append(h('div.actions', btn('Open', () => openService(id), 'primary'),
        btn('Sign out', async () => { await p.signOut(); toast('Signed out of PlayStation'); render(); })));
    } else {
      setStatus('Sign in once with an NPSSO token — it takes a minute.', 'warn');
      let npsso = '';
      const f = field({ label: 'NPSSO token', value: '', secret: true, placeholder: '64 letters and digits', onChange: (v) => { npsso = v; } });
      body.append(
        h('div.note', '1. In a browser on your phone or computer, sign in at playstation.com with your PSN account.'),
        h('code.uri', 'https://www.playstation.com'),
        h('div.note', '2. In the same browser open this page:'),
        h('code.uri', 'https://ca.account.sony.com/api/v1/ssocookie'),
        h('div.note', '3. It shows {"npsso":"…"}. Copy the 64-character value (pasting the whole line works too) and paste it here.'),
        f,
        h('div.actions', btn('Sign in', async () => {
          npsso = (f.querySelector('input').value || npsso).trim();
          if (!npsso) { setStatus('Paste the NPSSO token first', 'error'); return; }
          setStatus('Signing in…');
          try { const r = await p.api('signin', { method: 'POST', json: { npsso }, timeout: 30000 }); p.markLinked(r.onlineId); done(); }
          catch (e) { setStatus(e?.body?.error || err(e), 'error'); }
        }, 'primary')),
        h('div.note.dim', 'The bridge swaps the token for the PlayStation App’s own sign-in, keeps it in bridge/psn.json and renews it by itself (for about two months). Treat the token like a password. If it stops working, sign in at playstation.com again and paste a fresh one.'),
      );
    }
    // console power: Home Assistant, or playactor on the bridge
    const power = h('div.stack');
    body.append(h('div.section', 'Wake & rest mode (optional)'), power);
    const ha = provider('homeassistant');
    let haLine = 'Home Assistant isn’t set up.';
    if (ha?.isAuthed() && !ha.setupHint()) {
      await Promise.race([ha.connect().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
      const ents = haConsoles(ha);
      haLine = ents.length ? `Home Assistant ✓ — ${ents[0].attributes?.friendly_name || ents[0].entity_id}` : 'Home Assistant has no PlayStation power switch yet.';
      ha.release();
    }
    power.append(
      h('div.note', 'The power button appears on the PlayStation screen when one of these is set up:'),
      h('div.note', `• Home Assistant with the ps5-mqtt add-on (or PlayStation2MQTT, or the PlayStation 4 integration). ${haLine}`),
      h('div.note', `• playactor on the bridge computer${st.playactor ? ' ✓ found' : ' — not found'}. Install it with Node.js, then pair once (Remote Play must be on: PS5 Settings → System → Remote Play). It shows a link to sign in and asks for the code from the PS5:`),
      h('code.uri', 'npm i -g playactor\nplayactor login --ps5'),
      h('div.note.dim', 'For a fixed console, add "psn": { "playactor": { "ip": "192.168.1.60" } } to bridge/config.json. Restart the bridge after installing playactor.'),
    );
  }

  // ---------- Steam: Web API key + your profile, kept on the bridge ----------
  async function renderSteam() {
    body.append(status);
    setStatus('Looking for the bridge…');
    const info = await bridgeInfo();
    if (!info) { clear(body); body.append(...header()); return renderBridge(); }
    let st = null;
    try { st = await p.status(); } catch (e) { setStatus(e.status === 404 ? 'This bridge has no Steam support yet — update the bridge (bridge/adapters/steam.js) and restart it.' : err(e), 'warn'); return; }
    const form = (editing) => {
      let key = '', user = '';
      const k = field({ label: 'Steam Web API key', value: '', secret: true, placeholder: st.hasKey ? '(saved — paste a new one to replace it)' : '32 letters and digits', onChange: (v) => { key = v; } });
      const u = field({ label: 'Your Steam profile', value: st.steamId || '', placeholder: 'SteamID64, profile link or custom URL name', onChange: (v) => { user = v; } });
      body.append(
        h('div.note', '1. Get a free Web API key at the address below (sign in with Steam; any domain name works, e.g. localhost).'),
        h('code.uri', 'https://steamcommunity.com/dev/apikey'), k,
        h('div.note', '2. Your profile: the link of your Steam profile (steamcommunity.com/id/… or /profiles/7656…), its custom URL name, or your SteamID64.'), u,
        h('div.note', '3. In Steam: Profile → Edit Profile → Privacy Settings → set My profile and Game details (and Friends list) to Public, or games, achievements and friends stay hidden.'),
        h('div.actions', btn(editing ? 'Save' : 'Connect', async () => {
          key = (k.querySelector('input').value || key).trim(); user = (u.querySelector('input').value || user).trim();
          setStatus('Checking with Steam…');
          try {
            const r = await p.api('setup', { method: 'POST', json: { apiKey: key, user }, timeout: 30000 });
            p.markLinked(r.name);
            if (!r.public) toast('Your Steam profile is private — set Game details to Public', { kind: 'error', ms: 4500 });
            done();
          } catch (e) { setStatus(e?.body?.error || err(e), 'error'); }
        }, 'primary'), editing ? btn('Cancel', render) : null),
        h('div.note.dim', 'The key stays on the bridge (bridge/steam.json). Start game and Big Picture open Steam on the computer that runs the bridge.'),
      );
    };
    if (st.signedIn) {
      p.markLinked(st.name);
      setStatus(`Connected to Steam as ${st.name || st.steamId}`, 'ok');
      body.append(h('div.actions', btn('Open', () => openService(id), 'primary'),
        btn('Change', () => { clear(body); body.append(...header(), status); form(true); }),
        btn('Forget', async () => { await p.signOut(); toast('Steam key removed from the bridge'); render(); })));
      if (!st.control) body.append(h('div.note.dim', 'Starting games is turned off in the bridge config (steam.control).'));
    } else {
      setStatus('Connect your Steam account — about a minute.', 'warn');
      form(false);
    }
  }

  // ---------- Music streamer (StreamUnlimited StreamSDK, e.g. Fosi S3): its address + a test ----------
  function renderStreamer() {
    const saved = store.auth(id) || {};
    let addr = saved.host || '';
    const f = field({ label: 'Streamer address', value: addr, placeholder: '192.168.50.156', onChange: (v) => { addr = v; } });
    const card = h('div.st-found');
    const acts = h('div.actions');
    const showCard = (r) => {
      clear(card);
      card.append(h('div.st-found-ic', { html: '<svg class="ic" viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' }),
        h('div.st-found-text', h('b', r.name || 'Streamer'), h('span', [r.product, r.version && `firmware ${r.version}`].filter(Boolean).join(' · ')),
          h('span.dim', `${r.host}${r.via ? ` · ${r.via === 'direct' ? 'direct' : 'through the bridge'}` : ''}`)));
    };
    const drawActs = (ok) => {
      clear(acts);
      acts.append(btn('Test connection', test, ok ? '' : 'primary'));
      if (ok) acts.append(btn('Open', () => openService(id), 'primary'));
      if (saved.host || ok) acts.append(btn('Forget', async () => { await p.signOut(); toast('Streamer address removed'); render(); }));
    };
    async function test() {
      addr = (f.querySelector('input').value || addr).trim();
      const host = normHost(addr);
      if (!host) { setStatus('Enter the streamer’s address, e.g. 192.168.50.156', 'error'); return; }
      setStatus(`Connecting to ${host}…`); clear(card);
      try {
        const r = await p.test(host);
        p.saveHost(host, r);
        setStatus(`Connected to ${r.name || 'the streamer'}`, 'ok');
        showCard(r); drawActs(true);
      } catch (e) {
        setStatus(err(e), 'error');
        if (e.kind === 'bridge') card.append(h('div.note', 'Start the bridge on your computer or Pi (Windows: start-bridge.bat · Mac/Linux: ./start-bridge.sh), then test again.'));
      }
    }
    body.append(
      h('div.note', 'The streamer’s IP address — the one its web page opens at (http://192.168.x.x/webclient). Your router’s list of devices shows it too.'),
      f, status, card, acts,
      h('div.note.dim', 'Works with streamers built on StreamUnlimited’s StreamSDK (Fosi S3 and others with the same web page). The app reaches it through the bridge; when the app itself is opened over http on your network and the streamer allows it, it talks to the streamer directly.'),
    );
    drawActs(false);
    if (saved.host) {
      setStatus(`Saved: ${saved.name || saved.host}`, 'ok');
      showCard({ ...saved, via: '' });
      drawActs(true);
    }
  }

  async function renderBridge() {
    const adapter = ['tidal', 'qobuz'].includes(id) || svc.adapters ? null : adapterOf(svc);
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
