# syntax=docker/dockerfile:1

# --- Build the client -------------------------------------------------------
FROM node:20-alpine AS client-build
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
FROM node:20-alpine AS runtime
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
