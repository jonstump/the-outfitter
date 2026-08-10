---
status: approved
date: 2026-08-10
implements: [ADR-0007]
---

# SPEC-0004: Hunter Roster Dataset

## Overview

Produces the hunter dataset and portrait assets that SPEC-0003's loadout lists consume. A single offline, human-invoked scrape visits each hunter page on huntshowdown.wiki.gg once and emits both payloads: a generated `client/src/data/hunters.json` and one self-hosted portrait per hunter.

This spec covers **production**. SPEC-0003 specifies **consumption** — the fallback chain, the tolerance for missing assets, and the placeholder behaviour — and this spec SHALL satisfy that contract as amended on 2026-08-10. Where the amendment changes what consumers do, SPEC-0003 is amended in the same commit rather than overridden from here.

See ADR-0007 for the decision record, including why this is one script rather than the images/stats split ADR-0005 established.

**Amended 2026-08-10 — one trimmed portrait, not two sizes.** The two-size pipeline this spec originally required has been replaced, per the ADR-0007 amendment of the same date. Measurement showed the wiki original is 384×256 with an alpha channel and the hunter occupies only about 54% of that width — the pipeline was spending its budget and its resolution on transparent padding. Trimming to the subject makes a single native-resolution asset large enough for every surface except the list card, and for the picker tile in height with a bounded 1.09× shortfall in width on the 51 narrowest hunters, so the second size stopped earning its place. The re-scrape ran in #147, so the committed assets **are** the new pipeline: 242 trimmed portraits, no `-thumb` variants, 2.49 MB total against a 12 MB ceiling. One consumption-side clause remains outstanding (#148), and is marked where it appears.

**Amended again 2026-08-10 — the trim threshold is 8, not zero.** QA of #147's output found 21 of the 242 assets barely trimmed at all: their sources carry an invisible alpha wash that a `> 0` threshold counts as subject, so those hunters render visibly smaller than the rest wherever `object-fit: cover` fits a portrait to a box. The threshold clause under "One Trimmed Portrait Per Hunter" carries the measurement and the reasoning. **The committed assets are NOT yet this pipeline** — the code and this spec are, and a `node scripts/scrape-hunters.mjs --force` run is what reconciles disk to both. The width figures in the surface table are projections until then, and are marked as such.

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

The scrape SHALL fetch each hunter's page at most once per run and derive both the dataset entry and the portrait asset from that single response.

#### Scenario: A full run fetches each page once

- **WHEN** a full scrape runs across the roster
- **THEN** each hunter page SHALL be requested at most once, and both the dataset row and the portrait for that hunter SHALL be produced from that response

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

### Requirement: One Trimmed Portrait Per Hunter

*(amended 2026-08-10; implemented in #147 — replaces "Two Portrait Sizes Per Hunter")*

The scrape SHALL emit exactly **one** self-hosted portrait asset per hunter under `client/public/images/hunters/`. It MUST NOT emit a second size.

Before encoding, the scrape SHALL **trim the source to the subject's bounding box**. The bounding box SHALL be the smallest rectangle containing every pixel whose alpha is **greater than or equal to 8**, of 255. Pixels below that value are margin.

The threshold SHALL be this fixed value rather than the image library's default, so that two conforming implementations produce identical dimensions. It SHALL NOT be zero.

> **Amended 2026-08-10 (trim threshold) — the threshold was zero, and zero was wrong.** The original rule took "not fully transparent" to mean "subject". That holds for most of the roster and fails badly for the rest. Measured across all 242 committed assets: **21 sources carry a near-invisible alpha wash across nearly the whole 384×256 canvas**, at alpha 1–3 (one reaches 7). Every such pixel is greater than zero, so the bounding box expanded to almost the full canvas and the trim became a no-op. Those assets committed at **322–333px wide against a ~207px median — 30–46% dead space by width**. Because every surface renders portraits with `object-fit: cover` into a fixed box, dead space eats the frame and the hunter is drawn visibly smaller than his neighbours in the picker. The defect was *specified*, not mis-coded: the pipeline conformed to this clause exactly.
>
> The zero-threshold reasoning is retained in halves. Its second half stands — the box is still computed from raw pixels rather than delegated to a library trim whose threshold is a heuristic and whose background is inferred from the top-left pixel. Its first half does not: an antialiased edge pixel is only subject if it is *visible*, and 8/255 is 3.1% opacity, below which nothing renders that a reader could see. An explicit number is still a definition; only the constant changed.
>
> The affected 21 skew to progression variants (10 of the 21 are `-rookie` or `-survivor`), which points at a wiki-side export batch rather than anything the scrape controls.

Conformance to this clause SHALL be asserted against **fixtures whose alpha values are exact**, not against re-decoded committed assets. Lossy AVIF alpha at quality 70 introduces block-boundary ringing of a few pixels at values near the threshold — measured on the committed set as isolated 5-pixel runs at exactly alpha 8, far from any subject — so a re-decoded asset can fail a threshold check its source would pass. This is the same reasoning as the clause below on transparent borders: assert the property the pipeline controls.

The trimmed subject SHALL then be encoded at its **native trimmed resolution**: neither downscaled nor upscaled.

**The trim is asserted against the rectangle selected for encoding, not against the decoded output** *(clarified 2026-08-10)*. Lossy AVIF alpha can zero an edge band after a correct trim — measured at 26 of 242 assets at quality 70 — so an emitted asset MAY decode with a fully transparent border row or column even though the trim was exact. Conformance tests SHALL therefore assert the selected bounding box, and MUST NOT assert the absence of transparent borders in the decoded asset. Requiring the latter would oblige either lossless alpha or a quality setting chosen to satisfy a test rather than the eye, for no visible benefit: a transparent edge row renders identically to the margin it replaced.

Portraits SHALL be encoded as **AVIF at quality 70**, and the encoding SHALL preserve the source's alpha channel so a portrait composites onto the page background rather than carrying an opaque box. The quality value is normative because the per-asset budget below is derived from it; changing it is a spec edit.

Two source shapes fall outside the trim and SHALL be handled explicitly rather than left to the image library:

- A source with **no alpha channel** SHALL be encoded untrimmed at its native resolution rather than failing. There is no transparent margin to remove, and the hunter still needs a portrait.
- A source with **no pixel at or above the trim threshold** has no visible subject and therefore no bounding box. It SHALL fail that hunter with a distinct sentinel error and SHALL NOT be written. *(Widened 2026-08-10 with the trim threshold; this previously read "alpha is zero at every pixel".)* A source consisting only of the sub-threshold wash renders as nothing, exactly as a blank one does, so it is unusable for the same reason. Under the zero threshold such a source would have **succeeded**, emitting a full-canvas asset of empty space — a portrait of nothing, sized like a portrait of something. The error's reason SHALL name the threshold, so a maintainer can tell an all-transparent source from a wash-only one without re-fetching it.

Because each hunter's subject occupies a different region of the source, the emitted assets SHALL vary in both dimensions and aspect ratio between hunters. Consuming code MUST NOT assume a uniform portrait aspect.

Trimming rather than downscaling is what makes one asset sufficient. Every stored pixel is subject rather than padding, so the single asset covers what each surface needs at 2×, measured across the roster:

| Surface | Needs at 2× | Trimmed subject provides |
|---|---|---|
| Picker tile (96px square) | 192×192 | 204–256 tall for all 242; **176–270 wide, so 61 fall short on width** and upscale by at most 1.09× |
| Expanded list header (52×68) | 104×136 | clears both dimensions for every hunter |
| List card (154×220) | 308×440 | **no hunter reaches it — see the next requirement** |

The scrape MUST NOT upscale a subject to meet any of these figures. Where the source cannot supply what a surface wants, the shortfall SHALL be accepted as a source-resolution limit rather than manufactured. The 1.09× worst case on a narrow tile is recorded rather than hidden: it is an improvement on the 1.5× every hunter is upscaled by today, but it is not zero, and a requirement claiming otherwise would be false.

*(figures corrected 2026-08-10 after the first real run: this table originally read 178–334 wide and 1.08×, derived by scaling the committed 320px assets rather than measuring the 384px originals. The true floor is 176px — `the-rednecks-daughter` and `wight-raven` — giving 192/176 = 1.09×. The bound was wrong by two pixels of source width, and the run that produced conforming assets was failed by it.)*

*(width figures revised again 2026-08-10 with the trim threshold, and **these are projections until the re-scrape lands**. They are computed from the visible-subject box of each committed asset — the box the corrected threshold selects — rather than from a completed run, because the run requires wiki access. Two of the three numbers move and the third deliberately does not: the **upper** bound falls 333 → 270, because that tail was the untrimmed wash rather than genuinely wide hunters. The count falling short on width rises **51 → 61**, since ten of the repaired assets are narrower than 192 once their padding is gone. The worst case stays **1.09×** — the 176px floor is set by hunters whose trim was always correct, so the ceiling on the damage does not move. The rise from 51 to 61 is not a regression: those ten were only clearing 192px on the strength of invisible padding, so the old pass was false. Height is unaffected at 204–256, and all 242 still clear 192px in height. The run SHALL replace these projections with measured figures.)*

**Stale size variants SHALL be removed.** The scrape SHALL delete any previously emitted asset for a hunter that does not match the current single-asset path, so that a run leaves no orphaned size variant behind, and SHALL report the count of stale assets removed. Without this the 242 `-thumb` assets already committed would survive every future run, and the disk-state and payload scenarios below could never pass.

#### Scenario: One asset per hunter, trimmed to the subject

- **WHEN** a hunter with an available portrait is scraped
- **THEN** exactly one AVIF SHALL be written for that hunter, its dimensions SHALL equal the source's trimmed subject bounding box, and no second size SHALL exist on disk

#### Scenario: Transparent margin is removed

- **WHEN** a source portrait carries fully transparent margin around the subject
- **THEN** the emitted asset SHALL be no larger than the source in either dimension, SHALL be strictly smaller in every dimension that carried margin, and the rectangle selected for encoding SHALL contain no fully transparent border row or column

#### Scenario: An invisible alpha wash does not defeat the trim

*(added 2026-08-10 with the trim threshold — this is the regression the threshold exists to prevent, and it reached the committed set)*

- **WHEN** a source portrait carries a margin whose alpha is above zero but below the trim threshold, covering any part of the canvas up to and including all of it
- **THEN** that margin SHALL be treated as margin and removed, and the rectangle selected for encoding SHALL be the subject's bounding box rather than the source canvas

#### Scenario: A visible edge pixel is not shaved

- **WHEN** a source portrait carries a pixel at or above the trim threshold outside the subject's solid body
- **THEN** that pixel SHALL be treated as subject and the rectangle selected for encoding SHALL contain it, so a faint but visible silhouette edge is never discarded

#### Scenario: Alpha survives encoding

- **WHEN** a source portrait has an alpha channel
- **THEN** the emitted AVIF SHALL retain it, so the portrait composites onto the page background rather than onto an opaque rectangle

#### Scenario: A source with no alpha channel is still emitted

- **WHEN** a source portrait has no alpha channel
- **THEN** it SHALL be encoded untrimmed at its native resolution, and the hunter SHALL NOT be failed on that basis

#### Scenario: A source with no visible subject fails its hunter

*(widened 2026-08-10 with the trim threshold — this previously read "alpha is zero at every pixel")*

- **WHEN** no pixel of a source portrait reaches the trim threshold, whether because its alpha is zero everywhere or because it carries only the sub-threshold wash
- **THEN** that hunter SHALL be failed with a distinct sentinel error whose reason names the threshold, and no asset SHALL be written

#### Scenario: Stale size variants are removed

- **WHEN** the scrape runs against a directory containing assets from the previous two-size pipeline
- **THEN** every stale variant SHALL be deleted, the run SHALL report how many were removed, and only one asset per hunter SHALL remain

#### Scenario: The scrape never upscales a subject

- **WHEN** a trimmed subject is smaller than what a rendering surface would need at 2×
- **THEN** the asset SHALL be written at its native trimmed size rather than upscaled, and the run SHALL NOT fail on that basis

#### Scenario: Aspect ratio varies between hunters

- **WHEN** the emitted assets across the roster are compared
- **THEN** their widths, heights and aspect ratios SHALL differ between hunters, and nothing in the pipeline SHALL pad them back to a common shape

### Requirement: The List Card Is Knowingly Upscaled

*(added 2026-08-10; implemented in #147)*

The 154×220 list card SPEC-0003 renders needs **440px of subject height** at 2×. The wiki supplies at most 256px, and after trimming, subjects are 204–256px tall — **no hunter in the roster reaches it.**

The scrape MUST NOT upscale a trimmed subject to reach the card's requirement, because upscaling manufactures pixels without adding detail while multiplying the committed payload.

The card is therefore rendered at roughly **1.9× upscale**. This SHALL be treated as a **source-resolution ceiling rather than a pipeline defect**, and SPEC-0003's "Hunter Dataset Consumption Contract" records the same ceiling on the consuming side so that a reader of either spec finds it. Closing it would require rendering the card's portrait area at 113px tall or less, which is a change to SPEC-0003's card design and is out of scope here.

#### Scenario: The ceiling is not closed by upscaling

- **WHEN** the scrape produces a portrait for a hunter whose trimmed subject is shorter than 440px
- **THEN** the asset SHALL be written at native size, and the scrape MUST NOT upscale it to satisfy the card

#### Scenario: The expanded list header is served without upscaling

- **WHEN** the emitted portrait is rendered in the 52×68 expanded list header
- **THEN** the asset SHALL exceed what that surface requires at 2× in both dimensions for every hunter, so the browser does not upscale it

#### Scenario: The picker tile's residual upscale is bounded

- **WHEN** the emitted portrait is rendered in a 96px square picker tile
- **THEN** the asset SHALL clear the required 192px in height for every hunter, and a hunter whose trimmed width falls below 192px SHALL be upscaled by no more than 1.09× rather than by an unbounded amount

### Requirement: Portrait Payload Budget

Portraits are the heaviest assets this application ships. The roster is **242 hunters**, so a per-asset budget alone is not a budget — it is a per-asset budget multiplied by the roster.

*(amended 2026-08-10; implemented in #147 — the per-size ceilings are replaced by a single per-asset ceiling, since there is now one asset per hunter)*

**Per asset:** a hunter's portrait SHALL be at most **25 KB**.

**In total:** the committed portrait payload SHALL NOT exceed **12 MB** across all hunters.

Both figures are retained from the two-size pipeline deliberately. Trimming raises the per-asset size — the asset is now all subject, where before it was around 46% transparent padding — but removes the second file entirely. Sampled encodes at AVIF quality 70 land at a mean of 10.1 KB and a maximum of 13.3 KB, projecting **~2.39 MB across the roster against the 12 MB ceiling**, which is *below* the 2.91 MB the two-size padded set occupies today. Keeping the ceilings unchanged leaves headroom for roster growth before a number becomes a spec edit.

The 15 KB thumbnail ceiling SHALL NOT apply to the single asset, and is **removed** rather than reassigned. It described an asset class that no longer exists, and retaining it against the single asset would fail hunters whose trimmed subject legitimately encodes above it.

A generated asset exceeding the per-asset budget SHALL fail that hunter with a recorded reason rather than being written. A run whose output would exceed the total ceiling SHALL fail with the projected total and the ceiling, rather than writing a partial set that silently breaches it.

Both are enforced by failing, not warning. An oversized asset is invisible in review — a reviewer sees a filename, not a byte count — and a total overage is invisible in any single file.

#### Scenario: An oversized asset is rejected, not written

- **WHEN** encoding produces a portrait above 25 KB
- **THEN** that hunter SHALL be recorded as failed with the measured size and the budget, and the oversized file SHALL NOT be written

#### Scenario: A run exceeding the total ceiling fails

- **WHEN** the projected total across all hunters would exceed 12 MB
- **THEN** the run SHALL fail, reporting the projected total and the ceiling, rather than committing a partial set

#### Scenario: The committed set is within budget

- **WHEN** the committed portrait assets are measured
- **THEN** every portrait SHALL be at most 25 KB and the total SHALL be at most 12 MB

### Requirement: Consumption Contract Compatibility

The dataset and assets SHALL satisfy the contract SPEC-0003 states for consumers. Asset paths SHALL be derivable from the entry's `portrait` slug without a lookup manifest, so the scrape can add or replace assets with no code change at the render site.

*(amended 2026-08-10; production half implemented in #147, consumption half outstanding — #148)* With one asset per hunter, the path SHALL be derivable from the `portrait` slug **alone**, and MUST NOT contain a size segment. The scrape emits exactly that; the scenario below requiring consumers to stop selecting a size is what #148 delivers. SPEC-0003's cross-size fallback ordering has been amended in step: its ladder is now the portrait, then SPEC-0001's placeholder. That change is made in SPEC-0003 itself — this requirement states the production-side property, not a repeal of another spec's text.

The dataset MUST remain usable when a hunter has no portrait at all, and consumers MUST NOT be required to coalesce a missing field: absent imagery SHALL be representable in the dataset rather than implied by a missing file alone.

#### Scenario: A hunter with no available portrait still appears

- **WHEN** a hunter page exists but yields no usable portrait
- **THEN** the hunter SHALL still appear in `hunters.json` with its id, name and description, so it remains selectable and renders SPEC-0003's placeholder

#### Scenario: Asset paths are derivable

- **WHEN** a consumer holds a dataset entry
- **THEN** it SHALL be able to construct the asset URL from the entry's `portrait` slug alone, without a size segment and without consulting a separate manifest

#### Scenario: Consumers no longer choose a size

- **WHEN** a consumer renders a hunter portrait in any surface
- **THEN** it SHALL request the single asset, and no code path SHALL select between a thumbnail and a full size

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
- Sentinel errors MUST distinguish the failure modes callers need to tell apart — at minimum: hunter page not found, portrait asset not found on an existing page, **portrait source unusable** (no pixel reaches the trim threshold, so no subject bounding box exists), network or rate-limit failure, robots disallowed, and budget exceeded

*(the unusable-source sentinel was added 2026-08-10 alongside the trimming requirement, which requires that condition to fail with a distinct sentinel; it is listed here so the two requirements agree)*

An unusable source is deliberately **not** folded into "portrait asset not found". The asset was found and fetched; it simply carries no subject to trim to. Collapsing the two would tell a maintainer the wiki is missing art when in fact the art is present and the pipeline cannot use it, which points at entirely different remedies.
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
