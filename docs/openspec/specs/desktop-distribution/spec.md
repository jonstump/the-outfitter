---
status: implemented
date: 2026-08-10
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

**Amended 2026-08-19 — a native menu and a Preferences surface are now required, and the data directory may be overridden.** Clicking through an early, unpackaged build surfaced that a macOS app with no menu bar and no settings surface feels unfinished, and that the previously automatic-only data directory (see "Per-User Data Directory" below) is exactly the kind of thing a user will want to relocate themselves. Two changes below capture this: a new "Native Application Menu and Preferences Surface" requirement establishes the menu and a generic Preferences host that other specs' requirements may register settings into without SPEC-0005 owning their behavior, and "Per-User Data Directory" gained a user override with a non-destructive default — decline the offered move, and the old data is left in place rather than deleted.

## History: The Product-Completeness Gate (resolved 2026-08-18)

**This spec was deliberately held out of planning from 2026-08-14 through 2026-08-17, and the hold has
since been lifted.** It carried no epic, no stories and no project board *by decision*, and during that
window it was not to be flagged as missing work by `/sdd:audit`, `/sdd:check`, a drift review, or any
planning pass. All seven gates below cleared by 2026-08-17, and the owner made the deliberate call on
2026-08-18 that the app is worth installing — `status:` moved from `blocked` to `approved` via
`/sdd:status`, and `/sdd:plan SPEC-0005` may now be run. This section is kept as the historical record of
what the gate required and how each item closed; it is no longer an active instruction.

**The bar was product completeness, not technical readiness.** Every requirement in this spec is about
*packaging* — the loopback boundary, the per-user data directory, the release artifacts. None of them was
what actually gated shipping. What gated shipping was whether the app was worth installing: an installed
desktop build that was missing catalog items, carried data known to be wrong, or could not express
loadouts the game itself allows would have been half-baked, and a desktop user cannot be redeployed out of
it the way a web user can. The requirements below are the spec's own *work*; these seven were the *gate*
that stood in front of planning that work.

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
      that order — the spec's own "warn before clamping" sequence. **#419** closed the same day — the
      grid's rejected-drop announcement was silent on the first rejection because the live region was
      created and filled in one synchronous block; PR #430 mounted it permanently.

      **The three that kept this gate open past 2026-08-15 have since closed too.** **#382** (the
      loadout shape guard accepted an equipment array shorter than eight cells) closed via PR #440.
      **#363** (grid capacity derived in three places, two of them dead) closed via PR #452 — its
      actual fix corrected a stale premise in the issue itself: #353 had already wired `slotMax` into
      the live `equipOverCapacity` path, so the real fix was deduping `slotMax`'s blocked-cell count to
      match `hasFreeCell`, not deleting code that was no longer dead. **#241** (click-to-remove
      preserved by reference and colliding with other gestures) closed via PR #454 — also a
      stale-premise correction: the shipped implementation had already resolved the three named gesture
      collisions differently (a dedicated remove button, separated Enter/Space semantics, pointer-capture
      retargeting) than the fix #241 originally proposed.

      Independently verified 2026-08-17 via `/sdd:audit`: PRs #440, #452 and #454 are confirmed merged
      on GitHub, with titles matching the claims above.

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

      Independently verified 2026-08-17 via `/sdd:audit`: PRs #440, #452 and #454 are confirmed merged
      on GitHub, with titles matching the claims above.

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

      **The dependency chain `#339 → #340 → #341 → #342 → #343 → #344 → #345` closed in full**, plus
      **#431** (a spec defect around the seven dual-family weapons, settled before #341 scraped
      anything, exactly as this section anticipated) and **#346–#348** (the second ammo control and its
      cross-spec amendments). #344 switched every reader — UI dropdown, pricer, randomizer, save
      encoder — off the shared `AMMO` pool onto each weapon's own scraped accepted list; #345 raised
      `FORMAT_VERSION` to 4 so rounds are referenced by stable id rather than a positional index into
      that pool. Two non-blocking follow-ups from #344's review, #461 and #462, both closed clean —
      #461 on inspection (the code path it described no longer existed by the time it was picked up)
      and #462 with added test coverage.

      **The severity-vs-strict granularity question this section flagged as needing to be settled
      first was never formally decided — it became moot instead.** The overlapping #351–#394 sweep's
      severity-reading subset (13 issues, including #356/#359/#361/#365/#367/#373/#384 named here as
      overlap) and its strict reading (42 issues) both reached full closure within the same 48-hour
      window, so no build was ever scheduled against one reading and found wanting under the other.
      Recorded as an overtaken risk, not a validated shortcut — the next slower-moving gate with this
      shape should still settle it deliberately.

      Independently verified 2026-08-17 via `/sdd:audit`: epic #338 confirmed `CLOSED` on GitHub, and
      `per-weapon-ammo/spec.md`'s own frontmatter reads `status: implemented`.

**Sequencing.** Two of the seven constrained everything downstream: **#424 (rebrand) → #428 (icon) →
SPEC-0005's own packaging work.** A mark designed around "The Outfitter" would have needed redrawing for
"Backwater Outfitters", and the release pipeline references both the name and the icon paths, so
retrofitting either into that config would have cost more than doing them first. The ammo data did not sit
in that chain — it ran in parallel — but it was the long pole, and it was in fact the gate that took
longest to clear. The remaining gates were independent of the chain and of each other.

**ADR-0020 depends on this gate and remains correctly sequenced behind it.** Ammo iconography is accepted
and deliberately unspecced, recorded as wanted "shortly after shipping the desktop app once the ammo data
is fixed". This gate clearing does not pull those icons forward; the order remains ammo data → desktop
ships → ammo icons, and desktop shipping is now the open step.

**This list was Jon's, stated 2026-08-14 and extended 2026-08-15, and it superseded an earlier
reconstruction.** A previous revision of this section had guessed at SPEC-0002, server embeddability and
the wire format. Those were parts of this spec's own work, not gates on starting it, and that guess is
exactly what this section existed to prevent.

## Requirements

**Implementation status (corrected 2026-08-28 per `/sdd:audit`).** **This capability is
implemented.** The `desktop/` workspace exists (`main.js`, `preload.js`, `preferences.js`,
`preferences-preload.js`, `lib/secretCheck.js`, `lib/prefsPure.js`, `scripts/build.js`),
`server/src/index.js` exports the configured `app` behind an entry-point guard so importing it
binds no port, and `.github/workflows/release.yml` carries the gated three-platform matrix.
Epic #501's seven stories are all closed.

This note previously read: "Nothing in this capability is implemented yet. No `desktop/` workspace
exists; `server/src/index.js` still calls `app.listen()` at module scope. The requirements below are
the work `/sdd:plan SPEC-0005` has yet to break down." All three clauses were false by the time the
frontmatter moved to `status: implemented`, and the note was left behind. It is recorded here rather
than deleted because this is the third recurrence of the same failure in this corpus — SPEC-0006 and
SPEC-0009 each carried a stale status snapshot that was read as current fact, and in SPEC-0006's case
it propagated into SPEC-0008 as a false statement about live code. **Read the frontmatter `status:`
field as authoritative, not this paragraph.**

Three requirements are implemented but carry known defects, each tracked and none of them a reason to
re-open the capability's status:

- **"Authenticated Loopback Boundary"** — the `/api` guard in `desktop/main.js` is bypassable by path
  case (#517, blocker). The middleware itself is correct; its caller re-derives Express's path
  matching by hand and gets it wrong.
- **"Reproducible Three-Platform Release Artifacts"** — the Windows signing credential is modelled as
  a certificate file secret, which this spec forbids by name (#518). Latent: the signing path only
  runs when `RELEASE_SIGNING=signed`, which is not the default.
- **"Native Application Menu and Preferences Surface"** — About shows no installed version on Windows
  or Linux (#519).

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

**Amended 2026-08-19 — the directory MAY be overridden by the user.** Electron's `userData` path remains the default on first launch, but the Preferences surface (see "Native Application Menu and Preferences Surface" below) SHALL let the user choose a different directory. On change, the desktop host SHALL offer to move the existing lowdb file into the new location; if the user declines, the new location SHALL start from the store's default empty collections exactly as a first launch does, and the file at the previous location MUST NOT be deleted. The chosen path SHALL persist across relaunches, resolved before `OUTFITTER_DB_FILE` is set.

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

#### Scenario: The user changes the data directory

- **WHEN** a user selects a new data directory in Preferences and confirms
- **THEN** the desktop host SHALL offer to move the existing lowdb file into the new directory, and on the next launch SHALL read from the new directory

#### Scenario: A declined directory change does not delete old data

- **WHEN** a user changes the data directory and declines the offered move
- **THEN** the new directory SHALL start from empty collections, and the file at the previous directory SHALL remain unmodified on disk

#### Scenario: The chosen directory persists across relaunches

- **WHEN** the app is relaunched after a directory change
- **THEN** it SHALL resolve `OUTFITTER_DB_FILE` from the persisted preference rather than falling back to Electron's default `userData` path

### Requirement: Native Application Menu and Preferences Surface

The desktop host SHALL install a native application menu appropriate to the platform, and SHALL expose two distinct entry points from it: an **About** surface and a **Preferences** surface. These MUST NOT be merged into one window — About is informational and does not change per session; Preferences holds persisted, user-editable state, and conflating the two is what this requirement exists to prevent.

**About** SHALL show the installed version, and MAY link out to documentation or support. It owns no persisted state and SHALL NOT contain editable controls. This is the desktop surface for the "About and Help" epic (#72); it does not require a spec of its own, per that epic's existing scope.

**Preferences** SHALL be a generic settings host — a window, or a platform-native panel — that other specs' requirements MAY register a control into, without SPEC-0005 owning the behavior those controls configure. The desktop data directory (per "Per-User Data Directory" above) SHALL be the first control it hosts. A setting registered here SHALL persist across relaunches independent of the lowdb store, since the data-directory setting must survive even while the store itself is being relocated.

This requirement governs the menu's and the Preferences window's existence and extensibility contract only. It does not define what any individual setting other than the data directory does — a setting whose behavior is owned by another spec (for example, a hunter-list display threshold governed by SPEC-0003) is specified there, not here, and registers only its control into this surface.

#### Scenario: The application menu exists and is platform-appropriate

- **WHEN** the desktop app is running on macOS
- **THEN** a native menu bar SHALL be present with the application name as the first menu, containing at minimum an About item and a Preferences item (Cmd+,)

#### Scenario: About and Preferences are separate surfaces

- **WHEN** a user opens About and, separately, Preferences
- **THEN** they SHALL be distinct windows or panels, and neither SHALL contain the other's content

#### Scenario: About contains no editable state

- **WHEN** the About surface is inspected
- **THEN** it SHALL contain no control that writes a persisted setting

#### Scenario: Preferences hosts the data directory control

- **WHEN** Preferences is opened
- **THEN** it SHALL contain the data directory control described in "Per-User Data Directory"

#### Scenario: A foreign spec's setting can register without SPEC-0005 defining its behavior

- **WHEN** another spec adds a user-editable setting intended for this surface
- **THEN** SPEC-0005 SHALL require only that its control appear in Preferences, and SHALL NOT be amended to define that setting's behavior

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
