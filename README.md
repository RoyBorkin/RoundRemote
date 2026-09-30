# Round Remote

A circular touch remote for your music services, built for a Raspberry Pi with a 4" round 720×720 touch display. It also runs as a normal web page (GitHub Pages).

Sign in to each service once. Then you can control volume, seek, skip back and forward, pick playlists and devices, and search, all from one round screen. The current song can be shown three ways:

1. **Info**: round artwork, title, artist and album, with the accent colour taken from the artwork.
2. **Vinyl**: the whole screen becomes a record. Spin it with your finger to scrub backwards or forwards; a flick keeps it coasting. The tone arm follows the song's progress, and the record spins at a real 33⅓ rpm.
3. **Lyrics**: synced lyrics in five styles: **Basic**, **Animated** (karaoke fill), **Typing** (typewriter), **Roll** (3D drum) and **Moving Words** (kinetic typography). Tap a line to jump to it, and adjust the timing offset if the lyrics drift.

The progress ring around the edge of the screen is the seek bar: drag it around the circle.

---

## Services

| Service | How it connects | Needs the bridge? |
|---|---|---|
| **Spotify** | Web API, sign in with PKCE. Controls any of your Spotify devices. | No |
| **Apple Music** | MusicKit JS v3. Plays *through this display*. Needs a developer token. | No (the bridge can sign the token for you) |
| **Plex / Plexamp** | plex.tv PIN sign-in (type the code at plex.tv/link). Controls Plexamp (incl. headless) and Plex players through your server. | Only if your server is http-only and the app is on https |
| **Jellyfin** | Quick Connect or username/password. Controls any Jellyfin client session. Server lyrics are used when available. | Same as Plex |
| **Roon** | Official Roon extension API: zones, volume, playlists and search. | Yes |
| **UPnP / DLNA** | SSDP + AVTransport/RenderingControl. Works with WiiM, Bluesound, Denon/Marantz, BubbleUPnP, Volumio, moOde and others. | Yes |
| **AirPlay 1/2** | The Pi becomes an AirPlay speaker (shairport-sync). The app shows what your phone or Mac is streaming and controls it (no seeking over AirPlay). | Yes |
| **Google Cast** | Chromecast, Nest and Cast speakers. Shows and controls whatever app is casting. | Yes |
| **Tidal** | TIDAL has no public remote-control API. The tile follows TIDAL wherever it's playing: Roon, Cast (the TIDAL app casting), a UPnP renderer, or AirPlay. | Yes |
| **Qobuz** | Qobuz Connect is closed to third parties. It works the same way as Tidal. | Yes |
| **Demo** | A simulated player with fictional songs and original lyrics, so you can try everything with no account. | No |

> **Spotify, Feb 2026 changes:** development-mode apps need a Premium account owner and at most 5 users (add yourself under *User Management* in the dashboard). Search returns at most 10 results, and playlist `tracks` became `items`. This app already uses the new API.

---

## Quick start (GitHub Pages)

1. Push this folder to a repo (e.g. `RoyBorkin/RoundRemote`) and enable **Settings → Pages → Deploy from branch → main / root**.
2. Open `https://royborkin.github.io/RoundRemote/`.
3. **Spotify:** at developer.spotify.com → your app → *Redirect URIs*, add the exact URL shown on the Spotify connect screen (e.g. `https://royborkin.github.io/RoundRemote/`). The Client ID from your old project is already filled in.
4. Tap **Demo** to try every screen straight away.

## Raspberry Pi (round display kiosk)

```bash
git clone https://github.com/RoyBorkin/RoundRemote.git ~/RoundRemote
cd ~/RoundRemote
bash pi/setup.sh                 # add --with-roon for Roon, --no-airplay to skip AirPlay
nano bridge/config.json          # optional: put keys in "app" so you never type on the round screen
sudo reboot
```

The setup does four things:

- installs Node and the bridge as a `systemd` service (`roundremote-bridge`)
- installs shairport-sync as the AirPlay receiver "Round Display"
- serves the app from the bridge at `http://127.0.0.1:8765/`, so it works offline
- starts Chromium in kiosk mode at boot (labwc, wayfire or LXDE)

For Spotify on the Pi, add `http://127.0.0.1:8765/` as a Redirect URI. Spotify only accepts loopback *IP* addresses, not `localhost`. You'll need a keyboard (USB or the OS on-screen one) for the one-time Spotify or Apple sign-in. Plex and Jellyfin sign in with a code, so no typing is needed.

**AirPlay 2:** the `apt` shairport-sync gives you classic AirPlay. For AirPlay 2, build shairport-sync from source with `--with-airplay-2 --with-dbus-interface --with-metadata` plus `nqptp` (see the shairport-sync docs). Keep the metadata and D-Bus settings that `pi/setup.sh` writes.

### Bridge config (`bridge/config.json`)

```json
{
  "allowedOrigins": ["https://royborkin.github.io"],
  "adapters": { "roon": true, "upnp": true, "cast": true, "airplay": true },
  "apple": { "teamId": "ABCDE12345", "keyId": "XYZ987", "privateKeyPath": "AuthKey_XYZ987.p8" },
  "app": { "spotifyClientId": "…", "jellyfinServer": "http://192.168.1.20:8096" }
}
```

- `app` values pre-fill the app's settings on the first run.
- `apple` lets the bridge create the Apple Music developer token. You can also run `npm run apple-token -- TEAMID KEYID AuthKey.p8` and paste the result into Settings.
- `allowedOrigins`: the bridge only answers pages on the same machine, your LAN, or the origins listed here.
- Test with fake zones: `cd bridge && npm run mock`.

### Roon

Run `bash pi/setup.sh --with-roon` (or `cd bridge && npm run roon`), then in Roon open **Settings → Extensions → Round Remote → Enable**.

---

## Controls

| Where | Gesture |
|---|---|
| Edge ring | Drag around the circle to seek |
| Vinyl | Spin the record to scrub; flick for momentum |
| Info / Lyrics | Swipe left/right to change view |
| Vinyl / Lyrics | Controls auto-hide; tap to bring them back |
| Lyrics | Tap a line to jump there; **Aa** button → style + timing offset |
| Volume | Round dial; drag, use −/+, or the mouse wheel |

**Keyboard / rotary encoder** (map a rotary encoder to keys with e.g. `gpio-keys`):
<kbd>Space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd> ±10 s · <kbd>↑</kbd>/<kbd>↓</kbd> volume · <kbd>N</kbd>/<kbd>P</kbd> next/previous · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> views · <kbd>L</kbd> cycle lyric style · <kbd>V</kbd> volume · <kbd>/</kbd> search · <kbd>B</kbd> playlists · <kbd>Esc</kbd> back.

`?service=demo` (or any service id) in the URL opens that service directly.

---

## Project layout

```
index.html, css/app.css         round UI (everything sized in cqmin → scales to any circle)
js/main.js                      boot, OAuth redirects, shortcuts, idle dimming
js/core/                        store (settings/tokens), player controller, router, colours
js/providers/                   one file per service + the bridge client (common interface in base.js)
js/views/                       info, vinyl, lyrics (5 styles)
js/lyrics/lrc.js                LRC parser + LRCLIB lookup
js/screens/                     home ring, player, panels, connect, settings
bridge/                         Node bridge: server.js + adapters (roon, upnp, cast, airplay, mock)
pi/                             setup script, kiosk launcher, systemd unit
```

Lyrics come from [LRCLIB](https://lrclib.net), a free, open lyrics database, or from your Jellyfin server.

## Honest limits

- Tidal and Qobuz can't be controlled directly (no public API); they're controlled through Roon, Cast, UPnP or AirPlay.
- You can't seek over AirPlay, and Cast next/previous depends on the casting app.
- Apple Music plays on the display itself. MusicKit can't remote-control another device.
- The Demo and bridge paths were tested with fake zones. The Roon, UPnP, Cast and shairport-sync adapters follow each protocol's documented API but have not been tested against real hardware yet.
