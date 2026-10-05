#!/usr/bin/env bash
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
# Round Remote — Raspberry Pi setup. Kept for the old instructions: it now runs pi/install.sh, which does
# everything setup.sh did (bridge service, AirPlay, playerctl, pyatv, the kiosk) and the appliance parts.
#   bash pi/setup.sh [--no-airplay] [--with-roon] [any pi/install.sh option, see: bash pi/install.sh --help]
# On a Pi OS *desktop* image the kiosk still starts from the desktop's autostart, as before; on Pi OS Lite it
# runs as its own service (cage + Chromium, no desktop).
exec bash "$(dirname "${BASH_SOURCE[0]}")/install.sh" "$@"
