---
status: draft
date: 2026-08-10
implements: [ADR-0009]
requires: [SPEC-0001]
---

# SPEC-0006: Equipment Slot Arrangement

## Overview

The Equipment panel renders eight cells but does not have eight slots. `state.equip` is a **dense packed array**; the array index is the cell, so items are pinned to the front of the grid in whatever order they were added, and unequipping the first item slides every item behind it one cell to the left. A player carrying three items occupies cells 1–3 and has no way to reach cell 8.

This capability makes cell position a stored, user-controlled property of the loadout. It realizes [ADR-0009](../../../adrs/ADR-0009-equipment-slot-grid-model.md), which chose a fixed sparse eight-cell array — index is the cell, `null` is an empty cell — over reorder-only drag on the packed array, a packed array with a parallel position map, and an explicit quantity field on entries.

Three changes follow from that one decision, and they are not separable:

- **Free placement.** Any item may sit in any cell, and gaps between items are legal. Removal writes `null` in place rather than splicing, so nothing moves that the user did not move.
- **Per-cell blocking.** `blocked` stops being a count and becomes a set of cell indices. The current model infers blockedness from `index >= slotMax`, which is simply wrong once an item can legitimately sit in cell 8 with four empty cells in front of it.
- **Wire format v2.** Cell position that is not in the payload does not survive a save, a share link, or a reload. `FORMAT_VERSION` goes to 2.

**Stacking is derived, not stored.** Repeated consumables in adjacent cells render as one tile with a quantity badge; the cells behind the anchor render as held by that stack. There is no stored quantity, so the badge cannot disagree with the cell count. Duplicate *tools* remain forbidden by the existing `addEquip` guard, which is why a run of length ≥ 2 can only ever be consumables — the consumables-only property falls out of a rule that is already enforced and already tested, rather than being restated here as a special case.

**The load-bearing constraint is the server validator.** `server/src/routes/loadouts.js` rejects a `data.e` containing `null` and a `data.b` that is not a number, so a v2 payload is a 400 against today's server. The client half of this capability is not shippable alone. This is the only sequencing constraint in the capability, and "Saved-Loadout Payloads Are Validated at Both Versions" is where it is made testable.

**Item imagery is unchanged and inherited.** Every cell that depicts an item — an ordinary tile or a stack anchor — renders through the same shared container and the same scraped-image-then-SVG-fallback chain that SPEC-0001 (Equipment Iconography) specifies. This capability changes which cell a tile is drawn in and how many tiles a run of identical consumables produces; it changes nothing about how the image inside a tile is resolved.

**Duplicate consumables are already legal.** The existing cap is four per *category* (`CONS[i][3]` — `Shot`, `Throwable`, …), not per item, so two Vitality Shots is a valid loadout today and consumes two of eight cells. This capability changes how that reads, not whether it is allowed.

**Implementation status.** Nothing in this capability is implemented. `state.equip` is still packed, `blocked` is still a count, `FORMAT_VERSION` is still 1, and the panel has no drag affordance.

**Interaction with SPEC-0003** *(updated 2026-08-10)*. This paragraph previously said SPEC-0003's preview "sheds later slots before earlier ones as width narrows" and would need a one-line amendment when the sparse model landed. **That amendment has already happened**, and it went further than one line: SPEC-0003's preview is now a fixed-cell categorised panel, the shed-by-width rule is withdrawn, and the requirement is stated in terms of *cells occupied* rather than array shape — so it reads correctly under both the packed array and this capability's sparse one, and needs no change when this lands.

What remains owed to SPEC-0003 is narrower and additive: this capability introduces **consumable stacking** and **per-cell blocking**, and SPEC-0003 explicitly scopes both out of its preview for now. When this capability is implemented, SPEC-0003 needs a clause saying whether a preview renders a stack as one badged cell (as the builder will) or as repeated cells, and whether a blocked cell is drawn distinctly from an empty one. Two of SPEC-0003's preview scenarios are also marked as unexercisable until the sparse model exists, and become live then.

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

### Requirement: Cells Are Individually Blockable

`state.blocked` SHALL be a list of cell indices in the range `0..7`, with no duplicates. `slotMax()` SHALL return `8 - blocked.length`.

A cell's blocked state SHALL be determined by membership in that list. The system MUST NOT infer blockedness from a cell's index relative to `slotMax()`.

Only an empty cell MAY be blocked. Blocking SHALL be rejected for a cell that holds an item, including a cell held by a stack. A blocked cell MUST NOT accept an item by any route — picker placement, drag, keyboard placement, bulk load, or randomization.

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

Dropping an item onto an **empty, unblocked** cell SHALL move it there. Dropping an item onto an **occupied** cell SHALL swap the two cells' contents. Dropping an item onto its own cell, onto a blocked cell, or outside any cell other than the remove target SHALL be a no-op that returns the item to its origin.

Dragging an item off the grid to the designated remove target SHALL unequip it, with the same effect as the existing click-to-remove.

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

- **WHEN** the user drags the item in cell 6 onto the remove target and releases
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
- At most four copies of any one **specific consumable**, counted across all cells regardless of adjacency. Two different consumables never share a budget, even when they share a `type`.
- At most eight occupied cells, of which blocked cells are not available.

The picker's enabled/disabled state for an item SHALL be derived from the same predicate and the same rules that the reducer enforces, so an item the picker offers is always an item the reducer will accept.

#### Scenario: The per-item cap counts across non-adjacent cells

- **WHEN** a loadout holds four Vitality Shots spread across non-adjacent cells
- **THEN** every further Vitality Shot SHALL be rejected by the reducer and SHALL render as unavailable in the picker, while a Stamina Shot SHALL still be accepted

#### Scenario: A stack counts toward its own cap by its full quantity

- **WHEN** a loadout holds a `×3` stack of Vitality Shots and one further Vitality Shot is added
- **THEN** the stack SHALL be counted as 3, the add SHALL be accepted, and a fifth Vitality Shot SHALL be rejected

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

The keyboard route SHALL be a grab-and-place model: a focused cell is grabbed with Enter or Space, arrow keys move the placement target among cells, Enter or Space commits the move, and Escape cancels and restores the origin. While a cell is grabbed, the grid SHALL communicate the grabbed item and the current target through an `aria-live="polite"` region, and SHALL announce the outcome — moved, swapped, or rejected — on commit.

Unequipping SHALL likewise have a keyboard route that does not require dragging off the grid; the existing activation-to-remove behaviour satisfies this and SHALL be retained.

Cells SHALL be reachable in a tab order that follows the visual layout, and a grabbed stack SHALL be announced with its quantity so a screen-reader user knows how many cells the pending move will consume.

Focus SHALL follow the item rather than the cell. After a completed move, focus SHALL rest on the destination cell; after a cancelled grab, on the origin cell; after a removal, on the now-empty cell that held the item. Focus MUST NOT be lost to the document body by any grid operation.

#### Scenario: A move is completed without a pointer

- **WHEN** a keyboard user focuses the cell holding an item, presses Enter, presses the arrow keys to reach an empty cell, and presses Enter again
- **THEN** the item SHALL be in the destination cell and the origin cell SHALL be empty, identically to the same move performed by drag

#### Scenario: Escape cancels a grab

- **WHEN** a keyboard user grabs a cell, moves the target to another cell, and presses Escape
- **THEN** the item SHALL remain in its origin cell and the loadout SHALL be unchanged

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

### ARIA Landmarks

The equipment grid sits inside the page's existing `role="main"` content area and SHALL NOT introduce a competing landmark. The grid itself SHALL be exposed with an accessible name identifying it as the equipment slots, and its cells SHALL be exposed as a positional set so assistive technology can report "cell 3 of 8".

### Icon-Only Controls

The drag handle, the remove target, and any control that renders as an icon or a bare glyph SHALL carry an `aria-label` naming its purpose and the item it acts on. A held cell of a stack SHALL carry an accessible name identifying which stack holds it, not merely that it is occupied.

### Dynamic Content Regions

The quantity badge, the slot counter in the panel header, and the grab/drop announcements SHALL be exposed through an `aria-live="polite"` region so a rearrangement is perceivable without sight. Rejections SHALL be announced through the same region rather than being conveyed only by the item snapping back.

### Keyboard Navigation

Every cell SHALL be focusable and operable by keyboard. Tab order SHALL follow the visual grid order. Enter and Space SHALL activate a cell's primary action, arrow keys SHALL move among cells, and Escape SHALL cancel an in-progress grab. Keyboard focus MUST NOT be trapped in the grid outside an active grab.

### Focus Management

Focus management for grid operations is specified as part of "Keyboard Equivalence for Every Pointer Gesture" above, and is testable through that requirement's scenarios. The grid introduces no modal or dialog surface, so no focus trap is required by this capability.
