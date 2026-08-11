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

The stored payload is an **allowlist** of the keys the wire format defines — a
body carrying anything else is refused rather than persisted alongside the
loadout. One token may hold at most 200 saved loadouts; a 201st create returns
`409` while re-saving an existing name still updates it. The collection reads
carry their own, much looser per-IP limiter: a read mutates nothing, but it
re-parses the whole `db.json`, so the rate of that parse is worth bounding
whatever the store has grown to.

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

### Reverse proxies and `TRUST_PROXY`

Set `TRUST_PROXY` **only when a reverse proxy is actually in front of the
process**, and leave it unset otherwise. It decides which peers the server
believes `X-Forwarded-*` from, which in turn decides `req.protocol`, the
X-Forwarded-Host lookup behind the same-origin check, and `req.ip` — the key
both rate limiters use. On a directly-exposed deploy, believing the header lets
any client put itself in a fresh rate-limit bucket on every request simply by
varying it.

| Topology | Setting |
|---|---|
| `docker compose up`, or the `Procfile` VM with nothing in front | unset (the default) |
| A proxy on the same host (nginx, Caddy) | `TRUST_PROXY=loopback` |
| A proxy elsewhere on your network | `TRUST_PROXY=10.0.0.0/8` — its address or CIDR |
| A managed platform that always terminates for you (Render, Fly) | `TRUST_PROXY=1` |

Prefer naming the proxy over a hop count where you can: an address, CIDR or
named range (`loopback`, `uniquelocal`) compiles to a check on the peer that
connected, so a direct client is refused whatever it claims. A bare number is a
hop count, which Express applies without looking at who connected — correct
behind a platform that always terminates in front of you, meaningless if the
process is also reachable directly. An unparseable value stops the server at
boot rather than downgrading to trusting everything or nothing — including
`TRUST_PROXY=true`, which is refused on purpose: Express's boolean `true` trusts
every peer at every hop, so the one input that looks like "yes, I have a proxy"
is the one that would trust clients that aren't one. Name the proxy instead.

> **Set this before you deploy behind a TLS-terminating proxy, not after.**
> Unset, Express ignores `X-Forwarded-Proto`, so `req.protocol` is `http` while
> the browser sends `Origin: https://your-site`. The same-origin check compares
> the two, they don't match, and the API answers **403 to every write** —
> `POST`, `PATCH`, `DELETE` — from its own client. Reads keep working, because
> same-origin `GET`s carry no `Origin` header, so this presents as "the app
> loads fine but nothing saves" rather than as an outage. This setting lives in
> the platform's own environment config, not in this repo, so nothing in CI can
> catch it being missing. On Render, Fly or anything else that terminates TLS in
> front of you, add `TRUST_PROXY=1` to the service environment **first**, then
> ship.
>
> **This has happened.** The first deploy after the setting was introduced went
> out without it, and behaved exactly as described above — the app loaded, and
> nothing saved. The paragraph above is a post-mortem, not a precaution.

### Checking a deployment

The trust boundary is the one setting no test can confirm, because the value
lives in the platform rather than the repository. Check it against a running
instance instead — a write that reaches validation proves the origin comparison
succeeded, which proves the forwarded protocol was believed:

```
curl -si https://<host>/api/loadouts -X POST \
  -H 'Origin: https://<host>' -H 'Content-Type: application/json' \
  -d '{}' | head -1
```

| Response | Meaning |
|---|---|
| `400` | Correct. The request reached validation and the empty body was refused on the merits |
| `403` | `TRUST_PROXY` is missing or wrong. Check the body is `{"error":"origin not allowed"}` to confirm it is this server's rejection and not the platform's |
| `429` | Neither — the write limiters mount ahead of validation, so the check answers this before it can tell you anything. Wait out the one-minute window and retry |

The `429` is likeliest against exactly the deployment you are checking: with
`TRUST_PROXY` wrong, `req.ip` resolves to the proxy for everyone, so the per-IP
budget is one bucket shared by all traffic rather than a per-caller floor.

**Do not fix a 403 here by adding the app's own origin to `CORS_ORIGIN`.** It
works, and it is the wrong repair: writes start succeeding while `req.ip` stays
resolved to the proxy's address, so both rate limiters remain collapsed into one
bucket shared by every user. That masks the defect this variable exists to fix.

### Render

`render.yaml` in the repository root is a Blueprint carrying these settings —
`TRUST_PROXY`, the single-instance constraint, and the persistent disk — so they
arrive through review rather than living only in a dashboard. It is a source of
truth, not an enforcement mechanism: Render remains the authority on what is
actually running, and the two can still drift.

Applying it to a service that already exists needs care. Three fields must match
the running service before you apply, and the disk is the one that loses data if
it does not: Render identifies a disk by name, so a blueprint naming a different
one requests a **new, empty** disk, and the app comes up with an empty
`db.json`. The file comments each of the three at the line that carries it.

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
