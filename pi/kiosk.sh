#!/usr/bin/env bash
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
# Launch Round Remote full-screen on the round display.
# Uses 127.0.0.1 (not "localhost") because Spotify only accepts loopback *IP* redirect URIs.
URL="${ROUNDREMOTE_URL:-http://127.0.0.1:8765/}"
# ROUNDREMOTE_PROFILE="Living room": start with that settings profile from the bridge (Settings → Profiles)
APP_URL="$URL"
if [ -n "${ROUNDREMOTE_PROFILE:-}" ]; then APP_URL="${URL}?profile=${ROUNDREMOTE_PROFILE// /%20}"; fi

# wait for the bridge (it also serves the app)
for i in $(seq 1 30); do curl -fsS "${URL}api/info" >/dev/null 2>&1 && break; sleep 1; done

# hide the mouse pointer on touch screens (X11 only; harmless elsewhere)
command -v unclutter >/dev/null && (unclutter -idle 0.5 -root &) 2>/dev/null

BROWSER="$(command -v chromium-browser || command -v chromium)"
exec "$BROWSER" \
  --kiosk --app="$APP_URL" \
  --noerrdialogs --disable-infobars --no-first-run --disable-session-crashed-bubble \
  --disable-translate --disable-features=TranslateUI,Translate \
  --overscroll-history-navigation=0 --disable-pinch \
  --touch-events=enabled --enable-features=OverlayScrollbar \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --check-for-update-interval=31536000 \
  --ozone-platform-hint=auto
