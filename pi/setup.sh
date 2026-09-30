#!/usr/bin/env bash
# Round Remote — Raspberry Pi setup (Raspberry Pi OS Bookworm, desktop image).
# Installs Node + the bridge as a service, optional AirPlay receiver (shairport-sync),
# and starts Chromium full-screen on the round display at boot.
#
#   cd ~/RoundRemote && bash pi/setup.sh            # everything
#   bash pi/setup.sh --no-airplay                   # skip shairport-sync
#   bash pi/setup.sh --with-roon                    # also install Roon extension libs
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME="${SUDO_USER:-$USER}"
AIRPLAY=1; ROON=0
for a in "$@"; do
  case "$a" in
    --no-airplay) AIRPLAY=0 ;;
    --with-roon) ROON=1 ;;
  esac
done

echo "==> Round Remote in $APP_DIR (user: $USER_NAME)"

echo "==> Packages"
sudo apt-get update -y
sudo apt-get install -y git curl chromium-browser unclutter playerctl || sudo apt-get install -y git curl chromium unclutter playerctl  # playerctl: control Sidra / Chromium / Spotify on the Pi
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  sudo apt-get install -y nodejs npm
fi
echo "    node $(node -v)"

echo "==> Bridge dependencies"
cd "$APP_DIR/bridge"
npm install --omit=dev --no-audit --no-fund
# Apple TV (the "AirPlay · Apple TV" tile in Movies & TV) uses pyatv
if ! command -v atvscript >/dev/null 2>&1; then
  sudo apt-get install -y python3-pip || true
  pip3 install --user --break-system-packages pyatv 2>/dev/null || pip3 install --user pyatv || echo "pyatv not installed — Apple TV control will be off (pip3 install pyatv)"
fi
if [ "$ROON" = 1 ]; then npm run roon; fi
[ -f config.json ] || cp config.example.json config.json

if [ "$AIRPLAY" = 1 ]; then
  echo "==> AirPlay receiver (shairport-sync)"
  sudo apt-get install -y shairport-sync
  CONF=/etc/shairport-sync.conf
  if ! grep -q "Round Remote" "$CONF" 2>/dev/null; then
    sudo cp "$CONF" "$CONF.bak" 2>/dev/null || true
    sudo tee "$CONF" >/dev/null <<'EOF'
// Round Remote — shairport-sync configuration
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
  sudo systemctl enable --now shairport-sync || true
  echo "    For AirPlay 2 build shairport-sync from source with --with-airplay-2 (see README)."
fi

echo "==> Bridge service"
sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__USER__#$USER_NAME#g" "$APP_DIR/pi/roundremote-bridge.service" \
  | sudo tee /etc/systemd/system/roundremote-bridge.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now roundremote-bridge
sleep 2
curl -fsS http://127.0.0.1:8765/api/info >/dev/null && echo "    bridge is up on http://127.0.0.1:8765/"

echo "==> Kiosk autostart"
chmod +x "$APP_DIR/pi/kiosk.sh"
LINE="$APP_DIR/pi/kiosk.sh &"
# labwc (Pi OS Bookworm, late 2024+)
mkdir -p "/home/$USER_NAME/.config/labwc"
grep -qs "kiosk.sh" "/home/$USER_NAME/.config/labwc/autostart" || echo "$LINE" >> "/home/$USER_NAME/.config/labwc/autostart"
# wayfire (early Bookworm)
if [ -f "/home/$USER_NAME/.config/wayfire.ini" ] && ! grep -q "roundremote" "/home/$USER_NAME/.config/wayfire.ini"; then
  printf "\n[autostart]\nroundremote = %s/pi/kiosk.sh\n" "$APP_DIR" >> "/home/$USER_NAME/.config/wayfire.ini"
fi
# X11 / LXDE (Bullseye)
mkdir -p "/home/$USER_NAME/.config/lxsession/LXDE-pi"
grep -qs "kiosk.sh" "/home/$USER_NAME/.config/lxsession/LXDE-pi/autostart" || echo "@$APP_DIR/pi/kiosk.sh" >> "/home/$USER_NAME/.config/lxsession/LXDE-pi/autostart"
chown -R "$USER_NAME" "/home/$USER_NAME/.config"

echo
echo "Done. Reboot to start the kiosk:  sudo reboot"
echo "Edit keys (Spotify client ID, Jellyfin server…) in $APP_DIR/bridge/config.json → 'app'."
