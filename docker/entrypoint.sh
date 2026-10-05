#!/bin/sh
# © 2026 Roy Borkin. All rights reserved. See LICENSE.
# Container start: make the data folder belong to PUID:PGID, then run the bridge as that user (never as root).
# When the container is already started as a non-root user (compose `user:`), it just runs the command.
set -eu

DATA="${RR_DATA_DIR:-/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

case "$PUID$PGID" in *[!0-9]*) echo "entrypoint: PUID and PGID must be numbers (got '$PUID' / '$PGID')" >&2; exit 64 ;; esac

if [ "$(id -u)" = "0" ]; then
  if [ "$PUID" = "0" ]; then
    echo "entrypoint: PUID=0 — running as root is not supported; using 1000" >&2
    PUID=1000
  fi
  mkdir -p "$DATA" "${HOME:-$DATA/home}"
  # hand over only what isn't owned yet (fast on every start; NAS shares keep their own ACLs on the folder itself)
  find "$DATA" -xdev \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} + 2>/dev/null \
    || echo "entrypoint: couldn't change the owner of some files in $DATA (a NAS share with ACLs?) — the bridge reports it if it can't write" >&2
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups --inh-caps=-all -- "$@"
fi

mkdir -p "$DATA" "${HOME:-$DATA/home}" 2>/dev/null || true
exec "$@"
