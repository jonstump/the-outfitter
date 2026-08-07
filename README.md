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
| `npm start` | Start the production server (serves the built client when `NODE_ENV=production`) |

## Project structure

```
client/   React + Redux frontend (Vite)
server/   Express API + lowdb storage
docs/     Architecture Decision Records and specs (see below)
```

## API

- `GET /api/loadouts` — list saved loadouts
- `POST /api/loadouts` — create or update a loadout (`{ name, data }`)
- `DELETE /api/loadouts/:id` — delete a loadout

## Attribution

Hunt: Showdown assets © Crytek GmbH, used under Crytek's fan content policy; image data via [huntshowdown.wiki.gg](https://huntshowdown.wiki.gg). This project is fan-made and not affiliated with or endorsed by Crytek.

## Architecture docs

This project uses the [SDD plugin](https://github.com/joestump/claude-plugin-sdd) for architecture governance.

- Architecture Decision Records: [`docs/adrs/`](docs/adrs)
- Specifications: [`docs/openspec/specs/`](docs/openspec/specs)
