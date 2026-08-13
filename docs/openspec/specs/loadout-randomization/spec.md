---
status: approved
date: 2026-08-11
implements: [ADR-0010, ADR-0015]
requires: [SPEC-0007]
---

# SPEC-0008: Loadout Randomization

## Overview

Realizes [ADR-0010](../../../adrs/ADR-0010-archetype-driven-loadout-randomizer.md): the "Random loadout" button stops sampling every part of a build independently and instead picks a build *archetype* first, then fills weapons, ammo, equipment, and traits from that archetype's weighted pools.

The defect this capability closes is structural, not a tuning problem. In `client/src/utils/randomize.js` traits are drawn at lines 27–49, before weapons are drawn at lines 51–59, so no pairing rule can exist at any price — Fanning cannot consult a weapon that has not been rolled yet. The observable result is builds that carry traits with nothing in the build to act on.

Two secondary gaps are in scope because the primary one cannot be verified without them. `Math.random()` is called directly at ten sites, so no test can assert a coherence rule; and the dollar budget is 80 blind re-rolls that keep the cheapest miss while the UP cap is a greedy accept/skip with no retry, so a tight UP cap silently yields a shorter trait list rather than a cheaper build.

*Line citations and the `Math.random()` count corrected 2026-08-13.* They were written against the pre-SPEC-0006 generator and read 18–27, 30–37, and "seven places"; the sparse-grid and per-category-cap work moved every one of them. The ordering defect they point at is unchanged — that is the premise of this capability, and it still holds.

**Scope.** The generator module (`client/src/utils/randomize.js`), a new archetype table, and a new trait-affinity map. Out of scope: the picker UI, the "Random loadout" button itself, the loadout wire format, and the saved-loadout API — this capability changes what the generator returns, not what any consumer does with it.

**The equipment array shape is deliberately not restated here.** SPEC-0006 (Equipment Slot Arrangement) specifies `state.equip` as a fixed sparse eight-element array — index is the cell, `null` is an empty cell — **and that model is implemented**. `randomize.js` already produces it: `Array(8).fill(null)` at line 63, with `place()` filling the lowest free unblocked cell and holes left at blocked positions. Every requirement below is written in terms of **cells occupied** rather than array shape, which now reads as the plain description of the live model rather than as a straddle between two.

SPEC-0008 does not declare `requires: [SPEC-0006]`. That edge was omitted so this capability could be built first; the sequencing question it answered is now moot, because the sparse model landed first anyway. The edge is left undeclared rather than backfilled, since adding it would assert a build-order dependency that no longer constrains anything — but a reader tracing the graph should know the relationship is real and satisfied.

*Corrected 2026-08-13.* This paragraph read: SPEC-0006 "records that none of it is implemented — the live array is still dense and packed, which is what the randomizer produces today", and closed with "when the sparse model lands, the requirements here need no amendment, only the fill implementation does". The first clause was a true report of a stale note in SPEC-0006; the rest was false against the code on both counts. The sparse array, per-cell blocking, and wire format v2 all shipped, and the fill implementation was part of that work rather than something still owed. SPEC-0006's own "Implementation status" note was corrected on the same date and now records the capability as implemented, so the two specs no longer disagree about the shape of `state.equip`.

**Relationship to SPEC-0007.** Archetype pools and the trait-affinity map are authored as stable catalog `id` strings, which is why this spec `requires` SPEC-0007 (Equipment Catalog Dataset) — it depends on the catalog's id contract, not on the scraped stat block. The scraped dataset carries no weapon action type and no trait weapon-conditions, so it cannot supply affinity today; ADR-0010 records deriving affinity from the wiki as a considered and deferred option.

**Implementation status.** The capability's core — archetypes — is not implemented. `randomize.js` is still the uniform sampler described above: no archetype table, no weighted selection, no required-trait or affinity handling, `Math.random()` called directly rather than injected, the dollar budget still 80 blind re-rolls, and the UP cap still a greedy accept/skip.

Unbuilt: "Every Build Originates From an Archetype", "Archetypes Are Authored as Catalog Ids", "A Required Trait Is Satisfied by the Build That Carries It", "Randomness Is Injectable and Reproducible", "The Dollar Budget Is Searched Within the Chosen Archetype", "The Upgrade-Point Budget Sheds Flavor Before Required Traits", and "Generated Builds Remain Varied".

Three requirements are nonetheless *already satisfied, wholly or in part*, incidentally — by the SPEC-0006 and ADR-0015 work rather than by anything done under this capability. This note previously read "Nothing in this capability is implemented", which invited a reader to rebuild them:

- **"Weapon Size Caps Are Honored"** — satisfied. The cap is `5 + Quartermaster`, the primary is filtered to that cap and the secondary to the remainder, and `weapons` always has exactly two elements. One caveat for whoever implements the archetype draw: the primary filter reserves a point (`size <= cap - 1`), so with size-1 weapons in the catalog a secondary always fits and the `null`-secondary path the requirement describes is currently unreachable. The scenario is not falsifiable against today's generator.
- **"Equipment Fill Respects Grid Capacity and Existing Item Rules"** — satisfied except for the archetype pools. The fill honours `slotMax` and blocked cells, always places the First Aid Kit resolved by its stable `first-aid-kit` id, refuses a duplicate tool, and enforces the four-per-cap-category limit through `consAllowed`, the same predicate the reducer uses. Also *not* satisfied: terminating without a guard — `EQUIP_FILL_GUARD` at line 69 is exactly the iteration guard this requirement forbids.
- **"The Returned Payload Is Store-Acceptable"** — satisfied. The generator returns `{ weapons, equip, traits }`, omits `name` and `blocked`, emits traits as stable id strings, and gives ammo `-1` or an index valid for that weapon's own class. `randomize.test.js` covers the payload shape, the eight-cell grid with blocked positions as holes, the starter tool, the per-category cap, and tool duplication.

Read that as an inventory of what a future implementation must *preserve*, not as progress toward the archetype model.

## Requirements

### Requirement: Every Build Originates From an Archetype

`randomizeLoadout` SHALL select exactly one archetype before drawing any weapon, trait, or equipment item, and SHALL draw every subsequent element from that archetype's declared pools. Archetype selection SHALL be weighted, and the archetype set MUST include a `wildcard` archetype whose pools are the full catalog, preserving unconstrained sampling as one outcome among several rather than removing it.

No code path SHALL produce a build that is not attributable to a selected archetype.

#### Scenario: An archetype is chosen before any draw

- **WHEN** `randomizeLoadout` is called with any options
- **THEN** an archetype is selected first, and every weapon, trait, tool, and consumable in the returned build is drawn from that archetype's pools

#### Scenario: The wildcard archetype preserves the full space

- **WHEN** the `wildcard` archetype is selected
- **THEN** the draw pools are the full `WEAPONS`, `TOOLS`, `CONS`, and `TRAITS` arrays, and the resulting build is exempt from the required-trait contract below

### Requirement: Archetypes Are Authored as Catalog Ids

Each archetype SHALL be a declarative record providing a selection weight, a primary weapon pool, a secondary weapon pool, a required-trait list, a flavor-trait pool, and tool and consumable pools. Every pool member SHALL be a stable catalog `id` string. Pools MUST NOT reference catalog array indices.

Archetype records SHALL live in a dedicated module (`client/src/utils/archetypes.js`) separate from the generator, so the table can be reviewed and corrected without reading generator logic.

#### Scenario: Every authored id resolves to a live catalog entry

- **WHEN** the archetype table is validated against `catalog.js`
- **THEN** every id in every pool of every archetype resolves to exactly one live catalog entry, and any unresolved id fails the validation

#### Scenario: A retired id is caught rather than silently dropped

- **WHEN** an archetype pool names an id that has been removed from the catalog, such as the retired `choke-bomb`
- **THEN** validation fails and names the offending archetype and id

### Requirement: A Required Trait Is Satisfied by the Build That Carries It

A **trait-affinity map** SHALL declare, for each trait that depends on specific equipment, the set of catalog ids that make that trait live — for example Fanning against the single-action pistols, Levering against the lever-action Winfields, Bolt Thrower against the bows and crossbows, Pitcher against the throwables.

Every archetype's required-trait list SHALL be satisfiable by that archetype's pools: for each required trait, at least one member of the trait's affinity set MUST be reachable from the archetype's weapon or equipment pools. A generated build SHALL contain, for every required trait it carries, at least one item from that trait's affinity set.

Traits with no entry in the affinity map are unconditional and SHALL always be considered satisfied.

#### Scenario: A required trait always has something to act on

- **WHEN** a build is generated from any archetype other than `wildcard`
- **THEN** for every required trait in that build, at least one weapon or equipment item in the build belongs to that trait's affinity set

#### Scenario: An unsatisfiable archetype is rejected at validation time

- **WHEN** an archetype declares a required trait whose affinity set intersects none of that archetype's pools
- **THEN** validation fails and names the archetype and the unsatisfiable trait

#### Scenario: Unconditional traits are unconstrained

- **WHEN** a build carries a trait with no affinity-map entry, such as Greyhound or Vigilant
- **THEN** the build satisfies the coherence contract regardless of which weapons it drew

### Requirement: Randomness Is Injectable and Reproducible

`randomizeLoadout` SHALL accept an `rng` option: a zero-argument function returning a float in `[0, 1)`, defaulting to `Math.random`. Every random draw in the generator and in archetype selection SHALL route through that function. The module MUST NOT call `Math.random()` directly at any point.

Given the same `rng` sequence and the same options, `randomizeLoadout` SHALL return an identical build.

#### Scenario: The same seed reproduces the same build

- **WHEN** `randomizeLoadout` is called twice with equal options and two seeded generators initialized to the same seed
- **THEN** the two returned builds are deeply equal

#### Scenario: The default caller is unchanged

- **WHEN** `randomizeLoadout` is called without an `rng` option, as `randomizeThunk` does
- **THEN** it draws from `Math.random` and the call site requires no change

### Requirement: Weapon Size Caps Are Honored

The sum of the drawn weapons' size values SHALL NOT exceed the build's carry cap, where the cap is 5, or 6 when the build carries Quartermaster. The returned `weapons` array SHALL have exactly two elements; the second element SHALL be `null` when the primary weapon consumes the cap and no secondary fits.

#### Scenario: A large primary leaves room for nothing

- **WHEN** the drawn primary weapon has size equal to the cap
- **THEN** `weapons[1]` is `null` and the build is returned as a single-weapon build

#### Scenario: Quartermaster widens the cap it is in the build for

- **WHEN** the selected archetype requires Quartermaster and the trait is drawn
- **THEN** the size budget used for weapon selection is 6 rather than 5

### Requirement: The Dollar Budget Is Searched Within the Chosen Archetype

When `budgetOn` is true, the generator SHALL attempt to produce a build at or under `budget` by re-drawing within the already-selected archetype, using a bounded number of attempts. It SHALL NOT re-select the archetype between attempts.

When no attempt lands at or under budget, the generator SHALL return the cheapest attempt produced, and that build SHALL still satisfy the required-trait contract. When `budgetOn` is false, no budget filtering SHALL occur.

#### Scenario: A reachable budget is met

- **WHEN** `budgetOn` is true with a budget the selected archetype can reach
- **THEN** `totalCost` of the returned build is at or under `budget`

#### Scenario: An unreachable budget degrades to the cheapest coherent build

- **WHEN** `budgetOn` is true with a budget below anything the selected archetype can produce
- **THEN** the cheapest attempt is returned, and it still satisfies the required-trait contract for its archetype

#### Scenario: The archetype survives the budget search

- **WHEN** the budget search runs to its attempt limit
- **THEN** every attempt was drawn from the same archetype that was selected before the search began

### Requirement: The Upgrade-Point Budget Sheds Flavor Before Required Traits

When `upBudgetOn` is true, traits SHALL be drawn required-first and flavor-second, and the running UP total SHALL NOT exceed `upBudget`. Flavor traits that do not fit SHALL be skipped.

When an archetype's required traits alone exceed `upBudget`, the generator SHALL re-select a different archetype whose required traits fit, and SHALL fall back to `wildcard` when none does. It MUST NOT return a build carrying only part of an archetype's required trait list.

#### Scenario: A tight cap drops flavor, not identity

- **WHEN** `upBudgetOn` is true with an `upBudget` that fits the archetype's required traits but not its flavor traits
- **THEN** every required trait is present and the returned trait list contains no flavor traits

#### Scenario: An unaffordable archetype is exchanged, not truncated

- **WHEN** the selected archetype's required traits sum to more than `upBudget`
- **THEN** a different archetype is selected whose required traits fit, or `wildcard` is used, and the returned build carries a complete required-trait list

#### Scenario: No cap means no shedding

- **WHEN** `upBudgetOn` is false
- **THEN** trait selection is unconstrained by UP and `upTotal` of the result may exceed any value

### Requirement: Equipment Fill Respects Grid Capacity and Existing Item Rules

The generated build SHALL occupy no more than `slotMax` equipment cells. It SHALL always include the First Aid Kit, resolved by its stable `first-aid-kit` id rather than by array position. It SHALL NOT contain the same tool twice. It SHALL NOT contain more than four consumables of any one **cap category** — `CONS[i][3]`, holding `Shot`, `Throwable` and `Placeable`, plus Tarot Cards once admitted — counted per category rather than per specific consumable, and consistent with whatever predicate the reducer enforces.

*Revised 2026-08-12 per [ADR-0015](../../../adrs/ADR-0015-consumable-cap-per-type.md).* This requirement previously read "no more than four copies of any one consumable, counted **per specific consumable rather than per consumable type**, consistent with `consCount` in `calc.js`" — a SHALL-level statement of the opposite rule, and the only place in the corpus where the per-item basis was stated as a positive requirement rather than implied. ADR-0015 reverses it on Update 2.8's four-per-type rule, confirmed in-game. The generator is in scope for that change rather than a follow-on, because a fill obeying the old rule can emit eight Throwables where four are legal.

The requirement is now phrased against "whatever predicate the reducer enforces" rather than naming `consCount`, so the generator and the builder cannot drift apart the way this requirement and SPEC-0006 did.

Equipment fill SHALL draw from the selected archetype's tool and consumable pools and SHALL terminate deterministically — the fill MUST NOT rely on an iteration guard to exit.

#### Scenario: Capacity is never exceeded

- **WHEN** a build is generated with any `slotMax` from 1 to 8
- **THEN** the number of occupied equipment cells is at most `slotMax`

#### Scenario: The starter tool is always present and never doubled

- **WHEN** any build is generated
- **THEN** the First Aid Kit occupies exactly one cell, and no other cell holds it

#### Scenario: The per-category consumable cap holds

- **WHEN** a build is generated
- **THEN** no cap category SHALL be represented in more than four cells, counting distinct consumables that share a `type` against one budget

#### Scenario: A fill from a single-category pool is bounded at four

- **WHEN** an archetype's consumable pool contains only `Throwable` items and `slotMax` leaves more than four free cells
- **THEN** the fill SHALL place at most four of them and SHALL return a shorter build rather than filling the remaining cells with further Throwables

#### Scenario: Fill terminates without a guard

- **WHEN** the archetype's pools are smaller than the available cells
- **THEN** the fill returns a shorter build rather than looping, and no iteration-count guard is consulted

### Requirement: The Returned Payload Is Store-Acceptable

`randomizeLoadout` SHALL return `{ weapons, equip, traits }` and SHALL omit `name` and `blocked`, which `setLoadout` defaults from existing state. The payload SHALL satisfy `isValidLoadoutShape` in `loadoutSlice.js`: `weapons` has exactly two elements, each `null` or an object whose `i` resolves in `WEAPONS` and whose `a` is an integer; `equip` and `traits` are arrays. Traits SHALL be stable catalog id strings, not indices.

The ammo field SHALL be `-1` when no ammo variant is selected and otherwise a valid index into the drawn weapon's `AMMO` class.

#### Scenario: The store accepts every generated build

- **WHEN** any generated build is dispatched through `setLoadout`
- **THEN** it passes `isValidLoadoutShape` and the reducer does not throw

#### Scenario: Ammo indices are in range for their own weapon

- **WHEN** a build selects an ammo variant for a weapon
- **THEN** the index is a valid position in `AMMO[WEAPONS[i][4]]` for that same weapon, and is `-1` when no variant was selected

### Requirement: Generated Builds Remain Varied

Across repeated generation the randomizer SHOULD produce a spread of archetypes and a spread of builds within each archetype. Over 100 consecutive builds from distinct seeds, the output SHOULD include at least three distinct archetypes, and the builds drawn from any single archetype SHOULD NOT be identical to one another.

Archetype selection weights SHOULD be authored as data so the distribution can be tuned without changing generator logic.

#### Scenario: Repeated rolls do not collapse to one build

- **WHEN** 100 builds are generated from 100 distinct seeds
- **THEN** at least three distinct archetypes appear, and no single build is returned by more than half of the seeds
