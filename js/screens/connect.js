// Per-service sign-in / setup screen. Each service signs in once; tokens are remembered.
import { h, badge, iconBtn, onCircle, clear } from '../ui/dom.js';
import { field } from '../ui/keyboard.js';
import { toast } from '../ui/overlay.js';
import { getService, provider } from '../providers/registry.js';
import { bridgeInfo, bridgeBase } from '../providers/bridge.js';
import { redirectUri } from '../providers/spotify.js';
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
    if (kind === 'bridge') return renderBridge();
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
    if (signedIn()) { body.append(signedInActions()); return; }
    body.append(h('div.actions', btn('Sign in with Spotify', async () => {
      store.set('spotifyClientId', f.querySelector('input').value.trim());
      try { await p.connect(); } catch (e) { setStatus(err(e), 'error'); }
    }, 'primary')), status);
  }

  function renderApple() {
    const f = field({ label: 'Developer token (JWT)', value: store.get('appleDeveloperToken'), secret: true, placeholder: 'or let the bridge create it', onChange: (v) => store.set('appleDeveloperToken', v) });
    body.append(f);
    if (signedIn()) { body.append(signedInActions()); return; }
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

  async function renderBridge() {
    const adapter = ['tidal', 'qobuz'].includes(id) ? null : id;
    body.append(h('div.note', BRIDGE_TIPS[id] || ''), status);
    setStatus('Looking for the bridge…');
    const bf = field({ label: 'Bridge address', value: store.get('bridgeUrl'), placeholder: 'auto (http://localhost:8765)', onChange: async (v) => { store.set('bridgeUrl', v.replace(/\/$/, '')); await bridgeBase({ force: true }); render(); } });
    const info = await bridgeInfo();
    if (!info) {
      setStatus('Bridge not found. Start it on the Pi: node bridge/server.js', 'error');
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
