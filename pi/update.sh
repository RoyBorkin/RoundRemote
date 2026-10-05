#!/usr/bin/env bash
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
# Update Round Remote from GitHub: git pull (fast-forward only) + npm install (when bridge/package.json changed)
# + restart the bridge. Settings → Device → Updates runs it through the bridge (POST /api/system/update), or run
# it yourself:   bash ~/RoundRemote/pi/update.sh
#   --no-restart   don't restart the bridge (the bridge restarts itself after answering)
#   --force        (kept for older bridges; local changes are always put aside now — see below)
# Local changes to tracked files (an edit over SSH…) never stop an update and are never lost: they're saved as a commit
# on a branch "local-changes/<date>" (git log local-changes/<date>; git stash list too), then the checkout is reset to
# what was committed. Your settings are never touched: bridge/config.json, companion.json, system-state.json, sign-ins
# and lists aren't tracked by git (.gitignore). Changed file modes (chmod +x by the installer) aren't changes at all.
# Works for both kinds of install: the full bridge and the light companion (roundremote-companion.service).
#   --apply-system when the update changed system-level files (the installer, services, sudo rules, the boot splash
#                  theme in pi/plymouth/…), run pi/install.sh right away with the options of its last run
#                  (--same-options, non-interactive; needs sudo — run it over SSH, not from Settings)
# The last line is machine-readable: RESULT updated=0|1 from=<sha> to=<sha> system=0|1 [error=…]
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
RESTART=1; FORCE=0; APPLY=0
for a in "$@"; do case "$a" in --no-restart) RESTART=0 ;; --force) FORCE=1 ;; --apply-system) APPLY=1 ;; esac; done
# system-level files: they only take effect after pi/install.sh runs again (kiosk.sh, boot.html, rr-tool.py are
# used straight from the checkout: when they change, the kiosk is restarted below)
SYSTEM_RE='^pi/(install\.sh|roundremote-helper\.sh|netcheck\.sh|.*\.service|conf/|plymouth/)'
apply_system() {
  echo "update: applying system changes — bash pi/install.sh --same-options --no-update"
  bash pi/install.sh --same-options --no-update </dev/null || fail "pi/install.sh failed (see ~/roundremote-install.log)"
}
fail() { echo "update: $1" >&2; echo "RESULT updated=0 error=${1// /_}"; exit 1; }

command -v git >/dev/null || fail "git is not installed"
[ -d .git ] || fail "not a git checkout (install with pi/install.sh to get updates)"
: "$FORCE"
# the installer's chmod +x isn't a local change (GitHub may store these files without the executable bit)
[ "$(git config --get core.fileMode)" = false ] || git config core.fileMode false
SERVICE=roundremote-bridge.service
systemctl is-enabled --quiet roundremote-companion.service 2>/dev/null && SERVICE=roundremote-companion.service
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  backup="local-changes/$(date +%Y%m%d-%H%M%S)"
  git -c user.name="Round Remote" -c user.email="update@roundremote.local" stash push -m "roundremote-update $backup" >/dev/null || fail "git stash failed"
  git branch "$backup" 'stash@{0}' 2>/dev/null || true
  echo "update: local changes saved on branch $backup (and in git stash list) — the files are back as committed"
fi
from="$(git rev-parse --short HEAD)"
git fetch --quiet || fail "can't reach GitHub (git fetch failed)"
upstream="$(git rev-parse --short '@{u}' 2>/dev/null)" || fail "this branch has no upstream"
if [ "$from" = "$upstream" ] || [ "$(git rev-list --count 'HEAD..@{u}')" = 0 ]; then
  echo "update: already up to date ($from)"
  [ "$APPLY" = 1 ] && apply_system
  echo "RESULT updated=0 from=$from to=$from system=0"
  exit 0
fi
changed="$(git diff --name-only HEAD '@{u}')"
git merge --ff-only --quiet '@{u}' || fail "can't fast-forward (local commits?)"
to="$(git rev-parse --short HEAD)"
echo "update: $from → $to"
if [ "$SERVICE" = roundremote-companion.service ]; then :   # the light companion needs no npm packages
elif grep -qx 'bridge/package.json' <<<"$changed" || [ ! -d bridge/node_modules ]; then
  echo "update: npm install"
  (cd bridge && npm install --omit=dev --no-audit --no-fund) || fail "npm install failed"
fi
system=0
if grep -Eq "$SYSTEM_RE" <<<"$changed"; then
  system=1
  if [ "$APPLY" = 1 ]; then apply_system; system=0
  else echo "update: system files changed — apply them once with: bash ~/RoundRemote/pi/update.sh --apply-system (or bash ~/RoundRemote/pi/install.sh --same-options)"; fi
fi
if [ "$RESTART" = 1 ]; then
  sudo -n systemctl --no-block restart "$SERVICE" 2>/dev/null || echo "update: restart it yourself (sudo systemctl restart ${SERVICE%.service})"
  if grep -Eq '^pi/(kiosk\.sh|boot\.html|rr-tool\.py)$' <<<"$changed" && systemctl is-enabled --quiet roundremote-kiosk.service 2>/dev/null; then
    echo "update: the kiosk changed — restarting it"
    sudo -n systemctl --no-block restart roundremote-kiosk.service 2>/dev/null || echo "update: restart the kiosk yourself (sudo systemctl restart roundremote-kiosk)"
  fi
fi
echo "RESULT updated=1 from=$from to=$to system=$system"
