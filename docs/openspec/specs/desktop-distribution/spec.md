---
status: blocked
date: 2026-08-10
blocked-since: 2026-08-14
blocked-by: [dual-wield-pairs, tarot-cards, data-audit-remediation, equipment-drag-and-drop, rebrand, app-icon, ammo-data]
implements: [ADR-0008]
---

# SPEC-0005: Desktop Distribution

## Overview

This capability adds a second distribution target: an installable desktop application for Windows, macOS, and Linux, built from the same two workspaces that already serve the self-hosted target. It realizes [ADR-0008](../../../adrs/ADR-0008-desktop-app-packaging.md), which chose an Electron shell hosting the existing Express server on loopback over Tauri (sidecar or Rust rewrite), an installable PWA, and the self-hosting-only status quo.

The decision rests on the desktop backend *being* `server/src/`, not resembling it. ADR-0006 and ADR-0007 govern that code, SPEC-0003's ownership requirements are enforced in it, and 63 server tests cover it. Every requirement below exists either to preserve that property or to close the one gap the packaging choice opens.

**Self-hosting is not superseded.** `npm start`, `Dockerfile`, `docker-compose.yml`, and `Procfile` remain first-class and are covered by their existing CI guards. A desktop change that regresses any of them fails this spec.

**The load-bearing requirement is "Authenticated Loopback Boundary."** In the hosted model the operator controls the network boundary; on a desktop machine there is none. An in-process HTTP listener is reachable by every other local process and by any web page that scripts `fetch` at `127.0.0.1`. Electron IPC would avoid this by construction — ADR-0008 accepted the HTTP path for its code-sharing property *on the condition that this requirement is met*. Shipping the desktop app without it is worse than not shipping it.

**Amended 2026-08-10 — unsigned publication is permitted when the bypass is documented.** This spec originally forbade publishing unsigned macOS and Windows artifacts outright. That rule assumed a project reaching non-technical users at scale, and it blocks the actual near-term goal: shipping for free to see whether anyone wants this. Signing is now required before *broad promotion* rather than before any publication, and an unsigned release is permitted provided its download page documents the per-platform bypass. The rule's real purpose — preventing a *silent* downgrade to unsigned artifacts through misconfiguration — is preserved and stated separately below, because a deliberate documented choice and a broken signing config must not be allowed to look alike.

Two factual corrections accompany the amendment. **Windows signing does not reliably remove the SmartScreen warning**: SmartScreen keys on reputation, and a new OV certificate has none, so signed builds keep warning until downloads accumulate — only EV certificates carry instant reputation. **Signing credentials can no longer be a file in CI secrets**: publicly-trusted code-signing certificates, OV included, must keep private keys on a hardware token or cloud HSM, so CI signing means a cloud signing service (Azure Trusted Signing, SSL.com eSigner, DigiCert KeyLocker) rather than a committed or uploaded certificate.

## Blocked — do not plan, do not audit as a gap

**This spec is deliberately unplanned. Its absence from the issue tracker is the intended state, not an
oversight.** It has no epic, no stories and no project board *by decision*, and it MUST NOT be flagged as
missing work by `/sdd:audit`, `/sdd:check`, a drift review, or any planning pass. Do not run `/sdd:plan
SPEC-0005` until every item below has shipped. This note exists because the blocked status has been stated
in conversation more than once and kept evaporating — it is recorded here, in `CLAUDE.md`, and in the
session memory so that it survives.

**The bar is product completeness, not technical readiness.** Every requirement in this spec is about
*packaging* — the loopback boundary, the per-user data directory, the release artifacts. None of them is
what actually gates shipping. What gates shipping is whether the app is worth installing: an installed
desktop build that is missing catalog items, carries data still known to be wrong, and cannot express
loadouts the game itself allows is half-baked, and a desktop user cannot be redeployed out of it the way
a web user can. Do not re-derive this list from the requirements below — the requirements are the *work*,
these seven are the *gate*.

**Amended 2026-08-15 — three gates added, and the count is now seven.** The rebrand and the application
icon were part of the intent from the start and were simply not written down on 2026-08-14. The ammo data
was recalled the same day. All three are recorded here rather than left in conversation, which is the
whole purpose of this section. The rebrand and the icon are cheap and are *ordering* constraints on
everything else — see "Sequencing" below. The ammo data is neither cheap nor an ordering constraint: it
is by some distance the largest gate on this list.

- [x] **Dual-wield pair support — shipped, and this gate is fully clear.** SPEC-0009 / ADR-0023, merged
      as #397, #398, #399, with the two correctness follow-ups (#400 un-pairing refused over capacity,
      #401 the locked affordance not keyboard-reachable), the affordance's tests (#334) and the
      cross-spec amendments (#335) all closed behind them. Epic #327 closed 2026-08-15 with all eleven
      stories done, and SPEC-0009 moved to `implemented`.
- [x] **Tarot card support — shipped 2026-08-15, and this gate is clear.** #37 admitted the fourteen
      cards as ordinary `CONS` rows costing zero (PR #426) and #350's SPEC-0006 amendment landed in the
      same release, as both tickets required. The cap needed no change at all — `CONS_CAP_CATEGORIES`
      had declared `"Tarot Cards"` with no rows precisely so admission would be free, which is SPEC-0006
      REQ "Capacity Rules Are Stated Once and Preserved" paying out exactly as designed. Two steps
      neither ticket listed were caught first and shipped with it: `CONS_TYPES` plus a fourth badge
      colour (the tests require a distinct one per category with rows), and a scrape re-run, without
      which the cost-0/Scarce assertion would have had no data to assert against — `itemStats.json`
      went 256 to 270 rows.
- [x] **The data audit is worked down — clear, 42 of 42 closed.** The #351–#394 sweep is fully closed
      as of 2026-08-16, via PR #488 for the last remaining item, #388 (test fixture honesty — labeled
      two synthetic `obtainable: false` fixtures as deliberately testing a currently-unreachable
      branch and added a domain-pinning regression test). The gate is those findings closed, not the
      audit re-run, and they are.

      **This gate's granularity was never formally settled, and by 2026-08-16 the question became
      moot rather than resolved.** Read strictly, "the sweep closed" means all 42, of which 28 are
      documentation, provenance and test-coverage debt no desktop user could ever observe. Read by
      severity — blockers plus should-fix plus #366 — it was 13, all 13 of which closed on 2026-08-16
      (#351/#352/#353 blockers, #354–#362 should-fix, #366). **The two readings converged by
      exhaustive completion, not by a deliberate choice between them** — the burn-down finished the
      strict reading before anyone had to pick, so the "weeks apart or months apart" risk this
      section warned about never materialized. Recorded here rather than silently claiming the
      question was decided: it wasn't decided, it was overtaken. The severity reading is the one that
      matches this section's own stated bar
      ("carries data still known to be wrong"); the strict reading was roughly four times the work.
      **The instruction to settle this before the burn-down went further was not followed, and it
      turned out not to matter** — the burn-down reached both answers within the same 48 hours, so
      no build was ever scheduled against one reading and then found wanting under the other. This
      does not retroactively validate skipping the decision; it recorded a real risk this run of the
      burn-down happened not to hit. Whoever next opens this gate on a slower-moving item should still
      settle its granularity before picking either.
- [x] **Equipment slot drag and drop is sound — clear, 2026-08-17 (PR #491).** This gate was the last
      of the seven to fall, and the only one that was ever held open on a requirement rather than a
      ticket count; the history below is kept because that distinction is the reusable part.
      SPEC-0006 direct manipulation landed, and as of 2026-08-15 both tickets this
      bullet called blockers are closed: **#352** (`moveEquip` duplicated an item from an empty source
      cell) took the reducer guard in #415 and the grab-ref lifetime, Escape-origin guard and
      pointer-identity check in #420; **#353** (no decoder enforced any equipment rule) took the
      equipment panel's over-capacity surface in #416 and the `boundedEquip` decode clamp in #421, in
      that order — the spec's own "warn before clamping" sequence.

      **#419 has since closed too** — the grid's rejected-drop announcement was silent on the first
      rejection because the live region was created and filled in one synchronous block; PR #430
      mounted it permanently. It was filed 2026-08-15 out of the #416 review and is the same defect
      class #400 fixed on the weapon slot.

      **The three tickets this bullet used to call "what remains" have all closed** — #241
      (click-to-remove preserved by reference and colliding) via PR #454, #363 (grid capacity derived in
      three places, two of them dead) via PR #452, and #382 (the loadout shape guard accepts an
      equipment array shorter than eight cells) via PR #440. Two were stale premises rather than
      defects: #363 assumed `slotMax` was dead code when #353 had already wired it into the live
      over-capacity path, and #241 proposed a movement threshold and a Delete key for gesture collisions
      the shipped implementation had already resolved another way.

      **What keeps this unchecked now is #464, and that is a decision, not a backlog.** `/sdd:audit`
      found on 2026-08-16 that SPEC-0006's REQ "Repeated Consumables Read as One Stack"
      (`equipment-slot-arrangement/spec.md:213`, SHALL, with its scenario at `:242-245`) requires
      dragging any cell of a stack to move the entire run as a unit, and the shipped code does not do
      it: `moveEquip` (`client/src/store/loadoutSlice.js:232-255`) takes a single cell index with no
      run-length parameter, `startGrab` (`EquipmentSlot.jsx:87-92`) records only the pressed cell with
      no reference to the stack's run, and `onGridPointerUp` (`EquipmentPanel.jsx:70-94`) dispatches
      with no run-awareness — so dragging the anchor of a ×2 consumable stack empties that cell and
      leaves the second copy behind as an orphaned tile. SPEC-0006's own Implementation-status line
      (`:41`) claims this is built and carries tests that name it; it is not, and no test in
      `EquipmentPanel.test.jsx` or `EquipmentSlot.test.jsx` exercises stack dragging or the
      insufficient-room rejection at all.

      **The owner decided on 2026-08-16 that this gate stays unchecked until #464 closes, and PR #491
      closed it on 2026-08-17.** "Sound" is the bar this gate sets, and an unimplemented SHALL that
      visibly breaks a stack apart on an ordinary drag did not meet it — the gate follows the
      requirement, not the issue count, and five blockers closing did not settle drag and drop while a
      required behaviour was missing. `moveEquip` now carries the run's length, so a stack moves as one
      unit.

      **This is the precedent worth reusing, and it is why the history above is kept rather than
      collapsed to a checkmark.** The gate was held on a requirement and released by a fix — not by
      re-reading the bar until the behaviour that had already shipped qualified. It took eight hours.
      Unlike the granularity question in the gate above, which was overtaken rather than answered, this
      one was decided deliberately and then satisfied.

- [x] **The rebrand to "Backwater Outfitters" — clear, 2026-08-16 (PR #463).** #424. The app was
      branded "The Outfitter" in-app and across the docs; it was renamed. This gate existed by
      *ordering* rather than by size: an installed application carries its name in the installer, the
      bundle identifier and the artifact filenames, and a desktop user cannot be renamed out of it the
      way a web page can be redeployed. Doing it before the packaging work was nearly free; doing it
      after a build ships would not have been doing it at all.

      **The copy rename was low-risk. A grep for the name was not.** The surface was 40 files and 80
      occurrences, almost all prose — but the same grep hit identifiers that are not brand, and
      renaming those would have failed *silently*, with no error and no way for a user to recover.
      These were verified untouched by reading their live literal values post-merge, not just trusting
      the PR's own grep claims: `hunt-outfitter-token` (`client/src/api/loadouts.js`) — the ownership
      token SPEC-0003 scopes every saved loadout by, so a new key would make a user's own server-side
      loadouts unreachable and undeletable; `hunt-outfitter-current`
      (`client/src/utils/loadoutCodec.js`) and `hunt-outfitter-selected-list`
      (`client/src/store/uiSlice.js`) — a new key would read empty, so every returning user would open
      to a blank build; `OUTFITTER_DB_FILE` (`server/src/db.js`, `.env.example`, `server/package.json`)
      — the env var every deployment sets, and the exact seam the Per-User Data Directory requirement
      below relies on; and `render.yaml`'s service name `the-outfitter` and disk name `outfitter-data`
      — renaming a persistent disk would provision a new empty volume and strand the deployed data. The
      npm workspace names (`@the-outfitter/client`, `@the-outfitter/server`) were left unrenamed as the
      smaller diff — they were safe to change, just internal plumbing rather than brand, not something
      this work needed to touch.

      Reviewed independently twice before merging: once in the session that filed this correction, once
      in a separate session sharing the same local repo.

- [x] **The application icon — clear, 2026-08-16 (PR #459).** #428. Landed *ahead of* the rebrand above
      on the owner's explicit call — the mark is a pure pictorial symbol with no wordmark baked in,
      confirmed to contain no text, so it doesn't visually contradict either name. `client/index.html`
      now wires `favicon.ico`, `favicon.svg`, and `apple-touch-icon.png`, all present under
      `client/public/`; electron-builder's `.icns`/`.ico`/PNG sets generate from the same master.
      Review caught and fixed one defect before merge: the original `sizes="any"` on the `.ico`
      `<link>` tag is deprecated for that exact purpose (it made Chrome download both the ICO and the
      SVG instead of preferring one) — corrected to `sizes="32x32"`.

      **Not SPEC-0001 "Equipment Iconography".** That governs the in-app item artwork under
      `client/public/images/`, which is shipped, generated by the image scrape, and unrelated to this
      gate.

- [x] **The ammo data is corrected — clear, 2026-08-16, and it was by far the largest gate here.**
      SPEC-0010 is `implemented` and epic #338 closed on 2026-08-16 with every one of its fourteen
      issues, the dependency chain `#339 → #340 → #341 → #342 → #343 → #344 → #345` landing in order —
      which was the whole risk. The per-issue record is in `CLAUDE.md`'s gate 7.

      **Everything below this paragraph is the original 2026-08-15 planning note, kept as the record of
      how this gate was scoped and measured.** It is written in the present tense of a gate that had not
      started, and should be read that way. The case it made was this section's own bar almost verbatim:
      the app carried data known to be wrong. SPEC-0010's measurement was a diff of all
      140 non-melee catalog rows against their own wiki pages — the app offers **587 (weapon, round)
      pairs where the wiki lists 491**, so **243 rounds a weapon cannot take**, **147 it can take that
      the app cannot express**, and **137 of 140 weapons wrong in at least one direction**. A player
      pricing a build against this is pricing a build the game will not sell them.

      **Scope is unsettled in the same way the data-audit gate's is, but the room to narrow it is much
      smaller than it first appears.** The stories' own dependency chain, read from their bodies rather
      than from their numbering, is `#339 → #340 → #341 → #342 → #343 → #344`. #339 freezes the
      index-to-id table and #340 makes ammo catalog rows; #341 scrapes per-weapon compatibility, price
      and slot count; #342 accepts version 4 at the payload boundary and #343 is the version-4 decoder,
      which is where #339's resolver is finally wired in; #344 then switches every reader, and its body
      declares itself blocked by **both** #341 and #343. So "the app stops showing wrong ammo" cannot
      skip the wire-format bump — #345 almost certainly joins it too, since reading version 4 while
      writing version 3 is incoherent.

      That leaves **#346–#347** (the second ammo control) and **#348** (the cross-spec amendments) as
      the only genuinely separable work: seven of ten stories are the narrow reading, not four. The
      second control is separable on its own merits — a single control offering the right rounds is
      *accurate* for every weapon and merely *incomplete* for the 32 that hold two — so it is the one
      piece that could follow the desktop ship without the app displaying anything false.

      **#431 is a spec defect and should be settled before #341 scrapes anything.** SPEC-0010 models
      slot count and family membership as independent properties, but for the seven dual-family
      weapons they are the same fact — a Drilling's two selections are one per barrel, rifle and
      shotgun, not a split of one family's reserve. As written, the accepted-round list is the union of
      both families and the slots draw from it independently, so the model permits a Drilling holding
      two Medium rounds and no Shell. That is the ammo version of #353: a state the app can represent,
      price, encode and persist, and the game refuses. Cheap now; expensive once the scrape has
      committed to a shape that cannot express the distinction.

      **Several open findings from the #351–#394 sweep are this same subject from the other end** —
      #356, #359, #361, #365, #367, #373 and #384 — and would most likely close with this work rather
      than separately. That overlap is worth counting once when sizing either gate.

**Sequencing.** Two of the seven constrain everything downstream: **#424 (rebrand) → #428 (icon) →
SPEC-0005's own packaging work.** A mark designed around "The Outfitter" would be redrawn for "Backwater
Outfitters", and the release pipeline references both the name and the icon paths, so retrofitting either
into that config costs more than doing them first. The ammo data does not sit in that chain — it can run
in parallel — but it is the long pole, so it is the one most likely to set the ship date. The remaining
gates are independent of the chain and of each other.

**ADR-0020 depends on this gate and is correctly sequenced behind it.** Ammo iconography is accepted and
deliberately unspecced, recorded as wanted "shortly after shipping the desktop app once the ammo data is
fixed". Admitting the ammo data as a gate here does not pull those icons forward; the order remains ammo
data → desktop ships → ammo icons. ADR-0020's disposition note still says this spec is blocked behind
*four* gates, which was true when written on 2026-08-14 and is not now — the count is corrected there in
the same change that added this bullet.

**This list is Jon's, stated 2026-08-14 and extended 2026-08-15, and supersedes an earlier reconstruction.** A previous revision
of this section guessed at SPEC-0002, server embeddability and the wire format. Those are parts of this
spec's own work, not gates on starting it, and that guess is exactly what this file now exists to
prevent. If the gate changes, edit it here.

**Implementation status.** Nothing in this capability is implemented. No `desktop/` workspace exists;
`server/src/index.js` still calls `app.listen()` at module scope.

`status: blocked` is a deliberate local extension to the SDD vocabulary (`draft`, `review`, `approved`,
`implemented`, `deprecated`), chosen because none of those five can express "approved and correct, but
not to be worked or planned yet". Nothing in the plugin rejects an unrecognised status, and `/sdd:prime`
treats every status except `superseded`, `deprecated` and `rejected` as authoritative — which is right,
since the decision here still governs. The approval this spec received on 2026-08-10 stands; only its
readiness to be planned has changed.

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

*(signing requirements amended 2026-08-10 — see Overview)*

Every release SHALL be designated either **unsigned** or **signed**, and the designation SHALL be explicit in the release configuration rather than inferred from whether credentials happened to be present.

An **unsigned** release MAY be published for any platform, provided its download page satisfies the "Documented Bypass Instructions" requirement below. Linux artifacts are unaffected by any of this — AppImage and deb require no signing.

A **signed** release SHALL sign macOS artifacts with a Developer ID and notarize them, and SHALL Authenticode sign Windows artifacts.

Signing SHALL be in place before **broad promotion**, which means any of: naming a desktop installer as the primary install path in the README, announcing the app to a community that is not already testing it, or submitting it to a package index, app directory, or store. Circulating a build to named testers, linking it from an issue or PR, and publishing it as a GitHub Release that the README describes as unsigned all fall short of broad promotion and MAY proceed unsigned.

Signing credentials MUST NOT be committed to the repository. Because publicly-trusted code-signing certificates must keep private keys on a hardware token or cloud HSM, the Windows credential SHALL be a cloud signing service accessed by CI, not a certificate file held as a secret.

A release designated **signed** SHALL fail if its credentials are unavailable. It MUST NOT fall back to emitting unsigned artifacts — that fallback is the failure mode this requirement exists to prevent, and it is precisely what makes a deliberate unsigned release safe to permit.

#### Scenario: A tagged release produces all three platforms

- **WHEN** a release tag is pushed and the test job passes
- **THEN** CI SHALL produce Windows NSIS, macOS DMG, and Linux AppImage and deb artifacts

#### Scenario: Failing tests block packaging

- **WHEN** the test job fails on a release tag
- **THEN** no packaging job SHALL run and no artifact SHALL be published

#### Scenario: A signed release with missing credentials fails loudly

- **WHEN** a release designated `signed` runs without its signing credentials available
- **THEN** the job SHALL fail, and it MUST NOT publish an unsigned artifact in their place

#### Scenario: An unsigned release publishes when its bypass is documented

- **WHEN** a release designated `unsigned` runs and its download page carries the per-platform bypass instructions
- **THEN** the artifacts SHALL be published, and the release SHALL be labelled unsigned

#### Scenario: An unsigned release without instructions does not publish

- **WHEN** a release designated `unsigned` runs and its download page carries no bypass instructions
- **THEN** the release SHALL fail rather than publish artifacts users cannot open

#### Scenario: Broad promotion requires signing

- **WHEN** the README is changed to name a desktop installer as the primary install path, or the app is submitted to a package index or store
- **THEN** the artifacts referenced SHALL be from a `signed` release

#### Scenario: The client build is not forked

- **WHEN** the desktop packaging pipeline is inspected
- **THEN** it SHALL consume the output of the existing client build, and `client/vite.config.js` SHALL carry no desktop-specific branch

### Requirement: Documented Bypass Instructions for Unsigned Builds

*(added 2026-08-10)*

An unsigned release's download page SHALL state plainly that the build is unsigned, and SHALL document what the user will see and what to do about it, per platform. The instructions are what makes an unsigned release honest rather than broken, so they are a release gate, not documentation nicety.

For **Windows**, the page SHALL describe the SmartScreen "Windows protected your PC" dialog and name the two steps that dismiss it — **More info**, then **Run anyway** — since the second is hidden until the first is clicked. It SHALL also note that the browser may separately warn about the download, and that managed corporate machines may block it outright with no user-side override.

For **macOS**, the page SHALL describe the "could not verify … free of malware" block and the route through **System Settings → Privacy & Security → Open Anyway**. It MUST NOT instruct users to Control-click and choose Open: that override was removed in macOS 15, so on current systems it is advice that silently does not work.

The page SHOULD offer the Homebrew cask install as a lower-friction macOS path, since Homebrew removes the quarantine attribute and an unsigned app installed that way launches normally.

The page MUST NOT instruct users to disable Gatekeeper or SmartScreen system-wide, or to run `xattr` against a broad path. A per-app bypass is the most the instructions may ask for — turning the protection off entirely is a worse outcome for the user than not shipping.

Instructions SHALL be reviewed when a targeted OS major changes its flow. A step that no longer matches what the user sees is a defect in this requirement, not merely stale prose.

#### Scenario: The unsigned state is disclosed

- **WHEN** a user reaches the download page for an unsigned release
- **THEN** it SHALL state that the build is unsigned before the download links

#### Scenario: Windows instructions name the hidden step

- **WHEN** the Windows instructions are read
- **THEN** they SHALL name both **More info** and **Run anyway**, in that order

#### Scenario: macOS instructions match current behaviour

- **WHEN** the macOS instructions are read
- **THEN** they SHALL route through System Settings → Privacy & Security, and SHALL NOT tell the user to Control-click and choose Open

#### Scenario: Instructions never ask users to disable protections

- **WHEN** the bypass instructions are reviewed
- **THEN** they SHALL contain no step disabling Gatekeeper or SmartScreen system-wide

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
