#!/usr/bin/env bash
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
# Launch Round Remote full-screen on the round display.
#
# Two ways in:
#  • Raspberry Pi OS Lite (the appliance): roundremote-kiosk.service runs this on tty1 as your user. There is no
#    desktop, so it starts a minimal Wayland compositor — cage (or labwc when cage isn't installed) — which runs
#    this script again with --browser.
#  • A desktop session (Pi OS with desktop, the old pi/setup.sh way): the desktop's autostart runs it, and it
#    just opens Chromium.
#
# Settings (in /etc/roundremote/kiosk.env, written by pi/install.sh, or the environment):
#   ROUNDREMOTE_URL          default http://127.0.0.1:8765/ (127.0.0.1, not "localhost": Spotify only accepts a
#                            loopback *IP* as redirect URI)
#   ROUNDREMOTE_PROFILE      start with that settings profile from the bridge (Settings → Profiles)
#   ROUNDREMOTE_COMPOSITOR   cage | labwc (default: cage if installed)
#   ROUNDREMOTE_OUTPUT       the screen's output name (default: auto, e.g. HDMI-A-1)
#   ROUNDREMOTE_TRANSFORM    normal | 90 | 180 | 270 | flipped… — turn the whole screen (wlr-randr --transform)
#   ROUNDREMOTE_MODE         e.g. 720x720 or 720x720@60 — force a mode after start (wlr-randr --mode / --custom-mode)
#   ROUNDREMOTE_CURSOR       auto | hide | show — the mouse pointer (default auto: hidden unless a real mouse is
#                            plugged in when the kiosk starts; the app also hides it while touch is used)
#   ROUNDREMOTE_BOOT_PAGE    1 | 0 — show the logo (pi/boot.html) while the bridge starts, carrying on from the
#                            boot splash (default 1; 0 = wait on a black screen, then open the app)
#   CHROMIUM_FLAGS           extra Chromium flags
# The screen never blanks by itself: the app turns the HDMI output off after the idle time set in
# Settings → Device → Screen (through the bridge: POST /api/system/screen).
set -u
SELF="$(readlink -f "${BASH_SOURCE[0]}")"
# shellcheck disable=SC1091
if [ -r /etc/roundremote/kiosk.env ]; then set -a; . /etc/roundremote/kiosk.env; set +a; fi
URL="${ROUNDREMOTE_URL:-http://127.0.0.1:8765/}"
APP_URL="$URL"
if [ -n "${ROUNDREMOTE_PROFILE:-}" ]; then APP_URL="${URL}?profile=${ROUNDREMOTE_PROFILE// /%20}"; fi
CURSOR_DIR="$HOME/.local/share/roundremote-cursors"
TOOL="$(dirname "$SELF")/rr-tool.py"

log() { echo "kiosk: $*" >&2; }

# The touch screen needs no pointer. cage shows one as soon as ANY pointer device exists — and most USB touch panels
# (the Waveshare round one too) add a "mouse" interface next to the touch one, so an arrow sat in the middle of the
# screen. Setting XCURSOR_THEME alone didn't hide it: cage 0.1.x (Bookworm) ignores it and loads the theme called
# "default". So the kiosk gets its own cursor path where both "default" and "roundremote-hidden" are invisible —
# unless a real mouse is plugged in (or ROUNDREMOTE_CURSOR=show). The app also hides the pointer while touch is used.
cursor_setup() {
  local mode="${ROUNDREMOTE_CURSOR:-auto}" mouse=""
  case "$mode" in show|visible|on) log "pointer: visible (ROUNDREMOTE_CURSOR=$mode)"; return 0 ;; esac
  command -v python3 >/dev/null || return 0
  if [ "$mode" = auto ] && mouse="$(python3 "$TOOL" has-mouse 2>/dev/null)"; then
    log "pointer: visible — a mouse is plugged in (${mouse//$'\n'/, }); the app hides it while you use touch"
    return 0
  fi
  if [ ! -e "$CURSOR_DIR/default/cursors/default" ] || [ ! -e "$CURSOR_DIR/roundremote-hidden/cursors/left_ptr" ]; then
    python3 "$TOOL" cursor-path "$CURSOR_DIR" 2>/dev/null || { log "couldn't write the invisible pointer theme"; return 0; }
  fi
  export XCURSOR_PATH="$CURSOR_DIR" XCURSOR_THEME=roundremote-hidden XCURSOR_SIZE=24
  log "pointer: hidden (no mouse plugged in; ROUNDREMOTE_CURSOR=show keeps it)"
}

start_compositor() {
  cursor_setup
  export XDG_SESSION_TYPE=wayland MOZ_ENABLE_WAYLAND=1
  local comp="${ROUNDREMOTE_COMPOSITOR:-}"
  [ -z "$comp" ] && { command -v cage >/dev/null && comp=cage || comp=labwc; }
  case "$comp" in
    cage)
      command -v cage >/dev/null || { log "cage is not installed (sudo apt install cage)"; exit 1; }
      # -d: no client-side decorations, -s: allow switching to a text console (Ctrl+Alt+F2)
      exec cage -d -s -- "$SELF" --browser ;;
    labwc)
      command -v labwc >/dev/null || { log "neither cage nor labwc is installed"; exit 1; }
      local cfg="$HOME/.config/roundremote-labwc"
      mkdir -p "$cfg"
      cat > "$cfg/rc.xml" <<'EOF'
<?xml version="1.0"?>
<labwc_config>
  <core><decoration>none</decoration><gap>0</gap></core>
  <windowRules><windowRule identifier="*" serverDecoration="no"/></windowRules>
  <keyboard><default/></keyboard>
</labwc_config>
EOF
      : > "$cfg/menu.xml"
      exec labwc -C "$cfg" -s "$SELF --browser" ;;
    *) log "unknown compositor $comp"; exit 1 ;;
  esac
}

screen_setup() {
  command -v wlr-randr >/dev/null || return 0
  local out="${ROUNDREMOTE_OUTPUT:-}"
  [ -z "$out" ] && out="$(wlr-randr 2>/dev/null | awk '/^[^ ]/{print $1; exit}')"
  [ -n "$out" ] || return 0
  if [ -n "${ROUNDREMOTE_MODE:-}" ]; then
    wlr-randr --output "$out" --mode "$ROUNDREMOTE_MODE" 2>/dev/null || wlr-randr --output "$out" --custom-mode "$ROUNDREMOTE_MODE" || true
  fi
  if [ -n "${ROUNDREMOTE_TRANSFORM:-}" ] && [ "$ROUNDREMOTE_TRANSFORM" != normal ]; then
    wlr-randr --output "$out" --transform "$ROUNDREMOTE_TRANSFORM" || true
  fi
  wlr-randr --output "$out" --on 2>/dev/null || true
}

run_browser() {
  # The bridge serves the app. Chromium opens pi/boot.html first — the logo and ring of the boot splash in the same
  # place — which waits for the bridge and then opens the app (whose startup animation carries on from there).
  # Without it: wait here (black screen), and show Chromium's own error page if the bridge never comes.
  local START="$APP_URL" BOOT_PAGE; BOOT_PAGE="$(dirname "$SELF")/boot.html"
  if [ "${ROUNDREMOTE_BOOT_PAGE:-1}" != 0 ] && [ -r "$BOOT_PAGE" ]; then START="file://$BOOT_PAGE#$APP_URL"
  else for _ in $(seq 1 60); do curl -fsS -m 2 "${URL}api/info" >/dev/null 2>&1 && break; sleep 1; done; fi

  # hide the mouse pointer on X11 desktops (Wayland: the invisible cursor theme in cursor_setup)
  if [ -n "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && command -v unclutter >/dev/null; then (unclutter -idle 0.5 -root &) 2>/dev/null; fi
  [ -n "${WAYLAND_DISPLAY:-}" ] && screen_setup

  local BROWSER; BROWSER="$(command -v chromium || command -v chromium-browser)"
  [ -n "$BROWSER" ] || { log "Chromium is not installed"; exit 1; }
  local DATA="$HOME/.config/roundremote-chromium"
  mkdir -p "$DATA/Default"
  # no "Chromium didn't shut down correctly" bubble after a power cut
  if [ -f "$DATA/Default/Preferences" ]; then
    sed -i -e 's/"exited_cleanly":false/"exited_cleanly":true/' -e 's/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$DATA/Default/Preferences" 2>/dev/null || true
  fi
  # --force-dark-mode: Chromium's own background before the first page paints is dark grey instead of white
  # (there is no --default-background-color outside headless Chromium); boot.html itself is black from its first byte
  local OZONE=--ozone-platform-hint=auto
  [ -n "${WAYLAND_DISPLAY:-}" ] && OZONE=--ozone-platform=wayland
  # shellcheck disable=SC2086
  exec "$BROWSER" \
    --user-data-dir="$DATA" \
    --kiosk --app="$START" --start-fullscreen \
    --force-dark-mode \
    --noerrdialogs --disable-infobars --no-first-run --disable-session-crashed-bubble \
    --disable-translate --disable-features=TranslateUI,Translate,MediaRouter \
    --overscroll-history-navigation=0 --disable-pinch \
    --touch-events=enabled --enable-features=OverlayScrollbar \
    --autoplay-policy=no-user-gesture-required \
    --use-fake-ui-for-media-stream \
    --password-store=basic \
    --check-for-update-interval=31536000 \
    "$OZONE" \
    ${CHROMIUM_FLAGS:-}
}

if [ "${1:-}" = --browser ] || [ -n "${WAYLAND_DISPLAY:-}" ] || [ -n "${DISPLAY:-}" ]; then
  run_browser
else
  start_compositor
fi
