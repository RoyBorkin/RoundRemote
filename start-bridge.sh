#!/usr/bin/env bash
# Round Remote bridge for macOS / Linux: Roon, UPnP/DLNA, Google Cast (and AirPlay on Linux).
# The GitHub Pages app finds it automatically (Chrome asks once to allow local network access).
set -e
cd "$(dirname "$0")/bridge"
command -v node >/dev/null || { echo "Node.js is required: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install --omit=dev --no-audit --no-fund
[ -d node_modules/androidtv-remote ] || { echo "Adding the Google TV remote add-on..."; npm install --no-save --no-audit --no-fund androidtv-remote || true; }
echo "Round Remote bridge running at http://127.0.0.1:8765/  (Ctrl+C to stop)"
exec node server.js
