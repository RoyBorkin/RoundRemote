#!/usr/bin/env bash
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
# roundremote-netcheck (a root service): first-boot / no-network Wi-Fi setup.
#  • If no network (Ethernet or Wi-Fi) is up within WAIT seconds after boot, start the "RoundRemote-Setup"
#    hotspot (password in /etc/roundremote/hotspot.env, shown on the round screen under Settings → Device → Wi-Fi).
#    Phones that join it get the setup page (captive portal → http://10.42.0.1:8765/system/wifi).
#  • Once a real network is up (Ethernet plugged in, or Wi-Fi joined from the screen / a phone), stop the hotspot.
#  • When the hotspot has been up with nobody on it for RETRY seconds and saved Wi-Fi networks exist, give them
#    another try (the router may simply have been off at boot), then come back if none answers.
# A hotspot switched on by hand (Settings → Device → Wi-Fi → Setup hotspot) is left alone.
set -uo pipefail
export LC_ALL=C.UTF-8
WAIT="${RR_NETCHECK_WAIT:-45}"
RETRY="${RR_NETCHECK_RETRY:-300}"
TICK="${RR_NETCHECK_TICK:-10}"
HELPER="${RR_HELPER:-/usr/local/sbin/roundremote-helper}"
RUN="${RR_RUN_DIR:-/run/roundremote}"
CON=RoundRemote-Setup
[ -r /etc/roundremote/hotspot.env ] && CON="$(sed -n 's/^CON=//p' /etc/roundremote/hotspot.env | tr -d '"' | head -1)"
CON="${CON:-RoundRemote-Setup}"
ONCE=0; [ "${1:-}" = --once ] && ONCE=1

say() { echo "netcheck: $*"; }

# 0 when a real (non-hotspot) Ethernet or Wi-Fi connection is active
online() {
  local line type name
  while IFS= read -r line; do
    type="${line%%:*}"; name="${line#*:}"; name="${name//\\:/:}"; name="${name//\\\\/\\}"
    case "$type" in
      802-3-ethernet|ethernet|802-11-wireless|wifi) [ "$name" != "$CON" ] && return 0 ;;
    esac
  done < <(nmcli -t -f TYPE,NAME connection show --active 2>/dev/null)
  return 1
}
hotspot_on() { nmcli -t -f NAME connection show --active 2>/dev/null | grep -xF "$CON" >/dev/null; }
has_wifi() { nmcli -t -f TYPE device 2>/dev/null | grep -x wifi >/dev/null; }
saved_wifi() {
  local n=0 line type name
  while IFS= read -r line; do
    type="${line%%:*}"; name="${line#*:}"
    case "$type" in 802-11-wireless|wifi) [ "${name//\\:/:}" != "$CON" ] && n=$((n + 1)) ;; esac
  done < <(nmcli -t -f TYPE,NAME connection show 2>/dev/null)
  [ "$n" -gt 0 ]
}
clients() {   # stations on the access point
  local ifc; ifc="$(nmcli -t -f DEVICE,TYPE device 2>/dev/null | awk -F: '$2=="wifi"{print $1; exit}')"
  if command -v iw >/dev/null && [ -n "$ifc" ]; then iw dev "$ifc" station dump 2>/dev/null | grep -c '^Station' || true
  else echo 0; fi
}

has_wifi || { say "no Wi-Fi adapter — nothing to do"; [ "$ONCE" = 1 ] && exit 0; }

# 1) boot: wait for a network
start=$(date +%s)
until online; do
  if [ $(( $(date +%s) - start )) -ge "$WAIT" ]; then
    if has_wifi && ! hotspot_on; then say "no network after ${WAIT}s — starting the setup hotspot"; "$HELPER" hotspot-on || say "hotspot failed"; fi
    break
  fi
  sleep 2
done
[ "$ONCE" = 1 ] && exit 0

# 2) watch
idle=0
while sleep "$TICK"; do
  manual=0; [ -e "$RUN/hotspot-manual" ] && manual=1
  if hotspot_on; then
    if [ "$manual" = 1 ]; then idle=0; continue; fi
    if [ "$(clients)" -gt 0 ]; then idle=0; continue; fi
    idle=$((idle + TICK))
    if [ "$idle" -ge "$RETRY" ] && saved_wifi; then
      say "nobody on the hotspot — trying the saved networks again"
      "$HELPER" hotspot-off >/dev/null || true
      idle=0
      for _ in $(seq 1 $(( (WAIT + 1) / 2 ))); do online && break; sleep 2; done
      if online; then say "back online"; else say "still no network — hotspot back on"; "$HELPER" hotspot-on || true; fi
    fi
  else
    idle=0
    # lost the network later (not at boot): bring the hotspot up only after a long outage, and only with Wi-Fi
    if ! online && has_wifi; then
      lost="${lost:-$(date +%s)}"
      if [ $(( $(date +%s) - lost )) -ge $((RETRY + WAIT)) ]; then say "network gone for a while — starting the setup hotspot"; "$HELPER" hotspot-on || true; unset lost; fi
    else unset lost; fi
  fi
  # a real network next to a hotspot we started ourselves (e.g. Ethernet plugged in): stop the hotspot
  if [ "$manual" = 0 ] && hotspot_on && online; then say "network is up — stopping the hotspot"; "$HELPER" hotspot-off >/dev/null || true; fi
done
