---
status: proposed
date: 2026-08-09
decision-makers: [jmstump]
---

# ADR-0003: Client Build Tool and Dev Server

## Context and Problem Statement

The Outfitter's client (`client/`) is a React 18 + Redux Toolkit single-page app, developed and shipped inside an npm-workspaces monorepo alongside an Express + lowdb API server (`server/`). The client currently uses Vite for both its dev server and production build (`npm run dev` serves it at `http://localhost:5173`, proxying `/api` to the Express server at `4100`; `npm run build` produces static assets the production server serves when `NODE_ENV=production`).

Vite was carried over from the original standalone "Loadout Builder" prototype this app was ported from, and no ADR has ever recorded why it's the right tool versus the other mainstream React tooling options. This ADR exists to make that choice explicit and reviewable rather than implicit. It is being opened as `proposed` and deliberately left unresolved — the Decision Outcome is not yet finalized — pending review of the alternatives below.

## Decision Drivers

* This is a client-only SPA (no server-side rendering or React Server Components need) — the app is a single interactive builder screen plus a share-link view, not a multi-route content site
* Fast dev-loop feedback (HMR) matters — the builder's UX is dominated by interactive state changes (picking equipment, live capacity math, randomize/budget algorithm) that benefit from instant reload
* Must coexist cleanly in an npm-workspaces monorepo with a separate Express server workspace, without pulling the server into the same framework/runtime assumptions
* Low ongoing config/maintenance burden — this is a small fan-made project maintained without dedicated frontend tooling ownership
* Long-term maintenance risk of the tool itself: Create React App is deprecated (no longer actively maintained by Meta), which is a direct risk to any project still depending on it
* Production build should emit static assets simple enough for the existing Express server to serve as-is (`npm start` serving the built client when `NODE_ENV=production`), without needing a Node SSR runtime in production

## Considered Options

* Vite (current)
* Create React App (CRA)
* Next.js
* Webpack with a hand-rolled/custom config
* Parcel

## Decision Outcome

Not yet decided — this ADR is `proposed`, not `accepted`. Vite is the incumbent (already in production use, inherited from the original prototype), but it has not been formally re-affirmed against the alternatives below. See "Pros and Cons of the Options" for the tradeoffs to weigh before this is closed out.

## Pros and Cons of the Options

### Vite (current)

Native-ESM dev server with on-demand module transforms for instant HMR; uses Rollup under the hood for production builds.

* Good, because dev server startup and HMR are near-instant regardless of app size, since nothing is bundled up front in dev
* Good, because it's the de facto default for new React SPAs today — CRA's deprecation pushed most of the ecosystem (tutorials, templates, tooling) toward Vite
* Good, because config is minimal (`vite.config.js`) — proxying `/api` to the Express server in dev is a few lines, no webpack loader chain to assemble
* Good, because it outputs a plain static `dist/` bundle, which is exactly what the Express server needs to serve in production — no framework-specific server runtime required
* Neutral, because it's still a comparatively young tool (relative to Webpack) — actively maintained and widely adopted, but with a shorter track record
* Bad, because dev-mode native-ESM behavior can occasionally diverge from the production Rollup bundle in edge cases (rare, but a real class of "works in dev, breaks in build" bugs specific to Vite's architecture)

### Create React App (CRA)

The former standard React scaffolding tool, built on Webpack with zero exposed config unless ejected.

* Good, because it was, for years, the most battle-tested and widely documented React starting point
* Good, because "zero config" means less to get wrong for a small team
* Bad, because CRA is deprecated — it's no longer actively maintained by Meta/the React team, which is a direct project-risk red flag for any new or ongoing dependency
* Bad, because its Webpack-based dev server is materially slower to start and hot-reload than Vite's native-ESM approach, especially as the app grows
* Bad, because ejecting (the only way to customize deeply) is a one-way door that dumps the full Webpack config into the repo to maintain by hand

### Next.js

A full React framework with file-based routing, SSR/SSG, API routes, and its own bundler (Turbopack/Webpack).

* Good, because it's the most feature-complete option — routing, data fetching patterns, and API routes are all built in
* Good, because it has the largest ecosystem and most corporate backing/momentum of any option here
* Bad, because this app doesn't need SSR, SSG, or file-based routing — it's a single builder screen and a share-link view; adopting Next.js would mean paying its architectural complexity for capabilities the app doesn't use
* Bad, because Next.js expects to own the server too (or run in a Node/edge runtime) — this app already has a separate, deliberate Express + lowdb server, and reconciling "two servers" (Next's and Express's) adds real architectural friction that doesn't exist today
* Bad, because it's the heaviest option to learn/operate for a small fan project with one deployment target

### Webpack with a hand-rolled config

Assemble a custom Webpack config directly (dev server, loaders, plugins) instead of using a scaffold.

* Good, because it offers full control over every part of the build pipeline
* Good, because it's the most mature, longest-track-record bundler of the options considered
* Bad, because "full control" means the project now owns loader/plugin version compatibility, dev-server proxy setup, and HMR wiring by hand — real ongoing maintenance cost for a project with no dedicated frontend build engineer
* Bad, because dev-server rebuild/HMR speed is slower than Vite's native-ESM approach by default, and matching Vite's speed would require additional tuning (e.g., persistent caching, module federation tricks) this project doesn't need to be doing itself

### Parcel

A bundler marketed as zero-config, with automatic dependency installation and multi-target output.

* Good, because it requires close to no configuration to get a React app running
* Good, because it handles a broad range of asset types (SVG, CSS, etc.) out of the box, which this app already leans on for its SVG icon system
* Neutral, because its dev-server performance is broadly comparable to Vite's for small-to-medium apps, though Vite has more mindshare in the current React ecosystem
* Bad, because it has a smaller community and ecosystem than Vite for React-specific patterns (e.g., current official React docs and most modern React tooling guides point to Vite, not Parcel)
* Bad, because fewer contributors/maintainers means slower turnaround on bugs or compatibility issues versus Vite's larger maintainer base

## More Information

This ADR intentionally stops short of a final decision. Vite is already running in production and nothing in this document should be read as a signal to migrate away from it preemptively — it's flagged here so the tradeoffs are visible and the choice can be consciously re-affirmed (or changed) via `/sdd:status` once reviewed, rather than left as an unexamined default.
