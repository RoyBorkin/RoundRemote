#!/usr/bin/env bash
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
# Round Remote — one-shot installer for the Raspberry Pi appliance.
#
# On a fresh Raspberry Pi OS Lite 64-bit (Bookworm or Trixie), logged in as your normal user:
#   curl -fsSL https://raw.githubusercontent.com/RoyBorkin/RoundSpotify/main/pi/install.sh | bash
# or from a checkout:
#   bash ~/RoundRemote/pi/install.sh [options]
#
# It is safe to run again (it only changes what isn't set up yet, and refreshes its own files), logs everything
# to ~/roundremote-install.log, and asks nothing unless you pass --interactive.
#
# What it does: packages (Chromium, cage, NetworkManager, BlueZ, PipeWire, i2c-tools, avahi, Node.js ≥ 18…),
# clones / updates the app to ~/RoundRemote, installs the bridge, sets up the round screen (KMS), I2C, sound,
# the kiosk (cage + Chromium on tty1, no desktop), the boot splash (Plymouth, pi/plymouth/), the setup hotspot for
# Wi-Fi, narrow sudo rules, and services.
#
# Two kinds of install (--mode):
#   full       (default) the whole Round Remote on this Pi: the bridge with every adapter, phone pages, data, the kiosk.
#              With --server=URL it starts as a companion of that Round Remote server right away (Settings →
#              Connection → Server switches between the two at any time, no restart).
#   companion  a LIGHT companion for a Pi Zero 2 W (or any Pi) whose round display uses a Round Remote server, e.g. the
#              Docker container on the NAS:  bash pi/install.sh --mode=companion --server=http://192.168.50.108:8765
#              Only the kiosk (cage + Chromium), the small bridge/companion.js (this Pi's Wi-Fi, Bluetooth, sound,
#              screen, updates + a proxy to the server + the "Server offline" page), the setup hotspot and the boot
#              splash — no media adapters, no npm packages, no AirPlay. On a Pi with under 1 GB of RAM it also sets
#              up zram swap (unless Raspberry Pi OS already has it) and lighter Chromium settings.
#   Running it again with the other --mode switches cleanly (the other service is stopped and disabled); without
#   --mode it keeps the kind that is installed.
#
# Options:
#   --mode=full|companion      see above                      --server=URL   the Round Remote server (http://host:8765)
#   --display=auto|waveshare-4-hdmi|waveshare-4-dsi|none   the screen (default auto: DSI if its overlay is set, else HDMI)
#   --display-mode=auto|edid|cvt|none   HDMI mode under KMS (see README → Troubleshooting the display):
#        auto  video=HDMI-A-1:720x720e  — the panel's own EDID mode, forced on even if hot-plug isn't seen (default)
#        edid  a custom EDID with Waveshare's exact 720×720 timings (drm.edid_firmware) — when auto shows nothing
#        cvt   video=HDMI-A-1:720x720M@60e — standard CVT timings at 60 Hz
#        none  leave cmdline.txt alone
#   --rotate=0|90|180|270      turn the whole screen (and touch)          --hostname=NAME   (default: roundremote)
#   --wifi-country=CC          e.g. US, GB, IL (needed before Wi-Fi works on a fresh image without Imager settings)
#   --audio-hat=OVERLAY        add dtoverlay=OVERLAY for an I2S sound HAT (e.g. hifiberry-dac, googlevoicehat-soundcard)
#   --hdmi-audio=auto|on|off   auto: off when a USB / I2S speaker is found
#   --no-airplay  --no-pyatv  --with-roon  --no-kiosk  --kiosk=service|autostart  --compositor=cage|labwc
#   --dir=PATH  --user=NAME  --repo=URL  --branch=NAME  --no-update (don't git pull)
#   --no-splash   leave the boot screen alone (default: the Round Remote boot splash — logo + ring on black, no boot
#                 text, no rainbow square; on a re-run it removes the splash again)
#   --verbose-boot  show the boot messages instead of the splash (to see what's wrong); run again without it to hide them
#   --readonly    make the SD card read-only (overlay file system; settings then reset at every boot!)
#   --dry-run     print what would be done, change nothing         --interactive   ask about the main choices
#   --same-options  start from the options of the last run (kept in /etc/roundremote/install-args); what you add
#                 after it wins — pi/update.sh --apply-system uses it
#   --reboot      reboot at the end                                 --uninstall     remove services and system files
set -euo pipefail

REPO_URL_DEFAULT="https://github.com/RoyBorkin/RoundSpotify.git"
HOTSPOT_SSID="RoundRemote-Setup"
MARK_BEGIN="# >>> Round Remote (pi/install.sh) — edit with care >>>"
MARK_END="# <<< Round Remote <<<"
EDID_NAME="roundremote-720x720.bin"
WAVESHARE_TIMINGS="720 0 40 40 200 720 0 24 4 12 0 0 0 78 0 59400000 0"

# ------------------------------------------------------------------ options
DRY=0; INTERACTIVE=0; UNINSTALL=0; REBOOT=0; READONLY=0
DISPLAY_KIND=auto; DISPLAY_MODE=auto; ROTATE=""; HOSTNAME_WANT=""; WIFI_COUNTRY=""; AUDIO_HAT=""; HDMI_AUDIO=auto
AIRPLAY=1; PYATV=1; ROON=0; KIOSK=1; KIOSK_KIND=""; COMPOSITOR=""; APP_DIR_OPT=""; USER_OPT=""; REPO_URL="$REPO_URL_DEFAULT"; BRANCH=main; GIT_UPDATE=1
FROM_BOOTSTRAP=0; SPLASH_MODE=on
MODE=""; SERVER_URL=""
ORIG_ARGS=("$@")
THEME_DIR=/usr/share/plymouth/themes/roundremote
PLYMOUTH_DROPIN=/etc/systemd/system/plymouth-quit.service.d/roundremote.conf

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]:-/dev/null}" 2>/dev/null | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'; }

parse_args() {
  for a in "$@"; do
    case "$a" in
      --dry-run) DRY=1 ;;
      --interactive) INTERACTIVE=1 ;;
      --uninstall) UNINSTALL=1 ;;
      --reboot) REBOOT=1 ;;
      --readonly) READONLY=1 ;;
      --no-splash) SPLASH_MODE=off ;;
      --verbose-boot) SPLASH_MODE=verbose ;;
      --splash) SPLASH_MODE=on ;;
      --mode=*) MODE="${a#*=}" ;;
      --server=*) SERVER_URL="${a#*=}" ;;
      --display=*) DISPLAY_KIND="${a#*=}" ;;
      --display-mode=*) DISPLAY_MODE="${a#*=}" ;;
      --rotate=*) ROTATE="${a#*=}" ;;
      --hostname=*) HOSTNAME_WANT="${a#*=}" ;;
      --wifi-country=*) WIFI_COUNTRY="${a#*=}" ;;
      --audio-hat=*) AUDIO_HAT="${a#*=}" ;;
      --hdmi-audio=*) HDMI_AUDIO="${a#*=}" ;;
      --no-airplay) AIRPLAY=0 ;;
      --no-pyatv) PYATV=0 ;;
      --with-roon) ROON=1 ;;
      --no-kiosk) KIOSK=0 ;;
      --kiosk=*) KIOSK_KIND="${a#*=}" ;;
      --compositor=*) COMPOSITOR="${a#*=}" ;;
      --dir=*) APP_DIR_OPT="${a#*=}" ;;
      --user=*) USER_OPT="${a#*=}" ;;
      --repo=*) REPO_URL="${a#*=}" ;;
      --branch=*) BRANCH="${a#*=}" ;;
      --no-update) GIT_UPDATE=0 ;;
      --from-bootstrap) FROM_BOOTSTRAP=1 ;;
      --same-options) ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option: $a (see --help)" ;;
    esac
  done
  case "$MODE" in ""|full|companion) ;; *) die "--mode must be full or companion" ;; esac
  if [ -n "$SERVER_URL" ]; then SERVER_URL="$(server_url "$SERVER_URL")" || die "--server must look like http://192.168.50.108:8765 (or host:port)"; fi
  case "$DISPLAY_KIND" in auto|waveshare-4-hdmi|waveshare-4-dsi|none) ;; *) die "--display must be auto, waveshare-4-hdmi, waveshare-4-dsi or none" ;; esac
  case "$DISPLAY_MODE" in auto|edid|cvt|none) ;; *) die "--display-mode must be auto, edid, cvt or none" ;; esac
  case "$ROTATE" in ""|0|90|180|270) ;; *) die "--rotate must be 0, 90, 180 or 270" ;; esac
  case "$HDMI_AUDIO" in auto|on|off) ;; *) die "--hdmi-audio must be auto, on or off" ;; esac
  case "$KIOSK_KIND" in ""|service|autostart) ;; *) die "--kiosk must be service or autostart" ;; esac
  case "$COMPOSITOR" in ""|cage|labwc) ;; *) die "--compositor must be cage or labwc" ;; esac
  [[ -z "$HOSTNAME_WANT" || "$HOSTNAME_WANT" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ ]] || die "invalid --hostname"
  [[ -z "$WIFI_COUNTRY" || "$WIFI_COUNTRY" =~ ^[A-Z]{2}$ ]] || die "--wifi-country is a two-letter code like US or IL"
  [[ -z "$AUDIO_HAT" || "$AUDIO_HAT" =~ ^[a-z0-9][a-z0-9_-]*(,[a-z0-9_=-]+)*$ ]] || die "invalid --audio-hat overlay name"
  [[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "invalid --branch"
}

# ------------------------------------------------------------------ output + doing things
if [ -t 1 ]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=; G=; Y=; R=; N=; fi
step() { echo; echo "${B}==> $*${N}"; }
info() { echo "    $*"; }
warn() { echo "${Y}  ! $*${N}" >&2; }
die()  { echo "${R}ERROR: $*${N}" >&2; exit 1; }
q() { local s=""; for x in "$@"; do s+="$(printf '%q ' "$x")"; done; echo "${s% }"; }

SUDO=""
run()    { if [ "$DRY" = 1 ]; then echo "    [dry-run] $(q "$@")"; else "$@"; fi; }
root()   { if [ "$DRY" = 1 ]; then echo "    [dry-run] (root) $(q "$@")"; else $SUDO "$@"; fi; }
asuser() {
  if [ "$DRY" = 1 ]; then echo "    [dry-run] (as $TARGET_USER) $(q "$@")"; return 0; fi
  if [ "$(id -un)" = "$TARGET_USER" ]; then "$@"; else $SUDO -u "$TARGET_USER" -H "$@"; fi
}
# write_file PATH MODE OWNER[:GROUP] < content   — only when the content changed; shows a diff in dry-run
write_file() {
  local path="$1" mode="$2" owner="$3" tmp
  tmp="$(mktemp)"; cat > "$tmp"
  local old; old="$(mktemp)"
  if [ -r "$path" ]; then cat "$path" > "$old"; elif [ -e "$path" ]; then $SUDO cat "$path" > "$old" 2>/dev/null || true; fi
  if [ -e "$path" ] && cmp -s "$tmp" "$old"; then rm -f "$tmp" "$old"; info "unchanged: $path"; return 0; fi
  if [ "$DRY" = 1 ]; then
    echo "    [dry-run] write $path ($mode $owner)"
    # shellcheck disable=SC2094
    if ! tr -d '\000' < "$tmp" | cmp -s - "$tmp"; then echo "      (binary, $(wc -c < "$tmp") bytes)"
    elif [ -e "$path" ]; then diff -u "$old" "$tmp" | sed 's/^/      /' | head -60 || true
    else sed 's/^/      | /' "$tmp" | head -40 || true; fi
    rm -f "$tmp" "$old"; return 0
  fi
  $SUDO install -D -m "$mode" -o "${owner%%:*}" -g "${owner#*:}" "$tmp" "$path"
  rm -f "$tmp" "$old"
  info "wrote $path"
}
backup_once() { if [ -f "$1" ] && [ ! -f "$1.rr-orig" ]; then root cp -p "$1" "$1.rr-orig"; fi; }
ask() {   # ask VAR "question" default — only with --interactive and a terminal
  local var="$1" qn="$2" def="$3" ans=""
  if [ "$INTERACTIVE" = 1 ] && [ -r /dev/tty ]; then read -r -p "    $qn [$def] " ans < /dev/tty || true; fi
  printf -v "$var" '%s' "${ans:-$def}"
}
pkg_avail() { local c; c="$(apt-cache policy "$1" 2>/dev/null | awk '/Candidate:/{print $2}')"; [ -n "$c" ] && [ "$c" != "(none)" ]; }
pkg_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep "install ok installed" >/dev/null; }
first_avail() { for p in "$@"; do if pkg_avail "$p"; then echo "$p"; return 0; fi; done; return 1; }

# ------------------------------------------------------------------ pure text edits (also used by the tests)
# cmdline.txt is ONE line: drop the tokens we manage, then add the wanted ones.
cmdline_apply() {   # cmdline_apply "<current line>" token… → new line
  local line="$1"; shift
  local out=() t
  for t in $line; do
    case "$t" in video=HDMI-A-1:*|video=HDMI-A-2:*|drm.edid_firmware=*|consoleblank=*) continue ;; esac
    out+=("$t")
  done
  for t in "$@"; do [ -n "$t" ] && out+=("$t"); done
  echo "${out[*]}"
}
# config.txt: replace our marked block (or add it at the end, under [all]).
config_apply() {   # config_apply "<file content>" "<block lines>" → new content
  local content="$1" block="$2"
  local stripped
  stripped="$(printf '%s\n' "$content" | awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0==b{skip=1;next} $0==e{skip=0;next} !skip')"
  stripped="$(printf '%s\n' "$stripped" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"   # trim trailing blank lines
  if [ -z "$block" ]; then printf '%s\n' "$stripped"; return; fi
  printf '%s\n\n%s\n[all]\n%s\n%s\n' "$stripped" "$MARK_BEGIN" "$block" "$MARK_END"
}
display_tokens() {   # display_tokens KIND MODE → cmdline tokens for that choice
  local kind="$1" mode="$2"
  [ "$kind" = waveshare-4-hdmi ] || { echo "consoleblank=0"; return; }
  case "$mode" in
    auto) echo "video=HDMI-A-1:720x720e consoleblank=0" ;;
    edid) echo "drm.edid_firmware=HDMI-A-1:edid/$EDID_NAME video=HDMI-A-1:720x720e consoleblank=0" ;;
    cvt)  echo "video=HDMI-A-1:720x720M@60e consoleblank=0" ;;
    none) echo "consoleblank=0" ;;
  esac
}
# The boot splash: cmdline.txt tokens. on = quiet boot with the splash (kernel messages on tty3, no Raspberry Pi
# logos, no blinking cursor); verbose = boot messages on the screen; off = take our extras out again (Raspberry Pi
# OS's own "quiet splash plymouth.ignore-serial-consoles" stay as they are).
splash_cmdline() {   # splash_cmdline "<current line>" on|verbose|off → new line (ours stay where they are)
  local line="$1" mode="$2" out=() t seen=" "
  for t in $line; do
    case "$t" in
      logo.nologo|vt.global_cursor_default=*|loglevel=*|udev.log_level=*|quiet|splash|plymouth.ignore-serial-consoles)
        if [ "$mode" = on ]; then
          case "$t" in vt.global_cursor_default=*) t=vt.global_cursor_default=0 ;; loglevel=*) t=loglevel=3 ;; udev.log_level=*) t=udev.log_level=3 ;; esac
        elif [ "$mode" = verbose ] || ! [[ "$t" =~ ^(quiet|splash|plymouth\.ignore-serial-consoles)$ ]]; then continue; fi
        [[ "$seen" == *" $t "* ]] && continue ;;
      console=tty1|console=tty3) if [ "$mode" = on ]; then t=console=tty3; else t=console=tty1; fi ;;
    esac
    seen+="$t "; out+=("$t")
  done
  if [ "$mode" = on ]; then
    for t in quiet splash plymouth.ignore-serial-consoles logo.nologo vt.global_cursor_default=0 loglevel=3 udev.log_level=3; do
      [[ "$seen" == *" $t "* ]] || out+=("$t")
    done
  fi
  echo "${out[*]}"
}
splash_block() {   # splash_block on|verbose|off HAS_AUTO_INITRAMFS → config.txt lines
  [ "$1" = off ] && return 0
  [ "$1" = on ] && echo "disable_splash=1"
  [ "$2" = 1 ] || echo "auto_initramfs=1"
  return 0
}
display_block() {   # display_block KIND HAS_KMS_OVERLAY AUDIO_HAT NEED_I2C → config.txt lines
  local kind="$1" has_kms="$2" hat="$3" need_i2c="$4"
  [ "$has_kms" = 1 ] || echo "dtoverlay=vc4-kms-v3d"
  [ "$need_i2c" = 1 ] && echo "dtparam=i2c_arm=on"
  case "$kind" in
    waveshare-4-hdmi)
      echo "# Waveshare 4inch 720x720 round HDMI LCD. Under KMS the mode is set in cmdline.txt (video=HDMI-A-1:…)."
      echo "# Stop the firmware from adding its own video= mode (KMS reads the panel's EDID itself):"
      echo "disable_fw_kms_setup=1"
      echo "hdmi_force_hotplug=1"
      echo "# Legacy firmware driver only (ignored under KMS) — Waveshare's timings:"
      echo "#hdmi_group=2"
      echo "#hdmi_mode=87"
      echo "#hdmi_timings=$WAVESHARE_TIMINGS" ;;
    waveshare-4-dsi)
      echo "# Waveshare 4inch DSI round LCD (C), 720x720, on the DSI connector (add ,dsi0 for DSI0 on a CM4 / Pi 5)"
      echo "dtoverlay=vc4-kms-dsi-waveshare-panel,4_0_inchC" ;;
  esac
  [ -n "$hat" ] && echo "dtoverlay=$hat"
  return 0
}

# --server: "host", "host:port" or "http(s)://host[:port]" → http://host:port (port 8765 by default); fails otherwise
server_url() {
  local s="$1" proto=http hostport host port
  case "$s" in http://*) s="${s#http://}" ;; https://*) s="${s#https://}"; proto=https ;; esac
  s="${s%%/*}"
  hostport="$s"
  if [[ "$hostport" =~ ^\[([0-9a-fA-F:.]+)\](:([0-9]{1,5}))?$ ]]; then host="[${BASH_REMATCH[1]}]"; port="${BASH_REMATCH[3]}"
  elif [[ "$hostport" =~ ^([A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(:([0-9]{1,5}))?$ ]]; then host="${BASH_REMATCH[1]}"; port="${BASH_REMATCH[4]}"
  else return 1; fi
  [ -n "$port" ] || { [ "$proto" = https ] && port=443 || port=8765; }
  [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || return 1
  if [ "$proto" = https ] && [ "$port" = 443 ]; then echo "https://$host"; else echo "$proto://$host:$port"; fi
}
# the JSON the bridge / companion reads (bridge/companion.json): { "server": URL, "enabled": true }
companion_json() { printf '{\n  "server": "%s",\n  "enabled": %s\n}\n' "$1" "${2:-true}"; }
# Chromium flags for a Pi with little memory (Pi Zero 2 W: 512 MB) — see README → "Pi Zero 2 W"
LOWMEM_FLAGS="--renderer-process-limit=1 --enable-low-end-device-mode --js-flags=--max-old-space-size=192 --disk-cache-size=33554432 --disable-features=TranslateUI,Translate,MediaRouter,OptimizationHints,BackForwardCache"
# kiosk.env: set CHROMIUM_FLAGS for low memory unless the user wrote their own (ours, or the old default, get replaced)
kiosk_env_lowmem() {   # kiosk_env_lowmem "<file content>" → new content
  local c="$1" line="CHROMIUM_FLAGS=\"$LOWMEM_FLAGS\""
  if grep -Eq '^CHROMIUM_FLAGS=' <<<"$c"; then
    if grep -Eq '^CHROMIUM_FLAGS="(--renderer-process-limit=2|--renderer-process-limit=1 --enable-low-end-device-mode[^"]*)"$' <<<"$c"; then
      printf '%s\n' "$c" | sed -E "s|^CHROMIUM_FLAGS=.*$|$line|"
    else printf '%s\n' "$c"; fi
  else printf '%s\n%s\n' "$c" "$line"; fi
}

# ------------------------------------------------------------------ detection
detect() {
  [ "$(uname -s)" = Linux ] || die "this installer is for Raspberry Pi OS (Linux)"
  CODENAME="$(. /etc/os-release 2>/dev/null; echo "${VERSION_CODENAME:-}")"
  OS_PRETTY="$(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown}")"
  MODEL=""; [ -r /proc/device-tree/model ] && MODEL="$(tr -d '\0' < /proc/device-tree/model)"
  IS_PI=0; [[ "$MODEL" == *"Raspberry Pi"* ]] && IS_PI=1
  RAM_MB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1024 ))
  RAM_MB="${RR_TEST_RAM_MB:-$RAM_MB}"   # tests: pretend to be a Pi Zero 2 W (RR_TEST_RAM_MB=427)
  BOOT_DIR="${RR_BOOT_DIR:-/boot/firmware}"; [ -f "$BOOT_DIR/config.txt" ] || [ -n "${RR_BOOT_DIR:-}" ] || BOOT_DIR=/boot
  DESKTOP=0
  if systemctl is-enabled display-manager.service >/dev/null 2>&1 || [ -e /etc/systemd/system/display-manager.service ]; then DESKTOP=1; fi
  if [ "$(id -u)" != 0 ]; then command -v sudo >/dev/null || die "sudo is needed"; SUDO=sudo; fi
  TARGET_USER="${USER_OPT:-${SUDO_USER:-$(id -un)}}"
  if [ "$TARGET_USER" = root ]; then
    TARGET_USER="$(getent passwd 1000 | cut -d: -f1 || true)"
    [ -n "$TARGET_USER" ] || die "run this as your normal user (not root), or pass --user=NAME"
  fi
  id "$TARGET_USER" >/dev/null 2>&1 || die "no such user: $TARGET_USER"
  TARGET_UID="$(id -u "$TARGET_USER")"
  TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
  SCRIPT_DIR=""
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
  if [ -n "$APP_DIR_OPT" ]; then APP_DIR="$APP_DIR_OPT"
  elif [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../bridge/server.js" ]; then APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  else APP_DIR="$TARGET_HOME/RoundRemote"; fi
  if [ -z "$KIOSK_KIND" ]; then if [ "$DESKTOP" = 1 ]; then KIOSK_KIND=autostart; else KIOSK_KIND=service; fi; fi
  # --mode: keep the kind that is installed when it isn't given
  if [ -z "$MODE" ]; then
    if systemctl is-enabled --quiet roundremote-companion.service 2>/dev/null; then MODE=companion; else MODE=full; fi
  fi
  SERVICE=roundremote-bridge.service; OTHER_SERVICE=roundremote-companion.service
  if [ "$MODE" = companion ]; then
    SERVICE=roundremote-companion.service; OTHER_SERVICE=roundremote-bridge.service
    AIRPLAY=0; PYATV=0; ROON=0   # the server does media; this Pi only shows the app
  fi
  LOWMEM=0; [ "${RAM_MB:-0}" -gt 0 ] && [ "$RAM_MB" -lt 1024 ] && LOWMEM=1
  return 0
}

# ------------------------------------------------------------------ steps
step_repo() {
  step "App files in $APP_DIR"
  local piped=0; [ -z "$SCRIPT_DIR" ] && [ "$FROM_BOOTSTRAP" = 0 ] && piped=1
  if [ -f "$APP_DIR/bridge/server.js" ]; then
    git_quiet_modes
    if [ -d "$APP_DIR/.git" ] && [ "$GIT_UPDATE" = 1 ] && [ "$FROM_BOOTSTRAP" = 0 ]; then
      if [ -z "$(git -C "$APP_DIR" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
        asuser git -C "$APP_DIR" pull --ff-only --quiet </dev/null || warn "git pull failed — keeping the current version"
      else warn "local changes in $APP_DIR — not updating it (pi/update.sh --force stashes them)"; fi
    fi
    info "using $APP_DIR"
  else
    # piped from curl (or a fresh --dir): get git and clone
    pkg_installed git || { root apt-get update -y </dev/null; root env DEBIAN_FRONTEND=noninteractive apt-get install -y git ca-certificates </dev/null; }
    asuser git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR" </dev/null
    git_quiet_modes
    piped=1
  fi
  [ "$piped" = 1 ] || return 0
  # continue with the installer that came with the checkout (the same version as the app)
  if [ "$DRY" = 1 ] && [ ! -f "$APP_DIR/pi/install.sh" ]; then info "(dry-run: would continue with $APP_DIR/pi/install.sh)"; exit 0; fi
  info "continuing with $APP_DIR/pi/install.sh"
  local tty=/dev/null; [ "$INTERACTIVE" = 1 ] && [ -r /dev/tty ] && tty=/dev/tty
  exec bash "$APP_DIR/pi/install.sh" "${ORIG_ARGS[@]}" --from-bootstrap --user="$TARGET_USER" < "$tty"
}

# The installer makes pi/*.sh and pi/*.py executable; a checkout whose files GitHub stores without the x bit then looked
# "changed" (Settings → Updates: "local changes", and git pull refused). Executable bits aren't ours to track here.
git_quiet_modes() {
  [ -d "$APP_DIR/.git" ] || return 0
  [ "$(git -C "$APP_DIR" config --get core.fileMode 2>/dev/null)" = false ] && return 0
  asuser git -C "$APP_DIR" config core.fileMode false
  info "git: ignoring file-mode changes in $APP_DIR (core.fileMode false)"
}

step_packages() {
  step "Packages"
  root apt-get update -y </dev/null || warn "apt-get update had errors"
  local want=(git curl ca-certificates python3 network-manager dnsmasq-base nftables iw rfkill avahi-daemon avahi-utils libnss-mdns
    bluez pipewire pipewire-pulse wireplumber alsa-utils i2c-tools)
  [ "$MODE" = full ] && want+=(playerctl)   # Linux media players (the bridge's MPRIS adapter)
  local p
  p="$(first_avail python3-smbus2 python3-smbus || true)"; [ -n "$p" ] && want+=("$p")
  for p in pipewire-alsa wlr-randr wlopm fonts-noto-core fonts-noto-color-emoji; do pkg_avail "$p" && want+=("$p"); done
  p="$(first_avail chromium chromium-browser || true)"; if [ -n "$p" ]; then want+=("$p"); else warn "no Chromium package found"; fi
  if [ "$KIOSK" = 1 ] && [ "$KIOSK_KIND" = service ]; then
    if [ "$COMPOSITOR" != labwc ] && pkg_avail cage; then want+=(cage); COMPOSITOR="${COMPOSITOR:-cage}"
    elif pkg_avail labwc; then want+=(labwc); COMPOSITOR=labwc
    else warn "neither cage nor labwc is available — the kiosk can't start"; fi
  fi
  [ "$KIOSK_KIND" = autostart ] && pkg_avail unclutter && want+=(unclutter)
  [ "$AIRPLAY" = 1 ] && pkg_avail shairport-sync && want+=(shairport-sync)
  [ "$PYATV" = 1 ] && want+=(python3-pip)
  # Node.js ≥ 18: Debian's is fine on Bookworm (18) and Trixie (20); NodeSource otherwise
  local nodev=0
  command -v node >/dev/null && nodev="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$nodev" -lt 18 ]; then
    local cand; cand="$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/{print $2}' | sed 's/^[0-9]*://; s/\..*//')"
    if [[ "$cand" =~ ^[0-9]+$ ]] && [ "$cand" -ge 18 ]; then want+=(nodejs npm)
    else NEED_NODESOURCE=1; fi
  fi
  local missing=()
  for p in "${want[@]}"; do pkg_installed "$p" || missing+=("$p"); done
  if [ "${#missing[@]}" -gt 0 ]; then
    info "installing: ${missing[*]}"
    root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}" </dev/null
  else info "all packages present"; fi
  if [ "${NEED_NODESOURCE:-0}" = 1 ]; then
    info "Node.js from NodeSource (apt's is older than 18)"
    if [ "$DRY" = 1 ]; then echo "    [dry-run] curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    else curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash - && root env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs </dev/null; fi
  fi
  [ "$DRY" = 1 ] || info "node $(node -v 2>/dev/null || echo '?'), $(chromium --version 2>/dev/null || chromium-browser --version 2>/dev/null || echo 'chromium ?')"
  [ "$MODE" = companion ] && [ "$LOWMEM" = 1 ] && step_zram
  return 0
}

# zram swap on a small Pi (Pi Zero 2 W: 512 MB) — compressed swap in RAM gives Chromium room without wearing the SD
# card. Raspberry Pi OS Trixie already does this (rpi-swap: zram + a swap file); then nothing is changed here.
step_zram() {
  if pkg_installed rpi-swap || grep -q '^/dev/zram' /proc/swaps 2>/dev/null || [ -e /etc/systemd/zram-generator.conf ]; then
    info "zram swap: already set up by the system"; return 0
  fi
  pkg_avail zram-tools || { warn "no zram-tools package — skipping zram swap"; return 0; }
  pkg_installed zram-tools || root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends zram-tools </dev/null
  printf '%s\n' "# Round Remote (pi/install.sh --mode=companion): compressed swap in RAM for a Pi with little memory" "ALGO=zstd" "PERCENT=50" "PRIORITY=100" \
    | write_file /etc/default/zramswap 0644 root:root
  root systemctl enable --quiet --now zramswap.service || warn "zramswap didn't start"
  info "zram swap: on (zstd, half the RAM)"
}

step_bridge() {
  if [ "$MODE" = companion ]; then
    step "Light companion"
    info "bridge/companion.js needs no npm packages (no media adapters here — the server has them)"
    run chmod +x "$APP_DIR/pi/kiosk.sh" "$APP_DIR/pi/netcheck.sh" "$APP_DIR/pi/update.sh" "$APP_DIR/pi/imu.py" "$APP_DIR/pi/rr-tool.py"
    step_companion_conf
    return 0
  fi
  step "Bridge"
  asuser bash -c "cd $(q "$APP_DIR/bridge") && npm install --omit=dev --no-audit --no-fund" </dev/null || warn "npm install failed — try again later: cd $APP_DIR/bridge && npm install"
  [ "$ROON" = 1 ] && { asuser bash -c "cd $(q "$APP_DIR/bridge") && npm run roon" </dev/null || warn "Roon libraries failed"; }
  if [ ! -f "$APP_DIR/bridge/config.json" ]; then asuser cp "$APP_DIR/bridge/config.example.json" "$APP_DIR/bridge/config.json"; info "created bridge/config.json (edit keys there)"
  else info "keeping your bridge/config.json"; fi
  if [ "$PYATV" = 1 ] && ! asuser bash -c 'command -v atvscript' >/dev/null 2>&1; then
    asuser python3 -m pip install --user --break-system-packages --quiet pyatv </dev/null 2>/dev/null \
      || asuser python3 -m pip install --user --quiet pyatv </dev/null || warn "pyatv not installed — Apple TV control stays off"
  fi
  run chmod +x "$APP_DIR/pi/kiosk.sh" "$APP_DIR/pi/netcheck.sh" "$APP_DIR/pi/update.sh" "$APP_DIR/pi/imu.py" "$APP_DIR/pi/rr-tool.py"
  step_companion_conf
}

# --server=URL: bridge/companion.json (git-ignored; the bridge's own data folder) — the light companion's server, or
# on a full install "connect to this server" from the first start (Settings → Connection → Server changes it later)
step_companion_conf() {
  local f="$APP_DIR/bridge/companion.json"
  if [ -n "$SERVER_URL" ]; then
    companion_json "$SERVER_URL" true | write_file "$f" 0644 "$TARGET_USER:$(id -gn "$TARGET_USER" 2>/dev/null || echo "$TARGET_USER")"
    info "server: $SERVER_URL"
  elif [ "$MODE" = companion ] && ! grep -qs '"server": *"http' "$f"; then
    warn "no --server=URL given: the round screen asks for the server's address at the first start"
  elif [ "$MODE" = full ] && [ -e /etc/systemd/system/roundremote-companion.service ] && grep -qs '"enabled": *true' "$f"; then
    # light companion → full install: start with this Pi's own bridge (the address stays for Settings → Server)
    local old; old="$(sed -n 's/.*"server": *"\([^"]*\)".*/\1/p' "$f" | head -1)"
    companion_json "$old" false | write_file "$f" 0644 "$TARGET_USER:$(id -gn "$TARGET_USER" 2>/dev/null || echo "$TARGET_USER")"
    info "full install: this Pi's own bridge (the server ${old:-?} stays under Settings → Connection → Server)"
  fi
  return 0
}

step_system() {
  step "System settings"
  local g
  for g in video render input i2c bluetooth netdev audio gpio plugdev; do
    if getent group "$g" >/dev/null && ! id -nG "$TARGET_USER" | tr ' ' '\n' | grep -x "$g" >/dev/null; then root usermod -aG "$g" "$TARGET_USER"; info "$TARGET_USER joins $g"; fi
  done
  # I2C (motion sensor, UPS HAT battery)
  if command -v raspi-config >/dev/null; then
    if [ "$(raspi-config nonint get_i2c 2>/dev/null || echo 1)" != 0 ]; then root raspi-config nonint do_i2c 0; info "I2C on"; fi
    NEED_I2C_LINE=0
  else NEED_I2C_LINE=1; fi
  echo i2c-dev | write_file /etc/modules-load.d/roundremote-i2c.conf 0644 root:root
  # hostname + mDNS (roundremote.local)
  local cur; cur="$(hostname)"
  local newhost="${HOSTNAME_WANT:-}"
  if [ -z "$newhost" ] && [[ "$cur" == raspberrypi* || "$cur" == localhost ]]; then newhost=roundremote; fi
  if [ -n "$newhost" ] && [ "$newhost" != "$cur" ]; then
    if command -v raspi-config >/dev/null; then root raspi-config nonint do_hostname "$newhost"
    else root hostnamectl set-hostname "$newhost"; root sed -i "s/\b$cur\b/$newhost/g" /etc/hosts; fi
    info "hostname $cur → $newhost (after the reboot: http://$newhost.local:8765/)"
  else info "hostname: $cur"; fi
  root systemctl enable --quiet --now avahi-daemon || warn "avahi-daemon not running"
  if [ -n "$WIFI_COUNTRY" ] && command -v raspi-config >/dev/null; then root raspi-config nonint do_wifi_country "$WIFI_COUNTRY"; info "Wi-Fi country $WIFI_COUNTRY"; fi
  if command -v rfkill >/dev/null && rfkill list wifi 2>/dev/null | grep 'Soft blocked: yes' >/dev/null; then
    [ -n "$WIFI_COUNTRY" ] || warn "Wi-Fi is blocked until its country is set: run again with --wifi-country=XX (e.g. US, GB, IL)"
  fi
  if ! systemctl is-active --quiet NetworkManager 2>/dev/null; then
    warn "NetworkManager isn't running — the Wi-Fi settings and setup hotspot need it (default on Bookworm / Trixie)"
  fi
  # PipeWire etc. run at boot for this user (also before the kiosk logs in)
  root loginctl enable-linger "$TARGET_USER" || true
  [ "$READONLY" = 1 ] && step_readonly
  return 0
}

step_display() {
  step "Display ($DISPLAY_KIND)"
  local cfgf="$BOOT_DIR/config.txt" cmdf="$BOOT_DIR/cmdline.txt"
  if [ ! -f "$cfgf" ] || [ ! -f "$cmdf" ]; then warn "no $cfgf / $cmdf here (not a Pi?) — skipping display setup"; return 0; fi
  local kind="$DISPLAY_KIND"
  if [ "$kind" = auto ]; then
    if grep -q '^dtoverlay=vc4-kms-dsi-waveshare-panel' "$cfgf"; then kind=waveshare-4-dsi; else kind=waveshare-4-hdmi; fi
  fi
  local has_kms=0
  grep -Eq '^dtoverlay=vc4-(f)?kms-v3d' "$cfgf" && has_kms=1
  local cur_block; cur_block="$(awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0==b{s=1;next} $0==e{s=0;next} s' "$cfgf")"
  if [ "$has_kms" = 1 ] && grep -qx 'dtoverlay=vc4-kms-v3d' <<<"$cur_block" && [ "$(grep -Ec '^dtoverlay=vc4-(f)?kms-v3d' "$cfgf")" -le 1 ]; then has_kms=0; fi
  local hat="$AUDIO_HAT"
  [ -z "$hat" ] && hat="$(sed -n 's/^dtoverlay=\([a-z0-9_-]*\)$/\1/p' <<<"$cur_block" | grep -Ev '^vc4-' | head -1 || true)"
  local block="" has_initramfs=0 splash
  [ "$kind" != none ] && block="$(display_block "$kind" "$has_kms" "$hat" "${NEED_I2C_LINE:-0}")"
  # the boot splash (Plymouth) runs from the initramfs, which the firmware loads with auto_initramfs=1 (Pi OS default)
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0==b{s=1;next} $0==e{s=0;next} !s' "$cfgf" | grep -Eq '^(auto_initramfs=1|initramfs )' && has_initramfs=1
  splash="$(splash_block "$SPLASH_MODE" "$has_initramfs")"
  [ -n "$splash" ] && block="${block:+$block$'\n'}# boot splash (pi/plymouth, Plymouth from the initramfs)"$'\n'"$splash"
  backup_once "$cfgf"; backup_once "$cmdf"
  config_apply "$(cat "$cfgf")" "$block" | write_file "$cfgf" 0755 root:root
  local tokens; tokens="$(display_tokens "$kind" "$DISPLAY_MODE")"
  [ "$DISPLAY_MODE" = none ] && [ "$kind" = waveshare-4-hdmi ] && tokens="$(grep -oE '(video=HDMI-A-1:[^ ]*|drm\.edid_firmware=[^ ]*)' "$cmdf" | tr '\n' ' ') consoleblank=0"
  # the boot splash's tokens first (they stay in place), then the display's (always last) → one write, idempotent
  local line; line="$(head -1 "$cmdf")"
  [ "$SPLASH_MODE" != off ] && line="$(splash_cmdline "$line" "$SPLASH_MODE")"
  # shellcheck disable=SC2086
  cmdline_apply "$line" $tokens | write_file "$cmdf" 0755 root:root
  if [ "$kind" = waveshare-4-hdmi ] && [ "$DISPLAY_MODE" = edid ]; then
    local tmp; tmp="$(mktemp)"
    python3 "$APP_DIR/pi/rr-tool.py" edid --out "$tmp" --timings "$WAVESHARE_TIMINGS"
    write_file "/lib/firmware/edid/$EDID_NAME" 0644 root:root < "$tmp"; rm -f "$tmp"
  fi
  # what does the panel say right now? (only meaningful on the Pi with the screen connected)
  local m
  for m in /sys/class/drm/card*-HDMI-A-1/modes; do
    [ -r "$m" ] || continue
    if grep -qx 720x720 "$m"; then info "the panel reports 720x720 (EDID) — good"
    elif [ -s "$m" ]; then warn "the panel reports $(head -1 "$m") but not 720x720 — if the picture is wrong, run again with --display-mode=edid"
    else info "no EDID modes seen on HDMI-A-1 right now (screen off or on the other port?)"; fi
  done
  [ -f "$BOOT_DIR/config.txt.rr-orig" ] && info "originals kept as config.txt.rr-orig / cmdline.txt.rr-orig"
  NEEDS_REBOOT=1
}

step_audio() {
  step "Sound"
  local others=0
  if command -v aplay >/dev/null; then
    # anything besides the Pi's own HDMI / headphone outputs = a USB speaker or an I2S HAT
    others="$(aplay -l 2>/dev/null | grep '^card' | grep -Evci 'vc4-?hdmi|bcm2835 headphones|bcm2835 hdmi' || true)"
  fi
  [ -n "$AUDIO_HAT" ] && others=1
  local off=0
  case "$HDMI_AUDIO" in off) off=1 ;; on) off=0 ;; auto) [ "${others:-0}" -gt 0 ] && off=1 ;; esac
  local wpv; wpv="$(dpkg-query -W -f='${Version}' wireplumber 2>/dev/null || echo 0.5)"
  if [ "$off" = 1 ]; then
    if [[ "$wpv" == 0.4* ]]; then write_file /etc/wireplumber/main.lua.d/51-roundremote-no-hdmi.lua 0644 root:root < "$APP_DIR/pi/conf/wireplumber-51-roundremote-no-hdmi.lua"
    else write_file /etc/wireplumber/wireplumber.conf.d/51-roundremote-no-hdmi.conf 0644 root:root < "$APP_DIR/pi/conf/wireplumber-51-roundremote-no-hdmi.conf"; fi
    info "HDMI sound hidden (a USB / I2S speaker is the output) — --hdmi-audio=on brings it back"
  else
    root rm -f /etc/wireplumber/main.lua.d/51-roundremote-no-hdmi.lua /etc/wireplumber/wireplumber.conf.d/51-roundremote-no-hdmi.conf
    info "HDMI sound left on (no USB / I2S speaker found)"
  fi
  if [ "$AIRPLAY" = 1 ] && { pkg_installed shairport-sync || [ "$DRY" = 1 ]; }; then
    local conf=/etc/shairport-sync.conf
    if ! grep -q "Round Remote" "$conf" 2>/dev/null; then
      backup_once "$conf"
      write_file "$conf" 0644 root:root <<'EOF'
// Round Remote — shairport-sync configuration (pi/install.sh)
general = {
  name = "Round Display";
  dbus_service_bus = "system";
  mpris_service_bus = "system";
};
metadata = {
  enabled = "yes";
  include_cover_art = "yes";
  pipe_name = "/tmp/shairport-sync-metadata";
  pipe_timeout = 5000;
};
EOF
    fi
    root systemctl enable --quiet --now shairport-sync || warn "shairport-sync didn't start"
    info "AirPlay speaker \"Round Display\" (classic AirPlay; see README for AirPlay 2)"
  fi
}

# copy a folder's files to a root-owned folder, only what changed → SYNC_CHANGED=1 when something did
sync_dir() {
  local src="$1" dst="$2" f n=0
  SYNC_CHANGED=0
  for f in "$src"/*; do
    [ -f "$f" ] || continue
    if ! cmp -s "$f" "$dst/$(basename "$f")" 2>/dev/null; then
      n=$((n + 1)); SYNC_CHANGED=1
      [ "$DRY" = 1 ] || $SUDO install -D -m 0644 -o root -g root "$f" "$dst/$(basename "$f")"
    fi
  done
  if [ "$n" = 0 ]; then info "unchanged: $dst"
  elif [ "$DRY" = 1 ]; then echo "    [dry-run] copy $n file(s) to $dst"
  else info "updated $n file(s) in $dst"; fi
}

step_splash() {
  step "Boot splash ($SPLASH_MODE)"
  local cmdf="$BOOT_DIR/cmdline.txt"
  if [ "$SPLASH_MODE" = off ]; then
    if [ -d "$THEME_DIR" ] || grep -qs 'logo.nologo' "$cmdf"; then splash_remove; else info "left alone (--no-splash)"; fi
    return 0
  fi
  [ -d "$APP_DIR/pi/plymouth/roundremote" ] || { warn "pi/plymouth/roundremote is missing — skipping the boot splash"; return 0; }
  # Plymouth: the "script" plugin is in plymouth-themes on Debian / Raspberry Pi OS; plymouth-label draws text
  local want=() p
  for p in plymouth plymouth-themes plymouth-label; do pkg_avail "$p" && ! pkg_installed "$p" && want+=("$p"); done
  if ! pkg_avail plymouth && ! pkg_installed plymouth; then warn "no plymouth package — skipping the boot splash"; return 0; fi
  [ "${#want[@]}" -gt 0 ] && root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${want[@]}" </dev/null
  sync_dir "$APP_DIR/pi/plymouth/roundremote" "$THEME_DIR"
  local changed="$SYNC_CHANGED" cur=""
  command -v plymouth-set-default-theme >/dev/null && cur="$(plymouth-set-default-theme 2>/dev/null || true)"
  if [ "$cur" != roundremote ] || [ "$changed" = 1 ]; then
    info "making it the boot theme and rebuilding the initramfs (a minute or two)…"
    root plymouth-set-default-theme -R roundremote || warn "plymouth-set-default-theme failed — the splash may not show"
    NEEDS_REBOOT=1
  else info "boot theme: roundremote"; fi
  # Plymouth leaves its last frame (logo + full ring) on screen when it quits, until the kiosk draws
  local ply; ply="$(command -v plymouth || echo /usr/bin/plymouth)"
  printf '%s\n' "# Round Remote (pi/install.sh): when Plymouth quits, keep the boot splash's last frame on the screen until the" \
    "# kiosk (cage + Chromium) draws — no text console in between." "[Service]" "ExecStart=" "ExecStart=-$ply quit --retain-splash" \
    | write_file "$PLYMOUTH_DROPIN" 0644 root:root
  root systemctl daemon-reload
  if [ -f "$cmdf" ]; then
    backup_once "$cmdf"
    local before; before="$(head -1 "$cmdf")"
    splash_cmdline "$before" "$SPLASH_MODE" | write_file "$cmdf" 0755 root:root
    [ "$(splash_cmdline "$before" "$SPLASH_MODE")" = "$before" ] || NEEDS_REBOOT=1
  fi
  if [ "$DRY" = 0 ] && [ -d "$BOOT_DIR" ] && ! ls "$BOOT_DIR"/initramfs* >/dev/null 2>&1; then
    warn "no initramfs in $BOOT_DIR — the splash then starts a few seconds later (from the root file system)"
  fi
  if [ "$SPLASH_MODE" = verbose ]; then info "boot messages will show (run install.sh again without --verbose-boot to hide them)"
  else info "quiet boot: black → logo → Round Remote (boot messages: --verbose-boot)"; fi
}

splash_remove() {   # --no-splash after it was on, and --uninstall
  local cmdf="$BOOT_DIR/cmdline.txt"
  if [ -d "$THEME_DIR" ]; then
    if command -v plymouth-set-default-theme >/dev/null && [ "$(plymouth-set-default-theme 2>/dev/null)" = roundremote ]; then
      root plymouth-set-default-theme --reset
      root update-initramfs -u || warn "update-initramfs failed"
    fi
    root rm -rf "$THEME_DIR"; info "removed $THEME_DIR"
  fi
  [ -e "$PLYMOUTH_DROPIN" ] && { root rm -f "$PLYMOUTH_DROPIN"; root systemctl daemon-reload; info "removed $PLYMOUTH_DROPIN"; }
  if [ -f "$cmdf" ]; then splash_cmdline "$(head -1 "$cmdf")" off | write_file "$cmdf" 0755 root:root; fi
  NEEDS_REBOOT=1
}

step_files() {
  step "Root helper, sudo rules, hotspot"
  local sysctl nm
  sysctl="$(command -v systemctl || echo /usr/bin/systemctl)"; nm="$(command -v nmcli || echo /usr/bin/nmcli)"
  write_file /usr/local/sbin/roundremote-helper 0755 root:root < "$APP_DIR/pi/roundremote-helper.sh"
  local tmp; tmp="$(mktemp)"
  sed -e "s#__USER__#$TARGET_USER#g" -e "s#__SYSTEMCTL__#$sysctl#g" -e "s#__NMCLI__#$nm#g" "$APP_DIR/pi/conf/sudoers.in" > "$tmp"
  if command -v visudo >/dev/null && ! visudo -cqf "$tmp"; then rm -f "$tmp"; die "the sudoers file didn't validate — nothing changed"; fi
  write_file /etc/sudoers.d/roundremote 0440 root:root < "$tmp"; rm -f "$tmp"
  if [ -d /etc/polkit-1 ]; then
    sed "s#__USER__#$TARGET_USER#g" "$APP_DIR/pi/conf/polkit-roundremote.rules.in" | write_file /etc/polkit-1/rules.d/50-roundremote.rules 0644 root:root
  fi
  write_file /etc/pam.d/roundremote-kiosk 0644 root:root < "$APP_DIR/pi/conf/pam-roundremote-kiosk"
  write_file /etc/udev/rules.d/99-roundremote-backlight.rules 0644 root:root < "$APP_DIR/pi/conf/99-roundremote-backlight.rules"
  write_file /etc/NetworkManager/dnsmasq-shared.d/roundremote-captive.conf 0644 root:root < "$APP_DIR/pi/conf/dnsmasq-captive.conf"
  # the setup hotspot's password: made once, kept (shown on the round screen)
  if ! $SUDO test -f /etc/roundremote/hotspot.env; then
    local pw; pw="$(LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' < /dev/urandom | head -c 10 || true)"
    printf 'SSID=%s\nPASSWORD=%s\nCON=%s\nBAND=bg\nADDRESS=10.42.0.1\nBRIDGE_PORT=8765\nCAPTIVE_PORT=8766\n' "$HOTSPOT_SSID" "$pw" "$HOTSPOT_SSID" \
      | write_file /etc/roundremote/hotspot.env 0640 "root:$TARGET_USER"
  else info "keeping /etc/roundremote/hotspot.env"; fi
  if ! [ -f /etc/roundremote/kiosk.env ]; then
    { cat "$APP_DIR/pi/conf/kiosk.env.example"
      [ -n "$COMPOSITOR" ] && echo "ROUNDREMOTE_COMPOSITOR=$COMPOSITOR"
      if [ "$LOWMEM" = 1 ]; then echo "CHROMIUM_FLAGS=\"$LOWMEM_FLAGS\""; fi
    } | write_file /etc/roundremote/kiosk.env 0644 root:root
  elif [ "$LOWMEM" = 1 ]; then
    kiosk_env_lowmem "$(cat /etc/roundremote/kiosk.env)" | write_file /etc/roundremote/kiosk.env 0644 root:root
  fi
  if [ -n "$ROTATE" ] && [ "$DRY" = 0 ]; then
    local t=normal; [ "$ROTATE" != 0 ] && t="$ROTATE"
    root sed -i -e '/^#\{0,1\} *ROUNDREMOTE_TRANSFORM=/d' /etc/roundremote/kiosk.env
    echo "ROUNDREMOTE_TRANSFORM=$t" | root tee -a /etc/roundremote/kiosk.env >/dev/null
    info "screen turned: $t"
  elif [ -n "$ROTATE" ]; then echo "    [dry-run] set ROUNDREMOTE_TRANSFORM=$ROTATE in /etc/roundremote/kiosk.env"; fi
}

render_unit() { sed -e "s#__USER__#$TARGET_USER#g" -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__UID__#$TARGET_UID#g" -e "s#__SERVICE__#$SERVICE#g" "$APP_DIR/pi/$1"; }
step_services() {
  step "Services ($MODE: $SERVICE)"
  # switching kinds: the other one stops for good (both want port 8765)
  if [ -e "/etc/systemd/system/$OTHER_SERVICE" ]; then
    root systemctl disable --now --quiet "$OTHER_SERVICE" 2>/dev/null || true
    root rm -f "/etc/systemd/system/$OTHER_SERVICE"
    info "stopped and removed $OTHER_SERVICE"
  fi
  render_unit "$SERVICE" | write_file "/etc/systemd/system/$SERVICE" 0644 root:root
  render_unit roundremote-netcheck.service | write_file /etc/systemd/system/roundremote-netcheck.service 0644 root:root
  root systemctl daemon-reload
  root systemctl enable --quiet "$SERVICE" roundremote-netcheck.service
  root systemctl restart "$SERVICE"
  root systemctl restart roundremote-netcheck.service || true
  if [ "$KIOSK" = 0 ]; then info "kiosk: off (--no-kiosk)"
  elif [ "$KIOSK_KIND" = service ]; then
    render_unit roundremote-kiosk.service | write_file /etc/systemd/system/roundremote-kiosk.service 0644 root:root
    root systemctl daemon-reload
    root systemctl enable --quiet roundremote-kiosk.service
    if [ "$DESKTOP" = 1 ]; then root systemctl set-default multi-user.target; warn "the desktop no longer starts at boot (sudo systemctl set-default graphical.target brings it back)"; fi
    info "kiosk: ${COMPOSITOR:-cage} + Chromium on tty1 (starts at the next boot; now: sudo systemctl start roundremote-kiosk)"
  else
    step_autostart
  fi
  if [ "$DRY" = 0 ]; then
    for _ in $(seq 1 20); do curl -fsS -m 2 http://127.0.0.1:8765/api/info >/dev/null 2>&1 && break; sleep 1; done
    if curl -fsS -m 2 http://127.0.0.1:8765/api/info >/dev/null 2>&1; then info "${G}bridge is up on http://127.0.0.1:8765/${N}"
    else warn "the bridge didn't answer yet: journalctl -u ${SERVICE%.service} -e"; fi
  fi
}

step_autostart() {   # a desktop image: start the kiosk from the desktop session (the old pi/setup.sh way)
  local h="$TARGET_HOME" line="$APP_DIR/pi/kiosk.sh &"
  asuser mkdir -p "$h/.config/labwc" "$h/.config/lxsession/LXDE-pi"
  if ! grep -qs "kiosk.sh" "$h/.config/labwc/autostart"; then
    if [ "$DRY" = 1 ]; then echo "    [dry-run] append to $h/.config/labwc/autostart"; else echo "$line" | asuser tee -a "$h/.config/labwc/autostart" >/dev/null; fi
  fi
  if [ -f "$h/.config/wayfire.ini" ] && ! grep -q "roundremote" "$h/.config/wayfire.ini"; then
    if [ "$DRY" = 1 ]; then echo "    [dry-run] append to $h/.config/wayfire.ini"; else printf "\n[autostart]\nroundremote = %s/pi/kiosk.sh\n" "$APP_DIR" | asuser tee -a "$h/.config/wayfire.ini" >/dev/null; fi
  fi
  if ! grep -qs "kiosk.sh" "$h/.config/lxsession/LXDE-pi/autostart"; then
    if [ "$DRY" = 1 ]; then echo "    [dry-run] append to $h/.config/lxsession/LXDE-pi/autostart"; else echo "@$APP_DIR/pi/kiosk.sh" | asuser tee -a "$h/.config/lxsession/LXDE-pi/autostart" >/dev/null; fi
  fi
  info "kiosk: from the desktop's autostart (labwc / wayfire / LXDE)"
}

step_readonly() {
  warn "--readonly: the SD card becomes read-only after the reboot. Settings, Wi-Fi networks and updates made"
  warn "later are lost at every boot. Undo: sudo raspi-config nonint do_overlayfs 1 && sudo reboot"
  if command -v raspi-config >/dev/null; then root raspi-config nonint do_overlayfs 0; NEEDS_REBOOT=1; else warn "raspi-config not found — skipping"; fi
}

do_uninstall() {
  step "Removing Round Remote's services and system files (the app folder and packages stay)"
  root systemctl disable --now roundremote-kiosk.service roundremote-netcheck.service roundremote-bridge.service roundremote-companion.service 2>/dev/null || true
  local f
  for f in /etc/systemd/system/roundremote-{bridge,companion,kiosk,netcheck}.service /usr/local/sbin/roundremote-helper /etc/sudoers.d/roundremote \
           /etc/polkit-1/rules.d/50-roundremote.rules /etc/pam.d/roundremote-kiosk /etc/udev/rules.d/99-roundremote-backlight.rules \
           /etc/NetworkManager/dnsmasq-shared.d/roundremote-captive.conf /etc/modules-load.d/roundremote-i2c.conf \
           /etc/wireplumber/main.lua.d/51-roundremote-no-hdmi.lua /etc/wireplumber/wireplumber.conf.d/51-roundremote-no-hdmi.conf \
           "/lib/firmware/edid/$EDID_NAME"; do
    [ -e "$f" ] && root rm -f "$f" && info "removed $f"
  done
  root systemctl daemon-reload
  root nmcli connection delete id "$HOTSPOT_SSID" >/dev/null 2>&1 || true
  splash_remove
  if [ -f "$BOOT_DIR/config.txt" ]; then
    config_apply "$(cat "$BOOT_DIR/config.txt")" "" | write_file "$BOOT_DIR/config.txt" 0755 root:root
    # shellcheck disable=SC2046
    cmdline_apply "$(head -1 "$BOOT_DIR/cmdline.txt")" | write_file "$BOOT_DIR/cmdline.txt" 0755 root:root
  fi
  info "kept: $APP_DIR (delete it yourself), /etc/roundremote (hotspot password, kiosk.env), installed packages"
  info "the desktop (if any): sudo systemctl set-default graphical.target"
}

interactive_questions() {
  [ "$INTERACTIVE" = 1 ] || return 0
  step "Questions (Enter keeps the default)"
  ask DISPLAY_KIND "Screen: waveshare-4-hdmi, waveshare-4-dsi, auto or none?" "$DISPLAY_KIND"
  ask ROTATE "Turn the screen: 0, 90, 180 or 270?" "${ROTATE:-0}"
  ask WIFI_COUNTRY "Wi-Fi country code (e.g. US, GB, IL; empty = leave as is)?" "$WIFI_COUNTRY"
  WIFI_COUNTRY="${WIFI_COUNTRY^^}"
  ask HOSTNAME_WANT "Hostname?" "${HOSTNAME_WANT:-roundremote}"
  local a; ask a "AirPlay speaker (shairport-sync)? y/n" "$([ "$AIRPLAY" = 1 ] && echo y || echo n)"; [[ "$a" == [nN]* ]] && AIRPLAY=0
  parse_args --display="$DISPLAY_KIND" --rotate="$ROTATE" ${WIFI_COUNTRY:+--wifi-country="$WIFI_COUNTRY"} --hostname="$HOSTNAME_WANT"
}

summary() {
  step "Done"
  local pw="" h; h="$(hostname)"
  pw="$($SUDO sed -n 's/^PASSWORD=//p' /etc/roundremote/hotspot.env 2>/dev/null || true)"
  if [ "$MODE" = companion ]; then
    info "Light companion of ${SERVER_URL:-$(sed -n 's/.*"server": *"\([^"]*\)".*/\1/p' "$APP_DIR/bridge/companion.json" 2>/dev/null || true)}"
    info "The round screen shows Round Remote from the server; while it's offline, \"Server offline\" with Wi-Fi settings"
  fi
  info "Round Remote: http://127.0.0.1:8765/ on the Pi · http://$h.local:8765/ from your network"
  info "No Wi-Fi at boot? After ~45 s the Pi opens the Wi-Fi network \"$HOTSPOT_SSID\"${pw:+ (password: $pw)}:"
  info "join it with a phone and the setup page opens (or go to http://10.42.0.1:8765/system/wifi)."
  if [ "$MODE" = companion ]; then info "Keys and sign-ins (Spotify client ID, Jellyfin…) live on the server: its config.json → \"app\""
  else info "Keys (Spotify client ID, Jellyfin…): $APP_DIR/bridge/config.json → \"app\""; fi
  info "Logs: journalctl -u ${SERVICE%.service} -f · journalctl -u roundremote-kiosk -f"
  info "Update later: Settings → Device → Updates, or bash $APP_DIR/pi/update.sh"
  if [ "$LOWMEM" = 1 ]; then
    if [ "$MODE" = full ]; then warn "only ${RAM_MB} MB of RAM (Pi Zero 2 W?): the light companion fits better — bash $APP_DIR/pi/install.sh --mode=companion --server=http://<server>:8765"
    else info "only ${RAM_MB} MB of RAM: lighter Chromium settings, and the app starts with Reduce effects on"; fi
  fi
  if [ "${NEEDS_REBOOT:-0}" = 1 ]; then
    if [ "$REBOOT" = 1 ]; then info "rebooting…"; root systemctl reboot; else echo; echo "${B}Reboot to start the round screen:  sudo reboot${N}"; fi
  fi
}

SAVED_ARGS_FILE=/etc/roundremote/install-args
# the options worth repeating next time (not one-off ones like --dry-run or --reboot)
saved_args() { local a; for a in "$@"; do case "$a" in --dry-run|--interactive|--reboot|--uninstall|--from-bootstrap|--same-options|--no-update|--user=*|-h|--help) ;; *) printf '%s\n' "$a" ;; esac; done; }

main() {
  local a saved=()
  for a in "$@"; do
    if [ "$a" = --same-options ] && [ -r "$SAVED_ARGS_FILE" ]; then mapfile -t saved < "$SAVED_ARGS_FILE"; break; fi
  done
  parse_args "${saved[@]}" "$@"
  [ "${#saved[@]}" -gt 0 ] && ORIG_ARGS=("${saved[@]}" "${ORIG_ARGS[@]}")
  detect
  if [ "$DRY" = 0 ]; then
    LOG="$TARGET_HOME/roundremote-install.log"
    if touch "$LOG" 2>/dev/null || $SUDO touch "$LOG" 2>/dev/null; then
      $SUDO chown "$TARGET_USER" "$LOG" 2>/dev/null || true
      exec > >(tee -a "$LOG") 2>&1
    fi
  fi
  echo "${B}Round Remote installer${N} — $(date '+%F %T')$([ "$DRY" = 1 ] && echo ' (dry run: nothing is changed)')"
  info "system: $OS_PRETTY${MODEL:+ · $MODEL} · ${RAM_MB} MB RAM · boot files in $BOOT_DIR"
  info "user: $TARGET_USER ($TARGET_HOME) · app: $APP_DIR · kiosk: $([ "$KIOSK" = 1 ] && echo "$KIOSK_KIND" || echo off) · mode: $MODE${SERVER_URL:+ · server: $SERVER_URL}"
  [ "$IS_PI" = 1 ] || warn "this doesn't look like a Raspberry Pi — continuing, but the display and I2C steps may not apply"
  case "$CODENAME" in bookworm|trixie) ;; *) warn "tested on Raspberry Pi OS Bookworm and Trixie; this is '${CODENAME:-unknown}'" ;; esac
  if [ "$UNINSTALL" = 1 ]; then do_uninstall; exit 0; fi
  interactive_questions
  step_repo
  step_packages
  step_bridge
  step_system
  step_display
  step_splash
  step_audio
  step_files
  step_services
  saved_args "${ORIG_ARGS[@]}" | write_file "$SAVED_ARGS_FILE" 0644 root:root
  summary
}

# everything above is functions, so `curl … | bash` reads the whole file before running anything
if [ "${RR_INSTALL_SOURCED:-0}" != 1 ]; then main "$@"; fi
