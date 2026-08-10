---
status: approved
date: 2026-08-10
implements: [ADR-0007]
---

# SPEC-0004: Hunter Roster Dataset

## Overview

Produces the hunter dataset and portrait assets that SPEC-0003's loadout lists consume. A single offline, human-invoked scrape visits each hunter page on huntshowdown.wiki.gg once and emits both payloads: a generated `client/src/data/hunters.json` and two self-hosted portrait sizes per hunter.

This spec covers **production**. SPEC-0003 already specifies **consumption** — the fallback chain, the tolerance for missing assets, and the placeholder behaviour — and this spec must satisfy the contract stated there.

See ADR-0007 for the decision record, including why this is one script rather than the images/stats split ADR-0005 established.

## Requirements

### Requirement: Offline, Human-Invoked Scrape

The scrape SHALL be a standalone script invoked deliberately by a human. It MUST NOT be referenced by `npm run build`, `npm run dev`, `npm start`, or any CI configuration. Running the application, its dev server, or its build MUST NOT issue any request to huntshowdown.wiki.gg.

The script SHALL respect `robots.txt`, aborting the whole run if `robots.txt` cannot be fetched or parsed rather than assuming it is permissive. It SHALL rate-limit every request to the wiki, and SHALL identify itself with the project's user agent.

The script SHALL import slug derivation, robots handling, rate limiting, the user agent, and the sentinel error classes from the shared wiki client rather than defining its own copies.

#### Scenario: The application never contacts the wiki

- **WHEN** the built application is served and a user renders a list with a portrait
- **THEN** no request SHALL be issued to huntshowdown.wiki.gg, and the image SHALL be served from the application's own origin

#### Scenario: robots.txt is unreachable

- **WHEN** the scrape cannot fetch or parse `robots.txt`
- **THEN** the run SHALL abort before fetching any hunter page, rather than proceeding as though fetching were permitted

#### Scenario: The scrape reuses the shared wiki client

- **WHEN** the scrape script is inspected
- **THEN** it SHALL import slug derivation, robots handling, rate limiting, the user agent, and the sentinel errors from the shared module, and SHALL NOT define its own

### Requirement: One Visit Per Hunter Page Yields Both Payloads

The scrape SHALL fetch each hunter's page at most once per run and derive both the dataset entry and the portrait assets from that single response.

#### Scenario: A full run fetches each page once

- **WHEN** a full scrape runs across the roster
- **THEN** each hunter page SHALL be requested at most once, and both the dataset row and the portraits for that hunter SHALL be produced from that response

### Requirement: Generated, Committed Dataset File

The scrape SHALL write `client/src/data/hunters.json`, committed to the repository and imported at build time. It MUST NOT be hand-edited.

Each entry SHALL carry: a stable `id`, a `name` for display, a `description`, a `portrait` slug, the `sourceRevision` the entry was derived from, and an `ingestedAt` timestamp.

Each entry SHALL additionally carry the classification the picker filters on:

- `source` — the wiki's own `Source` field, stored **verbatim** (e.g. `"Meridian Turncoat DLC"`)
- `acquisition` — a normalised value derived from it, one of: `free`, `hunt-dollars`, `soul-survivor`, `dark-tribute`, `blood-bonds`, `dlc`, `event`, `mythic`, `story-challenge`, `twitch-drop`, `bloodline`, `prestige`, `progression`
- `obtainable` — whether the hunter can still be acquired

Both the raw and normalised forms are stored deliberately. `acquisition` is derived and can therefore be wrong; `source` is what the wiki asserts and cannot be. Keeping both means a miscategorisation is fixed by re-deriving from data already on disk rather than by re-scraping every page — the same reasoning ADR-0007 applies to revision provenance.

`obtainable` is a separate field rather than an inference from `acquisition`, because "how was this obtained" and "can I still get it" are different questions: Mythic hunters are permanently unobtainable, and event and Twitch-drop hunters may or may not be, depending on whether that event returns.

An entry whose `Source` cannot be parsed SHALL still be written, with `source` captured verbatim and `acquisition` null, rather than being dropped from the roster.

Ids SHALL be produced by the shared slug derivation, so that re-running the scrape never re-keys an existing hunter.

The dataset SHALL cover the full roster the wiki lists, not a subset.

#### Scenario: Every entry carries provenance

- **WHEN** `hunters.json` is inspected after a scrape
- **THEN** every entry SHALL have a non-empty `sourceRevision` and `ingestedAt`, and the recorded revision SHALL match what the wiki reports for that page

#### Scenario: Re-running the scrape does not re-key hunters

- **WHEN** the scrape is run twice against an unchanged roster
- **THEN** every entry's `id` SHALL be identical between runs, so stored `hunterId` references in user data stay valid

#### Scenario: A renamed hunter keeps its id

- **WHEN** a hunter's wiki page title changes between runs
- **THEN** the entry SHALL keep its original `id` and update only its `name`

#### Scenario: Classification is captured raw and normalised

- **WHEN** a hunter's page carries `Source: "Meridian Turncoat DLC"`
- **THEN** the entry SHALL store that string verbatim in `source` and `dlc` in `acquisition`

#### Scenario: An unparseable Source does not drop the hunter

- **WHEN** a hunter's `Source` cannot be mapped to a known acquisition value
- **THEN** the entry SHALL still be written with `source` verbatim and `acquisition` null, so the hunter remains selectable

### Requirement: Two Portrait Sizes Per Hunter

The scrape SHALL emit two self-hosted portrait assets per hunter under `client/public/images/hunters/`: a thumbnail at **192px** wide and a full size at **320px** wide, each preserving the source aspect ratio.

Both sizes SHALL be downscaled and re-encoded from the wiki original rather than stored as served. Portraits SHALL be encoded as **AVIF**.

Both dimensions are derived from what actually renders, at 2× for high-DPI displays. The largest place a portrait appears is a 154×220 list card, which needs 308px wide; 320px gives modest headroom. Picker tiles are 96px, needing 192px. Storing detail beyond what any surface displays costs bytes across the whole roster and buys nothing — a full size at 440px wide would carry roughly twice the pixels of anything on screen.

A source image narrower than a target width SHALL NOT be upscaled; it SHALL be re-encoded at its native width.

#### Scenario: Both sizes are produced

- **WHEN** a hunter with an available portrait is scraped
- **THEN** both a 192px-wide and a 320px-wide AVIF SHALL be written for that hunter

#### Scenario: The thumbnail is materially smaller

- **WHEN** both sizes for a hunter are compared
- **THEN** the thumbnail SHALL be smaller in bytes than the full size — a byte assertion, not merely a differing filename

#### Scenario: Small sources are not upscaled

- **WHEN** a source portrait is narrower than 320px
- **THEN** the full-size asset SHALL be written at the source's native width rather than upscaled

#### Scenario: The full size stays crisp at the largest render

- **WHEN** the full size is displayed on the 154×220 list card on a 2× display
- **THEN** the asset SHALL be at least as wide as the rendered CSS width doubled, so it is not upscaled by the browser

### Requirement: Portrait Payload Budget

Portraits are the heaviest assets this application ships. The roster is **242 hunters**, so a per-asset budget alone is not a budget — it is a per-asset budget multiplied by the roster.

**Per asset:** the thumbnail SHALL be at most **15 KB** and the full size at most **25 KB**.

**In total:** the committed portrait payload SHALL NOT exceed **12 MB** across all hunters and both sizes.

These follow from the dimensions and encoder above rather than being chosen independently: a 192px AVIF photograph and a 320px one are comfortably inside those figures at good quality. Measurement against the committed set bears that out with room to spare — the largest thumbnail is 6.7 KB and the largest full size 14.9 KB, and the whole payload is 2.91 MB against the 12 MB ceiling. The budgets are retained at their original figures rather than tightened to what was measured, so that re-scrapes and roster growth have headroom before they hit a spec edit.

A generated asset exceeding its per-asset budget SHALL fail that hunter with a recorded reason rather than being written. A run whose output would exceed the total ceiling SHALL fail with the projected total and the ceiling, rather than writing a partial set that silently breaches it.

Both are enforced by failing, not warning. An oversized asset is invisible in review — a reviewer sees a filename, not a byte count — and a total overage is invisible in any single file.

#### Scenario: An oversized asset is rejected, not written

- **WHEN** encoding produces a thumbnail above 15 KB or a full size above 25 KB
- **THEN** that hunter SHALL be recorded as failed with the measured size and the budget, and the oversized file SHALL NOT be written

#### Scenario: A run exceeding the total ceiling fails

- **WHEN** the projected total across all hunters and both sizes would exceed 12 MB
- **THEN** the run SHALL fail, reporting the projected total and the ceiling, rather than committing a partial set

#### Scenario: The committed set is within budget

- **WHEN** the committed portrait assets are measured
- **THEN** every thumbnail SHALL be at most 15 KB, every full size at most 25 KB, and the total at most 12 MB

### Requirement: Consumption Contract Compatibility

The dataset and assets SHALL satisfy the contract SPEC-0003 states for consumers. Asset paths SHALL be derivable from the entry's `portrait` slug without a lookup manifest, so the scrape can add or replace assets with no code change at the render site.

The dataset MUST remain usable when a hunter has no portrait at all, and consumers MUST NOT be required to coalesce a missing field: absent imagery SHALL be representable in the dataset rather than implied by a missing file alone.

#### Scenario: A hunter with no available portrait still appears

- **WHEN** a hunter page exists but yields no usable portrait
- **THEN** the hunter SHALL still appear in `hunters.json` with its id, name and description, so it remains selectable and renders SPEC-0003's placeholder

#### Scenario: Asset paths are derivable

- **WHEN** a consumer holds a dataset entry
- **THEN** it SHALL be able to construct both asset URLs from the entry's `portrait` slug and the known size names, without consulting a separate manifest

### Requirement: Names-Only Mode

The scrape SHALL support producing the dataset without portrait assets, so the roster can land before any image processing runs. SPEC-0003's sequencing depends on this: the picker needs names, not art.

#### Scenario: Names-only run writes no images

- **WHEN** the scrape is run in names-only mode
- **THEN** `hunters.json` SHALL be written in full, and no file SHALL be created under `client/public/images/hunters/`

#### Scenario: A later full run adds art without disturbing the dataset

- **WHEN** a full scrape runs after a names-only run
- **THEN** existing entries SHALL keep their ids, and portrait assets SHALL be added

### Requirement: Error Handling Standards

All error-producing operations MUST follow structured error handling:

- Errors MUST be wrapped with contextual information at each layer boundary, naming the hunter, the URL, and the reason
- Sentinel errors MUST distinguish the failure modes callers need to tell apart — at minimum: hunter page not found, portrait asset not found on an existing page, network or rate-limit failure, robots disallowed, and budget exceeded
- A single hunter's failure MUST NOT abort the run; it MUST be recorded in a structured per-run summary of succeeded, failed, and skipped, each with a reason
- Silent error swallowing MUST NOT occur
- Structured logging MUST be used, with key-value fields rather than string interpolation

#### Scenario: One hunter's failure does not end the run

- **WHEN** a single hunter's page returns 404 mid-run
- **THEN** the run SHALL continue to the remaining hunters, and the summary SHALL record that hunter as failed with its URL and reason

#### Scenario: Failure modes are distinguishable

- **WHEN** a portrait is missing from an existing page, versus the page itself being absent
- **THEN** the two SHALL be represented by distinct sentinel errors rather than a shared generic failure

### Requirement: Image Processing Dependency Is Development-Only

The image-processing library SHALL be declared as a development dependency. It MUST NOT be imported by any module reachable from the application entry point or the production build.

#### Scenario: The library never reaches the bundle

- **WHEN** the client production build is inspected
- **THEN** the image-processing library SHALL NOT appear in the output, and the built bundle size SHALL be unchanged by its presence in the repository

#### Scenario: Names-only mode runs without it

- **WHEN** the scrape runs in names-only mode
- **THEN** it SHALL complete successfully whether or not the image-processing library is installed
