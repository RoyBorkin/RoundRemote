# Round Remote

A circular touch remote for your music services, built for a Raspberry Pi with a 4" round 720×720 touch display. It also runs as an ordinary web page, for example on GitHub Pages.

**▶ Try it: [royborkin.github.io/RoundSpotify](https://royborkin.github.io/RoundSpotify/)** (tap **Demo** to try it without an account)

## Screenshots

| Info | Info, controls hidden | Vinyl |
|:---:|:---:|:---:|
| <img src="screenshots/info.png" width="240" alt="Info view"> | <img src="screenshots/info-full.png" width="240" alt="Info view with full-screen artwork"> | <img src="screenshots/vinyl.png" width="240" alt="Vinyl view"> |
| **Lyrics: Fluid** | **Lyrics: Kinetic Type (Stack)** | **Video** |
| <img src="screenshots/lyrics-fluid.png" width="240" alt="Fluid lyrics"> | <img src="screenshots/lyrics-kinetic.png" width="240" alt="Kinetic Type lyrics"> | <img src="screenshots/video.png" width="240" alt="Video view"> |
| **Search + round keyboard** | **Volume dial** | **Settings** |
| <img src="screenshots/search.png" width="240" alt="Search with on-screen keyboard"> | <img src="screenshots/volume.png" width="240" alt="Volume dial"> | <img src="screenshots/settings.png" width="240" alt="Settings"> |

*Screenshots show Demo mode on a 720×720 round screen.*

Sign in to each service once. After that, one round screen lets you:
- control volume and seek
- skip forward and back
- pick playlists and devices
- search

The current song can be shown **four ways**:

1. **Info (classic):** round artwork, title, artist and album. The accent colour is taken from the artwork. When the controls hide, the artwork fills the whole screen, either *original clear* or *milky blur* (your choice).
2. **Vinyl:** the whole screen becomes a record.
   - Spin it with your finger to scrub back or forward; a flick keeps it coasting.
   - The tone arm follows the song and hides with the controls. To keep it visible, turn off *Hide the arm with the controls* in the ⋯ panel or in Settings.
   - **Record speed** (45 / 33⅓ / 16 / 8 / 4 rpm) sets both the spin and how far one turn scratches, so the record always moves with the music.
   - A slider sets the centre artwork size, from none to full screen.
3. **Lyrics:** synced lyrics in five styles:
   - **Basic**, **Typing** (typewriter) and **Roll** (3D drum).
   - **Fluid**, in the spirit of Lyricify / BetterLyrics: a flowing album-art colour field, lines that glide in a staggered cascade, and words that fill with a soft glow and lift as they're sung. Long notes glow letter by letter.
   - **Kinetic Type**, lyric-video typography with nine variants:
     - **Stack:** full-width words stacked like a poster.
     - **Camera:** the view pans, zooms and turns 90° between phrases.
     - **Slam:** one huge word at a time.
     - **Mosaic:** each word snaps onto the edge of the block, some turned sideways, in mixed typefaces, building an interlocking word puzzle (classic After Effects lyric-video style).
     - **Black & White:** heavy caps on black with a new scene for every line: giant words the camera flies through, words ticking along a rule, words around a planet or riding a wave, a block inside a ring, and black-on-white blocks with an hourglass wipe.
     - **Hand-drawn:** flat mint / indigo / pink palettes that change with a paint-splash wipe; small hand-lettered words over one big brush word that writes itself on, staircases and little planets; everything jitters like frame-by-frame animation.
     - **Animated:** karaoke fill.
     - **Moving Words**.
     - **Random:** a different variant for every line.
4. **Video:** like the classic view, but the background is a video:
   - **YouTube / YouTube Music:** the song's own video.
   - **Every other service:** the song's official music video, found on YouTube, played muted and kept in sync with the song. This needs the free YouTube API key (see below).
   - **Demo:** a generated colour loop.

In every view the controls hide by themselves after a few seconds; tap the screen to bring them back. The ring around the edge is the seek bar: drag it around the circle.

---

## Contents

1. [Services](#services)
2. [Put it on GitHub Pages](#1-put-it-on-github-pages)
3. [Set up each service](#2-set-up-each-service)
4. [The bridge (Roon, UPnP, Cast, AirPlay, Tidal, Qobuz)](#3-the-bridge)
5. [Raspberry Pi kiosk](#4-raspberry-pi-kiosk)
6. [Using the app](#5-using-the-app)
7. [Troubleshooting](#6-troubleshooting)
8. [Honest limits](#7-honest-limits)
9. [Project layout](#8-project-layout)

---

## Services

| Service | How it connects | Works from GitHub Pages? |
|---|---|---|
| **Spotify** | Web API (sign in once). Controls any of your Spotify devices, and the page itself can be a Spotify speaker. | ✅ |
| **Apple Music** | MusicKit JS. Plays *on this display*. Needs a developer token. | ✅ |
| **YouTube Music** | YouTube player on this display (search and your playlists), **or the YouTube app on your TV** once it's linked with a TV code. | ✅ (free API key); the TV needs the bridge |
| **YouTube** | Same, for any YouTube video. | ✅ (free API key); the TV needs the bridge |
| **Plex / Plexamp** | Sign in with a plex.tv code. Controls Plexamp (incl. headless) and Plex players through your server. | ✅ |
| **Jellyfin** | Quick Connect or username/password. Controls any Jellyfin app session and uses server lyrics when available. | ✅ (see [Jellyfin](#jellyfin) for http servers) |
| **Roon** | Official Roon extension API: zones, volume, playlists and search. | Needs the bridge |
| **UPnP / DLNA** | Standard AV renderers: WiiM, Bluesound, Denon/Marantz, BubbleUPnP, Volumio, moOde… | Needs the bridge |
| **Google Cast** | Chromecast, Nest and Cast speakers. Shows and controls whatever is *cast* to them (for apps opened directly on the TV, see [YouTube on your TV](#youtube-on-your-tv-google-tv-android-tv-smart-tvs-consoles)). | Needs the bridge |
| **AirPlay 1/2** | The Pi becomes an AirPlay speaker (shairport-sync) and controls the phone or Mac that's streaming. | Linux/Pi bridge only |
| **Tidal** | No public remote-control API. The tile follows TIDAL playing through Roon, Cast, UPnP or AirPlay. | Needs the bridge |
| **Qobuz** | Qobuz Connect is closed to third parties. Same approach as Tidal. | Needs the bridge |
| **Demo** | Fictional songs with original lyrics. Try everything without an account. | ✅ |

On the home screen:
- a green dot means you're signed in;
- services that still need the bridge show a small **BRIDGE** tag;
- *Settings → Show only signed-in services* hides everything you haven't set up.
- *Settings → Show the Demo service* hides or shows the Demo tile.

The platform logos come from the free [Simple Icons](https://simpleicons.org) set (jsDelivr, with unpkg as a backup). They're downloaded once and then kept in the browser, so the Pi shows them offline too. Qobuz isn't in that set, so its tile keeps its letters. Tiles show letters until a logo has been downloaded once.

---

## 1. Put it on GitHub Pages

The app is published from the existing **RoundSpotify** repository, at **[royborkin.github.io/RoundSpotify](https://royborkin.github.io/RoundSpotify/)**.

1. Replace the old files in [github.com/RoyBorkin/RoundSpotify](https://github.com/RoyBorkin/RoundSpotify) with **the contents** of this folder. Either:
   - on the web: delete the old `spotifyround.html`, `applemusicround.html`, `Vinyl1.png` and `Vinyl2.jpg`. Then choose *Add file → Upload files*, drag everything from this folder in (it replaces `index.html`) and click *Commit changes*; or
   - with git (from the `music remote` folder):
     ```bash
     cd RoundSpotify
     git rm -q spotifyround.html applemusicround.html Vinyl1.png Vinyl2.jpg
     cp -r ../RoundRemote/. .
     git add -A && git commit -m "Round Remote 2"
     git push
     ```
2. Check that Pages is on: in the repository, open **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save**.
3. After about a minute, the app is live at **https://royborkin.github.io/RoundSpotify/**.
4. Optional: in Chrome/Edge, click the *Install* icon in the address bar. It then opens full-screen like an app and also works offline.

To publish an update, upload the changed files again (or `git push`). If you still see the old version, reload once more; the offline cache refreshes in the background.

Tap **Demo** to try every screen straight away.

---

## 2. Set up each service

Settings are saved in the browser you use. The GitHub Pages site and the Pi each keep their own copy; on the Pi you can pre-fill them from `bridge/config.json` (see [Bridge config](#bridge-config)).

### Spotify

At [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), open your app. The Client ID from the old RoundSpotify project is already filled in; you can change it under *Settings → Service keys*.

1. **Redirect URIs:** add exactly the address shown on the app's Spotify screen, then *Save*:
   - GitHub Pages: `https://royborkin.github.io/RoundSpotify/`. This replaces the old `…/RoundSpotify/spotifyround.html` address.
   - Raspberry Pi: `http://127.0.0.1:8765/`. Spotify only accepts a loopback IP here, not `localhost`.
2. **User Management:** add the Spotify account you'll sign in with. Development-mode apps allow up to 5 users, and the app owner needs **Premium**.
3. In Round Remote, tap **Spotify → Sign in with Spotify**.

You can control any device running Spotify (phone, PC, speakers) and pick one under **Devices**. If nothing is active, pressing Play wakes the last device you used.

**This display as a speaker:** the page also appears in Spotify as a device called **"Round Remote"**, so you can play on it without opening Spotify anywhere else. This uses Spotify's Web Playback SDK and needs Premium. If you signed in before this feature existed, the Spotify screen shows **Sign in again**; tap it once. You can turn this off under *Settings → Play Spotify on this display*.

*Spotify's February 2026 API changes are already handled:* search returns at most 10 results, and playlists use `items`.

### Apple Music

Apple Music needs a **developer token**, which requires an Apple Developer Program membership.

1. At developer.apple.com, go to *Certificates, IDs & Profiles → Keys*. Create a key with **Media Services (MusicKit)** and download the `AuthKey_XXXX.p8` file. Note your **Team ID** and the **Key ID**.
2. Make a token, choosing one of:
   - `cd bridge && npm run apple-token -- TEAMID KEYID path/to/AuthKey_XXXX.p8`, then paste the output into *Settings → Apple developer token*.
   - Or, on the Pi, put `teamId`, `keyId` and `privateKeyPath` in `bridge/config.json → apple`, and the bridge signs tokens automatically.
3. In the app, tap **Apple Music → Sign in with Apple Music**.

Apple Music plays on the display itself; MusicKit can't remote-control another device.

### YouTube and YouTube Music

Both play through the official YouTube player on this display. The same free **API key** also powers the music videos in **Video** view for every other service.

**Get the API key (free, about 5 minutes):**
1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a project (e.g. "Round Remote").
2. Go to *APIs & Services → Library*, search for **YouTube Data API v3**, and click **Enable**.
3. Go to *APIs & Services → Credentials → Create credentials → API key*.
4. Recommended: edit the key and set these restrictions:
   - *Application restrictions → Websites*, adding:
     - `https://royborkin.github.io/*`
     - `http://127.0.0.1:8765/*`
     - `http://localhost:8765/*`
   - *API restrictions → YouTube Data API v3*.
5. Paste the key into Round Remote → **YouTube** tile (or *Settings → YouTube Data API key*).

**Optional: your playlists and liked videos (Google sign-in):**

Google now calls the consent screen the **Google Auth Platform**, and "External" is part of its setup wizard.
1. In the same project, open **APIs & Services → OAuth consent screen** (or search for "Google Auth Platform" in the top search bar).
2. If you see *"Google Auth Platform not configured yet"*, click **Get started** and go through the wizard:
   1. **App information:** app name "Round Remote", and your email as the support email → *Next*.
   2. **Audience:** choose **External** → *Next*.
   3. **Contact information:** your email → *Next*.
   4. **Finish:** tick the agreement → **Create**.

   If there's no *Get started* button, the setup was already done. Open **Audience** in the left menu. If it says *User type: External* and *Publishing status: Testing*, you're fine. If it says *Internal*, click **Make external**.
3. In the left menu, go to **Audience → Test users → + Add users**, add your own Google (Gmail) address, then **Save**. Leave the app in *Testing*.
4. Go to **Clients** in the left menu → **+ Create client** → *Application type:* **Web application** → Name: "Round Remote".
5. Under **Authorized JavaScript origins**, click *+ Add URI* for each of these (no path, no trailing slash):
   - `https://royborkin.github.io`
   - `http://127.0.0.1:8765`
   - `http://localhost:8765`

   You can leave **Authorized redirect URIs** empty. Click **Create**.
6. Copy the **Client ID** (ends in `.apps.googleusercontent.com`; you don't need the client secret). Paste it into the YouTube tile, then tap **Sign in with Google**. Google may say *"Google hasn't verified this app"*; that's normal in Testing mode, so click **Continue**.

**Notes:**
- The free quota is 10,000 units a day. A search costs 100, so that's about 100 searches or music-video lookups a day. Found videos are remembered, so each song is only looked up once.
- Some videos can't be played outside YouTube (the owner's choice); these are skipped automatically.
- YouTube's rules don't allow hiding the player. With YouTube as the source:
  - Video view uses it as the background.
  - Info and Vinyl use it as the artwork.
  - Lyrics shows it as a small bubble at the top.
- Something you **cast** from your phone to a Chromecast also shows up in the **Google Cast** tile.

#### YouTube on your TV (Google TV, Android TV, smart TVs, consoles)

The YouTube or YouTube Music tile can control the **YouTube app on your TV**, just like the YouTube phone app does. You get play/pause, seek on the ring, next/previous and volume, plus the video's title and picture. Search on the round screen and the result plays on the TV. This needs the **bridge** running on a computer (`start-bridge.bat`) or on the Pi.

1. Start the bridge (see [The bridge](#3-the-bridge)).
2. On the **TV**, open **YouTube → Settings (gear) → Link with TV code**. A code appears, e.g. `123 456 789 012`.
3. In Round Remote, tap the **YouTube** tile. Under **YouTube on your TV**, enter the code and tap **Link TV**.
4. Tap **Control** (or open the YouTube remote → **Devices** → pick your TV). Choose **This display** to play on the round screen again.

The TV stays linked; the bridge remembers it in `bridge/youtube-tv.json`. It works through youtube.com, so the TV doesn't have to be on the same network as the bridge. In **Video** view, the TV's video plays muted in the background, in sync with the TV.

This uses YouTube's own TV-linking protocol, the one the YouTube phone app uses. It isn't officially documented, so a YouTube update could break it.

### Plex / Plexamp

1. Tap **Plex → Link with a code**.
2. On your phone, open **plex.tv/link** and enter the 4-character code. Or use **Sign in here** to log in on the display.
3. Start Plexamp (or any Plex player) and it appears under **Devices**.

Plexamp headless on a Pi works too.

### Jellyfin

1. Tap **Jellyfin** and enter your server address, e.g. `http://192.168.1.20:8096` or `https://jellyfin.example.com`.
2. Tap **Quick Connect**. In Jellyfin, open *your profile → Quick Connect* and enter the code shown. Or use **Username & password**.
3. Open any Jellyfin app (web, Finamp, Jellyfin Media Player, Kodi…) and it appears under **Devices**.

**http servers from GitHub Pages:** an `https` page can normally only reach `http` servers through the bridge. **Chrome and Edge** can reach a plain `http://192.168.x.x` server directly once you click **Allow** when asked about *local network access*. Other browsers need an `https://` address or the bridge.

### Tidal and Qobuz

Neither offers an API for controlling playback. Play them through **Roon**, by casting from their app to a **Chromecast**, on a **UPnP** renderer, or over **AirPlay**. The Tidal/Qobuz tile then finds and controls that stream through the bridge.

---

## 3. The bridge

Browsers can't find devices on your home network by themselves. The bridge is a small Node.js program that does this for **Roon, UPnP/DLNA, Google Cast, AirPlay, Tidal, Qobuz and YouTube on your TV**. It also lets an `https` page reach `http` Plex/Jellyfin servers, and can sign Apple tokens.

### On your computer (to use with GitHub Pages)

1. Install [Node.js](https://nodejs.org) (LTS).
2. Start the bridge:
   - **Windows:** double-click **`start-bridge.bat`** in this folder.
   - **Mac / Linux:** run `./start-bridge.sh`.
3. Open the GitHub Pages app and tap Roon / UPnP / Cast / Tidal / Qobuz. When Chrome asks about **local network access**, click **Allow**. The app then finds the bridge at `http://127.0.0.1:8765` automatically.
4. To use a bridge on another machine (e.g. the Pi), enter its address under *Settings → Bridge address*, e.g. `http://192.168.1.50:8765`.

AirPlay needs shairport-sync, so it only works when the bridge runs on Linux / the Pi.

### Roon

1. Install the Roon extension libraries once: `cd bridge && npm run roon`, or `bash pi/setup.sh --with-roon` on the Pi.
2. In Roon, go to **Settings → Extensions → Round Remote → Enable**.

### Bridge config

Copy `bridge/config.example.json` to `bridge/config.json` and edit it:

```json
{
  "allowedOrigins": ["https://royborkin.github.io"],
  "adapters": { "roon": true, "upnp": true, "cast": true, "airplay": true },
  "apple": { "teamId": "ABCDE12345", "keyId": "XYZ987", "privateKeyPath": "AuthKey_XYZ987.p8" },
  "app": {
    "spotifyClientId": "…",
    "jellyfinServer": "http://192.168.1.20:8096",
    "youtubeApiKey": "AIza…",
    "googleClientId": "…apps.googleusercontent.com"
  }
}
```

- **`app`** pre-fills the app's settings on first run, so you never have to type keys on the round screen.
- **`apple`** lets the bridge sign Apple Music developer tokens.
- **`allowedOrigins`**: the bridge answers only pages on the same machine, your LAN, or the origins listed here.
- **Testing without devices:** `cd bridge && npm run mock` adds two fake zones.

---

## 4. Raspberry Pi kiosk

On Raspberry Pi OS (Bookworm, desktop), with the round display connected:

```bash
git clone https://github.com/RoyBorkin/RoundSpotify.git ~/RoundRemote
cd ~/RoundRemote
bash pi/setup.sh                 # add --with-roon for Roon, --no-airplay to skip AirPlay
cp bridge/config.example.json bridge/config.json   # then edit it: keys in "app"
sudo reboot
```

`pi/setup.sh` does four things:
- installs Node and the bridge as a service (`roundremote-bridge`, starts at boot);
- installs **shairport-sync** as the AirPlay speaker "Round Display";
- serves the app from the bridge at `http://127.0.0.1:8765/`, so the UI works without internet;
- starts Chromium full-screen (kiosk) at boot, on labwc, wayfire or LXDE.

**One-time sign-ins on the Pi:**
- For Spotify, add `http://127.0.0.1:8765/` as a Redirect URI (see [Spotify](#spotify)).
- Spotify and Apple Music sign-in need a keyboard once (plug in a USB keyboard or use the OS on-screen keyboard).
- Plex and Jellyfin sign in with a code, so no typing is needed.

**Useful commands:**
- `sudo systemctl status roundremote-bridge` shows bridge status.
- `journalctl -u roundremote-bridge -f` shows the bridge logs.
- `sudo systemctl restart roundremote-bridge` restarts it.

**AirPlay 2:** the `apt` version of shairport-sync gives classic AirPlay. For AirPlay 2, build shairport-sync from source with `--with-airplay-2 --with-dbus-interface --with-metadata`, plus `nqptp`, following the shairport-sync documentation. Keep the metadata and D-Bus settings that `pi/setup.sh` writes to `/etc/shairport-sync.conf`.

**Slow GPU (Pi 3 / Zero):** turn on *Settings → Reduce effects*.

---

## 5. Using the app

### Controls

| Where | What to do |
|---|---|
| Edge ring | Drag around the circle to seek |
| Bottom row | Previous · Play/Pause · Next; below them the four view buttons (Info, Vinyl, Lyrics, Video) |
| Top buttons | Services (home) · Playlists · Search · Devices |
| Left button | Volume dial (drag around, −/+, or mouse wheel) |
| Right button | **⋯** in Info/Vinyl/Video: shuffle, repeat, skip ±15 s, full-screen art style (Info), centre artwork size, arm hiding and record speed (Vinyl). **Aa** in Lyrics: style, Kinetic Type variant, timing offset |
| Info / Lyrics / Video | Swipe left or right to change view |
| Vinyl | Spin the record to scrub; flick for momentum |
| Any view | The controls hide after a few seconds; tap to show them. Tapping lyrics doesn't skip |
| On-screen keyboard | **עב / EN** switches between English and Hebrew; **123** shows numbers and symbols |

**Keyboard / rotary encoder** (a rotary encoder can be mapped to keys, e.g. with `gpio-keys`):
- <kbd>Space</kbd> play/pause
- <kbd>←</kbd>/<kbd>→</kbd> ±10 s
- <kbd>↑</kbd>/<kbd>↓</kbd> volume
- <kbd>N</kbd>/<kbd>P</kbd> next/previous
- <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> Info / Vinyl / Lyrics / Video
- <kbd>L</kbd> next lyric style
- <kbd>V</kbd> volume
- <kbd>/</kbd> search
- <kbd>B</kbd> playlists
- <kbd>Esc</kbd> back

Adding `?service=demo` (or any service id: `spotify`, `apple`, `youtube`, `ytmusic`, `plex`, `jellyfin`, `roon`, …) to the address opens that service directly.

### Settings

| Setting | What it does |
|---|---|
| Show only signed-in services | Home shows only the services you've signed in to or that the bridge can reach |
| Show the Demo service | Hide the Demo tile from Home |
| Control size | XS, S, M, **L** (default), XL |
| Start in view | Info, Vinyl, Lyrics or Video |
| Auto-hide controls | Hide the controls after a few seconds |
| Colours from artwork | Accent colour follows the album art |
| Full-screen art when controls hide | Info view: original clear or milky blur |
| Reduce effects | Fewer blur effects for slower GPUs |
| Open last service on start | Go straight to the last service |
| Dim screen when idle | Dims when nothing is playing (never / 2 / 10 / 30 min) |
| On-screen keyboard | Auto (touch screens), on or off |
| Keyboard language | English or עברית (Hebrew). You can also switch with the **עב / EN** key on the keyboard; the last choice is remembered |
| Lyrics style / Kinetic Type variant / timing offset | See the Lyrics view |
| Centre artwork / Hide the arm with the controls / Record speed | See the Vinyl view |
| Bridge address / Refresh rate | Where the bridge is, and how often remote services are polled |
| Service keys | Spotify Client ID, Play Spotify on this display, Apple developer token, Jellyfin server, YouTube API key, Google Client ID |
| Accounts | Sign in or out of each service |
| Reset everything | Clears all settings and sign-ins in this browser |

Lyrics come from [LRCLIB](https://lrclib.net), a free, open lyrics database, or from your Jellyfin server.

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| Spotify: **INVALID_CLIENT: Invalid redirect URI** | Add exactly the address shown on the Spotify screen to *Redirect URIs* in the dashboard, then save. |
| Spotify: sign-in works but nothing loads / **403** | Add your account under *User Management* in the Spotify dashboard. The app owner needs Premium. |
| Spotify: "No active device" | Open Spotify on any device, pick one under **Devices**, or play on "This display". |
| "This browser can't play Spotify audio" | The browser lacks Widevine DRM. Remote control still works. On the Pi, install `libwidevinecdm0`. |
| YouTube: "That code wasn't accepted" | Codes expire after a few minutes. Get a new one from the TV (YouTube → Settings → Link with TV code) and enter it straight away. |
| A bridge tile says **Bridge not found** | Start the bridge (`start-bridge.bat` / `.sh`, or the Pi service). In Chrome, allow *local network access*. If you blocked it, re-enable it via the lock icon → *Site settings*. |
| Jellyfin/Plex on `http://` doesn't connect from GitHub Pages | Use Chrome/Edge and allow local network access, use an `https://` address, or run the bridge. |
| YouTube: "Add a YouTube API key" | See [YouTube](#youtube-and-youtube-music). |
| YouTube: "quota used up" | The free daily quota resets at midnight Pacific time. |
| Video view shows only the blurred artwork | No embeddable music video was found for that song, or no API key is set. |
| Icons show initials | The logos haven't been downloaded yet (first run while offline, or a blocker stopping jsDelivr/unpkg). They appear once they've loaded; after that they work offline. |
| The site still shows an old version | Reload once or twice; the offline cache updates itself in the background. |

---

## 7. Honest limits

- **Spotify Canvas** (the short looping videos) and **Apple Music motion artwork** aren't available to third-party apps through the official APIs. Video view uses the song's official music video from YouTube instead.
- **Tidal and Qobuz** have no public remote-control API; they're controlled through Roon, Cast, UPnP or AirPlay.
- **YouTube on a TV** uses YouTube's undocumented TV-linking protocol and could stop working after a YouTube update. It hasn't been tested with a real TV yet.
- **AirPlay:** no seeking. **Cast:** next/previous depends on the casting app.
- **Apple Music** plays on the display itself; MusicKit can't control another device.
- The Demo and the bridge were tested with fake zones. The Roon, UPnP, Cast, shairport-sync and YouTube paths follow each service's documented API but haven't been tested against real accounts and hardware yet.

---

## 8. Project layout

```
index.html, css/app.css         round UI (everything sized in cqmin → scales to any circle)
js/main.js                      boot, sign-in redirects, shortcuts, idle dimming
js/core/                        settings/tokens, player controller, router, colours, YouTube helper
js/providers/                   one file per service + the bridge client (common interface in base.js)
js/views/                       info, vinyl, lyrics (+ lyrics-extra.js, lyrics-kinetic2.js), video
js/lyrics/lrc.js                LRC parser + LRCLIB lookup
js/screens/                     home ring, player, panels, connect, settings
bridge/                         Node bridge: server.js + adapters (roon, upnp, cast, youtubetv, airplay, mock)
pi/                             Pi setup script, kiosk launcher, systemd unit
sw.js, manifest.webmanifest     offline support + installable app (icons/)
screenshots/                    images used in this README
start-bridge.bat / .sh          run the bridge on a Windows / Mac / Linux computer
```
