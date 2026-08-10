# syntax=docker/dockerfile:1

# Governing: ADR-0004, SPEC-0002 REQ "Canonical Node Version Pin".
# .nvmrc is the canonical Node pin for this repo; this ARG mirrors it. A
# Dockerfile cannot read .nvmrc without threading --build-arg through every call
# site (CI, Compose, any deploy target), which spreads the coupling rather than
# removing it — so the duplication is deliberate, declared exactly once here, and
# consumed by both stages. Keep it in step with .nvmrc when bumping the major.
ARG NODE_VERSION=20

# --- Build the client -------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY client client
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
COPY --from=client-build /app/client/dist client/dist
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p server/data && chown -R app:app /app
USER app
VOLUME ["/app/server/data"]
ENV PORT=4100
EXPOSE 4100
CMD ["npm", "run", "start", "-w", "server"]
