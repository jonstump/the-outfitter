# The Outfitter

A Hunt: Showdown loadout builder — pick weapons, equipment, and traits, then save and share your builds.

## Stack

- **Client**: React 18, Redux Toolkit, Vite
- **Server**: Express, [lowdb](https://github.com/typicode/lowdb) (JSON file storage)
- npm workspaces monorepo (`client/`, `server/`)

## Requirements

- Node.js 20 — `.nvmrc` pins it as `lts/iron`, the LTS codename for the 20 line

  `nvm use` (or `mise`) reads `.nvmrc` and selects the right version. Installs
  are enforced, not merely documented: `engines.node` plus `engine-strict=true`
  make `npm install` fail on any other major rather than warn.

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
| `npm run test:scrape` | Run only the scrape-script tests (images and hunters) |

## Data scrapes

Catalog images and the hunter roster are sourced from [huntshowdown.wiki.gg](https://huntshowdown.wiki.gg)
by offline scripts and committed to the repository. They are **never** run by `dev`, `build`,
`start`, or CI — the app itself issues no requests to the wiki (ADR-0002, ADR-0007). Run them by
hand only when refreshing the data:

```
node scripts/scrape-images.mjs            # catalog item art
node scripts/scrape-hunters.mjs           # hunter roster + portraits
node scripts/scrape-hunters.mjs --names-only   # roster only; no sharp required
node scripts/scrape-stats.mjs             # catalog item stats
```

All three respect `robots.txt` (aborting if it can't be read), rate-limit every request, and report
a structured per-run summary. `scrape-hunters.mjs` writes `data/hunters.json` (a repo-root artifact:
the client bundles it and the server reads it to validate favorited hunter ids) plus one
trimmed AVIF portrait per hunter under `client/public/images/hunters/`, enforcing a per-asset and a
total byte budget — an over-budget asset fails its hunter rather than being written. Useful flags:
`--force` (re-encode existing art), `--limit=N`, `--dry-run`, `--delay-ms=N`.

`scrape-stats.mjs` writes `client/src/data/itemStats.json` — one record per catalog item, keyed by
catalog id, carrying the wiki revision it came from. A default run is **additive**: it never edits
`catalog.js`, so it cannot change a number the app does budget math with. A partial run (`--limit`
or `--only`) reports without writing, so it cannot truncate the dataset to whatever it happened to
visit.

`--write-catalog` additionally reconciles `catalog.js`, applying scraped values over hand-authored
ones for cost, size and UP. It prints every intended overwrite before applying any of them, refuses
values outside the ranges the game actually uses, and edits tuples in place so the result is a
reviewable `git diff` against a hand-authored file. It deliberately never touches a weapon's
`ammoClass` (a saved ammo selection is a bare index into that pool), an item's display name (it
feeds the on-disk image path), or `group`, `type` and the `AMMO` table at all.

The same applies to coverage lost to failure rather than to a flag: a run that would drop items the
committed dataset already covers writes nothing and names them, and `--allow-shrink` is how a
genuine removal gets through. That guard covers the catalog too — a run whose parses shrank the
dataset is a run whose surviving parses cannot be trusted against a hand-authored file, so
`--write-catalog` is refused on it and the refusal is printed rather than passed over in silence.

`--discover` crawls the wiki's own category indexes and reports what the catalog does not carry,
**classifying every unmatched page before proposing it**: a page existing does not mean the item
does. It separates the things a single "delta" number runs together — matched, genuinely missing,
live-but-unpurchasable (a Tarot Card's price is the literal word `Scarce`), not-an-item (removed, or
a prototype that never shipped), and pages it could not read well enough to say. It fetches every
unmatched page to classify it, so it makes materially more requests than a stats run — and it
honours `--dry-run`, which reports the indexes it would crawl without fetching any of them.

Generated files are committed and must not be hand-edited; re-running the scrape rewrites them.

## Project structure

```
client/   React + Redux frontend (Vite)
server/   Express API + lowdb storage
data/     Generated, committed datasets shared by both workspaces (hunters.json)
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

### Docker, and the production parity check

```
docker compose up --build
```

**Run this before deploying.** It is the repository's production-topology parity check:
the only command that exercises what production actually does, which the day-to-day
`npm run dev` loop deliberately does not. Use it to verify three things the dev loop
cannot show you — that the API and the built client are served from a **single origin**,
that the server behaves correctly under **`NODE_ENV=production`**, and that saved loadouts
**persist across a container restart** on the mounted volume. Dev runs two processes on two
ports with a Vite proxy in front, so a same-origin or production-only regression is
invisible there and shows up first in deployment (SPEC-0002).

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
single-process model uses.

`CORS_ORIGIN` names **additional, genuinely cross-origin** callers, comma-separated
— set it only for the split deployment above. The origin the server is itself
being served from is always accepted, whatever the host, so a single-process
deploy needs no CORS configuration at all. That is deliberate: a browser sends an
`Origin` header on same-origin requests too (on any method other than GET/HEAD, and
on anything fetched in CORS mode — which includes the `crossorigin` bundle Vite
writes into `index.html`), so a policy that recognised same-origin only by the
*absence* of the header answered 403 to the app's own JavaScript and served a blank
page. `server/src/index.test.js` holds that behaviour in place.


## Attribution

Hunt: Showdown assets © Crytek GmbH, used under Crytek's fan content policy; data via [huntshowdown.wiki.gg](https://huntshowdown.wiki.gg). This project is fan-made and not affiliated with or endorsed by Crytek.

## Architecture docs

This project uses the [SDD plugin](https://github.com/joestump/claude-plugin-sdd) for architecture governance.

- Architecture Decision Records: [`docs/adrs/`](docs/adrs)
- Specifications: [`docs/openspec/specs/`](docs/openspec/specs)
