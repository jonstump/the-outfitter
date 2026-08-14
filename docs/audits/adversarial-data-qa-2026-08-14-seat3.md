# Adversarial Data QA Panel — Seat 3 filing

**Seat 3 — Rules, caps, and the generator.** Round 1, independent. No other seat's filing was read.

**Date:** 2026-08-14
**Charge:** the arithmetic — slot capacity, `TRAIT_MAX`, the four-per-*type* consumable cap and its
`UNDECLARED_CATEGORY` sentinel, the eight-cell grid with blocked cells, stacking, and whether the
randomizer can emit a loadout the manual UI would refuse.

---

## Method and its limits

### Was the wiki reachable? **No.**

```
$ curl -sS -o /dev/null -w '%{http_code}\n' https://huntshowdown.wiki.gg/wiki/Nagant_M1895
curl: (56) CONNECT tunnel failed, response 403
```

The proxy answers `403` to `CONNECT` for **every** outbound host, not just the wiki (`example.com`
returns the same). So I had **no upstream oracle at all**. Every claim below is therefore one of:

- an assertion about **what the app's code does with a number** (reproducible offline, and this is
  where nearly all of my charge lives), or
- an assertion about **disagreement between two of the app's own artifacts** (`catalog.js` vs
  `itemStats.json` vs the specs/ADRs), or
- explicitly marked `[UNVERIFIED]`.

**I state no game number from memory.** Where a finding needs a game rule, it cites the ADR or spec
that records it, and says so.

### Baseline

`npm test` is green, after `npm ci --engine-strict=false` (the image runs Node v22.22.2; `package.json`
pins `node: ^20`, so a plain `npm ci` fails `EBADENGINE` — worth knowing, it is not a code defect):

| Suite | Result |
|---|---|
| `client` (vitest) | 33 files, **759 passed** |
| `server` + `test:scrape` (node:test) | 13 suites, **321 passed**, 0 failed |

Every finding below is against that green baseline. Nothing I found is caught by a test today.

### What I actually did

Read-only on the app. My only write is this file. Every executable probe lives in the scratchpad, not
the repo. I did **not** run the scrapers.

- Read in full: `calc.js`, `randomize.js`, `stacking.js`, `loadoutSlice.js`, `selectors.js`,
  `thunks.js`, `loadoutCodec.js`, `EquipmentPanel.jsx`, `EquipmentSlot.jsx`, `WeaponsPanel.jsx`,
  `Picker.jsx` (rules half), the preview half of `LoadoutListsPanel.jsx`, `server/src/routes/loadouts.js`
  (validator), ADR-0015, SPEC-0008 in full, SPEC-0006's capacity/stacking requirements.
- **Fuzzed the generator**: 11 option scenarios × 3,000 builds each, asserting eight invariants
  per build (grid length, slot cap, trait cap, trait uniqueness, no item in a blocked cell,
  per-cap-category ≤ 4, no duplicate tool, ammo index in range).
- **Coverage-measured the generator**: 200,000 builds for weapon reach, 20,000 each for tool and
  consumable reach.
- **Cost-profiled the generator**: 300,000 single-attempt draws for the budget analysis.
- **Random-walked the reducer**: 4,000 runs × up to 120 randomly-chosen actions from the real action
  creators, checking the same invariants after every dispatch. This is what found F1.
- **Drove both decoders** with hand-built v2, v1 and legacy records.
- **Pinned every arithmetic column** — weapon `size`, weapon/tool/consumable `cost`, trait `up` —
  against `itemStats.json` row by row.

### Limits you should hold this filing to

1. **No upstream oracle.** I can prove the app's *rules* are self-inconsistent. I cannot prove any
   `size`, `cost` or `up` value matches the live game. Where catalog and scrape agree, I have no way
   to tell whether both are stale. That is the whole of Seat 2's problem and it is unresolved here too.
2. **UI reachability is argued from code reading, not from a browser.** I traced every dispatcher of
   `moveEquip` by hand. I did not run the app. F1's severity turns on exactly this, and I have flagged
   it rather than papered over it.
3. **Randomness.** The generator calls `Math.random()` directly (SPEC-0008 records this as the
   un-implemented "Randomness Is Injectable" requirement), so my generator findings are statistical.
   I have given sample sizes for every one; a finding resting on 200,000 draws with 0 occurrences is
   a structural claim, not a rarity claim, and I say which is which.
4. **I did not audit item identity.** Whether `dynamite-stick` is really `Throwable` in the game is
   Seat 2's. I audited what the app does *given* the type it carries.

---

## Findings

### F1 — `moveEquip` duplicates an item when the source cell is empty

- **Severity: P2** — see the severity note below; this is P1 the moment anyone finds a click-path.
- **Location:** `client/src/store/loadoutSlice.js:123-140`
- **Status: CONFIRMED** (the reducer defect). **SUSPECTED-negative** on UI reachability — I could not
  find a path, and say so.

**Evidence.** The branch:

```js
if (state.equip[from] === null && state.equip[to] === null) return;
const moving = state.equip[from] === null ? state.equip[to] : state.equip[from];
if (moving === null) return;
state.equip[from] = state.equip[to];
state.equip[to] = moving;
```

When `from` is empty and `to` is filled, `moving` is bound to `equip[to]`, then **both** cells are
assigned it. The `moving === null` guard on line 137 is dead — `moving` can only be null when both
cells are null, which line 135 already returned on.

Reproduction (three dispatches against the real reducer):

```js
let s = { ...emptyLoadout(), savedId: null, nameIsDerived: true };
s = reducer(s, A.addEquip({ t: "T", i: TOOLS.findIndex(t => t[0] === "knife") }));
s = reducer(s, A.addEquip({ t: "T", i: TOOLS.findIndex(t => t[0] === "knife") })); // refused: one per loadout
s = reducer(s, A.moveEquip({ from: 5, to: 0 }));                                   // from = an EMPTY cell
```

```
1. after addEquip:  Knife | · | · | · | · | · | · | ·   cost 40
   second addEquip: Knife | · | · | · | · | · | · | ·   cost 40   (correctly refused)
2. after moveEquip{from:5(empty), to:0(filled)}:
                    Knife | · | · | · | · | Knife | · | ·   cost 80
3. after six more:  Knife | Knife | Knife | Knife | Knife | Knife | Knife | Knife   cost 320
4. same on a consumable: 8 × Dynamite Stick, cost 144, Throwables held 8 (cap is 4)
5. survives fromData(toData(...)): 8 cells, cost 144
```

**Player-facing consequence.** Every duplication silently adds one item's price to the total — a $40
Knife becomes $320 — and it bypasses *both* equipment rules the reducer enforces two functions above:
the one-tool-per-loadout guard at line 104 and the four-per-cap-category guard at line 110. The result
round-trips through `toData`/`fromData` unchanged, so it persists to localStorage and is savable to
the server (`server/src/routes/loadouts.js:88-115` validates trait *count* but nothing about
equipment). The build is priced confidently and cannot be fielded.

**Two aggravating facts.**

1. The comment directly above the reducer (`loadoutSlice.js:117-122`) states the invariant this
   violates, as a fact: *"A move is a PERMUTATION of cells and changes nothing but position: which
   items are equipped, the total cost, and every capacity total are untouched."* All three clauses are
   false for this input class. The next reader will trust it.
2. **`moveEquip` has zero tests.** `grep -rn '\bmoveEquip\b' client/src --include=*.test.js
   --include=*.test.jsx` returns **0 matches**. (Beware: a naive grep for `moveEquip` matches
   `removeEquip` as a substring, which is why this looks covered and is not.) Its only exercise is
   indirect, through `EquipmentPanel.test.jsx`'s simulated gestures — which only ever produce
   UI-legal inputs, i.e. exactly the inputs that do not trip this.

**Why P2 and not P1.** I traced all three dispatchers — `EquipmentPanel.jsx:57`, `:61` and `:121` —
and in every one `from` is a cell that held an item when the grab began (`startGrab` and the Space
handler both require `entry`; the keyboard path passes `grab.origin`, and any `removeEquip` nulls the
grab through `EquipmentSlot.jsx:121-132`). I could not construct a click-path. Inflating this to P1
on a defect I cannot show a user reaching would cost more credibility than it buys.
**A challenger who finds a path should promote this to P1** — the defect itself is not in question.

**Fix direction.** Make the reducer refuse a move whose source is empty, rather than relying on the
callers to never ask. The one-line predicate is "a move requires an occupant at `from`"; the swap
below it is already correct. Then give `moveEquip` a reducer-level test suite covering the four
occupancy combinations (empty→empty, empty→filled, filled→empty, filled→filled) — the missing test is
the reason a green suite says nothing here. Correct the comment at line 117-122 in the same change.

---

### F2 — No decoder enforces any equipment rule; a saved over-cap build loads, prices, and re-saves silently

- **Severity: P1**
- **Location:** `client/src/utils/loadoutCodec.js:121-125` (`fromV1`), `:406-417` (`fromV2`),
  `:354-358` (`fromLegacy`); `client/src/store/loadoutSlice.js:191-234` (`setLoadout`)
- **Status: CONFIRMED**

**Evidence.** All three decoders resolve equipment entries by catalog id and stop there. They apply
`boundedAmmo` (`:51-54`) and `boundedTraits` (`:75-77`), but nothing about the consumable cap or tool
uniqueness. `setLoadout` assigns `payload.equip` verbatim (`loadoutSlice.js:197`); its shape guard
(`:21-34`) checks types and lengths, never rules.

```
v2 decode of 4×Dynamite Stick + 4×Dynamite Bundle
  -> held 8, categories {"Throwable":8}, totalCost 372
     picker would allow a 9th Throwable? false        <- the cap is live, it just was not applied
     round-trips through toData unchanged?     true
v2 decode of 3× first-aid-kit
  -> ["First Aid Kit","First Aid Kit","First Aid Kit"], totalCost 90
legacy decode of the same shape
  -> {"Throwable":8}
control: 25 traits decode to 15                       <- boundedTraits DOES clamp
```

The trait control is the point: the codec already clamps the one cap it was asked to clamp, and
`boundedTraits`' own comment (`:56-74`) gives the reason — *"the store subscriber persists a decoded
loadout BEFORE it is rendered, so a decoder that refused an over-cap list would write the record it
rejects"*. That reasoning applies verbatim to equipment; it simply was never applied there.

**Why this is reachable, not theoretical.** ADR-0015 (`docs/adrs/ADR-0015-consumable-cap-per-type.md`,
accepted 2026-08-12 — **two days ago**) changed the cap from four-per-specific-item to
four-per-*type*, and records the consequence in its own words:

> Bad, because it is a visible tightening: **a build a user has already saved and shared may now
> exceed a cap it did not exceed when they built it.** The picker will disable items it previously
> offered.

Under the previous rule, four Dynamite Sticks plus four Dynamite Bundles was a legal, savable build
(ADR-0015 §Context states the app "accepts **eight** Throwables ... where the game permits four").
`CONS` holds 18 `Throwable` rows (`catalog.js:476-515`), so this was not a corner case. The README
links a live deployment; those records exist. ADR-0015 anticipated the picker disabling items. It did
not settle what happens when such a record is **loaded**, and the answer today is: nothing.

**And nothing tells the player.** `EquipmentPanel.jsx:131-133` renders only
`{equipCount}/8 SLOTS · MAX 4 PER CONSUMABLE TYPE` — a static caption, not a check. Compare
`WeaponsPanel.jsx:8,33-35`, which computes `overCap = used > max` and renders
*"Over capacity — drop a weapon or take Quartermaster."* The weapon cap has a warning surface; the
consumable cap has none, and the decoders explicitly decline to enforce the weapon one
(`loadoutCodec.js:308-311`: *"`fromV1` has never enforced `capMax` on decode"*) **precisely because
the UI warns**. Equipment gets the same permissiveness without the same safety net.

The only hint is inside the picker: `Picker.jsx:108` renders `cnt + "/4 of type"`, which reads
`8/4 of type` — visible only if the player opens the Consumables tab and reads a row's metadata.

**Player-facing consequence.** A saved loadout from last week opens with eight Throwables, a total of
`$372`, no warning anywhere, and cannot be fielded. Editing anything and re-saving writes it straight
back — the server's `isValidData` (`server/src/routes/loadouts.js:88-115`) bounds `tr` to
`MAX_TRAITS = 15` (`:78`) and validates `e`'s *shape* only. The over-cap state is stable indefinitely.

**Fix direction.** Two independent moves, and the second is worth doing regardless of the first:

1. Clamp on decode, the way traits already are — a `boundedEquip` beside `boundedTraits`, applied by
   all three decoders, dropping cells past the fourth of a category and past the first of a tool.
   That matches the "keep the record loadable and self-correcting" precedent the codec already sets.
2. Give the equipment panel the over-cap surface the weapons panel has, driven by the same
   `consAllowed`/`capCategoryOf` predicates rather than a re-derivation. That covers over-cap states
   arriving by any route, including F1's.

A note on ordering: clamping alone silently discards four items the user chose. The warning alone
leaves the arithmetic wrong. ADR-0015's own consequence list argues the tightening should be visible,
which points at doing the warning first.

---

### F3 — The generator can never produce a size-5 weapon without Quartermaster

- **Severity: P2**
- **Location:** `client/src/utils/randomize.js:52`
- **Status: CONFIRMED**

**Evidence.** The primary weapon pool is filtered to `WEAPONS[i][2] <= cap - 1`, reserving a size
point for a secondary unconditionally. Without Quartermaster `cap` is 5, so the primary pool is
`size ≤ 4` and the secondary pool is `size ≤ rem ≤ 4`. Size-5 weapons are therefore **structurally
excluded** from any build that did not draw QM (drawn at 30%, `randomize.js:28`).

Measured over **200,000 builds**:

```
QM present in 30.0% of builds
a size-5 weapon present in  0.96% of builds
a size-5 weapon present WITHOUT QM: 0 builds
weapons never drawn at all: 0
ten rarest: crown-king-auto-5=459  maynard-sniper-silencer=474
            mosin-nagant-avtomat=491  nitro-express=506   (all size 5)
ten commonest: ~5,400 each (all size 1)
```

The four affected rows: `catalog.js:146` `crown-king-auto-5`, `:147` `mosin-nagant-avtomat`,
`:148` `nitro-express`, `:311` `maynard-sniper-silencer`. Zero occurrences in ~140,000 non-QM builds
is a structural claim, not a rarity one.

The manual path disagrees: `loadoutSlice.js:75` accepts a lone size-5 weapon (`5 + 0 > capMax(5)` is
false), and `Picker.jsx:56` enables it. So the generator refuses a build the builder offers.

**Relationship to SPEC-0008.** The spec already notices the *line*, in its "Weapon Size Caps Are
Honored" implementation note: *"the primary filter reserves a point (`size <= cap - 1`), so with
size-1 weapons in the catalog a secondary always fits and the `null`-secondary path the requirement
describes is currently unreachable."* That is a statement about `weapons[1]` never being null. It does
**not** state the consequence measured here — that four catalogued weapons are unreachable in 70% of
builds and never appear alone. Same root cause, different unstated effect. I flag the overlap so
Round 2 can judge whether this is one finding or two.

**Player-facing consequence.** "Random loadout" cannot show four of the catalog's 147 weapons unless
it happens to roll Quartermaster, and can never show one as a solo build. A player using randomize to
explore the catalog sees a biased sample presented as an unbiased one — size-1 weapons appear roughly
11× more often than size-5.

**Fix direction.** Draw the primary against the full `cap`, then allow the secondary pool to be empty
and `weapons[1]` to be `null` — which is what SPEC-0008's "A large primary leaves room for nothing"
scenario already specifies and what the store already accepts (`isValidLoadoutShape` permits a null
slot, `loadoutSlice.js:31-33`). This makes an already-written, currently-unfalsifiable scenario
testable.

---

### F4 — The budget retry misses budgets that are demonstrably reachable

- **Severity: P2**
- **Location:** `client/src/utils/randomize.js:99-112`
- **Status: CONFIRMED**

**Evidence.** `randomizeLoadout` draws 81 *uniform, independent* attempts and keeps the cheapest —
there is no pressure toward cheapness within an attempt. Cost profile over **300,000 single attempts**:

```
min 142   p0.1% 207   p1% 271   p5% 341   median 594
P(one attempt ≤ 200) = 0.072%   ->  P(success in 81 attempts) =  5.6%
P(one attempt ≤ 250) = 0.520%   ->                              34.4%
P(one attempt ≤ 300) = 2.148%   ->                              82.8%
P(one attempt ≤ 350) = 5.950%   ->                              99.3%
```

A separate 40,500-attempt sample (500 runs at `budget: 100`) observed a build at **$123**, so the true
floor is ≤ $123. Direct measurement at fixed budgets, 500 runs each:

```
budget  100: over budget 500/500      budget  250: over budget 321/500
budget  150: over budget 500/500      budget  300: over budget  84/500
budget  200: over budget 470/500      budget  400: over budget   0/500
```

**Why this is a conformance failure and not just tuning.** SPEC-0008's "The Dollar Budget Is Searched
Within the Chosen Archetype" carries two scenarios. The degrade scenario is satisfied — the generator
does return the cheapest attempt, as specified. The other one is not:

> **Scenario: A reachable budget is met**
> **WHEN** `budgetOn` is true with a budget the selected archetype can reach
> **THEN** `totalCost` of the returned build is at or under `budget`

$200 is reachable (floor ≤ $123) and is met 5.6% of the time. $250 is met 34% of the time.

**Player-facing consequence.** A player sets a $200 budget and presses Randomize. Nineteen times in
twenty they get an over-budget build. The over-run is *visible* — `Header.jsx:17,33` and
`ActionsPanel.jsx:26-28` recolour the cost when `total > budget` — so the number shown is correct and
flagged. What is wrong is the app's implied promise: `randomizeThunk` (`thunks.js:21`) clears the
status message on every press, so the app never distinguishes "no build fits this budget" from "I
did not look hard enough", and the latter is almost always the true answer.

Downgraded from P1 for exactly that reason: the displayed cost is right and is marked.

**Fix direction.** Either bias the search (draw cheaper pools as attempts fail, or sort candidate
weapons by cost and walk down) so a reachable budget is actually found, or — cheaper and honest —
have `randomizeThunk` set a message when the returned build exceeds the budget, so "cheapest of 81"
is disclosed rather than implied. The first satisfies the scenario; the second stops the app
overstating what it did. SPEC-0008's archetype work will rewrite this function anyway, so the second
may be the right interim.

---

### F5 — The loadout shape guard accepts an equipment array shorter than eight cells

- **Severity: P3**
- **Location:** `client/src/store/loadoutSlice.js:24`
- **Status: CONFIRMED** (defect) / **not reachable from any current caller**

**Evidence.** The guard is `payload.equip.length > 8` — an upper bound only. A three-cell array is
accepted and assigned verbatim:

```
setLoadout accepted equip.length=3; hasFreeCell=false (5 cells should be free)
```

With three filled cells and no eighth, `hasFreeCell` (`calc.js:42-45`) finds no `null` and reports the
grid full. The picker (`Picker.jsx:47`) and the reducer (`loadoutSlice.js:99`) would both refuse every
equipment add, while `EquipmentPanel.jsx:145` still renders eight cells — five of which look empty and
clickable, and clicking one would *block* it rather than fill it.

Not reachable today: all three decoders pad to exactly eight (`loadoutCodec.js:142`, `:379`, `:406-417`),
`clearBuild` sets eight (`:182`), and `randomize` returns eight (`randomize.js:63`). The guard is the
only thing standing between a future fourth caller and this state, and it does not stand there.

**Player-facing consequence.** None today. If it ever fires: an app that silently refuses to equip
anything, with five cells visibly empty.

**Fix direction.** Make the guard exact — `length !== 8` — matching ADR-0009's fixed-grid model and
matching what the server already does for v2 records (`server/src/routes/loadouts.js:106`:
`if (data.e.length !== 8) return reject("e")`). The server is stricter than the client here, which is
backwards.

---

### F6 — Grid capacity is derived in three places, two of them dead, and a comment names a fourth that does not exist

- **Severity: P3**
- **Location:** `client/src/utils/calc.js:116-118`; `client/src/store/selectors.js:16`;
  `client/src/utils/loadoutCodec.js:329`
- **Status: CONFIRMED**

**Evidence.** `calc.js:116-118` exports `slotMax(loadout) = 8 - blocked.length`. `selectors.js:16`
exports `selectSlotMax`, an independent copy of the same expression. Case-insensitive search finds
**no production consumer of either** — `slotMax`'s only reference is its own test
(`calc.test.js:3,111,121-122`), and `selectSlotMax` has none at all. `loadoutCodec.js:329` refers to
"loadoutSlice's `slotMax`", which does not exist in `loadoutSlice.js`.

This matters because `calc.js:29-41` states the opposite as the design's central claim:

> Capacity is ONE predicate: "a free, unblocked cell exists." ... Every caller (reducer, picker,
> generator) consults this one predicate rather than re-deriving capacity, so the picker's enabled
> state and the reducer's acceptance cannot drift apart.

The live capacity predicate is indeed `hasFreeCell` everywhere it is consulted, so the claim's
*consequence* holds. But two unconsulted re-derivations sit beside it, and a third is named in a
comment — which is how the drift the comment forbids gets reintroduced.

**Player-facing consequence.** Indirect: `EquipmentPanel.jsx:132` advertises `{equipCount}/8 SLOTS`
regardless of how many cells are blocked, so a player with three blocked cells sees `5/8` when the
grid is as full as it can get. The one function that computes the usable count is the dead one.

**Fix direction.** Delete `selectSlotMax` and either delete `slotMax` or make the panel header use it,
and correct the `loadoutCodec.js:329` comment to name `hasFreeCell`. Whichever survives should be the
only one.

---

### F7 — Two comments state that the generator consults `hasFreeCell`; it does not import it

- **Severity: P3**
- **Location:** `client/src/utils/randomize.js:13-15` and `client/src/utils/calc.js:36-40`
- **Status: CONFIRMED**

**Evidence.** `randomize.js:13-15`: *"the per-category consumable cap (ADR-0015) is respected via the
SAME predicates the reducer uses — `consAllowed`/`hasFreeCell`."* Its import list is
`randomize.js:2`: `import { TRAIT_MAX, consAllowed, totalCost } from "./calc.js"` — no `hasFreeCell`.
The generator re-derives the free-cell scan inline at `randomize.js:17`:

```js
const free = equip.findIndex((e, k) => e === null && !blocked.has(k));
```

which is character-for-character the body of `hasFreeCell`'s predicate (`calc.js:44`). `calc.js:36-40`
makes the matching claim from the other side ("Every caller (reducer, picker, generator) consults this
one predicate").

Half of each comment is true — `consAllowed` **is** genuinely shared, and my fuzzing confirms the
generator never exceeds the cap (see Negative result). The `hasFreeCell` half is not, and the two
implementations are equivalent only by coincidence of being written the same day.

**Player-facing consequence.** None today. The exposure is that a future change to `hasFreeCell` —
say, treating a cell held by a stack differently — would be picked up by the reducer and the picker
and silently missed by the generator, which is precisely the drift both comments claim is impossible.

**Fix direction.** Import and call `hasFreeCell` from `place()`, or amend both comments to say the
generator carries its own equivalent scan. Sharing the predicate is cheaper than maintaining the
claim.

---

### F8 — The preview's trait comment states three things that are all false, and guards a state that cannot occur

- **Severity: P3**
- **Location:** `client/src/components/LoadoutListsPanel/LoadoutListsPanel.jsx:105-110`, `:196-200`,
  `:824-826`
- **Status: CONFIRMED**

**Evidence.** The comment above `TRAIT_CELLS = 15`:

> It is a fact about the game, not an invariant this application enforces: `upBudgetOn` is off by
> default, **the catalog holds 32 traits and the server accepts 40**, so a loadout holding more than
> fifteen is an ordinary savable record.

Three claims, three contradictions:

| Claim | Actual |
|---|---|
| "the catalog holds 32 traits" | **58** — `TRAITS.length === 58`, rows at `catalog.js:660-825` |
| "the server accepts 40" | **15** — `MAX_TRAITS = 15`, `server/src/routes/loadouts.js:78`, enforced at `:113` |
| "not an invariant this application enforces" | It is enforced on every writer (below) |

The "40" is `WIRE_CATEGORIES.tr` (`loadouts.js:33`), which bounds each trait *reference's numeric
value*, not the count — and the server's own comment at `:76-77` calls out that exact confusion:
*"Distinct from `WIRE_CATEGORIES.tr` above, which bounds each trait REFERENCE's numeric value against
the catalog's size. That one is validation slack on an index; this one is the count."* The client
comment made the mistake the server comment was written to prevent.

On enforcement, I checked every writer of `state.traits` — this is the "is `TRAIT_MAX` enforced on
every writer?" half of my charge:

| Writer | Enforced? |
|---|---|
| `addTrait` (`loadoutSlice.js:156`) | yes — refuses at 15 |
| `fromV1` / `fromV2` / `fromLegacy` | yes — all three call `boundedTraits` (`loadoutCodec.js:146`, `:431`, `:383`) |
| `randomizeLoadout` (`randomize.js:41`) | yes — bounded by `TRAIT_MAX` as well as by the draw count |
| server POST (`loadouts.js:113`) | yes — rejects rather than truncating |
| `setLoadout` (`loadoutSlice.js:191-234`) | **no clamp** — but all three of its callers pre-clamp |

Verified: 25 trait ids decode to 15.

**Consequence.** `previewGroups`' `traitOverflow` (`:196-200`) and the `+N more` affordance it drives
(`:824-826`) can never fire. `LoadoutCard` (`:1299`) builds its preview from `fromData(item.data)`,
which clamps to 15, and `TRAIT_CELLS` is 15, so `traitsHeld - traits.filter(Boolean).length` is
always ≤ 0. This is dead defensive code kept alive by a comment asserting a reachability that no
longer exists.

**Player-facing consequence.** None directly. The cost is to the next reader: the comment is
load-bearing (it justifies why the grid does not derive from the UP budget) and its supporting facts
are wrong by 26 traits and by a factor of two-and-a-half on the server bound.

**Fix direction.** Correct the three figures and re-state the last clause — fifteen *is* an enforced
invariant on all five writers, and the grid is fixed at fifteen because the game's cap is fifteen, not
because the app tolerates more. Then decide deliberately whether `traitOverflow` stays as defence
against a future unclamped writer or goes; either is defensible, but it should not survive by accident.

---

### F9 — `mkAmmo` reads a pool unguarded where `totalCost` guards the same lookup

- **Severity: P3**
- **Location:** `client/src/utils/randomize.js:58` vs `client/src/utils/calc.js:152`
- **Status: CONFIRMED** (asymmetry) / **not live**

**Evidence.**

```js
// randomize.js:58
Math.random() < 0.3 && AMMO[WEAPONS[i][4]].length ? ... : -1
// calc.js:152
const variant = w.a >= 0 ? (AMMO[WEAPONS[w.i][4]] || [])[w.a] : null;
```

`calc.js` defends against a missing pool key; `randomize.js` does not, and would throw a `TypeError`
on ~30% of draws for such a weapon. Not live: all ten `ammoClass` values used by `WEAPONS` are present
in `AMMO`, and both directions are clean —

```
ammoClasses used:  compact,medium,hxbow,none,long,bow,special,shotgun,xbow,slong
AMMO keys:         compact,medium,long,slong,shotgun,xbow,hxbow,bow,special,none
used-but-missing: []      declared-but-unused: []      AMMO_LABEL missing: []
```

The **empty** pools are handled correctly, which is the part of my charge this answers: the `.length`
test short-circuits, so `special` and `none` weapons always get `a: -1`. Confirmed over 200,000
builds — `special` and `none` were never selected as an ammo class, and no ammo index was ever out of
range for its pool in 33,000 fuzzed builds across 11 scenarios.

**Fix direction.** Mirror `calc.js`'s `|| []`. One character's worth of asymmetry between two readers
of the same table is the kind that survives a scrape adding a weapon whose class the pool table lacks.

---

### F10 — `consCount` was retired by ADR-0015 and is still exported

- **Severity: P3**
- **Location:** `client/src/utils/calc.js:133-135`
- **Status: CONFIRMED**

**Evidence.** ADR-0015's Decision Outcome: *"The per-item cap is not kept alongside it: four of one
item is already four of its type, so per-type subsumes it."* `calc.js:96-97` records the same:
*"Per-item counting is RETIRED, not kept alongside."* `consCount` remains exported; its only reference
is `calc.test.js:3`. ADR-0015 rejected the "enforce both caps" option partly because *"a future reader
cannot tell which is load-bearing"* — leaving the retired function exported next to the live one
reproduces that ambiguity in code, having avoided it in the rules.

**Player-facing consequence.** None. Filed because a future caller reaching for the obviously-named
`consCount` gets the retired per-item rule and would pass review.

**Fix direction.** Delete it, or rename it to state that it is a per-item count and not the cap.

---

## Negative result

Everything below I checked and found **clean**. Listed so the next review does not redo it.

**Weapon size — fully pinned, no unpinned rows.** My charge said to derive the unpinned list myself
rather than wait for Seat 2. I did, and it is empty:

```
WEAPONS with no itemStats record:                 0 of 147
WEAPONS whose record carries no `Size` field:     0 of 147
size MISMATCH between catalog[2] and fields.Size: 0
non-integer Size strings in the scrape:           0
size histogram: {1:25, 2:35, 3:28, 4:55, 5:4}     all within the documented 1–5
```

Every weapon's `size` — the input to `capUsed` — is machine-pinned and agrees with `itemStats.json`.
I found **no** weapon size that makes an impossible loadout look legal or a legal one look impossible.
(This says nothing about whether the *scrape* is current; that is Seat 2's and it is unresolved.)

**The other arithmetic columns pin too.** Weapon `cost`, tool `cost`, consumable `cost`: 0 records
missing, 0 mismatches. The only four apparent weapon-price disagreements —
`flame-rifle`, `homestead-78`, `shredder`, `wildland`, catalog `0` vs scrape `"Scarce"` — are
ADR-0013's unpurchasable-is-zero rule, not defects.

**Trait `up` pins, and the eight zeroes are structural.** 0 mismatches. Eight traits carry `up = 0`
(`berserker`, `catalyst`, `death-cheat`, `rampage`, `relentless`, `remedy`, `shadow`, `shadow-leap`);
all eight are exactly the rows whose scraped infobox carries **no `Cost` field at all** and whose
`acquisition` is `Scarce` (two also `Burn`). `up` histogram: `{0:8, 1:11, 2:9, 3:13, 4:8, 5:3, 6:2,
7:1, 8:2, 9:1}`. So `upTotal` treats the eight Scarce traits as free, which is what the source says.
`[UNVERIFIED]` whether a Scarce trait costs upgrade points in the live game — the wiki is unreachable
and I will not guess.

**No consumable row's `type` is undeclared today.** This is the live-data-error my charge asked about,
and the answer is no: `CONS` uses exactly `Shot` (9), `Throwable` (18), `Placeable` (3), all three
members of `CONS_CAP_CATEGORIES` (`catalog.js:552`). `capCategoryOf` therefore never returns
`UNDECLARED_CATEGORY` for any catalogued row. The sentinel is untriggered, and `catalog.test.js:259-303`
pins it that way.

**`CONS_CAP_CATEGORIES` vs `CONS_TYPES` is deliberate and correctly consumed.** `Tarot Cards` is in
the cap list and not in the type list, which `catalog.js:526-565` explains at length (the cap must be
able to see a category before it has rows; the type list exists only so the badge palette has one
colour per visible category). Every consumer reads the right one: the cap reads `CONS_CAP_CATEGORIES`
(`calc.js:1,83`); the badge palette reads `CONS_TYPES` (`catalog.test.js:319-322`); no production code
reads `CONS_TYPES` for a rules decision. `catalog.test.js:272-282` pins both directions of the subset
relation.

**The generator respects every cap I could throw at it.** 11 option scenarios × 3,000 builds = 33,000
builds, eight invariants each:

```
plain                                  violations {}
blocked [0]                            violations {}
blocked [0,1,2,3,4,5,6]                violations {}
blocked all 8                          violations {}
budget 100 / 0 / -5                    violations {}
upBudget 0 / 1                         violations {}
budget 50 + upBudget 2 + blocked [3,4] violations {}
```

Zero over-slot-cap builds, zero over-trait-cap builds, zero duplicate traits, zero items in blocked
cells, zero categories above four, zero duplicate tools, zero out-of-range ammo indices, `equip.length
=== 8` every time. **The randomizer cannot produce a loadout the manual UI would refuse** on any of
those grounds. It uses the reducer's own `consAllowed` (`randomize.js:79`), and my fuzzing confirms
the sharing is real, whatever F7 says about `hasFreeCell`.

**Degenerate generator inputs do not hang, throw, or return malformed grids.**

- All eight cells blocked → the starter placement fails, the fill loop is skipped, an eight-`null`
  grid with two weapons is returned. No hang.
- Budget `0` and budget `-5` → an over-budget build (the cheapest of 81), per SPEC-0008's
  "unreachable budget degrades to the cheapest attempt". Correct by spec; see F4 for the *reachable*
  case.
- `upBudget: 0` → Quartermaster is dropped, and only zero-cost traits are taken. No violation.
- Empty ammo pools (`special`, `none`) → never drawn, `a: -1` every time. See F9.

**Full catalog reach for tools and consumables.** Over 20,000 builds each: 0 of 21 tools never drawn,
0 of 30 consumables never drawn. `TOOLS[0]` appears only as the guaranteed starter, which is correct
today — the draw at `randomize.js:71` is `1 + floor(random × (TOOLS.length - 1))`, i.e. indices 1–20,
and `first-aid-kit` is `TOOLS[0]`. I checked this specifically because the comment at `:61-62` claims
reorder-safety ("resolved by stable catalog id so a future reorder of TOOLS can't silently remap");
the *starter* is id-resolved and safe, but the draw range hardcodes the exclusion of index 0. Not
filed as a finding — nothing is wrong today, the dedupe at `:72` prevents the duplicate, and the only
symptom of a future reorder would be one tool becoming undrawable. Recording it here so it is not
re-derived.

**Stacking is arithmetically consistent with cost and cap.** `equipRuns` (`stacking.js:24-42`) derives
runs from the grid at render time and stores nothing, so the badge count *is* `cells.length`, and both
`totalCost` (`calc.js:155-158`) and `consCategoryCount` (`calc.js:98-101`) iterate the same cells. A
`×3` stack is charged three times and counts 3 against its category — which is what SPEC-0006's
scenario "A stack counts toward its category's cap by its full quantity" requires. I could construct
no state where the badge and the charge disagree, including after F1's duplication (the duplicated
cells simply extend or split runs, and all three numbers move together). SPEC-0006's
`MUST NOT admit any state in which the badge and the number of cells the stack occupies disagree`
holds, and it holds *structurally*, because the quantity is derived.

Adjacency across the rank break is also fine: SPEC-0006 defines a run over consecutive **cell
indices**, and its transpose requirement (spec line 109) preserves each cell's neighbours in both
arrangements, so `stacking.js` not reading the arrangement token is correct rather than an oversight.

**Weapon over-capacity from the manual path is surfaced.** Take Quartermaster, equip size 5 + size 1
(6/6), then remove Quartermaster:

```
with QM:                capUsed 6 / capMax 6
after removeTrait(QM):  capUsed 6 / capMax 5   -> overCap = true
```

Nothing re-validates on trait removal — but `WeaponsPanel.jsx:8,33-35` computes `overCap` on every
render and shows *"Over capacity — drop a weapon or take Quartermaster."*, and `:22-23` recolours the
pips. The state is reachable and it is disclosed. Not a finding. It is also the model F2 asks for.

**The `Picker` and the reducer agree on the consumable cap.** Both go through `consAllowed`
(`Picker.jsx:104`, `loadoutSlice.js:110`), and the picker's displayed count goes through
`consCategoryCount` (`Picker.jsx:103`) — the same function the cap reads, not a parallel count. This is
SPEC-0006's "the picker's enabled state derive from the same predicate the reducer enforces" and it
holds.

**Blocked cells are not counted as room by any live caller.** `hasFreeCell` (`calc.js:42-45`),
`addEquip`'s free-cell scan (`loadoutSlice.js:100-101`) and the generator's `place` (`randomize.js:17`)
all test `e === null && !blocked.has(k)`. `toggleBlockedSlot` (`:144-149`) refuses to block an occupied
cell; `moveEquip` (`:134`) refuses any move touching a blocked cell; `addEquip` skips them. The only
route to an item sitting in a blocked cell is a hand-built decoded record, and it renders and is
removable when it happens (`EquipmentSlot.jsx:134` gates the blocked chrome on the cell being empty).
See F6 for the dead re-derivations, which is a different complaint.

**Ammo pool integrity.** No `ammoClass` used by a weapon is missing from `AMMO`; no `AMMO` key is
unused; every used class has an `AMMO_LABEL`. The two empty pools are empty deliberately
(`catalog.js:55-65`).

---

## Handoffs

Noticed outside my charge. **Not investigated** — flagged for the chair.

1. **Stack-as-a-unit dragging is specified and not implemented.** SPEC-0006 (spec line 191): *"Dragging
   any cell of a stack SHALL move the entire run as a unit ... Stack drops SHALL NOT swap."*
   `moveEquip` moves and swaps single cells. Line 193's "removing a stack's anchor ... the remaining
   copies SHALL close up" happens to hold for free (removing the lowest cell of a contiguous run leaves
   the rest contiguous), but the comment at `EquipmentSlot.jsx:164-166` describes copies moving, and
   nothing moves. **Seat 5** (ADR/spec conformance). No wrong number results — I checked; the badge,
   cost and cap all stay consistent.

2. **Escape does not cancel a keyboard grab once it has been arrowed.** `EquipmentSlot.jsx:49-54`
   cancels only when `ref.current.from === index`, but `EquipmentPanel.jsx:111` walks `from` away from
   the origin. Escape on the origin cell is then a no-op and the grab persists. **Seat 5** /
   accessibility. Not arithmetic.

3. **The picker disables every weapon once both slots are full**, while the reducer would replace slot
   1. `Picker.jsx:54-56` sets `free = -1` and `other = 999` when both slots are occupied;
   `loadoutSlice.js:73` picks slot 1 and would accept the swap. The picker is the stricter of the two,
   so no illegal build results — but a player cannot swap a weapon without removing one first, and the
   two paths disagree about whether that is a rule. **Seat 5.**

4. **`sourceRevision` clustering.** The trait records I sampled sit around `15616-15772` while
   `nagant-m1895` is `16192` — a spread of ~500 revisions between corners of the dataset. I did not
   pursue this; it is **Seat 2**'s "stale corner" bullet and they should have the whole distribution,
   not my four samples.

5. **`package.json` pins `node: ^20`; the image runs v22.22.2**, so `npm ci` fails `EBADENGINE` and
   needs `--engine-strict=false`. Relevant to SPEC-0002 (Developer Environment Consistency) and to
   anyone reproducing this panel's work. Not a data defect.

6. **The panel's declared blind spot.** Items missing from the catalog entirely are invisible from
   inside it, `scrape-stats.mjs --discover` is the only instrument, and no seat may run it. My charge
   is arithmetic *over* the catalog, so a weapon the catalog does not carry has no size for `capUsed`
   to get wrong — but "the generator draws from a complete catalog" is an assumption I inherited and
   did not test. Recording it so the report's silence does not read as coverage.
