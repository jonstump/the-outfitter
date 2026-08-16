---
status: implemented
date: 2026-08-10
implements: [ADR-0005, ADR-0013, ADR-0015]
requires: [SPEC-0001]
---

# SPEC-0007: Equipment Catalog Dataset

## Overview

Realizes ADR-0005: a second offline scrape, `scripts/scrape-stats.mjs`, that reads item pages on huntshowdown.wiki.gg and emits a generated, committed `client/src/data/itemStats.json` keyed by catalog `id`, alongside a bounded, reviewable write-through to the hand-authored `client/src/data/catalog.js`.

**Implementation status** *(added 2026-08-13)*. **This capability is implemented**, and the status field moved `draft` → `implemented` on the same date. `scripts/scrape-stats.mjs` exists and carries the offline scrape, the recorded provenance, the opt-in `--write-catalog` reconciliation with its per-field diff, range assertions and shrink guard, the discovery classification, the coverage report, and the unpurchasable/zero-cost evidence. `client/src/data/itemStats.json` is generated and committed. The `AMMO` wire-format gate this spec requires to be "stated in `catalog.js` beside the table" is stated there, under the heading `WIRE-FORMAT GATE — read before editing any pool below`, though it does not cite this requirement by name.

The paragraph below opens the spec's original framing and is kept for the history it carries. Read its first clause as past tense: it said **"ADR-0005 was accepted on 2026-08-09 and neither output exists"**, which was true when written and is not true now — both outputs exist. It is corrected here rather than deleted because the audits it goes on to describe are why the scraper is shaped as it is.

ADR-0005 was accepted on 2026-08-09 and neither output existed at the time this spec was written. In the meantime two reconciliation audits (`docs/audits/weapon-catalog-wiki-audit.md`, `docs/audits/equipment-catalog-wiki-audit.md`) measured what the hand-authored catalog actually contains, and ADR-0005 gained two amendments recording what they found. This spec is written against that amended decision rather than the original, because the audits changed what a correct scraper has to do: several fields turn out to be unscrapable, one turns out to be a rules input that fails silently, and page existence turns out not to imply item existence.

Scope is the four catalog categories — Weapons, Tools, Traits, Consumables — and the fields `catalog.js` already carries plus the stat block it does not. Out of scope: the hunter roster (SPEC-0004), item imagery (SPEC-0001), and the loadout rules engine itself, which this spec constrains but does not define.

The shared wiki client `scripts/lib/wiki.mjs` already exists and already carries `Implements: SPEC-0001 REQ "Ethical, Self-Hosted Image Sourcing"` and `REQ "Error Handling Standards"`. Its header records that those requirements bind every consumer of the module, which is why this spec `requires` SPEC-0001 rather than restating its posture.

## Requirements

### Requirement: Offline, Human-Invoked Stats Scrape

The stats scrape SHALL be a human-invoked script that runs offline, exactly as the image and hunter scrapes do. It MUST NOT be wired into `npm run build`, `npm run dev`, `npm start`, or any CI job, and the running application MUST NOT issue any request to huntshowdown.wiki.gg.

`scripts/scrape-stats.mjs` SHALL obtain slug derivation, robots.txt fetching and evaluation, the rate limiter, the user agent, the sentinel error classes, and catalog-to-target resolution from `scripts/lib/wiki.mjs`. It MUST NOT define a second copy of any of them. `slugify()` in particular is a hard contract with the on-disk image path and with `ItemThumb`'s URL derivation; a second implementation drifts and the failure mode is images silently not resolving.

The two scrapes SHALL remain independently runnable. A stats run MUST make no image requests and write nothing under `client/public/images/`; an image run MUST write no stat data.

#### Scenario: The application makes no wiki requests

- **WHEN** the built client and server are run
- **THEN** no request SHALL be issued to huntshowdown.wiki.gg, and a search of `client/src/` for the wiki host SHALL return only attribution text and comments

#### Scenario: There is exactly one slug derivation

- **WHEN** `scripts/` is searched for a slug-deriving function definition
- **THEN** exactly one SHALL be found, in `scripts/lib/wiki.mjs`, and both scrape scripts SHALL import it

#### Scenario: Either script runs with the other absent

- **WHEN** `scrape-stats.mjs` is run with `scrape-images.mjs` absent or failing
- **THEN** it SHALL run to completion and write no file under `client/public/images/`

### Requirement: Generated, Committed Stats File

The scrape SHALL write `client/src/data/itemStats.json`, committed to the repository and imported at build time. It MUST NOT be hand-edited.

The file SHALL be keyed by catalog `id`, and every key SHALL resolve to a real entry in `WEAPONS`, `TOOLS`, `TRAITS`, or `CONS`. Because JSON carries no comments, the file SHALL be marked as generated by a sidecar note or an in-file marker key, so its provenance is visible to a reader who opens it directly.

`catalog.js` SHALL remain hand-authored and human-readable. Generated stat data MUST NOT be interleaved into it, so that `git diff` separates "the wiki changed" from "a human changed the catalog".

The application SHALL degrade cleanly for an item with no scraped stats, in the same manner `ItemThumb` falls back to an SVG icon when no image exists. A missing stat block MUST NOT produce a rendering error or an empty stat table presented as fact.

#### Scenario: Every key names a real catalog item

- **WHEN** `itemStats.json` is validated against the catalog
- **THEN** every top-level key SHALL resolve to an existing catalog `id`, and an unresolvable key SHALL fail the check

#### Scenario: An item with no stats still renders

- **WHEN** an item present in the catalog has no entry in `itemStats.json`
- **THEN** its picker row and slot SHALL render without error, omitting the stat block rather than displaying empty or zeroed values

### Requirement: Provenance Is Recorded and Ids Are Never Wiki-Derived

Every scraped record SHALL carry the source page's revision identifier and the timestamp it was ingested. The recorded revision SHALL be the value the wiki reports for that page, not a placeholder.

Catalog `id` values SHALL NOT be derived from, or rewritten by, any scrape. A scrape MAY add a new item or update an existing item's fields; it MUST NOT re-slug or replace an existing `id`. An item whose wiki page has been renamed SHALL keep its id and gain a new display name.

An item that is re-added after having been retired SHALL receive a fresh `id`. It MUST NOT reuse a retired id or a retired position, because `loadoutCodec.js` resolves legacy records against frozen positional tables.

#### Scenario: A renamed page does not re-key an item

- **WHEN** a scrape runs against a fixture whose wiki page title has changed since the previous run
- **THEN** the catalog entry SHALL keep its original `id` and update only its display name

#### Scenario: Provenance is real, not placeholder

- **WHEN** a scraped record is spot-checked against the wiki's history for that page
- **THEN** the recorded revision identifier SHALL match what the wiki reports, and `ingestedAt` SHALL be the time of the run

### Requirement: Catalog Write-Through Is Bounded, Reviewable, and Opt-In

Where a scraped field and a hand-authored catalog field describe the same fact — cost, ammo class, UP value, size — the scraped value is authoritative. Applying it SHALL require an explicit flag (`--write-catalog`); the default run SHALL be additive, writing `itemStats.json` only.

A write-through run SHALL print a per-field diff of every hand-authored value it intends to overwrite, before applying it, so the change lands as a reviewable `git diff` hunk rather than a silent edit. "Print" means in a form an operator reads, not only as structured log events.

A run that the shrink guard refuses — one that would drop items the committed dataset already covers — SHALL NOT write `catalog.js` either, and the refusal SHALL be reported. The guard's signal is a parser that no longer matches the source; the items that failed outright are harmless to the catalog, but the items that parsed *successfully* against changed markup are the ones that would write a wrong-but-in-range number over a hand-authored one.

`scrape-stats.mjs` SHALL be the only script that ever writes `catalog.js`. `scrape-images.mjs` SHALL remain write-only to `client/public/images/`.

Parsed numerics SHALL be range-asserted before they are written — cost greater than zero, weapon size within **1–5**, trait UP within the game's range. A value failing its assertion SHALL fail that field and be recorded, rather than being written. Failing one field MUST NOT discard the item's other fields.

*(Corrected 2026-08-11. This requirement first said "size within 1–3", inherited from ADR-0005's confirmation criteria, which carries the same error. Weapon slot sizes run **1 to 5** in both sources, measured separately because they do not yet agree on the column: the hand-authored `catalog.js` has 11 of 39 weapons at size 4 or 5, and the scraped `itemStats.json` has 17 of the 38 weapon rows it covers. 5 is the entire weapon budget `calc.js`'s `capMax` grants. Implementing the stated range literally would have failed a correct parse on a quarter to a half of the arsenal depending on the source, which is the opposite of what a range assertion is for.)*

Parsing SHALL be strict: a value that is not a whole number SHALL be refused rather than coerced. Stripping non-digits and keeping the remainder is how a wrong-but-well-formed number gets written — `"1.5"` becomes `15`, and a currency suffix becomes part of the value on one page and not another.

#### Scenario: The default run does not touch the catalog

- **WHEN** `scrape-stats.mjs` runs without `--write-catalog`
- **THEN** `catalog.js` SHALL be byte-identical afterwards, and `itemStats.json` SHALL be written

#### Scenario: An implausible parsed value fails its field

- **WHEN** a parse yields a cost of `0` or a weapon size of `7`
- **THEN** that field SHALL fail with the value and its source URL recorded in the run summary, and no write SHALL occur for that field, while the item's other fields still land

#### Scenario: Overwrites are shown before they are applied

- **WHEN** a `--write-catalog` run would change a hand-authored cost
- **THEN** it SHALL print the item, the field, the old value, and the new value — in operator-readable form — before reading or writing `catalog.js`

#### Scenario: A run that trips the shrink guard writes neither file

- **WHEN** a `--write-catalog` run resolves fewer items than the committed dataset covers, without `--allow-shrink`
- **THEN** `catalog.js` SHALL be byte-identical afterwards, no write plan SHALL be computed, and the run summary SHALL state that the write-through was refused and why

### Requirement: Fields the Scraper Must Not Derive

`group` SHALL NOT be derived by any scrape, in any of the four categories. The wiki's taxonomies cannot supply it: Tools and Consumables share one multi-valued subcategory scheme, and Traits carry two orthogonal schemes (Regular/Burn/Scarce/Event by acquisition; Offensive/Defensive/Movement/Supportive/Solo/Catalyst by function). None is a single-valued UI category. A new row's `group` SHALL be hand-assigned.

The `AMMO` table SHALL NOT be written by any scrape. It models ten shared per-class pools; the wiki has no equivalent page, pricing custom ammo per weapon inside each weapon's own progression table. A scraper that reaches for `/wiki/Ammo` finds prose and will extract something plausible from the wrong place. Per-weapon ammo prices MAY be collected into `itemStats.json` instead.

*(Amended 2026-08-16, per SPEC-0010, ADR-0014 and issue #348.)* `ammoClass` on a weapon row remains hand-authored, exactly as it is today — this requirement does not newly forbid deriving it, and nothing here changes `catalog.js`'s existing gated tier for it. What changes is **authority, not authorship**: per SPEC-0010 REQ "`ammoClass` Survives as a Grouping Label Without Rules Authority", no code path that decides which rounds a weapon accepts, what a round costs, or how many ammo slots a weapon has SHALL read `ammoClass`. Those questions are answered by each weapon's own scraped accepted-round list instead — see "Ammo Compatibility, Price and Slot Data Is Per-Pair" below. `ammoClass` SHALL continue to exist as a display grouping only, and its hand-authored status is unaffected by this amendment; a field losing rules authority is not a field newly opened to derivation.

### Requirement: Ammo Compatibility, Price and Slot Data Is Per-Pair

*(added 2026-08-16, per SPEC-0010, ADR-0014 and issue #348.)*

Every field this file has recorded to date is **per-item**, keyed by a single catalog `id`. Per-weapon ammo compatibility, price and slot data introduces the dataset's first **per-pair** shape, keyed by a (weapon, round) pair rather than by either id alone, because the facts it carries — whether a weapon accepts a round, what that pair costs, whether the round fills a split-reserve or a family-bound slot — belong to neither item individually. SPEC-0010 REQ "A Weapon Declares Which Rounds It Accepts", REQ "Price Belongs to the Weapon-and-Round Pair", and REQ "A Weapon Declares Its Own Ammo Slot Count" own what the shape records; this requirement records only that `itemStats.json` gains it, alongside the per-item records the rest of this file describes.

The per-pair shape SHALL live in `itemStats.json` beside the per-item records, or in a sibling generated file, per whichever layout the implementation measures as appropriate — this requirement does not mandate one file over the other, consistent with SPEC-0010's own open question on the point. Either way, it SHALL be subject to the same rules already stated for every scraped field here: it MUST NOT be hand-edited, SHALL carry provenance, and the scrape SHALL only observe — see "The Scrape Observes and Does Not Decide" in SPEC-0010, which governs how a per-pair record is built and is not restated here.

#### Scenario: A per-pair record does not collapse into either item's own entry

- **WHEN** `itemStats.json` is inspected for a weapon that accepts more than one round
- **THEN** the compatibility, price and slot data for each (weapon, round) pair SHALL be independently recorded, and SHALL NOT be inferable from either the weapon's or the round's per-item entry alone

#### Scenario: A new item lands without a derived group

- **WHEN** the scrape proposes a catalog row for an item not previously present
- **THEN** it SHALL leave `group` unset for a human to assign, and MUST NOT infer one from any wiki subcategory

#### Scenario: No run writes the ammo table

- **WHEN** any scrape run completes, with or without `--write-catalog`
- **THEN** the `AMMO` table in `catalog.js` SHALL be unchanged

### Requirement: Ammo Pool Edits Are Wire-Format Changes

An ammo selection persists as a bare index into `AMMO[ammoClass]`. Inserting, removing, or reordering a variant within a pool therefore silently re-points every saved selection in that class, exactly as changing an item's `ammoClass` does.

Any change that inserts into, removes from, or reorders an `AMMO` pool SHALL be gated behind a `FORMAT_VERSION` bump and a saved-selection migration, on the same terms already required for `ammoClass`. This gate SHALL be stated in `catalog.js` beside the table, not only in this spec.

#### Scenario: A pool reorder without a version bump is rejected

- **WHEN** a change reorders the variants within an `AMMO` pool and `FORMAT_VERSION` is unchanged
- **THEN** the change SHALL be rejected, because saved selections in that class would silently resolve to a different variant

### Requirement: Rules Inputs Are Assigned Only From Mechanical Categories

A catalog field read by `calc.js` or `loadoutSlice.js` to decide what a loadout may contain is a **rules input**, not a descriptive field.

**`CONS[i][3]` (`type`) IS the consumable cap key, and is therefore a rules input** *(revised 2026-08-12, per [ADR-0015](../../../adrs/ADR-0015-consumable-cap-per-type.md))*. The cap is four consumables per cap category, so `type` SHALL be read by the reducer and by the picker's enabled state, and SHALL be held to the obligations of a rules input set out in this requirement.

This reverses the prohibition this requirement previously carried — "`CONS[i][3]` (`type`) is descriptive — it labels picker rows — and MUST NOT be re-introduced as a cap key" — which reasoned from `consCount()`'s per-item counting and concluded that four Dynamite Sticks plus a Dynamite Bundle is legal. That prohibition was the correct conclusion from a wrong premise about the game, and it was recorded to stop a retired per-type rule creeping back by accident. Update 2.8 restricts consumables to "4 instances of the same type (Throwables, Placeables, Shots and Tarot Cards)", confirmed in-game on 2026-08-12. The reversal is therefore deliberate, by ADR, with the evidence stated — which is the path this requirement was written to force rather than a route around it.

The check this requirement demands has been performed and both halves are on record: `type` is never persisted — `toData()` stores only `["C", id]` — so promoting it to a rules input carries **no `FORMAT_VERSION` gate and no migration**.

`type` SHALL be assigned only from the game's mechanical cap categories — Throwable, Placeable, Shot, Tarot Card. It MUST NOT be assigned from a thematic effect category (Healing, Rending, Fire, Poison, Noise, Vision, Light); those are `group` signals at most.

The failure mode that distinguishes a field like this: deriving `type` from "the item's wiki subcategory" produces a well-formed value that is right about half the time, and the error surfaces as a mislabelled item rather than as a parse failure. It will never appear in a run summary.

`Placeable` SHALL exist as a `CONS` type. Any field newly identified as a rules input SHALL be checked for positional or persisted coupling before it is corrected, and the result of that check recorded — `type` has been checked and has none, so it carries no `FORMAT_VERSION` gate.

#### Scenario: An item in both a thematic and a mechanical category takes the mechanical one

- **WHEN** the Medical Pack is scraped, which the wiki files under both `Category:Healing_Consumables` and `Category:Placeable_Consumables`
- **THEN** its `type` SHALL be `Placeable`, and its `group` MAY remain `Shots`

#### Scenario: The cap is enforced per category, not per item

- **WHEN** a loadout holds four Dynamite Sticks and a fifth Dynamite Stick is added
- **THEN** it SHALL be rejected; and **WHEN** a loadout holds four Dynamite Sticks and a Dynamite Bundle is added — same `type`, different item — it SHALL **also** be rejected, because the four Sticks exhaust the `Throwable` budget

#### Scenario: A `type` outside the declared cap categories is a data error

- **WHEN** a `CONS` row is assigned a `type` that is not one of the declared cap categories
- **THEN** it SHALL be reported as a data error, because such a row would otherwise escape the cap entirely rather than being capped under the wrong category

### Requirement: Budget-Affecting Attributes Are Stored, Never Inferred

An attribute that changes a loadout's slot or cost arithmetic SHALL be stored as its own field. It MUST NOT be inferred at read time from another field that merely correlates with it.

**Dual-wieldability is such an attribute, and this requirement covers it by name** *(named explicitly 2026-08-15; per SPEC-0009 and ADR-0023 it now changes slot cost rather than merely describing the weapon, so the requirement is stated over it rather than left to cover it by inference)*. It SHALL be stored per weapon as `dualWield` in `client/src/data/itemStats.json`, the scraped stats record, and read only through the accessor over that field — never re-derived at the point of use. A dual-wielded pair occupies its single's size **plus one**, so a wrong or inferred value is a budget error, not a cosmetic one: it decides whether a second weapon still fits. This is the same prohibition the requirement already makes generally, applied to the case that motivated it.

Dual-wieldability is also the worked example of why the inference is unsafe. It cannot be derived from `size`: the Haymaker, the Caldwell Conversion Uppercut, and the Dolch 96 are all size 2, and only the two one-handed ones can be paired — the discriminator is how many hands the weapon takes, not how many slots. Where the wiki supports it, the pair's own slot size SHALL be captured per weapon rather than computed as twice the single, because the game's slot documentation reserves two slots for "most" dual-wielded pairs, and "most" means per-weapon.

An attribute the scrape cannot resolve for a given item SHALL be recorded as unresolved. It MUST NOT be defaulted to a value that reads as a determination.

> **Amended 2026-08-12 per the review of #178 (PR #251).** This requirement previously treated "the page was read and did not state the attribute" as unresolvable, and the scenario below forbade writing `false` for it. That half is narrowed for dual-wieldability, and the narrowing is marked rather than rewritten because it relaxes a rule written to prevent exactly this default — a reader is owed the fact that it changed, and on what evidence. The original was right about the risk and too broad about the scope: it treated every silence as equally uninformative, and they are not.
>
> **A description that was read and stayed silent is a determination.** What makes it one is corroboration by class, not the silence on its own. Of the 59 weapon rows, 11 are `true`, 47 are `false`, and one — `winfield-m1873c`, retired by #250 — has no stats record at all. Grouped by the catalog's `group` column, the 47 silent rows are **Rifles 26, Shotguns 9, Melee 7, Bows 4, Pistols 1**. For rifles, shotguns, melee and bows the *entire class* is silent: that is a consistent class-wide editorial pattern in the source, not absent evidence, and it is corroborated by the game, in which no member of those classes is wieldable in a pair. For Pistols the evidence runs the other way — 11 of 12 state pairing outright — so silence *there* would be meaningful rather than conventional.
>
> Exactly one Pistol is silent: the **Haymaker**, which is independently confirmed two-handed and is the row this requirement and #178 both already name as correctly excluded. So the single case where the class pattern gives no cover is the case whose answer was already established by hand.
>
> That coincidence is not what makes the narrowing safe, because it holds only for today's roster. What makes it safe is that it is guarded rather than assumed: a test asserts that any `Pistols` row recorded `false` appears in an explicit, justified allow-list, which today holds `haymaker` alone. A newly-added silent pistol fails CI instead of entering the dataset as a determination nobody checked. Rifles, shotguns, melee and bows need no such list precisely because their silence is class-wide; a pistol's is not.
>
> **The other half of this rule is untouched and still live.** An attribute for which *nothing was read* — the page states no description, the description is empty, or the page could not be fetched — remains unresolved, MUST NOT be defaulted in either direction, and SHALL be reported in the run summary. The distinction this requirement now draws is between silence in a source that was read and the absence of any source at all. Only the first is evidence.

#### Scenario: An attribute with no source read is not defaulted to false

- **WHEN** the scrape reads no description for a weapon at all — the page states none, it is empty, or the page could not be fetched
- **THEN** the record SHALL mark the attribute unresolved, MUST NOT write `false`, and the run summary SHALL report it

*(Amended 2026-08-12 with the rule above; this scenario was titled "An unresolved attribute is not defaulted to false". Its **WHEN** previously read "the scrape cannot determine whether a weapon is dual-wieldable" — wording that covered both a description read and silent and a description never read. Only the second is unresolved now; the first is the determination the two scenarios below describe.)*

#### Scenario: A description read and silent is a determination, where the class corroborates it

- **WHEN** a weapon's description is read in full, does not state that it can be dual wielded, and its `group` is one whose members are silent as a class — today Rifles, Shotguns, Melee and Bows
- **THEN** the record SHALL store `false`, and that `false` SHALL mean "read, and not stated" rather than "denied by the page"

#### Scenario: A silent pistol is not covered by the class pattern

- **WHEN** a weapon in the `Pistols` group is read and does not state that it can be dual wielded
- **THEN** it MUST NOT be accepted as `false` on the class pattern alone, and SHALL appear in an explicit allow-list carrying the ground for its exclusion — today `haymaker`, confirmed two-handed — or fail

#### Scenario: A name-similar weapon does not inherit an attribute

- **WHEN** the wiki page `Weapons/Officer` is found to be dual-wieldable
- **THEN** the catalog's `nagant-officer-carbine` SHALL NOT be marked dual-wieldable, because it is a different weapon

### Requirement: Discovery Classifies Every Unmatched Page Before Proposing It

A wiki page existing does not mean the item exists. `Category:Tools` carries 23 members of which two are tombstones — the Electric Lamp, removed in Update 2.0 and already deleted from `TOOLS`, and the Multitool, a cut prototype that never shipped.

A discovery diff SHALL classify every category member not matched to a catalog row as **live**, **removed**, or **never-shipped** before proposing it as a missing item. Known tombstones SHALL be skipped with a recorded reason, the way world weapons already are — not silently, and not as parse failures.

The run summary SHALL distinguish "page exists but item doesn't" from "item missing from catalog", so a diff can be read without re-deriving the classification by hand.

#### Scenario: A removed item is not proposed for re-addition

- **WHEN** a discovery run diffs `Category:Tools` against `TOOLS`
- **THEN** the Electric Lamp and the Multitool SHALL be reported as tombstones with a reason, and MUST NOT appear in the list of items to add

### Requirement: Canonical Titles Are Read From the Page

A page fetch returning HTTP 200 SHALL NOT be treated as confirming that the requested display name is current. MediaWiki serves renamed pages through redirects, and this wiki's redirect coverage is inconsistent — `Tools/Alert_Trip_Mine` does not redirect to `Tools/Alert_Trip_Mines`, which is why that title override exists.

The canonical title SHALL be read from the fetched page and compared against the catalog's display name, so a rename is detected rather than absorbed.

#### Scenario: A redirect is reported as a rename

- **WHEN** a fetch for an item's page is served through a redirect to a differently-titled page
- **THEN** the run summary SHALL report the catalog name and the canonical title as a rename candidate, and the id SHALL be unchanged

### Requirement: Acquisition Class Is Captured So Roster Membership Is Checkable

Whether an item can be bought decides ~~whether it belongs in the catalog at all~~ **what it costs**, and nothing currently records it. Because it is nowhere machine-readable, every roster diff re-litigates it.

> **Amended 2026-08-12 per ADR-0013.** This requirement previously read: "Tarot Cards, 14 Scarce traits, and 18 Event traits are excluded because they cannot be purchased with Hunt Dollars or Upgrade Points." That is reversed for Scarce and Event, and the reversal is marked rather than rewritten because it inverts what a reader was told the boundary meant. Unpurchasable is no longer grounds for exclusion: a Scarce item comes only from a match, and a player who owns one can field it, so ADR-0013 admits Scarce and Event items as catalog rows costing zero. **Tarot Cards remain out of scope** — a scope decision, no longer justified by unpurchasability, since that ground now applies to items that are in scope.

Every scraped trait record SHALL carry the **set** of acquisition classes its wiki page declares, drawn from `Regular`, `Scarce`, `Burn` and `Event`. It MUST NOT be recorded as a single value: the wiki's own data is a set, and Relentless, Rampage, Remedy and Death Cheat are each both Scarce and Burn while Blademancer, Bruiser, Communion, Corpse Seer and Gunrunner are each both Scarce and Event. The infobox `Type` field states multiple classes as one comma-joined string (`"Burn , Scarce"`), which equals neither class, so a membership test against that string SHALL NOT be treated as recording the class.

The set SHALL be read from the page's own category membership rather than from the infobox, because a Scarce trait page omits `Type` and carries no cost row at all, while still declaring `Category:Traits/Scarce`.

Only the acquisition axis SHALL be read as acquisition. The functional axis — `Offensive`, `Defensive`, `Movement`, `Supportive`, `Solo` and `Catalyst` — appears in the same category block and is `group`, which this spec's "Fields the Scraper Must Not Derive" requirement forbids the scrape supplying. A category on neither axis, of which `Category:Traits/Pact` is the only present example, SHALL yield no acquisition class rather than a guessed one.

Every scraped consumable record SHALL carry whether it is purchasable with Hunt Dollars. All of this SHALL live in `itemStats.json`; it is scrape metadata, not catalog fields, and MUST NOT be written into `group`.

The exclusion boundary SHALL be stated in `catalog.js` ~~in terms of purchasability rather than~~ **as the scope decision it is, and never** in terms of any event's duration, since a limited-time item can become permanent while remaining unpurchasable.

> **Amended 2026-08-12 per ADR-0013.** This paragraph previously required the boundary to be phrased "in terms of purchasability rather than in terms of any event's duration". The purchasability half is retired, and marked rather than rewritten for the same reason as the amendment above: it is the second rationale this one boundary has outlived, and a reader who was told the boundary *meant* unpurchasability needs to see that change rather than find a clean document that never said it. Unpurchasability can no longer be the stated ground for excluding anything, because ADR-0013 makes it a cost of zero and admits such items — twelve Scarce rows sit in `catalog.js` today. The duration half stands unamended: a limited-time item can become permanent, Update 2.8.1 made Tarot Cards exactly that, and a boundary resting on an event's duration would have expired with it.

Purchasability SHALL be recorded three ways, not two: purchasable, stated-unpurchasable, and unresolved. "Stated-unpurchasable" requires that a price was actually read and refused — a Tarot Card's literal `Scarce`. An item whose page carries no price field at all SHALL be recorded as unresolved and reported in its own column, since defaulting it to either determination is the inference this spec's "Stored, Never Inferred" requirement forbids.

#### Scenario: A Tarot Card is identified as out of scope, not as missing

- **WHEN** a discovery run encounters a Tarot Card page with no catalog row
- **THEN** it SHALL be reported as out of scope on the recorded ground that it is a scope boundary, not as a missing item

#### Scenario: A trait in two rarity categories records both

- **WHEN** a trait page declares membership of both `Category:Traits/Scarce` and `Category:Traits/Burn`
- **THEN** its record SHALL carry both classes, and MUST NOT carry only whichever the infobox named first

#### Scenario: A functional category is never recorded as an acquisition class

- **WHEN** a trait page declares membership of `Category:Traits/Catalyst` or `Category:Traits/Solo`
- **THEN** no acquisition class SHALL be recorded from it, and the class set SHALL contain only the acquisition-axis categories the page also declares

#### Scenario: A Scarce trait states no cost and is still known to be Scarce

- **WHEN** a trait page carries no `Price` or `Cost` field but declares `Category:Traits/Scarce`
- **THEN** purchasability SHALL be recorded as unresolved, AND the class set SHALL record `Scarce`, so the reason it has no price is recoverable without re-fetching the page

#### Scenario: An unreadable price is not an exclusion

- **WHEN** a discovery run reaches an unmatched page carrying no `Price` or `Cost` field
- **THEN** it SHALL be reported as unresolved, and MUST NOT be reported either as a missing catalog row or as a deliberate exclusion

#### Scenario: A page the crawl could not read is not a catalog gap

- **WHEN** a page fetch is refused by `robots.txt`, returns a non-OK status, or throws
- **THEN** that page SHALL be reported as unreadable with its reason, MUST NOT be counted as missing, and the rest of the crawl SHALL continue

### Requirement: Roster Coverage Is Reported Against the Wiki's Own Categories

The run summary SHALL state coverage against the wiki's own category indexes — the wiki's membership counts against the catalog's row counts, per catalog category.

A catalog category MAY map to more than one wiki index, and traits SHALL map to every index that enumerates an in-scope rarity: `Category:Traits/Regular`, `Category:Traits/Scarce` and `Category:Traits/Event`. A single index per category SHALL NOT be relied on where several exist.

> **Amended 2026-08-12 per ADR-0013.** This requirement previously named `Category:Purchasable_Traits` as the trait index. That page is a **redirect to `Category:Traits/Regular`**, so a crawl of it enumerates the Regular traits and nothing else, while reporting a coverage figure that looks complete. Fourteen Scarce, eighteen Event, six Burn and five Catalyst members sat outside the frame, and a Scarce trait could therefore not appear as missing, as unpurchasable, or as a tombstone. The redirect is why the gap survived review: the name reads as "every trait you can obtain" and means "the Regular ones".

Where several indexes are crawled for one catalog category, membership SHALL be de-duplicated by page path before any coverage arithmetic, because a page can be enumerated by more than one index — six traits are members of both the Scarce and Event indexes. `matched` SHALL be computed from the de-duplicated set, so distinct pages are counted rather than summed memberships.

Coverage of a category MUST NOT be inferred from the correctness of a field within it. The `TRAITS` comment's claim that UP costs were re-verified is scoped to costs, is well defended, and holds; the roster it describes is nonetheless **32 rows against roughly 76 live traits** — a figure this spec previously recorded as "32 of 58 purchasable traits", which was wrong in both directions: the denominator omitted 27 traits outside the crawled index and counted 9 tombstones still listed inside it. A summary that reports field correctness without reporting membership permits exactly that confusion.

Every bucket the coverage table reports and that names candidate work SHALL identify its pages, not only count them. A count that cannot be read back page by page is the coverage claim this requirement exists to refuse.

#### Scenario: Coverage is reported per category

- **WHEN** a discovery run completes
- **THEN** it SHALL report, for each catalog category, the wiki's de-duplicated member count, the catalog's row count, and the unmatched members classified per the discovery requirement

#### Scenario: A trait enumerated by two indexes is counted once

- **WHEN** a trait is a member of both the Scarce and the Event index and both are crawled
- **THEN** it SHALL be counted once in the member total, and SHALL NOT inflate the unmatched count by appearing twice

#### Scenario: The missing bucket names its pages

- **WHEN** a discovery run reports a non-zero count of catalog gaps
- **THEN** each gap SHALL be listed with its page path and the price the run read, so the count is checkable item by item

### Requirement: A Zero Cost Is Evidenced as Unpurchasable

Realizes ADR-0013. A Scarce item is modelled as an ordinary catalog row costing zero, which makes `0` a load-bearing value that looks exactly like a value nobody supplied. A dropped price, a mis-parsed infobox and a deliberate Scarce row are indistinguishable by inspection, and the failure is silent in the direction that matters: a free item that should cost money understates every budget it appears in.

The zero SHALL be authored by a human applying ADR-0013 and MUST NOT be written by the scrape. The scrape SHALL record only what it observed — the stated price, the three-valued purchasability, and the acquisition class set — because mapping "Scarce" to a cost is a game rule, and ADR-0005 keeps game rules out of the generated dataset.

The correspondence SHALL be asserted in both directions by an automated test:

- Every catalog row whose cost is `0` SHALL be evidenced as unpurchasable by `itemStats.json` — carrying `Scarce` in its acquisition class set, or a stated price this project's strict parser refuses.
- Every item `itemStats.json` evidences as Scarce SHALL carry a cost of `0` in the catalog.

The second direction is REQUIRED and is not redundant: without it, a re-scrape that reclassifies an item leaves a stale non-zero cost that no test objects to. The check SHALL run offline against the committed dataset, consistent with this spec's offline posture.

Rarity SHALL NOT be added to the catalog's positional tuples. A single field cannot hold a set — a trait may be both Scarce and Burn — and a cost derived at read time from a rarity flag is the inference this spec's "Budget-Affecting Attributes Are Stored, Never Inferred" requirement forbids.

#### Scenario: A zero cost with no supporting evidence fails the suite

- **WHEN** a catalog row carries a cost of `0` and `itemStats.json` records neither a Scarce class nor a refused price for that id
- **THEN** the test suite SHALL fail, naming the row, rather than accepting the row as a free item

#### Scenario: A Scarce item carrying a price fails the suite

- **WHEN** `itemStats.json` records an item as Scarce and the catalog carries a non-zero cost for it
- **THEN** the test suite SHALL fail, so a reclassification surfaces instead of leaving a stale price in budget math

#### Scenario: The scrape never writes the zero

- **WHEN** a scrape run reads a page whose price is the literal string `Scarce`, or a trait page carrying no cost row and a Scarce category
- **THEN** it SHALL record the observation and MUST NOT write a cost of `0` into the catalog, with or without the write-through flag

### Requirement: Error Handling Standards

All error-producing operations in the stats scrape MUST follow structured error handling:

- Errors MUST be wrapped with contextual information at each layer boundary (e.g., "failed to parse infobox for Caldwell Pax: no cost field at {url}")
- Sentinel errors MUST be defined for the failure modes the script needs to distinguish programmatically — item page not found, infobox absent on an existing page, field absent from an existing infobox, and network/rate-limit failure are distinct outcomes and MUST NOT collapse into one
- Silent error swallowing MUST NOT occur — every failure MUST be surfaced in the run summary, logged with item name, URL, and reason, or explicitly handled with a documented fallback
- Structured logging MUST be used for run reporting, not unstructured string interpolation only

#### Scenario: One item's parse failure does not fail the run

- **WHEN** a single item's infobox cannot be parsed
- **THEN** the run SHALL continue, that item SHALL be recorded in the summary with its name, URL, and reason, and the run SHALL exit reporting a non-zero failure count

#### Scenario: A rate-limit failure is distinguishable from a missing field

- **WHEN** a fetch fails on rate limiting and another item's infobox lacks a cost field
- **THEN** the two SHALL be reported as distinct failure modes rather than as one generic error
