---
status: implemented
date: 2026-08-10
implements: [ADR-0009, ADR-0015]
requires: [SPEC-0001]
---

# SPEC-0006: Equipment Slot Arrangement

## Overview

> **This capability is implemented.** The Overview below states the problem it solved, in the present tense of the world before it shipped. Read every "is" in this section as "was" — `state.equip` is a sparse eight-cell array today, `blocked` is a list of cell indices, and the grid is two fixed ranks of four. See **Implementation status** below for the evidence, including the current `FORMAT_VERSION` (this banner previously named a specific number here and went stale itself when the version moved on, per `/sdd:audit` 2026-08-17 — read the status section rather than this banner for that fact). This banner exists because the un-marked version of this section was read as current fact and copied into SPEC-0008, which then told its own readers that the live array was still packed.

The Equipment panel renders eight cells but does not have eight slots. `state.equip` is a **dense packed array**; the array index is the cell, so items are pinned to the front of the grid in whatever order they were added, and unequipping the first item slides every item behind it one cell to the left. A player carrying three items occupies cells 1–3 and has no way to reach cell 8.

This capability makes cell position a stored, user-controlled property of the loadout. It realizes [ADR-0009](../../../adrs/ADR-0009-equipment-slot-grid-model.md), which chose a fixed sparse eight-cell array — index is the cell, `null` is an empty cell — over reorder-only drag on the packed array, a packed array with a parallel position map, and an explicit quantity field on entries.

Four changes follow from that one decision, and they are not separable:

- **Free placement.** Any item may sit in any cell, and gaps between items are legal. Removal writes `null` in place rather than splicing, so nothing moves that the user did not move.
- **Per-cell blocking.** `blocked` stops being a count and becomes a set of cell indices. The current model infers blockedness from `index >= slotMax`, which is simply wrong once an item can legitimately sit in cell 8 with four empty cells in front of it.
- **Wire format v2.** Cell position that is not in the payload does not survive a save, a share link, or a reload. `FORMAT_VERSION` goes to 2.
- **Fixed two-rank geometry** *(added 2026-08-12 with ADR-0009's amendment of the same date)*. `.equip-grid` was `repeat(auto-fill, minmax(140px, 1fr))`, so the panel's track count was whatever fit its width — four columns only above roughly a 1434px viewport, three through most of the desktop range, two around 1024px. A stored cell position only buys recognition if it names a stable place, arrow-key movement needs a known track count to define "the cell below this one", and derived stacking renders an adjacency a reflowing grid breaks and reforms at different widths. The grid becomes two ranks of four, transposed on a narrow panel — a rotation that preserves every cell's neighbours, not a reflow to a different track count.

**Stacking is derived, not stored.** Repeated consumables in adjacent cells render as one tile with a quantity badge; the cells behind the anchor render as held by that stack. There is no stored quantity, so the badge cannot disagree with the cell count. Duplicate *tools* remain forbidden by the existing `addEquip` guard, which is why a run of length ≥ 2 can only ever be consumables — the consumables-only property falls out of a rule that is already enforced and already tested, rather than being restated here as a special case.

**The load-bearing constraint was the server validator — and it is satisfied.** `server/src/routes/loadouts.js` used to reject a `data.e` containing `null` and a `data.b` that was not a number, which made a v2 payload a 400 and meant the client half of this capability was not shippable alone. `isValidData` now branches on the version: at v2 it requires `data.e` to be exactly eight entries of `null`-or-entry and `data.b` to be an array of distinct cell indices in `0..7`, and it still accepts the v1 shape. That was the only sequencing constraint in the capability, and "Saved-Loadout Payloads Are Validated at Both Versions" is where it is made testable.

**Item imagery is unchanged and inherited.** Every cell that depicts an item — an ordinary tile or a stack anchor — renders through the same shared container and the same scraped-image-then-SVG-fallback chain that SPEC-0001 (Equipment Iconography) specifies. This capability changes which cell a tile is drawn in and how many tiles a run of identical consumables produces; it changes nothing about how the image inside a tile is resolved.

**Duplicate consumables are already legal, and the cap is per type** *(revised 2026-08-12, per [ADR-0015](../../../adrs/ADR-0015-consumable-cap-per-type.md))*. Two Vitality Shots is a valid loadout and consumes two of eight cells. What bounds repeats is the **cap category** — `CONS[i][3]`, holding `Shot`, `Throwable`, `Placeable` and `Tarot Cards` *(the fourth admitted 2026-08-15 by #37; this clause read "once admitted" until then)* — and four consumables of one category is the limit however they are distributed across specific items. So four Dynamite Sticks **do** block a Dynamite Bundle: both are `Throwable`, and the fourth Stick exhausts that budget.

This paragraph previously stated the opposite — four copies of one *specific* consumable, with `type` "descriptive and not a rules input", and two different consumables never sharing a budget. That was correct against `consCount()` as implemented and against SPEC-0007's prohibition, but wrong against the game: Update 2.8 restricts consumables to "4 instances of the same type (Throwables, Placeables, Shots and Tarot Cards)", confirmed by an in-game Arsenal observation on 2026-08-12. ADR-0015 records the reversal and the evidence. **`type` is therefore a rules input**, and SPEC-0007's `MUST NOT` against using it as a cap key is withdrawn by the same decision. This capability changes how repeats read; ADR-0015 changes what bounds them.

**Implementation status** *(corrected 2026-08-13; caveated 2026-08-17 per `/sdd:audit`, five of six caveated defects fixed the same day)*. **This capability is implemented.** All twelve requirements are built and, as of this correction, carry tests that name them — see the notes on "Keyboard Equivalence for Every Pointer Gesture" for the one gap (grid accessible name / positional set) still open.

- **Equipment Occupies a Fixed Eight-Cell Grid** — `state.equip` is a fixed eight-element array with `null` holes; `heldItems`, `totalCost`, `selectEquipCount`, `toData`/`fromData` and the randomizer all derive from occupied cells rather than array length.
- **The Grid Renders as Two Ranks of Four** — a fixed 4-track grid with column-major fill, transposed to 2×4 by a panel-width `@container` query. The threshold is declared once, in that query, and the keyboard reads the arrangement from a token the query sets rather than measuring geometry.
- **Cells Are Individually Blockable** — `blocked` is an array of cell indices; `toggleBlockedSlot` refuses an occupied cell, `slotMax()` is `8 - blocked.length`, and placement skips blocked indices.
- **Items Are Rearranged by Direct Manipulation** — one `moveEquip` operation behind both pointer drag and the keyboard, with an off-grid drop as one remove path and a dedicated per-cell control *(named 2026-08-16, per #241)* as the other; a zero-movement click is neither.
- **Repeated Consumables Read as One Stack** — `utils/stacking.js` derives runs at render time; the badge is computed from the run, never stored. `addEquip` places a picker-added copy immediately after an existing run's last cell when that cell is free and unblocked, falling back to the lowest free cell otherwise *(fixed 2026-08-17 per `/sdd:audit` — the append clause was previously unimplemented; both of the spec's own scenarios happened to be satisfiable by the lowest-free rule alone, which is why the gap went untested. See `client/src/store/loadoutSlice.js` and its "picker run-append placement" test group.)*
- **Capacity Rules Are Stated Once and Preserved** — one `hasFreeCell` predicate, and the four-per-category cap read from `CONS_CAP_CATEGORIES` in `catalog.js`.
- **Wire Format Version 2 Encodes Cell Position** — `FORMAT_VERSION` is 2 and `toData` emits eight positional entries.
- **Version 1 Records Migrate Losslessly** — `fromV1` and the legacy positional decoder both pad to eight cells.
- **Randomized and Bulk-Set Loadouts Produce Well-Formed Grids** — the generator builds `Array(8).fill(null)` and leaves holes at blocked positions; `isValidLoadoutShape` gates bulk payloads.
- **Error Handling at the Payload Boundary** and **Saved-Loadout Payloads Are Validated at Both Versions** — the server's `isValidData` branches on version and names the offending field on rejection.
- **Keyboard Equivalence for Every Pointer Gesture** — every pointer gesture has a paired keyboard test in `EquipmentPanel.test.jsx`. *(Six defects found against this requirement's own text via `/sdd:audit` 2026-08-17; five fixed the same day — the narrow-arrangement arrow mapping was a row-major transpose rather than this requirement's column-major model and wrapped across the rank break the requirement forbids, now corrected in `gridMove.js` with the previously-wrong test replaced and the missing narrow-edge scenario added; grab/target/commit announcements now exist (previously only rejection was announced); focus now moves to the destination cell after a successful move or swap instead of being lost to `document.body`; Enter now toggles an empty cell's blocked state instead of unconditionally calling `preventDefault`; stack continuation cells beyond the first now carry `tabIndex={0}` instead of being permanently unreachable. **Still open:** the grid carries no accessible name or positional set — see "Accessibility Requirements" below, which this bullet's "built and tested" claim continues to overstate on that one point.)*

This note previously read: "Nothing in this capability is implemented. `state.equip` is still packed, `blocked` is still a count, `FORMAT_VERSION` is still 1, and the panel has no drag affordance." All four clauses were false. The cost was not confined to this document — SPEC-0008 cited this note as authority for telling its readers the live array was dense and packed, so a stale status line in one spec became a false statement of fact in another. SPEC-0003 still carries two preview scenarios annotated as unexercisable "until the sparse model lands"; that annotation is now wrong for the same reason and is not corrected here.

**Interaction with SPEC-0003** *(updated 2026-08-10)*. This paragraph previously said SPEC-0003's preview "sheds later slots before earlier ones as width narrows" and would need a one-line amendment when the sparse model landed. **That amendment has already happened**, and it went further than one line: SPEC-0003's preview is now a fixed-cell categorised panel, the shed-by-width rule is withdrawn, and the requirement is stated in terms of *cells occupied* rather than array shape — so it read correctly under both the packed array and this capability's sparse one, and needed no change when this landed.

What remains owed to SPEC-0003 is narrower and additive, and it is **now due rather than anticipated**: this capability introduced **consumable stacking** and **per-cell blocking**, and SPEC-0003 explicitly scopes both out of its preview. SPEC-0003 needs a clause saying whether a preview renders a stack as one badged cell (as the builder does) or as repeated cells, and whether a blocked cell is drawn distinctly from an empty one. Two of SPEC-0003's preview scenarios are also still marked as unexercisable until the sparse model exists; it exists, so they are live and their annotations are stale. None of that is fixed here — it is work owed against SPEC-0003.

## Requirements

### Requirement: Equipment Occupies a Fixed Eight-Cell Grid

`state.equip` SHALL be an array of exactly eight elements. Each element SHALL be either `null`, meaning the cell is empty, or an entry object `{ t, i }` where `t` is `"T"` or `"C"` and `i` indexes the corresponding catalog array. The array index SHALL be the cell position, for every array state, without exception.

Removing an item SHALL write `null` into that item's cell. It MUST NOT splice the array, MUST NOT change the length of the array, and MUST NOT alter the cell of any other item.

Every consumer that iterates, counts, or encodes `state.equip` SHALL tolerate holes. Specifically, `consCount()`, `totalCost()`, `toData()`, the randomizer, and the equipment-count selector SHALL each derive their result from the occupied cells only, and MUST NOT treat the array length as the number of equipped items.

#### Scenario: Removing an item leaves the others where they were

- **WHEN** a loadout holds items in cells 1, 2, and 3, and the user removes the item in cell 1
- **THEN** cell 1 SHALL become empty and the items previously in cells 2 and 3 SHALL still be in cells 2 and 3

#### Scenario: An item may occupy a high cell while low cells are empty

- **WHEN** a loadout holds exactly one item, placed in cell 8
- **THEN** the loadout SHALL persist, reload, and re-render with that item in cell 8, and cells 1 through 7 SHALL render as empty

#### Scenario: Derived totals ignore empty cells

- **WHEN** a loadout holds two items with six empty cells between and around them
- **THEN** the equipment count SHALL be 2, and the total cost SHALL be the sum of exactly those two items' costs

### Requirement: The Grid Renders as Two Ranks of Four

The equipment grid SHALL render as exactly **two ranks of four cells**. Cells 1 through 4 SHALL form the first rank and cells 5 through 8 the second, so cell *n* (zero-indexed) occupies position `n % 4` along its rank and rank `floor(n / 4)`. The track counts MUST NOT be derived from the available width, from the number of equipped items, or from `slotMax()`.

The grid SHALL have exactly two arrangements and no others:

- **Wide** — ranks are rows. Four columns by two rows, cell 1 top-left, cell 5 directly below cell 1.
- **Narrow** — ranks are columns. Two columns by four rows, cells 1 through 4 running down the first column and 5 through 8 down the second, cell 5 directly right of cell 1.

The narrow arrangement SHALL be the **transpose** of the wide one. Every cell SHALL keep the same neighbours in both, and the rank break SHALL fall between cells 4 and 5 in both. The system MUST NOT render the eight cells at any other track count — four rows of two is a different arrangement of the same payload, not a rotation of it, and is forbidden.

Cells SHALL be laid out in DOM order in both arrangements, so the visual reading order is left-to-right then down when wide and top-to-bottom then across when narrow, and matches DOM order in both without reordering elements.

**The arrangement SHALL be selected by the width of the equipment panel, not by the width of the viewport.** The panel sits in a flex column beside a wider one, so the two are not proportional: the panel is at its narrowest at viewports just above the point where the columns stack, and becomes markedly wider once they do. A viewport-keyed threshold would select the narrow arrangement at widths where the wide one fits and the wide arrangement at widths where it does not.

The threshold SHALL be declared in exactly one place and consumed by both the stylesheet and the keyboard sensor. Neither the sensor nor any other consumer MAY determine the current arrangement by measuring rendered geometry or reading back a computed track count.

Where the grid is too narrow to draw cells at their preferred size in its current arrangement, the cells SHALL shrink. The grid MUST NOT scroll horizontally and MUST NOT hide a cell. A blocked cell and an empty cell each occupy their position like any other; the grid's arrangement SHALL NOT vary with how many cells are occupied or blocked.

The saved-loadout preview's equipment grid (`.ll-lp-equip`) SHALL keep its four-across shape at all widths and SHALL NOT transpose, because its cells are floored thumbnails that fit four across at any width and it sits in a card that may be narrow at any viewport. The parity SPEC-0003 REQ "Filed Loadouts Preview Their Contents" asks for SHALL be read as parity of ranks and cell counts, which both honour; on a narrow panel the builder and the preview differ by a rotation, and that is accepted.

#### Scenario: A narrow panel transposes rather than reflowing

- **WHEN** the equipment panel is narrower than the declared threshold
- **THEN** the grid SHALL render as two columns of four, with cells 1 through 4 down the first column, and it MUST NOT render as four rows of two

#### Scenario: Transposition preserves every cell's neighbours

- **WHEN** the same loadout is rendered in the wide arrangement and in the narrow one
- **THEN** each cell SHALL have the same set of adjacent cells in both, and the rank break SHALL fall between cells 4 and 5 in both

#### Scenario: The arrangement follows the panel, not the viewport

- **WHEN** the viewport is wide enough that the builder's two columns sit side by side, and the equipment panel is consequently narrower than the declared threshold
- **THEN** the grid SHALL render in the narrow arrangement, even though the viewport is not narrow

#### Scenario: Occupancy does not change the grid's arrangement

- **WHEN** a loadout holds one item and blocks two cells
- **THEN** the grid SHALL render eight cells as two ranks of four, identically in arrangement to a full grid

### Requirement: Cells Are Individually Blockable

`state.blocked` SHALL be a list of cell indices in the range `0..7`, with no duplicates. `slotMax()` SHALL return `8 - blocked.length`.

A cell's blocked state SHALL be determined by membership in that list. The system MUST NOT infer blockedness from a cell's index relative to `slotMax()`.

Only an empty cell MAY be blocked. Blocking SHALL be rejected for a cell that holds an item, including a cell held by a stack. A blocked cell MUST NOT accept an item by any route — picker placement, drag, keyboard placement, bulk load, or randomization.

*(Corrected 2026-08-16, per #241 — this requirement stated what blocking means and never stated the gesture that triggers it.)* Blocking SHALL be activated by the empty cell's own control — a click, or Enter/Space while it holds keyboard focus — and MUST NOT be triggered by any other cell's gesture, including a drag that ends over it. An empty cell is a valid drop target under "Items Are Rearranged by Direct Manipulation": the system SHALL distinguish a drop released over an empty cell from a click on that same cell, and a drop MUST NOT toggle the cell's blocked state.

#### Scenario: An empty cell is blocked by its own control

- **WHEN** the user clicks an unblocked, unoccupied cell, or reaches it by keyboard and presses Enter or Space
- **THEN** the cell SHALL become blocked

#### Scenario: A drop onto an empty cell does not block it

- **WHEN** the user drags an item from another cell and releases it over an empty, unblocked cell
- **THEN** the item SHALL move to that cell, and the cell's blocked state MUST NOT change as a side effect of the drop

#### Scenario: A middle cell is blocked while later cells stay usable

- **WHEN** the user blocks cell 4 in an otherwise empty grid
- **THEN** cell 4 SHALL render as blocked, cells 5 through 8 SHALL remain available for placement, and `slotMax()` SHALL be 7

#### Scenario: An occupied cell cannot be blocked

- **WHEN** the user attempts to block a cell that holds an item
- **THEN** the cell SHALL remain occupied and unblocked, and the loadout SHALL be unchanged

#### Scenario: A blocked cell rejects placement

- **WHEN** cell 3 is blocked and the user attempts to drop an item onto it
- **THEN** the drop SHALL be rejected, the dragged item SHALL return to its origin cell, and the loadout SHALL be unchanged

### Requirement: Items Are Rearranged by Direct Manipulation

The system SHALL provide a single move operation over the grid, expressed as "move the contents of cell A to cell B". Pointer drag and the keyboard equivalent required by "Keyboard Equivalence for Every Pointer Gesture" SHALL both be callers of that one operation, and MUST NOT implement divergent placement rules.

Dropping an item onto an **empty, unblocked** cell SHALL move it there. Dropping an item onto an **occupied** cell SHALL swap the two cells' contents. Dropping an item onto its own cell or onto a blocked cell SHALL be a no-op that returns the item to its origin.

*(Corrected 2026-08-16, per #241 — "the designated remove target" named an affordance ADR-0009 does not mention and this spec never placed in any component; "the existing click-to-remove" described a gesture that collides with drop-on-origin, once click and drag share one event sequence.)* Releasing a drag anywhere outside the grid — not a specific in-grid target — SHALL unequip the dragged item. Removal is otherwise reachable **only** through a dedicated, always-present per-cell control, distinct from the drag source and distinct from the tile body: activating that control SHALL unequip the item it names. A press-and-release on the tile body or drag handle with no movement between — a click, in the sense of zero pointer travel — SHALL be treated identically to a drag released back onto its own cell: a no-op, per the scenario above. It MUST NOT unequip the item. This is what keeps the two rules from colliding: "click removes" is withdrawn, and only the dedicated control does.

Adding an item from the picker SHALL place it in the **lowest-numbered free, unblocked cell**, except where "Repeated Consumables Read as One Stack" directs otherwise. The picker SHALL NOT be a drag source; placement from the picker into a chosen cell is out of scope for this capability.

A move MUST NOT change which items are equipped, MUST NOT change the total cost, and MUST NOT change any capacity total. A rearrangement is a permutation of cells, not a change of contents.

#### Scenario: Moving an item to an empty cell

- **WHEN** the user drags the item in cell 2 onto empty cell 7
- **THEN** cell 7 SHALL hold that item, cell 2 SHALL be empty, and the loadout's total cost SHALL be unchanged

#### Scenario: Dropping onto an occupied cell swaps

- **WHEN** the user drags the item in cell 1 onto cell 5, which holds a different item
- **THEN** cell 1 SHALL hold the item that was in cell 5 and cell 5 SHALL hold the item that was in cell 1

#### Scenario: Dropping onto the origin cell changes nothing

- **WHEN** the user begins dragging the item in cell 3 and releases it over cell 3
- **THEN** the loadout SHALL be byte-identical to its state before the drag, and no persistence write SHALL be required to have occurred

#### Scenario: Dragging off the grid unequips

- **WHEN** the user drags the item in cell 6 outside the grid and releases
- **THEN** cell 6 SHALL be empty, every other cell SHALL be unchanged, and the total cost SHALL drop by exactly that item's cost

#### Scenario: A click on the tile body does not remove the item

- **WHEN** the user presses and releases the pointer on cell 6's tile body with no movement between
- **THEN** cell 6's item SHALL be unchanged, identically to a drag released back onto its own cell

#### Scenario: Only the dedicated control removes an item

- **WHEN** the user activates cell 6's remove control
- **THEN** cell 6 SHALL be empty, every other cell SHALL be unchanged, and the total cost SHALL drop by exactly that item's cost

#### Scenario: The picker fills the lowest free cell

- **WHEN** cells 1 and 3 hold items, cell 2 is empty and unblocked, and the user adds a new tool from the picker
- **THEN** the new tool SHALL be placed in cell 2

### Requirement: Repeated Consumables Read as One Stack

A **run** SHALL be defined as a maximal sequence of consecutive cells holding entries with identical `t` and `i`. A run of length 1 SHALL render as an ordinary tile. A run of length 2 or greater SHALL render as a stack: the **anchor cell** — the lowest-numbered cell of the run — SHALL show the item tile with a quantity badge stating the run's length, and each remaining cell of the run SHALL render in a distinct held state that identifies the stack it belongs to and is visibly not an empty cell.

A stack anchor SHALL render exactly one item image, resolved through SPEC-0001's asset-path convention and fallback chain, and a held cell SHALL NOT repeat that image. Stack quantity SHALL be derived from the run at render time. The system MUST NOT store a quantity on an entry, MUST NOT reserve cells an entry does not occupy, and MUST NOT admit any state in which the badge and the number of cells the stack occupies disagree.

The system SHALL NOT special-case category when detecting runs. Because duplicate tools are already forbidden, a run of length 2 or greater can only be consumables; that property SHALL follow from the existing constraint rather than from a category test in the rendering path.

Adding a consumable from the picker that is already equipped SHALL place the new copy in the cell **immediately following the last cell of an existing run of that item**, when that cell is free and unblocked. Otherwise it SHALL fall back to the lowest-numbered free, unblocked cell, where it SHALL render as its own tile with no badge.

Dragging any cell of a stack SHALL move the **entire run** as a unit, preserving its internal cell order. A stack of length *N* MAY be dropped only onto a destination region of *N* consecutive cells each of which is empty, unblocked, or already part of the dragged run. Any other drop SHALL be rejected as a no-op. Stack drops SHALL NOT swap.

Removing a stack's anchor cell SHALL remove one copy and the remaining copies SHALL close up so the run stays contiguous, re-anchored at the lowest-numbered cell it still occupies.

#### Scenario: Two adjacent identical consumables render as one stack

- **WHEN** a loadout holds a Vitality Shot in cell 1 and a Vitality Shot in cell 2
- **THEN** cell 1 SHALL render the Vitality Shot tile badged `×2`, and cell 2 SHALL render as held by that stack rather than as an empty cell

#### Scenario: Non-adjacent duplicates do not stack

- **WHEN** a loadout holds a Vitality Shot in cell 1 and a Vitality Shot in cell 6
- **THEN** both SHALL render as ordinary unbadged tiles, and no held cell SHALL be rendered

#### Scenario: The badge matches the cells consumed

- **WHEN** a stack renders a badge of `×3`
- **THEN** exactly three cells of the eight SHALL be attributable to that stack, and the equipment count SHALL include all three

#### Scenario: A duplicate consumable joins the existing run

- **WHEN** a Vitality Shot occupies cells 1 and 2, cell 3 is free and unblocked, and the user adds another Vitality Shot from the picker
- **THEN** the new copy SHALL be placed in cell 3 and the stack SHALL render as `×3`

#### Scenario: A duplicate falls back when the run cannot grow

- **WHEN** a Vitality Shot occupies cells 1 and 2, cell 3 holds a different item, cell 4 is free, and the user adds another Vitality Shot
- **THEN** the new copy SHALL be placed in cell 4 and SHALL render as an ordinary unbadged tile, and the stack in cells 1–2 SHALL still render as `×2`

#### Scenario: A stack moves as one unit

- **WHEN** the user drags a `×2` stack anchored at cell 1 onto cell 5, and cells 5 and 6 are both empty and unblocked
- **THEN** the stack SHALL occupy cells 5 and 6, cells 1 and 2 SHALL be empty, and the badge SHALL still read `×2`

#### Scenario: A stack drop with insufficient room is rejected

- **WHEN** the user drags a `×3` stack onto a region where one of the three destination cells is blocked
- **THEN** the drop SHALL be rejected, the stack SHALL remain in its origin cells, and the loadout SHALL be unchanged

#### Scenario: Removing from a stack keeps the run contiguous

- **WHEN** a Vitality Shot occupies cells 3, 4, and 5, and the user removes one copy
- **THEN** the remaining two copies SHALL occupy two consecutive cells, SHALL still render as a single `×2` stack, and no gap SHALL be left inside the run

### Requirement: Capacity Rules Are Stated Once and Preserved

Capacity SHALL be expressed as a single predicate — **a free, unblocked cell exists** — and every caller SHALL consult that one definition. The system MUST NOT re-derive capacity as a comparison between the number of equipped items and `slotMax()`, in the picker or anywhere else, because that comparison is wrong the moment the array is sparse.

The three existing game rules SHALL be preserved exactly:

- At most one of each specific Tool per loadout.
- At most four consumables of any one **cap category**, counted across all cells regardless of adjacency and regardless of which specific items make up the four. The cap category is `CONS[i][3]` (`Shot`, `Throwable`, `Placeable` and `Tarot Cards`) *(the last admitted 2026-08-15 by #37; previously written as "once admitted")*. Consumables sharing a `type` SHALL share one budget. *(Revised per ADR-0015; this rule previously read "four copies of any one specific consumable" and asserted that two different consumables never share a budget.)*
- At most eight occupied cells, of which blocked cells are not available.

The cap SHALL be read from a **declared list of cap categories** rather than inferred from the `type` values present in `CONS`, so a category with no rows yet is capped by the same mechanism the moment rows are admitted, with no new modelling. *(The example this sentence carried — "Tarot Cards today" — was spent on 2026-08-15 when #37 admitted the fourteen. The rule is unchanged and the example is removed rather than replaced: every declared category now holds rows, so naming one would be naming an ordinary case. What the clause guarantees is unchanged, and is now demonstrated by the scenario below rather than promised by it.)*

A `CONS` row whose `type` falls outside the declared cap categories SHALL be treated as a data error rather than silently escaping the cap.

The picker's enabled/disabled state for an item SHALL be derived from the same predicate and the same rules that the reducer enforces, so an item the picker offers is always an item the reducer will accept.

#### Scenario: The per-type cap counts across non-adjacent cells

- **WHEN** a loadout holds four Vitality Shots spread across non-adjacent cells
- **THEN** every further Vitality Shot SHALL be rejected by the reducer and SHALL render as unavailable in the picker, **and a Stamina Shot SHALL also be rejected**, because both carry `type: "Shot"` and share one budget

#### Scenario: The cap is exhausted by a mix of items in one category

- **WHEN** a loadout holds four Dynamite Sticks
- **THEN** a Dynamite Bundle SHALL be rejected, because both are `Throwable` and the four Sticks exhaust that category

#### Scenario: A different cap category is unaffected

- **WHEN** a loadout holds four Throwables and has a free unblocked cell
- **THEN** a `Placeable` and a `Shot` SHALL each still be accepted, because each category carries its own budget of four

#### Scenario: A stack counts toward its category's cap by its full quantity

- **WHEN** a loadout holds a `×3` stack of Vitality Shots and one further Vitality Shot is added
- **THEN** the stack SHALL be counted as 3, the add SHALL be accepted, and any fifth `Shot` — the same item or a different one — SHALL be rejected

#### Scenario: A cap category with no catalog rows is still capped

- **WHEN** rows are admitted to a declared cap category that previously held none
- **THEN** the four-per-category limit SHALL apply to them on admission, and the cap mechanism SHALL require no change

*(**WHEN** amended 2026-08-15, and the guarantee is now a fulfilled one rather than a forward-looking one. It previously read "the declared cap categories include Tarot Cards and no `CONS` row carries that `type`" — true when written, and false from #37, which admitted the fourteen Tarot Cards. Tarot Cards was the only empty declared category, so the original clause had no other subject to point at: it would have become unsatisfiable, and an unreachable scenario is worse than a wrong one because nothing fails to report it.*

*The scenario is rewritten against the admission **event** rather than retired, because the property it guards is what made that admission cheap. #37 exercised it for real and is the evidence: fourteen rows entered a category `CONS_CAP_CATEGORIES` already declared, and `calc.js`, the reducer and the picker were untouched — a data change, not a mechanism change. The requirement above is unchanged; only its demonstration moved from promise to record.)*

#### Scenario: A full grid with holes is still full

- **WHEN** every unblocked cell is occupied but the array still contains `null` at blocked positions
- **THEN** the capacity predicate SHALL report no room, and the picker SHALL render every equipment item as unavailable

#### Scenario: Picker availability agrees with the reducer

- **WHEN** the picker renders an equipment item as available
- **THEN** dispatching the corresponding add action SHALL result in that item being placed in a cell

### Requirement: Wire Format Version 2 Encodes Cell Position

`FORMAT_VERSION` SHALL be raised to `2`. A v2 payload SHALL encode `e` as an array of exactly eight elements, each `null` or a `[t, id]` pair, where the array index is the cell. It SHALL encode `b` as an array of unique integers in the range `0..7`.

Items SHALL continue to be referenced by stable catalog id rather than by array position, unchanged from v1. The encoder SHALL emit v2 for every write — localStorage, share links, and saved records alike.

A v2 payload whose `e` is not exactly eight elements long SHALL be treated as malformed rather than padded or truncated, because a sparse array of the wrong length renders items in the wrong cells.

> **Widened 2026-08-15 to cover version 3** *(per SPEC-0009 and ADR-0023, which extend this spec rather than replace it — the wire-format version model stays owned here)*.
>
> `FORMAT_VERSION` is now `3`. Version 3 changes the **weapon entry only**, from `[ref, ammo]` to `[ref, ammo, d]` where `d` marks a dual-wielded pair; it changes nothing about the equipment grid. Every rule this requirement states about `e` and `b` therefore holds unchanged at v3, and SHALL be read as **"version 2 or later"** rather than "version 2 exactly": `e` is exactly eight elements each `null` or a `[t, id]` pair, `b` is unique integers in `0..7`, and the encoder emits the current version for every write.
>
> The requirement is not renamed, because it is still the requirement that made cell position part of the format; v3 inherits that encoding rather than restating it. Reading these rules as v2-exactly is the specific mistake that broke saves from a v3 client (#329) — an equality check sent v3 down the v1 packed path, where a `null` grid hole and an array `b` both fail. `isValidData` gates on `data.v >= 2` for exactly this reason.

> **Widened 2026-08-16 to cover version 4** *(per SPEC-0010, ADR-0014 and issue #348, which extend this spec rather than replace it — the wire-format version model stays owned here)*.
>
> `FORMAT_VERSION` is now `4`. Version 4 changes the **weapon entry's ammo element only**, from a single integer index to a two-element array of stable identifiers or `null` — see SPEC-0010 REQ "Wire Format Version 4 References Rounds by Stable Id". It changes nothing about `e` or `b`. Every rule this requirement states therefore holds unchanged at v4, and "version 2 or later" now reads as "version 2, 3 or 4" — the equipment grid and blocked array are identical across all three.
>
> This is the same shape SPEC-0009 left the requirement in at v3: the wire-format version model is widened again rather than replaced, and the requirement keeps its name for the reason stated there.

#### Scenario: An encoded loadout round-trips its cell positions

- **WHEN** a loadout with items in cells 1, 4, and 8 and cell 6 blocked is encoded and then decoded
- **THEN** the decoded loadout SHALL hold those items in cells 1, 4, and 8, and SHALL list cell 6 as blocked

#### Scenario: Empty cells survive encoding

- **WHEN** a loadout with a single item in cell 5 is encoded
- **THEN** the encoded `e` SHALL have eight elements, of which exactly one is a `[t, id]` pair at index 4

### Requirement: Version 1 Records Migrate Losslessly

The decoder SHALL continue to accept v1 and pre-versioning payloads. A v1 payload SHALL be lifted to v2 semantics by the reading it already had: its dense `e` array SHALL be read into cells 1..n in order, and its `b: N` count SHALL become the indices of the last `N` cells.

The frozen legacy tables (`LEGACY_WEAPON_IDS`, `LEGACY_TOOL_IDS`, `LEGACY_CONS_IDS`, `LEGACY_TRAIT_IDS`) MUST NOT be reordered, trimmed, or otherwise edited by this capability. The pre-versioning path SHALL continue to decode to v1 semantics and SHALL then take the same v1-to-v2 lift.

An item that no longer resolves against the catalog SHALL continue to be dropped, and dropping it SHALL leave the surviving items in the cells the record meant them to occupy rather than closing the gap.

Decoding SHALL be total: no input SHALL produce an equipment array that is not exactly eight elements long, and no input SHALL produce a blocked list containing a duplicate or an out-of-range index.

> **Widened 2026-08-15 to cover version 3** *(per SPEC-0009 and ADR-0023)*.
>
> The decoder registry now holds **v3, v2, v1 and the legacy fallback**. Nothing above is withdrawn: the v1-to-v2 lift is unchanged, the frozen legacy tables remain untouchable by this capability, a dropped item still leaves its neighbours where the record meant them to be, and decoding is still total.
>
> One clarification the added version forces. A v1 or legacy record's weapon entries carry no `d`, and lifting one SHALL supply the single — not a pair — because the record was written by a format in which the pair could not be expressed, and inventing one would change what the loadout costs. That the lift is *lossless* means it preserves what the record said; a v1 record said "one pistol", and it still does after the lift.
>
> "Migrate losslessly" continues to name the whole ladder rather than the single v1 step, which is why the requirement is not renamed.

> **Widened 2026-08-16 to cover version 4** *(per SPEC-0010, ADR-0014 and issue #348)*.
>
> The decoder registry now holds **v4, v3, v2, v1 and the legacy fallback**. Nothing above is withdrawn: the v1-to-v2 lift is unchanged, the frozen legacy tables remain untouchable by this capability, a dropped item still leaves its neighbours where the record meant them to be, and decoding is still total.
>
> A v1, v2, v3 or legacy record's weapon entries carry ammo as a bare pool index, not a stable id — that is the shape `fromV4` does not read. Lifting one to current semantics goes through the frozen index-to-id table SPEC-0010 REQ "Every Legacy Ammo Selection Migrates to the Round It Named" commits alongside the decoder, not through `fromV4` itself; an index that cannot be resolved decodes to "no round chosen" rather than a different round. This is the ammo-side sibling of the pair-flag clarification above: what a record could not have expressed, the lift does not invent.

#### Scenario: A v1 record decodes to the cells it used to render in

- **WHEN** a stored v1 record carries `e` with three entries and `b: 2`
- **THEN** the decoded loadout SHALL hold those three items in cells 1, 2, and 3, and SHALL list cells 7 and 8 as blocked

#### Scenario: A dropped item does not relocate its neighbours

- **WHEN** a v1 record carries three equipment entries and the second names an id the catalog no longer holds
- **THEN** the decoded loadout SHALL hold the first item in cell 1 and the third item in cell 3, and cell 2 SHALL be empty

#### Scenario: A pre-versioning record still decodes

- **WHEN** a stored payload carries no `v` field and references items by legacy array position
- **THEN** it SHALL decode through the existing legacy tables and SHALL yield an eight-element equipment array

#### Scenario: Malformed input yields a well-formed empty grid

- **WHEN** a stored payload's `e` is absent, of the wrong type, or of a length other than eight in a v2 record
- **THEN** decoding SHALL yield an eight-element array of `null` rather than throwing, and SHALL NOT yield an array of any other length

### Requirement: Randomized and Bulk-Set Loadouts Produce Well-Formed Grids

The randomizer SHALL produce an eight-element equipment array, SHALL respect blocked cells, and SHALL place items only in free, unblocked cells. It MUST NOT return a packed array for a caller to reinterpret.

`setLoadout` SHALL reject any payload whose equipment array is not exactly eight elements, or whose blocked list contains a duplicate or an out-of-range index, by throwing rather than by coercing. This preserves the existing property that a bad bulk write fails loudly at the source instead of silently corrupting derived math later.

#### Scenario: A random loadout avoids blocked cells

- **WHEN** the user randomizes a loadout while cells 7 and 8 are blocked
- **THEN** no item SHALL be placed in cell 7 or cell 8, and the result SHALL be an eight-element array

#### Scenario: A malformed bulk payload is rejected

- **WHEN** `setLoadout` is dispatched with an equipment array of length 3
- **THEN** it SHALL throw, and the store SHALL be unchanged

### Requirement: Error Handling at the Payload Boundary

Decoding and validation SHALL reject malformed input rather than coerce it. Where a value is out of range, the system SHALL either drop the individual element it describes or reject the payload as a whole; it MUST NOT silently substitute a neighbouring cell, clamp a cell index into range, or reorder cells to close a gap, because each of those turns a data error into a wrong loadout that looks correct.

Errors crossing the client/server boundary SHALL carry contextual information naming the field that failed, and the server's existing structured error responses SHALL be used rather than a generic failure. Silent error swallowing MUST NOT occur: every rejection SHALL either return an error to the caller or be a documented, deliberate drop of a single unresolvable item.

#### Scenario: An out-of-range cell index is not clamped

- **WHEN** a decoded payload carries a blocked index of 9
- **THEN** that index SHALL be dropped from the blocked list, and it MUST NOT be clamped to 7 or to any other cell

#### Scenario: A rejected save names the offending field

- **WHEN** a save request carries an equipment array of the wrong length
- **THEN** the response SHALL be a 400 whose body identifies the equipment payload as the reason, and no record SHALL be written

## Security Requirements

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Mandatory Security Section in Web Specs" -->

This capability adds no endpoints. It changes the accepted request body shape of the existing saved-loadout endpoints, which means it changes a boundary control — `isValidData` exists to keep unresolvable references out of the data file (issue #19). The requirements below constrain that change.

### Requirement: Saved-Loadout Payloads Are Validated at Both Versions

The server's payload validator SHALL accept both v1 and v2 equipment encodings, permanently rather than transitionally. The server SHALL perform no migration: records written before v2 SHALL remain v1 in the data file until the loadout is next saved, and version dispatch SHALL live entirely in the client decoder.

Every guard the validator applies today SHALL survive: item references SHALL still resolve against the catalog, `e` SHALL still be bounded at eight elements, `tr` at forty, and `n` at two hundred characters. The v2 branch SHALL add guards rather than relax them — `e` SHALL be exactly eight elements, each `null` or a well-formed `[t, id]` pair, and `b` SHALL be unique integers in `0..7`.

A payload that satisfies neither version's shape SHALL be rejected with a 400 and SHALL NOT be written.

The client half of this capability MUST NOT be released before the validator accepts v2, because a v2 payload against today's validator is a 400 on every save.

> **Widened 2026-08-15: "both versions" is now three** *(per SPEC-0009 and ADR-0023)*.
>
> The validator accepts **v1, v2 and v3**, permanently and side by side, on the same reasoning that made it accept two: there is no moment at which every stored record carries the newest version, because a record is only rewritten when its owner re-saves it. The requirement's name is deliberately **not** changed — `/sdd:check` and the governing comments in `server/src/routes/loadouts.js` both trace on the name, and renaming it would silently break that trace for a count that will move again at v4 (SPEC-0010). Read "Both Versions" as "every version the format has defined".
>
> What v3 adds is confined to the weapon entry: `w` slots are validated at an **exact** element count that depends on the declared version — two at v1 and v2, three at v3 with the third element a boolean. The equipment grid and blocked array are gated on `data.v >= 2`, so v3 reuses the v2 branch rather than getting one of its own. The v3 branch, like the v2 branch before it, adds guards rather than relaxing any.
>
> The sequencing constraint above resolved the same way for v3 as for v2: the server's version-aware weapon check shipped in #329, before the client began emitting v3.

> **Widened 2026-08-16: it is now four** *(per SPEC-0010, ADR-0014 and issue #348)*.
>
> The validator accepts **v1, v2, v3 and v4**, permanently and side by side — the "count that will move again at v4" clause above has now happened, and the requirement's name is unchanged for the same reason. What v4 adds is confined further than v3 was: the weapon entry's element count stays three, unchanged from v3, and only the `ammo` element's *type* narrows, from an integer to a two-entry array of bounded identifier strings or `null` (`isAmmoSlotArray`, `isIslandV4` in `server/src/routes/loadouts.js`). The equipment grid and blocked array are unaffected and stay on the `data.v >= 2` branch.
>
> `isIslandV4` was widened in place rather than superseded by a v5, because nothing had ever emitted the single-id v4 shape an earlier story first shipped — see SPEC-0010 REQ "The Weapon Entry Is Validated at Version 4's Shape" for why that widening was safe.

#### Scenario: A v3 payload is accepted

- **WHEN** a save request carries `v: 3` with an eight-element `e`, a `b` array, and a weapon slot of `[ref, ammo, d]`
- **THEN** the record SHALL be persisted and returned

#### Scenario: A v3 weapon slot is refused at an older version

- **WHEN** a save request declares `v: 2` but carries a three-element weapon slot
- **THEN** the request SHALL be rejected with a 400 — the declared version selects the exact count, and a later version's shape SHALL NOT be accepted under an earlier one

*(both scenarios added 2026-08-15 with the widening above)*

#### Scenario: A v4 payload is accepted

- **WHEN** a save request carries `v: 4` with an eight-element `e`, a `b` array, and a weapon slot of `[ref, [ammoId, ammoId], d]`
- **THEN** the record SHALL be persisted and returned

#### Scenario: A v4 weapon slot's ammo element rejects an integer

- **WHEN** a save request declares `v: 4` but carries a weapon slot whose `ammo` element is an integer rather than a two-entry array
- **THEN** the request SHALL be rejected with a 400 — the declared version selects the expected `ammo` shape, and an earlier version's shape SHALL NOT be accepted under a later one

*(both scenarios added 2026-08-16 with the widening above)*

#### Scenario: A v2 payload is accepted

- **WHEN** a save request carries `v: 2` with an eight-element `e` containing nulls and a `b` array
- **THEN** the record SHALL be persisted and returned

#### Scenario: A v1 payload is still accepted

- **WHEN** a save request carries a v1 payload with a dense `e` and a numeric `b`
- **THEN** the record SHALL be persisted and returned, unchanged in version

#### Scenario: Unresolvable references are still rejected

- **WHEN** a v2 save request carries an equipment entry whose id is not in the catalog
- **THEN** the request SHALL be rejected with a 400 and no record SHALL be written

#### Scenario: A sparse array of the wrong length is rejected

- **WHEN** a `v: 2` save request carries an `e` of length 6
- **THEN** the request SHALL be rejected with a 400 and no record SHALL be written

### Authentication

Every endpoint this capability touches is an existing token-scoped endpoint under `/api/loadouts`, and each SHALL remain so. The ownership boundary (`lib/ownership.js`, issue #17) is unchanged by this capability, and a rearrangement or a version bump SHALL NOT be a route by which one caller's token reaches another caller's record.

| Endpoint | Auth | Justification |
|----------|------|---------------|
| `GET /api/loadouts` | Required | Token-scoped; returns only records owned by the caller token |
| `POST /api/loadouts` | Required | — |
| `PATCH /api/loadouts/:id` | Required | — |
| `DELETE /api/loadouts/:id` | Required | — |

### Rate Limiting

The existing per-IP and per-token limiters on the write routes (`ipLimiter`, `tokenLimiter`, 60-second windows) SHALL continue to apply unchanged. This capability MUST NOT introduce a new write path that bypasses them.

Rearrangement is a client-side operation persisted to `localStorage`; it SHALL NOT issue a request per move. A rearranged loadout reaches the server only through an ordinary, already-limited save.

### Security Headers

The app serves no security headers today — there is no `helmet` middleware and no `Content-Security-Policy`. That gap predates this capability and closing it is not in scope here. This capability SHALL NOT introduce anything that would make the gap harder to close: specifically, the drag implementation MUST NOT require inline event-handler attributes, `eval`, or dynamically constructed script, so that a future strict CSP does not have to carve out an exception for the equipment grid.

### Request Body Size Limits

The existing `express.json({ limit: "64kb" })` cap SHALL continue to apply. A v2 payload is larger than v1 — eight elements with explicit nulls instead of a packed list — but the increase is a handful of bytes against a 64kb budget, so no change to the cap is required or permitted by this capability.

### CSRF Protection

The API is token-header authenticated (`x-loadout-token`) rather than cookie authenticated, so a cross-site request cannot carry the caller's credential ambiently. The existing CORS allowlist (issue #30) remains the second control. This capability SHALL NOT introduce cookie-based authentication for any of its operations, since doing so would create the CSRF exposure the header-token model currently avoids.

### Redirect Validation

This capability performs no HTTP redirects and accepts no user-supplied URLs. The share-link path encodes loadout state into the URL fragment of the app's own origin and SHALL continue to do so; it MUST NOT be extended to accept or navigate to a caller-supplied destination.

## Accessibility Requirements

<!-- Governing: ADR-0019 (Frontend Quality Standards), SPEC-0016 REQ "Accessibility Requirements for UI Specs" -->

Making the grid a manipulable surface is the point of this capability, which makes the requirement below the one most likely to be dropped under schedule pressure and the one that most clearly must not be.

### Requirement: Keyboard Equivalence for Every Pointer Gesture

Every rearrangement expressible by pointer drag SHALL be expressible by keyboard alone, using the same underlying move operation. Drag-and-drop SHALL NOT be the only route to any outcome.

The keyboard route SHALL be a grab-and-place model: a focused cell is grabbed with Space, arrow keys move the placement target among cells, Enter commits the move, and Escape cancels and restores the origin *(corrected 2026-08-17 per `/sdd:audit` — this sentence previously said "Enter or Space" for both the grab and the commit, which contradicted the 2026-08-16 correction below at "Corrected 2026-08-16, per #241" that split grab and commit onto separate keys; the implementation follows the split, not this sentence's original wording)*. While a cell is grabbed, the grid SHALL communicate the grabbed item and the current target through an `aria-live="polite"` region, and SHALL announce the outcome — moved, swapped, or rejected — on commit.

Arrow-key movement SHALL be spatial: an arrow SHALL move the target to the cell the user sees in that direction, in whichever arrangement "The Grid Renders as Two Ranks of Four" has selected. Movement along a rank SHALL be a step of one cell and movement across ranks SHALL be a step of four, so in the wide arrangement Left/Right step by one and Up/Down step by four, and in the narrow arrangement Up/Down step by one and Left/Right step by four.

Movement SHALL be clamped at the grid's edges: an arrow that would leave the grid SHALL be a no-op that leaves the target where it is, in both axes and both arrangements. The target MUST NOT wrap from the end of one rank to the start of the next, because a target that leaves in a direction other than the one it was sent is the same defect as a grid that changes shape.

The sensor SHALL take the current arrangement from the same declared threshold the stylesheet uses, and MUST NOT infer it by measuring the rendered grid. The underlying move operation SHALL be identical in both arrangements: only the mapping from arrow key to step size differs, and that mapping SHALL exist in one place.

#### Scenario: The vertical arrow's step follows the arrangement

- **WHEN** a keyboard user grabs the item in cell 2 and presses Down once
- **THEN** the placement target SHALL be cell 6 in the wide arrangement and cell 3 in the narrow one, in each case the cell directly below cell 2 as drawn

*(Corrected 2026-08-16, per #241 — Enter/Space on a filled cell was described as the keyboard route for removal, which collides with the same keys starting and committing a grab. The two are not the same control.)* Unequipping SHALL likewise have a keyboard route that does not require dragging off the grid: the per-cell remove control required by "Items Are Rearranged by Direct Manipulation" SHALL itself be reachable in the tab order and activatable by Enter or Space while it holds focus, independent of the grab-and-place state machine above. Reaching the remove control MUST NOT require a grab to be in progress, and activating it MUST NOT be interpreted as starting or committing one.

Cells SHALL be reachable in a tab order that follows the visual layout, and a grabbed stack SHALL be announced with its quantity so a screen-reader user knows how many cells the pending move will consume.

Focus SHALL follow the item rather than the cell. After a completed move, focus SHALL rest on the destination cell; after a cancelled grab, on the origin cell; after a removal, on the now-empty cell that held the item. Focus MUST NOT be lost to the document body by any grid operation.

#### Scenario: A move is completed without a pointer

- **WHEN** a keyboard user focuses the cell holding an item, presses Enter, presses the arrow keys to reach an empty cell, and presses Enter again
- **THEN** the item SHALL be in the destination cell and the origin cell SHALL be empty, identically to the same move performed by drag

#### Scenario: An arrow at the grid's edge is a no-op

- **WHEN** a keyboard user grabs an item in the wide arrangement, moves the target to cell 4, and presses Right
- **THEN** the target SHALL remain on cell 4, and it MUST NOT move to cell 5

#### Scenario: The edge no-op holds in the narrow arrangement too

- **WHEN** a keyboard user grabs an item in the narrow arrangement, moves the target to cell 4, and presses Down
- **THEN** the target SHALL remain on cell 4, and it MUST NOT move to cell 5

#### Scenario: Escape cancels a grab

- **WHEN** a keyboard user grabs a cell, moves the target to another cell, and presses Escape
- **THEN** the item SHALL remain in its origin cell and the loadout SHALL be unchanged

#### Scenario: The remove control is reachable and operable without a grab

- **WHEN** a keyboard user tabs to a filled cell's remove control, with no grab in progress, and presses Enter or Space
- **THEN** that cell's item SHALL be unequipped, and no grab SHALL have been started or committed by the keypress

#### Scenario: A rejected keyboard drop is announced

- **WHEN** a keyboard user grabs a `×2` stack and attempts to commit it where only one cell is free
- **THEN** the move SHALL be rejected, the stack SHALL remain in place, and the rejection SHALL be announced through the live region rather than failing silently

#### Scenario: Focus follows a moved item

- **WHEN** a keyboard user completes a move from cell 2 to cell 7
- **THEN** keyboard focus SHALL be on cell 7

#### Scenario: Focus survives a removal

- **WHEN** a keyboard user removes the item in cell 4
- **THEN** keyboard focus SHALL be on cell 4, which is now empty, and MUST NOT have moved to the document body

### WCAG 2.1 AA Compliance

All UI produced by this capability SHALL meet WCAG 2.1 Level AA as the minimum conformance target. The states this capability introduces — empty, occupied, blocked, held-by-stack, grabbed, valid drop target, invalid drop target — SHALL each meet the AA contrast minimum against their background, and MUST NOT be distinguished by colour alone; each SHALL carry a non-colour cue such as a border treatment, an icon, or text.

The fixed grid interacts with two criteria and SHALL be implemented against both. **1.4.10 Reflow (AA)** requires no two-dimensional scrolling at 320 CSS pixels: the grid satisfies it by transposing and then by shrinking its cells, which is why "The Grid Renders as Two Ranks of Four" forbids horizontal scroll rather than permitting it as the narrow-panel escape. **2.5.5 Target Size** is AAA in WCAG 2.1 and therefore outside this capability's conformance target, but four cells across a narrow panel produces the smallest pointer targets in the app; the cell SHALL remain the full hit area of its grid track, so the target is as large as the arrangement allows rather than being inset to the artwork. Transposition is what keeps the narrow case from being the smallest target the app can produce, and is the reason it is preferred over shrinking alone.

### ARIA Landmarks

The equipment grid sits inside the page's existing `role="main"` content area and SHALL NOT introduce a competing landmark. The grid itself SHALL be exposed with an accessible name identifying it as the equipment slots, and its cells SHALL be exposed as a positional set so assistive technology can report "cell 3 of 8".

The position a cell exposes SHALL be its index in the eight-cell set — "cell 3 of 8" — and SHALL be identical in both arrangements, because transposition moves where a cell is drawn and not which cell it is. Where the exposed position carries a row and column, they SHALL be the ones the current arrangement draws, taken from the declared threshold rather than read back from rendered geometry.

### Icon-Only Controls

The drag handle, the remove target, and any control that renders as an icon or a bare glyph SHALL carry an `aria-label` naming its purpose and the item it acts on. A held cell of a stack SHALL carry an accessible name identifying which stack holds it, not merely that it is occupied.

### Dynamic Content Regions

The quantity badge, the slot counter in the panel header, and the grab/drop announcements SHALL be exposed through an `aria-live="polite"` region so a rearrangement is perceivable without sight. Rejections SHALL be announced through the same region rather than being conveyed only by the item snapping back.

### Keyboard Navigation

Every cell SHALL be focusable and operable by keyboard. Tab order SHALL follow the visual grid order, which the fixed arrangement makes unambiguous in both orientations: cells 1 through 8 in DOM order, which is the visual reading order when wide and when narrow alike.

*(Corrected 2026-08-16, per #241 — "Enter and Space SHALL activate a cell's primary action" named a single, unnamed action per cell state; the implementation has no such single action.)* On a filled cell's tile, Space SHALL start a grab; on an empty cell, Enter or Space SHALL toggle its blocked state; and on the cell's remove control, where present, Enter or Space SHALL activate it, per "Items Are Rearranged by Direct Manipulation" and "Keyboard Equivalence for Every Pointer Gesture" above. These are three controls, not one action read three ways, and each SHALL be independently reachable in the tab order. Arrow keys SHALL move an in-progress grab among cells with the arrangement-relative semantics required by "Keyboard Equivalence for Every Pointer Gesture", Enter SHALL commit an in-progress grab, and Escape SHALL cancel one. Keyboard focus MUST NOT be trapped in the grid outside an active grab.

### Focus Management

Focus management for grid operations is specified as part of "Keyboard Equivalence for Every Pointer Gesture" above, and is testable through that requirement's scenarios. The grid introduces no modal or dialog surface, so no focus trap is required by this capability.
