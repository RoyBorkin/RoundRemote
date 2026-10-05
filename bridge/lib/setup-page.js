// © 2026 Roy Borkin. All rights reserved. See LICENSE.
// The phone / computer setup page served at /setup by bridge/lib/setup.js — one self-contained HTML document
// (inline CSS + JS, no CDNs, works offline on the LAN), mobile-first and comfortable on a desktop, English + Hebrew.
// The client below is a real function (so it's syntax-checked with the bridge) turned into the page's script.

const CSS = `
:root{--bg:#0f0e14;--bg2:#17151f;--card:#1c1a26;--card2:#25222f;--fg:#f4f2f8;--muted:#b0aac0;--dim:#7c7690;--line:#302c3d;--acc:#8b7bff;--on:#fff;
--ok:#34d399;--warn:#fbbf24;--err:#ff6b7d;--r:18px;--shadow:0 10px 30px rgba(0,0,0,.28)}
@media (prefers-color-scheme:light){:root{--bg:#f4f3f8;--bg2:#ebe9f2;--card:#fff;--card2:#f1eff6;--fg:#191624;--muted:#5b5570;--dim:#8d87a0;--line:#e3e0ec;--shadow:0 8px 24px rgba(40,30,80,.08);--ok:#059669;--warn:#b45309;--err:#dc2645}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 Inter,Rubik,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
body{min-height:100vh;min-height:100dvh;padding:max(14px,env(safe-area-inset-top)) 16px max(48px,env(safe-area-inset-bottom))}
.wrap{max-width:620px;margin:0 auto}
@media (min-width:980px){.wrap{max-width:1120px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;align-items:start}.pairbox{max-width:520px;margin-inline:auto}}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none;touch-action:manipulation}
a{color:var(--acc)}
[hidden]{display:none!important}
[dir=auto]{unicode-bidi:plaintext}
header.top{display:flex;align-items:center;gap:12px;margin:2px 2px 18px}
.logo{width:44px;height:44px;flex:none;border-radius:50%;background:conic-gradient(from 210deg,#8b7bff,#1ed760,#18bcf2,#f5b31b,#8b7bff);padding:3px;box-shadow:0 6px 20px color-mix(in srgb,#8b7bff 35%,transparent)}
.logo i{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;background:var(--bg);font-style:normal;font-weight:900;font-size:14px;letter-spacing:.02em}
header h1{font-size:19px;margin:0;line-height:1.15;letter-spacing:-.01em}
header .sub{color:var(--muted);font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.lang{margin-inline-start:auto;padding:8px 14px;border-radius:99px;background:var(--card2);font-weight:700;font-size:13px;flex:none}
.dot{width:8px;height:8px;border-radius:50%;background:var(--dim);display:inline-block;flex:none}
.dot.ok{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 25%,transparent)}.dot.warn{background:var(--warn)}.dot.err{background:var(--err)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px;margin-bottom:14px;box-shadow:var(--shadow)}
.big{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:15px;border-radius:99px;background:var(--c,var(--acc));color:var(--on);font-weight:800;font-size:17px;margin-top:12px;transition:transform .15s,opacity .2s;text-decoration:none}
.big:active{transform:scale(.97)}.big:disabled{opacity:.45;cursor:default}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 18px;border-radius:99px;background:var(--c,var(--acc));color:var(--on);font-weight:750;font-size:15px;transition:transform .15s,opacity .2s;text-decoration:none;min-height:44px}
.btn:active{transform:scale(.96)}.btn:disabled{opacity:.45;cursor:default}
.btn.ghost{background:var(--card2);color:var(--fg)}
.btn.sm{padding:7px 13px;font-size:13px;min-height:34px}
.btn.danger{background:color-mix(in srgb,var(--err) 16%,var(--card2));color:var(--err)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
.row.end{justify-content:flex-end}
label.l{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:14px 2px 7px}
.in{width:100%;padding:13px 15px;border-radius:14px;border:1px solid var(--line);background:var(--card2);outline:none;font-size:16px;min-height:48px}
.in:focus{border-color:var(--c,var(--acc));box-shadow:0 0 0 3px color-mix(in srgb,var(--c,var(--acc)) 22%,transparent)}
.in[type=file]{padding:9px 10px;font-size:14px;color:var(--muted)}
.in[type=file]::file-selector-button{font:inherit;font-weight:750;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:99px;padding:7px 14px;margin-inline-end:10px;cursor:pointer}
.pw{position:relative;direction:ltr}.pw .in{padding-right:60px}
.pw button{position:absolute;right:6px;top:50%;transform:translateY(-50%);padding:8px 10px;border-radius:10px;color:var(--muted);font-size:13px;font-weight:700}
.hint{font-size:13px;color:var(--dim);margin:6px 2px 0}
.note{font-size:14px;color:var(--muted);margin:10px 2px 0}
ol.steps{margin:10px 0 0;padding-inline-start:22px;color:var(--muted);font-size:14px}
ol.steps li{margin:6px 0;padding-inline-start:2px}
ol.steps b{color:var(--fg)}
code,.mono{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
.uri{display:flex;align-items:center;gap:8px;margin-top:8px;padding:10px 12px;border-radius:12px;background:var(--card2);border:1px dashed var(--line)}
.uri code{flex:1;min-width:0;word-break:break-all;font-size:13.5px;user-select:all;-webkit-user-select:all}
.res{margin-top:12px;font-size:14px;font-weight:600;display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:var(--card2)}
.res:empty{display:none}
.res.ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--card))}.res.err{color:var(--err);background:color-mix(in srgb,var(--err) 11%,var(--card))}.res.busy{color:var(--muted)}
.spin{width:18px;height:18px;flex:none;border-radius:50%;border:2.5px solid color-mix(in srgb,currentColor 25%,transparent);border-top-color:currentColor;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translate(-50%,20px);opacity:0;background:var(--fg);color:var(--bg);padding:11px 20px;border-radius:99px;font-weight:700;transition:.25s;pointer-events:none;z-index:30;max-width:90%;text-align:center}
.toast.show{opacity:1;transform:translate(-50%,0)}.toast.err{background:var(--err);color:#fff}
/* pairing */
.pairbox{text-align:center;padding:26px 18px 22px}
.disp{width:132px;height:132px;margin:2px auto 16px;border-radius:50%;background:radial-gradient(circle at 50% 35%,#2b2640,#0b0a10 70%);border:6px solid #2d2a38;box-shadow:0 14px 34px rgba(0,0,0,.35),inset 0 0 0 2px #000;display:grid;place-items:center;color:#fff}
.disp span{font:800 19px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.12em}
.disp small{display:block;font:600 9px Inter,system-ui,sans-serif;color:#b8b0d8;letter-spacing:.08em;text-transform:uppercase;margin-top:2px}
.pairbox h2{margin:0 0 6px;font-size:22px;letter-spacing:-.01em}
.pairbox p{margin:0 auto;color:var(--muted);font-size:14.5px;max-width:420px}
.codein{width:100%;max-width:330px;margin:18px auto 0;display:block;text-align:center;font:800 32px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.42em;padding:14px 0 14px .42em;border-radius:18px;border:2px solid var(--line);background:var(--card2);outline:none}
.codein:focus{border-color:var(--acc);box-shadow:0 0 0 4px color-mix(in srgb,var(--acc) 22%,transparent)}
.pairbox .in{text-align:center;max-width:330px;margin:0 auto;display:block}
.pairbox label.l{text-align:center}
.pairbox .big{max-width:330px;margin:16px auto 0}
.perr{color:var(--err);font-weight:700;font-size:14px;margin-top:12px;min-height:1.2em}
.fine{font-size:12.5px;color:var(--dim);margin-top:16px}
/* connected */
.conn{display:flex;align-items:center;gap:12px;padding:12px 14px}
.conn .who{flex:1;min-width:0}
.conn b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.conn small{color:var(--muted);font-size:12.5px}
.prog{display:flex;align-items:center;gap:16px}
.ring{width:64px;height:64px;flex:none}
.ring circle{fill:none;stroke-width:7}
.ring .bgc{stroke:var(--card2)}.ring .fgc{stroke:var(--ok);stroke-linecap:round;transition:stroke-dashoffset .6s ease}
.ring text{font:800 15px Inter,system-ui,sans-serif;fill:var(--fg)}
.prog h2{margin:0;font-size:18px}.prog p{margin:2px 0 0;color:var(--muted);font-size:13.5px}
nav.jump{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 10px;margin:0 -2px 6px;scrollbar-width:none;position:sticky;top:0;z-index:5;background:linear-gradient(var(--bg) 78%,transparent)}
nav.jump::-webkit-scrollbar{display:none}
nav.jump a{flex:none;padding:8px 14px;border-radius:99px;background:var(--card);border:1px solid var(--line);color:var(--fg);text-decoration:none;font-size:13.5px;font-weight:650}
h3.grp{font-size:13px;text-transform:uppercase;letter-spacing:.09em;color:var(--dim);margin:20px 4px 10px;scroll-margin-top:60px}
.svc{background:var(--card);border:1px solid var(--line);border-radius:var(--r);margin-bottom:12px;box-shadow:var(--shadow);overflow:hidden;scroll-margin-top:64px;transition:border-color .2s}
.svc.open{border-color:color-mix(in srgb,var(--c) 45%,var(--line))}
.svc-h{display:flex;align-items:center;gap:12px;width:100%;padding:14px;text-align:start}
.badge{width:42px;height:42px;flex:none;border-radius:50%;display:grid;place-items:center;font-weight:850;font-size:14px;color:#fff;background:var(--c);box-shadow:0 4px 14px color-mix(in srgb,var(--c) 35%,transparent);letter-spacing:-.02em}
.badge.dark{color:#111}
.svc.dk{--on:#0b0b0b}
.svc-t{flex:1;min-width:0}
.svc-t b{display:block;font-size:16px}
.svc-t small{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:13px;margin-top:3px;min-width:0}
.svc-t small span.d{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st{flex:none;font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:99px;background:var(--card2);color:var(--muted);white-space:nowrap}
.st:empty{display:none}
.st.ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}
.st.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
.chev{width:10px;height:10px;flex:none;border-inline-end:2.5px solid var(--dim);border-bottom:2.5px solid var(--dim);transform:rotate(45deg);margin:-4px 4px 0;transition:transform .25s}
.svc.open .chev{transform:rotate(225deg);margin-top:4px}
.svc-b{padding:0 16px 18px;border-top:1px solid var(--line)}
.svc-b > :first-child{margin-top:14px}
.sub2{font-size:14px;font-weight:800;margin:18px 2px 0;color:var(--fg)}
.seg{display:flex;gap:4px;background:var(--card2);padding:4px;border-radius:99px;margin-top:12px}
.seg button{flex:1;padding:9px 6px;border-radius:99px;font-weight:750;font-size:14px;color:var(--muted)}
.seg button.on{background:var(--c);color:#fff}
.list{margin-top:10px;display:grid;gap:8px}
.item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:var(--card2)}
.item .t{flex:1;min-width:0}.item .t small{display:block;color:var(--dim);font-size:12.5px}
.item.wrap{flex-wrap:wrap}.item.wrap .t{flex:1 1 100%}.item.wrap .btn{flex:1}
.item input[type=radio]{accent-color:var(--c);width:18px;height:18px}
.bigcode{font:800 34px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;text-align:center;padding:12px;border-radius:14px;background:var(--card2);margin-top:12px;color:var(--c)}
.adapters{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.adapters div{display:flex;align-items:center;gap:8px;font-size:13.5px;padding:8px 10px;border-radius:12px;background:var(--card2)}
.check{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:14px;color:var(--muted)}
.check input{width:20px;height:20px;accent-color:var(--c)}
.banner{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:14px;background:color-mix(in srgb,var(--warn) 14%,var(--card));border:1px solid color-mix(in srgb,var(--warn) 38%,transparent);margin-bottom:12px;font-size:14px;font-weight:600}
.foot{text-align:center;color:var(--dim);font-size:12.5px;margin-top:22px}
`;

function client() {
  const $ = (s, el = document) => el.querySelector(s);
  const q = new URLSearchParams(location.search);
  const ls = {
    get: (k) => { try { return localStorage.getItem('rrsetup.' + k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem('rrsetup.' + k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem('rrsetup.' + k); } catch {} },
  };
  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k.startsWith('--')) e.style.setProperty(k, v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  }

  // ------------------------------------------------------------------ words
  const T = {
    en: {
      title: 'Set up Round Remote', pairTitle: 'Connect to your round display', pairText: 'On the round screen open Settings → “Set up from phone or computer” (or tap “Set up on your phone”). Type the 6-digit code it shows.',
      yourDevice: 'This device’s name (shown on the display)', connect: 'Connect', wrongCode: 'Type the 6 digits shown on the display', connecting: 'Connecting…',
      fine: 'Only works on your home network. Your keys go straight to the display and the bridge — never to anyone else.',
      connectedTo: 'Connected to {d}', as: 'as {n}', left: '{m} min left', disconnect: 'Disconnect', displayOff: 'The display isn’t answering — is the app open on it?',
      ended: 'The setup session ended. Type the code from the display to continue.', kicked: 'The display ended this session.',
      progress: '{n} of {t} set up', progressSub: 'Tap a service to set it up. Changes show on the round display right away.',
      g_music: 'Music', g_media: 'Movies & TV', g_home: 'Home', g_collect: 'Collection', g_device: 'Device', g_adv: 'Advanced',
      s_ok: 'Connected', s_todo: 'Not set up', s_warn: 'Needs attention', s_na: 'Not available', s_info: 'Nothing to type',
      save: 'Save', saving: 'Saving…', sending: 'Sending to the display…', saved: 'Saved ✓', test: 'Test', show: 'Show', hide: 'Hide', copy: 'Copy', copied: 'Copied',
      cancel: 'Cancel', open: 'Open', retry: 'Try again', asleep: 'Sent — the display will pick it up as soon as the app is open on it.',
      needBridge: 'Needs the bridge', offline: 'Can’t reach the bridge — are you on the same Wi-Fi?',
      // Spotify
      sp_sub: 'Remote control + this display as a speaker', sp_cid: 'Client ID', sp_cidHint: 'From developer.spotify.com → Dashboard → your app. The original RoundSpotify ID is filled in.',
      sp_redirect: 'In that app’s settings, this Redirect URI must be listed (Spotify only allows https addresses, or http://127.0.0.1):',
      sp_users: 'In User Management, add the Spotify account you’ll sign in with (Premium needed for remote control).',
      sp_signin: 'Sign in with Spotify', sp_back: 'Spotify answered — handing the sign-in to the display…', sp_err: 'Spotify sign-in was cancelled ({e})', sp_state: 'That sign-in didn’t start here — try again',
      // Apple
      ap_sub: 'Cider / the Apple Music app via the bridge, or MusicKit on the display',
      ap_a: 'Apple Music on a computer (Cider, Sidra, the Windows app): nothing to set up here — just play it on the computer that runs the bridge.',
      ap_b: 'To play Apple Music on the display itself (MusicKit) the bridge needs your MusicKit key once:',
      ap_s1: 'developer.apple.com → Certificates, IDs & Profiles → Keys → + → tick Media Services (MusicKit) → download the AuthKey_XXXXXXXXXX.p8 file.',
      ap_s2: 'Your Team ID is under Membership; the Key ID is in the file name.',
      ap_team: 'Team ID', ap_key: 'Key ID', ap_file: 'The .p8 key file', ap_upload: 'Upload key to the bridge', ap_or: 'Or paste a ready-made developer token (JWT)', ap_token: 'Developer token',
      ap_after: 'Then tap “Sign in with Apple Music” on the round display (Apple’s own sign-in has to happen there).', ap_ready: 'Key on the bridge: {k}',
      // YouTube
      yt_sub: 'Search + music videos for every service', yt_key: 'YouTube Data API key', yt_cid: 'Google OAuth Client ID (optional: your playlists)',
      yt_s1: 'console.cloud.google.com → create a project → APIs & Services → Library → YouTube Data API v3 → Enable.', yt_s2: 'Credentials → Create credentials → API key. Paste it here.',
      yt_note: 'Signing in with Google for your own playlists happens on the display (Google only allows it there).', yt_save: 'Save & test',
      // Plex
      px_sub: 'Plexamp, Plex players and Movies & TV', px_start: 'Sign in with Plex', px_open: 'Open Plex sign-in', px_or: 'Or open plex.tv/link on any device and type:', px_wait: 'Waiting for you to sign in…',
      // Jellyfin
      jf_sub: 'Any Jellyfin client + Movies & TV', jf_server: 'Server address', jf_qc: 'Quick Connect', jf_pw: 'Username & password', jf_user: 'Username', jf_pass: 'Password',
      jf_qcStart: 'Get a Quick Connect code', jf_qcHow: 'In Jellyfin open your profile → Quick Connect and enter:', jf_signin: 'Sign in',
      // bridge things
      br_title: 'Roon, Tidal, Qobuz & more', br_sub: 'Cast, UPnP, AirPlay — found by the bridge',
      br_text: 'These appear by themselves while the bridge runs. Roon: Settings → Extensions → enable “Round Remote”. Tidal / Qobuz: play them through Roon, Cast, UPnP or AirPlay.',
      br_on: 'on', br_off: 'off',
      // TVs
      tv_title: 'TVs', tv_sub: 'Google TV, Apple TV and YouTube on your TV', tv_find: 'Find TVs', tv_ip: 'Or the TV’s IP address', tv_pair: 'Pair', tv_code: 'Code on the TV', tv_send: 'Send code',
      tv_none: 'No TV found — type its IP address.', tv_paired: 'Paired: {n}', tv_yours: 'Your TVs', tv_yt: 'YouTube on your TV', tv_ytHow: 'On the TV: YouTube → Settings → Link with TV code. Type the code:', tv_link: 'Link TV',
      tv_forget: 'Forget', tv_media: 'Plex and Jellyfin movies use the same sign-ins as above.',
      // HA
      ha_sub: 'Lights, climate, scenes, speakers, cameras…', ha_url: 'Home Assistant address', ha_token: 'Long-lived access token',
      ha_s1: 'In Home Assistant open your profile → Security → Long-lived access tokens → Create token.', ha_open: 'Open my Home Assistant profile', ha_connect: 'Connect',
      // Google Home
      gh_sub: 'Google Assistant commands, routines, broadcasts', gh_s1: 'console.cloud.google.com: create a project, enable the “Google Assistant API”, set up the OAuth consent screen (add yourself as a test user) and create an OAuth client ID of type “Desktop app”.',
      gh_cid: 'Client ID', gh_secret: 'Client secret', gh_save: 'Save client on the bridge',
      gh_s2: 'Then sign in with Google on the computer that runs the bridge (Google returns desktop sign-ins only to localhost):', gh_here: 'Sign in with Google (this computer runs the bridge)',
      // PSN
      ps_sub: 'Your profile, games, trophies, friends', ps_s1: 'Sign in at playstation.com with your PSN account (in this browser).', ps_s2: 'Then open this page — it shows {"npsso":"…"}:',
      ps_s3: 'Copy the 64-character value (or the whole line) and paste it here.', ps_npsso: 'NPSSO token', ps_signin: 'Sign in',
      // Steam
      st_sub: 'Status, games, achievements, friends', st_s1: 'Get a free Steam Web API key (any domain name works, e.g. localhost):', st_key: 'Steam Web API key',
      st_user: 'Your Steam profile', st_userPh: 'profile link, custom URL name or SteamID64', st_s3: 'In Steam set Profile → Edit Profile → Privacy → Game details to Public.', st_connect: 'Connect',
      // streamer
      fs_title: 'Music streamer (Fosi S3)', fs_sub: 'StreamUnlimited streamers', fs_ip: 'Streamer IP address', fs_hint: 'The address its web page opens at (http://192.168.x.x/webclient), or see your router’s device list.', fs_test: 'Test & save',
      // alerts
      al_title: 'Smart-home alerts', al_sub: 'Lights, chimes and phone notifications for timers and alarms',
      al_text: 'Alerts use Home Assistant (and Google Home). Pick the lights, speaker and phone on the display: Settings → Alerts.', al_test: 'Send a test alert', al_state: '{l} lights · speaker: {s} · phone: {p}', al_none: 'none',
      // collection
      co_title: 'Collection connections', co_sub: 'BoardGameGeek, PriceCharting, RAWG, Discogs, TMDB', co_user: 'Username', co_token: 'Token', co_key: 'API key',
      co_bgg: 'boardgamegeek.com/applications → register an app → create a token', co_pc: 'Your PriceCharting API token (paid subscription)', co_rawg: 'rawg.io/apidocs → free key', co_discogs: 'discogs.com → Settings → Developers → personal access token', co_tmdb: 'themoviedb.org → Settings → API (v3 key or read access token)',
      co_set: 'connected', co_keep: '(saved — leave empty to keep)',
      // wifi
      wf_title: 'Wi-Fi', wf_sub: 'The round display’s network', wf_now: 'Connected to {s}', wf_none: 'Not connected', wf_scan: 'Find networks', wf_pass: 'Password', wf_join: 'Join network',
      wf_warn: 'If the display moves to another network, this page loses it — reconnect with the new address.', wf_page: 'Open the full Wi-Fi page', wf_hidden: 'Network name (hidden network)',
      // advanced
      ad_title: 'Keys & advanced', ad_sub: 'Defaults kept in the bridge’s config.json', ad_text: 'These go into the bridge’s config file (“app” block) and pre-fill every round display and web app that uses this bridge — and this display at once.',
      ad_cid: 'Spotify Client ID', ad_jf: 'Jellyfin server', ad_yt: 'YouTube Data API key', ad_gcid: 'Google OAuth Client ID', ad_apple: 'Apple developer token', ad_save: 'Save to the bridge',
      // profiles
      pr_title: 'Copy setup to another device', pr_sub: 'Share sign-ins between the Pi and the web app on your PC', pr_name: 'Profile name', pr_signins: 'Include sign-ins (account tokens — keep private)',
      pr_save: 'Save this display’s setup', pr_list: 'Profiles on the bridge', pr_load: 'Load on this display', pr_dl: 'Download', pr_none: 'No profiles yet.', pr_up: 'Upload a profile file',
      pr_how: 'On the other device: Settings → Profiles → Load (or open the app with ?profile=NAME). Profiles on the bridge can be read by anyone on your network.', pr_loaded: 'Loaded — the display restarts',
      pr_signinsTag: 'with sign-ins', pr_count: '{n} saved on the bridge',
      noPi: 'Wi-Fi is set on the Raspberry Pi display only.',
    },
    he: {
      title: 'הגדרת Round Remote', pairTitle: 'התחברות למסך העגול', pairText: 'במסך העגול פתחו הגדרות ← „הגדרה מהטלפון או מהמחשב” (או הקישו „הגדרה בטלפון”). הקלידו את הקוד בן 6 הספרות שמופיע שם.',
      yourDevice: 'שם המכשיר הזה (יופיע במסך)', connect: 'התחברות', wrongCode: 'הקלידו את 6 הספרות שמופיעות במסך', connecting: 'מתחבר…',
      fine: 'עובד רק ברשת הביתית. המפתחות שלכם עוברים ישירות למסך ולגשר — לאף אחד אחר.',
      connectedTo: 'מחובר ל-{d}', as: 'בתור {n}', left: 'נותרו {m} דק׳', disconnect: 'ניתוק', displayOff: 'המסך לא עונה — האפליקציה פתוחה בו?',
      ended: 'ההגדרה הסתיימה. הקלידו שוב את הקוד מהמסך כדי להמשיך.', kicked: 'המסך סיים את החיבור.',
      progress: '{n} מתוך {t} מוגדרים', progressSub: 'הקישו על שירות כדי להגדיר אותו. השינויים מופיעים במסך מיד.',
      g_music: 'מוזיקה', g_media: 'סרטים וטלוויזיה', g_home: 'בית', g_collect: 'אוסף', g_device: 'מכשיר', g_adv: 'מתקדם',
      s_ok: 'מחובר', s_todo: 'לא מוגדר', s_warn: 'דורש טיפול', s_na: 'לא זמין', s_info: 'אין מה להקליד',
      save: 'שמירה', saving: 'שומר…', sending: 'שולח למסך…', saved: 'נשמר ✓', test: 'בדיקה', show: 'הצג', hide: 'הסתר', copy: 'העתקה', copied: 'הועתק',
      cancel: 'ביטול', open: 'פתיחה', retry: 'שוב', asleep: 'נשלח — המסך יקבל את זה ברגע שהאפליקציה תיפתח בו.',
      needBridge: 'צריך את הגשר', offline: 'אין חיבור לגשר — אתם על אותה רשת Wi-Fi?',
      sp_sub: 'שלט רחוק + המסך כרמקול', sp_cid: 'Client ID', sp_cidHint: 'מ-developer.spotify.com ← Dashboard ← האפליקציה שלכם. המזהה של RoundSpotify כבר ממולא.',
      sp_redirect: 'בהגדרות האפליקציה שם, כתובת ה-Redirect URI הזו חייבת להופיע (ספוטיפיי מתיר רק https או http://127.0.0.1):',
      sp_users: 'ב-User Management הוסיפו את חשבון הספוטיפיי שאיתו תתחברו (לשליטה צריך Premium).',
      sp_signin: 'התחברות עם Spotify', sp_back: 'ספוטיפיי ענה — מעביר את ההתחברות למסך…', sp_err: 'ההתחברות לספוטיפיי בוטלה ({e})', sp_state: 'ההתחברות הזו לא התחילה כאן — נסו שוב',
      ap_sub: 'Cider / אפליקציית Apple Music דרך הגשר, או MusicKit במסך',
      ap_a: 'Apple Music במחשב (Cider, Sidra, אפליקציית Windows): אין מה להגדיר כאן — פשוט נגנו במחשב שמריץ את הגשר.',
      ap_b: 'כדי לנגן Apple Music במסך עצמו (MusicKit), הגשר צריך פעם אחת את מפתח ה-MusicKit שלכם:',
      ap_s1: 'developer.apple.com ← Certificates, IDs & Profiles ← Keys ← + ← סמנו Media Services (MusicKit) ← הורידו את הקובץ AuthKey_XXXXXXXXXX.p8.',
      ap_s2: 'ה-Team ID מופיע תחת Membership; ה-Key ID מופיע בשם הקובץ.',
      ap_team: 'Team ID', ap_key: 'Key ID', ap_file: 'קובץ המפתח ‎.p8', ap_upload: 'העלאת המפתח לגשר', ap_or: 'או הדביקו developer token מוכן (JWT)', ap_token: 'Developer token',
      ap_after: 'אחר כך הקישו „Sign in with Apple Music” במסך העגול (ההתחברות של אפל חייבת לקרות שם).', ap_ready: 'מפתח בגשר: {k}',
      yt_sub: 'חיפוש וקליפים לכל השירותים', yt_key: 'מפתח YouTube Data API', yt_cid: 'Google OAuth Client ID (רשות: הפלייליסטים שלכם)',
      yt_s1: 'console.cloud.google.com ← צרו פרויקט ← APIs & Services ← Library ← YouTube Data API v3 ← Enable.', yt_s2: 'Credentials ← Create credentials ← API key. הדביקו אותו כאן.',
      yt_note: 'התחברות לגוגל לפלייליסטים שלכם נעשית במסך (גוגל מתיר אותה רק שם).', yt_save: 'שמירה ובדיקה',
      px_sub: 'Plexamp, נגני Plex וסרטים וסדרות', px_start: 'התחברות עם Plex', px_open: 'פתיחת ההתחברות של Plex', px_or: 'או פתחו plex.tv/link בכל מכשיר והקלידו:', px_wait: 'מחכה שתתחברו…',
      jf_sub: 'כל לקוח Jellyfin + סרטים וסדרות', jf_server: 'כתובת השרת', jf_qc: 'Quick Connect', jf_pw: 'שם משתמש וסיסמה', jf_user: 'שם משתמש', jf_pass: 'סיסמה',
      jf_qcStart: 'קבלת קוד Quick Connect', jf_qcHow: 'ב-Jellyfin פתחו את הפרופיל ← Quick Connect והקלידו:', jf_signin: 'התחברות',
      br_title: 'Roon, Tidal, Qobuz ועוד', br_sub: 'Cast, UPnP, AirPlay — הגשר מוצא אותם',
      br_text: 'הם מופיעים מעצמם כשהגשר פועל. Roon: Settings ← Extensions ← הפעילו „Round Remote”. Tidal / Qobuz: נגנו אותם דרך Roon, Cast, UPnP או AirPlay.',
      br_on: 'פועל', br_off: 'כבוי',
      tv_title: 'טלוויזיות', tv_sub: 'Google TV, Apple TV ו-YouTube בטלוויזיה', tv_find: 'חיפוש טלוויזיות', tv_ip: 'או כתובת ה-IP של הטלוויזיה', tv_pair: 'צימוד', tv_code: 'הקוד שבטלוויזיה', tv_send: 'שליחת הקוד',
      tv_none: 'לא נמצאה טלוויזיה — הקלידו את כתובת ה-IP.', tv_paired: 'צומד: {n}', tv_yours: 'הטלוויזיות שלכם', tv_yt: 'YouTube בטלוויזיה', tv_ytHow: 'בטלוויזיה: YouTube ← הגדרות ← קישור באמצעות קוד טלוויזיה. הקלידו את הקוד:', tv_link: 'קישור הטלוויזיה',
      tv_forget: 'שכח', tv_media: 'סרטים ב-Plex וב-Jellyfin משתמשים באותן התחברויות שלמעלה.',
      ha_sub: 'אורות, מיזוג, סצנות, רמקולים, מצלמות…', ha_url: 'כתובת Home Assistant', ha_token: 'Long-lived access token',
      ha_s1: 'ב-Home Assistant פתחו את הפרופיל ← Security ← Long-lived access tokens ← Create token.', ha_open: 'פתיחת הפרופיל שלי ב-Home Assistant', ha_connect: 'התחברות',
      gh_sub: 'פקודות ל-Google Assistant, שגרות, הכרזות', gh_s1: 'console.cloud.google.com: צרו פרויקט, הפעילו את „Google Assistant API”, הגדירו OAuth consent screen (הוסיפו את עצמכם כ-test user) וצרו OAuth client ID מסוג „Desktop app”.',
      gh_cid: 'Client ID', gh_secret: 'Client secret', gh_save: 'שמירת הלקוח בגשר',
      gh_s2: 'אחר כך התחברו לגוגל במחשב שמריץ את הגשר (גוגל מחזיר התחברויות של אפליקציות מחשב רק ל-localhost):', gh_here: 'התחברות לגוגל (המחשב הזה מריץ את הגשר)',
      ps_sub: 'הפרופיל, משחקים, גביעים, חברים', ps_s1: 'התחברו ל-playstation.com עם חשבון ה-PSN (בדפדפן הזה).', ps_s2: 'אחר כך פתחו את הדף הזה — הוא מציג {"npsso":"…"}:',
      ps_s3: 'העתיקו את הערך בן 64 התווים (או את כל השורה) והדביקו כאן.', ps_npsso: 'NPSSO token', ps_signin: 'התחברות',
      st_sub: 'סטטוס, משחקים, הישגים, חברים', st_s1: 'קבלו מפתח Steam Web API בחינם (כל שם דומיין מתאים, למשל localhost):', st_key: 'מפתח Steam Web API',
      st_user: 'פרופיל ה-Steam שלכם', st_userPh: 'קישור לפרופיל, שם ה-URL או SteamID64', st_s3: 'ב-Steam הגדירו Profile ← Edit Profile ← Privacy ← Game details ל-Public.', st_connect: 'התחברות',
      fs_title: 'סטרימר מוזיקה (Fosi S3)', fs_sub: 'סטרימרים של StreamUnlimited', fs_ip: 'כתובת ה-IP של הסטרימר', fs_hint: 'הכתובת שבה נפתח דף האינטרנט שלו (http://192.168.x.x/webclient), או ברשימת המכשירים של הנתב.', fs_test: 'בדיקה ושמירה',
      al_title: 'התראות בבית החכם', al_sub: 'אורות, צלצולים והתראות לטלפון לטיימרים ולשעונים מעוררים',
      al_text: 'ההתראות עוברות דרך Home Assistant (ו-Google Home). בחרו אורות, רמקול וטלפון במסך: הגדרות ← התראות.', al_test: 'שליחת התראת בדיקה', al_state: '{l} אורות · רמקול: {s} · טלפון: {p}', al_none: 'אין',
      co_title: 'חיבורי האוסף', co_sub: 'BoardGameGeek, PriceCharting, RAWG, Discogs, TMDB', co_user: 'שם משתמש', co_token: 'טוקן', co_key: 'מפתח API',
      co_bgg: 'boardgamegeek.com/applications ← רישום אפליקציה ← יצירת טוקן', co_pc: 'טוקן ה-API שלכם ב-PriceCharting (מנוי בתשלום)', co_rawg: 'rawg.io/apidocs ← מפתח חינמי', co_discogs: 'discogs.com ← Settings ← Developers ← personal access token', co_tmdb: 'themoviedb.org ← Settings ← API (מפתח v3 או read access token)',
      co_set: 'מחובר', co_keep: '(שמור — השאירו ריק כדי לשמור)',
      wf_title: 'Wi-Fi', wf_sub: 'הרשת של המסך העגול', wf_now: 'מחובר ל-{s}', wf_none: 'לא מחובר', wf_scan: 'חיפוש רשתות', wf_pass: 'סיסמה', wf_join: 'התחברות לרשת',
      wf_warn: 'אם המסך עובר לרשת אחרת, הדף הזה יאבד אותו — התחברו מחדש בכתובת החדשה.', wf_page: 'פתיחת דף ה-Wi-Fi המלא', wf_hidden: 'שם הרשת (רשת מוסתרת)',
      ad_title: 'מפתחות ומתקדם', ad_sub: 'ברירות מחדל בקובץ config.json של הגשר', ad_text: 'הערכים נשמרים בקובץ ההגדרות של הגשר (החלק „app”) וממלאים מראש כל מסך ואפליקציית ווב שמשתמשים בגשר הזה — וגם את המסך הזה מיד.',
      ad_cid: 'Spotify Client ID', ad_jf: 'שרת Jellyfin', ad_yt: 'מפתח YouTube Data API', ad_gcid: 'Google OAuth Client ID', ad_apple: 'Apple developer token', ad_save: 'שמירה בגשר',
      pr_title: 'העתקת ההגדרות למכשיר אחר', pr_sub: 'שיתוף ההתחברויות בין ה-Pi לאפליקציה במחשב', pr_name: 'שם הפרופיל', pr_signins: 'כולל התחברויות (טוקנים של החשבונות — לשמור בסוד)',
      pr_save: 'שמירת ההגדרות של המסך הזה', pr_list: 'פרופילים בגשר', pr_load: 'טעינה למסך הזה', pr_dl: 'הורדה', pr_none: 'עוד אין פרופילים.', pr_up: 'העלאת קובץ פרופיל',
      pr_how: 'במכשיר השני: הגדרות ← פרופילים ← טעינה (או פתחו את האפליקציה עם ‎?profile=NAME). כל מי שברשת יכול לקרוא פרופילים ששמורים בגשר.', pr_loaded: 'נטען — המסך מופעל מחדש',
      pr_signinsTag: 'עם התחברויות', pr_count: '{n} שמורים בגשר',
      noPi: 'Wi-Fi מוגדר רק במסך של ה-Raspberry Pi.',
    },
  };
  let lang = ls.get('lang') || (/^(he|iw)/i.test(navigator.language || '') ? 'he' : 'en');
  const t = (k, v) => { let s = (T[lang] || T.en)[k] ?? T.en[k] ?? k; if (v) s = String(s).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? ''); return s; };

  // ------------------------------------------------------------------ state
  let sid = ls.get('sid') || '';
  let session = null, ds = null, bs = null, info = null, es = null, pollT = 0, since = +(ls.get('since') || 0), errs = 0;
  const results = (() => { try { return JSON.parse(sessionStorage.getItem('rrsetup.results') || '{}'); } catch { return {}; } })();
  const hooks = {};     // svc → fn(reply) for flows that show something mid-way (Plex link, Quick Connect code, Wi-Fi list)
  const cards = {};     // id → { el, body, res, chip, small, spec }
  const open = new Set((() => { try { return JSON.parse(ls.get('open') || '[]'); } catch { return []; } })());
  const focusSvc = (q.get('s') || location.hash.slice(1) || '').replace(/[^\w-]/g, '');

  async function api(path, body, method) {
    let r;
    try { r = await fetch(path, body !== undefined ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' }); }
    catch { const e = new Error(t('offline')); e.net = true; throw e; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return d;
  }
  function toast(msg, err) { const e = $('#toast'); e.textContent = msg; e.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (e.className = 'toast'), 2600); }
  const guess = () => {
    const u = navigator.userAgent || '';
    if (/iPhone/.test(u)) return ['iPhone', 'phone']; if (/iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1)) return ['iPad', 'tablet'];
    if (/Android/.test(u)) return /Mobile/.test(u) ? ['Android phone', 'phone'] : ['Android tablet', 'tablet'];
    if (/Windows/.test(u)) return ['Windows PC', 'computer']; if (/Macintosh/.test(u)) return ['Mac', 'computer']; if (/CrOS/.test(u)) return ['Chromebook', 'computer'];
    if (/Linux/.test(u)) return ['Linux computer', 'computer']; return ['Phone', 'phone'];
  };

  // ------------------------------------------------------------------ pairing
  async function join({ code, token, display }) {
    const name = ($('#devname').value || '').trim().slice(0, 40) || guess()[0];
    ls.set('name', name);
    $('#perr').textContent = '';
    $('#go').disabled = true; $('#go').textContent = t('connecting');
    try {
      const d = await api('/api/setup/join', { code, token, display, name, kind: guess()[1] });
      sid = d.sid; ls.set('sid', sid); since = 0; ls.set('since', '0');
      session = d; ds = d.status || null;
      showMain();
    } catch (e) {
      $('#perr').textContent = e.message;
      if (token) { history.replaceState(null, '', location.pathname + (focusSvc ? '?s=' + focusSvc : '')); $('#code').focus(); }
    }
    $('#go').disabled = false; $('#go').textContent = t('connect');
  }
  function showPair(msg) {
    sid = ''; ls.del('sid'); session = null;
    try { es && es.close(); } catch {} es = null; clearTimeout(pollT);
    $('#pair').hidden = false; $('#main').hidden = true;
    if (msg) $('#perr').textContent = msg;
    paintHeader();
  }

  // ------------------------------------------------------------------ live link
  function connect() {
    try { es && es.close(); } catch {} es = null; clearTimeout(pollT);
    if (!sid) return;
    if (!window.EventSource || errs > 4) return poll();
    es = new EventSource('/api/setup/events?sid=' + encodeURIComponent(sid) + '&since=' + since);
    es.addEventListener('session', (e) => { errs = 0; session = { ...session, ...JSON.parse(e.data) }; paintHeader(); });
    es.addEventListener('status', (e) => { ds = JSON.parse(e.data); paintAll(); });
    es.addEventListener('reply', (e) => onReply(JSON.parse(e.data)));
    es.addEventListener('bye', (e) => { const d = JSON.parse(e.data); showPair(d.reason === 'kicked' ? t('kicked') : t('ended')); });
    es.onerror = () => {
      errs++;
      if (es && es.readyState === 2) {
        es = null;
        api('/api/setup/state?sid=' + encodeURIComponent(sid) + '&since=' + since).then(() => setTimeout(connect, 1500))
          .catch((x) => { if (x.status === 401) showPair(t('ended')); else setTimeout(connect, 3000); });
      }
    };
  }
  async function poll() {
    clearTimeout(pollT);
    if (!sid) return;
    try {
      const d = await api('/api/setup/state?sid=' + encodeURIComponent(sid) + '&since=' + since);
      session = { ...session, ...d.session }; ds = d.status; paintAll();
      for (const r of d.replies || []) onReply(r);
    } catch (e) { if (e.status === 401) return showPair(t('ended')); }
    pollT = setTimeout(poll, 2000);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sid && (!es || es.readyState !== 1)) { errs = 0; connect(); } });

  function setResult(svc, r) {
    if (!svc) return;
    results[svc] = { stage: r.stage || 'done', ok: r.ok !== false, message: r.message || '', at: Date.now() };
    try { sessionStorage.setItem('rrsetup.results', JSON.stringify(results)); } catch {}
    paintResult(svc);
  }
  function onReply(r) {
    if (r.rid) { since = Math.max(since, r.rid); ls.set('since', String(since)); }
    if (r.svc) setResult(r.svc, r);
    try { hooks[r.svc]?.(r); } catch (e) { console.error(e); }
    if (r.stage === 'done' && r.ok) refreshBridge();
  }
  async function act(type, data, svc) {
    const ref = 'r' + Math.random().toString(36).slice(2, 10);
    setResult(svc, { stage: 'progress', message: t('sending') });
    try {
      const d = await api('/api/setup/act', { sid, type, ref, svc, data: data || {} });
      if (!d.displayOnline) setResult(svc, { stage: 'progress', message: t('asleep') });
    } catch (e) { setResult(svc, { ok: false, message: e.message }); if (e.status === 401) showPair(t('ended')); throw e; }
    return ref;
  }
  async function bridgeOp(kind, data, svc, okMsg) {
    if (svc) setResult(svc, { stage: 'progress', message: t('saving') });
    try {
      const d = await api('/api/setup/bridge', { sid, kind, data: data || {} });
      if (svc) setResult(svc, { ok: true, message: typeof okMsg === 'function' ? okMsg(d) : (okMsg || t('saved')) });
      if (kind !== 'status') refreshBridge();
      return d;
    } catch (e) { if (svc) setResult(svc, { ok: false, message: e.message }); if (e.status === 401) showPair(t('ended')); throw e; }
  }
  async function refreshBridge() {
    if (!sid) return;
    try { bs = await api('/api/setup/bridge', { sid, kind: 'status', data: {} }); paintAll(); } catch {}
  }

  // ------------------------------------------------------------------ small UI helpers
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  function fld(id, label, { ph = '', type = 'text', value = '', secret = false, hint = '', mode = '', auto = 'off', dir = 'ltr' } = {}) {
    const input = el('input', { class: 'in', id, type: secret ? 'password' : type, placeholder: ph, autocomplete: auto, autocapitalize: 'off', spellcheck: 'false', inputmode: mode || null, dir });
    input.value = value || '';
    const box = secret ? el('div', { class: 'pw' }, input, el('button', { type: 'button', text: t('show'), onclick: (e) => { const sh = input.type === 'password'; input.type = sh ? 'text' : 'password'; e.target.textContent = sh ? t('hide') : t('show'); } })) : input;
    return [el('label', { class: 'l', for: id, text: label }), box, hint ? el('div', { class: 'hint', text: hint }) : null].filter(Boolean);
  }
  const btn = (label, onclick, cls = '') => el('button', { type: 'button', class: 'btn ' + cls, onclick: async (e) => { const b = e.currentTarget; if (b.disabled) return; b.disabled = true; try { await onclick(e); } catch (x) { console.info(x.message); } finally { b.disabled = false; } } }, label);
  const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: text || href.replace(/^https?:\/\//, '') });
  function uri(text) {
    const c = el('code', { text, dir: 'ltr' });
    return el('div', { class: 'uri' }, c, el('button', { type: 'button', class: 'btn sm ghost', text: t('copy'), onclick: (e) => copy(text, e.target) }));
  }
  async function copy(text, b) {
    let ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch {}
    if (!ok) { const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select(); try { ok = document.execCommand('copy'); } catch {} ta.remove(); }
    if (ok && b) { const o = b.textContent; b.textContent = t('copied'); setTimeout(() => (b.textContent = o), 1400); }
  }
  const steps = (...items) => el('ol', { class: 'steps' }, items.filter(Boolean).map((x) => el('li', {}, x)));
  const need = (field, msg) => { const v = val(field); if (!v) { document.getElementById(field)?.focus(); throw Object.assign(new Error(msg || '…'), { quiet: true }); } return v; };
  const fill = (id, v) => { const i = document.getElementById(id); if (i && !i.value && v && document.activeElement !== i && !i.dataset.touched) i.value = v; };
  document.addEventListener('input', (e) => { if (e.target.matches?.('.in')) e.target.dataset.touched = '1'; });
  const S = (id) => ds?.services?.[id] || null;
  const V = () => ds?.values || {};

  // ------------------------------------------------------------------ PKCE (Spotify) — crypto.subtle only exists on https, so SHA-256 is done here
  function sha256(bytes) {
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
    m.set(bytes); m[l] = 0x80; const bits = l * 8; for (let i = 0; i < 4; i++) m[n - 1 - i] = (bits >>> (8 * i)) & 255;
    const w = new Uint32Array(64), r = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) { const a = w[i - 15], c = w[i - 2]; w[i] = (w[i - 16] + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + w[i - 7] + (r(c, 17) ^ r(c, 19) ^ (c >>> 10))) | 0; }
      let [A, B, C, D, E, F, G, X] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (X + (r(E, 6) ^ r(E, 11) ^ r(E, 25)) + ((E & F) ^ (~E & G)) + K[i] + w[i]) | 0;
        const t2 = ((r(A, 2) ^ r(A, 13) ^ r(A, 22)) + ((A & B) ^ (A & C) ^ (B & C))) | 0;
        X = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
      }
      H[0] = (H[0] + A) | 0; H[1] = (H[1] + B) | 0; H[2] = (H[2] + C) | 0; H[3] = (H[3] + D) | 0; H[4] = (H[4] + E) | 0; H[5] = (H[5] + F) | 0; H[6] = (H[6] + G) | 0; H[7] = (H[7] + X) | 0;
    }
    const out = new Uint8Array(32); H.forEach((h, i) => { out[4 * i] = h >>> 24; out[4 * i + 1] = (h >>> 16) & 255; out[4 * i + 2] = (h >>> 8) & 255; out[4 * i + 3] = h & 255; });
    return out;
  }
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randStr = (n) => { const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'; return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => abc[b % abc.length]).join(''); };
  const relay = () => V().spotifyRelay || info?.relay || 'https://royborkin.github.io/RoundSpotify/';
  function spotifySignIn() {
    const clientId = val('sp-cid') || V().spotifyClientId || '';
    if (!clientId) { document.getElementById('sp-cid').focus(); return; }
    const verifier = randStr(64), nonce = randStr(16);
    const challenge = b64url(sha256(new TextEncoder().encode(verifier)));
    const redirect = relay();
    ls.set('sp', JSON.stringify({ verifier, nonce, clientId, redirect, at: Date.now() }));
    const state = 'rrsetup.' + b64url(new TextEncoder().encode(JSON.stringify({ o: location.origin, n: nonce })));
    const scope = V().spotifyScopes || 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-library-read streaming user-read-email user-read-private';
    const p = new URLSearchParams({ response_type: 'code', client_id: clientId, scope, redirect_uri: redirect, code_challenge_method: 'S256', code_challenge: challenge, state });
    location.href = 'https://accounts.spotify.com/authorize?' + p;
  }
  async function spotifyReturn() {
    const code = q.get('sp_code'), err = q.get('sp_error'), st = q.get('sp_state');
    if (!code && !err) return;
    history.replaceState(null, '', location.pathname + '?s=spotify');
    open.add('spotify');
    let saved = null; try { saved = JSON.parse(ls.get('sp') || 'null'); } catch {}
    ls.del('sp');
    if (err) return setResult('spotify', { ok: false, message: t('sp_err', { e: err }) });
    let n = '';
    try { n = JSON.parse(atob((st || '').slice(8).replace(/-/g, '+').replace(/_/g, '/'))).n; } catch {}
    if (!saved || saved.nonce !== n) return setResult('spotify', { ok: false, message: t('sp_state') });
    setResult('spotify', { stage: 'progress', message: t('sp_back') });
    await act('spotify-code', { code, verifier: saved.verifier, redirectUri: saved.redirect, clientId: saved.clientId }, 'spotify').catch(() => {});
  }

  // ------------------------------------------------------------------ the services
  const GROUPS = [['music', 'g_music'], ['media', 'g_media'], ['home', 'g_home'], ['collect', 'g_collect'], ['device', 'g_device'], ['adv', 'g_adv']];
  const st = (s, text) => ({ s, text });
  const fromDs = (id) => { const x = S(id); return x ? st(x.state, x.text) : st('todo', ''); };
  const SPECS = [
    { id: 'spotify', g: 'music', name: 'Spotify', c: '#1ed760', mono: 'Sp', dark: true, sub: 'sp_sub', state: () => fromDs('spotify'), build(b) {
      b.append(...fld('sp-cid', t('sp_cid'), { value: V().spotifyClientId, ph: '32 letters and digits', hint: t('sp_cidHint') }),
        el('div', { class: 'row' }, btn(t('save'), () => act('spotify-client', { clientId: need('sp-cid') }, 'spotify'), 'ghost')),
        el('div', { class: 'note', text: t('sp_redirect') }), el('div', { id: 'sp-relay' }, uri(relay())),
        el('div', { class: 'note', text: t('sp_users') }),
        el('button', { type: 'button', class: 'big', id: 'sp-go', onclick: spotifySignIn }, t('sp_signin')));
    }, update() { fill('sp-cid', V().spotifyClientId); const r = $('#sp-relay code'); if (r && r.textContent !== relay()) r.textContent = relay(); } },

    { id: 'apple', g: 'music', name: 'Apple Music', c: '#fa2d48', mono: 'Am', sub: 'ap_sub', state: () => fromDs('apple'), build(b) {
      b.append(el('div', { class: 'note', text: t('ap_a') }), el('div', { class: 'sub2', text: 'MusicKit' }), el('div', { class: 'note', text: t('ap_b') }),
        steps(el('span', {}, t('ap_s1'), ' ', link('https://developer.apple.com/account/resources/authkeys/list', 'developer.apple.com')), t('ap_s2')),
        ...fld('ap-team', t('ap_team'), { ph: 'ABCDE12345', value: bs?.apple?.teamId }), ...fld('ap-key', t('ap_key'), { ph: 'XYZ9876543', value: bs?.apple?.keyId }),
        el('label', { class: 'l', for: 'ap-file', text: t('ap_file') }), el('input', { class: 'in', id: 'ap-file', type: 'file', accept: '.p8,application/pkcs8,text/plain', onchange: (e) => {
          const m = /AuthKey_([A-Z0-9]{10})/i.exec(e.target.files?.[0]?.name || ''); if (m && !val('ap-key')) document.getElementById('ap-key').value = m[1].toUpperCase(); } }),
        el('div', { class: 'row' }, btn(t('ap_upload'), async () => {
          const f = document.getElementById('ap-file').files?.[0];
          if (!f) { document.getElementById('ap-file').focus(); return; }
          const p8 = await f.text();
          await bridgeOp('apple-key', { teamId: need('ap-team'), keyId: need('ap-key'), p8 }, 'apple', (d) => t('ap_ready', { k: d.file }));
          await act('apple-check', {}, 'apple').catch(() => {});
        })),
        el('div', { class: 'sub2', text: t('ap_or') }), ...fld('ap-jwt', t('ap_token'), { secret: true, ph: 'eyJ…' }),
        el('div', { class: 'row' }, btn(t('save'), () => act('apple-token', { token: need('ap-jwt') }, 'apple'), 'ghost')),
        el('div', { class: 'note', text: t('ap_after') }));
    }, update() { fill('ap-team', bs?.apple?.teamId); fill('ap-key', bs?.apple?.keyId); } },

    { id: 'youtube', g: 'music', name: 'YouTube · YouTube Music', c: '#ff0033', mono: 'YT', sub: 'yt_sub', state: () => fromDs('youtube'), build(b) {
      b.append(steps(el('span', {}, link('https://console.cloud.google.com/apis/library/youtube.googleapis.com', 'console.cloud.google.com'), ' — ', t('yt_s1')), t('yt_s2')),
        ...fld('yt-key', t('yt_key'), { secret: true, ph: V().youtubeKey ? '•••••••• ' + t('co_keep') : 'AIza…' }), ...fld('yt-cid', t('yt_cid'), { value: V().googleClientId, ph: '….apps.googleusercontent.com' }),
        el('div', { class: 'row' }, btn(t('yt_save'), () => { const key = val('yt-key'), cid = val('yt-cid'); return act('youtube', { apiKey: key || undefined, clientId: cid }, 'youtube'); })),
        el('div', { class: 'note', text: t('yt_note') }));
    }, update() { fill('yt-cid', V().googleClientId); } },

    { id: 'plex', g: 'music', name: 'Plex · Plexamp', c: '#e5a00d', mono: 'Px', dark: true, sub: 'px_sub', state: () => fromDs('plex'), build(b) {
      const area = el('div', { id: 'px-area' });
      b.append(el('button', { type: 'button', class: 'big', onclick: () => { area.textContent = ''; act('plex-start', {}, 'plex').catch(() => {}); } }, t('px_start')), area);
      hooks.plex = (r) => {
        if (r.stage === 'progress' && r.data?.authUrl) {
          area.textContent = '';
          area.append(el('a', { class: 'btn', href: r.data.authUrl, target: '_blank', rel: 'noopener', style: 'margin-top:12px;width:100%' }, t('px_open')),
            el('div', { class: 'note', text: t('px_or') }), el('div', { class: 'bigcode', text: r.data.code || '' }),
            el('div', { class: 'row' }, link('https://plex.tv/link', 'plex.tv/link'), el('span', { style: 'flex:1' }), btn(t('cancel'), () => { area.textContent = ''; return act('plex-cancel', {}, 'plex'); }, 'ghost sm')));
        }
        if (r.stage === 'done') area.textContent = '';
      };
    } },

    { id: 'jellyfin', g: 'music', name: 'Jellyfin', c: '#9b6bf2', mono: 'Jf', sub: 'jf_sub', state: () => fromDs('jellyfin'), build(b) {
      let mode = 'qc';
      const seg = el('div', { class: 'seg' });
      const qc = el('div', { id: 'jf-qc' }), pw = el('div', { id: 'jf-pw', hidden: true });
      const paintSeg = () => { seg.textContent = ''; for (const [k, l] of [['qc', t('jf_qc')], ['pw', t('jf_pw')]]) seg.append(el('button', { type: 'button', class: mode === k ? 'on' : '', text: l, onclick: () => { mode = k; qc.hidden = k !== 'qc'; pw.hidden = k !== 'pw'; paintSeg(); } })); };
      paintSeg();
      const qcArea = el('div');
      qc.append(el('div', { class: 'row' }, btn(t('jf_qcStart'), () => { qcArea.textContent = ''; return act('jellyfin-qc', { server: need('jf-server') }, 'jellyfin'); })), qcArea);
      pw.append(...fld('jf-user', t('jf_user'), { auto: 'username', dir: 'auto' }), ...fld('jf-pass', t('jf_pass'), { secret: true, auto: 'current-password', dir: 'auto' }),
        el('div', { class: 'row' }, btn(t('jf_signin'), () => act('jellyfin-login', { server: need('jf-server'), user: need('jf-user'), pass: document.getElementById('jf-pass').value }, 'jellyfin'))));
      b.append(...fld('jf-server', t('jf_server'), { value: V().jellyfinServer, ph: 'http://192.168.1.20:8096', mode: 'url' }), seg, qc, pw);
      hooks.jellyfin = (r) => {
        if (r.stage === 'progress' && r.data?.code) { qcArea.textContent = ''; qcArea.append(el('div', { class: 'note', text: t('jf_qcHow') }), el('div', { class: 'bigcode', text: r.data.code }), el('div', { class: 'row end' }, btn(t('cancel'), () => { qcArea.textContent = ''; return act('jellyfin-cancel', {}, 'jellyfin'); }, 'ghost sm'))); }
        if (r.stage === 'done') { qcArea.textContent = ''; const p = document.getElementById('jf-pass'); if (p) p.value = ''; }
      };
    }, update() { fill('jf-server', V().jellyfinServer); } },

    { id: 'bridgesvc', g: 'music', name: null, title: 'br_title', c: '#a78bfa', mono: '◎', sub: 'br_sub', state: () => {
      if (!bs) return st('na', '');
      const on = ['roon', 'upnp', 'cast', 'airplay'].filter((k) => bs.adapters?.[k]?.enabled);
      return on.length ? st('info', on.join(' · ')) : st('warn', t('needBridge'));
    }, build(b) {
      b.append(el('div', { class: 'note', text: t('br_text') }), el('div', { class: 'adapters', id: 'br-list' }));
    }, update() {
      const l = $('#br-list'); if (!l || !bs) return; l.textContent = '';
      for (const [k, n] of [['roon', 'Roon'], ['upnp', 'UPnP / DLNA'], ['cast', 'Google Cast'], ['airplay', 'AirPlay'], ['cider', 'Cider'], ['mpris', 'Computer (Linux)'], ['winmedia', 'Computer (Windows)'], ['streamsdk', 'Streamer']]) {
        const a = bs.adapters?.[k]; if (!a) continue;
        l.append(el('div', { title: a.status }, el('span', { class: 'dot ' + (a.enabled ? 'ok' : '') }), n));
      }
    } },

    { id: 'tvs', g: 'media', name: null, title: 'tv_title', c: '#4285f4', mono: 'TV', sub: 'tv_sub', state: () => {
      const n = (V().tvs || 0); return n ? st('ok', String(n)) : (bs && !bs.adapters?.androidtv?.enabled && !bs.adapters?.appletv?.enabled && !bs.adapters?.youtubetv?.enabled ? st('warn', t('needBridge')) : st('todo', ''));
    }, build(b) {
      let ad = 'androidtv';
      const seg = el('div', { class: 'seg' }), found = el('div', { class: 'list' }), mine = el('div', { class: 'list' }), codeArea = el('div');
      const paintSeg = () => { seg.textContent = ''; for (const [k, l] of [['androidtv', 'Google TV'], ['appletv', 'Apple TV']]) seg.append(el('button', { type: 'button', class: ad === k ? 'on' : '', text: l, onclick: () => { ad = k; found.textContent = ''; codeArea.textContent = ''; paintSeg(); loadMine(); } })); };
      const tv = (action, data = {}) => bridgeOp('tv', { adapter: ad, action, ...data }, 'tvs', (d) => (d?.name ? t('tv_paired', { n: d.name }) : t('saved')));
      async function loadMine() {
        mine.textContent = '';
        try {
          const list = await api('/api/setup/bridge', { sid, kind: 'tv', data: { adapter: ad, action: 'list' } });
          if (list?.length) mine.append(el('div', { class: 'sub2', text: t('tv_yours') }));
          for (const x of list || []) mine.append(el('div', { class: 'item' }, el('span', { class: 'dot ' + (x.connected ? 'ok' : '') }), el('div', { class: 't', text: x.name }),
            btn(t('tv_forget'), async () => { await tv('unpair', { host: x.host, id: x.id }); loadMine(); }, 'ghost sm')));
        } catch {}
      }
      const askCode = (host, msg) => {
        codeArea.textContent = '';
        codeArea.append(el('div', { class: 'note', text: msg || '' }), ...fld('tv-code', t('tv_code'), { ph: ad === 'appletv' ? '1234' : 'A1B2C3', mode: ad === 'appletv' ? 'numeric' : '' }),
          el('div', { class: 'row' }, btn(t('tv_send'), async () => {
            const r = await tv('code', { host, code: need('tv-code') });
            if (r?.next) askCode(host, r.message); else { codeArea.textContent = ''; loadMine(); }
          })));
        document.getElementById('tv-code')?.focus();
      };
      const pair = async (host, name) => { const r = await tv('pair', { host, name }); if (r?.id) { loadMine(); return; } askCode(host, r?.message); };
      b.append(seg,
        el('div', { class: 'row' }, btn(t('tv_find'), async () => {
          found.textContent = '';
          const list = await bridgeOp('tv', { adapter: ad, action: 'discover' }, 'tvs', (d) => (d?.length ? '' : t('tv_none')));
          for (const x of list || []) found.append(el('div', { class: 'item' }, el('div', { class: 't' }, x.name, el('small', { text: x.host })), x.paired ? el('span', { class: 'st ok', text: '✓' }) : btn(t('tv_pair'), () => pair(x.host, x.name), 'sm')));
        }, 'ghost')), found,
        ...fld('tv-ip', t('tv_ip'), { ph: '192.168.1.50', mode: 'decimal' }), el('div', { class: 'row' }, btn(t('tv_pair'), () => pair(need('tv-ip')), 'ghost')), codeArea, mine,
        el('div', { class: 'sub2', text: t('tv_yt') }), el('div', { class: 'note', text: t('tv_ytHow') }), ...fld('yt-tv', 'Code', { ph: '123 456 789 012', mode: 'numeric' }),
        el('div', { class: 'row' }, btn(t('tv_link'), () => bridgeOp('tv', { adapter: 'youtubetv', action: 'pair', code: need('yt-tv') }, 'tvs', (d) => t('tv_paired', { n: d?.name || 'TV' })))),
        el('div', { class: 'note', text: t('tv_media') }));
      paintSeg();
      this.onOpen = loadMine;
    } },

    { id: 'homeassistant', g: 'home', name: 'Home Assistant', c: '#18bcf2', mono: 'HA', sub: 'ha_sub', state: () => fromDs('homeassistant'), build(b) {
      const prof = el('a', { class: 'btn ghost sm', target: '_blank', rel: 'noopener', id: 'ha-prof', style: 'margin-top:10px' }, t('ha_open'));
      const upd = () => { let u = val('ha-url') || V().haUrl || ''; if (u && !/^https?:\/\//.test(u)) u = 'http://' + u; prof.href = u ? u.replace(/\/+$/, '') + '/profile/security' : 'https://my.home-assistant.io/redirect/profile/'; };
      b.append(...fld('ha-url', t('ha_url'), { value: V().haUrl, ph: 'http://homeassistant.local:8123', mode: 'url' }),
        steps(t('ha_s1')), prof, ...fld('ha-token', t('ha_token'), { secret: true, ph: S('homeassistant')?.state === 'ok' ? t('co_keep') : 'eyJ0eXAiOiJKV1Qi…' }),
        el('div', { class: 'row' }, btn(t('ha_connect'), () => act('ha', { url: need('ha-url'), token: val('ha-token') }, 'homeassistant'))));
      b.querySelector('#ha-url').addEventListener('input', upd); upd();
      hooks.homeassistant = (r) => { if (r.stage === 'done' && r.ok) { const i = document.getElementById('ha-token'); if (i) i.value = ''; } };
    }, update() { fill('ha-url', V().haUrl); } },

    { id: 'googlehome', g: 'home', name: 'Google Home', c: '#4285f4', mono: 'GH', sub: 'gh_sub', state: () => {
      const g = bs?.googlehome; if (!bs) return st('na', ''); if (!g) return st('warn', t('needBridge'));
      return g.signedIn ? st('ok', g.account || '') : g.hasClient ? st('warn', t('gh_s2').split(' (')[0]) : st('todo', '');
    }, build(b) {
      const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
      b.append(steps(el('span', {}, link('https://console.cloud.google.com', 'console.cloud.google.com'), ' — ', t('gh_s1'))),
        ...fld('gh-cid', t('gh_cid'), { value: bs?.googlehome?.clientId, ph: '….apps.googleusercontent.com' }), ...fld('gh-secret', t('gh_secret'), { secret: true, ph: 'GOCSPX-…' }),
        el('div', { class: 'row' }, btn(t('gh_save'), () => bridgeOp('googlehome', { clientId: need('gh-cid'), clientSecret: need('gh-secret') }, 'googlehome'))),
        el('div', { class: 'note', text: t('gh_s2') }), uri(`http://localhost:${location.port || 80}/api/adapters/googlehome/signin`),
        local ? el('a', { class: 'big', href: '/api/adapters/googlehome/signin', target: '_blank', rel: 'noopener' }, t('gh_here')) : '');
    }, update() { fill('gh-cid', bs?.googlehome?.clientId); } },

    { id: 'playstation', g: 'home', name: 'PlayStation', c: '#3b8ef0', mono: 'PS', sub: 'ps_sub', state: () => {
      if (!bs) return st('na', ''); const p = bs.psn; if (!p) return st('warn', t('needBridge'));
      return p.signedIn ? st('ok', p.onlineId) : st('todo', '');
    }, build(b) {
      b.append(steps(el('span', {}, t('ps_s1'), ' ', link('https://www.playstation.com', 'playstation.com')), el('span', {}, t('ps_s2'), ' ', link('https://ca.account.sony.com/api/v1/ssocookie', 'ca.account.sony.com/api/v1/ssocookie')), t('ps_s3')),
        ...fld('ps-npsso', t('ps_npsso'), { secret: true, ph: '64 letters and digits' }),
        el('div', { class: 'row' }, btn(t('ps_signin'), async () => { await bridgeOp('psn', { npsso: need('ps-npsso') }, 'playstation', (d) => `✓ ${d.onlineId || 'PlayStation Network'}`); document.getElementById('ps-npsso').value = ''; })));
    } },

    { id: 'steam', g: 'home', name: 'Steam', c: '#66c0f4', mono: 'St', dark: true, sub: 'st_sub', state: () => {
      if (!bs) return st('na', ''); const s = bs.steam; if (!s) return st('warn', t('needBridge'));
      return s.signedIn ? st('ok', s.name || s.steamId) : st('todo', '');
    }, build(b) {
      b.append(steps(el('span', {}, t('st_s1'), ' ', link('https://steamcommunity.com/dev/apikey', 'steamcommunity.com/dev/apikey'))),
        ...fld('st-key', t('st_key'), { secret: true, ph: bs?.steam?.hasKey ? t('co_keep') : '32 letters and digits' }), ...fld('st-user', t('st_user'), { value: bs?.steam?.steamId, ph: t('st_userPh'), dir: 'auto' }),
        steps(t('st_s3')),
        el('div', { class: 'row' }, btn(t('st_connect'), async () => { await bridgeOp('steam', { apiKey: val('st-key'), user: need('st-user') }, 'steam', (d) => `✓ ${d.name}${d.public === false ? ' — profile is private' : ''}`); document.getElementById('st-key').value = ''; })));
    }, update() { fill('st-user', bs?.steam?.steamId); } },

    { id: 'streamer', g: 'home', name: null, title: 'fs_title', c: '#f2a33a', mono: 'S3', dark: true, sub: 'fs_sub', state: () => fromDs('streamer'), build(b) {
      b.append(...fld('fs-ip', t('fs_ip'), { value: V().streamerHost, ph: '192.168.50.156', mode: 'url', hint: t('fs_hint') }),
        el('div', { class: 'row' }, btn(t('fs_test'), () => act('streamer', { host: need('fs-ip') }, 'streamer'))));
    }, update() { fill('fs-ip', V().streamerHost); } },

    { id: 'alerts', g: 'home', name: null, title: 'al_title', c: '#f59e0b', mono: '!', dark: true, sub: 'al_sub', count: false, state: () => {
      const a = V().alerts; if (!a) return st('na', '');
      return st(a.lights || a.speaker || a.notify || a.gh ? 'ok' : 'todo', t('al_state', { l: a.lights || 0, s: a.speaker || t('al_none'), p: a.notify || t('al_none') }));
    }, build(b) {
      b.append(el('div', { class: 'note', text: t('al_text') }), el('div', { class: 'row' }, btn(t('al_test'), () => act('alert-test', {}, 'alerts'), 'ghost')));
    } },

    { id: 'collection', g: 'collect', name: null, title: 'co_title', c: '#22c55e', mono: 'Co', sub: 'co_sub', state: () => {
      const c = bs?.collection; if (!bs) return st('na', ''); if (!c) return st('warn', t('needBridge'));
      const on = [c.bgg?.hasToken && 'BGG', c.pricecharting?.hasToken && 'PriceCharting', c.rawg?.hasKey && 'RAWG', c.discogs?.hasToken && 'Discogs', c.tmdb?.hasKey && 'TMDB'].filter(Boolean);
      return on.length ? st('ok', on.join(' · ')) : st('todo', '');
    }, build(b) {
      const c = () => bs?.collection || {};
      const part = (key, title, hint, fields) => {
        const ids = fields.map(([f]) => `co-${key}-${f}`);
        return el('div', {}, el('div', { class: 'sub2', id: `co-${key}-t`, text: title }), el('div', { class: 'hint', text: hint }),
          ...fields.flatMap(([f, label, secret]) => fld(`co-${key}-${f}`, label, { secret, ph: secret && (c()[key]?.hasToken || c()[key]?.hasKey) ? t('co_keep') : '', value: secret ? '' : c()[key]?.[f], dir: secret ? 'ltr' : 'auto' })),
          el('div', { class: 'row' }, btn(t('save'), () => {
            const o = {}; fields.forEach(([f, , secret], i) => { const v = val(ids[i]); if (v || !secret) o[f] = v; });
            return bridgeOp('collection', { [key]: o }, 'collection');
          }, 'ghost sm')));
      };
      b.append(part('bgg', 'BoardGameGeek', t('co_bgg'), [['username', t('co_user')], ['token', t('co_token'), true]]),
        part('pricecharting', 'PriceCharting', t('co_pc'), [['token', t('co_token'), true]]),
        part('rawg', 'RAWG', t('co_rawg'), [['username', t('co_user')], ['key', t('co_key'), true]]),
        part('discogs', 'Discogs', t('co_discogs'), [['username', t('co_user')], ['token', t('co_token'), true]]),
        part('tmdb', 'TMDB', t('co_tmdb'), [['key', t('co_key'), true]]));
    }, update() {
      const c = bs?.collection; if (!c) return;
      for (const [k, n] of [['bgg', 'BoardGameGeek'], ['pricecharting', 'PriceCharting'], ['rawg', 'RAWG'], ['discogs', 'Discogs'], ['tmdb', 'TMDB']]) {
        const h = document.getElementById(`co-${k}-t`); if (h) h.textContent = n + (c[k]?.hasToken || c[k]?.hasKey ? ` · ✓ ${t('co_set')}` : '');
        fill(`co-${k}-username`, c[k]?.username);
      }
    } },

    { id: 'wifi', g: 'device', name: null, title: 'wf_title', c: '#0ea5e9', mono: '((·))', sub: 'wf_sub', count: false, hidden: () => !ds?.display?.pi, state: () => {
      const w = V().wifi; if (!w) return st('na', '');
      return w.ssid ? st('ok', t('wf_now', { s: w.ssid })) : st('todo', t('wf_none'));
    }, build(b) {
      const list = el('div', { class: 'list' });
      b.append(el('div', { class: 'row' }, btn(t('wf_scan'), () => act('wifi-scan', {}, 'wifi'), 'ghost')), list,
        ...fld('wf-ssid', t('wf_hidden'), { dir: 'auto' }), ...fld('wf-pass', t('wf_pass'), { secret: true }),
        el('div', { class: 'row' }, btn(t('wf_join'), () => act('wifi-connect', { ssid: need('wf-ssid'), password: document.getElementById('wf-pass').value }, 'wifi'))),
        el('div', { class: 'note', text: t('wf_warn') }), el('div', { class: 'row' }, el('a', { class: 'btn ghost sm', href: '/system/wifi' }, t('wf_page'))));
      hooks.wifi = (r) => {
        if (r.stage !== 'done' || !Array.isArray(r.data?.networks)) return;
        list.textContent = '';
        for (const n of r.data.networks.slice(0, 15)) {
          list.append(el('label', { class: 'item' }, el('input', { type: 'radio', name: 'wfn', onchange: () => { document.getElementById('wf-ssid').value = n.ssid; document.getElementById('wf-pass').focus(); } }),
            el('div', { class: 't' }, el('span', { dir: 'auto', text: n.ssid }), el('small', { text: `${n.signal ?? '?'}% · ${n.security || 'open'}${n.inUse ? ' · ✓' : ''}` }))));
        }
      };
    } },

    { id: 'advanced', g: 'adv', name: null, title: 'ad_title', c: '#64748b', mono: '{ }', sub: 'ad_sub', count: false, state: () => (bs ? st('info', bs.configFile || 'config.json') : st('na', '')), build(b) {
      const a = () => bs?.app || {};
      b.append(el('div', { class: 'note', text: t('ad_text') }),
        ...fld('ad-cid', t('ad_cid'), { value: a().spotifyClientId }), ...fld('ad-jf', t('ad_jf'), { value: a().jellyfinServer, ph: 'http://192.168.1.20:8096' }),
        ...fld('ad-yt', t('ad_yt'), { secret: true, ph: a().youtubeApiKey ? t('co_keep') : 'AIza…' }), ...fld('ad-gcid', t('ad_gcid'), { value: a().googleClientId }),
        ...fld('ad-apple', t('ad_apple'), { secret: true, ph: a().appleDeveloperToken ? t('co_keep') : 'eyJ…' }),
        el('div', { class: 'row' }, btn(t('ad_save'), () => {
          const values = { spotifyClientId: val('ad-cid'), jellyfinServer: val('ad-jf'), googleClientId: val('ad-gcid') };
          if (val('ad-yt')) values.youtubeApiKey = val('ad-yt');
          if (val('ad-apple')) values.appleDeveloperToken = val('ad-apple');
          return bridgeOp('app', { values }, 'advanced');
        })));
    }, update() { const a = bs?.app || {}; fill('ad-cid', a.spotifyClientId); fill('ad-jf', a.jellyfinServer); fill('ad-gcid', a.googleClientId); } },

    { id: 'profiles', g: 'adv', name: null, title: 'pr_title', c: '#8b5cf6', mono: '⇄', sub: 'pr_sub', count: false, state: () => (bs ? st('info', t('pr_count', { n: bs.profiles?.length || 0 })) : st('na', '')), build(b) {
      const list = el('div', { class: 'list', id: 'pr-list' });
      const inc = el('input', { type: 'checkbox', id: 'pr-inc' });
      b.append(el('div', { class: 'note', text: t('pr_how') }),
        ...fld('pr-name', t('pr_name'), { value: V().profileName || ds?.display?.name || 'Round display', dir: 'auto' }),
        el('label', { class: 'check' }, inc, t('pr_signins')),
        el('div', { class: 'row' }, btn(t('pr_save'), () => act('profile-save', { name: need('pr-name'), signIns: inc.checked }, 'profiles'))),
        el('div', { class: 'sub2', text: t('pr_list') }), list,
        el('label', { class: 'l', for: 'pr-file', text: t('pr_up') }), el('input', { class: 'in', id: 'pr-file', type: 'file', accept: '.json,application/json', onchange: async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          let p; try { p = JSON.parse(await f.text()); } catch { setResult('profiles', { ok: false, message: 'Not a profile file' }); return; }
          await bridgeOp('profile-put', { profile: p, name: p.name || f.name.replace(/\.json$/i, '') }, 'profiles', (d) => `✓ ${d.name}`).catch(() => {});
          e.target.value = '';
        } }));
    }, update() {
      const l = $('#pr-list'); if (!l || !bs) return;
      const key = JSON.stringify(bs.profiles || []); if (l.dataset.k === key) return; l.dataset.k = key; l.textContent = '';
      if (!bs.profiles?.length) { l.append(el('div', { class: 'hint', text: t('pr_none') })); return; }
      for (const p of bs.profiles) {
        l.append(el('div', { class: 'item wrap' }, el('div', { class: 't' }, el('b', { dir: 'auto', text: p.name }), el('small', { text: [p.savedAt ? new Date(p.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '', p.signIns ? t('pr_signinsTag') : ''].filter(Boolean).join(' · ') })),
          el('a', { class: 'btn ghost sm', href: '/api/profiles/' + encodeURIComponent(p.name), download: `round-remote-${p.name}.json` }, t('pr_dl')),
          btn(t('pr_load'), () => act('profile-load', { name: p.name }, 'profiles'), 'sm')));
      }
    } },
  ];

  // ------------------------------------------------------------------ painting
  function buildCards() {
    const main = $('#cards'); main.textContent = '';
    const nav = $('#jump'); nav.textContent = '';
    for (const [g, key] of GROUPS) {
      const specs = SPECS.filter((s) => s.g === g);
      const head = el('h3', { class: 'grp', id: 'g-' + g, text: t(key) });
      const grid = el('div', { class: 'grid' });
      main.append(head, grid);
      nav.append(el('a', { href: '#g-' + g, 'data-g': g, text: t(key) }));
      for (const s of specs) {
        const chip = el('span', { class: 'st' }), detail = el('span', { class: 'd' }), small = el('small', {}, chip, detail), res = el('div', { class: 'res' });
        const body = el('div', { class: 'svc-b' });
        const head2 = el('button', { type: 'button', class: 'svc-h', 'aria-expanded': 'false', onclick: () => toggle(s.id) },
          el('span', { class: 'badge' + (s.dark ? ' dark' : ''), text: s.mono }), el('span', { class: 'svc-t' }, el('b', { text: s.name || t(s.title) }), small), el('span', { class: 'chev' }));
        const card = el('section', { class: 'svc' + (s.dark ? ' dk' : ''), id: 'c-' + s.id, '--c': s.c }, head2, body);
        body.hidden = true;
        grid.append(card);
        cards[s.id] = { el: card, body, res, chip, small: detail, spec: s, head: head2, built: false, grid, groupHead: head };
      }
    }
  }
  function toggle(id, force) {
    const c = cards[id]; if (!c) return;
    const on = force ?? c.body.hidden;
    if (on && !c.built) { c.spec.build.call(c.spec, c.body); c.body.append(c.res); c.built = true; c.spec.update?.(); }
    c.body.hidden = !on; c.el.classList.toggle('open', on); c.head.setAttribute('aria-expanded', String(on));
    if (on) { open.add(id); c.spec.onOpen?.(); } else open.delete(id);
    ls.set('open', JSON.stringify([...open]));
    paintResult(id);
  }
  function paintResult(svc) {
    const c = cards[svc]; if (!c) return;
    const r = results[svc]; c.res.textContent = ''; c.res.className = 'res';
    if (!r || !r.message || Date.now() - r.at > 30 * 60e3) return;
    c.res.className = 'res ' + (r.stage === 'progress' ? 'busy' : r.ok ? 'ok' : 'err');
    if (r.stage === 'progress') c.res.append(el('span', { class: 'spin' }));
    c.res.append(el('span', { dir: 'auto', text: r.message }));
  }
  const LABEL = { ok: 's_ok', todo: 's_todo', warn: 's_warn', na: 's_na', info: 's_info' };
  function paintAll() {
    paintHeader();
    let n = 0, total = 0;
    for (const c of Object.values(cards)) {
      const s = c.spec;
      const hide = !!s.hidden?.();
      c.el.hidden = hide;
      if (hide) continue;
      const x = s.state() || st('todo', '');
      c.chip.className = 'st ' + (x.s === 'ok' ? 'ok' : x.s === 'warn' ? 'warn' : '');
      c.chip.textContent = x.s === 'info' ? '' : t(LABEL[x.s] || 's_todo');
      c.small.textContent = x.text || t(s.sub);
      if (s.count !== false && x.s !== 'info' && x.s !== 'na') { total++; if (x.s === 'ok') n++; }
      if (c.built) s.update?.();
    }
    for (const [g] of GROUPS) {   // a group with every card hidden (e.g. Device off the Pi) disappears with its chip
      const vis = Object.values(cards).some((c) => c.spec.g === g && !c.el.hidden);
      const h = document.getElementById('g-' + g); if (h) h.hidden = !vis;
      const a = document.querySelector(`#jump a[data-g="${g}"]`); if (a) a.hidden = !vis;
    }
    const pct = total ? n / total : 0, C = 2 * Math.PI * 26;
    $('#ring-fg').setAttribute('stroke-dasharray', C.toFixed(1)); $('#ring-fg').setAttribute('stroke-dashoffset', (C * (1 - pct)).toFixed(1));
    $('#ring-t').textContent = `${n}/${total}`;
    $('#prog-h').textContent = t('progress', { n, t: total });
  }
  function paintHeader() {
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-t]').forEach((e) => (e.textContent = t(e.dataset.t)));
    $('#lang').textContent = lang === 'he' ? 'EN' : 'עב';
    const sub = $('#hsub'); sub.textContent = '';
    if (session && sid) {
      const on = session.displayOnline !== false;
      sub.append(el('span', { class: 'dot ' + (on ? 'ok' : 'warn') }), el('span', { dir: 'auto', text: t('connectedTo', { d: session.display || 'Round display' }) }));
      $('#c-name').textContent = session.display || 'Round display';
      const mins = Math.max(0, Math.ceil((session.exp - Date.now()) / 60000));
      $('#c-sub').textContent = `${on ? t('s_ok') : t('displayOff').split(' — ')[0]} · ${t('as', { n: session.name || '' })} · ${t('left', { m: mins })}`;
      $('#c-dot').className = 'dot ' + (on ? 'ok' : 'warn');
      $('#offbanner').hidden = on;
    } else sub.append(el('span', { text: 'Round Remote' }));
  }
  function showMain() {
    $('#pair').hidden = true; $('#main').hidden = false;
    if (!Object.keys(cards).length) buildCards();
    paintAll();
    connect();
    refreshBridge();
    for (const id of open) if (cards[id] && cards[id].body.hidden) toggle(id, true);
    if (focusSvc && cards[focusSvc]) { toggle(focusSvc, true); setTimeout(() => cards[focusSvc].el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250); }
    api('/api/setup/act', { sid, type: 'hello', svc: '', data: {} }).catch(() => {});
  }

  // ------------------------------------------------------------------ start
  $('#lang').onclick = () => {
    lang = lang === 'he' ? 'en' : 'he'; ls.set('lang', lang);
    const wasOpen = [...open];
    if (!$('#main').hidden) { buildCards(); for (const id of wasOpen) toggle(id, true); paintAll(); } else paintHeader();
  };
  $('#devname').value = ls.get('name') || guess()[0];
  $('#code').addEventListener('input', (e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); e.target.value = v; if (v.length === 6) join({ code: v }); });
  $('#go').onclick = () => { const v = val('code'); if (!/^\d{6}$/.test(v)) { $('#perr').textContent = t('wrongCode'); $('#code').focus(); return; } join({ code: v }); };
  $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#go').click(); });
  $('#bye').onclick = async () => { try { await api('/api/setup/leave', { sid }); } catch {} showPair(''); };
  setInterval(() => { if (session && sid) { paintHeader(); if (session.exp && Date.now() > session.exp + 5000) poll(); } }, 20000);
  api('/api/setup/info').then((d) => { info = d; if (!$('#main').hidden) paintAll(); }).catch(() => {});

  (async () => {
    paintHeader();
    const tok = q.get('t'), disp = q.get('d');
    if (sid) {
      try { const d = await api('/api/setup/state?sid=' + encodeURIComponent(sid) + '&since=' + since); session = d.session; ds = d.status; showMain(); for (const r of d.replies || []) onReply(r); await spotifyReturn(); return; }
      catch (e) { if (e.status !== 401) { $('#perr').textContent = e.message; } ls.del('sid'); sid = ''; }
    }
    if (tok && disp) { history.replaceState(null, '', location.pathname + (focusSvc ? '?s=' + focusSvc : '')); $('#pair').hidden = false; await join({ token: tok, display: disp }); if (sid) await spotifyReturn(); return; }
    showPair('');
    if (q.get('sp_code') || q.get('sp_error')) $('#perr').textContent = t('ended');
    setTimeout(() => $('#code').focus(), 100);
  })();
}

export const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f0e14"><meta name="color-scheme" content="dark light"><meta name="referrer" content="no-referrer">
<title>Set up Round Remote</title>
<style>${CSS}</style></head>
<body><div class="wrap">
<header class="top"><div class="logo"><i>RR</i></div><div><h1 data-t="title"></h1><div class="sub" id="hsub"></div></div><button class="lang" id="lang" type="button"></button></header>
<section id="pair" hidden><div class="card pairbox">
  <div class="disp" aria-hidden="true"><div><span>482 913</span><small>Round Remote</small></div></div>
  <h2 data-t="pairTitle"></h2><p data-t="pairText"></p>
  <input class="codein" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-label="code" dir="ltr">
  <label class="l" for="devname" data-t="yourDevice"></label><input class="in" id="devname" maxlength="40" autocomplete="off" dir="auto">
  <button class="big" id="go" type="button" data-t="connect"></button>
  <div class="perr" id="perr" role="alert"></div>
  <div class="fine" data-t="fine"></div>
</div></section>
<main id="main" hidden>
  <div class="card conn"><span class="dot" id="c-dot"></span><div class="who"><b id="c-name" dir="auto"></b><small id="c-sub" dir="auto"></small></div><button class="btn ghost sm" id="bye" type="button" data-t="disconnect"></button></div>
  <div class="banner" id="offbanner" hidden data-t="displayOff"></div>
  <div class="card prog"><svg class="ring" viewBox="0 0 64 64"><circle class="bgc" cx="32" cy="32" r="26"/><circle class="fgc" id="ring-fg" cx="32" cy="32" r="26" transform="rotate(-90 32 32)"/><text id="ring-t" x="32" y="37" text-anchor="middle"></text></svg>
    <div><h2 id="prog-h"></h2><p data-t="progressSub"></p></div></div>
  <nav class="jump" id="jump"></nav>
  <div id="cards"></div>
  <div class="foot">Round Remote</div>
</main>
<div class="toast" id="toast"></div>
</div>
<script>(${client.toString()})();</script>
</body></html>`;
