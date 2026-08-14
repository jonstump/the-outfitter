# Adversarial QA Panel Review — Data Correctness

**Date:** 2026-08-14
**Scope:** the game dataset and the rules that consume it — `client/src/data/`, `data/hunters.json`,
`client/src/utils/`, and the 22 ADRs and 8 specs governing them
**Process:** [`docs/prompts/adversarial-data-qa-review.md`](../prompts/adversarial-data-qa-review.md)
— five independent seats (Round 1), five cross-examinations by non-authors (Round 2), chair
consolidation (Round 3)
**Status:** Round 3 in progress. Rounds 1 and 2 are complete and filed; the consolidated findings
table below is being assembled from them.

---

## Method and its limits — read this first

This section is the report's credibility. Four constraints bounded what this panel could see, and
one of them was caused by the panel itself.

### 1. The wiki was unreachable, for every seat

`huntshowdown.wiki.gg` — the source of truth under ADR-0002 and ADR-0005 — answers `403` at
`CONNECT` from this environment. All five seats verified this independently; one confirmed the
block is not host-specific (`example.com` fails identically).

**What this means for every finding below.** The panel's oracle was the committed scrape
(`itemStats.json`, carrying `wikiUrl` and `sourceRevision` per record) plus internal consistency.
That is enough to find disagreements *between* the app's own artifacts, and every confirmed finding
here is of that kind. It is **not** enough to find a value where the catalog and the scrape agree
and both are stale. **No finding in this report asserts what the game actually charges.** Where a
magnitude figure originates from a document written when the wiki was still reachable, it is marked
`[UNVERIFIED]` and attributed rather than adopted.

The honesty rule held. Across 51 Round 1 findings, no seat asserted a game number from recall, and
Round 2 confirmed this explicitly for the filings where it was most tempting.

### 2. The working tree is a shallow clone — and it cost the panel a finding

`git rev-parse --is-shallow-repository` returns `true`. Only ~52 commits are visible, grafted at
`4e5d239` (2026-08-12); the true history is 277 commits. `git log -p -- catalog.js` returns 8
commits here against 26 in reality.

**Any seat whose charge touched history under-reported unless it recovered full history first.**
Seat 1 did, into an isolated bare mirror in scratch space. Seat 5 did not, and that is the direct
cause of its F6 — a finding whose proposed fix would have deleted the only in-file justification for
a live alias in `loadoutCodec.js`. Round 2 struck it. Seat 5's conclusion was not merely wrong; it
was confidently wrong in a way that reads as a cleanup.

This is the single most important lesson for the next panel: **verify clone depth before assigning a
history-dependent charge.**

### 3. `npm test` does not run in this environment

Node here is v22 against a pinned `engines.node: ^20` with `engine-strict=true`, and `vitest` is not
on the workspace script's PATH. `npm test` exits 127 without running anything.

Run directly, the baseline is green, and every finding in this report is filed against that green
baseline:

| Suite | Result |
|---|---|
| Client | 759 passed |
| Server | 161 passed, 1 skipped |
| Scrape scripts | 321 passed |

### 4. The panel corrupted its own test baseline — an orchestration defect, not an app defect

Several seats observed large server-suite failures (43, 94, and 139 in different filings). These are
**an artifact of running five seats concurrently**: every run of the server suite uses one
hardcoded, gitignored `server/data/db.test.json`, so concurrent seats clobbered each other's
fixture.

The diagnosis was itself contested, and Round 2 resolved it. Seat 4 attributed the failures to
vitest parallelising seven test files over one db; the challenger struck that — `server/vitest.config.js:17`
already sets `fileParallelism: false`, and the suite run alone under default settings passes 161/1-skipped.
Seats 1 and 5 correctly identified the shared hardcoded path. **Round 2 challengers were told the
verified baseline and instructed not to run that suite concurrently**, so the artifact was not
reproduced during cross-examination.

Next panel: give each seat a private db path, or forbid the server suite outside a designated seat.

### 5. Two errors in the panel's own brief, caught by the panel

Both were mine, and both are recorded here rather than quietly corrected, because a brief that
misstates the data is a source of exactly the anchoring this process exists to resist.

- **`obtainable`.** The brief stated that 2 hunters are `obtainable: false`. They are
  `obtainable: null` — 240 `true`, 2 `null`, **zero `false`**. Seat 4 caught it and its challenger
  confirmed the values independently. The consequence is a real finding: the picker's "Not
  obtainable" filter cannot match any hunter, and both tests covering it invent `obtainable: false`
  fixtures rather than using shipped data.
- **Two predicted headline artifacts did not exist.** The brief told Seat 2 that enumerating catalog
  rows unpinned by `itemStats` would be "probably the single most valuable artifact the panel
  produces," and told Seat 4 to expect a long list of items silently running on the SVG image
  fallback. Both came back empty: **256 of 256 catalog rows are covered**, zero orphans in either
  direction, and **0 missing images, 0 orphans, 0 slug collisions across 498 files** in five trees.
  Both seats substituted better artifacts of their own — a per-*column* provenance table, and a
  re-derivation that first verified which tuple field each `ItemThumb` call site passes as `name`,
  since a method reading the wrong field would produce clean zeros for the wrong reason.

### 6. What no seat could check

**Items missing from the catalog entirely.** Detecting them requires `scrape-stats.mjs --discover`,
which crawls the wiki's category indexes — unavailable (network) and forbidden by the brief (it
would rewrite committed data). No seat covered this and none claims to. It is stated here so that
silence is not read as coverage.

Also uncovered, as a consequence of limit 1: any value where `catalog.js` and `itemStats.json` agree
with each other and both are stale relative to the live game.

---

## Findings

*Round 3 assembly in progress — the consolidated table, the strikes appendix, the unresolved
disagreements, and the consolidated negative result follow once the final two cross-examinations
are filed.*

Source material, all committed:

| Round | Document |
|---|---|
| 1 | `adversarial-data-qa-2026-08-14-seat1.md` — persistence and the wire format |
| 1 | `adversarial-data-qa-2026-08-14-seat2.md` — the catalog against the scrape |
| 1 | `adversarial-data-qa-2026-08-14-seat3.md` — rules, caps, and the generator |
| 1 | `adversarial-data-qa-2026-08-14-seat4.md` — the hunter roster and assets |
| 1 | `adversarial-data-qa-2026-08-14-seat5.md` — presentation, prose, ADR conformance |
| 2 | `adversarial-data-qa-2026-08-14-round2-challenge-of-seat1.md` |
| 2 | `adversarial-data-qa-2026-08-14-round2-challenge-of-seat2.md` |
| 2 | `adversarial-data-qa-2026-08-14-round2-challenge-of-seat3.md` |
| 2 | `adversarial-data-qa-2026-08-14-round2-challenge-of-seat4.md` |
| 2 | `adversarial-data-qa-2026-08-14-round2-challenge-of-seat5.md` |
