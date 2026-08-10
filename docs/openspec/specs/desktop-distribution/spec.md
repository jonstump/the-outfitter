---
status: approved
date: 2026-08-10
implements: [ADR-0008]
---

# SPEC-0005: Desktop Distribution

## Overview

This capability adds a second distribution target: an installable desktop application for Windows, macOS, and Linux, built from the same two workspaces that already serve the self-hosted target. It realizes [ADR-0008](../../../adrs/ADR-0008-desktop-app-packaging.md), which chose an Electron shell hosting the existing Express server on loopback over Tauri (sidecar or Rust rewrite), an installable PWA, and the self-hosting-only status quo.

The decision rests on the desktop backend *being* `server/src/`, not resembling it. ADR-0006 and ADR-0007 govern that code, SPEC-0003's ownership requirements are enforced in it, and 63 server tests cover it. Every requirement below exists either to preserve that property or to close the one gap the packaging choice opens.

**Self-hosting is not superseded.** `npm start`, `Dockerfile`, `docker-compose.yml`, and `Procfile` remain first-class and are covered by their existing CI guards. A desktop change that regresses any of them fails this spec.

**The load-bearing requirement is "Authenticated Loopback Boundary."** In the hosted model the operator controls the network boundary; on a desktop machine there is none. An in-process HTTP listener is reachable by every other local process and by any web page that scripts `fetch` at `127.0.0.1`. Electron IPC would avoid this by construction — ADR-0008 accepted the HTTP path for its code-sharing property *on the condition that this requirement is met*. Shipping the desktop app without it is worse than not shipping it.

**Implementation status.** Nothing in this capability is implemented. No `desktop/` workspace exists; `server/src/index.js` still calls `app.listen()` at module scope.

## Requirements

### Requirement: Authenticated Loopback Boundary

The desktop host SHALL bind the API to the loopback interface only, and SHALL authenticate every API request against a secret established at launch.

The listener SHALL bind `127.0.0.1` explicitly. It MUST NOT bind `0.0.0.0`, the unspecified address, or any routable interface address. It SHALL request an ephemeral port from the operating system rather than a fixed one, so the port is neither predictable across launches nor collidable with a self-hosted instance on the same machine.

The Electron main process SHALL generate a cryptographically random secret of at least 128 bits on each launch, hold it in memory only, and inject it into the renderer. The secret MUST NOT be written to disk, logged, embedded in the packaged application, or derived from anything stable across launches (install path, machine id, user name, or port).

Every request to a path under `/api` SHALL be rejected with `403` unless it presents the current launch's secret. Rejection SHALL occur in middleware registered **before** any router, so no request lacking the secret reaches ownership resolution, the lowdb store, or any handler.

This requirement MUST NOT be satisfied by CORS configuration. The server admits requests carrying no `Origin` header by design — correct for `curl` against an operator's instance, and not a boundary on a machine where any local process can issue a request with no `Origin` at all.

`/healthz` MAY remain unauthenticated; it discloses no user data and orchestrator liveness has no meaning on the desktop, so it SHALL either stay open or be omitted from the desktop host, never authenticated with a weaker check.

#### Scenario: A request without the secret is refused

- **WHEN** a request is issued to any `/api` path on the desktop app's loopback port without the launch secret
- **THEN** the response SHALL be `403`, and no lowdb read or write SHALL occur

#### Scenario: A stale secret from a previous launch is refused

- **WHEN** the app is relaunched and a request presents the secret from the previous launch
- **THEN** the response SHALL be `403`

#### Scenario: The listener is not reachable off-host

- **WHEN** the desktop app is running and a connection is attempted to the app's port on a non-loopback address of the same machine
- **THEN** the connection SHALL be refused

#### Scenario: The port is not fixed across launches

- **WHEN** the app is launched twice
- **THEN** the port SHALL be requested from the OS as ephemeral, so the binding is not a predictable constant

#### Scenario: The secret is absent from the shipped artifact

- **WHEN** the packaged application's files are searched
- **THEN** no launch secret or seed for deriving one SHALL be present

#### Scenario: The renderer's own requests succeed

- **WHEN** the app's renderer issues its normal `/api` requests
- **THEN** they SHALL carry the launch secret and be served, with ownership scoping applied exactly as in the hosted target

### Requirement: One Server Implementation, Shared by Both Targets

`server/src/` SHALL be the sole implementation of routing, ownership, and persistence for both the hosted and desktop targets.

`server/src/index.js` SHALL export the configured Express `app`. The `app.listen()` call SHALL be guarded so that importing the module does not bind a port. Both `npm start` and the desktop host SHALL obtain the server through that one export.

The desktop workspace SHALL contain host concerns only — window lifecycle, the loopback bind, secret generation and injection, data-directory resolution, and packaging. It MUST NOT contain route handlers, ownership logic, lowdb access, or a second copy of any rule SPEC-0003 governs.

Refactoring `index.js` MUST NOT change the hosted target's observable behavior: same single-origin serving, same static serve of `client/dist` under `NODE_ENV=production`, same SPA fallback, same `/healthz`.

#### Scenario: Importing the server does not bind a port

- **WHEN** `server/src/index.js` is imported by a test or by the desktop host
- **THEN** the configured `app` SHALL be available and no port SHALL be bound as a side effect

#### Scenario: The desktop workspace holds no application logic

- **WHEN** the desktop workspace is inspected
- **THEN** it SHALL contain no route handler, no ownership resolution, and no lowdb access — the loopback secret plumbing is the only request-path code it may contain

#### Scenario: The hosted target is unaffected by the refactor

- **WHEN** `npm start` runs after the refactor
- **THEN** the server SHALL listen on `PORT`, serve `client/dist`, answer `/healthz`, and pass the existing server suite unchanged

#### Scenario: Ownership rules are enforced identically on both targets

- **WHEN** the ownership assertions in the server suite run against the app as obtained by the desktop host
- **THEN** they SHALL pass without modification, because it is the same app object

### Requirement: Per-User Data Directory

The desktop host SHALL store its lowdb file in the operating system's per-user application data directory for this application, resolved via Electron's `userData` path.

It SHALL do so by setting `OUTFITTER_DB_FILE` before importing the server. `server/src/db.js` MUST NOT gain a desktop-specific branch; its existing `OUTFITTER_DB_FILE`-first resolution is the seam.

The desktop host SHALL ensure the directory exists before the server reads it. A first launch with no data file SHALL start from the store's default empty collections, exactly as a fresh hosted instance does, and MUST NOT surface an error.

The desktop app MUST NOT read or write `server/data/db.json` inside the installed application bundle — that location is read-only on macOS and shared between users elsewhere.

#### Scenario: Data lands in the per-user directory

- **WHEN** a loadout is saved in the desktop app
- **THEN** it SHALL be written to the lowdb file under the OS per-user application data directory, and no file inside the application bundle SHALL be modified

#### Scenario: First launch with no existing data

- **WHEN** the app launches on a machine with no prior data file
- **THEN** it SHALL start with empty `loadouts`, `loadoutLists`, and `hunterFavorites`, and present no error

#### Scenario: `db.js` keeps one resolution path

- **WHEN** `server/src/db.js` is inspected
- **THEN** it SHALL resolve `OUTFITTER_DB_FILE` ahead of its default with no desktop-specific branch

#### Scenario: Two OS users do not share data

- **WHEN** two different OS user accounts run the installed app on one machine
- **THEN** each SHALL read and write its own data file

### Requirement: Runtime Version Parity with the Canonical Pin

The Node major version bundled in the Electron runtime SHALL match the major declared in `.nvmrc`.

SPEC-0002 designates `.nvmrc` as the single canonical Node pin. Electron's bundled Node is selected by the Electron version rather than by `.nvmrc`, so parity SHALL be asserted mechanically rather than maintained by convention. CI SHALL fail the release job when the two diverge, with a message naming both versions.

The check SHALL derive both values at build time. It MUST NOT compare against a hardcoded literal, which would reintroduce the multi-declaration drift ADR-0004 eliminated.

#### Scenario: A diverging Electron major fails the release

- **WHEN** the Electron dependency is upgraded to a version whose bundled Node major differs from `.nvmrc`
- **THEN** the release job SHALL fail with a message naming the Electron-bundled major and the `.nvmrc` major

#### Scenario: The check reads the canonical pin

- **WHEN** the parity check is inspected
- **THEN** it SHALL read the version from `.nvmrc` rather than from a literal in the check itself

### Requirement: Reproducible Three-Platform Release Artifacts

Release artifacts SHALL be produced by CI from a tagged commit, on a matrix covering Windows, macOS, and Linux.

The pipeline SHALL produce an NSIS installer for Windows, a DMG for macOS, and AppImage and deb packages for Linux. Every artifact SHALL be built from `client/dist` as produced by the existing `npm run build -w client`; the desktop target MUST NOT introduce a desktop-specific client build configuration, preserving ADR-0003's plain-static-output contract.

The full test suite SHALL pass before any packaging job runs.

macOS artifacts SHALL be signed with a Developer ID and notarized. Windows artifacts SHALL be Authenticode signed. Unsigned artifacts for these two platforms MUST NOT be published to users — Gatekeeper blocks them outright and SmartScreen flags them, so an unsigned release is a worse user experience than no release. A pre-signing development build MAY be produced locally or as an unpublished CI artifact, provided it is not offered as a download.

Signing credentials SHALL be held as CI secrets. They MUST NOT be committed, and a build without them SHALL fail the release rather than silently emitting unsigned artifacts.

#### Scenario: A tagged release produces all three platforms

- **WHEN** a release tag is pushed and the test job passes
- **THEN** CI SHALL produce Windows NSIS, macOS DMG, and Linux AppImage and deb artifacts

#### Scenario: Failing tests block packaging

- **WHEN** the test job fails on a release tag
- **THEN** no packaging job SHALL run and no artifact SHALL be published

#### Scenario: Missing signing credentials fail loudly

- **WHEN** a release build runs without the signing credentials available
- **THEN** the job SHALL fail, and it MUST NOT publish an unsigned artifact in their place

#### Scenario: The client build is not forked

- **WHEN** the desktop packaging pipeline is inspected
- **THEN** it SHALL consume the output of the existing client build, and `client/vite.config.js` SHALL carry no desktop-specific branch

### Requirement: Self-Hosting Remains a Supported Target

Adding the desktop target MUST NOT regress the self-hosted one.

`npm start`, `Dockerfile`, `docker-compose.yml`, and `Procfile` SHALL continue to work as documented in the README. The existing CI container smoke job — which builds the image, boots it, and drives a real favorite through it — SHALL continue to run on every pull request and SHALL stay green.

Documentation SHALL present the two as alternatives, stating which each suits: the desktop app for a single player on one machine, self-hosting for a shared instance. The README's existing warnings about lowdb's single-writer constraint, one instance, and a persistent volume SHALL remain, since they still govern the hosted path.

#### Scenario: The container smoke job still passes

- **WHEN** CI runs on a pull request adding or changing desktop packaging
- **THEN** the container smoke job SHALL build, boot, and exercise a write against the image successfully

#### Scenario: Both install paths are documented

- **WHEN** the README is read after this capability ships
- **THEN** it SHALL describe both the desktop install and the self-hosted deployment, and state which situation each suits

## Security Requirements

The desktop target inherits SPEC-0003's ownership and body-size requirements unchanged, because it runs the same server. It adds one boundary of its own.

**The loopback listener is a trust boundary and SHALL be treated as one.** "It only listens on localhost" is not access control: local processes reach it directly, and a browser page can issue requests to `127.0.0.1` on the user's behalf. The Authenticated Loopback Boundary requirement above is what makes it a boundary, and its rejection middleware SHALL be registered before any router so that an authentication failure cannot be reached by a handler.

**The renderer SHALL NOT be granted powers it does not need.** Node integration SHALL be disabled in the renderer and context isolation SHALL be enabled. The launch secret SHALL reach the renderer through a preload script's narrow bridge rather than by enabling Node integration to fetch it.

**Navigation SHALL be confined to the app's own origin.** The desktop host SHALL block in-window navigation to any origin other than its loopback origin, and SHALL route external links to the user's default browser rather than opening them in an application window.

#### Scenario: The renderer runs without Node integration

- **WHEN** the desktop host's window configuration is inspected
- **THEN** Node integration SHALL be disabled and context isolation enabled

#### Scenario: External navigation leaves the app window

- **WHEN** a link to an external origin is activated in the app
- **THEN** it SHALL open in the user's default browser, and the application window SHALL remain on its loopback origin

#### Scenario: Authentication precedes routing

- **WHEN** the desktop host's middleware order is inspected
- **THEN** the secret check SHALL be registered before every `/api` router
