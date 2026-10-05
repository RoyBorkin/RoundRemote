# © 2026 Roy Borkin. All rights reserved. See LICENSE.
# Round Remote as a server: the bridge (all adapters, phone pages, APIs) + the app itself, state in the /data volume.
# Run it with network_mode: host (see docker-compose.yml and README → "Run it on a server (Docker)").
#
#   docker build -t roundremote .                                  # amd64 / arm64 (arm/v7 works too)
#   docker build --build-arg WITH_PYATV=1 -t roundremote .         # + Python and pyatv for Apple TV
#   docker build --build-arg WITH_AVAHI=1 -t roundremote .         # + avahi-browse (needs the host's /var/run/dbus)
#   docker build --build-arg WITH_ROON=0 -t roundremote .          # without the Roon extension packages
#
# Node.js: 24 is the Active LTS line (security fixes until April 2028); Debian 13 "trixie" is the current stable.
ARG NODE_VERSION=24
ARG DEBIAN=trixie
ARG WITH_PYATV=0

# ------------------------------------------------------------------ base
FROM node:${NODE_VERSION}-${DEBIAN}-slim AS base
ENV NODE_ENV=production

# ------------------------------------------------------------------ deps: production node_modules only
FROM base AS deps
ARG WITH_ROON=1
# git: the Roon packages come straight from RoonLabs' GitHub repositories (they are not on npm)
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY bridge/package.json ./
RUN ROON=""; \
    if [ "$WITH_ROON" = "1" ]; then ROON="github:roonlabs/node-roon-api github:roonlabs/node-roon-api-status github:roonlabs/node-roon-api-transport github:roonlabs/node-roon-api-image github:roonlabs/node-roon-api-browse"; fi; \
    npm install --omit=dev --no-save --no-package-lock --no-audit --no-fund $ROON \
 && npm cache clean --force \
 && node -e "require('castv2-client'); require('multicast-dns'); console.log('deps ok')"

# ------------------------------------------------------------------ pyatv (Apple TV) — only built with WITH_PYATV=1
FROM base AS pyatv-0
RUN mkdir -p /opt/pyatv

FROM base AS pyatv-1
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-dev build-essential \
 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/pyatv \
 && /opt/pyatv/bin/pip install --no-cache-dir --prefer-binary pyatv \
 && /opt/pyatv/bin/atvscript --version

FROM pyatv-${WITH_PYATV} AS pyatv

# ------------------------------------------------------------------ the image
FROM base
ARG WITH_PYATV=0
ARG WITH_AVAHI=0
# tini = a proper PID 1 (signals, zombies); setpriv (util-linux, already in the base) drops root → PUID:PGID
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
      $( [ "$WITH_PYATV" = "1" ] && echo python3 ) \
      $( [ "$WITH_AVAHI" = "1" ] && echo avahi-utils ) \
 && rm -rf /var/lib/apt/lists/* \
 && command -v setpriv >/dev/null

COPY --from=pyatv /opt/pyatv /opt/pyatv
RUN if [ -x /opt/pyatv/bin/atvscript ]; then ln -s /opt/pyatv/bin/atvscript /opt/pyatv/bin/atvremote /usr/local/bin/; fi

WORKDIR /app
COPY --chown=root:root . /app
COPY --from=deps --chown=root:root /build/node_modules /app/bridge/node_modules
RUN chmod 0755 /app/docker/entrypoint.sh \
 && node --check /app/bridge/server.js

# PUID/PGID: the owner of the files in /data (TOS: your admin user, often 1000:100 or 1001:100 — `id` over SSH shows it)
ENV RR_DATA_DIR=/data \
    RR_ROLE=server \
    RR_CONTAINER=1 \
    PORT=8765 \
    TZ=UTC \
    PUID=1000 \
    PGID=1000 \
    HOME=/data/home
VOLUME /data
EXPOSE 8765/tcp

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8765)+'/api/info',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

LABEL org.opencontainers.image.title="Round Remote" \
      org.opencontainers.image.description="Round Remote bridge + app server (adapters, phone pages, data) for round displays and browsers" \
      org.opencontainers.image.source="https://github.com/RoyBorkin/RoundSpotify" \
      org.opencontainers.image.licenses="LicenseRef-RoundRemote"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["node", "/app/bridge/server.js"]
