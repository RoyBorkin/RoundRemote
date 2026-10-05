#!/usr/bin/env bash
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
# Update Round Remote from GitHub: git pull (fast-forward only) + npm install (when bridge/package.json changed)
# + restart the bridge. Settings → Device → Updates runs it through the bridge (POST /api/system/update), or run
# it yourself:   bash ~/RoundRemote/pi/update.sh
#   --no-restart   don't restart the bridge (the bridge restarts itself after answering)
#   --force        stash local changes to tracked files first (your bridge/config.json is never touched: it's not tracked)
# The last line is machine-readable: RESULT updated=0|1 from=<sha> to=<sha> system=0|1 [error=…]
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
RESTART=1; FORCE=0
for a in "$@"; do case "$a" in --no-restart) RESTART=0 ;; --force) FORCE=1 ;; esac; done
fail() { echo "update: $1" >&2; echo "RESULT updated=0 error=${1// /_}"; exit 1; }

command -v git >/dev/null || fail "git is not installed"
[ -d .git ] || fail "not a git checkout (install with pi/install.sh to get updates)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  [ "$FORCE" = 1 ] || fail "local changes to tracked files — run with --force to stash them"
  git stash push -m "roundremote-update $(date +%F_%T)" >/dev/null || fail "git stash failed"
  echo "update: stashed local changes (git stash list)"
fi
from="$(git rev-parse --short HEAD)"
git fetch --quiet || fail "can't reach GitHub (git fetch failed)"
upstream="$(git rev-parse --short '@{u}' 2>/dev/null)" || fail "this branch has no upstream"
if [ "$from" = "$upstream" ] || [ "$(git rev-list --count 'HEAD..@{u}')" = 0 ]; then
  echo "update: already up to date ($from)"
  echo "RESULT updated=0 from=$from to=$from system=0"
  exit 0
fi
changed="$(git diff --name-only HEAD '@{u}')"
git merge --ff-only --quiet '@{u}' || fail "can't fast-forward (local commits?)"
to="$(git rev-parse --short HEAD)"
echo "update: $from → $to"
if grep -qx 'bridge/package.json' <<<"$changed" || [ ! -d bridge/node_modules ]; then
  echo "update: npm install"
  (cd bridge && npm install --omit=dev --no-audit --no-fund) || fail "npm install failed"
fi
system=0
if grep -Eq '^pi/(install\.sh|roundremote-helper\.sh|netcheck\.sh|.*\.service|conf/)' <<<"$changed"; then
  system=1
  echo "update: system files changed — run 'bash pi/install.sh' once to apply them"
fi
if [ "$RESTART" = 1 ]; then
  sudo -n systemctl --no-block restart roundremote-bridge.service 2>/dev/null || echo "update: restart the bridge yourself (sudo systemctl restart roundremote-bridge)"
fi
echo "RESULT updated=1 from=$from to=$to system=$system"
