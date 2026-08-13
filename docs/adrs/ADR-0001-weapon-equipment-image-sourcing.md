---
status: superseded
date: 2026-08-07
decision-makers: [jmstump]
---

# ADR-0001: Source Weapon/Equipment Images as In-House Schematic Icons, Not Scraped Wiki Assets

> **Superseded in full by [ADR-0002](ADR-0002-scrape-huntshowdown-wiki-for-images.md)** (2026-08-07), which sources item imagery from a bounded, self-hosted scrape of huntshowdown.wiki.gg and demotes the in-house SVG silhouettes to a fallback tier. The machine-readable edge lives on ADR-0002 as `supersedes: [ADR-0001]`, which is this repo's convention; this line is the human one, so a reader landing here has somewhere to go. The decision below is kept as the record of what was decided and why it changed — see ADR-0002's Context for the reversal.

## Context and Problem Statement

The Outfitter is a fan-made Hunt: Showdown loadout planner ("Not affiliated with Crytek," per the app's own footer). Today, only the Weapons picker renders any imagery — a small set of hand-authored schematic SVG silhouettes (`THUMBS` in `client/src/data/catalog.js`, dispatched by `weaponThumb()`) grouped by weapon class (pistol/carbine/rifle/shotgun/melee/bow/crossbow). Tools, Traits, and Consumables currently render with no imagery at all — just name, category badge, and cost.

The request that prompted this ADR was to "grab actual images for weapons, tools, traits, and consumables ... from https://huntshowdown.wiki.gg/" — i.e., replace/extend the current placeholder icons with real, recognizable game art scraped from a third-party fan wiki. How should item imagery actually be sourced, given that this is an unaffiliated fan tool with no license to Crytek's IP?

## Decision Drivers

* Hunt: Showdown's weapon, tool, trait, and consumable art is Crytek's copyrighted IP; this app has no license to redistribute it, and its own footer already disclaims affiliation
* huntshowdown.wiki.gg is a third-party site with its own Terms of Service; bulk scraping/mirroring or sustained hotlinking of its assets is a separate legal/ToS concern from the underlying game-asset copyright
* Coverage gap: Tools, Traits, and Consumables currently have zero imagery, not just "placeholder" imagery — any sourcing decision should close that gap, not just weapons
* New DLC weapons/items ship on a regular cadence; whatever sourcing approach is chosen has to be maintainable as the catalog grows, not a one-time scrape
* The app already has an established visual language (dark frontier/ledger theme, `THUMBS` schematic silhouettes) that a sourcing choice should stay consistent with
* Asset size/performance and offline reliability — the app currently ships with zero image network requests (inline SVG paths only)

## Considered Options

* Keep and extend the current in-house schematic SVG icon approach to cover Tools, Traits, and Consumables
* Scrape huntshowdown.wiki.gg and self-host the downloaded images as static assets
* Hotlink `<img>` tags directly at huntshowdown.wiki.gg's asset URLs (no local copy)
* Commission or hand-produce original licensed icon/illustration art

## Decision Outcome

Chosen option: "Keep and extend the current in-house schematic SVG icon approach," because it is the only option with zero copyright/ToS exposure, it requires no new runtime dependency on a third party the app doesn't control, and it's a straightforward extension of a pattern (`THUMBS` + a per-class dispatch function) that's already proven out for Weapons. The real gap this ADR closes isn't "our icons aren't real enough," it's "Tools, Traits, and Consumables have no icons at all" — that's solvable with the same low-risk approach already in place.

### Consequences

* Good, because there is no copyright or third-party-ToS exposure to manage or revisit later
* Good, because it keeps the app's zero-image-network-request footprint (fast load, works offline, nothing to cache-bust)
* Good, because it's consistent with the existing footer disclaimer ("schematic silhouettes, not game assets") — that language stays true instead of becoming stale/misleading
* Good, because new items just need a new class bucket or a new path constant — no scraping pipeline to run and re-run as DLC ships
* Bad, because schematic icons are inherently less recognizable than real weapon/item art — some users will want to visually identify the actual Nagant M1895 or First Aid Kit
* Bad, because Tools, Traits, and Consumables need genuinely new icon sets designed (not just a class-dispatch reuse like weapons) — this is real authoring work, not a config change
* Bad, because it forecloses "looks like the real game" as a differentiator versus other community loadout tools that do embed real art

### Confirmation

* No code in this repository fetches, scrapes, or bundles assets from huntshowdown.wiki.gg (or any other third-party asset host) — enforced by code review, not automated tooling
* Every new catalog entry (weapon, tool, trait, or consumable) that ships with a visual treatment uses an in-house SVG path/icon, following the `THUMBS`/`weaponThumb()` pattern in `client/src/data/catalog.js`
* The app footer's "schematic silhouettes, not game assets" disclaimer remains accurate as Tools/Traits/Consumables gain icons

## Pros and Cons of the Options

### Keep and extend the in-house schematic SVG icon approach

Add `TOOL_THUMBS` / `TRAIT_THUMBS` / `CONS_THUMBS` (or a shared per-category icon set) alongside the existing `THUMBS` weapon silhouettes, rendered the same way (`<svg><path d="..."/></svg>`) in `EquipmentSlot.jsx`, `TraitsPanel.jsx`, and `PickerRow.jsx`.

* Good, because zero legal/ToS risk
* Good, because zero new runtime dependencies or network calls
* Good, because it matches the app's existing dark-frontier aesthetic instead of clashing with a scraped wiki's own art style/cropping
* Neutral, because it requires real (if modest) icon-design effort for ~87 new items across Tools/Traits/Consumables
* Bad, because it will never be as visually authentic as real game screenshots/renders

### Scrape and self-host images from huntshowdown.wiki.gg

Write a one-time (or periodic) scraper that downloads item images from the wiki and commits them under e.g. `client/public/images/`, served from the app's own origin.

* Good, because images are authentic and immediately recognizable
* Good, because self-hosting avoids depending on the wiki's uptime/hotlink policy at request time
* Bad, because the underlying art is Crytek's copyrighted game assets — the wiki hosting them (often under a general fan-wiki CC license for *text*) does not grant redistribution rights over the *images*, which remain the publisher's IP
* Bad, because bulk scraping likely violates huntshowdown.wiki.gg's own Terms of Service independent of the copyright question
* Bad, because it's an ongoing maintenance burden — new DLC weapons/items require re-running the scraper and re-mapping ~100+ entries to image URLs that can change without notice
* Bad, because it undercuts the app's own "fan-made ... not affiliated with Crytek" disclaimer by shipping the publisher's actual art

### Hotlink images directly at huntshowdown.wiki.gg

Render `<img src="https://huntshowdown.wiki.gg/...">` pointing straight at the wiki's hosted assets, with no local copy.

* Good, because no storage/repo bloat and no scraping script to maintain
* Bad, because it carries the same underlying copyright exposure as self-hosting, plus it also costs the wiki's own bandwidth without their consent
* Bad, because most wiki.gg sites actively block hotlinking via referrer checks — this can break silently and without warning
* Bad, because rendering becomes dependent on a third party's uptime and URL stability, with no offline fallback

### Commission or hand-produce original licensed art

Pay an illustrator (or draw in-house) a polished icon or portrait for every catalog item.

* Good, because it can be both authentic-feeling and fully licensed/owned by the project
* Good, because visual quality could exceed both the schematic silhouettes and quick wiki scrapes
* Bad, because it's the most expensive and slowest option, and doesn't scale to "new DLC ships, need art same week"
* Bad, because for a free fan tool, ongoing commissioned-art cost is a hard sell against a $0-cost in-house SVG approach

## More Information

The app's footer already states: "Weapon images are schematic silhouettes, not game assets. Not affiliated with Crytek." This ADR extends that same posture to Tools, Traits, and Consumables rather than reversing it. If the project's affiliation or licensing situation changes in the future (e.g., an actual partnership or asset license from Crytek), this decision should be revisited via a new ADR rather than amended in place.
