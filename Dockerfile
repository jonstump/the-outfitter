# syntax=docker/dockerfile:1

# Governing: ADR-0004, SPEC-0002 REQ "Canonical Node Version Pin".
# .nvmrc is the canonical Node pin for this repo; this ARG mirrors it. A
# Dockerfile cannot read .nvmrc without threading --build-arg through every call
# site (CI, Compose, any deploy target), which spreads the coupling rather than
# removing it — so the duplication is deliberate, declared exactly once here, and
# consumed by both stages.
#
# .nvmrc records the LTS *codename* (`lts/iron`), not a bare major. This ARG must
# hold the numeric major that codename resolves to — Iron is 20 — because it is
# interpolated into a Docker tag, and `node:lts/iron-alpine` is not a valid tag:
# a slash there parses as a registry/repository separator, not part of the tag.
# When bumping, resolve the new codename to its major first (Jod is 22, and so
# on) rather than copying .nvmrc's contents verbatim.
ARG NODE_VERSION=20

# --- Build the client -------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY client client
# The generated hunter roster lives at the repo root, not inside the client workspace —
# both this build and the server import the same file. Without it the vite build fails on a
# missing import from client/src/data/hunters.js.
COPY data data
RUN npm run build -w client

# --- Runtime ---------------------------------------------------------------
# Single image serving both the API and the built client (the app's intended
# deployment model). /app/server/data must be mounted as a persistent volume —
# lowdb keeps all saved loadouts in a single JSON file there, so ephemeral or
# per-replica storage would silently lose user data on redeploy or scale-out
# (issue #16).
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev --workspace server
COPY server server
# Governing: ADR-0007, SPEC-0003 REQ "Favorite Hunters". The runtime needs the roster too:
# server/src/lib/hunterRoster.js reads data/hunters.json to validate a favorited hunter id,
# and refuses to boot without it. This COPY is the whole reason the file was moved out of
# client/src — a multi-stage build discards the build stage's filesystem, so anything under
# client/src is simply absent here (PR #133 review).
COPY data data
COPY --from=client-build /app/client/dist client/dist
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p server/data && chown -R app:app /app
USER app
VOLUME ["/app/server/data"]
ENV PORT=4100
EXPOSE 4100
CMD ["npm", "run", "start", "-w", "server"]
