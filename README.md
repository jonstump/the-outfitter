# The Outfitter

A Hunt: Showdown loadout builder — pick weapons, equipment, and traits, then save and share your builds.

## Stack

- **Client**: React 18, Redux Toolkit, Vite
- **Server**: Express, [lowdb](https://github.com/typicode/lowdb) (JSON file storage)
- npm workspaces monorepo (`client/`, `server/`)

## Requirements

- Node.js 20 (see `.nvmrc`)

## Getting started

Install dependencies from the repo root:

```bash
npm install
```

Run the client and server together in dev mode:

```bash
npm run dev
```

- Client: http://localhost:5173 (Vite dev server, proxies `/api` to the server)
- Server: http://localhost:4100

## Scripts

Run from the repo root:

| Command | Description |
|---|---|
| `npm run dev` | Run client and server concurrently in watch mode |
| `npm run build` | Build the client for production |
| `npm start` | Start the production server (sets `NODE_ENV=production` itself; serves the built client) |
| `npm test` | Run every suite — client, server, and the scrape scripts. This is what CI runs |
| `npm run test:scrape-images` | Run only the scrape-script tests |

## Project structure

```
client/   React + Redux frontend (Vite)
server/   Express API + lowdb storage
docs/     Architecture Decision Records and specs (see below)
```

## API

- `GET /api/loadouts` — list your saved loadouts
- `POST /api/loadouts` — create or update a loadout (`{ name, data }`)
- `DELETE /api/loadouts/:id` — delete a loadout

Loadouts are scoped per browser via a client-generated `x-loadout-token` header
that the client sends with every request, so different browsers never see or
overwrite each other's saves. The write/delete endpoints are rate-limited per
client (with a per-IP floor) and the server validates the loadout payload shape
and name before persisting.

## Deployment

The app is designed to run as a **single process serving both the API and the
built client from one origin** — the client's default API base is the relative
`/api` path, so client and server must be deployed together. `npm start` serves
the production client build from `client/dist`.

The runtime keeps all saved loadouts in `server/data/db.json` via lowdb, which
is a **single-process, single-writer** store. Deployment therefore requires:

- **One instance.** Two replicas behind a load balancer would each get their
  own independent `db.json` and silently diverge.
- **A persistent volume** mounted at `server/data` (or a VM disk). On most
  PaaS/container platforms the local filesystem is ephemeral and wiped on every
  redeploy — without a volume, saved loadouts disappear with each release.

### Docker

```
docker compose up --build
```

`docker-compose.yml` builds the client, runs the server with
`NODE_ENV=production`, and mounts a named volume at `/app/server/data` (the
`VOLUME` is also declared in the `Dockerfile`). A bare `Dockerfile` is included
for other container runtimes; mount a persistent volume at `/app/server/data`.

### PaaS / single VM

The `Procfile` documents the process command for platforms that use them
(`web: npm run start -w server`), but lowdb's single-writer constraint applies
just the same — run one instance, keep `server/data` on durable disk, and set
`PORT` and `NODE_ENV` yourself. The production server exposes `GET /healthz`
for orchestrator liveness checks.

### Separate origins (optional)

To serve the client from a CDN/static host and the API elsewhere, build the
client with a base URL override:

```
VITE_API_URL=https://api.example.com npm run build -w client
```

The same-origin relative path remains the default and is what the
single-process model uses. Note that CORS is restricted to the dev origins by
default (`http://localhost:5173`); for cross-origin production requests, set
the server's `CORS_ORIGIN` env var to the client's origin (comma-separated
for multiple).


## Attribution

Hunt: Showdown assets © Crytek GmbH, used under Crytek's fan content policy; image data via [huntshowdown.wiki.gg](https://huntshowdown.wiki.gg). This project is fan-made and not affiliated with or endorsed by Crytek.

## Architecture docs

This project uses the [SDD plugin](https://github.com/joestump/claude-plugin-sdd) for architecture governance.

- Architecture Decision Records: [`docs/adrs/`](docs/adrs)
- Specifications: [`docs/openspec/specs/`](docs/openspec/specs)
