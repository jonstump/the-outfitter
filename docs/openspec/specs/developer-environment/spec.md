---
status: approved
date: 2026-08-09
implements: [ADR-0004]
---

# SPEC-0002: Developer Environment Consistency

## Overview

This capability formalizes how Backwater Outfitters' developer environment is pinned, enforced, and documented. It realizes [ADR-0004](../../../adrs/ADR-0004-developer-environment-consistency.md), which chose host-side pinning — a version manager, `engines` enforcement, a single install command, and a lockfile-integrity check — over containerized development, on the grounds that this app has no database, cache, or native dependency and that a Docker Compose dev profile would not deliver the dev/prod topology parity that appears to justify it.

The gap this capability closes is concrete. Node 20 was pinned in four places (`.nvmrc`, `.github/workflows/ci.yml`, and twice in `Dockerfile`) with no mechanism keeping them in sync, and nothing read any of them automatically — the machine ADR-0004 was authored on resolves `node` to v24.13.1. The README instructs `npm install` while CI and the production image run `npm ci`, permitting lockfile drift that surfaces only as a CI failure on an unrelated pull request. No `.env.example` existed, so the four environment variables the app reads were discoverable only by grepping source.

**Implementation status.** Nearly all of this capability is in place. `mise.toml`, `.npmrc`, and `.env.example` exist at the repo root and the root `package.json` declares `engines.node`; `.github/workflows/ci.yml` resolves Node via `node-version-file: .nvmrc` and verifies lockfile integrity on every pull request; the `Dockerfile` declares a single `ARG NODE_VERSION` consumed by both of its stages; `.env.example` documents `OUTFITTER_DB_FILE`; and the root `package.json` has a `test` script running the client, server, and scrape suites, documented in the README's Scripts table. The README's install instruction now matches this (`npm ci`, corrected via `/sdd:audit`). One gap remains:

- **Documented Environment Variables** — `mise.toml` carries no `[env]` section to load the documented variables on activation (#57).

## Requirements

### Requirement: Canonical Node Version Pin

The repository SHALL designate `.nvmrc` as the single canonical source of the supported Node major version. Every other artifact that needs the Node version SHALL derive it from `.nvmrc` rather than hardcoding it, except where a build system cannot read the file, in which case the duplication SHALL be reduced to a single declared variable and MUST carry a comment identifying `.nvmrc` as canonical.

CI SHALL resolve its Node version using `actions/setup-node` with `node-version-file: .nvmrc`. The `Dockerfile` SHALL declare a single `ARG NODE_VERSION` consumed by both of its `FROM node:${NODE_VERSION}-alpine` stages.

#### Scenario: CI derives its Node version from the canonical pin

- **WHEN** CI runs on any push or pull request
- **THEN** the workflow MUST resolve its Node version via `node-version-file: .nvmrc` and MUST NOT contain a hardcoded `node-version` literal

#### Scenario: Changing the pin propagates without further edits

- **WHEN** a maintainer changes the Node major recorded in `.nvmrc`
- **THEN** CI MUST use the new version on the next run with no edit to the workflow file

#### Scenario: Dockerfile version duplication is single-sourced and annotated

- **WHEN** the `Dockerfile` is inspected
- **THEN** it MUST declare the Node version exactly once as an `ARG`, both build stages MUST consume that `ARG`, and a comment MUST identify `.nvmrc` as the canonical pin the `ARG` mirrors

### Requirement: Automatic Toolchain Activation

The repository SHALL provide a machine-readable toolchain declaration that a version manager can act on automatically when a contributor enters the project directory, pinning both the Node major and the npm version. `mise` via a repo-root `mise.toml` is the RECOMMENDED implementation; any version manager that reads the canonical pin and activates without an explicit per-session command satisfies this requirement.

The toolchain declaration MUST remain consistent with `.nvmrc`. Contributors SHALL NOT be required to install the version manager in order to use the repository — see the Task Interface Stability requirement.

#### Scenario: Entering the project directory activates the pinned toolchain

- **WHEN** a contributor with the version manager installed and shell-hooked changes into the repository directory
- **THEN** the shell's resolved `node` and `npm` MUST match the pinned versions without any additional command

#### Scenario: Toolchain declaration agrees with the canonical pin

- **WHEN** the toolchain declaration and `.nvmrc` are compared
- **THEN** the Node major they specify MUST be identical

#### Scenario: The version manager is not a hard prerequisite

- **WHEN** a contributor without the version manager installed clones the repository and already has a satisfying Node version
- **THEN** the documented setup and development commands MUST succeed unchanged

### Requirement: Toolchain Enforcement at Install Time

The root `package.json` SHALL declare an `engines.node` range matching the canonical pin, and the repository SHALL configure npm so that a Node version outside that range causes installation to fail rather than emit a warning. A repo-root `.npmrc` containing `engine-strict=true` is the RECOMMENDED mechanism.

The enforcement mechanism MUST cause a non-zero exit code, and its output MUST name the required version range. If `engine-strict=true` produces spurious failures originating from a dependency's own `engines` field rather than the root package's, the repository SHALL replace it with a `preinstall` script that checks `process.versions.node` against the root range and exits non-zero. Whichever mechanism is in place MUST carry a governing comment identifying it as the enforcement point.

#### Scenario: Installing on an unsupported Node major fails loudly

- **WHEN** a contributor runs the install command on a Node major outside the declared `engines.node` range
- **THEN** the install MUST exit non-zero and the output MUST state the required range

#### Scenario: Installing on a supported Node major succeeds

- **WHEN** a contributor runs the install command on a Node version inside the declared range
- **THEN** the install MUST complete successfully with no engine-related error

#### Scenario: Spurious dependency-originated failures trigger the narrower mechanism

- **WHEN** `engine-strict=true` causes an install to fail because of a dependency's `engines` field rather than the root package's
- **THEN** the repository MUST switch to a `preinstall` guard scoped to the root range, and the enforcement MUST remain a non-zero exit on an unsupported Node major

### Requirement: Single Reproducible Install Command

The repository SHALL use `npm ci` as the documented install command for development, continuous integration, and every image build stage. The README SHALL instruct contributors to run `npm ci` for setup. `npm install` SHALL be documented only as the deliberate act of changing dependencies, not as a setup step.

#### Scenario: Documented setup uses the lockfile-respecting install

- **WHEN** a contributor follows the README's "Getting started" section
- **THEN** the install command they are told to run MUST be `npm ci`

#### Scenario: Development and CI install identically

- **WHEN** the README, the CI workflow, and each `Dockerfile` stage are compared
- **THEN** all MUST use `npm ci` as the install command

### Requirement: Lockfile Integrity Verification

Continuous integration SHALL verify that installing dependencies leaves `package-lock.json` byte-identical to the committed version, and SHALL fail the build when it does not. The check MUST run on every pull request so drift fails on the change that introduced it.

#### Scenario: Unmodified lockfile passes

- **WHEN** CI runs `npm ci` against a lockfile consistent with the manifests
- **THEN** the integrity check MUST pass and the build MUST continue

#### Scenario: Drifted lockfile fails the build

- **WHEN** a pull request contains a `package.json` change whose corresponding `package-lock.json` update was not committed
- **THEN** CI MUST exit non-zero on the integrity check and the failure MUST be attributed to that pull request

### Requirement: Documented Environment Variables

The repository SHALL provide a `.env.example` at the repo root enumerating every environment variable the application reads — at minimum `PORT`, `NODE_ENV`, `CORS_ORIGIN`, and `VITE_API_URL` — each with its default value and a comment describing its effect. Variables consumed at client build time SHALL be distinguished from those consumed at server runtime, because Vite inlines its variables at build time and they cannot be changed by the runtime environment.

`.env.example` MUST contain placeholder or default values only and MUST NOT contain secrets or machine-specific paths. The toolchain declaration SHOULD load the documented variables on activation.

#### Scenario: Every variable the application reads is documented

- **WHEN** the source is searched for environment variable reads
- **THEN** every variable found MUST appear in `.env.example` with a default and a description

#### Scenario: Build-time and runtime variables are distinguished

- **WHEN** a contributor reads `.env.example`
- **THEN** `VITE_API_URL` MUST be marked as consumed at client build time, and changing it MUST be documented as requiring a client rebuild rather than a server restart

#### Scenario: The example file carries no secrets

- **WHEN** `.env.example` is committed
- **THEN** it MUST contain only placeholder or default values, and MUST NOT contain credentials, tokens, or machine-specific absolute paths

### Requirement: Production Topology Parity Check

The repository SHALL document an on-demand command that exercises the production topology — a single process serving the built client and the API from one origin under `NODE_ENV=production`, with `server/data` backed by a mounted volume. The existing `docker compose up --build` path SHALL serve this purpose; no separate development container is required.

The README SHALL identify this as the mechanism for verifying same-origin serving, production-mode behavior, and data persistence before deploying. The default development loop is NOT required to exercise the production topology.

#### Scenario: The parity check is documented as a distinct step

- **WHEN** a contributor reads the README
- **THEN** the production-topology verification command MUST be documented separately from the day-to-day development commands, with its purpose stated

#### Scenario: The parity check exercises production serving and persistence

- **WHEN** the documented parity command is run
- **THEN** the application MUST serve the built client and the API from a single origin under `NODE_ENV=production`, and saved loadouts MUST persist across a container restart via the mounted volume

### Requirement: Task Interface Stability

npm scripts SHALL remain the documented interface for all development tasks — at minimum `npm run dev`, `npm run build`, and the test commands. The version manager SHALL NOT become a second task runner, and no documented task SHALL be invocable only through it.

The repository MUST remain fully usable by a contributor who has a satisfying Node version but has not installed the version manager.

#### Scenario: Documented tasks run without the version manager

- **WHEN** a contributor with a satisfying Node version and no version manager installed runs each documented development command
- **THEN** every command MUST succeed

#### Scenario: No task is exclusive to the version manager

- **WHEN** the documented task list is compared against the npm scripts
- **THEN** every documented task MUST have an npm script equivalent
