#!/usr/bin/env bash
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
# Round Remote root helper — the only thing the bridge may run as root (through /etc/sudoers.d/roundremote).
# pi/install.sh copies it to /usr/local/sbin/roundremote-helper (owned by root, so the bridge user can't change it).
# Every argument is checked against an allow-list; anything else is refused.
#
#   roundremote-helper governor ondemand|powersave|performance|schedutil|conservative
#   roundremote-helper wifi-powersave on|off [IFACE]
#   roundremote-helper backlight 0-1023              (DSI panels with a software backlight)
#   roundremote-helper rfkill-unblock wifi|bluetooth
#   roundremote-helper hotspot-on [manual] | hotspot-off | hotspot-status
#       the "RoundRemote-Setup" access point (NetworkManager shared mode, 10.42.0.1) + a captive-portal redirect of
#       port 80 to the bridge (nftables), settings in /etc/roundremote/hotspot.env
set -euo pipefail
export LC_ALL=C.UTF-8
# a fixed PATH; RR_* overrides exist for the tests only (sudo resets the environment, so the bridge can't set them)
PATH="${RR_TEST_PATH:+$RR_TEST_PATH:}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
SYS="${RR_SYS_ROOT:-}"
ETC="${RR_ETC_DIR:-/etc/roundremote}"
RUN="${RR_RUN_DIR:-/run/roundremote}"

die() { echo "roundremote-helper: $*" >&2; exit 2; }
log() { logger -t roundremote-helper -- "$*" 2>/dev/null || true; echo "$*"; }

wifi_iface() {
  nmcli -t -f DEVICE,TYPE device 2>/dev/null | awk -F: '$2=="wifi"{print $1; exit}'
}

load_hotspot_env() {
  SSID=RoundRemote-Setup; PASSWORD=; CON=RoundRemote-Setup; BAND='bg'; CAPTIVE_PORT=8766; BRIDGE_PORT=8765; ADDRESS=10.42.0.1
  if [ -r "$ETC/hotspot.env" ]; then
    # shellcheck disable=SC1091
    while IFS='=' read -r k v; do
      v="${v%\"}"; v="${v#\"}"
      case "$k" in
        SSID|PASSWORD|CON|BAND|CAPTIVE_PORT|BRIDGE_PORT|ADDRESS) printf -v "$k" '%s' "$v" ;;
      esac
    done < <(grep -E '^[A-Z_]+=' "$ETC/hotspot.env")
  fi
  [[ "$CAPTIVE_PORT" =~ ^[0-9]{2,5}$ ]] || CAPTIVE_PORT=8766
  [[ "$BRIDGE_PORT" =~ ^[0-9]{2,5}$ ]] || BRIDGE_PORT=8765
  [[ "$BAND" =~ ^(a|bg)$ ]] || BAND='bg'
}

captive_rules() {   # on|off IFACE
  command -v nft >/dev/null || return 0
  nft delete table ip roundremote_captive 2>/dev/null || true
  [ "$1" = on ] || return 0
  nft -f - <<EOF
table ip roundremote_captive {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    iifname "$2" tcp dport 80 redirect to :$CAPTIVE_PORT
  }
}
EOF
}

poke_bridge() {   # tell the bridge to (re)start its captive-portal listener
  if command -v curl >/dev/null; then curl -fsS -m 3 -o /dev/null "http://127.0.0.1:${BRIDGE_PORT}/api/system/hotspot" 2>/dev/null || true; fi
}

hotspot_on() {
  load_hotspot_env
  local ifc; ifc="$(wifi_iface)"
  [ -n "$ifc" ] || die "no Wi-Fi adapter"
  rfkill unblock wifi 2>/dev/null || true
  nmcli radio wifi on || true
  mkdir -p "$RUN"
  # remember what's around: the radio can't scan while it is the access point
  if nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY,BSSID device wifi list --rescan yes > "$RUN/wifi-scan.txt.tmp" 2>/dev/null; then
    mv -f "$RUN/wifi-scan.txt.tmp" "$RUN/wifi-scan.txt"
  else rm -f "$RUN/wifi-scan.txt.tmp"; fi
  local sec=(802-11-wireless-security.key-mgmt none)
  if [ -n "$PASSWORD" ]; then
    # WPA2-PSK/AES only, PMF off: what the Pi's brcmfmac access point handles reliably
    sec=(802-11-wireless-security.key-mgmt wpa-psk 802-11-wireless-security.psk "$PASSWORD" 802-11-wireless-security.proto rsn
         802-11-wireless-security.pairwise ccmp 802-11-wireless-security.group ccmp 802-11-wireless-security.pmf 1)
  fi
  if nmcli -t -f NAME connection show | grep -xF "$CON" >/dev/null; then
    nmcli connection modify "$CON" connection.interface-name "$ifc" 802-11-wireless.ssid "$SSID" 802-11-wireless.band "$BAND" "${sec[@]}"
  else
    nmcli connection add type wifi ifname "$ifc" con-name "$CON" autoconnect no ssid "$SSID" \
      802-11-wireless.mode ap 802-11-wireless.band "$BAND" ipv4.method shared ipv4.addresses "$ADDRESS/24" ipv6.method disabled "${sec[@]}"
  fi
  nmcli connection modify "$CON" connection.autoconnect no
  nmcli --wait 30 connection up "$CON" ifname "$ifc"
  captive_rules on "$ifc"
  if [ "${1:-}" = manual ]; then touch "$RUN/hotspot-manual"; else rm -f "$RUN/hotspot-manual"; fi
  log "hotspot $SSID on ($ifc)"
  poke_bridge
}

hotspot_off() {
  load_hotspot_env
  nmcli connection down id "$CON" 2>/dev/null || true
  captive_rules off ""
  rm -f "$RUN/hotspot-manual"
  log "hotspot off"
  poke_bridge
}

hotspot_status() {
  load_hotspot_env
  if nmcli -t -f NAME connection show --active 2>/dev/null | grep -xF "$CON" >/dev/null; then echo on; else echo off; fi
}

cmd="${1:-}"; shift || true
case "$cmd" in
  governor)
    g="${1:-}"
    [[ "$g" =~ ^(ondemand|powersave|performance|schedutil|conservative)$ ]] || die "governor: not allowed: $g"
    avail="$(cat "$SYS/sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors" 2>/dev/null || true)"
    [[ " $avail " == *" $g "* ]] || die "governor $g not offered by this CPU ($avail)"
    for f in "$SYS"/sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_governor; do echo "$g" > "$f"; done
    log "governor $g" ;;
  wifi-powersave)
    v="${1:-}"; ifc="${2:-$(wifi_iface)}"
    [[ "$v" =~ ^(on|off)$ ]] || die "wifi-powersave on|off"
    [[ "$ifc" =~ ^[a-zA-Z0-9_.-]{1,15}$ ]] || die "bad interface"
    if command -v iw >/dev/null; then iw dev "$ifc" set power_save "$v"; fi
    log "wifi power save $v ($ifc)" ;;
  backlight)
    v="${1:-}"
    [[ "$v" =~ ^[0-9]{1,4}$ ]] || die "backlight 0-1023"
    found=0
    for d in "$SYS"/sys/class/backlight/*; do
      [ -e "$d/brightness" ] || continue
      max="$(cat "$d/max_brightness" 2>/dev/null || echo 255)"
      [ "$v" -le "$max" ] || v="$max"
      echo "$v" > "$d/brightness"; found=1
    done
    [ "$found" = 1 ] || die "no software backlight on this screen" ;;
  rfkill-unblock)
    [[ "${1:-}" =~ ^(wifi|bluetooth)$ ]] || die "rfkill-unblock wifi|bluetooth"
    rfkill unblock "$1" ;;
  hotspot-on) [[ -z "${1:-}" || "$1" == manual ]] || die "hotspot-on [manual]"; hotspot_on "${1:-}" ;;
  hotspot-off) hotspot_off ;;
  hotspot-status) hotspot_status ;;
  *) die "usage: governor|wifi-powersave|backlight|rfkill-unblock|hotspot-on|hotspot-off|hotspot-status" ;;
esac
